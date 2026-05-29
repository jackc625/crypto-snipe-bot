---
finding: STOP-THE-LINE-05
title: Buy leg cannot land via Flashbots at calm gas — no public-mempool fallback
status: open
severity: blocker
surfaced: 2026-05-29
surfaced_by: Phase 21 / Plan 21-07 real-capital retry (2nd live attempt)
blocks: [21-07, 21-08, "Phase 21 close"]
escalates_to: "decimal phase 21.3"
capital_impact: none (nothing spent — confirmed)
related: [STOP-THE-LINE-04, STOP-THE-LINE-02]
---

# STOP-THE-LINE-05 — Buy leg can't land via Flashbots at calm gas (no public-mempool fallback)

## Summary

During the Phase 21 / Plan 21-07 real-capital retry (2026-05-29), the controlled LADYS
buy **failed to land**: the Flashbots bundle was not included after 4 attempts, escalating
to the 13-gwei priority-fee ceiling, on a network whose base fee was **0.25 gwei** — a gas
environment where a 13-gwei-priority bundle should be trivially includable. A read-only
`staticCall` of the exact buy swap proves the **transaction itself is valid** (it would
return ~242.38M LADYS for 0.001 ETH, even at the bot's 5% slippage). Therefore the failure
is **purely Flashbots non-inclusion**, not a reverting swap.

This is the **same calm-gas Flashbots inclusion problem as STOP-THE-LINE-04** — but on the
**BUY leg**, which Phase 21.2 left untouched. 21.2 gave the **sell/exit** leg an independent
priority-fee ceiling **plus a guaranteed nonce-locked public-mempool fallback**
(`swapExactTokensForETHSupportingFeeOnTransferTokens`). The **buy** leg is still
Flashbots-only with no fallback, relying on the "first-attempt luck" that worked in the
prior attempt and failed in this one. It blocks the 21-07 capture and therefore Phase 21
close (D-STOP-THE-LINE).

## Evidence

Live bot log (2026-05-29 ~13:56–13:59 UTC), LADYS `0x12970E…646bf`:

```
13:56:04  "All safety checks passed, buying"   (honeypot gate PASSED)
13:56:04  "Dispatching TX via MEV strategy"  strategy=flashbots gasMultiplier=1
13:56:59  mev.reconcile.not-landed attempt 0  "Bundle genuinely not landed — escalating priority fee"
13:57:49  mev.reconcile.not-landed attempt 1
13:58:49  mev.reconcile.not-landed attempt 2
13:59:47  mev.escalation.ceiling-hit attempt 3  ceilingWei=13000000000
          "MEV bundle not included after 4 attempt(s); priority-fee ceiling (13 gwei) reached"
          → TX failed  (submitWithReconciliation reconciliation.ts:596)
```

"Bundle **genuinely** not landed" = the 21.1 nonce+receipt reconciliation confirmed real
non-inclusion (NOT a STOP-THE-LINE-02 false-negative).

Read-only verification at the time of failure:

- **Capital safe:** wallet ETH balance `0.008877306853435613` — **byte-identical** before/after
  the attempt → zero spent. `LADYS balanceOf = 0`. No `trades` row created (dedup still clear).
  No double-spend, no untracked position. The 21.1 nonce-safe retry behaved correctly.
- **Network was calm:** base fee `0.254 gwei`, priority market `~0.00005 gwei`.
- **Swap is valid (the discriminator):**
  - `getAmountsOut(0.001 ETH, [WETH, LADYS])` → `242,380,045 LADYS` (pool liquid).
  - `swapExactETHForTokens.staticCall(minOut=0, …, from=wallet, value=0.001 ETH)` → OK, `242.38M` out.
  - `swapExactETHForTokens.staticCall(minOut=expected*0.95, …)` → OK (valid at the bot's 5% slippage).
- **MEV health was fine:** `npm run preflight` mev-health PASS; Flashbots relay reachable, auth
  key valid (auth address `0x6b71…125C`).

The buy is built at `src/bot.ts:526-538` as
`swapExactETHForTokens(minOut, [WETH,LADYS], wallet, deadline)` `value=0.001 ETH`, submitted
through `submitBuyTx → withNonceLock → submitWithReconciliation` (Flashbots strategy on ETH,
per the hardcoded `chainRegistry.ts` ETH template `mevStrategy:'flashbots'`).

## Root cause

The buy transaction is valid and would land instantly in the public mempool, but the
**Flashbots private bundle is not being included** at calm gas even at the 13-gwei buy
ceiling. The exact inclusion-failure mechanism is **not yet pinned down** (a 21.3 research
task) — candidate causes:

1. Calm-gas Flashbots builder dynamics (low builder win-rate / the bundle targets too few
   blocks per attempt) — the STOP-THE-LINE-04 premise applied to the buy.
2. A buy-bundle construction/targeting detail in `submitWithReconciliation` (block targeting,
   gas, or the per-attempt resubmission window).
3. Something specific to this wallet/relay reputation.

What is **certain**: the buy leg has **no guaranteed-inclusion fallback**, so when Flashbots
won't include, the buy simply fails — whereas 21.2 made the sell leg resilient to exactly
this. The "buy landed only by first-attempt luck" caveat recorded after the prior attempt
was a known risk that 21.2 scoped out; this attempt falsifies the implicit premise that the
buy leg was good enough.

## Proposed direction (to be decided in 21.3 per D-QUALITY-FIRST)

Leading candidate: extend the 21.2 Finding-A pattern to the buy leg — give it the same
`submitWithReconciliation` resilience (independent ceiling + a guaranteed public-mempool
fallback) so a valid buy always lands.

**Design tension to resolve in 21.3 (do NOT decide in-flight):** a real snipe buy uses
Flashbots specifically for **front-run/sandwich protection** on a fresh launch. A blanket
"fall back to public mempool" weakens that protection. Options to weigh:

- **Reason/context-aware fallback** (mirror the sell's reason-aware trigger): fall back to
  public only when the buy is non-time-critical (e.g., a deliberate capture of an
  established token), or after N private attempts where "a front-runnable buy" beats "no buy".
- **A capture/operator path** that routes a *deliberate* buy publicly (the 21-07 capture buy
  of established LADYS needs no MEV protection), without changing snipe behavior.
- **Smarter private inclusion first** (multi-block bundle targeting / higher ceiling within
  affordability) before any public fallback.

The 21-07 capture only needs the buy as a *means to obtain a position* (the buy records a
`mev_bundle` placeholder, not an artifact); all capture evidence is the SELL leg. So the
narrow unblock for 21-07 is "make a deliberate established-token buy land reliably."

## Open questions for 21.3 research

1. Why exactly is the Flashbots buy bundle not included at calm gas? (Inspect
   `flashbots_getBundleStatsV2`, the bundle's target block(s), and the per-attempt resubmission.)
2. Does the sell leg actually land live now (21.2 Finding A) — still unproven, because the
   buy failed before any position/exit existed?
3. Reason-aware-public-fallback vs capture-mode-public-buy vs better-private-targeting — which
   best satisfies D-QUALITY-FIRST without weakening genuine snipe front-run protection?

## D-STOP-THE-LINE disposition

Escalated to decimal phase **21.3**. NOT patched in-flight. Phase 21 (21-07/21-08) remains
blocked. Capital safe; no remediation of funds required. Next: `/gsd-discuss-phase 21.3`
(or `/gsd-plan-phase 21.3`).
