# Stack Research

**Domain:** Multi-chain EVM sniper bot with web dashboard
**Researched:** 2026-03-19
**Confidence:** HIGH (core stack), MEDIUM (dashboard specifics)

## Context

This research covers technologies needed to **extend** an existing Ethereum sniper bot. The current stack (ethers v5, JSON file storage, Hardhat, single-chain) is documented in `.planning/codebase/STACK.md`. This document focuses on what changes and additions are needed for the milestone: ethers v6 migration, SQLite storage, multi-chain support, Uniswap V3, web dashboard, and risk management.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| ethers.js | 6.16.0 | Blockchain interaction, wallets, contracts | Native BigInt (no more BigNumber wrappers), modern JS target, active maintenance. v5 is EOL. The project is already on ethers -- switching to viem mid-project would be a full rewrite of every contract interaction for marginal gain. | HIGH |
| better-sqlite3 | 12.8.0 | Local SQLite database driver | Synchronous API eliminates callback complexity for a bot that needs atomic writes. Fastest Node.js SQLite driver. No async overhead for simple read/write patterns a trading bot needs. | HIGH |
| Drizzle ORM | 0.45.1 | Type-safe database query layer | Lightweight (~7.4kb), zero dependencies, TypeScript-first schema definitions, works with better-sqlite3 driver. Provides migrations via drizzle-kit without heavy ORM overhead. Far lighter than Prisma. | HIGH |
| @flashbots/ethers-provider-bundle | 1.0.0 | MEV-protected transaction submission (Ethereum) | v1.0.0 supports ethers v6 natively. Already used in the project (upgrading from 0.6.1 which was ethers v5). Only option for Flashbots bundle submission from JS. | HIGH |
| @uniswap/v3-sdk | 3.29.2 | Uniswap V3 pool math and position management | Official SDK for V3 concentrated liquidity calculations, tick math, fee tier handling. Required for V3 swap encoding and price computation. | HIGH |
| @uniswap/sdk-core | ~latest | Token/currency abstractions shared across V2/V3 | Required peer dependency of v3-sdk. Provides chain-agnostic Token, CurrencyAmount, and Price classes. | HIGH |
| Hono | 4.12.8 | HTTP API server for dashboard backend | Ultra-lightweight (14kb), TypeScript-first, built-in WebSocket support via helpers. Faster than Express, simpler than Fastify. Perfect for a bot that needs a small API surface -- not a full web app framework. | MEDIUM |
| @hono/node-ws | 1.3.0 | WebSocket support for Hono on Node.js | Required adapter to use Hono's WebSocket helper on Node.js runtime. Enables real-time position/P&L streaming to dashboard. | MEDIUM |
| ws | 8.19.0 | WebSocket client/server (underlying) | Peer dependency of @hono/node-ws. Battle-tested WebSocket implementation for Node.js. | HIGH |
| Pino | 10.3.1 | Structured JSON logging | Replaces console.log/emoji pattern. Uses worker threads for zero-overhead log transport. Standard for production Node.js. Structured JSON output enables log aggregation and filtering. | HIGH |

### Dashboard Frontend

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| React | 19.2.4 | Dashboard UI framework | Industry standard, massive ecosystem, team likely already knows it. v19 has improved Suspense and streaming -- useful for real-time data display. | MEDIUM |
| Vite | 8.0.1 | Frontend build tool | Rolldown-based bundler (10-30x faster builds), HMR for development. The standard build tool for React in 2026. | MEDIUM |
| TanStack Query | 5.91.0 | Server state management (API data fetching) | Handles caching, refetching, stale data, and real-time updates for dashboard API calls. Eliminates manual fetch/cache logic. | MEDIUM |
| Zustand | 5.0.12 | Client state management | Minimal API, no boilerplate, handles local UI state (selected chain, filter settings, dashboard panels). Pairs perfectly with TanStack Query (server state + client state separation). | MEDIUM |
| Recharts | ~2.15 | Charts for P&L, portfolio exposure, price history | Built on D3 with React-native API. Good enough for internal dashboards. Tremor is prettier but adds abstraction without value for a personal tool. | LOW |
| Tailwind CSS | 4.2.1 | Utility-first CSS styling | v4 has CSS-first config (no tailwind.config.js needed), faster builds. Rapid UI development for a dashboard that prioritizes function over design polish. | MEDIUM |

