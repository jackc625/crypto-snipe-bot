---
phase: 17
slug: tech-debt-cleanup-audit-baseline
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-06
---

# Phase 17 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail for the Tech Debt Cleanup & Audit Baseline phase (three sub-plans 17-01, 17-02, 17-03).

This phase has NO production runtime surface. Modifications are doc-only artifact (`v6.17-debt-baseline.md`), test additions / inline VALIDATION.md augmentations, CI workflow guards, and one dead-const deletion in `src/utils/db.ts`. No new bot code, no new API endpoints, no new network/DB/RPC paths.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Developer → committed planning docs | Doc-only artifact authored by phase 17-01; no runtime/network surface introduced | Plain markdown text, CI command stdout |
| Wave-0 CI command output → committed file (`v6.17-debt-baseline.md`) | Literal stdout captured into a versioned file; no parsing/transformation surface | TS error text, file paths |
| Test mock contracts (`vi.mock`) → production module imports | Tests dynamically substitute mocks at module-load. Same trust model as every other test in `test/{unit,integration}/` | Mocked function fixtures, placeholder addresses |
| Vitest runner exit code → CI gating | Failing test produces non-zero exit (vitest defaults; reinforced by Plan 17-03 CI guards) | Process exit code |
| Repo contents → CI workflow execution | New CI guard steps read filesystem and run `grep` + `npx tsc`; no secret access, no network egress | Workflow exit codes, grep output |
| `npx tsc` invocation → npm registry | `npx` resolves via existing `npm ci --legacy-peer-deps` install of pinned TypeScript dep | TypeScript binary execution |
| `grep -rEn 'it\.todo\(' test/` → repository contents | Read-only filesystem scan; no privilege escalation surface | grep output |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-17-01-01 | Tampering | `.planning/milestones/v6.17-debt-baseline.md` body | accept | Doc is in version control under `master`; tampering visible in `git diff` and review. Same trust model as every other planning doc in the repo. | closed |
| T-17-01-02 | Information Disclosure | Wave-0 CI command stdout (in baseline doc) | accept | `tsc` and `find` outputs contain no secrets — only filesystem paths and TS error text. Repo is private; treating filenames as non-sensitive is consistent with rest of `.planning/`. | closed |
| T-17-01-03 | Repudiation | Doc claims "verified-empty" without truthful CI run | mitigate | LITERAL stdout of 4 wave-0 commands committed verbatim in `.planning/milestones/v6.17-debt-baseline.md` lines 22-67 (Commands 1-4 fenced bash blocks with `exit=N` markers). Operator can re-run any command from the doc and compare. | closed |
| T-17-02-01 | Tampering | Mock matrix in `test/unit/exitEngineSell.test.ts` shared across describe blocks | accept | Vitest `mockReset: true` (vitest.config.ts) prevents call-history leakage; describe-block isolation via `beforeEach`. Existing pattern, not new attack surface. | closed |
| T-17-02-02 | Repudiation | Retroactive harm-prevention test passes without exercising the harm scenario (Pitfall #19/#20 rubber-stamp/hollow-fill) | mitigate | D-04 rigor verified — every `Phase N harm-prevention:` describe contains concrete observable-effect assertions: Phase 1 (`exitMonitor.test.ts:653,661,675` — `expect(...).toBe(true/false)` on lock acquire/release); Phase 3 (`db.test.ts:704,708` — `expect(count.c).toBe(0)` post-rollback); Phase 5 (`v3LiquidityWait.test.ts:132,135-138,141` — `expect(result).toBe(false)` + `loggerInfoMock.toHaveBeenCalledWith` + `onMock.toHaveBeenCalledWith`); Phase 6 (`riskManager.test.ts:184-185` — `expect(result.allowed).toBe(false)` + `expect(result.reason).toBe('daily_loss_limit')` + `warnMock.toHaveBeenCalledWith`); Phase 8 (`health.test.ts:158,160,163,165` — `expect(body.version).toBe(pkg.version)` dynamic equality); Phase 7 (`exitEngineSell.test.ts:296-305` — `toHaveBeenCalledTimes(1)` + `toHaveBeenCalledWith(expect.objectContaining({action:'sell',...}))`); Phase 10 (`exitEngineSell.test.ts:326+` — `insertTrade` called with `action='partial_sell'` + non-null amountOut). Note: WR-01/WR-02 commits downgraded the Phase 7 and Phase 10 describe-block titles to remove the "harm-prevention" prefix to honestly match coverage scope; the underlying observable-effect assertions remain intact. | closed |
| T-17-02-03 | Denial of Service | Long-running fake-timer test (Phase 5 V3-02 30s) hangs suite | mitigate | `test/integration/v3LiquidityWait.test.ts:84` calls `vi.useFakeTimers()`; line 127 calls `await vi.advanceTimersByTimeAsync(31_000)`; line 94 `vi.useRealTimers()` in afterEach. No real `setTimeout` waits. Vitest per-project testTimeout backstop confirmed in `vitest.config.ts`. | closed |
| T-17-02-04 | Information Disclosure | Test fixtures with real wallet/token addresses | accept | All addresses in new tests are placeholders: `0xharm-prev-A/B`, `0xharmprevtoken00…`, `0xstoplossharmprevhash…`, `0xpartialsellharmprevhash…`, `0xpool0000…`, `0xRaceToken`, `0xRaceToken2`. No real wallet keys, no live token contract addresses. | closed |
| T-17-02-05 | Elevation of Privilege | Real prod bug bypassed if D-07 stop-the-line ignored | mitigate | `17-02-SUMMARY.md` `## D-07 Stop-the-Line Status` (line 188) reports "Not triggered. All 7 new tests pass with their existing production-code targets. No real production bugs surfaced during retroactive validation. Phase 17 close is not blocked by this plan." Confirmed at lines 57, 94, 143, 256, 271. | closed |
| T-17-03-01 | Tampering | `.github/workflows/test.yml` modification | mitigate | Inspection of `.github/workflows/test.yml` (40 lines post-edit) confirms: appended steps invoke only `grep -rEn 'it\.todo\(...)' test/` and `npx tsc --noEmit -p <tsconfig>`. NO `curl`, NO `chmod`, NO `eval`, NO `wget`, NO `bash -c "$(...)"`. (Note: `find` was removed in WR-05 commit per refinement; the threat mitigation pattern of "filesystem reads + npx tsc only" is preserved — the change tightened, not loosened, the security posture.) | closed |
| T-17-03-02 | Elevation of Privilege | Attacker-supplied bash via `run:` block | mitigate | Inspection of `.github/workflows/test.yml` lines 20-39 confirms: bash payload is hard-coded verbatim. NO `${{ ... }}` interpolation of `github.event.*`, `github.head_ref`, PR-author input, or secret context anywhere in the new `run:` blocks. The only `${{ }}` patterns in the file are in pre-existing `actions/setup-node` config (`node-version: '22'`, `cache: 'npm'` — string literals, not expressions). pull_request runs base-branch workflow for forks (default GitHub Actions behavior). | closed |
| T-17-03-03 | Denial of Service | Future `.todo` commit blocks merge | accept | This is the intended behavior per D-09 strict ban. CI failure surfaces immediately; contributor switches to `it.skip('reason: ...')` per the comment at `.github/workflows/test.yml:22`. | closed |
| T-17-03-04 | Information Disclosure | `find test/` exposes filenames in CI logs | accept | Test filenames are non-sensitive in this repo. Same trust model as `npm run test:integration` which surfaces all test names on failure. Note: per WR-05, `find test/` was removed in favor of `grep -rEn` only — the disclosure surface narrowed since accept-disposition was recorded. | closed |
| T-17-03-05 | Repudiation | `getTradesByToken` deletion silently breaks undocumented caller (Pitfall #22) | mitigate | Pre-deletion `grep -rn 'getTradesByToken' src/ dashboard/ test/ scripts/` confirmed in `17-03-SUMMARY.md` Check 3 (lines 119-126): single match at `src/utils/db.ts:215` (the declaration itself), zero callers anywhere. Post-deletion verification: `grep -rn 'getTradesByToken' **/*.{ts,js,tsx,jsx}` (re-run by this audit) returns zero matches across the whole repo. Gating verifications recorded: tsc-clean × 3 + vitest 351/351 passing post-deletion (`17-03-SUMMARY.md` lines 280-289). | closed |
| T-17-03-06 | Tampering (supply chain) | Malicious npm dep via `npx tsc` | accept | TypeScript already pinned in `package.json`; no new dep introduced by Phase 17. `npm ci --legacy-peer-deps` (existing step pre-Phase-17) handles dep installation deterministically. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-17-01 | T-17-01-01 | Doc-only artifact under git version control on `master`; tampering visible in `git diff`/PR review. Identical trust model to every other planning doc. | Phase 17-01 plan author (gsd-plan-phase) | 2026-04-30 |
| AR-17-02 | T-17-01-02 | Wave-0 stdout contains only filesystem paths and TS error text — no secrets, tokens, or PII. Repo is private; baseline doc filenames consistent with rest of `.planning/`. | Phase 17-01 plan author | 2026-04-30 |
| AR-17-03 | T-17-02-01 | Mock-matrix sharing in `test/unit/exitEngineSell.test.ts` is the established existing pattern; Vitest `mockReset: true` + `beforeEach` reset prevents leakage. No new attack surface introduced by appending Phase 7/10 describes. | Phase 17-02 plan author | 2026-04-30 |
| AR-17-04 | T-17-02-04 | All test fixture addresses are explicit placeholders (`0xharm-prev-*`, `0xharmprevtoken*`, `0xpool*`, `0xRaceToken*`). Convention matches existing tests. | Phase 17-02 plan author | 2026-04-30 |
| AR-17-05 | T-17-03-03 | Strict `.todo` ban is intentional per D-09; CI rejection of new `.todo` invocations surfaces issue immediately and contributor uses `it.skip('reason: ...')` (escape hatch documented in workflow comment at `.github/workflows/test.yml:22`). | Phase 17-03 plan author | 2026-04-29 |
| AR-17-06 | T-17-03-04 | CI log surface for filenames is the same disclosure model as existing `npm run test:integration` step. Test filenames non-sensitive. | Phase 17-03 plan author | 2026-04-29 |
| AR-17-07 | T-17-03-06 | TypeScript dep already pinned in `package.json` and installed via existing `npm ci --legacy-peer-deps`. No new third-party action, dep, or external network call introduced by Phase 17. | Phase 17-03 plan author | 2026-04-29 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-06 | 14 | 14 | 0 | gsd-security-auditor (Claude) |

### Verification Evidence Summary

**Mitigate threats (7) — all verified by file inspection or grep:**

- **T-17-01-03** — `.planning/milestones/v6.17-debt-baseline.md` lines 22-67 contain literal stdout of 4 wave-0 commands in fenced ```bash blocks with `exit=N` markers. Re-runnable verbatim.
- **T-17-02-02** — All 5 `Phase N harm-prevention:` describe blocks (Phases 1, 3, 5, 6, 8) contain concrete `expect(...).toBe(...)` / `toHaveBeenCalled*` observable-effect assertions per D-04. Phases 7 and 10 retain the underlying assertions (verified at `test/unit/exitEngineSell.test.ts:296-305, 326+`) though their describe titles were intentionally refined per WR-01/WR-02 fix commits to honestly match the coverage scope (call-shape contract, not end-to-end pollExitStrategy wiring). Audit-grep query: `grep -rEn '^describe.*Phase [0-9]+ harm-prevention:' test/` → 5 matches (Phase 1, 3, 5, 6, 8).
- **T-17-02-03** — `test/integration/v3LiquidityWait.test.ts:84` `vi.useFakeTimers()`, line 127 `await vi.advanceTimersByTimeAsync(31_000)`, line 94 `vi.useRealTimers()` afterEach — confirmed.
- **T-17-02-05** — `17-02-SUMMARY.md:188` `## D-07 Stop-the-Line Status` reports "Not triggered". 6 references throughout SUMMARY confirm no production bugs surfaced.
- **T-17-03-01** — `.github/workflows/test.yml` (40 lines): appended steps run only `grep` and `npx tsc`. Zero matches for `curl|chmod|eval|wget` in new `run:` blocks.
- **T-17-03-02** — Zero `${{ github.event.* }}`, `${{ github.head_ref }}`, `${{ secrets.* }}` interpolation in new `run:` blocks (lines 20-39). Bash payload is hard-coded verbatim.
- **T-17-03-05** — Post-deletion `grep -rn 'getTradesByToken'` across `**/*.{ts,js,tsx,jsx}` returns 0 matches (re-verified by this audit). `17-03-SUMMARY.md` lines 119-126 record pre-deletion Pitfall #22 dependency-search guard returning single match at the declaration site itself; tsc + vitest gating verifications passed post-deletion.

**Accept threats (7) — all documented in Accepted Risks Log above (AR-17-01..07).**

**No transfer disposition threats in Phase 17.**

### Unregistered Flags

None. Both `17-02-SUMMARY.md` and `17-03-SUMMARY.md` were inspected; neither contains a `## Threat Flags` section, and no executor flagged new attack surface during implementation. Phase 17 was scoped as a pre-substantive-work cleanup (doc + test + CI guards + one dead-const deletion) with no production runtime surface — consistent with the absence of new threat flags.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (7 entries: AR-17-01..07)
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-06
