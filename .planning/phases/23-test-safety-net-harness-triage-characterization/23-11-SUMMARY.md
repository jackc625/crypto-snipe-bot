---
phase: 23-test-safety-net-harness-triage-characterization
plan: 11
subsystem: testing
tags: [vitest, ethers, better-sqlite3, realpath-harness, triage, knownBug, audit-register, risk-manager, daily-loss, exposure-cap, db-path, wal, synchronous]

requires:
  - phase: 23-01
    provides: FakeNode failNext with fired checks, createScenario, the fixed clock
  - phase: 23-28
    provides: setReceiptLogs (the real-encoded WETH Withdrawal on sell receipts), the Flashbots route
  - phase: 23-02
    provides: knownBug marker, the ordered timeline (submit, relay and db entries by position), recordedLogs, the AC-02 mock-list gate
  - phase: 23-27
    provides: createTempDbFile, restartGraph (whole-graph reload on the same file), runRailedChildToEnd, the Harness Gap Procedure (no gap was raised)
  - phase: 23-04
    provides: set-triage.ts, check.ts triage rules, the frozen triage population
  - phase: 23-07
    provides: fixtures/AUD-EXIT-001-sell-path.ts (installSellPath, foreignTrade, landNextSell) and fixtures/AUD-EXIT-002-position.ts
  - phase: 23-08
    provides: fixtures/AUD-API-001-dashboard-sell.ts (heldPosition, driveChain, exitStatusOf, sellsSince)
  - phase: 23-09
    provides: fixtures/AUD-TX-002-lock.ts (missBundlesUntil, settleAntiRugArming)
provides:
  - "Five real-path triage files covering six entries: AUD-DB-002, AUD-DB-001, AUD-DB-003, AUD-DB-004 with AUD-DB-021, and the AUD-DB-007 re-measurement; 14 tests, 11 knownBug claims, each reading looks fixed under its own fix-shaped src mutation, and a cross-file batch shows every mutation flips only its own claims"
  - "Triage outcomes for all six: five confirmed, AUD-DB-007 fixed (nothing of it remains after the 22-09 rail; marker next to the AC-26 rail test, RED proof row 12)"
  - "fixtures/AUD-DB-002-risk.ts (the graph's own canSnipe and risk SQL) and fixtures/AUD-DB-001-limits.ts (a limit checked twice on one database after whole-graph reloads, valid against abc; states built by the real buy and sell paths)"
affects: [23-16, phase-24, phase-29]

actuals:
  tokens: 17971    # chars/4 over the added lines of 28db4c2..abadd6f (16 files, 71883 chars, incl. the AUDIT-FINDINGS.md render)
  tasks: 3
  commits: 6       # MEASURED: git rev-list --count 28db4c2..HEAD before this SUMMARY commit
plan_head_before: 28db4c29fa16a0b7d7210e37a7e6709c8f651b5c
plan_head_after: abadd6f951a409e80bc0b0da95412dd1bb6ff37a
commits: 6

tech-stack:
  added: []
  patterns:
    - "A limit parsed once at import is tested by a whole-graph reload on the same temp database (restartGraph), once at a valid value and once at abc; the valid run must name the rule's own reason and details and no other rule may refuse the abc run, so the pair differs only in that rule"
    - "A fix that refuses to start is read as correct, not as a crash: a failed reload is returned as { loaded: false } and the connection the failed load opened is closed so teardown can remove the temp folder"
    - "Facts a test needs from the database are read while the valid graph is loaded, before a reload a fix may refuse"
    - "A durable record of a buy is any db timeline entry naming the token or a submitted hash, at any table, so a fix that writes an intent row into a new table reads looks fixed too"
    - "A production-path re-measurement outside Vitest runs the real src/utils/db.ts in a railed node -e child (ts-node registered from the repo root) from a throwaway working folder; each child's case ledger shows the rails and no network"

