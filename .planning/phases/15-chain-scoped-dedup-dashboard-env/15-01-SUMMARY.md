---
phase: 15-chain-scoped-dedup-dashboard-env
plan: 01
subsystem: database
tags: [multi-chain, sqlite, dedup, legacy-cleanup, prepared-statements]

# Dependency graph
requires:
  - phase: 04-multi-chain-architecture
    provides: "ChainContext with chain.name identifiers (eth, bsc, base, arb)"
  - phase: 03-sqlite-storage-code-quality
    provides: "SQLite trades table with chain column and idx_trades_chain index"
provides:
  - "Chain-scoped isTokenSniped via makeIsTokenSnipedStmt factory (AND chain = ?)"
  - "normalizeLegacyMainnetRows() one-time migration (mainnet -> eth)"
  - "Legacy single-chain wrappers formally retired (handleNewPair, startBot, resumeMonitoring, handleAlphaDrop, maybeApprove, getTokenFromPair)"
  - "INT-DEDUP-NO-CHAIN gap closed, CHAIN-02 requirement satisfied"
affects: [15-02-PLAN, phase-16-updateTradeStatus-chain-scope]

# Tech tracking
tech-stack:
  added: []
  patterns: ["makeIsTokenSnipedStmt factory pattern for testable prepared statements", "normalizeLegacyMainnetRows() forward-only migration at module load"]

key-files:
  created: []
  modified: [src/utils/db.ts, src/bot.ts, src/alphaDrop.ts, test/unit/db.test.ts, test/helpers/testDb.ts]

key-decisions:
  - "normalizeLegacyMainnetRows() runs after migrateJsonState() at module load to bridge mainnet->eth identifier mismatch"
  - "makeIsTokenSnipedStmt factory exported for test access to production SQL literal"
  - "tsc --noEmit driven import cleanup (no TS6133/TS6196 flagged since noUnusedLocals not enabled)"
  - "getPairAddressFromToken left as dead code (optional Claude's Discretion, not exercised)"
  - "updateTradeStatus cross-chain collision deferred to Phase 16+"

patterns-established:
  - "Factory function pattern for testable prepared statements: export factory, call against production db at module level, tests call against createTestDb()"

requirements-completed: [CHAIN-02]

# Metrics
duration: 19min
completed: 2026-04-13
---

# Phase 15 Plan 01: Chain-Scoped Dedup Summary

**Chain-scoped isTokenSniped via makeIsTokenSnipedStmt factory with AND chain = ?, legacy mainnet->eth normalization at module load, and 5 legacy single-chain wrappers retired**

## Performance

- **Duration:** 19 min
- **Started:** 2026-04-13T01:49:28Z
- **Completed:** 2026-04-13T02:08:25Z
- **Tasks:** 4
- **Files modified:** 8 (3 src, 2 test, 3 planning docs)

## Accomplishments
- Chain-scoped dedup: isTokenSniped SQL now includes `AND chain = ?` via makeIsTokenSnipedStmt factory -- a token sniped on BSC no longer blocks the same address on ETH/Base/Arb
- Legacy mainnet->eth normalization: pre-Phase-4 trade rows with chain='mainnet' are rewritten to chain='eth' idempotently at module load
- Dead code retirement: handleNewPair, startBot, resumeMonitoring, maybeApprove, handleAlphaDrop, getTokenFromPair, and 4 legacy singletons (provider, wallet, factory, router) deleted
- 9 new unit tests: 4 normalization tests + 5 chain-scoped dedup tests exercising the production factory
- INT-DEDUP-NO-CHAIN gap formally closed in v6.16-MILESTONE-AUDIT.md

## Task Commits

Each task was committed atomically:

1. **Task 0: Legacy chain identifier normalization shim** - `8f9ba37` (feat)
2. **Task 1: makeIsTokenSnipedStmt factory + chain-scope query** - `87f0a30` (feat)
3. **Task 2: Delete legacy single-chain wrappers** - `6453fc9` (feat)
4. **Task 3: Chain-scoped dedup unit tests** - `c84c1d0` (test)

## Files Created/Modified
- `src/utils/db.ts` - Added normalizeLegacyMainnetRows(), makeIsTokenSnipedStmt factory, schema DEFAULT eth, module-load call
- `src/bot.ts` - Updated V2/V3 call sites with ctx.chain.name bind; deleted legacy singletons, handleNewPair, resumeMonitoring, startBot, maybeApprove
- `src/alphaDrop.ts` - Deleted handleAlphaDrop, getTokenFromPair, legacy imports
- `test/unit/db.test.ts` - Added 4 normalization tests + 5 chain-scoped dedup tests importing makeIsTokenSnipedStmt from production
- `test/helpers/testDb.ts` - Updated schema DEFAULT from 'mainnet' to 'eth'
- `.planning/PROJECT.md` - New Key Decisions row for legacy wrapper retirement, updated footer
- `.planning/v6.16-MILESTONE-AUDIT.md` - INT-DEDUP-NO-CHAIN marked closed, Phase 4 tech debt annotated retired
- `.planning/phases/15-chain-scoped-dedup-dashboard-env/15-CONTEXT.md` - Deferred updateTradeStatus cross-chain collision to Phase 16+

