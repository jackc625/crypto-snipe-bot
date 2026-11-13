---
phase: 23-test-safety-net-harness-triage-characterization
plan: 12
subsystem: testing
tags: [vitest, ethers, ws, flashbots, express, child-process, spawnRailedChild, realpath-harness, triage, knownBug, audit-register, crash-class, uncaughtException, unhandledRejection]

requires:
  - phase: 23-02
    provides: knownBug marker, the AC-02 mock-list gate
  - phase: 23-04
    provides: set-triage.ts, check.ts triage rules, the frozen triage population
  - phase: 23-27
    provides: the case-ledger check pattern for railed children, the Harness Gap Procedure (no gap was raised)
provides:
  - "Four crash-class findings proven as real process deaths in railed child processes, each through the src path the finding names: AUD-ANTIRUG-002 (4 sites), AUD-TX-009, AUD-BUY-005, AUD-API-008; 18 tests, 7 knownBug claims, a healthy control and a contained case per proof"
  - "Triage outcomes: all four confirmed (S1), each note carrying the Phase 24 reading that the cross-file mutation batch checked"
  - "fixtures/loopbackChain.ts (a standalone loopback node, Flashbots relay and separately closable real ws port for child processes, plus the shared crash-fixture contract) and fixtures/crashRun.ts (six result classes, the stderr death signal, the case-ledger check)"
affects: [23-16, phase-24, phase-29]

actuals:
  tokens: 25737    # chars/4 over the added lines of a01a0c5..be48d27 (17 files, 102948 chars)
  tasks: 3
  commits: 5       # MEASURED: git rev-list --count a01a0c5..HEAD before this SUMMARY commit
plan_head_before: a01a0c556e2af42cff02610c405ee76cb66e3f6b
plan_head_after: be48d279a49db4ab6afab7fe8a7ba701f8d259b2
commits: 5

tech-stack:
  added: []
  patterns:
    - "A crash proof is a railed child that loads src/main and src/bot with literal await import(), builds the context with the real buildChainRegistry and createChainContext, and reaches the fault only through the src path the finding names; the fixture supplies only the outside world (loopback ports and answers a real node gives)"
    - "Three modes per proof: fault (the trigger), healthy (the same src path without the fault, must survive) and contained (the fault with process handlers registered first, which shows whether the outcome flips and what a process-level handler alone does not recover)"
    - "Survival means working: a rising timer plus one independent JSON-RPC call through the bot's own provider (FIXTURE_LIVE), and WORK_SETTLED or WORK_PENDING for the operation under test; the parent classifies every run into exactly one of six classes"
    - "The stderr death signal is read only when the process ended; a surviving process's stderr is logging"
    - "A fault that needs the endpoint back to judge recovery reopens it after a margin (WebSocket port reopened 4 s after the trigger), so a correct fix can read looks fixed rather than work pending"
    - "Blocks come by the chain's own clock, not by the bot's requests, so a fix that stops polling still sees the chain move"

key-files:
  created:
    - test/realpath/triage/AUD-ANTIRUG-002.test.ts
    - test/realpath/triage/AUD-TX-009.test.ts
    - test/realpath/triage/AUD-BUY-005.test.ts
    - test/realpath/triage/AUD-API-008.test.ts
    - test/realpath/triage/fixtures/loopbackChain.ts
    - test/realpath/triage/fixtures/wsReconnectRefused.ts
    - test/realpath/triage/fixtures/bundleWaitCrash.ts
    - test/realpath/triage/fixtures/unhandledRejectionCrash.ts
    - test/realpath/triage/fixtures/hostHeaderCrash.ts
    - test/realpath/triage/fixtures/crashRun.ts
    - .planning/phases/23-test-safety-net-harness-triage-characterization/deferred-items.md
  modified:
    - .planning/audit/findings/AUD-ANTIRUG-002.json
    - .planning/audit/findings/AUD-TX-009.json
    - .planning/audit/findings/AUD-BUY-005.json
    - .planning/audit/findings/AUD-API-008.json
    - test/unit/realpathMockGate.test.ts
    - test/realpath/triage/AUD-EXIT-003.test.ts

