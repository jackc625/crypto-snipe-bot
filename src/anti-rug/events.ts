// src/anti-rug/events.ts
// Phase 19 / Plan 19-03 Task 1 — Canonical event ABI fragments + topic hashes
// + DEAD_ADDRESS for the anti-rug detector (Plan 19-04).
//
// Why a separate file (vs. extending src/utils/abis.ts):
//   - The existing PAIR_ABI / V3_POOL_ABI in abis.ts capture the VIEW
//     functions (getReserves, totalSupply, liquidity, slot0) used by the
//     baseline snapshot path. The EVENT fragments are used only by the
//     anti-rug listener — keeping them in a dedicated module preserves
//     the abis.ts "shared across modules" semantic without forcing every
//     consumer of abis.ts to pull in anti-rug-specific identifiers.
//   - CONTEXT.md authorises "events.ts file split — planner discretion".
//
// Topic-hash verification:
//   - Each TOPIC constant is computed at MODULE LOAD via `ethers.id(<sig>)`.
//   - Task 1 Tests 6–9 verify each computed topic against the canonical
//     reference: `ethers.id(<sig>)` called at test time MUST match the
//     module-load value. This catches a typo in the signature string at
//     unit-test time before the detector silently misses every event.
//
// References:
//   - 19-RESEARCH.md §1.1 (V2 event signatures verified against
//     Uniswap/v2-core/UniswapV2Pair.sol)
//   - 19-RESEARCH.md §1.2 (V3 event signatures verified against
//     Uniswap/v3-core IUniswapV3PoolEvents.sol)
//   - 19-PATTERNS.md §"src/anti-rug/events.ts" (lines 555-573)

import { ethers } from 'ethers';

// ---------------------------------------------------------------------------
// V2 Pair events (UniswapV2Pair.sol)
// ---------------------------------------------------------------------------

/**
 * Pair.Burn event — fires when an LP holder removes liquidity from a V2 pair.
 * The `to` address (4th param, indexed) is the destination of the burned
 * underlying tokens and is what the signal-2 allowlist check evaluates.
 */
export const PAIR_BURN_EVENT =
    'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)';

/**
 * Pair.Transfer (ERC-20) event — used as an alternative V2 rug-detection
 * pattern (ANTIRUG-03): an LP-token transfer to 0xdEaD is the canonical
 * "burn LP without calling Burn" pattern some projects use. Pair contracts
 * are themselves ERC-20s, so the standard Transfer signature applies.
 */
export const PAIR_TRANSFER_EVENT =
    'event Transfer(address indexed from, address indexed to, uint256 value)';

// ---------------------------------------------------------------------------
// V3 Pool events (IUniswapV3PoolEvents.sol)
// ---------------------------------------------------------------------------

/**
 * UniswapV3Pool.Burn — fires when an NFT position's liquidity is burned
 * from a tick range. NOTE the field order differs from V2 (`owner` is the
 * FIRST indexed param, there is NO `to`) — the signal-2 allowlist check on
 * V3 reads `owner`, not `to` (per 19-RESEARCH.md CRITICAL #3 + D-V3-ALLOWLIST).
 */
export const POOL_BURN_EVENT =
    'event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)';

/**
 * UniswapV3Pool.Collect — fires when an NFT position holder withdraws the
 * tokens owed after a Burn (V3 Burn ONLY makes tokens "owed"; Collect
 * actually transfers them). `recipient` (2nd param, NOT indexed) is the
 * destination address that the signal-2 allowlist check evaluates on Collect.
 */
export const POOL_COLLECT_EVENT =
    'event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)';

// ---------------------------------------------------------------------------
// Topic hashes — computed once at module load via `ethers.id(...)`.
// The detector (Plan 19-04) uses these in the `topics` field of WS filters
// and `getLogs` calls. Unit tests assert each topic equals the runtime
// `ethers.id(<sig>)` — a typo in any signature string surfaces as a test
// failure at unit-test time, not silently as a monitor that never fires.
// ---------------------------------------------------------------------------

export const PAIR_BURN_TOPIC: string = ethers.id(
    'Burn(address,uint256,uint256,address)'
);

export const PAIR_TRANSFER_TOPIC: string = ethers.id(
    'Transfer(address,address,uint256)'
);

export const POOL_BURN_TOPIC: string = ethers.id(
    'Burn(address,int24,int24,uint128,uint256,uint256)'
);

export const POOL_COLLECT_TOPIC: string = ethers.id(
    'Collect(address,address,int24,int24,uint128,uint128)'
);

// ---------------------------------------------------------------------------
// Canonical burn destination
// ---------------------------------------------------------------------------

/**
 * Canonical lowercased 0xdEaD address — the universal "burn LP to a dead
 * eater" destination used by V2 pair Transfer-to-dEaD rug patterns
 * (ANTIRUG-03). Lowercased here because raw log events from the RPC may
 * arrive in mixed case ('0x...dEaD' vs '0x...dead' vs '0x...DEAD'); the
 * detector compares via `address.toLowerCase() === DEAD_ADDRESS`. Also
 * skipped by `verifyAllowlistAtStartup` (Plan 19-03 Task 2) because the
 * burn address is universally an EOA — no contract code expected.
 */
export const DEAD_ADDRESS: string = '0x000000000000000000000000000000000000dead';
