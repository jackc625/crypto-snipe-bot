// test/unit/provider.test.ts
// Unit tests for INFRA-02: getProvider() returns the same cached instance
// on repeated calls for the same network key, and distinct instances for
// different network keys. No real network calls — ethers and CONFIG are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ethers so no real JsonRpcProvider is created.
// provider.ts calls `new ethers.JsonRpcProvider(url)` so the mock must be
// a proper constructor (class). Each instance is tagged with the url so we
// can assert identity without touching the network.
// ---------------------------------------------------------------------------

// Track construction call count across tests
let constructorCallCount = 0;

class MockJsonRpcProvider {
    readonly _url: string;
    constructor(url: string) {
        this._url = url;
        constructorCallCount++;
    }
}

vi.mock('ethers', () => {
    return {
        ethers: {
            JsonRpcProvider: MockJsonRpcProvider,
            WebSocketProvider: class MockWsProvider {},
            Wallet: class MockWallet {},
        },
        JsonRpcProvider: MockJsonRpcProvider,
        WebSocketProvider: class MockWsProvider {},
        Wallet: class MockWallet {},
    };
});

// ---------------------------------------------------------------------------
// Mock CONFIG so provider.ts can import it without env vars
// ---------------------------------------------------------------------------

vi.mock('../../src/config', () => ({
    CONFIG: {
        network: 'eth',
        rpc: {
            eth: 'https://eth-rpc.example.com',
            bsc: 'https://bsc-rpc.example.com',
            sepolia: 'https://sepolia-rpc.example.com',
            mainnet: 'https://eth-rpc.example.com',
        },
        walletPrivateKey: '0x' + '1'.repeat(64),
    },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('INFRA-02: getProvider() singleton cache', () => {
    // Re-import getProvider fresh for each test by resetting module registry.
    // vitest.config.ts has mockReset: true but module cache persists between
    // tests in the same file because the Map inside provider.ts is module-level.
    // We use vi.resetModules() + dynamic import to get a clean slate per test.

    beforeEach(() => {
        vi.resetModules();
        constructorCallCount = 0;
    });

    it('two calls with the same network return the exact same instance (===)', async () => {
        const { getProvider } = await import('../../src/utils/provider');

        const first = getProvider('eth');
        const second = getProvider('eth');

        expect(first).toBe(second);
        // Constructor called only once — second call hits the cache
        expect(constructorCallCount).toBe(1);
    });

    it('two calls with no argument (uses CONFIG.network default) return the same instance', async () => {
        const { getProvider } = await import('../../src/utils/provider');

        const first = getProvider();
        const second = getProvider();

        expect(first).toBe(second);
        expect(constructorCallCount).toBe(1);
    });

    it('calls with different networks return different instances', async () => {
        const { getProvider } = await import('../../src/utils/provider');

        const ethProvider = getProvider('eth');
        const bscProvider = getProvider('bsc');

        expect(ethProvider).not.toBe(bscProvider);
        // Constructor called once per unique network
        expect(constructorCallCount).toBe(2);
    });

    it('throws an error when no RPC URL is configured for the requested network', async () => {
        const { getProvider } = await import('../../src/utils/provider');

        expect(() => getProvider('unknown-chain')).toThrow(/No RPC URL configured/);
    });
});
