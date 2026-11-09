---
phase: 23
reviewers: [codex, antigravity]
reviewed_at: 2026-11-09T20:42:10Z
plans_reviewed:
  - 23-01-PLAN.md
  - 23-02-PLAN.md
  - 23-03-PLAN.md
  - 23-04-PLAN.md
  - 23-05-PLAN.md
  - 23-06-PLAN.md
  - 23-07-PLAN.md
  - 23-08-PLAN.md
  - 23-09-PLAN.md
  - 23-10-PLAN.md
  - 23-11-PLAN.md
  - 23-12-PLAN.md
  - 23-13-PLAN.md
  - 23-14-PLAN.md
  - 23-15-PLAN.md
  - 23-16-PLAN.md
  - 23-17-PLAN.md
  - 23-18-PLAN.md
  - 23-19-PLAN.md
  - 23-20-PLAN.md
  - 23-21-PLAN.md
  - 23-22-PLAN.md
  - 23-23-PLAN.md
  - 23-24-PLAN.md
  - 23-25-PLAN.md
  - 23-26-PLAN.md
models:
  codex: "gpt-6.1-sol (reasoning=xhigh)"
  antigravity: "gemini-4-argon-high"
model_sources:
  codex: "pinned"
  antigravity: "pinned"
plan_coverage:   # antigravity set by manual check: the automated id match passed, but these sections describe plans that do not exist
  antigravity:
    total: 26
    missing: ["23-05", "23-06", "23-07", "23-08", "23-09", "23-10", "23-11", "23-12", "23-13", "23-14", "23-15", "23-16", "23-17", "23-18", "23-19", "23-20", "23-21", "23-22", "23-23", "23-24", "23-25", "23-26"]
---

# Cross-AI Plan Review — Phase 23

<!-- gsd:plan-revision-conflicts:begin -->
## Plan-Revision Conflicts

<!-- gsd:plan-revision-conflicts:end -->

## Codex Review

Source inspection covered all 26 plans, the locked specification, referenced production paths, existing tests, and installed package code. This is a plan review; no implementation tests or relay probe were run.

## 23-01

**Summary:** The transport architecture fits the codebase, but the fake node’s nonce model and graph lifecycle need stronger contracts before dependent work starts.

**Strengths**

- The CJS alias addresses a real package distinction: ethers exports separate builds at `node_modules/ethers/package.json:38`, while its CJS WebSocket accessor reads `ws.WebSocket` at connection time (`node_modules/ethers/lib.commonjs/providers/ws.js:5`).

**Concerns**

- **HIGH:** Advancing transaction count on acceptance without distinguishing `latest` from `pending` can make an unmined submission look mined. Production explicitly uses `latest` to decide whether to stop retrying (`src/utils/mevStrategies/reconciliation.ts:478`).
- **MEDIUM:** Closing the DB alone does not stop old monitor intervals, providers, or asynchronous callbacks. Exit monitoring retains interval closures (`src/exitEngine.ts:1909`).

**Suggestions**

- Specify mined and pending nonce state, same-nonce replacement, and private-bundle acceptance separately.
- Add an awaited scenario disposer covering timers, providers, pending operations, and DB closure.

**Risk assessment:** **HIGH** — incorrect foundational semantics would compromise every later proof.

## 23-02

**Summary:** The instrumentation is well targeted, but its failure enforcement could itself be swallowed by production error handling.

**Strengths**

- Capturing SQLite-generated timestamps addresses the real `DEFAULT (unixepoch())` clauses (`src/utils/dbSchema.ts:25`).
- Reporter metadata is viable: the installed JSON reporter includes `t.meta` (`node_modules/vitest/dist/chunks/index.DXMFO5MJ.js:3776`).

**Concerns**

- **HIGH:** Throwing from a capture trigger does not guarantee the scenario fails. Production catches broad errors and continues through failure handling (`src/bot.ts:1179`). A prohibited transaction could therefore produce a misleading recording.
- **MEDIUM:** The reusable `mockMethodOf` recognizes only four mock/unmock methods (`scripts/check-vi-mock-paths.ts:69`). Exporting it alone does not support detecting `spyOn`, `stubGlobal`, or `importMock`.

**Suggestions**

- Record capture violations in an out-of-band failure list checked during teardown.
- Extend binding-aware method detection explicitly and test every prohibited API through aliases and bracket access.

**Risk assessment:** **HIGH** — the gates must reject invalid evidence reliably.

## 23-03

**Summary:** This is a focused, credible migration plan with good preservation and idempotence checks.

**Strengths**

- It runs the actual migration entry point (`src/utils/dbSchema.ts:13`).
- The two version assertions genuinely pin the obsolete value: `test/unit/db.test.ts:76` and `test/unit/helpers.smoke.test.ts:34`.

**Concerns**

- **LOW:** `index_info` plus table SQL does not fully characterize index predicates, collations, or descending expressions. Current indexes are simple (`src/utils/dbSchema.ts:32`), but the golden format could miss later changes.

**Suggestions**

- Include each index’s stored SQL and `PRAGMA index_xinfo`.
- Capture an actual RED run of the new current-version assertion against the old helper before changing it.

**Risk assessment:** **LOW** — the implementation path is direct and avoids production changes.

## 23-04

**Summary:** Mechanical outcome enforcement is valuable, but the new stage needs deeper integration with existing checker control flow.

**Strengths**

- Replacing the candidate-specific NOT-A-BUG prohibition addresses the actual blocker at `.planning/audit/tools/check.ts:320`.
- Finding-ID lookup avoids dependence on test paths.

**Concerns**

- **HIGH:** Making `strict` false for triage is insufficient. The existing `stage !== 'partial'` branch still runs consolidation and HEAD-universe checks (`.planning/audit/tools/check.ts:924`).
- **HIGH:** A non-null operator response does not establish that the operator ruled on this finding or authorized this outcome. Existing escalation linkage already performs more specific membership checks (`.planning/audit/tools/check.ts:612`).

**Suggestions**

- Explicitly enumerate which checker stages run consolidation and universe validation.
- Require ruling membership and a per-finding disposition.
- Freeze the original 59-ID population so severity or duplicate changes cannot silently shrink it.

**Risk assessment:** **HIGH** — otherwise the gate can remain blocked or accept unsupported closures.

## 23-05

**Summary:** The proposed observations are relevant, but fault injection must identify the exact operation being tested.

**Strengths**

- The failed-quote behavior is directly traceable: `minOut` starts at zero and the catch leaves it there (`src/bot.ts:1050`).
- The fee finding is grounded in both sides of the computation: ethers doubles the base fee (`node_modules/ethers/lib.commonjs/providers/abstract-provider.js:625`), then the strategy subtracts priority (`src/utils/mevStrategies/flashbots.ts:169`).

**Concerns**

- **MEDIUM:** A selector-only failure can hit an earlier safety or quote call instead of the intended post-buy read. The decisive post-buy balance read occurs at `src/bot.ts:1161`.
- **HIGH:** Earlier-attempt inclusion requires realistic competing hashes at one nonce; a fake that advances `latest` at acceptance can manufacture the result.

**Suggestions**

- Fence each fault with a reached-stage assertion.
- Require explicit submission, mining, nonce, and receipt histories for competing attempts.

