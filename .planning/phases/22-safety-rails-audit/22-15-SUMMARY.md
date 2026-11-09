---
phase: 22-safety-rails-audit
plan: 15
subsystem: testing
tags: [safe-02, safe-03, ac-12, ac-18, ac-19, ac-22, full-suite, test-identity, net-watch, evidence, fork-move]

requires:
  - phase: 22-safety-rails-audit (22-08)
    provides: scripts/verify-prod-untouched.ts, spawnRailedChild, the fork rehearsal pattern
  - phase: 22-safety-rails-audit (22-11)
    provides: test/fork/helpers/forkRpcUrl.ts, the spawn gate, forkShellOnly
  - phase: 22-safety-rails-audit (22-12)
    provides: reset-files-base.json (the frozen 37 files)
  - phase: 22-safety-rails-audit (22-14)
    provides: the vi.mock specifier gate
provides:
  - the first complete railed run of npm test, green, with wrapper-written evidence (.planning/baselines/ac19-run.json)
  - .planning/audit/tools/test-identity.ts and .planning/audit/inputs/test-identity.json
  - .planning/audit/inputs/full-suite-ledger-summary.json
  - scripts/verify-prod-untouched.ts --net-watch, --report, --evidence-out
  - test/integration/backupState.test.ts (D-11 regression)
  - test/fork/honeypotDeploy.eth.fork.test.ts (moved by operator ruling, not yet run)
  - .planning/audit/escalations/ESC-RAILS-01.json
  - UFV-05 in .planning/audit/inputs/unrun-fork-verifications.json (owner Phase 25)
  - .planning/phases/22-safety-rails-audit/red-proofs/INDEX.md (all 28 named proofs)
affects: [22-16, 22-29, phase-25, phase-28]

actuals:
  tokens: 23190
  tasks: 2
  commits: 8
plan_head_before: 4533df8f12c437b9adc375784e5c02e0eca9acd1
plan_head_after: a3cde237d6896776b366c172c503286266cd28a0

tech-stack:
  added: []
  patterns:
    - "A base test title may leave its file only as `moved`: a recorded entry naming old file, new file and title, the title present at HEAD in the new file, and an escalation record holding a real operator reply"
    - "Wrapper-written evidence: --evidence-out needs every gate on and binds the run id, ledger and test report by SHA-256, so it can never be partial or hand-copied"

key-files:
  created:
    - .planning/audit/tools/test-identity.ts
    - .planning/audit/inputs/test-identity.json
    - .planning/audit/inputs/full-suite-ledger-summary.json
    - .planning/audit/escalations/ESC-RAILS-01.json
    - .planning/baselines/ac19-run.json
    - .planning/phases/22-safety-rails-audit/red-proofs/INDEX.md
    - test/fork/honeypotDeploy.eth.fork.test.ts
    - test/integration/backupState.test.ts
  modified:
    - scripts/verify-prod-untouched.ts
    - test/integration/honeypotDeploy.eth.test.ts
    - test/integration/preflightCli.test.ts
    - test/unit/bot/noDoubleBuyReconcile.test.ts
    - .planning/audit/inputs/rails-test-edits.json
    - .planning/audit/inputs/rails-discoveries.json
    - .planning/audit/inputs/unrun-fork-verifications.json

key-decisions:
  - "22-15 ESC-RAILS-01: operator replied b, meaning the one live-mainnet bytecode test moves to the fork project inside this plan, with a tracked Phase 25 obligation (UFV-05). Options presented: (a) keep it failing and escalate, (b) move it, (c) stop Phase 22"
  - "22-15: the moved test has NOT run in its new file. AC-22 is met for the unit and integration suites with that one exception stated, never as 'every original test executed'"
  - "22-15: the moved test resolves its address through buildChainRegistry(), which applies the same precedence as the old file (env override, then template default), because forkShellOnly forbids a fork test reading a key the rails replace"
  - "22-15: the moved test reads the RPC from the shell-only resolver, so a real run reads mainnet through the archive URL the fork is built from, not through the local Hardhat node"

patterns-established:
  - "Rehearse an unrunnable fork test against a loopback fake in pass and fail modes, and say plainly that this proves the wiring only"

requirements-completed: [SAFE-02, SAFE-03]

