---
phase: 23-test-safety-net-harness-triage-characterization
plan: 24
subsystem: testing
tags: [vitest, realpath, ordering, boot, characterization, singleton, diagnostics_channel, ethers]

requires:
  - phase: 23-20
    provides: golden-master driver and the harness contracts the ordering tests run on
  - phase: 23-28
    provides: createScenario on eth/bsc/base/arb, emitLogs, filtered subscriptions
provides:
  - "test/realpath/ordering/boot.test.ts: a real in-process startMultiChainBot pinned (boot order, one subscription per DEX, listener counts, resume invocation and completion order, shutdown through the real SIGINT listener) plus armPositionMonitoring order per caller"
  - "test/realpath/ordering/sameBlock.test.ts: two PairCreated logs in one block, handled in log order (AC-31)"
  - "test/realpath/ordering/identity.test.ts: the real registerSingleton refuses a same-epoch copy and allows a whole-graph reset (AC-30 identity, Flag 5)"
  - "AUD-BUY-038 registered (S3, capital none, confirmed): the boot does not wait for the exit-monitor resume before the anti-rug resume"
affects: [phase-24-capital-fixes, phase-27-boot-restructure, phase-28-test-hygiene, restart-follow-up]

actuals:
  tokens: 20000
  tasks: 2
  commits: 4
plan_head_before: 8dce01758d3a8253f7442e603adf264c29a3369b
plan_head_after: 299ab6b25052e283bccb0efdcf02007e4f46676e

tech-stack:
  added: []
  patterns:
    - "Real port of a port-0 server read from Node's tracing:net.server.listen:asyncEnd diagnostics channel (observes, mocks nothing)"
    - "Invocation order from the logs list and node.callLog on the shared sequence counter; completion order as the state when the boot returns"
    - "A boot test ends through the boot's own SIGINT listener and pins how far the cleanup gets, failing loudly if a test-environment limit is lifted"
    - "Settle subscription traffic (no eth_subscribe/eth_unsubscribe for one virtual second) before a signal or teardown, also on a failed body"
    - "Same-epoch module copy through a literal ?query import (template literal, @ts-expect-error TS2307), allowed by the spawn-site gate"

key-files:
  created:
    - test/realpath/ordering/boot.test.ts
    - test/realpath/ordering/sameBlock.test.ts
    - test/realpath/ordering/identity.test.ts
    - .planning/audit/findings/AUD-BUY-038.json
  modified:
    - .planning/audit/ledger/BUY.json
    - .planning/audit/sweep/contrib-PHASE23.json
    - .planning/audit/AUDIT-FINDINGS.md
    - .planning/phases/23-test-safety-net-harness-triage-characterization/deferred-items.md

key-decisions:
  - "Operator decision 1A (2026-11-12, \"Pin how far it gets\"): each boot test ends through the real SIGINT listener and pins how far the real cleanup gets today (shutdown.cleanup, shutdown.api, server stopped and refusing connections, bot timers cleared, WebSocket providers destroyed, then the caught require('./utils/db') error, no shutdown.complete); the harness teardown closes the rest; it fails with 'TEST-ENVIRONMENT LIMIT LIFTED' if the limit is lifted. Recorded as a test-environment limit (deferred-items.md, owner Phase 28), not a bot bug"
  - "Operator decision 2A (2026-11-12, \"Pin today's order + log bug\"): today's resume order pinned with no held call; invocation from the logs list and node.callLog, completion as the state at boot return, tagged SUSPECT(AUD-BUY-038, AUD-TX-028); the new finding registered by this executor"
  - "AUD-BUY-038 graded S3, capital none, status confirmed (the first executor proposed S3 candidate): the mechanism is proven on the real path (the anti-rug resume's first allowlist read reaches the node before the exit monitor's balanceOf is sent) and a fix-shaped mutation reads 'AUD-BUY-038 looks fixed'; no capital effect is shown, because both sides finish and every sell goes through executeFullSell's sell lock and balance read"
  - "The same-block test uses two different tokens (A uniswap-v2, B sushiswap-v2) under the default limit, so AUD-BUY-004 (same token) and AUD-BUY-010 (limit race) cannot decide it; both log orders are run"
  - "The spawn-site rails gate was not touched: the identity test's two computed imports were replaced by literal specifiers"

