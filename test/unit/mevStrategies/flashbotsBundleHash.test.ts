// test/unit/mevStrategies/flashbotsBundleHash.test.ts
// Phase 21 Plan 21-01 / Task 3 — EXIT-LIVE-04 capture mechanism: when a Flashbots
// bundle is INCLUDED (waitResponse === BundleIncluded === 0), the strategy must
// log BOTH the bundle hash and the mined tx hash from the same
// FlashbotsTransactionResponse, so the live-capture run can map bundleHash →
// minedTxHash.
//
// Today FlashbotsMevStrategy returns ONLY bundleTransactions[0].hash (the mined
// hash); bundle.bundleHash is available but was never logged (RESEARCH Pitfall 2).
// This test asserts the new op:'flashbots.bundle.included' log captures both, and
// that they are DISTINCT values.
//
// T-21-01-03 (Information Disclosure): the log must surface ONLY public,
// on-chain-resolvable values (bundleHash, minedTxHash, block) — never the signed
// raw tx or the auth key. This test also asserts no signedTransaction leaks.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JsonRpcProvider, Wallet, TransactionRequest } from 'ethers';

// Phase 21.3-01: the strategy's submit closure now also performs a RAW
// eth_sendBundle multi-builder fanout via ethers v6 `FetchRequest` (the library
// drops the `builders` field). Mock ONLY FetchRequest so this test stays hermetic
// (no real relay call); importActual keeps Wallet/JsonRpcProvider/id/parseUnits real
// so the auth signing still exercises the real keccak + Wallet.
vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    class MockFetchRequest {
        url: string;
        body: string | Uint8Array | null = null;
        private headers: Record<string, string> = {};
        constructor(url: string) {
            this.url = url;
        }
        setHeader(key: string, value: string): void {
            this.headers[key.toLowerCase()] = value;
        }
        async send(): Promise<unknown> {
            return {
                statusCode: 200,
                assertOk(): void {
                    /* ok */
                },
                bodyJson: { result: { bundleHash: STUB_BUNDLE_HASH } },
            };
        }
    }
    return { ...actual, FetchRequest: MockFetchRequest };
});

// Capture the module child-logger's .info calls.
const logInfo = vi.fn();
const logWarn = vi.fn();
const logError = vi.fn();
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({ info: logInfo, warn: logWarn, error: logError, debug: vi.fn() }),
    },
}));

// Stubbed bundle response values — bundleHash and the mined tx hash are distinct.
const STUB_BUNDLE_HASH = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const STUB_MINED_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STUB_SIGNED_TX = '0xdeadbeefSIGNEDRAWTX'; // must NOT appear in any log

// Controls whether bundle.wait() resolves to BundleIncluded(0) or a miss.
let waitResolution = 0; // FlashbotsBundleResolution.BundleIncluded

const sendBundleMock = vi.fn();
const createMock = vi.fn();

vi.mock('@flashbots/ethers-provider-bundle', () => ({
    FlashbotsBundleProvider: {
        // create is (re)implemented in beforeEach because vitest's mockReset:true
        // wipes mock implementations between tests — without re-establishing it,
        // create would resolve to undefined and flashbotsProvider.sendBundle would
        // throw. This is test-harness wiring, not production behavior.
        create: createMock,
    },
}));

// -----------------------------------------------------------------------------
// Provider / wallet stubs
// -----------------------------------------------------------------------------

function makeProvider(): JsonRpcProvider {
    return {
        getTransactionCount: vi.fn().mockResolvedValue(0),
        getFeeData: vi.fn().mockResolvedValue({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n }),
        getNetwork: vi.fn().mockResolvedValue({ chainId: 1n }),
        getBlockNumber: vi.fn().mockResolvedValue(25_000_000),
        // Phase 21.1: the strategy is now a thin wrapper around
        // submitWithReconciliation, which reads the wallet balance for the
        // affordability bound (D-FEE-ESCALATION). A generous 10 ETH balance keeps
        // the tiny test tx affordable so the included-path assertions below hold.
        getBalance: vi.fn().mockResolvedValue(10_000_000_000_000_000_000n), // 10 ETH
    } as unknown as JsonRpcProvider;
}

function makeWallet(): Wallet {
    return {
        address: '0xWallet000000000000000000000000000000W01',
    } as unknown as Wallet;
}

