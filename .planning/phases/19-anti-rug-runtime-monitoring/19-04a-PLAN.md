---
id: 19-04a
phase: 19-anti-rug-runtime-monitoring
plan: 04a
type: execute
wave: 2
depends_on: [19-01, 19-02, 19-03]
files_modified:
  - src/anti-rug/detector.ts
autonomous: true
requirements: [ANTIRUG-01, ANTIRUG-02, ANTIRUG-03, ANTIRUG-13]
requirements_addressed: [ANTIRUG-01, ANTIRUG-02, ANTIRUG-03, ANTIRUG-13]
tags: [anti-rug, detector, position-registry, ws-subscription, topic-filter-union]

must_haves:
  truths:
    - "Detector module exports `registerAntiRugPosition(ctx, dex, tokenAddress, pairOrPoolAddress, tradeId, feeTier)`, `unregisterAntiRugPosition(chain, tradeId)`, and the per-chain `positionRegistry` Map shape used by Plan 19-04b's evaluator and Plan 19-04c's WS lifecycle — clean API surface that the multi-signal evaluator (19-04b) and reconnect+backfill (19-04c) consume."
    - "`positionRegistry: Map<string, Map<string, RegisteredPosition[]>>` — outer key chain.name, inner key lowercased pair/pool address, value is an array (handles multiple positions on the same pair). Per-chain isolation; per-pair array handles the rare same-pair-multiple-positions case."
    - "Detector module exports `startChainAntiRugListener(ctx)` SKELETON that subscribes to topic-filter union covering V2 (Pair.Burn + LP.Transfer-to-dead) + V3 (Pool.Burn + Pool.Collect) — addresses union of all registered pair/pool addresses for this chain. Heartbeat, reconnect, backfill, and HTTP polling fallback are STUBBED with TODO comments referring to Plan 19-04c (which lands the full lifecycle); the WS subscription itself is wired and dispatchEvent routes by lowercased pair/pool address."
    - "Detector module exports `getLogsForBackfill(ctx, fromBlock, toBlock, addresses, topics): Promise<Log[]>` primitive — chunks the request at `ctx.chain.antiRug.backfillCapBlocks` per RESEARCH CRITICAL #1; Plan 19-04c consumes this for the full reconnect-backfill path."
    - "`dispatchEvent(ctx, logEvent)` is the internal router — parses the topic, looks up the position(s), and calls Plan 19-04b's `evaluateRugSignals` (stubbed with `// Plan 19-04b export` comment in this plan); on registration of the first position for a chain, the WS subscription is kicked off; on unregistration of the last position, the subscription is left running with an empty address list (saves reconnect cost on the next buy per planner discretion)."
  artifacts:
    - path: "src/anti-rug/detector.ts"
      provides: "Position registry + WS subscription skeleton + topic filter union + chunked getLogs primitive"
      contains: "export function registerAntiRugPosition, export function unregisterAntiRugPosition, export async function startChainAntiRugListener, export async function getLogsForBackfill, positionRegistry"
    - path: "test/unit/anti-rug/detectorRegistry.test.ts"
      provides: "Unit tests for registry add/remove/lookup + topic filter union + getLogs chunking primitive"
      contains: "describe('Phase 19 — Detector registry + WS skeleton'"
  key_links:
    - from: "src/anti-rug/detector.ts registerAntiRugPosition"
      to: "src/bot.ts V2 + V3 buy-success branches (Plan 19-05)"
      via: "Called parallel to snapshotLpBaseline at buy success"
      pattern: "registerAntiRugPosition"
    - from: "src/anti-rug/detector.ts positionRegistry"
      to: "src/anti-rug/detector.ts evaluateRugSignals (Plan 19-04b)"
      via: "Map lookup by lowercased pair/pool address inside dispatchEvent"
      pattern: "positionRegistry"
    - from: "src/anti-rug/detector.ts getLogsForBackfill"
      to: "src/anti-rug/detector.ts backfillSinceLastSeen (Plan 19-04c)"
      via: "Chunked getLogs primitive consumed by reconnect+backfill"
      pattern: "getLogsForBackfill"
---

<objective>
Land the position-registry plumbing + WS subscription skeleton + topic filter union + chunked getLogs primitive. This is the FOUNDATION layer of the detector — clean module API that the multi-signal evaluator (19-04b) and heartbeat+reconnect+backfill (19-04c) plug into.

