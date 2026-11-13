---
phase: 23-test-safety-net-harness-triage-characterization
plan: 10
subsystem: testing
tags: [vitest, ethers, realpath-harness, triage, knownBug, audit-register, anti-rug, websocket, reconnect, circuit-breaker, backfill, http-polling, dashboard]

requires:
  - phase: 23-01
    provides: FakeNode dropSocket, failNext and hold with exact targets and fired checks, the subscription list with each subscription's socket, createScenario, the fixed clock
  - phase: 23-28
    provides: createScenario for ETH V2, mine({ include, logs }), the Flashbots route
  - phase: 23-02
    provides: knownBug marker, recordedLogs/recordedAlerts, harnessState().broadcasts, the AC-02 mock-list gate
  - phase: 23-27
    provides: createTempDbFile, restartGraph, the Harness Gap Procedure (no gap was raised)
  - phase: 23-04
    provides: set-triage.ts, check.ts triage rules
  - phase: 23-06
    provides: fixtures/AUD-BUY-011-dashboard.ts (the real dashboard on a loopback port)
  - phase: 23-07
    provides: fixtures/AUD-EXIT-002-position.ts and fixtures/AUD-EXIT-001-sell-path.ts
  - phase: 23-08
    provides: fixtures/AUD-API-001-dashboard-sell.ts (heldPosition, driveChain, openDashboard) and fixtures/AUD-EXIT-014-rug.ts (pullLiquidity)
  - phase: 23-09
    provides: fixtures/AUD-TX-002-lock.ts (settleAntiRugArming) and fixtures/AUD-TX-003-second-launch.ts
provides:
  - "Nine real-path triage files (AUD-API-002, AUD-ANTIRUG-001, AUD-BUY-008, AUD-ANTIRUG-003, -004, -005, -024, -018 and the new AUD-BUY-036): 15 tests, 13 knownBug claims; each claim reads looks fixed under its own fix-shaped src mutation, and a full cross-file batch shows every mutation flips only its own claims"
  - "Triage outcomes for the six plan findings and the two orchestrator-added population entries (AUD-ANTIRUG-024, AUD-ANTIRUG-018), all confirmed; AUD-ANTIRUG-003 carries needs_fork"
  - "fixtures/AUD-API-002-restart.ts (bootListeners, a source-pinned mirror of the private src/bot.ts onRestart, the real dashboard with that Start callback), fixtures/AUD-ANTIRUG-003-live.ts (live anti-rug gates, the breaker module, afterExitPoll, a bounded chain driver) and fixtures/AUD-ANTIRUG-018-range-limit.ts (a provider that refuses an over-range eth_getLogs, decided per request)"
  - "One new register entry graded under the standing instruction: AUD-BUY-036 (S3, capital none)"
affects: [23-16, phase-24, phase-29]

actuals:
  tokens: 32683    # chars/4 over the added lines of 7e4b7b5..34aa4e8 (24 files, 130730 chars, incl. the AUDIT-FINDINGS.md renders)
  tasks: 3
  commits: 7       # MEASURED: git rev-list --count 7e4b7b5..HEAD before this SUMMARY commit
plan_head_before: 7e4b7b500aa16da314f65acd77fdffa1afff479b
plan_head_after: 34aa4e8b51c11485b74603d02764e382cb876cd5
commits: 7

tech-stack:
  added: []
  patterns:
    - "A private closure a test cannot reach without a full boot (src/bot.ts onRestart) is driven through a line-for-line mirror pinned by a sha256 of the closure's source text; any edit to the closure fails the dependent tests by name ('onRestart changed'), never a silent stale pass"
    - "A provider rule that depends on the request (an eth_getLogs block-range limit) is expressed with the public FakeNode.failNext: its after predicate reads the call being matched as the last node.callLog entry (logged, then matched, with no await between) and throws if that order ever changes"
    - "A WebSocket outage is a server-side FakeNode.dropSocket(); provider identity is compared through each subscription's own socket on the node and the real ctx.wsProvider.websocket"
    - "A failed anti-rug escape is forced with a failure no other finding's fix removes (the node refusing the escape's approval), not with a held sell lock (AUD-EXIT-014's claim)"
    - "Bounded chain driving keeps one bundle-slot map for its whole window; an empty block is mined only while no bundle of the wallet waits"

key-files:
  created:
    - test/realpath/triage/AUD-API-002.test.ts
    - test/realpath/triage/AUD-ANTIRUG-001.test.ts
    - test/realpath/triage/AUD-BUY-008.test.ts
    - test/realpath/triage/AUD-ANTIRUG-003.test.ts
    - test/realpath/triage/AUD-ANTIRUG-004.test.ts
    - test/realpath/triage/AUD-ANTIRUG-005.test.ts
    - test/realpath/triage/AUD-ANTIRUG-024.test.ts
    - test/realpath/triage/AUD-ANTIRUG-018.test.ts
    - test/realpath/triage/AUD-BUY-036.test.ts
    - test/realpath/triage/fixtures/AUD-API-002-restart.ts
    - test/realpath/triage/fixtures/AUD-ANTIRUG-003-live.ts
    - test/realpath/triage/fixtures/AUD-ANTIRUG-018-range-limit.ts
    - .planning/audit/findings/AUD-BUY-036.json
  modified:
    - .planning/audit/findings/AUD-API-002.json
    - .planning/audit/findings/AUD-ANTIRUG-001.json
    - .planning/audit/findings/AUD-BUY-008.json
    - .planning/audit/findings/AUD-ANTIRUG-003.json
    - .planning/audit/findings/AUD-ANTIRUG-004.json
    - .planning/audit/findings/AUD-ANTIRUG-005.json
    - .planning/audit/findings/AUD-ANTIRUG-024.json
    - .planning/audit/findings/AUD-ANTIRUG-018.json
    - .planning/audit/ledger/BUY.json
    - .planning/audit/sweep/contrib-PHASE23.json
    - .planning/audit/AUDIT-FINDINGS.md

