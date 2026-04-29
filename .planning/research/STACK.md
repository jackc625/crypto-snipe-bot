# Stack Research — v6.17 Defensive Hardening

**Domain:** Multi-chain MEV sniper — defensive hardening (honeypot detection, anti-rug, ops)
**Researched:** 2026-04-29
**Confidence:** HIGH (Context7 + official docs + multi-source verification)

## TL;DR

**The existing v6.16 stack already covers ~95% of v6.17.** The bulk of the milestone is code/test work on modules that exist (tokenSafety.ts, exit engine, env validation, dashboard API routes). Only **two additions** are warranted, both narrow:

1. **A Solidity honeypot-checker contract** (one new `.sol` file under `contracts/`, deployed once per chain via existing Hardhat 2.26 toolbox) — for Option D in the briefing.
2. **An `ws` ping/pong heartbeat utility** (already a transitive dep — just exercise it explicitly) — for hardening WebSocket reconnects on the LP-removal listener.

No new npm packages are needed. No RPC tier upgrade is needed if Option D is chosen. If Option C (`eth_simulateV1` via `provider.send`) is chosen instead, **BSC support is unverified** — see §"What NOT to Use" and §"Stack Patterns by Variant" below.

## Recommended Stack

### Core Technologies (no changes — already in repo)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `ethers` | 6.16.0 (current) | RPC, signing, ABI encoding, event subscriptions | Already validated through v6.16; native BigInt; supports `provider.send('eth_call', [tx, blockTag, stateDiff])` for state overrides; supports `provider.send('eth_simulateV1', [...])` passthrough. **6.16.0 is the latest npm release as of 2026-04-29 — no upgrade needed.** |
| `hardhat` | 2.26.0 | Solidity compile, deploy script for honeypot-checker contract | Already configured with full toolbox (`@nomicfoundation/hardhat-toolbox@6.1.0`, `hardhat-ignition@0.15.16`, `hardhat-ethers@3.1.2`). **Stay on v2.x.** Hardhat 3 (latest 3.4.2) is a complete rewrite (ESM-first, Node 22-required, `compile` → `build`); migrating it is a separate cross-cutting milestone, not v6.17 scope. |
| `@openzeppelin/contracts` | ^5.4.0 | OZ interfaces (`IERC20`) for the new checker contract | Already a dep; checker contract uses `IERC20` from `@openzeppelin/contracts/token/ERC20/IERC20.sol` and the existing `IUniswapV2Router02` interface from the test fixtures. |
| `better-sqlite3` | ^12.8.0 | LP-removal event journaling, anti-rug exit decisions audit | Already used; just add a new table/migration for `liquidity_events`. |
| `pino` | ^10.3.1 | Structured logging for new safety/anti-rug paths | Already used; new modules import the existing `logger` and `child()` it with their module name. |
| `vitest` | ^4.1.1 | Unit + integration + fork tests for the new code | Already used; the 37 `.todo` exit-engine stubs become real tests under the existing project layout. |

