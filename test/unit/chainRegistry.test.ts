// test/unit/chainRegistry.test.ts
// Unit tests for chain registry building and validation.
// Tests ChainConfig construction from env vars and DexConfig discriminated union.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mock dependencies ----

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
let getEnabledChains: typeof import('../../src/chainRegistry')['getEnabledChains'];
let isDexV2: typeof import('../../src/chainRegistry')['isDexV2'];
let isDexV3: typeof import('../../src/chainRegistry')['isDexV3'];

// Plan 18-06 Task 1: env keys this suite mutates per-test for honeypotChecker
// overlay coverage. Listed here so the afterEach can restore the baseline
// without leaking across tests.
const HONEYPOT_ENV_KEYS = [
    'ETH_HONEYPOT_CHECKER_ADDRESS',
    'BSC_HONEYPOT_CHECKER_ADDRESS',
    'BASE_HONEYPOT_CHECKER_ADDRESS',
    'ARB_HONEYPOT_CHECKER_ADDRESS',
    'ETH_MAX_BUY_TAX_BPS',
    'ETH_MAX_SELL_TAX_BPS',
    'BSC_MAX_BUY_TAX_BPS',
    'BSC_MAX_SELL_TAX_BPS',
    'BASE_MAX_BUY_TAX_BPS',
    'BASE_MAX_SELL_TAX_BPS',
    'ARB_MAX_BUY_TAX_BPS',
    'ARB_MAX_SELL_TAX_BPS',
] as const;

beforeEach(async () => {
    // Set required env vars for enabled chains
    process.env.ENABLED_CHAINS = 'eth';
    process.env.ETH_RPC_URL = 'https://eth-rpc.example.com';
    process.env.FLASHBOTS_AUTH_KEY = 'test-flashbots-key';
    process.env.PRIVATE_KEY = '0x' + '1'.repeat(64);

    // Clear plan 18-06 honeypot overlay env vars so per-test setup is explicit.
    for (const key of HONEYPOT_ENV_KEYS) {
        delete process.env[key];
    }

    // Reset module cache so each test re-reads process.env fresh.
    vi.resetModules();

    const mod = await import('../../src/chainRegistry');
    buildChainRegistry = mod.buildChainRegistry;
    getEnabledChains = mod.getEnabledChains;
    isDexV2 = mod.isDexV2;
    isDexV3 = mod.isDexV3;
});

afterEach(() => {
    for (const key of HONEYPOT_ENV_KEYS) {
        delete process.env[key];
    }
});

describe('buildChainRegistry', () => {
    it('returns array of ChainConfig objects for configured chains', () => {
        const registry = buildChainRegistry();
        expect(registry.size).toBeGreaterThan(0);
        const ethConfig = registry.get('eth');
        expect(ethConfig).toBeDefined();
        expect(ethConfig!.chainId).toBe(1);
        expect(ethConfig!.name).toBe('eth');
        expect(ethConfig!.enabled).toBe(true);
    });

    it('ChainConfig has required fields: chainId, name, dexes, mevStrategy', () => {
        const registry = buildChainRegistry();
        const ethConfig = registry.get('eth')!;
        expect(ethConfig.chainId).toBe(1);
        expect(ethConfig.name).toBe('eth');
        expect(ethConfig.dexes.length).toBeGreaterThan(0);
        expect(ethConfig.mevStrategy).toBe('flashbots');
        expect(ethConfig.nativeCurrency).toBe('ETH');
        expect(ethConfig.wethAddress).toBeDefined();
        expect(ethConfig.httpRpcUrl).toBe('https://eth-rpc.example.com');
    });

    it('includes all 4 chain templates in registry', () => {
        const registry = buildChainRegistry();
        expect(registry.has('eth')).toBe(true);
        expect(registry.has('bsc')).toBe(true);
        expect(registry.has('base')).toBe(true);
        expect(registry.has('arb')).toBe(true);
    });

    it('getEnabledChains returns only enabled chains', () => {
        const registry = buildChainRegistry();
        const enabled = getEnabledChains(registry);
        expect(enabled.every(c => c.enabled)).toBe(true);
        expect(enabled.length).toBe(1); // Only 'eth' enabled
        expect(enabled[0].name).toBe('eth');
    });
});

