// test/integration/backupState.test.ts
//
// Phase 22 plan 22-15 (D-11): regression wrapper of the backup tool's fixture self-check. The
// self-check builds throwaway trees under the OS temp folder and runs the real build and verify
// code against them, so the live data/ folder is not an input. It runs in a railed child because
// the script is a separate program with its own process.exit paths.

import { describe, it, expect } from 'vitest';
import { spawnRailedChild } from '../rails/spawnRailedChild';

const CASES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

describe('backup-state.ts --self-check (D-11)', () => {
    it(
        'exits 0 and every fixture case passes',
        () => {
            // Limits raised (orchestrator, phase 23 wave 13 gate, 2026-11-12): the type-checking
            // npx ts-node child slows about fivefold under the full parallel run's CPU load. Measured
            // 12.7 s alone; 47.6 to 69.5 s across the full runs of plans 23-19 to 23-24 (67.5 s, 56%
            // of the old 120 s limit, at the wave 13 gate). Root fix is Phase 28 (deferred-items.md).
            const result = spawnRailedChild('npx', ['ts-node', 'scripts/backup-state.ts', '--self-check'], { timeoutMs: 230_000 });
            const output = `${result.stdout}\n${result.stderr}`;

            expect(result.status, output).toBe(0);
            for (const id of CASES) {
                expect(result.stdout, `case (${id})`).toMatch(new RegExp(`^PASS \\(${id}\\) `, 'm'));
            }
            expect(result.stdout).not.toMatch(/^FAIL \(/m);
            expect(result.stdout).toMatch(new RegExp(`^SELF-CHECK PASSED: ${CASES.length}/${CASES.length} cases`, 'm'));
        },
        240_000,
    );
});
