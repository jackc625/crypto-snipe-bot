// scripts/check-recordings-compared.ts
//
// Phase 23 / Plan 23-33 (AUDIT-06; closes the gap plan 23-25 recorded; operator ruling 2026-11-12,
// "Fix now, small plan (Recommended)"). The commit check (scripts/check-commit-taxonomy.ts)
// protects each recording FILE, but a commit can point a scenario test at a brand-new recording
// name and add that file: the commit is a plain add and passes, and the old recording stays in
// place, unchanged and never read again. This check closes that route: after a full realpath run
// it fails when any committed recording was not compared in that run.
//
// What it reads:
//   - the recordings: the files git tracks under test/realpath/recordings/ (git ls-files, the
//     index). A recording is a tracked file whose name ends in .jsonl or .json, the only two
//     extensions compareRecording accepts (test/realpath/harness/serializer.ts
//     resolveRecordingPath): the scenario files <name>.jsonl and the env snapshot env/<VAR>.json
//     with env/_baseline.json. Any other tracked file there (today only the folder's
//     .gitattributes) cannot be compared and is listed as "not a recording". A tracked path under a
//     letter-case variant of the folder (test/realpath/RECORDINGS/...) is a violation: on the
//     operator's Windows checkout it is the same folder, and the serializer could never name it;
//   - the run's comparison record: compareRecording appends, for every call against the real
//     recordings folder, once the compare has decided, one line
//     {"path":<path relative to that folder>,"result":"match"|"written"|"differs"|"absent"|"error"}
//     (Phase 23 review WR-28: the outcome, not just the call) to
//     <os.tmpdir()>/crypto-snipe-bot-recordings-compared/<run id>/<pid>-<token>.txt (one file per
//     loaded copy of the serializer, token 8 random hex digits). The run id
//     is the rails' CSB_RAIL_RUN_ID: test/rails/ledgerRun.ts (the globalSetup of every project)
//     adopts it from the environment or generates run-<UTC stamp>-<pid>-<6 hex> and sets it in the
//     Vitest main process before any worker starts, so all workers of ONE vitest invocation share
//     one id and every invocation gets its own. The record is outside the rail ledger folder.
//
// The rule (exit 1, each path named): every recording was compared with a 'match' at least once in
// the judged run, no call in the run ended in any other outcome (a 'differs' or 'absent' the test
// caught, a 'written' re-record, an 'error'), and every compared path is a tracked recording
// (WR-28: a call is not a comparison; a scenario that "compares" the old recording and swallows the
// mismatch fails here naming it).
//
// Which run it judges: exactly one, never guessed and never the newest folder.
//   --run-id <id>     the run with that id;
//   --run-log <file>  the run named by a vitest invocation's own captured output: the rails print
//                     "[SAFE-02 rails] run <id> — project <name> — ledger ..." when a project starts
//                     and "... project <name> finished — summary ..." when it ends. The log must
//                     name one run id only, and must show the realpath project both starting and
//                     finishing in it. The orchestrator's wave gate passes the log of its own single
//                     full-suite invocation;
//   --sole-run        CI only (CI must be set): the record folder must hold exactly one run. A
//                     GitHub-hosted runner starts every job on a new machine, and in the test job
//                     only the `npm run test:realpath` step runs the realpath project (the unit and
//                     integration projects compare no real recording, and this check's own
//                     --self-test writes only under temp folders it makes), so the one run there is
//                     the run that step just made. Zero runs or more than one is exit 2, never a
//                     pick. Outside CI use --run-id or --run-log.
// Records from any other run are never read, so a stale record cannot satisfy the check: if the
// judged run left no record, that is exit 2 even when an earlier run's record is complete.
//
// Scope: the check is for a run that executed every realpath test (CI's `npm run test:realpath`
// step, the wave gate's full suite). A filtered run (a file or -t filter) compares only some
// recordings and fails here by design; that is why this is a separate step and not part of the
// test run, so normal filtered developer runs are unaffected.
//
// Usage (Node 22.16.0, D-21):
//   npm run check:recordings-compared -- --run-id <id> | --run-log <file> | --sole-run
//   node node_modules/ts-node/dist/bin.js scripts/check-recordings-compared.ts --self-test
//   --self-test   every rule on throwaway repos and record folders under the OS temp folder, and the
//                 real serializer source loaded under a temp mirror of the repo layout; the real
//                 repository, its recordings and the real record folder are never written
//   --help        this text
// Exit codes: 0 pass, 1 a recording not compared (or a compared path not tracked), 2 usage error,
// wrong Node, no record for the judged run, an empty or broken record, no tracked recording, or a
// git failure (a broken scan is never a pass).

if (process.versions.modules !== '127') {
    console.error(`check-recordings-compared requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}).`);
    process.exit(2);
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import * as crypto from 'crypto';

/** A bad argument, or a run or repository the check cannot judge. Exit 2. */
class UsageError extends Error {}

const REPO_ROOT = path.resolve(__dirname, '..');
/** The recordings folder, repo-relative with a trailing slash. */
export const RECORDINGS_PREFIX = 'test/realpath/recordings/';
/** Must equal COMPARED_RECORD_DIRNAME in test/realpath/harness/serializer.ts (the self-test checks). */
export const RECORD_DIRNAME = 'crypto-snipe-bot-recordings-compared';
/** The rails' run-id rule (test/rails/core.cjs, test/rails/ledgerRun.ts). */
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** <pid>-<token>.txt, as the serializer names a record file (token: 8 lower-case hex digits). */
const RECORD_FILE_RE = /^[0-9]+-[0-9a-f]{8}\.txt$/;
const RECORDING_EXT_RE = /\.(?:jsonl|json)$/;
/** The outcomes compareRecording records (test/realpath/harness/serializer.ts RecordedOutcome, WR-28). */
export const OUTCOMES = ['match', 'written', 'differs', 'absent', 'error'] as const;
export type Outcome = (typeof OUTCOMES)[number];
/** What each outcome other than 'match' means for the judged run (the violation line's tail). */
const NOT_A_MATCH: Record<Exclude<Outcome, 'match'>, { label: string; why: string }> = {
    written: { label: 'WRITTEN', why: 're-recorded in this run (an update run), so not compared' },
    differs: { label: 'DIFFERS', why: 'the bytes differed (a mismatch the test caught still counts)' },
    absent: { label: 'ABSENT', why: 'compared while no recording existed there' },
    error: { label: 'ERROR', why: 'the compare refused or failed' },
};

const SCOPE_LINE =
    'scope: one run that executed every realpath test (CI npm run test:realpath, the wave gate full suite); ' +
    'a filtered run compares only some recordings and fails here by design';

const HELP = [
    'usage: check-recordings-compared.ts --run-id <id> | --run-log <file> | --sole-run | --self-test | --help',
    '',
    'Fails (exit 1) when a recording git tracks under test/realpath/recordings/ (a scenario <name>.jsonl',
    'or an env snapshot env/<VAR>.json) was not compared with a match by compareRecording in the judged',
    'run, when any call in the run ended in another outcome (differs, absent, written, error), or when',
    'the run compared a path git does not track there. Judges exactly one run:',
    '  --run-id <id>     the run with that CSB_RAIL_RUN_ID',
    '  --run-log <file>  the one run named by a vitest invocation\'s captured output (the realpath',
    '                    project must start and finish in it)',
    '  --sole-run        CI only: the record folder must hold exactly one run',
    `Records: <os.tmpdir()>/${RECORD_DIRNAME}/<run id>/<pid>-<token>.txt.`,
    'Run it after a run that executed every realpath test (CI npm run test:realpath, the wave gate',
    'full suite). A filtered run compares only some recordings and fails here by design.',
    'Exit codes: 0 pass, 1 violation, 2 usage error or broken scan (no record for the run, an empty or',
    'broken record, no tracked recording, git failure).',
].join('\n');

export function defaultRecordsRoot(): string {
    return path.join(os.tmpdir(), RECORD_DIRNAME);
}

// ---------------------------------------------------------------------------
// git: argument arrays only, plumbing only, the caller's GIT_* variables dropped
// ---------------------------------------------------------------------------

function readGitEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_OPTIONAL_LOCKS = '0';
    env.GIT_NO_REPLACE_OBJECTS = '1';
    env.GIT_NO_LAZY_FETCH = '1';
    return env;
}

interface GitResult {
    status: number;
    stdout: Buffer;
    stderr: string;
}

