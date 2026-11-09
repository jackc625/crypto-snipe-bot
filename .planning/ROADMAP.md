# Roadmap: Crypto Snipe Bot

## Overview

Production-ready multi-chain MEV sniper bot with Uniswap V2/V3 support,
intelligent exit strategies, portfolio risk management, on-chain honeypot
detection, anti-rug runtime monitoring, SQLite audit trail, and a real-time web
dashboard across ETH, BSC, Base, and Arbitrum. Live-proven on Ethereum mainnet.

v7.0 (in progress) rebuilds the foundations without changing trading behavior
except by explicit operator decision. It protects state first, audits read-only,
locks behavior with real-path characterization, and fixes capital-safety bugs on
the current layout. It then modernizes toolchain, structure, code quality, tests,
contracts tooling, and CI in behavior-neutral steps, redeploys the hardened ETH
checker, and re-proves the bot live before it trades again.

## Milestones

- ✅ **v6.16 Production-Ready Multi-Chain MEV Sniper** — Phases 1–16 (shipped 2026-04-14) — [archive](milestones/v6.16-ROADMAP.md)
- ✅ **v6.17 Defensive Hardening for Live Mainnet** — Phases 17–21 + 21.1/21.2/21.3 (shipped 2026-05-29, ETH-first) — [archive](milestones/v6.17-ROADMAP.md)
- 🚧 **v7.0 Full Audit & Modernization** — Phases 22–32 (in progress)

## Phases

<details>
<summary>✅ v6.16 Production-Ready Multi-Chain MEV Sniper (Phases 1–16) — SHIPPED 2026-04-14</summary>

- [x] Phase 1: Bug Fixes & Hardening (4/4)
- [x] Phase 2: ethers v6 Migration (2/2)
- [x] Phase 3: SQLite Storage & Code Quality (4/4)
- [x] Phase 4: Multi-Chain Architecture (5/5)
- [x] Phase 5: Uniswap V3 Integration (4/4)
- [x] Phase 6: Risk Management (2/2)
- [x] Phase 7: Smart Exit Strategies (4/4)
- [x] Phase 8: Monitoring & Web Dashboard (6/6)
- [x] Phase 9: Testing Infrastructure (5/5)
- [x] Phase 10: partial_sell Revenue Fix (2/2)
- [x] Phase 11: Dashboard Accuracy & Bot Wiring (7/7)
- [x] Phase 12: Integration Gap Fixes (3/3)
- [x] Phase 13: Config Env-Var Correctness (1/1)
- [x] Phase 14: Sell Revenue Receipt Decoding (2/2)
- [x] Phase 15: Chain-Scoped Dedup & Dashboard Env (2/2)
- [x] Phase 16: Dashboard Type Alignment & Dead Code Cleanup (2/2)

Full archive: [milestones/v6.16-ROADMAP.md](milestones/v6.16-ROADMAP.md)

</details>

<details>
<summary>✅ v6.17 Defensive Hardening for Live Mainnet (Phases 17–21 + 21.1/21.2/21.3) — SHIPPED 2026-05-29 (ETH-first)</summary>

- [x] Phase 17: Tech Debt Cleanup & Audit Baseline (3/3) — completed 2026-04-30
- [~] Phase 18: Honeypot Detection Rebuild (10/11) — 18-08 (BSC/Base/Arb deploy → HONEY-04) deferred to next milestone
- [x] Phase 19: Anti-Rug Runtime Monitoring (10/10) — completed 2026-05-24
- [x] Phase 20: Going-Live Ops Hardening (12/12) — completed 2026-05-26
- [x] Phase 21: Exit-Engine Live-Runtime Hardening (8/8) — completed 2026-05-29 (live real-capital roundtrip closed all 6 deferred v6.16 items)
- [x] Phase 21.1: V3-Buy Tax-Gate + Flashbots Inclusion Fix (6/6) — completed 2026-05-27
- [x] Phase 21.2: Calm-Gas Sell Inclusion + Exit-Engine Robustness (13/13) — completed 2026-05-28
- [x] Phase 21.3: Buy-Leg Calm-Gas Flashbots Inclusion + Guaranteed-Inclusion Fallback (7/7) — completed 2026-05-29

**Result:** 69 plans complete · 68/70 requirements satisfied · 1 deferred (HONEY-04) · 1 partial-deferred (ANTIRUG-15). Capital-safety blocker INT-NONCE-SELL fixed inline at close.

Full archive: [milestones/v6.17-ROADMAP.md](milestones/v6.17-ROADMAP.md) · Live-capture evidence: [milestones/v6.17-VERIFICATION-EVIDENCE.md](milestones/v6.17-VERIFICATION-EVIDENCE.md)

</details>

### 🚧 v7.0 Full Audit & Modernization (In Progress)

**Milestone Goal:** Bring the codebase up to a modern quality bar: a fresh-eyes adversarial audit, then deep cleanup of structure, bugs, code quality, tests, dependencies, tooling, and CI. Trading behavior changes only by explicit operator decision. The milestone ends by redeploying the hardened ETH `HoneypotChecker` and re-proving the bot with a live mainnet roundtrip before it trades again.

**Milestone contract:** The bot stays OFF until Phase 32 passes. `ENABLED_CHAINS=eth` does not change, so BSC/Base/Arb stay fail-closed (HONEY-04 and ANTIRUG-15 are deferred). Trading behavior is preserved by default. Any behavior change lands as a `behavior:` commit that cites an operator decision ID. Capital findings follow D-STOP-THE-LINE. Requirements: [REQUIREMENTS.md](REQUIREMENTS.md) (100). Research: [research/SUMMARY.md](research/SUMMARY.md).

**Phase numbering:** Continues from v6.17, which ended at 21.3. Integer phases 22–32 are planned. Decimal phases (e.g. 24.1) are reserved for D-STOP-THE-LINE insertions and run between their integers.

**Where risk isolation lives:** Inside each phase, at the plan, commit, and wave level, not the phase level. Each phase runs several sequenced waves and plans, and between waves there is a verification gate: the full suite, a zero decision-trace diff (or a cited `behavior:` change), and the signing-site census. The isolation rules are:
- every fix is RED→GREEN
- moves are pure-move commits
- dependency bumps are one major per commit
- formatting is one isolated `fmt:` commit
- the relay-client swap and the mainnet deploy each get their own wave

Config granularity `fine` applies to plan sizing, not phase count.

**Ordering spine:**
1. Protect state, then the read-only audit (22)
2. Real-path safety net (23)
3. Capital fixes on the current layout (24)
4. Behavior-neutral cleanup, contracts isolation, and dependencies (25)
5. Toolchain and ESM (26)
6. Restructure leaves-first with `bot.ts` dissolved last, plus runtime seams (27)
7. Lint-zero and real-path test quality (28)
8. S2–S4 closure, relay client, and dashboard/scripts (29)
9. Hardhat 3 and the ETH checker redeploy (30)
10. Blocking CI and docs (31)
11. Live re-entry gate (32)

