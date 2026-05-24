---
phase: 19
slug: anti-rug-runtime-monitoring
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-23
updated: 2026-05-24
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source-of-truth coverage lives in `19-RESEARCH.md` §"Validation Architecture".
> Per-Task Verification Map populated retroactively by `/gsd:validate-phase 19` on 2026-05-24.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (projects: unit / integration / fork) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test:unit -- anti-rug` |
| **Full suite command** | `npm run test:unit && npm run test:integration` |
| **Fork suite command** | `npm run test:fork` (ALLOW_REAL_MAINNET=1 + ETH_FORK_RPC_URL gated) |
| **Estimated runtime** | ~3s unit-anti-rug / ~1.5s integration-anti-rug / ~2min fork (when gated on) |
| **Mock policy** | `mockReset: true` on unit + integration projects; `vi.mock('ethers')` + globalThis bridge for per-Contract dispatch |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- anti-rug` (≤ 5s)
- **After every plan wave:** Run `npm run test:unit && npm run test:integration` (≤ 30s)
- **Before `/gsd:verify-work`:** Full suite (`npm run test:unit && npm run test:integration`) must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01 | W0 | ANTIRUG-04 (lp_baseline + chain_state schema v4→v5) | T-19-01-01..05 | Additive-only migration; FK→trades(id); CHECK(pool_type IN v2/v3); ON CONFLICT UPSERT semantics | unit | `npm run test:unit -- db/lpBaselineMigration` | ✅ | ✅ green (12/12) |
| 19-01 | W0 | ANTIRUG-16 (V3 lp_baseline row shape) | T-19-01-04 | V3 columns NULL when pool_type='v2' and vice versa; v3_position_nft_id nullable | unit | `npm run test:unit -- db/lpBaselineMigration` (Tests 5+9) | ✅ | ✅ green |
| 19-02 | W1 | ANTIRUG-06 (hardcoded allowlist + env-overlay) | T-19-02-01..04 | All hardcoded addrs validate via `ethers.getAddress`; LIVE_EXECUTE strict-match `'true'` only; backfill cap+max validation | unit | `npm run test:unit -- chainRegistry/antiRugConfig` | ✅ | ✅ green (26/26) |
| 19-02 | W1 | ANTIRUG-15 (V3 allowlist per chain — ETH resolved) | T-19-02-05 | UNCX V3 + TeamFinance V3 (unified V2/V3 proxy) per chain; PinkLock V3 verified non-existent on ETH | unit | `npm run test:unit -- chainRegistry/antiRugConfig` | ✅ | ✅ green for ETH; ⚠ BSC/Base/Arb operator-accepted-gap (see Manual-Only) |
| 19-03 | W1 | ANTIRUG-04/16 contract (types.ts + LpBaselineRow domain shape) | T-19-03-01 | RugEvaluation 4-variant discriminated union; vacuous-pass unrepresentable via @ts-expect-error gate | unit | `npm run test:unit -- anti-rug/types` | ✅ | ✅ green (11/11) |
| 19-03 | W1 | ANTIRUG-06 (verifyAllowlistAtStartup + isAddressAllowlisted + mergeAllowlist) | T-19-03-02..04 | D-LIST-VERIFY getCode() + log.fatal + process.exit(1) on EOA; case-insensitive lookup; DEAD_ADDRESS skip | unit | `npm run test:unit -- anti-rug/allowlist` | ✅ | ✅ green (9/9) |
| 19-03 | W1 | ANTIRUG-16 (snapshotLpBaseline / loadLpBaseline / clearLpBaseline) | T-19-03-05..07 | V2 (reserves+totalSupply) vs V3 (liquidity+slot0) dispatch via dex.dexType; error propagation (no try/catch swallow) | unit | `npm run test:unit -- anti-rug/lpBaseline` | ✅ | ✅ green (9/9) |
| 19-04a | W1 | ANTIRUG-01 (single-listener-per-chain WS subscription) | T-19-04a-01..03 | Drop+recreate filter rewiring via `wsProvider.off(activeFilter, activeDispatcher)`; topic+address union | unit | `npm run test:unit -- anti-rug/detectorRegistry` | ✅ | ✅ green (11/11) |
| 19-04a | W1 | ANTIRUG-02 (V2 Pair.Burn topic) + ANTIRUG-03 (LP Transfer-to-dEaD topic) | T-19-04a-02 | Both topics in per-chain WS topic-filter union; address filter is union of all registered pair addresses lowercased | unit | `npm run test:unit -- anti-rug/detectorRegistry` (Tests A1, A4) | ✅ | ✅ green |
| 19-04a | W1 | ANTIRUG-13 (V3 Burn + Collect topics) | T-19-04a-04 | POOL_BURN_TOPIC + POOL_COLLECT_TOPIC in topic-filter union; V2+V3 mixed → UNION of all four | unit | `npm run test:unit -- anti-rug/detectorRegistry` (Tests A2, A3) | ✅ | ✅ green |
| 19-04a | W1 | chunked getLogs primitive (consumed by 19-04c backfill) | T-19-04a-05 | 6-chunk math for [100,150] cap=10; rejection propagates; off-by-one boundary enforced | unit | `npm run test:unit -- anti-rug/detectorRegistry` (Tests A6-A8) | ✅ | ✅ green |
| 19-04b | W1 | ANTIRUG-05 (multi-signal AND-chain — V2 path) | T-19-04b-01..03 | Single-signal trips → safe/partial-signal; all-three → unsafe/three-signal-trigger; allowlist short-circuit | unit | `npm run test:unit -- anti-rug/detectorEvaluator` (Tests 1-6) | ✅ | ✅ green (6/6) |
| 19-04b | W1 | ANTIRUG-13 + ANTIRUG-14 (V3 multi-signal — Collect arrival) | T-19-04b-04 | V3 path: liquidity drop + owner allowlist + QuoterV2 sell-sim; QuoterV2 revert → signal-3 trip (fail-closed) | unit | `npm run test:unit -- anti-rug/detectorEvaluator` (Tests 7-9) | ✅ | ✅ green |
| 19-04b | W1 | ANTIRUG-14 (V3 Burn-without-Collect grace window) | T-19-04b-05 | LAST-WINS pendingV3Burn semantics; block-watcher self-cleanup; grace timeout fires deterministic verdict | unit | `npm run test:unit -- anti-rug/detectorEvaluator` (Tests 10, 10b, 10c, 10d) | ✅ | ✅ green |
| 19-04b | W1 | ANTIRUG-07 (confirm-after-N-blocks gate) | T-19-04b-06 | scheduleConfirmBlocksGate via httpProvider.on('block'); de-trip aborts dispatch; confirmBlocks=0 → synchronous | unit | `npm run test:unit -- anti-rug/detectorEvaluator` (Tests 11-13) | ✅ | ✅ green |
| 19-04b | W1 | Vacuous-pass guard (fail-closed RPC error → verdict=unknown) | T-19-04b-07 | RPC error path returns verdict='unknown' with reason; NEVER verdict='safe' without 'partial-signal' reason | unit | `npm run test:unit -- anti-rug/detectorEvaluator` (Test 17) | ✅ | ✅ green |
| 19-04c | W1 | ANTIRUG-11 (WS reconnect-resubscribe-backfill) | T-19-04c-01..04 | Exponential-backoff 1s→60s cap; idempotency guard; `removeWsProvider` cleanup; re-subscribe re-arms heartbeat | integration | `npm run test:integration -- anti-rug/wsReconnectBackfill` (Tests 22, 27, 28) | ✅ | ✅ green |
| 19-04c | W1 | ANTIRUG-12 (heartbeat ping/pong/terminate) | T-19-04c-05 | 30s isAlive cycle on (provider as any).websocket; ws.terminate() triggers 'close' handler | integration | `npm run test:integration -- anti-rug/wsReconnectBackfill` (Test 21) | ✅ | ✅ green |
| 19-04c | W1 | Backfill via chunked getLogs (read-only on exit-path) | T-19-04c-06 | backfilled events evaluate but NEVER call triggerAntiRugExit; antirug.backfill.too-late log + broadcast | integration | `npm run test:integration -- anti-rug/wsReconnectBackfill` (Tests 23, 24, 25, 29) | ✅ | ✅ green |
| 19-04c | W1 | D-BACKFILL FAIL-CLOSED on gap > maxBackfillBlocks | T-19-04c-07 | [GAP DETECTED] sendCtxAlert + broadcast antirug_event; NO partial backfill; chain_state advanced | integration | `npm run test:integration -- anti-rug/wsReconnectBackfill` (Test 29) | ✅ | ✅ green |
| 19-04c | W1 | HTTP polling fallback for WS-less chains | T-19-04c-08 | 2s setInterval polls getLogs over (lastBlock+1, currentBlock); LIVE dispatch via dispatchEvent | integration | `npm run test:integration -- anti-rug/wsReconnectBackfill` (Test 26) | ✅ | ✅ green |
| 19-04c | W1 | Tiered D-VIS-WS-HEALTH alerts (3 + 60s + gap-detected) | T-19-04c-09 | Single-firing per-loop boolean flags; never alert spam during sustained outage | integration | `npm run test:integration -- anti-rug/wsReconnectBackfill` (Tests 27, 28, 29) | ✅ | ✅ green |
| 19-05 | W1 | ANTIRUG-08 (executeFullSell bridge with reason='anti-rug') | T-19-05-01..03 | Reason union extended; unsubscribeAntiRug at 3 full-close paths; partial-sell preserves subscription | unit | `npm run test:unit -- exitEngine/antiRugReason` | ✅ | ✅ green (7/7) |
| 19-05 | W1 | ANTIRUG-08 (elevated gas multiplier 2.0× via [ANTI-RUG EXIT] alert) | T-19-05-04 | gasMultiplier surfaces via alert header; ternary `reason === 'anti-rug' ? antiRug.gasMultiplier : gas.multiplier` | unit | `npm run test:unit -- exitEngine/antiRugReason` (Test 2) | ✅ | ✅ green |
| 19-05 | W1 | ANTIRUG-09 (per-chain circuit breaker) | T-19-05-05..07 | Rolling window timestamp dropping; ring buffer eviction at CB threshold; single-firing trip side effects | unit | `npm run test:unit -- anti-rug/circuitBreaker` | ✅ | ✅ green (8/8) |
| 19-05 | W1 | ANTIRUG-10 (dry-run gate) + CB gate in exitTrigger | T-19-05-08..09 | !liveExecute → would-have-sold + return false; CB tripped → exit-suppressed; clearAllTimers FIRST | unit | `npm run test:unit -- anti-rug/exitTrigger` | ✅ | ✅ green (6/6) |
| 19-05 | W1 | D-RACE-TELEMETRY measurement (detection latency) | T-19-05-10 | measureDetectionLatency wall-clock ms; flashbotsRaceVerdict via eth_callBundle; postHocReality V2/V3 | unit | `npm run test:unit -- anti-rug/raceTelemetry` | ✅ | ✅ green (1/1; fork tests in 19-07) |
| 19-05 | W1 | bot.ts wiring (V2 + V3 attach + resumeAntiRugMonitoring) | T-19-05-11..13 | Try/catch attach; baseline-failure → UNMONITORED + exit monitor still active; INNER JOIN trades+lp_baseline | integration | `npm run test:integration -- anti-rug/botWiring` | ✅ | ✅ green (10/10) |
| 19-06 | W1 | ANTIRUG-09 (CB reset endpoint + dashboard UI) | T-19-06-01..04 | POST /api/anti-rug/circuit-breaker/:chain/reset (404/409/200/500); N-acknowledge + Type RESET gate | unit | `npm run test:unit -- api/antiRug` | ✅ | ✅ green (15/15) |
| 19-06 | W1 | ANTIRUG-10 (dashboard dry-run telemetry surfaces) | T-19-06-05..07 | 8 components + WS event dispatch + Position field extension + colSpan adjustment | unit | `npm run test:unit -- dashboard/anti-rug/displayComponents` + `dashboard/anti-rug/interactiveComponents` | ✅ | ✅ green (67/67 source-grep) |
| 19-07 | W1 | RugPull.sol contrived fixture (modes 0-4) | T-19-07-01 | 5-mode discriminated rug ERC20; inline V2/V3 event emissions; detector dispatches by topic+address | fork | `npx vitest run --project fork test/fork/antiRugDetector.fork.test.ts` | ✅ | ✅ green (5 modes + smoke) |
| 19-07 | W1 | HORSE V2 mainnet replay fixture (ALLOW_REAL_MAINNET-gated) | T-19-07-02 | Pinned at block 18401608; run-time tokenAddress + destinationOnBurn resolution via getTransactionReceipt | fork | `ALLOW_REAL_MAINNET=1 ETH_FORK_RPC_URL=… npx vitest run --project fork` | ✅ | ⚪ skips in CI; manual when operator runs locally |
| 19-07 | W1 | End-to-end pipeline (snapshot→register→event→evaluate→confirm→triggerAntiRugExit) | T-19-07-03..09 | 9 e2e tests cover dry-run / live / allowlist / partial / vacuous / de-trip / CB / partial-sell / full-close | integration | `npm run test:integration -- anti-rug/multiSignalEnd2End` | ✅ | ✅ green (9/9) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · ⚪ env-gated skip*

