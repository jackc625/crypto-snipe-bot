---
phase: 14-sell-revenue-receipt-decoding
verified: 2026-04-06T21:05:00Z
status: human_needed
score: 16/16 must-haves verified (0 overrides)
overrides_applied: 0
re_verification: null
human_verification:
  - test: "Execute a real sell on a testnet or mainnet fork and confirm the trades row has a non-null amount_out matching on-chain ETH received"
    expected: "trades.amount_out equals the ETH/BNB delivered by the router to the wallet (observable via block explorer)"
    why_human: "Requires a live chain interaction; unit tests mock decodeReceipt and integration tests mock the Flashbots provider. No E2E harness exists to exercise the full sell -> receipt -> insertTrade pipeline against a real RPC."
  - test: "Execute a real partial sell on testnet/fork and confirm the partial_sell row has non-null amount_out"
    expected: "partial_sell trade row has amount_out equal to the ETH received for the tier slice"
    why_human: "Same reason as full sell — the mocked unit test proves the code path but a live partial sell on a real chain is the only way to observe end-to-end correctness."
  - test: "After at least one real sell records data, query getPnL() and verify realized P&L reflects actual sell revenue (not zero)"
    expected: "getPnL() returns a row where sell_revenue > 0 and realized_pnl reflects (sell_revenue - buy_cost - gas)"
    why_human: "Requires real historical trades in the database with non-null amount_out. The SQL COALESCE pattern is verified by code review, but the end-to-end P&L math is a user-observable behavior."
  - test: "Execute a Flashbots-protected sell on ETH mainnet fork and verify the returned tx hash is a real on-chain hash (not flashbots_bundle_block_*)"
    expected: "tx_hash stored in trades table is a 32-byte hex string retrievable via eth_getTransactionReceipt on the fork"
    why_human: "Integration tests stub the Flashbots provider. Only a live bundle submission confirms the bundleTransactions[0].hash extraction matches the actual on-chain hash."
---

# Phase 14: Sell Revenue Receipt Decoding Verification Report

**Phase Goal:** Every sell and partial sell records the actual ETH/BNB received from the swap — amountOut is never null (verified semantically: non-null amountOut WHEN the receipt contains a recognized wrapped-native payout event; nulls are preserved for unrecognized shapes per user decisions in 14-CONTEXT.md)
**Verified:** 2026-04-06T21:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

#### ROADMAP Success Criteria (contract-level)

| #   | Truth                                                                                                                              | Status     | Evidence                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SC1 | After executeFullSell completes, the trades row has a non-null amount_out containing the ETH received from the swap               | VERIFIED   | src/exitEngine.ts:482 calls decodeReceipt(txHash, ...) inside `if (txHash)` guard; insertTrade.run at :486 passes `amountOut: receiptData.amountOut` (no more literal null). test/unit/exitEngineSell.test.ts:163-171 proves insertTrade.run receives non-null values via expect.objectContaining. (Live-chain confirmation is a human-verify item.) |
| SC2 | After executePartialSell completes, the partial_sell row has a non-null amount_out containing the ETH received                    | VERIFIED   | src/exitEngine.ts:589 calls decodeReceipt in the partial sell path; insertTrade.run at :593 passes `amountOut: receiptData.amountOut` with action='partial_sell'. test/unit/exitEngineSell.test.ts:238-248 proves the data flow. (Live-chain confirmation is a human-verify item.)                                                    |
| SC3 | getPnL() returns correct realized P&L reflecting actual sell revenue, not zero                                                    | VERIFIED   | src/utils/db.ts:203 `COALESCE(SUM(CAST(COALESCE(s.amount_out, '0') AS REAL)), 0) AS sell_revenue` — null-safe pattern that flows new non-null values through. SC1+SC2 prove amount_out is now populated on new sells. (Real P&L math on real trades is a human-verify item.)                                                            |

