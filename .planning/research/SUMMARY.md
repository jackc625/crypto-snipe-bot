# Project Research Summary

**Project:** Crypto Snipe Bot
**Domain:** Multi-chain EVM MEV sniper bot with web dashboard
**Researched:** 2026-03-19
**Confidence:** HIGH

## Executive Summary

This project is an extension of an existing Ethereum-only sniper bot into a multi-chain, multi-DEX system with intelligent exit strategies, proper risk management, and a web dashboard. The bot already has working V2 detection, a 9-stage safety pipeline, Flashbots MEV protection, and Telegram integration -- but it has critical bugs (race conditions, broken nonce management, disabled safety checks) and is built on EOL infrastructure (ethers v5, JSON file storage). The recommended approach is to harden first, then extend: fix bugs and migrate infrastructure before adding new capabilities.

The standard architecture for production sniper bots follows a layered pattern: ingestion (chain listeners + Telegram) -> normalized event bus -> orchestration (validation + risk + capital allocation) -> execution (chain-specific MEV strategies) -> position management (state machine with pluggable exit strategies) -> persistence (SQLite). The chain abstraction must go beyond config-swapping -- each chain has materially different block timing, gas pricing, and MEV protection mechanisms. Building naive abstractions that treat EVM chains as identical is the single most common failure mode in multi-chain bot projects.

The key risks are: (1) BigInt precision loss during the ethers v6 migration silently corrupting price calculations, (2) the double-sell race condition multiplying across chains and exit strategies without a position state machine, (3) Uniswap V3's fundamentally different pool lifecycle (creation and liquidity are separate transactions) breaking the V2 mental model, and (4) MEV protection strategies that only work on Ethereum being applied to other chains. All four are addressable through the architecture patterns documented in the research, but each requires explicit design attention -- they will not resolve themselves through generic abstractions.

## Key Findings

### Recommended Stack

The stack stays with ethers.js (v6.16.0) rather than migrating to viem -- the project already has extensive ethers v5 code and the migration to v6 is a version bump, not a rewrite. Storage moves to better-sqlite3 (12.8.0) with Drizzle ORM (0.45.1) for type-safe schema management and migrations. The dashboard backend uses Hono (14kb, WebSocket-native) rather than Express or Fastify. Structured logging moves to Pino. Testing moves from Mocha/Chai/Waffle to Vitest 4.

**Core technologies:**
- **ethers.js v6.16.0**: Blockchain interaction -- native BigInt, active maintenance, path of least migration resistance from v5
- **better-sqlite3 + Drizzle ORM**: Storage -- synchronous API eliminates callback complexity for atomic writes; Drizzle adds type-safe schema and migrations at 7.4kb
- **@flashbots/ethers-provider-bundle v1.0.0**: MEV protection on Ethereum -- must upgrade simultaneously with ethers v6 (incompatible APIs between 0.6.1 and 1.0.0)
- **Hono v4.12.8**: Dashboard API server -- lightweight, TypeScript-first, built-in WebSocket support
- **Pino v10.3.1**: Structured JSON logging -- replaces console.log/emoji pattern, zero-overhead worker-thread transport
- **Vitest v4.1.0**: Test runner -- Vite-native, TypeScript-first, 10-20x faster than Jest

**Critical version constraint:** The Flashbots provider v1.0.0 requires ethers 6.7.1+. These must be upgraded atomically. The Uniswap V3 SDK may still have ethers v5 internals -- use raw ABI approach for event listening to avoid the conflict entirely.

### Expected Features

**Must have (table stakes) -- bot loses money without these:**
- Block-0 sniping (exists, needs mempool-mode upgrade)
- Honeypot detection (exists, has a bug in callStatic fallback -- passes private key as address)
- MEV protection (exists for ETH only, hardcoded to mainnet, broken nonce on retry)
- Stop-loss and take-profit (exist, have race condition where both fire simultaneously)
- Sell simulation before buy (exists but DISABLED -- critical safety check currently skipped)
- Graceful shutdown (MISSING -- no signal handlers, orphaned intervals)
- Startup environment validation (MISSING -- uses `!` non-null assertions)

