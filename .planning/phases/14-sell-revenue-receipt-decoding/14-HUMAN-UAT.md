---
status: partial
phase: 14-sell-revenue-receipt-decoding
source: [14-VERIFICATION.md]
started: 2026-04-07T00:15:00Z
updated: 2026-04-07T00:15:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Real full sell records non-null amount_out on-chain
expected: trades.amount_out equals the ETH/BNB delivered by the router to the wallet (observable via block explorer), with non-null gas_cost and block as well
result: [pending]

### 2. Real partial sell records non-null amount_out
expected: partial_sell trade row has amount_out equal to the ETH received for the tier slice
result: [pending]

### 3. getPnL reflects actual sell revenue
expected: After at least one real buy+sell cycle, getPnL() returns sell_revenue > 0 and realized_pnl = sell_revenue - buy_cost - gas_cost (not the stuck zero from the audit gap)
result: [pending]

### 4. Flashbots bundle returns real on-chain hash (ETH mainnet Flashbots path)
expected: tx_hash stored in trades row is a 32-byte hex string retrievable via eth_getTransactionReceipt on the fork/mainnet; no row contains flashbots_bundle_block_*
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