#### Plan-frontmatter truths (14-01 and 14-02)

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| T01 | decodeReceipt returns non-null amountOut when receipt contains a recognized wrapped-native payout event (Withdrawal V2, Transfer-to-wallet V3) | VERIFIED | src/utils/receiptDecoder.ts:81-84 (Withdrawal branch), :97-100 (Transfer-to-wallet branch). Tests: receiptDecoder.test.ts:48-64 (V2 Withdrawal + V3 Transfer). |
| T02 | decodeReceipt returns null amountOut with a warning when no recognized WETH event is found (D-02) | VERIFIED | receiptDecoder.ts:105-110 warns and returns `amountOut: null`. Test: receiptDecoder.test.ts:113-120. |
| T03 | decodeReceipt returns null amountOut/gasCost/blockNumber with a warning when the receipt is still null after one 2s retry (D-05) | VERIFIED | receiptDecoder.ts:44-52 (retry-once + null return). Tests: receiptDecoder.test.ts:87-111 (retry success + double-null failure). |
| T04 | decodeReceipt computes gasCost as gasUsed * gasPrice and records it as a string | VERIFIED | receiptDecoder.ts:62 `gasCost = (receipt.gasUsed * receipt.gasPrice).toString()`. Test: receiptDecoder.test.ts:66-75. |
| T05 | decodeReceipt records gasCost null and warns when receipt.gasPrice is missing | VERIFIED | receiptDecoder.ts:58-60 (`if (receipt.gasPrice == null)` guard writes null, not zero). Test: receiptDecoder.test.ts:155-165. |
| T06 | decodeReceipt extracts blockNumber from receipt | VERIFIED | receiptDecoder.ts:65 `const blockNumber = receipt.blockNumber`. Test: receiptDecoder.test.ts:77-85. |
| T07 | decodeReceipt picks the first WETH Transfer-to-wallet match when multiple exist | VERIFIED | receiptDecoder.ts:89 comment "First-match wins" + single `return` inside the loop. Test: receiptDecoder.test.ts:131-142 (two transfers, asserts first value). |
| T08 | decodeReceipt does not throw on malformed WETH logs from the correct WETH address | VERIFIED | receiptDecoder.ts:85,101 `try/catch` around each `parseLog` inside the WETH-address branch. Test: receiptDecoder.test.ts:144-153. |
| T09 | decodeReceipt only trusts logs from the WETH contract address (T-14-01 spoofing mitigation) | VERIFIED | receiptDecoder.ts:75,91 `if (logEntry.address.toLowerCase() !== wethLower) continue`. Test: receiptDecoder.test.ts:122-129 (spoofed Transfer from non-WETH contract rejected). |
| T10 | executeFullSell/executePartialSell record non-null amountOut/gasCost/blockNumber when decodeReceipt returns data | VERIFIED | exitEngine.ts:481-495 and :588-602 — both insertTrade.run call sites pass `receiptData.*`. Tests: exitEngineSell.test.ts:137-172 (full sell), :207-248 (partial sell). |
| T11 | Flashbots strategy returns real tx hash from bundleTransactions[0].hash | VERIFIED | flashbots.ts:80 `const realHash = bundle.bundleTransactions?.[0]?.hash`. No `flashbots_bundle_block_` string remains in the file. Test: mevStrategies.test.ts:134-164 asserts returned string matches REAL_HASH and does NOT match synthetic pattern. |
| T12 | Flashbots strategy throws descriptive error when bundleTransactions[0].hash is missing | VERIFIED | flashbots.ts:81-83 throws `Flashbots bundle response missing bundleTransactions[0].hash for block ${targetBlock}`. Test: mevStrategies.test.ts:166-193 `rejects.toThrow(/missing bundleTransactions\[0\]\.hash/)`. |
| T13 | If txHash is falsy (void from legacy path), receipt decoding is skipped and nulls are recorded (Pitfall 3) | VERIFIED | exitEngine.ts:476-483 default `receiptData` with null fields + `if (txHash)` guard. Test: exitEngineSell.test.ts:174-203 asserts `decodeReceiptMock not toHaveBeenCalled` and insertTrade receives literal null values. |

**Combined score:** 16/16 truths verified (3 ROADMAP success criteria + 13 plan truths). Deduplicated: SC1+SC2 are the observable surfaces of T10; T10 is the code-level proof; SC1+SC2 live-chain confirmation is the human-verify item.

