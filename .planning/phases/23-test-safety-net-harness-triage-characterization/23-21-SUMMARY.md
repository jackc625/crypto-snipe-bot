---
phase: 23-test-safety-net-harness-triage-characterization
plan: 21
subsystem: testing
tags: [golden-master, characterization, realpath-harness, flashbots, uniswap-v3, anti-rug, vitest, ethers, CHAR-02]

requires:
  - phase: 23-20
    provides: runScenario, driveSlots, SLOT_MS (driver.ts), the serializer and compare step, recordingsGuard.test.ts, npm run recordings:update
  - phase: 23-28
    provides: createScenario V3 (fireNewPool with the same-block Mint, QuoterV2 and SwapRouter02 reads, feeTier)
  - phase: 23-07
    provides: fixtures/AUD-EXIT-002-position.ts and fixtures/AUD-EXIT-001-sell-path.ts (V3 sell receipt, V3 foreignTrade)
  - phase: 23-10
    provides: fixtures/AUD-ANTIRUG-003-live.ts (liveOverrides, liveGates, afterExitPoll)
  - phase: 23-09
    provides: fixtures/AUD-TX-002-lock.ts settleAntiRugArming
provides:
  - "test/realpath/scenarios/flashbots-v3.test.ts: five Flashbots V3 scenarios (trailing, partial, stop-loss, urgency, anti-rug), the V3 buy-shape proof in buyAndArm, and a file-local real V3 rug (NPM decreaseLiquidity then collect, pool Burn then Collect)"
  - "Five committed recordings: flashbots-v3-trailing, -partial, -stop-loss, -urgency, -anti-rug (.jsonl), each committed once"
affects: [23-22, 23-25, 23-26, phase-24, phase-29]

actuals:
  tokens: 167202   # chars/4 over the added lines of 5d5262e..294363e (6 files, 668810 chars; the urgency recording alone is about 500 KB)
  tasks: 2
  commits: 2       # MEASURED: git rev-list --count 5d5262e..HEAD before this SUMMARY commit
plan_head_before: 5d5262e5bbd402ce1d9e52f4e2d41d5cacaac84e
plan_head_after: 294363e7783dd738e21b6317e7f3c1ec45105079
commits: 2

tech-stack:
  added: []
  patterns:
    - "V3 golden master: the V3 buy shape is asserted in the scenario (QuoterV2 buy quote, SwapRouter02 multicall(deadline,[exactInputSingle]) with the fee tier and the snipe amount as value) before anything is recorded"
    - "V3 rug as a real two-step NPM pull: decreaseLiquidity (pool Burn, held in the 5-block grace window) then collect one slot later (pool Collect, paired with the Burn); active liquidity re-served through FakeNode.setRead, virtual reserves moved pro rata"
    - "Rug depth chosen so every anti-rug signal trips on its real reason (99.9 percent: the held tokens' quote below half its pre-pull value), not through a known bug"

key-files:
  created:
    - test/realpath/scenarios/flashbots-v3.test.ts
    - test/realpath/recordings/flashbots-v3-trailing.jsonl
    - test/realpath/recordings/flashbots-v3-partial.jsonl
    - test/realpath/recordings/flashbots-v3-stop-loss.jsonl
    - test/realpath/recordings/flashbots-v3-urgency.jsonl
    - test/realpath/recordings/flashbots-v3-anti-rug.jsonl
  modified: []

key-decisions:
  - "Tags: trailing, stop-loss, urgency and anti-rug SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-027,AUD-TX-012); partial SUSPECT(AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-025,AUD-EXIT-027,AUD-TX-012); no KEEP (AC-46). V3 adds AUD-BUY-033 (buy multicall carries only exactInputSingle, no refundETH) and AUD-EXIT-027 (sell pays WETH to the wallet, no unwrap) to the V2 set"
  - "The V3 anti-rug timeline does NOT show AUD-ANTIRUG-003 or AUD-EXIT-014 (unlike V2): the Burn is held in its grace window and consumed by the Collect, so one confirm gate, one dispatch and one exit; neither is cited"
  - "The V3 rug pulls 99.9 percent, not the V2 scenario's 95 percent: at 95 percent the held tokens still fetch about 96 percent of their pre-pull value, so signal 3 trips only through AUD-ANTIRUG-006 sub-claim 1 (WETH out over raw tokens in) and the recording would depend on that bug; at 99.9 percent they fetch about a third (assertComplete checks below half)"
  - "The V3 liquidity pull lives in flashbots-v3.test.ts (fixtures/AUD-EXIT-014-rug.ts is V2 only); it uses only the public FakeNode API, so no harness change and no Harness Gap"

