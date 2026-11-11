---
phase: 23-test-safety-net-harness-triage-characterization
plan: 27
subsystem: testing
tags: [vitest, ethers, better-sqlite3, ws, realpath-harness, restart, child-process, telegram]

requires:
  - phase: 23-01
    provides: the realpath harness (FakeNode.handle with a connection argument, subscriptions, installSeams, createScenario, disposers, afterEach checks)
  - phase: 23-28
    provides: the mining model, emitLogs, filtered subscriptions (logMatches), createScenario for every chain
  - phase: 23-02
    provides: the timeline, installDbCapture on every new connection, recordedAlerts / recordedLogs, the AC-02 mock-list gate
  - phase: 22-safety-rails-audit
    provides: spawnRailedChildAsync and killProcessTree, the rails ledger, the db.ts src-layer tripwire
provides:
  - "world.ts: createTempDbFile, assertTempDbFile, loadGraph({ db }), createScenario({ db: 'memory' | { file } }), restartGraph(scenario, { env })"
  - "loopback.ts: serveLoopback(node) -> { httpUrl, wsUrl, openSockets, socketsAccepted, socketErrors, whenSocketsClosed, close }, runRailedChildToEnd(cmd, args, opts) -> { status, signal, stdout, stderr }"
  - "chain.ts: FakeNode.waitForSubscriptions(n), FakeNode.autoMine({ confirmations } | false), FakeNode.detachConnection(connection); harness state tempDbDirs and telegram.handlers"
  - "fixtures: sharedDbChild.ts (CHILD_DONE), wsSubscribeChild.ts (CHILD_WS_READY, CHILD_WS_LOG, CHILD_WS_HEAD, CHILD_WS_TIMEOUT)"
  - "telegram.ts: deliverTelegramMessage({ text, senderId, chatId }), telegramHandlerCount(); setup.ts TelegramClient / StringSession / NewMessage fakes; Graph.telegramListener"
  - "The Harness Gap Procedure (in 23-27-PLAN.md) is in force from now until the phase ends"
affects: [23-05, 23-06, 23-07, 23-08, 23-09, 23-10, 23-11, 23-12, 23-13, 23-14, 23-15, 23-16, 23-20, 23-21, 23-22, phase-24]

actuals:
  tokens: 19394    # chars/4 over the added lines of b9f9c7f..384be2f (9 files, 77576 chars)
  tasks: 3
  commits: 3       # MEASURED: git rev-list --count b9f9c7f..HEAD before this SUMMARY commit
plan_head_before: b9f9c7fdfdaa516e598a0a25324bb1c6c6cbe33d
plan_head_after: 384be2f991992d822cbbc75c41d310997d1d3ecd
commits: 3

tech-stack:
  added: []
  patterns:
    - "A restart is the scenario continuing: the graph is stopped by the same steps as dispose (shared stopGraphParts), the old process's sockets and Telegram client die with it, and alerts, logs and the timeline are kept"
    - "Every harness database is ':memory:' or a file whose real path is inside os.tmpdir(), checked before any src/ import; memory mode refuses any other DB_PATH"
    - "A real child reaches the simulated chain only through serveLoopback, starts only through runRailedChildToEnd (spawnRailedChildAsync), and its own case ledger is asserted loopback-only"
    - "Waiting for a real child under the fixed clock: an event-driven promise (waitForSubscriptions, whenSocketsClosed) raced against the child's end, never a timer"

key-files:
  created:
    - test/realpath/harness/loopback.ts
    - test/realpath/harness/telegram.ts
    - test/realpath/fixtures/sharedDbChild.ts
    - test/realpath/fixtures/wsSubscribeChild.ts
    - test/realpath/harnessRestart.test.ts
    - test/realpath/harnessTelegram.test.ts
  modified:
    - test/realpath/harness/world.ts
    - test/realpath/harness/chain.ts
    - test/realpath/harness/setup.ts