patterns-established:
  - "In-process boot: deployContracts (checker and allowlist code) + DASHBOARD_API_KEY of 16+ characters + DASHBOARD_PORT 0 on 127.0.0.1"
  - "Name what a real cleanup never reaches and which harness teardown step closes it, beside the assertion"

requirements-completed: [CHAR-04]

coverage:
  - id: D1
    description: "Fresh in-process boot: every boot line in order, one PairCreated subscription per V2 DEX and one PoolCreated per V3 DEX, one added SIGINT and SIGTERM listener, DASHBOARD_PORT=0 on 127.0.0.1 with GET /health 200, shutdown through the real SIGINT listener pinned to how far it gets, listener counts back to start"
    requirement: CHAR-04
    verification:
      - kind: integration
        ref: "test/realpath/ordering/boot.test.ts#a fresh boot runs preflight, the chain context, the DEX listeners, the anti-rug start and the API server in that order, subscribes once per DEX, and ends through the real SIGINT handler"
        status: pass
    human_judgment: false
  - id: D2
    description: "Resume boot after a real snipe and restart: exit-monitor resume invoked first, anti-rug resume starts before the exit timer is re-armed (AUD-BUY-038), both armed when the boot returns; shutdown clears the exit timer"
    requirement: CHAR-04
    verification:
      - kind: integration
        ref: "test/realpath/ordering/boot.test.ts#a boot that resumes an open position calls the exit-monitor resume first but starts the anti-rug resume before any exit timer is re-armed (AUD-BUY-038); when the boot returns both are armed"
        status: pass
    human_judgment: false
  - id: D3
    description: "armPositionMonitoring order per caller on the real path: V2 snipe, V3 snipe, deliberate buy (trades, exit_state, exit monitor started, lp_baseline, register, subscription)"
    requirement: CHAR-04
    verification:
      - kind: integration
        ref: "test/realpath/ordering/boot.test.ts#arm ordering: armPositionMonitoring and its V3 twin, per caller, on the real path (3 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Nothing a booted bot started outlives its test (ten virtual minutes and real event-loop turns)"
    requirement: CHAR-04
    verification:
      - kind: integration
        ref: "test/realpath/ordering/boot.test.ts#after the boot tests, ten virtual minutes and real event-loop turns bring no log, alert, socket or signal listener from them"
        status: pass
    human_judgment: false
  - id: D5
    description: "Two PairCreated logs in one block handled in log order, both orders (AC-31)"
    requirement: CHAR-04
    verification:
      - kind: integration
        ref: "test/realpath/ordering/sameBlock.test.ts#the bot handles them in log order (2 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "registerSingleton: a same-epoch copy of each guarded module is refused with SINGLETON_DUPLICATE; a whole-graph reset is allowed and the guard stays armed"
    requirement: CHAR-04
    verification:
      - kind: integration
        ref: "test/realpath/ordering/identity.test.ts (5 tests)"
        status: pass
    human_judgment: false
  - id: D7
    description: "AUD-BUY-038 registered with real-path evidence and a proven 'looks fixed' signal"
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial|consolidation|triage (RESULT PASS x3)"
        status: pass
    human_judgment: false

