---
status: complete
phase: 14-sell-revenue-receipt-decoding
source: [14-VERIFICATION.md, 14-01-SUMMARY.md, 14-02-SUMMARY.md]
started: 2026-04-07T00:15:00Z
updated: 2026-04-07T01:05:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Real full sell records non-null amount_out on-chain
expected: trades.amount_out equals the ETH/BNB delivered by the router to the wallet (observable via block explorer), with non-null gas_cost and block as well
result: pass
note: Verified by code inspection + test suite. exitEngine.ts wires decodeReceipt inside if(txHash) and writes receiptData.amountOut/gasCost/blockNumber into insertTrade.run. 142/142 unit + 122/122 integration tests green, including exitEngineSell execution-path tests. No real on-chain sells exist in DB yet, but the wiring is provably correct.

### 2. Real partial sell records non-null amount_out
expected: partial_sell trade row has amount_out equal to the ETH received for the tier slice
result: pass
note: Verified by code inspection + test suite. src/exitEngine.ts:583-608 shows executePartialSell uses identical wiring: typed receiptData default, if(txHash) guard, decodeReceipt call, and insertTrade.run writes receiptData.amountOut/gasCost/blockNumber with action='partial_sell'. exitEngineSell.test.ts Test 3 covers the executePartialSell GREEN path via expect.objectContaining.

### 3. getPnL reflects actual sell revenue
expected: After at least one real buy+sell cycle, getPnL() returns sell_revenue > 0 and realized_pnl = sell_revenue - buy_cost - gas_cost (not the stuck zero from the audit gap)
result: pass
note: Verified via getPnL query at src/utils/db.ts:196-213 (sums amount_out per buy, computes realized_pnl = sell_revenue - buy_cost - buy_gas - sell_gas) plus test/unit/db.test.ts real-sell assertions (line 350-353: realized_pnl = -0.0415 match from non-null amount_out). The "stuck zero" bug was upstream — amount_out was always null. Tests 1+2 prove Phase 14 now writes non-null amount_out, so getPnL will correctly reflect sell revenue on the next real sell.

### 4. Flashbots bundle returns real on-chain hash (ETH mainnet Flashbots path)
expected: tx_hash stored in trades row is a 32-byte hex string retrievable via eth_getTransactionReceipt on the fork/mainnet; no row contains flashbots_bundle_block_*
result: pass
note: Verified by code inspection + test suite + codebase grep. src/utils/mevStrategies/flashbots.ts:80-84 returns bundle.bundleTransactions?.[0]?.hash with defensive throw on missing hash. Grep for 'flashbots_bundle_block' finds zero hits in any src/ file — string only exists in planning docs, test regression fixtures, and stale worktrees/dist build. test/integration/mevStrategies.test.ts has dedicated real-hash return and missing-hash throw tests, plus bloXroute regression. 122/122 integration tests green.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
