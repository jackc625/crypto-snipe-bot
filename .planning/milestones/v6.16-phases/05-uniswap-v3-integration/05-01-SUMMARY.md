---
phase: 05-uniswap-v3-integration
plan: 01
subsystem: infra
tags: [uniswap-v3, dex, abi, sqlite, discriminated-union, type-guards]

# Dependency graph
requires:
  - phase: 04-multi-chain-architecture
    provides: Chain registry with DexConfig, ChainConfig, multi-chain bot.ts
provides:
  - DexConfigV2/DexConfigV3 discriminated union with dexType field
  - V3 ABI exports (Factory, Pool, SwapRouter02, QuoterV2)
  - V3 DEX entries for ETH, BSC (Uniswap+PancakeSwap), Base, Arbitrum
  - minLiquidityThreshold on ChainConfig with env var override
  - isDexV2/isDexV3 type guard helpers
  - DB schema v2 with pool_type and fee_tier columns
  - insertTrade prepared statement accepting V2/V3 pool metadata
affects: [05-02-PLAN, bot.ts V3 listeners, V3 handler, V3 buy/sell/monitor]

# Tech tracking
tech-stack:
  added: []
  patterns: [discriminated-union-with-type-guards, schema-migration-versioning]

key-files:
  created: []
  modified:
    - src/chainRegistry.ts
    - src/utils/abis.ts
    - src/utils/db.ts
    - src/bot.ts

key-decisions:
  - "DexConfigBase + DexConfigV2/V3 discriminated union via dexType field for compile-time V2/V3 narrowing"
  - "SwapRouter02 used universally for V3 (deadline via multicall wrapper, not struct)"
  - "BSC gets both Uniswap V3 and PancakeSwap V3 entries per research recommendation"
  - "V3 early-return guards in bot.ts as temporary measure until Plan 02 adds full V3 handling"
  - "pool_type defaults to 'v2' so existing trades auto-migrate without data backfill"

patterns-established:
  - "isDexV2/isDexV3 type guards: always narrow DexConfig before accessing V2/V3-specific properties"
  - "Schema migration versioning: increment CURRENT_SCHEMA_VERSION, add if (version < N) block"

requirements-completed: [V3-01, V3-03, V3-04]

# Metrics
duration: 8min
completed: 2026-03-23
---

# Phase 5 Plan 01: V3 Foundation Summary

**DexConfig discriminated union with V3 ABIs, chain registry V3 entries for 4 chains, and DB schema v2 with pool_type/fee_tier columns**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-23T14:13:26Z
- **Completed:** 2026-03-23T14:21:32Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- DexConfig replaced with DexConfigV2/DexConfigV3 discriminated union, enabling compile-time safety for V2 vs V3 DEX operations
- All 4 V3 ABI sets exported (Factory PoolCreated event, Pool slot0/liquidity, SwapRouter02 exactInputSingle/multicall, QuoterV2 quoteExactInputSingle)
- V3 DEX entries added across all 4 chains with verified contract addresses (BSC has both Uniswap V3 and PancakeSwap V3)
- DB schema migrated to v2 with pool_type (default 'v2') and fee_tier columns for V3 position tracking
- minLiquidityThreshold added to ChainConfig with per-chain env var override for dust-pool filtering

## Task Commits

Each task was committed atomically:

1. **Task 1: DexConfig discriminated union, V3 ABIs, chain registry V3 entries, minLiquidityThreshold** - `6d20e67` (feat)
2. **Task 2: DB schema migration v2 -- add pool_type and fee_tier columns** - `7bec685` (feat)

## Files Created/Modified
- `src/chainRegistry.ts` - DexConfigV2/V3 discriminated union, V3 DEX entries for all chains, minLiquidityThreshold, isDexV2/isDexV3 type guards
- `src/utils/abis.ts` - V3_FACTORY_ABI, V3_POOL_ABI, V3_SWAP_ROUTER_ABI, V3_QUOTER_V2_ABI exports
- `src/utils/db.ts` - Schema v2 migration (pool_type, fee_tier), updated insertTrade and P&L query
- `src/bot.ts` - V3 early-return guards, insertTrade calls updated with poolType/feeTier, isDexV2/isDexV3 imports

## Decisions Made
- DexConfigBase + DexConfigV2/V3 discriminated union via dexType field -- enables TypeScript to narrow at compile time, preventing accidental V2 property access on V3 configs
- SwapRouter02 used universally (not SwapRouter) -- deadline is passed via multicall wrapper, not in the swap struct
- BSC gets both Uniswap V3 and PancakeSwap V3 entries per research recommendation for maximum coverage
- V3 early-return guards in bot.ts as temporary 1-line measures (e.g., `if (isDexV3(dex)) return;`) to keep tsc passing until Plan 02 adds full V3 handling
- pool_type column defaults to 'v2' so existing v1 schema trades auto-migrate without data backfill
- fee_tier is nullable INTEGER -- null for V2 trades, numeric (100/500/3000/10000) for V3 trades

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- V3 type system, ABIs, addresses, and DB schema are fully in place
- Plan 02 can now implement V3 pool listener, handler, buy/sell, and monitoring using the DexConfigV3 type and V3 ABIs
- All existing V2 functionality continues to work with dexType narrowing guards

## Self-Check: PASSED

- All 4 modified files exist on disk
- Both task commits (6d20e67, 7bec685) found in git log
- No stubs or placeholder values detected

---
*Phase: 05-uniswap-v3-integration*
*Completed: 2026-03-23*