function gitRun(root: string, args: string[], env: NodeJS.ProcessEnv, input?: string): GitResult {
    const r = cp.spawnSync('git', ['-C', root, ...args], { env, input, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new UsageError(`git ${args[0]} could not run: ${r.error.message}`);
    return { status: r.status ?? -1, stdout: r.stdout ?? Buffer.alloc(0), stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8') };
}

function lsFiles(root: string, spec: string, env: NodeJS.ProcessEnv): string[] {
    const r = gitRun(root, ['ls-files', '-z', '--full-name', '--', spec], env);
    if (r.status !== 0) throw new UsageError(`git ls-files failed (exit ${r.status}): ${r.stderr.trim()}`);
    const f = r.stdout.toString('utf8').split('\0');
    if (f.length && f[f.length - 1] === '') f.pop();
    return f;
}

// ---------------------------------------------------------------------------
// The tracked recordings
// ---------------------------------------------------------------------------

export interface Tracked {
    /** Paths relative to the recordings folder, sorted. */
    recordings: string[];
    /** Tracked files there that are not recordings (cannot be compared), relative, sorted. */
    others: string[];
    /** Tracked repo paths under a letter-case variant of the folder, sorted. */
    caseVariants: string[];
}

export function trackedRecordings(repoRoot: string, gitEnv: NodeJS.ProcessEnv): Tracked {
    // Root check first, so a wrong folder is a clear exit 2 rather than an empty list.
    const top = gitRun(repoRoot, ['rev-parse', '--show-toplevel'], gitEnv);
    if (top.status !== 0) throw new UsageError(`${repoRoot} is not a git working tree: ${top.stderr.trim()}`);
    const exact = lsFiles(repoRoot, `:(top,literal)${RECORDINGS_PREFIX}`, gitEnv).filter((p) => p.startsWith(RECORDINGS_PREFIX));
    const exactSet = new Set(exact);
    const caseVariants = lsFiles(repoRoot, `:(top,icase)${RECORDINGS_PREFIX}`, gitEnv).filter((p) => !exactSet.has(p)).sort();
    const recordings: string[] = [];
    const others: string[] = [];
    for (const p of exact) {
        const rel = p.slice(RECORDINGS_PREFIX.length);
        (RECORDING_EXT_RE.test(rel) ? recordings : others).push(rel);
    }
    return { recordings: recordings.sort(), others: others.sort(), caseVariants };
}

// ---------------------------------------------------------------------------
// One run's comparison record
// ---------------------------------------------------------------------------

export interface RunRecord {
    runId: string;
    dir: string;
    files: number;
    calls: number;
    /** Compared path -> number of compareRecording calls. */
    paths: Map<string, number>;
    /** Compared path -> outcome -> number of calls that ended in it (WR-28). */
    outcomes: Map<string, Map<Outcome, number>>;
}

function validRunId(id: string, what: string): string {
    if (typeof id !== 'string' || !RUN_ID_RE.test(id)) throw new UsageError(`${what} ${JSON.stringify(id)} is not a valid run id ([A-Za-z0-9._-], max 128, starting with a letter or digit)`);
    return id;
}

/** A path as the serializer records it: relative, forward slashes, no empty / . / .. segment, .jsonl or .json. */
function safeRecordedPath(p: string): boolean {
    if (p === '' || p.includes('\\') || p.startsWith('/') || /^[A-Za-z]:/.test(p) || /[\u0000-\u001f]/.test(p)) return false;
    if (p.split('/').some((s) => s === '' || s === '.' || s === '..')) return false;
    return RECORDING_EXT_RE.test(p);
}

export function readRunRecord(root: string, runId: string): RunRecord {
    validRunId(runId, 'run id');
    const dir = path.join(root, runId);
    let st: fs.Stats | null = null;
    try {
        st = fs.statSync(dir);
    } catch {
        st = null;
    }
    if (!st || !st.isDirectory()) {
        throw new UsageError(
            `no comparison record for run ${runId} (${dir} does not exist): that run made no compareRecording call against the real recordings folder ` +
                '(not a realpath run, a run without the rails\' CSB_RAIL_RUN_ID, or a filtered run that compared nothing). Records of other runs are never used.',
        );
    }
    const names = fs.readdirSync(dir, { withFileTypes: true });
    const paths = new Map<string, number>();
    const outcomes = new Map<string, Map<Outcome, number>>();
    let files = 0;
    let calls = 0;
    for (const e of names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        if (!e.isFile() || !RECORD_FILE_RE.test(e.name)) throw new UsageError(`unexpected entry ${JSON.stringify(e.name)} in the record of run ${runId} (only <pid>-<token>.txt files belong there)`);
        const text = fs.readFileSync(path.join(dir, e.name), 'utf8');
        if (text === '') throw new UsageError(`record file ${e.name} of run ${runId} is empty`);
        if (!text.endsWith('\n')) throw new UsageError(`record file ${e.name} of run ${runId} ends in an incomplete line`);
        files += 1;
        const lines = text.slice(0, -1).split('\n');
        lines.forEach((line, i) => {
            let v: unknown;
            try {
                v = JSON.parse(line);
            } catch {
                throw new UsageError(`record file ${e.name} of run ${runId}, line ${i + 1}: not JSON: ${JSON.stringify(line.slice(0, 120))}`);
            }
            // WR-28: {"path","result"} exactly; a bare path (a serializer from before WR-28) cannot be judged.
            const rec = v as { path?: unknown; result?: unknown } | null;
            const keys = rec !== null && typeof rec === 'object' && !Array.isArray(rec) ? Object.keys(rec).sort().join(',') : '';
            if (keys !== 'path,result' || typeof rec!.result !== 'string' || !(OUTCOMES as readonly string[]).includes(rec!.result)) {
                throw new UsageError(`record file ${e.name} of run ${runId}, line ${i + 1}: ${JSON.stringify(line.slice(0, 120))} is not a {path, result} record (result one of ${OUTCOMES.join(', ')})`);
            }
            const p = rec!.path;
            if (typeof p !== 'string' || !safeRecordedPath(p)) throw new UsageError(`record file ${e.name} of run ${runId}, line ${i + 1}: ${JSON.stringify(line.slice(0, 120))} is not a recording path relative to the folder`);
            const result = rec!.result as Outcome;
            paths.set(p, (paths.get(p) ?? 0) + 1);
            const byResult = outcomes.get(p) ?? new Map<Outcome, number>();
            byResult.set(result, (byResult.get(result) ?? 0) + 1);
            outcomes.set(p, byResult);
            calls += 1;
        });
    }
    if (files === 0 || calls === 0) throw new UsageError(`the record of run ${runId} (${dir}) holds no comparison`);
    return { runId, dir, files, calls, paths, outcomes };
}

// ---------------------------------------------------------------------------
// Choosing the run
// ---------------------------------------------------------------------------

export interface Selection {
    runId: string;
    how: string;
}

const RAILS_LINE_RE = /\[SAFE-02 rails\] run (\S+) \S+ project (\S+?)( finished)? \S+ (ledger|summary) /g;

/** The one run a vitest invocation's captured output names, with the realpath project started and finished in it. */
export function runIdFromLog(file: string): string {
    let text: string;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (e) {
        throw new UsageError(`--run-log ${JSON.stringify(file)} cannot be read: ${e instanceof Error ? e.message : String(e)}`);
    }
    const ids = new Set<string>();
    let started = false;
    let finished = false;
    for (const m of text.matchAll(RAILS_LINE_RE)) {
        ids.add(m[1]);
        if (m[2] === 'realpath' && !m[3] && m[4] === 'ledger') started = true;
        if (m[2] === 'realpath' && m[3] && m[4] === 'summary') finished = true;
    }
    // Any other "[SAFE-02 rails] run <id>" mention also counts towards the one-run rule.
    for (const m of text.matchAll(/\[SAFE-02 rails\] run (\S+)/g)) ids.add(m[1]);
    if (ids.size === 0) throw new UsageError(`--run-log ${JSON.stringify(file)} names no run (no "[SAFE-02 rails] run <id>" line): not the output of a railed vitest invocation`);
    if (ids.size > 1) throw new UsageError(`--run-log ${JSON.stringify(file)} names ${ids.size} runs (${[...ids].sort().join(', ')}); it must be the output of one vitest invocation`);
    const [id] = [...ids];
    if (!started) throw new UsageError(`--run-log ${JSON.stringify(file)}: run ${id} did not run the realpath project (no "project realpath" start line)`);
    if (!finished) throw new UsageError(`--run-log ${JSON.stringify(file)}: the realpath project of run ${id} did not finish (no "project realpath finished" line)`);
    return validRunId(id, `--run-log ${JSON.stringify(file)} run id`);
}

/** CI only: the record folder must hold exactly one run. */
export function soleRunId(root: string, env: NodeJS.ProcessEnv): string {
    if (env.CI === undefined || env.CI === '') {
        throw new UsageError('--sole-run is for a CI job only (CI is not set): outside CI the record folder keeps earlier runs, so give --run-id <id> or --run-log <file>');
    }
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        throw new UsageError(`--sole-run: no record folder ${root}: no run in this job compared a recording`);
    }
    const strays = entries.filter((e) => !e.isDirectory()).map((e) => e.name);
    if (strays.length) throw new UsageError(`--sole-run: unexpected non-folder entries in ${root}: ${strays.map((s) => JSON.stringify(s)).join(', ')}`);
    const runs = entries.map((e) => e.name).sort();
    if (runs.length !== 1) {
        throw new UsageError(`--sole-run needs exactly one run in ${root}, found ${runs.length}${runs.length ? ` (${runs.join(', ')})` : ''}; give --run-id <id> to judge one`);
    }
    return validRunId(runs[0], `--sole-run run folder`);
}

// ---------------------------------------------------------------------------
// The judgement
// ---------------------------------------------------------------------------

export interface Judgement {
    tracked: Tracked;
    record: RunRecord;
    neverCompared: string[];
    /** WR-28: every recorded outcome other than 'match', per path (tracked or not), with its call count. */
    notMatched: { path: string; outcome: Exclude<Outcome, 'match'>; calls: number }[];
    /** Tracked recordings with at least one 'match' in the run. */
    matched: number;
    notTracked: string[];
    violations: number;
}

export function judge(repoRoot: string, root: string, runId: string, gitEnv: NodeJS.ProcessEnv): Judgement {
    const tracked = trackedRecordings(repoRoot, gitEnv);
    if (tracked.recordings.length === 0 && tracked.caseVariants.length === 0) {
        throw new UsageError(`git tracks no recording under ${RECORDINGS_PREFIX} in ${repoRoot}: nothing to judge`);
    }
    const record = readRunRecord(root, runId);
    const trackedSet = new Set(tracked.recordings);
    // Never called at all. A path that was called but never matched is named by its outcomes below.
    const neverCompared = tracked.recordings.filter((r) => !record.paths.has(r));
    const notMatched: Judgement['notMatched'] = [];
    for (const p of [...record.outcomes.keys()].sort()) {
        for (const o of OUTCOMES) {
            if (o === 'match') continue;
            const n = record.outcomes.get(p)!.get(o) ?? 0;
            if (n > 0) notMatched.push({ path: p, outcome: o, calls: n });
        }
    }
    const matched = tracked.recordings.filter((r) => (record.outcomes.get(r)?.get('match') ?? 0) > 0).length;
    const notTracked = [...record.paths.keys()].filter((p) => !trackedSet.has(p)).sort();
    return { tracked, record, neverCompared, notMatched, matched, notTracked, violations: neverCompared.length + notMatched.length + notTracked.length + tracked.caseVariants.length };
}

interface Say {
    log(s: string): void;
    error(s: string): void;
}

export interface GateIo {
    repoRoot: string;
    recordsRoot: string;
    env: NodeJS.ProcessEnv;
    gitEnv: NodeJS.ProcessEnv;
    say: Say;
}

function parseSelection(argv: string[], io: GateIo): Selection {
    if (argv.length === 2 && argv[0] === '--run-id') return { runId: validRunId(argv[1], '--run-id'), how: '--run-id' };
    if (argv.length === 2 && argv[0] === '--run-log') return { runId: runIdFromLog(argv[1]), how: `--run-log ${JSON.stringify(argv[1])}` };
    if (argv.length === 1 && argv[0] === '--sole-run') return { runId: soleRunId(io.recordsRoot, io.env), how: '--sole-run (the only run in this CI job)' };
    throw new UsageError(`give exactly one of --run-id <id>, --run-log <file>, --sole-run (got ${JSON.stringify(argv)}); the check never guesses which run to judge\n${HELP}`);
}

/** The gate: returns the exit code. A UsageError (exit 2) propagates to the caller. */
export function gate(argv: string[], io: GateIo): number {
    const sel = parseSelection(argv, io);
    const say = io.say;
    say.log(`check-recordings-compared: run ${sel.runId} chosen by ${sel.how}`);
    say.log(SCOPE_LINE);
    const j = judge(io.repoRoot, io.recordsRoot, sel.runId, io.gitEnv);
    const scen = j.tracked.recordings.filter((r) => !r.includes('/') && r.endsWith('.jsonl')).length;
    const envFiles = j.tracked.recordings.filter((r) => /^env\/[^/]+\.json$/.test(r)).length;
    const other = j.tracked.recordings.length - scen - envFiles;
    say.log(`record: ${j.record.dir} (${j.record.files} worker file(s), ${j.record.calls} compareRecording call(s))`);
    say.log(`tracked recordings: ${j.tracked.recordings.length} (${scen} scenario .jsonl, ${envFiles} env/*.json${other ? `, ${other} other` : ''})`);
    say.log(`not recordings (cannot be compared, not judged): ${j.tracked.others.length}${j.tracked.others.length ? ` (${j.tracked.others.map((o) => JSON.stringify(o)).join(', ')})` : ''}`);
    say.log(`compared paths: ${j.record.paths.size} distinct`);
    const tally = OUTCOMES.map((o) => `${o} ${[...j.record.outcomes.values()].reduce((n, m) => n + (m.get(o) ?? 0), 0)}`).join(', ');
    say.log(`outcomes: ${tally}; tracked recordings matched: ${j.matched} of ${j.tracked.recordings.length}`);
    for (const p of j.neverCompared) say.error(`NEVER COMPARED ${JSON.stringify(p)}: tracked under ${RECORDINGS_PREFIX} but no test compared it in run ${sel.runId}`);
    for (const m of j.notMatched) say.error(`${NOT_A_MATCH[m.outcome].label} ${JSON.stringify(m.path)}: ${m.calls} call(s) in run ${sel.runId} ended in ${m.outcome}: ${NOT_A_MATCH[m.outcome].why}`);
    for (const p of j.notTracked) say.error(`NOT TRACKED ${JSON.stringify(p)}: compared in run ${sel.runId} (${j.record.paths.get(p)} call(s)) but git does not track ${RECORDINGS_PREFIX}${p}`);
    for (const p of j.tracked.caseVariants) say.error(`CASE VARIANT ${JSON.stringify(p)}: tracked under a letter-case variant of ${RECORDINGS_PREFIX}`);
    say.log(j.violations ? `RESULT FAIL (${j.violations} violation(s))` : `RESULT PASS (tracked ${j.tracked.recordings.length}, compared ${j.record.paths.size})`);
    return j.violations ? 1 : 0;
}

function realIo(): GateIo {
    return { repoRoot: REPO_ROOT, recordsRoot: defaultRecordsRoot(), env: process.env, gitEnv: readGitEnv(), say: console };
}

/** gate() with a UsageError turned into exit 2, as the CLI reports it. */
export function gateCode(argv: string[], io: GateIo): number {
    try {
        return gate(argv, io);
    } catch (e) {
        if (!(e instanceof UsageError)) throw e;
        io.say.error(`check-recordings-compared: ${e.message}`);
        io.say.log('RESULT BROKEN (exit 2)');
        return 2;
    }
}

// ---------------------------------------------------------------------------
// Self-test: every rule on throwaway repos and record folders under the OS temp folder, and the
// real serializer source under a temp mirror of the repo layout. Each repo has its own local
// user.name / user.email, reads no system or global git config and runs no hooks, and is removed
// in a finally; the real repository, its recordings and the real record folder are never written.
// ---------------------------------------------------------------------------

interface CaseOutcome {
    name: string;
    ok: boolean;
    detail: string;
}

const posix = (p: string) => p.split(path.sep).join('/');

class Fixture {
    readonly dir: string;
    readonly env: NodeJS.ProcessEnv;
    private readonly cfgDir: string;

    constructor(prefix: string) {
        this.dir = fs.mkdtempSync(path.join(os.tmpdir(), `csb-recordings-compared-${prefix}-`));
        this.cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-recordings-compared-gitcfg-'));
        const emptyGlobal = path.join(this.cfgDir, 'empty.gitconfig');
        const hooks = path.join(this.cfgDir, 'hooks');
        fs.writeFileSync(emptyGlobal, '');
        fs.mkdirSync(hooks);
        this.env = { ...readGitEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGlobal };
        this.git('-c', 'init.defaultBranch=main', 'init', '-q');
        this.git('config', '--local', 'user.name', 'recordings-compared-selftest');
        this.git('config', '--local', 'user.email', 'recordings-compared-selftest@example.invalid');
        this.git('config', '--local', 'commit.gpgsign', 'false');
        this.git('config', '--local', 'core.autocrlf', 'false');
        this.git('config', '--local', 'core.hooksPath', posix(hooks));
    }

    git(...args: string[]): string {
        return this.gitInput(undefined, ...args);
    }

    gitInput(input: string | undefined, ...args: string[]): string {
        const r = gitRun(this.dir, args, this.env, input);
        if (r.status !== 0) throw new Error(`self-test git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr.trim()}`);
        return r.stdout.toString('utf8').trim();
    }

    put(rel: string, text: string): void {
        const p = path.join(this.dir, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
    }

    commit(subject: string): string {
        this.git('add', '-A');
        this.git('commit', '-q', '-m', subject);
        return this.git('rev-parse', 'HEAD');
    }

    cleanup(): void {
        fs.rmSync(this.dir, { recursive: true, force: true });
        fs.rmSync(this.cfgDir, { recursive: true, force: true });
    }
}

const REC = RECORDINGS_PREFIX;

/** A repo with the usual shape: the .gitattributes, two scenarios, the env baseline and one env case. */
function standardRepo(prefix: string): Fixture {
    const fx = new Fixture(prefix);
    fx.put('src/app.ts', 'export const a = 1;\n');
    fx.put(`${REC}.gitattributes`, '* text=auto eol=lf\n');
    fx.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\n{"submitted":[]}\n');
    fx.put(`${REC}b.jsonl`, '{"scenario":"b","tag":"KEEP"}\n{"submitted":[]}\n');
    fx.put(`${REC}env/_baseline.json`, '{"baseline":true}\n');
    fx.put(`${REC}env/FOO.json`, '{"variable":"FOO"}\n');
    fx.commit('test: first recordings');
    return fx;
}

const ALL_STANDARD = ['a.jsonl', 'b.jsonl', 'env/_baseline.json', 'env/FOO.json'];

/**
 * A run's record in the serializer's format (case serializer-* proves the formats agree): a plain
 * path is a call that matched; [path, outcome] is a call with that outcome (WR-28).
 */
function writeRecord(root: string, runId: string, files: Record<string, (string | [string, Outcome])[]>): void {
    const dir = path.join(root, runId);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, lines] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), lines.map((l) => `${JSON.stringify(typeof l === 'string' ? { path: l, result: 'match' } : { path: l[0], result: l[1] })}\n`).join(''));
    }
}

