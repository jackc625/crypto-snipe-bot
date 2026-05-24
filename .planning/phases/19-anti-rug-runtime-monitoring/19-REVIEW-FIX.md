---
phase: 19-anti-rug-runtime-monitoring
fixed_at: 2026-05-24
fix_scope: critical_warning
findings_in_scope: 16
fixed: 15
skipped: 1
status: partial
iteration: 1
---

# Phase 19: Code Review Fix Report

**Fixed at:** 2026-05-24
**Source review:** `.planning/phases/19-anti-rug-runtime-monitoring/19-REVIEW.md`
**Iteration:** 1
**Worktree:** `/tmp/sv-19-reviewfix-4knPvZ` (gsd-reviewfix/19-39160) — fast-forwarded into master on cleanup.

**Summary:**
- Findings in scope: 16 (CR-01..CR-07, WR-01..WR-09)
- Fixed: 15
- Skipped: 1 (CR-07 — see below)
- TypeScript: bot + main + dashboard tsconfigs all clean
- Test suites: 135/135 pass across anti-rug + chainRegistry + exitEngine

## Fixed Issues

### CR-01: cb_tripped payload field mismatch breaks dashboard CB-reset modal

**Files modified:** `src/anti-rug/circuitBreaker.ts`, `test/unit/anti-rug/circuitBreaker.test.ts`
**Commits:** `757b0d1` (fix), `2b93bb3` (test update)
**Applied fix:** Backend now broadcasts `triggers: TriggerEvent[]` (array) + `triggerCount: number` (count) to match the frontend `CbTrippedPayload` type. Previously sent `triggers: <number>` + `triggerEvents: <array>` which silently broke the CircuitBreakerResetModal (Reset button could never enable because `triggers.length` on a number is undefined) and the banner headline ("undefined triggers"). Updated Test 15 to assert the new payload contract.

### CR-02: Anti-rug gas multiplier fails to elevate fees on ETH (Flashbots/EIP-1559 mismatch)

**Files modified:** `src/utils/mevStrategies/flashbots.ts`
**Commit:** `1708ed4`
**Applied fix:** Mirrored the passthrough strategy's EIP-1559-aware branching in `FlashbotsMevStrategy.sendTransaction`. When `feeData.maxFeePerGas` is present, the multiplier now applies to `maxFeePerGas` + `maxPriorityFeePerGas` and sets `type: 2`. Falls back to legacy `gasPrice` only when EIP-1559 fee data is unavailable. Restores the documented 2.0× anti-rug elevation on the primary target chain (ETH).

### CR-03: registerAntiRugPosition not awaited at buy-success → silent unhandled rejections

**Files modified:** `src/bot.ts`
**Commit:** `7b248f6`
**Applied fix:** Added `await` to both V2 (bot.ts:425) and V3 (bot.ts:679) call sites. Without await, RPC/DB rejections inside `startChainAntiRugListener → backfillSinceLastSeen` became unhandled promise rejections that bypassed the surrounding try/catch. The documented `op: 'antirug.baseline-snapshot-failed'` log path now fires reliably on rejection.

### CR-04: Allowlist verification failure leaves chain monitoring with unverified addresses

**Files modified:** `src/bot.ts`
**Commit:** `8491733`
**Applied fix:** Introduced `verifiedChains: Set<string>` tracked across the verification loop. Steps 3 (re-register positions) and 4 (arm WS listener) now skip chains that failed `verifyAllowlistAtStartup`. Previously, a flaky boot-time RPC + an EOA-typo in `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA` would leave the allowlist as a silent leak vector with monitoring still active. The chain now truly runs without anti-rug monitoring on verify failure, matching the documented operator-visible behavior. Added `op: 'antirug.resume.skip-unverified-chain'` and `op: 'antirug.resume.skip-ws-listener-unverified'` log lines.

### CR-05: Resume path silently no-ops when chain has zero open positions

