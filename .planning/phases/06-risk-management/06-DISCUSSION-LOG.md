# Phase 6: Risk Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-23
**Phase:** 06-risk-management
**Areas discussed:** Position size enforcement, Daily loss circuit breaker, Open positions & cooldowns, Exposure tracking

---

## Position Size Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Validate snipeAmount on startup | snipeAmount IS the max position size. Add startup validation that snipeAmount doesn't exceed MAX_POSITION_SIZE. | |
| Separate per-trade cap | New MAX_POSITION_SIZE env var independent of snipeAmount. Every snipe checked at execution time. | |
| You decide | Claude picks the approach that best fits the existing config pattern. | ✓ |

**User's choice:** You decide
**Notes:** Claude has discretion on how max position size relates to existing per-chain snipeAmount.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Reject entirely | Skip the snipe with log + Telegram alert. Consistent with Phase 4 MEV-failure behavior. | ✓ |
| Auto-reduce amount | Shrink snipe to fit remaining budget. More capital-efficient but adds complexity. | |
| You decide | Claude picks based on existing pattern. | |

**User's choice:** Reject entirely
**Notes:** Never trade in degraded conditions -- skip rather than degrade.

---

| Option | Description | Selected |
|--------|-------------|----------|
| DB-backed | Query open trades from SQLite to reconstruct deployed capital on startup. | ✓ |
| In-memory only | capitalDeployed Map resets on restart. | |
| You decide | Claude picks the approach. | |

**User's choice:** DB-backed
**Notes:** Trades table already has the data needed. Eliminates restart-drift problem.

---

## Daily Loss Circuit Breaker

| Option | Description | Selected |
|--------|-------------|----------|
| Realized only | Only count trades that actually closed at a loss. Clear, objective. | ✓ |
| Realized + unrealized | Include paper losses on open positions. More conservative. | |
| You decide | Claude picks the approach. | |

**User's choice:** Realized only
**Notes:** Uses existing P&L query in db.ts.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Absolute amount per chain | e.g., ETH_DAILY_LOSS_LIMIT=0.5 -- halt after 0.5 ETH losses. | |
| Percentage of max capital | e.g., DAILY_LOSS_PCT=10 -- halt after losing 10% of maxCapital. | ✓ |
| You decide | Claude picks the approach. | |

**User's choice:** Percentage of max capital
**Notes:** Scales automatically with budget size.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-resume after 24h window rolls | Rolling 24h window -- old losses age out naturally. Self-healing. | ✓ |
| Manual reset required | Bot stays halted until operator intervenes. | |
| Auto-resume at midnight UTC | Fixed daily reset. | |
| You decide | Claude picks the approach. | |

**User's choice:** Auto-resume after 24h window rolls
**Notes:** No manual intervention needed. Self-healing.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Keep monitoring open positions | Only halt NEW snipes. Existing positions still have stop-loss/take-profit. | ✓ |
| Force-sell all positions | Panic exit everything. Maximum capital preservation. | |
| You decide | Claude picks the approach. | |

**User's choice:** Keep monitoring open positions
**Notes:** Less disruptive. Positions may recover.

---

## Open Positions & Cooldowns

| Option | Description | Selected |
|--------|-------------|----------|
| Global limit | MAX_OPEN_POSITIONS across all chains. Simple portfolio-level cap. | ✓ |
| Per-chain limit | Per-chain position caps. Finer control but more env vars. | |
| Both global + per-chain | Most flexible but most complex. | |
| You decide | Claude picks the approach. | |

**User's choice:** Global limit
**Notes:** Per-chain budgets already handle chain-specific risk.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed cooldown per chain | After sniping on ETH, wait 30s before another ETH snipe. Chains independent. | ✓ |
| Global cooldown | After any snipe anywhere, wait before next snipe anywhere. | |
| No cooldown needed | Position limits and capital budgets are sufficient. | |
| You decide | Claude picks the approach. | |

**User's choice:** Fixed cooldown per chain
**Notes:** Different chains can snipe concurrently. Prevents hammering one chain during launch waves.

---

| Option | Description | Selected |
|--------|-------------|----------|
| DB query | COUNT(*) WHERE status='pending'. Always accurate, survives restarts. | ✓ |
| In-memory counter | Increment on buy, decrement on sell. Faster but drifts on crash. | |
| You decide | Claude picks the approach. | |

**User's choice:** DB query
**Notes:** Single source of truth. SQLite overhead is negligible.

---

## Exposure Tracking

| Option | Description | Selected |
|--------|-------------|----------|
| Total capital deployed | Sum of amount_in for all pending trades. No live price feeds needed. | ✓ |
| Deployed + unrealized P&L | Capital deployed plus live mark-to-market. More accurate but complex. | |
| You decide | Claude picks the approach. | |

**User's choice:** Total capital deployed
**Notes:** Simple DB aggregate. No price feed dependency.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Active enforcement | Global MAX_TOTAL_EXPOSURE cap. Reject snipes if exceeded. | ✓ |
| Read-only / informational | Queryable but doesn't block trading. Dashboard-only. | |
| You decide | Claude picks the approach. | |

**User's choice:** Active enforcement
**Notes:** Portfolio-level safety net above per-chain budgets.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Standalone module | New src/riskManager.ts with canSnipe() gate function. | ✓ |
| Inline in bot.ts | Add risk checks directly in handleNewPairForChain(). | |
| You decide | Claude picks the approach. | |

**User's choice:** Standalone module
**Notes:** Clean separation, independently testable. bot.ts is already large.

---

## Claude's Discretion

- Max position size approach (D-01)
- canSnipe() return type (boolean vs result with rejection reason)
- Cooldown tracking structure
- DB query design for 24h rolling loss
- Capital tracking migration from in-memory to DB-backed
- Config structure for risk parameters
- Telegram alert format for risk rejections

## Deferred Ideas

None -- discussion stayed within phase scope
