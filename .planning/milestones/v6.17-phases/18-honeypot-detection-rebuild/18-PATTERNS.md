# Phase 18: Honeypot Detection Rebuild - Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 29 new/modified files
**Analogs found:** 23 / 29 (6 net-new with no existing analog)

This document maps every new/modified file in Phase 18 to its closest existing analog in the codebase, extracting concrete code excerpts that the planner should reference. Phase 18 introduces a **net-new pattern** (discriminated-union safety verdicts via `HoneypotResult`) that has no precedent — existing safety gates return `Promise<boolean>`. The planner must decide whether the 8 audited parallel-bank gates retrofit to the new shape under HONEY-11 or stay on `Promise<boolean>` (per CONTEXT.md `<code_context>` §"Established Patterns").

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `contracts/honeypot/HoneypotChecker.sol` | smart contract | request → roundtrip → revert-encoded result | `contracts/FakeToken.sol` | role-only (OZ pattern reuse) |
| `ignition/modules/HoneypotChecker.ts` | Hardhat Ignition module | declarative deploy spec | **NONE** (net-new tool) | net-new |
| `scripts/deploy-honeypot-checker.ts` | deploy script | env → spawn hardhat ignition → log address | `scripts/deploySepoliaTest.ts` | role-match |
| `src/utils/honeypot/index.ts` | dispatch layer | ctx.chain.method → switch → wrapper call | `src/utils/tokenSafety.ts` §`checkHoneypotForChain` lines 335-340 | exact |
| `src/utils/honeypot/checkerContract.ts` | RPC wrapper | provider.call → revert payload decode → discriminated verdict | `src/utils/tokenSafety.ts` §`simulateSellV3ForChain` lines 593-634 | role-match (input shape) |
| `src/utils/honeypot/simulator.ts` | RPC wrapper (stub) | throws `NotImplemented` | **NONE** (Phase 18 stub only) | net-new |
| `src/utils/honeypot/types.ts` | type declaration | discriminated union | `src/chainRegistry.ts` §`DexConfig` lines 20-31 (union pattern); `src/utils/safetyProviders/types.ts` | role-only |
| `src/utils/honeypot/bytecodeScan.ts` (HONEY-12) | RPC wrapper | provider.getCode → selector substring scan → flag | `src/utils/tokenSafety.ts` §`isBlacklistedTokenForChain` lines 357-361 | exact |
| `src/utils/honeypot/abi.ts` | type declaration | ABI fragment constant | `src/utils/abis.ts` (V3_QUOTER_V2_ABI pattern) | exact |
| `src/utils/tokenSafety.ts` MODIFY | (delete only) | n/a | self (lines 555-586, 593-634 deleted) | self |
| `src/bot.ts:220-226` MODIFY | gate replacement | dispatch → discriminated verdict → skip-or-pass | self (current gate at lines 220-226) | self |
| `src/bot.ts:411-416` MODIFY | gate replacement | same as above (V3 branch) | self (current gate at lines 411-416) | self |
| `src/bot.ts:229-238` MODIFY | parallel-bank extension | Promise.all add 9th gate | self (current Promise.all lines 229-238) | self |
| `src/bot.ts:268` MODIFY | alert augmentation | template-literal extension | self (current template at line 268) | self |
| `src/chainRegistry.ts` MODIFY | configuration extension | env → ChainConfig field | self (`safetyApis` lines 33-37, 129; `gas` lines 41-45) | self (pattern match) |
| `hardhat.config.ts` MODIFY | configuration extension | per-network record | self (current `networks` block) | self |
| `test/fixtures/contracts/Honeypot.sol` | test fixture (Solidity) | conditional `_transfer` revert | `contracts/FakeToken.sol` | role-match |
| `test/fork/fixtures/honeypots/README.md` + `*.json` | test fixture (data) | block-pinned JSON | **NONE** (net-new format) | net-new |
| `test/fork/honeypotChecker.fork.test.ts` | regression test | fork → deploy fixture → assert verdict | `test/fork/snipeLifecycle.test.ts` | exact |
| `test/fork/honeypotMultiAmount.fork.test.ts` | regression test | fork → 3 probes → assert per-probe verdict | `test/fork/snipeLifecycle.test.ts` | role-match |
| `test/integration/honeypotDispatch.test.ts` | regression test | vi.mock → dispatch routing | `test/integration/v3LiquidityWait.test.ts` | exact |
| `test/integration/honeypotUnknownFailsClosed.test.ts` | regression test | edge-case RPC error → assert NOT safe | `test/unit/tokenSafety.test.ts` | role-match |
| `test/integration/honeypotDeploy.eth.test.ts` (+ bsc/base/arb) | regression test | live RPC `getCode` against deployed address | `test/integration/v3LiquidityWait.test.ts` | role-match |
| `test/integration/v2HoneypotIntegration.test.ts` | regression test | `bot.ts:220-226` wired correctly | `test/integration/v3LiquidityWait.test.ts` | role-match |
| `test/integration/v3HoneypotIntegration.test.ts` | regression test | `bot.ts:411-416` wired correctly | `test/integration/v3LiquidityWait.test.ts` | role-match |
| `test/unit/honeypotTypes.test.ts` | regression test | tsc compile-gate assertions | `test/unit/ethersV6BigIntArithmetic.test.ts` (compile-gate pattern); `test/unit/chainRegistry.test.ts` | role-match |
| `test/unit/honeypotDispatch.test.ts` | regression test | dispatch unit | `test/unit/tokenSafety.test.ts` | exact |
| `test/unit/honeypotTaxThreshold.test.ts` | regression test | tax bps threshold cases | `test/unit/tokenSafety.test.ts` | role-match |
| `test/unit/bytecodeScan.test.ts` | regression test | mocked `getCode` → selector hits | `test/unit/tokenSafety.test.ts` | exact |
| `test/unit/safetyBank/*.test.ts` × 8 (HONEY-11) | regression test | edge-case → assert NOT vacuous-pass | `test/unit/tokenSafety.test.ts` (mock-the-Contract pattern) | exact |
| `scripts/check-mythril-report.ts` | RPC wrapper (CLI) | read JSON → severity gate → exit code | `scripts/deploySepoliaTest.ts` (wrapper structure) | role-only |

---

## Pattern Assignments

### `contracts/honeypot/HoneypotChecker.sol` (smart contract, request-response)

**Analog:** `contracts/FakeToken.sol`

**Role similarity:** Both are immutable Solidity contracts compiled under solc 0.8.28 (per `hardhat.config.ts:8`) that import from `@openzeppelin/contracts ^5.4.0`. FakeToken is 12 LOC; HoneypotChecker targets ~110-120 LOC.

**Imports pattern** (`contracts/FakeToken.sol` lines 1-4):
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
```

**Adaptation:**
- Pin solc to **exactly `0.8.28`** (matches `hardhat.config.ts` `solidity: "0.8.28"`). FakeToken uses `^0.8.28` (caret); HoneypotChecker uses exact `0.8.28` per RESEARCH.md §5 (line 725) for audit determinism.
- Import `IERC20` from `@openzeppelin/contracts/token/ERC20/IERC20.sol` (not ERC20.sol — only the interface is needed; smaller audit surface).
- Add custom local `interface IWETH` and `interface IUniswapV2Router02` declarations (no OZ Uniswap interface ships in `@openzeppelin/contracts ^5.4.0`).

**Concrete structure (from RESEARCH.md lines 719-840):**
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWETH { function deposit() external payable; function approve(address, uint256) external returns (bool); function balanceOf(address) external view returns (uint256); }
interface IUniswapV2Router02 {
    function swapExactETHForTokens(uint, address[] calldata, address, uint) external payable returns (uint[] memory);
    function swapExactTokensForETHSupportingFeeOnTransferTokens(uint, uint, address[] calldata, address, uint) external;
    function getAmountsOut(uint, address[] calldata) external view returns (uint[] memory);
    function WETH() external view returns (address);
}

contract HoneypotChecker {
    error RoundtripResult(uint256 buyTaxBps, uint256 sellTaxBps, uint8 status);
    error BuyFailed(string reason);
    error SellFailed(string reason);

    function check(address router, address token, uint256 amountIn) external payable {
        require(msg.value == amountIn, "VALUE_MISMATCH");
        // ... roundtrip per RESEARCH §5 ...
        revert RoundtripResult(buyTaxBps, sellTaxBps, status);
    }
    receive() external payable {}
}
```

**Net-new departures from analog:**
- FakeToken is a mintable ERC20; HoneypotChecker is a stateless verifier that **always reverts at end** (custom error as return channel — Pattern 3 from RESEARCH.md §"Architecture Patterns" lines 457-471).
- No constructor args (FakeToken takes name/symbol; HoneypotChecker is parameter-free per Ignition module `m.contract('HoneypotChecker', [])` per RESEARCH.md §6 line 881).
- No `selfdestruct`; no `tx.origin` use; no owner key (D-CONTRACT-IMMUTABLE).

---

### `ignition/modules/HoneypotChecker.ts` (Hardhat Ignition module, declarative deploy spec)

**Analog:** **NONE** — repo has no existing `ignition/` directory (Glob `ignition/**/*` returned no files).

