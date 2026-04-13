---
phase: 15
slug: chain-scoped-dedup-dashboard-env
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-13
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.1 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run test/unit/db.test.ts test/unit/configEnvVar.test.ts` |
| **Full suite command** | `npx vitest run test/unit/` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/unit/db.test.ts test/unit/configEnvVar.test.ts`
- **After every plan wave:** Run `npx vitest run test/unit/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-00 | 01 | 1 | CHAIN-02 | — | Legacy mainnet rows normalized to eth before chain-scoped queries | unit | `npx vitest run test/unit/db.test.ts -t "legacy chain identifier normalization"` | ✅ | ✅ green |
| 15-01-01 | 01 | 1 | CHAIN-02 | — | isTokenSniped includes AND chain = ? via factory | unit | `npx vitest run test/unit/db.test.ts -t "chain-scoped dedup"` | ✅ | ✅ green |
| 15-01-02 | 01 | 1 | CHAIN-02 | — | Dead legacy wrappers deleted, no broken imports | build | `npx tsc --noEmit` | ✅ | ✅ green |
| 15-01-03 | 01 | 1 | CHAIN-02 | — | 9 unit tests cover normalization + chain-scoped dedup | unit | `npx vitest run test/unit/db.test.ts` | ✅ | ✅ green |
| 15-02-01 | 02 | 1 | CHAIN-02 | — | Missing DASHBOARD_API_KEY triggers fatal + exit(1) naming the var | unit | `npx vitest run test/unit/configEnvVar.test.ts -t "DASHBOARD_API_KEY"` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Must-Have Truth Coverage

### Plan 01 — Chain-Scoped Dedup (17 truths)

| # | Truth | Coverage | Test/Evidence |
|---|-------|----------|---------------|
| 1 | Token sniped on bsc does not block same address on eth | COVERED | `db.test.ts:593` — "token sniped on bsc returns undefined for eth bind" |
| 2 | Token sniped on bsc does not block same address on base | COVERED | `db.test.ts:602` — "token sniped on bsc returns undefined for base bind" |
| 3 | Token sniped on bsc does not block same address on arb | COVERED | `db.test.ts:611` — "token sniped on bsc returns undefined for arb bind" |
| 4 | Both live call sites pass ctx.chain.name to isTokenSniped | COVERED | Code review: key_links verify `isTokenSniped.get(token, ctx.chain.name)` at V2+V3 handlers |
| 5 | Pre-Phase-4 mainnet rows normalized to eth on startup | COVERED | `db.test.ts:506` — "rewrites chain='mainnet' rows to chain='eth'" |
| 6 | normalizeLegacyMainnetRows() is idempotent | COVERED | `db.test.ts:520` — "is idempotent: a second call is a no-op" |
| 7 | trades schema DEFAULT is 'eth' | COVERED | `db.test.ts:554` — "createTestDb() applies schema default 'eth'" |
| 8 | makeIsTokenSnipedStmt factory exported | COVERED | `db.test.ts:564+` — import from production code |
| 9 | Production isTokenSniped uses makeIsTokenSnipedStmt(db) | COVERED | Code review: factory called at module level |
| 10 | handleNewPair deleted from bot.ts | COVERED | tsc --noEmit exits 0 + grep audit |
| 11 | startBot deleted from bot.ts | COVERED | tsc --noEmit exits 0 + grep audit |
| 12 | resumeMonitoring deleted from bot.ts | COVERED | tsc --noEmit exits 0 + grep audit |
| 13 | handleAlphaDrop deleted from alphaDrop.ts | COVERED | tsc --noEmit exits 0 + grep audit |
| 14 | Unit test proves factory is chain-scoped | COVERED | `db.test.ts:584` — "token sniped on bsc returns truthy for bsc bind" |
| 15 | Deletion audit ran across src/, scripts/, test/, dashboard/ | COVERED | Documented in 15-01-SUMMARY.md cross-directory grep audit |
| 16 | Import cleanup driven by tsc --noEmit | COVERED | Documented in 15-01-SUMMARY.md tsc-driven import cleanup |
| 17 | npx tsc --noEmit exits 0 + all tests pass | COVERED | Build + test verification |

### Plan 02 — DASHBOARD_API_KEY Validation (9 truths)

| # | Truth | Coverage | Test/Evidence |
|---|-------|----------|---------------|
| 1 | Missing DASHBOARD_API_KEY logs fatal with var name + exits | COVERED | `configEnvVar.test.ts:158` — "calls process.exit AND logs a fatal payload naming DASHBOARD_API_KEY when unset" |
| 2 | Present DASHBOARD_API_KEY succeeds (no exit) | COVERED | `configEnvVar.test.ts:179` — "does not exit and does not log fatal when set" |
| 3 | DASHBOARD_API_KEY declared required: true in REQUIRED_ENV_VARS | COVERED | Implicit via test: missing triggers exit |
| 4 | Unit test proves missing triggers process.exit | COVERED | `configEnvVar.test.ts:158` |
| 5 | Unit test proves present does not trigger process.exit | COVERED | `configEnvVar.test.ts:179` |
| 6 | Unit test proves fatal payload mentions 'DASHBOARD_API_KEY' | COVERED | `configEnvVar.test.ts:158,187` — payload assertion |
| 7 | auth.ts defense-in-depth branch preserved with comment | COVERED | Code review: comment added, executable code unchanged |
| 8 | npx tsc --noEmit exits 0 | COVERED | Build verification |
| 9 | All previously-passing tests still pass | COVERED | 154 unit tests pass (12 files, zero regressions) |

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 2s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-13

---

## Validation Audit 2026-04-13

| Metric | Count |
|--------|-------|
| Truths audited | 26 |
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Test files verified | 2 |
| Tests passing | 39 |

---
*Phase: 15-chain-scoped-dedup-dashboard-env*
*Validated: 2026-04-13*
