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
// Usage (node node_modules/ts-node/dist/bin.js scripts/red-proof-conversions.ts <mode>):
//   --group <name>              runGroup over the MUTANTS rows of that group. A group whose tests
//                               start real children takes minutes: start it as a background command.
//   --check-manifest            runs nothing; checks the tables against each other, the test files
//                               and the target files; prints MANIFEST-OK rows <n> files <m> guards <k>.
//   --check-summaries <path>... every RED-OK and AC-38 line the tables require is in those files.
//   --self-test                 drives the manifest and summary rules on in-memory tables and temp
//                               files; prints SELF-TEST-OK cases <n>.
//   --self-proof                runs this plan's own mechanism rows, positive and negative;
//                               prints SELF-PROOF-OK rows <n>.
// Exit codes: 0 pass, 1 a refusal or a rule broken, 2 bad arguments or an internal error.
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
//   checkManifest(tables, root), checkSummaries(tables, docs), literalTitlePaths(text, fileName):
//     the --check-manifest and --check-summaries rules as pure functions (proven by --self-test).
//     A summary line counts when, after trimming, a leading list marker and wrapping backticks are
//     removed, it equals `RED-OK <mutant> :: <testFile> :: <title>`, or for a removal reads
//     `AC-38 removed: <baseTitle>` alone or followed by " — reason", " - reason" or " (reason)".
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
import * as ts from 'typescript';

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
    /** A -t pattern limiting the run to the tests this row is about. Vitest reads it as a regular expression (new RegExp), so escape ( ) [ ] . * + ? in titles. */
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
        if (run.status === 0 && run.failed.length === 0) {
            const none = run.passedCount === 0 ? ': no test was selected (only is a -t regular expression; escape ( ) [ ] . * + ? in titles)' : '';
            return refuse('STAYED-GREEN', row.name, `exit 0, ${run.passedCount} passed${none}`);
        }
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

const [MECH_VITE, , MECH_CHILD] = MECHANISM_MUTANTS;

/** Rows the runner must refuse, each with the refusal it must give and a pattern its detail must match. */
const NEGATIVE_MECHANISM_MUTANTS: { row: MutantRow; refusal: Refusal; detailMatches: RegExp }[] = [
    {
        row: { ...MECH_VITE, name: 'mech-not-applied', edits: [{ find: 'this statement does not occur in src/guards/directEntry.ts;', replace: 'void 0;' }] },
        refusal: 'NOT-APPLIED',
        detailMatches: /find does not occur/,
    },
    {
        // mech-vite's run and edit, claiming the child reach: that test starts no child.
        row: { ...MECH_VITE, name: 'mech-not-reached', reach: 'child' },
        refusal: 'NOT-REACHED',
        detailMatches: /no child marker/,
    },
    {
        row: {
            ...MECH_VITE,
            name: 'mech-stayed-green',
            edits: [{ find: '// A file that cannot be resolved still compares by its full path.', replace: '// (comment changed by the mech-stayed-green mutant)' }],
        },
        refusal: 'STAYED-GREEN',
        detailMatches: /^exit 0/,
    },
    {
        row: { ...MECH_VITE, name: 'mech-wrong-set', expected: ['direct-entry guard > a direct start refuses before any later import runs'] },
        refusal: 'WRONG-SET',
        detailMatches: /^failed \["direct-entry guard > isDirectEntry compares canonical files"\]/,
    },
    {
        // mech-child's run and messageIncludes, with a statement the type-checking ts-node child
        // cannot compile (TS2352). The plan said "broken syntax"; a syntax error would also break
        // Vite's load of the same module in the worker, so the test file would fail to load and
        // the child would never run. A type error is stripped by Vite and rejected only by the
        // child, which is exactly the case to refuse: the child failed to compile while the same
        // test still failed.
        row: { ...MECH_CHILD, name: 'mech-compile-error', edits: [{ find: 'process.stderr.write(REFUSAL);', replace: 'process.stderr.write(REFUSAL as number);' }] },
        refusal: 'BAD-FAILURE',
        detailMatches: /TSError|Unable to compile|message lacks/,
    },
];

