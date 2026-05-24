---
phase: 19-anti-rug-runtime-monitoring
verified: 2026-05-24T05:15:00Z
gaps_closed: 2026-05-24T05:25:00Z
status: gaps_closed
verdict: PASS
score: 5/5 success criteria fully verified (both initial gaps closed operator-authorized)
re_verification:
  is_re_verification: false
test_totals_verified:
  unit: 489
  integration: 169
  fork: not_executed_no_archive_RPC
  tsc_clean: true
gap_closure_summary: |
  Gap-1 (gas multiplier discard) and Gap-2 (REQUIREMENTS.md checkbox drift)
  surfaced at first verification 05:15Z. Operator chose "Implement now"
  for Gap-1 and "Fix now" for Gap-2 via verification AskUserQuestion gate.
  Both closed in follow-up commits — see commit `7d35c46` (Gap-1: threads
  gasMultiplier through MevStrategy.sendTransaction + applies to EIP-1559
  maxFee/priorityFee or legacy gasPrice on populated tx in all three
  strategies; 11 new tests including 10 strategy-level + Test 3b regression
  guard) and the subsequent REQUIREMENTS.md sweep commit (Gap-2).
gaps:
  - truth: "Anti-rug exit applies the 2.0× gas multiplier from ctx.chain.antiRug.gasMultiplier to actual EIP-1559 fee fields (ROADMAP Phase 19 SC #1)"
    status: closed_2026-05-24
    closure_commit: "7d35c46"
    closure_summary: "Threaded gasMultiplier through MevStrategy.sendTransaction signature (new optional arg-5); sendTxWithRetry's multi-chain overload accepts arg-6 gasMultiplier and passes through; exitEngine.ts replaces `void gasMultiplier;` with real wire-up. PassthroughMevStrategy applies to EIP-1559 maxFee/priorityFee + legacy gasPrice fallback. FlashbotsMevStrategy + BloxrouteMevStrategy apply to gasPrice. New test/unit/mevStrategies/gasMultiplier.test.ts (10 tests) covers applyGasMultiplier helper math (bigint *100/100n) + strategy-level multiplier propagation. test/unit/exitEngine/antiRugReason.test.ts Test 3b is a regression guard against future `void gasMultiplier` reintroduction. Backward compat preserved: gasMultiplier=undefined or 1.0 == raw feeData (prior behavior). Operator docs claims are now accurate."
    original_reason: "Plan 19-05 SUMMARY documents this as an explicit deviation: gasMultiplier is computed (src/exitEngine.ts:469-471) but then immediately discarded via `void gasMultiplier;` (line 475). Comment claims operator-visible surfacing via alert header (line 498), but the alert format `*[ANTI-RUG EXIT]* ${reasonDetail}` does not include the multiplier value. Downstream gas computation (gasManager.getGasOptionsForChain + MEV strategy implementations in passthrough.ts/flashbots.ts) reads ctx.chain.gas.multiplier or raw feeData — never ctx.chain.antiRug.gasMultiplier. Test 2 in test/unit/exitEngine/antiRugReason.test.ts only asserts the source-text derivation exists; it does not assert the value is APPLIED. Operator docs (docs/operations/anti-rug-rollout.md:47) claim the multiplier IS applied. Plan 19-05 SUMMARY decision §1 documents the deviation with a follow-up commitment but no concrete follow-up plan was created."
    artifacts:
      - path: "src/exitEngine.ts"
        issue: "Lines 469-475: gasMultiplier derived then `void gasMultiplier;` — value discarded. Builder closures (buildV2SellTx/buildV3SellTx) never receive elevated multiplier."
      - path: "src/utils/mevStrategies/passthrough.ts"
        issue: "Line 45: `populatedTx.maxFeePerGas = feeData.maxFeePerGas` — raw feeData, no chain or anti-rug multiplier applied."
      - path: "src/utils/mevStrategies/flashbots.ts"
        issue: "Line 54: `const gasPrice = (await provider.getFeeData()).gasPrice;` — raw feeData, no multiplier."
      - path: "docs/operations/anti-rug-rollout.md"
        issue: "Line 47 claims `Multiplier applied to EIP-1559 fee fields when reason='anti-rug'. Default doubles the standard fee` — false; multiplier is not applied. Operator docs disclosure missing."
      - path: "README.md"
        issue: "Lines 21, 302, 448 claim '2.0× gas multiplier' applied to anti-rug exits — false; misleads users about behavior."
    missing:
      - "Either: (a) thread ctx.chain.antiRug.gasMultiplier into buildV2SellTx/buildV3SellTx via shallow-config-override per PLAN.md Step 1(b), AND verify it reaches passthrough.ts + flashbots.ts gas-field computation; OR (b) update docs/operations/anti-rug-rollout.md + README.md + ROADMAP SC #1 to accurately describe current behavior (`reason='anti-rug'` discriminant propagated through alert headers + CB telemetry; gas-field elevation deferred). Either remediation must include an executable test assertion (NOT source-text regex) that asserts the on-chain gas fields when reason=anti-rug. Until resolved, this defect is masked by the dry-run safety invariant (which IS intact)."
  - truth: "REQUIREMENTS.md inline checkbox state is consistent with the bottom coverage table"
    status: closed_2026-05-24
    closure_summary: "Inline checkbox sweep aligning ANTIRUG-05/07/08/09/14 to `[x]` (Complete), ANTIRUG-13 table promoted from Pending to Complete to match inline `[x]`, ANTIRUG-15 inline marked `[~]` Partial (ETH resolved; BSC/Base/Arb pending) to match the table's Partial status."
    original_reason: "REQUIREMENTS.md has mixed checkbox state between inline list (lines 44-59) and bottom coverage table (lines 162-177). Inline ANTIRUG-05/07/08/09/14 show `[ ]` (unchecked) but table lists them Complete. Inline ANTIRUG-13 shows `[x]` (checked) but table lists Pending. Inline ANTIRUG-15 shows `[ ]` but table lists Partial. Book-keeping defect — does not affect implementation but causes confusion for future readers."
    artifacts:
      - path: ".planning/REQUIREMENTS.md"
        issue: "Inline checkbox state at lines 48, 50-52, 56-58 does not match table state at lines 166-176."
    missing:
      - "Sweep inline checkbox state to match the canonical bottom-table status (or vice versa). Recommended: a 1-commit fix to align lines 48 ([x]) 50 ([x]) 51 ([x]) 52 ([x]) 57 ([x]) 174 ANTIRUG-13 keep Pending OR mark inline `[ ]` for consistency. Decide which is canonical first."
