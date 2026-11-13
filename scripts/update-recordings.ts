// scripts/update-recordings.ts
// Phase 23 plan 23-20 (CHAR-02, D-15, AC-25; T-23-26): the explicit update command for the
// golden-master recordings. It is the ONLY code that sets VITEST_CSB_UPDATE_RECORDINGS, the switch
// test/realpath/harness/serializer.ts compareRecording reads before it writes a recording; a normal
// test run never sets it, so a normal run only compares (and fails on any difference).
//
// Why an environment variable: the SAFE-02 rails scrub the worker environment but keep keys with
// the VITEST prefix (test/rails/core.cjs isEssentialKey), and npm scripts run through cmd on
// Windows, so a shell assignment inside an npm script would not carry. This wrapper sets the switch
// in the environment of one Vitest run it starts itself, with an argument-array spawn (no shell).
//
// Usage (Node 22.16.0, ABI 127):
//   npm run recordings:update -- <vitest filters...>     e.g. test/realpath/scenarios/flashbots-v2.test.ts -t flashbots-v2-partial
//   npm run recordings:update -- --all                   every realpath recording
//   node node_modules/ts-node/dist/bin.js scripts/update-recordings.ts --self-test
//       every rule below with a fake Vitest run on temp folders; never starts Vitest, never touches
//       test/realpath/recordings/
// It refuses when CI is set (compareRecording also refuses to write under CI), and refuses an empty
// filter list without --all, so a whole re-record is always a deliberate choice.
//
// Phase 23 review WR-35: after Vitest exits (on any status, or a signal) it runs the recording guard
// (test/realpath/recordingsScan.ts, the rules test/realpath/recordingsGuard.test.ts runs) over every
// recording, so a re-recorded file holding a secret is refused here, before it is committed or
// pushed, not first in CI. A violation exits 1 and prints each one; "done" is printed only when
// Vitest exited 0 and the guard found nothing. A re-record of a
// committed recording is a behavior change: commit it as a behavior: commit citing a register ID
// (D-18), which the plan 23-25 commit check enforces.

if (process.versions.modules !== '127') {
    console.error(`update-recordings requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}).`);
    process.exit(2);
}

import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanRepoRecordings } from '../test/realpath/recordingsScan';

const SWITCH = 'VITEST_CSB_UPDATE_RECORDINGS';
const REPO_ROOT = path.resolve(__dirname, '..');
const VITEST_BIN = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');

export interface VitestRun {
    status: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
}

/** What one update run touches; the self-test passes a fake Vitest and temp folders. */
export interface UpdateDeps {
    /** The repo whose recordings are re-recorded. */
    repoRoot: string;
    env: NodeJS.ProcessEnv;
    /** Start Vitest with these arguments (after the vitest entry point) and this environment, and wait. */
    runVitest(args: string[], env: NodeJS.ProcessEnv): VitestRun;
    log(s: string): void;
    error(s: string): void;
}

