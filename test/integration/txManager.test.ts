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

// Phase 21.3-01: the Flashbots submit closure now also performs a RAW eth_sendBundle
// multi-builder fanout via ethers v6 FetchRequest (the library silently drops the
// `builders` field — Pitfall 1). The FlashbotsMevStrategy tests below mock the @flashbots
// library `sendBundle` (still the asserted native-confirm + deterministic-hash source)
// but not the raw relay HTTP call — so mock ONLY FetchRequest to make the raw fanout
// succeed hermetically. importActual keeps Wallet/id real so auth signing still exercises
// the real keccak + Wallet. No assertion changes: the library-sendBundle path the tests
// assert (nonce reuse / targetBlock / relay-rejection) runs after the raw loop and is
// unchanged — this only un-blocks reaching it (no real relay call).
vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    class MockFetchRequest {
        url: string;
        body: string | Uint8Array | null = null;
        private headers: Record<string, string> = {};
        constructor(url: string) { this.url = url; }
        setHeader(key: string, value: string): void { this.headers[key.toLowerCase()] = value; }
        async send(): Promise<unknown> {
            return {
                statusCode: 200,
                assertOk(): void { /* ok */ },
                bodyJson: { result: { bundleHash: '0x' + 'ab'.repeat(32) } },
            };
        }
    }
    return { ...actual, FetchRequest: MockFetchRequest };
});

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
    // Phase 21.1 (D-DELETE-LEGACY): the legacy sendTxWithRetry Flashbots branch
    // was deleted, so txManager no longer imports `../../src/utils/flashbots`
    // (the module itself was removed) — its getFlashbotsProvider mock is gone.
    // The @flashbots/ethers-provider-bundle mock stays: the createMevStrategy
    // dispatch tests below import the REAL FlashbotsMevStrategy, which imports
    // FlashbotsBundleProvider.
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
        // Phase 21.2-12 (CR-02): a 6th optional BroadcastHandle out-param now
        // exists; this direct sendTxWithRetry call passes none, so it arrives as
        // `undefined` at the strategy (only escalatePrivateSell supplies a handle).
        expect(mockStrategy.sendTransaction).toHaveBeenCalledWith(
            expect.any(Object), expect.anything(), expect.anything(), 5, undefined, undefined,
        );
    });

    it('defaults to 3 retries when not specified', async () => {
        const { sendTxWithRetry } = await importWithMockedStrategies();
        const ctx = createMockChainContext();
        const txBuilder = vi.fn().mockResolvedValue(createMockTxRequest());

        await sendTxWithRetry(txBuilder, ctx);

        expect(mockStrategy.sendTransaction).toHaveBeenCalledWith(
            expect.any(Object), expect.anything(), expect.anything(), 3, undefined, undefined,
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
            expect.any(Object), expect.anything(), expect.anything(), 3, 2.0, undefined,
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

    it('a genuine resubmit reuses the re-fetched "latest" nonce, NEVER base+attempt (no double-spend)', async () => {
        // Phase 21.1 / STOP-THE-LINE-02 (D-NONCE-SAFE-RETRY): this REPLACES the old
        // "increments nonce N, N+1, N+2" assertion, which encoded the exact
        // baseNonce+attempt DOUBLE-SPEND that the LADYS incident exposed. Under the
        // fix, every genuine resubmit re-fetches getTransactionCount('latest') and
        // reuses THAT nonce (a replacement tx at the SAME nonce). With the on-chain
        // nonce held at 42, three not-landed attempts all submit at nonce 42 —
        // [42, 42, 42], NOT [42, 43, 44]. Resubmitting at an incremented nonce is
        // precisely what could fire a second real buy.
        process.env.MEV_CONFIRM_WINDOW_MS = '60';
        process.env.MEV_CONFIRM_POLL_MS = '10';

        const sendBundleCalls: any[] = [];
        // Nonce never advances → a resubmit is a replacement at the SAME nonce.
        // Receipt stays null until the 3rd submit (genuinely not-landed twice),
        // then status 1 (the 3rd attempt lands). wait()=1 each time so the helper
        // reconciles rather than trusting the relay.
        const mockProvider = createMockProvider({
            getTransactionCount: vi.fn().mockResolvedValue(42),
            getTransactionReceipt: vi.fn().mockImplementation(async () =>
                sendBundleCalls.length >= 3 ? { status: 1, blockNumber: 18000099 } : null
            ),
        });

        const FlashbotsMevStrategy = await importFlashbotsStrategy({
            signBundle: vi.fn().mockResolvedValue(['0xsignedbundletx']),
            simulate: vi.fn().mockResolvedValue({ results: [], totalGasUsed: 21000 }),
            sendBundle: vi.fn().mockImplementation(async (bundle: any) => {
                sendBundleCalls.push(bundle);
                return {
                    bundleHash: '0xbundle123',
                    bundleTransactions: [{ hash: '0xrealtxhash0000000000000000000000000000000000000000000000000000', nonce: 42 }],
                    wait: vi.fn().mockResolvedValue(1), // BlockPassed → reconcile by receipt
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
        // The load-bearing nonce-safety assertion: re-fetched 'latest' each time,
        // never base+attempt.
        expect(nonces).toEqual([42, 42, 42]);

        delete process.env.MEV_CONFIRM_WINDOW_MS;
        delete process.env.MEV_CONFIRM_POLL_MS;
    });

    it('includes correct targetBlockNumber = currentBlock + 1', async () => {
        const mockProvider = createMockProvider({
            getBlockNumber: vi.fn().mockResolvedValue(18000000),
        });

        const capturedTargetBlocks: number[] = [];
        const FlashbotsMevStrategy = await importFlashbotsStrategy({
            signBundle: vi.fn().mockResolvedValue(['0xsignedbundletx']),
            simulate: vi.fn().mockResolvedValue({ results: [], totalGasUsed: 21000 }),
            sendBundle: vi.fn().mockImplementation(async (_b: any, targetBlock: number) => {
                capturedTargetBlocks.push(targetBlock);
                return {
                    bundleHash: '0x',
                    bundleTransactions: [{ hash: '0xrealtxhash0000000000000000000000000000000000000000000000000000', nonce: 42 }],
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

    it('a relay rejection propagates without resubmitting the same nonce (no double-spend)', async () => {
        // Phase 21.1 / STOP-THE-LINE-02: REPLACES the old "throws after 3 attempts"
        // assertion. A relay rejection (`'error' in bundle`) produced no signed tx,
        // so the wrapper propagates it rather than blindly resubmitting at an
        // incremented nonce (the old baseNonce+attempt double-spend hazard). The
        // operator re-runs; we never fire a second real bundle off a rejected one.
        const mockProvider = createMockProvider();
        const mockSendBundle = vi.fn().mockResolvedValue({
            error: { message: 'Bundle rejected' },
        });

        const FlashbotsMevStrategy = await importFlashbotsStrategy({
            signBundle: vi.fn().mockResolvedValue(['0xsignedbundletx']),
            simulate: vi.fn().mockResolvedValue({ results: [], totalGasUsed: 21000 }),
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
        ).rejects.toThrow(/Flashbots error/i);

        // Exactly ONE sendBundle — no same-nonce resubmit on a relay rejection.
        expect(mockSendBundle).toHaveBeenCalledTimes(1);
    });

    it('a simulated revert fails cleanly and is never escalated-and-resubmitted (D-SIMULATE-BEFORE-SUBMIT)', async () => {
        // Phase 21.1: each submit closure simulates (eth_callBundle) before sending;
        // a simulated revert (firstRevert) must FAIL the attempt WITHOUT broadcasting
        // — we never escalate-and-resubmit a tx that would revert (threat T-21.1-15).
        const mockProvider = createMockProvider();
        const mockSendBundle = vi.fn();

        const FlashbotsMevStrategy = await importFlashbotsStrategy({
            signBundle: vi.fn().mockResolvedValue(['0xsignedbundletx']),
            // firstRevert set → the bundle would revert on-chain.
            simulate: vi.fn().mockResolvedValue({
                results: [{ error: 'execution reverted', revert: 'reverted' }],
                firstRevert: { error: 'execution reverted', revert: 'reverted' },
            }),
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
        ).rejects.toThrow(/revert/i);

        // The reverting bundle was NEVER broadcast.
        expect(mockSendBundle).not.toHaveBeenCalled();
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
