---
phase: 19-anti-rug-runtime-monitoring
plan: 03
subsystem: anti-rug-foundation
tags: [anti-rug, types, events, allowlist, lp-baseline, discriminated-union, tdd]
requires:
  - "src/utils/db.ts:447 — upsertLpBaseline / getLpBaseline / deleteLpBaseline (Plan 19-01)"
  - "src/chainRegistry.ts AntiRugConfig + AllowlistEntry shape (Plan 19-02 inline declarations being moved)"
  - "src/utils/abis.ts PAIR_ABI + V3_POOL_ABI (Phase 5)"
  - "src/utils/honeypot/types.ts HoneypotResult discriminated-union analog (Phase 18 D-13/D-14)"
provides:
  - "src/anti-rug/types.ts — RugSignals, RugEvaluation (4-variant discriminated union), AllowlistEntry, AntiRugConfig, AntiRugMonitorState (6-state UI-SPEC badge union), TriggerEvent, LpBaselineRow"
  - "src/anti-rug/events.ts — PAIR_BURN_EVENT / PAIR_TRANSFER_EVENT / POOL_BURN_EVENT / POOL_COLLECT_EVENT signature strings; PAIR_BURN_TOPIC / PAIR_TRANSFER_TOPIC / POOL_BURN_TOPIC / POOL_COLLECT_TOPIC ethers.id-computed hashes; DEAD_ADDRESS canonical lowercased"
  - "src/anti-rug/allowlist.ts — verifyAllowlistAtStartup (D-LIST-VERIFY getCode() + log.fatal on EOA), isAddressAllowlisted (case-insensitive lookup), mergeAllowlist (hardcoded + env-overlay concat)"
  - "src/anti-rug/lpBaseline.ts — snapshotLpBaseline (V2 reserves+totalSupply or V3 liquidity+slot0), loadLpBaseline (camelCase domain row), clearLpBaseline (delete + changes count)"
affects:
  - "src/chainRegistry.ts — replaced inline AllowlistEntry + AntiRugConfig declarations with `import type ... from './anti-rug/types'` + re-export"
tech-stack:
  added: []  # No new packages — all deps from Phase 18 stack
  patterns:
    - "Discriminated-union with vacuous-pass unrepresentable at type level (mirror of src/utils/honeypot/types.ts D-13/D-14 carryover)"
    - "Class-based ethers.Contract mock for vitest tests with `mockReset: true` (avoids vi.fn().mockImplementation getting wiped between tests)"
    - "globalThis bridge from vi.mock factory to per-test mock instances (survives mockReset)"
    - "Snake_case DB → camelCase domain field mapping at loadLpBaseline boundary"
    - "Module-level child logger convention: `logger.child({ module: 'antiRug:<submodule>' })`"
key-files:
  created:
    - "src/anti-rug/types.ts (215 lines, 7 exports, 0 logger)"
    - "src/anti-rug/events.ts (94 lines, 9 exports, 0 logger)"
    - "src/anti-rug/allowlist.ts (199 lines, 3 exports, 1 logger)"
    - "src/anti-rug/lpBaseline.ts (218 lines, 3 exports, 1 logger)"
    - "test/unit/anti-rug/types.test.ts (186 lines, 11 tests)"
    - "test/unit/anti-rug/allowlist.test.ts (348 lines, 9 tests)"
    - "test/unit/anti-rug/lpBaseline.test.ts (408 lines, 9 tests)"
  modified:
    - "src/chainRegistry.ts (-25 / +12 lines: dropped inline interface declarations; added import-type + re-export)"
decisions:
  - "RugEvaluation variant shape: 'unknown' carries `reason` but NOT `signals`; 'allowlisted' carries `lockerName` at the top level (not nested in signals)"
  - "events.ts is a separate module from src/utils/abis.ts (event ABIs + topic hashes are anti-rug-specific surface; abis.ts continues to hold the view-function ABIs)"
  - "verifyAllowlistAtStartup takes BOTH V2 and V3 lists in a single call so the structured-log dump is one consolidated line per chain"
  - "lpBaseline.ts errors propagate (no try/catch swallow) — buy-success without baseline is a fail-loud condition"
  - "v3PositionNftId stays NULL on every insert in v6.17 (Research Open Q #3) — V3 baseline is pool-only"
  - "Class-based MockContract (rather than vi.fn()) for lpBaseline tests — survives vitest's `mockReset: true` between tests"
