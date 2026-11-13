---
phase: 23-test-safety-net-harness-triage-characterization
plan: 01
subsystem: testing
tags: [vitest, ethers, realpath-harness, fake-node, flashbots, better-sqlite3, audit-register]

requires:
  - phase: 22-safety-rails-audit
    provides: Vitest rails (setup.cjs, ledgerRun.ts, net-deny), the sealed audit register and its check/render tools, the vi.mock and spawn-site gates
provides:
  - "realpath Vitest project with the ethers CommonJS alias and the rails setup files"
  - "test/realpath/harness/chain.ts: installSeams (with wsExports self-test hook), FakeWebSocket, FakeNode (handle, callLog, history, subscriptions, submitted, relay, strays, failNext, hold, releaseAll, faults)"
  - "test/realpath/harness/world.ts: FIXED_EPOCH_MS, useFixedClock, stepUntil, stepUntilTrue, stepFor, expectStillPending, loadGraph, routeHttp, createScenario (eth / uniswap-v2), disposeScenarios, assertNoStrays, assertAllFaultsFired"
  - "test/realpath/harness/setup.ts: the only vi.mock calls of the phase and the awaited afterEach (dispose, strays, faults)"
  - "AC-01 proven: one V2 Flashbots buy end to end on real ethers, the fake node and the real-migration database"
  - "AC-03 proven: unknown methods, reads and URLs, unfired faults and holds, a failed startup and a missed seam all fail loudly"
  - "Register: AUD-ANTIRUG-024 (new, S3) and AUD-ANTIRUG-018 raised S2 -> S1, each with its escalation record"
affects: [23-02, 23-04, 23-07, 23-16, 23-27, 23-28, phase-23-wave-5, phase-24]

actuals:
  tokens: 43209
  tasks: 2
  commits: 4
plan_head_before: 45d0e476470416d70ddbd6d0a03373f4b31a86ab
plan_head_after: 4a108b807eb65822363e28443d85b63fc4f6aaaa

tech-stack:
  added: []
  patterns:
    - "One globalThis-anchored harness state object (Symbol.for('csb.realpath.harness')) so vi.resetModules cannot split it"
    - "Every JSON-RPC call enters FakeNode.handle(body, connection?, via); subscriptions keep their connection"
    - "Faults and holds name their exact operation (method, selector, to, after-stage) and must fire, or afterEach fails"
    - "A call still parked at teardown is answered with an error, never a node answer; the disposer drains microtasks first"
    - "Bare-node tests reach the node through a real JsonRpcProvider with cacheTimeout -1 (ethers' 250 ms perform cache would otherwise hide repeated calls)"

key-files:
  created:
    - test/realpath/harness/setup.ts
    - test/realpath/harness/chain.ts
    - test/realpath/harness/world.ts
    - test/realpath/harness.test.ts
    - .planning/audit/findings/AUD-ANTIRUG-024.json
    - .planning/audit/escalations/ESC-ANTIRUG-02.json
    - .planning/audit/escalations/ESC-ANTIRUG-03.json
    - .planning/audit/sweep/contrib-PHASE23.json
  modified:
    - vitest.config.ts
    - .planning/audit/findings/AUD-ANTIRUG-018.json
    - .planning/audit/ledger/ANTIRUG.json
    - .planning/audit/AUDIT-FINDINGS.md

key-decisions:
  - "AUD-ANTIRUG-024 registered S3, capital none (operator: \"New finding, S3 (Recommended)\", ESC-ANTIRUG-02)"
  - "AUD-ANTIRUG-018 raised S2 -> S1 with corrected rationale (operator: \"Raise to S1 (Recommended)\"; WS-URL exposure: \"Not sure\"; ESC-ANTIRUG-03); card OD-48 (Phase 24) unchanged"
  - "Plans counting the 59 register entries (23-04 AC-08, 23-16) must also include AUD-ANTIRUG-024; AUD-ANTIRUG-018 is now S1 and belongs in the Wave 5 triage set and the 23-16 S0/S1 batch report"
  - "Standing operator instruction 2026-11-11: executors grade and register findings themselves and do not stop for severity questions (recorded verbatim in STATE.md)"
  - "Held calls released at teardown get a JSON-RPC error, not a normal answer, so no post-test progress can look like a node result"

patterns-established:
  - "failNext/hold handles: fired/heldCount, describe(); arming refuses a selector or to that the method cannot carry"
  - "expectStillPending(promise, virtualMs): proves a deadlock on fake time and reports when a promise settled inside the window"
  - "RED proofs for harness checks: scratch probe files and byte-for-byte restored mutations, never committed"

