# Roadmap: Crypto Snipe Bot

## Overview

Transform the existing single-chain Ethereum sniper bot into a production-ready multi-chain MEV sniper with Uniswap V2/V3 support, intelligent exit strategies, portfolio risk management, and a web dashboard. The journey starts by hardening the existing bot and modernizing its infrastructure (ethers v6, SQLite), then extends outward to multi-chain and V3 support, then upward to smart exits and risk controls, and finally surfaces everything through a monitoring dashboard. Testing validates the full integrated system.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Bug Fixes & Hardening** - Fix race conditions, re-enable safety checks, add graceful shutdown and startup validation
- [ ] **Phase 2: ethers v6 Migration** - Migrate from EOL ethers v5 to v6 with BigInt arithmetic and upgraded Flashbots/Hardhat
- [ ] **Phase 3: SQLite Storage & Code Quality** - Replace JSON file storage with SQLite, add structured logging, centralize providers and ABIs
- [ ] **Phase 4: Multi-Chain Architecture** - Chain abstraction layer supporting ETH, BSC, Base, Arbitrum with per-chain MEV protection
- [ ] **Phase 5: Uniswap V3 Integration** - Detect and snipe V3 pool launches across all chains and fee tiers
- [ ] **Phase 6: Risk Management** - Portfolio-level risk controls including position sizing, daily loss limits, and exposure tracking
- [ ] **Phase 7: Smart Exit Strategies** - Trailing stops, partial takes, dynamic thresholds, and time-weighted exit urgency
- [ ] **Phase 8: Monitoring & Web Dashboard** - Real-time web interface for positions, P&L, chain status, and bot controls
- [ ] **Phase 9: Testing Infrastructure** - Unit tests, integration tests, and mainnet fork tests validating the full system

## Phase Details

### Phase 1: Bug Fixes & Hardening
**Goal**: The existing single-chain bot operates reliably without losing money to preventable bugs or race conditions
**Depends on**: Nothing (first phase)
**Requirements**: FIX-01, FIX-02, FIX-03, FIX-04, FIX-05, FIX-06, FIX-07, FIX-08, FIX-09
**Success Criteria** (what must be TRUE):
  1. A position that hits both stop-loss and take-profit thresholds simultaneously results in exactly one sell transaction, never two
  2. Bot starts up on Sepolia testnet, validates all environment variables, and reports clear errors for any that are missing
  3. When the bot process receives SIGTERM, all monitoring loops stop, pending state is flushed, and the process exits cleanly within 5 seconds
  4. Flashbots bundle retries use incrementing nonces and target the correct network based on configuration
  5. Only messages from whitelisted Telegram sender IDs trigger alpha drop processing
**Plans**: 4 plans

Plans:
- [ ] 01-01-PLAN.md — Exit manager: mutex, timer registry, shutdown, balance checks, sell simulation, resume (FIX-01, FIX-04, FIX-05, FIX-07, FIX-08)
- [ ] 01-02-PLAN.md — Flashbots dynamic relay and nonce increment on retry (FIX-02, FIX-03)
- [ ] 01-03-PLAN.md — Startup env var validation and Telegram sender whitelist (FIX-06, FIX-09)
- [ ] 01-04-PLAN.md — [GAP CLOSURE] Env-driven network selection and .env.example (FIX-06)

### Phase 2: ethers v6 Migration
**Goal**: The entire codebase runs on ethers v6 with native BigInt arithmetic, eliminating the EOL v5 dependency
**Depends on**: Phase 1
**Requirements**: ETH6-01, ETH6-02, ETH6-03, ETH6-04
**Success Criteria** (what must be TRUE):
  1. No ethers v5 imports remain anywhere in the codebase -- all imports resolve to ethers v6.16+
  2. All wei-level arithmetic uses native BigInt with zero Number() conversions on financial values
  3. Flashbots bundle submission works on Sepolia using @flashbots/ethers-provider-bundle v1.0.0
  4. Hardhat compile, deploy, and test commands work with hardhat-ethers v4+ and ethers v6
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — Swap v5 packages for v6, update Hardhat/TS config, create ESLint BigInt safety rule, migrate light files (ETH6-04, ETH6-01, ETH6-02)
- [x] 02-02-PLAN.md — Migrate all remaining source files (BigNumber to BigInt, callStatic to staticCall, providers to flat imports), full compilation verification (ETH6-01, ETH6-02, ETH6-03)