**Carried-forward conventions.** Cite these by name in every plan where they apply; the plan-phase decision-coverage gate blocks on any that go uncited.
- **D-STOP-THE-LINE**: a confirmed capital-safety (S0/S1) finding is never fixed in flight and never auto-deferred. It is re-surfaced to the operator and may spawn a decimal phase. This holds in every phase, not only Phase 24.
- **D-NONCE-AUTHORITY-ALL**: every signing path (buys, sells, approvals, anti-rug, fallbacks, scripts) goes through the per-wallet `withNonceLock` authority, never ethers `NonceManager`. The signing-site census (`>= N`) is the standing proof.
- **D-EVIDENCE-BAR**: a fork or unit pass never closes a live claim. Live items need resolvable on-chain artifacts (tx hash, DB row, pino excerpt).
- **D-ROLLBACK**: no escape-hatch or legacy fallback flags. A replaced or broken path is deleted outright. A revert is a git revert, not a runtime toggle.
- **D-FORK-REHEARSAL**: money-path changes are fork-rehearsed before live use. A fork has no Flashbots relay, so it proves the surrounding wiring, not private inclusion.
- **D-TEST-BOTH**: observable-effect rigor on real paths. Never mock the mechanism under test, and no hollow assertions.
- **D-ENV-EXAMPLE [USER-BINDING]**: every new env var lands in `.env.example` with a default and a one-line description.
- **D-ALERTS**: structured pino (dotted `op` fields) plus Telegram on every ceiling-hit, fallback, fail-clean, and escalation, each with a remediation pointer.
- **High-stakes-ops protocol** (Phases 30 and 32): testnet rehearsal first, step-by-step verification, and address checks at every step.

- [ ] **Phase 22: Safety Rails & Audit** - Back up Ignition state and the live DB first, wall tests off from production, then a read-only audit with findings register and decision cards
- [ ] **Phase 23: Test Safety Net (Harness, Triage, Characterization)** - Real-path harness, all 28 candidates proven RED or NOT-A-BUG, golden-master trace and commit-taxonomy check
- [ ] **Phase 24: Capital-Safety Fixes** - Every confirmed S0/S1 fixed on the current layout with RED→GREEN real-path proof: nonce/containment, buy path, exit/anti-rug
- [ ] **Phase 25: Behavior-Neutral Cleanup & Dependencies** - Line endings and Prettier, dead code and cycles out, contracts package on Hardhat 2, all runtime deps at latest with 0 prod vulns
- [ ] **Phase 26: Toolchain & ESM** - Vitest 5, ESLint 10 config, nodenext tsconfigs, SHA-pinned Node 24/26 CI, ESM under Node type stripping, TS 7 gate
- [ ] **Phase 27: Domain Restructure & Runtime Seams** - Domain layout with `bot.ts` dissolved last, 400-line gate, dependency-cruiser rules, side-effect-free imports, single config module
- [ ] **Phase 28: Lint-Zero & Real-Path Test Quality** - `strictTypeChecked` at zero, typed bindings, mechanism mocks rewritten and banned, property tests, money-path coverage floors
- [ ] **Phase 29: Remaining Findings, Relay Client & Dashboard** - S2–S4 findings closed, in-repo Flashbots relay client, dashboard upgrade and hardening, operator scripts audit
- [ ] **Phase 30: Hardhat 3 & ETH Checker Redeploy** - Hardhat 3 toolchain, then the hardened checker: Sepolia rehearsal, mainnet deploy, verify, re-audit, read-only validation, config switch
- [ ] **Phase 31: Blocking CI Gates & Docs** - Every gate blocking at a zero baseline, supply-chain guards, architecture doc, ADRs, cold-start README, CI-checked runbook
- [ ] **Phase 32: Re-Entry Gate (Fork Rehearsal & Live ETH Roundtrip)** - Final fork rehearsal, clean re-entry pre-flight, one small real-capital roundtrip with on-chain artifacts

## Phase Details

### Phase 22: Safety Rails & Audit
**Goal**: Irreplaceable state is backed up and verifiable, and no test, tool, or second process can reach production state (live DB, real `.env`, network, Telegram, wallet). Then every area of the codebase is audited read-only, working from the code itself rather than prior VERIFICATION docs. The audit yields a findings register, a bug-class sweep, a thresholds inventory, and an operator decision card for every behavior-changing recommendation.
**Depends on**: Nothing (first v7.0 phase; v6.17 ended at Phase 21.3)
**Requirements**: SAFE-01, SAFE-02, SAFE-03, SAFE-04, SAFE-05, SAFE-06, SAFE-07, AUDIT-01, AUDIT-03, AUDIT-04, AUDIT-05
**Success Criteria** (what must be TRUE):
  1. An out-of-repo backup exists, taken before any `npm install`, Hardhat invocation, sweep, or relocation. It holds `ignition/deployments/` (including the gitignored `journal.jsonl` and per-future artifacts) and `data/` (`bot.db` + `-wal` + `-shm` together, or checkpoint + `db.backup()`), with a hash manifest that re-verifies. `ignition/deployments/` is then tracked in git, and the committed files hash-match the backup (OD-21).
  2. A full test run leaves the `data/bot.db` checksum and mtime unchanged, sends no Telegram message, and makes no outbound network call. Each of the following is RED-proven by a test that fails when it is removed, all without booting `src/bot.ts`:
     - the test-isolation rails
     - the duplicate-singleton guard (including a Windows path-casing alias)
     - the single-instance process lock
     - the newer-schema and refuse-to-create DB guards
     - the `vi.mock` path gate
  3. A re-runnable capture script commits the before-baselines: `npm ls`, `npm audit`, ESLint counts by rule and file, per-project test counts (taken only once the rails are in place), the coverage file list, and the `bot.db` checksum. The same script produces the after-baselines at milestone close.
  4. `AUDIT-FINDINGS.md` covers `src/`, `dashboard/`, `test/`, `scripts/`, and contracts tooling. Every entry, including all 28 research candidates, has severity S0–S4, a capital-impact class, evidence, a filled "sibling sites checked" field, and a lifecycle status. The 20-class bug sweep is recorded, including a one-time full-history secret scan. So is the thresholds/magic-number inventory, including the OD-25 risk defaults. The audit wave changed no source file.
  5. `OPERATOR-DECISIONS.md` holds an ID'd card (options, recommendation, behavior impact) for every behavior-changing recommendation. The capital-area cards (OD-6, OD-11, OD-14 to OD-18) are batched by area for ruling in the Phase 24 discussion.
**Waves**:
  - Wave 1: SAFE-01 backup with hash manifest, the very first action of the milestone; then track `ignition/deployments/` in git (OD-21).
  - Wave 2: test-isolation rails, `Symbol.for` singleton guards + `forceConsistentCasingInFileNames`, single-instance process lock, DB version and refuse-to-create guards, the `vi.mock` path gate; then baseline capture.
  - Wave 3: read-only audit by area, which may start once Wave 1 verifies: findings register, bug-class sweep with the full-history secret scan, thresholds inventory, decision cards.
**Conventions**: D-STOP-THE-LINE (any candidate that reads as S0/S1, or a rail finding such as evidence that tests already mutated the live DB, is re-surfaced to the operator at once and never filed-and-deferred); D-NONCE-AUTHORITY-ALL (the singleton guards and the process lock keep one nonce authority per wallet; the sweep includes a census of every signing call site, scripts included).
**Operator decisions**: OD-21 during Wave 1, after the backup verifies. This phase produces the cards for OD-6, OD-9, OD-10, OD-11, OD-14 to OD-18, OD-25, and any new ones.
**Research flag**: Yes for the audit wave (per-area deep reading; ethers v6 `getFeeData` base-fee derivation and `wait()` error semantics such as `TRANSACTION_REPLACED`/`repriced`). The rail mechanics are already specified.
**Plans**: 22/29 plans executed in 13 execution waves (rails plans run one per wave; audit plans run in parallel with them)

