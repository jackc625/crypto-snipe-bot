# Phase 7: Smart Exit Strategies - Research

**Researched:** 2026-03-25
**Domain:** Exit strategy engine -- trailing stops, partial sells, volatility adaptation, time-weighted urgency
**Confidence:** HIGH

## Summary

Phase 7 replaces 6 separate monitor functions (monitorStopLoss, monitorTakeProfit, scheduleTimedSell for legacy, ForChain, and V3ForChain variants) plus their corresponding sell functions with a single unified exit engine. The engine handles four distinct exit behaviors in one polling loop per position: trailing stop-loss with high-water mark tracking, partial sells at configurable profit milestones, volatility-adaptive threshold adjustment, and time-weighted urgency that tightens stops as positions age.

The codebase is well-structured for this consolidation. The existing sell mutex (tryAcquireSellLock/releaseSellLock), timer cleanup (clearAllTimersForToken), and DB persistence patterns (better-sqlite3 with user_version migrations) provide reusable foundations. The DexConfig discriminated union (DexConfigV2/DexConfigV3) cleanly separates V2 and V3 price query and sell execution paths, which the exit engine must dispatch dynamically. The existing getV3Price() helper and V2 getAmountsOut pattern provide the two price query methods needed.

**Primary recommendation:** Build the exit engine as a new `src/exitEngine.ts` module with a single `startExitMonitor()` function per position. The engine owns one setInterval(5000ms) per position that evaluates all four exit behaviors in sequence each tick. Persist exit state in a new `exit_state` SQLite table for restart resilience. Remove all 6 legacy/ForChain/V3ForChain monitor functions and their timed sell counterparts. Update timer registry in exitManager.ts to use a single timer type per position.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Trailing stop activates after position reaches 2x entry price (100% profit). Below 2x, the existing fixed stop-loss from entry applies (stopLossPercent default 25%).
- D-02: Once activated, trailing stop tracks the high-water mark (highest price seen since buy). Sells when price drops a configured global percentage from the peak (e.g., TRAILING_STOP_PCT=15).
- D-03: Single global trailing stop percentage -- not per-chain. Configured via TRAILING_STOP_PCT env var.
- D-04: Polling interval is 5 seconds (faster than the current 15s). High-water mark updates every poll.
- D-05: When trailing stop triggers, sell the entire remaining balance (after any partial sells have executed). Clean exit, no residual dust.
- D-06: Configured via a single env var string: PARTIAL_SELL_TARGETS="2x:50,5x:25" -- sell 50% at 2x, 25% at 5x, remainder trails. Parsed at startup.
- D-07: Percentages are based on original buy amount, not current remaining balance. "Sell 50% at 2x" means 50% of tokens originally purchased.
- D-08: If price gaps past multiple targets in one poll (e.g., 1.5x to 6x), execute all missed tiers in a single transaction. Combined sell of the total percentage. Fewer gas costs, no partial execution risk.
- D-09: Same sell logic for V2 and V3 positions -- partial sell passes a reduced token amount to the existing sell path (swapExactTokensForETH for V2, exactInputSingle for V3).
- D-10: Each partial sell is recorded as a separate trade row in the DB (action='partial_sell'). Survives restarts, visible in P&L queries, consistent with DB-as-truth principle.
- D-11: After a partial sell, the trailing stop's high-water mark continues tracking from where it was -- no reset.
- D-12: Claude's discretion on the volatility measurement metric (rolling std dev, range ratio, or similar).
- D-13: Volatility adjustment works as a multiplier on base thresholds -- e.g., if measured volatility is 2x the baseline, the trailing stop pullback % widens by the multiplier.
- D-14: Thresholds are clamped to a configurable min/max range -- stop-loss can widen but never beyond a maximum (e.g., 10% to 40%).
- D-15: Volatility recalculation happens every poll cycle (gradual, every 5s).
- D-16: Replaces the existing 5-minute timed sell entirely. Time-weighted urgency gradually tightens the trailing stop as the position ages.
- D-17: Full urgency window is 30 minutes. Trailing stop tightens from normal to minimum over this window. At 30 minutes, if still holding, market sell everything (hard exit).
- D-18: Urgency only tightens the trailing stop pullback % -- partial sell targets remain fixed.
- D-19: Urgency curve is linear -- at 50% of the 30-min window, trailing stop is tightened by 50% of the range.
- D-20: Urgency timer always ticks -- no pause while in profit. Even profitable positions tie up capital.
- D-21: Consolidate all 6 monitor functions into a unified exit engine module (src/exitEngine.ts or extend exitManager.ts). One monitoring loop per position.
- D-22: Remove legacy single-chain exit functions (monitorStopLoss, monitorTakeProfit). The multi-chain code path is the only path.
- D-23: High-water mark is DB-persisted. On restart, trailing stop resumes from the correct peak price.
- D-24: Exit strategy state lives in a separate exit_state table keyed by trade_id. Fields: high_water_mark, partial_tiers_completed, urgency_start_ts, volatility samples.
- D-25: Telegram notification on every sell event: each partial sell (tier info, amount, P&L), trailing stop trigger (peak price, pullback %), and urgency market sell.
- D-26: Notifications include detailed exit reason with strategy context.

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

