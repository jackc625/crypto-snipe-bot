# Phase 16: Dashboard Type Alignment & Dead Code Cleanup - Research

**Researched:** 2026-04-13
**Domain:** TypeScript type alignment, API contract consistency, dead code removal
**Confidence:** HIGH

## Summary

Phase 16 is a focused gap-closure phase addressing four integration issues identified in the v6.16 milestone audit: (1) a field name mismatch between the dashboard's `Trade` TypeScript interface and the actual `/api/trades` JSON response, (2) a missing `version` field in the `/health` endpoint that the dashboard's `HealthResponse` type already declares, (3) dead shutdown-related code in `exitManager.ts` that is never called in multi-chain mode, and (4) two exported prepared statements in `db.ts` with zero callers anywhere in the codebase.

All four issues are well-scoped, low-risk code changes with no external dependencies. The codebase is TypeScript (Node.js backend + React dashboard), uses vitest for testing, and has comprehensive existing test coverage for the affected endpoints.

**Primary recommendation:** Fix each issue independently -- they share no code paths. The Trade type alignment is the highest-priority fix (causes visible rendering bugs); the others are cleanup/correctness improvements.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-02 | Historical trade log with filtering by chain, date range, and profit/loss | Trade type alignment fix ensures TradeTable renders all API fields correctly instead of showing undefined |
| MON-01 | HTTP health check endpoint exposes bot liveness, chain connectivity status, and open position count | Adding `version` field to /health response completes the HealthResponse contract |
| FIX-05 | Bot handles SIGTERM/SIGINT gracefully -- clears all intervals, timeouts, and flushes state before exit | Removing dead `isShutdownInProgress`/`initShutdownHandler` exports and wiring or removing the exitManager multi-chain handler eliminates confusion about which shutdown path is active |
</phase_requirements>

## Architecture Patterns

### Issue 1: Trade Interface / API Response Field Mismatch (INT-TRADE-TYPE)

**What:** The dashboard `Trade` interface in `dashboard/src/types/api.ts` declares fields that do NOT match the actual JSON response from `GET /api/trades` in `src/api/routes/trades.ts`. [VERIFIED: codebase grep]

**Dashboard Trade interface fields (current):**
```typescript
interface Trade {
  id: number;           // NOT in API response
  token: string;        // OK -- matches
  chain: string;        // OK -- matches
  action: 'open' | 'closed';  // OK -- matches
  amount: string | null;       // API returns buyCost (string|null) instead
  price: number | null;        // API returns sellRevenue (number) instead
  gasUsed: string | null;      // API returns buyGas (string|null) instead
  txHash: string | null;       // NOT in API response
  buyTime: number | null;      // OK -- matches
  sellTime: number | null;     // OK -- matches
  durationHeld: number | null; // OK -- matches
  realizedPnl: number | null;  // API returns pnl (number|null) instead
  exitReason: string | null;   // NOT in API response
  peakPrice: number | null;    // NOT in API response
  poolType: string;            // OK -- matches
  feeTier: number | null;      // OK -- matches
  sellCount: number;           // OK -- matches
}
```

**Actual API response fields (from src/api/routes/trades.ts lines 64-83):**
```typescript
{
  token,                    // string
  chain,                    // string
  action,                   // 'open' | 'closed'
  pnl,                      // number | null  (mapped from realized_pnl)
  sellCount,                // number
  buyTime,                  // number
  sellTime,                 // number | null
  durationHeld,             // number | null
  buyCost,                  // string | null
  buyGas,                   // string | null
  sellRevenue,              // number
  sellGas,                  // number
  poolType,                 // string
  feeTier,                  // number | null
}
```

**Specific mismatches:**

| Dashboard Field | API Field | Status |
|----------------|-----------|--------|
| `id` | (not present) | Dashboard expects it, API doesn't send it |
| `amount` | `buyCost` | Different name |
| `price` | (no equivalent) | Dashboard expects it, closest is `sellRevenue` |
| `gasUsed` | `buyGas` | Different name |
| `txHash` | (not present) | Dashboard expects it, API doesn't send it |
| `realizedPnl` | `pnl` | Different name |
| `exitReason` | (not present) | Dashboard expects it, API doesn't send it |
| `peakPrice` | (not present) | Dashboard expects it, API doesn't send it |
| (not present) | `buyCost` | API sends it, dashboard ignores it |
| (not present) | `buyGas` | API sends it, dashboard ignores it |
| (not present) | `sellRevenue` | API sends it, dashboard ignores it |
| (not present) | `sellGas` | API sends it, dashboard ignores it |

