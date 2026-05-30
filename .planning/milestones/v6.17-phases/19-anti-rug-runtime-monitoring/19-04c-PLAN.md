---
id: 19-04c
phase: 19-anti-rug-runtime-monitoring
plan: 04c
type: execute
wave: 4
depends_on: [19-01, 19-02, 19-03, 19-04a, 19-04b]
files_modified:
  - src/anti-rug/detector.ts
autonomous: true
requirements: [ANTIRUG-11, ANTIRUG-12]
requirements_addressed: [ANTIRUG-11, ANTIRUG-12]
tags: [anti-rug, detector, heartbeat, reconnect, backfill, http-polling-fallback, ws-health-alerts]

must_haves:
  truths:
    - "Heartbeat ping/pong on `ctx.wsProvider.websocket` via `ws@^8.20.0` `ping()` + `on('pong')` + `terminate()` per ANTIRUG-12 + RESEARCH §6.1 — 30s interval; `(ws as any).isAlive = false` before ping, set true on pong; if still false at next interval, `ws.terminate()` triggers reconnect path. ethers v6 has no built-in heartbeat per issue #1053."
    - "Reconnect → resubscribe → backfill via Plan 19-04a's `getLogsForBackfill(ctx, lastSeenBlock+1, currentBlock, addresses, topics)` chunked at `ctx.chain.antiRug.backfillCapBlocks` per RESEARCH CRITICAL #1. Gap exceeding `ctx.chain.antiRug.maxBackfillBlocks` FAILS CLOSED with `[GAP DETECTED]` pino error + sendCtxAlert + broadcast 'antirug_event' kind='gap-detected' per D-BACKFILL."
    - "Backfilled events fire `would-have-sold` log + tagged `'too-late'` in race telemetry — NEVER fire live exits on backfilled events per D-BACKFILL anti-pattern rejection. Backfill iteration calls `evaluateRugSignals` (Plan 19-04b) for evidence but branches the dispatch — on verdict='unsafe', logs `op: 'antirug.backfill.too-late'` and broadcasts `antirug_event` with `outcome: 'too-late'` instead of calling `triggerAntiRugExit`."
    - "`lastSeenBlock` per chain persists in `chain_state` table (Plan 19-01 `upsertChainState`) after every confirmed event processed; loaded at restart via `getChainState` (Plan 19-05 wires the restart-time call)."
    - "HTTP polling fallback path (when `ctx.wsProvider === null`) — same poll-loop shape as `src/bot.ts:758-810` (startHttpPollingListener analog). After each poll, `upsertChainState.run(ctx.chain.name, currentBlock, ts)`."
    - "Per D-VIS-WS-HEALTH tiered alerts (Warning 9 from plan-checker iteration 1) — tiered alerts: (a) reconnect failed 3 times in a row → `sendCtxAlert(ctx, '*[WS RECONNECT FAILED]* {chain} — 3 consecutive reconnect attempts failed; manual intervention may be required')`; (b) disconnect persists >60s → `sendCtxAlert(ctx, '*[WS DISCONNECTED >60s]* {chain} — anti-rug monitor offline for {N} seconds; positions on this chain are UNMONITORED')`; (c) backfill gap > maxBackfillBlocks → `sendCtxAlert(ctx, '*[GAP DETECTED]* {chain} missed {N} blocks ({lastSeen}-{currentBlock}); backfill skipped per D-BACKFILL fail-closed; review anti-rug events manually')`. All three trigger structured pino at log.warn / log.error level matching D-VIS-WS-HEALTH."
    - "WS broadcasts for dashboard (UI-SPEC §Realtime Push Contract): `chain_ws_health_change` on connect / reconnect / disconnect; `antirug_event` on every event evaluation (kind='trigger' | 'allowlist-suppression' | 'gap-detected', signals, outcome). Plan 19-06 dashboard consumes these."
  artifacts:
    - path: "src/anti-rug/detector.ts"
      provides: "Heartbeat + reconnect + backfill + HTTP polling fallback + tiered WS-health alerts"
      contains: "heartbeatInterval, handleWsClose, backfillSinceLastSeen, startHttpPollingAntiRug, sendCtxAlert tiered, broadcast chain_ws_health_change, broadcast antirug_event"
    - path: "test/integration/anti-rug/wsReconnectBackfill.test.ts"
      provides: "Integration test drills: heartbeat-dead → terminate → reconnect; backfill chunked getLogs; gap-exceeds-max FAIL CLOSED; HTTP polling fallback; tiered alerts (3-failed-reconnects, >60s-disconnect)"
      contains: "describe('Phase 19 — Anti-rug WS reconnect-resubscribe-backfill drill + tiered alerts'"
  key_links:
    - from: "src/anti-rug/detector.ts heartbeat + backfill"
      to: "dashboard/src/hooks/useWebSocket.ts (Plan 19-06)"
      via: "broadcast('chain_ws_health_change', {chain, state, lastPongTs}) on connect/reconnect/disconnect"
      pattern: "broadcast.*chain_ws_health_change"
    - from: "src/anti-rug/detector.ts backfillSinceLastSeen"
      to: "src/utils/db.ts upsertChainState (Plan 19-01)"
      via: "Updates chain_state.last_seen_block after backfill completes"
      pattern: "upsertChainState"
    - from: "src/anti-rug/detector.ts backfillSinceLastSeen"
      to: "src/anti-rug/detector.ts getLogsForBackfill (Plan 19-04a)"
      via: "Calls the chunking primitive for the (lastSeen+1, currentBlock) window"
      pattern: "getLogsForBackfill"
