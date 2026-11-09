---
gsd_state_version: "1.0"
milestone: v7.0
milestone_name: Full Audit & Modernization
current_phase: 23
current_phase_name: Test Safety Net (Harness, Triage, Characterization)
status: planning
stopped_at: Phase 22 complete, ready to plan Phase 23
last_updated: "2026-11-09T13:43:51.711Z"
last_activity: 2026-11-09
last_activity_desc: "Phase 22 shipped as PR #2"
state_head: 776858c5d96f37adc468bae8d545b22d93cfb7b3
progress:
  total_phases: 11
  completed_phases: 1
  total_plans: 29
  completed_plans: 29
  percent: 9
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-06 at v7.0 milestone start; deliberately not edited at the Phase 22 close because it is outside the audit seal exempt list)

**Core value:** Reliably detect, validate, and profitably snipe new token listings across multiple EVM chains with proper risk management — never lose money to preventable bugs, race conditions, or security flaws.
**Current focus:** Phase 23 — Test Safety Net (Harness, Triage, Characterization)

## Current Position

Phase: 23 — Test Safety Net (Harness, Triage, Characterization)
Plan: Not started
Status: Ready to plan
Last activity: 2026-11-09 -- Phase 22 shipped as PR #2
Roadmap: .planning/ROADMAP.md — v7.0 Phases 22–32 (11 phases), 101/101 requirements mapped; risk isolation lives in waves/plans/commits; decimal phases reserved for D-STOP-THE-LINE insertions

## Milestone Baseline (measured 2026-11-06, cold start after 5 months)

