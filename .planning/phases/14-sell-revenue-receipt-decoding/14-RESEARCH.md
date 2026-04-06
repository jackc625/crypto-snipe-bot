# Phase 14: Sell Revenue Receipt Decoding - Research

**Researched:** 2026-04-06
**Domain:** EVM transaction receipt parsing, WETH event decoding, ethers v6
**Confidence:** HIGH

## Summary

Phase 14 fixes the INT-AMOUNT-OUT-NULL gap: after every sell and partial sell, the actual ETH/BNB received is decoded from the transaction receipt and written to the `amount_out` column. The fix touches two functions in `exitEngine.ts` (executeFullSell and executePartialSell), adds a receipt-decoding helper, and requires no schema changes -- the `amount_out`, `gas_cost`, and `block` columns already exist in the trades table.

The core technique is straightforward: after `sendTxWithRetry` returns a tx hash, fetch the receipt via `ctx.httpProvider.getTransactionReceipt(txHash)`, then scan the receipt logs for a WETH event emitted by the chain's WETH contract (`ctx.chain.wethAddress`). Gas cost is computed as `receipt.gasUsed * receipt.gasPrice` (both bigint in ethers v6). Block number comes from `receipt.blockNumber`.

**Critical finding:** The WETH `Withdrawal` event approach from D-01 only works for V2 sells. V3 sells (as currently implemented in `buildV3SellTx`) output WETH tokens to the wallet WITHOUT unwrapping -- no `Withdrawal` event is emitted. For V3, a WETH `Transfer` event to the wallet address must be used instead. Additionally, the Flashbots MEV strategy returns a synthetic identifier (`flashbots_bundle_block_N`) instead of a real tx hash, making `getTransactionReceipt` fail silently for ETH mainnet Flashbots bundles.

**Primary recommendation:** Implement a two-event decoding strategy: check for WETH `Withdrawal` first (V2 path), then fall back to WETH `Transfer(to=wallet)` (V3 path). Fix the Flashbots strategy to return the real tx hash from `bundleTransactions[0].hash` (implementation change, not interface change -- consistent with D-04).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Parse the WETH `Withdrawal(address indexed src, uint256 wad)` event from the transaction receipt to extract ETH/BNB received. Works for both V2 and V3 since all token-to-ETH swaps unwrap WETH as the final step. Single event topic, chain-agnostic (WETH address available via `ctx.chain.wethAddress`).
- **D-02:** If WETH Withdrawal event is missing from receipt (unusual router behavior or fee-on-transfer edge case), log a warning and record amountOut as null. No fallback to balance diff -- avoids writing incorrect data. P&L shows zero for that trade, same as current behavior.
- **D-03:** Record actual gas cost from receipt alongside amountOut. Compute as `receipt.gasUsed * receipt.effectiveGasPrice` (both available in ethers v6 TransactionReceipt). Minimal extra work since receipt is already fetched. Completes DB-03 audit trail.
- **D-04:** No changes to sendTxWithRetry or MevStrategy interface. After sendTxWithRetry returns the txHash, exitEngine fetches the receipt separately via `ctx.httpProvider.getTransactionReceipt(txHash)`. Localized fix with no cross-module disruption.
- **D-05:** If getTransactionReceipt returns null (receipt not yet indexed), wait 2 seconds and retry once. If still null, log warning and record null for amountOut/gasCost. sendTxWithRetry already waited for tx confirmation, so receipt should almost always be available.
- **D-06:** Also extract `receipt.blockNumber` and write it to the `block` column in the sell/partial_sell trade row. Free data from the receipt that completes the audit trail.
- **D-07:** Forward-only fix. No attempt to backfill existing sell rows with null amountOut. Historical receipts may be unavailable on pruned nodes across multiple chains -- unreliable and complex for minimal benefit.