key-decisions:
  - "loadGraph in memory mode now refuses a DB_PATH other than :memory: (was: kept any value already set), so an env override cannot point a graph at a non-temp file (T-23-43); no existing test relied on the old behavior"
  - "restartGraph models process death: it clears every fake timer (vi.clearAllTimers), releases holds (a hold armed before a restart is ended, parked calls answered with an error), terminates any old-graph socket still open and drops the old Telegram client and handlers; the FakeNode, file, clock, env snapshot, alerts, logs and timeline stay"
  - "Each railed child gets its own case ledger (ledgerRunId), read and asserted loopback-only inside the test, as dotenvSrcSkip.test.ts does; the run ledger then holds only the parent's entries (nonLoopbackAllowed 0)"
  - "deliverTelegramMessage builds senderId and chatId with the big-integer copy the Telegram library itself loads, and refuses a NewMessage builder carrying filters the fake does not apply"

patterns-established:
  - "Restored-mutation RED runner (scratchpad redrun.py): one mutation at a time, Node 22 by absolute path, file restored and checked by sha256"

requirements-completed: []  # CHAR-01 is declared by this plan; requirements.ready-ids reports it blocked until every sibling plan declaring it has a SUMMARY

coverage:
  - id: D1
    description: "A restart keeps its database: a real V2 buy's exit_state row is read through the new connection after restartGraph, the capture and SQL clock are on the new connection, and the real resumeMultiChainMonitoring logs exit.monitor.resumed for that trade with no fresh start"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harnessRestart.test.ts#a real V2 buy keeps its exit_state row across restartGraph, read through the new connection, and the real resumeMultiChainMonitoring resumes it instead of starting fresh"
        status: pass
      - kind: integration
        ref: "test/realpath/harnessRestart.test.ts#an alert recorded before restartGraph is still on recordedAlerts() after it"
        status: pass
    human_judgment: false
  - id: D2
    description: "No harness database outside the OS temp folder: a file outside it (in the repo, a .. escape, relative, the temp folder itself, :memory: as a file) and a smuggled DB_PATH are refused before any src/ import with no file created; the disposer removes the temp folder"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harnessRestart.test.ts#a database file outside the OS temp folder is refused before any src/ import, and no file is created for it"
        status: pass
      - kind: integration
        ref: "test/realpath/harnessRestart.test.ts#the scenario disposer removes the temp database folder, and restartGraph refuses an in-memory scenario"
        status: pass
    human_judgment: false
  - id: D3
    description: "A real child and the test share one SQLite file and one simulated node: the child's block number is the node head, its eth_blockNumber is in callLog, its insertTrade row is read through the parent's real connection; the control child on another file leaves the parent table empty"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harnessRestart.test.ts#a real child reads the node over loopback HTTP and writes a row through the real insertTrade that the parent reads through its own real connection on the same file"
        status: pass
      - kind: integration
        ref: "test/realpath/harnessRestart.test.ts#control: the same child on a different temp file writes its row there and leaves the parent table empty"
        status: pass
    human_judgment: false
  - id: D4
    description: "The loopback WebSocket is a full JSON-RPC peer: a real child's ethers WebSocketProvider subscribes (logs with the anti-rug filter shape, and newHeads), gets the matching log and not the other, gets the mined head; afterwards no subscription remains and a later push records no stray; RED before the route (CHILD_WS_TIMEOUT, exit 3)"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harnessRestart.test.ts#a real child's ethers WebSocketProvider subscribes over the loopback socket, receives the matching log and not the other one, and reports the mined head"
        status: pass
      - kind: integration
        ref: "test/realpath/harnessRestart.test.ts#the loopback HTTP port answers a single and a batch JSON-RPC body from the same node, and an unknown request is a stray"
        status: pass
      - kind: integration
        ref: "test/realpath/harnessRestart.test.ts#autoMine mines an accepted public transaction and confirmations - 1 empty blocks in the same tick; it is off by default"
        status: pass
    human_judgment: false
  - id: D5
    description: "A triage test can deliver a real-shaped Telegram message to the real inline allowlist handler: unset allowlists reach eth_getCode and 'Contract not found on any chain'; set and not matching reject before any chain call (with an allowed-sender control); no handler throws 'no Telegram handler registered'; disposal leaves 0 handlers"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harnessTelegram.test.ts (4 tests)"
        status: pass
      - kind: other
        ref: "npm run check:realpath-mocks (30 vi uses, 7 mock calls, 15 files, 0 violations)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AC-48 prohibition: no test passes on fake chain responses a real node could never return (loopback answers come from the same FakeNode code as the in-process seam)"
    verification: []
    human_judgment: true
    rationale: "The plan's own verification for this prohibition is judgment (review of fake transport data); no test can assert the absence of an impossible response"
  - id: D7
    description: "The Harness Gap Procedure and the harness ownership rule (23-01, 23-28, 23-02, 23-27 own test/realpath/harness/; 23-20 adds only serializer.ts)"
    verification: []
    human_judgment: true
    rationale: "A written procedure in 23-27-PLAN.md that later executors and the orchestrator follow; nothing here can execute it"