**Net-new flag:** YES. Shape is well-defined by `@nomicfoundation/hardhat-ignition@^0.15.16` API (already in `package.json:36`).

**Authoritative shape (from RESEARCH.md §6 lines 876-884):**
```typescript
import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

export default buildModule('HoneypotCheckerModule', (m) => {
    const checker = m.contract('HoneypotChecker', []);
    return { checker };
});
```

**Adaptation notes:**
- Module name `'HoneypotCheckerModule'` is the deployment ID — Ignition writes `ignition/deployments/<network>/HoneypotCheckerModule/` directories per chain.
- `m.contract('HoneypotChecker', [])` — empty constructor args array (matches the contract).
- No `m.call(...)` follow-up; the contract is verify-and-go.
- Planner must add `ignition/` to `.gitignore` for `deployments/<chain>/journal.jsonl` (per Ignition convention) but **commit** `deployments/<chain>/deployed_addresses.json` so chainRegistry has source-of-truth.

---

### `scripts/deploy-honeypot-checker.ts` (deploy script, env → spawn hardhat ignition → log address)

**Analog:** `scripts/deploySepoliaTest.ts` lines 1-97

**Imports + dotenv pattern** (`scripts/deploySepoliaTest.ts` lines 1-13):
```typescript
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import FakeTokenJson from "../artifacts/contracts/FakeToken.sol/FakeToken.json";
// ...
import * as fs from "fs";
import * as path from "path";

dotenv.config();

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_URL);
    const deployer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
    console.log("👷 Deploying with:", await deployer.getAddress());
```

**Address-write pattern** (`scripts/deploySepoliaTest.ts` lines 81-91):
```typescript
const addressesPath = path.join(__dirname, "../src/addresses.json");
fs.writeFileSync(addressesPath, JSON.stringify({
    factoryAddress: await factory.getAddress(),
    routerAddress: await router.getAddress(),
    // ...
}, null, 2));
console.log(`📝 Addresses written to ${addressesPath}`);
```

**Top-level error handling** (`scripts/deploySepoliaTest.ts` lines 94-97):
```typescript
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
```

**Adaptation:**
- **Replace `PRIVATE_KEY` with `DEPLOY_PRIVATE_KEY`** per D-DEPLOY-KEY (bot wallet must NOT have deploy authority).
- **Use `spawnSync('npx', ['hardhat', 'ignition', 'deploy', ...])`** instead of inline `ethers.ContractFactory.deploy()` (RESEARCH.md §6 lines 921-924). Ignition handles nonce/receipt/idempotency.
- Replace ad-hoc `console.log` with the project's `pino` logger via `logger.child({ module: 'deploy-honeypot-checker' })` (matches `src/chainRegistry.ts:9` pattern).
- Add chain → network map (RESEARCH.md §6 lines 900-905): `{ eth: 'mainnet', bsc: 'bsc', base: 'base', arb: 'arbitrum' }`.
- Fail-fast if `DEPLOY_PRIVATE_KEY` missing (mimics `src/chainRegistry.ts:310-312` fatal-then-`process.exit(1)` pattern).
- Print the deployed address with explicit instructions to paste into `CHAIN_TEMPLATES.<chain>.honeypotChecker.deployedAddress` (operator manual step).

---

### `src/utils/honeypot/index.ts` (dispatch layer, request-response)

**Analog:** `src/utils/tokenSafety.ts` §`checkHoneypotForChain` lines 335-340

**Exact pattern match:** This existing function is the canonical "dispatch based on `ctx.chain.<feature>.<field>`" pattern. RESEARCH.md §"Pattern 1: Strategy Dispatch via ChainConfig" lines 397-431 specifically calls this shape out.

**Dispatch pattern** (`src/utils/tokenSafety.ts` lines 335-340):
```typescript
export async function checkHoneypotForChain(ctx: ChainContext, tokenAddress: string): Promise<boolean> {
    const provider = ctx.chain.safetyApis.honeypot;
    if (provider === 'honeypot.is') return honeypotIsCheck(ctx, tokenAddress);
    if (provider === 'goplus') return goplusHoneypotCheck(ctx, tokenAddress);
    throw new Error(`Unknown honeypot provider: ${provider}`);
}
```

**Sibling pattern** (`src/utils/tokenSafety.ts` lines 346-352):
```typescript
export async function isLiquidityLockedForChain(ctx: ChainContext, pairAddress: string): Promise<boolean> {
    const provider = ctx.chain.safetyApis.liquidityLock;
    if (provider === 'unicrypt') return unicryptLockCheck(ctx, pairAddress);
    if (provider === 'mudra') return mudraLockCheck(ctx, pairAddress);
    if (provider === 'goplus') return goplusLiquidityLockCheck(ctx, pairAddress);
    throw new Error(`Unknown liquidity lock provider: ${provider}`);
}
```

**Adaptation (new return type — diverges from analog):**
- **Return type changes from `Promise<boolean>` to `Promise<HoneypotResult>` (discriminated union).** This is the canonical net-new pattern for Phase 18 (RESEARCH.md §"Pattern 2: Discriminated-Union Verdicts" lines 433-455).
- **No `throw` on unknown method** — return `{ verdict: 'unknown', reason: 'bad-method', evidence: {} }` (RESEARCH.md §"Pattern 1" lines 419-430 shows exact shape).
- **Three branches:** `'on-chain-contract'` → `simulateViaContract`, `'eth_simulateV1'` → `simulateViaSimulator` (stub), else → `'unknown'`. Per CONTEXT D-CONTRACT-SCOPE and D-UNKNOWN-POLICY.
- **Pass `dex: DexConfig`** in addition to `ctx, token` so the wrapper can switch on `isDexV2`/`isDexV3` for router/quoter address sourcing (per RESEARCH.md §"V3 integration" lines 277-283).

**Concrete shape (from RESEARCH.md lines 408-430):**
```typescript
import { simulateViaContract } from './checkerContract';
import { simulateViaSimulator } from './simulator';
import type { ChainContext, DexConfig } from '../../chainRegistry';
import type { HoneypotResult } from './types';

export async function simulateHoneypotRoundtrip(
    ctx: ChainContext, dex: DexConfig, token: string,
): Promise<HoneypotResult> {
    const cfg = ctx.chain.honeypotChecker;
    if (cfg.method === 'on-chain-contract') {
        if (!cfg.deployedAddress) return { verdict: 'unknown', reason: 'no-deployed-address', evidence: { method: 'on-chain-contract' } };
        return simulateViaContract(ctx, dex, token, cfg.deployedAddress);
    }
    if (cfg.method === 'eth_simulateV1') return simulateViaSimulator(ctx, dex, token);
    return { verdict: 'unknown', reason: `bad-method:${cfg.method}`, evidence: { method: cfg.method } };
}
```

---

### `src/utils/honeypot/checkerContract.ts` (RPC wrapper, request → call → revert decode → discriminated verdict)

**Analog:** `src/utils/tokenSafety.ts` §`simulateSellV3ForChain` lines 593-634 (the function being DELETED in this phase; analog for **input shape only — the vacuous-pass logic is the anti-pattern Phase 18 is fixing**).

**Why this analog despite being deletion target:** The function-signature shape (`ctx: ChainContext, addressArg: string, tokenAddress: string, ...`), the `try/catch` envelope, the `ctx.log.warn(..., 'message')` discipline, and the `Contract` + `staticCall` paradigm are all reusable. **Only the verdict-return logic** (line 622-625 `if amountOut === 0n return false`; line 603-606 vacuous pass) gets replaced.

**Function signature pattern** (`src/utils/tokenSafety.ts` lines 593-598):
```typescript
export async function simulateSellV3ForChain(
    ctx: ChainContext,
    quoterAddress: string,
    tokenAddress: string,
    feeTier: number
): Promise<boolean> {
    try {
```

**Error envelope pattern** (`src/utils/tokenSafety.ts` lines 629-633):
```typescript
} catch (e) {
    // QuoterV2 reverts instead of returning 0 when liquidity is insufficient (Pitfall 3 from research)
    ctx.log.warn({ err: e, token: tokenAddress }, 'V3 sell simulation failed (QuoterV2 revert -- likely illiquid)');
    return false;
}
```

**Contract instantiation + staticCall pattern** (`src/utils/tokenSafety.ts` lines 608, 620):
```typescript
const quoter = new Contract(quoterAddress, V3_QUOTER_V2_ABI, ctx.httpProvider);
// ...
const [amountOut] = await quoter.quoteExactInputSingle.staticCall(quoteParams);
```

**Adaptation (significant divergence):**

1. **Replace `staticCall` with raw `provider.call`** (RESEARCH.md §"Pattern 3" lines 481-488):
```typescript
const data = iface.encodeFunctionData('check', [routerAddress, tokenAddress, amountWei]);
await ctx.httpProvider.call({
    to: deployedAddress,
    data,
    value: amountWei,
    from: ctx.wallet.address,    // mitigates tx.origin spoofing per RESEARCH PITFALLS #4
});
```

