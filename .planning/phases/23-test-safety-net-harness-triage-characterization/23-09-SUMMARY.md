---
phase: 23-test-safety-net-harness-triage-characterization
plan: 09
subsystem: testing
tags: [vitest, ethers, realpath-harness, triage, knownBug, audit-register, nonce-lock, withNonceLock, flashbots, anti-rug, risk-manager]

requires:
  - phase: 23-01
    provides: FakeNode reads, failNext and hold with exact targets and fired checks, createScenario, the fixed clock, expectStillPending
  - phase: 23-28
    provides: createScenario for V2 and V3 on eth/base, neverMine, mine({ include, logs }), the Flashbots and passthrough routes
  - phase: 23-02
    provides: knownBug marker, recordedLogs/recordedAlerts, the timeline (op and submit entries with `at`), the AC-02 mock-list gate
  - phase: 23-27
    provides: the Harness Gap Procedure (no gap was raised)
  - phase: 23-04
    provides: set-triage.ts, check.ts triage rules
  - phase: 23-07
    provides: fixtures/AUD-EXIT-002-position.ts and fixtures/AUD-EXIT-001-sell-path.ts
  - phase: 23-08
    provides: fixtures/AUD-API-001-dashboard-sell.ts (heldPosition, driveChain) and fixtures/AUD-EXIT-014-rug.ts (pullLiquidity)
provides:
  - "Six real-path triage files (AUD-TX-001, AUD-TX-002 with AUD-BUY-025 and AUD-EXIT-009, AUD-TX-003, AUD-BUY-004, AUD-BUY-010, and the new AUD-TX-029): 12 tests, 8 knownBug claims; each claim reads looks fixed under a fix-shaped src mutation, and a full cross-file batch shows every mutation flips only its own claim"
  - "Triage outcomes for the seven plan findings, all confirmed, every one on the real withNonceLock"
  - "fixtures/AUD-TX-002-lock.ts (graphWithNonceLock, probeWalletLock, pendingWindow, missBundlesUntil, settleAntiRugArming) and fixtures/AUD-TX-003-second-launch.ts (a second token launched on sushiswap-v2 on the same node and wallet)"
  - "One new register entry graded under the standing instruction: AUD-TX-029 (S3, capital none)"
affects: [23-16, phase-24, phase-29]

actuals:
  tokens: 26128    # chars/4 over the added lines of 0fdb3aa..bdeab46 (19 files, 104510 chars, incl. the AUDIT-FINDINGS.md render)
  tasks: 3
  commits: 5       # MEASURED: git rev-list --count 0fdb3aa..HEAD before this SUMMARY commit
plan_head_before: 0fdb3aa8fb540c4dd21bd0a1177609cb8e3e3107
plan_head_after: bdeab460cd94e3bd9cbf7bd1c35ec9c4d2bd9b70
commits: 5

tech-stack:
  added: []
  patterns:
    - "A never-mined transaction is made with FakeNode.neverMine (a valid null receipt, the nonce never moves) while blocks keep mining, never with a held RPC call, and the result is a bounded observation over a stated fake-time window"
    - "A lock is shown held by queuing a probe through the graph's own withNonceLock and watching it with expectStillPending; every control shows the same probe starting once the bot lets go"
    - "A race between two handlers is forced by holding the first buy's Flashbots simulation (eth_callBundle on the relay), so the bot's HTTP provider is never stalled (AUD-TX-028)"
    - "Two tokens on one wallet: the scenario's uniswap-v2 token plus a second launch on the chain's other V2 DEX, so the second token's router answers never collide with the scenario's"
    - "Before teardown, wait for every anti-rug registration's backfill and for the node's subscription traffic to stop changing, so no eth_subscribe/eth_unsubscribe is cancelled into an unhandled rejection"