duration: 43min (continuation; the first executor's run and the operator wait are not counted)
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 24: Boot, Resume, Arm and Same-Block Ordering Summary

**A real in-process startMultiChainBot on the fake chain now pins the boot order, one subscription per DEX, listener counts, the resume's invocation and completion order and how far the real SIGINT cleanup gets; two same-block PairCreated logs are handled in log order; the real singleton guard refuses a same-epoch copy and allows a graph reset; and the unawaited exit-monitor resume is registered as AUD-BUY-038 (S3).**

## Performance

- **Duration:** 43 min (this continuation, 2026-11-12T18:20Z to 19:03Z; the first executor's probe run and the operator's answer are not counted)
- **Tasks:** 2 of 2
- **Files:** 3 created test files, 1 new finding file, 4 modified planning/audit files

## Accomplishments

- **Boot (D-06, AC-30).** `boot.test.ts` calls the real `startMultiChainBot` in this process. A fresh boot logs, in order: Starting multi-chain bot, Chain registry built, the preflight's Flashbots check, Preflight summary, Preflight passed, the chain context's Flashbots check (startMultiChainBot step 3, right after createChainContext), three "Listening for ..." lines, Chain listeners started, Anti-rug allowlist verified at startup, antirug.listener.armed-no-positions, API server started, the two Telegram lines, Multi-chain bot fully started, then the listen callback's "Dashboard API server started". On the node: the checker read before "Preflight passed", the three DEX `eth_subscribe` calls after "Chain listeners started" (ethers sends them after the listener's synchronous lines) and before the four allowlist reads. Exactly one PairCreated subscription per V2 DEX and one PoolCreated per V3 DEX, nothing else; exactly one SIGINT and one SIGTERM listener added.
- **Open Question 3.** DASHBOARD_PORT=0 binds a random free port on 127.0.0.1; the bot's own line says `port: 0`, so the test reads the bound server from Node's `tracing:net.server.listen:asyncEnd` diagnostics channel (asyncStart confirms the request `{ port: 0, host: '127.0.0.1' }`). A real GET /health answers 200 from 127.0.0.1. Recorded in the test header.
- **Shutdown (operator 1A).** The boot's own SIGINT listener runs, synchronously: "Graceful shutdown begun" (graceMs 8000), shutdown.cleanup, shutdown.api, "Dashboard API server stopped", then the caught error "Cannot find module './utils/db'". The server stops listening and a new connect gets ECONNREFUSED; the exit timer of a resumed position is cleared; the WebSocket provider is destroyed. Still open afterwards and closed by the harness teardown (each named in the test): the database, the HTTP provider (the scenario context holds the same cached provider), the two untracked 5-minute intervals, the armed 8 s force-exit timer, and the reconnect loops (three DEX loops and the anti-rug one, which start on the destroyed sockets' close events because process.exit is only the spy, and park on their first fake delay timer). A last test steps ten virtual minutes and real event-loop turns and sees no log, alert, socket or signal listener from the booted bots.
- **Resume order (operator 2A).** After a real V2 snipe and a restart on the same file, the boot logs "Resuming exit monitor for pending token" after "Chain listeners started" and before the anti-rug resume's first allowlist read (invocation order). The anti-rug resume's first `eth_getCode` reaches the node before the exit monitor's `balanceOf` is even sent and before `exit.monitor.resumed` (AUD-BUY-038). Completion: `exit.monitor.resumed` before "Anti-rug allowlist verified at startup", `antirug.register` after it and before "API server started"; when startMultiChainBot returns the exit timer is armed and the anti-rug subscription covers the pair (SUSPECT(AUD-ANTIRUG-025): it is dropped right after, so it is read only there).
- **Arm order per caller.** A V2 snipe, a V3 snipe (its own inline wiring) and an in-process deliberate buy (base V2) each record trades insert, exit_state insert, exit.monitor.started, lp_baseline insert, antirug.lp-baseline.snapshot, antirug.register, antirug.listener.subscribed, then exactly one `eth_subscribe` for the pair after that log line.
- **Same block (AC-31).** Token A (uniswap-v2) and token B (sushiswap-v2) launched by the deployers' real signed transactions in one mined block, both PairCreated logs delivered by `node.emitLogs` in a defined order; both orders run. The bot follows log order: "New pair detected", "All safety checks passed, buying", the buy at the wallet's next nonce, the trades insert and exit.monitor.started are first for the first-seen token. Neither the already-sniped check nor the risk gate skips either token. No SUSPECT on the order: first-seen first is correct.
- **Identity (AC-30, Flag 5).** For each of nonceAuthority, exitManager, exitEngine and the anti-rug detector, a `?query` copy in the scenario graph's epoch is refused with SINGLETON_DUPLICATE (same raw identity, canonical real path); restartGraph (a new epoch) loads all four again, the restarted graph works, and a copy in the new epoch is refused too.