**Impact on TradeTable rendering:** [VERIFIED: codebase read]
- `trade.id` used as React key -- will be `undefined` (React will warn about missing keys)
- `trade.amount` used in Entry Cost column -- will render `undefined` via `formatEth(undefined)` -> `"-.----"`
- `trade.realizedPnl` used in P&L column -- will render `undefined` via `formatPnL(undefined)` -> `"-.---"`
- `trade.price` used in Exit Revenue column -- will render `"-.----"` (null-ish)
- `trade.gasUsed` used in Buy Gas and Sell Gas columns -- will render `"-.----"`
- Sorting by `pnl` field accesses `a.realizedPnl` which is undefined (broken sorting)

**Fix approach:** Align the `Trade` interface to match the API response exactly. Update `TradeTable.tsx` to use the corrected field names. The API is the source of truth -- do NOT change the API response shape.

### Issue 2: Missing Health Version Field (INT-HEALTH-VERSION)

**What:** `dashboard/src/types/api.ts` line 121 declares `version: string` in `HealthResponse`, but `src/api/routes/health.ts` never includes `version` in the JSON response. [VERIFIED: codebase grep]

**Fix approach:** Read `version` from `package.json` at module load time using `require('../../package.json').version` (or `JSON.parse(fs.readFileSync(...))`), then include it in the health response. Since `resolveJsonModule: true` is set in tsconfig.json, a direct import or require is viable. However, `package.json` is at project root, not in `src/`, so the relative path from `src/api/routes/health.ts` would be `../../../package.json`. [VERIFIED: tsconfig.json]

**Note:** The dashboard does not currently read `version` from the health response anywhere in its components. The `HealthResponse` type simply declares the field. Adding the field to the API response completes the contract. [VERIFIED: grep for "version" in dashboard/src]

### Issue 3: Dead Shutdown Code (INT-SHUTDOWN-FLAG)

**What:** The shutdown flag system in `exitManager.ts` is dead code in multi-chain mode. Specifically: [VERIFIED: codebase grep/read]

1. **`isShutdownInProgress()` (line 159):** Exported, but NEVER imported or called by any file in `src/`. Zero callers.
2. **`initShutdownHandler()` (line 167):** Exported, imported by `bot.ts` (line 39), but NEVER called. Dead import.
3. **`initMultiChainShutdownHandler()` in exitManager.ts (line 207):** Exported, but NEVER called. `bot.ts` has its OWN local `initMultiChainShutdownHandler()` function (line 881) that does NOT set `isShuttingDown` in exitManager.ts.
4. **`isShuttingDown` module variable (line 157):** Never set to `true` in multi-chain mode because neither `initShutdownHandler` nor `initMultiChainShutdownHandler` from exitManager.ts is ever called.

**The core problem:** `bot.ts` defines its own local `initMultiChainShutdownHandler` (lines 881-938) which uses a local `shuttingDown` variable. The exitManager's exported `initMultiChainShutdownHandler` and `isShutdownInProgress` are completely bypassed.

**Fix options:**
- **Option A (Remove dead code):** Delete `isShutdownInProgress()`, `initShutdownHandler()`, and `initMultiChainShutdownHandler()` from exitManager.ts. Remove the unused import from bot.ts. This is the cleanest approach since bot.ts already handles shutdown correctly with its own local function.
- **Option B (Wire correctly):** Have bot.ts call exitManager's `initMultiChainShutdownHandler` instead of defining its own. This would require refactoring bot.ts's local handler to match the exitManager signature (which takes a simple `cleanup: () => void` callback).

**Recommendation:** Option A (remove). The bot.ts local handler is more complete (handles API server close, Telegram disconnect, per-chain WS teardown). The exitManager version is a simplified version that would lose functionality. Removing dead code is safer than refactoring working code.

**Test impact:** `test/unit/exitManager.shutdown.test.ts` tests `initShutdownHandler` and `isShutdownInProgress`. These tests should be updated or removed to match the new code. Since the legacy single-chain code path is dead, the tests for it should be removed.

