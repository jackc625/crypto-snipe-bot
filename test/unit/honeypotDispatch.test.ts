// test/unit/honeypotDispatch.test.ts
// Phase 18 plan 18-09 Task 1 — Dispatch routing unit tests.
//
// Tests:
//   1. V2 dispatch with on-chain-contract method + valid deployedAddress → simulateViaContractV2 called.
//   2. V3 dispatch with on-chain-contract method + valid deployedAddress → simulateViaContractV3 called (iter-2 Blocker #1).
//   3. On-chain-contract method with deployedAddress === null → verdict 'unknown' (no underlying call).
//
// vi.doMock pattern (matches test/integration/v3LiquidityWait.test.ts:27-47) so the
// checkerContract module is replaced with vi.fn() spies before the dispatch is imported.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const v2Spy = vi.fn();
const v3Spy = vi.fn();
const simulatorSpy = vi.fn();

vi.doMock('../../src/utils/honeypot/checkerContract', () => ({
    simulateViaContractV2: v2Spy,
    simulateViaContractV3: v3Spy,
}));

vi.doMock('../../src/utils/honeypot/simulator', () => ({
    simulateViaSimulator: simulatorSpy,
}));

describe('Phase 18 plan 18-09 Task 1 — honeypot dispatch routing', () => {
    beforeEach(() => {
        v2Spy.mockReset();
        v3Spy.mockReset();
        simulatorSpy.mockReset();
    });

    it('Test 1: V2 dex routes to simulateViaContractV2 when method=on-chain-contract and deployedAddress set', async () => {
        const mod = await import('../../src/utils/honeypot/index');

        const expectedResult = {
            verdict: 'safe' as const,
            evidence: { buyTaxBps: 100, sellTaxBps: 100, method: 'on-chain-contract' as const, dexType: 'v2' as const },
        };
        v2Spy.mockResolvedValueOnce(expectedResult);

        const ctx = {
            chain: {
                honeypotChecker: {
                    method: 'on-chain-contract',
                    deployedAddress: '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD',
                    maxBuyTaxBps: 1000,
                    maxSellTaxBps: 1000,
                },
            },
        };
        const dex = { dexType: 'v2', name: 'uniswap-v2', factoryAddress: '0xfac', routerAddress: '0xrouter' };
        const token = '0xtokenaddress';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await mod.simulateHoneypotRoundtrip(ctx as any, dex as any, token);

        expect(v2Spy).toHaveBeenCalledOnce();
        expect(v2Spy).toHaveBeenCalledWith(ctx, dex, token, '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD');
        expect(v3Spy).not.toHaveBeenCalled();
        expect(result).toEqual(expectedResult);
    });

    it('Test 2: V3 dex routes to simulateViaContractV3 when method=on-chain-contract (iter-2 Blocker #1)', async () => {
        const mod = await import('../../src/utils/honeypot/index');

        const expectedResult = {
            verdict: 'safe' as const,
            evidence: { buyTaxBps: 50, sellTaxBps: 50, method: 'on-chain-contract' as const, dexType: 'v3' as const },
        };
        v3Spy.mockResolvedValueOnce(expectedResult);

        const ctx = {
            chain: {
                honeypotChecker: {
                    method: 'on-chain-contract',
                    deployedAddress: '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD',
                    maxBuyTaxBps: 1000,
                    maxSellTaxBps: 1000,
                },
            },
        };
        const dex = {
            dexType: 'v3',
            name: 'uniswap-v3',
            factoryAddress: '0xfac',
            swapRouterAddress: '0xswap',
            quoterAddress: '0xquoter',
        };
        const token = '0xtokenaddress';
        const feeTier = 3000;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await mod.simulateHoneypotRoundtrip(ctx as any, dex as any, token, feeTier);

        expect(v3Spy).toHaveBeenCalledOnce();
        // The V3 wrapper accepts an optional feeTier arg as a 5th parameter per iter-2 Blocker #1.
        expect(v3Spy).toHaveBeenCalledWith(
            ctx,
            dex,
            token,
            '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD',
            feeTier,
        );
        expect(v2Spy).not.toHaveBeenCalled();
        expect(result).toEqual(expectedResult);
    });

    it('Test 3: on-chain-contract method with deployedAddress=null returns no-deployed-address WITHOUT calling underlying', async () => {
        const mod = await import('../../src/utils/honeypot/index');

        const ctx = {
            chain: {
                honeypotChecker: {
                    method: 'on-chain-contract',
                    deployedAddress: null,
                    maxBuyTaxBps: 1000,
                    maxSellTaxBps: 1000,
                },
            },
        };
        const dex = { dexType: 'v2', name: 'uniswap-v2', factoryAddress: '0xfac', routerAddress: '0xrouter' };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await mod.simulateHoneypotRoundtrip(ctx as any, dex as any, '0xtoken');

        expect(result.verdict).toBe('unknown');
        if (result.verdict === 'unknown') {
            expect(result.reason).toBe('no-deployed-address');
        }
        expect(v2Spy).not.toHaveBeenCalled();
        expect(v3Spy).not.toHaveBeenCalled();
    });
});