### Claude's Discretion
- Helper function design (inline vs extracted `decodeReceipt` utility)
- Whether to share receipt-fetching logic between executeFullSell and executePartialSell or duplicate inline
- WETH Withdrawal event topic computation approach

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DB-03 | Full transaction audit trail: every buy, sell, and status change recorded with timestamps | Receipt decoding provides amountOut, gasCost, and block for sell/partial_sell rows -- completing the audit trail that was structurally present but data-empty |
| DB-04 | P&L calculated per trade with realized gains/losses queryable by token, chain, and date range | Non-null amountOut flows through existing getPnL() query via `CAST(COALESCE(s.amount_out, '0') AS REAL)` -- no query changes needed, only data fix |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ethers | 6.16.0 | TransactionReceipt, Log parsing, AbiCoder, Interface | Already installed; receipt.gasUsed/gasPrice are bigint, logs array has topics/data [VERIFIED: node_modules] |
| better-sqlite3 | 12.8.0 | Trade row insert with amountOut/gasCost/block | Already installed; insertTrade prepared statement accepts these params [VERIFIED: src/utils/db.ts] |

### Supporting
No new libraries needed. All receipt decoding uses ethers v6 built-in APIs.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual topic matching | ethers Interface.parseLog() | parseLog is cleaner but both work; manual matching is simpler for a single known event |
| AbiCoder.decode for data | Interface.decodeEventLog() | decodeEventLog handles indexed params automatically; slightly more ergonomic |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  exitEngine.ts          # Modified: executeFullSell + executePartialSell call decodeReceipt
  utils/
    receiptDecoder.ts    # NEW: decodeReceipt() helper -- fetches receipt, extracts amountOut/gasCost/block
    abis.ts              # Modified: add WETH_ABI with Withdrawal + Transfer events
    db.ts                # UNCHANGED: insertTrade already has amountOut/gasCost/block params
    txManager.ts         # UNCHANGED per D-04 (but Flashbots strategy fix recommended)
  utils/mevStrategies/
    flashbots.ts         # RECOMMENDED FIX: return real tx hash from bundleTransactions[0].hash
```

### Pattern 1: Receipt Decoder Helper
**What:** Extracted utility function that takes a tx hash + provider + chain context and returns `{ amountOut, gasCost, blockNumber }` or nulls.
**When to use:** After sendTxWithRetry returns in both executeFullSell and executePartialSell.
**Example:**
```typescript
// Source: ethers v6 TransactionReceipt API [VERIFIED: node_modules/ethers/src.ts/providers/provider.ts]
import { ethers, Interface } from 'ethers';
import type { JsonRpcProvider, TransactionReceipt, Log } from 'ethers';

const WETH_ABI = [
    'event Withdrawal(address indexed src, uint256 wad)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
];
const wethIface = new Interface(WETH_ABI);

// Withdrawal topic: 0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65
// Transfer topic:   0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
// [VERIFIED: computed via ethers.id() in this session]

export interface ReceiptData {
    amountOut: string | null;  // ETH/BNB received as bigint string
    gasCost: string | null;    // gasUsed * gasPrice as bigint string
    blockNumber: number | null;
}

export async function decodeReceipt(
    txHash: string,
    provider: JsonRpcProvider,
    wethAddress: string,
    walletAddress: string,
    log: { info: Function; warn: Function },
): Promise<ReceiptData> {
    // D-05: fetch receipt with one retry
    let receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
        await new Promise(r => setTimeout(r, 2000));
        receipt = await provider.getTransactionReceipt(txHash);
    }
    if (!receipt) {
        log.warn({ txHash }, 'Receipt not available after retry, recording nulls');
        return { amountOut: null, gasCost: null, blockNumber: null };
    }

    // D-03: gas cost = gasUsed * gasPrice (effectiveGasPrice in ethers v6)
    const gasCost = (receipt.gasUsed * receipt.gasPrice).toString();
    const blockNumber = receipt.blockNumber;

    // D-01: Find WETH Withdrawal event (V2 path)
    const wethLower = wethAddress.toLowerCase();
    const walletLower = walletAddress.toLowerCase();
    
    // Strategy 1: WETH Withdrawal (V2 -- router unwraps WETH to native ETH)
    for (const logEntry of receipt.logs) {
        if (logEntry.address.toLowerCase() !== wethLower) continue;
        try {
            const parsed = wethIface.parseLog({ topics: logEntry.topics as string[], data: logEntry.data });
            if (parsed && parsed.name === 'Withdrawal') {
                return { amountOut: parsed.args.wad.toString(), gasCost, blockNumber };
            }
        } catch { /* not a matching event */ }
    }

    // Strategy 2: WETH Transfer to wallet (V3 path -- WETH sent directly)
    for (const logEntry of receipt.logs) {
        if (logEntry.address.toLowerCase() !== wethLower) continue;
        try {
            const parsed = wethIface.parseLog({ topics: logEntry.topics as string[], data: logEntry.data });
            if (parsed && parsed.name === 'Transfer' && parsed.args.to.toLowerCase() === walletLower) {
                return { amountOut: parsed.args.value.toString(), gasCost, blockNumber };
            }
        } catch { /* not a matching event */ }
    }

    // D-02: No matching event found
    log.warn({ txHash, blockNumber }, 'No WETH Withdrawal or Transfer event found in receipt');
    return { amountOut: null, gasCost, blockNumber };
}
```

### Pattern 2: Integration into executeFullSell/executePartialSell
**What:** After `sendTxWithRetry` returns, call `decodeReceipt` and pass results to `insertTrade.run`.
**When to use:** In both sell functions, between the `sendTxWithRetry` call and the `insertTrade.run` call.
**Example:**
```typescript
// After sendTxWithRetry returns:
const txHash = await sendTxWithRetry(txBuilder, ctx);

