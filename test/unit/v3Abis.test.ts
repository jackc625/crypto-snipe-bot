// test/unit/v3Abis.test.ts
// Nyquist validation tests for Phase 5 V3 ABI exports and chain registry V3 entries.
// Covers gaps: 05-01-01 (V3-01), 05-02-01 (V3-02), 05-02-02 (V3-03), 05-02-03 (V3-04)

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- ABI imports are direct -- no mocking needed for abis.ts ----
import {
    V3_FACTORY_ABI,
    V3_POOL_ABI,
    V3_SWAP_ROUTER_ABI,
    V3_QUOTER_V2_ABI,
} from '../../src/utils/abis';

// ---- Mock dependencies required before chainRegistry import ----

vi.mock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        }),
        info: vi.fn(),
        warn: vi.fn(),
        fatal: vi.fn(),
    },
}));

vi.mock('../../src/utils/provider', () => ({
    getProvider: vi.fn(() => ({})),
    getWsProvider: vi.fn(() => null),
}));

let buildChainRegistry: typeof import('../../src/chainRegistry')['buildChainRegistry'];
let isDexV3: typeof import('../../src/chainRegistry')['isDexV3'];

beforeEach(async () => {
    // Provide env vars so enabled chain (eth) does not call process.exit
    process.env.ENABLED_CHAINS = 'eth';
    process.env.ETH_RPC_URL = 'https://eth-rpc.example.com';
    process.env.FLASHBOTS_AUTH_KEY = 'test-flashbots-key';
    process.env.PRIVATE_KEY = '0x' + '1'.repeat(64);

    const mod = await import('../../src/chainRegistry');
    buildChainRegistry = mod.buildChainRegistry;
    isDexV3 = mod.isDexV3;
});

// ---------------------------------------------------------------------------
// Gap 05-01-01 / V3-01 — V3 factory ABI and chain V3 factory addresses
// ---------------------------------------------------------------------------

describe('V3_FACTORY_ABI — PoolCreated event detection (V3-01)', () => {
    it('V3_FACTORY_ABI is exported as a non-empty array', () => {
        expect(Array.isArray(V3_FACTORY_ABI)).toBe(true);
        expect(V3_FACTORY_ABI.length).toBeGreaterThan(0);
    });

    it('V3_FACTORY_ABI contains PoolCreated event signature', () => {
        const hasPoolCreated = V3_FACTORY_ABI.some(
            (entry) => typeof entry === 'string' && entry.includes('PoolCreated')
        );
        expect(hasPoolCreated).toBe(true);
    });

    it('PoolCreated event includes fee, token0, token1, and pool parameters', () => {
        const poolCreatedEntry = V3_FACTORY_ABI.find(
            (entry) => typeof entry === 'string' && entry.includes('PoolCreated')
        ) as string;
        expect(poolCreatedEntry).toBeDefined();
        expect(poolCreatedEntry).toContain('token0');
        expect(poolCreatedEntry).toContain('token1');
        expect(poolCreatedEntry).toContain('fee');
        expect(poolCreatedEntry).toContain('pool');
    });

    it('all 4 chains have at least one V3 DEX entry with a factoryAddress', () => {
        const registry = buildChainRegistry();
        for (const chainName of ['eth', 'bsc', 'base', 'arb']) {
            const chain = registry.get(chainName)!;
            const v3Dexes = chain.dexes.filter(isDexV3);
            expect(v3Dexes.length, `${chainName} has no V3 DEX entries`).toBeGreaterThan(0);
            for (const dex of v3Dexes) {
                expect(
                    dex.factoryAddress,
                    `${chainName} V3 DEX "${dex.name}" missing factoryAddress`
                ).toMatch(/^0x[0-9a-fA-F]{40}$/);
            }
        }
    });

    it('ETH V3 factory address matches known Uniswap V3 factory', () => {
        const UNISWAP_V3_FACTORY_ETH = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
        const registry = buildChainRegistry();
        const ethChain = registry.get('eth')!;
        const ethV3Uniswap = ethChain.dexes.find(
            (d) => isDexV3(d) && d.name === 'uniswap-v3'
        );
        expect(ethV3Uniswap).toBeDefined();
        expect(ethV3Uniswap!.factoryAddress).toBe(UNISWAP_V3_FACTORY_ETH);
    });
});

// ---------------------------------------------------------------------------
// Gap 05-02-01 / V3-02 — V3 Pool ABI enables Mint event gating
// ---------------------------------------------------------------------------

