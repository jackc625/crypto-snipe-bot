# Phase 21.2 — Deferred / Out-of-Scope Items

Items discovered during plan execution that are OUTSIDE the executing plan's
scope (SCOPE BOUNDARY rule). Logged here, NOT fixed in-flight.

---

## D-09-01 — Two stale exitEngine test files missing the 21.2-07 `markExitFailedHeld` mock

- **Discovered during:** 21.2-09 execution (full `--project unit` regression run).
- **Symptom:** 3 failing unit tests across 2 files:
  - `test/unit/exitEngineSell.test.ts` — "records non-null amountOut/gasCost/block…" and
    "submits sell tx and inserts a sell row when invoked with reason=\"stop-loss\""
  - `test/unit/exitEngineZeroBalance.test.ts` — "non-zero balance still proceeds to on-chain sell (control case)"
  - Error: `TypeError: markExitFailedHeld.run is not a function` (and the balance-truth gate
    reading the mock's full post-sell `balanceOf` as "still held").
- **Root cause (NOT a 21.2-09 regression):** Wave 21.2-07 (`0926ef4`) added
  `markExitFailedHeld.run(tradeId)` to `executeFullSell`'s balance-truth teardown and changed
  the post-sell `balanceOf` re-fetch semantics. The 21.2-07 SUMMARY records that it updated the
  sibling mock harnesses `exitInclusionLadder.test.ts` + `opEnrichment.test.ts` for the new call
  shape, but it MISSED these two OLDER test files (their db mock lacks `markExitFailedHeld` and
  their `balanceOf` mock returns the full balance after a "successful" sell → the correct
  balance-truth gate reads still-held → calls the unmocked `markExitFailedHeld.run` → throws).
- **Why out of scope for 21.2-09:** plan 21.2-09 touches ONLY the two-stage SIGINT + the
  exit-worker watchdog. `git diff 96d82de HEAD -- src/exitEngine.ts` confirms my changes are
  confined to the `ExitWorker` class region (lines ~1131-1318); `executeFullSell` (lines
  ~434-1055) and `markExitFailedHeld` are untouched by 21.2-09.
- **Fix (deferred):** update the two stale files' db mock to include
  `markExitFailedHeld: { run: vi.fn() }` and adjust their post-sell `balanceOf` mock to return
  dust (≤ threshold) so the genuine-close teardown path runs — exactly the pattern 21.2-07
  applied to `exitInclusionLadder.test.ts` / `opEnrichment.test.ts`. No SOURCE change needed; the
  balance-truth logic is correct (proven green by the updated sibling tests).
- **Severity:** test-only (stale mocks). The SOURCE balance-truth / keep-monitoring capital-safety
  logic is correct and covered by the up-to-date tests (`antiRugReason.test.ts`,
  `failedExitBalanceTruth.test.ts`, `exitInclusionLadder.test.ts`, `opEnrichment.test.ts`).
- **Recommended owner:** a follow-up test-hygiene fix (e.g. `/gsd:fast`) or fold into the next
  exit-engine plan. Surfaced (not silently deferred) per project memory D-STOP-THE-LINE.