metrics:
  duration_minutes: ~17
  tasks_completed: 3
  files_modified: 1
  files_created: 7
  tests_added: 29
  unit_tests_total_after: 343
  commits: 6
  completed_date: "2026-05-24"
---

# Phase 19 Plan 03: Anti-Rug Foundation Modules Summary

Foundation modules for the `src/anti-rug/` package: the discriminated-union type contract (`types.ts`), the event ABI fragments + topic-hash registry (`events.ts`), the allowlist verification / lookup / merge helpers (`allowlist.ts`), and the LP-baseline snapshot / load / clear helpers (`lpBaseline.ts`). These four files are consumed by the detector (Plan 19-04), the exit trigger + bot wiring (Plan 19-05), and the dashboard (Plan 19-06).

## What Was Built

### `src/anti-rug/types.ts` (215 lines, 7 exports)

Single source of truth for every anti-rug-specific type. Seven named exports:

| Export | Shape | Purpose |
|--------|-------|---------|
| `RugSignals` | interface — lpRemovedPct, destination, allowlistHit, sellSimSlippagePct, v2ReservePctBelow | Per-signal evidence captured by the detector's multi-signal evaluator |
| `RugEvaluation` | 4-variant discriminated union | Evaluator return shape; vacuous-pass unrepresentable |
| `AllowlistEntry` | interface — address, lockerName, provenance | One row of the merged allowlist |
| `AntiRugConfig` | interface — 10 fields | Per-chain anti-rug tuning + V2 + V3 allowlists; attached to ChainConfig |
| `AntiRugMonitorState` | 6-value string union | UI-SPEC badge state for the dashboard positions column |
| `TriggerEvent` | interface — token, pair, signals, outcome, timestamp, chain | Payload broadcast to dashboard + circuit breaker on every trigger |
| `LpBaselineRow` | interface — 12 fields mirroring `lp_baseline` schema | camelCase domain shape returned by `loadLpBaseline` |

The `RugEvaluation` union deserves special note: it has FOUR variants (not three) and is the type-system enforcement of "vacuous-pass is unrepresentable":

```typescript
export type RugEvaluation =
    | { verdict: 'safe';        reason: 'partial-signal';        signals: RugSignals }
    | { verdict: 'allowlisted'; signals: RugSignals;             lockerName: string }
    | { verdict: 'unsafe';      reason: 'three-signal-trigger';  signals: RugSignals }
    | { verdict: 'unknown';     reason: string };  // NO signals — by design
```

Test 5 in `types.test.ts` ships a `@ts-expect-error` annotation on `const vacuous: RugEvaluation = { verdict: 'safe' };` — if the compile error vanishes (i.e., the type discipline weakens), the directive becomes "unused" and the build fails. This is the same compile-gate vacuous-pass guard pattern that locks Phase 18 `HoneypotResult` discipline.

### `src/anti-rug/events.ts` (94 lines, 9 exports)

Four event-signature strings (`PAIR_BURN_EVENT`, `PAIR_TRANSFER_EVENT`, `POOL_BURN_EVENT`, `POOL_COLLECT_EVENT`), four corresponding topic hashes computed via `ethers.id(...)` at module load, plus the `DEAD_ADDRESS` canonical lowercased burn-destination constant.

Topic-hash verification is unit-test-gated: Tests 6–10 in `types.test.ts` each assert that the module-load topic-hash constant equals the runtime `ethers.id(<signature>)` of the canonical event signature. A typo in any signature string (e.g., `uint258` instead of `uint256`) surfaces as a test failure at unit-test time before the detector silently never fires.

### `src/anti-rug/allowlist.ts` (199 lines, 3 exports, 1 logger)

Three exports:

