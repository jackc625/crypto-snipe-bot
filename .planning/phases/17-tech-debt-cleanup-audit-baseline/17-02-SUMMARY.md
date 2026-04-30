---
phase: 17-tech-debt-cleanup-audit-baseline
plan: 2
subsystem: testing
tags: [vitest, harm-prevention, retroactive-nyquist, debt-05, audit, validation-doc]

# Dependency graph
requires:
  - phase: 17-tech-debt-cleanup-audit-baseline
    provides: "Plan 17-01 wave-0 baseline (.planning/milestones/v6.17-debt-baseline.md) — the CI ground-truth artifact this plan cross-references in every VALIDATION.md augmentation."
provides:
  - "7 new harm-prevention describe blocks across 6 test files (one new file: test/integration/v3LiquidityWait.test.ts) covering Phases 1, 3, 5, 6, 7, 8, 10."
  - "2 inline `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` H2 augmentations in Phases 02 and 09 N-VALIDATION.md (D-02 form for architectural / meta phases)."
  - "All 9 retroactively-validated phases (01, 02, 03, 05, 06, 07, 08, 09, 10) have a documented harm-prevention claim closing DEBT-05."
  - "Test-induced production export of waitForLiquidity at src/bot.ts:86 — single-token edit; internal-only consumer surface unchanged (option (a) per Plan 17-02 Task 4 planner-discretion)."
  - "FIX-04 and V3-03 verifiably excluded from new tests — deferred to HONEY-07 / HONEY-08 fresh-implementation per Pitfall #19."
affects:
  - "Plan 17-03 (DEBT-06 dead-code/diagnostic cleanup + CI regression guards) — depends on this plan's harm-prevention surface to motivate the .todo/tsc invariant locks."
  - "Future Phase 18 HONEY work — fresh implementation of V2/V3 sell-sim will be validated at fresh-implementation time per the FIX-04/V3-03 exclusion model."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Describe-block discoverability prefix: every retroactive harm-prevention test wrapped in `describe('Phase N harm-prevention: <scenario>', ...)` enabling `grep -rEn 'Phase [0-9]+ harm-prevention:' test/` audit query."
    - "Inline VALIDATION.md augmentation pattern: `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` H2 section appended after the last existing H2 (D-02 form for architectural / meta phases where single-test fabrication would be the rubber-stamp pattern Pitfall #19 warns against)."
    - "Combined D-04 observable-effect rigor: function-return state + structured pino log emission + DB row write + transaction submission, asserted within a single `it` (e.g., Phase 6 + Phase 7 patterns)."
    - "Materially-stronger Nyquist rigor over existing tests: Phase 8 dynamic equality `expect(body.version).toBe(pkg.version)` is provably stronger than the existing semver-only regex check at lines 57-72 (semver regex passes against any '1.0.0'-shape string; dynamic equality falsifies if pkg.version → body.version flow ever breaks)."
    - "vi.doUnmock pattern for isolating describe blocks from prior describe-block doMock leaks (test/integration/exitMonitor.test.ts:629)."

key-files:
  created:
    - "test/integration/v3LiquidityWait.test.ts (Phase 5 V3-02 liquidity-wait harm-prevention test; new file with mocked WebSocket Contract + fake-timer 30s timeout drive)"
  modified:
    - "test/integration/exitMonitor.test.ts (Phase 1 FIX-01 describe block appended)"
    - "test/unit/db.test.ts (Phase 3 SQLite atomicity describe block appended)"
    - "test/unit/riskManager.test.ts (Phase 6 RISK daily-loss describe block appended; uses vi.doMock + vi.resetModules + dynamic re-import for warn capture)"
    - "test/unit/exitEngineSell.test.ts (Phase 7 stop-loss + Phase 10 partial-sell describe blocks appended; reuses existing top-of-file mock matrix)"
    - "test/integration/api/health.test.ts (Phase 8 /health version describe block appended; dynamic-equality assertion against package.json)"
    - ".planning/phases/01-bug-fixes-hardening/01-VALIDATION.md (## Harm-Prevention Assertion (Phase 17 / DEBT-05) H2 appended)"
    - ".planning/phases/02-ethers-v6-migration/02-VALIDATION.md (inline doc form; harm_prevention: inline frontmatter; H2 appended)"
    - ".planning/phases/03-sqlite-storage-code-quality/03-VALIDATION.md (H2 appended)"
    - ".planning/phases/05-uniswap-v3-integration/05-VALIDATION.md (H2 appended; V3-03 EXCLUDED note recorded)"
    - ".planning/phases/06-risk-management/06-VALIDATION.md (H2 appended)"
    - ".planning/phases/07-smart-exit-strategies/07-VALIDATION.md (H2 appended)"
    - ".planning/phases/08-monitoring-web-dashboard/08-VALIDATION.md (H2 appended; INT-HEALTH-VERSION closure note)"
    - ".planning/phases/09-testing-infrastructure/09-VALIDATION.md (inline doc form; harm_prevention: inline frontmatter; H2 appended)"
    - ".planning/phases/10-partial-sell-revenue-fix/10-VALIDATION.md (H2 appended)"
    - "src/bot.ts (single-token edit: added `export` keyword to waitForLiquidity at line 86 — test-induced design improvement per Plan 17-02 Task 4 option (a))"