// Decode receipt (non-blocking: nulls on failure per D-02)
const receiptData = await decodeReceipt(
    txHash as string,  // sendTxWithRetry returns string | void
    ctx.httpProvider,
    ctx.chain.wethAddress,
    ctx.wallet.address,
    ctx.log,
);

// Record sell trade with decoded values
insertTrade.run({
    // ...existing params...
    block: receiptData.blockNumber,
    amountOut: receiptData.amountOut,
    gasCost: receiptData.gasCost,
    // ...rest unchanged...
});
```

### Anti-Patterns to Avoid
- **Balance diff approach:** Don't compute amountOut as `postBalance - preBalance`. Race conditions with other transactions make this unreliable for automated bots.
- **Modifying sendTxWithRetry interface:** Per D-04, the receipt fetch is localized in exitEngine. Don't change txManager or MevStrategy types.
- **Blocking on receipt failure:** If receipt is unavailable, log and continue with null values. Don't throw -- the trade already executed successfully.
- **Parsing all logs indiscriminately:** Filter by `log.address === wethAddress` first, then parse. Avoids false positives from other contracts emitting Transfer events.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event topic computation | Manual keccak256 of signature | `ethers.Interface.getEvent('Withdrawal').topicHash` | Handles ABI encoding edge cases, type-safe |
| Log data decoding | Manual ABI decoding of topics+data | `Interface.parseLog({ topics, data })` | Handles indexed vs non-indexed param extraction correctly |
| Gas price from receipt | Manual effectiveGasPrice computation | `receipt.gasPrice` (ethers v6 already maps effectiveGasPrice to gasPrice) | ethers v6 constructor normalizes this [VERIFIED: provider.ts:1090-1095] |

**Key insight:** ethers v6 TransactionReceipt constructor maps `effectiveGasPrice` to the `gasPrice` field automatically. D-03 references `receipt.effectiveGasPrice`, but in ethers v6 the correct field is `receipt.gasPrice` which already IS the effective gas price. [VERIFIED: node_modules/ethers/src.ts/providers/provider.ts lines 1090-1095]

## Common Pitfalls

### Pitfall 1: V3 Sells Don't Emit WETH Withdrawal
**What goes wrong:** D-01 assumes all token-to-ETH swaps unwrap WETH. V3 `exactInputSingle` with `recipient: walletAddress` sends WETH tokens directly -- no `Withdrawal` event. Only V2 `swapExactTokensForETH` calls `WETH.withdraw()`.
**Why it happens:** V2 Router unwraps WETH as part of `swapExactTokensForETH`. V3 SwapRouter02 only unwraps if you include `unwrapWETH9` in the multicall and set recipient to `address(2)`. Current `buildV3SellTx` does neither. [VERIFIED: src/exitEngine.ts:370-398, Uniswap V3 docs]
**How to avoid:** Also look for WETH `Transfer(from, to=walletAddress, value)` events as a V3 fallback after checking for `Withdrawal`. This is the recommended two-event strategy.
**Warning signs:** Unit tests pass but V3 sell rows still have null amountOut.

### Pitfall 2: Flashbots Returns Synthetic TX Hash
**What goes wrong:** `FlashbotsMevStrategy.sendTransaction` returns `flashbots_bundle_block_${targetBlock}` -- not a real tx hash. `getTransactionReceipt(syntheticHash)` returns null, so D-05 kicks in and amountOut stays null for all ETH mainnet Flashbots sells.
**Why it happens:** The Flashbots strategy was written before receipt decoding was needed. It discards `bundleTransactions[0].hash` (the real tx hash). [VERIFIED: src/utils/mevStrategies/flashbots.ts:76]
**How to avoid:** Fix `FlashbotsMevStrategy.sendTransaction` to return `bundleTransactions[0].hash` instead of the synthetic string. This is an implementation change, NOT an interface change -- `MevStrategy.sendTransaction` still returns `Promise<string>`. Consistent with D-04. [VERIFIED: @flashbots/ethers-provider-bundle TransactionAccountNonce has hash field]
**Warning signs:** All ETH mainnet sells have null amountOut despite correct V2 Withdrawal decoding logic.

### Pitfall 3: sendTxWithRetry Returns `string | void`
**What goes wrong:** The multi-chain path returns `string` (from strategy), but the legacy path can return `void` (Flashbots bundle path in txManager.ts). TypeScript type is `Promise<string | void>`.
**Why it happens:** Legacy code paths in `sendTxWithRetry` return void for Flashbots bundles. [VERIFIED: src/utils/txManager.ts:64, :131]
**How to avoid:** Check for falsy txHash before calling decodeReceipt. If txHash is undefined/void, skip receipt decoding and record nulls. The legacy path is not used by multi-chain exitEngine (which always goes through strategy dispatch), but the type system doesn't narrow this.
**Warning signs:** Runtime error when passing undefined to getTransactionReceipt.

### Pitfall 4: effectiveGasPrice vs gasPrice Field Naming
**What goes wrong:** D-03 says `receipt.effectiveGasPrice` but ethers v6 TransactionReceipt exposes this as `receipt.gasPrice`. Using `receipt.effectiveGasPrice` causes a TypeScript error.
**Why it happens:** ethers v6 changed the property name. The constructor explicitly maps effectiveGasPrice from the RPC response to the `gasPrice` property. [VERIFIED: node_modules/ethers/src.ts/providers/provider.ts:1090-1095]
**How to avoid:** Use `receipt.gasPrice` (bigint). Gas cost = `receipt.gasUsed * receipt.gasPrice`.
**Warning signs:** TypeScript compile error on `receipt.effectiveGasPrice`.

### Pitfall 5: BigInt String Formatting
**What goes wrong:** `amount_out` and `gas_cost` are TEXT columns in SQLite. Storing BigInt requires `.toString()`.
**Why it happens:** JavaScript BigInt cannot be directly passed to better-sqlite3 string columns.
**How to avoid:** Always call `.toString()` on BigInt values before passing to insertTrade. The existing pattern stores amounts as strings. [VERIFIED: src/exitEngine.ts:479 `balance.toString()`]
**Warning signs:** SQLite error or [object Object] stored in column.

### Pitfall 6: Multiple WETH Transfer Events in V3 Receipts
**What goes wrong:** V3 swap receipts may contain multiple Transfer events on the WETH contract (e.g., pool-to-router and router-to-wallet). Picking the wrong one gives incorrect amountOut.
**Why it happens:** V3 multi-hop paths involve intermediate transfers.
**How to avoid:** For V3, match specifically on `Transfer(from=any, to=walletAddress)` -- the last Transfer TO the wallet is the final output amount. Since the bot only does single-hop swaps (token to WETH), there should be exactly one Transfer to the wallet.
**Warning signs:** amountOut is present but wrong value (an intermediate transfer amount).

## Code Examples

### Receipt Decoding with ethers v6

```typescript
// Source: ethers v6 Interface.parseLog [VERIFIED: ethers@6.16.0 installed]
import { Interface } from 'ethers';
import type { TransactionReceipt } from 'ethers';

