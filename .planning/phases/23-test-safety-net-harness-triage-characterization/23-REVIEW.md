---
phase: 23-test-safety-net-harness-triage-characterization
reviewed: 2026-11-13T00:46:41.821Z
depth: deep
scope: operator-narrowed file list, reviewed as five parallel deep slices (each under the 50-file downgrade threshold)
files_reviewed: 95
files_reviewed_list:
  - .github/workflows/test.yml
  - .planning/audit/tools/seal-verify.ts
  - package.json
  - scripts/check-commit-taxonomy.ts
  - scripts/check-realpath-mocks.ts
  - scripts/check-recordings-compared.ts
  - scripts/check-signing-census.ts
  - scripts/check-vi-mock-paths.ts
  - scripts/signing-census-exceptions.json
  - scripts/update-recordings.ts
  - test/helpers/sourceGraph.ts
  - test/realpath/env/envMatrix.test.ts
  - test/realpath/fixtures/sharedDbChild.ts
  - test/realpath/fixtures/wsSubscribeChild.ts
  - test/realpath/harness.test.ts
  - test/realpath/harness/capture.ts
  - test/realpath/harness/chain.ts
  - test/realpath/harness/knownBug.ts
  - test/realpath/harness/loopback.ts
  - test/realpath/harness/serializer.ts
  - test/realpath/harness/setup.ts
  - test/realpath/harness/telegram.ts
  - test/realpath/harness/world.ts
  - test/realpath/harnessCapture.test.ts
  - test/realpath/harnessRestart.test.ts
  - test/realpath/harnessTelegram.test.ts
  - test/realpath/recordingsGuard.test.ts
  - test/realpath/scenarios/driver.ts
  - test/realpath/triage/AUD-ANTIRUG-001.test.ts
  - test/realpath/triage/AUD-ANTIRUG-002.test.ts
  - test/realpath/triage/AUD-ANTIRUG-003.test.ts
  - test/realpath/triage/AUD-ANTIRUG-004.test.ts
  - test/realpath/triage/AUD-ANTIRUG-005.test.ts
  - test/realpath/triage/AUD-ANTIRUG-018.test.ts
  - test/realpath/triage/AUD-ANTIRUG-025.test.ts
  - test/realpath/triage/AUD-API-001.test.ts
  - test/realpath/triage/AUD-API-002.test.ts
  - test/realpath/triage/AUD-API-008.test.ts
  - test/realpath/triage/AUD-BUY-001.test.ts
  - test/realpath/triage/AUD-BUY-002.test.ts
  - test/realpath/triage/AUD-BUY-003.test.ts
  - test/realpath/triage/AUD-BUY-004.test.ts
  - test/realpath/triage/AUD-BUY-005.test.ts
  - test/realpath/triage/AUD-BUY-006.test.ts
  - test/realpath/triage/AUD-BUY-007.test.ts
  - test/realpath/triage/AUD-BUY-008.test.ts
  - test/realpath/triage/AUD-BUY-010.test.ts
  - test/realpath/triage/AUD-BUY-011.test.ts
  - test/realpath/triage/AUD-BUY-015.test.ts
  - test/realpath/triage/AUD-BUY-027.test.ts
  - test/realpath/triage/AUD-BUY-028.test.ts
  - test/realpath/triage/AUD-BUY-030.test.ts
  - test/realpath/triage/AUD-BUY-033.test.ts
  - test/realpath/triage/AUD-DB-001.test.ts
  - test/realpath/triage/AUD-DB-002.test.ts
  - test/realpath/triage/AUD-DB-003.test.ts
  - test/realpath/triage/AUD-DB-004.test.ts
  - test/realpath/triage/AUD-EXIT-001.test.ts
  - test/realpath/triage/AUD-EXIT-002.test.ts
  - test/realpath/triage/AUD-EXIT-003.test.ts
  - test/realpath/triage/AUD-EXIT-007.test.ts
  - test/realpath/triage/AUD-EXIT-008.test.ts
  - test/realpath/triage/AUD-EXIT-013.test.ts
  - test/realpath/triage/AUD-EXIT-014.test.ts
  - test/realpath/triage/AUD-EXIT-015.test.ts
  - test/realpath/triage/AUD-SCRIPTS-002.test.ts
  - test/realpath/triage/AUD-TX-001.test.ts
  - test/realpath/triage/AUD-TX-002.test.ts
  - test/realpath/triage/AUD-TX-003.test.ts
  - test/realpath/triage/AUD-TX-009.test.ts
  - test/realpath/triage/fixtures/AUD-ANTIRUG-003-live.ts
  - test/realpath/triage/fixtures/AUD-ANTIRUG-018-range-limit.ts
  - test/realpath/triage/fixtures/AUD-API-001-dashboard-sell.ts
  - test/realpath/triage/fixtures/AUD-API-002-restart.ts
  - test/realpath/triage/fixtures/AUD-BUY-011-dashboard.ts
  - test/realpath/triage/fixtures/AUD-DB-001-limits.ts
  - test/realpath/triage/fixtures/AUD-DB-002-risk.ts
  - test/realpath/triage/fixtures/AUD-EXIT-001-sell-path.ts
  - test/realpath/triage/fixtures/AUD-EXIT-002-position.ts
  - test/realpath/triage/fixtures/AUD-EXIT-014-rug.ts
  - test/realpath/triage/fixtures/AUD-TX-002-lock.ts
  - test/realpath/triage/fixtures/AUD-TX-003-second-launch.ts
  - test/realpath/triage/fixtures/bundleWaitCrash.ts
  - test/realpath/triage/fixtures/crashRun.ts
  - test/realpath/triage/fixtures/hostHeaderCrash.ts
  - test/realpath/triage/fixtures/loopbackChain.ts
  - test/realpath/triage/fixtures/scriptsStatic.ts
  - test/realpath/triage/fixtures/unhandledRejectionCrash.ts
  - test/realpath/triage/fixtures/wsReconnectRefused.ts
  - test/unit/commitTaxonomyGate.test.ts
  - test/unit/realpathMockGate.test.ts
  - test/unit/recordingsComparedGate.test.ts
  - test/unit/signingCensusGate.test.ts
  - test/unit/sourceTextGate.test.ts
  - vitest.config.ts
findings:
  critical: 10
  warning: 36
  info: 31
  total: 77
  necessity: 0
status: issues_found
---

# Phase 23: Code Review Report

**Reviewed:** 2026-11-12
**Depth:** deep (five parallel slices)
**Files Reviewed:** 95
**Status:** issues_found (10 critical, 36 warning, 31 info)

## Summary

### Scope

Phase 23 changed no production code (`git diff 7d0b7b38..fe251b7 -- src` is empty). At the operator's request the review was limited to:

- the simulated chain and the real-path test harness;
- the triage tests for the 44 S0/S1 findings Phase 24 will fix (42 test files, since `AUD-TX-002.test.ts` also proves AUD-BUY-025 and AUD-EXIT-009), plus the fixtures they use;
- the gates CI runs: commit taxonomy, recordings-compared, the source-text gate, the signing census and the two mock-list gates, plus the CI wiring around them (`.github/workflows/test.yml`, `package.json`, `vitest.config.ts`), and the seal verifier (`.planning/audit/tools/seal-verify.ts`);
- the recording pipeline (`serializer.ts`, `update-recordings.ts`, the scenario driver, the env matrix) and its secret scan (`recordingsGuard.test.ts`).

Left out as instructed: the one-time scripts (mutant proof runner and overlay, red-proof scripts, `triage-report.ts`, orchestrator helpers), the generated recordings and snapshots, and the planning and audit docs. Also left out because they are not in the list above: the characterization scenarios, ordering and migration golden tests, the rail tests, the other integration and unit tests Phase 23 touched, and the S2–S4 triage tests.

### Method

The workflow drops `deep` to `standard` above 50 files, and this scope is 95 files (about 30,000 lines). It was therefore split into five slices, each under 50 files, each reviewed in full at deep depth by its own gsd-code-reviewer agent:

- A: harness, 14 files
- B: triage tests for anti-rug, dashboard, database, nonce/TX and scripts, 32 files
- C: triage tests for buy and exit, 28 files
- D: gates and CI wiring, 15 files
- E: recording pipeline, secret scan and seal verifier, 6 files

The orchestrator merged the five reports, renumbered the IDs, and checked every Critical against the source at HEAD fe251b7. Each Critical's check is recorded under it. CR-08 and CR-09 were reproduced on the real census in a throwaway worktree. A range check of every file:line reference found that slice C's references into its test files were shifted, 11 of them past the end of the file. Slice C's reviewer re-located and corrected every reference against HEAD before this merge.

### Gate baseline (Node 22.16.0, as CI runs them)

The scripts require Node 22.16.0, which is installed at `C:\Users\jackc\AppData\Local\nvm\v22.16.0\node.exe`; slice D's statement that no Node 22 was available was wrong. Run there, every gate passes today:

- `check:census`: 23 signing sites, 10 locked and 13 unlocked (all on the exceptions list), 0 problems.
- `check:census -- --check-floor-history`: 0 problems.
- `check:realpath-mocks`: 0 violations.
- `check:vi-mock`: 0 violations.
- `check:commits`: PASS (54 commits judged, 0 violations).

### Seal verifier facts

- **Nothing runs it automatically.** It is not referenced in `test.yml`, in `package.json` scripts, in any test, or in the pre-commit hook. `23-CONTEXT.md:161` says "Nothing in CI runs the tool." It is not one of the gates that run in CI.
- **`SEAL.json` (Phase 22) reports `SEAL INVALID`, exit 1.** The reason: 500 paths Phase 23 legitimately changed are not on the Phase 22 exempt list (none under `src/`). The single merge in range adds no paths, so the explanation in a Phase 23 summary ("known D-19 merge-counting flaw") is out of date.
- **`SEAL-23.json` reports `SEAL VALID`, exit 0.** Given CR-10, that result is weaker evidence than it looks.

### What the findings say

1. **The S0/S1 triage tests prove real bugs on real code.** Every test drives real src/ code without mocking the mechanism it tests (D-TEST-BOTH holds), and none can reach the real database, `.env`, Telegram or a real network. The weakness is in how a fix will be read. In seven Criticals (CR-01..CR-03, CR-04..CR-07), a partial or wrong fix makes a test report "looks fixed" while the bug remains. Examples: a V2-only fix, a single-caller fix, a retry-once around a fail-open path, or releasing the nonce lock while the stuck nonce is still pending. In CR-01 a correct fix makes the test stall instead. Phase 24 uses these tests as its RED→GREEN proof, so each needs fixing before its fix wave starts. Many Warnings in slices B and C are narrower cases of the same pattern.
2. **The signing census can be bypassed by two code shapes** (CR-08, CR-09). A `sendTransaction` on a `ContractRunner`-typed or other non-Signer receiver, or a contract method called through a stored value, passes CI unlocked. No such site exists in src/ or scripts/ today; these are open routes for the input the gate exists to reject.
3. **The seal verifier fails open through its own record** (CR-10).
4. **Harness:** no Critical. Fidelity gaps that could matter for Phase 24 fixes: every mined tx succeeds, the default token balance never decreases on a sell, the fake WebSocket differs from ws when not OPEN, and the DB capture rejects writes inside `db.transaction`, which would fail a correct atomic-write fix.
5. **Recording secret scan:** no Critical. It catches non-hex secrets only when they match a `test/.env.test` sentinel exactly, it exempts every `data` key from the 64-hex rule, and nothing scans a re-recorded file before it is pushed.

Necessity was assessed in every slice; no necessity findings.

## Critical Issues

### CR-01: AUD-ANTIRUG-001 waits for the bug's four reconnect loops, so the recommended single-loop fix stalls instead of reading "looks fixed"

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, CR-B01)

**Orchestrator check:** Confirmed against the source at HEAD fe251b7: `dropAndReconnect` (AUD-ANTIRUG-001.test.ts:86-100) waits until the anti-rug and DEX "reconnected" counts reach the bug's loop counts before any claim is judged.

**File:** `test/realpath/triage/AUD-ANTIRUG-001.test.ts:86-100` (used by all three claims at :128, :152, :192)
**Issue:** `dropAndReconnect` only returns once the log holds at least one `antirug.ws.reconnected` op AND at least `sc.ctx.chain.dexes.length` (3) lines with the exact texts `'WebSocket reconnected, re-subscribed to PairCreated'` / `'... V3 PoolCreated'` (:93-97, `maxSteps: 2_000`, so 20 s virtual). Those lines exist only because each DEX close handler runs its own loop (`src/bot.ts:1568`, `:1610`), next to the anti-rug loop (`src/anti-rug/detector.ts:935`). That separation is the defect itself. The header (:36-38) says the fix signal is "one reconnect owner per chain that rebuilds the provider once and re-attaches every consumer". `AUD-ANTIRUG-001.json` recommends the same ("a single reconnect loop ..."). But 23-10-SUMMARY.md:416 shows the mutation actually used was "every reconnect loop takes the one cached provider", which keeps all four loops and all four log lines.
**Scenario:** Phase 24 implements OD-11 as one owner loop that logs one reconnect line, or that keeps `antirug.ws.reconnected` but drops the per-DEX "re-subscribed" texts. After `dropSocket()`, the predicate never holds, and `stepUntilTrue` throws "every reconnect loop reconnecting did not hold within 20000 virtual ms" on all three claims. A correct fix cannot be proven RED→GREEN without editing the test's wait during the GREEN step. That is the edit a RED→GREEN proof must not need.
**Fix:** Wait on the outcome, which is the same under every fix shape, not on per-loop log text. For example, wait until the old socket is closed, a new socket is open, and the node holds a rug-log subscription covering the pair again, then settle:
```ts
const reattached = () => FakeWebSocket.instances.some((w) => w !== dropped && w.url === sc.ctx.chain.wsRpcUrl && w.readyState === FakeWebSocket.OPEN)
    && covering(sc, sc.pair).length >= 1
    && sc.ctx.chain.dexes.every((d) => sc.node.subscriptions.some((s) => JSON.stringify(s.filter).toLowerCase().includes(d.factoryAddress.toLowerCase())));
await stepUntilTrue(reattached, { what: 'the chain WebSocket re-attached after the drop', maxSteps: 2_000 });
await stepFor(5_000);
```
Then re-run the claims under a real single-loop mutation, not the "shared cached provider" one.

### CR-02: AUD-DB-001 reads any `restartGraph` failure as "the limit is enforced", including stop-step failures that happen before `abc` is applied

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, CR-B02)

