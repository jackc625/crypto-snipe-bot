// tests/fixtures/api.fixtures.ts
// Shared test infrastructure for API tests.
// Provides mock ChainContext objects and test constants.

import type { ChainContext, ChainConfig } from '../../src/chainRegistry';

export const MOCK_API_KEY = 'test-dashboard-api-key-12345';

/**
 * Create a mock ChainContext with connected httpProvider.
 * Override any field via the overrides parameter.
 */
export function createMockChainContext(overrides?: Partial<{
    chain: Partial<ChainConfig>;
    httpProvider: Record<string, unknown>;
    wsProvider: unknown;
    wallet: Record<string, unknown>;
}>): ChainContext {
    const chain: ChainConfig = {
        chainId: 1,
        name: 'eth',
        displayName: '[ETH]',
        enabled: true,
        nativeCurrency: 'ETH',
        wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        httpRpcUrl: 'http://localhost:8545',
        wsRpcUrl: null,
        dexes: [],
        mevStrategy: 'flashbots',
        mevConfig: {},
        safetyApis: { honeypot: 'honeypot.is', liquidityLock: 'unicrypt', tokenSecurity: 'goplus' },
        gas: { type: 'eip1559', multiplier: 1.2, maxGasLimit: 300_000n },
        snipeAmount: '0.01',
        maxCapital: '1.0',
        explorerUrl: 'https://etherscan.io',
        minLiquidityThreshold: '0.5',
        ...(overrides?.chain || {}),
    } as ChainConfig;

    const httpProvider = {
        getBlockNumber: () => Promise.resolve(12345),
        ...(overrides?.httpProvider || {}),
    };

    const wsProvider = overrides?.wsProvider !== undefined ? overrides.wsProvider : null;

    const wallet = {
        address: '0x1234567890abcdef1234567890abcdef12345678',
        ...(overrides?.wallet || {}),
    };

    const log = {
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        debug: () => {},
        child: () => log,
    };

    return {
        chain,
        httpProvider,
        wsProvider,
        wallet,
        log,
    } as unknown as ChainContext;
}

/**
 * Create a mock ChainContext with a disconnected httpProvider
 * (getBlockNumber rejects with an error).
 */
export function createDisconnectedContext(overrides?: Partial<{
    chain: Partial<ChainConfig>;
}>): ChainContext {
    return createMockChainContext({
        ...overrides,
        httpProvider: {
            getBlockNumber: () => Promise.reject(new Error('could not detect network')),
        },
    });
}