deferred:
  - truth: "V3 real-mainnet rug fixture pinned (eth-v3-CANDIDATE.json fully resolved)"
    addressed_in: "Phase 19 Wave-1 follow-up during 7-day dry-run window"
    evidence: "Documented in test/fork/fixtures/rugs/README.md §'Outstanding Block-Pin Verification' + docs/operations/anti-rug-rollout.md §'V3 rug-fixture backfill'. Contrived RugPull.sol modes 3 (v3-burn-collect) and 4 (v3-burn-only) cover V3 detector branches in fork tests during the wait."
  - truth: "BSC/Base/Arb V3 allowlist entries for TeamFinance V3 + PinkLock V3 (ANTIRUG-15)"
    addressed_in: "Per-chain enable preflight; operator resolves when those chains are enabled (currently ENABLED_CHAINS=eth only)"
    evidence: "ANTIRUG-15 marked Partial in REQUIREMENTS.md table. PHASE-19-BLOCKER-4-ESCALATION comments in src/chainRegistry.ts:521-549 mark the gaps with operator-resolution protocol. ETH V3 resolved (UNCX V3 + TeamFinance V3 NFT-as-V2-proxy per TrustSwap blog; PinkLock V3 verified absent on ETH via Etherscan ABI inspection)."
  - truth: "Detection-latency histogram populated in FrontrunDistributionPanel"
    addressed_in: "Future plan to wire latency telemetry payload onto AntiRugEvent"
    evidence: "dashboard/src/components/anti-rug/FrontrunDistributionPanel.tsx:74-82 documented placeholder bins; comment says 'telemetry payload to be wired in 19-07 fork test'. D-RACE-TELEMETRY measurement infrastructure landed in src/anti-rug/raceTelemetry.ts; UI plumbing deferred."
human_verification:
  - test: "Operator review of the Plan 19-05 gasMultiplier deviation"
    expected: "Operator decides whether to (a) accept the deviation as documented, (b) ship a follow-up plan threading the multiplier through buildV2SellTx/buildV3SellTx, or (c) revise ROADMAP SC #1 + docs to reflect current behavior. Without resolution, live-mode graduation per D-LIVE-GATE proceeds with 1× chain-multiplier (not 2× elevated) gas — operator capital at increased frontrun-loss risk relative to documented expectation."
    why_human: "This is a documented deviation requiring operator capital-safety judgment. The verifier cannot decide whether the 2× elevation is materially important on real-mainnet anti-rug exits — that's a real-capital-risk-tolerance call."
---

# Phase 19: Anti-Rug Runtime Monitoring — Verification Report

**Phase Goal:** When liquidity is removed from a pool the bot has an open position in, the bot fires a frontrun-exit through the existing `executeFullSell` path with elevated gas — within 1-2 confirmation blocks of the LP-removal event, with multi-signal logic (>50% LP removed AND destination not in allowlist AND reserves below sell-threshold) that does not cascade into panic-sells on legitimate V2→V3 migrations, lock-contract transfers, or normal multisig rebalances.

**Verified:** 2026-05-24T05:15:00Z
**Status:** gaps_found
**Verdict:** **PARTIAL-PASS**
**Re-verification:** No — initial verification

---

## Goal Achievement Summary

| # | Roadmap Success Criterion | Status | Evidence |
|---|---|---|---|
| SC-1 | Fork rug-pull scenario → executeFullSell with reason='anti-rug' + 2.0× gas multiplier + sell lock + receipt decoding + DB cleanup + Telegram alert | **PARTIAL** | reason='anti-rug' propagated through union (src/exitEngine.ts:434); cleanup hooks at 3 sites (lines 454, 538, 552); [ANTI-RUG EXIT] alert (lines 497, 540, 553); sendTxWithRetry preserves sell lock + receipt decoding. **GAP**: gas multiplier computed but discarded (`void gasMultiplier;` line 475) — see Gap-1. Fork tests committed but not executed in this verification session (no archive RPC). |
| SC-2 | V2→V3 migration + lock-contract transfers do NOT trigger exits (multi-signal AND chain + allowlist) | **VERIFIED** | AND-chain at detector.ts:1839 and 1929 requires all three signals tripped. ETH V3 allowlist includes UNCX V3 (0xFD23...e6DE) + TeamFinance V3 NFT proxy (0xe2fe...35fb) + PinkLock V3 verified absent. Integration Test 17 confirms `verdict=allowlisted` on UNCX destination. Test 18 confirms `verdict=safe` on partial signal. Tests 15-23 passing. |
| SC-3 | Default dry-run mode (`ANTIRUG_LIVE_EXECUTE=false`) — would-have-sold pino events without executing | **VERIFIED** | Dry-run gate at src/anti-rug/exitTrigger.ts:161 (`if (!liveExecute) return false` before any executeFullSell call). All env defaults `false` in .env.example (lines 129, 140, 151, 162). config.ts:77 + REQUIRED_ENV_VARS confirm. Integration Test 15 verifies dry-run path: 3 signals trip → `would-have-sold` broadcast + `[DRY-RUN]` alert + NO executeFullSell. |
| SC-4 | WS disconnect/reconnect restores monitoring (heartbeat + reconnect + backfill via getLogs) | **VERIFIED** | src/anti-rug/detector.ts has heartbeat (line 105+), reconnect logic, getLogsForBackfill chunked primitive, HTTP polling fallback. 19-04c Plan SUMMARY documents 478/478 unit + 168/168 integration tests passing. Detector exports state machine ('connected'/'reconnecting'/'disconnected'). FAIL-CLOSED on gap > backfillCapBlocks. |
| SC-5 | Per-chain circuit breaker (default 3 in 1h) + manual reset via dashboard + prominent banner | **VERIFIED** | src/anti-rug/circuitBreaker.ts: incrementCircuitBreaker, isCircuitBreakerTripped, resetCircuitBreaker, getRecentTriggers exports. Per-chain isolation via Map keys. Integration Test 21 verifies trip behavior (3 successful exits → CB tripped → 4th evaluation returns early). API route POST /api/anti-rug/circuit-breaker/:chain/reset wired (src/api/routes/antiRug.ts). Dashboard CircuitBreakerBanner + CircuitBreakerResetModal mounted in Overview.tsx. cb_tripped/cb_reset broadcast handled in useWebSocket.ts:165, 175. |

