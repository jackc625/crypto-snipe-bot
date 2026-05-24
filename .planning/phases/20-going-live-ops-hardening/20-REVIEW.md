---
phase: 20-going-live-ops-hardening
reviewed: 2026-05-24T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - src/preflight.ts
  - src/bot.ts
  - src/chainRegistry.ts
  - src/config.ts
  - src/utils/db.ts
  - src/api/routes/controls.ts
  - scripts/preflight.ts
  - scripts/pause.ts
  - scripts/resume.ts
  - dashboard/src/components/PauseBanner.tsx
  - dashboard/src/components/Layout.tsx
  - dashboard/src/hooks/WebSocketContext.tsx
  - dashboard/src/hooks/useWebSocket.ts
  - dashboard/src/types/api.ts
  - docs/operations/going-live.md
  - .github/workflows/test.yml
  - test/integration/killswitchCheckpoints.test.ts
findings:
  critical: 4
  warning: 9
  info: 5
  total: 18
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-05-24
**Depth:** standard
**Files Reviewed:** 17 source files (plus 12 tests for cross-verification)
**Status:** issues_found

## Summary

Phase 20 hardens the bot for going-live: preflight checks, pause/resume control surface, mid-run wallet undercut detection, schema migration v6, and D-PAUSED-RESTART. The code is generally careful and well-commented, with strong adversarial intent in the comments themselves (mentions of T-20-xx mitigations, D-ROLLBACK, fail-closed paths). However, several real issues were found that affect capital safety, auth, and the killswitch contract:

- **Critical:** The pause/resume routes are wired in such a way that the dashboard CLI/operator UI can pause the bot, but the production order in `src/api/server.ts` mounts `controlRoutes` BEHIND `authMiddleware` — confirmed safe — yet `app.use(cors({ origin: true, credentials: true }))` defeats SameSite=strict cookie protection for cross-origin attacks because `origin: true` reflects any Origin header and allows credentials, which is a documented CORS anti-pattern (enables CSRF via any malicious site the operator visits in the same browser). Combined with the dashboard binding default `127.0.0.1`, this is local-only by default, but `DASHBOARD_HOST=0.0.0.0` makes this exploitable.
- **Critical:** `checkWalletBalance` uses `Number(process.env.MAX_OPEN_POSITIONS) || 10` — when `MAX_OPEN_POSITIONS=0` (a valid, deliberate operator choice meaning "halt new entries"), `||` short-circuits to the default `10`, inflating the wallet floor by 10x and **falsely passing** preflight at a time the operator believes positions are disabled. Same bug in `BigInt(maxOpen)` would throw on `NaN` for non-numeric input — but `0` is the meaningful failure mode.
- **Critical:** `setPauseState` and `clearPauseState` write to SQLite but the production sequence in `controls.ts` calls `broadcast(...)` AFTER `setPauseState.run(...)` with no guarantee of read-your-writes consistency across two different prepared statements. More importantly, the dashboard `useWebSocket.ts:hydrate` on reconnect does `GET /api/controls/pause` which queries the DB, but the SQLite reader configured `synchronous = NORMAL` (line `db.ts:22`) which under crash conditions can lose the very last write — a pause may not persist across a SIGKILL within milliseconds of the write. For a kill-switch this is a real risk.
- **Critical:** `validateCrossEnvRules` Rule 1 only fires when `MEV_STRATEGY=flashbots` is set as a top-level env var, but `chainRegistry.ts` derives `mevStrategy` from each chain template (e.g. ETH always uses flashbots regardless of `MEV_STRATEGY` env). When the operator sets `ENABLED_CHAINS=eth` without `MEV_STRATEGY=flashbots` AND without `FLASHBOTS_AUTH_KEY`, this cross-env rule does NOT fire — yet `chainRegistry.ts:948` will hit the per-chain FATAL anyway. The cross-env rule is dead for its stated purpose. (Note: the per-chain FATAL still catches it, so this is a duplicate-validation-with-misleading-coverage issue, not a fail-open gap.)

The pause-checkpoint logic (CP1/CP2/CP3) is well-designed but contains a TOCTOU window between CP2 and `sendTxWithRetry` for the V2 path (~lines 384-392). The Telegram alert in `preflight()` is fired in a loop with `await` inside it — a hung Telegram for the first failing chain can stall the FATAL exit indefinitely, defeating fail-fast.