- `verifyAllowlistAtStartup(ctx, allowlistV2, allowlistV3)` — D-LIST-VERIFY: iterates BOTH lists, skips DEAD_ADDRESS entries, calls `ctx.httpProvider.getCode(entry.address)` for every other entry. On `code === '0x'` (EOA), emits `log.fatal({chain, address, lockerName, provenance, poolType}, '...')` and `process.exit(1)`. After verification, emits exactly one `log.info` dump consolidating V2 + V3 entries with their provenance + poolType tags for operator visual verification.

- `isAddressAllowlisted(allowlist, address)` — case-insensitive lookup over the merged allowlist. Returns `{ hit: true, lockerName }` on match (first wins) or `{ hit: false }` on miss. The lockerName field is intentionally optional so callers can pattern-match cleanly.

- `mergeAllowlist(base, extras)` — concat preserving order (hardcoded first, env-overlay second). Duplicates between the two lists are KEPT as separate entries (operator chose to add them; preserve the provenance trail). Defensive against undefined inputs (returns `[]`).

The verify function takes BOTH V2 and V3 lists in a single call so the structured-log dump is one consolidated line per chain (vs two separate dumps). Caller pattern in Plan 19-05:

```typescript
await verifyAllowlistAtStartup(
    ctx,
    ctx.chain.antiRug.allowlistV2,
    ctx.chain.antiRug.allowlistV3,
);
```

The fail-loud pattern mirrors `src/chainRegistry.ts:376-389` (Phase 18 max-buy-tax-bps validator).

### `src/anti-rug/lpBaseline.ts` (218 lines, 3 exports, 1 logger)

Three exports:

- `snapshotLpBaseline(ctx, dex, tradeId, pairOrPoolAddress, feeTier)` — branches on `dex.dexType` discriminator:
  - V2 path: `new Contract(addr, PAIR_ABI, ctx.httpProvider)` → `Promise.all([getReserves(), totalSupply()])` → `upsertLpBaseline.run({ poolType: 'v2', v2Token0Reserve, v2Token1Reserve, v2LpTotalSupply, v3*: null, ... })`
  - V3 path: `new Contract(addr, V3_POOL_ABI, ctx.httpProvider)` → `Promise.all([liquidity(), slot0()])` → `upsertLpBaseline.run({ poolType: 'v3', v3ActiveLiquidity, v3TickAtSnapshot: Number(slot0[1]), v3FeeTier: feeTier, v3PositionNftId: null, v2*: null, ... })`
  - Common: reads block from `ctx.httpProvider.getBlockNumber()`, ts from `Math.floor(Date.now() / 1000)`, lowercases the address before persisting, emits one structured pino info line with `op: 'antirug.lp-baseline.snapshot'`.
  - Errors from on-chain calls PROPAGATE (no try/catch swallow).

- `loadLpBaseline(tradeId): LpBaselineRow | null` — wraps `getLpBaseline.get(tradeId)` and maps the snake_case columns (`trade_id`, `pool_type`, `pair_or_pool_address`, `v2_token0_reserve`, ...) to the camelCase `LpBaselineRow` domain shape. Returns `null` when no row exists.

- `clearLpBaseline(tradeId): number` — wraps `deleteLpBaseline.run(tradeId)` and returns the `changes` count (0 if no row, 1 if deleted). Called from Plan 19-05's `exitEngine.ts:504` full-close cleanup hook.

### `src/chainRegistry.ts` (modified — type-import swap)

Replaced the inline `AllowlistEntry` and `AntiRugConfig` interface declarations (Plan 19-02 had them inline as a forward-compat shim) with `import type { AllowlistEntry, AntiRugConfig } from './anti-rug/types'`. Re-exports both types via `export type { ... }` so existing import sites that pulled them from `./chainRegistry` continue to resolve without churn. The diff is purely structural — no behavioral change.

This is the "type contract handoff" required by Plan 19-03's done criteria: Plan 19-02 owned the declarations transitionally; Plan 19-03 hoists them to their canonical home in the `src/anti-rug/` module.

## Discriminated-Union Shape Decisions

