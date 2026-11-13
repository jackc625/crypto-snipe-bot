---
phase: 23-test-safety-net-harness-triage-characterization
plan: 22
subsystem: testing
tags: [golden-master, characterization, realpath-harness, bloxroute, passthrough, risk-gate, fees, gas, vitest, ethers, CHAR-02]

requires:
  - phase: 23-20
    provides: runScenario, driveSlots, SLOT_MS (driver.ts), the serializer and compare step, recordingsGuard.test.ts, npm run recordings:update
  - phase: 23-28
    provides: createScenario for bsc/base and V2/V3 with the per-chain checker, the bloXroute and public routes, setFees (legacy), mine({ baseFeePerGas }), setReceiptLogs, httpLog params
  - phase: 23-21
    provides: the V3 scenario patterns (buy-shape proof, completion proofs) and the rule that inputs must trip each decision for its own reason
  - phase: 23-07
    provides: fixtures/AUD-EXIT-002-position.ts and fixtures/AUD-EXIT-001-sell-path.ts (listen, buyAndMine, installSellPath, foreignTrade, sellsSubmitted)
provides:
  - "test/realpath/scenarios/otherRoutes.test.ts: six route scenarios (bsc bloXroute V2/V3 buys and a full sell; base public V3 buy and full sell; base V2 today's AUD-BUY-016 skip), each asserting the checker read and proving the route finished"
  - "test/realpath/scenarios/riskAndFees.test.ts: risk-gate refusal (explicit empty list), the fee and gas figures, the affordability boundary below/at/above, and a legacy-fee node"
  - "Twelve committed recordings, each committed once: bloxroute-v2-buy, bloxroute-v3-buy, bloxroute-full-sell, public-v2-buy, public-v3-buy, public-full-sell (958f5df); risk-gate-refused, fee-gas-eth-v2, fee-gas-eth-v2-reserve-below, -reserve-at, -reserve-above, fee-gas-eth-v2-legacy (77e4175)"
  - "Register: AUD-TX-030 (S4) and AUD-BUY-037 (S4), registered and proven on the real path"
affects: [23-25, 23-26, phase-24, phase-29]

actuals:
  tokens: 47681   # chars/4 over the added lines of 22ad1a2..77e4175 (21 files, 190725 chars)
  tasks: 2
  commits: 2      # MEASURED: git rev-list --count 22ad1a2..HEAD before this SUMMARY commit
plan_head_before: 22ad1a253db8b6da98772ba61e87a9b802a11f70
plan_head_after: 77e41755f69e6b6a7a0c696b94feb89a4d89e22c
commits: 2

tech-stack:
  added: []
  patterns:
    - "Non-ETH golden master: the chain runs at its own block time (file-local driveBlocks, BSC 0.75 s, Base 2 s) and lands bloXroute-accepted transactions, which driver.ts driveSlots (ETH 12 s, public and bundle only) cannot"
    - "Route completion proof: the signed transaction the route carried (bloXroute relay body or eth_sendRawTransaction) parsed with real Transaction.from has the hash the route answered and the bot stored, is mined in node.history, its real receipt was read by the bot, and on the public route the row came only after the three tx.wait(3) confirmations"
    - "A boundary scenario derives its inputs from the real exported computation (computePublicExitReserveWei, computeAffordablePriorityFee over the fee data the strategy reads) and fails naming the findings that shape the boundary when it moves"

key-files:
  created:
    - test/realpath/scenarios/otherRoutes.test.ts
    - test/realpath/scenarios/riskAndFees.test.ts
    - test/realpath/recordings/bloxroute-v2-buy.jsonl
    - test/realpath/recordings/bloxroute-v3-buy.jsonl
    - test/realpath/recordings/bloxroute-full-sell.jsonl
    - test/realpath/recordings/public-v2-buy.jsonl
    - test/realpath/recordings/public-v3-buy.jsonl
    - test/realpath/recordings/public-full-sell.jsonl
    - test/realpath/recordings/risk-gate-refused.jsonl
    - test/realpath/recordings/fee-gas-eth-v2.jsonl
    - test/realpath/recordings/fee-gas-eth-v2-reserve-below.jsonl
    - test/realpath/recordings/fee-gas-eth-v2-reserve-at.jsonl
    - test/realpath/recordings/fee-gas-eth-v2-reserve-above.jsonl
    - test/realpath/recordings/fee-gas-eth-v2-legacy.jsonl
    - .planning/audit/findings/AUD-TX-030.json
    - .planning/audit/findings/AUD-BUY-037.json
  modified:
    - test/realpath/recordingsGuard.test.ts
    - .planning/audit/ledger/BUY.json
    - .planning/audit/ledger/TX.json
    - .planning/audit/sweep/contrib-PHASE23.json
    - .planning/audit/AUDIT-FINDINGS.md
    - .planning/phases/23-test-safety-net-harness-triage-characterization/deferred-items.md