**Overall Score:** 4 of 5 Success Criteria fully VERIFIED; 1 PARTIAL (Gap-1).

---

## Observable Truths — Per-Artifact Verification

### Source artifacts (src/anti-rug/*.ts)

| Artifact | Lines | Status | Wiring | Data Flow | Verdict |
|---|---|---|---|---|---|
| `src/anti-rug/types.ts` | 227 | EXISTS / SUBSTANTIVE | Imported by detector, exitTrigger, circuitBreaker, raceTelemetry, lpBaseline, allowlist | RugEvaluation discriminated union ensures vacuous-pass unrepresentable | **VERIFIED** |
| `src/anti-rug/events.ts` | 110 | EXISTS / SUBSTANTIVE | Imported by detector.ts for topic-filter union | Tests assert PAIR_BURN_TOPIC === ethers.id('Burn(...)'), etc. | **VERIFIED** |
| `src/anti-rug/allowlist.ts` | 199 | EXISTS / SUBSTANTIVE | verifyAllowlistAtStartup called from bot.ts:1087; isAddressAllowlisted called from detector.ts evaluator | 9 allowlist module tests passing; getCode → log.fatal on EOA | **VERIFIED** |
| `src/anti-rug/lpBaseline.ts` | 242 | EXISTS / SUBSTANTIVE | snapshotLpBaseline called from bot.ts:424, 678; loadLpBaseline from detector resume | Writes v2_token0_reserve + v3_active_liquidity from on-chain reads | **VERIFIED** |
| `src/anti-rug/detector.ts` | 2145 | EXISTS / SUBSTANTIVE | registerAntiRugPosition + startChainAntiRugListener wired in bot.ts + resumeAntiRugMonitoring | Real evaluateRugSignals dispatches to triggerAntiRugExit; multi-signal AND chain at line 1839 + 1929 | **VERIFIED** |
| `src/anti-rug/exitTrigger.ts` | 264 | EXISTS / SUBSTANTIVE | Called by detector.ts:1708 + 1774 (only callers in production); imports executeFullSell | Dry-run gate at line 161 PRECEDES executeFullSell; CB gate at line 199; reasonDetail formatted from RugEvaluation.signals | **VERIFIED (dry-run gate)** |
| `src/anti-rug/circuitBreaker.ts` | 225 | EXISTS / SUBSTANTIVE | Imported by exitTrigger (gate) + bot.ts API route | 8 circuit-breaker tests passing; ring buffer bounded by triggers config; per-chain Map isolation | **VERIFIED** |
| `src/anti-rug/raceTelemetry.ts` | 251 | EXISTS / SUBSTANTIVE | Exported but no production caller yet (telemetry payload to be wired in fork test per FrontrunDistributionPanel.tsx:79-80) | measureDetectionLatency / flashbotsRaceVerdict / postHocReality scaffolds in place; unit test confirms latency math | **ORPHANED (intentional — fork-test wiring deferred)** |

### Modified core files

| File | Phase 19 changes | Verdict |
|---|---|---|
| `src/utils/db.ts` (522 lines) | Schema v4→v5 migration; lp_baseline + chain_state tables; 5 new prepared statements | **VERIFIED** — CURRENT_SCHEMA_VERSION=5 at line 27; CREATE TABLE at lines 130, 147; statements at lines 457-495 |
| `src/chainRegistry.ts` (984 lines) | `antiRug: AntiRugConfig` field per chain (line 90); HARDCODED_V2_ALLOWLIST + HARDCODED_V3_ALLOWLIST per chain; ETH V3 has UNCX V3 + TeamFinance V3 NFT proxy + OPERATOR-VERIFIED-NO-PINKLOCK-V3-eth comment (line 503) | **VERIFIED** — D-V3-ALLOWLIST resolutions present |
| `src/config.ts` (199 lines) | 36 ANTIRUG envs in REQUIRED_ENV_VARS (9 envs × 4 chains; lines 77-118) | **VERIFIED** — count matches |
| `src/exitEngine.ts` (978 lines) | reason union extended with `'anti-rug'` (line 434); elevated-gas branch (lines 469-475); unsubscribeAntiRug at 3 sites (454, 538, 552); [ANTI-RUG EXIT] alert headers (497, 540, 553) | **VERIFIED (reason+cleanup+alerts)** / **FAILED (gas multiplier)** — see Gap-1 |
| `src/bot.ts` (1234 lines) | V2 + V3 buy-success attach pairs (lines 416-425, 674-679); resumeAntiRugMonitoring (line 1080); startChainAntiRugListener calls per chain (line 1161); verifyAllowlistAtStartup serial per chain (line 1087) | **VERIFIED** |
| `.env.example` | 9 envs × 4 chains × ANTIRUG_* prefix (lines 129-170) | **VERIFIED** |

