---
phase: 19-anti-rug-runtime-monitoring
reviewed: 2026-05-24
depth: deep
iteration: 2
predecessor: 19-REVIEW.iter1.md
files_reviewed: 31
files_reviewed_list:
  - dashboard/src/components/PositionTable.tsx
  - dashboard/src/components/anti-rug/AntiRugMonitorTile.tsx
  - dashboard/src/hooks/WebSocketContext.tsx
  - dashboard/src/hooks/useWebSocket.ts
  - dashboard/src/pages/Overview.tsx
  - dashboard/src/types/api.ts
  - docs/operations/anti-rug-rollout.md
  - docs/operations/anti-rug-tuning.md
  - src/anti-rug/allowlist.ts
  - src/anti-rug/circuitBreaker.ts
  - src/anti-rug/detector.ts
  - src/anti-rug/events.ts
  - src/anti-rug/exitTrigger.ts
  - src/anti-rug/lpBaseline.ts
  - src/anti-rug/types.ts
  - src/api/server.ts
  - src/bot.ts
  - src/chainRegistry.ts
  - src/config.ts
  - src/exitEngine.ts
  - src/utils/db.ts
  - src/utils/mevStrategies/flashbots.ts
  - test/integration/anti-rug/wsReconnectBackfill.test.ts
  - test/unit/anti-rug/allowlist.test.ts
  - test/unit/anti-rug/circuitBreaker.test.ts
  - test/unit/anti-rug/detectorEvaluator.test.ts
  - test/unit/anti-rug/detectorRegistry.test.ts
  - test/unit/anti-rug/lpBaseline.test.ts
  - test/unit/anti-rug/types.test.ts
  - test/unit/chainRegistry/antiRugConfig.test.ts
  - test/unit/db/lpBaselineMigration.test.ts
findings:
  critical: 0
  warning: 2
  info: 6
  total: 8
closure:
  closed: 14
  partially_closed: 2
  not_closed: 1
  regressed: 0
status: needs_followup
---

# Phase 19: Code Review Report (Iteration 2 — Goal-Backward Closure Verification)

**Reviewed:** 2026-05-24
**Depth:** deep
**Iteration:** 2 (re-review of fixes applied in commits `757b0d1..bcabc0f` + test update `2b93bb3`)
**Status:** needs_followup

## Stop-the-Line Gates

All three gates pass:

- `tsc --noEmit -p tsconfig.bot.json` — clean
- `tsc --noEmit -p tsconfig.json` — clean
- `tsc --noEmit -p dashboard/tsconfig.json` — clean
- `vitest run test/unit/anti-rug/` — 73/73 pass (8 files)
- `vitest run test/integration/anti-rug/ test/unit/chainRegistry/ test/unit/exitEngine/ test/unit/db/lpBaselineMigration.test.ts` — 74/74 pass (6 files)
- Total iter-2 verified: **147/147 tests passing**, no test that previously passed now fails

No type-check regression, no test regression, no silent semantic change in live-execute behavior beyond what `19-REVIEW-FIX.md` documents.

## Summary

Iteration 1 surfaced 7 Critical + 9 Warning + 6 Info findings. The fix iteration (commits `757b0d1..bcabc0f`) addressed 15 of the 16 Critical+Warning items (CR-07 explicitly skipped). Independent re-verification:

- **14 findings CLOSED outright.** The fixes match the review recommendations at the cited file:line and the original defect is gone.
- **2 findings PARTIALLY CLOSED.** WR-08 (per-pool-type env vars) was applied in `src/chainRegistry.ts` but the new env vars were NOT added to `src/config.ts:REQUIRED_ENV_VARS` nor to `.env.example` nor to the operator docs. CR-06 (`success` on `AntiRugStateUpdate`) added the field to the type contract and the wire payload but no UI component consumes it; the operator cannot tell from the dashboard whether a live `executeFullSell` returned true/false.
- **1 finding NOT CLOSED.** CR-07 circular import (`exitEngine ↔ detector ↔ exitTrigger`) remains. Fix report documents the skip with reasoning — vitest mock cache conflicts with all three resolution paths. The cycle is still entirely at function-body boundaries, so no runtime symptom yet; remains latent.
- **0 finding REGRESSED.**
- **All 6 Info findings carry over** (out of fix scope per `fix_scope: critical_warning`).

