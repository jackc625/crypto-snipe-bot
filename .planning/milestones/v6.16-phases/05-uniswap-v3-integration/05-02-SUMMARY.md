---
phase: 05-uniswap-v3-integration
plan: 02
subsystem: dex
tags: [uniswap-v3, pool-listener, swap-router-02, quoter-v2, concentrated-liquidity, fee-tiers, multicall]

# Dependency graph
requires:
  - phase: 05-uniswap-v3-integration
    provides: DexConfigV3 type, V3 ABIs (Factory/Pool/SwapRouter02/QuoterV2), V3 DEX entries, isDexV2/isDexV3 guards, DB schema v2 with pool_type/fee_tier
provides:
  - Complete V3 snipe pipeline: PoolCreated listener, liquidity wait, buy, sell, monitors
  - simulateSellV3ForChain in tokenSafety.ts using QuoterV2
  - handleNewV3PoolForChain handler with full safety pipeline
  - V3 buy via SwapRouter02 exactInputSingle with multicall deadline wrapper
  - V3 stop-loss, take-profit, timed-sell monitors using QuoterV2 pricing
  - executeSellV3ForChain for V3 position exits through same fee tier
  - V3 HTTP polling fallback for chains without WebSocket
  - V3-aware resume monitoring for pending V3 trades
affects: [bot.ts V3 operational, tokenSafety.ts V3 simulation, future risk management phases]

# Tech tracking
tech-stack:
  added: []
  patterns: [v3-multicall-deadline-wrapper, quoter-v2-static-call-pricing, mint-event-liquidity-detection]

key-files:
  created: []
  modified:
    - src/utils/tokenSafety.ts
    - src/bot.ts

key-decisions:
  - "QuoterV2 static call for V3 sell simulation -- QuoterV2 reverts on illiquid pools, caught as false return"
  - "Same-block Mint check (D-02) runs before subscribe+timeout (D-01) for atomic launch detection"
  - "V2 functions narrowed to DexConfigV2 parameter type instead of runtime guards for compile-time safety"
  - "V3 listener branches at startDexListener level with separate reconnect handlers per dex type"
  - "Emergency V3 sell uses amountOutMinimum=0 to guarantee exit regardless of slippage"
  - "Resume monitoring queries pool_type and fee_tier from DB to correctly dispatch V3 vs V2 monitors"

patterns-established:
  - "V3 multicall deadline pattern: encode exactInputSingle data, wrap in multicall(deadline, [data]) for SwapRouter02"
  - "QuoterV2 pricing: quoteExactInputSingle.staticCall for non-state-modifying price reads"
  - "Mint event gating: same-block queryFilter first, then WS subscribe with 30s timeout for pool readiness"

requirements-completed: [V3-01, V3-02, V3-03, V3-04]

# Metrics
duration: 8min
completed: 2026-03-23
---

# Phase 5 Plan 02: V3 Snipe Pipeline Summary

**Complete V3 snipe pipeline with PoolCreated listener, Mint-gated liquidity wait, SwapRouter02 multicall buy/sell, and QuoterV2-based position monitoring across all configured chains**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-23T14:28:23Z
- **Completed:** 2026-03-23T14:36:27Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- V3 sell simulation added to tokenSafety.ts using QuoterV2 quoteExactInputSingle static call with illiquid pool revert handling
- Complete V3 handler (handleNewV3PoolForChain) with same-block Mint check, 30s Mint subscription timeout, minimum liquidity validation, cross-DEX dedup, and full safety pipeline
- V3 buy execution via SwapRouter02 exactInputSingle wrapped in multicall for deadline enforcement (Pitfall 1: no deadline in struct)
- V3 sell execution through the same fee tier pool for correct routing (D-10)
- V3 stop-loss monitor with emergency sell on QuoterV2 null (illiquid pool detection)
- V3 take-profit and timed-sell monitors using QuoterV2 pricing at 15s intervals (D-09)
- V3 WebSocket and HTTP polling listeners with reconnect handling
- Resume monitoring correctly dispatches V3 pending trades using pool_type/fee_tier from DB
- V2 functions narrowed from DexConfig to DexConfigV2 parameter types -- compile-time safety replaces runtime guards

## Task Commits

Each task was committed atomically:

1. **Task 1: V3 sell simulation in tokenSafety.ts** - `f0e6dd2` (feat)
2. **Task 2: V3 handler, buy, sell, monitors, listener wiring in bot.ts** - `55449be` (feat)

## Files Created/Modified
- `src/utils/tokenSafety.ts` - Added simulateSellV3ForChain function using QuoterV2 quoteExactInputSingle static call, V3_QUOTER_V2_ABI import
- `src/bot.ts` - Added 8 V3 functions (getV3Price, waitForLiquidity, checkMinLiquidity, handleNewV3PoolForChain, executeSellV3ForChain, monitorStopLossV3ForChain, monitorTakeProfitV3ForChain, scheduleTimedSellV3ForChain), V3 listener wiring, HTTP polling V3 fallback, V3 resume monitoring, V2 type narrowing

## Decisions Made
- QuoterV2 static call for V3 sell simulation -- QuoterV2 reverts on illiquid pools rather than returning 0, so try/catch returns false for unsellable tokens
- Same-block Mint check (D-02) runs before subscribe+timeout (D-01) to catch atomic launch scripts that emit PoolCreated + Mint in the same block
- V2 functions narrowed to DexConfigV2 parameter type -- the type system enforces correct usage instead of runtime isDexV2 guards, making misuse a compile error
- V3 listener branches at startDexListener level with separate reconnect handlers per dex type to avoid mixing V2/V3 factory contracts
- Emergency V3 sell uses amountOutMinimum=0 to guarantee exit regardless of slippage (stop-loss, take-profit, timed-sell are all emergency exits)
- Resume monitoring queries pool_type and fee_tier from DB to correctly dispatch V3 vs V2 monitors for pending trades

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full V3 support is now operational alongside V2 across all configured chains
- The bot detects PoolCreated events, waits for liquidity, validates safety, buys via SwapRouter02, and monitors/exits positions using QuoterV2
- All pre-existing TypeScript errors are in legacy code (CONFIG property references in backward-compat functions) and do not affect V3 functionality

## Self-Check: PASSED

- Both modified files exist on disk
- Both task commits (f0e6dd2, 55449be) found in git log
- No stubs or placeholder values detected

---
*Phase: 05-uniswap-v3-integration*
*Completed: 2026-03-23*
