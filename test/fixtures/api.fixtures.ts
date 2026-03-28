// test/fixtures/api.fixtures.ts
// Shared mock fixtures for API route tests.
// Creates typed mock ChainContext objects without importing production modules
// that require live DB/network connections.

import type { ChainContext, ChainConfig, DexConfigV2 } from '../../src/chainRegistry';

export const MOCK_API_KEY = 'test-dashboard-api-key-12345';

/** Create a minimal mock ChainConfig for testing */
export function createMockChainConfig(overrides: Partial<ChainConfig> = {}): ChainConfig {
    return {
        chainId: 1,
        name: 'eth',
        displayName: '[ETH]',
        enabled: true,
        nativeCurrency: 'ETH',
        wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        httpRpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/abc123',
        wsRpcUrl: 'wss://eth-mainnet.g.alchemy.com/v2/abc123',
        dexes: [
            {
                dexType: 'v2' as const,
                name: 'uniswap-v2',
                factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
                routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
            } as DexConfigV2,
        ],
        mevStrategy: 'flashbots',
        mevConfig: {},
        safetyApis: { honeypot: 'honeypot.is', liquidityLock: 'unicrypt', tokenSecurity: 'goplus' },
        gas: { type: 'eip1559', multiplier: 1.2, maxGasLimit: 300_000n },
        snipeAmount: '0.01',
        maxCapital: '1.0',
        explorerUrl: 'https://etherscan.io',
        minLiquidityThreshold: '0.5',
        ...overrides,
    };
}

/** Create a minimal mock ChainContext for testing */
export function createMockChainContext(overrides: Partial<ChainConfig> = {}): ChainContext {
    const chain = createMockChainConfig(overrides);
    return {
        chain,
        httpProvider: {
            getBlockNumber: async () => 12345678,
        } as any,
        wsProvider: {
            removeAllListeners: () => {},
        } as any,
        wallet: {
            address: '0x1234567890abcdef1234567890abcdef12345678',
        } as any,
        log: {
            info: () => {},
            warn: () => {},
            error: () => {},
            fatal: () => {},
            debug: () => {},
            child: () => ({
                info: () => {},
                warn: () => {},
                error: () => {},
                debug: () => {},
            }),
        } as any,
    };
}

/** Create a mock ChainContext with a disconnected provider */
export function createDisconnectedChainContext(overrides: Partial<ChainConfig> = {}): ChainContext {
    const ctx = createMockChainContext(overrides);
    ctx.httpProvider = {
        getBlockNumber: async () => {
            throw new Error('Provider disconnected');
        },
    } as any;
    return ctx;
}

// Alias for backward compatibility with health tests
export const createDisconnectedContext = createDisconnectedChainContext;

/** Create a mock trade row from the DB */
export function createMockTradeRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        token: '0xabcdef1234567890abcdef1234567890abcdef12',
        chain: 'eth',
        action: 'buy',
        pool_type: 'v2',
        fee_tier: null,
        status: 'pending',
        amount_in: '0.01',
        ...overrides,
    };
}