2. **Decode revert payload via `Interface.parseError`** (RESEARCH.md §"Pattern 3" lines 491-507):
```typescript
} catch (e: unknown) {
    const err = e as { data?: string; info?: { error?: { data?: string } }; message?: string };
    const revertData = err.data ?? err.info?.error?.data ?? '';
    if (revertData) {
        const parsed = iface.parseError(revertData);
        if (parsed && parsed.name === 'RoundtripResult') {
            const [buyTaxBps, sellTaxBps, status] = parsed.args;
            const ok = Number(status) === 0x07;
            return ok
                ? { verdict: 'safe', evidence: { buyTaxBps: Number(buyTaxBps), sellTaxBps: Number(sellTaxBps), method: 'on-chain-contract' } }
                : { verdict: 'unsafe', reason: `status=0x${Number(status).toString(16).padStart(2,'0')}`, evidence: { buyTaxBps: Number(buyTaxBps), sellTaxBps: Number(sellTaxBps), method: 'on-chain-contract' } };
        }
    }
    return { verdict: 'unsafe', reason: err.message ?? 'unknown-revert', evidence: { method: 'on-chain-contract', revertReason: err.message } };
}
```

3. **3 probes** per HONEY-10 / D-AGGREGATION (RESEARCH.md §8 lines 1098-1103):
```typescript
const snipeWei = ethers.parseEther(ctx.chain.snipeAmount);
const probes = [
    { label: '1%',   amount: snipeWei / 100n, gating: false },
    { label: '50%',  amount: snipeWei / 2n,   gating: true  },
    { label: '100%', amount: snipeWei,        gating: true  },
];
// for each probe: provider.call → parseError → push to probeResults; then aggregate
```

4. **NEVER vacuous-pass:** the line `if (balance === 0n) return true;` from `simulateSellV3ForChain:603-606` is the canonical anti-pattern this phase is FIXING. The new wrapper must have **NO `verdict: 'safe'` branch that lacks evidence-of-roundtrip** (RESEARCH.md §"Pitfall A: Vacuous-Pass Regression" lines 1154-1174).

5. **Pass `dex: DexConfig`** and read `routerAddress` from `dex.routerAddress` (V2) or `dex.swapRouterAddress` (V3) using `isDexV2`/`isDexV3` type guards from `chainRegistry.ts:400-406`.

---

### `src/utils/honeypot/simulator.ts` (RPC wrapper stub, Option-C stub only)

**Analog:** **NONE** — net-new file with explicit stub-only mandate.

**Net-new flag:** YES. Phase 18 ships the dispatch layer + a stub per CONTEXT.md `<canonical_refs>` line 281 ("stub/skeleton only").

**Required shape:**
```typescript
import type { ChainContext, DexConfig } from '../../chainRegistry';
import type { HoneypotResult } from './types';

export async function simulateViaSimulator(
    _ctx: ChainContext, _dex: DexConfig, _token: string,
): Promise<HoneypotResult> {
    return {
        verdict: 'unknown',
        reason: 'NOT_IMPLEMENTED: eth_simulateV1 path is stubbed in Phase 18',
        evidence: { method: 'eth_simulateV1' },
    };
}
```

**Adaptation notes:**
- Returns `'unknown'` (not throws) so dispatch layer handles uniformly per D-UNKNOWN-POLICY.
- Prefix unused params with `_` (matches project ESLint config — confirmed via `tokenSafety.ts:561` `try` block style with no-unused-vars convention).
- **No real implementation in Phase 18.** Promoted in v6.18+ per `<deferred>` line 421-423.

---

### `src/utils/honeypot/types.ts` (type declaration, discriminated union)

**Analogs:**
- `src/chainRegistry.ts` lines 20-31 (`DexConfig` discriminated union via `dexType: 'v2' | 'v3'`)
- `src/utils/safetyProviders/types.ts` (sibling-level types file in a `utils/<feature>/` subdir)

**Existing discriminated-union pattern** (`src/chainRegistry.ts` lines 20-31):
```typescript
export interface DexConfigV2 extends DexConfigBase {
    dexType: 'v2';
    routerAddress: string;
}

export interface DexConfigV3 extends DexConfigBase {
    dexType: 'v3';
    swapRouterAddress: string;
    quoterAddress: string;
}

export type DexConfig = DexConfigV2 | DexConfigV3;
```

**Existing type-only file pattern** (`src/utils/safetyProviders/types.ts` lines 1-16):
```typescript
// src/utils/safetyProviders/types.ts
// Function signatures for chain-aware safety check dispatchers.

import type { ChainContext } from '../../chainRegistry';

/** Checks whether a token is a honeypot (returns true if honeypot detected). */
export type HoneypotCheckFn = (ctx: ChainContext, tokenAddress: string) => Promise<boolean>;
```

**Adaptation (new shape — from RESEARCH.md §"Pattern 2" lines 442-455):**
```typescript
export interface HoneypotEvidence {
    buyTaxBps?: number;
    sellTaxBps?: number;
    revertReason?: string;
    probeResults?: Array<{ amountWei: string; ok: boolean; reason?: string; buyTaxBps?: number; sellTaxBps?: number }>;
    method: 'on-chain-contract' | 'eth_simulateV1' | 'bytecode-scan';
}

export type HoneypotResult =
    | { verdict: 'safe';    evidence: HoneypotEvidence }
    | { verdict: 'unsafe';  reason: string; evidence: HoneypotEvidence }
    | { verdict: 'unknown'; reason: string; evidence: HoneypotEvidence };
```

**Critical TypeScript discipline (Phase 17 D-13/D-14 carryover):**
- **Tighten the `safe` variant for HONEY-09:** `safe` requires `evidence.buyTaxBps` AND `evidence.sellTaxBps` to be `number` (NOT `number | undefined`). RESEARCH.md §"Pitfall A" line 1166: encode as `{ verdict: 'safe'; evidence: { buyTaxBps: number; sellTaxBps: number; method: string } }`. This makes vacuous-pass **unrepresentable at the type level** (a literal `return { verdict: 'safe', evidence: {} }` will fail `tsc --noEmit`).

---

### `src/utils/honeypot/bytecodeScan.ts` (RPC wrapper, getCode → substring scan → flag)

**Analog:** `src/utils/tokenSafety.ts` §`isBlacklistedTokenForChain` lines 357-361 (exact pattern match)

**Existing getCode + selector-substring pattern** (`src/utils/tokenSafety.ts` lines 357-361):
```typescript
export async function isBlacklistedTokenForChain(ctx: ChainContext, tokenAddress: string): Promise<boolean> {
    const antiBotSelectors = ["0xdd62ed3e", "0x4f7fb7c3", "0x60fe47b1"];
    const bytecode = await ctx.httpProvider.getCode(tokenAddress);
    return antiBotSelectors.some(sig => bytecode.includes(sig));
}
```

**This is literally the same pattern HONEY-12 needs.** Copy the structure verbatim; differences are: (a) larger selector table (19 vs 3 entries), (b) richer return type (`{ isMutable, hits }` vs `boolean`) so evidence flows to alerts, (c) lowercased bytecode comparison for case-safety.

**Adaptation (from RESEARCH.md §7 lines 998-1031):**
```typescript
import type { ChainContext } from '../../chainRegistry';

const MUTABLE_SELECTORS = [
    '2e5bb6ff', '667f6526', 'dc1052e2', '8cd09d50', '6081752b',
    '49abdc14', '5d0044ca', 'ea1644d5', 'ec28438a', '153b0d1e',
    '4e054a67', 'f9f92be4', 'e57f14e1', 'c0246668', '1031e36e',
    '365ec5e5', '8f70ccf7', 'c2e5ec04', '0b78f9c0',
];

export interface MutableScanResult { isMutable: boolean; hits: string[]; }

export async function isMutableTokenForChain(
    ctx: ChainContext, tokenAddress: string,
): Promise<MutableScanResult> {
    try {
        const code = await ctx.httpProvider.getCode(tokenAddress);
        if (!code || code === '0x') return { isMutable: false, hits: [] };
        const codeLower = code.toLowerCase();
        const hits = MUTABLE_SELECTORS.filter(sel => codeLower.includes(sel));
        return { isMutable: hits.length > 0, hits };
    } catch (e) {
        ctx.log.warn({ err: e, token: tokenAddress, check: 'bytecodeScan' }, 'Bytecode scan failed');
        return { isMutable: true, hits: ['scan-failed'] };  // fail-closed
    }
}
```

**Departures from `isBlacklistedTokenForChain`:**
- Strip `0x` from selectors before substring matching (RESEARCH uses `'2e5bb6ff'` without prefix). Compare against `code.toLowerCase()`.
- **Fail-closed** in catch: return `isMutable: true` with `hits: ['scan-failed']`. This is the inverse of `isBlacklistedTokenForChain`'s implicit behavior (the existing function doesn't catch — if `getCode` throws it propagates). Per D-UNKNOWN-POLICY and Phase 18's "always fail-CLOSED" mandate (RESEARCH PITFALLS #1, §"Anti-Pattern 4" ARCHITECTURE.md lines 1023-1031).

---

### `src/utils/honeypot/abi.ts` (type declaration, ABI fragment constant)

**Analog:** `src/utils/abis.ts` (existing constant-export pattern; specifically `V3_QUOTER_V2_ABI` used at `tokenSafety.ts:8`)

