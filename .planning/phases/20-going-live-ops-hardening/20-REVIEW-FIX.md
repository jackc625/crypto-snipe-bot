---
phase: 20-going-live-ops-hardening
iteration: 1
fix_scope: critical_warning
findings_in_scope: 13
fixed: 13
skipped: 0
status: all_fixed
---

# Phase 20: Code Review Fix Report

**Fixed at:** 2026-05-24
**Source review:** .planning/phases/20-going-live-ops-hardening/20-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 13 (4 Critical + 9 Warning; 5 Info skipped per `fix_scope = critical_warning`)
- Fixed: 13
- Skipped: 0
- TypeScript: clean (`tsc --noEmit -p .` passes for both main project and dashboard)

## Fixed Issues

### CR-01: `MAX_OPEN_POSITIONS=0` silently inflates wallet floor 10x

**Files modified:** `src/preflight.ts`
**Commit:** `ee044a4`
**Applied fix:** Replaced `Number(process.env.MAX_OPEN_POSITIONS) || 10` with an explicit `undefined`/empty-string check, then `Number.isInteger(...) && >= 0` validation. `MAX_OPEN_POSITIONS=0` is now respected; non-numeric input returns a clear `passed: false` PreflightResult instead of silently defaulting to 10.

### CR-02: CORS `origin: true` + `credentials: true` defeats SameSite for CSRF

**Files modified:** `src/api/server.ts`
**Commit:** `2d3395e`
**Applied fix:** Replaced reflective `origin: true` with an explicit allowlist driven by `DASHBOARD_ALLOWED_ORIGINS` (comma-separated). Same-origin requests (no Origin header) are still allowed so the SPA served from the same Express app continues to work; unlisted origins are rejected. Operators who deploy `DASHBOARD_HOST=0.0.0.0` must now populate `DASHBOARD_ALLOWED_ORIGINS` explicitly.

### CR-03: Telegram alert loop in `preflight()` can block FATAL exit indefinitely

**Files modified:** `src/preflight.ts`
**Commit:** `eca4f61`
**Applied fix:** Replaced the sequential `for…await sendTelegramAlert(...)` loop with parallel `Promise.race` per alert (5s timeout) + `Promise.allSettled`. Total alert phase is now bounded to ≤5s regardless of failure count or Telegram latency. Pino `log.fatal(...)` still fires first per failure so the operator gets the structured record even if Telegram is down.

### CR-04: SQLite `synchronous = NORMAL` + kill-switch design = pause write can be lost on SIGKILL

**Files modified:** `src/utils/db.ts`, `src/api/routes/controls.ts`, `src/bot.ts`
**Commit:** `bad8ea4`
**Applied fix:** Added a `forceWalCheckpoint()` helper to `db.ts` that runs `db.pragma('wal_checkpoint(FULL)')`, exported it, and called it after every kill-switch write: `setPauseState.run(...)` in controls.ts POST /pause, `clearPauseState.run(...)` in controls.ts POST /resume, and `setPauseState.run(...)` in bot.ts mid-run undercut auto-pause. Throughput cost is one extra fsync per pause/resume (infrequent operator action); durability cost of the previous behavior was a violated kill-switch contract. **Requires human verification** — recommend a SIGKILL-and-restart smoke test against a non-prod DB to confirm the WAL is durable across crashes.

### WR-01: CP2→`sendTxWithRetry` TOCTOU window allows post-pause submit

**Files modified:** `src/bot.ts`
**Commit:** `f7ea92d`
**Applied fix:** Comment-only clarification on both V2 (CP2 at line 381) and V3 (CP2 at line ~692) checkpoints. Now explicitly notes the TOCTOU window between the pause-read and the network call inside `sendTxWithRetry`, and that CP3 logs the after-the-fact case for audit. No behavior change — the design intentionally accepts this race per D-PAUSE-SHAPE; the original comment overstated the guarantee.

### WR-02: `controls.ts` GET `/pause` does not handle DB read failure

**Files modified:** `src/api/routes/controls.ts`
**Commit:** `0f23c42`
**Applied fix:** Wrapped the `getPauseState.get()` call in try/catch. On error: log via `log.error(...)` and return HTTP 503 with `{ paused: true, pausedBy: 'unknown', reason: 'pause-state DB read failed; see server logs' }`. The dashboard banner therefore stays sticky on transient DB errors instead of silently showing "no pause" — fail-CLOSED for the kill-switch invariant.

### WR-03: `scripts/pause.ts --reason` parser doesn't handle `=` form

**Files modified:** `scripts/pause.ts`
**Commit:** `f12ebc6`
**Applied fix:** Extracted a `getReasonArg()` helper that checks for `--reason=value` (GNU long-option form) first, falling back to the previous `--reason value` (space-separated) form, finally defaulting to `'CLI pause'`. Both `npm run pause -- --reason "x"` and `npm run pause -- --reason=x` now capture the reason.

### WR-04: `PauseBanner` Resume button has no disabled/loading state