### Deferred Ideas (OUT OF SCOPE)
- Per-chain trailing stop percentages (different volatility profiles per chain)
- Configurable urgency window via env var (currently fixed at 30 min)
- Emergency sell-all-positions on shutdown
- Multi-pool routing at sell time for V3 (find best fee tier)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXIT-01 | Trailing stop-loss tracks price high-water mark and sells on configured percentage pullback from peak | Decisions D-01 through D-05 define full trailing stop behavior. Architecture section details high-water mark tracking in the unified poll loop. DB persistence via exit_state table (D-23/D-24). |
| EXIT-02 | Partial sells execute at configurable price targets (e.g., sell 50% at 2x, 25% at 5x, trail remainder) | Decisions D-06 through D-11 define partial sell mechanics. Code examples section shows tier parsing, combined sell on gap, and token amount calculation with dust avoidance. |
| EXIT-03 | Stop-loss and take-profit thresholds adjust dynamically based on measured token price volatility | Decisions D-12 through D-15 define volatility adaptation. Architecture section recommends coefficient of variation approach with circular buffer. Pitfalls section covers volatility measurement hazards. |
| EXIT-04 | Exit urgency escalates as position ages -- tighter stops and lower targets over time | Decisions D-16 through D-20 define urgency mechanics. Code examples section shows linear interpolation formula. Replaces existing 5-minute timed sell (D-16). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 | Exit state persistence (exit_state table) | Already in use, schema migration via user_version pragma established in Phase 3 |
| ethers | 6.16.0 | Price queries (V2 getAmountsOut, V3 QuoterV2), sell transactions | Already in use, all chain interaction uses ethers v6 |
| pino | 10.3.1 | Structured logging for exit engine | Already in use, child logger pattern established |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none -- no new dependencies) | - | All exit strategy math is simple arithmetic | Volatility, interpolation, and clamping are all < 20 lines of pure math |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled volatility | trading-signals (v7.4.3) npm package | Adds 1MB dependency for what amounts to a rolling standard deviation. Not justified when we need ~15 lines of circular buffer code. |
| Class-based exit engine | Functional module with closures | Class provides cleaner state encapsulation for per-position data (high-water mark, tiers completed, volatility buffer). Recommend class approach. |

**Installation:**
```bash
# No new packages needed -- all dependencies already present
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  exitEngine.ts           # NEW: Unified exit engine (core logic)
  bot.ts                  # MODIFIED: Remove 6 monitor functions, call startExitMonitor()
  config.ts               # MODIFIED: Add exit strategy env vars
  utils/
    exitManager.ts        # MODIFIED: Simplify timer registry for single timer per position
    db.ts                 # MODIFIED: Add exit_state table, schema version 3, partial_sell action
    notifier.ts           # UNCHANGED: sendCtxAlert reused for exit notifications
    txManager.ts          # UNCHANGED: sendTxWithRetry reused for sell transactions
```