key-decisions:
  - "Honored the locked D-01/D-02 hybrid 7+2 split: 7 new tests (Phases 01, 03, 05, 06, 07, 08, 10) and 2 inline doc augmentations (Phases 02, 09)."
  - "Took option (a) per Plan 17-02 Task 4 — added `export` to src/bot.ts:86 for waitForLiquidity. Smallest-diff path; internal-only consumer surface unchanged."
  - "Used vi.importActual partial-mock pattern for ethers in v3LiquidityWait.test.ts to avoid breaking transitive Interface import from receiptDecoder.ts (Rule 3 deviation)."
  - "Used vi.doUnmock in Phase 1 harm-prevention beforeEach to isolate from prior describe blocks' vi.doMock leakage (Rule 3 deviation; mock-state isolation)."
  - "Used vi.doMock + vi.resetModules + dynamic re-import in Phase 6 to capture log.warn calls (the file-level vi.mock returns fresh vi.fn() per child() call, blocking outside capture)."
  - "All 7 new tests pass on first run after authoring iteration; no D-07 stop-the-line was triggered (no real production bugs exposed)."

patterns-established:
  - "Phase N harm-prevention: describe-block prefix as the audit-grep convention for D-03 discoverability."
  - "## Harm-Prevention Assertion (Phase 17 / DEBT-05) H2 section in VALIDATION.md as the inline-doc convention (D-02 form for architectural / meta phases)."
  - "Materially-stronger Nyquist rigor when an existing test already asserts the harm-prevention claim — re-state it with dynamic equality / payload structure rather than relabel (Phase 8)."

requirements-completed: [DEBT-05]

# Metrics
duration: 16min
completed: 2026-04-30
---

# Phase 17 Plan 2: Retroactive Nyquist Summary

**7 new harm-prevention describe blocks (Phases 1, 3, 5, 6, 7, 8, 10) + 2 inline VALIDATION.md augmentations (Phases 02, 09) close DEBT-05's retroactive Nyquist requirement across all 9 partial-Nyquist phases per the locked hybrid 7+2 split.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-04-30T00:14:26Z
- **Completed:** 2026-04-30T00:30:31Z
- **Tasks:** 10/10 (9 implementation + 1 final audit-query verification)
- **Commits:** 10 (9 task + 1 mock-isolation fix)
- **Files modified:** 14 (1 created + 13 modified, including a single-token export in src/bot.ts)
- **Tests added:** 7 new `Phase N harm-prevention:` describe blocks; 8 new `it` blocks (Phase 1 has 2; rest have 1 each)
- **Test suite status:** 351/351 passing (343 baseline + 8 new harm-prevention assertions + small file-internal sub-counting)

## Accomplishments

- 7 retroactive harm-prevention tests committed across 6 test files (one new file: `test/integration/v3LiquidityWait.test.ts`), covering Phases 1, 3, 5, 6, 7, 8, 10 with concrete D-04 observable-effect assertions.
- 2 inline `## Harm-Prevention Assertion (Phase 17 / DEBT-05)` H2 augmentations in Phases 02 and 09 N-VALIDATION.md per D-02 form for architectural / meta phases.
- All 9 retroactively-validated phases (01, 02, 03, 05, 06, 07, 08, 09, 10) have a discoverable, audit-grep-able harm-prevention claim documented.
- FIX-04 and V3-03 verifiably excluded from new tests — deferred to HONEY-07/HONEY-08 fresh implementation per Pitfall #19.
- `waitForLiquidity` exported from `src/bot.ts:86` as a test-induced design improvement (option (a) per planner discretion).
- Full unit + integration suite green: 351/351 passing.
- D-07 stop-the-line **not triggered** — no real production bugs exposed.

