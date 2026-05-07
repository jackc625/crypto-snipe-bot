---
phase: 17
slug: tech-debt-cleanup-audit-baseline
status: complete
nyquist_compliant: partial
harm_prevention: inline
wave_0_complete: true
created: 2026-05-06
reconstructed_from: [17-CONTEXT.md, 17-01-SUMMARY.md, 17-02-SUMMARY.md, 17-03-SUMMARY.md, 17-VERIFICATION.md, 17-REVIEW-FIX.md]
---

# Phase 17 — Validation Strategy

> Phase 17 IS the retroactive Nyquist validation phase itself. Its requirements
> (DEBT-01..06) are validated through CI invariant guards rather than per-task
> behavioral assertions. Per CONTEXT.md Claude's-Discretion line 146-149, the CI
> guards themselves count as Phase 17's harm-prevention surface.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` (3 projects: unit, integration, fork) |
| **Quick run command** | `npx vitest run --project unit` |
| **Full suite command** | `npx vitest run --project unit --project integration` |
| **CI workflow** | `.github/workflows/test.yml` — runs `test:unit` + `test:integration` + `.todo` ban + `tsc --noEmit` × 3 |
| **Suite size at phase close** | 351/351 passing (32 test files) |
| **Estimated runtime** | ~4 seconds (unit + integration) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run --project unit` (~2s)
- **After every plan wave:** `npx vitest run --project unit --project integration` (~4s)
- **Before merge:** `.github/workflows/test.yml` runs the full suite + `.todo` ban + tsc × 3
- **Max feedback latency:** ~4 seconds (full suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Verification Surface | Status |
|---------|------|------|-------------|-----------------|----------------------|--------|
| 17-01-01 | 01 | 0 | DEBT-01, DEBT-02 | Wave-0 CI commands captured fresh; literal stdout committed as ground truth | Re-run `find test/ -name '*.todo*'`, `grep -rEn '\.todo\(' test/`, `npx tsc --noEmit -p tsconfig.json/tsconfig.bot.json/dashboard/tsconfig.json` against `.planning/milestones/v6.17-debt-baseline.md:20+` (literal stdout block) | ✅ green |
| 17-01-02 | 01 | 0 | DEBT-03, DEBT-04 | Branch A close-out (verified-empty) for both `.todo` and tsc errors | `.planning/milestones/v6.17-debt-baseline.md:110-118` Branch A section (closed against disputed v6.16 audit claims of 37 .todo + 6 TS errors) | ✅ green |
| 17-02-01 | 02 | 1 | DEBT-05 | Phase 1 FIX-01 sell-lock prevents double-sell race; FIX-04 verifiably excluded | `npx vitest run test/integration/exitMonitor.test.ts -t "Phase 1 harm-prevention"` — 2 `it` blocks at lines 626+ | ✅ green |
| 17-02-02 | 02 | 1 | DEBT-05 | Phase 2 ethers v6 inline-doc augmentation (architectural / type-system property) | `grep -c "^## Harm-Prevention Assertion (Phase 17 / DEBT-05)$" .planning/phases/02-ethers-v6-migration/02-VALIDATION.md` returns 1 | ✅ green |
| 17-02-03 | 02 | 1 | DEBT-05 | Phase 3 SQLite atomicity rolls back atomically on transaction failure | `npx vitest run test/unit/db.test.ts -t "Phase 3 harm-prevention"` — `it` at line 685 asserts post-failure SELECT COUNT(*) = 0 | ✅ green |
| 17-02-04 | 02 | 1 | DEBT-05 | Phase 5 V3-02 waitForLiquidity drops snipe on Mint timeout; V3-03 verifiably excluded | `npx vitest run test/integration/v3LiquidityWait.test.ts` — `it` at line 82 asserts return false + structured pino info log + pool.on('Mint', ...) registered | ✅ green |
| 17-02-05 | 02 | 1 | DEBT-05 | Phase 6 RISK daily-loss gate blocks snipe with structured pino warn | `npx vitest run test/unit/riskManager.test.ts -t "Phase 6 harm-prevention"` — `it` at line 136 asserts canSnipe returns `{allowed: false, reason: 'daily_loss_limit'}` AND log.warn called with structured payload | ✅ green |
| 17-02-06 | 02 | 1 | DEBT-05 | Phase 7 EXIT-01 stop-loss → executeFullSell call-shape contract (downgraded from "harm-prevention" by WR-01) | `npx vitest run test/unit/exitEngineSell.test.ts -t "Phase 7 EXIT-01"` — `it` at line 269 asserts return true + sendTxWithRetry called + insertTrade(action='sell'). **WR-01 caveat:** does NOT exercise `pollExitStrategy:747-760` threshold-decision wiring | ⚠️ partial |
| 17-02-07 | 02 | 1 | DEBT-05 | Phase 8 DASH/MON /health emits version from package.json (dynamic equality) | `npx vitest run test/integration/api/health.test.ts -t "Phase 8 harm-prevention"` — `it` at line 144 asserts `body.version === pkg.version` | ✅ green |
| 17-02-08 | 02 | 1 | DEBT-05 | Phase 9 testing-infrastructure inline-doc augmentation (meta / CI-honesty property) | `grep -c "^## Harm-Prevention Assertion (Phase 17 / DEBT-05)$" .planning/phases/09-testing-infrastructure/09-VALIDATION.md` returns 1 | ✅ green |
| 17-02-09 | 02 | 1 | DEBT-05 | Phase 10 partial-sell row insertion records non-null amountOut from decodeReceipt (downgraded from "harm-prevention" by WR-02) | `npx vitest run test/unit/exitEngineSell.test.ts -t "Phase 10 partial-sell"` — `it` at line 326 asserts insertTrade(action='partial_sell') with non-null amountOut. **WR-02 caveat:** does NOT exercise `pollExitStrategy:697-717` trigger-path wiring | ⚠️ partial |
| 17-03-01 | 03 | 1 | DEBT-06 | Verify-then-act precursor: 5 pre-act checks confirm un-scouted v6.16 audit items (logger/notifier/retry working tree clean; latestBlock fixture corrected; no `getTradesByToken` callers; baseline ledger row present; no `console.log` in telegramListener.ts) | Re-run pre-act checks against `17-03-SUMMARY.md:91-159`. Pitfall #22 dependency-search guard documented. | ✅ green |
| 17-03-02 | 03 | 1 | DEBT-06 | `getTradesByToken` declaration removed from `src/utils/db.ts`; baseline ledger row flipped to `acted-on (commit 5280679)` | `grep -rn 'getTradesByToken' src/ dashboard/ test/ scripts/` returns 0 matches; `grep -n 'acted-on (this plan, commit' .planning/milestones/v6.17-debt-baseline.md` returns line 106 | ✅ green |
| 17-03-03 | 03 | 1 | DEBT-01..06 (lock) | CI invariant guards lock the v6.17 baseline as evergreen: any future PR adding `.todo` invocation OR TS error fails build | `grep -nE 'Ban \.todo test stubs\|TypeScript check' .github/workflows/test.yml` returns 1 ban + 3 tsc-check matches at lines 20, 34, 36, 38 | ✅ green |

*Status: ⬜ pending · ✅ green · ⚠️ partial (WR caveat documented) · ❌ red · 🚩 flaky*

---

## Harm-Prevention Assertion (Phase 17 / DEBT category — self-referential)

**Form:** INLINE DOC (per CONTEXT.md Claude's-Discretion line 146-149). Phase 17 IS the retroactive validation phase; its harm-prevention surface is the CI invariant lock — not a per-task behavioral assertion.

**Harm scenario:** The v6.17 wave-0 baseline (0 `.todo` invocations, tsc-clean × 3 tsconfig variants, no `getTradesByToken` reference) regresses silently in a future PR — turning the audited "verified-empty" baseline back into "verified-disputed" without anyone noticing.

**Evidence (the harm-prevention surface itself):**
- `.github/workflows/test.yml:20-31` — `Ban .todo test stubs` step (`it.todo` / `test.todo` / `describe.todo` grep). Any match fails CI.
- `.github/workflows/test.yml:34-38` — `TypeScript check` × 3 (root, bot, dashboard). Any TS error fails CI.
- `.github/workflows/test.yml:18-19` — `npm run test:unit` + `npm run test:integration` propagate vitest exit codes (Phase 9 testing-infra contract; pino-structured 351/351 baseline).
- `.planning/milestones/v6.17-debt-baseline.md` — re-runnable CI artifact: literal stdout of all 4 wave-0 commands committed verbatim. Operator can re-execute any command and compare against committed evidence.

**Cross-references:**
- `.planning/milestones/v6.17-debt-baseline.md:96-106` — 11-row per-claim ledger closing v6.16-MILESTONE-AUDIT.md `tech_debt:` items (verbatim claim quote + verification command + literal stdout + disposition).
- All 9 retroactively-validated phase VALIDATION.md files contain `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` (Phases 01, 02, 03, 05, 06, 07, 08, 09, 10).

**Why not a new test:** Phase 17's harm scenario is "the audited baseline regressing" — that's a CI-level invariant property, not a per-function behavior. A unit/integration test asserting "the CI workflow contains these guard steps" would be a tautology (the YAML file IS the assertion). Per D-01 "doc augmentation does NOT count as rubber-stamp because the harm scenario for those two phases is irreducibly architectural, not a single-test surface" — the same logic applies to Phase 17 itself.

---

## Wave 0 Requirements

*All wave-0 requirements satisfied by Plan 17-01 at execution time (2026-04-30):*

- [x] `find test/ -name '*.todo*' -print` returns empty (committed as Wave 0 CI Output)
- [x] `grep -rEn '\.todo\(' test/` returns empty (committed as Wave 0 CI Output)
- [x] `npx tsc --noEmit -p tsconfig.json` exits 0 (committed)
- [x] `npx tsc --noEmit -p tsconfig.bot.json` exits 0 (committed)
- [x] `npx tsc --noEmit -p dashboard/tsconfig.json` exits 0 (committed)
- [x] `.planning/milestones/v6.17-debt-baseline.md` artifact created and committed (commit `83defc7`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WR-01/WR-02 wired-through path coverage (`pollExitStrategy:747-760` stop-loss trigger; `pollExitStrategy:697-717` partial-sell trigger) | DEBT-05 (PARTIAL — accepted per 17-VERIFICATION.md WARNING disposition) | The Phase 7 and Phase 10 describe blocks were renamed by WR-01/WR-02 to drop the "harm-prevention" framing because the tests verify call-shape contracts (executeFullSell / executePartialSell direct invocation) but do NOT drive the pollExitStrategy threshold-decision path. Restoring the "harm-prevention" framing without driving pollExitStrategy end-to-end would re-introduce the rubber-stamp pattern WR-01/WR-02 explicitly fixed. | Future v6.18+ hardening: add an integration test that drives `pollExitStrategy` end-to-end with a mocked price feed crossing the stop-loss threshold; assert `executeFullSell` is called via the polling path (not a direct test invocation). Out-of-v6.17-scope per stop-the-line discipline (D-07 was not triggered; bug was not found). |
| `getTradesByToken` re-introduction guard | DEBT-06 (one-off cleanup; no per-test regression lock) | DEBT-06 was a one-off dead-code deletion driven by the v6.16 audit ledger. There is no canonical regression target — any future re-introduction would either be intentional (legitimate caller restored) or unintentional (typo). A dedicated "deleted symbol must stay deleted" test would be brittle and over-specified. The structural lock is: tsc-clean × 3 catches dangling references; the v6.17 baseline ledger row is committed evidence that the deletion was intentional. | Future hardening: enable `noUnusedLocals: true` in `tsconfig.bot.json` to catch any future unused const declarations at build time. Out-of-v6.17-scope per D-12 (strict tech_debt-only sweep; no expansion beyond audit-driven items). |

---

## Validation Sign-Off

- [x] All 14 task verifications have automated commands or wave-0 CI artifacts
- [x] Sampling continuity: every plan task wave is bounded by an automated command
- [x] Wave 0 covers all referenced baseline commands (4 captured in `v6.17-debt-baseline.md`)
- [x] No watch-mode flags (CI uses `vitest run`, not `vitest`)
- [x] Feedback latency < 5s for full unit + integration suite
- [x] `nyquist_compliant: partial` set in frontmatter (Phase 17 itself: 4/6 COVERED + 2/6 PARTIAL with documented WR-01/WR-02 caveats; the 9 phases Phase 17 retroactively validates are documented in their respective N-VALIDATION.md files)

**Approval:** approved 2026-05-06 (reconstructed from existing artifacts; no new tests generated per user disposition)

---

## Validation Audit 2026-05-06

| Metric | Count |
|--------|-------|
| Requirements analyzed | 6 (DEBT-01..DEBT-06) |
| COVERED | 4 (DEBT-01, DEBT-02, DEBT-03, DEBT-04 — locked by CI invariants) |
| PARTIAL | 2 (DEBT-05 with WR-01/WR-02 disposition; DEBT-06 with INLINE-DOC disposition) |
| MISSING | 0 |
| Gaps resolved | 0 (none required new tests; user selected reconstruct-only) |
| Gaps escalated to manual-only | 2 (WR-01/WR-02 wired-through path; `getTradesByToken` re-introduction guard) |
| New test files generated | 0 |
| Existing harm-prevention describe blocks (D-03 audit query) | 5 (Phases 1, 3, 5, 6, 8 — Phases 7 and 10 renamed by WR-01/WR-02) |
| Inline VALIDATION.md augmentations | 2 (Phases 02, 09) |
| CI invariant guards | 4 (`.todo` ban + 3 tsc-noEmit checks) |
