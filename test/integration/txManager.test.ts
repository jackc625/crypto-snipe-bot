// test/integration/txManager.test.ts
// Integration tests for txManager: sendTxWithRetry retry behavior, nonce increments,
// MEV strategy dispatch. (TEST-03)
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Imports (fixture helpers only — no production module side effects)
// ---------------------------------------------------------------------------

import { createMockTxRequest } from '../fixtures/txManager.fixtures';
import { createMockChainConfig, createMockChainContext } from '../fixtures/api.fixtures';
import { createMockProvider } from '../helpers/mockProvider';

// ---------------------------------------------------------------------------
// Shared mock setup
// ---------------------------------------------------------------------------

function setupBaseMocks() {
    vi.doMock('../../src/utils/db', () => ({ db: {} }));
    vi.doMock('../../src/utils/logger', () => ({
        logger: {
            child: () => ({
                info: vi.fn(), warn: vi.fn(), debug: vi.fn(),
                error: vi.fn(), fatal: vi.fn(),
            }),
        },
    }));
    vi.doMock('../../src/config', () => ({
        CONFIG: { network: 'mainnet' },
    }));
    vi.doMock('../../src/utils/flashbots', () => ({
        getFlashbotsProvider: vi.fn(),
    }));
    vi.doMock('@flashbots/ethers-provider-bundle', () => ({
        FlashbotsBundleProvider: { create: vi.fn() },
    }));
    vi.doMock('axios', () => ({
        default: { post: vi.fn() },
    }));
}

// ---------------------------------------------------------------------------
// sendTxWithRetry — multi-chain (ChainContext) path
// ---------------------------------------------------------------------------

describe('sendTxWithRetry (multi-chain path)', () => {
    let mockStrategy: {
        name: string;
        healthCheck: ReturnType<typeof vi.fn>;
        sendTransaction: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.resetModules();

        mockStrategy = {
            name: 'mock-strategy',
            healthCheck: vi.fn().mockResolvedValue(true),
            sendTransaction: vi.fn().mockResolvedValue('0xmockhash'),
        };
    });

    async function importWithMockedStrategies() {
        setupBaseMocks();
        vi.doMock('../../src/utils/mevStrategies/flashbots', () => ({
            FlashbotsMevStrategy: class {
                name = mockStrategy.name;
                healthCheck = mockStrategy.healthCheck;
                sendTransaction = mockStrategy.sendTransaction;
            },
        }));
        vi.doMock('../../src/utils/mevStrategies/bloxroute', () => ({
            BloxrouteMevStrategy: class {
                name = mockStrategy.name;
                healthCheck = mockStrategy.healthCheck;
                sendTransaction = mockStrategy.sendTransaction;
            },
        }));
        vi.doMock('../../src/utils/mevStrategies/passthrough', () => ({
            PassthroughMevStrategy: class {
                name = mockStrategy.name;
                healthCheck = mockStrategy.healthCheck;
                sendTransaction = mockStrategy.sendTransaction;
            },
        }));
        return await import('../../src/utils/txManager');
    }

    it('calls strategy.sendTransaction and returns tx hash', async () => {
        const { sendTxWithRetry } = await importWithMockedStrategies();
        const ctx = createMockChainContext();
        const txBuilder = vi.fn().mockResolvedValue(createMockTxRequest());

        const result = await sendTxWithRetry(txBuilder, ctx, 3);

        expect(mockStrategy.sendTransaction).toHaveBeenCalledTimes(1);
        expect(result).toBe('0xmockhash');
    });

    it('passes maxRetries to strategy.sendTransaction', async () => {
        const { sendTxWithRetry } = await importWithMockedStrategies();
        const ctx = createMockChainContext();
        const txBuilder = vi.fn().mockResolvedValue(createMockTxRequest());

        await sendTxWithRetry(txBuilder, ctx, 5);

        // Phase 19 Gap-1 closure: sendTransaction now takes a 5th gasMultiplier
        // arg. When no multiplier is passed at the sendTxWithRetry layer it
        // arrives as `undefined` at the strategy (== no elevation, raw feeData).
        expect(mockStrategy.sendTransaction).toHaveBeenCalledWith(
            expect.any(Object), expect.anything(), expect.anything(), 5, undefined,
        );
    });

    it('defaults to 3 retries when not specified', async () => {
        const { sendTxWithRetry } = await importWithMockedStrategies();
        const ctx = createMockChainContext();
        const txBuilder = vi.fn().mockResolvedValue(createMockTxRequest());

        await sendTxWithRetry(txBuilder, ctx);

        expect(mockStrategy.sendTransaction).toHaveBeenCalledWith(
            expect.any(Object), expect.anything(), expect.anything(), 3, undefined,
        );
    });

    it('Phase 19 Gap-1: propagates gasMultiplier to strategy.sendTransaction', async () => {
        const { sendTxWithRetry } = await importWithMockedStrategies();
        const ctx = createMockChainContext();
        const txBuilder = vi.fn().mockResolvedValue(createMockTxRequest());

        // Multi-chain overload signature: txBuilder, ctx, walletOrRetries,
        // useFlashbots, maxRetries, gasMultiplier. Slots 3-5 are intentionally
        // unused on the multi-chain path; slot 6 carries the multiplier.
        await sendTxWithRetry(txBuilder, ctx, undefined, undefined, undefined, 2.0);

        expect(mockStrategy.sendTransaction).toHaveBeenCalledWith(
            expect.any(Object), expect.anything(), expect.anything(), 3, 2.0,
        );
    });

    it('propagates strategy sendTransaction errors', async () => {
        mockStrategy.sendTransaction.mockRejectedValue(new Error('MEV submission failed'));
        const { sendTxWithRetry } = await importWithMockedStrategies();
        const ctx = createMockChainContext();
        const txBuilder = vi.fn().mockResolvedValue(createMockTxRequest());

        await expect(sendTxWithRetry(txBuilder, ctx, 3))
            .rejects.toThrow('MEV submission failed');
    });
});