duration: 28min
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 27: Restart, Two-Process and Telegram Harness Summary

**A scenario can now restart its bot on the same temp-file SQLite database and the same simulated chain. A real railed child process shares that file and reaches the same FakeNode over real loopback HTTP and WebSocket ports, where its real ethers WebSocketProvider subscribes and receives filtered logs and heads. A triage test can hand a real-shaped Telegram message to the real inline allowlist handler. Every database the harness opens is `:memory:` or a file inside the OS temp folder, checked before any src/ import.**

## Performance

- **Duration:** about 28 min
- **Started:** 2026-11-11T15:02:36Z
- **Completed:** 2026-11-11T15:30:02Z
- **Tasks:** 3 of 3
- **Files modified:** 9 (6 created, 3 modified)

## Accomplishments

- **Task 1 (tracer), restart on one file.** `createTempDbFile()` makes a folder under `os.tmpdir()`. `createScenario({ db: { file } })` opens the real graph on it, and `restartGraph()` stops the graph (held calls, the bot's timer registry, every fake timer, providers, `closeDb`) and loads the whole graph again on the same file and FakeNode. A real V2 buy's `exit_state` row is read back through the new connection with identical values. Then the real `resumeMultiChainMonitoring` logs `exit.monitor.resumed` for that trade, with no fresh-state start and no second exit monitor. The capture and the SQL clock are on the new connection: `unixepoch()` reads the fake clock, and a real statement's write lands on the same timeline.
- **The live-database guard (T-23-43).** Before any src/ import, `loadGraph` refuses a file whose real path is not inside the temp folder. Tested cases: a file in the repo, a `..` escape, a relative path, the temp folder itself, `:memory:` given as a file, and Win32 device, UNC and alternate-stream forms. Memory mode also refuses any other `DB_PATH`, so an override cannot bypass the guard. No file is created for a refused path, and no src/ log line appears.
- **Task 2, a real second process.** `serveLoopback(node)` serves one FakeNode on real `http` and `ws` servers on 127.0.0.1. A child started through `runRailedChildToEnd` (over `spawnRailedChildAsync`) reads the head over HTTP and writes through the real `insertTrade`. The parent reads that row through its own real connection. The control child on another file writes its row there, and the parent's table stays empty.
- **The loopback WebSocket is a full JSON-RPC peer.** Each socket passes its own connection to `node.handle`, so `eth_subscribe` and the `eth_subscription` pushes run the same node code as in process. A real child's ethers `WebSocketProvider` subscribed with the anti-rug filter shape (address list, OR topics) and to new blocks. It got only the matching log and the mined head. After it left, no subscription remained, and a later push recorded no stray.
- **Task 3, the Telegram client fake.** The real `startTelegramListener` connects through the fake and registers one `NewMessage` handler on the shared state. `deliverTelegramMessage` reaches the real inline handler. With the allowlists unset, an address with no code produces an `eth_getCode` call on the node and the real `Contract not found on any chain` line. With both allowlists set and neither matching, the handler rejects before any chain call, and an allowed sender on the same listener gets through. Delivering with no handler throws `no Telegram handler registered`.

## Task Commits

1. **Task 1: restart a real graph on one temp-file database (tracer)** - `6bc5c87` (test). The tracer gate re-ran the Task 1 verify on the committed tree (4/4) before expansion.
2. **Task 2: loopback HTTP and WebSocket ports, real child sharing the database and subscribing** - `1c2519c` (test)
3. **Task 3: Telegram client fake and the real inline handler** - `384be2f` (test)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## Files Created/Modified

- `test/realpath/harness/world.ts` - `createTempDbFile`, `assertTempDbFile`, `loadGraph({ db })`, `createScenario({ db })`, `restartGraph`, `stopGraphParts` (shared with dispose), temp-folder removal, `Graph.telegramListener`, Telegram handler cleanup
- `test/realpath/harness/chain.ts` - `waitForSubscriptions`, `autoMine`, `detachConnection`; state `tempDbDirs` and `telegram.handlers` (`TelegramHandlerEntry`)
- `test/realpath/harness/loopback.ts` - `serveLoopback`, `runRailedChildToEnd`, `RailedChild`, `ChildRun` (new)
- `test/realpath/harness/setup.ts` - the `telegram` mock's `TelegramClient` registers handlers on the shared state
- `test/realpath/harness/telegram.ts` - `deliverTelegramMessage`, `telegramHandlerCount` (new)
- `test/realpath/fixtures/sharedDbChild.ts`, `test/realpath/fixtures/wsSubscribeChild.ts` - the two railed children (new, not test files)
- `test/realpath/harnessRestart.test.ts` - 9 tests: 4 for restart, 5 for the child and loopback (new)
- `test/realpath/harnessTelegram.test.ts` - 4 tests (new)

## RED Output Required by Task 2 (before the WebSocket route existed)

The subscription test was written and run while `loopback.ts` accepted WebSocket connections but routed no message to the node. The command was `node node_modules/vitest/vitest.mjs run --project realpath test/realpath/harnessRestart.test.ts`, on Node 22.16.0:

```
 ❯  realpath  test/realpath/harnessRestart.test.ts (9 tests | 1 failed) 24005ms
     × a real child's ethers WebSocketProvider subscribes over the loopback socket, receives the matching log and not the other one, and reports the mined head 20566ms
 FAIL   realpath  test/realpath/harnessRestart.test.ts > realpath harness: a real child shares the database and the chain (plan 23-27 Task 2) > a real child's ethers WebSocketProvider subscribes over the loopback socket, receives the matching log and not the other one, and reports the mined head
Error: the child ended before 2 subscriptions existed: status 3 signal null
stdout:
CHILD_WS_TIMEOUT
stderr:
 ❯ untilSubscribed test/realpath/harnessRestart.test.ts:237:31
 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

With the route added, it passed on three runs in a row.

## Verification (exact commands, Node 22.16.0 via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

- Task 1 verify: `node node_modules/vitest/vitest.mjs run --project realpath test/realpath/harnessRestart.test.ts` gave 4/4, both before the commit and in the tracer re-run.
- Task 2 verify: `node node_modules/vitest/vitest.mjs run --project realpath test/realpath/harnessRestart.test.ts test/realpath/harness.test.ts && node node_modules/ts-node/dist/bin.js scripts/check-realpath-mocks.ts && node node_modules/vitest/vitest.mjs run --project unit test/unit/rails/spawnSites.test.ts`. Results: 38/38 on three identical runs, mock gate 0 violations, spawn gate 5/5, exit 0.
- Task 3 verify: `node node_modules/vitest/vitest.mjs run --project realpath test/realpath/harnessTelegram.test.ts test/realpath/harness.test.ts && node node_modules/ts-node/dist/bin.js scripts/check-realpath-mocks.ts` gave 33/33 and 0 violations (30 vi uses, 7 mock calls, 15 files), exit 0. `npm run check:realpath-mocks` exited 0.
- Whole realpath project: `node node_modules/vitest/vitest.mjs run --project realpath` gave 5 files, 69/69, on two runs.
- Full railed suite: `npm test` (unit, integration, realpath) gave 142 files and 1276 passed, with 0 failed and 0 skipped. That is 23-02's 1263 plus this plan's 13. In run `run-20261111T152731-22876-714900`, `nonLoopbackAllowed` was 0 and `telegramAllowed` was 0. There were 17 triggering files: the 16 deliberate rail-test denials 22-15 and 23-02 recorded, plus `harnessRestart.test.ts`. Its only entry is a `net-allow` to 127.0.0.1, class loopback, from the batch-body test's own `http.request` (line 394). That was diagnosed: it is not a deny.
- Rail ledger for the children: each child ran with its own `ledgerRunId`, and the test asserts that ledger. It shows `worker-start`, `env-override` for the URL and DB keys, and `net-allow` to 127.0.0.1 only, with no deny, blocked or tripwire entry. Each realpath run ledger shows only `worker-start` and that one loopback `net-allow`.
- Other gates: `scripts/check-vi-mock-paths.ts` 591 calls in 189 files, 0 violations. `spawnSites.test.ts`, `viMockGate.test.ts` and `realpathMockGate.test.ts` 21/21.
- Type check: `tsc --noEmit` over `test/realpath/**/*.ts` with a scratchpad tsconfig that extends the repo's (module esnext, typeRoots set) gave 0 errors, covering the fixtures as well.
- `grep -c "child_process" test/realpath/harness/loopback.ts` printed 0. `grep -c "vi\.fn" test/realpath/harness/setup.ts` printed 0. `git status --porcelain src` was empty at every commit.
- Register: `node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial` gave `RESULT PASS stage=partial fail=0 pending=62`, after Task 1 and again after Task 3. No re_audit row was needed: every file this plan edited was added in Phase 23 and has no ledger row (PROTOCOL.md section 7 applies only to post-base files that already have one).

### RED proofs (restored mutations, one at a time, each file checked by sha256 after restore, nothing committed)

| # | Mutation | Failed test(s) |
|---|----------|----------------|
| M0 | none (control) | none, 4/4 pass |
| M1 | restartGraph reloads `:memory:` | restart test, alert test (DB_PATH refused) |
| M2 | temp-folder check removed | refusal test, disposer test |
| M3 | dispose keeps the temp folder | disposer test |
| M4 | restartGraph empties alerts | restart test, alert test |
| M5 | no capture on the reloaded connection | restart test (`unixepoch` read the real clock) |
| M6 | memory mode takes any DB_PATH | refusal test |
| M7 | restartGraph keeps the old ctx | restart test |
| L1 | socket passes no connection | subscription test (`notifications not supported`, child exit 1) |
| L2 | a closed socket keeps its subscriptions | subscription test (`node.subscriptions` not empty) |
| L3 | HTTP accepts any method and path | HTTP test |
| C1 | subscriptions get every log | subscription test (two CHILD_WS_LOG lines) |
| C2 | subscribe path never wakes waiters | subscription test (child timed out, exit 3) |
| C3 | autoMine mines no confirmations | autoMine test |
| T1 | delivering to nobody passes | no-handler test |
| T2 | handler kept on the client only | all 4 Telegram tests |
| T3 | disposal keeps handlers | no-handler test |
| T5 | text on the wrong event field | both route tests |
| S1 | `src/telegramListener.ts` allowlist check bypassed (temporary src edit) | allowlist test (an `eth_getCode` call appeared). src was restored: `git hash-object` equals the HEAD blob and `git diff -- src` is empty |

## Decisions Made

See `key-decisions` in the frontmatter. In short:
- Memory mode is stricter than before, so no override can open a non-temp file.
- A restart models process death: timers, holds, sockets and the Telegram client die, and the scenario's records stay.
- Each child's ledger is asserted inside its own test.
- Telegram IDs come from the library's own big-integer copy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security, T-23-43] Memory mode refuses a DB_PATH other than :memory:**
- **Found during:** Task 1
- **Issue:** As written, `loadGraph` kept any `DB_PATH` already set. A `createScenario` override could therefore point a graph at any file and skip the temp-folder rule this plan exists to enforce.
- **Fix:** Memory mode sets `:memory:` and refuses any other non-empty value, naming the rule. The plan said the default was "unchanged"; no existing test set `DB_PATH`, and all 60, then 69, realpath tests pass.
- **Files modified:** test/realpath/harness/world.ts
- **Verification:** refusal test (createScenario override); RED M6
- **Committed in:** 6bc5c87

**2. [Rule 2 - Security] Stricter file checks than the plan listed**
- **Found during:** Task 1
- **Issue:** "Resolved path under os.tmpdir()" alone is open to a symlink or junction escape, to Windows path spellings whose real target cannot be read from the text, and to a relative path that db.ts resolves against the repo root.
- **Fix:** The check compares real paths (nearest existing ancestor, then `realpathSync.native`, case-insensitive on win32). It refuses relative, UNC/device, alternate-data-stream and trailing-dot/space forms. After the import, `loadGraph` also checks that `getDbFilePath()` is the requested file.
- **Files modified:** test/realpath/harness/world.ts
- **Committed in:** 6bc5c87

**3. [Rule 3 - Blocking] chain.ts changed in Task 1**
- **Issue:** The temp-folder list belongs on the shared harness state (the 23-01 rule that shared state lives in `harnessState()`), and chain.ts is not in Task 1's file list.
- **Fix:** Added `tempDbDirs` to `HarnessState` in the Task 1 commit.
- **Committed in:** 6bc5c87

**4. [Rule 2 - Correctness] restartGraph models a dead process completely**
- **Issue:** The plan named timers, providers, held calls and closeDb. Two more things could cross a restart. An old-graph FakeWebSocket still open would keep receiving pushes. The old graph's Telegram handler would still receive deliveries that a restarted process could never see.
- **Fix:** Any old-graph socket still open is terminated, and the Telegram client and handlers are dropped. `restartGraph` also checks that the chain ID, checker address and wallet are unchanged, and refuses an in-memory or disposed scenario. As a consequence, `vi.clearAllTimers` clears every fake timer, including ones a test scheduled, and a hold armed before a restart is ended.
- **Files modified:** test/realpath/harness/world.ts
- **Committed in:** 6bc5c87, 384be2f

**5. [Rule 2 - Loud failure] Loopback refusals are strays**
- **Issue:** Without them, a wrong method or path, a binary frame, or a push to a socket that is not open would pass silently.
- **Fix:** Each of these is recorded as a stray (HTTP answers 404). Socket-level errors are kept on `socketErrors`, not as strays, because a child that exits can legitimately reset its socket. `runRailedChildToEnd` kills a child still running at teardown and fails the test by name.
- **Files modified:** test/realpath/harness/loopback.ts
- **Committed in:** 1c2519c

**6. [Rule 2 - Proof strength] Tests beyond the plan's list**
- The control child's row is read from its own file, so an empty parent table cannot come from a child that wrote nothing.
- A single/batch/unknown-request HTTP test proves "single and batch bodies are accepted".
- An autoMine test: the plan lists `autoMine` as an artifact, and no other test exercises it.
- Each child's own case ledger is asserted loopback-only inside its test.
- **Committed in:** 1c2519c

**7. [Rule 2 - Fidelity] Shapes closer to production than the plan's wording**
- `wsSubscribeChild` subscribes with `address: [<argv>]`, an address list, which is exactly `startChainAntiRugListener`'s shape, and prints `CHILD_WS_READY`.
- `deliverTelegramMessage` uses the library's own big-integer, and refuses a filtered or non-NewMessage builder. The setup.ts handler entry also records its `client`.
- Both fixtures refuse a non-loopback URL, and `sharedDbChild` refuses a DB_PATH outside the temp folder. This is defense in depth beside the rails.
- **Committed in:** 1c2519c, 384be2f

**8. [Rule 1 - Bug in my own test] Post-exit log**
- **Found during:** Task 2, the first green attempt
- **Issue:** The later `emitLogs` named a transaction from an older block on the empty head block. The node correctly refused it: a log must come from a transaction in its own block (AC-48).
- **Fix:** The test mines a fresh transaction first.
- **Committed in:** 1c2519c

**9. [Rule 3] Case ledger IDs**
- **Issue:** `Date.now()` is frozen under the fixed clock, and a failed test left its case folder behind (seen after the RED run).
- **Fix:** IDs carry a random part, and a disposer removes a folder the test did not take.
- **Committed in:** 1c2519c

---

**Total deviations:** 9 (Rule 1: 1, Rule 2: 6, Rule 3: 2).
**Impact on plan:** Every change either tightens the T-23-43 and T-23-48 mitigations or makes a failure loud. There is no scope creep, and `src/` is unchanged.

## New Findings and Grade/Status Changes

None. No bug outside the register was found, and no severity or status was changed, so the standing instruction of 2026-11-11 was not needed. The restart, resume, two-process and Telegram paths behaved as their code reads.

## Issues Encountered (all diagnosed)

- **The first RED batch reported "no tests" for every mutation.** Python's `subprocess` resolved a bare `node` to the global Node 24: Windows looks up a bare program name through the parent's PATH, not the env passed in. better-sqlite3 then failed with NODE_MODULE_VERSION 127 vs 137. The runner now calls Node 22.16.0 by absolute path, and the control mutation passes 4/4. No result from the bad batch was used.
- **Mutation M2 (temp-folder check removed) let db.ts create `test/realpath/refused-22668.db`.** That is exactly what the guard prevents. The file was made by my own RED run, had no -wal or -shm beside it, was deleted and was never staged.
- **After the S1 restore, a sha256 comparison of `src/telegramListener.ts` against `git show HEAD:` differed.** The working copy is CRLF (`core.autocrlf=true`, 136 lines, 136 extra bytes) and the blob is LF. Git Bash's grep hides the CRs. `git hash-object` equals the HEAD blob and `git diff -- src` is empty, so src is unchanged.
- **Two shell heredocs carrying test code failed to parse in the Bash tool.** Neither had run anything. The text went through scratch files instead.
- Git's "LF will be replaced by CRLF" notices on commit come from `core.autocrlf=true`; the blobs are LF.

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- **23-06 (AUD-BUY-001, AUD-BUY-006)** can now do three things. It can run the real buy in a railed child on the test's temp file, with `ETH_RPC_URL`/`ETH_WS_URL` from `serveLoopback`. It can arm anti-rug over the real socket, with `node.waitForSubscriptions(n)` raced against the child's end. It can deliver Telegram messages to the real allowlist handler with `deliverTelegramMessage` under `stepUntil`. A child on real time needs `node.autoMine({ confirmations })` for its public transactions.
- **23-07 (AUD-EXIT-015)** can call `restartGraph(sc)` on a `createTempDbFile()` scenario, then the real resume paths (`resumeMultiChainMonitoring`, `resumeAntiRugMonitoring`) itself.
- Facts later plans must know:
  - `restartGraph` clears every fake timer and ends holds.
  - A restart keeps alerts, logs and the timeline, while `createScenario` empties them.
  - The memory-mode graph refuses a `DB_PATH` override.
  - Each railed child's ledger is its own case folder; read it with the `takeCaseLedger` pattern in harnessRestart.test.ts.
- **From now until the phase ends, the Harness Gap Procedure in 23-27-PLAN.md applies:** triage and scenario plans read `test/realpath/harness/` and never write it. Plan 23-20 adds only `serializer.ts`.

## Self-Check: PASSED

- Files present: test/realpath/harness/{loopback,telegram,world,chain,setup}.ts, test/realpath/fixtures/{sharedDbChild,wsSubscribeChild}.ts, test/realpath/harnessRestart.test.ts, test/realpath/harnessTelegram.test.ts.
- Commits on this branch: 6bc5c87, 1c2519c and 384be2f are ancestors of HEAD. `git rev-list --count b9f9c7f..384be2f` = 3.
- Acceptance criteria of all three tasks and the plan-level verification were re-run after the last commit and pass.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*
