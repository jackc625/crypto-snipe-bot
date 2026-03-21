# Phase 2: ethers v6 Migration - Research

**Researched:** 2026-03-20
**Domain:** ethers.js v5 to v6 migration, Flashbots provider upgrade, Hardhat toolchain modernization
**Confidence:** HIGH

## Summary

The migration from ethers v5 to v6 is well-documented with a clear official guide. The core changes are: BigNumber class replaced by native BigInt, utility functions moved from `ethers.utils.*` to `ethers.*`, provider class hierarchy flattened (`providers.JsonRpcProvider` becomes `JsonRpcProvider`), and contract method namespaces reorganized (`callStatic` becomes `method.staticCall()`). The project has 12 source files requiring migration across heavy (3), medium (4), and light (5) tiers.

A critical correction from the initial CONTEXT.md: the decision D-05 references `@nomicfoundation/hardhat-ethers v4.0.4`, but hardhat-ethers v4.x requires Hardhat 3.x (released as a new major version). Since this project runs Hardhat 2.26.0, the correct version is `@nomicfoundation/hardhat-ethers@3.1.2` which supports Hardhat ^2.26.0 with ethers ^6.14.0. The `@nomicfoundation/hardhat-toolbox@6.1.0` peer dependency confirms this (`^3.1.0` for hardhat-ethers).

The Flashbots `@flashbots/ethers-provider-bundle@1.0.0` has been verified to use ethers v6 types natively. Its published source imports `AbstractProvider`, `TransactionRequest`, `Signer`, `Provider` etc. directly from `'ethers'`. The `FlashbotsBundleProvider.create()` method signature is almost identical to v5 but accepts `Provider` instead of `BaseProvider`. The `sendBundle` API is unchanged in shape.