**Should have (competitive differentiators):**
- Multi-chain simultaneous operation (ETH, BSC, Base, Arbitrum) -- 4x opportunity surface
- Uniswap V3 pool detection and trading -- capturing growing V3 launch volume
- Trailing stop-loss and partial take-profit -- industry standard in Banana Gun and Maestro
- Daily loss limit / circuit breaker -- prevents cascade rug-pull losses
- SQLite storage with audit trail -- enables P&L analysis and fixes concurrency bugs
- Web dashboard -- real-time visibility beyond Telegram notifications

**Defer to v2+:**
- Dynamic capital allocation across chains (needs operational data to calibrate)
- Volatility-adjusted exit parameters (needs weeks of price history)
- Time-weighted exit urgency (novel, needs backtesting)
- Anti-rug real-time monitoring (diminishing returns if safety pipeline is strong)

### Architecture Approach

The architecture follows a five-layer design: Ingestion (per-chain factory listeners + Telegram) feeds a normalized Event Bus, which routes to an Orchestration layer (validation pipeline, risk manager, capital allocator). Approved opportunities flow to chain-specific Executors using a strategy pattern for MEV protection. Successful snipes create Position objects managed by a state machine with mutex-protected exits, persisted to SQLite. The Web Dashboard and Telegram Notifier are passive consumers at the Interface layer. The critical architectural innovation is the Chain Registry -- a central map from chainId to full behavioral configuration (not just addresses, but gas strategies, block timing, MEV approach) that eliminates hardcoded chain references throughout business logic.

**Major components:**
1. **Chain Registry + Provider Registry** -- maps chainId to full config including behavioral strategies; singleton providers eliminate the 5+ redundant instances in the current codebase
2. **Normalized Event Bus** -- converts chain-specific factory events (V2 PairCreated, V3 PoolCreated) into a common ChainEvent type, decoupling listeners from orchestration
3. **Token Validation Pipeline** -- refactored 9-stage safety pipeline that receives ChainConfig for chain-aware API calls and contract addresses
4. **Execution Layer with Strategy Pattern** -- Flashbots (ETH), MEV-protected RPC (BSC via Merkle/Blink), direct RPC (Base/Arbitrum with sequencer protection)
5. **Position State Machine** -- state transitions (pending -> open -> monitoring -> exiting -> closed) with per-position mutex preventing double-sell race conditions
6. **Exit Strategy Engine** -- pluggable exit strategies (stop-loss, take-profit, trailing stop, partial sell, timed sell) that observe position state and coordinate through the state machine

### Critical Pitfalls

1. **BigInt precision loss (Phase 1)** -- `Number()` on wei values silently rounds above ~0.009 ETH, corrupting price comparisons. The codebase already uses `Number()` on contract returns in 6+ places. All arithmetic must stay in BigInt until display formatting. Create a `math.ts` utility module with BigInt-safe percentage and comparison helpers.

2. **Flashbots provider version mismatch (Phase 1)** -- The 0.6.1 -> 1.0.0 upgrade changes the constructor API, import paths, and TransactionRequest types. Must upgrade atomically with ethers v5 -> v6. Test Flashbots bundle submission on Sepolia before proceeding.

3. **Treating EVM chains as identical (Phase 2)** -- BSC has 3s blocks (not 12s), Arbitrum has no traditional mempool, Base uses a sequencer for ordering. The chain abstraction must include behavioral strategies (gas, MEV, timing), not just config values.

4. **V3 fee tier blindness (Phase 3)** -- One token pair can have 4 V3 pools across fee tiers. The bot must query all tiers and select the deepest liquidity pool, not just snipe the first PoolCreated event.

5. **V3 pool creation vs. liquidity timing (Phase 3)** -- In V3, pool creation and liquidity addition are separate transactions. Sniping on PoolCreated will always fail (zero liquidity). Must listen for Mint/IncreaseLiquidity events as the actual trade signal.

6. **Double-sell race condition (Phase 1 + Phase 4)** -- The existing race condition between stop-loss and take-profit multiplies with multi-chain (4x) and smart exits (3-4 monitors per position). A position state machine with per-position mutex is non-negotiable.