patterns-established:
  - "V3 assertComplete: the sell is multicall/exactInputSingle to SwapRouter02 (tokenIn the token, tokenOut WETH, recipient the wallet), mined in node.history, and the node's WETH Transfer(pool, wallet) receipt equals the bot's exit.receipt.decoded and its sell row (pool_type v3, fee_tier)"

requirements-completed: [CHAR-02]

coverage:
  - id: D1
    description: "Flashbots V3 trailing-stop recording (tracer): the V3 buy shape proven, the exit proven complete before the compare"
    requirement: CHAR-02
    verification:
      - kind: integration
        ref: "test/realpath/scenarios/flashbots-v3.test.ts#flashbots-v3-trailing (three normal runs and two full parallel runs byte-identical)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Flashbots V3 partial, stop-loss, urgency and anti-rug recordings, each byte-compared on a normal run after its assertComplete; the anti-rug one live, through the real V3 Burn grace window and Collect"
    requirement: CHAR-02
    verification:
      - kind: integration
        ref: "test/realpath/scenarios/flashbots-v3.test.ts (5 tests), three JSON-reporter runs with identical digests, git diff --exit-code -- test/realpath/recordings clean"
        status: pass
    human_judgment: false
  - id: D3
    description: "Recordings guard (AC-21, AC-22, AC-26, AC-51) over all ten recordings with this plan's files present"
    requirement: CHAR-02
    verification:
      - kind: integration
        ref: "test/realpath/recordingsGuard.test.ts (13 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Scenario tags (AC-21, AC-46): every cited ID is a confirmed finding whose behavior the timeline shows; no confirmed-bug behavior is tagged KEEP"
    requirement: CHAR-02
    verification:
      - kind: integration
        ref: "test/realpath/recordingsGuard.test.ts#every recording under test/realpath/recordings passes AC-21, AC-22, AC-26 and AC-51 (IDs exist)"
        status: pass
    human_judgment: true
    rationale: "Whether each tag names every confirmed finding the timeline shows is a review judgment (the plan's AC-46 verification is 'judgment: review of scenario tags against the register'); per-scenario evidence lines and the findings ruled out are listed below"

duration: 22min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 21: Flashbots V3 Golden-Master Family Summary

**Five byte-compared recordings now lock a Flashbots V3 snipe (QuoterV2 quote, SwapRouter02 multicall buy at the 3000 fee tier) with a trailing, partial, stop-loss, urgency and live anti-rug exit, the anti-rug one driven through the real V3 rug shape (pool Burn held in the 5-block grace window, then the Collect that pairs with it); every recording is tagged SUSPECT with the confirmed findings its timeline shows and was committed exactly once.**

## Performance

- **Duration:** about 22 min
- **Started:** 2026-11-12T16:07:31Z
- **Completed:** 2026-11-12T16:29Z
- **Tasks:** 2 of 2
- **Files:** 6 created, 0 modified

## Accomplishments