### Dashboard artifacts (dashboard/src/components/anti-rug/*.tsx)

| Component | Lines | Mounted In | Verdict |
|---|---|---|---|
| `AntiRugStateBadge.tsx` | 52 | PositionTable.tsx:153 | **VERIFIED** |
| `AntiRugMonitorTile.tsx` | 105 | Overview.tsx (import + render) | **VERIFIED** |
| `CircuitBreakerBanner.tsx` | 65 | Overview.tsx:140 | **VERIFIED** |
| `CircuitBreakerResetModal.tsx` | 224 | Overview.tsx (conditional render) | **VERIFIED** |
| `AntiRugExitDetailModal.tsx` | 204 | Overview.tsx:270 | **VERIFIED** |
| `FrontrunDistributionPanel.tsx` | 207 | Overview.tsx:238 | **PARTIAL** — placeholder bins for detection latency (line 74-82); documented as deferred to D-RACE-TELEMETRY payload wiring |
| `GapDetectedBanner.tsx` | 84 | Overview.tsx:147 (per-chain map) | **VERIFIED** |
| `WsHealthIndicator.tsx` | 94 | Imported by Overview.tsx | **VERIFIED** |
| `useWebSocket.ts` (modified) | — | Handles `antirug_state_update` (line 116), `cb_tripped` (165), `cb_reset` (175) | **VERIFIED** |

### Test infrastructure

| File | Lines | Tests | Verdict |
|---|---|---|---|
| `test/fixtures/contracts/RugPull.sol` | 185 | 5-mode discriminated contract (mode 0..4: lp-removal, transfer-to-dead, v3-burn-collect, v3-burn-only) | **VERIFIED** |
| `test/fork/fixtures/rugs/eth-v2-horse.json` | — | HORSE pair `0x77A8...29b3` block-pinned at 18401608; fork test resolves tokenAddress at run time | **VERIFIED** |
| `test/fork/fixtures/rugs/eth-v3-CANDIDATE.json` | 27 | Schema skeleton with canonical V3 contracts; tokenAddress/poolAddress/etc null pending Wave-1 backfill | **DEFERRED** — see Deferred Items |
| `test/fork/fixtures/rugs/README.md` | 235 | Documents schema + Wave-1 backfill tracker | **VERIFIED** |
| `test/fork/antiRugDetector.fork.test.ts` | 863 | RugPull mode-driven + HORSE replay; chainGuard skips gracefully without ETH_FORK_RPC_URL | **VERIFIED (committed)** — not executed in this session (no archive RPC) |
| `test/integration/anti-rug/multiSignalEnd2End.test.ts` | 881 | Tests 15-23: dry-run + live + allowlist + partial-signal + vacuous-pass + confirm-blocks + CB trip + partial-sell preserves + full-close terminates | **VERIFIED — 9/9 tests passing** |

### Operator documentation

| File | Lines | Coverage | Verdict |
|---|---|---|---|
| `docs/operations/anti-rug-rollout.md` | 567 | 7 sections per D-OPERATOR-HANDOFF: pre-flight env vars (36 documented, env-count 7→9 callout), bot restart, dry-run + live verification, CB reset, troubleshooting (4 scenarios), Wave-1 V3 follow-up | **VERIFIED (D-OPERATOR-HANDOFF USER-BINDING satisfied)** with one inaccuracy: line 47 misrepresents gas multiplier behavior — see Gap-1 |
| `docs/operations/anti-rug-tuning.md` | 147 | 5 parameter categories with when-to-tune-up/down + 4-tier review cadence | **VERIFIED (D-TUNE-PROTOCOL satisfied)** |
| `README.md` | — | Anti-Rug section in Key Features; Status Snapshot updated; 5-paragraph operational summary | **VERIFIED** with same gas-multiplier inaccuracy at lines 21, 302, 448 — see Gap-1 |

---

## Key-Link Verification (Wiring Trace)