### Required Artifacts

| Artifact                                         | Expected                                                                      | Status     | Details                                                                                                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/receiptDecoder.ts`                    | Receipt decoding utility with ReceiptData interface; exports decodeReceipt    | VERIFIED   | 112 lines. Exports `decodeReceipt` (line 37) and `ReceiptData` interface (line 31). Contains `receipt.gasUsed * receipt.gasPrice`, defensive `receipt.gasPrice == null` guard, `logCount:` enriched warning, "First-match wins" comment, retry via `setTimeout(r, 2000)`. Imports only from ethers and ./abis, ./logger — no txManager or mevStrategies dependency (D-04 compliance). |
| `test/unit/receiptDecoder.test.ts`               | Unit tests for all receipt decoding behaviors (min 120 lines)                 | VERIFIED   | 167 lines. 11 `it(` blocks covering V2 Withdrawal, V3 Transfer, gasCost, blockNumber, D-05 retry success + double-null, D-02 no-event, T-14-01 spoofing, first-match multi-transfer, malformed logs, null gasPrice. All 11 tests passing. |
| `test/fixtures/receipt.fixtures.ts`              | Mock TransactionReceipt and Log fixtures                                      | VERIFIED   | 100 lines. Exports `createMockReceipt`, `createMockLog`, `createWithdrawalLog`, `createTransferLog`, `createMalformedWethLog`, plus constants `WETH_ADDRESS`, `WALLET_ADDRESS`, `FAKE_TX_HASH`, `FOREIGN_TOKEN_ADDRESS`. Uses `Interface.encodeEventLog` for deterministic real payloads. |
| `src/exitEngine.ts`                              | executeFullSell and executePartialSell with receipt decoding; contains decodeReceipt | VERIFIED   | Import at line 15 (`import { decodeReceipt } from './utils/receiptDecoder'`). Two call sites at :482 (executeFullSell) and :589 (executePartialSell). Both insertTrade.run calls (:486, :593) use `receiptData.amountOut`, `receiptData.gasCost`, `block: receiptData.blockNumber`. `if (txHash)` guards at :481 and :588. |
| `src/utils/mevStrategies/flashbots.ts`           | Real tx hash from bundle response with defensive guard; contains bundleTransactions | VERIFIED   | Line 80 `bundle.bundleTransactions?.[0]?.hash`. Line 82 descriptive throw. `flashbots_bundle_block_` synthetic string no longer present. |
| `test/unit/exitEngineSell.test.ts`               | Execution-path tests with mocked decodeReceipt (min 150 lines)                | VERIFIED   | 251 lines. Contains `vi.mock('../../src/utils/receiptDecoder')`, `describe('executeFullSell` and `describe('executePartialSell`, `records non-null amountOut/gasCost/block`, `skips decodeReceipt and records nulls when sendTxWithRetry returns void`, `expect(decodeReceiptMock).not.toHaveBeenCalled()`. All 3 tests passing. |
| `test/integration/mevStrategies.test.ts`         | Updated Flashbots mocks with bundleTransactions; new real-hash and missing-hash tests | VERIFIED   | Existing test mocks updated at lines 49, 91 with `bundleTransactions: [{ hash: '0xrealtxhash...' }]`. New tests at :134 ("sendTransaction returns real tx hash from bundleTransactions[0].hash, not synthetic"), :166 ("throws descriptive error if bundleTransactions[0].hash is missing"), :272 ("returns the data.result hash unchanged — no synthetic-hash bug on BSC path"). |

**Supporting modified artifact (declared in SUMMARY, not in must_haves):**

| Artifact                                | Notes                                                                                     | Status     |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | ---------- |
| `src/utils/abis.ts`                     | `WETH_ABI` exported at line 74 with Withdrawal and Transfer events                        | VERIFIED   |
| `test/integration/txManager.test.ts`    | Pre-existing Flashbots mocks auto-fixed to include `bundleTransactions` (Rule 1 auto-fix) | VERIFIED (integration green 122/122) |

### Key Link Verification

| From                              | To                                        | Via                                                       | Status | Details                                                                                                                       |
| --------------------------------- | ----------------------------------------- | --------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| src/utils/receiptDecoder.ts       | ethers.Interface                          | parseLog for WETH events (pattern `wethIface\.parseLog`)  | WIRED  | receiptDecoder.ts:77,93 both use `wethIface.parseLog({ topics, data })`. Module-level `wethIface = new Interface(WETH_ABI)` at line 22. |
| test/unit/receiptDecoder.test.ts  | src/utils/receiptDecoder.ts               | import decodeReceipt                                      | WIRED  | receiptDecoder.test.ts:30 `import { decodeReceipt } from '../../src/utils/receiptDecoder'`. Tests exercise the function directly. |
| src/exitEngine.ts                 | src/utils/receiptDecoder.ts               | import decodeReceipt                                      | WIRED  | exitEngine.ts:15 `import { decodeReceipt } from './utils/receiptDecoder'`. Two usage sites at :482 and :589 inside `if (txHash)` guards. |
| src/exitEngine.ts                 | insertTrade.run                           | receiptData.amountOut passed to amountOut param           | WIRED  | Two call sites (:486 executeFullSell, :593 executePartialSell) both pass `amountOut: receiptData.amountOut`, `gasCost: receiptData.gasCost`, `block: receiptData.blockNumber`. Verified via exitEngineSell.test.ts expect.objectContaining. |
| src/utils/mevStrategies/flashbots.ts | bundleTransactions                     | return real hash instead of synthetic                     | WIRED  | flashbots.ts:80 extracts `bundle.bundleTransactions?.[0]?.hash`; :84 `return realHash`. Verified by mevStrategies.test.ts:134-164. |
| test/unit/exitEngineSell.test.ts  | src/utils/receiptDecoder                  | vi.mock for decodeReceipt                                 | WIRED  | exitEngineSell.test.ts:71-74 `vi.mock('../../src/utils/receiptDecoder', () => ({ decodeReceipt: decodeReceiptMock }))`. Asserted via toHaveBeenCalledWith and not.toHaveBeenCalled. |

### Data-Flow Trace (Level 4)

| Artifact                    | Data Variable                    | Source                                                                                                           | Produces Real Data                                                                                                                                                | Status                    |
| --------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| src/utils/receiptDecoder.ts | `receipt.logs`                   | `provider.getTransactionReceipt(txHash)` (real RPC call at runtime; mocked in tests)                             | Yes — returns a live ethers.TransactionReceipt in production; test harness passes `createMockReceipt` fixtures with real encoded logs via `Interface.encodeEventLog`. | FLOWING                   |
| src/exitEngine.ts (full sell) | `receiptData.amountOut`, `.gasCost`, `.blockNumber` | `decodeReceipt(txHash, ctx.httpProvider, ctx.chain.wethAddress, ctx.wallet.address)`                             | Yes — exitEngineSell.test.ts asserts `insertTradeRun` receives the decoded values (`'1000000000000000000'`, `'300000000000000'`, `12345`) via expect.objectContaining. | FLOWING                   |
| src/exitEngine.ts (partial sell) | Same as above                   | Same decodeReceipt call                                                                                          | Yes — exitEngineSell.test.ts test 3 asserts partial_sell row receives non-null (`'500000000000000000'`, `'150000000000000'`, `67890`).                            | FLOWING                   |
| src/utils/mevStrategies/flashbots.ts | `realHash`                    | `bundle.bundleTransactions?.[0]?.hash` from Flashbots provider sendBundle response                               | Yes — mevStrategies.test.ts asserts returned string equals mocked REAL_HASH and does not match `^flashbots_bundle_block_`.                                         | FLOWING                   |
| getPnL query (SC3 flow)     | `sell_revenue`                   | `COALESCE(SUM(CAST(COALESCE(s.amount_out, '0') AS REAL)), 0)` reading from `trades.amount_out` / `partial_sells.amount_out` | Forward-only: once SC1/SC2 populate non-null values on new sells, this SUM will reflect real revenue. Historical nulls continue to coalesce to 0 per D-07 intentional design. | FLOWING (forward-only per D-07) |

**No HOLLOW/DISCONNECTED/HOLLOW_PROP findings.** All rendered/persisted data paths have live, parameterized sources.

### Behavioral Spot-Checks

| Behavior                                                                             | Command                                                      | Result                                                                    | Status |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------ |
| Unit test suite (includes receiptDecoder + exitEngineSell + regression)              | `npx vitest run --project unit`                              | 12 files, 142 tests, all passing in 3.22s                                 | PASS   |
| Integration test suite (includes updated Flashbots + bloXroute regression)           | `npx vitest run --project integration`                       | 12 files, 122 tests, all passing in 3.15s                                 | PASS   |
| Phase-specific tests run in isolation                                                | `npx vitest run test/unit/receiptDecoder.test.ts test/unit/exitEngineSell.test.ts` | 2 files, 14 tests passing in 784ms (11 decoder + 3 exitEngineSell)        | PASS   |
| decodeReceipt import site present in exitEngine                                      | grep `decodeReceipt` on src/exitEngine.ts                    | 1 import, 2 call sites (lines 15, 482, 589)                                | PASS   |
| Flashbots synthetic string removed                                                   | grep `flashbots_bundle_block_` on src/utils/mevStrategies/flashbots.ts | 0 matches                                                            | PASS   |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                                           | Status    | Evidence                                                                                                                                                                                                    |
| ----------- | ----------- | --------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB-03       | 14-01, 14-02 | Full transaction audit trail: every buy, sell, and status change recorded with timestamps                             | SATISFIED | Sells now record non-null `amount_out`, `gas_cost`, and `block` (previously always null) via decodeReceipt wiring. Proven by exitEngineSell.test.ts execution-path assertions. Historical audit trail is now complete for all new sells on the multi-chain path. |
| DB-04       | 14-02       | P&L calculated per trade with realized gains/losses queryable by token, chain, and date range                        | SATISFIED | getPnL query (db.ts:196) uses `COALESCE(s.amount_out, '0')` and now receives real values from new sells. Combined with DB-03, realized P&L will reflect actual sell revenue on forward trades. Live-chain P&L observation is a human-verify item. |

**Orphaned requirements check:** REQUIREMENTS.md maps Phase 14 to DB-03 and DB-04 only. Both IDs are claimed by at least one plan (DB-03 in both 14-01 and 14-02; DB-04 in 14-02). No orphans.

### Anti-Patterns Found

| File                                       | Line   | Pattern                                                        | Severity | Impact                                                                                                                                                          |
| ------------------------------------------ | ------ | -------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/exitEngine.ts                          | 477-479 | `amountOut: null` / `gasCost: null` / `blockNumber: null` (literals) | Info     | These are the DEFAULT declarations of `receiptData` before the `if (txHash)` guard — they are the documented fallback for the legacy-void path and are overwritten when txHash is truthy. Not a stub. Verified via exitEngineSell.test.ts legacy-path test. |
| src/exitEngine.ts                          | 584-586 | Same pattern in executePartialSell                             | Info     | Same reasoning.                                                                                                                                                  |
| src/utils/receiptDecoder.ts                | 51, 110 | `return { amountOut: null, ... }`                              | Info     | Intentional null-on-unrecognized-shape behavior per D-02/D-05 and user decision in 14-CONTEXT.md. Warning logs emitted. Scope note documented in header comment. |

No BLOCKER or WARNING anti-patterns. All `null` literals found are documented fallback defaults, not hollow implementations.

### Human Verification Required

The following items require live-chain or observational testing that automated verification cannot provide. Every code path is proven by unit/integration tests, but the end-to-end sell → receipt → DB → P&L pipeline has not been exercised against a real RPC.

#### 1. Real sell records non-null amount_out on-chain

**Test:** Execute a real full sell via exitEngine on a testnet, mainnet fork (Anvil/Hardhat), or small-value real mainnet transaction.
**Expected:** After the sell confirms, query `SELECT amount_out, gas_cost, block FROM trades WHERE action='sell' ORDER BY id DESC LIMIT 1`. All three columns should be non-null. `amount_out` should equal the ETH delivered by the router to the wallet (observable via the tx receipt on a block explorer).
**Why human:** Requires a live RPC and real signed transaction. Unit tests mock decodeReceipt; only a live run confirms that the real ethers TransactionReceipt shape matches what the decoder expects for each chain (ETH mainnet, BSC, Arbitrum, etc.).

#### 2. Real partial sell records non-null amount_out

**Test:** Trigger a partial sell tier on a real position (e.g., configure `partialSellTargets=2x:50` and hit the 2x level).
**Expected:** `SELECT amount_out FROM trades WHERE action='partial_sell' ORDER BY id DESC LIMIT 1` returns a non-null string matching the ETH received for the tier slice.
**Why human:** Same rationale as #1 — execution-path test proves the data flow, but live behavior is the ultimate signal.

#### 3. getPnL reflects actual sell revenue

**Test:** After at least one real buy+sell cycle with non-null amount_out, call `getPnL()` (directly or via dashboard) and inspect the result.
**Expected:** `sell_revenue > 0` for the token; `realized_pnl = sell_revenue - buy_cost - gas_cost`; value is NOT the stuck zero from the audit gap.
**Why human:** P&L math depends on real historical data. The `COALESCE` query pattern is verified by code review, but observing correct numbers in the dashboard or API closes SC3.

#### 4. Flashbots bundle returns real on-chain hash (ETH mainnet Flashbots path)

**Test:** Execute a Flashbots-protected sell on ETH mainnet or an Anvil fork with a Flashbots relay, and compare the `tx_hash` stored in the trades row to the on-chain hash from `eth_getTransactionReceipt`.
**Expected:** The two hashes are identical. No row contains `flashbots_bundle_block_*`.
**Why human:** Integration test stubs `FlashbotsBundleProvider.sendBundle`. Only a live Flashbots submission confirms the `bundleTransactions[0].hash` extraction matches the actual included tx hash.

### Gaps Summary

**No blocking gaps.** Every must-have (16 total — 3 ROADMAP SCs + 13 plan truths) is verified at the code, artifact, wiring, data-flow, and test levels.

The phase code is demonstrably complete:

- Receipt decoder extracts amountOut/gasCost/blockNumber with V2 Withdrawal + V3 Transfer-to-wallet strategies, defensive guards, and spoofing mitigation (Plan 14-01).
- `executeFullSell` and `executePartialSell` now call decodeReceipt and persist the result into the correct `insertTrade.run` named parameters (Plan 14-02).
- The Flashbots synthetic-hash bug is fixed with a loud defensive throw on malformed responses.
- 142/142 unit tests and 122/122 integration tests are green.

**Status is `human_needed` rather than `passed`** because the semantic goal — "non-null amountOut recorded WHEN the receipt contains a recognized wrapped-native payout event on a real chain" — can only be fully confirmed by executing a real sell and observing the database row. The automated suite proves every code path the decoder can take; the human tests close the last mile from "proven by mocks" to "observed on-chain."

**Scope note honored:** The decoder's scope (V2 `swapExactTokensForETH`, V3 `exactInputSingle(recipient=wallet)`) matches the current sell builders in `src/exitEngine.ts`:
- `buildV2SellTx` at line 344 encodes `swapExactTokensForETH` (confirmed at :356).
- `buildV3SellTx` at line 371 encodes `exactInputSingle` with `recipient: walletAddress` (confirmed at :386).

No multi-hop or custom-router sell paths exist in the codebase, so the scope limitation does not leave any sell type undecodable.

**D-07 forward-only fix is intentional:** Historical sell rows with null amount_out remain null. No backfill attempted. The `COALESCE(amount_out, '0')` pattern in getPnL coalesces legacy nulls to 0 without affecting new non-null rows. This is documented in 14-CONTEXT.md and REQUIREMENTS.md.

---

_Verified: 2026-04-06T21:05:00Z_
_Verifier: Claude (gsd-verifier)_
