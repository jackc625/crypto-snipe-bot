# Crypto Snipe Bot

## What This Is

A multi-chain MEV sniper bot that detects new token listings on decentralized exchanges (Uniswap V2/V3 and forks like PancakeSwap, SushiSwap), validates token safety through a multi-stage pipeline, executes snipes with MEV protection, and manages positions with intelligent exit strategies. Includes a web dashboard for real-time monitoring and control.

## Core Value

Reliably detect, validate, and profitably snipe new token listings across multiple EVM chains with proper risk management — the bot must never lose money to preventable bugs, race conditions, or security flaws.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from existing codebase. -->

- ✓ Factory event listener detects PairCreated events on Uniswap V2 — existing
- ✓ 9-stage token safety validation pipeline (honeypot, blacklist, liquidity, tax, metadata, etc.) — existing
- ✓ Flashbots MEV-protected transaction submission with retry — existing
- ✓ Telegram alpha signal listener parses contract addresses from channel messages — existing
- ✓ Position monitoring with stop-loss, take-profit, and timed sell — existing
- ✓ Telegram bot notifications for snipe events, sells, and errors — existing
- ✓ File-based state persistence for sniped token tracking — existing
- ✓ Blocklist registry for known bad tokens, pairs, and creators — existing
- ✓ Gas fee calculation with configurable multiplier — existing
- ✓ Exponential backoff retry utility for API calls — existing

### Active

<!-- Current scope. Building toward these. -->

**Bug Fixes & Hardening** — Validated in Phase 01: bug-fixes-hardening
- [x] Fix race condition: stop-loss and take-profit can fire simultaneously on same token
- [x] Fix race condition: concurrent storage writes can overwrite each other
- [x] Fix Flashbots relay hardcoded to mainnet even when running on Sepolia/testnet
- [x] Fix nonce never incrementing on Flashbots retry — all retries fail after first
- [x] Add graceful shutdown with signal handlers (SIGTERM, SIGINT) to clear all intervals/timeouts
- [x] Fix timed sell timeout not cancelled when position already sold via stop-loss/take-profit
- [x] Fix monitoring loops continuing when wallet balance reaches zero
- [x] Re-enable disabled sell simulation safety check (currently marked TEMPORARY)

**Security**
- [x] Add startup validation for all required environment variables with helpful error messages — Validated in Phase 01
- [ ] Validate RPC endpoint chain ID matches expected network on startup
- [x] Add Telegram sender whitelist to restrict who can trigger alpha drops — Validated in Phase 01
- [ ] Sanitize API keys and private keys from error log output
- [ ] Validate Flashbots auth key exists before attempting bundle submission

**Infrastructure — ethers v6 Migration** — Validated in Phase 02: ethers-v6-migration
- [x] Migrate from ethers v5 to v6 (BigNumber → native BigInt, updated provider API)

**Infrastructure — SQLite Storage** — Validated in Phase 03: sqlite-storage-code-quality
- [x] Replace JSON file storage with SQLite for atomic writes, proper transactions, and concurrency
- [x] Implement transaction audit trail with full history (buys, sells, P&L per token)
- [x] Structured JSON logging with pino replacing all console.log/warn/error
- [x] Singleton provider cache per chain, centralized ABI module

**Infrastructure — Multi-Chain** — Validated in Phase 04: multi-chain-architecture
- [x] Build chain abstraction layer supporting ETH, BSC, Base, Arbitrum simultaneously
- [x] Per-chain configuration (RPC endpoints, contract addresses, gas strategies)
- [x] Concurrent operation across all configured chains
- [x] Per-chain MEV protection (Flashbots on ETH, bloXroute on BSC, passthrough on Base/Arbitrum)
- [ ] Dynamic capital allocation across chains based on opportunity quality and activity (fixed budgets implemented; dynamic allocation deferred)

**DEX Support — Uniswap V3** — Validated in Phase 05: uniswap-v3-integration
- [x] Detect new V3 pool creation events across supported chains
- [x] Handle concentrated liquidity positions, tick ranges, and fee tiers
- [x] V3-aware price monitoring for position management
- [x] Support both V2 and V3 pool types in the same token safety pipeline

**Risk Management** — Validated in Phase 06: risk-management
- [x] Configurable max position size per snipe (cap ETH/BNB per trade)
- [x] Daily loss limit — halt sniping after X% portfolio loss in 24h
- [x] Max open positions limit across all chains
- [x] Cooldown periods between snipes to prevent overtrading
- [x] Portfolio-level exposure tracking