Two NEW findings introduced by the fixes themselves (both Warning-tier, neither blocks shipping but should be closed before live-execute graduation):
- **WR-08-FOLLOWUP**: the per-pool-type allowlist env vars are not registered in `REQUIRED_ENV_VARS` nor documented in `.env.example`, leaving them as undocumented "shadow" env vars only mentioned in chainRegistry source.
- **CR-06-FOLLOWUP**: `success` field is broadcast but not surfaced in any dashboard component; operator visibility gap on live exit success/failure remains.

End-to-end traces verified:
- `cb_tripped` from `circuitBreaker.ts:147-152` → WS broadcaster → `useWebSocket.ts:189-198` → `Overview.tsx:117-122` → `CircuitBreakerResetModal.tsx:50` — field names align (`triggers: TriggerEvent[]` + `triggerCount: number`); Reset button can now enable.
- `antirug_state_update` for both `would-have-sold` and `exit-fired` outcomes — schemas match; `lastSignals: null` is normalized to `undefined` at the consumer in `useWebSocket.ts:144`; backend `exitTrigger.ts:194,258` correctly sends `undefined` instead of literal `null`.
- `gap-detected` from `detector.ts:1049-1056` → `AntiRugMonitorTile.tsx:91` (`pair` field now optional and guarded with `evt.kind === 'gap-detected' ? '—' : formatAddress(evt.pair ?? '')`).
- EIP-1559 anti-rug flow on ETH: `detector → scheduleConfirmBlocksGate → triggerAntiRugExit → executeFullSell → sendTxWithRetry(ctx, gasMultiplier=ctx.chain.antiRug.gasMultiplier) → FlashbotsMevStrategy.sendTransaction(gasMultiplier=2.0)` correctly applies the multiplier to `maxFeePerGas` + `maxPriorityFeePerGas` and sets `type: 2` on ETH (since `feeData.maxFeePerGas` is present). No double-application detected — `executeFullSell → sendTxWithRetry` does not pre-elevate; the multiplier is applied exactly once inside the strategy. BSC's bloxroute strategy correctly stays on legacy `gasPrice` (matches BSC's `gas.type === 'legacy'`).

## Closure Status