**Orchestrator check:** Confirmed against the source at HEAD fe251b7: `reloadAndCheck` (fixtures/AUD-DB-001-limits.ts:42-51) returns `loaded: false` for any `restartGraph` throw, and `enforced()` (:72-74) counts `!loaded` as enforced. `restartGraph` can throw from its stop steps before the new env is applied (world.ts:1120-1137).

**File:** `test/realpath/triage/fixtures/AUD-DB-001-limits.ts:42-51`, `:72-74`; used by all five claims in `test/realpath/triage/AUD-DB-001.test.ts:62-69, 85-92, 106-113, 126-133, 144-151`
**Issue:** `reloadAndCheck` wraps `restartGraph` in a catch-all and returns `{ loaded: false }` for any error. `enforced()` returns `true` for every `!o.loaded`. The tests never check, before the marker, why the load failed. `restartGraph` throws for many reasons unrelated to the risk variable:
- the old graph's stop steps fail (`test/realpath/harness/world.ts:1137`, raised before the env is even applied);
- "the eth chain is not enabled after the restart" (`:1152`);
- the checker address changes;
- a `loadGraph` import-time error from any other module.

Each of these makes `knownBug` throw "AUD-DB-001 now behaves correctly: remove this marker (it looks fixed)".
**Scenario:** The abc run is always the second reload in a row, so any leak that shows only on a second restart lands on it: a provider destroy failing on an in-flight request, `closeDb` throwing, a Phase 22 duplicate-load or lock guard tripping, or a Phase 24 change elsewhere that breaks a reload. When that happens, all five claims read "looks fixed" together while `src/riskManager.ts` still parses `abc` to NaN. Phase 24 would then remove the markers on a false signal.
**Fix:** Count only a load refusal that names the variable as enforcement, and let every other restart error propagate:
```ts
} catch (e) {
    await closeLeakedConnection();
    const msg = e instanceof Error ? e.message : String(e);
    if (!new RegExp(`\\b${variable}\\b`).test(msg)) throw e; // not a refusal of this limit
    return { loaded: false, error: msg };
}
```
Pass the variable name into `reloadAndCheck`. Also split `restartGraph` so that a stop-phase error can never be read as a load refusal (for example, call `restartGraph` with no env change first, then apply the env and call `loadGraph`).

### CR-03: AUD-TX-002 / AUD-BUY-025 / AUD-EXIT-009 read "lock released" as fixed, which also passes the wrong fix the recommendation forbids (lock released with the stuck nonce still pending)

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, CR-B03)

**Orchestrator check:** Confirmed against the source at HEAD fe251b7: the claim's `actual` is `result.settledAfterMs !== null` (AUD-TX-002.test.ts:115-122). The finding's recommendation (.planning/audit/findings/AUD-TX-002.json) says to "keep the lock until the nonce is settled or explicitly replaced, because releasing it while a public tx is still pending would let the next op sign the same nonce".

**File:** `test/realpath/triage/AUD-TX-002.test.ts:115-122, 160-167, 208-215`; `test/realpath/triage/fixtures/AUD-TX-002-lock.ts:51-60, 73-90`
**Issue:** Each claim's `actual` is `laterOperationStartedInWindow: result.settledAfterMs !== null`. That only says a probe that signs nothing got the wallet lock. The finding's own recommendation (`AUD-TX-002.json`) says: "Keep the lock until the nonce is settled or explicitly replaced, because releasing it while a public tx is still pending would let the next op sign the same nonce (ethers contract sends take nonce 'pending', strategies take 'latest')". The test cannot tell that correct fix from the naive one. The claims also accept a lock released for any unrelated reason: `pendingWindow` treats every settle of the bot's op as success (:81-87), and nothing checks why the op ended.
**Scenario:** Phase 24 adds a timeout, say `tx.wait(3, 120_000)` at `src/utils/mevStrategies/passthrough.ts:140` (or the matching change to `approveTx.wait()` / `stx.wait()`), and lets the error leave `withNonceLock`. About 2 minutes in, the lock is released while the `neverMine` transaction at nonce n is still pending. The probe starts, and all three claims read "looks fixed". The wallet's next real buy or sell signs nonce n again (or n+1 behind a gap), which is the hazard the recommendation names. Separately, if the passthrough wait rejects for another reason (an RPC error during receipt polling), the claim also reads fixed.
**Fix:** Make `correct` require the nonce outcome too. When the probe starts, the stuck nonce must be settled: mined through a same-nonce replacement or cancel, which `pendingWindow`'s `sc.node.mine()` would include, or recorded as explicitly reconciled. For example:
```ts
const stuckNonce = Transaction.from(buy.raw).nonce;
// in the probe body: record sc.node.minedCount(sc.wallet.address) at start
actual: { laterOperationStartedInWindow: result.settledAfterMs !== null, stuckNonceSettledBeforeRelease: probeMinedCountAtStart > stuckNonce },
correct: { laterOperationStartedInWindow: true, stuckNonceSettledBeforeRelease: true },
observed: { laterOperationStartedInWindow: false, stuckNonceSettledBeforeRelease: false },
```
Re-run the fix-shaped mutation as "timeout, then a same-nonce cancel, then release" to show the correct fix still flips, and add a second mutation, "timeout and release only", to show it now reads "the failure changed".

### CR-04: AUD-BUY-008 reads "looks fixed" after a V2-only fix; the V3 reconnect handler is never measured

**Area:** Triage tests: buy and exit (slice C, CR-C01)

**Orchestrator check:** Confirmed against the source at HEAD fe251b7: the claim's `actual` counts only `sc.dex.name` (uniswap-v2 for this eth V2 scenario), and the every-DEX loop runs after the marker.

**File:** `test/realpath/triage/AUD-BUY-008.test.ts:99-106` (marker), `:111` (all-DEX check, after the marker)
**Issue:** The marker's `actual` is `reconnects(sc.dex.name, from)`, which counts only `uniswap-v2`. ETH has three DEXes (`src/chainRegistry.ts:183,189,195`: uniswap-v2, sushiswap-v2, uniswap-v3), and the close handlers are two separate functions:
- `handleWsClose` for V2 (`src/bot.ts:1595-1620`)
- `handleWsCloseV3` for V3 (`src/bot.ts:1554-1578`)

Failure scenario: Phase 24 makes `handleWsClose`'s registration idempotent but not `handleWsCloseV3`'s. uniswap-v2 then reconnects once, `knownBug` throws "AUD-BUY-008 now behaves correctly", and the all-DEX loop at `:111` (which would catch uniswap-v3 still at 2) never runs. The register shows the finding fixed while every V3 PoolCreated is still doubled after a dashboard restart, which feeds AUD-BUY-004's double buy.
**Fix:** Measure every DEX in the marker:
```ts
actual: { reconnectLoopsForOneClose: Object.fromEntries(sc.ctx.chain.dexes.map((d) => [d.name, reconnects(d.name, from)])) },
correct: { reconnectLoopsForOneClose: { 'uniswap-v2': 1, 'sushiswap-v2': 1, 'uniswap-v3': 1 } },
observed: { reconnectLoopsForOneClose: { 'uniswap-v2': 2, 'sushiswap-v2': 2, 'uniswap-v3': 2 } },
```
Or use one claim per handler (`v2-...`, `v3-...`).

### CR-05: AUD-EXIT-007 and AUD-EXIT-008 exercise only the dashboard force-sell caller; a fix there flips the marker while the other callers still strand the position

**Area:** Triage tests: buy and exit (slice C, CR-C02)

**Orchestrator check:** Confirmed against the source at HEAD fe251b7: every claim in both files is driven through `POST /api/controls/force-sell/:id` (AUD-EXIT-007.test.ts:51, :85; AUD-EXIT-008.test.ts:84). The register names more callers: AUD-EXIT-007 lists src/anti-rug/exitTrigger.ts and the emergency-sell route, and AUD-EXIT-008's title covers "force-sell and emergency-sell".

**File:** `test/realpath/triage/AUD-EXIT-007.test.ts:51,62-69,85,93-100`; `test/realpath/triage/AUD-EXIT-008.test.ts:84-94`
**Issue (EXIT-007):** The header names "having the caller re-arm when the sell returns false" as a fix that reads "looks fixed". That fix shape is per caller, and three callers clear the timers before `executeFullSell`:
- `src/api/routes/controls.ts:92` (force-sell)
- `src/api/routes/controls.ts:167` (emergency-sell)
- `src/anti-rug/exitTrigger.ts:240` (anti-rug)

The no-fallback return (`src/exitEngine.ts:1024-1038`) does not depend on `reason`. A Phase 24 fix that re-arms only in the force-sell route turns both EXIT-007 claims "looks fixed". The anti-rug exit, which is the case that matters most for capital (a rug on a V3 position whose private sell misses), and emergency-sell still leave the held position with no poll timer.

**Issue (EXIT-008):** The finding is "Dashboard force-sell and emergency-sell are sent as a routine exit" (triage report AUD-EXIT-008). Both routes pass `'urgency-market-sell'` (`controls.ts:96-111`, `:169-174`), but the test presses only force-sell. A fix that gives force-sell an operator reason that bypasses the pause, but leaves emergency-sell alone, flips the marker while emergency-sell still answers 409 on a paused position.
**Fix:**
- EXIT-007: add a claim that drives the real anti-rug exit (`triggerAntiRugExit` through a `pullLiquidity`-style rug, as AUD-EXIT-014 does) into the same V3 not-landed return and asserts `hasExitMonitorTimer`. Also add a claim through POST `/api/controls/emergency-sell`. Or state in the marker's `correct` that only a fix inside executeFullSell (keepMonitoringFailedHeld on these returns) is accepted, and assert a fix-independent fact (an `exit_failed_held` stamp) in `actual`.
- EXIT-008: add claim `operator-emergency-sell-refused-while-routine-paused` through POST `/api/controls/emergency-sell` with the same preconditions.

### CR-06: AUD-BUY-010 "max-open-positions-overspent" reads "looks fixed" when only the per-chain cooldown is reserved

**Area:** Triage tests: buy and exit (slice C, CR-C03)

**Orchestrator check:** Confirmed against the source at HEAD fe251b7: the scenario sets only `MAX_OPEN_POSITIONS: '1'` (AUD-BUY-010.test.ts:71), so the default 30 s per-chain cooldown stays on.

**File:** `test/realpath/triage/AUD-BUY-010.test.ts:71,89-93,98,105-112` (`:118` checks the refusal reason only after the marker)
**Issue:** The scenario keeps the default `SNIPE_COOLDOWN_MS=30000` (`test/.env.test:71`) and puts both tokens on the same chain. `canSnipe` checks the global open-position count (`src/riskManager.ts:109-120`) and then a per-chain cooldown (`:122-135`). The marker measures only `buysLanded`.

Failure scenario: Phase 24 stamps the cooldown when a handler passes `canSnipe` (a natural "reserve synchronously" first step) but adds no position or exposure reservation. B is then refused with reason `cooldown`, the wait at `:89-92` is satisfied by "Risk check failed, skipping snipe", `handlersBuying` is 1, one buy lands, and `knownBug` throws "looks fixed". The `:118` check that would show the refusal came from cooldown never runs. MAX_OPEN_POSITIONS is still overshot whenever two chains snipe at once (the cooldown is per chain, the position limit is global) or when the cooldown is set to 0.
**Fix:** Isolate the limit under test and measure the refusal reason:
```ts
overrides: { MAX_OPEN_POSITIONS: '1', SNIPE_COOLDOWN_MS: '0' },
// ...
const bRefusal = recordedLogs().find((l) => l.msg === 'Risk check failed, skipping snipe' && String(l.obj?.token).toLowerCase() === b.token.toLowerCase())?.obj?.reason ?? null;
actual: { buysLanded: landed.length, bRefusedBy: bRefusal },
correct: { buysLanded: 1, bRefusedBy: 'max_positions' },
observed: { buysLanded: 2, bRefusedBy: null },
```

### CR-07: One-shot faults let a retry-once "fix" read "looks fixed" while the fail-open or give-up path is still in the code

**Area:** Triage tests: buy and exit (slice C, CR-C04)

**Orchestrator check:** Confirmed against the source at HEAD fe251b7: `failNext` defaults to one failure (`opts.times ?? 1`, test/realpath/harness/chain.ts:822), and none of the cited injections passes `times`.

**File:**
- `test/realpath/triage/AUD-BUY-003.test.ts:82-87` (V2) and `:126-131` (V3)
- `test/realpath/triage/AUD-BUY-002.test.ts:120`
- `test/realpath/triage/AUD-EXIT-002.test.ts:51-56`

**Issue:** Each proof injects `node.failNext(...)` without `times`, so exactly one matching call fails (`test/realpath/harness/chain.ts:822`, `opts.times ?? 1`).

Failure scenario (AUD-BUY-003): Phase 24 wraps `dexRouter.getAmountsOut` (`src/bot.ts:1050-1058`) or the V3 quoter call in a single retry and leaves the `catch { minOut stays 0n }` default in place. The retry is answered, the swap goes out with a positive bound, and both claims throw "looks fixed". The capital bug (a quote that fails twice still sends an unbounded swap) ships.

The same retry-once shape flips:
- AUD-BUY-002 claim 1, while two failed balanceOf reads still mark a landed buy `failed`.
- AUD-EXIT-002, while two failed first quotes still leave the position unmonitored at `src/exitEngine.ts:1873-1876`.

**Fix:** Make the read fail persistently for the decision window, so only a fix that changes the failure path flips the marker:
```ts
const quote = node.failNext('eth_call', { selector: 'getAmountsOut(uint256,address[])', to: dex.routerAddress, after: () => msgLogged('All safety checks passed, buying'), times: 1_000, error: { code: -32000, message: 'header not found' } });
```
Set `times: 1_000` the same way in the BUY-002 and EXIT-002 faults. EXIT-002's `expectedPlain` already says retrying is acceptable, so a retry that eventually succeeds should go through a separate "transient" claim, not the base claim.

### CR-08: Signing census never judges "delegations": `sendTransaction` on a non-Signer type passes CI unlocked

**Area:** CI gates and CI wiring (slice D, CR-D01)

**Orchestrator check:** Reproduced on the real gate. In a throwaway worktree at HEAD fe251b7, under Node 22.16.0, with `scripts/zz-probe-d01.ts` = `export async function probeD01(runner: ContractRunner, tx: TransactionRequest) { return runner.sendTransaction!(tx); }`, `check-signing-census.ts` printed "23 transaction-signing sites ... files src 71, scripts 29; 0 problem(s)" and exited 0. The control file, a direct unlocked `await token.approve(...)` on a Wallet-backed Contract, failed with `surplus-unlocked` and exit 1. The code path: classify() returns a `delegation` for `sendTransaction` on a non-Signer receiver (check-signing-census.ts:972-976), and `evaluateGate` (:1376) never reads delegations.

