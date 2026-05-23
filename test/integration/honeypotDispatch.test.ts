// test/integration/honeypotDispatch.test.ts
// Phase 18 plan 18-09 Task 1 — Multi-amount probe aggregation tests (D-AGGREGATION).
//
// Tests:
//   11. V2 probe1 (1%) safe + probe2 (50%) revert + probe3 (100%) revert →
//       overall unsafe with evidence.probeResults.length === 3.
//   12. V2 probe1 (1%) revert + probe2 (50%) safe + probe3 (100%) safe →
//       overall safe with evidence.probeResults[0].ok === false (advisory recorded).
//
// D-AGGREGATION rule:
//   - Any gating probe (50% or 100%) unsafe → overall unsafe.
//   - 1% probe revert → evidence-only (advisory), does NOT block.
//   - All gating probes safe AND tax thresholds NOT exceeded → overall safe.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers, Interface } from 'ethers';
import { HONEYPOT_CHECKER_ABI } from '../../src/utils/honeypot/abi';

const iface = new Interface(HONEYPOT_CHECKER_ABI);

function makeRoundtripRevert(buyTaxBps: number, sellTaxBps: number, status: number = 0x07): string {
    return iface.encodeErrorResult('RoundtripResult', [buyTaxBps, sellTaxBps, status]);
}

function makeBuyFailedRevert(reason: string): string {
    return iface.encodeErrorResult('BuyFailed', [reason]);
}

function makeCtx(provider: { call: ReturnType<typeof vi.fn> }) {
    return {
        chain: {
            snipeAmount: '0.003',
            honeypotChecker: {
                method: 'on-chain-contract',
                deployedAddress: '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD',
                maxBuyTaxBps: 1000,
                maxSellTaxBps: 1000,
            },
        },
        httpProvider: provider,
        wallet: { address: '0x000000000000000000000000000000000000beef' },
        log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    };
}

const v2Dex = {
    dexType: 'v2' as const,
    name: 'uniswap-v2',
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
};

const TOKEN_ADDR = '0x000000000000000000000000000000000000abcd';

const snipeWei = ethers.parseEther('0.003');
const oneCent = snipeWei / 100n;
const fifty = snipeWei / 2n;
const hundred = snipeWei;

describe('Phase 18 plan 18-09 Task 1 — multi-amount aggregation (D-AGGREGATION)', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('Test 11: 1% safe + 50% revert + 100% revert → overall unsafe with probeResults.length === 3', async () => {
        const { simulateViaContractV2 } = await import('../../src/utils/honeypot/checkerContract');

        const provider = {
            call: vi.fn().mockImplementation((tx: { value?: bigint }) => {
                if (tx.value === oneCent) {
                    return Promise.reject({ data: makeRoundtripRevert(100, 100), message: 'safe' });
                }
                if (tx.value === fifty) {
                    return Promise.reject({ data: makeBuyFailedRevert('BUY_BAL_ZERO'), message: 'BuyFailed' });
                }
                if (tx.value === hundred) {
                    return Promise.reject({ data: makeBuyFailedRevert('BUY_BAL_ZERO'), message: 'BuyFailed' });
                }
                return Promise.reject({ message: 'unexpected probe size' });
            }),
        };
        const ctx = makeCtx(provider) as unknown;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await simulateViaContractV2(ctx as any, v2Dex, TOKEN_ADDR, '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD');

        expect(result.verdict).toBe('unsafe');
        expect(result.evidence.probeResults).toBeDefined();
        expect(result.evidence.probeResults).toHaveLength(3);
    });

    it('Test 12: 1% revert (advisory) + 50% safe + 100% safe → overall safe with probeResults[0].ok === false', async () => {
        const { simulateViaContractV2 } = await import('../../src/utils/honeypot/checkerContract');

        const provider = {
            call: vi.fn().mockImplementation((tx: { value?: bigint }) => {
                if (tx.value === oneCent) {
                    return Promise.reject({ data: makeBuyFailedRevert('DUST_REVERT'), message: 'BuyFailed' });
                }
                if (tx.value === fifty) {
                    return Promise.reject({ data: makeRoundtripRevert(100, 100), message: 'safe' });
                }
                if (tx.value === hundred) {
                    return Promise.reject({ data: makeRoundtripRevert(100, 100), message: 'safe' });
                }
                return Promise.reject({ message: 'unexpected probe size' });
            }),
        };
        const ctx = makeCtx(provider) as unknown;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await simulateViaContractV2(ctx as any, v2Dex, TOKEN_ADDR, '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD');

        expect(result.verdict).toBe('safe');
        expect(result.evidence.probeResults).toBeDefined();
        expect(result.evidence.probeResults).toHaveLength(3);
        const probes = result.evidence.probeResults!;

        // Per D-AGGREGATION, probeResults are listed in probe-size order:
        // [0]=1%, [1]=50%, [2]=100%. The 1% probe MUST be ok:false (advisory).
        expect(probes[0].ok).toBe(false);
        expect(probes[1].ok).toBe(true);
        expect(probes[2].ok).toBe(true);
    });
});