requirements-completed: [CHAR-01]

coverage:
  - id: D1
    description: "realpath Vitest project with the ethers CJS alias; seams proven attached (alias, getUrl hook, nested ws swap)"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harness.test.ts#rails installed in mode full for the realpath project"
        status: pass
      - kind: integration
        ref: "test/realpath/harness.test.ts#seam self-check: installSeams throws when its WebSocket swap does not reach ethers"
        status: pass
    human_judgment: false
  - id: D2
    description: "AC-01: one V2 Flashbots buy end to end through the real listener, real ethers signing, the fake node and the real-migration DB; decoded swap call and pending trades row asserted"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harness.test.ts#AC-01: one V2 Flashbots buy runs end to end on real ethers, the fake node and the real-migration database"
        status: pass
    human_judgment: false
  - id: D3
    description: "AC-03: unknown method, read and URL fail by name; unfired fault or hold fails; callLog keeps params/data/block tag; hold parks eth_sendBundle until release; failed createScenario leaves nothing behind; expectStillPending both ways"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "node node_modules/vitest/vitest.mjs run --project realpath test/realpath/harness.test.ts (11/11, three repeat runs)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Fake chain data is real-node-shaped (AC-48 prohibition: no response a real node could never return)"
    verification: []
    human_judgment: true
    rationale: "The plan marks this prohibition as judgment: review of fake transport data; no test can assert the absence of an impossible response"
  - id: D5
    description: "Register: AUD-ANTIRUG-024 (S3) and AUD-ANTIRUG-018 S1 with escalation records; register checks unchanged from baseline"
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial|consolidation (PASS), --self-test (18/18), --stage final (same 6 pre-existing FAILs)"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 01: Real-Path Harness Summary

**A real-path harness where a real PairCreated log drives the real listener, real ethers signs a Flashbots bundle into an in-process simulated node, and the buy lands in real SQLite through the real migrations; and every silent failure (unknown method, read or URL, unfired fault or hold, partial startup, missed seam) now fails the test by name.**

## Performance

- **Duration:** about 55 min wall clock, including two operator waits at blocking checkpoints
- **Started:** 2026-11-11T04:24:19Z (first executor, from .git/gsd-plan-start-23-01)
- **Completed:** 2026-11-11T05:19Z
- **Tasks:** 2 of 2, plus two operator rulings applied to the register
- **Files modified:** 12 (5 harness/config, 7 register)

## Accomplishments

- AC-01: one V2 Flashbots buy runs end to end. The submitted transaction decodes through real ethers to `swapExactETHForTokens` on the uniswap-v2 router, value `parseEther(snipeAmount)`, path `[WETH, token]`, and the `trades` row read from the real connection is `pending` / `buy`.
- AC-03: an unknown JSON-RPC method (even when the caller swallows the error), an unknown contract read and an unknown URL (axios, ethers FetchRequest, WebSocket connect) each fail the test naming what was asked; a fault or hold that never fired fails the test naming its operation.
- `failNext` and `hold` name the exact operation (method, selector, target, `after` stage), work on relay methods, and are refused at arming time when they could never match.
- `hold('eth_sendBundle')` is proven to park the bot's own relay call while virtual time passes; after `release()` the buy completes.
- A `createScenario` that fails after the graph or after the chain context leaves no listening port, no open socket, no fake clock and no environment change, and its disposer is idempotent.
- `expectStillPending` proves a never-settling promise on fake time and fails (naming when) on one that settles inside the window.
- Register: AUD-ANTIRUG-024 registered (S3) and AUD-ANTIRUG-018 raised to S1 per the operator's rulings, each with its escalation record.

## Task Commits

1. **Task 1: one V2 Flashbots buy end to end (AC-01)** - `05c1665` (feat), previous executor
2. **Ruling 1: register AUD-ANTIRUG-024 (S3) and ESC-ANTIRUG-02** - `e107f24` (docs), previous executor
3. **Ruling 2: raise AUD-ANTIRUG-018 to S1 and ESC-ANTIRUG-03** - `a5dd1c3` (docs)
4. **Task 2: make every silent failure loud (AC-03)** - `4a108b8` (test)

**Plan metadata:** recorded in the docs commit that adds this file.

## Files Created/Modified

