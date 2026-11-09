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
            const result = spawnRailedChild('npx', ['ts-node', 'scripts/backup-state.ts', '--self-check'], { timeoutMs: 110_000 });
            const output = `${result.stdout}\n${result.stderr}`;

            expect(result.status, output).toBe(0);
            for (const id of CASES) {
                expect(result.stdout, `case (${id})`).toMatch(new RegExp(`^PASS \\(${id}\\) `, 'm'));
            }
            expect(result.stdout).not.toMatch(/^FAIL \(/m);
            expect(result.stdout).toMatch(new RegExp(`^SELF-CHECK PASSED: ${CASES.length}/${CASES.length} cases`, 'm'));
        },
        120_000,
    );
});
