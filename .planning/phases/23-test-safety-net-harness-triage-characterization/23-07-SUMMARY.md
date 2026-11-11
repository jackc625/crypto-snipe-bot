---
phase: 23-test-safety-net-harness-triage-characterization
plan: 07
subsystem: testing
tags: [vitest, ethers, realpath-harness, triage, knownBug, audit-register, exit-engine, flashbots, uniswap-v2, uniswap-v3]

requires:
  - phase: 23-01
    provides: FakeNode reads, failNext with exact targets and fired checks, createScenario, the fixed clock
  - phase: 23-28
    provides: createScenario for V2 and V3 with dexName, mine({ include, logs }), setFees, setReceiptLogs, the Flashbots route
  - phase: 23-02
    provides: knownBug marker, recordedLogs/recordedAlerts, the AC-02 mock-list gate
  - phase: 23-27
    provides: createTempDbFile and restartGraph (AUD-EXIT-013, AUD-EXIT-015)
  - phase: 23-04
    provides: set-triage.ts, check.ts triage rules
provides:
  - "Seven real-path triage files (AUD-EXIT-001, -002, -003, -004, -013, -015 and the new AUD-EXIT-027): 13 tests, 17 knownBug claims; each claim reads looks fixed under a fix-shaped src mutation, and a full batch shows every mutation flips only its own finding's claims"
  - "Triage outcomes for the six plan findings, all confirmed; AUD-EXIT-003 carries needs_fork for sub-claims 2 and 3"
  - "fixtures/AUD-EXIT-002-position.ts (buy, arm, decode exit quotes) and fixtures/AUD-EXIT-001-sell-path.ts (the sell side of the chain from mined transactions, real foreign trades with pool events, a chain driver)"
  - "Two new register entries graded under the standing instruction: AUD-EXIT-027 (S3) and AUD-TESTI-028 (S3)"
affects: [23-16, phase-24, phase-25, phase-28, phase-29]

actuals:
  tokens: 32442    # chars/4 over the added lines of 616666e..2db1c81 (20 files, 129766 chars, incl. the AUDIT-FINDINGS.md render)
  tasks: 3
  commits: 4       # MEASURED: git rev-list --count 616666e..HEAD before this SUMMARY commit
plan_head_before: 616666e884e960fb2da59eb1041821883b9ed134
plan_head_after: 2db1c81deb1e0b0620d589c6579e9f9526a61c12
commits: 4

tech-stack:
  added: []
  patterns:
    - "Price moves come from another wallet's real signed router call mined with the pool's own events, the reserves moving by the router's own math; never a quote override"
    - "The sell side of the chain (allowance, balance after a sell, sell receipts) is computed from transactions the node really mined, re-served through the public setRead/setReceiptLogs API"
    - "Setup that holds under every other finding's fix: the arming wait mines the wallet's public transactions and runs before any monitor check; a detail that is another finding's claim is asserted only in that finding's file"
    - "A full cross-file mutation batch (each fix shape against every file of the plan) to show each marker reads only its own finding"

key-files:
  created:
    - test/realpath/triage/AUD-EXIT-001.test.ts
    - test/realpath/triage/AUD-EXIT-002.test.ts
    - test/realpath/triage/AUD-EXIT-003.test.ts
    - test/realpath/triage/AUD-EXIT-004.test.ts
    - test/realpath/triage/AUD-EXIT-013.test.ts
    - test/realpath/triage/AUD-EXIT-015.test.ts
    - test/realpath/triage/AUD-EXIT-027.test.ts
    - test/realpath/triage/fixtures/AUD-EXIT-001-sell-path.ts
    - test/realpath/triage/fixtures/AUD-EXIT-002-position.ts
    - .planning/audit/findings/AUD-EXIT-027.json
    - .planning/audit/findings/AUD-TESTI-028.json
  modified:
    - .planning/audit/findings/AUD-EXIT-001.json
    - .planning/audit/findings/AUD-EXIT-002.json
    - .planning/audit/findings/AUD-EXIT-003.json
    - .planning/audit/findings/AUD-EXIT-004.json
    - .planning/audit/findings/AUD-EXIT-013.json
    - .planning/audit/findings/AUD-EXIT-015.json
    - .planning/audit/ledger/EXIT.json
    - .planning/audit/sweep/contrib-PHASE23.json
    - .planning/audit/AUDIT-FINDINGS.md

