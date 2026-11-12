---
phase: 23-test-safety-net-harness-triage-characterization
plan: 20
subsystem: testing
tags: [golden-master, characterization, realpath-harness, flashbots, vitest, ethers, secret-scan, CHAR-02]

requires:
  - phase: 23-02
    provides: the ordered timeline (op, submit, relay, db with `at`), installDbCapture, recordedLogs
  - phase: 23-27
    provides: the harness ownership rule (this plan adds only test/realpath/harness/serializer.ts)
  - phase: 23-07
    provides: fixtures/AUD-EXIT-002-position.ts and fixtures/AUD-EXIT-001-sell-path.ts (buy, arm, sell side, foreignTrade)
  - phase: 23-08
    provides: fixtures/AUD-EXIT-014-rug.ts pullLiquidity
  - phase: 23-10
    provides: fixtures/AUD-ANTIRUG-003-live.ts (liveOverrides, liveGates, afterExitPoll)
  - phase: 23-09
    provides: fixtures/AUD-TX-002-lock.ts settleAntiRugArming
  - phase: 23-19
    provides: the AC-37 source-text gate every new test file must pass
provides:
  - "test/realpath/harness/serializer.ts: serializeTimeline, normalizeForRecording, recordingLine, compareRecording(relPath, text, { dir }), resolveRecordingPath, updateAllowed, tagIds, TAG_RE, EMPTY_SUBMITTED_LINE, UPDATE_SWITCH, RECORDINGS_DIR"
  - "test/realpath/scenarios/driver.ts: runScenario({ name, tag, chain, dexType, overrides, steps, assertComplete }), driveSlots (12 s block cadence), assertTagInRegister"
  - "test/realpath/recordingsGuard.test.ts: AC-21, AC-22, AC-23, AC-25, AC-26 and field-aware AC-51 over every file under test/realpath/recordings/**"
  - "Five committed recordings: flashbots-v2-trailing, -partial, -stop-loss, -urgency, -anti-rug (.jsonl), and recordings/.gitattributes (LF)"
  - "scripts/update-recordings.ts and npm script recordings:update: the only setter of VITEST_CSB_UPDATE_RECORDINGS"
affects: [23-21, 23-22, 23-23, 23-25, 23-26, phase-24, phase-27, phase-29]

actuals:
  tokens: 176172   # chars/4 over the added lines of dc3f3d9..29a4204 (12 files, 704691 chars; the urgency recording alone is about 500 KB)
  tasks: 3
  commits: 3       # MEASURED: git rev-list --count dc3f3d9..HEAD before this SUMMARY commit
plan_head_before: dc3f3d94c2694600f51ca406adecc4999a4f9a14
plan_head_after: 29a4204a42ca0ea6a48c99db645ae0388614b19b
commits: 3

tech-stack:
  added: []
  patterns:
    - "Golden-master recording: one LF file per scenario, header {scenario, tag}, one JSON line per timeline entry in recorded order, {\"submitted\":[]} when nothing was submitted"
    - "One normalizer for every recording and env snapshot: BigInt text, $nonFinite / $unsafeNumber / $error / $class / $circular objects, no paths, line numbers, stacks or ethers version"
    - "A scenario is compared only after its own assertComplete proved the exit finished; only an explicit wrapper sets the write switch"
    - "Field-aware secret scan: hashes only in named hash fields, signed transactions parsed and matched, URLs limited to loopback and the public hosts src/ names"
    - "Chain driven at the network's 12 s cadence after the trigger (driveSlots): a bundle lands only in a block it targets"

key-files:
  created:
    - test/realpath/harness/serializer.ts
    - test/realpath/scenarios/driver.ts
    - test/realpath/scenarios/flashbots-v2.test.ts
    - test/realpath/recordingsGuard.test.ts
    - test/realpath/recordings/.gitattributes
    - test/realpath/recordings/flashbots-v2-trailing.jsonl
    - test/realpath/recordings/flashbots-v2-partial.jsonl
    - test/realpath/recordings/flashbots-v2-stop-loss.jsonl
    - test/realpath/recordings/flashbots-v2-urgency.jsonl
    - test/realpath/recordings/flashbots-v2-anti-rug.jsonl
    - scripts/update-recordings.ts
  modified:
    - package.json