| Edge | Direction | Method | Verdict |
|---|---|---|---|
| `bot.ts` buy-success → `snapshotLpBaseline` | bot.ts:424 (V2), :678 (V3) call sites | grep | **WIRED** |
| `bot.ts` buy-success → `registerAntiRugPosition` | bot.ts:425 (V2), :679 (V3) | grep | **WIRED** |
| `detector.ts` event arrival → `evaluateRugSignals` | detector.ts:1090, 1295 dispatch sites | grep | **WIRED** |
| `evaluator unsafe verdict` → `scheduleConfirmBlocksGate` | confirm gate at detector.ts:1698 | source read | **WIRED** |
| `confirm gate` → `triggerAntiRugExit` | detector.ts:1708 (sync), 1774 (post-block) | grep | **WIRED** |
| `triggerAntiRugExit` (live path) → `executeFullSell` | exitTrigger.ts:234 | grep | **WIRED** |
| `triggerAntiRugExit` (dry-run gate) blocks executeFullSell | exitTrigger.ts:161 `if (!liveExecute) return false` precedes the call | source read | **WIRED — dry-run safety invariant intact** |
| `triggerAntiRugExit` (CB gate) blocks executeFullSell | exitTrigger.ts:199 `if (isCircuitBreakerTripped(chain)) return false` | source read | **WIRED** |
| `executeFullSell` (full-close branches) → `unsubscribeAntiRug` | exitEngine.ts:454, 538, 552 (3 close paths) | grep | **WIRED** |
| `bot.ts startMultiChainBot` → `resumeAntiRugMonitoring` | bot.ts:929 | grep | **WIRED** |
| `resumeAntiRugMonitoring` → `verifyAllowlistAtStartup` + `startChainAntiRugListener` | bot.ts:1087, 1161 | grep | **WIRED** |
| `exitTrigger` → `broadcast('antirug_state_update', ...)` (would-have-sold) | exitTrigger.ts:185 | source read | **WIRED** |
| `exitTrigger` → `broadcast('antirug_state_update', ...)` (exit-fired) | exitTrigger.ts:245 | source read | **WIRED** |
| `incrementCircuitBreaker` (trip side-effects) → `broadcast('cb_tripped', ...)` + sendCtxAlert | circuitBreaker.ts | source read | **WIRED** |
| `resetCircuitBreaker` → `broadcast('cb_reset', ...)` | circuitBreaker.ts | source read | **WIRED** |
| `useWebSocket` consumes `antirug_state_update` / `cb_tripped` / `cb_reset` | useWebSocket.ts:116, 165, 175 | grep | **WIRED** |
| `POST /api/anti-rug/circuit-breaker/:chain/reset` → `resetCircuitBreaker` | antiRug.ts:67 | source read | **WIRED** |
| `Overview.tsx` consumes antiRugEvents + circuitBreakerTrips → renders banners + tile + panel + modals | Overview.tsx:19, 22-58, 130-274 | grep | **WIRED** |
| `PositionTable.tsx` consumes `pos.antiRugState` → renders badge | PositionTable.tsx:153 | grep | **WIRED** |
| `exitEngine` gas multiplier (anti-rug branch) → MEV strategies | exitEngine.ts:469-475 `void gasMultiplier;` discards value | source read | **NOT WIRED — Gap-1** |

---

## Dry-Run Safety Invariant Trace

**Invariant:** every code path that could trigger a real sell tx with `reason='anti-rug'` MUST be gated by `ctx.chain.antiRug.liveExecute === true`.

**Trace:**
1. WS event arrives → `dispatchEvent` (detector.ts:1280)
2. → `evaluateRugSignals` (detector.ts:1295) returns `RugEvaluation`
3. → If verdict='unsafe' → `scheduleConfirmBlocksGate` (detector.ts:1698)
4. → After N blocks → `triggerAntiRugExit(ctx, ...)` (detector.ts:1708 OR 1774)
5. → `triggerAntiRugExit` (exitTrigger.ts:146)
6. → **GATE 1 (line 161):** `if (!liveExecute) { log + broadcast + return false; }` ← **PROTECTS DRY-RUN**
7. → **GATE 2 (line 199):** `if (isCircuitBreakerTripped(chain)) return false`
8. → Only if both gates pass: `executeFullSell(..., 'anti-rug', ...)` (line 234)

**Search for any alternate path that bypasses GATE 1:**
- `executeFullSell` is called with `reason='anti-rug'` in EXACTLY ONE place in production code: `src/anti-rug/exitTrigger.ts:234`.
- All other `executeFullSell` callers use `'trailing-stop'`, `'stop-loss'`, or `'urgency-market-sell'` (verified via grep).
- `executeFullSell` is also called from `src/api/routes/controls.ts:88, 161` (force-sell handler) — these use `'urgency-market-sell'`, never `'anti-rug'`.

**Verdict: Dry-run safety invariant INTACT.** No code path bypasses GATE 1.

---

## Requirement Coverage

| Req | Phase Map | REQUIREMENTS.md Inline | REQUIREMENTS.md Table | Implementation Evidence | Status |
|---|---|---|---|---|---|
| ANTIRUG-01 | Phase 19 | `[x]` | Complete | src/anti-rug/detector.ts — single-listener-per-chain WS subscription via positionRegistry Map<chain, Map<addr, Position[]>> | **SATISFIED** |
| ANTIRUG-02 | Phase 19 | `[x]` | Complete | PAIR_BURN_TOPIC included in topic-filter union (events.ts) | **SATISFIED** |
| ANTIRUG-03 | Phase 19 | `[x]` | Complete | PAIR_TRANSFER_TOPIC + DEAD_ADDRESS literal check in evaluator | **SATISFIED** |
| ANTIRUG-04 | Phase 19 | `[x]` | Complete | db.ts CURRENT_SCHEMA_VERSION=5 + lp_baseline + chain_state tables (additive) | **SATISFIED** |
| ANTIRUG-05 | Phase 19 | `[ ]` (book-keeping defect) | Complete | detector.ts:1839, 1929 multi-signal AND chain: `signal1Tripped && signal2Tripped && signal3Tripped` → verdict='unsafe' | **SATISFIED** (book-keeping fix needed) |
| ANTIRUG-06 | Phase 19 | `[x]` | Complete | HARDCODED_V2/V3_ALLOWLIST per chain (chainRegistry.ts); allowlist.ts {verifyAllowlistAtStartup, isAddressAllowlisted, mergeAllowlist} | **SATISFIED** |
| ANTIRUG-07 | Phase 19 | `[ ]` (book-keeping defect) | Complete | detector.ts:1698 scheduleConfirmBlocksGate (confirmBlocks=0 → synchronous; >0 → block watcher with reEval) | **SATISFIED** |
| ANTIRUG-08 | Phase 19 | `[ ]` (book-keeping defect) | Complete (per table) | exitTrigger.ts:234 → executeFullSell with `'anti-rug'`; exitEngine.ts:434 union extended. **GAP:** gas multiplier elevation not threaded to fee fields — see Gap-1. | **PARTIAL** — bridge wired, elevation gap |
| ANTIRUG-09 | Phase 19 | `[ ]` (book-keeping defect) | Complete | circuitBreaker.ts per-chain rolling window; POST /api/anti-rug/circuit-breaker/:chain/reset wired | **SATISFIED** |
| ANTIRUG-10 | Phase 19 | `[x]` | Complete | exitTrigger.ts:161 dry-run gate; .env.example defaults `false`; operator docs + 7-day window protocol | **SATISFIED** |
| ANTIRUG-11 | Phase 19 | `[x]` | Complete | detector.ts heartbeat + reconnect + getLogsForBackfill chunked primitive | **SATISFIED** |
| ANTIRUG-12 | Phase 19 | `[x]` | Complete | ws@^8.20.0 heartbeat ping/pong (30s default) in detector | **SATISFIED** |
| ANTIRUG-13 | Phase 19 | `[x]` (book-keeping defect) | Pending (per table) | POOL_BURN_TOPIC + POOL_COLLECT_TOPIC in topic-filter union; V3 evaluator branch at detector.ts:1556 | **SATISFIED** (table marker is stale — should be Complete) |
| ANTIRUG-14 | Phase 19 | `[ ]` (book-keeping defect) | Complete | V3 evaluator + pendingV3Burn grace window (detector.ts:200-238, 1882+); QuoterV2 sell-sim signal 3 | **SATISFIED** |
| ANTIRUG-15 | Phase 19 | `[ ]` (book-keeping defect) | Partial | ETH V3: UNCX V3 + TeamFinance V3 NFT (V2 proxy) + PinkLock V3 verified absent. BSC/Base/Arb V3 deferred to per-chain-enable. | **PARTIAL** (acknowledged in table) |
| ANTIRUG-16 | Phase 19 | `[x]` | Complete | Schema v3-specific columns (v3_active_liquidity, v3_tick_at_snapshot, v3_fee_tier) + pool_type discriminator | **SATISFIED** |