function selfProof(): number {
    const positive = runGroup(MECHANISM_MUTANTS);
    if (!positive.ok) return 1;
    for (const neg of NEGATIVE_MECHANISM_MUTANTS) {
        const r = evaluateGroup([neg.row]);
        const firstLine = (r.detail ?? '').split('\n')[0];
        if (r.ok || r.refusal !== neg.refusal || !neg.detailMatches.test(r.detail ?? '')) {
            console.error(
                `SELF-PROOF-FAIL ${neg.row.name}: expected ${neg.refusal} matching ${neg.detailMatches}, got ${r.ok ? 'a passing proof' : `${r.refusal}: ${r.detail}`}`,
            );
            return 1;
        }
        console.log(`REFUSED-AS-EXPECTED ${neg.row.name} ${r.refusal}: ${firstLine.slice(0, 300)}`);
    }
    console.log(`SELF-PROOF-OK rows ${MECHANISM_MUTANTS.length + NEGATIVE_MECHANISM_MUTANTS.length}`);
    return 0;
}

// ---------------------------------------------------------------------------
// --check-manifest and --check-summaries rules. Pure: tables and files in, problems out.
// ---------------------------------------------------------------------------

export interface ManifestTables {
    MUTANTS: MutantRow[];
    WIRING_MUTANTS: WiringMutantRow[];
    CONVERTED_TESTS: ConvertedTestRow[];
    CONVERTED_COUNTS: Record<string, number>;
    GUARD_MUTANTS: GuardMutantRow[];
}

export interface Problem {
    code: string;
    detail: string;
}

export interface ManifestResult {
    problems: Problem[];
    rows: number;
    files: number;
    guards: number;
}

export interface SummaryResult {
    problems: Problem[];
    redOk: number;
    removed: number;
}

function isText(v: unknown): v is string {
    return typeof v === 'string' && v.trim() !== '';
}

/** The Test NN label of a title's last level ('22' for '... > Test 22: ...'), or null. */
function testNumberOf(title: string): string | null {
    const last = title.split(' > ').pop() ?? '';
    const m = /^Test (\d+[a-z]?):/.exec(last);
    return m ? m[1] : null;
}

/** A WIRING_MUTANTS expected entry as a bare number: '22', 'Test 22' and 'Test 22:' are all '22'. */
function wiringNumber(entry: string): string {
    return entry.replace(/^Test\s+/, '').replace(/:$/, '').trim();
}

/** The identifier a call chain starts from: describe for describe.each(x)('t', fn), and so on. */
function chainBase(e: ts.Expression): string | null {
    let x: ts.Expression = e;
    for (;;) {
        if (ts.isIdentifier(x)) return x.text;
        if (ts.isPropertyAccessExpression(x)) x = x.expression;
        else if (ts.isCallExpression(x)) x = x.expression;
        else return null;
    }
}

/**
 * Every `describe > it` title path in a test file built only from string-literal titles of plain
 * describe / it / test calls. A describe.each, describe.skip or any non-literal level makes every
 * title under it non-literal; it.skip, it.each and the like never count.
 */
export function literalTitlePaths(sourceText: string, fileName: string): string[] {
    const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const out: string[] = [];
    const visit = (node: ts.Node, stack: (string | null)[]): void => {
        if (ts.isCallExpression(node)) {
            const base = chainBase(node.expression);
            const first = node.arguments[0];
            const literal = first !== undefined && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) ? first.text : null;
            const plain = ts.isIdentifier(node.expression);
            if (base === 'describe' || base === 'suite') {
                const level = plain ? literal : null;
                for (const a of node.arguments) visit(a, [...stack, level]);
                return;
            }
            if ((base === 'it' || base === 'test') && plain && literal !== null && stack.every((s) => s !== null)) {
                out.push([...(stack as string[]), literal].join(' > '));
            }
        }
        ts.forEachChild(node, (c) => visit(c, stack));
    };
    visit(sf, []);
    return out;
}

function checkWiringShape(w: WiringMutantRow): string | null {
    if (!isText(w.name)) return 'name must be a non-empty string';
    if (!isText(w.file)) return 'file must be a non-empty string';
    if (!Array.isArray(w.edits) || w.edits.length === 0) return 'edits must be a non-empty array';
    if (!Array.isArray(w.expected) || w.expected.length === 0 || !w.expected.every(isText)) return 'expected must be a non-empty list of Test NN numbers';
    return null;
}