**Pattern:** Centralize ABI fragments as named exports; consumers `import { HONEYPOT_CHECKER_ABI } from './abi'`. The check ABI is small — just the `check(address,address,uint256)` function and the `RoundtripResult(uint256,uint256,uint8)` custom error.

**Adaptation:**
```typescript
export const HONEYPOT_CHECKER_ABI = [
    'function check(address router, address token, uint256 amountIn) external payable',
    'error RoundtripResult(uint256 buyTaxBps, uint256 sellTaxBps, uint8 status)',
    'error BuyFailed(string reason)',
    'error SellFailed(string reason)',
] as const;
```

Human-readable ABI (matches `test/fork/snipeLifecycle.test.ts:14-29` style for inline ABIs).

---

### `src/utils/tokenSafety.ts` (MODIFY — delete `simulateSellForChain` lines 555-586 + `simulateSellV3ForChain` lines 593-634)

**Analog:** Self.

**Action:**
1. **DELETE** `simulateSellForChain` (lines 555-586) entirely.
2. **DELETE** `simulateSellV3ForChain` (lines 593-634) entirely.
3. **PRESERVE** the other 8 chain-aware safety functions verbatim **unless** HONEY-11 audit retrofits identify a vacuous-pass or amountIn=0 bug. Specifically preserve signatures of:
   - `checkHoneypotForChain` lines 335-340
   - `isLiquidityLockedForChain` lines 346-352
   - `isBlacklistedTokenForChain` lines 357-361
   - `checkTokenMetadataForChain` lines 366-387
   - `simulateSwapForChain` lines 392-416
   - `isLiquiditySufficientForChain` lines 421-447
   - `isKnownBadTokenForChain` lines 452-470
   - `hasHighTransferTaxForChain` lines 475-508
   - `hasMaxWalletOrTxLimitsForChain` lines 513-550
4. **DELETE** the unused `V3_QUOTER_V2_ABI` import on line 8 IFF no other caller uses it (planner verifies — `simulateSellV3ForChain` is the only caller in this file; `bot.ts` may still reference it for V3 quote-based slippage calc at `bot.ts:455+`, so keep the import).

**Caveat per CONTEXT D-AUDIT-BAR:** HONEY-11 audit MAY retrofit these functions to return discriminated unions. Planner decides scope per D-STOP-THE-LINE.

---

### `src/bot.ts:220-226` MODIFY (V2 gate, in-place replacement)

**Analog:** Self (current gate at lines 220-226).

**Current shape** (`src/bot.ts:220-226`):
```typescript
// Sell simulation: always-on, hard block on failure (FIX-04)
const canSell = await simulateSellForChain(ctx, dex.routerAddress, targetToken);
if (!canSell) {
    ctx.log.warn({ token: targetToken }, 'Sell simulation failed, skipping buy');
    await sendCtxAlert(ctx, `*Sell simulation failed for* \`${targetToken}\` -- buy skipped`);
    return;
}
```

**Adaptation (in-place replacement per HONEY-07):**
```typescript
// HONEY-07: replaces broken simulateSellForChain with HoneypotChecker roundtrip dispatch
const honeypotResult = await simulateHoneypotRoundtrip(ctx, dex, targetToken);
if (honeypotResult.verdict !== 'safe') {
    ctx.log.warn({
        token: targetToken,
        verdict: honeypotResult.verdict,
        reason: honeypotResult.verdict === 'safe' ? undefined : honeypotResult.reason,
        buyTaxBps: honeypotResult.evidence.buyTaxBps,
        sellTaxBps: honeypotResult.evidence.sellTaxBps,
        method: honeypotResult.evidence.method,
    }, 'Honeypot gate blocked snipe');
    // D-ALERTS tiered format
    const taxInfo = honeypotResult.evidence.buyTaxBps !== undefined
        ? ` tax: buy ${honeypotResult.evidence.buyTaxBps}bps sell ${honeypotResult.evidence.sellTaxBps}bps`
        : '';
    const reason = honeypotResult.verdict !== 'safe' ? honeypotResult.reason : '';
    await sendCtxAlert(ctx, `*SKIP* \`${targetToken}\` -- ${honeypotResult.verdict} (${reason})${taxInfo}\n[Etherscan](${ctx.chain.explorerUrl}/token/${targetToken})`);
    return;
}
```

**Preserve:**
- Surrounding flow: lines 205-218 (canSnipe risk gate) BEFORE; lines 229-238 (parallel bank Promise.all) AFTER.
- The `return;` early-exit semantic (atomic skip).
- `sendCtxAlert` Telegram dispatch (existing function; matches `src/bot.ts:201, 208, 216, 224` usage).

---

### `src/bot.ts:411-416` MODIFY (V3 gate, in-place replacement)

**Analog:** Self (current gate at lines 411-416).

**Current shape** (`src/bot.ts:411-416`):
```typescript
// V3 sell simulation using QuoterV2 (Pitfall 6: must use V3 quoter, not V2 router)
const canSell = await simulateSellV3ForChain(ctx, dex.quoterAddress, targetToken, feeTier);
if (!canSell) {
    ctx.log.warn({ token: targetToken, feeTier }, 'V3 sell simulation failed, skipping buy');
    await sendCtxAlert(ctx, `*V3 sell simulation failed for* \`${targetToken}\` -- buy skipped`);
    return;
}
```

**Adaptation:** **Same dispatch as V2** (no V3-specific branch in TS — the contract handles V2/V3 router differences internally per HoneypotChecker.sol design). RESEARCH.md §"V3 integration" lines 277-283 confirms.

```typescript
// HONEY-08: replaces broken simulateSellV3ForChain (vacuous pass on zero balance) with HoneypotChecker dispatch
const honeypotResult = await simulateHoneypotRoundtrip(ctx, dex, targetToken);
// ... same skip logic as V2 gate above; reuse the same alert format ...
```

**Per RESEARCH.md §5 lines 850-855:** Planner may either ship V2-only checker (and add `checkV3()` in a future wave) or extend `check()` to accept `dexType` enum. **Recommendation (a)** — separate `checkV3()` function in the contract; dispatch layer reads `dex.dexType` and calls the right one.

---

### `src/bot.ts:229-238` MODIFY (parallel-bank extension, add 9th gate)

**Analog:** Self (current Promise.all at lines 229-238).

**Current shape** (`src/bot.ts:229-238`):
```typescript
// Parallel safety checks using chain-aware versions
const [isHoneypot, isBlacklisted, locked, sufficientLiquidity, validMetadata, canSwap, hasTax, hasLimits] = await Promise.all([
    checkHoneypotForChain(ctx, targetToken),
    isBlacklistedTokenForChain(ctx, targetToken),
    isLiquidityLockedForChain(ctx, pairAddress),
    isLiquiditySufficientForChain(ctx, pairAddress),
    checkTokenMetadataForChain(ctx, targetToken),
    simulateSwapForChain(ctx, dex.routerAddress, targetToken),
    hasHighTransferTaxForChain(ctx, dex.routerAddress, targetToken),
    hasMaxWalletOrTxLimitsForChain(ctx, targetToken),
]);
```

**Adaptation (HONEY-12 9th gate):**
```typescript
const [isHoneypot, isBlacklisted, locked, sufficientLiquidity, validMetadata, canSwap, hasTax, hasLimits, mutableResult] = await Promise.all([
    checkHoneypotForChain(ctx, targetToken),
    isBlacklistedTokenForChain(ctx, targetToken),
    isLiquidityLockedForChain(ctx, pairAddress),
    isLiquiditySufficientForChain(ctx, pairAddress),
    checkTokenMetadataForChain(ctx, targetToken),
    simulateSwapForChain(ctx, dex.routerAddress, targetToken),
    hasHighTransferTaxForChain(ctx, dex.routerAddress, targetToken),
    hasMaxWalletOrTxLimitsForChain(ctx, targetToken),
    isMutableTokenForChain(ctx, targetToken),   // HONEY-12 — 9th gate, returns { isMutable, hits }
]);
```

**Extend the line-270 conjunction** (`src/bot.ts:270`):
```typescript
// BEFORE: if (isHoneypot || isBlacklisted || !locked || ... || hasLimits) {
// AFTER:
if (isHoneypot || isBlacklisted || !locked || !sufficientLiquidity || !validMetadata || !canSwap || hasTax || hasLimits || mutableResult.isMutable) {
    ctx.log.info({ token: targetToken, checks: { isHoneypot, isBlacklisted, locked, sufficientLiquidity, validMetadata, canSwap, hasTax, hasLimits, mutable: mutableResult.isMutable, mutableHits: mutableResult.hits } }, 'Safety checks failed, skipping');
    return;
}
```

**For V3 branch (`bot.ts:421-427`):** Same `isMutableTokenForChain` addition to the V3 Promise.all (per ARCHITECTURE.md line 350: "Order preserved").

---

### `src/bot.ts:268` MODIFY (alert augmentation)

**Analog:** Self (current template-literal alert at line 268).

**Current shape** (`src/bot.ts:268`):
```typescript
await sendCtxAlert(ctx, `*New Token Detected!*\nSymbol: \`${symbol}\`\nDecimals: \`${decimals}\`\nW${ctx.chain.nativeCurrency} LP: \`${nativeLiquidity} ${ctx.chain.nativeCurrency}\`\nLocked: \`${locked ? "Yes" : "No"}\`\nHoneypot: \`${isHoneypot ? "Yes" : "No"}\`\nBlacklist Function: \`${isBlacklisted ? "Yes" : "No"}\`\nMaxTx/Wallet: \`${hasLimits ? "Yes" : "No"}\`\n\nToken: [\`${targetToken}\`](${ctx.chain.explorerUrl}/token/${targetToken})\nPair: [\`${pairAddress}\`](${ctx.chain.explorerUrl}/address/${pairAddress})`);
```

**Adaptation per D-ALERTS:**
- **Safe-verdict path:** Minimal augmentation. Add `BuyTax: \`${honeypotResult.evidence.buyTaxBps}bps\`\nSellTax: \`${honeypotResult.evidence.sellTaxBps}bps\`` between `Honeypot:` and `Blacklist Function:` lines.
- **Skip-verdict path:** Use the tiered `*SKIP* token -- verdict (reason) tax: buy Xbps sell Ybps` format already defined in the `bot.ts:220-226` adaptation above (D-ALERTS in CONTEXT lines 147-153).

