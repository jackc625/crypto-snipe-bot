---
phase: 14-sell-revenue-receipt-decoding
reviewed: 2026-04-06T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/utils/receiptDecoder.ts
  - src/utils/abis.ts
  - src/exitEngine.ts
  - src/utils/mevStrategies/flashbots.ts
  - test/unit/receiptDecoder.test.ts
  - test/fixtures/receipt.fixtures.ts
  - test/unit/exitEngineSell.test.ts
  - test/integration/mevStrategies.test.ts
  - test/integration/txManager.test.ts
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-04-06
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 14 closes the INT-AMOUNT-OUT-NULL gap cleanly. The new `decodeReceipt` utility implements the address-filter-before-parse security design (T-14-01), the defensive gasPrice null guard is correct, and the Flashbots synthetic-hash bug is properly fixed with a loud-throw guard. The `if (txHash)` guard in exitEngine preserves the legacy void path without corrupting sell rows.

Strengths:
- Security-first log parsing: all WETH logs are address-filtered BEFORE being passed to `Interface.parseLog`, preventing spoofed events from non-WETH contracts (T-14-01).
- Defensive null guard on `receipt.gasPrice` avoids silently computing `gasUsed * undefined = NaN`-equivalent bigint bugs.
- Flashbots guard (`src/utils/mevStrategies/flashbots.ts:81-83`) throws a descriptive error rather than returning `undefined as string`, failing loudly.
- Strong test coverage for `decodeReceipt` (11 tests covering V2/V3/retry/spoof/malformed/multi-transfer/missing-gasPrice) and for `executeFullSell` execution-path integration.
- Tests correctly mock `decodeReceipt` and `insertTrade.run` to verify end-to-end money-flow into the DB row.

Concerns worth addressing before merge:
- No `from`-address validation on V3 Transfer strategy — any unrelated WETH inflow to the wallet landing in the same receipt could be misattributed (WR-01).
- First-match-wins semantic for Withdrawal events is risky for fee-on-transfer router variants that may emit multiple Withdrawals for a single sell (WR-02).
- The "throw loudly" intent for the Flashbots missing-hash guard is undermined by the surrounding retry loop — the descriptive error is caught, logged as `Flashbots retry`, and retried up to `maxRetries` times before finally surfacing (WR-03).
- Minor coverage asymmetry and defensive-coding improvements noted in Info.

## Warnings

### WR-01: V3 Transfer strategy does not validate `from` address

**File:** `src/utils/receiptDecoder.ts:97`
**Issue:** The V3 strategy accepts any `Transfer(to=wallet)` event emitted by the WETH contract, regardless of the sender. In practice, for the single-hop V3 sell with `recipient=wallet`, the WETH is transferred directly from the V3 pool to the wallet, so the log is correct. However, if the same receipt happens to contain an unrelated `WETH.Transfer(from=X, to=wallet)` (e.g., an orphan WETH movement from a router helper, a multicall intermediate, or — more realistically — a WETH Transfer emitted from an upstream helper contract for approval/refund), the current code will accept it as the sell output. In the worst case, an earlier Transfer-to-wallet in the same block log ordering will shadow the real swap output.

For single-hop V3 `exactInputSingle(recipient=wallet)` this should not happen in practice, but the code has no defense-in-depth against this. The plan (D-01) specifies the `Transfer(to=wallet)` semantic, but does not constrain `from`.

**Fix:** Prefer the V3 strategy to match on the specific `from` address of the V3 pool/swap contract when known, or at minimum, pair it with a stricter ordering assumption (e.g., "last Transfer(to=wallet) in the log order wins," which is the standard ethers pattern for decoding swap outputs). If neither is feasible in the current scope, add a comment explicitly documenting the trust assumption: that only the single-hop `exactInputSingle(recipient=wallet)` path is supported and any receipt containing additional WETH inflows to the wallet may mis-attribute.

```ts
// Strategy 2: WETH Transfer to wallet (V3 path -- WETH sent directly without unwrap).
// LIMITATION: this assumes the receipt contains exactly one Transfer(to=wallet) from
// the WETH contract. Multi-hop paths, refund flows, or auxiliary WETH movements to
// the wallet in the same receipt will cause mis-attribution. Phase 14 scope is
// limited to single-hop exactInputSingle(recipient=wallet).
for (const logEntry of receipt.logs) {
    // ... existing filter ...
}
```

Longer-term, consider reversing the loop (`receipt.logs.slice().reverse()`) so the final `Transfer(to=wallet)` wins, which is conventionally the swap output in ordered EVM log sequences.