key-decisions:
  - "Recording format (D-12, D-13): header {scenario, tag}; op lines {kind, at, level, op, msg, fields, bindings}; submit lines {kind, at, route, status, hash, from, to, nonce, request (decoded by real ethers: type, chainId, nonce, to, value, gasLimit, fee fields, data), raw}; relay lines {kind, at, relay, url, method, params}; db lines {kind, at, table, op, inTransaction, row}; text ends in one LF"
  - "compareRecording path contract for every Phase 23 recording: relative to test/realpath/recordings/, `<name>.jsonl` for scenarios and `env/<VAR>.json` for env-snapshot cases; absolute, backslash, `..`-escaping and other extensions are refused"
  - "Writing needs VITEST_CSB_UPDATE_RECORDINGS exactly \"1\" and CI unset or empty; the rails keep the VITEST-prefixed key (proved by a run that wrote inside the worker); npm run recordings:update refuses CI and an empty filter list without --all"
  - "Exits are driven at the 12 s block cadence (driveSlots), not by mining each transaction at once: mining the approve within ethers' 250 ms request cache made the bot target an already-sealed block and land through the reconcile path, a path the real cadence does not produce"
  - "AC-51 rule added with its reason: entries of consideredByBuilders / sealedByBuilders may be 48-byte BLS public keys (0x + 96 hex), the relay's builder identities that src/utils/mevStrategies/flashbots.ts logs; without it the guard rejects every real recording (mutation-proved)"
  - "Tags: trailing, stop-loss and urgency SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-TX-012); partial SUSPECT(AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-025,AUD-TX-012); anti-rug SUSPECT(AUD-ANTIRUG-003,AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-014,AUD-TX-012); no KEEP (AC-46)"
  - "The first recording commit is babd7e4: plan 23-25's commit check judges every commit after it"

patterns-established:
  - "runScenario order: createScenario, steps, no strays, no capture violation, assertComplete, then serialize and compare; the tag's IDs are checked against the register first"
  - "assertComplete for an exit: the reason op, the sell mined in node.history, the node's own receipt decoded with ethers equal to the row the bot wrote, and the resulting DB state"

requirements-completed: [CHAR-02]

coverage:
  - id: D1
    description: "Serializer and compare step: LF text, recorded order, the exact {\"submitted\":[]} line, one normalizer, byte compare that only the update switch can turn into a write"
    requirement: CHAR-02
    verification:
      - kind: integration
        ref: "test/realpath/recordingsGuard.test.ts#serializer (AC-22, AC-26) (3 tests) and compare and write (AC-25), order (AC-23) (5 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Five Flashbots V2 recordings (trailing, partial, stop-loss, urgency, anti-rug), each byte-compared on a normal run after its assertComplete"
    requirement: CHAR-02
    verification:
      - kind: integration
        ref: "test/realpath/scenarios/flashbots-v2.test.ts (5 tests), three normal runs and three full parallel runs byte-identical"
        status: pass
    human_judgment: false
  - id: D3
    description: "Recordings guard: AC-21, AC-22, AC-26 and field-aware AC-51 over every recording, with temp-directory bad and good cases and the src/ host-literal check"
    requirement: CHAR-02
    verification:
      - kind: integration
        ref: "test/realpath/recordingsGuard.test.ts#recordings guard (AC-21, AC-22, AC-26, AC-51) (5 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Explicit update command: refuses CI and an empty filter list, re-records a deleted recording byte-identical to HEAD"
    requirement: CHAR-02
    verification:
      - kind: other
        ref: "CI=1 npm run recordings:update -- test/realpath/scenarios/flashbots-v2.test.ts (exit 2); npm run recordings:update (exit 2); delete flashbots-v2-partial.jsonl then npm run recordings:update -- test/realpath/scenarios/flashbots-v2.test.ts -t flashbots-v2-partial (exit 0, git diff --exit-code clean)"
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
    rationale: "Whether each tag names every confirmed finding the timeline shows is a review judgment (the plan's own verification for AC-46 is 'judgment: review of scenario tags against the register'); the per-scenario evidence and the findings ruled out are listed in this SUMMARY"

