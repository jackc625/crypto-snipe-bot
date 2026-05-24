---
id: 19-04b
phase: 19-anti-rug-runtime-monitoring
plan: 04b
type: execute
wave: 3
depends_on: [19-01, 19-02, 19-03, 19-04a]
files_modified:
  - src/anti-rug/detector.ts
autonomous: true
requirements: [ANTIRUG-05, ANTIRUG-07, ANTIRUG-14, ANTIRUG-15]
requirements_addressed: [ANTIRUG-05, ANTIRUG-07, ANTIRUG-14, ANTIRUG-15]
tags: [anti-rug, detector, multi-signal-evaluator, v2-v3, allowlist-suppression, confirm-blocks, burn-grace-window]

must_haves:
  truths:
    - "Multi-signal AND chain trigger requires ALL THREE of: (1) LP-removed-pct > ctx.chain.antiRug.lpRemovalPct (default 50%), (2) destination NOT in allowlist (per Plan 19-03 isAddressAllowlisted), (3) V2 reserves below sell-threshold OR V3 QuoterV2.quoteExactInputSingle < 50% of baseline expected — per ANTIRUG-05. Single-signal triggers explicitly do NOT fire exits (they log evidence)."
    - "V3 detector subscribes to BOTH Pool.Burn AND Pool.Collect per D-V3-EVENTS via Plan 19-04a's topic-filter union. V3 allowlist check reads `owner` on Burn and `recipient`-or-`owner` on Collect per D-V3-ALLOWLIST + RESEARCH §2.2 (recommendation: owner-only on both, with planner discretion to widen to recipient-AND-owner if dry-run shows false negatives)."
    - "**V3 Burn-without-Collect grace window per Blocker 2 resolution (a) from plan-checker iteration 1:** When V3.Burn fires, the detector sets `pendingV3Burn[poolAddress] = { blockNumber, position, burnEvent }`. The multi-signal AND chain is NOT evaluated immediately on Burn-alone. The evaluator fires when EITHER (i) a V3.Collect event arrives for the same pool within `V3_BURN_GRACE_BLOCKS` (default 5 blocks) AND triggers the standard multi-signal evaluation, OR (ii) the grace window expires (block-number watch via `ctx.httpProvider.on('block', ...)`) and Burn-only is evaluated with signal-3 sell-sim as the deciding signal. **Deterministic verdict in both branches** — no `'verdict depending on liquidity drop magnitude'` ambiguity. Honors D-V3-EVENTS phrasing 'Either event arrives → re-evaluate the full multi-signal AND chain' by treating Burn as a re-evaluation trigger that HOLDS OPEN until the AND chain has enough signal."
    - "V3 signal-3 sell-sim via `QuoterV2.quoteExactInputSingle.staticCall` against the current position's token/WETH/feeTier per D-V3-SIGNAL3 — quoted output < 50% of baseline expected fires signal 3. QuoterV2 revert is treated as signal-3 trip (sell impossible == reserves below threshold) per fail-closed discipline."
    - "Confirm-after-N-blocks delay per ANTIRUG-07 — after all 3 signals fire, schedule re-evaluation after `ctx.chain.antiRug.confirmBlocks` blocks. If still all-three at re-eval, dispatch to exit trigger (Plan 19-05). If any signal de-trips during the delay window, log structured pino 'antirug.signal-detripped' and abort. Suppresses one-tx reorg noise."
    - "Detector module exports `evaluateRugSignals(ctx, position, event)` and the internal `pendingV3Burn` Map state — clean API for Plan 19-04a's dispatchEvent and Plan 19-04c's backfill loop."
  artifacts:
    - path: "src/anti-rug/detector.ts"
      provides: "Multi-signal AND chain evaluator (V2 + V3 + V3 Burn-grace-window) + confirm-after-N-blocks gate"
      contains: "export async function evaluateRugSignals, pendingV3Burn, V3_BURN_GRACE_BLOCKS, confirm-after-N-blocks gate"
    - path: "test/unit/anti-rug/detectorEvaluator.test.ts"
      provides: "Unit tests for multi-signal AND chain (table-driven V2 + V3) + V3 Burn-grace-window + allowlist suppression + confirm-blocks gate + signal de-trip abort + vacuous-pass guard"
      contains: "describe('Phase 19 — Multi-signal evaluator (V2 + V3 + grace window)'"
  key_links:
    - from: "src/anti-rug/detector.ts evaluateRugSignals"
      to: "src/anti-rug/exitTrigger.ts (Plan 19-05) triggerAntiRugExit"
      via: "On all-three-signal verdict AFTER confirm-blocks delay: await triggerAntiRugExit(ctx, dex, token, feeTier, tradeId, evaluation)"
      pattern: "triggerAntiRugExit"
    - from: "src/anti-rug/detector.ts evaluateRugSignals"
      to: "src/anti-rug/detector.ts dispatchEvent (Plan 19-04a)"
      via: "Called from dispatchEvent on each routed Log event"
      pattern: "evaluateRugSignals"
    - from: "src/anti-rug/detector.ts evaluateRugSignals"
      to: "src/anti-rug/allowlist.ts isAddressAllowlisted (Plan 19-03)"
      via: "Signal 2 lookup against ctx.chain.antiRug.allowlistV2 OR allowlistV3"
      pattern: "isAddressAllowlisted"
