---
phase: 23-test-safety-net-harness-triage-characterization
plan: 28
subsystem: testing
tags: [vitest, ethers, realpath-harness, simulated-node, goplus, audit-register]

# Dependency graph
requires:
  - phase: 23-01
    provides: the realpath harness (installSeams, FakeNode, FakeWebSocket, createScenario for eth/v2, fixed clock, stray and fault checks)
  - phase: 23-03
    provides: createTestDb and the graph's :memory: database built by the real migrations
provides:
  - "FakeNode public-route lifecycle: mined-only latest count, pending pool, real refusals with geth text, 10 percent replacement bump, queued future nonces, setFutureNoncePolicy, relay acceptance that moves no count, mine({ include, exclude, logs }), neverMine, dropped competitors, ordered history"
  - "FakeNode fees, logs and receipts: setFees (incl. legacy mode), stored logs served by eth_getLogs with geth range rules, filtered log subscriptions (address list, OR topics), setReceiptLogs"
  - "createScenario for chain eth|bsc|base|arb and dexType v2|v3, fireNewPool, per-chain checker address set before the graph loads, bloXroute and public routes"
  - "httpLog entries carry the axios request params"
  - "Route proofs: ETH V3 (bundle), bsc V2 (bloxroute), base V3 and arb V3 (public); base V2 and arb V2 record today's AUD-BUY-016 skip"
  - "AUD-BUY-016 candidate -> confirmed (S3) with GoPlus documentation and the real-path test"
affects: [23-04, 23-06, 23-10, 23-11, 23-20, 23-21, 23-22, 23-27, phase-24]

# Actuals (#2632)
actuals:
  tokens: 29652    # chars/4 over the added lines of the realized diff cfb4330..b68d9ed (5 files)
  tasks: 3
  commits: 6       # MEASURED: git rev-list --count cfb4330..HEAD before this SUMMARY commit
plan_head_before: cfb4330fec6c518b0f18f5f8cd82489100331ad1
plan_head_after: b68d9edc69ef59f521993aaa263536422c66e957
commits: 6

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A known bug the operator rules to keep testing today is pinned by a test that passes today, names the finding in its title, and fails with '<ID> looks fixed' when the fix lands (D-08 signal)"
    - "External API fakes answer only what the provider documents; an undocumented answer shape is listed in the SUMMARY as unverified"

key-files:
  created: []
  modified:
    - test/realpath/harness/chain.ts
    - test/realpath/harness/world.ts
    - test/realpath/harness.test.ts
    - .planning/audit/findings/AUD-BUY-016.json
    - .planning/audit/AUDIT-FINDINGS.md

key-decisions:
  - "Operator ruling at the Task 3 checkpoint ('Test today's skip'): the plan's 'base V2 buy' became a 'base V2 skip' test; base and arb V2 buys cannot succeed on the real path until AUD-BUY-016 is fixed"
  - "arb V2 was added beside base V2 although the plan's route list does not name it: arb is the other chain whose template sets liquidityLock goplus, so the finding gets real-path evidence on both affected chains"
  - "AUD-BUY-016 status candidate -> confirmed (grade unchanged, S3, capital none) under the operator's standing instruction: GoPlus documentation plus a real-path run on a doc-faithful fake, no live GoPlus call"
  - "23-22's public-v2-buy scenario (chain base) cannot record a buy under today's code; its executor must take that to the operator"

patterns-established:
  - "Fix-signal test: wait for either the bug outcome or the fixed outcome, and throw '<ID> looks fixed ...' on the fixed one"

requirements-completed: [CHAR-01]

