// test/unit/exitEngine/computePublicMinOut.test.ts
// Phase 21.2 Plan 21.2-13 / Task 5 — IN-03 regression: computePublicMinOut must
// NEVER yield minOut=0 (no slippage protection) on a misconfigured slippage >
// 100%. A negative `100 - slippagePct` clamped keepPct to 0 → minOut=0 → accept
// any output (including a fully-sandwiched near-zero) on a typo. The fix caps
// EFFECTIVE slippage at 99% so minOut keeps at least 1% of the quote.

import { describe, it, expect, vi } from 'vitest';

// Minimal config mock so importing exitEngine doesn't pull a real env (the
// function under test is pure — no env reads).
vi.mock('../../../src/config', () => ({
    CONFIG: {
        trailingStopPct: 15, trailingMinPct: 5, trailingMaxPct: 40, stopLossPercent: 25,
        partialSellTargets: '', exitPollIntervalMs: 5000, urgencyWindowMs: 1_800_000,
        volatilityBaselineCV: 0.03, volatilityMaxSamples: 60, volatilityMinSamples: 12,
        slippagePercent: 5,
    },
}));
vi.mock('../../../src/utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));
vi.mock('../../../src/utils/db', () => ({
    db: {}, insertTrade: { run: vi.fn() }, updateTradeStatus: { run: vi.fn() },
    upsertExitState: { run: vi.fn() }, getExitState: { get: vi.fn() },
    deleteExitState: { run: vi.fn() }, markExitFailedHeld: { run: vi.fn() },
    getTradeIdForPendingToken: { get: vi.fn() },
}));
vi.mock('../../../src/utils/notifier', () => ({ sendCtxAlert: vi.fn() }));
vi.mock('../../../src/utils/txManager', () => ({ sendTxWithRetry: vi.fn(), escalatePrivateSell: vi.fn() }));
vi.mock('../../../src/anti-rug/detector', () => ({ unregisterAntiRugPosition: vi.fn() }));

const EXPECTED = 1_000_000_000_000_000_000n; // 1e18 quote

describe('IN-03 — computePublicMinOut never yields minOut=0 on slippage > 100%', () => {
    it('5% slippage keeps 95%', async () => {
        const { computePublicMinOut } = await import('../../../src/exitEngine');
        expect(computePublicMinOut(EXPECTED, 5)).toBe((EXPECTED * 95n) / 100n);
    });

    it('15% slippage keeps 85%', async () => {
        const { computePublicMinOut } = await import('../../../src/exitEngine');
        expect(computePublicMinOut(EXPECTED, 15)).toBe((EXPECTED * 85n) / 100n);
    });

    it('slippage 150% (misconfig) is CLAMPED — minOut keeps >= 1% (NOT 0)', async () => {
        const { computePublicMinOut } = await import('../../../src/exitEngine');
        const minOut = computePublicMinOut(EXPECTED, 150);
        expect(minOut).toBeGreaterThan(0n);
        // Effective slippage capped at 99% → keep 1%.
        expect(minOut).toBe((EXPECTED * 1n) / 100n);
    });

    it('slippage exactly 100% is CLAMPED to keep >= 1% (NOT 0)', async () => {
        const { computePublicMinOut } = await import('../../../src/exitEngine');
        const minOut = computePublicMinOut(EXPECTED, 100);
        expect(minOut).toBeGreaterThan(0n);
        expect(minOut).toBe((EXPECTED * 1n) / 100n);
    });

    it('negative slippage (misconfig) keeps the full quote (clamped to 0%)', async () => {
        const { computePublicMinOut } = await import('../../../src/exitEngine');
        expect(computePublicMinOut(EXPECTED, -10)).toBe(EXPECTED);
    });
});
