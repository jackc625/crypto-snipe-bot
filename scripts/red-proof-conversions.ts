// scripts/red-proof-conversions.ts
//
// Phase 23 plan 23-29 (CHAR-06, SPEC Requirement 8): the RED-proof runner for the source-text
// conversions. A converted test that cannot fail protects nothing, so each conversion in plans
// 23-18, 23-31, 23-30 and 23-19 is shown failing under a named mutant of the code it protects.
//
// The mutant is applied IN MEMORY: every run passes --config scripts/vitest.in-memory-mutant.config.ts
// with CSB_MUTANT_SPEC set in that Vitest child's environment only. The mutant reaches the code
// whichever form a conversion took (see the config and scripts/in-memory-mutant-overlay.cjs):
//   vite    the module as Vite loads it;
//   worker  a read of the file through fs inside a Vitest worker (a test's own read, or the
//           TypeScript compiler API);
//   child   a railed child started through test/rails/spawnRailedChild.ts, whose NODE_OPTIONS gain
//           one more --require (after the rails preload) that installs the same read overlay.
// Nothing under src/ or scripts/ is written for any proof, so a failure partway cannot leave a
// production file modified. The only files written are the runner's own temp folders under
// os.tmpdir() (the hooks and the reach markers), removed after each run.
//
// Usage:
//   node node_modules/ts-node/dist/bin.js scripts/red-proof-conversions.ts --self-proof
//
// runGroup(rows) refuses a proof that is not one, printing one named reason and exiting non-zero:
//   NOT-APPLIED     a find does not occur exactly once in the file on disk (checked before any run)
//   NOT-REACHED     the run left no marker for the row's reach
//   STAYED-GREEN    the run passed
//   WRONG-SET       the failed tests are not exactly the row's expected titles
//   BAD-FAILURE     no report, a non-zero exit with no failed test, or a failure that is not an
//                   assertion carrying messageIncludes, or that mentions a timeout or a compile error
//   CONTROL-FAILED  a run of the same tests with no mutant did not pass every selected test
//   HASH-CHANGED    a target file's SHA-256 changed, or git status --porcelain -- src is not empty
// It prints `RED-OK <mutant> :: <test file> :: <full title>` per failed test only when every row
// and every control holds.
//
// Exports (contracts used by plans 23-18, 23-31, 23-30 and 23-19):
//   runMutant({ project, testFile, only?, spec? }) -> { status, failed: [{ title, message }], passedCount }
//     title is the full title path with ' > ' between describe levels; the caller compares.
//   runGroup(rows), evaluateGroup(rows)
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
const OVERLAY_PATH = path.join(REPO_ROOT, 'scripts', 'in-memory-mutant-overlay.cjs');
const SPEC_ENV = 'CSB_MUTANT_SPEC';
// A Vitest child that has not finished in this time is a failed proof, never a pass.
const RUN_TIMEOUT_MS = 30 * 60_000;
// A failure message holding any of these is not an assertion on the behavior.
const FORBIDDEN_IN_MESSAGE = ['Test timed out', 'SyntaxError', 'TSError', 'Unable to compile'];

const overlay = require(OVERLAY_PATH) as { applyEdits(text: string, edits: MutantEdit[]): string };

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface MutantEdit {
    find: string;
    replace: string;
}

