# Milestones — Crypto Snipe Bot

Historical record of shipped versions. Full phase/requirement detail archived in `milestones/`.

---

## v6.16 — Production-Ready Multi-Chain MEV Sniper

**Shipped:** 2026-04-14
**Timeline:** 2026-03-19 → 2026-04-13 (26 days)
**Scope:** 16 phases · 55 plans · 379 files changed · +87,015 / -71 lines · 395 conventional commits
**Git range:** `babe4117` → `c5ad4f8` (tag `v6.16`)
**Requirements:** 48/48 v1 requirements satisfied

### Delivered

Transformed a broken single-chain Ethereum sniper into a production-ready
multi-chain MEV sniper running concurrently across ETH, BSC, Base, and
Arbitrum with Uniswap V2/V3 support, portfolio risk controls, a unified
exit engine, and a real-time web dashboard.

### Key Accomplishments

1. **Hardened the existing bot** — mutex-based exit mediation, timer registry, graceful SIGTERM/SIGINT shutdown, startup env validation, Telegram sender whitelist, dynamic Flashbots relay with nonce-incrementing retry
2. **Modernized the foundation** — migrated off EOL ethers v5 to v6 with native BigInt arithmetic; replaced JSON storage with SQLite WAL; structured pino logging; singleton provider/ABI modules
3. **Went multi-chain** — chain registry abstraction for ETH/BSC/Base/Arbitrum with per-chain MEV strategies (Flashbots, bloXroute, passthrough) and provider-strategy safety pipelines
4. **Added Uniswap V3** — discriminated-union DexConfig, V3 pool detection with liquidity wait, SwapRouter02/QuoterV2 across all fee tiers
5. **Portfolio risk gate** — 5-rule canSnipe (position size, daily loss, max open, cooldown, exposure cap) ordered cheapest-first
6. **Unified exit engine** — single 5s poll loop replaces 6 legacy monitors with trailing stops, partial sells, volatility adaptation, age-weighted urgency
7. **Web dashboard** — Express + React (Vite + Tailwind) SPA with positions, trade history, P&L charts, chain controls, emergency sell, WebSocket push of chain status and notifications
8. **Full test suite** — 343/343 passing across unit, integration, and mainnet fork suites; GitHub Actions CI

### Gap-Closure Phases (10-16)

Audit-surfaced integration issues resolved during milestone without slipping scope:

- Partial-sell revenue visibility in P&L, trade history, risk queries (Phase 10)
- Live dashboard prices + chain restart listeners + Telegram listener wiring (Phase 11)
- Multi-dex price resolution, WS chain status broadcast, stale artifact cleanup (Phase 12)
- `STOP_LOSS_PCT` env wiring, conditional `FLASHBOTS_AUTH_KEY` (Phase 13)
- Sell-receipt decoding so `amount_out` is never null (Phase 14)
- Chain-scoped dedup, `DASHBOARD_API_KEY` required at startup (Phase 15)
- Dashboard Trade type alignment + dead code removal (Phase 16)

### Known Deferred / Tech Debt at Close

- 9/16 phases need retroactive Nyquist validation (`/gsd-validate-phase {N}`)
- Phase 7: 37 `.todo` exit engine test stubs remain without real assertions
- Phase 8: 6 TypeScript annotation errors in API route files (runtime correct); 1 test fixture mismatch
- Phase 1: diagnostic console.log lines in telegramListener.ts; `releaseSellLock` exported but never called
- Phase 11: pre-existing `getPnLChartData` redeclare TS error in db.ts
- Phase 16: no explicit VERIFICATION.md (inferred from SUMMARY + VALIDATION + UAT + REVIEW-FIX); `getTradesByToken` unused local const in db.ts:215
- CHAIN-05: dynamic capital allocation shipped as fixed per-chain budgets; fully-dynamic allocation deferred to next milestone

Full audit: [milestones/v6.16-MILESTONE-AUDIT.md](milestones/v6.16-MILESTONE-AUDIT.md)

### Human Verification Items (live-runtime)

Deferred pending live-network validation:

- Bot startup with SQLite + `.bot-state.json` auto-migration (Phase 3)
- `startMultiChainBot` smoke test on live ETH RPC (Phase 4)
- Live exit engine poll cycle + state persistence across restart (Phase 7)
- Visual dashboard rendering + WebSocket position updates in browser (Phase 8)
- Live price display, Telegram status, chain restart warnings (Phase 11)
- Real sell records non-null amount_out; Flashbots real tx hash (Phase 14)

### Archives

- Roadmap: [milestones/v6.16-ROADMAP.md](milestones/v6.16-ROADMAP.md)
- Requirements: [milestones/v6.16-REQUIREMENTS.md](milestones/v6.16-REQUIREMENTS.md)
- Audit: [milestones/v6.16-MILESTONE-AUDIT.md](milestones/v6.16-MILESTONE-AUDIT.md)

---

## v6.17 — Defensive Hardening for Live Mainnet