**Why does `'allowlisted'` carry `lockerName` at the top level, not nested in signals?**

The lockerName is operator-facing identity ("Unicrypt UniLockerV2 ETH" vs "TeamFinance / TrustSwap Lock ETH") that the D-LIST-AUDIT structured log emits to the top level of the suppress-event entry. Nesting it inside `signals` would force every D-LIST-AUDIT log site to traverse `evaluation.signals.lockerName`, which is awkward and ambiguous: the lockerName is metadata ABOUT the suppression decision, not part of the signal evidence (which is "destination was X"). Top-level placement keeps the audit-trail log shape flat and the signal type uniform across variants.

**Why does `'unknown'` carry `reason` but no `signals`?**

"Unknown" specifically means "we could not evaluate the signals" — the failure mode IS the absence of signal data. Forcing a `signals` field on this variant would either lie (synthesize fake null values) or use null sentinels (which Phase 18 D-13/D-14 explicitly ban). The `reason: string` is free-form because the failure modes are open-ended (RPC errors, missing baseline, etc.) — distinguishing them at the type-system level would require enumeration that isn't worth the maintenance cost.

**Why does `'safe'` carry `reason: 'partial-signal'`?**

The only path to `verdict: 'safe'` is "ALL three signals evaluated cleanly but at least one missed its threshold" — i.e., a partial-signal hit. Encoding the reason as a literal string makes the audit trail explicit ("safe — partial-signal") and prevents `verdict: 'safe'` from being constructed by any code path that didn't run the full evaluation.

## Events.ts Topic-Hash Verification Approach

Each `*_TOPIC` constant is computed via `ethers.id(<signature>)` at module load. Tests 6–9 each assert the constant equals the runtime `ethers.id(<signature>)` of the canonical event signature literal. This protects against three failure modes:

1. **Typo in the signature string** (e.g., `Burn(address,uint258,uint256,address)`) — caught at unit-test time before the detector ever runs against a real chain.
2. **Drift from the upstream Solidity event** — if Uniswap ever changes the V3 Burn event (they won't, but defense-in-depth), the test will fail when the canonical hash changes.
3. **Module-import side-effect order** — by computing the topic at module load (not lazily at first event), any error in the signature surfaces before the detector subscribes.

The ERC-20 standard `Transfer(address,address,uint256)` topic is additionally asserted against the literal `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` (universally documented in the EIP-20 spec) as a cross-check against the ethers v6 implementation.

## V2-vs-V3 Baseline Snapshot Dispatch

`snapshotLpBaseline` uses the existing `dex.dexType` discriminator from the ChainConfig dex registry — no per-chain branching, no string compare on `dex.name`. The two paths read entirely disjoint Solidity ABIs (`PAIR_ABI` for V2, `V3_POOL_ABI` for V3) and write disjoint subsets of `lp_baseline` columns (V2 fields vs V3 fields, with the unused fields explicitly `null`). This is the same dispatch pattern as the existing safety bank's V2/V3 sell-sim branch at `src/utils/safetyBank/simulateSwapForChain.ts`.

`Promise.all` parallelism on the V2 / V3 read pair is intentional: `getReserves` + `totalSupply` are independent reads on the pair contract; `liquidity` + `slot0` are independent reads on the V3 pool contract. Running them sequentially would double the buy-success latency for no benefit.

## Open Questions for Downstream Plans

### Plan 19-05 (restart-resume): does the detector need `loadAllPendingLpBaselines()`?

Plan 19-03 exports `loadLpBaseline(tradeId): LpBaselineRow | null` — a single-row read. Plan 19-05's restart-resume path needs to load EVERY open trade's baseline to repopulate the detector's per-chain position registry. Two options:

1. **Plan 19-05 adds a new prepared statement** (`SELECT * FROM lp_baseline INNER JOIN trades ...`) in `src/utils/db.ts` and a corresponding `loadAllPendingLpBaselines()` helper in `src/anti-rug/lpBaseline.ts`.
2. **Plan 19-05 queries `trades` for open positions first, then calls `loadLpBaseline(tradeId)` per row.**

Option 2 is straightforward but issues N round-trips for N positions (negligible at v6.17 max ~10 open positions); option 1 is one query but adds surface to two files. Recommendation: **Option 1** — keeping the `lp_baseline` access patterns colocated in `lpBaseline.ts` is cleaner architecturally, and the additional helper is trivially testable.

### Plan 19-04 (detector): how does the evaluator distinguish "RPC unreachable" from "signal-1 did not trip"?

Both can produce a `verdict: 'unknown'` variant. The `reason: string` field is free-form so the detector can encode "RPC error fetching V2 reserves" vs "baseline missing for this trade" vs "QuoterV2 reverted on V3 sell-sim". Plan 19-04 should standardize the `reason` strings (e.g., enumerated constants in `types.ts`) so the dashboard can filter / count them.

### Plan 19-05 (env-overlay duplicates): how should the D-LIST-AUDIT log distinguish overlapping entries?

The `mergeAllowlist` function intentionally keeps duplicate addresses across hardcoded + env-overlay so both provenance rows survive. `isAddressAllowlisted` returns the FIRST match. If an operator overlays an address that already exists in the hardcoded base, the first match will be the hardcoded entry (since `mergeAllowlist` places hardcoded entries first). This is the right semantic — the hardcoded `lockerName` is more informative ("Unicrypt UniLockerV2 ETH" vs "Operator overlay") — but Plan 19-05's startup log might want to surface this overlap to the operator so they're aware their overlay was redundant. Recommendation: add a "duplicate detected" info log line at startup if any env-overlay address matches a hardcoded address.

## TDD Cycle

Each task followed the strict RED → GREEN cycle:

| Task | RED commit | GREEN commit | Tests added |
|------|------------|--------------|-------------|
| Task 1 (types.ts + events.ts) | `1f4310a` | `42d9013` | 11 |
| Task 2 (allowlist.ts) | `236ecaa` | `96e9181` | 9 |
| Task 3 (lpBaseline.ts) | `da2a6b7` | `2e339fa` | 9 |

Each RED commit reported the expected "Cannot find module" failure across all of that task's tests (modules didn't exist yet); each GREEN commit reported full task tests passing + zero regressions in the full unit suite.

