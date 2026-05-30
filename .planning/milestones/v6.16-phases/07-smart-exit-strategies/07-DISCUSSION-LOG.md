# Phase 7: Smart Exit Strategies - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-25
**Phase:** 07-smart-exit-strategies
**Areas discussed:** Trailing stop-loss mechanics, Partial sell targets, Volatility-adaptive thresholds, Time-weighted exit urgency, Exit engine architecture, Position state persistence, Notification strategy

---

## Trailing Stop-Loss Mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| Immediately from buy price | High-water mark = buy price initially, then ratchets up on every poll | |
| After reaching a profit threshold | Only start trailing after 1.5x or 2x. Below that, use fixed stop-loss | ✓ |
| You decide | Claude picks the approach | |

**User's choice:** After reaching a profit threshold
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Single global percentage | e.g., TRAILING_STOP_PCT=15 | ✓ |
| Per-chain percentage | Different chains, different percentages | |
| You decide | Claude picks | |

**User's choice:** Single global percentage
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| 1.5x (50% profit) | Starts trailing fairly early | |
| 2x (100% profit) | Classic doubling threshold | ✓ |
| Configurable via env var | Defaults to 2x but tunable | |

**User's choice:** 2x (100% profit)
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed stop-loss from entry | Use existing stopLossPercent below trail activation | ✓ |
| No stop-loss until trail activates | Let position ride freely | |
| You decide | Claude picks | |

**User's choice:** Fixed stop-loss from entry
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Same 15s interval | Consistent with V2/V3 monitoring | |
| Faster polling (5s) | More responsive to fast-moving tokens | ✓ |
| You decide | Claude picks | |

**User's choice:** Faster polling (5s)
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Sell everything remaining | Full exit on whatever balance is left | ✓ |
| You decide | Claude picks based on partials interaction | |

**User's choice:** Sell everything remaining
**Notes:** None

---

## Partial Sell Targets

| Option | Description | Selected |
|--------|-------------|----------|
| Single env var string | PARTIAL_SELL_TARGETS="2x:50,5x:25" | ✓ |
| Separate env vars per tier | SELL_TIER_1_MULT, SELL_TIER_1_PCT, etc. | |
| You decide | Claude picks | |

**User's choice:** Single env var string
**Notes:** User viewed preview of the format

| Option | Description | Selected |
|--------|-------------|----------|
| Original buy amount | Percentages based on tokens originally bought | ✓ |
| Current remaining balance | Percentages based on current holdings | |

**User's choice:** Original buy amount
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Execute all missed tiers at once | Combined sell if price gaps past multiple targets | ✓ |
| Execute tiers sequentially | Queue separate sells per tier | |
| You decide | Claude picks | |

**User's choice:** Execute all missed tiers at once
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, same logic | Both V2 and V3 use same partial sell logic | ✓ |
| You decide | Claude handles V2/V3 details | |

**User's choice:** Yes, same logic
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| DB-backed | Each partial sell as separate trade row | ✓ |
| In-memory tracking | Map-based, resets on restart | |
| You decide | Claude picks | |

**User's choice:** DB-backed
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Continue tracking | High-water mark doesn't reset after partial sell | ✓ |
| Reset to current price | Fresh baseline after each partial sell | |
| You decide | Claude picks | |

**User's choice:** Continue tracking
**Notes:** None

---

## Volatility-Adaptive Thresholds

| Option | Description | Selected |
|--------|-------------|----------|
| Rolling standard deviation | Track last N price samples, calculate std dev | |
| ATR-style (average true range) | High-low range per window | |
| Simple price range ratio | max/min over last N samples | |
| You decide | Claude picks the metric | ✓ |

**User's choice:** You decide (Claude's discretion)
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Multiplier on base thresholds | Vol 2x normal = widen stop from 15% to 30% | ✓ |
| Volatility bands (Bollinger-style) | N standard deviations from moving average | |
| You decide | Claude picks | |

