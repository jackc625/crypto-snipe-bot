// test/fixtures/api.fixtures.ts
// Shared mock fixtures for API route tests.
// Creates typed mock ChainContext objects without importing production modules
// that require live DB/network connections.

import type { ChainContext, ChainConfig, DexConfigV2, DexConfigV3 } from '../../src/chainRegistry';

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

/** Create a BSC mock context with both Uniswap V3 and PancakeSwap V3 dexes */
export function createMockBscMultiDexContext(): ChainContext {
    return createMockChainContext({
        chainId: 56,
        name: 'bsc',
        displayName: '[BSC]',
        nativeCurrency: 'BNB',
        wethAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        dexes: [
            {
                dexType: 'v3' as const,
                name: 'uniswap-v3',
                factoryAddress: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7',
                swapRouterAddress: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
                quoterAddress: '0x78D78E420Da98ad378D7799bE8f4AF69033EB077',
            } as DexConfigV3,
            {
                dexType: 'v3' as const,
                name: 'pancakeswap-v3',
                factoryAddress: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
                swapRouterAddress: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
                quoterAddress: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
            } as DexConfigV3,
        ],
    });
}

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
