# Phase 10: Fix partial_sell Revenue Visibility - Research

**Researched:** 2026-03-30
**Domain:** SQLite query rewriting, financial data aggregation, P&L computation
**Confidence:** HIGH

## Summary

This phase is a pure query-layer fix. The `partial_sell` trade rows already exist in the database (inserted by Phase 7's exit engine at `src/exitEngine.ts:567`), but every downstream query that computes financial metrics -- P&L, exposure, daily loss -- uses `s.action = 'sell'` as a join condition, completely ignoring partial sell rows.

The fix touches 5 prepared statements in `src/utils/db.ts`, 1 inline prepared statement in `src/riskManager.ts`, and possibly 1 new query for per-event P&L chart data in `src/api/routes/risk.ts`. No schema changes, no new tables, no new dependencies. The existing `createTestDb()` helper and mock patterns in tests provide a solid foundation for validation.

**Primary recommendation:** Rewrite the 5 SQL queries to include `partial_sell` rows via `IN ('sell', 'partial_sell')` join conditions, add GROUP BY aggregation to getPnLQuery for per-position summation, and subtract partial sell proceeds from exposure queries via correlated subquery.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Aggregate per buy -- one row per position. SUM all sell revenues (partial_sell + sell) into a single sell_revenue and realized_pnl. Downstream consumers receive one summary row per position, unchanged interface.
- **D-02:** Add sell_count column to the P&L query -- COUNT of all sell + partial_sell rows for that buy. Enables dashboard to indicate partial takes.
- **D-03:** Open positions with partial sells show partial realized P&L. If a position is still pending but has partial_sell rows, P&L query returns the partial sell revenue already received (not null).
- **D-04:** Partial sell proceeds reduce reported exposure. Net exposure = original buy amount_in minus SUM of partial_sell revenue already received. getTotalExposure, getDeployedCapitalByChain, and exposureByChain queries all updated.
- **D-05:** Include all sell events (partial_sell + sell) in the daily loss circuit breaker. getDailyRealizedLoss query updated to JOIN on s.action IN ('sell', 'partial_sell').
- **D-06:** Summary rows only in trade history table and CSV export. Partial sell detail stays in the DB but is not surfaced as separate line items.
- **D-07:** Each partial sell adds a data point to the cumulative P&L chart at the timestamp it happened. The chart's data query must return individual sell events sorted by timestamp, not aggregated per buy.

### Claude's Discretion
- Exact SQL rewrite for getPnLQuery (aggregation approach: subquery vs CTE vs GROUP BY)
- How to pro-rate buy cost and gas across partial sells for the P&L chart data points
- Whether sell_count is a separate column or derived in the API layer
- How to handle edge cases (partial_sell with no final sell yet, multiple buys of same token)
- Whether to add a dedicated chart data query or modify the existing risk/pnl endpoint

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DB-04 | P&L calculated per trade with realized gains/losses queryable by token, chain, and date range | getPnLQuery rewrite with GROUP BY aggregation and `IN ('sell', 'partial_sell')` join condition; D-01, D-02, D-03 |
| DASH-02 | Historical trade log with filtering by chain, date range, and profit/loss | Trade history API already works via getPnL(); aggregated rows now include partial sell revenue; D-06, D-07 for chart |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **RTK prefix:** All bash commands must use `rtk` prefix (e.g., `rtk git status`, `rtk npx vitest run`)
- **Bot entry point:** `npx ts-node src/bot.ts`

## Standard Stack

### Core (already in project -- no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.8.0 | SQLite bindings for prepared statements | Already installed; synchronous API, fastest Node.js SQLite |
| vitest | ^4.1.1 | Test runner (unit + integration) | Already installed; project-wide test framework |
| express | ^5.2.1 | API routes for trade history/risk endpoints | Already installed; serves dashboard API |

### Supporting (already in project)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | ^10.3.1 | Structured logging | For any new log statements in modified queries |

### Alternatives Considered
None. This phase modifies existing SQL queries and TypeScript code only. No new libraries needed.

## Architecture Patterns

### Recommended Change Structure
```
src/
  utils/
    db.ts              # 5 query rewrites + 1 new chart query + PnLResult interface update
  riskManager.ts       # 1 query rewrite (exposureByChain)
  api/routes/
    risk.ts            # P&L chart endpoint uses new per-event query
    trades.ts          # Consumes updated PnLResult (sell_count field)
    positions.ts       # Consumes updated PnLResult (partial realized P&L)
    health.ts          # Consumes updated PnLResult (no code change needed)
test/
  unit/
    db.test.ts         # New tests for P&L aggregation with partial sells
    riskManager.test.ts # Updated mock for exposure with partial sell reduction
  integration/api/
    trades.test.ts     # Updated mock data to include sell_count
    risk.test.ts       # Updated mock to verify chart includes partial sell events
```

### Pattern 1: GROUP BY Aggregation for P&L (Recommended for D-01, D-02)
**What:** Replace the current 1:1 LEFT JOIN (buy->sell) with a GROUP BY on the buy row, joining to ALL sell-type rows.
**When to use:** When a single buy can have multiple sell events (partial_sell + sell).
**Example:**
```sql
SELECT
    b.id           AS buy_id,
    b.token,
    b.chain,
    b.amount_in    AS buy_cost,
    b.gas_cost     AS buy_gas,
    -- D-01: SUM all sell revenues into one figure
    COALESCE(SUM(CAST(COALESCE(s.amount_out, '0') AS REAL)), 0) AS sell_revenue,
    COALESCE(SUM(CAST(COALESCE(s.gas_cost, '0') AS REAL)), 0)   AS sell_gas,
    -- Realized P&L = total sell revenue - buy cost - all gas
    COALESCE(SUM(CAST(COALESCE(s.amount_out, '0') AS REAL)), 0)
        - CAST(b.amount_in AS REAL)
        - CAST(COALESCE(b.gas_cost, '0') AS REAL)
        - COALESCE(SUM(CAST(COALESCE(s.gas_cost, '0') AS REAL)), 0)
        AS realized_pnl,
    b.timestamp    AS buy_time,
    MAX(s.timestamp) AS sell_time,
    -- D-02: Count of sell events
    COUNT(s.id)    AS sell_count,
    b.pool_type,
    b.fee_tier
FROM trades b
LEFT JOIN trades s ON b.token = s.token
                   AND b.chain = s.chain
                   AND s.action IN ('sell', 'partial_sell')
WHERE b.action = 'buy'
  AND (? IS NULL OR b.token = ?)
  AND (? IS NULL OR b.chain = ?)
  AND (? IS NULL OR b.timestamp >= ?)
  AND (? IS NULL OR b.timestamp <= ?)
GROUP BY b.id
ORDER BY b.timestamp DESC
```

**Key points:**
- GROUP BY b.id ensures one row per buy (D-01)
- COUNT(s.id) gives sell_count (D-02) -- counts only matched sell rows, not nulls from LEFT JOIN
- D-03 (open position partial P&L): When no final sell exists but partial_sell rows do, the LEFT JOIN still matches partial_sell rows, producing non-null sell_revenue
- MAX(s.timestamp) as sell_time: for open positions with partial sells, shows the latest partial sell timestamp; for fully closed, shows the final sell timestamp

### Pattern 2: Correlated Subquery for Exposure Reduction (D-04)
**What:** Subtract partial sell proceeds from the buy's amount_in to get net exposure.
**When to use:** getTotalExposure, getDeployedCapitalByChain, exposureByChain queries.
**Example:**
```sql
SELECT COALESCE(SUM(
    CAST(b.amount_in AS REAL)
    - COALESCE((
        SELECT SUM(CAST(COALESCE(ps.amount_out, '0') AS REAL))
        FROM trades ps
        WHERE ps.token = b.token
          AND ps.chain = b.chain
          AND ps.action = 'partial_sell'
    ), 0)
), 0) AS total
FROM trades b
WHERE b.status = 'pending' AND b.action = 'buy'
```

**Note:** Only pending positions have exposure. Partial sell rows reduce that exposure by the ETH received back.

### Pattern 3: Per-Event Query for P&L Chart (D-07)
**What:** A separate query returning individual sell events with pro-rated buy cost for time-series plotting.
**When to use:** The cumulative P&L chart needs per-event granularity, not per-position aggregation.
**Example:**
```sql
SELECT
    s.timestamp   AS sell_time,
    s.token,
    s.chain,
    s.action,     -- 'sell' or 'partial_sell'
    s.amount_out  AS sell_revenue,
    s.gas_cost    AS sell_gas,
    b.amount_in   AS buy_cost,
    b.gas_cost    AS buy_gas,
    -- Pro-rate: count how many sell events exist for this buy
    (SELECT COUNT(*) FROM trades t WHERE t.token = b.token AND t.chain = b.chain AND t.action IN ('sell', 'partial_sell')) AS total_sells
FROM trades s
INNER JOIN trades b ON s.token = b.token
                    AND s.chain = b.chain
                    AND b.action = 'buy'
WHERE s.action IN ('sell', 'partial_sell')
  AND (? IS NULL OR s.timestamp >= ?)
ORDER BY s.timestamp ASC
```

**Pro-rating buy cost:** For chart data points, each sell event's P&L contribution can be computed as:
- `sell_revenue - (buy_cost / total_sells) - sell_gas - (buy_gas / total_sells)`
- This distributes the original buy cost evenly across all sell events
- Alternative: pro-rate by sell_revenue proportion (more accurate but complex)

**Recommendation:** Use equal pro-rating (divide by total_sells). Simpler SQL, correct aggregate, and individual data points are approximate anyway (the cumulative sum at the end matches the true P&L).

### Anti-Patterns to Avoid
- **Multiple JOINs for partial_sell vs sell separately:** Creates cartesian product. Use `IN ('sell', 'partial_sell')` in a single JOIN.
- **Storing computed P&L in the DB:** Phase 3 D-05 established P&L is computed on query. Do not add a pnl column.
- **Changing the PnLResult interface breaking:** Add sell_count as optional field to maintain backward compatibility.
- **Forgetting the chain constraint in JOINs:** A token can theoretically be sniped on multiple chains. Always include `b.chain = s.chain` in JOIN conditions.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL aggregation | Custom JS-side grouping of query results | SQL GROUP BY | DB-side aggregation is faster, atomic, and handles edge cases |
| Pro-rated P&L | Complex JS math for distributing buy cost | SQL subquery with COUNT | Keep computation in SQL consistent with Phase 3 pattern |
| Exposure reduction | Post-query JS subtraction | SQL correlated subquery | Exposure queries are called in the hot path (canSnipe), must be fast |

**Key insight:** All financial computation in this codebase lives in SQL (Phase 3 D-05). Maintain this pattern -- do not pull aggregation into TypeScript.

## Common Pitfalls

### Pitfall 1: Cartesian Product in JOINs with Multiple Sell Rows
**What goes wrong:** Without GROUP BY, joining a buy to N sell rows produces N result rows per position, inflating totals.
**Why it happens:** The current query assumes 1:1 buy:sell. Partial sells make it 1:N.
**How to avoid:** Always GROUP BY b.id when aggregating sell data. COUNT(s.id) not COUNT(*) to avoid counting NULL LEFT JOIN matches.
**Warning signs:** P&L totals are wildly wrong; same position appears multiple times.

### Pitfall 2: amount_out is NULL for All Sells
**What goes wrong:** Both full sells and partial sells currently store `amountOut: null` in the insertTrade call. The P&L query uses `CAST(COALESCE(s.amount_out, '0') AS REAL)` which will be 0 for all sell rows.
**Why it happens:** The exit engine at lines 480 and 575 passes `amountOut: null` because the ETH received from the swap is not captured after `sendTxWithRetry`.
**How to avoid:** This is a **pre-existing limitation** in the data, not something this phase introduces. The P&L calculation works with whatever data exists. If amount_out is always null, realized_pnl will reflect `0 - buy_cost - gas` which is technically wrong but consistent with current behavior. Phase scope does NOT include fixing the sell recording (that would be a separate change to exitEngine).
**Warning signs:** All realized_pnl values are negative even for profitable trades. This is the current state -- acknowledge it in tests.

### Pitfall 3: Open Positions with Partial Sells (D-03)
**What goes wrong:** D-03 requires open positions with partial sells to show partial realized P&L. If the GROUP BY query uses HAVING or filters out positions with no final sell, partial P&L disappears.
**Why it happens:** Over-filtering in the WHERE/HAVING clause.
**How to avoid:** The LEFT JOIN naturally handles this -- partial_sell rows match even when no final sell exists. sell_time will show the latest partial sell timestamp, sell_count > 0, and realized_pnl reflects partial revenue received.
**Warning signs:** Open positions with partial sells show null P&L instead of partial amounts.

### Pitfall 4: sell_time Semantics Change
**What goes wrong:** Currently sell_time = null means "open position, not yet sold." With partial sells, sell_time could be MAX(partial_sell timestamp) even though position is still open.
**Why it happens:** MAX(s.timestamp) returns the latest sell event, which could be a partial_sell.
**How to avoid:** Use a CASE expression or separate columns. Determine open/closed status by checking if `status = 'pending'` on the buy row OR if a final `sell` row exists, NOT by sell_time being null.
**Warning signs:** Dashboard shows "closed" for positions that are still being trailed with partial sells taken.

### Pitfall 5: Multiple Buys of Same Token
**What goes wrong:** If the bot buys the same token twice (different timestamps), the JOIN `b.token = s.token AND b.chain = s.chain` matches sell rows from BOTH buy positions, creating cross-contamination.
**Why it happens:** Token+chain is not a unique key for a position -- the same token can be bought, sold, and bought again.
**How to avoid:** The JOIN should correlate more precisely. Option A: use the fact that sell rows for a given buy are always inserted AFTER the buy and BEFORE the next buy of the same token. Option B: since partial_sell rows have `status='sold'` and are linked by token/chain, and pending buys only have one active position at a time (the latest), filter by buy status or use timestamp ordering.
**Warning signs:** P&L for a token is doubled or includes sells from a different position.

**Recommended approach for Pitfall 5:** The existing query already has this issue with full sells (two buys of same token would cross-match). Since the bot's behavior is to fully close a position before opening a new one (risk manager's isTokenSniped check), this is an edge case that's unlikely in practice. However, adding `AND s.timestamp >= b.timestamp` to the JOIN helps scope sell rows to their corresponding buy.

