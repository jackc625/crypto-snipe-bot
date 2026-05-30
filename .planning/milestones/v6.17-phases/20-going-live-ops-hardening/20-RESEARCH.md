# Phase 20: Going-Live Ops Hardening - Research

**Researched:** 2026-05-24
**Domain:** Defensive startup hardening, persistent operator kill-switch, runbook formalization, mid-run wallet undercut detection — real-capital mainnet bot (~0.0124 ETH funded).
**Confidence:** HIGH (every architectural decision is locked by CONTEXT.md; every insertion point verified by reading the source file at the exact line range; existing patterns from Phases 3/14/18/19 carry forward unchanged).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Pause-state model (OPS-LIVE-08, 09, 11)**

- **D-PAUSE-SHAPE:** Global pause (single SQLite-persisted flag) blocks ALL new buys across all chains. Per-chain `/chains/:name/{start,stop}` (in-memory `stoppedChains` Set in `src/api/routes/chains.ts`) stays unchanged for chain-listener control. Two orthogonal controls. **Exit monitors run under both** — pause never panic-sells.
- **D-PAUSE-STORAGE:** New `pause_state` table with audit columns: `paused BOOLEAN NOT NULL DEFAULT 0`, `paused_at TIMESTAMP`, `paused_by TEXT` (`'dashboard' | 'cli' | 'preflight' | 'manual'`), `reason TEXT`. Single-row pattern (`id INTEGER PRIMARY KEY CHECK(id=1)`). Schema migration v5→v6; additive only.
- **D-PAUSE-UI:** Dashboard surfaces global pause as a **prominent red banner** in the dashboard header: `BOT PAUSED — since {paused_at} by {paused_by}. {reason}` with Resume button. Both dashboard and CLI toggle pause/resume.
- **D-PAUSED-RESTART:** When bot restarts with `pause_state.paused=true`, bot starts everything (preflight → chain listeners → exit monitors → dashboard). Pause is honored at the `handleNewPairForChain` first checkpoint — chain listeners fire events but no buys happen.

**Preflight pipeline & wallet balance (OPS-LIVE-01..05, 10)**

- **D-BALANCE-FLOOR:** Per-chain wallet floor = `snipeAmount × maxOpenPositions + <CHAIN>_GAS_BUFFER`. Examples: ETH `0.003 × 1 + 0.005 = 0.008 ETH`; BSC `0.05 × 1 + 0.003 = 0.053 BNB`; Base `0.005 × 1 + 0.0005 = 0.0055 ETH`; Arb `0.005 × 1 + 0.0005 = 0.0055 ETH`. **Refines REQUIREMENTS.md OPS-LIVE-02 wording.**
- **D-GAS-BUFFER:** Per-chain defaults in `CHAIN_TEMPLATES` (`defaultGasBuffer`): ETH 0.005, BSC 0.003, Base 0.0005, Arb 0.0005 (native units). Operator override via env: `<CHAIN>_GAS_BUFFER`.
- **D-PREFLIGHT-FLOW:** Run all checks (wallet/RPC/MEV/checker `getCode`) for every chain; **collect all failures across all chains, then exit non-zero if any chain failed**. Per-chain pass/fail summary printed at end.
- **D-MID-RUN-CHECK:** Periodic re-check at default 5-minute interval. **Action on undercut:** flip the global pause flag with `paused_by='preflight'` + `reason='wallet balance below floor: {chain} {balance} < {floor}'`; Telegram alert; pino fatal log. Exit monitors keep running.
- **Block-age tolerance (planner discretion):** suggest defaults ~5× block-time per chain (ETH ~60s, BSC ~15s, Base ~10s, Arb ~2s). Tunable via env per chain.

**Kill-switch at 3 checkpoints (OPS-LIVE-08)**

- **D-KILLSWITCH-CP1 (post-safety-bank):** Pause flag set → return from `handleNewPairForChain` BEFORE bundle construction. Structured pino log `{ op: 'killswitch.cp1', token, reason: 'global-pause' }`.
- **D-KILLSWITCH-CP2 (post-bundle-build, pre-submit):** Pause flag set → discard the built bundle, do NOT submit. Structured pino log `{ op: 'killswitch.cp2', token, reason: 'global-pause' }`.
- **D-KILLSWITCH-CP3 (post-MEV-submit):** Audit log only — bundle is in flight; the buy may have landed. **CP3 is an audit log, NOT an abort.** Still record the trade, still start the exit monitor. Structured pino log `{ op: 'killswitch.cp3', token, tradeId, reason: 'global-pause-after-submit' }` when pause flipped between submit and record-trade.
- Existing dashboard `POST /emergency-sell` remains the operator action for "sell everything now". Pause + emergency-sell are distinct.

**Cross-variable env validation (OPS-LIVE-07)**

