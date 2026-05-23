---
phase: 19
slug: anti-rug-runtime-monitoring
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source-of-truth coverage lives in `19-RESEARCH.md` §"Validation Architecture".
> Planner fills the Per-Task Verification Map after PLAN.md files are generated.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x (projects: unit / integration / fork) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm run test:all` |
| **Estimated runtime** | ~90 seconds full / ~15 seconds unit |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit`
- **After every plan wave:** Run `npm run test:integration && npm run test:fork`
- **Before `/gsd:verify-work`:** Full suite (`npm run test:all`) must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | ❌ W0 | ⬜ pending |

*Planner populates rows from PLAN.md acceptance_criteria during plan-phase. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/fixtures/contracts/RugPull.sol` — contrived V2 + V3 rug contract (CONTEXT.md D-LIST-FIXTURE)
- [ ] `test/fork/fixtures/rugs/horse-v2.json` — real V2 mainnet rug fixture (HORSE token, block 18401609 per 19-RESEARCH.md §10)
- [ ] `test/unit/anti-rug/__fixtures__/` — multi-signal evaluation table fixtures
- [ ] `test/integration/anti-rug/__fixtures__/` — fake WSProvider for reconnect/backfill drills
- [ ] `lp_baseline` schema migration v4→v5 stubs for in-memory better-sqlite3 test DB

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `.env.example` updated with all 7 new env vars per chain | D-ENV-EXAMPLE [USER-BINDING] | Visual diff against canonical list | `grep -c "ANTIRUG" .env.example` and inspect inline comments |
| `docs/operations/anti-rug-rollout.md` covers .env / restart / per-chain verify / circuit-breaker reset / WS-disconnect troubleshooting | D-OPERATOR-HANDOFF [USER-BINDING] | Operator-readable prose | Operator reads document end-to-end before phase close |
| Real-mainnet HORSE rug fixture replay produces expected multi-signal verdict on fork | ANTIRUG-08 (V2 success-criterion 1) | Fork-test requires Alchemy API key + ETH archive RPC | `npm run test:fork -- horse-rug` |
| Dashboard "Anti-Rug" column renders state badges correctly | D-VIS-PER-POSITION | Visual UI verification | Operator clicks each badge state in dev dashboard |
| Dashboard circuit-breaker banner red + reset modal flow | D-VIS-CB-TRIPPED | Visual UI + interaction | Operator triggers test CB, confirms banner, opens modal, confirms reset |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (RugPull.sol contract + horse-v2.json fixture)
- [ ] No watch-mode flags in scripts
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter after planner populates verification map

**Approval:** pending
