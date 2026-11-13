// test/unit/recordingsComparedGate.test.ts
//
// Phase 23 plan 23-33 (AUDIT-06, the gap plan 23-25 recorded): regression wrapper of the
// recordings-compared check's self-test. The self-test builds throwaway git repos and record
// folders under the OS temp folder, and loads the real serializer source under a temp mirror of
// the repo layout, so neither this repository's recordings nor the real comparison record of any
// run is an input or is written. It runs in a railed child because the script is a separate
// program with its own exit codes, and because git may only be started from scripts/
// (test/unit/rails/spawnSites.test.ts). git is found on the PATH the railed child inherits.

import { describe, it, expect } from 'vitest';
import { spawnRailedChild } from '../rails/spawnRailedChild';

// One case per rule, each with its passing or failing counterpart.
const CASES = [
    'serializer-records-each-real-folder-call-for-the-run-in-compare-and-update-runs',
    'serializer-does-not-record-a-dir-override-call-against-another-folder',
    'serializer-without-a-valid-run-id-records-nothing-and-says-so-once',
    'WR-28-a-mismatch-the-caller-catches-is-recorded-and-fails-here-naming-it',
    'WR-28-a-differs-or-absent-outcome-fails-even-beside-a-match',
    'WR-28-a-recording-only-written-or-errored-in-the-run-was-not-compared',
    'all-tracked-recordings-compared-passes-and-prints-equal-counts',
    'a-tracked-scenario-never-compared-fails-naming-it',
    'an-env-snapshot-file-never-compared-fails-naming-it',
    'a-compared-path-that-git-does-not-track-fails-naming-it',
    '23-25-gap-a-test-pointed-at-a-new-recording-name-passes-the-commit-check-and-fails-here-naming-the-old-file',
    'records-only-from-an-older-run-never-count',
    'run-log-judges-the-run-its-log-names-and-nothing-else',
    'run-log-refuses-a-log-that-is-not-one-finished-realpath-run',
    'sole-run-only-in-CI-and-only-with-exactly-one-run',
    'an-empty-or-broken-record-exits-2',
    'no-tracked-recording-exits-2',
    'no-run-selection-or-a-bad-run-id-exits-2',
    'a-tracked-path-under-a-letter-case-variant-of-the-folder-fails',
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Limits (measured on Node 22.16.0, 2026-11-12): most of the time is ts-node type-checking the
// script in the child, plus git: 13 throwaway repos (about 9 git calls each to set up) and about
// 25 judged runs (3 git calls each). Run directly: 17.1 s.
// Alone through Vitest: 19.4 s. Under the full parallel npm test (211 files, 1560 tests): 67.1 s,
// 3.5 times slower, as a type-checking ts-node child is under that load (backupState,
// commitTaxonomyGate). The child gets 240 s and the test 250 s, as for the commit taxonomy and
// signing census self-tests; the full-run time is 28 percent of the child limit.
const CHILD_TIMEOUT_MS = 240_000;
const TEST_TIMEOUT_MS = 250_000;

describe('check-recordings-compared.ts --self-test (AUDIT-06)', () => {
    it(
        'exits 0 and every rule case passes on throwaway repos and record folders',
        () => {
            const result = spawnRailedChild('npx', ['ts-node', 'scripts/check-recordings-compared.ts', '--self-test'], { timeoutMs: CHILD_TIMEOUT_MS });
            const output = `${result.stdout}\n${result.stderr}`;

            expect(result.status, output).toBe(0);
            for (const name of CASES) {
                expect(result.stdout, `case ${name}\n${output}`).toMatch(new RegExp(`^ok   case:${escape(name)}: `, 'm'));
            }
            // The 23-25 gap: the commit check passes the swap and this check names the old file.
            expect(result.stdout, output).toMatch(/^ok {3}case:23-25-gap-[^:]+: commit check passes [0-9a-f]{12} \(1 judged, 0 violations\); here exit 1: .*NEVER COMPARED "flashbots-v2-trailing\.jsonl"/m);
            expect(output).not.toMatch(/^FAIL/m);
            expect(result.stdout, output).toMatch(new RegExp(`^SELF-TEST PASS ${CASES.length} of ${CASES.length} cases$`, 'm'));
        },
        TEST_TIMEOUT_MS,
    );
});