- **Task 1 (tracer): the V3 trailing-stop recording.** `buyAndArm` proves the V3 buy shape before anything is recorded: a QuoterV2 `quoteExactInputSingle` with WETH in at the scenario fee tier came first, and the buy is SwapRouter02 `multicall(deadline, [exactInputSingle(WETH -> token, 3000, the wallet, 0.01 ETH)])` carrying 0.01 ETH as value. The scenario then follows the V2 pattern: another wallet's real SwapRouter02 trades move the price, `driveSlots` mines at the 12 s cadence, and `assertComplete` requires the trailing reason, the V3 sell mined, the node's WETH `Transfer(pool, wallet)` receipt equal to the bot's `exit.receipt.decoded` and its sell row (pool_type v3, fee_tier 3000), and the position closed. Guarded, run three times and once under the full parallel load before its one commit (`38d74fd`).
- **Task 2: partial, stop-loss, urgency and anti-rug.** Partial (2x:25) leaves the position open with tier `[0]` stored. Stop-loss is a 41 percent dump. Urgency waits out the 30-minute window with no price move. Anti-rug runs live (`ETH_ANTIRUG_LIVE_EXECUTE=true`, one confirm block, breaker threshold 10, set through the createScenario overrides before the graph loads). The deployer pulls the launch position the way a V3 rug does: NonfungiblePositionManager `decreaseLiquidity` (the pool emits `Burn(owner = NPM)`, the bot logs `antirug.v3-burn-grace-window`), then one slot later NPM `collect` to itself (the pool emits `Collect(owner = NPM, recipient)`, the bot logs `antirug.v3-burn-collect-paired`). Its `assertComplete` requires both of those ops, `antirug.exit.dispatch` with no `antirug.dry-run.would-have-sold` and no breaker trip, active liquidity and the held tokens' quote both below half their pre-pull values, and the SwapRouter02 sell mined with the position closed. Each file was generated once, read whole, guarded, run three times byte-identical and once under the full parallel load before its one commit (`294363e`).

## Task Commits

1. **Task 1: V3 scenario file and the trailing-stop recording (tracer)** - `38d74fd` (test)
2. **Task 2: partial, stop-loss, urgency and anti-rug scenarios and recordings** - `294363e` (test)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

Committed once, checked with `git log --format=%h -- <file>` (no `--follow`): trailing `38d74fd`; partial, stop-loss, urgency, anti-rug `294363e` each, one hash per file.

## Files Created/Modified

- `test/realpath/scenarios/flashbots-v3.test.ts` - the five scenarios, the V3 buy-shape proof, the V3 completion proofs, and the file-local V3 rug (`burnV3Liquidity`, `collectV3Liquidity`)
- `test/realpath/recordings/flashbots-v3-{trailing,partial,stop-loss,urgency,anti-rug}.jsonl` - 56, 47, 53, 771 and 52 lines

## Scenario Tags (AC-21, AC-46)

Line numbers are file lines (line 1 is the header). The buy half (lines 2 to 20) is byte-identical in all five recordings except line 13, where partial's `exit.monitor.started` says `tiers: "2x:25%"`.

**flashbots-v3-trailing** `SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-027,AUD-TX-012)`
- AUD-BUY-033: the buy at line 4 is `multicall(1767225660, [exactInputSingle(...)])` with value 10000000000000000. The batch holds only `exactInputSingle`, with no `refundETH`, so any ETH the pool cannot use stays in the router.
- AUD-DB-004: the buy's relay bodies and submit are at lines 2-7 (+0.00 s). The `trades` insert comes only at line 11 (+12.04 s), after the whole submission returned (inclusion at line 8).
- AUD-TX-012: the buy row (line 11) and the sell's close are decided at the inclusion block with no confirmation depth. The close is lines 47-55: included, executed, receipt, sell row, buy row sold and exit_state deleted, all within 20 ms of the block.
- AUD-DB-002: the buy row's `amount_in` is "0.01", a native decimal (line 11). The sell row's `amount_out` "9900684976949404" and `gas_cost` are wei (line 53).
- AUD-EXIT-003: `entry_price` 49849999502 at line 12 (and at line 13) is the quote of `parseEther("0.01")` raw token units. Every later multiple is a ratio of such quotes (line 21 "2.25", line 24 "1.00x").
- AUD-ANTIRUG-024: chain_state is created with `last_seen_block` "0" (line 17), then `antirug.backfill.gap-detected` (error, gapBlocks 21000002) at line 19.
- AUD-EXIT-004: a public `approve` of exactly the amount sold (1990031876438381866558, the whole position) at ethers' default fees (maxFee 21 gwei = 2 x 10 gwei base + 1 gwei) at line 27, before the private sell.
- AUD-EXIT-001: the private sell at line 34, `exactInputSingle(... amountOutMinimum 0 ...)` inside `multicall`. The same raw is in the relay bodies at lines 32-33 and 35-37.
- AUD-EXIT-027: the same sell (line 34) has tokenOut WETH and recipient the wallet, with no `unwrapWETH9` in the batch. No later transaction of the wallet appears, so the proceeds stay WETH.
- AUD-ANTIRUG-015: the full close (lines 54-56: buy row sold, exit_state deleted, anti-rug unregistered) never deletes the `lp_baseline` row inserted at line 14.