### WR-02: First-match-wins for WETH Withdrawal may under-report on fee-on-transfer routers

**File:** `src/utils/receiptDecoder.ts:74-86`
**Issue:** The Withdrawal strategy returns the first WETH `Withdrawal` event as the full `amountOut`. For single-hop `swapExactTokensForETH`, this is correct — the router emits exactly one Withdrawal equal to the total ETH output. However, `src/utils/abis.ts:16` also lists `swapExactTokensForETHSupportingFeeOnTransferTokens` in ROUTER_ABI. Although Phase 14 scope is intentionally limited to the non-FOT builder (`swapExactTokensForETH` in `buildV2SellTx` at `src/exitEngine.ts:356`), the receiptDecoder has no guard preventing it from being called on a receipt from a FOT sell in a future phase — in which case multiple intermediate Withdrawals may be emitted and the first-match semantic would under-report.

**Fix:** Either:
1. Add a TODO comment + runtime warning if more than one matching Withdrawal event is found, so future regressions are caught loudly:

```ts
// Strategy 1: WETH Withdrawal (V2 path)
const withdrawals: bigint[] = [];
for (const logEntry of receipt.logs) {
    if (logEntry.address.toLowerCase() !== wethLower) continue;
    try {
        const parsed = wethIface.parseLog({
            topics: logEntry.topics as string[],
            data: logEntry.data,
        });
        if (parsed && parsed.name === 'Withdrawal') {
            withdrawals.push(parsed.args.wad);
        }
    } catch { /* malformed -- ignore */ }
}
if (withdrawals.length > 0) {
    if (withdrawals.length > 1) {
        log.warn(
            { txHash, count: withdrawals.length, values: withdrawals.map(w => w.toString()) },
            'Multiple WETH Withdrawal events found in receipt -- using first (may under-report for fee-on-transfer routers)',
        );
    }
    const amountOut = withdrawals[0].toString();
    log.info({ txHash, blockNumber, amountOut }, 'Decoded WETH Withdrawal (V2)');
    return { amountOut, gasCost, blockNumber };
}
```

2. Or explicitly document the scope boundary in the header comment and add a unit test that asserts the first-match behavior on a multi-Withdrawal receipt (currently only tested for multi-Transfer). This locks in the semantic and will force future FOT support to revisit the decoder.

### WR-03: Flashbots "missing hash" guard is swallowed by the retry loop

**File:** `src/utils/mevStrategies/flashbots.ts:81-90`
**Issue:** The comment on line 78 states the guard throws "loudly" if the library response shape is malformed. In practice, the `throw new Error(...)` on line 82 is caught by the enclosing `catch (err)` on line 87, which logs it as a generic `Flashbots retry` warning and re-attempts up to `maxRetries` times before propagating. For a shape-level protocol bug (e.g., flashbots lib ships a breaking change that removes `bundleTransactions`), every retry will produce the same error, so the loop just burns 3 extra sendBundle calls and delays the real error surface by several blocks.

The regression test at `test/integration/mevStrategies.test.ts:166-194` passes only because it explicitly uses `maxRetries: 0`, which hides the retry-swallow behavior.

**Fix:** Differentiate between transient errors (bundle not included, network) and structural errors (missing field) — throw structural errors through the retry loop:

```ts
if (waitResponse === 0) {
    log.info({ block: targetBlock, attempt: attempt + 1 }, 'Flashbots bundle included');
    const realHash = bundle.bundleTransactions?.[0]?.hash;
    if (!realHash) {
        // Structural error: do not retry, surface immediately
        const structuralErr = new Error(
            `Flashbots bundle response missing bundleTransactions[0].hash for block ${targetBlock}`,
        );
        (structuralErr as any).isStructural = true;
        throw structuralErr;
    }
    return realHash;
}
// ...
} catch (err) {
    if ((err as any)?.isStructural) throw err; // skip retry
    log.warn({ attempt: attempt + 1, maxRetries, err }, 'Flashbots retry');
    if (attempt >= maxRetries) throw err;
}
```

Alternatively, add a regression test that uses the default `maxRetries: 3` path to confirm the behavior you actually want — either "retries 3x then throws" (current) or "throws immediately" (intended per comment). The current test at line 191 (`await expect(...).rejects.toThrow(/missing bundleTransactions\[0\]\.hash/)`) passes only because `maxRetries: 0` is passed.

## Info

### IN-01: `receipt.gasPrice == null` check is technically unreachable under ethers v6 types

