---
plan: 21-07
type: capture-artifacts
status: blocked
phase: 21-exit-engine-live-runtime-hardening
requirements: [EXIT-LIVE-01, EXIT-LIVE-03, EXIT-LIVE-04, EXIT-LIVE-05]
captured: false  # blocked 2026-05-29 — STOP-THE-LINE-05 (buy could not land via Flashbots at calm gas)
wallet: "0x46c6D387EAb1669307c33E6f60173ADEe9Da3A5C"
token: "0x12970E6868f88f6557B76120662c1B3E50A646bf"  # LADYS (Milady) V2 — VERIFY on Etherscan before the buy (address-check protocol)
---

# Phase 21 Plan 07 — Live-Capture Artifacts

One controlled real-mainnet ETH buy+sell roundtrip through the REAL production bot on
the prod wallet. Ground truth = the DB `trades.amount_out` row + the on-chain receipt,
NEVER a log line alone (D-OP-DB-TRUTH). A fork pass does NOT close these items
(D-EVIDENCE-BAR). **Public values only** — never paste `PRIVATE_KEY` or
`FLASHBOTS_AUTH_KEY` (T-21-07-03).

---

## 0. Go / No-Go record (pre-spend gates)

- [ ] **Fork rehearsal GREEN** (21-06 `captureRehearsal.fork.test.ts`): confirmed GREEN (precondition).
- [ ] **`npm run preflight`**: <FILL: PASS — 6/6 across eth, at HH:MM UTC>
- [ ] **Live gas at capture**: base fee `<FILL>` gwei / priority `<FILL>` gwei — NOT spiked vs calm baseline (D-NO-TOPUP, no top-up).
- [ ] **Live balance at capture**: `<FILL>` ETH on `0x46c6…3A5C` (above the 0.008 floor).
- [ ] **Address verification**: capture wallet == `0x46c6D387EAb1669307c33E6f60173ADEe9Da3A5C` ✔ ; chosen token `<FILL: 0x… token address>` confirmed on Etherscan ✔ ; token PASSES the bot's own honeypot gate ✔
- [ ] **Simulate-before-submit**: the engine ran `eth_callBundle` / `callStatic` immediately before the real sell submission ✔
- [ ] **No agent transacted**: every on-chain action performed by the operator; no executor agent signed or broadcast anything ✔

Go/No-Go decision: **<FILL: GO at gas X gwei / balance Y ETH  —  or  ABORTED: gas spiked>**

---

## 1. EXIT-LIVE-03 — sell `amount_out` + resolvable Etherscan tx hash

**Sell tx hash (Etherscan-resolvable):**
```
<FILL: 0x… sell transaction hash>
```

**DB row excerpt** (`SELECT id, token, action, amount_in, amount_out, tx_hash, status FROM trades WHERE …` — the SELL row, `amount_out` NON-NULL):
```
<FILL: paste the trades-table row showing the real non-null amount_out value>
```

**pino excerpts** (`exit.full.executed` + `exit.receipt.decoded`, real fields, secrets excluded):
```
<FILL: paste the op:exit.full.executed and op:exit.receipt.decoded lines>
```

---

## 2. EXIT-LIVE-04 — Flashbots bundleHash → minedTxHash (SELL leg only)

> The BUY records a `'mev_bundle'` placeholder — capture the SELL only.

**`flashbots.bundle.included` pino excerpt** (real `bundleHash` AND `minedTxHash`):
```
<FILL: paste the SELL's op:flashbots.bundle.included line>
```

- bundleHash: `<FILL>`
- minedTxHash: `<FILL>`  (MUST equal the §1 sell tx hash and resolve on Etherscan)

---

## 3. EXIT-LIVE-05 — dashboard WebSocket position-update screenshot

- Screenshot path: `<FILL: relative path to the timestamped screenshot file>`
- Timestamp shown: `<FILL: UTC timestamp visible in the shot>`
- Shows: the live position appearing/updating in the dashboard via the `positions_update` WS broadcast during the capture.

---

## 4. EXIT-LIVE-01 (live half) — `exit.poll.cycle` budget-vs-actual on the real RPC

**Filter command used** (confirm the bot's actual pino output shape first):
```
<FILL: e.g.  <bot log stream> | npx pino-pretty | grep exit.poll.cycle
        or   <bot log stream> | jq 'select(.op=="exit.poll.cycle")'>
```

**A few consecutive filtered cycle lines** (positions / durationMs vs budgetMs:5000 / overruns):
```
<FILL: paste 3-5 consecutive op:exit.poll.cycle lines from the real RPC run>
```

---

## 5. Post-capture notes

- Expected post-buy auto-pause (balance < 0.008 floor → Phase 20 `paused_by='preflight'` + red banner): `<FILL: observed? — exit monitors kept running, sell completed>`
- D-STOP-THE-LINE: **BLOCKED 2026-05-29** — the BUY could not land via Flashbots at calm gas (4 attempts → 13-gwei ceiling-hit; base fee 0.25 gwei; read-only staticCall confirms the swap is VALID → pure non-inclusion; capital safe, nothing spent). Surfaced **STOP-THE-LINE-05** → escalated to decimal phase **21.3** (NOT patched in-flight). See `21-STOP-THE-LINE-05-buy-leg-calm-gas-flashbots-inclusion.md`.
- Resume after capture: `<FILL: refunded / lowered MAX_OPEN_POSITIONS / resumed per going-live.md §mid-run undercut recovery>`

---

*Consumed by Plan 21-08 → `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` (EXIT-LIVE-11).*
