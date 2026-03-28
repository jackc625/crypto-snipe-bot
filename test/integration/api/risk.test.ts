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
    getOpenPositionCount: { get: vi.fn() },
    getTotalExposure: { get: vi.fn() },
    getDailyRealizedLoss: { get: vi.fn() },
}));

import { getPortfolioExposure } from '../../../src/riskManager';
import { getPnL, getOpenPositionCount, getTotalExposure, getDailyRealizedLoss } from '../../../src/utils/db';

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

    it('returns cumulative data points sorted by sell_time', async () => {
        (getPnL as ReturnType<typeof vi.fn>).mockReturnValue([
            { token: '0xa', chain: 'eth', realized_pnl: 0.05, buy_time: 1700000000, sell_time: 1700002000, pool_type: 'v2', fee_tier: null, buy_cost: '0.05', buy_gas: '0.001', sell_revenue: '0.10', sell_gas: '0.001' },
            { token: '0xb', chain: 'eth', realized_pnl: -0.02, buy_time: 1700001000, sell_time: 1700003000, pool_type: 'v2', fee_tier: null, buy_cost: '0.05', buy_gas: '0.001', sell_revenue: '0.03', sell_gas: '0.001' },
            { token: '0xc', chain: 'bsc', realized_pnl: 0.10, buy_time: 1700004000, sell_time: 1700005000, pool_type: 'v3', fee_tier: 3000, buy_cost: '0.05', buy_gas: '0.001', sell_revenue: '0.15', sell_gas: '0.001' },
        ]);

        const app = createTestApp();
        const res = await request(app, '/pnl?range=7d');

        expect(res.status).toBe(200);
        expect(res.body.range).toBe('7d');
        expect(res.body.dataPoints).toHaveLength(3);
        // Cumulative: 0.05, 0.03 (0.05-0.02), 0.13 (0.03+0.10)
        expect(res.body.dataPoints[0].time).toBe(1700002000);
        expect(res.body.dataPoints[0].value).toBeCloseTo(0.05, 4);
        expect(res.body.dataPoints[1].time).toBe(1700003000);
        expect(res.body.dataPoints[1].value).toBeCloseTo(0.03, 4);
        expect(res.body.dataPoints[2].time).toBe(1700005000);
        expect(res.body.dataPoints[2].value).toBeCloseTo(0.13, 4);
    });

    it('defaults to 7d range', async () => {
        (getPnL as ReturnType<typeof vi.fn>).mockReturnValue([]);

        const app = createTestApp();
        const res = await request(app, '/pnl');

        expect(res.status).toBe(200);
        expect(res.body.range).toBe('7d');
        // Check that getPnL was called with fromTimestamp approximately 7 days ago
        expect(getPnL).toHaveBeenCalledTimes(1);
        const callArgs = (getPnL as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const now = Math.floor(Date.now() / 1000);
        const sevenDaysAgo = now - 604800;
        expect(callArgs.fromTimestamp).toBeGreaterThan(sevenDaysAgo - 10);
        expect(callArgs.fromTimestamp).toBeLessThan(sevenDaysAgo + 10);
    });

    it('excludes open trades (no sell_time) from P&L chart', async () => {
        (getPnL as ReturnType<typeof vi.fn>).mockReturnValue([
            { token: '0xa', chain: 'eth', realized_pnl: null, buy_time: 1700000000, sell_time: null, pool_type: 'v2', fee_tier: null, buy_cost: '0.05', buy_gas: '0.001', sell_revenue: null, sell_gas: null },
        ]);

        const app = createTestApp();
        const res = await request(app, '/pnl?range=all');

        expect(res.status).toBe(200);
        expect(res.body.dataPoints).toHaveLength(0);
    });

    it('handles all range values', async () => {
        (getPnL as ReturnType<typeof vi.fn>).mockReturnValue([]);

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
