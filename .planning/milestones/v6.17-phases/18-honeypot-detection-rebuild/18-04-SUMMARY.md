---
phase: 18-honeypot-detection-rebuild
plan: 04
subsystem: safety
tags: [vitest, ethers-v6, typescript, defense-in-depth, fail-closed, regression-tests, audit, tokenSafety, parallel-bank]

# Dependency graph
requires:
  - phase: 17-tech-debt-cleanup-audit-baseline
    provides: D-04 observable-effect rigor convention; D-07 stop-the-line precedent; D-13 no-rip-and-replace stance
  - phase: 18-honeypot-detection-rebuild
    provides: D-AUDIT-BAR (per-gate code-read + regression test) and D-STOP-THE-LINE escalation policy from 18-CONTEXT.md
provides:
  - 8 per-gate regression contracts under test/unit/safetyBank/ asserting fail-closed semantics on RPC throw + malformed response + observable-effect edge cases (24 tests total)
  - isBlacklistedTokenForChain fail-closed retrofit (lines 357-365 of src/utils/tokenSafety.ts) closing the audit-discovered try/catch gap
  - v6.17-safety-bank-audit.md milestone doc with per-gate disposition table (7 clean + 1 fixed-in-flight) + stop-the-line determination + discriminated-union retrofit deferral decision
  - CI invariant: any future PR regressing one of the 8 parallel-bank gates to vacuous-pass fails the test:unit project
  - Explicit out-of-scope record for v6.18 audit: third-party API adapters (honeypotIs.ts / goplus.ts / unicrypt.ts / mudra.ts) + bot.ts parallel-bank dispatch + HoneypotChecker dispatch
