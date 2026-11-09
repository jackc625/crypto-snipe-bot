---
phase: 22-safety-rails-audit
verified: 2026-11-09T07:00:00Z
status: passed
score: 4/5 must-haves verified
covered_files: [".planning/audit/SEAL.json",".planning/baselines/ac19-run.json",".planning/phases/22-safety-rails-audit/22-01-PLAN.md",".planning/phases/22-safety-rails-audit/22-01-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-02-PLAN.md",".planning/phases/22-safety-rails-audit/22-02-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-03-PLAN.md",".planning/phases/22-safety-rails-audit/22-03-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-04-PLAN.md",".planning/phases/22-safety-rails-audit/22-04-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-05-PLAN.md",".planning/phases/22-safety-rails-audit/22-05-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-06-PLAN.md",".planning/phases/22-safety-rails-audit/22-06-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-07-PLAN.md",".planning/phases/22-safety-rails-audit/22-07-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-08-PLAN.md",".planning/phases/22-safety-rails-audit/22-08-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-09-PLAN.md",".planning/phases/22-safety-rails-audit/22-09-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-10-PLAN.md",".planning/phases/22-safety-rails-audit/22-10-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-11-PLAN.md",".planning/phases/22-safety-rails-audit/22-11-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-12-PLAN.md",".planning/phases/22-safety-rails-audit/22-12-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-13-PLAN.md",".planning/phases/22-safety-rails-audit/22-13-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-14-PLAN.md",".planning/phases/22-safety-rails-audit/22-14-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-15-PLAN.md",".planning/phases/22-safety-rails-audit/22-15-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-16-PLAN.md",".planning/phases/22-safety-rails-audit/22-16-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-17-PLAN.md",".planning/phases/22-safety-rails-audit/22-17-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-18-PLAN.md",".planning/phases/22-safety-rails-audit/22-18-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-19-PLAN.md",".planning/phases/22-safety-rails-audit/22-19-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-20-PLAN.md",".planning/phases/22-safety-rails-audit/22-20-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-21-PLAN.md",".planning/phases/22-safety-rails-audit/22-21-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-22-PLAN.md",".planning/phases/22-safety-rails-audit/22-22-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-23-PLAN.md",".planning/phases/22-safety-rails-audit/22-23-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-24-PLAN.md",".planning/phases/22-safety-rails-audit/22-24-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-25-PLAN.md",".planning/phases/22-safety-rails-audit/22-25-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-26-PLAN.md",".planning/phases/22-safety-rails-audit/22-26-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-27-PLAN.md",".planning/phases/22-safety-rails-audit/22-27-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-28-PLAN.md",".planning/phases/22-safety-rails-audit/22-28-SUMMARY.md",".planning/phases/22-safety-rails-audit/22-29-PLAN.md",".planning/phases/22-safety-rails-audit/22-29-SUMMARY.md","scripts/capture-baselines.ts","scripts/check-vi-mock-paths.ts","src/guards/singleton.ts","src/main.ts","src/utils/dbPath.ts","src/utils/processLock.ts","test/rails/core.cjs"]
covered_digest: "v4:sha256:8ca6903b6ed0e74c2fa055f941d3499656e796275ee1328bf84a5219197fed9b"
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "SC2: each test-isolation rail is RED-proven under every test project, including the fork project (AC-13, AC-16, AC-17, moved AC-22 live-bytecode test)"
    test: "In Phase 25, run the real `npm run test:fork` (starts Hardhat) wrapped by scripts/verify-prod-untouched.ts and check UFV-01..UFV-05 by name"
    expected: "test/fork/rails/forkRails.fork.test.ts passes (6 tests), the Hardhat child receives only the sanitized env, no Telegram send occurs, and test/fork/honeypotDeploy.eth.fork.test.ts finds the real HoneypotChecker bytecode on mainnet"
    why_human: "Phase 22 may not start Hardhat (AC-08). The fork-project halves have run only as a Hardhat-free rehearsal config, and UFV-04 (Hardhat child env in test/fork/setup.ts) has no rehearsal at all, only a pure-env unit test and an AST check. The operator ruled accept-rehearsal-plus-obligation."
