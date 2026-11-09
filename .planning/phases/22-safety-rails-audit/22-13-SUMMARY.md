---
phase: 22-safety-rails-audit
plan: 13
subsystem: infra
tags: [safe-04, process-lock, sqlite, better-sqlite3, boot-entry, direct-entry-guard, red-proofs, aud-tx-005]

requires:
  - phase: 22-safety-rails-audit (22-08)
    provides: scripts/verify-prod-untouched.ts wrapper, spawnRailedChild, rail ledger
  - phase: 22-safety-rails-audit (22-12)
    provides: src/guards/ folder and the duplicate-load guard this plan sits beside
provides:
  - src/utils/processLock.ts acquireProcessLock, tryAcquireThenRelease, defaultLockDir, ProcessLockError (codes PROCESS_LOCK_HELD, PROCESS_LOCK_MECHANISM)
  - src/main.ts runMain and the new boot entry (error code MAIN_NO_WALLET)
  - src/guards/directEntry.ts isDirectEntry, refuseIfDirectEntry; first statement of src/bot.ts
  - npm start, and the start command updated in README, three docs, the go-live runbook and STATE.md
  - test/integration/processLock.test.ts, test/integration/directEntryGuard.test.ts, test/unit/mainEntry.test.ts and the lockHolder.ts fixture
  - red-proofs/22-13-1, 22-13-2 and 22-13-3
affects: [22-15, 22-16, 22-29, phase-24, phase-26, phase-29, phase-32]

actuals:
  tokens: 18821
  tasks: 3
  commits: 8
plan_head_before: 23964a3350c830991ae19db14d40be85457b668f
plan_head_after: 1f4e34cb092aad1e64253956033504801f535c68

tech-stack:
  added: []
  patterns:
    - "A process-wide resource that the OS releases on death, pinned on globalThis under Symbol.for so garbage collection cannot silently release it"
    - "A first-statement side-effect import that refuses a direct start before any later import runs, proven with a marker-writing import and a wrong-order control"
    - "A race proof built on a READY handshake, a barrier, and a winner that holds until every contender has reported, rather than on counting wins"

key-files:
  created:
    - src/utils/processLock.ts
    - src/main.ts
    - src/guards/directEntry.ts
    - test/integration/processLock.test.ts
    - test/integration/directEntryGuard.test.ts
    - test/unit/mainEntry.test.ts
    - test/integration/fixtures/lockHolder.ts
    - test/integration/fixtures/importMarker.ts
    - test/integration/fixtures/directEntryFixture.ts
    - test/integration/fixtures/directEntryFixtureGuard.ts
    - test/integration/fixtures/directEntryLateFixture.ts
    - test/integration/fixtures/directEntryStarterFixture.ts
    - .planning/phases/22-safety-rails-audit/red-proofs/22-13-1-lock-pin.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-13-2-lock-refusal.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-13-3-direct-entry-first-import.txt
    - .planning/audit/inputs/rails-discoveries.json
  modified:
    - src/bot.ts
    - package.json
    - README.md
    - docs/DEVELOPMENT.md
    - docs/GETTING-STARTED.md
    - docs/operations/anti-rug-rollout.md
    - docs/operations/going-live.md
    - .planning/STATE.md

key-decisions:
  - "22-13: SQLite gives zero winners when processes collide in its lock upgrade with timeout 0 (measured in the race proof). SQLite's timeout stays 0 as D-06 says, and the whole attempt is retried for one second. A genuine holder still refuses, about a second later, and a collision resolves to exactly one winner"
  - "22-13: src/main.ts accepts a PRIVATE_KEY with or without the 0x prefix, exactly as new ethers.Wallet does, so the lock key is the wallet the bot signs with and a key without 0x is not falsely refused"
  - "22-13: MAIN_NO_WALLET uses fixed text and carries no cause, because ethers errors can quote the rejected value, which would be the private key"
  - "22-13: the lock rail for AUD-TX-005 (RC-18, second bot process) is in place; its register status stays with 22-29's re-audit"
  - "22-13: the scripts-while-held proof records today's behaviour only; it does not settle card SCRIPTS-01, which stays open for Phase 29"

patterns-established:
  - "Early refusals write with process.stderr.write and exit 1; nothing before the lock may load the logger"

requirements-completed: [SAFE-04]