---

<objective>
Land the WS lifecycle layer of the detector — heartbeat + reconnect + backfill + HTTP polling fallback + tiered WS-health alerts. Plan 19-04a established the registry + WS subscription skeleton; Plan 19-04b implemented the multi-signal evaluator; this plan adds the resilience and operator-visibility layer.

Purpose: Without this plan, a single network blip silently disables anti-rug monitoring on the affected chain — the operator sees no alert and positions are exposed to rugs without the detector observing them. The tiered alerts per D-VIS-WS-HEALTH (Warning 9 from plan-checker iteration 1) ensure the operator knows BOTH when the WS reconnects automatically (no alert spam) AND when something is genuinely broken (3-failed-reconnects, >60s disconnect, backfill gap > maxBackfillBlocks).

Output: Extends `src/anti-rug/detector.ts` with the heartbeat, reconnect, backfill, HTTP polling fallback, and tiered alert logic. One integration test file covering 9 behaviors (6 reconnect/backfill drills + 3 D-VIS-WS-HEALTH alert tier tests).
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
@.planning/phases/19-anti-rug-runtime-monitoring/19-04b-PLAN.md

# Source files this plan consumes
@src/anti-rug/detector.ts
@src/utils/db.ts
@src/utils/provider.ts
@src/utils/notifier.ts
@src/api/ws/broadcaster.ts
@src/bot.ts