**Preserve:** Markdown formatting; Etherscan links; `sendCtxAlert` signature.

---

### `src/chainRegistry.ts` MODIFY (configuration extension)

**Analog:** Self.

**Existing per-chain field pattern** (`src/chainRegistry.ts` lines 33-37, 41-45):
```typescript
export interface SafetyApiConfig {
    honeypot: 'honeypot.is' | 'goplus';
    liquidityLock: 'unicrypt' | 'mudra' | 'goplus';
    tokenSecurity: 'goplus';
}
// ...
export interface GasConfig {
    type: 'eip1559' | 'legacy';
    multiplier: number;
    maxGasLimit: bigint;
}
```

**Existing env-driven overlay pattern** (`src/chainRegistry.ts` lines 297-299):
```typescript
const snipeAmount = process.env[`${template.envPrefix}_SNIPE_AMOUNT`] || template.defaultSnipeAmount;
const maxCapital = process.env[`${template.envPrefix}_MAX_CAPITAL`] || template.defaultMaxCapital;
const minLiquidityThreshold = process.env[`${template.envPrefix}_MIN_LIQUIDITY`] || template.defaultMinLiquidityThreshold;
```

**Existing ChainTemplate → ChainConfig flow** (`src/chainRegistry.ts` lines 99-138, 334-352):

The pattern is: (1) define `interface ChainConfig` field, (2) define template default in `CHAIN_TEMPLATES.<chain>`, (3) overlay env in `buildChainRegistry()`, (4) copy into `ChainConfig` object.

**Adaptation (3-step diff):**

**Step 1 — extend `ChainConfig` interface** (after line 65):
```typescript
export interface HoneypotCheckerConfig {
    deployedAddress: string | null;     // null when method !== 'on-chain-contract' OR not yet deployed
    method: 'on-chain-contract' | 'eth_simulateV1';
    maxBuyTaxBps: number;               // default 1000 per D-TAX-THRESHOLDS
    maxSellTaxBps: number;
}

export interface ChainConfig {
    // ... existing fields ...
    honeypotChecker: HoneypotCheckerConfig;
}
```

**Step 2 — extend each `CHAIN_TEMPLATES.<chain>` entry.** Since `deployedAddress` per-chain comes from `.env` (post-deploy), the template carries `null` and the builder pulls the address from `process.env[<ETH|BSC|BASE|ARB>_HONEYPOT_CHECKER_ADDRESS]` (matches the existing env-overlay pattern):

```typescript
// In ChainTemplate interface (line 79-97):
honeypotMethod: 'on-chain-contract' | 'eth_simulateV1';
defaultMaxBuyTaxBps: number;
defaultMaxSellTaxBps: number;

// Per-template (each of eth/bsc/base/arb):
honeypotMethod: 'on-chain-contract',
defaultMaxBuyTaxBps: 1000,
defaultMaxSellTaxBps: 1000,
```

**Step 3 — overlay in `buildChainRegistry`** (after line 299):
```typescript
const honeypotCheckerAddress = process.env[`${template.envPrefix}_HONEYPOT_CHECKER_ADDRESS`] || null;
const maxBuyTaxBps = parseInt(process.env[`${template.envPrefix}_MAX_BUY_TAX_BPS`] || String(template.defaultMaxBuyTaxBps), 10);
const maxSellTaxBps = parseInt(process.env[`${template.envPrefix}_MAX_SELL_TAX_BPS`] || String(template.defaultMaxSellTaxBps), 10);
// ...
const chainConfig: ChainConfig = {
    // ... existing fields ...
    honeypotChecker: {
        deployedAddress: honeypotCheckerAddress,
        method: template.honeypotMethod,
        maxBuyTaxBps,
        maxSellTaxBps,
    },
};
```

**Preserve:**
- The `enabled` fail-fast pattern at line 308-323 (fatal-then-`process.exit(1)` if required env missing for enabled chains).
- The dynamic `mevConfig` build pattern at line 326-332.
- The type guards `isDexV2` / `isDexV3` at line 400-406 — used by the new dispatch layer.

---

### `hardhat.config.ts` MODIFY (configuration extension, multi-network for deploys)

**Analog:** Self (current `networks` record at lines 9-24).

**Current shape** (`hardhat.config.ts:1-27`):
```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
    solidity: "0.8.28",
    networks: {
        ...(process.env.ALCHEMY_URL ? { sepolia: { url: process.env.ALCHEMY_URL, accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [], } } : {}),
        hardhat: { forking: { url: process.env.ETH_FORK_RPC_URL || process.env.ALCHEMY_URL || '', enabled: !!process.env.ETH_FORK_RPC_URL || !!process.env.ALCHEMY_URL, }, },
    },
};

export default config;
```

**Adaptation (from RESEARCH.md §6 lines 938-963):**
- Add `mainnet`, `bsc`, `base`, `arbitrum` network entries — each conditional on `<CHAIN>_RPC_URL && DEPLOY_PRIVATE_KEY`.
- Use **`DEPLOY_PRIVATE_KEY`** for `accounts: [...]` (NOT bot's `PRIVATE_KEY` — per D-DEPLOY-KEY capability separation).
- Add `etherscan: { apiKey: { ... } }` block for `@nomicfoundation/hardhat-verify` (already in `package.json:40`).
- **Preserve** the existing `sepolia` and `hardhat` blocks unchanged (`sepolia` uses `PRIVATE_KEY` for sepolia-only test deploys; `hardhat` is fork-test infrastructure).
- Add `@nomicfoundation/hardhat-ignition-ethers` import (already a dep at `package.json:37`).

---

### `test/fixtures/contracts/Honeypot.sol` (test fixture, conditional `_transfer` revert)

**Analog:** `contracts/FakeToken.sol`

**Analog import + structure** (`contracts/FakeToken.sol:1-12`):
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FakeToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

**Adaptation:**
- Same OZ-based ERC20 inheritance.
- Constructor accepts a `uint8 mode` flag selecting one of 4 honeypot patterns (per RESEARCH.md §"What's the Smallest Fixture Set?" lines 1463-1472):
  - Mode 0: `transfer()` reverts when `from != owner` (sell-revert pattern).
  - Mode 1: `transfer()` succeeds but does not update balance (lying-balanceOf).
  - Mode 2: max-wallet trap (transfer reverts if recipient holds > N% of supply).
  - Mode 3: zero-ETH-on-sell (transfer succeeds but burns the value silently).
- Override `_update` (OZ 5.x replaces `_beforeTokenTransfer` with `_update`) to inject conditional reverts based on `mode`.

**Net-new departure:** FakeToken is a happy-path mock; the Honeypot fixture is a fault-injection mock.

---

### `test/fork/fixtures/honeypots/README.md` + `*.json` (test fixture data)

**Analog:** **NONE** — no existing JSON fixture pattern under `test/fork/fixtures/`.

**Net-new flag:** YES. Phase 18 establishes the format.

**Required JSON schema (from RESEARCH.md §3 lines 651-665):**
```json
{
  "chain": "eth",
  "tokenAddress": "0x...",
  "pairAddress": "0x...",
  "routerAddress": "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  "forkBlockNumber": 18500000,
  "expectedVerdict": "unsafe",
  "expectedRevertContains": "BUY_BAL_ZERO",
  "bugPattern": "sell-revert",
  "notes": "Token reverts in _beforeTokenTransfer when sender != owner",
  "discoveredVia": "honeypot.is",
  "discoveredOn": "2026-05-15"
}
```

**Per CONTEXT D-FIXTURE:** Researcher identifies 1-2 historical mainnet honeypots; planner finalizes selection during planning (Wave 0).

---

### `test/fork/honeypotChecker.fork.test.ts` (regression test, fork → deploy fixture → assert verdict)

**Analog:** `test/fork/snipeLifecycle.test.ts` lines 1-100+

**Imports + provider setup pattern** (`test/fork/snipeLifecycle.test.ts:1-12, 40-51`):
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

// Real Uniswap V2 addresses on mainnet (available on fork)
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
// ...
beforeAll(async () => {
    provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545', undefined, { cacheTimeout: -1 });
    deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
    factory = new ethers.Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, deployer);
    router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, deployer);
});
```

**Artifact load + deploy pattern** (`test/fork/snipeLifecycle.test.ts:55-65`):
```typescript
const artifactPath = path.resolve(__dirname, '../../artifacts/contracts/FakeToken.sol/FakeToken.json');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
const contractFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
const deployed = await contractFactory.deploy('FakeToken', 'FAKE');
await deployed.waitForDeployment();
```

**Adaptation:**
- Load `HoneypotChecker.sol` artifact from `artifacts/contracts/honeypot/HoneypotChecker.sol/HoneypotChecker.json` (matches `npx hardhat compile` output convention).
- Deploy HoneypotChecker once in `beforeAll`.
- Deploy `test/fixtures/contracts/Honeypot.sol` with each of 4 modes in subsequent `describe.each` blocks.
- For each mode, call `simulateHoneypotRoundtrip` via the new dispatch layer and assert `verdict === 'unsafe'`.
- For the real pinned fixtures: use `hardhat_reset` JSON-RPC to fork from a specific block per JSON fixture's `forkBlockNumber`, then run the same assertion.

**Preserve:**
- Fork setup at `test/fork/setup.ts` (lines 1-46) — spawns `npx hardhat node --fork`, waits for "Started HTTP" output, exposes RPC at `http://127.0.0.1:8545`. No changes needed.
- `globalSetup: ['test/fork/setup.ts']` in `vitest.config.ts:36`.

