---
phase: 01-bug-fixes-hardening
plan: 04
subsystem: config
tags: [env-vars, network-config, dotenv, startup-validation]

# Dependency graph
requires:
  - phase: 01-bug-fixes-hardening
    provides: "Flashbots relay map keyed by CONFIG.network (plan 02), env var validation framework (plan 01)"
provides:
  - "Env-driven CONFIG.network with validation and default"
  - ".env.example documenting all 11 env vars"
  - "Mainnet RPC entry in rpc map"
affects: [02-ethers-v6-migration, 04-multi-chain]

# Tech tracking
tech-stack:
  added: []
  patterns: ["env var validation before config export", "network input normalization with lowercase"]

key-files:
  created: [".env.example"]
  modified: ["src/config.ts"]

key-decisions:
  - "Both sepolia and mainnet RPC entries use same ALCHEMY_URL -- user sets correct URL per network"
  - "Network validation runs after env var validation but before CONFIG export"

patterns-established:
  - "Optional env vars with defaults: read from process.env with || fallback, validate against allowed values"

requirements-completed: [FIX-06]

# Metrics
duration: 4min
completed: 2026-03-19
---

# Phase 01 Plan 04: Env-Driven Network Config and .env.example Summary

**NETWORK env var controls CONFIG.network with sepolia default and startup validation; .env.example documents all 8 required + 3 optional vars**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-19T20:46:14Z
- **Completed:** 2026-03-19T20:50:11Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- CONFIG.network now reads from NETWORK env var with 'sepolia' default instead of hardcoded value
- Invalid NETWORK values produce clear startup error listing valid options (sepolia, mainnet, bsc)
- Added mainnet entry to rpc map so NETWORK=mainnet selects mainnet Flashbots relay
- Created .env.example documenting all 11 environment variables with sections, placeholders, and markers

## Task Commits

Each task was committed atomically:

1. **Task 1: Make CONFIG.network driven by NETWORK env var with validation** - `2285e57` (feat)
2. **Task 2: Create .env.example with all required and optional env vars** - `39f1fad` (chore)

## Files Created/Modified
- `src/config.ts` - Added mainnet RPC entry, NETWORK env var reading with default, network validation before CONFIG export, NETWORK in REQUIRED_ENV_VARS
- `.env.example` - New file documenting all required and optional env vars grouped by function

## Decisions Made
- Both sepolia and mainnet rpc entries point to the same ALCHEMY_URL -- the user sets the correct Alchemy endpoint URL for whichever network they configure. This avoids requiring separate env vars per network.
- Network validation placed between validateEnvVars() and CONFIG export so env vars are checked first, then network is validated before any config is consumed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 01 gap closure complete -- all UAT gaps addressed
- CONFIG.network is now dynamic, ready for multi-chain extension in Phase 04
- .env.example provides onboarding documentation for new environments

## Self-Check: PASSED

- FOUND: src/config.ts
- FOUND: .env.example
- FOUND: 01-04-SUMMARY.md
- FOUND: commit 2285e57
- FOUND: commit 39f1fad

---
*Phase: 01-bug-fixes-hardening*
*Completed: 2026-03-19*
