---
phase: 15-chain-scoped-dedup-dashboard-env
fixed_at: 2026-04-12T12:15:00Z
review_path: .planning/phases/15-chain-scoped-dedup-dashboard-env/15-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 15: Code Review Fix Report

**Fixed at:** 2026-04-12T12:15:00Z
**Source review:** .planning/phases/15-chain-scoped-dedup-dashboard-env/15-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: `updateTradeStatus` is NOT chain-scoped -- cross-chain data corruption risk

**Files modified:** `src/utils/db.ts`, `src/bot.ts`, `src/exitEngine.ts`
**Commit:** 33aa1cb
**Applied fix:** Added `AND chain = ?` to both `updateTradeStatus` and `getTradesByToken` SQL prepared statements in db.ts. Updated all 6 call sites across bot.ts (3 sites) and exitEngine.ts (3 sites) to pass the chain name as the third argument. bot.ts callers use `ctx.chain.name` or the destructured `chainName` variable; exitEngine.ts callers all use `ctx.chain.name` from the ChainContext parameter.

### WR-01: API key comparison is not timing-safe

**Files modified:** `src/api/middleware/auth.ts`
**Commit:** 881a12f
**Applied fix:** Imported `timingSafeEqual` from Node.js `crypto` module. Replaced `apiKey !== expected` string equality with a length check followed by `timingSafeEqual(Buffer.from(apiKey), Buffer.from(expected))`. The length pre-check prevents `timingSafeEqual` from throwing on mismatched buffer lengths (length is not secret information).

### WR-02: In-memory session store has no cleanup for never-validated sessions

**Files modified:** `src/api/middleware/auth.ts`
**Commit:** 29aa0e4
**Applied fix:** Added a periodic `setInterval` cleanup (every 1 hour) that iterates the sessions Map and deletes entries older than `SESSION_TTL_MS`. The timer is `.unref()`'d so it does not prevent Node.js process exit during graceful shutdown. The timer handle is exported as `_sessionCleanupTimer` for test cleanup if needed.

### WR-03: Duplicate SIGTERM/SIGINT handlers create race between graceful and forced exit

**Files modified:** `src/bot.ts`
**Commit:** a0f1586
**Applied fix:** Moved the 5-second force-exit safety net `setTimeout` inside the `gracefulShutdown` function body (after the `shuttingDown` guard), and removed the duplicate `process.on('SIGTERM')` and `process.on('SIGINT')` handlers that were registering separate force-exit timers. Now there is exactly one handler per signal, and the force-exit timer starts exactly once when `gracefulShutdown` is first invoked.

## Skipped Issues

None -- all findings were fixed.

---

_Fixed: 2026-04-12T12:15:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
