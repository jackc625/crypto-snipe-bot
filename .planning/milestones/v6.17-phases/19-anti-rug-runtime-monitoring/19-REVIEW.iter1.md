---
phase: 19-anti-rug-runtime-monitoring
reviewed: 2026-05-24T00:00:00Z
depth: deep
files_reviewed: 28
files_reviewed_list:
  - dashboard/src/components/PositionTable.tsx
  - dashboard/src/hooks/WebSocketContext.tsx
  - dashboard/src/hooks/useWebSocket.ts
  - dashboard/src/pages/Overview.tsx
  - dashboard/src/types/api.ts
  - docs/operations/anti-rug-rollout.md
  - docs/operations/anti-rug-tuning.md
  - src/anti-rug/allowlist.ts
  - src/anti-rug/detector.ts
  - src/anti-rug/events.ts
  - src/anti-rug/exitTrigger.ts
  - src/anti-rug/lpBaseline.ts
  - src/anti-rug/types.ts
  - src/api/server.ts
  - src/bot.ts
  - src/chainRegistry.ts
  - src/config.ts
  - src/exitEngine.ts
  - src/utils/db.ts
  - test/integration/anti-rug/wsReconnectBackfill.test.ts
  - test/unit/anti-rug/allowlist.test.ts
  - test/unit/anti-rug/detectorEvaluator.test.ts
  - test/unit/anti-rug/detectorRegistry.test.ts
  - test/unit/anti-rug/lpBaseline.test.ts
  - test/unit/anti-rug/types.test.ts
  - test/unit/chainRegistry/antiRugConfig.test.ts
  - test/unit/db/lpBaselineMigration.test.ts
findings:
  critical: 7
  warning: 9
  info: 6
  total: 22
status: issues_found
---

# Phase 19: Code Review Report

**Reviewed:** 2026-05-24
**Depth:** deep
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Deep cross-file adversarial review of Phase 19 anti-rug runtime monitoring. The implementation has substantial scope (LP baseline, multi-signal detector, allowlist, exit trigger, circuit breaker, dashboard surfaces, WS lifecycle, backfill) and the core logic is generally well-thought-out — discriminated-union evaluator with vacuous-pass guards, fail-loud env validation, dry-run safety defaults, circuit breaker bounded by per-chain config.

However, the review surfaced **seven Critical defects** that touch security, correctness on the live-execute path, and a runtime-broken dashboard CB-reset flow:

1. **Backend `cb_tripped` payload field-name mismatch with frontend type** — the dashboard's CB-reset modal cannot be opened by the operator (gating UX broken), and the banner displays "undefined triggers". This is the highest-stakes operator workflow in Phase 19 and it is non-functional as shipped.
2. **Gap-1 fix (anti-rug gas multiplier) is broken on ETH** — Flashbots strategy applies multiplier to legacy `gasPrice` only, but ETH gas config is EIP-1559. The multiplier never reaches `maxFeePerGas`/`maxPriorityFeePerGas`, so the anti-rug exit will not outbid the rug-puller on the primary target chain.
3. **`registerAntiRugPosition` is async but not awaited at buy success** — bot.ts:425 (V2) and bot.ts:679 (V3) call without `await` inside a try/catch. Any error inside (RPC failure during WS subscription) becomes an unhandled promise rejection, bypassing the documented baseline-snapshot-failed log.
4. **Allowlist verification failure leaves the chain monitoring with unverified addresses** — when `verifyAllowlistAtStartup` throws (e.g., RPC down at boot), the resume path catches and continues, but Step 3 still registers positions and Step 4 still arms the listener. The D-LIST-VERIFY contract claims "the chain runs without anti-rug monitoring" but in practice the detector still dispatches with potentially-EOA-laden allowlist.
5. **Resume path arms WS listener only when at least one position is registered** — `startChainAntiRugListener` early-returns if `chainState.get(chainName)` is undefined. Restart with zero open positions on a chain → listener never starts. First new position post-restart re-attempts but only after the resume window has closed.
6. **`AntiRugStateUpdate.success` field on broadcast is not in the frontend type contract**, and the `lastSignals: null` literal on backend conflicts with frontend optional `RugSignals | undefined`. The frontend won't crash but loses data and may render stale signals.
7. **Circular import: `exitEngine → anti-rug/detector → anti-rug/exitTrigger → exitEngine`** — ts-node can resolve circular ESM/CJS deps in some module ordering but creates a real initialization fragility. Has bitten the codebase historically in the receipt-decoder path.

Notable lower-severity concerns (Warnings) include race conditions in dispatchEvent under unregister, duplicate `mergeAllowlist` implementations with different semantics (dead code path tested in isolation), test asymmetry that lets a known short-circuit case present as a "partial-signal" test, and several backend WS broadcasts that drift from declared frontend types in subtle ways.

The code shows discipline (e.g., discriminated-union vacuous-pass guards, fail-loud env validation, structured logging). The defects below are concentrated at boundary crossings: backend/frontend WS payloads, async-await ordering at integration points, and the gas-strategy plumbing.

## Critical Issues

### CR-01: cb_tripped payload field mismatch breaks dashboard CB-reset modal