key-files:
  created:
    - test/realpath/triage/AUD-DB-002.test.ts
    - test/realpath/triage/AUD-DB-001.test.ts
    - test/realpath/triage/AUD-DB-003.test.ts
    - test/realpath/triage/AUD-DB-004.test.ts
    - test/realpath/triage/AUD-DB-007.test.ts
    - test/realpath/triage/fixtures/AUD-DB-002-risk.ts
    - test/realpath/triage/fixtures/AUD-DB-001-limits.ts
  modified:
    - test/integration/dbGuards.test.ts
    - .planning/audit/findings/AUD-DB-001.json
    - .planning/audit/findings/AUD-DB-002.json
    - .planning/audit/findings/AUD-DB-003.json
    - .planning/audit/findings/AUD-DB-004.json
    - .planning/audit/findings/AUD-DB-007.json
    - .planning/audit/findings/AUD-DB-021.json
    - .planning/audit/ledger/TESTI.json
    - .planning/audit/AUDIT-FINDINGS.md

key-decisions:
  - "Five entries confirmed on the real path (AUD-DB-002, -001, -003, -004, -021); AUD-DB-007 re-measured and closed as fixed, because nothing of it remains after the 22-09 rail"
  - "AUD-DB-001's MAX_OPEN_POSITIONS claim measures the risk gate, which is fail-open; the boot preflight refuses abc for that one variable (asserted after the marker), so the running bot is fail-closed for it today, as the register's sub-claim 1 already records"
  - "AUD-DB-002's loss case uses a 0.05 ETH snipe so the proceeds are far above the sell's gas: an ordinary loss, not the near-total loss today's SQL does count"
  - "No HARNESS GAP: every hold, fault and drive came from the public harness API and the committed fixtures"
  - "No new register entry and no severity change; one status change, AUD-DB-007 confirmed -> fixed (set-triage)"

patterns-established:
  - "Scratch runners in the session scratchpad: mutate.sh with medit.cjs (atomic, line-end-normalised fix-shaped mutations, byte-exact restore with hash proof), a cross-file batch over every mutation, logdump.sh with inject.cjs (a non-throwing afterEach that dumps every warn/error/fatal line and the op trail), reaudit.cjs (a ledger re_audit entry through lib.ts toJson after a byte round-trip check)"

requirements-completed: [AUDIT-02]

coverage:
  - id: D1
    description: "AUD-DB-002: rows from the real insert sites (decimal buy amount_in, wei sell and partial-sell amount_out and gas from the real receipt decoder); after a real stop-loss loss above the daily limit the loss is not counted and canSnipe allows the next snipe; after one real partial sell exposure is hugely negative and the exposure cap allows a snipe it should refuse"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-DB-002.test.ts (2 tests; an SQL-boundary wei-to-ETH conversion of each statement reads looks fixed on its own claim)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUD-DB-001: for each of the five risk variables, a state that trips only that rule is refused under a valid limit and allowed under abc after a whole-graph reload on the same database"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-DB-001.test.ts (5 tests; refuse-at-load and refuse-the-snipe fix shapes each read looks fixed on their own claim)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUD-DB-003: a real still-held failed-exit position drops out of the open-position limit and the exposure cap"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-DB-003.test.ts (2 tests; counting exit_failed_held in each statement reads looks fixed on its own claim)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUD-DB-004 with AUD-DB-021: a buy that lands two blocks late has no database record at its first submit or when mined (timeline positions); the bot's connection runs WAL at synchronous NORMAL"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-DB-004.test.ts (2 tests; a buy intent row before submitBuyTx and synchronous FULL each read looks fixed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "AUD-DB-007 re-measured outside Vitest from another working folder: the anchored database opens, a missing one is refused and nothing is created, unset and shipped DB_PATH resolve to the repo root; fails with either half of the rail removed"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-DB-007.test.ts (3 tests) and test/integration/dbGuards.test.ts 'AC-26 refuse-to-create outside Vitest > a missing path refuses, names the absolute path and creates nothing'"
        status: pass
    human_judgment: false
  - id: D6
    description: "AC-48: no test passes on answers a real node could never give (sell receipts carry the router's own constant-product WETH Withdrawal; the refused fallback is geth code 3 with the router's own revert; the late buy lands in a block it targets)"
    verification: []
    human_judgment: true
    rationale: "The plan family marks this prohibition as judgment: review of fake transport data"