key-decisions:
  - "Operator ruling for this plan (asked by the orchestrator before dispatch, 2026-11-12; the operator chose \"Record today's skip (Recommended)\", the label was the orchestrator's): public-v2-buy records today's AUD-BUY-016 skip on base, not a buy. The recording is the header and the exact {\"submitted\":[]} line, tagged SUSPECT(AUD-BUY-016); assertComplete proves the skip (skip line with locked:false as the only failed check, GoPlus asked about the pair only, the checker read, no submission, no eth_sendRawTransaction, no trades row) and the test throws 'AUD-BUY-016 looks fixed' when the bot buys. This resolves the STATE.md blocker '23-22 premise (found by 23-28, AUD-BUY-016)'"
  - "public-full-sell buys through base V3 (the V3 bank has no lock check, so AUD-BUY-016 does not reach it); bloxroute-full-sell buys through bsc V2 (the Mudra lock check passes)"
  - "The non-ETH chains run at their own block time in a file-local driver (driveBlocks: BSC 0.75 s, Base 2 s), mining the wallet's public and bloXroute-accepted transactions in nonce order; driver.ts is unchanged"
  - "recordingsGuard.test.ts gained one AC-51 rule (the bare-hex relayHash.txHash of a bloxroute.relay.accepted line, only when it equals that line's signedTxHash) and an AC-23 scope fix (the not-sorted check needs a submission or 3+ lines of 2+ kinds; every recording must keep time order), each with temp-directory or mutation proofs"
  - "Registered under the operator's standing instruction (no stop): AUD-TX-030 (S4, capital none), the Flashbots legacy-fee branch sends the raw gasPrice and drops the clamped fee; AUD-BUY-037 (S4, capital none), the snipe fail-clean line is fixed inclusion-exhausted text whatever the cause"
  - "Tags: risk-gate-refused is the only KEEP (its timeline shows only the two rows the test seeded and the empty list); fee-gas-eth-v2 cites AUD-TX-007 because its submitted maxFeePerGas minus the priority fee is the doubled base fee (60 gwei against the 30 gwei block)"

patterns-established:
  - "A scenario whose outcome rests on a confirmed finding throws '<ID> looks fixed' (or 'boundary moved' naming the IDs) when a fix lands, proven against a fix-shaped src mutation, so Phase 24 sees a named signal, not an unrelated assertion"

requirements-completed: [CHAR-02]

coverage:
  - id: D1
    description: "bloXroute (bsc) and public-route (base) buys and full sells, each asserting the checker read and proving relay acceptance, mined inclusion, the receipt and (public) three confirmations before the compare"
    requirement: CHAR-02
    verification:
      - kind: integration
        ref: "test/realpath/scenarios/otherRoutes.test.ts (6 tests), three normal runs and two full parallel runs byte-identical"
        status: pass
    human_judgment: false
  - id: D2
    description: "Risk-gate refusal with the explicit empty list, the fee and gas figures, the affordability boundary below/at/above, and the legacy-fee buy"
    requirement: CHAR-02
    verification:
      - kind: integration
        ref: "test/realpath/scenarios/riskAndFees.test.ts (6 tests), three runs then git diff --exit-code -- test/realpath/recordings clean, grep of the empty-list line"
        status: pass
    human_judgment: false
  - id: D3
    description: "Recordings guard over all 22 recordings with this plan's files present, including the bloXroute answer rule and the AC-23 scope fix"
    requirement: CHAR-02
    verification:
      - kind: integration
        ref: "test/realpath/recordingsGuard.test.ts (13 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUD-TX-030 and AUD-BUY-037 registered with real-path evidence and named fix signals"
    verification:
      - kind: other
        ref: "check.ts --stage partial, consolidation and triage RESULT PASS; fix-shaped src mutations read '<ID> looks fixed' (src restored identical)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Scenario tags (AC-21, AC-46): every cited ID is a confirmed finding whose behavior the timeline shows; no confirmed-bug behavior is tagged KEEP"
    requirement: CHAR-02
    verification:
      - kind: integration
        ref: "test/realpath/recordingsGuard.test.ts#every recording under test/realpath/recordings passes AC-21, AC-22, AC-26 and AC-51 (IDs exist)"
        status: pass
    human_judgment: true
    rationale: "Whether each tag names every confirmed finding the timeline shows is a review judgment (the plan's AC-46 verification is 'judgment: review of scenario tags against the register'); the evidence lines and the findings ruled out are listed below"

duration: 43min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 22: bloXroute, Public-Route, Risk-Gate and Fee Golden Masters Summary

