# Crypto Snipe Bot

## What This Is

A production-ready multi-chain MEV sniper bot that detects new token listings
on decentralized exchanges (Uniswap V2/V3 and forks like PancakeSwap,
SushiSwap) across ETH, BSC, Base, and Arbitrum. It validates token safety
through a multi-stage pipeline — including an on-chain `HoneypotChecker.sol`
round-trip simulation — executes snipes with per-chain MEV protection
(Flashbots / bloXroute / passthrough) hardened for guaranteed inclusion at calm
gas, monitors open positions for liquidity-removal rugs with a frontrun-exit,
manages positions through a unified exit engine with trailing stops, partial
sells, and age-weighted urgency, and surfaces everything through a real-time web
dashboard with chain controls and emergency sell. A fail-fast preflight and a
SQLite-persisted kill-switch gate going live with real money.

## Core Value

Reliably detect, validate, and profitably snipe new token listings across
multiple EVM chains with proper risk management — the bot must never lose
money to preventable bugs, race conditions, or security flaws.

## Current State (v6.17 — shipped 2026-05-29, ETH-first)

- 24 phases total (17–21 + inserted 21.1/21.2/21.3 this milestone); 68/70 v6.17 requirements satisfied (2 deferred to next milestone)
- **Live-proven on Ethereum mainnet** — a real-capital buy→monitor→sell roundtrip closed all 6 deferred v6.16 human-verification items with on-chain artifacts (sell `0xcc7997bb…619bc605`, `amount_out = 993814525259157`)
- On-chain `HoneypotChecker.sol` (V2+V3) deployed + Etherscan-verified on ETH; broken sell-sims deleted; fail-closed `HoneypotResult` discriminated union
- Anti-rug runtime monitoring (single-listener-per-chain WS, multi-signal AND-chain, circuit breaker, 7-day dry-run default)
- Hardened MEV submission — calm-gas guaranteed inclusion (multi-builder fanout for buys, independent sell ceiling + public-mempool fallback for sells), bot-wide per-wallet nonce authority, watchdog + two-stage SIGINT, failed-exit position protection
- `src/preflight.ts` fail-fast + SQLite-persisted multi-stage kill-switch + `npm run preflight|pause|resume`
- 759/759 unit + 216 integration + mainnet-fork suites green; tsc clean ×3; GitHub Actions CI
- **Shipped config: `ENABLED_CHAINS=eth`** — BSC/Base/Arbitrum fail-closed (refuse to boot without a deployed checker address)

## Next Milestone: Planning

v6.17 shipped ETH-first. The next milestone is not yet scoped. Two committed
carry-forward items lead the backlog:

- **Multi-chain rollout** — deploy `HoneypotChecker.sol` on BSC/Base/Arbitrum (**HONEY-04**, plan 18-08 + contractual re-audit; redeploy ETH with the 18-REVIEW-FIX Solidity hardening) and resolve the BSC/Base/Arb V3 anti-rug allowlists (**ANTIRUG-15**).
- Then candidate offensive/quality work: CHAIN-05 fully-dynamic capital allocation, DETECT-01 mempool/block-0 sniping, OPS-V2-01 synthetic-monitor canary-trade watchdog.

Run `/gsd-new-milestone` to scope it (questioning → research → requirements → roadmap).

<details>
<summary>v6.17 milestone goals (shipped — archived)</summary>

**Goal:** Make the bot safe to run with real money on live mainnet by rebuilding the broken pre-buy safety stack, adding anti-rug runtime monitoring, validating exit-engine behavior on live data, hardening the going-live path, and closing v6.16 tech debt.

Delivered ETH-first across phases 17–21 (+ 21.1/21.2/21.3). The pre-buy safety
stack was rebuilt as an on-chain checker (Option D), the V2/V3 sell-sim footguns
were deleted, anti-rug runtime monitoring shipped, the full buy→monitor→exit
lifecycle was hardened against calm-gas non-inclusion / nonce collisions /
event-loop freeze / failed-exit position loss, and the 6 deferred v6.16
verification items closed with real-mainnet artifacts. Multi-chain deploy
(HONEY-04) + V3 allowlist (ANTIRUG-15) deferred to the next milestone.

</details>

## Requirements

### Validated (v6.17)

68/70 v6.17 requirements shipped (ETH-first) and archived in [milestones/v6.17-REQUIREMENTS.md](milestones/v6.17-REQUIREMENTS.md). HONEY-04 + ANTIRUG-15 (multi-chain) carried forward.

- ✓ DEBT-01..06 — tech-debt cleanup + CI baseline (disproved stale v6.16 `.todo`/TS counts) + 9-phase retroactive Nyquist — v6.17
- ✓ HONEY-01..03, 05..12 — on-chain `HoneypotChecker.sol` (V2+V3, ETH-deployed) + fail-closed discriminated-union result + multi-amount tax probe + bytecode scan; broken sell-sims deleted — v6.17
- ✓ ANTIRUG-01..14, 16 — single-listener-per-chain anti-rug WS monitoring with multi-signal AND-chain, circuit breaker, 7-day dry-run, reconnect/backfill — v6.17
- ✓ OPS-LIVE-01..13 — `src/preflight.ts` fail-fast + SQLite-persisted multi-stage kill-switch + CLI wrappers + versioned runbook — v6.17
- ✓ EXIT-LIVE-01..11 — 6 deferred v6.16 items closed with real-mainnet artifacts; dotted `op`-field log taxonomy; real-launch fork fixtures + `ALLOW_REAL_MAINNET` gate — v6.17
- ✓ STOP-THE-LINE-01..06 (incl. 04-A/B/C/D, 05-A/B/C/D) — V3 tax-gate + Flashbots reconciliation; calm-gas sell+buy inclusion; bot-wide nonce authority; failed-exit position protection — v6.17 (phases 21.1/21.2/21.3)

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

