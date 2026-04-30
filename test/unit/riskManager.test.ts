// test/unit/riskManager.test.ts
// Unit tests for risk manager gate checks.
// Mocks DB and config to test each risk rule independently.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/testDb';
import type Database from 'better-sqlite3';

// ---- Mock dependencies ----

let testDb: Database.Database;

// Prepared statement mocks that canSnipe calls
const mockGetOpenPositionCount = { get: vi.fn() };
const mockGetTotalExposure = { get: vi.fn() };
const mockGetDailyRealizedLoss = { get: vi.fn() };
const mockExposureByChain = { all: vi.fn() };

vi.mock('../../src/utils/db', () => ({
    db: {
        prepare: vi.fn().mockReturnValue(mockExposureByChain),
    },
    getOpenPositionCount: mockGetOpenPositionCount,
    getTotalExposure: mockGetTotalExposure,
    getDailyRealizedLoss: mockGetDailyRealizedLoss,
}));

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

let canSnipe: typeof import('../../src/riskManager')['canSnipe'];
let recordSnipe: typeof import('../../src/riskManager')['recordSnipe'];

beforeEach(async () => {
    // Reset mocks
    mockGetOpenPositionCount.get.mockReset();
    mockGetTotalExposure.get.mockReset();
    mockGetDailyRealizedLoss.get.mockReset();

    // Default: all checks pass
    mockGetOpenPositionCount.get.mockReturnValue({ count: 0 });
    mockGetTotalExposure.get.mockReturnValue({ total: 0 });
    mockGetDailyRealizedLoss.get.mockReturnValue({ total_loss: 0 });

    // Set env vars for risk config
    process.env.MAX_OPEN_POSITIONS = '5';
    process.env.MAX_TOTAL_EXPOSURE = '10.0';
    process.env.DAILY_LOSS_PCT = '10';
    process.env.SNIPE_COOLDOWN_MS = '60000';
    process.env.MAX_POSITION_SIZE = '0.1';

    const mod = await import('../../src/riskManager');
    canSnipe = mod.canSnipe;
    recordSnipe = mod.recordSnipe;
});

describe('canSnipe risk gate', () => {
    it('returns {allowed:true} when all limits OK', () => {
        const result = canSnipe('eth', '0.05', '1.0');
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
    });

    it('returns {allowed:false, reason:"position_size"} when amount exceeds max', () => {
        const result = canSnipe('eth', '0.5', '1.0');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('position_size');
    });

    it('returns {allowed:false, reason:"daily_loss_limit"} when daily loss exceeded', () => {
        // maxCapital = 1.0, dailyLossPct = 10%, so threshold = -0.1
        // total_loss of -0.15 exceeds threshold
        mockGetDailyRealizedLoss.get.mockReturnValue({ total_loss: -0.15 });
        const result = canSnipe('eth', '0.05', '1.0');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('daily_loss_limit');
    });

    it('returns {allowed:false, reason:"max_positions"} when max positions reached', () => {
        mockGetOpenPositionCount.get.mockReturnValue({ count: 5 });
        const result = canSnipe('eth', '0.05', '1.0');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('max_positions');
    });

    it('returns {allowed:false, reason:"cooldown"} when cooldown active', () => {
        // Record a snipe to activate cooldown
        recordSnipe('eth');
        const result = canSnipe('eth', '0.05', '1.0');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('cooldown');
    });

    it('returns {allowed:false, reason:"exposure_cap"} when total exposure exceeded', () => {
        // Use a chain not affected by previous cooldown test
        mockGetTotalExposure.get.mockReturnValue({ total: 9.96 });
        const result = canSnipe('bsc', '0.05', '1.0');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('exposure_cap');
    });
});

describe('getPortfolioExposure with partial sells (Phase 10)', () => {
    it('returns exposure reduced by partial sell proceeds', async () => {
        // Mock exposureByChain to return already-reduced values
        // (the SQL does the subtraction, mock returns the result)
        mockExposureByChain.all.mockReturnValue([
            { chain: 'eth', deployed: 0.07 },
            { chain: 'bsc', deployed: 0.15 },
        ]);
        mockGetTotalExposure.get.mockReturnValue({ total: 0.22 });

        const { getPortfolioExposure } = await import('../../src/riskManager');
        const result = getPortfolioExposure();

        expect(result.total).toBe(0.22);
        expect(result.byChain.eth).toBe(0.07);
        expect(result.byChain.bsc).toBe(0.15);
    });
});

// ---------------------------------------------------------------------------
// Phase 17 / DEBT-05 retroactive harm-prevention block.
// Phase 6 RISK: daily-loss gate must (a) block the snipe AND (b) emit a structured
// pino warn line so operator-side observability is preserved.
// ---------------------------------------------------------------------------

describe('Phase 6 harm-prevention: RISK daily-loss gate blocks the snipe with structured pino warn', () => {
    let warnMock: ReturnType<typeof vi.fn>;
    let canSnipeLocal: typeof import('../../src/riskManager').canSnipe;

    beforeEach(async () => {
        // The canonical logger mock at the top of this file creates a fresh `child()` per call
        // returning fresh `vi.fn()`s — meaning we cannot capture warn calls from the outside.
        // Override the mock for THIS describe block via vi.doMock + vi.resetModules + dynamic re-import.
        // (See test/unit/configEnvVar.test.ts:170-176 for the canonical `expect.objectContaining` +
        // `expect.any(String)` shape; mirrors test/integration/exitMonitor.test.ts:12-29 pattern.)

        warnMock = vi.fn();
        vi.doMock('../../src/utils/logger', () => ({
            logger: {
                child: () => ({
                    info: vi.fn(),
                    warn: warnMock,
                    debug: vi.fn(),
                    error: vi.fn(),
                }),
            },
        }));
        vi.resetModules();

        // Re-establish DB mock implementations (mockReset: true wipes them between tests).
        mockGetOpenPositionCount.get.mockReturnValue({ count: 0 });
        mockGetTotalExposure.get.mockReturnValue({ total: 0 });
        mockGetDailyRealizedLoss.get.mockReturnValue({ total_loss: 0 });

        // Re-set env vars for risk config (Map of imported module needs fresh canSnipe binding).
        process.env.MAX_OPEN_POSITIONS = '5';
        process.env.MAX_TOTAL_EXPOSURE = '10.0';
        process.env.DAILY_LOSS_PCT = '10';
        process.env.SNIPE_COOLDOWN_MS = '60000';
        process.env.MAX_POSITION_SIZE = '0.1';

        // Re-import canSnipe so the new logger mock takes effect.
        const mod = await import('../../src/riskManager');
        canSnipeLocal = mod.canSnipe;
    });

    it('returns {allowed: false, reason: "daily_loss_limit"} AND emits log.warn with structured payload when daily loss exceeded', () => {
        // Setup: daily realized loss exceeds 10% of maxCapital (threshold = -0.1)
        mockGetDailyRealizedLoss.get.mockReturnValue({ total_loss: -0.15 });

        const result = canSnipeLocal('eth', '0.05', '1.0');

        // D-04 observable effect 1: function-return state
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('daily_loss_limit');

        // D-04 observable effect 2: structured pino warn emission (per src/riskManager.ts log.warn shape)
        expect(warnMock).toHaveBeenCalledWith(
            expect.objectContaining({
                chain: 'eth',
                reason: 'daily_loss_limit',
            }),
            expect.any(String),
        );
    });
});
