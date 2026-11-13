---
phase: 23-test-safety-net-harness-triage-characterization
fixed_at: 2026-11-13T04:52:58.532Z
review_path: .planning/phases/23-test-safety-net-harness-triage-characterization/23-REVIEW.md
iteration: 1
findings_in_scope: 46
fixed: 46
skipped: 0
status: all_fixed
---

# Phase 23: Code Review Fix Report

**Fixed at:** 2026-11-12
**Source review:** .planning/phases/23-test-safety-net-harness-triage-characterization/23-REVIEW.md
**Iteration:** 1
**Fix scope:** Critical + Warning (46 findings)

**Summary:**
- Findings in scope: 46
- Fixed: 46
- Skipped: 0
- Status: all_fixed
- `src/` is unchanged since the phase start (`git diff 7d0b7b38..HEAD -- src` is empty). Every fix is in tests, the harness, the CI gates, CI wiring, or the seal verifier.

## How the fixes were made

Five gsd-code-fixer agents each worked in their own git worktree and branch, and each finding was committed on its own. The orchestrator merged each branch into the phase branch with a merge commit (so the hashes below stay valid) and verified the merged result in the main checkout under Node 22.16.0.

| Fixer | Findings | Merge |
|---|---|---|
| T (CI gates) | CR-08, CR-09, WR-23..WR-27, WR-29..WR-31; WR-24 part 1 | f7bfa9d |
| E (recordings, seal verifier) | CR-10, WR-28, WR-32..WR-36 | bcd951c |
| A (harness) | WR-01..WR-06; AUD-TX-003 and AUD-TX-029 re-triage (operator ruling) | f6f6589 |
| B (triage tests: anti-rug, dashboard, DB, TX, scripts) | CR-01..CR-03, WR-07..WR-10 | 8e9b0e4 |
| C (triage tests: buy, exit) | CR-04..CR-07, WR-11..WR-22 | f9eedef |
| T (census dead-code class) | WR-24 part 2 (operator ruling) | 45662e8 |

Orchestrator and follow-up commits:
- 150bb1e: AUD-EXIT-002 had stopped passing the register check's D-21 scan after the CR-07 restructure; it now uses the exported `KnownBugContext` type.
- 9863c09, e68acf8, f7d3c8e: the register rulings, the new finding AUD-BUY-039, and the regenerated triage evidence and report (register executor).
- bd35d87: the operator's verbatim answers added to PN-002, AC-42 marked superseded in 23-SPEC.md, and two ruling dates aligned.
- 17b1c32: WR-28 follow-up by fixer T. The source-text gate now refuses named reads of `test/realpath/recordings/`, closing the last route E's WR-28 fix left open.
- 61adddf: the successor seal SEAL-23b.json (fixer E).

**Proof standard for triage tests.** Every triage test a fixer changed shows three results:
1. it still records its bug on today's `src/`;
2. it reads "looks fixed" under an in-memory mutant of the finding's recommended fix (`scripts/vitest.in-memory-mutant.config.ts` with `CSB_MUTANT_SPEC`; nothing under `src/` is written);
3. it does not read "looks fixed" under the wrong or partial fix the review named.

The mutant specs are in each fixer's notes below. Harness changes had to leave every triage result and every recording unchanged, checked by diffing the whole real-path project against a baseline. The one exception is the operator-ruled WR-01 default.

## Operator rulings (selected answers, verbatim)

