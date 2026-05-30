# Phase 6: Risk Management - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Portfolio-level risk controls that prevent catastrophic losses and enforce disciplined position sizing across all chains. A standalone risk manager module gates every snipe with position size validation, daily loss circuit breaker, open position limits, cooldown enforcement, and total exposure caps. No new exit strategies, monitoring UI, or safety pipeline changes -- only adding risk gates to the existing snipe pipeline.

</domain>

<decisions>
## Implementation Decisions

### Position size enforcement
- **D-01:** Claude's discretion on how max position size relates to existing per-chain `snipeAmount` -- pick the approach that best fits the existing config pattern (separate cap vs startup validation).
- **D-02:** When a snipe would exceed the capital budget, reject the snipe entirely with log + Telegram alert. Never auto-reduce. Consistent with Phase 4's MEV-failure pattern: skip the trade, don't degrade it.
- **D-03:** Capital tracking is DB-backed -- query open trades from SQLite to reconstruct deployed capital on startup. The existing in-memory `capitalDeployed` Map in `bot.ts` should be replaced or initialized from DB. Trades table already has `amount_in`, `status`, and `chain` columns needed.

### Daily loss circuit breaker
- **D-04:** Daily loss calculation uses **realized losses only** (closed trades that lost money). No unrealized/paper losses. Uses the existing P&L query infrastructure in `db.ts`.
- **D-05:** Loss threshold configured as **percentage of maxCapital per chain** -- e.g., `DAILY_LOSS_PCT=10` halts sniping on a chain after losing 10% of that chain's `maxCapital` in realized losses over 24h.
- **D-06:** Auto-resume via **rolling 24h window** -- once old losses age past 24 hours, the bot naturally resumes. No manual intervention needed. Self-healing.
- **D-07:** When circuit breaker trips, **only halt new snipes**. Existing open positions continue being monitored with stop-loss/take-profit active. Positions may recover.

### Open positions & cooldowns
- **D-08:** **Global** max open positions limit across all chains (e.g., `MAX_OPEN_POSITIONS=10`). Per-chain capital budgets already control chain-specific risk; this is the portfolio-level cap.
- **D-09:** **Fixed cooldown per chain** (e.g., `SNIPE_COOLDOWN_MS=30000`). After sniping on ETH, wait 30s before another ETH snipe. Different chains can snipe concurrently -- a BSC snipe doesn't block an ETH opportunity. Prevents hammering one chain during launch waves.
- **D-10:** Open position count tracked via **DB query** (`COUNT(*) WHERE status='pending'` on trades table). Always accurate, survives restarts, single source of truth. SQLite overhead is negligible.

### Exposure tracking
- **D-11:** Portfolio exposure = **total capital deployed** (sum of `amount_in` for all pending trades across all chains). No live price feeds needed. Simple DB aggregate.
- **D-12:** Exposure is **actively enforced** -- global `MAX_TOTAL_EXPOSURE` cap. If total deployed capital across all chains exceeds this, reject new snipes. Portfolio-level safety net above per-chain budgets.

### Architecture
- **D-13:** Standalone `src/riskManager.ts` module with a `canSnipe(chain, amount)` gate function that checks ALL risk rules (position size, daily loss, open positions, cooldown, exposure). `bot.ts` calls one function before each snipe. Clean separation, independently testable.

