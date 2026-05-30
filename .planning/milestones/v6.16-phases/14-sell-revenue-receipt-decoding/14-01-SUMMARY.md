---
phase: 14-sell-revenue-receipt-decoding
plan: 01
subsystem: trading
tags: [ethers-v6, weth, receipt-decoding, tdd, vitest, sell-revenue]

# Dependency graph
requires:
  - phase: 02-ethers-v6-migration
    provides: ethers v6 TransactionReceipt with bigint gasUsed/gasPrice and Interface.parseLog
  - phase: 03-sqlite-storage-code-quality
    provides: insertTrade prepared statement with amount_out/gas_cost/block columns
  - phase: 04-multi-chain-architecture
    provides: ChainContext with chain.wethAddress and httpProvider
  - phase: 05-uniswap-v3-integration
    provides: V3 sell builder shape that emits WETH Transfer-to-wallet (not Withdrawal)
provides:
  - Tested receipt decoding utility (decodeReceipt) that extracts amountOut, gasCost, blockNumber
  - WETH_ABI exported from src/utils/abis.ts
  - ReceiptData interface contract for sell trade recording
  - Mock receipt/log fixture factories for unit testing
affects: [14-02-sell-wiring, exitEngine, dashboard-pnl, risk-daily-loss]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-strategy WETH event decode: Withdrawal (V2) first, Transfer-to-wallet (V3) fallback"
    - "Address-first log filtering (T-14-01 spoofing mitigation) before parseLog"
    - "try/catch around parseLog so malformed logs at WETH address never throw"
    - "Defensive null guard on receipt.gasPrice before bigint multiplication"
    - "Module-level Interface instance (wethIface) instantiated once, not per-call"

key-files:
  created:
    - src/utils/receiptDecoder.ts
    - test/unit/receiptDecoder.test.ts
    - test/fixtures/receipt.fixtures.ts
  modified:
    - src/utils/abis.ts

key-decisions:
  - "decodeReceipt exposed as pure utility (no ChainContext dep) -- takes explicit provider/weth/wallet args for focused unit testing without exitEngine mocks"
  - "ethers v6: use receipt.gasPrice (not effectiveGasPrice) -- constructor maps effective to gasPrice automatically"
  - "First-match wins for multiple WETH Transfer-to-wallet events -- documented in comment; current single-hop sell builders produce exactly one"
  - "gasPrice null -> gasCost null (defensive) -- never compute wrong value, log warning so operator can investigate"
  - "Enriched no-event warning includes logCount to distinguish misconfigured WETH address from genuinely empty receipt"
  - "Scope limited to current V2 swapExactTokensForETH and V3 exactInputSingle(recipient=wallet) -- multi-hop/custom routers explicitly out of scope (per REVIEWS.md)"

patterns-established:
  - "Receipt decoder as extracted utility: enables unit testing without mocking exitEngine chain context"
  - "WETH event encoding via ethers Interface.encodeEventLog in test fixtures (deterministic, no hand-rolled topic hashes)"
  - "Security filter before parse: log.address.toLowerCase() === wethAddress.toLowerCase() before Interface.parseLog"

requirements-completed: [DB-03]

# Metrics
duration: 5min
completed: 2026-04-07
---

# Phase 14 Plan 01: Sell Revenue Receipt Decoding Summary

**Pure receipt-decoding utility that extracts ETH/BNB received, gas cost, and block number from sell tx receipts using a two-strategy WETH event decode (V2 Withdrawal, V3 Transfer-to-wallet fallback), guarded against spoofing, malformed logs, and null gasPrice.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-07T00:21:00Z
- **Completed:** 2026-04-07T00:26:13Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- `decodeReceipt(txHash, provider, wethAddress, walletAddress)` utility implemented and exported
- `ReceiptData` interface contract established (`amountOut`, `gasCost`, `blockNumber` — each nullable)
- All 11 unit tests passing with RED→GREEN TDD flow (verified RED state before implementation)
- Full unit project still green: 139/139 tests passing, no regressions
- `WETH_ABI` added to centralized `src/utils/abis.ts` (Withdrawal + Transfer events)
- Reusable mock factories (`createMockReceipt`, `createMockLog`, `createWithdrawalLog`, `createTransferLog`, `createMalformedWethLog`) that use `ethers.Interface.encodeEventLog` for deterministic, version-safe log encoding
- All REVIEWS.md action items addressed: scoping note, multiple-transfer test, malformed log test, null-gasPrice guard test, enriched no-event warning with `logCount`, explicit "First-match wins" comment

## Task Commits

Each task was committed atomically on master (no worktrees, sequential flow):

1. **Task 1: RED — test fixtures + 11 failing tests** — `f41203e` (test)
2. **Task 2: GREEN — decodeReceipt implementation + WETH_ABI** — `06210fa` (feat)

_TDD flow: Task 1 verified RED with `Cannot find module '/src/utils/receiptDecoder'` error before Task 2 created the module. No separate refactor commit needed — initial GREEN implementation was clean._

## Files Created/Modified