- `vitest.config.ts` - `realpath` project (ethers CJS alias, rails setup files); other projects byte-unchanged
- `test/realpath/harness/setup.ts` - the phase's only `vi.mock` calls; awaited afterEach: dispose, strays, faults
- `test/realpath/harness/chain.ts` - `installSeams`, `FakeWebSocket`, `FakeNode` (now with `failNext`, `hold`, `releaseAll`, `faults`, `openSocketCount`, `socketsOpened`)
- `test/realpath/harness/world.ts` - clock, stepping, `expectStillPending`, `loadGraph`, `routeHttp`, `createScenario`, disposers, stray and fault checks
- `test/realpath/harness.test.ts` - 11 tests: rails status, AC-01, seven AC-03 tests, seam self-check, expectStillPending
- `.planning/audit/findings/AUD-ANTIRUG-024.json`, `escalations/ESC-ANTIRUG-02.json`, `sweep/contrib-PHASE23.json`, `ledger/ANTIRUG.json` - new S3 finding (ruling 1)
- `.planning/audit/findings/AUD-ANTIRUG-018.json`, `escalations/ESC-ANTIRUG-03.json` - S2 -> S1 (ruling 2)
- `.planning/audit/AUDIT-FINDINGS.md` - regenerated with `render.ts` after each ruling; `OPERATOR-DECISIONS.md` unchanged both times; `SEAL.json` untouched

## Checkpoints and Rulings

**Checkpoint 1 (Task 1, decision, gate blocking-human, new bug not in the register).** On a chain's first anti-rug start with a fresh database the dry-run stamp creates the `chain_state` row with `last_seen_block 0` before the backfill reads it, so the first start raises a false GAP DETECTED (error log, Telegram alert, dashboard event) for the whole chain history. Operator: "New finding, S3 (Recommended)". Recorded as AUD-ANTIRUG-024 (S3, capital none, confirmed) with ESC-ANTIRUG-02.

**Checkpoint 2 (decision, gate blocking-human, possible severity increase on a registered capital finding).** AUD-ANTIRUG-018's S2 rationale said protection "stays off until restart" after "an outage larger than the provider range limit". Code reading shows a restart does not clear it and ordinary downtime triggers it. Operator: "Raise to S1 (Recommended)"; to "Does any chain you run go without a WebSocket address in .env?": "Not sure". The "(Recommended)" label was the orchestrator's, not the operator's (recorded in ESC-ANTIRUG-03). `.env` was not read.

Applied per PROTOCOL.md: severity S1; rationale rewritten; three `sub_claims` (restart does not clear it; ordinary downtime triggers it; it is silent) with refs at the audit base and at HEAD; six evidence entries added; `escalation_ref` ESC-ANTIRUG-03; recommendation moved to Phase 24; `severity_history` entry. Card OD-48 already covers this finding, says it covers S1 capital findings, and is needed by Phase 24, so no card change was needed.

Line refs (audit base 23a6461 / HEAD): poller seed from chain_state `detector.ts:1228-1232 / :1231-1235`; no-positions advance `:1269-1276 / :1272-1279`; unchunked getLogs `:1279-1291 / :1282-1294`; advance after success `:1300-1306 / :1303-1309`; connected `:1242 / :1245`; error log `:1312 / :1315`; restart re-registers before the poller starts `bot.ts:2120-2144 / :2122-2146`; ETH 10-block range assumption `chainRegistry.ts:223-230` (500 at :294, :351, :408).

## Grade Changes and New Findings

| Item | Change | Graded by | Record |
|------|--------|-----------|--------|
| AUD-ANTIRUG-024 | new finding, S3, capital none, confirmed | operator ruling ("New finding, S3 (Recommended)") | ESC-ANTIRUG-02, `e107f24` |
| AUD-ANTIRUG-018 | S2 -> S1 (STRAND, confirmed, unchanged otherwise) | operator ruling ("Raise to S1 (Recommended)") | ESC-ANTIRUG-03, `a5dd1c3` |

No grade change and no new finding was made by this executor under the standing instruction of 2026-11-11 ("All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading").

One sibling observation was considered and folded in, not registered. Because the dry-run stamp creates the row first (AUD-ANTIRUG-024), the HTTP poller's no-row seed branch is never taken after the stamp, so on a chain's first start the poller starts at block 0. That only matters if a position is registered before the first 2 s tick, and the no-positions tick moves the start block to the head first. The mechanism (an unbounded range from a stale start) is AUD-ANTIRUG-018's, and the row-0 cause is AUD-ANTIRUG-024's, so it went into AUD-ANTIRUG-018's `sibling_sites_checked`. No separate entry was made.

## Consequences for Later Plans