**File:** `scripts/check-signing-census.ts:972-976` (classification), `:840` (stored), `:1376-1461` (`evaluateGate` never reads `result.delegations`)
**Issue:** `classify` counts `sendTransaction`/`signTransaction` only when the receiver's type is structurally a Signer (`isSigner`, `:345-347`, which needs `signTransaction` + `sendTransaction` + `getAddress` + `signMessage`). Any other receiver type becomes `{ delegation }`, a note that says "a wrapper whose implementations hold the counted signing calls". `run()` pushes it to `delegations` (`:840`). Nothing in `evaluateGate`, `gateMain` or the floor check ever reads delegations. A grep for `delegations` finds only `:198, :828, :840, :852, :1148`, which are declaration, collection and the `--print` output. The assumption that "the implementations hold the counted calls" is never checked. It holds for `MevStrategy` (the one delegation today, `src/utils/txManager.ts:114`). It does not hold when the implementation is ethers' own `Wallet`, which lives in `node_modules` and is never a census site.

Concrete input that exits 0. A new `scripts/rescue.ts`, or a new path in `src/`:
```ts
import { Wallet, ContractRunner } from 'ethers';
async function main(): Promise<void> {
    const wallet = new Wallet(process.env.KEY!, provider);
    const runner: ContractRunner = wallet;           // ethers' own interface type
    await runner.sendTransaction!({ to, value });    // -> delegation, not a site
}
void main();
```
`ContractRunner` has only `provider`, `estimateGas?`, `call?`, `resolveName?`, `sendTransaction?` (`node_modules/ethers/lib.commonjs/providers/contracts.d.ts:18-34`), so `isSigner` is false. The same happens for `(s: Pick<Wallet, 'sendTransaction'>) => s.sendTransaction(tx)` and for any local `interface TxSender { sendTransaction(...) }`. This also contradicts the header's claim that aliases "are matched by type, not by name". No site is counted, no `surplus-unlocked` fires, the count is unchanged, so `below-floor` stays quiet, and the gate prints PASS. The self-test has no delegation case, so the analysis suite stays green.
**Fix:** Treat a delegation as a counted site unless every in-program implementation of the receiver type holds counted sites. The simplest safe form is to emit it as `tx-signing` with `type_unresolved: true`, so its lock reads `unknown` and `unknown-lock` fails the gate. Then allow-list the one known wrapper (the `MevStrategy` interface, whose implementations are counted) by receiver type in the exceptions file:
```ts
if (SIGN_TX.includes(name)) {
    if (this.isSigner(rt)) return this.mk(call, `signer.${name}`, 'tx-signing', this.typeText(rt));
    // A non-Signer receiver may be ethers' own ContractRunner or a narrow interface over a Wallet.
    return this.mk(call, `delegated.${name}`, 'tx-signing', this.typeText(rt), { type_unresolved: true });
}
```
Add RED analysis cases for `ContractRunner`, `Pick<Wallet,'sendTransaction'>` and a local interface. Also add a gate case where the delegation sits outside any lock and the gate must fail.

### CR-09: Contract methods called through a value, `getFunction(...)` value or narrow-interface cast escape the census

**Area:** CI gates and CI wiring (slice D, CR-D02)

**Orchestrator check:** Reproduced on the real gate, in the same setup as the CR-08 check. `const approve = token.approve; await approve(...)` on a Wallet-backed Contract printed "23 transaction-signing sites ... scripts 29; 0 problem(s)" and exited 0. The same call made directly fails the gate (the control above).

**File:** `scripts/check-signing-census.ts:912-918`, `:940-955`, `:986`
**Issue:** The census only recognizes a contract signing call by its syntax: `c.m(...)`, `c['m'](...)`, `c.m.send(...)`, `c.getFunction('m')(...)`, each on a receiver whose type `isContract`. In ethers v6 a contract method is a standalone closure over its contract (`node_modules/ethers/lib.commonjs/contract/contract.js:190`, `buildWrappedMethod(contract, key)`, which calls `contract.runner.sendTransaction`). So the forms below send a real, nonce-consuming transaction, and the census classifies each one as `null`:
```ts
const token = new Contract(addr, ERC20_ABI, wallet);
const approve = token.approve;           // value, not a call: never visited as a site
await approve(router, MaxUint256);       // Identifier callee: :912-913 returns null (not rawSendBundle/sendRawBundle)

const m = token.approve;
await m.send(router, amt);               // :940-954: inner is an Identifier, cRecv undefined -> return null

const f = token.getFunction('approve');  // :986 isOwnContractMember(getFunction) -> null
await f(router, amt);                    // Identifier callee -> null

const r = new Contract(addr, ROUTER_ABI, wallet) as unknown as IRouter;  // narrow typed interface
await r.swapExactETHForTokens(...);      // :986 isContract(IRouter) false -> null
```
The same applies to passing `token.approve` as a callback (`await withRetry(token.approve, …)`). An unlocked signing site added in any of these forms passes CI (no site, unchanged count, floor quiet). None exists today (`grep getFunction\(|\.bind\(|\.call\(` over `src/` and `scripts/`, and no `as unknown as` contract casts). The analysis fixtures (`:2004-2224`) cover only the direct forms.
**Fix:** Classify on the callee's type, not its syntax. When a call's callee type `isMethod(...)` (the `BaseContractMethod`/`TypedContractMethod` shape: `staticCall`, `send`, `estimateGas`, `populateTransaction`) and no existing branch matched, trace the callee expression back to its `PropertyAccess` on a contract (through variable initializers, as `originsOf` does). If the trace fails, emit `tx-signing` with `type_unresolved: true` so the lock reads `unknown`. For a receiver that is neither a Contract nor a Signer but whose method returns `ContractTransactionResponse`/`TransactionResponse`, emit the same unresolved site. Add RED fixtures for each form above.

### CR-10: The seal verifier trusts a mutable, always-exempt seal record, so a one-line edit turns tampering into SEAL VALID

**Area:** Recording pipeline, secret scan, seal verifier (slice E, CR-E01)

**Orchestrator check:** Confirmed against the source at HEAD fe251b7: `verifySeal` reads `sealed_sha`, `phase_start_sha` and `exempt_paths` from the record file on disk (seal-verify.ts:676-681), requires that record to list itself as exempt (:702), and judges later changes against those patterns (:789-793). Nothing compares the record with its own copy at `sealed_sha`.

**File:** `.planning/audit/tools/seal-verify.ts:676-681, 702, 708-713, 789-793`
**Issue:** `verifySeal` takes `sealed_sha`, `exempt_paths`, `covers`, `scan.*` and `render_sha256` from the seal record as it sits in the **working tree** (`fs.readFileSync(sealPath)`, line 678). Line 702 requires the record (and its scan record) to be on its own `exempt_paths`, so a commit after the seal may always change the record. Nothing compares the record at HEAD with the record as first committed. The words "sealed_sha", "exempt_paths" and "render_sha256" never appear in a git history query; the only history walk is `changedPaths`.

Concrete failure, traced from code (not executed; I was limited to read-only runs):
1. Commit X after `f51a6cc` edits `.planning/audit/findings/AUD-BUY-001.json`, say to change its severity. In the same commit it adds that path (or the pattern `.planning/audit/findings/*`) to `exempt_paths` in `SEAL-23.json`.
2. `seal-verify.ts --seal .planning/audit/SEAL-23.json` then runs as follows:
   - `changedPaths(912b915, HEAD)` under covers gives `[SEAL-23.json, phase-scan-23.json, findings/AUD-BUY-001.json]`.
   - All three pass `isExempt`.
   - `render_sha256` is checked at `sealed_sha`, so it is unchanged.
   - The scan digest is unchanged.
   - Output: `SEAL VALID`, exit 0. `--scan` adds nothing because there is no secret.

The same works by moving `sealed_sha` forward (the successor fields `changed_since_previous` and the scan record can be recomputed, and the scan record is self-attested). For the Phase 22 record it is even easier: there is no successor cross-check of the scan file at all. An uncommitted edit to the record also flips the verdict, because the record is read from disk while the changes are read from HEAD.

The repo history shows the tool cannot tell a legitimate change from a tamper:
- `d9f2533` widened `exempt_paths` after the seal ("exempt the validation report from the seal").
- `28f8f5f` re-pointed `sealed_sha`.

The tool exists to detect tampering after the seal (T-22-97). This is a fail-open on exactly that threat.

**Fix:** Pin the anchor to git, not to the editable file:
```ts
// The commit that first added the record after sealed_sha is the anchor.
const intro = gitText(repo, ['log', '--reverse', '--diff-filter=A', '--format=%H', `${sealed}..HEAD`, '--', sealRel]).split('\n')[0].trim();
if (!SHA40.test(intro)) return fail([`${sealRel} was not added after sealed_sha`]);
const anchor = JSON.parse(gitText(repo, ['cat-file', '-p', `${intro}:${sealRel}`]));
const atHead = JSON.parse(gitText(repo, ['cat-file', '-p', `HEAD:${sealRel}`]));
for (const k of ['sealed_sha', 'phase_start_sha', 'exempt_paths', 'covers', 'scan', 'render_sha256', 'final_check', ...SUCCESSOR_FIELDS]) {
    if (JSON.stringify(anchor[k]) !== JSON.stringify(atHead[k])) reasons.push(`${sealRel} ${k} changed after the record was committed at ${intro.slice(0, 8)}; a re-seal needs a new record`);
}
// Judge with `anchor`, never the working-tree file; refuse if the working-tree copy differs from HEAD.
```
A legitimate exemption change then goes through a new successor record, which is reviewable, instead of a silent edit.

## Warnings

### WR-01: Every mined transaction succeeds. Receipt status, estimateGas and eth_callBundle ignore the scenario's own revert rules

**Area:** Simulated chain and real-path harness (slice A, WR-A01)

**File:** `test/realpath/harness/chain.ts:1145`, `chain.ts:1490-1491`, `chain.ts:1798-1835`; `test/realpath/harness/world.ts:845-848`, `world.ts:883-891`, `world.ts:923-947`
**Issue:**
- `mine()` writes every receipt with `status: 1` (chain.ts:1145). The `Receipt` type allows `0`, but nothing in the harness can produce it. Every mined transaction counts as fully applied (balances debited, setReceiptLogs fired).
- `eth_estimateGas` returns a constant (`#estimateGas ?? DEFAULT_ESTIMATE`, chain.ts:1491).
- `#callBundle` always returns a success shape with no `error`/`revert` entry (chain.ts:1803-1834).
- The scenario's router reads do encode real revert conditions, but only `eth_call` consults them: `UniswapV2Router: EXPIRED` and `INSUFFICIENT_OUTPUT_AMOUNT` (world.ts:888-889), and V3 `Transaction too old` / `Too little received` (world.ts:931, 935).
- `boughtBy` (world.ts:845-848) credits tokens for every mined buy to the router, whatever the transaction's deadline or minimum output.

Failure scenarios:
- **Late buy.** The V2 snipe deadline is now+60 s (src/bot.ts:1045). A test steps more than 60 s of fake time before `mine({ include: [buy] })`. A real chain reverts it (status 0, gas spent, no tokens). The harness mines it with status 1, `balanceOf` reports tokens, and the bot arms a position it does not hold.
- **Simulation guard unreachable.** A buy whose minimum is above the pool output passes the bot's `flashbotsProvider.simulate` gate (src/utils/mevStrategies/flashbots.ts:235-242, D-SIMULATE-BEFORE-SUBMIT), because `#callBundle` never reports `firstRevert`. The gate can never be exercised without a hand-written setRelay override.
- **Sell without allowance.** The same applies to a sell sent without enough allowance. The AUD-EXIT-001 sell-path model counts it as sold, and its receipt carries the WETH log.

A Phase 24 fix whose correctness depends on a revert (a tight output floor, a refusal to send a doomed bundle) cannot be shown RED or GREEN on the default node.
**Fix:**
- Give the node one revert source that all four answers share. For example, `setInclusionRule(to, selector, (tx, block) => ReadResult)`, or reuse the read table: when a mined transaction's target and selector have a registered read, evaluate it with `{ args, value: tx.value, from: tx.from }`.
- On a revert, store `status: 0`, apply gas only (no value transfer, no receipt logs), and keep the nonce consumed.
- Answer `eth_estimateGas` from the same evaluation (`{ code: 3, message: 'execution reverted', data }`), and give `#callBundle` a per-transaction `error: 'execution reverted', revert: data` entry.
- Make `boughtBy` count only `status === 1` receipts.

### WR-02: The default scenario balance re-prices the bot's buys at current reserves and never subtracts a sell

**Area:** Simulated chain and real-path harness (slice A, WR-A02)

**File:** `test/realpath/harness/world.ts:845-853`
**Issue:**
- `balanceOf(wallet)` is computed on every read as `sum(quoteOut(s.tx.value, weth, token))` over mined buys, using the live `reserves` object. `reserves` is exposed as a mutable field on `Scenario` (world.ts:611), and fixtures do mutate it: AUD-EXIT-014-rug `pullLiquidity`, AUD-EXIT-001-sell-path `foreignTrade`, AUD-EXIT-003 `foreignBuy`.
- So the wallet's token balance moves whenever the price moves.
- A mined sell is never subtracted, because a sell carries value 0 and is ignored.

Concrete case: AUD-TX-028 drives `pullLiquidity(sc, { removeBps: 9_500n })` on the default read, with no installSellPath. Both reserves shrink to 5 percent, so `v2AmountOut(v, 0.05W, 0.05T)` is less than the bought amount. The anti-rug emergency path's `balanceOf` read (src/anti-rug/detector.ts:1744) then sees fewer tokens than the bot holds.

More generally, any test that lands a sell without installSellPath leaves `balanceOf` above dust. The exit engine's genuine-close vs still-held decision (src/exitEngine.ts:583-610) then reads "still held" after a successful sell.

The AUD-EXIT-001 fixture documents this trap (its lines 9-11) and re-serves the read. The harness default still hands the next test a balance no token could report.
**Fix:**
- Freeze each buy's output at mine time instead of at read time. For example, record `{hash, out}` from a `setReceiptLogs`-style hook inside `mine()`, or snapshot the reserves the first time the read sees a newly mined buy.
- Subtract the `amountIn` of mined sells through the swap router.
- Alternatively, make the default read throw a named harness error once a sell from the wallet is mined, so a test must install a sell model explicitly.