Plans:
**Wave 1**
- [x] 22-01-PLAN.md — SAFE-01 local backup: backup-state.ts with fixture self-check, verified dated backup + archive, phase-start SHA

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 22-02-PLAN.md — betterleaks v1.10.0 provenance (operator check), D-22 exact-value checker, secret scan of the backup
- [x] 22-04-PLAN.md — audit register tooling (PROTOCOL, slices, check/render) and the D-23 pre-phase records, OD-21 card
- [x] 22-05-PLAN.md — SAFE-02 setup-layer rails (one CommonJS module), sentinel env with fork-mode shell keys, vitest wiring, npm test re-scope (no Vitest run)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 22-03-PLAN.md — operator exact-value check, Google Drive/USB decision (one-way), download-back verify → SAFE-01 VALID
- [x] 22-06-PLAN.md — forensic two-image report on a backup copy of the live DB; register and escalate test-origin rows

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 22-07-PLAN.md — OD-21: commit ignition/deployments, blob hashes equal the manifest, scoped ignore rules
- [x] 22-08-PLAN.md — first railed Vitest run: verify-prod-untouched wrapper, spawnRailedChild, setup-layer rail tests + RED proofs
- [x] 22-17-PLAN.md — audit BUY/detection slice (RC-01/02/04/05/09/16/20/24, OD-6/15/16)
- [x] 22-18-PLAN.md — audit EXIT slice (RC-03/07/08/15/21, OD-14)
- [x] 22-19-PLAN.md — audit ANTIRUG slice (RC-13, OD-9)
- [x] 22-20-PLAN.md — audit nonce/MEV/tx slice (RC-10/11/17/18/22/26, OD-17)
- [x] 22-21-PLAN.md — audit DB/risk/config slice (RC-06/14/23/25, OD-10/18/25)
- [x] 22-22-PLAN.md — audit dashboard API and dashboard (RC-12, OD-11)
- [x] 22-23-PLAN.md — audit test/unit with per-file quality labels (D-20)
- [x] 22-24-PLAN.md — audit integration/fork tests, helpers, fixtures (RC-28)
- [x] 22-25-PLAN.md — audit scripts, contracts tooling and root configs (RC-27, out-of-process signers)
- [x] 22-26-PLAN.md — full-history secret scan and signing-site census (N)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 22-09-PLAN.md — SAFE-05 DB guards: repo-root anchoring, VITEST src tripwire, read-only version probe, refuse-to-create, npm run db:init
- [x] 22-27-PLAN.md — codex/agy code-only second opinion on the money slices (operator one-way decision) + union merge

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 22-10-PLAN.md — notifier refusal via the catch path (D-04 amended) and VITEST-gated dotenv sites, with RED proofs
- [x] 22-28-PLAN.md — consolidation: RC map, duplicates, 20x5 matrix, thresholds, OD-26+ numbering, rendered register

**Wave 7** *(blocked on Wave 6 completion)*
- [ ] 22-11-PLAN.md — spawn sites onto spawnRailedChild, AST spawn gate, shell-only fork RPC resolver in globalSetup and every fork worker

**Wave 8** *(blocked on Wave 7 completion)*
- [ ] 22-12-PLAN.md — SAFE-03 duplicate-load guards (epoch registry) on the four singletons + casing flag in every tsconfig

**Wave 9** *(blocked on Wave 8 completion)*
- [ ] 22-13-PLAN.md — SAFE-04 process lock (pinned SQLite exclusive lock), src/main.ts entry, bot.ts refusal, start-command docs

**Wave 10** *(blocked on Wave 9 completion)*
- [ ] 22-14-PLAN.md — SAFE-06 vi.mock specifier gate (TS AST) + CI step

**Wave 11** *(blocked on Wave 10 completion)*
- [ ] 22-15-PLAN.md — full railed npm test green with recorded edits; AC-19 proof; RED-proof index

**Wave 12** *(blocked on Wave 11 completion)*
- [ ] 22-16-PLAN.md — SAFE-07 capture-baselines.ts (isolated pre-rail export) and committed before-baselines

**Wave 13** *(blocked on Wave 12 completion)*
- [ ] 22-29-PLAN.md — re-audit of rail diffs, new-file ledger, phase-end NAC and Ignition checks, fork obligations, final check and render

**Cross-cutting constraints:** <!-- gsd:generated -->
- D-21: Node 22.16.0 for every command
- AC-33 / NAC-13: commits change nothing outside .planning/ and fix nothing
- D-16: immediate-tier items stop at once; S1 entries are presented together at the area checkpoint; AC-33 / NAC-13: nothing outside .planning/ changes and nothing is fixed
- P9 anti-anchoring: evidence only from code at audit_base_sha or command output

### Phase 23: Test Safety Net (Harness, Triage, Characterization)
**Goal**: A real-path test harness exists, and every research candidate has been proven (RED) or disproven (NOT-A-BUG) on it. Current trading behavior, known bugs included and tagged, is then locked by a golden-master decision trace. From then on, every mechanical commit is provably behavior-neutral, and every behavior change can be traced to a decision. The phase is test-only: no change to `src/` behavior.
**Depends on**: Phase 22
**Requirements**: CHAR-01, CHAR-02, CHAR-03, CHAR-04, CHAR-05, CHAR-06, AUDIT-02, AUDIT-06
**Success Criteria** (what must be TRUE):
  1. Harness tests run real ethers (encoding, signing, receipt decoding) against a fake JSON-RPC transport and a real in-memory SQLite DB built by the real migrations, under a fixed clock. Only the logger, notifier, broadcaster, relay HTTP, and clock are mocked, and a check enforces that. Migration golden tests run v0→v7 and v4→v7, and the test DB helper uses the real migrations, so the hand-duplicated `user_version = 4` schema is gone.
  2. Each of the 28 candidates is either `confirmed`, backed by a committed RED real-path test (marked expected-fail until its fix lands) or a fork script, or `NOT-A-BUG` with evidence. Every confirmed S0/S1 has been re-surfaced to the operator with its RED evidence before Phase 24.
  3. A golden-master decision trace is captured: `op` logs, submitted tx requests and calldata including relay request bodies, and DB writes. It covers V2 and V3 buys, every exit type, the risk gate, and fee/gas computation. Confirmed-bug behavior is tagged `SUSPECT(<finding-id>)`, never `KEEP`. An env-matrix snapshot covers `{unset, '', '0', 'abc', valid}` for config and chain-registry parsing.
  4. Tests pin boot/resume/arm ordering, listener counts, same-block ordering, and singleton identity. A signing-site census asserts that every signing path goes through `withNonceLock`, with a positive `>= N` count. Source-text tests are converted to path-agnostic behavioral checks.
  5. A commit check fails any `refactor:`/`lint:`/`fmt:`/`deps:` commit that changes the decision trace, and any `behavior:` commit without a decision ID. Both cases are demonstrated against deliberately violating commits.
**Waves**:
  - Wave 1: harness, real-migration test DB, and migration golden tests.
  - Wave 2: candidate triage (RED or NOT-A-BUG), then re-surfacing of confirmed S0/S1 to the operator.
  - Wave 3: golden master, env matrix, ordering/identity tests, signing census, source-text conversion, commit-taxonomy check.