Several Warnings stem from defensive-coding gaps: unhandled promise rejection in `controls.ts` GET `/pause`, the in-process `process.argv.indexOf('--reason')` parser in `pause.ts` does not handle `--reason=value` form, and the dashboard `PauseBanner` Resume button has no loading/disabled state, allowing double-clicks to spam `/resume` requests.

## Critical Issues

### CR-01: `MAX_OPEN_POSITIONS=0` silently inflates wallet floor 10x (capital-safety bug)

**File:** `src/preflight.ts:133`
**Issue:** The floor formula uses `Number(process.env.MAX_OPEN_POSITIONS) || 10`. JavaScript's `||` treats `0` as falsy, so `MAX_OPEN_POSITIONS=0` evaluates as `0 || 10 = 10`. An operator who deliberately sets `MAX_OPEN_POSITIONS=0` to halt new entries gets a floor computed with `10` positions, which inflates the floor by **10x**.

This is a capital-safety bug in two directions:
1. With a partially-funded wallet (the documented 0.0124 ETH scenario), preflight may FAIL when it should pass — operator cannot start the bot.
2. With a fully-funded wallet, preflight passes — but the FALSE floor is now ~0.035 ETH instead of ~0.005 ETH, and the mid-run undercut check (which reuses `checkWalletBalance`) will trigger spurious auto-pauses any time the balance drops below the inflated floor mid-run, even though there's only 1 funded position.

The bug also affects the docs/operations/going-live.md §6 example, which says "If you bump `MAX_OPEN_POSITIONS=3` without funding more" — that worked example also breaks at `MAX_OPEN_POSITIONS=0`.

**Fix:**
```typescript
// src/preflight.ts:133 — use ?? not ||
const maxOpenRaw = process.env.MAX_OPEN_POSITIONS;
const maxOpen = maxOpenRaw === undefined || maxOpenRaw === ''
    ? 10
    : Number(maxOpenRaw);
if (!Number.isInteger(maxOpen) || maxOpen < 0) {
    return {
        chain: chain.name,
        check: 'wallet-balance',
        passed: false,
        reason: `MAX_OPEN_POSITIONS must be a non-negative integer; got "${maxOpenRaw}"`,
        details: { maxOpenPositions: maxOpenRaw },
    };
}
```

Note: also enforce this validation in `validateCrossEnvRules()` so the operator sees the diagnostic once at boot, not per-chain.

---

### CR-02: CORS `origin: true` + `credentials: true` defeats SameSite cookie protection for CSRF

