---
phase: 19
slug: anti-rug-runtime-monitoring
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-24
---

# Phase 19 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail
> for the anti-rug runtime monitoring system (Plans 19-01..19-08).
>
> **Register authored at plan time.** No retroactive STRIDE was performed by the
> auditor; this document verifies that each declared mitigation is present in
> the implementation. The register is the union of `<threat_model>` blocks from
> the 10 plan files in `.planning/phases/19-anti-rug-runtime-monitoring/`.

---

## Trust Boundaries

Consolidated from all 10 plan trust-boundary tables; deduplicated by description.

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| local SQLite file (`data/bot.db`) | Bot-owned persistent state; only bot process writes. Boundary between in-memory app state and on-disk state. | trades, lp_baseline, chain_state, exit_state rows |
| schema migration step (`migrateSchema` v4→v5) | Run at startup; malformed migration risks data loss against prior-version DB. | DDL statements + `user_version` pragma |
| `.env` file → `process.env` | Operator-supplied secrets/config cross into the bot at startup; invalid values must FATAL-exit. | API keys, RPC URLs, anti-rug thresholds, liveExecute flag |
| hardcoded allowlist constants (`src/chainRegistry.ts`) | Source-of-truth lockers in git history; typo = silent allowlist hole (EOA pass-through). | checksummed addresses + locker metadata |
| `<PREFIX>_ANTIRUG_ALLOWLIST_EXTRA[_V2/_V3]` env overlay | Operator-supplied locker addresses cross from .env into merged allowlist; per D-LIST-SOURCE. | comma-separated checksummed addresses |
| `ctx.httpProvider.getCode()` RPC response | External RPC reply controls whether `verifyAllowlistAtStartup` proceeds. | bytecode strings |
| `lp_baseline` write at buy success | On-chain `getReserves` / `liquidity` values flow into persistent storage; stale/manipulated values affect signal-1. | V2 reserves, LP supply, V3 active liquidity |
| event-decoding ABIs (`src/anti-rug/events.ts`) | Wrong topic hash → no events match → silent monitor failure. | topic hashes computed via `ethers.id(...)` |
| WebSocket Log event payload | External (RPC-controlled) input crosses into the dispatcher; multi-signal AND chain mitigates by construction. | event topics, addresses, data fields |
| `pool.liquidity()` / `pair.getReserves()` view-call at evaluation time | External view-call result feeds signal-1; multi-signal AND chain mitigates. | bigint reserves, liquidity, totalSupply |
| `QuoterV2.staticCall` response | External view-call result feeds signal-3; revert is treated as signal-3 trip per fail-closed. | quote output amounts |
| V3 Burn grace window block-watch | Internal block-number watch on `ctx.httpProvider` (survives WS reconnect). | block numbers |
| confirm-after-N-blocks gate | Internal block-number watch on `ctx.httpProvider`. | block numbers |
| WebSocket heartbeat ping/pong | External timing-channel; absence of pong is the failure signal. | ws ping/pong frames |
| `getLogs` backfill response | External input on reconnect; gap > maxBackfillBlocks FAILS CLOSED. | historical log events |
| `getChainState` SQLite read at reconnect time | Internal trusted boundary; corrupted state theoretically possible only if SQLite file tampered externally. | chain_state row |
| `sendCtxAlert` Telegram + `broadcast` WS | External comm channels; failure should degrade gracefully. | alert text, broadcast payloads |
| `executeFullSell` reason union | Type-system boundary; stringified reason variant outside union fails compilation. | union type values |
| `triggerAntiRugExit` dry-run gate | env-driven (`ctx.chain.antiRug.liveExecute`) — single gate between observability-only and capital movement. | boolean flag |
| circuit breaker tripped state | In-memory state crosses request lifecycles. | per-chain timestamps + tripped Set |
| `resumeAntiRugMonitoring` DB query | Data crosses from SQLite into in-memory position registry at restart. | open-position rows + baselines |
| `snapshotLpBaseline` at buy success | Wrapped in try/catch; failure must not block the buy from completing. | reserves/liquidity values |
| Flashbots `eth_callBundle` auth | External API; failure degrades gracefully to telemetry-skip. | signed tx hex + simulate result |
| `POST /api/anti-rug/circuit-breaker/:chain/reset` operator endpoint | Authenticated operator request crosses into bot process. | chain identifier + auth header |
| `CircuitBreakerResetModal` UI gate (N-acknowledge + RESET-text) | Client-side gate; UX safety, not access control. | checkbox state + confirm text |
| `useWebSocket.ts` switch dispatch (5 new events) | External (server-controlled) WS messages cross into dashboard state. | typed event payloads |
| `GapDetectedBanner` localStorage dismissal | Client-side state; survives browser refresh. | dismissal flag keyed by chain+fromBlock |
| operator-facing docs | Boundary between "Phase 19 ships safely" and operator misconfiguration → capital loss. | env-var defaults, procedural steps |
| `test/fixtures/contracts/RugPull.sol` events | Test-only contract emissions; production code never reads RugPull.sol directly. | event topics for fork tests |
| `eth-v2-horse.json` mainnet replay fixture | Fixture stores VERIFIED block + tx hash from RESEARCH §4.1. | pinned block + tx hash + addresses |
| `ALLOW_REAL_MAINNET=1` env gate on fork tests | Test infrastructure boundary; CI never sets it. | gating env value |