**Orphaned requirements:** None — ROADMAP.md Phase 19 lists ANTIRUG-01..16; all 16 are covered by plans.

**Coverage summary:** 14 SATISFIED, 1 PARTIAL by design (ANTIRUG-15 — BSC/Base/Arb V3 deferred per per-chain-enable protocol), 1 PARTIAL by gap (ANTIRUG-08 — gas multiplier elevation).

---

## Anti-Patterns Scan

| Pattern | File | Severity | Notes |
|---|---|---|---|
| Debt markers (TBD/FIXME/XXX) | src/anti-rug/ | **NONE** | Clean |
| Debt markers in modified files | src/utils/db.ts, src/chainRegistry.ts, src/exitEngine.ts, src/bot.ts, src/config.ts | **NONE** | Clean |
| `void gasMultiplier;` (value discard) | src/exitEngine.ts:475 | **WARNING** (Gap-1) | Documented in Plan 19-05 SUMMARY as a deferred decision; counts as a real defect against ROADMAP SC #1's "2.0× gas multiplier" claim |
| "placeholder" comments in production code | src/anti-rug/detector.ts:2108-2120 | **INFO (acceptable)** | Deliberate control-flow stub for async V3 Burn→Collect grace window pattern; real evaluation fires via block watcher. Not a true stub. |
| Empty histogram bins | dashboard/src/components/anti-rug/FrontrunDistributionPanel.tsx:74-82 | **WARNING (deferred)** | Detection-latency histogram renders with `[0,0,0,0,0]` until D-RACE-TELEMETRY payload is wired onto AntiRugEvent. Documented inline. |
| REQUIREMENTS.md checkbox inconsistency | .planning/REQUIREMENTS.md:48,50,51,52,57,58,174 | **WARNING (Gap-2)** | Inline `[ ]` vs table `Complete` mismatch on 6 requirements; inline `[x]` vs table `Pending` mismatch on ANTIRUG-13. Book-keeping, not implementation. |

---

## Test Suite Verification

**Run from project root in this verification session:**

| Command | Result | Total Tests |
|---|---|---|
| `npx tsc --noEmit` (main tsconfig) | **CLEAN** | — |
| `npx tsc --noEmit -p tsconfig.bot.json` | **CLEAN** | — |
| `cd dashboard && npx tsc --noEmit` | **CLEAN** | — |
| `npm run test:unit` | **478/478 passing**, 45 test files | 478 |
| `npm run test:integration` | **168/168 passing**, 21 test files | 168 |
| `npm run test:fork` | **NOT EXECUTED** (no ETH_FORK_RPC_URL/ALCHEMY_URL archive RPC; tests skip-gracefully via chainGuard pattern) | — |

**Test coverage assessment for Phase 19 deliverables:**

- Schema migration: 12 tests in test/unit/db/lpBaselineMigration.test.ts
- Anti-rug types: 11 tests in test/unit/anti-rug/types.test.ts
- Allowlist: 9 tests in test/unit/anti-rug/allowlist.test.ts
- Detector registry: 11 tests
- Detector evaluator: tests in test/unit/anti-rug/detectorEvaluator.test.ts
- Detector lifecycle (heartbeat/reconnect/backfill): tests in test/unit/anti-rug/detectorLifecycle.test.ts
- Exit engine reason union: 7 tests in test/unit/exitEngine/antiRugReason.test.ts
- Circuit breaker: 8 tests in test/unit/anti-rug/circuitBreaker.test.ts
- ExitTrigger: 6 tests in test/unit/anti-rug/exitTrigger.test.ts
- Race telemetry: 1 test (deferred — production wiring landed without coverage)
- Bot.ts wiring (integration): 10 tests in test/integration/anti-rug/botWiring.test.ts
- Multi-signal end-to-end: 9 tests in test/integration/anti-rug/multiSignalEnd2End.test.ts (Tests 15-23)
- Dashboard components: source-text guards + behavior tests in test/unit/dashboard/anti-rug/