duration: 42min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 20: Golden-Master Recording and the Flashbots V2 Family Summary

**The bot's decision trace is now locked in five byte-compared recordings (a Flashbots V2 buy with a trailing, partial, stop-loss, urgency and anti-rug exit), each written only by `npm run recordings:update` after its scenario proved the exit finished, all tagged SUSPECT with the confirmed findings their timelines show, and guarded by a field-aware secret and format scan that ran over each file before its single commit.**

## Performance

- **Duration:** about 42 min
- **Started:** 2026-11-12T15:11:44Z
- **Completed:** 2026-11-12T15:53:19Z
- **Tasks:** 3 of 3
- **Files:** 12 (11 created, 1 modified)

## Accomplishments

- **Task 1 (tracer): the format, its guards and the first recording.** `serializeTimeline` writes a header `{scenario, tag}`, then one JSON line per timeline entry in recorded order, then the exact line `{"submitted":[]}` when nothing was submitted. Submit lines also carry the transaction request decoded by real ethers (value, gas, fees, calldata) beside the raw bytes. One normalizer turns BigInt into whole-number text, non-finite numbers into `{"$nonFinite":...}`, integer-valued doubles above 2^53 into `{"$unsafeNumber":...}` and errors into `{"$error":{name,code,message}}`, and strips paths, `file:line`, stack frames and ethers' `version=`. `compareRecording` byte-compares and names the first differing line; it writes only when the switch is `1` and CI is not set. `runScenario` refuses to compare before `assertComplete` passes. The guard test ran over `flashbots-v2-trailing.jsonl` and passed before the file's one commit (both in `babd7e4`).
- **Task 2: the other four exit types**, each driven through the real listener, buy bundle and polls on the fake clock, with the sell landing at a block it targets. Partial (2x:25) leaves the position open with tier `[0]` stored. Stop-loss is a 41 percent dump. Urgency waits out the 30-minute window with no price move. Anti-rug runs live (one confirm block, breaker threshold 10) on a real 95 percent liquidity pull, ending in `antirug.exit.dispatch` with no dry-run line. Each file was generated, read whole, guarded, run three times byte-identical and once under the full parallel load before its one commit (`4cc3757`).
- **Task 3: the update command and the write and order proofs.** `scripts/update-recordings.ts` is the only setter of the switch. It refuses CI and an empty filter list, and re-recorded a deleted file byte-identical to HEAD. The guard now proves AC-25: a changed input fails, the temp file is byte-unchanged, an absent file is never created, and CI or a switch other than `1` never writes. It also proves AC-23: given order is kept, no recording is sorted by content or kind, and the trailing recording holds the known buy and exit order, with same-time entries in the order they happened.

## Task Commits

1. **Task 1: recording format, guards and the trailing-stop scenario (tracer)** - `babd7e4` (test)
2. **Task 2: partial, stop-loss, urgency and anti-rug scenarios** - `4cc3757` (test)
3. **Task 3: update command, AC-25 write guard and AC-23 order proofs** - `29a4204` (feat)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## Files Created/Modified

- `test/realpath/harness/serializer.ts` - serializeTimeline, the normalizer, compareRecording and its path rules (the one harness file this plan adds, per the 23-27 ownership rule)
- `test/realpath/scenarios/driver.ts` - runScenario, assertTagInRegister, driveSlots
- `test/realpath/scenarios/flashbots-v2.test.ts` - the five scenarios and their completion proofs
- `test/realpath/recordingsGuard.test.ts` - 18 tests: the scan, its temp-directory cases, the src/ host check, serializer cases, AC-25 and AC-23
- `test/realpath/recordings/.gitattributes` - `* text=auto eol=lf`
- `test/realpath/recordings/flashbots-v2-{trailing,partial,stop-loss,urgency,anti-rug}.jsonl` - 56, 47, 53, 771 and 50 lines
- `scripts/update-recordings.ts` - the explicit update command
- `package.json` - one script, `recordings:update`; no dependency or other script changed

