---
phase: 14-sell-revenue-receipt-decoding
plan: 02
subsystem: trading
tags: [exit-engine, flashbots, mev, receipt-decoding, sell-revenue, vitest, integration-tests]

# Dependency graph
requires:
  - phase: 14-sell-revenue-receipt-decoding-01
    provides: decodeReceipt utility (ReceiptData with amountOut/gasCost/blockNumber)
  - phase: 04-multi-chain-architecture
    provides: ChainContext.httpProvider and ChainContext.chain.wethAddress used by decodeReceipt
  - phase: 07-smart-exit-strategies
    provides: executeFullSell and executePartialSell sell-path entry points
provides:
  - executeFullSell records actual ETH/BNB received in trades.amount_out (was always null)
  - executePartialSell records actual ETH/BNB received in partial_sell rows (was always null)
  - Flashbots strategy returns the real tx hash from bundleTransactions[0].hash with defensive guard
  - Execution-path tests proving decoded receipt data flows into insertTrade.run (replaces grep-only verification)
  - Flashbots adapter regression tests for real-hash and missing-hash failure modes
  - bloXroute regression coverage documenting that the BSC path has no synthetic-hash bug
affects: [getPnL, dashboard-pnl, risk-daily-loss, trade-history, future-multi-hop-routers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "if-txHash guard before decodeReceipt: graceful fallback to nulls when sendTxWithRetry returns void (legacy single-chain path)"
    - "Defensive optional-chaining + descriptive throw on Flashbots bundle response shape (bundle.bundleTransactions?.[0]?.hash)"
    - "Mocked-module execution-path tests for sell flow: decodeReceipt + insertTrade + sendTxWithRetry mocks assert end-to-end data flow without a real chain"
    - "Real MockContract class instead of vi.fn().mockImplementation to survive vitest mockReset: true"

key-files:
  created:
    - test/unit/exitEngineSell.test.ts
  modified:
    - src/exitEngine.ts
    - src/utils/mevStrategies/flashbots.ts
    - test/integration/mevStrategies.test.ts
    - test/integration/txManager.test.ts

key-decisions:
  - "Default receiptData object declared as a typed local with literal nulls so the if-txHash guard can leave it untouched on the legacy path -- keeps grep checks satisfied at the insertTrade.run call site (no hardcoded amountOut: null inside the named param object)"
  - "Flashbots defensive guard throws instead of falling back to a synthetic value -- a missing hash means the library shape is wrong and silent fallback would re-introduce the original bug"
  - "Test 3 (executePartialSell receipt decoding) covers only the GREEN data-flow path -- the executeFullSell legacy-void test already proves the if-txHash guard, so duplicating it for partial_sell adds no signal"
  - "Use a real MockContract class for the ethers mock in exitEngineSell.test.ts -- vitest config has mockReset: true, which wipes vi.fn().mockImplementation between tests; a class survives mockReset and keeps the constructor stable"
  - "Auto-fixed two pre-existing txManager.test.ts mocks broken by Task 1's defensive guard (Rule 1) -- they had Flashbots sendBundle responses without bundleTransactions, which the new throw rejects; the fix is mechanical (add bundleTransactions[0].hash to the mock returns)"

patterns-established:
  - "Sell path receipt decoding: sendTxWithRetry -> if (txHash) decodeReceipt -> insertTrade.run with non-null amountOut/gasCost/block"
  - "Flashbots bundle response defensive parsing: optional chain on bundleTransactions[0].hash + descriptive error including target block"
  - "Execution-path tests for sell flows: mock decodeReceipt + insertTrade + sendTxWithRetry, then assert insertTrade.run was called with the decoded values via expect.objectContaining"

requirements-completed: [DB-03, DB-04]

# Metrics
duration: 10min
completed: 2026-04-07
---

# Phase 14 Plan 02: Sell Revenue Receipt Decoding -- exitEngine Wiring Summary

**Wires `decodeReceipt` into `executeFullSell` and `executePartialSell` so every multi-chain sell records actual ETH/BNB received, fixes the Flashbots synthetic-hash bug so ETH mainnet receipts can be decoded, and replaces grep-only verification with mocked-module execution-path tests that prove `insertTrade.run` receives the decoded values.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-07T00:33:19Z
- **Completed:** 2026-04-07T00:43:48Z
- **Tasks:** 3
- **Files created:** 1
- **Files modified:** 4

## Accomplishments

- `executeFullSell` now records non-null `amountOut`, `gasCost`, and `block` in the `trades` row when `decodeReceipt` returns data -- the source-code half of INT-AMOUNT-OUT-NULL is closed.
- `executePartialSell` does the same for `partial_sell` rows.
- `if (txHash)` guard added before both `decodeReceipt` calls so the legacy `txManager` `void`-returning path continues to record nulls without crashing (Pitfall 3).
- `FlashbotsMevStrategy.sendTransaction` now returns the real tx hash from `bundle.bundleTransactions[0].hash` instead of the synthetic `flashbots_bundle_block_${block}` placeholder. Defensive optional-chaining + descriptive `throw` ensures any future malformed library response fails loudly instead of silently casting `undefined` to string.
- New `test/unit/exitEngineSell.test.ts` (3 tests, 250 lines) -- mocks `decodeReceipt`, `sendTxWithRetry`, and `insertTrade` and asserts via `expect.objectContaining` that the decoded values flow into the DB call. Covers both the data-flow path and the legacy-void-path null fallback. This is the stronger verification posture required by REVIEWS.md action 8 (Codex HIGH severity).
- `test/integration/mevStrategies.test.ts` updated: existing `sendBundle` mocks now include `bundleTransactions: [{ hash: '0xrealtxhash...' }]` so they continue to pass under Task 1's new return contract; two new Flashbots tests prove the real-hash return and the missing-hash throw; one new bloXroute test documents that the BSC path correctly returns `data.result` unchanged (regression coverage for REVIEWS.md action 11).
- Auto-fixed two pre-existing mocks in `test/integration/txManager.test.ts` that broke after Task 1's defensive guard (see Deviations).
- Full test suite green: **142/142 unit tests passing, 122/122 integration tests passing** (264 total).

## Task Commits

Each task was committed atomically on master (sequential executor, no worktrees):

1. **Task 1: Wire decodeReceipt into exitEngine + fix Flashbots tx hash** -- `a543884` (feat)
2. **Task 2: Execution-path tests for executeFullSell and executePartialSell** -- `6a4d102` (test)
3. **Task 3: Update Flashbots integration tests + bloXroute regression + auto-fix txManager.test.ts** -- `6a800f7` (test)

_Note: Tasks 2 and 3 were marked `tdd="true"` in the plan, but since Task 1 already shipped the wiring, the new tests pass on first run rather than going through a separate RED phase. The plan's TDD designation here means "behavioral tests that prove the wiring", not "RED-then-GREEN against an unimplemented function". The plan's objective explicitly says these tests "prove" the wiring rather than drive it._

## Files Created/Modified

- `test/unit/exitEngineSell.test.ts` **(created, 250 lines)** -- 3 execution-path tests with module-mock pattern matching `test/unit/exitEngine.test.ts`. Adds `decodeReceiptMock` and `sendTxWithRetryMock` on top of the standard db/logger/config/exitManager/notifier stack. Uses a real `MockContract` class so vitest's `mockReset: true` does not wipe the constructor between tests.
- `src/exitEngine.ts` **(modified)** -- Added `import { decodeReceipt } from './utils/receiptDecoder';`. In both `executeFullSell` (line ~467) and `executePartialSell` (line ~563), inserted a `let receiptData = { amountOut: null, gasCost: null, blockNumber: null };` default followed by `if (txHash) { receiptData = await decodeReceipt(...); }` between `sendTxWithRetry` and `insertTrade.run`. Updated both `insertTrade.run` calls to pass `receiptData.amountOut`, `receiptData.gasCost`, `receiptData.blockNumber` instead of literal `null`. The two named-parameter objects no longer contain hardcoded nulls at the `amountOut`/`gasCost`/`block` keys.
- `src/utils/mevStrategies/flashbots.ts` **(modified)** -- Replaced the synthetic `return \`flashbots_bundle_block_${targetBlock}\`;` with `const realHash = bundle.bundleTransactions?.[0]?.hash; if (!realHash) throw new Error(\`Flashbots bundle response missing bundleTransactions[0].hash for block ${targetBlock}\`); return realHash;`. No other changes; the `MevStrategy.sendTransaction` interface still returns `Promise<string>`.
- `test/integration/mevStrategies.test.ts` **(modified)** -- Two existing `sendBundle` mocks updated to include `bundleTransactions: [{ hash: '0xrealtxhash...' }]`. Three new tests added: real-hash return assertion, missing-hash throw assertion, and bloXroute `data.result`-unchanged regression test.
- `test/integration/txManager.test.ts` **(modified, auto-fix)** -- Two pre-existing Flashbots `sendBundle` mocks (in the nonce-increment retry test and the targetBlockNumber test) had no `bundleTransactions` in their responses, which broke after Task 1's defensive guard. Added `bundleTransactions: [{ hash: '0xrealtxhash...' }]` to both mocks so they continue to exercise the retry/target-block logic without tripping the new throw.

## Decisions Made

- **Default `receiptData` object as a typed local with literal nulls**: rather than threading `null` directly into `insertTrade.run`'s named-parameter object, the default lives in a separate `let receiptData = { amountOut: null, gasCost: null, blockNumber: null }` declaration. This (a) keeps the `insertTrade.run` call site clean (`amountOut: receiptData.amountOut`), (b) lets the `if (txHash)` guard rebind the whole object atomically, and (c) satisfies the plan's grep acceptance criterion that `insertTrade.run` no longer contains `amountOut: null` literally. The `amountOut: null` literals that remain in the file are the default-value declarations, NOT the DB call site.
- **Flashbots defensive guard throws instead of falling back to a synthetic value**: a missing `bundleTransactions[0].hash` means either the Flashbots library API has changed or the relay returned a malformed response. Silently falling back to `flashbots_bundle_block_${block}` would re-introduce the very bug Phase 14 is fixing. Throwing surfaces the issue immediately and the existing retry loop catches it, so the user sees a real error in logs.
- **MockContract as a real class**: vitest's `mockReset: true` (set in `vitest.config.ts`) wipes `vi.fn().mockImplementation()` between tests, so a `Contract: vi.fn().mockImplementation(() => ({...}))` mock would return `undefined` after the first test runs. A plain ES6 class survives `mockReset` because it's not a vi mock. This is recorded as a pattern for future test files that need a stable ethers Contract mock.
- **Test 3 (executePartialSell) covers only the GREEN path**: the executeFullSell tests already cover both the GREEN data-flow path AND the legacy-void-path null fallback. Duplicating the legacy-void-path test for `executePartialSell` would add no signal -- the `if (txHash)` guard is the same code in both functions and both tests share the same `decodeReceipt` mock. The plan's `<behavior>` block lists exactly 3 tests (full-sell GREEN, full-sell void, partial-sell GREEN), which is what was implemented.
- **Auto-fix txManager.test.ts pre-existing mocks (Rule 1)**: after Task 1's defensive guard, two unrelated tests in `test/integration/txManager.test.ts` started throwing because their Flashbots `sendBundle` mocks didn't include `bundleTransactions`. This is a Rule 1 auto-fix: the fix is mechanical (add the field to the mock returns), the change is in test files only, and it restores green to a regression caused by Task 1.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing Flashbots mocks in txManager.test.ts broken by Task 1's defensive guard**
- **Found during:** Task 3 verification (`npx vitest run --project integration`)
- **Issue:** Two existing tests in `test/integration/txManager.test.ts` (`'increments nonce on each retry attempt (N, N+1, N+2)'` and `'includes correct targetBlockNumber = currentBlock + 1'`) had Flashbots `sendBundle` mocks that returned `{ bundleHash, wait }` without `bundleTransactions`. After Task 1, the strategy throws when `bundleTransactions[0].hash` is missing, so these tests started failing with `Flashbots bundle response missing bundleTransactions[0].hash`.
- **Fix:** Added `bundleTransactions: [{ hash: '0xrealtxhash...' }]` to both mock returns. The retry/target-block assertions are unchanged -- the new field is data-only and doesn't affect what those tests are checking.
- **Files modified:** `test/integration/txManager.test.ts`
- **Verification:** `npx vitest run --project integration` -- 122/122 passing (was 120/122 before fix)
- **Committed in:** `6a800f7` (folded into Task 3 commit, since the fix is the same kind of mock-shape update Task 3 was making in mevStrategies.test.ts)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug fix to test fixtures broken by the source change)
**Impact on plan:** Auto-fix is mechanical and necessary -- the alternative would be leaving two integration tests permanently red after Task 1's correctness fix. No scope creep, no source code changes outside the plan's `files_modified` list except for the test file (which is itself a test fixture, not production code).

