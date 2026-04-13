---
phase: 16-dashboard-type-alignment-dead-code-cleanup
fixed_at: 2026-04-13T20:11:19Z
review_path: .planning/phases/16-dashboard-type-alignment-dead-code-cleanup/16-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 16: Code Review Fix Report

**Fixed at:** 2026-04-13T20:11:19Z
**Source review:** .planning/phases/16-dashboard-type-alignment-dead-code-cleanup/16-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-01: CSV Injection in Trade Export Endpoint

**Files modified:** `src/api/routes/trades.ts`
**Commit:** 6686bcc
**Applied fix:** Added `escapeCsv()` utility function that prevents spreadsheet formula injection by prefixing formula-trigger characters (`=`, `+`, `-`, `@`, tab, CR) with a single quote inside double quotes, and properly escapes fields containing commas, double quotes, or newlines. All CSV field values in the export endpoint now pass through `escapeCsv()` before being joined into rows.

### CR-02: NaN Propagation from Invalid Date Query Parameters

**Files modified:** `src/api/routes/trades.ts`
**Commit:** 826b712
**Applied fix:** Added `parseDateParam()` helper that returns `null` when `new Date(str).getTime()` produces `NaN`. Both the GET `/` and GET `/export` endpoints now validate parsed date parameters and return HTTP 400 with a descriptive error message when an invalid date string is provided, instead of silently passing `NaN` to SQLite queries.

### WR-01: Dead Prepared Statement -- getDeployedCapitalByChain Never Exported

**Files modified:** `src/utils/db.ts`
**Commit:** 81d4b93
**Applied fix:** Removed the `getDeployedCapitalByChain` prepared statement entirely (lines 334-348). It was defined but never exported and had zero callers anywhere in the codebase, confirmed by both the review and the project ROADMAP which marked it for removal.

### WR-02: Redundant Null Check on Non-Nullable Type sellRevenue

**Files modified:** `dashboard/src/components/TradeTable.tsx`
**Commit:** d9ec319
**Applied fix:** Removed the `&& trade.sellRevenue !== null` condition from line 213. The `Trade` type defines `sellRevenue: number` (always a number, never null), so the null check was always true and misleading. The condition now simply checks `trade.action === 'closed'`.

### WR-03: Empty Catch Blocks Silently Swallow Errors in bot.ts

**Files modified:** `src/bot.ts`
**Commit:** 924d790
**Applied fix:** Added debug-level logging to three empty `catch {}` blocks: (1) token metadata fetch (symbol, name, decimals) in V2 handler, (2) LP reserve data fetch in V2 handler, and (3) token metadata fetch in V3 handler. Each now logs the error, token address, and contextual info at `ctx.log.debug` level so failures are traceable without being noisy in production.

### WR-04: Duplicate asyncHandler Definition Across Route Files

**Files modified:** `src/api/routes/trades.ts`
**Commit:** a13bf33
**Applied fix:** Replaced the inline `asyncHandler` function definition (lines 9-14) with an import from the shared middleware module: `import { asyncHandler } from '../middleware/errorHandler'`. The shared version is already used by `health.ts` and is functionally equivalent. Removed the stale comment about parallel plan execution timing.

### WR-05: Unvalidated outcome Query Parameter in Trades Route

**Files modified:** `src/api/routes/trades.ts`
**Commit:** efa1881
**Applied fix:** Added a `VALID_OUTCOMES` constant (`['all', 'profit', 'loss']`) and validation checks in both the GET `/` and GET `/export` endpoints. Invalid outcome values now return HTTP 400 with a descriptive error message listing valid options, instead of silently falling through to no filter.

## Skipped Issues

None -- all findings were fixed.

---

_Fixed: 2026-04-13T20:11:19Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
