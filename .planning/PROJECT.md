# Crypto Snipe Bot

## What This Is

A production-ready multi-chain MEV sniper bot that detects new token listings
on decentralized exchanges (Uniswap V2/V3 and forks like PancakeSwap,
SushiSwap) across ETH, BSC, Base, and Arbitrum. It validates token safety
through a multi-stage pipeline, executes snipes with per-chain MEV protection
(Flashbots / bloXroute / passthrough), manages positions through a unified
exit engine with trailing stops, partial sells, and age-weighted urgency, and
surfaces everything through a real-time web dashboard with chain controls and
emergency sell.

## Core Value

Reliably detect, validate, and profitably snipe new token listings across
multiple EVM chains with proper risk management — the bot must never lose
money to preventable bugs, race conditions, or security flaws.

## Current State (v6.16 — shipped 2026-04-14)

- 16 phases, 55 plans, 48/48 v1 requirements satisfied
- SQLite-backed state with WAL and full trade audit trail
- ethers v6 with native BigInt arithmetic throughout
- Multi-chain orchestrator with per-chain MEV strategies and concurrent listeners
- Unified exit engine (single 5s poll loop per position) with trailing stops, partial sells, volatility adaptation, age-weighted urgency
- 5-rule portfolio risk gate (position size, daily loss, max open, cooldown, exposure cap)
- Express + React dashboard with real-time positions, P&L charts, trade history, chain controls, emergency sell, WebSocket push
- 343/343 tests passing across unit, integration, and mainnet fork suites
- GitHub Actions CI

## Current Milestone: v6.17 Defensive Hardening for Live Mainnet

**Goal:** Make the bot safe to run with real money on live mainnet by rebuilding the broken pre-buy safety stack, adding anti-rug runtime monitoring, validating exit-engine behavior on live data, hardening the going-live path, and closing v6.16 tech debt.

**Target features:**

- **Pre-buy safety stack rebuild** — Fix V2 sell-sim (currently passes `balance=0` to router; hard-blocks every snipe) and V3 sell-sim (silent vacuous pass: zero honeypot detection while reporting success). Audit all 8+ gates in `tokenSafety.ts` for similar `amountIn=0` / vacuous-pass bugs. Architecture decision (on-chain checker contract / `eth_simulateV1` with state overrides / hosted simulation) deferred to research phase.
- **Anti-rug runtime monitoring (DETECT-02)** — Detect liquidity-removal events on open positions post-buy and trigger frontrun-exits.
- **Exit engine live-runtime hardening** — Resolve the 6 deferred human-verification items from v6.16 close as real code/test work: live exit poll cycle + state persistence across restart, real sell `amount_out` non-null, real Flashbots tx hash on mainnet, dashboard WebSocket position updates in browser, live price/Telegram/chain restart warnings, bot-startup SQLite + `.bot-state.json` migration on real boot.
- **Going-live ops hardening** — Wallet balance pre-flight check at startup, stale-data warnings, env-validation messaging upgrades. Formalize `GOING-LIVE.md` runbook into versioned docs.
- **Tech debt cleanup** — Retroactive Nyquist validation on 9 phases (01, 02, 03, 05, 06, 07, 08, 09, 10), 37 unfinished exit-engine `.todo` test stubs, 6 TS annotation errors in dashboard API routes, dead-code/diagnostic-log cleanup from v6.16 close audit.

**Key context:**

- Bot is live on mainnet today with ~0.0124 ETH funded; cannot snipe any V2 token currently due to broken sell-sim. Real money at stake.
- Owner explicitly rejected vacuous-pass / "trust third-party APIs alone" shortcuts.
- See `HONEYPOT-SIM-BRIEFING.md` for the bug write-up and four candidate fix architectures (A: vacuous pass — rejected; B: getAmountsOut — no honeypot detection; C: `eth_call` state overrides; D: deploy on-chain checker contract). Final pick during research/discuss-phase.
- Phase numbering continues from 17 (v6.16 ended at 16). Defensive only — CHAIN-05 dynamic capital and DETECT-01 mempool sniping deferred to a future offensive milestone.