<interfaces>
Available helpers:
- From Plan 19-04a: `positionRegistry`, `getRegisteredPositions(chain)`, `startChainAntiRugListener(ctx)` (this plan replaces the skeleton TODO comments with full implementation), `getLogsForBackfill(ctx, ...)`.
- From Plan 19-04b: `evaluateRugSignals(ctx, position, logEvent)` — consumed by backfill loop.
- From Plan 19-01: `upsertChainState`, `getChainState` (src/utils/db.ts).
- From Plan 19-02: `ctx.chain.antiRug.{backfillCapBlocks, maxBackfillBlocks}` — already used in 19-04a's `getLogsForBackfill`; this plan reads them for the gap-detection branch.
- From existing codebase: `sendCtxAlert` (src/utils/notifier.ts); `broadcast` (src/api/ws/broadcaster.ts); `removeWsProvider` (src/utils/provider.ts).
- Heartbeat pattern from 19-PATTERNS.md §"src/anti-rug/detector.ts" lines 144-167 (ws@^8.20.0 ping/pong/terminate).
- Reconnect pattern from 19-PATTERNS.md lines 113-167 (exponential backoff 1s → 60s; same as src/bot.ts:660-752).
- HTTP polling fallback pattern from 19-PATTERNS.md lines 169-197 (same as src/bot.ts:758-810).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend src/anti-rug/detector.ts — heartbeat + reconnect + backfill + HTTP polling fallback + tiered D-VIS-WS-HEALTH alerts</name>
  <files>src/anti-rug/detector.ts, test/integration/anti-rug/wsReconnectBackfill.test.ts</files>
  <read_first>
    - src/anti-rug/detector.ts (Plans 19-04a + 19-04b — full file; must see the `// TODO Plan 19-04c` comment markers in startChainAntiRugListener that this plan replaces)
    - src/bot.ts lines 656-810 (startDexListener WS subscribe + reconnect; HTTP polling fallback — the canonical analog this plan mirrors)
    - src/utils/db.ts (Plan 19-01 — upsertChainState + getChainState)
    - src/utils/provider.ts (removeWsProvider for clean reconnect)
    - src/utils/notifier.ts (sendCtxAlert for Telegram alerts)
    - src/api/ws/broadcaster.ts (broadcast() signature)
    - test/integration/wsReconnect.test.ts (mock WSProvider class — the test analog for the reconnect drill)
    - .planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md §"src/anti-rug/detector.ts" + §"test/integration/anti-rug/wsReconnectBackfill.test.ts" (lines 76-197 + 1167-1192)
    - .planning/phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md §5 (RPC caps) + §6 (heartbeat) — lines 1065-1166
    - .planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md D-VIS-WS-HEALTH (lines 126-134 — tiered alert spec)
    - .planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md D-BACKFILL (lines 220-229)
    - .planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md D-RACE-TELEMETRY (lines 171-189) — "too-late" tag for backfilled events
  </read_first>
  <behavior>
    **Heartbeat:**
    - Test 21: Heartbeat-dead path — mock WS, force `isAlive=false`, advance fake timers by 30s ping interval → assert `ws.terminate()` called → assert reconnect path kicks off via the registered 'close' handler.

    **Reconnect:**
    - Test 22: After reconnect, the new WSProvider is `on(filter, ...)` re-subscribed with the same address+topic filter — assert the filter object matches the pre-disconnect filter.

    **Backfill on reconnect:**
    - Test 23: After reconnect, backfill via `getLogsForBackfill(ctx, lastSeen+1, current, addresses, topics)` runs chunked — if gap is 30 blocks and cap is 10, expect 3 sequential getLogs calls (covered in Plan 19-04a Test A6; this test asserts the integration — backfillSinceLastSeen calls getLogsForBackfill with the correct args).
    - Test 24: Backfill gap > maxBackfillBlocks → log pino error with `gapBlocks=N`, call `sendCtxAlert(ctx, '[GAP DETECTED] {chain} missed {N} blocks ({lastSeen}-{currentBlock}); backfill skipped per D-BACKFILL fail-closed; review anti-rug events manually')`, broadcast 'antirug_event' with kind='gap-detected', do NOT process any backfill events (fail closed).
    - Test 25: Backfilled events fire `evaluateRugSignals` and on verdict='unsafe', log `op: 'antirug.backfill.too-late'` would-have-sold event AND broadcast `antirug_event` with `outcome: 'too-late'` but do NOT dispatch to triggerAntiRugExit (anti-pattern: live exit on backfilled trigger is explicitly rejected per D-BACKFILL).

    **HTTP polling fallback:**
    - Test 26: HTTP polling fallback path — when `ctx.wsProvider === null`, `startChainAntiRugListener` invokes the polling loop instead; same event-dispatch behavior; `lastSeenBlock` updated in `chain_state` table after each poll.

    **D-VIS-WS-HEALTH tiered alerts (Warning 9 from plan-checker iteration 1):**
    - Test 27: 3 consecutive reconnect failures → `sendCtxAlert` called with `*[WS RECONNECT FAILED]*` prefix + chain name + the "3 consecutive" message; assert call count and the message format.
    - Test 28: Disconnect persists >60s → `sendCtxAlert` called with `*[WS DISCONNECTED >60s]*` prefix + chain name + duration in seconds + "positions UNMONITORED" warning; assert call count and the message format.
    - Test 29: GAP DETECTED alert (covered partially by Test 24; this test verifies the alert format) — `sendCtxAlert` called with `*[GAP DETECTED]*` prefix + chain + missed-blocks + range + fail-closed phrasing.
  </behavior>
  <action>