## Scenario Tags (AC-21, AC-46)

Line numbers are file lines (line 1 is the header). The buy half (lines 2 to 20) is the same in every recording.

**flashbots-v2-trailing** `SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-TX-012)`
- AUD-DB-004: the buy's bodies and submit are at lines 2-7 (+0.23 s), but the `trades` insert comes only at line 11 (+12.27 s), after the whole submission returned (inclusion at line 8).
- AUD-TX-012: the buy row (line 11) and the sell's close are decided at the inclusion block with no confirmation depth. The close is lines 47-55: included, executed, sell row, buy row sold, exit_state deleted, all within 20 ms of the block's arrival.
- AUD-DB-002: the buy row's `amount_in` is "0.01", a native decimal (line 11). The sell row's `amount_out` "9900684976949404" and `gas_cost` are wei (line 53).
- AUD-EXIT-003: `entry_price` 49849999502 at line 12 (and `entryPrice` at line 13) is the quote of `parseEther("0.01")` raw token units. Every later multiple is a ratio of such quotes (line 21 "2.25", line 24 "1.00x").
- AUD-ANTIRUG-024: chain_state is created with `last_seen_block` "0" (line 17). Then `antirug.backfill.gap-detected` (error, gapBlocks 21000002) at line 19.
- AUD-EXIT-004: a public `approve` of exactly the amount sold (0x6be13d77faddccae3e, the whole position), with ethers' default fees (maxFee 21 gwei = 2 x 10 gwei base + 1 gwei), at line 27, before the private sell.
- AUD-EXIT-001: the private sell at line 34, `swapExactTokensForETH(amount, 0, ...)`, has amountOutMin 0. The same raw is in the relay bodies at lines 32-33 and 35-37.
- AUD-ANTIRUG-015: the full close (lines 54-56: buy row sold, exit_state deleted, anti-rug unregistered) never deletes the `lp_baseline` row inserted at line 14.

**flashbots-v2-partial** `SUSPECT(AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-025,AUD-TX-012)`
- AUD-DB-004 lines 2-11. AUD-EXIT-003 lines 12-13. AUD-ANTIRUG-024 lines 17, 19.
- AUD-EXIT-004: line 24, a public approve of exactly the quarter (0x1af84f5dfeb7732b8f) at default fees.
- AUD-EXIT-001: line 30, the private partial sell with amountOutMin 0.
- AUD-TX-012: lines 40-44, the partial is recorded as executed and its row written at the inclusion block.
- AUD-DB-002: the `partial_sell` row (line 44) stores token units and wei, against the buy's "0.01" (line 11).
- AUD-EXIT-025: the completed tier is stored as the array index `"[0]"` (lines 45 and 47).
- AUD-ANTIRUG-015 is not cited: the position does not close.

**flashbots-v2-stop-loss** `SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-TX-012)`
- Same evidence shapes as trailing: lines 2-11 (DB-004, TX-012), 12-13 (EXIT-003), 17 and 19 (ANTIRUG-024).
- Line 21: the trigger "Fixed stop-loss at 0.59x (-40.8%)", a ratio of probe quotes (EXIT-003).
- Line 24: the public exact approve (EXIT-004). Line 31: the sell with min 0 (EXIT-001).
- Lines 44-52: the close at the inclusion block (TX-012); sell row wei at line 50 (DB-002).
- Lines 51-53: the close with no lp_baseline delete (ANTIRUG-015).

**flashbots-v2-urgency** `SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-TX-012)`
- Lines 2-20 as above. Lines 21-738 are the 30-minute window: each 5 s poll persists exit_state (361 updates) and logs `exit.poll.cycle`. Line 739 is the urgency trigger at +1812.3 s ("1.00x", a probe ratio).
- Line 742: the public exact approve. Line 752: the sell with min 0.
- Lines 762-770: the close at the inclusion block. Line 768: the sell row in wei. Lines 769-771: the close with no lp_baseline delete.

