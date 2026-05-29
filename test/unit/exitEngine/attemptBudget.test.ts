// test/unit/exitEngine/attemptBudget.test.ts
// Phase 21.2 Plan 21.2-13 / Task 3 — WR-04 + WR-05 regression.
//
// WR-04: sendTxWithRetry coalesces its retry budget with `|| 3`
//   const retries = (typeof walletOrRetries === 'number' ? walletOrRetries : maxRetries) || 3;
// so an EXPLICIT 0 (an operator's "no quick private attempt", or the anti-rug
// budget once WR-05 maps it through) is silently PROMOTED to 3 → up to 4
// submissions, delaying the guaranteed public exit and burning gas.
//
// WR-05: the reason-aware private-attempt BUDGET is off-by-one. privateAttemptBudget
// returns N (anti-rug → 1, routine → 2), that becomes the strategy's maxRetries,
// and submitWithReconciliation runs `for attempt = 0 .. maxRetries` INCLUSIVE →
// N+1 submissions. So anti-rug made 2 private attempts (doc: ONE) and routine made
// 3 (doc: 2) — one extra each, delaying the anti-rug guaranteed exit while
// liquidity drains.
//
// FIX: escalatePrivateSell maps `budget → maxRetries = budget - 1` (the loop does
// `maxRetries + 1` submissions), and sendTxWithRetry honors an explicit numeric
// retries (incl. 0 / negative) via `?? 3` instead of `|| 3`. Net submission count
// then equals the documented budget: anti-rug 1, routine 2, budget-0 → 0 (straight
// to public). The SHARED loop bound (`attempt <= cfg.maxRetries`) is UNCHANGED, so
// BUY retry behavior (no explicit retries → default 3 → 4 attempts) is preserved.
//
// THE CARDINAL LESSON: these tests drive the REAL submitWithReconciliation loop
// and the REAL passthrough strategy (NOT a mocked loop) and COUNT actual
// submissions (wallet.sendTransaction / the submit closure). They assert the
// observable submission COUNT, which is exactly the bug.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockProvider } from '../../helpers/mockProvider';
import type {
    AttemptContext,
    ReconcileConfig,
    SubmitResult,
} from '../../../src/utils/mevStrategies/reconciliation';