Extend `src/anti-rug/detector.ts` (created in Plan 19-04a, evaluator landed in 19-04b). This plan REPLACES the `// TODO Plan 19-04c` comment markers in `startChainAntiRugListener` with the full lifecycle implementation.

(1) **Update imports (add to existing import block):**
```typescript
import { sendCtxAlert } from '../utils/notifier';
import { broadcast } from '../api/ws/broadcaster';
import { removeWsProvider } from '../utils/provider';
import { upsertChainState, getChainState } from '../utils/db';
import type { WebSocket } from 'ws';
```

(2) **Full `startChainAntiRugListener(ctx)` body — replaces 19-04a skeleton:**

```typescript
export async function startChainAntiRugListener(ctx: ChainContext): Promise<void> {
    if (ctx.wsProvider == null) {
        log.warn({ chain: ctx.chain.name, op: 'antirug.ws-null-falling-back-to-http' }, 'No WSProvider — falling back to HTTP polling');
        await startHttpPollingAntiRug(ctx);
        return;
    }

    const addresses = getRegisteredPositions(ctx.chain.name).map(p => p.pairOrPoolAddress);
    const topics = [[PAIR_BURN_TOPIC, PAIR_TRANSFER_TOPIC, POOL_BURN_TOPIC, POOL_COLLECT_TOPIC]];

    // Subscribe (skeleton from 19-04a wired here)
    ctx.wsProvider.on({ address: addresses, topics }, (logEvent: Log) => dispatchEvent(ctx, logEvent));

    // Update chain state
    const state = chainState.get(ctx.chain.name) ?? createInitialChainState();
    state.wsProvider = ctx.wsProvider;
    state.healthState = 'connected';
    state.lastPongTs = Date.now();
    state.reconnectAttempts = 0;
    chainState.set(ctx.chain.name, state);

    // Broadcast connected
    broadcast('chain_ws_health_change', { chain: ctx.chain.name, state: 'connected', lastPongTs: state.lastPongTs });

    // Set up heartbeat
    setupHeartbeat(ctx);

    // Set up reconnect on close
    const rawWs: WebSocket = (ctx.wsProvider as any).websocket;
    (rawWs as any).on('close', () => handleWsClose(ctx));

    // Backfill from chain_state.last_seen_block (if any)
    await backfillSinceLastSeen(ctx);
}
```

(3) **setupHeartbeat (per 19-PATTERNS.md §"src/anti-rug/detector.ts" lines 144-167):**

```typescript
function setupHeartbeat(ctx: ChainContext): void {
    const rawWs: WebSocket = (ctx.wsProvider as any).websocket;
    const state = chainState.get(ctx.chain.name)!;
    (rawWs as any).isAlive = true;

    rawWs.on('pong', () => {
        (rawWs as any).isAlive = true;
        state.lastPongTs = Date.now();
    });

    state.heartbeatInterval = setInterval(() => {
        if ((rawWs as any).isAlive === false) {
            log.warn({ chain: ctx.chain.name, op: 'antirug.heartbeat.dead' }, 'WS heartbeat dead — terminating');
            return rawWs.terminate(); // triggers 'close' → handleWsClose
        }
        (rawWs as any).isAlive = false;
        rawWs.ping();
    }, 30_000);

    rawWs.on('close', () => {
        if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
    });
}
```

(4) **handleWsClose — full reconnect with exponential backoff + tiered alerts (per D-VIS-WS-HEALTH):**