### Pattern 1: Unified Poll Loop (One setInterval Per Position)
**What:** A single 5-second interval per position handles all four exit behaviors in deterministic order each tick: (1) query price, (2) update high-water mark, (3) check partial sell tiers, (4) compute volatility-adjusted trailing stop with urgency, (5) check trailing stop trigger, (6) check urgency hard exit.
**When to use:** Every position monitored by the exit engine.
**Example:**
```typescript
// Pseudocode -- each tick of the 5s interval:
async function pollExitStrategy(state: ExitState): Promise<void> {
    const currentPrice = await queryPrice(state);    // V2 or V3 path
    if (currentPrice === null) { handlePriceError(state); return; }

    const priceMultiple = currentPrice / state.entryPrice;  // e.g., 2.5x

    // 1. Update high-water mark
    if (currentPrice > state.highWaterMark) {
        state.highWaterMark = currentPrice;
        persistHighWaterMark(state);
    }

    // 2. Check partial sell tiers
    const tiersToSell = getUnfilledTiers(state, priceMultiple);
    if (tiersToSell.length > 0) {
        await executePartialSell(state, tiersToSell);
    }

    // 3. Compute effective trailing stop %
    const baseTrailingPct = config.trailingStopPct;
    const volMultiplier = computeVolatilityMultiplier(state);
    const urgencyMultiplier = computeUrgencyMultiplier(state);
    const effectivePct = clamp(
        baseTrailingPct * volMultiplier * urgencyMultiplier,
        config.minTrailingPct,
        config.maxTrailingPct
    );

    // 4. Check trailing stop (only when activated at >= 2x)
    if (state.trailingActivated) {
        const triggerPrice = state.highWaterMark * (1 - effectivePct / 100);
        if (currentPrice <= triggerPrice) {
            await executeSell(state, 'trailing-stop');
            return;
        }
    } else if (priceMultiple >= 2.0) {
        state.trailingActivated = true;
    }

    // 5. Below 2x: fixed stop-loss check
    if (!state.trailingActivated) {
        const fixedStopPrice = state.entryPrice * (1 - config.stopLossPercent / 100);
        if (currentPrice <= fixedStopPrice) {
            await executeSell(state, 'stop-loss');
            return;
        }
    }

    // 6. Urgency hard exit at 30 minutes
    const ageMs = Date.now() - state.urgencyStartTs;
    if (ageMs >= 30 * 60 * 1000) {
        await executeSell(state, 'urgency-market-sell');
    }
}
```

### Pattern 2: ExitState Class (Per-Position State Container)
**What:** A class encapsulating all per-position exit state: entry price, high-water mark, completed tier bitmask, volatility circular buffer, urgency start timestamp, and sell context (chain, dex, token, pool type, fee tier).
**When to use:** Created when exit monitoring starts for a position. Serialized to/from exit_state DB table.
**Example:**
```typescript
interface ExitStateRow {
    trade_id: number;
    entry_price: number;
    high_water_mark: number;
    trailing_activated: number;  // 0 or 1 (SQLite boolean)
    partial_tiers_completed: string;  // JSON array of completed tier indices, e.g., "[0,1]"
    urgency_start_ts: number;         // Unix timestamp (seconds)
    original_token_amount: string;    // BigInt as string for precision
    volatility_samples: string;       // JSON array of recent price samples
}
```

### Pattern 3: Price Query Dispatcher
**What:** The exit engine dispatches to V2 (getAmountsOut) or V3 (QuoterV2 quoteExactInputSingle) price queries based on pool_type stored in the trades table. No code duplication.
**When to use:** Every poll cycle.
**Example:**
```typescript
async function queryPrice(state: ExitState): Promise<number | null> {
    if (state.poolType === 'v3' && state.feeTier != null) {
        return getV3PriceAsNumber(state.ctx, state.dex as DexConfigV3,
            state.tokenAddress, state.feeTier, state.buyAmount);
    } else {
        return getV2PriceAsNumber(state.ctx, state.dex as DexConfigV2,
            state.tokenAddress, state.buyAmount);
    }
}
```

### Pattern 4: Partial Sell with Combined Tiers
**What:** When price gaps past multiple unfilled tiers in one poll, combine their percentages into a single sell transaction. Calculate token amount from original buy amount, not current balance.
**When to use:** Each poll cycle when checking tiers.
**Example:**
```typescript
function getUnfilledTiers(state: ExitState, priceMultiple: number): PartialTier[] {
    return state.tiers.filter((tier, i) =>
        !state.completedTierIndices.has(i) && priceMultiple >= tier.multiple
    );
}

// Combined sell: sum percentages, single TX
// D-07: percentage of ORIGINAL buy amount
function calculateSellAmount(
    originalAmount: bigint,
    tiers: PartialTier[]
): bigint {
    const totalPct = tiers.reduce((sum, t) => sum + t.percent, 0);
    // Use bigint math to avoid precision loss
    const sellAmount = originalAmount * BigInt(totalPct) / 100n;
    return sellAmount;
}
```

### Anti-Patterns to Avoid
- **Multiple intervals per position:** Do NOT create separate intervals for trailing stop, partial sells, and urgency. One interval handles all four behaviors. This was the root cause of the 6-function sprawl being replaced.
- **Floating-point token amounts:** Token amounts MUST use BigInt arithmetic. Never convert token amounts to Number -- precision loss on 18-decimal tokens causes dust or over-sell. Only convert to Number for price comparison ratios.
- **Resetting high-water mark after partial sell:** D-11 explicitly states the high-water mark continues tracking. Do not reset it.
- **Using current balance for partial sell amounts:** D-07 says use original buy amount. If the bot bought 1000 tokens and 50% has been sold, selling "25% at 5x" means 250 tokens (25% of 1000), not 25% of the remaining 500.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sell mutex | Custom lock mechanism | Existing tryAcquireSellLock/releaseSellLock from exitManager.ts | Already handles multi-chain composite keys, proven in production since Phase 1 |
| MEV-protected sell | Custom TX submission | Existing sendTxWithRetry() with ChainContext dispatch | Already handles Flashbots/bloXroute/passthrough per chain |
| Schema migration | Manual ALTER TABLE | Existing user_version pragma pattern in db.ts | Proven in 2 prior migrations (v1: trades table, v2: pool_type/fee_tier columns) |
| Telegram notifications | New notification system | Existing sendCtxAlert() with chain prefix | Already handles [ETH]/[BSC] prefix formatting |
| Timer cleanup | Custom cleanup logic | Existing clearAllTimersForToken() from exitManager.ts | Already handles multi-chain keys, used by shutdown handler |