## Task Commits

1. **Task 1: boot, resume and arm order; register AUD-BUY-038** - `bf3f1ab` (test)
2. **Task 2: same-block ordering and singleton identity** - `a36eadb` (test)
3. **Spawn-site gate fix for the identity test** - `d8a02e0` (fix)
4. **Explicit limit on the identity tests** - `299ab6b` (test)

## Files Created/Modified

- `test/realpath/ordering/boot.test.ts` - in-process boot, resume, shutdown, arm order per caller, leak check
- `test/realpath/ordering/sameBlock.test.ts` - two PairCreated logs in one block, both orders
- `test/realpath/ordering/identity.test.ts` - the real duplicate-load guard in a scenario graph
- `.planning/audit/findings/AUD-BUY-038.json` - the new finding
- `.planning/audit/ledger/BUY.json`, `.planning/audit/sweep/contrib-PHASE23.json`, `.planning/audit/AUDIT-FINDINGS.md` - ledger row, sweep contribution, re-render (OPERATOR-DECISIONS.md unchanged)
- `.planning/phases/23-test-safety-net-harness-triage-characterization/deferred-items.md` - the shutdown require limit (owner Phase 28)

## Decisions Made

- **1A and 2A** as answered by the operator (frontmatter key-decisions).
- **What decides each observation is tagged where it decides it:** SUSPECT(AUD-BUY-038, AUD-TX-028) on the resume completion order, SUSPECT(AUD-ANTIRUG-025) on reading the subscription at boot return, SUSPECT(AUD-EXIT-019) on the watchdog line (installed after the API server and Telegram; pinned on its own so its fix fails with a message naming it), SUSPECT(AUD-ANTIRUG-024) on the fresh database's one error line (left out of the strict sequence and allowed only as that op). Another finding's detail is not asserted here.
- **Named failure signals, each proven by a fix-shaped src mutation and then restored byte for byte (`git hash-object` equal to the HEAD blob, `git status --porcelain src` empty):** resumeMultiChainMonitoring made async and awaited reads "AUD-BUY-038 looks fixed" alone; a cleanup that survives the require reads "TEST-ENVIRONMENT LIMIT LIFTED" in both boot tests; installing the watchdog before the resume fails the AUD-EXIT-019 pin with its message; a guard that lets a same-epoch copy through fails all five identity tests, and one that refuses a reset fails every graph after the worker's first, including the reset test.
- **A failed boot body settles subscription traffic before teardown**, so a real fix fails with its one message and not with a teardown race (measured: without it, the AUD-ANTIRUG-025 `eth_unsubscribe` in flight was cancelled into an unhandled rejection).

## Register Changes (operator standing instruction, no stop)

Registered by this executor under the operator's standing instruction (2026-11-11, verbatim: "All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading"):