### Testing

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Vitest | 4.1.0 | Unit and integration test runner | Vite-native, TypeScript-first, Jest-compatible API. Replaces the current Mocha/Chai/Waffle setup which is outdated. 10-20x faster than Jest. | HIGH |
| Hardhat Network | (via Hardhat) | Mainnet fork testing | Fork mainnet/testnet state for realistic snipe simulation. Already in the project -- keep using it for contract-level tests. | HIGH |

### Development Tools

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| @nomicfoundation/hardhat-toolbox | 6.1.0 | Bundled Hardhat plugins for ethers v6 | Replaces the current v2.x toolbox. Includes hardhat-ethers v3+ which supports ethers v6. |
| @nomicfoundation/hardhat-ethers | 4.0.4 | Ethers v6 integration for Hardhat | Replaces the old @nomiclabs/hardhat-ethers (ethers v5). |
| drizzle-kit | ~latest | Database migration tooling | Generates and runs SQLite schema migrations from Drizzle schema files. |
| @typechain/ethers-v6 | ~latest | Type-safe contract bindings for ethers v6 | Replaces @typechain/ethers-v5. Generates typed wrappers from ABIs. |
| dotenv | 17.2.0 | Environment variable loading | Already in the project, keep it. |
| tsx | ~latest | TypeScript execution (replaces ts-node) | Faster startup than ts-node, ESM-native, better for running bot scripts. |

---

## Multi-Chain Architecture Stack

The multi-chain requirement is primarily an **architecture pattern**, not a new library. Here is the technology approach per chain:

### Chain-Specific Configuration

