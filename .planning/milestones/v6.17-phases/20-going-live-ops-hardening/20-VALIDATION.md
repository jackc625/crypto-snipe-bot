---
phase: 20
slug: going-live-ops-hardening
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-24
revised: 2026-05-26
validated: 2026-05-26
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.1 (projects: unit, integration, fork) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --project unit` |
| **Full suite command** | `npx vitest run` |
| **Phase-20 subset runtime** | ~35s (unit ~5s + integration ~30s), measured 2026-05-26 |
| **Estimated full-suite runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project unit`
- **After every plan wave:** Run `npx vitest run` (all projects)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

*Populated during plan-phase. Each task references a specific test file + observable effect per Phase 17 D-04 (no `expect(true).toBe(true)` fillers — every test asserts a concrete observable: process.exit code, pino log line, SQLite row written, Telegram alert sent). Status column reconciled against verified reality 2026-05-26: all 17 test files exist and run green (131 tests, 0 skipped); the 4 manual-typed rows pass their automated grep/tsc gates.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 20-00-Task1 | 00 | 0 | OPS-LIVE-02/03/04/05/06/07/09 | T-20-W0-01 | 8 unit-test stub files created under test/unit/preflight/ + test/unit/db/ with it.skip blocks naming concrete observables (process.exit, pino log fields, SQLite row, FATAL/PASS reasons) | unit | `npx vitest run --project unit test/unit/preflight/ test/unit/db/pauseStateMigration.test.ts` | ✅ | ✅ green |
| 20-00-Task2 | 00 | 0 | OPS-LIVE-01/02/08/09/10/11 | T-20-W0-01 | 6 integration-test stub files created under test/integration/ with it.skip blocks naming concrete observables (op field, broadcast events, sendTxWithRetry spy assertions, exit codes); includes D-PAUSED-RESTART stub | integration | `npx vitest run --project integration test/integration/preflightInvocation.test.ts test/integration/killswitchCheckpoints.test.ts test/integration/pauseFlow.test.ts test/integration/preflightCli.test.ts test/integration/pauseCli.test.ts test/integration/midRunWalletCheck.test.ts` | ✅ | ✅ green |
| 20-01-Task1 | 01 | 1 | OPS-LIVE-09 | T-20-01, T-20-W1-01 | Schema v5→v6 atomic migration ships; pause_state table + antirug_dry_run_started column created idempotently; 5 prepared statements exported; `db.pragma('user_version')` returns 6 | unit | `npx vitest run --project unit test/unit/db/pauseStateMigration.test.ts` | ✅ | ✅ green |
| 20-01-Task2 | 01 | 1 | OPS-LIVE-02, OPS-LIVE-06 | T-20-W1-03 | REQUIREMENTS.md OPS-LIVE-02 line reflects `snipeAmount × maxOpenPositions + <CHAIN>_GAS_BUFFER`; OPS-LIVE-06 line reflects STALE_WARN_SEC/STALE_ERROR_SEC (not 2× poll interval) | manual | `grep -E "OPS-LIVE-02.*snipeAmount × maxOpenPositions" .planning/REQUIREMENTS.md && grep -E "OPS-LIVE-06.*STALE_WARN_SEC" .planning/REQUIREMENTS.md` | n/a | ✅ green (grep) |
| 20-02-Task1 | 02 | 2 | OPS-LIVE-02/03/04/05/06/07 | T-PRE-01, T-PRE-02, T-PRE-03, T-20-W2-02 | preflight.ts dual-shape API (preflight FATAL + preflightDryRun no-exit); 7 check fns + checkStaleData + checkWalletBalance exported; no SKIP_PREFLIGHT escape hatch; 31+ unit tests assert pino fatal fields + process.exit + remediation pointer | unit | `npx vitest run --project unit test/unit/preflight/` | ✅ | ✅ green |
| 20-02-Task2 | 02 | 2 | OPS-LIVE-02, OPS-LIVE-03 | T-PRE-02 | chainRegistry.ts adds gasBuffer + blockAgeToleranceSec fields with env overlay + per-chain template defaults; config.ts adds 12 new env entries; .env.example documents all new envs per D-ENV-EXAMPLE | unit | `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.bot.json && grep -c "ETH_GAS_BUFFER" .env.example && grep -c "defaultGasBuffer" src/chainRegistry.ts && grep -c "STALE_WARN_SEC" src/config.ts` | n/a | ✅ green (tsc+grep) |
| 20-03-Task1 | 03 | 3 | OPS-LIVE-07 | T-20-W3-01, T-20-W3-02 | detector.ts records antirug_dry_run_started timestamp idempotently on first start per chain; COALESCE-UPSERT preserves first timestamp across restarts; 4/4 unit tests assert first-call records + re-call no-op + cross-chain isolation + fake-timer day-skip | unit | `npx vitest run --project unit test/unit/anti-rug/dryRunTimestamp.test.ts` | ✅ | ✅ green |
| 20-04-Task1 | 04 | 3 | OPS-LIVE-01, OPS-LIVE-02 | T-PRE-01, T-20-04 | bot.ts wires `await preflight(registry)` at line 880; chainId block removed; mid-run wallet setInterval with T-20-04 idempotent guard fires setPauseState + broadcast + sendCtxAlert exactly once per undercut-transition (inside the guard); 7+ integration tests assert observable effects | integration | `npx vitest run --project integration test/integration/preflightInvocation.test.ts test/integration/midRunWalletCheck.test.ts` | ✅ | ✅ green |
| 20-04-Task2a | 04 | 3 | OPS-LIVE-08 | T-PAUSE-01, T-PAUSE-03, T-KILL-CP3 | V2 CP1/CP2/CP3 inserted at bot.ts lines ~346/~363-364/~378; CP1 + CP2 return early on paused=1; CP3 logs only (audit-only); 4+ V2 integration tests assert pino op field + sendTxWithRetry spy + insertTrade fall-through | integration | `npx vitest run --project integration test/integration/killswitchCheckpoints.test.ts` | ✅ | ✅ green |
| 20-04-Task2b | 04 | 3 | OPS-LIVE-08 | T-PAUSE-01, T-PAUSE-03, T-KILL-CP3 | V3 CP1/CP2/CP3 inserted at bot.ts lines ~600/~638-639/~647 with feeTier in log fields; CP1 + CP2 return early on paused=1; CP3 logs only (audit-only); 4+ V3 integration tests assert pino op field + V3 router spies + feeTier present | integration | `npx vitest run --project integration test/integration/killswitchCheckpoints.test.ts` | ✅ | ✅ green |
| 20-04-Task3 | 04 | 3 | OPS-LIVE-09 | T-PAUSE-03 | D-PAUSED-RESTART positive observable: chain listeners start, dashboard reachable, exit monitors run, handleNewPairForChain CP1 fires, sendTxWithRetry never called when restarting with pause_state.paused=1 | integration | `npx vitest run --project integration test/integration/pauseFlow.test.ts` | ✅ | ✅ green |
| 20-05-Task1 | 05 | 4 | OPS-LIVE-09 | T-PAUSE-02, T-20-01 (extended), T-20-W6-03 | controls.ts adds POST /pause + POST /resume + GET /pause; reason sanitized to 200 chars + strip control chars; broadcast fires `pause_state_change` event; 8 pauseFlow integration tests assert SQLite write + broadcast spy + sanitization | integration | `npx vitest run --project integration test/integration/pauseFlow.test.ts` | ✅ | ✅ green |
| 20-05-Task2 | 05 | 4 | OPS-LIVE-10, OPS-LIVE-11 | T-20-05, T-ENV-01, T-20-W4-01 | scripts/preflight.ts wraps preflightDryRun (does NOT start bot); scripts/pause.ts + resume.ts use DASHBOARD_API_KEY login + cookie-forwarded action POST; T-20-05 enforces apiKey never inside a log call; 9 CLI integration tests assert exit codes + SQLite mutations + auth flow | integration | `npx vitest run --project integration test/integration/preflightCli.test.ts test/integration/pauseCli.test.ts` | ✅ | ✅ green |
| 20-06-Task1 | 06 | 4 | OPS-LIVE-09 | T-20-W6-01, T-20-W6-02, T-20-W6-03 | Operator sees a full-bleed red banner above main content on every dashboard page when pause_state.paused=true; banner disappears after resume via WS pause_state_change event; Resume button POSTs /api/controls/resume; 6 component tests assert render-on-paused + null-on-unpaused + ts format + Resume click + card-idiom classes (restyled from full-bleed to card per gap plan 20-10) | unit | `npx vitest run --project unit test/unit/dashboard/pauseBanner.test.ts` | ✅ | ✅ green |
| 20-07-Task1 | 07 | 5 | OPS-LIVE-12, OPS-LIVE-13 | T-DEL-01, T-20-W7-02, T-20-W7-03 | GOING-LIVE.md moved via git mv to docs/operations/going-live.md (history preserved); HONEYPOT-SIM-BRIEFING.md deleted via git rm; README links updated; CI guard step added to .github/workflows/test.yml between .todo ban and tsc | manual | `test ! -f GOING-LIVE.md && test ! -f HONEYPOT-SIM-BRIEFING.md && test -f docs/operations/going-live.md && grep -c "docs/operations/going-live.md" README.md && grep -c "Ban root-level operator-facing docs" .github/workflows/test.yml` | n/a | ✅ green (fs+grep) |
| 20-07-Task2 | 07 | 5 | OPS-LIVE-12 | T-20-W7-04 | docs/operations/going-live.md has all 5 D-OPERATOR-HANDOFF sections appended: preflight failure modes, pause/resume CLI usage, mid-run wallet undercut recovery, anti-rug live-gate flip procedure, RPC/MEV/checker validation troubleshooting | manual | `grep -cE "^## (Preflight failure modes|Pause/resume CLI usage|Mid-run wallet undercut recovery|Anti-rug live-gate flip procedure|RPC/MEV/checker validation troubleshooting)" docs/operations/going-live.md` returns 5 | n/a | ✅ green (grep=5) |
| 20-07-Task3 | 07 | 5 | OPS-LIVE-12 | T-20-W7-01 | CI guard YAML content self-test: vitest reads .github/workflows/test.yml and asserts step named "Ban root-level operator-facing docs" exists with `test ! -e GOING-LIVE.md` AND `test ! -e HONEYPOT-SIM-BRIEFING.md` in its `run:` block; step lives early in workflow (positionally before later steps to fail fast) | unit | `npx vitest run --project unit test/unit/ci/rootFileGuard.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 (Plan 20-00) creates test stub files using `it.skip('reason: pending impl in plan 20-XX — asserts {observable}', () => { /* impl */ })`. Each subsequent plan flips the relevant stubs to live `it(...)` blocks with real assertions. File names below match Plan 20-00's `files_modified` frontmatter verbatim. **All stubs verified flipped to live `it(...)` blocks — 0 `it.skip`/`it.todo` remain across phase-20 test files (2026-05-26).**

**Unit test stubs (Plan 20-00 Task 1 → `test/unit/preflight/` + `test/unit/db/`):**
- [x] `test/unit/preflight/walletBalance.test.ts` — OPS-LIVE-02 (flipped live)
- [x] `test/unit/preflight/rpcHealth.test.ts` — OPS-LIVE-03 (flipped live)
- [x] `test/unit/preflight/mevHealth.test.ts` — OPS-LIVE-04 (flipped live)
- [x] `test/unit/preflight/honeypotCheckerCode.test.ts` — OPS-LIVE-05 (flipped live)
- [x] `test/unit/preflight/crossEnvRules.test.ts` — OPS-LIVE-07 (flipped live; +Rule 5 DASHBOARD_API_KEY from gap plan 20-08)
- [x] `test/unit/preflight/staleData.test.ts` — OPS-LIVE-06 (flipped live)
- [x] `test/unit/preflight/antiRugLiveGate.test.ts` — OPS-LIVE-07 (flipped live; D-ANTIRUG-LIVE-GATE-CODE 7-day floor)
- [x] `test/unit/db/pauseStateMigration.test.ts` — schema v5→v6 (flipped live)

**Integration test stubs (Plan 20-00 Task 2 → `test/integration/`):**
- [x] `test/integration/preflightInvocation.test.ts` — OPS-LIVE-01 (flipped live)
- [x] `test/integration/killswitchCheckpoints.test.ts` — OPS-LIVE-08 CP1/CP2/CP3 × V2/V3 + cross-cutting (flipped live)
- [x] `test/integration/pauseFlow.test.ts` — OPS-LIVE-09 restart-survival + D-PAUSED-RESTART positive observable (flipped live; Plan 20-04 Task 3 flipped the restart-positive stub)
- [x] `test/integration/preflightCli.test.ts` — OPS-LIVE-10 (flipped live)
- [x] `test/integration/pauseCli.test.ts` — OPS-LIVE-11 (flipped live)
- [x] `test/integration/midRunWalletCheck.test.ts` — OPS-LIVE-02 mid-run path + T-20-04 idempotence (flipped live)

**Wave-0 infrastructure invariants:**
- [x] No new framework install — vitest projects already wired (Phase 17/18/19)
- [x] Zero `it.todo(...)` / `test.todo(...)` / `describe.todo(...)` (preserves Phase 17 D-09 CI ban at `.github/workflows/test.yml:30-32`) — verified 0 occurrences 2026-05-26
- [x] Zero `expect(true).toBe(true)` hollow filler (D-04 observable-effect rigor)
- [x] Every it.skip reason string named a concrete observable noun (process.exit, pino, SQLite, log, FATAL, PASS, broadcast, alert, etc.) — all now flipped to live assertions

*Test file paths above are the canonical targets from CONTEXT.md §test infrastructure context + RESEARCH.md §Validation Architecture, verified against Plan 20-00 `files_modified` frontmatter. The Per-Task Verification Map above lists each task that flips a stub to live + its observable contract.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Status |
|----------|-------------|------------|-------------------|--------|
| `docs/operations/going-live.md` content quality + completeness | OPS-LIVE-12 | Doc quality requires human review | Read final doc end-to-end; verify preflight failure modes / pause-CLI / mid-run undercut / anti-rug live-flip / RPC-MEV-checker troubleshooting all present per D-OPERATOR-HANDOFF | ✅ verified (20-VERIFICATION.md; 5/5 sections present) |
| Dashboard pause banner visual prominence | OPS-LIVE-09 (D-PAUSE-UI) | Visual perception requires human review | Boot bot with `pause_state.paused=1` seed → load dashboard → confirm red banner with `BOT PAUSED — since {ts} by {by}. {reason}` + Resume button visible | ✅ operator UAT PASSED 2026-05-26 (20-HUMAN-UAT.md Test 2 retest; card-idiom banner per gap plan 20-10) |
| Anti-rug FP review (0 confirmed FPs) | OPS-LIVE-01 cross-link (D-ANTIRUG-LIVE-GATE-CODE) | "0 confirmed FPs" is operator judgment, not mechanical (per Phase 19 D-LIVE-GATE) | Operator follows `docs/operations/anti-rug-rollout.md` review protocol; code only enforces 7-day floor | operator-owned (code enforces 7-day floor; antiRugLiveGate.test.ts green) |
| HONEYPOT-SIM-BRIEFING.md deletion is intentional and content preserved elsewhere | OPS-LIVE-13 | Single-file delete is a docs decision per D-BRIEFING-DELETE — content lives in Phase 18 18-CONTEXT.md and .planning/research/SUMMARY.md | Verify the file no longer exists at repo root + git log shows the deletion commit + CI guard prevents re-introduction | ✅ verified (file absent; rootFileGuard.test.ts enforces non-reintroduction) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (Per-Task Map populated)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (Wave 5 closed by 20-07-Task3 vitest CI guard self-test)
- [x] Wave 0 covers all MISSING references (17 stub files match Plan 20-00 frontmatter; all flipped to live)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated

---

## Validation Audit 2026-05-26

Post-execution audit (State A) by `/gsd:validate-phase 20`. The plan-time map (all rows `⬜ pending`, `wave_0_complete: false`) was reconciled against the executed, verified phase.

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

**Evidence gathered:**

| Check | Command | Result |
|-------|---------|--------|
| Phase-20 unit tests | `npx vitest run --project unit test/unit/preflight/ test/unit/db/pauseStateMigration.test.ts test/unit/anti-rug/dryRunTimestamp.test.ts test/unit/dashboard/pauseBanner.test.ts test/unit/ci/rootFileGuard.test.ts` | 11 files / 85 tests passed, 0 skipped |
| Phase-20 integration tests | `npx vitest run --project integration {6 files}` | 6 files / 46 tests passed, 0 skipped |
| Lingering skip/todo stubs | grep `\.(skip\|todo)` across phase-20 test files | 0 matches |
| Doc/config-check rows (20-01-T2, 20-07-T1, 20-07-T2) | fs + grep | all pass (going-live.md 5/5 sections, root files disposed, CI guard present) |
| tsc compile (20-02-T2) | `npx tsc --noEmit -p tsconfig.json && -p tsconfig.bot.json` | clean (both) |

**Reconciliation actions (doc-only, no code/test changes):**
- All 17 Per-Task rows: `⬜ pending` → `✅ green`; `File Exists` markers → `✅`.
- 20-06-Task1: corrected predicted filename `test/unit/dashboard/pauseBanner.test.tsx` → actual `test/unit/dashboard/pauseBanner.test.ts` (a `.tsx` would have been silently excluded by the unit project's `test/unit/**/*.test.ts` glob). Banner description updated to card-idiom (gap plan 20-10 restyle).
- Test Infrastructure: framework `vitest 1.x` → `vitest 4.1.1` (actual).
- Frontmatter: `status: ready` → `validated`; `wave_0_complete: false` → `true`; `revised` → 2026-05-26; added `validated: 2026-05-26`.
- Manual-Only table: added Status column reflecting 20-VERIFICATION.md + 20-HUMAN-UAT.md outcomes.

**Outcome:** Phase 20 is Nyquist-compliant. Every behavioral requirement has a green automated vitest test; every doc/config requirement has a passing automated grep/tsc gate; the 4 manual-only entries are genuine human-judgment items, all satisfied (3 verified, 1 operator-UAT-passed).
