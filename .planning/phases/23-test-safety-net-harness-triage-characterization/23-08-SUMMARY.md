---
phase: 23-test-safety-net-harness-triage-characterization
plan: 08
subsystem: testing
tags: [vitest, ethers, realpath-harness, triage, knownBug, audit-register, exit-engine, dashboard-api, anti-rug, flashbots, json-rpc-batching]

requires:
  - phase: 23-01
    provides: FakeNode reads, failNext and hold with exact targets and fired checks, createScenario, the fixed clock
  - phase: 23-28
    provides: createScenario for V2 and V3, mine({ include, logs }), the Flashbots route, setReceiptLogs
  - phase: 23-02
    provides: knownBug marker, recordedLogs/recordedAlerts, the timeline (db writes, ops), the AC-02 mock-list gate
  - phase: 23-27
    provides: the Harness Gap Procedure (no gap was raised)
  - phase: 23-04
    provides: set-triage.ts, check.ts triage rules
  - phase: 23-06
    provides: fixtures/AUD-BUY-011-dashboard.ts (the real dashboard on a loopback port, real login)
  - phase: 23-07
    provides: fixtures/AUD-EXIT-002-position.ts and fixtures/AUD-EXIT-001-sell-path.ts (buy, arm, sell side of the chain, foreign trades)
provides:
  - "Six real-path triage files (AUD-API-001, AUD-EXIT-008, -007, -005, -014 and the new AUD-TX-028): 8 tests, 8 knownBug claims; each claim reads looks fixed under a fix-shaped src mutation, and a full cross-file batch shows every mutation flips only its own finding's claims"
  - "Triage outcomes for the five plan findings, all confirmed"
  - "fixtures/AUD-API-001-dashboard-sell.ts (driveChain, postDriven, heldPosition, incomingHolder) and fixtures/AUD-EXIT-014-rug.ts (a real router liquidity pull)"
  - "One new register entry graded under the standing instruction: AUD-TX-028 (S2, STRAND)"
affects: [23-16, phase-24, phase-29]

actuals:
  tokens: 22805    # chars/4 over the added lines of 8cd482d..77f5217 (17 files, 91220 chars, incl. the AUDIT-FINDINGS.md render)
  tasks: 2
  commits: 4       # MEASURED: git rev-list --count 8cd482d..HEAD before this SUMMARY commit
plan_head_before: 8cd482dc37b64a6fea5c4830ee674bab4947622f
plan_head_after: 77f52175d1a92ffa32dca3c896cee61e855a35f3
commits: 4

tech-stack:
  added: []
  patterns:
    - "A dashboard request is sent over node:http while the chain is driven (driveChain): public wallet transactions are mined in the next block, each bundle gets one slot and then lands at a block it targets, or the slot passes with an empty block"
    - "A position reaches a code path through the bot's own actions: a real dashboard force-sell drives the catch path; a sell landing in the same block as a real incoming transfer keeps the row pending"
    - "An overlap is read from the exact event order (one counter numbers the node's calls and the bot's logs), never from sampling, so no fix shape depends on step size"
    - "An in-flight exit is kept inside its lock by a held relay call, not a held HTTP read, because a held read stalls the whole HTTP provider (AUD-TX-028)"

key-files:
  created:
    - test/realpath/triage/AUD-API-001.test.ts
    - test/realpath/triage/AUD-EXIT-008.test.ts
    - test/realpath/triage/AUD-EXIT-007.test.ts
    - test/realpath/triage/AUD-EXIT-005.test.ts
    - test/realpath/triage/AUD-EXIT-014.test.ts
    - test/realpath/triage/AUD-TX-028.test.ts
    - test/realpath/triage/fixtures/AUD-API-001-dashboard-sell.ts
    - test/realpath/triage/fixtures/AUD-EXIT-014-rug.ts
    - .planning/audit/findings/AUD-TX-028.json
  modified:
    - .planning/audit/findings/AUD-API-001.json
    - .planning/audit/findings/AUD-EXIT-005.json
    - .planning/audit/findings/AUD-EXIT-007.json
    - .planning/audit/findings/AUD-EXIT-008.json
    - .planning/audit/findings/AUD-EXIT-014.json
    - .planning/audit/ledger/TX.json
    - .planning/audit/sweep/contrib-PHASE23.json
    - .planning/audit/AUDIT-FINDINGS.md