---

## Threat Register

71 declared threats across 10 plans. Disposition: `mitigate` = grep-verified in
implementation; `accept` = enrolled in Accepted Risks Log below;
`transfer` = not present in this phase. Evidence cells cite the file+line that
implements the mitigation pattern declared in the plan's `<threat_model>` block.

| Threat ID | Category | Component | Disposition | Mitigation Evidence | Status |
|-----------|----------|-----------|-------------|---------------------|--------|
| T-19-01-01 | Tampering | `migrateSchema` v4→v5 step | mitigate | `src/utils/db.ts:130,147` — `CREATE TABLE IF NOT EXISTS lp_baseline`, `CREATE TABLE IF NOT EXISTS chain_state` inside `if (version < 5)` block; `db.ts:156` writes `user_version` from constant `CURRENT_SCHEMA_VERSION = 5` (line 27). Migration is additive; existing tables untouched. | CLOSED |
| T-19-01-02 | Information disclosure | `lp_baseline.pair_or_pool_address` COLLATE NOCASE | accept | See Accepted Risks Log AR-19-01-02. | CLOSED |
| T-19-01-03 | Denial of service | `lp_baseline` table grows unbounded | accept | See Accepted Risks Log AR-19-01-03. | CLOSED |
| T-19-01-04 | Repudiation | Schema-migration log line | mitigate | `src/utils/db.ts:153` — `logger.info('Created lp_baseline + chain_state tables (schema version 5)')`. | CLOSED |
| T-19-02-01 | Tampering | hardcoded allowlist constants in chainRegistry.ts | mitigate | `src/chainRegistry.ts:417-544` — every hardcoded allowlist entry wrapped in `ethers.getAddress(...)` (17 occurrences across V2 + V3 lists × 4 chains). Typos throw at module load. | CLOSED |
| T-19-02-02 | Spoofing | `<PREFIX>_ANTIRUG_ALLOWLIST_EXTRA` env overlay | mitigate | `src/chainRegistry.ts:841` — operator overlay parsed via `ethers.getAddress(tok)` inside `parseAllowlistExtra`; FATAL exit at line 848-857 (`log.fatal` + `process.exit(1)`) on invalid checksum. Runtime getCode() check is `src/anti-rug/allowlist.ts:135`. | CLOSED |
| T-19-02-03 | Information disclosure | `_ANTIRUG_LIVE_EXECUTE=true` accidentally committed to .env.example | accept | See Accepted Risks Log AR-19-02-03. Defaults in `.env.example:129,142,155,168` all `=false`. | CLOSED |
| T-19-02-04 | Denial of service | invalid env value (NaN, negative, out-of-range) | mitigate | `src/chainRegistry.ts:655-817` — 11 `log.fatal` + `process.exit(1)` validation branches matching Phase 18 max-buy-tax-bps validator pattern (one per numeric env). | CLOSED |
| T-19-02-05 | Elevation of privilege | env-overlay merged into both V2 and V3 allowlists | accept | See Accepted Risks Log AR-19-02-05. D-LIST-SOURCE explicit authorization; mitigated by getCode() check. New separate `ALLOWLIST_EXTRA_V2/V3` envs (commit `e42c21b`) reduce surface. | CLOSED |
| T-19-02-06 | Configuration drift | `_ANTIRUG_BACKFILL_CAP_BLOCKS` mismatched against RPC tier | mitigate | `.env.example:135` — ETH default `=10` with comment "Alchemy free-tier safe per 19-RESEARCH.md CRITICAL #1"; BSC/Base/Arb default `=500`. `docs/operations/anti-rug-rollout.md` §1 documents upgrade procedure. | CLOSED |
| T-19-03-01 | Spoofing | RPC returns '0x' for a legitimate locker | accept | See Accepted Risks Log AR-19-03-01. Hostile-RPC threat model is operator-owned. | CLOSED |
| T-19-03-02 | Tampering | RPC returns stale reserves at buy success | mitigate | `src/anti-rug/lpBaseline.ts` — `Promise.all([pair.getReserves(), pair.totalSupply()])` at buy-success block; multi-signal AND chain (`src/anti-rug/detector.ts:1947-1948,2037-2038`) requires ALL THREE signals → stale baseline alone cannot fire exit. | CLOSED |
| T-19-03-03 | Information disclosure | log.info dump of merged allowlist at startup | accept | See Accepted Risks Log AR-19-03-03. D-LIST-VERIFY explicitly requires the dump. | CLOSED |
| T-19-03-04 | Repudiation | allowlist verification step skipped | mitigate | `src/bot.ts:1109` — `await verifyAllowlistAtStartup(ctx, allowlistV2, allowlistV3)` inside `resumeAntiRugMonitoring` before any detector listener starts. | CLOSED |
| T-19-03-05 | Denial of service | allowlist sized in the hundreds → startup time grows | accept | See Accepted Risks Log AR-19-03-05. Acceptable for manual-start ops process. | CLOSED |
| T-19-03-06 | Tampering | wrong topic hash in events.ts (silent monitor failure) | mitigate | `src/anti-rug/events.ts:81-93` — all 4 topic constants computed via `ethers.id(<signature>)` at module load; unit test `test/unit/anti-rug/types.test.ts` asserts equality (Tests 6-9 per Plan 19-03 Task 1). | CLOSED |
| T-19-03-07 | Elevation of privilege | DEAD_ADDRESS check uses case-insensitive comparison | mitigate | `src/anti-rug/allowlist.ts:131` — `entry.address.toLowerCase() === DEAD_ADDRESS` (lowercased canonical). | CLOSED |
| T-19-04a-01 | Spoofing | dispatchEvent receives event for unregistered address | mitigate | `src/anti-rug/detector.ts:1333+` — `dispatchEvent` looks up `positionRegistry.get(chainName)?.get(address) ?? []`; unmatched addresses produce empty array → no evaluation. Silent drop is correct routing semantic. | CLOSED |
| T-19-04a-02 | Tampering | hostile RPC injects events for registered address | accept | See Accepted Risks Log AR-19-04a-02. Multi-signal AND chain handles. | CLOSED |
| T-19-04a-03 | DoS | hostile event stream floods dispatcher | mitigate | `src/anti-rug/detector.ts:192` — single `positionRegistry` map (one subscription per chain per Pitfall #10); per-position evaluation is bounded by registered count. | CLOSED |
| T-19-04a-04 | Repudiation | registerAntiRugPosition fails silently if baseline missing | mitigate | `src/bot.ts:436-437` — try/catch with `op: 'antirug.baseline-snapshot-failed'` structured pino log on snapshotLpBaseline failure. | CLOSED |
| T-19-04a-05 | Tampering | getLogsForBackfill chunk math off-by-one | mitigate | `src/anti-rug/detector.ts:1102+` — chunk iteration `chunkStart += cap` with `chunkEnd = min(chunkStart + cap - 1, toBlock)` per RESEARCH CRITICAL #1; unit test Task 1 Test A6 asserts 5 chunks for 100→150 with cap=10. | CLOSED |
| T-19-04b-01 | Spoofing | malformed log event (wrong topic, indexed positions) | mitigate | `src/anti-rug/detector.ts:1977-1981, 2064-2068` — V2 + V3 evaluators wrap in try/catch; thrown errors return `{ verdict: 'unknown', reason: errMsg }`. Vacuous-pass to 'safe' impossible per discriminated union (`src/anti-rug/types.ts`). | CLOSED |
| T-19-04b-02 | Tampering | hostile RPC injects forged Burn event for allowlisted destination | accept | See Accepted Risks Log AR-19-04b-02. Multi-signal AND chain by construction. | CLOSED |
| T-19-04b-03 | Tampering | QuoterV2 staticCall returns manipulated (sandwiched) quote | mitigate | `src/anti-rug/detector.ts:1947-1948, 2037-2038` — verdict='unsafe' requires ALL THREE signals; sandwich on single block's quote alone is not rug indicator. | CLOSED |
| T-19-04b-04 | Repudiation | V3 Burn grace timeout dropped on WS reconnect | mitigate | `src/anti-rug/detector.ts:2111,2116,2145` — `ctx.httpProvider.on('block', blockHandler)` (NOT `ctx.wsProvider`). HTTP block subscription survives WS reconnect. Verified per 19-04c-SUMMARY lines 198-206. | CLOSED |
| T-19-04b-05 | Repudiation | confirm-after-N-blocks gate hangs on RPC drop | accept | See Accepted Risks Log AR-19-04b-05. Same gate uses httpProvider block-watch; worst case is late dispatch. | CLOSED |
| T-19-04b-06 | DoS | rapid V3 Burn events overwrite pendingV3Burn entry | mitigate | `src/anti-rug/detector.ts:2121-2131` — LAST-WINS semantics documented; the held entry always reflects most recent event; previous handler explicitly removed (WR-06). Test 10d covers. | CLOSED |
| T-19-04b-07 | Information disclosure | structured pino logs include addresses, signals, allowlist names | accept | See Accepted Risks Log AR-19-04b-07. Local-only operator UI. | CLOSED |
| T-19-04c-01 | Tampering | heartbeat silent failure (NAT timeout, half-open socket) | mitigate | `src/anti-rug/detector.ts:761,775,783,797` — `(rawWs as any).isAlive` flag forces pong-or-die at 30s ping interval; `rawWs.terminate()` on dead heartbeat triggers reconnect. | CLOSED |
| T-19-04c-02 | Repudiation | event processed but not logged in chain_state.last_seen_block | mitigate | `src/anti-rug/detector.ts:1010,1032,1071,1085,1191` — `upsertChainState.run(chainName, currentBlock, ts)` fires after every backfill completion + every HTTP poll. | CLOSED |
| T-19-04c-03 | DoS | hostile event stream floods reconnect machinery | mitigate | `src/anti-rug/detector.ts` reconnect with exponential backoff 1s→60s; single-listener-per-chain (Plan 19-04a) caps subscription count. | CLOSED |
| T-19-04c-04 | EoP | backfilled event fires live exit (anti-pattern) | mitigate | `src/anti-rug/detector.ts:1160,1164` — `op: 'antirug.backfill.too-late'` log + `broadcast('antirug_event', {...kind: 'trigger'..., outcome: 'too-late'})`; `triggerAntiRugExit` NEVER called inside backfill branch. | CLOSED |
| T-19-04c-05 | Info disclosure | tiered alerts include chain name, durations, missed-blocks | accept | See Accepted Risks Log AR-19-04c-05. Operational state; no PII. | CLOSED |
| T-19-04c-06 | Repudiation | tiered alert sendCtxAlert fails (Telegram down) | mitigate | `src/anti-rug/detector.ts:895,968` — alerts ALSO fire `log.error` / `log.warn` at structured pino level; structured logs retain event even if Telegram delivery fails. | CLOSED |
| T-19-04c-07 | Tampering | reconnect re-subscribes with stale address list | mitigate | `src/anti-rug/detector.ts` — `getRegisteredPositions(ctx.chain.name)` called at re-subscribe time (inside handleWsClose); reflects current registry. | CLOSED |
| T-19-04c-08 | DoS | hostile RPC drops connection rapidly | mitigate | `src/anti-rug/detector.ts` — exponential backoff caps cumulative attempts; tiered alerts (3-failed + >60s) surface to operator. | CLOSED |
| T-19-05-01 | Tampering | executeFullSell called with non-union reason value | mitigate | `src/exitEngine.ts:434` — `reason: 'trailing-stop' \| 'stop-loss' \| 'urgency-market-sell' \| 'anti-rug'` discriminated union; TypeScript enforces at compile time. | CLOSED |
| T-19-05-02 | Spoofing | dry-run gate bypassed | mitigate | `src/anti-rug/exitTrigger.ts:156,161` — `const liveExecute = ctx.chain.antiRug.liveExecute; if (!liveExecute) { ... return false; }`. Plan 19-02 validator enforces strict `=== 'true'` match. | CLOSED |
| T-19-05-03 | Repudiation | CB tripped but no Telegram + dashboard alert | mitigate | `src/anti-rug/circuitBreaker.ts:147,158` — `broadcast('cb_tripped', {...})` + `sendCtxAlert(ctx, '*[ANTI-RUG HALTED]*...')` + `log.fatal` in one atomic function. | CLOSED |
| T-19-05-04 | Tampering | concurrent triggerAntiRugExit calls for same trade | mitigate | `src/exitEngine.ts:438` — `tryAcquireSellLock(ctx.chain.name, tokenAddress)`; second call sees lock held and returns false. Confirm-after-N-blocks gate is per-trade. | CLOSED |
| T-19-05-05 | Denial of service | rapid CB trips on hostile event stream | mitigate | `src/anti-rug/exitTrigger.ts:203` — `if (isCircuitBreakerTripped(chain)) { ... return false; }` short-circuits all exits on tripped chain; operator manually resets. | CLOSED |
| T-19-05-06 | EoP | bot.ts buy-success baseline-snapshot failure leaves stale baseline | mitigate | `src/bot.ts:424` — `snapshotLpBaseline` uses `ON CONFLICT(trade_id) DO UPDATE`; fresh snapshot overrides stale. On failure, position UNMONITORED (does NOT register) per try/catch at `bot.ts:436-437`. | CLOSED |
| T-19-05-07 | Info disclosure | reasonDetail string leaks signal values into Telegram | accept | See Accepted Risks Log AR-19-05-07. Public on-chain data; UI-SPEC §"Cross-Cutting Constraints" item 2. | CLOSED |
| T-19-05-08 | Tampering | partial-sell path calls unsubscribeAntiRug | mitigate | `src/exitEngine.ts:454,540,554` — three unsubscribe call sites are ONLY on full-close paths (zero-balance, success, error). `executePartialSell` (line ~583+) NOT modified. | CLOSED |
| T-19-05-09 | Repudiation | resumeAntiRugMonitoring silently skips chain on RPC error | mitigate | `src/bot.ts` — `op: 'antirug.allowlist-verify-rpc-failed'` log per chain inside `resumeAntiRugMonitoring` try/catch; chain WS health stays disconnected. | CLOSED |
| T-19-05-10 | Tampering | Flashbots eth_callBundle false-positive coinbaseDiff | accept | See Accepted Risks Log AR-19-05-10. Race telemetry is dry-run-only; never gates live decision. | CLOSED |
| T-19-05-11 | EoP | gasMultiplier shallow-copy forgets downstream consumer | mitigate | `src/exitEngine.ts:472,494` — `const gasMultiplier = reason === 'anti-rug' ? ctx.chain.antiRug.gasMultiplier : undefined;` threaded through builders. Verification gap (`Gap-1`) closed in commit `7d35c46` per `19-VERIFICATION.md` lines 28-42 — gasMultiplier now reaches MevStrategy.sendTransaction + EIP-1559 fee fields. | CLOSED |
| T-19-05-12 | Repudiation | startMultiChainBot ordering — anti-rug before exit monitor | mitigate | `src/bot.ts:937` — `await resumeAntiRugMonitoring(contexts)` placed AFTER `resumeMultiChainMonitoring(contexts)` (line ~935). Test 26 asserts ordering. | CLOSED |
| T-19-06-01 | Spoofing | unauthenticated POST /reset | mitigate | `src/api/server.ts:71-72` — `apiRouter.use('/anti-rug', antiRugRoutes(contexts))` mounted under `app.use('/api', authMiddleware, apiRouter)`; auth runs before any anti-rug route handler. | CLOSED |
| T-19-06-02 | Tampering | operator skips checkbox-acknowledge gate via devtools | accept | See Accepted Risks Log AR-19-06-02. UX safety, not access control. | CLOSED |
| T-19-06-03 | Repudiation | CB reset endpoint succeeds but no audit trail | mitigate | `src/api/routes/antiRug.ts:67` — `resetCircuitBreaker(ctx)` invoked from handler triggers `src/anti-rug/circuitBreaker.ts:199` `broadcast('cb_reset', {...})` + structured pino info; EventFeed history retained. | CLOSED |
| T-19-06-04 | Denial of service | hostile WS message floods dashboard with fake-chain cb_tripped | mitigate | `dashboard/src/hooks/useWebSocket.ts:199-203` — `case 'cb_tripped'` setter only adds chain to map; banner renders chip only if `chain in contexts` (defensive narrowing). | CLOSED |
| T-19-06-05 | Information disclosure | tx hash + token addresses in detail modal | accept | See Accepted Risks Log AR-19-06-05. Local-only operator UI. | CLOSED |
| T-19-06-06 | EoP | malformed antirug_state_update payload breaks state setter | mitigate | `dashboard/src/hooks/useWebSocket.ts:132+` — switch case wraps payload-merge; on parse failure logs to console and skips update. | CLOSED |
| T-19-06-07 | Tampering | localStorage key collision in GapDetectedBanner | mitigate | `dashboard/src/components/anti-rug/GapDetectedBanner.tsx:29` — `storageKey = 'antirug-gap-dismissed-${chain}-${fromBlock}'`; chain + fromBlock disambiguate per UX design. | CLOSED |
| T-19-06-08 | Repudiation | CB reset request fails silently in network | mitigate | `dashboard/src/components/anti-rug/CircuitBreakerResetModal.tsx:188` — inline error rendering per UI-SPEC §CB-reset modal flow step 7 ("You must type RESET exactly to proceed."); modal stays open with state preserved on failure. CR-06-FOLLOWUP (commit `74617d3`) surfaces live-exit success/failure on dashboard. | CLOSED |
| T-19-06-09 | Tampering | wrong-text input bypasses confirm | mitigate | `dashboard/src/components/anti-rug/CircuitBreakerResetModal.tsx:52` — `const textConfirmed = confirmText === 'RESET'` (case-sensitive strict equality; comment explicitly cites "no trailing space, no lowercase"). | CLOSED |
| T-19-06-10 | Information disclosure | tx hash leaked to system clipboard | accept | See Accepted Risks Log AR-19-06-10. Operator-initiated action; existing UI-SPEC pattern. | CLOSED |
| T-19-07-01 | Tampering | RugPull.sol modes drift from detector tests | mitigate | `test/fork/antiRugDetector.fork.test.ts:540` — `describe.each([0, 1, 2, 3, 4])('RugPull mode %i', ...)` explicitly enumerates each mode; tests fail loudly on drift. | CLOSED |
| T-19-07-02 | Tampering | HORSE fixture token address mis-recorded | mitigate | `test/fork/fixtures/rugs/eth-v2-horse.json:7` — `pairAddress: '0x77A838d43Aa717b5C0eEd82E3A3078560e9429b3'` + `lpRemovalBlock: 18401609`; fork test resolves token address from on-chain receipt at execution per Plan 19-07 Step 2. | CLOSED |
| T-19-07-03 | Information disclosure | mainnet replay tests RPC the real chain | accept | See Accepted Risks Log AR-19-07-03. Read-only fork; operator-owned RPC credential. | CLOSED |
| T-19-07-04 | Repudiation | fork test silently skipped under CI without ALLOW_REAL_MAINNET | mitigate | `test/fork/antiRugDetector.fork.test.ts:178` — `return chainId !== 1 || process.env.ALLOW_REAL_MAINNET === '1';` chainGuard; line 506 logs explicit skip-reason when chainGuard fails. README documents the gate. | CLOSED |
| T-19-07-05 | EoP | RugPull events confused with real V2/V3 events at dispatcher | accept | See Accepted Risks Log AR-19-07-05. Detector dispatches by topic + address; RugPull address never present in production positionRegistry. | CLOSED |
| T-19-08-01 | Tampering | rollout doc env-var defaults drift from .env.example | mitigate | `docs/operations/anti-rug-rollout.md:69` cites the exact env-var default values (e.g. `ETH_ANTIRUG_BACKFILL_CAP_BLOCKS=10`) matching `.env.example:135`. Manual cross-check in Plan 19-08 Task 1 done block. | CLOSED |
| T-19-08-02 | Spoofing | operator skips reading rollout doc, flips chain to live | accept | See Accepted Risks Log AR-19-08-02. README SAFETY DEFAULT callout + .env.example inline comment + bot startup log all surface dry-run state. | CLOSED |
| T-19-08-03 | Repudiation | CB reset performed without dashboard audit trail | mitigate | `docs/operations/anti-rug-rollout.md:307,328` — both dashboard modal flow and curl backup documented; both fire `cb-reset` pino log + broadcast for EventFeed. | CLOSED |
| T-19-08-04 | Information disclosure | rollout doc leaks DASHBOARD_API_KEY value | mitigate | `docs/operations/anti-rug-rollout.md:328` — placeholder `<API_KEY>` used; no real key inlined. | CLOSED |
| T-19-08-05 | Repudiation | Wave-1 follow-up items silently forgotten | mitigate | `docs/operations/anti-rug-rollout.md:469-497` — §7 Wave-1 follow-up table explicitly tracks TeamFinance V3 + PinkLock V3 status per chain (Resolved / Operator-accepted-gap) with verification steps. | CLOSED |
| T-19-08-06 | DoS (operator-induced) | operator sets all chains to live simultaneously on first deploy | mitigate | `.env.example` lines 129, 142, 155, 168 — each chain has its OWN `<CHAIN>_ANTIRUG_LIVE_EXECUTE` env (no global flag). `docs/operations/anti-rug-rollout.md:218` — "Edit .env — flip ONE chain at a time" instruction. | CLOSED |
| T-19-08-07 | Confusion (Tampering/Repudiation hybrid) | RugPull.sol modes documented inconsistently with the contract | mitigate | `docs/operations/anti-rug-rollout.md:537,560` — references `test/fork/fixtures/rugs/eth-v3-CANDIDATE.json` and `test/fork/fixtures/rugs/README.md` as the authoritative fixture-mode reference. Wave-1 fixture tracker is the single source of truth for mode→behavior mapping. | CLOSED |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**Verification totals:** 51 mitigate threats — all 51 verified CLOSED by grep evidence above. 20 accept threats — all 20 enrolled in Accepted Risks Log below.

**Unregistered flags:** None. SUMMARY.md `## Threat Flags` sections across the 10 plan summaries map exclusively to existing threat IDs in this register. No new attack surface appeared during implementation that was not pre-registered.

**Out-of-scope notes:**
- `CR-07` (circular import between `src/exitEngine.ts` and `src/anti-rug/detector.ts` via `unregisterAntiRugPosition`) is a code-quality finding deferred per `19-REVIEW-FIX.md`. NOT a threat from the register; tracked as technical debt for v6.18+.
- Verification gap `Gap-1` (gasMultiplier discard) — closed in commit `7d35c46` per `19-VERIFICATION.md:28-42`; the threat T-19-05-11 mitigation is now grep-verified above.

---

## Accepted Risks Log

20 risks accepted at plan time per disposition column in the threat model. All
addresses are public on-chain data; local-only operator UI; risks are bounded
by operator-owned trust boundaries (RPC, SQLite file, .env, dashboard auth).

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-19-01-02 | T-19-01-02 | Address strings stored COLLATE NOCASE are public on-chain data; no PII. Local-only operator UI per UI-SPEC §"Cross-Cutting Constraints" item 1. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-01-03 | T-19-01-03 | `lp_baseline` row count bounded by concurrent open positions (~10s max). Phase 19 closes lifecycle by deleting row on full-close (D-TERMINATION). Operator periodically wipes via existing DB maintenance. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-02-03 | T-19-02-03 | `.env.example` commits `=false` defaults (verified lines 129, 142, 155, 168); test suite asserts default-false; operator-supplied `.env` is gitignored per existing convention. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-02-05 | T-19-02-05 | D-LIST-SOURCE explicitly authorizes single overlay covering both pool types for operator simplicity. Risk (V3 false negatives from V2-only overlay locker) mitigated by Plan 19-03 getCode() check + new separate `ALLOWLIST_EXTRA_V2/V3` envs added in commit `e42c21b`. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-03-01 | T-19-03-01 | Hostile RPC is out-of-scope (operator owns the RPC credential). Bot refuses to start with clear FATAL log naming the affected locker; operator escalates by switching RPC. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-03-03 | T-19-03-03 | All allowlist addresses are public on-chain; D-LIST-VERIFY explicitly requires the dump for operator visual verification. Local-only operator UI. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-03-05 | T-19-03-05 | Each getCode is ~50ms; even 100 lockers = 5 seconds at startup. Hardcoded base is 4 V2 + 4 V3 per chain × 4 chains = ~32 calls. Acceptable for manual-start ops process. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-04a-02 | T-19-04a-02 | Multi-signal evaluator (Plan 19-04b) handles verdict; this layer's job is routing. Forged events for the registered address still subject to multi-signal AND chain. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-04b-02 | T-19-04b-02 | Forged Burn event with allowlisted destination: signal-2 sees destination in allowlist → verdict='allowlisted' → no exit fires. Multi-signal AND chain mitigates by construction. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-04b-05 | T-19-04b-05 | confirm-after-N-blocks gate uses `ctx.httpProvider.on('block')` which survives WS reconnect; Plan 19-04c reconnect re-registers handlers; worst case is late dispatch but never silently missed. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-04b-07 | T-19-04b-07 | Structured pino logs include token/pair addresses + signal values + allowlist names. Local-only operator UI per UI-SPEC §"Cross-Cutting Constraints" item 1; all on-chain data is public. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-04c-05 | T-19-04c-05 | Tiered alerts include chain name, disconnect duration, missed-blocks count — operational state only; no PII; local-only operator UI. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-05-07 | T-19-05-07 | reasonDetail signal values in Telegram messages are all public on-chain data per UI-SPEC §"Cross-Cutting Constraints" item 2 (high-stakes audit trail). | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-05-10 | T-19-05-10 | Race telemetry is dry-run-only; never gates live decision. D-RACE-TELEMETRY explicitly notes operator reviews distributions; false-positive coinbaseDiff is informational. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-06-02 | T-19-06-02 | The N-acknowledge + RESET-text UI gate is a UX safety, not a security boundary. Backend trusts the operator's authenticated credential per existing dashboard conventions. Audit trail is the structured pino `cb-reset` log + EventFeed history. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-06-05 | T-19-06-05 | Tx hash + token addresses shown in AntiRugExitDetailModal are public on-chain data per UI-SPEC §Cross-Cutting Constraints item 1. Local-only operator UI. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-06-10 | T-19-06-10 | Click-to-copy is operator-initiated; UI-SPEC explicit pattern per formatters.ts precedents; the operator chose to expose data to clipboard. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-07-03 | T-19-07-03 | Mainnet replay tests use read-only fork (no tx submitted) against operator's Alchemy archive RPC (operator-owned credential). ALLOW_REAL_MAINNET=1 gates the test; CI never sets it. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-07-05 | T-19-07-05 | Detector dispatches by topic + address; RugPull.sol address is never present in production positionRegistry (only test setup adds it). Fork-test isolation prevents cross-contamination. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |
| AR-19-08-02 | T-19-08-02 | Operator who ignores README SAFETY DEFAULT callout AND .env.example inline comment AND bot startup log is making an informed (or careless) choice; bot cannot prevent live-mode flip without operator buy-in. The triple-surface defense is the agreed mitigation. | Operator (Jack Cutrara, jackcutrara@gmail.com) | 2026-05-23 |

*Accepted risks do not resurface in future audit runs unless the underlying conditions change.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-24 | 71 | 71 | 0 | gsd-security-auditor (verify-only against register; commits up to `4acbf21`) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer) — 51 mitigate, 20 accept, 0 transfer; total 71 = orchestrator pre-extract.
- [x] Accepted risks documented in Accepted Risks Log — 20 entries (AR-19-01-02..AR-19-08-02).
- [x] `threats_open: 0` confirmed in frontmatter.
- [x] `status: verified` set in frontmatter.

**Approval:** verified 2026-05-24