```typescript
const MAX_RECONNECT_DELAY_MS = 60_000;
const DISCONNECT_ALERT_THRESHOLD_MS = 60_000;
const RECONNECT_FAILURE_ALERT_THRESHOLD = 3;

async function handleWsClose(ctx: ChainContext): Promise<void> {
    const state = chainState.get(ctx.chain.name)!;
    state.healthState = 'reconnecting';
    broadcast('chain_ws_health_change', { chain: ctx.chain.name, state: 'reconnecting' });

    const disconnectStartTs = Date.now();
    let reconnectDelay = 1000;
    let consecutiveFailures = 0;
    let alertedFor60s = false;

    while (true) {
        await new Promise(r => setTimeout(r, reconnectDelay));
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);

        // Check 60s-disconnect alert tier (D-VIS-WS-HEALTH)
        const disconnectedDurationMs = Date.now() - disconnectStartTs;
        if (disconnectedDurationMs > DISCONNECT_ALERT_THRESHOLD_MS && !alertedFor60s) {
            log.error({ chain: ctx.chain.name, durationSec: Math.floor(disconnectedDurationMs / 1000), op: 'antirug.ws.disconnected-over-60s' }, 'WS disconnected >60s');
            await sendCtxAlert(ctx, `*[WS DISCONNECTED >60s]* ${ctx.chain.name} — anti-rug monitor offline for ${Math.floor(disconnectedDurationMs / 1000)} seconds; positions on this chain are UNMONITORED`);
            broadcast('chain_ws_health_change', { chain: ctx.chain.name, state: 'disconnected', disconnectedDurationSec: Math.floor(disconnectedDurationMs / 1000) });
            alertedFor60s = true;
        }

        try {
            removeWsProvider(ctx.chain.name);
            const newWsProvider = new WebSocketProvider(ctx.chain.wsRpcUrl!, ctx.chain.chainId);
            ctx.wsProvider = newWsProvider;
            state.wsProvider = newWsProvider;

            // Re-subscribe with current address+topic union
            const addresses = getRegisteredPositions(ctx.chain.name).map(p => p.pairOrPoolAddress);
            const topics = [[PAIR_BURN_TOPIC, PAIR_TRANSFER_TOPIC, POOL_BURN_TOPIC, POOL_COLLECT_TOPIC]];
            newWsProvider.on({ address: addresses, topics }, (logEvent: Log) => dispatchEvent(ctx, logEvent));

            state.healthState = 'connected';
            state.lastPongTs = Date.now();
            state.reconnectAttempts = 0;
            log.info({ chain: ctx.chain.name, op: 'antirug.ws.reconnected' }, 'WS reconnected; re-subscribed');
            broadcast('chain_ws_health_change', { chain: ctx.chain.name, state: 'connected', lastPongTs: state.lastPongTs });

            // Backfill missed events
            await backfillSinceLastSeen(ctx);

            // Re-arm heartbeat + close handler
            setupHeartbeat(ctx);
            const rawWs: WebSocket = (newWsProvider as any).websocket;
            (rawWs as any).on('close', () => handleWsClose(ctx));
            break;
        } catch (err) {
            consecutiveFailures += 1;
            state.reconnectAttempts = consecutiveFailures;
            log.warn({ err, chain: ctx.chain.name, attempts: consecutiveFailures, delay: reconnectDelay, op: 'antirug.ws.reconnect-failed' }, 'WS reconnect failed; retrying');

            // Check 3-failed-reconnects alert tier (D-VIS-WS-HEALTH)
            if (consecutiveFailures === RECONNECT_FAILURE_ALERT_THRESHOLD) {
                log.error({ chain: ctx.chain.name, attempts: consecutiveFailures, op: 'antirug.ws.reconnect-failed-3x' }, 'WS reconnect failed 3 times');
                await sendCtxAlert(ctx, `*[WS RECONNECT FAILED]* ${ctx.chain.name} — 3 consecutive reconnect attempts failed; manual intervention may be required`);
            }
        }
    }
}
```

(5) **backfillSinceLastSeen — uses Plan 19-04a getLogsForBackfill + gap-detected fail-closed branch:**