---

<objective>
Land the multi-signal AND chain evaluator (V2 + V3 + V3 Burn-without-Collect grace window) and the confirm-after-N-blocks gate. Plan 19-04a established the registry + dispatch skeleton; this plan implements the verdict logic that dispatchEvent consumes.

Purpose: This is the brain of the anti-rug detector — the multi-signal AND chain prevents false positives that would otherwise drain capital from real positions on legitimate large-LP-rebalance transactions. The V3 grace window resolves Blocker 2 from plan-checker iteration 1 (the original Plan 19-04 Test 10 had non-deterministic verdict semantics for V3 Burn-without-Collect; resolution (a) — explicit grace window — makes the verdict deterministic).

Output: Extends `src/anti-rug/detector.ts` (created in Plan 19-04a) with `evaluateRugSignals`, the V3 Burn grace window logic, and the confirm-after-N-blocks gate. One new test file covering 18 behaviors.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md
@.planning/phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md
@.planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md
@.planning/phases/19-anti-rug-runtime-monitoring/19-VALIDATION.md
@.planning/phases/19-anti-rug-runtime-monitoring/19-01-PLAN.md
@.planning/phases/19-anti-rug-runtime-monitoring/19-02-PLAN.md
@.planning/phases/19-anti-rug-runtime-monitoring/19-03-PLAN.md
@.planning/phases/19-anti-rug-runtime-monitoring/19-04a-PLAN.md

# Source files this plan consumes
@src/anti-rug/detector.ts
@src/anti-rug/types.ts
@src/anti-rug/events.ts
@src/anti-rug/allowlist.ts
@src/anti-rug/lpBaseline.ts
@src/utils/abis.ts
@src/chainRegistry.ts

<interfaces>
Available helpers:
- From Plan 19-04a: `positionRegistry`, `RegisteredPosition`, the `evaluateRugSignals` shim/setter, the `dispatchEvent` internal router that calls evaluateRugSignals.
- From Plan 19-03: `isAddressAllowlisted` (allowlist.ts), `RugEvaluation`, `RugSignals` (types.ts), event topic constants (events.ts).
- From Plan 19-02: `ctx.chain.antiRug.{lpRemovalPct, confirmBlocks, allowlistV2, allowlistV3}`.

