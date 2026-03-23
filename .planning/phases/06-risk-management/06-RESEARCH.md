# Phase 6: Risk Management - Research

**Researched:** 2026-03-23
**Domain:** Portfolio-level risk controls for multi-chain sniper bot (TypeScript, SQLite, ethers v6)
**Confidence:** HIGH

## Summary

Phase 6 creates a standalone `src/riskManager.ts` module that gates every snipe with five risk controls: max position size, daily loss circuit breaker, open position limit, cooldown enforcement, and total exposure cap. The implementation is entirely internal -- no new external dependencies, no new APIs. All state is derived from the existing SQLite `trades` table using `better-sqlite3` prepared statements, following the established DB-as-source-of-truth pattern from Phase 3.

The architecture is straightforward: a single `canSnipe(chain, amount)` function that bot.ts calls before each snipe. Each risk rule is a pure check against DB state or in-memory cooldown timestamps. The existing `capitalDeployed` Map in bot.ts (lines 73-84) is replaced by DB-backed queries. The existing `getPnL()` function in db.ts provides the foundation for the 24h rolling loss calculation but needs a dedicated query optimized for the circuit breaker use case.

**Primary recommendation:** Implement riskManager.ts as a stateless gate module that queries SQLite for capital/loss/position data and uses an in-memory Map only for cooldown timestamps (ephemeral by design -- cooldowns reset on restart, which is safe). Insert the `canSnipe()` call at the top of both `handleNewPairForChain()` and `handleNewV3PoolForChain()` before any safety checks or capital budget checks, replacing the existing inline `canDeployCapital()` check.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Claude's discretion on how max position size relates to existing per-chain `snipeAmount` -- pick the approach that best fits the existing config pattern (separate cap vs startup validation).
- **D-02:** When a snipe would exceed the capital budget, reject the snipe entirely with log + Telegram alert. Never auto-reduce. Consistent with Phase 4's MEV-failure pattern: skip the trade, don't degrade it.
- **D-03:** Capital tracking is DB-backed -- query open trades from SQLite to reconstruct deployed capital on startup. The existing in-memory `capitalDeployed` Map in `bot.ts` should be replaced or initialized from DB. Trades table already has `amount_in`, `status`, and `chain` columns needed.
- **D-04:** Daily loss calculation uses realized losses only (closed trades that lost money). No unrealized/paper losses. Uses the existing P&L query infrastructure in `db.ts`.
- **D-05:** Loss threshold configured as percentage of maxCapital per chain -- e.g., `DAILY_LOSS_PCT=10` halts sniping on a chain after losing 10% of that chain's `maxCapital` in realized losses over 24h.
- **D-06:** Auto-resume via rolling 24h window -- once old losses age past 24 hours, the bot naturally resumes. No manual intervention needed. Self-healing.
- **D-07:** When circuit breaker trips, only halt new snipes. Existing open positions continue being monitored with stop-loss/take-profit active. Positions may recover.
- **D-08:** Global max open positions limit across all chains (e.g., `MAX_OPEN_POSITIONS=10`). Per-chain capital budgets already control chain-specific risk; this is the portfolio-level cap.
- **D-09:** Fixed cooldown per chain (e.g., `SNIPE_COOLDOWN_MS=30000`). After sniping on ETH, wait 30s before another ETH snipe. Different chains can snipe concurrently -- a BSC snipe doesn't block an ETH opportunity. Prevents hammering one chain during launch waves.
- **D-10:** Open position count tracked via DB query (`COUNT(*) WHERE status='pending'` on trades table). Always accurate, survives restarts, single source of truth. SQLite overhead is negligible.
- **D-11:** Portfolio exposure = total capital deployed (sum of `amount_in` for all pending trades across all chains). No live price feeds needed. Simple DB aggregate.
- **D-12:** Exposure is actively enforced -- global `MAX_TOTAL_EXPOSURE` cap. If total deployed capital across all chains exceeds this, reject new snipes. Portfolio-level safety net above per-chain budgets.
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

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RISK-01 | Configurable max position size caps ETH/BNB per snipe trade | D-01/D-02: Position size validated against per-chain snipeAmount in ChainConfig. Reject entire snipe if exceeds cap. Research recommends startup validation that snipeAmount <= maxPositionSize rather than separate cap. |
| RISK-02 | Daily loss limit halts sniping when realized losses exceed configured threshold in 24h | D-04/D-05/D-06/D-07: Rolling 24h window query on trades table with realized P&L. Per-chain percentage of maxCapital. Only halts new snipes, not monitoring. |
| RISK-03 | Max open positions limit prevents exceeding configured concurrent position count | D-08/D-10: Global COUNT(*) WHERE status='pending' query. Simple integer comparison. |
| RISK-04 | Configurable cooldown period between snipes prevents overtrading | D-09: Per-chain Map<string, number> tracking last snipe timestamp. Ephemeral (resets on restart = safe). |
| RISK-05 | Portfolio-level exposure tracking shows total capital at risk | D-11/D-12: SUM(CAST(amount_in AS REAL)) WHERE status='pending' aggregate. Actively enforced via MAX_TOTAL_EXPOSURE cap. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.8.0 | Risk state queries (positions, P&L, exposure) | Already in project. Synchronous API ideal for gate checks -- no async overhead for sub-ms DB queries. |
| pino | ^10.3.1 | Structured logging for risk manager | Already in project. Child logger pattern established (module: 'riskManager'). |
| ethers | 6.16.0 | parseEther for position size comparisons | Already in project. Used only for unit conversions in risk config parsing. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | - | Phase 6 requires zero new dependencies. All risk logic uses existing project dependencies. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQLite queries for state | In-memory Maps | Maps drift from truth on restart; DB survives crashes. D-03/D-10 mandate DB. |
| Synchronous better-sqlite3 | Async sqlite wrapper | Sync is faster for gate checks (no event loop yield); better-sqlite3 already chosen in Phase 3. |
| Result object from canSnipe | Boolean return | Result object carries rejection reason for logging/alerting. Recommended over boolean. |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  riskManager.ts          # NEW: Standalone risk gate module
  bot.ts                  # MODIFIED: Insert canSnipe() calls, remove capitalDeployed Map
  config.ts               # MODIFIED: Add risk env var validation
  chainRegistry.ts        # UNMODIFIED (read-only for ChainConfig types)
  utils/
    db.ts                 # MODIFIED: Add risk-specific prepared statements
    notifier.ts           # UNMODIFIED (used for risk rejection alerts)
