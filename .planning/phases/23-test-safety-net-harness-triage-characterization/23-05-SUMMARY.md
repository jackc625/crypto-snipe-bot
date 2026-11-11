---
phase: 23-test-safety-net-harness-triage-characterization
plan: 05
subsystem: testing
tags: [vitest, ethers, realpath-harness, flashbots, triage, knownBug, audit-register, buy-path]

requires:
  - phase: 23-01
    provides: FakeNode failNext/hold with exact targets and fired checks, createScenario, the fixed clock
  - phase: 23-28
    provides: mined-only latest count, mine({ include }), node.history with dropped competitors, setFees, V3 scenarios
  - phase: 23-02
    provides: knownBug marker, recordedAlerts/recordedLogs, the AC-02 mock-list gate
  - phase: 23-27
    provides: createTempDbFile and restartGraph (restart half of AUD-BUY-002), the Harness Gap Procedure
  - phase: 23-04
    provides: set-triage.ts, check.ts triage rules (confirmed needs test_id and a zone knownBug)
provides:
  - "Six real-path triage files under test/realpath/triage/ (10 tests, 11 knownBug claims), each shown to give the D-08 'looks fixed' message under a fix-shaped src mutation"
  - "Triage outcomes for AUD-BUY-002, -003, -015, -030, -033 and AUD-TX-007, all confirmed; -015 and -033 carry needs_fork with their fork questions"
  - "AUD-TX-027 registered (S3, capital none): strategies reserve sell gas at the buy's gas estimate, not maxGasLimit"
affects: [23-16, phase-24, phase-25, phase-29]

actuals:
  tokens: 21629    # chars/4 over the added lines of b1c3b7c..63f90a2 (16 files, 86517 chars)
  tasks: 3
  commits: 4       # MEASURED: git rev-list --count b1c3b7c..HEAD before this SUMMARY commit
plan_head_before: b1c3b7ca10c05a0ba8376051d49d70a5e6861fc9
plan_head_after: 63f90a2e6ffed7594400bb38e156894a60e94812
commits: 4

tech-stack:
  added: []
  patterns:
    - "Fix-signal discipline: everything before knownBug holds under both the bug and a fix; bug-path details are asserted after it, and each claim is proven against a fix-shaped src mutation (restored byte for byte)"
    - "Measure the harm, not one fix shape: for example 'an unbounded swap was sent' or 'buys landed', so either recommended fix reads as looks fixed"
    - "Force a race at an exact point by holding the code's own next read (hold with to and after), then changing chain state while it is parked"

key-files:
  created:
    - test/realpath/triage/AUD-BUY-002.test.ts
    - test/realpath/triage/AUD-BUY-003.test.ts
    - test/realpath/triage/AUD-BUY-015.test.ts
    - test/realpath/triage/AUD-BUY-030.test.ts
    - test/realpath/triage/AUD-BUY-033.test.ts
    - test/realpath/triage/AUD-TX-007.test.ts
    - .planning/audit/findings/AUD-TX-027.json
  modified:
    - .planning/audit/findings/AUD-BUY-002.json
    - .planning/audit/findings/AUD-BUY-003.json
    - .planning/audit/findings/AUD-BUY-015.json
    - .planning/audit/findings/AUD-BUY-030.json
    - .planning/audit/findings/AUD-BUY-033.json
    - .planning/audit/findings/AUD-TX-007.json
    - .planning/audit/ledger/TX.json
    - .planning/audit/sweep/contrib-PHASE23.json
    - .planning/audit/AUDIT-FINDINGS.md