## Issues Encountered

**1. New unit tests failed on first run with `expected false to be true`**
- **Cause:** The initial `vi.mock('ethers', ...)` used `Contract: vi.fn().mockImplementation(() => ({...}))`. With `vitest.config.ts` setting `mockReset: true`, vitest wipes `mockImplementation` between tests, causing `new Contract(...)` to return `undefined` and the sell function to throw and return `false`.
- **Resolution:** Replaced the `vi.fn().mockImplementation` with a real ES6 `class MockContract { async balanceOf() { return 1000000000000000000n; } async allowance() { return 1n << 200n; } async approve() { return { wait: async () => ({}) }; } }`. Plain classes survive `mockReset`. All 3 tests then passed on the next run.
- **Lesson recorded as a pattern in `key-decisions`** so future test files don't hit the same trap.

## User Setup Required

None -- no external service configuration required. This is a pure backend wiring + test addition with no runtime dependencies beyond what Plan 14-01 already established.

## Next Phase Readiness

**INT-AMOUNT-OUT-NULL is closed at the source-code level.** Every multi-chain sell that completes via `sendTxWithRetry` (which is all sells that go through the chain registry path -- exitEngine, force sells from the dashboard API, and any future risk-triggered sells) will now write a non-null `amount_out`, `gas_cost`, and `block` to the `trades` table. The existing `getPnL` query already uses `CAST(COALESCE(s.amount_out, '0') AS REAL)`, so the transition from null to real values flows through to:

- Dashboard P&L (DASH-02, DASH-04)
- Risk daily loss limit (RISK-02)
- Trade history sell revenue display

No DB migration, no query changes, no schema changes -- the existing `COALESCE` pattern handles the null-to-non-null transition for new sells while leaving historical null rows untouched (D-07 forward-only fix).

**Legacy txManager `void`-return paths** at `src/utils/txManager.ts:132` and `:144` are intentionally untouched. The `if (txHash)` guard in exitEngine handles them gracefully -- sells via the legacy path will continue to record nulls. Phase 14 closed the multi-chain ChainContext path, which is what exitEngine uses; the legacy path is only reached by the bot's standalone single-chain entry point and is out of scope.

**Phase 14 is complete after this plan.** Plan 14-01 delivered the decoder utility, Plan 14-02 wired it in and added behavioral tests. No further work is needed for INT-AMOUNT-OUT-NULL. Future work that touches sell receipts (multi-hop routers, custom DEX integrations, fee-on-transfer edge cases) would extend `decodeReceipt` rather than the wiring, since the wiring is now agnostic to what the decoder returns as long as the `ReceiptData` shape is preserved.

## Known Stubs

None. All wired data flows from source (Flashbots/bloXroute response, on-chain receipt) into the DB without placeholders or hardcoded fallbacks beyond the documented `null`-on-failure defaults.

