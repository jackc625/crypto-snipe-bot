---
phase: 16-dashboard-type-alignment-dead-code-cleanup
reviewed: 2026-04-13T12:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - dashboard/src/types/api.ts
  - dashboard/src/components/TradeTable.tsx
  - src/api/routes/trades.ts
  - src/api/routes/health.ts
  - src/utils/exitManager.ts
  - src/bot.ts
  - src/utils/db.ts
  - test/integration/api/health.test.ts
  - test/unit/riskManager.test.ts
findings:
  critical: 2
  warning: 5
  info: 4
  total: 11
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-04-13T12:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Reviewed the dashboard type definitions, trade/health API routes, exit manager, bot orchestrator, database layer, and associated tests. The codebase is generally well-structured with good defensive coding patterns (risk gates, safety checks, graceful shutdown). Two critical issues were found: a CSV injection vulnerability in the trade export endpoint and an `Invalid Date` NaN propagation bug in date query parameter parsing. Several warnings address dead code, missing input validation, and a redundant null check against a non-nullable type. The test files are solid with appropriate mocking patterns.

## Critical Issues

### CR-01: CSV Injection in Trade Export Endpoint

**File:** `src/api/routes/trades.ts:131-145`
**Issue:** The CSV export endpoint directly interpolates token addresses and chain names into CSV output without sanitizing them. If a token address or chain field ever contains characters like `=`, `+`, `-`, or `@` (e.g., via a crafted token name stored in the DB), the exported CSV could execute formulas when opened in spreadsheet software (Excel, Google Sheets). While token addresses are hex strings today, `t.token` is user-influenced data that flows through the system from on-chain events. The `chain` field is more constrained but the pattern is still unsafe.
**Fix:** Escape CSV fields that could contain injection payloads. Wrap fields in double quotes and escape any embedded double quotes:
```typescript
function escapeCsv(field: string | number | null): string {
    if (field === null || field === undefined) return '';
    const str = String(field);
    // Prefix formula-trigger characters to prevent spreadsheet injection
    if (/^[=+\-@\t\r]/.test(str)) {
        return `"'${str.replace(/"/g, '""')}"`;
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

// Then use in CSV row generation:
return [
    escapeCsv(t.token),
    escapeCsv(t.chain),
    // ... etc
].join(',');
```

### CR-02: NaN Propagation from Invalid Date Query Parameters

**File:** `src/api/routes/trades.ts:35-40`
**Issue:** When `from` or `to` query parameters contain an invalid date string (e.g., `?from=notadate`), `new Date('notadate').getTime()` returns `NaN`. `Math.floor(NaN / 1000)` is `NaN`, which is then passed to the SQLite query as a timestamp filter. SQLite's `WHERE b.timestamp >= NaN` comparison will silently return no rows (since comparisons with NaN are always false), causing the API to return an empty result set with no error indication. The same issue exists on lines 103-107 in the export endpoint.
**Fix:** Validate the parsed date and return a 400 error for invalid values:
```typescript
const fromTimestamp = (() => {
    if (!fromStr) return Math.floor((now - sevenDaysMs) / 1000);
    const ms = new Date(fromStr).getTime();
    if (isNaN(ms)) return null; // signal invalid
    return Math.floor(ms / 1000);
})();

if (fromTimestamp === null || (toStr && toTimestamp === null)) {
    res.status(400).json({ error: 'Invalid date format for from/to parameter' });
    return;
}
```

## Warnings

### WR-01: Dead Prepared Statement -- getDeployedCapitalByChain Never Exported

**File:** `src/utils/db.ts:335-348`
**Issue:** The `getDeployedCapitalByChain` prepared statement is defined but never exported in the `export { ... }` statement on line 440, and is not used anywhere else in the file. It occupies a compiled prepared statement slot in SQLite but is unreachable from any consumer module.
**Fix:** Either export it alongside the other statements if it is needed by consumers:
```typescript
export { db, insertTrade, ..., getDeployedCapitalByChain, ... };
```
Or remove it entirely if it is dead code superseded by the `exposureByChain` query in `riskManager.ts`.

### WR-02: Redundant Null Check on Non-Nullable Type `sellRevenue`

**File:** `dashboard/src/components/TradeTable.tsx:213`
**Issue:** The Trade type defines `sellRevenue: number` (always a number, never null). However, line 213 checks `trade.sellRevenue !== null`. This check always evaluates to `true`, making the `&&` condition reduce to just `trade.action === 'closed'`. While not a runtime bug, it is misleading -- a future developer might think `sellRevenue` can be null and add null-handling code elsewhere unnecessarily.
**Fix:** Remove the redundant null check:
```tsx
{trade.action === 'closed'
  ? formatEth(trade.sellRevenue)
  : '--'}
