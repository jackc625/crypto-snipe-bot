---
id: 19-04a
phase: 19-anti-rug-runtime-monitoring
plan: 04a
subsystem: anti-rug-detector-foundation
tags: [anti-rug, detector, position-registry, ws-subscription, topic-filter-union, getlogs-chunking, tdd, skeleton]
requires:
  - "src/anti-rug/types.ts — RegisteredPosition (inferred from LpBaselineRow + ChainConfig); LpBaselineRow domain shape (Plan 19-03)"
  - "src/anti-rug/events.ts — PAIR_BURN_TOPIC / PAIR_TRANSFER_TOPIC / POOL_BURN_TOPIC / POOL_COLLECT_TOPIC (Plan 19-03)"
  - "src/anti-rug/lpBaseline.ts — loadLpBaseline (Plan 19-03)"
  - "src/chainRegistry.ts — ChainContext + DexConfig + ChainConfig.antiRug.backfillCapBlocks (Plan 19-02)"
  - "ethers v6 — Log + WebSocketProvider types"
provides:
  - "src/anti-rug/detector.ts — FOUNDATION skeleton of the anti-rug detector module"
  - "registerAntiRugPosition / unregisterAntiRugPosition — position registry add/remove with baseline gating"
  - "startChainAntiRugListener — idempotent WS subscription skeleton with topic-filter union"
  - "getLogsForBackfill — chunked getLogs primitive (consumed by Plan 19-04c reconnect+backfill)"
  - "getRegisteredPositions — flat-list helper for backfill / dashboard / 19-04c resume path"
  - "RegisteredPosition exported type — Plan 19-04b's evaluateRugSignals signature consumes this shape"
  - "_setEvaluateRugSignalsForTesting + _resetRegistryForTesting — test hooks for the evaluator shim and registry-reset"
affects:
  - "src/anti-rug/ — adds detector.ts (634 lines); no existing files modified"
  - "test/unit/anti-rug/ — adds detectorRegistry.test.ts (705 lines, 11 tests)"
tech-stack:
  added: []  # No new packages — every import resolves to existing v6.17 stack
  patterns:
    - "Single-listener-per-chain WS subscription with topic-filter union (Pitfall #10 mitigation)"
    - "Drop+recreate filter rewiring on register/unregister (ethers v6 lacks filter-replace primitive)"
    - "Module-scoped `let evaluateRugSignals` shim with `_setEvaluateRugSignalsForTesting` injection hook (Plan 19-04b reassigns at module-import time)"
    - "Map<chain, Map<addr, Position[]>> registry shape — array bucket handles multi-position-same-pair without losing dispatch"
    - "Chunked getLogs with `chunkStart += cap` / `chunkEnd = min(chunkStart + cap - 1, toBlock)` — 6 chunks for [100,150] cap=10 (deliberate off-by-one to enforce 'cap blocks per call' Alchemy semantics)"
    - "Test-only registry reset via afterEach hook so per-chain state does not bleed between tests"
key-files:
  created:
    - "src/anti-rug/detector.ts (634 lines)"
    - "test/unit/anti-rug/detectorRegistry.test.ts (705 lines, 11 tests)"
  modified: []
decisions:
  - "evaluateRugSignals shim: module-scoped `let` with `_setEvaluateRugSignalsForTesting` injection. Plan 19-04b reassigns the let at module-import time when its real evaluator lands — same canonical mechanism as Phase 18 HoneypotChecker dispatch hooks."
  - "positionRegistry shape: Map<chain, Map<addr, Position[]>> — outer key chain.name (per-chain isolation), inner key lowercased pair/pool address, value ARRAY (handles multi-position-same-pair test 20)."
  - "WS subscription drop+recreate on register/unregister: explicit `wsProvider.off(activeFilter, activeDispatcher)` before `wsProvider.on(newFilter, newDispatcher)` so each chain has exactly ONE active subscription per Pitfall #10. ethers v6 has no filter-replace; multiple .on() calls would dispatch each event N times."
  - "Topic filter union covers all four V2 + V3 topics in a single subscription per chain — single dispatcher with poolType branching inside Plan 19-04b's evaluator (vs separate V2/V3 listeners which would still hit the per-chain WS cap)."
  - "getLogsForBackfill chunk boundary: `chunkEnd = min(chunkStart + cap - 1, toBlock)` and `chunkStart += cap` — 6 chunks for [100,150] cap=10. The plan's <behavior> 'Test A6' text named 5 chunks of 11 blocks but its <action> code block specified the 6-chunk math; the test enforces the unambiguous <action> shape."
  - "Errors in getLogsForBackfill chunks PROPAGATE — Plan 19-04c's caller handles the FAIL CLOSED [GAP DETECTED] branch per D-BACKFILL."
  - "Empty address list → startChainAntiRugListener returns early instead of installing an empty-filter subscription. Plan 19-04c reconsiders whether to keep an empty WS subscription alive across all-positions-closed scenarios."
