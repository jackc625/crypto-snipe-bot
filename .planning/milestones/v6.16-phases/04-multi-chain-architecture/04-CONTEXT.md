# Phase 4: Multi-Chain Architecture - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a chain abstraction layer so the bot detects and snipes new V2 token listings concurrently across ETH, BSC, Base, and Arbitrum with per-chain MEV protection. Each chain has its own configuration, DEX list, MEV strategy, capital budget, and safety API routing. No new token analysis capabilities or exit strategies — only extending the existing single-chain bot to operate across multiple chains simultaneously.

</domain>

<decisions>
## Implementation Decisions

### Chain configuration model
- **D-01:** Chain registry object in `config.ts` mapping chainId to a typed `ChainConfig` — RPC URLs, contract addresses, gas config, MEV strategy, DEX list, safety API providers, capital limits, and enabled flag. Single source of truth for all chain-specific settings.
- **D-02:** `ENABLED_CHAINS` env var (comma-separated chain names) controls which chains are active at startup. Chains not listed are ignored. RPC URLs come from per-chain env vars (`ETH_RPC_URL`, `BSC_RPC_URL`, etc.) — secrets in env, constants in code.
- **D-03:** Multi-DEX per chain — each `ChainConfig` has a `dexes[]` array with factory/router address pairs. Listener spawns per-DEX. Covers Uniswap + SushiSwap on ETH, PancakeSwap + BiSwap on BSC, etc.
- **D-04:** WebSocket primary for event detection (`WebSocketProvider` for `PairCreated` subscriptions). HTTP `JsonRpcProvider` as fallback for chains with unreliable WebSocket support. WS URL comes from per-chain env var (`ETH_WS_URL`, `BSC_WS_URL`, etc.).

### MEV protection strategy
- **D-05:** Chain-specific MEV services — integrate each chain's native MEV protection: Flashbots bundles on ETH (already built), bloXroute BDN SDK on BSC, Flashbots Protect RPC on Base, direct sequencer submission on Arbitrum (no MEV needed). Each service integrated with its native API, not just a private RPC URL swap.
- **D-06:** Skip snipe on MEV failure — if a chain's MEV service is unavailable after retries, the snipe is rejected entirely. Never trade unprotected. Log warning + Telegram alert with chain and failure reason.
- **D-07:** Startup MEV health check — on boot, verify each enabled chain's MEV service responds. Warn loudly if unreachable but still start the bot (other chains work). Periodic re-check every 5 minutes detects mid-run service outages.

### Capital allocation
- **D-08:** Fixed budget per chain via env vars (`ETH_MAX_CAPITAL`, `BSC_MAX_CAPITAL`, etc.). Each chain operates independently within its budget. No cross-chain capital logic. Dynamic allocation deferred to a future phase.
- **D-09:** Per-chain snipe amount in native currency — each `ChainConfig` has `snipeAmount` (per-trade size) and `maxCapital` (total deployment cap). Different chains have vastly different gas costs and token economics, so a global snipe amount doesn't make sense.

### Listener architecture
- **D-10:** Async per-chain loops in a single Node.js process. Each chain+DEX gets its own WebSocket subscription running concurrently via async event handlers. Node's event loop handles concurrency naturally — the snipe pipeline is 99% async I/O (RPC calls, API requests, tx submission). No worker threads or separate processes.
- **D-11:** Auto-reconnect with exponential backoff on WebSocket disconnect — 1s, 2s, 4s, 8s... capped at 60s. Uses existing `retry.ts` pattern. Telegram alert on disconnect and reconnect. Other chains unaffected by one chain's disconnection.
- **D-12:** Chain prefix in Telegram messages — every alert prepended with `[ETH]`, `[BSC]`, `[BASE]`, `[ARB]` for at-a-glance chain identification. Single Telegram chat for all chains.
- **D-13:** Per-chain API routing for token safety pipeline — chain config maps each safety check to its API provider. ETH uses honeypot.is + Unicrypt for liquidity lock checks. BSC uses Go+ Security API + Mudra locker. Chain-specific fallbacks when primary API is unavailable.