key-decisions:
  - "All six plan findings recorded confirmed; none unreproduced and none NOT-A-BUG, so nothing here needs an operator ruling before 23-16 beyond the S1 acknowledgements"
  - "AUD-EXIT-003 confirmed on sub-claims 1 and 4 plus the null-quote urgency suppression; sub-claims 2 and 3 recorded with --needs-fork and a fork question (real tokens and pools)"
  - "AUD-EXIT-013 proven on a real sushiswap-v2 buy (not a seeded row), with a second claim for the merged anti-rug re-registration site; the dashboard findDex sells stay code-read"
  - "AUD-EXIT-015 proven in the stop-loss direction (snipe 0.01 -> 0.002, a market sell with no price change), the LOSS case of its rationale"
  - "AUD-EXIT-004 split into three claims (public before the private sell, fees outside the sell ceiling, a new public approve per exit), each with its own fix shape"
  - "New AUD-EXIT-027 (S3, capital none) and AUD-TESTI-028 (S3, capital none) registered by the executor under the standing instruction, without a stop"

patterns-established:
  - "Scratch runners in the session scratchpad: mutate.cjs (one mutation, one file set), mutate-all.cjs (every mutation against every plan file, JSON reporter), ac10.sh (three JSON runs compared), logcheck.sh (non-throwing afterEach that records warn/error lines)"

requirements-completed: [AUDIT-02]

