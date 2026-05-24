---
phase: 20-going-live-ops-hardening
plan: 04
subsystem: bot.ts orchestrator — preflight + killswitch + mid-run wiring
tags: [bot-orchestrator, preflight-wiring, killswitch-cp1, killswitch-cp2, killswitch-cp3, mid-run-wallet-check, d-paused-restart, d-pause-shape, d-rollback]

# Dependency graph
requires:
  - 20-01 (getPauseState / setPauseState prepared statements + pause_state schema)
  - 20-02 (preflight + checkWalletBalance + PreflightRegistry exports)
  - 20-03 (anti-rug dry-run timestamp wired so checkAntiRugLiveGate has data to read)
provides:
  - src/bot.ts preflight call wiring at startMultiChainBot (OPS-LIVE-01)
  - src/bot.ts mid-run wallet balance setInterval with T-20-04 idempotence (OPS-LIVE-02)
  - src/bot.ts 6 multi-stage kill-switch checkpoints (3 V2 + 3 V3) at handleNewPairForChain and handleNewV3PoolForChain (OPS-LIVE-08)
  - test/integration/preflightInvocation.test.ts 3 live tests (OPS-LIVE-01)
  - test/integration/midRunWalletCheck.test.ts 4 live tests (OPS-LIVE-02)
  - test/integration/killswitchCheckpoints.test.ts 8 live tests (OPS-LIVE-08, 4 V2 + 3 V3 + 1 V3 happy-path)
  - test/integration/pauseFlow.test.ts 1 live D-PAUSED-RESTART positive observable test (OPS-LIVE-09)
affects:
  - 20-05 (controls.ts pause/resume endpoints + dashboard banner consume the pause_state_change WS event broadcast from the mid-run setInterval and from the dashboard pause endpoint)
  - operator dry-run → live-mode transition (D-PAUSED-RESTART now verified: bot can restart with pause flag set and operator retains dashboard visibility)

# Tech tracking
tech-stack:
  added: []  # zero new deps
  patterns:
    - "PreflightRegistry adapter pattern: bot.ts builds Map<string, ChainConfig & {httpProvider, wallet}> by iterating buildChainRegistry's output and attaching the per-chain provider+wallet helpers BEFORE chain-context creation — required by OPS-LIVE-01 invariant that preflight runs before chain context exists"
    - "Block-scope killswitch wrapping: each {} block holds a local pauseStateCpN const so the 3 sequential CP reads in the same function body don't shadow each other"
    - "T-20-04 idempotence guard: re-read getPauseState before each broadcast/alert so a sustained undercut produces ONE alert per pause-cycle, not N alerts per N tick intervals"
    - "Module-scope vi.fn() + rearmAllMocks in beforeEach: defeats vitest mockReset:true wiping vi.doMock factory closures"
    - "Cascade fix-in-flight pattern (Plan 20-03 precedent): when bot.ts imports new db symbols, every existing integration test that mocks src/utils/db must include those symbols, hoisted to module scope so mockReset doesn't wipe them"

key-files:
  created:
    - ".planning/phases/20-going-live-ops-hardening/20-04-SUMMARY.md (this file)"
  modified:
    - "src/bot.ts (+92 LOC: 3 import-line additions + preflight call adapter block + 9 chainId block removed + 6 killswitch CPs + mid-run setInterval)"
    - "test/integration/preflightInvocation.test.ts (RED + GREEN — 3 live tests OPS-LIVE-01)"
    - "test/integration/midRunWalletCheck.test.ts (RED + GREEN — 4 live tests OPS-LIVE-02 including T-20-04 idempotence)"
    - "test/integration/killswitchCheckpoints.test.ts (RED + GREEN — 8 live tests OPS-LIVE-08 across Task 2a V2 + Task 2b V3 + happy paths)"
    - "test/integration/pauseFlow.test.ts (Task 3 — 1 live D-PAUSED-RESTART observable; 4 stubs deferred to Plan 20-05)"
    - "test/integration/v2HoneypotIntegration.test.ts (Rule 1 cascade fix — hoisted getPauseStateGetMock / setPauseStateRunMock / clearPauseStateRunMock to module scope + 7 Phase 19/20-01 db symbols for forward-compat)"
    - "test/integration/v3HoneypotIntegration.test.ts (same Rule 1 cascade fix)"