key-decisions:
  - "All six plan findings and both orchestrator-added entries recorded confirmed; none unreproduced and none NOT-A-BUG"
  - "No HARNESS GAP for AUD-ANTIRUG-018: the committed FakeNode.failNext can refuse an over-range eth_getLogs per request from the request's own range, so a chunked request (the fix) is answered, as a real provider answers it"
  - "The Start route's callback is a source-pinned mirror of src/bot.ts onRestart, because the real closure exists only inside startMultiChainBot and this phase never boots the bot"
  - "AUD-ANTIRUG-004's escape fails by a refused approval, not a held sell lock, so AUD-EXIT-014's fix cannot remove the failure the test needs"
  - "New AUD-BUY-036 (S3, capital none) registered by the executor under the standing instruction, without a stop"

patterns-established:
  - "Scratch runners in the session scratchpad: mutate.sh with medit.cjs (atomic, CRLF-normalised fix-shaped mutations, byte-exact restore and hash proof, a failed mutation restores every touched src file), batch.sh (every mutation against all plan files), logdump.sh with inject.cjs (a non-throwing afterEach that writes every warn/error/fatal line and the op trail to a file)"

requirements-completed: [AUDIT-02]

coverage:
  - id: D1
    description: "AUD-API-002: after the real dashboard Stop route the node holds no anti-rug subscription for the pair, a 95 percent liquidity pull is never evaluated and the dashboard is still told connected; after Stop and Start the factory listeners return but anti-rug does not"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-API-002.test.ts (2 tests; a Stop that removes only the factory listeners gives looks fixed on both)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUD-ANTIRUG-001 (AC-12): after one server-side socket drop the rug-log subscription sits off ctx.wsProvider, the next buy duplicates it so one LP log is evaluated twice, and the three replaced providers stay open"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-ANTIRUG-001.test.ts (3 tests; one cached provider for every reconnect loop gives looks fixed on all three)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUD-BUY-008 (AC-12): after a dashboard Stop and Start one socket close runs two reconnect loops per DEX; the control without a restart reconnects each DEX once"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-008.test.ts (2 tests; an idempotent close-handler registration gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUD-ANTIRUG-003 (AC-12): one real removal, the first exit held at its relay simulation, counts three triggers and trips the chain breaker; the real-removal log count is needs_fork"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-ANTIRUG-003.test.ts (1 test; one in-flight dispatch per position gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "AUD-ANTIRUG-004: an anti-rug escape whose approval the node refuses is never dispatched again within 2 minutes of fake time"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-ANTIRUG-004.test.ts (1 test; a gate that re-dispatches on a later block gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AUD-ANTIRUG-005: the reconnect backfill reaches triggerAntiRugExit and submits an anti-rug sell; a live dispatch leaves last_seen_block behind in the real DB"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-ANTIRUG-005.test.ts (2 tests; each claim's fix shape flips only that claim)"
        status: pass
    human_judgment: false
  - id: D7
    description: "AUD-ANTIRUG-024 and AUD-ANTIRUG-018 (orchestrator scope addition): the false GAP DETECTED of a fresh database's first start, and the HTTP anti-rug poller refused on every poll after an ordinary restart against a 10-block provider limit"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-ANTIRUG-024.test.ts and AUD-ANTIRUG-018.test.ts (2 tests; each fix shape gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D8
    description: "AUD-BUY-036 (new): after an RPC outage longer than the provider range limit the HTTP DEX poller is refused every poll and never finds a new pair"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-036.test.ts (2 tests; a windowed catch-up gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D9
    description: "AC-48: no test passes on answers a real node could never give (the range refusal follows the documented provider rule and is decided from each request's own range; the socket drop is a server-side close; the removal's logs follow UniswapV2Pair's order with real encoders)"
    verification: []
    human_judgment: true
    rationale: "The plan family marks this prohibition as judgment: review of fake transport data"

duration: 46min
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 10: Anti-Rug and WebSocket-Lifecycle Findings on the Real Path Summary

**All eight findings now fail on the real path, with every race forced by a real socket drop, holds, mined blocks and fake time:**
- Dashboard Stop silently removes anti-rug protection, and Start does not bring it back.
- One socket drop leaves the rug-log subscription on a provider the bot no longer uses. The next buy then doubles it, and three providers are left alive.
- A dashboard Stop and Start makes every DEX reconnect twice on the next drop.
- One liquidity pull counts three times and trips the chain's anti-rug circuit breaker.
- A failed anti-rug escape is never tried again.
- The backfill fires live exits against its own documented contract, and live dispatches never move the stored block cursor.
- A new database's first start sends a false GAP DETECTED alert.
- On a chain without a WebSocket URL, an ordinary restart leaves the HTTP anti-rug poller refused on every poll while the dashboard says connected.

**Found on the way, one new S3 entry, AUD-BUY-036:** the HTTP DEX poller has the same unchunked range. After an RPC outage longer than the provider limit it never sees a new pair again until a restart.

## Performance

- **Duration:** about 46 min
- **Started:** 2026-11-11T21:26:43Z
- **Completed:** 2026-11-11T22:12:30Z
- **Tasks:** 3 of 3, plus the orchestrator scope addition. Task 1 tracer gate (interactive, end-of-phase mode, automated-only verify): the verify passed on the committed tree, then Task 2 started.
- **Files:** 24 (12 test files created, 1 register file created, 11 register files modified)

## Per-finding outcomes

| Finding | Sev | Outcome | Test file and claim | What was proven | Left open |
|---|---|---|---|---|---|
| AUD-API-002 | S1 | confirmed | AUD-API-002.test.ts: `stop-disarms-antirug`, `start-does-not-rearm-antirug` | A real ETH V2 snipe through every DEX listener (as boot starts them), bought and armed. Its anti-rug subscription is on the node's own list, and a control LP transfer to a locker is evaluated. The real dashboard Stop route (real login, loopback, node:http) unsubscribes every subscription, the anti-rug filter included. One heartbeat later, right after an exit poll, a real 95 percent router pull is not evaluated within 3 s of fake time, and the last health broadcast still says connected. After Stop and Start, the factory listeners come back (one each) and anti-rug does not. | Sub-claim 3's dialog text (dashboard UI) stays code-read |
| AUD-ANTIRUG-001 | S1 | confirmed | AUD-ANTIRUG-001.test.ts: `reconnect-leaves-subscription-off-ctx-provider`, `second-registration-duplicates-dispatch`, `replaced-providers-left-alive` | The node closes every socket (`dropSocket`, 1006). The anti-rug loop and three DEX loops each build a provider. The rug-log subscription is on the anti-rug loop's socket, but ctx.wsProvider ends on a DEX loop provider. The next buy (token B on sushiswap-v2, after the 30 s snipe cooldown) adds a second subscription covering pair A on ctx.wsProvider, so one LP transfer on pair A is evaluated twice. The three replaced providers stay open with live subscriptions. | Sub-claims 4 to 6 stay code-read; the vanish case is AUD-API-002's file |
| AUD-BUY-008 | S1 | confirmed (was candidate) | AUD-BUY-008.test.ts: `restart-stacks-reconnect-loop` | The real dashboard Stop and Start run on a connected socket. One server-side close then runs two reconnect loops per DEX within 10 s of fake time, and each loop sends its own disconnect alert. The control without a restart reconnects each DEX once. | The doubled PairCreated's double buy is AUD-BUY-004; the missing backfill, heartbeat and shutdown check stay code-read |
| AUD-ANTIRUG-003 | S1 | confirmed (was candidate), needs_fork | AUD-ANTIRUG-003.test.ts: `breaker-counts-dispatches-not-rugs` | Anti-rug runs live (LIVE_EXECUTE true, CONFIRM_BLOCKS 1, breaker threshold 3). One real removal emits two LP Transfers and a Burn, which become three confirm gates and three dispatches at the confirm block. The first exit is held at its relay simulation. Meanwhile the two duplicates are refused by the sell lock and counted at once. Then the first exit is released, sells, and is counted after its sell returns. Result: three triggers for one rug, and the breaker trips. | Sub-claim 2 (how many matching logs a REAL mainnet removal emits): fork question recorded |
| AUD-ANTIRUG-004 | S1 | confirmed | AUD-ANTIRUG-004.test.ts: `failed-escape-not-retried` | Anti-rug runs live (breaker threshold 100). The confirm block passes and the exit is dispatched. The node refuses the escape's approval once (geth "transaction underpriced"), so no sell is sent. Over 2 minutes of fake time (10 blocks), no anti-rug dispatch follows. | Sub-claim 2 (no timer re-arm after a lock refusal) and the budget-overrun path stay code-read |
| AUD-ANTIRUG-005 | S1 | confirmed | AUD-ANTIRUG-005.test.ts: `backfill-fires-live-exit`, `live-dispatch-does-not-advance-cursor` | **Claim 1:** a pull is mined while the socket is closed. The reconnect's real backfill replays it, logs `antirug.backfill.too-late`, and still reaches triggerAntiRugExit and submits an anti-rug sell. **Claim 2:** a pull is dispatched live and sold, but the real DB's last_seen_block stays at the arming backfill block. | Sub-claims 3 to 5 stay code-read; the backfill exit policy is card ANTIRUG-02's decision |
| AUD-ANTIRUG-024 | S3 | confirmed | AUD-ANTIRUG-024.test.ts: `first-start-false-gap-alert` | On a fresh database, boot step 4 (the real resumeAntiRugMonitoring, no positions) logs an error. It sends "[GAP DETECTED] eth missed <head> blocks (0-<head>)", broadcasts gap-detected from block 0, and never seeds. | None |
| AUD-ANTIRUG-018 | S1 | confirmed | AUD-ANTIRUG-018.test.ts: `restart-gap-blinds-http-poller` | Setup: an ETH chain without a WebSocket URL, a temp-file database, and the boot order of startMultiChainBot. A real snipe is armed, and its anti-rug poll follows the head. After 6 minutes of downtime (30 blocks) and a boot on the same file, every poll asks for stored+1..head in one request. The 10-block provider limit refuses each one, and the cursor never moves. A real 95 percent pull is not evaluated within 2 minutes of fake time. The dashboard is told connected. | Whether the operator's provider applies this limit, and whether any chain runs without a WebSocket URL, stay unmeasured |
| AUD-BUY-036 (new) | S3 | confirmed | AUD-BUY-036.test.ts: `outage-blinds-http-dex-poller` | Setup: the same provider limit and the real HTTP DEX poller. The control finds a launch while the RPC is healthy. After a 12-block eth_blockNumber outage while the bot runs, every factory query asks for pre-outage+1..head in one request and is refused. A launch mined afterwards is not found within 60 s of fake time. | The V3 HTTP poller (same code) stays code-read |

None of these entries is unreproduced or NOT-A-BUG.

## Task Commits

1. **Task 1 (tracer): AUD-API-002** - `a400ba8` (test)
2. **Task 2: AUD-ANTIRUG-001, AUD-BUY-008** - `b5cef61` (test)
3. **Task 3: AUD-ANTIRUG-003, -004, -005** - `d36557b` (test)
4. **Scope addition: AUD-ANTIRUG-024** - `3781dcc` (test)
5. **Scope addition: AUD-ANTIRUG-018** - `5ce6423` (test)
6. **New finding: AUD-BUY-036 (registered and proven)** - `6b4c531` (test)
7. **AUD-API-002's Stop claim decoupled from the onRestart pin** (found by the cross-file mutation batch) - `34aa4e8` (fix)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## New findings and grade/status changes

Made under the operator's standing instruction of 2026-11-11 ("All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading"), without a stop.

| Item | Change | Evidence |
|---|---|---|
| AUD-BUY-036 (new) | **Registered:** S3, capital none, confirmed, class C10.<br>**Records:** BUY ledger row `src/bot.ts`; sweep `src x C10` in `contrib-PHASE23.json`; triage confirmed (not in the frozen 61; recorded so check.ts can locate its claim). | **Code (audit base 23a6461):**<br>- `src/bot.ts:1632`: startHttpPollingListener seeds lastBlock at the head.<br>- `:1641`: `queryFilter('PairCreated', lastBlock + 1, currentBlock)` in one request.<br>- `:1647-1650`: advances only on success; a failed tick only logs "HTTP polling error".<br>- V3 `:1654-1677` the same; HEAD `:1627-1654` / `:1656-1679`.<br>**Found:** while proving AUD-ANTIRUG-018 (same unchunked range).<br>**Real path:** AUD-BUY-036.test.ts, claim `outage-blinds-http-dex-poller`. A windowed catch-up reads looks fixed.<br>**Grade:** S3. No funds are lost or stranded (held positions keep their own exit paths); the harm is a silently blind listener until a restart, which drops every launch of the gap. Below AUD-ANTIRUG-018 because no held position loses protection. |
| AUD-BUY-008 | status candidate -> confirmed (S1 OVERSPEND unchanged) | The duplicate reconnect after a dashboard restart was the open condition in its rationale ("Status candidate until a Phase 23 run shows the duplicate dispatch"); AUD-BUY-008.test.ts shows it. |
| AUD-ANTIRUG-003 | status candidate -> confirmed (S1 STRAND unchanged); sub-claim 2 stays candidate | The counting rule is shown by the real breaker on one real-shaped removal. Sub-claim 2 (the log count of a real mainnet removal) is the needs_fork question. |

**No severity changed.**

**Observed, not asserted:**
- **AUD-ANTIRUG-018 meets AUD-ANTIRUG-024 when a buy starts the poller.**
  - If the first anti-rug start of an HTTP-only chain is a buy registration (not boot step 4), the poller seeds lastBlock 0 from the dry-run stamp's row with a position already registered. Its first poll would then ask for blocks 1..head and be refused forever.
  - This is the 23-01 "sibling observation" (in AUD-ANTIRUG-018's `sibling_sites_checked`).
  - The boot order this file uses avoids it, because the no-positions tick moves the cursor first.
  - No separate entry.
- **AUD-ANTIRUG-003's pull feeds other findings.** In AUD-ANTIRUG-004 and -005, one pull's three logs also made three backfill too-late lines, three gates and refused duplicate dispatches. Those are AUD-ANTIRUG-003's multiplication; they are not counted there.

## Files Created/Modified

- The nine triage files under `test/realpath/triage/` (15 tests, 13 claims).
- `test/realpath/triage/fixtures/AUD-API-002-restart.ts`:
  - `bootListeners`: every DEX listener, as boot step 4 starts them;
  - `onRestartMirror` / `assertOnRestartUnchanged`: the pinned mirror of src/bot.ts onRestart (sha256 `8cea5dd2...49d3` of the closure text, LF line ends);
  - `openDashboardWithRestart`, `chainRoute`.
- `test/realpath/triage/fixtures/AUD-ANTIRUG-003-live.ts`:
  - `liveOverrides` / `liveGates`;
  - `breaker`: the graph's own circuitBreaker module;
  - `afterExitPoll`, `exitFiredSince`;
  - `driveFor`: bounded, the driveChain rules plus empty blocks while no bundle waits.
- `test/realpath/triage/fixtures/AUD-ANTIRUG-018-range-limit.ts`:
  - `limitLogRange`: refuses eth_getLogs wider than 10 blocks, per request;
  - `logQueriesFor`.
- `.planning/audit/findings/*.json`: triage blocks (set-triage.ts) on the eight entries, and the new AUD-BUY-036.
- `ledger/BUY.json`, `sweep/contrib-PHASE23.json`: AUD-BUY-036's registration.
- `.planning/audit/AUDIT-FINDINGS.md`: re-rendered with render.ts (the two status changes and the new finding).
- OPERATOR-DECISIONS.md is byte-unchanged and SEAL.json is untouched.

## Decisions Made

See `key-decisions`. In short:
- **Every marker measures the harm**, so the recommended fix shapes read "looks fixed". The harm is:
  - whether a rug is evaluated;
  - where the subscription lives and how often one log is evaluated;
  - how many reconnect loops run;
  - what the breaker counts;
  - whether the escape is retried;
  - whether the backfill sells;
  - where the cursor stands;
  - whether a false alert is sent;
  - whether a launch is found.
  The fix shapes are named in each test header.
- **Setup facts hold under the bug, under the fixes, and under every other finding's fix in this plan.** A full cross-file mutation batch showed this (table below). Where a later finding's fix could have removed a test's precondition, the test was built around a failure that fix cannot remove: AUD-ANTIRUG-004 and AUD-EXIT-014.

## Deviations from Plan

### Orchestrator-directed scope addition

**AUD-ANTIRUG-024 and AUD-ANTIRUG-018 added to this plan (population gap)**
- **Reason, as given by the orchestrator:** the frozen triage population (`.planning/audit/inputs/triage-population.json`, 61 IDs) contains two anti-rug entries that no plan in this phase owns. Both joined the population through operator rulings in 23-01 after the plans were written (ESC-ANTIRUG-02, ESC-ANTIRUG-03). 23-01-SUMMARY.md line 178 records that AUD-ANTIRUG-018 "belongs in the Wave 5 triage set (a real-path test that fails today)". Without them, `check.ts --stage triage` can never pass. This plan is the anti-rug / WebSocket-lifecycle triage plan.
- **Done:** after the plan's three tasks were committed. One test file and one commit per finding, each claim proven against a fix-shaped src mutation, recorded with set-triage.ts. Commits `3781dcc` (024) and `5ce6423` (018).

**No HARNESS GAP for AUD-ANTIRUG-018.** I checked first whether the committed harness can refuse an over-range eth_getLogs faithfully. It can, through the public `FakeNode.failNext`:
- **How it decides:** its `after` predicate runs while the node matches the call. FakeNode `#one` logs the call on `node.callLog` and then checks the faults with no await in between, so the last call-log entry is the very request being matched. The predicate checks that the entry is an eth_getLogs (and throws, failing the test loudly, if that order ever changes). It refuses only when that request's own inclusive range is wider than 10 blocks.
- **Why that is faithful:** a chunked request, which is the fix, is answered by the node's normal eth_getLogs, as a real provider would answer it. The fix mutation proves this: AUD-ANTIRUG-018 reads looks fixed.
- **What changed:** nothing under `test/realpath/harness/`, and no checkpoint.
- **The provider limit, in plain words:** some RPC providers answer an eth_getLogs (a request for the event logs of a block range) only when the range is small. Alchemy's free tier allows at most 10 blocks per request, counted inclusively. QuickNode's free trial allows 5 and its paid plans 10,000. A wider request is refused with an error and returns no logs.
- **The evidence, all in this repository (no live request was sent):**
  - Phase 19 research CRITICAL #1 (`.planning/milestones/v6.17-phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md`) has the provider table, each row marked verified against the provider's documentation.
  - Plan 21-03 measured the configured key: `test/fork/fixtures/realLaunches/README.md` says "the configured key is Alchemy FREE tier, which caps eth_getLogs at a 10-block range per request".
  - `scripts/capture-launch.ts` keeps its windows inside that inclusive span.
  - The bot itself sizes its chunked backfill to it (`src/chainRegistry.ts` ETH backfillCapBlocks 10, "Alchemy free-tier safe").
- **What is not from a recorded response:** the refusal's error code and text follow Alchemy's documented answer as I recall it. The bot never reads that text; it treats every eth_getLogs error alike.

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The Start route needs the bot's private onRestart**
- **Found during:** Task 1. The same need arose for AUD-BUY-008 in Task 2.
- **Issue:** the real `onRestart` callback is a closure inside `startMultiChainBot`. Only a full boot builds it (preflight, chain contexts, Telegram, signal handlers), and this phase never boots the bot. 23-06 hit the same limit and left it code-read.
- **Fix:** `fixtures/AUD-API-002-restart.ts` passes the real `startApiServer` a line-for-line mirror of the closure, built on the graph's own module instances. The mirror is pinned: `assertOnRestartUnchanged()` hashes the closure's text in src/bot.ts. Any edit to it fails the dependent tests with "onRestart changed" (shown by a mutation). So a Phase 24 fix inside onRestart can never pass silently through a stale mirror.
- **Committed in:** a400ba8.

**2. [Rule 2 - Correct isolation] AUD-ANTIRUG-004 fails the escape by a refused approval, not a held sell lock**
- **The plan:** `failNext` on the sell submission, or a held sell lock.
- **Why not the lock:** a refusal by the sell lock is AUD-EXIT-014's claim. That fix (the anti-rug exit waits for, or pre-empts, the exit in flight) would remove the refusal this test needs.
- **Why not the sell submission:** the private sell's failure falls back to a public sell that lands, so the escape would succeed.
- **What I did:** `failNext` on the escape's first submission, its approval's `eth_sendRawTransaction`, with a geth "transaction underpriced" error. The escape then fails before any sell. `antirug.exit.dispatch` is reached first (the plan's precondition).
- **Committed in:** d36557b.

**3. [Rule 2 - Plan precondition read correctly] AUD-ANTIRUG-005 claim 1's precondition is the backfill's unsafe verdict, not `antirug.exit.dispatch`**
- **Why:** reaching triggerAntiRugExit is what that claim measures. Requiring it beforehand would make the fixed code fail the precondition, not read looks fixed.
- **What I did:** the precondition is the live gates (asserted from the loaded config) plus `antirug.backfill.too-late` for the trade. Both hold for the bug and the contract alike, so a dry run or a gate miss still cannot pass as the finding. Claim 2 and every other Task 3 scenario assert `antirug.exit.dispatch` was reached.
- **Committed in:** d36557b.

**4. [Rule 2 - Faithful setup] Every DEX listener is started, as boot does**
- **What:** the reconnect and Stop tests start uniswap-v2, sushiswap-v2 and uniswap-v3 (`bootListeners`), not only the scenario's DEX.
- **Why:** production boot step 4 starts them all, and the AUD-ANTIRUG-001 split depends on the DEX loops being there.
- **Also:** `heldPosition` (which starts one DEX) is not used there, so no listener is started twice.
- **Committed in:** a400ba8, b5cef61.

**5. [Rule 1 - Bug in my own fixture] driveFor reset its bundle-slot map every 12 s**
- **Found by:** the first AUD-ANTIRUG-005 run. The test passed, but its warn/error dump showed the anti-rug sell's private bundle never landing: `mev.escalation.ceiling-hit`, then `antirug.exit.bounded-abort` at 60 s, then a public fallback.
- **Cause:** driveFor called driveChain once per 12 s window, so each bundle's slot restarted and never reached its 12 s.
- **Fix:** driveFor keeps one slot map for its whole window (driveChain's own rules), and mines an empty block only while no bundle of the wallet waits.
- **Result:** the bundle then lands at its target and those lines are gone.
- **Committed in:** d36557b.

**6. [Rule 1 - Test timing] AUD-ANTIRUG-001's second buy hit the snipe cooldown**
- **Issue:** "Risk check failed" (SNIPE_COOLDOWN_MS 30 s), diagnosed from the dump.
- **Fix:** the second launch fires 31 s after the first buy, as 23-09's AUD-TX-003 did.
- **Committed in:** b5cef61.

**7. [Rule 1 - Isolation] Post-marker details made safe under other findings' fixes**
- **AUD-ANTIRUG-003:** its dispatch and outcome details are read at the confirm block, before any further block, because AUD-ANTIRUG-004's retry fix adds dispatches after it (found by the cross-file batch).
- **AUD-BUY-008:** does not assert where the two loops put the listener, because AUD-ANTIRUG-001's single-provider fix would put both on one provider.
- **Committed in:** d36557b, b5cef61.

**8. [Rule 1 - Isolation] AUD-API-002's Stop claim no longer depends on the onRestart pin**
- **Found by:** the cross-file batch. An edit inside onRestart failed both AUD-API-002 tests, though the Stop claim never runs Start.
- **Fix:** that test opens the real dashboard without a callback (as AUD-API-001 does).
- **Committed in:** 34aa4e8.

**9. [Rule 2 - Missing critical] A bug not in the register was registered, under the standing instruction**
- AUD-BUY-036; see the table above.
- **Committed in:** 6b4c531.

**10. [Rule 1 - Harness teardown] AUD-BUY-036's control armed a limit that never fired**
- **Issue:** the harness fails a fault that never fired, and the healthy control never sends an over-range query.
- **Fix:** the control sends the node one 20-block query (refused, code -32600) and one 10-block query (answered). That proves the limit is live and faithful in both directions.
- **Committed in:** 6b4c531.

---

**Total deviations:** 10, plus the orchestrator-directed scope addition (Rule 1: 5, Rule 2: 4, Rule 3: 1). **Impact:**
- The proofs measure the harm, are isolated from each other's fixes, and depend on no private closure without a pin.
- One new register entry.
- `src/` is unchanged, and nothing under `test/realpath/harness/` was written.

## Issues Encountered (all diagnosed)

- **Warn/error lines in every run, all explained** (dumped per test with a non-throwing scratch afterEach, then the copy deleted):
  - `antirug.backfill.gap-detected`: the first registration on a fresh database, AUD-ANTIRUG-024.
  - "WebSocket disconnected, reconnecting" and `antirug.ws.disconnected`: the forced socket drops.
  - `antirug.cb-tripped` (fatal): AUD-ANTIRUG-003's own claim.
  - `exit.full.failed` and `exit.failed.held`: AUD-ANTIRUG-004's forced refused approval. Ethers wraps the node's error as "could not coalesce error (error={ code: -32000, message: 'transaction underpriced' })", which is ethers' own handling of that JSON-RPC answer.
  - `antirug.backfill.too-late`: AUD-ANTIRUG-005's claim.
  - The HTTP-fallback warnings: the ETH_WS_URL='' configuration of AUD-ANTIRUG-018 and AUD-BUY-036.
  - `antirug.http-polling.error` and "HTTP polling error": those two findings' claims and the forced outage.
  - "Risk check failed": MAX_OPEN_POSITIONS=0 in AUD-BUY-036, deliberately.
- **Development-only lines, gone from the committed runs:**
  - `mev.escalation.ceiling-hit`, `exit.private.not-landed`, `antirug.exit.bounded-abort` came from my driveFor bug (deviation 5).
  - A failed first mutation script wrote src/bot.ts and then stopped on a CRLF anchor in detector.ts. Its runner did not know about bot.ts, so bot.ts stayed mutated for one test run. I restored it at once with `git -c core.autocrlf=false checkout` and confirmed the hash equals the HEAD blob.
  - After that, mutations became atomic (every anchor checked before any write), and a failed mutation restores every touched src file.
- **`--stage final` has 74 FAILs:** 23-09's 62 plus 12 TESTI ledger rows for this plan's committed test and fixture files. These are Phase 22 final-stage bookkeeping, out of scope per 23-04.
- Git's "LF will be replaced by CRLF" notices come from `core.autocrlf=true`; the blobs are LF.

## Verification (exact commands, Node 22.16.0 via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

**Task verifies:**
- **Task 1:** the plan's command gave 2/2, `--slice API` PASS and the triage block present. It was re-run as the tracer gate.
- **Task 2:** AUD-ANTIRUG-001 and AUD-BUY-008 gave 5/5, `--slice ANTIRUG` and `--slice BUY` PASS, triage blocks present.
- **Task 3:** AUD-ANTIRUG-003, -004 and -005 gave 4/4, `--slice ANTIRUG` PASS, triage blocks present, and AUD-ANTIRUG-003 has `needs_fork` true with a `fork_question`.
- **Acceptance checks:**
  - every Task 3 scenario asserts the live gates from the loaded config, and asserts `antirug.exit.dispatch` where the claim allows (see deviation 3);
  - AUD-ANTIRUG-005 asserts a new anti-rug sell in `node.submitted`;
  - `grep -cE "setTimeout\(|sleep\("` over the plan's test files gives 0 for each.

**Full railed suite (`npm test -- --reporter=json`, final run on the committed tree):**
- 184 files, 1355 tests: 1355 passed, 0 failed, 0 skipped, 0 todo, 0 unhandled errors (run run-20261111T220734-8408-0d22a3).
- This plan's tests under the full parallel load: 4803, 3600, 2141, 1110, 474, 1238, 369, 3679, 3452, 3678, 2088, 1118, 4301, 3934 and 733 ms. Every one is under half the 15 s default, so none needs its own limit.
- Rails ledger: `nonLoopbackAllowed` 0 and `telegramAllowed` 0. The loopback dashboard calls are attributed to the existing fixtures AUD-BUY-011-dashboard.ts and AUD-API-001-dashboard-sell.ts (net-allow, loopback only).

**Repeatability (AC-10):** the nine files ran three times with the JSON reporter: 15 tests and 13 knownBug records, identical across runs, success true each time.

**Gates and type checks:**
- `tsc --noEmit` exits 0 on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json.
- The scratch tsconfig extending the repo's (test/realpath/triage/**/*.ts, module esnext): 0 errors over 52 triage files.
- `npm run check:realpath-mocks`: 35 vi uses (7 mock calls) in 67 files, 0 violations.
- `npm run check:vi-mock`: 591 mock calls in 241 files, 0 violations.

**Register:**
- `check.ts --stage partial`: PASS, fail 0, pending 62. `--stage consolidation`: PASS.
- `--stage triage`: 62 FAILs, all expected:
  - 22 population entries other plans have not recorded (30 before this plan, minus this plan's 8);
  - 34 S0/S1 acknowledgements owed to 23-16 (7 of them this plan's: AUD-API-002, AUD-ANTIRUG-001, AUD-BUY-008, AUD-ANTIRUG-003, -004, -005, -018);
  - 4 `fork_ref`s (AUD-BUY-015, AUD-BUY-033, AUD-EXIT-003 and now AUD-ANTIRUG-003);
  - AUD-TX-006's keep-open ruling;
  - the run-evidence file.

**src and fix signals:**
- `git status --porcelain src` was empty at every commit and after every mutation.
- **Fix-signal proofs:** scratch mutations of `src/`, run on Node 22.16.0. Each was restored with `git -c core.autocrlf=false checkout`, and `git hash-object` was IDENTICAL to the HEAD blob each time.
- The full batch ran every mutation against all nine plan files:

| Mutation | Result |
|---|---|
| none | all 15 pass |
| Stop removes only the factory listeners | AUD-API-002 looks fixed (both claims); every other test passes |
| every reconnect loop takes the one cached provider (OD-11 shape) | AUD-ANTIRUG-001 looks fixed (all three claims); every other test passes |
| startDexListener registers its close handler once per DEX and socket | AUD-BUY-008 looks fixed; every other test passes |
| an edit inside src/bot.ts onRestart | AUD-API-002 start-does-not-rearm-antirug and AUD-BUY-008 restart-stacks-reconnect-loop fail "onRestart changed"; every other test passes |
| one in-flight anti-rug dispatch per position, duplicates not counted | AUD-ANTIRUG-003 looks fixed; every other test passes |
| the confirm gate re-dispatches on a later block while the escape fails | AUD-ANTIRUG-004 looks fixed; every other test passes |
| a backfill replay cannot schedule the confirm gate | AUD-ANTIRUG-005 backfill-fires-live-exit looks fixed; every other test passes |
| the live dispatcher writes the dispatched log's block | AUD-ANTIRUG-005 live-dispatch-does-not-advance-cursor looks fixed; every other test passes |
| the backfill treats a block-0 row as no prior state | AUD-ANTIRUG-024 looks fixed; every other test passes |
| the HTTP anti-rug poller uses getLogsForBackfill | AUD-ANTIRUG-018 looks fixed; every other test passes |
| the V2 HTTP DEX poller catches up in backfillCapBlocks windows | AUD-BUY-036 looks fixed; every other test passes |

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## For 23-16

- Acknowledge, in the S0/S1 batch report, the seven S1 entries of this plan:
  - AUD-API-002, AUD-ANTIRUG-001, AUD-BUY-008, AUD-ANTIRUG-003, AUD-ANTIRUG-004, AUD-ANTIRUG-005;
  - **AUD-ANTIRUG-018**, the S1 the operator raised at ESC-ANTIRUG-03. The operator answered "Not sure" to whether any chain runs without a WebSocket URL. The real-path test shows the harm whenever one does, on a 10-block provider (the 21-03 README records the configured ETH key as Alchemy free tier).
- AUD-ANTIRUG-024 (S3) is in the frozen population by operator ruling. It needs no acknowledgement but must be counted in the 61.
- AUD-ANTIRUG-003: add its UFV entry (owner 25) for the needs_fork question and set `fork_ref`.
- Collect the 13 knownBug records from the nine files into the run evidence. AUD-BUY-036's record is outside the population.

## Next Phase Readiness

**Phase 24:**
- Each file can be run alone as a before-and-after proof; the fix shapes the markers see are named in each test header.
- **Card OD-11:** AUD-ANTIRUG-001, AUD-BUY-008 and AUD-API-002 share one root cause. The OD-11 single-provider shape fixes AUD-ANTIRUG-001 but not AUD-BUY-008's stacked close handler or AUD-API-002's Stop, so all three need their own change.
- **The onRestart pin:** a fix inside onRestart fails AUD-API-002's Start claim and AUD-BUY-008 with "onRestart changed". Re-point `fixtures/AUD-API-002-restart.ts` (mirror and hash) with the fix.
- **Cards ANTIRUG-01 and ANTIRUG-02:** AUD-ANTIRUG-003 (dedupe per position) and AUD-ANTIRUG-004 (retry) are ANTIRUG-01. AUD-ANTIRUG-005's backfill policy is ANTIRUG-02.
- **Card OD-48:** AUD-ANTIRUG-018 and AUD-BUY-036 share one fix, a chunked poll helper. AUD-BUY-036 can follow in Phase 29.

**Later triage plans:**
- `fixtures/AUD-ANTIRUG-018-range-limit.ts` gives a request-decided provider range limit.
- `fixtures/AUD-ANTIRUG-003-live.ts` gives live anti-rug gates and a bounded driver that lands bundles.
- `fixtures/AUD-API-002-restart.ts` gives the boot listener set and the pinned Start callback. Reuse them rather than duplicating.

## Self-Check: PASSED

- **Files found:** the nine triage test files and three fixtures under test/realpath/triage/; .planning/audit/findings/AUD-BUY-036.json.
- **Commits found on this branch:** a400ba8, b5cef61, d36557b, 3781dcc, 5ce6423, 6b4c531 and 34aa4e8 (`git rev-list --count 7e4b7b5..HEAD` = 7 before this SUMMARY).
- **Re-run after the last commit:** every task's acceptance criteria and the plan-level verification pass.
- **Clean tree:** no scratch file is left under test/ or src/, and `git status --porcelain src test` is empty.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*