### Supporting Libraries (no additions — leverage what's already imported)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@flashbots/ethers-provider-bundle` | 1.0.0 | Existing MEV protection on ETH | Reuse for the anti-rug **frontrun-exit** transaction when LP-removal is detected on ETH (DETECT-02 emergency-sell must race the rug-pull tx). No code changes — the same `submitFlashbotsBundle` path used for entries works for emergency exits. |
| `ws` | ^8.20.0 | Direct WebSocket ping for `WebSocketProvider` heartbeat | Already a top-level dep. Use the `ws` instance accessible via `provider.websocket` (ethers v6 exposes the underlying socket) to send periodic ping frames. Required because Infura/Alchemy close idle WS connections after ~5 min and ethers v6 has **no built-in heartbeat** (open issue ethers-io/ethers.js#1053). |
| `axios` | 1.10.0 | Talk to honeypot.is and GoPlus from the parallel safety bank | Already used; **no change** — the new on-chain check augments these, doesn't replace them. |

### Development Tools (no additions)

| Tool | Purpose | Notes |
|------|---------|-------|
| `@nomicfoundation/hardhat-ignition` | Declarative deploy of the honeypot-checker contract | Already installed (`^0.15.16`). Create one ignition module `ignition/modules/HoneypotChecker.ts`; deploy with `npx hardhat ignition deploy --network <name>`. |
| `@nomicfoundation/hardhat-verify` | Etherscan/BscScan source verification post-deploy | Already installed (`^2.1.0`). Public verification is recommended so the deployed checker is auditable by the owner and anyone reviewing the bot. |
| `@nomicfoundation/hardhat-network-helpers` | Mainnet-fork test for the checker contract against a known honeypot token | Already installed; existing fork-test plumbing in `test:fork` reuses it. |
| `solidity-coverage` | Coverage on the new checker contract | Already installed (`^0.8.17`). |

## Installation

**No `npm install` is required for v6.17.** Every package needed is already in `package.json`. The only new files are:

```
contracts/HoneypotChecker.sol         # ~80 lines of Solidity
ignition/modules/HoneypotChecker.ts   # ~15 lines of deploy logic
src/utils/honeypotChecker.ts          # ethers v6 wrapper around the deployed contract
src/utils/lpRemovalListener.ts        # Burn + Sync event subscription
src/utils/wsHeartbeat.ts              # ping/pong loop for WebSocketProvider
src/utils/walletPreflight.ts          # getBalance check at startup
test/HoneypotChecker.test.ts          # hardhat unit + fork tests
```

## Honeypot Detection — Architecture Pick

The briefing presents four options. Evaluation against the existing stack:

| Option | New libs needed | New deps on RPC tier | Honest assessment |
|--------|-----------------|----------------------|-------------------|
| **A. Vacuous pass when balance=0** | None | None | Owner explicitly rejected. Don't ship. |
| **B. `getAmountsOut`** | None | None | Pure-math view function — never invokes the token's `_transfer` hook. **Catches empty pools, not honeypots.** Insufficient as a honeypot gate. |
| **C. `eth_call` with `stateOverride` for balance + allowance** | None (ethers v6 `provider.send('eth_call', [tx, 'latest', stateDiff])` already supported — see GitHub discussion #2393) | **ETH/Sepolia only confirmed.** Infura/MetaMask docs say `eth_simulateV1` is "Supported Networks: Mainnet and Sepolia only." For BSC mainnet, `eth_simulateV1` support is **not advertised by Alchemy/Infura/QuickNode in 2026** — go-ethereum's `eth_call` *does* support `stateOverride` on any geth-compatible node, so the underlying primitive should work on BSC/Base/Arbitrum, but each RPC provider needs to be tested per-chain. Brittle on storage-slot probing for non-standard ERC20s (Vyper, UUPS proxies, rebasing tokens). | 90-95% reliability; needs per-chain RPC verification at runtime; no new npm deps. |
| **D. Deploy on-chain `HoneypotChecker.sol`** | None (existing Hardhat toolbox) | None — `eth_call` against a deployed contract is the cheapest, most-universally-supported RPC method. Available on **every** RPC provider on every chain at the **free tier**. | Storage-layout agnostic. Exercises real `_transfer` hook in both directions. Returns numerical buy/sell tax. One-time ~$2-5 gas per chain. **Recommended.** |

### Why Option D wins on the existing stack

1. **No RPC-method gating.** Option C depends on `eth_call`-with-`stateOverride` (which is a Geth extension, not part of the JSON-RPC standard) being honored by every RPC the bot talks to. The bot already supports four chains, each with different RPC providers; Option C creates a per-chain compatibility matrix. Option D uses plain `eth_call` against a contract address — universally supported, free-tier safe.
2. **No storage-slot probing.** Option C requires guessing `balanceOf` storage slot 0 (true for OpenZeppelin ERC20, false for Vyper, rebasing tokens, transparent-proxy storage layouts). The honeypot-checker contract calls `IERC20.balanceOf` legitimately and never touches storage directly.
3. **Reuses existing tooling.** The repo already has a working Hardhat 2.26 setup with `FakeToken`, `UniswapV2Factory`, `UniswapV2Router02` test fixtures. Adding one more `contracts/*.sol` and one ignition module is the minimum-blast-radius change.
4. **Auditable.** The owner can read 80 lines of Solidity and verify what the bot trusts. They cannot audit ethers v6's interaction with a particular RPC provider's `stateOverride` semantics.

### Anti-feature: don't use a third-party deployed checker

The briefing asks about calling someone else's deployed checker (e.g., honeypot.is's). Don't:

- The parallel-bank already calls honeypot.is/GoPlus over HTTP. Calling another contract via `eth_call` adds latency without adding independent signal.
- A malicious checker contract could return misleading values (`staticCall` prevents writes, not lies).
- Maintenance: their checker can be upgraded or deprecated without notice.

The repo `valamidev/web3-defi-honeypot-and-slippage-checker` (MIT, public addresses on ETH/Arb/BSC/Base) is **a useful reference implementation** but should be re-deployed under the bot's owner address, not called directly.

## Anti-Rug LP-Removal Detection — No New Libraries

DETECT-02 needs to listen for `Burn(address indexed sender, uint amount0, uint amount1, address indexed to)` and `Sync(uint112 reserve0, uint112 reserve1)` events on each open position's `UniswapV2Pair` (and equivalent for V3 `Pool.Burn`).

Stack delta: **zero new packages.**

| Need | Existing primitive |
|------|--------------------|
| Subscribe to pair events | `pair.on('Burn', handler)` via existing `WebSocketProvider` per-chain |
| Decode event args | `PAIR_ABI` already centralized in `src/utils/abis.ts` |
| Race the rug-pull tx | Existing `@flashbots/ethers-provider-bundle` for ETH; `bloxroute` private RPC for BSC; passthrough on Base/Arb (FCFS) |
| Persist event history | Existing `better-sqlite3` — one new table `liquidity_events` |
| WebSocket heartbeat | Existing `ws` package — wrap `provider.websocket` with ping/pong (see ethers-io/ethers.js#1053; v6 has no built-in keepalive) |
| HTTP polling fallback | Existing `httpProvider` per `ChainContext` — `pair.queryFilter('Burn', fromBlock, 'latest')` on a 5-10 s timer when WS is down |

**Subscribe via WebSocket *and* poll fallback.** Producton-grade practice (Chainstack docs, ethers-io/ethers.js#4470) is redundant listeners — the cost is one extra `eth_getLogs` per 5 s per open position. With `MAX_OPEN_POSITIONS=3`, that's negligible against any free-tier rate limit.

## Going-Live Wallet Pre-Flight — No New Libraries

`GOING-LIVE.md` step 7 already does this manually with a one-liner. Promote to startup code:

```ts
// src/utils/walletPreflight.ts (new ~25 LOC)
const balance = await ctx.httpProvider.getBalance(ctx.wallet.address);
const minRequired = ethers.parseEther(ctx.chain.snipeAmount) * 2n;  // 2x snipe + gas headroom
if (balance < minRequired) {
    ctx.log.fatal({ chain, address, balanceWei: balance.toString() }, 'Wallet underfunded');
    process.exit(1);
}
```

Stack delta: **zero.** Pure ethers v6.

## Tech Debt Cleanup — No New Libraries

- **Nyquist validation on 9 phases** — process change, not stack
- **37 `.todo` exit-engine test stubs** — fill out using existing `vitest` project
- **6 TS annotation errors in dashboard API routes** — TypeScript fixes only
- **Dead-code/diagnostic-log cleanup** — code edits

Stack delta: **zero.**

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Self-deploy `HoneypotChecker.sol` (Option D) | `eth_simulateV1` with state overrides (Option C) | If multi-call simulation (e.g., simulate `approve → swap → swap` as one bundle without redeploying contract) becomes a critical need. Currently the buy→sell roundtrip fits trivially in one `eth_call` to the checker, so this isn't needed. **Note: BSC/Base/Arbitrum support not verified for `eth_simulateV1` as of 2026-04** — only Ethereum mainnet + Sepolia confirmed. |
| Self-deploy `HoneypotChecker.sol` | Hosted simulation (Tenderly Simulation API) | If the bot's strategy expanded to need 100+ simulations/min and you wanted off-chain compute. Tenderly supports Ethereum/Arbitrum/Base/Polygon and has state overrides, but: (1) introduces a paid third-party dependency on the hot path (currently the bot has zero paid services besides bloXroute on BSC); (2) latency to Tenderly's API > local `eth_call` to your own RPC; (3) violates the owner's "don't trust third-party APIs alone" constraint if it becomes a hard gate. Useful for *out-of-band* validation/replay, not for live snipe gating. |
| Existing Hardhat 2.26 + Ignition | Foundry (forge) for the checker contract | If the project moved to Foundry-first. Not for v6.17 — would require rebuilding the entire `test:fork` plumbing. |
| `provider.websocket` ping/pong via `ws` | A new dep like `@webtech/keepalive-ws` or `reconnecting-websocket` | If a more featureful reconnect-with-backoff library proves necessary after building the simple version. Ship the simple version first. |
| `pair.queryFilter('Burn', ...)` polling fallback | A subgraph indexer (The Graph) for LP events | If LP-removal detection latency budget gets stricter than ~10 s. Adds infrastructure (hosted subgraph or a self-deployed indexer) — overkill for current scope. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Hardhat 3.4.2 in this milestone | Complete rewrite (ESM-first, Node 22-required, `compile` → `build`, hook system replaces extensibility points). Migrating is a cross-cutting change that affects every test and config. | Hardhat 2.26.0 — already wired, all toolbox plugins compatible, no functional gap for deploying the checker contract. |
| Calling someone else's deployed honeypot checker via `eth_call` | (a) Adds an external dependency for a defense-in-depth check; (b) honeypot.is/GoPlus already provide the third-party signal in the parallel bank; (c) malicious checker can return lies. | Deploy the bot's own checker. |
| `eth_simulateV1` as a hard requirement | **MetaMask/Infura docs explicitly limit it to "Mainnet and Sepolia only" as of 2026-04.** BSC/Base/Arbitrum support across providers is unverified. Building a multi-chain pre-buy gate around an Ethereum-only RPC method would either drop chain coverage or force per-chain branches. | The on-chain checker pattern (Option D) is universal: every RPC supports `eth_call`. |
| Web3.js | The repo is fully ethers v6; mixing libraries doubles maintenance surface. | ethers v6 only. |
| `dotenv-vault` / `dotenv-expand` for env hardening | The current `dotenv@17.2.0` is sufficient; the v6.17 ops-hardening work is **content** (better error messages, balance pre-flight) not new env tooling. | Stick with `dotenv@17.2.0`. |
| `viem` instead of ethers | Migrating off ethers v6 is a 6-month rewrite; viem also doesn't expose `provider.send('eth_call', [...])` with state diff in the same shape. Out of scope. | ethers v6.16.0. |

## Stack Patterns by Variant

**If the team picks Option C (eth_simulateV1) over Option D in /gsd-discuss:**

- Add a per-chain capability probe at startup that calls `provider.send('eth_simulateV1', [...minimal_payload...])` and falls back to Option D's checker contract if the RPC rejects with method-not-supported. This implies you still need to ship the checker contract for BSC/Base/Arb at minimum.
- No new npm deps either way — both options live entirely in ethers v6.

**If WebSocket reconnect proves flaky on free-tier Alchemy:**

- Upgrade WebSocket from one provider per chain to two (e.g., Alchemy primary, Chainstack secondary) and wrap them in a `RedundantEventListener` (pattern documented by Chainstack — listen to both, dedupe by `event.transactionHash`).
- Adds **zero npm deps**, but adds an env var per chain (`ETH_WS_URL_SECONDARY=...`).

**If the bot adds a fifth chain in the future:**

- Re-deploy `HoneypotChecker.sol` on the new chain (one ignition command, one `chainRegistry.ts` update). No code changes elsewhere.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `ethers@6.16.0` | `@flashbots/ethers-provider-bundle@1.0.0` | Already validated in v6.16 production runs. Flashbots bundle provider was rewritten for v6 in 1.0.0; older 0.x is v5-only — do not regress. |
| `hardhat@2.26.0` | `@nomicfoundation/hardhat-toolbox@6.1.0` | Toolbox 6.x = Hardhat 2.22+ era; pinned versions in `package.json` are compatible. **Do NOT bump to toolbox 7+ which targets Hardhat 3.** |
| `hardhat@2.26.0` | `@nomicfoundation/hardhat-ignition@^0.15.16` | Ignition 0.15 supports the Hardhat 2 plugin API; do not bump to 0.16+ unless verifying Hardhat 2 support. |
| `@openzeppelin/contracts@^5.4.0` | Solidity ^0.8.20 | OZ v5 requires Solidity >=0.8.20. The new checker contract should specify `pragma solidity ^0.8.20;` to match. |
| `better-sqlite3@^12.8.0` | Node 18+ | Prebuilt binaries exist for Node 18, 20, 22. Migration adds a `liquidity_events` table — additive only, no schema breakage. |
| `vitest@^4.1.1` | `@vitest/coverage-v8@^4.1.2` | Major versions must match (vitest 4 ↔ coverage-v8 4); already aligned. |
| `ws@^8.20.0` | ethers v6.16 `WebSocketProvider` | ethers v6 internally uses `WebSocket` from `ws` on Node and the browser-native one in browsers. The repo already imports `ws` for the dashboard live feed; reusing it for the heartbeat is consistent. |

## Sources

- `/websites/ethers_v6` (Context7 ID resolved via `npx ctx7 library ethers`) — confirmed library identity; full docs fetch was blocked by ctx7 CLI URL-parsing quirk on Windows but library presence and version (6.16.0) verified.
- [npm: ethers](https://www.npmjs.com/package/ethers) — `npm view ethers version` returned `6.16.0`. **HIGH confidence** (registry data).
- [npm: hardhat](https://www.npmjs.com/package/hardhat) — `npm view hardhat version` returned `3.4.2`; repo pinned at `2.26.0` for stability. **HIGH confidence**.
- [Alchemy eth_simulateV1 docs](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-simulate-v-1) — confirms state overrides for balance/nonce/code/storage; tier requirements not specified. **MEDIUM confidence on multi-chain availability** (docs only show ETH mainnet endpoint).
- [QuickNode eth_simulateV1 docs](https://www.quicknode.com/docs/ethereum/eth_simulateV1) — confirms state + block overrides, free tier mentioned. **MEDIUM confidence**.
- [MetaMask/Infura eth_simulateV1 docs](https://docs.metamask.io/services/reference/ethereum/json-rpc-methods/eth_simulatev1/) — explicitly: "Supported Networks: Mainnet and Sepolia only", "Maximum 16 block state calls per request". **HIGH confidence — this is the source of the BSC/Base/Arb caveat.**
- [Chainstack Arbitrum eth_simulateV1](https://docs.chainstack.com/reference/arbitrum-simulatev1) — confirms Arbitrum support via Chainstack specifically. Not free-tier verified for Alchemy/Infura/QuickNode. **MEDIUM confidence**.
- [ethers-io/ethers.js#2393](https://github.com/ethers-io/ethers.js/discussions/2393) — exact `provider.send('eth_call', [tx, 'latest', stateDiff])` syntax for ethers v6. **HIGH confidence**.
- [ethers-io/ethers.js#1053](https://github.com/ethers-io/ethers.js/issues/1053) — confirms ethers v6 has no built-in WebSocket reconnect/heartbeat; manual ping required via `provider.websocket`. **HIGH confidence**.
- [ethers-io/ethers.js#4470](https://github.com/ethers-io/ethers.js/issues/4470) — intermittent event delivery is a known WS issue → motivates polling fallback. **HIGH confidence**.
- [Chainstack: redundant event listeners](https://docs.chainstack.com/docs/ethereum-redundant-event-llstener-ethers-web3js) — documents the dual-listener pattern (WS primary + HTTP poll). **MEDIUM confidence** (vendor doc, but pattern is widely reproduced).
- [Uniswap v2-core UniswapV2Pair.sol](https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol) — `Burn(address indexed sender, uint amount0, uint amount1, address indexed to)` and `Sync(uint112 reserve0, uint112 reserve1)` event signatures verified. **HIGH confidence**.
- [valamidev/web3-defi-honeypot-and-slippage-checker](https://github.com/valamidev/web3-defi-honeypot-and-slippage-checker) — public reference checker contract, MIT-licensed, deployed on ETH/BSC/Base/Arbitrum. Useful as **reference** for our own deployment, not for direct use. **HIGH confidence (repo + addresses verified)**.
- [Hardhat 3 migration guide](https://hardhat.org/docs/migrate-from-hardhat2) — confirms Hardhat 3 is breaking (ESM-first, Node 22, `build` not `compile`). Justifies staying on 2.26.0 for v6.17. **HIGH confidence**.
- [Tenderly Simulations docs](https://docs.tenderly.co/simulations) — confirms 105 networks supported including ETH/Arb/Base, state overrides supported. Pricing not retrievable from public pages without contact. **MEDIUM confidence on availability**, **LOW confidence on free-tier limits.**

---
*Stack research for: v6.17 defensive hardening (subsequent milestone — minimal additions to validated v6.16 stack)*
*Researched: 2026-04-29*
