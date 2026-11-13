---
phase: 23-test-safety-net-harness-triage-characterization
plan: 06
subsystem: testing
tags: [vitest, ethers, realpath-harness, triage, knownBug, audit-register, child-process, telegram, dashboard-api, anti-rug]

requires:
  - phase: 23-01
    provides: FakeNode reads/faults, createScenario, the fixed clock
  - phase: 23-28
    provides: createScenario for eth/bsc/base/arb and V2/V3, mine({ include, logs }), routes (bundle, bloxroute, public)
  - phase: 23-02
    provides: knownBug marker, recordedAlerts/recordedLogs, timeline, the AC-02 mock-list gate
  - phase: 23-27
    provides: createTempDbFile, restartGraph, serveLoopback, runRailedChildToEnd, autoMine, deliverTelegramMessage
  - phase: 23-04
    provides: set-triage.ts, check.ts triage rules
provides:
  - "Seven real-path triage files (AUD-BUY-001, -006, -009, -011, -027, -028 and the new AUD-ANTIRUG-025), 16 tests, 12 knownBug claims, each claim shown to give the D-08 looks-fixed message under a fix-shaped src mutation"
  - "AUD-BUY-001 (the only S0) proven with two real OS processes sharing one temp SQLite file: the real scripts/deliberate-buy.ts run to its own exit as a railed child"
  - "AUD-ANTIRUG-025 registered (new, S1, STRAND): every boot that resumes a position drops the anti-rug WebSocket subscription"
  - "test/realpath/triage/fixtures/AUD-BUY-011-dashboard.ts: the real API server on loopback with the real login flow, waited on with fake and real time interleaved"
affects: [23-16, phase-24, phase-29]

actuals:
  tokens: 28401    # chars/4 over the added lines of bc58f73..7f271d7 (19 files, 113607 chars, incl. the AUDIT-FINDINGS.md render)
  tasks: 3
  commits: 4       # MEASURED: git rev-list --count bc58f73..HEAD before this SUMMARY commit
plan_head_before: bc58f73c136112f0c52ecb887879bccd33bd5b0b
plan_head_after: 7f271d759b19c6e464c956b3ddc6ff3e0e88550c
commits: 4

tech-stack:
  added: []
  patterns:
    - "Two-process proof: the test process is the running bot on a temp-file DB; the operator script is a railed child on serveLoopback with autoMine; the child's own output is its arming acknowledgement and plain expects gate it before any marker"
    - "Real server, real auth: a fixture beside the test starts the real startApiServer on a free loopback port and drives it with node:http, alternating one fake 10 ms step with one real event-loop turn (the real setImmediate captured at load) while a request is in flight"
    - "A per-test answer change by re-wrapping the scenario's own route handler (its answer, amount divided by 100), never a new mock and never a harness file edit"
    - "Bounded decision window under the fixed clock (step until the bug outcome or N virtual seconds), so a fix reads looks fixed instead of a timeout"

key-files:
  created:
    - test/realpath/triage/AUD-BUY-001.test.ts
    - test/realpath/triage/AUD-BUY-006.test.ts
    - test/realpath/triage/AUD-BUY-009.test.ts
    - test/realpath/triage/AUD-BUY-011.test.ts
    - test/realpath/triage/AUD-BUY-027.test.ts
    - test/realpath/triage/AUD-BUY-028.test.ts
    - test/realpath/triage/AUD-ANTIRUG-025.test.ts
    - test/realpath/triage/fixtures/AUD-BUY-011-dashboard.ts
    - .planning/audit/findings/AUD-ANTIRUG-025.json
    - .planning/audit/escalations/ESC-ANTIRUG-04.json
  modified:
    - .planning/audit/findings/AUD-BUY-001.json
    - .planning/audit/findings/AUD-BUY-006.json
    - .planning/audit/findings/AUD-BUY-009.json
    - .planning/audit/findings/AUD-BUY-011.json
    - .planning/audit/findings/AUD-BUY-027.json
    - .planning/audit/findings/AUD-BUY-028.json
    - .planning/audit/sweep/contrib-PHASE23.json
    - .planning/audit/ledger/ANTIRUG.json
    - .planning/audit/AUDIT-FINDINGS.md

