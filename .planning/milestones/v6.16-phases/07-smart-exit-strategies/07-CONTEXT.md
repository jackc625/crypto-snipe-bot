# Phase 7: Smart Exit Strategies - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Intelligent exit strategies that replace the current fixed stop-loss/take-profit monitoring with a unified exit engine. Delivers trailing stops that track price peaks, partial sells at configurable profit milestones, volatility-adaptive threshold adjustments, and time-weighted exit urgency that escalates as positions age. The existing 6 separate monitor functions (legacy, ForChain, V3ForChain x stopLoss/takeProfit) are consolidated into a single exit engine module. No new entry/snipe logic, no new safety checks, no dashboard work -- only exit-side improvements.

</domain>

<decisions>
## Implementation Decisions

### Trailing stop-loss mechanics
- **D-01:** Trailing stop activates after position reaches **2x entry price** (100% profit). Below 2x, the existing fixed stop-loss from entry applies (stopLossPercent default 25%).
- **D-02:** Once activated, trailing stop tracks the **high-water mark** (highest price seen since buy). Sells when price drops a configured **global percentage** from the peak (e.g., `TRAILING_STOP_PCT=15`).
- **D-03:** Single global trailing stop percentage -- not per-chain. Configured via `TRAILING_STOP_PCT` env var.
- **D-04:** Polling interval is **5 seconds** (faster than the current 15s). More responsive to fast-moving token prices. High-water mark updates every poll.
- **D-05:** When trailing stop triggers, **sell the entire remaining balance** (after any partial sells have executed). Clean exit, no residual dust.

### Partial sell targets
- **D-06:** Configured via a single env var string: `PARTIAL_SELL_TARGETS="2x:50,5x:25"` -- sell 50% at 2x, 25% at 5x, remainder trails. Parsed at startup.
- **D-07:** Percentages are based on **original buy amount**, not current remaining balance. "Sell 50% at 2x" means 50% of tokens originally purchased.
- **D-08:** If price gaps past multiple targets in one poll (e.g., 1.5x to 6x), **execute all missed tiers in a single transaction**. Combined sell of the total percentage. Fewer gas costs, no partial execution risk.
- **D-09:** Same sell logic for V2 and V3 positions -- partial sell passes a reduced token amount to the existing sell path (swapExactTokensForETH for V2, exactInputSingle for V3).
- **D-10:** Each partial sell is recorded as a **separate trade row** in the DB (action='partial_sell'). Survives restarts, visible in P&L queries, consistent with DB-as-truth principle.
- **D-11:** After a partial sell, the trailing stop's **high-water mark continues tracking** from where it was -- no reset.

### Volatility-adaptive thresholds
- **D-12:** Claude's discretion on the volatility measurement metric (rolling std dev, simple range ratio, or similar). Use what fits the polling data naturally.
- **D-13:** Volatility adjustment works as a **multiplier on base thresholds** -- e.g., if measured volatility is 2x the baseline, the trailing stop pullback % widens by the multiplier. Prevents getting stopped out on normal swings.
- **D-14:** Thresholds are **clamped to a configurable min/max range** -- stop-loss can widen but never beyond a maximum (e.g., 10% to 40%). Prevents absurd thresholds on hyper-volatile tokens.
- **D-15:** Volatility recalculation happens **every poll cycle** (gradual, every 5s). Smooth adaptation, no sudden jumps.

### Time-weighted exit urgency
- **D-16:** **Replaces the existing 5-minute timed sell entirely.** Time-weighted urgency gradually tightens the trailing stop as the position ages, making the old hard timed sell unnecessary.
- **D-17:** Full urgency window is **30 minutes**. Trailing stop tightens from normal to minimum over this window. At 30 minutes, if still holding, **market sell everything** (hard exit).
- **D-18:** Urgency **only tightens the trailing stop pullback %** -- partial sell targets remain fixed. One dimension of pressure.
- **D-19:** Urgency curve is **linear** -- at 50% of the 30-min window, trailing stop is tightened by 50% of the range.
- **D-20:** Urgency timer **always ticks** -- no pause while in profit. Even profitable positions tie up capital. Partial sells + trailing stop handle profit-taking; urgency handles capital recycling.

