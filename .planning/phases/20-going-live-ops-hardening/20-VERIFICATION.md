---
phase: 20-going-live-ops-hardening
verified: 2026-05-24T00:00:00Z
status: human_needed
score: 13/13 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Run npm run preflight with a valid .env against a live RPC"
    expected: "Script exits 0 and prints per-chain pass/fail summary without starting the bot; no startMultiChainBot log line appears"
    why_human: "End-to-end subprocess RPC connectivity cannot be verified without a live network connection and funded wallet"
  - test: "Run npm run pause -- --reason 'smoke' then npm run resume with a running bot and dashboard"
    expected: "Dashboard shows red BOT PAUSED banner after pause; banner disappears after resume; pause_state table reflects correct rows"
    why_human: "Dashboard visual appearance and WS event delivery require a live browser session against a running bot"
  - test: "Press dashboard pause button while a snipe is mid-flight (between safety bank and bundle build)"
    expected: "CP1 fires on the next PairCreated event after pause; sendTxWithRetry is never called; pino info op:killswitch.cp1 appears in logs"
    why_human: "Real-time kill-switch behavior under live MEV conditions cannot be verified without mainnet activity; timing-dependent"
  - test: "Confirm bot restarts honoring persisted pause_state.paused=1 from SQLite"
    expected: "Bot starts all chain listeners and dashboard, exit monitors run for open positions, new PairCreated events hit CP1 and return early — sendTxWithRetry never called during the paused restart"
    why_human: "Full D-PAUSED-RESTART observable chain (listeners + dashboard + exit monitors all running + CP1 catch) requires a live bot restart with open positions in the DB"
---

# Phase 20: Going-Live Ops Hardening Verification Report

**Phase Goal:** The bot refuses to start in any internally-inconsistent or unsafe state — undercut wallet, mismatched chainId, missing checker code-at-address, `MEV_STRATEGY=flashbots` without `FLASHBOTS_AUTH_KEY`, etc. — with operator-facing error messages that point to the runbook; the operator can run `npm run preflight` to verify readiness without starting the bot, and `npm run pause`/`npm run resume` to operate the kill-switch from the CLI; the runbook is in versioned docs and the multi-stage kill-switch cannot result in a position opening 30s after pause.