| Entry | Grade | What | Evidence | Commit |
|---|---|---|---|---|
| AUD-BUY-038 (new, confirmed) | S3, capital none, C12 | startMultiChainBot calls resumeMultiChainMonitoring without await (bot.ts:1797 at 23a6461); that function is synchronous and starts each balanceOf(...).then(resumeExitMonitor) without returning it (:1892-1960), so the anti-rug resume starts before any exit timer is re-armed, although the comments (:1799-1804, :1985-1987) say exit timers come first. Today's completion order holds only because the exit side needs one round trip and the allowlist check four (each with the provider's eth_chainId, AUD-TX-028); with a held balanceOf the boot never returns (AUD-TX-028), and once AUD-TX-028 is fixed a slow balanceOf lets anti-rug verify, register and subscribe first. No capital effect shown (every sell goes through executeFullSell's sell lock and balance read). Related: AUD-EXIT-019, AUD-TX-028, AUD-ANTIRUG-025. | boot.test.ts resume test (C129 getCode, C131 balanceOf, L132 exit.monitor.resumed, L140 allowlist verified); "AUD-BUY-038 looks fixed" proven by mutation | bf3f1ab |

No severity of an existing entry changed. check.ts partial, consolidation and triage PASS before and after (no re_audit row needed: the three test files have no ledger row yet).

## For the restart follow-up

Re-confirmed by my own throwaway probe on the booted server (Node 22.16.0, never committed, deleted after the run): the real login `POST /api/auth/login` answered 200 with a session cookie; `POST /api/chains/eth/stop` answered 200 `{"ok":true,"chain":"eth","status":"stopped"}` and the node's DEX subscriptions went 3 to 0; `POST /api/chains/eth/start` answered 200 `{"ok":true,"chain":"eth","status":"running","warnings":[]}` and restored 3 through the real onRestart ("DEX listener restarted" three times); about 250 ms including the probe's own extra steps; every connection 127.0.0.1; that run's ledger nonLoopbackAllowed 0, telegramAllowed 0. (The first executor's note shortened the bodies to `{"status":...}`; the full bodies are above.) So the AUD-API-002 fixture's mirrored onRestart (`test/realpath/triage/fixtures/AUD-API-002-restart.ts`, on the source-text gate's allow list) can be replaced by this real path: boot in process as boot.test.ts does, then drive Stop and Start over loopback. Not converted here, as instructed.

## Deviations from Plan

### Superseded by the operator's answers (not auto-fixes)

**1. Task 1 acceptance "asserts `shutdown.complete`" became 1A.** The real cleanup cannot reach shutdown.complete under the test runner; the test pins how far it gets, fails loudly if the limit is lifted, and names what the harness teardown closes. Listener counts return to their start values as planned.

**2. Task 1 acceptance "with the balanceOf read held" became 2A.** A held balanceOf never lets the boot return (AUD-TX-028); 2B was declined. Invocation and completion order are pinned without a hold, and the mismatch is registered as AUD-BUY-038.

### Auto-fixed Issues

**3. [Rule 3 - Blocking] The spawn-site rails gate refused two computed imports in identity.test.ts**
- **Found during:** the first full railed run (1557/1558: `test/unit/rails/spawnSites.test.ts` "no script under test/ loads a spawner or spawns" listed identity.test.ts:60 and :90, "dynamic import() with a non-literal specifier").
- **Fix:** the gate is unchanged; each guarded module got literal thunks (its import and a `?realpath-second-copy` template literal with no substitution, `@ts-expect-error` TS2307). Re-proved by the guard mutation.
- **Files modified:** test/realpath/ordering/identity.test.ts
- **Verification:** spawnSites and sourceTextGate green; the second full run 1558/1558.
- **Committed in:** d8a02e0

**4. [Rule 2 - Missing critical] Explicit limits on the identity tests**
- **Found during:** the full-run timing check: the file's first test (cold graph import in the body) took 0.98 s and 5.19 s in the two full runs, 1.1 s alone (35 percent of 15 s; cold imports slow 6 to 9x at the peak, deferred-items.md).
- **Fix:** 60 s per identity test with the measured times in a comment.
- **Committed in:** 299ab6b