**File:** `src/utils/receiptDecoder.ts:58`
**Issue:** `TransactionReceipt.gasPrice` is typed as non-nullable `bigint` in ethers v6 (`node_modules/ethers/lib.commonjs/providers/provider.d.ts:625`). The null-check is defensive programming against non-compliant RPC providers / forks / mocks, but a strict `noUncheckedIndexedAccess` + `strict` TypeScript compiler will not flag this as reachable code. The mock test has to use `null as any` (`test/unit/receiptDecoder.test.ts:157`) to construct the edge case.
**Fix:** Keep the defensive guard (real-world RPCs do return null), but add a short comment explaining the type-vs-runtime mismatch:

```ts
// NOTE: ethers v6 types gasPrice as non-nullable bigint, but some RPC providers
// (Anvil forks, older geth, patched nodes) return null. We defend against runtime
// reality rather than relying on the type system here.
if (receipt.gasPrice == null) {
```

### IN-02: Two-pass log iteration is redundant

**File:** `src/utils/receiptDecoder.ts:74-102`
**Issue:** The decoder iterates `receipt.logs` twice — once for Withdrawal, once for Transfer. For most sell receipts, logs are short (<20 entries), so perf is negligible, but the intent is clearer in a single pass.
**Fix:** Merge into a single pass with an explicit priority: prefer Withdrawal over Transfer (matches current behavior):

```ts
let transferMatch: { amountOut: string } | null = null;
for (const logEntry of receipt.logs) {
    if (logEntry.address.toLowerCase() !== wethLower) continue;
    try {
        const parsed = wethIface.parseLog({
            topics: logEntry.topics as string[],
            data: logEntry.data,
        });
        if (!parsed) continue;
        if (parsed.name === 'Withdrawal') {
            return { amountOut: parsed.args.wad.toString(), gasCost, blockNumber };
        }
        if (
            parsed.name === 'Transfer' &&
            parsed.args.to.toLowerCase() === walletLower &&
            transferMatch == null
        ) {
            transferMatch = { amountOut: parsed.args.value.toString() };
        }
    } catch { /* malformed -- ignore */ }
}
if (transferMatch) return { ...transferMatch, gasCost, blockNumber };
```

This also makes the Withdrawal-beats-Transfer priority explicit (currently implicit from loop ordering) and avoids a subtle bug where a receipt containing both a Withdrawal and a Transfer-to-wallet would silently pick Withdrawal — which is correct, but not obvious from the two-loop layout.

### IN-03: Partial-sell legacy-void path lacks test coverage

**File:** `test/unit/exitEngineSell.test.ts:206-250`
**Issue:** `executeFullSell` has two tests: one for the happy path and one for `sendTxWithRetry` returning `undefined` (legacy void path). `executePartialSell` only has the happy-path test. The `if (txHash)` guard in `src/exitEngine.ts:588` is identical to the one in `executeFullSell`, so the risk is low, but the symmetry is missing and a future refactor to the partial-sell guard would not be caught.
**Fix:** Add a mirror test:

```ts
it('executePartialSell: skips decodeReceipt and records nulls when sendTxWithRetry returns void', async () => {
    sendTxWithRetryMock.mockResolvedValue(undefined);
    // ... same setup as happy path ...
    const ok = await executePartialSell(/* ... */);
    expect(ok).toBe(true);
    expect(decodeReceiptMock).not.toHaveBeenCalled();
    expect(insertTradeRun).toHaveBeenCalledWith(
        expect.objectContaining({
            action: 'partial_sell',
            amountOut: null,
            gasCost: null,
            block: null,
        }),
    );
});
```

### IN-04: Multi-Withdrawal receipt behavior not locked in by test

**File:** `test/unit/receiptDecoder.test.ts:131-142`
**Issue:** The test "picks the first WETH Transfer-to-wallet match when multiple exist" locks in first-match behavior for the V3 Transfer strategy, but there is no equivalent test for the V2 Withdrawal strategy. If a future refactor changes Withdrawal handling (see WR-02), there is no regression guard.
**Fix:** Add a mirror test for the Withdrawal path:

```ts
it('picks the first WETH Withdrawal match when multiple exist (documented first-match behavior)', async () => {
    const first = createWithdrawalLog(WETH_ADDRESS, WALLET_ADDRESS, 1_000_000_000_000_000_000n);
    const second = createWithdrawalLog(WETH_ADDRESS, WALLET_ADDRESS, 9_000_000_000_000_000_000n);
    const receipt = createMockReceipt({ logs: [first, second] });
    const provider = makeProvider([receipt]);
    const result = await decodeReceipt(FAKE_TX_HASH, provider, WETH_ADDRESS, WALLET_ADDRESS);
    expect(result.amountOut).toBe('1000000000000000000');
});
```

