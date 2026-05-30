---
plan: 21-07
type: capture-artifacts
status: captured
phase: 21-exit-engine-live-runtime-hardening
requirements: [EXIT-LIVE-01, EXIT-LIVE-03, EXIT-LIVE-04, EXIT-LIVE-05]
captured: true  # 2026-05-29 — real-mainnet ETH buy+sell roundtrip completed via the engine's own urgency trigger
wallet: "0x46c6D387EAb1669307c33E6f60173ADEe9Da3A5C"
token: "0x12970E6868f88f6557B76120662c1B3E50A646bf"  # LADYS (Milady) V2 — Etherscan-verified before the buy
buy_tx: "0x183909039899bbc782d73df0d0805dbc17398f0e6654a3b6adc0cc676b04895c"
sell_tx: "0xcc7997bb86bc616593479c60eb0283c15db5dfacad27a14683353bbc619bc605"
---

# Phase 21 Plan 07 — Live-Capture Artifacts (CAPTURED 2026-05-29)

One controlled real-mainnet ETH buy+sell roundtrip through the REAL production bot on the
prod wallet. Ground truth = the DB `trades.amount_out` row + the on-chain receipt
(D-OP-DB-TRUTH). The buy landed via the 21.3 multi-builder Flashbots fanout (STOP-THE-LINE-05
resolved LIVE); the sell fired via the exit engine's OWN urgency-market-sell trigger
(D-EXIT-TRIGGER — NOT the emergency override) and landed PRIVATELY via Flashbots at calm gas
(validating the 21.2 sell leg live for the first time). No executor agent signed or broadcast
anything — the operator ran the live bot; an agent only read logs / on-chain state read-only.

---

## 0. Go / No-Go record (pre-spend gates) — all GREEN

- [x] **Fork rehearsal GREEN**: `deliberateBuyReplay.fork.test.ts` 2/2 + `captureRehearsal.fork.test.ts` 2/2 (re-run 2026-05-29 before the live run).
- [x] **`npm run preflight`**: PASS 6/6 across eth (rpc-chainid, rpc-block-age, wallet-balance, mev-health, honeypot-checker-code, antirug-live-gate); Flashbots relay healthy.
- [x] **Live gas at capture**: base fee **0.384 gwei** — CALM (below the ~0.82 gwei planning baseline; D-NO-TOPUP satisfied, no top-up).
- [x] **Live balance at capture**: **0.008877 ETH** on `0x46c6…3A5C` (above the operational floor).
- [x] **Address verification**: wallet `0x46c6D387EAb1669307c33E6f60173ADEe9Da3A5C` ✔ ; token LADYS `0x12970E6868f88f6557B76120662c1B3E50A646bf` Etherscan-verified ✔ ; passed the bot's own honeypot gate at buy time (Honeypot:No, BuyTax:0bps, SellTax:0bps) ✔
- [x] **Simulate-before-submit**: the sell routed through the Flashbots MEV-protected path (private bundle).
- [x] **No agent transacted**: the operator ran the live bot; every on-chain action was the bot's; the agent was read-only throughout.

Go/No-Go decision: **GO at base fee 0.384 gwei / balance 0.008877 ETH** (2026-05-29).

---

## 1. EXIT-LIVE-03 — sell `amount_out` + resolvable Etherscan tx hash

**Sell tx hash (Etherscan-resolvable):**
```
0xcc7997bb86bc616593479c60eb0283c15db5dfacad27a14683353bbc619bc605   (block 25203624, status 1)
```

**DB row excerpt** (`trades`, the SELL row — `amount_out` NON-NULL, read via read-only connection):
```
id=3 | action=sell | tx_hash=0xcc7997bb…619bc605 | status=sold | pool_type=v2 | block=25203624
amount_in =245215490550933374669867436   (245,215,490.55 LADYS sold — the full re-fetched balance)
amount_out=993814525259157               (0.000993814525259157 ETH — NON-NULL)
```

**pino excerpts** (real fields):
```
op:exit.full.executed   reason=urgency-market-sell  txHash=0xcc7997bb…619bc605  "Exit sell TX confirmed"
op:exit.receipt.decoded txHash=0xcc7997bb…619bc605  amountOut=993814525259157  blockNumber=25203624
receiptDecoder          "Decoded WETH Withdrawal (V2)"  amountOut=993814525259157
```

---

## 2. EXIT-LIVE-04 — Flashbots bundleHash → minedTxHash (SELL leg)

> The BUY records no decoded amount_out (placeholder, as designed) — the EXIT-LIVE-04 artifact is the SELL leg.