human_verification:
  - test: "UFV-01..UFV-05 real fork run (Phase 25 obligation)"
    expected: "All five obligations pass in a real Hardhat-backed `npm run test:fork` with the prod-untouched wrapper. UFV-05 is the only check that confirms the HoneypotChecker contract exists on mainnet."
    why_human: "Cannot be run in Phase 22 by operator rule. Rehearsal proves test wiring only; the UFV-05 bytecode in the rehearsal came from a loopback fake."
  - test: "D-14 second outside opinion decision"
    expected: "Operator confirms that one outside assistant (codex, Docker, no tools, code embedded in the prompt) is sufficient for the money slices, given agy was excluded by the ruling 'codex a, agy c'. Also confirms awareness that the 22-27 host containment probe sent package.json (dependency names and scripts only) to OpenAI."
    why_human: "Coverage is a judgment about adequacy of the audit, not something code can prove. The audit itself found its register mechanically complete."
  - test: "AUD-REAUDIT-001 (rehearsal config read the repo env file before a08d650)"
    expected: "Operator accepts that those rehearsal runs very likely read the real env file into the Vitest main process, a conclusion that rests on the code path and fake-file runs. 11 earlier rehearsal runs predate the fix; nobody observed the file."
    why_human: "Absence of a file read cannot be observed after the fact."
  - test: "SAFE-04 lock-folder scope (WR-02, deferred to Phase 24)"
    expected: "Operator accepts that the process lock is keyed to the OS user and HOME/USERPROFILE, so a second bot under another OS user, or with HOME changed, is not excluded."
    why_human: "Design choice (machine-wide lock location) deliberately deferred; REQUIREMENTS wording is met for the normal same-user case only."
---

# Phase 22: Safety Rails & Audit Verification Report

**Phase Goal:** Irreplaceable state is backed up and verifiable, and no test, tool, or second process can reach production state (live DB, real `.env`, network, Telegram, wallet). Then every area of the codebase is audited read-only, working from the code itself rather than prior VERIFICATION docs. The audit yields a findings register, a bug-class sweep, a thresholds inventory, and an operator decision card for every behavior-changing recommendation.
**Verified:** 2026-11-09
**Status:** human_needed
**Re-verification:** No, initial verification

All of the goal is present in the codebase, and I found no failed truth and no blocker. Two things stop this from being `passed`. The fork-project halves of the isolation rails are only rehearsed, not run for real (five tracked obligations, UFV-01..UFV-05, owned by Phase 25). A few residual-risk judgments also belong to the operator. Open S0/S1 entries in the register are the phase's output, not gaps.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Out-of-repo backup with hash manifest taken before any install/Hardhat/sweep/relocation; `ignition/deployments/` then tracked in git, hash-matching the backup (OD-21) | VERIFIED | `.planning/baselines/backup-record.json`: dated folder + archive, 17 manifest entries (10 ignition, 6 data, 1 root), inventory `missing: []`. Phase-start SHA `23a6461`; `phase-end-checks.json` AC-02 shows no commit touching `package-lock.json` or `hardhat.config.ts` since phase start, and AC-08 shows the Hardhat cache/artifacts folders untouched since before the phase. `safe01-offmachine.json` status VALID: the Google Drive copy was re-verified from downloaded bytes (operator ruling). OD-21 commit `93f8189` is an ancestor of HEAD; IGN_AC07 recomputed 10/10 raw-byte SHA-256 matches between working tree, `git cat-file HEAD:<path>` and manifest. I re-ran `verify-prod-untouched.ts` with `node -e 0` against the manifest: `verdict: untouched`, all `data/` files equal the manifest, so the live DB has not changed. |
| 2 | Full test run leaves `bot.db` checksum+mtime unchanged, no Telegram, no outbound network; each rail RED-proven; without booting `src/bot.ts` | VERIFIED for unit and integration projects; PRESENT_BEHAVIOR_UNVERIFIED for the fork-project halves (see item below) | `ac19-run.json` (full `npm test` under the wrapper): exit 0, 1200 passed / 0 failed, `verdict: untouched`, `manifest_match: true`, before/after sha256 and mtimeMs identical for `bot.db`, `-wal`, `-shm`, `nonLoopbackAllowed: 0`, `telegramAllowed: 0`, `notifier_refused: 6`, net-watch ok with 0 non-loopback connections (106 samples). `red-proofs/INDEX.md` lists 30 rails/guards, each with the file/line switched off and the test that went RED, GREEN rerun in the proof file. The rails are real mechanisms, not mocks: `test/rails/core.cjs` patches the native addon constructor, connect/dgram and file-read at runtime, and `src/utils/db.ts`, `dbPath.ts` and `notifier.ts` carry src-layer refusals. `src/main.ts` refuses when `VITEST` is set; `src/bot.ts` line 2 imports `./guards/directEntry` first. `scripts/check-vi-mock-paths.ts` ran now: 584 mock calls in 173 files, 0 violations, wired into `.github/workflows/test.yml` and `package.json`. |
| 3 | Re-runnable capture script commits before-baselines (npm ls/audit, ESLint by rule and file, per-project test counts, coverage list, bot.db checksum); same script produces after-baselines | VERIFIED | `.planning/baselines/before/` holds all nine files. `scripts/capture-baselines.ts` accepts `--phase before|after`, with after mode wired (lines 650-688). Test counts: unit 759 to 937, integration 216 to 263 (sum 1200, equals `ac19-run.json`), so the review's concern WR-06 (a failed collection recorded as 0) did not actually occur here. Fork counts are AST-static (33 to 40), taken without Hardhat. |
| 4 | `AUDIT-FINDINGS.md` covers src/, dashboard/, test/, scripts/, contracts tooling; every entry (incl. 28 research candidates) has S0-S4, capital class, evidence, filled sibling-sites field, lifecycle status; 20-class sweep incl. full-history secret scan; thresholds inventory incl. OD-25; audit wave changed no source file | VERIFIED | 287 finding JSON files (S0 1, S1 50, S2 87, S3 87, S4 62), 9,452-line rendered register. I scripted a check across all 287: zero with empty `sibling_sites_checked`, zero with empty `evidence`. All 28 `RC-01..RC-28` appear (`CONSOLIDATION.json` `rc_map` has 28 keys). Statuses: 243 confirmed, 32 candidate, 10 fixed, 2 NOT-A-BUG. Slices cover ANTIRUG/API/BUY/CONTRACTS/DASH/DB/EXIT/SCRIPTS/TESTI/TESTU/TX plus ROOT/SECRET/CENSUS/REAUDIT contributions; `classes.json` plus 15 sweep files; 7 thresholds files plus a 153-key env discovery-completeness check with `unmapped: []`. Full-history scan: 1,053 commits, 50 hits, 0 non-public after the operator ruling (ESC-SECRET-02, 4 scanner false positives); signing-site census exists. AC-33 in `phase-end-checks.json` (all 87 audit-wave commits touch only `.planning/`); I confirmed `git diff --name-only 93d9029 HEAD` lists no path outside `.planning/`. `check.ts --stage final` printed `RESULT PASS stage=final fail=0 pending=0 warn=0`. |
| 5 | `OPERATOR-DECISIONS.md` holds an ID'd card for every behavior-changing recommendation; capital-area cards (OD-6, OD-11, OD-14 to OD-18) present | VERIFIED | 57 decision JSON files and 989 lines of rendered cards; OD-6, OD-9, OD-10, OD-11, OD-14..18, OD-21, OD-25 and OD-26..OD-59 all exist. Scripted check: no finding with a behavior-changing recommendation lacks an `od_ref`. |

