// test/unit/signingCensusGate.test.ts
//
// Phase 23 plan 23-17 (CHAR-04, AC-32 to AC-36, AC-53): regression wrapper of the signing census
// gate's self-test. The self-test builds throwaway projects and git repos under the OS temp folder
// and runs the real census, the real gate and the real floor-history walk against them, so neither
// the working tree's signing sites nor its git history are inputs. It runs in a railed child
// because the script is a separate program with its own exit codes.

import { describe, it, expect } from 'vitest';
import { spawnRailedChild } from '../rails/spawnRailedChild';

// One deliberate example per failure the census must catch, plus the passing baselines.
const GATE_CASES = [
    'AC-33-exactly-23-sites-passes',
    'AC-33-22-sites-fails',
    'AC-32-new-unlocked-site-in-src-and-scripts-fails',
    'AC-35-listed-exception-removed-fails',
    'AC-35-listed-exception-fixed-fails',
    'AC-35-listed-count-above-the-code-fails',
    'AC-36-no-files-fails',
    'AC-36-no-sites-fails',
    'CR-08-delegated-send-outside-lock-fails',
    'CR-09-method-value-outside-lock-fails',
    'WR-23-unchecked-send-outside-lock-fails',
    'F3-unknown-lock-status-fails',
    'F3-stale-exclusion-fails',
    'AC-53-missing-decision-ref-fails',
    'AC-53-decision-record-not-covering-finding-fails',
    'AC-53-decision-record-not-found-fails',
    'AC-53-finding-not-registered-fails',
    'T-23-22-excluding-a-signing-site-fails',
    'exceptions-file-unsorted-fails',
    'file-outside-tsconfig-include-fails',
    'WR-25-signing-cjs-and-mts-scripts-fail',
    'WR-25-js-file-outside-tsconfig-include-fails',
    'flag7-never-opens-env-or-data',
    'AC-34-floor-drop-naming-its-finding-passes',
    'AC-34-floor-drop-without-a-finding-fails',
    'AC-34-floor-drop-naming-an-unregistered-finding-fails',
    'AC-34-deleting-the-exceptions-file-fails',
    'AC-34-shallow-clone-refused',
];
const ANALYSIS_CASES = 54;

// Limits (measured on Node 22.16.0, 2026-11-12): the self-test builds 11 census programs over the
// ethers types plus 6 throwaway git repos. Alone: 23 s through Vitest (30 s run directly). Under
// the full parallel npm test: 59.7 s, which is 54 percent of the 110 s child limit first planned,
// so the child gets 240 s and the test 250 s (the full-run time is 25 percent of the child limit).
const CHILD_TIMEOUT_MS = 240_000;
const TEST_TIMEOUT_MS = 250_000;

describe('check-signing-census.ts --self-test (CHAR-04)', () => {
    it(
        'exits 0, the 31 Phase 22 analysis cases pass and every gate case passes',
        () => {
            const result = spawnRailedChild('npx', ['ts-node', 'scripts/check-signing-census.ts', '--self-test'], { timeoutMs: CHILD_TIMEOUT_MS });
            const output = `${result.stdout}\n${result.stderr}`;

            expect(result.status, output).toBe(0);
            expect(result.stdout, output).toMatch(new RegExp(`^analysis cases: ${ANALYSIS_CASES} of ${ANALYSIS_CASES} passed`, 'm'));
            for (const name of GATE_CASES) {
                expect(result.stdout, `gate case ${name}\n${output}`).toMatch(new RegExp(`^ok   gate:${name}: `, 'm'));
            }
            expect(output).not.toMatch(/^FAIL/m);
            const total = ANALYSIS_CASES + GATE_CASES.length;
            expect(result.stdout, output).toMatch(new RegExp(`^SELF-TEST PASS ${total} of ${total} cases \\(${ANALYSIS_CASES} census analysis \\+ ${GATE_CASES.length} gate\\)`, 'm'));
        },
        TEST_TIMEOUT_MS,
    );
});
