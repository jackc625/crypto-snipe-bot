---
phase: 20
slug: going-live-ops-hardening
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-24
revised: 2026-05-24
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x (projects: unit, integration, fork) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --project unit` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project unit`
- **After every plan wave:** Run `npx vitest run` (all projects)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

*Populated during plan-phase. Each task references a specific test file + observable effect per Phase 17 D-04 (no `expect(true).toBe(true)` fillers — every test asserts a concrete observable: process.exit code, pino log line, SQLite row written, Telegram alert sent).*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 20-00-Task1 | 00 | 0 | OPS-LIVE-02/03/04/05/06/07/09 | T-20-W0-01 | 8 unit-test stub files created under test/unit/preflight/ + test/unit/db/ with it.skip blocks naming concrete observables (process.exit, pino log fields, SQLite row, FATAL/PASS reasons) | unit | `npx vitest run --project unit test/unit/preflight/ test/unit/db/pauseStateMigration.test.ts` | ❌ W0 | ⬜ pending |
| 20-00-Task2 | 00 | 0 | OPS-LIVE-01/02/08/09/10/11 | T-20-W0-01 | 6 integration-test stub files created under test/integration/ with it.skip blocks naming concrete observables (op field, broadcast events, sendTxWithRetry spy assertions, exit codes); includes D-PAUSED-RESTART stub | integration | `npx vitest run --project integration test/integration/preflightInvocation.test.ts test/integration/killswitchCheckpoints.test.ts test/integration/pauseFlow.test.ts test/integration/preflightCli.test.ts test/integration/pauseCli.test.ts test/integration/midRunWalletCheck.test.ts` | ❌ W0 | ⬜ pending |
| 20-01-Task1 | 01 | 1 | OPS-LIVE-09 | T-20-01, T-20-W1-01 | Schema v5→v6 atomic migration ships; pause_state table + antirug_dry_run_started column created idempotently; 5 prepared statements exported; `db.pragma('user_version')` returns 6 | unit | `npx vitest run --project unit test/unit/db/pauseStateMigration.test.ts` | ✅ W0 | ⬜ pending |
| 20-01-Task2 | 01 | 1 | OPS-LIVE-02, OPS-LIVE-06 | T-20-W1-03 | REQUIREMENTS.md OPS-LIVE-02 line reflects `snipeAmount × maxOpenPositions + <CHAIN>_GAS_BUFFER`; OPS-LIVE-06 line reflects STALE_WARN_SEC/STALE_ERROR_SEC (not 2× poll interval) | manual | `grep -E "OPS-LIVE-02.*snipeAmount × maxOpenPositions" .planning/REQUIREMENTS.md && grep -E "OPS-LIVE-06.*STALE_WARN_SEC" .planning/REQUIREMENTS.md` | n/a | ⬜ pending |
| 20-02-Task1 | 02 | 2 | OPS-LIVE-02/03/04/05/06/07 | T-PRE-01, T-PRE-02, T-PRE-03, T-20-W2-02 | preflight.ts dual-shape API (preflight FATAL + preflightDryRun no-exit); 7 check fns + checkStaleData + checkWalletBalance exported; no SKIP_PREFLIGHT escape hatch; 31+ unit tests assert pino fatal fields + process.exit + remediation pointer | unit | `npx vitest run --project unit test/unit/preflight/` | ✅ W0 | ⬜ pending |
| 20-02-Task2 | 02 | 2 | OPS-LIVE-02, OPS-LIVE-03 | T-PRE-02 | chainRegistry.ts adds gasBuffer + blockAgeToleranceSec fields with env overlay + per-chain template defaults; config.ts adds 12 new env entries; .env.example documents all new envs per D-ENV-EXAMPLE | unit | `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.bot.json && grep -c "ETH_GAS_BUFFER" .env.example && grep -c "defaultGasBuffer" src/chainRegistry.ts && grep -c "STALE_WARN_SEC" src/config.ts` | n/a | ⬜ pending |
| 20-03-Task1 | 03 | 3 | OPS-LIVE-07 | T-20-W3-01, T-20-W3-02 | detector.ts records antirug_dry_run_started timestamp idempotently on first start per chain; COALESCE-UPSERT preserves first timestamp across restarts; 4/4 unit tests assert first-call records + re-call no-op + cross-chain isolation + fake-timer day-skip | unit | `npx vitest run --project unit test/unit/anti-rug/dryRunTimestamp.test.ts` | ❌ W0 | ⬜ pending |
| 20-04-Task1 | 04 | 3 | OPS-LIVE-01, OPS-LIVE-02 | T-PRE-01, T-20-04 | bot.ts wires `await preflight(registry)` at line 880; chainId block removed; mid-run wallet setInterval with T-20-04 idempotent guard fires setPauseState + broadcast + sendCtxAlert exactly once per undercut-transition (inside the guard); 7+ integration tests assert observable effects | integration | `npx vitest run --project integration test/integration/preflightInvocation.test.ts test/integration/midRunWalletCheck.test.ts` | ✅ W0 | ⬜ pending |
| 20-04-Task2a | 04 | 3 | OPS-LIVE-08 | T-PAUSE-01, T-PAUSE-03, T-KILL-CP3 | V2 CP1/CP2/CP3 inserted at bot.ts lines ~346/~363-364/~378; CP1 + CP2 return early on paused=1; CP3 logs only (audit-only); 4+ V2 integration tests assert pino op field + sendTxWithRetry spy + insertTrade fall-through | integration | `npx vitest run --project integration test/integration/killswitchCheckpoints.test.ts` | ✅ W0 | ⬜ pending |
| 20-04-Task2b | 04 | 3 | OPS-LIVE-08 | T-PAUSE-01, T-PAUSE-03, T-KILL-CP3 | V3 CP1/CP2/CP3 inserted at bot.ts lines ~600/~638-639/~647 with feeTier in log fields; CP1 + CP2 return early on paused=1; CP3 logs only (audit-only); 4+ V3 integration tests assert pino op field + V3 router spies + feeTier present | integration | `npx vitest run --project integration test/integration/killswitchCheckpoints.test.ts` | ✅ W0 | ⬜ pending |
| 20-04-Task3 | 04 | 3 | OPS-LIVE-09 | T-PAUSE-03 | D-PAUSED-RESTART positive observable: chain listeners start, dashboard reachable, exit monitors run, handleNewPairForChain CP1 fires, sendTxWithRetry never called when restarting with pause_state.paused=1 | integration | `npx vitest run --project integration test/integration/pauseFlow.test.ts` | ✅ W0 (D-PAUSED-RESTART stub added to pauseFlow.test.ts in 20-00 Task 2) | ⬜ pending |
| 20-05-Task1 | 05 | 4 | OPS-LIVE-09 | T-PAUSE-02, T-20-01 (extended), T-20-W6-03 | controls.ts adds POST /pause + POST /resume + GET /pause; reason sanitized to 200 chars + strip control chars; broadcast fires `pause_state_change` event; 8 pauseFlow integration tests assert SQLite write + broadcast spy + sanitization | integration | `npx vitest run --project integration test/integration/pauseFlow.test.ts` | ✅ W0 | ⬜ pending |
| 20-05-Task2 | 05 | 4 | OPS-LIVE-10, OPS-LIVE-11 | T-20-05, T-ENV-01, T-20-W4-01 | scripts/preflight.ts wraps preflightDryRun (does NOT start bot); scripts/pause.ts + resume.ts use DASHBOARD_API_KEY login + cookie-forwarded action POST; T-20-05 enforces apiKey never inside a log call; 9 CLI integration tests assert exit codes + SQLite mutations + auth flow | integration | `npx vitest run --project integration test/integration/preflightCli.test.ts test/integration/pauseCli.test.ts` | ✅ W0 | ⬜ pending |
| 20-06-Task1 | 06 | 4 | OPS-LIVE-09 | T-20-W6-01, T-20-W6-02, T-20-W6-03 | Operator sees a full-bleed red banner above main content on every dashboard page when pause_state.paused=true; banner disappears after resume via WS pause_state_change event; Resume button POSTs /api/controls/resume; 6 component tests assert render-on-paused + null-on-unpaused + ts format + Resume click + full-bleed classes | unit | `npx vitest run --project unit test/unit/dashboard/pauseBanner.test.tsx` | ❌ (new file) | ⬜ pending |
| 20-07-Task1 | 07 | 5 | OPS-LIVE-12, OPS-LIVE-13 | T-DEL-01, T-20-W7-02, T-20-W7-03 | GOING-LIVE.md moved via git mv to docs/operations/going-live.md (history preserved); HONEYPOT-SIM-BRIEFING.md deleted via git rm; README links updated; CI guard step added to .github/workflows/test.yml between .todo ban and tsc | manual | `test ! -f GOING-LIVE.md && test ! -f HONEYPOT-SIM-BRIEFING.md && test -f docs/operations/going-live.md && grep -c "docs/operations/going-live.md" README.md && grep -c "Ban root-level operator-facing docs" .github/workflows/test.yml` | n/a | ⬜ pending |
| 20-07-Task2 | 07 | 5 | OPS-LIVE-12 | T-20-W7-04 | docs/operations/going-live.md has all 5 D-OPERATOR-HANDOFF sections appended: preflight failure modes, pause/resume CLI usage, mid-run wallet undercut recovery, anti-rug live-gate flip procedure, RPC/MEV/checker validation troubleshooting | manual | `grep -cE "^## (Preflight failure modes|Pause/resume CLI usage|Mid-run wallet undercut recovery|Anti-rug live-gate flip procedure|RPC/MEV/checker validation troubleshooting)" docs/operations/going-live.md` returns 5 | n/a | ⬜ pending |
| 20-07-Task3 | 07 | 5 | OPS-LIVE-12 | T-20-W7-01 | CI guard YAML content self-test: vitest reads .github/workflows/test.yml and asserts step named "Ban root-level operator-facing docs" exists with `test ! -e GOING-LIVE.md` AND `test ! -e HONEYPOT-SIM-BRIEFING.md` in its `run:` block; step lives early in workflow (positionally before later steps to fail fast) | unit | `npx vitest run --project unit test/unit/ci/rootFileGuard.test.ts` | ❌ (new file) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 (Plan 20-00) creates test stub files using `it.skip('reason: pending impl in plan 20-XX — asserts {observable}', () => { /* impl */ })`. Each subsequent plan flips the relevant stubs to live `it(...)` blocks with real assertions. File names below match Plan 20-00's `files_modified` frontmatter verbatim.