const WETH_ABI = [
    'event Withdrawal(address indexed src, uint256 wad)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
];
const wethIface = new Interface(WETH_ABI);

function extractAmountOut(
    receipt: TransactionReceipt,
    wethAddress: string,
    walletAddress: string,
): bigint | null {
    const wethLower = wethAddress.toLowerCase();
    const walletLower = walletAddress.toLowerCase();

    for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== wethLower) continue;
        try {
            const parsed = wethIface.parseLog({
                topics: log.topics as string[],
                data: log.data,
            });
            if (!parsed) continue;

            // V2: Withdrawal(src, wad)
            if (parsed.name === 'Withdrawal') {
                return parsed.args.wad;
            }
            // V3: Transfer(from, to=wallet, value)
            if (parsed.name === 'Transfer' && parsed.args.to.toLowerCase() === walletLower) {
                return parsed.args.value;
            }
        } catch { /* skip non-matching log */ }
    }
    return null;
}
```

### Gas Cost Computation

```typescript
// Source: ethers v6 TransactionReceipt [VERIFIED: gasUsed and gasPrice are bigint]
function extractGasCost(receipt: TransactionReceipt): bigint {
    return receipt.gasUsed * receipt.gasPrice;
}
```

### Fetching Receipt with Retry (D-05)

```typescript
// Source: ethers v6 JsonRpcProvider.getTransactionReceipt [VERIFIED: returns TransactionReceipt | null]
async function fetchReceiptWithRetry(
    txHash: string,
    provider: JsonRpcProvider,
): Promise<TransactionReceipt | null> {
    let receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
        await new Promise(r => setTimeout(r, 2000));
        receipt = await provider.getTransactionReceipt(txHash);
    }
    return receipt;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `receipt.effectiveGasPrice` | `receipt.gasPrice` | ethers v6 | Field renamed; constructor auto-maps [VERIFIED] |
