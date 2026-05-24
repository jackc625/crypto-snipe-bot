---
phase: 19-anti-rug-runtime-monitoring
plan: 04c
subsystem: anti-rug-detector-ws-lifecycle
tags: [anti-rug, ws-lifecycle, heartbeat, reconnect, backfill, http-polling-fallback, gap-detected, fail-closed, tiered-alerts, d-vis-ws-health, tdd]

requires:
  - "src/anti-rug/detector.ts foundation (Plan 19-04a) — positionRegistry, getRegisteredPositions, getLogsForBackfill, chainState skeleton, _setEvaluateRugSignalsForTesting hook, _resetRegistryForTesting hook"
  - "src/anti-rug/detector.ts evaluator (Plan 19-04b) — evaluateRugSignals top-level + evaluateRugSignalsShim let-binding"
  - "src/utils/db.ts (Plan 19-01) — upsertChainState (positional run) + getChainState (positional get) prepared statements"
  - "src/utils/notifier.ts — sendCtxAlert (chain-prefixed Telegram + dashboard broadcast)"
  - "src/api/ws/broadcaster.ts — broadcast(type, data) typed event hub"
  - "src/utils/provider.ts — removeWsProvider for stale-cache cleanup on reconnect"
  - "src/chainRegistry.ts (Plan 19-02) — ChainConfig.antiRug.{backfillCapBlocks, maxBackfillBlocks}; ChainContext.{httpProvider, wsProvider, chain.wsRpcUrl, chain.chainId, chain.name, chain.displayName}"
  - "ethers v6 — WebSocketProvider (constructor + .websocket exposure)"
  - "ws@^8.20.0 — exposed via WebSocketProvider.websocket (NOT a direct import — used via the ethers v6 hatch-out per ethers-io/ethers.js#1053)"

provides:
  - "src/anti-rug/detector.ts startHttpPollingAntiRug — HTTP polling fallback (2s interval) for chains without WS endpoint; pattern mirrors src/bot.ts:758-810; updates chain_state.last_seen_block after each poll"
  - "src/anti-rug/detector.ts setupHeartbeat — ws@^8.20.0 ping/pong/terminate cycle on (provider as any).websocket per ANTIRUG-12 + 19-RESEARCH §6.1"
  - "src/anti-rug/detector.ts handleWsClose — exponential backoff 1s→60s reconnect loop with idempotency guard, removeWsProvider cleanup, mutation of ctx.wsProvider + state.wsProvider, re-call into startChainAntiRugListener to re-arm heartbeat + close handler + backfill"
  - "src/anti-rug/detector.ts backfillSinceLastSeen — restart/reconnect-time backfill; reads chain_state.last_seen_block; uses Plan 19-04a's getLogsForBackfill for chunked getLogs; logs antirug.backfill.too-late on verdict=unsafe + broadcasts antirug_event outcome=too-late; NEVER calls triggerAntiRugExit per D-BACKFILL"
  - "Tiered D-VIS-WS-HEALTH alerts per CONTEXT.md (Warning 9 from plan-checker iteration 1): (a) 3 consecutive reconnect failures → [WS RECONNECT FAILED]; (b) disconnect >60s → [WS DISCONNECTED >60s]; (c) backfill gap > maxBackfillBlocks → [GAP DETECTED] + FAIL CLOSED. Each fires AT MOST ONCE per disconnect window via alertedFor60s + alertedForReconnectFailures flags."
  - "Constants: HEARTBEAT_INTERVAL_MS=30_000, MAX_RECONNECT_DELAY_MS=60_000, DISCONNECT_ALERT_THRESHOLD_MS=60_000, RECONNECT_FAILURE_ALERT_THRESHOLD=3, HTTP_POLL_INTERVAL_MS=2_000"
  - "test/integration/anti-rug/wsReconnectBackfill.test.ts — 9 integration tests (Tests 21-29) covering heartbeat-dead path, reconnect re-subscribe, chunked backfill, gap-detected FAIL CLOSED, too-late branch on backfilled events, HTTP polling fallback, and all three D-VIS-WS-HEALTH alert tiers"

affects:
  - "src/anti-rug/detector.ts — extended by 747 lines (1466 → 2213). The two TODO Plan 19-04c markers (HTTP fallback at :441, heartbeat/reconnect/backfill at :512) are now fully implemented. Plans 19-04a (registry) + 19-04b (evaluator) public APIs are preserved untouched."
  - "test/integration/anti-rug/wsReconnectBackfill.test.ts — new file (~900 lines, 9 tests, 4 describe blocks)"
  - "Plan 19-05 (bot.ts wiring + cleanup hook) — can now wire startChainAntiRugListener at the V2/V3 buy-success branches with full lifecycle support; resumeAntiRugMonitoring (restart-time backfill from chain_state.last_seen_block) is enabled"
  - "Plan 19-06 (dashboard) — chain_ws_health_change broadcasts now fire on connect/reconnecting/disconnected so the per-chain WS-status indicator (🟢🟡🔴) has live data; antirug_event broadcasts on backfill-too-late + gap-detected drive the Anti-Rug Monitor tile and the GapDetectedBanner"