**5. [Plan addition] The deliberate-buy arm test runs on base V2**, not eth: the deliberate path does not run the V2 lock check AUD-BUY-016 breaks on base, and the public route lands under autoMine (the AUD-BUY-001 control's setup).

---

**Total deviations:** 2 superseded by operator decisions, 2 auto-fixed (1 blocking, 1 missing critical), 1 setup choice. **Impact:** no scope change; the rails gates and src/ are untouched.

## Issues Encountered

- **An unhandled `eth_unsubscribe` cancellation** in an early run, attributed by Vitest to the next test: the resume test had failed (my own wrong assertion: the resume log carries the lower-case token) before its settle step, so the teardown destroyed the provider under AUD-ANTIRUG-025's in-flight re-subscribe. Fixed by the assertion and by settling on any failed boot body; every later run has 0 unhandled errors.
- **My first pin of the DEX subscriptions was wrong, not the bot:** they reach the node after "Chain listeners started", because ethers sends each `eth_subscribe` after the listener's synchronous log lines.
- **No harness gap:** everything used public harness calls and existing fixtures (AUD-EXIT-002-position, AUD-TX-002-lock, AUD-TX-003-second-launch, AUD-API-001-dashboard-sell). `test/realpath/harness/` and the rails are unchanged.

## Gates

- **Full railed suite, Node 22.16.0, foreground command** (Claude Code moved it to the background after 180 s; it ran to its end and was read from its own output files): tree d8a02e0, 209 files, **1558/1558** (unit 950, integration 264, realpath 344), 0 failed, 0 skipped, 0 todo, **0 unhandled errors**, wall **196 s**; ledger run-20261112T185557-18792-3ea4cb **nonLoopbackAllowed 0, telegramAllowed 0**. The first full run (tree a36eadb) was 1557/1558 at 204 s, the spawn-site failure above. The final commit 299ab6b only adds test limits; the three ordering files were re-run on it (13/13, three times).
- **Timing under the full run:** boot tests 1.10 to 1.36 s of 60 s, arm tests 0.33 to 0.63 s of 60 s, same-block 0.82 to 2.19 s of 60 s, identity first test 5.19 s (now of 60 s), the leak test 8 ms of 15 s. backupState self-check 64.8 s (run 1) and 58.5 s (run 2) of 120 s, within 23-21..23-23's range; these files do not move it.
- **Repeatability (AC-10):** the three ordering files run six times with the JSON reporter, 13 tests each, identical digest e1f85dc3, 0 unhandled.
- tsc --noEmit clean on tsconfig.json, tsconfig.bot.json, dashboard/tsconfig.json; a scratch tsconfig (module es2022) over all of test/realpath/** clean.
- check:realpath-mocks 0 violations (41 vi uses, 104 files); check:vi-mock 660 calls 0 violations; check:census 23 sites 0 problems; red-proof-conversions --check-manifest MANIFEST-OK rows 36 files 11 guards 1; sourceTextGate and spawnSites green.
- check.ts --stage partial, consolidation, triage: RESULT PASS fail 0.
- `git status --porcelain src` empty after every mutation and at the end.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 24: AUD-BUY-038 sits beside AUD-TX-028 and AUD-EXIT-019; fixing them changes boot.test.ts by design (named messages).
- Phase 27: the boot restructure is now under real-path ordering tests (boot, resume, arm, same block, singleton).
- Phase 28: the shutdown require limit (deferred-items.md).
- The restart follow-up can replace the AUD-API-002 mirror with the real in-process path (section above).

## Self-Check: PASSED

- FOUND: test/realpath/ordering/boot.test.ts, sameBlock.test.ts, identity.test.ts, .planning/audit/findings/AUD-BUY-038.json
- FOUND: commits bf3f1ab, a36eadb, d8a02e0, 299ab6b (ancestors of HEAD); 4 commits measured from the plan ledger (8dce017..299ab6b)
- AUD-BUY-038 present in the BUY ledger, the PHASE23 sweep contribution and AUDIT-FINDINGS.md; the deferred-items entry present

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*