**Risk assessment:** **HIGH** — these proofs influence capital-safety decisions.

## 23-06

**Summary:** The Telegram and stop-route tests are sensible; the proposed S0 reproduction does not model two processes faithfully.

**Strengths**

- The Telegram OR behavior exists exactly where targeted (`src/telegramListener.ts:77`).
- The actual deliberate-buy script exits immediately after success (`scripts/deliberate-buy.ts:150`).

**Concerns**

- **HIGH:** Two sequential graph loads with fresh in-memory databases cannot prove failure to discover another process’s row. The first DB is closed, and the second graph gets a different database; `closeDb()` really closes the connection (`src/utils/db.ts:520`).
- **HIGH:** Manually tearing down graph B does not exercise the script’s real success-path exit. The test could remain green after that exit behavior changes.

**Suggestions**

- Use isolated railed processes sharing a temporary migrated database, with explicit readiness and monitoring acknowledgements.
- Exercise the script’s exit behavior through an allowed callable seam or an equivalent script-path proof.

**Risk assessment:** **HIGH** — the only S0 currently has an inadequate reproduction design.

## 23-07

**Summary:** The exit cases target real hazards, but quote injection and restart persistence need correction.

**Strengths**

- The initial-quote failure is directly observable: `startExitMonitor` returns before persistence and timer registration (`src/exitEngine.ts:1873`).
- The wrong-DEX resume path selects the first matching DEX (`src/bot.ts:1952`).

**Concerns**

- **HIGH:** Reloading a fresh in-memory graph loses the persisted entry state needed for AUD-EXIT-015. Without that row, resume takes the fresh-state branch (`src/exitEngine.ts:1982`), testing a different situation.
- **MEDIUM:** `getAmountsOut` also runs before submission (`src/bot.ts:1053`); the monitor-start fault needs a precise execution barrier.

**Suggestions**

- Preserve the real database across restart tests.
- Assert the original `exit_state` row exists and is loaded before evaluating the changed probe.
- Arm quote failures only after the buy reaches the intended stage.

**Risk assessment:** **HIGH** — restart evidence could otherwise be misleading.

## 23-08

**Summary:** Real HTTP routes and forced races are appropriate, but two distinct failure mechanisms must be isolated.

**Strengths**

- The dashboard queries exclude failed buy rows (`src/api/routes/controls.ts:70`), directly supporting the failed-held test.
- The sell-lock refusal is observable through the real return path (`src/exitEngine.ts:834`).

**Concerns**

- **HIGH:** A failed-held row used for AUD-EXIT-008 may be rejected with 404 before reaching the routine-pause gate. That proves the query-filter issue again, rather than the pause issue.
- **MEDIUM:** The lock-refusal log has no `op` field (`src/exitEngine.ts:835`), so an op-only timeline cannot provide the proposed log evidence.

**Suggestions**

- Give each test a precondition assertion proving it reaches its intended gate.
- Use the actual response, lock state, and submission count as evidence; capture plain logs separately when necessary.

**Risk assessment:** **HIGH** — a shared setup could obscure separate root causes.

## 23-09

**Summary:** Testing the real nonce authority is a strong choice; the simulated non-inclusion condition needs precision.

**Strengths**

- The real lock chains operations behind the preceding promise (`src/utils/nonceAuthority.ts:85`).
- The passthrough path genuinely performs an unbounded `tx.wait(3)` (`src/utils/mevStrategies/passthrough.ts:140`).

**Concerns**

- **MEDIUM:** Holding an RPC request unresolved and repeatedly returning valid `null` receipts are different faults. The former can prove a stalled transport rather than missing confirmation timeout handling.
- **MEDIUM:** A finite pending observation establishes a bounded-window result, not “forever.”

**Suggestions**

- Return valid null receipts while advancing blocks beyond the intended deadline.
- Include successful three-confirmation controls.
- Assert precisely which later wallet operation remains blocked, and clean up all outstanding promises.

**Risk assessment:** **MEDIUM** — sound targets, with reproducibility details still needed.

## 23-10

**Summary:** Subscription-level evidence is well chosen, but anti-rug tests need explicit gate and event-order setup.

**Strengths**

- Dashboard Stop really removes all provider listeners (`src/api/routes/chains.ts:141`).
- Backfill calls an evaluator despite the nearby prohibition on live exits (`src/anti-rug/detector.ts:1149`).

**Concerns**

- **MEDIUM:** A rug log alone does not reach a sell: the detector requires all three signals (`src/anti-rug/detector.ts:1967`), and live execution has a separate gate (`src/anti-rug/exitTrigger.ts:179`).
- **MEDIUM:** Circuit-breaker accounting happens after the sell attempt completes (`src/anti-rug/exitTrigger.ts:315`). Event ordering can change whether both dispatches see the position.

**Suggestions**

- Specify live-execution configuration, signal values, confirm-block progression, and breaker thresholds.
- Hold the first exit while delivering the second event, then release in a prescribed order.

**Risk assessment:** **MEDIUM** — the mechanisms are reachable, but loose fixtures could test suppression instead.

## 23-11

**Summary:** Using real insert sites is particularly valuable here; isolate each risk rule carefully.

**Strengths**

- Buy rows store native-unit strings (`src/bot.ts:1140`), while partial-sell rows store decoded output (`src/exitEngine.ts:1561`); exercising both catches unit mismatches that hand-seeded rows can hide.
- The production synchronous setting is directly readable (`src/utils/db.ts:35`).

**Concerns**

- **MEDIUM:** `canSnipe` returns at the first failing rule (`src/riskManager.ts:81`). Another gate can mask the invalid setting being tested.
- **LOW:** Reading `PRAGMA synchronous` establishes configuration, not persistence under power loss.

**Suggestions**

- Pair every invalid-setting case with the same state under a valid limit, proving only the targeted gate changes.
- Keep the durability consequence explicitly separate from executable evidence.

**Risk assessment:** **MEDIUM** — strong real-path design with manageable isolation risks.

## 23-12

**Summary:** Real child-process deaths, healthy controls, and path markers make this one of the stronger triage plans.

**Strengths**

- The bundle library throws inside an asynchronous block listener (`node_modules/@flashbots/ethers-provider-bundle/build/index.js:387`), supporting process-level testing.
- The malformed Host path reaches an unguarded URL constructor (`src/api/ws/handler.ts:43`).

**Concerns**

- **MEDIUM:** A contained process printing `FIXTURE_SURVIVED` can still have a permanently pending operation. The production strategy awaits `bundle.wait()` (`src/utils/mevStrategies/flashbots.ts:317`).
- **MEDIUM:** The boot-site refusal case lacks an equally explicit pre-failure path marker in the described assertions.

**Suggestions**

- After containment, require continued event-loop activity and an independent successful operation.
- Distinguish clean survival, incomplete work, setup failure, signal termination, and timeout.
- Define a path marker for every table row, including boot.

**Risk assessment:** **MEDIUM** — credible crash evidence, with recovery limits needing explicit treatment.

## 23-13

**Summary:** The static and import-time routes are reasonable, but the logger experiment would observe test-mode behavior.

**Strengths**