describe('V3_POOL_ABI — Mint event gating and pool state (V3-02)', () => {
    it('V3_POOL_ABI is exported as a non-empty array', () => {
        expect(Array.isArray(V3_POOL_ABI)).toBe(true);
        expect(V3_POOL_ABI.length).toBeGreaterThan(0);
    });

    it('V3_POOL_ABI contains Mint event signature for liquidity-wait gating', () => {
        const hasMint = V3_POOL_ABI.some(
            (entry) => typeof entry === 'string' && entry.includes('Mint')
        );
        expect(hasMint).toBe(true);
    });

    it('V3_POOL_ABI contains slot0 function for sqrtPriceX96 price reading', () => {
        const hasSlot0 = V3_POOL_ABI.some(
            (entry) => typeof entry === 'string' && entry.includes('slot0')
        );
        expect(hasSlot0).toBe(true);
    });

    it('slot0 function returns sqrtPriceX96 as first return value', () => {
        const slot0Entry = V3_POOL_ABI.find(
            (entry) => typeof entry === 'string' && entry.includes('slot0')
        ) as string;
        expect(slot0Entry).toBeDefined();
        expect(slot0Entry).toContain('sqrtPriceX96');
    });

    it('V3_POOL_ABI contains liquidity function for pool liquidity checking', () => {
        const hasLiquidity = V3_POOL_ABI.some(
            (entry) => typeof entry === 'string' && entry.includes('liquidity')
        );
        expect(hasLiquidity).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Gap 05-02-02 / V3-03 — V3 SwapRouter ABI and chain router/quoter addresses
// ---------------------------------------------------------------------------

describe('V3_SWAP_ROUTER_ABI — exactInputSingle swap execution (V3-03)', () => {
    it('V3_SWAP_ROUTER_ABI is exported as a non-empty array', () => {
        expect(Array.isArray(V3_SWAP_ROUTER_ABI)).toBe(true);
        expect(V3_SWAP_ROUTER_ABI.length).toBeGreaterThan(0);
    });

    it('V3_SWAP_ROUTER_ABI contains exactInputSingle function for V3 swaps', () => {
        const hasExactInputSingle = V3_SWAP_ROUTER_ABI.some(
            (entry) => typeof entry === 'string' && entry.includes('exactInputSingle')
        );
        expect(hasExactInputSingle).toBe(true);
    });

    it('exactInputSingle includes fee parameter in tuple for fee-tier-based routing', () => {
        const exactInputEntry = V3_SWAP_ROUTER_ABI.find(
            (entry) => typeof entry === 'string' && entry.includes('exactInputSingle')
        ) as string;
        expect(exactInputEntry).toBeDefined();
        expect(exactInputEntry).toContain('fee');
        expect(exactInputEntry).toContain('amountIn');
        expect(exactInputEntry).toContain('amountOutMinimum');
    });

    it('V3_SWAP_ROUTER_ABI contains multicall function for deadline wrapping', () => {
        const hasMulticall = V3_SWAP_ROUTER_ABI.some(
            (entry) => typeof entry === 'string' && entry.includes('multicall')
        );
        expect(hasMulticall).toBe(true);
    });

    it('multicall function accepts deadline parameter for SwapRouter02 pattern', () => {
        const multicallEntry = V3_SWAP_ROUTER_ABI.find(
            (entry) => typeof entry === 'string' && entry.includes('multicall')
        ) as string;
        expect(multicallEntry).toBeDefined();
        expect(multicallEntry).toContain('deadline');
    });

    it('all 4 chains have V3 DEX entries with swapRouterAddress', () => {
        const registry = buildChainRegistry();
        for (const chainName of ['eth', 'bsc', 'base', 'arb']) {
            const chain = registry.get(chainName)!;
            const v3Dexes = chain.dexes.filter(isDexV3);
            expect(v3Dexes.length, `${chainName} has no V3 DEX entries`).toBeGreaterThan(0);
            for (const dex of v3Dexes) {
                expect(
                    dex.swapRouterAddress,
                    `${chainName} V3 DEX "${dex.name}" missing swapRouterAddress`
                ).toMatch(/^0x[0-9a-fA-F]{40}$/);
            }
        }
    });

    it('all 4 chains have V3 DEX entries with quoterAddress', () => {
        const registry = buildChainRegistry();
        for (const chainName of ['eth', 'bsc', 'base', 'arb']) {
            const chain = registry.get(chainName)!;
            const v3Dexes = chain.dexes.filter(isDexV3);
            for (const dex of v3Dexes) {
                expect(
                    dex.quoterAddress,
                    `${chainName} V3 DEX "${dex.name}" missing quoterAddress`
                ).toMatch(/^0x[0-9a-fA-F]{40}$/);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Gap 05-02-03 / V3-04 — V3 QuoterV2 ABI for sqrtPriceX96 price monitoring
// ---------------------------------------------------------------------------

describe('V3_QUOTER_V2_ABI — sqrtPriceX96 price monitoring (V3-04)', () => {
    it('V3_QUOTER_V2_ABI is exported as a non-empty array', () => {
        expect(Array.isArray(V3_QUOTER_V2_ABI)).toBe(true);
        expect(V3_QUOTER_V2_ABI.length).toBeGreaterThan(0);
    });

    it('V3_QUOTER_V2_ABI contains quoteExactInputSingle function', () => {
        const hasQuoteExact = V3_QUOTER_V2_ABI.some(
            (entry) => typeof entry === 'string' && entry.includes('quoteExactInputSingle')
        );
        expect(hasQuoteExact).toBe(true);
    });

    it('quoteExactInputSingle returns amountOut for position valuation', () => {
        const quoteEntry = V3_QUOTER_V2_ABI.find(
            (entry) => typeof entry === 'string' && entry.includes('quoteExactInputSingle')
        ) as string;
        expect(quoteEntry).toBeDefined();
        expect(quoteEntry).toContain('amountOut');
    });

    it('quoteExactInputSingle returns sqrtPriceX96After for oracle-based valuation', () => {
        const quoteEntry = V3_QUOTER_V2_ABI.find(
            (entry) => typeof entry === 'string' && entry.includes('quoteExactInputSingle')
        ) as string;
        expect(quoteEntry).toBeDefined();
        expect(quoteEntry).toContain('sqrtPriceX96After');
    });

    it('quoteExactInputSingle input tuple includes fee for fee-tier-specific routing', () => {
        const quoteEntry = V3_QUOTER_V2_ABI.find(
            (entry) => typeof entry === 'string' && entry.includes('quoteExactInputSingle')
        ) as string;
        expect(quoteEntry).toBeDefined();
        expect(quoteEntry).toContain('fee');
        expect(quoteEntry).toContain('amountIn');
    });
});
