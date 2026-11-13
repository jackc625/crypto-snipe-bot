// test/unit/updateRecordingsGate.test.ts
//
// Phase 23 review WR-35 (and WR-36): regression wrapper of the recordings update command's
// self-test. The self-test drives the command's real logic with a fake Vitest run on temp folders
// under the OS temp folder: Vitest is never started, and test/realpath/recordings/ is never read or
// written. It runs in a railed child because the script is a separate program with its own exit
// codes (test/unit/rails/spawnSites.test.ts: a test starts a process only through spawnRailedChild).

import { describe, it, expect } from 'vitest';
import { spawnRailedChild } from '../rails/spawnRailedChild';

const CASES = [
    'WR-35-a-re-record-holding-a-planted-key-fails-before-commit-naming-the-file',
    'WR-35-a-clean-re-record-passes-the-guard-and-says-done',
    'WR-35-a-failed-vitest-run-is-scanned-and-never-reported-done',
    'WR-35-a-vitest-run-ended-by-a-signal-is-still-scanned',
    'refuses-under-CI-and-without-a-filter-and-never-starts-vitest',
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Most of the time is ts-node type-checking the script and the guard module in the child; the
// cases themselves write a few small temp files. The limits match the other script self-tests.
const CHILD_TIMEOUT_MS = 240_000;
const TEST_TIMEOUT_MS = 250_000;

describe('update-recordings.ts --self-test (WR-35, WR-36)', () => {
    it(
        'exits 0 and every case passes with a fake Vitest run on temp folders',
        () => {
            const result = spawnRailedChild('npx', ['ts-node', 'scripts/update-recordings.ts', '--self-test'], { timeoutMs: CHILD_TIMEOUT_MS });
            const output = `${result.stdout}\n${result.stderr}`;

            expect(result.status, output).toBe(0);
            for (const name of CASES) {
                expect(result.stdout, `case ${name}\n${output}`).toMatch(new RegExp(`^ok   case:${escape(name)}: `, 'm'));
            }
            expect(output).not.toMatch(/^FAIL/m);
            expect(result.stdout, output).toMatch(new RegExp(`^SELF-TEST PASS ${CASES.length} of ${CASES.length} cases$`, 'm'));
        },
        TEST_TIMEOUT_MS,
    );
});
