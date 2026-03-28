// test/integration/mevStrategies.test.ts
// Integration tests for all 3 MEV strategy adapters:
// FlashbotsMevStrategy, BloxrouteMevStrategy, PassthroughMevStrategy.
// (TEST-03 supplement)
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/utils/db', () => ({ db: {} }));

vi.mock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        }),
    },
}));

vi.mock('../../src/config', () => ({
    CONFIG: { network: 'mainnet' },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createMockTxRequest } from '../fixtures/txManager.fixtures';
import { createMockProvider } from '../helpers/mockProvider';

// ---------------------------------------------------------------------------
// FlashbotsMevStrategy
// ---------------------------------------------------------------------------

describe('FlashbotsMevStrategy', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('sendTransaction calls FlashbotsBundleProvider.sendBundle', async () => {
        const mockFbProvider = {
            sendBundle: vi.fn().mockResolvedValue({
                bundleHash: '0xbundlehash',
                wait: vi.fn().mockResolvedValue(0),
            }),
        };

        vi.doMock('@flashbots/ethers-provider-bundle', () => ({
            FlashbotsBundleProvider: {
                create: vi.fn().mockResolvedValue(mockFbProvider),
            },
        }));

        const { FlashbotsMevStrategy } = await import('../../src/utils/mevStrategies/flashbots');
        const provider = createMockProvider();
        const wallet = { address: '0x1234' } as any;

        const strategy = new FlashbotsMevStrategy({
            relayUrl: 'https://relay.flashbots.net',
            network: 'mainnet',
            authKey: '0x' + '1'.repeat(64),
        });

        await strategy.sendTransaction(createMockTxRequest(), wallet, provider as any, 0);

        expect(mockFbProvider.sendBundle).toHaveBeenCalledTimes(1);
        expect(mockFbProvider.sendBundle).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    signer: wallet,
                    transaction: expect.objectContaining({ nonce: 42 }),
                }),
            ]),
            18000001, // currentBlock + 1
        );
    });

    it('sendTransaction includes correct targetBlockNumber', async () => {
        const capturedBlocks: number[] = [];
        const mockFbProvider = {
            sendBundle: vi.fn().mockImplementation(async (_b: any, block: number) => {
                capturedBlocks.push(block);
                return {
                    bundleHash: '0x',
                    wait: vi.fn().mockResolvedValue(0),
                };
            }),
        };

        vi.doMock('@flashbots/ethers-provider-bundle', () => ({
            FlashbotsBundleProvider: {
                create: vi.fn().mockResolvedValue(mockFbProvider),
            },
        }));

        const { FlashbotsMevStrategy } = await import('../../src/utils/mevStrategies/flashbots');
        const provider = createMockProvider({ getBlockNumber: vi.fn().mockResolvedValue(99999) });
        const wallet = { address: '0x1234' } as any;

        const strategy = new FlashbotsMevStrategy({
            relayUrl: 'https://relay.flashbots.net',
            network: 'mainnet',
            authKey: '0x' + '1'.repeat(64),
        });

        await strategy.sendTransaction(createMockTxRequest(), wallet, provider as any, 0);

        expect(capturedBlocks[0]).toBe(100000); // 99999 + 1
    });

    it('healthCheck calls auth key validation and returns true on success', async () => {
        vi.doMock('@flashbots/ethers-provider-bundle', () => ({
            FlashbotsBundleProvider: { create: vi.fn() },
        }));

        const { FlashbotsMevStrategy } = await import('../../src/utils/mevStrategies/flashbots');

        const strategy = new FlashbotsMevStrategy({
            relayUrl: 'https://relay.flashbots.net',
            network: 'mainnet',
            authKey: '0x' + '1'.repeat(64),
        });

        expect(await strategy.healthCheck()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// BloxrouteMevStrategy
// ---------------------------------------------------------------------------

describe('BloxrouteMevStrategy', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('sendTransaction sends bsc_private_tx JSON-RPC call via axios', async () => {
        const axiosPostMock = vi.fn().mockResolvedValue({
            data: { result: '0xbsctxhash', error: null },
        });

        vi.doMock('axios', () => ({
            default: { post: axiosPostMock },
            post: axiosPostMock,
        }));

        const { BloxrouteMevStrategy } = await import('../../src/utils/mevStrategies/bloxroute');
        const provider = createMockProvider();

        // Mock wallet.signTransaction
        const wallet = {
            address: '0x1234',
            signTransaction: vi.fn().mockResolvedValue('0xsignedtx'),
        } as any;

        const strategy = new BloxrouteMevStrategy({
            endpoint: 'https://api.blxrbdn.com',
            authHeader: 'test-auth-header',
        });

        const result = await strategy.sendTransaction(createMockTxRequest(), wallet, provider as any, 0);

        expect(result).toBe('0xbsctxhash');
        expect(axiosPostMock).toHaveBeenCalledTimes(1);
        expect(axiosPostMock).toHaveBeenCalledWith(
            'https://api.blxrbdn.com',
            expect.objectContaining({
                method: 'bsc_private_tx',
                params: expect.objectContaining({
                    transaction: '0xsignedtx',
                }),
            }),
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'test-auth-header',
                }),
            }),
        );
    });

    it('healthCheck returns false when no auth header', async () => {
        // Clear env
        const origEnv = process.env.BLOXROUTE_AUTH_HEADER;
        delete process.env.BLOXROUTE_AUTH_HEADER;

        vi.doMock('axios', () => ({
            default: { post: vi.fn() },
            post: vi.fn(),
        }));

        const { BloxrouteMevStrategy } = await import('../../src/utils/mevStrategies/bloxroute');

        const strategy = new BloxrouteMevStrategy({
            endpoint: 'https://api.blxrbdn.com',
            // no authHeader
        });

        expect(await strategy.healthCheck()).toBe(false);

        if (origEnv !== undefined) process.env.BLOXROUTE_AUTH_HEADER = origEnv;
    });
});