key-decisions:
  - "All five plan findings recorded confirmed; none unreproduced and none NOT-A-BUG, so nothing here needs an operator ruling before 23-16 beyond the S1 acknowledgements (AUD-API-001, AUD-EXIT-007, -008, -014)"
  - "AUD-API-001 is proven as two tests, one per route, each on its own failed-held position, so a fix of one route flips only its own claim"
  - "AUD-EXIT-007's marker measures the poll timer only, so both recommended fixes (route the returns through keepMonitoringFailedHeld, or re-arm in the caller) read looks fixed; the missing exit_failed_held stamp is asserted after the marker"
  - "AUD-EXIT-007's unknown-dex claim is reached with a V3 row whose fee_tier is NULL; no current writer produces one, so it proves the branch, not reachability"
  - "AUD-EXIT-014's in-flight exit is held at its Flashbots simulation (eth_callBundle), not at a read, so the anti-rug evaluation is not decided by AUD-TX-028"
  - "New AUD-TX-028 (S2, STRAND) registered by the executor under the standing instruction, without a stop"

patterns-established:
  - "Scratch runners in the session scratchpad: mutate.cjs (named fix-shaped src mutations, JSON reporter, byte-exact restore and proof), logdump.cjs (a non-throwing afterEach that records every warn/error/fatal line), ac10.cjs (three JSON runs compared), summ.cjs (full-run report)"

requirements-completed: [AUDIT-02]

