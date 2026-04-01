// test/integration/api/positions.test.ts
// Tests for GET /api/positions endpoint.
// Verifies open positions returned with live prices, priceStale flag, and unrealizedPnl.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

// Mock the shared positions helper (route delegates entirely to this)
vi.mock('../../../src/api/helpers/positions', () => ({
    buildPositionsWithLivePrices: vi.fn(),
}));

import { positionRoutes } from '../../../src/api/routes/positions';
import { buildPositionsWithLivePrices } from '../../../src/api/helpers/positions';

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
        // Restore mock implementation after clearAllMocks
        (buildPositionsWithLivePrices as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    });

    it('returns positions with live prices (priceStale: false)', async () => {
        (buildPositionsWithLivePrices as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                tradeId: 42,
                token: '0xabc',
                chain: 'eth',
                entryPrice: 0.0001,
                currentPrice: 0.012,
                priceStale: false,
                unrealizedPnl: 0.049,
                pnl: -0.051,
                buyCost: '0.05',
                buyGas: '0.001',
                buyTime: 1700000000,
                poolType: 'v2',
                feeTier: null,
                sellRevenue: 0.03,
                exitState: {
                    highWaterMark: 0.015,
                    trailingActivated: true,
                    partialTiersCompleted: [0, 1],
                    urgencyStartTs: Date.now() - 1800000,
                    urgencyPct: 50,
                    originalTokenAmount: '1000000000000000000',
                    volatilitySamples: [0.0001, 0.0002],
                },
            },
        ]);

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
        expect(pos.currentPrice).toBe(0.012);
        expect(pos.priceStale).toBe(false);
        expect(pos.unrealizedPnl).toBe(0.049);
        expect(pos.sellRevenue).toBe(0.03);

        // Exit state should be populated
        expect(pos.exitState).not.toBeNull();
        expect(pos.exitState.highWaterMark).toBe(0.015);
        expect(pos.exitState.trailingActivated).toBe(true);
        expect(pos.exitState.partialTiersCompleted).toEqual([0, 1]);
    });

    it('returns stale price when queryPrice fails', async () => {
        (buildPositionsWithLivePrices as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                tradeId: 10,
                token: '0xdef',
                chain: 'eth',
                entryPrice: 0.01,
                currentPrice: 0.015,
                priceStale: true,
                unrealizedPnl: null,
                pnl: -0.02,
                buyCost: '0.02',
                buyGas: '0.001',
                buyTime: 1700000000,
                poolType: 'v3',
                feeTier: 3000,
                sellRevenue: 0,
                exitState: null,
            },
        ]);

        const app = createTestApp();
        const res = await request(app, '/');

        expect(res.status).toBe(200);
        expect(res.body.positions).toHaveLength(1);
        expect(res.body.positions[0].priceStale).toBe(true);
        expect(res.body.positions[0].currentPrice).toBe(0.015);
    });

    it('returns unrealizedPnl field', async () => {
        (buildPositionsWithLivePrices as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                tradeId: 5,
                token: '0xfoo',
                chain: 'eth',
                entryPrice: 0.01,
                currentPrice: 0.02,
                priceStale: false,
                unrealizedPnl: 0.05,
                pnl: -0.01,
                buyCost: '0.01',
                buyGas: '0.001',
                buyTime: 1700000000,
                poolType: 'v2',
                feeTier: null,
                sellRevenue: 0,
                exitState: null,
            },
        ]);

        const app = createTestApp();
        const res = await request(app, '/');

        expect(res.status).toBe(200);
        expect(res.body.positions[0].unrealizedPnl).toBe(0.05);
    });

    it('returns empty array when no open positions', async () => {
        (buildPositionsWithLivePrices as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const app = createTestApp();
        const res = await request(app, '/');

        expect(res.status).toBe(200);
        expect(res.body.positions).toEqual([]);
    });

    it('calls buildPositionsWithLivePrices with contexts', async () => {
        (buildPositionsWithLivePrices as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const app = createTestApp();
        await request(app, '/');

        expect(buildPositionsWithLivePrices).toHaveBeenCalledOnce();
        expect(buildPositionsWithLivePrices).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ chain: expect.objectContaining({ name: 'eth' }) })]),
        );
    });
});