coverage:
  - id: D1
    description: "A second bot process for the same wallet is refused while the first lives, and a force-killed holder leaves nothing to clean up (AC-23 a, b; T-22-34)"
    requirement: SAFE-04
    verification:
      - kind: integration
        ref: "test/integration/processLock.test.ts#a second acquire for the same wallet is refused; #a force-killed holder leaves nothing to clean up (real child processes, taskkill /F, wrapped, verdict untouched)"
        status: pass
      - kind: other
        ref: ".planning/phases/22-safety-rails-audit/red-proofs/22-13-2-lock-refusal.txt"
        status: pass
    human_judgment: false
  - id: D2
    description: "Simultaneous starts produce exactly one winner per round (AC-23 c, E15, T-22-86): rounds=10 winners=10 ready=60 attempts=60 overlaps=0"
    requirement: SAFE-04
    verification:
      - kind: integration
        ref: "test/integration/processLock.test.ts#simultaneous acquires give exactly one winner per round (6 clean runs after the retry fix)"
        status: pass
    human_judgment: false
  - id: D3
    description: "preflight, pause and resume run while the lock is held and leave it held; they import neither the lock nor main (AC-23 d, E15)"
    requirement: SAFE-04
    verification:
      - kind: integration
        ref: "test/integration/processLock.test.ts#preflight, pause and resume run while the lock is held"
        status: pass
    human_judgment: false
  - id: D4
    description: "Lock failures refuse boot: a held lock, a lock-mechanism error, garbage collection and a missing or invalid key never reach startBot (NAC-07, STL-5)"
    requirement: SAFE-04
    verification:
      - kind: unit
        ref: "test/unit/mainEntry.test.ts cases (1) (2) (3) and MAIN_NO_WALLET"
        status: pass
      - kind: integration
        ref: "test/integration/processLock.test.ts#gc; #a lock-mechanism error refuses"
        status: pass
      - kind: other
        ref: ".planning/phases/22-safety-rails-audit/red-proofs/22-13-1-lock-pin.txt"
        status: pass
    human_judgment: false
  - id: D5
    description: "src/bot.ts cannot be started directly and refuses before any stateful import runs, and loading it from another entry is not refused (T-22-33, T-22-85)"
    requirement: SAFE-04
    verification:
      - kind: integration
        ref: "test/integration/directEntryGuard.test.ts (fixture entries with bot.ts's import shape, wrong-order control, no-false-refusal case)"
        status: pass
      - kind: unit
        ref: "test/unit/mainEntry.test.ts cases (4) (5) (6) (TypeScript AST checks)"
        status: pass
      - kind: other
        ref: ".planning/phases/22-safety-rails-audit/red-proofs/22-13-3-direct-entry-first-import.txt"
        status: pass
    human_judgment: false
  - id: D6
    description: "The bot.ts diff is one added first-line import, its comment and the require.main block; startMultiChainBot is called exactly as before (P6, NAC-06)"
    requirement: SAFE-04
    verification:
      - kind: other
        ref: "git diff 23a6461..HEAD -- src/bot.ts: 4 insertions, 1 deletion"
        status: pass
    human_judgment: true
    rationale: "NAC-06 is a judgment item; 22-29 re-audits this diff, as prohibition P6 requires"
  - id: D7
    description: "The operator start command is npx ts-node src/main.ts or npm start in every operator-facing document, and the real start path has not yet been exercised"
    requirement: SAFE-04
    verification:
      - kind: other
        ref: "git grep -n 'ts-node src/bot' -- README.md docs: no matches; package.json start script present"
        status: pass
    human_judgment: true
    rationale: "src/main.ts is never run as a program in Phase 22 (the bot stays off), so the first real npm start is at the Phase 32 re-entry; runMain and the guard are proven with fakes and fixtures only"

duration: 17min
completed: 2026-11-09
status: complete
---

# Phase 22 Plan 13: Single-Instance Process Lock and Lock-First Boot Entry Summary

**The bot now starts through `src/main.ts`, which takes an OS-released SQLite exclusive lock for the wallet before anything stateful loads, so a second bot for the same wallet refuses to start. Starting `src/bot.ts` directly exits before its first stateful import. This is the planned rail for AUD-TX-005 (RC-18, a second bot process); its register status stays with the 22-29 re-audit.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-11-09T03:43:00Z
- **Completed:** 2026-11-09T04:00:12Z
- **Tasks:** 3/3
- **Files:** 24 (16 created, 8 modified)

## Accomplishments