- SELL bundleHash: `0xb8e15354694787537049f7b3b2daa6a312b6c10a0e9848fa47e8e32fa9e1964c` (targetBlock 25203623)
- SELL minedTxHash: `0xcc7997bb86bc616593479c60eb0283c15db5dfacad27a14683353bbc619bc605` (mined block 25203624 — resolves on Etherscan; == the §1 sell tx)

**NUANCE (worth noting for the evidence doc):** the sell landed via the late-inclusion
reconciliation path, NOT a clean `flashbots.bundle.included` event:
```
op:mev.reconcile.included  minedTxHash=0xcc7997bb…619bc605  attempt=0
  "Reconciled late inclusion — native confirm lied \"not included\" but the tx landed"
op:exit.full.private-landed  txHash=0xcc7997bb…619bc605  "Private exit bundle landed"
```
This is the 21.1 D-RECONCILE-RECEIPT fix earning its keep in production: the bundle (targeted
25203623) actually landed one block later (25203624); the native confirm reported "not
included" but the receipt-primary reconcile caught the real landing — preventing a
false-negative that pre-21.1 could have turned into a double-sell.

(For reference, the BUY leg DID emit a clean mapping: `flashbots.bundle.included`
bundleHash `0xac7a9dc6…39d3f` → minedTxHash `0x18390903…b04895c`, block 25203473.)

---

## 3. EXIT-LIVE-05 — dashboard WebSocket position-update screenshot

- Screenshots captured by the operator during the hold (position appeared + updated via the
  `positions_update` WS broadcast; Time Held incremented live).
- **CAVEAT — cosmetic display defect (NOT capital-safety; → 21.4):** the dashboard rendered
  the position as `Current 0.0000 / P&L -0.0010`. Root cause confirmed in debug session
  `exit-no-sell-current-zero`: `api/helpers/positions.ts` divides a fixed pseudo-reference
  quote (the `queryPrice(buyAmountWei…)` foot-gun — the 0.001-ETH cost mis-passed as a token
  amount → ~4053 wei) by 1e18 → renders ~0. The engine's exit logic uses the same reference as
  a RATIO (cancels), so triggers are correct; only the display is wrong. The WS position-update
  mechanism itself works (the artifact EXIT-LIVE-05 requires).

---

## 4. EXIT-LIVE-01 (live half) — `exit.poll.cycle` budget-vs-actual on the real RPC

Captured continuously throughout the live run (real Alchemy mainnet RPC):
```
op:exit.poll.cycle  positions=1  durationMs≈47-79  budgetMs=5000  overruns=false   (every 5s, 20:40→21:11 UTC)
```
Budget-vs-actual: each poll cycle completed in ~50 ms against the 5000 ms budget, zero
overruns — the decoupled serial-worker poll loop (21.2-05) running healthy on the live RPC.

---

## 5. Post-capture notes

- **Exit trigger:** the sell fired via `op:exit.trigger.urgency` ("Urgency market sell at 30min
  deadline") → `executeFullSell` (reason `urgency-market-sell`). This IS the exit engine's own
  poll-loop trigger (D-EXIT-TRIGGER), not the emergency/Force-Sell override.
- **CAPTURE-METHOD finding (learning, not a bug):** the planned "tight 0.3% stop → immediate
  sell" did NOT fire, because LADYS is a stable/liquid token whose market price did not drop
  0.3% (the 0.001-ETH buy didn't move the ~200-ETH pool). The `captureRehearsal` fork only sold
  because it ARTIFICIALLY induced a downward price move; live there is none. For a safe stable
  token the only engine trigger that fires is the 30-min urgency-market-sell. Future captures:
  either accept the ~30-min urgency path, or pick a token expected to move.
- **Live validations earned (the by-design operator-gated items that "close only on the 21-07
  retry"):** (1) 21.3 BUY-leg multi-builder Flashbots fanout landed the buy at calm gas →
  STOP-THE-LINE-05 RESOLVED live. (2) 21.2 SELL leg landed PRIVATELY via Flashbots at calm gas
  → first live proof. (3) 21.1 reconciliation caught a real late inclusion → false-negative
  prevention proven live.
- **Capital:** 0.008877 → 0.008563 ETH = ~0.000314 ETH total cost (buy gas + sell gas +
  ~0.6% round-trip slippage; net trade loss ~0.0000062 ETH). ≈ $1. No funds lost beyond
  expected cost; wallet flat (0 LADYS), no stranded position/state.
- **No STOP-THE-LINE blocker:** the debug session (`.planning/debug/resolved/` — `exit-no-sell-current-zero`)
  RULED OUT a capital-safety bug; the only follow-up is the cosmetic dashboard display fix (21.4).

---

*Consumed by Plan 21-08 → `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` (EXIT-LIVE-11).*