### Pitfall 6: exposureByChain in riskManager.ts is a Separate Prepared Statement
**What goes wrong:** The `exposureByChain` query in `src/riskManager.ts:48` is defined inline (not imported from db.ts), so fixing the 3 queries in db.ts misses this one.
**Why it happens:** Phase 6 defined it inline consistent with the resumeMonitoring pattern.
**How to avoid:** Include riskManager.ts in the change set. The query must subtract partial sell proceeds just like getTotalExposure and getDeployedCapitalByChain.
**Warning signs:** getPortfolioExposure().byChain shows different exposure values than the total from getTotalExposure.

## Code Examples

### Current getPnLQuery (db.ts:186) -- BEFORE
```typescript
const getPnLQuery = db.prepare(`
    SELECT
        b.token,
        b.chain,
        b.amount_in  AS buy_cost,
        b.gas_cost    AS buy_gas,
        s.amount_out  AS sell_revenue,
        s.gas_cost    AS sell_gas,
        CAST(COALESCE(s.amount_out, '0') AS REAL) - CAST(b.amount_in AS REAL)
            - CAST(COALESCE(b.gas_cost, '0') AS REAL) - CAST(COALESCE(s.gas_cost, '0') AS REAL)
            AS realized_pnl,
        b.timestamp   AS buy_time,
        s.timestamp   AS sell_time,
        b.pool_type,
        b.fee_tier
    FROM trades b
    LEFT JOIN trades s ON b.token = s.token AND s.action = 'sell'
    WHERE b.action = 'buy'
      AND (? IS NULL OR b.token = ?)
      AND (? IS NULL OR b.chain = ?)
      AND (? IS NULL OR b.timestamp >= ?)
      AND (? IS NULL OR b.timestamp <= ?)
    ORDER BY b.timestamp DESC