### Issue 4: Dead DB Exports (INT-DEAD-EXPORTS)

**What:** Two prepared statements in `src/utils/db.ts` are exported but never imported anywhere: [VERIFIED: codebase grep]

1. **`getDeployedCapitalByChain`** (line 335): Prepared statement for per-chain deployed capital. Defined, exported (line 440), but zero import statements reference it anywhere in `src/`.
2. **`getTradesByToken`** (line 215): Prepared statement for trades by token+chain. Defined, exported (line 440), but zero import statements reference it anywhere in `src/`.

**Fix approach:** Remove both from the `export { }` statement on line 440. The prepared statements themselves can remain as local `const` declarations for future use, or be deleted entirely. Since they have zero callers, removing them entirely is cleanest (less code to maintain, less confusion about what's live).

**Note:** `getTradesByToken` was updated in Phase 15 (REVIEW-FIX) to include chain scoping, but the review comments noted zero call sites. `getDeployedCapitalByChain` has been dead since creation -- the risk manager uses inline queries instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reading package.json version | Custom file read + parse | `require('../../../package.json').version` | resolveJsonModule is enabled in tsconfig; direct require is one line |

## Common Pitfalls

### Pitfall 1: Changing API Response Shape Instead of Dashboard Type
**What goes wrong:** Temptation to rename API response fields to match the existing dashboard type
**Why it happens:** Seems like fewer files to change
**How to avoid:** The API response format is tested in `test/integration/api/trades.test.ts` (7 test cases). The API is the source of truth. Change the dashboard type to match the API, not the reverse.
**Warning signs:** Modifying `src/api/routes/trades.ts` response mapping

### Pitfall 2: React Key Stability After Removing `id` From Trade Type
**What goes wrong:** Using array index as React key causes stale rendering on sort/filter
**Why it happens:** The current Trade type has `id` (which comes from `buy_id` in the DB) but the API doesn't send it
**How to avoid:** Either (a) add `id` to the API response by including `buy_id` in the mapping, or (b) construct a composite key in TradeTable from `token + chain + buyTime`. Option (a) is simpler and preserves the existing `trade.id` key usage.
**Warning signs:** Seeing `key={index}` in TradeTable

### Pitfall 3: Removing Shutdown Tests Without Replacement
**What goes wrong:** Deleting the exitManager.shutdown.test.ts tests reduces coverage without validating the actual (bot.ts local) shutdown path
**Why it happens:** The old tests test dead code
**How to avoid:** Remove the tests for dead code. The bot.ts local shutdown handler is already covered by the E2E flow (manual verification item). Adding a unit test for bot.ts's shutdown handler is optional but not strictly needed since it's a process-level handler.
**Warning signs:** Coverage report showing uncovered shutdown paths

### Pitfall 4: Breaking `formatEth` With New Types
**What goes wrong:** `sellRevenue` and `sellGas` are numbers (not strings), but TradeTable may pass them to `formatEth()` which accepts `number | string | null`
**Why it happens:** The old Trade type used `string | null` for amount fields
**How to avoid:** Verify that `formatEth` handles both number and string inputs -- it does (line 16 of formatters.ts: `typeof value === 'string' ? parseFloat(value) : value`). No change needed to formatEth.

## Code Examples

### Corrected Trade Interface
```typescript
// dashboard/src/types/api.ts
// Source: src/api/routes/trades.ts response mapping (lines 64-83)
export interface Trade {
  id: number;                    // Add buy_id to API response for React key
  token: string;
  chain: string;
  action: 'open' | 'closed';
  pnl: number | null;           // Was: realizedPnl
  sellCount: number;
  buyTime: number;               // Was: number | null (API always sends it)
  sellTime: number | null;
  durationHeld: number | null;
  buyCost: string | null;        // Was: amount
  buyGas: string | null;         // Was: gasUsed
  sellRevenue: number;           // NEW: aggregated sell revenue
  sellGas: number;               // NEW: aggregated sell gas
  poolType: string;
  feeTier: number | null;
}
```

### Health Version Addition
```typescript
// src/api/routes/health.ts
// Add near top of file:
import { readFileSync } from 'fs';
import { join } from 'path';
const pkg = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf-8'));

// In the response object, add:
res.status(statusCode).json({
    status,
    version: pkg.version,    // NEW
    uptime: Math.floor((Date.now() - startTime) / 1000),
    // ... rest of response
});
```

### Dead Export Removal in db.ts
```typescript
// src/utils/db.ts line 440 -- BEFORE:
export { db, insertTrade, getTradesByToken, updateTradeStatus, isTokenSniped, getOpenPositionCount, getTotalExposure, getDeployedCapitalByChain, getDailyRealizedLoss, upsertExitState, getExitState, deleteExitState, getTradeIdForPendingToken };

// AFTER:
export { db, insertTrade, updateTradeStatus, isTokenSniped, getOpenPositionCount, getTotalExposure, getDailyRealizedLoss, upsertExitState, getExitState, deleteExitState, getTradeIdForPendingToken };
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (projects: unit, integration, fork) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --project unit --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-02 | Trade interface fields match API response | integration | `npx vitest run test/integration/api/trades.test.ts -x` | Exists (update needed) |
| MON-01 | /health returns version field | integration | `npx vitest run test/integration/api/health.test.ts -x` | Exists (add test) |
| FIX-05 | Dead shutdown code removed | unit | `npx vitest run test/unit/exitManager.shutdown.test.ts -x` | Exists (update: remove dead code tests) |

### Sampling Rate
- **Per task commit:** `npx vitest run --project unit --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. Tests need updating (field name changes, new version assertion, dead test removal) but no new test files or framework setup required.

## Security Domain

Not applicable. This phase involves only:
- TypeScript interface alignment (no data flow changes)
- Adding a read-only version string to a health endpoint
- Removing unused code

No authentication, input validation, or cryptographic changes. All changes are internal consistency fixes.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `require('../../../package.json')` works from health.ts location | Issue 2 | LOW -- path may need adjustment if build output layout differs, but dev mode uses ts-node from src/ |
| A2 | Removing dead shutdown exports will not break any test outside exitManager.shutdown.test.ts | Issue 3 | LOW -- grep confirmed zero imports; but test files might use dynamic imports not caught by grep |

## Open Questions (RESOLVED)

1. **Should `id` (buy_id) be added to the API trade response?**
   - What we know: The API currently does NOT include `buy_id`. The dashboard uses `trade.id` as React key. The DB query produces `buy_id`.
   - Recommendation: Yes, add `id: t.buy_id` to the API response mapping. This provides a stable, unique key for React without changing existing TradeTable key logic. Low risk, high benefit.
   - RESOLVED: Yes, add `id: t.buy_id` to the API response. Implemented in Plan 16-01, Task 1 (adds `id: t.buy_id` as the first field in the `tradeResponse` mapping object in `src/api/routes/trades.ts`).

2. **Should the exitManager.ts `initMultiChainShutdownHandler` export be removed entirely or refactored?**
   - What we know: bot.ts has its own more complete local version. The exitManager version is simpler/incomplete.
   - Recommendation: Remove the exitManager version. The bot.ts local version correctly handles API server, Telegram, and per-chain WS teardown.
   - RESOLVED: Remove entirely (Option A). All three dead shutdown exports (`isShutdownInProgress`, `initShutdownHandler`, `initMultiChainShutdownHandler`) are deleted from exitManager.ts. Implemented in Plan 16-02, Task 1 (dead shutdown code removal section B).

## Sources

### Primary (HIGH confidence)
- Codebase grep/read of all affected files (db.ts, health.ts, trades.ts, api.ts, TradeTable.tsx, exitManager.ts, bot.ts)
- v6.16-MILESTONE-AUDIT.md gap descriptions
- ROADMAP.md Phase 16 success criteria
- Existing test files (trades.test.ts, health.test.ts, exitManager.shutdown.test.ts)

### Secondary (MEDIUM confidence)
- None needed -- all findings are based on direct codebase verification

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Trade type mismatch: HIGH - exact field-by-field comparison performed against both source files
- Health version: HIGH - verified missing field and confirmed tsconfig supports JSON imports
- Dead shutdown code: HIGH - zero callers confirmed via comprehensive grep
- Dead DB exports: HIGH - zero imports confirmed via comprehensive grep

**Research date:** 2026-04-13
**Valid until:** Indefinite (findings are codebase-specific, not library-version-dependent)