## Task Commits

Each task was committed atomically with `{type}(17-02): ...` messages:

1. **Task 1: Phase 1 FIX-01 harm-prevention describe block** — `2854618` (test)
2. **Task 2: Phase 2 ethers v6 inline harm-prevention augmentation** — `e47e417` (docs)
3. **Task 3: Phase 3 SQLite atomicity harm-prevention describe block** — `f746fa9` (test)
4. **Task 4: Phase 5 V3-02 liquidity-wait harm-prevention test (NEW FILE) + src/bot.ts export** — `347072f` (test)
5. **Task 5: Phase 6 RISK daily-loss harm-prevention describe block** — `14fe230` (test)
6. **Task 6: Phase 7 EXIT-01 stop-loss harm-prevention describe block** — `76e2ecc` (test)
7. **Task 7: Phase 8 DASH/MON /health version harm-prevention describe block** — `7ebe07a` (test)
8. **Task 8: Phase 9 testing-infrastructure inline harm-prevention augmentation** — `dc7b7c9` (docs)
9. **Task 9: Phase 10 partial-sell amount_out non-null harm-prevention describe** — `66027d5` (test)
10. **Mock-isolation fix (Rule 3 deviation; surfaced during Task 10 full-suite run)** — `491d546` (fix)

## Files Created/Modified

**Created (1):**
- `test/integration/v3LiquidityWait.test.ts` — Phase 5 V3-02 liquidity-wait harm-prevention test (mocked WebSocket Contract + fake-timer 30s timeout drive)

**Test files modified (5):**
- `test/integration/exitMonitor.test.ts` — Phase 1 FIX-01 describe block appended (2 `it`s)
- `test/unit/db.test.ts` — Phase 3 SQLite atomicity describe block appended (1 `it`)
- `test/unit/riskManager.test.ts` — Phase 6 RISK daily-loss describe block appended (1 `it`)
- `test/unit/exitEngineSell.test.ts` — Phase 7 stop-loss + Phase 10 partial-sell describe blocks appended (1 `it` each)
- `test/integration/api/health.test.ts` — Phase 8 /health version describe block appended (1 `it`)

**VALIDATION.md files modified (9):**
- `.planning/phases/01-bug-fixes-hardening/01-VALIDATION.md`
- `.planning/phases/02-ethers-v6-migration/02-VALIDATION.md` (+ frontmatter `harm_prevention: inline`)
- `.planning/phases/03-sqlite-storage-code-quality/03-VALIDATION.md`
- `.planning/phases/05-uniswap-v3-integration/05-VALIDATION.md`
- `.planning/phases/06-risk-management/06-VALIDATION.md`
- `.planning/phases/07-smart-exit-strategies/07-VALIDATION.md`
- `.planning/phases/08-monitoring-web-dashboard/08-VALIDATION.md`
- `.planning/phases/09-testing-infrastructure/09-VALIDATION.md` (+ frontmatter `harm_prevention: inline`)
- `.planning/phases/10-partial-sell-revenue-fix/10-VALIDATION.md`

**Production code (1 single-token edit):**
- `src/bot.ts` — added `export` keyword to `waitForLiquidity` at line 86 (test-induced design improvement; option (a) per Plan 17-02 Task 4)

## Decisions Made

- **Honored the locked D-01/D-02 hybrid 7+2 split** without deviation: 7 new describe blocks (Phases 01, 03, 05, 06, 07, 08, 10) + 2 inline doc augmentations (Phases 02, 09).
- **Took planner option (a) for Task 4** — exported `waitForLiquidity` from `src/bot.ts:86`. Documented as "test-induced changes" per the Task 4 acceptance criterion.
- **Used `vi.importActual` partial-mock for ethers** in v3LiquidityWait.test.ts (vs the planner-suggested narrow mock) to keep transitive `Interface` imports working — Rule 3 deviation, documented below.
- **Used `vi.doUnmock` in Phase 1 harm-prevention beforeEach** to isolate from prior describe blocks' `vi.doMock` leakage — Rule 3 deviation, documented below.
- **All 7 new tests pass on first run after standard authoring iteration** — D-07 stop-the-line was NOT triggered.

## Per-Phase Disposition Table

