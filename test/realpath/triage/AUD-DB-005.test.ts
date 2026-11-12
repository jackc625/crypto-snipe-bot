// test/realpath/triage/AUD-DB-005.test.ts
// Phase 23 plan 23-13 Task 3 (AUDIT-02, D-07, D-08): AUD-DB-005 (S3, RC-23), LOG_LEVEL in .env is
// never applied.
//
// The finding: src/config.ts imports the logger (src/utils/logger.ts, which creates its pino logger
// with process.env.LOG_LEVEL || 'info' when it is first imported) one line before it calls
// dotenv.config(), and src/bot.ts imports config as its first project module. So a LOG_LEVEL set in
// .env is loaded into process.env only after the logger has already read it. The entry point keeps
// that order on purpose: src/main.ts reads .env into a private object and leaves process.env as it
// was ("including logger.ts reading LOG_LEVEL before config.ts loads .env", src/main.ts:39-42).
//
// How (review concern Codex 23-13 HIGH: with VITEST set, src/config.ts:5 skips dotenv, so a railed
// child that keeps it proves nothing about production): fixtures/logLevelOrder.ts runs as a railed
// child with VITEST unset (withVitestEnv: false, the form test/unit/rails/dotenvSrcSkip.test.ts case
// (f) already runs), from a throwaway working folder holding an inert .env that sets
// LOG_LEVEL=debug. Its first statement deletes LOG_LEVEL (the sentinel env sets it, and dotenv never
// overwrites a set key), then it imports src/config and then src/utils/logger. Before the marker the
// test requires vitest false and the file's value loaded (levelFromConfigFile 'debug'), so the proof
// cannot pass in test mode or with no file loaded.
//   Correct:  { loggerLevel: 'debug' }, the .env value applied to the logger.
//   Observed: { loggerLevel: 'info' }, the default, because the logger read LOG_LEVEL during its
//             import, before dotenv ran.
// The child's own case ledger is checked: the rails started, no network use, nothing denied.
//
// Phase 29 reading (card OD-10): loading .env before the logger is first imported, or reading the
// level lazily, flips the claim to "looks fixed" (shown by a fix-shaped mutation that loads dotenv
// at the top of src/utils/logger.ts, src restored byte for byte). The finding's rationale holds: a
// fix is a behavior change, because debug output carries whole ethers error objects (RPC URLs with
// API keys, AUD-TX-014), so it should land after redaction.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it, onTestFailed } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { REPO_ROOT, spawnRailedChild, type CliResult } from '../../rails/spawnRailedChild';
import { harnessState } from '../harness/chain';
import { knownBug } from '../harness/knownBug';

// One railed child that loads ts-node and src/config. The explicit limit is headroom for a child
// process on a loaded machine (measured times are in the plan summary).
const CHILD_TIMEOUT_MS = 110_000;
const TEST_TIMEOUT_MS = 120_000;
const FIXTURE = path.join(REPO_ROOT, 'test', 'realpath', 'triage', 'fixtures', 'logLevelOrder.ts');
const TS_NODE_BIN = path.join(REPO_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');
const LEDGER_ROOT = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger');

let caseCounter = 0;
function newCaseId(label: string): string {
    caseCounter += 1;
    const id = `case-realpath-db005-${label}-${process.pid}-${caseCounter}-${Math.random().toString(36).slice(2, 10)}`;
    harnessState().disposers.push(async () => fs.rmSync(path.join(LEDGER_ROOT, id), { recursive: true, force: true }));
    return id;
}

/** The child's own rail ledger: the rails started, no network was used and nothing was denied. */
function expectRailedNoNetwork(runId: string): void {
    const dir = path.join(LEDGER_ROOT, runId);
    const entries: Array<{ kind: string }> = [];
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue;
        for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) if (line.trim() !== '') entries.push(JSON.parse(line) as { kind: string });
    }
    expect(entries.some((e) => e.kind === 'worker-start'), 'the child ran with the rails').toBe(true);
    expect(entries.filter((e) => e.kind.startsWith('net-') || /deny|blocked|tripwire/.test(e.kind))).toEqual([]);
}

function describeRun(r: CliResult): string {
    return `status ${r.status}\nstdout (tail):\n${r.stdout.slice(-2000)}\nstderr (tail):\n${r.stderr.slice(-2000)}`;
}

describe('AUD-DB-005: LOG_LEVEL in .env is never applied, because the logger is created before .env is loaded', () => {
    it('log-level-from-env-file-not-applied: with VITEST unset and LOG_LEVEL=debug in .env, the logger runs at info', { timeout: TEST_TIMEOUT_MS }, (ctx) => {
        const cwd = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'csb-aud-db-005-')));
        harnessState().disposers.push(async () => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
        // An inert .env in the throwaway working folder: one key, no secret.
        fs.writeFileSync(path.join(cwd, '.env'), 'LOG_LEVEL=debug\n');

        const ledgerRunId = newCaseId('order');
        const r = spawnRailedChild(process.execPath, [TS_NODE_BIN, '--transpile-only', FIXTURE], { cwd, withVitestEnv: false, ledgerRunId, timeoutMs: CHILD_TIMEOUT_MS });
        onTestFailed(() => {
            console.error(`[AUD-DB-005] ${describeRun(r)}`);
        });
        // The path check (AC-09): the child ran to its result line under the rails.
        expect(r.stdout, 'the fixture reported no setup error').not.toContain('FIXTURE_SETUP_ERROR');
        expect(r.status, 'the child exited 0').toBe(0);
        const last = r.stdout.split(/\r?\n/).filter((l) => l.trim() !== '').pop() ?? '';
        const result = JSON.parse(last) as { vitest: boolean; levelFromConfigFile: string | null; loggerLevel: string };
        expectRailedNoNetwork(ledgerRunId);
        // The proof is about production: VITEST was unset and src/config really loaded the .env file.
        expect(result.vitest, 'the child ran with VITEST unset').toBe(false);
        expect(result.levelFromConfigFile, 'src/config loaded LOG_LEVEL from the .env file').toBe('debug');

        knownBug(ctx, 'AUD-DB-005', {
            claim: 'log-level-from-env-file-not-applied',
            correct: { loggerLevel: 'debug' },
            observed: { loggerLevel: 'info' },
            actual: { loggerLevel: result.loggerLevel },
            expectedPlain: 'Setting LOG_LEVEL=debug in .env makes the bot log at debug level.',
            actualPlain: 'LOG_LEVEL in .env does nothing: the logger is created before .env is loaded, so the bot always logs at info.',
        });
    });
});