### Exit engine architecture
- **D-21:** Consolidate all 6 monitor functions into a **unified exit engine module** (`src/exitEngine.ts` or extend `exitManager.ts`). One monitoring loop per position handles trailing stop, partial sells, volatility adjustment, and urgency in a single poll cycle.
- **D-22:** **Remove legacy single-chain exit functions** (`monitorStopLoss`, `monitorTakeProfit`). The multi-chain code path is the only path. Phase 7 is a clean break.

### Position state persistence
- **D-23:** High-water mark is **DB-persisted**. On restart, trailing stop resumes from the correct peak price.
- **D-24:** Exit strategy state lives in a **separate `exit_state` table** keyed by trade_id. Fields: high_water_mark, partial_tiers_completed, urgency_start_ts, volatility samples. Trades table stays focused on transaction data.

### Notification strategy
- **D-25:** Telegram notification on **every sell event**: each partial sell (tier info, amount, P&L), trailing stop trigger (peak price, pullback %), and urgency market sell.
- **D-26:** Notifications include **detailed exit reason** with strategy context -- e.g., "[ETH] Partial sell: 50% at 2.3x (+0.012 ETH) | Remaining: 50% trailing" or "[BSC] Urgency market sell at 28min: 0.8x (-0.002 BNB)". Helps tune strategy parameters.

### Claude's Discretion
- Volatility measurement metric choice (rolling std dev, range ratio, or other)
- Exact volatility multiplier formula and baseline calibration
- Min/max clamp values for volatility-adjusted thresholds (defaults)
- Exit engine internal architecture (class vs functional, state management approach)
- DB schema migration version and exact exit_state table columns
- How to calculate partial sell token amounts with rounding (avoid dust)
- Urgency tightening formula (linear interpolation between max and min trailing stop %)
- Whether volatility samples are persisted in exit_state or recalculated from price history on restart
- Timer registry updates for the new unified monitoring loop

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` -- EXIT-01 through EXIT-04 define all smart exit strategy requirements

### Current implementation (being replaced)
- `src/bot.ts` -- `monitorStopLoss()` (line 291), `monitorTakeProfit()` (line 334) -- legacy single-chain monitors being removed
- `src/bot.ts` -- `monitorStopLossForChain()` (line 387), `monitorTakeProfitForChain()` (line 435) -- multi-chain V2 monitors being consolidated
- `src/bot.ts` -- `monitorStopLossV3ForChain()` (line 912), `monitorTakeProfitV3ForChain()` (line 964) -- V3 monitors being consolidated
- `src/bot.ts` -- `handleNewPairForChain()` (line ~649) and `handleNewV3PoolForChain()` (line ~829) -- where monitors are launched after buy, will call new exit engine
- `src/utils/exitManager.ts` -- Sell mutex (`tryAcquireSellLock`/`releaseSellLock`), timer registry (`registerStopLoss`/`registerTakeProfit`/`registerTimedSell`/`clearAllTimersForToken`), shutdown handler
- `src/config.ts` -- `stopLossPercent: 25`, `takeProfitPercent: 50`, `stopLossCheckInterval: 15000`, `autoSellAfterMs: 5min` -- current exit config being replaced

### Adjacent modules
- `src/riskManager.ts` -- Risk gate runs at entry (canSnipe), not at exit. Exit engine is independent but must call `recordSnipe` patterns correctly
- `src/utils/db.ts` -- Trades table schema, `insertTrade`, P&L queries. New `exit_state` table and `partial_sell` trade rows integrate here
- `src/utils/txManager.ts` -- `sendTxWithRetry()` for MEV-protected sell transactions
- `src/utils/notifier.ts` -- `sendTelegramAlert()` and `sendCtxAlert()` for exit notifications
- `src/chainRegistry.ts` -- `DexConfig` with V2/V3 discriminated union, chain context for sell path selection

### Prior phase context
- `.planning/phases/01-bug-fixes-hardening/01-CONTEXT.md` -- Per-token sell mutex, timer registry pattern, timed sell duration tuning deferred to this phase
- `.planning/phases/05-uniswap-v3-integration/05-CONTEXT.md` -- V3 Quoter-based price monitoring, V3 sell via exactInputSingle, DexConfig discriminated union
- `.planning/phases/06-risk-management/06-CONTEXT.md` -- DB-backed position tracking, risk gate at entry not exit, trades table schema

### Codebase analysis
- `.planning/codebase/ARCHITECTURE.md` -- Position Management Layer description, Exit Flow patterns
- `.planning/codebase/CONVENTIONS.md` -- Code patterns to maintain
- `.planning/codebase/STRUCTURE.md` -- Directory layout, where to add new modules

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/exitManager.ts`: Sell mutex (`tryAcquireSellLock`/`releaseSellLock`) and timer registry -- mutex pattern reusable in unified exit engine. Timer registry needs update for single monitoring loop instead of separate stopLoss/takeProfit/timedSell timers.
- `src/utils/db.ts`: SQLite with WAL mode, trades table with chain/status/amount_in/timestamp columns. `insertTrade` for recording partial sells. Schema migration via `user_version` pragma for adding exit_state table.
- `src/utils/txManager.ts`: `sendTxWithRetry()` for MEV-protected sell execution -- reusable as-is for partial and trailing stop sells.
- `src/utils/notifier.ts`: `sendTelegramAlert()` and `sendCtxAlert()` -- extend with exit-strategy-specific message formatting.
- `src/bot.ts`: V2 price query via `getAmountsOut`, V3 price query via `quoteExactInputSingle` -- unified exit engine needs both price paths based on pool type.