## Requirements

### Validated (v6.16)

All 48 v1 requirements shipped and archived in [milestones/v6.16-REQUIREMENTS.md](milestones/v6.16-REQUIREMENTS.md).

- ✓ FIX-01..09 — bug fixes & hardening (race conditions, graceful shutdown, env validation, Telegram whitelist, Flashbots retry correctness) — v6.16
- ✓ ETH6-01..04 — ethers v6 migration with BigInt arithmetic — v6.16
- ✓ DB-01..04 — SQLite WAL storage with full audit trail and per-trade P&L (receipt-decoded amount_out) — v6.16
- ✓ INFRA-01..03 — structured pino logging, singleton providers, centralized ABIs — v6.16
- ✓ CHAIN-01..05 — multi-chain registry across ETH/BSC/Base/Arbitrum with per-chain MEV (CHAIN-05 shipped as fixed budgets; fully-dynamic deferred) — v6.16
- ✓ V3-01..04 — Uniswap V3 detection, liquidity wait, SwapRouter02/QuoterV2 — v6.16
- ✓ RISK-01..05 — portfolio risk gate (position size, daily loss, max open, cooldown, exposure) — v6.16
- ✓ EXIT-01..04 — unified exit engine with trailing stops, partial sells, volatility adaptation, age-weighted urgency — v6.16
- ✓ MON-01, DASH-01..04 — health endpoint, dashboard positions / trades / risk / controls — v6.16
- ✓ TEST-01..05 — unit, integration, and mainnet-fork test coverage — v6.16

### Active

<!-- v6.17 scope — full requirements with REQ-IDs in REQUIREMENTS.md. -->

v6.17 Defensive Hardening for Live Mainnet — categories: Pre-buy safety (HONEY/SAFETY), Anti-rug (ANTIRUG), Exit live-runtime (EXIT-LIVE), Going-live ops (OPS-LIVE), Tech debt (DEBT). See `.planning/REQUIREMENTS.md`.

**Phase 17 (DEBT) closed 2026-04-30** — DEBT-01..06 all satisfied. Wave-0 CI baseline confirmed the v6.16 close audit's 37/.todo and 6/TS-error claims were stale (actual: 0/0). 7 retroactive harm-prevention tests + 2 inline VALIDATION.md augmentations close DEBT-05. `getTradesByToken` deleted from `src/utils/db.ts`. `.github/workflows/test.yml` locks the verified-empty baseline as evergreen via `.todo` ban + `tsc --noEmit` × 3 invariant guards.

### Future

<!-- Deferred to a future offensive milestone, not abandoned. -->

- **CHAIN-05 dynamic capital allocation** — fully-dynamic opportunity-quality-weighted allocation (fixed per-chain budgets shipped in v6.16; completes CHAIN-05)
- **DETECT-01 mempool / block-0 sniping** — upgrade from block-mode to mempool pending-liquidity monitoring

### Out of Scope

<!-- Explicit boundaries. Reasoning retained to prevent re-adding. -->

- Mobile app — web dashboard is mobile-responsive; Telegram provides mobile alerts
- Centralized exchange integration — DEX-only sniper; CEX is a different product
- Copy trading / social trading — always behind the leader; sniping edge is speed
- Arbitrage between DEXes — different architecture; competes with professional MEV searchers
- Limit orders / manual trading — bot is fully automated; competes with DEX aggregators
- AI/ML token scoring (v1) — noisy training data; rule-based heuristics more reliable at this stage
- Multi-wallet support — use separate bot instances; simpler key management
- Presale / fair-launch sniping — every launchpad has different contract ABIs; maintenance nightmare

## Context

v6.16 shipped 2026-04-14 after 26 days of development (2026-03-19 → 2026-04-13).
379 files changed, +87,015 / -71 lines across 395 conventional commits.
Test suite: 343/343 passing across 31 files covering unit, integration, and
mainnet-fork scenarios. GitHub Actions CI runs test:unit and test:integration;
fork tests excluded since they require RPC access.

