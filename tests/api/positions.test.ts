// tests/api/positions.test.ts
// Tests for GET /api/positions endpoint.
// Verifies open positions returned with exit state data.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { positionRoutes } from '../../src/api/routes/positions';

// Mock db module
vi.mock('../../src/utils/db', () => ({
    getPnL: vi.fn(),
    getExitState: { get: vi.fn() },
    getTradeIdForPendingToken: { get: vi.fn() },
}));

// Mock exitEngine to avoid loading CONFIG
vi.mock('../../src/exitEngine', () => ({
    exitConfig: {
        urgencyWindowMs: 3600000, // 1 hour for test
        trailingStopPct: 10,
        trailingMinPct: 5,
        trailingMaxPct: 25,
        stopLossPct: 15,
        partialSellTiers: [],
        pollIntervalMs: 5000,
        volatilityBaselineCV: 0.1,
        volatilityMaxSamples: 100,
        volatilityMinSamples: 5,
    },
}));

import { getPnL, getExitState, getTradeIdForPendingToken } from '../../src/utils/db';

// Helper to make requests against the route
function createTestApp() {
    const app = express();
    const mockContext = {
        chain: { name: 'eth', displayName: '[ETH]', chainId: 1, enabled: true },
        httpProvider: {},
        wsProvider: null,
        wallet: {},
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    } as any;
    app.use('/', positionRoutes([mockContext]));
    return app;
}

// Simple supertest replacement using Node http
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

describe('GET /api/positions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns open positions with exit state', async () => {
        // Mock a pending PnLResult (sell_time === null means open)
        (getPnL as ReturnType<typeof vi.fn>).mockReturnValue([
            {
                token: '0xabc',
                chain: 'eth',
                buy_cost: '0.05',
                buy_gas: '0.001',
                sell_revenue: null,
                sell_gas: null,
                realized_pnl: null,
                buy_time: 1700000000,
                sell_time: null,
                pool_type: 'v2',
                fee_tier: null,
            },
        ]);

        // Mock trade ID lookup
        (getTradeIdForPendingToken.get as ReturnType<typeof vi.fn>).mockReturnValue({ id: 42 });

        // Mock exit state row
        (getExitState.get as ReturnType<typeof vi.fn>).mockReturnValue({
            trade_id: 42,
            entry_price: 0.0001,
            high_water_mark: 0.0005,
            trailing_activated: 1,
            partial_tiers_completed: '[0,1]',
            original_token_amount: '1000000000000000000',
            urgency_start_ts: Date.now() - 1800000, // 30 min ago
            volatility_samples: '[0.0001,0.0002,0.0005]',
        });

        const app = createTestApp();
        const res = await request(app, '/');

        expect(res.status).toBe(200);
        expect(res.body.positions).toHaveLength(1);

        const pos = res.body.positions[0];
        expect(pos.tradeId).toBe(42);
        expect(pos.token).toBe('0xabc');
        expect(pos.chain).toBe('eth');
        expect(pos.buyCost).toBe('0.05');
        expect(pos.buyTime).toBe(1700000000);
        expect(pos.poolType).toBe('v2');

        // Exit state should be populated
        expect(pos.exitState).not.toBeNull();
        expect(pos.exitState.highWaterMark).toBe(0.0005);
        expect(pos.exitState.trailingActivated).toBe(true);
        expect(pos.exitState.partialTiersCompleted).toEqual([0, 1]);
        expect(pos.exitState.originalTokenAmount).toBe('1000000000000000000');
        expect(pos.exitState.volatilitySamples).toEqual([0.0001, 0.0002, 0.0005]);
        // Urgency should be ~50% (30min of 60min window)
        expect(pos.exitState.urgencyPct).toBeGreaterThan(40);
        expect(pos.exitState.urgencyPct).toBeLessThan(60);
    });

    it('returns empty array when no positions', async () => {
        (getPnL as ReturnType<typeof vi.fn>).mockReturnValue([]);

        const app = createTestApp();
        const res = await request(app, '/');

        expect(res.status).toBe(200);
        expect(res.body.positions).toEqual([]);
    });

    it('filters out closed positions (sell_time not null)', async () => {
        (getPnL as ReturnType<typeof vi.fn>).mockReturnValue([
            {
                token: '0xabc',
                chain: 'eth',
                buy_cost: '0.05',
                buy_gas: '0.001',
                sell_revenue: '0.10',
                sell_gas: '0.001',
                realized_pnl: 0.048,
                buy_time: 1700000000,
                sell_time: 1700001000, // Sold - not open
                pool_type: 'v2',
                fee_tier: null,
            },
        ]);

        const app = createTestApp();
        const res = await request(app, '/');

        expect(res.status).toBe(200);
        expect(res.body.positions).toEqual([]);
    });

    it('returns null exitState when no exit state row exists', async () => {
        (getPnL as ReturnType<typeof vi.fn>).mockReturnValue([
            {
                token: '0xdef',
                chain: 'bsc',
                buy_cost: '0.02',
                buy_gas: '0.0005',
                sell_revenue: null,
                sell_gas: null,
                realized_pnl: null,
                buy_time: 1700000000,
                sell_time: null,
                pool_type: 'v3',
                fee_tier: 3000,
            },
        ]);

        (getTradeIdForPendingToken.get as ReturnType<typeof vi.fn>).mockReturnValue({ id: 99 });
        (getExitState.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

        const app = createTestApp();
        const res = await request(app, '/');

        expect(res.status).toBe(200);
        expect(res.body.positions).toHaveLength(1);
        expect(res.body.positions[0].exitState).toBeNull();
        expect(res.body.positions[0].tradeId).toBe(99);
    });
});
