---
status: resolved
trigger: "Phase 21 / 21-07 LIVE capture: exit engine poll loop runs every 5s on a held LADYS position but never triggers a sell; dashboard shows Current=0.0000, P&L=-0.0010, Exit Mode 'Urgency'."
created: 2026-05-29
updated: 2026-05-29
goal: find_root_cause_only
related_phase: 21 (plan 21-07 live real-capital capture)
fix_target: decimal phase 21.4 (NOT applied during this session — D-STOP-THE-LINE)
constraints: read-only | live-prod-bot-running | no-fix | no-transact | no-bot-restart | no-prod-db-write
---

# Debug: exit engine never triggers sell (current price reads 0) on live held position

## Hard constraints (LIVE prod bot, real capital held)

DIAGNOSE ONLY. The production bot is RUNNING right now with a real held LADYS position
(~0.001 ETH). Read-only investigation ONLY:
- Do NOT restart or stop the bot.
- Do NOT transact / sign / broadcast anything.
- Do NOT apply code fixes (any fix is deferred to decimal phase 21.4).
- Do NOT write to `./data/bot.db` (the running bot has it open — read-only connections only).
- OK: read source, read `capture-21-07-retry.log` (repo root), read-only on-chain/DB queries.
NOTE: the held position may auto-sell at the ~30-min urgency deadline — time-sensitive repro.

## Symptoms

- expected: with `STOP_LOSS_PCT=0.3` (0.3%), the exit engine's own 5s poll loop fires
  `executeFullSell` promptly (the captureRehearsal fork proved this sequence).
- actual: `op:exit.poll.cycle` logs every 5s (positions:1, durationMs ~50, overruns:false)
  for 4+ minutes with NO exit decision. No `exit.full.executed`, no stop-loss trigger.
- dashboard: position tradeId 2, Entry 4053, **Current 0.0000**, **P&L -0.0010** (≈full entry
  cost), Exit Mode "Urgency" (~1% elapsed), HWM 4053, Volatility 4053.
- timeline: first live attempt of the post-21.3 buy fix; buy LANDED this time (the 21.3
  multi-builder fanout resolved STOP-THE-LINE-05), then the exit failed to fire.
- repro: live bot running; LADYS held; `capture-21-07-retry.log`.

## Confirmed evidence (read-only)

- Buy tx `0x183909039899bbc782d73df0d0805dbc17398f0e6654a3b6adc0cc676b04895c` status=1 (success).
- Wallet `0x46c6D387EAb1669307c33E6f60173ADEe9Da3A5C` holds 245,215,490 LADYS
  (`0x12970E6868f88f6557B76120662c1B3E50A646bf`, 18 dec).
- Position IS sellable now: Uniswap V2 router `getAmountsOut(fullBalance,[LADYS,WETH])` = 0.000994 ETH.
  (≈0.6% below the 0.001 entry = round-trip fee/slippage, NOT a market price drop.)
- `queryPrice` (`src/exitEngine.ts:315-345`) does NOT error: `LOG_LEVEL=debug` is set, yet ZERO
  `Price query failed` debug lines in the log → it is returning a value, not throwing→null.
- `exit.monitor.started` logged entryPrice "4053", pollMs 5000, trailingStopPct 15, tiers none.
- `antirug.register` tradeId 2 DID fire (so dashboard "Unmonitored" is likely the live-execute-off
  label, not a registration miss). `getBundleStatsV2` threw 403 "rpc method not whitelisted" —
  telemetry-only, non-blocking (bundle still included).

## Lead

`queryPrice` V2 returns `Number(getAmountsOut(buyAmountWei,[token,weth])[1])`. entryPrice 4053
implies `buyAmountWei ≈ 1e15` (the 0.001-ETH snipe amount used as a fixed pseudo-token-amount
reference). The NEXT step is to find + read the CALLER of `queryPrice` — the poll →
stop-loss → urgency decision path — and the dashboard position-update's current-price/P&L
computation, to explain why "current" reads 0 and why no exit fires.

## Hypotheses to disambiguate

- (a) BENIGN: LADYS is stable, the 0.3% price-stop never crosses (captureRehearsal fork only
  fired because it INDUCED a downward price move; live there is none). Engine is correctly
  holding under time-weighted urgency and will market-sell at the ~30-min urgency deadline.
  "Current 0.0000" is a dashboard DISPLAY bug, not the engine.
- (b) REAL BUG: the engine's own current-price/valuation computes 0 and a guard skips the sell
  (an exit engine that can't price a position and won't exit it = the capital-safety bug class
  Phase 21 exists to kill).