7. **SQLite migration preserving in-memory anti-pattern (Phase 1)** -- If the migration keeps the read-all-into-memory/flush-to-disk pattern, concurrency bugs persist. SQLite must be the source of truth -- no module-level state cache, no `persist()` function, every read/write goes through SQL.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation -- Bug Fixes, ethers v6, SQLite, Logging

**Rationale:** The existing bot has bugs that will lose money (double-sell race condition, disabled sell simulation, broken Flashbots nonce). Building new features on top of these bugs creates compounding problems. ethers v6 is a prerequisite for everything else (V3 SDK expects v6, Flashbots v1.0.0 requires v6, don't build chain abstractions on EOL library). SQLite is a prerequisite for risk management, P&L tracking, and the dashboard.

**Delivers:** A hardened, reliable single-chain bot on modern infrastructure.

**Features addressed:** Fix race conditions, re-enable sell simulation, graceful shutdown, startup validation, ethers v5->v6 migration, SQLite storage with audit trail, structured logging, singleton provider pattern, centralized ABIs.

**Pitfalls to avoid:** BigInt precision loss (all arithmetic stays BigInt), Flashbots version mismatch (atomic upgrade), SQLite in-memory anti-pattern (no state cache), double-sell race condition (position mutex).

### Phase 2: Multi-Chain Architecture

**Rationale:** Multi-chain is the largest planned feature and the primary value multiplier (4x opportunity surface). It depends on the Phase 1 foundation (ethers v6, SQLite, graceful shutdown). The chain abstraction layer must be designed once and correctly -- retrofitting per-chain behaviors is a rewrite.

**Delivers:** Concurrent sniping on ETH, BSC, Base, and Arbitrum with per-chain MEV protection.

**Features addressed:** Chain abstraction layer, per-chain config, concurrent listeners, per-chain MEV protection (Flashbots on ETH, Merkle/Blink private RPC on BSC/Base/Arbitrum), per-chain nonce management, chain-aware notifications.

**Pitfalls to avoid:** Treating chains as identical (behavioral strategies, not just config), hardcoded Etherscan links (chain-aware explorer URLs), per-chain MEV strategy (never silently fall back to public mempool), nonce collision across concurrent monitors.

**Uses:** Chain Registry pattern, Provider Singleton Registry, Strategy pattern for executors.

### Phase 3: Uniswap V3 Integration

**Rationale:** V3 is where increasing launch volume is going. Can be developed on Ethereum first, then extended to other chains via the Phase 2 abstraction layer. Independent of multi-chain in terms of logic, but benefits from the chain-aware architecture.

**Delivers:** Detection and sniping of V3 pool launches across all supported chains and fee tiers.

**Features addressed:** V3 PoolCreated event detection, fee tier discovery, V3-aware price monitoring (sqrtPriceX96 / Quoter contract), V3 SwapRouter integration, dual V2+V3 safety pipeline.

**Pitfalls to avoid:** Fee tier blindness (query all 4 tiers, select deepest liquidity), pool creation vs. liquidity timing gap (listen for Mint events, not just PoolCreated), using V2 getAmountsOut for V3 prices (use V3 Quoter contract).

**Uses:** @uniswap/v3-sdk (if compatible) or raw ABI approach, V3 Factory + NonfungiblePositionManager ABIs.

### Phase 4: Smart Exits + Risk Management

**Rationale:** Once the bot reliably detects and executes snipes across chains and DEX versions, the next value unlock is intelligent position management. Trailing stops and partial takes are what separate a profitable bot from one that wins trades but loses money overall. Risk management (daily loss limits, position caps) prevents catastrophic failure.

**Delivers:** Sophisticated exit strategies and portfolio-level risk controls.

**Features addressed:** Trailing stop-loss, partial take-profit at configurable tiers, daily loss limit / circuit breaker, max open positions limit, cooldown between snipes, max position sizing.

**Pitfalls to avoid:** Exit monitor cancellation (trailing stop must cancel when position exits via other strategy), daily loss limit must aggregate across ALL chains, exit strategies must coordinate through position state machine.

**Uses:** Position State Machine (extended from Phase 1 mutex), SQLite P&L queries, Exit Strategy Engine with pluggable strategies.

### Phase 5: Web Dashboard

**Rationale:** With multi-chain, V3, and smart exits operational, the Telegram notification channel becomes insufficient for monitoring complexity. The dashboard provides real-time visibility and control that Telegram cannot. Depends on SQLite (historical data), position management (state to display), and multi-chain (chain status).

**Delivers:** Real-time web interface for monitoring positions, P&L, chain status, and bot controls.

**Features addressed:** Real-time position display, historical trade log, bot controls (start/stop per chain), risk dashboard, live notification feed, health check HTTP endpoint.

**Pitfalls to avoid:** Stale data on WebSocket disconnect (heartbeat + connection indicator), raw wei values in UI (format everything), missing authentication (at minimum password/token protection), dashboard controls without confirmation (prevent accidental stops).

**Uses:** Hono + @hono/node-ws, React + Vite + TanStack Query + Zustand, Recharts, Tailwind CSS.

### Phase 6: Testing Infrastructure

**Rationale:** Listed last not because it is least important, but because tests should be written alongside each phase. This phase covers the comprehensive test suite that validates the full integrated system.

**Delivers:** Unit tests for safety pipeline, integration tests for execution, mainnet fork tests for end-to-end scenarios.

**Features addressed:** Unit tests for all 9 safety checks, storage concurrency tests, Flashbots integration tests, stop-loss/take-profit monitoring tests, mainnet fork snipe simulations.

**Uses:** Vitest 4, Hardhat Network mainnet forking.

### Phase Ordering Rationale

- **Phase 1 before everything:** ethers v6 is a hard prerequisite for V3 SDK, Flashbots v1.0.0, and building abstractions on a supported library. SQLite is a prerequisite for risk management and the dashboard. Bug fixes prevent money loss.
- **Phase 2 before Phase 3:** The chain abstraction layer must exist before V3 integration so V3 can be built chain-agnostically from the start rather than retrofitted.
- **Phase 3 before Phase 4:** Smart exits need to work with both V2 and V3 positions. Building V3 first means exit strategies are designed for both from day one.
- **Phase 4 before Phase 5:** The dashboard needs something meaningful to display. Risk metrics, exit strategies, and multi-chain positions give it value.
- **Phase 6 throughout:** Tests should be written per-phase, but the comprehensive integration suite comes after all features exist.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Multi-Chain):** BSC MEV protection landscape changes rapidly. Verify Merkle/Blink endpoint availability and pricing on each target chain. Also verify L2 gas estimation patterns (Arbitrum L1+L2 composite fees, Base sequencer pricing).
- **Phase 3 (V3 Integration):** The @uniswap/v3-sdk may have ethers v5 internal dependencies. Needs investigation at implementation time -- may need to use raw ABI approach for all V3 interactions and copy tick math utilities from SDK source.
- **Phase 5 (Dashboard):** Dashboard authentication and authorization model needs definition. Single-user vs. potential multi-user, API key vs. session-based auth.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** ethers v6 migration has extensive official documentation and community guides. SQLite + Drizzle has established patterns. Bug fixes are well-documented in CONCERNS.md.
- **Phase 4 (Smart Exits):** Trailing stops, partial takes, and circuit breakers are well-documented patterns from 3Commas, Cornix, and traditional trading systems.
- **Phase 6 (Testing):** Vitest + Hardhat Network forking is a standard setup with good documentation.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommended packages verified on npm with specific versions. ethers v6 migration guide is official. Compatibility matrix cross-checked. Only uncertainty: Uniswap V3 SDK internal ethers v5 dependency (workaround documented). |
| Features | HIGH | Feature landscape validated against Banana Gun, Maestro, and Unibot. Existing codebase bugs confirmed by code review. Prioritization based on both competitive analysis and dependency ordering. |
| Architecture | HIGH | Layered architecture with chain registry, event bus, and position state machine follows production trading bot patterns. Anti-patterns identified from existing codebase analysis. Build order derived from dependency graph. |
| Pitfalls | HIGH | All critical pitfalls verified against official documentation (ethers migration guide, Uniswap V3 docs, Flashbots docs) and existing codebase bugs (CONCERNS.md). Specific line numbers cited for current bugs. |

