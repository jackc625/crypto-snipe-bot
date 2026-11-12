// scripts/red-proof-conversions.ts
//
// Phase 23 plan 23-29 (CHAR-06, SPEC Requirement 8): the RED-proof runner for the source-text
// conversions. A converted test that cannot fail protects nothing, so each conversion in plans
// 23-18, 23-31, 23-30 and 23-19 is shown failing under a named mutant of the code it protects.
//
// The mutant is applied IN MEMORY: every run passes --config scripts/vitest.in-memory-mutant.config.ts
// with CSB_MUTANT_SPEC set in that Vitest child's environment only, and the config's plugin edits
// the module as Vite loads it. Nothing under src/ or scripts/ is written for any proof, so a
// failure partway cannot leave a production file modified. The SHA-256 of every target file is
// recorded before the first run and must be equal after the last.
//
// Usage:
//   node node_modules/ts-node/dist/bin.js scripts/red-proof-conversions.ts --self-proof
//
// Exports (contracts used by plans 23-18, 23-31, 23-30 and 23-19):
//   runMutant({ project, testFile, only?, spec? }) -> { status, failed: [{ title, message }], passedCount }
//     title is the full title path with ' > ' between describe levels; the caller compares.
//   WIRING_MUTANTS, MUTANTS, CONVERTED_TESTS, CONVERTED_COUNTS, GUARD_MUTANTS: empty here, filled
//     by the conversion plans.
//
// D-21: runs on Node 22.16.0 (ABI 127). The Phase 26 Node upgrade must update the assert below.
// Zero new npm deps. Importing this module runs nothing: main() runs only when the file is
// executed directly (require.main === module).

if (process.versions.modules !== '127') {
    console.error(
        `red-proof-conversions requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}).`,
    );
    process.exit(2);
}

import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const REPO_ROOT = path.resolve(__dirname, '..');
const VITEST_BIN = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const MUTANT_CONFIG = 'scripts/vitest.in-memory-mutant.config.ts';
const SPEC_ENV = 'CSB_MUTANT_SPEC';
// A Vitest child that has not finished in this time is a failed proof, never a pass.
const RUN_TIMEOUT_MS = 30 * 60_000;

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface MutantEdit {
    find: string;
    replace: string;
}

/** CSB_MUTANT_SPEC as JSON. */
export interface MutantSpec {
    file: string;
    edits: MutantEdit[];
    root?: string;
}

export interface MutantRunInput {
    project: string;
    testFile: string;
    only?: string;
    spec?: MutantSpec;
}

export interface FailedTest {
    title: string;
    message: string;
}

export interface MutantRun {
    status: number | null;
    failed: FailedTest[];
    passedCount: number;
    /** Titles of the tests that passed (full title path). */
    passed: string[];
    /** A file that failed outside any test (load error, process.exit, crash) adds one entry here and one to failed. */
    fileErrors: FailedTest[];
    /** Why no JSON report could be read, if so. */
    reportError?: string;
    outputTail: string;
}

export type Reach = 'vite' | 'worker' | 'child';

/** One mutant row of a conversion group. */
export interface MutantRow {
    name: string;
    group: string;
    project: string;
    testFile: string;
    only?: string;
    file: string;
    edits: MutantEdit[];
    reach: Reach;
    expected: string[];
    messageIncludes: string;
}

/** One mutant of the bot wiring conversion (plan 23-18); expected holds Test NN numbers. */
export interface WiringMutantRow {
    name: string;
    file: string;
    edits: MutantEdit[];
    expected: string[];
}

/** One test that read a named source file at the phase start. */
export interface ConvertedTestRow {
    testFile: string;
    baseTitle: string;
    currentTitle: string;
    mutants?: string[];
    removed?: string;
}

/** A mutant that guards a test with no CONVERTED_TESTS row, tied to one named conversion. */
export interface GuardMutantRow {
    mutant: string;
    guardedTitle: string;
    convertedTitle: string;
    reason: string;
}

// The conversion plans fill these tables.
export const WIRING_MUTANTS: WiringMutantRow[] = [];
export const MUTANTS: MutantRow[] = [];
export const CONVERTED_TESTS: ConvertedTestRow[] = [];
export const CONVERTED_COUNTS: Record<string, number> = {};
export const GUARD_MUTANTS: GuardMutantRow[] = [];

// ---------------------------------------------------------------------------
// runMutant
// ---------------------------------------------------------------------------

interface JsonAssertion {
    ancestorTitles?: string[];
    title?: string;
    status?: string;
    failureMessages?: string[];
}

interface JsonFileResult {
    name?: string;
    status?: string;
    message?: string;
    assertionResults?: JsonAssertion[];
}

function fullTitle(a: JsonAssertion): string {
    return [...(a.ancestorTitles ?? []), a.title ?? ''].join(' > ');
}

function tail(s: string, n = 4000): string {
    return s.length <= n ? s : s.slice(s.length - n);
}

