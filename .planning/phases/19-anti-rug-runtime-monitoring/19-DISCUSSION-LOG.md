# Phase 19: Anti-Rug Runtime Monitoring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-23
**Phase:** 19-anti-rug-runtime-monitoring
**Areas discussed:** V3 position coverage, Dry-run → live graduation, Operator visibility (Telegram + Dashboard), Allowlist lifecycle, Frontrun race telemetry, Threshold tuning loop, Position-subscription-termination, Resume-on-restart semantics

---

## V3 position coverage

### Q1 — What's the v6.17 anti-rug coverage for V3 positions?

| Option | Description | Selected |
|--------|-------------|----------|
| Reserves-based V3 detection | Reuse V2 pattern via HTTP polling; no NFT-event subscription. Simpler but less V3-aware. | |
| Defer V3 to v6.18 (explicit gap) | No V3 anti-rug; surface "V3 unmonitored" log + Telegram on every V3 buy. Saves complexity. | |
| Full V3-aware via NFT events | Subscribe to `NonfungiblePositionManager.DecreaseLiquidity` / pool events for V3 positions. | ✓ |

**User's choice:** Full V3-aware via NFT events. Operator prioritized comprehensive coverage over implementation simplicity.

### Q2 — What's the V3 threshold reference ('50% of what')?

| Option | Description | Selected |
|--------|-------------|----------|
| Pool active liquidity (`pool.liquidity()`) | Single value, matches V2 intuition. Multi-signal AND'd mitigates legitimate-large-swap noise. | ✓ |
| Largest-position liquidity | Most rug-specific; requires NFT enumeration; brittle on multi-position deployers. | |
| Total of all positions in pool | Catches multi-position mass withdrawal; expensive at buy time. | |

**User's choice:** Pool active liquidity.

### Q3 — Which V3 pool events trigger evaluation?

| Option | Description | Selected |
|--------|-------------|----------|
| Burn + Collect, gated by multi-signal | Earliest signal of intent; multi-signal naturally suppresses Burn-without-Collect FPs. | ✓ |
| Burn-only — fastest | Earliest but higher FP risk on rebalances. | |
| Collect-only — strongest | Cleanest signal but slower; lower frontrun-success. | |

**User's choice:** Burn + Collect, both gated by the multi-signal AND chain.

### Q4 — V3 equivalent of V2's "reserves below sell-threshold" multi-signal?

| Option | Description | Selected |
|--------|-------------|----------|
| Sell-simulation slippage (QuoterV2) | `quoteExactInputSingle(token, WETH, fee, ourPositionAmount)` — directly answers "can we sell?" | ✓ |
| Active liquidity floor (10% of baseline) | Lower bound combined with signal #1; cheaper but misses tick-range edge cases. | |
| Sqrt-price slippage from buy | Cheap on-chain; doesn't directly answer "can we sell." | |

**User's choice:** Sell-simulation slippage via QuoterV2.

### Q5 — V3 allowlist semantics (Burn has owner, Collect has recipient)?

| Option | Description | Selected |
|--------|-------------|----------|
| Owner-based allowlist | Check `owner` on Burn, `recipient` on Collect; separate V3 locker list per chain. NFT-holder identity = strongest signal. | ✓ |
| Recipient-only on Collect | Skip Burn allowlist check; loses early detection. | |
| Both owner and recipient | Most permissive; higher false-negative risk. | |

**User's choice:** Owner-based allowlist with separate V3 locker list per chain.

---

## Dry-run → live graduation

### Q1 — What criterion gates the dry-run → live flip?

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: 7 days AND review of observed events | Time floor + signal review. 0 events in 7 days still allows flip after baseline. | ✓ |
| Time-only: 7 calendar days | Simplest; matches REQUIREMENTS.md wording verbatim. | |
| Signal-only: N observed events + 0 FPs | Strongest signal but can lock dry-run forever in quiet markets. | |
| Tiered: dry-run → shadow mode → live | Three states with shadow tier; extra implementation. | |

**User's choice:** Hybrid (7 days AND review with 0 confirmed FPs).

### Q2 — Per-chain or global flip?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-chain env vars | `<CHAIN>_ANTIRUG_LIVE_EXECUTE` per chain; each graduates independently. | ✓ |
| Global single flag | Single `ANTIRUG_LIVE_EXECUTE`; all chains flip simultaneously. | |
| Global with per-chain override | Most flexible but env-var complexity grows. | |

**User's choice:** Per-chain env vars.
**Notes:** Operator added two binding requirements: (a) `.env.example` MUST be updated with all new vars; (b) explicit operator-handoff document at phase close listing what to change.

### Q3 — Dry-run telemetry channels?

