# Phase 2: ethers v6 Migration - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate the entire codebase from ethers v5 (EOL) to ethers v6 with native BigInt arithmetic, upgrade Flashbots provider to v1.0.0, and modernize the Hardhat toolchain. No new features — only replacing v5 APIs with v6 equivalents and removing deprecated packages. All 14 files with ethers usage must be migrated.

</domain>

<decisions>
## Implementation Decisions

### Migration verification approach
- **D-01:** Verification = TypeScript compiles clean + Hardhat compiles/deploys contracts to Sepolia + Flashbots bundle submission confirmed on Sepolia
- **D-02:** No full snipe cycle test required — compilation + Sepolia deploy is sufficient confidence. Phase 9 adds proper test coverage later
- **D-03:** No burn-in period after migration — proceed straight to Phase 3 once verification passes

### Deprecated package cleanup
- **D-04:** Full cleanup of ALL v5-era packages — remove ethereum-waffle, @nomiclabs/hardhat-ethers, @nomiclabs/hardhat-etherscan, @nomiclabs/hardhat-waffle, @typechain/ethers-v5, and all @ethersproject/* sub-packages
- **D-05:** Replace with v6 equivalents: @nomicfoundation/hardhat-toolbox v6.1.0, @nomicfoundation/hardhat-ethers v4.0.4, @typechain/ethers-v6
- **D-06:** Clean break from v5 ecosystem — no v5 packages should remain in package.json after migration

### BigInt safety
- **D-07:** Add an ESLint rule to flag potential BigInt/Number mixing as a compile-time guardrail beyond TypeScript's type system
- **D-08:** No wrapper helper functions — use native BigInt operators directly. The ESLint rule provides the safety net

### Claude's Discretion
- Migration ordering (which files first, how to batch the work)
- Specific ESLint plugin/rule choice for BigInt safety
- Whether to cache contract addresses after getAddress() or call getAddress() each time
- Handling of edge cases in the v5→v6 API surface changes (callStatic → staticCall, etc.)
- Exact Hardhat config restructuring for toolbox v6

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — ETH6-01 through ETH6-04 define all migration requirements

### Migration patterns
- `.planning/research/STACK.md` §Migration Notes — Documents every v5→v6 API change pattern with files affected
- `.planning/research/STACK.md` §Version Compatibility Matrix — Critical version constraints (ethers↔flashbots↔hardhat compatibility)
- `.planning/research/STACK.md` §What NOT to Use — Lists all deprecated packages to remove

### Codebase inventory
- `.planning/codebase/STACK.md` — Current v5 dependency versions and configuration
- `.planning/codebase/CONCERNS.md` §Tech Debt — Ethers v5 EOL risk, type safety issues
- `.planning/codebase/CONCERNS.md` §Dependencies at Risk — Flashbots provider bundle compatibility notes

### Prior phase context
- `.planning/phases/01-bug-fixes-hardening/01-CONTEXT.md` — Phase 1 decisions that affect files being migrated (exitManager, flashbots relay config, storage patterns)

</canonical_refs>

<code_context>
## Existing Code Insights

### Files Requiring Migration (14 total)

**Heavy migration (extensive v5 usage):**
- `src/bot.ts` — ~20 BigNumber ops, 8+ Contract instances, parseEther/formatEther, router.interface.encodeFunctionData, event listeners
- `src/utils/tokenSafety.ts` — callStatic patterns, parseEther/parseUnits, 10+ Contract instances, provider creation
- `scripts/deploySepoliaTest.ts` — ContractFactory.deploy()/.deployed(), Interface for log parsing, parseEther

**Medium migration (provider + wallet + some BigNumber):**
- `src/utils/txManager.ts` — FlashbotsBundleProvider, BigNumber.from(), TransactionRequest from @ethersproject sub-package, provider.getNetwork().chainId
- `src/utils/gasManager.ts` — BigNumber.from(), .mul()/.div() for gas math, provider.getFeeData()
- `src/alphaDrop.ts` — JsonRpcProvider, Contract, ethers imports
- `scripts/addLiquidity.ts` — BigNumber ops (.sub, .gt, .eq), ethers.constants.Zero, ContractFactory

**Light migration (import path changes only):**
- `src/utils/flashbots.ts` — providers.JsonRpcProvider, Wallet import paths
- `src/utils/pairDiscovery.ts` — Contract, ethers import paths
- `src/utils/exitManager.ts` — Contract import
- `src/scripts/genAuthWallet.ts` — Wallet.createRandom() import path
- `scripts/manualTrigger.ts` — ethers imports
- `hardhat.config.ts` — Plugin imports change with toolbox v6

### Key v5→v6 Migration Patterns
- `BigNumber.from(x)` → `BigInt(x)` or `xn` literals
- `.mul()/.div()/.add()/.sub()` → native `* / + -` operators
- `.eq()/.lt()/.gt()/.isZero()` → `=== < > === 0n`
- `ethers.utils.parseEther()` → `ethers.parseEther()`
- `new ethers.providers.JsonRpcProvider()` → `new ethers.JsonRpcProvider()`
- `contract.callStatic.method()` → `contract.method.staticCall()`
- `contract.address` → `await contract.getAddress()` (now async)
- `ethers.constants.Zero` → `0n`
- `import { TransactionRequest } from "@ethersproject/abstract-provider"` → `import { TransactionRequest } from "ethers"`

### Established Patterns
- Config via environment variables in `src/config.ts` — migration must preserve this pattern
- Flashbots relay config uses Record<string, {url, network}> map (Phase 1 decision) — v1.0.0 upgrade must maintain this
- Per-token mutex in exitManager (Phase 1) — Contract import path changes only, logic untouched

### Integration Points
- `@flashbots/ethers-provider-bundle` 0.6.1 → 1.0.0: API surface may change beyond ethers v6 switch — researcher must verify
- Hardhat toolbox v2 → v6: Plugin registration and config format changes
- TypeChain: Must switch from @typechain/ethers-v5 to @typechain/ethers-v6 target

</code_context>

<specifics>
## Specific Ideas

No specific requirements — standard ethers v5→v6 migration following the official migration guide patterns documented in research.

</specifics>

<deferred>
## Deferred Ideas

- Singleton provider pattern (creating one provider per chain instead of per-function) — Phase 3: Code Quality (INFRA-02)
- Centralized ABI definitions — Phase 3: Code Quality (INFRA-03)
- Replacing console.log with structured logging — Phase 3: Code Quality (INFRA-01)
- TypeScript strictness improvements (replacing `any` types) — Phase 3: Code Quality
- WebSocket provider for real-time events instead of polling — Phase 4+ concern

</deferred>

---

*Phase: 02-ethers-v6-migration*
*Context gathered: 2026-03-20*