**flashbots-v3-partial** `SUSPECT(AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-025,AUD-EXIT-027,AUD-TX-012)`
- AUD-BUY-033 line 4. AUD-DB-004 lines 2-11. AUD-EXIT-003 lines 12-13. AUD-ANTIRUG-024 lines 17 and 19.
- AUD-EXIT-004: line 24, a public approve of exactly the quarter (497507969109595466639) at default fees.
- AUD-EXIT-001 and AUD-EXIT-027: line 30, the private partial sell with amountOutMinimum 0, tokenOut WETH to the wallet, no unwrap.
- AUD-TX-012: lines 40-44, the partial is recorded as executed and its row written at the inclusion block.
- AUD-DB-002: the `partial_sell` row (line 44) stores token units and wei ("5570453183089815"), against the buy's "0.01" (line 11).
- AUD-EXIT-025: the completed tier is stored as the array index `"[0]"` (lines 45 and 47).
- AUD-ANTIRUG-015 is not cited: the position does not close.

**flashbots-v3-stop-loss** `SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-027,AUD-TX-012)`
- Same buy-half evidence: line 4 (BUY-033), lines 2-11 (DB-004, TX-012), 12-13 (EXIT-003), 17 and 19 (ANTIRUG-024).
- Line 21: the trigger "Fixed stop-loss at 0.59x (-40.8%)", a ratio of probe quotes (EXIT-003).
- Line 24: the public exact approve (EXIT-004). Line 31: the sell with min 0, WETH to the wallet, no unwrap (EXIT-001, EXIT-027).
- Lines 44-52: the close at the inclusion block (TX-012). The sell row is in wei at line 50 (DB-002). Lines 51-53: the close with no lp_baseline delete (ANTIRUG-015).

**flashbots-v3-urgency** `SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-027,AUD-TX-012)`
- Lines 2-20 as above. Lines 21-738 are the 30-minute window: each 5 s poll persists exit_state (359 updates) and logs `exit.poll.cycle`, and nothing else. Line 739 is the urgency trigger at +1812.07 s ("1.00x", a probe ratio).
- Line 742: the public exact approve. Line 752: the sell with min 0, WETH to the wallet.
- Lines 762-770: the close at the inclusion block. Line 768: the sell row in wei. Lines 769-771: the close with no lp_baseline delete.

**flashbots-v3-anti-rug** `SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-027,AUD-TX-012)`
- The rug path: line 23 `antirug.v3-burn-grace-window` (burnBlock 21000003, timeoutBlock 21000008); line 28 `antirug.v3-burn-collect-paired` (collectBlock 21000004); line 29 one `antirug.confirm-gate.scheduled` (trigger 21000004, confirm 21000005); line 34 one `antirug.exit.dispatch` (verdict unsafe). No dry-run line, no breaker trip.
- AUD-EXIT-004: line 35, the public exact approve right after the dispatch. The private sell is sent only after it is mined (line 36, +12 s), so the escape waits one block for its approve.
- AUD-EXIT-001 and AUD-EXIT-027: line 39, the sell with min 0 and priority 2 gwei (the anti-rug gas multiplier 2.0), WETH to the wallet.
- AUD-TX-012 lines 43-51. AUD-DB-002 line 49. AUD-ANTIRUG-015 lines 50-52. AUD-BUY-033, AUD-DB-004, AUD-EXIT-003 and AUD-ANTIRUG-024 as in the buy half.

