---
status: complete
phase: 23-test-safety-net-harness-triage-characterization
source: 23-01-SUMMARY.md, 23-02-SUMMARY.md, 23-03-SUMMARY.md, 23-04-SUMMARY.md, 23-05-SUMMARY.md, 23-06-SUMMARY.md, 23-07-SUMMARY.md, 23-08-SUMMARY.md, 23-09-SUMMARY.md, 23-10-SUMMARY.md, 23-11-SUMMARY.md, 23-12-SUMMARY.md, 23-13-SUMMARY.md, 23-14-SUMMARY.md, 23-15-SUMMARY.md, 23-16-SUMMARY.md, 23-17-SUMMARY.md, 23-18-SUMMARY.md, 23-19-SUMMARY.md, 23-20-SUMMARY.md, 23-21-SUMMARY.md, 23-22-SUMMARY.md, 23-23-SUMMARY.md, 23-24-SUMMARY.md, 23-25-SUMMARY.md, 23-26-SUMMARY.md, 23-27-SUMMARY.md, 23-28-SUMMARY.md, 23-29-SUMMARY.md, 23-30-SUMMARY.md, 23-31-SUMMARY.md, 23-32-SUMMARY.md, 23-33-SUMMARY.md
started: 2026-11-13T05:08:59.735Z
updated: 2026-11-13T06:25:03.835Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test (read-only preflight)
expected: WHAT IT MEANS: makes sure the bot's startup checks still pass on this phase's code. Phase 23 changed only test files (no bot code and no dependencies), so this is a sanity check. WHAT SHOULD HAPPEN: run `/c/Users/jackc/AppData/Local/nvm/v22.16.0/node.exe node_modules/ts-node/dist/bin.js scripts/preflight.ts` (Node 22.16.0 by its full path, so no global switch). It only reads and never starts the bot. It ends "Preflight passed" with all 6 checks PASS: RPC chain ID, block age, wallet balance, Flashbots relay health, honeypot checker, anti-rug gate.
result: pass

### 2. AC-48 fake chain is real-node-shaped: harness base (23-01)
expected: WHAT IT MEANS: the new tests run the real bot code against a FAKE blockchain written for testing (test/realpath/harness/chain.ts, built in plan 23-01), so no real network and no real money is involved. Rule "AC-48" says the fake may only ever give answers a real Ethereum node could give. If it gave an impossible answer, a test could "prove" a bug that can't happen for real, or hide one that can. WHAT SHOULD BE TRUE: the fake behaves like a real node, and no test passes only because of something a real node would never do. EVIDENCE: it copies the real node software's rules for accepting transactions (wrong chain, reused sequence number, too little gas, not enough funds, replacing a pending transaction), works on real signed transactions, and refuses any request it doesn't model instead of inventing an answer. The code review found 4 small spots where it does behave unlike a real node, all still open: (1) it accepts a subscription to "new pending transactions" but never sends any; (2) the private relays (Flashbots, bloXroute) accept a transaction even if its sequence number was already used, and never mark it dropped (that makes a test crash loudly, not pass wrongly); (3) it can deliver a blockchain event after its block was already announced, and change an old receipt afterwards, while a real node delivers events together with their block; (4) it makes up older blocks whose "previous block" links don't match. Nobody has found a test that passes wrongly because of these. (3) is used by one real test (two new tokens launched in the same block are handled in order). I read it: the order it checks would very likely be the same on a real chain, but that isn't proven. MY READ: these are small and should be fixed rather than left open. Reply something like "issue: fix the 4 fake-chain realism problems" to get them fixed, or "pass" to leave them.
result: pass

### 3. AC-48 fake chain is real-node-shaped: loopback mode (23-27)
expected: WHAT IT MEANS: Same rule as test 2: the fake blockchain may only give answers a real one could give. This covers "loopback mode" from plan 23-27: some tests run the bot as a separate program that talks to the fake blockchain over a real network connection, instead of inside the same program. WHAT SHOULD BE TRUE: loopback mode adds no new kind of answer. EVIDENCE: it answers from exactly the same fake-node code as normal mode, so whatever you decide in test 2 covers it too. The review's three loopback findings are about robustness (a client that already disconnected, an error crashing the helper program, a small race when picking a free port), not about unrealistic answers. MY READ: pass. If you report test 2 as an issue, that fix covers this too.
result: pass

### 4. AC-48 fake chain and API answers are real-shaped: scenario builder (23-28)
expected: WHAT IT MEANS: Same rule as test 2: the fake blockchain may only give answers a real one could give. This covers plan 23-28, which built ready-made trading situations on top of the fake (token launches on Uniswap V2 and V3, on Ethereum and Base, sent through Flashbots or the public network). It also fakes a few outside services. WHAT SHOULD BE TRUE: no test passes on an answer a real node or service could never give. EVIDENCE: no live calls were allowed in this phase, so four fake replies were copied from the bot's own code or the services' documentation, not from real replies: (1) bloXroute on BSC returns the transaction ID without its "0x" prefix; (2) the reply format of the Mudra liquidity-lock service; (3) GoPlus (a token-safety service) reports "LP is locked" as the number 1, but GoPlus's documentation shows it as the text "1", and the bot compares against the number. If the real service sends text, the bot may never see a lock. That is already filed under bug AUD-BUY-016 for Phase 24. (4) GoPlus's reply when asked about a trading pair as if it were a token. MY READ: pass. These can't be measured without live calls, they are listed openly, and the one that matters (number vs text) is already filed for Phase 24.
result: pass

### 5. AC-48 fake answers are real-shaped: buy-path triage (23-05)
expected: WHAT IT MEANS: Same rule as test 2: the fake blockchain may only give answers a real one could give. This covers the bug-proving tests for the BUYING path (plan 23-05). To create specific situations, the tests hand-make some answers: a pool with very little liquidity, built from the scenario's own numbers at the same price; a gas estimate of 1,000,000; error messages copied word for word from the real node software. WHAT SHOULD BE TRUE: each of these is something a real node could actually return. Evidence: whoever wrote these tests recorded their reasoning in the plan summary, and the code review read every one of this plan's test files and found no impossible answer. My read: pass.
result: pass

### 6. AC-48 fake answers are real-shaped: safety-check triage (23-06)
expected: WHAT IT MEANS: Same rule as test 2: the fake blockchain may only give answers a real one could give. This covers the tests for the PRE-BUY SAFETY CHECKS (plan 23-06): liquidity-lock and pair checks. Hand-made answers: a token paired with another token instead of ETH, with its liquidity tokens burned; a liquidity lock of only 1 percent, in the lock service's own reply format; the Unicrypt lock service answering "not found" for an unknown pair. The Unicrypt and Mudra reply formats come from the bot's code, not from a live reply. WHAT SHOULD BE TRUE: each is something a real node or service could return. Evidence: whoever wrote these tests recorded their reasoning in the plan summary, and the code review read every one of this plan's test files and found no impossible answer. My read: pass.
result: pass

### 7. AC-48 fake answers are real-shaped: exit-path triage (23-07)
expected: WHAT IT MEANS: Same rule as test 2: the fake blockchain may only give answers a real one could give. This covers the tests for SELL/EXIT DECISIONS (plan 23-07). Hand-made answers: other traders' trades change the pool using the exchange's own pricing formula; token allowances and balances change only when a transaction is mined; a token with a huge supply still fits the pool's number limits. WHAT SHOULD BE TRUE: each is something a real chain could produce. Evidence: whoever wrote these tests recorded their reasoning in the plan summary, and the code review read every one of this plan's test files and found no impossible answer. My read: pass.
result: pass

### 8. AC-48 fake answers are real-shaped: dashboard sell and rug triage (23-08)
expected: WHAT IT MEANS: Same rule as test 2: the fake blockchain may only give answers a real one could give. This covers the tests for the DASHBOARD SELL BUTTON and RUG-PULL handling (plan 23-08). Hand-made answers: a refused swap uses the real node's standard "reverted" error; an incoming token transfer is a real signed transfer from a holder who actually has the tokens; a liquidity pull changes the pool by the pool contract's own math. WHAT SHOULD BE TRUE: each is something a real chain could produce. Evidence: whoever wrote these tests recorded their reasoning in the plan summary, and the code review read every one of this plan's test files and found no impossible answer. My read: pass.
result: pass

### 9. AC-48 fake answers are real-shaped: nonce-lock triage (23-09)
expected: WHAT IT MEANS: Same rule as test 2: the fake blockchain may only give answers a real one could give. This covers the tests for the WALLET LOCK, the mechanism that stops two transactions from using the same sequence number ("nonce") and colliding, and for buys happening at the same time (plan 23-09). Hand-made answers: a transaction that never gets mined looks like a normal pending transaction with no receipt yet; a second token launch is a real signed launch on SushiSwap with the event SushiSwap really emits; every swap is decoded with the real ethers library. WHAT SHOULD BE TRUE: each is something a real chain could produce. Evidence: whoever wrote these tests recorded their reasoning in the plan summary, and the code review read every one of this plan's test files and found no impossible answer. My read: pass.
result: pass

### 10. AC-48 fake answers are real-shaped: anti-rug and reconnect triage (23-10)
expected: WHAT IT MEANS: Same rule as test 2: the fake blockchain may only give answers a real one could give. This covers the tests for the ANTI-RUG MONITOR and RECONNECTING after the connection drops (plan 23-10). Hand-made answers: the RPC provider refuses a request for too many blocks of history, following the provider's documented rule; a dropped connection is closed from the server side, like a real outage; the events from a liquidity removal come in the order the real Uniswap V2 pool contract emits them. WHAT SHOULD BE TRUE: each is something a real provider or chain could produce. Evidence: whoever wrote these tests recorded their reasoning in the plan summary, and the code review read every one of this plan's test files and found no impossible answer. My read: pass.
result: pass

### 11. AC-48 fake answers are real-shaped: sell-path triage (23-11)
expected: WHAT IT MEANS: Same rule as test 2: the fake blockchain may only give answers a real one could give. This covers the tests for SELLING and FALLBACK sell routes (plan 23-11). Hand-made answers: sell receipts include the WETH-to-ETH conversion event the real router produces, with amounts from the pool's own formula; a refused fallback sell is the real node's standard "reverted" error with the router's own reason; a late buy lands in a block it actually aimed for. WHAT SHOULD BE TRUE: each is something a real chain could produce. Evidence: whoever wrote these tests recorded their reasoning in the plan summary, and the code review read every one of this plan's test files and found no impossible answer. My read: pass.
result: pass

### 12. AC-48 fake answers are real-shaped: RPC and quoter triage (23-12)
expected: WHAT IT MEANS: Same rule as test 2: the fake blockchain may only give answers a real one could give. This covers the tests for RPC PROVIDER HICCUPS and Uniswap V3 PRICE QUOTES (plan 23-12). Hand-made answers: a load-balanced provider whose back end is a moment behind says "no such block" once for a block that was just mined; the wallet's sequence number counts mined transactions; blocks arrive on the chain's own schedule; the V3 price quoter fails on a thin pool with the real node's no-reason error; a closed port refuses the connection. WHAT SHOULD BE TRUE: each is something a real provider or chain could produce. Evidence: whoever wrote these tests recorded their reasoning in the plan summary, and the code review read every one of this plan's test files and found no impossible answer. My read: pass.
result: pass

### 13. AC-48 fake answers are real-shaped: approve and held-token triage (23-13)
expected: WHAT IT MEANS: Same rule as test 2: the fake blockchain may only give answers a real one could give. This covers the tests for TOKEN APPROVALS before selling (plan 23-13). Hand-made answers: the swap check fails while the token approval is still pending; the token the bot holds came from a real mined transfer. WHAT SHOULD BE TRUE: each is something a real chain could produce. Evidence: whoever wrote these tests recorded their reasoning in the plan summary, and the code review read every one of this plan's test files and found no impossible answer. My read: pass.
result: pass