**File:** `src/anti-rug/circuitBreaker.ts:140-145` and `dashboard/src/types/api.ts:82-87`
**Issue:** Backend broadcasts the circuit-breaker tripped event with keys `triggers: <count>` (number) and `triggerEvents: <TriggerEvent[]>`, but the frontend `CbTrippedPayload` type declares `triggers: TriggerEvent[]` (the array) and `triggerCount: number` (the count). Downstream:
- `dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx:42` reads `single.triggerCount` — gets `undefined`. The banner headline reads "ANTI-RUG HALTED ON ETH — undefined triggers in last hour".
- `dashboard/src/pages/Overview.tsx:117-119` builds `resetModalTriggers = circuitBreakerTrips[resetModalTarget]?.triggers ?? []`. Because `.triggers` is now a NUMBER (not array, not nullish), `?? []` does not fire — `resetModalTriggers` is a number passed as the `triggers` prop to the modal.
- `dashboard/src/components/anti-rug/CircuitBreakerResetModal.tsx:50` evaluates `acknowledged.size === triggers.length && triggers.length > 0`. `triggers.length` on a number is `undefined`. `acknowledged.size === undefined` is always false → operator can never enable the Reset button. The modal renders zero trigger sections because `triggers.map(...)` on a number throws or yields nothing.

This breaks the highest-stakes operator workflow in Phase 19 — manual CB reset via dashboard. The operator handoff doc (`docs/operations/anti-rug-rollout.md` §5) instructs the operator to use the modal as the primary reset path; the CLI is documented only as backup.

**Fix:** Align producer and consumer. Either:
```typescript
// src/anti-rug/circuitBreaker.ts:140-145 — match the frontend type:
broadcast('cb_tripped', {
    chain,
    triggers: events.slice(),         // array, not count
    windowHours: ctx.chain.antiRug.circuitBreakerWindowHours,
    triggerCount: recent.length,      // explicit count under its own key
});
```
Or update the frontend type/consumers to read `triggerEvents`/`triggers (count)`. The first option matches the operator handoff doc copy in §5 ("N trigger sections (N = `triggers.length`)"). Add an integration test that serializes the backend payload and parses it through the frontend type for at least one trip event.

### CR-02: Anti-rug gas multiplier fails to elevate fees on ETH (Flashbots/EIP-1559 mismatch)

**File:** `src/utils/mevStrategies/flashbots.ts:56-65`
**Issue:** ETH chain template declares `gas: { type: 'eip1559', multiplier: 1.2, maxGasLimit: 300_000n }` (`src/chainRegistry.ts:186`). The Phase 19 Gap-1 fix (commit `7d35c46`) threads the anti-rug gas multiplier through `sendTxWithRetry` → strategy. But the Flashbots strategy populates only the legacy `gasPrice` field:

```typescript
const rawGasPrice = (await provider.getFeeData()).gasPrice;
const gasPrice = applyGasMultiplier(rawGasPrice, gasMultiplier);
const populatedTx: TransactionRequest = {
    ...txRequest,
    gasLimit: txRequest.gasLimit || 300_000n,
    gasPrice,            // <-- legacy gas price; ETH is EIP-1559
    nonce: baseNonce + attempt,
    chainId: ...,
};
```

This silently sends an EIP-1559 chain's tx with `gasPrice` only. Depending on ethers v6 / Flashbots provider behavior, the tx may either:
- be rejected by the relay because EIP-1559 `maxFeePerGas`/`maxPriorityFeePerGas` are missing, OR
- be sent as a legacy transaction that does NOT have the 2.0× elevation the operator expected.

Either way, the documented "2.0× gas multiplier outbids the rug-pull tx" behavior in `docs/operations/anti-rug-rollout.md` §1 + `docs/operations/anti-rug-tuning.md` §"Gas tuning" does NOT happen on ETH, which is the primary target chain.

Compare passthrough (`src/utils/mevStrategies/passthrough.ts:48-53`) which correctly handles both EIP-1559 and legacy:
```typescript
if (feeData.maxFeePerGas) {
  populatedTx.maxFeePerGas = applyGasMultiplier(feeData.maxFeePerGas, gasMultiplier) ?? undefined;
  populatedTx.maxPriorityFeePerGas = applyGasMultiplier(feeData.maxPriorityFeePerGas, gasMultiplier) ?? undefined;
} else {
  populatedTx.gasPrice = applyGasMultiplier(feeData.gasPrice, gasMultiplier) ?? undefined;
}
```

**Fix:** Apply the same EIP-1559-aware branching to `flashbots.ts`:
```typescript
const feeData = await provider.getFeeData();
const populatedTx: TransactionRequest = {
    ...txRequest,
    gasLimit: txRequest.gasLimit || 300_000n,
    nonce: baseNonce + attempt,
    chainId: (await provider.getNetwork()).chainId,
};
if (feeData.maxFeePerGas) {
    populatedTx.maxFeePerGas = applyGasMultiplier(feeData.maxFeePerGas, gasMultiplier) ?? undefined;
    populatedTx.maxPriorityFeePerGas = applyGasMultiplier(feeData.maxPriorityFeePerGas, gasMultiplier) ?? undefined;
    populatedTx.type = 2;
} else {
    populatedTx.gasPrice = applyGasMultiplier(feeData.gasPrice, gasMultiplier) ?? undefined;
}
```
Add a fork test that asserts `populatedTx.maxFeePerGas === rawMaxFeePerGas * 2n` for `reason='anti-rug'` on ETH.