**Confirmed findings checked and ruled out (all five unless noted):**
- AUD-ANTIRUG-003 and AUD-EXIT-014 (cited in 23-20's V2 anti-rug): not shown here. The V3 Burn is held and the Collect consumes it, so one gate (line 29), one dispatch (line 34) and one exit. There is no duplicate attempt and no sell-lock refusal. Outside anti-rug, each scenario has one exit.
- AUD-ANTIRUG-006 (candidate; sub-claim 1, the V3 signal-3 unit mix-up, is confirmed): signal values are not on the timeline. With the 99.9 percent pull, the held tokens' quote is about a third of its pre-pull value, so the dispatch decision is the same under a fix. Not cited (see Decisions).
- AUD-ANTIRUG-012: one position on the pool. AUD-ANTIRUG-013: the gate's trigger block (21000004) equals the Collect's own block, so the processing-time count is not distinguishable. AUD-ANTIRUG-019, -020, -021, -022: candidates, not confirmed. The single Collect is the Burn's own (same owner and ticks).
- AUD-BUY-003: the buy's amountOutMinimum is 1890530282616462773231, not 0 (line 4). The quote succeeded.
- AUD-BUY-015: the V3 minimum-liquidity check logs no op line, and the pool is liquid. AUD-BUY-017: the Telegram route is not used. AUD-BUY-018: every bundle lands at its first attempt. AUD-BUY-027: the pool is WETH-paired.
- AUD-BUY-001, -002, -004, -010, -020, -025, -029, -030: deliberate-buy, failure and race paths are not exercised. AUD-BUY-009, -022, AUD-DB-018: alert text, which is not recorded.
- AUD-EXIT-007: every V3 private sell lands at its first target, so the "V3 private not landed" return-false path is not reached. AUD-EXIT-013: no restart and no dashboard sell; the position is quoted and sold through the uniswap-v3 dex it was bought on (sell `to` is SwapRouter02).
- AUD-EXIT-002, -005, -008, -009, -015, -019, -021, -022, -024, -026: first-quote failure, overlap (every `exit.poll.cycle` durationMs is 10), dashboard, resume, alert delay, dust, non-zero allowance and fractional slippage paths are not exercised. AUD-EXIT-025 outside partial: the stored list is `"[]"`.
- AUD-TX-006 (candidate), AUD-TX-020 and AUD-EXIT-020 (candidates): not confirmed.
- AUD-TX-007, -010, -021, -027 (reserve and gas-limit math): no reserve is logged, the 10 ETH wallet is never refused, and the buy's gasLimit 150000 cannot be told apart from a capped one. AUD-TX-016, -017, -019, -029: one attempt per bundle at calm fees. AUD-TX-028: no call is held (see Hold Points).
- AUD-DB-001, -003, -013, -014: risk arithmetic is not on the timeline. AUD-DB-021: WAL durability is not observable.
- AUD-ANTIRUG-001, -002, -004, -005, -007, -008, -009, -010, -011, -016, -017, -018, -023, -025: reconnect, restart, retry, backfill (skipped by the gap), HTTP poller, breaker and settings paths. No scenario restarts the graph, so AUD-ANTIRUG-025 does not apply.

## Hold Points (AUD-TX-028)

No scenario holds a call in flight. The buy lands one 12 s slot after submission (`buyAndMine`). After the trigger the chain runs at the 12 s cadence (`driveSlots`). The V3 rug is two foreign transactions mined directly. No provider read, relay call or bundle is parked, so AUD-TX-028 cannot decide a result.

## Decisions Made

- **Rug depth (anti-rug):** The plan asks for "the follow-up quote or reserve read below 50 percent of baseline". The first draft used the V2 scenario's 95 percent pull. It dispatched, but at 95 percent the held 1990 tokens still fetch about 96 percent of their pre-pull WETH (0.00954 against 0.00995 ETH). Signal 3 tripped only because today's V3 signal 3 divides WETH out by raw tokens in (AUD-ANTIRUG-006 sub-claim 1, confirmed). A Phase 24 fix of that would have stopped the recorded exit. The committed scenario pulls 99.9 percent, so the held tokens fetch about 33 percent, and `assertComplete` checks below half. Each of the three signals now trips on its real reason. This is consistent with the confirmed sub-claim, so no register change is needed.
- **Tags:** listed above. AUD-BUY-033 and AUD-EXIT-027 are the V3-only additions. AUD-ANTIRUG-003 and AUD-EXIT-014 are absent on V3 because of the grace-window pairing.
- **Two blocks for the rug:** the Collect is mined one slot after the Burn (block 21000004 against 21000003), inside the 5-block window. This exercises the real hold-then-pair path rather than a same-block Burn and Collect.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] The V3 rug depth was raised so signal 3 is real, and the scenario proves it**
- **Found during:** Task 2 (reading the first anti-rug draft whole)
- **Issue:** At the 95 percent pull carried over from the V2 scenario, the plan's "follow-up quote below 50 percent of baseline" was false. The exit fired only through AUD-ANTIRUG-006 sub-claim 1, so the recording would have depended on a confirmed bug.
- **Fix:** Pull 99.9 percent. `assertComplete` now also asserts that the held tokens' quote (the QuoterV2 read on the pool's virtual reserves) is below half its pre-pull value, and that active liquidity is below half the baseline.
- **Files modified:** test/realpath/scenarios/flashbots-v3.test.ts
- **Verification:** the regenerated recording shows the same grace, pairing, gate and dispatch path; three runs are byte-identical.
- **Committed in:** 294363e

