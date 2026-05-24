---
phase: 20
slug: going-live-ops-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-24
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
| 20-XX-YY | XX | N | OPS-LIVE-NN | T-20-NN | {observable effect} | unit/integration | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/preflight/walletBalance.test.ts` — stubs for OPS-LIVE-02
- [ ] `test/unit/preflight/rpcHealth.test.ts` — stubs for OPS-LIVE-03
- [ ] `test/unit/preflight/mevConnectivity.test.ts` — stubs for OPS-LIVE-04
- [ ] `test/unit/preflight/checkerCode.test.ts` — stubs for OPS-LIVE-05
- [ ] `test/unit/preflight/crossEnvValidation.test.ts` — stubs for OPS-LIVE-07
- [ ] `test/integration/pauseFlow.test.ts` — stubs for OPS-LIVE-08/09/11
- [ ] `test/integration/midRunBalanceCheck.test.ts` — stubs for OPS-LIVE-10
- [ ] `test/integration/staleData.test.ts` — stubs for OPS-LIVE-06
- [ ] `test/integration/antiRugLiveGate.test.ts` — stubs for OPS-LIVE-01 (cross-rule)
- [ ] No new framework install — vitest projects already wired (Phase 17/18/19)

*Test file paths above are the canonical targets from CONTEXT.md §test infrastructure context + RESEARCH.md §Validation Architecture. Plan-phase populates the per-task rows.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `docs/operations/going-live.md` content quality + completeness | OPS-LIVE-12 | Doc quality requires human review | Read final doc end-to-end; verify preflight failure modes / pause-CLI / mid-run undercut / anti-rug live-flip / RPC-MEV-checker troubleshooting all present per D-OPERATOR-HANDOFF |
| Dashboard pause banner visual prominence | OPS-LIVE-09 (D-PAUSE-UI) | Visual perception requires human review | Boot bot with `pause_state.paused=1` seed → load dashboard → confirm red banner with `BOT PAUSED — since {ts} by {by}. {reason}` + Resume button visible above the fold |
| Anti-rug FP review (0 confirmed FPs) | OPS-LIVE-01 cross-link (D-ANTIRUG-LIVE-GATE-CODE) | "0 confirmed FPs" is operator judgment, not mechanical (per Phase 19 D-LIVE-GATE) | Operator follows `docs/operations/anti-rug-rollout.md` review protocol; code only enforces 7-day floor |
| `HONEYPOT-SIM-BRIEFING.md` deletion is intentional | OPS-LIVE-13 | Single-file delete commit review | Git log confirms commit removes file alongside `GOING-LIVE.md` move; CI guard prevents re-introduction |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