**User's choice:** Multiplier on base thresholds
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, clamped range | Min/max bounds on threshold stretching | ✓ |
| No bounds | Fully adaptive, no limits | |
| You decide | Claude picks | |

**User's choice:** Yes, clamped range
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Gradual (every poll cycle) | Recalculate every 5s poll | ✓ |
| Stepped (every N minutes) | Recalculate periodically, more stable | |
| You decide | Claude picks | |

**User's choice:** Gradual (every poll cycle)
**Notes:** None

---

## Time-Weighted Exit Urgency

| Option | Description | Selected |
|--------|-------------|----------|
| Replace timed sell entirely | Urgency makes 5-min hard sell unnecessary | ✓ |
| Complement timed sell as backstop | Keep timed sell as last-resort kill switch | |
| You decide | Claude picks | |

**User's choice:** Replace timed sell entirely
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| 30 minutes to max urgency | Aggressive, meme token sniping is fast | ✓ |
| 1 hour to max urgency | More patient, some tokens need time | |
| Configurable via env var | Tunable, defaults to 30 min | |

**User's choice:** 30 minutes to max urgency
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Tighten trailing stop only | One dimension of pressure | ✓ |
| Tighten stop + lower take-profit | Dual pressure to exit | |
| You decide | Claude picks | |

**User's choice:** Tighten trailing stop only
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Market sell everything | At max urgency, sell immediately | ✓ |
| Trailing stop at minimum % | Still requires dip to trigger | |
| You decide | Claude picks | |

**User's choice:** Market sell everything
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Linear ramp | Even tightening over window | ✓ |
| Exponential (slow start, fast end) | Gentle early, aggressive late | |
| You decide | Claude picks | |

**User's choice:** Linear ramp
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| No, always ticking | Even profitable positions tie up capital | ✓ |
| Pause while above entry | Only pressure underwater positions | |
| You decide | Claude picks | |

**User's choice:** No, always ticking
**Notes:** None

---

## Exit Engine Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Unified exit engine | One module, one loop per position | ✓ |
| Extend existing functions | Add features to existing 6 functions | |
| You decide | Claude picks | |

**User's choice:** Unified exit engine
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Remove legacy functions | Clean up dead code paths | ✓ |
| Keep backward-compatible | Legacy functions call new engine | |
| You decide | Claude picks | |

**User's choice:** Remove legacy functions
**Notes:** None

---

## Position State Persistence

| Option | Description | Selected |
|--------|-------------|----------|
| DB-persisted | High-water mark stored in DB | ✓ |
| In-memory only | Reset to current price on restart | |
| You decide | Claude picks | |

**User's choice:** DB-persisted
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| New columns on trades table | Everything in one row | |
| Separate exit_state table | Clean separation, trades stays focused | ✓ |
| You decide | Claude picks | |

**User's choice:** Separate exit_state table
**Notes:** None

---

## Notification Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Notify on every sell event | Alert per partial sell, trailing stop, urgency sell | ✓ |
| Final sell only | One notification when fully closed | |
| Full lifecycle updates | Also notify on activation, urgency changes | |
| You decide | Claude picks | |

**User's choice:** Notify on every sell event
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, detailed reason | Include strategy context in notification | ✓ |
| Simple sold/amount only | Just token, amount, P&L | |

**User's choice:** Yes, detailed reason
**Notes:** None

---

## Claude's Discretion

- Volatility measurement metric (rolling std dev, range ratio, or other)
- Exact volatility multiplier formula and baseline calibration
- Min/max clamp values for volatility-adjusted thresholds
- Exit engine internal architecture (class vs functional)
- DB schema migration details and exit_state columns
- Partial sell token amount rounding (dust avoidance)
- Urgency tightening formula
- Volatility sample persistence strategy
- Timer registry updates for unified monitoring loop

## Deferred Ideas

- Per-chain trailing stop percentages
- Configurable urgency window via env var
- Emergency sell-all on shutdown
- Multi-pool routing at sell time for V3