**Overall confidence:** HIGH

### Gaps to Address

- **Uniswap V3 SDK ethers compatibility:** The V3 SDK may require ethers v5 internally. Decision needed at Phase 3: use SDK with isolated v5 peer dep, or use raw ABI approach. Recommend defaulting to raw ABI for event listening and only pulling in SDK if complex tick math is needed.
- **BSC MEV protection provider availability:** Merkle and Blink are recommended but their specific API terms, rate limits, and pricing need validation before Phase 2 implementation. bloXroute is an alternative but requires paid API key.
- **Honeypot API chain coverage:** Honeypot.is primarily supports Ethereum. BSC may need Go+ Security API instead. Other chains may have no reliable honeypot detection API -- on-chain sell simulation becomes the primary safety gate.
- **L2 gas estimation:** Arbitrum and Base have composite L1+L2 fee structures that differ from Ethereum's EIP-1559 model. Exact gas estimation patterns need validation during Phase 2 implementation.
- **Dashboard authentication model:** Not yet decided. Hono supports middleware for auth, but the scope (single-user password vs. token-based) needs definition before Phase 5.

## Sources

### Primary (HIGH confidence)
- [ethers.js v6 Migration Guide](https://docs.ethers.org/v6/migrating/) -- breaking changes, BigInt migration patterns
- [Uniswap V3 Factory Interface](https://docs.uniswap.org/contracts/v3/reference/core/interfaces/IUniswapV3Factory) -- PoolCreated event specification
- [Uniswap V3 Concentrated Liquidity](https://docs.uniswap.org/concepts/protocol/concentrated-liquidity) -- fee tiers, tick ranges, pool lifecycle
- [Flashbots Protect Overview](https://docs.flashbots.net/flashbots-protect/overview) -- ETH MEV protection
- [@flashbots/ethers-provider-bundle npm](https://www.npmjs.com/package/@flashbots/ethers-provider-bundle) -- v1.0.0 ethers v6 compatibility
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) -- WAL mode, performance characteristics
- [Drizzle ORM SQLite docs](https://orm.drizzle.team/docs/get-started-sqlite) -- better-sqlite3 driver setup
- [Hono docs](https://hono.dev/docs) -- WebSocket helper, middleware patterns
- [Uniswap V2/V3 Deployment Addresses](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments) -- official contract addresses per chain

### Secondary (MEDIUM confidence)
- [Merkle MEV Protection](https://www.merkle.io/) -- BSC, Base, Arbitrum MEV-protected RPC coverage
- [Alchemy MEV Protection docs](https://www.alchemy.com/docs/reference/mev-protection) -- multi-chain MEV protection
- [Arbitrum Timeboost](https://docs.arbitrum.io/how-arbitrum-works/timeboost/gentle-introduction) -- Arbitrum sequencer MEV mechanism
- [bloXroute BSC Protect RPC](https://docs.bloxroute.com/evm-networks-bsc-eth/protect-rpcs/bsc-protect-rpc) -- BSC private transaction submission
- [CryptoNews - Best Crypto Sniper Bots March 2026](https://cryptonews.com/cryptocurrency/best-crypto-sniper-bots/) -- competitive feature landscape
- [PancakeSwap V2/V3 Addresses](https://developer.pancakeswap.finance/contracts/v3/addresses) -- BSC DEX contract addresses

### Tertiary (LOW confidence)
- [Recharts](https://recharts.org/) -- dashboard charting library selection (alternatives exist)
- Honeypot.is multi-chain support -- API documentation sparse, actual chain coverage needs runtime verification
- Uniswap V3 SDK ethers v6 compatibility -- npm page does not clearly state ethers version requirements

---
*Research completed: 2026-03-19*
*Ready for roadmap: yes*