### WR-03: FakeWebSocket differs from ws@8.17.1 on every path where the socket is not OPEN

**Area:** Simulated chain and real-path harness (slice A, WR-A03)

**File:** `test/realpath/harness/chain.ts:404-420` (send), `chain.ts:428-434` (ping), `chain.ts:436-449` (terminate, close); header claim at `chain.ts:346`
**Issue:** These are checked against `node_modules/ethers/node_modules/ws/lib/websocket.js`, the copy production loads.
- **send on CLOSING or CLOSED.** Real `send()` throws only in CONNECTING (lines 447-450). On CLOSING/CLOSED it calls `sendAfterClose`, which drops the data silently and reports to a callback only on `process.nextTick` (lines 1113-1132). The fake throws synchronously when there is no callback, and calls the callback synchronously when there is one (chain.ts:405-412).
- **close or terminate during CONNECTING.** Real `close()`/`terminate()` call `abortHandshake`, which emits `'error'` and then `'close'` (lines 290-293, 486-489, 1033-1036). With no `'error'` listener, that `'error'` is the uncaught exception behind AUD-ANTIRUG-002. The fake emits only `'close'` 1006 and never `'error'` on any path.
- **ping during CONNECTING.** Real `ping()` throws (lines 359-362). The fake returns silently (chain.ts:429).
- **send signature.** Real `send(data, options, cb)`. The fake treats the second argument as the callback, so a `send(text, {}, cb)` call would throw `cb is not a function`.
- **Event timing.** The header says events are delivered on the microtask queue. In fact `#deliver` (subscription pushes from `mine()`/`emitLogs()`) and `serverClose` (`dropSocket()`) run synchronously inside the test's call.

Effect on verdicts: ethers' `WebSocketProvider._write` calls `websocket.send(message)` with no readyState guard. A request, `eth_subscribe` or `eth_unsubscribe` that the bot sends on a provider whose socket was dropped but not destroyed behaves differently in the two worlds:
- In production it hangs forever, because the frame is dropped and no response ever comes.
- In the harness it rejects at once with "WebSocket is not open: readyState 3". If the promise is not caught, the run fails with an unhandled rejection.

That provider state is reachable today. AUD-ANTIRUG-001 documents that loop-built providers are never cached, so after a second drop `removeWsProvider` destroys nothing. The next `registerAntiRugPosition` then calls `off()`/`on()` (src/anti-rug/detector.ts:647, 658) on a live provider with a dead socket. A hang-class finding on that path would read as a handled error in-process.

Separately, an in-process scenario can never show a crash from a socket closed during its handshake (heartbeat `terminate()` or `ping()`, src/anti-rug/detector.ts:795, 810).
**Fix:** Mirror ws 8.17.1 exactly:
- `send`: throw only in CONNECTING. In CLOSING/CLOSED, drop the frame and `process.nextTick(cb, err)` if a callback was given. Accept `(data, options?, cb?)`.
- `ping`: throw in CONNECTING.
- `close`/`terminate` in CONNECTING: set CLOSING, then on `process.nextTick` emit `'error'` ("WebSocket was closed before the connection was established") followed by `'close'` 1006.
- Add an `openDelay`/`hangOpen` option so a test can keep a socket in CONNECTING.
- Correct the header comment, or deliver `#deliver`/`serverClose` through `queueMicrotask` as documented.

### WR-04: An exception in an axios route handler is not a stray and reaches production as a network error

**Area:** Simulated chain and real-path harness (slice A, WR-A04)

**File:** `test/realpath/harness/world.ts:395-412` (handler awaited at 407 with no try/catch)
**Issue:** The JSON-RPC path guarantees that "a harness bug must not look like a node answer" (chain.ts:1429-1435): it records a stray and answers -32603. `routeAxios` has no such guard.
- If a route handler throws, the axios promise rejects with a plain `Error`. It has no `isAxiosError` and no `response`, and nothing is recorded on `strays`.
- Production code wraps every axios call in a catch: src/utils/mevStrategies/bloxroute.ts:66, 179 and src/utils/safetyProviders/goplus.ts:45. That catch takes the relay-failure or "check failed, skip" branch, and the test carries on down that branch with nothing in afterEach to flag it.

Concrete case: the scenario's own bloXroute route calls `node.acceptRelayTransaction(raw)` (world.ts:1011), whose `Transaction.from(raw)` throws on a malformed or unsigned transaction (chain.ts:879-880). The harness throw turns into "bloXroute relay failed" in src. A knownBug whose observed value is "no buy landed" or "fell back to public" can then pass on a harness exception. The same holds for any triage fixture's `routeHttp` handler.
**Fix:**
```ts
let reply: HttpReply;
try {
    reply = await route.handler(req);
} catch (e) {
    const detail = `harness error answering axios ${method.toUpperCase()} ${url}: ${e instanceof Error ? e.message : String(e)}`;
    (st.node ? st.node.strays : st.orphanStrays).push({ seq: nextSeq(), kind: 'url', url, detail });
    throw axiosError('realpath harness: internal error', config, { status: 500, data: { error: 'internal error' }, headers: {} }, 'ERR_REALPATH_HARNESS');
}
```

### WR-05: The DB capture fails any write inside `db.transaction`, so a correct atomic-write fix fails its tests instead of reading "looks fixed"

**Area:** Simulated chain and real-path harness (slice A, WR-A05)

**File:** `test/realpath/harness/capture.ts:171-173` (violation), `capture.ts:204-205`; afterEach at `test/realpath/harness/setup.ts:231-235`
**Issue:**
- Every row captured while `db.inTransaction` is true is pushed as a `db-in-transaction` violation, and `assertNoViolations()` fails the test in afterEach. This is RESEARCH Open Question 5: rollback is not handled.
- src/ writes inside a transaction nowhere on the driven paths today, so every proof is green.

The trap is in the fixes. Several triage files name a fix that makes writes durable or atomic:
- AUD-DB-004: "a fix that writes a buy intent row before the first submission ... into trades or a new table".
- AUD-BUY-004: "claim the token synchronously ... re-check inside the lock".
- AUD-BUY-010: "reserve the risk budget synchronously".

Doing those with `db.transaction(...)`, for example an intent row plus a reservation row committed together, is the idiomatic better-sqlite3 approach. Every scenario that drives that path would then fail with "an insert on table trades was captured inside a transaction". A correct fix would never get to read "looks fixed" (D-08): the harness blocks it instead of the test judging it.
**Fix:** Handle commit and rollback instead of refusing:
- While `db.inTransaction` is true, buffer captured entries per connection.
- Wrap `db.transaction` on the graph connection in installDbCapture so the buffer is flushed to the timeline when the wrapped function returns and dropped when it throws.
- For raw `BEGIN`/`COMMIT`/`ROLLBACK` through `db.exec`/`prepare`, flush on the next capture or in afterEach after checking that the row exists.
- Keep a violation only for a transaction still open at afterEach.

### WR-06: restartGraph is not a process death. The old graph's error paths run with the database still open and log into the same scenario lists

**Area:** Simulated chain and real-path harness (slice A, WR-A06)

**File:** `test/realpath/harness/world.ts:642-673` (stopGraphParts), `world.ts:1107-1168` (restartGraph)
**Issue:**
- Step 1 of `stopGraphParts` releases every held call with an error and drains 50 microtasks (world.ts:647-650) so that "the answer reaches its caller".
- Step "destroy providers" then awaits `destroy()`, which rejects ethers' queued payloads. This yields again.
- The database is closed only in step 4 (world.ts:669-672).

So the old graph's catch blocks run, and can write, against the open file database before the restart. For dispose that ordering is right. For restartGraph, which its own doc says stands in for "a process restart" (world.ts:1096-1105), it is not: a killed process runs no catch path.

Concrete scenario:
1. A restart test parks the bot's sell `eth_getTransactionReceipt` (or a bundle relay call) and then calls `restartGraph`.
2. The teardown error resolves the old graph's await, and its exitEngine catch runs `updateTradeStatus.run('failed', ...)` or `markExitFailedHeld` on the still-open connection.
3. The write lands in the temp file and on the shared timeline, and the old graph's alert lands on `recordedAlerts()`.
4. The new graph then boots on a database state, and with alerts, that a real crash would never produce. Resume-path claims can read RED or "looks fixed" for that reason.

Current users (AUD-ANTIRUG-018, ordering/boot, ordering/identity) restart at idle points, so no verdict is affected today.
**Fix:**
- In restartGraph, fence the old graph before releasing anything. Close its database first: `closeGraphDb(built.graph)`, so old writes throw into their own catch.
- Mark the old graph's logger and notifier sink as dead. For example, add an epoch on `harnessState()` that the setup.ts factories stamp on each entry, and drop or flag entries from a dead epoch.
- Then release holds and destroy providers.
- Keep the current order for dispose.

### WR-07: The AUD-ANTIRUG-002 boot claim reads "looks fixed" for a fix that never reconnects at boot

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, WR-B01)

**File:** `test/realpath/triage/fixtures/wsReconnectRefused.ts:131-132`; `test/realpath/triage/AUD-ANTIRUG-002.test.ts:88, 130-141`
**Issue:** For `site === 'boot'`, the work counts as settled when `state === '3'`, meaning the bot's socket is cleanly CLOSED, even if nothing ever reconnects. The comment says "nothing at boot re-attempts a WebSocket". The claim's `expectedPlain` (:88) says "the bot stays up and keeps retrying until the endpoint is back". The recommendation says "treat a failed connect as a failed attempt that stays in the backoff loop".
**Scenario:** A fix adds `websocket.on('error', ...)` only in `getWsProvider` (`src/utils/provider.ts:37`). The refused boot connect then emits error, then close, then readyState 3. The process survives, and the claim reads `CORRECT`, so "looks fixed". In production the chain context holds that dead provider. `startDexListener` and `startChainAntiRugListener` attach their `close` handlers after `close` already fired, so they never run. The chain stays without a WebSocket for the whole session (no PairCreated, no anti-rug log delivery) while nothing reports it.
**Fix:** For boot, require what the reconnect sites require: once the port reopens (4 s), `chain.wsConnectedAfter(markAt)` must hold, so the bot reconnected within the 12 s window. Alternatively, add a second field to `actual`, for example `connectedAfterReopen`, so that "survived but dead" reads "the failure changed", not fixed.

### WR-08: AUD-ANTIRUG-018 reads "looks fixed" for a fix that jumps the cursor to the head and never scans the downtime gap

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, WR-B02)

**File:** `test/realpath/triage/AUD-ANTIRUG-018.test.ts:107-133`
**Issue:** The rug is mined one minute after the restart (:118-122), after the 30-block gap. `correct` needs only `rugEvaluated`, `cursorReachedRugBlock` and `healthShown`. A poller that, on a range error (or at start), sets `lastBlock` to the head reaches the later pull and moves the cursor, so it reads "looks fixed". It never scans the 30 missed blocks. `expectedPlain` says "catches up the missed blocks in provider-sized requests", and the recommendation says "a long gap is replayed in provider-sized windows". On an HTTP-only chain no backfill runs at resume (backfill is wired only on the WebSocket path, `src/anti-rug/detector.ts:708-719`), so a rug mined during the downtime would be lost for good.
**Fix:** Also mine one rug-shaped LP log for the pair inside the downtime gap (during the `for (let i = 0; i < 30; i++)` loop), and add `gapLogEvaluated` to `correct`. Or assert that the `eth_getLogs` queries since the restart cover every block from `storedBeforeRestart + 1` to `pull.block` in windows of 10 blocks or fewer.

### WR-09: AUD-ANTIRUG-003 and AUD-ANTIRUG-004 wait for one exit-fired broadcast per dispatch log, so a dedupe-shaped fix stalls them

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, WR-B03)

**File:** `test/realpath/triage/AUD-ANTIRUG-003.test.ts:82-83`; `test/realpath/triage/AUD-ANTIRUG-004.test.ts:73`
**Issue:** Both waits require `exitFiredSince(...).length === opEntries('antirug.exit.dispatch', ...).length`. `antirug.exit.dispatch` is logged before `executeFullSell` (`src/anti-rug/exitTrigger.ts:239-249`), and the `exit-fired` broadcast comes after it (`:300-307`). The AUD-ANTIRUG-003 recommendation is "Keep one in-flight anti-rug dispatch per position ... count the breaker per position". If it is placed after the dispatch log (for example, return early for an in-flight duplicate with no broadcast and no count), the counts never match. `driveChain` then throws after 600 s virtual (003), or `stepUntilTrue` throws after 20 s (004), instead of the claim reading "looks fixed". In 004 this is a cross-finding block: the AUD-ANTIRUG-003 fix would break AUD-ANTIRUG-004's setup.
**Fix:** Wait on the outcome, not the count match. In 003 use `buyRow(sc)!.status === 'sold'` plus the settled breaker state. In 004 use `exitFiredSince(...).length >= 1 && no exit in flight` (for example, `tryAcquireSellLock` succeeds and is released). Or wait for the first dispatch's `exit-fired` only.

### WR-10: AUD-SCRIPTS-002 builds `correct` from `actual`, so a signing script that drops out of detection can read "looks fixed"

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, WR-B04)

**File:** `test/realpath/triage/AUD-SCRIPTS-002.test.ts:95-99`; `test/realpath/triage/fixtures/scriptsStatic.ts:472-485, 699-713`
**Issue:** `correct: actual.map((r) => ({ script: r.script, lock: 'holds-lock', pauseRead: true }))`. Which scripts must be fixed is not pinned. `scriptRows` skips a script with zero detected signing points (:703). The sanity floors (:91-92) only show that some file was walked and that src has sites; they do not show each live script still has its points. A script whose signing call the analysis stops resolving drops out of both `actual` and `correct`. That happens if `calleeOf` cannot resolve the call, for example `executeDeliberateBuy` reached through an any-typed `require('../src/bot')` or a wrapper the type checker cannot resolve.
**Scenario:** Phase 29 adds the lock to `recover-sell-ladys`, and `deliberate-buy` is refactored to an any-typed import. Then `actual` = `correct` = `[{recover-sell-ladys, holds-lock, true}]`, so the claim reads "looks fixed" while `deliberate-buy` still signs with no lock and no pause read.
**Fix:** Pin `correct` to the expected script set: the live names from `LIVE_OBSERVED`, plus the legacy names that were walked, each with `{ lock: 'holds-lock', pauseRead: true }`. Assert before the marker that each walked live script has at least one signing point, so a lost detection fails loudly (:108-109 assert this, but only after the marker).