key-decisions:
  - "All six findings recorded confirmed; AUD-BUY-015 and AUD-BUY-033 confirmed on their provable half (gate, calldata) with needs_fork and fork questions for the contract half (Phase 25); fork_ref is set by 23-16 when it adds the UFV entries"
  - "Status changes under the standing instruction: AUD-BUY-015, -030, -033 candidate -> confirmed; AUD-BUY-002 sub-claims 3 and 4 candidate -> confirmed. No severity changed"
  - "AUD-TX-027 registered S3, capital none, by the executor under the standing instruction (no stop)"
  - "AUD-BUY-002 proven beyond the plan's two traces: the restart half of sub-claim 1 and sub-claim 4 (fanout refusal after the first send), each with its own claim"
  - "AUD-TX-007 proven at both derivation sites: the entry gate (preflight deriveFeeWei, details.baseFeeWei in its refusal log) and the Flashbots strategy reserve (needs a node gas estimate above about 420 000, since the stricter gate otherwise refuses first)"
  - "Phase 24 fix note for AUD-BUY-030: a nonce re-check through the bot's ethers provider can be answered from ethers' 250 ms request cache and miss the late landing; pin the nonce"

patterns-established:
  - "A RED/fix-signal runner (scratchpad mutate.cjs): one mutation, Node 22 by absolute path, original bytes written back and checked against the HEAD blob"

requirements-completed: [AUDIT-02]

coverage:
  - id: D1
    description: "AUD-BUY-002: balanceOf error after a mined buy flips the row to failed, no monitor, TX failed alert, not resumed after restart; earlier same-nonce attempt lands with no row; fanout refusal after the first send lands with no row"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-002.test.ts (3 tests, 4 knownBug claims; 3 identical runs; 4 fix-shaped mutations each give looks fixed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUD-BUY-003: a failed snipe-size quote sends the swap with amountOutMin 0 on V2 and V3, decoded with real Transaction.from"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-003.test.ts (2 tests; skip and positive-bound fixes both give looks fixed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUD-TX-007: the doubled base fee decides the entry gate and the Flashbots strategy reserve in the real computation"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-TX-007.test.ts (2 tests; a real-base-fee mutation at each site gives looks fixed)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUD-BUY-030: the late private landing during the public leg's held nonce read gives two buys at nonces N and N + 1"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-030.test.ts (1 test; pin and cache-bypassing re-check fixes give looks fixed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "AUD-BUY-033 calldata half and AUD-BUY-015 gate half, each with needs_fork and a fork question for the contract half"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-033.test.ts and AUD-BUY-015.test.ts (refundETH and depth-check mutations give looks fixed; the depth sketch still buys from a deep pool)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AC-48: no test passes on fake chain responses a real node could never return (thin pool built from the scenario's own reserves at the same price; a 1 000 000 gas estimate; geth error texts)"
    verification: []
    human_judgment: true
    rationale: "The plan marks this prohibition as judgment: review of fake transport data"
  - id: D7
    description: "AC-16: the contract halves of AUD-BUY-015 and AUD-BUY-033 are flagged, not proven, and go to the Phase 25 fork obligations"
    verification: []
    human_judgment: true
    rationale: "23-16 adds the UFV entries and shows the operator the fork questions; check.ts holds fork_ref PENDING until then"

duration: 38min
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 05: Buy-Path Capital Findings on the Real Path Summary

**Six buy-path findings now fail on the real path, on real ethers and the real migrated database:**
- A landed buy is recorded as failed or not at all (three ways), and is not resumed after a restart.
- A failed quote still sends a swap with no minimum output, on V2 and V3.
- The doubled base fee decides both the entry gate and the Flashbots reserve.
- A late private landing turns a deliberate buy into two buys.
- A V3 snipe batch has no refund.
- A 0.001 ETH V3 pool passes the 0.5 ETH liquidity gate.

**Each claim was shown to give the "looks fixed" message under a fix-shaped change to `src/`, and `src/` ends unchanged.**

## Performance

- **Duration:** 38 min
- **Started:** 2026-11-11T16:16:57Z
- **Completed:** 2026-11-11T16:55Z
- **Tasks:** 3 of 3 (Task 1 tracer gate: interactive, end-of-phase mode, automated verify re-run and passed)
- **Files modified:** 16 (6 test files created, 1 finding created, 9 register files modified)

## Per-finding outcomes

