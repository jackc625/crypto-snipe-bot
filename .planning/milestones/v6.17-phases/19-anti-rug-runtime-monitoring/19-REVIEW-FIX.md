---
phase: 19-anti-rug-runtime-monitoring
fixed_at: 2026-05-24
fix_scope: critical_warning
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
iteration: 2
predecessor_iteration: 1
predecessor_review: 19-REVIEW.iter1.md
source_review: 19-REVIEW.md
---

# Phase 19: Code Review Fix Report (Iteration 2)

**Fixed at:** 2026-05-24
**Source review:** `.planning/phases/19-anti-rug-runtime-monitoring/19-REVIEW.md`
**Iteration:** 2 (follow-up to iter-1)
**Worktree:** `/tmp/sv-19-reviewfix-3UgmAD` (`gsd-reviewfix/19-56877`) — fast-forwarded into master on cleanup.

**Iter-1 report note.** The previous iter-1 fix report (15 fixed, 1 skipped across 16 in-scope findings) has been replaced by this file but is preserved in git history at commit `2db8a2f`. The 15 iter-1 fix commits themselves (`757b0d1..bcabc0f` plus the test-update commit `2b93bb3`) are still present on master; iter-2 verified their closure in `19-REVIEW.md` and surfaced two new follow-up findings — WR-08-FOLLOWUP and CR-06-FOLLOWUP — both warning-tier, neither blocks shipping, but both worth closing before live-execute graduation. This report covers ONLY those two iter-2 follow-ups.

**Summary:**

- Findings in scope: 2 (WR-08-FOLLOWUP, CR-06-FOLLOWUP — both warning-tier)
- Fixed: 2
- Skipped: 0
- TypeScript: bot + main + dashboard tsconfigs all clean
- Test suites: 26/26 (antiRugConfig) + 67/67 (dashboard anti-rug components) + 6/6 (exitTrigger backend) + 4/4 (wsPush integration) all pass after the fixes; spot-check of `test/unit/anti-rug/*.test.ts` per file: 73/73 pass
- CR-07 (circular import) NOT touched per iter-1 deferral; remains for a future dedicated phase
- IN-01..IN-06 NOT touched per iter-2 task spec (kept tight)

## Fixed Issues

### WR-08-FOLLOWUP: New ALLOWLIST_EXTRA_V2/V3 env vars registered + documented

**Files modified:**
- `src/config.ts`
- `.env.example`
- `docs/operations/anti-rug-rollout.md`
- `docs/operations/anti-rug-tuning.md`

**Commit:** `e42c21b`

**Applied fix:** Closes the docs/registry gap left by iter-1 WR-08. The four-part fix:

- **(a) `src/config.ts`** — added 8 new entries to `REQUIRED_ENV_VARS`: `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA_V2` and `_V3` for each of the 4 chains (ETH, BSC, BASE, ARB). Each entry mirrors the existing `ALLOWLIST_EXTRA` shape (`required: false`, comma-separated address list, clear description). Reworded the existing unified `ALLOWLIST_EXTRA` description to flag DEPRECATED + the per-pool-type recommendation. Bumped the header comment from "9 vars × 4 chains = 36 entries (8 numeric + 1 comma-list per chain)" to "11 vars × 4 chains = 44 entries (8 numeric + 3 comma-list per chain)".

- **(b) `.env.example`** — added 8 new entries (ALLOWLIST_EXTRA_V2 and _V3 for each chain), mirroring the existing `ALLOWLIST_EXTRA` inline-comment style. Reworded the unified `ALLOWLIST_EXTRA` lines to flag DEPRECATED + the deprecation-warn semantics.

- **(c) `docs/operations/anti-rug-rollout.md`** — replaced the single `ALLOWLIST_EXTRA` row in §1's env-var-reference table with three rows (legacy unified DEPRECATED with the warn op-code, V2-only, V3-only). Bumped the "9 env vars per chain × 4 chains = 36 env vars total" claim to "11 env vars per chain × 4 chains = 44 env vars total". Updated the §7 "Env-var-count delta vs original D-ENV-EXAMPLE" subsection to document all four delta additions (`BACKFILL_CAP_BLOCKS`, `MAX_BACKFILL_BLOCKS`, `ALLOWLIST_EXTRA_V2`, `ALLOWLIST_EXTRA_V3`) and the per-pool-type motivation.

- **(d) `docs/operations/anti-rug-tuning.md`** — replaced the single `ALLOWLIST_EXTRA` row in the allowlist-overlay table with three rows. Added a migration note explaining that already-correct entries keep their semantics (the deprecation is operator-hygiene + review-time clarity), so migration is opportunistic, not urgent.

The runtime parser at `src/chainRegistry.ts:835` reads `process.env[envKey]` directly, so the new env vars already worked at runtime when an operator happened to set them — this fix makes them DISCOVERABLE via the canonical source-of-truth surfaces (config.ts + .env.example + operator docs).