// ---------------------------------------------------------------------------
// PassthroughMevStrategy
// ---------------------------------------------------------------------------

describe('PassthroughMevStrategy', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('sendTransaction calls wallet.sendTransaction directly', async () => {
        vi.doMock('@flashbots/ethers-provider-bundle', () => ({
            FlashbotsBundleProvider: { create: vi.fn() },
        }));

        const { PassthroughMevStrategy } = await import('../../src/utils/mevStrategies/passthrough');
        const provider = createMockProvider();

        const txResponse = {
            hash: '0xpassthroughhash',
            wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 18000001 }),
        };

        const wallet = {
            address: '0x1234',
            sendTransaction: vi.fn().mockResolvedValue(txResponse),
        } as any;

        const strategy = new PassthroughMevStrategy('base');

        const result = await strategy.sendTransaction(createMockTxRequest(), wallet, provider as any, 0);

        expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
        expect(wallet.sendTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                nonce: 42, // baseNonce from mockProvider
            }),
        );
        expect(result).toBe('0xpassthroughhash');
    });

    it('healthCheck always returns true', async () => {
        vi.doMock('@flashbots/ethers-provider-bundle', () => ({
            FlashbotsBundleProvider: { create: vi.fn() },
        }));

        const { PassthroughMevStrategy } = await import('../../src/utils/mevStrategies/passthrough');

        const strategy = new PassthroughMevStrategy('base');
        expect(await strategy.healthCheck()).toBe(true);
    });

    it('retries on failure and succeeds on subsequent attempt', async () => {
        vi.doMock('@flashbots/ethers-provider-bundle', () => ({
            FlashbotsBundleProvider: { create: vi.fn() },
        }));

        const { PassthroughMevStrategy } = await import('../../src/utils/mevStrategies/passthrough');
        const provider = createMockProvider();

        let callCount = 0;
        const wallet = {
            address: '0x1234',
            sendTransaction: vi.fn().mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('TX failed first attempt');
                }
                return {
                    hash: '0xretry-success',
                    wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 18000002 }),
                };
            }),
        } as any;

        const strategy = new PassthroughMevStrategy('arb');

        const result = await strategy.sendTransaction(createMockTxRequest(), wallet, provider as any, 2);

        expect(wallet.sendTransaction).toHaveBeenCalledTimes(2);
        expect(result).toBe('0xretry-success');
    });

    it('throws after maxRetries exhausted', async () => {
        vi.doMock('@flashbots/ethers-provider-bundle', () => ({
            FlashbotsBundleProvider: { create: vi.fn() },
        }));

        const { PassthroughMevStrategy } = await import('../../src/utils/mevStrategies/passthrough');
        const provider = createMockProvider();

        const wallet = {
            address: '0x1234',
            sendTransaction: vi.fn().mockRejectedValue(new Error('always fails')),
        } as any;

        const strategy = new PassthroughMevStrategy('base');

        await expect(
            strategy.sendTransaction(createMockTxRequest(), wallet, provider as any, 1)
        ).rejects.toThrow('always fails');

        // 0 + 1 = 2 attempts total
        expect(wallet.sendTransaction).toHaveBeenCalledTimes(2);
    });
});
