# Phase 14: Sell Revenue Receipt Decoding - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-06
**Phase:** 14-sell-revenue-receipt-decoding
**Areas discussed:** Receipt decoding approach, Gas cost recording, sendTxWithRetry interface, Backfill existing sells, Receipt retry/timeout, Block number recording

---

## Receipt Decoding Approach

| Option | Description | Selected |
|--------|-------------|----------|
| WETH Withdrawal event | Parse Withdrawal(address,uint256) from WETH contract in receipt. Works for V2 and V3. Chain-agnostic. | ✓ |
| Balance diff before/after | Read wallet ETH balance before/after swap, subtract gas. Simpler but less precise -- concurrent txs or MEV rebates affect accuracy. | |
| Swap event from pair/pool | Parse V2 Swap or V3 Swap event. More specific but requires different parsing per DEX type and token ordering knowledge. | |

**User's choice:** WETH Withdrawal event (Recommended)
**Notes:** Single event topic, works across all DEX types

### Fallback behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Log warning, record null | Record amountOut as null with warning. Same as today. No incorrect data written. | ✓ |
| Fall back to balance diff | Try Withdrawal first, then balance diff. More coverage but complex and potentially inaccurate. | |

**User's choice:** Log warning, record null (Recommended)

---

## Gas Cost Recording

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, fix gasCost too | receipt.gasUsed * receipt.effectiveGasPrice. Minimal extra work since receipt already fetched. Completes DB-03. | ✓ |
| No, just amountOut | Keep scope minimal. gasCost can be separate future fix. | |

**User's choice:** Yes, fix gasCost too (Recommended)

---

## sendTxWithRetry Interface

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch receipt in exitEngine | After txHash returned, use provider.getTransactionReceipt(txHash). No changes to sendTxWithRetry or MevStrategy. Localized fix. | ✓ |
| Return receipt from sendTxWithRetry | Change return type to { txHash, receipt }. Cleaner data flow but requires updating MevStrategy interface + all callers. | |

**User's choice:** Fetch receipt in exitEngine (Recommended)

---

## Backfill Existing Sells

| Option | Description | Selected |
|--------|-------------|----------|
| No backfill, forward-only | Only new sells get amountOut. Historical receipts may be unavailable on pruned nodes -- unreliable. | ✓ |
| Best-effort backfill | Iterate null rows on startup, try to fetch receipt by txHash. Partial success accepted. | |

**User's choice:** No backfill, forward-only (Recommended)

---

## Receipt Retry/Timeout

| Option | Description | Selected |
|--------|-------------|----------|
| Single retry after 2s delay | Wait 2s, retry once. If still null, log warning. sendTxWithRetry already confirmed the tx. | ✓ |
| You decide | Claude picks retry strategy. | |

**User's choice:** Single retry after 2s delay (Recommended)

---

## Block Number Recording

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, record blockNumber too | receipt.blockNumber is free data. Completes audit trail. | ✓ |
| No, just amountOut and gasCost | Keep scope strictly to P&L-affecting fields. | |

**User's choice:** Yes, record blockNumber too (Recommended)

---

## Claude's Discretion

- Helper function design (inline vs extracted utility)
- Whether to share receipt-fetching logic between executeFullSell and executePartialSell
- WETH Withdrawal event topic computation approach

## Deferred Ideas

None -- discussion stayed within phase scope