- `src/utils/receiptDecoder.ts` **(created, 112 lines)** — `decodeReceipt` async function and `ReceiptData` interface. Implements retry-once-on-null (D-05), WETH address log filtering (T-14-01), Withdrawal-first/Transfer-fallback decode (D-01), defensive gasPrice null guard (D-03 + action 6), and enriched no-event warning with `logCount` (action 5).
- `test/unit/receiptDecoder.test.ts` **(created, 163 lines)** — 11 unit tests covering V2 Withdrawal, V3 Transfer fallback, gasCost computation, blockNumber extraction, retry success and double-null failure (D-05), missing-event null amountOut (D-02), spoofed non-WETH Transfer rejection (T-14-01), multiple WETH Transfer first-match behavior, malformed WETH log tolerance, and null gasPrice guard.
- `test/fixtures/receipt.fixtures.ts` **(created, 100 lines)** — Mock receipt/log factories. Uses `ethers.Interface.encodeEventLog` to produce real, parseable event payloads — no hand-rolled keccak256 topic hashes. Exports shared constants (`WETH_ADDRESS`, `WALLET_ADDRESS`, `FAKE_TX_HASH`, `FOREIGN_TOKEN_ADDRESS`) and the `MockLog` / `MockReceipt` shapes.
- `src/utils/abis.ts` **(modified)** — Appended `WETH_ABI` constant after `V3_QUOTER_V2_ABI`. Contains the two events needed for receipt decoding (`Withdrawal(address indexed src, uint256 wad)` and `Transfer(address indexed from, address indexed to, uint256 value)`). No other edits.

## Decisions Made

- **Extracted utility over inline helper:** `decodeReceipt` lives in `src/utils/receiptDecoder.ts`, not inside `exitEngine.ts`. This was Claude's discretion per CONTEXT.md and was validated by both Gemini and Codex reviewers as the right abstraction boundary. It enables focused unit testing without mocking exitEngine's chain context, DB, or sell mutex.
- **Pure function signature:** `decodeReceipt(txHash, provider, wethAddress, walletAddress)` takes primitive args instead of a `ChainContext`. This keeps the utility unit-testable without constructing a full ChainContext and matches the RESEARCH.md Pattern 1 signature.
- **`gasPrice` field, not `effectiveGasPrice`:** Verified against ethers v6 source — the constructor maps RPC `effectiveGasPrice` to the `gasPrice` property. D-03 references `effectiveGasPrice` but the correct ethers v6 field is `gasPrice`. This was flagged in RESEARCH.md Pitfall 4.
- **Defensive null gasPrice guard writes `null`, not `0`:** If `receipt.gasPrice == null`, we log a warning and record `gasCost: null`. Zero would silently corrupt P&L calculations on chains/forks that don't populate gasPrice. This is REVIEWS.md action 6.
- **First-match wins for multiple Transfer events, explicitly documented:** The decoder returns the first `Transfer(to=wallet)` it finds. Single-hop sell builders (V2 `swapExactTokensForETH`, V3 `exactInputSingle` with `recipient=wallet`) produce exactly one such event. Summation was considered but rejected as it would be incorrect for cases where intermediate transfers land at the wallet (none in current scope, but future-proof against silent aggregation bugs).
- **Try/catch per log entry, not per receipt:** Each log at the WETH address is parsed inside its own try/catch. A malformed log from the correct WETH address (e.g., a future WETH variant with an unknown event) falls through to the next log rather than crashing the decoder.

## Deviations from Plan

None — plan executed exactly as written.

The plan was already cross-AI reviewed and incorporated all REVIEWS.md action items (scoping note, multiple-transfer test, malformed log test, null-gasPrice guard test, enriched warning, first-match comment) before execution. No inline auto-fixes were needed.

## Issues Encountered

None. TypeScript compilation was clean on first write for all four files. RED phase verified as expected. GREEN phase passed on first run (11/11 tests + 139/139 full unit project).

The only notable observation: the initial `git status` showed pre-existing modifications to `.planning/STATE.md` and `vitest.config.ts` from before this executor was invoked. These were left untouched per the sequential-executor contract (orchestrator owns STATE.md writes) and because `vitest.config.ts` is unrelated to this plan.

## User Setup Required

None — no external service configuration required. This is a pure backend utility with no runtime dependencies beyond ethers v6 (already installed).

## Next Phase Readiness

**Plan 14-02 (wiring) is unblocked.** Plan 02 will import `decodeReceipt` into `src/exitEngine.ts` and wire it into `executeFullSell` and `executePartialSell` immediately after `sendTxWithRetry` returns a tx hash. Plan 02 will also fix the Flashbots synthetic-hash bug (`flashbots_bundle_block_N` → `bundleTransactions[0].hash`) so ETH mainnet sells actually produce receipts that `decodeReceipt` can decode.

**Contract for Plan 14-02 consumers:**
```typescript
import { decodeReceipt, type ReceiptData } from './utils/receiptDecoder';

const { amountOut, gasCost, blockNumber } = await decodeReceipt(
    txHash,
    ctx.httpProvider,
    ctx.chain.wethAddress,
    ctx.wallet.address,
);
// All three fields may be null -- insertTrade.run accepts nulls per existing schema.
```

No blockers or concerns. Full unit test suite is green. The V2/V3 decode strategies, spoofing mitigation, retry semantics, and defensive guards are locked in by tests and will regress loudly if Plan 02's wiring introduces incompatible call shapes.

## Self-Check: PASSED

Verified after writing this SUMMARY:

- `FOUND: src/utils/receiptDecoder.ts` — exists, 112 lines, exports `decodeReceipt` and `ReceiptData`
- `FOUND: test/unit/receiptDecoder.test.ts` — exists, 163 lines, 11 `it(` blocks
- `FOUND: test/fixtures/receipt.fixtures.ts` — exists, 100 lines, 5 factory exports + 4 constants
- `FOUND: src/utils/abis.ts` — `WETH_ABI` export added after `V3_QUOTER_V2_ABI`
- `FOUND: commit f41203e` — `test(14-01): add failing tests for receipt decoder (RED)`
- `FOUND: commit 06210fa` — `feat(14-01): implement receiptDecoder utility (GREEN)`
- `PASS: npx vitest run test/unit/receiptDecoder.test.ts` — 11/11 tests passing
- `PASS: npx vitest run --project unit` — 139/139 tests passing (no regressions)

---
*Phase: 14-sell-revenue-receipt-decoding*
*Completed: 2026-04-07*