### 14. AC-16 fork-only claims flagged, not proven: AUD-BUY-015 and AUD-BUY-033 (23-05)
expected: WHAT IT MEANS: some bugs depend on how real token and exchange contracts behave on mainnet, which the fake blockchain can't fully copy. Those parts get checked in Phase 25 on a "mainnet fork", a private copy of real Ethereum with the real contracts. Rule "AC-16": such parts must be marked "not proven yet, check in Phase 25", never claimed as proven. This item covers two serious buy bugs: AUD-BUY-015 (the V3 minimum-liquidity check doesn't really enforce the minimum on thin pools) and AUD-BUY-033 (a V3 buy that only partly fills leaves the unspent ETH inside the swap router, where anyone can take it). WHAT SHOULD BE TRUE: the parts that need real contracts are flagged for Phase 25, not claimed. EVIDENCE: each has a Phase 25 check entry (UFV-07 and UFV-08 in .planning/audit/inputs/unrun-fork-verifications.json), the bug records point to them, and no fork run happened in Phase 23. MY READ: pass.
result: pass

### 15. AC-16 fork-only claims flagged, not proven: AUD-EXIT-003 (23-07)
expected: WHAT IT MEANS: same rule as test 14, for serious bug AUD-EXIT-003: the "price" the bot uses to decide when to sell isn't a real price. It quotes a fixed test amount, and the ratio between two such quotes drives every sell decision. The fake blockchain proved the main mechanism. Two parts depend on real tokens: whether quotes stop moving for large amounts, and whether quotes are too coarse on real tokens. WHAT SHOULD BE TRUE: those two parts are flagged for Phase 25, not claimed as proven. EVIDENCE: Phase 25 check UFV-09 exists and the bug record points to it; no fork run happened in Phase 23. MY READ: pass.
result: pass

### 16. AC-46 scenario tags: Flashbots V2 recordings (23-20)
expected: WHAT IT MEANS: plan 23-20 made five "recordings": complete logs of everything the bot does in five simulated Flashbots trades on Uniswap V2, one per kind of exit (anti-rug, partial sell, stop-loss, trailing stop, urgency sell). They cover messages, transactions sent, relay requests and database writes. Any later code change is compared against them, so an unintended behavior change shows up. Each recording is labelled either KEEP (correct behavior to preserve) or SUSPECT plus the list of known bugs visible in it (so when Phase 24 fixes those bugs, the recording is expected to change). Rule "AC-46": a recording that shows a known bug must never be labelled KEEP. WHAT SHOULD BE TRUE: each label lists every confirmed bug its recording shows, and none is KEEP. EVIDENCE: all five are SUSPECT; every bug they name is a confirmed bug in the bug register (I re-checked today); the plan summary lists, recording by recording, which bugs appear and which were ruled out. MY READ: pass. "Did they list every bug" is a judgment the plan's author made, and nothing I found contradicts it.
result: pass

### 17. AC-46 scenario tags: Flashbots V3 recordings (23-21)
expected: WHAT IT MEANS: same as test 16, for plan 23-21's five recordings of simulated Flashbots trades on Uniswap V3 (anti-rug, partial sell, stop-loss, trailing stop, urgency sell). WHAT SHOULD BE TRUE: each label lists every confirmed bug its recording shows, and none is KEEP. EVIDENCE: all five are SUSPECT, every bug they name is confirmed (re-checked today), and the plan summary lists the evidence and the bugs ruled out. MY READ: pass.
result: pass

### 18. AC-46 scenario tags: bloXroute, public, risk-gate and fee/gas recordings (23-22)
expected: WHAT IT MEANS: same as test 16, for plan 23-22's 12 recordings: buys and sells sent through bloXroute and through the public network, the risk limit refusing a trade, and five gas/fee situations. WHAT SHOULD BE TRUE: labels are correct and no recording that shows a bug is KEEP. EVIDENCE: the only KEEP in the whole set is the risk-limit refusal, where the bot correctly refuses and sends nothing. "public-v2-buy" is labelled with bug AUD-BUY-016 and contains only an empty result: by your earlier ruling it records that today's bot skips every Uniswap V2 launch on Base (bug AUD-BUY-016: the GoPlus lock check asks about the pair as if it were a token). Two fee recordings name fewer bugs because the bot refuses to buy there, so no position opens. Every bug named is confirmed (re-checked today). MY READ: pass.
result: pass

### 19. AC-53 every signing-census exception has an operator decision (23-17)
expected: WHAT IT MEANS: plan 23-17 added an automatic "signing census": a check that finds every place in the code that signs or sends a transaction with the bot wallet, and whether it goes through the wallet lock (the mechanism that stops two transactions from using the same sequence number and colliding). Any place that skips the lock must be on an exception list, and rule "AC-53" says each exception must point to a decision you made. WHAT SHOULD BE TRUE: every exception has a decision of yours behind it. EVIDENCE: the list (scripts/signing-census-exceptions.json) has 9 entries. 8 are separate operator scripts that sign with the bot wallet: addLiquidity.ts and deploySepoliaTest.ts (old test-network scripts) and recover-sell-ladys.ts (your recovery script). That is known bug AUD-SCRIPTS-002; your words on it were "Acknowledge. Decide in phase 29" (record ESC-SCRIPTS-01), and the open question is parked as decision card OD-68 for Phase 29. The 9th is a leftover, unused function (simulateSell in src/utils/tokenSafety.ts) that would send a real token approval outside the lock. That is bug AUD-BUY-007, and your ruling was "keep s1", meaning it stays a serious bug to fix (record ESC-CENSUS-01). MY READ: pass, if those rulings match your memory.
result: pass

### 20. Judgment-tier SPEC outcomes accepted: AC-46, 47, 48, 50, 52, 53 (23-26)
expected: WHAT IT MEANS: the phase spec has six rules that only a person can check. Plan 23-26 recorded its reading of each; passing this test means you accept those readings as final. The rules and the findings: AC-46 (no recording showing a known bug is labelled KEEP): 22 recordings, the only KEEP is the risk-limit refusal, and the other 21 name 20 different bugs, all confirmed (checked today). AC-47 (no serious bug was downgraded or closed without your ruling): the only severity change is AUD-ANTIRUG-018 going UP from S2 to S1, by your ruling, and nothing was closed as "not a bug". AC-48 (no impossible fake answers): tests 2 to 13. AC-50 (no bug fixed and no behavior changed in this phase) and AC-52 (no test-only helper is used by the real bot): the bot's code folder src/ is unchanged since the phase began (checked today). AC-53 (every census exception has your decision): test 19. Side note: the phase's verification report miscounts three things (it says 21 recordings and 20 SUSPECT, and gives public-v2-buy line counts that belong to another recording). That report is already out of date and gets regenerated at the end of this session. MY READ: pass, if you are happy with tests 2 to 19.
result: pass