**Unit test stubs (Plan 20-00 Task 1 → `test/unit/preflight/` + `test/unit/db/`):**
- [ ] `test/unit/preflight/walletBalance.test.ts` — stubs for OPS-LIVE-02 (6 it.skip)
- [ ] `test/unit/preflight/rpcHealth.test.ts` — stubs for OPS-LIVE-03 (4 it.skip)
- [ ] `test/unit/preflight/mevHealth.test.ts` — stubs for OPS-LIVE-04 (4 it.skip)
- [ ] `test/unit/preflight/honeypotCheckerCode.test.ts` — stubs for OPS-LIVE-05 (3 it.skip)
- [ ] `test/unit/preflight/crossEnvRules.test.ts` — stubs for OPS-LIVE-07 (6 it.skip)
- [ ] `test/unit/preflight/staleData.test.ts` — stubs for OPS-LIVE-06 (4 it.skip)
- [ ] `test/unit/preflight/antiRugLiveGate.test.ts` — stubs for OPS-LIVE-07 (4 it.skip; D-ANTIRUG-LIVE-GATE-CODE 7-day floor)
- [ ] `test/unit/db/pauseStateMigration.test.ts` — stubs for schema v5→v6 (6 it.skip)

**Integration test stubs (Plan 20-00 Task 2 → `test/integration/`):**
- [ ] `test/integration/preflightInvocation.test.ts` — stubs for OPS-LIVE-01 (3 it.skip)
- [ ] `test/integration/killswitchCheckpoints.test.ts` — stubs for OPS-LIVE-08 CP1/CP2/CP3 × V2/V3 + cross-cutting (8+ it.skip)
- [ ] `test/integration/pauseFlow.test.ts` — stubs for OPS-LIVE-09 restart-survival + D-PAUSED-RESTART positive observable (4+ it.skip; Plan 20-04 Task 3 flips the restart-positive stub)
- [ ] `test/integration/preflightCli.test.ts` — stubs for OPS-LIVE-10 (4 it.skip)
- [ ] `test/integration/pauseCli.test.ts` — stubs for OPS-LIVE-11 (5 it.skip)
- [ ] `test/integration/midRunWalletCheck.test.ts` — stubs for OPS-LIVE-02 mid-run path + T-20-04 idempotence (4 it.skip)