```

### Pattern 1: Result Object Gate Pattern
**What:** `canSnipe()` returns a typed result with rejection reason, not just a boolean.
**When to use:** When the caller needs to log/alert the specific reason for rejection.
**Example:**
```typescript
// src/riskManager.ts
export interface RiskCheckResult {
    allowed: boolean;
    reason?: string;   // e.g., 'daily_loss_limit', 'max_positions', 'cooldown', 'exposure_cap', 'position_size'
    details?: string;  // Human-readable detail for Telegram alert
}

export function canSnipe(chainName: string, amountEth: string, maxCapitalEth: string): RiskCheckResult {
    // Check 1: Position size
    // Check 2: Daily loss circuit breaker (per-chain)
    // Check 3: Open positions (global)
    // Check 4: Cooldown (per-chain)
    // Check 5: Total exposure (global)
    return { allowed: true };
}
```

### Pattern 2: Prepared Statement Queries in db.ts
**What:** Add risk-specific prepared statements alongside existing ones in db.ts.
**When to use:** For all DB-backed risk checks (open positions, exposure, daily loss).
**Example:**
```typescript
// In src/utils/db.ts -- new prepared statements

// RISK-03: Count open positions across all chains
const getOpenPositionCount = db.prepare(
    `SELECT COUNT(*) AS count FROM trades WHERE status = 'pending' AND action = 'buy'`
);

// RISK-05: Total deployed capital across all chains
const getTotalExposure = db.prepare(
    `SELECT COALESCE(SUM(CAST(amount_in AS REAL)), 0) AS total
     FROM trades WHERE status = 'pending' AND action = 'buy'`
);