## Current Focus

hypothesis: RESOLVED → (a) BENIGN engine hold is correct + a separate cosmetic dashboard display
  artifact. (b) REAL exit-skip bug is RULED OUT — the engine ratio math is self-consistent and the
  no-fire is the correct behavior under the live conditions.
test: read the queryPrice caller (poll evaluation) and the dashboard P&L computation; trace
  buyAmountWei semantics through both. DONE.
expecting: identify whether current-price computes 0 (guard skips) vs ≈entry (correct hold). DONE.
next_action: none — root-cause report complete; fix deferred to 21.4.

## Evidence

- timestamp: 2026-05-29 | queryPrice arg semantics (THE root cause).
  `src/exitEngine.ts:315-345` V2 branch does `getAmountsOut(buyAmountWei, [token, weth])` —
  i.e. it treats `buyAmountWei` as a TOKEN input amount. But every caller passes the ETH buy
  cost reinterpreted as wei:
  - poll caller `pollExitStrategy` (`exitEngine.ts:1663-1672`) forwards `buyAmountWei`.
  - `startExitMonitor` (`exitEngine.ts:1830`): `buyAmountWei = ethers.parseEther(buyAmountNative)`
    = parseEther("0.001") = 1e15 wei.
  So queryPrice asks getAmountsOut(1e15 base-units of LADYS, [LADYS, WETH]) = "WETH out for
  0.001 LADYS" (LADYS is 18-dec). LADYS is a sub-cent memecoin → 0.001 LADYS ≈ 4053 wei of WETH
  = 4.053e-15 ETH. This is EXACTLY the logged `entryPrice "4053"` (capture line 43,
  `op:exit.monitor.started`). The "price" is a fixed PSEUDO-reference, not a position valuation.

- timestamp: 2026-05-29 | The ratio is self-consistent → engine trigger math is CORRECT.
  `priceMultiple = currentPrice / state.entryPrice` (`exitEngine.ts:1678`). Both numerator and
  denominator come from the SAME `getAmountsOut(1e15, ...)` call, so the pseudo-amount cancels and
  the ratio is a faithful price ratio. With LADYS flat post-buy, currentPrice ≈ entryPrice ≈ 4053
  → priceMultiple ≈ 1.0. stop-loss check (`exitEngine.ts:1746`): fixedStopPrice =
  4053*(1-0.3/100) ≈ 4040; currentPrice 4053 > 4040 → stop-loss correctly does NOT fire. No
  market drop happened (on-chain getAmountsOut on the FULL balance = 0.000994 ETH ≈ 0.6% below the
  0.001 entry = round-trip fee/slippage, not a price decline), so there is genuinely nothing for a
  0.3% price-stop to trigger on.

- timestamp: 2026-05-29 | Urgency correctly NOT firing yet.
  `computeUrgencyMultiplier` (`exitEngine.ts:209-214`) is linear 1.0→0.0 over the 30-min window;
  hard exit only at urgencyMult <= 0.0 (`exitEngine.ts:1765`). Dashboard showed ~1% elapsed →
  urgencyMult ≈ 0.99 ≫ 0 → urgency hold is correct. The held position is expected to
  market-sell at the ~30-min urgency deadline (matches the symptom note). This is the engine
  behaving as designed, not a skipped sell.

- timestamp: 2026-05-29 | The actual SELL path is unaffected (sells full balance).
  `executePublicFallbackSell` (`exitEngine.ts:508-520`) quotes + sells the RE-FETCHED on-chain
  `heldBalance` (the full 245.2M LADYS), NOT the 1e15 pseudo-amount. So even though the pricing
  reference is a tiny fixed amount, when a trigger DOES fire the bot sells the entire position
  correctly. The buyAmountWei defect is confined to the trigger-comparison reference, and because
  it cancels in the ratio it does not corrupt trailing/stop/urgency decisions.

- timestamp: 2026-05-29 | Dashboard "Current 0.0000 / P&L -0.0010" is a UNIT-DISPLAY artifact.
  `src/api/helpers/positions.ts:113` recomputes the SAME reference
  (`ethers.parseEther(trade.buy_cost)` → 1e15) and `:114` calls queryPrice → currentPrice ≈ 4053
  (raw wei Number). Then:
  - `:141` `currentPrice / 1e18` = 4053/1e18 = 4.05e-15 → renders as **0.0000**.
  - `:129-130` unrealizedPnl = (4053/1e18) + sell_revenue(0) - buy_cost(0.001) - sell_gas
    ≈ **-0.0010** (≈ full entry cost).
  Both dashboard symptoms reproduce EXACTLY. The dashboard treats the per-0.001-LADYS micro quote
  as the position's current ETH value, then divides by 1e18 — pure display/units defect, no
  bearing on engine safety.