| Finding | File:Line | Verdict | Notes |
|---------|-----------|---------|-------|
| CR-01: cb_tripped field mismatch | `src/anti-rug/circuitBreaker.ts:147-152` | **CLOSED** | `broadcast('cb_tripped', { chain, triggers: events.slice(), windowHours, triggerCount: recent.length })`. Modal at `CircuitBreakerResetModal.tsx:50` can now compute `acknowledged.size === triggers.length`. Banner at `CircuitBreakerBanner.tsx:42` reads `single.triggerCount` cleanly. Test 15 in `circuitBreaker.test.ts:198-211` asserts the new payload shape. |
| CR-02: Flashbots EIP-1559 mismatch | `src/utils/mevStrategies/flashbots.ts:61-78` | **CLOSED** | Mirrors passthrough strategy's `if (feeData.maxFeePerGas)` branch. Sets `populatedTx.type = 2` on EIP-1559 path. BSC's bloxroute strategy unchanged (correct — BSC `gas.type === 'legacy'` per ChainRegistry). |
| CR-03: registerAntiRugPosition not awaited | `src/bot.ts:432, 687` | **CLOSED** | Both V2 (line 432) and V3 (line 687) call sites now `await registerAntiRugPosition(...)`. Rejections now flow into the surrounding `try/catch` with `op: 'antirug.baseline-snapshot-failed'`. |
| CR-04: Allowlist verify failure → silent unverified monitoring | `src/bot.ts:1106-1206` | **CLOSED** | `verifiedChains: Set<string>` declared at line 1106; populated at line 1114 on verify success. Step 3 (line 1149) skips position re-registration when `!verifiedChains.has(trade.chain)` with structured log `op: 'antirug.resume.skip-unverified-chain'`. Step 4 (line 1196) skips `startChainAntiRugListener` with `op: 'antirug.resume.skip-ws-listener-unverified'`. **Chain-name case verified consistent**: both sides use lowercased `ctx.chain.name` (via `CHAIN_TEMPLATES` keys) and trades-table `chain` column (insertTrade always uses `ctx.chain.name`); legacy `mainnet` rows normalized to `eth` at module load. |
| CR-05: Resume path no-ops with zero positions | `src/anti-rug/detector.ts:552-712` | **CLOSED** | `startChainAntiRugListener` initializes `chainState` at line 565-576 BEFORE the address-filter check. Address-filter subscription gated at line 615 on `addresses.length > 0`. When empty: logs `op: 'antirug.listener.armed-no-positions'` at line 661-667 and STILL arms heartbeat (line 701) + close handler (line 702-704) + `backfillSinceLastSeen` (line 710). When the first position lands, `registerAntiRugPosition` re-enters and installs the filter. The previous-dispatcher drop-and-recreate logic (line 635-637) is bypassed when `state.activeDispatcher` is null, so no leak. Test 21 in `wsReconnectBackfill.test.ts` exercises this path. |
| CR-06: AntiRugStateUpdate success + null/undefined drift | `src/anti-rug/exitTrigger.ts:189-260`, `dashboard/src/types/api.ts:114-121`, `dashboard/src/hooks/useWebSocket.ts:144` | **PARTIALLY CLOSED** | Type contract updated: `success?: boolean` added (line 120); `lastSignals?: RugSignals \| null` allows null (line 119). Backend sends `undefined` not `null` (exitTrigger.ts:194,258). Frontend normalizes `null ?? undefined` (useWebSocket.ts:144). **Residual gap (CR-06-FOLLOWUP below):** `success` is in the type and on the wire, but no dashboard component reads it. The operator cannot see from the UI whether `executeFullSell` returned true/false on a live exit. |
| CR-07: Circular import | `src/exitEngine.ts:20`, `src/anti-rug/detector.ts:91`, `src/anti-rug/exitTrigger.ts:56` | **NOT CLOSED** | Cycle still present and verified. Fix report (`19-REVIEW-FIX.md` §"Skipped Issues") documents vitest mock cache friction with all three proposed resolution paths. Cycle remains entirely at function-body boundaries (no top-level invocations of the cycle's symbols), so no immediate runtime symptom. Strongly recommended to add `eslint-plugin-import/no-cycle` rule before any future refactor of any of the three modules — see Recommendations §1. |
| WR-01: Dual mergeAllowlist implementations | `src/anti-rug/allowlist.ts:17-25`, `src/chainRegistry.ts:566-599` | **CLOSED** | The exported `mergeAllowlist` deleted from `allowlist.ts` (comment block at line 17-25 documents the removal). Production `chainRegistry.ts:mergeAllowlist` now structured-logs overrides via `op: 'antirug.allowlist.env-override-hardcoded'` (line 583-595). Tests 7 + 8 removed from `allowlist.test.ts:272-279` (a comment block now explains the removal). |
| WR-02: dispatchEvent races with unregister | `src/anti-rug/detector.ts:1322-1363` | **CLOSED** | Snapshot taken via `const positionsSnapshot = positions.slice()` at line 1343, **BEFORE** the `for` loop iteration at line 1344. Iteration proceeds on the frozen snapshot — `bucket.splice` from a concurrent `unregisterAntiRugPosition` mutates the live `positions` array but the loop iterates `positionsSnapshot`, so the still-registered sibling is not skipped. Snapshot placement is correct (before iteration, not after). |
| WR-03: V3 sell-sim probe amount | `src/anti-rug/detector.ts:1690-1731` | **CLOSED** | Probe amount now queries `tokenContract.balanceOf(ctx.wallet.address)` (line 1702-1709) using ERC20_ABI. Ratio denominator at line 1725-1728 is `quotedOut * 10000n / probeAmount` (the real anti-rug signal). The semantic change is acknowledged in the fix report's Logic Verification box and tests are updated (detectorEvaluator mocks balanceOf via ERC20 ABI dispatch). Note: WR-03 fix-report recommends a fork test for live verification — not added in this iteration; flagged in Recommendations §4. |
| WR-04: V2 signal-3 reads only reserve0 | `src/anti-rug/detector.ts:1558-1598` | **CLOSED** | Now reads both `reserve0` and `reserve1` (line 1558, 1561). Signal-3 trips if EITHER side drops below 50% (line 1598: `reserve0Pct < 50 \|\| reserve1Pct < 50`). `v2ReservePctBelow` reports the WORSE side at line 1597. **Migration not needed**: `v2_token1_reserve` column has existed since the v5 schema migration (db.ts:135). All existing V2 baselines already populated this field via `snapshotLpBaseline` (lpBaseline.ts:125). The vacuous-pass guard at line 1558 (`?? '0'`) provides defense-in-depth: if a legacy row somehow had null, baselineReserve1 becomes 0n which sets reserve1Pct to vacuous `1.0` (10000 bps), so signal-3 falls back to reserve0-only behavior. |
| WR-05: WS reconnect leak when CONNECTING | `dashboard/src/hooks/useWebSocket.ts:75-92` | **CLOSED** | Bail condition now `wsRef.current.readyState !== WebSocket.CLOSED && wsRef.current.readyState !== WebSocket.CLOSING` (line 87-89). Only CLOSED state permits a fresh socket — OPEN, CONNECTING, and CLOSING all short-circuit. The reconnect timer firing while a previous CONNECTING socket is mid-negotiation will now bail instead of overwriting `wsRef.current`. |
| WR-06: V3 Burn grace-window block-watcher leak | `src/anti-rug/detector.ts:215-230, 2084-2120, 2148-2156` | **CLOSED** | `PendingV3Burn` interface (line 215-230) now carries `blockHandler` reference. LAST-WINS replacement at `handleV3BurnArrival` line 2084-2087 explicitly `ctx.httpProvider.off('block', priorPending.blockHandler)` before overwriting. Collect-paired path at `handleV3CollectArrival` line 2156 does the same `off()` call. Self-cleanup-on-tick path at line 2100 still works for the non-LAST-WINS case. |
| WR-07: Test 1 description mismatch | `test/unit/anti-rug/detectorEvaluator.test.ts:488-499` | **CLOSED** | Test description updated to "signal-1 trips + destination IS in allowlist → allowlisted (short-circuit)". Multi-paragraph block comment at line 561-635 explains the discriminated-union short-circuit semantics. Assertion unchanged (`verdict.verdict).toBe('allowlisted')`). |
| WR-08: ALLOWLIST_EXTRA places extras in BOTH V2 and V3 | `src/chainRegistry.ts:862-885`, **NOT** in `src/config.ts` nor `.env.example` | **PARTIALLY CLOSED** | `chainRegistry.ts` now reads three env vars per chain: unified `ALLOWLIST_EXTRA` (line 864, with deprecation warn at line 866-876), `ALLOWLIST_EXTRA_V2` (line 880), `ALLOWLIST_EXTRA_V3` (line 884). The deprecated unified alias is preserved. **Residual gap (WR-08-FOLLOWUP below):** the new per-pool-type env vars are NOT registered in `src/config.ts:REQUIRED_ENV_VARS`, NOT documented in `.env.example`, and NOT mentioned in `docs/operations/anti-rug-rollout.md` §1 env-var table or `docs/operations/anti-rug-tuning.md` allowlist-overlay table. An operator following the docs cannot discover these new vars exist. |
| WR-09: gap-detected missing pair | `dashboard/src/types/api.ts:53-58`, `dashboard/src/components/anti-rug/AntiRugMonitorTile.tsx:89-92` | **CLOSED** | `pair?: string` (optional) in the frontend type with a clear comment (line 53-57). UI guards via `evt.kind === 'gap-detected' ? '—' : formatAddress(evt.pair ?? '')` (line 91). |
| IN-01..IN-06 | (various) | **NOT IN SCOPE** | Per `fix_scope: critical_warning`. All six still present — see Info Findings Carry-Over below. |

## New Findings

### WR-08-FOLLOWUP: New ALLOWLIST_EXTRA_V2/V3 env vars are undocumented "shadow" config

**Severity:** WARNING

**Files:** `src/config.ts` (missing entries — expected at line 85 and parallel positions for BSC/Base/Arb), `.env.example` (lines 137, 148, 159, 170 reference only the unified `ALLOWLIST_EXTRA`), `docs/operations/anti-rug-rollout.md` (line 25 says "9 env vars per chain × 4 chains = 36"; §1 table at line 40-50 only lists the unified `ALLOWLIST_EXTRA`), `docs/operations/anti-rug-tuning.md` (table at line 62-64 only references unified `ALLOWLIST_EXTRA`)

**Issue:** The WR-08 fix added per-pool-type env vars (`<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA_V2` / `_V3`) in `src/chainRegistry.ts:880-885`, but did not:

1. Register them in `src/config.ts:REQUIRED_ENV_VARS` (where every other anti-rug env var IS registered as `required: false` with a description per the env-validation convention).
2. Add them to `.env.example` (which Test 22-25 in `antiRugConfig.test.ts` checks for).
3. Update `docs/operations/anti-rug-rollout.md` §1 env-var table (still lists only the unified `ALLOWLIST_EXTRA`).
4. Update `docs/operations/anti-rug-tuning.md` allowlist-overlay table (still references only the unified var).
5. Update the doc claim "9 env vars per chain × 4 chains = 36" — should now be "11 env vars per chain × 4 chains = 44" with the two new vars.

The `parseAllowlistExtra` function correctly reads `process.env[envKey]` directly (chainRegistry.ts:835), so the new env vars DO work at runtime when an operator happens to know about them. But the source-of-truth for env documentation is `src/config.ts:REQUIRED_ENV_VARS` and `.env.example` — anything not registered there is effectively a hidden API. The deprecation-warn alone is insufficient: operators who never set the unified var will never see the warn that hints at the new vars existing.

This also creates a minor risk: the existing test `antiRugConfig.test.ts:357-363` asserts `REQUIRED_ENV_VARS.length >= 32`. Adding 8 more entries (2 per chain × 4 chains) would not break the test, but the test gives no protection against the omission.

**Fix:**

1. Add 8 entries to `src/config.ts:REQUIRED_ENV_VARS` (per-chain pairs):
```typescript
{ name: 'ETH_ANTIRUG_ALLOWLIST_EXTRA_V2', required: false, description: 'V2-only locker checksummed addresses (operator overlay; preferred over the deprecated unified ALLOWLIST_EXTRA)' },
{ name: 'ETH_ANTIRUG_ALLOWLIST_EXTRA_V3', required: false, description: 'V3-only locker checksummed addresses (operator overlay)' },
// ... repeat for BSC, BASE, ARB
```
2. Add 8 lines to `.env.example` mirroring the existing `ALLOWLIST_EXTRA` entries (one V2 + one V3 per chain).
3. Update `docs/operations/anti-rug-rollout.md` §1 table — add two new rows for the V2 + V3 variants, mark the unified one as `DEPRECATED`.
4. Update `docs/operations/anti-rug-tuning.md` allowlist-overlay table similarly.
5. Update doc env-count from `9 × 4 = 36` to `11 × 4 = 44`.

### CR-06-FOLLOWUP: AntiRugStateUpdate.success on wire, but no UI consumer

**Severity:** WARNING (the field is type-correct now and arrives over the wire; missing UI is a polish/observability gap, not a functional bug)

**File:** `dashboard/src/types/api.ts:120` (declared), `src/anti-rug/exitTrigger.ts:259` (broadcast), no consumer in `dashboard/src/`

**Issue:** CR-06 added `success?: boolean` to `AntiRugStateUpdate` and the backend broadcast at `exitTrigger.ts:253-260` includes it on the exit-fired path. But `dashboard/src/hooks/useWebSocket.ts:144-156` only destructures `state`, `lastEventTs`, and `lastSignals` from the update — `success` is silently dropped. No dashboard component (`PositionTable`, `AntiRugMonitorTile`, `AntiRugExitDetailModal`, `AntiRugStateBadge`) reads `update.success` to render an exit-success indicator. The operator therefore sees `antiRugState: 'exit-fired'` for both a successful AND a failed live exit — the latter being arguably the more important signal to surface (a failed exit means the position is still open AND a trigger slot was consumed AND the circuit-breaker is one step closer to tripping).

**Fix:** Add `antiRugLastSuccess?: boolean` to the `Position` interface in `dashboard/src/types/api.ts`, persist it in `useWebSocket.ts:148-153` via the same merge pattern as `antiRugLastEventTs`, and render in `AntiRugExitDetailModal` (e.g. a red banner when `success === false`). Or: change the `AntiRugStateBadge` color/label when `state === 'exit-fired' && success === false` (e.g. show `'exit-fired-failed'` variant in red).

## Info Findings Carry-Over

All six Info-tier findings from iter1 remain present, as expected (`fix_scope: critical_warning`).

### IN-01: Documented "31 envs" claim doesn't match REQUIRED_ENV_VARS count

**Status:** Still present. The doc at `docs/operations/anti-rug-rollout.md:25` says "9 env vars per chain × 4 chains = 36" — count matches `config.ts` for the original vars but WR-08 added 2 more env vars per chain without doc updates (see WR-08-FOLLOWUP above). The current `antiRugConfig.test.ts:357-363` still asserts `length >= 32`. Tightening to exact equality (will be 44 after WR-08-FOLLOWUP lands) would catch this kind of drift.

### IN-02: Test mocks use the unused mergeAllowlist

**Status:** **Indirectly resolved** by WR-01 fix (deleting the dead `mergeAllowlist` export + Tests 7 + 8). The "test asserts dead code" condition no longer exists. Can be marked resolved in iter3.

### IN-03: V3_BURN_GRACE_BLOCKS hardcoded

**Status:** Still present at `src/anti-rug/detector.ts:213`. No env-promotion yet.

### IN-04: void _removed pattern in useWebSocket.ts

**Status:** Still present at `dashboard/src/hooks/useWebSocket.ts:206-207`. Style nit.

### IN-05: 5s force-exit doc nit

**Status:** Still present at `docs/operations/anti-rug-rollout.md:88` / `src/bot.ts:1229`. The `.unref()` at line 1229 still makes 5s a soft guarantee. Doc unchanged.

### IN-06: Frontend chain selection logic in Overview.tsx is fragile

**Status:** Still present at `dashboard/src/pages/Overview.tsx:43-48`. `Array.from(chainSet)[0] ?? 'eth'` still returns the first chain in Set insertion order (non-deterministic for multi-chain operation). Forward-looking polish for the post-v6.17 multi-chain enablement window.

## Recommendations

1. **Address CR-07 in a separate phase** with an explicit `import/no-cycle` ESLint rule landing first, then a planned refactor with co-ordinated test mock updates. Option 3 from iter1 (runtime registration via a `sellAdapter` module) is the lowest blast-radius — `exitTrigger.test.ts` `vi.mock('../../../src/exitEngine', ...)` can be replaced with a `beforeEach` `registerSellAdapter(mockExecuteFullSell)` call. Option 1 (move `triggerAntiRugExit` into `detector.ts`) collapses the cycle but the fix report notes test-mock-path coupling on `vi.mock('../../../src/anti-rug/exitTrigger', ...)`. Until then, **do not add top-level (module-init-time) invocations of `triggerAntiRugExit`, `executeFullSell`, or `unregisterAntiRugPosition` in any of the three cycle modules** — the current cycle is "safe by accident" only.

2. **Close WR-08-FOLLOWUP before live-execute graduation.** Operators following the rollout doc literally would not know the new V2/V3 split env vars exist. The unified `ALLOWLIST_EXTRA` is now technically deprecated but only documented as such inside the chainRegistry.ts source comment. Land the 5-step fix above in a docs+config commit.

3. **Close CR-06-FOLLOWUP for operator visibility.** A failed live anti-rug exit is currently indistinguishable from a successful one on the dashboard — both render as `exit-fired`. Add `antiRugLastSuccess` to the Position type and surface a red banner in `AntiRugExitDetailModal` when `success === false`.

4. **Add the two fork tests recommended in `19-REVIEW-FIX.md` Production Safety Notes** before any chain graduates to `LIVE_EXECUTE=true`:
   - CR-02 verification: `populatedTx.maxFeePerGas === rawMaxFeePerGas * 2n` for `reason='anti-rug'` on ETH (Flashbots EIP-1559 path).
   - WR-03 verification: V3 sell-sim slippage < 5% on a balanced pool when `probeAmount === position size`.

5. **Tighten `antiRugConfig.test.ts:357-363`** to assert exact entry count (44 after the WR-08-FOLLOWUP fix lands) — would have caught the omission noted in WR-08-FOLLOWUP at unit-test time.

6. **Stop-the-line gates passed for this iteration**: all three tsconfigs clean, 147/147 tests pass, no regression in test files that the fix touched (`circuitBreaker.test.ts` was updated for the new payload shape; `detectorEvaluator.test.ts` was updated for the new `balanceOf` mock; `allowlist.test.ts` was updated for the WR-01 deletion). No silent semantic change in live-execute behavior beyond what is documented in `19-REVIEW-FIX.md` Production Safety Notes.

---

_Reviewed: 2026-05-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
_Iteration: 2 — goal-backward closure verification_