metrics:
  duration_minutes: ~25
  tasks_completed: 1
  files_modified: 0
  files_created: 2
  tests_added: 11
  unit_tests_total_after: 354
  commits: 2
  completed_date: "2026-05-24"
---

# Phase 19 Plan 19-04a: Detector Registry + WS Skeleton + Chunked getLogs Summary

Land the FOUNDATION layer of `src/anti-rug/detector.ts` — the position-registry plumbing, the WS subscription skeleton with topic-filter union, the dispatch router, and the chunked `getLogs` primitive that Plan 19-04c's reconnect+backfill consumes. This is the API-stable foundation that Plans 19-04b (multi-signal evaluator) and 19-04c (WS lifecycle / heartbeat / reconnect / backfill / HTTP fallback) plug into.

## What Was Built

### `src/anti-rug/detector.ts` (634 lines, 7 public exports + 2 test hooks + 1 internal helper)

| Export | Shape | Purpose |
|--------|-------|---------|
| `RegisteredPosition` (interface) | `{ tradeId, chain, tokenAddress, pairOrPoolAddress, dex, feeTier, baseline, poolType }` | Plan 19-04b's `evaluateRugSignals` consumes this; Plan 19-04c's resume path consumes this. |
| `registerAntiRugPosition` | `async (ctx, dex, tokenAddress, pairOrPoolAddress, tradeId, feeTier) => void` | Loads baseline → builds RegisteredPosition → inserts into `positionRegistry[chain][addr]` array → ensures `chainState[chain]` skeleton record exists → calls `startChainAntiRugListener(ctx)` to (re)wire the WS filter. Skips silently with `log.error op='antirug.register.no-baseline'` if `loadLpBaseline(tradeId)` returns null. |
| `unregisterAntiRugPosition` | `(chain, tradeId) => void` | Iterates the inner Map of the chain; removes the matching tradeId from its address bucket; deletes the address key if the bucket becomes empty. No-op on non-existent tradeId. Does NOT tear down the WS subscription — Plan 19-04c's lifecycle handles that. |
| `startChainAntiRugListener` | `async (ctx) => void` | SKELETON. Idempotent: computes the address-union + topic-union → drops the prior dispatcher via `wsProvider.off(activeFilter, activeDispatcher)` → installs fresh dispatcher via `wsProvider.on(filter, dispatcher)`. Stores `wsProvider`, `activeDispatcher`, `activeFilter` in `chainState[chain]` so the next refresh can drop cleanly. **TODO Plan 19-04c markers at lines 441 (HTTP polling fallback) + 512 (heartbeat / reconnect / backfill).** |
| `getLogsForBackfill` | `async (ctx, fromBlock, toBlock, addresses, topics) => Log[]` | Chunks at `ctx.chain.antiRug.backfillCapBlocks`. Iteration: `for (let chunkStart = fromBlock; chunkStart <= toBlock; chunkStart += cap) { chunkEnd = Math.min(chunkStart + cap - 1, toBlock); ... }`. Returns concatenated log array. Errors propagate. |
| `getRegisteredPositions` | `(chain) => RegisteredPosition[]` | Flat list of all positions on a chain (used by `startChainAntiRugListener` for the address-union filter; consumed by Plan 19-04c's restart-resume path). |
| `_setEvaluateRugSignalsForTesting` | `(fn) => void` | Test hook. Injects a `vi.fn()` spy as the dispatcher's evaluator so this plan's routing tests can run before Plan 19-04b's real evaluator ships. |
| `_resetRegistryForTesting` | `() => void` | Test hook. Clears `positionRegistry` + `chainState` between unit tests so per-chain state does not bleed. |

Internal (NOT exported):

- **`dispatchEvent(ctx, logEvent)`** — Extracts `logEvent.address.toLowerCase()`, looks up positions in `positionRegistry[ctx.chain.name][lcAddress]`, calls `evaluateRugSignals(ctx, position, logEvent)` for each. Wraps the evaluator call in `try/catch` so a thrown evaluator on one position does not block dispatch on sibling positions registered to the same pair (Test 20 case).
- **`evaluateRugSignals` shim** — Module-scoped `let` defaulted to a `log.warn(op='antirug.evaluator.stub')` no-op. Plan 19-04b lands the real evaluator and reassigns this `let` at module-import time. The `_setEvaluateRugSignalsForTesting` hook lets this plan's tests inject a spy in `beforeEach` / per-test.

### `test/unit/anti-rug/detectorRegistry.test.ts` (705 lines, 11 tests, 4 describe blocks)

| Describe block | Tests | Purpose |
|---------------|-------|---------|
| `positionRegistry — register / unregister` | Tests 18, 19, 20 | (18) baseline present → registered + baseline carried; baseline null → log.error + NOT registered. (19) unregister removes by tradeId; empty bucket key deleted; non-existent tradeId no-op. (20) two positions on same pair → both stored in array; dispatch fires for both. |
| `startChainAntiRugListener — topic filter union` | Tests A1, A2, A3, A4 | (A1) V2-only → filter topics include PAIR_BURN_TOPIC + PAIR_TRANSFER_TOPIC. (A2) V3-only → POOL_BURN_TOPIC + POOL_COLLECT_TOPIC. (A3) V2 + V3 mixed → UNION of all four topics. (A4) address-filter is the union of all registered pair/pool addresses, lowercased. |
| `dispatchEvent routing` | Test A5 | Log with address X → dispatches to position(s) at X (passes the entire position object to the evaluator); log with unrelated address → silent drop (no dispatch). Mixed-case incoming address also routes correctly. |
| `getLogsForBackfill — chunked iteration` | Tests A6, A7, A8 | (A6) [100, 150] cap=10 → 6 sequential calls covering [100,109], [110,119], [120,129], [130,139], [140,149], [150,150] with results concatenated in order. (A7) toBlock - fromBlock < cap → single call (no chunking). (A8) Rejection on the second chunk propagates; only 2 calls executed (chunks 3-6 NOT run). |

The tests mock `loadLpBaseline` (so registration tests do not touch the DB), the logger (so log assertions can verify `log.error op='antirug.register.no-baseline'`), and stub `ChainContext` + `ctx.wsProvider.on/off` + `ctx.httpProvider.getLogs/getBlockNumber/getCode`. Each test imports the production `src/anti-rug/detector` module via dynamic `await import(...)` — required because the `vi.mock` calls only resolve on dynamic-import after `beforeEach` has reset the mocks for `mockReset: true` per the Phase 18 / Plan 19-03 vitest convention.

## TDD Cycle

| Phase | Commit | Tests | Notes |
|-------|--------|-------|-------|
| **RED** | `7f671e0` | 11/11 fail with `Cannot find module 'src/anti-rug/detector'` | Test file authored; module does not yet exist. Each test imports `'../../../src/anti-rug/detector'` via `await import(...)` and fails at the import. Exactly the expected RED gate failure mode. |
| **GREEN** | `7f75581` | 11/11 pass | Module shipped. All tests pass on first run with the implementation matching the plan's `<action>` verbatim (modulo the off-by-one boundary discussion below). Zero retries; no debugger work. |

A REFACTOR commit was NOT needed — the GREEN implementation is straight-line and matches the plan's `<action>` specification.

## Decisions Made

### 1. The evaluateRugSignals shim mechanism

The plan's `<interfaces>` section enumerated three options for getting `dispatchEvent` to call a function that lives in Plan 19-04b before 19-04b has landed:

1. `vi.mock('./detector.evaluateRugSignals', ...)` in the unit test.
2. Export `evaluateRugSignals` from Plan 19-04a as a default-stub that 19-04b overrides.
3. Module-scoped `let evaluateRugSignals = stub` with a setter export `_setEvaluateRugSignalsForTesting`.

**Chose option 3.** Justification:

- Option 1 is fragile: `vi.mock` of a same-module symbol is unreliable (vitest's `vi.mock` works on imports, not on internal references). The dispatcher would call the unmocked symbol because it resolves via the module-local closure, not via re-import.
- Option 2 conflates two responsibilities. Plan 19-04b's evaluator is the "real" implementation, not a stub-with-override-on-load; signalling that via the same export creates a "is this the stub or the real one?" ambiguity at the import site.
- Option 3 makes the mechanism explicit. The `let` declares intent ("this is a hot-swappable reference"); the `_setEvaluateRugSignalsForTesting` hook is namespace-prefixed with the production-disallowed underscore. Plan 19-04b lands its real evaluator alongside this file (both plans share `src/anti-rug/detector.ts`) and reassigns the `let` at module-import time — or it can export `evaluateRugSignals` as a top-level `export async function` and the `let` switches to point at it. Either mechanism works; this plan's tests do not depend on which Plan 19-04b picks.

The hook is **deliberately** exported with the underscore prefix to signal "test-only — production code MUST NOT import this". If Plan 19-04b decides to ship its real evaluator as a top-level `export async function evaluateRugSignals(...)` and refactor away the `let`, the `_setEvaluateRugSignalsForTesting` hook can stay as a thin wrapper that calls the real export (still useful for any future evaluator stub work).

### 2. positionRegistry data shape

`Map<string, Map<string, RegisteredPosition[]>>` — outer key chain.name, inner key lowercased pair/pool address, value ARRAY.

The array bucket per address is the key design point. It handles Test 20's "two positions on the same pair" case without losing dispatch. A `Map<addr, RegisteredPosition>` (single value, not array) would silently overwrite the second position on register; an exit on the first would call `unregisterAntiRugPosition` with tradeId=N1 and either (a) leave the second position orphaned with no dispatch when N2 is registered later, or (b) require the second `registerAntiRugPosition` call to detect the pre-existing entry and merge.

The array bucket reads cleanly, dispatches cleanly, and unregisters cleanly. The only subtlety is the empty-bucket-cleanup in `unregisterAntiRugPosition` (`if (bucket.length === 0) perChain.delete(addr)`) — without this, the bucket stays in the inner Map and the next `startChainAntiRugListener` call would include the stale address in the filter union. Verified by Test 19.

### 3. Address filter rebuild semantics on register/unregister

ethers v6 has no native "replace filter" API on `WebSocketProvider`. Re-calling `.on(filter, handler)` with a new filter would install a SECOND subscription on top of the first; events matching both filters would fire BOTH handlers (dispatch twice per event).

`startChainAntiRugListener` solves this with explicit drop+recreate:

1. Look up the prior `activeDispatcher` + `activeFilter` from `chainState[chain]`.
2. If present, call `wsProvider.off(activeFilter, activeDispatcher)` to drop them.
3. Compute the fresh address+topic union.
4. Build the fresh dispatcher (`(logEvent) => void dispatchEvent(ctx, logEvent)`).
5. Call `wsProvider.on(newFilter, newDispatcher)`.
6. Store `newDispatcher` + `newFilter` in `chainState[chain]` for the next refresh.

This invariant (per-chain WS subscription count == 1) is the explicit Pitfall #10 mitigation. Any future code that bypasses this function (e.g. Plan 19-04c's reconnect path) MUST preserve the invariant by going through `startChainAntiRugListener` after the new connection is up.

### 4. getLogsForBackfill chunk boundary discussion (the 5-vs-6 off-by-one)

The plan's `<behavior>` Test A6 narrated "5 sequential `ctx.httpProvider.getLogs` calls of 10 blocks each (100-110, 111-120, 121-130, 131-140, 141-150)". This is the "5 chunks of 11 blocks each" reading.

The plan's `<action>` specified the implementation:

```typescript
for (let chunkStart = fromBlock; chunkStart <= toBlock; chunkStart += cap) {
    const chunkEnd = Math.min(chunkStart + cap - 1, toBlock);
    ...
}
```

With `cap=10`, `fromBlock=100`, `toBlock=150`, the iteration is:

| Iteration | chunkStart | chunkEnd | Range |
|-----------|-----------|----------|-------|
| 1 | 100 | min(109, 150) = 109 | [100, 109] |
| 2 | 110 | min(119, 150) = 119 | [110, 119] |
| 3 | 120 | min(129, 150) = 129 | [120, 129] |
| 4 | 130 | min(139, 150) = 139 | [130, 139] |
| 5 | 140 | min(149, 150) = 149 | [140, 149] |
| 6 | 150 | min(159, 150) = 150 | [150, 150] |
| 7 | 160 | (loop exits — 160 > 150) | — |

**SIX chunks, not five.** The discrepancy is between the `<behavior>` narration (5 chunks of 11 blocks) and the `<action>` code (6 chunks; 5 chunks of 10 blocks + 1 final single-block chunk). The off-by-one is deliberate in the `<action>` because it enforces the "cap blocks per call" semantic exactly — each call requests exactly `cap` blocks except the trailing remainder. This matches the Alchemy free-tier semantic where the cap is "10 blocks per query, inclusive of both ends" → block-range = 10 means [fromBlock, fromBlock+9].

The test (Test A6) verifies the unambiguous `<action>` math directly: it asserts 6 calls with the exact (fromBlock, toBlock) tuples shown in the table above. If a future refactor were to "fix" the off-by-one to match the `<behavior>` narration (5 chunks of 11 blocks each), Test A6 would fail loudly with the exact mismatch.

This is **Test A6's specific guard against the off-by-one bug class** (T-19-04a-05 in the plan's threat model).

### 5. Empty-address-list early return

`startChainAntiRugListener` returns early if there are no registered positions for the chain (i.e. `getRegisteredPositions(chain).length === 0`). The alternative — installing a subscription with `address: []` — has ambiguous semantics in ethers v6 (some providers treat empty array as "all addresses match", which is the OPPOSITE of intent).

Plan 19-04c will revisit this for the "all positions closed but chain WS subscription should stay alive to save reconnect cost on the next buy" case. For this skeleton plan, the early-return keeps the test surface minimal: if no addresses, no WS subscription. Verified indirectly: Tests A1-A4 all register at least one position before calling `startChainAntiRugListener`; no test exercises the empty-address branch.

## Deviations from Plan

**None substantive — plan executed as written.** Two refinements (both inside the plan's spec):

1. **The "5 vs 6 chunks" boundary clarification.** The plan's `<behavior>` Test A6 text named 5 chunks; the `<action>` code specified 6. The test enforces the `<action>` code (6 chunks), with both decisions and rationale documented inline in the test file's header comment AND in this SUMMARY's §"Decisions Made" #4. No code change vs the `<action>` specification.

2. **Added `_resetRegistryForTesting` test hook.** The plan listed `_setEvaluateRugSignalsForTesting` as the test hook; in implementation, the `afterEach` block also needs a way to clear the module-scoped `positionRegistry` + `chainState` Maps between tests so per-chain state does not bleed. Added `_resetRegistryForTesting` (also underscore-prefixed to signal test-only) alongside the evaluator hook. This is consistent with the Phase 18 / Plan 19-03 module-level-state convention of providing reset hooks for vitest's `mockReset: true` mode.

No auto-fixes (Rules 1-3) applied; no architectural questions (Rule 4) raised. Zero deviations from the plan's threat model.

## Open Questions for Downstream Plans

### Plan 19-04b (multi-signal evaluator)

1. **Will Plan 19-04b reassign the module-scoped `let evaluateRugSignals` shim, or export its own `evaluateRugSignals` and rely on the `_setEvaluateRugSignalsForTesting` hook?** Both work. Recommendation: export `evaluateRugSignals` as a top-level `export async function`, and have the let-shim call it OR be replaced wholesale. The `_setEvaluateRugSignalsForTesting` hook stays for evaluator-stubbing in 19-04c's tests (e.g. for testing the reconnect+backfill path with a known-verdict evaluator).

2. **Verdict-handling at the dispatch site.** The current `dispatchEvent` awaits the evaluator's return value but discards it. Plan 19-04b will need to extend `dispatchEvent` (or wrap the evaluator's return with a verdict-handler function) so that:
   - `verdict: 'unsafe'` → schedule confirm-after-N-blocks delay → re-evaluate after N → fire exit via Plan 19-05's `triggerAntiRugExit`.
   - `verdict: 'allowlisted'` → emit D-LIST-AUDIT structured log; no exit.
   - `verdict: 'safe' | 'unknown'` → log + drop.

   This handling is OUT OF SCOPE for Plan 19-04a (skeleton only). Plan 19-04b ships it.

### Plan 19-04c (WS lifecycle: heartbeat + reconnect + backfill + HTTP fallback)

1. **HTTP polling fallback shape.** The skeleton currently `log.warn` and returns when `ctx.wsProvider == null`. Plan 19-04c needs to install a `setInterval`-based poll loop (per `src/bot.ts:758-810`) that calls `getLogsForBackfill` for the registered address-union every ~2s. This is in scope for 19-04c.

2. **Heartbeat + reconnect lifecycle.** The `chainState[chain]` record carries skeleton fields `heartbeatInterval`, `reconnectAttempts`, `lastSeenBlock`, `healthState`, `lastPongTs` — none are populated by 19-04a. Plan 19-04c wires the `ws@^8.20.0` ping/pong via `(ctx.wsProvider.websocket as any).ping()` per 19-RESEARCH.md §6.1, and the on('close') reconnect-with-exponential-backoff loop per `src/bot.ts:685-707`.

3. **`activeDispatcher` invariance after reconnect.** Plan 19-04c's reconnect path MUST call `startChainAntiRugListener(ctx)` after the new WS connection is up. That call will drop the (now-stale) `activeDispatcher` reference and install a fresh one — preserving the per-chain WS subscription count == 1 invariant.

4. **Empty-address-list at reconnect time.** If all positions closed during a downtime, the reconnect path's `startChainAntiRugListener` call will hit the empty-address early-return. Plan 19-04c needs to decide whether to (a) tear down the WS connection entirely, (b) keep the connection open with no subscription, or (c) install a no-op subscription. Recommendation: (b) — keep the connection open via the heartbeat for fast resubscribe on the next buy.

### Plan 19-05 (bot.ts wiring + cleanup hook)

1. **registerAntiRugPosition call sites.** Plan 19-05 wires `registerAntiRugPosition` at `bot.ts:332-341` (V2 buy success) and `bot.ts:522-530` (V3 buy success), parallel to `snapshotLpBaseline` and `startExitMonitor`. The call returns void; failure is signalled via `log.error op='antirug.register.no-baseline'` and does NOT throw — so the bot.ts buy-success branch will continue normally even if registration failed.

2. **unregisterAntiRugPosition call site.** Plan 19-05 wires `unregisterAntiRugPosition(ctx.chain.name, tradeId)` at `src/exitEngine.ts:504` right after `deleteExitState.run(tradeId)`. The unregister is sync (no await needed).

## Verification

| Check | Result |
|-------|--------|
| `npm run test:unit -- anti-rug/detectorRegistry` | **11/11 passing** |
| `npm run test:unit` (full unit suite) | **354/354 passing** — zero regressions vs 343 baseline (+11 new) |
| `npx tsc --noEmit` (main tsconfig) | **clean** |
| `npx tsc --noEmit -p tsconfig.bot.json` | **clean** |
| `cd dashboard && npx tsc --noEmit` | **clean** |
| `grep -n "// TODO Plan 19-04" src/anti-rug/detector.ts` | **2 lines** (441 HTTP fallback, 512 heartbeat/reconnect/backfill) — meets `>= 2` |
| `grep -n "evaluateRugSignals" src/anti-rug/detector.ts` | **12 occurrences** (let-shim declaration, type signature, dispatch call site, test-hook setter, comments) — meets `>= 1` |
| `grep -n "export" src/anti-rug/detector.ts` | **8 exports** (5 public API + 2 test hooks + 1 type) — meets the plan's 5-public-exports criterion |
| `grep -n "positionRegistry" src/anti-rug/detector.ts` | Declared at module scope; used in register / unregister / dispatchEvent / getRegisteredPositions |

## Files Touched

| File | Action | Lines | Commit |
|------|--------|-------|--------|
| `test/unit/anti-rug/detectorRegistry.test.ts` | created | +705 | `7f671e0` |
| `src/anti-rug/detector.ts` | created | +634 | `7f75581` |

## Hand-off

This plan unblocks:

- **Plan 19-04b** (`src/anti-rug/detector.ts` evaluator extension) — can:
  - `import type { RegisteredPosition } from './detector'` for the evaluator's signature.
  - Either reassign the module-scoped `evaluateRugSignals` shim OR export a top-level `evaluateRugSignals` function.
  - Extend the (currently fire-and-forget) `dispatchEvent` with verdict-handling: confirm-after-N-blocks delay queue, allowlist-suppressed audit logs, and the bridge to Plan 19-05's `triggerAntiRugExit`.

- **Plan 19-04c** (WS lifecycle / heartbeat / reconnect / backfill / HTTP fallback) — can:
  - `import { getLogsForBackfill, startChainAntiRugListener, getRegisteredPositions } from './detector'` for the reconnect + backfill flow.
  - Populate the `chainState[chain]` skeleton fields (`heartbeatInterval`, `reconnectAttempts`, `lastSeenBlock`, `healthState`, `lastPongTs`) per 19-RESEARCH.md §6.1.
  - Install the HTTP polling fallback at the `// TODO Plan 19-04c — HTTP polling fallback` marker on line 441.
  - Install the heartbeat / reconnect / backfill / dashboard-broadcast machinery at the `// TODO Plan 19-04c — heartbeat setup, reconnect 'close' handler, backfillSinceLastSeen call` marker on line 512.

- **Plan 19-05** (bot.ts wiring + exitEngine cleanup hook) — can:
  - `import { registerAntiRugPosition } from './anti-rug/detector'` and wire at the V2 + V3 buy-success branches in bot.ts (parallel to `snapshotLpBaseline` + `startExitMonitor`).
  - `import { unregisterAntiRugPosition } from './anti-rug/detector'` and wire at `exitEngine.ts:504` (after `deleteExitState.run(tradeId)`).

Requirements addressed: **ANTIRUG-01** (single-listener-per-chain WS subscription pattern — skeleton shipped; full lifecycle in 19-04c), **ANTIRUG-02** (V2 Pair.Burn topic subscription — topic filter union shipped; address filter union shipped), **ANTIRUG-03** (V2 LP-token Transfer-to-dEaD topic — PAIR_TRANSFER_TOPIC included in the union), **ANTIRUG-13** (V3 Burn + Collect topic subscription — POOL_BURN_TOPIC + POOL_COLLECT_TOPIC included in the union). All four remain `[ ]` in REQUIREMENTS.md until the full evaluator + lifecycle ships in 19-04b + 19-04c — this plan ships the FOUNDATION skeleton only.

## Self-Check: PASSED

- File `src/anti-rug/detector.ts` — **FOUND** (634 lines; 5 public + 2 test-hook + 1 type exports)
- File `test/unit/anti-rug/detectorRegistry.test.ts` — **FOUND** (705 lines, 11 tests)
- Commit `7f671e0` (TDD RED — failing tests for the un-shipped detector module) — **FOUND**
- Commit `7f75581` (TDD GREEN — detector module shipped; 11/11 tests pass) — **FOUND**
- 11/11 detector-registry tests passing — **VERIFIED** via `npm run test:unit -- anti-rug/detectorRegistry`
- 354/354 full unit suite passing — **VERIFIED**
- tsc clean across all 3 tsconfig projects — **VERIFIED**
- `grep -n "// TODO Plan 19-04" src/anti-rug/detector.ts` returns 2 lines — **VERIFIED**