```typescript
async function backfillSinceLastSeen(ctx: ChainContext): Promise<void> {
    const chainStateRow = getChainState.get(ctx.chain.name) as { last_seen_block: number; last_updated_ts: number } | undefined;
    if (!chainStateRow) {
        // No prior state — start from current block
        const currentBlock = await ctx.httpProvider.getBlockNumber();
        upsertChainState.run(ctx.chain.name, currentBlock, Math.floor(Date.now() / 1000));
        return;
    }

    const lastSeen = chainStateRow.last_seen_block;
    const currentBlock = await ctx.httpProvider.getBlockNumber();
    const gapBlocks = currentBlock - lastSeen;

    if (gapBlocks <= 0) return; // no gap

    if (gapBlocks > ctx.chain.antiRug.maxBackfillBlocks) {
        // FAIL CLOSED per D-BACKFILL (Test 24 + 29)
        log.error({ chain: ctx.chain.name, gapBlocks, lastSeen, currentBlock, op: 'antirug.backfill.gap-detected' }, '[GAP DETECTED] backfill skipped');
        await sendCtxAlert(ctx, `*[GAP DETECTED]* ${ctx.chain.name} missed ${gapBlocks} blocks (${lastSeen}-${currentBlock}); backfill skipped per D-BACKFILL fail-closed; review anti-rug events manually`);
        broadcast('antirug_event', { chain: ctx.chain.name, kind: 'gap-detected', gapBlocks, fromBlock: lastSeen, toBlock: currentBlock, timestamp: Date.now() });
        return;
    }

    // Chunked backfill via Plan 19-04a primitive
    const addresses = getRegisteredPositions(ctx.chain.name).map(p => p.pairOrPoolAddress);
    const topics = [[PAIR_BURN_TOPIC, PAIR_TRANSFER_TOPIC, POOL_BURN_TOPIC, POOL_COLLECT_TOPIC]];
    const events = await getLogsForBackfill(ctx, lastSeen + 1, currentBlock, addresses, topics);

    for (const event of events) {
        const pairAddress = event.address.toLowerCase();
        const positions = positionRegistry.get(ctx.chain.name)?.get(pairAddress) ?? [];
        for (const position of positions) {
            // Evaluate but DO NOT dispatch — backfilled events are 'too-late' per D-BACKFILL (Test 25)
            try {
                const evaluation = await evaluateRugSignals(ctx, position, event);
                if (evaluation.verdict === 'unsafe') {
                    log.warn({ tradeId: position.tradeId, evaluation, op: 'antirug.backfill.too-late' }, 'Backfilled would-have-sold event (too late to exit)');
                    broadcast('antirug_event', { chain: ctx.chain.name, kind: 'trigger', token: position.tokenAddress, pair: pairAddress, signals: evaluation.signals, outcome: 'too-late', timestamp: Date.now() });
                }
            } catch (err) {
                log.error({ err, tradeId: position.tradeId, op: 'antirug.backfill.eval-failed' }, 'Backfill evaluator failed');
            }
        }
    }

    upsertChainState.run(ctx.chain.name, currentBlock, Math.floor(Date.now() / 1000));
}
```

(6) **HTTP polling fallback (startHttpPollingAntiRug):**

Per 19-PATTERNS.md §"detector.ts" lines 169-197 verbatim shape; after each poll, call `upsertChainState.run(ctx.chain.name, currentBlock, Math.floor(Date.now() / 1000))`. The dispatch path inside the poll loop calls `dispatchEvent(ctx, event)` (which calls `evaluateRugSignals` per the live path; HTTP polling is LIVE not BACKFILL — events through this path can fire triggerAntiRugExit).

(7) **Integration test file (test/integration/anti-rug/wsReconnectBackfill.test.ts):**