vi.mock('../../../src/utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

const WALLET = '0x1111111111111111111111111111111111111111';

function buildCtx(overrides: Record<string, unknown> = {}) {
    return {
        chain: {
            name: 'base',
            displayName: '[BASE]',
            mevStrategy: 'passthrough',
            gas: { multiplier: 1.0, maxGasLimit: 500_000n },
        },
        wallet: {
            address: WALLET,
            sendTransaction: vi.fn(),
        },
        httpProvider: createMockProvider({
            // Every attempt: receipt is NULL (not landed) and the nonce never
            // advances past what we submitted → the loop escalates to the budget.
            getTransactionReceipt: vi.fn().mockResolvedValue(null),
            getTransactionCount: vi.fn().mockResolvedValue(42),
            // Short confirm-window/poll keep the bounded reconcile fast.
        }),
        log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    // Short windows so the bounded reconcile per attempt is quick.
    process.env.MEV_CONFIRM_WINDOW_MS = '20';
    process.env.MEV_CONFIRM_POLL_MS = '5';
    // High ceiling so `ceilingHit` does NOT short-circuit the loop before the
    // budget is exhausted — we want exactly maxRetries+1 submissions.
    process.env.MEV_SELL_MAX_PRIORITY_FEE_GWEI = '1000';
    process.env.MEV_MAX_PRIORITY_FEE_GWEI = '1000';
    delete process.env.MEV_SELL_FALLBACK_ATTEMPTS;
});

afterEach(() => {
    delete process.env.MEV_CONFIRM_WINDOW_MS;
    delete process.env.MEV_CONFIRM_POLL_MS;
    delete process.env.MEV_SELL_MAX_PRIORITY_FEE_GWEI;
    delete process.env.MEV_MAX_PRIORITY_FEE_GWEI;
    delete process.env.MEV_SELL_FALLBACK_ATTEMPTS;
});

// -----------------------------------------------------------------------------
// Layer 1 — the SHARED loop runs exactly maxRetries+1 submissions (proves the
// off-by-one against the loop directly, with a REAL submit closure counting).
// -----------------------------------------------------------------------------
describe('WR-05 — submitWithReconciliation runs exactly maxRetries+1 submissions', () => {
    async function countSubmissions(maxRetries: number): Promise<number> {
        const { submitWithReconciliation, buildReconcileConfig } = await import(
            '../../../src/utils/mevStrategies/reconciliation'
        );
        const provider = createMockProvider({
            getTransactionReceipt: vi.fn().mockResolvedValue(null), // never landed
            getTransactionCount: vi.fn().mockResolvedValue(42),     // nonce never advances
        });
        const cfg: ReconcileConfig = buildReconcileConfig(process.env, 500_000n, maxRetries, 'sell');
        let calls = 0;
        const submit = async (_a: AttemptContext): Promise<SubmitResult> => {
            calls += 1;
            return { signedTxHash: '0xhash', submittedNonce: 42, nativeConfirmed: false };
        };
        try {
            await submitWithReconciliation(
                submit,
                { address: WALLET } as never,
                provider as never,
                cfg,
                { walletBalanceWei: 10n ** 18n, baseFeeWei: 1n, snipeValueWei: 0n, buyGasLimit: 500_000n, chainPriorityWei: 0n },
            );
        } catch { /* exhausts → throws; we only care about the submission count */ }
        return calls;
    }

    it('maxRetries=0 → exactly 1 submission (anti-rug budget after the budget-1 mapping)', async () => {
        expect(await countSubmissions(0)).toBe(1);
    });
    it('maxRetries=1 → exactly 2 submissions (routine budget after the budget-1 mapping)', async () => {
        expect(await countSubmissions(1)).toBe(2);
    });
});

// -----------------------------------------------------------------------------
// Layer 2 — escalatePrivateSell maps budget → submission count via the REAL
// sendTxWithRetry → passthrough strategy. Counts wallet.sendTransaction calls.
// -----------------------------------------------------------------------------
describe('WR-04 + WR-05 — escalatePrivateSell submission count equals the documented budget', () => {
    async function countPrivateSubmissions(attempts: number): Promise<number> {
        const { escalatePrivateSell } = await import('../../../src/utils/txManager');
        const ctx = buildCtx();
        // Every sent tx "lands not" (wait throws → nativeConfirmed false; receipt
        // null → not-landed) so the ladder escalates to the budget then returns
        // landed:false. Count the REAL signing submissions.
        (ctx.wallet.sendTransaction as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
            hash: '0xsenthash',
            wait: vi.fn().mockRejectedValue(new Error('wait timeout')),
        }));
        const txBuilder = async () => ({ to: '0xrouter', data: '0xdead', value: 0n, gasLimit: 500_000n });
        const res = await escalatePrivateSell(
            txBuilder,
            ctx as unknown as Parameters<typeof escalatePrivateSell>[1],
            attempts,
        );
        // Genuinely not-landed → the ladder falls through to the public fallback.
        expect(res.landed).toBe(false);
        return (ctx.wallet.sendTransaction as ReturnType<typeof vi.fn>).mock.calls.length;
    }

    it('anti-rug budget (1) → exactly 1 private submission (NOT 2 — the WR-05 off-by-one)', async () => {
        expect(await countPrivateSubmissions(1)).toBe(1);
    });

    it('routine budget (2) → exactly 2 private submissions (NOT 3)', async () => {
        expect(await countPrivateSubmissions(2)).toBe(2);
    });

    it('budget 0 → ZERO private submissions (straight to public; NOT promoted to 3+1 via the `|| 3` bug)', async () => {
        expect(await countPrivateSubmissions(0)).toBe(0);
    });
});

// -----------------------------------------------------------------------------
// WR-04 — sendTxWithRetry honors an EXPLICIT numeric retries (incl. 0), and the
// BUY default (no explicit retries → 3 → 4 attempts) is UNCHANGED.
// -----------------------------------------------------------------------------
describe('WR-04 — explicit 0 retries is honored; the buy default is unchanged', () => {
    async function countStrategySubmissions(retriesArg: number | undefined): Promise<number> {
        const { sendTxWithRetry } = await import('../../../src/utils/txManager');
        const ctx = buildCtx();
        (ctx.wallet.sendTransaction as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
            hash: '0xsenthash',
            wait: vi.fn().mockRejectedValue(new Error('wait timeout')),
        }));
        const txBuilder = async () => ({ to: '0xrouter', data: '0xdead', value: 0n, gasLimit: 500_000n });
        try {
            await sendTxWithRetry(
                txBuilder,
                ctx as unknown as Parameters<typeof sendTxWithRetry>[1],
                retriesArg,
            );
        } catch { /* not-landed → throws; count is what matters */ }
        return (ctx.wallet.sendTransaction as ReturnType<typeof vi.fn>).mock.calls.length;
    }

    it('explicit retries=0 → exactly 1 submission (0 retries honored, NOT promoted to 3 → 4)', async () => {
        expect(await countStrategySubmissions(0)).toBe(1);
    });

    it('no explicit retries (buy default) → 4 submissions (default 3 retries → 4 attempts), UNCHANGED', async () => {
        expect(await countStrategySubmissions(undefined)).toBe(4);
    });
});