### Claude's Discretion
- Exact `ChainConfig` TypeScript interface structure and field names
- WebSocket reconnect implementation details (event-based vs wrapper class)
- bloXroute SDK integration specifics (authentication, bundle format)
- How to refactor `bot.ts` to accept chain context (parameter injection vs module-level chain state)
- Safety API adapter pattern (strategy pattern, config-driven dispatch, or per-chain function)
- Boot sequence ordering (validate config, check MEV, start listeners)
- How to handle the existing `addresses.json` (migrate into registry or keep as ETH defaults)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` -- CHAIN-01 through CHAIN-05 define all multi-chain requirements

### Current implementation (being extended)
- `src/config.ts` -- Current flat CONFIG with single-network `rpc` map and `addresses.json` spread. Must evolve into chain registry
- `src/utils/provider.ts` -- Singleton provider cache keyed by network name. Must extend to support WebSocket providers and multi-chain
- `src/bot.ts` -- Current single-chain `startBot()` and `handleNewPair()`. Must accept chain context for multi-chain operation
- `src/utils/txManager.ts` -- Current Flashbots-only `sendTxWithRetry()`. Must route to chain-specific MEV service
- `src/utils/flashbots.ts` -- Current Flashbots provider init. Becomes one MEV strategy among several
- `src/utils/tokenSafety.ts` -- Current 9-stage pipeline with hardcoded API endpoints. Must become chain-aware with per-chain API routing
- `src/utils/notifier.ts` -- `sendTelegramAlert()` needs chain prefix injection
- `src/addresses.json` -- Single-chain contract addresses. Will be absorbed into chain registry

### Prior phase context
- `.planning/phases/01-bug-fixes-hardening/01-CONTEXT.md` -- Flashbots relay uses Record<string, {url, network}> map for easy network extension, per-token mutex for exit conflicts
- `.planning/phases/02-ethers-v6-migration/02-CONTEXT.md` -- ethers v6 patterns, BigInt arithmetic, WebSocketProvider available in v6
- `.planning/phases/03-sqlite-storage-code-quality/03-CONTEXT.md` -- SQLite sole source of truth, trades table has chain column, pino structured logging, singleton provider pattern

### Codebase analysis
- `.planning/codebase/ARCHITECTURE.md` -- Event-driven architecture, data flow, layer responsibilities
- `.planning/codebase/STRUCTURE.md` -- Directory layout, where to add new code, naming conventions
- `.planning/codebase/CONVENTIONS.md` -- Code patterns to maintain during refactoring
- `.planning/codebase/CONCERNS.md` -- Known issues including honeypot API chain coverage gaps

### Research concerns (from STATE.md)
- BSC MEV protection provider availability (Merkle/Blink) needs runtime verification
- Honeypot API chain coverage varies -- BSC may need Go+ Security API alternative

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/provider.ts`: Singleton provider cache with `getProvider(network?)` and `getWallet(network?)` -- foundation for multi-chain provider management, needs WebSocket support added
- `src/utils/retry.ts`: Exponential backoff retry -- reuse for WebSocket reconnect and MEV health checks
- `src/utils/notifier.ts`: `sendTelegramAlert()` -- wrap with chain prefix injection
- `src/utils/flashbots.ts`: Flashbots provider init -- becomes the ETH MEV strategy implementation
- `src/utils/db.ts`: SQLite with WAL mode and trades table including chain column -- already multi-chain ready for storage

### Established Patterns
- Config via env vars in `config.ts` with dotenv -- new per-chain env vars follow this pattern
- Singleton provider cache keyed by network name -- extend for WS providers
- Flashbots relay config uses Record<string, {url, network}> map -- MEV strategy routing follows similar pattern
- Structured JSON logging with pino -- chain field added to log context per listener
- Named exports, camelCase files, no barrel files

### Integration Points
- `startBot()` in `bot.ts` -- must be refactored to accept chain+DEX context and spawn multiple listeners
- `handleNewPair()` in `bot.ts` -- must receive chain context to route through correct MEV service and safety APIs
- `sendTxWithRetry()` in `txManager.ts` -- must dispatch to correct MEV strategy based on chain config
- `tokenSafety.ts` functions -- must accept chain context to call correct API providers
- SQLite trades table -- already has chain column, queries need chain-aware filtering

</code_context>

<specifics>
## Specific Ideas

- MEV protection is non-negotiable: skip the snipe entirely if MEV service is down, never trade unprotected on any chain
- Startup health check pattern for MEV services with periodic re-check (every 5 min) to detect mid-run outages
- Token safety APIs differ significantly by chain -- honeypot.is doesn't cover BSC well, Go+ Security API is the BSC alternative

</specifics>

<deferred>
## Deferred Ideas

- Dynamic capital allocation based on opportunity quality signals (CHAIN-05 partially deferred) -- add as enhancement once multi-chain is stable with fixed budgets
- Cross-chain position correlation (detect coordinated rug pulls) -- v2 requirement ARISK-02
- Separate Telegram chats per chain -- revisit if single-chat notification volume becomes overwhelming
- WebSocket provider for chains with unreliable WS -- HTTP polling fallback is in scope, but automatic WS→HTTP failover logic complexity deferred if not straightforward

</deferred>

---

*Phase: 04-multi-chain-architecture*
*Context gathered: 2026-03-22*