// RISK-02: Realized losses in rolling 24h window for a specific chain
const getDailyRealizedLoss = db.prepare(`
    SELECT COALESCE(SUM(
        CAST(COALESCE(s.amount_out, '0') AS REAL) - CAST(b.amount_in AS REAL)
        - CAST(COALESCE(b.gas_cost, '0') AS REAL) - CAST(COALESCE(s.gas_cost, '0') AS REAL)
    ), 0) AS total_loss
    FROM trades b
    INNER JOIN trades s ON b.token = s.token AND s.action = 'sell'
    WHERE b.action = 'buy'
      AND b.chain = ?
      AND s.timestamp >= ?
      AND (CAST(COALESCE(s.amount_out, '0') AS REAL) - CAST(b.amount_in AS REAL)
           - CAST(COALESCE(b.gas_cost, '0') AS REAL) - CAST(COALESCE(s.gas_cost, '0') AS REAL)) < 0
`);

// D-03: Deployed capital per chain (replaces in-memory Map)
const getDeployedCapitalByChain = db.prepare(
    `SELECT COALESCE(SUM(CAST(amount_in AS REAL)), 0) AS deployed
     FROM trades WHERE status = 'pending' AND action = 'buy' AND chain = ?`
);
```

### Pattern 3: Per-Chain Cooldown with In-Memory Map
**What:** Simple Map<string, number> tracking last snipe unix timestamp per chain.
**When to use:** Cooldown is ephemeral by design -- resets on restart are safe (D-09).
**Example:**
```typescript
// In src/riskManager.ts
const lastSnipeTime = new Map<string, number>(); // chain name -> Date.now()

function checkCooldown(chainName: string, cooldownMs: number): RiskCheckResult {
    const last = lastSnipeTime.get(chainName) || 0;
    const elapsed = Date.now() - last;
    if (elapsed < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
        return { allowed: false, reason: 'cooldown', details: `Cooldown active on ${chainName}: ${remaining}s remaining` };
    }
    return { allowed: true };
}