_v6.17 shipped 2026-05-29 (ETH-first). No milestone is currently scoped — run `/gsd-new-milestone`. Committed carry-forward, leading the backlog:_

- [ ] **HONEY-04** — deploy `HoneypotChecker.sol` on BSC/Base/Arbitrum (plan 18-08; contractual re-audit when it ships; redeploy ETH with the 18-REVIEW-FIX Solidity hardening).
- [ ] **ANTIRUG-15** — resolve BSC/Base/Arb V3 anti-rug allowlists (ETH already resolved).

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

v6.17 shipped 2026-05-29 after 45 days (2026-04-14 → 2026-05-29), ETH-first.
491 commits; ~170 code files changed (+45,384 / −661 in src/test/scripts), the
rest generated artifacts (contract builds, Ignition deployments, lockfiles) and
planning docs (~69,500 lines). Test suite: 759 unit + 216 integration + mainnet-
fork suites green; tsc clean ×3. GitHub Actions CI runs test:unit and
test:integration; fork tests excluded (require RPC access).

The bot is **live-proven on Ethereum mainnet** — a real-capital roundtrip on the
prod wallet closed the 6 deferred v6.16 verification items (capital cost ≈ $1,
wallet flat, no stranded state). DB schema is at `PRAGMA user_version = 7`.
Shipped config is `ENABLED_CHAINS=eth`; BSC/Base/Arbitrum are wired but
fail-closed (refuse to boot without a deployed `HoneypotChecker` address) pending
HONEY-04. Entry points: blockchain event listeners (`src/bot.ts` via
`startMultiChainBot`; start with `npx ts-node src/bot.ts`) and the Telegram alpha
listener (`src/telegramListener.ts`). `npm run preflight` is the read-only
cold-start readiness check (there is no dry-run boot mode). Storage is SQLite
(WAL); dashboard is served from the bot process via Express.

_v6.16 reference: shipped 2026-04-14 after 26 days; 379 files, +87,015 / −71 across 395 commits; 343/343 tests._

### Known Tech Debt (v6.17 close)

- **HONEY-04 / ANTIRUG-15** — BSC/Base/Arb multi-chain deploy + V3 allowlists deferred to next milestone (fail-closed; contractual re-audit when 18-08 ships).
- ETH `HoneypotChecker` (`0x8243dBeA…13eD`) runs pre-18-REVIEW-FIX bytecode (immutable; hardening reaches chains via 18-08's fresh deploy).
- V3 exit has no public-mempool fallback (fail-loud, position kept held+monitored, anti-rug still fires) — V2-only guaranteed public exit.
- V3 snipe handler inlines arm logic instead of the shared `armPositionMonitoring` helper (behavior-equivalent; drift risk).
- Two RESERVED-but-unimplemented coinbase-bribe knobs (`MEV_SELL_/MEV_BUY_COINBASE_BRIBE_ENABLED`).
- Phase 20 WR-01/WR-02 (CORS scheme-blind / 500-not-403) — non-blocking, local-only default; Telegram listener WR-09 allow-all default to tighten later.
- Phase 17 VALIDATION `nyquist_compliant: partial` (within-phase inline-doc validations on 02/09); optional `/gsd-validate-phase 17` for strict closure.
- No standalone `21-VERIFICATION.md` (substance via VERIFICATION-EVIDENCE + VALIDATION + SECURITY).
- See `milestones/v6.17-MILESTONE-AUDIT.md` for the full reconciliation.

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
| On-chain `HoneypotChecker.sol` (Option D) over vacuous-pass / `getAmountsOut` / `eth_simulateV1` | Owner-mandated defense-in-depth; only a real round-trip exercises the token's `_transfer` hook | ✓ Good (Phase 18) |
| Discriminated-union `HoneypotResult` with fail-closed `unknown` | Make a vacuous-pass regression unrepresentable in the type system | ✓ Good (Phase 18) |
| Single-listener-per-chain anti-rug WS (not per-position) | Avoids WS subscription-cap leaks at scale | ✓ Good (Phase 19) |
| Bot-wide per-wallet `withNonceLock` authority (composes with re-fetch-`latest`; not ethers `NonceManager`) | Eliminates the nonce-collision/double-spend class across every signing path | ✓ Good (Phase 21.2; INT-NONCE-SELL gap on the private-sell site fixed at close) |
| Snipes stay PRIVATE — no auto public-mempool fallback for genuine snipe buys | Public exposure forfeits the front-run/sandwich protection the snipe uses Flashbots for | ✓ Good (Phase 21.3; explicit operator deliberate path is the manual escape) |
| D-EVIDENCE-BAR — fork pass never closes a deferred item | Real money needs a resolvable on-chain artifact, not a green fork test | ✓ Good (Phase 21; 6/6 items closed with live artifacts) |
| Quality gates (deep code-review + fork rehearsal) over green-suite trust | The unit suite repeatedly masked capital-safety bugs by mocking the mechanism under test | ✓ Good (caught CR/S-1/INT-NONCE across 21.1/21.2/21.3 + audit) |
| Ship v6.17 ETH-first; defer multi-chain deploy | Get real money safe on ETH now; BSC/Base/Arb fail-closed until HONEY-04 | ✓ Good (operator decision 2026-05-29) |

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
*Last updated: 2026-05-29 after v6.17 milestone (Defensive Hardening for Live Mainnet, shipped ETH-first)*