---

## Wave 0 Requirements

- [x] `test/fixtures/contracts/RugPull.sol` — contrived V2 + V3 rug contract (CONTEXT.md D-LIST-FIXTURE) — **shipped Plan 19-07 commit `731608b`**
- [x] `test/fork/fixtures/rugs/eth-v2-horse.json` — real V2 mainnet rug fixture (HORSE token, block 18401609 per 19-RESEARCH.md §10) — **shipped Plan 19-07 commit `731608b`** (renamed from working name `horse-v2.json`)
- [x] `test/fork/fixtures/rugs/eth-v3-CANDIDATE.json` — V3 skeleton fixture (Wave-1 operator backfill during 7-day dry-run window per Plan 19-07 §Operator-Handoff Notes) — **shipped Plan 19-07 commit `731608b`**
- [x] `test/fork/fixtures/rugs/README.md` — fixture schema doc + Wave-1 tracker — **shipped Plan 19-07 commit `731608b`**
- [x] Multi-signal evaluation fixtures (inline per-test via `vi.mock('ethers')` + globalThis bridge pattern from Plan 19-04b)
- [x] Fake WSProvider for reconnect/backfill drills (inline in `test/integration/anti-rug/wsReconnectBackfill.test.ts` per Plan 19-04c)
- [x] `lp_baseline` schema migration v4→v5 stubs for in-memory better-sqlite3 (`Database(':memory:')` per-test in `lpBaselineMigration.test.ts` per Plan 19-01)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `.env.example` updated with 9 anti-rug env vars per chain × 4 chains = 36 entries (CONTEXT.md D-ENV-EXAMPLE called for 7 envs; Plan 19-02 ships 9 per Warning-5 acknowledgment + 19-RESEARCH.md CRITICAL #1 Alchemy free-tier 10-block getLogs cap) | D-ENV-EXAMPLE [USER-BINDING] | Visual diff against canonical list + inline-comment quality check | `grep -c "_ANTIRUG_" .env.example` → expected 36; inspect inline comments for each chain block |
| `docs/operations/anti-rug-rollout.md` covers .env / restart / per-chain verify / circuit-breaker reset / WS-disconnect troubleshooting / Wave-1 V3 follow-up | D-OPERATOR-HANDOFF [USER-BINDING] | Operator-readable prose; coherence check | Operator reads document end-to-end before phase close; Plan 19-08 Task 3 deferred to post-phase per spawn-prompt |
| `docs/operations/anti-rug-tuning.md` covers tunable parameters + review cadence + audit trail | D-TUNE-PROTOCOL | Operator-readable prose; threshold-tuning judgment | Operator reads tuning doc + reviews Frontrun Outcome Distribution panel during 7-day dry-run window |
| Real-mainnet HORSE rug fixture replay produces expected multi-signal verdict on fork | ANTIRUG-05 (V2 success-criterion 1) | Fork-test requires Alchemy archive RPC + ALLOW_REAL_MAINNET=1; CI never sets gate | `export ALLOW_REAL_MAINNET=1; export ETH_FORK_RPC_URL=…; npx hardhat node --fork "$ETH_FORK_RPC_URL"; npx vitest run --project fork test/fork/antiRugDetector.fork.test.ts` |
| Dashboard "Anti-Rug" column renders 6 state badges correctly (live / dry-run / would-have-sold / exit-fired / halted / unmonitored) | D-VIS-PER-POSITION | Visual UI DOM rendering; dashboard lacks `@testing-library/react`/jsdom by design per Plan 19-06 §1 (would force new dev deps) | Operator clicks each badge state in dev dashboard; covered in Plan 19-07 operator-visual checker |
| Dashboard circuit-breaker banner (red full-bleed) + reset modal flow (N acknowledge + Type RESET + POST endpoint + inline error rendering) | D-VIS-CB-TRIPPED | Visual UI + interaction; runtime DOM behaviour | Operator triggers test CB (3 unsafe verdicts in 1h), confirms banner, opens modal, acknowledges each trigger, types RESET, confirms reset clears state |
| Dashboard WS-health indicator (🟢 connected / 🟡 reconnecting / 🔴 disconnected) per chain | D-VIS-WS-HEALTH | Visual UI; runtime tooltip verification | Operator kills WS mid-flight, observes 🟢→🟡→🟢 transitions and verbatim tooltip strings per Plan 19-06 component contract |
| Dashboard [GAP DETECTED] banner per (chain, fromBlock) with localStorage dismissal | D-BACKFILL gap-detected visualisation | Visual UI + localStorage persistence; per-(chain, fromBlock) key check | Operator induces backfill gap > maxBackfillBlocks, confirms banner copy + dismiss button + reload-shows-no-banner; new gap event with different fromBlock re-shows |
| Per-chain LIVE-mode graduation per D-LIVE-GATE (7 calendar days + every-trigger review + 0 confirmed FPs) | D-LIVE-GATE [USER-BINDING] | Operator judgment over 7-day window; manual `vim .env` + restart | Operator completes dry-run window, reviews FrontrunDistributionPanel telemetry per `anti-rug-tuning.md`, flips `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true`, restarts bot |
| BSC / Base / Arb V3 allowlist resolution (TeamFinance V3 + PinkLock V3 per chain) — pre-enable verification | ANTIRUG-15 [USER-BINDING] partial | Operator-accepted-gap; chains not in ENABLED_CHAINS at ship | Operator follows Wave-1 follow-up protocol in `docs/operations/anti-rug-rollout.md §7` before enabling any of BSC/Base/Arb |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — **31 plan-task rows in Per-Task Map; every closed ANTIRUG-* (01-14, 16) has an automated test command + green status**
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — **every plan in 19-01 through 19-07 ships RED/GREEN TDD commit pair; only 19-08 is docs-only (no tests by design)**
- [x] Wave 0 covers all MISSING references (RugPull.sol contract + horse-v2.json fixture) — **shipped in Plan 19-07 commit `731608b`**
- [x] No watch-mode flags in scripts — **`package.json` `test:unit` + `test:integration` + `test:fork` use `vitest run` (NOT `vitest` watch)**
- [x] Feedback latency < 90s — **anti-rug unit suite ~3s; full integration ~1.5s; full suite well under 30s**
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** Nyquist-compliant; phase 19 closes with all testable ANTIRUG requirements automated. Operator-facing manual-only items (dashboard DOM + 7-day live graduation + Wave-1 V3 backfill) are by-design human-gates per D-OPERATOR-HANDOFF, not validation gaps.

---

## Validation Audit 2026-05-24

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Per-Task Map rows populated | 31 |
| ANTIRUG-* requirements COVERED | 15 (01-14, 16) |
| ANTIRUG-* requirements PARTIAL | 1 (ANTIRUG-15 — ETH covered, BSC/Base/Arb operator-accepted-gap per Plan 19-08 Wave-1 tracker) |
| Wave 0 dependencies satisfied | 7 / 7 |
| Manual-Only entries (operator-driven, by design) | 10 |
| Automated tests in scope | 140 unit (anti-rug) + 7 (exitEngine antiRugReason) + 12 (db/lpBaselineMigration) + 26 (chainRegistry/antiRugConfig) + 15 (api/antiRug) + 67 (dashboard source-grep) + 28 (integration) + 6 (fork) = **301 tests** |
| Full suite green at audit time | unit 478/478, integration 168/168, fork 5/6 (HORSE Test 7 ALLOW_REAL_MAINNET-gated skip) |

Methodology: read all 10 plan SUMMARYs + REQUIREMENTS.md ANTIRUG-01..16; verified test files via `Glob`; ran `npm run test:unit -- anti-rug` (140/140 green) + `npx vitest run --project integration test/integration/anti-rug` (28/28 green); cross-referenced each requirement to its closing plan + test file. No gaps found — every code-testable behavior already has a passing automated test from Plans 19-01 through 19-07's RED/GREEN TDD discipline.