key-decisions:
  - "All six plan findings recorded confirmed; the S0 AUD-BUY-001 reproduced, so nothing went to the operator at once (the plan's stop condition was non-reproduction)"
  - "AUD-ANTIRUG-025 registered S1 STRAND by the executor under the standing instruction (no stop), with ESC-ANTIRUG-04 holding no operator words; its per-item acknowledgement is owed in the 23-16 batch report"
  - "AUD-ANTIRUG-025 weakens the interim operator rule on AUD-BUY-001 (ESC-BUY-01: restart the main bot right after a deliberate buy): that restart re-arms the exit monitor but not the anti-rug subscription"
  - "AUD-BUY-001's normal-snipe control runs on base V3 (base V2 snipes are skipped by AUD-BUY-016); a second control runs the same deliberate buy inside the running bot"
  - "AUD-BUY-011 uses the real startApiServer with the real login, not the route mounted alone, and adds the Telegram-to-stopped-chain claim; start adding a second poller stays code-read"

patterns-established:
  - "Scratch fix-signal runner (scratchpad mutate.cjs + mutations.cjs): one mutation, Node 22.16.0 by absolute path, original bytes written back, git hash-object checked against the HEAD blob"

requirements-completed: [AUDIT-02]

coverage:
  - id: D1
    description: "AUD-BUY-001 (S0): the real scripts/deliberate-buy.ts lands a buy and arms both protections in its own process, exits 0, and the running bot on the same database has neither after ten exit-poll intervals; only a restart re-arms it; controls show both registries can read true"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-001.test.ts (3 tests, claims monitor-dies-with-script and anti-rug-dies-with-script; exit-only and anti-rug-only re-scan mutations each give looks fixed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUD-BUY-006: with both allowlists empty, and with only the sender list set, a stranger's Telegram message routes into the buy pipeline and a buy is sent; both lists set rejects it"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-006.test.ts (3 tests; fail-closed and AND-semantics mutations)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUD-BUY-009: V2 and V3 New-Token alerts print a bare Honeypot No from a constant while the on-chain roundtrip ran"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-009.test.ts (2 tests; report-check and V2-removed mutations)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUD-BUY-011: after the real dashboard stop route the HTTP poller still buys, and a Telegram alpha drop still routes to the stopped chain and buys"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-011.test.ts (2 tests; stoppedChains-check mutation)"
        status: pass
    human_judgment: false
  - id: D5
    description: "AUD-BUY-027 (A/B pair processed, B reserve read as ETH, bought through WETH) and AUD-BUY-028 (a 1 percent lock passes on Unicrypt and Mudra)"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-027.test.ts and AUD-BUY-028.test.ts (3 tests; drop-non-native and half-supply mutations; harness.test.ts 34/34 under the half-supply fixes)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AUD-ANTIRUG-025 (new S1): after restart and resume, no subscription covers the pair and an LP transfer on it is never evaluated"
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-ANTIRUG-025.test.ts (1 test; await-off and skip-unchanged mutations; unmutated control passes)"
        status: pass
    human_judgment: false
  - id: D7
    description: "AC-48: no test passes on fake answers a real node or API could never return (the A/B pair reserves and burned LP, the 1 percent lock in the provider's own shape, the Unicrypt 404 for an unknown pair)"
    verification: []
    human_judgment: true
    rationale: "The plan family marks this prohibition as judgment: review of fake transport and API data; the Unicrypt and Mudra answer shapes are the harness's, not measured live"

duration: 39min
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 06: Entry-Gate, Alert and Arming Findings on the Real Path Summary

**The only S0 now fails on the real path with two real processes.** The real `scripts/deliberate-buy.ts`, run to its own `process.exit(0)` as a railed child, lands a base buy and arms the exit monitor and anti-rug in its own process. The bot already running on the same SQLite file never picks the position up until it is restarted.

**Five entry-gate and alert findings fail the same way:**
- A stranger's Telegram message buys when the allowlist is empty, or holds senders only.
- Dashboard Stop leaves the HTTP poller and Telegram routing buying.
- A token/token pair is checked and bought through WETH.
- A lock of 1 percent of the LP passes the gate.
- The alert prints a constant "Honeypot: No".

**Found on the way, a new S1:** every boot that resumes an open position drops the anti-rug WebSocket subscription.

## Performance

- **Duration:** 39 min
- **Started:** 2026-11-11T17:05:26Z
- **Completed:** 2026-11-11T17:44:48Z
- **Tasks:** 3 of 3. Task 1 tracer gate (interactive, end-of-phase mode): the verify was re-run on the committed tree and passed (TRACER-VERIFY-OK).
- **Files modified:** 19 (8 test files created, 2 register files created, 9 register files modified)

## Per-finding outcomes

| Finding | Sev | Outcome | Test file and claims | What was proven | Left open |
|---|---|---|---|---|---|
| AUD-BUY-001 | S0 | confirmed | AUD-BUY-001.test.ts: `monitor-dies-with-script`, `anti-rug-dies-with-script` | **The running bot:** the test process on a temp-file base V2 graph, with its dex listener and the real `resumeMultiChainMonitoring` and `resumeAntiRugMonitoring`; at the start nothing is held and both resume queries are empty.<br>**The script:** the real `scripts/deliberate-buy.ts base <token> 0.01`, a railed child with the sentinel key on `serveLoopback` plus `autoMine({ confirmations: 3 })`. It exits 0, prints RESULT: BUY LANDED and the sentinel wallet, and logs `exit.monitor.started`, `antirug.lp-baseline.snapshot` and `antirug.register`. Its `eth_subscribe` for the pair reaches the loopback socket.<br>**Afterwards:** the row is pending and is in both resume queries, read through the running bot's connection. After 10 exit-poll intervals the running bot has no exit-monitor timer and no anti-rug registration. `restartGraph` plus resume re-arms both.<br>**Controls:** the same deliberate buy in-process, and a base V3 snipe, read true in both registries.<br>**Rails:** the child's own ledger is loopback-only, and its single block is `env-read-blocked` for the repo `.env` (the script's `dotenv.config()`). | Fix shapes b (the script refuses while the bot runs) and c (the script stays alive) are not this measure; they fail the plain expects (written in the test header) |
| AUD-BUY-006 | S1 | confirmed | AUD-BUY-006.test.ts: `empty-lists-accept-any-source`, `sender-only-list-accepts-any-sender` | A real ETH V2 launch with no DEX listener. A real-shaped message from a sender and chat on no list goes to the real `startTelegramListener` inline handler (Telegram client fake, AC-02). It routes through the real alphaDrop into `handleNewPairForChain`, and a buy bundle appears on the timeline. Control: with both lists set it is rejected before any chain call. | None |
| AUD-BUY-009 | S3 | confirmed | AUD-BUY-009.test.ts: `v2-alert-honeypot-field-is-constant`, `v3-alert-honeypot-field-is-constant` | Ordinary ETH V2 and V3 launches. The checker roundtrip ran (eth_calls to the checker). The exact `sendCtxAlert` text prints a bare Honeypot No, while its BuyTax and SellTax lines come from the roundtrip. | None |
| AUD-BUY-011 | S1 | confirmed | AUD-BUY-011.test.ts: `http-poller-buys-after-stop`, `telegram-routes-to-stopped-chain` | The real `startApiServer` on loopback with the real login. Without a session `POST /api/chains/eth/stop` returns 401; with one it returns 200, and `GET /api/chains` shows "stopped". On a chain without a WS URL the HTTP poller's `eth_getLogs` still covers the launch block and the bot buys. On a WS chain stop does remove the factory listener (the launch buys nothing), yet an allowlisted Telegram alpha drop still routes to the stopped chain and buys. | "Start adds a second poller": `onRestart` is private to `startMultiChainBot`; stays code-read |
| AUD-BUY-027 | S1 | confirmed | AUD-BUY-027.test.ts: `non-native-pair-checked-and-bought` | A real signed `addLiquidity(A, B)` is mined with its PairCreated (the A/B pair at its real CREATE2 address, 2 B, 95 percent of LP at dead). The bot processes it as a snipe. The alert shows "WETH LP: 2.0 ETH" (B's reserve), and Unicrypt's 404 leads to the burn fallback, which passes. The decoded buy is `swapExactETHForTokens` with path [WETH, A]. Anti-rug is armed on the A/B pair, not on the WETH pair. | None |
| AUD-BUY-028 | S1 | confirmed | AUD-BUY-028.test.ts: `unicrypt-one-percent-lock-passes`, `mudra-one-percent-lock-passes` | The scenario's own lock answer for the pair is re-served with each amount divided by 100 (same shape and unlock date). On ETH (Unicrypt) and BSC (Mudra), "All safety checks passed, buying" is logged and a buy is sent. | The GoPlus site (`holder.percent` unread) cannot be reached on base or arb today: AUD-BUY-016 skips every V2 launch first |
| AUD-ANTIRUG-025 (new) | S1 | confirmed | AUD-ANTIRUG-025.test.ts: `resume-drops-ws-subscription` | A real ETH V2 snipe is armed. Before the restart, an LP transfer to a locker is evaluated (`antirug.allowlist-hit`). After `restartGraph` and the real resume paths, `antirug.listener.subscribed` is logged twice, and the node shows one `eth_subscribe` for the pair, then its `eth_unsubscribe`, then nothing, with zero log subscriptions left. A second transfer, to another locker, is never evaluated. The registry and the exit monitor still show the position armed. | Not in the frozen population (61); recorded anyway so check.ts can locate its claim |

None of these entries is unreproduced or NOT-A-BUG. The outcomes that still need operator action are listed under Next Phase Readiness.

## Task Commits

1. **Task 1 (tracer): AUD-BUY-001** - `327d727` (test)
2. **New finding found in Task 1: AUD-ANTIRUG-025 registered and proven** - `542a57c` (test)
3. **Task 2: AUD-BUY-006 and AUD-BUY-009** - `1c3875e` (test)
4. **Task 3: AUD-BUY-011, AUD-BUY-027 and AUD-BUY-028** - `7f271d7` (test)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## New findings and grade/status changes

All made under the operator's standing instruction of 2026-11-11 ("All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading"), without a stop.

| Item | Change | Evidence |
|---|---|---|
| AUD-ANTIRUG-025 (new) | Registered S1, capital STRAND, confirmed, class C10; ESC-ANTIRUG-04 (area-batch tier, `operator_response` null, no operator words invented); sweep `src x C10`; ledger `detector.ts` row; triage confirmed | At every boot `resumeAntiRugMonitoring` registers each open position (step 3 installs the address filter) and then calls `startChainAntiRugListener` again (step 4). That second call runs `ctx.wsProvider.off(oldFilter)` and `ctx.wsProvider.on(newFilter)` without awaiting either (bot.ts:2120/:2130-2144, detector.ts:644/:655 at the audit base; :2122/:2132-2146, :647/:658 at HEAD). The two filters have the same ethers tag. In ethers 6.16.0 (abstract-provider.js:1040-1157), `on()` finds the old subscriber before `off()` deletes it and attaches the new dispatcher to it; `off()` then stops that subscriber. No `eth_subscribe` follows. This is pure microtask order with no network in between, so a real node sees the same sequence. Graded like AUD-ANTIRUG-001 (S1 STRAND, the rug subscription can vanish). By code reading (not run), a second position on an already watched pair hits the same race. |
| AUD-BUY-001 | `related` gains AUD-ANTIRUG-025 | Its interim rule (restart the main bot after a deliberate buy) restores the exit monitor but not the anti-rug subscription |

No severity changed and no status changed on the six plan findings: all were already confirmed, and `set-triage.ts` kept confirmed.

**For the operator (via the orchestrator; this does not block this plan):** the interim rule recorded on ESC-BUY-01 says to start or restart the main bot right after any deliberate buy. Because of AUD-ANTIRUG-025, that restart re-arms the exit monitor but leaves anti-rug blind for the position until a buy on a new pair re-subscribes. The bot is off for all of v7.0, so nothing is exposed today. The interim rule should be read as covering the exit monitor only, until AUD-ANTIRUG-025 is fixed in Phase 24.

## Files Created/Modified

- `test/realpath/triage/AUD-BUY-001.test.ts`: the two-process S0 proof and two controls
- `test/realpath/triage/AUD-BUY-006.test.ts`: two claims and a control
- `test/realpath/triage/AUD-BUY-009.test.ts`: V2 and V3 claims
- `test/realpath/triage/AUD-BUY-011.test.ts` and `fixtures/AUD-BUY-011-dashboard.ts`: the real dashboard server, login and stop route
- `test/realpath/triage/AUD-BUY-027.test.ts`, `AUD-BUY-028.test.ts`: the pair-selection and lock-share proofs
- `test/realpath/triage/AUD-ANTIRUG-025.test.ts`: the new finding's proof
- `.planning/audit/findings/AUD-BUY-001/-006/-009/-011/-027/-028.json`: triage blocks (set-triage.ts); AUD-BUY-001 `related`
- `.planning/audit/findings/AUD-ANTIRUG-025.json`, `escalations/ESC-ANTIRUG-04.json`, `sweep/contrib-PHASE23.json`, `ledger/ANTIRUG.json`: the new finding
- `.planning/audit/AUDIT-FINDINGS.md`: re-rendered with render.ts after every register edit; OPERATOR-DECISIONS.md byte-unchanged; SEAL.json untouched

## Decisions Made

See `key-decisions`. In short:
- Each claim measures the harm (no monitor in the running bot, a buy sent, a bare constant field), so the recommended fix reads "looks fixed".
- Fix shapes this measure does not see are written in each test header.
- Everything before a marker holds under both the bug and a fix. AUD-BUY-009 lands its buy before the marker for that reason.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Proof strength] AUD-BUY-001 controls and a restart check beyond the plan**
- The plan's control was "a normal snipe in the running bot" on base. Base V2 snipes are skipped by AUD-BUY-016, so the snipe control runs on base V3 (public route).
- A second control runs the same `executeDeliberateBuy` inside the running bot. Then the process is the only difference from the main test.
- After the markers, `restartGraph` plus resume shows that only a restart re-arms the position. The plan text says this; the test now proves it.
- **Committed in:** 327d727

**2. [Rule 1 - Bug in my own test] Teardown cancelled a queued `eth_unsubscribe`**
- **Found during:** Task 1, the first full-file run: an unhandled "provider destroyed; cancelled request (eth_unsubscribe)".
- **Diagnosis:** Vitest named the next test, but the instrumented control's provider never sent `eth_unsubscribe`. The rejection came from the main test's restarted graph: resume re-subscribes, the `off()` queues an `eth_unsubscribe` on ethers' fake 10 ms drain timer, and teardown cleared that timer.
- **Fix:** the test now waits until that `eth_unsubscribe` reaches the node. The diagnosis led to finding AUD-ANTIRUG-025.
- **Committed in:** 327d727

**3. [Rule 2 - Missing critical] AUD-ANTIRUG-025 registered and proven (bug not in the register), under the standing instruction**
- It gets its own triage file (D-10: a different root cause from AUD-BUY-001), two fix-shaped mutations and a control.
- **Committed in:** 542a57c

**4. [Rule 2 - Proof strength] AUD-BUY-011 on the real server, with a second claim**
- The plan allowed mounting `chains.ts` on an express app. The test uses the real `startApiServer` (real auth middleware, real `stoppedChains`, real login with `DASHBOARD_API_KEY`) and shows a call without a session is refused with 401.
- It adds the Telegram-to-stopped-chain claim from the same finding.
- **Committed in:** 7f271d7

**5. [Rule 3 - Blocking] Requests to the real server under the fixed clock**
- The server's own `getBlockNumber` reads wait on ethers' fake drain timer, while their answers arrive as real I/O.
- In the HTTP-poller case an earlier identical call answered from ethers' 250 ms cache, which the frozen clock never expires. That is why the first claim passed and the second hung (diagnosed, not retried).
- The fixture alternates one fake 10 ms step with one real event-loop turn. It captures the real `setImmediate` at load, because Vitest also fakes the `timers` module.
- **Committed in:** 7f271d7

**6. [Rule 2 - Proof strength] More sites than the plan named**
- AUD-BUY-009 proves the V3 handler as well as V2.
- AUD-BUY-028 proves Mudra (BSC) as well as Unicrypt (ETH).
- Each is its own claim, and the half-supply fix sketches were checked not to refuse fully locked pairs.
- **Committed in:** 1c3875e, 7f271d7

**7. [Rule 2 - Fix signal] AUD-BUY-009 lands its buy before the marker**
- Under a fix the test previously stopped at the marker while the buy was still running, so an unhandled "database connection is not open" followed the D-08 error.
- **Committed in:** 1c3875e

**8. [Process] The root-pin guard first ran after the first Write instead of before it**
- It ran right after, printed PIN OK for the pinned root, and then ran before every commit.
- No write landed outside the pinned checkout.

---

**Total deviations:** 8 (Rule 1: 1, Rule 2: 5, Rule 3: 1, process: 1). **Impact:** stronger proofs and one new registered finding. `src/` is unchanged; nothing under `test/realpath/harness/` was written.

## Issues Encountered (all diagnosed)

- **The teardown `eth_unsubscribe` rejection** (deviation 2) was misattributed by Vitest to the next test. It was traced with temporary instrumentation of the control's provider, which was removed before commit.
- **Under the 001 exit-handoff mutation only, a stray read follows the looks-fixed error.** The resumed monitor's later polls read the token's `allowance`, which the table does not answer. This happens after the marker has already thrown, under a fix; it is written in the test header.
- **The rails run ledger now lists `test/realpath/triage/fixtures/AUD-BUY-011-dashboard.ts` as a triggering file.** Its 10 `net-allow` entries are all class loopback to 127.0.0.1, from the real HTTP calls to the real dashboard. `nonLoopbackAllowed` and `telegramAllowed` are 0.
- **The AUD-BUY-001 child's own ledger** holds exactly one block, `env-read-blocked` for the repo `.env` (the script's own `dotenv.config()`), as the plan expects. Its network entries are loopback-only.
- **`check.ts --stage final`** has 37 FAILs, from earlier plans' TESTI/TESTU/SCRIPTS rows plus the triage items. None names a file this plan added.
- Git's "LF will be replaced by CRLF" notices come from `core.autocrlf=true`; the blobs are LF.

## Verification (exact commands, Node 22.16.0 via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

- **Task 1 verify:** `node node_modules/vitest/vitest.mjs run --project realpath test/realpath/triage/AUD-BUY-001.test.ts && node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial --slice BUY && node -e "<AUD-BUY-001 triage check>"` gave 3/3, PASS and exit 0. The same command was re-run on the committed tree as the tracer gate.
- **Task 2 verify:** the plan command gave 5/5, PASS and exit 0.
- **Task 3 verify:** the plan command gave 5/5, PASS and exit 0.
- **AC-10:** each task's files ran three times with the JSON reporter; status and knownBug records were identical on every run. The AUD-ANTIRUG-025 file also ran three times, identical.
- **Whole realpath project:** `node node_modules/vitest/vitest.mjs run --project realpath` gave 19 files and 100/100 (86 before plus 14).
- **Gates:**
  - `scripts/check-realpath-mocks.ts`: 32 vi uses (7 mock calls) in 30 files, 0 violations.
  - `--project unit test/unit/rails/spawnSites.test.ts test/unit/viMockGate.test.ts test/unit/realpathMockGate.test.ts`: 21/21.
- **Type check:** `tsc -p <scratchpad tsconfig extending the repo's, include test/realpath/triage/**/*.ts>` gave 0 errors over 15 triage files.
- **Register:**
  - `check.ts --stage partial`: PASS, fail 0, pending 63. `--slice BUY` PASS (pending 19); `--slice ANTIRUG` PASS (pending 9).
  - `--stage consolidation`: PASS. `--self-test`: 50/50.
  - `--stage triage`: fail 63, all expected: 48 population entries other plans have not recorded, 11 S0/S1 acknowledgements owed to 23-16, 2 `fork_ref`s from 23-05, AUD-TX-006's keep-open ruling, and the run-evidence file.
- `git status --porcelain src` was empty at every commit and after every mutation.
- **Fix-signal proofs:** scratch mutations of `src/`, run on Node 22.16.0. After each, the original bytes were written back and `git hash-object` was IDENTICAL to the HEAD blob.

| Mutation | Result |
|---|---|
| 001-exit-handoff (the running bot re-scans pending buys for its exit monitor) | AUD-BUY-001 looks fixed (monitor claim) |
| 001-antirug-handoff (the running bot re-scans for anti-rug) | looks fixed (anti-rug claim; the monitor claim still reproduced) |
| 025-await-off / 025-skip-unchanged | AUD-ANTIRUG-025 looks fixed (both) |
| none (control on AUD-ANTIRUG-025 and AUD-BUY-009) | passes |
| 006-fail-closed | AUD-BUY-006 looks fixed (both claims) |
| 006-and | looks fixed on the sender-only claim only |
| 009-report-check | AUD-BUY-009 looks fixed (V2 and V3) |
| 009-v2-removed | V2 looks fixed, V3 still reproduces |
| 011-stop-check | AUD-BUY-011 looks fixed (both claims) |
| 027-drop-non-native | AUD-BUY-027 looks fixed |
| 028-unicrypt-share / 028-mudra-share | AUD-BUY-028 looks fixed (each provider's claim alone); harness.test.ts 34/34 under each (fully locked pairs still bought) |

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- **Plan 23-16 must:**
  - acknowledge in the batch report AUD-BUY-001 (S0), AUD-BUY-006, -011, -027 and -028 (S1), and the new AUD-ANTIRUG-025 (S1, ESC-ANTIRUG-04, no operator words yet);
  - put the AUD-ANTIRUG-025 interim-rule consequence to the operator (see "For the operator");
  - collect the 12 knownBug records from these seven files into the run evidence.
- **Phase 24:**
  - each file can be run alone as a before-and-after proof;
  - for AUD-BUY-001, a fix of shape b or c needs its test rewritten (written in its header);
  - AUD-ANTIRUG-025 is a small fix (await the `off()`, or skip an unchanged re-subscribe), and it should land before or with the AUD-BUY-001 fix, since any restart-based mitigation depends on it.

## Self-Check: PASSED

- FOUND: test/realpath/triage/AUD-BUY-001.test.ts, AUD-BUY-006.test.ts, AUD-BUY-009.test.ts, AUD-BUY-011.test.ts, AUD-BUY-027.test.ts, AUD-BUY-028.test.ts, AUD-ANTIRUG-025.test.ts, fixtures/AUD-BUY-011-dashboard.ts, .planning/audit/findings/AUD-ANTIRUG-025.json, .planning/audit/escalations/ESC-ANTIRUG-04.json.
- FOUND commits on this branch: 327d727, 542a57c, 1c3875e, 7f271d7 (`git rev-list --count bc58f73..HEAD` = 4 before this SUMMARY).
- All three tasks' acceptance criteria and the plan-level verification were re-run after the last commit and pass; no scratch file is left under test/.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*