---

### `test/fork/honeypotMultiAmount.fork.test.ts` (regression test, 3-probe semantics)

**Analog:** `test/fork/snipeLifecycle.test.ts` (fork-test scaffolding).

**Test shape:**
- Deploy a token whose `_transfer` reverts ONLY on amounts > N tokens (amount-tiered trap).
- Run dispatch with `snipeAmount=0.003 ETH`; assert:
  - 1% probe: `safe` (below the tier).
  - 50% probe: `unsafe` (above tier; in D-AGGREGATION gating range).
  - 100% probe: `unsafe`.
  - Aggregate verdict: `unsafe` (any gating probe revert → unsafe).
- Counter-test: token reverts only on amounts < 1000 wei. Run with `snipeAmount=0.003 ETH`; assert all 3 probes are above-threshold = safe, but the 1% probe revert is logged as advisory evidence (`evidence.probeResults[0].ok = false` but `verdict === 'safe'`).

**Net-new test pattern** — no existing test in `test/fork/` exercises multi-probe semantics. Use `snipeLifecycle.test.ts` as scaffolding only.

---

### `test/integration/honeypotDispatch.test.ts` (regression test, vi.mock-driven dispatch routing)

**Analog:** `test/integration/v3LiquidityWait.test.ts` lines 1-60

**vi.doMock pattern** (`test/integration/v3LiquidityWait.test.ts:27-47`):
```typescript
vi.doMock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    return { ...actual, Contract: MockContract };
});

vi.doMock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({ info: loggerInfoMock, warn: loggerWarnMock, debug: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
        info: loggerInfoMock, warn: loggerWarnMock,
    },
}));
```

**DB-mock pattern** (`test/integration/v3LiquidityWait.test.ts:58-60+`):
```typescript
vi.doMock('../../src/utils/db', () => {
    // Statement-shaped stub to prevent SQLite file I/O on transitive imports
    // ...
});
```

**Adaptation:**
- Mock `checkerContract.simulateViaContract` and `simulator.simulateViaSimulator` via `vi.doMock`.
- Build a `ctx` with `ctx.chain.honeypotChecker.method = 'on-chain-contract'`; assert `simulateViaContract` was called.
- Toggle to `method = 'eth_simulateV1'`; assert `simulateViaSimulator` was called.
- Toggle to bogus method; assert verdict is `'unknown'` with no underlying call.

---

### `test/integration/honeypotUnknownFailsClosed.test.ts` (regression test, unknown semantics)

**Analog:** `test/unit/tokenSafety.test.ts` (mock-the-Contract pattern at lines 76-115).

**Mock-the-Contract pattern** (`test/unit/tokenSafety.test.ts:76-115`):
```typescript
vi.mock('ethers', async () => {
    const actual = await vi.importActual('ethers') as Record<string, unknown>;
    return {
        ...actual,
        Contract: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
            const instance: Record<string, unknown> = {
                swapExactETHForTokens: Object.assign(mockSwapExactETHForTokens, { staticCall: mockStaticCallSwap }),
                // ...
            };
            return instance;
        }),
        Wallet: vi.fn().mockImplementation(function () { return { address: '0xMockWallet' }; }),
    };
});
```

**Adaptation:**
- Mock `ctx.httpProvider.call` to throw `{ data: undefined, message: 'network timeout' }` (no revert payload).
- Assert `simulateHoneypotRoundtrip` returns `verdict !== 'safe'` (either `'unsafe'` or `'unknown'` — never `'safe'`).
- Repeat with `data: '0x'` (empty revert), with malformed ABI-encoded revert, with successful return (contract bug — should always revert).
- Each edge case → `verdict !== 'safe'`. This is the **canonical Pitfall A regression test** (RESEARCH.md lines 1154-1174).

---

### `test/integration/honeypotDeploy.{eth,bsc,base,arb}.test.ts` (regression test, live RPC code-at-address)

**Analog:** Test signature shape from `test/integration/v3LiquidityWait.test.ts`; pattern from `chainRegistry.test.ts` (env-overlay-then-build).

**Shape:**
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { JsonRpcProvider } from 'ethers';

describe('HONEY-03: HoneypotChecker deployed on ETH', () => {
    let provider: JsonRpcProvider;

    beforeAll(() => {
        if (!process.env.ETH_RPC_URL) throw new Error('ETH_RPC_URL required');
        provider = new JsonRpcProvider(process.env.ETH_RPC_URL);
    });

    it('has bytecode at deployedAddress (not 0x)', async () => {
        const deployedAddr = process.env.ETH_HONEYPOT_CHECKER_ADDRESS;
        expect(deployedAddr).toBeTruthy();
        const code = await provider.getCode(deployedAddr!);
        expect(code).not.toBe('0x');
        expect(code.length).toBeGreaterThan(100); // minimal heuristic
    });
});
```

**Adaptation:** Skip-if-env-missing. Tests are gated by per-chain env availability; CI marks them skipped if `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` not set (e.g., before HONEY-04 lands for BSC/Base/Arb).

---

### `test/integration/{v2,v3}HoneypotIntegration.test.ts` (regression test, bot.ts wiring)

**Analog:** `test/integration/v3LiquidityWait.test.ts` (already exercises `bot.ts` dynamic import + mocked DB).

**Shape:**
- Mock dispatch layer (`simulateHoneypotRoundtrip`) to return a known `unsafe` verdict.
- Dynamically import `bot.ts`; trigger `handleNewPairForChain` (V2) or `handleNewV3PoolForChain` (V3) with a synthetic `pairAddress` / `token`.
- Assert `sendCtxAlert` was called with the D-ALERTS format substring (`'*SKIP*'`).
- Assert `sendTxWithRetry` was NOT called (no buy).

**Counter-test:** Mock dispatch to return `safe` with `buyTaxBps: 100, sellTaxBps: 100`. Assert `sendTxWithRetry` WAS called.

---

### `test/unit/honeypotTypes.test.ts` (regression test, tsc compile-gate)

**Analog:** `test/unit/ethersV6BigIntArithmetic.test.ts` and `test/unit/codeQuality.test.ts` (existing compile-gate patterns).

**Compile-gate test purpose:**
- Confirm `HoneypotResult` discriminated union narrows correctly via `verdict` field.
- Confirm `safe` variant requires `evidence.buyTaxBps` and `evidence.sellTaxBps` as `number` (not `number | undefined`).
- Use `// @ts-expect-error` comments on intentionally bad code; vitest passes if `tsc --noEmit` complains.

**Pattern (from `ethersV6BigIntArithmetic.test.ts` general style):**
```typescript
import { describe, it } from 'vitest';
import type { HoneypotResult } from '../../src/utils/honeypot/types';

describe('HoneypotResult discriminated union (HONEY-06)', () => {
    it('vacuous safe verdict is unrepresentable', () => {
        // @ts-expect-error — safe requires evidence.buyTaxBps + sellTaxBps as numbers
        const _bad: HoneypotResult = { verdict: 'safe', evidence: {} };

        // valid:
        const _good: HoneypotResult = {
            verdict: 'safe',
            evidence: { buyTaxBps: 100, sellTaxBps: 100, method: 'on-chain-contract' },
        };
    });
});
```

The `@ts-expect-error` directive fires the compile-gate; `tsc --noEmit` in CI ensures the directive matches a real type error (RESEARCH.md §"Evidence Completeness Assertion" lines 1444-1462).

---

### `test/unit/honeypotDispatch.test.ts` (regression test, dispatch unit)

**Analog:** `test/unit/tokenSafety.test.ts` lines 1-115 (mock-everything-via-vi.mock pattern).