`);
```

### Updated getPnLQuery -- AFTER (D-01, D-02, D-03)
```typescript
const getPnLQuery = db.prepare(`
    SELECT
        b.id          AS buy_id,
        b.token,
        b.chain,
        b.amount_in   AS buy_cost,
        b.gas_cost    AS buy_gas,
        COALESCE(SUM(CAST(COALESCE(s.amount_out, '0') AS REAL)), 0) AS sell_revenue,
        COALESCE(SUM(CAST(COALESCE(s.gas_cost, '0') AS REAL)), 0)   AS sell_gas,
        COALESCE(SUM(CAST(COALESCE(s.amount_out, '0') AS REAL)), 0)
            - CAST(b.amount_in AS REAL)
            - CAST(COALESCE(b.gas_cost, '0') AS REAL)
            - COALESCE(SUM(CAST(COALESCE(s.gas_cost, '0') AS REAL)), 0)
            AS realized_pnl,
        b.timestamp   AS buy_time,
        MAX(s.timestamp) AS sell_time,
        COUNT(s.id)   AS sell_count,
        b.pool_type,
        b.fee_tier,
        b.status      AS buy_status
    FROM trades b
    LEFT JOIN trades s ON b.token = s.token
                       AND b.chain = s.chain
                       AND s.action IN ('sell', 'partial_sell')
    WHERE b.action = 'buy'
      AND (? IS NULL OR b.token = ?)
      AND (? IS NULL OR b.chain = ?)
      AND (? IS NULL OR b.timestamp >= ?)
      AND (? IS NULL OR b.timestamp <= ?)
    GROUP BY b.id
    ORDER BY b.timestamp DESC
