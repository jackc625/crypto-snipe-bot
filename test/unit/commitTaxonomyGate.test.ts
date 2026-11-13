// test/unit/commitTaxonomyGate.test.ts
//
// Phase 23 plan 23-25 (AUDIT-06, AC-39 to AC-44, D-17, D-18, A-2): regression wrapper of the commit
// taxonomy check's self-test. The self-test builds throwaway git repos under the OS temp folder and
// runs the real judgement against their deliberately violating and passing commits, so neither this
// repository's history nor its working tree is an input (AC-43). It runs in a railed child because
// the script is a separate program with its own exit codes, and because git may only be started
// from scripts/ (test/unit/rails/spawnSites.test.ts). git is found on the PATH the railed child
// inherits; the rails do not hook child_process.

import { describe, it, expect } from 'vitest';
import { spawnRailedChild } from '../rails/spawnRailedChild';

// One case per rule, each with its passing or failing counterpart.
const CASES = [
    'AC-44-clean-history-passes-and-names-the-first-recording-commit',
    'AC-44-commits-before-the-first-recording-commit-are-not-judged',
    'AC-39-edit-by-any-non-behavior-type-fails',
    'AC-39-edit-as-behavior-citing-a-real-id-passes',
    'AC-41-behavior-without-an-id-fails',
    'AC-41-behavior-citing-an-id-absent-from-the-register-fails',
    'AC-41-an-id-inside-a-longer-token-is-not-an-id',
    'AC-41-an-id-that-exists-only-in-a-later-commit-fails',
    'AC-40-a-brand-new-scenario-passes',
    'AC-40-a-near-identical-new-file-passes-as-an-add-not-a-copy',
    'A-2-a-new-env-variable-passes',
    'A-2-changing-an-env-case-needs-a-behavior-commit',
    'AC-39-deleting-a-recording-fails-unless-behavior',
    'AC-39-deleting-a-recording-as-behavior-citing-a-real-id-passes',
    'T-23-41-delete-then-a-later-re-add-of-the-same-path-fails',
    'rename-fails-as-a-delete-plus-an-add',
    'AC-42-a-merge-is-not-judged-and-its-inner-commits-are',
    'AC-42-a-clean-merge-of-valid-commits-passes',
    'WR-27-a-merge-whose-conflict-resolution-alone-changes-a-recording-fails',
    'WR-27-a-no-conflict-merge-that-edits-a-recording-fails',
    'WR-27-a-merge-resolution-as-behavior-citing-a-real-id-passes',
    'WR-27-a-behavior-merge-citing-an-unknown-id-fails',
    'T-23-41-a-path-added-on-a-side-line-forked-before-the-recording-fails',
    'AC-40-the-same-new-scenario-added-on-two-lines-passes',
    'T-23-41-an-unrelated-root-commit-adding-an-existing-path-fails',
    'nothing-after-the-first-recording-commit-exits-2',
    'T-23-31-a-shallow-clone-exits-non-zero',
    'a-case-variant-path-is-the-same-protected-file',
    'no-recording-commit-exits-2',
    'LF-under-core.autocrlf=true-no-spurious-change-and-a-real-edit-is-seen',
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Limits (measured on Node 22.16.0, 2026-11-12): the self-test makes about 400 git calls across 27
// cases (about 70 throwaway commits), and git process start-up is most of its time. Alone through
// Vitest: 35.1 s (31.7 s run directly). Under the full parallel npm test: 75.1 s, which is 68 percent
// of the 110 s child limit first planned, so the child gets 240 s and the test 250 s, as for the
// signing census self-test (the full-run time is 31 percent of the child limit).
const CHILD_TIMEOUT_MS = 240_000;
const TEST_TIMEOUT_MS = 250_000;

describe('check-commit-taxonomy.ts --self-test (AUDIT-06)', () => {
    it(
        'exits 0 and every rule case passes on throwaway repos',
        () => {
            const result = spawnRailedChild('npx', ['ts-node', 'scripts/check-commit-taxonomy.ts', '--self-test'], { timeoutMs: CHILD_TIMEOUT_MS });
            const output = `${result.stdout}\n${result.stderr}`;

            expect(result.status, output).toBe(0);
            for (const name of CASES) {
                expect(result.stdout, `case ${name}\n${output}`).toMatch(new RegExp(`^ok   case:${escape(name)}: `, 'm'));
            }
            // WR-27: a merge whose own result changes a recording is judged; without behavior: it fails (exit 1).
            expect(result.stdout, output).toMatch(/^ok {3}case:WR-27-a-merge-whose-conflict-resolution-alone-changes-a-recording-fails: exit 1; /m);
            expect(result.stdout, output).toMatch(/^ok {3}case:WR-27-a-no-conflict-merge-that-edits-a-recording-fails: exit 1; /m);
            expect(output).not.toMatch(/^FAIL/m);
            expect(result.stdout, output).toMatch(new RegExp(`^SELF-TEST PASS ${CASES.length} of ${CASES.length} cases$`, 'm'));
        },
        TEST_TIMEOUT_MS,
    );
});