**Test invariant defect:**
- Test 2 in test/unit/exitEngine/antiRugReason.test.ts is a SOURCE-TEXT REGEX check on the gasMultiplier derivation. It passes because lines 469-471 contain the expected regex pattern. It does NOT detect that line 475 `void gasMultiplier;` discards the value. This is a brittle test pattern documented in Plan 19-05 SUMMARY (`Test 2 (multi-line ternary regex with [\s\S]{0,80} between halves)`) and is the verification-process anti-pattern: "the truth `gasMultiplier is applied` is asserted via a source-grep, not a behavior assertion."

---

## Behavioral Spot-Checks

| Check | Method | Result | Status |
|---|---|---|---|
| `npm run test:unit` exits clean | runtime | exit 0 | **PASS** |
| `npm run test:integration` exits clean | runtime | exit 0 | **PASS** |
| `npx tsc --noEmit` (3 tsconfigs) clean | runtime | all clean | **PASS** |
| Anti-rug source files all exist | filesystem | 8/8 src files; 8/8 dashboard files; 4 test files; 2 doc files | **PASS** |
| Dry-run gate intercepts before executeFullSell | source trace | exitTrigger.ts:161 returns false BEFORE line 234 executeFullSell call | **PASS** |
| Multi-signal AND-chain composition | source read | `signal1Tripped && signal2Tripped && signal3Tripped` at detector.ts:1839 + 1929 | **PASS** |
| 36 ANTIRUG envs in .env.example | grep | 36 ANTIRUG_* matches | **PASS** |
| 36 ANTIRUG envs in REQUIRED_ENV_VARS | grep | 36 entries in config.ts | **PASS** |
| HARDCODED_V3_ALLOWLIST eth includes TeamFinance V3 entry | grep | line 499: `0xe2fe...35fb` ('TeamFinance / TrustSwap Lock ETH V2+V3 unified proxy') | **PASS** |
| OPERATOR-VERIFIED-NO-PINKLOCK-V3-eth comment present | grep | line 503 | **PASS** |
| 9 envs per chain documented | grep | docs/operations/anti-rug-rollout.md:25 "9 env vars per chain × 4 chains = 36" + table at line 40+ | **PASS** |
| Gas multiplier applied to fee fields | source trace | **NO** — `void gasMultiplier;` line 475 discards | **FAIL (Gap-1)** |
| `cb_tripped` / `cb_reset` broadcast types in useWebSocket | grep | lines 165, 175 | **PASS** |
| API route `/api/anti-rug/*` mounted | grep | server.ts:71 | **PASS** |
| RugPull.sol has 5 modes (0..4) | source read | constructor `require(_mode <= 4)` line 104 | **PASS** |

---

## Probe Execution

No phase-declared probes in PLAN/SUMMARY. No conventional `scripts/*/tests/probe-*.sh` files in this repository. Skipped per spec.

---

## Gaps Summary

### Gap-1: Anti-rug exit gas multiplier elevation not applied

**Severity:** WARNING (not BLOCKER because dry-run safety invariant fully intact and bot has zero open positions at ship)

**Description:** ROADMAP Phase 19 SC #1 requires "executeFullSell with reason='anti-rug' and a 2.0× gas multiplier". The reason discriminant IS propagated. The 2.0× elevation is NOT. `src/exitEngine.ts:469-475` derives `gasMultiplier` then immediately discards via `void gasMultiplier;`. Plan 19-05 SUMMARY explicitly documents this as a deviation with a follow-up commitment; no follow-up plan exists. Operator docs (docs/operations/anti-rug-rollout.md:47) and README.md (lines 21, 302, 448) misleadingly state the multiplier is applied.

**Test gap:** Test 2 in test/unit/exitEngine/antiRugReason.test.ts is a source-text regex that does NOT catch the discard. A behavior assertion testing actual `maxFeePerGas` values on the submitted tx would catch it.

**Operator impact path:**
- Default deploy: dry-run → no impact.
- After 7-day dry-run + 0-FP review + per-chain `ANTIRUG_LIVE_EXECUTE=true` + restart → live anti-rug exits would use 1× chain-multiplier gas (actually raw feeData since MEV strategies bypass gasManager too — broader pre-existing issue), not the documented 2× elevation. Frontrun success rate against rug-pull txs would be lower than the 30-40% baseline assumed in CONTEXT.md "real capital context."

**Remediation options (operator decision):**
1. **Implement before live**: Thread `ctx.chain.antiRug.gasMultiplier` into `buildV2SellTx` + `buildV3SellTx` (via shallow-config override per PLAN.md Step 1(b) OR an explicit `gasMultiplier` builder arg), AND patch MEV strategies (passthrough.ts:45-46, flashbots.ts:54) to apply the multiplier to `feeData`. Add a behavior test (not source-text) asserting on-chain `maxFeePerGas` ≈ feeData.maxFeePerGas × 2.0 when reason='anti-rug'.
2. **Document deviation**: Update docs/operations/anti-rug-rollout.md + README.md + ROADMAP SC #1 to accurately describe current behavior (`reason='anti-rug'` discriminant propagated through alert headers; gas-field elevation deferred to a future plan).
3. **Defer with explicit follow-up**: Create a follow-up plan in Phase 21 (EXIT-LIVE) or a decimal 19.1 phase to thread the multiplier; mark in REQUIREMENTS.md table that ANTIRUG-08 is partial.

### Gap-2: REQUIREMENTS.md inline checkbox state inconsistent with table

**Severity:** WARNING (book-keeping defect)

**Description:** Six requirements (ANTIRUG-05/07/08/09/14/15) have unchecked inline `[ ]` boxes but are listed Complete/Partial in the bottom coverage table. ANTIRUG-13 has the inverse problem (`[x]` inline but Pending in table).

**Remediation:** One-commit sweep to align inline checkboxes with the canonical bottom-table status.