### 21. PROTOCOL.md section 7 is readable by later executors (23-04)
expected: WHAT IT MEANS: plan 23-04 wrote the rulebook for recording what happened to each suspected bug: section 7 of .planning/audit/PROTOCOL.md (starting at line 199). Later phases, mostly run by AI agents, follow it. WHAT SHOULD BE TRUE: it is clear and complete enough to follow. It covers which check to run, the frozen list of 61 suspected bugs, the one tool allowed to write outcomes, where the proof tests must live, what each outcome needs (confirmed, not a bug, already fixed, couldn't reproduce, needs a mainnet-fork check), and how your rulings are recorded. MY READ: it is dense but precise and complete, written more for agents than for people. Open it if you want to judge readability yourself; otherwise pass.
result: pass

### 22. Harness Gap Procedure and ownership rule are clear (23-27)
expected: WHAT IT MEANS: plan 23-27 wrote a rule for the rest of the phase. If a bug-proving test needed something the fake blockchain couldn't do yet, the plan writing it had to follow a written procedure ("Harness Gap Procedure" in 23-27-PLAN.md): pause, hand the change to the one named owner, land it as a separate commit while nothing else runs, re-run every test, and bring any changed result to you. Patching the fake blockchain on the side was not allowed. Only plans 23-01, 23-28, 23-02 and 23-27 may change the fake-blockchain folder (23-20 may add only its recording formatter). WHAT SHOULD BE TRUE: the procedure is clear and was followable. EVIDENCE: plan summaries such as 23-09 record "no gap was raised". MY READ: pass. It is a process document with nothing to run.
result: pass

### 23. AUD-TX-006 relay response on record, kept open as unreproduced (23-15)
expected: WHAT IT MEANS: suspected bug AUD-TX-006 (low severity): on every Flashbots attempt the bot asks the Flashbots relay for per-builder statistics, and its error advice relies on that answer. The question was whether the relay still answers that request at all. You approved exactly one real request, signed by a throwaway wallet with no funds. WHAT SHOULD BE TRUE: the raw reply is on file, and the bug is recorded as "couldn't reproduce either way" and kept open by your ruling. EVIDENCE: the reply is in .planning/audit/inputs/aud-tx-006-relay-response.json and the relay answered 403 (refused). That doesn't settle it, because the relay may answer the bot's real signing key differently from a throwaway one. Your keep-open ruling is in review record TRIAGE-REVIEW-01, and the follow-up check with the real signer is planned for Phase 29 (card TX-03). MY READ: pass.
result: pass

### 24. Interim-rule change and AUD-ANTIRUG-018 answer recorded correctly (23-16)
expected: WHAT IT MEANS: during plan 23-16 you made two decisions; this checks they were written down correctly (review record TRIAGE-REVIEW-01 and .planning/STATE.md). (1) Temporary safety rule. The old rule was "after a manual buy, restart the bot right away", because of bug AUD-BUY-001: a manual buy has no exit or anti-rug protection until the bot restarts. Then bug AUD-ANTIRUG-025 turned up: every restart with an open position silently drops anti-rug monitoring, so a restart brings back only the exit monitor. You chose "option 1": no deliberate manual buys at all until Phase 24 fixes both bugs. (2) Bug AUD-ANTIRUG-018: the backup anti-rug checker, used only when a chain has no WebSocket connection, breaks after a few minutes of downtime. Your command output showed only Ethereum is enabled and it has a WebSocket URL, so on your setup that backup never runs and the bug can't happen today. It must be fixed, together with the similar bug AUD-BUY-036, before you enable any chain without a WebSocket URL. WHAT SHOULD BE TRUE: both match what you decided. MY READ: pass, if this matches your memory.
result: pass

### 25. CI runs the census and floor history with full git history (23-17)
expected: WHAT IT MEANS: plan 23-17 added the signing census (test 19) to the automatic checks GitHub runs on every push ("CI"). It needs the full git history to work. WHAT SHOULD BE TRUE: on GitHub the job downloads the full history and both census commands pass on Linux. EVIDENCE: the workflow file .github/workflows/test.yml has the full-history setting and both commands. But this branch has never been pushed, so it has never actually run on GitHub, and only the first real run can confirm it. Your rule is to push only once, at ship time, which comes after this phase is marked complete. If you mark this "blocked", the phase can't be marked complete, and you won't push until it is, so it would never clear. MY READ: reply "skip: confirmed by the first CI run when the branch is pushed at ship". A skip with a reason doesn't hold up the phase, and the ship step's CI run is where it gets checked.
result: skipped
reason: "Cannot be confirmed before the branch has its first GitHub CI run (never pushed). Operator replied \"skip\" to the recommendation to confirm it at the ship-time CI run."

### 26. realpath Vitest project with the ethers CJS alias; seams proven attached (alias, getUrl hook, nested ws swap) (23-01 D1)
expected: realpath Vitest project with the ethers CJS alias; seams proven attached (alias, getUrl hook, nested ws swap)
result: pass
source: automated
coverage_id: 23-01-D1

### 27. AC-01: one V2 Flashbots buy end to end through the real listener, real ethers signing, the fake node and the real-migration DB; decoded swap call and pending trades row asserted (23-01 D2)
expected: AC-01: one V2 Flashbots buy end to end through the real listener, real ethers signing, the fake node and the real-migration DB; decoded swap call and pending trades row asserted
result: pass
source: automated
coverage_id: 23-01-D2

### 28. AC-03: unknown method, read and URL fail by name; unfired fault or hold fails; callLog keeps params/data/block tag; hold parks eth_sendBundle until release; failed createScenario leaves nothing behind; expectStillPending both ways (23-01 D3)
expected: AC-03: unknown method, read and URL fail by name; unfired fault or hold fails; callLog keeps params/data/block tag; hold parks eth_sendBundle until release; failed createScenario leaves nothing behind; expectStillPending both ways
result: pass
source: automated
coverage_id: 23-01-D3

### 29. Register: AUD-ANTIRUG-024 (S3) and AUD-ANTIRUG-018 S1 with escalation records; register checks unchanged from baseline (23-01 D5)
expected: Register: AUD-ANTIRUG-024 (S3) and AUD-ANTIRUG-018 S1 with escalation records; register checks unchanged from baseline
result: pass
source: automated
coverage_id: 23-01-D5

### 30. Ordered timeline on the real AC-01 buy: the trades insert sits after the submit and after every relay body, by position in timeline.entries (D-13, CAP-14 order) (23-02 D1)
expected: Ordered timeline on the real AC-01 buy: the trades insert sits after the submit and after every relay body, by position in timeline.entries (D-13, CAP-14 order)
result: pass
source: automated
coverage_id: 23-02-D1

### 31. Each entry carries the fake clock at the moment recorded; the submit entry's at equals the clock read while the bundle was held (23-02 D2)
expected: Each entry carries the fake clock at the moment recorded; the submit entry's at equals the clock read while the bundle was held
result: pass
source: automated
coverage_id: 23-02-D2

### 32. DB capture (D-14, D-05): DEFAULT (unixepoch()) is the fake second, also through a statement prepared before the install; REAL exact and integers above 2^53 whole; a second loadGraph is still captured (23-02 D3)
expected: DB capture (D-14, D-05): DEFAULT (unixepoch()) is the fake second, also through a statement prepared before the install; REAL exact and integers above 2^53 whole; a second loadGraph is still captured
result: pass
source: automated
coverage_id: 23-02-D3

### 33. Open Question 5: an autocommit insert records no violation; a write inside db.transaction under a catch-all still fails assertNoViolations naming the table (23-02 D4)
expected: Open Question 5: an autocommit insert records no violation; a write inside db.transaction under a catch-all still fails assertNoViolations naming the table
result: pass
source: automated
coverage_id: 23-02-D4

### 34. Plain logs and alerts: a log with no op is on recordedLogs and not on the timeline; the real buy's exact New Token Detected text is on recordedAlerts (via ctx, chain eth) and no alert text is on the timeline; a new scenario starts empty (23-02 D5)
expected: Plain logs and alerts: a log with no op is on recordedLogs and not on the timeline; the real buy's exact New Token Detected text is on recordedAlerts (via ctx, chain eth) and no alert text is on the timeline; a new scenario starts empty
result: pass
source: automated
coverage_id: 23-02-D5

### 35. knownBug (D-07, D-08): exact recorded failure passes and records on task meta (BigInt as text, reaches the JSON reporter); looks-fixed and failure-changed throw their exact messages; two claims give two entries; malformed markers refused; nothing else caught (23-02 D6)
expected: knownBug (D-07, D-08): exact recorded failure passes and records on task meta (BigInt as text, reaches the JSON reporter); looks-fixed and failure-changed throw their exact messages; two claims give two entries; malformed markers refused; nothing else caught
result: pass
source: automated
coverage_id: 23-02-D6

### 36. AC-02 gate: --self-test 22/22 (incl. the refused vi.mock of src/utils/db), the real test/realpath folder clean, an in-repo forbidden mock exits 1, wired into npm test, npm scripts and CI (23-02 D7)
expected: AC-02 gate: --self-test 22/22 (incl. the refused vi.mock of src/utils/db), the real test/realpath folder clean, an in-repo forbidden mock exits 1, wired into npm test, npm scripts and CI
result: pass
source: automated
coverage_id: 23-02-D7

### 37. AC-04: the real migrations take an empty version 0 database to version 7 and match the recorded schema (23-03 D1)
expected: AC-04: the real migrations take an empty version 0 database to version 7 and match the recorded schema
result: pass
source: automated
coverage_id: 23-03-D1

### 38. AC-05: the frozen version 4 fixture upgrades to version 7, matches the recording, keeps its seeded trades and exit_state rows, and the version 7 columns hold their defaults (23-03 D2)
expected: AC-05: the frozen version 4 fixture upgrades to version 7, matches the recording, keeps its seeded trades and exit_state rows, and the version 7 columns hold their defaults
result: pass
source: automated
coverage_id: 23-03-D2

### 39. AC-06: a second migration run on a version 7 database (both starting points) leaves schema and rows unchanged, including a paused kill switch and a failed-held exit (23-03 D3)
expected: AC-06: a second migration run on a version 7 database (both starting points) leaves schema and rows unchanged, including a paused kill switch and a failed-held exit
result: pass
source: automated
coverage_id: 23-03-D3

### 40. AC-07: createTestDb is built by migrateSchema, returns CURRENT_SCHEMA_VERSION, and test/helpers/testDb.ts holds no hand-written schema; RED proven first (23-03 D4)
expected: AC-07: createTestDb is built by migrateSchema, returns CURRENT_SCHEMA_VERSION, and test/helpers/testDb.ts holds no hand-written schema; RED proven first
result: pass
source: automated
coverage_id: 23-03-D4

### 41. AC-49: no test deleted, skipped or weakened; unit 937 -> 937 passing; only the two named assertions changed; test-identity missing 0, renamed 1 (23-03 D5)
expected: AC-49: no test deleted, skipped or weakened; unit 937 -> 937 passing; only the two named assertions changed; test-identity missing 0, renamed 1
result: pass
source: automated
coverage_id: 23-03-D5

### 42. --stage triage gates the D-21 rules and never runs consolidation or the HEAD universe check (23-04 D1)
expected: --stage triage gates the D-21 rules and never runs consolidation or the HEAD universe check
result: pass
source: automated
coverage_id: 23-04-D1

### 43. Frozen 61-ID population joined with the live computation; a downgraded or deleted frozen ID is still required (23-04 D2)
expected: Frozen 61-ID population joined with the live computation; a downgraded or deleted frozen ID is still required
result: pass
source: automated
coverage_id: 23-04-D2

### 44. knownBug evidence zone and location guard (eleven location cases plus evidence-from-outside-the-zone) (23-04 D3)
expected: knownBug evidence zone and location guard (eleven location cases plus evidence-from-outside-the-zone)
result: pass
source: automated
coverage_id: 23-04-D3

### 45. Per-outcome D-21 rules (AC-08, AC-11, AC-13, AC-16, AC-17, AC-18) and claim-level proof, each with a self-test case (23-04 D4)
expected: Per-outcome D-21 rules (AC-08, AC-11, AC-13, AC-16, AC-17, AC-18) and claim-level proof, each with a self-test case
result: pass
source: automated
coverage_id: 23-04-D4

### 46. set-triage.ts writer (status mapping, verified kept, merge, byte-stable, refusals) (23-04 D5)
expected: set-triage.ts writer (status mapping, verified kept, merge, byte-stable, refusals)
result: pass
source: automated
coverage_id: 23-04-D5

### 47. AUD-BUY-002: balanceOf error after a mined buy flips the row to failed, no monitor, TX failed alert, not resumed after restart; earlier same-nonce attempt lands with no row; fanout refusal after the first send lands with no row (23-05 D1)
expected: AUD-BUY-002: balanceOf error after a mined buy flips the row to failed, no monitor, TX failed alert, not resumed after restart; earlier same-nonce attempt lands with no row; fanout refusal after the first send lands with no row
result: pass
source: automated
coverage_id: 23-05-D1

### 48. AUD-BUY-003: a failed snipe-size quote sends the swap with amountOutMin 0 on V2 and V3, decoded with real Transaction.from (23-05 D2)
expected: AUD-BUY-003: a failed snipe-size quote sends the swap with amountOutMin 0 on V2 and V3, decoded with real Transaction.from
result: pass
source: automated
coverage_id: 23-05-D2

### 49. AUD-TX-007: the doubled base fee decides the entry gate and the Flashbots strategy reserve in the real computation (23-05 D3)
expected: AUD-TX-007: the doubled base fee decides the entry gate and the Flashbots strategy reserve in the real computation
result: pass
source: automated
coverage_id: 23-05-D3

### 50. AUD-BUY-030: the late private landing during the public leg's held nonce read gives two buys at nonces N and N + 1 (23-05 D4)
expected: AUD-BUY-030: the late private landing during the public leg's held nonce read gives two buys at nonces N and N + 1
result: pass
source: automated
coverage_id: 23-05-D4

### 51. AUD-BUY-033 calldata half and AUD-BUY-015 gate half, each with needs_fork and a fork question for the contract half (23-05 D5)
expected: AUD-BUY-033 calldata half and AUD-BUY-015 gate half, each with needs_fork and a fork question for the contract half
result: pass
source: automated
coverage_id: 23-05-D5

### 52. AUD-BUY-001 (S0): the real scripts/deliberate-buy.ts lands a buy and arms both protections in its own process, exits 0, and the running bot on the same database has neither after ten exit-poll intervals; only a restart re-arms it; controls show both registries can read true (23-06 D1)
expected: AUD-BUY-001 (S0): the real scripts/deliberate-buy.ts lands a buy and arms both protections in its own process, exits 0, and the running bot on the same database has neither after ten exit-poll intervals; only a restart re-arms it; controls show both registries can read true
result: pass
source: automated
coverage_id: 23-06-D1

### 53. AUD-BUY-006: with both allowlists empty, and with only the sender list set, a stranger's Telegram message routes into the buy pipeline and a buy is sent; both lists set rejects it (23-06 D2)
expected: AUD-BUY-006: with both allowlists empty, and with only the sender list set, a stranger's Telegram message routes into the buy pipeline and a buy is sent; both lists set rejects it
result: pass
source: automated
coverage_id: 23-06-D2

### 54. AUD-BUY-009: V2 and V3 New-Token alerts print a bare Honeypot No from a constant while the on-chain roundtrip ran (23-06 D3)
expected: AUD-BUY-009: V2 and V3 New-Token alerts print a bare Honeypot No from a constant while the on-chain roundtrip ran
result: pass
source: automated
coverage_id: 23-06-D3

### 55. AUD-BUY-011: after the real dashboard stop route the HTTP poller still buys, and a Telegram alpha drop still routes to the stopped chain and buys (23-06 D4)
expected: AUD-BUY-011: after the real dashboard stop route the HTTP poller still buys, and a Telegram alpha drop still routes to the stopped chain and buys
result: pass
source: automated
coverage_id: 23-06-D4

### 56. AUD-BUY-027 (A/B pair processed, B reserve read as ETH, bought through WETH) and AUD-BUY-028 (a 1 percent lock passes on Unicrypt and Mudra) (23-06 D5)
expected: AUD-BUY-027 (A/B pair processed, B reserve read as ETH, bought through WETH) and AUD-BUY-028 (a 1 percent lock passes on Unicrypt and Mudra)
result: pass
source: automated
coverage_id: 23-06-D5

### 57. AUD-ANTIRUG-025 (new S1): after restart and resume, no subscription covers the pair and an LP transfer on it is never evaluated (23-06 D6)
expected: AUD-ANTIRUG-025 (new S1): after restart and resume, no subscription covers the pair and an LP transfer on it is never evaluated
result: pass
source: automated
coverage_id: 23-06-D6

### 58. AUD-EXIT-002: one failed getAmountsOut at exit-monitor start (fault on the router, armed after the buy mined, fired once) leaves the held position with no monitor timer, no exit_state row and no alert over six poll intervals (23-07 D1)
expected: AUD-EXIT-002: one failed getAmountsOut at exit-monitor start (fault on the router, armed after the buy mined, fired once) leaves the held position with no monitor timer, no exit_state row and no alert over six poll intervals
result: pass
source: automated
coverage_id: 23-07-D1

### 59. AUD-EXIT-013: after restartGraph a sushiswap-v2 position is quoted only through the uniswap-v2 router and anti-rug re-registers it on uniswap-v2 (23-07 D2)
expected: AUD-EXIT-013: after restartGraph a sushiswap-v2 position is quoted only through the uniswap-v2 router and anti-rug re-registers it on uniswap-v2
result: pass
source: automated
coverage_id: 23-07-D2

### 60. AUD-EXIT-015: on a temp-file database, with the stored exit_state row and exit.monitor.resumed asserted first, the resumed monitor probes the new snipe amount and the stop-loss fires with no price change (23-07 D3)
expected: AUD-EXIT-015: on a temp-file database, with the stored exit_state row and exit.monitor.resumed asserted first, the resumed monitor probes the new snipe amount and the stop-loss fires with no price change
result: pass
source: automated
coverage_id: 23-07-D3

### 61. AUD-EXIT-003: raw ETH-wei probe on a 9-decimal token; a 0 first quote kept as the entry (Infinity sells both partial tiers at a 1 percent rise, NaN fires the stop-loss); null quotes suppress the 30-minute urgency exit (23-07 D4)
expected: AUD-EXIT-003: raw ETH-wei probe on a 9-decimal token; a 0 first quote kept as the entry (Infinity sells both partial tiers at a 1 percent rise, NaN fires the stop-loss); null quotes suppress the 30-minute urgency exit
result: pass
source: automated
coverage_id: 23-07-D4

### 62. AUD-EXIT-001: V2 and V3, full and partial private sells decode with a zero output floor from node.submitted and from the relay body (23-07 D5)
expected: AUD-EXIT-001: V2 and V3, full and partial private sells decode with a zero output floor from node.submitted and from the relay body
result: pass
source: automated
coverage_id: 23-07-D5

### 63. AUD-EXIT-004: a public exact-amount approve at ethers' default fees (above the sell ceiling) precedes each private sell, and the second exit needs another (23-07 D6)
expected: AUD-EXIT-004: a public exact-amount approve at ethers' default fees (above the sell ceiling) precedes each private sell, and the second exit needs another
result: pass
source: automated
coverage_id: 23-07-D6

### 64. AUD-API-001: after a real dashboard force-sell drives the position through the catch path (private attempts miss, the public fallback swap refused at gas estimation, tokens still held), force-sell answers 404 and emergency-sell answers 'No open positions to sell', and neither sends a sell (23-08 D1)
expected: AUD-API-001: after a real dashboard force-sell drives the position through the catch path (private attempts miss, the public fallback swap refused at gas estimation, tokens still held), force-sell answers 404 and emergency-sell answers 'No open positions to sell', and neither sends a sell
result: pass
source: automated
coverage_id: 23-08-D1

### 65. AUD-EXIT-008: on a row that stays pending with routine retries paused (EXIT_ROUTINE_MAX_FAILURES=1), the dashboard force-sell answers 409, logs exit.routine.paused-skip and sends no sell (23-08 D2)
expected: AUD-EXIT-008: on a row that stays pending with routine retries paused (EXIT_ROUTINE_MAX_FAILURES=1), the dashboard force-sell answers 409, logs exit.routine.paused-skip and sends no sell
result: pass
source: automated
coverage_id: 23-08-D2

### 66. AUD-EXIT-007: the V3 no-fallback and unknown-dex returns leave a held position with no poll timer after the dashboard cleared it (23-08 D3)
expected: AUD-EXIT-007: the V3 no-fallback and unknown-dex returns leave a held position with no poll timer after the dashboard cleared it
result: pass
source: automated
coverage_id: 23-08-D3

### 67. AUD-EXIT-005 (AC-12): with one exit quote held, the next tick starts a second poll cycle of the same position; both write the one shared exit_state (23-08 D4)
expected: AUD-EXIT-005 (AC-12): with one exit quote held, the next tick starts a second poll cycle of the same position; both write the one shared exit_state
result: pass
source: automated
coverage_id: 23-08-D4

### 68. AUD-EXIT-014 (AC-12): a rug detected while a routine stop-loss exit holds the sell lock gets an anti-rug exit that returns false at once (23-08 D5)
expected: AUD-EXIT-014 (AC-12): a rug detected while a routine stop-loss exit holds the sell lock gets an anti-rug exit that returns false at once
result: pass
source: automated
coverage_id: 23-08-D5

### 69. AUD-TX-028 (new): while one HTTP call of the provider is unanswered, the anti-rug evaluation of a real liquidity pull gets its reads answered and still cannot finish (23-08 D6)
expected: AUD-TX-028 (new): while one HTTP call of the provider is unanswered, the anti-rug evaluation of a real liquidity pull gets its reads answered and still cannot finish
result: pass
source: automated
coverage_id: 23-08-D6

### 70. AUD-TX-002 (passthrough wait(3)), AUD-BUY-025 (deliberate public wait()) and AUD-EXIT-009 (exit ensureApproval wait()): a transaction that is never mined keeps the real wallet lock, and a later operation for the wallet does not start within a 30-minute fake-time window of 150 blocks; each site has a mined-with-three-confirmations control in which the operation starts (23-09 D1)
expected: AUD-TX-002 (passthrough wait(3)), AUD-BUY-025 (deliberate public wait()) and AUD-EXIT-009 (exit ensureApproval wait()): a transaction that is never mined keeps the real wallet lock, and a later operation for the wallet does not start within a 30-minute fake-time window of 150 blocks; each site has a mined-with-three-confirmations control in which the operation starts
result: pass
source: automated
coverage_id: 23-09-D1

### 71. AUD-TX-001: a same-wallet acquire nested inside a withNonceLock op never settles and a third op for the wallet never starts within a 30-minute fake-time window, with nothing logged; nesting across two wallets completes (23-09 D2)
expected: AUD-TX-001: a same-wallet acquire nested inside a withNonceLock op never settles and a third op for the wallet never starts within a 30-minute fake-time window, with nothing logged; nesting across two wallets completes
result: pass
source: automated
coverage_id: 23-09-D2

### 72. AUD-TX-003 (AC-12): while a snipe of token B escalates privately, the anti-rug exit of held position A cannot send anything; bounded-abort lands exactly 60000 fake ms after the dispatch on the timeline, and A's abandoned exit sends only after B fails clean (23-09 D3)
expected: AUD-TX-003 (AC-12): while a snipe of token B escalates privately, the anti-rug exit of held position A cannot send anything; bounded-abort lands exactly 60000 fake ms after the dispatch on the timeline, and A's abandoned exit sends only after B fails clean
result: pass
source: automated
coverage_id: 23-09-D3

### 73. AUD-BUY-004 (AC-12): two real handlers for one PairCreated both pass the already-sniped check and both buys land: two decoded swaps of the same token, two trades rows (23-09 D4)
expected: AUD-BUY-004 (AC-12): two real handlers for one PairCreated both pass the already-sniped check and both buys land: two decoded swaps of the same token, two trades rows
result: pass
source: automated
coverage_id: 23-09-D4

### 74. AUD-BUY-010 (AC-12): with MAX_OPEN_POSITIONS=1, handlers for two different tokens both pass canSnipe and both buys land: two decoded swaps, two open rows against a limit of one (23-09 D5)
expected: AUD-BUY-010 (AC-12): with MAX_OPEN_POSITIONS=1, handlers for two different tokens both pass canSnipe and both buys land: two decoded swaps, two open rows against a limit of one
result: pass
source: automated
coverage_id: 23-09-D5

### 75. AUD-TX-029 (new): a snipe whose four private attempts all miss at 1 to 4 gwei is reported as having reached the 25 gwei priority-fee ceiling (23-09 D6)
expected: AUD-TX-029 (new): a snipe whose four private attempts all miss at 1 to 4 gwei is reported as having reached the 25 gwei priority-fee ceiling
result: pass
source: automated
coverage_id: 23-09-D6

### 76. AUD-API-002: after the real dashboard Stop route the node holds no anti-rug subscription for the pair, a 95 percent liquidity pull is never evaluated and the dashboard is still told connected; after Stop and Start the factory listeners return but anti-rug does not (23-10 D1)
expected: AUD-API-002: after the real dashboard Stop route the node holds no anti-rug subscription for the pair, a 95 percent liquidity pull is never evaluated and the dashboard is still told connected; after Stop and Start the factory listeners return but anti-rug does not
result: pass
source: automated
coverage_id: 23-10-D1

### 77. AUD-ANTIRUG-001 (AC-12): after one server-side socket drop the rug-log subscription sits off ctx.wsProvider, the next buy duplicates it so one LP log is evaluated twice, and the three replaced providers stay open (23-10 D2)
expected: AUD-ANTIRUG-001 (AC-12): after one server-side socket drop the rug-log subscription sits off ctx.wsProvider, the next buy duplicates it so one LP log is evaluated twice, and the three replaced providers stay open
result: pass
source: automated
coverage_id: 23-10-D2

### 78. AUD-BUY-008 (AC-12): after a dashboard Stop and Start one socket close runs two reconnect loops per DEX; the control without a restart reconnects each DEX once (23-10 D3)
expected: AUD-BUY-008 (AC-12): after a dashboard Stop and Start one socket close runs two reconnect loops per DEX; the control without a restart reconnects each DEX once
result: pass
source: automated
coverage_id: 23-10-D3

### 79. AUD-ANTIRUG-003 (AC-12): one real removal, the first exit held at its relay simulation, counts three triggers and trips the chain breaker; the real-removal log count is needs_fork (23-10 D4)
expected: AUD-ANTIRUG-003 (AC-12): one real removal, the first exit held at its relay simulation, counts three triggers and trips the chain breaker; the real-removal log count is needs_fork
result: pass
source: automated
coverage_id: 23-10-D4

### 80. AUD-ANTIRUG-004: an anti-rug escape whose approval the node refuses is never dispatched again within 2 minutes of fake time (23-10 D5)
expected: AUD-ANTIRUG-004: an anti-rug escape whose approval the node refuses is never dispatched again within 2 minutes of fake time
result: pass
source: automated
coverage_id: 23-10-D5

### 81. AUD-ANTIRUG-005: the reconnect backfill reaches triggerAntiRugExit and submits an anti-rug sell; a live dispatch leaves last_seen_block behind in the real DB (23-10 D6)
expected: AUD-ANTIRUG-005: the reconnect backfill reaches triggerAntiRugExit and submits an anti-rug sell; a live dispatch leaves last_seen_block behind in the real DB
result: pass
source: automated
coverage_id: 23-10-D6

### 82. AUD-ANTIRUG-024 and AUD-ANTIRUG-018 (orchestrator scope addition): the false GAP DETECTED of a fresh database's first start, and the HTTP anti-rug poller refused on every poll after an ordinary restart against a 10-block provider limit (23-10 D7)
expected: AUD-ANTIRUG-024 and AUD-ANTIRUG-018 (orchestrator scope addition): the false GAP DETECTED of a fresh database's first start, and the HTTP anti-rug poller refused on every poll after an ordinary restart against a 10-block provider limit
result: pass
source: automated
coverage_id: 23-10-D7

### 83. AUD-BUY-036 (new): after an RPC outage longer than the provider range limit the HTTP DEX poller is refused every poll and never finds a new pair (23-10 D8)
expected: AUD-BUY-036 (new): after an RPC outage longer than the provider range limit the HTTP DEX poller is refused every poll and never finds a new pair
result: pass
source: automated
coverage_id: 23-10-D8

### 84. AUD-DB-002: rows from the real insert sites (decimal buy amount_in, wei sell and partial-sell amount_out and gas from the real receipt decoder); after a real stop-loss loss above the daily limit the loss is not counted and canSnipe allows the next snipe; after one real partial sell exposure is hugely negative and the exposure cap allows a snipe it should refuse (23-11 D1)
expected: AUD-DB-002: rows from the real insert sites (decimal buy amount_in, wei sell and partial-sell amount_out and gas from the real receipt decoder); after a real stop-loss loss above the daily limit the loss is not counted and canSnipe allows the next snipe; after one real partial sell exposure is hugely negative and the exposure cap allows a snipe it should refuse
result: pass
source: automated
coverage_id: 23-11-D1

### 85. AUD-DB-001: for each of the five risk variables, a state that trips only that rule is refused under a valid limit and allowed under abc after a whole-graph reload on the same database (23-11 D2)
expected: AUD-DB-001: for each of the five risk variables, a state that trips only that rule is refused under a valid limit and allowed under abc after a whole-graph reload on the same database
result: pass
source: automated
coverage_id: 23-11-D2

### 86. AUD-DB-003: a real still-held failed-exit position drops out of the open-position limit and the exposure cap (23-11 D3)
expected: AUD-DB-003: a real still-held failed-exit position drops out of the open-position limit and the exposure cap
result: pass
source: automated
coverage_id: 23-11-D3

### 87. AUD-DB-004 with AUD-DB-021: a buy that lands two blocks late has no database record at its first submit or when mined (timeline positions); the bot's connection runs WAL at synchronous NORMAL (23-11 D4)
expected: AUD-DB-004 with AUD-DB-021: a buy that lands two blocks late has no database record at its first submit or when mined (timeline positions); the bot's connection runs WAL at synchronous NORMAL
result: pass
source: automated
coverage_id: 23-11-D4

### 88. AUD-DB-007 re-measured outside Vitest from another working folder: the anchored database opens, a missing one is refused and nothing is created, unset and shipped DB_PATH resolve to the repo root; fails with either half of the rail removed (23-11 D5)
expected: AUD-DB-007 re-measured outside Vitest from another working folder: the anchored database opens, a missing one is refused and nothing is created, unset and shipped DB_PATH resolve to the repo root; fails with either half of the rail removed
result: pass
source: automated
coverage_id: 23-11-D5

### 89. AUD-ANTIRUG-002: a refused WebSocket connect ends the process (exit 1, Error: connect ECONNREFUSED) at all four named sites: the anti-rug reconnect, the V3 and V2 DEX reconnects and the boot connect; healthy controls reconnect; the contained case survives with anti-rug never reconnecting (23-12 D1)
expected: AUD-ANTIRUG-002: a refused WebSocket connect ends the process (exit 1, Error: connect ECONNREFUSED) at all four named sites: the anti-rug reconnect, the V3 and V2 DEX reconnects and the boot connect; healthy controls reconnect; the contained case survives with anti-rug never reconnecting
result: pass
source: automated
coverage_id: 23-12-D1

### 90. AUD-TX-009: one null answer for the target block during the real FlashbotsMevStrategy's bundle.wait() ends the process (exit 1, Error: Unable to get block: 101); healthy returns the broadcast hash; contained recovers on block 102 (23-12 D2)
expected: AUD-TX-009: one null answer for the target block during the real FlashbotsMevStrategy's bundle.wait() ends the process (exit 1, Error: Unable to get block: 101); healthy returns the broadcast hash; contained recovers on block 102
result: pass
source: automated
coverage_id: 23-12-D2

### 91. AUD-BUY-005: a bad ETH_MIN_LIQUIDITY rejects the un-awaited V3 handler on the first pool pushed to the real listener and the process exits (TypeError: invalid FixedNumber string value); healthy skips both pools below the minimum; contained keeps dispatching (23-12 D3)
expected: AUD-BUY-005: a bad ETH_MIN_LIQUIDITY rejects the un-awaited V3 handler on the first pool pushed to the real listener and the process exits (TypeError: invalid FixedNumber string value); healthy skips both pools below the minimum; contained keeps dispatching
result: pass
source: automated
coverage_id: 23-12-D3

### 92. AUD-API-008: one unauthenticated GET /ws with Upgrade: websocket and Host 'a b' to the real startApiServer ends the process (TypeError: Invalid URL at handler.ts:43); a valid Host is answered 401; contained survives but the request is never answered or closed (23-12 D4)
expected: AUD-API-008: one unauthenticated GET /ws with Upgrade: websocket and Host 'a b' to the real startApiServer ends the process (TypeError: Invalid URL at handler.ts:43); a valid Host is answered 401; contained survives but the request is never answered or closed
result: pass
source: automated
coverage_id: 23-12-D4

### 93. AC-14: importing src/utils/db.ts (railed child, VITEST unset, temp DB_PATH, throwaway cwd) on an up-to-date WAL database commits one write; the pragmas-only control commits nothing (23-13 D1)
expected: AC-14: importing src/utils/db.ts (railed child, VITEST unset, temp DB_PATH, throwaway cwd) on an up-to-date WAL database commits one write; the pragmas-only control commits nothing
result: pass
source: automated
coverage_id: 23-13-D1

### 94. AUD-SCRIPTS-001: addLiquidity and deploySepoliaTest have relative imports the compiler cannot resolve (compiled artifacts with no source), so neither can load (23-13 D2)
expected: AUD-SCRIPTS-001: addLiquidity and deploySepoliaTest have relative imports the compiler cannot resolve (compiled artifacts with no source), so neither can load
result: pass
source: automated
coverage_id: 23-13-D2

### 95. AUD-SCRIPTS-002: every signing script (deliberate-buy, recover-sell-ladys, and the two legacy ones) is lock none with no pause read; the classifier is proven on 14 temp-directory cases (23-13 D3)
expected: AUD-SCRIPTS-002: every signing script (deliberate-buy, recover-sell-ladys, and the two legacy ones) is lock none with no pause read; the classifier is proven on 14 temp-directory cases
result: pass
source: automated
coverage_id: 23-13-D3

### 96. AUD-BUY-007: the real simulateSell signs one public approve of the whole held balance while the wallet's withNonceLock is held (23-13 D4)
expected: AUD-BUY-007: the real simulateSell signs one public approve of the whole held balance while the wallet's withNonceLock is held
result: pass
source: automated
coverage_id: 23-13-D4

### 97. AUD-DB-005: with VITEST unset and LOG_LEVEL=debug loaded from .env, the logger runs at info (23-13 D5)
expected: AUD-DB-005: with VITEST unset and LOG_LEVEL=debug loaded from .env, the logger runs at info
result: pass
source: automated
coverage_id: 23-13-D5

### 98. AUD-TX-004 closed fixed: the duplicate-load guard refuses a require.cache reload of nonceAuthority (RED row 22, re-run as 23-14-1) (23-14 D1)
expected: AUD-TX-004 closed fixed: the duplicate-load guard refuses a require.cache reload of nonceAuthority (RED row 22, re-run as 23-14-1)
result: pass
source: automated
coverage_id: 23-14-D1

### 99. AUD-TX-005 closed fixed: a second acquire for the same wallet is refused while a real holder process lives (RED row 25, re-run as 23-14-2) (23-14 D2)
expected: AUD-TX-005 closed fixed: a second acquire for the same wallet is refused while a real holder process lives (RED row 25, re-run as 23-14-2)
result: pass
source: automated
coverage_id: 23-14-D2

### 100. AUD-RAIL-001 closed fixed (status confirmed -> fixed): the event's own cause, a dotenv call in vitest.config.ts, fails forkShellOnly (d) (new RED proof 23-14-3) (23-14 D3)
expected: AUD-RAIL-001 closed fixed (status confirmed -> fixed): the event's own cause, a dotenv call in vitest.config.ts, fails forkShellOnly (d) (new RED proof 23-14-3)
result: pass
source: automated
coverage_id: 23-14-D3

### 101. AUD-RAIL-002 closed fixed (candidate -> fixed): live-DB open at import refused by the src and setup tripwires, real .env reach refused by the sentinel env (RED rows 10 and 1, re-run as 23-14-5 and 23-14-4) (23-14 D4)
expected: AUD-RAIL-002 closed fixed (candidate -> fixed): live-DB open at import refused by the src and setup tripwires, real .env reach refused by the sentinel env (RED rows 10 and 1, re-run as 23-14-5 and 23-14-4)
result: pass
source: automated
coverage_id: 23-14-D4

### 102. AUD-TESTU-001 closed fixed (candidate -> fixed): every listed unit file's reach (live DB, real .env, Telegram) is refused by a RED-proven rail (23-14 D5)
expected: AUD-TESTU-001 closed fixed (candidate -> fixed): every listed unit file's reach (live DB, real .env, Telegram) is refused by a RED-proven rail
result: pass
source: automated
coverage_id: 23-14-D5

### 103. AUD-TESTI-011 closed fixed (candidate -> fixed) for unit and integration; its fork-replay and Hardhat-child half keeps needs_fork with fork_ref UFV-04 (Phase 25) (23-14 D6)
expected: AUD-TESTI-011 closed fixed (candidate -> fixed) for unit and integration; its fork-replay and Hardhat-child half keeps needs_fork with fork_ref UFV-04 (Phase 25)
result: pass
source: automated
coverage_id: 23-14-D6

### 104. AUD-TESTI-001 closed fixed (confirmed -> fixed): helper built by the real migrations (23-03), pauseFlow Tests 1-4 on the real pause statements and real migrations, v7 exit_state fixture pinned to the migrated table (operator ruling Fix now) (23-14 D7)
expected: AUD-TESTI-001 closed fixed (confirmed -> fixed): helper built by the real migrations (23-03), pauseFlow Tests 1-4 on the real pause statements and real migrations, v7 exit_state fixture pinned to the migrated table (operator ruling Fix now)
result: pass
source: automated
coverage_id: 23-14-D7

### 105. Full railed suite on Node 22 green and the 61-entry population fully recorded; check.ts partial and consolidation PASS (23-14 D8)
expected: Full railed suite on Node 22 green and the 61-entry population fully recorded; check.ts partial and consolidation PASS
result: pass
source: automated
coverage_id: 23-14-D8

### 106. The stats call is proven to run inside the wallet nonce lock: while the bot's flashbots_getBundleStatsV2 is held, a second same-wallet withNonceLock operation does not start; it starts only after release (23-15 D1)
expected: The stats call is proven to run inside the wallet nonce lock: while the bot's flashbots_getBundleStatsV2 is held, a second same-wallet withNonceLock operation does not start; it starts only after release
result: pass
source: automated
coverage_id: 23-15-D1

### 107. After release the fake relay replays the recorded live 403 byte for byte and the bot logs flashbots.bundle.stats.error once, with the status and body, as production does (23-15 D2)
expected: After release the fake relay replays the recorded live 403 byte for byte and the bot logs flashbots.bundle.stats.error once, with the status and body, as production does
result: pass
source: automated
coverage_id: 23-15-D2

### 108. Harness capability: relay answers with their own HTTP status and raw body; existing HTTP 200 behavior unchanged (23-15 D3)
expected: Harness capability: relay answers with their own HTTP status and raw body; existing HTTP 200 behavior unchanged
result: pass
source: automated
coverage_id: 23-15-D3

### 109. One-shot probe with classifier self-check, dry run, approval flag and no bot key (23-15 D4)
expected: One-shot probe with classifier self-check, dry run, approval flag and no bot key
result: pass
source: automated
coverage_id: 23-15-D4

### 110. Report and run evidence generated from three identical real-path runs plus one rail run (AC-10, D-11) (23-16 D1)
expected: Report and run evidence generated from three identical real-path runs plus one rail run (AC-10, D-11)
result: pass
source: automated
coverage_id: 23-16-D1

### 111. Operator review record with the verbatim reply, 44 acknowledgements and the AUD-TX-006 keep-open ruling; register follows it (AC-08, AC-17, AC-18) (23-16 D2)
expected: Operator review record with the verbatim reply, 44 acknowledgements and the AUD-TX-006 keep-open ruling; register follows it (AC-08, AC-17, AC-18)
result: pass
source: automated
coverage_id: 23-16-D2

### 112. Four needs_fork entries owned by Phase 25 through UFV-06..UFV-09 (AC-16) (23-16 D3)
expected: Four needs_fork entries owned by Phase 25 through UFV-06..UFV-09 (AC-16)
result: pass
source: automated
coverage_id: 23-16-D3

### 113. The census runs as a standing gate on the working tree: 23 transaction-signing sites (10 locked, 13 unlocked and listed, 0 unknown), 2 auditor exclusions, floor 23, exit 0 (23-17 D1)
expected: The census runs as a standing gate on the working tree: 23 transaction-signing sites (10 locked, 13 unlocked and listed, 0 unknown), 2 auditor exclusions, floor 23, exit 0
result: pass
source: automated
coverage_id: 23-17-D1

### 114. Every failure the census must catch is shown by a deliberate example: AC-32, AC-33 (23 passes, 22 fails), AC-34 (four history cases and the shallow refusal), AC-35, AC-36, unknown lock (F3), missing / non-covering / missing-record decision refs (AC-53), flag 7 (23-17 D2)
expected: Every failure the census must catch is shown by a deliberate example: AC-32, AC-33 (23 passes, 22 fails), AC-34 (four history cases and the shallow refusal), AC-35, AC-36, unknown lock (F3), missing / non-covering / missing-record decision refs (AC-53), flag 7
result: pass
source: automated
coverage_id: 23-17-D2

### 115. botWiring.test.ts reads no source file. Tests 22-26 drive the real exported handleNewPairForChain, executeDeliberateBuy, handleNewV3PoolForChain and startMultiChainBot separately and check the order with mock.invocationCallOrder. Test 31 runs the real getResumeAntiRugTrades statement on its real connection. (23-18 D1)
expected: botWiring.test.ts reads no source file. Tests 22-26 drive the real exported handleNewPairForChain, executeDeliberateBuy, handleNewV3PoolForChain and startMultiChainBot separately and check the order with mock.invocationCallOrder. Test 31 runs the real getResumeAntiRugTrades statement on its real connection.
result: pass
source: automated
coverage_id: 23-18-D1

### 116. Each of the seven in-memory wiring mutants (V2, deliberate, V3, boot and resume-query paths) fails exactly its expected tests with assertion failures. The no-mutant control passes 10/10. The src/bot.ts and src/utils/db.ts hashes are unchanged and git status for src is empty. (23-18 D2)
expected: Each of the seven in-memory wiring mutants (V2, deliberate, V3, boot and resume-query paths) fails exactly its expected tests with assertion failures. The no-mutant control passes 10/10. The src/bot.ts and src/utils/db.ts hashes are unchanged and git status for src is empty.
result: pass
source: automated
coverage_id: 23-18-D2

### 117. The tables name a mutant for each of the 6 converted tests, and every find occurs exactly once. (23-18 D3)
expected: The tables name a mutant for each of the 6 converted tests, and every find occurs exactly once.
result: pass
source: automated
coverage_id: 23-18-D3

### 118. twoStageSigint: the real startMultiChainBot adds exactly one SIGINT and one SIGTERM listener; SIGINT runs the cleanup once, forces no exit and arms one timer that forces exit 1 at SIGINT_GRACE_MS=1234 (not at 1233); a second SIGINT and then SIGTERM force 130 with no new timer; the listeners are removed after (23-19 D1)
expected: twoStageSigint: the real startMultiChainBot adds exactly one SIGINT and one SIGTERM listener; SIGINT runs the cleanup once, forces no exit and arms one timer that forces exit 1 at SIGINT_GRACE_MS=1234 (not at 1233); a second SIGINT and then SIGTERM force 130 with no new timer; the listeners are removed after
result: pass
source: automated
coverage_id: 23-19-D1

### 119. inclusionReconciliation D-RECORD-REAL-HASH: the real V2 and V3 buy handlers store the hash the seam returned; submitBuyTx waits on the real wallet nonce lock (23-19 D2)
expected: inclusionReconciliation D-RECORD-REAL-HASH: the real V2 and V3 buy handlers store the hash the seam returned; submitBuyTx waits on the real wallet nonce lock
result: pass
source: automated
coverage_id: 23-19-D2

### 120. inclusionReconciliation V2-unsafe-real-buy: the removed tax function is not exported and named by no src/ code (AST walk); the real simulateSwapForChain sends nothing and calls the swap once through staticCall (23-19 D3)
expected: inclusionReconciliation V2-unsafe-real-buy: the removed tax function is not exported and named by no src/ code (AST walk); the real simulateSwapForChain sends nothing and calls the swap once through staticCall
result: pass
source: automated
coverage_id: 23-19-D3

### 121. dotenvSrcSkip case (e): each of the five dotenv sites, run as a railed child with VITEST set, makes zero .env read attempts; each unguarded-call mutant is refused by the rails and recorded as env-read-blocked (23-19 D4)
expected: dotenvSrcSkip case (e): each of the five dotenv sites, run as a railed child with VITEST set, makes zero .env read attempts; each unguarded-call mutant is refused by the rails and recorded as env-read-blocked
result: pass
source: automated
coverage_id: 23-19-D4

### 122. AC-37 standing gate: no file under test/ reads a named top-level src/ or scripts/ file outside the allow list; temp-directory cases fail named reads through fs (sync, callback, promise), ts.createSourceFile and ts.createProgram (array and rootNames), a helper and a loop, and pass a directory walk, a temp-rooted read and non-source files (23-19 D5)
expected: AC-37 standing gate: no file under test/ reads a named top-level src/ or scripts/ file outside the allow list; temp-directory cases fail named reads through fs (sync, callback, promise), ts.createSourceFile and ts.createProgram (array and rootNames), a helper and a loop, and pass a directory walk, a temp-rooted read and non-source files
result: pass
source: automated
coverage_id: 23-19-D5

### 123. Manifest complete: 36 converted tests in 11 files and 1 guard (23-19 D6)
expected: Manifest complete: 36 converted tests in 11 files and 1 guard
result: pass
source: automated
coverage_id: 23-19-D6

### 124. Serializer and compare step: LF text, recorded order, the exact {\"submitted\":[]} line, one normalizer, byte compare that only the update switch can turn into a write (23-20 D1)
expected: Serializer and compare step: LF text, recorded order, the exact {\"submitted\":[]} line, one normalizer, byte compare that only the update switch can turn into a write
result: pass
source: automated
coverage_id: 23-20-D1

### 125. Five Flashbots V2 recordings (trailing, partial, stop-loss, urgency, anti-rug), each byte-compared on a normal run after its assertComplete (23-20 D2)
expected: Five Flashbots V2 recordings (trailing, partial, stop-loss, urgency, anti-rug), each byte-compared on a normal run after its assertComplete
result: pass
source: automated
coverage_id: 23-20-D2

### 126. Recordings guard: AC-21, AC-22, AC-26 and field-aware AC-51 over every recording, with temp-directory bad and good cases and the src/ host-literal check (23-20 D3)
expected: Recordings guard: AC-21, AC-22, AC-26 and field-aware AC-51 over every recording, with temp-directory bad and good cases and the src/ host-literal check
result: pass
source: automated
coverage_id: 23-20-D3

### 127. Explicit update command: refuses CI and an empty filter list, re-records a deleted recording byte-identical to HEAD (23-20 D4)
expected: Explicit update command: refuses CI and an empty filter list, re-records a deleted recording byte-identical to HEAD
result: pass
source: automated
coverage_id: 23-20-D4

### 128. Flashbots V3 trailing-stop recording (tracer): the V3 buy shape proven, the exit proven complete before the compare (23-21 D1)
expected: Flashbots V3 trailing-stop recording (tracer): the V3 buy shape proven, the exit proven complete before the compare
result: pass
source: automated
coverage_id: 23-21-D1

### 129. Flashbots V3 partial, stop-loss, urgency and anti-rug recordings, each byte-compared on a normal run after its assertComplete; the anti-rug one live, through the real V3 Burn grace window and Collect (23-21 D2)
expected: Flashbots V3 partial, stop-loss, urgency and anti-rug recordings, each byte-compared on a normal run after its assertComplete; the anti-rug one live, through the real V3 Burn grace window and Collect
result: pass
source: automated
coverage_id: 23-21-D2

### 130. Recordings guard (AC-21, AC-22, AC-26, AC-51) over all ten recordings with this plan's files present (23-21 D3)
expected: Recordings guard (AC-21, AC-22, AC-26, AC-51) over all ten recordings with this plan's files present
result: pass
source: automated
coverage_id: 23-21-D3

### 131. bloXroute (bsc) and public-route (base) buys and full sells, each asserting the checker read and proving relay acceptance, mined inclusion, the receipt and (public) three confirmations before the compare (23-22 D1)
expected: bloXroute (bsc) and public-route (base) buys and full sells, each asserting the checker read and proving relay acceptance, mined inclusion, the receipt and (public) three confirmations before the compare
result: pass
source: automated
coverage_id: 23-22-D1

### 132. Risk-gate refusal with the explicit empty list, the fee and gas figures, the affordability boundary below/at/above, and the legacy-fee buy (23-22 D2)
expected: Risk-gate refusal with the explicit empty list, the fee and gas figures, the affordability boundary below/at/above, and the legacy-fee buy
result: pass
source: automated
coverage_id: 23-22-D2

### 133. Recordings guard over all 22 recordings with this plan's files present, including the bloXroute answer rule and the AC-23 scope fix (23-22 D3)
expected: Recordings guard over all 22 recordings with this plan's files present, including the bloXroute answer rule and the AC-23 scope fix
result: pass
source: automated
coverage_id: 23-22-D3

### 134. AUD-TX-030 and AUD-BUY-037 registered with real-path evidence and named fix signals (23-22 D4)
expected: AUD-TX-030 and AUD-BUY-037 registered with real-path evidence and named fix signals
result: pass
source: automated
coverage_id: 23-22-D4

### 135. The full baseline (_baseline.json): 107 variables at valid values, the config, registry and risk parse results, and the five canSnipe probes; its env keys equal the AST inventory plus every recorded read (23-23 D1)
expected: The full baseline (_baseline.json): 107 variables at valid values, the config, registry and risk parse results, and the five canSnipe probes; its env keys equal the AST inventory plus every recorded read
result: pass
source: automated
coverage_id: 23-23-D1

### 136. One file per variable for unset, '', 0, abc and valid, each varied alone with the others valid, recording only what differs from the baseline; exits and NaN recorded as data (AC-27, AC-28, AC-29) (23-23 D2)
expected: One file per variable for unset, '', 0, abc and valid, each varied alone with the others valid, recording only what differs from the baseline; exits and NaN recorded as data (AC-27, AC-28, AC-29)
result: pass
source: automated
coverage_id: 23-23-D2

### 137. Read coverage: every case asserts its recorded reads are a subset of the _baseline.json env keys, naming the first extra read (mutation-proved) (23-23 D3)
expected: Read coverage: every case asserts its recorded reads are a subset of the _baseline.json env keys, naming the first extra read (mutation-proved)
result: pass
source: automated
coverage_id: 23-23-D3

### 138. VITEST's five values through railed children in a temp cwd whose only .env is a fake one-line file; dotenvLoaded true for unset and '', false for 0, abc and true (23-23 D4)
expected: VITEST's five values through railed children in a temp cwd whose only .env is a fake one-line file; dotenvLoaded true for unset and '', false for 0, abc and true
result: pass
source: automated
coverage_id: 23-23-D4

### 139. AC-51: every env file passes the recordings guard (sentinels only under their own names, walletPrivateKey, authKey, authHeader; URLs loopback or src/ public hosts) (23-23 D5)
expected: AC-51: every env file passes the recordings guard (sentinels only under their own names, walletPrivateKey, authKey, authHeader; URLs loopback or src/ public hosts)
result: pass
source: automated
coverage_id: 23-23-D5

### 140. Fresh in-process boot: every boot line in order, one PairCreated subscription per V2 DEX and one PoolCreated per V3 DEX, one added SIGINT and SIGTERM listener, DASHBOARD_PORT=0 on 127.0.0.1 with GET /health 200, shutdown through the real SIGINT listener pinned to how far it gets, listener counts back to start (23-24 D1)
expected: Fresh in-process boot: every boot line in order, one PairCreated subscription per V2 DEX and one PoolCreated per V3 DEX, one added SIGINT and SIGTERM listener, DASHBOARD_PORT=0 on 127.0.0.1 with GET /health 200, shutdown through the real SIGINT listener pinned to how far it gets, listener counts back to start
result: pass
source: automated
coverage_id: 23-24-D1

### 141. Resume boot after a real snipe and restart: exit-monitor resume invoked first, anti-rug resume starts before the exit timer is re-armed (AUD-BUY-038), both armed when the boot returns; shutdown clears the exit timer (23-24 D2)
expected: Resume boot after a real snipe and restart: exit-monitor resume invoked first, anti-rug resume starts before the exit timer is re-armed (AUD-BUY-038), both armed when the boot returns; shutdown clears the exit timer
result: pass
source: automated
coverage_id: 23-24-D2

### 142. armPositionMonitoring order per caller on the real path: V2 snipe, V3 snipe, deliberate buy (trades, exit_state, exit monitor started, lp_baseline, register, subscription) (23-24 D3)
expected: armPositionMonitoring order per caller on the real path: V2 snipe, V3 snipe, deliberate buy (trades, exit_state, exit monitor started, lp_baseline, register, subscription)
result: pass
source: automated
coverage_id: 23-24-D3

### 143. Nothing a booted bot started outlives its test (ten virtual minutes and real event-loop turns) (23-24 D4)
expected: Nothing a booted bot started outlives its test (ten virtual minutes and real event-loop turns)
result: pass
source: automated
coverage_id: 23-24-D4

### 144. Two PairCreated logs in one block handled in log order, both orders (AC-31) (23-24 D5)
expected: Two PairCreated logs in one block handled in log order, both orders (AC-31)
result: pass
source: automated
coverage_id: 23-24-D5

### 145. registerSingleton: a same-epoch copy of each guarded module is refused with SINGLETON_DUPLICATE; a whole-graph reset is allowed and the guard stays armed (23-24 D6)
expected: registerSingleton: a same-epoch copy of each guarded module is refused with SINGLETON_DUPLICATE; a whole-graph reset is allowed and the guard stays armed
result: pass
source: automated
coverage_id: 23-24-D6

### 146. AUD-BUY-038 registered with real-path evidence and a proven 'looks fixed' signal (23-24 D7)
expected: AUD-BUY-038 registered with real-path evidence and a proven 'looks fixed' signal
result: pass
source: automated
coverage_id: 23-24-D7

### 147. Any commit type that changes, removes, renames or re-adds a recorded scenario or env-snapshot file fails unless it is a behavior: commit citing a real ID; a brand-new scenario or env variable passes (AC-39, AC-40, A-2, D-17, D-18, T-23-41) (23-25 D1)
expected: Any commit type that changes, removes, renames or re-adds a recorded scenario or env-snapshot file fails unless it is a behavior: commit citing a real ID; a brand-new scenario or env variable passes (AC-39, AC-40, A-2, D-17, D-18, T-23-41)
result: pass
source: automated
coverage_id: 23-25-D1

### 148. A behavior: commit with no ID, an ID absent from the register, or an ID that only a later commit registers fails (AC-41) (23-25 D2)
expected: A behavior: commit with no ID, an ID absent from the register, or an ID that only a later commit registers fails (AC-41)
result: pass
source: automated
coverage_id: 23-25-D2

### 149. Merge commits are not judged, their inner commits are, and a merge whose conflict resolution alone changes a recording prints a WARN line with exit 0 (AC-42) (23-25 D3)
expected: Merge commits are not judged, their inner commits are, and a merge whose conflict resolution alone changes a recording prints a WARN line with exit 0 (AC-42)
result: pass
source: automated
coverage_id: 23-25-D3

### 150. The check runs by npm run check:commits and in CI after the census step, judges only commits after the first recording commit, refuses a shallow clone, and passes on the real history (AC-43, AC-44, T-23-31) (23-25 D4)
expected: The check runs by npm run check:commits and in CI after the census step, judges only commits after the first recording commit, refuses a shallow clone, and passes on the real history (AC-43, AC-44, T-23-31)
result: pass
source: automated
coverage_id: 23-25-D4

### 151. D-19: seal-verify.ts counts a merge commit by git's combined listing (a clean merge adds nothing, its inner commits count, a change made in a merge is caught) (23-26 D1)
expected: D-19: seal-verify.ts counts a merge commit by git's combined listing (a clean merge adds nothing, its inner commits count, a change made in a merge is caught)
result: pass
source: automated
coverage_id: 23-26-D1

### 152. Successor seals: --seal, covers, scan_record and scan_start_sha checks, predecessor linkage, changed_since_previous, --start, the SEAL*.json write refusal (23-26 D2)
expected: Successor seals: --seal, covers, scan_record and scan_start_sha checks, predecessor linkage, changed_since_previous, --start, the SEAL*.json write refusal
result: pass
source: automated
coverage_id: 23-26-D2

### 153. Exact-location reviewed-inert rule for the two ESC-SECRET-03 hits, with refusals and verifier re-checks (23-26 D3)
expected: Exact-location reviewed-inert rule for the two ESC-SECRET-03 hits, with refusals and verifier re-checks
result: pass
source: automated
coverage_id: 23-26-D3

### 154. Whole-phase proof on Node 22: wrapped full suite, test identity, every gate, three realpath runs, triage evidence byte-identical, RED proofs, src/ diff empty (23-26 D4)
expected: Whole-phase proof on Node 22: wrapped full suite, test identity, every gate, three realpath runs, triage evidence byte-identical, RED proofs, src/ diff empty
result: pass
source: automated
coverage_id: 23-26-D4

### 155. SEAL-23.json written and SEAL VALID; SEAL.json byte-unchanged; the phase scan reports zero non-public hits (23-26 D5)
expected: SEAL-23.json written and SEAL VALID; SEAL.json byte-unchanged; the phase scan reports zero non-public hits
result: pass
source: automated
coverage_id: 23-26-D5

### 156. Final gates at the sealed revision 912b915 as HEAD: check.ts --stage triage, check:realpath-mocks, check:census, check:commits, npm run test:realpath, check:recordings-compared --run-log (23-26 D6)
expected: Final gates at the sealed revision 912b915 as HEAD: check.ts --stage triage, check:realpath-mocks, check:census, check:commits, npm run test:realpath, check:recordings-compared --run-log
result: pass
source: automated
coverage_id: 23-26-D6

### 157. A restart keeps its database: a real V2 buy's exit_state row is read through the new connection after restartGraph, the capture and SQL clock are on the new connection, and the real resumeMultiChainMonitoring logs exit.monitor.resumed for that trade with no fresh start (23-27 D1)
expected: A restart keeps its database: a real V2 buy's exit_state row is read through the new connection after restartGraph, the capture and SQL clock are on the new connection, and the real resumeMultiChainMonitoring logs exit.monitor.resumed for that trade with no fresh start
result: pass
source: automated
coverage_id: 23-27-D1

### 158. No harness database outside the OS temp folder: a file outside it (in the repo, a .. escape, relative, the temp folder itself, :memory: as a file) and a smuggled DB_PATH are refused before any src/ import with no file created; the disposer removes the temp folder (23-27 D2)
expected: No harness database outside the OS temp folder: a file outside it (in the repo, a .. escape, relative, the temp folder itself, :memory: as a file) and a smuggled DB_PATH are refused before any src/ import with no file created; the disposer removes the temp folder
result: pass
source: automated
coverage_id: 23-27-D2

### 159. A real child and the test share one SQLite file and one simulated node: the child's block number is the node head, its eth_blockNumber is in callLog, its insertTrade row is read through the parent's real connection; the control child on another file leaves the parent table empty (23-27 D3)
expected: A real child and the test share one SQLite file and one simulated node: the child's block number is the node head, its eth_blockNumber is in callLog, its insertTrade row is read through the parent's real connection; the control child on another file leaves the parent table empty
result: pass
source: automated
coverage_id: 23-27-D3

### 160. The loopback WebSocket is a full JSON-RPC peer: a real child's ethers WebSocketProvider subscribes (logs with the anti-rug filter shape, and newHeads), gets the matching log and not the other, gets the mined head; afterwards no subscription remains and a later push records no stray; RED before the route (CHILD_WS_TIMEOUT, exit 3) (23-27 D4)
expected: The loopback WebSocket is a full JSON-RPC peer: a real child's ethers WebSocketProvider subscribes (logs with the anti-rug filter shape, and newHeads), gets the matching log and not the other, gets the mined head; afterwards no subscription remains and a later push records no stray; RED before the route (CHILD_WS_TIMEOUT, exit 3)
result: pass
source: automated
coverage_id: 23-27-D4

### 161. A triage test can deliver a real-shaped Telegram message to the real inline allowlist handler: unset allowlists reach eth_getCode and 'Contract not found on any chain'; set and not matching reject before any chain call (with an allowed-sender control); no handler throws 'no Telegram handler registered'; disposal leaves 0 handlers (23-27 D5)
expected: A triage test can deliver a real-shaped Telegram message to the real inline allowlist handler: unset allowlists reach eth_getCode and 'Contract not found on any chain'; set and not matching reject before any chain call (with an allowed-sender control); no handler throws 'no Telegram handler registered'; disposal leaves 0 handlers
result: pass
source: automated
coverage_id: 23-27-D5

### 162. Public-route transaction life on the simulated node: accepted, pending, mined and receipted, with every real refusal, replacement, relay acceptance, competition, neverMine and queued nonce (23-28 D1)
expected: Public-route transaction life on the simulated node: accepted, pending, mined and receipted, with every real refusal, replacement, relay acceptance, competition, neverMine and queued nonce
result: pass
source: automated
coverage_id: 23-28-D1

### 163. Fee answers (incl. legacy node), stored logs through eth_getLogs, filtered subscriptions and receipt logs read by the real decodeReceipt (23-28 D2)
expected: Fee answers (incl. legacy node), stored logs through eth_getLogs, filtered subscriptions and receipt logs read by the real decodeReceipt
result: pass
source: automated
coverage_id: 23-28-D2

### 164. createScenario for every chain and DEX type, with route proofs ETH V3 (bundle), bsc V2 (bloxroute), base V3 and arb V3 (public), each asserting the decoded call, its route and the checker read (23-28 D3)
expected: createScenario for every chain and DEX type, with route proofs ETH V3 (bundle), bsc V2 (bloxroute), base V3 and arb V3 (public), each asserting the decoded call, its route and the checker read
result: pass
source: automated
coverage_id: 23-28-D3

### 165. base and arb V2 tests record today's AUD-BUY-016 skip (operator ruling), fail with 'AUD-BUY-016 looks fixed' once the query is fixed (23-28 D4)
expected: base and arb V2 tests record today's AUD-BUY-016 skip (operator ruling), fail with 'AUD-BUY-016 looks fixed' once the query is fixed
result: pass
source: automated
coverage_id: 23-28-D4

### 166. AUD-BUY-016 evidence and status change recorded per PROTOCOL.md, register checks unchanged from baseline (23-28 D5)
expected: AUD-BUY-016 evidence and status change recorded per PROTOCOL.md, register checks unchanged from baseline
result: pass
source: automated
coverage_id: 23-28-D5

### 167. A named mutant applied in memory as Vite loads src/guards/directEntry.ts fails exactly the named test with an assertion, the same test passes with no mutant, and the file's SHA-256 is unchanged (mech-vite) (23-29 D1)
expected: A named mutant applied in memory as Vite loads src/guards/directEntry.ts fails exactly the named test with an assertion, the same test passes with no mutant, and the file's SHA-256 is unchanged (mech-vite)
result: pass
source: automated
coverage_id: 23-29-D1

### 168. The same mechanism reaches a worker's own file read (mech-worker on test/unit/codeQuality.test.ts, worker marker) and a real npx ts-node railed child (mech-child on test/integration/directEntryGuard.test.ts, child marker), with test/rails and vitest.config.ts unchanged on disk (23-29 D2)
expected: The same mechanism reaches a worker's own file read (mech-worker on test/unit/codeQuality.test.ts, worker marker) and a real npx ts-node railed child (mech-child on test/integration/directEntryGuard.test.ts, child marker), with test/rails and vitest.config.ts unchanged on disk
result: pass
source: automated
coverage_id: 23-29-D2

### 169. The runner refuses the five ways a proof could be empty, each with its named reason: NOT-APPLIED, NOT-REACHED, STAYED-GREEN, WRONG-SET, BAD-FAILURE (a child that failed to compile while the same test still failed) (23-29 D3)
expected: The runner refuses the five ways a proof could be empty, each with its named reason: NOT-APPLIED, NOT-REACHED, STAYED-GREEN, WRONG-SET, BAD-FAILURE (a child that failed to compile while the same test still failed)
result: pass
source: automated
coverage_id: 23-29-D3

### 170. Manifest, guard and summary rules reject each listed bad table and summary and accept complete tables with no guard and with one (guards 1, rows unchanged) (23-29 D4)
expected: Manifest, guard and summary rules reject each listed bad table and summary and accept complete tables with no guard and with one (guards 1, rows unchanged)
result: pass
source: automated
coverage_id: 23-29-D4

### 171. With the conversion tables empty, --check-manifest prints MANIFEST-OK rows 0 files 0 guards 0 (23-29 D5)
expected: With the conversion tables empty, --check-manifest prints MANIFEST-OK rows 0 files 0 guards 0
result: pass
source: automated
coverage_id: 23-29-D5

### 172. antiRug.test.ts Test 6: a request on the real startApiServer reaches antiRugRoutes at /api/anti-rug behind authMiddleware (401 without a session) and resets the same context the server was given; 3 mutants on src/api/server.ts each fail exactly Test 6 (23-30 D1)
expected: antiRug.test.ts Test 6: a request on the real startApiServer reaches antiRugRoutes at /api/anti-rug behind authMiddleware (401 without a session) and resets the same context the server was given; 3 mutants on src/api/server.ts each fail exactly Test 6
result: pass
source: automated
coverage_id: 23-30-D1

### 173. antiRugConfig.test.ts Tests 19-21: no anti-rug variable is required (real config import with all of them unset); the one REQUIRED_ENV_VARS array found by symbol holds >= 32 anti-rug entries, each with a non-empty description; 3 mutants on src/config.ts each fail exactly their test (23-30 D2)
expected: antiRugConfig.test.ts Tests 19-21: no anti-rug variable is required (real config import with all of them unset); the one REQUIRED_ENV_VARS array found by symbol holds >= 32 anti-rug entries, each with a non-empty description; 3 mutants on src/config.ts each fail exactly their test
result: pass
source: automated
coverage_id: 23-30-D2

### 174. antiRugReason.test.ts Tests 1, 2, 3, 3b, 7: a real type-checker query for the reason union (fails on a temp-dir source and on the real file under its mutant); the anti-rug multiplier reaches the private escalation only for anti-rug; a successful partial sell leaves anti-rug registered; 5 mutants, 7 RED-OK lines (23-30 D3)
expected: antiRugReason.test.ts Tests 1, 2, 3, 3b, 7: a real type-checker query for the reason union (fails on a temp-dir source and on the real file under its mutant); the anti-rug multiplier reaches the private escalation only for anti-rug; a successful partial sell leaves anti-rug registered; 5 mutants, 7 RED-OK lines
result: pass
source: automated
coverage_id: 23-30-D3

### 175. Manifest: 32 rows in 8 files and 1 guard (23-30 D4)
expected: Manifest: 32 rows in 8 files and 1 guard
result: pass
source: automated
coverage_id: 23-30-D4

### 176. preflightCli.test.ts: a real run of scripts/preflight.ts in a railed child never loads the module that exports startMultiChainBot; preflight-imports-bot (reach child) fails exactly that test (23-31 D1)
expected: preflightCli.test.ts: a real run of scripts/preflight.ts in a railed child never loads the module that exports startMultiChainBot; preflight-imports-bot (reach child) fails exactly that test
result: pass
source: automated
coverage_id: 23-31-D1

### 177. pauseCli.test.ts: 12 tests run scripts/pause.ts and resume.ts as railed children. The key is never printed on a refused login or a refused connection; an empty key is refused even with --api-key; the dialed address follows DASHBOARD_URL / HOST / PORT, defaults to 8080 and never uses 3000. Each of 12 mutants (reach child) fails exactly its expected tests. (23-31 D2)
expected: pauseCli.test.ts: 12 tests run scripts/pause.ts and resume.ts as railed children. The key is never printed on a refused login or a refused connection; an empty key is refused even with --api-key; the dialed address follows DASHBOARD_URL / HOST / PORT, defaults to 8080 and never uses 3000. Each of 12 mutants (reach child) fails exactly its expected tests.
result: pass
source: automated
coverage_id: 23-31-D2

### 178. processLock.test.ts: the AC-23d text scan is now its own import-graph test (ts.createProgram over a directory walk); every existing title, AUD-TX-005's rail test and its marker are unchanged; 5 mutants (reach worker) fail it (23-31 D3)
expected: processLock.test.ts: the AC-23d text scan is now its own import-graph test (ts.createProgram over a directory walk); every existing title, AUD-TX-005's rail test and its marker are unchanged; 5 mutants (reach worker) fail it
result: pass
source: automated
coverage_id: 23-31-D3

### 179. mainEntry.test.ts: (4), (5) and (6) find modules by symbol and load them in railed children where a load can show the behavior; the 8 mutants on their rows and the guard main-starts-before-lock on (1) each fail exactly their expected test (23-31 D4)
expected: mainEntry.test.ts: (4), (5) and (6) find modules by symbol and load them in railed children where a load can show the behavior; the 8 mutants on their rows and the guard main-starts-before-lock on (1) each fail exactly their expected test
result: pass
source: automated
coverage_id: 23-31-D4

### 180. Manifest and summaries: 23 rows in 5 files and 1 guard; every required RED-OK line is present (23-31 D5)
expected: Manifest and summaries: 23 rows in 5 files and 1 guard; every required RED-OK line is present
result: pass
source: automated
coverage_id: 23-31-D5

### 181. AUD-API-002 stop-disarms-antirug and start-does-not-rearm-antirug on a real in-process boot; Start runs the real onRestart (three 'DEX listener restarted' lines asserted) (23-32 D1)
expected: AUD-API-002 stop-disarms-antirug and start-does-not-rearm-antirug on a real in-process boot; Start runs the real onRestart (three 'DEX listener restarted' lines asserted)
result: pass
source: automated
coverage_id: 23-32-D1

### 182. AUD-BUY-008 restart-stacks-reconnect-loop and its control on a real in-process boot (23-32 D2)
expected: AUD-BUY-008 restart-stacks-reconnect-loop and its control on a real in-process boot
result: pass
source: automated
coverage_id: 23-32-D2

### 183. AC-37 gate allow list holds exactly the 3 dashboard tests; the old fixture's src/bot.ts read fails it (23-32 D3)
expected: AC-37 gate allow list holds exactly the 3 dashboard tests; the old fixture's src/bot.ts read fails it
result: pass
source: automated
coverage_id: 23-32-D3

### 184. triage-evidence.json regenerated from three identical runs and the rail run; only the recorded title differs (23-32 D4)
expected: triage-evidence.json regenerated from three identical runs and the rail run; only the recorded title differs
result: pass
source: automated
coverage_id: 23-32-D4

### 185. Full railed suite, register checks, test-identity, type checks, mock gates, commit check, manifest (23-32 D5)
expected: Full railed suite, register checks, test-identity, type checks, mock gates, commit check, manifest
result: pass
source: automated
coverage_id: 23-32-D5

### 186. Every compareRecording call against the real recordings folder is recorded against its run, from every worker, with the relative path it compared; dir-override calls are not recorded; no valid run id records nothing and says so once; compare and write results unchanged (23-33 D1)
expected: Every compareRecording call against the real recordings folder is recorded against its run, from every worker, with the relative path it compared; dir-override calls are not recorded; no valid run id records nothing and says so once; compare and write results unchanged
result: pass
source: automated
coverage_id: 23-33-D1

### 187. After a full realpath run the check fails naming each tracked recording never compared and each compared path not tracked; the 23-25 redirect fails naming the old file while the commit check passes it; a stale run never counts; an empty or broken record exits 2 (23-33 D2)
expected: After a full realpath run the check fails naming each tracked recording never compared and each compared path not tracked; the 23-25 redirect fails naming the old file while the commit check passes it; a stale run never counts; an empty or broken record exits 2
result: pass
source: automated
coverage_id: 23-33-D2

### 188. The check runs as npm run check:recordings-compared, in CI directly after npm run test:realpath, and in the wave gate after the full suite; a real full run passes with equal counts (23-33 D3)
expected: The check runs as npm run check:recordings-compared, in CI directly after npm run test:realpath, and in the wave gate after the full suite; a real full run passes with equal counts
result: pass
source: automated
coverage_id: 23-33-D3

## Summary

total: 188
passed: 187
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps

[none yet]
