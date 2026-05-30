---
phase: 04-multi-chain-architecture
plan: 02
subsystem: infra
tags: [mev, flashbots, bloxroute, strategy-pattern, multi-chain, typescript]

# Dependency graph
requires:
  - phase: 04-multi-chain-architecture
    plan: 01
    provides: ChainConfig, ChainContext, MevStrategyType, chain registry with mevStrategy/mevConfig fields
provides:
  - MevStrategy interface with healthCheck() and sendTransaction()
  - FlashbotsMevStrategy for ETH bundle submission
  - BloxrouteMevStrategy for BSC bsc_private_tx JSON-RPC
  - PassthroughMevStrategy for Base/Arbitrum direct submission
  - createMevStrategy factory mapping chain.mevStrategy to implementation
  - sendTxWithRetry with ChainContext overload for multi-chain dispatch
affects: [04-03-PLAN, 04-04-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [strategy-pattern, duck-type-overload, exhaustive-switch]

key-files:
  created: [src/utils/mevStrategies/types.ts, src/utils/mevStrategies/flashbots.ts, src/utils/mevStrategies/bloxroute.ts, src/utils/mevStrategies/passthrough.ts]
  modified: [src/utils/txManager.ts]

key-decisions:
  - "Auth keys read from mevConfig (set by chainRegistry) with process.env fallback for standalone use"
  - "Duck-type check ('chain' in providerOrCtx) selects multi-chain vs legacy path at runtime"
  - "Exhaustive switch in createMevStrategy ensures compile-time safety when MevStrategyType expands"
  - "Passthrough healthCheck always returns true -- Base/Arb have natively private mempools"

patterns-established:
  - "Strategy pattern: MevStrategy interface with chain-specific implementations in mevStrategies/ directory"
  - "Factory dispatch: createMevStrategy(chain) maps chain.mevStrategy to correct class"
  - "Overload pattern: single function accepts both legacy and multi-chain signatures via duck-typing"

requirements-completed: [CHAIN-04]

# Metrics
duration: 7min
completed: 2026-03-23
---

# Phase 4 Plan 02: MEV Strategy Pattern Summary

**MevStrategy interface with Flashbots (ETH), bloXroute BSC bsc_private_tx, and passthrough (Base/Arb) implementations dispatched by createMevStrategy factory in txManager**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-23T00:08:36Z
- **Completed:** 2026-03-23T00:15:36Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created MevStrategy interface defining healthCheck() and sendTransaction() contract for all chain MEV adapters
- Extracted existing Flashbots bundle logic from txManager.ts into FlashbotsMevStrategy class with relay URL and auth key from ChainConfig.mevConfig
- Implemented BloxrouteMevStrategy for BSC using bsc_private_tx JSON-RPC endpoint with Authorization header
- Implemented PassthroughMevStrategy for Base/Arbitrum direct transaction submission with EIP-1559/legacy gas auto-detection
- Refactored txManager.ts with createMevStrategy factory and ChainContext-aware sendTxWithRetry overload while preserving legacy single-chain path

## Task Commits

Each task was committed atomically:

1. **Task 1: Create MEV strategy interface and three implementations** - `4115c54` (feat)
2. **Task 2: Refactor txManager.ts to dispatch via ChainContext MEV strategy** - `6f0bc13` (feat)

## Files Created/Modified
- `src/utils/mevStrategies/types.ts` - MevStrategy interface with healthCheck() and sendTransaction() signatures
- `src/utils/mevStrategies/flashbots.ts` - FlashbotsMevStrategy for ETH: FlashbotsBundleProvider.create, sendBundle with nonce incrementing
- `src/utils/mevStrategies/bloxroute.ts` - BloxrouteMevStrategy for BSC: axios POST to bsc_private_tx with Authorization header
- `src/utils/mevStrategies/passthrough.ts` - PassthroughMevStrategy for Base/Arb: direct wallet.sendTransaction with EIP-1559/legacy auto-detection
- `src/utils/txManager.ts` - Added createMevStrategy factory, ChainContext-aware sendTxWithRetry overload, kept legacy path unchanged

## Decisions Made
- Auth keys are read from mevConfig (populated by chainRegistry from env vars) with direct process.env fallback, allowing strategy classes to work both within the registry pipeline and in standalone tests
- Duck-type check (`'chain' in providerOrCtx && 'httpProvider' in providerOrCtx`) selects multi-chain vs legacy path at runtime without requiring separate function names
- Exhaustive switch with `never` type in createMevStrategy ensures any new MevStrategyType values cause a compile-time error until handled
- Passthrough healthCheck always returns true since Base and Arbitrum have natively private mempools per D-05 research findings

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript errors in scripts/, src/bot.ts, src/utils/blocklist.ts, src/utils/tokenSafety.ts, src/utils/pairDiscovery.ts (addresses.json spread, blocklist module, missing artifacts) -- these predate this plan and are out of scope. Zero errors in files created or modified by this plan.

## User Setup Required

None - no external service configuration required. bloXroute and Flashbots auth keys are already documented in .env.example from Plan 01.

## Known Stubs
None -- all strategy implementations contain complete logic wired to real service endpoints via environment variables.

## Next Phase Readiness
- MEV strategy pattern complete -- Plan 03 (chain-aware listeners) can use ChainContext with sendTxWithRetry for per-chain snipe submission
- Plan 04 (bot orchestrator) can call createMevStrategy(chain).healthCheck() for pre-flight MEV service verification per D-07
- createMevStrategy is exported for direct use outside txManager (e.g., health check loops, strategy inspection)

## Self-Check: PASSED

All 6 files verified present. Both task commits (4115c54, 6f0bc13) found in git log.

---
*Phase: 04-multi-chain-architecture*
*Completed: 2026-03-23*
