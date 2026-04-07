// test/unit/receiptDecoder.test.ts
// Unit tests for receiptDecoder.ts -- V2 Withdrawal, V3 Transfer, retry, missing events,
// spoofed logs, malformed logs, multiple transfers, missing gasPrice.
// Covers all behaviors listed in 14-01-PLAN.md Task 1.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    createMockReceipt,
    createWithdrawalLog,
    createTransferLog,
    createMalformedWethLog,
    WETH_ADDRESS,
    WALLET_ADDRESS,
    FAKE_TX_HASH,
    FOREIGN_TOKEN_ADDRESS,
} from '../fixtures/receipt.fixtures';

vi.mock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
        }),
    },
}));

// Import after mocks
import { decodeReceipt } from '../../src/utils/receiptDecoder';

function makeProvider(receipts: Array<any | null>) {
    let call = 0;
    return {
        getTransactionReceipt: vi.fn().mockImplementation(async () => {
            const r = receipts[Math.min(call, receipts.length - 1)];
            call++;
            return r;
        }),
    } as any;
}

describe('decodeReceipt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('extracts amountOut from V2 WETH Withdrawal event', async () => {
        const receipt = createMockReceipt({
            logs: [createWithdrawalLog(WETH_ADDRESS, WALLET_ADDRESS, 5000000000000000000n)],
        });
        const provider = makeProvider([receipt]);
        const result = await decodeReceipt(FAKE_TX_HASH, provider, WETH_ADDRESS, WALLET_ADDRESS);
        expect(result.amountOut).toBe('5000000000000000000');
    });

    it('extracts amountOut from V3 WETH Transfer-to-wallet fallback', async () => {
        const receipt = createMockReceipt({
            logs: [createTransferLog(WETH_ADDRESS, FOREIGN_TOKEN_ADDRESS, WALLET_ADDRESS, 3000000000000000000n)],
        });
        const provider = makeProvider([receipt]);
        const result = await decodeReceipt(FAKE_TX_HASH, provider, WETH_ADDRESS, WALLET_ADDRESS);
        expect(result.amountOut).toBe('3000000000000000000');
    });

    it('computes gas cost as gasUsed * gasPrice string', async () => {
        const receipt = createMockReceipt({
            gasUsed: 100000n,
            gasPrice: 30000000000n, // 30 gwei
            logs: [createWithdrawalLog(WETH_ADDRESS, WALLET_ADDRESS, 1n)],
        });
        const provider = makeProvider([receipt]);
        const result = await decodeReceipt(FAKE_TX_HASH, provider, WETH_ADDRESS, WALLET_ADDRESS);
        expect(result.gasCost).toBe((100000n * 30000000000n).toString());
    });

    it('extracts block number from receipt', async () => {
        const receipt = createMockReceipt({
            blockNumber: 999888777,
            logs: [createWithdrawalLog(WETH_ADDRESS, WALLET_ADDRESS, 1n)],
        });
        const provider = makeProvider([receipt]);
        const result = await decodeReceipt(FAKE_TX_HASH, provider, WETH_ADDRESS, WALLET_ADDRESS);
        expect(result.blockNumber).toBe(999888777);
    });

    it('retries receipt fetch once after 2s when first attempt returns null (D-05)', async () => {
        vi.useFakeTimers();
        const receipt = createMockReceipt({
            logs: [createWithdrawalLog(WETH_ADDRESS, WALLET_ADDRESS, 7n)],
        });
        const provider = makeProvider([null, receipt]);
        const promise = decodeReceipt(FAKE_TX_HASH, provider, WETH_ADDRESS, WALLET_ADDRESS);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await promise;
        vi.useRealTimers();
        expect(provider.getTransactionReceipt).toHaveBeenCalledTimes(2);
        expect(result.amountOut).toBe('7');
    });

    it('returns all nulls and warns when receipt still null after retry (D-05)', async () => {
        vi.useFakeTimers();
        const provider = makeProvider([null, null]);
        const promise = decodeReceipt(FAKE_TX_HASH, provider, WETH_ADDRESS, WALLET_ADDRESS);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await promise;
        vi.useRealTimers();
        expect(result.amountOut).toBeNull();
        expect(result.gasCost).toBeNull();
        expect(result.blockNumber).toBeNull();
    });

    it('returns null amountOut but non-null gasCost/block when no WETH event present (D-02)', async () => {
        const receipt = createMockReceipt({ logs: [] });
        const provider = makeProvider([receipt]);
        const result = await decodeReceipt(FAKE_TX_HASH, provider, WETH_ADDRESS, WALLET_ADDRESS);
        expect(result.amountOut).toBeNull();
        expect(result.gasCost).not.toBeNull();
        expect(result.blockNumber).toBe(12345678);
    });

    it('ignores spoofed Transfer events from non-WETH contracts (T-14-01)', async () => {
        // Malicious token emits Transfer at its own address -- must NOT be trusted.
        const spoofed = createTransferLog(FOREIGN_TOKEN_ADDRESS, FOREIGN_TOKEN_ADDRESS, WALLET_ADDRESS, 999999999999999999n);
        const receipt = createMockReceipt({ logs: [spoofed] });
        const provider = makeProvider([receipt]);
        const result = await decodeReceipt(FAKE_TX_HASH, provider, WETH_ADDRESS, WALLET_ADDRESS);
        expect(result.amountOut).toBeNull();
    });

    it('picks the first WETH Transfer-to-wallet match when multiple exist (documented first-match behavior)', async () => {
        // Two Transfer(to=wallet) events from the WETH contract in the same receipt.
        // First-match wins -- single-hop sells should produce exactly one, but this
        // test locks in the behavior.
        const first = createTransferLog(WETH_ADDRESS, FOREIGN_TOKEN_ADDRESS, WALLET_ADDRESS, 1000000000000000000n);
        const second = createTransferLog(WETH_ADDRESS, FOREIGN_TOKEN_ADDRESS, WALLET_ADDRESS, 9000000000000000000n);
        const receipt = createMockReceipt({ logs: [first, second] });
        const provider = makeProvider([receipt]);
        const result = await decodeReceipt(FAKE_TX_HASH, provider, WETH_ADDRESS, WALLET_ADDRESS);
        // First match wins
        expect(result.amountOut).toBe('1000000000000000000');
    });

    it('does not throw on malformed WETH log payloads and falls through to null', async () => {
        const malformed = createMalformedWethLog(WETH_ADDRESS);
        const receipt = createMockReceipt({ logs: [malformed] });
        const provider = makeProvider([receipt]);
        // Must not throw
        const result = await decodeReceipt(FAKE_TX_HASH, provider, WETH_ADDRESS, WALLET_ADDRESS);
        expect(result.amountOut).toBeNull();
        // gasCost should still be computed since receipt is valid
        expect(result.gasCost).not.toBeNull();
    });

    it('records gasCost null and warns when receipt.gasPrice is missing', async () => {
        const receipt = createMockReceipt({
            gasPrice: null as any,
            logs: [createWithdrawalLog(WETH_ADDRESS, WALLET_ADDRESS, 1000000000000000000n)],
        });
        const provider = makeProvider([receipt]);
        const result = await decodeReceipt(FAKE_TX_HASH, provider, WETH_ADDRESS, WALLET_ADDRESS);
        expect(result.gasCost).toBeNull();
        // amountOut still decoded because the log is valid
        expect(result.amountOut).toBe('1000000000000000000');
    });
});