/** The --check-manifest rules over these tables, reading test and target files under root. Runs nothing. */
export function checkManifest(t: ManifestTables, root: string): ManifestResult {
    const problems: Problem[] = [];
    const p = (code: string, detail: string): void => {
        problems.push({ code, detail });
    };
    const read = (rel: string): string | null => {
        try {
            return fs.readFileSync(path.join(root, rel), 'utf8');
        } catch {
            return null;
        }
    };

    // Mutant names are unique across both tables; rows have their shape.
    const seen = new Set<string>();
    for (const n of [...t.MUTANTS.map((m) => m.name), ...t.WIRING_MUTANTS.map((m) => m.name)]) {
        if (seen.has(n)) p('duplicate-mutant', n);
        seen.add(n);
    }
    for (const m of t.MUTANTS) {
        try {
            checkRowShape(m);
        } catch (e) {
            p('bad-mutant-shape', (e as Error).message);
        }
    }
    for (const w of t.WIRING_MUTANTS) {
        const why = checkWiringShape(w);
        if (why !== null) p('bad-mutant-shape', `wiring mutant ${JSON.stringify(w.name)}: ${why}`);
    }
    const mutantByName = new Map(t.MUTANTS.map((m) => [m.name, m]));
    const wiringByName = new Map(t.WIRING_MUTANTS.map((m) => [m.name, m]));

    // Each converted row: one outcome; every named mutant exists and expects this row's test.
    const named = new Set<string>();
    for (const r of t.CONVERTED_TESTS) {
        const id = `${r.testFile} :: ${r.currentTitle}`;
        if (!isText(r.testFile) || !isText(r.baseTitle) || !isText(r.currentTitle)) {
            p('bad-row-shape', `${id}: testFile, baseTitle and currentTitle must be non-empty strings`);
            continue;
        }
        const hasMutants = r.mutants !== undefined;
        const hasRemoved = r.removed !== undefined;
        if (hasMutants && hasRemoved) {
            p('row-both-outcomes', id);
            continue;
        }
        if (hasRemoved) {
            if (!isText(r.removed)) p('removed-empty-reason', id);
            continue;
        }
        if (!hasMutants || !Array.isArray(r.mutants) || r.mutants.length === 0) {
            p('row-no-outcome', id);
            continue;
        }
        for (const name of r.mutants) {
            named.add(name);
            const m = mutantByName.get(name);
            const w = wiringByName.get(name);
            if (m === undefined && w === undefined) {
                p('missing-mutant', `${id} names ${JSON.stringify(name)}`);
            } else if (m !== undefined) {
                if (m.testFile !== r.testFile) p('mutant-wrong-file', `${name} runs ${m.testFile}, the row is in ${r.testFile}`);
                if (!Array.isArray(m.expected) || !m.expected.includes(r.currentTitle)) p('mutant-not-expecting-row', `${name} does not list ${JSON.stringify(r.currentTitle)}`);
            } else if (w !== undefined) {
                const nn = testNumberOf(r.currentTitle);
                const listed = Array.isArray(w.expected) ? w.expected.map(wiringNumber) : [];
                if (nn === null || !listed.includes(nn)) p('mutant-not-expecting-row', `${name} does not list Test ${nn ?? '?'} (${JSON.stringify(r.currentTitle)})`);
            }
        }
    }

    // Guard rows: the one narrow exception to "every mutant is named by a row".
    const guardUses = new Map<string, number>();
    for (const g of t.GUARD_MUTANTS) guardUses.set(g.mutant, (guardUses.get(g.mutant) ?? 0) + 1);
    for (const g of t.GUARD_MUTANTS) {
        const id = `guard ${JSON.stringify(g.mutant)}`;
        if (!isText(g.reason)) p('guard-empty-reason', id);
        if ((guardUses.get(g.mutant) ?? 0) > 1) p('guard-duplicate', `${id} appears in ${guardUses.get(g.mutant)} guard rows`);
        const m = mutantByName.get(g.mutant);
        if (m === undefined) {
            p('guard-missing-mutant', `${id} is not in MUTANTS`);
            continue;
        }
        if (named.has(g.mutant)) p('guard-mutant-named-by-row', `${id} is also named by a CONVERTED_TESTS row`);
        if (!Array.isArray(m.expected) || m.expected.length !== 1 || m.expected[0] !== g.guardedTitle) {
            p('guard-expected-mismatch', `${id} expected ${JSON.stringify(m.expected)}, guardedTitle ${JSON.stringify(g.guardedTitle)}`);
        }
        const src = read(m.testFile);
        const found = src === null ? -1 : literalTitlePaths(src, m.testFile).filter((x) => x === g.guardedTitle).length;
        if (found !== 1) {
            p('guard-title-not-found', `${id}: ${JSON.stringify(g.guardedTitle)} ${found === -1 ? `(cannot read ${m.testFile})` : `occurs ${found} times as a literal describe > it path in ${m.testFile}`}`);
        }
        if (t.CONVERTED_TESTS.some((r) => r.currentTitle === g.guardedTitle || r.baseTitle === g.guardedTitle)) {
            p('guard-title-is-converted', `${id}: ${JSON.stringify(g.guardedTitle)} is a converted test's title; it belongs in its own row`);
        }
        if (!t.CONVERTED_TESTS.some((r) => r.testFile === m.testFile && r.currentTitle === g.convertedTitle)) {
            p('guard-converted-unknown', `${id}: convertedTitle ${JSON.stringify(g.convertedTitle)} is no CONVERTED_TESTS row of ${m.testFile}`);
        }
    }

    // Every mutant is named by a row, or (MUTANTS only) by a guard.
    const guarded = new Set(t.GUARD_MUTANTS.map((g) => g.mutant));
    for (const m of t.MUTANTS) if (!named.has(m.name) && !guarded.has(m.name)) p('unnamed-mutant', m.name);
    for (const w of t.WIRING_MUTANTS) if (!named.has(w.name)) p('unnamed-mutant', w.name);

    // Every find occurs exactly once in the current target file.
    for (const m of [...t.MUTANTS, ...t.WIRING_MUTANTS]) {
        if (!isText(m.file)) continue;
        const src = read(m.file);
        if (src === null) {
            p('find-missing-file', `${m.name}: cannot read ${m.file}`);
            continue;
        }
        try {
            overlay.applyEdits(src, m.edits);
        } catch (e) {
            p('find-not-once', `${m.name} on ${m.file}: ${(e as Error).message}`);
        }
    }

    // Rows per test file equal CONVERTED_COUNTS.
    const perFile = new Map<string, number>();
    for (const r of t.CONVERTED_TESTS) perFile.set(r.testFile, (perFile.get(r.testFile) ?? 0) + 1);
    for (const f of new Set([...perFile.keys(), ...Object.keys(t.CONVERTED_COUNTS)])) {
        const want = t.CONVERTED_COUNTS[f];
        const got = perFile.get(f) ?? 0;
        if (!Number.isInteger(want) || want !== got) p('count-mismatch', `${f}: ${got} rows, CONVERTED_COUNTS says ${want}`);
    }
    return { problems, rows: t.CONVERTED_TESTS.length, files: perFile.size, guards: t.GUARD_MUTANTS.length };
}