- The simulation genuinely sends an approval (`src/utils/tokenSafety.ts:277`).
- The import-write claim has a concrete source: migrations unconditionally assign `user_version` (`src/utils/dbSchema.ts:216`).

**Concerns**

- **HIGH:** A railed child retains `VITEST`; config deliberately skips dotenv in that mode (`src/config.ts:5`). Observing `info` therefore does not prove production import-order behavior.
- **MEDIUM:** Merely finding a process-lock call cannot prove signing occurs while the lock is held. `tryAcquireThenRelease` deliberately releases it immediately (`src/utils/processLock.ts:204`).

**Suggestions**

- Use the static import-order proof for the logger case from the outset.
- Trace acquisition lifetime and signing reachability, rather than call presence.
- Identify which DB-file changes come from version assignment versus journal-mode initialization.

**Risk assessment:** **HIGH** — the logger test currently supports the wrong conclusion.

## 23-14

**Summary:** Reusing established rail proofs is appropriately restrained and avoids unnecessary production edits.

**Strengths**

- Existing singleton tests exercise real duplicate loads (`test/unit/guards/singleton.test.ts:89`).
- Environment tests check sentinels at module-import time (`test/unit/rails/envSentinel.test.ts:56`).

**Concerns**

- **MEDIUM:** A `closes-finding` comment and free-form proof string do not establish that the identified test executed.
- **MEDIUM:** The helper-schema closure describes a before/after change, but the existing smoke assertion currently expects 4 (`test/unit/helpers.smoke.test.ts:34`); an executed RED result for the replacement assertion is still needed.

**Suggestions**

- Bind closures to exact passing test identities in the current report.
- Store the helper regression’s RED output before changing the helper.

**Risk assessment:** **MEDIUM** — low implementation risk, but evidence provenance needs tightening.

## 23-15

**Summary:** The approval boundary is clear, but the proposed request cannot reliably settle the broad endpoint claim.

**Strengths**

- The telemetry call really is awaited inside submission (`src/utils/mevStrategies/flashbots.ts:345`).
- The proposed request matches the installed library’s parameter structure (`node_modules/@flashbots/ethers-provider-bundle/build/index.js:545`).

**Concerns**