**Twelve byte-compared recordings now cover the two non-Flashbots routes (bsc bloXroute and base public: V2 and V3 buys and a full stop-loss sell, plus today's base V2 skip), a risk-gate refusal that records the explicit empty list, and the fee and gas figures of an ETH buy: the normal case, one wei below, at and above the affordability clamp's boundary, and a legacy-fee node. Two defects found on the way are registered: AUD-TX-030 (the Flashbots legacy branch ignores the clamped fee) and AUD-BUY-037 (the fail-clean line misreports an affordability refusal).**

## Performance

- **Duration:** about 43 min
- **Started:** 2026-11-12T16:31:37Z
- **Completed:** 2026-11-12T17:15Z
- **Tasks:** 2 of 2
- **Files:** 16 created, 6 modified

## Accomplishments

- **Task 1 (tracer): the bloXroute and public routes.** Every scenario asserts the HoneypotChecker read at the scenario's own checker address (the env value reached the registry), so a fail-closed skip can never pass as a route. `assertComplete` then checks, in order:
  1. The signed transaction the route sent, parsed with real `Transaction.from`, has the hash the route answered and the bot stored. For bloXroute the route's answer is the relay's `txHash`; for the public route it is `wallet.sendTransaction`'s hash.
  2. `node.history` shows that hash mined.
  3. The node's real receipt (status 1) was read by the bot.
  4. On the public route, the trades row was written only after the inclusion block and two more had been mined.

  The full sells also check that the bot decoded the sell receipt's WETH log (`exit.receipt.decoded`) and closed the position. The tracer gate re-ran the Task 1 verify after `958f5df` and it passed.
- **Task 2: the risk gate and the fee math.**
  - `risk-gate-refused` seeds two open buys through the real `insertTrade` statement under `MAX_OPEN_POSITIONS=2`. The new pair is refused with `max_positions` before the safety bank runs (no checker read), and the recording is the two seeded rows plus `{"submitted":[]}`.
  - The fee scenarios check every recorded fee number against real ethers `getFeeData` and the real exported clamp functions.
  - The reserve trio sits on the clamp's real boundary: 0.16 ETH, with the wallet one wei below, exactly at and one wei above it.
  - The legacy recording holds no EIP-1559 field.
- **Register.** AUD-TX-030 and AUD-BUY-037 were each found while reading a recording, diagnosed to a code cause, proven against a fix-shaped src mutation and registered with ledger rows, a sweep contribution and a re-rendered AUDIT-FINDINGS.md.

## Task Commits

1. **Task 1: bloXroute and public-route golden masters (tracer)** - `958f5df` (test)
2. **Task 2: risk-gate refusal and fee/gas golden masters; register AUD-TX-030 and AUD-BUY-037** - `77e4175` (test)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

Committed once, checked with `git log --format=%h -- <file>` (no `--follow`): the six route recordings `958f5df` each, the six risk and fee recordings `77e4175` each, one hash per file.

## Files Created/Modified

- `test/realpath/scenarios/otherRoutes.test.ts` - the six route scenarios, plus `driveBlocks`, `installBuyReceipt`, `installV2SellSimulation` and the route completion proofs
- `test/realpath/scenarios/riskAndFees.test.ts` - the six risk and fee scenarios, `affordabilityBoundary` and `fireLegacyPair`
- `test/realpath/recordings/*.jsonl` - 12 recordings, 181 lines in all (34, 15, 15, 2, 12, 31, 4, 20, 4, 4, 20, 20)
- `test/realpath/recordingsGuard.test.ts` - one AC-51 rule, the AC-23 scope fix, 5 new temp cases
- `.planning/audit/findings/AUD-TX-030.json`, `AUD-BUY-037.json` - the two new entries
- `.planning/audit/ledger/BUY.json`, `TX.json` - each entry on its file's ledger row
- `.planning/audit/sweep/contrib-PHASE23.json` - one contribution each
- `.planning/audit/AUDIT-FINDINGS.md` - re-rendered (OPERATOR-DECISIONS.md byte-unchanged)
- `deferred-items.md` - the harness launch helpers cannot launch on a legacy-fee node

## Scenario Tags (AC-21, AC-46)

Line numbers are file lines (line 1 is the header).

**bloxroute-v2-buy** `SUSPECT(AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-003,AUD-TX-016)`
- AUD-TX-016: the bloXroute buy at line 3 bids gasPrice 2 gwei. That is the node's 1 gwei gasPrice plus the 1 gwei escalation step; the multiplier-scaled going rate above base is only 0.1 gwei, so the bot tips about ten times the going rate.
- AUD-DB-004: the relay body and the submit are at lines 2-4 (+0.00 s), but the trades insert is at line 6 (+4.03 s), after the reconcile loop returned.
- AUD-DB-002: the buy row's amount_in is "0.05", a native decimal (line 6).
- AUD-EXIT-003: entry_price 996999950299 (line 7) is the quote of parseEther(snipe) used as raw token units.
- AUD-ANTIRUG-024: chain_state is created with last_seen_block "0" (line 12), followed by `antirug.backfill.gap-detected` (line 14).

**bloxroute-v3-buy** `SUSPECT(AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-003,AUD-TX-016)`
- AUD-BUY-033: the buy at line 3 is multicall([exactInputSingle]) carrying 0.05 BNB value, with no refundETH.
- The other IDs show on the same lines as bloxroute-v2-buy (TX-016 3, DB-004 2-6, DB-002 6, EXIT-003 7, ANTIRUG-024 12 and 14).

**bloxroute-full-sell** `SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-TX-016)`
- The buy half is lines 2-15, as in bloxroute-v2-buy.
- AUD-EXIT-003: the trigger at line 16 is "Fixed stop-loss at 0.59x (-40.8%)", a ratio of probe quotes.
- AUD-EXIT-004: line 19 is a public approve of exactly the whole position (2486302890046558951812) at ethers' default gasPrice of 1 gwei.
- AUD-EXIT-001 and AUD-TX-016: the bloXroute sell at line 22 is `swapExactTokensForETH(amount, 0, ...)` (minimum output 0) at gasPrice 2 gwei.
- AUD-DB-002: the sell row at line 31 is in wei, against the buy's "0.05".
- AUD-ANTIRUG-015: the close at lines 32-34 never deletes the lp_baseline row inserted at line 9.

**public-v2-buy** `SUSPECT(AUD-BUY-016)`
- The whole recording is the header and `{"submitted":[]}`: a base V2 launch whose safety bank passes every check except the lock is never bought (operator ruling above).
- The skip line itself carries no `op`, so it is not on the timeline; assertComplete proves it.

**public-v3-buy** `SUSPECT(AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-003,AUD-TX-016)`
- AUD-BUY-033 and AUD-TX-016: the buy at line 2 is multicall([exactInputSingle]) with no refundETH, at maxPriorityFeePerGas 1 gwei against the node's going 0.001 gwei.
- AUD-DB-004: the trades insert is at line 3 (+8.07 s), after tx.wait(3) returned.
- AUD-DB-002: amount_in "0.005" (line 3). AUD-EXIT-003: line 4. AUD-ANTIRUG-024: lines 9 and 11.

**public-full-sell** `SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-027,AUD-TX-016)`
- The buy half is lines 2-12, as in public-v3-buy.
- AUD-EXIT-003: the stop-loss "0.59x" at line 13.
- AUD-EXIT-004: line 16 is a public approve of exactly the whole position (996006981039903216493) at ethers' default fees.
- Line 18 is the sell: multicall([exactInputSingle(token -> WETH, recipient the wallet, minimum 0)]) at maxPriorityFeePerGas 1 gwei. That is AUD-EXIT-001 (the finding names the passthrough chains), AUD-EXIT-027 (no unwrap) and AUD-TX-016.
- AUD-DB-002: the sell row in wei at line 28. AUD-ANTIRUG-015: the close at lines 29-31.

**risk-gate-refused** `KEEP`
- Lines 2-3 are the two rows the test seeded through the real insertTrade statement; line 4 is the empty list. The bot wrote nothing and sent nothing.
- The refusal is correct behavior with every other rule clear: no position-size cap, no daily loss, and the count is checked before the exposure.
- The refusal line ("Risk check failed, skipping snipe", reason max_positions) has no `op`, so it is not on the timeline.
- No confirmed finding's behavior is shown. The rows' "0.01" amount is the test's seed, written in the bot's format; it is not a bot decision.

**fee-gas-eth-v2** `SUSPECT(AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-003,AUD-TX-007,AUD-TX-012)`
- AUD-TX-007: the buy at line 4 is maxFeePerGas 62 gwei and maxPriorityFeePerGas 2 gwei. The difference, 60 gwei, is the strategy's baseFeeWei: twice the 30 gwei block base fee this scenario sets (asserted).
- AUD-DB-004 and AUD-TX-012: the submit is at +0.00 s; inclusion (line 8) and the trades row (line 11) both come at +12.04 s, at the inclusion block.
- AUD-DB-002: line 11. AUD-EXIT-003: line 12. AUD-ANTIRUG-024: lines 17 and 19.

**fee-gas-eth-v2-reserve-below** and **-reserve-at** `SUSPECT(AUD-BUY-037,AUD-TX-007,AUD-TX-021,AUD-TX-027)`
- Line 2 is `mev.escalation.unaffordable` at attempt 0, with walletBalanceWei 159999999999999999 (below) or 160000000000000000 (at) and buy and sell gas limits of 1000000. The two files differ only in that number.
- The boundary is snipe + computePublicExitReserveWei + gas x baseFeeWei = 0.01 + 1e6 x 1.5 x 60 gwei + 1e6 x 60 gwei = 0.16 ETH. Three confirmed findings shape it:
  - AUD-TX-007: 60 gwei is the doubled base fee; at the real 30 gwei both balances would be affordable.
  - AUD-TX-021: the reserve counts no priority fee.
  - AUD-TX-027: the sell reserve uses the buy's 1,000,000-gas estimate, with no cap at maxGasLimit.
- AUD-BUY-037: line 3, `buy.snipe.fail-clean`, says "hardened private inclusion exhausted", attempts 4, statsRef op:flashbots.bundle.stats, although no attempt was submitted and no stats line exists.

**fee-gas-eth-v2-reserve-above** `SUSPECT(AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-003,AUD-TX-007,AUD-TX-012,AUD-TX-021,AUD-TX-027)`
- The buy at line 4: gasLimit 1000000 (AUD-TX-027: the node's estimate, uncapped against maxGasLimit 300000), maxPriorityFeePerGas 0 and maxFeePerGas 60 gwei. One wei of headroom divided by 1,000,000 gas leaves a priority fee of 0, and that bound is computed with the doubled base fee and the priority-free reserve (AUD-TX-007, AUD-TX-021).
- The rest (lines 8-20) is fee-gas-eth-v2's trail, apart from the hashes: DB-004/TX-012 lines 8-11, DB-002 11, EXIT-003 12, ANTIRUG-024 17 and 19.

**fee-gas-eth-v2-legacy** `SUSPECT(AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-003,AUD-TX-012,AUD-TX-030)`
- AUD-TX-030: the buy at line 4 is type 0 at gasPrice 25 gwei, exactly the node's price. The helper's clamped fee (1 gwei, checked with the real clamp) is dropped; the other two strategies would send 26 gwei.
- No line holds maxFeePerGas, maxPriorityFeePerGas or baseFeePerGas (grep count 0, and asserted on the serialized timeline).
- The rest (lines 8-20) is fee-gas-eth-v2's trail.

**Which confirmed findings shape each recorded fee number:**

| Recording | Field | Value | Findings that set it |
|---|---|---|---|
| fee-gas-eth-v2 | maxFeePerGas | 62 gwei = baseFeeWei 60 (2 x 30) + 2 | AUD-TX-007 |
| fee-gas-eth-v2 | maxPriorityFeePerGas | 2 gwei, the chain rate over the 1 gwei step | none: the clamp does not bind at 10 ETH |
| reserve-below/-at/-above | balances | the 0.16 ETH boundary | AUD-TX-007, AUD-TX-021, AUD-TX-027 |
| reserve-above | priority fee | 0 | AUD-TX-007, AUD-TX-021, AUD-TX-027 |
| reserve-above | gasLimit | 1000000 | AUD-TX-027 |
| fee-gas-eth-v2-legacy | gasPrice | 25 gwei | AUD-TX-030 |
| bsc recordings | gasPrice | 2 gwei | AUD-TX-016 |
| base recordings | priority fee | 1 gwei | AUD-TX-016 |

**Confirmed findings checked and ruled out (all twelve unless noted):**
- **AUD-TX-012 on bsc and base.** The bloXroute decision is the reconcile poll about 4 s after submission. At BSC's 0.75 s cadence the chain is then 4-5 blocks past inclusion, so a one-confirmation rule cannot be told from a deeper one. The public route waits for 3 confirmations. It is cited only on the ETH fee recordings, where the row is written at the inclusion block.
- **AUD-TX-007 in the route recordings.** No reserve-dependent figure appears with a 10-BNB or 10-ETH wallet. The bloXroute base is gasPrice, which is not doubled (the finding's own sibling note).
- **AUD-TX-002 and AUD-EXIT-009** (wait() inside the nonce lock): the lock is not on the timeline, and every transaction is mined.
- **AUD-TX-011:** the passthrough wait never errors here. **AUD-TX-017:** the helper's alerts are not recorded.
- **AUD-TX-010, AUD-TX-019, AUD-TX-021 outside the reserve trio:** no reserve or ceiling decision is visible. **AUD-TX-025:** the poll runs inside its window. **AUD-TX-028:** see Hold Points.
- **AUD-BUY-028:** the Mudra lock covers the whole LP supply. **AUD-BUY-019:** no reorg, and launch processing has no op line. **AUD-BUY-003:** every buy's minimum output is non-zero.
- **AUD-BUY-001, -002, -004, -010, -018, -020, -025, -029, -030:** the deliberate-buy, failure, race and escalation paths are not exercised.
- **AUD-BUY-009, -022, AUD-DB-018:** alert text is not recorded.
- **AUD-DB-001, -003, -013, -014:** risk arithmetic is not on the timeline. In risk-gate-refused the count rule decides before the exposure arithmetic.
- **AUD-EXIT-002, -005, -007, -008, -013, -015, -019, -021, -022, -024, -025, -026:** not exercised. Every `exit.poll.cycle` durationMs is 10, and AUD-EXIT-025 shows "[]".
- **AUD-ANTIRUG-001..-023 and -025:** no reconnect, restart, backfill, rug or breaker path runs, and no scenario restarts the graph.
- **AUD-ANTIRUG-015 outside the full sells:** no position closes.
- **Candidates, not cited:** AUD-TX-020 and AUD-EXIT-020.

## Hold Points (AUD-TX-028)

No scenario holds any call in flight. Buys and sells land through the chain cadence: driveBlocks on bsc and base, buyAndMine's one 12 s slot on ETH, and driveSlots for the bounded no-send windows. No provider read, relay call or bundle is parked, so AUD-TX-028 cannot decide a result.

## Decisions Made

- **Operator ruling (public-v2-buy):** see key-decisions. The ruling's "skip op line" has no op in today's code, so the recording is the header and the empty list only.
- **Chain cadence:** BSC at 0.75 s (its block time since the 2025 Maxwell upgrade) and Base at 2 s, in a file-local driver.
  - driveSlots is ETH-specific (12 s, Flashbots target blocks) and never mines a bloXroute transaction, so a bloXroute sell could not land under it.
  - The driver only reads and mines through the public FakeNode API, like 23-21's V3 rug helpers. No Harness Gap: a fixture beside the test supplies it.
- **Receipts of buys:** the bot decodes receipt logs only on the sell path (`exit.receipt.decoded`); for a buy it reads only the receipt's status (bloXroute reconcile, passthrough tx.wait).
  - The buy receipt therefore carries the token Transfer(pool -> wallet) a real swap emits (`installBuyReceipt`, setReceiptLogs).
  - The scenario decodes that log with real ethers and checks the bot fetched the receipt.
  - "Decoded by the bot" holds literally for the sells.
- **The bot's own sell simulation (bsc V2):** bloxroute.ts and passthrough.ts simulate the sell with provider.call before sending. On ETH Flashbots simulates through the relay instead, so no earlier plan needed this read.
  - The V2 router's answer is served file-locally (`installV2SellSimulation`).
  - It reverts as the router does on path, deadline, balance or allowance (replayed from mined approves and sells) and on minimum output.
  - The V3 sell simulation is the harness's own multicall read.
- **The reserve boundary:** taken from the real exported functions over the strategy's own fee read, with a 1,000,000-gas estimate.
  - With an ordinary estimate the entry gate (which prices at maxGasLimit 300,000) refuses first and the clamp never decides. Each balance's clearance of the gate is asserted, and AUD-TX-007's 23-05 strategy test used the same approach.
  - A boundary that moves fails with "The affordability boundary moved ... AUD-TX-007, AUD-TX-021 or AUD-TX-027". This was proven with a real-base-fee mutation of flashbots.ts, which moved all three.
- **AUD-TX-007 on fee-gas-eth-v2:** cited because the doubled base fee is in the submitted maxFeePerGas, which the plan expected.
  - Note for 23-25/23-26 reviewers: 23-20 and 23-21 did not cite it on their ETH buys (maxFeePerGas 21 = 2 x 10 + 1) because no reserve is logged there.
  - The recommended fix keeps 2 x base + tip as the maxFeePerGas cap, so this number need not change when AUD-TX-007 is fixed.
- **Legacy launch:** `fireNewPair` signs the deployer's launch by the chain profile (type 2 on ETH), and a legacy node refuses that.
  - `fireLegacyPair` sends the same launch as type 0 with the same deployer key, router call, reserves and PairCreated log.
  - The launch is a foreign transaction and is not on the timeline. Logged in deferred-items.md for a later harness owner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] recordingsGuard.test.ts rejected the bloXroute answer hash**
- **Found during:** Task 1, the first guard run over bloxroute-v2-buy.
- **Issue:** bloXroute answers bsc_private_tx with `{ txHash }` as hex without 0x, and bloxroute.ts logs that answer whole as `relayHash`. The guard allows a 64-hex value only as 0x + 64 hex in a named hash field.
- **Fix:** one rule. In a `bloxroute.relay.accepted` op line, the txHash of the fields' relayHash object may be bare hex, only when it equals that line's signedTxHash. The reason is in the guard's header.
- **Proof:** four bad temp cases (another hash, another op, another field, a nested txHash) and one good case. A mutation without the rule fails the real recording at line 4 and the good case.
- **Files modified:** test/realpath/recordingsGuard.test.ts (not in files_modified; the orchestrator allowed one narrow AC-51 rule).
- **Committed in:** 958f5df.

**2. [Rule 3 - Blocking] The AC-23 order check rejected a no-submission recording**
- **Found during:** Task 1, public-v2-buy.
- **Issue:** the check required more than 2 body lines and not-sorted content and kinds in every recording. It cannot pass a recording with no entries (public-v2-buy) or a few entries of one kind (risk-gate-refused), and AC-22 requires such recordings.
- **Fix:** the not-sorted checks still apply to any recording with a submission, or with 3 or more lines of 2 or more kinds. A smaller no-submission recording must end in the empty list. Every recording must now keep time order (`at` never decreases), which is a new check.
- **Proof:** a sorted public-v3-buy, a time-reversed short recording and a sorted 3-line, 2-kind no-submission recording all fail. All 22 recordings pass. The secret scan is untouched.
- **Files modified:** test/realpath/recordingsGuard.test.ts.
- **Committed in:** 958f5df.

**3. [Rule 3 - Blocking] The bsc sell simulation read was not served**
- **Found during:** Task 1, bloxroute-full-sell: a stray call, `0x18cbafe5` on the router.
- **Fix:** `installV2SellSimulation`, file-local on the public FakeNode API (see Decisions).
- **Committed in:** 958f5df.

**4. [Rule 3 - Blocking] The harness launch cannot run on a legacy node**
- **Found during:** Task 2, fee-gas-eth-v2-legacy.
- **Fix:** the file-local `fireLegacyPair` (see Decisions). A fixture beside the test supplies it, so by the Harness Gap Procedure's own test it is not a gap. Logged in deferred-items.md.
- **Committed in:** 77e4175.

**5. [Rule 2 - Missing critical] Named fix signals**
- **Found during:** Task 2.
- **Issue:** without them, a Phase 24 fix of AUD-TX-030, AUD-BUY-037 or the boundary findings would fail on an unrelated assertion before the recording diff.
- **Fix:** each now fails as "<ID> looks fixed" or "boundary moved". Proven by fix-shaped src mutations; src was restored identical each time, checked by hash-object against the HEAD blob and an empty `git status --porcelain src`.
- **Committed in:** 77e4175.

---

**Total deviations:** 5 auto-fixed (4 Rule 3, 1 Rule 2).
**Impact on plan:** each change either lets a recording the plan requires exist on the real path, or makes a future fix announce itself. No harness, driver, fixture, rail or src/ file was changed.

## Grade Changes and New Findings

Registered by this executor under the operator's standing instruction (2026-11-11, verbatim: "All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading"), with no stop:

| Entry | Grade | What | Evidence | Commit |
|---|---|---|---|---|
| AUD-TX-030 (new, confirmed) | S4, capital none | The Flashbots legacy-fee branch (flashbots.ts:213-216 at 23a6461) sends `applyGasMultiplier(feeData.gasPrice, gasMultiplier)` and drops the helper's clamped fee (`a.priorityFeeWei`). So on a node with no EIP-1559 fields every attempt bids the same price, with no escalation, ceiling or affordability clamp on the bid. This is the CR-01 bypass that passthrough.ts:106-113 and bloxroute.ts:115 removed. It is unreachable on ETH today, whose blocks always carry a base fee. | fee-gas-eth-v2-legacy line 4 (25 gwei, against base + clamped = 26 gwei); a fix-shaped mutation reads "AUD-TX-030 looks fixed" | 77e4175 |
| AUD-BUY-037 (new, confirmed) | S4, capital none | `emitSnipeFailClean` (bot.ts:360-388) is fixed text for an exhausted inclusion, whatever ended the snipe. An affordability refusal before any submit is logged "hardened private inclusion exhausted", with attempts 4 (the budget), statsRef to Flashbots stats that do not exist (on bsc and base, never), and a remediation to raise the buy ceiling. Only `reason` carries the real cause. A sibling of AUD-TX-029. | reserve-below and -at, line 3; a fix-shaped mutation reads "AUD-BUY-037 looks fixed" | 77e4175 |

No severity changed. No existing finding was edited.

## Issues Encountered

- **The bsc sell is a type-1 transaction** (bloxroute-full-sell line 22), while the buy is type 0. Diagnosed:
  - buildV2SellTx sets no `type`, and bloxroute.ts adds only gasPrice.
  - ethers 6.16.0 `Transaction.inferType` (lib.commonjs/transaction/transaction.js:1015-1067) takes the highest compatible type, which for a gasPrice-only request is 1, an EIP-2930 transaction with an empty access list.
  - The snipe buy is built by `wallet.populateTransaction`, which sets type 0 on a chain whose fee data has no maxFeePerGas.
  - BSC accepts type 1 at the same cost, so this is characterization, not a defect.
- **One error-level line in every recording that arms a position:** `antirug.backfill.gap-detected`, which is AUD-ANTIRUG-024 and is cited.
- **Two further error lines** in reserve-below and -at: `mev.escalation.unaffordable` (the refusal those scenarios force) and `buy.snipe.fail-clean` (AUD-BUY-037).
- No other warn, error or fatal line appears in the recordings, and the scenario and guard runs printed none. The full runs reported no unhandled error.
- **The first scratch type-check** failed on `types: hardhat`, because the scratch config extends tsconfig.json from outside the repo. With `types: ["node"]` it is clean; it was not a code error.

## Timing

| Test | Full run 1 (Task 1 files) | Full run 2 (all files) | Limit |
|---|---|---|---|
| bloxroute-v2-buy (pays the cold graph import) | 1.87 s | 1.63 s | 15 s |
| bloxroute-full-sell / public-full-sell | 1.18 / 1.09 s | 0.99 / 1.08 s | 15 s |
| risk-gate-refused (first test of its file, cold import) | - | 1.20 s | 15 s |
| other scenarios of this plan | at most 0.56 s | at most 0.70 s | 15 s |

No test of this plan is near half its limit, so none has its own `{ timeout }`, and no hook is declared. Existing tests in the same two full runs (not this plan's, left unchanged):
- backupState's self-check: 52.2 s and 59.5 s of 120 s (43 and 50 percent), inside the 47.6-69.5 s range of 23-19 to 23-21.
- buyNonceLock "exposes submitBuyTx": 2.95 s and 2.77 s, the known hook case (32 percent of the 10 s hookTimeout).
- signingCensusGate: 63.4 s and 68.8 s of 250 s.

## Verification (Node 22.16.0)

- **Task 1 verify:** the six scenarios and the guard, 19/19. The tracer gate re-ran it after `958f5df` and it passed.
- **Task 2 verify (exact command):** three runs of both scenario files and the guard, each exit 0. Then `git diff --exit-code -- test/realpath/recordings` was clean and the `"submitted":[]` grep found the line. risk-gate-refused ends in the exact 16 characters `{"submitted":[]}` plus LF.
- **AC-24 / AC-10:** three JSON-reporter runs gave identical digests (25 tests, names and statuses; these files hold no knownBug records). All 12 files matched their generated sha256 after every normal run and after both full parallel runs.
- **Acceptance:**
  - Twelve recordings, 0 CR.
  - Each recording shows its route's submission: bloxroute and public, with the base V2 skip by ruling.
  - Each route test asserts the checker read, compares the signed hash with the route's returned hash, and requires `mined` in node.history.
  - The reserve trio differ only in the balance fields or the refusal.
  - The legacy file has no EIP-1559 field.
  - `git status --porcelain src` is empty.
- **Full railed `npm test`:**
  - Run 1 (Task 1 files present): 204 files, 1430/1430, wall 181 s, ledger run-20261112T165002-13604-eb67a9.
  - Run 2 (final tree): 205 files, 1436/1436, wall 192 s, ledger run-20261112T170854-6236-3f9a87.
  - Both ledgers: nonLoopbackAllowed 0, telegramAllowed 0.
- **Type checks:** `tsc --noEmit` is clean on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json. A scratch tsconfig extending the repo's (module esnext, types node) gives 0 errors over `test/realpath/**`.
- **Static gates:**
  - `check:realpath-mocks`: 35 vi uses, 7 mock calls, 99 files, 0 violations.
  - `check:vi-mock`: 660 calls, 0 violations.
  - `check:census`: 23 sites (10 locked, 13 unlocked), 0 problems.
  - sourceTextGate, spawnSites, realpathMockGate and signingCensusGate: 17/17.
  - `red-proof-conversions.ts --check-manifest`: MANIFEST-OK rows 36 files 11 guards 1.
  - No test title was renamed.
- **check.ts:**
  - `--stage partial`, `consolidation` and `triage` all give RESULT PASS fail 0, before and after the register change. The guard edit needed no re_audit row: the file has no ledger row yet, the pre-existing bookkeeping kind.
  - `--stage final` gives 155 FAILs, 14 of them from this plan: missing TESTI ledger rows for the 12 recordings and the 2 scenario files. This is the same out-of-scope bookkeeping kind as before (141 after 23-21).
- **Mutation proofs** (nothing committed; src restored and checked by hash):
  - The guard without the bloXroute rule fails the real recording at line 4.
  - The AC-23 mutants fail as described in deviation 2.
  - flashbots.ts legacy branch set to `baseFeeWei + a.priorityFeeWei`: "AUD-TX-030 looks fixed".
  - A cause-aware fail-clean message in bot.ts: "AUD-BUY-037 looks fixed", on both below and at.
  - The real base fee in flashbots.ts: "The affordability boundary moved" on all three reserve scenarios.

## For Later Plans

- **23-25:** the commit check judges both commits of this plan. Every recording appears in exactly one commit, and none is a re-record.
- **23-26:** CHAR-02's scenario families are now all recorded (Flashbots V2 and V3, bloXroute, public, risk gate, fees). CHAR-02 is shared with 23-26, so it stays unmarked in REQUIREMENTS.md until 23-26 finishes.
- **Phase 24:** each of these fixes is announced by its scenario, then needs a `behavior:` re-record citing its ID (D-18):
  - AUD-BUY-016: public-v2-buy becomes the base V2 buy on route public.
  - AUD-TX-030: fee-gas-eth-v2-legacy line 4.
  - AUD-BUY-037: reserve-below and -at, line 3.
  - AUD-TX-007, AUD-TX-021 or AUD-TX-027: the three reserve recordings, after re-deriving the boundary.
  - AUD-TX-016: every bsc and base submit line.
  - AUD-EXIT-004, -001 and -027: the sell lines, as in 23-20 and 23-21.
- **A risk refusal with an `op`** (none exists today) would add one line to risk-gate-refused. That needs a behavior: commit, as for any recording change.
- **A later harness owner:** `signLaunch` could follow the node's fee mode (see deferred-items.md).

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

AC-19's scenario set is recorded across 23-20, 23-21 and this plan, and AC-22's explicit empty list is in risk-gate-refused and public-v2-buy. The STATE.md blocker "23-22 premise (found by 23-28, AUD-BUY-016)" is resolved by the operator ruling recorded above.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*

## Self-Check: PASSED

- Files present: both scenario files, all 12 recordings, AUD-TX-030.json and AUD-BUY-037.json.
- Commits on this branch: 958f5df and 77e4175 are both ancestors of HEAD.
- Commit count measured from the ledger: git rev-list --count 22ad1a2..77e4175 = 2.
- The acceptance criteria of both tasks and the plan-level verification were re-run after the last task commit, and all pass.