**Mock setup pattern** (`test/unit/tokenSafety.test.ts:23-55`):
```typescript
vi.mock('../../src/utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

vi.mock('../../src/utils/provider', () => ({
    getProvider: vi.fn(() => mockProviderInstance),
    getWsProvider: vi.fn(),
}));
```

**Dynamic import pattern** (`test/unit/tokenSafety.test.ts:117-120`):
```typescript
// Dynamic import after mocks -- avoids side effects from module-level code
let tokenSafetyModule: typeof import('../../src/utils/tokenSafety');

beforeEach(async () => {
    // ... mock resets ...
    tokenSafetyModule = await import('../../src/utils/tokenSafety');
});
```

**Adaptation:** Mock `checkerContract` and `simulator` modules; assert `simulateHoneypotRoundtrip` calls the right one per `ctx.chain.honeypotChecker.method`.

---

### `test/unit/honeypotTaxThreshold.test.ts` (regression test, threshold enforcement)

**Analog:** `test/unit/tokenSafety.test.ts` (mocked-Contract pattern).

**Test cases:**
- `buyTaxBps: 999, sellTaxBps: 0` with `maxBuyTaxBps: 1000` → `safe`.
- `buyTaxBps: 1001, sellTaxBps: 0` with `maxBuyTaxBps: 1000` → `unsafe` with `reason: 'buy-tax-exceeded'`.
- `buyTaxBps: 0, sellTaxBps: 1001` with `maxSellTaxBps: 1000` → `unsafe` with `reason: 'sell-tax-exceeded'`.
- `maxBuyTaxBps: 500` override via `process.env.ETH_MAX_BUY_TAX_BPS = '500'`; `buyTaxBps: 600` → `unsafe`.

Per HONEY-09 in RESEARCH.md §"Phase Requirements → Test Map" line 1387.

---

### `test/unit/bytecodeScan.test.ts` (regression test, HONEY-12 selector matching)

**Analog:** `test/unit/tokenSafety.test.ts` (mocked-provider pattern).

**Mock pattern adapted:**
- Mock `ctx.httpProvider.getCode` to return a bytecode string containing `'2e5bb6ff'` (`setTax(uint256)` selector).
- Call `isMutableTokenForChain`; assert `result.isMutable === true` and `result.hits.includes('2e5bb6ff')`.
- Counter-test: bytecode without any selector; assert `isMutable: false`.
- Edge: `getCode` throws → fail-closed (`isMutable: true, hits: ['scan-failed']`).
- Edge: `getCode` returns `'0x'` → `isMutable: false` (no code = handled by other gate).
- Provider returns mixed-case hex (`'0X2E5BB6FF'`) — assert case-insensitive match via `.toLowerCase()`.

Per HONEY-12 in RESEARCH.md §"Phase Requirements → Test Map" line 1390.

---

### `test/unit/safetyBank/*.test.ts` × 8 (HONEY-11 audit regressions, one per gate)

**Analog:** `test/unit/tokenSafety.test.ts` (full mock-the-Contract pattern; lines 1-115 setup applies verbatim).

**One test file per gate** (per CONTEXT D-AUDIT-BAR line 99-104):
- `test/unit/safetyBank/checkHoneypotForChain.test.ts`
- `test/unit/safetyBank/isBlacklistedTokenForChain.test.ts`
- `test/unit/safetyBank/isLiquidityLockedForChain.test.ts`
- `test/unit/safetyBank/isLiquiditySufficientForChain.test.ts`
- `test/unit/safetyBank/checkTokenMetadataForChain.test.ts`
- `test/unit/safetyBank/simulateSwapForChain.test.ts`
- `test/unit/safetyBank/hasHighTransferTaxForChain.test.ts`
- `test/unit/safetyBank/hasMaxWalletOrTxLimitsForChain.test.ts`

**Template (from RESEARCH.md §"Wave 0 Gaps" lines 1425-1442):**
```typescript
describe('<GATE> regression — never returns safe on edge cases', () => {
    it('returns unsafe (not vacuous safe) when RPC throws', async () => {
        const ctx = mockChainContextWithRpcError();
        const result = await <gateFn>(ctx, MOCK_TOKEN);
        expect(result).not.toBe(false);   // adapted per gate's return type semantics
        // For boolean-returning gates where 'true' = unsafe: assert result === true
        // For boolean-returning gates where 'false' = unsafe: assert result === false
        // The semantic is "blocking the buy" — never "allowing the buy on error"
    });
    it('returns unsafe (not vacuous) when balance is zero / no contract / unknown method', async () => {
        // ... per-gate edge case ...
    });
    it('exercises the underlying behavior — observable effect required (per Phase 17 D-04)', async () => {
        expect(provider.getCode).toHaveBeenCalledWith(MOCK_TOKEN);   // or equivalent observable
    });
});
```

**Per-gate "unsafe semantic" cheat sheet (from `tokenSafety.ts` direct read):**
- `checkHoneypotForChain`: `true` = honeypot = unsafe. Edge: API failure → `true` (honeypotIs.ts:32-34 defaults to blocking).
- `isBlacklistedTokenForChain`: `true` = unsafe (line 360 — `some(sig => bytecode.includes(sig))`). **No error envelope — would propagate.** Planner's HONEY-11 audit gap.
- `isLiquidityLockedForChain`: `true` = locked = safe; `false` = unlocked = unsafe. Edge: Unicrypt API failure → falls back to burn check (line 80-82).
- `isLiquiditySufficientForChain`: `true` = sufficient = safe; `false` = insufficient = unsafe. Edge: catch returns `false` (line 444 — fail-closed; GOOD).
- `checkTokenMetadataForChain`: `true` = valid metadata = safe; `false` = unsafe. Edge: catch returns `false` (line 386 — fail-closed; GOOD).
- `simulateSwapForChain`: `true` = swap simulated = safe; `false` = unsafe. Edge: catch returns `false` (line 414 — fail-closed; GOOD).
- `hasHighTransferTaxForChain`: `true` = high tax = unsafe; `false` = safe. Edge: catch returns `true` (line 506 — fail-closed; GOOD).
- `hasMaxWalletOrTxLimitsForChain`: `true` = has limits = unsafe; `false` = safe. Edge: catch returns `true` (line 548 — fail-closed; GOOD).

**HONEY-11 audit findings inventory** (data flow analysis already done from direct read above):
- Vacuous-pass risk in `isBlacklistedTokenForChain` (lines 357-361): no try/catch; `provider.getCode` throw would propagate up the Promise.all chain. Could be caught later but is fragile. **Recommend retrofitting with try/catch + fail-closed.**

---

### `scripts/check-mythril-report.ts` (RPC wrapper CLI, JSON severity gate)

**Analog:** `scripts/deploySepoliaTest.ts` (top-level error-handling pattern).

**Shape:**
```typescript
import * as fs from 'fs';

const reportPath = process.argv[2];
if (!reportPath) { console.error('Usage: ts-node check-mythril-report.ts <report.json>'); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

const blocking = (report.issues || []).filter((i: { severity: string }) =>
    i.severity === 'Medium' || i.severity === 'High'
);
if (blocking.length > 0) {
    console.error(`Mythril found ${blocking.length} Medium+ issues:`);
    blocking.forEach((i: { severity: string; title: string }) => console.error(`  [${i.severity}] ${i.title}`));
    process.exit(1);
}
console.log('Mythril clean (no Medium+ issues)');
```

Per HONEY-02 in RESEARCH.md §4 lines 696-715.

---

## Shared Patterns

### Pattern 1: Fail-Closed Error Handling

**Source:** `src/utils/tokenSafety.ts:hasHighTransferTaxForChain` lines 504-507 + `:hasMaxWalletOrTxLimitsForChain` lines 546-548

**Apply to:** ALL new safety code paths in Phase 18 (dispatch layer, checker wrapper, bytecode scan, every audited gate retrofit).

**Concrete excerpt** (`src/utils/tokenSafety.ts:504-507`):
```typescript
} catch (e) {
    ctx.log.warn({ err: e, token: tokenAddress, check: 'transferTax' }, 'Tax detection failed');
    return true;  // default to blocking
}
```

**Net-new adaptation for discriminated unions:**
```typescript
} catch (e: unknown) {
    ctx.log.warn({ err: e, token: tokenAddress, check: 'honeypotRoundtrip' }, 'Roundtrip dispatch failed');
    return { verdict: 'unsafe', reason: e instanceof Error ? e.message : String(e), evidence: { method: 'on-chain-contract' } };
}
```

**Anti-example to avoid (the V3 bug being fixed):**
```typescript
// FORBIDDEN — vacuous pass on zero balance (the bug Phase 18 deletes)
if (balance === 0n) return true;
```

---

### Pattern 2: Pino Structured Logging

**Source:** Pervasive across `src/utils/tokenSafety.ts` (every gate). Canonical excerpt at lines 304, 322, 384, 444, etc.

**Apply to:** Every new file under `src/utils/honeypot/`, every new `bot.ts` log line.

**Concrete excerpt** (`src/utils/tokenSafety.ts:322`):
```typescript
log.warn({ err: e, token: tokenAddress, check: 'sellSimulation' }, 'Sell simulation failed');
```