### Phase 3: SQLite Storage & Code Quality
**Goal**: All bot state is persisted in SQLite with full audit trail, and the codebase uses structured logging with centralized providers and ABIs
**Depends on**: Phase 2
**Requirements**: DB-01, DB-02, DB-03, DB-04, INFRA-01, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. Sniped tokens, buys, sells, and status changes are recorded in SQLite with timestamps -- no JSON files used for state
  2. Two concurrent sell triggers on the same token produce correct state in SQLite (no lost writes, no corruption)
  3. P&L for any token can be queried from the database showing buy price, sell price, gas costs, and realized gain/loss
  4. All log output is structured JSON with severity levels (debug/info/warn/error) -- no console.log or emoji logging remains
  5. A single provider instance per chain is shared across all modules -- no redundant provider creation
**Plans**: 4 plans

Plans:
- [x] 03-01-PLAN.md — Install better-sqlite3 + pino, create foundation modules: db.ts, logger.ts, provider.ts, abis.ts (DB-01, DB-02, DB-03, INFRA-01, INFRA-02, INFRA-03)
- [x] 03-02-PLAN.md — Migrate core files (bot.ts, exitManager.ts, tokenSafety.ts) to foundation modules (DB-01, DB-02, DB-03, INFRA-01, INFRA-02, INFRA-03)
- [x] 03-03-PLAN.md — Migrate supporting files (alphaDrop, telegramListener, pairDiscovery, txManager, notifier, retry) to foundation modules (INFRA-01, INFRA-02, INFRA-03)
- [ ] 03-04-PLAN.md — P&L query, .bot-state.json auto-migration, delete storage.ts (DB-01, DB-02, DB-03, DB-04)

### Phase 4: Multi-Chain Architecture
**Goal**: The bot detects and snipes new V2 token listings concurrently across ETH, BSC, Base, and Arbitrum with per-chain MEV protection
**Depends on**: Phase 3
**Requirements**: CHAIN-01, CHAIN-02, CHAIN-03, CHAIN-04, CHAIN-05
**Success Criteria** (what must be TRUE):
  1. Chain registry maps each supported chain to its RPC endpoints, contract addresses, gas configuration, and MEV strategy
  2. Factory event listeners run concurrently on all four chains, each detecting PairCreated events independently
  3. Snipe transactions on ETH use Flashbots bundles; transactions on BSC/Base/Arbitrum use their respective private transaction mechanisms
  4. Capital allocation across chains adjusts based on configurable opportunity quality signals and chain activity levels
  5. Telegram notifications identify which chain each event originated from
**Plans**: 5 plans

Plans:
- [ ] 04-00-PLAN.md — Wave 0: Test fixtures and scaffold files for all behavioral tests (ALL)
- [ ] 04-01-PLAN.md — Chain registry types, ChainConfig interface, env vars, WebSocket provider support (CHAIN-01, CHAIN-02)
- [ ] 04-02-PLAN.md — MEV strategy pattern: Flashbots, bloXroute, passthrough adapters and txManager dispatch (CHAIN-04)
- [ ] 04-03-PLAN.md — Safety provider adapters (honeypot.is, GoPlus, Unicrypt, Mudra) and chain-prefixed notifications (CHAIN-02, CHAIN-03)
- [ ] 04-04-PLAN.md — Multi-chain bot orchestrator: concurrent listeners, WebSocket reconnect, capital tracking (CHAIN-03, CHAIN-05)

### Phase 5: Uniswap V3 Integration
**Goal**: The bot detects and snipes V3 pool launches across all supported chains, handling fee tiers and concentrated liquidity correctly
**Depends on**: Phase 4
**Requirements**: V3-01, V3-02, V3-03, V3-04
**Success Criteria** (what must be TRUE):
  1. Bot detects PoolCreated events from V3 factories on all configured chains and across all fee tiers (100, 500, 3000, 10000 bps)
  2. Bot waits for a Mint event (liquidity added) after PoolCreated before attempting a snipe -- empty pools are never traded
  3. V3 snipe transactions execute through the V3 SwapRouter with correct fee tier and price limit parameters
  4. Position price monitoring uses sqrtPriceX96 or the V3 Quoter contract for accurate valuation of V3 positions
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

