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
