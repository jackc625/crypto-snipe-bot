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
    getDeployedCapitalByChain: { get: vi.fn() },
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