key-files:
  created:
    - test/realpath/triage/AUD-TX-001.test.ts
    - test/realpath/triage/AUD-TX-002.test.ts
    - test/realpath/triage/AUD-TX-003.test.ts
    - test/realpath/triage/AUD-BUY-004.test.ts
    - test/realpath/triage/AUD-BUY-010.test.ts
    - test/realpath/triage/AUD-TX-029.test.ts
    - test/realpath/triage/fixtures/AUD-TX-002-lock.ts
    - test/realpath/triage/fixtures/AUD-TX-003-second-launch.ts
    - .planning/audit/findings/AUD-TX-029.json
  modified:
    - .planning/audit/findings/AUD-TX-001.json
    - .planning/audit/findings/AUD-TX-002.json
    - .planning/audit/findings/AUD-TX-003.json
    - .planning/audit/findings/AUD-BUY-004.json
    - .planning/audit/findings/AUD-BUY-010.json
    - .planning/audit/findings/AUD-BUY-025.json
    - .planning/audit/findings/AUD-EXIT-009.json
    - .planning/audit/ledger/TX.json
    - .planning/audit/sweep/contrib-PHASE23.json
    - .planning/audit/AUDIT-FINDINGS.md

key-decisions:
  - "All seven plan findings recorded confirmed; none unreproduced and none NOT-A-BUG, so nothing here needs an operator ruling before 23-16 beyond the S1 acknowledgements (all seven are S1)"
  - "The RC-10 never-settling wait is one file (AUD-TX-002.test.ts) with one test, one knownBug and one mined-with-three-confirmations control per site; the result is stated as a bounded 30-minute fake-time observation, never as forever"
  - "AUD-BUY-004 and AUD-BUY-010 force their order by holding the first buy's Flashbots simulation on the relay, not a provider read, because a held read would stall the second handler's own gates through AUD-TX-028 and decide the test by that finding"
  - "AUD-TX-003's position A is armed and its rug fired right after one of its exit-monitor polls, so the routine stop-loss cannot take A's sell lock before the anti-rug dispatch; this is asserted after the marker"
  - "New AUD-TX-029 (S3, capital none) registered by the executor under the standing instruction, without a stop"

patterns-established:
  - "Scratch runners in the session scratchpad: batch.sh (every fix-shaped mutation against every plan file, JSON reporter, byte-exact restore and hash proof), mut-*.cjs (the mutations), logdump.cjs (a non-throwing afterEach that records every warn/error/fatal line), ac10.cjs (three JSON runs compared)"

requirements-completed: [AUDIT-02]