// ---------------------------------------------------------------------------
// createMevStrategy — dispatch tests (uses REAL strategy classes)
// ---------------------------------------------------------------------------

describe('createMevStrategy', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    async function importTxManagerReal() {
        setupBaseMocks();
        // Explicitly unmock strategy modules to use real classes
        vi.doUnmock('../../src/utils/mevStrategies/flashbots');
        vi.doUnmock('../../src/utils/mevStrategies/bloxroute');
        vi.doUnmock('../../src/utils/mevStrategies/passthrough');
        return await import('../../src/utils/txManager');
    }

    it('returns FlashbotsMevStrategy for flashbots chain config', async () => {
        const { createMevStrategy } = await importTxManagerReal();
        const chain = createMockChainConfig({
            mevStrategy: 'flashbots',
            mevConfig: { relayUrl: 'https://relay.flashbots.net', network: 'mainnet', authKey: '0x' + '1'.repeat(64) },
        });

        const strategy = createMevStrategy(chain);
        expect(strategy.name).toBe('flashbots');
    });

    it('returns BloxrouteMevStrategy for bloxroute chain config', async () => {
        const { createMevStrategy } = await importTxManagerReal();
        const chain = createMockChainConfig({
            mevStrategy: 'bloxroute',
            mevConfig: { endpoint: 'https://api.blxrbdn.com', authHeader: 'test-auth' },
        });

        const strategy = createMevStrategy(chain);
        expect(strategy.name).toBe('bloxroute-bsc');
    });

    it('returns PassthroughMevStrategy for passthrough chain config', async () => {
        const { createMevStrategy } = await importTxManagerReal();
        const chain = createMockChainConfig({
            name: 'base',
            mevStrategy: 'passthrough',
            mevConfig: {},
        });

        const strategy = createMevStrategy(chain);
        expect(strategy.name).toBe('passthrough-base');
    });
});

// ---------------------------------------------------------------------------
// FlashbotsMevStrategy nonce increment + retry (tested via strategy directly)
// ---------------------------------------------------------------------------