- **Oversized files:** `src/bot.ts` 2,361 · `src/anti-rug/detector.ts` 2,295 · `src/exitEngine.ts` 2,045 · `src/chainRegistry.ts` 1,089 · `src/preflight.ts` 1,011 lines. `src/utils/` holds db / txManager / tokenSafety / mevStrategies / honeypot / safetyProviders.
- **Lint:** `npx eslint src` → 350 errors / 22 warnings (no `lint` script; not in CI). Top rules: no-unsafe-assignment 102, no-unsafe-member-access 78, no-unused-vars 34, no-unsafe-call 33, no-floating-promises 26, no-misused-promises 16.
- **Security:** `npm audit` → 11 prod vulns (1 critical `proxy-addr`; high `axios`, `ws`, `body-parser`, `form-data`, `ip-address`) / 67 total.
- **Outdated majors:** hardhat 2.26→3.x, typescript 5.8→7.x, vitest 4→5, eslint 9→10, chai 4→6, better-sqlite3 12→13, dotenv 17→18, uuid 13→14, @types/node 22→26, @nomicfoundation/* → 3.x/4.x. `ts-node` in use. CI installs with `--legacy-peer-deps`.
- **Tooling gaps:** no formatter; tracked junk (`.DS_Store`, `.idea/`); `package.json` `main: dist/index.js` (nonexistent).
- **CI (`.github/workflows/test.yml`):** unit + integration + `.todo` ban + root-doc ban + `tsc --noEmit` ×3; contracts-gated hardhat-compile / slither / mythril. No lint, format, audit, or coverage gate.
- **Tests:** 131 test files (759 unit + 216 integration + fork at v6.17 close).

## Carry-Forward (deferred past v7.0)

- **HONEY-04** — deploy `HoneypotChecker.sol` on BSC/Base/Arbitrum (plan 18-08; redeploy ETH with the 18-REVIEW-FIX Solidity hardening; contractual re-audit trigger when 18-08 ships). Fail-closed today.
- **ANTIRUG-15** — resolve BSC/Base/Arb V3 anti-rug allowlists (ETH resolved). Tied to HONEY-04.
- Candidates (not committed): CHAIN-05 fully-dynamic capital allocation · DETECT-01 mempool/block-0 sniping · OPS-V2-01 synthetic-monitor canary-trade watchdog.

## Blockers / Concerns

- **Merge Phase 22 before starting Phase 23:** `phase-22-safety-rails-audit` is unmerged and has no copy on GitHub, and new phase branches start from `main`. `main` tracks only 4 of the 10 `ignition/deployments/` files (see the checkout warning under Operating Notes). Run `/gsd-ship 22` first.
- **Phase 25 owes the real fork run (UFV-01..UFV-05):** deferred at the Phase 22 UAT on 2026-11-09; Phase 25 success criterion 6 names the five checks. Until then the fork-project halves of the isolation rails are rehearsed only.
- **Phase 24 item (found by the 22 security audit after the seal):** the startup DB probe copies a WAL-mode database to the OS temp folder, and a crash or failed cleanup can leave that copy behind (trade data, no keys). Not in the sealed register; see 22-SECURITY.md.
- **ESC-PRE-04 (D-STOP-THE-LINE record, routed to Phase 24):** dashboard emergency-sell/force-sell skip still-held failed-exit positions (traced in 22-04/22-22; fix routed to Phase 24). Recorded at the 2026-11-06 replan; restored here after `state.begin-phase` overwrote Current Position.
- **Pending decision for Phase 29 (HYG-03), card SCRIPTS-01 (ESC-SCRIPTS-01):** how signing scripts exclude the running bot. The operator answered "Acknowledge. Decide in phase 29" on 2026-11-07. The D-06 premise challenge (try-acquire-then-release leaves a check-then-act race) is open, not resolved, and the D-06 wording is unchanged. Phase 29 must rule on SCRIPTS-01 together with BUY-01 (Phase 24 outcome) before planning HYG-03. hold-lock is recommended.

## Operating Notes (carry to next session)

- **Bot is OFF for all of v7.0** — no live trading until the milestone's fork rehearsal + live roundtrip re-entry gate passes.
- **Phase 22 Node runtime (CONTEXT D-21):** run on Node 22.16.0 by absolute path (`C:\Users\jackc\AppData\Local\nvm\v22.16.0\node.exe`, ABI 127); the global Node 24 cannot load better-sqlite3. No `npm rebuild`.
- **Phase 22 test ban (CONTEXT D-13):** no `npm test` / `vitest` in the main checkout until the rails land (plan 22-08 is the first sanctioned run; 22-15 the first full-suite run).
- **Bot start:** `npx ts-node src/main.ts` or `npm start` (the single-instance lock is taken first; `src/bot.ts` refuses to self-start; entry point may change when `ts-node` is replaced this milestone — update this note). **Read-only cold-start check:** `npm run preflight` (there is no dry-run boot mode — never boot src/main.ts or src/bot.ts to "test"). Stop the bot by force-killing the ts-node PID (npx swallows Ctrl+C on Windows+bash).
- **Per-phase branching** (changed 2026-11-06) — GSD creates `phase-{N}-{slug}` per phase off `main` (default branch renamed from `master` 2026-11-06); no worktrees.
- **Green suite caveat** — the unit suite has repeatedly masked capital-safety/money-path bugs on this project by mocking the mechanism under test; rely on real-path integration checks + deep code-review + RED-proven tests for money-path changes.
- **`ignition/deployments/` is tracked from Phase 22 (OD-21, commit 93f8189).** Until the Phase 22 branch merges into `main`, checking out `main` (or any branch without these files) makes git delete the journals and artifacts from the working tree; stay on the phase branch, or restore with `git checkout phase-22-safety-rails-audit -- ignition/deployments` or from the verified backup (`C:/Users/jackc/crypto-snipe-bot-backups/2026-11-06`). With `core.autocrlf=true` a re-checkout writes CRLF working copies while the blobs stay LF; the `.gitattributes` fix belongs to Phase 25 (AUD-OD21-001). The Phase 22 closing plan (22-29, check IGN_AC07) re-hashes these files against the backup manifest and stops the phase if any is missing or changed.
- **Behavior preservation** — v7.0 refactors must not change trading behavior; any behavior change is an explicit, logged operator decision.

## Performance Metrics

**v6.17:** 8 phases · 69 plans · 45 days (2026-04-14 → 2026-05-29) · 491 commits · ~170 code files (+45,384 / −661 in src/test/scripts).
**v6.16 (reference):** 16 phases · 55 plans · 26 days · 395 commits. Per-plan detail in `milestones/v6.16-ROADMAP.md`.

---
*STATE.md hand-reset to the v7.0 milestone start on 2026-11-06. Prior milestone history preserved in git and the `milestones/` archives.*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 22 P01 | 16min | 2 tasks | 4 files |
| Phase 22 P02 | 39min | 3 tasks | 9 files |
| Phase 22 P04 | 24min | 2 tasks | 20 files |
| Phase 22 P05 | 6 min (continuation) | 2 tasks | 11 files |
| Phase 22 P03 | 4min | 3 tasks | 1 files |
| Phase 22 P06 | 41min | 2 tasks | 4 files |
| Phase 22 P07 | 4min | 2 tasks | 11 files |
| Phase 22 P08 | 24min | 3 tasks | 24 files |
| Phase 22 P17 | 66min | 3 tasks | 43 files |
| Phase 22 P18 | 10h 4m (wall-clock incl. operator wait) | 3 tasks | 39 files |
| Phase 22 P19 | ~36min (wall-clock incl. operator wait) | 3 tasks | 29 files |
| Phase 22 P20 | 44min | 3 tasks | 27 files |
| Phase 22 P21 | 35min (wall-clock incl. operator wait) | 3 tasks | 33 files |
| Phase 22 P22 | 58min | 3 tasks | 39 files |
| Phase 22 P23 | 30min | 2 tasks | 26 files |
| Phase 22 P24 | 33min | 2 tasks | 30 files |
| Phase 22 P25 | 36min (continuation; incl. operator wait) | 3 tasks tasks | 33 files files |
| Phase 22 P26 | 51min (wall-clock incl. two operator waits) | 2 tasks | 16 files |
| Phase 22 P27 | 27h 44m | 3 tasks | 120 files |
| Phase 22 P09 | 22min | 3 tasks | 14 files |
| Phase 22 P10 | 11min | 3 tasks | 18 files |
| Phase 22 P28 | 10 min | 2 tasks | 224 files |
| Phase 22 P11 | 14min | 3 tasks | 23 files |
| Phase 22 P12 | 11min | 3 tasks | 16 files |
| Phase 22 P13 | 17min | 3 tasks | 24 files |
| Phase 22 P14 | 8min | 2 tasks | 17 files |
| Phase 22 P15 | 18min (continuation) | 2 tasks | 15 files |
| Phase 22 P16 | 18min | 2 tasks | 11 files |
| Phase 22 P29 | 28min | 3 tasks | 79 files |

## Session

**Last session:** 2026-11-09T07:34:11.578Z
**Stopped at:** Phase 22 complete, ready to plan Phase 23
**Resume file:** None

## Decisions

- [Phase 22]: 22-01: Ignition artifact rule observed on disk - each future id X in deployed_addresses.json has artifacts/X.json AND artifacts/X.dbg.json; backup-state.ts requires both
- [Phase 22]: 22-01: SAFE-01 local backup verified at C:/Users/jackc/crypto-snipe-bot-backups/2026-11-06 (17 PRESENT); archive crypto-snipe-bot-state-2026-11-06.tar.gz sha256 4c8e9ab6a70b93a4d408046bebe916d29c95f93cacb47d0b50abcddfb07a1d1a is the file 22-03 uploads
- [Phase 22]: 22-01: phase_start_sha = 23a64617dca167976adc4645fed0e2c69e384820 (committed first, df33999); backup-tool commit 3f380bf
- [Phase 22]: 22-02: ESC-SECRET-01 closed by operator ruling (verbatim) classify-addresses - hits whose flagged secret is exactly 0x+40hex are labelled public-address and stay listed; implemented as pass 3 public-address.toml (known-public.toml + one regexTarget=secret allowlist ^0x[0-9a-fA-F]{40}$), default ruleset/global filter untouched
- [Phase 22]: 22-02: NAC-01 scanner half CLEAN - dated folder + archive 852 hits, 0 non-public, 852 public-address; FIXTURES.json config_sha256 now has 3 keys (extended, known_public, public_address); 22-03 re-scan must use fixture-check.ts --scan
- [Phase 22]: 22-02: betterleaks dir mode skips data/bot.db whole (byte-count proven); 22-03 operator-run D-22 exact-value check is the SQLite control
- [Phase 22]: 22-04: audit register built on one enumerator (full-tree git ls-tree -r -z filtered in JS by literal entries; glob/brace rejected) + independent universe (scope.json); audit_base_sha 23a6461; base counts match plan exactly; universe clean at base (861) and HEAD (875)
- [Phase 22]: 22-04: check.ts stages partial (unfinished work = PENDING) / consolidation / final (HEAD universe + re_audit to last-change SHA); self-test 18/18 with 18 mutants caught; audit tools are run(argv, io) for in-process testing
- [Phase 22]: 22-04: ESC-SECRET-01 fits the canonical escalation shape unchanged (input: aliases resolve via its closed resolution); rediscovery = later record lists canonical in resolved_items and duplicate keeps canonical escalation_ref
- [Phase 22]: 22-04: ESC-PRE-04 seeded (capital, d-stop-the-line, STRAND) with refs re-measured at 23a6461 (controls.ts:51-56/:70/:126; exitEngine.ts:1163/:700; db.ts:540-545); 22-22 must resolve key:API:failed-held-sell-selection, 22-20 must resolve rc:RC-10 (ESC-PRE-02)
- [Phase 22]: 22-04: .planning/audit/.gitattributes pins LF (* text=auto eol=lf) so committed renders and SHA-pinned betterleaks configs survive core.autocrlf checkouts (closes the 22-02 line-ending caveat for .planning/audit/)
- [Phase 22]: 22-05: test/.env.test is committed via a one-path .gitignore negation (!test/.env.test), not git add -f; .env, .env.local and other test/.env.* stay ignored
- [Phase 22]: 22-05: rails DNS deny passes IP literals (wildcard binds keep working) and checks them at connect/send; DB tripwire also refuses ATTACH / VACUUM INTO / backup() into data/ (non-literal targets refused)
- [Phase 22]: 22-05: npm test and test:coverage now run unit+integration only (test:coverage previously started Hardhat via fork); test:all remains the one all-project command
- [Phase 22]: 22-05: the secret-read guard exception for test/.env.test is a LOCAL edit to a GSD-managed hook (operator decision 2026-11-07); a GSD update removes it and the guard fails closed again; 22-07/08/11/16/29 name the file
- [Phase 22]: 22-03 SAFE-01 VALID: off-machine copy on Google Drive (operator verbatim "google drive"), proven from downloaded bytes (sha256 4c8e9ab6...1d1a, 17/17 manifest entries, scan 0 non-public); operator D-22 exact-value check clean, bound to checker 703fd9ad and both target hashes
- [Phase 22]: 22-06 forensic: zero row changes 17:33->20:25 in all five live-DB tables (WAL replayed at 40 commit points); the 40 page-1 header writes (user_version 7) fingerprint src/utils/db.ts import and are actual-occurrence evidence for AUD-RAIL-002
- [Phase 22]: 22-06: the 3 test-literal matches (LADYS trades 2/3 + LP baseline) are public-historical, not test writes; AUD-FORENSIC-001 stays S2/EXPOSURE candidate without test-origin-db-row
- [Phase 22]: ESC-FORENSIC-01: operator acknowledged, no ruling, no decimal phase, Phase 22 continues; deleted trade id 1 (before 17:33) stays unexplained, origin unknown; live data/ untouched (P3)
- [Phase 22]: 22-07: OD-21 carried out - commit 93f8189 tracks all of ignition/deployments/ (6 newly tracked, 10 total); every HEAD blob sha256 equals the backup MANIFEST; NAC-02 prints only .env.example; no Hardhat command ran in v7.0 before it (AC-08)
- [Phase 22]: 22-07: no .gitattributes change - blobs proved LF and manifest-equal without one; ignore rules scoped (!ignition/deployments/*/artifacts/, journal rule removed); the CRLF re-checkout and branch-switch deletion hazard is AUD-OD21-001 (S3, fix in Phase 25)
- [Phase 22]: 22-07: the plan AC-07 node one-liner hits ENOBUFS (build-info blobs 3.87 MB > 1 MiB execFileSync default); 22-29 IGN_AC07 must raise maxBuffer or stream blobs and require 93f8189 as an ancestor of HEAD
- [Phase 22]: 22-08: first railed Vitest run in the main checkout passed (unit rails 5 files/68 tests, then 6/72; integration 7; Hardhat-free fork rehearsal 5); every run wrapped by scripts/verify-prod-untouched.ts with verdict untouched, live data/ == backup MANIFEST, run-bound ledger summary
- [Phase 22]: 22-08: Vitest MAIN process deliberately not railed (a preload there is inherited by fork workers and would scrub the fork shell keys); covered by envDir false/no dotenv, main loads only config + ledgerRun globalSetup, and the wrapper hash check; main-process outbound network is the residual for 22-15's sampled OS-level check
- [Phase 22]: 22-08: spawnRailedChild limits live in pure checkSpawnLimits(); moduleScopeDb.cjs proves its rails live on a fake root before pointing DB_PATH at data/bot.db (a neutralised-but-installed wrapper keeps its status flag)
- [Phase 22]: 22-08: nine setup-layer RED proofs recorded (red-proofs/22-08-1..9); restores via git -c core.autocrlf=false checkout -- proven byte-exact; no RED edit committed (core.cjs only has 6a254a1)
- [Phase 22]: 22-08: UFV-01 (AC-13) and UFV-02 (AC-17) fork-project obligations owned by Phase 25 in .planning/audit/inputs/unrun-fork-verifications.json (rehearsal pass vpu-20261107T042012-23448-c57d66); 22-29 registers them and should exclude test/*/rails/ from rail-ledger test-quality findings
- [Phase 22]: 22-17 ESC-BUY-01: operator 'Acknowledge continue' on S0 AUD-BUY-001 (deliberate buy unprotected after script exit); stays S0, no decimal phase; interim rule on card BUY-01: start the main bot right after any manual buy
- [Phase 22]: 22-17 ESC-BUY-02: operator 'Acknowledge continue' on the 8 BUY S1 entries (AUD-BUY-002/003/004/005/006/008/010/011); no severity changes (AUD-BUY-002 stays S1), no decimal phase; orchestrator recommendation (not operator): AUD-BUY-002 first in line in Phase 23
- [Phase 22]: ESC-EXIT-01: operator acknowledged all 8 EXIT S1 entries (AUD-EXIT-001/002/003/007/008/013/014/015) with 'Acknowledge continue'; no severity changes, no decimal phase, Phase 22 continues
- [Phase 22]: Orchestrator context (not operator): AUD-EXIT-001 is an operator choice via card OD-14; AUD-EXIT-002, -013, -015 are the worst stranded-position cases and go first in Phase 23
- [Phase 22]: ESC-ANTIRUG-01: operator acknowledged all 6 ANTIRUG S1 entries (AUD-ANTIRUG-001/002/003/004/005/011) with 'ackownledge continue' (verbatim, typo kept); no severity changes, no decimal phase, Phase 22 continues
- [Phase 22]: Orchestrator/executor context (not operator): AUD-ANTIRUG-002 (refused WS reconnect crashes the process, reproduced on localhost) was the strongest decimal-phase candidate; it is already proven and should be among the first Phase 24 fixes
- [Phase 22]: 22-19 cross-slice answer for 22-28: a refused or timed-out anti-rug escape does not fire again by design (AUD-ANTIRUG-004 sub_claim 1), so AUD-EXIT-014's mechanism is confirmed by code reading; 22-28 should update AUD-EXIT-014's status
- [Phase 22]: 22-19: external_od_refs owner_phase is a string ("32") because check.ts:304 requires a non-empty string; the 22-19 Task 1 verify compares the number 32 and fails as written; later plans must compare as string
- [Phase 22]: 22-20 ESC-TX-01: operator ruled acknowledge-continue on the TX S1 batch (AUD-TX-003, -004, -005, -009); no severity change, no decimal phase; RC-10 sub-findings AUD-TX-001/-002 stay on ESC-PRE-02
- [Phase 22]: 22-20: AUD-TX-004 (RC-17) and AUD-TX-005 (RC-18) stay confirmed S1 until 22-29 re-audits rails 22-12/22-13; AUD-TX-009 (bundle-wait crash) to be fixed with AUD-ANTIRUG-002 in Phase 24 (card OD-6)
- [Phase 22]: 22-20 for 22-28: TH-EXIT-23 is wrong (MEV_SELL_MAX_PRIORITY_FEE_GWEI never caps private sells, AUD-TX-010); AUD-TX-014 stays S2 though backup copies of persisted logs passed the D-22 exact-value check
- [Phase 22]: 22-21 ESC-DB-01: operator ruled acknowledge-continue on the DB S1 batch (AUD-DB-002, -003, -004, -001, -007); no severity change, no decimal phase; AUD-DB-007 and S2 AUD-DB-006 (RC-25) are being closed by rail 22-09, re-audited in 22-29
- [Phase 22]: Orchestrator context (not operator): AUD-DB-002 (risk SQL db.ts:425-459 subtracts decimal-ETH amount_in from wei amount_out/gas, so the daily-loss breaker and exposure cap do not work) goes first in Phase 23/24; decide OD-25 values treating those limits as not working until AUD-DB-002/-003 are fixed (card DB-01 before OD-25)
- [Phase 22]: 22-21: AUD-DB-009 (Telegram bot token in logs via err.config.url) and AUD-DB-010 (RPC URL with API key in preflight Telegram alert) are S2 secret-handling items for Phase 24 (card TX-04); the 22-21 Task 2 verify prints 'rows undefined' for {rows, discovery} thresholds files (print bug; actual 24 rows)
- [Phase 22]: 22-22: ESC-API-01 recorded - operator 'Acknowledge continue' for AUD-API-002 (RC-12, Stop chain disarms anti-rug) and AUD-API-008 (malformed Host header kills the process); AUD-API-001 (failed-held emergency/force-sell gap) stays on ESC-PRE-04. Interim orchestrator guidance: do not use per-chain Stop as a safety switch, use the global pause.
- [Phase 22]: 22-22: dashboard slice has no S0/S1 (max S2: anti-rug state wiped by 5 s positions push AUD-DASH-001, CB trip not re-loaded AUD-DASH-002, session-only dry-run review panel AUD-DASH-003); card DASH-01 (evidence before ANTIRUG_LIVE_EXECUTE) routed to the Phase 24 capital discussion.
- [Phase 22]: 22-23: AUD-TESTU-001 (24 unit files reached the live DB, real .env values or the notifier before the rails) is S1 RC-19 sibling evidence linked to AUD-RAIL-002 and ESC-PRE-03 (resolved_items); no new rail-class reach in test/unit; no ESC-TESTU record and no area checkpoint (rediscovery is never escalated twice)
- [Phase 22]: 22-23: the green unit suite would not catch AUD-BUY-001, AUD-BUY-002, AUD-EXIT-002/-007/-009/-013/-015, AUD-ANTIRUG-004, AUD-TX-002, AUD-DB-002/-003 and AUD-BUY-006 on the real path (AUD-TESTU-002..-021); the INT-NONCE-SELL regression stays green across all three nonce-lock tests (AUD-TESTU-003/-004); RED-prove those first in Phase 23/28
- [Phase 22]: 22-23: unit type-level compile gates (@ts-expect-error in anti-rug/types and honeypotTypes) never run: no tsconfig includes test/ and Vitest does not type-check (AUD-TESTU-008); RC-28 is TESTI-owned and linked as rc:RC-28 on AUD-TESTU-017/-018/-019
- [Phase 22]: 22-24: no integration or fork test path signs with the real key or sends to real mainnet (fork contexts use Hardhat keys on 127.0.0.1:8545); no rail-class stop
- [Phase 22]: 22-24: RC-19 integration/fork side registered as S1 rediscovery AUD-TESTI-011 on ESC-PRE-03, not re-escalated; no new S1 so no area checkpoint
- [Phase 22]: 22-24: coverage map AUD-TESTI-020: 0 of 39 registered money-path S0/S1 findings are caught on the real path by any integration or fork test (Phase 23 work list)
- [Phase 22]: 22-25 ESC-SCRIPTS-01: operator 'Acknowledge. Decide in phase 29' on S1 AUD-SCRIPTS-002 (signing scripts outside the nonce lock and pause switch); stays S1, no decimal phase. The D-06 premise challenge (tryAcquireThenRelease releases the lock before the script signs: check-then-act race) is DEFERRED to Phase 29 HYG-03, NOT resolved; card SCRIPTS-01 stays open, D-06 wording unchanged
- [Phase 22]: Orchestrator context (not operator): hold-lock (script holds acquireProcessLock for its whole run, checks pause while holding it) is the only option that closes the race and is the recommendation on record; query-then-sign gives false assurance; hold-lock matches BUY-01 refuse-while-running, and BUY-01 handoff-to-running-bot would mean no separate script signs for a deliberate buy
- [Phase 22]: 22-25: SCRIPTS/CONTRACTS/ROOT have no S0, rail, test-origin-db-row or non-public secret; Hardhat real .env load and mainnet/sepolia DEPLOY_PRIVATE_KEY accounts are a recorded boundary (AUD-CONTRACTS-001, S2) no test/fork/CI path reaches; RC-27 = AUD-SCRIPTS-001 (S3); root findings in sweep/contrib-ROOT.json for 22-28
- [Phase 22]: 22-26 ESC-SECRET-02: operator ruled "not secrets" - the 4 non-public full-history hits (AUD-SECRET-004 content hash, AUD-SECRET-005 URL-userinfo test strings) close NOT-A-BUG; full-history scan of 1053 commits (git-mode proven on a fixture) found no real secret; nothing rotated, history not rewritten
- [Phase 22]: 22-26 ESC-CENSUS-01: operator ruled "keep s1" - AUD-CENSUS-002 (src/utils/tokenSafety.ts:277, real approve inside dead simulateSell outside withNonceLock) stays S1; 22-28 must raise canonical AUD-BUY-007 to S1 and attach ESC-CENSUS-01 (5 merge items: evidence, reported_by, severity, rationale, escalation_ref)
- [Phase 22]: Orchestrator context (not operator): keep-s1 recommended because the fix is deleting a dead function (near-zero cost) and S1 makes sure Phase 24 removes it; a function named simulateSell that really signs is a re-wiring trap
- [Phase 22]: 22-26 census: N = 23 tx-signing sites for the Phase 23 assertion (src 11: 10 locked, 1 unlocked; scripts 12 unlocked, out-of-process, ESC-SCRIPTS-01 / Phase 29; 4 ContractFactory.deploy included); 1 message signature (flashbots.ts:102) excluded; signing-census.ts --self-test 31/31; manual inventory reconciled with 0 differences
- [Phase 22]: 22-27: operator ruled codex a, agy c: codex ran only inside a pinned Docker container with no file or shell tools; agy was left out and sent nothing, so D-14 is only partly covered (one outside assistant, recorded as a deviation)
- [Phase 22]: 22-27: 101 codex findings merged as 72 matches and 28 new entries; three new BUY S1 entries (AUD-BUY-027, 028, 030) in ESC-BUY-03, operator: Acknowledge continue
- [Phase 22]: 22-27: 22-28 must re-grade all 43 entries where codex said S1 and the register says lower, against the code at the audit base, and bring the operator anything that moves up to S1 (MERGE.json consolidation_required)
- [Phase 22]: 22-09: the DB version probe never touches the real file: WAL-mode DBs are probed through a private temp copy because a read-only open creates or rewrites -shm/-wal beside them (measured); with -wal and -shm both present and a torn copy it falls back to the direct read-only open, otherwise fails closed
- [Phase 22]: 22-09: db.ts now anchors DB_PATH to the repo root and refuses a newer, missing or empty database outside Vitest; npm run db:init is the only creation path (never run against real data in this plan); AUD-DB-006/-007 mitigations landed and are re-audited in 22-29
- [Phase 22]: 22-10: the notifier refusal runs first inside the existing try of sendTelegramAlert and sendCtxAlert, so a refused send is caught by the existing log.warn, never reaches the caller, and the broadcast still runs (D-04 amended)
- [Phase 22]: 22-10: five dotenv sites (src/config, src/utils/notifier, scripts/pause, resume, preflight) are VITEST-gated and proven by child probes; production path shown unchanged with a fake .env in a throwaway folder and a loopback fake, never the real .env or Telegram
- [Phase 22]: 22-10: UFV-03 (AC-16 notifier refusal under the real fork project) is owned by Phase 25; rehearsal pass vpu-20261109T021405-22636-8bff56; 22-29 registers it with UFV-01 and UFV-02
- [Phase 22]: 22-28: DB-07 linked to OD-18 rather than numbered, because OD-18 already holds the synchronous=FULL decision
- [Phase 22]: 22-28: DB-01 numbered as OD-58 rather than linked to OD-25, so an S1 capital decision keeps its options in OPERATOR-DECISIONS.md
- [Phase 22]: 22-28: card capital flag follows the capital_impact of its findings; BUY-05, DB-06 and TX-04 became capital
- [Phase 22]: 22-11: the spawn gate allows three exact files: test/rails/selfcheck.cjs (plain-Node rails proof added in 22-05) spawns one minimal-env child and cannot use the TS spawner; test/fork/setup.ts remains the only exemption outside test/rails/
- [Phase 22]: 22-11: .exec member calls are accepted only on a RegExp literal or eight named receivers (about 55 better-sqlite3/RegExp calls under test/); an unknown receiver still fails the gate
- [Phase 22]: 22-11: UFV-04 keeps owner_phase as the number 25 like UFV-01..03; the string rule at check.ts:304 is for external_od_refs on findings only
- [Phase 22]: 22-11: Hardhat children get buildHardhatChildEnv (sentinels, OS essentials, two shell keys, setup-fork preload); first real launch is UFV-04, owner Phase 25; the six edited fork files have never executed
- [Phase 22]: 22-12: duplicate-load guard on nonceAuthority, exitManager, exitEngine and anti-rug/detector (registerSingleton, epoch sentinel); the rail for AUD-TX-004/RC-17, whose register status stays with 22-29's re-audit
- [Phase 22]: 22-12: the junction probe maps the aliased module's own imports to the real folder, so an alias proof names the module under test; the junction into src/ is removed with unlinkSync and a non-recursive rmdirSync, never a recursive delete
- [Phase 22]: 22-12: test/unit/bot/buyNonceLock.test.ts needed a logger-mock edit unrelated to the guard (fresh rails DB now runs migrateSchema logger.info; before the rails it opened the live DB at version 7); 22-15 may meet the same pattern in other child-only logger mocks
- [Phase 22]: 22-13: SQLite gives zero winners when processes collide in its lock upgrade with timeout 0 (measured); timeout stays 0 per D-06 and the whole attempt retries for one second, so a real holder still refuses and a collision has exactly one winner
- [Phase 22]: 22-13: src/main.ts accepts PRIVATE_KEY with or without 0x exactly as new ethers.Wallet does, so the lock key is the signing wallet; MAIN_NO_WALLET uses fixed text because ethers errors can quote the key
- [Phase 22]: 22-13: rail for AUD-TX-005 (RC-18) is in place, register status stays with 22-29; the scripts-while-held proof does not settle card SCRIPTS-01
- [Phase 22]: 22-13 for 22-15: test/unit/rails/spawnSites.test.ts is red at HEAD from 22-12 files (6 offences, none spawns), recorded S3 in rails-discoveries.json; the first full-suite run will hit it
- [Phase 22]: 22-14: the vi.mock gate also accepts Node built-ins and rejects declaration-only targets, because createRequire returns a bare name for built-ins and a .d.ts-only mock intercepts nothing at run time
- [Phase 22]: 22-14: the gate exits 2, not 0, when a scan finds no source files or no mock call, so a broken scan cannot pass as clean
- [Phase 22]: 22-15 ESC-RAILS-01: operator replied b; the one live-mainnet bytecode test moved to the fork project inside this plan, obligation UFV-05 owner Phase 25; options were (a) keep it failing and escalate, (b) move it, (c) stop Phase 22
- [Phase 22]: 22-15: AC-22 holds for the unit and integration suites with one stated exception: the moved test has NOT run in its new file; never claim every original test executed
- [Phase 22]: 22-15: full railed npm test green, run vpu-20261109T045355-20916-8a9783: 1194 passed, 0 failed, 0 skipped, 0 todo, verdict untouched, ac19-run.json written by the wrapper
- [Phase 22]: 22-15: the moved test uses buildChainRegistry() for its address because forkShellOnly forbids a fork test reading a key the rails replace; the precedence is unchanged
- [Phase 22]: 22-15 for 22-29: UFV-05 must be added to the Task 1 verify, which names only UFV-01..04; 7 of the 16 triggeringTestFiles are rail tests' own deliberate denials
- [Phase 22]: 22-16: pre-rail collected 759 unit and 216 integration from the isolated export of phase_start_sha, no collection errors; post-rail official 932 unit / 262 integration; NAC-04 holds
- [Phase 22]: 22-16: ESLint phase_start 350/22 equals STATE.md; post_rails 351/22 (+1: src/bot.ts -1, src/main.ts +1, src/utils/repoRoot.ts +1), all from the rails' own src changes
- [Phase 22]: 22-16 for Phase 26: npm ls exits 1 from ethers 6.16.0 vs the 6.7.1 peer of @flashbots/ethers-provider-bundle, vitest 4.1.1 vs the 4.1.2 peer of @vitest/coverage-v8, and an extraneous @emnapi/core folder
- [Phase 22]: 22-16: the plan's tmp-path regex matches the npm registry URL of the package named tmp; data left intact, check run with URLs removed, script asserts no os.tmpdir() in outputs
- [Phase 22]: Fork-project gap ruled accept-rehearsal-plus-obligation: fork halves of AC-13/AC-16/AC-17 and the AC-22 live bytecode test stay rehearsal-only until Phase 25
- [Phase 22]: AUD-TESTQ-002 merged into AUD-TESTU-023; canonical stays confirmed because the stale statement names in the mock factory are not fixed
- [Phase 22]: Phase 22 sealed on 93d90297b58a8b333519873112473156fe45d6bf with a clean NAC-11 scan; later bookkeeping paths are exempt by pattern but still scanned
- [Phase 22]: UAT 2026-11-09: operator accepted one outside reviewer on the money-handling code (codex only, agy excluded) and the package.json disclosure to OpenAI during the host containment probe (D-14; this is the acknowledgement 22-SECURITY T-22-95 found missing)
- [Phase 22]: UAT 2026-11-09: operator accepted AUD-REAUDIT-001, that 11 fork rehearsal runs before a08d650 very likely read the real env file into the Vitest main process
- [Phase 22]: UAT 2026-11-09: operator accepted the per-user process lock for now and added CAP-18 to Phase 24 so AUD-TX-026 (S3) has a named owner
- [Phase 22]: UAT 2026-11-09: operator deferred the real fork run to Phase 25 and had the five checks named in its success criteria