Purpose: Split out from the original Plan 19-04 (Warning 6 from plan-checker iteration 1: the original was one giant task with 26 behaviors). This plan establishes the registry shape + WS subscription skeleton so 19-04b can implement the multi-signal evaluator against a stable API and 19-04c can implement the lifecycle (heartbeat, reconnect, backfill) against the same WS subscription handle.

Output: One new file `src/anti-rug/detector.ts` (skeleton — exports the registry API and a startChainAntiRugListener that wires the WS subscription but stubs the heartbeat/reconnect/backfill paths with TODO comments) + one test file (unit tests for registry behavior, topic filter union, chunked getLogs primitive).
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

# Source files this plan consumes
@src/anti-rug/types.ts
@src/anti-rug/events.ts
@src/anti-rug/lpBaseline.ts
@src/chainRegistry.ts
@src/utils/db.ts
@src/utils/logger.ts
@src/utils/provider.ts

<interfaces>
<!-- This plan establishes the API surface that 19-04b + 19-04c consume -->

Available helpers (verify in read_first):
- From Plan 19-01: `upsertChainState`, `getChainState` (exported from src/utils/db.ts) — used by Plan 19-04c
- From Plan 19-02: `ctx.chain.antiRug.{backfillCapBlocks, maxBackfillBlocks, allowlistV2, allowlistV3}` — backfillCap consumed by `getLogsForBackfill` in this plan
- From Plan 19-03: `LpBaselineRow`, `loadLpBaseline` (lpBaseline.ts); `PAIR_BURN_TOPIC`, `PAIR_TRANSFER_TOPIC`, `POOL_BURN_TOPIC`, `POOL_COLLECT_TOPIC` (events.ts)

Existing analog reused (read_first opens src/bot.ts):
- `startDexListener` at src/bot.ts:656-752 — single-listener-per-chain pattern; this plan adapts it for the anti-rug subscription.