describe('DexConfig discriminated union', () => {
    it('v2 configs have dexType="v2" and routerAddress', () => {
        const registry = buildChainRegistry();
        const ethConfig = registry.get('eth')!;
        const v2Dex = ethConfig.dexes.find(d => d.dexType === 'v2');
        expect(v2Dex).toBeDefined();
        expect(isDexV2(v2Dex!)).toBe(true);
        if (isDexV2(v2Dex!)) {
            expect(v2Dex.routerAddress).toBeDefined();
            expect(typeof v2Dex.routerAddress).toBe('string');
        }
    });

    it('v3 configs have dexType="v3" and swapRouterAddress', () => {
        const registry = buildChainRegistry();
        const ethConfig = registry.get('eth')!;
        const v3Dex = ethConfig.dexes.find(d => d.dexType === 'v3');
        expect(v3Dex).toBeDefined();
        expect(isDexV3(v3Dex!)).toBe(true);
        if (isDexV3(v3Dex!)) {
            expect(v3Dex.swapRouterAddress).toBeDefined();
            expect(v3Dex.quoterAddress).toBeDefined();
        }
    });

    it('isDexV2 and isDexV3 type guards work correctly', () => {
        const registry = buildChainRegistry();
        const ethConfig = registry.get('eth')!;
        for (const dex of ethConfig.dexes) {
            if (dex.dexType === 'v2') {
                expect(isDexV2(dex)).toBe(true);
                expect(isDexV3(dex)).toBe(false);
            } else {
                expect(isDexV3(dex)).toBe(true);
                expect(isDexV2(dex)).toBe(false);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Plan 18-06 Task 1: HoneypotChecker field + per-chain env overlay
// ---------------------------------------------------------------------------

describe('ChainConfig.honeypotChecker (plan 18-06)', () => {
    it('Test 1: with no env vars, deployedAddress is null for every chain', () => {
        const registry = buildChainRegistry();
        for (const chainName of ['eth', 'bsc', 'base', 'arb']) {
            const cfg = registry.get(chainName)!;
            expect(cfg.honeypotChecker).toBeDefined();
            expect(cfg.honeypotChecker.deployedAddress).toBeNull();
        }
    });

    it('Test 2: ETH_HONEYPOT_CHECKER_ADDRESS overrides ETH chain deployedAddress', async () => {
        process.env.ETH_HONEYPOT_CHECKER_ADDRESS =
            '0x1234567890123456789012345678901234567890';
        vi.resetModules();
        const mod = await import('../../src/chainRegistry');
        const registry = mod.buildChainRegistry();
        expect(registry.get('eth')!.honeypotChecker.deployedAddress).toBe(
            '0x1234567890123456789012345678901234567890'
        );
        // Other chains remain null (per-prefix isolation).
        expect(registry.get('bsc')!.honeypotChecker.deployedAddress).toBeNull();
        expect(registry.get('base')!.honeypotChecker.deployedAddress).toBeNull();
        expect(registry.get('arb')!.honeypotChecker.deployedAddress).toBeNull();
    });

    it('Test 3: maxBuyTaxBps defaults to 1000 (per D-TAX-THRESHOLDS) when env unset', () => {
        const registry = buildChainRegistry();
        for (const chainName of ['eth', 'bsc', 'base', 'arb']) {
            const cfg = registry.get(chainName)!;
            expect(cfg.honeypotChecker.maxBuyTaxBps).toBe(1000);
            expect(cfg.honeypotChecker.maxSellTaxBps).toBe(1000);
        }
    });

    it('Test 4: ETH_MAX_BUY_TAX_BPS=500 overrides ETH maxBuyTaxBps', async () => {
        process.env.ETH_MAX_BUY_TAX_BPS = '500';
        process.env.ETH_MAX_SELL_TAX_BPS = '750';
        vi.resetModules();
        const mod = await import('../../src/chainRegistry');
        const registry = mod.buildChainRegistry();
        expect(registry.get('eth')!.honeypotChecker.maxBuyTaxBps).toBe(500);
        expect(registry.get('eth')!.honeypotChecker.maxSellTaxBps).toBe(750);
        // BSC remains default — independent per-prefix overlay.
        expect(registry.get('bsc')!.honeypotChecker.maxBuyTaxBps).toBe(1000);
        expect(registry.get('bsc')!.honeypotChecker.maxSellTaxBps).toBe(1000);
    });

    it('Test 5: method defaults to "on-chain-contract" for every chain', () => {
        const registry = buildChainRegistry();
        for (const chainName of ['eth', 'bsc', 'base', 'arb']) {
            const cfg = registry.get(chainName)!;
            expect(cfg.honeypotChecker.method).toBe('on-chain-contract');
        }
    });

    it('Test 6: out-of-range tax threshold env triggers FATAL exit (process.exit(1))', async () => {
        process.env.ETH_MAX_BUY_TAX_BPS = '12345'; // > 10000 — invalid bps
        vi.resetModules();
        const mod = await import('../../src/chainRegistry');
        // Stub process.exit to capture the call instead of killing the test runner.
        const exitSpy = vi
            .spyOn(process, 'exit')
            .mockImplementation(((_code?: number) => {
                throw new Error('process.exit-called');
            }) as never);
        try {
            // buildChainRegistry should call process.exit(1) via the stubbed spy,
            // which throws. We catch and assert the spy was invoked with 1.
            expect(() => mod.buildChainRegistry()).toThrow('process.exit-called');
            expect(exitSpy).toHaveBeenCalledWith(1);
        } finally {
            exitSpy.mockRestore();
        }
    });

    it('Test 7: negative tax threshold env triggers FATAL exit (process.exit(1))', async () => {
        process.env.ETH_MAX_SELL_TAX_BPS = '-50';
        vi.resetModules();
        const mod = await import('../../src/chainRegistry');
        const exitSpy = vi
            .spyOn(process, 'exit')
            .mockImplementation(((_code?: number) => {
                throw new Error('process.exit-called');
            }) as never);
        try {
            expect(() => mod.buildChainRegistry()).toThrow('process.exit-called');
            expect(exitSpy).toHaveBeenCalledWith(1);
        } finally {
            exitSpy.mockRestore();
        }
    });

    it('Test 8: NaN tax threshold env triggers FATAL exit (process.exit(1))', async () => {
        process.env.ETH_MAX_BUY_TAX_BPS = 'not-a-number';
        vi.resetModules();
        const mod = await import('../../src/chainRegistry');
        const exitSpy = vi
            .spyOn(process, 'exit')
            .mockImplementation(((_code?: number) => {
                throw new Error('process.exit-called');
            }) as never);
        try {
            expect(() => mod.buildChainRegistry()).toThrow('process.exit-called');
            expect(exitSpy).toHaveBeenCalledWith(1);
        } finally {
            exitSpy.mockRestore();
        }
    });
});
