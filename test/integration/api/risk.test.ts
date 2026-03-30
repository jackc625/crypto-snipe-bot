// test/integration/api/risk.test.ts
// Tests for GET /api/risk/exposure, /pnl, /limits endpoints.
// Verifies portfolio exposure, cumulative P&L, and risk limit utilization.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { riskRoutes } from '../../../src/api/routes/risk';

// Mock riskManager
vi.mock('../../../src/riskManager', () => ({
    getPortfolioExposure: vi.fn(),
}));

// Mock db module
vi.mock('../../../src/utils/db', () => ({
    getPnL: vi.fn(),
    getPnLChartData: vi.fn(),
    getOpenPositionCount: { get: vi.fn() },
    getTotalExposure: { get: vi.fn() },
    getDailyRealizedLoss: { get: vi.fn() },
}));

import { getPortfolioExposure } from '../../../src/riskManager';
import { getPnL, getPnLChartData, getOpenPositionCount, getTotalExposure, getDailyRealizedLoss } from '../../../src/utils/db';

// Helper to create test app with risk routes
function createTestApp() {
    const app = express();
    const mockContexts = [
        {
            chain: { name: 'eth', displayName: '[ETH]', chainId: 1, enabled: true, maxCapital: '5.0' },
            httpProvider: {},
            wsProvider: null,
            wallet: {},
            log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
        },
        {
            chain: { name: 'bsc', displayName: '[BSC]', chainId: 56, enabled: true, maxCapital: '5.0' },
            httpProvider: {},
            wsProvider: null,
            wallet: {},
            log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
        },
    ] as any[];
    app.use('/', riskRoutes(mockContexts));
    return app;
}

// Simple HTTP request helper
async function request(app: express.Express, path: string) {
    return new Promise<{ status: number; body: any; headers: Record<string, string> }>((resolve) => {
        const http = require('http');
        const server = app.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            http.get(`http://127.0.0.1:${addr.port}${path}`, (res: any) => {
                let data = '';
                res.on('data', (chunk: string) => data += chunk);
                res.on('end', () => {
                    server.close();
                    resolve({
                        status: res.statusCode,
                        body: JSON.parse(data),
                        headers: res.headers,
                    });
                });
            });
        });
    });
}

describe('GET /api/risk/exposure', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns total and byChain exposure', async () => {
        (getPortfolioExposure as ReturnType<typeof vi.fn>).mockReturnValue({
            total: 2.5,
            byChain: { eth: 1.5, bsc: 1.0 },
        });

        const app = createTestApp();
        const res = await request(app, '/exposure');

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(2.5);
        expect(res.body.byChain).toEqual({ eth: 1.5, bsc: 1.0 });
    });

    it('returns zero exposure when no positions', async () => {
        (getPortfolioExposure as ReturnType<typeof vi.fn>).mockReturnValue({
            total: 0,
            byChain: {},
        });

        const app = createTestApp();
        const res = await request(app, '/exposure');

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(0);
        expect(res.body.byChain).toEqual({});
    });
});