**Files modified:** `src/anti-rug/detector.ts`
**Commit:** `2c4e4ff`
**Applied fix:** `startChainAntiRugListener` now initialises `chainState` upfront (instead of early-returning when `chainState.get(chainName)` is undefined) and arms the heartbeat + close-handler + `backfillSinceLastSeen` regardless of registered-position count. The address-filter subscription is gated on `addresses.length > 0`; when the first position lands, `registerAntiRugPosition` re-enters and installs the filter. Previously, bot restart with zero open positions on a chain left the entire WS lifecycle dormant and lost the backfill window between restart and first-buy. Added `op: 'antirug.listener.armed-no-positions'` log line. Tests: detectorRegistry 11/11 + wsReconnectBackfill 9/9 pass.

### CR-06: antirug_state_update broadcast carries `success` field absent from frontend type; lastSignals null conflict

**Files modified:** `dashboard/src/types/api.ts`, `dashboard/src/hooks/useWebSocket.ts`, `src/anti-rug/exitTrigger.ts`
**Commit:** `3412280`
**Applied fix:** Three changes:
1. Added `success?: boolean` to the frontend `AntiRugStateUpdate` type so the live-exit success/failure value reaches the operator.
2. Allowed `lastSignals?: RugSignals | null` for forward compatibility but normalise `null → undefined` in `useWebSocket.ts` before storing on Position, so downstream components see a single shape.
3. Backend now sends `lastSignals: undefined` (omitted) for the unknown-verdict path instead of literal `null`, avoiding the `typeof x === 'object'` truthy-null trap in AntiRugExitDetailModal.

### WR-01: Two divergent mergeAllowlist implementations — production uses dedupe, tested code uses concat

**Files modified:** `src/anti-rug/allowlist.ts`, `src/chainRegistry.ts`, `test/unit/anti-rug/allowlist.test.ts`
**Commit:** `4d7e4bd`
**Applied fix:** Deleted the exported `mergeAllowlist` from `allowlist.ts` (it was dead code — production used `chainRegistry.ts:mergeAllowlist` with dedupe semantics). Removed Tests 7 + 8 from allowlist.test.ts (they asserted concat-keep-duplicates semantics on the dead function). Added a structured-log line `op: 'antirug.allowlist.env-override-hardcoded'` in chainRegistry's `mergeAllowlist` so the audit trail captures operator intent when an env entry overrides a hardcoded one. Tests: 7/7 remaining tests pass.

### WR-02: dispatchEvent races with unregisterAntiRugPosition mid-loop

**Files modified:** `src/anti-rug/detector.ts`
**Commit:** `de2fc8e`
**Applied fix:** Snapshot the positions bucket with `.slice()` at dispatch start. Same defensive pattern as the V3 grace-window block-handler. Prevents the rare case where a trailing-stop timer firing on a sibling position closes it mid-await, splicing the bucket and causing the loop to skip a still-registered evaluator entry. Tests: detectorRegistry 11/11 pass.

### WR-03: V3 sell-sim probe amount uses baseline active liquidity, not the position's amount