**Files modified:** `dashboard/src/components/PauseBanner.tsx`
**Commit:** `f13e2b8`
**Applied fix:** Added `useState<boolean>(false)` for `resuming`. The handler bails immediately if `resuming === true`, sets it true before the fetch, throws on non-OK responses, and re-enables (`setResuming(false)`) only on error so the operator can retry. On success, the WS event drives the unmount as before. Button label flips to `Resuming...` with `disabled + opacity-50 + cursor-not-allowed` styling while in flight.

### WR-05: `setPauseState` audit columns can be lost if `paused_by` is undefined

**Files modified:** `src/api/routes/controls.ts`
**Commit:** `3988233`
**Applied fix:** Replaced `String(body.pausedBy ?? 'dashboard')` with strict-typed validation: `typeof body.pausedBy === 'string' ? ... : 'manual'`, then clamped against an `ALLOWED_PAUSED_BY` set (`'dashboard' | 'cli' | 'preflight' | 'manual'`). Same `typeof === 'string'` guard applied to `reason` so `String(null) === 'null'` can no longer leak into the banner.

### WR-06: `checkStaleData` uses raw `db.prepare` instead of the shared singleton statement

**Files modified:** `src/utils/db.ts`, `src/preflight.ts`
**Commit:** `e9fccd7`
**Applied fix:** Hoisted the stale-trades query to a cached prepared statement (`getStaleTradesQuery`) in `db.ts`, exported it, and updated `checkStaleData()` to reference it directly. Any SQL syntax error now surfaces at module load (matching every other cached statement in `db.ts`) rather than at first call; the import-once pattern eliminates a per-call `db.prepare` if Phase 21 wires this into a setInterval.

### WR-07: `Number(process.env.MID_RUN_CHECK_INTERVAL_SEC || '300') * 1000` — falsy-pitfall + no validation

**Files modified:** `src/bot.ts`
**Commit:** `073b739`
**Applied fix:** Replaced `|| '300'` with `?? '300'`, then `Number.isFinite(...) && >= 10` validation. Bad values (`NaN`, negative, < 10s) now trigger `mainLog.fatal(...)` + `process.exit(1)` at boot, preventing the prior pathology where `setInterval(cb, NaN)` would fire every event-loop tick and hammer RPC/DB.

### WR-08: `validateCrossEnvRules` Rule 1 is dead code for current architecture

**Files modified:** `src/preflight.ts`, `test/unit/preflight/crossEnvRules.test.ts`
**Commit:** `bdef364`
**Applied fix:** Rewrote Rule 1 from `process.env.MEV_STRATEGY === 'flashbots' && !FLASHBOTS_AUTH_KEY` (dead — MEV_STRATEGY is not consulted anywhere in the env contract; `chainRegistry.ts` hardcodes the strategy per chain) to `enabledChains.includes('eth') && !FLASHBOTS_AUTH_KEY`. The `details.rule` discriminator changed from `'mev-flashbots-auth-key'` to `'eth-flashbots-auth-key'`. Updated the matching unit test description; the test predicate itself still passes because the original test setup also has `ENABLED_CHAINS=eth` + no `FLASHBOTS_AUTH_KEY`.

### WR-09: `useWebSocket.ts:onmessage` switch falls through silently on unknown event types

**Files modified:** `dashboard/src/hooks/useWebSocket.ts`
**Commit:** `3aeb8e1`
**Applied fix:** Added a `default` arm to the dispatch switch that logs `'[WS] unknown event type:'` via `console.warn`. Replaced every silent `catch {}` with `catch (err)` + per-event-type `console.warn('[WS] <event>: malformed payload', err)`. The outer JSON.parse catch now logs `'[WS] failed to parse message:'` too. Behavior on malformed payloads is unchanged (still drops the event), but regressions are now visible in DevTools.

## Post-Fix Verification

- `tsc --noEmit -p .` (main project): passes clean
- `tsc --noEmit -p .` (dashboard): passes clean
- All 13 commits use conventional `fix(20): <ID> ...` format
- No pre-existing project errors surfaced by the edits (verified via incremental tsc after each fix)
- Pre-commit hooks honored (no `--no-verify` used); every fix commit completed without bypass

**Recommended human-verification steps before merging:**

1. **CR-04 (WAL durability):** smoke-test SIGKILL + restart against a non-prod SQLite DB to confirm the pause flag survives. The fix is mechanically correct but the kill-switch contract is safety-critical enough to validate empirically.
2. **CR-02 (CORS allowlist):** operators upgrading from the prior `origin: true` posture must now populate `DASHBOARD_ALLOWED_ORIGINS` when they want cross-origin access. Default deployment (same-origin SPA served from the same Express app) is unaffected.
3. **CR-01 (`MAX_OPEN_POSITIONS=0`):** operator-visible behavior change — `MAX_OPEN_POSITIONS=0` is now a documented "halt new entries" sentinel that PASSES preflight on any funded wallet (floor reduces to just `gasBuffer`); previously it FAILED with a falsely-inflated 10x floor. Confirm this matches the operator's mental model in `docs/operations/going-live.md §6`.
4. **WR-08 (Rule 1 rewrite):** the cross-env rule's `details.rule` discriminator changed from `'mev-flashbots-auth-key'` to `'eth-flashbots-auth-key'`. If any monitoring / log-grep query keys off that exact value, update accordingly.

---

_Fixed: 2026-05-24_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