// Called AFTER successful snipe to record timestamp
export function recordSnipe(chainName: string): void {
    lastSnipeTime.set(chainName, Date.now());
}
```

### Pattern 4: Risk Config via Flat Env Vars
**What:** Follow existing per-chain env var pattern for risk parameters.
**When to use:** All risk configuration (consistent with ETH_SNIPE_AMOUNT, ETH_MAX_CAPITAL pattern).
**Example:**
```typescript
// Environment variables for risk management (all optional with sensible defaults)
// Global:
//   MAX_OPEN_POSITIONS=10          (default: 10)
//   MAX_TOTAL_EXPOSURE=5.0         (default: sum of all chain maxCapital)
//   DAILY_LOSS_PCT=10              (default: 10, percentage of per-chain maxCapital)
//   SNIPE_COOLDOWN_MS=30000        (default: 30000, 30 seconds)
//   MAX_POSITION_SIZE=0.1          (default: per-chain snipeAmount, acts as hard cap)
```

### Anti-Patterns to Avoid
- **Scattering risk checks across bot.ts:** All risk logic goes in riskManager.ts. bot.ts calls one function. If rules are spread across handleNewPairForChain, handleNewV3PoolForChain, and handleNewPair, they will inevitably drift.
- **Async DB queries for gate checks:** better-sqlite3 is synchronous. Using async wrappers adds unnecessary complexity and event loop delays for microsecond queries.
- **Caching DB query results:** The trades table is small (hundreds of rows at most). Running fresh queries on each canSnipe() call ensures accuracy. Caching introduces staleness risk for safety-critical data.
- **Checking risk AFTER safety checks:** Risk gate should be the FIRST check after dedup. Running 8 safety API calls before discovering the bot is at max positions wastes time and API quota.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL date arithmetic | Custom timestamp math | SQLite `unixepoch()` and arithmetic on `timestamp` column | SQLite handles epoch math natively; no timezone bugs |
| Concurrent access safety | Custom locking | SQLite WAL mode + better-sqlite3 sync API | Already configured in Phase 3; JS is single-threaded so sync queries are atomic |
| ETH/BNB unit conversion | Manual BigInt math for config | `ethers.parseEther()` / `ethers.formatEther()` | Already used throughout codebase for consistent unit handling |

**Key insight:** This phase adds zero new external concepts. Every pattern (DB queries, pino logging, Telegram alerts, env var config) already exists in the codebase. The risk is not technical complexity but integration correctness -- making sure the gate is inserted at the right point in both V2 and V3 pipelines, and that the existing `capitalDeployed` Map is fully replaced.

## Common Pitfalls

### Pitfall 1: Race Condition Between canSnipe() and recordCapitalDeployed()
**What goes wrong:** Two concurrent event handlers both call `canSnipe()`, both pass (e.g., 9 open positions, limit is 10), and both proceed to snipe, resulting in 11 open positions.
**Why it happens:** Event handlers are async; multiple PairCreated events can fire simultaneously across chains and DEXes.
**How to avoid:** This is mitigated by JS single-threadedness -- the synchronous DB query in canSnipe() and the synchronous insertTrade.run() execute atomically within a single tick. The async gap is between canSnipe() (passes) and the actual trade insertion (which happens after the swap TX confirms). To handle this, either: (a) insert a "pending" trade record BEFORE sending the TX (optimistic insert, update to failed if TX fails), or (b) accept that the limit is approximate during the TX flight window. Option (a) is recommended since it matches the existing insertTrade pattern.
**Warning signs:** Open position count exceeding MAX_OPEN_POSITIONS by more than 1.

### Pitfall 2: Daily Loss Calculation With NULL Gas Costs
**What goes wrong:** The P&L query produces incorrect results because `gas_cost` is NULL for some trades (gas is not always recorded).
**Why it happens:** The existing insertTrade call in bot.ts inserts `gasCost: null` for buys (gas cost is unknown at bundle submission time via MEV).
**How to avoid:** Use `COALESCE(gas_cost, '0')` in all P&L calculations (already done in the existing getPnLQuery). Ensure the daily loss query follows the same COALESCE pattern.
**Warning signs:** Daily losses appearing as NULL instead of a number.

### Pitfall 3: TEXT vs REAL Arithmetic in SQLite
**What goes wrong:** `amount_in` is stored as TEXT in SQLite. Summing TEXT values without CAST produces string concatenation, not numeric addition.
**Why it happens:** The trades table schema defines `amount_in TEXT` (stores ETH values like '0.01').
**How to avoid:** Always use `CAST(amount_in AS REAL)` in aggregate queries. The existing getPnLQuery already uses this pattern -- follow it exactly.
**Warning signs:** Exposure showing as '0.010.010.05' instead of 0.07.

### Pitfall 4: Legacy handleNewPair() Missing Risk Gate
**What goes wrong:** Legacy single-chain `handleNewPair()` (line 1042) routes through the old code path without risk checks. Alpha drops via Telegram bypass risk management entirely.
**Why it happens:** `alphaDrop.ts` calls `handleNewPair()` directly, not `handleNewPairForChain()`.
**How to avoid:** Add risk gate to `handleNewPair()` as well, OR refactor `alphaDrop.ts` to use the multi-chain path. The simplest approach is adding canSnipe() to legacy handleNewPair() with legacy ETH chain defaults.
**Warning signs:** Telegram alpha drops triggering snipes when the bot should be halted by risk rules.

### Pitfall 5: Cooldown Not Recorded on Failed Snipes
**What goes wrong:** A snipe attempt fails (TX reverts), but the cooldown timestamp was recorded, blocking the next legitimate opportunity.
**Why it happens:** `recordSnipe()` called before TX confirmation.
**How to avoid:** Call `recordSnipe()` only after successful TX submission (same location as `recordCapitalDeployed()`). If the TX fails, no cooldown is imposed.
**Warning signs:** Bot sitting idle for cooldown period after a failed snipe.

### Pitfall 6: Exposure Mismatch With Mixed Denomination Chains
**What goes wrong:** Total exposure sums 0.01 ETH (from ETH chain) + 0.05 BNB (from BSC chain) as 0.06, treating them as equivalent. They are not -- BNB and ETH have different USD values.
**Why it happens:** `MAX_TOTAL_EXPOSURE` is a single number but chains use different native currencies.
**How to avoid:** This is an accepted limitation per D-11 ("No live price feeds needed. Simple DB aggregate"). The user must set `MAX_TOTAL_EXPOSURE` with awareness that it sums raw native amounts. Document this clearly. Alternative: separate exposure caps per currency, but this adds complexity the user explicitly chose to avoid.
**Warning signs:** None -- this is by design. Document in config comments.

## Code Examples

### Risk Manager Module Structure
```typescript
// src/riskManager.ts
import { db } from './utils/db';
import { logger } from './utils/logger';
import { ethers } from 'ethers';