/** Run one test file through the mutant config. spec absent: CSB_MUTANT_SPEC is removed from the child's env. */
export function runMutant(input: MutantRunInput): MutantRun {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-red-proof-run-'));
    const outFile = path.join(tmp, 'report.json');
    try {
        const args = [
            VITEST_BIN,
            'run',
            '--config',
            MUTANT_CONFIG,
            '--project',
            input.project,
            input.testFile,
            '--reporter=json',
            `--outputFile=${outFile}`,
        ];
        if (input.only !== undefined) args.push('-t', input.only);
        const env: NodeJS.ProcessEnv = { ...process.env };
        for (const k of Object.keys(env)) if (k.toUpperCase() === SPEC_ENV) delete env[k];
        if (input.spec !== undefined) env[SPEC_ENV] = JSON.stringify({ root: REPO_ROOT, ...input.spec });
        const r = spawnSync(process.execPath, args, {
            cwd: REPO_ROOT,
            env,
            encoding: 'utf8',
            timeout: RUN_TIMEOUT_MS,
            maxBuffer: 512 * 1024 * 1024,
            windowsHide: true,
        });
        const outputTail = tail(`${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n[runMutant] spawn error: ${r.error.message}` : ''}`);
        const run: MutantRun = { status: r.status, failed: [], passedCount: 0, passed: [], fileErrors: [], outputTail };
        let report: { testResults?: JsonFileResult[] };
        try {
            report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        } catch (e) {
            run.reportError = `no JSON report: ${(e as Error).message}`;
            return run;
        }
        for (const f of report.testResults ?? []) {
            const asserts = f.assertionResults ?? [];
            for (const a of asserts) {
                if (a.status === 'passed') {
                    run.passedCount += 1;
                    run.passed.push(fullTitle(a));
                } else if (a.status === 'failed') {
                    run.failed.push({ title: fullTitle(a), message: (a.failureMessages ?? []).join('\n') });
                }
            }
            // A file that failed with no failed test inside it (a load error, process.exit, a crash).
            if (f.status === 'failed' && !asserts.some((a) => a.status === 'failed')) {
                const fe = { title: `<file error> ${path.relative(REPO_ROOT, f.name ?? '?').split(path.sep).join('/')}`, message: f.message ?? '' };
                run.fileErrors.push(fe);
                run.failed.push(fe);
            }
        }
        return run;
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Proof checks
// ---------------------------------------------------------------------------

function sha256(file: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, file))).digest('hex');
}

function gitStatusSrc(): string {
    const r = spawnSync('git', ['status', '--porcelain', '--', 'src'], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) return `git status failed: ${r.stderr}`;
    return r.stdout.trim();
}

function sameSet(a: string[], b: string[]): boolean {
    const sa = [...new Set(a)].sort();
    const sb = [...new Set(b)].sort();
    return sa.length === sb.length && sa.every((x, i) => x === sb[i]) && a.length === sa.length;
}

/** The private rows that prove this plan's mechanism. They name no conversion. */
const MECHANISM_MUTANTS: MutantRow[] = [
    {
        name: 'mech-vite',
        group: 'mechanism',
        project: 'integration',
        testFile: 'test/integration/directEntryGuard.test.ts',
        only: 'isDirectEntry compares canonical files',
        file: 'src/guards/directEntry.ts',
        // The plan named `if (mainFile === undefined) return false;` -> `return true;`. Measured:
        // in a Vitest worker require.main is undefined, so the guard's own import-time call refuses
        // and the whole file dies (process.exit) instead of failing this test on an assertion.
        edits: [{ find: 'return canonical(entryFile) === canonical(mainFile);', replace: 'return canonical(entryFile) !== canonical(mainFile);' }],
        reach: 'vite',
        expected: ['direct-entry guard > isDirectEntry compares canonical files'],
        messageIncludes: 'AssertionError: expected false to be true',
    },
];

function selfProof(): number {
    const rows = MECHANISM_MUTANTS;
    const files = [...new Set(rows.map((r) => r.file))];
    const before = new Map(files.map((f) => [f, sha256(f)]));
    const refuse = (name: string, why: string): number => {
        console.error(`REFUSED ${name}: ${why}`);
        return 1;
    };
    const lines: string[] = [];
    for (const row of rows) {
        const run = runMutant({ project: row.project, testFile: row.testFile, only: row.only, spec: { file: row.file, edits: row.edits } });
        if (run.reportError) return refuse(row.name, `${run.reportError}\n${run.outputTail}`);
        if (run.status === 0 || run.failed.length === 0) return refuse(row.name, `stayed green (exit ${run.status})`);
        const titles = run.failed.map((f) => f.title);
        if (!sameSet(titles, row.expected)) return refuse(row.name, `failed ${JSON.stringify(titles)}, expected ${JSON.stringify(row.expected)}`);
        for (const f of run.failed) {
            if (!f.message.startsWith('AssertionError') || !f.message.includes(row.messageIncludes)) {
                return refuse(row.name, `not an assertion failure carrying ${JSON.stringify(row.messageIncludes)}: ${f.message.slice(0, 400)}`);
            }
        }
        const control = runMutant({ project: row.project, testFile: row.testFile, only: row.only });
        if (control.reportError || control.status !== 0 || control.failed.length > 0 || !row.expected.every((t) => control.passed.includes(t))) {
            return refuse(row.name, `no-mutant run did not pass ${JSON.stringify(row.expected)}: exit ${control.status}, failed ${JSON.stringify(control.failed.map((f) => f.title))}\n${control.outputTail}`);
        }
        for (const t of titles) lines.push(`RED-OK ${row.name} :: ${row.testFile} :: ${t}`);
    }
    for (const f of files) if (sha256(f) !== before.get(f)) return refuse('mechanism', `SHA-256 of ${f} changed`);
    const st = gitStatusSrc();
    if (st !== '') return refuse('mechanism', `git status --porcelain -- src is not empty:\n${st}`);
    for (const l of lines) console.log(l);
    console.log(`SELF-PROOF-OK rows ${rows.length}`);
    return 0;
}

function main(): void {
    const argv = process.argv.slice(2);
    try {
        if (argv.length === 1 && argv[0] === '--self-proof') process.exit(selfProof());
        console.error('usage: red-proof-conversions.ts --self-proof');
        process.exit(2);
    } catch (e) {
        console.error(`red-proof-conversions: ${(e as Error).stack ?? e}`);
        process.exit(2);
    }
}

if (require.main === module) main();
