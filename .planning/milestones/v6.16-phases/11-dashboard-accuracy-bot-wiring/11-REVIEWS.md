---
phase: 11
reviewers: [gemini, codex]
reviewed_at: 2026-04-04T12:00:00Z
plans_reviewed: [11-00-PLAN.md, 11-01-PLAN.md, 11-02-PLAN.md, 11-03-PLAN.md, 11-04-PLAN.md]
---

# Cross-AI Plan Review — Phase 11

## Gemini Review

This review evaluates the implementation plans for **Phase 11: Dashboard Accuracy & Bot Integration Wiring**.

### 1. Summary
The implementation plan is technically sound, highly modular, and demonstrates a deep understanding of the specific pitfalls associated with ethers v6 and multi-chain orchestration. It successfully addresses the "live data" requirement while proactively mitigating circular dependency risks through a callback-oriented architecture. The strategy for P&L calculation accurately accounts for the complexity of partial sells, and the Telegram refactor transforms a standalone script into a robust, integrated subsystem.

### 2. Strengths
*   **Modular Architecture:** The extraction of `buildPositionsWithLivePrices` into a shared helper ensures consistency between REST polling and WebSocket pushes, reducing code duplication.
*   **Concurrency Management:** Using `Promise.all` for parallel price queries (D-02) is the correct approach for maintaining dashboard responsiveness, provided RPC rate limits are respected.
*   **Circular Dependency Mitigation:** Using an `onRestart` callback passed to the API server and dynamic imports (D-09, D-13) effectively sidesteps the common "Bot needs API / API needs Bot" architectural knot.
*   **Robust Fallbacks:** The `priceStale` flag and `highWaterMark` fallback (D-03) ensure the UI remains functional even during localized RPC failures or rate-limiting events.
*   **Lifecycle Integrity:** Explicitly including `TelegramClient.disconnect()` in the graceful shutdown (D-20) prevents zombie processes, which is a common issue with the `gramjs` library.

### 3. Concerns
*   **RPC Rate Limiting (Severity: MEDIUM):** 
    *   *Issue:* D-01/D-02 mandate querying prices for *all* open positions on every request. If a user has 20+ open positions across 3 chains, a single dashboard refresh or a 5-second WebSocket broadcast interval could trigger aggressive rate limiting on public or low-tier RPC providers.
    *   *Risk:* The dashboard might frequently show "Stale" warnings, or the bot's core sniffing logic might be starved of RPC capacity.
*   **Multi-Chain Routing Ambiguity (Severity: LOW):**
    *   *Issue:* Using `getCode()` (D-17) to find where a token exists is a good heuristic, but doesn't guarantee the token has liquidity or a pair on that specific chain's DEX. 
    *   *Risk:* The bot might attempt to "snipe" a token on a chain where it exists but isn't tradable, leading to unnecessary RPC calls.
*   **P&L Unit Consistency (Severity: MEDIUM):**
    *   *Issue:* Pitfall #1 notes `buyAmountWei` vs token amount. The calculation `(remaining tokens × currentPrice) - (original buy cost - partial sell revenue)` requires extreme care regarding decimals.
    *   *Risk:* Calculating `(BigInt * BigInt) - BigInt` across tokens with different decimals (e.g., USDC 6 vs SHIB 18) can lead to massive overflow or precision errors if not normalized to a common base (like ETH/USD) or handled with decimal-aware math.