coverage:
  - id: D1
    description: "AUD-EXIT-002: one failed getAmountsOut at exit-monitor start (fault on the router, armed after the buy mined, fired once) leaves the held position with no monitor timer, no exit_state row and no alert over six poll intervals"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-EXIT-002.test.ts (1 test; retry and unprotected-alert mutations give looks fixed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUD-EXIT-013: after restartGraph a sushiswap-v2 position is quoted only through the uniswap-v2 router and anti-rug re-registers it on uniswap-v2"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-EXIT-013.test.ts (1 test, 2 claims; exit-resume and anti-rug-resume dex_name mutations each flip only their own claim)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUD-EXIT-015: on a temp-file database, with the stored exit_state row and exit.monitor.resumed asserted first, the resumed monitor probes the new snipe amount and the stop-loss fires with no price change"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-EXIT-015.test.ts (1 test, 2 claims; stored-probe mutation gives looks fixed for both)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUD-EXIT-003: raw ETH-wei probe on a 9-decimal token; a 0 first quote kept as the entry (Infinity sells both partial tiers at a 1 percent rise, NaN fires the stop-loss); null quotes suppress the 30-minute urgency exit"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-EXIT-003.test.ts (4 tests; decimals-probe, reject-zero-entry, finite-guard and urgency-on-null mutations)"
        status: pass
    human_judgment: false
  - id: D5
    description: "AUD-EXIT-001: V2 and V3, full and partial private sells decode with a zero output floor from node.submitted and from the relay body"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-EXIT-001.test.ts (4 tests; positive-floor mutation flips all four, V2-only flips the two V2 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AUD-EXIT-004: a public exact-amount approve at ethers' default fees (above the sell ceiling) precedes each private sell, and the second exit needs another"
    requirement: AUDIT-02
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-EXIT-004.test.ts (1 test, 3 claims; approve-at-buy, ceiling and max-approve mutations each flip their own claim)"
        status: pass
    human_judgment: false
  - id: D7
    description: "AC-16: AUD-EXIT-003 sub-claims 2 and 3 (saturation and coarse quotes on real tokens) are flagged for the Phase 25 fork, not proven"
    verification: []
    human_judgment: true
    rationale: "23-16 adds the UFV entry and shows the operator the fork question; check.ts holds fork_ref PENDING until then"
  - id: D8
    description: "AC-48: no test passes on answers a real node, router or token could never give (foreign trades move reserves by the router's own math; allowance and balances follow mined transactions; the high-supply pool fits uint112)"
    verification: []
    human_judgment: true
    rationale: "The plan family marks this prohibition as judgment: review of fake transport data"

duration: 56min
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 07: Exit Monitoring, Pricing and Minimum-Output Findings on the Real Path Summary

**All six exit findings now fail on the real path, with the real exit monitor running on real quotes:**
- A failed first quote leaves a held position with no exit monitor.
- After a restart, a position bought on a second dex is quoted (and anti-rug re-registered) through the first dex.
- A changed snipe amount fires a market stop-loss with no price change.
- The price signal is a ratio of fixed-probe outputs. A 0 first quote makes it Infinity or NaN, and failing quotes block the 30-minute exit.
- Every private sell (V2 and V3, full and partial) has a zero output floor.
- Each exit first sends a public approve at default fees, above the sell fee ceiling.

**Found on the way, two new S3 entries:**
- A V3 exit leaves its proceeds as WETH that the bot never unwraps.
- A throwing test-file `afterEach` skips the harness teardown.

## Performance

- **Duration:** about 56 min
- **Started:** 2026-11-11T17:54:59Z
- **Completed:** 2026-11-11T18:51Z
- **Tasks:** 3 of 3. Task 1 tracer gate (interactive, end-of-phase mode, automated-only verify): the verify was re-run on the committed tree and passed (TRACER-VERIFY-OK), then expansion continued.
- **Files modified:** 20 (9 test files created, 2 register files created, 9 register files modified)

## Per-finding outcomes

| Finding | Sev | Outcome | Test file and claims | What was proven | Left open |
|---|---|---|---|---|---|
| AUD-EXIT-002 | S1 | confirmed | AUD-EXIT-002.test.ts: `first-quote-failure-leaves-position-unmonitored` | A real ETH V2 snipe. One getAmountsOut on the router fails with geth's `header not found`. The fault names its selector and target, is armed only after the buy is mined (review concern MEDIUM), and fired once; the failed call was the monitor's entry quote (snipe amount, token to WETH). The position is pending and held, with no exit-monitor timer in the real registry, no exit_state row and no unprotected alert. Over six 5 s poll intervals nothing retries or re-arms, while anti-rug still registers the position. | None |
| AUD-EXIT-013 | S1 | confirmed | AUD-EXIT-013.test.ts: `resume-quotes-first-v2-dex`, `antirug-resume-registers-first-v2-dex` | A real snipe on sushiswap-v2 (the second ETH V2 dex) stores dex_name `sushiswap-v2`. The running monitor quotes the sushiswap router (control). After `restartGraph` on the temp file, the real `resumeMultiChainMonitoring` quotes only the uniswap-v2 router, read from the node's call log. That router has no pair for the token, so every quote reverts and no tick completes. The real `resumeAntiRugMonitoring` re-registers the position with uniswap-v2. | Dashboard force/emergency sells (`controls.ts` findDex) and the failed-sell re-arm: code-read |
| AUD-EXIT-015 | S1 | confirmed | AUD-EXIT-015.test.ts: `resume-probes-with-current-snipe-amount`, `stop-loss-fires-without-price-change` | Temp-file scenario (review blocker HIGH). A real snipe at 0.01, then `restartGraph` with `ETH_SNIPE_AMOUNT` 0.002. Asserted first: the exit_state row on the new connection equals the stored one (entry price is the 0.01 probe's output), and `exit.monitor.resumed` is logged for the trade, not a fresh start. The resumed quotes decode (real ethers, callLog data) with amountIn 0.002. With the pool unchanged, the stop-loss fires on the first tick ("Fixed stop-loss at 0.20x (-80.0%)") and the whole position is sold and closed. | The larger-probe direction, the deliberate buy and the failed-exit re-arm: code-read |
| AUD-EXIT-003 | S1 | confirmed + needs_fork | AUD-EXIT-003.test.ts: `probe-is-eth-buy-wei-as-token-amount`, `zero-entry-infinite-ratio-fires-every-partial-tier`, `zero-entry-nan-ratio-fires-stop-loss`, `null-quote-suppresses-urgency-exit` | (1) For a 9-decimal token every exit quote's amountIn is parseEther(0.01) = 1e16 raw = 10,000,000 tokens. (4) A 1 ETH pool holding 1 quadrillion tokens, with a 0.001 snipe: real V2 math quotes the 1e15 probe at 0, and 0 is kept as the entry. Another wallet then raises the price 1 percent (a real swap with Swap and Sync logs), the probe quotes 1, the ratio is Infinity, trailing activates, and the 2x and 5x tiers sell half the position at once. With the pool unchanged instead, 0/0 is NaN and the stop-loss sells everything on the first tick. (Urgency) With every exit quote refused (Infura's -32005 rate-limit answer, 372 refusals) for 31 minutes, no urgency exit fires. | Sub-claims 2 (saturation, about a square-root ratio) and 3 (few-wei quotes) need real tokens: `--needs-fork`, fork question recorded; `fork_ref` set by 23-16 |
| AUD-EXIT-001 | S1 | confirmed | AUD-EXIT-001.test.ts: `v2-full-private-sell-no-output-floor`, `v3-full-private-sell-no-output-floor`, `v2-partial-private-sell-no-output-floor`, `v3-partial-private-sell-no-output-floor` | Four cases on ETH (Flashbots). Full: another wallet dumps 30 percent of the pool's tokens and the 25 percent stop-loss fires. Partial (2x:25): another wallet buys with half the pool's ETH (about 2.25x) and the 2x tier fires. Each private sell decodes, from `node.submitted` and from the raw transaction in the relay's `eth_sendBundle` body, with amountOutMin (V2) or amountOutMinimum (V3) = 0. The sells land and the positions close or the partial confirms. | Anti-rug exits are not run here; whether 0 stays for them is card OD-14 |
| AUD-EXIT-004 | S2 | confirmed | AUD-EXIT-004.test.ts: `approve-sent-public-before-private-sell`, `approve-fees-outside-sell-ceiling`, `second-exit-needs-new-public-approve` | ETH V2, 2x:25, the node suggesting a 50 gwei priority fee. Before the private take-profit sell, the bot sent an approve to the router through the public mempool and it was mined. The approve paid ethers' defaults: 50 gwei priority and a 70 gwei max fee (2 x 10 + 50), above the 25 gwei `MEV_SELL_MAX_PRIORITY_FEE_GWEI` ceiling. Its amount was exactly the quarter sold, so the later trailing-stop exit (another wallet dumps half the pool's tokens) sent a second public approve for the rest. | None |

None of these entries is unreproduced or NOT-A-BUG. Operator follow-ups are listed under Next Phase Readiness.

## Task Commits

1. **Task 1 (tracer): AUD-EXIT-002** - `f7a7400` (test)
2. **Task 2: AUD-EXIT-013, AUD-EXIT-015 and AUD-EXIT-003** - `538c5b2` (test)
3. **Task 3: AUD-EXIT-001 and AUD-EXIT-004** - `9b08850` (test). It also holds the setup hardening of the Task 2 files found by the cross-file mutation batch (deviations 6 and 7).
4. **New findings found during Task 3: AUD-EXIT-027 (proven) and AUD-TESTI-028** - `2db1c81` (test)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## New findings and grade/status changes

Both were made under the operator's standing instruction of 2026-11-11 ("All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading"), without a stop.

| Item | Change | Evidence |
|---|---|---|
| AUD-EXIT-027 (new) | **Registered:** S3, capital none, confirmed, class C04.<br>**Records:** sweep `src x C04` in `contrib-PHASE23.json`; EXIT ledger `src/exitEngine.ts` row; triage confirmed (not in the frozen 61, recorded so check.ts can locate its claim). | `buildV3SellTx` sends `multicall(deadline, [exactInputSingle(tokenOut WETH, recipient the wallet)])` with no `unwrapWETH9` (exitEngine.ts:378-407 at the audit base). The receipt decoder knows the result: receiptDecoder.ts:88 reads "WETH sent directly without unwrap". No code in src/ or scripts/ calls WETH withdraw or unwrapWETH9. The bot buys and pays gas in native ETH, and its wallet floor checks only `getBalance` (preflight.ts:199, :387).<br>**Real path:** AUD-EXIT-027.test.ts, claim `v3-exit-proceeds-stay-weth`. A landed V3 stop-loss sell, and no wallet transaction in the minute after. An unwrap in the batch and a WETH withdraw after each read looks fixed.<br>**Grade:** no loss (WETH is 1:1), but V3 exits move trading capital out of the balance the bot spends and checks, so it can pause or refuse buys early and the operator must unwrap by hand. Not S2, because by code reading the wallet floor keeps native gas in reserve for exits. |
| AUD-TESTI-028 (new) | **Registered:** S3, capital none, confirmed, class C12, tags test-quality.<br>**Records:** sweep `test x C12`. No TESTI ledger row exists yet for the harness files; adding those is the Phase 22-style final-stage bookkeeping left to a later plan, as 23-04 recorded. | The realpath harness tears a scenario down only in `setup.ts` `afterEach` (setup.ts:214-238 at 384be2f). When a test file's own `afterEach` throws first, Vitest 4.1.1 skips it.<br>**Scratch probe:** the next test still saw `disposers=1`, `node=set` and the previous test's logs.<br>**Observed effect:** with a throwing debug hook, the previous test's exit-monitor interval kept polling the next test's node, fired a stop-loss and hit "The database connection is not open".<br>**Exposure:** no committed file declares its own `afterEach`. Until fixed, a realpath test file must not declare one that can throw. The fix is a harness change (Harness Gap Procedure, or Phase 28). |

**No severity or status changed on the six plan findings.** All were already confirmed, and set-triage kept them confirmed. AUD-EXIT-003's already-confirmed sub-claims 1 and 4 gained the test name in their evidence; 2 and 3 stay candidate.

## Files Created/Modified

- `test/realpath/triage/AUD-EXIT-002.test.ts`, `-013`, `-015`, `-003`, `-001`, `-004`, `-027`: the seven triage files (13 tests, 17 claims).
- `test/realpath/triage/fixtures/AUD-EXIT-002-position.ts`: listen, buy-and-mine, arming wait, buy row, exit_state row, decoded exit quotes.
- `test/realpath/triage/fixtures/AUD-EXIT-001-sell-path.ts`: allowance, balance and sell receipts from mined transactions; sell and approve decoders; `landNextSell`, `driveExits` and `foreignTrade`.
- `.planning/audit/findings/AUD-EXIT-001/-002/-003/-004/-013/-015.json`: triage blocks (set-triage.ts). AUD-EXIT-003 also has test evidence on sub-claims 1 and 4.
- `.planning/audit/findings/AUD-EXIT-027.json`, `AUD-TESTI-028.json`, `sweep/contrib-PHASE23.json`, `ledger/EXIT.json`: the new findings.
- `.planning/audit/AUDIT-FINDINGS.md`: re-rendered with render.ts after the register edits. OPERATOR-DECISIONS.md is byte-unchanged and SEAL.json untouched.

## Decisions Made

See `key-decisions`. In short:
- Every marker measures the harm: no monitor, the router actually quoted, what was sold, whether an exit fired, whether a floor is above zero. So the recommended fixes read "looks fixed", and fix shapes are named in each test header.
- Setup facts hold under the bug, under its fixes, and under every other finding's fix in this plan. This was shown by a full cross-file mutation batch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Proof strength] AUD-EXIT-013 on a real buy, with a second claim**
- The plan said to seed a pending row. The test makes a real sushiswap-v2 snipe instead, so dex_name is written by the real buy code and the running monitor's correct quotes serve as the control.
- It adds the merged anti-rug re-registration site (`resumeAntiRugMonitoring`, from AUD-ANTIRUG-011) as its own claim.
- **Committed in:** 538c5b2

**2. [Rule 2 - Proof strength] AUD-EXIT-015 proves the harm, not only the probe**
- A second claim shows the stop-loss firing at 0.20x with no price change, and the market sell landed.
- **Committed in:** 538c5b2

**3. [Rule 2 - Proof strength] AUD-EXIT-003 urgency claim beyond the plan's two sub-claims**
- `null-quote-suppresses-urgency-exit` proves the finding's evidence row and codex's "quote failure suppresses the unconditional urgency exit", which the STRAND grade rests on.
- **Committed in:** 538c5b2

**4. [Rule 2 - Proof strength] AUD-EXIT-004 as three claims**
- Public route, fee ceiling and exact amount (one public approve per exit) are each a separate claim, each with its own fix shape.
- The node's priority suggestion is raised to 50 gwei so that "outside the ceiling" is visible as a number.
- **Committed in:** 9b08850

**5. [Rule 2 - Missing critical] Sell-path fixture beside the tests (no harness change)**
- **Issue:** the scenario answers only the buy side. A sell needs `allowance`, a balance that falls after the sell, and the WETH log in the sell receipt. Without them the bot would see strays or a balance that never drops.
- **Fix:** answers computed from mined transactions, through the public `setRead`/`setReceiptLogs` API. The bought amount is frozen at install time, because the scenario's own `balanceOf` re-prices the buy at current reserves, and no token does that.
- **Real price moves:** made by another wallet's signed router call, mined with the pool's own events.
- No HARNESS GAP was needed.
- **Committed in:** 538c5b2, 9b08850

**6. [Rule 1 - Bug in my own tests] Setups depended on another finding's behavior**
- Found by the full mutation batch:
  - AUD-EXIT-003 and -015 asserted `minOut 0` (AUD-EXIT-001's claim).
  - AUD-EXIT-001's V3 test asserted the wallet as WETH recipient (AUD-EXIT-027's claim).
  - Four setups waited for `exit.monitor.started` before the step that mines public transactions, so a buy-time-approve fix for AUD-EXIT-004 made them time out.
- **Fix:**
  - Those details were removed from the other findings' files.
  - The arming wait now runs first and mines the wallet's public transactions.
  - Its cursor check accepts a cursor at or past the head seen at the start, since ethers' 250 ms cache can lag by one block when a block is mined during arming (23-05's note).