**Verified:** 2026-05-24T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | `MEV_STRATEGY=flashbots` + no `FLASHBOTS_AUTH_KEY` causes non-zero exit with pino fatal naming the offending pair and pointing to `docs/operations/going-live.md` | VERIFIED | `src/preflight.ts:399–407` catches the combo in `validateCrossEnvRules()`, returns `passed:false` with `reason:'MEV_STRATEGY=flashbots requires FLASHBOTS_AUTH_KEY to be set'`; `preflight()` at line 615–622 emits `log.fatal({chain,check,reason,remediation:'docs/operations/going-live.md',...})` + calls `process.exit(1)` at line 634. Same pattern verified for BLOXROUTE_AUTH_HEADER and TELEGRAM_API_ID 5-tuple rules. |
| SC2 | Wallet below per-chain floor causes FATAL non-zero exit; mid-run undercut auto-pauses with Telegram alert; `getCode=0x` FATAL-exits with remediation message | VERIFIED | `src/preflight.ts:132` exports `checkWalletBalance`; floor formula uses `ethers.parseEther(chain.snipeAmount) * BigInt(MAX_OPEN_POSITIONS) + ethers.parseEther(chain.gasBuffer)` per D-BALANCE-FLOOR. `checkHoneypotCheckerCode` at line 288 returns FATAL with remediation pointer. `src/bot.ts:1016–1033` mid-run `setInterval` calls `checkWalletBalance` per chain, on fail calls `setPauseState.run(ts,'preflight',reason)` + `broadcast('pause_state_change',...)` + `sendCtxAlert(ctx,'*BOT PAUSED*...')`. Idempotence guard at line 1024 prevents duplicate alerts. |
| SC3 | `npm run preflight` runs all checks, prints per-chain pass/fail, exits non-zero on FATAL, does NOT start the bot. `npm run pause`/`resume` wrap dashboard endpoints with `DASHBOARD_API_KEY`. | VERIFIED | `package.json:15–17` wires `ts-node scripts/preflight.ts`, `ts-node scripts/pause.ts`, `ts-node scripts/resume.ts`. `scripts/preflight.ts:22` imports `preflightDryRun` (NOT `startMultiChainBot`). Comments at line 12 confirm no bot-start. `scripts/pause.ts:63` POSTs to `/api/controls/pause` via two-step login + cookie-forward. Both scripts read `DASHBOARD_API_KEY` from env only; `test/integration/preflightCli.test.ts` (0 `it.skip`, 5 active `it()`s) asserts no bot spawn. |
| SC4 | Operator pauses while snipe is mid-flight — multi-stage kill-switch re-checks at CP1/CP2/CP3 abort in-flight execution; pause state survives full bot restart (loaded from SQLite at boot); an operator-pressed pause cannot result in a position opening after bot reboots. | VERIFIED | `src/bot.ts:358–362` V2 CP1 returns early before bundle construction; `384–387` CP2 returns early before MEV submit; `410–414` CP3 logs only (audit-only, falls through per "intentionally fall through" comment at line 413). V3 mirrors at lines 641/688/706. `getPauseState.get()` reads SQLite synchronously on every event (no cache); `pause_state` table persisted across restart. `test/integration/killswitchCheckpoints.test.ts` (0 `it.skip`, real `toHaveBeenCalled`/`not.toHaveBeenCalled` assertions). `test/integration/pauseFlow.test.ts` (0 `it.skip`) asserts SQLite persistence across restart. |
| SC5 | `GOING-LIVE.md` no longer at repo root, moved to `docs/operations/going-live.md` with README link updated; CI guard fails build on re-introduction; `HONEYPOT-SIM-BRIEFING.md` deleted/disposed | VERIFIED | `GOING-LIVE.md` absent at root (ls exits 2). `HONEYPOT-SIM-BRIEFING.md` absent at root (ls exits 2). `docs/operations/going-live.md` exists (547 LOC with all 5 D-OPERATOR-HANDOFF sections). `README.md:23,277,449` all reference `docs/operations/going-live.md`. `.github/workflows/test.yml:34–45` has "Ban root-level operator-facing docs" step using `test ! -e`. `test/unit/ci/rootFileGuard.test.ts` (4/4 active `it()`s) self-tests the CI guard YAML. |