## Deviations from Plan

**None — plan executed exactly as written.**

Two minor refinements (still inside the plan's spec):

1. **Test 3 (lpBaseline.ts mocking strategy)** — the plan specified `vi.mock('ethers', ...)` with a `vi.fn().mockImplementation(...)` Contract constructor. The first GREEN attempt failed because vitest config sets `mockReset: true` globally, which wipes `mockImplementation` between tests. Replaced the `vi.fn()` Contract mock with a class-based `MockContract` whose constructor body reads per-test mock instances via a `globalThis` bridge populated in `beforeEach`. This is functionally identical to the plan's intent but survives the global config. The choice is documented inline in the test file.

2. **`verifyAllowlistAtStartup` signature** — the plan's PATTERNS.md sketch at lines 389-407 shows a single-list signature `verifyAllowlistAtStartup(ctx, allowlist)`. The plan's `<action>` section at line 217 specifies "takes both V2 and V3 lists in one call". Implemented the latter (two-list signature: `verifyAllowlistAtStartup(ctx, allowlistV2, allowlistV3)`) per the action's explicit "Discretionary calls" guidance. The consolidated log line is one info-line per chain rather than two.

## Verification

| Check | Result |
|-------|--------|
| `npm run test:unit -- anti-rug/types` | 11/11 passing |
| `npm run test:unit -- anti-rug/allowlist` | 9/9 passing |
| `npm run test:unit -- anti-rug/lpBaseline` | 9/9 passing |
| `npm run test:unit` (full unit suite) | 343/343 passing — zero regressions vs 314 baseline |
| `npx tsc --noEmit` (main tsconfig) | clean |
| `npx tsc --noEmit -p tsconfig.bot.json` | clean |
| `grep` 4 RugEvaluation variants | found at types.ts:85,90,95,100 |
| `grep` 7 exports from types.ts | `7` (>= 7 required) |
| `grep` `module: 'antiRug:` child loggers | 2 (`antiRug:allowlist`, `antiRug:lpBaseline`) — types + events pure modules per plan |
| chainRegistry diff vs Plan 19-02 commit | only type-import swap (no behavioural change) |

## Files Touched

| File | Action | Lines | Commit |
|------|--------|-------|--------|
| `test/unit/anti-rug/types.test.ts` | created | +186 | `1f4310a` |
| `src/anti-rug/types.ts` | created | +215 | `42d9013` |
| `src/anti-rug/events.ts` | created | +94 | `42d9013` |
| `src/chainRegistry.ts` | modified | +12/-25 | `42d9013` |
| `test/unit/anti-rug/allowlist.test.ts` | created | +348 | `236ecaa` |
| `src/anti-rug/allowlist.ts` | created | +199 | `96e9181` |
| `test/unit/anti-rug/lpBaseline.test.ts` | created | +408 | `da2a6b7` + `2e339fa` |
| `src/anti-rug/lpBaseline.ts` | created | +218 | `2e339fa` |

## Hand-off

Plan 19-04 (`src/anti-rug/detector.ts`) is unblocked — can:
- `import { PAIR_BURN_TOPIC, PAIR_TRANSFER_TOPIC, POOL_BURN_TOPIC, POOL_COLLECT_TOPIC } from './events';`
- `import type { RugEvaluation, RugSignals, TriggerEvent } from './types';`
- `import { isAddressAllowlisted } from './allowlist';`
- `import { loadLpBaseline } from './lpBaseline';`

Plan 19-05 (bot startup + buy-success wiring) is unblocked — can:
- `import { verifyAllowlistAtStartup } from './anti-rug/allowlist';` at `startMultiChainBot` startup, BEFORE detector listeners start.
- `import { snapshotLpBaseline } from './anti-rug/lpBaseline';` at V2/V3 buy-success branches, parallel to `startExitMonitor`.
- `import { clearLpBaseline } from './anti-rug/lpBaseline';` at `exitEngine.ts:504` full-close cleanup hook.

Plan 19-06 (dashboard) is unblocked — can:
- `import type { AntiRugMonitorState, TriggerEvent } from '../../src/anti-rug/types';` for the positions-column badge component + frontrun-distribution panel.

Requirements closed: **ANTIRUG-04** (foundation for the schema migration consumers), **ANTIRUG-06** (allowlist verification + lookup helpers), **ANTIRUG-15** (V3 allowlist surface exposed via AntiRugConfig.allowlistV3), **ANTIRUG-16** (LP-baseline domain row + persistence helpers).

## Self-Check: PASSED

- File `src/anti-rug/types.ts` — **FOUND**
- File `src/anti-rug/events.ts` — **FOUND**
- File `src/anti-rug/allowlist.ts` — **FOUND**
- File `src/anti-rug/lpBaseline.ts` — **FOUND**
- File `test/unit/anti-rug/types.test.ts` — **FOUND**
- File `test/unit/anti-rug/allowlist.test.ts` — **FOUND**
- File `test/unit/anti-rug/lpBaseline.test.ts` — **FOUND**
- File `src/chainRegistry.ts` (modified — imports types from ./anti-rug/types) — **FOUND**
- Commit `1f4310a` (Task 1 RED — types.test.ts) — **FOUND**
- Commit `42d9013` (Task 1 GREEN — types.ts + events.ts + chainRegistry switch) — **FOUND**
- Commit `236ecaa` (Task 2 RED — allowlist.test.ts) — **FOUND**
- Commit `96e9181` (Task 2 GREEN — allowlist.ts) — **FOUND**
- Commit `da2a6b7` (Task 3 RED — lpBaseline.test.ts) — **FOUND**
- Commit `2e339fa` (Task 3 GREEN — lpBaseline.ts) — **FOUND**
- 29/29 new tests passing (11 + 9 + 9) — **VERIFIED** via `npm run test:unit -- anti-rug/`
- 343/343 full unit suite passing — **VERIFIED**
- tsc clean across both tsconfig projects — **VERIFIED**