- **HIGH:** Block 1 and an all-zero bundle hash do not represent a known bundle. An error may reflect invalid parameters, authorization, or unavailable historical data; it cannot automatically establish endpoint removal. The [official provider source](https://github.com/flashbots/ethers-provider-flashbots-bundle/blob/master/src/index.ts) describes this API as querying a particular bundle and target block.
- **MEDIUM:** Relay-log order alone does not prove the mutex remains held.

**Suggestions**

- Predefine conclusive and inconclusive response classifications.
- Accept an operator-supplied recent block without adding another request.
- Hold the stats response and demonstrate that a second same-wallet operation cannot start.

**Risk assessment:** **HIGH** — otherwise ambiguous external evidence could close the candidate incorrectly.

## 23-16

**Summary:** Generating the operator report from executions is good, but the escalation record conflicts with existing register invariants.

**Strengths**

- Installed Vitest JSON output preserves both test identity and metadata (`node_modules/vitest/dist/chunks/index.DXMFO5MJ.js:3770`).
- Verbatim operator responses preserve attribution.

**Concerns**

- **HIGH:** Listing existing findings in a second escalation’s `items` fails the one-record rule (`.planning/audit/tools/check.ts:633`). Existing findings already point to their original escalation records.
- **HIGH:** Comparing only `(id, expected, actual)` does not verify that every required test or subclaim appeared. The same finding can have several independent proofs.

**Suggestions**

- Add an explicit acknowledgement/review record type that preserves original escalation ownership.
- Compare `(finding, test identity, subclaim, expected, actual)` and require completeness against the frozen triage population.
- Validate each requested ruling separately.

**Risk assessment:** **HIGH** — the planned batch cannot pass the current checker as written.

## 23-17

**Summary:** Promoting the type-aware census is appropriate, but the copy instructions miss a required dependency relocation.

**Strengths**

- The existing analyzer explicitly distinguishes locked, unlocked, and unknown paths (`.planning/audit/tools/signing-census.ts:42`).
- Its manual reconciliation already checks exclusions and disagreements (`.planning/audit/tools/signing-census.ts:1025`).

**Concerns**

- **HIGH:** The original imports `./lib` (`.planning/audit/tools/signing-census.ts:61`). Copying it into `scripts/` leaves that import unresolved; `scripts/lib.ts` does not exist.
- **MEDIUM:** A non-empty decision reference is weaker than validating an existing decision or acknowledgement covering the listed exception.

**Suggestions**

- Specify the relocated shared utilities or corrected import explicitly.
- Validate reference existence and scope.
- Include a negative test where an unrelated decision ID is attached to a new exception.

**Risk assessment:** **HIGH** — the promoted command otherwise fails before performing analysis.

## 23-18

**Summary:** Behavioral conversion is worthwhile, but the prescribed replacement loses some existing protections.

**Strengths**

- Existing runtime mocks provide useful observation seams (`test/integration/anti-rug/botWiring.test.ts:78`).
- The real resume query has the intended baseline join (`src/utils/db.ts:423`).

**Concerns**

- **HIGH:** `armPositionMonitoring` is private (`src/bot.ts:415`), despite the plan requiring its real export while keeping `src/` unchanged.
- **HIGH:** Testing that helper cannot replace the V3 wiring assertion or boot-resume assertion. V3 has separate inline wiring (`src/bot.ts:1485`); existing tests explicitly protect those distinct paths (`test/integration/anti-rug/botWiring.test.ts:391`, `:414`).
- **MEDIUM:** A separate helper DB does not automatically exercise the production prepared statement while `db.ts` remains mocked.

**Suggestions**

- Drive V2, V3, and boot paths independently.
- Declare any permitted export addition.
- Execute the actual exported query against its real connection.

**Risk assessment:** **HIGH** — test counts could remain unchanged while coverage weakens.

## 23-19

**Summary:** The standing search is useful, but several replacements need executable verification rather than apparent type safety.

**Strengths**

- Runtime exit behavior has existing exported seams, including `exitConfig` (`src/exitEngine.ts:128`).
- Restricting edits to the rail’s specific case helps contain scope.

**Concerns**

- **HIGH:** `REQUIRED_ENV_VARS` is not exported (`src/config.ts:14`), so the planned direct import requires a declared source edit.
- **HIGH:** A compile-time assertion inside a test is not checked by current CI configuration: both TypeScript projects include production source, excluding tests (`tsconfig.json`, `tsconfig.bot.json`).
- **MEDIUM:** Exercising shutdown stages alone does not prove production signal registration, which happens separately (`src/bot.ts:2292`).

**Suggestions**

- Add permitted exports to the plan’s ownership list.
- Run a dedicated type-check fixture.
- Preserve signal-registration coverage through observable listener installation and cleanup.

**Risk assessment:** **HIGH** — conversions could look stronger while silently dropping checks.

## 23-20

**Summary:** The recording format is coherent, but the secret scanner is incompatible with required recording content.

**Strengths**

- Ordered capture can expose the actual submit-before-row behavior (`src/bot.ts:1102`, `:1129`).
- Explicit comparison avoids automatic snapshot creation.

**Concerns**

- **HIGH:** Rejecting every non-sentinel 64-hex value rejects legitimate transaction and bundle hashes. Production records bundle hashes (`src/utils/mevStrategies/flashbots.ts:350`), and ethers derives transaction hashes from signed serialization (`node_modules/ethers/lib.commonjs/transaction/transaction.js:938`).
- **MEDIUM:** Five passing scenario tests do not establish five completed exit mechanisms unless completion assertions precede initial recording generation.

**Suggestions**

- Make secret detection field-aware: validate public hashes and signed transaction fields while rejecting unexpected secret-bearing fields.
- Prove the scanner accepts hashes and rejects planted keys.
- Finish guards and exit-completion assertions before committing the first recording.

**Risk assessment:** **HIGH** — the scanner currently makes valid recordings fail.

## 23-21

**Summary:** Separate V3 recordings are necessary, but the anti-rug scenario needs explicit evidence of an executed exit.

**Strengths**

- V3 independently threads fee tier and pool address through monitoring (`src/bot.ts:1485`).
- The detector distinguishes V3 Burn and Collect destinations (`src/anti-rug/detector.ts:1536`).

**Concerns**

- **HIGH:** A Burn followed by grace-window processing can produce a dry-run or suppressed result. `liveExecute=false` returns before selling (`src/anti-rug/exitTrigger.ts:179`).
- **MEDIUM:** A recorded sell submission alone does not prove receipt decoding and position closure.

**Suggestions**

- Assert the specific exit reason, decoded sell, mined receipt, and resulting DB state before recording.
- Specify owner allowlisting, withdrawal signals, confirm blocks, and live-execution configuration explicitly.

**Risk assessment:** **HIGH** — an initially blessed recording could omit the requested anti-rug exit.

## 23-22

**Summary:** The route coverage matches the specification, with useful protection against fail-closed non-ETH skips.

**Strengths**

- Non-ETH checker configuration is genuinely required (`src/chainRegistry.ts:969`).
- Public confirmation differs materially from relay acceptance: passthrough waits for three confirmations (`src/utils/mevStrategies/passthrough.ts:140`).

**Concerns**

- **MEDIUM:** Checking the safety read does not prove successful route completion. Relay acknowledgement, mined inclusion, and confirmation depth must remain distinct.
- **LOW:** One fee scenario captures a nominal point but leaves affordability boundaries weakly characterized (`src/utils/mevStrategies/reconciliation.ts:516`).

**Suggestions**

- Require signed-hash correspondence, realistic receipts, and the appropriate confirmation depth.
- Add inexpensive cases immediately below, at, and above the reserve boundary, plus a legacy-fee case.

**Risk assessment:** **MEDIUM** — coverage is appropriate, but completion criteria need precision.

## 23-23

**Summary:** The matrix structure is readable, but its most important added parser currently has no specified observable output.

**Strengths**

- The five risk settings really are parsed separately (`src/riskManager.ts:28`).
- One-variable changes make intentional parsing changes easier to inspect.

**Concerns**

- **HIGH:** Importing `riskManager` does not expose `riskConfig`; it is private (`src/riskManager.ts:36`). Recording only `CONFIG` and the registry can leave every risk-setting case unchanged.
- **MEDIUM:** A single baseline read trace proves only reads on that execution, not all conditional reads.
- **MEDIUM:** Non-finite values need explicit serialization; ordinary JSON would collapse `NaN` and infinities to `null`.

**Suggestions**

- Observe parsing through targeted `canSnipe` states or a declared permitted getter.
- Cross-check dynamic reads against a structural inventory.
- Encode non-finite values distinctly and restore env, spies, and DB connections after every case.

**Risk assessment:** **HIGH** — the matrix could miss precisely the risk-parser behavior it was widened to capture.

## 23-24

**Summary:** The ordering objectives are valuable, but the plan assumes observability and completion guarantees the code does not provide.

**Strengths**

- Port zero is passed directly to `server.listen`, supporting ephemeral binding (`src/api/server.ts:209`).
- Singleton identity rules are explicit in the real guard (`src/guards/singleton.ts:70`).

**Concerns**

- **HIGH:** Successful preflight and listener-start logs lack `op` fields (`src/preflight.ts:1007`, `src/bot.ts:1738`); an op-only timeline cannot establish the proposed full ordering.
- **HIGH:** `resumeMultiChainMonitoring` returns before its balance promises finish (`src/bot.ts:1936`). Call order does not prove exit timers are armed before anti-rug resume.
- **MEDIUM:** The API close handle is retained locally, while boot returns no cleanup handle (`src/bot.ts:1860`).

**Suggestions**

- Separate invocation order from completion order.
- Add execution barriers and record all relevant observable events.
- Define complete boot-test teardown, including signals and API handles.

**Risk assessment:** **HIGH** — assertions could accidentally encode the comment’s intent rather than current behavior.

## 23-25

**Summary:** Git-based enforcement is a good fit, but baseline identity and history edge cases need additional tests.

**Strengths**

- Argument-array git calls follow the existing safe helper pattern (`.planning/audit/tools/seal-verify.ts:109`).
- Existing CI checkout lacks full-history configuration (`.github/workflows/test.yml:12`), so explicitly addressing shallow history is necessary.

**Concerns**

- **MEDIUM:** A delete followed by re-addition is classified as a new `A` file, although the logical scenario is not new. This can weaken protection after an authorized deletion.
- **MEDIUM:** IDs resolved only against the current register can retrospectively legitimize older commits.
- **MEDIUM:** Merge-only conflict-resolution changes remain outside judgment under the locked merge exemption.

**Suggestions**

- Maintain scenario identity across deletion and re-addition.
- Validate decision IDs against the relevant commit tree.
- Add negative cases for rename/re-addition and merge-only changes, documenting the exemption’s limits.

**Risk assessment:** **MEDIUM** — the core check works, but history semantics need sharpening.

## 23-26

**Summary:** The final verification is broad, but successor-seal support is underspecified relative to the existing verifier.

**Strengths**

- Test identity compares original titles rather than relying only on counts (`.planning/audit/tools/test-identity.ts:7`).
- The untouched-data wrapper verifies hashes, metadata, and rail-ledger ownership (`scripts/verify-prod-untouched.ts:17`).

**Concerns**

- **HIGH:** The verifier hardcodes `inputs/phase-scan.json` (`.planning/audit/tools/seal-verify.ts:76`, `:498`). Adding `--seal` and `covers` alone does not make it verify the new `phase-scan-23.json`.
- **MEDIUM:** Phase scanning also hardcodes the original phase-start record (`.planning/audit/tools/seal-verify.ts:697`), so the resulting range needs explicit treatment.
- **MEDIUM:** Review-summary lines establish that someone recorded a judgment; they do not independently prove preserved assertion strength.

**Suggestions**

- Add a validated scan-record reference to successor seals and verify its digest and range.
- Test predecessor linkage, scan substitution, audit-folder tampering, and permitted outside-folder changes.
- Run final checks again against the exact sealed revision.

**Risk assessment:** **HIGH** — the successor can fail verification despite otherwise complete work.

## Cross-plan findings and overall assessment

**Overall risk: HIGH. Revise before execution.** The scope and research are strong, but several planned proofs can establish the wrong mechanism, and several commands cannot work literally as specified.

Prioritize these corrections:

1. **Harness semantics and lifecycle:** distinguish mined/pending nonces, support replacement histories, and provide complete teardown and persistent restart fixtures.
2. **Evidence enforcement:** make capture violations unconditionally fail; bind outcomes to executed test identities and individual operator rulings.
3. **Checker compatibility:** isolate the triage stage, support batch acknowledgements without replacing original escalations, repair the census import, and parameterize successor scan records.
4. **Preserved protection:** retain separate V2, V3, boot, and signal-registration checks during source-text conversion.
5. **Recording validity:** accept public hashes, assert completed exit paths before recording, and expose actual risk-parser outcomes.

Two additional integration conflicts need explicit resolution:

- The orphan-marker rule in `23-04-PLAN.md:129` rejects a `knownBug` belonging to an `unreproduced` finding. The manual-probe skip path retains such a test while choosing `unreproduced`. Define partial proof at subclaim level.
- The serializer contract writes `<name>.jsonl`, while the env plan requires `.json` files. Settle that shared writer interface before the first recording lands.

The “scoped insertions commute” convention also needs replacement with explicit ownership or serialized harness updates. Shared transport behavior can conflict even when edits touch different lines.

---

## Antigravity Review

> **Partial lane: only 23-01 to 23-04 are included. Do not treat this lane as a 26-plan review.**
>
> Antigravity's sections for 23-05 to 23-26 and its cross-plan summary describe plans that do not exist. They cite finding families (`AUD-BOT`, `AUD-MEV`, `AUD-HP`, `AUD-CFG`, `AUD-ENTRY`, `AUD-AR`, `AUD-TG`, `AUD-UTIL`) that appear zero times in the prompt and in `.planning/audit/findings/`, and 20 file names that appear in neither the prompt nor git history. It never mentions the real families (`AUD-BUY`, `AUD-TX`, `AUD-ANTIRUG`). Its 23-26 concerns quote commands the plan does not contain.
>
> Those sections are left out so `/gsd-plan-phase --reviews` cannot act on them. The complete output is preserved at `.review-diagnostics/20261109T204210Z-gsd-review-ZVORZV/gsd-review-antigravity.md`. The lane receives its prompt as a file reference, so it probably read only the start of the 463 KB file. That cause is inferred, not confirmed.
>
> **The HIGH on `db.inTransaction` in 23-02 below is disproved.** See Divergent Views in the Consensus Summary.

## 23-01

### Summary
Plan `23-01` establishes the core `test/realpath/` harness (`world.ts`, `chain.ts`, `relays.ts`, `apis.ts`, `setup.ts`) and wires the fourth `realpath` project into [vitest.config.ts](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/vitest.config.ts#L31-L75). The design is exceptionally well-grounded in empirical verification against the Phase 22 rail infrastructure (`test/rails/core.cjs`, `test/unit/rails/spawnSites.test.ts`, and `src/guards/singleton.ts`), particularly in how it resolves ethers v6's bundled `ws` dependency and avoids duplicate-singleton collisions when resetting modules. One medium concern around how `createRequire` interacts with the `spawnSites.test.ts` AST gate and one around cleanup ordering when `buildWorld` fails mid-setup should be tightened before execution.

### Strengths
- **Empirically verified `ws` cache swap reaching ethers v6 (`test/unit/rails/spawnSites.test.ts:120-128`):** The plan's two-hop `createRequire` resolution (`createRequire(req.resolve('ethers'))('ws')`) directly addresses the fact that `ethers` v6 resolves its own nested `ws` package (`node_modules/ethers/node_modules/ws/index.js`) rather than the top-level `ws`.
- **Duplicate-load guard compatibility (`src/exitEngine.ts:1423`, `src/anti-rug/detector.ts:194`, `src/utils/nonceAuthority.ts:45`):** The plan's `loadGraph()` design in `test/realpath/harness/world.ts` calls `vi.resetModules()` and bumps `process.env.CSB_EPOCH` before dynamically importing the fresh production graph, matching the `registerSingleton(..., EPOCH)` contract in `src/guards/singleton.ts` and `src/guards/epoch.ts`.
- **Safe coexistence with `vitestEnvFile.test.ts` (`test/unit/rails/vitestEnvFile.test.ts:48-75`):** Adding `realpath` with `extends: true` in [vitest.config.ts](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/vitest.config.ts#L31-L75) preserves the `decoyProject` serialization invariant in [`vitestEnvFile.test.ts`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/test/unit/rails/vitestEnvFile.test.ts#L49-L53), which asserts `p.extends === true` for every entry in `mainConfig.test.projects` and strips custom `setupFiles`/`resolve.alias` in its decoy config.
- **Compliance with `spawnSites.test.ts` AST rules (`test/unit/rails/spawnSites.test.ts:41,104-148`):** Using literal string specifiers in `loadGraph()`'s `import(...)` calls and naming the `better-sqlite3` handle `db` avoids tripping both the non-literal dynamic import check (`spawnSites.test.ts:104-108`) and the `SAFE_EXEC_RECEIVERS` `.exec(` check (`spawnSites.test.ts:41,141-148`).

### Concerns
- **MEDIUM — `spawnSites.test.ts` AST gate on `createRequire` calls in `test/realpath/harness/chain.ts` (`test/unit/rails/spawnSites.test.ts:120-128`):** In [`scanFile`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/test/unit/rails/spawnSites.test.ts#L120-L128), any variable initialized from `createRequire(...)` is added to `requireAliases`, and any call `alias(arg)` where `arg` is not a `ts.isStringLiteral` or `ts.isNoSubstitutionTemplateLiteral` fails the gate (`require with a non-literal specifier`). If `installSeams` in `test/realpath/harness/chain.ts` accepts an optional `wsModuleOverride` parameter or helper and someone passes a variable to `ethersReq(targetSpec)`, `spawnSites.test.ts` will fail. The optional override for the negative self-check test must inject the pre-loaded module object directly rather than passing a variable specifier to `require`/`ethersReq`.
- **MEDIUM — `scripts/check-vi-mock-paths.ts` runs against `test/realpath/harness/setup.ts` (`scripts/check-vi-mock-paths.ts:66-69,120-141`):** [`check-vi-mock-paths.ts`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/scripts/check-vi-mock-paths.ts#L66-L69) walks all of `test/` (excluding only `test/fixtures/viMockGate`) and verifies every `vi.mock(specifier)` via `ts.resolveModuleName` and `createRequire(containingFile).resolve(specifier)`. In `test/realpath/harness/setup.ts`, `vi.mock('telegram', ...)`, `vi.mock('telegram/sessions', ...)`, and `vi.mock('telegram/events', ...)` must all resolve cleanly through Node/TS module resolution from `test/realpath/harness/setup.ts`. While `telegram` has subpath files `telegram/sessions/index.js` and `telegram/events/index.js`, `tsconfig.json` moduleResolution settings can cause `ts.resolveModuleName` to miss subpath directories unless `createRequire` fallback succeeds (`scripts/check-vi-mock-paths.ts:132-139`).
- **LOW — Partial-startup resource leak in `buildWorld` (`vitest.config.ts:60-74`):** `buildWorld` starts 4 loopback servers (`chain`, `relays`, `apis`, `tg`) and mutates `WebSocket.prototype` and `process.env`. If any server fails to bind or `loadGraph()` throws during a test, already-bound ephemeral HTTP servers and prototype patches will leak across tests in the same worker unless `buildWorld` wraps initialization in a `try/catch` that runs partial teardown.

### Suggestions
- In `test/realpath/harness/chain.ts`, ensure every `req(...)` and `ethersReq(...)` call uses a hardcoded string literal (`'ws'`), and implement the seam self-check by passing an injected `{ WebSocket: Class }` object parameter into `installSeams(opts?: { wsExports?: { WebSocket: unknown } })` rather than calling `require` on a variable.
- Wrap `buildWorld`'s server creation and `loadGraph()` in a `try / catch` block that closes any already-listening loopback servers and restores `WebSocket.prototype` and `process.env` before rethrowing.
- Run `npm run check:vi-mock` immediately after creating `test/realpath/harness/setup.ts` to confirm `telegram`, `telegram/sessions`, and `telegram/events` pass the Phase 22 `SAFE-06` gate.

### Risk Assessment
**MEDIUM** — The loopback seam architecture is sound and empirically proven, but `test/realpath/harness/*` sits inside `test/` where Phase 22's AST gates (`spawnSites.test.ts` and `check-vi-mock-paths.ts`) automatically enforce strict invariants on every file.

---

## 23-02

### Summary
Plan `23-02` adds the unified ordered `Timeline` capture (`test/realpath/harness/capture.ts`), scenario assertion helpers (`test/realpath/harness/assertions.ts`), and the AST mock-allowlist gate (`scripts/check-realpath-mocks.ts` + fixtures). While the AST gate and SQLite `AFTER INSERT/UPDATE/DELETE` trigger concept are well-thought-out, there is a **critical (`HIGH`) SQLite/better-sqlite3 bug** in Task 1's `db.inTransaction` guard that will cause every single database write trigger to throw at runtime if implemented as written.

### Strengths
- **Complete SQLite table coverage (`src/utils/dbSchema.ts:18-174`):** Installing `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` triggers across all five application tables (`trades`, `exit_state`, `lp_baseline`, `chain_state`, `pause_state`) captures every prepared statement in [`src/utils/db.ts`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/src/utils/db.ts#L98-L558) without wrapping `db.prepare` or modifying `src/utils/db.ts`.
- **Direct reuse of the Phase 22 AST walker (`scripts/check-vi-mock-paths.ts:143-216`):** Modeling `scripts/check-realpath-mocks.ts` on [`collectViBindings`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/scripts/check-vi-mock-paths.ts#L143-L162) and [`scanFile`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/scripts/check-vi-mock-paths.ts#L164-L216) in `scripts/check-vi-mock-paths.ts` ensures aliased `vi` imports (`import { vi as v } from 'vitest'`) and namespace imports (`import * as vitest from 'vitest'`) are caught.
- **Deterministic cross-boundary causal ordering (`test/realpath/harness/assertions.ts`):** Routing DB triggers, pino JSON stream writes, HTTP/JSON-RPC requests, and WS frames into a single monotonically sequenced `Timeline` enables `expectOrder` to verify cross-subsystem invariants (e.g., `eth_call` simulation before `eth_sendBundle`, `insertTrade` before `startExitMonitor`).

### Concerns
- **HIGH — `db.inTransaction` is ALWAYS `true` inside a SQLite trigger callback, even for autocommit statements (`src/utils/db.ts:98-105`):** Task 1 states: *"In `installDbCapture(db, timeline)`, record `db.inTransaction` on each entry and throw a clear harness error if `db.inTransaction` is true when a trigger fires unless the test explicitly opts in (`allowTransactions?: boolean`), so any future transactional rollback cannot silently leave a phantom timeline entry (RESEARCH Open Question 5)."* In SQLite's C API (`sqlite3_get_autocommit`), **every** DML statement (`INSERT`, `UPDATE`, `DELETE`) executes inside an internal statement transaction; `sqlite3_get_autocommit(db)` returns `0` for the entire duration of the statement, including while `AFTER INSERT/UPDATE/DELETE` triggers and their user-defined SQLite functions (`__rec`) execute. Because `better-sqlite3`'s `db.inTransaction` getter is literally `!sqlite3_get_autocommit(db)`, `db.inTransaction` is `true` inside `__rec` on **every autocommit `insertTrade.run(...)`, `upsertExitState.run(...)`, and `setPauseState.run(...)` call**! Throwing when `db.inTransaction` is `true` inside `__rec` will break every single DB write in the harness.
- **MEDIUM — `vi.spyOn(process, 'exit')` AST check in `scripts/check-realpath-mocks.ts` could allow arbitrary `process` spies if not strictly checking the second argument (`scripts/check-vi-mock-paths.ts:169-214`):** Task 3 states `(c) vi.spyOn is a violation unless its first argument is the global process and the call is on exit`. If the AST check does not verify that `node.arguments[1]` is a string literal `'exit'` (i.e., `ts.isStringLiteral(arg1) && arg1.text === 'exit'`), a test could spy on `process.kill` or `process.cwd`, or pass a dynamic second argument.
- **LOW — `vi.hoisted` and `vi.importMock` are not listed in the forbidden `vi.*` methods in `scripts/check-realpath-mocks.ts` (`scripts/check-vi-mock-paths.ts:164-216`):** While `vi.mock`, `vi.doMock`, `vi.fn`, `vi.spyOn`, and `vi.stubGlobal` are blocked, blocking `vi.importMock` as well prevents auto-mocked module imports in `test/realpath/`.

### Suggestions
- **Fix the `db.inTransaction` trap in `test/realpath/harness/capture.ts`:** Do **not** check `db.inTransaction` inside the `__rec` SQLite function callback. Instead, if you want to guard against `db.transaction(...)` rollbacks leaving phantom timeline entries, either:
  1. Wrap `db.transaction` on the `db` instance in `installDbCapture` so calling `db.transaction(...)` throws unless `allowTransactions: true` (or hooks commit/rollback to discard uncommitted timeline entries), or
  2. Record `inTransaction` outside the trigger (or omit the throw inside `__rec` since [`src/utils/db.ts`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/src/utils/db.ts#L1-L585) has zero `db.transaction(` calls).
- In `scripts/check-realpath-mocks.ts`, assert both `ts.isIdentifier(arg0) && arg0.text === 'process'` AND `ts.isStringLiteral(arg1) && arg1.text === 'exit'` for the `vi.spyOn(process, 'exit')` exception.

### Risk Assessment
**HIGH** — Left unadjusted, throwing on `db.inTransaction === true` inside the SQLite trigger function `__rec` will cause every `INSERT`/`UPDATE`/`DELETE` in `test/realpath/` to fail immediately. Fixing that check drops the risk to LOW.

---

## 23-03

### Summary
Plan `23-03` closes `CHAR-05` (`AUD-TEST-002`) by replacing the hand-rolled v4 schema in [`test/helpers/testDb.ts`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/test/helpers/testDb.ts#L17-L71) with a call to production [`migrateSchema(db)`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/src/utils/dbSchema.ts#L18-L216), adding a unit test in `test/unit/db/testDbHelper.test.ts`, and registering the `exitStatePersistence.test.ts` `v4`→`v7` test-title rename in `.planning/audit/inputs/rails-test-edits.json`. The plan is clean, well-scoped, and directly addresses the root cause of schema drift in tests.

### Strengths
- **Eliminates v4→v7 schema drift at the root (`test/helpers/testDb.ts:28-70`, `src/utils/dbSchema.ts:18-216`):** [`test/helpers/testDb.ts`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/test/helpers/testDb.ts#L28-L70) currently creates only `trades` and `exit_state` at `PRAGMA user_version = 4`, omitting `lp_baseline` (v5, `dbSchema.ts:127-149`), `chain_state` (v5/v6, `dbSchema.ts:141-161`), `pause_state` (v6, `dbSchema.ts:163-174`), and `exit_state.exit_failure_count` / `exit_status` (v7, `dbSchema.ts:186-213`). Delegating to `migrateSchema(db)` guarantees all 5 tables and `user_version = 7` stay in sync with production.
- **Preserves `pause_state` singleton row during `clearTestDb` (`src/utils/dbSchema.ts:170-173`, `src/utils/db.ts:522-550`):** In [`src/utils/dbSchema.ts`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/src/utils/dbSchema.ts#L170-L173), migration v6 seeds `pause_state` with `id = 1, paused = 0`, and [`getPauseState`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/src/utils/db.ts#L525-L528) expects row `id = 1` to exist (`SELECT paused, paused_at, paused_by, reason FROM pause_state WHERE id = 1`). Task 1's `clearTestDb` resets `pause_state` via `UPDATE pause_state SET paused = 0, paused_at = NULL, paused_by = NULL, reason = NULL WHERE id = 1` instead of `DELETE FROM pause_state`, preventing `undefined` row crashes in `getPauseState.get()`.
- **Properly reconciles `test-identity.ts` rename tracking (`.planning/audit/tools/test-identity.ts:200-221`):** Task 2 registers the `v4` → `v7` test title change in [`.planning/audit/inputs/rails-test-edits.json`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/.planning/audit/inputs/rails-test-edits.json#L4-L20) with `title_before` and `title_after` so [`test-identity.ts`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/.planning/audit/tools/test-identity.ts#L212-L219) recognizes the rename instead of flagging a lost test (`NAC-04`).

### Concerns
- **MEDIUM — `migrateSchema` calls `logger.info` on fresh DB initialization, which can break tests that partially mock `src/utils/logger` (`src/utils/dbSchema.ts:122,150,175,214`, `.planning/audit/inputs/rails-test-edits.json:119-127`):** When `migrateSchema(db)` runs on an empty in-memory DB (`user_version = 0`), it calls `logger.info(...)` at lines 122, 150, 175, and 214 of [`src/utils/dbSchema.ts`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/src/utils/dbSchema.ts#L122-L214). As documented in `rails-test-edits.json:119-127` (`AUD-TESTU-001`), any test file that mocks `../../src/utils/logger` with only `{ logger: { child: ... } }` (omitting top-level `logger.info`) will throw `TypeError: logger.info is not a function` when `createTestDb()` calls `migrateSchema(db)`.
- **LOW — `clearTestDb` order of `DELETE` statements with `PRAGMA foreign_keys = ON` (`test/helpers/testDb.ts:21`, `src/utils/dbSchema.ts:59,130`):** Both `exit_state` (`dbSchema.ts:59`) and `lp_baseline` (`dbSchema.ts:130`) have `REFERENCES trades(id)` without `ON DELETE CASCADE`, and `createTestDb()` sets `db.pragma('foreign_keys = ON')` (`testDb.ts:21`). `clearTestDb` must delete from `exit_state` and `lp_baseline` **before** `DELETE FROM trades`, or SQLite will throw `FOREIGN KEY constraint failed`. Task 1 lists the right order (`DELETE FROM exit_state; DELETE FROM lp_baseline; DELETE FROM trades; DELETE FROM chain_state;`) — make sure this order is strictly preserved.

### Suggestions
- Before finalizing Task 1, run the full `npm run test:unit` and `npm run test:integration` suites to verify no existing caller of `createTestDb()` has a partial `logger` mock missing top-level `logger.info`.
- In `test/unit/db/testDbHelper.test.ts`, include a test case that inserts linked rows into `trades`, `exit_state`, and `lp_baseline` and then calls `clearTestDb(db)` with `foreign_keys = ON` to lock in the child-before-parent deletion order.

### Risk Assessment
**LOW** — The change is small, directly tested against all 9 existing callers of `createTestDb()`, and backed by `test-identity.ts` verification.

---

## 23-04

### Summary
Plan `23-04` extends [`.planning/audit/tools/check.ts`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/.planning/audit/tools/check.ts#L183-L960) with `--stage triage` and builds `.planning/audit/tools/set-triage.ts` to record Phase 23 triage outcomes across the 59 `src/` findings without hand-editing ledger JSON files. There is a **critical (`HIGH`) control-flow bug** in how Task 1 describes wiring `'triage'` into `check.ts`: unless line 924 of `check.ts` is updated alongside `STAGES`, running `check.ts --stage triage` will execute the `--stage final` universe check (`checkUniverseAt(R, R.headSha, 'HEAD')`) and fail on every file added in Phase 23.

### Strengths
- **Preserves Phase 22 ledger integrity (`check.ts:273-360`):** Using a deterministic CLI tool (`set-triage.ts`) that validates code references (`ID_RE.codeRef` at `check.ts:19,275`) and updates both `finding.triage` and `finding.status` prevents manual JSON syntax/schema errors across `.planning/audit/findings/*.json`.
- **Idempotent CLI design (`set-triage.ts`):** Requiring `--id`, `--outcome`, `--test`, `--note`, and `--verified-by` with `--dry-run` and `--self-test` modes gives waves 2–3 a repeatable mechanism to record all 59 triage outcomes.

### Concerns
- **HIGH — `check.ts:924` `if (stage !== 'partial')` will run `checkConsolidation` and `checkUniverseAt(R, R.headSha, 'HEAD')` under `--stage triage` (`.planning/audit/tools/check.ts:183-193,924-937`):** Task 1 says: *"Add `'triage'` to `Stage` and `STAGES`. Keep `strict` true only for consolidation and final, so triage runs per-file checks like partial without reopening other slices' pending items."* However, in [`check.ts:924-937`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/.planning/audit/tools/check.ts#L924-L937), the consolidation and universe checks are gated on `if (stage !== 'partial')`, **not** `if (R.strict)`:
  ```ts
  if (stage !== 'partial') {
      checkConsolidation(R);
      if (stage === 'consolidation') checkUniverseAt(R, R.baseSha, 'audit_base_sha');
      else {
          checkUniverseAt(R, R.headSha, 'HEAD');
          ...
      }
  }
  ```
  If `stage === 'triage'` and line 924 is left as `if (stage !== 'partial')`, `--stage triage` will enter the `else` branch and call `checkUniverseAt(R, R.headSha, 'HEAD')` + `checkEscalationsResolved(R)` + `checkSealIfPresent(R)` — failing immediately because Phase 23 adds new files under `test/realpath/` and `scripts/` that are not in the Phase 22 universe manifest!
- **MEDIUM — `--slice` flag rejection at `check.ts:947` (`.planning/audit/tools/check.ts:945-947`):** Line 947 of [`check.ts`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/.planning/audit/tools/check.ts#L945-L947) has `if (sel.length && stage !== 'partial') throw new UsageError('--slice is only valid with --stage partial');` and line 945 has `throw new UsageError('--stage must be partial, consolidation or final')`. Both lines should be updated if operators or wave verifiers pass `--slice` or inspect usage errors.
- **LOW — `set-triage.ts` status overwrite on already-`verified` or `fixed` findings (`.planning/audit/tools/check.ts:280`):** Task 1 notes that for outcome `fixed`, `finding.status` may be `'fixed'` or `'verified'`, whereas Task 2 says `set-triage.ts` maps `fixed` to `'fixed'`. If a finding in the ledger already has `status: 'verified'`, overwriting it to `'fixed'` would downgrade its status. `set-triage.ts` should preserve `'verified'` when `outcome === 'fixed'` and `finding.status === 'verified'`.

### Suggestions
- In [`.planning/audit/tools/check.ts`](file:///C:/Users/jackc/WebstormProjects/crypto-snipe-bot/.planning/audit/tools/check.ts#L924-L938), change line 924 from `if (stage !== 'partial')` to `if (stage === 'consolidation' || stage === 'final')`, and add an `else if (stage === 'triage') { checkSrcTriageComplete(R); }` branch (and also call `checkSrcTriageComplete(R)` if desired, or keep it scoped to `stage === 'triage'`).
- In `set-triage.ts`, when `--outcome fixed` is passed, keep `finding.status = 'verified'` if it is already `'verified'`, otherwise set `'fixed'`.

### Risk Assessment
**HIGH** — Without updating the `if (stage !== 'partial')` branch at `check.ts:924`, `check.ts --stage triage` will fail as soon as any Phase 23 file is created. Updating line 924 resolves this completely.


---

## Consensus Summary

**Evidence base.** Codex reviewed all 26 plans against source. Antigravity's usable coverage is 23-01 to 23-04, so agreement between reviewers is only possible on those four plans. 23-05 to 23-26 rest on Codex alone. "Verified" below means the claim was checked against the repository while this file was assembled. Everything else is a reviewer claim.

**Overall verdict: revise before execution.** Codex rates the phase HIGH risk. Several planned proofs would establish the wrong mechanism, and several commands cannot work as written.

### Agreed Strengths

- 23-01's handling of the separate `ws` module that ethers loads is sound, and it reaches the real WebSocket path (Codex, Antigravity).
- 23-02's database capture through SQLite triggers is well targeted and needs no `src/` change (Codex, Antigravity).
- 23-03 is a direct, low-risk move to the real migrations. Both reviewers rate it LOW.

### Agreed Concerns

1. **HIGH, 23-04, verified.** `--stage triage` will run the consolidation and HEAD-universe checks. `.planning/audit/tools/check.ts:924` branches on `stage !== 'partial'`, not on `strict`, and the plan only changes `strict` (`23-04-PLAN.md:93`). Both reviewers want an explicit stage list at that branch.
2. **MEDIUM, 23-02, not independently checked.** The mock gate is underspecified. Codex notes `mockMethodOf` knows only four methods (`scripts/check-vi-mock-paths.ts:69`), and both reviewers want `vi.spyOn` arguments and `vi.importMock` handled explicitly.
3. **MEDIUM, 23-01, not independently checked.** Harness cleanup is incomplete. Codex wants an awaited disposer for timers, providers and pending work. Antigravity wants partial startup failures cleaned up.

### Verified Codex Blockers (single reviewer)

Each of these was confirmed in the plan text and the code.

| Plan | Problem | Evidence |
|---|---|---|
| 23-01 | The fake node advances the transaction count on acceptance, with no `latest` versus `pending` split. An unmined submission can look mined, which would affect every later nonce and inclusion proof. | `23-01-PLAN.md:167` |
| 23-06 | The only S0 proof models two processes with two graph loads, but each load closes the previous database and opens a new `:memory:` one. Graph A can never see graph B's row. | `23-01-PLAN.md:140`, `23-06-PLAN.md:95` |
| 23-07 | Restart evidence relies on the same reload, so persisted exit state is lost (same mechanism as 23-06). | `23-01-PLAN.md:140` |
| 23-16 | `ESC-TRIAGE-01` lists every confirmed S0 and S1 finding in `items`, but a finding listed under an escalation other than its `escalation_ref` fails the checker. | `23-16-PLAN.md:128`, `.planning/audit/tools/check.ts:633-640` |
| 23-17 | The copied census imports `./lib`, the plan's required edits do not cover it, and `scripts/lib.ts` does not exist. | `.planning/audit/tools/signing-census.ts:61`, `23-17-PLAN.md:93` |
| 23-18 | The plan drives `armPositionMonitoring` "through its real export" with `src/` unchanged, but the function is not exported. | `src/bot.ts:415`, `23-18-PLAN.md:80` |
| 23-19 | The plan imports `REQUIRED_ENV_VARS`, which is not exported. | `src/config.ts:14`, `23-19-PLAN.md:101` |
| 23-20 | The secret scan rejects any 64-hex value not found in `test/.env.test`. Recordings hold transaction and bundle hashes, and the plan names no hash normalization. | `23-20-PLAN.md:163` |
| 23-23 | `riskConfig` is private and the plan names no way to observe the five risk settings it was widened to cover. | `src/riskManager.ts:36` |
| 23-26 | The verifier hardcodes `inputs/phase-scan.json`, while the plan writes `phase-scan-23.json` and names no change to that path. | `.planning/audit/tools/seal-verify.ts:76`, `23-26-PLAN.md:152` |

Partly verified: for 23-13, `src/config.ts:5` does skip dotenv under `VITEST`, which supports Codex's point about the logger experiment.

Not independently checked, and worth confirming during replanning:

- 23-02: a capture failure swallowed by production error handling.
- 23-04: operator-ruling membership.
- 23-05: competing-hash histories.
- 23-08: a 404 hiding the pause gate.
- 23-15: whether block 1 and a zero hash can settle the endpoint question.
- 23-16: completeness of the report comparison.
- 23-18: separate V3 and boot paths.
- 23-19: compile-time checks and signal registration.
- 23-21: dry-run anti-rug recording.
- 23-24: logs without `op` fields and completion ordering.
- Cross-plan: the orphan-marker conflict at `23-04-PLAN.md:129`, the `.jsonl` versus `.json` writer conflict, and the "scoped insertions commute" convention.

### Divergent Views

- **`db.inTransaction` in 23-02: Antigravity's HIGH is disproved.** It claimed the value is always true inside a trigger, so every write would throw. A direct test against the project's `better-sqlite3` on Node 22, using an in-memory database and an ordinary autocommit insert, returned `false` inside the trigger function. The plan's guard does not need this change.
- **Overall risk.** Codex says HIGH and Antigravity says MEDIUM. Antigravity's rating rests largely on plans it did not read, so Codex's rating should carry the decision.
- **23-01 risk.** Codex says HIGH because of nonce semantics. Antigravity says MEDIUM and did not raise that issue.
