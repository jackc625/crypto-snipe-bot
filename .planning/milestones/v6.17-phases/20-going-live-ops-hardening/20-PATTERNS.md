# Phase 20: Going-Live Ops Hardening - Pattern Map

**Mapped:** 2026-05-24
**Files analyzed:** 14 (5 NEW + 9 MODIFY)
**Analogs found:** 14 / 14

---

## File Classification

| File | Role | Data Flow | NEW/MODIFY | Closest Analog | Match Quality |
|------|------|-----------|------------|----------------|---------------|
| `src/preflight.ts` | startup-validator module | request-response (RPC reads, FATAL exit) | NEW | `src/anti-rug/allowlist.ts` `verifyAllowlistAtStartup` | exact |
| `scripts/preflight.ts` | operator CLI | batch / process.exit | NEW | `scripts/deploy-honeypot-checker.ts` | role-match |
| `scripts/pause.ts` | operator CLI | request-response (HTTP) | NEW | `scripts/deploy-honeypot-checker.ts` | role-match |
| `scripts/resume.ts` | operator CLI | request-response (HTTP) | NEW | `scripts/deploy-honeypot-checker.ts` | role-match |
| `dashboard/src/components/PauseBanner.tsx` | dashboard component | event-driven (WS) | NEW | `dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx` | exact |
| `src/utils/db.ts` | data layer / schema | CRUD + migration | MODIFY | `src/utils/db.ts` v4→v5 migration (lines 122-154) + v3→v4 ALTER guard (lines 113-119) | exact (self-extension) |
| `src/api/routes/controls.ts` | controller / route | request-response | MODIFY | `controls.ts` existing `force-sell` / `emergency-sell` (lines 51-218) | exact (self-extension) |
| `src/bot.ts` (preflight call) | orchestrator wiring | startup | MODIFY | `bot.ts:874-895` existing chainId guard (which MOVES into preflight) | exact (self-replace) |
| `src/bot.ts` (3 V2 killswitch CPs) | controller checkpoint | request-response | MODIFY | `bot.ts:340-396` `handleNewPairForChain` body itself + Phase 19 anti-rug skip-return at line 343 | exact (self-extension) |
| `src/bot.ts` (3 V3 killswitch CPs) | controller checkpoint | request-response | MODIFY | `bot.ts:600-665` `handleNewV3PoolForChain` body itself | exact (self-extension) |
| `src/bot.ts` (mid-run setInterval) | periodic worker | event-driven (timer) | MODIFY | `bot.ts:917-926` existing MEV health setInterval | exact (sibling-pattern) |
| `src/chainRegistry.ts` (`defaultGasBuffer`) | config | static template | MODIFY | `chainRegistry.ts:128-148` per-chain field extensions (Phase 18 `defaultHoneypotCheckerAddress`, Phase 19 `defaultAntiRugLpRemovalPct`) | exact (sibling-extension) |
| `src/config.ts` `REQUIRED_ENV_VARS` | config registry | static list | MODIFY | `config.ts:13-131` existing `REQUIRED_ENV_VARS` Phase 19 anti-rug rows | exact (self-extension) |
| `.github/workflows/test.yml` | CI guard | build-time check | MODIFY | `test.yml:20-33` Phase 17 `.todo` ban step | exact (sibling-pattern) |

---

## Pattern Assignments

### NEW: `src/preflight.ts` (startup-validator, request-response + FATAL exit)

**Analog:** `src/anti-rug/allowlist.ts` `verifyAllowlistAtStartup` (lines 1-164)
**Secondary analog:** `src/chainRegistry.ts:613-622` (`buildChainRegistry` enabled-chain validation FATAL)
**Secondary analog:** `src/config.ts:133-144` (`validateEnvVars` REQUIRED loop + FATAL)

**Module header pattern** (lines 1-46):
```typescript
// src/anti-rug/allowlist.ts
// Phase 19 / Plan 19-03 Task 2 — Allowlist verification, lookup, and merge
// helpers for the anti-rug detector signal-2 evaluator.
//
// Exports:
//   - verifyAllowlistAtStartup(ctx, allowlistV2, allowlistV3)
//       D-LIST-VERIFY: getCode() check on every non-DEAD entry; FATAL exit
//       on EOA (empty code) with structured pino fields identifying the
//       offending entry.
// ...
import { logger } from '../utils/logger';
import type { ChainContext } from '../chainRegistry';

const log = logger.child({ module: 'antiRug:allowlist' });
```

**Imports pattern** (lines 42-47):
```typescript
import type { AllowlistEntry } from './types';
import { DEAD_ADDRESS } from './events';
import { logger } from '../utils/logger';
import type { ChainContext } from '../chainRegistry';

const log = logger.child({ module: 'antiRug:allowlist' });
```

**Core pattern: `getCode()` startup check + FATAL exit** (lines 115-149):
```typescript
export async function verifyAllowlistAtStartup(
    ctx: ChainContext,
    allowlistV2: AllowlistEntry[],
    allowlistV3: AllowlistEntry[],
): Promise<void> {
    // ... loop building tagged entries ...
    for (const { entry, poolType } of tagged) {
        if (entry.address.toLowerCase() === DEAD_ADDRESS) {
            continue;
        }
        const code = await ctx.httpProvider.getCode(entry.address);
        if (code === '0x') {
            log.fatal(
                {
                    chain: ctx.chain.name,
                    address: entry.address,
                    lockerName: entry.lockerName,
                    provenance: entry.provenance,
                    poolType,
                },
                'Anti-rug allowlist address has no code (EOA?) — refusing to start',
            );
            process.exit(1);
        }
    }
```

**FATAL pattern (secondary analog) — `chainRegistry.ts:613-622`:**
```typescript
const enabledRaw = (process.env.ENABLED_CHAINS || 'eth').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Validate chain names
for (const name of enabledRaw) {
    if (!VALID_CHAIN_NAMES.includes(name)) {
        log.fatal({ chain: name, validChains: VALID_CHAIN_NAMES }, 'Unknown chain name in ENABLED_CHAINS');
        process.exit(1);
    }
}
```