function tempRoot(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `csb-recordings-compared-${prefix}-`));
}

function captureIo(repoRoot: string, recordsRoot: string, gitEnv: NodeJS.ProcessEnv, env: NodeJS.ProcessEnv = {}): { io: GateIo; out: string[] } {
    const out: string[] = [];
    const say: Say = { log: (s) => out.push(s), error: (s) => out.push(s) };
    return { io: { repoRoot, recordsRoot, env, gitEnv, say }, out };
}

function runCase(fx: Fixture, root: string, argv: string[], env: NodeJS.ProcessEnv = {}): { code: number; out: string[] } {
    const { io, out } = captureIo(fx.dir, root, fx.env, env);
    return { code: gateCode(argv, io), out };
}

function expectRun(name: string, r: { code: number; out: string[] }, code: number, must: RegExp[], mustNot: RegExp[] = []): CaseOutcome {
    const text = r.out.join(' | ');
    const missing = must.filter((re) => !r.out.some((l) => re.test(l)));
    const present = mustNot.filter((re) => r.out.some((l) => re.test(l)));
    const ok = r.code === code && missing.length === 0 && present.length === 0;
    const why = r.code !== code ? `expected exit ${code}, got ${r.code}` : missing.length ? `missing ${missing.join(', ')}` : present.length ? `unexpected ${present.join(', ')}` : '';
    return { name, ok, detail: ok ? `exit ${r.code}: ${text}` : `${why}: ${text}` };
}