| Chain | RPC Provider | MEV Protection | DEX Factory | Gas Strategy |
|-------|-------------|----------------|-------------|--------------|
| Ethereum | Alchemy / Infura | Flashbots bundles (@flashbots/ethers-provider-bundle) | Uniswap V2/V3 Factory | EIP-1559 with priority fee |
| BSC | QuickNode / Ankr | Private RPC (Merkle/Blink MEV protection) | PancakeSwap V2/V3 Factory | Legacy gas pricing |
| Base | Alchemy / QuickNode | Private mempool (Base has no public mempool) | Uniswap V2/V3 Factory (same contracts) | EIP-1559 L2 pricing |
| Arbitrum | Alchemy / Infura | Timeboost (Arbitrum's native MEV mechanism) | Uniswap V2/V3 Factory, Camelot | EIP-1559 L2 pricing |

### MEV Protection Approach

Rather than adding chain-specific MEV libraries, use **MEV-protected RPC endpoints**:

| Provider | Chains Covered | How It Works |
|----------|---------------|--------------|
| Merkle (Blink) | ETH, BSC, Base, Arbitrum | Private mempool routing. Transactions never hit public mempool. Drop-in RPC URL replacement. |
| Alchemy MEV Protect | ETH, Base, Arbitrum | Built-in to Alchemy RPC endpoints. No code changes. |
| Flashbots Protect RPC | ETH only | `https://rpc.flashbots.net` as RPC URL for simple protection without bundle API. |

**Recommendation:** Use Flashbots bundle API for Ethereum (keep existing pattern, upgrade to v1.0.0 for ethers v6). For BSC, Base, Arbitrum, use MEV-protected RPC endpoints from Merkle or Alchemy -- no additional libraries needed, just different RPC URLs per chain config.

**Confidence:** MEDIUM -- MEV protection landscape changes rapidly. Verify Merkle/Alchemy endpoint availability on each target chain before implementation.

---

## Installation

```bash
# Core -- ethers v6 migration (replaces ethers@5.7.2)
npm install ethers@6.16.0

# Flashbots -- ethers v6 compatible
npm install @flashbots/ethers-provider-bundle@1.0.0

# SQLite storage
npm install better-sqlite3@12.8.0 drizzle-orm@0.45.1

# Uniswap V3
npm install @uniswap/v3-sdk@3.29.2 @uniswap/sdk-core

# API server
npm install hono@4.12.8 @hono/node-server @hono/node-ws

# Structured logging
npm install pino@10.3.1

# Dev dependencies
npm install -D @types/better-sqlite3 drizzle-kit
npm install -D @nomicfoundation/hardhat-toolbox@6.1.0
npm install -D @nomicfoundation/hardhat-ethers@4.0.4
npm install -D @typechain/ethers-v6
npm install -D vitest@4.1.0

# Dashboard frontend (in dashboard/ subdirectory)
npm create vite@latest dashboard -- --template react-ts
cd dashboard
npm install @tanstack/react-query@5.91.0 zustand@5.0.12 recharts tailwindcss@4.2.1
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| ethers.js v6 | viem | New greenfield project with no ethers dependency. Viem has better TypeScript types and smaller bundle. But migrating an existing ethers v5 codebase to viem is a full rewrite of every contract interaction -- not justified here. |
| better-sqlite3 + Drizzle | Prisma | Full-stack web app where Prisma's auto-generated client and migration GUI add value. Overkill for a bot -- Prisma is heavy (~8MB), has cold start issues, and the query engine is unnecessary overhead. |
| better-sqlite3 + Drizzle | sql.js | Browser-only or WASM environments. Not applicable -- this is a Node.js server process. better-sqlite3 is 5-10x faster than sql.js on Node.js. |
| better-sqlite3 + Drizzle | Raw better-sqlite3 (no ORM) | Very simple schema with 2-3 tables and no migrations needed. The bot will have enough tables (positions, trades, chain_configs, audit_log) that Drizzle's schema management and type safety pay for themselves. |
| Hono | Express | Teams already standardized on Express with heavy middleware. Express is slower but has the largest middleware ecosystem. Not needed here -- the dashboard API is small. |
| Hono | Fastify | High-throughput API server with complex validation and serialization. Fastify's schema-based validation is nice but Hono is lighter and the bot API doesn't need it. |
| Pino | Winston | Projects needing complex log transports (email, Slack, custom destinations) out of the box. Winston is slower but more pluggable. Pino is 5x faster and structured JSON is sufficient for this use case. |
| Vitest | Jest | Projects with heavy Jest-specific config, snapshot testing, or existing Jest infrastructure. Vitest is faster and Vite-native. No reason to choose Jest for a new test setup. |
| Recharts | Tremor | Beautiful pre-built dashboard components with minimal code. But Tremor abstracts away customization, and is overkill for an internal monitoring tool. |
| React + Vite | Next.js | SSR, SEO, or full-stack web application. The dashboard is a single-user internal tool -- no SSR/SEO needed. Next.js adds complexity without value here. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| ethers v5 (5.7.2) | EOL, no security patches, BigNumber class is verbose and error-prone. The entire ecosystem (Hardhat, Flashbots, Typechain) has moved to v6. | ethers v6.16.0 |
| @nomiclabs/hardhat-ethers | Deprecated. Only works with ethers v5. | @nomicfoundation/hardhat-ethers 4.0.4 |
| @nomiclabs/hardhat-etherscan | Deprecated. Replaced by hardhat-verify in the toolbox. | @nomicfoundation/hardhat-toolbox 6.1.0 |
| ethereum-waffle | Deprecated and unmaintained. Was already struggling with ethers v5, has no v6 support. | @nomicfoundation/hardhat-chai-matchers (included in toolbox) |
| web3.js | Declining adoption, larger bundle, weaker TypeScript support than ethers or viem. Would require rewriting all existing contract interactions. | ethers v6 (already in use, just upgrade) |
| Prisma (for SQLite) | ~8MB overhead, query engine process, cold start penalty, generates client code. Massively over-engineered for a local bot storing trade history. | Drizzle ORM + better-sqlite3 |
| MongoDB / PostgreSQL | Requires running a separate database server. SQLite is embedded, zero-config, and sufficient for a single-process bot. No multi-user concurrency needed. | SQLite via better-sqlite3 |
| Socket.IO | Heavy abstraction over WebSockets with fallback transports (long polling) that are unnecessary in 2026. Adds 60kb+ to bundle. | Raw ws + Hono WebSocket helper |
| console.log / custom logger | Unstructured, no log levels, no JSON output, impossible to filter or aggregate. The current codebase uses emoji-laden console.log. | Pino structured logging |
| ts-node | Slow startup, ESM compatibility issues, requires additional tsconfig flags. | tsx (or Vitest for test execution) |

---

## Version Compatibility Matrix

These are critical compatibility constraints. Getting versions wrong will cause build failures.

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| ethers@6.16.0 | @flashbots/ethers-provider-bundle@1.0.0 | v1.0.0 requires ethers v6. The old 0.6.1 requires ethers v5 -- cannot mix. |
| ethers@6.16.0 | @nomicfoundation/hardhat-ethers@4.0.4 | hardhat-ethers v3+ supports ethers v6. The old @nomiclabs/hardhat-ethers does not. |
| ethers@6.16.0 | @typechain/ethers-v6 | Must use the v6-specific typechain target, not @typechain/ethers-v5. |
| @nomicfoundation/hardhat-toolbox@6.1.0 | hardhat@2.x (latest) | Toolbox v6 bundles all v6-compatible plugins. |
| better-sqlite3@12.8.0 | drizzle-orm@0.45.1 | Drizzle has a dedicated better-sqlite3 driver. Import from `drizzle-orm/better-sqlite3`. |
| drizzle-orm@0.45.1 | drizzle-kit@latest | drizzle-kit must match drizzle-orm minor version for migration compatibility. |
| @uniswap/v3-sdk@3.29.2 | ethers@6.x | Verify at implementation time -- v3-sdk historically used ethers v5 internally. May need ethers v5 as a peer dep or use ABI-only approach. |
| Vitest@4.1.0 | Vite@8.x | Vitest 4 supports Vite 8. Earlier Vitest versions may not. |
| React@19.2.4 | Vite@8.0.1 | Standard compatibility. Use @vitejs/plugin-react. |
| TanStack Query@5.91.0 | React@19.x | v5 supports React 19. |
| Zustand@5.0.12 | React@19.x | v5 supports React 19. |

### Critical Compatibility Warning

**@uniswap/v3-sdk and ethers version:** The Uniswap V3 SDK may still have internal ethers v5 dependencies. If so, you have two options:

1. **Use the SDK with ethers v5 as an isolated dependency** -- npm will handle version deduplication. Your code uses ethers v6, the SDK uses its own v5 internally.
2. **Skip the SDK for pool detection and swaps** -- use raw ABI + ethers v6 directly. The SDK is most useful for tick math and price calculations. For pool creation event listening, you only need the V3 Factory ABI (`PoolCreated` event), not the SDK.

**Recommendation:** Use raw ABI approach for event listening (PoolCreated detection) and only pull in the SDK if you need complex tick/liquidity math for position management. This avoids the ethers version conflict entirely.

---

## Stack Patterns by Variant

**If adding a new chain (e.g., Avalanche, Polygon):**
- No new libraries needed. Add chain config (RPC URL, factory addresses, gas strategy) to the chain abstraction layer.
- MEV protection: Check if Merkle/Alchemy support the chain, otherwise use the chain's native private RPC if available.

**If the dashboard needs authentication (multi-user):**
- Add jose (JWT library) for token-based auth. Avoid passport.js -- too heavy for a simple API.
- This is currently out of scope (single user), but the Hono middleware pattern makes it easy to add later.

**If you need historical price data for charts:**
- Use on-chain event logs (Swap events) queried via ethers v6 `queryFilter()`.
- Avoid adding a price API dependency (CoinGecko, CoinMarketCap) -- these rate-limit aggressively and are unreliable for newly listed tokens.

**If the Uniswap V3 SDK has ethers v5 conflicts:**
- Use raw contract ABI with ethers v6 for all V3 interactions.
- Copy tick math utilities from the SDK source into your own codebase (MIT licensed).
- This is the most robust approach and avoids dependency version conflicts.

---

## Migration Notes: ethers v5 to v6

Key changes that affect this codebase:

| v5 Pattern | v6 Replacement | Files Affected |
|------------|----------------|----------------|
| `ethers.BigNumber.from(x)` | `BigInt(x)` or just use `n` suffix literals | All files with amounts/gas |
| `value.add(value2)` | `value + value2` | Gas calculations, amounts |
| `value.eq(value2)` | `value === value2` | Comparisons in tokenSafety, bot |
| `ethers.utils.parseEther()` | `ethers.parseEther()` | Config, bot, txManager |
| `ethers.utils.formatEther()` | `ethers.formatEther()` | Logger, notifier |
| `new ethers.providers.JsonRpcProvider()` | `new ethers.JsonRpcProvider()` | Config, everywhere |
| `contract.callStatic.method()` | `contract.method.staticCall()` | tokenSafety, bot |
| `contract.address` | `await contract.getAddress()` (async) | All contract references |
| `ethers.constants.AddressZero` | `ethers.ZeroAddress` | Blocklist, tokenSafety |

---

## Sources

- [ethers.js npm](https://www.npmjs.com/package/ethers) -- v6.16.0 version verified
- [ethers v6 Migration Guide](https://docs.ethers.org/v6/migrating/) -- official breaking changes documentation
- [ethers v5 to v6 Migration Notes (GitHub)](https://github.com/ethers-io/ethers.js/issues/3795) -- community migration issues
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) -- v12.8.0 version verified
- [Drizzle ORM SQLite docs](https://orm.drizzle.team/docs/get-started-sqlite) -- better-sqlite3 driver setup
- [drizzle-orm npm](https://www.npmjs.com/package/drizzle-orm) -- v0.45.1 version verified
- [@flashbots/ethers-provider-bundle npm](https://www.npmjs.com/package/@flashbots/ethers-provider-bundle) -- v1.0.0 ethers v6 compatibility confirmed
- [Flashbots ethers.js Provider docs](https://docs.flashbots.net/flashbots-auction/libraries/ethers-js-provider) -- official usage guide
- [Uniswap V3 Factory (IUniswapV3Factory)](https://docs.uniswap.org/contracts/v3/reference/core/interfaces/IUniswapV3Factory) -- PoolCreated event specification
- [@uniswap/v3-sdk npm](https://www.npmjs.com/package/@uniswap/v3-sdk) -- v3.29.2, alpha stability warning noted
- [Hono docs](https://hono.dev/docs) -- framework overview and WebSocket helper
- [@hono/node-ws npm](https://www.npmjs.com/package/@hono/node-ws) -- v1.3.0 Node.js WebSocket adapter
- [Pino npm](https://www.npmjs.com/package/pino) -- v10.3.1 version verified
- [Vitest 4.0 announcement](https://vitest.dev/blog/vitest-4) -- v4.1.0 latest
- [@nomicfoundation/hardhat-toolbox npm](https://www.npmjs.com/package/@nomicfoundation/hardhat-toolbox) -- v6.1.0 with ethers v6 support
- [@nomicfoundation/hardhat-ethers npm](https://www.npmjs.com/package/@nomicfoundation/hardhat-ethers) -- v4.0.4, ethers v6 confirmed
- [Alchemy MEV Protection docs](https://www.alchemy.com/docs/reference/mev-protection) -- multi-chain MEV protection via RPC
- [Merkle (Blink) MEV Protection](https://merkle.io/) -- ETH, BSC, Base, Arbitrum coverage
- [Arbitrum Timeboost docs](https://docs.arbitrum.io/how-arbitrum-works/timeboost/gentle-introduction) -- Arbitrum-native MEV mechanism
- [Vite 8 announcement](https://vite.dev/blog/announcing-vite8) -- Rolldown bundler, v8.0.1
- [React npm](https://www.npmjs.com/package/react) -- v19.2.4
- [Zustand npm](https://www.npmjs.com/package/zustand) -- v5.0.12
- [TanStack Query npm](https://www.npmjs.com/package/@tanstack/react-query) -- v5.91.0
- [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4) -- v4.2.1
- [Viem vs Ethers comparison (MetaMask)](https://metamask.io/news/viem-vs-ethers-js-a-detailed-comparison-for-web3-developers/) -- rationale for staying on ethers
- [Hono vs Express vs Fastify (Better Stack)](https://betterstack.com/community/guides/scaling-nodejs/fastify-vs-express-vs-hono/) -- framework comparison

---
*Stack research for: Multi-chain EVM sniper bot with web dashboard*
*Researched: 2026-03-19*