**File:** `src/api/server.ts:54`
**Issue:** `app.use(cors({ origin: true, credentials: true }))` is the documented CORS anti-pattern that reflects any incoming `Origin` header and emits `Access-Control-Allow-Credentials: true`. This allows ANY origin (including an attacker's site) to make a cross-origin request to the dashboard API with the operator's session cookie — defeating the `SameSite=strict` setting on the cookie itself.

Risk surface:
1. Default `DASHBOARD_HOST=127.0.0.1` mitigates somewhat — only locally-reachable.
2. But the operator is documented at `docs/operations/going-live.md:147` to be allowed to set `DASHBOARD_HOST=0.0.0.0` "with TLS in front" — at that point any malicious page the operator visits (in the same browser as the dashboard) can POST `/api/controls/pause`, `/api/controls/resume`, `/api/controls/emergency-sell`, etc.
3. Phase 20 specifically introduces `/api/controls/pause` and `/api/controls/resume` — both newly attackable via this CSRF.
4. The Phase 19 `/api/controls/emergency-sell` is also a known target — an attacker could trigger emergency-sell on every open position.

**Fix:**
```typescript
// src/api/server.ts:54 — restrict CORS origins to a known allowlist, or omit cors entirely for a same-origin SPA
const allowedOrigins = (process.env.DASHBOARD_ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
    origin: (origin, cb) => {
        // Allow same-origin (no Origin header) + explicit allowlist
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error('CORS: origin not allowed'));
    },
    credentials: true,
}));
```

For a same-origin SPA served from the same Express app (which is the actual deployment), `cors()` middleware can be omitted entirely. The current setup with `cors({ origin: true, credentials: true })` exists only to support cross-origin dev tools, which should not be the production posture.

---

### CR-03: Telegram alert loop in `preflight()` can block FATAL exit indefinitely

**File:** `src/preflight.ts:625-633`
**Issue:** On preflight failure, the code does:
```typescript
for (const r of failed) {
    log.fatal(...);
    try {
        await sendTelegramAlert(...);   // <-- await inside loop
    } catch (err) {
        log.warn(...);
    }
}
process.exit(1);
```

`sendTelegramAlert` makes an HTTP call to the Telegram Bot API. With N failed chains × M failed checks, this serially awaits N×M HTTP calls before `process.exit(1)`. If Telegram is degraded (the very condition where you most need preflight to be fast), the bot can hang for 30s+ per check before reaching `process.exit(1)`. Capital-at-risk operator gets a delayed FATAL exit, not the fast fail the design intends.

Worse: the comment on line 631 says "Telegram failure must not mask the FATAL exit path" — but a hung Telegram call (not a failure, just slow) does exactly that. `sendTelegramAlert` has no timeout in the surface signature; it inherits whatever the underlying HTTP library's default is (often "infinite").

**Fix:**
```typescript
// src/preflight.ts:614-635 — fire alerts in parallel with a hard timeout
if (failed.length > 0) {
    for (const r of failed) {
        log.fatal({ chain: r.chain, check: r.check, reason: r.reason, details: r.details, remediation: REMEDIATION_DOC },
            `Preflight failed: ${r.check} on ${r.chain}`);
    }
    const alertPromises = failed.map(r =>
        Promise.race([
            sendTelegramAlert(`*PREFLIGHT FATAL* [${r.chain}] ${r.check}: ${r.reason ?? 'no reason'} — see ${REMEDIATION_DOC}`),
            new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error('Telegram alert timed out')), 5000),
            ),
        ]).catch(err => log.warn({ err: (err as Error).message }, 'Telegram alert during preflight FATAL failed')),
    );
    await Promise.allSettled(alertPromises);  // bounded: ≤ 5s total
    process.exit(1);
}
```

This bounds the alert phase to ≤5s regardless of how many failures or how slow Telegram is.

---

### CR-04: `db.pragma('synchronous = NORMAL')` + the kill-switch design = pause write can be lost on SIGKILL

**File:** `src/utils/db.ts:22`, intersecting with `src/api/routes/controls.ts:241`
**Issue:** SQLite is configured `synchronous = NORMAL` (line 22). Per SQLite docs, NORMAL mode means "a power loss or hard system crash can lead to database corruption" — but more relevantly here, `synchronous = NORMAL` in WAL mode means the WAL file is not fsync'd on every commit; a transaction that's "committed" from the application's perspective may not have hit disk yet.

For most data this is fine. For the **kill-switch** it is a real risk: the design contract per `docs/operations/going-live.md:401` and Plan 20 D-PAUSED-RESTART says:

> "The pause flag is persisted in SQLite, so a SIGKILL + restart with `paused=1` honors the pause at CP1."

But with `synchronous = NORMAL`, the sequence:
1. Operator clicks Resume → `clearPauseState.run()` succeeds (returns immediately under NORMAL).
2. SIGKILL within ~milliseconds (e.g., systemd-killed during deploy, or operator hard-reboots).
3. Restart: SQLite recovers from the WAL; the resume write may or may not be present.
4. If lost: bot resumes from `paused=1`, which is the **safer** failure mode. ✓
5. If the inverse happens — operator sets pause, then SIGKILL before WAL fsync — bot restarts with `paused=0`, the dashboard shows "OK", new buys proceed despite the operator's intent. ✗ **This violates the kill-switch contract.**

The Phase 20 RESEARCH §1 + A1 explicitly addresses migration atomicity by wrapping DDL in `db.transaction()`, but does not address WAL durability for the runtime kill-switch writes.

**Fix:** For the pause/resume write specifically, fsync the WAL after each pause-state mutation. Options:

```typescript
// src/api/routes/controls.ts:241 — wrap setPauseState in a durability-forcing transaction
setPauseState.run(ts, pausedBy, reason);
// Force WAL checkpoint + fsync for the kill-switch write
db.pragma('wal_checkpoint(FULL)');
```

Alternatively, scope `synchronous = FULL` to just the pause writes:
```typescript
db.transaction(() => {
    db.pragma('synchronous = FULL');
    setPauseState.run(ts, pausedBy, reason);
    db.pragma('synchronous = NORMAL');
})();
```

The performance cost is one extra fsync per pause/resume — acceptable since both are infrequent operator actions, but unacceptable for the design-stated reliability contract to fail.

## Warnings

### WR-01: CP2→`sendTxWithRetry` TOCTOU window allows post-pause submit

**File:** `src/bot.ts:384-392` (V2 path), `src/bot.ts:688-695` (V3 path)
**Issue:** CP2 reads `getPauseState.get()` then calls `sendTxWithRetry(...)`. There is a non-zero gap (microseconds to seconds depending on event-loop saturation and MEV strategy) between the pause-read at CP2 and the actual network submit inside `sendTxWithRetry`. If the operator pauses in that window, the bundle still ships.

CP3 is documented as audit-only ("CP3 is an audit log per D-PAUSE-SHAPE, pause never panic-sells"), so the design intentionally accepts this race — but the comment on line 381 says "Pause flag set → discard built bundle, do NOT submit" which overstates the guarantee. The pause check at CP2 fires BEFORE the network call, not as part of it; there is no abort signal threaded into `sendTxWithRetry`.

This is a design-contract drift, not a bug — but it should be acknowledged in the comment.

**Fix:**
```typescript
// src/bot.ts:381 — clarify the CP2 contract
// Phase 20 / OPS-LIVE-08 D-KILLSWITCH-CP2 — post-bundle-build, pre-submit.
// Pause flag set → discard built bundle, do NOT submit.
// NOTE: there is a TOCTOU window between the read here and the network call
// inside sendTxWithRetry; pause flipped in that window will NOT abort the
// in-flight submit. CP3 below catches the after-the-fact case (audit only).
```

A stronger fix would thread an abort signal into `sendTxWithRetry` and re-check pause inside the retry loop, but that requires plumbing across multiple modules. For the kill-switch contract as stated, the comment update is sufficient.

---

### WR-02: `controls.ts` GET `/pause` does not handle DB read failure

**File:** `src/api/routes/controls.ts:270-283`
**Issue:** The GET `/pause` handler calls `getPauseState.get()` synchronously and immediately casts to the expected shape. If the prepared statement throws (e.g., DB locked, file deleted mid-run, corruption recovery), the error propagates to Express's default error handler → returns 500 with a stack trace in dev mode. The dashboard's `useWebSocket.ts:hydrate` swallows the error silently (`if (pauseRes.ok)` is false) and leaves `pauseState` as null — banner shows "not paused" even if the actual state on disk says paused.

This is a fail-open path: a transient DB error makes the dashboard show "no pause" when the bot is paused.

**Fix:**
```typescript
router.get('/pause', (_req: Request, res: Response) => {
    try {
        const row = getPauseState.get() as { paused: number; paused_at: number | null; paused_by: string | null; reason: string | null; };
        res.json({
            paused: row.paused === 1,
            pausedAt: row.paused_at,
            pausedBy: row.paused_by,
            reason: row.reason,
        });
    } catch (err) {
        log.error({ err }, 'GET /pause: DB read failed');
        // Fail-closed: return paused=true so banner shows up even on DB error.
        // Operator can investigate via npm logs or sqlite3 CLI.
        res.status(503).json({
            paused: true,
            pausedAt: null,
            pausedBy: 'unknown',
            reason: 'pause-state DB read failed; see server logs',
        });
    }
});
```

The dashboard `useWebSocket.ts` should also distinguish 503 from non-200 and re-fetch on a short backoff.

---

### WR-03: `scripts/pause.ts` --reason parser doesn't handle `=` form

**File:** `scripts/pause.ts:34-39`
**Issue:** The reason parser only handles `--reason "value"` (space-separated). It does NOT handle `--reason=value`, which is the standard GNU long-option form most operators reach for. With `--reason=foo`, the parser sees argv[3] = `'--reason=foo'`, finds index -1 for `'--reason'`, and silently falls back to the default `'CLI pause'`. The operator believes their reason was captured; it wasn't.

**Fix:**
```typescript
// scripts/pause.ts:35-39 — handle both --reason value AND --reason=value
function getReasonArg(): string {
    const argv = process.argv;
    // --reason=value form
    const eqArg = argv.find(a => a.startsWith('--reason='));
    if (eqArg) return eqArg.slice('--reason='.length);
    // --reason value form
    const idx = argv.indexOf('--reason');
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
    return 'CLI pause';
}
const reason = getReasonArg();
```

---

### WR-04: `PauseBanner` Resume button has no disabled/loading state — double-click spams /resume

**File:** `dashboard/src/components/PauseBanner.tsx:39-53`
**Issue:** Clicking Resume fires a `fetch('/api/controls/resume', ...)`. The button is not disabled while the request is in flight. Operator double-clicks → two POSTs. The second one races the WS broadcast, possibly setting `pauseState` to null then immediately back to its prior value if the network round-trip is fast. More importantly, `clearPauseState.run()` is called twice → two `broadcast('pause_state_change', ...)` events fired → noise in the audit log and potential confusion of any other client also subscribed.

A network failure also leaves the button live (per the comment on line 49) but with no UI indication that the click was lost.

**Fix:**
```typescript
// dashboard/src/components/PauseBanner.tsx
import { useState } from 'react';

export function PauseBanner() {
  const { pauseState } = useWs();
  const [resuming, setResuming] = useState(false);
  if (!pauseState || !pauseState.paused) return null;

  async function handleResume() {
    if (resuming) return;
    setResuming(true);
    try {
      const res = await fetch('/api/controls/resume', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(`Resume failed: ${res.status}`);
    } catch (e) {
      console.error('Resume request failed', e);
      // Re-enable button so operator can retry.
      setResuming(false);
    }
    // On success, the WS event drives the unmount — no need to reset resuming.
  }

  return (
    <div className="...">
      ...
      <button type="button" onClick={handleResume} disabled={resuming}
        className={`... ${resuming ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'}`}>
        {resuming ? 'Resuming...' : 'Resume'}
      </button>
    </div>
  );
}
```

---

### WR-05: `setPauseState` audit columns can be lost if `paused_by` is undefined

**File:** `src/api/routes/controls.ts:237-241`
**Issue:** The pause handler does:
```typescript
const pausedBy = String(body.pausedBy ?? 'dashboard');
```
But `body` is typed as `{ reason?: string; pausedBy?: string }` and never validated. If `body.pausedBy = 12345` (operator misuses `curl -d ...`), `String(12345)` produces `'12345'` — stored in `paused_by` column, which `dashboard/src/types/api.ts:120` claims is union `'dashboard' | 'cli' | 'preflight' | 'manual' | null`. The dashboard's PauseBanner will render `by 12345`, breaking the documented contract.

Same issue applies to `reason`: `sanitizeReason(String(body.reason ?? 'manual operator pause'))` — `String(null)` produces `'null'`, which is then sanitized (no-op). The operator sees `Reason: null` in the banner.

**Fix:**
```typescript
router.post('/pause', async (req: Request, res: Response) => {
    const pauseLog = log.child({ action: 'pause' });
    try {
        const body = req.body as { reason?: string; pausedBy?: string };
        const ALLOWED_PAUSED_BY = new Set(['dashboard', 'cli', 'preflight', 'manual']);
        const rawPausedBy = typeof body.pausedBy === 'string' ? body.pausedBy : 'manual';
        const pausedBy = ALLOWED_PAUSED_BY.has(rawPausedBy) ? rawPausedBy : 'manual';
        const rawReason = typeof body.reason === 'string' ? body.reason : 'manual operator pause';
        const reason = sanitizeReason(rawReason);
        // ... rest unchanged
    }
});
```

---

### WR-06: `checkStaleData` uses raw `db.prepare` instead of the shared singleton statement

**File:** `src/preflight.ts:487-490`
**Issue:** Every call to `checkStaleData()` builds a new prepared statement via `db.prepare(...)`. This bypasses the prepared-statement caching pattern used everywhere else in `db.ts` (e.g., `getPauseState`, `insertTrade` are cached at module load). For a startup-time one-shot scan this doesn't matter, but the design hint at line 482 ("One-shot scan at startup") is misleading — if Phase 21 ever wires this into a setInterval (which the comment hints at), the per-call `db.prepare` becomes wasteful.

Also, the statement is built lazily inside the function, which means errors in the SQL literal don't surface until first call. Other preflight checks would block this from being noticed in a unit test that doesn't exercise the stale-data path.

**Fix:** Hoist to a cached prepared statement in `db.ts` and re-export:
```typescript
// src/utils/db.ts
const getStaleTradesQuery = db.prepare(
    `SELECT id, token, chain, timestamp FROM trades WHERE status = 'pending' AND action = 'buy' AND timestamp < ?`,
);
// ... export
```

```typescript
// src/preflight.ts:487
import { getStaleTradesQuery } from './utils/db';
// ...
const rows = getStaleTradesQuery.all(nowSec - warnSec) as Array<{ id: number; token: string; chain: string; timestamp: number; }>;
```

---

### WR-07: `Number(process.env.MID_RUN_CHECK_INTERVAL_SEC || '300') * 1000` — falsy-pitfall + no validation

**File:** `src/bot.ts:1016`
**Issue:** Same falsy-pitfall as CR-01 but lower severity here. `MID_RUN_CHECK_INTERVAL_SEC=0` would resolve to `'300' * 1000 = 300_000ms` (since `'0' || '300'` = `'300'`), not `0 * 1000 = 0`. That's actually the **safer** behavior (zero would mean infinite tick storm), but it's incidental, not designed.

The bigger issue: there is no validation. `MID_RUN_CHECK_INTERVAL_SEC=abc` → `Number('abc') * 1000 = NaN` → `setInterval(callback, NaN)` → Node treats this as `1ms` (or 4ms minimum). The mid-run wallet check fires every event-loop tick, hammering RPC and the DB. The operator has no way to know what happened.

**Fix:**
```typescript
const raw = process.env.MID_RUN_CHECK_INTERVAL_SEC ?? '300';
const sec = Number(raw);
if (!Number.isFinite(sec) || sec < 10) {
    mainLog.fatal({ key: 'MID_RUN_CHECK_INTERVAL_SEC', value: raw }, 'MID_RUN_CHECK_INTERVAL_SEC must be >= 10 seconds');
    process.exit(1);
}
const midRunIntervalMs = sec * 1000;
```

Also worth registering in `validateCrossEnvRules()` so this fires during preflight, not buried in startup.

---

### WR-08: `validateCrossEnvRules` Rule 1 is dead code for current architecture

**File:** `src/preflight.ts:399-408`
**Issue:** Rule 1 is gated on `process.env.MEV_STRATEGY === 'flashbots'`. But `MEV_STRATEGY` is NOT in the `REQUIRED_ENV_VARS` list at `src/config.ts`, and `chainRegistry.ts` does not consult `process.env.MEV_STRATEGY` at all — the strategy is hardcoded per-chain in `CHAIN_TEMPLATES`. The rule never fires in practice.

This is dead validation — the per-chain FATAL at `chainRegistry.ts:948-950` is what actually catches missing FLASHBOTS_AUTH_KEY for ETH. The cross-env rule's stated purpose ("MEV_STRATEGY=flashbots ⇔ FLASHBOTS_AUTH_KEY non-empty") doesn't match the actual env contract.

**Fix:** Either remove the rule (it's dead) or rewrite to match the actual contract:
```typescript
// Rule 1: ENABLED_CHAINS includes eth ⇔ FLASHBOTS_AUTH_KEY non-empty
if (enabledChains.includes('eth') && !process.env.FLASHBOTS_AUTH_KEY) {
    results.push({
        chain: 'global',
        check: 'cross-env-rule',
        passed: false,
        reason: 'ENABLED_CHAINS includes eth (Flashbots) but FLASHBOTS_AUTH_KEY is not set',
        details: { rule: 'eth-flashbots-auth-key' },
    });
}
```

This makes Rule 1 a real fail-loud at the cross-env layer, AND matches the existing per-chain FATAL pattern.

---

### WR-09: `useWebSocket.ts:onmessage` switch falls through silently on unknown event types

**File:** `dashboard/src/hooks/useWebSocket.ts:127-273`
**Issue:** The switch has no `default` case. An unknown `msg.type` (typo, version mismatch between bot and dashboard) is silently dropped — no `console.warn`, no error surfaced. This makes regressions hard to diagnose.

More concerning: the per-case `try/catch` blocks silently swallow malformed payloads (e.g., line 190 `// Malformed payload -- drop silently, do not break dispatch`). The intent (don't crash on bad data) is good, but the absence of any logging means a malformed `pause_state_change` event would result in the dashboard banner getting stuck — no diagnostic anywhere to identify why.