coverage:
  - id: D1
    description: "Full railed npm test is green and leaves production state untouched (AC-12, AC-19)"
    requirement: SAFE-02
    verification:
      - kind: other
        ref: "verify-prod-untouched.ts --manifest --require-ledger --expect-projects unit,integration --net-watch --report --evidence-out .planning/baselines/ac19-run.json -- npm test, run vpu-20261109T045355-20916-8a9783 (1194 passed, 0 failed, 0 skipped, 0 todo, verdict untouched)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The original unit and integration tests are all present and passed, apart from the one test moved by operator ruling; the 37 frozen reset files passed (AC-22)"
    requirement: SAFE-03
    verification:
      - kind: other
        ref: ".planning/audit/inputs/test-identity.json (missing 0, missing_file 0, not_executed 0, dynamic_mismatch 0, renamed 1, moved 1, frozen_reset_not_passed 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "test-identity reports a move as moved only through a recorded, operator-ruled entry; an unrecorded move reports missing"
    requirement: SAFE-03
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/test-identity.ts --self-test (16/16)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Wrapper evidence: report binding, evidence output and net-watch"
    requirement: SAFE-02
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js scripts/verify-prod-untouched.ts --self-test (44/44)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Backup self-check regression test (D-11)"
    requirement: SAFE-02
    verification:
      - kind: integration
        ref: "test/integration/backupState.test.ts#exits 0 and every fixture case passes (46.7 s in the full run)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AC-18 index: all 28 named RED proofs, in both directions"
    requirement: SAFE-02
    verification:
      - kind: other
        ref: "plan Task 2 second automated verify over red-proofs/INDEX.md (bad=0)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The moved fork test proves the real contract has code"
    requirement: SAFE-03
    verification: []
    human_judgment: true
    rationale: "The real run needs Hardhat and an RPC, which Phase 22 does not run (AC-08). The loopback rehearsal proves wiring only. Owner Phase 25, obligation UFV-05"