**flashbots-v2-anti-rug** `SUSPECT(AUD-ANTIRUG-003,AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-014,AUD-TX-012)`
- AUD-ANTIRUG-003: one liquidity pull schedules three confirm gates (lines 23-25, each triggerBlock 21000003) and three `antirug.exit.dispatch` (lines 30-32). Each matching log becomes its own gate and exit attempt.
- AUD-EXIT-014: of the three dispatches only one `exit.full.submitted` follows (line 34). The other two were refused because the first exit held the token's sell lock. executeFullSell's "Another exit already handling token" path logs no `op`, so the refusal shows as three dispatches and one exit.
- AUD-EXIT-004 line 33. AUD-EXIT-001 line 37: min 0, priority 2 gwei (the anti-rug gas multiplier 2.0).
- AUD-TX-012 lines 41-49. AUD-DB-002 line 47. AUD-ANTIRUG-015 lines 48-50. AUD-DB-004, AUD-EXIT-003 and AUD-ANTIRUG-024 as in the buy half.

**Confirmed findings checked and ruled out (all five unless noted):**
- AUD-TX-006: the `flashbots_getBundleStatsV2` body follows every inclusion (for example trailing lines 9 and 48). But the finding is a candidate kept open by TRIAGE-REVIEW-01, not confirmed. Its confirmed sub-claim is defined by running inside the wallet nonce lock, which a timeline cannot show. Not cited.
- AUD-TX-007 (base fee doubled in the affordability and reserve math), AUD-TX-010 (sells use the buy ceiling, reserve gas for a further sell), AUD-TX-021 and AUD-TX-027 (reserve math): no reserve is logged, the 10 ETH wallet is never refused, every bundle lands on its first attempt, and the buy's gasLimit 150000 cannot be told apart from a capped one.
- AUD-TX-016, -017, -019, -029: escalation, ceiling and alert paths are not reached (one attempt per bundle, calm fees).
- AUD-TX-028: provider batching and the network check are not on the timeline, and no scenario holds a call.
- AUD-BUY-002, -003, -004, -010, -018, -020, -025, -030, -033: failure, race, deliberate-buy and V3 paths are not exercised; the buy quote succeeds and amountOutMin is non-zero.
- AUD-BUY-009, -022, AUD-DB-018: alert text, which is not recorded.
- AUD-BUY-015, -016, -027, -028: no op lines come from the safety gates, the pair is WETH-paired, and ETH uses Unicrypt for the lock check.
- AUD-DB-001, -003, -013, -014: risk arithmetic is not on the timeline. AUD-DB-021: WAL durability is not observable.
- AUD-EXIT-002, -007, -008, -009, -013, -015, -019: first-quote failure, failed-exit, dashboard and resume paths are not exercised.
- AUD-EXIT-005: no overlapping polls; every `exit.poll.cycle` has durationMs 10.
- AUD-EXIT-021: harness alerts resolve at once, so no delay is observable.
- AUD-EXIT-022, -024, -026, -027: dust, non-zero allowance, fractional slippage and V3 proceeds are not exercised.
- AUD-EXIT-025 outside partial: the stored list is `"[]"`, with no completed tier.
- AUD-EXIT-014 and AUD-ANTIRUG-003 outside anti-rug: one exit per scenario, so there is no lock contention.
- AUD-ANTIRUG-005, -016: the only backfill is skipped by the gap (AUD-ANTIRUG-024), and there is one arm per scenario.
- AUD-ANTIRUG-009: the dry-run stamp written at first start (line 17) is correct; the floor that later reads it is not exercised.
- AUD-ANTIRUG-013: the trigger block equals the removal's own block here, so the processing-time count is not distinguishable.
- AUD-ANTIRUG-023: breaker trigger events are not on the timeline.
- AUD-ANTIRUG-001, -002, -008, -011, -018, -025: reconnect, restart, health and HTTP-poller paths. No scenario restarts the graph, so AUD-ANTIRUG-025 does not apply.
- Candidates visible but not cited, because they are not confirmed: AUD-TX-020 (a native confirm treated as success, the inclusion lines) and AUD-EXIT-020 (teardown on one balance read, the close lines).