/** CSB_MUTANT_SPEC as JSON. root defaults to the repo root in runMutant. */
export interface MutantSpec {
    file: string;
    edits: MutantEdit[];
    root?: string;
    ackDir?: string;
    childHook?: string;
    workerHook?: string;
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
const REACHES: readonly Reach[] = ['vite', 'worker', 'child'];

/** One mutant row of a conversion group. */
export interface MutantRow {
    name: string;
    group: string;
    project: string;
    testFile: string;
    /** A -t pattern limiting the run to the tests this row is about. */
    only?: string;
    file: string;
    edits: MutantEdit[];
    reach: Reach;
    /** The exact full test titles that must fail. */
    expected: string[];
    /** A substring each failure message must contain, set from the first failing run. */
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

function repoRel(p: string): string {
    return path.relative(REPO_ROOT, p).split(path.sep).join('/');
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
                const fe = { title: `<file error> ${repoRel(f.name ?? '?')}`, message: f.message ?? '' };
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
// runGroup
// ---------------------------------------------------------------------------

export type Refusal = 'NOT-APPLIED' | 'NOT-REACHED' | 'STAYED-GREEN' | 'WRONG-SET' | 'BAD-FAILURE' | 'CONTROL-FAILED' | 'HASH-CHANGED';

export interface GroupResult {
    ok: boolean;
    refusal?: Refusal;
    /** The mutant (or 'group') the refusal is about. */
    subject?: string;
    detail?: string;
    /** RED-OK lines, filled only when ok. */
    lines: string[];
}

function sha256(file: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, file))).digest('hex');
}

function gitStatusSrc(): string {
    const r = spawnSync('git', ['status', '--porcelain', '--', 'src'], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) return `git status failed (exit ${r.status}): ${r.stderr}`;
    return r.stdout.trim();
}

function sameList(actual: string[], expected: string[]): boolean {
    const a = [...actual].sort();
    const e = [...expected].sort();
    return a.length === e.length && a.every((x, i) => x === e[i]);
}

function checkRowShape(row: MutantRow): void {
    const bad = (why: string): never => {
        throw new Error(`mutant row ${JSON.stringify(row.name)}: ${why}`);
    };
    if (typeof row.name !== 'string' || row.name === '') bad('name must be a non-empty string');
    for (const k of ['group', 'project', 'testFile', 'file', 'messageIncludes'] as const) {
        if (typeof row[k] !== 'string' || row[k] === '') bad(`${k} must be a non-empty string`);
    }
    if (row.only !== undefined && (typeof row.only !== 'string' || row.only === '')) bad('only, when given, must be a non-empty string');
    if (!REACHES.includes(row.reach)) bad(`reach must be one of ${REACHES.join(', ')}`);
    if (!Array.isArray(row.edits) || row.edits.length === 0) bad('edits must be a non-empty array');
    if (!Array.isArray(row.expected) || row.expected.length === 0 || row.expected.some((t) => typeof t !== 'string' || t === '')) {
        bad('expected must be a non-empty list of full test titles');
    }
    if (new Set(row.expected).size !== row.expected.length) bad('expected lists a title twice');
    if (path.isAbsolute(row.file) || path.isAbsolute(row.testFile)) bad('file and testFile must be repo-relative');
}

/** The -t pattern selecting every row's tests in one file, or undefined when one row runs the whole file. */
function controlPattern(rows: MutantRow[]): string | undefined {
    if (rows.some((r) => r.only === undefined)) return undefined;
    const pats = [...new Set(rows.map((r) => r.only as string))];
    return pats.length === 1 ? pats[0] : pats.map((p) => `(?:${p})`).join('|');
}

/** A one-line hook file that installs the read overlay for this spec. */
function hookSource(spec: MutantSpec, reach: 'worker' | 'child'): string {
    return `require(${JSON.stringify(OVERLAY_PATH)}).installOverlay(${JSON.stringify(spec)}, ${JSON.stringify(reach)});\n`;
}