### 4. Suggestions
*   **Concurrency Limiting:** Within the `Promise.all` in `buildPositionsWithLivePrices`, consider using a simple concurrency limiter (like `p-limit`) to ensure no more than 5–10 price queries happen simultaneously per chain.
*   **Short-term Memoization:** Even though D-01 asks for "no caching," a very short (1–2 second) memoization of `queryPrice` results would prevent redundant calls if the REST API and WebSocket broadcast trigger simultaneously.
*   **Decimal Normalization:** Ensure the `LivePosition` interface explicitly defines the units for `unrealizedPnl` (e.g., always in the chain's native gas token or a fixed-point string) to prevent the UI from misinterpreting raw BigInt values.
*   **Health Check Context:** In `POST /api/chains/:name/start`, ensure the MEV health check (D-10) is logged with the chain ID to avoid confusion in multi-chain logs.

### 5. Risk Assessment
**Risk Level: LOW**

**Justification:**
The plans are exceptionally detailed and adhere strictly to the `CONTEXT.md` decisions. The risks identified (rate-limiting and decimal math) are standard for DeFi applications and are mitigated by the planned fallback mechanisms (`priceStale` flag). The dependency ordering (Foundation -> Backend -> UI -> Tests) is logical and ensures that the data contract is firm before visual elements are built. The use of test stubs (11-00) ensures that the "Definition of Done" is driven by verification rather than just implementation.

---

## Codex Review

## Plan 11-00: Wave 0 Test Stubs

**Summary**  
This is acceptable as a compliance placeholder, but by itself it adds no implementation confidence and creates a false sense of progress if it is treated as a substantive milestone. It only makes sense if it is immediately followed by real tests in 11-04 and if the team does not count stub creation as risk reduction.

**Strengths**
- Establishes target test surfaces early.
- Makes intended module boundaries visible before implementation.
- Low-cost way to reserve test files and naming.

**Concerns**
- `LOW`: Pure `it.todo()` scaffolds do not validate any requirement or reduce delivery risk.
- `MEDIUM`: If merged alone, it can distort milestone tracking and Nyquist-style "test-first" optics without real coverage.
- `LOW`: File naming may lock in module boundaries before implementation stabilizes.

**Suggestions**
- Treat this as same-PR or same-day precursor work only.
- Add brief test case titles reflecting the actual acceptance criteria, not generic todos.
- Do not mark this plan complete in roadmap reporting until at least one real assertion exists per requirement area.

**Risk Assessment**  
**LOW**. Minimal technical risk, but minimal value unless immediately followed by real tests.

---

## Plan 11-01: Foundation Modules

**Summary**  
This is the right foundational split for the phase. Extracting a shared live-pricing helper and refactoring Telegram into an orchestrator-managed service directly supports the phase goals. The main risks are hidden complexity in pricing semantics, RPC fanout under load, and introducing avoidable coupling through dynamic imports and cross-module ownership boundaries.

**Strengths**
- Shared `buildPositionsWithLivePrices()` matches D-06 and reduces REST/WebSocket drift.
- Parallel price resolution via `Promise.all` matches D-02 and is appropriate for freshness.
- Explicit fallback to `highWaterMark` with `priceStale:true` matches D-03 and preserves dashboard continuity.
- Moving Telegram to `startTelegramListener(contexts)` aligns with orchestrator ownership and graceful shutdown.
- Multi-chain routing via per-chain `getCode()` is consistent with D-17 and avoids naive symbol/router assumptions.

**Concerns**
- `HIGH`: Per-request `queryPrice()` for every open position can become an RPC amplification point for both REST and WebSocket, especially if dashboard polling and socket pushes overlap.
- `HIGH`: Using `highWaterMark` as fallback is operationally acceptable, but economically misleading; if the UI does not clearly mark it, users can act on inflated P&L.
- `HIGH`: Net cost basis logic with partial sells is easy to get subtly wrong, especially around fees, decimals, and whether sell revenue is gross or net.
- `MEDIUM`: `Promise.all` means one uncaught helper bug can fail the whole batch unless each position pricing branch catches internally.
- `MEDIUM`: Dynamic import of `./bot` is a smell. It may avoid one circular import, but it can hide architecture problems and complicate testability.
- `MEDIUM`: `getCode()` routing across all chains per alpha message may be slow and expensive if sender volume spikes.
- `MEDIUM`: Telegram listener lifecycle contract is underspecified. It should define idempotent start/stop and behavior when env vars are missing.
- `LOW`: `LivePosition` can drift from dashboard/API types if ownership is unclear.

**Suggestions**
- Make `buildPositionsWithLivePrices()` internally catch per-position failures so one bad RPC call does not fail the whole list.
- Define the P&L inputs precisely: source fields, decimal normalization, whether gas is excluded, and whether sell revenue is net of fees/slippage.
- Add concurrency controls or batching guidance for pricing if open-position count can grow beyond trivial volume.
- Prefer dependency injection over dynamic `import('./bot')` if possible; pass router/resolver functions in from the orchestrator.
- Define a strict `TelegramListenerHandle` contract: `connected`, `error`, `stop()/disconnect()`, idempotency, and startup failure mode.
- Require the UI/API contract to expose `priceSource` or equivalent, not only `priceStale`, if you want operators to understand fallback behavior.

**Risk Assessment**  
**MEDIUM-HIGH**. Architecturally correct, but the pricing and lifecycle semantics are where bugs will hide, and those bugs directly affect trading decisions.

---

## Plan 11-02: Backend Wiring

**Summary**  
This plan is the core of the phase and mostly aligns with the success criteria. It properly addresses restart reattachment, Telegram lifecycle visibility, and shared pricing usage. The biggest risks are restart idempotency, partial-failure semantics, and coupling live dashboard correctness to bot control paths without a clearly defined orchestrator state model.

**Strengths**
- Directly addresses success criterion 2 with `onRestart` callback wiring.
- Shared helper reuse across REST and WebSocket is the right way to enforce dashboard consistency.
- Health route changes make Telegram operational state observable, which is necessary for D-19.
- Restart warnings array is a good fit for partial success semantics in D-12.
- Explicit WS reconnect and MEV re-check on restart reflect identified pitfalls and D-10/D-11.
- Shutdown disconnect handling addresses a real process-hang risk.

**Concerns**
- `HIGH`: Restart sequencing is not explicit enough. Reconnect WS, re-run MEV check, reattach listeners, and update chain state must happen in a deterministic order or you risk duplicate listeners or a chain marked healthy before it is actually listening.
- `HIGH`: `startDexListener` export from `bot.ts` may widen module responsibilities and increase coupling if `bot.ts` becomes both orchestrator and listener factory.
- `HIGH`: WebSocket broadcasts using fresh on-chain pricing can accidentally create a hot path that overwhelms RPC providers if broadcast frequency is nontrivial.
- `MEDIUM`: `warnings: string[]` is flexible but weakly structured; clients may not be able to distinguish degraded-but-running from failed-to-start states reliably.
- `MEDIUM`: Telegram startup "after API server starts" is operationally fine, but if startup fails, the bot may appear healthy unless health state initializes correctly from the start.
- `MEDIUM`: Health fields `telegramConnected` and `telegramError` are useful, but chain-specific or listener-mode detail may be needed if Telegram service is partially functional.
- `LOW`: Route signature changes can ripple through tests and frontend types if not done atomically.

**Suggestions**
- Write restart as an explicit state machine: `stopping -> reconnecting_provider -> mev_check -> attaching_listeners -> running_with_warnings|running|failed`.
- Ensure restart is idempotent and guarded against concurrent calls per chain.
- Make listener attachment track and dispose prior subscriptions before reattaching.
- Consider structured warnings like `{ code, message, chain }` instead of plain strings.
- Separate pricing refresh cadence for WebSocket pushes from REST request handling, even if both use the same helper.
- Add startup behavior rules: Telegram unavailable should degrade health, not crash orchestrator, unless explicitly configured as required.

**Risk Assessment**  
**HIGH**. This is the phase's highest-risk plan because it touches orchestration, runtime lifecycle, and live control surfaces. Small mistakes here create duplicate trades, stale UI, or hanging processes.

---

## Plan 11-03: Dashboard UI

**Summary**  
The UI plan is appropriately scoped and tied to backend contract changes. It focuses on surfacing stale pricing, Telegram status, and restart warnings rather than inventing new dashboard behavior. The main issue is whether the visual affordances are strong enough to prevent operators from misreading fallback data as live truth.

**Strengths**
- `priceStale` indicator directly supports safe interpretation of fallback pricing.
- Adding `unrealizedPnl` and `sellRevenue` makes the UI reflect the new backend economics.
- Telegram status in the sidebar improves operational visibility.
- Restart warnings banner is a good UI pattern for partial restart success.

**Concerns**
- `HIGH`: Warning color alone is insufficient for stale fallback data; operators may still treat the value as current and make bad decisions.
- `MEDIUM`: If types are updated before backend routes are stable, frontend may temporarily assume fields that are missing or nullable.
- `MEDIUM`: Chain warning state in `ChainControls` can become stale if not cleared on subsequent successful refreshes/restarts.
- `LOW`: Sidebar Telegram status may be too coarse if it does not distinguish "disabled by config" from "error" from "connecting".

**Suggestions**
- Show explicit text such as `Stale price fallback` or `Using high-water mark`, not just an icon/color.
- Include timestamps if possible: when the fallback/live price was last resolved.
- Define nullable/default frontend handling for new fields during rollout.
- Make Telegram UI support at least three states: `disabled`, `connected`, `error`.
- Ensure restart warnings are tied to specific chains and cleared deterministically.

**Risk Assessment**  
**MEDIUM**. UI scope is reasonable, but miscommunication of stale price state is a real operator-risk issue.

---

## Plan 11-04: Tests

**Summary**  
This test plan covers the right surfaces and is the strongest part of the overall phase design. It appropriately spans unit and integration boundaries. The weakness is that it still misses some adversarial lifecycle cases and concurrency/idempotency behavior that matter more here than happy-path coverage.

**Strengths**
- Tests map well to the actual phase outcomes: live pricing, restart warnings, Telegram status, shared helper wiring.
- Unit coverage on pricing fallback and P&L logic is necessary and correctly prioritized.
- Telegram whitelist testing addresses the security-sensitive `FIX-09` requirement.
- Integration coverage for REST, health, and WebSocket is appropriate for cross-layer wiring.

**Concerns**
- `HIGH`: No explicit tests for duplicate listener prevention on repeated restart calls.
- `HIGH`: No explicit tests for restart concurrency or overlapping start/stop requests per chain.
- `HIGH`: No explicit tests for total RPC failure across all positions or for partial batch failure behavior.
- `MEDIUM`: No stated tests for "Telegram disabled by config" graceful degradation path.
- `MEDIUM`: No stated tests for shutdown cleanup ensuring `disconnect()` is called exactly once and process does not hang.
- `MEDIUM`: No test coverage called out for chain-routing false positives/ambiguity when `getCode()` succeeds on multiple chains or RPCs misbehave.
- `LOW`: WebSocket helper wiring tests may become brittle if they overfit implementation details instead of payload semantics.

**Suggestions**
- Add restart idempotency tests: repeated restart, restart after failed restart, concurrent restart rejection/serialization.
- Add pricing resilience tests: one position fails, all positions fail, malformed trade data, zero remaining tokens.
- Add Telegram lifecycle tests: disabled config, startup exception, reconnect/disconnect, shutdown double-call safety.
- Add security-focused whitelist tests that prove non-whitelisted messages are ignored before any token routing or side effects.
- Add contract tests to ensure REST and WebSocket position payloads stay schema-aligned.

**Risk Assessment**  
**MEDIUM**. Good coverage direction, but missing lifecycle and concurrency tests leaves the highest-value failure modes exposed.

---

## Codex Overall Assessment

**Summary**  
The plan set is broadly well-structured and mostly aligned to the phase goals. The decomposition is sensible: foundation first, then backend wiring, then UI, then tests. The biggest unresolved risk is not feature completeness but runtime correctness under failure: restart idempotency, listener duplication, RPC load from live pricing, and operator confusion when fallback pricing is shown. If those are tightened, the phase should achieve its stated success criteria.

**Cross-Plan Strengths**
- Good alignment with the locked user decisions.
- Shared helper extraction reduces drift between REST and WebSocket.
- Orchestrator-managed Telegram lifecycle is the correct direction.
- Partial-success restart warnings are pragmatic and operationally useful.
- The plans stay focused on the milestone gaps rather than broadening scope too far.

**Cross-Plan Concerns**
- `HIGH`: Restart behavior needs a stricter lifecycle/state model across 11-01, 11-02, and 11-04.
- `HIGH`: Live per-request pricing plus WebSocket reuse can create avoidable RPC pressure and latency spikes.
- `HIGH`: Fallback-to-peak-price is dangerous unless the UI and API make the degraded state impossible to miss.
- `MEDIUM`: Dynamic import to dodge circular imports is probably a local fix, not a robust boundary.
- `MEDIUM`: Test plan does not yet cover the most failure-prone concurrency cases.
- `LOW`: Wave 0 stubs add ceremony more than value unless executed very tightly with the rest.

**Suggestions**
- Make restart semantics explicit and test them as a state machine.
- Define payload semantics for live vs fallback pricing more clearly than `priceStale` alone.
- Guard pricing fanout with per-call failure isolation and, if needed, controlled concurrency.
- Prefer dependency injection over dynamic import where practical.
- Expand tests around idempotency, shutdown cleanup, and degraded Telegram modes.

**Overall Risk Assessment**  
**MEDIUM-HIGH**. The plans are directionally solid and likely sufficient for feature delivery, but the phase touches the exact subsystems where subtle lifecycle bugs, stale data, and misleading operator signals can cause real trading losses or hidden downtime.

---

## Consensus Summary

### Agreed Strengths
- **Shared helper architecture** — Both reviewers praised `buildPositionsWithLivePrices()` as the right abstraction for REST/WebSocket consistency (D-06)
- **Circular dependency mitigation** — Both agree the callback/DI approach for `onRestart` is correct and avoids the bot.ts <-> server.ts import cycle
- **Graceful fallback with priceStale flag** — Both acknowledge D-03 fallback to highWaterMark preserves dashboard continuity during RPC failures
- **Telegram lifecycle management** — Both validate the refactor from standalone script to orchestrator-managed module with proper shutdown handling (D-20)
- **Partial restart warnings** — Both approve the `warnings[]` pattern for communicating degraded restart states (D-12)

### Agreed Concerns
1. **RPC rate limiting / amplification** (both MEDIUM-HIGH) — Per-request `queryPrice()` for all open positions on every REST request AND every 5s WebSocket broadcast creates significant RPC load. Both suggest concurrency limiting or batching.
2. **Stale price display risk** (Codex HIGH, Gemini MEDIUM) — Warning color + "(stale)" text may be insufficient to prevent operators from making trading decisions based on highWaterMark peak prices. Both suggest more explicit labeling.
3. **P&L decimal/precision complexity** (both MEDIUM) — Net cost basis calculation with partial sells, fees, and cross-token decimals is error-prone. Both recommend precise definition of input fields and units.
4. **Restart idempotency/sequencing** (Codex HIGH) — No explicit guard against duplicate listeners, concurrent restart calls, or deterministic state transitions during restart flow.
5. **Test coverage gaps for failure modes** (Codex HIGH) — Missing tests for restart concurrency, total RPC failure, shutdown cleanup, and Telegram disabled-by-config paths.

### Divergent Views
- **Overall risk assessment**: Gemini rates the phase as **LOW** risk (well-planned with standard DeFi risks), while Codex rates it **MEDIUM-HIGH** (lifecycle bugs in these subsystems can cause real trading losses). The divergence reflects different weighting of "plan quality" vs "runtime failure modes."
- **Dynamic import pattern**: Codex flags dynamic `import('./bot')` in alphaDrop.ts as a code smell needing DI instead; Gemini sees the callback approach as sufficient mitigation.
- **Wave 0 stubs value**: Codex views test stubs as near-zero value ceremony; Gemini sees them as part of a valid "Definition of Done" driven by verification.
- **Warning structure**: Codex suggests structured `{ code, message, chain }` warnings; Gemini accepts `string[]` as adequate for the current scope.
