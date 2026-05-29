---
plan: 21-07
phase: 21-exit-engine-live-runtime-hardening
status: complete
completed: 2026-05-29
requirements: [EXIT-LIVE-01, EXIT-LIVE-03, EXIT-LIVE-04, EXIT-LIVE-05]
autonomous: false
---

# Plan 21-07 Summary — Live-capture real-mainnet ETH roundtrip

## What happened

One controlled real-capital ETH buy+sell roundtrip ran through the REAL production bot on the
prod wallet (`0x46c6…3A5C`) at calm gas (0.384 gwei base), capturing all four live artifacts.
Operator-gated throughout — no executor agent signed/broadcast anything; the agent was
read-only (logs + on-chain reads). Token: LADYS V2 (`0x12970E…646bf`), min size 0.001 ETH.

- **BUY** landed via Flashbots multi-builder fanout (bundle `0xac7a9dc6…` → mined
  `0x18390903…`, block 25203473) — **STOP-THE-LINE-05 resolved LIVE** (the prior attempt
  ceiling-hit at 13 gwei; the 21.3 fanout fix got it included).
- **SELL** fired via the exit engine's OWN trigger (`exit.trigger.urgency` → `executeFullSell`,
  reason `urgency-market-sell`; D-EXIT-TRIGGER, not the Force-Sell override) and landed
  PRIVATELY via Flashbots at calm gas — sell tx `0xcc7997bb…` (block 25203624, status 1),
  **DB `amount_out` = 993814525259157** (non-null, ground truth), full 245.2M-LADYS balance sold.

## Artifacts captured (→ 21-07-CAPTURE-ARTIFACTS.md)

- EXIT-LIVE-01 (live poll telemetry): `exit.poll.cycle` ~50ms/5000ms budget, overruns:false, real RPC.
- EXIT-LIVE-03: sell tx `0xcc7997bb…` + DB sell row amount_out 993814525259157.
- EXIT-LIVE-04: SELL bundleHash `0xb8e15354…` → minedTxHash `0xcc7997bb…` (via the late-inclusion reconcile path — see note).
- EXIT-LIVE-05: operator dashboard WS position screenshots (cosmetic price-display caveat noted).

## Live validations earned (by-design operator-gated, "close only on the 21-07 retry")

- 21.3 BUY-leg calm-gas Flashbots inclusion (multi-builder fanout) — proven live.
- 21.2 SELL leg private Flashbots inclusion at calm gas — first live proof.
- 21.1 reconciliation (`mev.reconcile.included`) caught a real late inclusion — false-negative prevention proven live.

## Deviations / findings

- **Capture-method (learning, not a bug):** the planned tight 0.3% stop did NOT fire — LADYS is
  stable, its price didn't drop 0.3% (the fork rehearsal only sold because it INDUCED a drop).
  The engine correctly held under time-weighted urgency and market-sold at the 30-min deadline.
- **Cosmetic dashboard defect → deferred to 21.4** (debug session `exit-no-sell-current-zero`,
  resolved): `api/helpers/positions.ts` renders `Current 0.0000 / P&L -0.0010` because the
  `queryPrice(buyAmountWei…)` reference (ETH-cost-as-token-amount → ~4053 wei) is divided by
  1e18 for display. Display-only — the engine's ratio-based triggers are correct (confirmed not
  a capital-safety issue). EXIT-LIVE-04 mapping came via the reconcile path, not a clean
  `flashbots.bundle.included` event (worth a note in the evidence doc).

## Capital

0.008877 → 0.008563 ETH = ~0.000314 ETH total cost (buy+sell gas + ~0.6% round-trip) ≈ $1.
Wallet flat (0 LADYS), no stranded position or exit_state. No funds lost beyond expected cost.

## Self-Check: PASS

All four artifacts captured with ground-truth (DB amount_out + resolvable on-chain hashes) via
the engine's own exit trigger. One cosmetic follow-up (21.4); no capital-safety blocker.