// --- the real serializer, loaded from its real source under a temp mirror of the repo layout ---

interface SerializerModule {
    RECORDINGS_DIR: string;
    UPDATE_SWITCH: string;
    UPDATE_TOKEN_PREFIX: string;
    COMPARED_RECORD_DIRNAME: string;
    compareRecording(relPath: string, text: string, opts?: { dir?: string }): 'match' | 'written';
}

interface NodeModuleCtor {
    new (id: string, parent?: unknown): { filename: string; paths: string[]; exports: unknown; _compile(code: string, filename: string): void };
    _nodeModulePaths(dir: string): string[];
}

const SERIALIZER_REL = path.join('test', 'realpath', 'harness', 'serializer.ts');

/**
 * Compile the real serializer source (read from this repo) as a fresh CommonJS module whose own
 * file name sits in `mirrorRoot`, so its RECORDINGS_DIR is <mirrorRoot>/test/realpath/recordings
 * and no call can reach the real recordings. Bare imports (ethers) resolve from this repo's
 * node_modules. `import.meta.url` (the only ESM-only construct; Vitest runs the file as ESM) is
 * replaced by the module's file URL, and the self-test fails if the source no longer has that shape.
 */
function loadSerializer(mirrorRoot: string): SerializerModule {
    const realFile = path.join(REPO_ROOT, SERIALIZER_REL);
    const file = path.join(mirrorRoot, SERIALIZER_REL);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ts = require('typescript') as typeof import('typescript');
    const src = fs.readFileSync(realFile, 'utf8');
    const parts = src.split('import.meta.url');
    if (parts.length < 2) throw new Error('self-test: serializer.ts no longer uses import.meta.url; update loadSerializer');
    const shimmed = parts.join('__csbSelfTestModuleUrl');
    if (shimmed.includes('import.meta')) throw new Error('self-test: serializer.ts uses import.meta beyond import.meta.url; update loadSerializer');
    const out = ts.transpileModule(shimmed, {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        reportDiagnostics: true,
    });
    if (out.diagnostics && out.diagnostics.length) throw new Error(`self-test: serializer.ts does not transpile: ${out.diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`);
    const code = `"use strict";\nconst __csbSelfTestModuleUrl = require('url').pathToFileURL(__filename).href;\n${out.outputText}`;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('module') as NodeModuleCtor;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const m = new NodeModule(file, module);
    m.filename = file;
    m.paths = NodeModule._nodeModulePaths(path.dirname(realFile));
    m._compile(code, file);
    return m.exports as SerializerModule;
}

/**
 * Run fn with the given environment entries set (undefined deletes) and stderr captured, then
 * restore both. TEMP / TMP / TMPDIR always point at `tmp`, so os.tmpdir() (and the serializer's
 * record folder) is a temp folder of this case, never the real one.
 */
function withProcess<T>(tmp: string, patch: Record<string, string | undefined>, fn: (stderr: string[]) => T): T {
    const all: Record<string, string | undefined> = { TEMP: tmp, TMP: tmp, TMPDIR: tmp, ...patch };
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(all)) saved[k] = process.env[k];
    const stderr: string[] = [];
    const origWrite = process.stderr.write;
    for (const [k, v] of Object.entries(all)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    process.stderr.write = ((chunk: unknown) => {
        stderr.push(String(chunk));
        return true;
    }) as typeof process.stderr.write;
    try {
        return fn(stderr);
    } finally {
        process.stderr.write = origWrite;
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

function mirror(prefix: string): { base: string; repo: string; rec: string; tmp: string } {
    const base = tempRoot(prefix);
    const repo = path.join(base, 'repo');
    const rec = path.join(repo, 'test', 'realpath', 'recordings');
    const tmp = path.join(base, 'tmp');
    fs.mkdirSync(path.join(rec, 'env'), { recursive: true });
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(rec, 'a.jsonl'), '{"scenario":"a","tag":"KEEP"}\n{"submitted":[]}\n');
    fs.writeFileSync(path.join(rec, 'env', '_baseline.json'), '{"baseline":true}\n');
    return { base, repo, rec, tmp };
}

/**
 * WR-36: a live update token for the serializer under test, as scripts/update-recordings.ts makes one:
 * 32 hex digits and <os.tmpdir()>/<prefix><token> naming this process. Called inside withProcess, so
 * os.tmpdir() is the case's own temp folder (removed with it).
 */
function liveUpdateToken(ser: SerializerModule): string {
    const token = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(os.tmpdir(), `${ser.UPDATE_TOKEN_PREFIX}${token}`), JSON.stringify({ pid: process.pid, token }));
    return token;
}