### CR-03: registerAntiRugPosition not awaited at buy-success → silent unhandled rejections

**File:** `src/bot.ts:423-436` (V2 path) and `src/bot.ts:677-691` (V3 path)
**Issue:**
```typescript
try {
    await snapshotLpBaseline(ctx, dex, tradeRow.id, pairAddress, null);
    registerAntiRugPosition(ctx, dex, targetToken, pairAddress, tradeRow.id, null);
    //  ^-- async, but NOT awaited
} catch (err) {
    ctx.log.error({ err, op: 'antirug.baseline-snapshot-failed', ... }, ...);
}
```

`registerAntiRugPosition` is declared `async` (`detector.ts:364`) and internally awaits `startChainAntiRugListener` which in turn awaits `backfillSinceLastSeen` (which performs RPC calls and DB writes). Any rejection in this chain — RPC timeout during initial backfill, DB write failure, etc. — becomes an **unhandled Node promise rejection**. It bypasses the surrounding try/catch entirely because the try block has already returned the unsettled promise to the event loop.

The documented operator-visible failure mode — "position UNMONITORED, falls back to standard exit monitor, surfaces via dashboard badge" — does not fire. The error is logged via `process.on('unhandledRejection')` (if hooked) or silently lost.

Additionally, the test at `bot.ts:1148` correctly uses `await registerAntiRugPosition(...)` in the resume path, demonstrating the team knew the function was async but missed the buy-success call sites.

**Fix:**
```typescript
try {
    await snapshotLpBaseline(ctx, dex, tradeRow.id, pairAddress, null);
    await registerAntiRugPosition(ctx, dex, targetToken, pairAddress, tradeRow.id, null);
} catch (err) { ... }
```
Apply the same fix at line 679 (V3 path). Add a vitest test that mocks `registerAntiRugPosition` to reject and asserts the surrounding `op: 'antirug.baseline-snapshot-failed'` log fires.

### CR-04: Allowlist verification failure leaves chain monitoring with unverified addresses

**File:** `src/bot.ts:1085-1106` and `src/anti-rug/allowlist.ts:150-198`
**Issue:** `verifyAllowlistAtStartup` runs `getCode()` against every non-DEAD allowlist entry and calls `process.exit(1)` on any EOA (per D-LIST-VERIFY). The intent: refuse to run if the allowlist could allow funds to escape to an EOA-controlled address that doesn't have locker semantics.

The resume path catches non-FATAL errors (RPC unavailable during boot):
```typescript
for (const ctx of contexts) {
    try {
        await verifyAllowlistAtStartup(ctx, ...);
    } catch (err) {
        ctx.log.error({...}, 'Allowlist verify RPC failed; chain runs without anti-rug monitoring');
        continue;
    }
}
// Step 3 — re-register positions  ← runs even for chains that failed verify
// Step 4 — startChainAntiRugListener(ctx)  ← arms WS listener for ALL chains
```

But Step 3 and Step 4 are NOT skipped for chains that failed verification. They still:
- register every open position via `registerAntiRugPosition` (which initializes `chainState`)
- arm the WS subscription with `startChainAntiRugListener`
- dispatch events to the multi-signal evaluator, which consults `ctx.chain.antiRug.allowlistV2`/`allowlistV3` — addresses that were NEVER verified by `getCode`.

The log message claims "chain runs without anti-rug monitoring," but in fact, monitoring IS active with an unverified allowlist. If the operator added an EOA via `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA` env (typo or hot-patch error) and the boot-time RPC was flaky, the boot completes, the allowlist becomes a leak vector (every LP transfer to that EOA gets `verdict='allowlisted'` → no exit), and the operator has no signal until the next restart.

**Fix:** Skip Steps 3 + 4 for chains that failed verify. Track a `verifiedChains: Set<string>` outside the loop:
```typescript
const verifiedChains = new Set<string>();
for (const ctx of contexts) {
    try {
        await verifyAllowlistAtStartup(ctx, ...);
        verifiedChains.add(ctx.chain.name);
    } catch (err) { ... continue; }
}
// Step 3
for (const trade of openTrades) {
    if (!verifiedChains.has(trade.chain)) continue;  // skip unverified
    ...
}
// Step 4
for (const ctx of contexts) {
    if (!verifiedChains.has(ctx.chain.name)) continue;
    await startChainAntiRugListener(ctx);
}
```
Alternatively, treat boot-time `verifyAllowlistAtStartup` RPC errors as FATAL (process.exit(1)) consistent with D-LIST-VERIFY's intent — a chain that cannot verify its allowlist should not run anti-rug monitoring.

### CR-05: Resume path silently no-ops when chain has zero open positions

**File:** `src/anti-rug/detector.ts:543-551` and `src/bot.ts:1160-1162`
**Issue:** `startChainAntiRugListener` checks `chainState.get(chainName)` first and returns silently if undefined:
```typescript
const state = chainState.get(chainName);
if (!state) {
    // No registrations on this chain yet — nothing to subscribe to.
    return;
}
```