```

### WR-03: Empty Catch Blocks Silently Swallow Errors in bot.ts

**File:** `src/bot.ts:249` and `src/bot.ts:262`
**Issue:** Two `catch {}` blocks silently swallow errors when fetching token metadata (symbol, name, decimals) and LP reserve data. While these are best-effort lookups where failure is acceptable, completely silent swallowing makes debugging impossible when these calls fail unexpectedly for systemic reasons (e.g., RPC node rate limiting).
**Fix:** Add debug-level logging to the catch blocks:
```typescript
} catch (e) {
    ctx.log.debug({ err: e, token: targetToken }, 'Failed to fetch token metadata, using defaults');
}
```

### WR-04: Duplicate asyncHandler Definition Across Route Files

**File:** `src/api/routes/trades.ts:10-14`
**Issue:** The `asyncHandler` utility is defined inline in `trades.ts` (lines 10-14) with a comment explaining it avoids a dependency timing issue. However, `health.ts` imports the same utility from `../middleware/errorHandler`. The inline comment cites "parallel plan execution" as the reason, but if the middleware module is now available (as evidenced by `health.ts` importing it), this duplication should be consolidated.
**Fix:** Replace the inline definition with an import from the shared middleware, or add a more specific explanation of why this file cannot use the shared version:
```typescript
import { asyncHandler } from '../middleware/errorHandler';
```

### WR-05: Unvalidated `outcome` Query Parameter in Trades Route

**File:** `src/api/routes/trades.ts:28`
**Issue:** The `outcome` parameter defaults to `'all'` but accepts any arbitrary string. While non-matching values fall through to the default (no filter), the API silently accepts invalid values like `?outcome=foo` without feedback. This makes it harder for API consumers to detect typos.
**Fix:** Validate the outcome parameter and return 400 for invalid values:
```typescript
const validOutcomes = ['all', 'profit', 'loss'] as const;
const outcome = (req.query.outcome as string | undefined) || 'all';
if (!validOutcomes.includes(outcome as any)) {
    res.status(400).json({ error: `Invalid outcome value. Must be one of: ${validOutcomes.join(', ')}` });
    return;
}
```

## Info

### IN-01: Duplicate Import Paths in bot.ts

**File:** `src/bot.ts:6-28`
**Issue:** Lines 6-15 import from `"./utils/tokenSafety"` and lines 16-28 import different symbols from the exact same module path `"./utils/tokenSafety"`. These should be consolidated into a single import statement for readability.
**Fix:** Merge the two import blocks into one:
```typescript
import {
    checkTokenMetadata, isLiquidityLocked, simulateSwap, checkHoneypot,
    isBlacklistedToken, isLiquiditySufficient, isKnownBadToken,
    hasHighTransferTax, hasMaxWalletOrTxLimits, simulateSell,
    checkHoneypotForChain, isLiquidityLockedForChain, simulateSwapForChain,
    // ... all ForChain variants
} from "./utils/tokenSafety";
```

### IN-02: Unused Imports in bot.ts

**File:** `src/bot.ts:6-15`
**Issue:** The first import block (lines 6-15) imports non-chain-aware versions of safety functions: `checkTokenMetadata`, `isLiquidityLocked`, `simulateSwap`, `checkHoneypot`, `isBlacklistedToken`, `isLiquiditySufficient`, `isKnownBadToken`, `hasHighTransferTax`, `hasMaxWalletOrTxLimits`, and `simulateSell`. These legacy single-chain variants do not appear to be used anywhere in the file -- only the `ForChain` variants from the second import block are called. These are dead imports.
**Fix:** Remove the unused first import block entirely (lines 6-15). Keep only the `ForChain` imports.

### IN-03: Duplicate sendTelegramAlert Import in bot.ts

**File:** `src/bot.ts:30-31`
**Issue:** `sendTelegramAlert` is imported on line 30 from `"./utils/notifier"` and `sendCtxAlert` is imported on line 31 from the same module. Only `sendCtxAlert` appears to be used in the file. `sendTelegramAlert` is an unused import.
**Fix:** Remove the unused `sendTelegramAlert` import:
```typescript
import { sendCtxAlert } from "./utils/notifier";
```

### IN-04: Magic Number for Polling Interval

**File:** `src/bot.ts:664` and `src/bot.ts:689`
**Issue:** HTTP polling intervals use the magic number `2000` (milliseconds) without a named constant. The same value appears twice -- once for V2 polling and once for V3 polling.
**Fix:** Extract to a constant:
```typescript
const HTTP_POLL_INTERVAL_MS = 2000;
```

---

_Reviewed: 2026-04-13T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