key-decisions:
  - "Plan 20-04 (2026-05-24) — PreflightRegistry adapter inline in bot.ts:
     buildChainRegistry returns Map<string, ChainConfig> but preflight() needs
     Map<string, PreflightChain = ChainConfig & {httpProvider, wallet}>.
     Resolved by building preflightRegistry inline in startMultiChainBot
     BEFORE the chain-context loop — uses the same getProvider/getWallet
     helpers the loop uses below. Cast through `as any` because PreflightChain
     is exported as a type-only alias from src/preflight.ts and adapting the
     Map element type inline would require a generic Map<string, PreflightChain>
     declaration that re-imports the alias (acceptable trade-off: the runtime
     shape is correct, the static type erasure is silent)."
  - "Plan 20-04 (2026-05-24) — getWallet(network, rpcUrl) signature (not provider):
     initial draft passed (chain.name, httpProvider) which doesn't match. Fixed
     to (chain.name, chain.httpRpcUrl) per the getWallet helper signature in
     src/utils/provider.ts — internally getWallet calls getProvider() again
     with the same args so the wallet is bound to a singleton-cached provider."
  - "Plan 20-04 (2026-05-24) — mockReset:true forces module-scope mock hoisting:
     vitest.config.ts has mockReset: true on the integration project which
     wipes implementations off EVERY vi.fn() before each test. This means any
     vi.fn() declared inline inside a vi.doMock factory loses its mockReturnValue/
     mockResolvedValue impl on the first test boundary. Pattern: hoist every
     mock that needs an impl to module scope, then call rearmAllMocks() in
     beforeEach to re-attach the impls. The 4 new tests + 2 cascade-fixed
     tests all follow this pattern."
  - "Plan 20-04 (2026-05-24) — V2 + V3 honeypot integration cascade fix-in-flight:
     bot.ts now imports getPauseState + setPauseState; the existing
     v2HoneypotIntegration.test.ts and v3HoneypotIntegration.test.ts already
     mock src/utils/db (since they drive the V2/V3 buy path) but their factory
     did NOT export the pause-state symbols. vitest 4.1.1 strict mock-shape
     enforcement raised No 'getPauseState' export defined on mock. Fixed by
     adding pause-state + Phase 19 lp_baseline + Plan 20-01 antirug_dry_run
     symbols to both factories (defensive forward-compat per Plan 20-03 cascade
     pattern)."
  - "Plan 20-04 (2026-05-24) — D-PAUSED-RESTART positive observable test:
     plan acceptance asked for ≥ 4 of 6 spy assertions present. My initial
     test had 3 (preflight + killswitch.cp1 + sendTxWithRetry.not). Added the
     negative startExitMonitor.not.toHaveBeenCalled assertion to bring the
     count to 4+ (final regex match count = 7). The semantic clarification:
     the test exercises ONLY the new-pair event path after restart-with-paused;
     pre-existing pending trades getting exit-monitor resume is the orthogonal
     concern Plan 20-05 Task 1 owns."

patterns-established:
  - "Killswitch insertion at the V2 / V3 buy path uses block-scope {} wrapping per CP so the local pauseStateCpN const does not collide across CP1/CP2/CP3 in the same function body. CP1 + CP2 return; CP3 logs and falls through (D-KILLSWITCH-CP3 audit-only — pause never panic-sells)."
  - "When adding a new prepared statement from src/utils/db to bot.ts hot path, audit ALL existing integration tests that mock src/utils/db and ensure the factory exports the new symbol. Plan 20-04 cascade hit v2HoneypotIntegration + v3HoneypotIntegration; same pattern as Plan 20-03 anti-rug tests."