**Score:** 5/5 roadmap success criteria — all VERIFIED

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/preflight.ts` | preflight + preflightDryRun + checkWalletBalance + 7 check functions | VERIFIED | Exists; exports `preflight`, `preflightDryRun`, `checkWalletBalance`, `PreflightResult`; contains `validateCrossEnvRules`, `checkRpcChainId`, `checkRpcBlockAge`, `checkMevHealth`, `checkHoneypotCheckerCode`, `checkAntiRugLiveGate`, `checkStaleData`; `REMEDIATION_DOC='docs/operations/going-live.md'`; `SEVEN_DAYS_SEC=7*86400`; no `SKIP_PREFLIGHT` anywhere |
| `src/utils/db.ts` | v5→v6 migration + 5 prepared statements | VERIFIED | `CURRENT_SCHEMA_VERSION=6` at line 27; `if (version < 6)` block wraps `CREATE TABLE IF NOT EXISTS pause_state` + `INSERT OR IGNORE` + ALTER guard + `db.transaction()`; exports `getPauseState`, `setPauseState`, `clearPauseState`, `setAntirugDryRunStarted` (COALESCE idempotent), `getAntirugDryRunStarted` |
| `src/anti-rug/detector.ts` | `setAntirugDryRunStarted.run()` at `startChainAntiRugListener` entry | VERIFIED | Line 97 imports `setAntirugDryRunStarted`; line 585 calls `setAntirugDryRunStarted.run(chainName, nowSec, nowSec)` inside `startChainAntiRugListener` |
| `src/bot.ts` | `await preflight(registry)` + 6 killswitch CPs + mid-run setInterval | VERIFIED | Line 966 `await preflight(preflightRegistry as any)`. CP1/CP2/CP3 V2 at lines 358/384/410. CP1/CP2/CP3 V3 at lines 641/688/706. `midRunIntervalMs` at line 1016. "Chain ID mismatch" inline check: 0 matches (removed per D-VALIDATION-HOME). |
| `src/api/routes/controls.ts` | POST /pause + POST /resume + GET /pause | VERIFIED | Lines 234/254/270; `setPauseState.run` at line 207 area; `broadcast('pause_state_change',...)` present; `sanitizeReason` helper present |
| `scripts/preflight.ts` | Wraps preflightDryRun, exits non-zero, no bot start | VERIFIED | Imports `preflightDryRun` at line 22; no `startMultiChainBot` import |
| `scripts/pause.ts` | Two-step login + pause via API | VERIFIED | POSTs to `/api/auth/login` then `/api/controls/pause`; `DASHBOARD_API_KEY` never logged |
| `scripts/resume.ts` | Two-step login + resume via API | VERIFIED | Same pattern as pause.ts |
| `package.json` | preflight + pause + resume script entries | VERIFIED | Lines 15–17 confirm `ts-node scripts/*.ts` wiring |
| `src/chainRegistry.ts` | `gasBuffer` + `blockAgeToleranceSec` fields + env overlay | VERIFIED | `blockAgeToleranceSec: number` at line 102; `defaultGasBuffer` at lines 162/233/297/354/411; env overlay at lines 669/675 |
| `src/config.ts` | 12 new REQUIRED_ENV_VARS | VERIFIED | `ETH_GAS_BUFFER` at line 138; `STALE_WARN_SEC` at line 153 (sample spot check) |
| `dashboard/src/components/PauseBanner.tsx` | Full-bleed red banner | VERIFIED | Exists (75 LOC); `bg-loss text-white py-3 px-4 mb-4 -mx-4 sm:-mx-6 lg:-mx-8` at line 56; "BOT PAUSED" at line 61; `/api/controls/resume` fetch at line 43 |
| `dashboard/src/hooks/WebSocketContext.tsx` | `pauseState` field extended | VERIFIED | Line 27 confirms `pauseState: PauseState \| null` |
| `dashboard/src/hooks/useWebSocket.ts` | `pause_state_change` dispatch case | VERIFIED | Line 256 handles `case 'pause_state_change'` |
| `dashboard/src/components/Layout.tsx` | `<PauseBanner />` mounted above `<main>` | VERIFIED | Lines 3/47 confirm import and mount |
| `docs/operations/going-live.md` | 5 D-OPERATOR-HANDOFF sections (547 LOC) | VERIFIED | All 5 headers present at lines 255/361/419/459/480; anti-rug-rollout.md cross-link; D-BALANCE-FLOOR formula; `Last updated: 2026-05-24` at line 546 |
| `.github/workflows/test.yml` | "Ban root-level operator-facing docs" CI guard | VERIFIED | Line 34 step name; lines 44–45 `test ! -e GOING-LIVE.md` + `test ! -e HONEYPOT-SIM-BRIEFING.md` |
| `test/unit/ci/rootFileGuard.test.ts` | 4 active `it()` blocks, no `it.skip` | VERIFIED | Exists; 0 `it.skip`; reads `.github/workflows/test.yml` and asserts guard step presence + both file-absence checks |
| `test/unit/anti-rug/dryRunTimestamp.test.ts` | 4 active tests for dry-run timestamp idempotence | VERIFIED | Exists; 0 `it.skip` |
| `test/unit/dashboard/pauseBanner.test.ts` | PauseBanner source-grep tests | VERIFIED | Exists as `.test.ts` (not `.tsx` — source-grep pattern per Plan 19-06 convention); 0 `it.skip`; 28 active `it()` blocks |
| All 14 Wave-0 test stubs | 0 `it.skip` remaining in implementation files | VERIFIED | All 7 `test/unit/preflight/*.test.ts` files: 0 `it.skip`. All 6 integration test files (`preflightInvocation`, `killswitchCheckpoints`, `pauseFlow`, `preflightCli`, `pauseCli`, `midRunWalletCheck`): 0 `it.skip`. `test/unit/db/pauseStateMigration.test.ts`: 0 `it.skip`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/bot.ts startMultiChainBot` | `src/preflight.ts preflight()` | `await preflight(preflightRegistry as any)` | WIRED | Line 966 in bot.ts |
| `src/bot.ts handleNewPairForChain CP1/CP2/CP3` | `src/utils/db.ts getPauseState` | `getPauseState.get() as {paused: number}` | WIRED | Lines 358/384/410 V2; 641/688/706 V3 |
| `src/bot.ts mid-run setInterval` | `src/preflight.ts checkWalletBalance` + `src/utils/db.ts setPauseState` + `src/api/ws/broadcaster.ts broadcast` | `broadcast('pause_state_change', {...})` | WIRED | Lines 1016–1033; all three functions imported and called |
| `src/api/routes/controls.ts POST /pause` | `src/utils/db.ts setPauseState` + `src/api/ws/broadcaster.ts broadcast` | `setPauseState.run(...)` + `broadcast('pause_state_change',...)` | WIRED | Lines 234–253 in controls.ts |
| `scripts/preflight.ts` | `src/preflight.ts preflightDryRun` | `import { preflightDryRun } from '../src/preflight'` | WIRED | Line 22 in scripts/preflight.ts |
| `scripts/pause.ts` | `/api/auth/login` + `/api/controls/pause` | `axios.post(...)` two-step | WIRED | Lines 47/63 in scripts/pause.ts |
| `src/anti-rug/detector.ts startChainAntiRugListener` | `src/utils/db.ts setAntirugDryRunStarted` | `setAntirugDryRunStarted.run(chainName, nowSec, nowSec)` | WIRED | Line 585 in detector.ts |
| `dashboard/src/components/PauseBanner.tsx` | `dashboard/src/hooks/WebSocketContext.tsx useWs().pauseState` | `const { pauseState } = useWs()` | WIRED | PauseBanner.tsx confirmed to import from WebSocketContext |
| `dashboard/src/hooks/useWebSocket.ts` | `pause_state_change` WS event from broadcaster | `case 'pause_state_change'` dispatch | WIRED | Line 256 in useWebSocket.ts |
| `dashboard/src/components/Layout.tsx` | `PauseBanner` | `<PauseBanner />` above `<main>` | WIRED | Lines 3/47 in Layout.tsx |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/preflight.ts checkWalletBalance` | `balance` (bigint) | `chain.httpProvider.getBalance(wallet.address)` | Yes — real RPC call | FLOWING |
| `src/preflight.ts checkAntiRugLiveGate` | `antirug_dry_run_started` | `getAntirugDryRunStarted.get(chain.name)` from SQLite | Yes — real DB row | FLOWING |
| `src/utils/db.ts getPauseState` | `pause` row | SQLite `pause_state` single-row table | Yes — real DB row | FLOWING |
| `dashboard/src/components/PauseBanner.tsx` | `pauseState` | `useWs().pauseState` from `WebSocketContext` → populated via `GET /api/controls/pause` initial fetch + WS `pause_state_change` dispatch | Yes — REST + WS feed | FLOWING |
| `src/bot.ts mid-run setInterval` | `result.passed` | `checkWalletBalance(ctx.chain)` → real RPC | Yes — real RPC call | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED for network-dependent checks (RPC calls, MEV relay HEAD requests require live connections). Static code-path analysis substituted above.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| scripts/preflight.ts does not import startMultiChainBot | `grep -n "startMultiChainBot" scripts/preflight.ts` | 0 matches | PASS |
| preflight.ts has no SKIP_PREFLIGHT escape hatch | `grep -n "SKIP_PREFLIGHT" src/preflight.ts` | 0 matches | PASS |
| bot.ts "Chain ID mismatch" block removed (now in preflight) | `grep -c "Chain ID mismatch" src/bot.ts` | 0 matches | PASS |
| CP3 is audit-only (no return) | `grep -n "intentionally fall through" src/bot.ts` | Lines 413 + 709 | PASS |
| 6 killswitch checkpoints present (3 V2 + 3 V3) | `grep -c "killswitch.cp" src/bot.ts` | 6 matches | PASS |
| apiKey never logged in scripts | `grep -E "log.*apiKey" scripts/pause.ts scripts/resume.ts` | 0 matches | PASS |

---

### Probe Execution

Step 7c: No probe scripts declared for Phase 20. SKIPPED.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| OPS-LIVE-01 | 20-02, 20-04 | `src/preflight.ts` called from `startMultiChainBot` before chain context loop | SATISFIED | `src/bot.ts:966` `await preflight(preflightRegistry as any)`; `test/integration/preflightInvocation.test.ts` (live, 0 `it.skip`) |
| OPS-LIVE-02 | 20-02, 20-04 | Wallet balance pre-flight FATAL; D-BALANCE-FLOOR formula; mid-run re-check every MID_RUN_CHECK_INTERVAL_SEC | SATISFIED | `checkWalletBalance` in preflight.ts uses `snipeAmount × maxOpenPositions + gasBuffer`; `src/bot.ts:1016` mid-run setInterval |
| OPS-LIVE-03 | 20-02 | RPC health: chainId match + block-age tolerance | SATISFIED | `checkRpcChainId` + `checkRpcBlockAge` in preflight.ts; unit tests live |
| OPS-LIVE-04 | 20-02 | MEV connectivity pre-flight (Flashbots ETH, bloXroute BSC, passthrough others) | SATISFIED | `checkMevHealth` in preflight.ts; unit tests live |
| OPS-LIVE-05 | 20-02 | HoneypotChecker getCode pre-flight | SATISFIED | `checkHoneypotCheckerCode` in preflight.ts; unit tests live |
| OPS-LIVE-06 | 20-01, 20-02 | Stale-data warnings at startup (D-STALE-THRESHOLDS: 2min warn / 10min error) | SATISFIED | `checkStaleData` in preflight.ts; `STALE_WARN_SEC`/`STALE_ERROR_SEC` in config.ts; REQUIREMENTS.md OPS-LIVE-06 row reflects D-STALE-THRESHOLDS |
| OPS-LIVE-07 | 20-02, 20-03 | Cross-variable env validation (MEV/Telegram/anti-rug live-gate) | SATISFIED | `validateCrossEnvRules()` + `checkAntiRugLiveGate()` in preflight.ts; `setAntirugDryRunStarted` in detector.ts |
| OPS-LIVE-08 | 20-04 | Multi-stage kill-switch at 3 checkpoints per V2 + V3 path | SATISFIED | CP1/CP2/CP3 × V2/V3 in bot.ts (6 checkpoints); integration tests live |
| OPS-LIVE-09 | 20-01, 20-04, 20-05, 20-06 | SQLite-persisted pause state; dashboard read/write endpoints; WS broadcast | SATISFIED | `pause_state` table in db.ts; controls.ts POST/GET /pause, POST /resume; PauseBanner.tsx; `test/integration/pauseFlow.test.ts` live |
| OPS-LIVE-10 | 20-05 | `npm run preflight` script — all checks, non-zero on FATAL, no bot start | SATISFIED | `scripts/preflight.ts` + `package.json` entry; integration test live |
| OPS-LIVE-11 | 20-05 | `npm run pause`/`npm run resume` — DASHBOARD_API_KEY from .env; login + action | SATISFIED | `scripts/pause.ts` + `scripts/resume.ts`; two-step flow; T-20-05 (no apiKey in logs) verified |
| OPS-LIVE-12 | 20-07 | `GOING-LIVE.md` moved to `docs/operations/going-live.md`; README linked; CI guard | SATISFIED | Root file absent; `docs/operations/going-live.md` exists with 547 LOC; CI guard present; `test/unit/ci/rootFileGuard.test.ts` live |
| OPS-LIVE-13 | 20-07 | `HONEYPOT-SIM-BRIEFING.md` moved or deleted with documented disposition | SATISFIED | Root file absent; SUMMARY-07 documents: "deleted per D-BRIEFING-DELETE; content preserved in `.planning/phases/18-honeypot-detection-rebuild/18-CONTEXT.md`"; CI guard enforces no re-introduction |

**Note on REQUIREMENTS.md traceability table:** The traceability table at the bottom of REQUIREMENTS.md still shows all OPS-LIVE-01..13 as "Pending". This is a documentation state, not a code state — the implementations exist and are verified above. The table was not updated during Phase 20 execution. This is a minor tracking gap, not a code gap.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | No TBD/FIXME/XXX debt markers in Phase 20 modified files | — | — |

Scanned: `src/preflight.ts`, `src/bot.ts`, `src/api/routes/controls.ts`, `scripts/preflight.ts`, `scripts/pause.ts`, `scripts/resume.ts`, `dashboard/src/components/PauseBanner.tsx` — all clean.

---

### Human Verification Required

The automated verification above establishes that all code paths, wiring, and static behaviors are correctly implemented. The following items require a live bot + dashboard to confirm the complete operator experience:

### 1. npm run preflight smoke test (OPS-LIVE-10)

**Test:** Run `npm run preflight` from a fresh terminal against a funded wallet with a valid `.env`
**Expected:** Script prints per-chain pass/fail output (7 checks per enabled chain + cross-env rules), exits 0 on all-pass or 1 on any FATAL. No `Starting multi-chain bot` log line appears. No `bot.ts` module is loaded.
**Why human:** End-to-end subprocess execution requires a live RPC connection and funded wallet. Automated tests mock the RPC; real network path could differ.

### 2. Dashboard pause banner visual + WS event (OPS-LIVE-09)

**Test:** Run `npm run pause -- --reason 'verification smoke test'` while the dashboard is open in a browser.
**Expected:** Red full-bleed "BOT PAUSED — since... by cli. verification smoke test" banner appears immediately (WS push). Clicking Resume causes banner to disappear (WS push). Dashboard pause banner survives page navigation (Layout-level mount).
**Why human:** Visual appearance and real-time WS event delivery cannot be verified programmatically. Source-grep tests verify the implementation; runtime behavior requires a browser.

### 3. Multi-stage kill-switch timing under real MEV load (OPS-LIVE-08)

**Test:** While the bot is watching a live chain, press pause via dashboard while a snipe is being evaluated. Observe pino logs.
**Expected:** On the next `PairCreated` event after pause: `op: killswitch.cp1` appears in logs, `sendTxWithRetry` is never called for that event. If pause is pressed mid-event (between safety bank and bundle build): `op: killswitch.cp2` catches it.
**Why human:** The timing between pause press and event processing depends on live network event delivery. The automated integration tests use controlled fake-timers and mocked pairs, not live chain events.

### 4. D-PAUSED-RESTART full positive observable (OPS-LIVE-09)

**Test:** Seed `pause_state.paused=1` in `data/bot.db`, restart the bot, verify:
  (a) chain listeners attach (WebSocket connects, `PairCreated` events handled)
  (b) dashboard is reachable (HTTP GET returns 200)
  (c) exit monitors running for any open positions (pino log shows exit monitor polling)
  (d) first new `PairCreated` event triggers `op: killswitch.cp1` log and returns early
  (e) `sendTxWithRetry` never called during the paused session
**Expected:** Bot is fully operational (monitoring + dashboard + exit) but buys are blocked at CP1.
**Why human:** The integration test in `pauseFlow.test.ts` mocks chain context creation and WS provider. The full observable chain (real WS subscription + real dashboard HTTP + real exit monitor polling + real CP1 catch) requires a live bot instance.

---

### Gaps Summary

No code gaps found. All 13 OPS-LIVE requirements have verified implementation artifacts, correct wiring, and active (non-skipped) tests.

The REQUIREMENTS.md traceability table retains "Pending" status for all OPS-LIVE rows — this is a tracking document issue, not a code gap. It does not affect runtime behavior or phase goal achievement.

The 4 human verification items above are behavioral/visual checks that require a live bot + browser session. All automated-verifiable aspects PASS.

---

_Verified: 2026-05-24_
_Verifier: Claude (gsd-verifier)_