**Key insight:** This phase is primarily new business logic (exit strategy algorithms) built on top of well-established infrastructure. Nearly all I/O operations (price queries, sell transactions, DB persistence, notifications) reuse existing patterns.

## Common Pitfalls

### Pitfall 1: Floating-Point Precision in Token Amounts
**What goes wrong:** Converting BigInt token amounts to Number for arithmetic loses precision. An 18-decimal token with 1e18 units exceeds Number.MAX_SAFE_INTEGER. Partial sell calculations produce wrong amounts, potentially over-selling or leaving dust.
**Why it happens:** JavaScript Number is IEEE 754 double (53 bits of mantissa). Token amounts regularly exceed 2^53.
**How to avoid:** All token amount math uses BigInt exclusively. Only convert to Number for price ratios (which are small enough for safe floating-point). The partial sell formula `originalAmount * BigInt(pct) / 100n` stays in BigInt space.
**Warning signs:** TypeScript errors about BigInt/Number mixing. Sell amounts that don't match expected percentages in logs.

### Pitfall 2: Race Between Partial Sell and Trailing Stop
**What goes wrong:** If a partial sell is executing (awaiting TX confirmation) and the trailing stop condition triggers in the same or next poll, two sell transactions fire simultaneously.
**Why it happens:** The partial sell releases async control flow while awaiting, and the next poll fires before the first completes.
**How to avoid:** Use the existing per-token sell mutex (tryAcquireSellLock). The partial sell acquires the lock before executing. The trailing stop also tries to acquire the same lock. Only one wins. Additionally, the single-interval design means the next poll evaluation waits for the current one to complete (setInterval callbacks don't overlap if the handler is async and we clear/re-set the interval properly, but the mutex is the safety net).
**Warning signs:** "Another exit already handling token" log messages during a single position's lifecycle.

### Pitfall 3: Entry Price Recovery on Restart
**What goes wrong:** After restart, the exit engine needs the entry price to calculate price multiples for tier checks and trailing stop activation. If entry price is not stored, the engine cannot determine if the position has hit 2x.
**Why it happens:** The current trades table stores amount_in (native currency spent) but not the token price at buy time.
**How to avoid:** Store entry_price in the exit_state table at the time the exit monitor starts. This is the initial price query result (same one used to set the initial stop-loss price in the current code). On restart, load from exit_state.
**Warning signs:** Trailing stop never activating because entry_price is null or 0.

### Pitfall 4: Volatility Multiplier Amplifying Noise on Low Sample Count
**What goes wrong:** With only a few price samples in the buffer, the standard deviation is highly sensitive to individual data points. The volatility multiplier swings wildly, causing the trailing stop to oscillate between very tight and very wide.
**Why it happens:** Statistical measures require minimum sample sizes for stability. At 5-second polls, you only have 12 samples per minute.
**How to avoid:** Apply a minimum sample count before the volatility multiplier takes effect. Below the threshold (e.g., 12 samples = 1 minute of data), use a multiplier of 1.0 (no adjustment). The volatility buffer fills naturally within 1-2 minutes.
**Warning signs:** Trailing stop percentage changing dramatically in the first minute of monitoring.

### Pitfall 5: Partial Sell Dust After Rounding
**What goes wrong:** BigInt division truncates. Selling 50% of an odd number of tokens (e.g., 999n * 50n / 100n = 499n) leaves 1 token of "dust" that was intended to be sold. Over multiple tiers, dust accumulates.
**Why it happens:** Integer division truncates toward zero.
**How to avoid:** For the final tier (or when total sold + current sell would leave less than a threshold), sell the actual remaining balance instead of the calculated amount. The trailing stop sell (D-05) already sells "entire remaining balance," which naturally sweeps dust.
**Warning signs:** Small residual balances after all tiers execute. Token balance not reaching zero after full exit.

### Pitfall 6: Timer Leak on Sell Failure
**What goes wrong:** If a sell transaction fails (reverted, out of gas), the exit monitor interval continues polling but the position is in a broken state -- the sell lock may be released but the trade status might be marked 'failed'.
**Why it happens:** The current sell functions mark trade as 'failed' and clear timers on error, which stops all monitoring. But for partial sells, a failed partial shouldn't kill the entire exit monitor.
**How to avoid:** Differentiate between partial sell failure (log warning, continue monitoring, retry next cycle) and full exit failure (mark failed, clean up). Only clearAllTimersForToken on a full exit attempt failure, not on partial sell failure.
**Warning signs:** Position monitoring stopping entirely after a failed partial sell.

### Pitfall 7: Gap Sell Exceeding Remaining Balance
**What goes wrong:** If price gaps past all tiers simultaneously and the combined percentage exceeds 100% due to misconfiguration (e.g., "2x:50,3x:50,5x:25"), the sell amount exceeds available balance.
**Why it happens:** User configures tiers that sum to more than 100%.
**How to avoid:** Validate tier configuration at startup: sum of all tier percentages must be less than 100% (the remainder trails). If validation fails, log a fatal error and exit. Additionally, clamp sell amount to actual balance at execution time.
**Warning signs:** Startup validation error. At runtime, sell amount exceeding balanceOf result.

## Code Examples

### Tier Configuration Parsing (D-06)
```typescript
// Source: Project convention (env var parsing)
interface PartialTier {
    multiple: number;   // e.g., 2.0 for "2x"
    percent: number;    // e.g., 50 for "50%"
}

function parsePartialSellTargets(envVal: string | undefined): PartialTier[] {
    if (!envVal || envVal.trim() === '') return [];

    const tiers = envVal.split(',').map(entry => {
        const [multStr, pctStr] = entry.trim().split(':');
        const multiple = parseFloat(multStr.replace('x', ''));
        const percent = parseInt(pctStr, 10);
        if (isNaN(multiple) || isNaN(percent) || multiple <= 0 || percent <= 0) {
            throw new Error(`Invalid PARTIAL_SELL_TARGETS entry: "${entry}"`);
        }
        return { multiple, percent };
    });

    // Validate: total percentage < 100
    const totalPct = tiers.reduce((sum, t) => sum + t.percent, 0);
    if (totalPct >= 100) {
        throw new Error(`PARTIAL_SELL_TARGETS total percentage (${totalPct}%) must be < 100%`);
    }

    // Sort by multiple ascending for deterministic evaluation
    return tiers.sort((a, b) => a.multiple - b.multiple);
}
```

### Volatility Measurement (Coefficient of Variation with Circular Buffer)
```typescript
// Recommendation: Use coefficient of variation (CV = stddev / mean) as the volatility metric.
// CV is dimensionless and naturally normalizes across different price ranges.
// A CV of 0.05 (5%) means "normal" volatility; higher values trigger wider stops.

class VolatilityTracker {
    private samples: number[] = [];
    private readonly maxSamples: number;       // e.g., 60 (5 minutes at 5s polls)
    private readonly minSamples: number;       // e.g., 12 (1 minute minimum)
    private readonly baselineCV: number;       // e.g., 0.03 (3% is "normal" for meme tokens)

    constructor(maxSamples = 60, minSamples = 12, baselineCV = 0.03) {
        this.maxSamples = maxSamples;
        this.minSamples = minSamples;
        this.baselineCV = baselineCV;
    }

    addSample(price: number): void {
        this.samples.push(price);
        if (this.samples.length > this.maxSamples) {
            this.samples.shift();   // FIFO circular buffer behavior
        }
    }

    /** Returns multiplier >= 1.0. Higher volatility = wider stops. */
    getMultiplier(): number {
        if (this.samples.length < this.minSamples) return 1.0;

        const mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
        if (mean === 0) return 1.0;

        const variance = this.samples.reduce((sum, s) => sum + (s - mean) ** 2, 0) / this.samples.length;
        const stddev = Math.sqrt(variance);
        const cv = stddev / mean;

        // Multiplier = max(1.0, cv / baselineCV)
        // If cv == baselineCV, multiplier == 1.0
        // If cv == 2 * baselineCV, multiplier == 2.0
        return Math.max(1.0, cv / this.baselineCV);
    }

    /** Serialize for DB persistence */
    toJSON(): string {
        return JSON.stringify(this.samples);
    }

    /** Restore from DB */
    static fromJSON(json: string, maxSamples = 60, minSamples = 12, baselineCV = 0.03): VolatilityTracker {
        const tracker = new VolatilityTracker(maxSamples, minSamples, baselineCV);
        try {
            const parsed = JSON.parse(json);
            if (Array.isArray(parsed)) {
                tracker.samples = parsed.slice(-maxSamples);
            }
        } catch { /* start fresh on corrupt data */ }
        return tracker;
    }
}
```

### Urgency Multiplier (Linear Interpolation, D-19)
```typescript
// D-17: Full window = 30 minutes. D-19: Linear curve.
// D-18: Urgency only tightens the trailing stop pullback %.
//
// urgencyMultiplier ranges from 1.0 (no urgency) to a minimum fraction.
// At 50% of window, trailing stop is tightened by 50% of the range.
// At 100% of window (30 min), trailing stop is at minimum before hard exit.
//
// Example: base trailing stop = 15%, min clamp = 10%
//   At t=0:   effective = 15% * 1.0 = 15%
//   At t=15m: effective = 15% * 0.667 = 10% (clamped to min anyway)
//   At t=30m: hard market sell regardless

function computeUrgencyMultiplier(urgencyStartTs: number, nowMs: number): number {
    const URGENCY_WINDOW_MS = 30 * 60 * 1000;  // 30 minutes
    const ageMs = nowMs - urgencyStartTs;

    if (ageMs <= 0) return 1.0;
    if (ageMs >= URGENCY_WINDOW_MS) return 0.0;  // Signal hard exit

    // Linear: 1.0 at t=0, 0.0 at t=30min
    // But we never actually reach 0 because the hard exit fires first.
    // The practical minimum is determined by the clamp in the caller.
    const fraction = ageMs / URGENCY_WINDOW_MS;
    return 1.0 - fraction;
}
```

### Effective Trailing Stop Percentage (Combining Volatility + Urgency)
```typescript
// D-13: Volatility multiplier widens base threshold
// D-18: Urgency multiplier tightens it
// D-14: Clamped to min/max range

function computeEffectiveTrailingPct(
    baseTrailingPct: number,      // e.g., 15.0  (from TRAILING_STOP_PCT env)
    volMultiplier: number,         // >= 1.0      (from VolatilityTracker)
    urgencyMultiplier: number,     // 0.0 to 1.0  (from urgency calculation)
    minPct: number,                // e.g., 5.0   (from TRAILING_MIN_PCT env)
    maxPct: number                 // e.g., 40.0  (from TRAILING_MAX_PCT env)
): number {
    // First widen with volatility, then tighten with urgency
    const volAdjusted = baseTrailingPct * volMultiplier;
    const urgencyAdjusted = volAdjusted * urgencyMultiplier;
    return Math.max(minPct, Math.min(maxPct, urgencyAdjusted));
}
```

### DB Schema Migration (Version 2 -> 3)
```typescript
// In db.ts migrateSchema(), add:
if (version < 3) {
    db.exec(`
        -- Allow 'partial_sell' as a valid action type
        -- SQLite CHECK constraints cannot be altered, so we recreate via a pragmatic approach:
        -- The existing CHECK on action allows ('buy', 'sell', 'fail').
        -- We need to add 'partial_sell'. SQLite doesn't support ALTER CHECK.
        -- Approach: Create a new table, copy data, rename.
        -- OR: Simply add the exit_state table and use a separate approach for partial_sell.
        --
        -- Pragmatic: Since partial_sell is a new action value, we can:
        -- 1. Create exit_state table (no trades schema change needed)
        -- 2. For partial sells, use action='sell' with a sub-type in a new column
        --    OR relax the CHECK constraint.
        --
        -- Recommended: Recreate trades table with expanded CHECK.

        CREATE TABLE IF NOT EXISTS exit_state (
            trade_id INTEGER PRIMARY KEY,
            entry_price REAL NOT NULL,
            high_water_mark REAL NOT NULL,
            trailing_activated INTEGER NOT NULL DEFAULT 0,
            partial_tiers_completed TEXT NOT NULL DEFAULT '[]',
            original_token_amount TEXT NOT NULL,
            urgency_start_ts INTEGER NOT NULL,
            volatility_samples TEXT NOT NULL DEFAULT '[]',
            FOREIGN KEY (trade_id) REFERENCES trades(id)
        );

        CREATE INDEX IF NOT EXISTS idx_exit_state_trade ON exit_state(trade_id);
    `);

    // Handle the trades table CHECK constraint for 'partial_sell':
    // SQLite approach: Create new table, copy data, drop old, rename.
    db.exec(`
        CREATE TABLE trades_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL COLLATE NOCASE,
            chain TEXT NOT NULL DEFAULT 'mainnet',
            action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'partial_sell', 'fail')),
            tx_hash TEXT,
            block INTEGER,
            timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
            amount_in TEXT,
            amount_out TEXT,
            gas_cost TEXT,
            price_at_action TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sold', 'failed')),
            pool_type TEXT DEFAULT 'v2' CHECK(pool_type IN ('v2', 'v3')),
            fee_tier INTEGER
        );

        INSERT INTO trades_new SELECT * FROM trades;
        DROP TABLE trades;
        ALTER TABLE trades_new RENAME TO trades;

        CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token);
        CREATE INDEX IF NOT EXISTS idx_trades_chain ON trades(chain);
        CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
        CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
    `);

    logger.info('Created exit_state table and expanded trades action CHECK (schema version 3)');
}
```