**Wave-0 infrastructure invariants:**
- [ ] No new framework install — vitest projects already wired (Phase 17/18/19)
- [ ] Zero `it.todo(...)` / `test.todo(...)` / `describe.todo(...)` (preserves Phase 17 D-09 CI ban at `.github/workflows/test.yml:30-32`)
- [ ] Zero `expect(true).toBe(true)` hollow filler (D-04 observable-effect rigor)
- [ ] Every it.skip reason string names a concrete observable noun (process.exit, pino, SQLite, log, FATAL, PASS, broadcast, alert, etc.)

*Test file paths above are the canonical targets from CONTEXT.md §test infrastructure context + RESEARCH.md §Validation Architecture, verified against Plan 20-00 `files_modified` frontmatter. The Per-Task Verification Map above lists each task that flips a stub to live + its observable contract.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `docs/operations/going-live.md` content quality + completeness | OPS-LIVE-12 | Doc quality requires human review | Read final doc end-to-end; verify preflight failure modes / pause-CLI / mid-run undercut / anti-rug live-flip / RPC-MEV-checker troubleshooting all present per D-OPERATOR-HANDOFF |
| Dashboard pause banner visual prominence | OPS-LIVE-09 (D-PAUSE-UI) | Visual perception requires human review | Boot bot with `pause_state.paused=1` seed → load dashboard → confirm red banner with `BOT PAUSED — since {ts} by {by}. {reason}` + Resume button visible above the fold |
| Anti-rug FP review (0 confirmed FPs) | OPS-LIVE-01 cross-link (D-ANTIRUG-LIVE-GATE-CODE) | "0 confirmed FPs" is operator judgment, not mechanical (per Phase 19 D-LIVE-GATE) | Operator follows `docs/operations/anti-rug-rollout.md` review protocol; code only enforces 7-day floor |
| HONEYPOT-SIM-BRIEFING.md deletion is intentional and content preserved elsewhere | OPS-LIVE-13 | Single-file delete is a docs decision per D-BRIEFING-DELETE — content lives in Phase 18 18-CONTEXT.md and .planning/research/SUMMARY.md | Verify the file no longer exists at repo root + git log shows the deletion commit + CI guard prevents re-introduction |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (Per-Task Map populated)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (Wave 5 closed by 20-07-Task3 vitest CI guard self-test)
- [x] Wave 0 covers all MISSING references (14 stub files match Plan 20-00 frontmatter exactly)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