**FATAL pattern (tertiary analog) — `config.ts:133-144`:**
```typescript
function validateEnvVars(): void {
    const missing: string[] = [];
    for (const spec of REQUIRED_ENV_VARS) {
        if (spec.required && !process.env[spec.name]) {
            missing.push(`  - ${spec.name}: ${spec.description}`);
        }
    }
    if (missing.length > 0) {
        logger.fatal({ missing: missing.map(m => m.trim().replace(/^- /, '')) }, 'Missing required environment variables');
        process.exit(1);
    }
}
```

**What to replicate:** `httpProvider.getCode()` for code-at-address check; `logger.child({ module: 'preflight' })` scoped logger; structured-fields-then-message order in `log.fatal({...}, 'message')`; `process.exit(1)` immediately after FATAL.

**What's different:** Preflight runs `Promise.all` over multiple check types per chain (wallet/RPC/MEV/checker/cross-env), **collects all results** before exiting (D-PREFLIGHT-FLOW collect-all-then-exit), and exposes both `preflight()` (FATAL) and `preflightDryRun()` (returns `PreflightResult[]` without exit) — the analog has only one shape.

---

### NEW: `scripts/preflight.ts` (operator CLI, batch / process.exit)

**Analog:** `scripts/deploy-honeypot-checker.ts` (lines 1-116)

**Imports + dotenv pattern** (lines 33-40):
```typescript
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';

import { logger } from '../src/utils/logger';

dotenv.config();

const log = logger.child({ module: 'deploy-honeypot-checker' });
```

**Argument/env validation + FATAL exit pattern** (lines 52-67):
```typescript
const chain = process.argv[2];

if (!chain || !(chain in CHAIN_TO_NETWORK)) {
    log.fatal(
        { chain, valid: Object.keys(CHAIN_TO_NETWORK) },
        'Usage: ts-node scripts/deploy-honeypot-checker.ts <chain>'
    );
    process.exit(1);
}

if (!process.env.DEPLOY_PRIVATE_KEY) {
    log.fatal(
        'DEPLOY_PRIVATE_KEY env var required. Rotate this key out of .env after deploy per D-DEPLOY-KEY.'
    );
    process.exit(1);
}
```

**What to replicate:** `dotenv.config()` at top, `logger.child({ module: 'preflight-cli' })` named logger, fail-fast env validation, `log.fatal` + `process.exit(1)` for any error. Reuse `--json` arg pattern via `process.argv.includes('--json')`.

**What's different:** Does NOT spawn a subprocess; imports `preflightDryRun()` from `src/preflight.ts` directly and runs in-process. Does NOT start the bot. Exits 0 on all-pass / 1 on any FATAL / 2 on uncaught throw (matches research §9 pattern).

---

### NEW: `scripts/pause.ts` (operator CLI, request-response HTTP)

**Analog:** `scripts/deploy-honeypot-checker.ts` (script skeleton) + RESEARCH.md §9 axios login flow (lines 599-625)

**Skeleton from `scripts/deploy-honeypot-checker.ts:33-40`:**
```typescript
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';

import { logger } from '../src/utils/logger';

dotenv.config();

const log = logger.child({ module: 'deploy-honeypot-checker' });
```

**Login-then-POST flow (research excerpt, `20-RESEARCH.md` §9, lines 599-625):**
```typescript
const apiKey = process.env.DASHBOARD_API_KEY;
const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
const reasonArg = process.argv.indexOf('--reason');
const reason = reasonArg >= 0 ? process.argv[reasonArg + 1] : 'CLI pause';

if (!apiKey) {
    log.fatal('DASHBOARD_API_KEY not set in .env');
    process.exit(1);
}

// Step 1: login
const loginRes = await axios.post(
    `${dashboardUrl}/api/auth/login`,
    { apiKey },
    { withCredentials: true, validateStatus: () => true },
);
if (loginRes.status !== 200) {
    log.fatal({ status: loginRes.status, body: loginRes.data }, 'Login failed');
    process.exit(1);
}
const cookie = loginRes.headers['set-cookie']?.[0] || '';

// Step 2: pause
const pauseRes = await axios.post(
    `${dashboardUrl}/api/controls/pause`,
    { reason, pausedBy: 'cli' },
    { headers: { Cookie: cookie }, validateStatus: () => true },
);
```

**What to replicate:** `dotenv.config()`, `logger.child({ module: 'pause-cli' })`, fail-fast on `DASHBOARD_API_KEY` missing, axios with `validateStatus: () => true` (so non-2xx returns instead of throwing), env-passing of API key (never CLI-arg per T-20-05).

**What's different:** Uses `axios` (already a dep) instead of `spawnSync`. Two-step flow (login → action). Reads `DASHBOARD_URL` env (new) with `http://localhost:3000` default.

---

### NEW: `scripts/resume.ts` (operator CLI, request-response HTTP)

**Analog:** `scripts/pause.ts` (above, sibling)

**What to replicate:** Identical structure to `pause.ts` — dotenv, logger, two-step login-then-action.

**What's different:** POSTs `/api/controls/resume` with no body (no `reason` arg). ~40 LOC vs `pause.ts`'s ~50 LOC.

---

### NEW: `dashboard/src/components/PauseBanner.tsx` (dashboard component, event-driven WS)

**Analog:** `dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx` (lines 1-65)

**Component header + imports** (lines 1-25):
```typescript
// dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx
// Phase 19 / Plan 19-06 — Full-bleed CB-tripped alert banner.
// ...
import { AlertOctagon } from 'lucide-react';
import type { CbTrippedPayload } from '../../types/api';
import { ChainBadge } from '../ChainBadge';

interface CircuitBreakerBannerProps {
  /** Per-chain map of currently-tripped circuit breakers. */
  trips: Record<string, CbTrippedPayload>;
  /** Click handler when operator clicks a chain chip / CTA — opens reset modal targeted at this chain. */
  onResetClick: (chain: string) => void;
}
```