**Primary recommendation:** Migrate in dependency order -- package.json first (swap all packages atomically), then Hardhat config, then files from light to heavy, adding ESLint BigInt safety rule last as a verification gate.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Verification = TypeScript compiles clean + Hardhat compiles/deploys contracts to Sepolia + Flashbots bundle submission confirmed on Sepolia
- **D-02:** No full snipe cycle test required -- compilation + Sepolia deploy is sufficient confidence. Phase 9 adds proper test coverage later
- **D-03:** No burn-in period after migration -- proceed straight to Phase 3 once verification passes
- **D-04:** Full cleanup of ALL v5-era packages -- remove ethereum-waffle, @nomiclabs/hardhat-ethers, @nomiclabs/hardhat-etherscan, @nomiclabs/hardhat-waffle, @typechain/ethers-v5, and all @ethersproject/* sub-packages
- **D-05:** Replace with v6 equivalents: @nomicfoundation/hardhat-toolbox v6.1.0, @nomicfoundation/hardhat-ethers v4.0.4, @typechain/ethers-v6 (**CORRECTED: hardhat-ethers must be v3.1.2, not v4.0.4 -- v4.x requires Hardhat 3.x**)
- **D-06:** Clean break from v5 ecosystem -- no v5 packages should remain in package.json after migration
- **D-07:** Add an ESLint rule to flag potential BigInt/Number mixing as a compile-time guardrail beyond TypeScript's type system
- **D-08:** No wrapper helper functions -- use native BigInt operators directly. The ESLint rule provides the safety net

### Claude's Discretion
- Migration ordering (which files first, how to batch the work)
- Specific ESLint plugin/rule choice for BigInt safety
- Whether to cache contract addresses after getAddress() or call getAddress() each time
- Handling of edge cases in the v5 to v6 API surface changes (callStatic to staticCall, etc.)
- Exact Hardhat config restructuring for toolbox v6

### Deferred Ideas (OUT OF SCOPE)
- Singleton provider pattern (creating one provider per chain instead of per-function) -- Phase 3: Code Quality (INFRA-02)
- Centralized ABI definitions -- Phase 3: Code Quality (INFRA-03)
- Replacing console.log with structured logging -- Phase 3: Code Quality (INFRA-01)
- TypeScript strictness improvements (replacing `any` types) -- Phase 3: Code Quality
- WebSocket provider for real-time events instead of polling -- Phase 4+ concern
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ETH6-01 | All ethers v5 imports and APIs migrated to ethers v6 (BigNumber to native BigInt, updated provider/signer API) | Complete v5-to-v6 API mapping documented below. 12 files identified with exact migration patterns per file. Import path changes, provider flattening, utility moves, and BigNumber-to-BigInt conversions all catalogued. |
| ETH6-02 | All arithmetic operations use BigInt correctly -- no Number() precision loss on wei values | BigInt migration patterns documented. ESLint `restrict-plus-operands` rule from `@typescript-eslint` flags bigint+number mixing. Key danger spots identified (gasManager.ts multiplier, monitor price ROI). |
| ETH6-03 | Flashbots provider upgraded to @flashbots/ethers-provider-bundle v1.0.0 (ethers v6 compatible) | v1.0.0 source verified: uses ethers v6 imports (AbstractProvider, TransactionRequest, Signer from 'ethers'). create() accepts Provider, sendBundle API unchanged. Peer dep: ethers 6.7.1. |
| ETH6-04 | Hardhat toolbox upgraded to v6+ with hardhat-ethers v4+ for ethers v6 compatibility | CORRECTED: hardhat-ethers v3.1.2 (not v4.x) is required for Hardhat 2.26.0. Toolbox v6.1.0 requires Hardhat ^2.26.0, ethers ^6.14.0, hardhat-ethers ^3.1.0. Full peer dependency tree documented. |
</phase_requirements>

## Standard Stack

### Core (verified against npm registry 2026-03-20)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ethers | 6.16.0 | Blockchain interaction, wallets, contracts | Latest stable. Native BigInt. Replaces v5 (EOL). |
| @flashbots/ethers-provider-bundle | 1.0.0 | MEV-protected Flashbots bundle submission | Only version with ethers v6 support. Peer dep: ethers 6.7.1+. Published 2024-02-06. |
| hardhat | 2.26.0 | Smart contract compile/deploy/test | Already installed. Compatible with toolbox 6.1.0. |
| @nomicfoundation/hardhat-toolbox | 6.1.0 | Bundled Hardhat plugins for ethers v6 | Requires Hardhat ^2.26.0, ethers ^6.14.0. Replaces v2.0.2. |
| @nomicfoundation/hardhat-ethers | 3.1.2 | Ethers v6 integration for Hardhat | Requires Hardhat ^2.26.0, ethers ^6.14.0. **NOT v4.x** (v4.x needs Hardhat 3.x). |
| @nomicfoundation/hardhat-chai-matchers | 2.1.2 | Enhanced Chai matchers for ethers v6 contracts | Peer of toolbox v6.1.0. Replaces v1.x. |
| @nomicfoundation/hardhat-verify | 2.1.0+ | Contract verification (replaces hardhat-etherscan) | Peer of toolbox v6.1.0. Replaces deprecated @nomiclabs/hardhat-etherscan. |
| @nomicfoundation/hardhat-network-helpers | 1.1.0+ | Test network utilities | Already installed, compatible version. |
| @nomicfoundation/hardhat-ignition-ethers | 0.15.14+ | Hardhat Ignition integration | New peer dep required by toolbox v6.1.0. |
| @typechain/ethers-v6 | 0.5.1 | Type-safe contract bindings for ethers v6 | Replaces @typechain/ethers-v5. Peer of toolbox v6.1.0. |
| @typechain/hardhat | 9.1.0 | Hardhat TypeChain integration | Peer of toolbox v6.1.0. Replaces v6.x. |
| typechain | 8.3.2 | TypeChain core | Peer of toolbox v6.1.0. |
| hardhat-gas-reporter | 2.3.0 | Gas cost reporting | Peer of toolbox v6.1.0. Replaces v1.x. |
| solidity-coverage | 0.8.17 | Solidity code coverage | Peer of toolbox v6.1.0. Compatible. |
| chai | 4.3.10 | Assertion library | Already installed. Compatible. |
| @types/node | 22.19.15 | Node.js type defs | Toolbox v6.1.0 requires >=20.0.0. Current 18.18.5 must be upgraded. |

### ESLint for BigInt Safety (D-07)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| eslint | 9.x | Linting engine | Latest major. Flat config format. |
| typescript-eslint | 8.57.1 | TypeScript-aware ESLint rules | Provides `restrict-plus-operands` which flags bigint+number mixing. |

### Packages to REMOVE (D-04, D-06)

| Package | Why Remove |
|---------|-----------|
| ethers@5.7.2 | EOL. Replaced by ethers@6.16.0. |
| @nomiclabs/hardhat-ethers@2.2.3 | Deprecated. Replaced by @nomicfoundation/hardhat-ethers@3.1.2. |
| @nomiclabs/hardhat-etherscan@3.1.8 | Deprecated. Replaced by @nomicfoundation/hardhat-verify (in toolbox). |
| @nomiclabs/hardhat-waffle@2.0.6 | Deprecated. Replaced by @nomicfoundation/hardhat-chai-matchers (in toolbox). |
| ethereum-waffle@3.4.4 | Deprecated and unmaintained. No v6 support. |
| @nomicfoundation/hardhat-toolbox@2.0.2 | Replaced by v6.1.0. |
| @nomicfoundation/hardhat-chai-matchers@1.0.6 | Replaced by v2.1.2 (peer of toolbox v6). |
| @typechain/hardhat@6.1.6 | Replaced by v9.1.0 (peer of toolbox v6). |

**Note:** The `@ethersproject/*` sub-packages are transitive dependencies of ethers v5 and will be removed automatically when ethers v5 is removed. The only explicit import is `@ethersproject/abstract-provider` in `txManager.ts` -- that import must change to `import { TransactionRequest } from "ethers"`.

### Installation Commands

```bash
# Step 1: Remove v5-era packages
npm uninstall ethers @nomiclabs/hardhat-ethers @nomiclabs/hardhat-etherscan @nomiclabs/hardhat-waffle ethereum-waffle @nomicfoundation/hardhat-toolbox @nomicfoundation/hardhat-chai-matchers @typechain/hardhat hardhat-gas-reporter

# Step 2: Install ethers v6
npm install ethers@6.16.0
npm install @flashbots/ethers-provider-bundle@1.0.0

# Step 3: Install Hardhat toolbox v6 and all peer dependencies
npm install -D @nomicfoundation/hardhat-toolbox@6.1.0
npm install -D @nomicfoundation/hardhat-ethers@3.1.2
npm install -D @nomicfoundation/hardhat-chai-matchers@2.1.2
npm install -D @nomicfoundation/hardhat-verify@2.1.0
npm install -D @nomicfoundation/hardhat-ignition-ethers@0.15.14
npm install -D @typechain/ethers-v6@0.5.1
npm install -D @typechain/hardhat@9.1.0
npm install -D typechain@8.3.2
npm install -D hardhat-gas-reporter@2.3.0
npm install -D solidity-coverage@0.8.17
npm install -D @types/node@22.19.15

# Step 4: Install ESLint for BigInt safety (D-07)
npm install -D eslint@9 typescript-eslint@8.57.1
```

## Architecture Patterns

### File Migration Tiers

Migration ordering recommendation (Claude's discretion): bottom-up by dependency depth and complexity.

**Tier 1 -- Package & Config (do first, blocks everything):**
- `package.json` -- swap all dependencies atomically
- `tsconfig.json` -- update `types` array (remove `mocha`/`chai` if toolbox handles, keep `hardhat`)
- `hardhat.config.ts` -- plugin import changes only

**Tier 2 -- Light migration (import path changes only):**
- `src/scripts/genAuthWallet.ts` -- `Wallet` import path (ethers v6 flat imports work identically)
- `src/utils/exitManager.ts` -- `Contract` import (no change needed, already flat)
- `scripts/manualTrigger.ts` -- no ethers imports directly, just re-exports
- `src/utils/pairDiscovery.ts` -- `providers.JsonRpcProvider` to `JsonRpcProvider`
- `src/utils/flashbots.ts` -- `providers.JsonRpcProvider` and `Wallet` import paths + FlashbotsBundleProvider v1.0.0 types

**Tier 3 -- Medium migration (provider + BigNumber removal):**
- `src/utils/gasManager.ts` -- `BigNumber.from()/.mul()/.div()` to BigInt arithmetic, `providers.JsonRpcProvider` to `JsonRpcProvider`
- `src/utils/txManager.ts` -- `TransactionRequest` import from `ethers` (not `@ethersproject`), `BigNumber.from()` to `BigInt()`, `getGasPrice()` to `getFeeData().gasPrice`, `chainId` now bigint
- `src/alphaDrop.ts` -- `providers.JsonRpcProvider` to `JsonRpcProvider`
- `scripts/addLiquidity.ts` -- `BigNumber.sub()/.gt()/.eq()` to native ops, `ethers.constants.Zero` to `0n`, `ethers.utils.parseUnits/parseEther` to `ethers.parseUnits/parseEther`

**Tier 4 -- Heavy migration (extensive changes):**
- `src/bot.ts` -- ~20 BigNumber ops, `ethers.utils.*` calls, `ethers.providers.JsonRpcProvider`, `getGasPrice()`, `callStatic`, `balance.isZero()`, `expectedOut.sub().mul().div()`
- `src/utils/tokenSafety.ts` -- `callStatic` to `staticCall`, `providers.JsonRpcProvider`, `utils.parseEther`, type annotations on provider params
- `scripts/deploySepoliaTest.ts` -- `ContractFactory.deploy()` + `.deployed()` to `.waitForDeployment()`, `contract.address` to `contract.target`, `ethers.utils.Interface` to `ethers.Interface`

### Complete v5 to v6 API Migration Map

Every pattern found in this codebase, with exact replacement:

| v5 Pattern | v6 Replacement | Files Using It |
|------------|----------------|----------------|
| `import { providers, BigNumber } from "ethers"` | `import { JsonRpcProvider, ... } from "ethers"` | gasManager, txManager, tokenSafety, flashbots |
| `new ethers.providers.JsonRpcProvider(url)` | `new ethers.JsonRpcProvider(url)` | bot, alphaDrop, tokenSafety, pairDiscovery, addLiquidity, deploySepoliaTest |
| `ethers.utils.parseEther(x)` | `ethers.parseEther(x)` | bot, tokenSafety, addLiquidity, deploySepoliaTest |
| `ethers.utils.parseUnits(x, d)` | `ethers.parseUnits(x, d)` | addLiquidity |
| `ethers.utils.formatEther(x)` | `ethers.formatEther(x)` | bot |
| `BigNumber.from(x)` | `BigInt(x)` or `xn` literal | gasManager, txManager |
| `.mul(x)` | `* BigInt(x)` | gasManager, bot |
| `.div(x)` | `/ BigInt(x)` | gasManager, bot |
| `.add(x)` | `+ x` | (none found, but pattern documented) |
| `.sub(x)` | `- x` | bot, addLiquidity |
| `.eq(x)` / `.isZero()` | `=== x` / `=== 0n` | bot, addLiquidity |
| `.gt(x)` / `.lt(x)` | `> x` / `< x` | addLiquidity, bot |
| `ethers.constants.Zero` | `0n` | addLiquidity |
| `ethers.constants.AddressZero` | `ethers.ZeroAddress` | (pairDiscovery uses literal `"0x000..."`) |
| `contract.callStatic.method()` | `contract.method.staticCall()` | tokenSafety (2 places), bot (implied via tokenSafety) |
| `contract.address` | `contract.target` (sync) or `await contract.getAddress()` (async) | deploySepoliaTest (5+ uses), addLiquidity |
| `await contract.deployed()` | `await contract.waitForDeployment()` | deploySepoliaTest (4 uses) |
| `provider.getGasPrice()` | `(await provider.getFeeData()).gasPrice` | bot, txManager |
| `(await provider.getNetwork()).chainId` | Same call, but returns `bigint` not `number` | txManager |
| `import { TransactionRequest } from "@ethersproject/abstract-provider"` | `import { TransactionRequest } from "ethers"` | txManager |
| `new ethers.utils.Interface(abi)` | `new ethers.Interface(abi)` | deploySepoliaTest |
| `new ethers.ContractFactory(abi, bytecode, signer)` | Same (unchanged in v6) | deploySepoliaTest |
| `providers.JsonRpcProvider` (as type) | `JsonRpcProvider` (as type) | tokenSafety (function params), gasManager |

### contract.target vs getAddress() Decision

**Recommendation (Claude's discretion):** Use `contract.target` (synchronous) everywhere in this codebase. All contracts are created with known address strings, never ENS names. `contract.target` returns `string | Addressable` -- cast to `string` when passing to functions that expect `string`. Do NOT use `await contract.getAddress()` unless ENS resolution is needed (it is not, in this codebase).

For `deploySepoliaTest.ts`, replace `weth.address` with `await weth.getAddress()` since the contract is freshly deployed and we want the resolved address string. Alternatively, use `weth.target as string`.

### Hardhat Config Changes

The `hardhat.config.ts` only needs the plugin import to remain `"@nomicfoundation/hardhat-toolbox"` -- the config structure is identical between toolbox v2 and v6. The difference is in peer dependencies resolved at install time.

**tsconfig.json changes:**
- Update `"types"` to remove `"mocha"` and `"chai"` if they conflict with toolbox v6 type resolution
- Update `@types/node` to v22 (toolbox v6.1.0 requires >=20.0.0)
- Consider updating `tsconfig.bot.json` target from `ES2020` to `ES2022` (aligns with main tsconfig, full BigInt support)

### ESLint Configuration (D-07, D-08)

Use `typescript-eslint` flat config format (ESLint 9+):

```typescript
// eslint.config.mjs
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // D-07: Flag BigInt/Number mixing
      '@typescript-eslint/restrict-plus-operands': ['error', {
        allowNumberAndString: false,
        skipCompoundAssignments: false,
      }],
      // Additional safety: prevent implicit number coercion on BigInt values
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },
  {
    ignores: ['dist/', 'artifacts/', 'cache/', 'typechain-types/', 'node_modules/'],
  },
);
```

**Key rule:** `@typescript-eslint/restrict-plus-operands` -- flags `1n + 1` (bigint + number) as an error. This is the primary BigInt safety guardrail beyond TypeScript's own type system.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BigInt/Number mixing detection | Custom AST linter | `@typescript-eslint/restrict-plus-operands` | Battle-tested, handles edge cases (template literals, compound assignment) |
| Contract type generation | Manual interface definitions | `@typechain/ethers-v6` + `@typechain/hardhat` | Auto-generates from ABI, stays in sync with Solidity changes |
| Gas price estimation | Custom fee calculation | `provider.getFeeData()` (ethers v6 built-in) | Handles EIP-1559 maxFeePerGas/maxPriorityFeePerGas automatically |
| Bundle signing for Flashbots | Custom payload signing | `FlashbotsBundleProvider.sendBundle()` | Handles auth signature, relay communication, response parsing |

## Common Pitfalls

### Pitfall 1: BigNumber methods on BigInt values
**What goes wrong:** TypeScript compiles fine but runtime crash -- `value.mul(2)` where `value` is now `bigint` (no `.mul()` method).
**Why it happens:** ethers v6 returns `bigint` from contract calls, but the code expects `BigNumber` with methods.
**How to avoid:** Replace ALL `.mul()/.div()/.add()/.sub()/.eq()/.gt()/.lt()/.isZero()` with native operators (`* / + - === > < === 0n`). ESLint type-checked config catches mixed types at lint time.
**Warning signs:** `TypeError: value.mul is not a function` at runtime.

### Pitfall 2: provider.getGasPrice() removed in v6
**What goes wrong:** `TypeError: provider.getGasPrice is not a function`.
**Why it happens:** ethers v6 removed `getGasPrice()` -- use `getFeeData().gasPrice` instead.
**How to avoid:** Search for all `getGasPrice()` calls and replace with `(await provider.getFeeData()).gasPrice`. Found in: `bot.ts:92`, `txManager.ts:23`.
**Warning signs:** Runtime error on any transaction attempt.

### Pitfall 3: contract.address removed -- use contract.target
**What goes wrong:** `undefined` when accessing `contract.address` on v6 Contract instances.
**Why it happens:** ethers v6 renamed `address` to `target`. The property `target` can be string or Addressable.
**How to avoid:** Replace `contract.address` with `contract.target as string` for known-address contracts, or `await contract.getAddress()` when you need a guaranteed string.
**Warning signs:** `undefined` passed as address argument to other contracts or functions.

### Pitfall 4: callStatic namespace moved
**What goes wrong:** `TypeError: contract.callStatic is undefined`.
**Why it happens:** ethers v6 restructured method namespaces. `callStatic` is now per-method.
**How to avoid:** Replace `contract.callStatic.method(args)` with `contract.method.staticCall(args)`. Found in: `tokenSafety.ts:48`, `tokenSafety.ts:158`, `tokenSafety.ts:337`.
**Warning signs:** Any static call simulation fails.

### Pitfall 5: chainId is now bigint
**What goes wrong:** Type mismatch when `chainId` is used in contexts expecting `number`.
**Why it happens:** `provider.getNetwork().chainId` returns `bigint` in v6 (was `number` in v5).
**How to avoid:** In `txManager.ts:30`, the `chainId` field of `TransactionRequest` in v6 accepts `bigint`, so no conversion needed. But if `chainId` is passed to `sendBundle()` as `targetBlockNumber`, be aware `getBlockNumber()` returns `number` in v6 (this is fine).
**Warning signs:** TypeScript compile error on chainId assignment.

### Pitfall 6: Number() on wei values loses precision
**What goes wrong:** JavaScript `Number` cannot represent values > 2^53. Wei values regularly exceed this.
**Why it happens:** `Number(someBigInt)` silently truncates. The codebase already does this in monitoring loops: `Number(currentOut[1])` in `bot.ts:118,137,179`.
**How to avoid:** These specific `Number()` calls are for ROI percentage calculation, which is acceptable since we're converting to a ratio. However, do NOT use `Number()` on raw wei values for arithmetic. The ESLint rule helps catch this.
**Warning signs:** Incorrect ROI calculations, imprecise price comparisons.

### Pitfall 7: Flashbots create() provider type changed
**What goes wrong:** TypeScript type error when passing `JsonRpcProvider` to `FlashbotsBundleProvider.create()`.
**Why it happens:** v1.0.0 `create()` expects ethers v6 `Provider` type (from `ethers`), not v5's `providers.JsonRpcProvider`.
**How to avoid:** `JsonRpcProvider` in ethers v6 implements `Provider`, so it's compatible. Just ensure the import is from v6.
**Warning signs:** TypeScript compile error on `create()` call.

### Pitfall 8: .deployed() removed from ContractFactory
**What goes wrong:** `TypeError: contract.deployed is not a function` in deploy scripts.
**Why it happens:** ethers v6 replaced `.deployed()` with `.waitForDeployment()`.
**How to avoid:** Replace `await contract.deployed()` with `await contract.waitForDeployment()` in `deploySepoliaTest.ts` (4 occurrences).
**Warning signs:** Deploy scripts crash after deployment succeeds.

### Pitfall 9: hardhat-ethers v4 requires Hardhat 3
**What goes wrong:** `npm install` fails with peer dependency error.
**Why it happens:** `@nomicfoundation/hardhat-ethers@4.x` requires `hardhat@^3.0.7`. The project uses Hardhat 2.26.0. CONTEXT.md decision D-05 incorrectly specifies v4.0.4.
**How to avoid:** Use `@nomicfoundation/hardhat-ethers@3.1.2` which requires `hardhat@^2.26.0` and supports `ethers@^6.14.0`.
**Warning signs:** npm peer dependency resolution failure at install time.

## Code Examples

### BigNumber to BigInt conversion (gasManager.ts)

```typescript
// BEFORE (v5):
import { providers, BigNumber } from "ethers";
export async function getGasOptions(provider: providers.JsonRpcProvider) {
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice
        ? feeData.gasPrice.mul(Math.round(CONFIG.gasMultiplier * 100)).div(100)
        : undefined;
    return { gasPrice, gasLimit: BigNumber.from(300_000) };
}

// AFTER (v6):
import { JsonRpcProvider } from "ethers";
export async function getGasOptions(provider: JsonRpcProvider) {
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice
        ? feeData.gasPrice * BigInt(Math.round(CONFIG.gasMultiplier * 100)) / 100n
        : undefined;
    return { gasPrice, gasLimit: 300_000n };
}
```

### callStatic migration (tokenSafety.ts)

```typescript
// BEFORE (v5):
await router.callStatic.swapExactETHForTokens(0, path, walletAddress, deadline, { value: amountIn });

// AFTER (v6):
await router.swapExactETHForTokens.staticCall(0, path, walletAddress, deadline, { value: amountIn });
```

### Provider + getGasPrice migration (txManager.ts)

```typescript
// BEFORE (v5):
import { providers, Wallet, BigNumber } from "ethers";
import type { TransactionRequest } from "@ethersproject/abstract-provider";
const gasLimit = txRequest.gasLimit || BigNumber.from(300000);
const gasPrice = await provider.getGasPrice();

// AFTER (v6):
import { JsonRpcProvider, Wallet, TransactionRequest } from "ethers";
const gasLimit = txRequest.gasLimit || 300_000n;
const gasPrice = (await provider.getFeeData()).gasPrice;
```

### Deploy script migration (deploySepoliaTest.ts)

```typescript
// BEFORE (v5):
const weth = await WETHFactory.deploy();
await weth.deployed();
console.log("WETH deployed to:", weth.address);
const iface = new ethers.utils.Interface(UniswapV2FactoryJson.abi);

// AFTER (v6):
const weth = await WETHFactory.deploy();
await weth.waitForDeployment();
console.log("WETH deployed to:", await weth.getAddress());
const iface = new ethers.Interface(UniswapV2FactoryJson.abi);
```

### FlashbotsBundleProvider migration (flashbots.ts)

```typescript
// BEFORE (v5):
import { providers, Wallet } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
export async function getFlashbotsProvider(
    provider: providers.JsonRpcProvider,
    authSigner: Wallet
): Promise<FlashbotsBundleProvider> { ... }

// AFTER (v6):
import { JsonRpcProvider, Wallet } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
export async function getFlashbotsProvider(
    provider: JsonRpcProvider,
    authSigner: Wallet
): Promise<FlashbotsBundleProvider> { ... }
```

### addLiquidity BigNumber migration

```typescript
// BEFORE (v5):
const maxWrapAmount = balance.sub(gasBuffer);
const wethAmount = maxWrapAmount.gt(0) ? maxWrapAmount : ethers.constants.Zero;
if (wethAmount.eq(0)) { ... }

// AFTER (v6):
const maxWrapAmount = balance - gasBuffer;
const wethAmount = maxWrapAmount > 0n ? maxWrapAmount : 0n;
if (wethAmount === 0n) { ... }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ethers v5 BigNumber class | Native BigInt (ethers v6) | ethers v6.0 (2023) | All arithmetic uses native operators, no wrapper class |
| `contract.callStatic.method()` | `contract.method.staticCall()` | ethers v6.0 | Per-method namespace, more consistent API |
| `ethers.utils.*` namespace | `ethers.*` flat exports | ethers v6.0 | All utilities at root, no nested namespace |
| `providers.JsonRpcProvider` | `JsonRpcProvider` (flat import) | ethers v6.0 | No `providers` namespace needed |
| `@nomiclabs/hardhat-ethers` | `@nomicfoundation/hardhat-ethers` v3.x | 2023 | Organization rename + ethers v6 support |
| `ethereum-waffle` | `@nomicfoundation/hardhat-chai-matchers` | 2022 | Waffle deprecated, matchers integrated into toolbox |
| `contract.deployed()` | `contract.waitForDeployment()` | ethers v6.0 | Clearer naming, consistent with async pattern |
| `contract.address` | `contract.target` | ethers v6.0 | Supports ENS + Addressable, not just string |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None (no test infrastructure exists) |
| Config file | None |
| Quick run command | `npx hardhat compile` (compilation check) |
| Full suite command | `npx hardhat compile && npx tsc --noEmit` (compile + type check) |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ETH6-01 | All v5 imports/APIs migrated to v6 | compile | `npx tsc --noEmit` | N/A (compiler is the test) |
| ETH6-01 | No v5 imports remain | grep | `grep -r "@ethersproject\|from.*ethers.*providers\." src/ scripts/` | N/A (grep is the test) |
| ETH6-02 | BigInt arithmetic correct, no Number() on wei | lint | `npx eslint src/ scripts/` | Wave 0: eslint.config.mjs |
| ETH6-03 | Flashbots bundle on Sepolia | manual | Manual: run Flashbots Sepolia bundle submission | N/A (manual per D-01) |
| ETH6-04 | Hardhat compile + deploy works | compile+script | `npx hardhat compile && npx hardhat run scripts/deploySepoliaTest.ts --network sepolia` | N/A (existing scripts are the test) |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit` (type-check the whole project)
- **Per wave merge:** `npx hardhat compile && npx tsc --noEmit && npx eslint src/ scripts/`
- **Phase gate:** Full suite + Sepolia deploy + Flashbots bundle test per D-01

### Wave 0 Gaps
- [ ] `eslint.config.mjs` -- ESLint flat config with `restrict-plus-operands` rule (D-07)
- [ ] ESLint install: `npm install -D eslint@9 typescript-eslint@8.57.1`

*(No test files needed -- verification is compilation + Sepolia deploy per D-01, D-02)*

## Open Questions

1. **Flashbots Sepolia relay availability**
   - What we know: The relay URL `https://relay-sepolia.flashbots.net` is configured in `flashbots.ts`. Flashbots docs list Sepolia support.
   - What's unclear: Whether the Sepolia relay is still actively maintained and accepting bundles in 2026. Relay availability can change.
   - Recommendation: If Sepolia relay is down, the verification can be done by confirming the provider creates successfully and the bundle submission code paths are correct at the type level. Document relay status at verification time.

2. **tokenSafety.ts already uses some v6-style patterns**
   - What we know: `hasHighTransferTax()` at line 237 already uses `bigint[]` type annotation and `0n` literal. `hasMaxWalletOrTxLimits()` at line 281 uses `bigint` annotation. These suggest partial v6 migration was started.
   - What's unclear: Whether these files currently compile successfully with ethers v5 (bigint annotations on v5 return types).
   - Recommendation: These are likely aspirational annotations that don't match runtime behavior under v5. After migration to v6, they will be correct. No special handling needed -- just verify they compile after migration.

3. **`balance.isZero()` in monitoring loops**
   - What we know: `bot.ts` uses `balance.isZero()` in 4 places (lines 79, 129, 171, 350). Under v6, `balanceOf()` returns `bigint`, which has no `.isZero()` method.
   - What's unclear: Nothing -- this is a definite breaking change.
   - Recommendation: Replace all `balance.isZero()` with `balance === 0n`.

## Sources

### Primary (HIGH confidence)
- [ethers v6 Migration Guide](https://docs.ethers.org/v6/migrating/) -- official breaking changes, all API renames
- [ethers v6 Contract API](https://docs.ethers.org/v6/api/contract/) -- contract.target, getAddress(), staticCall
- [@flashbots/ethers-provider-bundle@1.0.0 source](https://www.npmjs.com/package/@flashbots/ethers-provider-bundle) -- verified v6 imports from unpacked tarball
- npm registry -- all version numbers verified via `npm view` on 2026-03-20

### Secondary (MEDIUM confidence)
- [typescript-eslint restrict-plus-operands](https://typescript-eslint.io/rules/restrict-plus-operands/) -- BigInt/Number mixing detection rule
- [DEV Community migration guide](https://dev.to/mqdev/migrating-from-ethersjs-v5-to-v6-jj1) -- community migration patterns, cross-verified with official docs
- [Flashbots ethers.js Provider docs](https://docs.flashbots.net/flashbots-auction/libraries/ethers-js-provider) -- official usage patterns

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified against npm registry, peer dependency chains validated
- Architecture: HIGH -- every file read and migration patterns mapped line-by-line
- Pitfalls: HIGH -- based on official migration guide + codebase-specific analysis of actual code patterns
- Flashbots v1.0.0 API: HIGH -- source code extracted from npm tarball and verified

**Critical correction:** CONTEXT.md D-05 specifies `hardhat-ethers v4.0.4` but this requires Hardhat 3.x. The correct version for Hardhat 2.26.0 is `hardhat-ethers@3.1.2`. Planner must use v3.1.2.

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (stable ecosystem, ethers v6 is mature)
