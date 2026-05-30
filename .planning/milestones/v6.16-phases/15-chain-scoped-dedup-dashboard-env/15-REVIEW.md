---
phase: 15-chain-scoped-dedup-dashboard-env
reviewed: 2026-04-12T12:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/alphaDrop.ts
  - src/api/middleware/auth.ts
  - src/bot.ts
  - src/config.ts
  - src/utils/db.ts
  - test/helpers/testDb.ts
  - test/unit/configEnvVar.test.ts
  - test/unit/db.test.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-04-12T12:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 15 introduces chain-scoped deduplication for `isTokenSniped`, legacy `mainnet`-to-`eth` row normalization, `DASHBOARD_API_KEY` as a required startup env var, removal of legacy single-chain code paths, and comprehensive tests for the new behavior. The core chain-scoped dedup logic (`makeIsTokenSnipedStmt`, `normalizeLegacyMainnetRows`) is correct and well-tested. However, the chain-scoping was NOT applied consistently to all token-keyed SQL statements -- `updateTradeStatus` in particular still operates across all chains, which can cause cross-chain data corruption in multi-chain deployments. The auth middleware uses a non-timing-safe comparison for API key validation.

## Critical Issues

### CR-01: `updateTradeStatus` is NOT chain-scoped -- cross-chain data corruption risk

**File:** `src/utils/db.ts:219-221`
**Issue:** Phase 15 correctly added `AND chain = ?` to `isTokenSniped` (line 237). However, `updateTradeStatus` still uses `WHERE token = ? AND status = 'pending'` without a chain filter. In a multi-chain deployment, if the same token contract address exists on two chains (e.g., a bridged token on ETH and BSC), calling `updateTradeStatus.run('failed', token)` after a TX failure on one chain will mark the trade as failed on ALL chains. This is called in `bot.ts` at lines 341, 528, and 851.

The same issue applies to `getTradesByToken` (line 215-217), which returns trades across all chains for a given token address.

**Fix:**
```typescript
// src/utils/db.ts -- add chain parameter to updateTradeStatus
const updateTradeStatus = db.prepare(`
    UPDATE trades SET status = ? WHERE token = ? AND chain = ? AND status = 'pending'
`);

// src/utils/db.ts -- add chain parameter to getTradesByToken
const getTradesByToken = db.prepare(`
    SELECT * FROM trades WHERE token = ? AND chain = ? ORDER BY timestamp ASC
`);
```
All callers in `bot.ts` must be updated to pass `ctx.chain.name` as the third argument:
```typescript
// bot.ts line 341, 528
updateTradeStatus.run('failed', targetToken.toLowerCase(), ctx.chain.name);
// bot.ts line 851
updateTradeStatus.run('failed', token, chainName);
```

## Warnings

### WR-01: API key comparison is not timing-safe

**File:** `src/api/middleware/auth.ts:37`
**Issue:** The login handler compares `apiKey !== expected` using JavaScript's standard string equality operator. This is theoretically vulnerable to timing attacks where an attacker measures response time differences to deduce the API key character by character. While this is a local dashboard (not internet-facing), defense-in-depth best practice for credential comparison is to use constant-time comparison.

**Fix:**
```typescript
import { timingSafeEqual } from 'crypto';

// Replace: if (!apiKey || apiKey !== expected)
// With:
if (!apiKey || !timingSafeEqual(Buffer.from(apiKey), Buffer.from(expected))) {
```
Note: `timingSafeEqual` requires both buffers to be the same length. If lengths differ, you can safely reject immediately since length itself is not secret (or pad to equal length).

### WR-02: In-memory session store has no cleanup for never-validated sessions

**File:** `src/api/middleware/auth.ts:16`
**Issue:** The `sessions` Map grows unboundedly. Expired sessions are only purged when `validateSession()` is called for that specific token (line 69-71). If a session is created via login but the user never makes a subsequent authenticated request, the entry persists in memory forever. While the bot dashboard likely has few users, this is a correctness gap -- a periodic cleanup interval or a max-size cap should be added.

**Fix:**
```typescript
// Add periodic cleanup (e.g., every hour)
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (now - session.createdAt > SESSION_TTL_MS) {
            sessions.delete(token);
        }
    }
}, 60 * 60 * 1000);
```

### WR-03: Duplicate SIGTERM/SIGINT handlers create race between graceful and forced exit

**File:** `src/bot.ts:930-946`
**Issue:** Two separate handlers are registered for each of SIGTERM and SIGINT. On the first signal, both the graceful handler (line 930) and the 5-second force-exit handler (line 934) fire simultaneously. The `shuttingDown` flag in `gracefulShutdown` prevents double execution of the graceful path, but the force-exit timer always starts regardless. If the graceful shutdown completes within 5 seconds and calls `process.exit(0)`, this is fine. But if a second SIGTERM/SIGINT arrives while the first is still processing, there are now two force-exit timers running. This is minor but could be consolidated.

**Fix:**
```typescript
// Combine into a single handler per signal
function gracefulShutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;

    // Start force-exit safety net
    setTimeout(() => {
        log.error('Force exit after 5s timeout');
        process.exit(1);
    }, 5000).unref();

    // ... rest of graceful shutdown logic ...
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

## Info

### IN-01: Empty catch blocks silently swallow errors in token metadata resolution

**File:** `src/bot.ts:250`, `src/bot.ts:263`, `src/bot.ts:434`
**Issue:** Several `catch {}` blocks silently swallow errors when fetching token symbol/name/decimals or liquidity info. While the code initializes defaults (`symbol = "?"`), the empty catches make debugging difficult when token metadata is consistently missing. At minimum, a debug-level log would help.

**Fix:** Add `catch (e) { ctx.log.debug({ err: e, token: targetToken }, 'Failed to fetch token metadata'); }` to each catch block.

### IN-02: Mixed import styles -- `require()` in shutdown handler alongside top-level `import`

**File:** `src/bot.ts:923`
**Issue:** The shutdown handler uses `const { closeDb } = require('./utils/db')` while the rest of the file uses ES module `import` statements. This works under `ts-node` but is inconsistent. The `closeDb` function is already exported from `./utils/db` and imported at the top of the file via the `db` import.

**Fix:** Add `closeDb` to the existing import at line 32:
```typescript
import { db, insertTrade, isTokenSniped, updateTradeStatus, getTradeIdForPendingToken, closeDb } from "./utils/db";
```

### IN-03: `getV3Price` helper function is defined but never called

**File:** `src/bot.ts:64-85`
**Issue:** The `getV3Price` function is defined at the top of the file but is never referenced anywhere in `bot.ts` or in the diff. The V3 pricing logic in the actual buy flow uses `quoteExactInputSingle` inline instead. This is dead code.

**Fix:** Remove the `getV3Price` function or add a comment indicating future use.

---

_Reviewed: 2026-04-12T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