| Option | Description | Selected |
|--------|-------------|----------|
| All three: pino + Telegram + dashboard | pino audit trail + `[DRY-RUN]` Telegram + dashboard tile. Full visibility. | ✓ |
| pino + dashboard, no Telegram | Quieter; operator must check actively. | |
| pino only | Minimal; operator runs grep. | |
| pino + Telegram, no dashboard | Real-time but no visual surface. | |

**User's choice:** All three channels.

### Q4 — Rollback if live mode immediately misfires?

| Option | Description | Selected |
|--------|-------------|----------|
| Env-flag flip + bot restart | Operator edits `.env`, restarts; paired with ANTIRUG-09 circuit breaker for auto-halt. | ✓ |
| Hot env-flip via dashboard control | Fastest; adds new dashboard control + auth surface. | |
| Circuit breaker only (no manual flag) | Pushes all rollback through one mechanism; minimal new surface. | |

**User's choice:** Env-flag flip + bot restart, with circuit breaker for automatic halt.

---

## Operator visibility (Telegram + Dashboard)

### Q1 — Live anti-rug exit Telegram alert content?

| Option | Description | Selected |
|--------|-------------|----------|
| Full evidence + tx artifacts | Comprehensive: signals fired, tx hash, sell amount, ETH received, ROI, gas multiplier. | ✓ |
| Tiered match-D-ALERTS | Match Phase 18: verdict + reason + Etherscan link. Evidence in pino. | |
| Two-message split | Trigger + confirmation as separate messages. | |

**User's choice:** Full evidence + tx artifacts (anti-rug exits are rare + high-stakes).

### Q2 — Circuit-breaker-tripped state visibility?

| Option | Description | Selected |
|--------|-------------|----------|
| Prominent banner + alert + manual-reset button | Red banner + Telegram + modal review of 3 trigger events before reset. | ✓ |
| Dashboard status field + Telegram alert | Status in chain controls; not blocking. | |
| Telegram + pino only | No new dashboard surface. | |

**User's choice:** Prominent banner + Telegram + manual-reset with review modal.

### Q3 — WebSocket health surfacing?

| Option | Description | Selected |
|--------|-------------|----------|
| Tiered alerts + dashboard status | Visual indicator green/yellow/red; Telegram only on real outages; pino on transitions. | ✓ |
| Telegram on every disconnect | Loud, no missed signals; high alert volume on flaky networks. | |
| Dashboard + pino only, no Telegram | Operator must check actively. | |

**User's choice:** Tiered alerts + dashboard status indicator.

### Q4 — Per-position anti-rug state in positions table?

| Option | Description | Selected |
|--------|-------------|----------|
| New 'Anti-Rug' column with state badges | 🟢 Live, 🟡 Dry-run, 🟠 Would-have-sold, 🔴 Exit fired, ⚫ Halted, ⚪ Unmonitored. Click → detail modal. | ✓ |
| Status text in existing column | Append text; minimal change. | |
| Separate Anti-Rug Monitor tile only | Dedicated tile; positions table unchanged. | |

**User's choice:** New "Anti-Rug" column with state badges + click-through detail modal.

---

## Allowlist lifecycle

### Q1 — Where does the LP-locker allowlist source live?

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcoded base + env overlay | Base in `src/anti-rug/allowlist.ts`; operator extends via per-chain env. Restart-only. | ✓ |
| Hardcoded only (no operator additions) | Strict ANTIRUG-06; operator must PR for changes. | |
| Hardcoded + dashboard hot-add | Most flexible; bypasses git audit trail. | |
| Config file in working dir | JSON file in repo + restart. Combines audit + operator-edit. | |

**User's choice:** Hardcoded base + env overlay.

### Q2 — Verification when operator adds env-overlay addresses?