### WR-11: AUD-BUY-002 claim `failed-row-not-resumed-after-restart` has bug-encoding plain expects before its marker

**Area:** Triage tests: buy and exit (slice C, WR-C01)

**File:** `test/realpath/triage/AUD-BUY-002.test.ts:167-169` (marker at `:171-178`)
**Issue:** `expect(opLogged('exit.monitor.resumed', fromLog)).toBe(false)` and `expect(opLogged('exit.monitor.started', fromLog)).toBe(false)` describe the bug itself, and they run before the claim-2 marker. A Phase 24 fix that resumes failed-but-held buys (for example, `getResumeExitMonitorTrades` picking up `failed` buys whose balance is not zero) logs `exit.monitor.resumed`. The test then fails with "expected true to be false" instead of the D-08 "looks fixed" signal, so the claim-2 fix cannot be proven by this test.
**Fix:** Move both expects after the `knownBug` call. Optionally fold `exit.monitor.resumed` into `actual` (for example `resumedAfterRestart: resumedAt.length > 0 || opLogged('exit.monitor.resumed', fromLog)`).

### WR-12: AUD-BUY-004's completion predicate times out for any fix that refuses the second handler after "New pair detected"

**Area:** Triage tests: buy and exit (slice C, WR-C02)

**File:** `test/realpath/triage/AUD-BUY-004.test.ts:88-95`
**Issue:** `passedCheck` counts "New pair detected" (logged at `src/bot.ts:889`, after `isTokenSniped`). `done` then requires `MEV bundle submitted + buy.snipe.fail-clean >= passedCheck`. Three fixes refuse the second handler after `:889` and log neither line:
- a re-check of the token inside the wallet lock (named in the finding card, BUY-03)
- a cooldown or risk reservation taken at `canSnipe`
- a claim set placed after the log

For each, `driveChain` throws "both handlers finishing their buys did not happen" after 600 s of virtual time. A correct fix reads as a harness timeout, not "looks fixed".
**Fix:** Count a refusal as finishing. For example, `done = secondSettled && (submitted + failClean) >= 1`, then measure `buysLanded` as now. `secondSettled` already proves the second handler returned.

### WR-13: "Any floor above zero" accepts a dust floor as fixed (AUD-BUY-003, AUD-EXIT-001)

**Area:** Triage tests: buy and exit (slice C, WR-C03)

**File:** `test/realpath/triage/AUD-BUY-003.test.ts:109,155`; `test/realpath/triage/AUD-EXIT-001.test.ts:93,113,132,150`
**Issue:** The markers flip on `amountOutMin > 0n`. A wrong fix flips them while the swap still accepts almost any output, for example:
- `minOut = 1n`
- a floor computed from the wrong decimals
- a floor from the stale buy-time quote

The harness knows the exact reserves (`v2AmountOut` / `v3AmountOut`), so the expected floor can be computed.
**Fix:** Measure the floor against the router's own answer at the reserves of the moment, for example `floorAtLeast95PctOfQuote: minOut * 100n >= v2AmountOut(amountIn, rIn, rOut) * 95n`, keeping "no swap sent" as the other correct value for BUY-003.

### WR-14: AUD-BUY-028 reads "looks fixed" when any gate refuses, not just the lock gate

**Area:** Triage tests: buy and exit (slice C, WR-C04)

**File:** `test/realpath/triage/AUD-BUY-028.test.ts:71,97-104,115-122`
**Issue:** `actual` is only `buySubmitted`. Any other gate failing on this ordinary launch gives `buySubmitted: false` and "looks fixed": a Phase 24 change to another check, or a new read the table lacks that a gate treats fail-closed. The lock decision itself is never read, although `src/bot.ts:1028` logs `checks.locked`.
**Fix:**
```ts
const failed = logged('Safety checks failed, skipping')[0] as { checks?: Record<string, unknown> } | undefined;
actual: { lockGatePassed: failed ? failed.checks?.locked === true : result.buySubmitted, buySubmitted: result.buySubmitted },
correct: { lockGatePassed: false, buySubmitted: false },
```
Also require every other check in `failed.checks` to be passing, so a refusal can only come from the lock.

### WR-15: AUD-EXIT-002 and AUD-BUY-002 count an exit_state row, or any matching alert anywhere in the run, as "protected"

**Area:** Triage tests: buy and exit (slice C, WR-C05)

**File:** `test/realpath/triage/AUD-EXIT-002.test.ts:35,71-79`; `test/realpath/triage/AUD-BUY-002.test.ts:137-138`
**Issue:** `protectedOrOperatorTold` is `timer || heldStateRow !== undefined || unprotectedAlert`. A row without a timer protects nothing in the running process. A fix that moves `upsertExitState` above the null return at `src/exitEngine.ts:1873-1876` (for restart durability) but keeps the `return` flips the marker, while the position still has no stop-loss.

`unprotectedAlert` also scans every alert of the test for a broad regex. The existing anti-rug alert `src/anti-rug/detector.ts:909` ("...positions on this chain are UNMONITORED") matches it, so any WS-health alert in the window, or a future baseline-failure alert, would read as the fix.
**Fix:** Count protection only as a live timer (`hasExitMonitorTimer`). Scope the alert to this position: `recordedAlerts().slice(fromAlert)` filtered on `sc.token` or `RPLT`. Do the same in BUY-002 claim 1 (`monitored`: timer, not `exitStateRows > 0`).

### WR-16: AUD-EXIT-003 markers can be flipped by wrong fixes

**Area:** Triage tests: buy and exit (slice C, WR-C06)

**File:** `test/realpath/triage/AUD-EXIT-003.test.ts:135-137,179-181,213-215`
**Issue:** Two claims can flip for the wrong reason.
- **Claim 1:** "fixed" means only that some quote's `amountIn !== parseEther(snipe)`. `parseUnits(buyAmount, decimals)` reads decimals but still reuses the ETH amount as a token count (0.01 tokens for the 9-decimal token, a few-wei quote, sub-claim 3), and it flips the claim.
- **Zero-entry claims:** these read "fixed" when nothing sells or triggers. A fix that treats a 0 entry like null (log and `return`, `src/exitEngine.ts:1873`) sells nothing and flips both claims. It turns the bug into AUD-EXIT-002's unmonitored position, and nothing in either test catches it, because EXIT-002 injects a failed read, not a 0 quote.

**Fix:** Claim 1: measure that the probe is sized to the position or the pool (for example `amountIn` within 1-100 percent of `original_token_amount`, or the pool price used directly). Zero-entry claims: add `monitored: hasExitMonitorTimer('eth', token) || unprotectedAlertForToken` to `correct`, so a fix that silently drops the monitor reads "the failure changed".

### WR-17: AUD-EXIT-014 defines "not refused at once" as "no broadcast within 2 s of virtual time"

**Area:** Triage tests: buy and exit (slice C, WR-C07)

**File:** `test/realpath/triage/AUD-EXIT-014.test.ts:97,100-106`
**Issue:** `actual` is `fired.length > 0 && every(success === false)`, read after `stepUntilOrFor(..., 2_000)`. A wrong fix that waits for the lock for longer than 2 s and then still refuses (or times out under the exitTrigger watchdog) sells nothing and still returns `success: false` later. At 2 s `fired` is empty, so the marker throws "looks fixed". The after-marker assertions, which would show the anti-rug exit never sold, never run.
**Fix:** Measure the outcome rather than the timing. Release the hold, drive the chain to a settled state, and require either an `exit-fired` broadcast with `success: true`, or the position closed by a sell whose `exit.full.submitted` reason is `anti-rug` (or the routine exit escalated). Keep "refused at once" as a separate fact in `actual`.

### WR-18: AUD-BUY-001 can record the bug as still present under a correct fix (51 s window and clock skew)

**Area:** Triage tests: buy and exit (slice C, WR-C08)

**File:** `test/realpath/triage/AUD-BUY-001.test.ts:167-177,215-226`
**Issue:**
- **Window:** the running bot is observed for `10 * pollMs + 1_000` = 51 s of virtual time. A correct "re-scan unmonitored pending buys" fix on a 60 s cadence has not run yet, so `actual` equals `observed` and the marker passes as the known bug.
- **Clock skew:** the child script runs on the real clock (2026-11) and writes `trades.timestamp` (`src/bot.ts:781`) and the exit-state urgency start in real time. The parent's fixed clock is 2026-01-01. A re-scan fix with an age guard (only rows older than N s, to avoid racing the in-process handler between insertTrade and arming) sees the child's row as roughly ten months in the future and never adopts it.

Both make the S0 proof stay "bug present" under a correct fix.
**Fix:** Before the marker, step the parent clock past the child's real time (`vi.setSystemTime(Math.max(Date.now(), realNowCapturedBeforeSpawn) + 1_000)`). Observe until `stepUntilOrFor(monitored, 5 * 60_000)` rather than a fixed 10 polls, and keep the `observed` value.

### WR-19: Plain expectations about other findings make these tests fail when those findings are fixed

**Area:** Triage tests: buy and exit (slice C, WR-C09)

**File:** `test/realpath/triage/AUD-EXIT-002.test.ts:100-103`; `test/realpath/triage/AUD-BUY-001.test.ts:255-257`
**Issue:**
- EXIT-002 asserts that the error lines are exactly `['Cannot query initial price…', '[GAP DETECTED] backfill skipped…']`. The second line is the AUD-ANTIRUG-024 false gap. When AUD-ANTIRUG-024 is fixed, EXIT-002 fails although its own bug is untouched.
- BUY-001 asserts `resubscribes === 2` and waits for `eth_unsubscribe === resubscribes - 1`, which is AUD-ANTIRUG-025's behavior. Fixing ANTIRUG-025 breaks the S0 test with a mismatch or a `stepUntilTrue` timeout.

Phase 24 fixes are planned finding by finding, so these become red-for-the-wrong-reason failures. `AUD-API-002-restart.ts` already shows the right pattern ("at most one gap line; its fix removes the line, which still passes").
**Fix:** EXIT-002: `expect(errors.filter((m) => m !== '[GAP DETECTED] backfill skipped — gap exceeds maxBackfillBlocks')).toEqual(['Cannot query initial price, exit monitor not started'])`. BUY-001: wait on a fix-independent condition (no queued request pending, or `stepFor` a fixed drain) and drop the exact count.

### WR-20: The AUD-BUY-011 dashboard fixture races for its port and never checks it reached its own server

**Area:** Triage tests: buy and exit (slice C, WR-C10)

**File:** `test/realpath/triage/fixtures/AUD-BUY-011-dashboard.ts:63-72,104-123`
**Issue:** `freeLoopbackPort` binds port 0, reads the port, closes it, and returns it. The graph then loads and `startApiServer` binds it later. The full run executes many realpath files in parallel workers, and several of them start dashboards. In that gap another worker can bind the port.
- `src/api/server.ts:211` calls `server.listen` with no `'error'` listener, so EADDRINUSE becomes an uncaught exception in the worker.
- If the other socket is an HTTP server, the `/health` loop accepts any `status > 0` from it. Login and `POST /api/chains/eth/stop` then go to the other test's dashboard, which shares the sentinel API key and chain name and can stop that test's chain.

The result is a nondeterministic cross-test failure.
**Fix:** Bind the real server on port 0 and read the bound port, as `AUD-API-002-restart.ts` already does through the `net.server.listen` diagnostics channel, instead of picking a free port in advance. At minimum, check that `/health` came from this graph (for example a nonce in the response, or compare `handle.address()`).

### WR-21: AUD-BUY-005 proves one call site; a `.catch` there flips the finding while the other un-awaited sites still crash

**Area:** Triage tests: buy and exit (slice C, WR-C11)

**File:** `test/realpath/triage/AUD-BUY-005.test.ts:37-48,75-86`; `test/realpath/triage/fixtures/unhandledRejectionCrash.ts:107`
**Issue:** The header itself documents the gap. A per-handler `.catch` on the V3 listener call (`src/bot.ts:1544`) turns the only claim "looks fixed". Still uncovered:
- the V2 listener call (`src/bot.ts:1585`)
- both HTTP poll dispatches
- `startHttpPollingListener`
- the MEV-health and wallet-balance intervals
- the async close handlers

So the S1 finding ("one escaped rejection exits the process") reads fixed at finding level while any of those can still end the process. The claim name is scoped, but the register judges the finding by its claims.
**Fix:** Add a second claim on the V2 WebSocket listener (the same fixture shape with a PairCreated push, triggered by the same bad minimum on the V2 path, or by any rejection inside `handleNewPairForChain` before its try). Or make the register mark AUD-BUY-005 "partially proven" until a process-level handler claim exists.

### WR-22: AUD-BUY-027 proves only the V2 path; the V3 pool path has the same non-native selection

**Area:** Triage tests: buy and exit (slice C, WR-C12)

**File:** `test/realpath/triage/AUD-BUY-027.test.ts:78-103`
**Issue:** The finding's `sibling_sites_checked` (`.planning/audit/findings/AUD-BUY-027.json`) says the V3 target selection (`src/bot.ts:1209-1210`) and the V3 listener have the same shape. The test drives only a V2 `PairCreated` through `handleNewPairForChain`, and nothing in the header records the gap. A fix placed in `handleNewPairForChain` or the V2 listener turns the only claim "looks fixed", while a V3 `PoolCreated` for an A/B pool is still taken as a launch.
**Fix:** Add claim `non-native-v3-pool-processed`. Fire a V3 `PoolCreated(A, B, fee)` through the real V3 listener and measure that "New V3 pool detected" (or the V3 equivalent) is not logged for that pool and no buy is sent. Or document in the header that the claim covers V2 only.

### WR-23: Census name lists miss other ethers signing APIs and indirect calls

**Area:** CI gates and CI wiring (slice D, WR-D01)