**Full-bleed banner JSX pattern** (lines 27-65):
```typescript
export function CircuitBreakerBanner({ trips, onResetClick }: CircuitBreakerBannerProps) {
  const trippedChains = Object.keys(trips);
  if (trippedChains.length === 0) return null;

  // ...
  return (
    <div className="bg-loss text-white py-3 px-4 mb-4 -mx-4 sm:-mx-6 lg:-mx-8">
      <div className="flex items-start gap-3">
        <AlertOctagon className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="text-xl font-bold leading-[1.2]">
            {isSingle && single
              ? `ANTI-RUG HALTED ON ${trippedChains[0].toUpperCase()} — ${single.triggerCount} triggers in last hour`
              : `ANTI-RUG HALTED ON ${trippedChains.length} CHAINS`}
          </h2>
          <p className="text-sm mt-1">
            Anti-rug monitoring is paused on this chain. New positions will open without anti-rug coverage until you review the triggers and reset the breaker.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {trippedChains.map((chain) => (
              <button type="button" onClick={() => onResetClick(chain)} ...>
```

**Mount-point pattern (`dashboard/src/components/Layout.tsx:30-42`):**
```typescript
return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
        wsConnected={connected}
        telegramStatus={telegramStatus}
      />
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
);
```

**What to replicate:** Tailwind `bg-loss text-white py-3 px-4 mb-4 -mx-4 sm:-mx-6 lg:-mx-8` full-bleed banner classes (RESEARCH §"Open Question 10" recommendation); `lucide-react` icon import (use `PauseCircle` or `AlertOctagon`); early-return `if (!paused) return null;` pattern; structured props interface above the component; mount ABOVE `<main>` in `Layout.tsx`.

**What's different:** Pause is a SINGLE GLOBAL state (not per-chain map). Component reads `pauseState: { paused, pausedBy, pausedAt, reason }` from `useWs()` context (extended in `WebSocketContext.tsx`). Resume button POSTs `/api/controls/resume` with no body (vs CB's per-chain modal). Initial state hydration via `useApi<PauseState>('/api/controls/pause')` per RESEARCH §10.

---

### MODIFY: `src/utils/db.ts` (data layer / schema migration v5→v6)

**Analog:** Self-extension — `src/utils/db.ts:122-154` (Phase 19 v4→v5 migration) + `src/utils/db.ts:112-119` (Phase 17 v3→v4 ALTER guard)

**Schema migration block pattern (v4→v5, lines 122-154):**
```typescript
if (version < 5) {
    // Phase 19 / ANTIRUG-04 / ANTIRUG-16: lp_baseline (LP-reserve / V3-active-liquidity
    // snapshot at buy-success per trade) + chain_state (last-seen-block per chain for
    // restart-time getLogs backfill per D-BACKFILL).
    db.exec(`
        CREATE TABLE IF NOT EXISTS lp_baseline (
            trade_id INTEGER PRIMARY KEY,
            pool_type TEXT NOT NULL CHECK(pool_type IN ('v2', 'v3')),
            pair_or_pool_address TEXT NOT NULL COLLATE NOCASE,
            ...
            FOREIGN KEY (trade_id) REFERENCES trades(id)
        );
        CREATE INDEX IF NOT EXISTS idx_lp_baseline_pool ON lp_baseline(pair_or_pool_address);

        CREATE TABLE IF NOT EXISTS chain_state (
            chain TEXT PRIMARY KEY,
            last_seen_block INTEGER NOT NULL,
            last_updated_ts INTEGER NOT NULL
        );
    `);
    logger.info('Created lp_baseline + chain_state tables (schema version 5)');
}
```

**ALTER column-existence guard pattern (v3→v4, lines 112-119):**
```typescript
if (version < 4) {
    // D-14: Belt-and-suspenders column-existence guard
    const columns = db.prepare("PRAGMA table_info('trades')").all() as Array<{ name: string }>;
    const hasColumn = columns.some(c => c.name === 'dex_name');
    if (!hasColumn) {
        db.exec(`ALTER TABLE trades ADD COLUMN dex_name TEXT DEFAULT NULL`);
    }
    logger.info('Added dex_name column (schema version 4)');
}
```

**Prepared statement export pattern (lines 487-522):**
```typescript
const upsertChainState = db.prepare(`
    INSERT INTO chain_state (chain, last_seen_block, last_updated_ts)
    VALUES (?, ?, ?)
    ON CONFLICT(chain) DO UPDATE SET
        last_seen_block = excluded.last_seen_block,
        last_updated_ts = excluded.last_updated_ts
`);

const getChainState = db.prepare(`SELECT last_seen_block, last_updated_ts FROM chain_state WHERE chain = ?`);

// --- Exports ---
export {
    db,
    insertTrade,
    // ...
    upsertChainState,
    getChainState,
};
```

**What to replicate:** Bump `CURRENT_SCHEMA_VERSION` from `5` to `6` (line 27); add `if (version < 6) { ... }` block before the `db.pragma(\`user_version = ${CURRENT_SCHEMA_VERSION}\`)` at line 156; `CREATE TABLE IF NOT EXISTS` for new `pause_state` table; `PRAGMA table_info('chain_state')` + `columns.some()` ALTER guard for `antirug_dry_run_started` column (because re-running v6 must not error on existing column); `INSERT OR IGNORE` for seed row (single-row pattern with `CHECK(id=1)`); `logger.info('Created pause_state + antirug_dry_run_started (schema version 6)')`; add `getPauseState` / `setPauseState` / `clearPauseState` / `setAntirugDryRunStarted` / `getAntirugDryRunStarted` prepared statements alongside existing exports; add to `export { ... }` block at lines 504-522.

**What's different:** First migration that mixes `CREATE TABLE` + `INSERT OR IGNORE` seed + `ALTER TABLE` in one version step. RESEARCH §1 recommends wrapping in `db.transaction(() => { ... })()` for atomicity (A1 assumption — verify DDL inside transaction works on better-sqlite3 v12.8). v3→v4 was ALTER-only; v4→v5 was CREATE-only; v5→v6 is hybrid.

---

### MODIFY: `src/api/routes/controls.ts` (controller / route extension)

