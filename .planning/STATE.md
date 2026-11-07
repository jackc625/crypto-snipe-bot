---
gsd_state_version: "1.0"
milestone: v7.0
milestone_name: Full Audit & Modernization
current_phase: 22
current_phase_name: Safety Rails & Audit
status: executing
stopped_at: Completed 22-03-PLAN.md
last_updated: "2026-11-07T03:07:42.096Z"
last_activity: 2026-11-06
last_activity_desc: Phase 22 execution started
state_head: bc06eb79f1267bfffcc5eb9187f6572ad31be6d8
progress:
  total_phases: 11
  completed_phases: 0
  total_plans: 29
  completed_plans: 5
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-06 at v7.0 milestone start)

**Core value:** Reliably detect, validate, and profitably snipe new token listings across multiple EVM chains with proper risk management — never lose money to preventable bugs, race conditions, or security flaws.
**Current focus:** Phase 22 — Safety Rails & Audit

## Current Position

Phase: 22 (Safety Rails & Audit) — EXECUTING
Plan: 6 of 29
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

## Session

**Last session:** 2026-11-07T03:07:42.032Z
**Stopped at:** Completed 22-03-PLAN.md
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