---

**Total deviations:** 1 auto-fixed (1 Rule 2).
**Impact on plan:** The anti-rug recording is now independent of AUD-ANTIRUG-006. No harness, driver, fixture, guard or src/ file was changed.

## Grade Changes and New Findings

None. No finding was registered, regraded or changed in status, and no register file was edited, so AUDIT-FINDINGS.md was not re-rendered. One observation is consistent with an already-confirmed sub-claim: the 95 percent draft dispatched although a real sell-impact check would not have (AUD-ANTIRUG-006 sub-claim 1).

## Issues Encountered

- Every recording holds one error-level line: `antirug.backfill.gap-detected` on a fresh database (line 19). That is AUD-ANTIRUG-024, cited in every tag. No other warn, error or fatal line appears in any recording, and the scenario and guard runs printed none.
- Each full run printed two `RAIL_NOTIFIER_REFUSED` warn lines. Their stack names `test/integration/rails/notifierRefusalIntegration.test.ts:54`, which forces that refusal on purpose. They are not from this plan's tests and appeared in both full runs.
- A first scratch type-check failed with TS1343 (`import.meta`) on existing harness files. The scratch tsconfig lacked `module: esnext`. With it, `test/realpath/**` type-checks with 0 errors.

## Timing

| Test | Alone (3 runs) | Full parallel runs | Limit |
|------|----------------|--------------------|-------|
| flashbots-v3-trailing (pays the cold graph import) | 1.47 / 1.66 / 1.65 s | 2.21 s (run 1), 2.89 s (run 2) | 15 s |
| flashbots-v3-partial | 0.26 / 0.26 / 0.32 s | 1.16 s | 15 s |
| flashbots-v3-stop-loss | 0.29 / 0.28 / 0.28 s | 1.14 s | 15 s |
| flashbots-v3-urgency | 1.01 / 0.74 / 0.72 s | 3.64 s | 15 s |
| flashbots-v3-anti-rug | 0.93 / 0.89 / 0.76 s | 3.24 s | 15 s |

No test of this plan is near half its limit, so none has its own `{ timeout }`. No hook is declared.