**Smart Exit Strategies** — Validated in Phase 07: smart-exit-strategies
- [x] Trailing stop-loss: lock in profits as price rises, sell on pullback
- [x] Partial sells at configurable price targets (e.g., 50% at 2x, 25% at 5x, rest trails)
- [x] Dynamic take-profit/stop-loss adjusted based on token volatility and volume
- [x] Time-weighted exit urgency — escalate exit pressure as position ages

**Monitoring & Observability**
- [ ] Structured logging with log levels replacing console.log/emoji
- [ ] HTTP health check endpoint exposing bot liveness, chain status, positions
- [ ] Centralize ABI definitions (remove inline duplication)
- [ ] Singleton provider pattern (eliminate redundant provider instantiation)

**Web Dashboard**
- [ ] Real-time display of open positions, P&L, and chain status
- [ ] Historical trade log with filtering and search
- [ ] Bot controls (start/stop per chain, adjust parameters)
- [ ] Risk dashboard showing exposure, daily P&L, position limits
- [ ] Live notifications feed

**Testing**
- [ ] Unit tests for token safety pipeline (all 9 checks + fallback paths)
- [ ] Unit tests for storage concurrency and state management
- [ ] Integration tests for Flashbots bundle submission and retry logic
- [ ] Integration tests for stop-loss/take-profit/timed sell monitoring
- [ ] Mainnet fork tests simulating realistic snipe scenarios end-to-end

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Mobile app — web dashboard is sufficient; mobile adds complexity without core value
- Centralized exchange integration — this is a DEX sniper, CEX is a different product
- Copy trading / social trading — not relevant to automated sniping
- Arbitrage strategies — focus is on new token sniping, not cross-DEX arb
- Limit orders / manual trading — the bot is fully automated; manual trading is out of scope

## Context

The bot currently runs on Ethereum Sepolia testnet with deployed test contracts (FakeToken, UniswapV2Factory, UniswapV2Router02). It has two entry points: the blockchain event listener (`src/bot.ts`) and the Telegram listener (`src/telegramListener.ts`). The codebase uses ethers v5 (EOL), has no tests, and several known bugs documented in `.planning/codebase/CONCERNS.md`. The architecture is modular with a utility layer but lacks abstractions for multi-chain support. Flashbots integration exists but has bugs (hardcoded network, broken nonce management).

The Telegram integration serves dual purposes: listening for alpha signals (contract addresses mentioned in channels) and sending notifications via bot API. Authentication uses MTProto session strings generated via a setup script.

## Constraints

- **Tech stack**: TypeScript, Node.js 18+, ethers v6, Hardhat for contracts
- **Storage**: SQLite (migrating from JSON file) — must remain local, no cloud database
- **MEV Protection**: Must use Flashbots on ETH; support chain-specific private transaction mechanisms elsewhere
- **Security**: Private keys via environment variables — no cloud secrets manager required but env validation is mandatory
- **Backwards compatibility**: None required — this is a breaking overhaul of the existing bot

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Migrate ethers v5 → v6 | v5 is EOL, v6 uses native BigInt, ecosystem moving forward | ✓ Complete (Phase 02) |
| SQLite over JSON storage | Need atomic writes, concurrency control, and query capability | ✓ Complete (Phase 03) |
| Multi-chain from day one | ETH, BSC, Base, Arbitrum all targeted — build the abstraction early | ✓ Complete (Phase 04) |
| Full Uniswap V3 support | Concentrated liquidity is where volume is going — not just detection | ✓ Complete (Phase 05) |
| DB-backed risk management | 5-rule canSnipe() gate replaces in-memory capital tracking — position size, daily loss, max positions, cooldown, exposure cap | ✓ Complete (Phase 06) |
| Unified exit engine | Single 5s poll loop per position replaces 6 legacy monitors — trailing stop, partial sells, volatility adaptation, urgency in one function | ✓ Complete (Phase 07) |
| Web dashboard over CLI | Need real-time position visibility and control beyond Telegram alerts | — Pending |
| Dynamic capital allocation | Smarter than fixed per-chain budgets — allocate based on opportunity quality | Partial (fixed budgets in Phase 04, dynamic deferred) |
| Both Flashbots + private RPCs | Different chains have different MEV protection options — support both | ✓ Complete (Phase 04) |

---
*Last updated: 2026-03-28 after Phase 09 completion (testing infrastructure — 184 tests across unit/integration/fork tiers, vitest three-project config, GitHub Actions CI)*