**Conventions**: D-STOP-THE-LINE (confirmed S0/S1 is re-surfaced immediately, and so is any confirmation that falsifies a scoping premise; characterization that exposes a new one is tagged `SUSPECT`); D-NONCE-AUTHORITY-ALL (nonce candidates #10, #11, and #17 are triaged on the real `withNonceLock`; the census becomes the standing proof); D-TEST-BOTH (no hollow REDs).
**Operator decisions**: None needed to start. Triage evidence informs the OD-6, OD-11, and OD-14 to OD-18 rulings. The intent-row half of OD-18 depends on whether candidate #14 is confirmed.
**Research flag**: Yes (fake JSON-RPC transport harness design, env-matrix snapshot design, AST tooling for the signing census).
**Plans**: TBD

### Phase 24: Capital-Safety Fixes
**Goal**: Every confirmed capital-safety finding is fixed on the current layout, with RED→GREEN real-path proof. After this phase:
- Monitoring cannot be silently stopped, and an anti-rug emergency sell never waits behind a buy.
- No buy can be lost, double-fired, submitted unprotected, triggered by an unauthorized source, or sized against disabled limits.
- Every held position is monitored with correct pricing, and its sells are bounded and private.
- Anti-rug protection survives a dashboard stop and WebSocket reconnects.
- No confirmed S0/S1 finding remains open before any move begins.
**Depends on**: Phase 23; operator rulings batched in this phase's discussion
**Requirements**: CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06, CAP-07, CAP-08, CAP-09, CAP-10, CAP-11, CAP-12, CAP-13, CAP-14, CAP-15, CAP-16, CAP-17
**Success Criteria** (what must be TRUE):
  1. Every CAP item closes with proof. Either a real-path test written RED before the fix goes GREEN after it, and a separate reviewer re-runs that proof independently (gsd-verifier alone is not sufficient), or the item closes as NOT-A-BUG with evidence. Decision-trace changes appear only in `behavior:` commits that cite finding and OD IDs. The signing-site census still reports `>= N` sites, all under `withNonceLock`.
  2. Monitoring cannot be silently stopped, on the real lock:
     - A rejected handler is contained, and a global `unhandledRejection` handler alerts and shuts down in a controlled way (OD-6).
     - Re-entrant `withNonceLock` acquisition throws, and lock waits are bounded and alerted.
     - An anti-rug emergency sell gets the wallet's nonce authority ahead of an in-flight buy escalation (OD-17).
  3. The buy path is safe for both V2 and V3:
     - A landed buy is always held and armed, never recorded as failed.
     - No transaction with `minOut = 0` reaches the broadcaster (OD-15).
     - One `chain:token` yields exactly one submission.
     - Invalid numeric env values fail boot through one shared parser.
     - The Telegram allowlist is fail-closed (OD-16).
     - A crash between submission and the trade row cannot leave an untracked position (OD-18; schema 7→8 if adopted).
     - The dead approve paths are deleted.
  4. The exit and anti-rug path is safe:
     - Private sells carry the OD-14 minOut, confirmed by fork replay of the LADYS and rug fixtures.
     - Exit monitors retry on a missing initial price, with an alert.
     - Pricing is decimals-correct, and an entry price of 0 cannot disable the stops.
     - Approvals are fee-capped and private through `withNonceLock`.
     - Dashboard stop-chain and WS reconnects leave anti-rug armed for every held position, under a single per-chain owner with no leaked providers (OD-11).
  5. The register shows zero confirmed S0/S1 findings outside `fixed`/`verified` or an explicit operator escalation, and none was deferred automatically.
**Waves** (each wave closes with independent RED→GREEN re-runs, the full suite, and the census before the next starts):
  - Wave A: nonce authority and failure containment (CAP-05, CAP-10, CAP-11).
  - Wave B: buy path (CAP-01, CAP-02, CAP-04, CAP-06, CAP-09, CAP-14, CAP-16).
  - Wave C: exit and anti-rug (CAP-03, CAP-07, CAP-08, CAP-12, CAP-13, CAP-15).
  - Wave D: CAP-17 sweep of every other confirmed S0/S1.
**Conventions**: D-STOP-THE-LINE (CAP-17 is the closer; a new capital bug found mid-fix becomes a decimal phase, not a fix-in-flight); D-NONCE-AUTHORITY-ALL (the priority lane lives inside the lock, not around it; buys, sells, and approvals all go through `withNonceLock`); D-ROLLBACK (no flag restores old lock semantics or fail-open minOut; dead approve paths are deleted outright); D-EVIDENCE-BAR (closure is RED→GREEN real-path evidence; fork replay proves calldata and accounting, not inclusion; no live claim before Phase 32); D-FORK-REHEARSAL; D-ALERTS; D-ENV-EXAMPLE [USER-BINDING]; D-TEST-BOTH.
**Operator decisions**: OD-6, OD-11, and OD-14 to OD-18 are batched in this phase's discussion, each decided before its wave. OD-25 is needed only if a risk default changes. A CAP-15 card is needed if approvals stay public. OD-9 and OD-10 may be batched here too, since Phase 25 needs them.
**Research flag**: Yes (per-finding research; AsyncLocalStorage lock-held enforcement and priority-lane design; write-ahead intent row and boot reconciliation; single per-chain WS-owner design for H1/H2; OD-14 fork replay).
**Plans**: TBD

### Phase 25: Behavior-Neutral Cleanup & Dependencies
**Goal**: The codebase is normalized, formatted, and de-junked, with dead code and import cycles removed. Contracts tooling lives in its own package on Hardhat 2. Every runtime dependency is at latest, with zero production vulnerabilities and a clean install that does not need `--legacy-peer-deps`. Every step is provably behavior-neutral except two cited fixes: `LOG_LEVEL` and the honeypot alert text.
**Depends on**: Phase 24 (the safety net and the capital fixes are in place before the reformat)
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04, CLEAN-05, HYG-01, HYG-02, HH-01, DEPS-01, DEPS-02, DEPS-03, DEPS-04, DEPS-06
**Success Criteria** (what must be TRUE):
  1. `.gitattributes` and `git add --renormalize .` land in their own commit. Prettier (+ Tailwind plugin) then lands as one isolated `fmt:` commit registered in `.git-blame-ignore-revs`, excluding `contracts/`, `.planning/`, `ignition/deployments/`, and fork fixtures. Every cleanup and `deps:` commit has zero decision-trace diff. The two `behavior:` commits cite decision IDs: `LOG_LEVEL` honored per OD-10, and New-Token alerts reporting the real honeypot result.
  2. Audited dead code is gone, and the root is clean:
     - knip reports zero unused files, exports, and dependencies at the root.
     - The cycle check reports zero cycles.
     - Env loading happens once, as the first import of every entry point.
     - `.DS_Store`/`.idea/` are untracked, and stale root files are removed.
     - A hash check shows the sweep never touched `data/`, `.env*`, or `ignition/deployments/`.
  3. The contracts package runs on Hardhat 2. Its Ignition state hash-matches the SAFE-01 manifest, its bytecode is identical to the pre-move build, and the fork suite passes with the updated harness and artifact paths. The root `package.json` metadata is correct (`engines`, `packageManager`, no nonexistent `main`), and `.nvmrc` is present.
  4. Runtime dependencies are current and the tree is clean:
     - `npm audit --omit=dev` reports 0.
     - Runtime deps are at latest, landed one major per commit.
     - `uuid` is replaced by `crypto.randomUUID()`.
     - `npm ls ethers` shows a single ethers.
     - `npm ci` succeeds without `--legacy-peer-deps` on Windows and Linux.
  5. better-sqlite3 13 opens a copy of the production DB, never the live file, with migrations, WAL, and the persisted kill-switch state intact.
**Waves** (each gated by a zero decision-trace diff):
  - Wave 1: `.gitattributes` + renormalize.
  - Wave 2: the Prettier commit.
  - Wave 3: dead code, cycles, env-first loading, repo junk, and the two cited behavior fixes.
  - Wave 4: contracts package relocation on Hardhat 2, plus root dev-dep prune and manifest metadata.
  - Wave 5: runtime dependency bumps, one major per commit.
  - Wave 6: better-sqlite3 13 verified on a prod-DB copy.
**Conventions**: D-STOP-THE-LINE (a cleanup or bump that moves the trace on a money path, or any change to the Ignition record or bytecode during relocation, halts the wave and is re-surfaced); D-ROLLBACK (dead paths deleted outright; no shims at the old Hardhat paths); D-NONCE-AUTHORITY-ALL (census unchanged except for deleted dead signing sites, including across the ethers bump); D-EVIDENCE-BAR (submission-path bumps are not live-proven until Phase 32).
**Operator decisions**: OD-9 and OD-10 before Wave 3, plus the CLEAN-05 alert-text card. OD-1 is resolved (OpenZeppelin stays at 5.4.0). OD-3 defaults to keeping axios 1.21. OD-2 interim: keep the Flashbots library with `overrides` until Phase 29. OD-13 floor: `engines` ≥ 24.12.
**Research flag**: No (mechanical; the versions and the `allowScripts` fix are verified). The relocation needs care around Ignition state paths and the fork-harness spawn path.
**Plans**: TBD

### Phase 26: Toolchain & ESM
**Goal**: The bot runs as ES modules under Node's built-in type stripping, with no ts-node and no wrapper process. Tests run on Vitest 5 with none dropped. ESLint 10 is configured but not yet blocking. Consolidated `nodenext` tsconfigs type-check `test/` and `scripts/`, TS 7 is the type-check gate, and CI runs on SHA-pinned actions across Node 24 and 26. Trading behavior is unchanged.
**Depends on**: Phase 25 (contracts are already isolated, so Hardhat stays out of the bot's module system)
**Requirements**: TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05, TOOL-06, TOOL-07, CI-04
**Success Criteria** (what must be TRUE):
  1. The toolchain is in place:
     - Vitest 5 per-project test counts equal the baseline plus intentional additions, shown in a committed count diff.
     - `npm run lint` runs ESLint 10 + typescript-eslint (`strictTypeChecked`, on the TS 6 alias) with the OD-4/OD-5 policies, non-blocking.
     - tsconfigs are consolidated on `nodenext`, with `test/` and `scripts/` type-checked.
     - TS 7 `tsc` passes on root and dashboard, with the TS 6 alias used only by compiler-API consumers and a tracked removal note (TOOL-F1).
  2. The bot runs as ES modules:
     - ts-node is gone.
     - A real-Node import smoke (not Vitest) imports every entry point under the dummy env and a temp `DB_PATH`, and starts no listeners.
     - The decision trace is byte-identical.
     - Each lock and registry singleton loads exactly once.
     - The Flashbots bundle path is rehearsed under ESM on both the harness and the fork, with no cross-boundary `instanceof`.
  3. Under the exact new start command, a single Ctrl+C in Git Bash and in PowerShell triggers only stage-1 graceful shutdown. This is proven with an entry point that installs the real SIGINT handler, not by booting the trading bot. The runbook, `package.json` scripts, and STATE.md operating notes change in the same plan as the command, and nothing still names `npx ts-node`.
  4. GitHub Actions are pinned by commit SHA, workflows declare `permissions: contents: read`, and unit + integration tests run on a Node 24 + 26 matrix (OD-13). Any Node 26 failure is triaged as a finding, never allowlisted.
**Waves**:
  - Wave 1: Vitest 5 on CommonJS, with a test-count diff.
  - Wave 2: TS 6 alias, ESLint 10 config (non-blocking), consolidated `nodenext` tsconfigs covering `test/` and `scripts/`.
  - Wave 3: SHA-pinned actions + Node 24/26 matrix.
  - Wave 4: ESM + type stripping + import smoke + Flashbots ESM rehearsal + Ctrl+C test, with the runbook, scripts, and STATE start-command updates in the same plan (TOOL-07).
  - Wave 5: TS 7 `tsc` gate, plus a final sweep confirming nothing names `npx ts-node`.
**Conventions**: D-NONCE-AUTHORITY-ALL (a dual-loaded `withNonceLock` would split the nonce authority, so the SAFE-03 guards must hold under ESM); D-STOP-THE-LINE (a money-path test that drops or changes outcome under Vitest 5 is investigated, never deleted to get green); D-FORK-REHEARSAL; D-EVIDENCE-BAR (the ESM runtime on the submission path is live-proven only at Phase 32); D-ROLLBACK (ts-node removed outright; no dual start command).
**Operator decisions**: OD-4, OD-5, and OD-23 (strictness target) before Wave 2. OD-7 was decided at scoping (fallback if blocked: stay CommonJS with contracts still isolated). OD-13: matrix 24 + 26, building on 24, decided by the end of the phase.
**Research flag**: Yes (ESM boot spike: dual ethers with the Flashbots bundle, gramjs subpaths, `import.meta.main`, `package.json#imports` with Vitest/knip/dependency-cruiser, Vitest 5 mocking under type stripping).
**Plans**: TBD

### Phase 27: Domain Restructure & Runtime Seams
**Goal**: `src/` is organized by domain and `src/utils/` is gone. The oversized files are split, with `bot.ts` dissolved last and no file over 400 lines, and dependency-cruiser enforces the architecture and the money-path rules. Imports are side-effect-free behind explicit `init()`, one config module is the only reader of `process.env`, poll loops cannot overlap, and a registry owns every timer. Oversized functions are decomposed; money-path ones only under OD-12.
**Depends on**: Phase 26
**Requirements**: STRUCT-01, STRUCT-02, STRUCT-03, STRUCT-04, STRUCT-05, STRUCT-06, QUAL-04, QUAL-05
**Success Criteria** (what must be TRUE):
  1. Every move commit is a pure move, and every split commit passes the non-import-statement-hash multiset check; each has zero decision-trace diff. Importers and `vi.mock` specifiers are updated in the same commit, the mock-path gate passes on every commit, and no compatibility shims exist at old paths.
  2. `src/` is organized by the 13 domains, `utils/` is gone, and `app/main.ts` is the entry point; its start-command change updates the runbook, scripts, and STATE notes in the same plan. No `src/` file exceeds 400 lines (comments excluded). dependency-cruiser blocks in CI on:
     - violations of the direction matrix
     - cycles
     - signing outside the nonce-authority signer
     - snipe paths that reach public submission
     - non-leaf use of `api/`

     Each rule is shown failing on a violating fixture.
  3. Runtime seams are in place:
     - Importing any module other than `app/main.ts` has no side effects, proven by an import-side-effect test.
     - One validated config module is the only reader of `process.env`, and per-call reads keep their per-call semantics.
     - Each poll loop runs at most one cycle at a time.
     - Shutdown leaves zero live timers.
     - The overlap change lands as a `behavior:` commit citing its decision.
  4. The boot/resume/arm ordering, same-block ordering, listener-count, singleton-identity, and signing-census tests pass unchanged throughout. Money-path functions (`executeFullSell`, the snipe handlers, `executeDeliberateBuy`) are decomposed only with characterization, RED tests, and OD-12 sign-off. If OD-12 declines, a recorded config override scopes them out of the size gate.
**Waves**:
  - Wave 1: foundation domains via pure moves, then splits: `infra` (including the db split with `runMigrations`), `config`, `chain` (chainRegistry split), `safety`, `risk` (affordability extracted from preflight), `submission`.
  - Wave 2: trading domains plus splits: `exit`, `anti-rug`, `ops`/preflight, `execution`, `detection`, `api`. Then `bot.ts` is dissolved into `app/main.ts` last, followed by the 400-line gate and the dependency-cruiser rules.
  - Wave 3: runtime seams: explicit `init()`, the single config module, non-overlapping loops, and the disposables registry.
  - Wave 4: function decomposition. Non-money functions freely; money-path functions per OD-12.
**Conventions**: D-NONCE-AUTHORITY-ALL (nonceAuthority identity is preserved, the R-SIGN rule makes it structural, and decomposed money-path functions keep every signing call inside `withNonceLock`); D-ROLLBACK (no shims, no `bot.ts` stub, no fallback to import-time init); D-STOP-THE-LINE (a capital bug exposed by a move is not fixed inside the move commit; it is re-surfaced and may spawn a decimal phase); D-ENV-EXAMPLE [USER-BINDING] (the config module becomes the source of truth for the env reference).
**Operator decisions**: The poll-overlap card (candidate #21) before Wave 3. OD-12 before any money-path decomposition in Wave 4.
**Research flag**: No (standard mechanics; re-measure line ranges and function sizes at plan time).
**Plans**: TBD

### Phase 28: Lint-Zero & Real-Path Test Quality
**Goal**: The codebase is clean under `strictTypeChecked`, with zero errors, zero warnings, and zero inline disables in `src/`. No floating or misused promises remain, contract results are typed, and lint and format are enforced at commit time. The test suite proves money paths on the real mechanism: mechanism mocks are banned, property tests and a mutation baseline exist, and money-path coverage floors are measured on the rewritten suite.
**Depends on**: Phase 27
**Requirements**: QUAL-01, QUAL-02, QUAL-03, QUAL-06, QUAL-07, TOOL-08, TEST-06, TEST-07, TEST-08, TEST-09, TEST-10
**Success Criteria** (what must be TRUE):
  1. `npm run lint` reports zero errors and zero warnings under `strictTypeChecked` across `src/`, `test/`, `scripts/`, and `dashboard/`, with zero inline disables in `src/`, and every `lint:` commit has zero decision-trace diff. Every former floating or misused promise site is classified and fixed at its handler definition: no `await` is added inside handlers or poll loops in `lint:` commits, and listener identity is preserved, so the listener-count and same-block tests are unchanged.
  2. Contract calls use typed bindings with runtime asserts at money-math boundaries, and no `as number`/`as bigint` casts on results remain (OD-20); a RED test shows a wrong-typed result is rejected. `noUncheckedIndexedAccess` lands in its own commit. Type-coverage is ≥ 99% as a CI ratchet. Lefthook blocks a deliberately unformatted or lint-failing commit.
  3. The 30 `vi.mock('ethers')` files and the nonce/tx/MEV/exit mechanism mocks are rewritten as real-path tests, and a CI guard fails any `vi.mock` of a mechanism-set module. Dead, duplicate, and source-text tests are pruned with a per-file rationale, and the test counts reconcile.
  4. fast-check property tests cover minOut bounds, the fee clamp, env parsers, `priceMultiple`, `withNonceLock` interleavings, and at most one buy/sell per `chain:token`. Each property is shown to fail against a seeded mutant. A Stryker baseline for the money-math modules is recorded (OD-24).
  5. Per-glob coverage floors for buy, exit, anti-rug, nonce, and submission are set from post-rewrite measurement, ratchet-only, and enforced in CI.
**Waves**:
  - Wave 1: typed bindings, lint burn-down and promise sites, `noUncheckedIndexedAccess`, the type-coverage ratchet, lefthook.
  - Wave 2: mechanism-mock rewrite and the ban, plus pruning.
  - Wave 3: property tests and the Stryker baseline.
  - Wave 4: coverage floors measured on the rewritten suite and enforced.
**Conventions**: D-STOP-THE-LINE (a lint fix that would change money-path semantics, such as `||`→`??`, a removed guard, or an added `await`, is a finding, not a lint commit; a rewritten real-path test that goes RED on a money path is a finding, never fixed by weakening the test); D-NONCE-AUTHORITY-ALL (promise fixes keep lock scope and the census; interleaving properties run on the real lock); D-TEST-BOTH.
**Operator decisions**: OD-20 before Wave 1. OD-23 covers `noUncheckedIndexedAccess`, the type-coverage target, and the floor values. OD-24 sets the Stryker scope. OD-4 and OD-5 stay as ruled in Phase 26.
**Research flag**: Yes (typed-ABI approach per OD-20; `no-unnecessary-condition` policy for fail-closed branches per OD-4; StrykerJS vitest-runner compatibility with Vitest 5).
**Plans**: TBD

### Phase 29: Remaining Findings, Relay Client & Dashboard
**Goal**: Every confirmed S2–S4 finding is fixed or closed by an operator decision, with nothing deferred automatically. `@flashbots/ethers-provider-bundle` is replaced by a fork-rehearsed in-repo relay client that sends identical requests on a single ethers instance. The dashboard is upgraded and hardened, and every operator script is either safe or gone. All of this runs under the Phase 28 real-path suite, with lint kept at zero.
**Depends on**: Phase 28
**Requirements**: AUDIT-07, DEPS-05, DASH-05, DASH-06, DASH-07, DASH-08, HYG-03
**Success Criteria** (what must be TRUE):
  1. In the register, every confirmed S2–S4 finding is either fixed or closed by an explicit operator won't-fix decision, and none was deferred automatically. Each fix has a RED-then-GREEN test (real-path for money-path code) that a separate reviewer re-ran, and any behavior change is a `behavior:` commit citing its decision ID.
  2. On the harness with relay HTTP faked, the in-repo client sends the same relay requests as the library for V2/V3 buys, sells, and multi-builder fanout: same method, params, signed bundle bytes, and `X-Flashbots-Signature`. The library and its ethers `overrides` are removed, there is a single ethers, `npm ci` runs without `--legacy-peer-deps`, and `getBundleStatsV2` is gone. Every bundle-signing path goes through `withNonceLock`, and the client meets the submission coverage floor.
  3. A fork rehearsal of buy→monitor→sell through the new client passes; it proves wiring, not inclusion. Relay auth is checked against the production relay with a no-capital call chosen at plan time, or the gap is carried explicitly to Phase 32.
  4. The dashboard is upgraded and hardened:
     - Dependencies are at latest, with TS 7 and lint at zero, and the UI still renders.
     - Contract tests fail when a field the UI reads changes.
     - A non-allowlisted `Host` is rejected, and an empty `DASHBOARD_HOST` never binds a LAN interface.
     - Logins are rate-limited.
     - A repeated emergency-sell produces exactly one sell, proven by a RED-then-GREEN real-path test through `withNonceLock`.
     - The bundle is served from an absolute path regardless of cwd.
  5. Every script in `scripts/` works or has been removed. Every signing script either goes through the nonce lock and kill-switch or is refused while a bot holds the single-instance lock, and tests prove it.
**Waves**:
  - Wave 1: S2–S4 closure, money-path fixes first.
  - Wave 2: the relay client as its own isolated wave, after Wave 1 is verified: capture the library's requests, build the client, diff, remove the library, rehearse on the fork.
  - Wave 3: the dashboard upgrade and hardening. It is independent and may run alongside Waves 1–2.
  - Wave 4: scripts audit.
**Conventions**: D-STOP-THE-LINE (an S2–S4 that proves to be S0/S1 is re-surfaced and becomes a decimal phase); D-NONCE-AUTHORITY-ALL (bundle signing, emergency-sell, signing scripts); D-EVIDENCE-BAR (relay inclusion is closed only by the Phase 32 live roundtrip); D-FORK-REHEARSAL; D-ROLLBACK (the library is removed with no flag back); D-ENV-EXAMPLE [USER-BINDING] (Host allowlist and any new env); D-TEST-BOTH.
**Operator decisions**: Reconfirm the OD-2 client design before Wave 2. OD-8 and the DASH-07 cards before Wave 3. Won't-fix decisions for any AUDIT-07 item that is not fixed.
**Research flag**: Yes (current Flashbots relay/builder JSON-RPC surface and a no-capital auth check; per-finding research for the S2–S4 items).
**Plans**: TBD
**UI hint**: yes

### Phase 30: Hardhat 3 & ETH Checker Redeploy
**Goal**: The contracts package runs Hardhat 3 with only Ignition, Verify, and Keystore, pinned deterministic profiles, the `chain-1` record untouched, Slither/Mythril gates, a keystore deployer, and the fork suite green. Then the hardened `HoneypotChecker` (18-REVIEW-FIX plus latest OpenZeppelin) is deployed to ETH mainnet at a new, verified, re-audited address and validated read-only. Only after that is it wired into the committed config and preflight. The high-stakes-ops protocol applies end to end.
**Depends on**: Phase 29 (the contracts package comes from Phase 25; this phase is sequenced after every bot-side change so the fork suite is stable)
**Requirements**: HH-02, HH-03, HH-04, HH-05, TEST-11, HONEY-13, HONEY-14
**Success Criteria** (what must be TRUE):
  1. The Hardhat 3 toolchain is proven:
     - `evmVersion` and the optimizer are pinned identically in the `default` and `production` profiles, which produce identical bytecode.
     - Ignition v3 reads `chain-1` on a copy, leaving `deployed_addresses.json` and `journal.jsonl` byte-identical, and the original still hash-matches the SAFE-01 manifest.
     - Slither/Mythril fail on medium+ findings, shown with a violating fixture.
     - The deployer key comes from the keystore, and the default config has no mainnet network.
     - The fork suite passes on Hardhat 3 with the `ALLOW_REAL_MAINNET` tripwire intact.
  2. With OpenZeppelin bumped to latest on the 18-REVIEW-FIX source, the fork suite, Slither, and Mythril pass on the exact bytecode to be deployed. The contractual re-audit leaves no medium+ finding open.
  3. A Sepolia rehearsal of the full procedure succeeds before any mainnet action. The mainnet deploy then runs as an operator checkpoint:
     - step by step, with address checks
     - from the keystore deployer
     - under a new Ignition deployment id that leaves `chain-1` untouched
     - with no bot process holding the single-instance lock, if the deployer is the bot wallet

     The on-chain artifacts are the deploy tx hash, the address, and Etherscan-verified source, and the deployed runtime bytecode equals the audited build.
  4. Read-only `eth_call` validation on mainnet returns the correct verdict for known-good and known-honeypot tokens on V2 and V3 before any config change. Only then do the committed config default and the preflight code-at-address check switch to the new address. `npm run preflight` passes, and the old address `0x8243dBeA…13eD` is documented as retired.
**Waves**:
  - Wave 1: Hardhat 3 migration, pinned profiles, `chain-1` check on a copy, Slither/Mythril, keystore, fork suite.
  - Wave 2: OpenZeppelin bump to latest and the re-audit on the deploy bytecode.
  - Wave 3: Sepolia rehearsal.
  - Wave 4: mainnet deploy (operator checkpoint) and Etherscan verification.
  - Wave 5: read-only `eth_call` validation.
  - Wave 6: config switch, preflight update, retirement note.
**Conventions**: D-EVIDENCE-BAR (closure requires the on-chain artifacts); D-STOP-THE-LINE (any `chain-1` mutation, new medium+ finding, or validation anomaly halts the phase and is diagnosed, never marked "non-blocking"); D-ROLLBACK (the switch is a committed default with no runtime flag back to the old checker; a revert is a git revert of the config commit); D-NONCE-AUTHORITY-ALL (deployer signing never overlaps a bot process on the same wallet); D-FORK-REHEARSAL; the high-stakes-ops protocol.
**Operator decisions**: OD-1 is resolved: pin 5.4.0 until this phase, then bump to latest in Wave 2. OD-22 before Wave 1. The validation token corpus (known-good and known-honeypot, V2 and V3) and deployer funding before Wave 3.
**Research flag**: Yes (Hardhat 3 fork flags, `edr-simulated` vs a spawned `node --fork`; Ignition v3 against the v2-era `chain-1` journal, including whether `migrate` is needed; slither/crytic-compile with HH3 build-info per crytic-compile #629; the HH3 Ignition/Verify deploy flow; the validation corpus; the re-audit scope).
**Plans**: TBD

### Phase 31: Blocking CI Gates & Docs
**Goal**: Every quality gate blocks in CI at a zero baseline with no allowlists, and the supply chain is guarded. The operator, coming back after months away, can cold-start from the README, architecture doc, ADRs, and a runbook that CI keeps honest.
**Depends on**: Phase 30 (every gate baseline is at zero; the docs reflect the final start command and the new checker address)
**Requirements**: CI-01, CI-02, CI-03, DOCS-01, DOCS-02, DOCS-03, DOCS-04
**Success Criteria** (what must be TRUE):
  1. CI blocks on two sets of gates, each at a zero baseline with no allowlist:
     - Static: format check, lint (`--max-warnings 0`), TS 7 type-check, knip, dependency-cruiser, type-coverage.
     - Test: unit, integration, money-path coverage floors, the mock-path and mechanism-mock guards, the real-Node import smoke.

     A deliberately violating change fails each gate.
  2. The supply chain is guarded:
     - `npm audit --omit=dev` and `npm audit signatures` both block.
     - A weekly scheduled prod audit runs.
     - The full-history gitleaks scan is clean, and a CI secret scan blocks.
     - Dependabot is configured (grouped, with a cooldown).
  3. `docs/ARCHITECTURE.md` documents the module map, the dependency-direction rules, and the invariants: nonce authority, private snipes, fail-closed checker, single anti-rug listener, exit mutex, schema version, and persisted kill-switch. ADRs in `docs/adr/` capture the load-bearing decisions, with rationale moved out of code comments before those comments are removed.
  4. The README supports a cold start: setup, an env reference CI checks against the config schema, start/stop/preflight/pause/resume, and an explicit "there is no dry-run mode" warning. The runbook in `docs/operations/` is current, and CI fails if the runbook names an `npm run X` that does not exist.
**Waves**:
  - Wave 1: flip each static and test gate to blocking (each already at zero), with a violating-change proof for each.
  - Wave 2: supply-chain guards.
  - Wave 3: architecture doc and ADR backfill.
  - Wave 4: README, runbook, and the CI checks for the env reference and `npm run` names.
**Conventions**: D-NONCE-AUTHORITY-ALL and D-EVIDENCE-BAR (recorded as ADRs); D-ENV-EXAMPLE [USER-BINDING] (the env reference, `.env.example`, and the config schema agree); D-STOP-THE-LINE.
**Operator decisions**: OD-13 (keep the 24 + 26 matrix).
**Research flag**: No (the versions are verified and the gate order is specified).
**Plans**: TBD

### Phase 32: Re-Entry Gate (Fork Rehearsal & Live ETH Roundtrip)
**Goal**: The rebuilt bot is proven with real capital. That means a fork rehearsal on the final entry point, runtime, and new checker; a clean re-entry pre-flight; and one small real-capital buy→monitor→sell on ETH mainnet with on-chain artifacts. Once that passes, the bot may return to service.
**Depends on**: Phase 31 (everything)
**Requirements**: LIVE-01, LIVE-02, LIVE-03
**Success Criteria** (what must be TRUE):
  1. A fork rehearsal of the full buy→monitor→sell lifecycle passes on the final entry point and runtime, using the new ETH checker.
  2. The re-entry pre-flight passes:
     - It runs in a fresh shell with no `ALLOW_REAL_MAINNET`, `*FORK*`, or temp `DB_PATH` leftovers, and the env fingerprint is checked.
     - The live DB is backed up with `db.backup()` before the first boot on new code. That pre-migration backup is the only way back to v6.17, which has no newer-schema guard, so the v6.17 build is never pointed at a migrated (schema 8) DB.
     - `npm run preflight` is green.
     - The bot boots paused, and listeners, anti-rug arming, and the single-instance lock are verified before resume.
     - OD-19 and OD-13 are decided and recorded.
  3. One small real-capital buy→monitor→sell on ETH mainnet completes through the final submission path (the in-repo relay client) and the new checker. It leaves on-chain artifacts: tx hashes, the DB `amount_out`, and pino excerpts. The wallet ends flat with no stranded state: no open position, no pending nonce, and no orphaned intent row (if CAP-14 introduced one).
  4. Every anomaly in the live run is diagnosed before the item is marked passed, never written off as "non-blocking". A capital anomaly spawns a decimal phase under D-STOP-THE-LINE, and the bot stays off until it closes.
**Waves**:
  - Wave 1: fork rehearsal.
  - Wave 2: re-entry pre-flight and paused boot.
  - Wave 3: the live roundtrip as an operator checkpoint.
**Conventions**: D-EVIDENCE-BAR; D-STOP-THE-LINE; D-NONCE-AUTHORITY-ALL (live signing goes through `withNonceLock`, and the single-instance lock is verified); D-FORK-REHEARSAL; D-ROLLBACK (a revert is the v6.17 tag plus the pre-boot DB backup, never a runtime fallback flag); the high-stakes-ops protocol (address checks, step-by-step verification).
**Operator decisions**: OD-13 (final Node runtime) before Wave 1. OD-19 (anti-rug dry-run state at re-entry) before resume.
**Research flag**: Yes (review the live-proof procedure against the high-stakes-ops convention).
**Plans**: TBD

## Operator Decision Index (v7.0)

Undecided behavior-changing items default to "keep current behavior", per the milestone contract. The exception is S0/S1 capital findings: they cannot sit on the default, and they block the re-entry gate. Full context: [research/SUMMARY.md § Open Operator Decisions](research/SUMMARY.md).

| OD | Decision | Needed by |
|----|----------|-----------|
| OD-1 | OpenZeppelin version | **Resolved (operator, 2026-11-06):** pin 5.4.0 until Phase 30, then bump to latest there with the redeploy (Wave 2). |
| OD-2 | Flashbots library replacement | Decided at scoping (replace; DEPS-05). Interim `overrides` from Phase 25. Client design reconfirmed before Phase 29 Wave 2. |
| OD-3 | axios → native `fetch` | Phase 25 (default: keep axios 1.21; DEPS-F1) |
| OD-4 | Inline `eslint-disable` policy | Before Phase 26 Wave 2 |
| OD-5 | `require-await` policy | Before Phase 26 Wave 2 |
| OD-6 | Floating-promise / `unhandledRejection` policy | Phase 24 discussion (before Wave A) |
| OD-7 | ESM for the bot | Decided at scoping; the stay-CommonJS fallback is re-ruled only if Phase 26 hits a blocker |
| OD-8 | Dashboard scope | Before Phase 29 Wave 3 |
| OD-9 | `raceTelemetry.ts` keep or delete | Before Phase 25 Wave 3 (may be batched into the Phase 24 discussion) |
| OD-10 | Honor `LOG_LEVEL` from `.env` | Before Phase 25 Wave 3 (may be batched into the Phase 24 discussion) |
| OD-11 | H1/H2 single per-chain WS owner | Phase 24 discussion (before Wave C); re-surfaced if confirmed in Phase 23 |
| OD-12 | Money-path function decomposition | Before Phase 27 Wave 4 |
| OD-13 | Node 24 vs 26 | `engines` floor in Phase 25; matrix in Phase 26; build target by the end of Phase 26; final runtime before Phase 32 |
| OD-14 | Private-sell minOut | Phase 24 discussion (before Wave C) |
| OD-15 | Buy minOut on quote failure | Phase 24 discussion (before Wave B) |
| OD-16 | Telegram allowlist default and AND/OR semantics | Phase 24 discussion (before Wave B) |
| OD-17 | Nonce-lock head-of-line policy and re-entrancy detection | Phase 24 discussion (before Wave A) |
| OD-18 | Write-ahead intent row + `synchronous=FULL` (schema 7→8) | Phase 24 discussion (before Wave B) |
| OD-19 | Anti-rug 7-day dry-run state at re-entry | Before resume in Phase 32 |
| OD-20 | Typed contract bindings approach | Before Phase 28 Wave 1 |
| OD-21 | Track `ignition/deployments/` in git | Phase 22 Wave 1, after the backup verifies |
| OD-22 | Deployer key out of `.env` (keystore) | Before Phase 30 Wave 1 |
| OD-23 | Strictness target and coverage floors | Phase 26 (target); Phase 28 (`noUncheckedIndexedAccess`, type-coverage, floors) |
| OD-24 | Stryker mutation-testing scope | Before Phase 28 Wave 3 |
| OD-25 | Risk defaults and other inventory thresholds | Surfaced in Phase 22; ruled in the Phase 24 discussion if anything is to change |

## Progress

| Milestone | Phases | Status | Shipped |
|-----------|--------|--------|---------|
| v6.16 Production-Ready Multi-Chain MEV Sniper | 1–16 (55 plans) | ✅ Complete | 2026-04-14 |
| v6.17 Defensive Hardening for Live Mainnet | 17–21 + 21.1/21.2/21.3 (69 plans) | ✅ Complete (ETH-first) | 2026-05-29 |
| v7.0 Full Audit & Modernization | 22–32 (11 phases; plans TBD) | 🚧 In progress (0/11 phases) | — |

**v7.0 execution order:** 22 → 23 → … → 32. Any decimal insertions run between their integers.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 22. Safety Rails & Audit | 22/29 | In Progress | - |
| 23. Test Safety Net (Harness, Triage, Characterization) | 0/TBD | Not started | - |
| 24. Capital-Safety Fixes | 0/TBD | Not started | - |
| 25. Behavior-Neutral Cleanup & Dependencies | 0/TBD | Not started | - |
| 26. Toolchain & ESM | 0/TBD | Not started | - |
| 27. Domain Restructure & Runtime Seams | 0/TBD | Not started | - |
| 28. Lint-Zero & Real-Path Test Quality | 0/TBD | Not started | - |
| 29. Remaining Findings, Relay Client & Dashboard | 0/TBD | Not started | - |
| 30. Hardhat 3 & ETH Checker Redeploy | 0/TBD | Not started | - |
| 31. Blocking CI Gates & Docs | 0/TBD | Not started | - |
| 32. Re-Entry Gate (Fork Rehearsal & Live ETH Roundtrip) | 0/TBD | Not started | - |

Per-phase detail for shipped milestones lives in the `milestones/` archives.

---
*Last updated: 2026-11-06 — v7.0 roadmap revised to 11 phases (22–32) at operator request (same scope + AUDIT-07; risk isolation at the wave/plan/commit level); 100/100 requirements mapped; v6.16/v6.17 groupings preserved.*