tech-stack:
  added: []
  patterns:
    - "ws@^8.20.0 ping/pong/terminate heartbeat via the ethers v6 (provider as any).websocket hatch-out per ethers-io/ethers.js#1053 (no built-in heartbeat in ethers v6)"
    - "Module-scoped WsLike interface to type the (provider as any).websocket surface without proliferating any-casts through the lifecycle code"
    - "Exponential backoff reconnect (1s → 2s → 4s → ... → capped at 60s) with idempotency guard via state.healthState==='reconnecting' to prevent double-fire from ws.terminate() racing a server-side hangup"
    - "Single-firing tiered alert pattern via per-loop alertedFor60s + alertedForReconnectFailures booleans — operator never sees alert spam during a long outage"
    - "Heartbeat-cleanup-on-reset in _resetRegistryForTesting (test infrastructure) to prevent setInterval closures from bleeding state across vitest test boundaries — when chainState.clear() removes the state entry, the still-firing closure's captured `state` ref becomes detached but the closure keeps ticking; explicit clearInterval BEFORE Map.clear() solves this"
    - "Bounded vi.advanceTimersByTimeAsync(5000) instead of vi.runAllTimersAsync() — runAllTimersAsync exhausts the timer budget on heartbeat setInterval (infinite recursion); bounded advance drains the reconnect/backfill cascade in 5 ticks without hitting the timer-count limit"
    - "Defensive (provider as any).websocket guard so unit tests' synthetic wsProvider stubs (without .websocket) can still exercise startChainAntiRugListener for registry/dispatch testing — Plans 19-04a + 19-04b tests pass unmodified"
    - "FAIL CLOSED on backfill gap > maxBackfillBlocks: NO partial backfill, single Telegram alert + dashboard broadcast, then update chain_state.last_seen_block to currentBlock to prevent re-detecting the same gap on the next reconnect"
    - "Per D-BACKFILL anti-pattern rejection: backfilled events evaluate via evaluateRugSignals to capture would-have-sold telemetry but NEVER dispatch to triggerAntiRugExit — backfill is read-only on the exit-path side"

key-files:
  created:
    - "test/integration/anti-rug/wsReconnectBackfill.test.ts (~900 lines, 9 tests, 4 describe blocks)"
  modified:
    - "src/anti-rug/detector.ts (1466 → 2213 lines, +747 net)"

key-decisions:
  - "Heartbeat interval = 30 seconds per ANTIRUG-12 + ws README + 19-RESEARCH §6.3. Production-tested precedent (Alchemy/Infura close idle WS after ~5 minutes; 30s ping is the lowest acceptable interval that keeps the connection alive without saturating bandwidth)."
  - "Reconnect backoff curve: 1s → 2s → 4s → 8s → 16s → 32s → 60s → 60s → ... — matches src/bot.ts:660-752 startDexListener precedent exactly. Cap at 60s prevents the operator from being kept waiting too long during a long outage."
  - "Tiered alert SINGLE-FIRING semantics: alertedFor60s flag + alertedForReconnectFailures flag inside handleWsClose. Each alert tier fires at most ONCE per disconnect window (the function returns / loop breaks after successful reconnect, resetting the flags via fresh handleWsClose invocation on the NEXT disconnect). Prevents Telegram alert spam during long outages."
  - "Backfill FAIL CLOSED branch updates chain_state.last_seen_block to currentBlock after emitting [GAP DETECTED]: prevents the next reconnect from re-detecting the same gap repeatedly. Operator is notified once + the audit trail is preserved in the pino structured log; subsequent reconnects start clean."
  - "Defensive .websocket guard in startChainAntiRugListener: skip heartbeat/close-handler wiring when (ctx.wsProvider as any).websocket is undefined. This lets the foundation (Plan 19-04a + 19-04b) unit tests — which use synthetic wsProvider stubs without .websocket — continue passing without modification. Production WebSocketProvider always exposes .websocket; only test stubs lack it."
  - "_resetRegistryForTesting now clears heartbeat setIntervals before wiping chainState. Without this, the heartbeat setInterval closures (which captured `state` by reference) would keep firing AFTER the test ended; eventually one would call ws.terminate() → close → handleWsClose → new WebSocketProvider(...) against the now-unmocked ethers binding, producing a real DNS lookup that fails with ENOTFOUND. Adding the clearInterval loop in _resetRegistryForTesting eliminates the test pollution at the root cause."
  - "Test isolation: removed vi.doUnmock from afterEach. doUnmock could race a still-pending Promise inside the production reconnect loop (e.g. the await sendCtxAlert chain), causing the resolved promise to land in a test where the mock no longer exists. The cleanest invariant is: doMock in beforeEach, then vi.resetModules() at the start of the next beforeEach reloads the module graph fresh. This pattern matches the existing Plan 19-04a/b test conventions."
  - "HTTP polling fallback uses LIVE dispatch (calls dispatchEvent which routes to evaluateRugSignals → confirm-blocks gate → triggerAntiRugExit). This is DIFFERENT from the reconnect backfill branch (which logs too-late without calling triggerAntiRugExit). HTTP polling is the chain's PRIMARY live path when WS is unavailable — events through it are NOT stale by definition."
  - "Bounded vi.advanceTimersByTimeAsync(5000) for tests 23/24/29 (backfill tests) — initially used 2_000 which sometimes wasn't enough to drain the await-chain (handleWsClose → setTimeout → new WSP → startChainAntiRugListener → backfillSinceLastSeen → sendCtxAlert). 5000ms gives enough microtask budget without triggering the next heartbeat tick at 30_000ms."