| Phase | Form | File:line | Observable effect asserted |
|-------|------|-----------|---------------------------|
| 01 | NEW TEST | test/integration/exitMonitor.test.ts:626 | tryAcquireSellLock returns false post-acquire; releases properly (lock not sticky) |
| 02 | INLINE DOC | .planning/phases/02-ethers-v6-migration/02-VALIDATION.md (H2 appended) | Pointer to existing 28 tests + tsc-clean baseline (architectural / type-system property) |
| 03 | NEW TEST | test/unit/db.test.ts:685 | Post-failure SELECT COUNT(*) FROM trades returns 0 (atomic rollback) + targeted absence of would-have-been-valid row |
| 05 | NEW TEST | test/integration/v3LiquidityWait.test.ts:49 | waitForLiquidity returns false; pino info "Mint timeout (30s), dropping opportunity" emitted; pool.on('Mint', ...) registered |
| 06 | NEW TEST | test/unit/riskManager.test.ts:136 | canSnipe returns {allowed: false, reason: 'daily_loss_limit'} AND log.warn called with structured payload |
| 07 | NEW TEST | test/unit/exitEngineSell.test.ts:258 | executeFullSell with reason='stop-loss' returns true; sendTxWithRetry called once; insertTrade with action='sell' + amountOut |
| 08 | NEW TEST | test/integration/api/health.test.ts:144 | body.version === pkg.version (dynamic equality, MATERIALLY STRONGER than existing semver-only check) |
| 09 | INLINE DOC | .planning/phases/09-testing-infrastructure/09-VALIDATION.md (H2 appended) | Pointer to .github/workflows/test.yml exit-code propagation + 343/343 baseline (meta / CI honesty property) |
| 10 | NEW TEST | test/unit/exitEngineSell.test.ts:304 | insertTrade with action='partial_sell' AND non-null amountOut/gasCost/block; decodeReceipt called once |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ethers mock too narrow in v3LiquidityWait.test.ts**
- **Found during:** Task 4 (Phase 5 V3-02 test authoring)
- **Issue:** Initial `vi.doMock('ethers', () => ({ Contract: MockContract }))` failed at runtime: `No "Interface" export is defined on the "ethers" mock`. Transitive imports — bot.ts → exitEngine.ts → receiptDecoder.ts uses `new Interface(WETH_ABI)` — break when ethers is mocked too narrowly.
- **Fix:** Switched to `vi.doMock('ethers', async () => { const actual = await vi.importActual<typeof import('ethers')>('ethers'); return { ...actual, Contract: MockContract }; })` (the canonical ethers partial-mock pattern, mirroring test/unit/exitEngineSell.test.ts:79-90).
- **Files modified:** test/integration/v3LiquidityWait.test.ts (within the same task commit)
- **Verification:** Test passes; full suite still passes.
- **Committed in:** `347072f` (Task 4 commit)

**2. [Rule 3 - Blocking] Phase 1 harm-prevention describe leaks prior describe block's vi.doMock**
- **Found during:** Task 10 final-suite verification (the test passed in `-t` isolation but failed in full-file runs)
- **Issue:** Earlier describe blocks in the same file (Describe 2 "Exit trigger correctness" line 147, Describe 3 "Connection failure in exit monitor" line 374) call `vi.doMock('../../src/utils/exitManager', ...)` with stub `vi.fn()` implementations. Those mock registrations persist across describes — `vi.resetModules()` clears the module cache but NOT the `doMock` registry. Without explicit `doUnmock`, importing `exitManager` in the Phase 1 describe yielded the prior describe's stub (returning `undefined`), causing `expected undefined to be true`.
- **Fix:** Added `vi.doUnmock('../../src/utils/exitManager')` to the Phase 1 harm-prevention `beforeEach`.
- **Files modified:** test/integration/exitMonitor.test.ts (commit 491d546)
- **Verification:** All 22 tests in exitMonitor.test.ts pass in isolation; full unit + integration suite (351/351) passes.
- **Committed in:** `491d546` (separate fix commit per Task 10 spec — surfaced during the audit-query verification step, not during Task 1)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - Blocking; pure test-mock isolation issues).
**Impact on plan:** Both fixes were essential for test-suite isolation; neither implies a production code bug. No scope creep — production code change is limited to the Task-4-mandated `export` keyword on `waitForLiquidity`.

## Issues Encountered

- During Task 10's full-suite run, the Phase 1 harm-prevention block initially failed with mock-state leak from prior describes. Diagnosed root cause (vi.doMock registry persistence across describes), fixed via `vi.doUnmock`, re-ran full suite to confirm 351/351 green. Documented as Deviation #2 above.