export function runUpdate(argv: string[], deps: UpdateDeps): number {
    const ci = deps.env.CI;
    if (ci !== undefined && ci !== '') {
        deps.error(`update-recordings: refused, CI is set (CI=${JSON.stringify(ci)}). Recordings are written only by a deliberate local run.`);
        return 2;
    }
    const all = argv.includes('--all');
    const filters = argv.filter((a) => a !== '--all');
    if (!all && filters.length === 0) {
        deps.error('update-recordings: give the test file(s) or a -t name filter to re-record, or --all to re-record every realpath recording.');
        return 2;
    }
    const args = ['run', '--project', 'realpath', ...filters];
    deps.log(`update-recordings: ${SWITCH}=1 vitest ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    const r = deps.runVitest(args, { ...deps.env, [SWITCH]: '1' });
    if (r.error) {
        deps.error(`update-recordings: could not start Vitest: ${r.error.message}`);
        return 2;
    }
    if (r.signal) deps.error(`update-recordings: Vitest ended on signal ${r.signal}`);
    // WR-35: the recording guard over every recording, now that no writer is running, before
    // anything is committed. A filtered run never includes test/realpath/recordingsGuard.test.ts,
    // and under --all the guard ran beside the writers, so neither stands in for this scan.
    let guard: { files: number; violations: string[] };
    try {
        guard = scanRepoRecordings(deps.repoRoot);
    } catch (e) {
        deps.error(`update-recordings: the recording guard could not scan test/realpath/recordings: ${e instanceof Error ? e.message : String(e)}`);
        return 1;
    }
    if (guard.violations.length > 0) {
        deps.error(`update-recordings: the recording guard found ${guard.violations.length} violation(s) in test/realpath/recordings. Do not commit these files; fix the cause and re-record:`);
        for (const v of guard.violations) deps.error(`  ${v}`);
        return 1;
    }
    deps.log(`update-recordings: recording guard: ${guard.files} file(s) scanned, no violation`);
    if (r.signal) return 1;
    if (r.status !== 0) {
        deps.error(`update-recordings: Vitest exited with status ${r.status ?? 'unknown'}; the re-record is not complete. Review git diff -- test/realpath/recordings and re-run.`);
        return r.status ?? 1;
    }
    deps.log('update-recordings: done. Review every change with git diff -- test/realpath/recordings before committing it as a behavior: commit.');
    return 0;
}

// ---------------------------------------------------------------------------------------------
// Self-test: a fake Vitest run on temp folders under the OS temp folder. Vitest is never started
// and test/realpath/recordings/ is never read or written.
// ---------------------------------------------------------------------------------------------

interface CaseOutcome {
    name: string;
    ok: boolean;
    detail: string;
}

/** A temp repo layout the guard reads: recordings, an empty register folder, sentinels made here. */
function tempRepo(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-update-recordings-selftest-'));
    fs.mkdirSync(path.join(root, 'test', 'realpath', 'recordings'), { recursive: true });
    fs.mkdirSync(path.join(root, '.planning', 'audit', 'findings'), { recursive: true });
    // Sentinels of the same shape as test/.env.test's, written here (the real file is not read).
    fs.writeFileSync(path.join(root, 'test', '.env.test'), `PRIVATE_KEY=0x${'0'.repeat(63)}1\nBLOXROUTE_AUTH_HEADER=TEST-SENTINEL\n`);
    return root;
}

const cleanRecording = (name: string): string => `${JSON.stringify({ scenario: name, tag: 'KEEP' })}\n${JSON.stringify({ kind: 'op', at: 1, level: 'info', op: 'x.y', msg: 'm', fields: {}, bindings: {} })}\n{"submitted":[]}\n`;
/** A re-recorded file holding a key-shaped value (random, never printed). */
const plantedRecording = (name: string): string =>
    `${JSON.stringify({ scenario: name, tag: 'KEEP' })}\n${JSON.stringify({ kind: 'op', at: 1, level: 'info', op: 'x.y', msg: 'm', fields: { note: `0x${crypto.randomBytes(32).toString('hex')}` }, bindings: {} })}\n{"submitted":[]}\n`;

function runCase(argv: string[], env: NodeJS.ProcessEnv, child: (root: string, args: string[], env: NodeJS.ProcessEnv) => VitestRun): { code: number; out: string[]; calls: number; root: string } {
    const root = tempRepo();
    const out: string[] = [];
    let calls = 0;
    const code = runUpdate(argv, {
        repoRoot: root,
        env,
        runVitest: (args, childEnv) => {
            calls += 1;
            return child(root, args, childEnv);
        },
        log: (s) => out.push(s),
        error: (s) => out.push(s),
    });
    return { code, out, calls, root };
}

function expectCase(name: string, r: { code: number; out: string[]; calls: number }, code: number, must: RegExp[], mustNot: RegExp[] = [], calls = 1): CaseOutcome {
    const text = r.out.join(' | ');
    const missing = must.filter((re) => !r.out.some((l) => re.test(l)));
    const present = mustNot.filter((re) => r.out.some((l) => re.test(l)));
    const ok = r.code === code && missing.length === 0 && present.length === 0 && r.calls === calls;
    const why = r.code !== code ? `expected exit ${code}, got ${r.code}` : r.calls !== calls ? `expected ${calls} Vitest run(s), got ${r.calls}` : missing.length ? `missing ${missing.join(', ')}` : present.length ? `unexpected ${present.join(', ')}` : '';
    return { name, ok, detail: ok ? `exit ${r.code}: ${text}` : `${why}: ${text}` };
}

const recordingsOf = (root: string) => path.join(root, 'test', 'realpath', 'recordings');

function selfTestCases(): CaseOutcome[] {
    const out: CaseOutcome[] = [];
    const caseRun = (name: string, fn: () => CaseOutcome, roots: string[]) => {
        try {
            out.push(fn());
        } catch (e) {
            out.push({ name, ok: false, detail: `crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}` });
        } finally {
            for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
        }
    };
    const roots: string[] = [];
    const DONE = /^update-recordings: done\./;

    caseRun('WR-35-a-re-record-holding-a-planted-key-fails-before-commit-naming-the-file', () => {
        const r = runCase(['--all'], {}, (root) => {
            fs.writeFileSync(path.join(recordingsOf(root), 'a.jsonl'), plantedRecording('a'));
            fs.writeFileSync(path.join(recordingsOf(root), 'b.jsonl'), cleanRecording('b'));
            return { status: 0, signal: null };
        });
        roots.push(r.root);
        return expectCase('WR-35-a-re-record-holding-a-planted-key-fails-before-commit-naming-the-file', r, 1, [/^update-recordings: the recording guard found 1 violation\(s\)/, /^ {2}a\.jsonl line 2 \[note\]: a 64-hex run outside a named hash field$/], [DONE]);
    }, roots);

    caseRun('WR-35-a-clean-re-record-passes-the-guard-and-says-done', () => {
        const r = runCase(['test/realpath/scenarios/x.test.ts'], {}, (root) => {
            fs.writeFileSync(path.join(recordingsOf(root), 'a.jsonl'), cleanRecording('a'));
            return { status: 0, signal: null };
        });
        roots.push(r.root);
        return expectCase('WR-35-a-clean-re-record-passes-the-guard-and-says-done', r, 0, [/^update-recordings: recording guard: 1 file\(s\) scanned, no violation$/, DONE]);
    }, roots);

    caseRun('WR-35-a-failed-vitest-run-is-scanned-and-never-reported-done', () => {
        const r = runCase(['--all'], {}, (root) => {
            fs.writeFileSync(path.join(recordingsOf(root), 'a.jsonl'), cleanRecording('a'));
            return { status: 1, signal: null };
        });
        roots.push(r.root);
        return expectCase('WR-35-a-failed-vitest-run-is-scanned-and-never-reported-done', r, 1, [/^update-recordings: recording guard: 1 file\(s\) scanned, no violation$/, /^update-recordings: Vitest exited with status 1; the re-record is not complete/], [DONE]);
    }, roots);

    caseRun('WR-35-a-vitest-run-ended-by-a-signal-is-still-scanned', () => {
        const r = runCase(['--all'], {}, (root) => {
            fs.writeFileSync(path.join(recordingsOf(root), 'a.jsonl'), plantedRecording('a'));
            return { status: null, signal: 'SIGTERM' };
        });
        roots.push(r.root);
        return expectCase('WR-35-a-vitest-run-ended-by-a-signal-is-still-scanned', r, 1, [/^update-recordings: Vitest ended on signal SIGTERM/, /^update-recordings: the recording guard found 1 violation\(s\)/], [DONE]);
    }, roots);

    caseRun('refuses-under-CI-and-without-a-filter-and-never-starts-vitest', () => {
        const ci = runCase(['--all'], { CI: 'true' }, () => ({ status: 0, signal: null }));
        roots.push(ci.root);
        const a = expectCase('ci', ci, 2, [/refused, CI is set/], [DONE], 0);
        if (!a.ok) return { ...a, name: 'refuses-under-CI-and-without-a-filter-and-never-starts-vitest' };
        const none = runCase([], {}, () => ({ status: 0, signal: null }));
        roots.push(none.root);
        const b = expectCase('refuses-under-CI-and-without-a-filter-and-never-starts-vitest', none, 2, [/give the test file\(s\) or a -t name filter/], [DONE], 0);
        return b.ok ? { ...b, detail: 'CI set: exit 2; no filter: exit 2; Vitest never started' } : b;
    }, roots);

    return out;
}

function selfTest(): number {
    const cases = selfTestCases();
    for (const c of cases) (c.ok ? console.log : console.error)(`${c.ok ? 'ok  ' : 'FAIL'} case:${c.name}: ${c.detail}`);
    const failed = cases.filter((c) => !c.ok).length;
    console.log(failed ? `SELF-TEST FAIL ${failed} of ${cases.length} cases` : `SELF-TEST PASS ${cases.length} of ${cases.length} cases`);
    return failed ? 1 : 0;
}

function realDeps(): UpdateDeps {
    return {
        repoRoot: REPO_ROOT,
        env: process.env,
        runVitest: (args, env) => {
            const r = spawnSync(process.execPath, [VITEST_BIN, ...args], { cwd: REPO_ROOT, stdio: 'inherit', env });
            return { status: r.status, signal: r.signal, error: r.error };
        },
        log: (s) => console.log(s),
        error: (s) => console.error(s),
    };
}

function main(argv: string[]): number {
    if (argv.length === 1 && argv[0] === '--self-test') return selfTest();
    return runUpdate(argv, realDeps());
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