coverage:
  - id: D1
    description: "Public-route transaction life on the simulated node: accepted, pending, mined and receipted, with every real refusal, replacement, relay acceptance, competition, neverMine and queued nonce"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harness.test.ts#simulated node: the public route (23-28 Task 1, D-03, AC-48)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Fee answers (incl. legacy node), stored logs through eth_getLogs, filtered subscriptions and receipt logs read by the real decodeReceipt"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harness.test.ts#simulated node: fees, logs and receipts (23-28 Task 2, AC-48)"
        status: pass
    human_judgment: false
  - id: D3
    description: "createScenario for every chain and DEX type, with route proofs ETH V3 (bundle), bsc V2 (bloxroute), base V3 and arb V3 (public), each asserting the decoded call, its route and the checker read"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harness.test.ts#scenario builder: every chain and DEX type on its real route (23-28 Task 3)"
        status: pass
    human_judgment: false
  - id: D4
    description: "base and arb V2 tests record today's AUD-BUY-016 skip (operator ruling), fail with 'AUD-BUY-016 looks fixed' once the query is fixed"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harness.test.ts#AUD-BUY-016 today: a base V2 launch is skipped before route public, ..."
        status: pass
      - kind: integration
        ref: "test/realpath/harness.test.ts#AUD-BUY-016 today: a arb V2 launch is skipped before route public, ..."
        status: pass
    human_judgment: false
  - id: D5
    description: "AUD-BUY-016 evidence and status change recorded per PROTOCOL.md, register checks unchanged from baseline"
    verification:
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage partial|consolidation (PASS), --self-test (18/18), --stage final (same 12 pre-existing FAILs); seal-verify.ts output identical"
        status: pass
    human_judgment: false
  - id: D6
    description: "AC-48: no test passes on fake chain or API answers a real node or provider could never return"
    verification: []
    human_judgment: true
    rationale: "The plan's own verification for this prohibition is judgment (review of fake transport data). Three external answer shapes are not measured and are listed under Unverified external answer shapes."

# Metrics
duration: 8h 8m (wall-clock incl. the operator checkpoint wait; this continuation 16 min)
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 28: Simulated node and scenario builder Summary

**The simulated node now models a public transaction's whole life with geth's refusal text, fees, stored logs, filtered subscriptions and receipt logs. createScenario builds any chain (eth, bsc, base, arb) and DEX type (V2, V3) on its real route. The base V2 buy became an operator-ruled skip test that pins AUD-BUY-016, now confirmed from GoPlus's documentation.**

## Performance