### Established Patterns
- Per-token sell mutex prevents double-sells (Phase 1) -- must be preserved in unified exit engine
- DB as source of truth (Phase 3) -- exit state persisted in SQLite
- Structured logging with pino child loggers per module (Phase 3) -- exit engine gets its own child logger
- Per-chain Telegram alert prefix `[ETH]`/`[BSC]` (Phase 4) -- maintain in exit notifications
- DexConfig discriminated union with `dexType` field (Phase 5) -- used to select V2 vs V3 sell path

### Integration Points
- `handleNewPairForChain()` in `bot.ts` -- replace monitorStopLoss/TakeProfit launch with unified exit engine start
- `handleNewV3PoolForChain()` in `bot.ts` -- same unified exit engine start
- `resumeMonitoring()` in `bot.ts` -- restart exit engine for pending trades from DB, loading exit_state
- `exitManager.ts` -- either extend with engine logic or create new `exitEngine.ts` that imports mutex/timer utilities
- `db.ts` -- new `exit_state` table, new `partial_sell` action type, schema migration

</code_context>

<specifics>
## Specific Ideas

- Trailing stop activation at 2x provides a natural two-phase exit: fixed stop-loss protects against total loss below 2x, trailing stop locks in profit above 2x
- 5-second polling is faster than current 15s -- chosen for responsiveness on volatile meme tokens
- Single-string partial sell config (`PARTIAL_SELL_TARGETS="2x:50,5x:25"`) keeps the env var clean and is easily parsed
- Market sell at 30-minute max urgency is the hard backstop that replaces the crude 5-minute timed sell
- Separate exit_state table keeps the trades table clean while enabling full restart resilience for the exit engine
- Consolidating 6 monitor functions into one exit engine eliminates ~400 lines of duplicated monitoring code

</specifics>

<deferred>
## Deferred Ideas

- Per-chain trailing stop percentages (different volatility profiles per chain) -- could be added if single global % proves insufficient
- Configurable urgency window via env var (currently fixed at 30 min) -- could be exposed if different strategies need different horizons
- Emergency sell-all-positions on shutdown (Phase 1 deferred idea) -- not addressed in exit strategies, remains deferred
- Multi-pool routing at sell time for V3 (find best fee tier) -- Phase 5 deferred, not addressed here

</deferred>

---

*Phase: 07-smart-exit-strategies*
*Context gathered: 2026-03-25*