## D-07 Stop-the-Line Status

**Not triggered.** All 7 new tests pass with their existing production-code targets. No real production bugs surfaced during retroactive validation. Phase 17 close is **not blocked** by this plan.

## Self-Check

### Audit-query verification (Task 10 spec)

**1. D-03 discoverability — `grep -rEn "^describe\\('Phase [0-9]+ harm-prevention:" test/`:**
```
test/integration/api/health.test.ts:144:describe('Phase 8 harm-prevention: DASH/MON /health emits version from package.json (INT-HEALTH-VERSION closure)', () => {
test/integration/exitMonitor.test.ts:626:describe('Phase 1 harm-prevention: FIX-01 exit-monitor sell-lock prevents double-sell race', () => {
test/integration/v3LiquidityWait.test.ts:49:describe('Phase 5 harm-prevention: V3-02 liquidity wait drops snipe on Mint timeout (V3-03 EXCLUDED)', () => {
test/unit/db.test.ts:685:describe('Phase 3 harm-prevention: SQLite atomicity prevents partial-row commits on transaction failure', () => {
test/unit/exitEngineSell.test.ts:258:describe('Phase 7 harm-prevention: EXIT-01 stop-loss triggers executeFullSell with reason="stop-loss"', () => {
test/unit/exitEngineSell.test.ts:304:describe('Phase 10 harm-prevention: partial-sell amount_out is non-null on receipt-decoded sell', () => {
test/unit/riskManager.test.ts:136:describe('Phase 6 harm-prevention: RISK daily-loss gate blocks the snipe with structured pino warn', () => {
```
**7 matches. PASS.**

**2. D-02 inline doc form — `grep -l "^## Harm-Prevention Assertion (Phase 17 / DEBT-05)$" .planning/phases/02-*/02-VALIDATION.md .planning/phases/09-*/09-VALIDATION.md`:**
```
.planning/phases/02-ethers-v6-migration/02-VALIDATION.md
.planning/phases/09-testing-infrastructure/09-VALIDATION.md
```
**2 matches. PASS.**

**3. All 9 phase VALIDATION.md files have augmentation:**
```
01: OK
02: OK
03: OK
05: OK
06: OK
07: OK
08: OK
09: OK
10: OK
```
**9/9. PASS.**

**4. Exclusion verification:**
- Phase 1 FIX-04 exclusion: `awk '/^describe\(.Phase 1 harm-prevention/,/^\}\);/' test/integration/exitMonitor.test.ts | grep -E 'simulateSellForChain|sellSimulation|FIX-04'` → 0 matches. PASS.
- Phase 5 V3-03 exclusion: `grep -E 'simulateSellV3ForChain|simulateSell|sellSimulation' test/integration/v3LiquidityWait.test.ts | grep -v 'EXCLUDES'` → 0 matches. PASS.

**5. Full test suite green — `npx vitest run --project unit --project integration`:**
```
Test Files  32 passed (32)
     Tests  351 passed (351)
  Start at  20:29:44
  Duration  3.72s
```
**351/351 passing. PASS.**

### File existence + commit-hash verification

**Created files exist:**
- `test/integration/v3LiquidityWait.test.ts` → FOUND
- `.planning/phases/17-tech-debt-cleanup-audit-baseline/17-02-SUMMARY.md` → (this file)

**All 10 commit hashes exist in `git log`:** `2854618`, `e47e417`, `f746fa9`, `347072f`, `14fe230`, `76e2ecc`, `7ebe07a`, `dc7b7c9`, `66027d5`, `491d546` — all present.

**Test-induced changes recorded:** `src/bot.ts:86` `export async function waitForLiquidity(...)` — single-token edit, internal-only consumer surface unchanged (option (a) per Task 4).

## Next Phase Readiness

- Plan 17-02 complete. Plan 17-03 (DEBT-06 dead-code/diagnostic cleanup + CI regression guards) is unblocked; the harm-prevention surface this plan establishes motivates the .todo / tsc invariant locks Plan 17-03 will land.
- DEBT-05 closes here — all 9 retroactively-validated phases (01, 02, 03, 05, 06, 07, 08, 09, 10) have either a discoverable harm-prevention test or an inline doc augmentation.
- Phase 17 close is **not blocked** — D-07 stop-the-line not triggered.

---
*Phase: 17-tech-debt-cleanup-audit-baseline*
*Completed: 2026-04-30*