### Exit Config Env Vars
```typescript
// New env vars for exit strategy (add to config.ts and REQUIRED_ENV_VARS)
// All have sensible defaults -- none are required.
const exitConfig = {
    trailingStopPct: parseFloat(process.env.TRAILING_STOP_PCT || '15'),
    trailingMinPct: parseFloat(process.env.TRAILING_MIN_PCT || '5'),
    trailingMaxPct: parseFloat(process.env.TRAILING_MAX_PCT || '40'),
    partialSellTargets: parsePartialSellTargets(process.env.PARTIAL_SELL_TARGETS),
    stopLossPercent: parseFloat(process.env.STOP_LOSS_PCT || '25'),
    pollIntervalMs: 5000,  // D-04: hardcoded 5s, not configurable
    urgencyWindowMs: 30 * 60 * 1000,  // D-17: hardcoded 30 min
    volatilityBaselineCV: 0.03,  // Baseline coefficient of variation
    volatilityMaxSamples: 60,    // 5 minutes of data at 5s polls
    volatilityMinSamples: 12,    // 1 minute minimum before adjusting
};
```

### Timer Registry Update (Simplified)
```typescript
// exitManager.ts -- Replace separate stopLossInterval/takeProfitInterval/timedSellTimeout
// with a single exitMonitorInterval per position.
interface TokenTimers {
    exitMonitorInterval?: ReturnType<typeof setInterval>;
}

export function registerExitMonitor(
    chainName: string,
    tokenAddress: string,
    interval: ReturnType<typeof setInterval>
): void {
    const key = `${chainName}:${tokenAddress.toLowerCase()}`;
    const entry = timerRegistry.get(key) || {};
    entry.exitMonitorInterval = interval;
    timerRegistry.set(key, entry);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate stop-loss + take-profit intervals | Unified exit monitor with trailing stop | Phase 7 | Eliminates 6 functions (~400 LOC), one monitoring loop per position |
| Fixed 15s poll interval | 5s poll interval | Phase 7 (D-04) | 3x faster response to price changes on volatile tokens |
| Fixed stop-loss/take-profit percentages | Volatility-adaptive thresholds | Phase 7 (D-12/D-13) | Prevents premature stop-outs on high-volatility tokens |
| 5-minute hard timed sell | 30-minute urgency window with gradual tightening | Phase 7 (D-16/D-17) | More nuanced capital recycling, better profit capture |
| All-or-nothing sell | Partial sells at configurable milestones | Phase 7 (D-06) | Lock in profits progressively while letting remainder ride |

**Deprecated/outdated:**
- `monitorStopLoss()`: Replaced by unified exit engine
- `monitorTakeProfit()`: Replaced by unified exit engine
- `scheduleTimedSell()`: Replaced by urgency mechanism
- All `*ForChain` and `*V3ForChain` monitor variants: Replaced by unified exit engine with V2/V3 dispatch
- `CONFIG.stopLossCheckInterval`: Replaced by hardcoded 5s poll interval
- `CONFIG.autoSellAfterMs`: Replaced by 30-minute urgency window
- `CONFIG.takeProfitPercent`: Replaced by partial sell tiers

## Open Questions

1. **Original token amount capture**
   - What we know: The exit engine needs the original token amount bought (D-07) to calculate partial sell amounts. The current code does not store the token output amount from the buy transaction.
   - What's unclear: How to reliably capture the token amount received from the buy swap. The buy TX is submitted via sendTxWithRetry which doesn't return the receipt with logs.
   - Recommendation: After buy TX confirmation, query token balance immediately (before any sell could occur) and store as `original_token_amount` in exit_state. This is the same balance check pattern already used in the monitor functions. Alternatively, parse the swap event logs from the receipt.

2. **Volatility baseline calibration**
   - What we know: The baseline CV of 0.03 (3%) is a reasonable starting point for meme tokens on 5-second intervals.
   - What's unclear: Whether 3% is appropriate across all chains and token types. Meme tokens on BSC may have different volatility profiles than ETH mainnet tokens.
   - Recommendation: Start with 0.03 as default. The min/max clamp (D-14) provides safety bounds regardless of baseline accuracy. This is a Claude's Discretion item, so calibrate based on observation and tune later.

3. **Concurrent partial sell + trailing stop execution**
   - What we know: The sell mutex prevents double-sells within the same position. But should a partial sell tier hit and a trailing stop trigger in the same poll cycle?
   - What's unclear: Order of operations when both conditions are true simultaneously.
   - Recommendation: In the unified poll loop, check partial sell tiers FIRST (they sell a portion), then check trailing stop (which sells the remainder). If tiers execute, the trailing stop evaluation in the same cycle uses the updated state. The mutex handles the actual TX serialization.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Mocha + Chai (via @nomicfoundation/hardhat-toolbox) |
| Config file | hardhat.config.ts (Hardhat toolbox includes Mocha) |
| Quick run command | `npx hardhat test test/exitEngine.test.ts` |
| Full suite command | `npx hardhat test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXIT-01 | Trailing stop tracks high-water mark and triggers sell on pullback | unit | `npx hardhat test test/exitEngine.test.ts --grep "trailing stop"` | No -- Wave 0 |
| EXIT-01 | Fixed stop-loss active below 2x, trailing activates at 2x | unit | `npx hardhat test test/exitEngine.test.ts --grep "activation threshold"` | No -- Wave 0 |
| EXIT-02 | Partial sell tiers execute at configured multiples | unit | `npx hardhat test test/exitEngine.test.ts --grep "partial sell"` | No -- Wave 0 |
| EXIT-02 | Gap past multiple tiers combines into single sell amount | unit | `npx hardhat test test/exitEngine.test.ts --grep "gap sell"` | No -- Wave 0 |
| EXIT-02 | Tier config parsing and validation | unit | `npx hardhat test test/exitEngine.test.ts --grep "tier parsing"` | No -- Wave 0 |
| EXIT-03 | Volatility multiplier widens trailing stop on high volatility | unit | `npx hardhat test test/exitEngine.test.ts --grep "volatility"` | No -- Wave 0 |
| EXIT-03 | Thresholds clamped to min/max range | unit | `npx hardhat test test/exitEngine.test.ts --grep "clamp"` | No -- Wave 0 |
| EXIT-04 | Urgency tightens trailing stop linearly over 30-min window | unit | `npx hardhat test test/exitEngine.test.ts --grep "urgency"` | No -- Wave 0 |
| EXIT-04 | Hard market sell at 30-minute deadline | unit | `npx hardhat test test/exitEngine.test.ts --grep "hard exit"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx hardhat test test/exitEngine.test.ts`
- **Per wave merge:** `npx hardhat test`
- **Phase gate:** Full suite green before /gsd:verify-work