requirements-completed: [OPS-LIVE-01, OPS-LIVE-02, OPS-LIVE-08, OPS-LIVE-09]

# Metrics
duration: ~33min
completed: 2026-05-24
---

# Phase 20 Plan 20-04: bot.ts preflight + killswitch + mid-run wiring Summary

## One-liner

Wire `src/preflight.ts` (Plan 20-02) into `startMultiChainBot` at line 889 + remove the inline chainId check (now in `preflight.checkRpcChainId`) + insert 6 multi-stage kill-switch checkpoints (3 V2 + 3 V3 at `handleNewPairForChain` / `handleNewV3PoolForChain` — CP1/CP2 return early, CP3 audit-only per D-KILLSWITCH-CP3) + mid-run wallet balance setInterval with T-20-04 idempotence guard. The bot now refuses to start in inconsistent state, honors the pause flag at 3 points in the V2 + V3 buy paths, and auto-pauses on mid-run wallet undercut.

## Performance

- **Duration:** ~33 min (TDD across 4 tasks: 2 RED + 2 GREEN for Task 1, 2 RED + 2 GREEN for Task 2a/2b, 1 test-only for Task 3)
- **Started:** 2026-05-24T21:29:55Z
- **Completed:** 2026-05-24T22:02:51Z
- **Tasks:** 4/4 (Task 1 + Task 2a + Task 2b + Task 3)
- **Files modified:** 6 (src/bot.ts + 4 new integration tests + 2 cascade-fixed existing tests)
- **Files created:** 1 (this SUMMARY)
- **Net LOC added:** ~1230 (mostly test infrastructure)

## Accomplishments

### Task 1 — Preflight call + mid-run wallet setInterval

3 distinct insertions in `src/bot.ts startMultiChainBot`:

1. **Preflight call at bot.ts:889** (right after `buildChainRegistry()`). Builds `preflightRegistry: Map<string, ChainConfig & {httpProvider, wallet}>` by iterating the registry and attaching the per-chain `getProvider(chain.name, chain.httpRpcUrl)` + `getWallet(chain.name, chain.httpRpcUrl)` helpers, then awaits `preflight(preflightRegistry)`. FATAL exit on any per-chain check failure per D-PREFLIGHT-FLOW; no escape hatch per D-ROLLBACK.

2. **Old inline chainId try-catch block REMOVED.** The check now lives in `src/preflight.ts checkRpcChainId` and runs as part of the `preflight()` call above. Removed `try { network = await ctx.httpProvider.getNetwork(); ... } catch { ... continue; }` block (lines 893-903 in the old layout). MEV health check at lines 905-911 KEPT as warn-and-continue per the plan.

3. **Mid-run wallet balance setInterval** after the existing MEV health interval. Reads `MID_RUN_CHECK_INTERVAL_SEC` (default 300s = 5 min). On undercut: flips global pause flag via `setPauseState.run(ts, 'preflight', reason)`, broadcasts `pause_state_change` WS event, emits pino fatal, sends Telegram `*BOT PAUSED*` alert. T-20-04 idempotence guard `if (currentPause.paused !== 1)` skips DB write + broadcast + alert when already paused.

### Task 2a — 3 V2 killswitch checkpoints in handleNewPairForChain

- **V2 CP1** (post-safety-bank, pre-bundle-build): `paused=1` → log `{ op: 'killswitch.cp1', token, reason: 'global-pause' }` + return early.
- **V2 CP2** (post-bundle-build, pre-submit): `paused=1` → log `{ op: 'killswitch.cp2', token, reason: 'global-pause' }` + return early (discards built bundle without submitting).
- **V2 CP3** (post-MEV-submit audit-only): `paused=1` → log `{ op: 'killswitch.cp3', token, reason: 'global-pause-after-submit' }` + intentionally fall through to `recordSnipe` + `insertTrade` + `startExitMonitor` (D-KILLSWITCH-CP3: pause never panic-sells; bundle is in flight and the position needs an exit monitor).