## Hold Points (AUD-TX-028)

No scenario holds any call in flight. The buy lands one 12 s slot after submission (`buyAndMine`). After the trigger the chain runs at the 12 s cadence (`driveSlots`). No provider read, relay call or bundle is parked, so AUD-TX-028 cannot decide a result.

## Decisions Made

- The recording format, the path contract, the write switch and the tags are listed in key-decisions above.
- Drive exits at the network cadence, not by immediate mining. The first draft mined the approve within milliseconds of its send. The bot then read its target block from ethers' 250 ms request cache (one block stale), targeted a sealed block, got "not included" from the native confirm, and landed through `mev.reconcile.included`. That is real code under an unrealistic chain timing, so it is not representative. Under the 12 s cadence every sell lands natively at a block it targets.
- Every assertComplete checks the receipt the node returns for the sell, decoded with real ethers, against the bot's row. That is stronger than the bot's own `exit.receipt.decoded` line, which the partial path does not log at all.
- The urgency recording keeps its full 30-minute trace (771 lines, about 500 KB). Every poll persists exit_state, and trimming it would hide that behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The fixture's immediate mining produced an unrepresentative sell path**
- **Found during:** Task 1 (first draft of the trailing recording)
- **Issue:** `landNextSell` mines the approve at once. The sell then targeted an already-sealed block through ethers' 250 ms cache, and landed only through the reconcile path.
- **Fix:** Added `driveSlots` in `driver.ts`: a 12 s block cadence where a bundle lands only in a block it targets. The triage fixtures are unchanged.
- **Files modified:** test/realpath/scenarios/driver.ts, test/realpath/scenarios/flashbots-v2.test.ts
- **Verification:** the regenerated trailing recording shows `flashbots.bundle.included` at the sell's first target block (line 47); three runs are byte-identical.
- **Committed in:** babd7e4

**2. [Rule 3 - Blocking] AC-51 needed a rule for builder public keys**
- **Found during:** Task 1 (first guard run over the real recording)
- **Issue:** `flashbots.bundle.stats` logs `consideredByBuilders` / `sealedByBuilders`, which are 0x + 96-hex BLS public keys. The plan's rules reject every 64-hex run outside the named hash fields.
- **Fix:** Entries of those two arrays may be exactly 0x + 96 hex. The reason is written in the guard's header. A mutation without the rule fails the real recording at lines 10 and 49.
- **Files modified:** test/realpath/recordingsGuard.test.ts
- **Committed in:** babd7e4

**3. [Rule 3 - Blocking] The spawn-site rail gate refused `TAG_RE.exec(...)`**
- **Found during:** Task 1 (gate run)
- **Issue:** `test/unit/rails/spawnSites.test.ts` accepts `.exec()` only on named receivers.
- **Fix:** Used `String.prototype.match` in serializer.ts and in the guard. The rails are unchanged.
- **Committed in:** babd7e4

**4. [Rule 2 - Missing critical] Wider guard and serializer than listed**
- **Found during:** Tasks 1 and 3
- **Issue:** The listed rules left gaps. A sentinel embedded inside a longer string would pass. A 64-hex object key would pass. Structural defects would pass: a blank line, a missing final LF, a header whose name differs from its file, an empty-list line beside a submit. The normalizer also had no answer for a cycle, a live object, a Map or Set, bytes, or an integer-valued double above 2^53 (which a JSON reader would round).
- **Fix:** Each is now a rule or a normalized form with its own test case. The `.env` check matches upper-case `KEY=` only, so ordinary text such as `address=` passes.
- **Committed in:** babd7e4

**5. [Rule 2 - Missing critical] Update command refuses an empty filter list**
- **Found during:** Task 3
- **Issue:** Run with no filter, the wrapper would silently re-record every realpath recording.
- **Fix:** It requires test filters or an explicit `--all`. It exits 2 otherwise, proved by a run.
- **Committed in:** 29a4204