### Wave 0 Gaps
- [ ] `test/exitEngine.test.ts` -- covers EXIT-01, EXIT-02, EXIT-03, EXIT-04 (pure math/logic tests, no chain interaction needed)
- [ ] `test/fixtures/exitEngine.fixtures.ts` -- shared mock price feeds, mock DB, mock ChainContext for unit tests
- [ ] DB schema test (exit_state table creation, migration from v2 to v3)

## Sources

### Primary (HIGH confidence)
- Project codebase: `src/bot.ts` (lines 291-1022) -- all 6 monitor functions analyzed for consolidation
- Project codebase: `src/utils/exitManager.ts` -- sell mutex and timer registry patterns
- Project codebase: `src/utils/db.ts` -- schema migration pattern, better-sqlite3 usage
- Project codebase: `src/chainRegistry.ts` -- DexConfigV2/V3 discriminated union
- Project codebase: `src/config.ts` -- current exit configuration values

### Secondary (MEDIUM confidence)
- [npm: better-sqlite3](https://www.npmjs.com/package/better-sqlite3) -- v12.8.0 confirmed via npm view
- [npm: trading-signals](https://www.npmjs.com/package/trading-signals) -- v7.4.3 evaluated but rejected (too heavy for simple CV calculation)

### Tertiary (LOW confidence)
- Web search: trailing stop loss patterns in crypto trading bots -- confirmed standard approach aligns with D-01/D-02 design
- Web search: volatility measurement approaches -- confirmed coefficient of variation is standard for dimensionless volatility comparison

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies needed, all existing libraries well-understood from 6 prior phases
- Architecture: HIGH - Unified exit engine pattern is a straightforward consolidation of existing duplicated code with well-defined new behaviors
- Pitfalls: HIGH - All pitfalls derived from direct analysis of existing code patterns and BigInt arithmetic requirements
- Volatility model: MEDIUM - CV approach is mathematically sound but baseline calibration (0.03) is an estimate that may need tuning

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable -- no external dependency changes expected)