- **The lock.** `acquireProcessLock` opens `<lockDir>/<wallet>.lock` with SQLite timeout 0, `locking_mode=EXCLUSIVE` and `BEGIN EXCLUSIVE ... COMMIT`, then pins the handle on `globalThis`. A held lock gives `PROCESS_LOCK_HELD`; any other failure gives `PROCESS_LOCK_MECHANISM`, and both refuse boot.
- **The refusal says what to do.** A held lock names the wallet and the file, says to stop the other process, and says that after a kill nothing needs cleaning up. The private key is never printed; only the address is.
- **Boot order.** `src/main.ts` imports only `dotenv`, `ethers` and the lock module. It takes the lock, then does `require('./bot')` inside the `startBot` closure and calls `startMultiChainBot()` exactly as before, with no added `await` or `catch`.
- **Direct start refused.** `src/guards/directEntry.ts` is the first statement of `src/bot.ts`, so a direct start exits 1 before config, the DB open or the notifier load. The bottom `require.main` block is also a refusal. The fixture proof shows no later import ran, and the wrong-order control shows the test can see import order.
- **No false refusal.** Another entry that loads the guarded file (the shape of `main.ts` loading `bot.ts`) runs normally, and a held lock is matched with or without `0x` on the key.
- **Race proof.** `[AC-23c] rounds=10 winners=10 ready=60 attempts=60 overlaps=0`. Every contender reported READY before the barrier opened, and the winner held until all six had reported.
- **Start command.** `npm start` is new. README, `docs/DEVELOPMENT.md`, `docs/GETTING-STARTED.md`, `docs/operations/anti-rug-rollout.md`, `docs/operations/going-live.md` and STATE.md's Operating Notes all name `src/main.ts`.
- **RED proofs (AC-18):**

| # | Change (working tree only) | Run | RED result | GREEN |
|---|----------------------------|-----|------------|-------|
| 1 | `globalThis` pin removed | processLock.test.ts `-t gc` | contender acquired after the forced collections (exit 0, expected 1) | pass |
| 2 | `SQLITE_BUSY` swallowed in `acquireProcessLock` | processLock.test.ts `-t "second acquire"` | contender acquired while the holder lived | pass |
| 3 | `import './guards/directEntry'` moved below `./config` in `src/bot.ts` | mainEntry.test.ts `-t "bot.ts"` | case (5) failed: first statement was `ethers` | pass |

Every RED and GREEN run had wrapper verdict `untouched` with the manifest equal, and each restored file's sha256 matched.

## Task Commits

1. **Task 1: lock module and real-holder proofs (tracer).** `569f08c` (feat)
2. **Task 2 step A: entry, direct-entry guard, `src/bot.ts` edit, their tests.** `3786e2e` (feat)
3. **Task 2 fix: retry a busy lock attempt.** `961d269` (fix)
4. **Task 2 step B: race, scripts-while-held, GC and NAC-07 proofs.** `a93fd98` (test)
5. **Task 3 step A: start-command docs and `npm start`.** `9f47d5b` (docs)
6. **Task 3 RED proofs.** `3467a4d`, `4f0415f`, `1f4e34c` (docs)

**Plan metadata:** the docs commit that follows this SUMMARY.

## Files Created/Modified

- `src/utils/processLock.ts`, `src/main.ts`, `src/guards/directEntry.ts`: the lock, the entry and the guard.
- `src/bot.ts`: one first-line import with its comment, and the `require.main` block.
- `package.json`: the `start` script.
- `README.md`, `docs/DEVELOPMENT.md`, `docs/GETTING-STARTED.md`, `docs/operations/anti-rug-rollout.md`, `docs/operations/going-live.md`, `.planning/STATE.md`: the start command.
- `test/integration/processLock.test.ts`, `test/integration/directEntryGuard.test.ts`, `test/unit/mainEntry.test.ts`, `test/integration/fixtures/*`: the proofs.
- `.planning/audit/inputs/rails-discoveries.json`: one discovery (see Issues Encountered).

## Decisions Made

See `key-decisions`. D-06's wording and SQLite's timeout of 0 are unchanged; the retry sits above SQLite.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A simultaneous start could have zero winners**
- **Found during:** Task 2, the first run of the race proof.
- **Issue:** Some rounds ended with all six contenders refused. With timeout 0, processes colliding in SQLite's lock upgrade (each reaches SHARED, then none can reach EXCLUSIVE) all get `SQLITE_BUSY`. The research measured no overlapping holds, which is true, but "no overlap" does not give the AC-23c "exactly one winner". The failure was safe (nobody started) but wrong for a real double start.
- **Fix:** the whole attempt retries for up to one second with a short random pause, closing its handle each time. SQLite's timeout stays 0.
- **Files modified:** `src/utils/processLock.ts`
- **Verification:** the race passed in 6 of 6 further runs (10 rounds each). A real holder is still refused.
- **Committed in:** `961d269`

**2. [Rule 1 - Bug] A key without `0x` would have been refused at boot**
- **Found during:** Task 2 design, from the orchestrator's false-refusal question.
- **Issue:** the bot builds its wallet with `new ethers.Wallet(process.env.PRIVATE_KEY)`, which adds `0x` when it is missing. `computeAddress` alone throws on a key without it, so such a `.env` would have stopped the bot from starting at all.
- **Fix:** `walletAddress` accepts what the Wallet constructor accepts, and the test proves both forms derive the same lock key. The wording of the failure is fixed text, so an ethers error can never put the key in the output.
- **Committed in:** `3786e2e`