**Analog:** Self-extension — `controls.ts:51-110` (`POST /force-sell/:tradeId`) and `controls.ts:114-218` (`POST /emergency-sell`)

**Route imports + module logger** (lines 1-13):
```typescript
import { Router, Request, Response } from 'express';
import type { ChainContext, DexConfig } from '../../chainRegistry';
import { db } from '../../utils/db';
import { clearAllTimersForToken } from '../../utils/exitManager';
import { executeFullSell } from '../../exitEngine';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'api:controls' });
```

**Route handler pattern (`POST /emergency-sell` from `controls.ts:114-130`):**
```typescript
// ── POST /emergency-sell ── sell ALL open positions (D-15) ───────────
router.post('/emergency-sell', async (_req: Request, res: Response) => {
    const emergencyLog = log.child({ action: 'emergency-sell' });

    try {
        const trades = getAllPendingTrades.all('pending', 'buy') as PendingTradeRow[];

        if (trades.length === 0) {
            res.json({ ok: true, sold: 0, failed: 0, message: 'No open positions to sell' });
            return;
        }

        emergencyLog.info({ positionCount: trades.length }, 'Emergency sell initiated');
```

**Error-response pattern (`controls.ts:212-218`):**
```typescript
} catch (err) {
    emergencyLog.error({ err }, 'Emergency sell failed');
    res.status(500).json({
        error: 'Emergency sell failed: ' + (err instanceof Error ? err.message : String(err)),
    });
}
```

**What to replicate:** Inside the existing `controlRoutes(contexts)` factory (line 39), add `router.post('/pause', ...)`, `router.post('/resume', ...)`, `router.get('/pause', ...)` alongside existing routes; reuse `log.child({ action: 'pause' })` scoped logger; `try { ... } catch (err) { res.status(500).json({...}) }` shape; auth via the already-applied `authMiddleware` at the router mount level (no per-route guard); call WS `broadcast('pause_state_change', {...})` after successful DB write (existing pattern in `chains.ts:10` import).

**What's different:** The pause/resume endpoints mutate the new `pause_state` table (via the new `setPauseState` / `clearPauseState` prepared statements from `db.ts`), not the existing `trades` table. `req.body.reason` requires bounded sanitization (`sanitizeReason(...)` referenced in `bot.ts:267` per RESEARCH A8; planner verifies export). `GET /pause` is read-only — no `try/catch` needed because `getPauseState.get()` is sync better-sqlite3 (cannot reject).

---

### MODIFY: `src/bot.ts` (preflight call insertion @ line 880)

**Analog:** Self-extension — existing chainId guard at `bot.ts:887-895` (which MOVES into preflight.ts per RESEARCH §7)

**Existing chainId guard pattern (lines 887-895) — to be REMOVED/MOVED:**
```typescript
// 3. Validate chainId (Pitfall 4 from research)
try {
    const network = await ctx.httpProvider.getNetwork();
    if (Number(network.chainId) !== chain.chainId) {
        mainLog.fatal({ chain: chain.name, expected: chain.chainId, got: Number(network.chainId) }, 'Chain ID mismatch -- skipping chain');
        continue;
    }
} catch (err) {
    mainLog.fatal({ chain: chain.name, err }, 'Failed to connect to RPC -- skipping chain');
    continue;
}
```

**Insertion shape** (between line 879 `buildChainRegistry()` and line 882 chain-context loop):
```typescript
// 1. Build chain registry
const registry = buildChainRegistry();

// 1.5 — Phase 20 / OPS-LIVE-01: preflight before any chain context creation.
//       Performs per-chain wallet/RPC/MEV/checker checks + cross-env validation.
//       FATAL non-zero exit if any check fails on any chain (collect-all then exit).
//       Existing chainId / RPC-connect checks at lines 887-895 NOW LIVE in preflight.ts.
await preflight(registry);
// If we reach here, all preflight checks passed for all enabled chains.

// 2. For each enabled chain
const contexts: ChainContext[] = [];
for (const chain of getEnabledChains(registry)) {
    // ... (chainId check removed; it now runs in preflight)
```

**What to replicate:** The `try { ... } continue; }` pattern from the old chainId check informs the FATAL shape inside `checkRpcChainId` in preflight.ts (logger.fatal then process.exit(1)).

**What's different:** Preflight runs ONCE for all chains, exits non-zero if ANY chain fails (D-PREFLIGHT-FLOW collect-all-then-exit), rather than skipping the chain and continuing. Per D-ROLLBACK there is no `SKIP_PREFLIGHT` escape hatch — failure halts the entire boot.

---

### MODIFY: `src/bot.ts` (3 V2 killswitch checkpoints @ ~346, ~363-364, ~378)

**Analog:** Self-extension — `bot.ts:340-396` `handleNewPairForChain` body itself; Phase 19 anti-rug skip-return at line 343 (the existing "Safety checks failed, skipping" early-return)

**Existing skip-return pattern (lines 341-344):**
```typescript
if (isHoneypot || isBlacklisted || !locked || !sufficientLiquidity || !validMetadata || !canSwap || hasTax || hasLimits || mutableResult.isMutable) {
    ctx.log.info({ token: targetToken, checks: { isHoneypot, isBlacklisted, ... } }, 'Safety checks failed, skipping');
    return;
}

ctx.log.info({ token: targetToken, symbol }, 'All safety checks passed, buying');
```

**Existing bundle-build → submit → record-trade flow (lines 346-396):**
```typescript
ctx.log.info({ token: targetToken, symbol }, 'All safety checks passed, buying');           // ← CP1 insert AFTER this line

const path = [ctx.chain.wethAddress, targetToken];
const deadline = Math.floor(Date.now() / 1000) + 60;
const amountIn = ethers.parseEther(ctx.chain.snipeAmount);
// ... minOut calc lines 354-362 ...

try {                                                                                       // ← CP2 insert BEFORE this try
    await sendTxWithRetry(
        () => ctx.wallet.populateTransaction({
            to: dex.routerAddress,
            // ...
        }),
        ctx
    );
                                                                                            // ← CP3 insert AFTER sendTxWithRetry returns
    recordSnipe(ctx.chain.name);

    insertTrade.run({
        token: targetToken.toLowerCase(),
        chain: ctx.chain.name,
        action: 'buy',
        // ...
    });
```