| Option | Description | Selected |
|--------|-------------|----------|
| Loud startup print + contract-code check | `getCode()` fails closed on EOA; pino dumps merged allowlist with provenance. | ✓ |
| Startup print only (no code check) | Visual verification; trusts operator vigilance. | |
| Etherscan name-tag lookup | Verifies by tag name; Etherscan API dependency. | |
| No verification (operator's responsibility) | Lightest; trusts operator due diligence. | |

**User's choice:** Loud startup print + `getCode()` contract-code check (fails closed on EOA).

### Q3 — Allowlist effectiveness audit (suppressed events)?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-hit pino + dashboard counter | Structured pino + tile counter + click-through list. | ✓ |
| Dashboard counter only | Less detail. | |
| Per-hit pino only | Grep-based review. | |

**User's choice:** Per-hit pino log + dashboard counter.

### Q4 — Test fixture pattern for allowlist + anti-rug logic?

| Option | Description | Selected |
|--------|-------------|----------|
| Inherit Phase 18 D-FIXTURE: contrived + real captured | RugPull.sol + real pinned mainnet rugs; both V2 + V3. | ✓ |
| Contrived only | Faster build; misses real-world subtleties. | |
| Real captured only | Realistic; limited control over edge cases. | |

**User's choice:** Inherit Phase 18 D-FIXTURE pattern (contrived + real captured, both V2 and V3).

---

## Frontrun race telemetry

### Q1 — Frontrun outcome data for dry-run would-have-sold events?

| Option | Description | Selected |
|--------|-------------|----------|
| Timing + post-hoc reality check | Detection latency + N+2-block reality check; would-have-saved-X-ETH outcome tag. | |
| Timing only | Detection latency only; no economic outcome. | |
| Synthetic simulate-bundle (Flashbots-only) | Real MEV-game answer for ETH; mixed coverage for other chains. | |
| Both: timing + simulate + post-hoc | All three when available per chain. Most rigorous. | ✓ |

**User's choice:** All three measurements (timing + Flashbots simulate + post-hoc reality).
**Notes:** BSC/Base/Arb skip Flashbots; timing + post-hoc only on those chains.

---

## Threshold tuning loop

### Q1 — How are anti-rug thresholds tuned from dry-run data?

| Option | Description | Selected |
|--------|-------------|----------|
| Manual review + documented protocol | Per-chain env edits per `docs/operations/anti-rug-tuning.md`; restart. Audit via .env + git. | ✓ |
| Bot-suggested adjustments | Analysis-driven recommendations; risk of bad suggestions from thin data. | |
| Locked until v6.18 retrospective | No in-milestone tuning. | |
| Per-chain manual with no documentation | Lightest implementation, worst audit trail. | |

**User's choice:** Manual review + documented protocol.

---

## Position-subscription-termination

### Q1 — When does anti-rug subscription stop for a position?

| Option | Description | Selected |
|--------|-------------|----------|
| Full sell only — partials keep monitoring | Subscription persists across partial sells; cleanup at `amount_remaining=0`. | ✓ |
| Full sell OR time-based fallback (24h) | Reduces subscription churn; risks unmonitored aged positions. | |
| Full sell, partial sell, OR manual close | Partial sells terminate; leaves remaining position unprotected. | |

**User's choice:** Full sell only; partials keep monitoring.

---

## Resume-on-restart semantics

### Q1 — Events missed during bot downtime?

| Option | Description | Selected |
|--------|-------------|----------|
| Bounded backfill + gap warning | `getLogs(lastSeen+1, current)` capped at 2000 blocks; fail closed on gap; Telegram alert. | ✓ |
| Best-effort backfill, no gap warning | Silent resume; long gaps unreported. | |
| No backfill — only forward subscription on restart | Lightest; misses downtime-window rugs. | |
| Backfill + auto-exit on backfilled triggers | Risks panic-sell on stale events. | |

**User's choice:** Bounded backfill + gap warning (fail closed on >2000-block gap).

---

## Claude's Discretion

The following areas were explicitly left to planner / researcher discretion (documented in CONTEXT.md `<decisions>` → `### Claude's Discretion`):

- Exact heartbeat ping interval and timeout values (within ANTIRUG-12 "default 30s" guidance).
- `lp_baseline` schema discriminator approach (V2 + V3 column shape).
- `src/anti-rug/` module file split (`detector.ts` / `exitTrigger.ts` / `lpBaseline.ts` per ARCHITECTURE.md or alternative shapes).
- `executeFullSell` reason-union extension shape (literal string vs branded type).
- Dashboard component file structure for new column / tile / banner / modal / panel.
- Backfill window cap (2000-block default) tunable per RPC tier; researcher verifies during plan-phase.
- V3 NFT Manager + Pool ABI imports (researcher identifies during research-phase).
- Real-mainnet rug fixture token selection (researcher identifies; planner finalizes).
- Telegram alert phrasing within D-VIS-LIVE-EXIT shape.

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` for future-phase consideration:

- Time-since-launch gate ("<24h since buy" optional gate from ARCHITECTURE.md).
- Mempool-aware anti-rug detection (ANTIRUG-V2-01).
- Aggregated rug-signal scoring (ANTIRUG-V2-02).
- Tax-change detection on open positions (ANTIRUG-V2-03).
- Owner-blacklist-self detection (ANTIRUG-V2-04).
- Allowlist hot-add via dashboard.
- Bot-suggested threshold adjustments.
- Allowlist Etherscan name-tag verification.
- Anti-rug auto-exit on backfilled triggers (rejected as risky).
- Per-position WS subscriptions (rejected per Pitfall #10).
- Synthetic canary-trade monitor (OPS-V2-01).