const log = logger.child({ module: 'riskManager' });

// --- Types ---

export interface RiskCheckResult {
    allowed: boolean;
    reason?: string;
    details?: string;
}

// --- Config (from env vars with defaults) ---

interface RiskConfig {
    maxOpenPositions: number;
    maxTotalExposure: number;          // In native units (sum across chains)
    dailyLossPct: number;              // Percentage of per-chain maxCapital
    snipeCooldownMs: number;           // Milliseconds between snipes per chain
    maxPositionSize: number | null;    // If set, hard cap per snipe; null = use chain.snipeAmount
}

function loadRiskConfig(): RiskConfig {
    return {
        maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '10', 10),
        maxTotalExposure: parseFloat(process.env.MAX_TOTAL_EXPOSURE || '10.0'),
        dailyLossPct: parseFloat(process.env.DAILY_LOSS_PCT || '10'),
        snipeCooldownMs: parseInt(process.env.SNIPE_COOLDOWN_MS || '30000', 10),
        maxPositionSize: process.env.MAX_POSITION_SIZE ? parseFloat(process.env.MAX_POSITION_SIZE) : null,
    };
}

const config = loadRiskConfig();

// --- Cooldown State (in-memory, ephemeral by design per D-09) ---

const lastSnipeTime = new Map<string, number>();

// --- Public API ---

export function canSnipe(chainName: string, amountEth: string, maxCapitalEth: string): RiskCheckResult {
    // ... checks in sequence, first failure returns
}

export function recordSnipe(chainName: string): void {
    lastSnipeTime.set(chainName, Date.now());
}

export function getPortfolioExposure(): { total: number; byChain: Record<string, number> } {
    // RISK-05: queryable at any time
}
```

### Integration Point in bot.ts (V2)
```typescript
// In handleNewPairForChain(), BEFORE safety checks, AFTER dedup + blocklist:
import { canSnipe, recordSnipe } from './riskManager';

// Replace existing canDeployCapital check (lines 608-613) with:
const riskResult = canSnipe(ctx.chain.name, ctx.chain.snipeAmount, ctx.chain.maxCapital);
if (!riskResult.allowed) {
    ctx.log.warn({ token: targetToken, reason: riskResult.reason, details: riskResult.details }, 'Risk check failed, skipping snipe');
    await sendCtxAlert(ctx, `*Risk: ${riskResult.details}* -- skipping \`${symbol || targetToken}\``);
    return;
}