| Finding | Sev | Outcome | Test file and claims | What was proven | Left open |
|---|---|---|---|---|---|
| AUD-BUY-002 | S1 | confirmed | AUD-BUY-002.test.ts: `balanceof-error-flips-landed-buy-to-failed`, `failed-row-not-resumed-after-restart`, `earlier-attempt-lands-no-trade-row`, `fanout-error-after-send-no-trade-row` | (1) One post-mine balanceOf error (geth `header not found`, fault named on the token, armed after the buy mined, fired once) flips the row to failed, starts no exit monitor and sends "TX failed"; after `restartGraph` the trade is not in the resume set. (2) Attempt 0 is not included at its first target and attempt 1 signs the same nonce; attempt 0 then lands at its second target. `node.history` shows both hashes accepted at one nonce, attempt 0 mined and attempt 1 dropped by it; no trades row is written. (3) The relay refuses the second fanout block after the first was sent; the sent bundle lands and no row is written. | Sub-claim 2 (a SQLite error after the mine: no SQLite fault seam, and mocking db is outside AC-02), sub-claim 5 (the AUD-BUY-004 race, in its own plan), sub-claim 6 (a stale balanceOf of 0) |
| AUD-BUY-003 | S1 | confirmed | AUD-BUY-003.test.ts: `v2-quote-failure-sends-zero-amount-out-min`, `v3-quote-failure-sends-zero-amount-out-minimum` | The snipe-size getAmountsOut (V2) or QuoterV2 quote (V3) fails after "All safety checks passed". The submitted swap decodes with amountOutMin 0 on both. | The fractional-slippage RangeError path (latent: slippagePercent is hard-coded 5) |
| AUD-TX-007 | S2 | confirmed | AUD-TX-007.test.ts: `entry-gate-uses-doubled-base-fee`, `strategy-reserve-uses-doubled-base-fee` | At a 20 gwei block base fee (ethers reads maxFee = 2 x base + tip from the node's block), the entry gate logs `baseFeeWei` 40 gwei and refuses a buy affordable at 20 gwei. The Flashbots strategy refuses as unaffordable, before submitting, a buy whose headroom is positive at 20 gwei. Both window edges are computed with the bot's own exported functions. | The thin-wallet private sell sent to the public mempool (needs an exit scenario); passthrough.ts is not run |
| AUD-BUY-030 | S1 | confirmed (status candidate -> confirmed) | AUD-BUY-030.test.ts: `public-buy-not-pinned-to-private-nonce` | Two private attempts are not included and the guard clears. The public leg's own `eth_getTransactionCount(pending)` read is held while the last private attempt lands, then released. The public buy takes nonce N + 1 and lands: two buys, decoded nonces N and N + 1. | None |
| AUD-BUY-033 | S1 | confirmed + needs_fork (status candidate -> confirmed) | AUD-BUY-033.test.ts: `v3-multicall-has-no-refund` | The V3 snipe batch decodes as `multicall(deadline, [exactInputSingle])`, with value equal to the whole snipe amount, no price limit, and no refundETH, unwrapWETH9 or sweepToken. | Fork question: does a partial fill leave the unspent ETH in SwapRouter02, and does refundETH pay it to any caller? |
| AUD-BUY-015 | S1 | confirmed + needs_fork (status candidate -> confirmed) | AUD-BUY-015.test.ts: `thin-pool-passes-min-liquidity-gate` | A V3 pool holding 0.001 ETH at the ordinary price passes the 0.5 ETH gate. The threshold quote answers about 199.6 tokens, worth about 0.001 ETH, and the bot buys. | Fork question: does the real QuoterV2 answer that quote without reverting? |

`fork_ref` for the two `needs_fork` entries is PENDING until plan 23-16 adds their UFV entries (owner Phase 25), as 23-16 Task 2 specifies. The five S1 entries also wait on 23-16's operator acknowledgement (AC-18).

## Task Commits

1. **Task 1 (tracer): AUD-BUY-002** - `9dee4e5` (test)
2. **Task 2: AUD-BUY-003 and AUD-TX-007** - `05c5141` (test)
3. **Task 3: AUD-BUY-030, AUD-BUY-033 and AUD-BUY-015** - `780588c` (test)
4. **Register AUD-TX-027 (found during Task 2)** - `63f90a2` (docs)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## New findings and grade/status changes

All made under the operator's standing instruction of 2026-11-11 ("All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading"), without a stop.

| Item | Change | Evidence |
|---|---|---|
| AUD-TX-027 (new) | Registered S3, capital none, confirmed. All three strategies take `sellGasLimit = buyGasLimit = txRequest.gasLimit`, which is the node's `eth_estimateGas` answer with no cap (flashbots.ts:158-162, passthrough.ts:57-58, bloxroute.ts:84-85 at the audit base). The flashbots comment says it is the chain `maxGasLimit`, and the entry gate prices both legs at `maxGasLimit`. | The AUD-TX-007 strategy test logs buy and sell gas limit 1000000 (ETH maxGasLimit is 300000). There is no capital effect today, because the entry gate is stricter at every default. It matters for Phase 24: the AUD-TX-007 doubling currently hides the smaller gas basis. Recorded in the finding file, `sweep/contrib-PHASE23.json` (src x C16) and `ledger/TX.json` (three strategy rows). |
| AUD-BUY-030 | status candidate -> confirmed | Real-path test above |
| AUD-BUY-033 | status candidate -> confirmed (needs_fork kept for the router half) | Calldata decoded on the real path |
| AUD-BUY-015 | status candidate -> confirmed (needs_fork kept for the quoter half) | Gate passes a thin pool on the real path |
| AUD-BUY-002 sub-claims 3 and 4 | candidate -> confirmed, with the test named in each sub-claim's evidence | Tests B and C |

No severity changed. None of the six triage entries closes as NOT-A-BUG, and none is unreproduced, so nothing here needs an operator ruling before 23-16.

## Files Created/Modified

- `test/realpath/triage/AUD-BUY-002.test.ts`: three tests, four claims (one root cause, D-10)
- `test/realpath/triage/AUD-BUY-003.test.ts`: V2 and V3 tests
- `test/realpath/triage/AUD-TX-007.test.ts`: entry gate and strategy tests
- `test/realpath/triage/AUD-BUY-030.test.ts`, `AUD-BUY-033.test.ts`, `AUD-BUY-015.test.ts`: one test each
- `.planning/audit/findings/AUD-BUY-002.json`, `-003`, `-015`, `-030`, `-033`, `AUD-TX-007.json`: triage blocks (set-triage.ts), plus AUD-BUY-002's two sub-claim statuses
- `.planning/audit/findings/AUD-TX-027.json`, `ledger/TX.json`, `sweep/contrib-PHASE23.json`: the new finding
- `.planning/audit/AUDIT-FINDINGS.md`: re-rendered twice with render.ts; OPERATOR-DECISIONS.md unchanged; SEAL.json untouched

## Decisions Made

See `key-decisions`. In short:
- Each knownBug measures the harm itself (for example an unbounded swap sent, or the number of buys landed), so either recommended fix reads as "looks fixed".
- Two fix shapes are not visible to the measure, and are written in their test headers:
  - AUD-BUY-003: a fix that sends with a positive bound and a fix that skips both pass.
  - AUD-BUY-033: a fix that wraps only what the swap consumes, with no refundETH, would not show in the call list, so that marker must be revisited with that fix.
- The thin pool for AUD-BUY-015 is the scenario's own reserves scaled down at the same price before the launch. Quoter, swap, Mint and pool balance therefore answer for one pool, and `liquidity()` is re-set to match. It is not a quoter-only override.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Tests restructured so a fix gives the D-08 message**
- **Found during:** Task 1, the first fix-shaped mutation run
- **Issue:** Three of four AUD-BUY-002 mutations failed on plain bug-path assertions placed before `knownBug` (the `fail-clean` count, the landed-not-ours log, a wait for `fail-clean`), not with "looks fixed". A Phase 24 fix would have read as an unexplained failure.
- **Fix:** Before the marker, every test asserts only facts that hold under both the bug and a fix; the details of how today's code fails come after the marker. The same rule was applied to every later file, and every claim was run against a fix-shaped mutation (12 mutations plus one control).
- **Files modified:** all six test files
- **Committed in:** 9dee4e5, 05c5141, 780588c

**2. [Rule 2 - Proof strength] AUD-BUY-002 proven beyond the plan's two traces**
- Added the restart half of sub-claim 1 (the failed row is not in the resume set) and sub-claim 4 (fanout refusal after the first send), each with its own claim. Both are part of the same finding and root cause; the plan asked only that other sub-claims be noted.
- **Committed in:** 9dee4e5

**3. [Rule 2 - Register accuracy] AUD-BUY-002 sub-claims 3 and 4 moved candidate -> confirmed and AUDIT-FINDINGS.md re-rendered**
- The re-render also brought current four `re_audit` ledger rows that plan 23-04 had added without re-rendering (`check-vi-mock-paths.ts`, `.gitignore`, `package.json`, `vitest.config.ts`). This staleness at HEAD was found by comparing a fresh render against the committed file before any edit.
- **Committed in:** 9dee4e5

**4. [Rule 2 - Proof strength] AUD-TX-007 proven at the strategy site as well as the entry gate**
- The plan allowed "the op log or the refused-buy threshold". The entry gate's refusal log gives the first claim. The strategy's own reserve (flashbots.ts:169-172, the primary evidence site) gives the second. That claim needs a node gas estimate of 1 000 000: below about 420 000 the stricter gate always refuses first. A real node can answer that for a token with heavy transfer code.
- **Committed in:** 05c5141

**5. [Rule 2 - Missing critical] AUD-TX-027 registered (bug not in the register), under the standing instruction**
- **Committed in:** 63f90a2

---

**Total deviations:** 5 (all Rule 2). **Impact:** stronger proofs and a more accurate register. There is no scope outside the plan's findings except AUD-TX-027, which the standing instruction requires. `src/` is unchanged.

## Issues Encountered (all diagnosed)

- **ethers maps a `-32000` eth_call error to `CALL_EXCEPTION "missing revert data"`.** The first AUD-BUY-002 run expected the injected text. Real ethers wraps it, so the test asserts the call ethers names instead: the bot's wallet, `balanceOf`, on the token.
- **The Bash heredoc halved the doubled backslashes** in the first mutation specs. Each failed to parse before any write, `git status src` was empty, and the specs were moved to `.cjs` files written with the Write tool.
- **AUD-BUY-030, an unhandled `provider destroyed; cancelled request (eth_subscribe)`.** `executeDeliberateBuy` resolves before the anti-rug subscription lands, and teardown cancelled it (the same cause 23-01 recorded). The test now waits for the arming: exit monitor, subscription on the pair, and backfill.
- **AUD-BUY-030, the arming wait stalled on "cursor = head".** Probes showed the WebSocket provider was healthy and the subscription did land. The backfill's gap branch (AUD-ANTIRUG-024 on a fresh database) writes `currentBlock` from `getBlockNumber()`, and ethers' 250 ms request cache answered with the block read just before the public buy was mined. The effect is benign (one block scanned again) and is not a new finding. The "cursor = head" convention from the snipe tests does not fit this path and was dropped here. Scratch probe files were deleted and never committed.
- **AUD-BUY-030 `030-recheck`, a naive fix sketch that re-checks `latest` through the bot's provider, did not fix the bug.** The re-check was answered from the same ethers cache. A cache-bypassing read (`030-recheck-raw`) gave "looks fixed", which confirms the cause. This is recorded in the finding's triage note for Phase 24: pin the nonce.
- **The `030-pin` mutation also reports "a hold never fired".** With a pinned nonce the bot makes no nonce read to hold. The D-08 message is the test's first error, and this is expected only under a fix.
- **Rails:** the whole realpath run (12 files, 86 tests) had one `net-allow`, the known loopback from `harnessRestart.test.ts`; `nonLoopbackAllowed` 0, `telegramAllowed` 0.
- Git's "LF will be replaced by CRLF" notices come from `core.autocrlf=true`; the blobs are LF.

## Verification (exact commands, Node 22.16.0 via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

- Task 1: `node node_modules/vitest/vitest.mjs run --project realpath test/realpath/triage/AUD-BUY-002.test.ts && node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial --slice BUY && node -e "<AUD-BUY-002 triage outcome check>"` gave 3/3 and exit 0 (also re-run as the tracer gate).
- Task 2: the plan's verify (both files, partial BUY and TX, triage blocks) gave 4/4 and exit 0.
- Task 3: the plan's verify (three files, partial BUY, triage blocks) gave 3/3 and exit 0. AUD-BUY-033 and AUD-BUY-015 have `needs_fork: true` and a `fork_question`.
- AC-10: each task's files run three times with the JSON reporter; test status and knownBug records were identical across runs.
- Whole realpath project: `node node_modules/vitest/vitest.mjs run --project realpath` gave 12 files and 86/86 (76 before this plan, plus 10).
- Register: `check.ts --stage partial` gave PASS, fail 0, pending 63. `--slice BUY` gave PASS, pending 20. `--slice TX` gave PASS, pending 8. `--stage consolidation` gave PASS. `--self-test` gave 50/50. Every PENDING is 23-16's: AC-18 acknowledgements, `fork_ref`, `ruling_ref`, and the run-evidence file.
- Gates: `scripts/check-realpath-mocks.ts` reported 30 vi uses (7 mock calls) in 22 files, 0 violations. `scripts/check-vi-mock-paths.ts` reported 591 calls in 196 files, 0 violations.
- Type check: `tsc -p <scratchpad tsconfig extending the repo's>` over the six new files gave 0 errors; `--listFiles` shows all six and the harness files they import.
- `git status --porcelain src` was empty at every commit and after every mutation.
- Fix-signal and RED proofs: scratch mutations of `src/`, each run on Node 22.16.0. After each one the original bytes were written back and the git hash checked IDENTICAL to the HEAD blob.

| Mutation | Result |
|---|---|
| 002-a1 balanceOf error caught (default 0) | AUD-BUY-002 looks fixed |
| 002-a2 resume set also takes failed buys | looks fixed (restart claim alone) |
| 002-b earlier attempts' hashes checked on landed-not-ours | looks fixed |
| 002-c fanout refusal no longer throws | looks fixed |
| 003-v2-skip / 003-v2-bound / 003-v3-skip | AUD-BUY-003 looks fixed (both fix shapes) |
| 007-gate / 007-strategy, real base fee at each site | AUD-TX-007 looks fixed |
| 030-pin / 030-recheck-raw | AUD-BUY-030 looks fixed |
| 030-recheck (through the cached provider) | bug still reproduces (diagnosed above) |
| 033-refund, refundETH added to the batch | AUD-BUY-033 looks fixed |
| 015-depth, quote-vs-reference depth check | AUD-BUY-015 looks fixed |
| 015-depth-control, same sketch on a deep pool (033 test) | still buys (the sketch does not refuse everything) |

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- Plan 23-16 must:
  - add UFV entries (owner Phase 25) for AUD-BUY-015 and AUD-BUY-033 with the fork questions recorded in their triage blocks, and set `fork_ref`;
  - acknowledge AUD-BUY-002, -003, -015, -030 and -033 (S1) in the batch report;
  - collect the 11 knownBug records from these six files into the run evidence.
- Phase 24:
  - Each file can be run alone for a before-and-after proof. A fix ends its marker with "now behaves correctly: remove this marker".
  - For AUD-BUY-030, pin the nonce; a re-check through the bot's provider can be answered from ethers' cache.
  - The AUD-TX-007 fix (card TX-02) must also settle AUD-TX-027's gas basis.

## Self-Check: PASSED

- FOUND: the six test files under test/realpath/triage/ and .planning/audit/findings/AUD-TX-027.json.
- FOUND commits on this branch: 9dee4e5, 05c5141, 780588c, 63f90a2 (`git rev-list --count b1c3b7c..HEAD` = 4 before this SUMMARY).
- No scratch file left under test/; `git status --porcelain src test` empty.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*