// A valid hex private key for the auth signer construction inside the strategy.
const AUTH_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

beforeEach(() => {
    logInfo.mockReset();
    logWarn.mockReset();
    logError.mockReset();
    sendBundleMock.mockReset();
    // Re-establish the create→{sendBundle} resolution (wiped by mockReset:true).
    // Phase 21.1: the wrapper now also calls signBundle + simulate before sendBundle
    // (D-SIMULATE-BEFORE-SUBMIT). Provide a non-revert SimulationResponseSuccess
    // (no firstRevert) so the included-path assertions are reached.
    createMock.mockReset().mockResolvedValue({
        sendBundle: sendBundleMock,
        signBundle: vi.fn().mockResolvedValue(['0xsignedbundletx']),
        simulate: vi.fn().mockResolvedValue({ results: [], totalGasUsed: 21000 }),
    });
    waitResolution = 0;
    // Default included-bundle response shape (FlashbotsTransactionResponse).
    sendBundleMock.mockResolvedValue({
        bundleHash: STUB_BUNDLE_HASH,
        bundleTransactions: [{ hash: STUB_MINED_HASH, signedTransaction: STUB_SIGNED_TX, account: '0x', nonce: 0 }],
        wait: () => Promise.resolve(waitResolution),
        simulate: () => Promise.resolve({}),
        receipts: () => Promise.resolve([]),
    });
});

function bundleIncludedLog(): Record<string, unknown> | undefined {
    for (const call of logInfo.mock.calls) {
        const arg = call[0];
        if (arg && typeof arg === 'object' && arg.op === 'flashbots.bundle.included') return arg;
    }
    return undefined;
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('EXIT-LIVE-04 — Flashbots bundleHash → minedTxHash mapping log', () => {
    it('logs op:flashbots.bundle.included with both bundleHash and minedTxHash (distinct)', async () => {
        const { FlashbotsMevStrategy } = await import('../../../src/utils/mevStrategies/flashbots');
        const strategy = new FlashbotsMevStrategy({ authKey: AUTH_KEY });

        const txReq: TransactionRequest = { to: '0xRouter', data: '0x', gasLimit: 200_000n };
        const result = await strategy.sendTransaction(txReq, makeWallet(), makeProvider(), 0);

        // Return value unchanged: the mined tx hash.
        expect(result).toBe(STUB_MINED_HASH);

        const logged = bundleIncludedLog();
        expect(logged).toBeDefined();
        expect(logged!.bundleHash).toBe(STUB_BUNDLE_HASH);
        expect(logged!.minedTxHash).toBe(STUB_MINED_HASH);
        // The two hashes are genuinely distinct values.
        expect(logged!.bundleHash).not.toBe(logged!.minedTxHash);
    });

    it('T-21-01-03: the bundle-mapping log does NOT leak the signed raw transaction', async () => {
        const { FlashbotsMevStrategy } = await import('../../../src/utils/mevStrategies/flashbots');
        const strategy = new FlashbotsMevStrategy({ authKey: AUTH_KEY });

        await strategy.sendTransaction(
            { to: '0xRouter', data: '0x', gasLimit: 200_000n },
            makeWallet(),
            makeProvider(),
            0,
        );

        const logged = bundleIncludedLog();
        expect(logged).toBeDefined();
        // No signed-transaction field should be present in the log object.
        const serialized = JSON.stringify(logged);
        expect(serialized).not.toContain(STUB_SIGNED_TX);
        expect(Object.keys(logged!)).not.toContain('signedTransaction');
        // Sanity: the auth key must never appear either.
        expect(serialized).not.toContain(AUTH_KEY);
    });

    it('the included-bundle log includes the target block (on-chain-resolvable)', async () => {
        const { FlashbotsMevStrategy } = await import('../../../src/utils/mevStrategies/flashbots');
        const strategy = new FlashbotsMevStrategy({ authKey: AUTH_KEY });

        await strategy.sendTransaction(
            { to: '0xRouter', data: '0x', gasLimit: 200_000n },
            makeWallet(),
            makeProvider(),
            0,
        );

        const logged = bundleIncludedLog();
        expect(logged).toBeDefined();
        // targetBlock = getBlockNumber() + 1 = 25_000_001
        expect(logged!.block).toBe(25_000_001);
    });
});