1. **Seal verifier fixes (CR-10, WR-32), which make SEAL-23.json report INVALID:** "Fix, cut a new seal (Recommended)". Outcome: SEAL-23b.json, a successor over `.planning/audit/` at bd35d87.
2. **WR-01, realistic reverts and the two results that depended on the gap:** first asked in technical terms, and the operator replied "what?". Re-asked in plain words, the answer was "Fix it now (Recommended)". Outcome: realistic reverts are the default, and AUD-TX-003 and AUD-TX-029 were re-triaged. Both still hold: AUD-TX-003 holds the lock about 105 s rather than about 4 minutes, and AUD-TX-029 is narrowed to two-attempt sells.
3. **Register updates from the stricter tests, plus rebuilding the triage evidence and report:** "Apply all (Recommended)".
4. **New finding (a snipe's private escalation outlives its own 60 s deadline):** "Add it as S2 (Recommended)". Outcome: AUD-BUY-039.
5. **WR-24 part 2 (the lock key must be the signer's own address):** first answered "Add with an exclusion (Recommended)". That option was described inaccurately: the census's exclusion list accepts only calls whose ABI it cannot read, and `approve` is readable. Corrected and re-asked, the answer was "Add the dead-code rule (Recommended)". Outcome: a census-proven `dead` class for the unreachable `maybeApproveForChain` approve, citing AUD-BUY-007. It fails if the function gains a caller or an export, or is deleted.
6. **WR-27, which replaces AC-42's warn-only rule for merge commits:** "Keep the stricter rule (Recommended)". Outcome: AC-42 is marked superseded in 23-SPEC.md.

## Verification

At bd35d87, in the main checkout, Node 22.16.0:
- real-path project: 369 of 369 passed, 103 knownBug records; recordings untouched;
- recordings-compared: 130 of 130 matched (RESULT PASS);
- unit: 964 passed (966 at 17b1c32);
- integration: 264 passed;
- census: 24 sites (locked 10, unlocked 13, unknown 0, dead 1), floor 24, 0 problems; floor history: 0 problems;
- check:realpath-mocks 0 violations; check:vi-mock 0 violations; check:commits RESULT PASS;
- `tsc --noEmit` on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json: all pass;
- register `check.ts --stage triage`: RESULT PASS;
- `seal-verify.ts --self-test`: RESULT PASS.

Seal (61adddf):
- `seal-verify.ts --seal .planning/audit/SEAL-23b.json`: SEAL VALID (successor of SEAL-23.json; sealed_sha bd35d87; 24 paths changed under `.planning/audit/` since 912b915; phase scan 912b915..bd35d87: 75 commits, 0 hits in every class; final_check `check.ts --stage triage` at bd35d87: RESULT PASS).
- the same with `--scan` (commits after the seal, bd35d87..61adddf): 0 hits, SEAL VALID.
- `seal-verify.ts --seal .planning/audit/SEAL-23.json`: SEAL INVALID, superseded as expected; it lists the 24 changed paths, `tools/seal-verify.ts` among them.
- `seal-verify.ts --self-test`: RESULT PASS (135 cases).

## Open items for the operator

These are not deferred silently; each needs a decision or a follow-up.

1. **Remaining harness gap: sells never revert by default.** The default scenario router has no read for the bot's sell calls, so a sell's deadline, allowance and output floor are not enforced unless a scenario installs its own sell read. Phase 24 Wave C's private-sell minOut fix (OD-14) is proven on sells. Recommendation: close this gap, with its own baseline measurement, before Wave C starts.
2. **Fixer C's judgment calls.**
   - AUD-EXIT-014 (WR-17): "refused at once" is checked after the marker, not inside `actual`, because queue-and-retry is a recommended fix and may refuse once and then succeed.
   - AUD-BUY-005: the new V2 claim uses a stand-in trigger (closing the bot's database with its own `closeDb()`), because a natural V2 trigger is not reachable in the harness.
3. **AUD-SCRIPTS-002 mutants** use a custom four-file `workerHook`, because a full fix spans four script files. It is still in memory only.
4. **AUD-BUY-039's capital-impact class** is recorded as "none". The rationale notes the indirect V3-exit effect, and changing the class is a one-field edit if the operator sees it as STRAND.
5. **No local pre-commit scan of staged recordings.** `.git/hooks` is untracked. WR-35's tracked fix runs the guard after every re-record instead.

## Fixed Issues

### CR-01: AUD-ANTIRUG-001 waits for the bug's four reconnect loops, so the recommended single-loop fix stalls instead of reading "looks fixed"

**Fixer:** triage tests (anti-rug, dashboard, DB, TX, scripts) (fixer B); fixer's heading: "AUD-ANTIRUG-001 waits for the bug's four reconnect loops"

**Files modified:** `test/realpath/triage/AUD-ANTIRUG-001.test.ts`
**Commit:** 31d778a
**Applied fix:** `dropAndReconnect` used to wait for one `antirug.ws.reconnected` op and three per-DEX "re-subscribed" lines. It now waits on the outcome every fix shape must reach:
- the dropped socket is CLOSED;
- another socket of the chain's WebSocket URL is OPEN;
- the node holds a rug-log subscription covering the pair;
- every DEX factory is subscribed again.

It then settles for 5 s, as before. The `{ antiRugLoops, dexLoops }` parameters are gone. No knownBug record changed.

Proofs (mutant specs are in the appendix):
1. **Still RED today:** PASS. All three claims recorded: `{rugLogSubscriptions:1,onCtxWsProvider:false}`, `{rugLogSubscriptionsForPairA:2,evaluationsOfOneLog:2}`, `{replacedProvidersStillOpen:3}`.
2. **Correct fix flips it:** mutant `antirug001-single-loop` (src/bot.ts). This is a real single-owner shape: the per-DEX close handlers and their loops are removed, so there are no per-DEX "re-subscribed" lines. The anti-rug loop is the one owner, and assigning `ctx.wsProvider` re-attaches every DEX factory listener on that provider and destroys the provider it replaces. Result: all three claims threw "looks fixed". Under the same mutant the **old** test stalled on all three claims ("every reconnect loop reconnecting did not hold within 20000 virtual ms"), which confirms the review.
3. **Wrong/partial fix does not:** CR-01 names no wrong fix, so a partial one was used: `antirug001-partial-no-ctx-write`, where the DEX loops stop writing `ctx.wsProvider` but each still builds its own provider and none is destroyed. Claims 1 and 2 read "looks fixed", which is right for them: the subscription is on the context provider and the duplicate dispatch is gone. Claim 3 recorded the bug (`replacedProvidersStillOpen: 3`) and then failed one post-marker detail assertion that is specific to today's layout.

### CR-02: AUD-DB-001 reads any `restartGraph` failure as "the limit is enforced", including stop-step failures that happen before `abc` is applied

**Fixer:** triage tests (anti-rug, dashboard, DB, TX, scripts) (fixer B); fixer's heading: "AUD-DB-001 reads any restartGraph failure as "the limit is enforced""

**Files modified:** `test/realpath/triage/fixtures/AUD-DB-001-limits.ts`, `test/realpath/triage/AUD-DB-001.test.ts` (header text only)
**Commit:** 1d1d65e
**Applied fix:**
- `reloadAndCheck` takes a `refusable` variable name. Only the abc reload passes it.
- A throw counts as `{ loaded: false }` only when all of these hold:
  - (a) `process.env[variable]` equals the requested value. `restartGraph` applies the env only after every stop step passed, so this separates a stop-phase failure from a load failure without a harness change.
  - (b) It is not an `AggregateError`, and its message does not start with `restartGraph:` or `loadGraph:`. Those are the harness's stop steps and post-load checks.
  - (c) The message names the variable as a whole word.
- Every other failure is rethrown, after the leaked connection is closed.
- The valid reload, and AUD-DB-003's two reloads, rethrow every failure. AUD-DB-003 already asserted `loaded: true`, so it now fails with the real error instead of a boolean mismatch.
- No knownBug record changed.

Proofs:
1. **Still RED today:** PASS. All 5 claims recorded `{limitEnforced:false}`. AUD-DB-003 still records both of its claims.
2. **Correct fix flips it:** mutant `db001-refuse-start`. riskManager refuses to start on a non-finite value of any of the five variables and names the variable, which is the recommendation. Result: all 5 claims threw "looks fixed".
3. **Wrong fix does not:** both cases are the review's own scenarios, with riskManager still parsing abc to NaN.
   - `db001-unrelated-import-error`: an import-time error with no variable name, on the scenario's third load, which is the abc reload. All 5 failed with "provider pool exhausted on reload". The old fixture read "looks fixed" on all 5.
   - `db001-stop-step-error`: `clearAllTimers` throws on its third call, which is the first stop step of the abc restart, before the env is applied. All 5 failed with "restartGraph: clear bot timers failed: ...". The old fixture read "looks fixed" on all 5.

### CR-03: AUD-TX-002 / AUD-BUY-025 / AUD-EXIT-009 read "lock released" as fixed, which also passes the wrong fix the recommendation forbids (lock released with the stuck nonce still pending)

**Fixer:** triage tests (anti-rug, dashboard, DB, TX, scripts) (fixer B); fixer's heading: "AUD-TX-002 / AUD-BUY-025 / AUD-EXIT-009 read "lock released" as fixed"

**Files modified:** `test/realpath/triage/AUD-TX-002.test.ts`, `test/realpath/triage/fixtures/AUD-TX-002-lock.ts`
**Commit:** 5b6a3e4
**Applied fix:**
- `probeWalletLock` also records `minedAtStart()`: the wallet's mined count on the node (its `latest` nonce) when the probe's body runs inside the lock. This is additive; AUD-TX-001 and AUD-TX-003 re-ran green.
- Each claim's `actual`, `correct` and `observed` gains `stuckNonceSettledBeforeRelease`. It is true when the probe started with `minedAtStart > stuckNonce`, meaning a same-nonce replacement or cancel had been mined. `pendingWindow` mines every 12 s, so a replacement in the pool gets included.
- `stuckNonce` is read from the node's own submitted entry by hash (`submittedNonce`).
- A pre-marker setup fact asserts `minedCount(wallet) === stuckNonce`, true under the bug and every fix.
- Found while proving: `approvalsSubmitted()` returns decoded approvals with no `raw`, and `Transaction.from(undefined)` silently gives nonce 0. That is why the stuck nonce is read by hash and checked by the setup fact.

Proofs (one correct and one wrong mutant per site; each touches only its own site, and the other two claims kept recording):
1. **Still RED today:** PASS. All three claims recorded `{laterOperationStartedInWindow:false, stuckNonceSettledBeforeRelease:false}`. All three controls pass.
2. **Correct fix flips it ("timeout, then a same-nonce cancel, then release"):**
   - `tx002-passthrough-correct` gives AUD-TX-002 "looks fixed".
   - `tx002-deliberate-correct` gives AUD-BUY-025 "looks fixed".
   - `tx002-approval-correct` gives AUD-EXIT-009 "looks fixed".
3. **Wrong fix does not ("timeout and release only"):**
   - `tx002-passthrough-wrong` (`tx.wait(3, 120_000)`) gives AUD-TX-002 "the failure changed".
   - `tx002-deliberate-wrong` gives AUD-BUY-025 "the failure changed".
   - `tx002-approval-wrong` gives AUD-EXIT-009 "the failure changed". Under the first, flawed nonce reading this case read "looks fixed", which is how the `raw` problem above was found.

### CR-04: AUD-BUY-008 reads "looks fixed" after a V2-only fix; the V3 reconnect handler is never measured

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "AUD-BUY-008 reads "looks fixed" after a V2-only fix"

**Files modified:** `test/realpath/triage/AUD-BUY-008.test.ts`
**Commit:** 066ea2a
**Applied fix:** The marker now measures every DEX of the ETH chain: uniswap-v2 and sushiswap-v2 (handleWsClose) and uniswap-v3 (handleWsCloseV3). `actual = { reconnectLoopsForOneClose: { 'uniswap-v2', 'sushiswap-v2', 'uniswap-v3' } }`, with `correct` and `observed` written as literals. A plain expect before the marker pins the three DEX names and types. The old all-DEX loop after the marker is removed, because the marker now covers it. The claim name is unchanged.
**Proof:**
1. Still RED today: `{2,2,2}` recorded.
2. Correct fix FLIPS. `cr04-correct.json`: both the V2 and the V3 registration in `src/bot.ts` become idempotent per socket and DEX (a Set on the socket, keyed by DEX).
3. Wrong fix is CHANGED. `cr04-wrong-v2only.json`: only the V2 registration becomes idempotent.

### CR-05: AUD-EXIT-007 and AUD-EXIT-008 exercise only the dashboard force-sell caller; a fix there flips the marker while the other callers still strand the position

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "AUD-EXIT-007 / AUD-EXIT-008 exercise only the dashboard force-sell caller"

**Files modified:** `test/realpath/triage/AUD-EXIT-007.test.ts`, `test/realpath/triage/AUD-EXIT-008.test.ts`, `test/realpath/triage/fixtures/AUD-EXIT-014-rug.ts` (new export `pullV3Liquidity`)
**Commit:** b3c8dd7
**Applied fix:**
- **EXIT-007, claim `emergency-sell-v3-not-landed-leaves-no-poll`.** Driven through POST `/api/controls/emergency-sell`.
- **EXIT-007, claim `antirug-v3-not-landed-leaves-no-poll`.** A real V3 rug on a live anti-rug position. The new fixture `pullV3Liquidity` signs a real NPM `multicall(decreaseLiquidity, collect)`; the pool emits its own Burn and Collect, and its reserves and `liquidity()` move. The real detector then reaches its confirm gate and dispatches, and the real `triggerAntiRugExit` runs `executeFullSell(...,'anti-rug')`. The private attempts miss, and the V3 no-fallback return is taken with reason anti-rug.
- **EXIT-008, claim `operator-emergency-sell-refused-while-routine-paused`.** Driven through POST `/api/controls/emergency-sell`. The paused-position setup is factored into `pausedPosition()`.

**Proof (EXIT-007):**
1. Still RED today: all four claims recorded.
2. Correct fix FLIPS the three V3 not-landed claims. `cr05-007-correct.json`: `src/exitEngine.ts` calls `keepMonitoringFailedHeld` on the V3 no-fallback return. The unknown-dex claim stays recorded, because that return is not patched.
3. Wrong fix: `cr05-007-wrong-forcesell-only.json` re-arms only in the force-sell route (`resumeExitMonitor` in `src/api/routes/controls.ts`). The two force-sell claims FLIP (that caller really is fixed). The emergency-sell and anti-rug claims stay RED, so the finding does not read fixed.

**Proof (EXIT-008):**
1. Still RED today: both claims recorded.
2. Correct fix FLIPS both. `cr05-008-correct.json`: the routine-pause gate in `executeFullSell` is bypassed for operator sells (reasonDetail `...triggered via dashboard`).
3. Wrong fix: `cr05-008-wrong-forcesell-only.json` bypasses the gate for force-sell only. The force-sell claim FLIPS; the emergency-sell claim stays RED.

### CR-06: AUD-BUY-010 "max-open-positions-overspent" reads "looks fixed" when only the per-chain cooldown is reserved

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "AUD-BUY-010 reads "looks fixed" when only the cooldown is reserved"

**Files modified:** `test/realpath/triage/AUD-BUY-010.test.ts`
**Commit:** ff70f15
**Applied fix:**
- The scenario now sets `SNIPE_COOLDOWN_MS: '0'`.
- `actual = { buysLanded, bRefusedBy }`, where `bRefusedBy` is the `reason` on the bot's own "Risk check failed, skipping snipe" line for token B (null when nothing refused B).
- B's wait is now a bounded 20 s window of virtual time, inside A's 60 s swap deadline, instead of a required predicate. A per-chain serialized pipeline (the recommendation's other shape) is therefore measured instead of stalling. The drive then waits for B's decision and for the buys to finish.

**Proof:**
1. Still RED today: `{2, null}`.
2. Correct fix FLIPS, in two shapes:
   - `cr06-correct.json`: an in-process reservation counter in `src/riskManager.ts`, counted by the open-position check and taken when `canSnipe` passes.
   - `cr06-correct-serialized.json`: `handleNewPairForChain` is wrapped in a per-chain promise chain in `src/bot.ts`.
3. Wrong fix stays RED. `cr06-wrong-cooldown-only.json`: `lastSnipeTime` is stamped when `canSnipe` passes, with no position reservation.

### CR-07: One-shot faults let a retry-once "fix" read "looks fixed" while the fail-open or give-up path is still in the code

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "One-shot faults let a retry-once fix read "looks fixed""

**Files modified:** `test/realpath/triage/AUD-BUY-003.test.ts`, `test/realpath/triage/AUD-BUY-002.test.ts`, `test/realpath/triage/AUD-EXIT-002.test.ts`
**Commit:** 5afdcf9
**Applied fix:** Each fault now uses `times: 1_000` and is gated by an `after` predicate that closes a decision window:
- BUY-003: the window is 5 s after the first fire, closed before the buy is mined.
- BUY-002 claim 1: the window is 30 s after the first fire.
- EXIT-002: the window is the whole six-poll observation.

Further changes:
- `fired === 1` became `>= 1`.
- EXIT-002 adds claim `first-quote-transient-failure-leaves-position-unmonitored`, with a one-shot fault. There a retry is a correct fix, as the review suggested.
- EXIT-002's "no poll loop" detail now counts the quotes made during the observation, so a retry made at monitor start does not trip it.
- The BUY-002 claim-1 test title now says "balanceOf errors ... (a lagging node, 30 s)".
- The EXIT-002 persistent test title was updated.

**Proof:**
- **BUY-003.**
  1. RED.
  2. FLIPS both claims with `cr07-buy003-correct-skip.json` (the quote-failure catch returns; fail closed, V2 and V3).
  3. Stays RED with `cr07-buy003-wrong-retry-once.json` (`.catch` retry of `getAmountsOut` and of the QuoterV2 call).
- **BUY-002 claim 1.**
  1. RED.
  2. FLIPS with `cr07-buy002-correct-retry-until-answer.json` (the post-mine balanceOf retries every 2 s, up to 60 times, then arms).
  3. Stays RED with `cr07-buy002-wrong-retry-once.json`.
- **EXIT-002.**
  1. Both claims RED.
  2. Both FLIP with `cr07-exit002-correct-alert.json` (the start failure sends an alert naming the token as UNPROTECTED).
  3. `cr07-exit002-wrong-retry-once.json` (`queryPrice(...) ?? queryPrice(...)`): the persistent claim stays RED; the transient claim FLIPS, which is correct for a one-shot fault.

### CR-08: Signing census never judges "delegations": `sendTransaction` on a non-Signer type passes CI unlocked

**Fixer:** CI gates (fixer T); fixer's heading: "The signing census never judges "delegations""

**Files modified:** `scripts/check-signing-census.ts`, `scripts/signing-census-exceptions.json`, `test/unit/signingCensusGate.test.ts`
**Commit:** fef461d
**Applied fix:** A `sendTransaction`/`signTransaction` call on a receiver that is not a Signer (ethers' `ContractRunner`, `Pick<Wallet,'sendTransaction'>`, a local interface) used to become a `delegation` note that the gate never read. It is now a counted tx-signing site, `delegated.<name>`. Its lock is judged like any other site: unlocked or unknown fails the gate, locked passes.

I chose this over the review's suggested "type_unresolved, then allow-list the wrapper by receiver type". Lock status is what the gate protects, and a proven-locked delegation is safe whatever runs inside it. This needs no new exceptions schema, and any unlocked or unknown delegation still fails.

The real delegation `src/utils/txManager.ts:114` (MevStrategy) now reads **locked transitive** on all 4 chains (bot.ts:269, bot.ts:560, exitEngine.ts:790, exitEngine.ts:1534). The count goes 23 -> 24 with that one already-locked site, so the floor goes up to 24. The tokenSafety note now says the floor drops by one, 24 -> 23, when Phase 24 removes simulateSell. That note used to say 22, so Phase 24's plan should expect 23.
**RED test:** analysis cases delegated-runner, delegated-pick, delegated-local and delegated-locked, plus gate case `CR-08-delegated-send-outside-lock-fails` (a ContractRunner `sendTransaction!` in a script's main). Before: `SELF-TEST FAIL 5 of 59` (0 sites found; the gate case got `[]`, no problems). After: `SELF-TEST PASS 59 of 59`. Real gate: 24 sites, 0 problems.

### CR-09: Contract methods called through a value, `getFunction(...)` value or narrow-interface cast escape the census

**Fixer:** CI gates (fixer T); fixer's heading: "Contract methods called through a value, a getFunction value or a narrow-interface cast escape the census"

**Files modified:** `scripts/check-signing-census.ts`, `test/unit/signingCensusGate.test.ts`
**Commit:** 78e69b1
**Applied fix:**
- A const or const destructuring that holds a contract method (`c.m`, `c['m']`, `c.getFunction('m')`, `const { m } = c`) and is called in place, or used through `.send`, is traced back to its contract. It is then classified at the call like a direct call: a view is excluded, a provider runner is skipped, and the lock is judged.
- A method object that is handed on (passed as a callback, stored, returned) is a site where it is taken, with lock unknown, so it fails the gate.
- A call of a method object that is not typed through a Contract, or of a holder that cannot be traced, is an unresolved site.
- A call of an in-program interface signature with no body that returns a TransactionResponse (`new Contract(...) as unknown as IRouter`) is a site whose lock is judged.

**RED test:** analysis cases method-value-call, method-value-send, getfunction-value, destructured, method-value-view, method-callback and narrow-cast (plus method-callback-provider, which must find no site), and gate case `CR-09-method-value-outside-lock-fails` (the orchestrator's `const approve = token.approve; await approve(...)` reproduction). Before: `SELF-TEST FAIL 8 of 68`. After: PASS 68/68. On the real repo the change adds no site.

### CR-10: The seal verifier trusts a mutable, always-exempt seal record, so a one-line edit turns tampering into SEAL VALID

**Fixer:** recordings and seal verifier (fixer E); fixer's heading: "The seal verifier trusts a mutable, always-exempt seal record"

**Files modified:** `.planning/audit/tools/seal-verify.ts`
**Commit:** e748427
**Applied fix:** The seal record is now read from git, never from the working tree. The copy that gets judged is the one first committed in `sealed_sha..HEAD` (the anchor). It is found with `git log --reverse --topo-order --full-history --diff-merges=off --diff-filter=A`, so a side-branch add counts and a pull-request merge does not. The record must be added exactly once in that range, and HEAD's blob must be byte-identical to the anchor's (I chose a whole-record comparison, which is stricter than the listed-fields comparison the finding suggests). Any of the following is INVALID, and the reason names the fields that changed:
- a later edit to the record
- an uncommitted edit to the record
- a second add, including on a merged side branch
- a record not added after the revision it seals, which covers a moved `sealed_sha`

The scan record is read at HEAD, and an uncommitted edit to it is INVALID too. Some existing self-test cases checked the record's own rules (render, final_check, scan, successor linkage, scan substitution, reviewed hits) by editing the record after its first commit. Those cases now commit the wrong record as its first copy, so they still test those rules. The `base4` reviewed-hit fixture is rebuilt on `sealed2`.
**RED test:** 7 new self-test tamper cases: a later commit widens `exempt_paths` (Phase 22 record, and the successor with exactly the finding's scenario); `sealed_sha` moved forward; the record deleted and re-added; an uncommitted edit, for both records; a forged second copy merged from a side branch. **Before:** all 7 reported `VALID` (self-test `RESULT FAIL (7)`). **After:** all 7 INVALID with their reason; self-test 117 PASS at that commit, 135 PASS at the end.
**Existing records under the new tool:** I cloned the repo at c9262fa (before the tool edit was in its tree) and ran the new tool against the clone. `--seal .planning/audit/SEAL-23.json` reported `SEAL VALID` (changed after the seal: only `SEAL-23.json` and `phase-scan-23.json`). `SEAL.json` stays INVALID, but its reason is new: `.planning/audit/SEAL.json was not added after sealed_sha 1d1dd171: a seal record is committed once, after the revision it seals, and moving sealed_sha needs a new record`. This is the class of problem CR-10 describes: commit 28f8f5f re-pointed `sealed_sha` in place. The earlier reason was "changed after the seal and not exempt: ...".

### WR-01: Every mined transaction succeeds. Receipt status, estimateGas and eth_callBundle ignore the scenario's own revert rules

**Fixer:** real-path harness (fixer A); fixer's heading: "Every mined transaction succeeds — fixed OPT-IN ONLY; the default stays unfaithful"

**Update after the operator's ruling (supersedes "opt-in only" below):** the operator ruled "Fix it now". Realistic reverts are now the simulated chain's default (780d67d), bloxroute-full-sell's setup was repaired with its recording unchanged (11fcb3e), and AUD-TX-003 (354e2fc) and AUD-TX-029 (eb34470) were re-triaged on the realistic chain. Both bugs still hold; AUD-TX-029 holds in a narrower form under the renamed claim `sell-attempt-budget-reported-as-ceiling-hit`. The measurements are under "Operator ruling on WR-01" in the fixer notes below; the register changes are in 9863c09 and PN-002.

**Files modified:** `test/realpath/harness/chain.ts`, `test/realpath/harness/world.ts`, `test/realpath/harness.test.ts`
**Commit:** 5efe047
**Status:** fixed as opt-in. **The default behaviour is unchanged and still unfaithful. The operator needs to decide whether to change it.**

**Applied fix:** `FakeNode.enforceReverts(true)` gives the node one revert source. The read registered with `setRead` for a transaction's target and selector (the same read `eth_call` answers from) then also decides:
- **a mined transaction.** On a revert it mines with receipt status 0, pays gas only, sends no value, leaves no receipt logs and consumes its nonce. An explicit log given for a reverted transaction is a stray. Transactions in a block are evaluated in block order.
- **`eth_estimateGas`.** A revert returns code 3 with the read's revert data, or -32000 when there is no data.
- **`eth_callBundle`.** A revert is reported per transaction as `error: 'execution reverted', revert: <data>`, which is what the Flashbots library reads as `firstRevert`. This makes the bot's `D-SIMULATE-BEFORE-SUBMIT` gate reachable.

`FakeNode.succeeded(hash)` was added, and the scenario's `balanceOf` counts only buys that executed.

**Why the default stays off:** I measured with `enforceReverts` on by default, on the whole realpath project. Results files: `A-wr01.json`, and `A-exp-wr01-on.json` re-measured after WR-02. Both runs gave the same set of changes:

| Test | Baseline | Reverts on by default | Cause (traced with a temporary debug print of every revert) |
|---|---|---|---|
| AUD-TX-029 `attempt-budget-reported-as-ceiling-hit` | passed, knownBug recorded | **fails: "AUD-TX-029 now behaves correctly: remove this marker (it looks fixed)"**, knownBug record gone | `eth_callBundle swapExactETHForTokens → UniswapV2Router: EXPIRED` at fake time epoch+64 s. The escalation simulates the buy after its own `now+60` deadline (src/bot.ts:1045), so the bot's simulate gate refuses it and the run never reaches the ceiling-hit report. |
| AUD-TX-003 `antirug-exit-queued-behind-buy` | passed | **fails: "expected [ …(2) ] to have a length of 4 but got 2"** | Same cause: `eth_callBundle swapExactETHForTokens → UniswapV2Router: EXPIRED` at epoch+148 s, which cuts the private-attempt escalation short. |
| scenarios/otherRoutes `bloxroute-full-sell` (golden master) | passed | **fails: a stray "a log was given for 0xfc74…, which reverted in block 50000009"** | The scenario's own `installV2SellSimulation` read reverts the stop-loss sell at mine time (`TransferHelper: TRANSFER_FROM_FAILED`), and the scenario then passes a WETH log for that sell. |

- **What this means:** the AUD-TX-029 and AUD-TX-003 verdicts rely on the harness relay answering "success" for a simulation of an expired swap. A real relay would report a revert, and the bot would stop before the behaviour those claims record. This matches the review's premise for WR-01 and may change what those two findings prove. Per the instructions, I did not touch the triage tests or the default. **This is for the operator to decide.**
- **Default unchanged:** the new "by default (enforceReverts off) nothing changes" self-test pins the old default.

**RED self-tests** (three use `enforceReverts(true)`):
1. A buy mined after its deadline: status 0, gas paid, no value sent, nonce consumed, no tokens. As a control, one mined in time succeeds.
2. `eth_estimateGas` reverts with `UniswapV2Router: EXPIRED` data, and answers 150000 for a valid call.
3. The bot's Flashbots simulate gate is reachable end to end: the price moves between the bot's quote and its `eth_callBundle`, `firstRevert` is set, `flashbots.simulate.revert` is logged, and no bundle from that attempt is sent before the refusal.

**Before → after:** tests 1–3 failed before the fix (receipt `0x1`, estimate answered, simulate gate never hit). That was measured against the same assertions before the implementation existed. After the fix, all pass.

**Whole-project diff against the baseline (opt-in version):** no status or knownBugs change. Recordings are untouched.

### WR-02: The default scenario balance re-prices the bot's buys at current reserves and never subtracts a sell

**Fixer:** real-path harness (fixer A); fixer's heading: "The default scenario balance re-prices buys at current reserves and never subtracts a sell"

**Files modified:** `test/realpath/harness/chain.ts` (`FakeNode.onMined`), `test/realpath/harness/world.ts`, `test/realpath/harness.test.ts`
**Commit:** d169796

**Applied fix:**
- New hook `FakeNode.onMined(fn)`, called for each mined transaction in block order once its receipt is stored, with whether it executed.
- The scenario uses it to record each bot buy's output through the swap target at the reserves **when it was mined**.
- It also adds up the `amountIn` of each sell of the token through that target:
  - V2 `swapExactTokensForETH` and `swapExactTokensForETHSupportingFeeOnTransferTokens`;
  - V3 `exactInputSingle`, alone or inside either `multicall`.
- The wallet's `balanceOf` is `bought − sold`, floored at 0. A reverted transaction moves nothing.
- This is on by default: I measured that it keeps the baseline.

**RED self-test:**
1. A mined buy.
2. Liquidity is pulled to 5 percent on both reserves; the balance is unchanged.
3. A mined sell of half the position; the balance drops by exactly the amount sold.

**Before → after:** before the fix it failed at step 2 (`1917528945647574720160n` after the pull vs `1990031876438381866558n` bought). After the fix it passes.

**Whole-project diff against the baseline:** no status or knownBugs change. Recordings are untouched. That includes every golden-master scenario that sells and AUD-TX-028's `pullLiquidity` on the default read.

### WR-03: FakeWebSocket differs from ws@8.17.1 on every path where the socket is not OPEN

**Fixer:** real-path harness (fixer A)

**Files modified:** `test/realpath/harness/chain.ts`, `test/realpath/harness/world.ts` (teardown), `test/realpath/harness.test.ts`
**Commits:** 3c6da2b, b27e617

**Applied fix,** checked against `node_modules/ethers/node_modules/ws/lib/websocket.js` (8.17.1):
- **send and ping.** `send(data, options?, cb?)` and `ping(data?, mask?, cb?)` throw only while CONNECTING. On CLOSING or CLOSED the frame is dropped, and a callback, if given, receives the error on the next tick (`sendAfterClose`). On OPEN the callback also runs on the next tick, never inside the call. A request ethers writes to a dropped socket now hangs, as in production, instead of rejecting.
- **close or terminate while CONNECTING.** The socket goes to CLOSING at once. On the next tick it emits `'error'` ("WebSocket was closed before the connection was established") and then `'close'` 1006 (`abortHandshake`). An `onerror` attribute counts as a listener. With no listener at all, `emit('error')` throws, as ws's does.
- **Stalled handshakes.** `FakeNode.hangSocketOpens(on)` keeps new sockets in CONNECTING.
- **Timing (b27e617).** Server pushes from `mine()`/`emitLogs()` and the close from `dropSocket()` now arrive through `queueMicrotask` instead of synchronously inside the test's call. A dropped socket reads OPEN until its close arrives, as on ws. This is the "deliver as documented" option. I measured it separately: no status, knownBugs or recording change. The header now describes the real timing.
- **Harness-made closes.** These spots now listen for the `'error'` that their own close of a CONNECTING socket emits:
  - the seam probe in `installSeams`;
  - the seam self-check test;
  - scenario teardown (`stopGraphParts` adds a no-op error listener after `removeAllListeners`).
  
  Without this, the new `'error'` caused 3 unhandled errors in harness.test.ts (measured). Those closes are the harness's own, not the bot's.

**RED self-tests (5):**
1. send/ping on CONNECTING vs CLOSED, the `(data, options, cb)` signature, callback timing, and dropped frames reaching no node call.
2. close and terminate during CONNECTING: event order and timing, and the onerror attribute.
3. hangSocketOpens.
4. A subscription push from `mine()` arrives after `mine()` returns.
5. A real ethers `WebSocketProvider` whose socket the node dropped hangs on its next request (`expectStillPending` for 30 s).

**Before → after:** before the fix, 1–3 and 5 failed (ping on CONNECTING did not throw, close went straight to CLOSED, `hangSocketOpens` did not exist, the request rejected at once with "readyState 3"). Test 4 and the "reads OPEN until its close arrives" assertion failed against synchronous delivery. After the fix, all pass.

**Whole-project diff against the baseline (both commits):** no status or knownBugs change, recordings are untouched, and the log has 0 "Unhandled" errors.

### WR-04: An exception in an axios route handler is not a stray and reaches production as a network error

**Fixer:** real-path harness (fixer A); fixer's heading: "An exception in an axios route handler reaches production as a network error"

**Files modified:** `test/realpath/harness/world.ts`, `test/realpath/harness.test.ts`
**Commit:** 5ad8e70

**Applied fix:**
- `routeAxios` now catches a throwing route handler.
- It records a stray, `harness error answering axios <METHOD> <url>: <message>`, on the current node (or on the orphan list).
- It then rejects with an axios-shaped error: `isAxiosError`, `response.status` 500 and code `ERR_REALPATH_HARNESS`. This follows the JSON-RPC path's rule that a harness bug must not look like a node answer.

**RED self-tests:**
1. A `routeHttp` handler that throws, under a caller that swallows the error.
2. The scenario's own bloXroute route throwing on an unsigned transaction: `acceptRelayTransaction` is reached through a real `axios.post` to the bsc endpoint.

**Before → after:** before the fix, both failed (`isAxiosError` false, no stray). After the fix, both pass.

**Whole-project diff against the baseline:** no status or knownBugs change. Recordings are untouched.

### WR-05: The DB capture fails any write inside `db.transaction`, so a correct atomic-write fix fails its tests instead of reading "looks fixed"

**Fixer:** real-path harness (fixer A); fixer's heading: "The DB capture fails any write inside `db.transaction`"

**Files modified:** `test/realpath/harness/capture.ts`, `test/realpath/harness/chain.ts` (Violation type), `test/realpath/harnessCapture.test.ts`
**Commit:** e8738be

**Applied fix:**
- A row written while `db.inTransaction` is true is now held, not recorded.
- The capture trigger's second step stores a key for that row in a TEMP table on the same connection: `INSERT INTO __realpath_held (k) SELECT __realpath_held_take() WHERE __realpath_held_pending()`.
- TEMP tables take part in the connection's transaction, so the key survives exactly when the write does. That covers COMMIT, ROLLBACK, ROLLBACK TO a savepoint, and a failed statement undoing its own changes.
- Reading `timeline.entries` (now a getter) settles held rows:
  - a committed row joins the timeline at the position it was written (an ordinal splice, so the timeline is still in the order things happened);
  - a rolled-back row is dropped.
- `close()` on the connection settles first. A row whose transaction is still open when the connection closes becomes a `db-transaction-open` violation, which replaces `db-in-transaction`.
- It works for `db.transaction` functions made **before** the capture is installed, which is how a module-level transaction in `src/utils/db.ts` would be made. Wrapping `db.transaction` would miss those, because better-sqlite3 caches its BEGIN/COMMIT statements per connection.
- It also works for nested transactions and for raw `BEGIN` through `db.exec`.
- The TEMP table has no constraints, so an outer `INSERT OR …` clause can never make the harness step fail the production statement.
- Existing guarantees still hold:
  - the capture never throws into SQLite;
  - autocommit writes record exactly as before (`inTransaction: false`);
  - the production `RunResult` (`lastInsertRowid`, `changes`) is unchanged, which the tests assert.

**RED self-tests** (the old "a write inside db.transaction fails the test" case is replaced):
1. A committed transaction made before the capture: two writes with an op log between them are captured once each, at their write positions, with no violation, and `lastInsertRowid` is unchanged.
2. A transaction rolled back under a catch that swallows everything leaves no entry and no violation.
3. A nested transaction rolled back inside a committed one drops only its own write. Raw `BEGIN`/`COMMIT` and `BEGIN`/`ROLLBACK` through `db.exec` are judged the same way, and a write is not visible while its transaction is open.
4. A transaction still open when the connection closes is a violation naming the table, and its write is not on the timeline.

**Before → after:** before the fix, all 4 failed: the violation was raised, and a rolled-back row was on the timeline. This was verified by restoring the old `capture.ts`/`chain.ts` against the final test file. After the fix, all 4 pass.

**Whole-project diff against the baseline:** the only difference is the intentionally replaced self-test (MISSING) plus the 4 new ones. Statuses and knownBugs records are identical. `git status -- test/realpath/recordings` is empty.

### WR-06: restartGraph is not a process death. The old graph's error paths run with the database still open and log into the same scenario lists

**Fixer:** real-path harness (fixer A); fixer's heading: "restartGraph is not a process death"

**Files modified:** `test/realpath/harness/world.ts`, `test/realpath/harness/setup.ts`, `test/realpath/harness/chain.ts` (HarnessState `stoppingGraph`), `test/realpath/harnessRestart.test.ts`
**Commit:** c1aff81

**Applied fix:**
- restartGraph now fences the old graph **before** it releases held calls or destroys providers.
  - It closes the old graph's database first, so a write from an old catch path throws into that catch.
  - It sets `harnessState().stoppingGraph` for the whole stop. While it is set, the setup.ts logger, notifier and broadcaster mocks drop every call. Only the old graph runs during the stop: the test is awaiting restartGraph and no new graph exists yet.
  - After sockets close, it clears timers that a catch path set while the graph was stopping.
- dispose keeps its original order.

**Design change found by measurement:** my first version stamped each graph's logger with an "epoch". A probe showed that the `vi.mock` factories run **once per test file**, not once per `loadGraph` (`l1 === l2 === static import`). So no per-graph instance exists to fence, and the fence has to be the stop window.

**Limit, stated plainly:** once the new graph loads, a call cannot be attributed to a graph. Old-graph code still running at that point would record again. Nothing of the old graph is left to run by then: its timers are cleared, its providers destroyed and its sockets closed. Network calls the old graph makes during the stop (for example a relay call from a released catch path) are not fenced. No current test parks a call across a restart.

**RED self-test:** the old graph parks `eth_blockNumber`, and its catch path writes, logs, alerts, broadcasts and sets a retry timer. After restartGraph:
- the write threw "not open" and did not land;
- no log, timeline op, alert or broadcast from the old graph was recorded, and neither was "Database connection closed";
- the retry timer never fires;
- as a control, the new graph's logs, alerts and writes do record.

**Before → after:** before the fix it failed: the catch ran with the database still open. After the fix it passes. All 12 restartGraph users (ordering/boot, ordering/identity, AUD-ANTIRUG-018/025, AUD-BUY-001/002, AUD-DB-001 via its fixture, AUD-EXIT-013/015 and harnessRestart) keep their status.

**Whole-project diff against the baseline:** no status or knownBugs change. Recordings are untouched.

### WR-07: The AUD-ANTIRUG-002 boot claim reads "looks fixed" for a fix that never reconnects at boot

**Fixer:** triage tests (anti-rug, dashboard, DB, TX, scripts) (fixer B)

**Files modified:** `test/realpath/triage/fixtures/wsReconnectRefused.ts`, `test/realpath/triage/AUD-ANTIRUG-002.test.ts` (header text only)
**Commit:** 77c266e
**Applied fix:**
- Boot is held to the reconnect sites' outcome. `settled = chain.wsConnectedAfter(markAt, ...)` for every site; the `|| (site === 'boot' && state === '3')` branch is gone.
- In fault mode the port reopens 4 s after the refused boot connect, so only a bot that kept retrying holds an open connection by the end of the 12 s window.
- The healthy boot control still passes.
- No knownBug record field changed. For the boot claim only, `outcome: 'survived'` now also means "connected again".

Proofs (full specs with `childHook`; ack marker `child` was present on both mutant runs):
1. **Still RED today:** PASS. All four fault claims recorded `{outcome:'process-exited',exited:true,code:1,stderrSignal:'Error: connect ECONNREFUSED'}`. All 4 healthy controls and the contained control pass.
2. **Correct fix flips it:** mutant `wr07-boot-retry-correct` (src/utils/provider.ts getWsProvider). It adds an 'error' listener, and a failed connect stays in a 1 s/2 s/4 s backoff loop that builds the next provider. Result: the boot claim threw "looks fixed". The three reconnect-site claims still recorded, because their loops are not touched.
3. **Wrong fix does not:** mutant `wr07-boot-listener-only` (the review's shape: an error listener on the boot socket only). The boot claim failed with "the failure changed" (survived-work-pending). The **old** fixture read "looks fixed" under the same mutant.

### WR-08: AUD-ANTIRUG-018 reads "looks fixed" for a fix that jumps the cursor to the head and never scans the downtime gap

**Fixer:** triage tests (anti-rug, dashboard, DB, TX, scripts) (fixer B); fixer's heading: "AUD-ANTIRUG-018 reads "looks fixed" for a fix that jumps the cursor to the head"

**Files modified:** `test/realpath/triage/AUD-ANTIRUG-018.test.ts`
**Commit:** f11d64b
**Applied fix:**
- The tenth block of the 30-block downtime now carries a real signed LP transfer of the pair to an allowlisted locker, with its Transfer log.
- The evaluator judges that log with `antirug.allowlist-hit`, its cheapest verdict. That op is logged inside the evaluator, so it appears whether the gap is read by the live poll or by a backfill, and it changes nothing for the later pull.
- `gapLogEvaluated` was added to `actual`, `correct` and `observed`.
- Setup facts check that the log sits strictly inside the gap.

Proofs:
1. **Still RED today:** PASS. Recorded `{gapLogEvaluated:false,rugEvaluated:false,cursorReachedRugBlock:false,healthShown:'connected'}`.
2. **Correct fix flips it:** mutant `wr08-chunked-correct`: the poller reads its range through `getLogsForBackfill`, as recommended. Result: "looks fixed".
3. **Wrong fix does not:** the review's two shapes.
   - `wr08-jump-at-start`: the cursor is seeded at the head, ignoring the stored row, and the row is written. Result: "the failure changed".
   - `wr08-skip-wide-gap`: a gap wider than `backfillCapBlocks` moves the cursor next to the head. Result: "the failure changed".
   - The **old** test (no downtime log) read "looks fixed" under both. So under these mutants the new actual is `{gapLogEvaluated:false, rugEvaluated:true, cursorReachedRugBlock:true, healthShown:'connected'}`. That is inferred: the old claim's three fields equal `correct`.

### WR-09: AUD-ANTIRUG-003 and AUD-ANTIRUG-004 wait for one exit-fired broadcast per dispatch log, so a dedupe-shaped fix stalls them

**Fixer:** triage tests (anti-rug, dashboard, DB, TX, scripts) (fixer B); fixer's heading: "AUD-ANTIRUG-003 and -004 stall under a dedupe-shaped fix"

**Files modified:** `test/realpath/triage/AUD-ANTIRUG-003.test.ts`, `test/realpath/triage/AUD-ANTIRUG-004.test.ts`, `test/realpath/triage/fixtures/AUD-ANTIRUG-003-live.ts`
**Commit:** 7f53d52
**Applied fix:**
- New fixture helper `noExitInFlight(sc)`. It tries the token's real sell lock through `exitManager.tryAcquireSellLock`, synchronously, and releases it at once.
- 003 waits for `buyRow.status === 'sold' && noExitInFlight(sc)`, then 1 s of fake time so every count of a returned exit has landed.
- 004's setup waits for the refusal fault to fire, at least one exit-fired broadcast, and `noExitInFlight(sc)`.
- Neither wait matches broadcasts to dispatch logs any more.
- No knownBug record changed. AUD-ANTIRUG-005, which shares the fixture, re-ran green.

Proofs:
1. **Still RED today:** 003 PASS, recorded `{triggersCountedForOneRug:3,breakerTripped:true}`. 004 PASS, recorded `{escapeDispatchedAgain:false}`.
2. **Correct fix flips it:**
   - 003 under `wr09-003-dedupe` (the review's shape, placed after the dispatch log: an in-flight duplicate returns false with no broadcast and no count) read "looks fixed". The **old** 003 stalled under it: "driveChain: ... did not happen within 600000 virtual ms".
   - 004 under its own recommended fix `wr09-004-retry` (a false escape on a still-registered position schedules a new confirm gate) read "looks fixed".
3. **Wrong/partial fix does not:**
   - 003 under `wr09-003-dedupe-still-counts` (dedupe, but each refused duplicate still counts) recorded the bug `{3,true}`, then failed one post-marker detail. That failure is expected: the duplicates no longer broadcast.
   - Cross-finding: 004 under the AUD-ANTIRUG-003 fix `wr09-003-dedupe` no longer stalls and records its own bug `{escapeDispatchedAgain:false}`. The **old** 004 stalled in setup: "stepUntilTrue: the anti-rug exits returning did not hold within 20000 virtual ms".

### WR-10: AUD-SCRIPTS-002 builds `correct` from `actual`, so a signing script that drops out of detection can read "looks fixed"

**Fixer:** triage tests (anti-rug, dashboard, DB, TX, scripts) (fixer B); fixer's heading: "AUD-SCRIPTS-002 builds `correct` from `actual`"

**Files modified:** `test/realpath/triage/AUD-SCRIPTS-002.test.ts`
**Commit:** e218bbb
**Applied fix:**
- `correct` is pinned to `sortRows(expectedScripts → { holds-lock, pauseRead: true })`, where `expectedScripts` is the two live names from `LIVE_OBSERVED` plus each legacy name whose file was walked.
- Before the marker, two setup facts that hold under the bug and every fix:
  - each live script is walked;
  - each expected script still has at least one detected signing point.
- A lost detection therefore fails loudly instead of shrinking the rows. A new signing script outside the named set makes `actual` longer than `correct`, so it reads "the failure changed", never "looks fixed".
- The stored `expected` value is unchanged today (same four rows).

Mutant mechanism, stated plainly:
- The scripts are read only through the TypeScript compiler API in the Vitest worker, and a full fix touches four scripts. A single-file overlay cannot express that.
- Each AUD-SCRIPTS-002 mutant is therefore a worker hook. It wraps `fs.readFileSync` for up to four script paths, applies each edit with the overlay's own `applyEdits` (each find exactly once, else throw), and drops one ack marker per overlaid file.
- `CSB_MUTANT_SPEC` names the first file and carries that hook as `workerHook`.
- Nothing under the repo is written.
- The hook-writing script is `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/specs/mk-wr10.cjs`; it pre-checks every find against the files on disk, read-only.
- Fix edit, per script: add `import { acquireProcessLock, defaultLockDir } from '../src/utils/processLock'; import { getPauseState } from '../src/utils/db';` before its first `import { ethers } ...` line. Then, right after `async function main(...) {`, add `acquireProcessLock(defaultLockDir(), process.env.BOT_WALLET_ADDRESS ?? ''); if (getPauseState.get().paused) return;`.

Proofs:
1. **Still RED today:** PASS. Recorded the four `{lock:'none',pauseRead:false}` rows. The classifier-cases test passes.
2. **Correct fix flips it:** `wr10-all-hold-lock` (all four signing scripts hold the lock and read the pause switch). Result: "looks fixed". Ack markers were present for all 4 files.
3. **Wrong fix does not:**
   - `wr10-detection-lost` (the review's scenario: recover-sell-ladys and both legacy scripts fixed, deliberate-buy unfixed and reaching `executeDeliberateBuy` through `require('../src/bot') as any`) failed loudly before the marker: "deliberate-buy still has a detected signing point: expected 0 to be greater than 0". The **old** test read "looks fixed" under it.
   - Partial `wr10-live-only` (the legacy scripts still exist unfixed) gave "the failure changed".

### WR-11: AUD-BUY-002 claim `failed-row-not-resumed-after-restart` has bug-encoding plain expects before its marker

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "AUD-BUY-002 restart claim has bug-encoding expects before its marker"

**Files modified:** `test/realpath/triage/AUD-BUY-002.test.ts`
**Commit:** 0f7e697
**Applied fix:** Both "nothing resumed" expects moved after the `failed-row-not-resumed-after-restart` marker. `actual.resumedAfterRestart` now also counts the `exit.monitor.resumed` op.
**Proof:**
1. RED.
2. A resume fix FLIPS. `wr11-resume-failed-held.json`: `getResumeExitMonitorTrades` in `src/utils/db.ts` also selects `failed` buys.
3. No "wrong fix" applies to this finding. Measured for the record: the pre-WR-11 test also read "looks fixed" under this mutant, because this resume shape has no exit_state row and logs "Created fresh exit state", not `exit.monitor.resumed`. The plain expects pre-empted the marker only for a resume of a position whose exit_state row exists. The reorder removes that pre-emption by construction.

### WR-12: AUD-BUY-004's completion predicate times out for any fix that refuses the second handler after "New pair detected"

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "AUD-BUY-004 times out for a fix that refuses after "New pair detected""

**Files modified:** `test/realpath/triage/AUD-BUY-004.test.ts`
**Commit:** 13de3c5
**Applied fix:**
- `done = secondSettled && finishedBuys >= 1`. A refused second handler now counts as finished.
- `settleAntiRugArming` waits for the bundles actually submitted, not for `passedCheck`.
**Proof:**
1. RED (`{buysLanded: 2}`).
2. FLIPS (instead of a 600 s driveChain timeout). `wr12-claim-set-after-log.json`: a claim set placed after the "New pair detected" log in `src/bot.ts`.
3. N/A: the finding is a false stall, and today's code is the non-fix.

### WR-13: "Any floor above zero" accepts a dust floor as fixed (AUD-BUY-003, AUD-EXIT-001)

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "Any floor above zero accepts a dust floor as fixed (AUD-BUY-003, AUD-EXIT-001)"

**Files modified:** `test/realpath/triage/AUD-BUY-003.test.ts`, `test/realpath/triage/AUD-EXIT-001.test.ts`
**Commit:** 3c4e9f0
**Applied fix:** The floor must be at least `quote * 95 / 100`. The quote is the router's own answer (`v2AmountOut` / `v3AmountOut`) at the reserves of the moment. For BUY-003 that is the launch reserves. For EXIT-001 it is the reserves captured right after the other wallet's trade, before any sell by the bot. 95 percent is the configured 5 percent slippage that `computePublicMinOut` and the buy formula both keep. BUY-003 still accepts "no swap sent" as correct.
**Proof:**
- **BUY-003.**
  1. RED.
  2. FLIPS with `cr07-buy003-correct-skip.json`.
  3. With `wr13-buy003-wrong-dust-floor.json` (minOut = 1n in the catch): RECORDS + detail fails (the decoded amountOutMin `1n` against the asserted `0n`).
- **EXIT-001.**
  1. All four claims RED.
  2. All four FLIP with `wr13-exit001-correct-fresh-quote.json`. In `src/exitEngine.ts`, `buildV2SellTx` and `buildV3SellTx` take the chain's HTTP provider and set `computePublicMinOut(fresh router or QuoterV2 quote, 5)`.
  3. With `wr13-exit001-wrong-dust-floor.json` (floor 1): RECORDS + detail fails, on all four.

### WR-14: AUD-BUY-028 reads "looks fixed" when any gate refuses, not just the lock gate

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "AUD-BUY-028 reads "looks fixed" when any gate refuses"

**Files modified:** `test/realpath/triage/AUD-BUY-028.test.ts`
**Commit:** cabc6f9
**Applied fix:** `actual = { lockedShareOfLpPct, lockGatePassed, otherGatesPassed, buySubmitted }`:
- `lockGatePassed` is `checks.locked` on the "Safety checks failed, skipping" line. It is true when the bot bought, and null when neither happened.
- `otherGatesPassed` requires every other check on that line to pass.

Correct is `{1, false, true, false}`.
**Proof:**
1. RED on both claims.
2. Correct fixes FLIP their own claim:
   - `wr14-unicrypt-correct-half-lp.json` flips the unicrypt claim; the mudra claim stays RED.
   - `wr14-mudra-correct-half-lp.json` flips the mudra claim; the unicrypt claim stays RED.
   - In each, the active locks must cover at least half of the pair's `totalSupply`.
3. Wrong fix is CHANGED on both claims. `wr14-wrong-other-gate-refuses.json`: the max-tx / max-wallet gate fails closed in `src/bot.ts`.

### WR-15: AUD-EXIT-002 and AUD-BUY-002 count an exit_state row, or any matching alert anywhere in the run, as "protected"

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "AUD-EXIT-002 and AUD-BUY-002 count an exit_state row, or any alert, as protected"

**Files modified:** `test/realpath/triage/AUD-EXIT-002.test.ts`, `test/realpath/triage/AUD-BUY-002.test.ts`
**Commit:** 87b29ca
**Applied fix:**
- EXIT-002: `protectedOrOperatorTold = timer || unprotectedAlert`. The alert must be sent since the buy and must name the token address or RPLT.
- BUY-002 claim 1: `monitored = hasExitMonitorTimer`.
- BUY-002's handler-finish wait is now a bounded window. A fix that ends with no alert and no monitor then reads CHANGED instead of stalling.
**Proof:**
- **EXIT-002.**
  1. Both claims RED.
  2. Both FLIP with `cr07-exit002-correct-alert.json`.
  3. Wrong fixes:
     - `wr15-exit002-wrong-row-no-timer.json` (an exit_state row is persisted above the null return, and the return is kept): RECORDS + detail fails (the "no exit_state row" detail names the row).
     - `wr15-exit002-wrong-unrelated-alert.json` (the gap alert gains "positions on this chain are UNMONITORED"): RED.
- **BUY-002.**
  1. RED.
  2. FLIPS with `cr07-buy002-correct-retry-until-answer.json`.
  3. Wrong fix is CHANGED. `wr15-buy002-wrong-row-no-timer.json`: on a failed balanceOf, the row is kept pending, no alert is sent, and an exit_state row is inserted with nothing armed.

### WR-16: AUD-EXIT-003 markers can be flipped by wrong fixes

**Fixer:** triage tests (buy, exit) (fixer C)

**Files modified:** `test/realpath/triage/AUD-EXIT-003.test.ts`
**Commit:** 39f93b8
**Applied fix:**
- Claim 1 now measures `exitPriceFitsPosition`: every exit quote's amountIn lies between 1 and 100 percent of the position, or, with no exit quote at all, the pair's `getReserves` is read during the window.
- The zero-entry claims add `stillProtected`: a live timer, or an unprotected-position alert naming the token.
- The "fixed probe" facts moved to after the marker.
**Proof:**
1. All four claims RED.
2. Correct fixes:
   - `wr16-probe-correct-position-sized.json` (the V2 probe is 2 percent of the wallet's balance) FLIPS claim 1 and both zero-entry claims, because a position-sized probe never quotes 0.
   - `wr16-zero-entry-correct-reject-and-alert.json` (a 0 entry is rejected, and an alert names the token as UNPROTECTED) FLIPS both zero-entry claims.
3. Wrong fixes:
   - `wr16-probe-wrong-parseunits-decimals.json` (the probe is `buyAmountWei / 10^(18 - decimals)`): claim 1 RECORDS + detail fails.
   - `wr16-zero-entry-wrong-treat-as-null.json` (a 0 entry is treated like null: log and return): both zero-entry claims are CHANGED.

### WR-17: AUD-EXIT-014 defines "not refused at once" as "no broadcast within 2 s of virtual time"

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "AUD-EXIT-014 defines "not refused" as "no broadcast within 2 s""

**Files modified:** `test/realpath/triage/AUD-EXIT-014.test.ts`
**Commit:** 20896a1
**Applied fix:**
- The marker now measures the outcome, `{ antiRugExitSucceeded }`. The routine exit's simulation is released, and the chain is driven until the position is sold and the anti-rug exit has broadcast its result. Succeeded means `success: true`, or a sell submitted with reason anti-rug.
- "Refused at once" (a success:false broadcast within 2 s while the routine exit was parked) is kept as a fact asserted after the marker. It is not in the marker, because queue-and-retry, one of the card's shapes, may refuse first and still succeed.
- All facts from the 2 s mark are captured before the release and asserted after the marker.

This deviates from the review's wording, which said to keep "refused at once" inside `actual`; the reason is given just above.
**Proof:**
1. RED (`{antiRugExitSucceeded: false}`).
2. Correct fix FLIPS. `wr17-correct-queue-and-retry.json`: in `src/anti-rug/exitTrigger.ts`, when the exit returns false and the sell lock is held, it waits for the lock and runs `executeFullSell` again.
3. Wrong fix stays RED. `wr17-wrong-wait-3s-then-refuse.json`: wait 3 s for the lock, then refuse.

Also measured (see Proposals): `wr17-correct-antirug-waits-for-lock.json` (a plain wait-for-the-lock inside `executeFullSell`) and `wr17-correct-antirug-preempts.json` (anti-rug ignores the sell lock) both stay RED. They hit the 60 s anti-rug watchdog, because the in-flight routine exit holds the sell lock and the nonce lock for about 76 s. The old header said a wait-for-the-lock fix reads "looks fixed". It did, but only under the 2 s timing measure.

### WR-18: AUD-BUY-001 can record the bug as still present under a correct fix (51 s window and clock skew)

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "AUD-BUY-001 can record the bug under a correct fix (51 s window, clock skew)"

**Files modified:** `test/realpath/triage/AUD-BUY-001.test.ts`
**Commit:** 65996e0
**Applied fix:**
- Before the observation, the parent's fake clock moves past the child's last pino `time` (isoTime, real clock), plus 1 s.
- The observation is now `stepUntilOrFor(monitored && antiRugHeld, 5 min, 250 ms)`.
- The test limit is now 150 s.
**Proof:**
1. RED.
2. Correct fix FLIPS on `monitor-dies-with-script`, followed by the allowance stray that the header already documents. `wr18-rescan-60s-age-guard.json`: the running bot re-scans unmonitored pending buys every 60 s, adopting only rows at least 30 s old by `trades.timestamp` (`src/bot.ts`).
3. The finding was confirmed real: the same mutant against the pre-WR-18 test recorded the bug, so the correct fix read as still broken.

### WR-19: Plain expectations about other findings make these tests fail when those findings are fixed

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "Plain expectations about other findings (AUD-EXIT-002, AUD-BUY-001)"

**Files modified:** `test/realpath/triage/AUD-EXIT-002.test.ts`, `test/realpath/triage/AUD-BUY-001.test.ts`
**Commit:** 2bd19d8
**Applied fix:**
- EXIT-002 leaves the AUD-ANTIRUG-024 gap line out of its error-line comparison.
- BUY-001 drops `resubscribes === 2` and the exact-count unsubscribe wait. It asserts at least one `antirug.listener.subscribed` and drains for a fixed 5 s.
**Proof** (each other finding's fix applied as a mutant):
- `wr19-antirug024-seed-zero.json` (in `src/anti-rug/detector.ts`, `last_seen_block === 0` takes the seed path): the new EXIT-002 passes with both claims recorded. The old EXIT-002 failed both tests on the error-line array.
- `wr19-antirug025-skip-unchanged.json` (in `src/anti-rug/detector.ts`, an unchanged re-subscribe is skipped): the new BUY-001 passes with both claims recorded. The old BUY-001 failed with "expected 1 to be 2".

### WR-20: The AUD-BUY-011 dashboard fixture races for its port and never checks it reached its own server

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "The AUD-BUY-011 dashboard fixture races for its port"

**Files modified:** `test/realpath/triage/fixtures/AUD-BUY-011-dashboard.ts`, `test/realpath/triage/AUD-BUY-011.test.ts`, `test/realpath/triage/AUD-EXIT-007.test.ts`, `test/realpath/triage/AUD-EXIT-008.test.ts`
**Commit:** ad0be0c
**Applied fix:**
- `startDashboard` identifies the server its own `startApiServer` call bound, through `tracing:net.server.listen:asyncStart`. It attaches an `'error'` listener, checks the listen options, waits for the listen, and reads the port from that server's own `address()`.
- `DASHBOARD_PORT=0` is supported through the new export `LOOPBACK_DASHBOARD_ENV`. AUD-BUY-011, AUD-EXIT-007 and AUD-EXIT-008 now use port 0.
- `freeLoopbackPort` stays exported for fixer B's `AUD-API-001-dashboard-sell.ts` and is documented as racy. Its fixed-port path is now checked against the bound server.

**Proof:** a temporary demo test (created, run, deleted; never committed):
- With a fixed port already held by another HTTP server, the new fixture throws "startDashboard: the API server could not listen on 127.0.0.1:N: listen EADDRINUSE ...".
- The old fixture produced an unhandled `EADDRINUSE` error in the worker.
- With port 0, the new fixture binds an OS port and logs in to its own server.
- AUD-BUY-011, AUD-EXIT-007, AUD-EXIT-008 and fixer B's AUD-API-001 all pass (10 of 10).

### WR-21: AUD-BUY-005 proves one call site; a `.catch` there flips the finding while the other un-awaited sites still crash

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "AUD-BUY-005 proves only the V3 listener call site"

**Files modified:** `test/realpath/triage/AUD-BUY-005.test.ts`, `test/realpath/triage/fixtures/unhandledRejectionCrash.ts`
**Commit:** bdffca6
**Applied fix:** A new claim, `v2-listener-unhandled-rejection-exits`, with a healthy control and a contained control. The fixture takes a second argument, `v2`, which runs `mainV2`:
- It arms the real V2 WebSocket listener.
- For fault and contained, it closes the bot's database with the bot's own `closeDb()` before the push. The handler's first statement, `isTokenSniped.get`, then throws "The database connection is not open" before its try.
- Healthy keeps the database open and pre-records both tokens with the real `insertTrade`, so the same statement answers "Already sniped token" for both pairs.
- The loopback chain answers no `eth_getCode`, so the handler's later reads cannot be used as the "work settled" signal. The second push reaching the subscription is that signal, and the parent reads each pair's handling from the child's log lines.
**Proof** (child reach confirmed):
1. Both fault claims RED; the controls pass.
2. Correct fix FLIPS both fault claims. `wr21-correct-global-handler.json`: `process.on('unhandledRejection')` installed when `src/bot.ts` loads.
3. Wrong fix: `wr21-wrong-v3-catch-only.json` adds a `.catch` only at the V3 listener call. The V3 claim FLIPS, the V3 contained control reports "looks fixed", and the V2 claim stays RED, so the finding does not read fixed.

### WR-22: AUD-BUY-027 proves only the V2 path; the V3 pool path has the same non-native selection

**Fixer:** triage tests (buy, exit) (fixer C); fixer's heading: "AUD-BUY-027 proves only the V2 path"

**Files modified:** `test/realpath/triage/AUD-BUY-027.test.ts`
**Commit:** 24185ab
**Applied fix:** A new claim, `non-native-v3-pool-processed`. An A/B V3 pool is launched through a real signed NPM `multicall(createAndInitializePoolIfNecessary, mint)` at its real CREATE2 address, mined with the factory's PoolCreated and the pool's Mint in one block, through the real V3 listener. The measure is `{processedAsSnipe ("New V3 pool detected" for that pool), buySubmitted}`.
**Proof:**
1. RED (`{true, true}`).
2. Correct fix FLIPS both claims. `wr22-correct-both-paths.json`: a "no WETH side, skip" guard in both the V2 and the V3 handler.
3. Wrong fix: `wr22-wrong-v2-only.json` adds the guard to the V2 handler only. The V2 claim FLIPS; the V3 claim stays RED.

### WR-23: Census name lists miss other ethers signing APIs and indirect calls

**Fixer:** CI gates (fixer T); fixer's heading: "The census name lists miss other ethers signing APIs and indirect calls"

**Files modified:** `scripts/check-signing-census.ts`, `test/unit/signingCensusGate.test.ts`
**Commit:** 1b008b6
**Applied fix:**
- `sendUncheckedTransaction` is now a signing name, like `sendTransaction`.
- `authorize` / `authorizeSync` count on a Signer receiver only. ethers 6.16 has no `signAuthorization`; these are its EIP-7702 names, and they are common names elsewhere, hence Signer only.
- `f.call` / `f.apply` of a signing method or contract method is classified as f itself. This applies only to Function.prototype's call/apply, so `provider.call` is unaffected.
- A signing method taken as a value (`.bind`, a callback) is a site with lock unknown.
- `SigningKey.sign` and `provider.send('eth_sendTransaction'|'eth_sendRawTransaction')` are sites with lock unknown.
- A call on an any-typed receiver that traces to `new Contract(...)` counts whatever the method name.

**Deviation:** the review's literal rule was "any receiver in a file that imports Contract is unresolved". I tried it first. It flagged 26 non-signing calls in src/ (`toString`, `wait`, `on`, `some` on any values), which would all fail CI as unknown-lock. Tracing the any receiver back to its construction closes the artifact-ABI case without those false failures.
**RED test:** ten analysis cases (unchecked, authorize, fn-call, fn-apply, fn-bind, method-fn-call, signing-key, rpc-send-raw, any-artifact, plus rpc-send-read, which must find no site) and gate case `WR-23-unchecked-send-outside-lock-fails`. Before: `SELF-TEST FAIL 10 of 79`. With the any-trace branch turned off: `FAIL 2 of 80` (any-artifact, any-artifact-param). After: PASS. On the real repo the change adds no site.

### WR-24: Lock key is never tied to the signer, and any function named `withNonceLock` counts as the lock

**Fixer:** CI gates (fixer T); fixer's heading: "The lock key is never tied to the signer, and any function named withNonceLock counts as the lock"

**Files modified:** `scripts/check-signing-census.ts`, `scripts/signing-census-exceptions.json`, `test/unit/signingCensusGate.test.ts`
**Commits:** 4971884 (part 1, fix23-T); a17cdf6 (dead-code class) and 92a975c (part 2, lock-key tie), both on fix23-T2
**Operator ruling (2026-11-12, on the first-pass escalation):** turn on part 2 now, together with a new narrow census rule for dead code, so the check guards Phase 24's new signing code.

**Part 1 (4971884):** `isLockCall` now accepts only the `withNonceLock` declared, with a body, in `src/utils/nonceAuthority.ts`. A script's local no-op namesake is followed like any other callee. RED: gate case `WR-24-local-withNonceLock-is-not-the-lock-fails` reported 0 problems before and surplus-unlocked after.

**Dead-code class (a17cdf6):** The `excluded` list cannot hold maybeApproveForChain's approve: it accepts only calls whose ABI the census cannot read, and `approve` is readable. So `scripts/signing-census-exceptions.json` gains a `dead` class. Each row is `file | function | call` plus `count`, `finding_id` and `reason`, where `function` is the outermost function holding the site. The census proves each row or reports a problem:
- **dead-unprovable:** the function is not a module-level function declaration or const function.
- **dead-reachable:** the function has an export modifier, or any reference anywhere in the program. References are found with the same findReferences machinery the lock check uses, so an export list, `export default`, `module.exports` or a call each counts.
- **finding-not-found / dead-finding-does-not-name:** the finding record is missing, or its `recommendation` does not both say delete/remove and name the function.
- **stale-dead:** the site or function is gone. Phase 24 must remove the row when it deletes the function.
- **dead-count:** the count differs.

A refused row leaves its sites judged like any other site.

**Floor decision:** a dead site is neither locked nor unlocked, but it **counts toward the floor**. It is still a signing call in the code. This keeps the floor at 24, so the `--check-floor-history` trail is unchanged and passes. It also means the commit that deletes the function must lower the floor and name AUD-BUY-007 (AC-34), while stale-dead forces the row out in that same commit. The gate line now reports `dead N`.

The one row is `src/bot.ts | maybeApproveForChain | contract.approve`, count 1, AUD-BUY-007. Its recommendation reads: "Delete simulateSell, its import at bot.ts:17 and maybeApproveForChain (no caller, so no behaviour change)."

**Part 2, the lock-key tie (92a975c):** this is the change withheld in the first pass. For each site the chains read as locked, the census carries the site's signer up the same chains, re-expressed in each caller's scope through parameters and const initializers, until it reaches a `withNonceLock` whose key is `<signer>.address`. Otherwise the site reads unknown. Sends of transactions signed at another counted site are not key-checked. Real repo:
- bot.ts:749, exitEngine.ts:423/546/555, bloxroute.ts:128, flashbots.ts:232/263, passthrough.ts:130 and txManager.ts:114 all tie to `ctx.wallet` / `wallet`.
- flashbots.ts:305 `rawSendBundle` is n/a (presigned).
- bot.ts:228 reads unknown, and its dead row covers it.

The patch was applied in wt-T2 after the dead-class commit, so every commit leaves CI green. Both changes insert a section at the same place, so the one merge conflict was resolved by keeping both sections whole.

**RED tests:**
- **Dead class:** these gate cases failed before the class existed (they got bad-exceptions-file instead of their codes) and pass after: an exported function, a function in an export list, a function with a caller, a removed function (stale-dead), a differing count, a finding that does not name the function, and a class method (dead-unprovable). The module.exports case was added with them. The passing case checks 24 sites, 1 dead and 0 unknown; the baseline without a row gives unknown-lock.
- **Key tie (kept from the first pass):** wrong-key, mapped-key-mismatch and contract-key-wrong read locked before and unknown after. `WR-24-lock-keyed-on-another-wallet-fails` passed silently before and fails after.
- Self-test: PASS 99/99 (59 analysis + 40 gate).

### WR-25: Census scans only `.ts`/`.tsx`; `.mts`, `.cts`, `.js`, `.cjs`, `.mjs` under `src/` and `scripts/` escape, and the completeness check cannot see them

**Fixer:** CI gates (fixer T); fixer's heading: "The census scans only .ts/.tsx"

**Files modified:** `scripts/check-signing-census.ts`, `test/unit/signingCensusGate.test.ts`
**Commit:** 7d6587b
**Applied fix:** The census program is now built with allowJs (checkJs off). The scripts/ walk and the file-not-audited check cover `.ts .tsx .mts .cts .js .jsx .mjs .cjs`, without declaration files. JavaScript signing sites are now classified and lock-judged.
**RED test:** gate cases `WR-25-signing-cjs-and-mts-scripts-fail` (a signing `scripts/rescue.cjs` and `scripts/rescue2.mts`) and `WR-25-js-file-outside-tsconfig-include-fails`. Before: both reported no problems. After: they fail with surplus-unlocked and file-not-audited, as expected. Real repo: `scripts/in-memory-mutant-overlay.cjs` joins the program (scripts 28 -> 29) and adds no site.

### WR-26: Real-path mock gate only reads files under `test/realpath/`, but real-path tests run code from outside that folder

**Fixer:** CI gates (fixer T); fixer's heading: "The real-path mock gate reads only test/realpath/"

**Files modified:** `scripts/check-realpath-mocks.ts`, `test/unit/realpathMockGate.test.ts`
**Commits:** 421d4d4 (precondition), 5d6a48c (the fix)
**Applied fix:** The gate now also scans every module that the root files and the realpath `setupFiles` reach through imports (import/export from, import = require, `require('lit')`, `import('lit')`), transitively, outside node_modules and src/.

It also reads `vitest.config.ts` as an AST. The realpath project's `resolve.alias` must be exactly the one ethers CommonJS entry. Any other alias entry, any other resolve key, a `test.alias`, a root `resolve.alias` or `test.alias` (inherited through extends: true), or a `plugins` key is a violation. A config that cannot be read as literals fails closed. `--config <file>` checks another config; `--root` alone reads no config.

Precondition commit 421d4d4: `canonical()` now uses `fs.realpathSync.native`. In this worktree the junctioned node_modules made the self-test case allowed-mock-passes report axios as `forbidden-mock`, so the self-test ran 21/22 and `npm run test:unit` failed before any change of mine. A normal checkout is not affected. After the change: 22/22.
**RED test:** three new tests.
- A `vi.doMock` of src/utils/db in a `test/helpers/prep.ts` that a real-path test imports. Before: exit 0. Expected: 1.
- A setup-file mock plus a second alias entry. Before: usage error, exit 2. Expected: 1, with forbidden-mock and config-alias.
- The real-config test. Before: `checkVitestConfig is not a function`.

All pass after the fix. Real repo: 108 files, 4 of them reached from outside test/realpath (`test/rails/setup.cjs`, `core.cjs`, `spawnRailedChild.ts`, `test/helpers/sourceGraph.ts`), config checked, 0 violations.

### WR-27: Commit taxonomy lets a merge commit carry any recording edit, with exit 0

**Fixer:** CI gates (fixer T); fixer's heading: "The commit taxonomy lets a merge commit carry any recording edit, with exit 0"

**Files modified:** `scripts/check-commit-taxonomy.ts`, `test/unit/commitTaxonomyGate.test.ts`
**Commit:** eeb5a56
**Applied fix:** A merge whose own result changes paths under the recordings folder (the paths `git diff-tree --cc` lists) is now judged like a non-merge commit for those paths. It needs a `behavior:` subject, and the IDs it cites must exist in its own tree. A clean merge is still not judged, and its inner commits still are. The WARN line and `Judgement.warnings` are removed, and the summary now says how many merges were judged.

This replaces the documented AC-42 "warns and exits 0" outcome. It was a locked decision, so you may want to confirm the change.
**RED test:** self-test cases `WR-27-a-merge-whose-conflict-resolution-alone-changes-a-recording-fails`, `WR-27-a-no-conflict-merge-that-edits-a-recording-fails` (the review's `merge --no-commit` input) and `WR-27-a-behavior-merge-citing-an-unknown-id-fails`. Before: `SELF-TEST FAIL 3 of 30` (no violation, exit 0). After: PASS 30/30. The passing counterpart is `WR-27-a-merge-resolution-as-behavior-citing-a-real-id-passes`. The old `AC-42-...-warns-and-exits-0` case pinned the bypass and is replaced. The CI comment was updated in a479dd1.

### WR-28: Recordings-compared counts any `compareRecording` call, even one whose mismatch is caught

**Fixer:** recordings and seal verifier (fixer E); fixer's heading: "Recordings-compared counts any `compareRecording` call"

**Files modified:** `test/realpath/harness/serializer.ts`, `scripts/check-recordings-compared.ts`, `test/unit/recordingsComparedGate.test.ts`
**Commit:** 603e637
**Applied fix:**
- The serializer records once the compare has decided, on every way out (`try/finally`): `{"path":...,"result":"match"|"written"|"differs"|"absent"|"error"}`. A mismatch the caller catches is still a `differs` in the run's record.
- The gate counts a tracked recording as compared only on a `match`. It fails on any other recorded outcome, naming the path and the outcome in a DIFFERS, ABSENT, WRITTEN or ERROR line. I chose to fail on `written` even outside CI: a re-record run does not verify the committed bytes.
- A bare-path record line (the format before this change), a line without a result, a line with an unknown result, or a line with an extra key is a broken record and exits 2.
- The gate also prints an outcome tally and the number of tracked recordings matched.
- Compare and write results are unchanged.
**RED test:** new self-test case `WR-28-a-mismatch-the-caller-catches-is-recorded-and-fails-here-naming-it`. It loads the real serializer in a git fixture, compares `a.jsonl`, swallows a mismatch on `b.jsonl`, and runs the gate on that run. **Before:** the gate passed (`expected exit 1, got 0`). **After:** exit 1 with `DIFFERS "b.jsonl"`. Two more cases cover a `differs`/`absent` outcome beside a match, and a `written`/`error` outcome. Self-test 19 of 19.
**Real-path proof:** the realpath scenario, env and guard tests passed (145 tests). The gate on that run passed with `outcomes: match 130, written 0, differs 0, absent 0, error 0; tracked recordings matched: 130 of 130`. The recordings were untouched.

### WR-29: Source-text gate misses `?raw` imports, `new URL(...)` paths and aliased read functions

**Fixer:** CI gates (fixer T); fixer's heading: "The source-text gate misses ?raw imports, new URL paths and aliased read functions"

**Files modified:** `test/unit/sourceTextGate.test.ts`
**Commit:** 7dd5c9e
**Applied fix:**
- Read functions are found through import aliases, destructuring, assigned copies, literal element access and `.bind`. For `.call`/`.apply`, the path argument is taken from its shifted position.
- let/var names carry every value assigned to them.
- `new URL(lit, ...)` is treated as `lit`.
- `require.resolve` / `import.meta.resolve` name the resolved module file.
- `..` is resolved (path.posix.normalize style) before the first segment is tested.
- A `?raw`/`?url` specifier (in an import, export-from, `import()` or `require()`) that resolves from the importing file to a path below top-level src/ or scripts/ is a named read.

**RED test:** a new temp-directory test with nine fail cases holding 16 named reads, plus a pass case. Before: 0 of 16 found. After: 16 of 16 found, the pass case stays clean, and the real test/ tree has no read outside the allow list.

### WR-30: No guard that every test file under `test/` belongs to a project CI runs

**Fixer:** CI gates (fixer T); fixer's heading: "No guard that every test file belongs to a project CI runs"

**Files modified:** `test/unit/vitestProjectCoverage.test.ts` (new)
**Commit:** 6cfe127
**Applied fix:** A new unit test lists every `*.test.*` / `*.spec.*` file under test/. It checks each one against the include and exclude globs of the loaded `vitest.config.ts` (unit, integration, realpath, fork) and requires exactly one match. The glob reader supports `**`, `*`, `?` and literal `{a,b}`, and throws on any other syntax.
**RED test:** I added a deliberately failing `test/scripts/zz-orphan.test.ts` and a `test/unit/zz-orphan.spec.ts`. `vitest run --project unit zz-orphan` reported "No test files found", so the failing test never ran, and the new test failed listing both files. With the two files removed it passes. Today's tree has 222 test files and no orphan.

### WR-31: CI jobs lack `timeout-minutes`; contract jobs install unpinned Python tools

**Fixer:** CI gates (fixer T); fixer's heading: "CI jobs lack timeout-minutes; the contract jobs install unpinned Python tools"

**Files modified:** `.github/workflows/test.yml`, `test/unit/ci/workflowLimits.test.ts` (new)
**Commit:** 5614afd
**Applied fix:**
- `test`: timeout-minutes 45. test:unit measured 71 to 74 s in this worktree, and the four self-test children allow 240 s each.
- `detect-contract-changes`: 5.
- `pip install slither-analyzer==0.11.6 solc-select==1.2.0` and `pip install mythril==0.24.8`.

I confirmed all three versions on PyPI on 2026-11-12. Each is the current release. slither 0.11.6 needs Python >= 3.10, and the job uses 3.11. crytic-compile 0.4.2 needs solc-select >= 1.0.4. The `pip install --upgrade pip` line is left as it was.
**RED test:** the new `workflowLimits.test.ts` failed on the old workflow: test and detect-contract-changes had no limit, solc-select was not pinned, and the others were unpinned. It passes after. No YAML parser is installed, so the YAML was checked by eye; the edits only add keys and comments at the existing indentation.

### WR-32: `--scan` still lists merges by first parent and ignores REVIEWED_HITS, so once the phase branch is merged, the record's own documented check reports INVALID

**Fixer:** recordings and seal verifier (fixer E); fixer's heading: "`--scan` lists merges by first parent and ignores REVIEWED_HITS"

**Files modified:** `.planning/audit/tools/seal-verify.ts`
**Commit:** b214c14
**Applied fix:**
- `--scan` has its own log options, `SCAN_LOG_OPTS = --full-history --diff-filter=tuxdb --diff-merges=remerge`. A merge is listed by what it wrote itself (its result compared with git's re-merge of its parents). So a clean pull-request merge adds nothing, the commits it brings in are each scanned, and a conflict resolution or an edit made during the merge is still scanned.
- New `mergeScanFixture()` proves those options on the real scanner. It checks four things: a key committed before the range and merged in later is not reported; a merged branch's own commit is reported; content written inside a merge is reported; a conflict resolution is reported. Redaction is checked too. The CLI `--scan` runs this fixture, and `rangeFixture` with the same options, before any real scan, and refuses if either fails.
- `postSealScanFn()` is the one scanner used by both the CLI and the self-test.
- `--scan` now applies `REVIEWED_HITS`, but an entry only counts when `checkReviewedList` passes with the ruling read at the seal's `sealed_sha`.
- `--phase-scan` keeps its first-parent options, which its scan records name.
**RED test:** I ran the new cases with `SCAN_LOG_OPTS` temporarily set to the old first-parent value and the old `--scan` branch. 7 failures:
- the merge fixture's exclusion case and its side-branch case
- a real-scanner pull-request merge of a sealed branch holding a key committed before the seal, with `scan: true`, which should stay VALID
- the evil-merge case
- three `scan_fn` cases for the reviewed list

**After:** all pass, including a control showing that the first-parent options do report the pre-range key (the fixture really reproduces WR-32). Self-test 135 PASS.

### WR-33: The recording guard exempts every `data` key, and every hash-named key, from the 64-hex secret rule in any entry kind

**Fixer:** recordings and seal verifier (fixer E); fixer's heading: "The recording guard exempts every `data` key and every hash-named key"

**Files modified:** `test/realpath/recordingsGuard.test.ts` (the rules moved to `test/realpath/recordingsScan.ts` in WR-35)
**Commit:** 0b65586
**Applied fix:**
- Only a submit entry's `request.data` is calldata, and it must equal the data of the entry's own signed `raw` transaction. A `data` key anywhere else gets every rule, the 64-hex rule included. A hex `data` value must still be whole bytes.
- A transaction-hash field outside a db row must be the hash of a signed transaction in the same recording. The transaction-hash fields are new `TX_HASH_KEYS`: the hash keys minus bundleHash, blockHash, parentHash and relayHash.
- A `bundleHash` must be the keccak256 bundle hash of a txs body in the same recording. The harness and Flashbots both use this rule.
- A db row may hold a made-up hash, because the risk-gate scenario seeds such rows (found by surveying every committed recording).
- New key rule: any 64-hex value accepted by a hash, topic or calldata-word rule fails when, read as a private key, it belongs to an address in the same recording or to a key sentinel. Values from 2^160 up are checked; smaller values (amounts, padded addresses, the tiny sentinels) are not read as keys.
**RED test:** 10 new bad cases:
- a planted key in `data`: in an op, in the middle of a data blob, in a db row
- a planted key under `hash`, `txHash` and `bundleHash`
- the wallet's key in `topics`, in a db `tx_hash`, and as a calldata word
- a `request.data` that is not the raw transaction's data

**Before:** none raised any violation. **After:** each fails with its rule. The good cases now derive the bundle hash from its body and put the bloXroute answer beside its signed body, as real recordings do. Every committed recording passes.

### WR-34: Non-hex secrets are caught only when they equal a test/.env.test sentinel exactly, and the allow-listed secret fields accept any non-sentinel value

**Fixer:** recordings and seal verifier (fixer E); fixer's heading: "Non-hex secrets caught only as exact sentinels; allow-listed secret fields accept anything"

**Files modified:** `test/realpath/recordingsGuard.test.ts`
**Commit:** 00ab12a
**Applied fix:**
- `walletPrivateKey`, `authKey`, `authHeader`, and any key named like a secret variable, may hold only their sentinel or one of the env matrix's case values (`''`, `'0'`, `'abc'`).
- New shape rules that fail in any string:
  - a Telegram bot token shape
  - a 32-hex run
  - a Bearer credential
  - a URL of any scheme with a user name or password
  - a run of 32 or more token characters that is not hex and mixes upper case, lower case and digits (base64) or upper case and digits (an explorer key)
- Addresses and hashes are blanked before the token-run check, so a checksummed address in a URL is not flagged. That was the first false positive, and the good cases caught it.
- `checkUrl` reads the URL fragment with the query rules, and refuses a user name or password on a loopback host too.
- A survey of every committed recording found no hit for any new shape.
**RED test:** 10 new bad cases:
- a non-sentinel `authHeader`
- a non-sentinel `TELEGRAM_SESSION` in an env document
- a Telegram token
- a 32-hex hash
- a base64 session
- an explorer key in free text
- a Bearer value
- a fragment token
- a credential URL in another scheme
- a user name and password on a loopback host

**Before:** none matched any rule. **After:** all match. The case values under the secret fields stay good.

### WR-35: Nothing scans a re-recorded file before it is committed or pushed; the guard runs only in CI, after the push

**Fixer:** recordings and seal verifier (fixer E); fixer's heading: "Nothing scans a re-recorded file before commit or push"

**Files modified:** `scripts/update-recordings.ts`, `test/realpath/recordingsScan.ts` (new), `test/realpath/recordingsGuard.test.ts`, `test/unit/updateRecordingsGate.test.ts` (new)
**Commit:** 9598e80
**Applied fix:**
- The guard's rules and scan moved to a non-test module, `test/realpath/recordingsScan.ts`. It takes every path as an argument, so it loads under both Vitest and ts-node. It does not import the serializer, because ts-node cannot compile the serializer's `import.meta.url`. Its copies of `TAG_RE`, `tagIds` and `EMPTY_SUBMITTED_LINE` are checked equal to the serializer's by the guard test.
- After Vitest exits (any status, or a signal), `update-recordings.ts` runs `scanRepoRecordings` over every recording. It prints each violation and exits 1.
- `done` is printed only when Vitest exited 0 and the guard found nothing. A failed run says so.
- The wrapper's logic is now `runUpdate(argv, deps)`, with a `--self-test` that uses a fake Vitest on temp folders: Vitest never starts and the real recordings are never touched. `test/unit/updateRecordingsGate.test.ts` runs that self-test in a railed child.
- The guard test also checks that the update command's scan reads the same folder and passes it.
**RED test:** I first refactored the wrapper while keeping the old behavior exactly, then ran the self-test: 4 of 5 cases failed. For example, a re-record holding a planted key exited 0 and printed `done`. **After:** 5 of 5 pass (7 of 7 once the WR-36 cases were added). The old wrapper was never run with `--self-test`, because it would have treated that flag as a Vitest filter and started a real update.

### WR-36: The write switch is a plain environment variable with no tie to the update command, so a lingering export silently re-records on every local run

**Fixer:** recordings and seal verifier (fixer E); fixer's heading: "The write switch is a plain env var with no tie to the update command"

**Files modified:** `test/realpath/harness/serializer.ts`, `scripts/update-recordings.ts`, `test/realpath/recordingsGuard.test.ts`, `scripts/check-recordings-compared.ts`, `test/unit/updateRecordingsGate.test.ts`
**Commit:** c43a1f1
**Applied fix:**
- The wrapper sets the switch to a one-run token (32 random hex). Before its Vitest run it writes `<os.tmpdir()>/csb-recordings-update-<token>` holding `{pid, token}`. It removes that file when Vitest exits: on any status, a signal, a start failure or a throw.
- The echoed command line shows `<one-run token>`, never the token value.
- `updateAllowed()` requires CI to be unset and a live token: 32 hex, its file present, naming that token and a running process (`process.kill(pid, 0)`).
- Any other value only compares, and says so once on stderr. That covers a lingering `1`, an ended run's token, a dead owner, or a malformed file.
- Every `written` result prints `[recordings] WROTE <path> (update run)` on stderr.
- The AC-25 text test checks that the wrapper uses the serializer's token prefix.
- The recordings-compared self-test drives the real serializer with a live token in its own temp folder.
**RED test:**
- Guard: with the switch set to `1` and CI unset, the old serializer wrote, so the guard test failed (`switch "1": expected true to be false`). The live-token case was refused, and the prefix check failed.
- Wrapper self-test: the token case saw `"1"`.

**After:** the guard (14 tests) and the wrapper self-test (7 of 7) pass. Every case writes only into temp folders and token files under the OS temp folder, never into `test/realpath/recordings/`.

## Fixer notes

Everything below is each fixer's own record (baselines, measurements, mutant specs, final command outputs, follow-ups), with headings demoted so the ledger reads only the two sections above.

### Fixer T: CI gates

### Phase 23: Code Review Fix Report (fixer T: CI gates and CI wiring)

**Fixed at:** 2026-11-12
**Source review:** .planning/phases/23-test-safety-net-harness-triage-characterization/23-REVIEW.md
**Iteration:** 1
**Worktrees / branches:** The first pass ran in `.../scratchpad/wt-T` (branch `fix23-T`, from c9262fa; the orchestrator has merged it). The second pass, for the operator's WR-24 ruling, ran in `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/wt-T2` (branch `fix23-T2`, from 150bb1e). All verification ran in those worktrees, whose node_modules is a junction to the main checkout's, on Node 22.16.0. No src/ file was changed.

**Summary:**
- Findings in scope: 10 (CR-08, CR-09, WR-23, WR-24, WR-25, WR-26, WR-27, WR-29, WR-30, WR-31)
- Fixed: 10. WR-24 was first fixed in part, with part 2 escalated over src/bot.ts:228. The operator ruled on 2026-11-12, and part 2 is now committed together with a census-proven dead-code class (fix23-T2: a17cdf6, 92a975c).
- ESCALATE: none open.
- One extra commit that is not a finding: 421d4d4 (check-realpath-mocks compares mock targets by real path). Without it `npm run test:unit` fails in this worktree. Details are under WR-26.

All census, gate and taxonomy changes are logic changes. Each one was shown RED and then GREEN by its test. A human should still review the gate logic before the phase moves on.

#### WR-28 follow-up (fixer E's finding; source-text gate side)

**Commit:** 17b1c32, in the main checkout on the phase branch, on top of bd35d87. Only `test/unit/sourceTextGate.test.ts` changed.
**Route closed:** a scenario moves to a new recording name and keeps the old file "compared" by reading the old recording's bytes and passing them to `compareRecording('old.jsonl', bytes)`, which always matches.

**What changed:** the gate has a second rule: no file under `test/` may read a named file under `test/realpath/recordings/` unless it is on `RECORDING_READERS`. It uses the same read detection as the src/ rule. In addition, a path is resolved from where it lives:
- `__dirname`, `import.meta.url`/`dirname`, `fileURLToPath` and `path.dirname` anchor it to the reading file's folder.
- `new URL(lit, base)` resolves `lit` against `base`.
- An imported repo const such as the serializer's `RECORDINGS_DIR` is followed into its module.
- `resolveRecordingPath(rel, dir?)` names `rel`.

A listing of the folder, and a read of a name the listing returned, names no file and passes. The src/ rule is unchanged.

**Allowed, and why.** Each entry must have a real named read, so an entry cannot outlive its read.
- `test/realpath/recordingsGuard.test.ts`: its AC-23 case reads `flashbots-v2-trailing.jsonl` to check recorded order. It asserts on the content and never passes the bytes to compareRecording.
- `test/realpath/env/envMatrix.test.ts`: it reads `env/_baseline.json` only for the variable list, and asserts that list equals the live one. Everything it compares is built from the live run. This file was not on the coordinator's suggested list, but its read is named and legitimate.

**Not listed, because the rule never flags them:**
- `serializer.ts`: compareRecording reads whatever name its caller passes, never a name of its own.
- `recordingsScan.ts`: it reads only what its listing of the folder returns.
- A named read added to either file later would fail the gate.
- `scripts/` is outside the gate's `test/` scan, and `check-recordings-compared.ts` lists recordings with git ls-files and reads none.

**RED:** the new temp-directory test has five laundering forms with seven named recording reads, among them `fs.readFileSync(path.join(RECORDINGS_DIR, 'old-name.jsonl'))` passed to compareRecording, plus a listing pass case. Before the change it found 0 of 7; after, it finds 7 of 7 and the pass case stays clean. The real tree passes.

**Commands (main checkout at 17b1c32), all exit 0:**
- `npm run test:unit`: 110 files, 966 tests passed.
- `npm run check:realpath-mocks`: 0 violations.
- `npm run check:vi-mock`: 0 violations.
- `npx tsc --noEmit -p tsconfig.json`: passed.

Outputs are in `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/T3-final/`.

#### Final command outputs (wt-T2, Node 22.16.0, at 92a975c)

- `npm run test:unit`: exit 0. `Test Files 110 passed (110)`, `Tests 964 passed (964)`, 112 s.
- `npm run check:census`: exit 0. `check-signing-census: 24 transaction-signing sites (locked 10, unlocked 13, unknown 0, dead 1), floor 24; excluded 2 by auditor and 24 by census; message-signing 1; files src 71, scripts 29; 0 problem(s)`
- `npm run check:census -- --check-floor-history`: exit 0. `6 commit(s) touch scripts/signing-census-exceptions.json; floor f74238091b28:23 -> fef461d8bac5:24 -> f7bfa9df849c:24 -> bcd951c6641e:24 -> f6f65893e75c:24 -> a17cdf6647d1:24; 0 problem(s)`
- `npm run check:realpath-mocks`: exit 0. `48 vi uses (7 mock calls) checked in 109 files (4 reached from outside the root), realpath config vitest.config.ts checked (2 setup files), 0 violations`
- `npm run check:vi-mock`: exit 0. `660 mock calls checked in 288 files, 0 violations`
- `npm run check:commits`: exit 0. `judged 111 commit(s) after it (5 merge commit(s), 0 of them judged ...); ... 0 violation(s)`, then `RESULT PASS`
- `npx tsc --noEmit -p tsconfig.json`: exit 0

Saved outputs: `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/T2-final/`. The first-pass outputs (fix23-T at 5614afd, all passing) are in `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/T-final/`.

---

_Fixed: 2026-11-12_
_Fixer: Claude (gsd-code-fixer, fixer T)_
_Iteration: 1_

### Fixer E: recordings and seal verifier

### Phase 23: Code Review Fix Report (fixer E)

**Fixed at:** 2026-11-13T01:59:29Z
**Source review:** .planning/phases/23-test-safety-net-harness-triage-characterization/23-REVIEW.md
**Iteration:** 1
**Worktree:** `wt-E`, branch `fix23-E`, from c9262fa. Every edit, commit and check ran in this isolated worktree (its `node_modules` is a junction to the main repo's). Nothing was edited or committed in the main checkout.

**Summary:**
- Findings in scope: 7 (CR-10, WR-28, WR-32, WR-33, WR-34, WR-35, WR-36)
- Fixed: 7
- Skipped: 0

Each fix was shown RED before the change: a new test or self-test case failed on the code as it was, for the finding's own scenario. Planted secret-shaped values in the new tests are built at run time from hashes, so no secret-shaped literal was added to the source (the successor seal's phase scan reads source text).

#### Final command outputs (worktree `wt-E`, HEAD 603e637)

All checks below ran in the isolated worktree.

- **`npm run test:unit`**: `Test Files 1 failed | 107 passed (108)`, `Tests 2 failed | 951 passed (953)`, exit 1. Both failures are in `test/unit/realpathMockGate.test.ts`: `FAIL (allowed-mock-passes) mocks of the logger, the notifier, the broadcaster and axios (by resolved path) pass ...: expected [], got [forbidden-mock]`. It failed the same way when re-run alone. I then put all six of my files back to their c9262fa content and set my two new files aside; it failed identically (`Tests 2 failed | 5 passed (7)`). I restored HEAD afterwards (status clean). So this failure is pre-existing and not caused by these fixes. Most likely the `node_modules` junction makes `axios` resolve outside the worktree; it should pass in the main checkout. My new unit test `updateRecordingsGate` and the updated `recordingsComparedGate` pass.
- **Realpath scenario, env and recordings-guard tests** (`npx vitest run --project realpath test/realpath/scenarios/ test/realpath/env/ test/realpath/recordingsGuard.test.ts`, switch unset): `Test Files 6 passed (6)`, `Tests 145 passed (145)`, exit 0.
- **`npm run check:recordings-compared -- --run-log <that run's log>`**: `record: ... (5 worker file(s), 130 compareRecording call(s))`, `tracked recordings: 130 (22 scenario .jsonl, 108 env/*.json)`, `outcomes: match 130, written 0, differs 0, absent 0, error 0; tracked recordings matched: 130 of 130`, `RESULT PASS (tracked 130, compared 130)`, exit 0. `git status -- test/realpath/recordings`: empty.
- **`seal-verify.ts --self-test`**: 135 PASS, 0 FAIL, `RESULT PASS`, exit 0. I confirmed from the code that it builds every repo under `os.tmpdir()` (`mkTemp`) and runs the real scanner only on those throwaway repos. The `--phase-scan` wiring case also reads the firewall rule (read-only) and copies the Hardhat literal file into the temp repo. I never ran `--scan` or `--phase-scan` on the real repo.
- **`seal-verify.ts`** (SEAL.json): `SEAL INVALID: .planning/audit/SEAL.json was not added after sealed_sha 1d1dd171: a seal record is committed once, after the revision it seals, and moving sealed_sha needs a new record`, exit 1. It was already INVALID before the change, for a different reason.
- **`seal-verify.ts --seal .planning/audit/SEAL-23.json`** (expected INVALID after the tool edit):
  ```
  seal-verify: seal record .planning/audit/SEAL-23.json
  seal-verify: changed after the seal: .planning/audit/SEAL-23.json, .planning/audit/inputs/phase-scan-23.json, .planning/audit/tools/seal-verify.ts
  seal-verify: 17 changed path(s) lie outside the seal's covers and are not judged
  SEAL INVALID: changed after the seal and not exempt: .planning/audit/tools/seal-verify.ts
  ```
  exit 1. It was VALID on c9262fa itself, both under the old tool and under the new tool run against a clone at c9262fa.
- **`npx tsc --noEmit -p tsconfig.json`**: exit 0, no output. That config covers `src/` only, so I also type-checked my test files with a scratch config (`recordingsGuard.test.ts`, `recordingsScan.ts`, the serializer, `updateRecordingsGate.test.ts`): exit 0. ts-node type-checked the scripts when each self-test ran.

#### Follow-up notes

1. **WR-28, source-text gate (another fixer's file):** a scenario can still "compare" an old recording against its own bytes read from disk. Forbidding reads of `test/realpath/recordings/**` outside the serializer belongs in `test/unit/sourceTextGate.test.ts`. That gate must allow `test/realpath/recordingsScan.ts` (the guard's scan) and `test/realpath/recordingsGuard.test.ts` (whose AC-23 tests read recordings).
2. **Successor seal:** `tools/seal-verify.ts` is now under SEAL-23's `covers`, so SEAL-23 reports INVALID, as expected. Under CR-10 the successor must be a new record file, committed once after its `sealed_sha`, and never edited afterwards. Its documented `--scan` check now uses remerge diffs plus the reviewed list. The record's `rule` text can keep the same command.
3. **SEAL.json** now reports the CR-10 reason ("not added after sealed_sha") because 28f8f5f re-pointed it in place. It cannot become VALID again by editing it. Only a new record can replace it.
4. **WR-35, pre-commit:** `.git/hooks` is local and untracked, so a staged-recordings scan there was not added. If wanted, a hook can call `scanRepoRecordings(<repo root>)` from `test/realpath/recordingsScan.ts`.
5. **Guard strictness (WR-33/WR-34):** a future scenario that logs the hash of a transaction it did not sign (outside a db row), or a legitimate long mixed-case token, will fail the guard. That is fail-closed by design. Such a case needs a deliberate, field-scoped rule, as the builder-key and bloXroute-answer rules were added.
6. **realpathMockGate:** confirm it passes in the main checkout. It fails in this worktree before and after these fixes.

#### Successor seal SEAL-23b

This work ran in the main checkout after the fixes were merged. Before starting, HEAD was 17b1c32 and `git log -1 --format=%H -- .planning/audit` returned bd35d87909b942eb8bb015005ef59350d833ae50. Only the two record files were staged; `.planning/config.json` and `.planning/state.json` were not touched.

**Commit:** `61adddf` (61adddfdefb3ee0fb88e93a10cade1e569cb55c8): `docs(23): successor seal SEAL-23b.json over the audit folder at bd35d87, with its phase scan record (D-19)`. It adds exactly `.planning/audit/SEAL-23b.json` and `.planning/audit/inputs/phase-scan-23b.json`. The committed blobs are byte-identical to the files the tool wrote.

**How it was made:**
1. **Phase scan.** Command: `seal-verify.ts --phase-scan --sealed bd35d87… --start 912b915… --phase-name 23-test-safety-net-harness-triage-characterization --plan-id 23-REVIEW-FIX --requirement "D-19 successor seal after the Phase 23 code-review fixes; AC-51 (recordings and snapshots hold only inert values); T-23-34" --out .planning/audit/inputs/phase-scan-23b.json`, with `--raw-dir` set to `scratchpad/seal-23b/raw`.
   - Range fixture: 6 of 6.
   - Result: `PHASE-SCAN range=912b915f3da59c9596f44cdaa5e37caaa29a087c..bd35d87909b942eb8bb015005ef59350d833ae50 commits=75 hits=0 non-public=0 known-public=0 public-address=0 reviewed-inert=0 (reviewed entries matched 0 of 2)`, then `RESULT CLEAN (zero non-public hits)`, exit 0. This matches the dry run.
2. **final_check.** Command: `check.ts --stage triage --root <clone>/.planning/audit --repo <clone>`, run on a scratch clone at bd35d87. Its only write sites are in its self-test fixtures.
   - Output: `RESULT PASS stage=triage fail=0 pending=0 warn=0`, exit 0.
   - Afterwards both the clone and the checkout were clean.
3. **The record.** A scratchpad script (`scratchpad/seal-23b/build-record.js`) built it:
   - `changed_since_previous` comes from the tool's own `changedPaths(repo, 912b915, bd35d87)`, filtered with `underCovers(…, '.planning/audit/')`.
   - `render_sha256` is the sha256 of `git cat-file -p bd35d87:<render>`, the way the tool computes it.
   - `phase_scan_sha256` is the sha256 of the scan record's bytes.
   - The hit counts are read from the scan record's `hit_counts`.
   - The script refuses unless the key order and the `scan` key order equal SEAL-23.json's. It writes with `JSON.stringify(x, null, 2) + "\n"`, using the `wx` flag so an existing file is never overwritten.
4. **Rehearsal.** The two files were committed in a scratch clone at 17b1c32, and `--seal .planning/audit/SEAL-23b.json` against that clone gave `SEAL VALID`. Only then were they committed for real.

**Key fields:**
- `sealed_sha` bd35d87909b942eb8bb015005ef59350d833ae50; `sealed_at` 2026-11-12T23:47:30-05:00.
- `phase_start_sha` = `scan_start_sha` = 912b915f3da59c9596f44cdaa5e37caaa29a087c.
- `scan`: `range` 912b915…bd35d87, `non_public` 0, `known_public` 0, `public_address` 0, `reviewed_inert` 0, `phase_scan_sha256` 965fe9b2c3a3b854ef339c3f5698b05aab8e93853c4e8504732f146bb41ea5c5. `reviewed_ruling` says none was applied.
- `final_check` `pass`; `final_check_source` `.planning/audit/tools/check.ts --stage triage at sealed_sha: RESULT PASS stage=triage fail=0 pending=0 warn=0`.
- `render_sha256`: `findings` 738cebf6043c78c65b358aef7e3d83c9c1476ca9a830c82640620c47ec03e4b2; `decisions` 90946c7db693f877c90e7384d44c4de68b710bdb6b7b8e8fb65fbb0eeefc4e8a.
- `exempt_paths`: `.planning/audit/SEAL-23b.json` and `.planning/audit/inputs/phase-scan-23b.json`.
- `covers` `.planning/audit/`; `previous_seal` `.planning/audit/SEAL-23.json`; `previous_sealed_sha` 912b915f3da59c9596f44cdaa5e37caaa29a087c; `scan_record` `.planning/audit/inputs/phase-scan-23b.json`.
- `changed_since_previous`: 24 paths.
  - `AUDIT-FINDINGS.md` and `SEAL-23.json`
  - 14 findings: `AUD-ANTIRUG-002`, `AUD-BUY-005`, `AUD-BUY-025`, `AUD-BUY-027`, `AUD-BUY-039`, `AUD-EXIT-001`, `AUD-EXIT-002`, `AUD-EXIT-007`, `AUD-EXIT-008`, `AUD-EXIT-009`, `AUD-EXIT-014`, `AUD-TX-002`, `AUD-TX-003`, `AUD-TX-029`
  - `inputs/phase-scan-23.json` and `inputs/triage-evidence.json`
  - `ledger/BUY.json`, `ledger/EXIT.json` and `ledger/TX.json`
  - `process-notes/PN-002.json` and `sweep/contrib-PHASE23.json`
  - `tools/seal-verify.ts`
- `phase` `23-test-safety-net-harness-triage-characterization`; `plan` `23-REVIEW-FIX`; `rule` `… run seal-verify.ts --seal .planning/audit/SEAL-23b.json --scan`.

**Verify outputs (main checkout, HEAD 61adddf):**
1. `seal-verify.ts --seal .planning/audit/SEAL-23b.json`:
   ```
   seal-verify: seal record .planning/audit/SEAL-23b.json
   seal-verify: changed after the seal: .planning/audit/SEAL-23b.json, .planning/audit/inputs/phase-scan-23b.json
   seal-verify: 1 changed path(s) lie outside the seal's covers and are not judged
   SEAL VALID
   ```
   exit 0.
2. `seal-verify.ts --seal .planning/audit/SEAL-23b.json --scan`: the range fixture passed 6 of 6 and the merge fixture 5 of 5 with the `--scan` options. Then:
   ```
   seal-verify: seal record .planning/audit/SEAL-23b.json
   seal-verify: scanned bd35d87909b942eb8bb015005ef59350d833ae50..61adddfdefb3ee0fb88e93a10cade1e569cb55c8 (--full-history --diff-filter=tuxdb --diff-merges=remerge): 0 hit(s), non-public 0, known-public 0, public-address 0
   seal-verify: changed after the seal: .planning/audit/SEAL-23b.json, .planning/audit/inputs/phase-scan-23b.json
   seal-verify: 1 changed path(s) lie outside the seal's covers and are not judged
   SEAL VALID
   ```
   exit 0.
3. `seal-verify.ts --seal .planning/audit/SEAL-23.json`: `SEAL INVALID: changed after the seal and not exempt: …`, exit 1. The reason lists 24 paths, including `.planning/audit/tools/seal-verify.ts`, `.planning/audit/SEAL-23b.json`, `.planning/audit/inputs/phase-scan-23b.json`, the 14 findings, `AUDIT-FINDINGS.md`, `inputs/triage-evidence.json`, the three ledgers, `PN-002.json` and `sweep/contrib-PHASE23.json`. It is superseded by SEAL-23b, as expected.
4. `seal-verify.ts --self-test`: 135 PASS, 0 FAIL, `RESULT PASS`, exit 0.

Full outputs are in `scratchpad/seal-23b/` (`phase-scan.log`, `check-triage.log`, `v1.txt` to `v4.txt`).

---

_Fixed: 2026-11-13T01:59:29Z_
_Fixer: Claude (gsd-code-fixer, fixer E)_
_Iteration: 1_

### Fixer A: real-path harness

### Phase 23: Code Review Fix Report (fixer A: harness fidelity, WR-01 to WR-06)

**Fixed at:** 2026-11-13
**Source review:** .planning/phases/23-test-safety-net-harness-triage-characterization/23-REVIEW.md
**Iteration:** 1
**Worktree / branch:** `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/wt-A`, branch `fix23-A`, from c9262fa. Every edit, test run and commit happened in this worktree (Node 22.16.0). The main checkout was not touched.

**Summary:**
- Findings in scope: 6
- Fixed: 6. WR-01 is fixed **opt-in only**: the default stays unfaithful, and the operator needs to decide that (see WR-01).
- Skipped: 0

**What needs the operator (D-STOP-THE-LINE):** with faithful reverts turned on by default, **AUD-TX-029 reads "looks fixed" and AUD-TX-003 fails**. Both private-attempt escalations simulate the buy bundle after the buy's own 60 s deadline. The harness relay reports that simulation as a success. A real relay answers `UniswapV2Router: EXPIRED`, and the bot's simulate gate then refuses the bundle. So both verdicts depend on a harness infidelity. I left the default unchanged and did not edit any triage test. Details and evidence are under WR-01.

#### Baseline

- Command: `npx vitest run --project realpath --reporter=json --outputFile=<scratchpad>/A-baseline.json`, run at c9262fa before any edit.
- Result: 344 tests, 342 passed and 2 failed, 97 `meta.knownBugs` records, 70 files.
- **Two baseline failures, both caused by where the worktree lives.** They are not caused by any change of mine. Re-run alone, they fail the same way:
  - `harnessRestart.test.ts` "a database file outside the OS temp folder is refused…": the worktree sits under `os.tmpdir()` (AppData/Local/Temp). The test's "in-repo" path is therefore inside the temp folder, and `assertTempDbFile` correctly accepts it.
  - The next test, "the scenario disposer removes the temp database folder…", fails as a knock-on: it inherits the `DB_PATH` that the first test left behind.
  - Both tests pass in the main checkout. The first one also writes `test/realpath/refused-<pid>.db` into the worktree, and I deleted that file after every run.
- Diff tool: `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/A-summarize.cjs`. It compares every test's status and its exact knownBugs records, keyed by file and full test name.

#### Final outputs (worktree at d169796, clean tree)

**Whole realpath project:** `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/A-final.json`; the diff is in `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/A-final-diff.txt`.
- 360 tests: 358 passed and 2 failed. The 2 failures are the same baseline failures caused by the worktree living under the temp folder.
- 97 knownBugs records, deep-equal to the baseline's 97.
- Against `A-baseline.json`, the diff has one entry: the intentionally replaced WR-05 self-test (MISSING). Every other baseline test keeps its status.
- New tests: 16, all passing.
- `git status -- test/realpath/recordings`: empty.
- "Unhandled" errors in the run log: 0.

**`npm run check:realpath-mocks`:** `check-realpath-mocks: 46 vi uses (7 mock calls) checked in 104 files, 0 violations`.

**`npx tsc --noEmit -p tsconfig.json`:** exit 0, no output. Note that this config only covers `src/**` and `hardhat.config.ts`. I also type-checked every harness file and harness self-test with `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/A-tsconfig.harness.json` (it extends the repo config and includes `test/realpath/harness/*.ts` and `test/realpath/harness*.test.ts`, 79 project files): exit 0, no errors.

**Where verification ran:** in the isolated worktree `wt-A`, whose `node_modules` is a junction to the main checkout's. The numbers come from that tree at d169796.

**Commits on `fix23-A`:** e8738be (WR-05), 5ad8e70 (WR-04), c1aff81 (WR-06), 3c6da2b and b27e617 (WR-03), 5efe047 (WR-01), d169796 (WR-02).

---

_Fixed: 2026-11-13_
_Fixer: Claude (gsd-code-fixer, fixer A)_
_Iteration: 1_

#### Operator ruling on WR-01: realistic default and TX-003/TX-029 re-triage

**Ruling (from the coordinator):** realistic reverts become the default, and AUD-TX-003 and AUD-TX-029 are re-triaged on the realistic chain in this run. Work was done in the same worktree and branch (`wt-A`, `fix23-A`) under the same rules. No `src/` edit, no recordings:update, nothing under `test/realpath/recordings/` changed, nothing under `.planning/` was edited, and Node 22.16.0 was used throughout. This section supersedes the "opt-in only" status of WR-01 above.

**Commits (in order):**

| Commit | What |
|---|---|
| 11fcb3e | bloxroute-full-sell: repair the scenario's sell read (step 2) |
| 780d67d | `enforceReverts` defaults to true; the pinning self-test is replaced (step 1) |
| 354e2fc | AUD-TX-003 re-triaged (step 3) |
| eb34470 | AUD-TX-029 re-triaged (step 3) |

780d67d alone leaves AUD-TX-003 failing and AUD-TX-029 reading "looks fixed". The two commits after it re-triage those tests. Every other commit leaves the suite in its documented state.

##### Step 1: realistic reverts by default (780d67d)

- `FakeNode.#enforceReverts` now defaults to `true`, and the chain.ts header and method docs are updated to match.
- The self-test that pinned the old default ("by default (enforceReverts off) nothing changes") is replaced by one that pins the realistic default, with nothing configured:
  - the relay's `eth_callBundle` of a buy past its deadline reports `error: 'execution reverted'` with `UniswapV2Router: EXPIRED` revert data;
  - `eth_estimateGas` of an expired swap reverts with code 3;
  - the late buy mines with status `0x0`, and `succeeded()` is false.
- The same test then calls `enforceReverts(false)` and shows that the old always-succeeds node returns: a buy past its deadline mines with status 1, and estimateGas answers 150000.
  - RED/GREEN: under the old default this test fails, and so do the three WR-01 self-tests that no longer call `enforceReverts(true)` (receipt `0x1`, and so on). Under the new default all four pass.
- **Who uses `enforceReverts(false)`: no test in the suite.** It stays available for a future scenario that needs a node where everything succeeds. Only the self-test above calls it, to prove the switch works.

##### Step 2: bloxroute-full-sell (11fcb3e)

- **Diagnosis** (temporary debug print in the scenario's read, since removed):
  - The call reverted at mine time with `TRANSFER_FROM_FAILED` was **not the bot's stop-loss sell**.
  - It was the fixture's other trader dumping 30 percent of the pool's tokens. That is `foreignTrade`, from `0xdA216cF0...`, with amountIn 300000e18, and it is what triggers the stop-loss.
  - `installV2SellSimulation` modelled only the bot wallet and rejected every other sender.
  - The scenario then supplied Sync/Swap logs for that reverted transaction, which the harness correctly flags as a stray.
- **Repair** (scenario setup only; in `test/realpath/scenarios/otherRoutes.test.ts`, which the coordinator assigned to me for this step):
  - The balance and allowance checks now apply only to the bot wallet.
  - Another trader's sell is checked on path, deadline and minimum output only. The scenario does not track that trader's balance; the fixture moves the reserves and writes its own logs.
- **Result:** all 6 tests in the file pass. bloxroute-full-sell **compare-matches the committed recording unchanged**, through `runScenario` -> `compareRecording`, and `git status -- test/realpath/recordings` is empty.

##### Step 3a: AUD-TX-003 (S1, confirmed) re-triaged (354e2fc)

**Measured on the realistic chain** (fake-clock ms; same scenario as the triage test):

| Event | Time |
|---|---|
| B's first private bundle | 220 ms after B's launch |
| Anti-rug dispatch for A | **8 020 ms** after B's first submission |
| B attempt 0 not-landed | dispatch + 44 230 (B first + 52 250) |
| B attempt 1 | submitted inside B's deadline (2 bundles in total) |
| `antirug.exit.bounded-abort` | **exactly dispatch + 60 000** |
| B attempt 1 not-landed | dispatch + 96 520 |
| Attempt 2's `eth_callBundle` refused (`flashbots.simulate.revert` attempt 2); B's `buy.snipe.fail-clean` | dispatch + 96 540 |
| A's abandoned exit first sends | **dispatch + 96 610** (just after B lets go), then sells the remains |

- B's `buy.snipe.fail-clean` reason is "Flashbots simulate: tx would revert (execution reverted)".
- **Lock-hold time:** B holds the wallet lock **about 104.6 s** from its first submission: 2 private attempts, then the third is refused by the relay simulation. The finding assumed about 4 minutes and 4 attempts.
- **Cause, asserted in the test:** the swap deadline decoded from B's signed bundle is earlier than the fake second of the refused simulation, and later than attempt 0's not-landed time.
- **Does the emergency sell still wait and time out?** Yes. The bug holds. The claim name is unchanged (`antirug-exit-queued-behind-buy`), and `observed` is unchanged: `{ emergencySellStartedWithinBudget: false }`.
- **Changes to the test:**
  - `actualPlain` now states the ~105 s hold. The baseline diff shows only this field changed.
  - Header comments are updated.
  - Post-marker windows now expect:
    - 2 B bundles, not 4;
    - the refused attempt-2 simulation, with the deadline as its cause;
    - fail-clean between 90 and 120 s after B's first submission, not "> 3 min";
    - A's start more than 90 s after dispatch, not "> 2 min".
- **RED->GREEN contract:**

| Run | Result |
|---|---|
| Today's src (realistic chain) | **passes and records** the bug |
| Fix-shaped mutant (the anti-rug approval skips the queue) | **reads "AUD-TX-003 now behaves correctly: remove this marker (it looks fixed)"** (vite ack written) |
| Plausible wrong fix (only the anti-rug private *sell* gets a priority lane; the approval still queues) | **does NOT read looks fixed**: passes, recording the same bug with `{emergencySellStartedWithinBudget:false}` |

  The mutant specs, as `CSB_MUTANT_SPEC`, run with `--config scripts/vitest.in-memory-mutant.config.ts --project realpath test/realpath/triage/AUD-TX-003.test.ts`; the runner adds `ackDir`:
  ```json
  {"file":"src/exitEngine.ts","edits":[{"find":"            await withNonceLock(ctx.wallet.address, () => ensureApproval(token, dex.routerAddress, balance, ctx.wallet.address));","replace":"            await (reason === 'anti-rug' ? ensureApproval(token, dex.routerAddress, balance, ctx.wallet.address) : withNonceLock(ctx.wallet.address, () => ensureApproval(token, dex.routerAddress, balance, ctx.wallet.address)));"}]}
  ```
  ```json
  {"file":"src/exitEngine.ts","edits":[{"find":"        const priv = await submitPrivateSell(ctx, txBuilder, attempts, gasMultiplier);","replace":"        const priv = reason === 'anti-rug' ? await escalatePrivateSell(txBuilder, ctx, attempts, gasMultiplier) : await submitPrivateSell(ctx, txBuilder, attempts, gasMultiplier);"}]}
  ```
  Copies: `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/A-mutants/tx003-fix.json` and `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/A-mutants/tx003-wrong.json`. Runner: `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/A-runmutant.sh`.

**Proposal (AUD-TX-003, currently S1, confirmed):** keep **S1, confirmed**, and correct the record's timing. The title and severity_rationale say "about 4 minutes at default settings" and "4 attempts"; trace step 3 says "attempts 1-3 ... ~4 min".
- On a realistic relay, the snipe's escalation is cut off by its own 60 s swap deadline. The hold is about 1.75 min: 2 attempts, then a simulation refused as EXPIRED.
- A rug that lands in the first ~45 s of a non-landing snipe still loses its 60 s anti-rug budget and is left queued.
- So the bug, its capital impact (STRAND) and its fix card (OD-17) stand. The "about 4 minutes" wording does not.
- Suggested title fragment: "...holds the wallet nonce lock through its private attempts until the buy's own 60 s deadline makes the relay refuse the next one (about 105 s at default settings when the bundle does not land)...".

##### Step 3b: AUD-TX-029 (S3, confirmed) re-triaged (eb34470)

**Measured on the realistic chain:**

1. **The registered claim, a snipe whose four attempts all miss (`attempt-budget-reported-as-ceiling-hit`), does not happen at defaults.**
   - Same flow as the old test: bundles never included, target block 12 s after each bundle.
   - The snipe sends **1 bundle** (1 gwei). Attempt 0 is not-landed at 64 520 ms. Attempt 1's `eth_callBundle` at 64 540 ms is past the swap deadline (launch + ~60 s), the relay answers EXPIRED, and the bot logs `flashbots.simulate.revert` attempt 1.
   - It fails clean at **64 540 ms** with reason **"Flashbots simulate: tx would revert (execution reverted)"**.
   - **0 `mev.escalation.ceiling-hit` lines.**
   - The snipe's fourth attempt can never be reached at default settings: each attempt takes about 52-64 s, and the deadline is 60 s. Even in the faster case, as in AUD-TX-003's B, attempt 2 is refused.
   - The default-on run before the re-triage confirms it: the old test read "AUD-TX-029 now behaves correctly".
2. **The misreport itself still happens on a two-attempt private leg** (new claim `sell-attempt-budget-reported-as-ceiling-hit`):
   - A stop-loss private sell runs with `MEV_SELL_FALLBACK_ATTEMPTS` at its default of 2.
   - It uses a test-local router sell read that enforces the swap deadline. The scenario's default router has no sell read, so it would never refuse an expired sell; that is a remaining harness gap, see below.
   - The target block arrives 2 s after each bundle, which is a block early in its slot.
   - First sell sent at t0. Its decoded swap deadline is **t0 + 59.53 s**. Attempt 0 is not-landed at t0 + 52.27 s. **Attempt 1 is sent at t0 + 52.29 s, inside the deadline**, and misses.
   - `mev.escalation.ceiling-hit` attempt 1 is logged at t0 + 104.56 s: "MEV bundle not included after 2 attempt(s); priority-fee ceiling (25000000000 wei) reached. Increase MEV_MAX_PRIORITY_FEE_GWEI ...".
   - The fees bid were **1 and 2 gwei**, against a 25 gwei ceiling.
   - With the target block 12 s after each bundle, attempt 0 ends at about 64 s, attempt 1's simulation is refused as EXPIRED, and no ceiling-hit is logged. This was measured, with the same deadline read.
   - So on a real chain the misreport happens when a two-attempt leg's first attempt ends before 60 s, which depends on when the target block arrives.
   - The exit then completes on the public fallback (`exit.fallback.public.submit` once, buy row sold).

**Test changes:**
- One new claim, `sell-attempt-budget-reported-as-ceiling-hit`, with `correct`/`observed` keyed `reportedCeilingReachedBelowCeiling` (`false`/`true`) as before, and new plain texts.
- The old claim `attempt-budget-reported-as-ceiling-hit` is no longer recorded. The header documents why, with the measurement.
- No test was deleted; the file's one `it` was rewritten.

**RED->GREEN contract:**

| Run | Result |
|---|---|
| Today's src (realistic chain) | **passes and records** `{reportedCeilingReachedBelowCeiling:true}` |
| Fix-shaped mutant (a separate attempt-budget message whenever the budget ends without a ceiling hit) | **reads "AUD-TX-029 now behaves correctly: remove this marker (it looks fixed)"** |
| Plausible wrong fix (the same separate message, but only for a snipe-sized budget, `attempt >= 3`) | **does NOT read looks fixed**: passes, recording the bug unchanged |

The mutant specs, run as above against `test/realpath/triage/AUD-TX-029.test.ts`:
```json
{"file":"src/utils/mevStrategies/reconciliation.ts","edits":[{"find":"    // outcome === 'not-landed' → genuinely not included this attempt.\n    if (ceilingHit || attempt >= cfg.maxRetries) {","replace":"    // outcome === 'not-landed' → genuinely not included this attempt.\n    if (!ceilingHit && attempt >= cfg.maxRetries) {\n      const msg = `MEV bundle not included after ${attempt + 1} attempt(s): the attempt budget ran out below the priority-fee ceiling (${cfg.maxPriorityFeeCeilingWei.toString()} wei).`;\n      logSink.error({ op: 'mev.escalation.budget-exhausted', attempt }, msg);\n      await alert(msg);\n      throw new Error(msg);\n    }\n    if (ceilingHit || attempt >= cfg.maxRetries) {"}]}
```
The wrong-fix spec is identical except for its condition, `!ceilingHit && attempt >= 3`.

Copies: `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/A-mutants/tx029-fix.json` and `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/A-mutants/tx029-wrong.json`.

**Proposal (AUD-TX-029, currently S3, confirmed):** keep it **confirmed with a narrower claim**; severity S3 is unchanged.
- The register's claim `attempt-budget-reported-as-ceiling-hit`, "a snipe whose four private attempts all miss", does not reproduce on a realistic relay at default settings.
- Retire that claim and register `sell-attempt-budget-reported-as-ceiling-hit` in its place.
- Retitle along the lines of: "a two-attempt private escalation (routine sell, deliberate buy) that ends on its attempt budget inside the swap deadline is reported as 'priority-fee ceiling reached'...".
- The register references the old claim and test title: `.planning/audit/findings/AUD-TX-029.json` triage note, `.planning/audit/inputs/triage-evidence.json`, `23-TRIAGE-REPORT.md` and `AUDIT-FINDINGS.md`. These need the operator's update; I did not edit `.planning/`. Until then, a register check that matches claims to the JSON report may flag the renamed claim.

**New observation for the operator (not registered, no `.planning/` edit): a candidate finding.**
- On a realistic relay, a snipe's private escalation outlives its own swap deadline.
- The deadline is fixed once at build time (`src/bot.ts:1045`, now + 60 s; the V2 sell's is the same, `src/exitEngine.ts:364`). Each attempt takes about 52-64 s.
- So at default settings a non-landing snipe gets 1-2 real attempts out of its budget of 4. The fee escalation to 3-4 gwei never happens.
- The snipe then fails clean with "Flashbots simulate: tx would revert (execution reverted)", which names neither the deadline nor EXPIRED: the revert data is not decoded.
- The fail-clean remediation still tells the operator to "raise MEV_BUY_MAX_PRIORITY_FEE_GWEI".
- The same applies to the 2-attempt sell and deliberate-buy legs when their first attempt runs past 60 s. It is related to AUD-TX-029 and AUD-TX-010.

**Remaining harness gap (stated plainly):** the default scenario router (world.ts) has no read for the bot's sell calls (`swapExactTokensForETH`, the SupportingFee variant, the V3 multicall sell). Sells therefore still never revert on the default node: their deadline, allowance and output floor are not enforced unless a test or scenario registers a sell read, as AUD-TX-029 and otherRoutes do. Adding default sell reads is a further fidelity change that would need its own baseline measurement. I did not make it.

##### Step 4: whole-project run, gates

**Whole realpath project:** `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/A-ruling.json`, with the working tree equal to eb34470.
- 360 tests: 358 passed and 2 failed. The 2 failures are the same baseline failures caused by the worktree living under the temp folder.
- 97 knownBugs records.
- "Unhandled": 0. `git status -- test/realpath/recordings`: empty.

**Diff against `A-baseline.json`:** 3 differences, all deliberate, plus 18 new self-tests.

| Difference | Cause |
|---|---|
| MISSING: harnessCapture "Open Question 5: a write inside db.transaction ... fails the test" | WR-05, replaced deliberately (unchanged from before the ruling) |
| KNOWNBUGS: AUD-TX-003 `antirug-exit-queued-behind-buy` | only `actualPlain` changed (now states the ~105 s hold); `expected`, `actual`, `expectedPlain` and the claim are identical (step 3a) |
| MISSING: AUD-TX-029 "attempt-budget-reported-as-ceiling-hit: a snipe whose four private attempts..." | replaced by NEW "sell-attempt-budget-reported-as-ceiling-hit: ..." (passed, records the new claim) (step 3b) |

- Every other baseline test keeps its status and its knownBugs record.
- bloxroute-full-sell and every other golden master pass with their recordings unchanged.

**`npm run check:realpath-mocks`:** `check-realpath-mocks: 47 vi uses (7 mock calls) checked in 104 files, 0 violations`.

**`npx tsc --noEmit -p tsconfig.json`:** exit 0. The scratch harness type-check (`C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/A-tsconfig.harness.json`), now also covering AUD-TX-003, AUD-TX-029 and otherRoutes, exits 0.

**Housekeeping:** the temporary measurement probe (`test/realpath/zzmeasure/`) and the debug prints were removed before any commit. The worktree is clean at eb34470.

### Fixer B: triage tests (anti-rug, dashboard, DB, TX, scripts)

### Phase 23: Code Review Fix Report (fixer B)

**Fixed at:** 2026-11-13T03:09:33Z
**Source review:** .planning/phases/23-test-safety-net-harness-triage-characterization/23-REVIEW.md
**Iteration:** 1
**Worktree / branch:** `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/wt-B`, branch `fix23-B`, from f6f6589. Every edit, run and commit was made there. All verification ran in that worktree (Node 22.16.0), not in the main checkout.

**Summary:**
- Findings in scope: 7 (CR-01, CR-02, CR-03, WR-07, WR-08, WR-09, WR-10)
- Fixed: 7
- Skipped: 0
- Files changed: test files and triage fixtures only. Nothing under `src/`, `scripts/`, `test/realpath/harness/**`, `.planning/` or `test/realpath/recordings/` was edited. Fixer C's AUD-BUY-*/AUD-EXIT-* files were not touched.

**How the mutants ran.** Every mutant ran in memory with `npx vitest run --config scripts/vitest.in-memory-mutant.config.ts --project realpath <test file>` and `CSB_MUTANT_SPEC` set in that command's environment. The child-process test (AUD-ANTIRUG-002) used the full spec shape the proof runner writes (`root`, `ackDir`, `childHook`, `workerHook`, hooks calling `installOverlay`), and the `child` ack marker confirmed the mutant reached the railed child. AUD-SCRIPTS-002 reads the scripts through the TypeScript compiler API, and its fix touches four files, so its mutants used a custom worker hook (see WR-10). `git status --porcelain -- src` was empty after every run; the runner script printed it each time.

**"Old test" checks.** For each finding I also ran the f6f6589 version of the test (a temporary `zzOld*.test.ts` copy, or the old fixture swapped in briefly, removed or restored right after) under the review's failing shape. Each one reproduced the review's complaint: it stalled or read "looks fixed". So each change answers an observed failure, not a guessed one.

#### knownBug change table

Claims that are not listed (all of CR-01, CR-02, WR-07, WR-09, WR-10) kept the same claim, the same `correct`/`observed`/`actual` shape and the same plain texts. Their stored records are byte-identical to the baseline, as the final diff shows.

| ID | Claim (unchanged name) | correct (new) | observed (new) | actual shape (new) | expectedPlain | actualPlain |
|---|---|---|---|---|---|---|
| AUD-TX-002 | passthrough-wait-holds-wallet-lock | `{laterOperationStartedInWindow:true, stuckNonceSettledBeforeRelease:true}` | `{laterOperationStartedInWindow:false, stuckNonceSettledBeforeRelease:false}` | `{laterOperationStartedInWindow:boolean, stuckNonceSettledBeforeRelease:boolean}` | changed to: "On Base and Arbitrum a buy whose transaction is never mined gives up waiting after a bounded time, settles the stuck nonce (a same-nonce replacement or cancel is mined) and only then releases the wallet lock, so the wallet can buy and sell again without signing that nonce twice." | unchanged |
| AUD-BUY-025 | deliberate-public-wait-holds-wallet-lock | same two fields, both true | both false | same two booleans | changed to: "A deliberate public buy whose transaction is never mined gives up waiting after a bounded time, settles the stuck nonce (a same-nonce replacement or cancel is mined) and only then releases the wallet lock." | unchanged |
| AUD-EXIT-009 | approval-wait-holds-wallet-lock | same two fields, both true | both false | same two booleans | changed to: "An exit whose approval transaction is never mined gives up waiting after a bounded time, settles the stuck nonce (a same-nonce replacement or cancel is mined) and only then releases the wallet lock and the token's sell lock." | unchanged |
| AUD-ANTIRUG-018 | restart-gap-blinds-http-poller | `{gapLogEvaluated:true, rugEvaluated:true, cursorReachedRugBlock:true, healthShown:'connected'}` | `{gapLogEvaluated:false, rugEvaluated:false, cursorReachedRugBlock:false, healthShown:'connected'}` | adds `gapLogEvaluated:boolean` as the first field | changed to: "After a restart on a chain without a WebSocket URL, the anti-rug poller catches up the missed blocks in provider-sized requests, evaluating the logs mined during the downtime, and then evaluates a liquidity pull on a held position." | changed to: "After 6 minutes of downtime the poller asked for the whole 30-plus-block gap in one eth_getLogs every 2 seconds; the provider refused every request (10-block limit), the cursor never moved, neither an LP log mined during the downtime nor a 95 percent liquidity pull after it was ever evaluated, and the dashboard was told the chain was connected." |

What each changed claim now means, though not a record field:
- **AUD-ANTIRUG-002 `boot-refused-connect-exits`:** `outcome:'survived'` now requires the bot connected again after the port reopened.
- **AUD-SCRIPTS-002:** `correct` is pinned to the named script set instead of being derived from `actual`. Its value today is identical.
- **AUD-DB-001:** `limitEnforced: true` via a load failure now requires a refusal naming the variable.

#### Proposals

None. No stronger test measured the bug as larger, smaller or different from the register. Two observations, not register changes:
- CR-03: on the passthrough site, a bounded wait with no explicit cancel does not get a same-nonce replacement from the existing `submitWithReconciliation`. It reads "the failure changed", so a Phase 24 fix there must cancel or replace explicitly.
- CR-01: the partial fix "DEX loops stop writing `ctx.wsProvider`" correctly flips claims 1 and 2 but leaves claim 3 recording. Phase 24 should not expect one partial change to flip all three.

#### Final outputs

- **Baseline:** `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/B-baseline.json`. 361 tests: 359 passed, 2 failed. The two failures are the expected location-only `harnessRestart.test.ts` tests.
- **Final:** `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/B-final.json`. 361 tests: 359 passed, 2 failed (the same two `harnessRestart.test.ts` tests).
- **Diff** (`C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/B-diff.cjs`):
  - No test changed status; none was added or removed.
  - The only `meta.knownBugs` differences are the four deliberate ones in the table: AUD-TX-002, AUD-BUY-025 and AUD-EXIT-009 (`expected`, `actual`, `expectedPlain`), and AUD-ANTIRUG-018 (`expected`, `actual`, `expectedPlain`, `actualPlain`).
- **Other checks:**
  - `git status -- test/realpath/recordings`: empty. `git status -- src`: empty.
  - Two runs of the location-failing `harnessRestart` test each left an untracked `test/realpath/refused-<pid>.db` in the worktree. Both were removed; `git status` in the worktree is clean.
  - `npm run check:realpath-mocks`: "47 vi uses (7 mock calls) checked in 109 files ..., 0 violations".
  - `npm run check:census`: "24 transaction-signing sites (locked 11, unlocked 13, unknown 0), floor 24; ... 0 problem(s)". This is the state at f6f6589; I touched no src/ or scripts/ file.
  - `npx tsc --noEmit -p tsconfig.json`: exit 0. That config includes only `src/`. The triage tests were also type-checked with a scratchpad config extending it (`C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/tsc/tsconfig.tests.json`): the same 5 TS1343 `import.meta` errors as before my edits, none in a changed file.
- **Commits on `fix23-B`:** 31d778a (CR-01), 1d1d65e (CR-02), 5b6a3e4 (CR-03), 77c266e (WR-07), f11d64b (WR-08), 7f53d52 (WR-09), e218bbb (WR-10).

#### Appendix: mutant specs

Base specs (`file` + `edits`) are in `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/specs/`. The generators are `mk-antirug001.cjs`, `mk-db001.cjs`, `mk-tx002.cjs`, `mk-wr07.cjs`, `mk-wr08.cjs`, `mk-wr09.cjs` and `mk-wr10.cjs`; `mkfull.cjs` adds root, ackDir and the hooks for child-reaching runs. The exact JSON passed as `CSB_MUTANT_SPEC`:

```
antirug001-single-loop          {"file":"src/bot.ts","edits":[{"find":"(wsProvider.websocket as any).on('close', handleWsCloseV3);","replace":"__csbReattach(ctx, (p) => { new Contract(dex.factoryAddress, V3_FACTORY_ABI, p).on('PoolCreated', v3Listener); });"},{"find":"(wsProvider.websocket as any).on('close', handleWsClose);","replace":"__csbReattach(ctx, (p) => { new Contract(dex.factoryAddress, FACTORY_ABI, p).on('PairCreated', listener); });"},{"find":"async function startHttpPollingListener(ctx: ChainContext, dex: DexConfig): Promise<void> {","replace":"<helper __csbReattach: per-ctx consumer list; Object.defineProperty(ctx,'wsProvider',{get,set}) whose setter destroys the replaced provider (if not destroyed) and calls every consumer with the new provider>\n\nasync function startHttpPollingListener(ctx: ChainContext, dex: DexConfig): Promise<void> {"}]}
antirug001-partial-no-ctx-write {"file":"src/bot.ts","edits":[{"find":"                    ctx.wsProvider = newWsProvider;\n                    const newV3Factory","replace":"                    const newV3Factory"},{"find":"                ctx.wsProvider = newWsProvider;\n                const newFactory","replace":"                const newFactory"}]}
db001-refuse-start              {"file":"src/riskManager.ts","edits":[{"find":"const riskConfig = loadRiskConfig();","replace":"function __csbStrictRisk(): void { for (const k of ['MAX_OPEN_POSITIONS','MAX_TOTAL_EXPOSURE','DAILY_LOSS_PCT','SNIPE_COOLDOWN_MS','MAX_POSITION_SIZE']) { const v = process.env[k]; if (v !== undefined && v !== '' && !Number.isFinite(Number(v))) throw new Error(`${k} must be a finite number; got ${JSON.stringify(v)}`); } }\n__csbStrictRisk();\nconst riskConfig = loadRiskConfig();"}]}
db001-unrelated-import-error    {"file":"src/riskManager.ts","edits":[{"find":"const riskConfig = loadRiskConfig();","replace":"{ const g = globalThis as any; const k = '__csbLoads:' + process.env.DB_PATH; g[k] = (g[k] ?? 0) + 1; if (g[k] === 3) throw new Error('provider pool exhausted on reload'); }\nconst riskConfig = loadRiskConfig();"}]}
db001-stop-step-error           {"file":"src/utils/exitManager.ts","edits":[{"find":"export function clearAllTimers(): void {","replace":"export function clearAllTimers(): void {\n    { const g = globalThis as any; const k = '__csbStops:' + process.env.DB_PATH; g[k] = (g[k] ?? 0) + 1; if (g[k] === 3) throw new Error('timer registry: a handle was already released'); }"}]}
tx002-passthrough-correct       {"file":"src/utils/mevStrategies/passthrough.ts","edits":[{"find":"const receipt = await tx.wait(3);","replace":"let __rec: any;\n        try {\n            __rec = await tx.wait(3, 120_000);\n        } catch (__waitErr) {\n            const __mf = (tx.maxFeePerGas ?? tx.gasPrice)!;\n            const __tip = (tx.maxPriorityFeePerGas ?? tx.gasPrice)!;\n            const __cancel = await (wallet as any).sendTransaction({ to: wallet.address, value: 0n, nonce: tx.nonce, gasLimit: 21_000n, maxFeePerGas: __mf * 2n, maxPriorityFeePerGas: __tip * 2n });\n            await __cancel.wait(1, 120_000);\n            throw __waitErr;\n        }\n        const receipt = __rec;"}]}
tx002-passthrough-wrong         {"file":"src/utils/mevStrategies/passthrough.ts","edits":[{"find":"const receipt = await tx.wait(3);","replace":"const receipt = await tx.wait(3, 120_000);"}]}
tx002-deliberate-correct        {"file":"src/bot.ts","edits":[{"find":"const rec = await stx.wait();","replace":"<same block as passthrough-correct with stx, ctx.wallet, ctx.wallet.address, wait(1, 120_000)>\n        const rec = __rec;"}]}
tx002-deliberate-wrong          {"file":"src/bot.ts","edits":[{"find":"const rec = await stx.wait();","replace":"const rec = await stx.wait(1, 120_000);"}]}
tx002-approval-correct          {"file":"src/exitEngine.ts","edits":[{"find":"const approveTx = await token.approve(spender, amount);\n        await approveTx.wait();","replace":"const approveTx = await token.approve(spender, amount);\n        <same block with approveTx, token.runner, ownerAddress, wait(1, 120_000)>\n        void __rec;"}]}
tx002-approval-wrong            {"file":"src/exitEngine.ts","edits":[{"find":"const approveTx = await token.approve(spender, amount);\n        await approveTx.wait();","replace":"const approveTx = await token.approve(spender, amount);\n        await approveTx.wait(1, 120_000);"}]}
wr07-boot-retry-correct         {"file":"src/utils/provider.ts","edits":[{"find":"        provider = new ethers.WebSocketProvider(wsUrl, chainId);\n        wsProviders.set(network, provider);","replace":"        provider = __csbBuildWs(network, wsUrl, chainId, 1000);"},{"find":"/**\n * Destroy and remove a cached WebSocket provider (for cleanup/reconnect).\n */","replace":"<function __csbBuildWs: new WebSocketProvider, cache it, ws.on('open') marks opened, ws.on('error') before open schedules destroy + __csbBuildWs(delay*2, cap 60 s) after `delay`>\n\n/**\n * Destroy and remove a cached WebSocket provider (for cleanup/reconnect).\n */"}]}
wr07-boot-listener-only         {"file":"src/utils/provider.ts","edits":[{"find":"        provider = new ethers.WebSocketProvider(wsUrl, chainId);\n        wsProviders.set(network, provider);","replace":"        provider = new ethers.WebSocketProvider(wsUrl, chainId);\n        wsProviders.set(network, provider);\n        (provider.websocket as any).on('error', () => undefined);"}]}
wr08-chunked-correct            {"file":"src/anti-rug/detector.ts","edits":[{"find":"            const events = await ctx.httpProvider.getLogs({\n                address: addresses,\n                fromBlock: lastBlock + 1,\n                toBlock: currentBlock,\n                topics: [\n                    [\n                        PAIR_BURN_TOPIC,\n                        PAIR_TRANSFER_TOPIC,\n                        POOL_BURN_TOPIC,\n                        POOL_COLLECT_TOPIC,\n                    ],\n                ],\n            });","replace":"            const events = await getLogsForBackfill(ctx, lastBlock + 1, currentBlock, addresses, [[PAIR_BURN_TOPIC, PAIR_TRANSFER_TOPIC, POOL_BURN_TOPIC, POOL_COLLECT_TOPIC]]);"}]}
wr08-jump-at-start              {"file":"src/anti-rug/detector.ts","edits":[{"find":"        lastBlock = chainStateRow.last_seen_block;","replace":"        lastBlock = await ctx.httpProvider.getBlockNumber();\n        upsertChainState.run(chainName, lastBlock, Math.floor(Date.now() / 1000));"}]}
wr08-skip-wide-gap              {"file":"src/anti-rug/detector.ts","edits":[{"find":"            const events = await ctx.httpProvider.getLogs({\n                address: addresses,\n                fromBlock: lastBlock + 1,\n                toBlock: currentBlock,\n                topics: [","replace":"            if (currentBlock - lastBlock > ctx.chain.antiRug.backfillCapBlocks) lastBlock = currentBlock - 1;\n            const events = await ctx.httpProvider.getLogs({\n                address: addresses,\n                fromBlock: lastBlock + 1,\n                toBlock: currentBlock,\n                topics: ["}]}
wr09-003-dedupe                 {"file":"src/anti-rug/exitTrigger.ts","edits":[{"find":"const log = logger.child({ module: 'antiRug:exitTrigger' });","replace":"const log = logger.child({ module: 'antiRug:exitTrigger' });\nconst __csbInFlight = new Set<number>();"},{"find":"        'Anti-rug exit dispatched to executeFullSell',\n    );","replace":"        'Anti-rug exit dispatched to executeFullSell',\n    );\n    if (__csbInFlight.has(tradeId)) return false;\n    __csbInFlight.add(tradeId);"},{"find":"    // (c) Broadcast exit-fired update for the dashboard.","replace":"    __csbInFlight.delete(tradeId);\n    // (c) Broadcast exit-fired update for the dashboard."}]}
wr09-003-dedupe-still-counts    same as wr09-003-dedupe, but the duplicate branch is: if (__csbInFlight.has(tradeId)) { incrementCircuitBreaker(ctx, makeTriggerEvent(chain, tokenAddress, pairAddress, evaluation, 'exit-fired-failure')); return false; }
wr09-004-retry                  {"file":"src/anti-rug/detector.ts","edits":[{"find":"        // Still unsafe at confirm block → fire the exit.\n        await triggerAntiRugExit(","replace":"        // Still unsafe at confirm block → fire the exit.\n        const __ok = await triggerAntiRugExit("},{"find":"            evaluation,\n        );\n    };\n    ctx.httpProvider.on('block', blockHandler);","replace":"            evaluation,\n        );\n        if (!__ok && getRegisteredPositions(ctx.chain.name).some((p) => p.tradeId === position.tradeId)) void scheduleConfirmBlocksGate(ctx, position, evaluation, poolType, destination);\n    };\n    ctx.httpProvider.on('block', blockHandler);"}]}
wr10-all-hold-lock / wr10-live-only / wr10-detection-lost   multi-file worker hooks (see WR-10); files and edits in specs/full/wr10-*/spec.json and worker.cjs
```

Angle-bracketed parts above abbreviate long replacement bodies. The verbatim JSON is in the spec files named on the left.

---

_Fixed: 2026-11-13T03:09:33Z_
_Fixer: Claude (gsd-code-fixer, fixer B)_
_Iteration: 1_

### Fixer C: triage tests (buy, exit)

### Phase 23: Code Review Fix Report (fixer C)

**Fixed at:** 2026-11-12
**Source review:** .planning/phases/23-test-safety-net-harness-triage-characterization/23-REVIEW.md
**Iteration:** 1
**Worktree / branch:** `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/wt-C`, branch `fix23-C`, from f6f6589. All verification ran in this isolated worktree (Node 22.16.0), not in the main checkout.

**Summary:**
- Findings in scope: 16 (CR-04, CR-05, CR-06, CR-07, WR-11 .. WR-22)
- Fixed: 16
- Skipped: 0

Nothing under `src/` was written. `git status -- src` was empty after every mutant run (each run prints it). `git status -- test/realpath/recordings` is empty.

#### How the proofs were run

Every mutant ran in memory only, with `scripts/vitest.in-memory-mutant.config.ts` and `CSB_MUTANT_SPEC` set in the child's environment. Helper: `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/C-mut/runmut.cjs`. It builds the spec with `root` (the worktree), a temp `ackDir`, and `childHook` / `workerHook` files that call `installOverlay`, the same way `scripts/red-proof-conversions.ts` does. It checks every `find` against the file on disk before the run, prints each test's status, its knownBug records and its failure, prints the reach markers (`vite`, `child`), and prints `git status --porcelain -- src` afterwards.

Every mutant spec (full JSON `{ file, edits: [{ find, replace }] }`) is kept in `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/C-mut/specs/`. Each finding below names the spec files it used and summarizes what each one edits.

Outcome words used below:
- **RED**: the test passes and records the knownBug.
- **FLIPS**: the test throws "<id> now behaves correctly ... (it looks fixed)".
- **CHANGED**: the test fails with "<id>: the failure changed from what was recorded".
- **RECORDS + detail fails**: the marker records the bug, then a plain detail assertion after the marker fails. It never reads "looks fixed".

#### knownBug record changes (for regenerating the triage evidence and report)

The exact final records (`correct` as `expected`, `actual`, and both plain texts) are in `C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/C-final.json` (`meta.knownBugs`).

| ID / claim | Change | correct | observed / actual today | Plain texts |
|---|---|---|---|---|
| AUD-BUY-008 / restart-stacks-reconnect-loop | shape: number becomes per-DEX map | `{reconnectLoopsForOneClose:{uniswap-v2:1,sushiswap-v2:1,uniswap-v3:1}}` | `{…:{2,2,2}}` | both changed (V2 and V3 named) |
| AUD-EXIT-007 / emergency-sell-v3-not-landed-leaves-no-poll | NEW | `{stillPolled:true}` | `{stillPolled:false}` | new |
| AUD-EXIT-007 / antirug-v3-not-landed-leaves-no-poll | NEW | `{stillPolled:true}` | `{stillPolled:false}` | new |
| AUD-EXIT-008 / operator-emergency-sell-refused-while-routine-paused | NEW | `{operatorSellRuns:true}` | `{operatorSellRuns:false}` | new |
| AUD-BUY-010 / max-open-positions-overspent | shape: + `bRefusedBy` | `{buysLanded:1,bRefusedBy:'max_positions'}` | `{buysLanded:2,bRefusedBy:null}` | actualPlain changed (cooldown off) |
| AUD-EXIT-002 / first-quote-failure-leaves-position-unmonitored | same shape; persistent fault; protection is timer or this position's alert | `{protectedOrOperatorTold:true}` | `{…:false}` | both changed |
| AUD-EXIT-002 / first-quote-transient-failure-leaves-position-unmonitored | NEW | `{protectedOrOperatorTold:true}` | `{…:false}` | new |
| AUD-BUY-002 / balanceof-error-flips-landed-buy-to-failed | same shape; persistent fault; `monitored` is now the timer | unchanged | unchanged | unchanged (test title changed) |
| AUD-BUY-002 / failed-row-not-resumed-after-restart | same shape; also counts `exit.monitor.resumed` | unchanged | unchanged | unchanged |
| AUD-BUY-003 / v2-quote-failure-sends-zero-amount-out-min | shape: `unboundedSwapSent` becomes `swapSentBelowQuoteFloor` | `{swapSentBelowQuoteFloor:false}` | `{…:true}` | expectedPlain changed |
| AUD-BUY-003 / v3-quote-failure-sends-zero-amount-out-minimum | same as V2 | `{swapSentBelowQuoteFloor:false}` | `{…:true}` | expectedPlain changed |
| AUD-EXIT-001 / v2-full, v3-full, v2-partial, v3-partial private-sell-no-output-floor | shape: `outputFloorAboveZero` becomes `outputFloorAtLeastQuoteLessSlippage` (`{submitted, relayBody}`) | `{…:{true,true}}` | `{…:{false,false}}` | expectedPlain changed (all 4) |
| AUD-BUY-028 / unicrypt-one-percent-lock-passes, mudra-one-percent-lock-passes | shape: + `lockGatePassed`, `otherGatesPassed` | `{lockedShareOfLpPct:1,lockGatePassed:false,otherGatesPassed:true,buySubmitted:false}` | `{1,true,true,true}` | unchanged |
| AUD-EXIT-003 / probe-is-eth-buy-wei-as-token-amount | shape: `probeIsEthBuyAmountInWei` becomes `exitPriceFitsPosition` | `{exitPriceFitsPosition:true}` | `{…:false}` | unchanged |
| AUD-EXIT-003 / zero-entry-infinite-ratio-fires-every-partial-tier | shape: + `stillProtected` | `{soldAtA1PercentRise:[],stillProtected:true}` | `{['50%'],true}` | unchanged |
| AUD-EXIT-003 / zero-entry-nan-ratio-fires-stop-loss | shape: + `stillProtected` | `{exitTriggeredWithNoPriceMove:false,stillProtected:true}` | `{true,true}` | unchanged |
| AUD-EXIT-014 / antirug-exit-refused-while-sell-lock-held | shape: `antiRugExitRefusedAtOnce` becomes `antiRugExitSucceeded` (claim name kept) | `{antiRugExitSucceeded:true}` | `{…:false}` | both changed |
| AUD-BUY-005 / v2-listener-unhandled-rejection-exits | NEW | CORRECT (survived) | `exitedWith('TypeError: The database connection is not open')` | new |
| AUD-BUY-027 / non-native-v3-pool-processed | NEW | `{processedAsSnipe:false,buySubmitted:false}` | `{true,true}` | new |

WR-11 (behavior only), WR-12, WR-18, WR-19 and WR-20 change no record. knownBug records: 97 in the baseline, 103 at the end (6 new claims).

#### Proposals (register not edited)

1. **AUD-EXIT-014: what counts as a complete fix.** Measured in today's scenario, the routine exit's first private attempt misses and its second lands about 76 s after the rug, and it holds both the sell lock and the wallet's nonce lock throughout. The anti-rug watchdog is 60 s. Two consequences:
   - A plain wait-for-the-lock inside `executeFullSell`, or an anti-rug exit that skips only the sell lock, ends in `antirug.exit.bounded-abort` (success false) for each of the three dispatches.
   - Today, the three immediate refusals from one pull already trip the anti-rug circuit breaker (`antirug.cb-tripped` appears in today's run).

   Proposed: add to AUD-EXIT-014's recommendation that a fix must outlive or pre-empt an in-flight exit that holds the nonce lock (queue-and-retry outside the watchdog, or a same-nonce replacement). Cross-reference AUD-ANTIRUG-003 for the circuit-breaker trip on one pull.
2. **AUD-EXIT-007: the anti-rug path.** Measured: on the V3 anti-rug path, `triggerAntiRugExit`'s 60 s watchdog fires before the private escalation ends. It broadcasts `success:false` and alerts that the position "is still held + monitored", while `executeFullSell` keeps running, later takes the V3 no-fallback return, and leaves no poll timer. Proposed: add this evidence to AUD-EXIT-007. The watchdog's "still monitored" alert is false on this path, and the abort leaves the in-flight sell's result unobserved.
3. **AUD-EXIT-002.** Proposed: register the new claim `first-quote-transient-failure-leaves-position-unmonitored` beside the base claim, which is now the persistent-failure case.
4. **AUD-BUY-005.** Proposed: move the V2 WebSocket listener call from "not exercised" to proven (claim `v2-listener-unhandled-rejection-exits`). The remaining un-awaited sites stay unproven.
5. **New claims.** AUD-EXIT-007 (2), AUD-EXIT-008 (1) and AUD-BUY-027 (1) need register entries.

#### Final outputs

- **Baseline** (`C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/C-baseline.json`): 361 tests, 354 passed, 7 failed.
  - Two are the expected location failures in `harnessRestart.test.ts`.
  - The other five failed under shared-machine load while fixer B was running: `harnessRestart` (the exit_state restart test), `recordingsGuard`, and the three `flashbots-v3` scenarios (a timeout spilling into recording comparisons).
  - Re-run alone at baseline time, only the two location failures remained.
- **Final** (`C:/Users/jackc/AppData/Local/Temp/claude/6e5f7d5f059d8da4/75502d8c-463b-4c99-86d9-410e44df19d3/scratchpad/C-final.json`): 369 tests, 367 passed, 2 failed. The two failures are the expected `harnessRestart` location failures.
- **Diff, baseline to final:**
  - The five load flakes went from failed to passed. Nothing else changed status.
  - 8 new tests: AUD-EXIT-007 ×2, AUD-EXIT-008 ×1, AUD-EXIT-002 transient ×1, AUD-BUY-005 V2 ×3, AUD-BUY-027 V3 ×1.
  - 2 tests renamed: the AUD-BUY-002 claim-1 title and the AUD-EXIT-002 persistent title. Both pass.
  - knownBug records: 6 new, and the changed records listed in the table above. No record was lost.
- **Gates:**
  - `git status -- test/realpath/recordings`: empty.
  - `git status -- src`: empty.
  - `npm run check:realpath-mocks`: 0 violations.
  - `npm run check:census`: 24 sites, 0 problems.
  - `npx tsc --noEmit -p tsconfig.json`: exit 0.
  - Test-file typecheck (a temp config in the scratchpad that includes `AUD-BUY-*` and `AUD-EXIT-*`): exit 0.
- **Cleanup:** the stray `test/realpath/refused-*.db` files that the location-failing `harnessRestart` test leaves in the worktree were removed. The worktree is clean apart from the 16 commits.

---

_Fixed: 2026-11-12_
_Fixer: Claude (gsd-code-fixer, fixer C)_
_Iteration: 1_

---

_Fixed: 2026-11-13T04:52:58.533Z_
_Fixer: Claude (gsd-code-fixer), five fixers in separate worktrees, merged by the orchestrator_
_Iteration: 1_