coverage:
  - id: D1
    description: "AUD-TX-002 (passthrough wait(3)), AUD-BUY-025 (deliberate public wait()) and AUD-EXIT-009 (exit ensureApproval wait()): a transaction that is never mined keeps the real wallet lock, and a later operation for the wallet does not start within a 30-minute fake-time window of 150 blocks; each site has a mined-with-three-confirmations control in which the operation starts"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-TX-002.test.ts (6 tests; a bounded-wait mutation at each site flips only that site's claim)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUD-TX-001: a same-wallet acquire nested inside a withNonceLock op never settles and a third op for the wallet never starts within a 30-minute fake-time window, with nothing logged; nesting across two wallets completes"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-TX-001.test.ts (2 tests; a throw-on-nested-acquire guard gives looks fixed and flips no other test)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUD-TX-003 (AC-12): while a snipe of token B escalates privately, the anti-rug exit of held position A cannot send anything; bounded-abort lands exactly 60000 fake ms after the dispatch on the timeline, and A's abandoned exit sends only after B fails clean"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-TX-003.test.ts (1 test; an anti-rug approval that skips the queue gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUD-BUY-004 (AC-12): two real handlers for one PairCreated both pass the already-sniped check and both buys land: two decoded swaps of the same token, two trades rows"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-004.test.ts (1 test; an in-process claim set gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "AUD-BUY-010 (AC-12): with MAX_OPEN_POSITIONS=1, handlers for two different tokens both pass canSnipe and both buys land: two decoded swaps, two open rows against a limit of one"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-010.test.ts (1 test; a synchronous reservation in canSnipe gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AUD-TX-029 (new): a snipe whose four private attempts all miss at 1 to 4 gwei is reported as having reached the 25 gwei priority-fee ceiling"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-TX-029.test.ts (1 test; a separate attempt-budget message gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D7
    description: "AC-48: no test passes on answers a real node, router or token could never give (the never-mined transaction is a valid pending transaction with a null receipt; the second launch is a real signed addLiquidityETH with the sushiswap factory's PairCreated; every swap is decoded with real ethers)"
    verification: []
    human_judgment: true
    rationale: "The plan family marks this prohibition as judgment: review of fake transport data"

duration: 41min
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 09: Nonce-Lock and Concurrency Findings on the Real Lock Summary

**All seven findings now fail on the real path, through the real `withNonceLock` (never a stub), with every race forced by holds, mined blocks and fake time:**
- A transaction that is never mined keeps the wallet lock: on Base's private path (`tx.wait(3)`), in the deliberate buy's public leg and in an exit's approval. In each case a later operation for the same wallet did not start within a 30-minute fake-time window.
- A same-wallet acquire nested inside a lock-holding operation waits on itself; nothing detects it.
- While a snipe of one token holds the lock through its private attempts, an anti-rug exit of another position cannot start. It gives up exactly 60 s later and then runs minutes afterwards.
- Two handlers for one new pair both buy it.
- With room for one more position, two new tokens both get bought.

**Found on the way, one new S3 entry, AUD-TX-029:** a snipe that runs out of private attempts at 4 gwei is reported as having reached the 25 gwei fee ceiling, and the operator is told to raise it.

## Performance

- **Duration:** about 41 min
- **Started:** 2026-11-11T20:36:15Z
- **Completed:** 2026-11-11T21:17Z
- **Tasks:** 3 of 3. Task 1 tracer gate (interactive, end-of-phase mode, automated-only verify): the verify passed on the committed tree, then Task 2 started.
- **Files:** 19 (8 test files created, 1 register file created, 10 register files modified)

## Per-finding outcomes

| Finding | Sev | Outcome | Test file and claim | What was proven | Left open |
|---|---|---|---|---|---|
| AUD-TX-002 | S1 | confirmed | AUD-TX-002.test.ts: `passthrough-wait-holds-wallet-lock` | A real base V3 snipe (route passthrough). The buy is sent publicly and `tx.wait(3)` runs with no timeout inside submitBuyTx's wallet lock. The node keeps the transaction out of every block (`neverMine`): the receipt is a valid null and the nonce never moves, while a block is mined every 12 s. A probe queued through the graph's own withNonceLock did not start within 30 minutes of fake time (150 blocks, more than 100 receipt polls, no `passthrough.wait.timeout`, no trades row). Control: mined with three confirmations, the probe starts after the third block and the position is armed. | The private sells and partial sells on Base/Arbitrum take the same closure (code-read) |
| AUD-BUY-025 | S1 | confirmed | AUD-TX-002.test.ts: `deliberate-public-wait-holds-wallet-lock` | A real ETH V2 deliberate buy. Its two private attempts are not included; the guard clears and the public swap is sent inside withNonceLock, then `stx.wait()` with no timeout. The swap is never mined while 150 blocks are, and the probe does not start in the window. Control: mined with three confirmations, the probe starts and the buy returns its public hash and arms the position. | None |
| AUD-EXIT-009 | S1 | confirmed | AUD-TX-002.test.ts: `approval-wait-holds-wallet-lock` | A real ETH V2 position, bought and armed by the running bot, then the real `executeFullSell` (stop-loss). Its approval is sent inside withNonceLock and `ensureApproval` waits with no timeout. The approval is never mined and the probe does not start in the window. After the marker: no sell sent, and the token's sell lock is still held. Control: the approval mined with three confirmations frees the lock, the probe starts and the exit sells. | The public-fallback approve and swap and the partial-sell approvals are the same mechanism (code-read) |
| AUD-TX-001 | S1 | confirmed | AUD-TX-001.test.ts: `nested-acquire-never-settles` | On the graph's own withNonceLock: an operation for the wallet calls withNonceLock again for the same wallet (checksummed spelling) inside its body. Watched with expectStillPending over 30 minutes of fake time: the outer call never settles, the nested op never runs, a third op never starts, and no warning, error or alert is produced. Control: the same nesting across two wallets completes at once. | No production path nests today (confirmed sub-claim); the throw-on-nested guard flipped no other test of the plan |
| AUD-TX-003 | S1 | confirmed | AUD-TX-003.test.ts: `antirug-exit-queued-behind-buy` | AC-12 on one ETH wallet. Position A (uniswap-v2, anti-rug live) is bought and armed. 31 s later the bot snipes token B on sushiswap-v2, and B's bundles are never included. Right after an exit poll of A, a real 95 percent liquidity pull is ruled unsafe and the anti-rug exit is dispatched; its approval queues on the wallet lock. On the timeline, `antirug.exit.bounded-abort` comes exactly 60000 fake ms after `antirug.exit.dispatch`, and nothing of A has been sent. B holds the lock through its fourth attempt (over 3 minutes) and fails clean. Only then does A's abandoned exit send its approval and sell what is left. | The pull's extra dispatches, refused by the held sell lock, belong to AUD-ANTIRUG-003 and AUD-EXIT-014 and are not counted here |
| AUD-BUY-004 | S1 | confirmed | AUD-BUY-004.test.ts: `double-buy-same-token` | AC-12. The listener's handler passes the check and every gate, then is parked inside the lock at its Flashbots simulation. With no row written yet, the same PairCreated is handed to the real `handleNewPairForChain` (the alpha-drop shape); it passes the check too. After release, both bundles land: two `swapExactETHForTokens` of the same token at consecutive nonces, decoded with real ethers, and two pending trades rows. | The other concurrency sources (V2+V3, two DEXes, HTTP-poll overlap) share the mechanism (code-read) |
| AUD-BUY-010 | S1 | confirmed | AUD-BUY-010.test.ts: `max-open-positions-overspent` | AC-12, MAX_OPEN_POSITIONS=1 with no open position. Token A's handler passes canSnipe and is parked at its simulation. Token B launches on sushiswap-v2 and B's handler passes canSnipe and its gates while A's row is unwritten. Both buys land: two decoded swaps (A through the uniswap router, B through the sushiswap router, consecutive nonces) and two open rows against the limit of one. | Exposure and cooldown share the mechanism (code-read) |

None of these entries is unreproduced or NOT-A-BUG.

## Task Commits

1. **Task 1 (tracer): AUD-TX-002, AUD-BUY-025, AUD-EXIT-009** - `d0713f8` (test)
2. **Task 2: AUD-TX-001, AUD-TX-003** - `4c21ac5` (test)
3. **Task 3: AUD-BUY-004, AUD-BUY-010** - `547ed80` (test). Also adds `settleAntiRugArming` to the Task 1 fixture.
4. **AUD-TX-003 speed fix and its own time limit** (found by the full-suite run) - `60c2e47` (fix)
5. **New finding: AUD-TX-029 (registered and proven)** - `bdeab46` (test)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## New findings and grade/status changes

Made under the operator's standing instruction of 2026-11-11 ("All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading"), without a stop.

| Item | Change | Evidence |
|---|---|---|
| AUD-TX-029 (new) | **Registered:** S3, capital none, confirmed, class C16.<br>**Records:** TX ledger row `src/utils/mevStrategies/reconciliation.ts`; sweep `src x C16` in `contrib-PHASE23.json`; triage confirmed (not in the frozen 61, recorded so check.ts can locate its claim). | **Code (audit base 23a6461, unchanged at HEAD):**<br>- `reconciliation.ts:606-614`: one branch, `if (ceilingHit \|\| attempt >= cfg.maxRetries)`, always logs `mev.escalation.ceiling-hit` and throws "priority-fee ceiling (<ceiling> wei) reached. Increase MEV_MAX_PRIORITY_FEE_GWEI ...". `ceilingHit` is computed at `:551-553` but the text does not use it.<br>- `:502`: the escalated fee is step x (attempt + 1). At defaults a snipe bids 1, 2, 3 and 4 gwei against a 25 gwei ceiling, so a calm-gas miss always ends on the attempt budget.<br>- `bot.ts:360-385`: `emitSnipeFailClean` gives the operator that text as the reason of `buy.snipe.fail-clean`, next to "raise MEV_BUY_MAX_PRIORITY_FEE_GWEI".<br>**Found:** in the warn/error lines of AUD-TX-003's run.<br>**Real path:** AUD-TX-029.test.ts, claim `attempt-budget-reported-as-ceiling-hit`. A separate attempt-budget message reads looks fixed.<br>**Grade:** S3. The bot fails clean correctly; the wrong diagnosis sends the operator to a knob that did not bind. The wrong knob name in the same text is AUD-TX-010, and the no-op helper alert is AUD-TX-017. |

**No severity or status changed on the seven plan findings.** All were already confirmed, and set-triage kept them confirmed.

**Observed, not asserted (owned elsewhere):**
- In AUD-TX-003 one liquidity pull gave three anti-rug dispatches at the same fake time. The second and third were refused by the sell lock the first one held ("Another exit already handling token, skipping", reason anti-rug). The chain's circuit breaker tripped (`antirug.cb-tripped`). This is AUD-ANTIRUG-003's claim, as 23-08 also saw. The test asserts only that every refusal was for reason anti-rug and that no routine exit ran; it does not count dispatches.
- In AUD-BUY-004 the second registration of the same pair re-subscribes the anti-rug filter. The pattern resembles AUD-ANTIRUG-025's dropped subscription, but this plan neither measures nor asserts it.

## Files Created/Modified

- `test/realpath/triage/AUD-TX-002.test.ts`, `AUD-TX-001`, `AUD-TX-003`, `AUD-BUY-004`, `AUD-BUY-010`, `AUD-TX-029.test.ts`: the six triage files (12 tests, 8 claims).
- `test/realpath/triage/fixtures/AUD-TX-002-lock.ts`:
  - `graphWithNonceLock`: the graph's own lock;
  - `probeWalletLock`: a later operation for the wallet that only records when it starts;
  - `pendingWindow`: a block every 12 s, expectStillPending per slot, returns instead of throwing so the knownBug comes first;
  - `missBundlesUntil`: each bundle gets its 12 s slot and an empty block; public transactions are never mined;
  - `settleAntiRugArming`: the teardown settle (see the Issues section).
- `test/realpath/triage/fixtures/AUD-TX-003-second-launch.ts`: token B on sushiswap-v2 (its own factory, router and CREATE2 pair), all through setCode/setRead. The HoneypotChecker's checkV2 is re-served for both tokens with the scenario's own clean answer, and the scenario's Unicrypt route handler is wrapped for pair B.
- `.planning/audit/findings/AUD-TX-001/-002/-003, AUD-BUY-004/-010/-025, AUD-EXIT-009.json`: triage blocks (set-triage.ts).
- `.planning/audit/findings/AUD-TX-029.json`, `ledger/TX.json`, `sweep/contrib-PHASE23.json`: the new finding.
- `.planning/audit/AUDIT-FINDINGS.md`: re-rendered with render.ts (it changed only with the new finding; the triage blocks do not render). OPERATOR-DECISIONS.md is byte-unchanged and SEAL.json is untouched.

## Decisions Made

See `key-decisions`. In short:
- Every marker measures the harm: whether the later operation starts, whether the outer call settles, whether the emergency sell starts within its budget, how many buys land, and what the bot reports. So the card's fix shapes read "looks fixed". The fix shapes are named in each test header.
- Setup facts hold under the bug, under the fixes, and under every other finding's fix in this plan. A full cross-file mutation batch showed this.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correct isolation] AUD-BUY-004 and AUD-BUY-010 hold the relay simulation, not "a read"**
- **The plan:** `hold` on a read so both handlers pass the check before either writes a row.
- **Why not a read:** a held read of the bot's HTTP provider stalls every later call of that provider (AUD-TX-028). The second handler's own gates (`getCode` before the check in AUD-BUY-010) would then never run, and the test would be decided by that finding.
- **What I did:** the first buy is parked inside the wallet lock at its Flashbots simulation (`eth_callBundle` on the relay, its own connection). This happens after it passed the check and canSnipe, with its row unwritten. The second handler then runs its own gates on a free provider. **This is how AUD-TX-028 was kept from deciding these tests.**
- **Committed in:** 547ed80

**2. [Rule 2 - Missing piece] A second token on the same wallet**
- **Why:** AUD-TX-003 (a held position plus a snipe of another token) and AUD-BUY-010 (two different tokens) need two tokens on one node and wallet, and createScenario builds one.
- **What I did:** `fixtures/AUD-TX-003-second-launch.ts` launches token B on the chain's other real V2 DEX, sushiswap-v2, through the public FakeNode API. Nothing is written under `test/realpath/harness/`; no HARNESS GAP was needed.
- **Committed in:** 4c21ac5

**3. [Rule 2 - Proof strength] AUD-TX-003's rug is fired right after an exit poll of A**
- **Why:** the exit monitor polls every 5 s (hardcoded). A stop-loss poll between the pull and the anti-rug dispatch would take A's sell lock first and turn the test into AUD-EXIT-014's case.
- **What I did:** the pull starts right after one of A's exit quotes. The dispatch clears A's timers within that 5 s. After the marker the test asserts that no routine exit ran.
- **Committed in:** 4c21ac5

**4. [Rule 1 - Bug in my own test] AUD-TX-003 asserted no "Another exit already handling" line at all**
- **Found by:** the first run (the marker passed; a later expect failed).
- **Diagnosis:** a scratch dump of the log lines showed three confirm gates and three dispatches at the same fake time, one per matching pair log. The second and third were refused by the first anti-rug exit's sell lock, for reason anti-rug (AUD-ANTIRUG-003).
- **Fix:** assert that every refusal is for reason anti-rug and token A, that there is exactly one fewer refusal than dispatches, and that no routine exit ran. The number of dispatches is not asserted.
- **Committed in:** 4c21ac5

**5. [Rule 1 - Teardown] Unhandled rejections at teardown in AUD-BUY-010**
- **Issue:** the test passed, but teardown cancelled an `eth_unsubscribe` and an `eth_subscribe` into two unhandled rejections ("provider destroyed; cancelled request").
- **Diagnosis:** a scratch dump showed the second position's `antirug.listener.subscribed` logged, but its re-subscribe had not yet reached the node and its backfill had not run.
- **Fix:** `settleAntiRugArming` waits for every registration's backfill, then for the node's subscription traffic to stay unchanged for 1 s of fake time. Used in both race files.
- **Verification:** 0 unhandled errors in every later run (single file, batch, three AC-10 runs, two full suites).
- **Committed in:** 547ed80

**6. [Rule 1 - Bug in my own test] AUD-TX-003 timed out in the full parallel run**
- **Found by:** the first full `npm test`: "Test timed out in 15000ms" at 15106 ms. It took about 9 s alone.
- **Cause:** the per-step check for A's emergency sell re-decoded every submission and recovered each sender from its signature at every 50 ms step (the slowdown 23-08 also hit).
- **Fix:** each submission is classified once from its timeline entry. Now 1.8 s alone, 6.2 s and then 3.8 s in two full runs, with `{ timeout: 30_000 }` and the measured times in a comment. The fix signal was re-proven after the change.
- **Committed in:** 60c2e47

**7. [Rule 2 - Missing critical] A bug not in the register was registered, under the standing instruction**
- AUD-TX-029; see the table above.
- **Committed in:** bdeab46

---

**Total deviations:** 7 (Rule 1: 3, Rule 2: 4). **Impact:**
- The proofs are stronger and do not depend on AUD-TX-028.
- One new register entry.
- `src/` is unchanged, and nothing under `test/realpath/harness/` was written.

## Issues Encountered (all diagnosed)

- **Warn/error lines in every run, all explained** (dumped per test with a non-throwing scratch afterEach, then the files restored byte for byte):
  - `antirug.backfill.gap-detected`: the first registration on a fresh database, AUD-ANTIRUG-024 (registered). A second registration has a cursor and logs no gap.
  - `mev.reconcile.not-landed`, `buy.private.not-landed`, `buy.snipe.fail-clean`: the forced missed bundles.
  - `antirug.exit.bounded-abort`: AUD-TX-003's own finding.
  - `antirug.cb-tripped` (fatal) in AUD-TX-003: AUD-ANTIRUG-003.
  - `mev.escalation.ceiling-hit` with "priority-fee ceiling reached" after 2 or 4 attempts at 1 to 4 gwei: not explained by any entry. Diagnosed to `reconciliation.ts:606-614` and registered as AUD-TX-029.
- **AUD-TX-001 and the controls log no warn/error lines at all.**
- **The first full suite had 1 failure** (the AUD-TX-003 timeout above, deviation 6); the second and third were green.
- **`--stage final` has 62 FAILs:** 23-08's 54 plus 8 TESTI ledger rows for this plan's committed test and fixture files. These are Phase 22 final-stage bookkeeping, out of scope per 23-04.
- Git's "LF will be replaced by CRLF" notices come from `core.autocrlf=true`; the blobs are LF.

## Verification (exact commands, Node 22.16.0 via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

**Task verifies:**
- **Task 1:** the plan's command (the AUD-TX-002 file, then check.ts `--stage partial --slice TX`, `--slice BUY` and `--slice EXIT`, then the triage-block check) gave 6/6, PASS, PASS, PASS and exit 0. It was re-run as the tracer gate.
- **Task 2:** AUD-TX-001 and AUD-TX-003 gave 3/3, `--slice TX` PASS, triage blocks present. `AUD-TX-001.test.ts` uses expectStillPending; `AUD-TX-003.test.ts` asserts `abort.at - dispatch.at === 60000` from the timeline.
- **Task 3:** AUD-BUY-004 and AUD-BUY-010 gave 2/2, `--slice BUY` PASS, triage blocks present. `grep -cE "setTimeout\(|sleep\(" AUD-BUY-004.test.ts AUD-BUY-010.test.ts` gives 0 and 0.
- **Task 1 acceptance:** `grep -c "nonceAuthority" test/realpath/harness/setup.ts` = 0.

**Full railed suite (`npm test -- --reporter=json`, final run on the committed tree):**
- 175 files, 1340 tests: 1340 passed, 0 failed, 0 skipped, 0 todo, 0 unhandled errors (run run-20261111T211325-21464-115d4e).
- This plan's tests under the full parallel load: 1809, 1971, 1082, 94, 2003, 295, 1064, 579, 2763, 695, 3757 and 2243 ms. AUD-TX-003 has its own 30 s limit (it measured 6.2 s in the second full run); every other test is under half the 15 s default.
- Rails ledger: `nonLoopbackAllowed` 0 and `telegramAllowed` 0. No ledger entry names any file of this plan (these tests open no loopback server).

**Repeatability (AC-10):** the six files ran three times with the JSON reporter: 12 tests and 8 knownBug records, identical across runs, 0 unhandled errors.

**Gates and type checks:**
- `tsc --noEmit` exits 0 on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json.
- The scratch tsconfig extending the repo's (test/realpath/triage/**/*.ts, module esnext): 0 errors over 40 triage files.
- `npm run check:realpath-mocks`: 34 vi uses (7 mock calls) in 55 files, 0 violations.
- `npm run check:vi-mock`: 591 mock calls in 228 files, 0 violations.

**Register:**
- `check.ts --stage partial`: PASS, fail 0, pending 62. `--stage consolidation`: PASS. `--self-test`: 50/50.
- `--stage triage`: 62 FAILs, all expected:
  - 30 population entries other plans have not recorded;
  - 27 S0/S1 acknowledgements owed to 23-16 (7 of them this plan's: AUD-TX-001, -002, -003, AUD-BUY-004, -010, -025, AUD-EXIT-009);
  - 3 `fork_ref`s (AUD-BUY-015, AUD-BUY-033, AUD-EXIT-003);
  - AUD-TX-006's keep-open ruling;
  - the run-evidence file.

**src and fix signals:**
- `git status --porcelain src` was empty at every commit and after every mutation.
- **Fix-signal proofs:** scratch mutations of `src/`, run on Node 22.16.0. Each was restored with `git -c core.autocrlf=false checkout`, and `git hash-object` was IDENTICAL to the HEAD blob each time.
- The full batch ran every mutation against all six plan files:

| Mutation | Result |
|---|---|
| none | all 12 pass |
| passthrough `tx.wait(3, 120_000)` | AUD-TX-002 looks fixed; every other test passes |
| deliberate public leg `stx.wait(1, 120_000)` | AUD-BUY-025 looks fixed; every other test passes |
| ensureApproval `approveTx.wait(1, 120_000)` | AUD-EXIT-009 looks fixed; every other test passes |
| withNonceLock throws on a nested same-wallet acquire (AsyncLocalStorage holder set) | AUD-TX-001 looks fixed; every other test passes |
| an anti-rug full-exit approval skips the wallet queue | AUD-TX-003 looks fixed; every other test passes |
| an in-process chain+token claim set before the first await of the V2 handler | AUD-BUY-004 looks fixed; every other test passes |
| canSnipe counts and takes an in-process open-position reservation | AUD-BUY-010 looks fixed; every other test passes |
| the attempt-budget case gets its own message | AUD-TX-029 looks fixed; every other test passes |

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

**Plan 23-16 must:**
- acknowledge AUD-TX-001, AUD-TX-002, AUD-TX-003, AUD-BUY-004, AUD-BUY-010, AUD-BUY-025 and AUD-EXIT-009 (all S1) in the batch report;
- collect the 8 knownBug records from these six files into the run evidence.

**Phase 24:**
- Each file can be run alone as a before-and-after proof; the fix shapes the markers see are written in each test header.
- The three RC-10 sites share one fix (card TX-01: a bounded wait inside the lock, with reconciliation). The AUD-TX-002 file shows each site separately.
- AUD-TX-001 and AUD-TX-003 are card OD-17 (re-entrancy guard; a priority lane or abortable escalation). AUD-BUY-004 and AUD-BUY-010 are card BUY-03 (a synchronous claim and reservation).
- AUD-TX-029 belongs with AUD-TX-010 (the knob named in the same text), Phase 29 card TX-03 area.

**Later triage plans:**
- `fixtures/AUD-TX-003-second-launch.ts` gives a second token on the same ETH node and wallet.
- `fixtures/AUD-TX-002-lock.ts` gives a lock probe, a bounded pending window with mining, a missed-bundle driver and the anti-rug teardown settle. Reuse them rather than duplicating.
- Wait for anti-rug registrations to settle (`settleAntiRugArming`) before a test ends whenever a second position is armed. Otherwise teardown cancels a queued eth_subscribe into an unhandled rejection.

## Self-Check: PASSED

- **Files found:** the six triage test files and two fixtures under test/realpath/triage/; .planning/audit/findings/AUD-TX-029.json.
- **Commits found on this branch:** d0713f8, 4c21ac5, 547ed80, 60c2e47 and bdeab46 (`git rev-list --count 0fdb3aa..HEAD` = 5 before this SUMMARY).
- **Re-run after the last commit:** every task's acceptance criteria and the plan-level verification pass.
- **Clean tree:** no scratch file is left under test/ or src/, and `git status --porcelain src test` is empty.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*