`);
```

### Updated PnLResult Interface
```typescript
export interface PnLResult {
    buy_id: number;
    token: string;
    chain: string;
    buy_cost: string | null;
    buy_gas: string | null;
    sell_revenue: number;      // Changed: now aggregated number, not string|null
    sell_gas: number;          // Changed: now aggregated number, not string|null
    realized_pnl: number;     // Changed: always a number (0 when no sells)
    buy_time: number;
    sell_time: number | null;
    sell_count: number;        // New: D-02
    pool_type: string;
    fee_tier: number | null;
    buy_status: string;        // New: to determine open/closed status
}
```

### Updated getTotalExposure (D-04)
```typescript
const getTotalExposure = db.prepare(`
    SELECT COALESCE(SUM(
        CAST(b.amount_in AS REAL)
        - COALESCE((
            SELECT SUM(CAST(COALESCE(ps.amount_out, '0') AS REAL))
            FROM trades ps
            WHERE ps.token = b.token
              AND ps.chain = b.chain
              AND ps.action = 'partial_sell'
        ), 0)
    ), 0) AS total
    FROM trades b
    WHERE b.status = 'pending' AND b.action = 'buy'
`);
```

### Updated getDailyRealizedLoss (D-05)
```typescript
const getDailyRealizedLoss = db.prepare(`
    SELECT COALESCE(SUM(
        CAST(COALESCE(s.amount_out, '0') AS REAL)
        - CAST(b.amount_in AS REAL)
        - CAST(COALESCE(b.gas_cost, '0') AS REAL)
        - CAST(COALESCE(s.gas_cost, '0') AS REAL)
    ), 0) AS total_loss
    FROM trades b
    INNER JOIN trades s ON b.token = s.token AND b.chain = s.chain AND s.action IN ('sell', 'partial_sell')
    WHERE b.action = 'buy'
      AND b.chain = ?
      AND s.timestamp >= ?
      AND (
          CAST(COALESCE(s.amount_out, '0') AS REAL)
          - CAST(b.amount_in AS REAL)
          - CAST(COALESCE(b.gas_cost, '0') AS REAL)
          - CAST(COALESCE(s.gas_cost, '0') AS REAL)
      ) < 0