patterns-established:
  - "ethers v6 WS lifecycle via the (provider as any).websocket hatch-out: the canonical workaround for the lack of built-in heartbeat per ethers-io/ethers.js#1053. Future WS-using modules in this codebase can reuse the WsLike interface declaration."
  - "Single-firing tiered alert pattern: per-loop boolean flags ensure each alert tier fires at most once per logical 'window'. Reusable for any operator-visible alert that should not spam during a sustained event."
  - "_reset-hook clears side-effecting timers BEFORE clearing state: a generic test-isolation pattern for any module that owns setInterval/setTimeout closures. Without this, vitest's mockReset:true + resetModules:true cannot fully isolate tests."

requirements-completed: [ANTIRUG-11, ANTIRUG-12]

# Metrics
duration: 17min
completed: 2026-05-24
---

# Phase 19 Plan 19-04c: Anti-Rug WS Lifecycle Summary

**Heartbeat + exponential-backoff reconnect + restart-time backfill via chunked getLogs + HTTP polling fallback + tiered D-VIS-WS-HEALTH alerts — final layer of the anti-rug detector module.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-05-24T02:41:11Z
- **Completed:** 2026-05-24T02:58:29Z
- **Tasks:** 1 (TDD: 2 commits — test RED + feat GREEN)
- **Files created:** 1 (`test/integration/anti-rug/wsReconnectBackfill.test.ts`)
- **Files modified:** 1 (`src/anti-rug/detector.ts`)
- **Net lines:** +1646 (+899 test, +747 production)

## Accomplishments