coverage:
  - id: D1
    description: "AUD-API-001: after a real dashboard force-sell drives the position through the catch path (private attempts miss, the public fallback swap refused at gas estimation, tokens still held), force-sell answers 404 and emergency-sell answers 'No open positions to sell', and neither sends a sell"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-API-001.test.ts (2 tests; select-failed-held flips both, emergency report-only flips only the emergency claim)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUD-EXIT-008: on a row that stays pending with routine retries paused (EXIT_ROUTINE_MAX_FAILURES=1), the dashboard force-sell answers 409, logs exit.routine.paused-skip and sends no sell"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-EXIT-008.test.ts (1 test; operator-bypass mutation gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUD-EXIT-007: the V3 no-fallback and unknown-dex returns leave a held position with no poll timer after the dashboard cleared it"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-EXIT-007.test.ts (2 tests; keep-monitoring and caller-rearm mutations each flip both)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUD-EXIT-005 (AC-12): with one exit quote held, the next tick starts a second poll cycle of the same position; both write the one shared exit_state"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-EXIT-005.test.ts (1 test; in-flight guard and 3 s quote timeout each give looks fixed; the static-network fix of AUD-TX-028 leaves it reproduced)"
        status: pass
    human_judgment: false
  - id: D5
    description: "AUD-EXIT-014 (AC-12): a rug detected while a routine stop-loss exit holds the sell lock gets an anti-rug exit that returns false at once"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-EXIT-014.test.ts (1 test; wait-for-the-lock mutation gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AUD-TX-028 (new): while one HTTP call of the provider is unanswered, the anti-rug evaluation of a real liquidity pull gets its reads answered and still cannot finish"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-TX-028.test.ts (1 test; staticNetwork mutation gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D7
    description: "AC-48: no test passes on answers a real node, router or token could never give (the refused swap is geth's code 3 revert; the incoming transfer is a real signed ERC-20 transfer from a holder with the balance; the liquidity pull moves reserves by the pair's own math)"
    verification: []
    human_judgment: true
    rationale: "The plan family marks this prohibition as judgment: review of fake transport data"

duration: 51min
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 08: Exit Lifecycle and Dashboard-Sell Findings on the Real Path Summary

**All five findings now fail on the real path, through the real dashboard routes and the real exit and anti-rug code:**
- After a sell fails with the tokens still held, the dashboard's force-sell answers 404 and emergency-sell answers "No open positions to sell".
- Once routine retries are paused, force-sell answers 409 "Sell already in progress" and sends nothing.
- A V3 sell that does not land (or an unknown dex) leaves the held position with no poll timer.
- A slow quote lets two poll cycles of one position run together on one shared state.
- An anti-rug exit fired while another exit holds the token's sell lock gives up at once.

**Found on the way, one new S2 entry, AUD-TX-028:** the bot's HTTP provider has no static network, so one stalled HTTP call stalls every later call of the provider, the anti-rug evaluation of a rug included, for up to 300 s.

## Performance

- **Duration:** about 51 min
- **Started:** 2026-11-11T19:34:07Z
- **Completed:** 2026-11-11T20:25Z
- **Tasks:** 2 of 2. Task 1 tracer gate (interactive, end-of-phase mode, automated-only verify): the verify was re-run on the committed tree and passed (TRACER-VERIFY-OK), then Task 2 started.
- **Files:** 17 (8 test files created, 1 register file created, 8 register files modified)

## Per-finding outcomes

| Finding | Sev | Outcome | Test file and claims | What was proven | Left open |
|---|---|---|---|---|---|
| AUD-API-001 | S1 | confirmed | AUD-API-001.test.ts: `force-sell-skips-failed-held`, `emergency-sell-skips-failed-held` | A real ETH V2 snipe, then the operator's first force-sell through the real dashboard (real login and routes, node:http on loopback). Its two private attempts miss their slots; the public fallback swap is refused at gas estimation (geth code 3, "TransferHelper: TRANSFER_FROM_FAILED", what the router returns when a token blocks sells). The catch path runs with every token still held. Preconditions: trades.status `failed`, exit_status `exit_failed_held`, the fault fired once. Then force-sell answers 404 "Trade not found or already closed" and emergency-sell answers `{ ok: true, sold: 0, failed: 0, message: 'No open positions to sell' }`. Neither sends a sell. The bot's own restart query counts the position as open. | The display siblings (position list, trade-history label, risk counts) stay code-read |
| AUD-EXIT-008 | S1 | confirmed | AUD-EXIT-008.test.ts: `operator-sell-refused-while-routine-paused` | On a row that stays `pending` (review concern HIGH): EXIT_ROUTINE_MAX_FAILURES=1. A real stop-loss sell lands in the same block as another holder's real token transfer to the wallet, so balanceOf after the sell stays above dust. The success path then runs keepMonitoringFailedHeld. Asserted before the request: `pending`, `isRoutinePaused` true, `exit.failed.held.routine-paused` for the trade, the "[EXIT ROUTINE PAUSED] ... resume manually" alert. The real force-sell then answers 409 "Sell already in progress for this position", logs `exit.routine.paused-skip` for reason `urgency-market-sell`, and sends no sell. No lock was held. | Emergency-sell takes the same gate (code-read) |
| AUD-EXIT-007 | S1 | confirmed | AUD-EXIT-007.test.ts: `v3-private-not-landed-leaves-no-poll`, `unknown-dex-leaves-no-poll` | Through the dashboard caller, which clears the poll timer first. (1) A real ETH Uniswap V3 force-sell: two private attempts miss and the V3 no-fallback return is taken (`exit.fallback.unsupported-dex`). The alert says "stays held + monitored", yet there is no exit-monitor timer, exit_status is null and the failure count is 0. (2) With the buy row's fee_tier set to NULL, the unknown-dex return leaves the same state before any approve. | The routine-pause return (:829) is AUD-EXIT-008's path; the anti-rug caller is code-read |
| AUD-EXIT-005 | S2 | confirmed | AUD-EXIT-005.test.ts: `poll-cycles-overlap-on-slow-quote` | AC-12. The next exit quote is held on the node. Past the next 5 s tick, a second poll cycle starts and sends its own quote while the first is pending: two in flight, read from the exact event order. A foreign trade moves the price and the hold is released. Both cycles then write the one shared exit_state: the later write carries every sample of the earlier one plus its own, and only the first cycle reports the overrun, when it completes. | Socket pile-up over a long stall (more than one interval) is not measured |
| AUD-EXIT-014 | S1 | confirmed | AUD-EXIT-014.test.ts: `antirug-exit-refused-while-sell-lock-held` | AC-12, ETH anti-rug live. A real stop-loss exit takes the sell lock, approves (mined) and is held at its Flashbots simulation. The deployer then pulls 95 percent of the liquidity through the real router (the pair's own Transfer, Sync and Burn logs). The real detector rules the rug unsafe, the one-block confirm gate passes, and the anti-rug exit is dispatched. Its exit-fired broadcast comes back with `success: false` at once. The line "Another exit already handling token, skipping" appears on the plain logs list (reason anti-rug, no `op`, review concern MEDIUM). The lock is held and no sell is sent. Released, the routine exit sells with reason `stop-loss` and the position closes. | The cross-token delay behind the wallet nonce lock (the finding's second half) stays code-read |

None of these entries is unreproduced or NOT-A-BUG.

## Task Commits

1. **Task 1 (tracer): AUD-API-001, AUD-EXIT-008, AUD-EXIT-007** - `85352d2` (test)
2. **Task 2: AUD-EXIT-005, AUD-EXIT-014** - `470326d` (test). Also holds the `driveChain` refactor of the Task 1 fixture.
3. **New finding found during Task 2: AUD-TX-028 (proven)** - `85cb58a` (test)
4. **Fixture header names driveChain and incomingHolder (comment only)** - `77f5217` (test)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## New findings and grade/status changes

Made under the operator's standing instruction of 2026-11-11 ("All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading"), without a stop.

| Item | Change | Evidence |
|---|---|---|
| AUD-TX-028 (new) | **Registered:** S2, capital STRAND, confirmed, class C12.<br>**Records:** TX ledger row `src/utils/provider.ts`; sweep `src x C12` in `contrib-PHASE23.json`; triage confirmed (not in the frozen 61, recorded so check.ts can locate its claim). | **Code:**<br>- `src/utils/provider.ts:23` builds `new ethers.JsonRpcProvider(url)` with no network and no `staticNetwork`. Every chain context's `httpProvider`, and its wallet, comes from it (`chainRegistry.ts:1065-1067`).<br>- In ethers 6.16.0, every `call`, `getBalance` and similar runs `#checkNetwork` (`abstract-provider.js:707-719`). That shares one pending `eth_chainId` (`provider-jsonrpc.js:401-430`), sent by `send()` in the same 10 ms batch as the call that started it.<br>- A JSON-RPC server answers a batch in one response. So while that batch is unanswered, every later call of the provider gets its own answer and still cannot return.<br>**Found while proving AUD-EXIT-005:** ethers' own debug trace showed the held quote sent as `[eth_call, eth_chainId]`. The next cycle's quote was answered at once, yet that cycle did not finish.<br>**Real path:** AUD-TX-028.test.ts, claim `stalled-call-stalls-antirug-evaluation`. With an exit quote held, a 95 percent liquidity pull's anti-rug evaluation gets getReserves and totalSupply answered, but never schedules its confirm gate. No `eth_chainId` reaches the node until the release; then the evaluation finishes. `staticNetwork` reads looks fixed.<br>**Grade:** S2, as AUD-TX-008: the stall is bounded by the 300 s idle timeout, but for its length every exit and the anti-rug evaluation on the chain stop together. |

**No severity or status changed on the five plan findings.** All were already confirmed, and set-triage kept them confirmed.

**Observed, not asserted (owned elsewhere):** in AUD-EXIT-014 one router liquidity pull gave several anti-rug dispatches, and the chain's circuit breaker tripped (`antirug.cb-tripped`). That is AUD-ANTIRUG-003's claim (S1 candidate), left to its own triage plan; this plan's files never count dispatches.

## Files Created/Modified

- `test/realpath/triage/AUD-API-001.test.ts`, `AUD-EXIT-008`, `-007`, `-005`, `-014`, `AUD-TX-028.test.ts`: the six triage files (8 tests, 8 claims).
- `test/realpath/triage/fixtures/AUD-API-001-dashboard-sell.ts`:
  - `driveChain`: the network answering the wallet;
  - `postDriven`: a POST to a real route while the chain is driven;
  - `heldPosition`;
  - `incomingHolder`: a real ERC-20 transfer to the wallet, counted in balanceOf once mined;
  - `exitStatusOf`, `sellsSince`, `stepUntilOrFor`.
- `test/realpath/triage/fixtures/AUD-EXIT-014-rug.ts`: `pullLiquidity`, the deployer's real `removeLiquidityETH` with the pair's events; `lpTotalSupply`.
- `.planning/audit/findings/AUD-API-001/-EXIT-005/-007/-008/-014.json`: triage blocks (set-triage.ts).
- `.planning/audit/findings/AUD-TX-028.json`, `ledger/TX.json`, `sweep/contrib-PHASE23.json`: the new finding.
- `.planning/audit/AUDIT-FINDINGS.md`: re-rendered with render.ts. OPERATOR-DECISIONS.md is byte-unchanged and SEAL.json is untouched.

## Decisions Made

See `key-decisions`. In short:
- Every marker measures the harm: whether the operator's sell is sent, whether the held position is still polled, how many cycles run together, whether the anti-rug exit gives up at once, whether the anti-rug evaluation finishes. So the recommended fixes read "looks fixed". Fix shapes are named in each test header.
- Setup facts hold under the bug, under the fixes, and under every other finding's fix in this plan, AUD-TX-028's included. A full cross-file mutation batch showed this.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Proof strength] The real dashboard server, not a bare router on port 0**
- **The plan:** mount `controlRoutes` on an express app on 127.0.0.1 port 0.
- **What I did:** the tests run the real `startApiServer` through the 23-06 fixture: the real auth middleware in front, the real login, a free loopback port picked just before (the server reads DASHBOARD_PORT, so port 0 cannot be passed).
- Calls go through node:http, never axios.
- **Committed in:** 85352d2