**Convention:**
- `check: '<feature>'` field discriminates log queries.
- Structured object (first arg) for grepability; human-readable message (second arg) for runbook readability.
- `log = logger.child({ module: '<feature>' })` at top of file (matches `src/utils/tokenSafety.ts:15`, `src/chainRegistry.ts:9`).

---

### Pattern 3: Chain-Aware Function Signature

**Source:** `src/utils/tokenSafety.ts` — every `*ForChain` function (lines 335, 346, 357, 366, 392, 421, 452, 475, 513, 555, 593).

**Apply to:** Every new function in `src/utils/honeypot/` that touches chain RPCs or chain config.

**Concrete signature** (`src/utils/tokenSafety.ts:475-478`):
```typescript
export async function hasHighTransferTaxForChain(
    ctx: ChainContext,
    dexRouter: string,
    tokenAddress: string
): Promise<boolean> {
```

**Convention:**
- First param: `ctx: ChainContext` (carries provider, wallet, logger, chain config).
- Subsequent params: chain-specific addresses or token target.
- Return: `Promise<T>` where `T` is the gate's verdict shape.

**New variant for Phase 18:** Returns `Promise<HoneypotResult>` (discriminated) instead of `Promise<boolean>`.

---

### Pattern 4: Telegram Alert via `sendCtxAlert`

**Source:** `src/bot.ts:201, 208, 216, 224, 268` — pervasive across the buy pipeline.

**Apply to:** Every new skip-or-pass decision point introduced in Phase 18.

**Concrete excerpt** (`src/bot.ts:224`):
```typescript
await sendCtxAlert(ctx, `*Sell simulation failed for* \`${targetToken}\` -- buy skipped`);
```

**Convention:**
- Markdown formatting (asterisks for bold, backticks for code).
- Etherscan links: `[\`${addr}\`](${ctx.chain.explorerUrl}/token/${addr})` — see `src/bot.ts:268`.
- D-ALERTS tiered format for Phase 18 skip alerts: `*SKIP* \`{token}\` -- {verdict} ({reason}) tax: buy {N}bps sell {M}bps`.

---

### Pattern 5: `ChainContext.httpProvider.getCode` for Bytecode Inspection

**Source:** `src/utils/tokenSafety.ts:isBlacklistedTokenForChain` line 359; `:isKnownBadTokenForChain` line 454.

**Apply to:** New HONEY-12 `isMutableTokenForChain` in `src/utils/honeypot/bytecodeScan.ts`.

**Concrete excerpt** (`src/utils/tokenSafety.ts:454-458`):
```typescript
try {
    const code = await ctx.httpProvider.getCode(tokenAddress);
    if (!code || code === "0x") {
        ctx.log.warn({ token: tokenAddress, check: 'knownBad' }, 'No contract found at token address');
        return true;
    }
```

This is the exact pattern HONEY-12 reuses. Difference: HONEY-12 returns `MutableScanResult` with hit details, not a bare boolean.

---

### Pattern 6: vi.doMock for Bot.ts Dynamic Import

**Source:** `test/integration/v3LiquidityWait.test.ts:27-60+` (and similar in `test/integration/v3HoneypotIntegration.test.ts` template).

**Apply to:** Every new integration test that exercises `bot.ts:handleNewPairForChain` or `handleNewV3PoolForChain`.

**Concrete excerpt** (`test/integration/v3LiquidityWait.test.ts:27-47, 58-60`):
```typescript
vi.doMock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    return { ...actual, Contract: MockContract };
});

vi.doMock('../../src/utils/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() }) } }));

vi.doMock('../../src/utils/db', () => { /* Statement-shaped stub */ });
```

**Why this matters:** `bot.ts` opens the real SQLite DB at module-load via transitive imports of `src/utils/db.ts` (`riskManager.ts:48`). Mocking `db` is mandatory.

---

## No Analog Found

Files with no close existing match in the codebase (planner should use RESEARCH.md patterns as the primary spec):

| File | Role | Reason |
|------|------|--------|
| `ignition/modules/HoneypotChecker.ts` | Hardhat Ignition module | Repo has no `ignition/` directory; Ignition framework is in `package.json` but never instantiated. RESEARCH.md §6 lines 876-884 provides the canonical 5-line shape. |
| `src/utils/honeypot/simulator.ts` | Option-C stub | Net-new stub-only file. Returns `{ verdict: 'unknown', reason: 'NOT_IMPLEMENTED' }`. No prior `eth_simulateV1` use in repo. |
| `test/fork/fixtures/honeypots/*.json` | pinned-block JSON | No existing JSON fixture format under `test/fork/fixtures/`. Schema defined in RESEARCH.md §3 lines 651-665. |
| `test/fork/fixtures/honeypots/README.md` | fixture maintenance docs | No existing fixture-README pattern. Planner authors fresh per RESEARCH.md §3 lines 622-625. |
| `scripts/check-mythril-report.ts` | Mythril severity CLI gate | No existing JSON-severity-gate script in repo. Shape is small (~15 LOC); RESEARCH.md §4 lines 703-707 sketches structure. |
| `contracts/honeypot/HoneypotChecker.sol` | Roundtrip checker | `contracts/FakeToken.sol` is the only existing Solidity file (12 LOC ERC20 mintable mock). Provides OZ import pattern but no architectural overlap (HoneypotChecker is stateless verifier, not a token). Full skeleton in RESEARCH.md §5 lines 723-840. |

---

## Key Cross-Cutting Decisions for Planner

1. **Discriminated-union return type is net-new.** Existing safety gates return `Promise<boolean>`. Phase 18 introduces `Promise<HoneypotResult>` for the new files. Per CONTEXT `<code_context>` §"Established Patterns": *"Phase 18 introduces this pattern for `HoneypotResult`; planner must choose whether the other 8 gates' return types evolve to match (likely yes, given HONEY-11 audit + D-AUDIT-BAR regression tests) or stay `Promise<boolean>` for stability."*

   **Recommendation:** Keep the 8 existing gates on `Promise<boolean>` for Phase 18 stability; layer the HONEY-11 regression tests over the boolean shape with the "never returns safe-equivalent on edge case" pattern. Defer discriminated-union retrofit to v6.18 (matches Phase 17 D-13/D-14 carryover risk-aversion).

2. **HONEY-12 sits in `src/utils/honeypot/bytecodeScan.ts`, NOT `src/utils/bytecodeAnalysis.ts`.** RESEARCH.md §"Component Responsibilities" line 345 places it inside the `honeypot/` directory. CONTEXT line 285 mentions `bytecodeAnalysis.ts` as a co-location option; planner should pick `src/utils/honeypot/bytecodeScan.ts` for consistency with the rest of the new module layout.

3. **No new vitest projects.** Tests fit into existing `unit` / `integration` / `fork` projects per `vitest.config.ts:7-39`. RESEARCH.md §"Test Framework" line 1365 confirms.

4. **Solc version pin is `0.8.28` exact (not `^0.8.28`).** `hardhat.config.ts:8` uses exact pin; `contracts/FakeToken.sol:2` uses caret. New `HoneypotChecker.sol` follows hardhat.config.ts convention for audit determinism.

5. **HoneypotChecker.sol verifies V2 only in initial wave.** RESEARCH.md §5 lines 850-855 recommends ship-V2-only first; add `checkV3()` function in HONEY-08 wave (V3 router has different `exactInputSingle` shape). Planner allocates: HONEY-07 = V2 in `check()`; HONEY-08 = V3 in `checkV3()`.

6. **Per-chain env vars** for tax thresholds AND deployed address:
   - `<ETH|BSC|BASE|ARB>_MAX_BUY_TAX_BPS` (default 1000)
   - `<ETH|BSC|BASE|ARB>_MAX_SELL_TAX_BPS` (default 1000)
   - `<ETH|BSC|BASE|ARB>_HONEYPOT_CHECKER_ADDRESS` (default null until HONEY-03/04 deploys)
   - `DEPLOY_PRIVATE_KEY` (separate from `PRIVATE_KEY`; D-DEPLOY-KEY)

   Matches existing per-chain env pattern (`SNIPE_AMOUNT`, `MAX_CAPITAL`, `MIN_LIQUIDITY`) at `src/chainRegistry.ts:297-299`.

---

## Metadata

**Analog search scope:**
- `src/utils/tokenSafety.ts` (full file, 635 lines)
- `src/utils/safetyProviders/` (4 adapters + types.ts)
- `src/chainRegistry.ts` (lines 1-407)
- `src/bot.ts` (lines 200-480)
- `contracts/` (single file: FakeToken.sol)
- `scripts/` (2 files: deploySepoliaTest.ts, addLiquidity.ts)
- `test/unit/tokenSafety.test.ts`
- `test/unit/chainRegistry.test.ts`
- `test/integration/v3LiquidityWait.test.ts`
- `test/fork/snipeLifecycle.test.ts`
- `test/fork/setup.ts`
- `hardhat.config.ts`
- `vitest.config.ts`
- `package.json` (deps verification)

**Files scanned:** ~16 source files; ~10 test files; 2 config files.

**Pattern extraction date:** 2026-05-15

**Confidence:** HIGH for exact-match analogs (8 files); MEDIUM for role-match analogs (15 files); planner uses RESEARCH.md §"Code Examples" + §"Open Research Item Recommendations" as the primary spec for net-new files (6 files).