**Score:** 4/5 truths fully verified; 1 (SC2) is verified for unit and integration but has fork-project halves that are present and rehearsed, not exercised.

### Seal and Integrity

| Check | Result |
|-------|--------|
| `seal-verify.ts --scan` | `SEAL VALID`; 0 hits in `93d9029..5ad7176`; post-seal changes are limited to exempt paths (REQUIREMENTS, ROADMAP, STATE, SEAL.json, phase-scan.json, 22-29-SUMMARY, 22-VALIDATION) |
| Working tree | Only `.planning/state.json` (exempt) and an untracked `.review-diagnostics/` folder; no source drift |
| Branch | `phase-22-safety-rails-audit` |

### Requirements Coverage

| Requirement | Source plans | Status | Evidence |
|-------------|--------------|--------|----------|
| SAFE-01 | 22-01, 02, 03, 06, 07, 29 | SATISFIED | backup-record, safe01-offmachine (VALID), od21-record, IGN_AC07 (SC1) |
| SAFE-02 | 22-05, 08, 09, 10, 11, 15, 29 | SATISFIED for unit/integration; fork halves open (UFV-01..05) | `ac19-run.json`, RED-proof rows 1-21 |
| SAFE-03 | 22-12, 15 | SATISFIED | `registerSingleton` in nonceAuthority, exitEngine, exitManager and anti-rug detector; `forceConsistentCasingInFileNames` present in all three tracked tsconfigs (`tsconfig.json`, `tsconfig.bot.json`, `dashboard/tsconfig.json`), asserted by `tsconfigCasing.test.ts`; RED rows 22-23 |
| SAFE-04 | 22-13 | SATISFIED for same-user case; scope limit noted | `src/utils/processLock.ts` uses an exclusive SQLite lock pinned on `globalThis`, acquired in `src/main.ts`, with fail-closed on any non-held error; RED rows 24-26. Limit: lock folder follows OS user and HOME (WR-02, deferred to Phase 24) |
| SAFE-05 | 22-09 | SATISFIED | `src/utils/dbPath.ts`: absolute resolution, `user_version` read-only probe, `DB_REFUSED_UNINITIALISED`, `npm run db:init`; RED rows 10-13 |
| SAFE-06 | 22-14 | SATISFIED | gate runs clean now (0 violations) and in CI; RED rows 27-28 |
| SAFE-07 | 22-16 | SATISFIED | `baselines/before/` complete; after mode implemented |
| AUDIT-01 | 22-04, 06, 17-25, 27-29 | SATISFIED | SC4 |
| AUDIT-03 | 22-02, 04, 17-29 | SATISFIED | 15 sweep files, 20-class matrix, secret scan, signing census |
| AUDIT-04 | 22-17..22, 25, 28 | SATISFIED | 7 thresholds files, OD-25 card, env discovery-completeness |
| AUDIT-05 | 22-04, 17..22, 25, 28 | SATISFIED | SC5 |

