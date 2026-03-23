---
phase: 04-multi-chain-architecture
plan: 01
subsystem: infra
tags: [ethers-v6, multi-chain, chain-registry, websocket, provider, typescript]

# Dependency graph
requires:
  - phase: 03-sqlite-storage-code-quality
    provides: pino structured logging, singleton provider pattern, ethers v6 foundation
provides:
  - ChainConfig type with all per-chain fields (RPC, DEX, MEV, safety, gas, capital)
  - Chain registry builder with 4-chain support (ETH, BSC, Base, Arbitrum)
  - ChainContext type for pipeline injection (provider, wallet, logger per chain)
  - WebSocket provider cache in provider.ts
  - Per-chain env var documentation in config.ts and .env.example
affects: [04-02-PLAN, 04-03-PLAN, 04-04-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [chain-registry-pattern, chain-context-injection, per-chain-env-vars]

key-files:
  created: [src/chainRegistry.ts]
  modified: [src/config.ts, src/utils/provider.ts, .env.example]

key-decisions:
  - "Provider.ts extended in Task 1 (not Task 2) because chainRegistry.ts imports getWsProvider -- blocking dependency"
  - "ETH_RPC_URL falls back to ALCHEMY_URL for backward compatibility during migration"
  - "Registry builds all 4 chains but only enables those in ENABLED_CHAINS (default: eth)"
  - "MEV auth keys (FLASHBOTS_AUTH_KEY, BLOXROUTE_AUTH_HEADER) validated only for enabled chains"

patterns-established:
  - "Chain registry pattern: static templates with hardcoded addresses + dynamic env vars"
  - "ChainContext injection: chain, httpProvider, wsProvider, wallet, log bundled for pipeline"
  - "Per-chain env var naming: PREFIX_RPC_URL, PREFIX_WS_URL, PREFIX_SNIPE_AMOUNT, PREFIX_MAX_CAPITAL"

requirements-completed: [CHAIN-01, CHAIN-02]

# Metrics
duration: 13min
completed: 2026-03-22
---

# Phase 4 Plan 01: Chain Registry Foundation Summary

**Typed ChainConfig registry with ETH/BSC/Base/Arbitrum templates, ENABLED_CHAINS env-driven activation, and WebSocket provider support in provider.ts**

## Performance

- **Duration:** 13 min
- **Started:** 2026-03-22T23:40:11Z
- **Completed:** 2026-03-22T23:53:46Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created `src/chainRegistry.ts` with full type system: ChainConfig, DexConfig, GasConfig, SafetyApiConfig, MevStrategyType, ChainContext
- Built 4-chain registry with correct hardcoded addresses: ETH (1), BSC (56), Base (8453), Arbitrum (42161) -- each with 2 DEXes, chain-specific MEV strategy, safety API routing, gas config
- Extended provider.ts with WebSocket provider cache (getWsProvider, removeWsProvider) while preserving backward compatibility
- Added 18 new per-chain env vars to config.ts REQUIRED_ENV_VARS and documented all 20+ env vars in .env.example

## Task Commits

Each task was committed atomically:

1. **Task 1: Create chainRegistry.ts with types and registry builder** - `07f6233` (feat)
2. **Task 2: Refactor config.ts for multi-chain and update .env.example** - `91866a1` (feat)

## Files Created/Modified
- `src/chainRegistry.ts` - Chain registry types, 4-chain templates, buildChainRegistry(), createChainContext(), getEnabledChains()
- `src/utils/provider.ts` - Extended with WebSocket provider cache (getWsProvider, removeWsProvider), optional rpcUrl parameter
- `src/config.ts` - Added 18 multi-chain env vars to validation, ETH_RPC_URL fallback, legacy migration comments
- `.env.example` - Comprehensive documentation of all env vars organized by chain

## Decisions Made
- Extended provider.ts in Task 1 instead of Task 2 because chainRegistry.ts imports getWsProvider -- without it, Task 1 would not compile
- ETH_RPC_URL takes priority over ALCHEMY_URL in the rpc map, preserving backward compatibility while enabling new multi-chain path
- Registry always builds all 4 chain templates but marks only ENABLED_CHAINS entries as `enabled: true` -- disabled chains still appear in the registry for inspection
- MEV auth validation (FLASHBOTS_AUTH_KEY, BLOXROUTE_AUTH_HEADER) only fails for enabled chains -- allows running with only ETH without needing a bloXroute key

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended provider.ts in Task 1 instead of Task 2**
- **Found during:** Task 1 (chainRegistry.ts creation)
- **Issue:** chainRegistry.ts imports `getWsProvider` from `./utils/provider`, but this function was planned for Task 2. Task 1 could not compile without it.
- **Fix:** Added getWsProvider(), removeWsProvider(), and optional rpcUrl parameter to provider.ts as part of Task 1
- **Files modified:** src/utils/provider.ts
- **Verification:** `npx tsc --noEmit` shows zero errors in chainRegistry.ts and provider.ts
- **Committed in:** 07f6233 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Provider extension moved from Task 2 to Task 1. Task 2 still committed config.ts and .env.example changes. No scope creep -- same total work, just reordered.

## Issues Encountered
- Pre-existing TypeScript errors exist in scripts/ and src/bot.ts (addresses.json spread, blocklist module, missing artifacts) -- these are out-of-scope and predate this plan
- addresses.json appears to be empty (1 line), which causes CONFIG spread to lose address properties -- this is a pre-existing issue from earlier phases

## Known Stubs
None -- all data is wired from environment variables and hardcoded chain constants.

## Next Phase Readiness
- Chain registry foundation complete -- Plan 02 (MEV strategies) can import ChainConfig and ChainContext types
- Plan 03 (chain-aware listeners) can use buildChainRegistry() and createChainContext() to spawn per-chain+DEX event subscriptions
- Plan 04 (safety API routing) can use ChainConfig.safetyApis to dispatch to correct API providers

---
*Phase: 04-multi-chain-architecture*
*Completed: 2026-03-22*
