// test/unit/ci/rootFileGuard.test.ts
// Phase 20 / Plan 20-07 / Task 3 / OPS-LIVE-12 — self-test of the CI guard YAML.
//
// Per Blocker 2 (Wave 5 sampling gap): provides a vitest automated command
// covering the CI guard step authored in Task 1. The test does NOT execute
// the CI guard against the repo root; it self-tests that the guard YAML is
// correctly authored so future regressions on the workflow file (e.g.,
// accidental removal of the step, change of the file-absence check from
// `test ! -e` to `test ! -f`, or reordering that moves the guard after
// expensive tsc jobs) are caught by vitest before they reach CI.
//
// References:
//   .planning/phases/20-going-live-ops-hardening/20-07-PLAN.md Task 3
//   .planning/phases/20-going-live-ops-hardening/20-VALIDATION.md
//     (Per-Task Verification Map — 20-07-Task3 row)
//   .planning/phases/20-going-live-ops-hardening/20-CONTEXT.md
//     §D-RUNBOOK-MOVE + §D-BRIEFING-DELETE
//
// Pattern reuse:
//   - Synchronous fs.readFileSync against the workflow file at a stable path
//     under process.cwd() (mirrors test/unit/db/lpBaselineMigration.test.ts
//     shape — production-relevant invariant asserted against the real file
//     on disk, not a mock).
//   - No external deps beyond vitest + node:fs + node:path (all in dev deps).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const WORKFLOW_PATH = path.resolve(process.cwd(), '.github/workflows/test.yml');

describe('CI guard: Ban root-level operator-facing docs', () => {
    // Read once at module load — the workflow file is static for the test run.
    // Each `it()` block does its own assertions against the same string.
    const yml = fs.readFileSync(WORKFLOW_PATH, 'utf8');

    it('reads .github/workflows/test.yml successfully (non-empty)', () => {
        // Sanity check — the file must exist and have content. If this fails,
        // the workflow file was deleted (a far more severe issue than the
        // guard regressing).
        expect(yml.length).toBeGreaterThan(0);
    });

    it('contains the "Ban root-level operator-facing docs" step name', () => {
        // The step name is the canonical identifier per Plan 20-07 Task 1
        // <action> step 4. Any rename to this step name without updating
        // this test means the guard intent is being lost. Match the exact
        // YAML `- name:` shape (with optional whitespace tolerance).
        expect(yml).toMatch(/- name:\s*Ban root-level operator-facing docs/);
    });

    it('asserts absence of GOING-LIVE.md AND HONEYPOT-SIM-BRIEFING.md in the run: block', () => {
        // The step body MUST contain BOTH file-absence checks. The Plan 20-07
        // spec (and Blocker 2 sampling-gap fix) requires `-e` (existence
        // check; file-or-directory) rather than `-f` (regular-file-only),
        // because either path becoming a directory in error is still a
        // re-introduction violation that should fail the build.
        //
        // Extract the step body by slicing from the step name to the next
        // `- name:` step boundary (or EOF) so the assertion is scoped to
        // THIS step's run: block and cannot accidentally pass on text from
        // an unrelated downstream step.
        const startIdx = yml.indexOf('Ban root-level operator-facing docs');
        expect(startIdx).toBeGreaterThan(-1);
        const tail = yml.substring(startIdx);
        const nextStepIdx = tail.indexOf('- name:', 1);
        const stepBody = nextStepIdx === -1 ? tail : tail.substring(0, nextStepIdx);

        expect(stepBody).toMatch(/test\s+!\s+-e\s+GOING-LIVE\.md/);
        expect(stepBody).toMatch(/test\s+!\s+-e\s+HONEYPOT-SIM-BRIEFING\.md/);
    });

    it('positions the guard step early — before the TypeScript check step', () => {
        // The guard must fail fast: it runs at the file-system level, costs
        // ~milliseconds, and a root-doc reintroduction should not waste
        // the ~30-second tsc x 3 runtime ahead of it. Assert positional
        // precedence over the TypeScript-check step (or, if that step is
        // renamed, fall back to "in the first half of the file" as a
        // weaker but still meaningful invariant).
        const guardIdx = yml.indexOf('Ban root-level operator-facing docs');
        // The TypeScript check steps are named like "TypeScript check
        // (root tsconfig.json)". Match the first occurrence of any of the
        // common names so this test does not falsely fail if the step name
        // is tweaked in the future.
        const tscIdx = yml.search(/- name:\s*(TypeScript|tsc|Type check)/i);

        if (tscIdx !== -1) {
            expect(guardIdx).toBeLessThan(tscIdx);
        } else {
            // Fallback: workflow restructure removed the recognised TS step
            // names. Weaker invariant — guard must still be in the first
            // half of the file (early-fail), which catches the worst case
            // of "guard moved to the end of the workflow."
            expect(guardIdx).toBeLessThan(yml.length / 2);
        }
    });
});