- Plans that count "59 register entries" (for example 23-04 AC-08 and 23-16) must also count AUD-ANTIRUG-024 (new, S3).
- AUD-ANTIRUG-018 is now S1. It belongs in the Wave 5 triage set (a real-path test that fails today) and in the 23-16 S0/S1 batch report. Its fix is a Phase 24 capital fix (card OD-48). Whether any chain runs without a WS URL on the operator's setup is unknown. The grade does not depend on it.
- The standing operator instruction of 2026-11-11 replaces the "severity increase" and "bug not in the register" stop triggers (23-SPEC line 103 and the plans' phase-wide rules). It is recorded verbatim in STATE.md.

## Decisions Made

- Held calls released at teardown are answered with a JSON-RPC error (`the scenario was torn down while <method> was held`), never a normal node answer, so no post-test progress can look like a node result. The disposer then drains microtasks only, with no timers, before stopping timers and destroying providers. A caller therefore gets that answer instead of an ethers "provider destroyed" cancellation.
- A fault is checked before a hold. A fault answers at once. A hold parks every matching call until `release()`, and releasing ends the hold, so the bot's three follow-up `eth_sendBundle` fan-out calls pass.
- The ESC-ANTIRUG-03 tier is `immediate`, matching ESC-ANTIRUG-02: the Phase 23 stop-the-line rule stopped at once, although Phase 22's tier for an S1 is area-batch. `check.ts` does not tie tier to severity.

## Deviations from Plan

### Auto-fixed Issues and Additions (Task 1, carried from the previous executors)

1. **[Rule 1 - Bug] Mine timing:** one 12 s slot passes before mining, because the first poll of ethers' bundle wait only records the head (subscriber-polling.js). AC-01 waits one slot, then mines at the target block.
2. **[Rule 1 - Bug] Teardown order:** the disposer calls only `destroy()` on providers. Calling `removeAllListeners()` first produced two unhandled "provider destroyed; cancelled request (eth_unsubscribe)" rejections.
3. **[Rule 2 - Missing critical] Log storage and filter matching:** address and topic filter matching for `emitLogs`/`eth_getLogs`, added ahead of 23-28 (AC-48: a subscription must not get logs a real node would not send).
4. **[Rule 2 - Missing critical] Real launch transaction:** `addForeignTransaction` mines the launch's real signed `addLiquidityETH`, so `PairCreated` points at a real transaction in the same block.
5. **[Rule 2 - Diagnosability] Stall reports:** `stepUntilTrue` stall errors show the op trail, warn/error lines, recent calls and strays.
6. **[Protocol] Sweep file:** the sweep entry for AUD-ANTIRUG-024 went in a new `sweep/contrib-PHASE23.json` (later Phase 23 plans can add to it) instead of editing the Phase 22 ANTIRUG sweep file.
7. **[Rule 1 - Bug] Line refs:** three off-by-one line refs at the audit base were corrected before AUD-ANTIRUG-024 was written.
8. **[Diagnosed anomaly] Probe teardown:** one unhandled "provider destroyed; cancelled request (eth_subscribe)" came from a first evidence probe that tore down before the anti-rug subscription landed (same cause as 1 and 2). A re-run with AC-01's arming wait was clean. The probe file was deleted and never committed.

### Task 2 and Ruling 2 (this executor)

9. **[Rule 2 - Missing critical] Relay calls recorded on arrival:** the relay record moved from `#relayMethod` into `#one`, so a parked relay call is visible on `node.relay` (and in `callLog`) before it is answered. Without this, a test could not tell "parked" from "never sent". Files: chain.ts. Commit `4a108b8`.
10. **[Rule 2 - Missing critical] Arming-time validation:** `failNext`/`hold` refuse a `selector` on a method other than eth_call/eth_estimateGas, or a `to` on a method without an address, so a fault that could never fire fails at once by name. Commit `4a108b8`.
11. **[Rule 2 - Teardown safety] Parked calls at teardown:** `releaseAll()` answers still-parked calls with an error, and the disposer drains microtasks before destroying providers (see Decisions). Files: chain.ts, world.ts. Commit `4a108b8`.
12. **[Rule 3 - Blocking] Two node counters beyond the interface:** `openSocketCount` and `socketsOpened` on `FakeNode`, so the startup-failure test can prove a live socket existed and was taken down. Commit `4a108b8`.
13. **[Rule 3 - Blocking] Bare-provider cache:** tests that reach a bare node through a real `JsonRpcProvider` set `cacheTimeout: -1`. ethers' AbstractProvider caches identical requests for 250 ms (abstract-provider.js:250-266), which would answer a repeated call without reaching the node and hide a fault. Commit `4a108b8`.
14. **[Rule 1 - Bug] Line ref in the checkpoint:** the checkpoint gave `bot.ts:2120-2144` as HEAD. That is the audit-base range; HEAD is `:2122-2146`. The no-positions tick is `:1272-1279` at HEAD, not `:1269-1278`. Both were re-measured and corrected in AUD-ANTIRUG-018 and ESC-ANTIRUG-03. Commit `a5dd1c3`.
15. **[Protocol] Optional history key:** an optional `severity_history` key was added to AUD-ANTIRUG-018. It is not in PROTOCOL.md's schema, but `check.ts` accepts extra keys (as it does `external_sources`), and partial and consolidation pass.

---

**Total deviations:** 15 (8 carried from Task 1, 7 in Task 2 and ruling 2; Rules 1, 2, 3 and protocol notes).
**Impact on plan:** every change serves correctness of the harness or traceability of the register. There was no scope creep, and `src/` is unchanged.

## Verification (exact commands, Node 22.16.0 on PATH)

- `node node_modules/vitest/vitest.mjs run --project realpath test/realpath/harness.test.ts`: 11/11 passed, three repeat runs identical. Each run's rail ledger shows only `worker-start 1`, with no `net-allow` or non-loopback entries and no stderr.
- `node node_modules/ts-node/dist/bin.js scripts/check-vi-mock-paths.ts`: 591 mock calls in 177 files, 0 violations.
- `node node_modules/vitest/vitest.mjs run --project unit test/unit/rails/spawnSites.test.ts test/unit/viMockGate.test.ts`: 14/14.
- Ad hoc `tsc --noEmit` over `test/realpath/**/*.ts` (temporary tsconfig extending the repo's, module esnext, deleted after): 4 files, 0 errors.
- `git status --porcelain src`: empty.
- RED proofs (scratch, never committed): a probe file whose tests swallow an unknown method and leave an unfired fault failed in afterEach with `stray call: unknown JSON-RPC method "eth_redProbe"` and `a fault never fired: failNext("eth_chainId", after <predicate>, times 1): fired 0 of 1`. Four mutations each failed their test, and each file was restored byte-for-byte (sha256): a hold that never parks failed 2 tests; an ignored `after` failed the fault test; a removed seam check failed the self-check; a disposer without provider destroy failed the startup test (`expected 1 to be +0`).
- Register, before and after ruling 2 (`node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts ...`): `--stage partial` PASS; `--stage consolidation` PASS; `--self-test` 18/18; `--stage final` FAIL with the same 6 pre-existing failures (Phase 23 harness files without TESTI ledger rows; `.gitignore` and `vitest.config.ts` without re-audit entries). `seal-verify.ts` was INVALID before and after (known D-19 merge-counting flaw); it now also names ESC-ANTIRUG-03, the way it names the other post-seal files. Consolidation was proven real on a scratch copy: removing AUD-ANTIRUG-018's `escalation_ref` failed with `escalation required (S1 (area-batch tier)) but escalation_ref is null`.

## Issues Encountered

None open. Every odd output was diagnosed. Git's "LF will be replaced by CRLF" notices on commit come from `core.autocrlf=true` on the operator machine; the blobs are LF.

## Known Stubs

None. `FakeNode.releaseAll()` is no longer a placeholder. `createScenario` refuses chains and DEX types other than eth/v2 by design; plan 23-28 adds them.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- The harness contract that later plans build on is in place and proven: `handle`, `callLog` (params, data, selector, block tag), `failNext`/`hold` with handles, `expectStillPending`, the disposer and the afterEach checks.
- Plan 23-28 adds the public route's nonce and chain ID rules, fee schedules, receipt logs, replacements and the other chains and V3 on this base.
- Concerns: AUD-ANTIRUG-018 is now S1 (Phase 24 capital fix); the operator does not know whether any chain runs without a WS URL. `check.ts --stage final` will keep failing on the new harness files until their TESTI ledger rows and re-audit entries are added (left for the plan that does that bookkeeping).

## Self-Check: PASSED

- Files present: vitest.config.ts, test/realpath/harness/{setup,chain,world}.ts, test/realpath/harness.test.ts, findings/AUD-ANTIRUG-024.json, escalations/ESC-ANTIRUG-02.json, escalations/ESC-ANTIRUG-03.json, sweep/contrib-PHASE23.json.
- Commits on this branch: 05c1665, e107f24, a5dd1c3 and 4a108b8 are all ancestors of HEAD. `check evaluation-scope --plan 23-01 --commits-only` resolves all four.
- Commit count measured from the ledger: `git rev-list --count 45d0e47..4a108b8` = 4.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*
