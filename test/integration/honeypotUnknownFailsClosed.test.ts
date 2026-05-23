// test/integration/honeypotUnknownFailsClosed.test.ts
// Phase 18 plan 18-09 Task 1 — Edge-case fail-closed verification.
//
// Per PITFALLS #1 + D-UNKNOWN-POLICY: every RPC-level edge case (timeout, no
// revert, malformed revert) MUST produce verdict !== 'safe'. A vacuous-pass
// regression in this layer would defeat the entire phase.
//
// Tests:
//   4. V2 provider.call throws { message: 'network timeout' } with no data    → 'unsafe'.
//   5. V2 provider.call resolves (contract bug — no revert)                   → 'unknown' with reason 'no-terminal-revert'.
//   6. V2 provider.call rejects with malformed revert data '0x1234'           → 'unsafe'.
//   7. V3 path with QuoteFailed revert (iter-2 Blocker #1)                    → 'unsafe' with reason starting 'quote-failed'.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Interface } from 'ethers';
import { HONEYPOT_CHECKER_ABI } from '../../src/utils/honeypot/abi';

const iface = new Interface(HONEYPOT_CHECKER_ABI);

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

describe('Phase 18 plan 18-09 Task 1 — unknown semantics fail closed (V2 + V3)', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('Test 4: V2 provider.call throws message-only network error with no revert data → unsafe', async () => {
        const { simulateViaContractV2 } = await import('../../src/utils/honeypot/checkerContract');
        const provider = { call: vi.fn().mockRejectedValue({ message: 'network timeout' }) };
        const ctx = makeCtx(provider) as unknown;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await simulateViaContractV2(ctx as any, v2Dex, '0xtoken', '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD');

        // NEVER 'safe' on RPC noise — fail-closed.
        expect(result.verdict).not.toBe('safe');
    });

    it('Test 5: V2 provider.call RESOLVES (no revert — contract bug) → unknown with reason no-terminal-revert', async () => {
        const { simulateViaContractV2 } = await import('../../src/utils/honeypot/checkerContract');
        const provider = { call: vi.fn().mockResolvedValue('0x') };
        const ctx = makeCtx(provider) as unknown;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await simulateViaContractV2(ctx as any, v2Dex, '0xtoken', '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD');

        // When the contract DOESN'T revert (which violates its design invariant),
        // the wrapper treats that probe as ok:false reason:'no-terminal-revert'.
        // For all gating probes returning no-terminal-revert, overall is unsafe;
        // but the per-probe reason MUST surface so we can diagnose.
        expect(result.verdict).not.toBe('safe');
        const haystack = JSON.stringify(result);
        expect(haystack).toContain('no-terminal-revert');
    });

    it('Test 6: V2 provider.call rejects with malformed revert data 0x1234 → unsafe', async () => {
        const { simulateViaContractV2 } = await import('../../src/utils/honeypot/checkerContract');
        const provider = { call: vi.fn().mockRejectedValue({ data: '0x1234', message: 'malformed' }) };
        const ctx = makeCtx(provider) as unknown;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await simulateViaContractV2(ctx as any, v2Dex, '0xtoken', '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD');

        expect(result.verdict).not.toBe('safe');
    });

    it('Test 7: V3 path QuoteFailed revert → unsafe with reason starting quote-failed (iter-2 Blocker #1)', async () => {
        const { simulateViaContractV3 } = await import('../../src/utils/honeypot/checkerContract');
        const data = iface.encodeErrorResult('QuoteFailed', ['buy-quote-failed']);
        const provider = { call: vi.fn().mockRejectedValue({ data, message: 'QuoteFailed' }) };
        const ctx = makeCtx(provider) as unknown;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await simulateViaContractV3(ctx as any, v3Dex, '0xtoken', '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD', 3000);

        expect(result.verdict).toBe('unsafe');
        if (result.verdict === 'unsafe') {
            expect(result.reason.startsWith('quote-failed')).toBe(true);
        }
    });
});