function throwsWith(fn: () => unknown, re: RegExp): boolean {
    try {
        fn();
        return false;
    } catch (e) {
        return re.test(e instanceof Error ? e.message : String(e));
    }
}

function selfTestCases(): CaseOutcome[] {
    const out: CaseOutcome[] = [];
    const caseRun = (name: string, fn: () => CaseOutcome) => {
        try {
            out.push(fn());
        } catch (e) {
            out.push({ name, ok: false, detail: `crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}` });
        }
    };
    const realRoot = defaultRecordsRoot();
    const realRunDirAbsent = (id: string) => !fs.existsSync(path.join(realRoot, id));

    // ---- the serializer half (the real source) ----

    caseRun('serializer-records-each-real-folder-call-for-the-run-in-compare-and-update-runs', () => {
        const name = 'serializer-records-each-real-folder-call-for-the-run-in-compare-and-update-runs';
        const m = mirror('ser-record');
        try {
            const ser = loadSerializer(m.repo);
            const runId = 'selftest-serializer-record';
            const a = fs.readFileSync(path.join(m.rec, 'a.jsonl'), 'utf8');
            const base = fs.readFileSync(path.join(m.rec, 'env', '_baseline.json'), 'utf8');
            const problems: string[] = [];
            const results = withProcess(m.tmp, { CSB_RAIL_RUN_ID: runId, CI: undefined, [ser.UPDATE_SWITCH]: undefined }, (stderr) => {
                const r: unknown[] = [];
                r.push(ser.compareRecording('a.jsonl', a));
                r.push(ser.compareRecording('env/../a.jsonl', a));
                r.push(ser.compareRecording('env/_baseline.json', base));
                r.push(throwsWith(() => ser.compareRecording('a.jsonl', `${a}{"changed":true}\n`), /a\.jsonl differs/));
                r.push(throwsWith(() => ser.compareRecording('c.jsonl', a), /no recording at c\.jsonl/));
                r.push(ser.compareRecording('a.jsonl', a, { dir: ser.RECORDINGS_DIR }));
                process.env[ser.UPDATE_SWITCH] = liveUpdateToken(ser);
                r.push(ser.compareRecording('env/NEW.json', '{"new":true}\n'));
                process.env.CI = 'true';
                r.push(throwsWith(() => ser.compareRecording('a.jsonl', `${a}{"ci":true}\n`), /a\.jsonl differs/));
                const wrote = stderr.join('');
                // The one write says so on stderr (WR-36), and nothing else is written there.
                if (wrote !== '[recordings] WROTE env/NEW.json (update run)\n') problems.push(`stderr: ${wrote}`);
                return r;
            });
            const want = ['match', 'match', 'match', true, true, 'match', 'written', true];
            if (JSON.stringify(results) !== JSON.stringify(want)) problems.push(`compare results ${JSON.stringify(results)}, expected ${JSON.stringify(want)}`);
            if (fs.readFileSync(path.join(m.rec, 'a.jsonl'), 'utf8') !== a) problems.push('a.jsonl was rewritten');
            if (fs.readFileSync(path.join(m.rec, 'env', 'NEW.json'), 'utf8') !== '{"new":true}\n') problems.push('the update-mode write did not happen');
            if (ser.COMPARED_RECORD_DIRNAME !== RECORD_DIRNAME) problems.push(`serializer record folder ${ser.COMPARED_RECORD_DIRNAME} != check ${RECORD_DIRNAME}`);
            const root = path.join(m.tmp, RECORD_DIRNAME);
            const files = fs.existsSync(path.join(root, runId)) ? fs.readdirSync(path.join(root, runId)) : [];
            const fileRe = new RegExp(`^${process.pid}-[0-9a-f]{8}\\.txt$`);
            const expectFile = files.length === 1 && fileRe.test(files[0]) ? files[0] : '';
            if (!expectFile) problems.push(`record files ${JSON.stringify(files)}, expected one matching ${fileRe}`);
            const lines = files.length ? fs.readFileSync(path.join(root, runId, expectFile), 'utf8') : '';
            // WR-28: each call's outcome, recorded after the compare decided (a throw included).
            const wantRecords: [string, Outcome][] = [
                ['a.jsonl', 'match'], ['a.jsonl', 'match'], ['env/_baseline.json', 'match'], ['a.jsonl', 'differs'],
                ['c.jsonl', 'absent'], ['a.jsonl', 'match'], ['env/NEW.json', 'written'], ['a.jsonl', 'differs'],
            ];
            const wantLines = wantRecords.map(([p, result]) => `${JSON.stringify({ path: p, result })}\n`).join('');
            if (lines !== wantLines) problems.push(`record text ${JSON.stringify(lines)}, expected ${JSON.stringify(wantLines)}`);
            // The check reads the serializer's own record: the formats agree.
            const rec = readRunRecord(root, runId);
            const got = JSON.stringify([...rec.paths.entries()].sort());
            const wantPaths = JSON.stringify([['a.jsonl', 5], ['c.jsonl', 1], ['env/NEW.json', 1], ['env/_baseline.json', 1]]);
            const gotOutcomes = JSON.stringify([...rec.outcomes.entries()].sort().map(([p, m]) => [p, [...m.entries()].sort()]));
            const wantOutcomes = JSON.stringify([['a.jsonl', [['differs', 2], ['match', 3]]], ['c.jsonl', [['absent', 1]]], ['env/NEW.json', [['written', 1]]], ['env/_baseline.json', [['match', 1]]]]);
            if (got !== wantPaths || gotOutcomes !== wantOutcomes || rec.calls !== 8 || rec.files !== 1) problems.push(`check read ${got} ${gotOutcomes} (${rec.calls} calls, ${rec.files} files), expected ${wantPaths} ${wantOutcomes}`);
            if (!realRunDirAbsent(runId)) problems.push('the real record folder got this run');
            return { name, ok: problems.length === 0, detail: problems.length ? problems.join('; ') : `8 calls recorded in order as ${expectFile}; results ${JSON.stringify(results)}; the check reads the same 4 paths` };
        } finally {
            fs.rmSync(m.base, { recursive: true, force: true });
        }
    });

    caseRun('serializer-does-not-record-a-dir-override-call-against-another-folder', () => {
        const name = 'serializer-does-not-record-a-dir-override-call-against-another-folder';
        const m = mirror('ser-dir');
        const other = tempRoot('ser-other');
        try {
            const ser = loadSerializer(m.repo);
            const runId = 'selftest-serializer-dir';
            const text = '{"scenario":"x","tag":"KEEP"}\n{"submitted":[]}\n';
            fs.writeFileSync(path.join(other, 'x.jsonl'), text);
            const results = withProcess(m.tmp, { CSB_RAIL_RUN_ID: runId, CI: undefined, [ser.UPDATE_SWITCH]: undefined }, () => {
                const r: unknown[] = [];
                r.push(ser.compareRecording('x.jsonl', text, { dir: other }));
                r.push(throwsWith(() => ser.compareRecording('x.jsonl', `${text}{"c":1}\n`, { dir: other }), /x\.jsonl differs/));
                r.push(throwsWith(() => ser.compareRecording('y.jsonl', text, { dir: other }), /no recording at y\.jsonl/));
                process.env[ser.UPDATE_SWITCH] = liveUpdateToken(ser);
                r.push(ser.compareRecording('env/SOME_VAR.json', '{"a":1}\n', { dir: other }));
                return r;
            });
            const problems: string[] = [];
            const want = ['match', true, true, 'written'];
            if (JSON.stringify(results) !== JSON.stringify(want)) problems.push(`compare results ${JSON.stringify(results)}, expected ${JSON.stringify(want)}`);
            const root = path.join(m.tmp, RECORD_DIRNAME);
            if (fs.existsSync(root)) problems.push(`a record was written: ${JSON.stringify(fs.readdirSync(root, { recursive: true }))}`);
            if (!realRunDirAbsent(runId)) problems.push('the real record folder got this run');
            return { name, ok: problems.length === 0, detail: problems.length ? problems.join('; ') : `4 calls against ${posix(path.basename(other))} (compare, differ, absent, update write), results ${JSON.stringify(results)}, no record folder` };
        } finally {
            fs.rmSync(m.base, { recursive: true, force: true });
            fs.rmSync(other, { recursive: true, force: true });
        }
    });

    caseRun('serializer-without-a-valid-run-id-records-nothing-and-says-so-once', () => {
        const name = 'serializer-without-a-valid-run-id-records-nothing-and-says-so-once';
        const m = mirror('ser-norun');
        try {
            const a = fs.readFileSync(path.join(m.rec, 'a.jsonl'), 'utf8');
            const problems: string[] = [];
            const notes: string[] = [];
            for (const [label, id, re] of [
                ['unset', undefined, /CSB_RAIL_RUN_ID is unset in process \d+; compareRecording calls here are not recorded/],
                ['empty', '', /CSB_RAIL_RUN_ID is unset in process \d+/],
                ['invalid', '../escape', /CSB_RAIL_RUN_ID is not a valid run id in process \d+/],
            ] as const) {
                const ser = loadSerializer(m.repo);
                const res = withProcess(m.tmp, { CSB_RAIL_RUN_ID: id, CI: undefined, [ser.UPDATE_SWITCH]: undefined }, (stderr) => {
                    const r = [ser.compareRecording('a.jsonl', a), ser.compareRecording('env/../a.jsonl', a)];
                    return { r, stderr: [...stderr] };
                });
                if (JSON.stringify(res.r) !== '["match","match"]') problems.push(`${label}: results ${JSON.stringify(res.r)}`);
                const lines = res.stderr.join('').split('\n').filter(Boolean);
                if (lines.length !== 1 || !re.test(lines[0])) problems.push(`${label}: stderr ${JSON.stringify(lines)}`);
                notes.push(`${label}: 1 stderr line`);
            }
            const root = path.join(m.tmp, RECORD_DIRNAME);
            if (fs.existsSync(root)) problems.push(`a record was written: ${JSON.stringify(fs.readdirSync(root, { recursive: true }))}`);
            if (!realRunDirAbsent('escape')) problems.push('the real record folder got a run');
            return { name, ok: problems.length === 0, detail: problems.length ? problems.join('; ') : `${notes.join(', ')}; two calls each still match; no record folder` };
        } finally {
            fs.rmSync(m.base, { recursive: true, force: true });
        }
    });

    caseRun('WR-28-a-mismatch-the-caller-catches-is-recorded-and-fails-here-naming-it', () => {
        const name = 'WR-28-a-mismatch-the-caller-catches-is-recorded-and-fails-here-naming-it';
        const fx = new Fixture('caught');
        const tmp = tempRoot('caught-tmp');
        try {
            const a = '{"scenario":"a","tag":"KEEP"}\n{"submitted":[]}\n';
            const b = '{"scenario":"b","tag":"KEEP"}\n{"submitted":[]}\n';
            fx.put(`${REC}a.jsonl`, a);
            fx.put(`${REC}b.jsonl`, b);
            fx.commit('test: two recordings');
            // The real serializer, its recordings folder inside this git fixture.
            const ser = loadSerializer(fx.dir);
            const runId = 'selftest-caught-mismatch';
            withProcess(tmp, { CSB_RAIL_RUN_ID: runId, CI: undefined, [ser.UPDATE_SWITCH]: undefined }, () => {
                ser.compareRecording('a.jsonl', a);
                try {
                    // The laundering route the review names: a test "compares" the old recording and swallows the mismatch.
                    ser.compareRecording('b.jsonl', `${b}{"changed":true}\n`);
                } catch {
                    /* caught on purpose */
                }
            });
            if (!realRunDirAbsent(runId)) return { name, ok: false, detail: 'the real record folder got this run' };
            return expectRun(name, runCase(fx, path.join(tmp, RECORD_DIRNAME), ['--run-id', runId]), 1, [/^DIFFERS "b\.jsonl": /, /^RESULT FAIL \(1 violation\(s\)\)$/], [/"a\.jsonl"/, /NEVER COMPARED/]);
        } finally {
            fx.cleanup();
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    // ---- the check half (throwaway repos and record folders) ----

    caseRun('all-tracked-recordings-compared-passes-and-prints-equal-counts', () => {
        const fx = standardRepo('pass');
        const root = tempRoot('pass-root');
        try {
            writeRecord(root, 'run-pass', { '101-0000000a.txt': ['a.jsonl', 'env/_baseline.json'], '102-0000000b.txt': ['b.jsonl', 'env/FOO.json', 'a.jsonl'] });
            return expectRun('all-tracked-recordings-compared-passes-and-prints-equal-counts', runCase(fx, root, ['--run-id', 'run-pass']), 0, [
                /^tracked recordings: 4 \(2 scenario \.jsonl, 2 env\/\*\.json\)$/,
                /^not recordings \(cannot be compared, not judged\): 1 \("\.gitattributes"\)$/,
                /^compared paths: 4 distinct$/,
                /^record: .* \(2 worker file\(s\), 5 compareRecording call\(s\)\)$/,
                /^RESULT PASS \(tracked 4, compared 4\)$/,
            ]);
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('a-tracked-scenario-never-compared-fails-naming-it', () => {
        const fx = standardRepo('scen');
        const root = tempRoot('scen-root');
        try {
            writeRecord(root, 'run-scen', { '101-0000000a.txt': ['a.jsonl', 'env/_baseline.json', 'env/FOO.json'] });
            return expectRun('a-tracked-scenario-never-compared-fails-naming-it', runCase(fx, root, ['--run-id', 'run-scen']), 1, [/^NEVER COMPARED "b\.jsonl": /, /^RESULT FAIL \(1 violation\(s\)\)$/], [/NEVER COMPARED "a\.jsonl"/]);
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('an-env-snapshot-file-never-compared-fails-naming-it', () => {
        const fx = standardRepo('env');
        const root = tempRoot('env-root');
        try {
            writeRecord(root, 'run-env', { '101-0000000a.txt': ['a.jsonl', 'b.jsonl', 'env/FOO.json'] });
            return expectRun('an-env-snapshot-file-never-compared-fails-naming-it', runCase(fx, root, ['--run-id', 'run-env']), 1, [/^NEVER COMPARED "env\/_baseline\.json": /, /^RESULT FAIL \(1 violation\(s\)\)$/]);
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('a-compared-path-that-git-does-not-track-fails-naming-it', () => {
        const fx = standardRepo('untracked');
        const root = tempRoot('untracked-root');
        try {
            // c.jsonl is on disk but never added; gone.jsonl exists nowhere.
            fx.put(`${REC}c.jsonl`, '{"scenario":"c","tag":"KEEP"}\n{"submitted":[]}\n');
            writeRecord(root, 'run-untracked', { '101-0000000a.txt': [...ALL_STANDARD, 'c.jsonl', 'gone.jsonl'] });
            return expectRun('a-compared-path-that-git-does-not-track-fails-naming-it', runCase(fx, root, ['--run-id', 'run-untracked']), 1, [
                /^NOT TRACKED "c\.jsonl": compared in run run-untracked \(1 call\(s\)\)/,
                /^NOT TRACKED "gone\.jsonl": /,
                /^RESULT FAIL \(2 violation\(s\)\)$/,
            ]);
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('23-25-gap-a-test-pointed-at-a-new-recording-name-passes-the-commit-check-and-fails-here-naming-the-old-file', () => {
        const name = '23-25-gap-a-test-pointed-at-a-new-recording-name-passes-the-commit-check-and-fails-here-naming-the-old-file';
        const fx = new Fixture('gap');
        const root = tempRoot('gap-root');
        try {
            fx.put(`${REC}.gitattributes`, '* text=auto eol=lf\n');
            fx.put(`${REC}flashbots-v2-trailing.jsonl`, '{"scenario":"flashbots-v2-trailing","tag":"KEEP"}\n{"submitted":[]}\n');
            fx.put('test/realpath/scenarios/flashbots-v2.test.ts', "runScenario({ name: 'flashbots-v2-trailing', tag: 'KEEP' });\n");
            fx.commit('test: first recording');
            // The quiet swap: the test now compares a new name, the new file is added, the old one stays.
            fx.put('test/realpath/scenarios/flashbots-v2.test.ts', "runScenario({ name: 'flashbots-v2-trailing-b', tag: 'KEEP' });\n");
            fx.put(`${REC}flashbots-v2-trailing-b.jsonl`, '{"scenario":"flashbots-v2-trailing-b","tag":"KEEP"}\n{"buy":"changed"}\n');
            const swap = fx.commit('test: compare the trailing scenario against its new recording');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const taxonomy = require('./check-commit-taxonomy') as typeof import('./check-commit-taxonomy');
            const history = taxonomy.judgeHistory(fx.dir, fx.env);
            if (history.violations.length !== 0 || history.judged.length !== 1 || history.judged[0] !== swap) {
                return { name, ok: false, detail: `expected the commit check to judge only the swap and pass it, got judged ${JSON.stringify(history.judged)}, ${history.violations.length} violation(s)` };
            }
            // The run after the swap compares only the new name.
            writeRecord(root, 'run-after-swap', { '101-0000000a.txt': ['flashbots-v2-trailing-b.jsonl'] });
            const r = expectRun(name, runCase(fx, root, ['--run-id', 'run-after-swap']), 1, [/^NEVER COMPARED "flashbots-v2-trailing\.jsonl": /, /^RESULT FAIL \(1 violation\(s\)\)$/]);
            return r.ok ? { ...r, detail: `commit check passes ${swap.slice(0, 12)} (1 judged, 0 violations); here ${r.detail}` } : r;
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('WR-28-a-differs-or-absent-outcome-fails-even-beside-a-match', () => {
        const name = 'WR-28-a-differs-or-absent-outcome-fails-even-beside-a-match';
        const fx = standardRepo('differs');
        const root = tempRoot('differs-root');
        try {
            // Every tracked recording matched once, but one call on b.jsonl differed and one on a missing file was absent.
            writeRecord(root, 'run-differs', { '101-0000000a.txt': [...ALL_STANDARD, ['b.jsonl', 'differs'], ['gone.jsonl', 'absent']] });
            return expectRun(name, runCase(fx, root, ['--run-id', 'run-differs']), 1, [
                /^outcomes: match 4, written 0, differs 1, absent 1, error 0; tracked recordings matched: 4 of 4$/,
                /^DIFFERS "b\.jsonl": 1 call\(s\) in run run-differs ended in differs: /,
                /^ABSENT "gone\.jsonl": 1 call\(s\) in run run-differs ended in absent: /,
                /^NOT TRACKED "gone\.jsonl": /,
                /^RESULT FAIL \(3 violation\(s\)\)$/,
            ], [/NEVER COMPARED/]);
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('WR-28-a-recording-only-written-or-errored-in-the-run-was-not-compared', () => {
        const name = 'WR-28-a-recording-only-written-or-errored-in-the-run-was-not-compared';
        const fx = standardRepo('written');
        const root = tempRoot('written-root');
        try {
            writeRecord(root, 'run-written', { '101-0000000a.txt': ['a.jsonl', 'env/_baseline.json', 'env/FOO.json', ['b.jsonl', 'written'], ['b.jsonl', 'error']] });
            return expectRun(name, runCase(fx, root, ['--run-id', 'run-written']), 1, [
                /^outcomes: match 3, written 1, differs 0, absent 0, error 1; tracked recordings matched: 3 of 4$/,
                /^WRITTEN "b\.jsonl": 1 call\(s\) in run run-written ended in written: re-recorded in this run/,
                /^ERROR "b\.jsonl": 1 call\(s\) in run run-written ended in error: /,
                /^RESULT FAIL \(2 violation\(s\)\)$/,
            ], [/NEVER COMPARED/, /RESULT PASS/]);
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('records-only-from-an-older-run-never-count', () => {
        const name = 'records-only-from-an-older-run-never-count';
        const fx = standardRepo('stale');
        const root = tempRoot('stale-root');
        try {
            writeRecord(root, 'run-old', { '101-0000000a.txt': ALL_STANDARD });
            const none = expectRun(name, runCase(fx, root, ['--run-id', 'run-new']), 2, [/no comparison record for run run-new /, /^RESULT BROKEN \(exit 2\)$/], [/RESULT PASS/]);
            if (!none.ok) return none;
            // The new run's partial record is judged alone: the old complete one is not merged in.
            writeRecord(root, 'run-new', { '201-0000000c.txt': ['a.jsonl', 'env/_baseline.json', 'env/FOO.json'] });
            const partial = expectRun(name, runCase(fx, root, ['--run-id', 'run-new']), 1, [/^NEVER COMPARED "b\.jsonl": /], [/RESULT PASS/]);
            return partial.ok ? { name, ok: true, detail: `only run-old recorded: exit 2; run-new partial: exit 1 naming b.jsonl although run-old is complete` } : partial;
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    const LOG_OK = (id: string) =>
        [
            `[SAFE-02 rails] run ${id} — project unit — ledger /tmp/crypto-snipe-bot-rail-ledger/${id}`,
            `[SAFE-02 rails] run ${id} — project realpath — ledger /tmp/crypto-snipe-bot-rail-ledger/${id}`,
            ' ✓ test/realpath/scenarios/flashbots-v2.test.ts (5 tests)',
            `[SAFE-02 rails] run ${id} — project realpath finished — summary /tmp/crypto-snipe-bot-rail-ledger/${id}/summary.json`,
            `[SAFE-02 rails] run ${id} — project unit finished — summary /tmp/crypto-snipe-bot-rail-ledger/${id}/summary.json`,
            '',
        ].join('\n');

    caseRun('run-log-judges-the-run-its-log-names-and-nothing-else', () => {
        const name = 'run-log-judges-the-run-its-log-names-and-nothing-else';
        const fx = standardRepo('log');
        const root = tempRoot('log-root');
        try {
            writeRecord(root, 'run-old', { '101-0000000a.txt': ALL_STANDARD });
            writeRecord(root, 'run-20261112T203014-16016-a8301d', { '201-0000000c.txt': ['a.jsonl', 'env/_baseline.json', 'env/FOO.json'] });
            const log = path.join(root, 'vitest.log');
            fs.writeFileSync(log, LOG_OK('run-20261112T203014-16016-a8301d'));
            const partial = expectRun(name, runCase(fx, root, ['--run-log', log]), 1, [/^check-recordings-compared: run run-20261112T203014-16016-a8301d chosen by --run-log /, /^NEVER COMPARED "b\.jsonl": /]);
            if (!partial.ok) return partial;
            fs.writeFileSync(log, LOG_OK('run-unrecorded'));
            const none = expectRun(name, runCase(fx, root, ['--run-log', log]), 2, [/no comparison record for run run-unrecorded /], [/RESULT PASS/]);
            if (!none.ok) return none;
            fs.writeFileSync(log, LOG_OK('run-old'));
            const old = expectRun(name, runCase(fx, root, ['--run-log', log]), 0, [/^RESULT PASS \(tracked 4, compared 4\)$/]);
            return old.ok ? { name, ok: true, detail: 'the named run is judged (partial: exit 1 naming b.jsonl; unrecorded: exit 2; complete: exit 0); no other run is read' } : old;
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('run-log-refuses-a-log-that-is-not-one-finished-realpath-run', () => {
        const name = 'run-log-refuses-a-log-that-is-not-one-finished-realpath-run';
        const fx = standardRepo('badlog');
        const root = tempRoot('badlog-root');
        try {
            writeRecord(root, 'run-a', { '101-0000000a.txt': ALL_STANDARD });
            writeRecord(root, 'run-b', { '101-0000000a.txt': ALL_STANDARD });
            const log = path.join(root, 'vitest.log');
            const variants: [string, string, RegExp][] = [
                ['two runs', `${LOG_OK('run-a')}${LOG_OK('run-b')}`, /names 2 runs \(run-a, run-b\)/],
                ['no realpath project', LOG_OK('run-a').split('\n').filter((l) => !l.includes('realpath')).join('\n'), /did not run the realpath project/],
                ['realpath never finished', LOG_OK('run-a').split('\n').filter((l) => !l.includes('realpath finished')).join('\n'), /realpath project of run run-a did not finish/],
                ['no rails line', ' ✓ test/realpath/x.test.ts\n', /names no run/],
            ];
            for (const [label, text, re] of variants) {
                fs.writeFileSync(log, text);
                const r = expectRun(`${name} (${label})`, runCase(fx, root, ['--run-log', log]), 2, [re], [/RESULT PASS/]);
                if (!r.ok) return r;
            }
            const missing = expectRun(`${name} (missing file)`, runCase(fx, root, ['--run-log', path.join(root, 'absent.log')]), 2, [/cannot be read/]);
            return missing.ok ? { name, ok: true, detail: 'two runs, no realpath project, realpath not finished, no rails line, and an unreadable log: each exit 2' } : missing;
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('sole-run-only-in-CI-and-only-with-exactly-one-run', () => {
        const name = 'sole-run-only-in-CI-and-only-with-exactly-one-run';
        const fx = standardRepo('sole');
        const root = tempRoot('sole-root');
        try {
            const noCi = expectRun(name, runCase(fx, root, ['--sole-run'], {}), 2, [/--sole-run is for a CI job only \(CI is not set\)/]);
            if (!noCi.ok) return noCi;
            const recRoot = path.join(root, RECORD_DIRNAME);
            const missing = expectRun(name, runCase(fx, recRoot, ['--sole-run'], { CI: 'true' }), 2, [/--sole-run: no record folder/]);
            if (!missing.ok) return missing;
            writeRecord(recRoot, 'run-ci', { '101-0000000a.txt': ALL_STANDARD });
            const one = expectRun(name, runCase(fx, recRoot, ['--sole-run'], { CI: 'true' }), 0, [/chosen by --sole-run/, /^RESULT PASS \(tracked 4, compared 4\)$/]);
            if (!one.ok) return one;
            writeRecord(recRoot, 'run-ci-2', { '101-0000000a.txt': ['a.jsonl'] });
            const two = expectRun(name, runCase(fx, recRoot, ['--sole-run'], { CI: 'true' }), 2, [/--sole-run needs exactly one run in .*, found 2 \(run-ci, run-ci-2\)/], [/RESULT PASS/]);
            return two.ok ? { name, ok: true, detail: 'CI unset: exit 2; no folder: exit 2; one run: exit 0; two runs: exit 2' } : two;
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('an-empty-or-broken-record-exits-2', () => {
        const name = 'an-empty-or-broken-record-exits-2';
        const fx = standardRepo('broken');
        const root = tempRoot('broken-root');
        try {
            const variants: [string, (dir: string) => void, RegExp][] = [
                ['empty run folder', () => undefined, /holds no comparison/],
                ['empty file', (d) => fs.writeFileSync(path.join(d, '1-0000000d.txt'), ''), /record file 1-0000000d\.txt of run run-broken is empty/],
                ['incomplete last line', (d) => fs.writeFileSync(path.join(d, '1-0000000d.txt'), '"a.jsonl"\n"b.js'), /ends in an incomplete line/],
                ['not JSON', (d) => fs.writeFileSync(path.join(d, '1-0000000d.txt'), 'a.jsonl\n'), /line 1: not JSON/],
                // WR-28: {path, result} exactly; a bare path (the format before WR-28) cannot be judged.
                ['a bare path (no outcome)', (d) => fs.writeFileSync(path.join(d, '1-0000000d.txt'), '"a.jsonl"\n'), /is not a \{path, result\} record/],
                ['no result', (d) => fs.writeFileSync(path.join(d, '1-0000000d.txt'), '{"path":"a.jsonl"}\n'), /is not a \{path, result\} record/],
                ['an unknown result', (d) => fs.writeFileSync(path.join(d, '1-0000000d.txt'), '{"path":"a.jsonl","result":"ok"}\n'), /is not a \{path, result\} record/],
                ['an extra key', (d) => fs.writeFileSync(path.join(d, '1-0000000d.txt'), '{"path":"a.jsonl","result":"match","note":1}\n'), /is not a \{path, result\} record/],
                ['a path that is not a string', (d) => fs.writeFileSync(path.join(d, '1-0000000d.txt'), '{"path":1,"result":"match"}\n'), /is not a recording path/],
                ['escaping path', (d) => fs.writeFileSync(path.join(d, '1-0000000d.txt'), '{"path":"../a.jsonl","result":"match"}\n'), /is not a recording path/],
                ['backslash path', (d) => fs.writeFileSync(path.join(d, '1-0000000d.txt'), '{"path":"env\\\\FOO.json","result":"match"}\n'), /is not a recording path/],
                ['wrong extension', (d) => fs.writeFileSync(path.join(d, '1-0000000d.txt'), '{"path":".gitattributes","result":"match"}\n'), /is not a recording path/],
                ['stray file', (d) => fs.writeFileSync(path.join(d, 'notes.md'), 'x\n'), /unexpected entry "notes\.md"/],
                ['file name not <pid>-<token>.txt', (d) => fs.writeFileSync(path.join(d, '1-0.txt'), '"a.jsonl"\n'), /unexpected entry "1-0\.txt"/],
            ];
            for (const [label, make, re] of variants) {
                const dir = path.join(root, 'run-broken');
                fs.rmSync(dir, { recursive: true, force: true });
                fs.mkdirSync(dir, { recursive: true });
                make(dir);
                const r = expectRun(`${name} (${label})`, runCase(fx, root, ['--run-id', 'run-broken']), 2, [re, /^RESULT BROKEN \(exit 2\)$/], [/RESULT PASS/]);
                if (!r.ok) return r;
            }
            return { name, ok: true, detail: `${variants.map((v) => v[0]).join(', ')}: each exit 2` };
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('no-tracked-recording-exits-2', () => {
        const fx = new Fixture('norec');
        const root = tempRoot('norec-root');
        try {
            fx.put('src/app.ts', 'export const a = 1;\n');
            fx.commit('chore: start');
            writeRecord(root, 'run-norec', { '101-0000000a.txt': ['a.jsonl'] });
            return expectRun('no-tracked-recording-exits-2', runCase(fx, root, ['--run-id', 'run-norec']), 2, [/git tracks no recording under test\/realpath\/recordings\//], [/RESULT PASS/]);
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('no-run-selection-or-a-bad-run-id-exits-2', () => {
        const name = 'no-run-selection-or-a-bad-run-id-exits-2';
        const fx = standardRepo('noselect');
        const root = tempRoot('noselect-root');
        try {
            writeRecord(root, 'run-only', { '101-0000000a.txt': ALL_STANDARD });
            for (const [label, argv, re] of [
                ['no argument', [], /give exactly one of --run-id <id>, --run-log <file>, --sole-run \(got \[\]\); the check never guesses/],
                ['bad run id', ['--run-id', '../run-only'], /--run-id "\.\.\/run-only" is not a valid run id/],
                ['two selections', ['--run-id', 'run-only', '--sole-run'], /give exactly one of/],
            ] as const) {
                const r = expectRun(`${name} (${label})`, runCase(fx, root, [...argv]), 2, [re], [/RESULT PASS/]);
                if (!r.ok) return r;
            }
            return { name, ok: true, detail: 'no argument, a bad run id and two selections: each exit 2 (the only run in the folder is not picked)' };
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    caseRun('a-tracked-path-under-a-letter-case-variant-of-the-folder-fails', () => {
        const fx = standardRepo('case');
        const root = tempRoot('case-root');
        try {
            // An index entry only, so the case-insensitive Windows folder on disk is not involved.
            const blob = fx.gitInput('{"scenario":"z","tag":"KEEP"}\n{"submitted":[]}\n', 'hash-object', '-w', '--stdin');
            fx.git('update-index', '--add', '--cacheinfo', `100644,${blob},test/realpath/RECORDINGS/z.jsonl`);
            fx.git('commit', '-q', '-m', 'test: a case-variant recording');
            writeRecord(root, 'run-case', { '101-0000000a.txt': [...ALL_STANDARD, 'z.jsonl'] });
            return expectRun('a-tracked-path-under-a-letter-case-variant-of-the-folder-fails', runCase(fx, root, ['--run-id', 'run-case']), 1, [
                /^CASE VARIANT "test\/realpath\/RECORDINGS\/z\.jsonl": /,
                /^NOT TRACKED "z\.jsonl": /,
                /^RESULT FAIL \(2 violation\(s\)\)$/,
            ]);
        } finally {
            fx.cleanup();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    return out;
}

function selfTest(): number {
    const cases = selfTestCases();
    for (const c of cases) (c.ok ? console.log : console.error)(`${c.ok ? 'ok  ' : 'FAIL'} case:${c.name}: ${c.detail}`);
    const failed = cases.filter((c) => !c.ok).length;
    console.log(failed ? `SELF-TEST FAIL ${failed} of ${cases.length} cases` : `SELF-TEST PASS ${cases.length} of ${cases.length} cases`);
    return failed ? 1 : 0;
}

function main(argv: string[]): number {
    if (argv.length === 1 && argv[0] === '--self-test') return selfTest();
    if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
        console.log(HELP);
        return 0;
    }
    return gateCode(argv, realIo());
}

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (e) {
        console.error(`check-recordings-compared: crash: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        process.exitCode = 2;
    }
}