**File:** `scripts/check-signing-census.ts:207-210`, `:966-977`
**Issue:** The census counts a site only when the method name is in `SIGN_TX`/`BUNDLE` (or an in-program ABI literal, for `any` receivers). These nonce-consuming forms are not counted on a fully typed receiver:
- `JsonRpcSigner.sendUncheckedTransaction(tx)`: a real Signer API (`provider-jsonrpc.js:92`) that consumes a nonce. Its name is not in `SIGN_TX`, so `classify` falls through to `null`.
- `wallet.sendTransaction.call(wallet, tx)`, `.apply(...)`, `const send = wallet.sendTransaction.bind(wallet); await send(tx)`. The callee name is `call`/`apply`/`bind`, or a bare Identifier.
- `wallet.signingKey.sign(tx.unsignedHash)` + `provider.broadcastTransaction(...)`, and `provider.send('eth_sendTransaction', …)` against a node-held key.
- An `any`-typed contract receiver whose method name appears in no in-program ABI literal (`:968`). This is the case for ABIs loaded from artifacts.
**Fix:** Add `sendUncheckedTransaction` (and ethers' `signAuthorization`) to `SIGN_TX`. Treat `.call`/`.apply`/`.bind` on a signing-method value as the underlying site. Count `SigningKey.sign` and `provider.send` with a literal `eth_sendTransaction`/`eth_sendRawTransaction` as `tx-signing` sites with lock `unknown`. Treat an `any` receiver in a file that imports ethers `Contract` as unresolved regardless of the method name.

### WR-24: Lock key is never tied to the signer, and any function named `withNonceLock` counts as the lock

**Area:** CI gates and CI wiring (slice D, WR-D02)

**File:** `scripts/check-signing-census.ts:489-496`, `:651-653`
**Issue:** The real lock is keyed per address (`src/utils/nonceAuthority.ts:63`, `withNonceLock(walletAddress, op)`). `isLockCall` checks only that the callee resolves to some `FunctionDeclaration` named `withNonceLock`. `lockOfArgUse` then marks argument 1 as `locked` whatever argument 0 is. Two concrete false "locked" results:
- `withNonceLock(otherWallet.address, () => ctx.wallet.sendTransaction(tx))` serializes against the wrong key, so a nonce race on `ctx.wallet` remains, yet it is reported `locked lexical`.
- A script that declares `async function withNonceLock(_a: string, op: () => Promise<T>) { return op(); }` locally makes every site it wraps `locked`.

The `lock_calls` key is recorded (`:838`) but nothing checks it.
**Fix:** In `isLockCall`, require that the resolved declaration's source file is `src/utils/nonceAuthority.ts`. For each locked site, compare the lock's argument 0 with the signer (receiver/runner) expression. At minimum, require `<signer>.address` text equality or the same symbol, and otherwise report `unknown` with a reason.

### WR-25: Census scans only `.ts`/`.tsx`; `.mts`, `.cts`, `.js`, `.cjs`, `.mjs` under `src/` and `scripts/` escape, and the completeness check cannot see them

**Area:** CI gates and CI wiring (slice D, WR-D03)

**File:** `scripts/check-signing-census.ts:225-234` (`walkTs`), `:254-259`, `:1398-1403`; `tsconfig.json` (no `allowJs`)
**Issue:** The program roots are `tsconfig.json` files plus `walkTs(scripts)`, and `walkTs` matches only `/\.tsx?$/`. `file-not-audited` walks with the same `walkTs`, so a `scripts/rescue.cjs` or `scripts/rescue.mts` that signs is not in the program and is not reported as unaudited either. The gate exits 0. `scripts/in-memory-mutant-overlay.cjs` already shows that plain CommonJS files live in `scripts/`. The header's contract is "every transaction-signing site in src/ and scripts/".
**Fix:** In `evaluateGate`, list every file under `src/` and `scripts/` with a JS/TS source extension (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`). Fail `file-not-audited` for any that is not in the program. Alternatively, add `allowJs` and the extra extensions to the census program.

### WR-26: Real-path mock gate only reads files under `test/realpath/`, but real-path tests run code from outside that folder

**Area:** CI gates and CI wiring (slice D, WR-D04)

**File:** `scripts/check-realpath-mocks.ts:118-119`, `:369-385`; `vitest.config.ts:47-58`
**Issue:** The gate walks only `DEFAULT_ROOT = test/realpath`. Real-path tests import modules from outside that root (`../../rails/spawnRailedChild` in 12 files, `../../helpers/sourceGraph` in `test/realpath/env/envMatrix.test.ts:64`). The realpath project's `setupFiles` also start with `test/rails/setup.cjs` (`vitest.config.ts:57`). A `vi.doMock('../../src/utils/db', …)` placed in a helper under `test/helpers/` or `test/rails/`, called by a real-path test before its dynamic import, or a `vi.mock` in a setup file, replaces a bot module for the real-path workers while `npm run check:realpath-mocks` passes. The gate also never reads `vitest.config.ts`. A second `resolve.alias` entry on the realpath project (for example `{ find: /utils\/db$/, replacement: fakeDb }`) swaps a bot module with no `vi` call at all. The existing `ethers` alias shows that the mechanism is in use. No such mock exists today (grep of `test/helpers` and `test/rails` for `vi.mock|doMock|spyOn|stubGlobal` is empty).
**Fix:** Scan the transitive closure of every non-package module that a `test/realpath/**` file or a realpath `setupFiles` entry imports, using `sourceGraph`-style resolution. Run the same AC-02 check over those files. Also assert that the realpath project's `resolve.alias` holds exactly the one `ethers` entry.

### WR-27: Commit taxonomy lets a merge commit carry any recording edit, with exit 0

**Area:** CI gates and CI wiring (slice D, WR-D05)

**File:** `scripts/check-commit-taxonomy.ts:410-419`, `:461`
**Issue:** A merge whose result differs from every parent inside `test/realpath/recordings/` only adds a `WARN` line. The exit code depends only on `violations` (`:461`). No conflict is needed: `git merge --no-commit --no-ff side`, edit `test/realpath/recordings/a.jsonl`, `git commit -m "Merge branch side"` gives a re-recorded golden master with CI green. The self-test case `AC-42-…-warns-and-exits-0` pins exactly this outcome. AC-42 documents the exemption, but it is a direct route around the gate's purpose ("a re-record cannot launder a behavior change"), and a WARN line inside a passing CI log is easy to miss.
**Fix:** Judge the merge's own `--cc` paths like a non-merge commit: a merge that changes a recording on its own must have a `behavior:` subject citing a real ID. Or exit non-zero on any such merge unless an operator decision record lists the merge SHA. If AC-42 must stand, make the WARN at least fail the job on `push` to main, so it cannot land silently.

### WR-28: Recordings-compared counts any `compareRecording` call, even one whose mismatch is caught

**Area:** CI gates and CI wiring (slice D, WR-D06)

**File:** `test/realpath/harness/serializer.ts:366-368` (record before compare); `scripts/check-recordings-compared.ts:313-323`
**Issue:** `compareRecording` appends the path to the run record before it compares the bytes. The gate then treats "called" as "compared". A scenario that moves to a new recording name and keeps the old file "compared" by `try { compareRecording('old.jsonl', textNow); } catch {}`, or by comparing the old recording against its own bytes read from disk, passes both this gate and the commit check. That is the 23-25 laundering route with one extra line. The source-text gate does not forbid reading `test/realpath/recordings/`.
**Fix:** Record the outcome too, for example `{"path":"a.jsonl","result":"match"}` written after a successful compare. Have the gate require at least one `match` (or `written` outside CI) per tracked recording and fail on any recorded `differs`/`absent` outcome. Consider also forbidding reads of `test/realpath/recordings/**` outside the serializer, through the source-text gate.

### WR-29: Source-text gate misses `?raw` imports, `new URL(...)` paths and aliased read functions

**Area:** CI gates and CI wiring (slice D, WR-D07)

**File:** `test/unit/sourceTextGate.test.ts:87-92`, `:102-104`, `:126-160`, `:163-176`, `:82-85`
**Issue:** The rule looks only at calls whose callee name is `readFileSync`/`readFile`/`createReadStream`/`createSourceFile`/`createProgram`. These named reads of `src/bot.ts` pass:
- `import botText from '../../src/bot.ts?raw'`: Vite/Vitest's raw import reads the file as text with no fs call. Import declarations are never inspected.
- `fs.readFileSync(new URL('../../src/bot.ts', import.meta.url))`: `NewExpression` yields `[[]]` (`:159`). The repo already uses `new URL(..., import.meta.url)` in `test/rails/vitest.fork-rehearsal.config.ts:19`.
- `import { readFileSync as rd } from 'fs'; rd('src/bot.ts')`, `fs['readFileSync'](...)`, `const read = fs.readFileSync; read(...)`. `calleeName` returns `rd`/`undefined`/`read` (`:87-92`).
- `let p = 'src/bot.ts'; fs.readFileSync(p)`: only `const` bindings are followed (`:102`).
- `fs.readFileSync(require.resolve('../../src/bot'))`: the extensionless literal has no file-name segment (`:84`).
- `path.join(__dirname, 'fixtures', '..', '..', '..', 'src', 'bot.ts')`: `..` segments are dropped rather than resolved, so the first segment is `fixtures` (`:83`).
**Fix:** Resolve the read function by symbol, not by name: follow import aliases and destructuring from `fs`/`fs/promises`/`node:fs`, and element access with a literal. Flag any import or `import()` specifier with a `?raw`/`?url` suffix that resolves under top-level `src/` or `scripts/`. Treat `new URL(lit, import.meta.url)` as `lit`. Follow `let`/`var` declarations that are never reassigned. Resolve `..` with `path.posix.normalize` before testing the first segment. Treat `require.resolve(lit)` as naming the resolved file.

### WR-30: No guard that every test file under `test/` belongs to a project CI runs

**Area:** CI gates and CI wiring (slice D, WR-D08)

**File:** `vitest.config.ts:18`, `:31`, `:53`, `:66`; `package.json:11-13`
**Issue:** Each project includes only `test/<project>/**/*.test.ts`. A file such as `test/scripts/x.test.ts`, `test/unit/x.spec.ts`, `test/unit/x.test.mts` or `test/unit/x.test.tsx` matches no project. `npm run test:unit|integration|realpath` never runs it, CI stays green, and nothing reports it. Today `find test -name '*.test.*'` finds no such file, so this is latent. The source-text and vi-mock gates scan these files, so they look covered when they are not.
**Fix:** Add a unit test that lists every `*.test.*` / `*.spec.*` file under `test/` and asserts that each matches exactly one project's `include` from the loaded `vitest.config.ts` (fork included). It should fail on any orphan.

### WR-31: CI jobs lack `timeout-minutes`; contract jobs install unpinned Python tools

**Area:** CI gates and CI wiring (slice D, WR-D09)

**File:** `.github/workflows/test.yml:9-10`, `:126-127` (no timeout); `:171-173`, `:204-205` (pip)
**Issue:** The `test` job runs four self-test children with 240 s limits each, plus git-heavy gates, and has no job-level `timeout-minutes`. A hung child or a git prompt holds the runner until the 6-hour default. `detect-contract-changes` has the same problem. `pip install slither-analyzer` and `pip install mythril` are unpinned, so a re-run can pick up a new analyzer that changes the `--fail-medium` result for the same commit.
**Fix:** Add `timeout-minutes: 30` (or a measured limit) to `test` and `timeout-minutes: 5` to `detect-contract-changes`. Pin `slither-analyzer==<ver>`, `mythril==<ver>` and `solc-select==<ver>`.

### WR-32: `--scan` still lists merges by first parent and ignores REVIEWED_HITS, so once the phase branch is merged, the record's own documented check reports INVALID

**Area:** Recording pipeline, secret scan, seal verifier (slice E, WR-E01)

**File:** `.planning/audit/tools/seal-verify.ts:100, 454-457, 795-801, 1518-1523`
**Issue:** D-19 fixed `changedPaths` (it now uses the combined listing), but `scanRange` still uses `RANGE_LOG_OPTS = '... --diff-merges=first-parent'`. After a GitHub merge commit M of this branch into main, `912b915..M` contains M. M's first-parent diff is the whole phase diff, including content that was committed before the seal. `--scan` does not apply `REVIEWED_HITS` (header line 55, and the `scanFn` at 1518-1523 returns raw hits). So the two operator-ruled locations, in `hostHeaderCrash.ts` and the `user:pass@` URL in `recordingsGuard.test.ts`, come back as `non-public` under commit M. The result is `SEAL INVALID: the scan of ... found N non-public hit(s)`.

SEAL-23.json's `rule` field says "run seal-verify.ts --seal .planning/audit/SEAL-23.json --scan", and that command then fails for a reason that is not a secret. The failure is closed, not open, but it teaches operators to skip `--scan`. The self-test's merge cases use `scan: false` (line 946), so this path is untested.
**Fix:** Scan only content that is new after the seal. Use `--diff-merges=combined` (or `remerge`) for merge commits in the `--scan` range, or scan non-merge commits plus each merge's combined diff. Apply `applyReviewed` with a ruling read at `sealed_sha` in `--scan` as well. Add a self-test case: PR-style merge plus `scan: true` must stay VALID.

### WR-33: The recording guard exempts every `data` key, and every hash-named key, from the 64-hex secret rule in any entry kind

**Area:** Recording pipeline, secret scan, seal verifier (slice E, WR-E02)

**File:** `test/realpath/recordingsGuard.test.ts:239-242, 245-246`
**Issue:** `checkString` returns early for `key === 'data'` once the value is whole-byte hex (lines 239-242). That happens before the 64-hex run check, in every line kind (op fields, db rows, relay params, env snapshots), at any depth.

A private key logged as `{ data: '0x<64 hex>' }`, or embedded anywhere in a longer `data` hex blob, raises no violation. The same holds for a `0x<64 hex>` value under any of the 14 `HASH_KEYS` names (`hash`, `txHash`, `bundleHash`, `relayHash`, ...) or inside `topics`.

The bad-cases test proves the rule for `note`, `walletPrivateKey` and the free-text message, but has no case for `data` or a hash key holding a key-shaped value. This matters because the real secrets this bot holds (PRIVATE_KEY, FLASHBOTS_AUTH_KEY, DEPLOY_PRIVATE_KEY) are exactly `0x` plus 64 hex.
**Fix:** Scope the calldata exemption to where calldata actually lives (`submit.request.data`, relay `params` bodies, decoded tx fields). Elsewhere, run the 64-hex rule on `data`. For hash keys, also check that the value is not equal to any sentinel and, where possible, cross-check it against a known tx or bundle hash in the same recording. Add bad cases `op({ data: PLANTED_KEY })` and `op({ hash: PLANTED_KEY })`.

### WR-34: Non-hex secrets are caught only when they equal a test/.env.test sentinel exactly, and the allow-listed secret fields accept any non-sentinel value

**Area:** Recording pipeline, secret scan, seal verifier (slice E, WR-E03)

**File:** `test/realpath/recordingsGuard.test.ts:133-138, 179-203, 213-222`
**Issue:** Outside the 64-hex rule and the URL host rule, the guard finds a secret only by exact or substring match against test/.env.test values. If a value that is not a sentinel reaches a recording, none of these fail:
- a Telegram bot token (`123456789:AA...`);
- a 32-hex `TELEGRAM_API_HASH`;
- a base64 `TELEGRAM_SESSION` or bloXroute `Authorization` value;
- `DASHBOARD_API_KEY` or explorer API keys in free text;
- a `Bearer ...` string;
- a URL fragment (`u.hash` is never examined in `checkUrl`);
- a credential URL in a scheme other than http(s)/ws(s) (`URL_RUN`, line 107).

The allow-list keys make this concrete. `sentinelAllowed` is only consulted when the value is a sentinel, so a non-sentinel value under `authHeader` (not hex, no URL) passes every rule. The env snapshots record these live fields verbatim: `env/_baseline.json` holds `walletPrivateKey`, `authKey` and `authHeader` as the registry parsed them.

Today the rails close the main route: core.cjs:1238-1249 deletes every `.env.example` key and loads the sentinels, and envMatrix sets every listed variable from test/.env.test. The guard is the declared second layer (AC-51), and for these classes it is not one.
**Fix:**
- Under `walletPrivateKey`, `authKey` and `authHeader`, require the exact sentinel (or a short non-secret case value such as `0`/`abc`/empty) and fail on anything else.
- Add shape rules: `\b\d{6,12}:[A-Za-z0-9_-]{30,}\b` (Telegram), `\b[0-9a-f]{32}\b` outside known fields, base64 runs of 40 or more characters, `Bearer\s+\S{16,}`.
- Check `u.hash`, and match any `scheme://user:pass@` form.

### WR-35: Nothing scans a re-recorded file before it is committed or pushed; the guard runs only in CI, after the push

**Area:** Recording pipeline, secret scan, seal verifier (slice E, WR-E04)

**File:** `scripts/update-recordings.ts:44-56`; `test/realpath/recordingsGuard.test.ts:2-3, 405-409`
**Issue:** The guard's header says every recording "must pass before its first commit". In practice:
- `update-recordings.ts` spawns one filtered Vitest run and exits. A filtered run (`-- test/realpath/scenarios/x.test.ts`) never includes `recordingsGuard.test.ts`.
- With `--all`, the guard runs in parallel with the scenario files that are writing. `writeFileSync` is not atomic, so the guard can scan the old file or a half-written one.
- The only git hook is `pre-commit`, which runs `scripts/check-empty-files.sh`.

So a recording holding a secret is committed and pushed, and the guard first sees it in GitHub Actions `test:realpath`. By then the value is on the remote. The wrapper also prints "update-recordings: done. Review every change ..." even when Vitest exited non-zero (line 55).
**Fix:** After the child exits, have `update-recordings.ts` import `scanRecordingsDir` (moved to a non-test module) and run it over `RECORDINGS_DIR`. Exit non-zero and print each violation. Print "done" only on status 0. Optionally add the same scan to the pre-commit hook for staged files under `test/realpath/recordings/`.

### WR-36: The write switch is a plain environment variable with no tie to the update command, so a lingering export silently re-records on every local run

**Area:** Recording pipeline, secret scan, seal verifier (slice E, WR-E05)

**File:** `test/realpath/harness/serializer.ts:290-294, 374-378`; `scripts/update-recordings.ts:38-46`; `test/realpath/recordingsGuard.test.ts:678-701`
**Issue:** `updateAllowed()` writes whenever `VITEST_CSB_UPDATE_RECORDINGS === '1'` and CI is unset. The rails keep every `VITEST_*` key in workers (core.cjs:1205-1206). A developer who once ran `export VITEST_CSB_UPDATE_RECORDINGS=1` (to debug, or copied from the wrapper's echoed command line 45) gets the following from every later `npm run test:realpath` or `npx vitest` in that shell:
- every differing recording is rewritten;
- the run reports green;
- `check:recordings-compared` also passes.

This skips the wrapper's "no empty filter without --all" rule. The AC-25 test only checks textual mentions in repo files and cannot see a shell export. CI is safe because CI is set.
**Fix:** Tie the switch to one wrapper invocation. The wrapper writes a random token to `<os.tmpdir()>/csb-recordings-update-<token>` and sets `VITEST_CSB_UPDATE_RECORDINGS=<token>`. `updateAllowed` requires a 32-hex token whose file exists, and the wrapper deletes the file when Vitest exits. At minimum, have `compareRecording` print a loud stderr line for every `'written'` result so a silent re-record is visible.

## Info

### IN-01: `newPendingTransactions` subscriptions are accepted and then never fed

**Area:** Simulated chain and real-path harness (slice A, IN-A01)

**File:** `test/realpath/harness/chain.ts:1742-1750`
**Issue:** `#subscribe` accepts `newPendingTransactions` without recording a stray, but `mine()`/`#admitPublic` never push to it. A future src mempool watcher would subscribe and silently receive nothing, against the AC-03 rule that anything unmodelled fails by name.
**Fix:** Record a stray for `newPendingTransactions` until pushes are implemented, or push the hash from `#admitPublic` when a transaction is accepted.

### IN-02: Relay acceptance does no nonce or chain check, and a stale relay transaction stays `accepted` forever

**Area:** Simulated chain and real-path harness (slice A, IN-A02)

**File:** `test/realpath/harness/chain.ts:878-889`, `chain.ts:1776-1796`, `chain.ts:1151-1159`
**Issue:** `acceptRelayTransaction` and `#sendBundle` record any signed transaction as `accepted`. The dropped sweep in `mine()` covers only senders in the block being mined. So a bundle or bloXroute transaction sent at a nonce that was already mined never becomes `dropped`. `statusOf()` keeps reporting `accepted`, and a drive helper that mines every accepted wallet transaction (for example `driveExits`) then throws inside `mine()`. That failure is loud but misleading.
**Fix:** On acceptance, mark a relay transaction `dropped` (with a history event) when its nonce is below `minedCount(from)` or its chain ID differs. Alternatively, sweep stale relay transactions for every sender at each `mine()`.

### IN-03: `assertAllFaultsFired` checks only `fired === 0`

**Area:** Simulated chain and real-path harness (slice A, IN-A03)

**File:** `test/realpath/harness/world.ts:440-446`
**Issue:** A `failNext(..., { times: 3 })` that fired once passes. A test that armed three failures to cover three retries learns nothing if the bot made one call and gave up.
**Fix:** Fail when `f.kind === 'fault' && f.fired < f.times`, or add an `exact: true` option that does.

### IN-04: The notifier mock drops the real dashboard broadcast and the display-name prefix

**Area:** Simulated chain and real-path harness (slice A, IN-A04)

**File:** `test/realpath/harness/setup.ts:73-87` versus `src/utils/notifier.ts:59-120`
**Issue:**
- The real `sendTelegramAlert` and `sendCtxAlert` always end with `broadcast('notification', …)`, and the real Telegram text is `${displayName} ${message}`. The mock does neither.
- The mock also records an alert when `TELEGRAM_CHAT_ID`/`TELEGRAM_BOT_TOKEN` are missing, where the real function logs "skipped".

A Phase 24 fix that surfaces an operator warning through the dashboard notification would be invisible in `harnessState().broadcasts`.
**Fix:** Have the mock also append the `notification` broadcast with the same severity, category and chain inference, or document that `broadcasts` excludes notifications.

### IN-05: Loopback records a stray when it answers a request whose client has gone, and calls it a "push"

**Area:** Simulated chain and real-path harness (slice A, IN-A05)

**File:** `test/realpath/harness/loopback.ts:116-122`, `loopback.ts:133-136`
**Issue:** The "not open" check in `connection.send` also covers RPC responses, not only subscription pushes. Consider a test that holds a call from a loopback child and lets teardown release it. Disposers run newest first, so the loopback `close()` runs before `releaseAll()`. The release answers a terminated socket, which is recorded as "a push to a loopback socket that is not open", and the test fails with a misleading stray. A real server simply drops a response for a client that has gone.
**Fix:** Pass a flag (or use a separate send path) so only `eth_subscription` pushes record a stray. Drop responses to closed sockets silently, or count them on `socketErrors`.

### IN-06: loopbackChain's WebSocket handler has no try/catch, so a chain-side exception crashes the child as if it came from the bot

**Area:** Simulated chain and real-path harness (slice A, IN-A06)

**File:** `test/realpath/triage/fixtures/loopbackChain.ts:462-465` (compare the HTTP path at `loopbackChain.ts:425-432`)
**Issue:**
- `answer()` rethrows any error without a numeric `code` (line 405). One example is a `BigInt(String(tag))` SyntaxError for an unexpected block tag in `getBlock`.
- Over HTTP that becomes `FIXTURE_SETUP_ERROR` and exit 3. Over the WebSocket it is thrown from the `'message'` listener as an uncaught exception.
- In `contained` mode that exception is printed as `CONTAINED uncaughtException …`, which is the fault class the crash proofs attribute to the bot. In `fault` mode the child exits 1.

Today the crash tests compare stderr against a specific SIGNAL, so this shows as "the failure changed" rather than a false pass. It still breaks the fixture contract (rule 4).
**Fix:** Wrap the handler as `ws.on('message', (data) => { try { ws.send(dispatch(String(data), 'ws', conn)); } catch (e) { setupError(`loopback WS: ${String(e)}`); } });`.

### IN-07: loopbackChain `wsStartsClosed` uses a bind-close-rebind free port (TOCTOU)

**Area:** Simulated chain and real-path harness (slice A, IN-A07)

**File:** `test/realpath/triage/fixtures/loopbackChain.ts:204-210`, `loopbackChain.ts:481-483`, `loopbackChain.ts:539-542`
**Issue:** `freePort()` binds port 0, reads the port, closes it, and the fixture expects the port to stay refused, then rebinds it in `reopenWs()`. Under parallel CI another loopback server can take the port in between. The "refused" boot connect then reaches a stranger's server, or `reopenWs()` fails with EADDRINUSE. Either way it shows as a flaky "failure changed" or a setup error, not a false pass.
**Fix:** Keep a listener bound and refuse at the TCP layer instead (accept and immediately `socket.destroy()` before the upgrade), or retry the whole run on EADDRINUSE.

### IN-08: loadGraph's DB-path verification is partial

**Area:** Simulated chain and real-path harness (slice A, IN-A08)

**File:** `test/realpath/harness/world.ts:334-352`
**Issue:**
- Memory mode sets `DB_PATH=':memory:'` but never checks after the import that `getDbFilePath()` is `:memory:`.
- File mode checks only after `import('../../../src/utils/db')`, which has already opened and migrated whatever path db.ts resolved.

The src-side `assertNotProdDbUnderVitest` is the guard that actually holds. The harness layer described in the header ("Every refusal happens before any src/ import") is weaker than it reads.
**Fix:** Pre-compute the path with the same resolver db.ts uses (`resolveDbPath` from src/utils/dbPath.ts) before importing db.ts, and refuse on any mismatch. In memory mode, also assert `getDbFilePath() === ':memory:'` after the import.

### IN-09: `emitLogs` delivers logs for blocks already announced and changes mined receipts after the fact

**Area:** Simulated chain and real-path harness (slice A, IN-A09)

**File:** `test/realpath/harness/chain.ts:1276-1295`, `chain.ts:1675-1676`
**Issue:**
- `emitLogs` stores a log on the head block, or on an older named block, and pushes it to `logs` subscriptions. A real node only pushes logs with a new block, or with a reorg (`removed`).
- Receipts are computed live from `this.logs`, so the receipt and logsBloom of a transaction mined earlier change after the fact.

A consumer that ignores logs at or below its cursor would drop such a log in the harness, while on a real chain the event arrives in a new block. Today only ordering/sameBlock.test.ts uses `emitLogs`.
**Fix:** Restrict `emitLogs` to the block just mined, before any later block exists, or deprecate it in favour of `mine({ logs })`.

### IN-10: Synthesized older blocks have an inconsistent parent chain and cannot be found by hash

**Area:** Simulated chain and real-path harness (slice A, IN-A10)

**File:** `test/realpath/harness/chain.ts:1557-1576`, `chain.ts:1502-1505`
**Issue:**
- In `#blockAt`, block n's `parentHash` is `keccak("realpath-block:n-1")`. Block n-1's `hash` is `blockHashOf(n-1, …)`, except for the block just below the first stored one. So the synthesized chain does not link.
- `eth_getBlockByHash` searches only stored blocks.

src/ does not read `parentHash` today, but a reorg check added later would see a broken chain on the harness only.
**Fix:** Derive a synthesized block's hash and parentHash from one function, `hashOf(n) = keccak("realpath-block:" + n)`, and resolve them in `eth_getBlockByHash`.

---

_Reviewed: 2026-11-12_
_Reviewer: Claude (gsd-code-reviewer), slice A_
_Depth: deep_

### IN-11: The AUD-ANTIRUG-005 backfill claim rests on an event never happening, and its precondition does not check that the gate was scheduled

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, IN-B01)

**File:** `test/realpath/triage/AUD-ANTIRUG-005.test.ts:78-97`
**Issue:** `correct` is `{false, false}`: no dispatch and no sell within 30 s. Any break between the confirm gate and the dispatch log gives that result too: `antirug.confirm-gate.reeval-error`, `antirug.signal-detripped`, the block handler on `ctx.httpProvider` never firing (`detector.ts:1874-1911`), or a breaker or live-gate change. The more direct signal, `antirug.confirm-gate.scheduled` from the backfill, is not in `actual`.
**Fix:** Add `confirmGateScheduledFromBackfill` (an `antirug.confirm-gate.scheduled` op for the trade since `fromLog`) to `actual`. Under the bug it is true; under the D-08 fix shape ("a backfill replay that cannot schedule the confirm gate") it is false.

### IN-12: AUD-API-001 counts any wallet sell as the operator's, and its emergency-sell name check is a substring match

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, IN-B02)

**File:** `test/realpath/triage/AUD-API-001.test.ts:102-108, 125-132`
**Issue:** `newSells.length > 0` counts any sell of the token the wallet submits during the second press's drive, including one from the bot's own monitor (`keepMonitoringFailedHeld`). It does not check that the route sent it. Separately, `includes('"tradeId":' + id)` also matches `"tradeId":1X`. Both are unlikely with today's single trade and unchanged price.
**Fix:** Tie the sell to the route, for example `opEntries('exit.full.submitted', from).some((o) => o.reason === 'force-sell' / 'emergency')`. Parse the reply body and compare `tradeId` values exactly.

### IN-13: Under the AUD-ANTIRUG-018 fix, the range-limit fault never fires and afterEach adds a second error next to "looks fixed"

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, IN-B03)

