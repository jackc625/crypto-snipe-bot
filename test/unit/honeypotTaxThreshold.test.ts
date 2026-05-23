// test/unit/honeypotTaxThreshold.test.ts
// Phase 18 plan 18-09 Task 1 — Tax-threshold enforcement unit tests.
//
// Tests:
//   8.  V2 buyTaxBps=999, maxBuyTaxBps=1000 → safe.
//   8b. V2 buyTaxBps=1001, maxBuyTaxBps=1000 → unsafe with reason 'buy-tax-exceeded'.
//   9.  V2 sellTaxBps=1001 with maxSellTaxBps=1000 → unsafe with reason 'sell-tax-exceeded'.
//   10. V3 sellTaxBps=1500 with maxSellTaxBps=1000 → unsafe (V3 enforces same thresholds).
//
// Strategy: provider.call is mocked to throw with revert-data encoding RoundtripResult /
// RoundtripResultV3 with chosen buy/sell tax bps. Aggregation rule is exercised end-to-end
// (3 probes return identical tax payloads; 50%/100% gating logic determines the verdict).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Interface } from 'ethers';
import { HONEYPOT_CHECKER_ABI } from '../../src/utils/honeypot/abi';

const iface = new Interface(HONEYPOT_CHECKER_ABI);

/**
 * Build a revert-data hex string that ethers `parseError` decodes as
 * RoundtripResult or RoundtripResultV3 (status=0x07 → all asserts passed).
 */
function makeRoundtripRevert(
    errorName: 'RoundtripResult' | 'RoundtripResultV3',
    buyTaxBps: number,
    sellTaxBps: number,
    status: number = 0x07,
): string {
    return iface.encodeErrorResult(errorName, [buyTaxBps, sellTaxBps, status]);
}

function makeMockProvider(revertData: string) {
    return {
        call: vi.fn().mockRejectedValue({ data: revertData, message: 'simulated revert' }),
    };
}

const baseCtx = (overrides?: Partial<{ maxBuyTaxBps: number; maxSellTaxBps: number }>) => ({
    chain: {
        snipeAmount: '0.003',
        honeypotChecker: {
            method: 'on-chain-contract',
            deployedAddress: '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD',
            maxBuyTaxBps: overrides?.maxBuyTaxBps ?? 1000,
            maxSellTaxBps: overrides?.maxSellTaxBps ?? 1000,
        },
    },
    wallet: { address: '0x000000000000000000000000000000000000beef' },
    log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
});

const v2Dex = {
    dexType: 'v2' as const,
    name: 'uniswap-v2',
    factoryAddress: '0xfac',
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
};

const v3Dex = {
    dexType: 'v3' as const,
    name: 'uniswap-v3',
    factoryAddress: '0xfac',
    swapRouterAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
};

describe('Phase 18 plan 18-09 Task 1 — tax-threshold enforcement (V2 + V3)', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('Test 8 (V2): buyTaxBps=999 + maxBuyTaxBps=1000 → safe', async () => {
        const { simulateViaContractV2 } = await import('../../src/utils/honeypot/checkerContract');
        const provider = makeMockProvider(makeRoundtripRevert('RoundtripResult', 999, 100));
        const ctx = { ...baseCtx(), httpProvider: provider } as unknown;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await simulateViaContractV2(ctx as any, v2Dex, '0xtoken', baseCtx().chain.honeypotChecker.deployedAddress!);

        expect(result.verdict).toBe('safe');
        if (result.verdict === 'safe') {
            expect(result.evidence.buyTaxBps).toBe(999);
            expect(result.evidence.sellTaxBps).toBe(100);
        }
    });

    it('Test 8b (V2): buyTaxBps=1001 + maxBuyTaxBps=1000 → unsafe with reason buy-tax-exceeded', async () => {
        const { simulateViaContractV2 } = await import('../../src/utils/honeypot/checkerContract');
        const provider = makeMockProvider(makeRoundtripRevert('RoundtripResult', 1001, 100));
        const ctx = { ...baseCtx(), httpProvider: provider } as unknown;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await simulateViaContractV2(ctx as any, v2Dex, '0xtoken', baseCtx().chain.honeypotChecker.deployedAddress!);

        expect(result.verdict).toBe('unsafe');
        if (result.verdict === 'unsafe') {
            expect(result.reason).toBe('buy-tax-exceeded');
        }
    });

    it('Test 9 (V2): sellTaxBps=1001 + maxSellTaxBps=1000 → unsafe with reason sell-tax-exceeded', async () => {
        const { simulateViaContractV2 } = await import('../../src/utils/honeypot/checkerContract');
        const provider = makeMockProvider(makeRoundtripRevert('RoundtripResult', 50, 1001));
        const ctx = { ...baseCtx(), httpProvider: provider } as unknown;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await simulateViaContractV2(ctx as any, v2Dex, '0xtoken', baseCtx().chain.honeypotChecker.deployedAddress!);

        expect(result.verdict).toBe('unsafe');
        if (result.verdict === 'unsafe') {
            expect(result.reason).toBe('sell-tax-exceeded');
        }
    });

    it('Test 10 (V3): sellTaxBps=1500 with maxSellTaxBps=1000 → unsafe (V3 enforces same thresholds)', async () => {
        const { simulateViaContractV3 } = await import('../../src/utils/honeypot/checkerContract');
        const provider = makeMockProvider(makeRoundtripRevert('RoundtripResultV3', 100, 1500));
        const ctx = { ...baseCtx(), httpProvider: provider } as unknown;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await simulateViaContractV3(ctx as any, v3Dex, '0xtoken', baseCtx().chain.honeypotChecker.deployedAddress!, 3000);

        expect(result.verdict).toBe('unsafe');
        if (result.verdict === 'unsafe') {
            expect(result.reason).toBe('sell-tax-exceeded');
        }
    });
});