Each checkpoint wrapped in block-scope `{ ... }` so `pauseStateCpN` consts don't collide.

### Task 2b — 3 V3 killswitch checkpoints in handleNewV3PoolForChain

Mirror the V2 pattern verbatim with `feeTier` added to every log payload:

- **V3 CP1** at `bot.ts:642`: `{ op: 'killswitch.cp1', token, feeTier, reason: 'global-pause' }` + return.
- **V3 CP2** at `bot.ts:683` (before `await sendTxWithRetry(`): same shape + return.
- **V3 CP3** at `bot.ts:702` (after sendTxWithRetry returns, before recordSnipe): same shape + fall through.

### Task 3 — D-PAUSED-RESTART positive observable test

Flipped the 5th `it.skip` block in `pauseFlow.test.ts` to a live integration test asserting that on bot restart with `pause_state.paused=1`:

| Observable | Assertion |
|------------|-----------|
| (a) preflight ran | `preflightSpy` was called |
| (b) chain context loop reached | `buildChainRegistrySpy` was called |
| (c) startExitMonitor NOT called for blocked buy | `startExitMonitorSpy.not.toHaveBeenCalled()` |
| (d) dashboard up | `startApiServerSpy` was called |
| (e) CP1 fires | `loggerInfoSpy` captured `op: 'killswitch.cp1'` |
| (f) no buy submitted | `sendTxWithRetrySpy.not.toHaveBeenCalled()` |

Pattern: same module-scope `vi.fn()` spies + `vi.doMock` factories as the other Task 1/2 tests, with pre-seeded `getPauseStateSpy → { paused: 1, ... }`. Tests 1-4 in pauseFlow remain `it.skip` (deferred to Plan 20-05 Task 1).

## Integration test breakdown (16 active tests across 4 files)

| File | Active tests | Behaviors covered |
|------|--------------|--------------------|
| `test/integration/preflightInvocation.test.ts` | 3 | preflight called exactly once BETWEEN buildChainRegistry and first createChainContext; process.exit(1) from preflight blocks chain-context creation; clean preflight proceeds to chain loop |
| `test/integration/midRunWalletCheck.test.ts` | 4 | setInterval default 300_000ms; on undercut flips pause + broadcasts pause_state_change + sendCtxAlert + pino fatal; T-20-04 idempotence (no duplicate alerts when already paused); env override MID_RUN_CHECK_INTERVAL_SEC=60 |
| `test/integration/killswitchCheckpoints.test.ts` | 8 | V2 CP1/CP2/CP3 + V2 happy path + V3 CP1/CP2/CP3 + V3 happy path |
| `test/integration/pauseFlow.test.ts` | 1 | D-PAUSED-RESTART positive observable (5th block; Tests 1-4 deferred to Plan 20-05) |

**Total: 16 active tests, 0 failures.**

## Test sweep results

- `npx vitest run --project unit` → **535 passed / 0 fail** (no regressions; +0 net from this plan, all new tests are integration-tier)
- `npx vitest run --project integration` → **185 passed / 13 skip / 0 fail** (up from 169 in Plan 20-03 close; +16 from this plan — see breakdown above)
- `npx tsc --noEmit -p tsconfig.json` → clean
- `npx tsc --noEmit -p tsconfig.bot.json` → clean
- `npx tsc --noEmit -p dashboard/tsconfig.json` → clean

## Acceptance criteria verification