duration: 32min
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 11: Risk-Limit and Database Findings on the Real Path Summary

**The risk limits that are meant to bound capital fail on the real path, with every row written by the bot's own buy and sell code:**
- An ordinary losing trade is never counted by the daily-loss breaker.
- One partial sell switches the exposure cap off.
- A non-numeric value turns off whichever of the five risk limits it is given to.
- A position stuck after a failed sell frees its slot and its exposure.
- A buy that has landed on chain has no database record until its submission returns.
- The database runs at synchronous NORMAL.

**AUD-DB-007 was re-measured and nothing of it remains:** after the Phase 22 rail, a start from another folder opens the right database or refuses. It is closed as fixed.

## Performance

- **Duration:** about 32 min
- **Started:** 2026-11-11T22:27:09Z
- **Completed:** 2026-11-11T22:59Z
- **Tasks:** 3 of 3. Task 1 tracer gate (interactive, end-of-phase mode, automated-only verify): the verify was re-run on the committed tree and passed, then Task 2 started.
- **Files:** 16 (7 test files created, 1 test file given one comment line, 8 register files modified)

## Per-finding outcomes

| Finding | Sev | Outcome | Test file and claim | What was proven | Left open |
|---|---|---|---|---|---|
| AUD-DB-002 | S1 | confirmed | AUD-DB-002.test.ts: `ordinary-loss-not-counted`, `partial-sell-makes-exposure-negative` | **Rows:** a real ETH V2 snipe writes the buy row (amount_in "0.05", decimal ETH). The real exit code writes the sell rows in wei through the real receipt decoder (a real-encoded WETH Withdrawal). **Loss:** another wallet dumps and the stop-loss sells for about 0.022 ETH against a 0.02 ETH daily limit (2 percent of 1 ETH). The proceeds are far above the sell's gas, so this is an ordinary loss. getDailyRealizedLoss stays 0 and the real canSnipe allows the next snipe. **Partial:** one 2x partial sell of a quarter makes getTotalExposure about -5.6e15, so a 0.012 ETH cap allows a snipe it should refuse. | Sub-claim 4 (dashboard P&L shows mixed units) stays code-read (API slice) |
| AUD-DB-001 | S1 | confirmed | AUD-DB-001.test.ts: `max-open-positions-unparsed`, `max-total-exposure-unparsed`, `daily-loss-pct-unparsed`, `snipe-cooldown-unparsed`, `max-position-size-unparsed` | **Setup:** one test per variable. A state that trips only that rule is built by the real buy and sell paths, or by the real recordSnipe for the cooldown. **Check:** canSnipe runs twice, each time after a whole-graph reload on the same temp database. The valid limit refuses with the rule's own reason and details. abc loads and is allowed outright. **MAX_OPEN_POSITIONS:** the boot preflight refuses abc (asserted), so the running bot is fail-closed for that variable while the risk gate is not. | The per-chain `<PREFIX>_MAX_CAPITAL` sub-claim stays code-read |
| AUD-DB-003 | S1 | confirmed | AUD-DB-003.test.ts: `failed-held-not-counted-open`, `failed-held-not-counted-in-exposure` | **Setup:** a real stop-loss exit fails on a still-held position. Its private attempts miss and the public fallback is refused at gas estimation (TRANSFER_FROM_FAILED). That leaves trades.status 'failed' and exit_failed_held, with every token held. **Check:** after a reload, the real canSnipe allows the next snipe under MAX_OPEN_POSITIONS 1, and again under a 0.015 ETH exposure cap. The bot's own restart query still counts the position as open. | The unrealized daily-loss half (card DB-01) stays code-read |
| AUD-DB-004 | S1 | confirmed | AUD-DB-004.test.ts: `row-written-after-submit` | **Setup:** a real ETH V2 snipe. Its one signed bundle misses its first two target blocks (empty blocks) and lands in its third. **Result:** by timeline position, no db entry naming the token or a buy hash exists at the first submit, nor when the buy is mined. The trades insert follows the submit and every relay body. The table was empty while the bundle was held. | Sub-claim 2 (the first shutdown signal closes the DB without waiting; a private closure of the boot) and sub-claim 4 (no boot reconciliation of holdings) stay code-read; sub-claim 3 (power loss) stays candidate |
| AUD-DB-021 | S2 | confirmed | AUD-DB-004.test.ts: `synchronous-normal` | On a temp file, right after a real buy wrote its position record, the bot's own connection reads PRAGMA synchronous 1 (NORMAL), journal_mode wal. | The power-loss consequence is documented SQLite behavior no test can prove (said in the test header and the triage note) |
| AUD-DB-007 | S1 | **fixed** | AUD-DB-007.test.ts (no knownBug); rail test `AC-26 refuse-to-create outside Vitest > a missing path refuses, names the absolute path and creates nothing` | **How:** the real db.ts runs outside Vitest, from a throwaway working folder, with a relative DB_PATH. **Results:** it opens the repo-anchored operator database (paused, one open buy) and creates nothing. A missing database is refused with DB_REFUSED_MISSING naming the anchored path, and nothing is created anywhere. Unset and ./data/bot.db resolve to `<repo root>/data/bot.db`. The tests fail with either half of the rail removed. | Nothing. Sibling AUD-DB-019 (cwd .bot-state.json import) is its own finding |