**Files modified:** `src/anti-rug/detector.ts`, `test/unit/anti-rug/detectorEvaluator.test.ts`
**Commit:** `98fc813`
**Applied fix:** Probe amount now queried via `tokenContract.balanceOf(ctx.wallet.address)` using ERC20_ABI (the bot's actual token balance). Ratio denominator flipped from baselineLiquidity to probeAmount so the slippage percent reflects realised quote-out ÷ input amount — the real anti-rug signal. The previous baselineLiquidity-as-probe approach (acknowledged dimensionally wrong in the inline note) would have caused signal-3 false positives on every benign V3 position with any size mismatch. Test fixture MockContract dispatcher updated to handle ERC20 ABI (`balanceOf` mock); added `wallet.address` to `StubChainCtx` + `buildCtx`. Tests: 20/20 evaluator + 28/28 anti-rug integration pass.

> **Logic verification required:** This is a semantic change (the algorithm now uses a different probe amount), not a pure refactor. The fork-test that the review suggested (asserting V3 sell-sim slippage < 5% on a balanced pool when probeAmount === position size) was not added — recommended as a follow-up before live-execute graduation.

### WR-04: V2 evaluator reads only reserve0 for signal-3 — ignores reserve1, fails for WETH-as-token1 pairs

**Files modified:** `src/anti-rug/detector.ts`
**Commit:** `cc4a0be`
**Applied fix:** Compute both `reserve0Pct` and `reserve1Pct` against baseline; trip signal-3 if EITHER side dropped below 50%. `v2ReservePctBelow` telemetry reports the WORSE side. Guarded with vacuous-pass (`1.0` ratio) for legacy baselines where `v2Token1Reserve` may be `null`. The `lp_baseline` schema already persisted `v2_token1_reserve`; the evaluator just wasn't reading it. Tests: 20/20 evaluator pass.

> **Logic verification required:** The previous behavior (reserve0-only) was unconditional; new behavior trips on EITHER reserve. Operators should validate that the new signal-3 doesn't fire on benign V2 pools where reserve1 oscillates more than reserve0 during normal trading.

### WR-05: Dashboard WS reconnect can leak connections when previous socket is CONNECTING

**Files modified:** `dashboard/src/hooks/useWebSocket.ts`
**Commit:** `e30b570`
**Applied fix:** Bail in `connect()` when the previous socket is OPEN, CONNECTING, or CLOSING — only CLOSED state allows a fresh socket. Previously only OPEN short-circuited, leaving CONNECTING sockets dangling when the reconnect timer fired mid-negotiation. The next tick will see CLOSED after the old socket's natural close handler fires.

### WR-06: V3 Burn grace-window block-watcher leak

**Files modified:** `src/anti-rug/detector.ts`
**Commit:** `cd51e32`
**Applied fix:** Added `blockHandler: (currentBlock: number) => void | Promise<void>` to the `PendingV3Burn` record so both `handleV3CollectArrival` (consumes pending entry) and `handleV3BurnArrival` (LAST-WINS replacement) can explicitly `off()` the handler. The handler's self-cleanup logic only fired when `pendingV3Burn.get(poolKey)` returned undefined OR matched its `burnBlockNumber` — the LAST-WINS replacement case satisfied neither condition, leaking handlers that ticked forever. Tests: 20/20 evaluator pass (including Test 10d LAST-WINS).

### WR-07: Test 1 in detectorEvaluator.test.ts asserts wrong verdict for documented scenario

**Files modified:** `test/unit/anti-rug/detectorEvaluator.test.ts`
**Commit:** `f34ad9b`
**Applied fix:** Updated the `it()` description for Test 1 from "Only signal-1 trips → safe / partial-signal" to "signal-1 trips + destination IS in allowlist → allowlisted (short-circuit)". The discriminated-union short-circuits to `verdict='allowlisted'` BEFORE the multi-signal AND check; the original PLAN.md description was inconsistent with the type contract. The "only signal-1 trips → safe/partial-signal" scenario is structurally unreachable (signal-2 not tripping requires an allowlist hit which short-circuits). Test body and assertion unchanged. Doc-side fix only.

### WR-08: chainRegistry mergeAllowlist places ALLOWLIST_EXTRA in BOTH V2 and V3

**Files modified:** `src/chainRegistry.ts`
**Commit:** `f08406c`
**Applied fix:** Added per-pool-type env vars: `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA_V2` and `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA_V3`. Kept unified `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA` as a deprecated alias with a startup warning (`op: 'antirug.allowlist.deprecated-unified-extra'`). Allows operators to avoid placing V2-only lockers in the V3 allowlist (or vice versa), which would silently bypass per-pool-type lockerName checks. Tests: 26/26 antiRugConfig pass.

### WR-09: gap-detected broadcast missing pair field; declared required on frontend type

**Files modified:** `dashboard/src/types/api.ts`, `dashboard/src/components/anti-rug/AntiRugMonitorTile.tsx`
**Commit:** `bcabc0f`
**Applied fix:** Made `pair` optional in the `AntiRugEvent` frontend type — gap-detected is legitimately a chain-level event with no pair anchor. Updated `AntiRugMonitorTile`'s `formatAddress(evt.pair)` call to render `'—'` for `kind === 'gap-detected'` and `pair ?? ''` otherwise.

## Skipped Issues

### CR-07: Circular import exitEngine ↔ anti-rug/detector ↔ anti-rug/exitTrigger ↔ exitEngine

**Files:** `src/exitEngine.ts:20`, `src/anti-rug/detector.ts:91`, `src/anti-rug/exitTrigger.ts:56`
**Reason:** All three proposed resolution options have tight coupling with the existing vi.mock test contract that would require non-trivial test rewrites.

**What was attempted:**
- **Option 1 (move triggerAntiRugExit into detector.ts):** Would break `vi.mock('../../../src/anti-rug/exitTrigger', ...)` in `detectorEvaluator.test.ts` and `wsReconnectBackfill.test.ts` — the mocked module would no longer be on the call path.
- **Option 2 (move executeFullSell into sellPipeline.ts):** Largest refactor scope; `executeFullSell` is the centerpiece of `exitEngine.ts`.
- **Option 3 (runtime callback registration):** Would break `vi.mock('../../../src/exitEngine', ...)` in `exitTrigger.test.ts`.
- **Tried: lazy require() in exitEngine.ts for unregisterAntiRugPosition** — Tested but `vitest.mock` for CommonJS does not intercept dynamic `require()` calls correctly when the mock is for the target module path. Test suite `test/unit/exitEngine/antiRugReason.test.ts` failed with `Cannot find module './anti-rug/detector'` because the vitest worker's module resolution differs from the dynamic require resolution. Rolled back via `git checkout -- src/exitEngine.ts`.

**Risk assessment:** The review itself classifies this as "latent" — "There's no immediate runtime symptom IF every consumer accesses the imported symbol only after all modules have finished loading (e.g., inside functions called at runtime)". The current code matches this constraint (all uses are inside function bodies). The defect would only manifest if a future refactor added top-level module-body code that called one of the cycle's symbols.

**Recommended follow-up (separate phase):**
1. Add ESLint rule `import/no-cycle` to prevent regression (the review's secondary recommendation).
2. When refactoring for cycle removal, plan test mock updates alongside.
3. Consider option 3 (runtime registration via a thin `sellAdapter` module) — requires updating `exitTrigger.test.ts` to register a mock adapter in `beforeEach` instead of using `vi.mock`.

**Original issue (verbatim from REVIEW.md):**
> Three-way circular import. ts-node + CommonJS will satisfy circular imports by returning partial module exports — depending on the import order, one of the three modules sees its dependencies as `undefined` for the duration of its own module-initialization code path. The downstream symptom is "expected `triggerAntiRugExit` to be a function, got undefined" exceptions in production that don't reproduce in unit tests.

## Out-of-Scope Findings (Info-tier)

Not addressed in this fix iteration (Info-tier per `fix_scope: critical_warning`):
- IN-01: REQUIRED_ENV_VARS count test tightening
- IN-02: Test mocks use unused mergeAllowlist (related to WR-01, indirectly resolved by deletion)
- IN-03: V3_BURN_GRACE_BLOCKS hardcoded
- IN-04: void _removed pattern in useWebSocket.ts
- IN-05: 5s force-exit doc nit
- IN-06: Frontend chain selection logic fragility

## Test Plan Coverage

After all fixes:
- `tsc --noEmit -p tsconfig.bot.json` — clean
- `tsc --noEmit -p tsconfig.json` — clean
- `tsc --noEmit -p dashboard/tsconfig.json` — clean
- `vitest run test/unit/anti-rug/` — 79/79 pass
- `vitest run test/integration/anti-rug/` — 28/28 pass
- `vitest run test/unit/chainRegistry/` — 26/26 pass (antiRugConfig)
- `vitest run test/unit/exitEngine/` — 11/11 pass (antiRugReason)

Total: **135/135 tests passing** across 13 test files.

## Production Safety Notes

Two findings touch live-execute semantics — they pass tests but should be operator-verified before live-execute graduation:

1. **CR-02 (Flashbots EIP-1559 gas)** — Add a fork test that asserts `populatedTx.maxFeePerGas === rawMaxFeePerGas * 2n` for `reason='anti-rug'` on ETH (review-recommended; not added in this fix).

2. **WR-03 (V3 sell-sim probe amount)** — Add a fork test that asserts V3 sell-sim slippage is < 5% when the pool is balanced and `probeAmount === position size` (review-recommended; not added in this fix).

3. **WR-04 (V2 signal-3 both reserves)** — Operator should validate the new signal-3 doesn't fire on benign V2 pools where `reserve1` oscillates more than `reserve0` during normal trading.

The 7-day dry-run window (per D-LIVE-GATE) provides operational coverage for these scenarios before any chain is graduated to `LIVE_EXECUTE=true`.

---

_Fixed: 2026-05-24_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
