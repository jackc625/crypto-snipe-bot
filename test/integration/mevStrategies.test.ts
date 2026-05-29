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

// Phase 21.3-01: the Flashbots submit closure now also performs a RAW eth_sendBundle
// multi-builder fanout via ethers v6 FetchRequest (the library silently drops the
// `builders` field — Pitfall 1). These tests mock the @flashbots library `sendBundle`
// (still the asserted native-confirm + deterministic-hash source) but not the raw relay
// HTTP call — so mock ONLY FetchRequest to make the raw fanout succeed hermetically.
// importActual keeps Wallet/id real so the auth signing still exercises the real keccak +
// Wallet. No assertion changes: the library-sendBundle path the tests assert runs after
// the raw loop and is unchanged — this only un-blocks reaching it (no real relay call).
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
            // Phase 21.1: the wrapper now signs + simulates before sendBundle
            // (D-SIMULATE-BEFORE-SUBMIT). Provide non-revert sim + a clean bundle.
            signBundle: vi.fn().mockResolvedValue(['0xsignedbundletx']),
            simulate: vi.fn().mockResolvedValue({ results: [], totalGasUsed: 21000 }),
            sendBundle: vi.fn().mockResolvedValue({
                bundleHash: '0xbundlehash',
                bundleTransactions: [{ hash: '0xrealtxhash0000000000000000000000000000000000000000000000000000', nonce: 42 }],
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
                    // Re-fetched 'latest' nonce (42) — D-NONCE-SAFE-RETRY, no base+attempt.
                    transaction: expect.objectContaining({ nonce: 42 }),
                }),
            ]),
            18000001, // currentBlock + 1
        );
    });

    it('sendTransaction includes correct targetBlockNumber', async () => {
        const capturedBlocks: number[] = [];
        const mockFbProvider = {
            signBundle: vi.fn().mockResolvedValue(['0xsignedbundletx']),
            simulate: vi.fn().mockResolvedValue({ results: [], totalGasUsed: 21000 }),
            sendBundle: vi.fn().mockImplementation(async (_b: any, block: number) => {
                capturedBlocks.push(block);
                return {
                    bundleHash: '0x',
                    bundleTransactions: [{ hash: '0xrealtxhash0000000000000000000000000000000000000000000000000000', nonce: 42 }],
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

    it('sendTransaction returns real tx hash from bundleTransactions[0].hash, not synthetic', async () => {
        const REAL_HASH = '0xrealtxhash0000000000000000000000000000000000000000000000000000';
        const mockFbProvider = {
            signBundle: vi.fn().mockResolvedValue(['0xsignedbundletx']),
            simulate: vi.fn().mockResolvedValue({ results: [], totalGasUsed: 21000 }),
            sendBundle: vi.fn().mockResolvedValue({
                bundleHash: '0xbundlehash',
                bundleTransactions: [{ hash: REAL_HASH, nonce: 42 }],
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

        const result = await strategy.sendTransaction(createMockTxRequest(), wallet, provider as any, 0);

        expect(result).toBe(REAL_HASH);
        expect(result).not.toMatch(/^flashbots_bundle_block_/);
    });

    it('sendTransaction throws descriptive error if bundleTransactions[0].hash is missing', async () => {
        const mockFbProvider = {
            signBundle: vi.fn().mockResolvedValue(['0xsignedbundletx']),
            simulate: vi.fn().mockResolvedValue({ results: [], totalGasUsed: 21000 }),
            sendBundle: vi.fn().mockResolvedValue({
                bundleHash: '0xbundlehash',
                bundleTransactions: [],
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

        await expect(
            strategy.sendTransaction(createMockTxRequest(), wallet, provider as any, 0),
        ).rejects.toThrow(/missing bundleTransactions\[0\]\.hash/);
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
        const { keccak256 } = await import('ethers');
        // Phase 21.1: bloXroute now ALWAYS reconciles against chain state (relay ACK
        // is not inclusion proof). createMockProvider defaults getTransactionReceipt
        // → {status:1}, so the reconciler returns the DETERMINISTIC signed-tx hash.
        const provider = createMockProvider();

        // signTransaction must return a VALID-hex raw — bloXroute computes the tx
        // hash locally via keccak256 (the hash the reconciler probes).
        const SIGNED_RAW = '0xdeadbeefcafe';
        const wallet = {
            address: '0x1234',
            signTransaction: vi.fn().mockResolvedValue(SIGNED_RAW),
        } as any;

        const strategy = new BloxrouteMevStrategy({
            endpoint: 'https://api.blxrbdn.com',
            authHeader: 'test-auth-header',
        });

        const result = await strategy.sendTransaction(createMockTxRequest(), wallet, provider as any, 0);

        // Returns the reconciled on-chain (locally-signed) tx hash, not the raw
        // relay ACK string — for a real signed tx these are the same value.
        expect(result).toBe(keccak256(SIGNED_RAW));
        expect(axiosPostMock).toHaveBeenCalledTimes(1);
        expect(axiosPostMock).toHaveBeenCalledWith(
            'https://api.blxrbdn.com',
            expect.objectContaining({
                method: 'bsc_private_tx',
                params: expect.objectContaining({
                    transaction: SIGNED_RAW,
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

    it('returns a real on-chain tx hash — no synthetic-hash bug on BSC path (regression)', async () => {
        // Regression coverage for REVIEWS.md action 11: bloXroute must return a REAL
        // tx hash, never a synthetic placeholder (like the Flashbots bug fixed in
        // Phase 14). Phase 21.1 strengthens this: the returned hash is the
        // DETERMINISTIC locally-signed tx hash CONFIRMED against chain state
        // (getTransactionReceipt status 1), not the unverified relay ACK — closing
        // the relay-accept-then-timeout false-negative/double-spend gap.
        const REAL_BSC_HASH = '0xbsc0real0tx0hash000000000000000000000000000000000000000000000000';
        const axiosPostMock = vi.fn().mockResolvedValue({
            data: { result: REAL_BSC_HASH, error: null },
        });

        vi.doMock('axios', () => ({
            default: { post: axiosPostMock },
            post: axiosPostMock,
        }));

        const { BloxrouteMevStrategy } = await import('../../src/utils/mevStrategies/bloxroute');
        const { keccak256 } = await import('ethers');
        const provider = createMockProvider();
        const SIGNED_RAW = '0xfeedface1234';
        const wallet = {
            address: '0x1234',
            signTransaction: vi.fn().mockResolvedValue(SIGNED_RAW),
        } as any;

        const strategy = new BloxrouteMevStrategy({
            endpoint: 'https://api.blxrbdn.com',
            authHeader: 'test-auth-header',
        });

        const result = await strategy.sendTransaction(createMockTxRequest(), wallet, provider as any, 0);

        // The reconciled, real signed-tx hash — no synthetic prefix.
        expect(result).toBe(keccak256(SIGNED_RAW));
        expect(result).not.toMatch(/^bloxroute_/);
        expect(result).not.toMatch(/^flashbots_bundle_block_/);
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

    it('reconciles a wait-timeout to a landed tx and returns the real hash (no resubmit)', async () => {
        // Phase 21.1 / STOP-THE-LINE-02: the retry semantics changed. The old loop
        // resubmitted on ANY thrown attempt (the baseNonce+attempt double-spend
        // hazard). The wrapper now routes through submitWithReconciliation: when the
        // native tx.wait(3) TIMES OUT (the Base/Arb LADYS class) the strategy does
        // NOT throw/resubmit — it reconciles the deterministic tx.hash against chain
        // state. getTransactionReceipt(status:1) → returns the real hash, ONE submit.
        vi.doMock('@flashbots/ethers-provider-bundle', () => ({
            FlashbotsBundleProvider: { create: vi.fn() },
        }));

        const { PassthroughMevStrategy } = await import('../../src/utils/mevStrategies/passthrough');
        // createMockProvider defaults getTransactionReceipt → {status:1} (landed).
        const provider = createMockProvider();

        const wallet = {
            address: '0x1234',
            sendTransaction: vi.fn().mockResolvedValue({
                hash: '0xretry-success',
                wait: vi.fn().mockRejectedValue(new Error('tx.wait timeout under RPC lag')),
            }),
        } as any;

        const strategy = new PassthroughMevStrategy('arb');

        const result = await strategy.sendTransaction(createMockTxRequest(), wallet, provider as any, 2);

        // ONE submit — the timeout reconciled instead of resubmitting (no double-spend).
        expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
        expect(result).toBe('0xretry-success');
    });

    it('a broadcast that throws (no tx created) propagates without resubmitting the same nonce', async () => {
        // Phase 21.1 / D-NONCE-SAFE-RETRY: a wallet.sendTransaction that THROWS
        // produced no tx (no hash, nonce not consumed). The wrapper propagates it
        // rather than blindly resubmitting at an incremented nonce (the old
        // baseNonce+attempt double-spend hazard). The operator re-runs; we never
        // fire a second real broadcast off the back of a failed one.
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

        // Exactly ONE broadcast attempt — no same-nonce resubmit on a thrown broadcast.
        expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
    });
});