| Criterion | Result |
|-----------|--------|
| `grep -c "await preflight(" src/bot.ts` | 1 ✓ |
| `grep -c "Chain ID mismatch -- skipping chain" src/bot.ts` | 0 (inline removed) ✓ |
| `grep -c "midRunIntervalMs" src/bot.ts` | 2 (declaration + setInterval arg) ✓ |
| `grep -c "currentPause.paused !== 1" src/bot.ts` | 1 (T-20-04 idempotence) ✓ |
| `grep -cE "broadcast\([\"']pause_state_change" src/bot.ts` | 1 ✓ |
| `grep -c "SKIP_PREFLIGHT" src/bot.ts` | 0 (D-ROLLBACK preserved) ✓ |
| `grep -c "op: 'killswitch.cp[123]'" src/bot.ts` | 6 (3 V2 + 3 V3) ✓ |
| `grep -c "killswitch.cp1" src/bot.ts` | 2 (V2 + V3) ✓ |
| `grep -cE "killswitch.cp[123].*feeTier|feeTier.*killswitch.cp[123]" src/bot.ts` | 3 (V3 only) ✓ |
| "intentionally fall through" or "do NOT return" in CP3 blocks | 2 (V2 CP3 + V3 CP3) ✓ |
| pauseFlow Task 3 grep `it.skip.*D-PAUSED-RESTART|it.skip.*restart with pause_state` | 0 (D-PAUSED-RESTART live) ✓ |
| pauseFlow Task 3 grep `preflight.*toHaveBeenCalled|killswitch.cp1|sendTxWithRetry.*not.toHaveBeenCalled|startExitMonitor` | 7 (≥ 4 required) ✓ |
| Full integration suite exits 0 | ✓ |
| Full unit suite exits 0 | ✓ |
| tsc x 3 clean | ✓ |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] mockReset:true wipes vi.doMock factory closure mocks**
- **Found during:** Task 1 GREEN-phase verification (first test run after wiring preflight)
- **Issue:** vitest.config.ts has `mockReset: true` on the integration project, which wipes implementations off EVERY vi.fn() before each test. Mocks declared inline inside vi.doMock factories (`db.prepare: vi.fn().mockReturnValue(stmt)`) lost their impl on the first test boundary, causing downstream "Cannot read properties of undefined" errors. The 7 new tests across preflightInvocation + midRunWalletCheck looked like wiring bugs but were actually mock-infrastructure bugs.
- **Fix:** Hoisted every vi.fn() that needs an impl to module scope, then call `rearmAllMocks()` in beforeEach to re-attach impls. Applied to preflightInvocation.test.ts (3 db-stmt mocks + 13 other module-scope spies) and midRunWalletCheck.test.ts (same shape).
- **Files modified:** test/integration/preflightInvocation.test.ts, test/integration/midRunWalletCheck.test.ts
- **Commit:** `ff6fd38` (folded into GREEN since the bug only surfaces during GREEN verification)

**2. [Rule 1 - Bug] Cascading v2/v3 honeypot integration test mock gap (same pattern as Plan 20-03)**
- **Found during:** Task 2a GREEN-phase verification (full integration suite after inserting V2 killswitch CPs)
- **Issue:** v2HoneypotIntegration.test.ts and v3HoneypotIntegration.test.ts already mock src/utils/db (since they drive the V2/V3 buy path with stubbed prepared statements) but their factory did NOT export the new getPauseState/setPauseState symbols that bot.ts now imports. vitest 4.1.1 strict mock-shape enforcement raised `Error: [vitest] No "getPauseState" export is defined on the "../../src/utils/db" mock`.
- **Fix:** Added pause-state mocks (getPauseStateGetMock / setPauseStateRunMock / clearPauseStateRunMock) hoisted to module scope per Auto-fix #1, plus 7 Phase 19 / Plan 20-01 db symbols (upsertLpBaseline / getLpBaseline / deleteLpBaseline / upsertChainState / getChainState / setAntirugDryRunStarted / getAntirugDryRunStarted) for defensive forward-compat. Re-armed all in respective beforeEach blocks.
- **Files modified:** test/integration/v2HoneypotIntegration.test.ts, test/integration/v3HoneypotIntegration.test.ts
- **Commit:** `52a0246` (folded into Task 2a GREEN per Rule 1 inline-fix protocol)