- **Duration:** about 8h 8m wall-clock, including the operator's checkpoint wait (this continuation: 16 min)
- **Started:** about 2026-11-11T05:42Z (after 23-03's last commit cfb4330)
- **Completed:** 2026-11-11T13:50Z
- **Tasks:** 3 of 3
- **Files modified:** 5 (3 test files, 2 register files)

## Accomplishments

- **Task 1 (tracer), public-route transaction life.** `latest` counts mined transactions only, and `pending` adds the public pool's contiguous run. `eth_sendRawTransaction` refuses with geth's text: `invalid chain id for signer`, `nonce too low`, `intrinsic gas too low`, `insufficient funds`, `already known`, `replacement transaction underpriced`, and `nonce too high` under `setFutureNoncePolicy('reject')`. A future nonce is otherwise queued. A relay acceptance moves neither count. `mine({ include, exclude, logs })`, `neverMine`, dropped competitors and an ordered `history` are in place.
- **Task 2, fees, logs and receipts.** `setFees` persists. A legacy node has no `baseFeePerGas`, answers `eth_maxPriorityFeePerGas` with geth's -32601 text and records no stray. Logs from `mine({ logs })` and `emitLogs` are served by `eth_getLogs` under geth's range rules. Subscriptions receive only the logs their filter matches. `setReceiptLogs` feeds the real `decodeReceipt`.
- **Task 3, every chain and DEX type.** `createScenario({ chain, dexType })` sets `ENABLED_CHAINS`. For a non-ETH chain it also sets the `*_HONEYPOT_CHECKER_ADDRESS` before the graph loads. It serves Flashbots, bloXroute and the public route. `fireNewPool` mines a real PoolCreated with the same-block Mint. The route proofs are ETH V3 (bundle), bsc V2 (bloxroute), base V3 and arb V3 (public), and each asserts the decoded call, the route and the checker read.
- **Operator ruling applied.** Base V2 and arb V2 tests record today's skip. GoPlus is asked about the pair only, the lock is the only failed check, nothing is sent and no trades row is written. The same fake answered for the token reads locked. The tests fail with `AUD-BUY-016 looks fixed` once the query is fixed.
- **AUD-BUY-016 confirmed** in the register, with GoPlus's documented answer contract and the real-path test as evidence.

## Task Commits

1. **Task 1: public-route transaction life (tracer)** - `48fd1ef` (test), previous executor
2. **Task 2: fees, stored logs, filtered subscriptions, receipt logs** - `6b49ed1` (test), previous executor
3. **Task 3: scenario builder and route proofs (ETH V3, bsc V2, base V3, arb V3)** - `94960d4` (test), previous executor
4. **Task 3 completion: base and arb V2 AUD-BUY-016 skip tests and httpLog params** - `ff4ddf1` (test)
5. **Task 3 completion: D-08 fix signal in the skip test** - `344ba3c` (test)
6. **Register: AUD-BUY-016 confirmed, AUDIT-FINDINGS.md re-rendered** - `b68d9ed` (docs)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## Files Created/Modified

- `test/realpath/harness/chain.ts`: the FakeNode public-route model, fees, stored logs, subscription filtering and receipt logs. httpLog entries now record axios `params`.
- `test/realpath/harness/world.ts`: `createScenario` for every chain and DEX type, `fireNewPool`, the bloXroute and public routes, the doc-faithful GoPlus, Unicrypt and Mudra answers, and httpLog `params`.
- `test/realpath/harness.test.ts`: the node-model, fee, log, receipt and route proofs, plus the two AUD-BUY-016 skip tests (29 tests in the file).
- `.planning/audit/findings/AUD-BUY-016.json`: status confirmed, new evidence, sub-sites and status history.
- `.planning/audit/AUDIT-FINDINGS.md`: regenerated with `render.ts`. Only the AUD-BUY-016 section changed.

## Checkpoint and Operator Ruling

**Checkpoint (Task 3, decision, gate blocking-human).** As written, the plan's "base V2 buy" route test could pass only if the fake GoPlus gave an answer GoPlus documents it does not give. On base and Arbitrum the V2 lock check asks GoPlus about the pair address as if it were a token and reads `lp_holders` (`src/utils/safetyProviders/goplus.ts:57-60`). GoPlus returns `lp_holders` only for a token with a DEX market (`is_in_dex`). So with GoPlus answering as documented, every base and arb V2 launch passes all safety checks except `locked: false` and is skipped. This is AUD-BUY-016.

**Operator's answer (verbatim selection):** "Test today's skip (Recommended)". The orchestrator added the "(Recommended)" label, not the operator. As a result this plan's "base V2 buy" became a "base V2 skip" test.

## Decisions Made

- **Base V2 buy became a base V2 skip (operator ruling).** Later scenario plans must know that base and arb V2 buys cannot succeed on the real path until AUD-BUY-016 is fixed. Recorded in STATE.md Decisions.
- **arb V2 added.** The plan names ETH V3, bsc V2 and base V2 only, so arb V2 was not required. It was added because arb is the other chain whose template sets `liquidityLock: 'goplus'` (`src/chainRegistry.ts:386`), and the finding claims "every chain that uses GoPlus for locks". One more loop entry gives real-path evidence on both affected chains.
- **httpLog records the request params.** Without them no test could show which address GoPlus was asked about. The change is backward compatible (an optional field).
- **Fix signal (D-08).** The skip test waits for either the skip line or the buy line, and if the bot buys it fails with `AUD-BUY-016 looks fixed: ... rewrite it as the <chain> V2 buy on route public` instead of a timeout.

## Register Changes (graded under the standing instruction)

| Entry | Change | Basis | Record |
|---|---|---|---|
| AUD-BUY-016 | status candidate -> confirmed. Severity S3, capital none, OD-30 and card BUY-05 unchanged | executor decision under the operator's standing instruction (2026-11-11, verbatim: "All the bugs are going to get fixed. The S1, 2 or whatever doesn't matter. Don't interrupt sessions to ask me about upgrading or downgrading") | `b68d9ed` |

Why confirmed: in this register, "confirmed" means the mechanism is established by evidence. Phase 22 confirmed entries from code reading without a live reproduction (for example AUD-ANTIRUG-018). AUD-BUY-016 stayed a candidate only because of one external fact, which its record left "to confirm in Phase 23". GoPlus's response-details documentation (https://docs.gopluslabs.io/reference/response-details, read through the Context7 docs index) settles that fact: `lp_holders` has no return when `is_in_dex` is `"0"`, and `is_in_dex` is "Only true if the token has a marketing pair with mainstream coins/tokens". The committed real-path test shows the consequence end to end on a fake held to that contract, and the token query reads locked on the same fake. The Unicrypt half (no timeout) is a code fact at the audit base and unchanged at HEAD. Not measured: a live GoPlus answer for an LP pair address. Phase 23 makes no live third-party call. The recommended fix (query by the token) is the documented way either way. AUD-BUY-016 is S3 and not one of the 59 triage entries, so AC-08 and the D-11 batch do not apply.

New sibling facts recorded in the finding:
- BSC uses Mudra, which on any Mudra error falls back to GoPlus with the same pair address (`mudra.ts:30-33` at the audit base). So a BSC V2 launch also reads "not locked" whenever Mudra fails.
- The V3 bank has no lock check, so V3 is unaffected.
- Open for Phase 24: the documentation writes `lp_holders` `is_locked` values in quotes, while `goplus.ts:64` compares the number 1. The fix must confirm the live type.

No new finding was registered and no grade changed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical, previous executor] Extra real-node refusals in Task 1.** `intrinsic gas too low`, `insufficient funds` and `already known` were added beside the planned refusals, and the sender pays gas and value. Without them a fake could accept a transaction a real node refuses (AC-48). Commit `48fd1ef`.