- **D-VALIDATION-HOME:** `preflight.ts` owns cross-variable rules. Per-variable validation continues to live in `src/config.ts` `REQUIRED_ENV_VARS`. Chain-specific shapes continue to live in `src/chainRegistry.ts`.
- **Cross-rules to enforce (initial set):**
  - `MEV_STRATEGY=flashbots` ⇔ `FLASHBOTS_AUTH_KEY` set + non-empty
  - `ENABLED_CHAINS` includes `bsc` ⇔ `BLOXROUTE_AUTH_HEADER` set
  - `TELEGRAM_API_ID` set ⇔ full 5-tuple (`TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) all set
  - `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` ⇔ 7-day dry-run floor passed per D-ANTIRUG-LIVE-GATE-CODE
  - Per-chain `<CHAIN>_RPC_URL` set if chain in `ENABLED_CHAINS`
  - Per-chain `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` set OR `defaultHoneypotCheckerAddress` literal present in `CHAIN_TEMPLATES`
  - Planner free to add discovered rules during plan-phase.
- **D-ANTIRUG-LIVE-GATE-CODE:** Code-enforced 7-day floor only; FP review stays operator-discipline. Implementation: new column `antirug_dry_run_started TIMESTAMP` in existing `chain_state` table (schema migration v5→v6 atomic with `pause_state` add). The anti-rug detector records this timestamp on first-time start per chain. Preflight enforces: `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` requires `(now - chain_state.antirug_dry_run_started) >= 7 days` for that chain. FATAL non-zero exit if floor not met.

**Stale-data warnings (OPS-LIVE-06)**

- **D-STALE-THRESHOLDS:** Relax REQUIREMENTS.md OPS-LIVE-06 from "2×/4× poll interval" (10s/20s) to **2 min warn / 10 min error**. Optional env override (`STALE_WARN_SEC` / `STALE_ERROR_SEC`).

**Briefing / runbook disposition (OPS-LIVE-12, 13)**

- **D-BRIEFING-DELETE:** `HONEYPOT-SIM-BRIEFING.md` at repo root is **DELETED**.
- **D-RUNBOOK-MOVE:** `GOING-LIVE.md` (repo root, 251 lines) moved to `docs/operations/going-live.md` **atomically in a single commit** with root-file delete. README.md updated to link the new path. CI guard added.

**Carried-forward conventions (Phase 17/18/19)**

- **D-ENV-EXAMPLE [USER-BINDING]:** every new env var in `.env.example` with default + 1-line description.
- **D-OPERATOR-HANDOFF [USER-BINDING]:** `docs/operations/going-live.md` IS the operator handoff doc.
- **D-STOP-THE-LINE:** any preflight discovery revealing a production bug BLOCKS Phase 20 close.
- **D-ROLLBACK:** no legacy fallback flags. Preflight is always-on; no `SKIP_PREFLIGHT=true` escape hatch.
- **D-ALERTS:** structured pino + Telegram alerts for every FATAL preflight failure with: chain name, failed check, specific reason, remediation pointer to `docs/operations/going-live.md`.
- **D-04 observable-effect rigor:** every new preflight check test asserts a concrete observable effect (process.exit code, pino log line, SQLite row written, Telegram alert sent) — no `expect(true).toBe(true)` hollow fills.

### Claude's Discretion

- Exact `pause_state` schema column types + index choice — within "single-row pattern, audit columns required"
- Specific mid-run re-check interval default within "every 5 minutes per REQUIREMENTS-as-written"
- Specific block-age tolerance per chain — within "scale to chain block-time, ~5× as starting point"
- `npm run preflight` JSON-vs-human output format — human-readable preferred for operator UX, machine-readable optional via `--json` flag
- `npm run pause` / `npm run resume` CLI argument shape (optional `--reason` flag etc.) — within "wraps dashboard endpoint, uses `DASHBOARD_API_KEY` from .env"
- `preflight.ts` module split (single file vs `preflight/{checks,validation,runner}.ts`) — within "all cross-var rules under one module"
- CI guard mechanism for OPS-LIVE-12 (workflow rule vs `dorny/paths-filter@v3` rule vs custom script) — same toolchain as Phase 18's contracts-path-filter pattern preferred
- Whether stale-data warning + Telegram alert is a one-shot at startup or also a periodic check during operation
- Schema migration v5→v6 split into one transaction (pause_state + antirug_dry_run_started column) vs two migrations — within "additive only, existing tables unchanged"
- Exact pause-state JSON shape exposed by GET /api/pause

### Deferred Ideas (OUT OF SCOPE)

- Operator-acknowledged-zero-FPs file as belt-and-suspenders for `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` — rejected; trust the operator + 7-day timer.
- `SKIP_PREFLIGHT=true` emergency-override env — rejected per D-ROLLBACK.
- Two-threshold mid-run wallet check (soft warn + hard FATAL) — rejected; single-threshold pause-flip is cleaner.
- Force-cancel-all-in-flight as an emergency mode — rejected; existing emergency-sell + pause-at-CP1/CP2 are complete.
- Block-age-tolerance scaling by chain block-time formula — rejected for Arb (0.25s × 5 = 1.25s too tight); per-chain default + env override.
- Periodic stale-data warning during operation (vs startup-only) — planner discretion; may emerge as quality upgrade.
- Synthetic canary-trade monitor (OPS-V2-01) — deferred to v6.18+.
- Dashboard banner during graceful shutdown (OPS-V2-02) — v6.18+ UX polish.
- Pre-flight `--quiet` mode for CI usage — planner discretion or defer.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-LIVE-01 | New `src/preflight.ts` module called from `startMultiChainBot` BEFORE chain context creation | §Implementation Approach §Preflight Module — file shape + insertion point at `bot.ts:879` |
| OPS-LIVE-02 | Wallet balance preflight + periodic re-check; FATAL on undercut | §Implementation Approach §Wallet Balance Floor — formula refined to `snipeAmount × maxOpenPositions + gas_buffer` per D-BALANCE-FLOOR (refines REQ wording) |
| OPS-LIVE-03 | RPC health: chainId match (FATAL), block-age tolerance, WS reachability | §Existing Code Insights — `bot.ts:887-895` chainId check moves into preflight; block-age tolerance new |
| OPS-LIVE-04 | MEV connectivity: Flashbots HEAD on ETH, bloXroute HEAD on BSC, passthrough chains skipped | §Existing Code Insights — `createMevStrategy(chain).healthCheck()` reused (already used in `bot.ts:900`) |
| OPS-LIVE-05 | HoneypotChecker `getCode` against `chainRegistry[chain].honeypotChecker.deployedAddress` per enabled chain | §Existing Code Insights — Phase 19 `verifyAllowlistAtStartup` `getCode` pattern reused |
| OPS-LIVE-06 | Stale-data warnings at 2 min warn / 10 min error per D-STALE-THRESHOLDS (refines REQ wording) | §Implementation Approach §Stale-Data Warnings — query `trades.timestamp` for pending positions |
| OPS-LIVE-07 | Cross-variable env validation in `preflight.ts` | §Implementation Approach §Cross-Variable Env Validation — 6 cross-rule set (planner may extend) |
| OPS-LIVE-08 | Multi-stage kill-switch at 3 checkpoints in `handleNewPairForChain` | §Implementation Approach §Kill-Switch Checkpoints — exact line numbers per CP1/CP2/CP3 |
| OPS-LIVE-09 | SQLite-persisted pause survives restart | §Implementation Approach §Pause-State Table — schema v5→v6 |
| OPS-LIVE-10 | `npm run preflight` script — exits non-zero on any fail; does NOT start the bot | §Implementation Approach §Operator CLI Scripts |
| OPS-LIVE-11 | `npm run pause` / `npm run resume` wrap dashboard endpoints with `DASHBOARD_API_KEY` | §Implementation Approach §Operator CLI Scripts |
| OPS-LIVE-12 | `GOING-LIVE.md` moved to `docs/operations/going-live.md` atomic with delete; CI guard | §Implementation Approach §CI Guard |
| OPS-LIVE-13 | `HONEYPOT-SIM-BRIEFING.md` deleted (Phase 18 D-BRIEFING-DISPOSITION executes) | §Implementation Approach §Runbook Move + Delete |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

No project-level `CLAUDE.md` exists at the repo root. Global user constraints from `~/.claude/CLAUDE.md` apply (RTK tooling — irrelevant here per user memory `feedback_no_rtk.md`; user instruction: do not prefix commands with `rtk`).

**Project-level constraints from user memory + STATE.md (binding on Phase 20):**

- **Capital safety > throughput > LOC > clean-code** — owner non-negotiable carried forward from Phase 18/19. Every architectural choice is graded against capital safety first.
- **`npx ts-node src/bot.ts`** is the bot start command (user memory `project_start_command`).
- **No `rtk` prefix** in commands (user memory `feedback_no_rtk`).
- **High-stakes blockchain ops** must include testnet rehearsal step + step-by-step verification (user memory `feedback_high_stakes_ops`). Preflight failure-mode tests fall under this — every observable-effect assertion is a real verification, not a smoke test.
- **Don't dismiss anomalies** — any NOTOK / error / weird output during preflight verification must be diagnosed, never "non-blocking" (user memory `feedback_dont_dismiss_anomalies`).
- **Merge commit safety** — audit before/after on every merge involving Phase 20 plans (user memory `feedback_merge_safety`).

---

## Executive Summary

Phase 20 makes the bot refuse to start in any internally-inconsistent or unsafe state and adds a persistent operator kill-switch. It introduces a new top-level `src/preflight.ts` module that runs BEFORE chain context creation, performs per-chain wallet / RPC / MEV / HoneypotChecker checks (collect-all-then-exit on FATAL), enforces cross-variable env rules (MEV ⇔ auth, Telegram 5-tuple, anti-rug 7-day floor), and FATAL-exits non-zero with structured pino + Telegram alerts pointing to `docs/operations/going-live.md`. A new `pause_state` table (schema migration v5→v6, additive only, single-row pattern with audit columns `paused/paused_at/paused_by/reason`) backs a multi-stage kill-switch with re-checks at three points inside `handleNewPairForChain` — post-safety-bank (abort before bundle), post-bundle-build (discard before submit), and post-MEV-submit (audit-log only since bundle is in flight). A 5-min mid-run wallet re-check flips the same global pause flag on undercut (`paused_by='preflight'`); exit monitors run under pause; emergency-sell is the orthogonal control. Operator CLI scripts `npm run preflight/pause/resume` wrap the new dashboard endpoints. `GOING-LIVE.md` (251 lines) is moved to `docs/operations/going-live.md` atomically with the root-file delete; `HONEYPOT-SIM-BRIEFING.md` is deleted per Phase 18's already-closed disposition; a CI guard (same `dorny/paths-filter@v3` family as Phase 18) fails the build if either root file reappears. The phase respects the binding owner constraint: capital safety > throughput > LOC > clean-code.

**Primary recommendation:** Execute the 6 work-streams in this dependency order — (1) schema v5→v6 migration + prepared statements; (2) `src/preflight.ts` module with check functions; (3) bot.ts wiring (preflight call + 3 killswitch checkpoints + mid-run interval + antirug timestamp record); (4) dashboard endpoints + CLI scripts + dashboard banner; (5) runbook move + briefing delete + CI guard; (6) REQUIREMENTS.md row rewording for OPS-LIVE-02 + OPS-LIVE-06 + `docs/operations/going-live.md` authoring. Streams 1, 2, 5 can ship in parallel waves. Stream 3 blocks on 1 + 2.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cross-variable env validation | Backend / startup module (`src/preflight.ts`) | — | Per D-VALIDATION-HOME. Per-variable validation stays in `src/config.ts` `REQUIRED_ENV_VARS`. |
| Pause-state persistence | Database / SQLite (`src/utils/db.ts`) | Backend / dashboard endpoint | Single source of truth in SQLite; dashboard reads via API. |
| Pause-state read for killswitch | Backend / `bot.ts` `handleNewPairForChain` | — | Hot-path read at 3 checkpoints; better-sqlite3 sync read (~ns latency, no I/O contention). |
| Pause-state mutation | Backend / `src/api/routes/controls.ts` | — | Single endpoint owner for `POST /api/pause` + `POST /api/resume`; auth via `DASHBOARD_API_KEY` middleware (existing pattern). |
| Pause-state UI surface | Frontend (`dashboard/src/components/Layout.tsx` or new `PauseBanner.tsx`) | Backend WS broadcast (`src/api/ws/broadcaster.ts`) | Banner is a layout-level concern visible on every dashboard page; WS-driven live update follows Phase 19 `cb_tripped` / `chain_ws_health_change` pattern. |
| Wallet balance preflight | Backend / startup module | — | Pure per-chain check; reads `httpProvider.getBalance(wallet.address)`. |
| RPC health preflight (chainId / block-age) | Backend / startup module | — | Existing chainId check at `bot.ts:886-895` moves IN to preflight; block-age tolerance is new. |
| MEV connectivity preflight | Backend / startup module | — | Reuses existing `createMevStrategy(chain).healthCheck()` already used at `bot.ts:900`. |
| HoneypotChecker code-at-address preflight | Backend / startup module | — | Reuses Phase 19 `verifyAllowlistAtStartup` `getCode()` pattern (D-LIST-VERIFY); applies to `chainRegistry[chain].honeypotChecker.deployedAddress`. |
| Mid-run wallet re-check | Backend / `bot.ts` periodic interval | Pause-state mutation (writes through `setPauseState`) | Reuses the same `setInterval` pattern as the existing MEV health re-check at `bot.ts:917-926`. |
| Operator CLI scripts | Backend / `scripts/*.ts` standalone Node.js | Dashboard HTTP API | `scripts/pause.ts` + `scripts/resume.ts` POST to dashboard; `scripts/preflight.ts` directly imports `preflight()` (does NOT start bot). |
| Runbook documentation | Filesystem (`docs/operations/going-live.md`) | — | Versioned in git; CI guard prevents re-introduction at repo root. |
| Stale-data warnings | Backend / startup module + (optional) periodic interval | — | Query `trades.timestamp` for `status='pending'` rows; planner-discretion whether also periodic. |

## Standard Stack

### Core (Already-Installed Production Dependencies — REUSED, NOT NEW)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | `^12.8.0` | SQLite singleton + WAL mode + schema migrations + prepared statements | Already wired in `src/utils/db.ts`. v5→v6 migration follows the additive-only pattern from migrations 1→5. [VERIFIED: package.json] |
| `ethers` | `6.16.0` | `Wallet.getBalance()`, `httpProvider.getCode()`, `httpProvider.getBlockNumber()`, `httpProvider.getBlock()` | Already used throughout for chain interaction. Phase 19 used `getCode()` for D-LIST-VERIFY allowlist startup check — exact same primitive for OPS-LIVE-05. [VERIFIED: package.json] |
| `pino` | `^10.3.1` | Structured logging with FATAL level + child loggers | Already wired via `src/utils/logger.ts`. `logger.fatal(...)` + `process.exit(1)` is the established FATAL pattern (used in `chainRegistry.ts:163-165`, `config.ts:141-143`). [VERIFIED: package.json] |
| `axios` | `1.10.0` | HTTP client for MEV HEAD checks + CLI scripts POSTing to dashboard | Already used (declared as dep, used in MEV strategy + `notifier.ts` for Telegram). [VERIFIED: package.json] |
| `dotenv` | `17.2.0` | `.env` loading in CLI scripts | Used in `scripts/deploy-honeypot-checker.ts:38` (`dotenv.config()`). [VERIFIED: package.json] |
| `express` | `^5.2.1` | New `POST /api/pause` / `POST /api/resume` routes | Already wired through `src/api/routes/controls.ts`. New routes are alongside-extensions. [VERIFIED: package.json] |
| `ws` | `^8.20.0` | WS broadcast of pause_state_change to dashboard | Already wired through `src/api/ws/broadcaster.ts`; new `pause_state_change` event follows the existing typed-event pattern. [VERIFIED: package.json] |
| `ts-node` | `10.9.2` | Runs `scripts/preflight.ts` / `scripts/pause.ts` / `scripts/resume.ts` from npm scripts | Already used (`scripts: { ... }` pattern; `"build": "tsc"` exists). [VERIFIED: package.json] |
| `vitest` | `^4.1.1` | Unit + integration test runner with `name: 'unit' | 'integration' | 'fork'` projects | Phase 20 tests file into existing `unit` and `integration` projects; no new project needed. [VERIFIED: vitest.config.ts] |

### Supporting (already wired — no new install needed)

| Library | Purpose | When to Use |
|---------|---------|-------------|
| `src/utils/logger.ts` `logger.child({ module: 'preflight' })` | Module-scoped pino logger | Every preflight check emits structured log lines with `module: 'preflight'` + `chain: <name>` + `check: <name>`. |
| `src/utils/notifier.ts` `sendCtxAlert(ctx, message)` | Telegram alert via existing notifier path | D-ALERTS preflight FATALs emit a 1-line Telegram alert with chain + reason + remediation pointer. |
| `src/chainRegistry.ts` `getEnabledChains(registry)` | Iterate enabled chains | Preflight loop iterates `getEnabledChains(registry)`; same as `bot.ts:883`. |
| `src/api/middleware/auth.ts` `authMiddleware` | Session cookie auth | New `/api/pause` + `/api/resume` routes mount under existing `apiRouter` with same middleware. CLI scripts pre-login via `POST /api/auth/login` with `DASHBOARD_API_KEY`. |
| `src/api/ws/broadcaster.ts` `broadcast(type, data)` | WS event broadcast to authenticated dashboard clients | New event types `pause_state_change` follow existing `chain_status_change` + `antirug_event` + `cb_tripped` typed-event pattern. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single `src/preflight.ts` file | Split into `src/preflight/{wallet,rpc,mev,checker,env,runner}.ts` | CONTEXT.md leaves this to planner discretion. Single-file preferred until file exceeds ~600 LOC. Phase 19's `src/anti-rug/` directory split happened only when the module grew past ~1000 LOC across detector + evaluator + lifecycle. |
| `npm run pause` calling dashboard endpoint | Direct DB write from CLI | Dashboard endpoint preferred per CONTEXT.md "wraps dashboard endpoint". Direct DB write would bypass WS broadcast for live dashboard update + duplicate the auth surface. |
| `dorny/paths-filter@v3` CI guard | Custom shell `test -e GOING-LIVE.md` step | CONTEXT.md leaves to planner. `dorny/paths-filter@v3` is already in use in `.github/workflows/test.yml:63` for `contracts/**`. Reusing the same action is consistent. Shell `test -e` is also acceptable and more explicit. **Recommendation: shell `test -e` step** — the guard is checking 2 specific filenames at the repo root, not a path-pattern; `dorny/paths-filter` is designed for "if any file under X changes, do Y" which isn't this case. |
| `setInterval` mid-run wallet check | Use existing chain restart callback hook | `setInterval` reuses the established Phase 4 `bot.ts:917-926` MEV health pattern. The restart callback fires only on operator-triggered chain restart, not periodic. |
| Pause-state Express endpoint reads from `pause_state` table | Cache in process memory + write-through | Hot-path read is per-pair-event (~1/second peak), not per-block. SQLite synchronous read is ~ns. Cache adds invalidation complexity for zero meaningful perf win. |

**Installation:** No new npm install required. Phase 20 is pure code/config additions using already-installed dependencies.

**Version verification:** All packages above verified via `cat package.json` (read 2026-05-24). Node v22.16.0 confirmed via `node --version`.

## Package Legitimacy Audit

> **Not applicable for Phase 20.**

Phase 20 installs **zero new npm packages**. All dependencies are already in `package.json` (verified above) and were vetted during earlier phases:

- `better-sqlite3`, `ethers`, `axios`, `pino`, `express`, `dotenv`, `ts-node`, `vitest`, `ws` — all production-mainline, used since v6.16 phases 1-16.
- No new transitive dependencies — Phase 20 is module additions to existing infrastructure.

Disposition table:

| Package | Registry | Status |
|---------|----------|--------|
| (none — no new installs) | — | — |

## Implementation Approach

### 1. Schema Migration v5→v6 (`src/utils/db.ts`)

**File:** `src/utils/db.ts`
**Insertion:** Bump `CURRENT_SCHEMA_VERSION` from `5` to `6` at **line 27**. Add a new `if (version < 6) { ... }` block immediately after the existing `if (version < 5)` block ending at **line 154**, and BEFORE `db.pragma(\`user_version = ${CURRENT_SCHEMA_VERSION}\`)` at **line 156**.
**Pattern reference:** Mirrors the existing v4→v5 block at lines 122-154 verbatim (`db.exec(\`CREATE TABLE IF NOT EXISTS ... \`)` with named columns + indexes, then `logger.info('Created ... (schema version N)')`).

**Schema additions (additive only; no ALTER on existing tables except 1 column add):**

```sql
-- 1. New pause_state table (single-row pattern per D-PAUSE-STORAGE).
--    CHECK(id=1) enforces single-row at the storage layer; INSERT OR IGNORE
--    pattern from setPauseState ensures idempotent boot-time seed.
CREATE TABLE IF NOT EXISTS pause_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    paused INTEGER NOT NULL DEFAULT 0,
    paused_at INTEGER,
    paused_by TEXT,
    reason TEXT
);

-- Seed row (idempotent — INSERT OR IGNORE so a re-run after an operator
-- pauses+restarts does not reset the audit columns).
INSERT OR IGNORE INTO pause_state (id, paused, paused_at, paused_by, reason)
VALUES (1, 0, NULL, NULL, NULL);

-- 2. Add antirug_dry_run_started column to existing chain_state table.
--    Additive ALTER (no destructive recreate needed — SQLite allows
--    ALTER TABLE ... ADD COLUMN). Idempotent via existence check pattern
--    from v3→v4 migration at lines 113-119.
ALTER TABLE chain_state ADD COLUMN antirug_dry_run_started INTEGER;
```

**Single transaction:** Wrap the whole `if (version < 6)` block in `db.transaction(() => { ... })()` for atomicity — both objects must materialize together or roll back together. Phase 19 v4→v5 did NOT use an explicit transaction because all statements were `CREATE TABLE` and SQLite executes each `db.exec()` call in its own implicit transaction; however, since Phase 20 mixes CREATE + INSERT + ALTER, an explicit transaction is the safest pattern. **[ASSUMED]** — verify during plan-phase that better-sqlite3 v12.8 transaction semantics permit DDL inside a `.transaction()` block; if not, fall back to sequential `db.exec()` calls and accept partial-failure risk on the small ALTER (which is the realistic failure-free case).

**Column-existence guard for the ALTER:** Belt-and-suspenders like v3→v4 (line 113-119):

```typescript
const columns = db.prepare("PRAGMA table_info('chain_state')").all() as Array<{ name: string }>;
const hasColumn = columns.some(c => c.name === 'antirug_dry_run_started');
if (!hasColumn) {
    db.exec(`ALTER TABLE chain_state ADD COLUMN antirug_dry_run_started INTEGER`);
}
```

**New prepared statements (alongside existing exports at lines 504-522):**

```typescript
// Pause-state
const getPauseState = db.prepare(`SELECT paused, paused_at, paused_by, reason FROM pause_state WHERE id = 1`);
const setPauseState = db.prepare(`UPDATE pause_state SET paused = 1, paused_at = ?, paused_by = ?, reason = ? WHERE id = 1`);
const clearPauseState = db.prepare(`UPDATE pause_state SET paused = 0, paused_at = NULL, paused_by = NULL, reason = NULL WHERE id = 1`);

// Anti-rug dry-run floor (D-ANTIRUG-LIVE-GATE-CODE)
const setAntirugDryRunStarted = db.prepare(`
    INSERT INTO chain_state (chain, last_seen_block, last_updated_ts, antirug_dry_run_started)
    VALUES (?, 0, ?, ?)
    ON CONFLICT(chain) DO UPDATE SET
        antirug_dry_run_started = COALESCE(chain_state.antirug_dry_run_started, excluded.antirug_dry_run_started)
`);
const getAntirugDryRunStarted = db.prepare(`SELECT antirug_dry_run_started FROM chain_state WHERE chain = ?`);
```

`setAntirugDryRunStarted` uses `COALESCE` so the timestamp is idempotent — only the first call per chain records a value; subsequent calls are no-ops. This satisfies "anti-rug detector startup records `chain_state.antirug_dry_run_started` if NULL" per CONTEXT.md.

### 2. Preflight Module (`src/preflight.ts`)

**File:** `src/preflight.ts` (NEW).
**Public API:**

```typescript
export interface PreflightResult {
    chain: string;
    check: 'wallet-balance' | 'rpc-chainid' | 'rpc-block-age' | 'mev-health' | 'honeypot-checker-code' | 'cross-env-rule';
    passed: boolean;
    reason?: string;
    details?: Record<string, unknown>;
}

export async function preflight(registry: ChainRegistry): Promise<void>;
// On any FATAL: logs structured pino + sends Telegram alerts for each failure,
// prints per-chain pass/fail summary, calls process.exit(1).
// On all-pass: returns void.

export async function preflightDryRun(registry: ChainRegistry): Promise<PreflightResult[]>;
// Same checks but returns the result array WITHOUT process.exit.
// Used by scripts/preflight.ts so the standalone CLI can format
// output (human or --json) and decide its own exit code.
```

**Check execution order (per D-PREFLIGHT-FLOW "collect all then exit"):**

```typescript
export async function preflight(registry: ChainRegistry): Promise<void> {
    const log = logger.child({ module: 'preflight' });
    const results: PreflightResult[] = [];

    // Phase 1: cross-variable env rules (chain-agnostic, fail-loud earliest).
    results.push(...validateCrossEnvRules());

    // Phase 2: per-chain checks (run in parallel per chain; collect all results).
    for (const chain of getEnabledChains(registry)) {
        const chainResults = await Promise.all([
            checkRpcChainId(chain),
            checkRpcBlockAge(chain),
            checkWalletBalance(chain),
            checkMevHealth(chain),
            checkHoneypotCheckerCode(chain),
            checkAntiRugLiveGate(chain), // D-ANTIRUG-LIVE-GATE-CODE
        ]);
        results.push(...chainResults);
    }

    // Phase 3: emit summary + alerts + exit if any FATAL.
    const failed = results.filter(r => !r.passed);
    printPreflightSummary(results, log);

    if (failed.length > 0) {
        for (const r of failed) {
            log.fatal({ ...r, remediation: 'docs/operations/going-live.md' }, `Preflight failed: ${r.check}`);
            await sendPreflightAlert(r);
        }
        process.exit(1);
    }

    log.info({ chainCount: getEnabledChains(registry).length }, 'Preflight passed');
}
```

**Check implementations (concrete contracts):**

| Check | Reads | Returns FAIL when |
|-------|-------|-------------------|
| `checkRpcChainId(chain)` | `httpProvider.getNetwork()` | `Number(network.chainId) !== chain.chainId` |
| `checkRpcBlockAge(chain)` | `httpProvider.getBlock('latest')` | `(now_unix - block.timestamp) > chain.blockAgeToleranceSec` |
| `checkWalletBalance(chain)` | `httpProvider.getBalance(wallet.address)` | `balance < parseEther(chain.snipeAmount) * BigInt(MAX_OPEN_POSITIONS) + parseEther(chain.gasBuffer)` |
| `checkMevHealth(chain)` | `createMevStrategy(chain).healthCheck()` | returns false |
| `checkHoneypotCheckerCode(chain)` | `httpProvider.getCode(chain.honeypotChecker.deployedAddress)` | result is `'0x'` (EOA / no code) |
| `checkAntiRugLiveGate(chain)` | env `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` AND `getAntirugDryRunStarted(chain.name)` | env is `true` AND (NULL timestamp OR `now - timestamp < 7 days`) |
| `validateCrossEnvRules()` | `process.env.MEV_STRATEGY`, `FLASHBOTS_AUTH_KEY`, `ENABLED_CHAINS`, `BLOXROUTE_AUTH_HEADER`, Telegram 5-tuple | any rule violation per cross-rule list |

**Module size estimate:** ~250-350 LOC total. Single-file recommended per Claude-discretion (vs split into `preflight/{checks,validation,runner}.ts`). Split is unnecessary at this size and adds import noise.

### 3. Wallet Balance Floor (refines OPS-LIVE-02 per D-BALANCE-FLOOR)

**Formula:** `floor = snipeAmount × maxOpenPositions + <CHAIN>_GAS_BUFFER` (all in native chain units).

**`maxOpenPositions` source:** `process.env.MAX_OPEN_POSITIONS` (already declared in `REQUIRED_ENV_VARS` at `config.ts:55`, default `'10'`). Read as `Number(process.env.MAX_OPEN_POSITIONS) || 10`.

**`<CHAIN>_GAS_BUFFER` source:** Per-chain env override with template default. New field `defaultGasBuffer` added to `CHAIN_TEMPLATES`:

```typescript
// In ChainTemplate interface (src/chainRegistry.ts line ~110):
defaultGasBuffer: string; // native units, e.g. '0.005' for ETH

// In each CHAIN_TEMPLATES entry:
eth:  { ..., defaultGasBuffer: '0.005' },
bsc:  { ..., defaultGasBuffer: '0.003' },
base: { ..., defaultGasBuffer: '0.0005' },
arb:  { ..., defaultGasBuffer: '0.0005' },
```

**ChainConfig extension:** Add `gasBuffer: string` field to `ChainConfig` (line ~92) after `snipeAmount`. Read in `buildChainRegistry()` near the existing `maxCapital` read at line 634:

```typescript
const gasBuffer = process.env[`${template.envPrefix}_GAS_BUFFER`] || template.defaultGasBuffer;
```

**Check implementation:**

```typescript
async function checkWalletBalance(chain: ChainConfig): Promise<PreflightResult> {
    const balance = await chain.httpProvider.getBalance(chain.wallet.address);
    const maxOpen = Number(process.env.MAX_OPEN_POSITIONS) || 10;
    const floor = ethers.parseEther(chain.snipeAmount) * BigInt(maxOpen) + ethers.parseEther(chain.gasBuffer);
    const passed = balance >= floor;
    return {
        chain: chain.name,
        check: 'wallet-balance',
        passed,
        reason: passed ? undefined : `wallet balance below floor: ${ethers.formatEther(balance)} < ${ethers.formatEther(floor)} ${chain.nativeCurrency}`,
        details: {
            balance: ethers.formatEther(balance),
            floor: ethers.formatEther(floor),
            snipeAmount: chain.snipeAmount,
            maxOpenPositions: maxOpen,
            gasBuffer: chain.gasBuffer,
            chainNativeCurrency: chain.nativeCurrency,
        },
    };
}
```

**Concrete floor values at current config (verifies the bot stays operational at 0.0124 ETH funded):**
- ETH: `0.003 × 1 + 0.005 = 0.008 ETH` < 0.0124 ETH → **PASS** ✓ (per CONTEXT.md `MAX_OPEN_POSITIONS=1` for the conservative first-live-test setup; or 0.038 ETH at MAX=10 default which would FAIL — verify `.env` `MAX_OPEN_POSITIONS=1` is set per HONEYPOT-SIM-BRIEFING.md line 5).

### 4. Cross-Variable Env Validation (OPS-LIVE-07)

**Implementation file:** `src/preflight.ts` `validateCrossEnvRules(): PreflightResult[]`.

**Rules to enforce (locked set from CONTEXT.md + planner-expansion-discretion):**

| Rule | Predicate | FAIL reason |
|------|-----------|-------------|
| MEV ⇔ auth | `MEV_STRATEGY=flashbots` requires `FLASHBOTS_AUTH_KEY` non-empty | `'MEV_STRATEGY=flashbots requires FLASHBOTS_AUTH_KEY to be set'` |
| BSC ⇔ bloXroute | `ENABLED_CHAINS` includes `bsc` requires `BLOXROUTE_AUTH_HEADER` non-empty | `'ENABLED_CHAINS includes bsc but BLOXROUTE_AUTH_HEADER is not set'` |
| Telegram 5-tuple | If `TELEGRAM_API_ID` is set, all of `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` must be set | `'TELEGRAM_API_ID is set but the 5-tuple is incomplete: <list>'` |
| Per-chain RPC | Each chain in `ENABLED_CHAINS` requires `<CHAIN>_RPC_URL` set | `'<CHAIN> enabled but <CHAIN>_RPC_URL not set'` |
| Per-chain Honeypot checker | Each chain in `ENABLED_CHAINS` requires `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` set OR `defaultHoneypotCheckerAddress` non-null in `CHAIN_TEMPLATES` | `'<CHAIN> has no HoneypotChecker address (env or template default)'` |
| Anti-rug live gate | Per-chain rule: see `checkAntiRugLiveGate` above | `'<CHAIN>_ANTIRUG_LIVE_EXECUTE=true but 7-day dry-run floor not met (X days remaining)'` |

**Note:** The existing per-variable validation in `config.ts` `REQUIRED_ENV_VARS` STAYS. Cross-rules are ADDED in preflight. No duplication: per-variable validates "exists/required"; cross-rules validate "if X then Y".

**Cross-rule check ordering: chain-agnostic rules first, then per-chain rules.** A missing `FLASHBOTS_AUTH_KEY` blocks even before any chain RPC connects — earliest fail-loud surface.

### 5. Kill-Switch Checkpoints (OPS-LIVE-08)

**File:** `src/bot.ts`.
**Insertion points (verified line-by-line by reading the file):**

| Checkpoint | Where in `handleNewPairForChain` | Action | Line range |
|------------|----------------------------------|--------|------------|
| **CP1 (post-safety-bank)** | AFTER the parallel `Promise.all` at lines 290-299, AFTER the safety-checks-failed early return at line 341-344, BEFORE `path/deadline/amountIn` at line 348 | Read `getPauseState()`; if `paused === 1`: structured log + `return;` | **Insert at line 346** (right after `ctx.log.info({ token: targetToken, symbol }, 'All safety checks passed, buying');` line 346). |
| **CP2 (post-bundle-build, pre-submit)** | AFTER `minOut` calc at lines 354-362, BEFORE `sendTxWithRetry(...)` call at line 365 | Read `getPauseState()`; if `paused === 1`: structured log + `return;` (discards built bundle, never submits) | **Insert at line 363-364** (right before the `try { await sendTxWithRetry(...)` block at line 364). |
| **CP3 (post-MEV-submit, audit-only)** | AFTER `sendTxWithRetry(...)` returns at line 377, BEFORE `recordSnipe` + `insertTrade.run` at lines 379-396 | Read `getPauseState()`; if `paused === 1`: structured `op='killswitch.cp3'` log ONLY — do NOT skip the `recordSnipe` / `insertTrade` / `startExitMonitor` calls. Bundle is in flight; trade must be recorded for the exit engine to manage it. | **Insert at line 378** (right after the `sendTxWithRetry` await returns, before line 379 `recordSnipe(ctx.chain.name);`). |

**V3 path (`handleNewV3PoolForChain`) — identical 3 checkpoints needed:**

| Checkpoint | V3 line range |
|------------|---------------|
| CP1 (post-safety-bank) | **Insert at line 600** (right after `ctx.log.info({ token: targetToken, symbol, feeTier }, 'All V3 safety checks passed, buying');`) |
| CP2 (post-bundle-build, pre-submit) | **Insert at line 638-639** (right before the `try { await sendTxWithRetry(...)` block at line 639) |
| CP3 (post-MEV-submit, audit-only) | **Insert at line 647** (right after the `sendTxWithRetry` await returns, before line 648 `recordSnipe`) |

**Pause-flag read pattern (hot-path-safe):**

```typescript
// At top of bot.ts imports:
import { getPauseState } from './utils/db';

// Inline checkpoint helper (private to bot.ts; not exported):
function isPaused(): { paused: boolean; pausedAt?: number; pausedBy?: string; reason?: string } {
    const row = getPauseState.get() as { paused: number; paused_at: number | null; paused_by: string | null; reason: string | null };
    return {
        paused: row.paused === 1,
        pausedAt: row.paused_at ?? undefined,
        pausedBy: row.paused_by ?? undefined,
        reason: row.reason ?? undefined,
    };
}
```

**better-sqlite3 sync read:** ~ns latency. Per pair-event read frequency is low (~1/sec peak under high token-detection load) — synchronous read is the right call here, not a cache.

### 6. Mid-Run Wallet Re-check (D-MID-RUN-CHECK)

**File:** `src/bot.ts`.
**Pattern reuse:** Mirror the existing MEV health periodic check at **lines 916-926**:

```typescript
// Phase 20 / D-MID-RUN-CHECK — periodic wallet balance re-check.
// Reuses the same 5-min interval pattern as the MEV health check above.
// On undercut: flip global pause flag (paused_by='preflight') + Telegram + pino fatal.
// Exit monitors keep running; operator must refund + resume.
const midRunIntervalMs = Number(process.env.MID_RUN_CHECK_INTERVAL_SEC || '300') * 1000;
setInterval(async () => {
    for (const ctx of contexts) {
        const result = await checkWalletBalance(ctx.chain);
        if (!result.passed) {
            // Pause is idempotent — won't double-flip if already paused.
            const currentPause = getPauseState.get() as { paused: number };
            if (currentPause.paused !== 1) {
                setPauseState.run(Math.floor(Date.now() / 1000), 'preflight', result.reason);
                broadcast('pause_state_change', { paused: true, pausedBy: 'preflight', reason: result.reason });
            }
            ctx.log.fatal({ ...result }, 'Mid-run wallet balance check failed; bot paused');
            await sendCtxAlert(ctx, `*BOT PAUSED* (wallet undercut) — ${result.reason}`);
        }
    }
}, midRunIntervalMs);
```

**Insertion point:** Right after the existing MEV health interval (line 926) in `startMultiChainBot`.

**Env var (new):** `MID_RUN_CHECK_INTERVAL_SEC` — optional, default `300` (5 min). Lands in `.env.example` + `REQUIRED_ENV_VARS` per D-ENV-EXAMPLE.

### 7. Preflight Call in `startMultiChainBot`

**File:** `src/bot.ts`.
**Insertion:** BEFORE the chain-context creation loop. The existing `buildChainRegistry()` call lives at **line 879**; the per-chain loop starts at **line 882**.

```typescript
// In startMultiChainBot at line 880 (between line 879 buildChainRegistry and line 882 loop start):
await preflight(registry);
// Note: preflight() calls process.exit(1) on any FATAL.
// If we reach here, all preflight checks passed for all enabled chains.
```

**Behavioral change:** Existing chainId validation at **bot.ts lines 887-895** REMOVED (now lives inside `checkRpcChainId` in preflight.ts).

### 8. Pause/Resume Endpoints

**File:** `src/api/routes/controls.ts`.
**Insertion:** Add two new routes inside `controlRoutes(contexts)` at line 39, alongside existing `force-sell` / `emergency-sell`:

```typescript
// ── POST /pause ─ flip global pause flag, broadcast WS event ──────────
router.post('/pause', async (req: Request, res: Response) => {
    const reason = String((req.body as { reason?: string })?.reason || 'manual operator pause');
    const pausedBy = String((req.body as { pausedBy?: string })?.pausedBy || 'dashboard');
    setPauseState.run(Math.floor(Date.now() / 1000), pausedBy, reason);
    broadcast('pause_state_change', { paused: true, pausedBy, reason });
    log.info({ pausedBy, reason }, 'Bot paused via API');
    res.json({ ok: true, paused: true, pausedBy, reason });
});

// ── POST /resume ─ clear pause flag, broadcast WS event ───────────────
router.post('/resume', async (_req: Request, res: Response) => {
    clearPauseState.run();
    broadcast('pause_state_change', { paused: false });
    log.info('Bot resumed via API');
    res.json({ ok: true, paused: false });
});

// ── GET /pause ─ dashboard banner read path ───────────────────────────
router.get('/pause', (_req: Request, res: Response) => {
    const row = getPauseState.get() as { paused: number; paused_at: number | null; paused_by: string | null; reason: string | null };
    res.json({
        paused: row.paused === 1,
        pausedAt: row.paused_at,
        pausedBy: row.paused_by,
        reason: row.reason,
    });
});
```

The `GET /pause` route is added to `controls.ts` (alongside the mutation endpoints) rather than `health.ts` because dashboard banner state is a control surface, not a health surface. Single-router responsibility.

**Auth:** Already wired — `apiRouter.use(authMiddleware)` applies to `/controls/*` paths. CLI scripts must `POST /api/auth/login` first to obtain a session cookie.

### 9. Operator CLI Scripts (`scripts/`)

**File:** `scripts/preflight.ts` (NEW). ~80 LOC. Imports `preflightDryRun()` from `src/preflight.ts`:

```typescript
import * as dotenv from 'dotenv';
import { buildChainRegistry } from '../src/chainRegistry';
import { preflightDryRun } from '../src/preflight';
import { logger } from '../src/utils/logger';

dotenv.config();
const log = logger.child({ module: 'preflight-cli' });

async function main() {
    const useJson = process.argv.includes('--json');
    const registry = buildChainRegistry();
    const results = await preflightDryRun(registry);
    const failed = results.filter(r => !r.passed);
    if (useJson) {
        console.log(JSON.stringify({ results, failed: failed.length }, null, 2));
    } else {
        // human-readable per-check ✓/✗ output, grouped by chain
        printPreflightSummaryToStdout(results);
    }
    process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => { log.fatal({ err }, 'Preflight CLI crashed'); process.exit(2); });
```

**File:** `scripts/pause.ts` (NEW). ~50 LOC. Pattern from `scripts/deploy-honeypot-checker.ts`:

```typescript
import * as dotenv from 'dotenv';
import axios from 'axios';
import { logger } from '../src/utils/logger';

dotenv.config();
const log = logger.child({ module: 'pause-cli' });

async function main() {
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
    if (pauseRes.status !== 200) {
        log.fatal({ status: pauseRes.status, body: pauseRes.data }, 'Pause failed');
        process.exit(1);
    }
    log.info({ reason }, 'Bot paused via CLI');
    process.exit(0);
}

main().catch(err => { log.fatal({ err }, 'CLI crashed'); process.exit(2); });
```

**File:** `scripts/resume.ts` (NEW). ~40 LOC. Identical to `pause.ts` but POSTs `/api/controls/resume` with no body.

**File:** `package.json`. Add at top of `scripts`:

```json
"preflight": "ts-node scripts/preflight.ts",
"pause": "ts-node scripts/pause.ts",
"resume": "ts-node scripts/resume.ts",
```

**New env var:** `DASHBOARD_URL` (optional, default `http://localhost:3000`). Added to `.env.example` per D-ENV-EXAMPLE.

### 10. Dashboard Pause Banner

**File:** `dashboard/src/components/PauseBanner.tsx` (NEW). Pattern reuse: clone the structure of `dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx` (lines 1-65) — full-bleed red banner at the top of the layout.

**Banner copy:** `BOT PAUSED — since {paused_at_formatted} by {pausedBy}. {reason}` with a "Resume" button that POSTs `/api/controls/resume`.

**WS event integration:** Extend `dashboard/src/hooks/useWebSocket.ts` to handle `pause_state_change` event (alongside existing `cb_tripped` / `chain_status_change` / `antirug_event`). Add `pauseState: { paused: boolean; pausedBy?: string; pausedAt?: number; reason?: string } | null` to the `WebSocketContextValue` interface in `WebSocketContext.tsx` (line 13-23).

**Initial state hydration:** New `useApi<PauseState>('/api/controls/pause')` hook call in `Layout.tsx` to load the initial state on dashboard mount; the WS event keeps it live afterwards.

**Mount point:** `dashboard/src/components/Layout.tsx` lines 30-42. The banner mounts ABOVE the existing `<main>` element so it appears on every page (Overview, ChainControls, RiskExposure, TradeHistory). This is the same mount-pattern as the existing sidebar (line 32-37).

### 11. Anti-Rug Dry-Run Timestamp Record (D-ANTIRUG-LIVE-GATE-CODE)

**File:** `src/anti-rug/detector.ts`.
**Insertion:** Inside `startChainAntiRugListener(chain, ...)` (the function that already exists per Plan 19-04a), at the first-time-start path. Call `setAntirugDryRunStarted.run(chain.name, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))` — the prepared statement uses `COALESCE` so it's idempotent (only first call per chain records a timestamp).

Planner identifies exact line during plan-phase by reading `src/anti-rug/detector.ts` at the `startChainAntiRugListener` definition; CONTEXT.md says "first-time start per chain" so the insertion is at the function entry, after the chain-name validation.

### 12. Stale-Data Warnings (OPS-LIVE-06, D-STALE-THRESHOLDS)

**Implementation file:** `src/preflight.ts` (one-shot at startup) + (optional, planner discretion) periodic re-check in `bot.ts`.

**Query:** `SELECT id, token, chain, timestamp FROM trades WHERE status = 'pending' AND action = 'buy' AND timestamp < ?` where the `?` is computed as `Math.floor(Date.now()/1000) - STALE_WARN_SEC`. Two-tier: rows with `(now - timestamp) > STALE_ERROR_SEC` log error; rows between `STALE_WARN_SEC` and `STALE_ERROR_SEC` log warn.

**Default thresholds (per D-STALE-THRESHOLDS):**

```typescript
const STALE_WARN_SEC = Number(process.env.STALE_WARN_SEC) || 120;  // 2 min
const STALE_ERROR_SEC = Number(process.env.STALE_ERROR_SEC) || 600; // 10 min
```

**Caveat about `last_update_ts` column:** The `trades` table has a `timestamp` column (line 41 of `db.ts`) but no separate `last_update_ts` column. CONTEXT.md uses `last_update_ts` semantically but the actual column to query is `trades.timestamp`. **[CLARIFICATION FOR PLANNER]** — verify with the user: does OPS-LIVE-06 mean "buy timestamp" (column `trades.timestamp`) OR "most recent action on this trade" (would require joining with sells and partial_sells via `MAX(timestamp) GROUP BY token, chain`)? The latter is more semantically correct but requires more SQL. Recommendation: ship with `trades.timestamp` (buy time) for v1; add max-update-ts join in a follow-up if operator finds it noisy.

### 13. Runbook Move + Briefing Delete (OPS-LIVE-12 + 13)

**Move:** `GOING-LIVE.md` (251 lines) → `docs/operations/going-live.md`. Atomic single commit per D-RUNBOOK-MOVE:

```bash
git mv GOING-LIVE.md docs/operations/going-live.md
```

**Delete:** `HONEYPOT-SIM-BRIEFING.md` (139 lines) — `git rm HONEYPOT-SIM-BRIEFING.md`. Same commit as the move per D-AUDIT-TRAIL.

**README.md update:** Find any references to `./GOING-LIVE.md` and update to `./docs/operations/going-live.md`. Per Phase 19 Plan 19-08, README already has a Key Features section pointing into `docs/operations/anti-rug-rollout.md`; the new entry follows the same pattern.

**Content updates inside `docs/operations/going-live.md` per D-OPERATOR-HANDOFF:**

1. Move-first-then-update per D-AUDIT-TRAIL — preserve the git-history record of "this is the old content moved verbatim" THEN a separate commit "this is the Phase 20 updates".
2. New sections to add:
   - **Preflight failure modes + remediation** (one section per check: wallet-balance, rpc-chainid, rpc-block-age, mev-health, honeypot-checker-code, cross-env-rule)
   - **Pause/resume CLI usage** (`npm run pause -- --reason "manual stop"`, `npm run resume`, dashboard banner walkthrough)
   - **Mid-run wallet undercut behavior + recovery** (operator must refund AND call resume)
   - **Anti-rug live-gate flip procedure** (cross-link to `anti-rug-rollout.md` and `anti-rug-tuning.md` from Phase 19)
   - **RPC/MEV/checker validation troubleshooting**

### 14. CI Guard (OPS-LIVE-12 part 2)

**File:** `.github/workflows/test.yml`.
**Insertion:** Add a new step inside the existing `test` job (after the `.todo` ban step at lines 20-33), BEFORE the TypeScript check steps at lines 34-39:

```yaml
- name: Ban root-level operator-facing docs
  run: |
    # Phase 20 D-RUNBOOK-MOVE + D-BRIEFING-DELETE evergreen guard.
    # GOING-LIVE.md was moved to docs/operations/going-live.md in Phase 20.
    # HONEYPOT-SIM-BRIEFING.md was deleted in Phase 20 (Phase 18 disposition).
    # Re-introduction at the repo root would break the docs/operations/
    # canonical location and bypass operator handoff discoverability.
    if [ -f GOING-LIVE.md ]; then
      echo "ERROR: GOING-LIVE.md reappeared at repo root. Move to docs/operations/going-live.md."
      exit 1
    fi
    if [ -f HONEYPOT-SIM-BRIEFING.md ]; then
      echo "ERROR: HONEYPOT-SIM-BRIEFING.md reappeared at repo root. The Phase 18 honeypot rebuild superseded this briefing; the file is deleted permanently."
      exit 1
    fi
```

**Why `test -f` exact-filename match (not `dorny/paths-filter` pattern):** The guard is checking 2 specific filenames at the repo root. `dorny/paths-filter` is designed for "if any file under X path-glob changes, trigger Y job" — Phase 18's `contracts/**` pattern is the perfect use case. Phase 20's guard is a different semantic: "files MUST NOT exist". `test -f` + early exit is the precise primitive. Same family as the `.todo` ban at lines 21-33 (precise pattern-match + early exit).

**False-positive risk:** What if a contributor legitimately needs to add a different `GOING-LIVE-*.md` doc? The guard matches **exact filenames** (`test -f GOING-LIVE.md`, not `test -f GOING-LIVE*.md`) so `GOING-LIVE-V2.md` would not trigger. **VERIFIED** by reading the `test` flag behavior — `-f` checks file existence at exact path.

### 15. REQUIREMENTS.md Refinement Targets

See dedicated §"REQUIREMENTS.md Refinement Targets" section below for exact line numbers.

## Validation Architecture

> Required because `workflow.nyquist_validation: true` in `.planning/config.json` (verified by reading the file).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest `^4.1.1` |
| Config file | `vitest.config.ts` (projects: `unit`, `integration`, `fork`) |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm run test:unit && npm run test:integration && npm run test:fork` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPS-LIVE-01 | `preflight()` called before chain-context loop in `startMultiChainBot`; FATAL fires non-zero exit | integration | `npx vitest run test/integration/preflightInvocation.test.ts` | ❌ Wave 0 |
| OPS-LIVE-02 | Wallet balance below floor → FATAL exit; balance above floor → PASS; mid-run undercut flips pause flag | unit + integration | `npx vitest run test/unit/preflight/walletBalance.test.ts test/integration/midRunWalletCheck.test.ts` | ❌ Wave 0 |
| OPS-LIVE-03 | chainId mismatch → FATAL; stale block (>tolerance) → FATAL; WS unreachable → FATAL | unit | `npx vitest run test/unit/preflight/rpcHealth.test.ts` | ❌ Wave 0 |
| OPS-LIVE-04 | Flashbots HEAD fail → FATAL on ETH; bloXroute HEAD fail → FATAL on BSC; non-MEV chain skipped | unit | `npx vitest run test/unit/preflight/mevHealth.test.ts` | ❌ Wave 0 |
| OPS-LIVE-05 | `getCode(deployedAddress) === '0x'` → FATAL; non-empty code → PASS | unit | `npx vitest run test/unit/preflight/honeypotCheckerCode.test.ts` | ❌ Wave 0 |
| OPS-LIVE-06 | Stale position > 2 min logs warn; > 10 min logs error; fresh position no log | unit | `npx vitest run test/unit/preflight/staleData.test.ts` | ❌ Wave 0 |
| OPS-LIVE-07 | Each cross-rule violation produces a `PreflightResult` with `passed: false`; FATAL exit on any violation | unit | `npx vitest run test/unit/preflight/crossEnvRules.test.ts` | ❌ Wave 0 |
| OPS-LIVE-08 | CP1 pause → early return; CP2 pause → bundle built, NOT submitted; CP3 pause → trade recorded + audit log fires | integration | `npx vitest run test/integration/killswitchCheckpoints.test.ts` | ❌ Wave 0 |
| OPS-LIVE-09 | Pause flag written → bot restart → flag survives + read at boot | integration | `npx vitest run test/integration/pauseFlow.test.ts` | ❌ Wave 0 |
| OPS-LIVE-10 | `npm run preflight` exits 0 on all-pass; exits 1 on any FATAL; does NOT start bot processes | integration | `npx vitest run test/integration/preflightCli.test.ts` | ❌ Wave 0 |
| OPS-LIVE-11 | `npm run pause` flips `pause_state.paused=1`; `npm run resume` flips to 0; both broadcast WS event | integration | `npx vitest run test/integration/pauseCli.test.ts` | ❌ Wave 0 |
| OPS-LIVE-12 | Repo has no `GOING-LIVE.md` at root; CI guard fails when reintroduced | integration (CI check) | `bash -c 'test -f GOING-LIVE.md && exit 1 || exit 0'` (smoke) + manual CI dry-run | partial (CI yml change verified by reading workflow) |
| OPS-LIVE-13 | Repo has no `HONEYPOT-SIM-BRIEFING.md` at root | integration (CI check) | `bash -c 'test -f HONEYPOT-SIM-BRIEFING.md && exit 1 || exit 0'` | partial |

### Observable Effects per Requirement (D-04 rigor)

| Req ID | Observable Effect (concrete) |
|--------|------------------------------|
| OPS-LIVE-01 | `process.exit(1)` called; spy on `process.exit` records single call with `1`; mock for `preflight()` was invoked exactly once between `buildChainRegistry()` and the chain-context loop |
| OPS-LIVE-02 (startup) | Spy captures pino fatal log containing `{ check: 'wallet-balance', passed: false, reason: 'wallet balance below floor: ...' }`; `process.exit(1)` called |
| OPS-LIVE-02 (mid-run) | SQLite row `SELECT paused, paused_by, reason FROM pause_state WHERE id=1` returns `(1, 'preflight', 'wallet balance below floor: eth 0.001 < 0.008 ETH')`; `broadcast` mock called with `('pause_state_change', { paused: true, pausedBy: 'preflight', reason: ... })`; pino fatal log emitted; `sendCtxAlert` mock called with message containing `BOT PAUSED` |
| OPS-LIVE-03 (chainId) | pino fatal log with `{ check: 'rpc-chainid', expected: 1, got: 11155111 }`; `process.exit(1)` |
| OPS-LIVE-03 (block-age) | pino fatal log with `{ check: 'rpc-block-age', blockAgeSec: 750, toleranceSec: 300 }` (assumed ETH 5×60=300s); `process.exit(1)` |
| OPS-LIVE-04 | pino fatal log with `{ check: 'mev-health', strategy: 'flashbots', endpoint: 'relay.flashbots.net' }`; `process.exit(1)` |
| OPS-LIVE-05 | pino fatal log with `{ check: 'honeypot-checker-code', address: '0x...', code: '0x' }`; `process.exit(1)` |
| OPS-LIVE-06 | pino warn or error log with `{ op: 'stale-position', tradeId, ageSec }` per stale row found; no `process.exit` |
| OPS-LIVE-07 | pino fatal log with `{ check: 'cross-env-rule', rule: 'mev-flashbots-auth-key', reason: '...' }`; `process.exit(1)` |
| OPS-LIVE-08 (CP1) | pino info log with `{ op: 'killswitch.cp1', token, reason: 'global-pause' }`; subsequent `sendTxWithRetry` call NEVER invoked (spy assertion); `insertTrade.run` NEVER called |
| OPS-LIVE-08 (CP2) | pino info log with `{ op: 'killswitch.cp2', token, reason: 'global-pause' }`; `sendTxWithRetry` mock NOT called; bundle-build path was reached (verified by `getAmountsOut` spy call) — proves the flag was checked AFTER bundle construction |
| OPS-LIVE-08 (CP3) | pino info log with `{ op: 'killswitch.cp3', token, tradeId, reason: 'global-pause-after-submit' }`; `insertTrade.run` STILL CALLED (the trade IS recorded); `startExitMonitor` STILL CALLED |
| OPS-LIVE-09 | After `setPauseState.run(ts, 'manual', 'test')`, restart simulated by re-opening DB; `getPauseState.get()` returns the same row |
| OPS-LIVE-10 | CLI subprocess `npm run preflight` exit code === 1 when undercut wallet fixture; subprocess does NOT spawn a `bot.ts` process (no `startMultiChainBot` invocation captured) |
| OPS-LIVE-11 | After `npm run pause`, `SELECT paused FROM pause_state` returns `1`; after `npm run resume`, returns `0` |
| OPS-LIVE-12 | `fs.existsSync('GOING-LIVE.md')` returns `false`; `fs.existsSync('docs/operations/going-live.md')` returns `true` |
| OPS-LIVE-13 | `fs.existsSync('HONEYPOT-SIM-BRIEFING.md')` returns `false` |

### Mocking Strategy

| Test | SQLite | Network (RPC/MEV) | Wallet | Telegram |
|------|--------|-------------------|--------|----------|
| `walletBalance.test.ts` | real in-memory DB | mocked `httpProvider.getBalance` | mock wallet address | spy `sendCtxAlert` |
| `rpcHealth.test.ts` | n/a | mocked `httpProvider.getNetwork` + `.getBlock` | n/a | spy `sendCtxAlert` |
| `mevHealth.test.ts` | n/a | spy + mock on `createMevStrategy(chain).healthCheck` | n/a | spy |
| `honeypotCheckerCode.test.ts` | n/a | mocked `httpProvider.getCode` | n/a | spy |
| `crossEnvRules.test.ts` | n/a | n/a | n/a | n/a (mutate `process.env` per test) |
| `pauseFlow.test.ts` | real on-disk temp DB | n/a | n/a | n/a |
| `killswitchCheckpoints.test.ts` | real in-memory DB seeded with pause row | mocked `sendTxWithRetry` | mock wallet | spy |
| `pauseCli.test.ts` | real on-disk temp DB | nock or msw axios mocks (or test against running supertest express instance) | n/a | n/a |
| `preflightCli.test.ts` | real on-disk temp DB | mocked all checks | n/a | n/a |
| `midRunWalletCheck.test.ts` | real in-memory DB | mocked `httpProvider.getBalance` | mock wallet | spy `sendCtxAlert` + spy `broadcast` |

### Sampling Rate

- **Per task commit:** `npm run test:unit` (~30s for 354 existing + ~40 new)
- **Per wave merge:** `npm run test:unit && npm run test:integration` (~5min)
- **Phase gate:** Full suite green + `tsc --noEmit ×3` clean + CI guard step verified

### Wave 0 Gaps

Test files to create in Wave 0 (before any implementation lands):

- [ ] `test/unit/preflight/walletBalance.test.ts` — covers OPS-LIVE-02 startup path
- [ ] `test/unit/preflight/rpcHealth.test.ts` — covers OPS-LIVE-03
- [ ] `test/unit/preflight/mevHealth.test.ts` — covers OPS-LIVE-04
- [ ] `test/unit/preflight/honeypotCheckerCode.test.ts` — covers OPS-LIVE-05
- [ ] `test/unit/preflight/staleData.test.ts` — covers OPS-LIVE-06
- [ ] `test/unit/preflight/crossEnvRules.test.ts` — covers OPS-LIVE-07
- [ ] `test/unit/db/pauseStateMigration.test.ts` — covers schema migration v5→v6 idempotence
- [ ] `test/integration/preflightInvocation.test.ts` — covers OPS-LIVE-01 wiring point
- [ ] `test/integration/killswitchCheckpoints.test.ts` — covers OPS-LIVE-08 (CP1/CP2/CP3)
- [ ] `test/integration/pauseFlow.test.ts` — covers OPS-LIVE-09 restart-survival
- [ ] `test/integration/preflightCli.test.ts` — covers OPS-LIVE-10
- [ ] `test/integration/pauseCli.test.ts` — covers OPS-LIVE-11
- [ ] `test/integration/midRunWalletCheck.test.ts` — covers OPS-LIVE-02 mid-run path

Framework already installed (vitest); no install step needed. The `unit` + `integration` projects already exist (`vitest.config.ts`).

## Security Domain

> Required because `security_enforcement` is treated as enabled (no explicit `false` in `.planning/config.json`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Threat model: pause-state mutation is privileged; preflight FATAL prevents inconsistent boot |
| V2 Authentication | yes | Existing `DASHBOARD_API_KEY` + `timingSafeEqual` flow (verified at `src/api/middleware/auth.ts:42-58`); new `/api/pause` + `/api/resume` reuse `authMiddleware` |
| V3 Session Management | yes | Existing UUID session cookie with 24h TTL (`SESSION_TTL_MS`); periodic cleanup interval (line 22-30) |
| V4 Access Control | yes | All new endpoints under `apiRouter` use `authMiddleware`; CLI pre-logs-in via DASHBOARD_API_KEY |
| V5 Input Validation | yes | `req.body.reason` for pause is bounded — sanitize as defense-in-depth (max 200 chars + strip control chars per `sanitizeReason` from Phase 18) before writing to DB |
| V6 Cryptography | no | No new cryptographic primitives; private-key handling unchanged |
| V7 Errors / Logging | yes | Pino structured logging; FATAL logs go to log + Telegram via `D-ALERTS` pattern from Phase 18 |
| V8 Data Protection | yes | `pause_state.reason` may contain operator-supplied free text — sanitize on write |
| V14 Configuration | yes | No `SKIP_PREFLIGHT=true` env per D-ROLLBACK; preflight is always-on |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Operator floods `POST /api/pause` with junk reasons → DB bloat | Tampering | Bound `reason` to 200 chars + strip control chars in route handler |
| Race: pause flipped between CP1 read and CP2 read mid-`handleNewPairForChain` | TOCTOU | Acceptable — CP1/CP2/CP3 are deliberately re-checked; the race window between CP2 and submit IS the rationale for CP3 audit-only log per D-KILLSWITCH-CP3 |
| Stale-data warning leaks position addresses via pino | Information Disclosure | Existing pino logs already include `token` addresses; no new exposure |
| Mid-run wallet check flips pause; operator emergency-sell already in flight at the same moment | Race | Pause check at CP1/CP2/CP3 is per-pair-event; emergency-sell runs through `executeFullSell` lock path independently. No collision possible — pause never panic-sells. |
| CI guard bypassed by force-push to main | Tampering | Pre-existing risk; out of scope for Phase 20. Branch protection rules + 2-reviewer rule handle this. |
| CLI `scripts/pause.ts` leaks `DASHBOARD_API_KEY` in process arg list | Information Disclosure | Pass `apiKey` via env (already the pattern), never via `--api-key=` CLI arg |
| Preflight RPC HEAD against Flashbots / bloXroute fingerprints the bot's existence at boot | Information Disclosure | Pre-existing — Phase 4 MEV health check already does this; mitigation = wallet/identity already exposed via mainnet activity. Out of scope. |

### Phase 20 Specific Threats

| Threat | Category | Mitigation |
|--------|----------|------------|
| **T-20-01 schema-migration partial failure** corrupts DB and bricks bot boot | Capital safety (loss of access to in-flight positions) | Wrap v5→v6 migration in `db.transaction()`; column-existence guard for ALTER (mirrors v3→v4 pattern at lines 113-119); test on a copy of production `data/bot.db` before merging |
| **T-20-02 race: pause flipped via dashboard, operator already submitted CP3-stage buy** | Capital safety | Per D-KILLSWITCH-CP3: trade IS recorded + exit monitor IS started. Pause never panic-sells. CP3 audit log captures the race for post-mortem. **MITIGATED BY DESIGN** |
| **T-20-03 cross-env validation false-positive** prevents bot start at funded wallet | Capital safety (operator can't trade) | Test each rule with passing AND failing fixtures; cross-check actual `.env` against rules before merge |
| **T-20-04 mid-run wallet undercut spam alerts every 5 min** | UX / operator fatigue | Pause-flip is idempotent — once paused, subsequent undercut detections do NOT re-fire `sendCtxAlert` (check `currentPause.paused !== 1` before alert) |
| **T-20-05 CLI script timing leaks `DASHBOARD_API_KEY`** via login-response timing | Information Disclosure | Auth middleware already uses `timingSafeEqual` (line 54) — no timing leak surface. CLI scripts adopt same primitive at OS-process level (env-passing not CLI-arg-passing) |
| **T-20-06 CI guard false-positive** on legitimate `GOING-LIVE-V2.md` future doc | Process | Guard matches exact filenames `GOING-LIVE.md` / `HONEYPOT-SIM-BRIEFING.md` only. Future docs named `GOING-LIVE-V2.md` are NOT blocked. **VERIFIED** by `test -f` semantics. |
| **T-20-07 preflight check exposes wallet balance** to operator who shoulder-surfs the dashboard | Information Disclosure | Balance is already on-chain public knowledge; the dashboard already shows position values. Not a new exposure. |

## Runtime State Inventory

> Not applicable for Phase 20 — this is a greenfield feature addition, not a rename / refactor / migration phase. There is no string-rebrand, ID-rename, or namespace shift happening.

The schema v5→v6 migration IS a data-layer change, but it is **additive only** — no existing data needs to be migrated to a new shape. The 5 categories below are explicitly checked nonetheless for the "data already stored under the old shape" risk:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None.** `pause_state` is a new table seeded with an empty row at migration time. `chain_state.antirug_dry_run_started` is a new nullable column populated by the anti-rug detector on first start per chain. No existing stored data references a renamed key. | none |
| Live service config | **None.** No external services are being renamed. Dashboard's existing `chain_status_change` / `antirug_event` / `cb_tripped` event types are unchanged; new `pause_state_change` event type is purely additive. | none |
| OS-registered state | **None.** No Windows Task Scheduler / launchd / pm2 / systemd registrations involved. The bot is started manually via `npx ts-node src/bot.ts` per user memory. | none |
| Secrets/env vars | **Additions only.** New optional envs: `<CHAIN>_GAS_BUFFER` × 4, `MID_RUN_CHECK_INTERVAL_SEC`, `STALE_WARN_SEC`, `STALE_ERROR_SEC`, `<CHAIN>_BLOCK_AGE_TOLERANCE_SEC` × 4, `DASHBOARD_URL`. All have safe defaults; no rename of existing envs. | document in `.env.example` per D-ENV-EXAMPLE |
| Build artifacts | **None.** No package rename; no `.egg-info` / Docker tag / npm-global changes. | none |

## Common Pitfalls

### Pitfall 1: Schema migration runs on already-funded production DB

**What goes wrong:** Migrating `data/bot.db` v5→v6 on a bot with an actively-funded mainnet wallet (0.0124 ETH on ETH chain) can corrupt the DB if any of the new DDL fails partway. Phase 19's v4→v5 ran cleanly because every statement was a `CREATE TABLE IF NOT EXISTS` (idempotent). Phase 20 introduces `ALTER TABLE chain_state ADD COLUMN` which is NOT inherently idempotent — re-running the migration on a partially-applied state can fail.

**Why it happens:** SQLite's `ALTER TABLE ADD COLUMN` will error with `duplicate column name` if the column already exists. The column-existence guard at lines 113-119 (v3→v4 pattern) prevents this. Without it: partial migration → re-run → fail.

**How to avoid:** (a) Wrap the entire v5→v6 block in a `db.transaction(() => { ... })()`; (b) check `PRAGMA table_info('chain_state')` for the `antirug_dry_run_started` column existence before issuing the ALTER (belt-and-suspenders like the v3→v4 pattern at db.ts:113-119); (c) test the migration on a copy of `data/bot.db` BEFORE merging the PR.

**Warning signs:** Migration log line `Created pause_state + antirug_dry_run_started column (schema version 6)` does NOT appear; `pragma user_version` does NOT increment to 6; subsequent boot complains `no such column: antirug_dry_run_started`.

### Pitfall 2: Cross-env validation FATAL-exits at funded wallet

**What goes wrong:** A cross-rule mis-implementation could FATAL-exit the bot when the operator's wallet is legitimately funded. E.g. a typo `TELEGRAM_API_HASH` → `TELEGRAM_API_HASHH` in the rule causes the rule to always fail. Bot stops trading; operator must debug.

**Why it happens:** Cross-rule code is plain string comparison against `process.env[name]`; a typo in the rule is silent until runtime.

**How to avoid:** (a) Reference cross-rule names from a const map keyed by the canonical env name (so a typo throws at type-check time); (b) test each rule with PASSING + FAILING fixtures; (c) verify rules against the actual production `.env` file BEFORE merging.

**Warning signs:** Preflight FATAL output references an env var name not in `REQUIRED_ENV_VARS` of `config.ts`.

### Pitfall 3: Killswitch CP2 races bundle submission

**What goes wrong:** Operator presses pause via dashboard at T=0. CP2 read in `handleNewPairForChain` at T=+5ms reads `paused=0` (pause hadn't propagated yet from the API endpoint's `setPauseState.run()` to the `getPauseState.get()` view). Bundle submits at T=+10ms. Position opens after pause was pressed.

**Why it happens:** SQLite WAL mode (already enabled at db.ts:20) gives concurrent reads-while-writes — but consistency across connection-context boundaries can lag a few hundred ns. In practice this is well under the multi-ms time-to-submit, so the race is negligible. **HOWEVER:** the design EXPECTS CP3 to be the audit-log-only safety net for this exact race per D-KILLSWITCH-CP3.

**How to avoid:** The CP3 audit-log fires whenever pause flipped between CP2-pass and `sendTxWithRetry` return. The trade still records, the exit monitor still arms. Pause never panic-sells. This is BY DESIGN.

**Warning signs:** Frequent `op: 'killswitch.cp3'` log entries in production logs — investigate dashboard latency / WS event ordering if so.

### Pitfall 4: Mid-run wallet check pauses bot during ongoing snipe

**What goes wrong:** Wallet falls below floor at T=0 mid-run. Bot pauses globally at T=+1s. A pair-event was already mid-`handleNewPairForChain` execution at T=0; it reaches CP1 at T=+2s; CP1 reads pause flag, returns early. The opportunity is dropped (no position opens).

**Why it happens:** That is exactly the intended behavior. The race-window between pause-flip and CP1-read works in the bot's favor.

**How to avoid:** No avoidance needed — this is the design.

**Warning signs:** Operator complains "I had funding but bot stopped trading" → check pause_state row; if `paused_by='preflight'` then mid-run check fired correctly. Operator refunds and resumes manually.

### Pitfall 5: Dashboard banner stuck on stale state after WS reconnect

**What goes wrong:** Dashboard loses WS connection during a pause/resume cycle. Banner shows wrong state until next event.

**Why it happens:** WS broadcast is fire-and-forget per `src/api/ws/broadcaster.ts:39-50`.

**How to avoid:** Banner mount in `Layout.tsx` triggers a fresh `useApi<PauseState>('/api/controls/pause')` call on every WS reconnect (similar to how `useWs() => connected` already triggers re-fetch).

**Warning signs:** Banner shows "BOT PAUSED" but `SELECT paused FROM pause_state` returns 0.

### Pitfall 6: Operator CLI script auth flow leaks API key in logs

**What goes wrong:** `scripts/pause.ts` accidentally logs the value of `DASHBOARD_API_KEY` (e.g., `log.info({ apiKey }, 'Logging in')`).

**Why it happens:** Easy mistake during prototyping.

**How to avoid:** Lint rule + explicit code review — never reference `apiKey` inside any pino log object. Pass it through `axios.post(..., { apiKey })` body only.

**Warning signs:** Search `scripts/*.ts` for `apiKey` references that flow into log calls.

### Pitfall 7: CI guard treats `docs/operations/going-live.md` as a "GOING-LIVE.md" hit

**What goes wrong:** A glob-based check might match `**/GOING-LIVE.md` and false-positive on the new canonical location.

**Why it happens:** Reviewers might suggest a glob pattern instead of exact-filename.

**How to avoid:** Use `test -f GOING-LIVE.md` (exact-path-from-cwd, not glob). Verified by reading test(1) man page: `-f FILE` returns true only if FILE exists at exact path.

**Warning signs:** CI fails immediately after move with "GOING-LIVE.md reappeared" — check guard pattern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Single-row table enforcement | A trigger that prevents `INSERT`s with `id != 1` | `id INTEGER PRIMARY KEY CHECK(id = 1)` at the column level + `INSERT OR IGNORE` for the seed row | The CHECK constraint is enforced at storage layer; INSERT OR IGNORE makes seed idempotent on re-run. Standard SQLite pattern. |
| Session cookie auth for new endpoints | New cookie / token format for pause endpoints | Reuse existing `authMiddleware` from `src/api/middleware/auth.ts:101-110` | Already battle-tested through Phase 4/8 dashboard rollout; `timingSafeEqual` comparison; UUID sessions with periodic cleanup. |
| WS broadcast plumbing | New WS server or pub/sub | Existing `broadcast(type, data)` from `src/api/ws/broadcaster.ts:39-50` | Already used by Phase 19 anti-rug for `cb_tripped` / `chain_ws_health_change` / `antirug_event`. |
| Cross-variable env reading at startup | A new env loader / validator | `process.env.X` reads inside `validateCrossEnvRules()`, after the existing `validateEnvVars()` in `config.ts:133-144` has fired | Phase 17/18/19 use this exact split: per-var lives in `REQUIRED_ENV_VARS`; cross-var is a separate fail-loud check. |
| Telegram alert for FATAL preflight | A new alert primitive | `sendCtxAlert(ctx, message)` via existing notifier path | Same alert path as Phase 18 SKIP alerts (D-ALERTS); operator sees a 1-line Telegram with full evidence in pino. |
| `getCode()` check for HoneypotChecker at startup | Custom bytecode introspection | `httpProvider.getCode(address)` returning `'0x'` means EOA or undeployed | Phase 19 `verifyAllowlistAtStartup` already does exactly this for LP-lock allowlist addresses (D-LIST-VERIFY pattern). |
| Schema migration framework | A migration library (knex, db-migrate) | The existing `migrateSchema()` function in `db.ts:29-157` | Phase 3/14/18/19 all extend the same `if (version < N) { ... }` pattern. v5→v6 is the next in line. |
| CI guard for file existence | A new GitHub Action | `test -f FILE && exit 1` shell step inside the existing `test` job | Same family as Phase 17's `.todo` ban (lines 20-33). Minimal surface area, no new deps. |
| Pause read at every checkpoint via cache | A pause-state cache with invalidation | Direct `getPauseState.get()` call (better-sqlite3 sync read ~ns) | Read frequency is ~1/sec peak; cache adds complexity for zero perf win. |

**Key insight:** Phase 20 is intentionally low-novelty — almost every primitive already exists in the codebase. The phase's value is in COMPOSITION (preflight + killswitch + pause-state + runbook), not new abstractions. Hand-rolling new primitives would multiply the surface area without buying capital-safety improvement.

## Code Examples

### Schema migration v5→v6 (in `src/utils/db.ts`)

```typescript
// Source: src/utils/db.ts pattern at lines 122-154 (Phase 19 v4→v5 migration)
// Adapted for Phase 20 v5→v6
if (version < 6) {
    const tx = db.transaction(() => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS pause_state (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                paused INTEGER NOT NULL DEFAULT 0,
                paused_at INTEGER,
                paused_by TEXT,
                reason TEXT
            );
            INSERT OR IGNORE INTO pause_state (id, paused, paused_at, paused_by, reason)
            VALUES (1, 0, NULL, NULL, NULL);
        `);

        // Belt-and-suspenders column-existence guard (mirrors v3→v4 at lines 113-119).
        const columns = db.prepare("PRAGMA table_info('chain_state')").all() as Array<{ name: string }>;
        const hasColumn = columns.some(c => c.name === 'antirug_dry_run_started');
        if (!hasColumn) {
            db.exec(`ALTER TABLE chain_state ADD COLUMN antirug_dry_run_started INTEGER`);
        }
    });
    tx();
    logger.info('Created pause_state table + antirug_dry_run_started column (schema version 6)');
}
```

### Killswitch CP1 (in `src/bot.ts` at line 346)

```typescript
// Source: pattern composes existing logger.info from bot.ts:346 + new getPauseState read
ctx.log.info({ token: targetToken, symbol }, 'All safety checks passed, buying');

// Phase 20 / OPS-LIVE-08 D-KILLSWITCH-CP1 — post-safety-bank pause check.
// Pause flag set → return BEFORE bundle construction. No expensive RPC/MEV work.
const pauseState = getPauseState.get() as { paused: number };
if (pauseState.paused === 1) {
    ctx.log.info({ op: 'killswitch.cp1', token: targetToken, reason: 'global-pause' }, 'CP1 pause-check: aborting before bundle construction');
    return;
}
```

### Pause endpoint (in `src/api/routes/controls.ts`)

```typescript
// Source: pattern adapted from controls.ts:51-110 force-sell endpoint
router.post('/pause', async (req: Request, res: Response) => {
    const body = req.body as { reason?: string; pausedBy?: string };
    const reason = sanitizeReason(String(body.reason || 'manual operator pause')).slice(0, 200);
    const pausedBy = String(body.pausedBy || 'dashboard');
    setPauseState.run(Math.floor(Date.now() / 1000), pausedBy, reason);
    broadcast('pause_state_change', { paused: true, pausedBy, reason });
    log.info({ pausedBy, reason }, 'Bot paused via API');
    res.json({ ok: true, paused: true, pausedBy, reason });
});
```

### Mid-run wallet check (in `src/bot.ts` after line 926)

```typescript
// Source: pattern adapted from bot.ts:917-926 existing MEV health setInterval
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

## REQUIREMENTS.md Refinement Targets

These are the exact line ranges in `.planning/REQUIREMENTS.md` (verified by reading the file) that need rewording during plan-phase:

### OPS-LIVE-02 (line 66) per D-BALANCE-FLOOR

**Current text (line 66):**
> `- [ ] **OPS-LIVE-02**: Wallet balance pre-flight — FATAL on undercut (exit non-zero), never warn-and-continue. Per-chain minimum derived from \`chainRegistry.ts\` \`maxCapital\` field. Periodic re-check during operation (default every 5 minutes); halt + Telegram alert if balance falls below threshold mid-run.`

**Refined text (replace line 66 verbatim):**
> `- [ ] **OPS-LIVE-02**: Wallet balance pre-flight — FATAL on undercut (exit non-zero), never warn-and-continue. Per-chain minimum derived as \`snipeAmount × maxOpenPositions + <CHAIN>_GAS_BUFFER\` (operational floor, not deployment ceiling — see Phase 20 D-BALANCE-FLOOR). Periodic re-check during operation (default every 5 minutes); on undercut, flip global pause flag with \`paused_by='preflight'\` + Telegram alert. Exit monitors keep running.`

**Rationale:** Original text references `maxCapital` (deployment CEILING, e.g. 1.0 ETH for ETH). At the bot's current 0.0124 ETH funding the original wording would FATAL-exit the bot despite it being perfectly capable of running one snipe (0.003 ETH). Refinement is required for the bot to be operational at the funded level.

### OPS-LIVE-06 (line 70) per D-STALE-THRESHOLDS

**Current text (line 70):**
> `- [ ] **OPS-LIVE-06**: Stale-data warnings — at startup, flag positions whose \`last_update_ts\` exceeds 2× the current poll interval. Tiered severity (warn under 4×, error over 4×).`

**Refined text (replace line 70 verbatim):**
> `- [ ] **OPS-LIVE-06**: Stale-data warnings — at startup, flag positions whose \`trades.timestamp\` exceeds operationally-meaningful thresholds (default: warn at >2 minutes, error at >10 minutes; configurable via \`STALE_WARN_SEC\` / \`STALE_ERROR_SEC\` envs). Original "2×/4× poll interval" wording was too noisy (10s/20s = normal poll-cycle traffic per Phase 20 D-STALE-THRESHOLDS).`

**Rationale:** Original wording (2×/4× of 5s = 10s/20s) catches normal poll-cycle gaps as "stale" — every position would constantly trigger warnings. 2 min / 10 min catches real freezes (RPC down, exit engine wedged, partial-sell deadlock) without spam.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-variable env validation only (`REQUIRED_ENV_VARS` in `config.ts`) | Per-variable in `config.ts` + cross-variable in `src/preflight.ts` | Phase 20 OPS-LIVE-07 | Cross-rule violations are now caught at startup with a single audit surface; previously, broken combos failed at runtime mid-execution. |
| Single-stage operator emergency-sell | Emergency-sell + multi-stage pause + persistent pause-state | Phase 20 OPS-LIVE-08/09 | Operator gets a "stop opening new ones without panic-selling" granularity that didn't exist; pause survives restart. |
| `GOING-LIVE.md` + `HONEYPOT-SIM-BRIEFING.md` at repo root (briefings + drafts) | `docs/operations/going-live.md` (versioned operator handoff) + briefing deleted (rationale archived in `.planning/phases/18-CONTEXT.md`) | Phase 20 OPS-LIVE-12/13 | Operator-facing docs live in a discoverable canonical location; CI guard prevents regression. |
| Wallet floor = `maxCapital` (deployment ceiling) | Wallet floor = `snipeAmount × maxOpenPositions + gas_buffer` (operational floor) | Phase 20 D-BALANCE-FLOOR | Bot operational at conservative funding (0.0124 ETH first-live-test) without flapping FATALs. |
| Stale-data window = 2×/4× poll interval (10s/20s) | 2 min / 10 min operational thresholds | Phase 20 D-STALE-THRESHOLDS | Stops alert spam; warnings now mean something. |

**Deprecated/outdated (in this phase's context):**
- The OPS-LIVE-02 line wording with `maxCapital`-derived floor — superseded by D-BALANCE-FLOOR; **PLANNER UPDATES**.
- The OPS-LIVE-06 line wording with 2×/4× poll-interval thresholds — superseded by D-STALE-THRESHOLDS; **PLANNER UPDATES**.
- Repo-root operator docs — superseded by `docs/operations/`; CI guard locks the move.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | better-sqlite3 v12.8's `db.transaction()` permits DDL (CREATE / ALTER) inside the transaction block | §1 Schema Migration | Schema migration fails partway; plan-phase should test this on a `.db` copy before merging |
| A2 | `process.env.MAX_OPEN_POSITIONS` reads as `'1'` in production `.env` per HONEYPOT-SIM-BRIEFING.md line 5 description of conservative first-live-test setup | §3 Wallet Balance Floor | If `MAX_OPEN_POSITIONS=10` (the REQUIRED_ENV_VARS default), the floor at default snipeAmount × 10 + gas_buffer = 0.035 ETH would FATAL the bot at 0.0124 ETH. Planner should verify `.env` value before merging |
| A3 | OPS-LIVE-06 means "buy timestamp" (`trades.timestamp`), not "most-recent-action timestamp" | §12 Stale-Data Warnings | If user meant "most recent action", a join with sells/partial_sells is needed; flag this in plan-phase or §Open Questions |
| A4 | Phase 19 `src/anti-rug/detector.ts` `startChainAntiRugListener` has a clean first-time-start entry point where `setAntirugDryRunStarted.run(...)` can be inserted | §11 Anti-Rug Timestamp Record | Planner reads detector.ts at plan-phase and identifies the exact line; CONTEXT.md says "first-time start per chain" |
| A5 | `axios@1.10.0` cookie handling via `withCredentials: true` + manual `Cookie:` header forwarding works for the CLI scripts' login → action flow | §9 Operator CLI Scripts | If not, switch to `tough-cookie` library — but axios 1.x does support this without extra deps per its docs |
| A6 | The existing dashboard mount in `Layout.tsx` lines 30-42 is the right place for the global pause banner (visible on every page) | §10 Dashboard Pause Banner | If dashboard has a different layout root (it doesn't per the file read), banner mount needs a different point |
| A7 | `test -f` in GitHub Actions ubuntu-latest bash matches exact-path-from-cwd | §14 CI Guard | Verified by reading bash `test(1)` semantics — `-f` is exact-path, not glob. Confirmed. |
| A8 | The phase 18 `sanitizeReason` utility (referenced in bot.ts:267) is exported and reusable for the pause endpoint's reason field | §8 Pause/Resume Endpoints | If not exported, plan-phase exports it from its current home or inlines the same sanitization (max 200 chars + strip control chars) |
| A9 | `dotenv@17.2.0`'s `dotenv.config()` works identically in the new CLI scripts as it does in `scripts/deploy-honeypot-checker.ts:38` | §9 Operator CLI Scripts | Identical usage pattern; no risk |

## Open Questions for Planner

1. **OPS-LIVE-06 column semantics**
   - **What we know:** CONTEXT.md uses the phrase `last_update_ts` semantically but the `trades` table has a `timestamp` column (buy time), not a `last_update_ts` column. Plan-phase or discuss-phase should resolve whether stale-data warnings mean "buy timestamp" or "most-recent-action timestamp" (which would require a SQL join).
   - **What's unclear:** The intent — Is operator looking for "buy positions that are old" (simple `trades.timestamp` query) or "positions where no sell/partial-sell happened recently" (complex max-action query)?
   - **Recommendation:** Ship v1 with `trades.timestamp` (buy time, simpler query, easier to reason about). Add a follow-up if operator finds it noisy.

2. **Mid-run wallet check interval default**
   - **What we know:** CONTEXT.md says "default every 5 minutes" but flags it as planner discretion if a different default makes more sense.
   - **What's unclear:** Is 5 min too aggressive? Too slow? The chain block-times suggest faster on Arb (2s) and slower on ETH (12s).
   - **Recommendation:** Ship 5 min default (`MID_RUN_CHECK_INTERVAL_SEC=300`). It's the same cadence as the existing MEV health check, which Phase 4 has run cleanly through v6.16. No reason to deviate.

3. **`preflight.ts` module split**
   - **What we know:** CONTEXT.md leaves to planner discretion. Two options: single file `src/preflight.ts` (~300 LOC) or `src/preflight/{checks,validation,runner}.ts` directory.
   - **Recommendation:** Single file. Phase 19's `src/anti-rug/` split happened only when the module reached 1000+ LOC across distinct concerns (detector + evaluator + lifecycle). Phase 20's preflight is 250-350 LOC total and the concerns are highly cohesive (every check returns a `PreflightResult`).

4. **Block-age tolerance defaults**
   - **What we know:** CONTEXT.md suggests ~5× block-time per chain (ETH ~60s, BSC ~15s, Base ~10s, Arb ~2s). Flags Arb as "1.25s too tight" — suggests using "rounded up to a sane minimum".
   - **Recommendation:** ETH 300s (5×60), BSC 60s (4×15), Base 30s (3×10), Arb 30s (matches Base; below this is noisy). Lands as `defaultBlockAgeToleranceSec` in `CHAIN_TEMPLATES` + `<CHAIN>_BLOCK_AGE_TOLERANCE_SEC` env override.

5. **`scripts/preflight.ts` output format**
   - **What we know:** CONTEXT.md says human-readable preferred, machine-readable optional via `--json` flag.
   - **Recommendation:** Ship both. Default human output is per-chain grouped checks with ✓/✗; `--json` outputs the full `PreflightResult[]` array.

6. **Stale-data periodic re-check**
   - **What we know:** CONTEXT.md leaves to planner discretion whether stale-data warning is one-shot at startup or also periodic. REQ-as-written is startup-only minimum.
   - **Recommendation:** Ship startup-only for v1. Periodic is a quality upgrade that emerges from operator feedback after Phase 20 lands.

7. **`docs/operations/going-live.md` content update timing**
   - **What we know:** Move-first-then-update or update-as-part-of-move? CONTEXT.md prefers move-first per D-AUDIT-TRAIL.
   - **Recommendation:** Move-first: `git mv GOING-LIVE.md docs/operations/going-live.md` in one commit, then content updates in subsequent commit. Git history clearly shows "what was moved" vs "what was added in Phase 20".

8. **CI guard placement: shell `test -f` vs `dorny/paths-filter@v3`**
   - **What we know:** CONTEXT.md flags this as planner discretion.
   - **Recommendation:** Shell `test -f` step in the existing `test` job. Same family as the `.todo` ban. `dorny/paths-filter` is overkill for "two specific filenames must not exist".

9. **Migration transaction semantics**
   - **What we know:** Better-sqlite3 v12.x docs don't explicitly document DDL inside `db.transaction()`. The migration mixes CREATE + INSERT + ALTER.
   - **Recommendation:** Test in plan-phase. If DDL+`.transaction()` fails, fall back to sequential `db.exec()` with the column-existence guard for the ALTER (same defensive pattern as v3→v4).

10. **Dashboard banner color**
    - **What we know:** CONTEXT.md says "prominent red banner". The existing `CircuitBreakerBanner.tsx` uses `bg-loss text-white` (line 36). Reuse?
    - **Recommendation:** Use the same `bg-loss text-white` Tailwind classes. Visual consistency with the anti-rug emergency banner means operator instantly recognizes "something blocking new trades is happening".

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Bot runtime | ✓ | v22.16.0 | — |
| npm | Package management | ✓ | (bundled with Node) | — |
| `better-sqlite3` | DB layer | ✓ | ^12.8.0 | — |
| `ethers` | Chain RPC | ✓ | 6.16.0 | — |
| `axios` | HTTP client | ✓ | 1.10.0 | — |
| `pino` | Logging | ✓ | ^10.3.1 | — |
| `dotenv` | Env loading | ✓ | 17.2.0 | — |
| `express` | API server | ✓ | ^5.2.1 | — |
| `vitest` | Test runner | ✓ | ^4.1.1 | — |
| `ts-node` | Script runtime | ✓ | 10.9.2 | — |
| `ws` | WebSocket dashboard | ✓ | ^8.20.0 | — |
| `dorny/paths-filter@v3` | (NOT needed for Phase 20 — `test -f` step preferred) | ✓ if needed | n/a | shell `test -f` |
| `bash` | CI YAML step | ✓ (`ubuntu-latest`) | — | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

Phase 20 is pure code/config additions using already-installed dependencies. The `dorny/paths-filter@v3` action is in `package.json` … actually, it's a GitHub Action (not an npm package), and it's already used in `.github/workflows/test.yml:63` for the Phase 18 contracts gate. Not needed for Phase 20 (preferred guard is shell `test -f`).

## Sources

### Primary (HIGH confidence)
- `.planning/phases/20-going-live-ops-hardening/20-CONTEXT.md` — All decisions D-PAUSE-*, D-KILLSWITCH-*, D-BALANCE-FLOOR, D-PREFLIGHT-FLOW, D-MID-RUN-CHECK, D-VALIDATION-HOME, D-ANTIRUG-LIVE-GATE-CODE, D-STALE-THRESHOLDS, D-BRIEFING-DELETE, D-RUNBOOK-MOVE, D-ENV-EXAMPLE, D-OPERATOR-HANDOFF, D-STOP-THE-LINE, D-ROLLBACK, D-ALERTS, D-04
- `.planning/REQUIREMENTS.md` lines 61-77, 178-190 — OPS-LIVE-01..13 row text + traceability
- `.planning/ROADMAP.md` lines 156-166 — Phase 20 goal + 5 success criteria + depends-on
- `.planning/STATE.md` — milestone status + recent activity
- `src/utils/db.ts` lines 27-157 — schema migration framework + prepared statement export pattern (Phase 3/14/18/19)
- `src/bot.ts` lines 200-450, 870-940 — `handleNewPairForChain` (V2) + `handleNewV3PoolForChain` (V3) + `startMultiChainBot` exact line ranges for killswitch insertion + chainId check at lines 886-895 + MEV health interval at lines 917-926
- `src/config.ts` lines 13-148 — `REQUIRED_ENV_VARS` + `validateEnvVars()` pattern
- `src/chainRegistry.ts` lines 75-214 — `ChainConfig` + `CHAIN_TEMPLATES` per-chain extension pattern (Phase 18/19)
- `src/api/routes/controls.ts` lines 1-221 — existing `force-sell` / `emergency-sell` route shape (alongside extension target)
- `src/api/routes/chains.ts` lines 1-228 — existing `stoppedChains: Set<string>` per-chain control (untouched by Phase 20)
- `src/api/middleware/auth.ts` lines 1-110 — `DASHBOARD_API_KEY` + `timingSafeEqual` auth pattern
- `src/api/ws/broadcaster.ts` lines 1-50 — `broadcast(type, data)` typed-event pattern
- `dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx` lines 1-66 — full-bleed banner pattern (clone for pause banner)
- `dashboard/src/hooks/WebSocketContext.tsx` lines 1-39 — WS context value extension point
- `dashboard/src/pages/Overview.tsx` lines 1-80 — dashboard root context consumption pattern
- `dashboard/src/components/Layout.tsx` lines 1-44 — layout root mount point for banner
- `.github/workflows/test.yml` lines 1-156 — existing `.todo` ban + contracts paths-filter pattern
- `package.json` lines 1-80 — installed-dependency verification
- `vitest.config.ts` — `unit` / `integration` / `fork` projects
- `.planning/config.json` — `workflow.nyquist_validation: true` confirmed
- `scripts/deploy-honeypot-checker.ts` lines 1-50 — script structure pattern for new CLI scripts
- `GOING-LIVE.md` lines 1-50 (251 total LOC) — content to be moved
- `HONEYPOT-SIM-BRIEFING.md` lines 1-30 (139 total LOC) — content to be deleted

### Secondary (MEDIUM confidence)
- WebSearch: SQLite CHECK constraint patterns — `[CITED: sqlite.org/lang_createtable.html, dbschema.com/blog/sqlite/constraints]` — confirms `CHECK(id=1)` single-row pattern is standard. Combined with the existing v3→v4 belt-and-suspenders pattern at `db.ts:113-119`, the migration approach is HIGH-confidence overall.

### Tertiary (LOW confidence)
- `better-sqlite3` v12.x `db.transaction()` semantics around DDL — A1 in Assumptions Log. Plan-phase to verify on a copy of `data/bot.db` before merging.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep already installed, version verified by reading `package.json` on 2026-05-24
- Architecture: HIGH — every D-* in CONTEXT.md is locked; line numbers verified by reading bot.ts / db.ts / config.ts / controls.ts directly
- Pitfalls: HIGH — Phase 18/19 patterns establish all the mitigations
- REQUIREMENTS.md refinement: HIGH — exact lines 66 and 70 confirmed by reading the file
- Validation architecture: HIGH — vitest projects already wired; test patterns from Phase 17/18/19 retroactive Nyquist
- Schema migration: MEDIUM-HIGH — pattern is well-established but A1 (DDL inside `.transaction`) flagged for plan-phase verification

**Research date:** 2026-05-24
**Valid until:** 2026-06-23 (30 days — phase is stable; CONTEXT.md is locked; codebase is stable at the line numbers cited)

---

*Phase 20: Going-Live Ops Hardening — Research complete.*
*Researched by: gsd-researcher (Opus 4.7, 1M context) on 2026-05-24.*