- The batch was re-run: every mutation flips only its own finding.
- **Committed in:** 9b08850

**7. [Rule 1 - Bug in my own tests] V3 buy read as a sell**
- A V3 buy is also a `multicall` to the swap router.
- The sell decoder now accepts only token-in swaps of the scenario token, and the receipt rule leaves non-sells alone.
- **Committed in:** 9b08850

**8. [Rule 2 - Missing critical] Two findings not in the register were registered, under the standing instruction**
- These are AUD-EXIT-027 and AUD-TESTI-028; see the table above.
- **Committed in:** 2db1c81

---

**Total deviations:** 8 (Rule 1: 2, Rule 2: 6). **Impact:** stronger proofs, setups that stay valid under every fix in this plan, and two new register entries. `src/` is unchanged, and nothing under `test/realpath/harness/` was written.

## Issues Encountered (all diagnosed)

- **Errors leaking across tests during a debug run** ("The database connection is not open", stop-loss sells in the next test).
  - **Cause:** my own throwing debug `afterEach` skipped the harness teardown.
  - **Proof:** with a non-throwing hook, every test starts on a fresh graph, and the only error lines are the registered AUD-ANTIRUG-024 gap and AUD-EXIT-002's own line.
  - The underlying harness weakness is registered as AUD-TESTI-028.