**Shipped:** 2026-05-29 (ETH-first — `ENABLED_CHAINS=eth`)
**Timeline:** 2026-04-14 → 2026-05-29 (45 days)
**Scope:** 8 phases (17–21 + inserted 21.1/21.2/21.3) · 69 plans completed (1 deferred) · ~170 code files (+45,384 / −661 in src/test/scripts) · 491 commits
**Git range:** `c848f8c` → `daf8f4e` (tag `v6.17`)
**Requirements:** 68/70 satisfied · 1 deferred (HONEY-04) · 1 partial-deferred (ANTIRUG-15)

### Delivered

Made the bot safe to run with real money on live **Ethereum** mainnet. Rebuilt
the broken pre-buy safety stack (on-chain `HoneypotChecker.sol`), added anti-rug
runtime monitoring, hardened the full buy→monitor→exit lifecycle against
calm-gas non-inclusion / nonce collisions / event-loop freeze / failed-exit
position loss, formalized the going-live ops path, and **closed the 6 deferred
v6.16 human-verification items with real-mainnet artifacts** via a live
real-capital roundtrip.

### Key Accomplishments

1. **Pre-buy safety stack rebuilt** — deployed Etherscan-verified on-chain `HoneypotChecker.sol` (V2+V3) at `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD`; deleted the broken V2/V3 sell-sims; discriminated-union `HoneypotResult` with fail-closed `unknown` makes a vacuous-pass regression unrepresentable. Slither + Mythril clean.
2. **Anti-rug runtime monitoring (DETECT-02)** — single-listener-per-chain WS detector with multi-signal AND-chain logic (V2 + V3), allowlist + confirm-after-N-blocks, per-chain circuit breaker, 7-day dry-run default, WS heartbeat + reconnect + backfill.
3. **Going-live ops hardening** — `src/preflight.ts` fail-fast (wallet floor, RPC chainId/block-age, MEV health, checker code-at-address, cross-env rules); SQLite-persisted multi-stage kill-switch; `npm run preflight|pause|resume`; consolidated runbook + CI guards.
4. **Exit-engine live-runtime hardening** — closed all 6 deferred v6.16 items with ground-truth artifacts (Etherscan hash, DB `amount_out`, pino excerpts, dashboard screenshot). Sell tx `0xcc7997bb…619bc605`, `amount_out = 993814525259157`. Dotted `op`-field log taxonomy; real-launch fork fixtures + `ALLOW_REAL_MAINNET` test gate.
5. **Three STOP-THE-LINE decimal phases (21.1/21.2/21.3)** — fixed the V3 tax-gate + Flashbots false-negative reconciliation; calm-gas sell inclusion + bot-wide nonce authority + watchdog/two-stage-SIGINT + failed-exit position protection; calm-gas buy inclusion via hardened-private multi-builder fanout (snipes never go public). Each surfaced by — and gated by — real-capital live-capture attempts.
6. **Tech debt closed (Phase 17)** — CI baseline disproved the stale "37 `.todo` / 6 TS-error" v6.16 claims (actual 0/0); 9-phase retroactive Nyquist; evergreen CI invariant guards.

### Quality-Gate Track Record

The deep code-review + fork-rehearsal gates repeatedly caught **capital-safety bugs the green unit suite missed** (masked by mocking the mechanism under test): 21.1 CR-01 (fee-ceiling bypass), 21.2 S-1/CR-01/CR-02/NF-01, 21.3 STOP-THE-LINE-06/CR-01, and the milestone-audit **INT-NONCE-SELL** (private sell bypassed `withNonceLock` — fixed inline at close, RED-proven, full unit 759/759). Real-path integration checks + RED-proven tests are the reliable defense; the green suite alone is not.

### Known Deferred / Carried Forward

- **HONEY-04** — BSC/Base/Arb `HoneypotChecker.sol` deploy (plan 18-08, operator-deferred 2026-05-22; contractual re-audit trigger preserved; fail-closed — those chains refuse to boot).
- **ANTIRUG-15** — BSC/Base/Arb V3 anti-rug allowlists (ETH resolved). Tied to the same multi-chain rollout.
- ETH `HoneypotChecker` runs pre-18-REVIEW-FIX bytecode (immutable; hardening reaches chains via 18-08's fresh deploy).
- V3 exit has no public-mempool fallback (fail-loud, held + monitored, anti-rug fires).
- Two RESERVED coinbase-bribe knobs (sell + buy) unimplemented.

### Archives

- Roadmap: [milestones/v6.17-ROADMAP.md](milestones/v6.17-ROADMAP.md)
- Requirements: [milestones/v6.17-REQUIREMENTS.md](milestones/v6.17-REQUIREMENTS.md)
- Audit: [milestones/v6.17-MILESTONE-AUDIT.md](milestones/v6.17-MILESTONE-AUDIT.md)
- Live-capture evidence: [milestones/v6.17-VERIFICATION-EVIDENCE.md](milestones/v6.17-VERIFICATION-EVIDENCE.md)
- Honeypot-checker audit: [milestones/v6.17-honeypot-checker-audit.md](milestones/v6.17-honeypot-checker-audit.md)
- Safety-bank audit: [milestones/v6.17-safety-bank-audit.md](milestones/v6.17-safety-bank-audit.md)
- Debt baseline: [milestones/v6.17-debt-baseline.md](milestones/v6.17-debt-baseline.md)

---