- Copy the mock WSProvider class from test/integration/wsReconnect.test.ts.
- Tests 21-29 per behavior list.
- For Test 21 (heartbeat-dead), use vitest `vi.useFakeTimers()` to advance time for the 30s heartbeat interval.
- For Test 24 (gap-detected), mock `getChainState.get()` to return `{last_seen_block: 1000, last_updated_ts: 0}` and `ctx.httpProvider.getBlockNumber()` to return `100000` with `ctx.chain.antiRug.maxBackfillBlocks = 7200`; assert sendCtxAlert + broadcast + NO getLogs calls.
- For Tests 27 + 28 (D-VIS-WS-HEALTH tiered alerts), mock the WSProvider constructor to reject 3 times in a row (Test 27) and use fake timers to advance Date.now beyond 60s while reconnect retries fail (Test 28); assert sendCtxAlert call with the exact message format per the must_haves.
- For Test 25 (backfilled events), mock evaluateRugSignals to return verdict='unsafe' and assert triggerAntiRugExit is NEVER called (via `vi.mock('./exitTrigger', ...)` — same as Plan 19-04b's test setup).

**Discretionary calls (planner-documented):**
- DISCONNECT_ALERT_THRESHOLD_MS = 60_000 (60s) matches D-VIS-WS-HEALTH "disconnected >60s" wording verbatim.
- RECONNECT_FAILURE_ALERT_THRESHOLD = 3 matches D-VIS-WS-HEALTH "reconnect fails 3 times in a row" wording verbatim.
- Heartbeat interval = 30s default per ANTIRUG-12.
- MAX_RECONNECT_DELAY_MS = 60_000 (60s) cap on exponential backoff matches src/bot.ts:660-752 precedent.
- Each alert tier fires AT MOST ONCE per disconnect window (alertedFor60s flag); on successful reconnect, the flag resets via the new handleWsClose invocation on the next disconnect.
  </action>
  <verify>
    <automated>npm run test:integration -- anti-rug/wsReconnectBackfill</automated>
  </verify>
  <done>
    - All 9 integration tests pass (Tests 21-29 — 6 reconnect/backfill drills + 3 D-VIS-WS-HEALTH alert tier tests).
    - `npx tsc --noEmit` clean across all tsconfig projects.
    - `grep -n "isAlive\|terminate\|ping()" src/anti-rug/detector.ts` shows the heartbeat machinery wired.
    - `grep -n "DISCONNECT_ALERT_THRESHOLD_MS\|RECONNECT_FAILURE_ALERT_THRESHOLD" src/anti-rug/detector.ts` returns >= 2 constants.
    - `grep -n "WS RECONNECT FAILED\|WS DISCONNECTED >60s\|GAP DETECTED" src/anti-rug/detector.ts` shows all 3 D-VIS-WS-HEALTH alert tier messages.
    - `grep -n "antirug.backfill.too-late" src/anti-rug/detector.ts` returns 1 line (the backfilled-event log).
    - `grep -n "triggerAntiRugExit" src/anti-rug/detector.ts` shows the import + the LIVE call site (not the backfill branch — backfill explicitly does NOT call it).
    - `grep -n "upsertChainState\|getChainState" src/anti-rug/detector.ts` shows both consumed.
  </done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WebSocket heartbeat ping/pong | external timing-channel; absence of pong is the failure signal; a stuck-but-alive WS would silently miss events without heartbeat |
| `getLogs` backfill response | external input on reconnect; a malicious/buggy RPC could return forged historical events leading to logged-but-not-executed would-have-sold telemetry distortion |
| `getChainState` SQLite read at reconnect time | internal trusted boundary; corrupted state is theoretically possible if SQLite file is tampered with externally (operator threat model out of scope) |
| `sendCtxAlert` Telegram + `broadcast` WS | both are external comm channels; failure should degrade gracefully (log the alert-failure, do not block the reconnect retry loop) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-04c-01 | Tampering | heartbeat silent failure (NAT timeout, half-open socket) | mitigate | `(ws as any).isAlive` flag forces pong-or-die at each 30s ping interval; `ws.terminate()` on dead heartbeat triggers reconnect path. Test 21 drills heartbeat-dead → terminate → reconnect. |
| T-19-04c-02 | Repudiation | event processed but not logged in chain_state.last_seen_block | mitigate | `upsertChainState` runs after EVERY backfill completion (and after every HTTP poll); the test suite asserts the round-trip. Even a crash before upsert leaves the prior last_seen_block intact → next reconnect backfills the missed window. |
| T-19-04c-03 | DoS | hostile event stream floods with fast Burn events to drain the heartbeat / reconnect machinery | mitigate | Exponential backoff on reconnect (1s → 60s) plus single-listener-per-chain (Plan 19-04a) caps WS subscription count at 1 per chain. |
| T-19-04c-04 | EoP | backfilled event fires live exit (anti-pattern) | mitigate | Explicit branch in backfillSinceLastSeen: log+broadcast as 'too-late' / 'antirug.backfill.too-late'; NEVER call triggerAntiRugExit on backfilled paths. Test 25 covers; grep-verify ensures the call site exists ONLY outside the backfill branch. |
| T-19-04c-05 | Info disclosure | tiered alerts include chain name, disconnect duration, missed-blocks count | accept | All metadata is operational state — no PII; local-only operator UI. |
| T-19-04c-06 | Repudiation | tiered alert sendCtxAlert fails (Telegram down) — operator misses the alert | mitigate | Tiered alerts ALSO log at log.error level; structured pino retains the event even if Telegram delivery fails. Operator periodically reviews pino logs. |
| T-19-04c-07 | Tampering | reconnect re-subscribes with a STALE address list (old positions, missing new ones) | mitigate | `getRegisteredPositions(ctx.chain.name)` is called at re-subscribe time; reflects the CURRENT registry state. Plan 19-05's resumeAntiRugMonitoring re-registers positions before kicking off the listener; the address list is always fresh on reconnect. |
| T-19-04c-08 | DoS | hostile RPC drops connection rapidly to drain the bot's reconnect budget | mitigate | Exponential backoff caps cumulative attempts at ~10 per minute even on the worst case; tiered alerts (3-failed + >60s) surface to operator who can investigate the RPC. |

**Residual risk:** None at `high`. The lifecycle layer is the hardest to test correctly (timing-dependent), but the integration test suite drills each tier (heartbeat-dead, reconnect-3x-fail, >60s-disconnect, gap-detected, backfill-too-late) explicitly. Plan 19-07's HORSE fork test exercises the full live path end-to-end as a final integration gate.

</threat_model>

<verification>

- `npm run test:integration -- anti-rug/wsReconnectBackfill` reports 9/9 passing.
- `npx tsc --noEmit` clean across all tsconfig projects.
- `grep -n "ws.terminate\|ping()" src/anti-rug/detector.ts` returns both lines.
- `grep -n "broadcast.*chain_ws_health_change\|broadcast.*antirug_event" src/anti-rug/detector.ts` returns both broadcast types.
- `grep -n "WS RECONNECT FAILED\|WS DISCONNECTED >60s\|GAP DETECTED" src/anti-rug/detector.ts` returns 3 lines.
- `grep -n "antirug.backfill.too-late" src/anti-rug/detector.ts` returns 1 line.
- `grep -n "upsertChainState\|getChainState" src/anti-rug/detector.ts` shows both consumed.

</verification>

<success_criteria>

- Heartbeat ping/pong via ws@^8.20.0 — 30s interval, pong-or-die termination per ANTIRUG-12.
- Reconnect with exponential backoff (1s → 60s) per src/bot.ts precedent.
- Backfill via getLogsForBackfill (Plan 19-04a) — chunked per backfillCapBlocks.
- Backfill gap > maxBackfillBlocks → FAIL CLOSED per D-BACKFILL.
- Backfilled events NEVER fire live exits (tagged 'too-late').
- HTTP polling fallback when ctx.wsProvider === null.
- Tiered D-VIS-WS-HEALTH alerts: 3-failed-reconnects, >60s-disconnect, GAP DETECTED — each fires AT MOST ONCE per event window with the verbatim message format per CONTEXT.md.
- chain_state.last_seen_block updated after every backfill and after every HTTP poll.

</success_criteria>

<output>
Create `.planning/phases/19-anti-rug-runtime-monitoring/19-04c-SUMMARY.md` when done. Cover: the heartbeat interval choice (30s default), the reconnect backoff curve (1s → 60s), the exact wording of the 3 D-VIS-WS-HEALTH alerts (verbatim), the backfill gap-detected fail-closed branch behavior, the HTTP polling fallback poll interval (matches bot.ts:758-810 precedent), and any test-infrastructure surprises with fake timers + WS mock.
</output>
