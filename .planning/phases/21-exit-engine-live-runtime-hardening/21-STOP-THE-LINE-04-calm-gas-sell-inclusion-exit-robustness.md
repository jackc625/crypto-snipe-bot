# STOP-THE-LINE 04 — Calm-gas Flashbots sell non-inclusion + exit-engine robustness

**Status:** OPEN 2026-05-27 — surfaced during the Phase 21 / Plan 21-07 real-capital
live-capture **retry** (the post-21.1 retry). Escalated to phase **21.2** per D-STOP-THE-LINE.
**Severity:** HIGH — blocks the 21-07 capture (EXIT-LIVE-03/04) and includes a
capital-safety concern (a still-held position left unmonitored) on the funded mainnet bot.
**Surfaced by:** Plan 21-07 retry live-capture (2026-05-27), the controlled LADYS roundtrip
on the prod wallet `0x46c6D387EAb1669307c33E6f60173ADEe9Da3A5C`.
**Governing decision:** D-STOP-THE-LINE — any bug surfaced during a capture BLOCKS phase
close and escalates to a new decimal phase; not fix-in-flight, not file-and-defer.

## Context — what the retry VALIDATED (the win, do not lose this)

The retry CONFIRMED the 21.1 STOP-THE-LINE-02 fix on the **real Flashbots relay**:
the LADYS buy landed (bundleHash `0xcb87ddf3…89a2` → minedTxHash `0xf02566a4…af0d`,
block 25187617), was reconciled to its real hash, the position was registered (tradeId 1,
entry 3929) and the exit monitor started, and EXIT-LIVE-01 poll telemetry streamed cleanly
for ~30 min. **The original untracked-position harm did NOT recur.** STOP-THE-LINE-02's
false-negative fix is validated live.

## What is broken (this escalation)

### Finding A — Flashbots sell cannot land at calm gas on a thin wallet (capture blocker + policy gap)
At ~0.35 gwei base fee with a ~0.0079 ETH wallet, the affordability clamp caps the sell's
priority-fee bid at ~12.5 gwei (configured ceiling 13). The Flashbots bundle was not included
across 4 attempts → `mev.escalation.ceiling-hit` → `exit.full.failed`. The buy had landed only
by first-attempt luck. This is the deferred "genuinely-not-included at calm gas" policy gap
(STOP-THE-LINE-02 §3): a tiny private bundle with no MEV value + a low affordable tip gives
builders little reason to include it. **Net: the bot cannot complete a Flashbots exit at calm
gas on a thin wallet → EXIT-LIVE-03/04 cannot be captured this way.**

### Finding B — Reproducible event-loop freeze on MEV ceiling-hit
On BOTH the original buy ceiling-hit (attempt 1, 15:17:25) and the sell ceiling-hit (16:12:50),
the process wedged: no further logs, exit-poll loop stopped, `Ctrl+C` (SIGINT) unresponsive,
required `taskkill /F /T`. A funded bot that freezes when a Flashbots submit gives up —
potentially while holding an open position — is operationally serious (it stops monitoring/
exiting ALL positions and resists graceful shutdown).
Throw path: `submitWithReconciliation` (reconciliation.ts:498) → `executeFullSell`
(exitEngine.ts:501) → `pollExitStrategy` (exitEngine.ts:833) → `Timeout` (exitEngine.ts:925).

### Finding C — Sell reconciliation blocks the entire exit-poll loop (~222s)
The sell's 4-attempt reconciliation runs synchronously inside `pollExitStrategy`, so a single
exit's retry loop blocked the poll cycle for **222,605 ms** (`exit.poll.cycle` overruns:true).
During that ~3.7-min window NO position is polled — with multiple open positions, none would be
monitored or exited. Likely the same root cause as Finding B (event loop parked in the await chain).

### Finding D — Anti-rug unregisters a STILL-HELD position after a failed exit (capital-safety; verify)
`exit.full.failed` (16:12:50) was immediately followed by `antirug.unregister` for tradeId 1,
but the LADYS position was still **fully held** (252,930,777 LADYS confirmed on-chain after the
failure). A failed exit that drops anti-rug monitoring leaves a real, still-held position
unprotected against a rug. NEEDS code confirmation of intent, but appears capital-unsafe.

## Ground-truth evidence
- Buy: balance 0.009103499 → 0.007936720 ETH; LADYS +252,930,777; bundleHash
  `0xcb87ddf321c63e3656c6d78b80124bb30f7710526235f849af9785f0644b89a2` → minedTxHash
  `0xf02566a4bb324732733b41012596526892ebeed577273e1bde3be64ecec7af0d` (block 25187617).
- Sell fail: `exit.trigger.urgency` 16:09:07 → `exit.full.submitted` → `mev.reconcile.not-landed` ×4
  → `mev.escalation.ceiling-hit` (ceilingWei 13000000000) 16:12:50 → `exit.full.failed` →
  `antirug.unregister`; position still held (252,930,777 LADYS).
- Telemetry (EXIT-LIVE-01 — captured): ~30 min of `exit.poll.cycle`, positions:1, durationMs ~50–80,
  budgetMs 5000, overruns:false (then one overruns:true 222605 ms cycle during the sell).
- Logs: `data/capture-21-07.log` (attempt 1: buy ceiling-hit + freeze),
  `data/capture-21-07b.log` (buy landed + sell ceiling-hit + freeze).

## What 21.2 must do
1. **Finding A (policy):** define how an exit lands at calm gas — e.g., raise the sell-leg
   priority-fee ceiling independently of the buy, add a coinbase bribe, and/or fall back to a
   direct public-mempool sell after N Flashbots non-inclusions (promote the `recover-sell-ladys.ts`
   path into the engine). Decide a minimum-wallet-balance precondition for the Flashbots roundtrip.
2. **Finding B:** a MEV ceiling-hit failure must never wedge the event loop; the process must stay
   responsive and SIGINT-killable.
3. **Finding C:** move the sell reconciliation off the poll-cycle critical path (don't block
   all-position polling for one exit's retries).
4. **Finding D:** verify + fix the anti-rug unregister-on-failed-exit; a still-held position must
   remain monitored.

## Affected files (starting points)
- `src/utils/mevStrategies/reconciliation.ts` (escalation/ceiling + the throw at ~498; sell-leg affordability)
- `src/exitEngine.ts` (`executeFullSell` ~501; `pollExitStrategy` ~833; the poll `setInterval` ~925 — blocking + failure handling)
- `src/anti-rug/detector.ts` (`antirug.unregister` on failed exit)
- `scripts/recover-sell-ladys.ts` (the public-mempool fallback to consider promoting into the engine)

## Immediate operational state
- The LADYS position (~252.9M, ~$3–4) is held and tracked (DB buy row) but UNMONITORED (Finding D).
  Recover via `scripts/recover-sell-ladys.ts` (direct public-mempool sell) — operator-gated.
  No funds lost; buy cost ~0.00117 ETH (0.001 snipe + ~0.00017 gas).