`chainState` is only initialized inside `registerAntiRugPosition` (`detector.ts:411-422`). On bot restart with zero open positions on a chain (the documented "zero positions at ship time" scenario from `19-CONTEXT.md`), the resume path executes:
1. Step 1: `verifyAllowlistAtStartup` — runs, no chainState change
2. Step 2: open trades query returns empty (no positions on this chain)
3. Step 3: no per-trade `registerAntiRugPosition` calls because the loop is empty
4. Step 4: `startChainAntiRugListener(ctx)` — early-returns because `chainState` has nothing for this chain

Result: the WS subscription is NEVER established for the chain. The heartbeat, reconnect, backfill, gap-detected — all of it — is dormant.

When the next snipe lands on this chain post-restart, `registerAntiRugPosition` initializes `chainState` AND calls `startChainAntiRugListener` again, so on-paper the listener will arm at that point. But: any `getLogs` backfill from the chain restart window onwards is missed (Bot was offline → first position fires → backfill scans from `current` only, not from `lastSeenBlock` because that chain's `chain_state` row was never updated since restart, and the `if (!chainStateRow)` branch seeds with the current block). Net: a meaningful backfill window between bot-restart and first-buy is silently lost.

**Fix:** Arm the WS listener regardless of position count. Refactor `startChainAntiRugListener` to:
```typescript
export async function startChainAntiRugListener(ctx: ChainContext): Promise<void> {
    const chainName = ctx.chain.name;
    // Ensure chainState exists for this chain (initialise even with zero positions)
    if (!chainState.has(chainName)) {
        chainState.set(chainName, { wsProvider: null, ... });
    }
    const state = chainState.get(chainName)!;
    if (!ctx.wsProvider) { ... HTTP polling ... return; }
    const addresses = getRegisteredPositions(chainName).map(...);
    // OK to subscribe with empty address filter — backfill still runs, heartbeat still arms
    ...
}
```
The address-filter behavior (empty addresses → "filter matches nothing") is RPC-provider-specific; verify with a fork test, but the upshot is the lifecycle scaffolding starts regardless.

### CR-06: `antirug_state_update` broadcast carries `success` field absent from frontend type; `lastSignals: null` literal conflicts with optional type

**File:** `src/anti-rug/exitTrigger.ts:185-191`, `src/anti-rug/exitTrigger.ts:245-252`, and `dashboard/src/types/api.ts:101-107`
**Issue:**
1. The exit-fired broadcast includes a `success: boolean` field (`exitTrigger.ts:251`), but `AntiRugStateUpdate` does not declare it. Frontend reads only the declared fields, so the `success` value is lost (no `success` → no operator signal that a live exit returned true/false).
2. The would-have-sold broadcast sends `lastSignals: 'signals' in evaluation ? evaluation.signals : null`. The frontend type is `lastSignals?: RugSignals` (optional, with undefined as absence). Passing `null` matches the field name but TypeScript will narrow `signals != null` differently than `signals !== undefined` — components that do `if (signals)` work, but `if (typeof signals === 'object')` will see `null` as a truthy object, causing the `AntiRugExitDetailModal` to render an empty signals panel instead of "no signals available."

**Fix:** Update the frontend type to include `success?: boolean` and to allow `lastSignals: RugSignals | null | undefined`. Or send `lastSignals: undefined` from backend (`'signals' in evaluation ? evaluation.signals : undefined`) and explicitly include `success` in the type contract. Add a runtime schema validator at the WS dispatch site (`useWebSocket.ts:116-137`) that warns on payload-shape drift.

### CR-07: Circular import `exitEngine ↔ anti-rug/detector ↔ anti-rug/exitTrigger ↔ exitEngine`

**File:** `src/exitEngine.ts:20`, `src/anti-rug/detector.ts:91`, `src/anti-rug/exitTrigger.ts:56`
**Issue:** Three-way circular import:
- `src/exitEngine.ts:20` imports `unregisterAntiRugPosition` from `./anti-rug/detector`
- `src/anti-rug/detector.ts:91` imports `triggerAntiRugExit` from `./exitTrigger`
- `src/anti-rug/exitTrigger.ts:56` imports `executeFullSell` from `../exitEngine`

This creates a load-order trap. At module-load time, ts-node + CommonJS will satisfy circular imports by returning partial module exports — depending on the import order, one of the three modules sees its dependencies as `undefined` for the duration of its own module-initialization code path. The downstream symptom is "expected `triggerAntiRugExit` to be a function, got undefined" exceptions in production that don't reproduce in unit tests (which mock each side of the cycle).

There's no immediate runtime symptom IF every consumer accesses the imported symbol only after all modules have finished loading (e.g., inside functions called at runtime). The current code likely works today by accident of module-load order, but a future refactor that touches top-level statements in any of the three files will break this silently.

**Fix:** Break the cycle by extracting the cross-boundary functions to a shared module. Options:
1. Move `triggerAntiRugExit` out of `anti-rug/exitTrigger.ts` and into `anti-rug/detector.ts` directly — collapses the cycle to a single inter-module edge.
2. Move `executeFullSell` to a dedicated `src/sellPipeline.ts` that neither anti-rug nor exitEngine import — both modules import from `sellPipeline.ts`.
3. Introduce a runtime registration pattern: `exitEngine` registers a callback into a small `exitDispatcher.ts` module that `anti-rug/exitTrigger` consumes; no direct import.

Add an eslint rule (`import/no-cycle`) to prevent regression. This is a latent defect; the explicit comment in `exitEngine.ts:20` about `unsubscribeAntiRug` aliasing suggests the team noticed the import but did not recognize the cycle.

## Warnings

### WR-01: Two divergent mergeAllowlist implementations — production uses dedupe, tested code uses concat-with-duplicates

**File:** `src/chainRegistry.ts:566-579` and `src/anti-rug/allowlist.ts:70-82`
**Issue:** Two `mergeAllowlist` functions exist in the codebase with **different semantics**:
- `chainRegistry.ts:566` (private; the one actually used in `buildChainRegistry`): dedupes by lowercased address; env-overlay overrides hardcoded.
- `anti-rug/allowlist.ts:70` (exported): concats keeping duplicates so D-LIST-AUDIT shows BOTH rows.

`anti-rug/allowlist.ts:mergeAllowlist` is exported and tested (Test 7 in `allowlist.test.ts`) — the test asserts duplicates are KEPT. But production `buildChainRegistry()` calls the LOCAL `mergeAllowlist` (private to chainRegistry.ts), which DEDUPES. Net: the test asserts dead code. If an operator overlays a hardcoded address, production silently overwrites the hardcoded entry (env wins) while the test gives the false impression the audit trail preserves both.

**Fix:** Pick one semantic. The chain-registry behavior (dedupe with env-overrides-hardcoded) is the safer production default — log when an env entry overrides a hardcoded entry so the audit trail is preserved structurally. Then either:
- Delete the unused `anti-rug/allowlist.ts:mergeAllowlist` export + Test 7, OR
- Make `chainRegistry.ts` call the exported function and update Test 7 to assert dedupe semantics.

The current state is "test passes, but tests dead code; the production code path is untested and behaves differently."

### WR-02: dispatchEvent races with unregisterAntiRugPosition mid-loop

**File:** `src/anti-rug/detector.ts:1276-1309`, `src/anti-rug/detector.ts:455-483`
**Issue:** `dispatchEvent` iterates over the `positions` bucket array with an `await` between iterations. If `unregisterAntiRugPosition` fires during the await (e.g., a partial sell completes and the position is unregistered), `bucket.splice(idx, 1)` modifies the array mid-iteration.

JavaScript is single-threaded, but `await` yields back to the event loop. The `executeFullSell` call from another exit path (trailing stop firing on a different timer interval) can complete while the evaluator is awaiting RPC, then call `unregisterAntiRugPosition` synchronously, which mutates the array.

Likelihood is low but not zero (it requires the trailing-stop poll + the anti-rug WS event to fire near-simultaneously on the same position), and the impact is "skip evaluation of a still-registered sibling position on the same pair." For most cases this is benign (the position is being closed anyway), but it could miss an evaluation that would trip the circuit breaker.

**Fix:** Snapshot the bucket at the start of dispatch:
```typescript
const positions = perChain.get(lcAddress);
if (!positions || positions.length === 0) return;
const positionsSnapshot = positions.slice();   // freeze copy
for (const position of positionsSnapshot) { ... }
```
This is the same defensive pattern that the V3 grace-window timer uses (`blockHandlers.slice()` in the tests).

### WR-03: V3 sell-sim "probe amount" uses baseline active liquidity, not the position's amount

**File:** `src/anti-rug/detector.ts:1618-1638`
**Issue:**
```typescript
// Probe amount: use the baseline active liquidity as a proxy (the real
// production value is the position's amount; for v6.17 we use the
// baseline as a normalized probe amount — see SUMMARY).
const probeAmount = baselineLiquidity;
```

`baselineLiquidity` is the V3 pool's total active liquidity at buy time — not the bot's token holdings. Using this as the input amount for `quoteExactInputSingle` of `tokenIn: position.tokenAddress` is dimensionally wrong (it asks "if I swap LIQUIDITY worth of token, how much WETH back?" — but liquidity is not denominated in the same unit as the token amount).

Concretely: a V3 pool with `liquidity = 1e18` has `~1` token of active liquidity. Selling "1e18 tokens" of the position's tokenAddress will return ~all the WETH in the pool, severely impacting the quoted output. The `quotedRatioBps` math then says "sell-sim returns < 50% of baselineLiquidity" → signal-3 trips on every benign V3 pool that has ANY position size mismatch. This is a likely-false-positive source.

The comment acknowledges this is wrong ("the real production value is the position's amount; for v6.17 we use the baseline as a normalized probe"). For dry-run mode this is logged-but-tolerated noise; for live mode (post-7-day-window flip), it could cause live exits on stable positions.

**Fix:** Pass through the actual token balance:
```typescript
const tokenContract = new Contract(position.tokenAddress, ERC20_ABI, ctx.httpProvider);
const probeAmount = await tokenContract.balanceOf(ctx.wallet.address);
```
Or compute it once at register time and store on `RegisteredPosition`. Add a fork test that asserts the V3 sell-sim slippage is < 5% when the pool is balanced and the probe amount equals the position size.

### WR-04: V2 evaluator reads only reserve0 for signal-3 — ignores reserve1, fails for WETH-as-token1 pairs

**File:** `src/anti-rug/detector.ts:1494-1523`
**Issue:** Signal-3 evaluation uses only `reserves[0]` and `baseline.v2Token0Reserve`:
```typescript
const baselineReserve0 = BigInt(position.baseline.v2Token0Reserve);
const currentReserve0 = BigInt(reserves[0].toString());
const reserve0PctBps = ...
```

In Uniswap V2, `token0` is the lexicographically-smaller address. For a WETH-paired token where the new token's address is smaller than WETH, `token0` is the NEW TOKEN and `token1` is WETH. For the opposite case, `token0` is WETH and `token1` is the new token. The signal-3 check assumes a fixed orientation but the V2 pair contract doesn't guarantee one.

For pairs where WETH is `token1`, the signal reads the NEW TOKEN's reserve, not WETH's. A rug-puller removing WETH liquidity (the canonical drain) would show as `token1` removal but the evaluator only watches `token0`. Signal-3 doesn't trip → multi-signal AND chain doesn't fire → exit doesn't trigger.

**Fix:** Resolve the WETH side at baseline-snapshot time and store which index it occupies, or evaluate both reserves and trip when EITHER drops below 50% of baseline:
```typescript
const reserve0Pct = baselineReserve0 === 0n ? 1.0 : Number((currentReserve0 * 10000n) / baselineReserve0) / 10000;
const reserve1Pct = baselineReserve1 === 0n ? 1.0 : Number((currentReserve1 * 10000n) / baselineReserve1) / 10000;
const signal3Tripped = reserve0Pct < 0.5 || reserve1Pct < 0.5;
```
The `lp_baseline` schema already has `v2_token1_reserve` (db.ts:136); the evaluator just doesn't read it.

### WR-05: Dashboard WS reconnect can leak connections when previous socket is CONNECTING

**File:** `dashboard/src/hooks/useWebSocket.ts:75-80`
**Issue:**
```typescript
const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(...);
    wsRef.current = ws;
    ...
});
```

Only `OPEN` short-circuits. If the previous socket is `CONNECTING` (readyState 0) and `connect()` is called again (e.g., reconnect timer fires while the previous attempt is still negotiating), the new socket replaces `wsRef.current` without closing the previous one. The previous CONNECTING socket is left dangling — it will eventually finish negotiating, attach `onopen`/`onclose` handlers that update state (`setConnected(true)` + auto-reconnect timer), and the resulting log of orphaned sockets accumulates over time.

In a long-running dashboard tab, this can also race two `onmessage` handlers attached to different sockets — duplicating positions_update and antirug_event into state.

**Fix:**
```typescript
const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        // Already connecting or open — bail
        return;
    }
    // Or, more aggressive: close any non-closed previous
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket(...);
    ...
});
```

### WR-06: V3 Burn grace-window block-watcher leak

**File:** `src/anti-rug/detector.ts:2006-2026`
**Issue:** Inside `handleV3BurnArrival`, a block-watcher is scheduled:
```typescript
const blockHandler = async (currentBlock: number) => {
    if (currentBlock < timeoutBlockNumber) return;
    const pending = pendingV3Burn.get(poolKey);
    if (!pending || pending.burnBlockNumber !== burnBlockNumber) {
        ctx.httpProvider.off('block', blockHandler);
        return;
    }
    ctx.httpProvider.off('block', blockHandler);
    pendingV3Burn.delete(poolKey);
    await evaluateV3MultiSignal(ctx, position, burnEvent, 'grace-timeout');
};
ctx.httpProvider.on('block', blockHandler);
```

When `handleV3CollectArrival` (`detector.ts:2032-2054`) consumes the pending entry (Collect arrived within grace), it does NOT call `ctx.httpProvider.off('block', blockHandler)` for the scheduled timer. The block handler stays attached. It will fire on every subsequent block; `pendingV3Burn.get(poolKey)` returns undefined (consumed), so the handler does `ctx.httpProvider.off('block', blockHandler)` — but that off-call needs the SAME handler reference. The handler reference is the closed-over `blockHandler` inside the previous Burn's scope — when `handleV3CollectArrival` consumed the entry, the new evaluator's chain doesn't have access to it.

So the block handler runs every block forever, doing one map lookup + one off() call (which removes itself successfully on first invocation). The first orphaned tick removes itself — but for the grace-timeout path that DOES delete the pending entry, the same handler removes itself correctly. Net: leak only when LAST-WINS path (Test 10d) replaces a pending Burn — the prior burn's blockHandler stays attached AND will tick forever (the new burn's `burnBlockNumber !== currentPendingEntry.burnBlockNumber` so it never trips the cleanup logic).