V3 QuoterV2 ABI is already in src/utils/abis.ts (Phase 18). Existing usage at src/bot.ts:569-577 (buy-side slippage quote) is the read-pattern analog for V3 signal-3.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend src/anti-rug/detector.ts — evaluateRugSignals (V2 + V3) + V3 Burn-without-Collect grace window + confirm-after-N-blocks gate</name>
  <files>src/anti-rug/detector.ts, test/unit/anti-rug/detectorEvaluator.test.ts</files>
  <read_first>
    - src/anti-rug/detector.ts (Plan 19-04a — full file; must see positionRegistry + the evaluateRugSignals shim + dispatchEvent call site)
    - src/anti-rug/types.ts (Plan 19-03 — RugEvaluation discriminated union + RugSignals shape)
    - src/anti-rug/allowlist.ts (Plan 19-03 — isAddressAllowlisted signature)
    - src/anti-rug/events.ts (Plan 19-03 — topic constants for V2 Burn / V2 Transfer / V3 Burn / V3 Collect)
    - src/utils/abis.ts (PAIR_ABI for getReserves; V3_POOL_ABI for liquidity; V3_QUOTER_V2_ABI for quoteExactInputSingle)
    - src/bot.ts lines 569-577 (V3 QuoterV2.quoteExactInputSingle.staticCall buy-side usage — read-pattern for V3 signal-3)
    - .planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md D-V3-EVENTS (lines 55-60), D-V3-SIGNAL3 (lines 61-66), D-V3-ALLOWLIST (lines 67-69) — the V3 evaluation contract
    - .planning/phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md §1.3 (V3 baseline shape), §2.2 (V3 allowlist owner-vs-recipient note), §3 (QuoterV2 sell-sim) lines 877-947
    - .planning/phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md "Anti-Patterns to Avoid" (lines 534-555) — vacuous-pass especially
  </read_first>
  <behavior>
    **Multi-signal AND chain (V2 path):**
    - Test 1: Only signal 1 trips (LP removed >50%, destination in allowlist, V2 reserves above threshold) → verdict='safe', reason='partial-signal'.
    - Test 2: Only signal 2 trips (LP removed 30%, destination NOT in allowlist, V2 reserves above threshold) → verdict='safe', reason='partial-signal'.
    - Test 3: Only signal 3 trips (LP removed 30%, destination in allowlist, V2 reserves below 50% baseline) → verdict='safe', reason='partial-signal'.
    - Test 4: Signals 1 + 2 trip (LP removed >50%, NOT in allowlist), signal 3 does NOT trip (reserves above threshold) → verdict='safe', reason='partial-signal'. (Two-of-three is not enough.)
    - Test 5: All three signals trip (LP >50% removed, destination NOT allowlisted, V2 reserves <50% baseline) → verdict='unsafe', reason='three-signal-trigger', all signal fields populated.
    - Test 6: Destination IS in allowlist (regardless of other signals) → verdict='allowlisted', lockerName populated, signals populated.

    **Multi-signal AND chain (V3 path — Collect arrival):**
    - Test 7: V3 Collect event with all-three-signal trigger (pool.liquidity dropped >50% from baseline, owner NOT allowlisted, QuoterV2.staticCall returned <50% baseline expected) → verdict='unsafe'.
    - Test 8: V3 Collect event with recipient (or owner per D-V3-ALLOWLIST owner-only choice) in allowlist → verdict='allowlisted'.
    - Test 9: V3 QuoterV2 reverts (no liquidity / pool dry) → signal 3 trips per fail-closed discipline; combined with signals 1 + 2 trip → verdict='unsafe' (sell-impossible IS the rug condition).

    **V3 Burn-without-Collect grace window (Blocker 2 resolution (a)):**
    - Test 10: V3 Burn event arrives at block X for pool P; no Collect arrives by block X+5 (default V3_BURN_GRACE_BLOCKS=5); grace timeout fires; multi-signal AND chain evaluates with pool.liquidity at block X+5 + QuoterV2 staticCall at block X+5; signal 1 trips (liquidity dropped >50%) AND signal 2 (owner NOT allowlisted) AND signal 3 (QuoterV2 quoted < 50%) → verdict='unsafe', reason='three-signal-trigger'. **DETERMINISTIC** — no "depending on liquidity drop magnitude" hedge.
    - Test 10b: Same setup as Test 10 but signal 3 does NOT trip (QuoterV2 returns >50% baseline expected; pool still functional) → verdict='safe', reason='partial-signal'. Deterministic.
    - Test 10c: V3 Burn event arrives at block X for pool P; V3 Collect arrives at block X+2 for the same pool; the pendingV3Burn entry is consumed and the multi-signal AND chain is evaluated IMMEDIATELY on Collect arrival (not on grace timeout); verdict reflects the actual signal state at block X+2.
    - Test 10d: Multiple V3 Burn events for the same pool within the grace window — only the LATEST pendingV3Burn entry is held (or the OLDEST is held; Claude's discretion — document choice in SUMMARY). Either is deterministic; the verdict is from the held burn's evaluation at grace-timeout OR the matching Collect.

    **Confirm-after-N-blocks gate:**
    - Test 11: All three signals trip → schedule re-evaluation after `confirmBlocks` blocks via `ctx.httpProvider.on('block', ...)` watch → re-eval still all-three → dispatch to exit trigger (mocked).
    - Test 12: All three signals trip → during confirm-blocks delay, signal de-trips (e.g., reserves recovered) → log structured pino 'antirug.signal-detripped' → abort, do NOT dispatch exit.
    - Test 13: confirmBlocks=0 (synchronous trigger) → dispatch immediately without delay.

    **Allowlist evaluation:**
    - Test 14: V2 Burn event with `to` field matching DEAD_ADDRESS → allowlistHit='safe' (lockerName='Burn address (canonical)'); verdict='allowlisted'.
    - Test 15: V2 LP Transfer event with `to=0x…dEaD` and value > 0 → same as Test 14.
    - Test 16: V3 Burn event with `owner` matching UNCX V3 Locker → allowlistHit='safe', verdict='allowlisted'.

    **Vacuous-pass impossibility:**
    - Test 17: RPC error during signal evaluation (loadLpBaseline returns null OR getReserves rejects OR QuoterV2 rejects with non-revert error like RPC timeout) → verdict='unknown', reason populated with error message. NEVER returns 'safe' on missing data per fail-closed discipline.
  </behavior>
  <action>
Extend `src/anti-rug/detector.ts` (created in Plan 19-04a) with the evaluator and grace-window logic. The 19-04a `evaluateRugSignals` shim/setter is replaced (or assigned) with the real implementation per the discretion documented in 19-04a's <interfaces>.

(1) **V3_BURN_GRACE_BLOCKS constant** (top-level, near other tunables; planner discretion to make this per-chain env-overridable in a future plan — for v6.17 ship time, 5 blocks is the default):
```typescript
const V3_BURN_GRACE_BLOCKS = 5;
```

(2) **pendingV3Burn Map (module-level state):**
```typescript
interface PendingV3Burn {
    poolAddress: string;
    position: RegisteredPosition;
    burnEvent: Log;
    burnBlockNumber: number;
    timeoutBlockNumber: number; // burnBlockNumber + V3_BURN_GRACE_BLOCKS
}
const pendingV3Burn = new Map<string, PendingV3Burn>(); // key = lowercased pool address
```

(3) **evaluateRugSignals — top-level export:**
```typescript
export async function evaluateRugSignals(
    ctx: ChainContext,
    position: RegisteredPosition,
    logEvent: Log
): Promise<RugEvaluation> { ... }
```

Body structure:

**Step A — Topic-based dispatch:**
- `topic = logEvent.topics[0]`.
- If `topic === POOL_BURN_TOPIC`: V3 Burn path → invoke `handleV3BurnArrival(ctx, position, logEvent)` (see Step C). Return verdict='safe' reason='partial-signal' immediately (the grace window holds the verdict; the dispatch fires the actual AND-chain evaluation later on grace-timeout or Collect arrival).
- If `topic === POOL_COLLECT_TOPIC`: V3 Collect path → invoke `handleV3CollectArrival(ctx, position, logEvent)` (see Step D). The AND-chain evaluation fires synchronously.
- If `topic === PAIR_BURN_TOPIC` OR `topic === PAIR_TRANSFER_TOPIC`: V2 path → fall through to Step E (the standard AND-chain evaluation).
- Else: log warn 'antirug.evaluator.unknown-topic' and return verdict='unknown', reason='topic-not-recognized'.

**Step B — V2 AND-chain evaluation (Step E for V2 path):**

Per the must_haves:
- **Signal 1 (LP-removed-pct):** `pair = new Contract(position.pairOrPoolAddress, PAIR_ABI, ctx.httpProvider); [reserves, totalSupply] = await Promise.all([pair.getReserves(), pair.totalSupply()]);` compute pct removed vs `position.baseline.v2_lp_total_supply` (use BigInt math). Trips if `pct > ctx.chain.antiRug.lpRemovalPct`.
- **Signal 2 (destination NOT in allowlist):**
  - For PAIR_BURN_TOPIC: destination = decoded `to` field from the Burn event (4th param: `Burn(address,uint256,uint256,address)`).
  - For PAIR_TRANSFER_TOPIC: destination = decoded `to` field (3rd indexed param: `Transfer(address,address,uint256)`).
  - Use `isAddressAllowlisted(ctx.chain.antiRug.allowlistV2, destination)`.
  - If `hit=true`, set `allowlistHit='safe'` and `lockerName`; if `hit=false`, set `allowlistHit='unsafe'` and signal-2 trips.
- **Signal 3 (V2 reserves below threshold):** Compute `v2ReservePctBelow = (1 - Number(currentReserves) / Number(baselineReserves)) * 100`; trips if `currentReserves / baselineReserves < 0.5` (50% reserves remaining or less).
- **Evaluation:**
  - If allowlistHit='safe' → return `{verdict: 'allowlisted', signals, lockerName}` + log `op: 'antirug.allowlist-hit'` per D-LIST-AUDIT.
  - If all three trip → schedule confirm-blocks gate (Step F). If gate confirms → fire dispatch to triggerAntiRugExit (mocked here; actual call site lives in Plan 19-05).
  - Else → return `{verdict: 'safe', reason: 'partial-signal', signals}`.
- On any thrown error during signal evaluation → return `{verdict: 'unknown', reason: error.message}` per fail-closed discipline.

**Step C — V3 Burn arrival (handleV3BurnArrival):**

```typescript
async function handleV3BurnArrival(ctx, position, burnEvent): Promise<void> {
    const poolKey = burnEvent.address.toLowerCase();
    const burnBlockNumber = burnEvent.blockNumber;
    const timeoutBlockNumber = burnBlockNumber + V3_BURN_GRACE_BLOCKS;

    pendingV3Burn.set(poolKey, { poolAddress: poolKey, position, burnEvent, burnBlockNumber, timeoutBlockNumber });

    // Schedule a block watcher to fire on grace timeout (if no Collect arrives first)
    const blockHandler = async (currentBlock: number) => {
        if (currentBlock < timeoutBlockNumber) return; // still inside grace window

        // Check if the pending entry is still there (Collect may have consumed it)
        const pending = pendingV3Burn.get(poolKey);
        if (!pending || pending.burnBlockNumber !== burnBlockNumber) {
            // Collect handler already evaluated; nothing to do
            ctx.httpProvider.off('block', blockHandler);
            return;
        }

        // Grace timeout fired — evaluate the held burn against current pool state
        ctx.httpProvider.off('block', blockHandler);
        pendingV3Burn.delete(poolKey);
        await evaluateV3MultiSignal(ctx, position, burnEvent, 'grace-timeout');
    };
    ctx.httpProvider.on('block', blockHandler);

    log.info({ pool: poolKey, burnBlock: burnBlockNumber, timeoutBlock: timeoutBlockNumber, op: 'antirug.v3-burn-grace-window' }, 'V3 Burn held pending Collect or grace timeout');
}
```

**Step D — V3 Collect arrival (handleV3CollectArrival):**

```typescript
async function handleV3CollectArrival(ctx, position, collectEvent): Promise<RugEvaluation> {
    const poolKey = collectEvent.address.toLowerCase();
    const pending = pendingV3Burn.get(poolKey);
    if (pending) {
        // Consume the pending Burn — Collect arrived within grace window
        pendingV3Burn.delete(poolKey);
        log.info({ pool: poolKey, burnBlock: pending.burnBlockNumber, collectBlock: collectEvent.blockNumber, op: 'antirug.v3-burn-collect-paired' }, 'V3 Burn paired with Collect within grace window');
    }
    return evaluateV3MultiSignal(ctx, position, collectEvent, 'collect-arrival');
}
```

**Step E — evaluateV3MultiSignal (the actual V3 AND-chain):**

Per the must_haves V3 path:
- **Signal 1 (V3 liquidity drop):** `pool = new Contract(poolAddress, V3_POOL_ABI, ctx.httpProvider); liquidity = await pool.liquidity();` compute pct dropped vs `position.baseline.v3_active_liquidity`. Trips if drop > `ctx.chain.antiRug.lpRemovalPct`.
- **Signal 2 (destination NOT in allowlist):**
  - For POOL_BURN_TOPIC: destination = decoded `owner` field (1st indexed param).
  - For POOL_COLLECT_TOPIC: destination = decoded `owner` field OR `recipient` field — per D-V3-ALLOWLIST + RESEARCH §2.2, owner-only is the recommendation; planner discretion to widen if dry-run shows false negatives. THIS plan ships **owner-only on both** (matches CONTEXT.md D-V3-ALLOWLIST phrasing); note in SUMMARY.
  - Use `isAddressAllowlisted(ctx.chain.antiRug.allowlistV3, destination)`.
- **Signal 3 (V3 sell-sim):** `quoter = new Contract(quoterAddress, V3_QUOTER_V2_ABI, ctx.httpProvider); result = await quoter.quoteExactInputSingle.staticCall({tokenIn: position.tokenAddress, tokenOut: ctx.chain.wethAddress, amountIn: probeAmount, fee: position.feeTier, sqrtPriceLimitX96: 0n});` (probeAmount is the position's amount or a fixed probe per RESEARCH §3); compare result[0] against baseline expected. If revert, signal-3 trips per fail-closed.
- Same verdict logic as V2 path (allowlist → 'allowlisted'; all three → 'unsafe' (after confirm-blocks gate); else → 'safe' partial-signal).

**Step F — Confirm-after-N-blocks gate:**

```typescript
async function scheduleConfirmGate(ctx, position, evaluation, dex, feeTier, tradeId): Promise<void> {
    const triggerBlock = await ctx.httpProvider.getBlockNumber();
    const confirmBlock = triggerBlock + ctx.chain.antiRug.confirmBlocks;

    if (ctx.chain.antiRug.confirmBlocks === 0) {
        // Synchronous dispatch (Test 13)
        await triggerAntiRugExit(ctx, dex, position.tokenAddress, feeTier, tradeId, evaluation);
        return;
    }

    const blockHandler = async (currentBlock: number) => {
        if (currentBlock < confirmBlock) return;
        ctx.httpProvider.off('block', blockHandler);

        // Re-evaluate
        const reEvaluation = await evaluateRugSignals(ctx, position, /* the last event */); // see note below
        if (reEvaluation.verdict !== 'unsafe') {
            log.info({ tradeId, originalSignals: evaluation.signals, currentSignals: reEvaluation.signals, op: 'antirug.signal-detripped' }, 'Signal de-tripped during confirm-blocks delay; abort');
            return;
        }

        await triggerAntiRugExit(ctx, dex, position.tokenAddress, feeTier, tradeId, reEvaluation);
    };
    ctx.httpProvider.on('block', blockHandler);
}
```

Note on re-evaluation: re-running evaluateRugSignals requires the latest event — discretionary call. Simplest approach: re-read the pool state directly (skip the dispatch-by-event path) and re-compute signals 1 + 2 + 3 against the current block. For Test 12 (de-trip), this approach correctly catches a recovered pool.

`triggerAntiRugExit` is imported from Plan 19-05's `./exitTrigger` — this plan's test mocks it via `vi.mock('./exitTrigger', ...)`.

(4) **Unit test file (test/unit/anti-rug/detectorEvaluator.test.ts):**
- Mock `ChainContext`, `ctx.httpProvider`, `ctx.wsProvider`, `Contract` factories.
- Use vitest `describe.each` for the multi-signal table tests (Tests 1-9).
- For V3 grace window tests (Test 10, 10b, 10c, 10d), use `vi.useFakeTimers()` AND a block-mock that simulates `ctx.httpProvider.on('block', ...)` to advance to the timeout block.
- For Test 17 (vacuous-pass), force RPC reject and assert verdict='unknown' (NOT 'safe').
- Mock `triggerAntiRugExit` via `vi.mock('./exitTrigger', () => ({ triggerAntiRugExit: vi.fn().mockResolvedValue(true) }))` and assert call count + args for Tests 11 + 13.

**Discretionary calls (planner-documented):**
- V3_BURN_GRACE_BLOCKS = 5 blocks default. Hardcoded constant in v6.17; promoted to per-chain env in v6.18 if operationally needed.
- Owner-only on both Burn AND Collect for V3 allowlist check (matches CONTEXT.md D-V3-ALLOWLIST phrasing); SUMMARY notes the alternative (recipient-AND-owner) for future tuning.
- Block-number watching for confirm-blocks (vs time-based setTimeout): block-watch chosen — more accurate against chain time-drift; uses existing `ctx.httpProvider.on('block', ...)` pattern.
- pendingV3Burn keyed by pool address; on multiple Burns within grace window, the latest Burn overwrites the entry (Test 10d). Alternative: keep all and evaluate at each grace timeout — more code, no behavioral benefit since the AND chain is the same; LAST-WINS chosen for simplicity.
  </action>
  <verify>
    <automated>npm run test:unit -- anti-rug/detectorEvaluator</automated>
  </verify>
  <done>
    - All 18 tests pass (Tests 1-9 + 10 + 10b + 10c + 10d + 11-17 = 17 + 3 grace-window variants = 20 tests; the exact count includes the V3 grace-window variants 10b, 10c, 10d).
    - `npx tsc --noEmit` clean across all tsconfig projects.
    - `grep -n "verdict.*'safe'" src/anti-rug/detector.ts | grep -v "partial-signal"` returns ZERO lines — the vacuous-pass guard holds (no code path returns verdict='safe' without 'partial-signal' reason).
    - `grep -c "pendingV3Burn" src/anti-rug/detector.ts` returns >= 3 (Map declaration + Burn handler set + Collect handler delete).
    - `grep -n "V3_BURN_GRACE_BLOCKS" src/anti-rug/detector.ts` returns the constant declaration AND at least one use site.
    - `grep -n "antirug.v3-burn-grace-window\|antirug.v3-burn-collect-paired" src/anti-rug/detector.ts` returns both log ops.
    - `grep -n "triggerAntiRugExit" src/anti-rug/detector.ts` returns >= 1 line (the import and the call site).
  </done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WebSocket Log event payload | external (RPC-controlled) input; the multi-signal AND chain evaluator decodes and dispatches; malformed events caught by try/catch → verdict='unknown' |
| `pool.liquidity()` / `pair.getReserves()` RPC response at evaluation time | external view-call; signal-1 depends on this value; multi-signal AND mitigates by requiring signals 2 + 3 as well |
| `QuoterV2.staticCall` response | external view-call result feeds signal-3; revert is treated as signal-3 trip per fail-closed |
| V3 Burn grace window timing | internal block-number watch; if RPC drops during grace window, the block handler doesn't fire → pendingV3Burn stays in Map indefinitely (memory leak, not safety issue; ws-reconnect from Plan 19-04c resets state) |
| confirm-after-N-blocks gate | internal block-number watch; same exposure as grace window — RPC drop during gate window holds the dispatch indefinitely |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-04b-01 | Spoofing | malformed log event (wrong topic, wrong indexed positions) | mitigate | ethers v6 Contract auto-decodes against the loaded ABI; malformed events that don't match throw at decode time; caught by try/catch in evaluateRugSignals → verdict='unknown' (NOT 'safe'). Test 17 covers. |
| T-19-04b-02 | Tampering | hostile RPC injects forged Burn event for an allowlisted destination | accept | Even if a forged event arrives, signal-2 sees the destination in the allowlist → verdict='allowlisted' → no exit fires. Multi-signal AND chain mitigates by construction. |
| T-19-04b-03 | Tampering | QuoterV2 staticCall returns manipulated (sandwiched) quote during signal-3 evaluation | mitigate | QuoterV2 reads pool state at the current block; the multi-signal AND chain requires signal-1 (LP-removed > 50%) AND signal-2 (NOT allowlisted) to ALSO be true. A sandwich attack on a single block's quote is not, alone, a rug indicator. |
| T-19-04b-04 | Repudiation | V3 Burn grace timeout doesn't fire because block handler was dropped on RPC reconnect | mitigate | Plan 19-04c reconnect path re-registers all pending grace-timeout handlers on the new block subscription. AT WORST, a Burn during a brief RPC disconnect is re-evaluated when Collect arrives or when the next event triggers re-registration. Document edge case in SUMMARY for Plan 19-04c to handle. |
| T-19-04b-05 | Repudiation | confirm-after-N-blocks gate hangs (RPC drops during gate window) | accept | Same edge case as T-19-04b-04; Plan 19-04c reconnect re-registers handlers; worst case is the dispatch fires late (after RPC reconnect) but never silently missed. |
| T-19-04b-06 | DoS | rapid V3 Burn events for the same pool overwrite the pendingV3Burn entry without evaluation | mitigate | LAST-WINS by design (Test 10d). The first Burn's pendingV3Burn entry is replaced; the held entry always reflects the most recent event. Acceptable per planner discretion documented in SUMMARY. |
| T-19-04b-07 | Information disclosure | structured pino logs include token addresses, pair addresses, signal values, allowlist names | accept | Local-only operator UI per UI-SPEC §"Cross-Cutting Constraints" item 1. All on-chain data is public. |

**Residual risk:** None at `high`. Multi-signal AND chain is the primary mitigation; vacuous-pass guard (verdict='unknown' on any RPC error) keeps the fail-closed discipline; V3 Burn grace window resolves Blocker 2's non-deterministic verdict issue.

</threat_model>

<verification>

- `npm run test:unit -- anti-rug/detectorEvaluator` reports 20/20 passing (V2 1-6 + V3 7-9 + grace 10, 10b, 10c, 10d + confirm 11-13 + allowlist 14-16 + vacuous 17).
- `npx tsc --noEmit` clean.
- `grep -n "verdict.*'safe'" src/anti-rug/detector.ts | grep -v "partial-signal"` returns ZERO lines.
- `grep -c "pendingV3Burn" src/anti-rug/detector.ts` returns >= 3.
- `grep -n "V3_BURN_GRACE_BLOCKS" src/anti-rug/detector.ts` returns >= 2.

</verification>

<success_criteria>

- Multi-signal AND chain trigger: signal 1 + signal 2 + signal 3 ALL required before exit dispatch; single-signal events log but never exit.
- V3 Burn-without-Collect grace window per Blocker 2 resolution (a) — deterministic verdict via grace-timeout OR Collect-arrival.
- V3 + V2 events both handled via topic-based dispatch within evaluateRugSignals.
- Discriminated-union RugEvaluation return contract honored — no 'safe' return without 'partial-signal' reason.
- Confirm-after-N-blocks gate scheduled via block-watch; de-trip aborts dispatch.

</success_criteria>

<output>
Create `.planning/phases/19-anti-rug-runtime-monitoring/19-04b-SUMMARY.md` when done. Cover: the V3 Burn grace-window implementation (per-pool LAST-WINS semantics); the V3 allowlist owner-only choice and the future-tuning note (recipient-AND-owner alternative); the confirm-blocks block-watch vs setTimeout decision; any edge cases that surfaced (especially around grace-timeout + RPC reconnect re-registration for Plan 19-04c handoff).
</output>
