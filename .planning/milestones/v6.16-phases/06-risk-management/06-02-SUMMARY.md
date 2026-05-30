---
phase: 06-risk-management
plan: 02
subsystem: risk
tags: [risk-management, snipe-pipeline, bot-integration, capital-tracking]

# Dependency graph
requires:
  - phase: 06-risk-management
    provides: canSnipe() gate function, recordSnipe() cooldown tracker, RiskCheckResult interface
  - phase: 04-multi-chain-architecture
    provides: ChainContext with chain.name/snipeAmount/maxCapital, handleNewPairForChain/handleNewV3PoolForChain handlers
  - phase: 05-uniswap-v3-integration
    provides: handleNewV3PoolForChain handler with V3-specific safety pipeline
provides:
  - "Risk-gated snipe pipeline in all 3 handler functions (V2 multi-chain, V3 multi-chain, legacy single-chain)"
  - "DB-backed risk enforcement replacing in-memory capitalDeployed Map"
  - "Telegram alerts with structured risk rejection details for all snipe paths"
affects: [web dashboard risk display, future exit strategy integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [risk-gate-before-safety-checks, result-object-telegram-alert]

key-files:
  created: []
  modified: [src/bot.ts]

key-decisions:
  - "Risk gate inserted BEFORE expensive safety API calls (anti-pattern guidance: fast-fail before network calls)"
  - "Legacy handleNewPair uses hardcoded 'eth' chain and '1.0' maxCapital matching ETH chain template defaults"
  - "recordSnipe() placed after sendTxWithRetry (Pitfall 5: never before TX confirmation)"

patterns-established:
  - "Risk Gate Integration: canSnipe() call with structured RiskCheckResult handling before safety pipeline in every handler"

requirements-completed: [RISK-01, RISK-02, RISK-03, RISK-04, RISK-05]

# Metrics
duration: 4min
completed: 2026-03-23
---

# Phase 6 Plan 02: Risk Gate Pipeline Integration Summary

**Risk gate wired into all 3 snipe handlers (V2, V3, legacy) with canSnipe() before safety checks, recordSnipe() after TX, and legacy capital Map removed**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-23T20:49:30Z
- **Completed:** 2026-03-23T20:53:30Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Wired canSnipe() risk gate into handleNewPairForChain, handleNewV3PoolForChain, and legacy handleNewPair before expensive safety API calls
- Replaced in-memory capitalDeployed Map and canDeployCapital/recordCapitalDeployed with DB-backed riskManager.canSnipe/recordSnipe
- All risk rejection paths log structured context (token, reason, details) and send Telegram alerts with rejection details
- TypeScript compiles clean with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove legacy capital tracking and add risk gate import** - `aa2a7c5` (feat)

## Files Created/Modified
- `src/bot.ts` - Added riskManager import, removed capitalDeployed Map and 2 helper functions, inserted canSnipe() gate in 3 handlers, replaced recordCapitalDeployed with recordSnipe() in 3 handlers

## Decisions Made
- Risk gate positioned after cheap blocklist/dedup checks but before expensive safety API calls (sell simulation, honeypot check, etc.) for optimal fast-fail
- Legacy handleNewPair uses 'eth' as chain name and '1.0' as maxCapital matching the ETH chain template defaultMaxCapital in chainRegistry.ts (per Pitfall 4 in research)
- recordSnipe() placed immediately after successful sendTxWithRetry, before insertTrade.run, ensuring cooldown starts only on confirmed TX (per Pitfall 5)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- node_modules not present in worktree; ran `npm install --legacy-peer-deps` (consistent with Phase 02 decision) before TypeScript verification. Standard worktree setup, not a deviation.

## User Setup Required

None - all risk env vars were configured in Plan 01 with sensible defaults.

## Next Phase Readiness
- Phase 06 (risk-management) is now fully complete: risk engine created (Plan 01) and integrated into live snipe pipeline (Plan 02)
- Every snipe attempt across all chains and DEX types must pass through canSnipe() before proceeding
- Risk rejections are visible via Telegram alerts with specific rejection reasons
- Ready for Phase 07 (smart exit strategies) which can build on this risk infrastructure

## Self-Check: PASSED

All files exist, commit verified, TypeScript compiles clean, all acceptance criteria met.

---
*Phase: 06-risk-management*
*Completed: 2026-03-23*