- **`landNextSell` initially missed an approve sent while the test was still stepping.** It now takes the starting index explicitly.
- **AUD-EXIT-003's partial-share marker first read 49%.** Floor division on an odd position; the share is now rounded to the nearest percent.
- **`exit.partial.submitted` is logged only after the approve is mined.** The Infinity claim measures what was actually sold, over a driven minute of chain time.
- **`--stage final` has 43 FAILs (37 after 23-06).** The 6 new ones are TESTI ledger rows for this plan's committed test and fixture files. They are the same kind as the 15 already listed for 23-05/23-06 triage files: Phase 22 final-stage bookkeeping, out of scope per 23-04.
- **Rails ledger** for the whole realpath run: 11 `net-allow`, all loopback, from the two known files (`harnessRestart.test.ts` and the AUD-BUY-011 dashboard fixture). `nonLoopbackAllowed` 0 and `telegramAllowed` 0; no file of this plan triggers the ledger.
- **Shell heredocs** mangled quoting and backslashes several times. Each failure was caught before anything ran (parse errors or no match), and the edit scripts moved into scratchpad files.
- Git's "LF will be replaced by CRLF" notices come from `core.autocrlf=true`; the blobs are LF.

## Verification (exact commands, Node 22.16.0 via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

**Task verifies:**
- **Task 1:** `node node_modules/vitest/vitest.mjs run --project realpath test/realpath/triage/AUD-EXIT-002.test.ts && node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial --slice EXIT && node -e "<AUD-EXIT-002 triage check>"` gave 1/1, PASS and exit 0. It was re-run on the committed tree as the tracer gate.
- **Task 2:** the plan command gave 6/6, PASS and exit 0. AUD-EXIT-003 has `needs_fork: true` and a `fork_question`.
- **Task 3:** the plan command gave 5/5, PASS and exit 0.
- **Plan-level:** the six plan files gave 12/12, and `check.ts --stage partial --slice EXIT` exited 0 (pending 12), on the final committed tree.