| `BigNumber.from()` | Native BigInt | ethers v6 | gasUsed and gasPrice are native bigint [VERIFIED] |
| `Interface.decodeEventLog()` | `Interface.parseLog()` | ethers v6 | parseLog returns null instead of throwing on mismatch [VERIFIED] |
| Manual topic comparison | `Interface.parseLog()` | ethers v6 | parseLog handles topic matching internally |

**Deprecated/outdated:**
- `receipt.effectiveGasPrice`: Does not exist as a property in ethers v6 TransactionReceipt. Use `receipt.gasPrice`. [VERIFIED: node_modules/ethers/src.ts/providers/provider.ts]
- `BigNumber`: Removed in ethers v6. All numeric receipt fields are native BigInt. [VERIFIED: gasUsed/gasPrice/cumulativeGasUsed are all bigint]

## Assumptions Log

> List all claims tagged `[ASSUMED]` in this research.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | V3 SwapRouter02 exactInputSingle with recipient=wallet sends WETH without unwrap | Pitfall 1 | If V3 DOES emit Withdrawal, the Transfer fallback is harmless but unnecessary |
| A2 | bloXroute sendTransaction returns a real tx hash (not synthetic) | Pitfall 2 | If synthetic, BSC sells would also have null amountOut |
| A3 | Single-hop V3 swaps produce exactly one WETH Transfer to wallet | Pitfall 6 | If multiple Transfers, could pick wrong amount (mitigated by wallet filter) |

**Note:** A1 is supported by Uniswap V3 documentation and code analysis (the `buildV3SellTx` function does not include `unwrapWETH9`), but is tagged ASSUMED because the on-chain behavior was not verified with a live transaction. A2 is supported by the bloXroute strategy returning `data.result` from the API response. A3 follows from single-hop swap mechanics.

## Open Questions (RESOLVED)

1. **Should the Flashbots strategy be fixed to return real tx hash?**
   - What we know: Current FlashbotsMevStrategy returns `flashbots_bundle_block_N`, not a real hash. The real hash is available in `bundleTransactions[0].hash`. Fixing this is an implementation change, not interface change (D-04 safe).
   - What's unclear: Whether this fix should be part of Phase 14 or a separate task.
   - Recommendation: Include it in Phase 14 as a prerequisite fix. Without it, all ETH mainnet sells via Flashbots will continue to have null amountOut, defeating the purpose.
   - RESOLVED: Included in Plan 02 Task 1 Part A. Flashbots strategy changed to return `bundleTransactions[0].hash` instead of synthetic string.