**Fix:** Track block handlers in `pendingV3Burn` so they can be cleaned up explicitly:
```typescript
interface PendingV3Burn {
    poolAddress: string;
    position: RegisteredPosition;
    burnEvent: Log;
    burnBlockNumber: number;
    timeoutBlockNumber: number;
    blockHandler: (currentBlock: number) => void;  // new
}
// In handleV3BurnArrival, before set(poolKey, ...):
const existing = pendingV3Burn.get(poolKey);
if (existing) ctx.httpProvider.off('block', existing.blockHandler);
// In handleV3CollectArrival, after pendingV3Burn.delete(poolKey):
if (pending) ctx.httpProvider.off('block', pending.blockHandler);
```

### WR-07: Test 1 in detectorEvaluator.test.ts asserts the wrong verdict for the documented scenario

**File:** `test/unit/anti-rug/detectorEvaluator.test.ts:470-607`
**Issue:** The test plan documents Test 1 as: "Only signal 1 trips (LP removed >50%, destination in allowlist, V2 reserves above threshold) → verdict='safe', reason='partial-signal'." But the test scenario as written sets the destination to be in the allowlist, which short-circuits the AND chain to `verdict='allowlisted'` per the discriminated-union semantics. The test author explicitly notes the inconsistency in 100+ lines of inline comment (lines 533-601) and resolves to assert `'allowlisted'`. The assertion is correct but the test description is misleading.