**Fix:**
```typescript
ws.onmessage = (event) => {
    try {
        const msg = JSON.parse(event.data) as WsEvent<unknown>;
        setLastMessage(msg);
        switch (msg.type) {
            // ... existing cases ...
            default:
                console.warn('[WS] unknown event type:', msg.type);
        }
    } catch (err) {
        console.warn('[WS] failed to parse message:', err);
    }
};
```

And each catch should at least `console.warn` so the regressions are visible in DevTools:
```typescript
case 'pause_state_change': {
    try { ... } catch (err) {
        console.warn('[WS] pause_state_change: malformed payload', err);
    }
    break;
}
```

## Info

### IN-01: `preflightDryRun` runs all chain checks in parallel but only one chain at a time

**File:** `src/preflight.ts:562-573`
**Issue:** Comment says "per-chain checks in parallel per chain" but the outer loop is serial across chains:
```typescript
for (const chain of getEnabledChains(registry)) {
    const chainResults = await Promise.all([...checks for this chain...]);
    results.push(...chainResults);
}
```
For 4 chains × 6 checks, this serializes the 4 chains. Not a correctness issue (the comment doesn't promise inter-chain parallelism), but for multi-chain configs (Phase 20 docs mention adding BSC/Base/Arb), this adds latency to preflight. Out of v1 scope, but worth flagging.

**Fix (Phase 21):** Outer parallelism with `Promise.all(chains.map(...))` to fan out across chains.

---

### IN-02: `chainRegistry.ts:1067` non-null assertion on `process.env.PRIVATE_KEY`

**File:** `src/chainRegistry.ts:1067`
**Issue:** `new ethers.Wallet(process.env.PRIVATE_KEY!, httpProvider)` — the `!` asserts non-null. This is correct (config.ts validates PRIVATE_KEY is required at boot), but if someone refactors config.ts and removes the validation, the assertion silently hides the regression — `ethers.Wallet(undefined, ...)` throws an unhelpful "invalid private key" deep in ethers internals.

**Fix:** Defense-in-depth:
```typescript
const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
    throw new Error('PRIVATE_KEY is required to create a wallet — should have been caught at config.ts boot');
}
const wallet = new ethers.Wallet(privateKey, httpProvider);
```

---

### IN-03: `db.ts:198` `migrateSchema()` runs at module load — testability concern

**File:** `src/utils/db.ts:197-198`
**Issue:** `migrateSchema()` and `migrateJsonState()` + `normalizeLegacyMainnetRows()` run at module load. Any test that imports `src/utils/db.ts` (directly or transitively) triggers the migration against the production DB at `DB_PATH`. The integration tests mostly mock `db` to avoid this, but a non-mocking import would mutate the real file.

This is not a Phase 20 regression (it's pre-existing), but Phase 20 adds the v5→v6 migration which compounds the risk. Worth deferring to a future refactor that gates migration behind an explicit `initDb()` call.

---

### IN-04: `docs/operations/going-live.md:227` documented endpoint mismatches actual route

**File:** `docs/operations/going-live.md:227`
**Issue:** The "Kill switch" section documents:
```
curl -b cookies.txt -X POST http://127.0.0.1:8080/api/controls/pause-snipes
```
But the actual route is `/api/controls/pause` (per `controls.ts:234`), not `/api/controls/pause-snipes`. An operator copying this command verbatim will get a 404.

**Fix:** Update §9 to:
```bash
# pause
curl -b cookies.txt -X POST http://127.0.0.1:8080/api/controls/pause \
  -H "Content-Type: application/json" \
  -d '{"reason": "manual pause", "pausedBy": "manual"}'
```

---

### IN-05: `printPreflightSummary` not called during dry-run CLI path

**File:** `scripts/preflight.ts:54-81` vs `src/preflight.ts:526-539`
**Issue:** The CLI has its own `printHumanSummary` function that duplicates the logic of `printPreflightSummary` in `src/preflight.ts`. They produce slightly different log shapes — the bot's startup-time `preflight()` logs `"Preflight summary for ${chain}"` with checks array; the CLI logs `"--- ${chain.toUpperCase()} ---"` with per-check lines. Operators comparing CLI output to bot logs will see different formats for the same data.

**Fix:** Export `printPreflightSummary` from `src/preflight.ts` and reuse it in `scripts/preflight.ts`. Either both human-formats are consistent, or one is consistently the contract.

---

_Reviewed: 2026-05-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
