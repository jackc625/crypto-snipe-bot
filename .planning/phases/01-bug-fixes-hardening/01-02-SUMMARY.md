---
phase: 01-bug-fixes-hardening
plan: 02
subsystem: infra
tags: [flashbots, nonce, relay, ethers, transaction-retry]

# Dependency graph
requires: []
provides:
  - Dynamic Flashbots relay selection based on CONFIG.network
  - Incrementing nonce on bundle retry (baseNonce + retries)
  - Explicit error on unsupported network
affects: [multi-chain, flashbots-integration, transaction-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FLASHBOTS_RELAYS lookup map for network-to-relay URL mapping"
    - "baseNonce + retries pattern for incrementing nonce in retry loops"

key-files:
  created: []
  modified:
    - src/utils/flashbots.ts
    - src/utils/txManager.ts

key-decisions:
  - "Used Record<string, {url, network}> map for relay config rather than switch/case for easier extension"

patterns-established:
  - "Network-keyed config maps: use Record<string, T> with runtime lookup and explicit throw for unsupported values"

requirements-completed: [FIX-02, FIX-03]

# Metrics
duration: 5min
completed: 2026-03-19
---

# Phase 01 Plan 02: Flashbots Relay & Nonce Fix Summary

**Dynamic Flashbots relay selection from CONFIG.network (sepolia/mainnet) and incrementing nonce on each bundle retry**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-19T19:43:21Z
- **Completed:** 2026-03-19T19:48:52Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Flashbots relay URL and network name now selected dynamically from FLASHBOTS_RELAYS map based on CONFIG.network
- Sepolia relay (relay-sepolia.flashbots.net) properly configured alongside mainnet relay
- Unsupported network values throw explicit error listing valid options
- Bundle retry nonce increments with baseNonce + retries instead of reusing stale nonce

## Task Commits

Each task was committed atomically:

1. **Task 1: Dynamic Flashbots relay selection and nonce increment on retry** - `d8070c4` (fix)

## Files Created/Modified
- `src/utils/flashbots.ts` - Dynamic relay selection via FLASHBOTS_RELAYS lookup map keyed by CONFIG.network
- `src/utils/txManager.ts` - Nonce renamed to baseNonce, incremented by retry count on each attempt

## Decisions Made
- Used `Record<string, {url, network}>` map pattern for relay configuration rather than switch/case, making it trivial to add new networks later

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript compilation errors in `@types/node` (overload signature) and `config.ts` (missing `--resolveJsonModule`) are unrelated to this plan's changes. Both modified files compile without errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Flashbots integration now correctly targets the network matching CONFIG.network
- Bundle retries can actually land on-chain with incrementing nonces
- Ready for multi-chain extension in later phases

## Self-Check: PASSED

- FOUND: src/utils/flashbots.ts
- FOUND: src/utils/txManager.ts
- FOUND: 01-02-SUMMARY.md
- FOUND: commit d8070c4

---
*Phase: 01-bug-fixes-hardening*
*Completed: 2026-03-19*