- timestamp: 2026-05-29 | Hypothesis (b) RULED OUT. There is no guard that "skips the sell on a
  0 price." The only null-guard (`exitEngine.ts:1673-1676`) returns 'continue' when queryPrice
  returns null — but queryPrice returned a value (4053), not null (consistent with the eliminated
  "zero Price query failed lines" finding). The engine priced the position fine in RATIO terms and
  correctly chose to hold. The capital-safety failure mode Phase 21 targets (can't price → won't
  exit) is NOT present here.

## Eliminated

- queryPrice throwing → null (eliminated: LOG_LEVEL=debug, zero "Price query failed" lines).
- Missing tokens / reverted buy (eliminated: status 1, 245.2M LADYS held, sellable).
- Anti-rug registration miss (eliminated: antirug.register tradeId 2 fired).
- (b) REAL exit-skip bug (eliminated: no 0-price guard skips the sell; queryPrice returned 4053
  not null; ratio math is self-consistent and correctly held a flat position; sell path uses the
  full re-fetched heldBalance).

## Resolution

ROOT CAUSE (confirmed): Hypothesis (a) — the exit engine behaved CORRECTLY (benign hold of a flat
position under a not-yet-elapsed urgency window); no sell was skipped. The two alarming dashboard
readings are a single cosmetic units defect, NOT an engine fault.

The defect is a unit/semantics mismatch in the `buyAmountWei` argument fed to `queryPrice`
(`src/exitEngine.ts:315-345`). `queryPrice` interprets that argument as a TOKEN input amount for
`getAmountsOut([token, weth])`, but all callers pass the ETH buy cost reinterpreted as wei
(`ethers.parseEther("0.001")` = 1e15, at `exitEngine.ts:1830` and `api/helpers/positions.ts:113`).
The result is a "WETH out for 0.001 LADYS" micro-quote (~4053 wei), used as a fixed pseudo-price
reference. Because the same fixed amount is used at entry AND on every poll, the value cancels in
`priceMultiple = currentPrice / entryPrice` (`exitEngine.ts:1678`), so the trigger logic
(trailing/stop-loss/urgency) is mathematically sound and the engine correctly held a flat token.

The dashboard, however, takes that raw ~4053-wei micro-quote as the position's current value and
divides by 1e18 (`api/helpers/positions.ts:141`), yielding 4e-15 → "Current 0.0000", and computes
P&L as ≈ (0 + 0 - 0.001 - gas) = "-0.0010" (`:129-130`) — i.e. it shows the position as worth
nothing and down its full entry cost, when on-chain it is plainly worth ~0.000994 ETH.

PROPOSED FIX (phase 21.4 — NOT applied):
1. Make valuation use the REAL held balance, not a pseudo-amount. For display (and ideally for a
   true position-value signal), price the position with `getAmountsOut(heldBalance, [token, weth])`
   (the same call `executePublicFallbackSell` already uses at `exitEngine.ts:520`) so "Current" =
   actual ETH the full bag would fetch (~0.000994), and P&L = currentValue - buyCost - gas.
   - Lowest-risk scoping: fix `api/helpers/positions.ts` only (display layer) to compute
     currentPrice from heldBalance/1e18, decoupling the cosmetic dashboard bug from the engine.
2. Engine trigger math is correct via the cancelling ratio, so the trailing/stop/urgency decisions
   need NO change for correctness. OPTIONAL hardening: rename the `queryPrice` parameter from
   `buyAmountWei` to `referenceAmountIn` (or pass a documented per-token reference) to remove the
   ETH-as-token-amount foot-gun and prevent a future caller from assuming it returns an ETH value.
3. Add a regression test asserting (a) display currentPrice for a flat position ≈ on-chain
   getAmountsOut(heldBalance) (within fees), and (b) priceMultiple ≈ 1.0 for a flat position
   regardless of the reference amount.

CAPITAL-SAFETY ASSESSMENT: No capital is at risk from this defect. The engine prices and holds
correctly; the urgency deadline (~30 min) will market-sell the full balance via the heldBalance
path if no earlier trigger fires. The bug is cosmetic (misleading dashboard) plus a latent
maintainability foot-gun. Recommend fixing in 21.4 for operator-trust and to harden the API
contract; not a STOP-THE-LINE blocker.

specialist_hint: typescript
