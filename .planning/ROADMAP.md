# Roadmap: Crypto Snipe Bot

## Overview

Production-ready multi-chain MEV sniper bot with Uniswap V2/V3 support,
intelligent exit strategies, portfolio risk management, on-chain honeypot
detection, anti-rug runtime monitoring, SQLite audit trail, and a real-time web
dashboard across ETH, BSC, Base, and Arbitrum. Live-proven on Ethereum mainnet.

## Milestones

- ✅ **v6.16 Production-Ready Multi-Chain MEV Sniper** — Phases 1–16 (shipped 2026-04-14) — [archive](milestones/v6.16-ROADMAP.md)
- ✅ **v6.17 Defensive Hardening for Live Mainnet** — Phases 17–21 + 21.1/21.2/21.3 (shipped 2026-05-29, ETH-first) — [archive](milestones/v6.17-ROADMAP.md)
- 📋 **Next milestone** — not yet scoped; run `/gsd-new-milestone`. Leading carry-forward: multi-chain rollout (HONEY-04 BSC/Base/Arb honeypot deploy + ANTIRUG-15 V3 allowlists).

## Phases

<details>
<summary>✅ v6.16 Production-Ready Multi-Chain MEV Sniper (Phases 1–16) — SHIPPED 2026-04-14</summary>

- [x] Phase 1: Bug Fixes & Hardening (4/4)
- [x] Phase 2: ethers v6 Migration (2/2)
- [x] Phase 3: SQLite Storage & Code Quality (4/4)
- [x] Phase 4: Multi-Chain Architecture (5/5)
- [x] Phase 5: Uniswap V3 Integration (4/4)
- [x] Phase 6: Risk Management (2/2)
- [x] Phase 7: Smart Exit Strategies (4/4)
- [x] Phase 8: Monitoring & Web Dashboard (6/6)
- [x] Phase 9: Testing Infrastructure (5/5)
- [x] Phase 10: partial_sell Revenue Fix (2/2)
- [x] Phase 11: Dashboard Accuracy & Bot Wiring (7/7)
- [x] Phase 12: Integration Gap Fixes (3/3)
- [x] Phase 13: Config Env-Var Correctness (1/1)
- [x] Phase 14: Sell Revenue Receipt Decoding (2/2)
- [x] Phase 15: Chain-Scoped Dedup & Dashboard Env (2/2)
- [x] Phase 16: Dashboard Type Alignment & Dead Code Cleanup (2/2)

Full archive: [milestones/v6.16-ROADMAP.md](milestones/v6.16-ROADMAP.md)

</details>

<details>
<summary>✅ v6.17 Defensive Hardening for Live Mainnet (Phases 17–21 + 21.1/21.2/21.3) — SHIPPED 2026-05-29 (ETH-first)</summary>

- [x] Phase 17: Tech Debt Cleanup & Audit Baseline (3/3) — completed 2026-04-30
- [~] Phase 18: Honeypot Detection Rebuild (10/11) — 18-08 (BSC/Base/Arb deploy → HONEY-04) deferred to next milestone
- [x] Phase 19: Anti-Rug Runtime Monitoring (10/10) — completed 2026-05-24
- [x] Phase 20: Going-Live Ops Hardening (12/12) — completed 2026-05-26
- [x] Phase 21: Exit-Engine Live-Runtime Hardening (8/8) — completed 2026-05-29 (live real-capital roundtrip closed all 6 deferred v6.16 items)
- [x] Phase 21.1: V3-Buy Tax-Gate + Flashbots Inclusion Fix (6/6) — completed 2026-05-27
- [x] Phase 21.2: Calm-Gas Sell Inclusion + Exit-Engine Robustness (13/13) — completed 2026-05-28
- [x] Phase 21.3: Buy-Leg Calm-Gas Flashbots Inclusion + Guaranteed-Inclusion Fallback (7/7) — completed 2026-05-29

**Result:** 69 plans complete · 68/70 requirements satisfied · 1 deferred (HONEY-04) · 1 partial-deferred (ANTIRUG-15). Capital-safety blocker INT-NONCE-SELL fixed inline at close.

Full archive: [milestones/v6.17-ROADMAP.md](milestones/v6.17-ROADMAP.md) · Live-capture evidence: [milestones/v6.17-VERIFICATION-EVIDENCE.md](milestones/v6.17-VERIFICATION-EVIDENCE.md)

</details>

### 📋 Next milestone (planning)

Not yet scoped. Run `/gsd-new-milestone` (questioning → research → requirements → roadmap). Committed carry-forward leads the backlog:

- [ ] Multi-chain rollout — deploy `HoneypotChecker.sol` on BSC/Base/Arbitrum (HONEY-04, plan 18-08 + contractual re-audit; redeploy ETH with 18-REVIEW-FIX hardening) + BSC/Base/Arb V3 anti-rug allowlists (ANTIRUG-15).
- [ ] Candidates: CHAIN-05 fully-dynamic capital allocation · DETECT-01 mempool/block-0 sniping · OPS-V2-01 synthetic-monitor canary-trade watchdog.

## Progress

| Milestone | Phases | Status | Shipped |
|-----------|--------|--------|---------|
| v6.16 Production-Ready Multi-Chain MEV Sniper | 1–16 (55 plans) | ✅ Complete | 2026-04-14 |
| v6.17 Defensive Hardening for Live Mainnet | 17–21 + 21.1/21.2/21.3 (69 plans) | ✅ Complete (ETH-first) | 2026-05-29 |
| Next milestone | TBD | 📋 Planning | — |

Per-phase detail for shipped milestones lives in the `milestones/` archives.

---
*Last updated: 2026-05-29 — v6.17 milestone closed (ETH-first); ROADMAP collapsed to milestone groupings, full phase detail archived in milestones/v6.17-ROADMAP.md. orchestrator SOLE writer of STATE/ROADMAP (hand-edited; NO gsd-sdk state.*/roadmap.*/phase.complete — they corrupt this shape).*