affects: [18-05, 18-06, 18-07, 18-08, 18-09, 18-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-gate regression contract: describe('<GATE> regression — never returns safe on edge cases') with (a) RPC-throw → unsafe-equivalent return, (b) malformed-response → unsafe-equivalent return, (c) observable-effect (mock-call arg / structured log)"
    - "Test-as-bug-finder: write the harm-prevention test FIRST asserting fail-closed; if the test fails because production code is missing try/catch, that IS the bug — fix in next task, don't .skip"
    - "Fail-closed audit table format (Gate | Lines | Unsafe semantic | Edge-case handling | Regression test | Disposition) as Phase 17 milestone doc precedent extension"

key-files:
  created:
    - "test/unit/safetyBank/checkHoneypotForChain.test.ts"
    - "test/unit/safetyBank/isBlacklistedTokenForChain.test.ts"
    - "test/unit/safetyBank/isLiquidityLockedForChain.test.ts"
    - "test/unit/safetyBank/isLiquiditySufficientForChain.test.ts"
    - "test/unit/safetyBank/checkTokenMetadataForChain.test.ts"
    - "test/unit/safetyBank/simulateSwapForChain.test.ts"
    - "test/unit/safetyBank/hasHighTransferTaxForChain.test.ts"
    - "test/unit/safetyBank/hasMaxWalletOrTxLimitsForChain.test.ts"
    - ".planning/milestones/v6.17-safety-bank-audit.md"
  modified:
    - "src/utils/tokenSafety.ts (lines 357-365 — isBlacklistedTokenForChain try/catch retrofit)"

key-decisions:
  - "Discriminated-union retrofit DEFERRED to v6.18 (HONEY-V2-UNION-RETROFIT): the 8 parallel-bank gates stay on Promise<boolean> for v6.17 stability; regression tests are layered over the boolean shape without changing return types. Aligns with Phase 17 D-13/D-14 risk-aversion."
  - "Stop-the-line NOT triggered: the only audit-found bug (isBlacklistedTokenForChain no try/catch) fails CLOSED at the call-site level (Promise.all rejection → buy is skipped, never granted). Strictly less severe than V2 sell-sim (blocked every snipe) or V3 sell-sim (granted every buy). Fixed in flight; Phase 18 close proceeds."
  - "Audit scope is the 8 dispatch functions in src/utils/tokenSafety.ts ONLY. Third-party API adapter internals (honeypotIs/goplus/unicrypt/mudra), bot.ts Promise.all parallel-bank dispatch, and the new HoneypotChecker dispatch are explicitly OUT-OF-SCOPE and tracked for v6.18 / covered by other Phase 18 plans."
  - "Audit-found bug + immediate retrofit is fix-in-flight, NOT a D-STOP-THE-LINE violation: the bug pre-dated this audit; the audit surfaced it; the regression test contract makes the fix harm-preventing and locks the behavior — closing the audit-bar deliverable in a single wave is the design, not scope creep."

patterns-established:
  - "test/unit/safetyBank/ directory convention: one .test.ts file per gate, file name === function name, single describe block with canonical phrase 'regression — never returns safe on edge cases'"
  - "Per-gate fail-closed semantics matrix as a milestone-doc artifact (table with Unsafe semantic + Edge-case handling columns) — auditable, grep-able, links each gate to its regression test"
  - "Test-as-audit-evidence: each per-gate regression file IS the artifact proving the gate exercises the underlying behavior per D-04; the milestone doc cites these files in the disposition table rather than restating the assertions"

requirements-completed: [HONEY-11]

# Metrics
duration: ~30min
completed: 2026-05-15
---

# Phase 18 Plan 04: HONEY-11 Safety Bank Audit Summary

**8 per-gate regression contracts (24 tests) lock fail-closed semantics over the parallel-bank gates in `tokenSafety.ts`; `isBlacklistedTokenForChain` retrofitted with try/catch (audit-discovered fix-in-flight); audit milestone doc commits the disposition table + D-STOP-THE-LINE NOT triggered determination.**

## Performance

- **Duration:** ~30 min (across Task 1 + Task 2 + Task 3 + state metadata)
- **Started:** 2026-05-15 (Tasks 1+2 committed prior; Task 3 + metadata this session)
- **Completed:** 2026-05-15
- **Tasks:** 3 / 3
- **Files created:** 9 (8 regression test files + 1 milestone doc)
- **Files modified:** 1 (src/utils/tokenSafety.ts)

## Accomplishments

- 8 per-gate regression test files under `test/unit/safetyBank/`, one per gate, each asserting the unsafe-equivalent return on (a) RPC throw and (b) malformed response, plus at least one observable-effect assertion per Phase 17 D-04 rigor — 24 tests total, all passing in 1.72s
- `isBlacklistedTokenForChain` (src/utils/tokenSafety.ts:357-365) wrapped in try/catch returning `true` (fail-closed) with structured `ctx.log.warn({ ..., check: 'blacklist' }, ...)` — closes the audit-discovered try/catch gap that previously propagated RPC exceptions up the Promise.all chain
- `.planning/milestones/v6.17-safety-bank-audit.md` committed with per-gate disposition (7 clean + 1 fixed-in-flight), stop-the-line determination (NOT triggered; HONEY-13+ NOT created), and the v6.18 discriminated-union retrofit deferral
- HONEY-11 requirement closes for Phase 18; downstream plans 18-05..18-10 proceed with confidence that the parallel-bank defense-in-depth layer is fail-closed at every gate

## Task Commits

Each task was committed atomically:

1. **Task 1: Author 8 per-gate regression test files** — `67d247a` (test)
2. **Task 2: Retrofit isBlacklistedTokenForChain with fail-closed try/catch** — `6e2676d` (fix)
3. **Task 3: Author v6.17-safety-bank-audit.md milestone doc** — `53df941` (docs)

**Plan metadata commit:** pending — captures SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md after this writeup is in place.

## Files Created/Modified

- `test/unit/safetyBank/checkHoneypotForChain.test.ts` — Regression contract: gate delegates to honeypot.is/goplus adapters (both fail-closed); test asserts `result === true` on adapter throw + observable warn-log effect
- `test/unit/safetyBank/isBlacklistedTokenForChain.test.ts` — Regression contract: getCode throw + `'0x'` zero-bytecode edge cases assert `result === true`; observable effect = `expect(mockProvider.getCode).toHaveBeenCalledWith(MOCK_TOKEN)`. This is the test that initially failed in Task 1 (pre-fix) and passes after Task 2's retrofit.
- `test/unit/safetyBank/isLiquidityLockedForChain.test.ts` — Regression contract: gate semantic is INVERTED (`false` = unlocked = unsafe); adapter-delegation chain ends in burn-check fail-closed at `false`. Asserts `result === false` on full chain failure.
- `test/unit/safetyBank/isLiquiditySufficientForChain.test.ts` — Regression contract: gate's `catch` returns `false`; test asserts unsafe-equivalent + structured warn log with `check: 'liquidity'`
- `test/unit/safetyBank/checkTokenMetadataForChain.test.ts` — Regression contract: gate's `catch` returns `false`; test asserts unsafe-equivalent on Contract throw + out-of-range decimals edge case
- `test/unit/safetyBank/simulateSwapForChain.test.ts` — Regression contract: gate's `catch` returns `false`; test asserts `result === false` on staticCall throw + observable `expect(mockContract.staticCall).toHaveBeenCalled()`
- `test/unit/safetyBank/hasHighTransferTaxForChain.test.ts` — Regression contract: gate's `catch` returns `true`; test asserts unsafe-equivalent on staticCall throw + observable `expect(mockContract.staticCall).toHaveBeenCalled()`
- `test/unit/safetyBank/hasMaxWalletOrTxLimitsForChain.test.ts` — Regression contract: gate's outer `catch` returns `true`; test asserts unsafe-equivalent on Contract throw + structured warn log
- `src/utils/tokenSafety.ts` — `isBlacklistedTokenForChain` body wrapped in try/catch returning `true` with `ctx.log.warn({ err, token, check: 'blacklist' }, 'Blacklist scan failed')`. Matches the fail-closed pattern of `hasHighTransferTaxForChain` (line 504-507) and `hasMaxWalletOrTxLimitsForChain` (line 546-549).
- `.planning/milestones/v6.17-safety-bank-audit.md` — HONEY-11 audit deliverable: methodology, per-gate findings table (8 rows: gate / lines / unsafe semantic / edge-case handling / regression test / disposition), stop-the-line determination, what-was-not-audited boundary, discriminated-union retrofit decision

## Decisions Made

- **D-STOP-THE-LINE NOT triggered (audit-found bug severity assessed LOW):** the pre-fix `isBlacklistedTokenForChain` propagated `eth_getCode` RPC exceptions up the call chain. Because `bot.ts:229-238` wraps the parallel bank in `Promise.all`, any single rejection causes the whole bank to reject, and the call-site catch in `bot.ts` skips the snipe. Net effect: the bot SKIPS tokens it would otherwise have snipped (false-negative on a safe token, opportunity cost only). Critically, the bot does NOT make a bad buy — the failure cascades to fail-closed at the call-site level. This is strictly LESS severe than (a) the V2 sell-sim which incorrectly blocked every snipe but never granted bad buys, and (b) the V3 sell-sim which incorrectly granted every buy (real-money-loss-possible). Therefore the audit-found bug does NOT trigger HONEY-13+ escalation per the D-STOP-THE-LINE criterion ("a production bug worse than the V2/V3 sell-sim ones").
- **Discriminated-union retrofit DEFERRED to v6.18 (HONEY-V2-UNION-RETROFIT placeholder):** the 8 gates stay on `Promise<boolean>` for Phase 18. Per PATTERNS.md Key Cross-Cutting Decision #1, retrofitting all 8 gates to a `SafetyGateResult` discriminated union in the same phase as the new `HoneypotChecker` dispatch would compound blast radius without a corresponding safety win. The regression tests layered in this plan already lock the fail-closed semantic — they catch the only failure mode that matters (vacuous-pass regression) without changing return types. Phase 17 D-13/D-14 risk-aversion is preserved.
- **Audit boundary explicit and narrow:** the milestone doc names what was NOT audited (third-party API adapter internals + `bot.ts:229-238` dispatch combiner + the new HoneypotChecker dispatch). Each is either covered by other Phase 18 plans (HoneypotChecker dispatch under 18-02..18-09) or deferred to v6.18 (adapter internals). This protects HONEY-11 from scope creep and gives a clean "next-audit-pass" target.

## Deviations from Plan

None — Tasks 1, 2, and 3 executed exactly as the plan specified. The "test that initially fails because the production code lacks try/catch" behavior in Task 1 was the explicit design per the plan's `<action>` block ("DO NOT mark this test `.skip` or `.todo` — the test is the harm-prevention contract; the failure is the bug"). Task 2 then fixed the production code so the test passes. That is plan-intended TDD-style sequencing, not a deviation.

No Rule 1/2/3 auto-fixes were needed beyond the planned `isBlacklistedTokenForChain` retrofit (which IS the plan, not a deviation). No CLAUDE.md directives required adjustment. No Rule 4 architectural decisions surfaced.

## Issues Encountered

- The plan's verification command `node -e "...const rows=(f.match(/\| \w+ForChain \|/g)||[]).length..."` did not account for table cells where the gate name is wrapped in backticks (`` | `name` | ``). The milestone doc uses backtick-wrapped names for renderability. Verified the doc with a permissive regex (`/\|\s*`?\w+ForChain`?\s*\|/g`) which counted 8 rows correctly. The semantic intent of the verification — "8 gate rows present in the table" — is satisfied. **No production impact.** Recorded here in case future plan-checker iterations want to canonicalize the regex to match either form.

## Surfaced Production Concerns (for user awareness)

Per the plan's D-STOP-THE-LINE escalation policy: if a bug worse than V2/V3 sell-sim is uncovered, raise it as HONEY-13+ in the surfaced section so the user is aware.

**One bug was found this plan: `isBlacklistedTokenForChain` lacked try/catch (lines 357-361 pre-fix). Severity: LOW. NOT a D-STOP-THE-LINE trigger.**

Severity rationale (also documented in the milestone doc):

- **Failure mode:** `eth_getCode` RPC error propagates a Promise rejection up `Promise.all` in `bot.ts:229-238` parallel bank → `bot.ts` call-site catch → buy skipped, structured pino warn emitted.
- **Worst case:** the bot SKIPS a token it would have snipped (false-negative on a safe token; opportunity cost). The bot does NOT execute a buy on an unsafe token; the cascade is fail-closed at the call-site level.
- **Compared to V2 sell-sim (`simulateSellForChain`, `balance=0` hard-block):** V2 also failed-closed but at every snipe attempt for every token; the blacklist bug only fails when the RPC throws. V2 is worse.
- **Compared to V3 sell-sim (`simulateSellV3ForChain`, vacuous-pass lines 603-606):** V3 failed-OPEN — granted every buy on V3 honeypot candidates. Real-money loss possible. V3 is strictly worse.

**Determination:** D-STOP-THE-LINE NOT triggered. HONEY-13+ NOT created. Phase 18 close proceeds. The retrofit (commit `6e2676d`) brings the gate into uniform fail-closed-in-isolation compliance with the other 7 gates and the regression test (commit `67d247a`) locks the behavior in via CI.

**No other production bugs surfaced** during the audit. The 7 other gates (`checkHoneypotForChain`, `isLiquidityLockedForChain`, `isLiquiditySufficientForChain`, `checkTokenMetadataForChain`, `simulateSwapForChain`, `hasHighTransferTaxForChain`, `hasMaxWalletOrTxLimitsForChain`) were all already fail-closed in isolation; the regression contracts merely lock the existing behavior so it cannot regress.

## Threat Flags

No new threat surface beyond what the plan's `<threat_model>` already enumerates. All mitigations specified in the threat register were implemented as planned:

- **T-18-13 mitigated:** Task 2 retrofit `isBlacklistedTokenForChain` lines 359-365 (try `await ctx.httpProvider.getCode(...)` → catch returns `true` with structured warn log); Task 1 test file's first `it(...)` block exercises the throw path with `mockProvider.getCode.mockRejectedValueOnce(...)`.
- **T-18-14 mitigated:** 8 regression test files committed under `test/unit/safetyBank/`. The vitest unit project will fail in CI on any PR that regresses one of these gates to vacuous-pass.
- **T-18-15 accepted:** Adapter modules out-of-scope per CONTEXT D-AUDIT-BAR; documented under §"What Was NOT Audited" in the milestone doc with v6.18 audit deferral.
- **T-18-SC accepted:** Zero new packages; uses existing vitest infrastructure and Node built-ins only.

## Self-Check: PASSED

Verified files exist on disk:

- `test/unit/safetyBank/checkHoneypotForChain.test.ts`: FOUND
- `test/unit/safetyBank/isBlacklistedTokenForChain.test.ts`: FOUND
- `test/unit/safetyBank/isLiquidityLockedForChain.test.ts`: FOUND
- `test/unit/safetyBank/isLiquiditySufficientForChain.test.ts`: FOUND
- `test/unit/safetyBank/checkTokenMetadataForChain.test.ts`: FOUND
- `test/unit/safetyBank/simulateSwapForChain.test.ts`: FOUND
- `test/unit/safetyBank/hasHighTransferTaxForChain.test.ts`: FOUND
- `test/unit/safetyBank/hasMaxWalletOrTxLimitsForChain.test.ts`: FOUND
- `.planning/milestones/v6.17-safety-bank-audit.md`: FOUND (177 LOC; 8 per-gate rows; all required headers)

Verified commits in git log:

- `67d247a`: test(18-04): add 8 HONEY-11 per-gate regression contracts (Task 1) — FOUND
- `6e2676d`: fix(18-04): retrofit isBlacklistedTokenForChain with fail-closed try/catch (Task 2 / HONEY-11) — FOUND
- `53df941`: docs(18-04): add v6.17-safety-bank-audit.md milestone doc (Task 3 / HONEY-11) — FOUND

Verified plan acceptance criteria:

- Directory `test/unit/safetyBank/` exists with exactly 8 `.test.ts` files: PASS
- Each file's `describe` contains the canonical phrase `regression — never returns safe on edge cases`: PASS (verified via grep `regression — never returns safe on edge cases` over the 8 files)
- `npx vitest run --project unit test/unit/safetyBank/` exits 0 (8 test files, 24 tests, 1.72s): PASS
- `npx tsc --noEmit -p tsconfig.bot.json` exits 0: PASS
- Existing `test/unit/tokenSafety.test.ts` still passes (21/21 tests): PASS (no regression to original suite)
- `isBlacklistedTokenForChain` body now wrapped in try/catch with `return true` in catch + structured warn log: PASS (src/utils/tokenSafety.ts lines 357-365)
- Milestone doc contains all 8 gate function names in the per-gate findings table: PASS
- Milestone doc contains exactly 1 `fixed-in-flight` table-row disposition (isBlacklistedTokenForChain) and 7 `clean` dispositions: PASS
- Milestone doc contains explicit Stop-the-Line determination paragraph concluding "NOT triggered; HONEY-13+ NOT created": PASS
- Milestone doc contains Discriminated-Union Retrofit Decision paragraph deferring to v6.18: PASS

## Next Phase Readiness

**Plan 18-05 (Slither + Mythril audit on contracts/honeypot/HoneypotChecker.sol)** — READY: HONEY-11 audit completion does NOT block 18-05; both run in parallel per D-AUDIT-TIMING.

**Plan 18-09 (Option-D wrapper implementation + DELETE broken sell-sims)** — READY: D-AUDIT-TIMING gates plan 18-09 close on (a) ETH deploy live AND (b) all audit-discovered fixes merged. Both audit-bar plans (18-04 here and 18-05 next) feed into that gate; 18-04's contribution (fix `6e2676d` + audit doc `53df941`) is now merged. The remaining gate dependency is 18-05 audit closure + 18-07 ETH deploy.

**Plan 18-10 (bot.ts in-place V2/V3 gate replacement + parallel-bank HONEY-12)** — READY: the parallel-bank gates that 18-10 wires HONEY-12 alongside are now CI-locked at fail-closed semantics; any subsequent PR that breaks any of the 8 fails the unit project.

**Phase 18 close path** — UNBLOCKED on the HONEY-11 dimension. Per D-STOP-THE-LINE, the audit's verdict is "1 LOW-severity bug found and fixed in flight; not Stop-the-Line eligible; Phase 18 close proceeds." The cross-cutting D-AUDIT-TIMING gate now has 1 of 2 audit-fixes-merged dependencies satisfied (HONEY-11 / 18-04 closed). 18-05's audit findings + 18-07's ETH deploy remain on the critical path.

**v6.18 carry-forward (filed; not blocking):**
- `HONEY-V2-ADAPTER-AUDIT` — full per-adapter regression suite for `honeypotIs.ts` / `goplus.ts` / `unicrypt.ts` / `mudra.ts`.
- `HONEY-V2-UNION-RETROFIT` — unify all 8 parallel-bank gates on a `SafetyGateResult` discriminated union with explicit `verdict` + `evidence` fields.

No blockers for Phase 18 close from this plan. No carry-forward debt within v6.17 scope.

---
*Phase: 18-honeypot-detection-rebuild*
*Completed: 2026-05-15*