**2. [Rule 1 - Test strength, previous executor] Task 1 replacement test.** One Task 1 RED proof first passed when it should have failed, because the replacement test never checked the fee-cap threshold. The test was strengthened and now fails both mutations. Commit `48fd1ef`.

**3. [Rule 2 - Missing critical, previous executor] Geth-faithful details in Task 2.** A legacy node refuses a type-2 transaction as not supported. Blocks and receipts carry real bloom filters. `eth_getLogs` follows geth's range rules (blockHash exclusive, invalid range params, empty above the head, toBlock capped). Commit `6b49ed1`.

**4. [Operator ruling] Base V2 buy became a base V2 skip, and arb V2 was added.** See Checkpoint and Decisions. Commit `ff4ddf1`.

**5. [Rule 2 - Missing critical] httpLog records axios params.** The pair-query assertion needs it. Files: `chain.ts`, `world.ts`. Commit `ff4ddf1`.

**6. [Rule 2 - Missing critical] D-08 fix signal in the skip test.** Without it, the fix would show up as an unexplained timeout. Commit `344ba3c`.

---

**Total deviations:** 5 auto-fixed (Rules 1 and 2) plus 1 operator-ruled scope change.
**Impact on plan:** each serves AC-48 or the traceability of the known-bug test. `src/` is unchanged.

## Verification (exact commands, Node 22.16.0 on PATH via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

- `node node_modules/vitest/vitest.mjs run --project realpath test/realpath/harness.test.ts`: 29/29 passed on three identical runs after each of ff4ddf1 and 344ba3c. Each rail ledger shows only `worker-start 1`, with no non-loopback connection.
- `node node_modules/vitest/vitest.mjs run --project realpath`: 38/38 (2 files), ledger `worker-start 2`.
- `node node_modules/ts-node/dist/bin.js scripts/check-vi-mock-paths.ts`: 591 mock calls in 179 files, 0 violations.
- `node node_modules/vitest/vitest.mjs run --project unit test/unit/rails/spawnSites.test.ts test/unit/viMockGate.test.ts`: 14/14.
- `tsc --noEmit` over `test/realpath/**/*.ts`, using a temporary tsconfig in the session scratchpad that extends the repo's (module esnext, typeRoots set to the repo's node_modules): 6 files, 0 errors. The first attempt failed only on type-library lookup, because the config sat outside the repo. That was diagnosed and fixed with typeRoots; it was not a code error.
- `git status --porcelain src`: empty.
- RED proofs (scratch, never committed; files restored by sha256):
  - M1, the fix applied locally (`bot.ts` asks the lock check about the token): both AUD-BUY-016 tests fail with `AUD-BUY-016 looks fixed`. The trail shows `All safety checks passed, buying` then `TX sent (passthrough)`.
  - M2, a fake that returns `lp_holders` for the pair (an AC-48 violation): both tests fail the same way.
  - M3, httpLog without params: both tests fail on the pair-query assertion.
  - The previous executor's Task 2 and Task 3 RED scripts were re-run at HEAD and still reproduce. Four Task 2 mutations each fail their named test. Three Task 3 mutations fail their route tests, and two of them now also fail the AUD-BUY-016 tests.
  - The Task 1 RED script was not in the scratchpad, so those proofs were not re-run. That claim rests on the previous executor's record.