## WHERE token = Audit (db.ts)

| Line | Statement | Status | Action |
|------|-----------|--------|--------|
| 215 (was 183) | `getTradesByToken` | NOT chain-scoped. Zero live callers in src/ (dead code). | No action. Delete in Phase 16+ follow-up. |
| 219 (was 187) | `updateTradeStatus` | NOT chain-scoped. Live callers: exitEngine.ts (3), bot.ts (5). | Latent cross-chain bug deferred to Phase 16+. Documented in 15-CONTEXT.md. |
| 237 (was 191) | `isTokenSniped` (via factory) | FIXED by this plan. Now `WHERE token = ? AND chain = ?`. | Closed. |
| 413 (was 381) | `getTradeIdForPendingToken` | Already chain-scoped (`WHERE token = ? AND chain = ?`). | No action needed. |

## Cross-Directory Grep Audit (Task 2 Pre-deletion Gates)

All three gates returned 0 matches:
- `scripts/**/*.ts`: 0 matches for handleNewPair, startBot, handleAlphaDrop, resumeMonitoring, getTokenFromPair
- `test/**/*.ts`: 0 matches for legacy symbol names (handleAlphaDropForChain matches correctly excluded)
- `dashboard/**/*.{ts,tsx}`: 0 matches

## tsc-driven Import Cleanup Evidence (Task 2 Edit 6)

Command: `npx tsc --noEmit 2>&1 | grep "src/bot.ts" | grep -E "TS(6133|6196)"`
Result: Empty output (zero diagnostics). The project's tsconfig.json does not enable `noUnusedLocals` or `noUnusedParameters`, so tsc does not flag unused imports as errors. This is consistent with the Phase 7 precedent ("Kept maybeApprove/maybeApproveForChain as dead code since TS compiler doesn't enforce noUnusedLocals"). No imports were removed in Edit 6.

Remaining unused imports in bot.ts (not removed per tsc-driven policy): `getProvider`, `getWallet` from provider.ts; non-ForChain tokenSafety functions (`checkTokenMetadata`, `isLiquidityLocked`, `simulateSwap`, `checkHoneypot`, `isBlacklistedToken`, `isLiquiditySufficient`, `isKnownBadToken`, `hasHighTransferTax`, `hasMaxWalletOrTxLimits`, `simulateSell`); `sendTelegramAlert` from notifier.ts; `initShutdownHandler` from exitManager.ts.

## Claude's Discretion: getPairAddressFromToken

After deletions, grep confirmed zero callers of `getPairAddressFromToken` in src/ and test/. Decision: **left in place** (optional deletion not exercised). The function is dead code in `src/utils/pairDiscovery.ts` and can be cleaned up in a future phase.

## Decisions Made
- normalizeLegacyMainnetRows() runs after migrateJsonState() at module load, ensuring pre-Phase-4 'mainnet' rows are rewritten to 'eth' before any chain-scoped query
- makeIsTokenSnipedStmt factory exported from db.ts for test access to the exact production SQL literal
- migrateJsonState() INSERT kept as 'mainnet' literal with explanatory comment (historical fidelity; normalization shim handles the rewrite)
- Schema DEFAULT updated from 'mainnet' to 'eth' in both v1 and v3 CREATE TABLE blocks
- Import cleanup driven by tsc TS6133/TS6196 output (which was empty due to project config) -- no grep-and-decide
- updateTradeStatus cross-chain collision documented in 15-CONTEXT.md as Phase 16+ deferred item

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- handleNewPair deletion required multiple Edit tool operations due to function body size. The deletion was completed correctly in stages, verified by grep confirming zero remaining function definitions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CHAIN-02 satisfied, INT-DEDUP-NO-CHAIN closed
- Phase 15 Plan 02 (DASHBOARD_API_KEY env validation) can proceed independently
- Phase 16+ should address updateTradeStatus cross-chain collision (documented in 15-CONTEXT.md)

## Self-Check: PASSED

All files verified present. All 4 task commits verified in git log.

---
*Phase: 15-chain-scoped-dedup-dashboard-env*
*Completed: 2026-04-13*