## Self-Check: PASSED

Verified after writing this SUMMARY:

- `FOUND: src/exitEngine.ts` -- contains `import { decodeReceipt } from './utils/receiptDecoder';` (line 15)
- `FOUND: src/exitEngine.ts` -- 2 `decodeReceipt(txHash, ctx.httpProvider, ctx.chain.wethAddress, ctx.wallet.address)` call sites (lines 482, 589)
- `FOUND: src/exitEngine.ts` -- 2 `if (txHash)` guards (one per sell function)
- `FOUND: src/exitEngine.ts` -- both `insertTrade.run` calls use `receiptData.amountOut`, `receiptData.gasCost`, `receiptData.blockNumber`
- `FOUND: src/utils/mevStrategies/flashbots.ts` -- contains `bundle.bundleTransactions?.[0]?.hash` (defensive guard)
- `FOUND: src/utils/mevStrategies/flashbots.ts` -- contains `missing bundleTransactions[0].hash` (descriptive error)
- `NOT FOUND: src/utils/mevStrategies/flashbots.ts` -- the synthetic `flashbots_bundle_block_` string is removed
- `FOUND: test/unit/exitEngineSell.test.ts` -- exists, 250 lines, 3 `it(` blocks
- `FOUND: test/unit/exitEngineSell.test.ts` -- contains `vi.mock('../../src/utils/receiptDecoder'`
- `FOUND: test/unit/exitEngineSell.test.ts` -- contains `expect(decodeReceiptMock).not.toHaveBeenCalled()` (legacy-path test)
- `FOUND: test/integration/mevStrategies.test.ts` -- 3 occurrences of `bundleTransactions: [{ hash:`
- `FOUND: test/integration/mevStrategies.test.ts` -- contains `returns the data.result hash unchanged` (bloXroute regression)
- `FOUND: commit a543884` -- `feat(14-02): wire decodeReceipt into exitEngine and fix Flashbots tx hash`
- `FOUND: commit 6a4d102` -- `test(14-02): add execution-path tests for exitEngine sell receipt wiring`
- `FOUND: commit 6a800f7` -- `test(14-02): update Flashbots integration tests for real-hash return shape`
- `PASS: npx vitest run --project unit` -- 142/142 tests passing (was 139, +3 from new exitEngineSell tests)
- `PASS: npx vitest run --project integration` -- 122/122 tests passing (was 119, +3 new Flashbots/bloXroute tests; auto-fix to txManager.test.ts kept the count unchanged at 122)

---
*Phase: 14-sell-revenue-receipt-decoding*
*Completed: 2026-04-07*