**3. [Plan omission] `docs/operations/going-live.md` also named the old start command**
- **Found during:** Task 3 read-through. It is not in the plan's file list, but the plan's own `git grep` review allows only historical mentions, and this is the go-live runbook (lines 213 and 534).
- **Fix:** updated with the other docs and added to the commit.
- **Committed in:** `9f47d5b`

**4. [Plan wording] Additions and interpretations**
- One extra fixture, `directEntryStarterFixture.ts` (the `main.ts` shape), for the no-false-refusal proof the orchestrator asked about.
- Extra cases: NAC-07 mechanism failures in real processes (an unusable folder and a lock file that is not a database), the `tryAcquireThenRelease` query, and `MAIN_NO_WALLET`.
- The plan's "normal exit" for pause and resume is exit 2 with `Could not reach the dashboard API`, because the holder runs no dashboard. The test asserts that exact path, so a crash would fail it.
- `src/main.ts` uses the same `if (!process.env.VITEST)` gate on `dotenv.config()` as every other site (D-01).
- The acceptance check `grep -c "start via src/main.ts" src/bot.ts` is met by the one-line comment on the guard, because the refusal text the plan specifies reads "start the bot via".
- `src/bot.ts`'s working copy is CRLF, so RED 3 restored it with `core.autocrlf=true` for a byte-exact result (sha256 matched). The `core.autocrlf=false` form used for the LF files would have rewritten its line endings.

---

**Total deviations:** 2 auto-fixed bugs, 1 plan omission, 1 group of wording notes.
**Impact on plan:** no trading, transaction or signing code changed. `startMultiChainBot` is untouched.

## Issues Encountered

- **The spawn-site gate fails at HEAD, and this plan did not cause it.** `test/unit/rails/spawnSites.test.ts` lists 6 offences, all in files from 22-12 (`test/rails/probes/duplicateLoadProbe.cjs`, 5 computed-path requires, and `test/unit/guards/singleton.test.ts:66`, a `.exec` on a RegExp). None spawns a process, and none reaches production state, so it is not a rail-class reach and no escalation was raised. No 22-13 file is among them, which is what this plan's acceptance criterion was checking. The plan's Discovery rule forbids fixing it here, so it is recorded in `.planning/audit/inputs/rails-discoveries.json` as S3. **22-15 will hit it on its first full-suite run.** The command that made commit `569f08c` also ran this gate and did not stop on its failure; that commit's own plan gate had already passed.
- **Live `data/` protection:** every Vitest run was wrapped; every verdict was `untouched` with the manifest equal; `nonLoopbackAllowed` and `telegramAllowed` were 0. `net-allow` entries are the loopback refused connections from preflight, pause and resume.
- **The real machine-global lock folder was never created.** `<home>/AppData/Local/crypto-snipe-bot` does not exist after all runs. Every test used a temp folder or a temp fake home.
- **`src/main.ts` and `src/bot.ts` were never run as programs.** Only `runMain` with a fake `startBot`, the fixture entries, and source parsing were used.

## Known Stubs

None.

## Audit Notes for 22-15 and 22-29

- **AUD-TX-005 (RC-18):** this plan's rail is in place. The register entry remains `confirmed` S1 and was not edited; 22-29 re-audits it.
- **Linux is unproven here.** These proofs ran on Windows. The fcntl behaviour (RESEARCH A2) is proven only when the suite runs on CI's ubuntu.
- **Card SCRIPTS-01 stays open.** `scripts/preflight.ts`, `pause.ts` and `resume.ts` take no lock. The scripts-while-held proof records that fact and decides nothing. `tryAcquireThenRelease` exists and its header states it cannot guard signing.
- **Phase 26 (ESM):** `require.main` does not exist in ESM, so the guard must be rebuilt there. The module header says so.
- A second wallet on the same `data/bot.db` is not blocked, by the plan's assumption-delta decision; 22-21's deferred idea still covers it.

## User Setup Required

None. The command to start the bot, when the bot is next run, is `npm start` or `npx ts-node src/main.ts`.

## Next Phase Readiness

Ready for the next plan.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-09*

## Self-Check: PASSED

- FOUND: all 16 created code, test, proof and input files
- FOUND: 569f08c, 3786e2e, 961d269, a93fd98, 9f47d5b, 3467a4d, 4f0415f, 1f4e34c (ancestors of HEAD); `git rev-list --count 23964a3..HEAD` = 8
- Final run after the last commit: 6 files / 37 tests, wrapped, verdict untouched, manifest equal, ledger ok; both `tsc` runs clean; `git status --porcelain src test` empty; Task 3 `<automated>` check passes