The bot currently runs against configured mainnets (ETH, BSC, Base, Arbitrum)
and Sepolia testnet with deployed test contracts (FakeToken, UniswapV2Factory,
UniswapV2Router02). Entry points: blockchain event listeners (`src/bot.ts`
via `startMultiChainBot`) and the Telegram alpha listener
(`src/telegramListener.ts`). Storage is SQLite-based; the .bot-state.json
auto-migration runs on first startup of Phase 3+ code. Dashboard is served
from the same process as the bot via Express on the configured port.

### Known Tech Debt (v6.16 close)

- 9 phases need retroactive Nyquist validation via `/gsd-validate-phase {N}`
- Phase 7: 37 `.todo` exit engine test stubs remain unfilled
- Phase 8: 6 TypeScript annotation errors in API route files (runtime correct)
- Phase 1: diagnostic console.log lines in telegramListener.ts (55, 61)
- Phase 16: `getTradesByToken` unused local const in db.ts:215
- See `milestones/v6.16-MILESTONE-AUDIT.md` for full list

## Constraints

- **Tech stack**: TypeScript, Node.js 18+, ethers v6.16, Hardhat for contracts, Express + React (Vite + Tailwind) for dashboard
- **Storage**: SQLite with WAL mode — local only, no cloud database
- **MEV Protection**: Flashbots on ETH; bloXroute / private RPCs on BSC; passthrough on Base/Arbitrum
- **Security**: Private keys via environment variables; all required env vars validated at startup with clear error messages
- **Backwards compatibility**: v6.16 is a from-scratch replacement of the pre-existing single-chain bot — no legacy compatibility required

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Migrate ethers v5 → v6 | v5 is EOL, v6 uses native BigInt, ecosystem moving forward | ✓ Good (Phase 02) |
| SQLite over JSON storage | Need atomic writes, concurrency control, and query capability | ✓ Good (Phase 03) |
| Multi-chain from day one | ETH, BSC, Base, Arbitrum all targeted — build the abstraction early | ✓ Good (Phase 04) |
| Full Uniswap V3 support | Concentrated liquidity is where volume is going — not just detection | ✓ Good (Phase 05) |
| DB-backed risk management | 5-rule canSnipe gate replaces in-memory capital tracking | ✓ Good (Phase 06) |
| Unified exit engine | Single 5s poll loop per position replaces 6 legacy monitors | ✓ Good (Phase 07) |
| Web dashboard over CLI | Need real-time position visibility beyond Telegram alerts | ✓ Good (Phase 08-12) |
| Fix bugs before extending | Don't build multi-chain on broken foundations | ✓ Good (Phase 01) |
| ethers v6 as standalone atomic phase | Touches every file; must complete in one wave | ✓ Good (Phase 02) |
| SQLite + code quality bundled | Structured logging / singleton providers are preconditions for multi-chain | ✓ Good (Phase 03) |
| Discriminated-union DexConfig (V2/V3) | Compile-time narrowing removes runtime guards | ✓ Good (Phase 05) |
| Receipt decoder wired into every sell path | Eliminates `amount_out: null` that broke P&L visibility | ✓ Good (Phase 14) |
| Chain-scoped dedup (AND chain = ?) | Per-chain isolation; legacy single-chain wrappers retired as hazards | ✓ Good (Phase 15) |
| API response as source of truth for dashboard types | Align interface to server, not the reverse | ✓ Good (Phase 16) |
| Gap-closure phases (10-16) over milestone-delay | Ship the audit fixes atomically rather than pushing v6.16 | ✓ Good |
| Both Flashbots + private RPCs | Different chains have different MEV protection options | ✓ Good (Phase 04) |
| Dynamic capital allocation | Smarter than fixed per-chain budgets — allocate on opportunity quality | ⚠️ Revisit (fixed budgets shipped; dynamic deferred to next milestone) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-30 — Phase 17 (DEBT) complete: DEBT-01..06 closed; CI invariant baseline locked*
