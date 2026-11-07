---
gsd_state_version: "1.0"
milestone: v7.0
milestone_name: Full Audit & Modernization
current_phase: 22
current_phase_name: Safety Rails & Audit
status: executing
stopped_at: Completed 22-07-PLAN.md
last_updated: "2026-11-07T03:58:17.177Z"
last_activity: 2026-11-06
last_activity_desc: Phase 22 execution started
state_head: c37a72e5d37921c5af175446c27ea731e208e04c
progress:
  total_phases: 11
  completed_phases: 0
  total_plans: 29
  completed_plans: 7
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-06 at v7.0 milestone start)

**Core value:** Reliably detect, validate, and profitably snipe new token listings across multiple EVM chains with proper risk management — never lose money to preventable bugs, race conditions, or security flaws.
**Current focus:** Phase 22 — Safety Rails & Audit

## Current Position

Phase: 22 (Safety Rails & Audit) — EXECUTING
Plan: 8 of 29
Status: Ready to execute
Last activity: 2026-11-06 — Phase 22 execution started
Roadmap: .planning/ROADMAP.md — v7.0 Phases 22–32 (11 phases), 100/100 requirements mapped; risk isolation lives in waves/plans/commits; decimal phases reserved for D-STOP-THE-LINE insertions

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

- **ESC-PRE-04 (D-STOP-THE-LINE record, routed to Phase 24):** dashboard emergency-sell/force-sell skip still-held failed-exit positions (traced in 22-04/22-22; fix routed to Phase 24). Recorded at the 2026-11-06 replan; restored here after `state.begin-phase` overwrote Current Position.

## Operating Notes (carry to next session)

- **Bot is OFF for all of v7.0** — no live trading until the milestone's fork rehearsal + live roundtrip re-entry gate passes.
- **Phase 22 Node runtime (CONTEXT D-21):** run on Node 22.16.0 by absolute path (`C:\Users\jackc\AppData\Local\nvm\v22.16.0\node.exe`, ABI 127); the global Node 24 cannot load better-sqlite3. No `npm rebuild`.
- **Phase 22 test ban (CONTEXT D-13):** no `npm test` / `vitest` in the main checkout until the rails land (plan 22-08 is the first sanctioned run; 22-15 the first full-suite run).
- **Bot start:** `npx ts-node src/bot.ts` (entry point may change when `ts-node` is replaced this milestone — update this note). **Read-only cold-start check:** `npm run preflight` (there is no dry-run boot mode — never boot src/bot.ts to "test"). Stop the bot by force-killing the ts-node PID (npx swallows Ctrl+C on Windows+bash).
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

## Session

**Last session:** 2026-11-07T03:58:17.115Z
**Stopped at:** Completed 22-07-PLAN.md
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
