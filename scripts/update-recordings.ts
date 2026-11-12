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
// It refuses when CI is set (compareRecording also refuses to write under CI), and refuses an empty
// filter list without --all, so a whole re-record is always a deliberate choice. A re-record of a
// committed recording is a behavior change: commit it as a behavior: commit citing a register ID
// (D-18), which the plan 23-25 commit check enforces.

if (process.versions.modules !== '127') {
    console.error(`update-recordings requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}).`);
    process.exit(2);
}

import { spawnSync } from 'child_process';
import * as path from 'path';

const SWITCH = 'VITEST_CSB_UPDATE_RECORDINGS';
const REPO_ROOT = path.resolve(__dirname, '..');
const VITEST_BIN = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');

function main(argv: string[]): number {
    const ci = process.env.CI;
    if (ci !== undefined && ci !== '') {
        console.error(`update-recordings: refused, CI is set (CI=${JSON.stringify(ci)}). Recordings are written only by a deliberate local run.`);
        return 2;
    }
    const all = argv.includes('--all');
    const filters = argv.filter((a) => a !== '--all');
    if (!all && filters.length === 0) {
        console.error('update-recordings: give the test file(s) or a -t name filter to re-record, or --all to re-record every realpath recording.');
        return 2;
    }
    const args = [VITEST_BIN, 'run', '--project', 'realpath', ...filters];
    console.log(`update-recordings: ${SWITCH}=1 node ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    const r = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, [SWITCH]: '1' } });
    if (r.error) {
        console.error(`update-recordings: could not start Vitest: ${r.error.message}`);
        return 2;
    }
    if (r.signal) {
        console.error(`update-recordings: Vitest ended on signal ${r.signal}`);
        return 1;
    }
    console.log('update-recordings: done. Review every change with git diff -- test/realpath/recordings before committing it as a behavior: commit.');
    return r.status ?? 1;
}

process.exit(main(process.argv.slice(2)));