**File:** `test/realpath/triage/fixtures/AUD-ANTIRUG-018-range-limit.ts:40-53`; `test/realpath/harness/world.ts:440-446`
**Issue:** With a chunked poller, no request is ever wider than 10 blocks. `fired` stays 0, so `assertAllFaultsFired` fails the test in afterEach with "a fault never fired" next to the D-08 message. The fix signal is still present, but the result is a two-error failure that a reader or register check could misread.
**Fix:** Have one pre-restart control request that is over range by design, or arm the fault in a way that can never be "unfired", for example by counting refusals in the test and not relying on `fired > 0`.

### IN-14: AUD-SCRIPTS-002's holds-lock check does not check which lock is taken

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, IN-B04)

**File:** `test/realpath/triage/fixtures/scriptsStatic.ts:575-586, 634-642`
**Issue:** Any `acquireProcessLock(...)` call counts, whatever its arguments. A script that locks a different directory or address than the bot uses (`defaultLockDir()` and the address from the wallet key, as `src/main.ts:66-71` does) reads `holds-lock` but does not exclude the running bot.
**Fix:** Also require the first argument to resolve to `defaultLockDir()`, and the second to come from the script's signing wallet (`wallet.address` or `computeAddress(key)`).

### IN-15: AUD-API-008's free port is reserved and then released before the server binds it

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, IN-B05)