Existing tests, measured under the full runs (not this plan's, left unchanged):
- backupState's self-check took 62.3 s and 69.5 s of 120 s (52 and 58 percent). 23-19 measured 52-66 s and 23-20 measured 47.6-60.9 s, so this is the known load-sensitive child test and STATE watch item; it was already over half at times before this plan. Run 2 carried this plan's four extra scenarios (about 9 s of test time across the workers).
- signingCensusGate took 63.1 s and 68.1 s of 250 s.
- buyNonceLock "exposes submitBuyTx" took 2.75 s and 2.77 s, its hook case as measured at the wave 12 gate.

## Verification (Node 22.16.0)

- Task 1 verify: scenario and guard pass, the file exists, `git check-attr eol` is `lf`. The tracer gate re-ran it after `38d74fd` and it passed.
- Task 2 verify (after `294363e`): three runs of the scenario file and the guard, 18/18 each, then `git diff --exit-code -- test/realpath/recordings` clean. `git status --porcelain test/realpath/recordings` prints nothing.
- AC-24 / AC-10: three JSON-reporter runs gave identical digests of names, statuses and knownBug records (none in these files). All five files matched their generated sha256 after every normal run and after the full parallel run.
- Acceptance: five `flashbots-v3-*.jsonl` exist. 0 CR, 0 `.ts:<n>` fragments. `git status --porcelain src` is empty.
- Full railed `npm test`: run 1 (trailing only, 38d74fd tree) 203 files, 1420/1420, wall 182 s, ledger run-20261112T161053-15080-cc84d4. Run 2 (final tree, identical to 294363e) 203 files, 1424/1424, wall 196 s, ledger run-20261112T161922-14976-1e8c4f. Both ledgers: nonLoopbackAllowed 0, telegramAllowed 0.
- `tsc --noEmit` is clean on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json. A scratch tsconfig extending the repo's (module esnext) gives 0 errors over `test/realpath/**`.
- `check:realpath-mocks`: 35 vi uses, 7 mock calls, 97 files, 0 violations. `check:vi-mock`: 660 calls, 0 violations. `check:census`: 23 sites (10 locked, 13 unlocked), 0 problems. sourceTextGate, spawnSites, realpathMockGate and signingCensusGate: 17/17. The AC-37 allow list is untouched.
- `red-proof-conversions.ts --check-manifest`: MANIFEST-OK rows 36 files 11 guards 1 (unchanged).
- `check.ts`: `--stage partial`, `consolidation` and `triage` all RESULT PASS fail 0. No existing file was edited, so no re_audit row is needed. `--stage final` gives 141 FAILs, 6 of them from this plan: TESTI.json ledger rows for the 6 new files, the same out-of-scope bookkeeping kind earlier Phase 23 plans reported (135 before this plan).

## For Later Plans

- **23-22:** the V3 rug helpers (`burnV3Liquidity`, `collectV3Liquidity`) are file-local in flashbots-v3.test.ts. Copy them, or move them into a fixture in a plan that owns that file; only the public FakeNode API is used. The V3 anti-rug path pairs Burn and Collect, so expect one gate and one dispatch, not AUD-ANTIRUG-003's duplicates. A V3 anti-rug scenario needs a pull deep enough that the held tokens' quote falls below half, or its exit depends on AUD-ANTIRUG-006.
- **Phase 24:** a fix of AUD-BUY-033 (refundETH in the buy batch) changes line 4 of all five recordings. A fix of AUD-EXIT-027 (unwrap in the sell batch) changes the sell lines. A fix of AUD-EXIT-004 (approve at buy time or bundled) moves the approve and the 12 s wait before every sell. Each needs a `behavior:` re-record citing its ID (D-18).

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

The Flashbots V3 family is locked. 23-22 (bloXroute, public, risk-gate and gas families) can reuse this file's patterns. CHAR-02 is shared with 23-20, 23-22 and 23-26, so it stays unmarked in REQUIREMENTS.md until the last of them finishes.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*

## Self-Check: PASSED

- Files present: test/realpath/scenarios/flashbots-v3.test.ts and the five flashbots-v3-*.jsonl recordings.
- Commits on this branch: 38d74fd and 294363e are both ancestors of HEAD.
- Commit count measured from the ledger: git rev-list --count 5d5262e..294363e = 2.
- The acceptance criteria of both tasks and the plan-level verification were re-run after the last task commit, and all pass.
