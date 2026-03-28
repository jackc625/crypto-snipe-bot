// test/unit/chainRegistry.test.ts
// Unit tests for chain registry building and validation.
// Tests ChainConfig construction from env vars and DexConfig discriminated union.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

beforeEach(async () => {
    // Set required env vars for enabled chains
    process.env.ENABLED_CHAINS = 'eth';
    process.env.ETH_RPC_URL = 'https://eth-rpc.example.com';
    process.env.FLASHBOTS_AUTH_KEY = 'test-flashbots-key';
    process.env.PRIVATE_KEY = '0x' + '1'.repeat(64);

    const mod = await import('../../src/chainRegistry');
    buildChainRegistry = mod.buildChainRegistry;
    getEnabledChains = mod.getEnabledChains;
    isDexV2 = mod.isDexV2;
    isDexV3 = mod.isDexV3;
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