**CP1 insertion pattern (after line 346 "All safety checks passed, buying"):**
```typescript
ctx.log.info({ token: targetToken, symbol }, 'All safety checks passed, buying');

// Phase 20 / OPS-LIVE-08 D-KILLSWITCH-CP1 — post-safety-bank pause check.
// Pause flag set → return BEFORE bundle construction. No expensive RPC/MEV work.
const pauseStateCp1 = getPauseState.get() as { paused: number };
if (pauseStateCp1.paused === 1) {
    ctx.log.info({ op: 'killswitch.cp1', token: targetToken, reason: 'global-pause' }, 'CP1 pause-check: aborting before bundle construction');
    return;
}
```

**CP2 insertion (before line 364 `try { await sendTxWithRetry(...)`):**
```typescript
// Phase 20 / OPS-LIVE-08 D-KILLSWITCH-CP2 — post-bundle-build, pre-submit pause check.
// Pause flag set → discard the built bundle, do NOT submit.
const pauseStateCp2 = getPauseState.get() as { paused: number };
if (pauseStateCp2.paused === 1) {
    ctx.log.info({ op: 'killswitch.cp2', token: targetToken, reason: 'global-pause' }, 'CP2 pause-check: discarding bundle before submit');
    return;
}

try {
    await sendTxWithRetry(...
```

**CP3 insertion (after sendTxWithRetry returns at line 378, BEFORE `recordSnipe(...)` at line 379) — AUDIT-ONLY:**
```typescript
        ctx
    );

    // Phase 20 / OPS-LIVE-08 D-KILLSWITCH-CP3 — post-MEV-submit audit log.
    // Bundle is in flight; pause flipped between submit and record-trade.
    // Trade IS recorded, exit monitor IS started. Pause never panic-sells.
    const pauseStateCp3 = getPauseState.get() as { paused: number };
    if (pauseStateCp3.paused === 1) {
        ctx.log.info({ op: 'killswitch.cp3', token: targetToken, reason: 'global-pause-after-submit' }, 'CP3 pause-check: bundle already submitted, recording trade and arming exit monitor');
        // intentionally fall through — do NOT return
    }

    recordSnipe(ctx.chain.name);
```