/** Apply every row and its controls; return the first refusal, or the RED-OK lines. Writes nothing under the repo. */
export function evaluateGroup(rows: MutantRow[]): GroupResult {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('evaluateGroup: no mutant rows');
    for (const row of rows) checkRowShape(row);
    const names = rows.map((r) => r.name);
    if (new Set(names).size !== names.length) throw new Error(`evaluateGroup: a mutant name occurs twice in ${JSON.stringify(names)}`);

    const refuse = (refusal: Refusal, subject: string, detail: string): GroupResult => ({ ok: false, refusal, subject, detail, lines: [] });
    const files = [...new Set(rows.map((r) => r.file))];
    const before = new Map(files.map((f) => [f, sha256(f)]));
    const hashCheck = (subject: string): GroupResult | null => {
        for (const f of files) if (sha256(f) !== before.get(f)) return refuse('HASH-CHANGED', subject, `SHA-256 of ${f} changed`);
        const st = gitStatusSrc();
        if (st !== '') return refuse('HASH-CHANGED', subject, `git status --porcelain -- src is not empty:\n${st}`);
        return null;
    };
    const atStart = hashCheck('group');
    if (atStart) return atStart;

    // NOT-APPLIED before any run: every find must occur exactly once in the file on disk.
    for (const row of rows) {
        try {
            overlay.applyEdits(fs.readFileSync(path.join(REPO_ROOT, row.file), 'utf8'), row.edits);
        } catch (e) {
            return refuse('NOT-APPLIED', row.name, `${row.file}: ${(e as Error).message}`);
        }
    }

    const lines: string[] = [];
    for (const row of rows) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-red-proof-'));
        let run: MutantRun;
        let markers: string[];
        try {
            const ackDir = path.join(tmp, 'ack');
            fs.mkdirSync(ackDir);
            const spec: MutantSpec = {
                file: row.file,
                edits: row.edits,
                root: REPO_ROOT,
                ackDir,
                childHook: path.join(tmp, 'child.cjs'),
                workerHook: path.join(tmp, 'worker.cjs'),
            };
            fs.writeFileSync(spec.childHook as string, hookSource(spec, 'child'));
            fs.writeFileSync(spec.workerHook as string, hookSource(spec, 'worker'));
            run = runMutant({ project: row.project, testFile: row.testFile, only: row.only, spec });
            markers = fs.readdirSync(ackDir);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
        const hashed = hashCheck(row.name);
        if (hashed) return hashed;
        if (run.reportError) return refuse('BAD-FAILURE', row.name, `${run.reportError} (exit ${run.status})\n${run.outputTail}`);
        if (!markers.includes(row.reach)) {
            return refuse('NOT-REACHED', row.name, `no ${row.reach} marker (markers: ${JSON.stringify(markers.sort())}); exit ${run.status}, failed ${JSON.stringify(run.failed.map((f) => f.title))}`);
        }
        if (run.status === 0 && run.failed.length === 0) return refuse('STAYED-GREEN', row.name, `exit 0, ${run.passedCount} passed`);
        if (run.status === 0 || run.failed.length === 0) {
            return refuse('BAD-FAILURE', row.name, `exit ${run.status} with ${run.failed.length} failed test(s): not a test failure\n${run.outputTail}`);
        }
        const titles = run.failed.map((f) => f.title);
        if (!sameList(titles, row.expected)) {
            return refuse('WRONG-SET', row.name, `failed ${JSON.stringify(titles)}, expected ${JSON.stringify(row.expected)}`);
        }
        for (const f of run.failed) {
            const forbidden = FORBIDDEN_IN_MESSAGE.find((s) => f.message.includes(s));
            if (forbidden !== undefined) return refuse('BAD-FAILURE', row.name, `${f.title}: message mentions ${JSON.stringify(forbidden)}: ${f.message.slice(0, 600)}`);
            if (!f.message.startsWith('AssertionError')) return refuse('BAD-FAILURE', row.name, `${f.title}: not an assertion failure: ${f.message.slice(0, 600)}`);
            if (!f.message.includes(row.messageIncludes)) {
                return refuse('BAD-FAILURE', row.name, `${f.title}: message lacks ${JSON.stringify(row.messageIncludes)}: ${f.message.slice(0, 600)}`);
            }
        }
        for (const t of titles) lines.push(`RED-OK ${row.name} :: ${row.testFile} :: ${t}`);
    }

    // Controls: each test file once with no mutant; every selected test passes, and each row's expected title is among them.
    const byFile = new Map<string, MutantRow[]>();
    for (const row of rows) {
        const key = `${row.project}\u0000${row.testFile}`;
        byFile.set(key, [...(byFile.get(key) ?? []), row]);
    }
    for (const fileRows of byFile.values()) {
        const { project, testFile } = fileRows[0];
        const control = runMutant({ project, testFile, only: controlPattern(fileRows) });
        const want = [...new Set(fileRows.flatMap((r) => r.expected))];
        const missing = want.filter((t) => !control.passed.includes(t));
        if (control.reportError || control.status !== 0 || control.failed.length > 0 || control.passedCount === 0 || missing.length > 0) {
            const why = control.reportError ?? `exit ${control.status}, failed ${JSON.stringify(control.failed.map((f) => f.title))}, not passed ${JSON.stringify(missing)}`;
            return refuse('CONTROL-FAILED', `${project}:${testFile}`, `${why}\n${control.outputTail}`);
        }
        const hashed = hashCheck(`control ${testFile}`);
        if (hashed) return hashed;
    }
    const atEnd = hashCheck('group');
    if (atEnd) return atEnd;
    return { ok: true, lines };
}