`);
```

**Note on getDailyRealizedLoss:** This query computes P&L per sell event, not per position. For the daily loss breaker, each sell event (including partial sells) contributes its own P&L to the daily total. This is correct per D-05: a partial sell profit offsets a later loss.

### Updated exposureByChain in riskManager.ts (D-04)
```typescript
const exposureByChain = db.prepare(`
    SELECT b.chain,
           COALESCE(SUM(
               CAST(b.amount_in AS REAL)
               - COALESCE((
                   SELECT SUM(CAST(COALESCE(ps.amount_out, '0') AS REAL))
                   FROM trades ps
                   WHERE ps.token = b.token
                     AND ps.chain = b.chain
                     AND ps.action = 'partial_sell'
               ), 0)
           ), 0) AS deployed
    FROM trades b
    WHERE b.status = 'pending' AND b.action = 'buy'
    GROUP BY b.chain
`);
```

### API Consumer Updates (trades.ts)
```typescript
// Map to response format -- add sell_count, fix open/closed detection
const tradeResponse = paged.map(t => ({
    // Core
    token: t.token,
    chain: t.chain,
    action: t.buy_status === 'sold' || t.buy_status === 'failed' ? 'closed' : 'open',
    pnl: t.realized_pnl,
    sellCount: t.sell_count,  // D-02: enables "3 sells" display
    // Timing
    buyTime: t.buy_time,
    sellTime: t.sell_time,
    durationHeld: t.sell_time !== null ? t.sell_time - t.buy_time : null,
    // Amounts
    buyCost: t.buy_cost,
    buyGas: t.buy_gas,
    sellRevenue: t.sell_revenue,
    sellGas: t.sell_gas,
    // Exit
    poolType: t.pool_type,
    feeTier: t.fee_tier,
}));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 1:1 buy:sell JOIN | GROUP BY b.id with SUM/COUNT | Phase 10 | Supports 1:N partial sells |
| Exposure = SUM(amount_in) | Exposure = SUM(amount_in - partial_sell_returns) | Phase 10 | More accurate risk gating |
| Daily loss ignores partial sells | Daily loss includes all sell events | Phase 10 | More accurate circuit breaker |
| P&L chart uses sell events only | P&L chart includes partial_sell events | Phase 10 | Granular time-series data |

## Open Questions

1. **amount_out is NULL for all sell rows**
   - What we know: Both `sell` and `partial_sell` insertions pass `amountOut: null` because the exit engine does not capture the ETH received from the swap transaction.
   - What's unclear: Should this phase also fix the sell recording to capture actual ETH received? The P&L query would then produce meaningful realized P&L.
   - Recommendation: **Out of scope for this phase.** The phase description says "fix the SQL queries and API responses -- no new exit strategy logic." The amount_out recording fix belongs in a separate effort. The queries should be written correctly (using amount_out in the calculation) so they produce correct results once amount_out is populated.

2. **Multiple buys of same token on same chain**
   - What we know: The bot checks `isTokenSniped` before buying, preventing re-buying an already-sniped token. But if a position is sold and the token creates a new pair, it could be bought again.
   - What's unclear: Whether the current `isTokenSniped` check is lifetime or per-session. If lifetime, same-token re-buy is impossible.
   - Recommendation: Add `AND s.timestamp >= b.timestamp` to JOIN conditions as a safety measure. Low cost, prevents any cross-contamination.

3. **Pro-rating strategy for P&L chart (D-07)**
   - What we know: Each partial sell needs an assigned P&L for the chart data point. Buy cost must be distributed across sell events.
   - What's unclear: Which pro-rating method is most accurate for DeFi trading.
   - Recommendation: Equal pro-rating (divide buy cost by total sell count). Simple, and cumulative chart sum converges to the true P&L regardless of distribution method.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.1 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --project unit --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-04 | getPnL aggregates partial_sell + sell into one row per buy | unit | `npx vitest run test/unit/db.test.ts -t "partial_sell" -x` | Exists, needs new tests |
| DB-04 | getPnL returns sell_count for positions with partial sells | unit | `npx vitest run test/unit/db.test.ts -t "sell_count" -x` | Exists, needs new tests |
| DB-04 | Open position with partial sells shows partial realized_pnl | unit | `npx vitest run test/unit/db.test.ts -t "partial.*pnl" -x` | Exists, needs new tests |
| DB-04 | Exposure queries subtract partial sell proceeds | unit | `npx vitest run test/unit/db.test.ts -t "exposure" -x` | Exists, needs new tests |
| DB-04 | Daily loss includes partial sell events | unit | `npx vitest run test/unit/riskManager.test.ts -t "daily_loss" -x` | Exists, needs new tests |
| DASH-02 | Trade history surfaces aggregated rows with sell_count | integration | `npx vitest run test/integration/api/trades.test.ts -x` | Exists, needs updated mocks |
| DASH-02 | P&L chart includes partial_sell data points | integration | `npx vitest run test/integration/api/risk.test.ts -t "pnl" -x` | Exists, needs updated test |

### Sampling Rate
- **Per task commit:** `npx vitest run --project unit --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/unit/db.test.ts` -- add partial_sell P&L aggregation tests (5-7 new test cases using createTestDb)
- [ ] `test/unit/riskManager.test.ts` -- add daily loss with partial_sell mock test
- [ ] `test/integration/api/trades.test.ts` -- update mock data to include sell_count in PnLResult
- [ ] `test/integration/api/risk.test.ts` -- add test for partial_sell events in P&L chart

## Sources

### Primary (HIGH confidence)
- `src/utils/db.ts` -- all 5 query definitions examined directly
- `src/riskManager.ts` -- exposureByChain query examined directly
- `src/exitEngine.ts:567-581` -- partial sell insertion examined directly (amountOut: null confirmed)
- `src/api/routes/trades.ts` -- trade history API consumer examined
- `src/api/routes/risk.ts` -- P&L chart endpoint examined
- `src/api/routes/positions.ts` -- positions endpoint examined
- `test/helpers/testDb.ts` -- createTestDb schema confirmed matching production

### Secondary (MEDIUM confidence)
- SQLite GROUP BY + LEFT JOIN + aggregate functions: standard SQL behavior, well-documented

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libs
- Architecture: HIGH -- query rewrites follow established prepared statement pattern
- Pitfalls: HIGH -- directly verified from source code examination, especially the critical amount_out=null finding

**Research date:** 2026-03-30
**Valid until:** Indefinite (pure codebase analysis, no external API dependencies)