**6. [Rule 3 - Blocking] driver.ts gained a step size in Task 2**
- **Found during:** Task 2 (urgency)
- **Issue:** A 30-minute wait at 50 ms steps is 36,000 steps.
- **Fix:** Added `stepMs` (default 50, so the committed trailing recording is unchanged and its compare still passes). Urgency uses 1 s steps until its trigger, then 50 ms. driver.ts is not in Task 2's file list.
- **Committed in:** 4cc3757

---

**Total deviations:** 6 auto-fixed (1 Rule 1, 3 Rule 3, 2 Rule 2).
**Impact on plan:** Each change either makes the recordings representative or closes a way a secret or a malformed recording could pass. src/ and the harness files other than serializer.ts are unchanged.

## Grade Changes and New Findings

None. No finding was registered, regraded or changed in status, and no register file was edited, so AUDIT-FINDINGS.md was not re-rendered.

The stale-target path in deviation 1 was diagnosed and judged not to be a defect. Its cause is ethers' 250 ms request cache: `provider.getBlockNumber()` at src/utils/mevStrategies/flashbots.ts:218 was answered from a read made before the approve's block. The outcome was correct: the 3-block target window and the reconcile loop exist for exactly this, and the sell landed and was recorded. It occurs only when a block lands within 250 ms of the bot's previous head read. The same cache is already named in the AUD-BUY-030 recommendation (23-05).

## Issues Encountered

- Every recording holds one error-level line: `antirug.backfill.gap-detected` on a fresh database. That is AUD-ANTIRUG-024, cited in every tag. No other warn, error or fatal line appears in any recording.
- During the full runs, the two existing `preflightCli` tests took 12.4 to 16.1 s. Their limit is 150 s (describe) with a 60 s child, so this is not near half.
- One CR count of 56 came from shell quoting inside `"$(...)"`. A byte count confirmed 0 CR and 56 LF.

## Timing

| Test | Alone | Full parallel runs (3) | Limit |
|------|-------|------------------------|-------|
| flashbots-v2-trailing (pays the cold graph import) | 1.7-2.0 s | 2.35 / 2.38 / 2.69 s | 15 s |
| flashbots-v2-partial | 0.3-0.4 s | 0.80 / 1.00 s | 15 s |
| flashbots-v2-stop-loss | 0.35-0.5 s | 0.95 / 0.96 s | 15 s |
| flashbots-v2-urgency | 1.3-1.4 s | 2.98 / 2.67 s | 15 s |
| flashbots-v2-anti-rug | 0.9 s | 1.87 / 1.60 s | 15 s |
| recordingsGuard host-literal walk of src/ (slowest guard test) | 0.5 s | 1.25 / 1.33 / 1.11 s | 15 s |

No test of this plan is near half its limit, so none has its own `{ timeout }`. No hooks are declared apart from the guard's non-throwing temp cleanup.

Existing tests, measured under the full run for the record: backupState's self-check took 47.6 / 55.5 / 60.9 s of its 120 s limit (40 / 46 / 51 percent). That is the range 23-19 measured (52 to 66 s), a known load-sensitive child test and an existing STATE watch item; it is not this plan's and is left unchanged. signingCensusGate took 61-62.5 s of 250 s, the AUD-EXIT-003 zero-entry test 27-31 s of 90 s, the crash fixtures at most 24.6 s of 120 s, and processLock at most 49.9 s of 120/300 s.

## Verification (Node 22.16.0)