**What to replicate:** Existing pino `ctx.log.info({ ... }, 'message')` shape; early `return;` on CP1/CP2; structured `op` field naming convention (consistent with Phase 19's `op: 'antirug.baseline-snapshot-failed'`); use `getPauseState.get()` synchronous better-sqlite3 read (~ns latency, hot-path-safe per RESEARCH §5).

**What's different:** CP3 deliberately does NOT return (audit-only per D-KILLSWITCH-CP3); the existing pattern always returns on a guard miss. CP3 fall-through is the novel pattern.

---

### MODIFY: `src/bot.ts` (3 V3 killswitch checkpoints @ ~600, ~638-639, ~647)

**Analog:** Self-extension — `bot.ts:600-665` `handleNewV3PoolForChain` body (mirror of V2 path with V3 differences)

**Existing V3 buy flow (lines 600-665):**
```typescript
const amountIn = ethers.parseEther(ctx.chain.snipeAmount);

// Calculate minOut via QuoterV2 with slippage (V3-03)
let minOut: bigint = 0n;
try {
    const quoter = new Contract(dex.quoterAddress, V3_QUOTER_V2_ABI, ctx.httpProvider);
    // ... quoteExactInputSingle calc ...
} catch {
    ctx.log.warn({ token: targetToken }, 'Failed to get V3 quote for slippage calc, defaulting minOut to 0');
}

try {                                                                                       // ← CP2 insert BEFORE this try at line 638-639
    // V3-03: Buy via SwapRouter02 exactInputSingle with multicall deadline wrapper
    const v3Router = new Contract(dex.swapRouterAddress, V3_SWAP_ROUTER_ABI, ctx.wallet);
    const deadline = Math.floor(Date.now() / 1000) + 60;
    // ... swap params build ...
    const swapData = v3Router.interface.encodeFunctionData('exactInputSingle', [swapParams]);

    await sendTxWithRetry(                                                                  // ← CP3 insert AFTER this await returns at line 647
        () => ctx.wallet.populateTransaction({...}),
        ctx
    );

    recordSnipe(ctx.chain.name);
```

**What to replicate:** SAME pattern as the V2 checkpoint inserts (CP1 after "All V3 safety checks passed, buying" — search for the V3-equivalent log line near line 600; CP2 before the `try { await sendTxWithRetry(...)` block at lines 638-639; CP3 after `sendTxWithRetry` returns at line 647, before `recordSnipe(ctx.chain.name)` at line 648).

**What's different:** V3 path uses different DEX primitives (`SwapRouter02 exactInputSingle` via `multicall`) but the killswitch shape is identical. Structured log fields should include `feeTier` to disambiguate V3 from V2 in operator log review.

---

### MODIFY: `src/bot.ts` (mid-run wallet balance setInterval after line 926)

**Analog:** Self-extension — `bot.ts:917-926` existing MEV health periodic check (5-min `setInterval`)

**Analog pattern (`bot.ts:917-926`):**
```typescript
// 6. Periodic MEV health check every 5 minutes (per D-07)
setInterval(async () => {
    for (const ctx of contexts) {
        const strategy = createMevStrategy(ctx.chain);
        const healthy = await strategy.healthCheck();
        if (!healthy) {
            ctx.log.warn('MEV service unreachable during periodic check');
            await sendCtxAlert(ctx, 'MEV service unreachable -- snipes will be rejected');
        }
    }
}, 5 * 60 * 1000);
```

**Insertion right after line 926:**
```typescript
// 6.5 — Phase 20 / D-MID-RUN-CHECK — periodic wallet balance re-check.
// Reuses the same 5-min interval pattern as the MEV health check above.
// On undercut: flip global pause flag (paused_by='preflight') + Telegram + pino fatal.
// Exit monitors keep running; operator must refund + resume.
const midRunIntervalMs = Number(process.env.MID_RUN_CHECK_INTERVAL_SEC || '300') * 1000;
setInterval(async () => {
    for (const ctx of contexts) {
        const result = await checkWalletBalance(ctx.chain);
        if (!result.passed) {
            const currentPause = getPauseState.get() as { paused: number };
            if (currentPause.paused !== 1) {
                setPauseState.run(Math.floor(Date.now() / 1000), 'preflight', result.reason ?? 'wallet undercut');
                broadcast('pause_state_change', { paused: true, pausedBy: 'preflight', reason: result.reason });
                ctx.log.fatal({ ...result }, 'Mid-run wallet balance check failed; bot paused');
                await sendCtxAlert(ctx, `*BOT PAUSED* (wallet undercut) — ${result.reason}`);
            }
        }
    }
}, midRunIntervalMs);
```

**What to replicate:** `setInterval(async () => { for (const ctx of contexts) { ... } }, IntervalMs)` outer shape; `await sendCtxAlert(ctx, ...)` for Telegram (carry-forward Phase 18 D-ALERTS); `ctx.log.fatal({...}, 'message')` for structured pino.

**What's different:** Idempotent pause-flip via `if (currentPause.paused !== 1)` check (T-20-04 mitigation — prevents alert-spam if already paused); WS `broadcast('pause_state_change', {...})` call (new event type, follows Phase 19 `cb_tripped` / `chain_status_change` event-type pattern); env-configurable interval via `MID_RUN_CHECK_INTERVAL_SEC` (new optional env, default `300` seconds).

---

### MODIFY: `src/chainRegistry.ts` (`defaultGasBuffer` per-chain field)

**Analog:** Self-extension — `chainRegistry.ts:128-148` per-chain field additions (Phase 18 `defaultHoneypotCheckerAddress`, Phase 19 `defaultAntiRugLpRemovalPct`)

**Phase 18 field-addition pattern (lines 128-148):**
```typescript
// Plan 18-06: per-chain HoneypotChecker defaults. The deployed contract
// address is supplied at runtime via <PREFIX>_HONEYPOT_CHECKER_ADDRESS,
// falling back to the literal `defaultHoneypotCheckerAddress` committed
// here (iter-2 Blocker #3 — canonical source-of-truth lives in the
// source file; env var is an operator OVERRIDE for hot-patching).
// `null` until the chain's contract is deployed (plans 18-07/18-08).
honeypotMethod: 'on-chain-contract' | 'eth_simulateV1';
defaultMaxBuyTaxBps: number;
defaultMaxSellTaxBps: number;
defaultHoneypotCheckerAddress: string | null;
// Plan 19-02: per-chain anti-rug defaults. ETH has a distinct
// backfillCapBlocks default (10, Alchemy free-tier safe per
// 19-RESEARCH.md CRITICAL #1); BSC/BASE/ARB default to 500.
defaultAntiRugLpRemovalPct: number;
defaultAntiRugConfirmBlocks: number;
defaultAntiRugCircuitBreakerTriggers: number;
```

**Env-overlay read pattern in `buildChainRegistry()` (lines 647-649):**
```typescript
const honeypotCheckerAddress = process.env[`${template.envPrefix}_HONEYPOT_CHECKER_ADDRESS`] || template.defaultHoneypotCheckerAddress;
const maxBuyTaxBpsRaw = process.env[`${template.envPrefix}_MAX_BUY_TAX_BPS`] || String(template.defaultMaxBuyTaxBps);
const maxSellTaxBpsRaw = process.env[`${template.envPrefix}_MAX_SELL_TAX_BPS`] || String(template.defaultMaxSellTaxBps);
```

**What to replicate:** Add `defaultGasBuffer: string` (native units) to the `ChainTemplate` interface (after line 148); populate `defaultGasBuffer: '0.005'` for eth, `'0.003'` for bsc, `'0.0005'` for base + arb in each `CHAIN_TEMPLATES` entry (per CONTEXT D-GAS-BUFFER); optionally add `defaultBlockAgeToleranceSec: number` per CONTEXT discretion (planner-suggested defaults: eth 300, bsc 60, base 30, arb 30 per RESEARCH Open Question 4); add `gasBuffer: string` to `ChainConfig` interface (after line 92); read in `buildChainRegistry()` near line 634 via `process.env[\`${template.envPrefix}_GAS_BUFFER\`] || template.defaultGasBuffer`.

**What's different:** None — this is a textbook sibling extension. Verbatim follows the Phase 18 / 19 per-chain-default pattern.

---

### MODIFY: `src/config.ts` `REQUIRED_ENV_VARS` (new env registrations)

**Analog:** Self-extension — `config.ts:13-131` existing `REQUIRED_ENV_VARS` array (Phase 19 anti-rug rows are the most recent additions)

**Existing per-chain MAX_BUY_TAX_BPS-style row pattern (lines 80-92):**
```typescript
// ETH
{ name: 'ETH_ANTIRUG_LIVE_EXECUTE', required: false, description: 'Anti-rug live-execute flag for ETH (default: false → dry-run; flip to true ONLY after 7-day dry-run with 0 confirmed false positives per D-LIVE-GATE)' },
{ name: 'ETH_ANTIRUG_LP_REMOVAL_PCT', required: false, description: 'Anti-rug LP-removal-pct trigger threshold for ETH (default: 50; signal 1 fires when >this pct of LP removed vs baseline)' },
{ name: 'ETH_ANTIRUG_CONFIRM_BLOCKS', required: false, description: 'Anti-rug confirm-after-N-blocks delay before exit fires on ETH (default: 1; higher values for reorg-volatile chains)' },
```

**Existing per-chain RPC URL row pattern (lines 31-38):**
```typescript
// --- Per-Chain RPC URLs ---
{ name: 'ETH_RPC_URL', required: false, description: 'Ethereum HTTP RPC URL (required if eth enabled)' },
{ name: 'ETH_WS_URL', required: false, description: 'Ethereum WebSocket RPC URL' },
{ name: 'BSC_RPC_URL', required: false, description: 'BSC HTTP RPC URL (required if bsc enabled)' },
```

**What to replicate:** Group new envs under a Phase 20 comment header (mirror Phase 19's `// --- Anti-Rug Runtime Monitoring (Phase 19, ...) ---` at lines 67-78); add 4× per-chain `<CHAIN>_GAS_BUFFER` rows (one per ETH/BSC/BASE/ARB); add optional `<CHAIN>_BLOCK_AGE_TOLERANCE_SEC` × 4 rows; add `MID_RUN_CHECK_INTERVAL_SEC`, `STALE_WARN_SEC`, `STALE_ERROR_SEC`, `DASHBOARD_URL` global rows; all `required: false` with documented defaults inline (D-ENV-EXAMPLE binding).

**What's different:** None — extension follows the established per-chain × per-knob shape exactly. The `validateEnvVars()` function at lines 133-144 needs no change because all new vars are `required: false`.

---

### MODIFY: `.github/workflows/test.yml` (CI guard — root-file-reappearance ban)

**Analog:** `.github/workflows/test.yml:20-33` Phase 17 `.todo` ban step

**Phase 17 `.todo` ban pattern (lines 20-33):**
```yaml
      - name: Ban .todo test stubs
        run: |
          # D-09: Strict ban (NOT allowlist-with-reason). Use it.skip('reason: ...') instead.
          # WR-05: Removed `find test/ -name '*.todo*'` — Vitest's .todo test-stub form is
          # invoked via it.todo/test.todo/describe.todo method calls, NOT via filenames.
          # ...
          if grep -rEn 'it\.todo\s*\(|test\.todo\s*\(|describe\.todo\s*\(' test/; then
            echo "ERROR: .todo() test-stub invocation found in test/. Use it.skip('reason: ...') instead."
            exit 1
          fi
```

**Insertion shape (after the `.todo` ban at line 33, before TypeScript checks at line 34):**
```yaml
      - name: Ban root-level operator-facing docs
        run: |
          # Phase 20 D-RUNBOOK-MOVE + D-BRIEFING-DELETE evergreen guard.
          # GOING-LIVE.md was moved to docs/operations/going-live.md in Phase 20.
          # HONEYPOT-SIM-BRIEFING.md was deleted in Phase 20 (Phase 18 disposition).
          if [ -f GOING-LIVE.md ]; then
            echo "ERROR: GOING-LIVE.md reappeared at repo root. Move to docs/operations/going-live.md."
            exit 1
          fi
          if [ -f HONEYPOT-SIM-BRIEFING.md ]; then
            echo "ERROR: HONEYPOT-SIM-BRIEFING.md reappeared at repo root. The Phase 18 honeypot rebuild superseded this briefing; the file is deleted permanently."
            exit 1
          fi
```

**What to replicate:** Step-`name:` + `run: |` block shape; bash `if [ -f FILE ]; then echo ...; exit 1; fi` pattern (mirrors the `grep -rEn ... && exit 1` shape from `.todo` ban); evergreen narrative comments inside the `run:` block referencing the phase / D-* decision; place INSIDE the existing `test` job (NOT a separate job — keeps the guard part of the gate that runs on every PR).

**What's different:** Uses `test -f FILE` exact-path check (NOT `grep` regex over files; NOT `dorny/paths-filter@v3` pattern — per RESEARCH §14 the guard is "files MUST NOT exist", not "files under path X changed"). Two separate `if` blocks (one per file) so the error message identifies which file reappeared (operator-friendly per D-ALERTS verbosity-with-evidence).

---

## Shared Patterns

### Authentication / Authorization
**Source:** `src/api/middleware/auth.ts:101-110` (`authMiddleware`)
**Apply to:** `src/api/routes/controls.ts` new `POST /pause`, `POST /resume`, `GET /pause` endpoints.
**Mechanism:** Already-mounted `apiRouter.use(authMiddleware)` covers all `/controls/*` paths. CLI scripts (`scripts/pause.ts`, `scripts/resume.ts`) must `POST /api/auth/login` first to obtain a session cookie.

```typescript
// src/api/middleware/auth.ts:101-110
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const token = req.cookies?.session as string | undefined;

    if (!token || !validateSession(token)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    next();
}
```

### FATAL Exit Convention
**Source:** `src/anti-rug/allowlist.ts:137-148`, `src/chainRegistry.ts:618-621`, `src/config.ts:140-143`
**Apply to:** Every FATAL path in `src/preflight.ts` + the new schema migration error path in `src/utils/db.ts`.
**Convention:** `logger.fatal({ structuredFields, remediation: 'docs/operations/going-live.md' }, 'message')` followed by `process.exit(1)` on the next line. Always include `chain` field for per-chain failures.

```typescript
// src/anti-rug/allowlist.ts:137-148
log.fatal(
    {
        chain: ctx.chain.name,
        address: entry.address,
        lockerName: entry.lockerName,
        provenance: entry.provenance,
        poolType,
    },
    'Anti-rug allowlist address has no code (EOA?) — refusing to start',
);
process.exit(1);
```

### WS Broadcast Event Emission
**Source:** `src/api/ws/broadcaster.ts:39-50` (`broadcast(type, data)`)
**Apply to:** `src/api/routes/controls.ts` `POST /pause` / `POST /resume` (immediate after `setPauseState.run(...)`); `src/bot.ts` mid-run setInterval (after pause-flip on undercut).
**Pattern:** Fire-and-forget after DB write. New typed event `pause_state_change` follows Phase 19 `cb_tripped` / `chain_status_change` event-type naming convention.

```typescript
// src/api/ws/broadcaster.ts:39-50
export function broadcast(type: string, data: unknown): void {
    if (authenticatedClients.size === 0) return;

    const message = JSON.stringify({ type, data, timestamp: Date.now() });

    for (const client of authenticatedClients) {
        // WebSocket.OPEN = 1
        if (client.readyState === 1) {
            client.send(message);
        }
    }
}
```

### Telegram Alert Wrapper (D-ALERTS)
**Source:** `src/bot.ts:902-903, 922-923` (`sendCtxAlert(ctx, message)`)
**Apply to:** `src/preflight.ts` FATAL failures (one alert per failed check, Telegram + pino fatal); `src/bot.ts` mid-run wallet undercut.
**Pattern:** Terse 1-line Markdown-friendly message starting with `*BOLD CATEGORY*`. Full structured evidence lives in the pino log line (same event), per Phase 18 D-ALERTS.

```typescript
// src/bot.ts:922-923
ctx.log.warn('MEV service unreachable during periodic check');
await sendCtxAlert(ctx, 'MEV service unreachable -- snipes will be rejected');
```

### Module-Scoped Pino Logger
**Source:** Every module uses `const log = logger.child({ module: '<name>' })` at file top.
**Apply to:** `src/preflight.ts` → `logger.child({ module: 'preflight' })`; `scripts/preflight.ts` → `logger.child({ module: 'preflight-cli' })`; `scripts/pause.ts` → `logger.child({ module: 'pause-cli' })`; `scripts/resume.ts` → `logger.child({ module: 'resume-cli' })`.

```typescript
// src/api/routes/controls.ts:13
const log = logger.child({ module: 'api:controls' });

// src/api/routes/chains.ts:13
const log = logger.child({ module: 'api:chains' });

// src/anti-rug/allowlist.ts:47
const log = logger.child({ module: 'antiRug:allowlist' });
```

### Schema Migration Block
**Source:** `src/utils/db.ts:122-154` (v4→v5 `CREATE TABLE IF NOT EXISTS` + indexes + `logger.info`)
**Apply to:** `src/utils/db.ts` v5→v6 block (new pause_state table + chain_state ALTER COLUMN with belt-and-suspenders column-existence guard).
**Pattern:** `if (version < N) { db.exec(\`...\`); logger.info('Created ... (schema version N)'); }` placed BEFORE `db.pragma(\`user_version = ${CURRENT_SCHEMA_VERSION}\`)` at line 156. ALTER must be guarded by `PRAGMA table_info(...).some(c => c.name === '<col>')` check (lines 112-119).

### Per-Chain Env Overlay
**Source:** `src/chainRegistry.ts:647-649` (`process.env[\`${template.envPrefix}_HONEYPOT_CHECKER_ADDRESS\`] || template.defaultHoneypotCheckerAddress`)
**Apply to:** `src/chainRegistry.ts` reading `<CHAIN>_GAS_BUFFER` (with `template.defaultGasBuffer` fallback) and `<CHAIN>_BLOCK_AGE_TOLERANCE_SEC` (with `template.defaultBlockAgeToleranceSec` fallback).

---

## No Analog Found

All 14 files have clear analogs in the codebase. Phase 20 is intentionally low-novelty per RESEARCH §"Don't Hand-Roll" — almost every primitive already exists; the phase's value is in COMPOSITION.

| File | Status |
|------|--------|
| (none) | All files have analogs |

---

## Notes for Planner

1. **OPS-LIVE-13 single-line execution:** `git rm HONEYPOT-SIM-BRIEFING.md` is a 1-line action; no analog needed beyond standard git delete. Same commit as `git mv GOING-LIVE.md docs/operations/going-live.md` per D-RUNBOOK-MOVE atomic-commit requirement.

2. **`docs/operations/going-live.md` content updates:** No code analog. Authoring pattern reference: `.planning/phases/19-anti-rug-runtime-monitoring/19-08-PLAN.md` documents the `anti-rug-rollout.md` + `anti-rug-tuning.md` authoring shape Phase 20 should mirror (5 sections per D-OPERATOR-HANDOFF: preflight failure modes + remediation, pause/resume CLI usage, mid-run undercut recovery, anti-rug live-gate flip cross-link, validation troubleshooting).

3. **`README.md` link update:** Mechanical find-and-replace from `./GOING-LIVE.md` to `./docs/operations/going-live.md`. Trivial; no analog needed.

4. **`.env.example` updates per D-ENV-EXAMPLE:** Mirror `src/config.ts` `REQUIRED_ENV_VARS` additions verbatim with inline-comment descriptions. Reference: existing `.env.example` rows that match Phase 19 anti-rug envs at lines 67-131 of `src/config.ts`.

5. **`package.json` scripts addition:** Plain JSON addition — `"preflight": "ts-node scripts/preflight.ts"`, `"pause": "ts-node scripts/pause.ts"`, `"resume": "ts-node scripts/resume.ts"`. No analog needed; same pattern as existing `scripts.build` / `scripts.test:unit` entries.

6. **`dashboard/src/hooks/useWebSocket.ts` extension:** Add `pause_state_change` event handler. Analog: existing `cb_tripped` / `chain_ws_health_change` / `antirug_event` handlers in the same file (planner reads at plan-phase).

7. **`src/anti-rug/detector.ts` timestamp record (D-ANTIRUG-LIVE-GATE-CODE):** One-line insertion `setAntirugDryRunStarted.run(chain.name, Math.floor(Date.now()/1000), Math.floor(Date.now()/1000))` inside `startChainAntiRugListener` first-time-start path. Idempotent via `COALESCE` in the prepared statement. Planner reads `detector.ts` at plan-phase to identify the exact insertion line.

---

## Metadata

**Analog search scope:**
- `src/anti-rug/`, `src/api/routes/`, `src/api/middleware/`, `src/api/ws/`
- `src/utils/db.ts` (self-extension for schema)
- `src/chainRegistry.ts`, `src/config.ts`, `src/bot.ts` (self-extension for wiring)
- `scripts/`, `dashboard/src/components/`, `dashboard/src/components/anti-rug/`
- `.github/workflows/test.yml`

**Files scanned:** 16 source files read with line-anchored excerpts; ~3,800 LOC of analog context surveyed.

**Pattern extraction date:** 2026-05-24

**Match-quality summary:**
- Exact matches (same role + same data flow): 11
- Sibling-pattern matches (same role family): 3
- No analog: 0

**Confidence:** HIGH — every analog is in the same repository, every line range was directly read, every NEW file has a sibling pattern from Phase 17/18/19.