- Register, before and after the AUD-BUY-016 change (`node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts ...`): `--stage partial` PASS, `--stage consolidation` PASS, `--self-test` 18/18, `--stage final` FAIL with the same 12 pre-existing failures (TESTI ledger rows for Phase 23 test files, and re-audit entries for `.gitignore`, `vitest.config.ts`, `test/helpers/testDb.ts`, `test/unit/db.test.ts`, `test/unit/helpers.smoke.test.ts`). `seal-verify.ts` was INVALID before and after with identical output (the known flaw where it lists every post-seal file). `SEAL.json` is untouched. OPERATOR-DECISIONS.md is unchanged.

## Unverified external answer shapes

These are fake answers taken from source code or documentation and not measured against the live service (no live call in Phase 23):
- bloXroute `bsc_private_tx` replies with the hash hex without the `0x` prefix.
- The Mudra lock shape `{ data: { locks: [{ unlockDate, amount }] } }`, taken from `src/`.
- GoPlus `lp_holders[].is_locked` as the number 1. The documentation writes `"1"` in quotes, and `goplus.ts:64` compares the number. Now recorded in AUD-BUY-016 for Phase 24.
- GoPlus's answer for an LP pair queried as a token (`is_in_dex: "0"`, no `lp_holders`) follows the documentation. It is not a captured response.

## Issues Encountered

- A draft of the AUD-BUY-016 evidence ref carried a made-up hash tail after `344ba3c`. I caught it before the file entered the repo and replaced it with the real SHA from `git rev-parse` (`344ba3cd3bbc61e8c5b55ecc8815cfb60a578be3`). Every other line ref was re-measured at the audit base.
- Git's "LF will be replaced by CRLF" notices come from `core.autocrlf=true` on this machine. The blobs are LF.

## Known Stubs

None. The "not available" matches in `chain.ts` and `harness.test.ts` are geth's own error text for an unsupported method.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- Later plans can build any launch on any route through `createScenario({ chain, dexType })`, with fees, logs, receipt logs and the public-route lifecycle available on the node.
- **23-22 must take a premise problem to the operator:** its Task 1 `public-v2-buy` scenario (chain base) cannot record a buy under today's code, because AUD-BUY-016 skips every base and arb V2 launch. `public-v3-buy` on base is unaffected. The same holds for any later golden recording that expects a base or arb V2 buy.
- Phase 24's AUD-BUY-016 fix must confirm the live `is_locked` type, and should then rewrite the two skip tests as the base and arb V2 buys on route public (they fail with `AUD-BUY-016 looks fixed` until then).
- `check.ts --stage final` keeps its 12 pre-existing failures until the TESTI ledger and re-audit bookkeeping plan runs.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*

## Self-Check: PASSED

- Files present: test/realpath/harness/{chain,world}.ts, test/realpath/harness.test.ts, findings/AUD-BUY-016.json, AUDIT-FINDINGS.md, this SUMMARY.
- Commits on this branch: 48fd1ef, 6b49ed1, 94960d4, ff4ddf1, 344ba3c, b68d9ed, ffa58f3 (evaluation-scope resolved them from plan subjects).
- Acceptance re-run: ETH V3, bsc V2 and the base/arb route tests pass and assert the decoded transaction and route; each non-ETH test asserts the checker read; `git status --porcelain src` empty.