**2. [Rule 2 - Proof strength] AUD-API-001 driven by the operator's own first press, one test per route**
- **The catch path:** reached by a real dashboard force-sell. A routine exit would keep retrying every 5 s and send sells during the claims, so the "no new sell" evidence would not hold.
- **Two tests:** each on its own position. On a shared position a fixed force-sell would sell it before emergency-sell is tried.
- **Committed in:** 85352d2

**3. [Rule 2 - Missing piece] AUD-EXIT-008's "sell reports success while balanceOf stays above dust"**
- **What the plan left open:** how the sell reports success while balanceOf stays above dust.
- **How:** another holder's real signed ERC-20 transfer to the wallet, mined in the same block as the sell. The holder has the balance it sends, so a real token would accept the transfer.
- **Committed in:** 85352d2

**4. [Rule 2 - Fix signal] AUD-EXIT-007's marker on the poll timer only**
- **The plan:** named both "exit_status is exit_failed_held" and "a timer exists" as correct.
- **Why not both:** the recommendation's caller-re-arm fix restores the timer without the stamp, and would have read "the failure changed".
- **What I did:** the marker reads the timer, and the missing stamp is asserted after it. Both fix shapes read looks fixed (mutation-proven).
- **Committed in:** 85352d2

**5. [Rule 1 - Bug in my own test] AUD-EXIT-005's first marker counted the held node call, not cycles**
- **Found by:** the quote-timeout mutation. With a timeout shorter than the poll, the first cycle really ends before the next starts. The first marker still read 2.
- **Fix:** the marker counts cycles in flight from the exact event order (each cycle's quote is its start; `exit.poll.cycle` or the poll error is its finish).
- **Details:** the post-marker details were made independent of AUD-TX-028, whose fix changes which cycle finishes first.
- **Verification:** in-flight guard and quote timeout each give looks fixed; `staticNetwork` leaves AUD-EXIT-005 reproduced.
- **Committed in:** 470326d

**6. [Rule 2 - Correct isolation] AUD-EXIT-014 holds the relay simulation, not "a read inside" the exit**
- **Why:** a held HTTP read stalls every later call of the provider (AUD-TX-028), the anti-rug evaluation included. The test would then be decided by that finding.
- **What I did:** the in-flight exit is kept inside its lock by holding its Flashbots `eth_callBundle`. That call is on the relay's own connection, so the HTTP provider stays free.
- **Committed in:** 470326d

**7. [Rule 1 - Bug in my own fixture] The drive loop recovered every transaction's sender on every step**
- **Issue:** ethers' `Transaction.from` recomputes the sender from the signature on every read, and the loop read it for every submission at every 50 ms step. A 173 s drive took 57 s of wall time.
- **Fix:** each submission's sender is now read once (`senderOf`). The same drive takes 0.3 s.
- **Committed in:** 85352d2

**8. [Rule 1 - Bug in my own test] AUD-EXIT-014's landing used a consumed block window**
- **Issue:** ethers' cached block number made the routine sell bundle target an older window, and the rug and confirm blocks used it up.
- **Fix:** the drive loop moved into `driveChain`, which lands a bundle only at a block it targets. Otherwise the slot passes and the bot's next attempt lands.
- **Committed in:** 470326d

**9. [Rule 2 - Missing critical] A bug not in the register was registered, under the standing instruction**
- AUD-TX-028; see the table above.
- **Committed in:** 85cb58a

---

**Total deviations:** 9 (Rule 1: 3, Rule 2: 6). **Impact:**
- Stronger proofs, and setups that stay valid under every fix in this plan.
- One new register entry.
- `src/` is unchanged, and nothing under `test/realpath/harness/` was written. No HARNESS GAP was needed.

## Issues Encountered (all diagnosed)

- **AUD-EXIT-005's second cycle did not finish while the first quote was held.** ethers' debug trace showed why: the held quote went out as a batch `[eth_call, eth_chainId]`, and every later call waits on that network check. A real server also answers a batch only when every member is done. This is the new AUD-TX-028.
- **Warn/error lines in every run, all explained** (dumped per test with a non-throwing scratch afterEach):
  - `antirug.backfill.gap-detected`: AUD-ANTIRUG-024, registered.
  - The private-escalation and fallback lines: the forced failure sequences.
  - `antirug.cb-tripped` in AUD-EXIT-014: AUD-ANTIRUG-003.
  - The first bundle attempt missing in AUD-EXIT-014: deviation 8.
- **Shell quoting broke a few edits.** A sed rewrite and a backtick-heavy `node -e` damaged the files under edit (one line of the fixture, then a debug line and later the new `driveChain` code). Each was caught by a TypeScript transform error, a non-matching pattern or a garbled print before any result was counted. Later edits went through the Edit tool or scratchpad scripts.
- **One debug backup was written to /tmp** instead of the scratchpad, then deleted.
- **`--stage final` has 54 FAILs.**
  - 8 are TESTI ledger rows for this plan's committed test and fixture files: Phase 22 final-stage bookkeeping, out of scope per 23-04.
  - The other 46: 24 TESTI rows for the triage files of 23-05..23-07, and 22 rows for other Phase 23 files (the realpath harness and its self-tests, the migration golden files, test helpers, scripts/check-realpath-mocks.ts and four re_audit rows).
  - 23-07's "43" was measured before its last three files were committed: 43 + 3 = 46.
- Git's "LF will be replaced by CRLF" notices come from `core.autocrlf=true`; the blobs are LF.

## Verification (exact commands, Node 22.16.0 via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

**Task verifies (each on the committed tree):**
- **Task 1:** the plan's command (three files, then check.ts `--stage partial --slice API` and `--slice EXIT`, then the triage-block check) gave 5/5, PASS, PASS and TRACER-VERIFY-OK. It was re-run as the tracer gate.
- **Task 2:** the plan's command gave 2/2, PASS and exit 0. `grep -cE "setTimeout\(|sleep\(" AUD-EXIT-005.test.ts AUD-EXIT-014.test.ts` gives 0 and 0.

**Full railed suite (`npm test -- --reporter=json`):**
- 169 files, 1328 tests: 1328 passed, 0 failed, 0 skipped, 0 todo (run run-20261111T201345-22096-4e45c6).
- This plan's tests under the full parallel load: 2516, 1104, 1716, 2733, 386, 3725, 2108 and 1227 ms. All are under half the 15 s default limit, so none has its own timeout.
- Rails ledger: `nonLoopbackAllowed` 0 and `telegramAllowed` 0. The new dashboard fixture appears as a triggering file with 7 `net-allow` entries, all 127.0.0.1 (class loopback): one per dashboard POST.

**Repeatability and the whole project:**
- **AC-10:** the six files ran three times with the JSON reporter: 8 tests and 8 knownBug records, identical across runs.

**Gates and type checks:**
- `tsc --noEmit` exits 0 on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json.
- The scratch tsconfig extending the repo's (test/realpath/triage/**/*.ts): 0 errors over 32 triage files.
- `npm run check:realpath-mocks`: 33 vi uses (7 mock calls) in 47 files, 0 violations.
- `npm run check:vi-mock`: 591 mock calls in 221 files, 0 violations.

**Register:**
- `check.ts --stage partial`: PASS, fail 0, pending 62. `--stage consolidation`: PASS. `--self-test`: 50/50.
- `--stage triage`: 62 FAILs, all expected:
  - 37 population entries other plans have not recorded;
  - 20 S0/S1 acknowledgements owed to 23-16 (4 of them this plan's: AUD-API-001, AUD-EXIT-007, -008, -014);
  - 3 `fork_ref`s (23-05's two and AUD-EXIT-003);
  - AUD-TX-006's keep-open ruling;
  - the run-evidence file.

**src and fix signals:**
- `git status --porcelain src` was empty at every commit and after every mutation.
- **Fix-signal proofs:** scratch mutations of `src/`, run on Node 22.16.0. Each was restored with `git -c core.autocrlf=false checkout`, and `git hash-object` was IDENTICAL to the HEAD blob each time.
- The full batch ran every mutation against all six plan files:

| Mutation | Result |
|---|---|
| none | all 8 pass |
| api001-select-failed-held (pending plus exit_failed_held in both control queries) | both AUD-API-001 claims look fixed; every other test passes |
| api001-emergency-report-only (emergency-sell names the skipped failed-held position) | only `emergency-sell-skips-failed-held` looks fixed |
| exit008-operator-bypass (dashboard sells skip the routine-pause gate) | AUD-EXIT-008 looks fixed; every other test passes |
| exit007-keep-monitoring (both returns go through keepMonitoringFailedHeld) | both AUD-EXIT-007 claims look fixed; every other test passes |
| exit007-caller-rearm (force-sell re-arms the monitor when the sell returns false) | both AUD-EXIT-007 claims look fixed; every other test passes |
| exit005-inflight-guard / exit005-quote-timeout (3 s) | AUD-EXIT-005 looks fixed each time; every other test passes |
| exit014-antirug-waits-for-lock | AUD-EXIT-014 looks fixed; every other test passes |
| tx028-static-network | AUD-TX-028 looks fixed; every other test, AUD-EXIT-005 and -014 included, passes |

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

**Plan 23-16 must:**
- acknowledge AUD-API-001, AUD-EXIT-007, -008 and -014 (S1) in the batch report;
- collect the 8 knownBug records from these six files into the run evidence.

**Phase 24:**
- Each file can be run alone as a before-and-after proof; the fix shapes the markers see are written in each test header.
- AUD-API-001 (card API-01) and AUD-EXIT-008 (card EXIT-07) are one dashboard-sell fix. Together the two files show that a failed-held position cannot be sold from the dashboard on either path.
- AUD-EXIT-007's anti-rug caller, AUD-EXIT-014's cross-token nonce-lock delay and the AUD-API-001 display siblings are code-read only, and should get a test with their fix.
- AUD-TX-028 belongs with AUD-TX-008 (OD-54): a static network on the HTTP provider plus a real per-call timeout.

**Later triage plans:**
- A held HTTP read stalls every later call of that provider (AUD-TX-028). To keep work in flight without stalling the provider, hold a relay call (eth_callBundle, eth_sendBundle) instead, or arrange the setup so the stall does not decide the result.
- `driveChain` in fixtures/AUD-API-001-dashboard-sell.ts lands a bundle only at a block it targets. Reuse it rather than mining bundles at a fixed time.

## Self-Check: PASSED

- **Files found:** the six triage test files and two fixtures under test/realpath/triage/; .planning/audit/findings/AUD-TX-028.json.
- **Commits found on this branch:** 85352d2, 470326d, 85cb58a and 77f5217 (`git rev-list --count 8cd482d..HEAD` = 4 before this SUMMARY).
- **Re-run after the last commit:** every task's acceptance criteria and the plan-level verification pass.
- **Clean tree:** no scratch file is left under test/ or src/, and `git status --porcelain src test` is empty.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*
