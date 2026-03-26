// tests/api/trades.test.ts
// Tests for GET /api/trades and GET /api/trades/export endpoints.
// Verifies pagination, filtering, and CSV export.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { tradeRoutes } from '../../src/api/routes/trades';

// Mock db module
vi.mock('../../src/utils/db', () => ({
    getPnL: vi.fn(),
}));

import { getPnL } from '../../src/utils/db';

// Helper to make requests against the route
function createTestApp() {
    const app = express();
    app.use('/', tradeRoutes());
    return app;
}

// Simple HTTP request helper
async function request(app: express.Express, path: string) {
    return new Promise<{ status: number; body: any; text: string; headers: Record<string, string> }>((resolve) => {
        const http = require('http');
        const server = app.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            http.get(`http://127.0.0.1:${addr.port}${path}`, (res: any) => {
                let data = '';
                res.on('data', (chunk: string) => data += chunk);
                res.on('end', () => {
                    server.close();
                    let body: any;
                    try { body = JSON.parse(data); } catch { body = null; }
                    resolve({
                        status: res.statusCode,
                        body,
                        text: data,
                        headers: res.headers,
                    });
                });
            });
        });
    });
}

// Generate mock trades for testing
function createMockTrades(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        token: `0xtoken${i}`,
        chain: i % 2 === 0 ? 'eth' : 'bsc',
        buy_cost: '0.05',
        buy_gas: '0.001',
        sell_revenue: '0.10',
        sell_gas: '0.001',
        realized_pnl: i % 3 === 0 ? -0.01 : 0.048,
        buy_time: 1700000000 + i * 1000,
        sell_time: 1700001000 + i * 1000,
        pool_type: 'v2',
        fee_tier: null,
    }));
}

describe('GET /api/trades', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('filters trades by chain', async () => {
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
                sell_time: 1700001000,
                pool_type: 'v2',
                fee_tier: null,
            },
        ]);

        const app = createTestApp();
        const res = await request(app, '/?chain=eth');

        expect(res.status).toBe(200);
        // Verify getPnL was called with chain filter
        expect(getPnL).toHaveBeenCalledWith(
            expect.objectContaining({ chain: 'eth' })
        );
        expect(res.body.trades).toHaveLength(1);
        expect(res.body.trades[0].chain).toBe('eth');
    });

    it('paginates results', async () => {
        // Return 30 items
        const mockTrades = createMockTrades(30);
        (getPnL as ReturnType<typeof vi.fn>).mockReturnValue(mockTrades);

        const app = createTestApp();
        const res = await request(app, '/?page=2&limit=10');

        expect(res.status).toBe(200);
        expect(res.body.trades).toHaveLength(10);
        expect(res.body.pagination).toEqual({
            page: 2,
            limit: 10,
            total: 30,
            totalPages: 3,
        });
        // Should be trades 10-19 (0-indexed)
        expect(res.body.trades[0].token).toBe('0xtoken10');
    });

    it('defaults to 7 day time range', async () => {
        (getPnL as ReturnType<typeof vi.fn>).mockReturnValue([]);

        const app = createTestApp();
        await request(app, '/');

        expect(getPnL).toHaveBeenCalledTimes(1);
        const callArgs = (getPnL as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const now = Math.floor(Date.now() / 1000);
        const sevenDaysAgo = now - 7 * 24 * 60 * 60;
        // fromTimestamp should be approximately 7 days ago (within 10 second tolerance)
        expect(callArgs.fromTimestamp).toBeGreaterThan(sevenDaysAgo - 10);
        expect(callArgs.fromTimestamp).toBeLessThan(sevenDaysAgo + 10);
    });

    it('returns all column groups per D-27', async () => {
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
                sell_time: 1700001000,
                pool_type: 'v3',
                fee_tier: 3000,
            },
        ]);

        const app = createTestApp();
        const res = await request(app, '/');

        const trade = res.body.trades[0];
        // Core
        expect(trade.token).toBe('0xabc');
        expect(trade.chain).toBe('eth');
        expect(trade.action).toBe('closed');
        expect(trade.pnl).toBe(0.048);
        // Timing
        expect(trade.buyTime).toBe(1700000000);
        expect(trade.sellTime).toBe(1700001000);
        expect(trade.durationHeld).toBe(1000);
        // Amounts
        expect(trade.buyCost).toBe('0.05');
        expect(trade.buyGas).toBe('0.001');
        expect(trade.sellRevenue).toBe('0.10');
        expect(trade.sellGas).toBe('0.001');
        // Exit
        expect(trade.poolType).toBe('v3');
        expect(trade.feeTier).toBe(3000);
    });

    it('filters by outcome profit', async () => {
        (getPnL as ReturnType<typeof vi.fn>).mockReturnValue([
            { token: '0xa', chain: 'eth', buy_cost: '0.05', buy_gas: '0.001', sell_revenue: '0.10', sell_gas: '0.001', realized_pnl: 0.05, buy_time: 1700000000, sell_time: 1700001000, pool_type: 'v2', fee_tier: null },
            { token: '0xb', chain: 'eth', buy_cost: '0.05', buy_gas: '0.001', sell_revenue: '0.01', sell_gas: '0.001', realized_pnl: -0.04, buy_time: 1700002000, sell_time: 1700003000, pool_type: 'v2', fee_tier: null },
        ]);

        const app = createTestApp();
        const res = await request(app, '/?outcome=profit');

        expect(res.body.trades).toHaveLength(1);
        expect(res.body.trades[0].token).toBe('0xa');
    });
});

describe('GET /api/trades/export', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exports CSV with correct headers', async () => {
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
                sell_time: 1700001000,
                pool_type: 'v2',
                fee_tier: null,
            },
        ]);

        const app = createTestApp();
        const res = await request(app, '/export');

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('attachment');
        expect(res.headers['content-disposition']).toContain('trades-');
        // Check CSV header row
        expect(res.text).toContain('Token,Chain');
        expect(res.text).toContain('P&L');
        // Check data row
        expect(res.text).toContain('0xabc');
        expect(res.text).toContain('eth');
    });

    it('exports all matching trades without pagination', async () => {
        const mockTrades = createMockTrades(30);
        (getPnL as ReturnType<typeof vi.fn>).mockReturnValue(mockTrades);

        const app = createTestApp();
        const res = await request(app, '/export');

        // Header + 30 data rows = 31 lines
        const lines = res.text.split('\n');
        expect(lines.length).toBe(31);
    });
});
