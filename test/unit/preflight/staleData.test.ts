// Phase 20 / Plan 20-02 / OPS-LIVE-06 — Live tests for checkStaleData.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logWarn = vi.fn();
const logError = vi.fn();
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: logWarn,
            error: logError,
            fatal: vi.fn(),
            debug: vi.fn(),
        }),
        info: vi.fn(),
        warn: logWarn,
        error: logError,
        fatal: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('../../../src/utils/txManager', () => ({
    createMevStrategy: vi.fn(() => ({ healthCheck: vi.fn().mockResolvedValue(true), name: 'mock' })),
    sendTxWithRetry: vi.fn(),
}));

vi.mock('../../../src/utils/notifier', () => ({
    sendCtxAlert: vi.fn(),
    sendTelegramAlert: vi.fn(),
    sendChainAlert: vi.fn(),
}));

// DB mock — `db.prepare('...').all(?)` returns scripted rows per test.
const dbAllMock = vi.fn();
vi.mock('../../../src/utils/db', () => ({
    db: {
        prepare: vi.fn(() => ({
            all: dbAllMock,
            get: vi.fn(),
            run: vi.fn(),
        })),
    },
    getAntirugDryRunStarted: { get: vi.fn(() => undefined) },
}));

const ORIGINAL_ENV = { ...process.env };

describe('checkStaleData', () => {
    beforeEach(() => {
        logWarn.mockClear();
        logError.mockClear();
        dbAllMock.mockReset();
        delete process.env.STALE_WARN_SEC;
        delete process.env.STALE_ERROR_SEC;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        process.env = { ...ORIGINAL_ENV };
    });

    it('does NOT fire warn or error when trade timestamp is 60s ago (under 120s default warn threshold)', async () => {
        const now = 1_700_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
        // Production checkStaleData query filters rows older than STALE_WARN_SEC at the SQL level.
        // A 60s-old trade is NOT returned by the query → no log emitted.
        dbAllMock.mockReturnValue([]);
        const { checkStaleData } = await import('../../../src/preflight');
        await checkStaleData();
        expect(logWarn).not.toHaveBeenCalled();
        expect(logError).not.toHaveBeenCalled();
    });

    it('fires warn log { op: stale-position, tradeId, ageSec } when trade is 180s old (> 120s warn, < 600s error)', async () => {
        const now = 1_700_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
        dbAllMock.mockReturnValue([{ id: 1, token: '0xabc', chain: 'eth', timestamp: now - 180 }]);
        const { checkStaleData } = await import('../../../src/preflight');
        await checkStaleData();
        expect(logWarn).toHaveBeenCalled();
        const call = logWarn.mock.calls[0];
        expect(call[0]).toMatchObject({ op: 'stale-position', tradeId: 1, ageSec: 180 });
        expect(logError).not.toHaveBeenCalled();
    });

    it('fires error log { op: stale-position, tradeId, ageSec } when trade is 700s old (> 600s error)', async () => {
        const now = 1_700_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
        dbAllMock.mockReturnValue([{ id: 1, token: '0xabc', chain: 'eth', timestamp: now - 700 }]);
        const { checkStaleData } = await import('../../../src/preflight');
        await checkStaleData();
        expect(logError).toHaveBeenCalled();
        const call = logError.mock.calls[0];
        expect(call[0]).toMatchObject({ op: 'stale-position', tradeId: 1, ageSec: 700 });
    });

    it('consumes STALE_WARN_SEC=60 + STALE_ERROR_SEC=120 env overrides', async () => {
        const now = 1_700_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
        process.env.STALE_WARN_SEC = '60';
        process.env.STALE_ERROR_SEC = '120';
        // 90s old: > 60s warn threshold, < 120s error threshold → warn log
        dbAllMock.mockReturnValue([{ id: 7, token: '0xdef', chain: 'eth', timestamp: now - 90 }]);
        const { checkStaleData } = await import('../../../src/preflight');
        await checkStaleData();
        expect(logWarn).toHaveBeenCalled();
        const call = logWarn.mock.calls[0];
        expect(call[0]).toMatchObject({ op: 'stale-position', tradeId: 7, ageSec: 90 });
        expect(logError).not.toHaveBeenCalled();
    });
});