key-decisions:
  - "All four entries confirmed on the real path as process deaths (exit code 1 with the finding's own error), each with its Phase 24 reading in the triage note"
  - "A process-level handler alone is not a fix for AUD-ANTIRUG-002 (the failed socket never emits 'close', so anti-rug and the DEX listeners stay silently disconnected) or AUD-API-008 (the malformed request is never answered or closed); it does recover AUD-TX-009 (the Flashbots library re-checks on the next block) and AUD-BUY-005 (the listener keeps dispatching). Measured in the contained cases and in the cross-file batch with a handler installed when src/bot loads"
  - "No HARNESS GAP: nothing under test/realpath/harness/ was needed; the fixtures bring their own loopback chain"
  - "No new register entry, no severity change, no status change"

patterns-established:
  - "Scratch runners in the session scratchpad: runchild.ts (one fixture run through the real railed spawner), medit.cjs with mutate.sh (atomic fix-shaped src mutation, test run, byte-exact restore proven by git hash-object on every run, trap on exit), batch.sh (every mutation against all four files), rep.sh with repcmp.cjs (three JSON-reporter runs compared)"

requirements-completed: [AUDIT-02]

coverage:
  - id: D1
    description: "AUD-ANTIRUG-002: a refused WebSocket connect ends the process (exit 1, Error: connect ECONNREFUSED) at all four named sites: the anti-rug reconnect, the V3 and V2 DEX reconnects and the boot connect; healthy controls reconnect; the contained case survives with anti-rug never reconnecting"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-ANTIRUG-002.test.ts (9 tests; each site's fix-shaped mutation reads looks fixed on its own claim only)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUD-TX-009: one null answer for the target block during the real FlashbotsMevStrategy's bundle.wait() ends the process (exit 1, Error: Unable to get block: 101); healthy returns the broadcast hash; contained recovers on block 102"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-TX-009.test.ts (3 tests; replacing bundle.wait() with the helper's own reconcile, and a bot-load handler, each read looks fixed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUD-BUY-005: a bad ETH_MIN_LIQUIDITY rejects the un-awaited V3 handler on the first pool pushed to the real listener and the process exits (TypeError: invalid FixedNumber string value); healthy skips both pools below the minimum; contained keeps dispatching"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-005.test.ts (3 tests; a .catch at the listener's call, with or without stderr logging, and a bot-load handler each read looks fixed)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUD-API-008: one unauthenticated GET /ws with Upgrade: websocket and Host 'a b' to the real startApiServer ends the process (TypeError: Invalid URL at handler.ts:43); a valid Host is answered 401; contained survives but the request is never answered or closed"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-API-008.test.ts (3 tests; a try around the URL parse answering 400 reads looks fixed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "AC-48: no test passes on answers a real node could never give (a lagging load-balanced backend answers null for a just-mined block once; the nonce counts mined transactions; blocks come by the chain's clock; the QuoterV2 thin-pool revert is geth's no-data revert; a closed port refuses)"
    verification: []
    human_judgment: true
    rationale: "The plan family marks this prohibition as judgment: review of fake transport data"

duration: 75min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 12: Crash-Class Findings as Real Process Deaths Summary

**Four ways one ordinary fault kills the whole bot, each shown as a real process death through the bot's own code.** Every death takes every exit monitor and anti-rug watcher on every chain with it, until someone restarts the bot:
- **WebSocket refused (AUD-ANTIRUG-002):** a refused connect at any of the four places the bot opens one (anti-rug reconnect, V3 and V2 pool listener reconnects, boot).
- **Missing block (AUD-TX-009):** one "no such block" answer while a Flashbots bundle waits for inclusion.
- **Pool-handler rejection (AUD-BUY-005):** one bad setting value that makes the new-pool handler fail.
- **Malformed request (AUD-API-008):** one request with a malformed Host header, sent to the dashboard without logging in.

**What this means for the Phase 24 fixes (measured, not assumed):**
- **Not enough on its own for WebSockets (AUD-ANTIRUG-002):** a process-wide catch-all keeps the bot running, but anti-rug never reconnects. It reports itself connected.
- **Not enough on its own for the dashboard (AUD-API-008):** the bad request is never answered, so each one leaves a socket open.
- **Enough for the other two:** the bundle wait recovers on the next block (AUD-TX-009), and the pool listener keeps working (AUD-BUY-005).

## Performance

- **Duration:** about 75 min (2026-11-11T23:14:02Z to 2026-11-12T00:29:32Z)
- **Tasks:** 3 of 3.
  - **Task 1 tracer gate:** interactive, end-of-phase mode, automated-only verify. The verify was re-run on the committed tree and passed, then Task 2 started.
- **Files:** 17. That is 11 created (4 test files, 6 fixtures, deferred-items.md) and 6 modified (4 findings, 2 test files given an explicit limit).

## Per-finding outcomes

| Finding | Sev | Outcome | Test file and claims | What was proven | Left open |
|---|---|---|---|---|---|
| AUD-ANTIRUG-002 | S1 | confirmed | AUD-ANTIRUG-002.test.ts: `detector-refused-reconnect-exits`, `dex-v3-refused-reconnect-exits`, `dex-v2-refused-reconnect-exits`, `boot-refused-connect-exits` | **Setup:** the loopback chain ends the bot's sockets from the server side and closes the WebSocket listener. **Result:** each site's own reconnect (or the boot getWsProvider) is refused, and the process exits with code 1 and `Error: connect ECONNREFUSED`. **Before the refusal:** each reconnect loop has already logged that it reconnected, because the provider constructor does not throw. | The live-socket protocol-error path (receiverOnError) stays code-read |
| AUD-TX-009 | S1 | confirmed | AUD-TX-009.test.ts: `bundle-wait-null-block-exits` | **Setup:** the real FlashbotsMevStrategy.sendTransaction runs on a loopback node and relay, and reaches its own bundle.wait(). **Fault:** the first eth_getBlockByNumber(101) answers null. **Result:** exit 1 with `Error: Unable to get block: 101`, about 4 to 8 s after the first send. | Nothing |
| AUD-BUY-005 | S1 | confirmed | AUD-BUY-005.test.ts: `v3-listener-unhandled-rejection-exits` | **Setup:** the real V3 listener gets a real-encoded PoolCreated and a same-block Mint. **Fault:** ETH_MIN_LIQUIDITY=abc makes the un-awaited handleNewV3PoolForChain reject in checkMinLiquidity. **Result:** exit 1 with `TypeError: invalid FixedNumber string value`. | The other un-awaited sites (V2 listener, both HTTP poll dispatches, the poll starter, startMultiChainBot, two setIntervals, two close handlers): not separately exercised, listed in the note |
| AUD-API-008 | S1 | confirmed | AUD-API-008.test.ts: `malformed-host-upgrade-exits` | **Setup:** the real startApiServer([]) runs on a loopback port. **Request:** a raw GET /ws with Upgrade: websocket and Host `a b`, no credentials. **Result:** exit 1 with `TypeError: Invalid URL`, thrown at src/api/ws/handler.ts:43. | AUD-API-009 (invalid frame on an open socket) is its own finding |

**What each control showed:**

| Finding | Healthy control | Contained case (process handlers first) |
|---|---|---|
| AUD-ANTIRUG-002 | Port open: every site survives and reconnects (the DEX listeners re-subscribe). Bot socket readyState 1. | Detector: survives, but anti-rug never reconnects after the port reopens 4 s later (`survived-work-pending`). **Why:** ws's emit('error') throws before it can emit 'close', so the socket stays CLOSING (readyState 2) and no close handler runs again. The loop already exited believing it reconnected. |
| AUD-TX-009 | Block 101 answered from the start: sendTransaction returns the broadcast hash. | Survives and settles. The library's handler stays registered after its throw, runs again on block 102 and finds block 101 included. |
| AUD-BUY-005 | ETH_MIN_LIQUIDITY 0.5: both pools are quoted (the quote reverts) and skipped below the minimum. | Both pools' rejections reach the handler, the listener keeps dispatching, and the process survives. |
| AUD-API-008 | A valid Host is answered `HTTP/1.1 401 Unauthorized` and the socket closed. | Survives, but the request is never answered and its socket never closed (`survived-work-pending`). |

None of these entries is unreproduced or NOT-A-BUG.

## Task Commits

1. **Task 1 (tracer): AUD-ANTIRUG-002, with the shared loopback chain and the parent helper** - `24d47e1` (test)
2. **Task 2: AUD-TX-009 and AUD-BUY-005** - `a08f8e2` (test)
3. **Task 3: AUD-API-008** - `3a449f5` (test)
4. **The stderr death signal read only when the process ended (found by the cross-file batch)** - `f1a8ad5` (test)
5. **Explicit limits on two tests the new load pushed toward their limits, and deferred-items.md** - `be48d27` (test)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## New findings and grade/status changes

None. No new register entry, no severity change, no status change (all four stay `confirmed` S1).

**Observed, not asserted as new bugs (each belongs to an existing entry):**
- **False "reconnected" before the refusal (AUD-ANTIRUG-002).** Each reconnect loop counts a refused connect as a success: the detector logs `antirug.ws.reconnected`, sets its health to connected and broadcasts it; the DEX loops log "WebSocket reconnected".
- **Today the false status is moot, because the process dies.** Under a handler-only fix it would persist, with anti-rug silently offline. That reading is in the AUD-ANTIRUG-002 note.
- **Socket leak under a handler-only fix (AUD-API-008).** The contained case shows each malformed request would leave one socket open. That reading is in the AUD-API-008 note.

## Files Created/Modified

**Test files**, under `test/realpath/triage/`:
- **AUD-ANTIRUG-002.test.ts:** 9 tests, 4 knownBug claims.
- **AUD-TX-009.test.ts, AUD-BUY-005.test.ts and AUD-API-008.test.ts:** 3 tests each, 1 knownBug claim each.
- **How each test runs:** it starts its fixture only through `spawnRailedChild('node', ['-r', 'ts-node/register/transpile-only', <fixture>, ...], { timeoutMs: 110_000, ledgerRunId })`, with a 120 s test limit. It then checks the child's own case ledger: rails started, loopback only, nothing denied.

**`fixtures/loopbackChain.ts`:**
- **HTTP endpoint:** a real HTTP JSON-RPC node, with the Flashbots relay on the same port.
- **WebSocket port:** a separate real `ws` port. `dropSockets({ closePort })` ends every socket and can close the listener; `reopenWs()` listens again on the same port.
- **Encoding:** every value is built by real ethers encoders.
- **Per-run options:** the target-block answer, the logs `eth_getLogs` returns, an `eth_call` answer, a first-`eth_sendBundle` callback, and request/answer observers.
- **Strictness:** an unknown method or an unanswered `eth_call` is FIXTURE_SETUP_ERROR, exit 3.
- **Shared fixture contract:** installContainment, startTicker, finishAlive (heartbeat and markers) and runFixture.

**The four fixtures:**

| Fixture | Real entry point | Markers |
|---|---|---|
| wsReconnectRefused.ts | startChainAntiRugListener, startDexListener (V3, V2), getWsProvider | BOOT_CONNECT_ATTEMPTED, ARMED, TRIGGER, WS_REOPENED, BOT_WS_STATE |
| bundleWaitCrash.ts | FlashbotsMevStrategy.sendTransaction | RELAY_BUILDERS_SEEN, FIRST_SEND_BUNDLE, MINED, BLOCK_101_NULL_SERVED, SEND_RESOLVED |
| unhandledRejectionCrash.ts | startDexListener V3 (the handler is never called by the fixture) | POOL_PUSHED, MINT_QUERIED, QUOTER_CALLED |
| hostHeaderCrash.ts | startApiServer([]) | RAW_REQUEST_SENT, RAW_RESPONSE, RAW_SOCKET_CLOSED |

**`fixtures/crashRun.ts`:** the parent side.
- **classify:** sorts each run into survived, survived-work-pending, process-exited, signal-terminated, timeout or setup-error. Any other combination throws, naming it.
- **actualOf:** builds `{ outcome, exited, code, stderrSignal }`.
- **CORRECT and exitedWith:** the correct and observed values.
- **Other helpers:** the case-ledger check and the run description used in failure output.

**Register and test edits:**
- **`.planning/audit/findings/*.json`:** triage blocks on the four entries, written with set-triage.ts.
- **AUDIT-FINDINGS.md:** re-rendered. Byte-unchanged, because no status changed.
- **OPERATOR-DECISIONS.md and SEAL.json:** untouched.
- **`test/unit/realpathMockGate.test.ts` and `test/realpath/triage/AUD-EXIT-003.test.ts`:** one explicit limit each, with the measured times in a comment. No assertion changed, and neither file has a ledger row (partial still passes).
- **`deferred-items.md`:** one out-of-scope near-limit test.

## Decisions Made

See `key-decisions`.
- **Every claim measures the harm (the process ending)**, so a fix at the site and a fix by a process handler are both judged.
- **The contained cases record what a handler alone does not recover.**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correct D-08 signal] WebSocket fault and contained modes reopen the port 4 s after the trigger; window 12 s, not 6 s**
- **Found during:** Task 1 design.
- **Issue:** with the port closed for the whole window, a correctly fixed bot would stay in backoff and never reconnect. It would read "survived-work-pending", so the claim would fail as "the failure changed" instead of "looks fixed".
- **Fix:** the listener reopens 4 s after the trigger. Today's first attempt is due at 1 s, leaving a 3 s margin. The 12 s window covers today's backoff schedule (attempts at 1, 3 and 7 s).
- **Measured result:** the contained case then showed the real recovery limit (anti-rug never comes back).
- **Committed in:** 24d47e1.

**2. [Rule 1 - Wrong assumption, measured] "Work settled" for a WebSocket is an open connection, not an answered request**
- **Found during:** Task 1, the first fixture run timed out.
- **Measured:** a WebSocketProvider given its chain ID sends nothing until asked.
- **Fix:** a reconnect is judged by a connection accepted after the trigger being open at the window's end. The DEX listeners must also have re-made their `logs` subscription.
- **Boot:** judged by its connect attempt having finished, either OPEN or cleanly CLOSED, because nothing at boot re-attempts a WebSocket.
- **Committed in:** 24d47e1.

**3. [Rule 2 - AC-48 and D-08] AUD-TX-009's chain mines by its own clock, its nonce counts mined transactions, and the window is 40 s, not 25 s**
- **First design:** mining was driven by the bot's own eth_blockNumber, and the nonce always answered 0.
- **Problem:** a real node does neither. The recommended fix (the helper's own receipt and nonce reconcile, no block polling) would then never see the transaction land.
- **Fix:** block 101 is mined 2 s after the first eth_sendBundle and block 102 12 s later. Answering null once on the first request for 101 keeps the fault deterministic, even if the wait's first poll were late (block 102's handler re-asks for 101).
- **Window:** 40 s, so block 102 seen by a 4 s poll fits with margin. The run still ends early once sendTransaction settles.
- **Committed in:** a08f8e2.

**4. [Rule 2 - Observable work] AUD-BUY-005's work marker is the listener's next dispatch**
- **Why:** handleNewV3PoolForChain is called by src and cannot be awaited from outside.
- **Fix:** 3 s after the first pool the chain pushes a second one. WORK_SETTLED is printed once the bot's Mint query for it arrives, so a fix that contains the rejection inside src can read "looks fixed".
- **Committed in:** a08f8e2.

**5. [Rule 2 - Stronger path check] AUD-API-008 also requires the real server's own "Dashboard API server started" line**
- **Why:** with only RAW_REQUEST_SENT, a run where the real startApiServer never bound its port could pass the path check.
- **Committed in:** 3a449f5.

**6. [Rule 1 - Bug in my own helper] The stderr death signal is read only when the process ended**
- **Found by:** the cross-file batch. A process-level handler that prints the caught error to stderr made surviving AUD-TX-009 and AUD-BUY-005 runs read "the failure changed".
- **Fix:** `actualOf` reads the signal only when FIXTURE_SURVIVED is absent.
- **Re-measured:** the bot-load handler and a stderr-logging site fix both read "looks fixed".
- **Committed in:** f1a8ad5.

**7. [Rule 3 - Shared helper] `fixtures/crashRun.ts` added (not in files_modified)**
- **Why:** the six-class classification, the signal and the ledger check are shared by four test files.
- **Kept per file:** each test file still calls spawnRailedChild itself, in the plan's exact form.
- **Committed in:** 24d47e1.

**8. [Rule 2 - Clear fix signal] Each contained control says "looks fixed" plainly when no process handler is reached and the run survives**
- **Why:** under a real fix the contained control would otherwise fail on an unexplained detail.
- **Committed in:** 24d47e1, a08f8e2, 3a449f5.

**9. [Rule 3 - Blocking, caused by this plan's load] Two existing tests given explicit limits**
- **realpathMockGate "passes the real test/realpath folder":**
  - **Failure:** timed out under the first full run at 5483 ms against the 5 s unit default.
  - **Measured:** 1.3 to 1.5 s alone. Its scan grew by this plan's 10 files, and this plan's child processes load the run.
  - **Fix:** explicit 20 s limit.
- **AUD-EXIT-003 "zero-entry-nan-ratio-fires-stop-loss":**
  - **Measured:** 2.1 s alone, 10.2 s under the full run against the 15 s default.
  - **Fix:** explicit 60 s limit.
- **Unchanged:** no assertion in either test.
- **Committed in:** be48d27.

---

**Total deviations:** 9 (Rule 1: 2, Rule 2: 5, Rule 3: 2). **Impact:**
- Every change makes the proofs more faithful to a real chain, or makes the D-08 "looks fixed" signal fire for real fixes.
- `src/` is unchanged.
- Nothing under `test/realpath/harness/` was written, and no HARNESS GAP was raised.

## Issues Encountered (all diagnosed)

**My own scratch-tooling errors, each caught and recovered:**
- **A runner that did not restore src.** The first mutation runner computed its file list from an MSYS path and did not restore src after the detector mutation.
  - **Restored at once:** `git -c core.autocrlf=false checkout`, then `git hash-object` IDENTICAL to the HEAD blob.
  - **Runner fixed:** a trap that restores every candidate src file, with a hash proof, on every exit.
- **A mutation that did not compile.** The first AUD-API-008 fix-shaped mutation put real line breaks into a string literal, because doubled backslashes are halved on the way into bash here.
  - **The fixture's verdict:** a setup error, a real failure, never a pass.
  - **Fix:** the mutation was regenerated with the backslash built from its character code.
- **A type error in the TX-009 fixture.** It narrowed a callback-assigned `let` to null; fixed with a holder object.

**Warning and error lines the children print, all expected:**
- `RAIL_NOTIFIER_REFUSED`: the rails refusing the bot's Telegram alerts (DEX close handlers, the below-minimum branch).
- `WebSocket upgrade rejected: invalid session`: the healthy AUD-API-008 control's 401.
- `V3 reconnect failed, will retry`: only under the fix-shaped mutation.
- The parent tests print child output only on failure (onTestFailed).

**Plan expectation versus measurement:**
- The plan expected AUD-TX-009's contained case to stay work-pending ("a bundle.wait() whose listener died").
- **Measured:** the library's handler is not removed after its throw, so it re-checks on the next block and the wait resolves. The test asserts the measured result, and the note records it.

**Register bookkeeping:**
- **`--stage final`:** keeps the Phase 22 bookkeeping FAILs for Phase 23 files, which are out of scope per 23-04.
- **Line endings:** git's "LF will be replaced by CRLF" notices come from `core.autocrlf=true`; the blobs are LF.

## Verification (exact commands, Node 22.16.0 via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

**Task verifies:**
- **Task 1:** the plan's command gave 9/9, the three grep checks passed, `--slice ANTIRUG` PASS, and the triage block was present. Re-run on the committed tree as the tracer gate: PASS.
- **Task 2:** AUD-TX-009 and AUD-BUY-005 gave 6/6; `--slice TX` and `--slice BUY` PASS; both triage blocks present. unhandledRejectionCrash.ts has 0 calls of `handleNewV3PoolForChain(`; bundleWaitCrash.ts calls `new FlashbotsMevStrategy` and `strategy.sendTransaction`.
- **Task 3:** 3/3; `--slice API` PASS; triage block present; `startApiServer` in the fixture.
- **Every task:** `git status --porcelain src` was empty.

**Full railed suite (`npm test -- --reporter=json --reporter=default`, on the committed tree be48d27):**
- **Result:** 193 files, 1387 tests: 1387 passed, 0 failed, 0 skipped, 0 todo, 0 unhandled errors (run run-20261112T002609-8188-070c96).
- **By project:** unit 944, integration 263, realpath 180. That is 1369 at 23-11 plus this plan's 18.
- **Rails ledger:** `nonLoopbackAllowed` 0, `telegramAllowed` 0.
- **The first full run (before be48d27):** 1386 of 1387. The one failure was the realpathMockGate timeout, diagnosed and fixed as deviation 9.
- **This plan's tests under the full run, in s:**
  - AUD-ANTIRUG-002: faults 10.7, 10.6, 8.1, 7.5; healthy 19.1, 20.0, 19.5, 19.2; contained 16.2.
  - AUD-TX-009: 14.2, 13.5, 24.7.
  - AUD-BUY-005: 9.7, 17.9, 16.0.
  - AUD-API-008: 9.4, 13.3, 11.0.
  - Every one is under half its explicit 120 s limit.
- **Alone:** AUD-ANTIRUG-002's file takes about 85 s for its 9 children.

**Repeatability (AC-10):** the four files ran three times with the JSON reporter. Each run had 18 tests (all passed) and 7 knownBug records, identical in titles, statuses and every record:
- AUD-ANTIRUG-002, all four claims: `{ outcome: process-exited, exited: true, code: 1, stderrSignal: "Error: connect ECONNREFUSED" }`.
- AUD-API-008: `"TypeError: Invalid URL"`.
- AUD-BUY-005: `"TypeError: invalid FixedNumber string value"`.
- AUD-TX-009: `"Error: Unable to get block: 101"`.

**Gates and type checks:**
- `tsc --noEmit` exits 0 on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json.
- The scratch tsconfig extending the repo's (test/realpath/triage/**/*.ts, module esnext): exit 0.
- `npm run check:realpath-mocks` (run as ts-node scripts/check-realpath-mocks.ts): 35 vi uses (7 mock calls) in 84 files, 0 violations.
- `check:vi-mock`: 591 mock calls in 258 files, 0 violations.
- spawnSites gate: 5/5.

**Register:**
- `check.ts --stage partial`: PASS, fail 0, pending 60. `--stage consolidation`: PASS.
- `--stage triage`: 60 FAILs, all expected:
  - 12 population entries other plans have not recorded (16 before this plan, minus its 4);
  - 42 S0/S1 acknowledgements owed to 23-16 (38 before, plus this plan's 4);
  - 4 `fork_ref`s (AUD-BUY-015, AUD-BUY-033, AUD-EXIT-003, AUD-ANTIRUG-003);
  - AUD-TX-006's keep-open ruling;
  - the run-evidence file.

**src and fix signals:**
- `git status --porcelain src` was empty at every commit and after every mutation.
- Every mutation was restored with `git -c core.autocrlf=false checkout`, and `git hash-object` was IDENTICAL to the HEAD blob each time.
- The cross-file batch ran every mutation against all four files (18 tests). Each "contained" entry below is that finding's own contained control, saying "looks fixed".

| Mutation | Result |
|---|---|
| none | all 18 pass |
| detector handleWsClose waits for open or error, a refusal stays in backoff | `detector-refused-reconnect-exits` and its contained control look fixed; the other 16 pass |
| bot.ts handleWsCloseV3, the same | `dex-v3-refused-reconnect-exits` looks fixed; 17 pass |
| bot.ts handleWsClose (V2), the same | `dex-v2-refused-reconnect-exits` looks fixed; 17 pass |
| provider.ts getWsProvider adds an error listener | `boot-refused-connect-exits` looks fixed; 17 pass |
| flashbots.ts: no bundle.wait(), the helper's own receipt and nonce reconcile decides | `bundle-wait-null-block-exits` and its contained control look fixed; 16 pass |
| bot.ts V3 listener `.catch()` on the handler call | `v3-listener-unhandled-rejection-exits` and its contained control look fixed; 16 pass |
| the same `.catch()` logging to stderr | the same two look fixed; the other 4 in the two files run pass |
| handler.ts parses the URL in a try and answers 400 | `malformed-host-upgrade-exits` and its contained control look fixed; 16 pass |
| process handlers installed when src/bot loads (rule 6 reading) | AUD-TX-009 and AUD-BUY-005 look fixed (after f1a8ad5); the four AUD-ANTIRUG-002 claims and AUD-API-008 fail as "the failure changed" (survived-work-pending); every contained and healthy control passes |

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## For 23-16

- **Acknowledge** the four S1 entries confirmed here in the S0/S1 batch report: AUD-ANTIRUG-002, AUD-API-008, AUD-TX-009 and AUD-BUY-005.
- **Plain-language consequence for the operator (the contained cases):** a process-wide catch-all is not enough for the WebSocket and dashboard crashes.
  - The bot would stay up with anti-rug silently disconnected (AUD-ANTIRUG-002).
  - Each malformed request would leave a socket open (AUD-API-008).
- **Run evidence:** collect the 7 knownBug records from the four files. No `fixed` outcome here, so this plan adds no integration-run requirement.
- **No `needs_fork`:** every entry is proven on loopback.

## Next Phase Readiness

**Phase 24 (cards OD-6 and OD-11):**
- Each file runs alone as a before-and-after proof. The fix shapes each claim sees are in each test header, each triage note and the batch table above.
- **AUD-ANTIRUG-002:** the fix must keep a refused connect inside the backoff loop with an error listener, at all four sites. A process handler alone reads "the failure changed".
- **AUD-API-008:** the URL parse must be guarded and answered with 400.
- **AUD-BUY-005:** proven at one trigger only. A fix that just validates ETH_MIN_LIQUIDITY at load removes the trigger, not the un-awaited call: the claim then fails as "the failure changed" and needs another trigger on the same call.

**Later triage plans:**
- `fixtures/loopbackChain.ts` and `fixtures/crashRun.ts` serve any railed-child proof that needs its own chain. Reuse them rather than duplicating.
- `test/unit/bot/buyNonceLock.test.ts` "exposes submitBuyTx" runs at 3.2 to 4.1 s of its 5 s limit (the cold src/bot import), logged in deferred-items.md.

## Self-Check: PASSED

- **Files found:** the four triage test files and six fixtures under test/realpath/triage/; deferred-items.md. The four findings carry `confirmed` triage blocks with their own test_id.
- **Commits found on this branch:** 24d47e1, a08f8e2, 3a449f5, f1a8ad5 and be48d27 (`git rev-list --count a01a0c5..HEAD` = 5 before this SUMMARY).
- **Re-run after the last commit:** every task's acceptance criteria and the plan-level verification pass. That is all four files on Node 22, `npm run check:realpath-mocks` 0 violations, and `check.ts --stage partial` PASS for ANTIRUG, TX, BUY and API.
- **Clean tree:** no scratch file under test/ or src/; `git status --porcelain src data` is empty. The operator's own `.planning/config.json` and `.planning/state.json` changes are left modified and unstaged.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*