describe('GET /api/risk/pnl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns cumulative data points from per-event sell data (D-07)', async () => {
        (getPnLChartData as ReturnType<typeof vi.fn>).mockReturnValue([
            { sell_time: 1700002000, token: '0xa', chain: 'eth', sell_action: 'partial_sell', sell_revenue: 0.03, sell_gas: 0.001, buy_cost: 0.05, buy_gas: 0.001, total_sells: 2 },
            { sell_time: 1700003000, token: '0xa', chain: 'eth', sell_action: 'sell', sell_revenue: 0.04, sell_gas: 0.001, buy_cost: 0.05, buy_gas: 0.001, total_sells: 2 },
            { sell_time: 1700005000, token: '0xb', chain: 'bsc', sell_action: 'sell', sell_revenue: 0.15, sell_gas: 0.001, buy_cost: 0.05, buy_gas: 0.001, total_sells: 1 },
        ]);

        const app = createTestApp();
        const res = await request(app, '/pnl?range=7d');

        expect(res.status).toBe(200);
        expect(res.body.dataPoints).toHaveLength(3);
        // First event: partial_sell of 0xa
        // P&L = 0.03 - (0.05/2) - (0.001/2) - 0.001 = 0.03 - 0.025 - 0.0005 - 0.001 = 0.0035
        expect(res.body.dataPoints[0].time).toBe(1700002000);
        // Second event: sell of 0xa
        // P&L = 0.04 - 0.025 - 0.0005 - 0.001 = 0.013
        expect(res.body.dataPoints[1].time).toBe(1700003000);
        // Third event: sell of 0xb (single sell, no proration)
        // P&L = 0.15 - 0.05 - 0.001 - 0.001 = 0.098
        expect(res.body.dataPoints[2].time).toBe(1700005000);
        // Verify cumulative sum is calculated
        expect(res.body.dataPoints[2].value).toBeGreaterThan(res.body.dataPoints[1].value);
    });

    it('defaults to 7d range', async () => {
        (getPnLChartData as ReturnType<typeof vi.fn>).mockReturnValue([]);

        const app = createTestApp();
        const res = await request(app, '/pnl');

        expect(res.status).toBe(200);
        expect(res.body.range).toBe('7d');
        // Check that getPnLChartData was called with fromTimestamp approximately 7 days ago
        expect(getPnLChartData).toHaveBeenCalledTimes(1);
        const callArg = (getPnLChartData as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const now = Math.floor(Date.now() / 1000);
        const sevenDaysAgo = now - 604800;
        expect(callArg).toBeGreaterThan(sevenDaysAgo - 10);
        expect(callArg).toBeLessThan(sevenDaysAgo + 10);
    });

    it('returns empty data points when no sell events exist', async () => {
        (getPnLChartData as ReturnType<typeof vi.fn>).mockReturnValue([]);

        const app = createTestApp();
        const res = await request(app, '/pnl?range=all');

        expect(res.status).toBe(200);
        expect(res.body.dataPoints).toHaveLength(0);
    });

    it('handles all range values', async () => {
        (getPnLChartData as ReturnType<typeof vi.fn>).mockReturnValue([]);

        const app = createTestApp();

        const res24h = await request(app, '/pnl?range=24h');
        expect(res24h.body.range).toBe('24h');

        const res30d = await request(app, '/pnl?range=30d');
        expect(res30d.body.range).toBe('30d');

        const resAll = await request(app, '/pnl?range=all');
        expect(resAll.body.range).toBe('all');
    });
});

describe('GET /api/risk/limits', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
        process.env.MAX_OPEN_POSITIONS = '10';
        process.env.MAX_TOTAL_EXPOSURE = '10.0';
        process.env.DAILY_LOSS_PCT = '10';
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('returns position limit, exposure limit, and daily loss utilization', async () => {
        (getOpenPositionCount.get as ReturnType<typeof vi.fn>).mockReturnValue({ count: 3 });
        (getTotalExposure.get as ReturnType<typeof vi.fn>).mockReturnValue({ total: 1.5 });
        (getDailyRealizedLoss.get as ReturnType<typeof vi.fn>).mockReturnValue({ total_loss: -0.25 });

        const app = createTestApp();
        const res = await request(app, '/limits');

        expect(res.status).toBe(200);
        expect(res.body.positionLimit).toEqual({ used: 3, max: 10 });
        expect(res.body.exposureLimit).toEqual({ used: 1.5, max: 10.0 });
        expect(res.body.dailyLoss).toBeDefined();
        expect(res.body.dailyLoss.limitPct).toBe(10);
        // Daily loss is sum across chains: -0.25 * 2 chains = -0.5
        expect(res.body.dailyLoss.used).toBe(-0.5);
    });

    it('reads risk config from environment variables', async () => {
        process.env.MAX_OPEN_POSITIONS = '20';
        process.env.MAX_TOTAL_EXPOSURE = '50.0';
        process.env.DAILY_LOSS_PCT = '5';

        (getOpenPositionCount.get as ReturnType<typeof vi.fn>).mockReturnValue({ count: 0 });
        (getTotalExposure.get as ReturnType<typeof vi.fn>).mockReturnValue({ total: 0 });
        (getDailyRealizedLoss.get as ReturnType<typeof vi.fn>).mockReturnValue({ total_loss: 0 });

        const app = createTestApp();
        const res = await request(app, '/limits');

        expect(res.body.positionLimit.max).toBe(20);
        expect(res.body.exposureLimit.max).toBe(50.0);
        expect(res.body.dailyLoss.limitPct).toBe(5);
    });
});