None of these entries is unreproduced or NOT-A-BUG.

## Task Commits

1. **Task 1 (tracer): AUD-DB-002** - `bf0dd91` (test)
2. **Task 2: AUD-DB-001 and AUD-DB-003** - `85cb403` (test)
3. **Task 2: the closes-finding marker next to the AC-26 rail test** - `29c13f9` (test; the only edit to dbGuards.test.ts)
4. **Task 2: AUD-DB-007 re-measured, closed as fixed, TESTI re_audit entry** - `ff06875` (test)
5. **Task 3: AUD-DB-004 with AUD-DB-021** - `4de5b9d` (test)
6. **Measured child timings in AUD-DB-007's limit comment** - `abadd6f` (test)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## New findings and grade/status changes

Made under the operator's standing instruction of 2026-11-11 ("All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading"), without a stop.

| Item | Change | Evidence |
|---|---|---|
| AUD-DB-007 | status confirmed -> **fixed** (S1 STRAND unchanged) | **Re-measured:** AUD-DB-007.test.ts, on the real `src/utils/db.ts` outside Vitest.<br>**The rail:** `src/utils/dbPath.ts` resolveDbPath anchors to findRepoRoot, and openGuardedDb refuses missing, empty or uninitialised files and opens with fileMustExist.<br>**Marker:** `closes-finding: AUD-DB-007` beside the AC-26 rail test (RED proof row 12, 22-09-3-refuse-to-create.txt).<br>**RED proof of my own tests:** each fails with each half of the rail removed (table below). |

**No new register entry. No severity changed.**

**Observed, not asserted (each belongs to an existing entry, no new finding):**
- **The near-total-loss refusal text mixes units.** AUD-DB-001's daily-loss state is a sell for less than its gas. Today's SQL counts it as -1649990069760659, so the operator reads "Daily loss on eth: 1649990069760659.0000 exceeds 0.5% of 1.0". This is AUD-DB-002's sub-claims 2 and 4 (it trips on a near-total loss; the numbers shown are mixed-unit).
- **`config.ts` loads `.env` from the working directory** (the dotenv default). By code reading: a start from a folder without `.env` leaves the required variables missing, and validateEnvVars exits fatally. So it is fail-closed, never a boot on another database. Not measured here.