The actual "only signal-1 trips, verdict='safe', partial-signal" case is NOT covered by any test — Tests 1-4 all degenerate to allowlist-short-circuit or partial-signal-with-different-tripped-set. The reviewer could not find a test that hits the "signals 1 trips, 2 does NOT trip (allowlist hit), 3 does NOT trip" → `partial-signal` exact path. It's structurally unreachable per the type contract (the only way signal-2 doesn't trip is allowlist hit, which short-circuits).

The deeper issue: the multi-signal AND chain documentation in `19-CONTEXT.md` describes "all three signals tripped → unsafe; otherwise → safe/partial-signal". The actual implementation short-circuits to `allowlisted` BEFORE the AND check. The documented test plan in PLAN.md was written against the doc, not the implementation; the test file's inline comment shows the author identified the mismatch but pushed forward with an inconsistent assertion.

**Fix:** Either rewrite the documentation to match implementation (the short-circuit is correct, the doc should describe it) or rewrite the implementation to match the doc (don't short-circuit; emit `partial-signal` with `allowlistHit: 'safe'`). The first option is cheaper and the current implementation is safer (no risk of misclassifying an allowlisted destination as unsafe). Update Test 1 description and the PLAN.md / SUMMARY.md test-plan rows.

### WR-08: chainRegistry mergeAllowlist places ALLOWLIST_EXTRA in BOTH V2 and V3 — no per-pool-type targeting

**File:** `src/chainRegistry.ts:916-923` and `docs/operations/anti-rug-rollout.md` §"ALLOWLIST_EXTRA"
**Issue:** `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA` is parsed as a comma-separated list and pushed into BOTH `allowlistV2` and `allowlistV3` (lines 916-923):
```typescript
allowlistV2: mergeAllowlist(HARDCODED_V2_ALLOWLIST[chainName] ?? [], antiRugAllowlistExtra),
allowlistV3: mergeAllowlist(HARDCODED_V3_ALLOWLIST[chainName] ?? [], antiRugAllowlistExtra),
```

The operator handoff doc and tuning doc both treat ALLOWLIST_EXTRA as a single "hot-patch path" with no V2/V3 distinction. But the rollout doc §7 acknowledges that V2 vs V3 lockers are different categories (TeamFinance V2 vs TeamFinance V3 NFT vault). If an operator adds the wrong locker type to an env-overlay (e.g., a V2 ERC20-LP-only PinkLock contract that is NOT an NFT-vault), it will be allowlisted on the V3 detector path — bypassing the per-pool-type lockerName check.

The runtime impact: a V3 pool whose Collect destination matches a V2-locker address would be `allowlisted` → no exit. This is a soft footgun more than a hard bug, but it contradicts the docs' implicit "V2 and V3 allowlists are independent" model.

**Fix:** Add V2/V3-specific env vars: `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA_V2` and `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA_V3`. Keep the unified `ALLOWLIST_EXTRA` as a deprecated alias that warns at startup. Update both operator docs to document the split. This is also easier to reason about during operator review of trigger evidence.

### WR-09: gap-detected broadcast missing `pair` field; declared required on frontend type

**File:** `src/anti-rug/detector.ts:1003-1010` and `dashboard/src/types/api.ts:53-66`
**Issue:** The backend gap-detected broadcast omits the `pair` field:
```typescript
broadcast('antirug_event', {
    chain: chainName,
    kind: 'gap-detected',
    gapBlocks,
    fromBlock: lastSeen,
    toBlock: currentBlock,
    timestamp: Date.now(),
});
```
But the frontend `AntiRugEvent` interface declares `pair: string` as required (`api.ts:57`). At runtime, the frontend receives `pair === undefined` and stores it in the `antiRugEvents` map. The `GapDetectedBanner` component doesn't reference `pair` so it doesn't crash, but any future consumer that destructures `pair` from the event will get `undefined.toLowerCase()` exceptions.

The same broadcast omits `signals`, `outcome`, `token`, `lockerName` — those are optional on the frontend type, so they're tolerable, but `pair` is required.

**Fix:** Either:
- Make `pair` optional in the frontend type: `pair?: string` (gap events legitimately don't have a pair),
- Or supply a `pair: 'multiple'` / `pair: '?'` sentinel from the backend gap-detected branch.
Option 1 is more honest — gap-detected is a chain-level event, not pair-level.

## Info

### IN-01: Documented "31 envs" claim doesn't match REQUIRED_ENV_VARS count

**File:** `docs/operations/anti-rug-rollout.md:24-25` and `src/config.ts:67-118`
**Issue:** The doc claims "9 env vars per chain × 4 chains = 36 env vars total". The actual REQUIRED_ENV_VARS in `config.ts` has 9 entries × 4 chains = 36 entries — matches. But the test `antiRugConfig.test.ts:357-363` only asserts `length >= 32`. A regression that drops two of the env vars to a third of the chains would pass the test but break the doc claim.

**Fix:** Tighten the test to `length === 36` or compute the count from the 4-chain × 9-var matrix. Add a doc-cross-reference test that parses `docs/operations/anti-rug-rollout.md` env table and validates it matches `config.ts` exactly.

### IN-02: Test mocks use the unused mergeAllowlist (allowlist.ts), not the production one

**File:** `test/unit/anti-rug/allowlist.test.ts:272-298`
**Issue:** Test 7 asserts `allowlist.ts:mergeAllowlist`'s KEEP-DUPLICATES behavior, but production uses `chainRegistry.ts:mergeAllowlist`'s DEDUPE behavior. See WR-01. The test passes but tests dead code.

**Fix:** See WR-01.

### IN-03: Magic V3_BURN_GRACE_BLOCKS hardcoded; comment promises promotion to env

**File:** `src/anti-rug/detector.ts:213`
**Issue:**
```typescript
const V3_BURN_GRACE_BLOCKS = 5;
```
Comment says "v6.17 hardcoded module-level constant; v6.18 may promote to `ctx.chain.antiRug.v3BurnGraceBlocks` if operational data shows a need to tune per chain." Five blocks is ~60 sec on ETH but only ~12.5 sec on Arbitrum and ~15 sec on BSC. Per-chain tuning is desirable for the lower-block-time chains where 5 blocks is sub-second and a legitimate Collect may not have arrived yet.

**Fix:** Promote to env now (`<CHAIN>_ANTIRUG_V3_BURN_GRACE_BLOCKS`) instead of deferring to v6.18 — the env-overlay shape is already established for other anti-rug tuning vars. Default 5 for ETH, 10 for Arbitrum/Base, 8 for BSC.

### IN-04: Frontend Overview.tsx logs `_removed` via void to silence unused-vars

**File:** `dashboard/src/hooks/useWebSocket.ts:181-185`
**Issue:**
```typescript
const { [reset.chain]: _removed, ...rest } = prev;
void _removed;
return rest;
```
The `void _removed;` pattern is a common eslint workaround but is awkward. Cleaner: rely on the TypeScript-aware eslint config to allow underscore-prefixed unused vars (most projects already do this).

**Fix:**
```typescript
const { [reset.chain]: _, ...rest } = prev;
return rest;
```
or destructure-with-rest and don't capture the removed value at all:
```typescript
const newTrips = { ...prev };
delete newTrips[reset.chain];
return newTrips;
```

### IN-05: Operator handoff doc references "5 seconds force-exit safety net" but bot.ts implements that

**File:** `docs/operations/anti-rug-rollout.md:88-89` and `src/bot.ts:1181-1184`
**Issue:** The doc's recovery instructions say "If it doesn't exit within 5 seconds, the force-exit safety net kicks in." This matches the 5s `setTimeout` at `bot.ts:1181`. But the comment ".unref()" at the end of the timer means the safety net does NOT keep the event loop alive — if all other handles have closed, the process exits via natural Node shutdown BEFORE the safety net fires. The "5s force-exit" is therefore only a guarantee against hanging async operations, not a guarantee of 5s ceiling.

**Fix:** Doc nit. Either remove `.unref()` to make the 5s a hard guarantee, or clarify the doc that "if hanging async operation is detected after Ctrl+C, force-exit fires at 5s." Minor; existing behavior is correct for graceful shutdown.

### IN-06: Frontend chain selection logic in Overview.tsx is fragile under multi-chain

**File:** `dashboard/src/pages/Overview.tsx:43-48`
**Issue:**
```typescript
const activeChain = useMemo(() => {
    const chainSet = new Set<string>();
    positions.forEach((p) => chainSet.add(p.chain));
    Object.keys(antiRugEvents).forEach((c) => chainSet.add(c));
    return Array.from(chainSet)[0] ?? 'eth';
}, [positions, antiRugEvents]);
```
`Array.from(chainSet)[0]` returns the first chain in the Set's insertion order — non-deterministic across re-renders if positions arrive in different orders. The AntiRugMonitorTile and FrontrunDistributionPanel only show one chain at a time. For a multi-chain bot, this is going to be confusing — the operator can't tell which chain is being displayed without scrolling to the chain badge.

**Fix:** Sort the chain set (alphabetical or by priority — ETH > BSC > BASE > ARB), and consider showing a chain selector UI for the operator to switch. Existing comment says "For v6.17 ETH is the only enabled chain; fall back gracefully," so this is forward-looking polish.

---

_Reviewed: 2026-05-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