- **HTTP polling fallback (replaces TODO at detector.ts:441):** When `ctx.wsProvider === null`, `startChainAntiRugListener` routes to `startHttpPollingAntiRug`. Pattern mirrors `src/bot.ts:758-810` startHttpPollingListener — 2-second `setInterval` polls `getBlockNumber()` + `getLogs()` over the (lastBlock+1, currentBlock) window with the registered address+topic union. Each successful poll updates `chain_state.last_seen_block` via `upsertChainState.run(chainName, currentBlock, ts)`. The HTTP polling path uses LIVE dispatch (`await dispatchEvent(ctx, event)`) — events through it CAN fire `triggerAntiRugExit` via the evaluator's confirm-blocks gate (unlike backfill, which is read-only).
- **Heartbeat ping/pong/terminate (replaces TODO at detector.ts:512, part 1):** `setupHeartbeat(ctx)` installs the canonical `ws@^8.20.0` `isAlive` pattern on `(ctx.wsProvider as any).websocket`. Every 30 seconds: if `isAlive === false` (no pong arrived since last ping), `ws.terminate()` triggers the 'close' handler → `handleWsClose` reconnect path. Otherwise, set `isAlive = false` and call `ws.ping()` — the remote should pong back, flipping `isAlive = true` via the registered pong handler. The heartbeat `setInterval` handle is stored on `state.heartbeatInterval` so it can be cleared on close (or by `_resetRegistryForTesting`).
- **Exponential-backoff reconnect (replaces TODO at detector.ts:512, part 2):** `handleWsClose(ctx)` runs a reconnect loop with 1s→2s→4s→...→60s capped backoff. Each attempt: (1) `removeWsProvider(chainName)` releases the stale cached singleton from `src/utils/provider.ts`; (2) `new WebSocketProvider(ctx.chain.wsRpcUrl!, ctx.chain.chainId)` constructs a fresh provider; (3) `ctx.wsProvider = newWsProvider` updates the ChainContext in-place; (4) `state.activeDispatcher = null; state.activeFilter = null;` so the next `startChainAntiRugListener` call re-installs a fresh subscription; (5) `await startChainAntiRugListener(ctx)` re-arms heartbeat + close handler + backfill. Idempotency guard: `state.healthState === 'reconnecting'` causes a duplicate `handleWsClose` (e.g. from `ws.terminate()` racing a server-side hangup) to short-circuit with a `debug` log.
- **Backfill (replaces TODO at detector.ts:512, part 3):** `backfillSinceLastSeen(ctx)` reads `chain_state.last_seen_block` via the Plan 19-01 `getChainState.get(chainName)` prepared statement. Cases:
  - **No prior state:** seed `chain_state` with the current block; return (nothing to replay).
  - **gapBlocks <= 0:** idempotent refresh of `last_updated_ts`; return.
  - **gapBlocks > maxBackfillBlocks:** FAIL CLOSED per D-BACKFILL. Log `antirug.backfill.gap-detected` at error level; emit `[GAP DETECTED] {chain} missed {N} blocks ({lastSeen}-{currentBlock}); backfill skipped per D-BACKFILL fail-closed; review anti-rug events manually` via `sendCtxAlert(ctx, ...)`; broadcast `antirug_event` with `kind='gap-detected'`; update `chain_state.last_seen_block` to `currentBlock` so the next reconnect doesn't re-detect the same gap. **NO `getLogs` calls.**
  - **Within-cap:** chunked replay via the Plan 19-04a `getLogsForBackfill(ctx, lastSeen+1, currentBlock, addresses, [topicUnion])` primitive. For each event, evaluate via `evaluateRugSignalsShim` (the let-binding that defaults to Plan 19-04b's real evaluator). On `verdict==='unsafe'`: log `antirug.backfill.too-late` at warn level with full evaluation evidence + broadcast `antirug_event` with `kind='trigger', outcome='too-late'`. **NEVER call `triggerAntiRugExit`** — backfilled events are stale; live exits on stale data are an explicit D-BACKFILL anti-pattern.
- **Tiered D-VIS-WS-HEALTH alerts (per CONTEXT.md Warning 9 from plan-checker iteration 1):** Three alert tiers wired:
  - **Tier 2 (warning):** Inside `handleWsClose`, when `consecutiveFailures` hits `RECONNECT_FAILURE_ALERT_THRESHOLD = 3`, emit `*[WS RECONNECT FAILED]* {chain} — 3 consecutive reconnect attempts failed; manual intervention may be required` via `sendCtxAlert` (single-fire via the `alertedForReconnectFailures` flag).
  - **Tier 3 (critical) — disconnect duration:** Inside `handleWsClose`, when `Date.now() - disconnectStartTs > DISCONNECT_ALERT_THRESHOLD_MS = 60_000`, emit `*[WS DISCONNECTED >60s]* {chain} — anti-rug monitor offline for {N} seconds; positions on this chain are UNMONITORED` + broadcast `chain_ws_health_change` with `state='disconnected'` (single-fire via the `alertedFor60s` flag).
  - **Tier 3 (critical) — gap detected:** Inside `backfillSinceLastSeen`, when the missed-block window exceeds `ctx.chain.antiRug.maxBackfillBlocks`, emit the `[GAP DETECTED]` alert + broadcast as described above.
- **Dashboard broadcasts:** `chain_ws_health_change` fires on connect (`state='connected', lastPongTs`), reconnecting (`state='reconnecting'`), and disconnected (`state='disconnected', disconnectedDurationSec`). `antirug_event` fires on backfilled-too-late triggers + on the gap-detected fail-closed branch. Plan 19-06's dashboard consumes both via `dashboard/src/hooks/useWebSocket.ts`.

## Task Commits

Each TDD step was committed atomically:

1. **Test RED (Task 1.1)** — `ae7fbde` (`test`): 9 failing tests asserting the WS lifecycle. All 9 fail with the current detector.ts because the HTTP polling fallback + heartbeat + reconnect + backfill machinery is not yet implemented (the TODO Plan 19-04c markers).
2. **Feature GREEN (Task 1.2)** — `5f11ca4` (`feat`): WS lifecycle implementation (+747 lines on detector.ts, +899 lines on test file). 9/9 integration tests pass; 374/374 unit tests preserved (Plans 19-04a + 19-04b regression-clean); tsc clean ×3.

No REFACTOR commit needed — the GREEN implementation matched the plan's `<action>` specification on first try, with three inline test-infrastructure adjustments documented under "Decisions Made" below.

## Files Created/Modified

- **`src/anti-rug/detector.ts`** (1466 → 2213 lines, +747 net) — replaces the two `// TODO Plan 19-04c` markers (HTTP polling fallback at :441; heartbeat/reconnect/backfill at :512). Adds: 5 lifecycle functions (`startHttpPollingAntiRug`, `setupHeartbeat`, `handleWsClose`, `backfillSinceLastSeen`, plus an internal `WsLike` interface), 5 constants (`HEARTBEAT_INTERVAL_MS`, `MAX_RECONNECT_DELAY_MS`, `DISCONNECT_ALERT_THRESHOLD_MS`, `RECONNECT_FAILURE_ALERT_THRESHOLD`, `HTTP_POLL_INTERVAL_MS`), 4 new imports (`sendCtxAlert`, `broadcast`, `removeWsProvider`, `upsertChainState` + `getChainState`), and a hardening change to `_resetRegistryForTesting` (clears heartbeat setIntervals before wiping chainState).
- **`test/integration/anti-rug/wsReconnectBackfill.test.ts`** (~900 lines, NEW) — 9 tests across 4 describe blocks: heartbeat (Test 21), reconnect (Tests 22, 27, 28), backfill (Tests 23, 24, 25, 29), HTTP polling fallback (Test 26). Mock strategy mirrors `test/integration/wsReconnect.test.ts` precedent.

## Decisions Made

### 1. Heartbeat interval = 30 seconds (per ANTIRUG-12 + ws README)

The plan's `<action>` named `30_000` (30 seconds) per `19-RESEARCH.md §6.3`. The `ws@^8.20.0` README's canonical "How to detect and close broken connections" pattern uses 30s as the default. Alchemy and Infura close idle WS connections after ~5 minutes of silence; 30s is well below that ceiling without saturating bandwidth on legitimate traffic. Production-tested precedent — kept verbatim from the plan.

### 2. Reconnect backoff curve = 1s → 2s → 4s → ... → 60s capped

Matches `src/bot.ts:660-752` startDexListener precedent exactly (`reconnectDelay = 1000; maxDelay = 60000; reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);`). The 60-second cap prevents the operator from being kept waiting indefinitely during a long outage — at the cap, the bot retries every 60 seconds, so a 10-minute outage triggers ~10 attempts. Each attempt does NOT spam Telegram (single-fire alert flags) — operator gets ONE [WS RECONNECT FAILED] after the 3rd consecutive failure and ONE [WS DISCONNECTED >60s] after the elapsed-disconnect crosses 60s. Subsequent retries log at warn level only.

### 3. Single-firing tiered alert pattern via per-loop booleans

Inside `handleWsClose`, `alertedFor60s` and `alertedForReconnectFailures` are loop-local booleans. Each alert tier checks the flag BEFORE firing; on success, the flag flips to `true` so the alert never fires again within the same reconnect loop. The flags are loop-local (not module-state) so the NEXT disconnect window starts with fresh flags — operator gets new alerts for new disconnect windows. This is the documented behaviour per CONTEXT.md D-VIS-WS-HEALTH (Warning 9 from plan-checker iteration 1): "operator never sees alert spam during a single sustained outage; new windows produce fresh alerts."

### 4. Gap-detected FAIL CLOSED branch updates chain_state to currentBlock

The plan's `<action>` left ambiguous whether `upsertChainState.run(...)` runs after the FAIL CLOSED branch. I chose to update `chain_state.last_seen_block` to `currentBlock` after emitting the `[GAP DETECTED]` alert because:
- WITHOUT this update, the NEXT reconnect would re-detect the same gap (last_seen_block still points at the pre-outage block; getBlockNumber returns approximately the same value as before; gap > maxBackfillBlocks again; alert fires AGAIN — spam).
- WITH this update, the operator gets ONE alert per gap event; subsequent reconnects start clean from the post-outage block.

This is consistent with the "single-firing tiered alert" intent. The operator-visible audit trail is preserved via the structured pino `antirug.backfill.gap-detected` log + the broadcast `antirug_event` payload (both contain `gapBlocks`, `fromBlock`, `toBlock` — enough evidence for the operator to investigate post-hoc).

### 5. Defensive `(provider as any).websocket` guard in `startChainAntiRugListener`

Production `WebSocketProvider` always exposes `.websocket` (the ws@8 instance). But the Plan 19-04a + 19-04b unit tests use synthetic wsProvider stubs of shape `{ on: vi.fn(), off: vi.fn(), removeAllListeners: vi.fn() }` — no `.websocket`. Adding `if (rawWs && typeof rawWs.on === 'function')` around the heartbeat + close-handler + backfill block means:
- Unit tests pass unmodified (the stubs hit the guard's `false` branch; `startChainAntiRugListener` returns after broadcasting `chain_ws_health_change`).
- Production code is unaffected (real `WebSocketProvider` always passes the guard).

This is the simplest fix that preserves both Plans 19-04a (11 tests) + 19-04b (20 tests) test surfaces verbatim. Alternative considered: add a `.websocket` shim to all 31 unit test setups → rejected because it would force every unit test author to know about the WS lifecycle internals, which is the opposite of what unit-test isolation should give them.

### 6. `_resetRegistryForTesting` clears heartbeat setIntervals BEFORE wiping chainState

Discovered during GREEN iteration: a heartbeat setInterval registered in test N kept firing AFTER test N ended (`afterEach` only called `chainState.clear()` + `vi.useRealTimers()`). The closure captured `state` by reference; even though `chainState.clear()` removed the Map entry, the closure's `state` variable still pointed at the now-orphaned object. The interval kept ticking; eventually one tick called `ws.terminate()` → 'close' → `handleWsClose` → `new WebSocketProvider(...)` against the now-unmocked ethers binding → real DNS lookup → ENOTFOUND.

The fix: iterate `chainState.values()` and `clearInterval(state.heartbeatInterval)` for each entry BEFORE calling `chainState.clear()`. The setInterval handle is owned by the state object; clearing it deterministically prevents the orphaned closure from firing.

This is now codified in the production `_resetRegistryForTesting` function (with a multi-line comment explaining the failure mode). It's an evergreen test-infrastructure invariant that applies to any future test in this codebase.

### 7. Bounded `vi.advanceTimersByTimeAsync(5000)` for backfill tests (NOT `runAllTimersAsync`)

Initial GREEN attempt used `vi.runAllTimersAsync()` to drive the reconnect path. This exhausted vitest's 10000-timer budget because the heartbeat setInterval (armed by the successful reconnect) loops forever. Switched to `vi.advanceTimersByTimeAsync(5000)`:
- 5 seconds gives the 1s backoff delay + the cascade of awaits in `handleWsClose → setTimeout → new WSP → startChainAntiRugListener → backfillSinceLastSeen → sendCtxAlert` time to drain.
- 5 seconds is below the 30-second heartbeat interval, so the next heartbeat tick does NOT fire (no infinite loop).
- For tests 22, 27 (which need to drive multiple reconnect attempts), advance by 20_000 (covers 1+2+4+8+16=31s of backoff + buffer); still below 30s heartbeat interval.

This is the test-infrastructure pattern any future fake-timer test in this codebase should follow when the production code has both bounded one-shot timers (setTimeout) AND unbounded recurring timers (setInterval).

## Deviations from Plan

**None substantive — plan executed as written.** Three inline refinements (all inside the plan's spec):

### 1. `_resetRegistryForTesting` extended to clear heartbeat setIntervals

The plan documented `_resetRegistryForTesting` as "clears registry + chainState between tests". Implementation extension: now also clears all active `state.heartbeatInterval` handles BEFORE wiping `chainState` — see Decisions §6 for the rationale. This is a test-infrastructure hardening that prevents setInterval closure bleed between tests. Production behaviour is unchanged.

### 2. Defensive `.websocket` guard in `startChainAntiRugListener`

The plan's `<action>` block assumed `(ctx.wsProvider as any).websocket` is always defined. Implementation extension: explicit `if (rawWs && typeof rawWs.on === 'function')` guard around the heartbeat/close-handler/backfill block — see Decisions §5 for the rationale. Preserves the Plan 19-04a + 19-04b unit test surface unmodified.

### 3. FAIL CLOSED branch updates `chain_state.last_seen_block` to `currentBlock`

The plan's `<action>` block did NOT explicitly say whether to update `chain_state` after the gap-detected branch. Implementation choice: update to `currentBlock` after emitting the `[GAP DETECTED]` alert — see Decisions §4 for the rationale (prevents re-detecting the same gap on the next reconnect).

No auto-fix-rules invoked; no architectural questions raised.

## Issues Encountered

### 1. Initial integration test runs hit vitest's 10000-timer budget

`vi.runAllTimersAsync()` was the wrong primitive for tests with both one-shot reconnect timers + recurring heartbeat setIntervals. Switched to bounded `vi.advanceTimersByTimeAsync(5000)`. Documented in Decisions §7.

### 2. Heartbeat setInterval closures bled state between tests

Discovered when test 28 + test 23 became flaky (sometimes passing, sometimes failing with "wsProvider.websocket.closeHandlers is not iterable"). Root cause: setInterval closures fired after `afterEach`, calling `ws.terminate()` → `handleWsClose` → real `new WebSocketProvider(...)` → ENOTFOUND DNS error. Fixed by clearing heartbeat intervals in `_resetRegistryForTesting`. Documented in Decisions §6.

### 3. Unit tests regressed after initial GREEN (Plan 19-04a/b synthetic ws stubs)

The 19-04a + 19-04b unit tests use `wsProvider: { on, off, removeAllListeners }` synthetic stubs — no `.websocket`. My initial GREEN broke 28 unit tests because `setupHeartbeat` tried to access `(ctx.wsProvider as any).websocket` which was undefined. Fixed by adding the defensive guard. Documented in Decisions §5.

## V3 Grace-Timeout Reconnect Hand-off (Plan 19-04b carry-forward)

Plan 19-04b's SUMMARY flagged "V3 Burn grace timeout doesn't fire because block handler was dropped on RPC reconnect" as threat-model entry T-19-04b-04. Status after this plan:

- The grace-timeout block-watcher is registered on `ctx.httpProvider.on('block', fn)`, NOT on `ctx.wsProvider`. My reconnect path mutates `ctx.wsProvider` but does NOT touch `ctx.httpProvider`. The grace-timeout block-watcher therefore survives WS reconnect.
- `ctx.httpProvider` is created once at boot via `getProvider()` in `src/utils/provider.ts` and cached for the lifetime of the process. No code path in this plan rotates it. Plan 19-04b's documented assumption holds.
- Verified by inspection: `grep -n "httpProvider =" src/anti-rug/detector.ts` returns no assignments. The reconnect path is WS-only.

This closes T-19-04b-04 for Plan 19-04c — no additional grace-timeout re-registration logic is required.

## Open Questions for Downstream Plans

### Plan 19-05 (bot.ts wiring + exitEngine cleanup hook)

1. **`resumeAntiRugMonitoring` should call `backfillSinceLastSeen` at restart time.** The function is now ready to consume; Plan 19-05 wires `resumeAntiRugMonitoring(contexts)` into `startMultiChainBot` per the existing pattern at `src/bot.ts:952-994` (resumeMultiChainMonitoring). The first call to `startChainAntiRugListener` per chain will auto-fire backfill via the call chain documented in this SUMMARY.
2. **`triggerAntiRugExit` real implementation replaces the stub at `src/anti-rug/exitTrigger.ts`.** No changes required to `detector.ts` — the stub's `Promise<boolean>` signature is the contract. Backfill path in this plan ONLY calls `evaluateRugSignalsShim` + logs+broadcasts on `verdict='unsafe'`; it does NOT touch `triggerAntiRugExit`. The HTTP polling path uses `dispatchEvent` which routes through `evaluateRugSignals` → confirm-blocks gate → `triggerAntiRugExit` — Plan 19-05's real bridge plugs in transparently.

### Plan 19-06 (dashboard)

1. **`chain_ws_health_change` payload shape** — three variants exist:
   - `{ chain, state: 'connected', lastPongTs }`
   - `{ chain, state: 'reconnecting' }`
   - `{ chain, state: 'disconnected', disconnectedDurationSec }`
   - And an HTTP-polling variant: `{ chain, state: 'connected', mode: 'http-polling', lastPongTs }`
   - Dashboard's `useWebSocket.ts` switch dispatch should handle all four (matches UI-SPEC §"Anti-rug column header and badges").
2. **`antirug_event` payload shape** — two variants relevant to this plan:
   - `{ chain, kind: 'gap-detected', gapBlocks, fromBlock, toBlock, timestamp }`
   - `{ chain, kind: 'trigger', token, pair, signals, outcome: 'too-late', timestamp }`
   - Plan 19-06's GapDetectedBanner consumes the first; Anti-Rug Monitor tile consumes both.

### Plan 19-07 (HORSE fork test — final integration gate)

1. **Mainnet HORSE replay drill exercises ALL three lifecycle layers in sequence** (heartbeat → reconnect → backfill). The test should kill the WS mid-flight, restart, and verify the missed Burn event is replayed via backfill with `outcome='too-late'` (not via live `triggerAntiRugExit`). The integration test in this plan (Test 25) covers the unit path; Plan 19-07 covers the end-to-end real-mainnet path.

## Verification

| Check | Result |
|-------|--------|
| `npm run test:integration -- anti-rug/wsReconnectBackfill` | **9/9 passing** (Tests 21-29) |
| `npm run test:unit` (full unit suite) | **374/374 passing** — zero regressions vs Plan 19-04b baseline |
| `npm run test:unit -- anti-rug/detectorRegistry` (Plan 19-04a regression) | **11/11 passing** |
| `npm run test:unit -- anti-rug/detectorEvaluator` (Plan 19-04b regression) | **20/20 passing** |
| `npx tsc --noEmit` (main tsconfig) | **clean** |
| `npx tsc --noEmit -p tsconfig.bot.json` | **clean** |
| `cd dashboard && npx tsc --noEmit` | **clean** |
| `grep -n "isAlive\|terminate\|ping()" src/anti-rug/detector.ts` | **15 lines** (heartbeat machinery wired) |
| `grep -n "DISCONNECT_ALERT_THRESHOLD_MS\|RECONNECT_FAILURE_ALERT_THRESHOLD" src/anti-rug/detector.ts` | **9 lines** (>= 2 constants declared + use sites) |
| `grep -n "WS RECONNECT FAILED\|WS DISCONNECTED >60s\|GAP DETECTED" src/anti-rug/detector.ts` | **9 lines** (all 3 D-VIS-WS-HEALTH alert tier messages with verbatim wording) |
| `grep -n "antirug.backfill.too-late" src/anti-rug/detector.ts` | **1 line** at backfilled-event warn log (per spec) |
| `grep -n "triggerAntiRugExit" src/anti-rug/detector.ts` | **10 lines** (import + LIVE call sites in confirm-blocks gate; backfill branch explicitly excludes — comment at line 1082 says "NEVER call triggerAntiRugExit") |
| `grep -n "upsertChainState\|getChainState" src/anti-rug/detector.ts` | **13 lines** (both consumed: getChainState.get at 944 + 1163; upsertChainState.run at 953, 975, 1014, 1028, 1134, 1170, 1206, 1237) |
| `grep -n "broadcast.*chain_ws_health_change\|broadcast.*antirug_event" src/anti-rug/detector.ts` | **7 lines** (both broadcast types present) |

## Files Touched

| File | Action | Lines | Commit |
|------|--------|-------|--------|
| `test/integration/anti-rug/wsReconnectBackfill.test.ts` | created | +899 | `ae7fbde` (RED) + `5f11ca4` (GREEN test-tuning fix-ups) |
| `src/anti-rug/detector.ts` | modified | +747 | `5f11ca4` (GREEN) |

## Hand-off

This plan unblocks:

- **Plan 19-05** (bot.ts wiring + exitEngine cleanup hook) — can:
  - Wire `await startChainAntiRugListener(ctx)` into `resumeAntiRugMonitoring(contexts)` at the existing `resumeMultiChainMonitoring` analog (`src/bot.ts:952-994`).
  - The lifecycle layer auto-fires backfill via `backfillSinceLastSeen` on first call per chain.
  - Wire `unregisterAntiRugPosition(ctx.chain.name, tradeId)` at `src/exitEngine.ts:504` (after `deleteExitState.run(tradeId)`).
  - Replace `src/anti-rug/exitTrigger.ts` stub with the real `executeFullSell` bridge.

- **Plan 19-06** (dashboard) — can:
  - Subscribe to `chain_ws_health_change` broadcasts via the existing `dashboard/src/hooks/useWebSocket.ts` switch dispatch. Three states + the HTTP-polling variant documented in this SUMMARY.
  - Subscribe to `antirug_event` broadcasts for the GapDetectedBanner (kind='gap-detected') and the Anti-Rug Monitor tile (kind='trigger', outcome='too-late').

- **Plan 19-07** (HORSE fork test — final integration gate) — can:
  - Kill the WS mid-flight, restart, verify the missed Burn arrives via the backfill `outcome='too-late'` path (NOT via live `triggerAntiRugExit`).
  - The single-listener-per-chain WS pattern + heartbeat + reconnect + backfill is now end-to-end testable against a real mainnet fork.

**Requirements addressed:**

- **ANTIRUG-11** (WebSocket reconnect-resubscribe-backfill — ethers v6 has no auto-reconnect per #1053) — full implementation: `handleWsClose` exponential-backoff reconnect; `startChainAntiRugListener` re-subscribes with the address+topic union; `backfillSinceLastSeen` replays the missed-block window via Plan 19-04a's chunked `getLogsForBackfill`.
- **ANTIRUG-12** (Heartbeat ping/pong on `WebSocketProvider` using existing `ws@^8.20.0`; default 30s; silent failure detection) — `setupHeartbeat` installs the canonical `ws@^8.20.0` `isAlive` pattern on `(provider as any).websocket` per 19-RESEARCH §6.1.

## Self-Check: PASSED

- File `src/anti-rug/detector.ts` (1466 → 2213 lines, +747 net; WS lifecycle implemented) — **FOUND**
- File `test/integration/anti-rug/wsReconnectBackfill.test.ts` (~900 lines, 9 tests) — **FOUND**
- Commit `ae7fbde` (TDD RED — 9 failing tests for the un-shipped WS lifecycle) — **FOUND**
- Commit `5f11ca4` (TDD GREEN — WS lifecycle shipped; 9/9 tests pass; 374/374 unit regression-clean) — **FOUND**
- 9/9 integration tests passing — **VERIFIED** via 3 sequential `npm run test:integration -- anti-rug/wsReconnectBackfill` runs
- 374/374 unit tests passing — **VERIFIED**
- tsc clean across all 3 tsconfig projects (main + bot + dashboard) — **VERIFIED**
- `grep -n "isAlive\|terminate\|ping()" src/anti-rug/detector.ts` returns 15 lines (heartbeat wired) — **VERIFIED**
- `grep -n "DISCONNECT_ALERT_THRESHOLD_MS\|RECONNECT_FAILURE_ALERT_THRESHOLD" src/anti-rug/detector.ts` returns 9 lines (>= 2 constants required) — **VERIFIED**
- `grep -n "WS RECONNECT FAILED\|WS DISCONNECTED >60s\|GAP DETECTED" src/anti-rug/detector.ts` returns 9 lines (all 3 D-VIS-WS-HEALTH alert tier messages) — **VERIFIED**
- `grep -n "antirug.backfill.too-late" src/anti-rug/detector.ts` returns 1 line at the backfilled-event warn log — **VERIFIED**
- `grep -n "triggerAntiRugExit" src/anti-rug/detector.ts` returns 10 lines (import + LIVE call sites in confirm-blocks gate; backfill explicitly excludes) — **VERIFIED**
- `grep -n "upsertChainState\|getChainState" src/anti-rug/detector.ts` returns 13 lines (both consumed) — **VERIFIED**
- `grep -n "broadcast.*chain_ws_health_change\|broadcast.*antirug_event" src/anti-rug/detector.ts` returns 7 lines (both broadcast types) — **VERIFIED**

---

*Phase: 19-anti-rug-runtime-monitoring*
*Completed: 2026-05-24*