/** A summary line with markdown list markers and code ticks removed. */
function summaryLine(raw: string): string {
    let s = raw.trim();
    s = s.replace(/^(?:[-*+]\s+|\d+\.\s+)/, '');
    if (s.startsWith('`') && s.endsWith('`') && s.length >= 2) s = s.slice(1, -1);
    return s.trim();
}

/** True when line is `AC-38 removed: <title>` alone or followed by ` — `, ` - `, ` – ` or ` (` and a reason. */
function isRemovedLine(line: string, title: string): boolean {
    const prefix = `AC-38 removed: ${title}`;
    if (!line.startsWith(prefix)) return false;
    const rest = line.slice(prefix.length);
    return rest === '' || /^\s+(?:[—–-]\s|\()/.test(rest);
}

/**
 * The --check-summaries rules: each mutant a row names has
 *   RED-OK <mutant> :: <row testFile> :: <row currentTitle>
 * each guard mutant has RED-OK <mutant> :: <its testFile> :: <guardedTitle>, and each removed row
 * has a line `AC-38 removed: <baseTitle>` (alone, or followed by " — reason", " - reason" or
 * " (reason)"). A line may be indented, a list item or wrapped in backticks.
 */
export function checkSummaries(t: ManifestTables, docs: { name: string; text: string }[]): SummaryResult {
    const problems: Problem[] = [];
    const lines = docs.flatMap((d) => d.text.split(/\r?\n/).map(summaryLine));
    const lineSet = new Set(lines);
    let redOk = 0;
    let removed = 0;
    const testFileOf = new Map<string, string>(t.MUTANTS.map((m) => [m.name, m.testFile]));
    for (const r of t.CONVERTED_TESTS) {
        if (r.removed !== undefined) {
            if (lines.some((l) => isRemovedLine(l, r.baseTitle))) removed += 1;
            else problems.push({ code: 'summary-missing-removed', detail: `no line "AC-38 removed: ${r.baseTitle}"` });
        }
        for (const m of r.mutants ?? []) {
            const want = `RED-OK ${m} :: ${r.testFile} :: ${r.currentTitle}`;
            if (lineSet.has(want)) redOk += 1;
            else problems.push({ code: 'summary-missing-red-ok', detail: `no line "${want}"` });
        }
    }
    for (const g of t.GUARD_MUTANTS) {
        const tf = testFileOf.get(g.mutant);
        if (tf === undefined) {
            problems.push({ code: 'summary-guard-unknown', detail: `guard mutant ${JSON.stringify(g.mutant)} is not in MUTANTS` });
            continue;
        }
        const want = `RED-OK ${g.mutant} :: ${tf} :: ${g.guardedTitle}`;
        if (lineSet.has(want)) redOk += 1;
        else problems.push({ code: 'summary-missing-guard-red-ok', detail: `no line "${want}"` });
    }
    return { problems, redOk, removed };
}

function liveTables(): ManifestTables {
    return { MUTANTS, WIRING_MUTANTS, CONVERTED_TESTS, CONVERTED_COUNTS, GUARD_MUTANTS };
}

// ---------------------------------------------------------------------------
// --self-test: each manifest and summary rule on in-memory tables and temp files.
// ---------------------------------------------------------------------------

const FAKE_TEST = 'test/unit/fake.test.ts';
const FAKE_SRC = 'src/fake.ts';
const FAKE_TEST_TEXT = [
    "import { describe, it } from 'vitest';",
    '',
    "describe('fake suite', () => {",
    "    it('converted one', () => {});",
    "    it('converted two', () => {});",
    '    it(',
    "        'behavior guard',",
    '        () => {},',
    '    );',
    "    it.skip('skipped guard', () => {});",
    '});',
    '',
    "describe.each([1])('each %s', () => {",
    "    it('dynamic guard', () => {});",
    '});',
    '',
    "describe('Wiring', () => {",
    "    it('Test 22: wiring order', () => {});",
    '});',
    '',
].join('\r\n');
const FAKE_SRC_TEXT = [
    'export function alpha(): number {',
    '    return 1;',
    '}',
    'export function beta(): number {',
    '    return 2;',
    '}',
    '// TWICE',
    '// TWICE',
    '',
].join('\r\n');

function fakeMutant(name: string, find: string, expected: string[]): MutantRow {
    return {
        name,
        group: 'fake',
        project: 'unit',
        testFile: FAKE_TEST,
        file: FAKE_SRC,
        edits: [{ find, replace: 'void 0;' }],
        reach: 'vite',
        expected,
        messageIncludes: 'AssertionError',
    };
}

function baseTables(): ManifestTables {
    return {
        MUTANTS: [fakeMutant('m-alpha', 'return 1;', ['fake suite > converted one'])],
        WIRING_MUTANTS: [{ name: 'w-beta', file: FAKE_SRC, edits: [{ find: 'return 2;', replace: 'return 3;' }], expected: ['22'] }],
        CONVERTED_TESTS: [
            { testFile: FAKE_TEST, baseTitle: 'old one', currentTitle: 'fake suite > converted one', mutants: ['m-alpha'] },
            { testFile: FAKE_TEST, baseTitle: 'old two', currentTitle: 'fake suite > converted two', removed: 'it only asserted that old text was absent' },
            { testFile: FAKE_TEST, baseTitle: 'old wiring', currentTitle: 'Wiring > Test 22: wiring order', mutants: ['w-beta'] },
        ],
        CONVERTED_COUNTS: { [FAKE_TEST]: 3 },
        GUARD_MUTANTS: [],
    };
}

const BASE_SUMMARY = [
    '## RED proofs',
    '```',
    'RED-OK m-alpha :: test/unit/fake.test.ts :: fake suite > converted one',
    'RED-OK w-beta :: test/unit/fake.test.ts :: Wiring > Test 22: wiring order',
    '```',
    '- AC-38 removed: old two — it only asserted that old text was absent',
].join('\n');

function guardTables(): ManifestTables {
    const t = baseTables();
    t.MUTANTS.push(fakeMutant('m-guard', 'alpha(): number', ['fake suite > behavior guard']));
    t.GUARD_MUTANTS.push({ mutant: 'm-guard', guardedTitle: 'fake suite > behavior guard', convertedTitle: 'fake suite > converted one', reason: 'the converted test (4) is now carried by what this test observes' });
    return t;
}

const GUARD_SUMMARY = `${BASE_SUMMARY}\n\`RED-OK m-guard :: test/unit/fake.test.ts :: fake suite > behavior guard\``;

interface SelfTestCase {
    name: string;
    tables: ManifestTables;
    summary: string;
    manifest: string[];
    summaries: string[];
    totals?: { rows: number; files: number; guards: number };
}

function selfTestCases(): SelfTestCase[] {
    const c = (name: string, edit: (t: ManifestTables) => void, manifest: string[], summary = BASE_SUMMARY, summaries: string[] = [], from = baseTables): SelfTestCase => {
        const tables = from();
        edit(tables);
        return { name, tables, summary, manifest, summaries };
    };
    const g = (name: string, edit: (t: ManifestTables) => void, manifest: string[], summary = GUARD_SUMMARY, summaries: string[] = []): SelfTestCase =>
        c(name, edit, manifest, summary, summaries, guardTables);
    return [
        // Complete tables pass, with no guard and with one; the guard changes neither rows nor files.
        { ...c('complete tables, no guard', () => undefined, []), totals: { rows: 3, files: 1, guards: 0 } },
        { ...g('complete tables, one guard', () => undefined, []), totals: { rows: 3, files: 1, guards: 1 } },
        // Manifest rules.
        c('a row names a missing mutant', (t) => t.CONVERTED_TESTS[0].mutants?.push('ghost'), ['missing-mutant'], BASE_SUMMARY, ['summary-missing-red-ok']),
        c('a row with neither mutants nor removed', (t) => delete t.CONVERTED_TESTS[1].removed, ['row-no-outcome']),
        c('a row with both mutants and removed', (t) => (t.CONVERTED_TESTS[1].mutants = ['m-alpha']), ['row-both-outcomes'], BASE_SUMMARY, ['summary-missing-red-ok']),
        c('a removed row with an empty reason', (t) => (t.CONVERTED_TESTS[1].removed = '   '), ['removed-empty-reason']),
        c('a duplicate mutant name', (t) => t.MUTANTS.push({ ...t.MUTANTS[0] }), ['duplicate-mutant']),
        c('a duplicate name across MUTANTS and WIRING_MUTANTS', (t) => t.WIRING_MUTANTS.push({ ...t.WIRING_MUTANTS[0], name: 'm-alpha' }), ['duplicate-mutant']),
        c('a find occurring zero times', (t) => (t.MUTANTS[0].edits = [{ find: 'return 9;', replace: 'x' }]), ['find-not-once']),
        c('a find occurring twice', (t) => (t.MUTANTS[0].edits = [{ find: '// TWICE', replace: 'x' }]), ['find-not-once']),
        c('a mutant no row names and no guard names', (t) => t.MUTANTS.push(fakeMutant('m-stray', 'beta(): number', ['fake suite > converted one'])), ['unnamed-mutant']),
        c('a per-file count that differs', (t) => (t.CONVERTED_COUNTS[FAKE_TEST] = 2), ['count-mismatch']),
        c('a count for a file with no rows', (t) => (t.CONVERTED_COUNTS['test/unit/other.test.ts'] = 1), ['count-mismatch']),
        c('a mutant whose expected lacks the row title', (t) => (t.MUTANTS[0].expected = ['fake suite > converted two']), ['mutant-not-expecting-row']),
        c('a mutant that runs another test file', (t) => (t.MUTANTS[0].testFile = 'test/unit/other.test.ts'), ['mutant-wrong-file']),
        c('a wiring mutant whose Test NN differs', (t) => (t.WIRING_MUTANTS[0].expected = ['23']), ['mutant-not-expecting-row']),
        // Summary rules.
        c('a summary missing a RED-OK line', () => undefined, [], BASE_SUMMARY.replace(/^RED-OK m-alpha.*$/m, ''), ['summary-missing-red-ok']),
        c('a summary missing an AC-38 removed: line', () => undefined, [], BASE_SUMMARY.replace(/^- AC-38.*$/m, ''), ['summary-missing-removed']),
        c('an AC-38 line for a longer title only', () => undefined, [], BASE_SUMMARY.replace('AC-38 removed: old two —', 'AC-38 removed: old two extra —'), ['summary-missing-removed']),
        // Guard rules.
        g(
            'a guard naming a missing mutant',
            (t) => {
                t.MUTANTS.pop();
                t.GUARD_MUTANTS[0].mutant = 'ghost';
            },
            ['guard-missing-mutant'],
            GUARD_SUMMARY,
            ['summary-guard-unknown'],
        ),
        g('the same mutant in two guard rows', (t) => t.GUARD_MUTANTS.push({ ...t.GUARD_MUTANTS[0] }), ['guard-duplicate']),
        g('a guard whose mutant a converted row also names', (t) => t.CONVERTED_TESTS[0].mutants?.push('m-guard'), ['guard-mutant-named-by-row', 'mutant-not-expecting-row'], GUARD_SUMMARY, ['summary-missing-red-ok']),
        g('a guard whose mutant expected differs from [guardedTitle]', (t) => t.MUTANTS[1].expected.push('fake suite > converted one'), ['guard-expected-mismatch']),
        g(
            'a guardedTitle misspelled in both the guard and expected (only the AST check sees it)',
            (t) => {
                t.GUARD_MUTANTS[0].guardedTitle = 'fake suite > behaviour guard';
                t.MUTANTS[1].expected = ['fake suite > behaviour guard'];
            },
            ['guard-title-not-found'],
            GUARD_SUMMARY.replace('behavior guard`', 'behaviour guard`'),
        ),
        g(
            'a guardedTitle that is a skipped test',
            (t) => {
                t.GUARD_MUTANTS[0].guardedTitle = 'fake suite > skipped guard';
                t.MUTANTS[1].expected = ['fake suite > skipped guard'];
            },
            ['guard-title-not-found'],
            GUARD_SUMMARY.replace('behavior guard`', 'skipped guard`'),
        ),
        g(
            'a guardedTitle under a non-literal describe level',
            (t) => {
                t.GUARD_MUTANTS[0].guardedTitle = 'dynamic guard';
                t.MUTANTS[1].expected = ['dynamic guard'];
            },
            ['guard-title-not-found'],
            GUARD_SUMMARY.replace('fake suite > behavior guard`', 'dynamic guard`'),
        ),
        g(
            "a guardedTitle that is a converted row's title",
            (t) => {
                t.GUARD_MUTANTS[0].guardedTitle = 'fake suite > converted one';
                t.MUTANTS[1].expected = ['fake suite > converted one'];
            },
            ['guard-title-is-converted'],
            GUARD_SUMMARY.replace('behavior guard`', 'converted one`'),
        ),
        g('a convertedTitle that is no row of that test file', (t) => (t.GUARD_MUTANTS[0].convertedTitle = 'fake suite > not a row'), ['guard-converted-unknown']),
        g('a guard with an empty reason', (t) => (t.GUARD_MUTANTS[0].reason = ''), ['guard-empty-reason']),
        g('a summary missing a guard RED-OK line', () => undefined, [], BASE_SUMMARY, ['summary-missing-guard-red-ok']),
    ];
}

function codes(problems: Problem[]): string[] {
    return [...new Set(problems.map((x) => x.code))].sort();
}

function selfTest(): number {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-red-proof-selftest-'));
    try {
        for (const [rel, text] of [
            [FAKE_TEST, FAKE_TEST_TEXT],
            [FAKE_SRC, FAKE_SRC_TEXT],
        ]) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), text);
        }
        const cases = selfTestCases();
        let failures = 0;
        for (const tc of cases) {
            const m = checkManifest(tc.tables, root);
            const s = checkSummaries(tc.tables, [{ name: 'summary.md', text: tc.summary }]);
            const gotM = codes(m.problems);
            const gotS = codes(s.problems);
            const wantM = [...tc.manifest].sort();
            const wantS = [...tc.summaries].sort();
            let ok = sameList(gotM, wantM) && sameList(gotS, wantS);
            if (ok && tc.totals) ok = m.rows === tc.totals.rows && m.files === tc.totals.files && m.guards === tc.totals.guards;
            if (!ok) {
                failures += 1;
                console.error(
                    `SELF-TEST-FAIL ${tc.name}: manifest ${JSON.stringify(gotM)} (want ${JSON.stringify(wantM)}), summaries ${JSON.stringify(gotS)} (want ${JSON.stringify(wantS)}), totals rows ${m.rows} files ${m.files} guards ${m.guards}` +
                        `\n  ${[...m.problems, ...s.problems].map((x) => `${x.code}: ${x.detail}`).join('\n  ')}`,
                );
            } else {
                const what = wantM.length + wantS.length === 0 ? `passes (rows ${m.rows} files ${m.files} guards ${m.guards})` : `fails with ${[...wantM, ...wantS].join(', ')}`;
                console.log(`case ok: ${tc.name} -> ${what}`);
            }
        }
        if (failures > 0) {
            console.error(`SELF-TEST-FAIL ${failures} of ${cases.length} cases`);
            return 1;
        }
        console.log(`SELF-TEST-OK cases ${cases.length}`);
        return 0;
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function cliCheckManifest(): number {
    const r = checkManifest(liveTables(), REPO_ROOT);
    if (r.problems.length > 0) {
        for (const x of r.problems) console.error(`MANIFEST-FAIL ${x.code}: ${x.detail}`);
        return 1;
    }
    console.log(`MANIFEST-OK rows ${r.rows} files ${r.files} guards ${r.guards}`);
    return 0;
}