/** Apply each row, print RED-OK lines, and set a non-zero exit code with one named reason on a refusal. */
export function runGroup(rows: MutantRow[]): GroupResult {
    const r = evaluateGroup(rows);
    if (r.ok) {
        for (const l of r.lines) console.log(l);
    } else {
        console.error(`REFUSED ${r.refusal} ${r.subject}: ${r.detail}`);
        process.exitCode = 1;
    }
    return r;
}

// ---------------------------------------------------------------------------
// --self-proof: this plan's own mechanism rows. They name no conversion.
// ---------------------------------------------------------------------------

const DIRECT_ENTRY_TEST = 'test/integration/directEntryGuard.test.ts';
const GUARD_FILE = 'src/guards/directEntry.ts';

const MECHANISM_MUTANTS: MutantRow[] = [
    {
        name: 'mech-vite',
        group: 'mechanism',
        project: 'integration',
        testFile: DIRECT_ENTRY_TEST,
        only: 'isDirectEntry compares canonical files',
        file: GUARD_FILE,
        // The plan named `if (mainFile === undefined) return false;` -> `return true;`. Measured:
        // in a Vitest worker require.main is undefined, so the guard's own import-time call refuses
        // and the whole file dies (process.exit) instead of failing this test on an assertion.
        edits: [{ find: 'return canonical(entryFile) === canonical(mainFile);', replace: 'return canonical(entryFile) !== canonical(mainFile);' }],
        reach: 'vite',
        expected: ['direct-entry guard > isDirectEntry compares canonical files'],
        messageIncludes: 'expected false to be true',
    },
    {
        name: 'mech-worker',
        group: 'mechanism',
        project: 'unit',
        testFile: 'test/unit/codeQuality.test.ts',
        only: 'finds zero console.error calls',
        file: GUARD_FILE,
        edits: [{ find: 'process.stderr.write(REFUSAL);', replace: 'console.error(REFUSAL);' }],
        reach: 'worker',
        expected: ['INFRA-01: no console.log/warn/error in src/ production code > finds zero console.error calls in src/ (excluding scripts/)'],
        messageIncludes: 'to have a length of +0 but got 1',
    },
    {
        name: 'mech-child',
        group: 'mechanism',
        project: 'integration',
        testFile: DIRECT_ENTRY_TEST,
        only: 'a direct start refuses before any later import runs',
        file: GUARD_FILE,
        edits: [{ find: 'process.stderr.write(REFUSAL);', replace: 'void 0;' }],
        reach: 'child',
        expected: ['direct-entry guard > a direct start refuses before any later import runs'],
        // From the first failing run: the child exits 1 with nothing on stderr. A child that failed
        // to compile writes its TSError there, so it can never produce an empty stderr.
        messageIncludes: "expected '' to contain 'Refusing to start'",
    },
];

function selfProof(): number {
    const r = runGroup(MECHANISM_MUTANTS);
    if (!r.ok) return 1;
    console.log(`SELF-PROOF-OK rows ${MECHANISM_MUTANTS.length}`);
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
