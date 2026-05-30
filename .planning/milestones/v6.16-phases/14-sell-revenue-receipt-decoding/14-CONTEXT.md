# Phase 14: Sell Revenue Receipt Decoding - Context

**Gathered:** 2026-04-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Decode the actual ETH/BNB received from sell and partial sell swap transactions so amountOut is recorded instead of null. This fixes Dashboard P&L, Risk monitoring daily loss calculations, and Trade history sell revenue display. Forward-only fix -- no backfill of historical sells.

</domain>

<decisions>
## Implementation Decisions

### Receipt decoding approach
- **D-01:** Parse the WETH `Withdrawal(address indexed src, uint256 wad)` event from the transaction receipt to extract ETH/BNB received. Works for both V2 and V3 since all token-to-ETH swaps unwrap WETH as the final step. Single event topic, chain-agnostic (WETH address available via `ctx.chain.wethAddress`).
- **D-02:** If WETH Withdrawal event is missing from receipt (unusual router behavior or fee-on-transfer edge case), log a warning and record amountOut as null. No fallback to balance diff -- avoids writing incorrect data. P&L shows zero for that trade, same as current behavior.

### Gas cost recording
- **D-03:** Record actual gas cost from receipt alongside amountOut. Compute as `receipt.gasUsed * receipt.effectiveGasPrice` (both available in ethers v6 TransactionReceipt). Minimal extra work since receipt is already fetched. Completes DB-03 audit trail.

### sendTxWithRetry interface
- **D-04:** No changes to sendTxWithRetry or MevStrategy interface. After sendTxWithRetry returns the txHash, exitEngine fetches the receipt separately via `ctx.httpProvider.getTransactionReceipt(txHash)`. Localized fix with no cross-module disruption.

### Receipt availability
- **D-05:** If getTransactionReceipt returns null (receipt not yet indexed), wait 2 seconds and retry once. If still null, log warning and record null for amountOut/gasCost. sendTxWithRetry already waited for tx confirmation, so receipt should almost always be available.

### Block number recording
- **D-06:** Also extract `receipt.blockNumber` and write it to the `block` column in the sell/partial_sell trade row. Free data from the receipt that completes the audit trail.

### Backfill strategy
- **D-07:** Forward-only fix. No attempt to backfill existing sell rows with null amountOut. Historical receipts may be unavailable on pruned nodes across multiple chains -- unreliable and complex for minimal benefit.

### Claude's Discretion
- Helper function design (inline vs extracted `decodeReceipt` utility)
- Whether to share receipt-fetching logic between executeFullSell and executePartialSell or duplicate inline
- WETH Withdrawal event topic computation approach

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Exit engine (primary modification target)
- `src/exitEngine.ts` -- executeFullSell (line ~472-504) and executePartialSell (line ~567-604) are the two call sites where amountOut/gasCost/block must be populated from receipt

### Database schema and queries
- `src/utils/db.ts` -- insertTrade prepared statement (line ~177), amount_out/gas_cost/block columns in trades table schema (line ~43,93)

### Transaction submission
- `src/utils/txManager.ts` -- sendTxWithRetry returns txHash string (line ~58-64), MevStrategy interface unchanged
- `src/utils/mevStrategies/types.ts` -- MevStrategy.sendTransaction returns Promise<string> (txHash only)

### Audit gap
- `.planning/v6.16-MILESTONE-AUDIT.md` -- INT-AMOUNT-OUT-NULL definition, affected requirements (DB-03, DB-04, DASH-02, DASH-04, RISK-02), suggested fix approach

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ctx.chain.wethAddress` -- WETH address per chain already available in ChainContext, needed for Withdrawal event matching
- `ctx.httpProvider` -- JSON-RPC provider available in ChainContext for `getTransactionReceipt` call
- `ERC20_ABI` in `src/utils/abis.ts` -- may need WETH Withdrawal event ABI added (or computed from topic hash)

### Established Patterns
- insertTrade.run() accepts named params including `amountOut`, `gasCost`, `block` -- all currently null for sells, just need real values passed
- P&L queries use `CAST(COALESCE(s.amount_out, '0') AS REAL)` -- null-safe, so non-null values flow through automatically
- BigInt math for token amounts (Phase 7 pattern) -- receipt gasUsed * effectiveGasPrice produces bigint, store as string

### Integration Points
- `executeFullSell` and `executePartialSell` in exitEngine.ts are the only two places sell trades are inserted
- No other module needs changes -- P&L, risk, dashboard, and trade history all read amount_out from DB and already handle both null and non-null values
- `sendTxWithRetry` is NOT modified -- receipt fetch happens after it returns

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 14-sell-revenue-receipt-decoding*
*Context gathered: 2026-04-06*
