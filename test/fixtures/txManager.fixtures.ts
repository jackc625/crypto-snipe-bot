// test/fixtures/txManager.fixtures.ts
// Mock TX data for MEV strategy tests.
// Factory functions return typed mock data for transaction requests, bundle responses,
// and Flashbots provider instances.

import { vi } from 'vitest';

/**
 * Create a mock transaction request matching ethers v6 TransactionRequest shape.
 */
export function createMockTxRequest() {
    return {
        to: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 Router
        data: '0x38ed173900000000000000000000000000000000',
        value: 10000000000000000n, // 0.01 ETH
        gasLimit: 300000n,
    };
}

/**
 * Create a mock Flashbots bundle response.
 * @param success - Whether the bundle was included (wait resolves to 0) or not (1)
 */
export function createMockBundleResponse(success: boolean = true) {
    return {
        bundleHash: '0xbundle1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        wait: vi.fn().mockResolvedValue(success ? 0 : 1),
    };
}

/**
 * Create a mock Flashbots provider with vi.fn() methods.
 * Matches the FlashbotsBundleProvider API surface used in txManager.ts.
 */
export function createMockFlashbotsProvider() {
    return {
        sendBundle: vi.fn().mockResolvedValue({
            bundleHash: '0xbundle1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
            wait: vi.fn().mockResolvedValue(0),
        }),
        getUserStats: vi.fn().mockResolvedValue({
            signing_address: '0xsigner',
            blocks_won_total: 10,
            bundles_submitted_total: 100,
        }),
        simulate: vi.fn().mockResolvedValue({
            totalGasUsed: 21000,
            bundleGasPrice: 30000000000n,
            results: [{ txHash: '0xmocktxhash', gasUsed: 21000 }],
        }),
    };
}