- Task 1 verify: the scenario and guard pass, the file exists, and `git check-attr eol` reports `lf`. The tracer gate re-ran it after `babd7e4` and it passed. The guard and the recording were added in the same commit.
- Task 2 verify: 5 scenarios plus the guard pass on a normal run.
- Task 3 verify: three runs of `test/realpath/scenarios` and the guard, 18/18 each, with an identical digest of names, statuses and knownBug records (none in these files); `git diff --exit-code -- test/realpath/recordings` is clean.
- AC-24: three normal runs left all five files byte-identical to their generated bytes, and three full parallel runs left them untouched.
- Acceptance greps: `grep -cE '\.ts:[0-9]'` gives 0 for every recording; byte count 0 CR; no backslash; `git status --porcelain src` is empty.
- Full railed `npm test` (final tree 29a4204): 202 files, 1419/1419 (unit 950, integration 264, realpath 205), wall 176 s. Ledger run-20261112T154906-17888-a18e67: nonLoopbackAllowed 0, telegramAllowed 0. The earlier full runs gave 1410/1410 and 1414/1414.
- `tsc --noEmit` is clean on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json. Scratch tsconfigs extending the repo's: 0 errors over `test/realpath/**` and over `scripts/update-recordings.ts`.
- `check:realpath-mocks`: 35 vi uses, 7 mock calls, 96 files, 0 violations. `check:vi-mock`: 660 calls, 0 violations. `check:census`: 23 sites (10 locked, 13 listed), 0 problems, with no change in counts. sourceTextGate, spawnSites, realpathMockGate and signingCensusGate: 17/17. The AC-37 gate's allow list is untouched.
- `red-proof-conversions.ts --check-manifest`: MANIFEST-OK rows 36 files 11 guards 1 (unchanged).
- `check.ts`: `--stage partial`, `consolidation` and `triage` all give RESULT PASS fail 0, with no re_audit row needed. `--stage final` gives 135 FAILs, 12 of them from this plan: ledger rows for the 11 new files and the package.json re_audit. These are the same out-of-scope bookkeeping kind earlier Phase 23 plans reported.
- Mutation proofs (restored byte-identical, nothing committed):
  - Without the builder-key rule, the real recording fails at lines 10 and 49.
  - `updateAllowed` returning true fails the AC-25 test.
  - Ignoring CI fails the AC-25 test.
  - A scratch file setting the switch fails the setter scan.

## For Later Plans

- **23-21 and 23-22:** use `runScenario` and `driveSlots` from `test/realpath/scenarios/driver.ts`. Name recordings `<family>-<case>` (lower-case kebab-case) and give every scenario an `assertComplete`. bloXroute relay bodies carry `params.transaction`, which the guard parses as a signed transaction with or without `0x`. A scenario with no submission gets the empty-list line from `serializeTimeline` itself. Base and Arbitrum V2 buys cannot succeed today (AUD-BUY-016, the 23-28 ruling).
- **23-23:** call `compareRecording('env/<VAR>.json', text)` with text built by `JSON.stringify(normalizeForRecording(value))` plus a final LF. The guard scans `.json` files too. A sentinel value passes only under its own variable name (for example `"PRIVATE_KEY"` in `_baseline.json`) or under `walletPrivateKey`, `authKey` or `authHeader`.
- **23-25:** the first recording commit is `babd7e4`, so the commit check judges every commit after it. `.gitattributes` in the recordings folder came in that same commit.
- **Any re-record:** `npm run recordings:update -- <file> [-t <name>]`, then review `git diff -- test/realpath/recordings` and commit as a `behavior:` commit citing a register ID (D-18).

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

Ready for 23-21 and 23-22 (the Flashbots V3 family and the bloXroute, public, risk-gate and gas families), which reuse this driver, serializer and guard. CHAR-02 is shared with 23-21, 23-22 and 23-26, so it stays unmarked in REQUIREMENTS.md until the last of them finishes (requirements.ready-ids reports it blocked).

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*

## Self-Check: PASSED

- Files present: serializer.ts, driver.ts, flashbots-v2.test.ts, recordingsGuard.test.ts, recordings/.gitattributes, the five flashbots-v2-*.jsonl recordings, scripts/update-recordings.ts.
- Commits on this branch: babd7e4, 4cc3757, 29a4204 are all ancestors of HEAD.
- Commit count measured from the ledger: git rev-list --count dc3f3d9..29a4204 = 3.
- Acceptance criteria of all three tasks and the plan-level verification were re-run after the last task commit and pass.