Plan 19-04b exports `evaluateRugSignals(ctx, position, logEvent): Promise<RugEvaluation>` — this plan imports it but the import path resolves to a function that lands in 19-04b; the unit test mocks it via `vi.mock('./detector.evaluateRugSignals', ...)` OR by exporting evaluateRugSignals as a default-stub from this plan that 19-04b overrides. **Discretionary call:** declare `evaluateRugSignals` as an internal `let` variable in this plan defaulted to a `// Plan 19-04b will assign` stub; 19-04b reassigns at module load. Cleanest: 19-04b extends the same detector.ts file with `evaluateRugSignals` as a top-level export and dispatchEvent imports it as `import { evaluateRugSignals } from './detector'`. This plan's dispatchEvent has a `// Plan 19-04b lands this` comment at the call site.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: src/anti-rug/detector.ts — position registry + WS subscription skeleton + topic filter union + getLogsForBackfill primitive</name>
  <files>src/anti-rug/detector.ts, test/unit/anti-rug/detectorRegistry.test.ts</files>
  <read_first>
    - src/bot.ts lines 656-752 (startDexListener WS subscribe pattern — the canonical single-listener-per-chain analog)
    - src/bot.ts lines 758-810 (HTTP polling fallback — stub call site only; full implementation in Plan 19-04c)
    - src/anti-rug/types.ts (Plan 19-03 — RegisteredPosition shape inferred; LpBaselineRow consumed)
    - src/anti-rug/events.ts (Plan 19-03 — topic hashes for the filter union)
    - src/anti-rug/lpBaseline.ts (Plan 19-03 — loadLpBaseline for the register-time baseline read)
    - src/utils/db.ts (Plan 19-01 — getChainState consumed by Plan 19-04c; not directly here)
    - src/utils/provider.ts (removeWsProvider — Plan 19-04c uses; not directly here)
    - .planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md §"src/anti-rug/detector.ts" lines 76-197
    - .planning/phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md §5 CRITICAL #1 lines 579-614 (Alchemy 10-block cap → chunked getLogs)
  </read_first>
  <behavior>
    **Position registry:**
    - Test 18: `registerAntiRugPosition(ctx, dex, token, pair, tradeId, feeTier)` stores the entry in the chain's positionRegistry Map keyed by lowercased pair/pool address; loads `baseline = loadLpBaseline(tradeId)` and includes it in the RegisteredPosition; if baseline is null (snapshot missing), logs error and skips the register.
    - Test 19: `unregisterAntiRugPosition(chain, tradeId)` removes the entry from the registry by searching for tradeId across the per-chain Map; if the chain now has zero positions, the WS subscription is left running with an empty address list (planner discretion — saves reconnect cost on the next buy).
    - Test 20: Multiple positions registered to the same pair address are all stored in the inner-Map array; lookups return ALL of them so dispatch (Plan 19-04b) can fire one evaluation per registered position.

    **Topic filter union:**
    - Test A1: When at least one V2 position is registered on a chain, the WS subscription filter includes PAIR_BURN_TOPIC AND PAIR_TRANSFER_TOPIC.
    - Test A2: When at least one V3 position is registered on a chain, the WS subscription filter includes POOL_BURN_TOPIC AND POOL_COLLECT_TOPIC.
    - Test A3: When BOTH V2 and V3 positions registered on a chain, the filter is the UNION of all four topics (single subscription per chain per Pitfall #10).
    - Test A4: The address filter is the union of all registered pair/pool addresses (lowercased) for this chain.

    **dispatchEvent routing:**
    - Test A5: When a Log event arrives with address `0xAAA...`, dispatchEvent looks up position(s) in positionRegistry[chain]['0xaaa...'] (lowercased); if found, calls `evaluateRugSignals(ctx, position, logEvent)` for EACH position; if not found, silently drops (not one of ours).

    **getLogsForBackfill primitive:**
    - Test A6: `getLogsForBackfill(ctx, fromBlock=100, toBlock=150, addresses, topics)` with `ctx.chain.antiRug.backfillCapBlocks=10` issues 5 sequential `ctx.httpProvider.getLogs({fromBlock, toBlock, address, topics})` calls of 10 blocks each (100-110, 111-120, 121-130, 131-140, 141-150) and returns the concatenated events.
    - Test A7: When `toBlock - fromBlock < backfillCapBlocks`, getLogsForBackfill issues one call (no chunking).
    - Test A8: If any chunk getLogs call rejects, getLogsForBackfill propagates the error (caller — Plan 19-04c — handles the fail-closed branch).
  </behavior>
  <action>
Create `src/anti-rug/detector.ts` as the skeleton module. Structure (use 19-PATTERNS.md §"src/anti-rug/detector.ts" lines 76-197 as the foundation):

(1) **Imports** per 19-PATTERNS.md lines 82-91. Include: ethers `Contract`, `EventLog`, `WebSocketProvider`, `id`; types + helpers from Plan 19-03; topic constants from src/anti-rug/events.ts; logger from src/utils/logger.

(2) **Module-level child logger:** `const log = logger.child({ module: 'antiRug:detector' });`

(3) **Position registry data shapes:**
- `interface RegisteredPosition { tradeId: number; chain: string; tokenAddress: string; pairOrPoolAddress: string; dex: DexConfig; feeTier: number | null; baseline: LpBaselineRow; poolType: 'v2' | 'v3'; }`
- `const positionRegistry = new Map<string, Map<string, RegisteredPosition[]>>();` — outer key chain, inner key lowercased pairOrPoolAddress, value is an array.
- `export function getRegisteredPositions(chain: string): RegisteredPosition[]` — flat list of all positions on this chain (used by Plan 19-04c restart/backfill to know what addresses to subscribe to).

(4) **Per-chain WS state (skeleton — full shape lands in Plan 19-04c):**
- `interface ChainAntiRugState { wsProvider: WebSocketProvider | null; heartbeatInterval: NodeJS.Timeout | null; reconnectAttempts: number; lastSeenBlock: number; healthState: 'connected' | 'reconnecting' | 'disconnected'; lastPongTs: number; }`
- `const chainState = new Map<string, ChainAntiRugState>();` — keyed by chain.name; this plan initializes with a minimal `{wsProvider: null, heartbeatInterval: null, reconnectAttempts: 0, lastSeenBlock: 0, healthState: 'disconnected', lastPongTs: 0}` entry on first registerAntiRugPosition; Plan 19-04c populates the rest.

(5) **Public API exports:**

- `export function registerAntiRugPosition(ctx, dex, tokenAddress, pairOrPoolAddress, tradeId, feeTier)`:
  - `baseline = loadLpBaseline(tradeId)`; if null, log.error and return without registering (Plan 19-05 should have called snapshotLpBaseline first).
  - Build the RegisteredPosition with `poolType = dex.dexType` (derived from dex discriminator).
  - Insert into positionRegistry[chain.name][pairOrPoolAddress.toLowerCase()] (create inner Map on first call); array append per Test 20.
  - If this is the FIRST position on this chain, also kick off `startChainAntiRugListener(ctx)` if `chainState.get(chain.name)?.wsProvider == null`.
  - If WS already running for this chain, restart the subscription with the union of addresses (call the same `startChainAntiRugListener(ctx)` — it's idempotent: drops the old subscription, creates the new one with the current address+topic union).

- `export function unregisterAntiRugPosition(chain: string, tradeId: number)`:
  - Iterate the inner Map for this chain; find the entry with matching tradeId; splice it out of the array; if the array is now empty, delete the inner key entirely.
  - If chain has zero positions remaining, leave WS subscription running with empty address filter (discretionary — see <interfaces>).

- `export async function startChainAntiRugListener(ctx: ChainContext): Promise<void>`:
  - This plan ships the SKELETON. Plan 19-04c lands the full body (heartbeat, reconnect, backfill, HTTP polling fallback).
  - Skeleton behavior in THIS plan:
    - If `ctx.wsProvider == null`, log warn + `// TODO Plan 19-04c — HTTP polling fallback`.
    - Compute topic filter union: `topics = [[PAIR_BURN_TOPIC, PAIR_TRANSFER_TOPIC, POOL_BURN_TOPIC, POOL_COLLECT_TOPIC]]`.
    - Compute address filter: union of all registered pair/pool addresses for this chain (use `getRegisteredPositions(chain.name).map(p => p.pairOrPoolAddress)`).
    - `ctx.wsProvider.on({address: addresses, topics}, (logEvent) => dispatchEvent(ctx, logEvent))`.
    - On connect success, store the wsProvider in `chainState.get(chain.name).wsProvider` and update `healthState='connected'`.
    - `// TODO Plan 19-04c — heartbeat setup, reconnect 'close' handler, backfillSinceLastSeen call, broadcast 'chain_ws_health_change'.`

- `async function dispatchEvent(ctx: ChainContext, logEvent: Log): Promise<void>` (internal, NOT exported):
  - Extract `pairAddress = logEvent.address.toLowerCase()`.
  - Look up: `positions = positionRegistry.get(ctx.chain.name)?.get(pairAddress) ?? []`.
  - For each position: `await evaluateRugSignals(ctx, position, logEvent)` where `evaluateRugSignals` is imported with a comment `// Plan 19-04b lands the actual implementation; this plan's test mocks it`.
  - To make Tests A5 work without 19-04b shipped: declare `let evaluateRugSignals: (ctx, position, logEvent) => Promise<unknown> = async () => { log.warn('evaluateRugSignals stub'); }` AND `export function _setEvaluateRugSignalsForTesting(fn)` so the unit test can inject the spy. Plan 19-04b removes the stub and exports its real evaluateRugSignals as the canonical one; the `_setEvaluateRugSignalsForTesting` hook remains for the test.

- `export async function getLogsForBackfill(ctx: ChainContext, fromBlock: number, toBlock: number, addresses: string[], topics: (string | string[])[]): Promise<Log[]>`:
  - Read `cap = ctx.chain.antiRug.backfillCapBlocks`.
  - Chunk iteration:
    ```typescript
    const allEvents: Log[] = [];
    for (let chunkStart = fromBlock; chunkStart <= toBlock; chunkStart += cap) {
        const chunkEnd = Math.min(chunkStart + cap - 1, toBlock);
        const events = await ctx.httpProvider.getLogs({ address: addresses, fromBlock: chunkStart, toBlock: chunkEnd, topics });
        allEvents.push(...events);
    }
    return allEvents;
    ```
  - Errors propagate (no try/catch swallow); caller (Plan 19-04c) implements the gap-detected fail-closed branch.

(6) **Discretionary calls (planner-documented):**
- `evaluateRugSignals` is exposed via a let+setter shim so this plan's unit test can run without Plan 19-04b shipped. Plan 19-04b replaces the shim with the real implementation by exporting the function as a top-level `export async function evaluateRugSignals(...)` that the let-shim is reassigned to at module-import time (via the existing `_setEvaluateRugSignalsForTesting` hook OR by making the shim a `const` reference to an injectable function — Claude finalizes the exact mechanism during execution).
- chainState map vs per-chain singleton object: Map chosen for symmetry with positionRegistry.
- Subscription address-filter update on register/unregister: re-call `wsProvider.on(...)` with the new filter (ethers v6 supports this; each call replaces the prior filter for the same event type per ethers docs). The OPTIONAL alternative — track subscription handles and drop+recreate — is more code but cleaner. Recommendation: drop+recreate for clarity in this plan since the unit test exercises the re-subscription.

UNIT TEST FILE (test/unit/anti-rug/detectorRegistry.test.ts):
- Mock `ChainContext`, `ctx.httpProvider`, `ctx.wsProvider`; mock Contract factories.
- Behaviors: Tests 18, 19, 20, A1, A2, A3, A4, A5, A6, A7, A8 above.
- Use `vi.spyOn` on the injected evaluateRugSignals to assert dispatch behavior (Test A5).
- For Test A6/A7/A8 (getLogs chunking), mock `ctx.httpProvider.getLogs` with `vi.fn().mockResolvedValue([])` and assert call count + per-call args.
  </action>
  <verify>
    <automated>npm run test:unit -- anti-rug/detectorRegistry</automated>
  </verify>
  <done>
    - All 11 tests pass (3 registry + 4 topic-filter + 1 dispatch + 3 getLogs-chunk = Tests 18, 19, 20, A1-A8).
    - `npx tsc --noEmit` clean across all tsconfig projects.
    - `src/anti-rug/detector.ts` exports `registerAntiRugPosition`, `unregisterAntiRugPosition`, `startChainAntiRugListener`, `getLogsForBackfill`, `getRegisteredPositions`.
    - `grep -n "// TODO Plan 19-04" src/anti-rug/detector.ts` returns >= 2 lines (the heartbeat + reconnect + backfill stubs that 19-04c lands).
    - `grep -n "evaluateRugSignals" src/anti-rug/detector.ts` returns at least 1 line (the let-shim + dispatch site).
  </done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `loadLpBaseline` at register time | snapshot must exist for the position to register; if missing, the position is left UNMONITORED and the dashboard surfaces an Unmonitored badge per UI-SPEC |
| WebSocket event stream from RPC (skeleton subscription) | external (RPC-controlled) input crosses into the dispatcher; full event validation lands in Plan 19-04b's evaluator |
| `getLogsForBackfill` chunk iteration | external getLogs results — chunking is bounded by ctx.chain.antiRug.backfillCapBlocks; if RPC returns a malformed chunk, the iteration propagates the error to Plan 19-04c's caller for fail-closed handling |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-04a-01 | Spoofing | dispatchEvent receives an event for an address NOT in the registry | mitigate | Silent drop is the correct behavior — only registered positions can fire dispatch. Test A5 covers. |
| T-19-04a-02 | Tampering | hostile RPC injects events for the registered address | accept | Multi-signal evaluator (Plan 19-04b) handles the verdict; this plan's job is just routing. |
| T-19-04a-03 | DoS | hostile event stream floods the dispatcher | mitigate | Per-chain single subscription caps event source count; per-position evaluation is independent and bounded by registered count (~10s open positions max). |
| T-19-04a-04 | Repudiation | registerAntiRugPosition fails silently if baseline missing | mitigate | Explicit log.error with op='antirug.register.no-baseline', tradeId — surfaces to operator via existing log review. |
| T-19-04a-05 | Tampering | getLogsForBackfill chunk math off-by-one | mitigate | Test A6 explicitly drills the 100→150 with cap=10 case asserting 5 chunks with the correct boundaries (100-110, 111-120, ...). Off-by-one is the most common backfill bug; the test guards against it. |

**Residual risk:** None at `high`. This plan is the registry + subscription skeleton; the high-stakes multi-signal evaluation lives in Plan 19-04b and the reconnect+backfill lifecycle lives in Plan 19-04c. Both downstream plans verify against this plan's API via their own test suites.

</threat_model>

<verification>

- `npm run test:unit -- anti-rug/detectorRegistry` reports 11/11 passing.
- `npx tsc --noEmit` clean across all tsconfig projects.
- `grep -n "export" src/anti-rug/detector.ts` shows the 5 public exports listed above.
- `grep -n "positionRegistry" src/anti-rug/detector.ts` returns the Map declaration + uses inside register/unregister/dispatchEvent.

</verification>

<success_criteria>

- positionRegistry Map<chain, Map<addr, positions[]>> ships with documented insertion + removal semantics.
- Topic filter union covers V2 + V3 topics per Pitfall #10 single-listener-per-chain.
- getLogsForBackfill chunks at backfillCapBlocks per RESEARCH CRITICAL #1.
- API surface ready for Plan 19-04b (evaluateRugSignals consumer) and Plan 19-04c (heartbeat + reconnect + full backfill).

</success_criteria>

<output>
Create `.planning/phases/19-anti-rug-runtime-monitoring/19-04a-SUMMARY.md` when done. Cover: the evaluateRugSignals shim approach chosen (let-injectable vs Plan 19-04b-supplied), the position registry data-shape decisions, the address-filter rebuild semantics on register/unregister, and the chunked getLogs boundary cases (off-by-one verification).
</output>