### Phase 6: Risk Management
**Goal**: Portfolio-level risk controls prevent catastrophic losses and enforce disciplined position sizing across all chains
**Depends on**: Phase 4
**Requirements**: RISK-01, RISK-02, RISK-03, RISK-04, RISK-05
**Success Criteria** (what must be TRUE):
  1. No single snipe trade exceeds the configured max position size (ETH/BNB cap per trade)
  2. Sniping halts automatically when realized losses in the last 24 hours exceed the configured daily loss limit
  3. New snipes are rejected when open position count across all chains equals the configured maximum
  4. A configurable cooldown period is enforced between consecutive snipes, preventing overtrading during launch waves
  5. Total capital at risk across all chains and open positions is queryable at any time
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Smart Exit Strategies
**Goal**: Positions are managed with intelligent exit strategies that lock in profits, scale out at targets, and adapt to market conditions
**Depends on**: Phase 5, Phase 6
**Requirements**: EXIT-01, EXIT-02, EXIT-03, EXIT-04
**Success Criteria** (what must be TRUE):
  1. Trailing stop-loss tracks the price high-water mark and triggers a sell when price drops a configured percentage from the peak
  2. Partial sell orders execute at configured price milestones (e.g., sell 50% at 2x, 25% at 5x) with the remainder trailing
  3. Stop-loss and take-profit thresholds widen or tighten based on measured token price volatility
  4. Exit parameters become more aggressive as a position ages -- tighter stops and lower profit targets over time
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

### Phase 8: Monitoring & Web Dashboard
**Goal**: A web interface provides real-time visibility into all bot operations, positions, risk metrics, and historical performance
**Depends on**: Phase 6, Phase 7
**Requirements**: MON-01, DASH-01, DASH-02, DASH-03, DASH-04
**Success Criteria** (what must be TRUE):
  1. HTTP health check endpoint returns bot liveness, per-chain connectivity status, and open position count
  2. Dashboard displays all open positions with current P&L, token name, chain, entry price, and current price -- updating in real time
  3. Historical trade log is filterable by chain, date range, and profit/loss outcome
  4. Bot can be started/stopped per chain and snipe parameters adjusted from the dashboard without restarting the process
  5. Risk dashboard shows portfolio exposure, daily P&L curve, and position limit utilization
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD
- [ ] 08-03: TBD

### Phase 9: Testing Infrastructure
**Goal**: Comprehensive test suite validates the safety pipeline, storage layer, execution engine, and full snipe lifecycle
**Depends on**: Phase 7, Phase 8
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05
**Success Criteria** (what must be TRUE):
  1. Unit tests cover all 9 token safety checks including fallback paths when external APIs fail
  2. Concurrent SQLite write tests confirm no data loss or corruption under parallel access
  3. Integration tests verify Flashbots bundle submission, nonce-incrementing retry, and fallback to direct send
  4. Integration tests confirm stop-loss, take-profit, and trailing stop trigger correctly without double-selling
  5. Mainnet fork test executes a complete snipe lifecycle: detect pair, validate token, buy, monitor price, sell at target
**Plans**: TBD

Plans:
- [ ] 09-01: TBD
- [ ] 09-02: TBD
- [ ] 09-03: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9
(Phases 5 and 6 can run in parallel after Phase 4. Phase 7 depends on both 5 and 6. Phase 8 depends on 6 and 7.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Bug Fixes & Hardening | 3/4 | Gap closure in progress | - |
| 2. ethers v6 Migration | 0/2 | Planned | - |
| 3. SQLite Storage & Code Quality | 0/4 | Planned | - |
| 4. Multi-Chain Architecture | 0/5 | Planned | - |
| 5. Uniswap V3 Integration | 0/2 | Not started | - |
| 6. Risk Management | 0/2 | Not started | - |
| 7. Smart Exit Strategies | 0/2 | Not started | - |
| 8. Monitoring & Web Dashboard | 0/3 | Not started | - |
| 9. Testing Infrastructure | 0/3 | Not started | - |