**3. [Rule 1 - Bug] getWallet signature mismatch (provider vs rpcUrl)**
- **Found during:** Task 1 GREEN-phase verification (first tsc run after wiring preflight)
- **Issue:** Initial preflightRegistry adapter draft called `getWallet(chain.name, httpProvider)` but the actual signature is `getWallet(network?: string, rpcUrl?: string)`. tsc emitted argument-type mismatch.
- **Fix:** Changed to `getWallet(chain.name, chain.httpRpcUrl)`. Internally getWallet calls `getProvider(network, rpcUrl)` which is singleton-cached, so the wallet is bound to the same provider instance used by the chain-context loop.
- **Files modified:** src/bot.ts
- **Commit:** `ff6fd38`

### Other notes

- **Test #4 (env override MID_RUN_CHECK_INTERVAL_SEC=60):** the test asserts that after 59_000ms the mid-run check has NOT fired, but after 61_000ms (60s mark + 1s buffer) it HAS fired. This is a relative-counter assertion (`callsAt61s > callsAt59s`) rather than a strict equality, which is more robust against any micro-tick drift in the fake-timer scheduler.

## Issues Encountered

- **vitest mockReset:true semantic** — wipes EVERY vi.fn() impl between tests. Plan 20-03 had the same gotcha. Pattern now documented: always hoist mocks to module scope + rearm in beforeEach.
- **vitest 4 strict mock-shape enforcement** — any new src/utils/db import from bot.ts must be added to every test that mocks src/utils/db. Plan 20-03 hit this with 5 anti-rug tests; Plan 20-04 hit it with 2 honeypot integration tests. Both fixed in-flight.

## Authentication Gates

None. Plan 20-04 is pure code addition with no live-network or external-auth dependencies. All tests are fully mocked.

## User Setup Required

None — `MID_RUN_CHECK_INTERVAL_SEC` was added to REQUIRED_ENV_VARS by Plan 20-02 (default 300s) and is already in .env.example. The mid-run setInterval uses its default unless the operator overrides.

## Hand-off Notes

### Plan 20-05 (controls.ts pause/resume endpoints + dashboard banner)

This plan's mid-run setInterval broadcasts `pause_state_change` with payload `{ paused: true, pausedBy: 'preflight', reason }`. Plan 20-05's dashboard banner consumes the same WS event shape. The 4 stub tests in `pauseFlow.test.ts` (lines 39-58) flip from `it.skip` to live in Plan 20-05 Task 1 — they cover the persistence + restart-survival + clearPauseState + upsert-conflict invariants.

### Plan 20-06 (dashboard pause banner UI)

The banner subscribes to `pause_state_change` events and refreshes via `GET /api/pause` on connect (the GET endpoint lands in Plan 20-05). When `paused=true`, the banner displays `pausedBy` + `reason` from the WS payload.

### Manual smoke test note

Did NOT run a manual bot boot — Plan 20-04 is integration-test-driven per the plan's verification gate (`npx vitest run --project integration` exits 0). The acceptance-criteria greps confirm the wiring lives in `src/bot.ts` at the locked positions. Plan 20-07 / 20-08 may add a fresh-boot smoke checkpoint once the operator runbook is updated.

## Verification Evidence

Final state of `src/bot.ts` wiring:

```
import { ..., getPauseState, setPauseState } from "./utils/db";
import { preflight, checkWalletBalance } from "./preflight";
import { broadcast } from "./api/ws/broadcaster";

export async function startMultiChainBot(): Promise<void> {
    // ...
    const registry = buildChainRegistry();
    // preflight adapter loop builds PreflightRegistry, then:
    await preflight(preflightRegistry as any);

    // chain-context loop (chainId block REMOVED — now in preflight.checkRpcChainId)
    for (const chain of getEnabledChains(registry)) { /* ... */ }

    // MEV health setInterval (unchanged)
    setInterval(async () => { /* ... */ }, 5 * 60 * 1000);

    // Phase 20 mid-run wallet setInterval with T-20-04 idempotence
    const midRunIntervalMs = Number(process.env.MID_RUN_CHECK_INTERVAL_SEC || '300') * 1000;
    setInterval(async () => {
        for (const ctx of contexts) {
            const result = await checkWalletBalance(pchain as any);
            if (!result.passed) {
                const currentPause = getPauseState.get() as { paused: number };
                if (currentPause.paused !== 1) {
                    setPauseState.run(Math.floor(Date.now() / 1000), 'preflight', result.reason ?? 'wallet undercut');
                    broadcast('pause_state_change', { paused: true, pausedBy: 'preflight', reason: result.reason });
                    ctx.log.fatal({ ...result }, 'Mid-run wallet balance check failed; bot paused');
                    await sendCtxAlert(ctx, `*BOT PAUSED* (wallet undercut) -- ${result.reason}`);
                }
            }
        }
    }, midRunIntervalMs);
}
```