describe('FlashbotsMevStrategy nonce and retry behavior', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    async function importFlashbotsStrategy(mockFbProvider: Record<string, unknown>) {
        vi.doMock('../../src/utils/logger', () => ({
            logger: {
                child: () => ({
                    info: vi.fn(), warn: vi.fn(), debug: vi.fn(),
                    error: vi.fn(), fatal: vi.fn(),
                }),
            },
        }));
        vi.doMock('@flashbots/ethers-provider-bundle', () => ({
            FlashbotsBundleProvider: {
                create: vi.fn().mockResolvedValue(mockFbProvider),
            },
        }));
        // Explicitly unmock to get real implementation
        vi.doUnmock('../../src/utils/mevStrategies/flashbots');
        vi.doUnmock('../../src/utils/mevStrategies/bloxroute');
        vi.doUnmock('../../src/utils/mevStrategies/passthrough');
        const mod = await import('../../src/utils/mevStrategies/flashbots');
        return mod.FlashbotsMevStrategy;
    }

    it('increments nonce on each retry attempt (N, N+1, N+2)', async () => {
        const mockProvider = createMockProvider({
            getTransactionCount: vi.fn().mockResolvedValue(42),
        });

        const sendBundleCalls: any[] = [];
        const FlashbotsMevStrategy = await importFlashbotsStrategy({
            sendBundle: vi.fn().mockImplementation(async (bundle: any) => {
                sendBundleCalls.push(bundle);
                if (sendBundleCalls.length <= 2) {
                    return { error: { message: `Bundle not included` } };
                }
                return {
                    bundleHash: '0xbundle123',
                    bundleTransactions: [{ hash: '0xrealtxhash0000000000000000000000000000000000000000000000000000' }],
                    wait: vi.fn().mockResolvedValue(0),
                };
            }),
        });

        const strategy = new FlashbotsMevStrategy({
            relayUrl: 'https://relay.flashbots.net',
            network: 'mainnet',
            authKey: '0x' + '1'.repeat(64),
        });

        const mockWallet = { address: '0x1234' } as any;
        await strategy.sendTransaction(createMockTxRequest(), mockWallet, mockProvider as any, 3);

        expect(sendBundleCalls.length).toBe(3);
        const nonces = sendBundleCalls.map(b => b[0].transaction.nonce);
        expect(nonces).toEqual([42, 43, 44]);
    });

    it('includes correct targetBlockNumber = currentBlock + 1', async () => {
        const mockProvider = createMockProvider({
            getBlockNumber: vi.fn().mockResolvedValue(18000000),
        });

        const capturedTargetBlocks: number[] = [];
        const FlashbotsMevStrategy = await importFlashbotsStrategy({
            sendBundle: vi.fn().mockImplementation(async (_b: any, targetBlock: number) => {
                capturedTargetBlocks.push(targetBlock);
                return {
                    bundleHash: '0x',
                    bundleTransactions: [{ hash: '0xrealtxhash0000000000000000000000000000000000000000000000000000' }],
                    wait: vi.fn().mockResolvedValue(0),
                };
            }),
        });

        const strategy = new FlashbotsMevStrategy({
            relayUrl: 'https://relay.flashbots.net',
            network: 'mainnet',
            authKey: '0x' + '1'.repeat(64),
        });

        const mockWallet = { address: '0x1234' } as any;
        await strategy.sendTransaction(createMockTxRequest(), mockWallet, mockProvider as any, 0);

        expect(capturedTargetBlocks[0]).toBe(18000001);
    });

    it('throws after maxRetries exhausted', async () => {
        const mockProvider = createMockProvider();
        const mockSendBundle = vi.fn().mockResolvedValue({
            error: { message: 'Bundle rejected' },
        });

        const FlashbotsMevStrategy = await importFlashbotsStrategy({
            sendBundle: mockSendBundle,
        });

        const strategy = new FlashbotsMevStrategy({
            relayUrl: 'https://relay.flashbots.net',
            network: 'mainnet',
            authKey: '0x' + '1'.repeat(64),
        });

        const mockWallet = { address: '0x1234' } as any;

        await expect(
            strategy.sendTransaction(createMockTxRequest(), mockWallet, mockProvider as any, 2)
        ).rejects.toThrow();

        // 0, 1, 2 = 3 attempts total
        expect(mockSendBundle).toHaveBeenCalledTimes(3);
    });

    it('healthCheck returns true when auth key is valid', async () => {
        const FlashbotsMevStrategy = await importFlashbotsStrategy({});

        const strategy = new FlashbotsMevStrategy({
            relayUrl: 'https://relay.flashbots.net',
            network: 'mainnet',
            authKey: '0x' + '1'.repeat(64),
        });

        expect(await strategy.healthCheck()).toBe(true);
    });

    it('healthCheck returns false when auth key is missing', async () => {
        const origEnv = process.env.FLASHBOTS_AUTH_KEY;
        delete process.env.FLASHBOTS_AUTH_KEY;

        const FlashbotsMevStrategy = await importFlashbotsStrategy({});

        const strategy = new FlashbotsMevStrategy({
            relayUrl: 'https://relay.flashbots.net',
            network: 'mainnet',
        });

        expect(await strategy.healthCheck()).toBe(false);

        if (origEnv !== undefined) process.env.FLASHBOTS_AUTH_KEY = origEnv;
    });
});