// After successful TX submission (replacing recordCapitalDeployed call):
recordSnipe(ctx.chain.name);
```

### Daily Loss Rolling Window Query
```typescript
// In src/utils/db.ts
const getDailyRealizedLoss = db.prepare(`
    SELECT COALESCE(SUM(
        CAST(COALESCE(s.amount_out, '0') AS REAL)
        - CAST(b.amount_in AS REAL)
        - CAST(COALESCE(b.gas_cost, '0') AS REAL)
        - CAST(COALESCE(s.gas_cost, '0') AS REAL)
    ), 0) AS total_loss
    FROM trades b
    INNER JOIN trades s ON b.token = s.token AND s.action = 'sell'
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
// Usage: getDailyRealizedLoss.get(chainName, Math.floor(Date.now() / 1000) - 86400)
// Returns { total_loss: -0.05 } (negative = loss)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| In-memory Map for capital tracking | DB-backed query (this phase) | Phase 6 | Eliminates restart-drift where bot over-deploys after crash |
| No daily loss protection | Rolling 24h circuit breaker (this phase) | Phase 6 | Self-healing protection without manual intervention |
| No position limits | Global max open positions (this phase) | Phase 6 | Prevents portfolio concentration risk |

**Deprecated/outdated:**
- `capitalDeployed` Map in bot.ts (lines 73-84): Replaced by DB query in riskManager.ts
- `canDeployCapital()` function in bot.ts (line 75): Subsumed by `canSnipe()` which checks all risk rules including capital budget

## Open Questions

1. **Position Size Cap vs snipeAmount Validation**
   - What we know: D-01 gives discretion on how max position size relates to per-chain `snipeAmount`. Two approaches: (a) startup validation that snipeAmount <= maxPositionSize with fatal exit if violated, or (b) runtime check in canSnipe() that the requested amount doesn't exceed the cap.
   - What's unclear: Whether there's a use case for snipeAmount being dynamic (e.g., changed via dashboard in future Phase 8).
   - Recommendation: Use startup validation (option a). The `snipeAmount` is read from env vars at boot and never changes. A runtime check adds no value if the config is immutable. If future phases add dynamic amounts, they can add a runtime check then.

2. **Legacy handleNewPair() Coverage**
   - What we know: `handleNewPair()` is the legacy single-chain path used by `alphaDrop.ts`. It does not use ChainConfig and has no chain parameter.
   - What's unclear: Whether alpha drops should go through full risk management or are intentional manual overrides.
   - Recommendation: Add risk gate to legacy `handleNewPair()` using default 'eth' chain name. Alpha drops should respect risk limits -- if the bot's daily loss limit is hit, manual alpha drops should also be blocked. The user can restart the bot or wait 24h if they disagree.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Mocha + Chai (via @nomicfoundation/hardhat-toolbox 6.1.0) |
| Config file | hardhat.config.ts (Hardhat's built-in mocha test runner) |
| Quick run command | `npx hardhat test test/riskManager.test.ts` |
| Full suite command | `npx hardhat test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RISK-01 | canSnipe rejects when position size exceeds max | unit | `npx hardhat test test/riskManager.test.ts --grep "position size"` | Wave 0 |
| RISK-02 | canSnipe rejects when 24h realized losses exceed daily loss limit | unit | `npx hardhat test test/riskManager.test.ts --grep "daily loss"` | Wave 0 |
| RISK-03 | canSnipe rejects when open position count equals max | unit | `npx hardhat test test/riskManager.test.ts --grep "open positions"` | Wave 0 |
| RISK-04 | canSnipe rejects during cooldown period, allows after expiry | unit | `npx hardhat test test/riskManager.test.ts --grep "cooldown"` | Wave 0 |
| RISK-05 | getPortfolioExposure returns correct total; canSnipe rejects above cap | unit | `npx hardhat test test/riskManager.test.ts --grep "exposure"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx hardhat test test/riskManager.test.ts`
- **Per wave merge:** `npx hardhat test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/riskManager.test.ts` -- covers RISK-01 through RISK-05 (all five risk rules)
- [ ] `test/fixtures/riskTestDb.ts` -- shared fixture for in-memory SQLite with trades table for test isolation

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** -- Direct reading of src/bot.ts, src/utils/db.ts, src/chainRegistry.ts, src/config.ts, src/utils/notifier.ts (all verified line-by-line)
- **06-CONTEXT.md** -- 13 locked decisions (D-01 through D-13) defining exact requirements
- **Phase 3/4/5 CONTEXT.md** -- Referenced for established patterns (SQLite, per-chain env vars, MEV skip pattern)

### Secondary (MEDIUM confidence)
- **better-sqlite3 API** -- Synchronous prepared statements, WAL mode (verified by existing usage in src/utils/db.ts)

### Tertiary (LOW confidence)
- None -- this phase uses only internal patterns with no new external dependencies

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all patterns already established in codebase
- Architecture: HIGH -- single-module gate pattern is simple and well-defined by 13 locked decisions
- Pitfalls: HIGH -- identified from direct code analysis of existing bot.ts capital tracking and DB schema
- Integration points: HIGH -- exact line numbers identified for all three handler functions (handleNewPairForChain, handleNewV3PoolForChain, handleNewPair)

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (stable -- internal codebase patterns, no external API changes)