2. **Should V3 sells be modified to unwrap WETH?**
   - What we know: Adding `unwrapWETH9` to the V3 multicall and setting recipient to `address(2)` would make V3 emit Withdrawal events, making D-01 work as-is.
   - What's unclear: Whether modifying the V3 sell path is in scope for this phase (it changes swap behavior, not just receipt decoding).
   - Recommendation: Do NOT modify the V3 sell path. Use the Transfer fallback instead. Changing swap mechanics is risky and out of scope.
   - RESOLVED: Do NOT modify V3 sell path. Plan 01 implements WETH Transfer(to=wallet) fallback in receiptDecoder.ts instead.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.1 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --project unit` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-03 | Sell row has non-null amountOut after executeFullSell | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "extractAmountOut"` | Wave 0 |
| DB-03 | Gas cost recorded as gasUsed * gasPrice string | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "gas cost"` | Wave 0 |
| DB-03 | Block number recorded from receipt | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "block number"` | Wave 0 |
| DB-04 | getPnL returns correct realized P&L with non-null amountOut | unit | `npx vitest run test/unit/db.test.ts -t "P&L"` | Existing (partial) |
| DB-03 | Partial sell row has non-null amountOut | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "partial sell"` | Wave 0 |
| DB-03 | Receipt retry on null (D-05) | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "retry"` | Wave 0 |
| DB-03 | Missing Withdrawal event records null (D-02) | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "missing event"` | Wave 0 |
| DB-03 | V3 Transfer fallback when no Withdrawal | unit | `npx vitest run test/unit/receiptDecoder.test.ts -t "Transfer fallback"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --project unit`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before /gsd-verify-work

### Wave 0 Gaps
- [ ] `test/unit/receiptDecoder.test.ts` -- covers decodeReceipt helper (Withdrawal, Transfer fallback, retry, null cases)
- [ ] `test/fixtures/receipt.fixtures.ts` -- mock TransactionReceipt and Log objects for receipt decoding tests

*(Existing `test/unit/exitEngine.test.ts` tests pure functions only. The executeFullSell/executePartialSell integration is not unit-tested due to heavy mocking requirements. Receipt decoder as an extracted utility enables focused unit testing.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | yes | Validate receipt data before writing to DB (check for null, validate bigint strings) |
| V6 Cryptography | no | N/A (event topics are public, no secrets) |

### Known Threat Patterns for Receipt Decoding

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious token emits fake WETH events | Spoofing | Filter logs by `log.address === wethAddress` (only trust events from known WETH contract) |
| Receipt contains unexpected data types | Tampering | parseLog returns null on decode failure; try/catch around each log |
| Gas cost overflow | Information Disclosure | BigInt handles arbitrary precision; `.toString()` is safe |

## Sources

### Primary (HIGH confidence)
- ethers v6 source code (node_modules/ethers/src.ts/providers/provider.ts) -- TransactionReceipt class, gasUsed/gasPrice types, Log class
- Project source code (src/exitEngine.ts, src/utils/db.ts, src/utils/txManager.ts, src/utils/mevStrategies/*.ts) -- current implementation patterns
- @flashbots/ethers-provider-bundle source (node_modules/@flashbots/ethers-provider-bundle/src/index.ts) -- FlashbotsTransactionResponse interface, bundleTransactions hash field

### Secondary (MEDIUM confidence)
- [Uniswap V3 Single Swaps Guide](https://docs.uniswap.org/contracts/v3/guides/swaps/single-swaps) -- exactInputSingle parameters
- [Working with Uniswap Swap Router multiCall](https://medium.com/@arian.web3developer/working-with-uniswap-swap-router-multicall-ef120b8ddced) -- unwrapWETH9 in multicall pattern

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all verified against installed versions
- Architecture: HIGH -- receipt decoding is a well-understood EVM pattern; code changes are localized
- Pitfalls: HIGH -- V3/Flashbots issues verified against actual source code in node_modules and src/

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (stable domain -- EVM receipt format and ethers v6 API are mature)