function cliCheckSummaries(paths: string[]): number {
    const docs = paths.map((p) => {
        const abs = path.resolve(p);
        if (!fs.statSync(abs).isFile()) throw new Error(`not a file: ${p}`);
        return { name: p, text: fs.readFileSync(abs, 'utf8') };
    });
    const r = checkSummaries(liveTables(), docs);
    if (r.problems.length > 0) {
        for (const x of r.problems) console.error(`SUMMARIES-FAIL ${x.code}: ${x.detail}`);
        return 1;
    }
    console.log(`SUMMARIES-OK red-ok ${r.redOk} removed ${r.removed}`);
    return 0;
}

function cliGroup(name: string): number {
    const rows = MUTANTS.filter((m) => m.group === name);
    if (rows.length === 0) throw new Error(`no MUTANTS rows in group ${JSON.stringify(name)}`);
    return runGroup(rows).ok ? 0 : 1;
}

const USAGE = 'usage: red-proof-conversions.ts --self-proof | --self-test | --group <name> | --check-manifest | --check-summaries <path>...';

function main(): void {
    const argv = process.argv.slice(2);
    try {
        const [mode, ...rest] = argv;
        let code: number;
        if (mode === '--self-proof' && rest.length === 0) code = selfProof();
        else if (mode === '--self-test' && rest.length === 0) code = selfTest();
        else if (mode === '--check-manifest' && rest.length === 0) code = cliCheckManifest();
        else if (mode === '--check-summaries' && rest.length > 0) code = cliCheckSummaries(rest);
        else if (mode === '--group' && rest.length === 1 && rest[0] !== '') code = cliGroup(rest[0]);
        else {
            console.error(USAGE);
            code = 2;
        }
        process.exit(code);
    } catch (e) {
        console.error(`red-proof-conversions: ${(e as Error).stack ?? e}`);
        process.exit(2);
    }
}

if (require.main === module) main();