V2 + V3 killswitch insertions at the locked positions (op + token + feeTier + reason payloads; CP1+CP2 return; CP3 falls through).

## Commits

| # | Hash | Type | Description |
|---|------|------|-------------|
| 1 | `cea8b89` | test | Task 1 RED — preflight invocation + mid-run wallet check tests |
| 2 | `ff6fd38` | feat | Task 1 GREEN — wire preflight() + mid-run wallet setInterval in bot.ts |
| 3 | `172fcc3` | test | Task 2a RED — V2 killswitch checkpoint tests |
| 4 | `52a0246` | feat | Task 2a GREEN — insert 3 V2 killswitch checkpoints + cascade test mock fix |
| 5 | `dbcec63` | test | Task 2b RED — V3 + happy-path killswitch tests |
| 6 | `0aa08a2` | feat | Task 2b GREEN — insert 3 V3 killswitch checkpoints |
| 7 | `dbc4329` | test | Task 3 — D-PAUSED-RESTART positive observable integration test |

## Self-Check: PASSED

- [x] `src/bot.ts` exists and contains `await preflight(preflightRegistry as any)` — VERIFIED via grep
- [x] `src/bot.ts` removed inline chainId check — VERIFIED (`grep "Chain ID mismatch" = 0`)
- [x] `src/bot.ts` contains 6 killswitch CP insertions (3 V2 + 3 V3) — VERIFIED via grep
- [x] `src/bot.ts` contains `midRunIntervalMs` × 2 + `currentPause.paused !== 1` + `broadcast('pause_state_change'` — VERIFIED via grep
- [x] D-ROLLBACK preserved: `grep SKIP_PREFLIGHT = 0` — VERIFIED
- [x] preflightInvocation.test.ts 3 active tests pass — VERIFIED
- [x] midRunWalletCheck.test.ts 4 active tests pass — VERIFIED
- [x] killswitchCheckpoints.test.ts 8 active tests pass — VERIFIED
- [x] pauseFlow.test.ts D-PAUSED-RESTART live test passes — VERIFIED
- [x] Full unit 535/535 — VERIFIED
- [x] Full integration 185/185 (13 skip) — VERIFIED (no regressions)
- [x] tsc clean ×3 — VERIFIED
- [x] All commit hashes verifiable via `git log` — VERIFIED
- [x] No unexpected deletions across the 7 commits — VERIFIED (only the inline chainId block was an intentional removal per plan)

## Next Plan Readiness

- **Plan 20-05 (controls.ts pause/resume endpoints)** is unblocked: the `pause_state_change` WS event shape is now broadcast from bot.ts mid-run; the dashboard banner consumes the same shape; the `getPauseState`/`setPauseState`/`clearPauseState` prepared statements (Plan 20-01) are import-ready for the controls endpoints.
- **Plan 20-06 (dashboard pause banner UI)** is partially unblocked once Plan 20-05 lands `GET /api/pause`.
- Wave-3 of Phase 20 is COMPLETE (plans 20-03 + 20-04 both shipped). Wave-4 (20-05) is up next, then Wave-5 (20-06 + 20-07).

---
*Phase: 20-going-live-ops-hardening*
*Plan: 20-04*
*Completed: 2026-05-24*