---

## Deferred Items

These items are not yet complete but are explicitly scheduled/documented in later phases or follow-up tracking. They do NOT block Phase 19 closure.

| # | Truth | Addressed In | Evidence |
|---|---|---|---|
| D-1 | V3 real-mainnet rug fixture pinned (eth-v3-CANDIDATE.json fully resolved) | Phase 19 Wave-1 follow-up during 7-day dry-run window | test/fork/fixtures/rugs/README.md §"Outstanding Block-Pin Verification" tracker; docs/operations/anti-rug-rollout.md §"V3 rug-fixture backfill" procedure |
| D-2 | BSC/Base/Arb V3 allowlist entries (TeamFinance V3 + PinkLock V3) | Per-chain-enable preflight (currently `ENABLED_CHAINS=eth` only) | `PHASE-19-BLOCKER-4-ESCALATION` comments in src/chainRegistry.ts:522, 531, 548; ANTIRUG-15 marked Partial in REQUIREMENTS.md table |
| D-3 | Detection-latency histogram populated in FrontrunDistributionPanel | Future plan to wire raceTelemetry payload onto AntiRugEvent | dashboard/src/components/anti-rug/FrontrunDistributionPanel.tsx:74-82 inline comment + Plan 19-05 SUMMARY §"Open Questions for Downstream Plans" |
| D-4 | Fork test execution against real archive RPC | Operator runs `npm run test:fork` against personal Alchemy archive RPC during 7-day dry-run window | test/fork/antiRugDetector.fork.test.ts chainGuard pattern at line 724 (`'chainGuardOk=false — skipping HORSE replay'`) |

---

## Human Verification Required

### 1. Operator review of Gap-1 (gas multiplier deviation)

**Test:** Read Plan 19-05 SUMMARY decisions §1 + read src/exitEngine.ts:469-475 + read src/utils/mevStrategies/{passthrough,flashbots}.ts + read docs/operations/anti-rug-rollout.md:47. Decide which remediation path to take (implement before live / document deviation / defer with follow-up plan).
**Expected:** Owner makes a real-capital-safety decision. Phase 19 PARTIAL-PASS verdict resolves to either PASS (after remediation/documentation) or stays PARTIAL-PASS with documented deferral.
**Why human:** This is a documented deviation requiring operator capital-safety judgment. The verifier cannot decide whether the 2× elevation is materially important on real-mainnet anti-rug exits — that's a real-capital-risk-tolerance call.

### 2. Operator validates fork test against personal Alchemy archive RPC

**Test:** Run `ETH_FORK_RPC_URL=<alchemy archive> npm run test:fork -- antiRugDetector` from local environment.
**Expected:** RugPull mode 0..4 tests pass + HORSE V2 replay verifies multi-signal AND chain returns `verdict='unsafe'` against the real eth-v2-horse.json fixture at block 18401608.
**Why human:** No archive RPC available in this verification session (port 8545 held by orphan node.exe per phase facts). Operator runs locally to validate the fork test infrastructure on real mainnet state.

---

## Verdict: PARTIAL-PASS

**Phase 19 is functional for its stated dry-run default deployment but has a documented gas-multiplier deviation that must be resolved before per-chain live-mode graduation.**

**What works (4 of 5 SC fully verified):**
- Multi-signal AND chain (V2 + V3 + V3 Burn-without-Collect grace window) — VERIFIED
- Dry-run gate prevents any executeFullSell call when `liveExecute=false` — VERIFIED with full source trace
- WS lifecycle (heartbeat / reconnect / backfill / HTTP polling fallback) — VERIFIED
- Per-chain circuit breaker with manual dashboard reset — VERIFIED
- Allowlist (V2 + V3) with ETH locker resolution + env overlay — VERIFIED
- bot.ts buy-success attach pairs (V2 + V3) + resumeAntiRugMonitoring — VERIFIED
- Schema migration v4→v5 (lp_baseline + chain_state) — VERIFIED
- 36 ANTIRUG envs in .env.example + REQUIRED_ENV_VARS (D-ENV-EXAMPLE USER-BINDING) — VERIFIED
- Operator handoff docs (D-OPERATOR-HANDOFF USER-BINDING) — VERIFIED with one inaccuracy (Gap-1)
- Dashboard: 8 components + Overview.tsx mounting + PositionTable column + useWebSocket dispatch — VERIFIED
- 478 unit + 168 integration tests, tsc clean ×3 — VERIFIED

**What doesn't (Gap-1):**
- ROADMAP SC #1's "2.0× gas multiplier" claim — NOT APPLIED. Plan 19-05 SUMMARY documents the deviation; operator docs misrepresent current behavior. Test 2 is a source-text regex that doesn't catch the discard.

**What's deferred (does not block ship):**
- V3 real-mainnet rug fixture pin (Wave-1 follow-up)
- BSC/Base/Arb V3 allowlist (per-chain-enable preflight)
- Detection-latency histogram payload (future plan)
- Fork test execution (operator runs locally)

**Capital safety status:** Bot ships with `ANTIRUG_LIVE_EXECUTE=false` on all chains. Owner action required to graduate per chain (7-day floor + 0-FP review + restart). The dry-run safety invariant is fully intact — no code path bypasses the gate. The gas-multiplier gap is dormant until live-mode graduation.

**Recommendation:** Resolve Gap-1 (either implementation or accurate documentation) before any per-chain `ANTIRUG_LIVE_EXECUTE=true` flip. Resolve Gap-2 with a one-commit sweep of REQUIREMENTS.md inline checkboxes.

---

*Verified: 2026-05-24T05:15:00Z*
*Verifier: Claude (gsd-verifier)*
*Verification artifacts: .planning/phases/19-anti-rug-runtime-monitoring/19-VERIFICATION.md (this file)*