## Files Created/Modified

- **The five triage files** under `test/realpath/triage/`: 14 tests, 11 knownBug claims.
- **`test/realpath/triage/fixtures/AUD-DB-002-risk.ts`:**
  - `graphRisk`, `canSnipeNow`: the graph's own riskManager instance;
  - `realizedLoss24h`, `totalExposure`, `openPositionCount`: the real statements on the graph's connection;
  - `tradeRows`.
- **`test/realpath/triage/fixtures/AUD-DB-001-limits.ts`:**
  - `reloadAndCheck`, `limitPair` (with `facts` read on the valid graph);
  - `enforced`, `otherRuleRefusal`;
  - `openPosition`, `nearTotalLoss`.
- **`test/integration/dbGuards.test.ts`:** one comment line, the closes-finding marker.
- **`.planning/audit/findings/*.json`:** triage blocks on the six entries (set-triage.ts).
- **`.planning/audit/ledger/TESTI.json`:** one reviewed re_audit entry for dbGuards.test.ts, 5378478..29c13f9. It covers the marker comment only. Without it, `--stage partial` fails on the changed file.
- **`.planning/audit/AUDIT-FINDINGS.md`:** re-rendered with render.ts (AUD-DB-007 status, the dbGuards re-audit row). OPERATOR-DECISIONS.md is byte-unchanged and SEAL.json is untouched.

## Decisions Made

See `key-decisions`. In short:
- **Every marker measures the harm**, so a fix in the storage format and a fix at the SQL boundary both read "looks fixed". The harm measured is:
  - whether the breaker or cap refuses;
  - whether a limit is enforced;
  - whether a durable record exists;
  - the connection's setting.
- **Setup facts hold under the bug, under every fix in this plan and under other findings' fixes.** The cross-file mutation batch shows it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correct isolation] AUD-DB-001 treats a refusal by another rule as a setup failure, not a fix**
- **Found during:** Task 2.
- **Issue:** canSnipe stops at the first failing rule (review concern, Codex 23-11 MEDIUM). An abc run refused by a later rule would otherwise read as "looks fixed".
- **Fix:** `otherRuleRefusal` must be null before the marker. A refusal at load, by the rule itself, or with a new reason counts as the limit enforced.
- **Committed in:** 85cb403.