### IN-05: `FAKE_TX_HASH` constant re-used across unrelated tests

**File:** `test/fixtures/receipt.fixtures.ts:9`
**Issue:** `FAKE_TX_HASH` is a single shared constant. If a future test asserts on tx hashes in log output (e.g., "decodeReceipt warned with the correct hash"), reusing a single fixture value makes the assertion less meaningful. Minor style issue.
**Fix:** Leave as-is for now; consider parameterizing if test assertions start depending on hash identity.

### IN-06: Unused `FOREIGN_TOKEN_ADDRESS` parameter in V3 Transfer happy-path test

**File:** `test/unit/receiptDecoder.test.ts:59`
**Issue:** The `extracts amountOut from V3 WETH Transfer-to-wallet fallback` test passes `FOREIGN_TOKEN_ADDRESS` as the `from` address of a WETH Transfer. In practice, V3 WETH Transfers would be emitted from the V3 pool address, not a random token. This is cosmetic — the test is correct because the decoder doesn't check `from` — but the fixture value is misleading. Related to WR-01: if the decoder is hardened to validate `from`, this test will need to change.
**Fix:** Rename `FOREIGN_TOKEN_ADDRESS` to `V3_POOL_ADDRESS` or similar in the fixture file, or add a comment clarifying that the fixture's `from` address is intentionally arbitrary because the decoder does not validate it.

---

## Focus Area Verification

The phase context called out 8 specific focus areas. Review findings per area:

1. **decodeReceipt address-filter-before-parse (T-14-01):** CORRECT. Both strategies filter by `logEntry.address.toLowerCase() !== wethLower` before calling `parseLog`. The spoofing test (`receiptDecoder.test.ts:122-129`) explicitly verifies that a `Transfer(to=wallet)` emitted by `FOREIGN_TOKEN_ADDRESS` is rejected. No bypass found.

2. **Defensive gasPrice null guard:** CORRECT. The guard on `receiptDecoder.ts:58-63` records `null` and logs a warning rather than silently computing a wrong value. Note IN-01 regarding type-vs-runtime mismatch (non-blocking).

3. **First-match-wins semantic for multiple WETH Transfer events:** DOCUMENTED but see WR-02 for the Withdrawal path risk. For single-hop sells (the scoped path), first-match is safe. For a future FOT or multi-hop support, summation would be safer.

4. **Flashbots defensive guard:** PRESENT and correct in form, but see WR-03 — the retry loop swallows the descriptive error and retries. The unit test passes only because it explicitly uses `maxRetries: 0`, which does not reflect production behavior (`sendTxWithRetry` defaults to 3).

5. **exitEngine if-txHash guard:** CORRECT. `src/exitEngine.ts:481` and `:588` both initialize `receiptData` with all-null defaults and only overwrite when `txHash` is truthy. Tests (`exitEngineSell.test.ts:174-203`) explicitly verify the legacy void path records nulls. Partial-sell path has the same guard but no mirror test (see IN-03).

6. **Money-flow bugs in receiptData -> insertTrade.run:** NO BUGS FOUND. The flow is: `receiptData.amountOut -> insertTrade.amountOut`, `receiptData.gasCost -> insertTrade.gasCost`, `receiptData.blockNumber -> insertTrade.block`. All three fields are consistently plumbed in both `executeFullSell` (`src/exitEngine.ts:486-501`) and `executePartialSell` (`src/exitEngine.ts:593-608`). The integration tests assert the exact object shape via `expect.objectContaining({...})`.

7. **Missing test coverage:** See IN-03, IN-04. Partial-sell legacy void path and multi-Withdrawal receipt are the two gaps. Low risk, worth adding.

8. **BigInt arithmetic in gasCost computation:** CORRECT. `(receipt.gasUsed * receipt.gasPrice).toString()` — both operands are `bigint` in ethers v6 (see `TransactionReceipt` interface at `node_modules/ethers/lib.commonjs/providers/provider.d.ts:625`). No precision loss, no mixing with `number`. The test `computes gas cost as gasUsed * gasPrice string` (`receiptDecoder.test.ts:66-75`) verifies `100000n * 30000000000n = 3000000000000000n`.

---

_Reviewed: 2026-04-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