duration: 18min (continuation; the first executor's earlier session is not included)
completed: 2026-11-09
status: complete
---

# Phase 22 Plan 15: Full Railed Suite, Test Identity and AC-19 Evidence Summary

**`npm test` now runs complete and green under every rail: 1194 passed, 0 failed, 0 skipped, 0 todo. The wrapper itself proved the live database did not change and no non-loopback connection was allowed or seen. One test, the live mainnet bytecode check for the HoneypotChecker contract, was moved to the fork project by the operator's ruling (reply: `b`) and has not run in its new file. Phase 25 owns that first run as UFV-05.**

## Performance

- **Duration:** 18 min for this continuation
- **Started:** 2026-11-09T04:40:20Z
- **Completed:** 2026-11-09T04:58Z
- **Tasks:** 2/2
- **Files:** 15 changed (8 created, 7 modified)

## Accomplishments

- **AC-12:** the run's ledger lists exactly the `unit` and `integration` projects.
- **AC-19:** run `vpu-20261109T045355-20916-8a9783`. `ac19-run.json` was written by the wrapper. The hashes and mtimes of `bot.db`, `bot.db-wal` and `bot.db-shm` are the same before and after and equal the backup manifest, the `data/` listing is unchanged, `nonLoopbackAllowed` is 0, `telegramAllowed` is 0, the notifier refused 6 sends, and net-watch took 99 samples and saw 0 non-loopback connections. The report and ledger are bound by SHA-256, and I confirmed both hashes match the files.
- **AC-22:** every unit and integration test title from the audit base that is still in its own file ran and passed (`not_executed` 0, `missing` 0, 1 recorded rename). All 37 frozen reset files passed, and the Phase 22 additions are listed separately. **One test did not run: "has bytecode at deployedAddress (not 0x)" was moved by operator ruling ESC-RAILS-01 and has not run in its new home.** Fork files were compared by title only, by design.
- **AC-18:** `INDEX.md` lists all 28 named proofs, each existing, and every proof file is indexed.
- **D-11:** `backupState.test.ts` passes inside the full run.

## The ruled move

The test was the only red in the first full run. It asks a real RPC whether the contract has code, and the rails correctly keep the integration project off the real RPC. The operator was offered (a) keep it failing and register an escalated finding, (b) move this one test to the fork project inside this plan with a Phase 25 obligation, or (c) stop Phase 22, and replied `b`.

- Both assertions are word for word, and the `describe` and `it` titles are unchanged.
- The second test, "resolved address matches Ignition deployment artifact (T-18-25)", stays in the integration file with its guard unchanged, and it ran and passed. Only the `JsonRpcProvider` import and the provider creation were removed from that file, because nothing left there used them.
- Per-file `it()` counts: integration 2 to 1, fork 0 to 1, total 2 to 2.

**What is and is not proven about the moved test:**

| Check | Result |
|---|---|
| Type-checks (explicit `tsc` on this file; test files are outside every tsconfig) | Passed |
| `spawnSites`, `forkShellOnly`, `check:vi-mock` | Passed |
| Loopback fake returning 402 characters of bytecode | Passed; the fake logged `eth_getCode` for `0x8243dbea…13ed` on the resolver's URL |
| Loopback fake returning `0x` | Failed on `expect(code).not.toBe('0x')`, as it should |
| Loopback fake returning `0x6080` | Failed on the length assertion, as it should |
| `ETH_FORK_RPC_URL` unset | Failed with the resolver's error naming the variable |
| **The real contract has code on mainnet** | **Not proven here.** The rehearsal's bytecode came from the fake |

Meanwhile, `npm run preflight` (`checkHoneypotCheckerCode`) performs the same live check, but only when the operator runs it.

## Task Commits

1. **Task 2 (part, built first by orchestrator direction): `--net-watch`** - `94fdfac` (feat)
2. **Task 1 (interim): preflight time limit, test-identity tool, discovery recorded** - `fec8ee8` (test)
3. **Task 1: the ruled move, ESC-RAILS-01** - `d66d8d0` (test)
4. **Task 1: `moved` rule, UFV-05, discovery resolution** - `dacc6d3` (feat)
5. **Task 2: backup test, `--report`, `--evidence-out`** - `d3555d9` (feat)
6. **Task 2: RED index** - `4e9051b` (docs)
7. **Task 1: no-double-buy time limit** - `36d5671` (test)
8. **Final run evidence** - `a3cde23` (docs)

**Plan metadata:** the docs commit that follows this SUMMARY.

## Files Created/Modified

- `scripts/verify-prod-untouched.ts`: `--net-watch`, `--report`, `--evidence-out`; self-test 44/44.
- `.planning/audit/tools/test-identity.ts`: title comparison at base and HEAD, with the `moved` rule; self-test 16/16.
- `test/fork/honeypotDeploy.eth.fork.test.ts`, `test/integration/honeypotDeploy.eth.test.ts`: the ruled move.
- `test/integration/backupState.test.ts`: D-11 regression.
- `test/integration/preflightCli.test.ts`, `test/unit/bot/noDoubleBuyReconcile.test.ts`: time limits only, recorded in `rails-test-edits.json`.
- `.planning/audit/escalations/ESC-RAILS-01.json`, `.planning/audit/inputs/{rails-test-edits,rails-discoveries,unrun-fork-verifications,test-identity,full-suite-ledger-summary}.json`, `.planning/baselines/ac19-run.json`, `red-proofs/INDEX.md`.

## Decisions Made

See `key-decisions`. No file under `src/` changed.

## Deviations from Plan

### Operator ruling

**1. One test moved instead of staying in its file.** The plan's identity rule required every base title to stay in its file, and its "equal counts" rule was per file. By ruling ESC-RAILS-01 the equal-count rule holds on the total for this one move, and the identity tool reports it as `moved`.

### Auto-fixed Issues

**2. [Rule 3 - Blocking] The address comes from `buildChainRegistry()`**
- **Found during:** the move.
- **Issue:** the instructions keep the precedence env override then template, and also require `forkShellOnly` to pass. That gate forbids a fork test reading `ETH_HONEYPOT_CHECKER_ADDRESS` directly, because the fork rails replace it.
- **Fix:** the production function applies exactly that precedence (`src/chainRegistry.ts:694`), so the env read stays in `src/`. Routing the read through a helper parameter would have dodged the gate, so I did not do that. In a fork worker the key is an empty sentinel, so the template default resolves. The rehearsal confirmed `0x8243dbea…13ed`.
- **Committed in:** `d66d8d0`

**3. [Rule 3 - Blocking] `noDoubleBuyReconcile.test.ts` timed out in the first final run**
- **Found during:** the final run (`vpu-20261109T045056-10640-6a8b4a`, verdict untouched, wrapper exit 1).
- **Issue:** the first test pays for the first `import('src/bot')`: 4648 ms in the earlier full run, 5015 ms in this one, against the 5000 ms unit limit. No assertion failed. The new `backupState` test adds a 46-48 s compile to the parallel load, which tipped it over.
- **Fix:** `describe()` gained `{ timeout: 30_000 }`. Assertions, titles and mocks are untouched. Recorded in `rails-test-edits.json`.
- **Verification:** the next full run passed, 1194/1194.
- **Committed in:** `36d5671`

**4. [Rule 2 - Hardening] Wrapper checks wider than the plan's list.** `--evidence-out` refuses to run unless `--report`, `--manifest`, `--require-ledger` and `--net-watch` are all on. A report older than the run, a report with no totals, or a report showing failures for a command that exited 0 fails the run. Committed in `d3555d9`.

**5. [Small] `backupState.test.ts` asserts cases (a) to (l).** The plan named (a) to (j); the self-check has grown two more cases since it was written.

---

**Total deviations:** 1 operator ruling, 2 blocking fixes, 1 hardening, 1 small.
**Impact on plan:** no test was deleted, skipped or todo'd, and no assertion changed. The one lasting gap is the unrun moved test, which is recorded as UFV-05.

## Issues Encountered

- **Net-watch is weak on short connections, measured.** The earlier full run saw 0 loopback connections while the ledger recorded 90 allowed loopback connects; the final run saw 2. Its self-test proves the sampler sees a connection that stays open, so this is sampling, not blindness. It is the limit `evidence_basis` states: net-watch is a backstop for connections that stay open, and the choke-point ledger is the main evidence.
- **Rail ledger list includes the rail tests themselves.** 7 of the 16 files in `triggeringTestFiles` are `test/*/rails/` tests whose denials are deliberate, so they are not test-quality findings. The other 9 are (`test/integration/api/{auth,chains,controls,health,positions,risk,trades}.test.ts`, `test/integration/pauseFlow.test.ts`, `test/unit/api/antiRug.test.ts`).

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: outbound-rpc | test/fork/honeypotDeploy.eth.fork.test.ts | Under the operator-run fork project only, a read-only `eth_getCode` goes straight to the `ETH_FORK_RPC_URL` the operator sets in the shell. It sends no key and signs nothing. The fork project is deliberately exempt from the network deny (SPEC R4). |

## User Setup Required

None.

## Notes for Later Plans

- **22-29:** registers ESC-RAILS-01's discovery as a test-quality finding (`check.ts --stage partial` shows its alias as the one PENDING item, as expected). Its Task 1 verify names only UFV-01..UFV-04, so it needs UFV-05 added, or UFV-05 will be missed by that check. `test/fork/honeypotDeploy.eth.fork.test.ts` is a new tracked file for the ledger.
- **22-16 / NAC-04:** integration lost one test to the move but is at 262 now; unit is at 932.
- **Phase 25:** the first real `npm run test:fork` must check UFV-05 by name.
- **Phase 28:** other tests running close to their default limit in these runs: `test/unit/bot/buyNonceLock.test.ts` (up to 4723 ms) and `test/unit/mainEntry.test.ts` (up to 4092 ms). I did not change them because they did not fail.

## Next Phase Readiness

Ready for 22-16. Plan 22-15's own criteria hold, with the moved test's real run owned by Phase 25.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-09*

## Self-Check: PASSED

- FOUND: every created file listed in key-files
- FOUND: 94fdfac, fec8ee8, d66d8d0, dacc6d3, d3555d9, 4e9051b, 36d5671, a3cde23 (all ancestors of HEAD); `git rev-list --count 4533df8..HEAD` = 8 at SUMMARY time
- Gates re-run at the end: `check:vi-mock` 0 violations; `spawnSites` and `forkShellOnly` passed inside the full run; `check.ts --stage partial` RESULT PASS with 1 expected PENDING; no Hardhat process