**Verification:**
- `tsc --noEmit -p tsconfig.bot.json`: clean
- `tsc --noEmit`: clean
- `tsc --noEmit -p dashboard/tsconfig.json`: clean
- `vitest run test/unit/chainRegistry/antiRugConfig.test.ts`: 26/26 pass (Test 19's `length >= 32` continues to hold for the new count of 44; IN-01's recommendation to tighten to exact equality was intentionally not pulled in per iter-2 scope)

### CR-06-FOLLOWUP: Surface live-exit success/failure on the dashboard

**Files modified:**
- `dashboard/src/types/api.ts`
- `dashboard/src/hooks/useWebSocket.ts`
- `dashboard/src/components/anti-rug/AntiRugStateBadge.tsx`
- `dashboard/src/components/PositionTable.tsx`
- `dashboard/src/components/anti-rug/AntiRugExitDetailModal.tsx`
- `dashboard/src/pages/Overview.tsx`

**Commit:** `74417d3`

**Applied fix:** Threads the wire payload's `success: boolean` field (already declared in `AntiRugStateUpdate` and already broadcast from `exitTrigger.ts:259` per iter-1 CR-06) through the dashboard consumer chain so the operator can distinguish a successful live exit from a failed one. The fix is dashboard-only — no backend changes are required:

1. **`api.ts`** — Added `antiRugLastSuccess?: boolean` to the `Position` interface, documented to mirror `AntiRugStateUpdate.success` on the wire and to be meaningful only when `antiRugState === 'exit-fired'`.

2. **`useWebSocket.ts`** — Captured `update.success` into the new `antiRugLastSuccess` field in the `antirug_state_update` handler. Previously dropped silently — only `state`, `lastEventTs`, and `lastSignals` were merged into the Position row.

3. **`AntiRugStateBadge.tsx`** — Added a `success?: boolean` prop. When `state === 'exit-fired'`, the label is augmented with a `✓` (success) / `✗` (failure) glyph; `success === undefined` keeps the original 'Exit fired' label unchanged. For every state OTHER than `'exit-fired'`, the prop is ignored — the 6-badge visual contract from UI-SPEC §"Anti-Rug column header and badges" is preserved unchanged. The glyph is appended rather than swapping the badge background color (still `bg-loss` on `'exit-fired'`) so the existing color-token contract is preserved and source-grep tests for `bg-loss` / `'Exit fired'` continue to pass.

4. **`PositionTable.tsx`** — Introduced an `antiRugTooltipFor(state, chain, success?)` helper that overrides the base `'exit-fired'` tooltip with EXIT SUCCEEDED / EXIT FAILED variants when `success` is present. Threads `position.antiRugLastSuccess` into the badge's new `success` prop.

5. **`AntiRugExitDetailModal.tsx`** — Added a `success?: boolean` prop. When `variant === 'live'`, renders a green-bordered banner ("EXIT SUCCEEDED — executeFullSell returned true on {CHAIN}. The position is closed...") on `success === true`, or a red-bordered banner ("EXIT FAILED — executeFullSell returned false on {CHAIN}. The position is still open AND a trigger slot was consumed...") on `success === false`. The banner appears above the existing tx-artifacts block. The failure-banner copy explicitly tells the operator the actionable consequences (position still open, trigger slot consumed, CB closer to tripping, consider manual Force Sell).

6. **`Overview.tsx`** — Threaded `detailPosition?.antiRugLastSuccess` into the modal's new `success` prop.

**Verification:**
- `tsc --noEmit -p tsconfig.bot.json`: clean
- `tsc --noEmit`: clean
- `tsc --noEmit -p dashboard/tsconfig.json`: clean
- `vitest run test/unit/dashboard/anti-rug/`: 67/67 pass (includes the AntiRugStateBadge source-grep guards in `displayComponents.test.ts` which assert all 6 state strings, all 6 verbatim labels, and the `bg-profit`/`bg-warning`/`bg-loss`/`#1f2937`/`border-loss`/`text-text-disabled` color tokens — all preserved)
- `vitest run test/unit/anti-rug/exitTrigger.test.ts`: 6/6 pass (backend wire shape unchanged — `exitTrigger.ts:259` already sends `success` on the exit-fired path; this commit only consumes it)
- `vitest run test/integration/api/wsPush.test.ts`: 4/4 pass

**Logic-correctness note:** This fix is presentation-only. The `success` boolean propagates verbatim from `executeFullSell`'s return value through `exitTrigger.ts:259` → wire → `useWebSocket.ts` → Position state → badge + modal. No new conditional logic that could introduce an off-by-one or wrong-state-handling bug. Classified as `"fixed"`, not `"fixed: requires human verification"`.

## Skipped Issues

None — both in-scope iter-2 findings were fixed successfully.

## Out-of-Scope Findings

Per iter-2 task spec, deliberately NOT touched in this iteration:

- **CR-07 (circular import)** — Intentionally deferred per iter-1 fix report. Vitest mock-cache friction with all three resolution paths; recommended for a separate phase with `eslint-plugin-import/no-cycle` landing first.

- **IN-01 (test tightening to exact 44)** — Out of iter-2 scope. The existing `>= 32` assertion in `antiRugConfig.test.ts:357-363` continues to hold for the new 44-count from WR-08-FOLLOWUP. Recommended to tighten in a future iteration (the review's Recommendation §5).

- **IN-02..IN-06** — All Info-tier; out of iter-2 scope (kept tight to the two new follow-up warnings).

## Closure Status Across Iterations

Combined view across iter-1 + iter-2 fix cycles, mirroring the source review's closure table:

| Finding | Iter-1 Status | Iter-2 Status | Notes |
|---|---|---|---|
| CR-01: cb_tripped payload field mismatch | CLOSED (iter-1 commits `757b0d1` + `2b93bb3`) | unchanged | — |
| CR-02: Flashbots EIP-1559 gas | CLOSED (`1708ed4`) | unchanged | — |
| CR-03: registerAntiRugPosition not awaited | CLOSED (`7b248f6`) | unchanged | — |
| CR-04: Allowlist verify failure → silent unverified | CLOSED (`8491733`) | unchanged | — |
| CR-05: Resume path no-ops with zero positions | CLOSED (`2c4e4ff`) | unchanged | — |
| CR-06: AntiRugStateUpdate success + null/undefined drift | PARTIALLY CLOSED (`3412280`) | **CLOSED** (iter-2 `74417d3` — CR-06-FOLLOWUP) | Wire was fixed in iter-1; UI consumer added in iter-2 |
| CR-07: Circular import | NOT CLOSED (skipped) | NOT CLOSED (skipped, deferred) | Latent; recommend separate phase with import/no-cycle ESLint |
| WR-01..WR-07 | CLOSED (iter-1) | unchanged | — |
| WR-08: ALLOWLIST_EXTRA per-pool-type | PARTIALLY CLOSED (`f08406c`) | **CLOSED** (iter-2 `e42c21b` — WR-08-FOLLOWUP) | Code in iter-1; config + .env.example + 2 docs in iter-2 |
| WR-09: gap-detected missing pair | CLOSED (`bcabc0f`) | unchanged | — |
| IN-01..IN-06 | NOT IN SCOPE | NOT IN SCOPE | Per `fix_scope: critical_warning` |

After iter-2: **15 of 16 in-scope critical+warning findings fully closed** across both iterations. CR-07 (circular import) remains deferred — latent (no runtime symptom; cycle is at function-body boundaries only), recommended for a future dedicated phase.

## Test Plan Coverage (iter-2 only)

After both iter-2 fixes:
- `tsc --noEmit -p tsconfig.bot.json` — clean
- `tsc --noEmit -p tsconfig.json` — clean
- `tsc --noEmit -p dashboard/tsconfig.json` — clean
- `vitest run test/unit/chainRegistry/antiRugConfig.test.ts` — 26/26 pass
- `vitest run test/unit/dashboard/anti-rug/` — 67/67 pass (display + interactive components)
- `vitest run test/unit/anti-rug/exitTrigger.test.ts` — 6/6 pass
- `vitest run test/integration/api/wsPush.test.ts` — 4/4 pass
- Spot-check: `vitest run test/unit/anti-rug/*.test.ts` (each file individually) — 73/73 pass across all 8 anti-rug test files

No test that previously passed now fails. No backend wire-shape change in iter-2 (the success field was already on the wire from iter-1 commit `3412280`); iter-2 only added a frontend consumer. (Note: a multi-file batched vitest run in the isolated worktree shows pre-existing worker-isolation noise unrelated to the iter-2 changes — the same batched run on the main repo cwd passes 140/140, and each worktree test file passes individually. This is environmental noise, not a regression.)

## Production Safety Notes (iter-2)

Neither iter-2 fix touches live-execute semantics:

- **WR-08-FOLLOWUP** is docs + env-registry. The runtime parser (`src/chainRegistry.ts:835`) is unchanged. Operators who previously used the unified `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA` see no change in behavior; the deprecation-warn fires once at startup, recommending migration.

- **CR-06-FOLLOWUP** is dashboard presentation only. The `success` boolean already crossed the wire from iter-1; iter-2 just consumes it. No backend logic change, no new evaluator branch, no new exit path. The operator gets a clearer signal on a failed live exit (red banner + ✗ glyph + tooltip) but the bot's exit behavior is unchanged.

The three fork-test recommendations from iter-1 (CR-02 EIP-1559 verification, WR-03 V3 sell-sim slippage assertion, WR-04 V2 reserve oscillation tolerance) are unchanged and still recommended before any chain graduates to `LIVE_EXECUTE=true`.

---

_Fixed: 2026-05-24_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2 (follow-up to iter-1; iter-1 report content preserved in git at commit `2db8a2f`)_