### Claude's Discretion
- Exact risk manager interface and function signatures
- Whether `canSnipe()` returns a boolean or a result object with rejection reason
- How to structure the cooldown tracking (Map with timestamps, or more sophisticated)
- DB query design for 24h rolling loss calculation (single query vs separate helper)
- How to migrate the existing `capitalDeployed` Map to DB-backed tracking
- Config structure for risk parameters (flat env vars vs nested config object)
- Whether to add new columns to trades table or use computed queries
- Telegram alert format for risk rejections

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` -- RISK-01 through RISK-05 define all risk management requirements

### Current implementation (being extended)
- `src/bot.ts` -- `canDeployCapital()` and `recordCapitalDeployed()` (lines 75-84) -- existing in-memory capital tracking to be replaced with DB-backed version
- `src/bot.ts` -- `handleNewPairForChain()` (line ~600) and V3 variant (~760) -- snipe pipeline entry points where risk gate must be inserted
- `src/utils/db.ts` -- trades table schema, `insertTrade`, `isTokenSniped`, `getPnLQuery` -- existing DB infrastructure for risk queries
- `src/chainRegistry.ts` -- `ChainConfig` interface with `snipeAmount` and `maxCapital` fields (lines 61-62) -- risk config extends this
- `src/config.ts` -- Global CONFIG with `snipeAmountETH` -- legacy single-chain config

### Prior phase context
- `.planning/phases/04-multi-chain-architecture/04-CONTEXT.md` -- Per-chain fixed capital budgets (D-08/D-09), MEV skip-on-failure pattern (D-06), per-chain env var pattern (D-02)
- `.planning/phases/05-uniswap-v3-integration/05-CONTEXT.md` -- V3 snipe pipeline follows same flow as V2, both need risk gate
- `.planning/phases/03-sqlite-storage-code-quality/03-CONTEXT.md` -- SQLite as sole source of truth, trades table with chain column, P&L query

### Codebase analysis
- `.planning/codebase/ARCHITECTURE.md` -- Event-driven architecture, execution layer, position management layer
- `.planning/codebase/CONVENTIONS.md` -- Code patterns to maintain
- `.planning/codebase/STRUCTURE.md` -- Directory layout, where to add new code

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/db.ts`: SQLite with WAL mode, trades table with chain/status/amount_in/timestamp columns. `getPnLQuery` already calculates realized P&L with chain and date filtering -- can be adapted for 24h rolling loss calculation.
- `src/bot.ts`: `canDeployCapital()` / `recordCapitalDeployed()` -- existing capital tracking pattern (in-memory Map). Demonstrates where the risk gate integrates into the snipe flow.
- `src/utils/retry.ts`: Exponential backoff -- not directly needed but pattern reference.
- `src/utils/notifier.ts`: `sendTelegramAlert()` and `sendCtxAlert()` -- for risk rejection notifications.

### Established Patterns
- Per-chain env var naming: `{PREFIX}_SNIPE_AMOUNT`, `{PREFIX}_MAX_CAPITAL` -- new risk env vars should follow this pattern
- Skip-on-failure: Phase 4's MEV pattern (D-06) -- reject snipe entirely rather than degrade. Risk rejections follow the same philosophy.
- DB as source of truth: All state queries go through SQLite (Phase 3). Capital tracking and position counts should be DB-backed.
- Structured logging with pino child loggers per module -- risk manager gets its own child logger.

### Integration Points
- `handleNewPairForChain()` in `bot.ts` -- insert `riskManager.canSnipe()` call before capital check and swap execution
- V3 variant `handleNewV3PoolForChain()` in `bot.ts` -- same risk gate insertion point
- Legacy `handleNewPair()` in `bot.ts` -- may need risk gate for backward-compatible single-chain path
- `ChainConfig` in `chainRegistry.ts` -- may need new risk config fields or separate risk config
- Startup in `startMultiChainBot()` -- initialize risk manager, reconstruct capital state from DB

</code_context>

<specifics>
## Specific Ideas

- Risk manager as a single gate function (`canSnipe`) avoids scattering risk logic across the codebase -- one module, one entry point, all rules checked in sequence
- DB-backed capital tracking eliminates the restart-drift problem where the in-memory Map resets and the bot over-deploys
- Rolling 24h window for daily loss is self-healing -- no manual reset needed, no midnight boundary effects
- Per-chain cooldown allows concurrent cross-chain sniping while preventing single-chain hammering during token launch waves

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 06-risk-management*
*Context gathered: 2026-03-23*