**2. [Rule 1 - Bug in my own test] Database facts were read after a reload a fix may refuse**
- **Found by:** the refuse-at-load mutation. The setup fact `openPositionCount` read a closed connection ("The database connection is not open").
- **Fix:** `limitPair` takes a `facts` callback that reads on the valid run's graph, before the abc reload.
- **Result:** both load-time fix shapes then read "looks fixed", and teardown is clean (the failed load's connection is closed).
- **Committed in:** 85cb403.

**3. [Rule 3 - Blocking] dbGuards.test.ts needs a re_audit entry once changed**
- **Rule:** the 23-04 rule. A file added after audit_base_sha with a ledger row needs a re_audit entry ending at its last-change SHA, or `--stage partial` fails.
- **Fix:** the marker went in its own commit (29c13f9). The next commit added a reviewed entry 5378478..29c13f9 to ledger/TESTI.json through lib.ts toJson (byte round-trip checked first).
- **Result:** partial passes from ff06875 on. The marker is still the only edit to dbGuards.test.ts itself.
- **Committed in:** 29c13f9, ff06875.

**4. [Rule 2 - Faithful setup] AUD-DB-002's loss case uses ETH_SNIPE_AMOUNT 0.05**
- **Why:** with 0.01 ETH, a sell's gas (in wei) could exceed its proceeds (in wei). Today's SQL does count that near-total-loss case, which would hide the ordinary-loss bug.
- **Done:** the test asserts the proceeds are more than twice the gas before the marker.
- **Committed in:** bf0dd91.

**5. [Rule 2 - Plan wording read faithfully] AUD-DB-004's "hold on inclusion" is mined empty blocks, not a held RPC call**
- **What:** the bundle's first two target blocks are mined without it (missBundlesUntil), and the third includes the same signed transaction (driveChain 'land').
- **AUD-TX-028:** no provider read is held anywhere, so that finding cannot decide the result.
- **Committed in:** 4de5b9d.

**6. [Rule 2 - Faithful setup] AUD-DB-021 reads the pragma right after a real buy wrote its position, on a temp file**
- **Plan:** "read PRAGMA synchronous from the real connection".
- **Why:** so the value is the one in force for the just-written position record, with WAL on a real file (a `:memory:` database has no WAL).
- **Committed in:** 4de5b9d.

**7. [Rule 2 - Clean stop] AUD-DB-003 uses EXIT_ROUTINE_MAX_FAILURES=1**
- **Why:** after the one forced failure no routine retry is in flight when the graph is reloaded. The fatal `exit.failed.held.routine-paused` line is that setting.
- **Committed in:** 85cb403.

**8. [Rule 1 - Wording] Two test comments corrected after measurement**
- **AUD-DB-002:** its header no longer contains the literal `insertTrade`, so a text check of the "no direct insertTrade call" criterion is unambiguous.
- **AUD-DB-003:** its header no longer predicts `exit.routine.paused-skip` warnings, which the runs did not produce.
- **Committed in:** bf0dd91, 85cb403.

---

**Total deviations:** 8 (Rule 1: 2, Rule 2: 5, Rule 3: 1). **Impact:**
- The proofs measure the harm and are isolated from each other's fixes.
- `src/` is unchanged.
- Nothing under `test/realpath/harness/` was written, and no HARNESS GAP was raised.

## Issues Encountered (all diagnosed)

- **Warn/error lines, all explained.** Each test file was dumped with a non-throwing scratch afterEach, and the copy deleted.
  - `antirug.backfill.gap-detected`: the first registration on a fresh database, AUD-ANTIRUG-024. Every buy test has it.
  - `Risk check failed`: the valid-limit run of each AUD-DB-001 test, deliberately (exactly one per test).
  - AUD-DB-003, the forced misses and refusal:
    - `mev.reconcile.not-landed`;
    - `mev.escalation.ceiling-hit`, whose "priority-fee ceiling" wording is AUD-TX-029;
    - `exit.private.not-landed`;
    - `exit.full.failed` with TRANSFER_FROM_FAILED;
    - `exit.failed.held`;
    - the fatal `exit.failed.held.routine-paused` (EXIT_ROUTINE_MAX_FAILURES=1).
  - AUD-DB-007's children print only their RESULT line and pino's "Database connection closed". Their stderr is empty.
- **One scratch mutation shape was too narrow, and was corrected.**
  - Removing only the missing-file refusal and fileMustExist still left the empty-file refusal, so nothing was created and the test failed on a different code (DB_REFUSED_EMPTY).
  - With the empty-file branch removed too (as RED proof 22-09-3 did), the test fails on the file it created.
- **The first AUD-DB-004 fix mutation duplicated the buy row.** It was reshaped to an intent row plus an update of its hash, so the cross-file batch measures a real fix shape.
- **`--stage final`** keeps Phase 22 bookkeeping FAILs (ledger rows for Phase 23 test and fixture files), out of scope per 23-04.
- Git's "LF will be replaced by CRLF" notices come from `core.autocrlf=true`; the blobs are LF.

## Verification (exact commands, Node 22.16.0 via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

**Task verifies:**
- **Task 1:** the plan's command gave 2/2, `--slice DB` PASS and the triage block present. It was re-run on the committed tree as the tracer gate.
- **Task 2:** AUD-DB-001, -003 and -007 gave 10/10, `--slice DB` PASS, and all three triage outcomes present.
- **Task 3:** AUD-DB-004 gave 2/2, `--slice DB` PASS, and both triage outcomes present.
- **Acceptance checks:**
  - AUD-DB-002.test.ts and its fixture contain no `insertTrade` (grep count 0) and no INSERT or `.run(`.
  - AUD-DB-001.test.ts has five `it` blocks, each with its valid-limit control and its own literal claim.
  - `git status --porcelain data` is empty.
  - AUD-DB-004.test.ts has exactly one knownBug for AUD-DB-004 and one for AUD-DB-021, and no `.at` comparison (positions only).

**Full railed suite (`npm test -- --reporter=json`, on the committed tree before the comment-only commit abadd6f):**
- 189 files, 1369 tests: 1369 passed, 0 failed, 0 skipped, 0 todo, 0 unhandled errors.
- By project: unit 944, integration 263, realpath 162 (run run-20261111T225335-20804-47547e). That is 1355 before plus this plan's 14.
- This plan's tests under the full parallel load, in ms:
  - AUD-DB-001: 1810, 590, 1223, 209, 234;
  - AUD-DB-002: 2839, 1204;
  - AUD-DB-003: 2686, 1267;
  - AUD-DB-004: 3449, 381;
  - AUD-DB-007: 1943, 1671, 2064.
- Every one is under half the 15 s default. AUD-DB-007 keeps an explicit 120 s limit for its child processes, with the measured times in its comment (about 0.8 s alone).
- Rails ledger: `nonLoopbackAllowed` 0 and `telegramAllowed` 0.

**Repeatability (AC-10):** the five files ran three times with the JSON reporter. 14 tests and 11 knownBug records each time, identical (titles, status and every record), success true.

**Gates and type checks:**
- `tsc --noEmit` exits 0 on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json.
- The scratch tsconfig extending the repo's (test/realpath/triage/**/*.ts, module esnext): 0 errors over 59 triage files.
- `npm run check:realpath-mocks`: 35 vi uses (7 mock calls) in 74 files, 0 violations.
- `npm run check:vi-mock`: 591 mock calls in 248 files, 0 violations.

**Register:**
- `check.ts --stage partial`: PASS, fail 0, pending 60. `--stage consolidation`: PASS.
- `--stage triage`: 60 FAILs, all expected:
  - 16 population entries other plans have not recorded (22 before this plan, minus this plan's 6);
  - 38 S0/S1 acknowledgements owed to 23-16 (34 before, plus this plan's 4: AUD-DB-001, -002, -003, -004);
  - 4 `fork_ref`s (AUD-BUY-015, AUD-BUY-033, AUD-EXIT-003, AUD-ANTIRUG-003);
  - AUD-TX-006's keep-open ruling;
  - the run-evidence file.

**src and fix signals:**
- `git status --porcelain src` was empty at every commit and after every mutation.
- Every scratch mutation was restored with `git -c core.autocrlf=false checkout`, and `git hash-object` was IDENTICAL to the HEAD blob each time.
- The full batch ran every mutation against all five plan files:

| Mutation | Result |
|---|---|
| none | all 14 pass |
| getDailyRealizedLoss converts wei to ETH at the SQL boundary | AUD-DB-002 ordinary-loss-not-counted looks fixed; every other test passes |
| getTotalExposure converts partial-sell wei to ETH | AUD-DB-002 partial-sell-makes-exposure-negative looks fixed; every other test passes |
| loadRiskConfig throws on a NaN MAX_OPEN_POSITIONS (refuse to start) | AUD-DB-001 max-open-positions-unparsed looks fixed; every other test passes |
| the exposure check refuses unless total + amount <= cap (NaN refuses) | AUD-DB-001 max-total-exposure-unparsed looks fixed; every other test passes |
| loadRiskConfig throws on a NaN DAILY_LOSS_PCT | AUD-DB-001 daily-loss-pct-unparsed looks fixed; every other test passes |
| the cooldown check refuses unless elapsed >= cooldown | AUD-DB-001 snipe-cooldown-unparsed looks fixed; every other test passes |
| the size check refuses unless amount <= cap | AUD-DB-001 max-position-size-unparsed looks fixed; every other test passes |
| loadRiskConfig validates all five at load (the recommendation) | all five AUD-DB-001 claims look fixed; every other test passes |
| getOpenPositionCount counts exit_failed_held buys | AUD-DB-003 failed-held-not-counted-open looks fixed; every other test passes |
| getTotalExposure counts exit_failed_held buys | AUD-DB-003 failed-held-not-counted-in-exposure looks fixed; every other test passes |
| a buy intent row before submitBuyTx, its hash recorded after (V2 snipe) | AUD-DB-004 row-written-after-submit looks fixed; every other test passes |
| synchronous FULL in db.ts | AUD-DB-021 synchronous-normal looks fixed; every other test passes |
| rail removed: resolveDbPath against process.cwd() | all three AUD-DB-007 tests fail; every other test passes |
| rail removed: missing and empty refusals plus fileMustExist off | AUD-DB-007 missing-database-is-refused-and-nothing-created fails on the created file; every other test passes |

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## For 23-16

- Acknowledge, in the S0/S1 batch report, the four S1 entries confirmed here: AUD-DB-001, AUD-DB-002, AUD-DB-003, AUD-DB-004.
  - **AUD-DB-001 nuance:** for MAX_OPEN_POSITIONS the boot preflight refuses abc today, so only the four other limits are off in the running bot.
- AUD-DB-021 (S2) needs no acknowledgement.
- **AUD-DB-007 is fixed:** its `rail_test` must be in `passed_tests` of the run evidence. That is the integration-project test "AC-26 refuse-to-create outside Vitest > a missing path refuses, names the absolute path and creates nothing", so the evidence must include an integration run.
- Collect the 11 knownBug records from the five files into the run evidence. AUD-DB-007.test.ts has none.

## Next Phase Readiness

**Phase 24 (card DB-01 / OD-58):**
- AUD-DB-002 and AUD-DB-003 decide the risk SQL.
- AUD-DB-001 is the typed-settings fix (card OD-25, option align-one-parser).
- Each file runs alone as a before-and-after proof. The fix shapes the markers see are named in each test header and the table above.
- Until AUD-DB-002 and AUD-DB-003 are fixed, the daily-loss breaker and the exposure cap should be treated as not working: an OD-25 value change alone changes nothing.

**Card OD-18:**
- AUD-DB-004's intent-row fix and AUD-DB-021's synchronous setting are its two halves.
- The marker sees an intent row in any table.

**Later triage plans:** `fixtures/AUD-DB-001-limits.ts` gives a reload-based "valid against abc" pair on one database, which also suits other import-time parsers. Reuse it rather than duplicating.

## Self-Check: PASSED

- **Files found:** the five triage test files and two fixtures under test/realpath/triage/; the marker in test/integration/dbGuards.test.ts; the six findings carry triage blocks (five confirmed, AUD-DB-007 fixed).
- **Commits found on this branch:** bf0dd91, 85cb403, 29c13f9, ff06875, 4de5b9d and abadd6f (`git rev-list --count 28db4c2..HEAD` = 6 before this SUMMARY).
- **Re-run after the last commit:** every task's acceptance criteria and the plan-level verification pass (all five files pass on Node 22; `check.ts --stage partial --slice DB` exits 0).
- **Clean tree:** no scratch file is left under test/ or src/; `git status --porcelain src test data` is empty.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*