**File:** `test/realpath/triage/fixtures/hostHeaderCrash.ts:46-72`
**Issue:** The port is reserved by `freePort()` and released before `startApiServer` binds it. Under the full parallel run, another process can take it in between. The probe loop would then connect to that other listener and send the malformed request there. The test fails as "changed" or does not reach its path marker, never as a false fix, so this is a flake risk only.
**Fix:** Read the bound port from the `tracing:net.server.listen:asyncEnd` diagnostics channel, as `AUD-API-002-restart.ts:59-60, 283-286` already does, and keep `DASHBOARD_PORT=0`.

### IN-16: AUD-DB-004's "durable record" matches any row in any table that names the token

**Area:** Triage tests: anti-rug, dashboard, database, nonce/TX, scripts (slice B, IN-B06)

**File:** `test/realpath/triage/AUD-DB-004.test.ts:116-122`
**Issue:** `recordsBuy` accepts any insert or update, in any table, whose row text contains the token or a buy hash. An unrelated pre-submit write would flip both sub-claims to "looks fixed" while the trades row still comes after the submit and nothing reconciles at boot: for example, a persisted seen-pair or honeypot-cache row added by another fix.
**Fix:** Restrict the match to the record the recommendation describes, a buy intent row (token, chain, nonce, signed hash). That means the `trades` table or a named intent table, with a row that carries the nonce or a signed hash.

---

_Reviewed: 2026-11-12_
_Reviewer: Claude (gsd-code-reviewer, slice B)_
_Depth: deep_

### IN-17: Constant fields in `actual` add nothing to the proof

**Area:** Triage tests: buy and exit (slice C, IN-C01)

**File:** `test/realpath/triage/AUD-BUY-011.test.ts:96-98,143-145`; `test/realpath/triage/AUD-BUY-028.test.ts:99-101,117-119`
**Issue:** `chainShownStopped: true` and `lockedShareOfLpPct: 1` are literals in `correct`, `observed` and `actual`, so they can never differ. The facts are asserted elsewhere: `stopChain` for the first, `answered * 100n === full - …` for the second.
**Fix:** Compute them from the run (for example the `GET /api/chains` status read before the marker), or drop them from the marker.

### IN-18: Under the nonce-pinning fix, AUD-BUY-030's hold never fires and afterEach also fails

**Area:** Triage tests: buy and exit (slice C, IN-C02)

**File:** `test/realpath/triage/AUD-BUY-030.test.ts:65,102,112`
**Issue:** With the public nonce pinned, ethers makes no `eth_getTransactionCount` call after `buy.fallback.public.submit`, so `publicNonceRead` never parks. The "looks fixed" error then arrives together with `assertAllFaultsFired`'s "a hold never fired". The signal is still visible but noisy, and the converted Phase 24 test must drop the hold.
**Fix:** Note this in the header's Phase 24 reading, or release or ignore the hold when `heldWhenLanded === 0`.

### IN-19: AUD-BUY-006 depends on the listener starting and on the exact rejection log text

**Area:** Triage tests: buy and exit (slice C, IN-C03)

**File:** `test/realpath/triage/AUD-BUY-006.test.ts:55-57,61-62`
**Issue:**
- A fail-closed fix that refuses to start the Telegram listener with no allowlist configured fails the plain expects `handle.connected === true` and `telegramHandlerCount() === 1`.
- A fix that rejects with different wording (the current `log.debug` at `src/telegramListener.ts:81`) times out at `:62`.

Neither reads "looks fixed".
**Fix:** Treat "listener not started" as a rejected delivery, and wait on a bounded window (`stepUntilOrFor`) instead of the exact log text.

### IN-20: AUD-BUY-007 treats a renamed or unexported simulateSell as fixed

**Area:** Triage tests: buy and exit (slice C, IN-C04)

**File:** `test/realpath/triage/AUD-BUY-007.test.ts:123-143`
**Issue:** If `tokenSafety.simulateSell` is not a function (renamed, or no longer exported but still present), the `else` branch reports `signed: []`, which reads "looks fixed" while a signing approve can still exist in the module.
**Fix:** In the `else` branch, also assert that the module source no longer contains a signer-connected `approve(` in a function the bot imports. Or accept only deletion explicitly, by checking that `src/bot.ts` no longer imports it.

### IN-21: AUD-BUY-027 uses the "New pair detected" log as a proxy for "processed as snipe"

**Area:** Triage tests: buy and exit (slice C, IN-C05)

**File:** `test/realpath/triage/AUD-BUY-027.test.ts:98`
**Issue:** A correct drop placed after `src/bot.ts:889` (after the log, before the safety bank) gives `processedAsSnipe: true, buySubmitted: false`. That reads "the failure changed", not "looks fixed".
**Fix:** Measure "no safety-bank read of the A/B pair and no buy" (`node.callLog` eth_calls to `abPair`) instead of the log line.

### IN-22: AUD-BUY-001 duplicates the crashRun.ts ledger helpers

**Area:** Triage tests: buy and exit (slice C, IN-C06)

**File:** `test/realpath/triage/AUD-BUY-001.test.ts:88-114`
**Issue:** `newCaseId` and `takeCaseLedger` re-implement `fixtures/crashRun.ts:103-127` (`newCaseId`, `expectRailedLoopbackOnly`), with a different deny-set rule. The two copies can drift on how the rail ledger is read.
**Fix:** Import from `crashRun.ts`, adding an option there for the expected `env-read-blocked` entry.

---

_Reviewed: 2026-11-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

### IN-23: `--sole-run` does not confirm that the run it judges is the realpath step's run

**Area:** CI gates and CI wiring (slice D, IN-D01)

**File:** `scripts/check-recordings-compared.ts:282-299`; `test/realpath/harness/serializer.ts:337-345`
**Issue:** The gate picks the only folder under `/tmp/crypto-snipe-bot-recordings-compared/`. Suppose the realpath workers write no record (for example, the run id is missing, and the serializer only warns on stderr), while an earlier unit or integration run wrote a complete record. The gate then judges that other run and passes. No unit or integration test calls `compareRecording` today, so this is a future-proofing gap. The two-run and zero-run cases already fail closed.
**Fix:** In `--sole-run`, also read the rail ledger summary for the chosen run id and require the `realpath` project in it. Or have CI capture the realpath step's output and use `--run-log`.

### IN-24: Floor-history check accepts any registered finding and reads the registry from the working tree

**Area:** CI gates and CI wiring (slice D, IN-D02)

**File:** `scripts/check-signing-census.ts:1730-1732`, `:1371-1374`, `:1658-1659`
**Issue:** A floor drop passes if its message names any AUD- ID registered at HEAD. That ID does not have to be the finding that removed the site, and does not have to exist in that commit's own tree. test.yml:56-57 claims more than this ("naming the finding that removed the site"). `git()` also runs with the caller's full environment (`GIT_*`, replace objects, user config), unlike the taxonomy gate's hardened `readGitEnv`.
**Fix:** Look up the cited finding in the judged commit's tree (`git cat-file -e <sha>:.planning/audit/findings/<id>.json`), as the taxonomy gate does. Reuse its `readGitEnv`.

### IN-25: Commit-taxonomy ID lookup checks only that a file exists

**Area:** CI gates and CI wiring (slice D, IN-D03)

**File:** `scripts/check-commit-taxonomy.ts:348-356`
**Issue:** Any blob at `.planning/audit/findings/<ID>.json` satisfies AC-41, including an empty file added by the same `behavior:` commit. The census's `findingRegistered` requires valid JSON with a matching `id`, so the two gates disagree on what "registered" means.
**Fix:** Read the blob (`cat-file --batch`) and require JSON whose `id` equals the cited ID.

### IN-26: `sourceGraph` misses some exports and dynamic imports, and resolves through `ts.sys`

**Area:** CI gates and CI wiring (slice D, IN-D04)

**File:** `test/helpers/sourceGraph.ts:69-84`, `:86-101`, `:104-108`
**Issue:** `exportedNames` ignores `export default function f`, `export * from`, `export =` and destructured `export const { a } = …`. `specifiers` ignores non-literal `import(x)`/`require(x)`, so `reachable` can miss an edge. Absence checks then pass with no evidence behind them: for example, `processLock.test.ts:267` calls `.every` on what could be an empty `modulesExporting` result. `resolveSpecifier` reads through `ts.sys` rather than the compiler host, despite the header's claim ("Every read goes through the compiler host").
**Fix:** Handle the missing export forms. Record non-literal loads as "unresolved edge" and have `reachable` callers fail on them. Make the absence checks first assert that the lookup is non-empty.

### IN-27: vi-mock specifier gate scans only `.ts/.mts/.cts` and ignores aliased `vi`

**Area:** CI gates and CI wiring (slice D, IN-D05)

**File:** `scripts/check-vi-mock-paths.ts:74`, `:158-185`, `:229`
**Issue:** `.js/.cjs/.mjs/.tsx` files under `test/` are not scanned. `const v = vi; v.mock('../moved')` is not seen. The real-path gate flags both, so the two "shared" gates disagree.
**Fix:** Use the real-path gate's extension set and its `vi-escape` detection here too.

### IN-28: CI Node is not pinned to the declared 22.16.0

**Area:** CI gates and CI wiring (slice D, IN-D06)

**File:** `.github/workflows/test.yml:19`, `:148`, `:162`, `:196`
**Issue:** Each script header says "requires Node 22.16.0" (D-21), but CI installs the latest `22`. The ABI-127 guard accepts every 22.x, so the measured timings and behavior are for a different patch release than CI runs.
**Fix:** Set `node-version: '22.16.0'`, or reword the guards and headers to "Node 22 (ABI 127)".

---

_Reviewed: 2026-11-13T00:36:08Z_
_Reviewer: Claude (gsd-code-reviewer, slice D)_
_Depth: deep_

### IN-29: The combined merge listing misses a change a merge makes by taking a non-first parent's version, undone by a later merge

**Area:** Recording pipeline, secret scan, seal verifier (slice E, IN-E01)

**File:** `.planning/audit/tools/seal-verify.ts:29-35, 649-657`
**Issue:** `--diff-merges=combined --name-only` lists only paths that differ from **every** parent. Example (commit-tree plumbing):
- M has parents (HEAD, P), where P is a pre-seal ancestor, and takes P's old `findings/X.json`.
- M2 has parents (M, sealed) and restores the sealed version.

Neither commit lists `X.json`, and the net diff is empty, so the intermediate state goes unreported. The header's claim that "a change made in the merge itself is still caught" is stronger than the code. The impact is small: the hidden content can only be a version already reachable from `sealed_sha`. Content from an orphan or in-range parent is listed through that parent's own commit.
**Fix:** For merges, also list `git diff --name-only <first-parent> <merge>` restricted to paths whose first-parent version differs, or use `--diff-merges=separate`, filtering out paths whose changed side is the pre-seal side. At least correct the header comment.

### IN-30: seal-verify's git calls are not hardened against replace refs or local log config; a requested scan with no scanner counts as clean

**Area:** Recording pipeline, secret scan, seal verifier (slice E, IN-E02)

**File:** `.planning/audit/tools/seal-verify.ts:136-142, 649-657, 795-799`
**Issue:**
- `readGitEnv` does not set `GIT_NO_REPLACE_OBJECTS=1`, which check-recordings-compared.ts:123 does set. Local `refs/replace/*` or grafts change the history `merge-base`, `diff` and `log` see.
- `git log --name-only` honors a user's `log.showRoot=false`, which hides an in-range root commit's files.
- In the exported `verifySeal`, `opts.scan: true` with no `scan_fn` uses `[]` (line 798): a scan was requested, none ran, and the result is VALID. The CLI always passes a `scan_fn`.

**Fix:** Set `GIT_NO_REPLACE_OBJECTS=1` and pass `-c log.showRoot=true`. Throw a `Refusal` when `opts.scan && !opts.scan_fn`.

### IN-31: The normalizer's global regexes and its Error and class handling can erase real differences in future recordings

**Area:** Recording pipeline, secret scan, seal verifier (slice E, IN-E03)

**File:** `test/realpath/harness/serializer.ts:111, 115, 132-138, 184-188`
**Issue:**
- `ETHERS_VERSION_RE` strips any `version=<digit>...` from every string (field values, URLs, messages), not only ethers error text.
- `FILE_LINE_RE` strips `:<digits>` after any `.js`/`.ts` token, for example `host.js:8545`.
- `normalizeError` keeps only name, code and message, and drops `cause`, `reason`, `shortMessage`, `data` and `info`. Two ethers errors that differ only in revert `data` serialize the same.
- A class instance without `toJSON` becomes `{"$class":"Name"}`, which erases all of its content.

None of this affects today's committed recordings (grep: no `$error` or `$class` in any recording), so the problem is latent.
**Fix:** Apply the version strip only inside ethers-shaped messages (a `(...code=X, version=...)` tail). Anchor `FILE_LINE_RE` to path-like tokens. Add `cause` (recursively), `shortMessage`, `reason` and `data` to `$error`. Fail, rather than mark `$class`, on a class instance inside op fields, so a new log shape is a deliberate choice.

---

_Reviewed: 2026-11-12_
_Reviewer: Claude (gsd-code-reviewer, slice E)_
_Depth: deep_

---

_Reviewed by five gsd-code-reviewer agents at deep depth; merged, renumbered and spot-checked by the orchestrator._