**Repeatability and the whole project:**
- **AC-10:** all seven files ran three times with the JSON reporter: 13 tests and 17 knownBug records, identical across runs.
- **Whole realpath project:** `node node_modules/vitest/vitest.mjs run --project realpath` gave 26 files and 113/113 (100 before, plus 13).

**Gates and type check:**
- `scripts/check-realpath-mocks.ts`: 32 vi uses (7 mock calls) in 39 files, 0 violations.
- `tsc -p <scratchpad tsconfig extending the repo's, include test/realpath/triage/**/*.ts>`: 0 errors over 24 triage files.

**Register:**
- `check.ts --stage partial`: PASS, fail 0, pending 63. `--stage consolidation`: PASS. `--self-test`: 50/50.
- `--stage triage`: 63 FAILs, all expected:
  - 42 population entries other plans have not recorded;
  - 16 S0/S1 acknowledgements owed to 23-16 (5 of them this plan's);
  - 3 `fork_ref`s (AUD-EXIT-003 plus 23-05's two);
  - AUD-TX-006's keep-open ruling;
  - the run-evidence file.

**src and fix signals:**
- `git status --porcelain src` was empty at every commit and after every mutation.
- **Fix-signal proofs:** scratch mutations of `src/`, run on Node 22.16.0. The original bytes were written back each time, and `git hash-object` was IDENTICAL to the HEAD blob.
- The full batch (`mutate-all.cjs`) ran every mutation against all six plan files. The two AUD-EXIT-027 mutations were run against AUD-EXIT-027.test.ts, and the unwrap one also against the 001/003/004 files (9/9 pass).

| Mutation | Result |
|---|---|
| none | all pass |
| 002-retry (retry the first quote) / 002-alert (alert "position UNPROTECTED") | AUD-EXIT-002 looks fixed; every other test passes |
| 013-resume-dexname / 013-antirug-dexname | AUD-EXIT-013 looks fixed on its own claim each (the anti-rug one shown to leave the exit claim reproduced) |
| 015-stored-probe (resume with the buy's stored amount) | AUD-EXIT-015 looks fixed, both claims (the second shown alone in a scratch copy) |
| 003-decimals-probe | AUD-EXIT-003 probe claim looks fixed |
| 003-reject-zero-entry / 003-finite-guard | AUD-EXIT-003 Infinity and NaN claims look fixed |
| 003-urgency-on-null | AUD-EXIT-003 urgency claim looks fixed |
| 001-floor (positive floor in both builders) | all four AUD-EXIT-001 tests look fixed |
| 001-floor-v2-only | only the two V2 tests look fixed |
| 004-approve-at-buy / 004-ceiling / 004-max-approve | AUD-EXIT-004 looks fixed on its public-route, fee-ceiling and second-approve claims respectively |
| 027-unwrap-in-batch / 027-withdraw-after | AUD-EXIT-027 looks fixed; AUD-EXIT-001/003/004 still pass |

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

**Plan 23-16 must:**
- acknowledge AUD-EXIT-001, -002, -003, -013 and -015 (S1) in the batch report;
- add the UFV entry (owner Phase 25) for AUD-EXIT-003 with its recorded fork question, and set `fork_ref`;
- collect the 17 knownBug records from these seven files into the run evidence.

**Phase 24:**
- Each file can be run alone as a before-and-after proof; fix shapes the markers do not see are written in each test header.
- AUD-EXIT-013's dashboard sells and AUD-EXIT-015's re-arm path are code-read only, and should get a test with their fix.
- AUD-EXIT-001's marker is per path (V2, V3, full, partial), so a partial fix shows which paths remain.

**Phase 29:**
- AUD-EXIT-027 (unwrap V3 proceeds, or count WETH in the floor checks).
- AUD-EXIT-004 (card EXIT-03).

**Harness owners:**
- AUD-TESTI-028: until it is fixed, no realpath test file may declare an `afterEach` that can throw.

## Self-Check: PASSED

- **Files found:** the seven triage test files and two fixtures under test/realpath/triage/; .planning/audit/findings/AUD-EXIT-027.json and AUD-TESTI-028.json.
- **Commits found on this branch:** f7a7400, 538c5b2, 9b08850 and 2db1c81 (`git rev-list --count 616666e..HEAD` = 4 before this SUMMARY).
- **Re-run after the last commit:** every task's acceptance criteria and the plan-level verification pass.
- **Clean tree:** no scratch file is left under test/, and `git status --porcelain src test` is empty.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*