No orphaned requirements: REQUIREMENTS.md maps exactly SAFE-01..07 and AUDIT-01, 03, 04, 05 to Phase 22, and every one is claimed by at least one plan. AUDIT-02, AUDIT-06 and AUDIT-07 are mapped to Phases 23 and 29, not here.

### Anti-Patterns and Code-Review Items

| Item | Severity | Impact |
|------|----------|--------|
| WR-02 lock folder follows HOME/USERPROFILE (deferred, Phase 24) | Warning | A second bot under another OS user or changed HOME is not excluded. Documented in `processLock.ts`. |
| WR-06 failed baseline collection could record 0 and pass NAC-04 (deferred) | Info | Not triggered: counts are real (759/937, 216/263). |
| WR-07 CI `test` job has no timeout; IN-01..IN-04 (`process.loadEnvFile` not railed, spawn path limit does not resolve links, `--out` default, net-watch early exit cannot fire) | Info | All dispositioned `deferred` in `22-REVIEW-DISPOSITION.md`; none contradicts a ROADMAP criterion. |
| Debt markers (TBD/FIXME/XXX) in files this phase modified | None found in spot checks | Not exhaustively scanned; the phase edited few `src` files, all rail code. |

Fixed during the phase: AUD-BUY-034 (VITEST in env disabled the real-DB guard), AUD-DB-023/024, AUD-REAUDIT-001, AUD-TX-004/005, AUD-TESTQ-001..003.

### Weighing the Known Limits

- **P9 slip:** I grepped all 287 findings for references to SUMMARY or VERIFICATION docs. The only hit is `AUD-SECRET-001`, which lists file paths from secret-scan hits; it is not an audit anchor. Soft anchoring cannot be excluded but I found no evidence of it.
- **D-14:** partly covered (one outside assistant). Left as a human decision item; it affects confidence, not any criterion's wording.
- **Fork halves:** counted as PRESENT_BEHAVIOR_UNVERIFIED. They are not rounded up. The `fork-acceptance.json` ruling is `accept-rehearsal-plus-obligation`.
- **Unrailed Vitest main process:** `ac19-run.json` states its evidence basis. The ledger counts allows by construction; net-watch is a sampled check that can miss short connections. The result "no outbound call" therefore rests on the choke-point ledger plus sampling, not a packet capture.
- **Money-path caution:** each rail has a RED proof that switches off the real mechanism, and I checked that the proven mechanisms are the ones in the shipped code (`src/main.ts`, `src/bot.ts` line 2, `src/utils/processLock.ts`, `src/utils/dbPath.ts`).
- **VALIDATION `nyquist_compliant: false`:** consistent with the five open items; I agree with it.

### Gaps Summary

No gaps. Nothing in the phase goal is failed or missing. Status is `human_needed` because of the five Phase 25 fork obligations plus three operator judgments (D-14 coverage, AUD-REAUDIT-001, SAFE-04 lock scope). Open S0/S1 findings (one S0, AUD-BUY-001, plus 50 S1) are the audit's deliverable and flow into Phases 23 and 24.

---

_Verified: 2026-11-09_
_Verifier: Claude (gsd-verifier)_

## Post-ship amendment (2026-11-09)

The first CI run on PR #2 failed, so the seal details earlier in this report are superseded.

- **Cause:** two rail test files assumed the gitignored `data/` folder exists, and CI never installed the dashboard's own packages before type-checking it.
- **Fixes (`ea193b8`):** the two test files, the CI workflow, and a setup hook in `deliberateBuyArmMonitoring.test.ts` so the cold import of `src/bot` no longer counts against its first test.
- **Register:** AUD-TESTQ-036, AUD-TESTQ-037 and AUD-CONTRACTS-006 are added and marked fixed, taking the register from 287 to 290 findings.
- **Seal:** moved from `93d9029` to `1d1dd17` by the same steps as the original: re-audit of the changed files, `check.ts --stage final`, the end-of-phase checks, and the phase-wide secret scan (213 commits, 0 hits). No path was added to the exempt list.
- **Verdicts unchanged:** `src/` and `test/rails/core.cjs` were not touched by these fixes.
