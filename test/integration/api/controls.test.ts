// test/integration/api/controls.test.ts
// Unit tests for force sell and emergency sell control routes.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { createMockChainContext, createMockTradeRow } from '../../fixtures/api.fixtures';

// Track mock calls
const mockGetPendingTrade = vi.fn();
const mockGetAllPendingTrades = vi.fn();
const mockClearAllTimersForToken = vi.fn();
const mockExecuteFullSell = vi.fn();

// Mock db module -- must be before import
vi.mock('../../../src/utils/db', () => ({
    db: {
        prepare: (sql: string) => {
            if (sql.includes('WHERE id = ?')) {
                return { get: mockGetPendingTrade };
            }
            if (sql.includes('WHERE status = ?')) {
                return { all: mockGetAllPendingTrades };
            }
            return { get: vi.fn(), all: vi.fn() };
        },
    },
}));

// Mock exitManager
vi.mock('../../../src/utils/exitManager', () => ({
    clearAllTimersForToken: (...args: any[]) => mockClearAllTimersForToken(...args),
}));

// Mock exitEngine
vi.mock('../../../src/exitEngine', () => ({
    executeFullSell: (...args: any[]) => mockExecuteFullSell(...args),
    exitConfig: {
        trailingStopPct: 15,
        stopLossPct: 25,
        partialSellTiers: [],
        urgencyWindowMs: 1800000,
    },
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
            child: () => ({
                info: () => {},
                warn: () => {},
                error: () => {},
                debug: () => {},
            }),
        }),
    },
}));

// Must import after mocks
import { controlRoutes } from '../../../src/api/routes/controls';

// Helper: create supertest-like request function using raw http
async function request(app: express.Express, method: 'GET' | 'POST', path: string) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
        const http = require('http');
        const server = app.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            const options = {
                hostname: '127.0.0.1',
                port: addr.port,
                path,
                method,
                headers: { 'Content-Type': 'application/json' },
            };
            const req = http.request(options, (res: any) => {
                let data = '';
                res.on('data', (chunk: string) => (data += chunk));
                res.on('end', () => {
                    server.close();
                    try {
                        resolve({ status: res.statusCode, body: JSON.parse(data) });
                    } catch {
                        resolve({ status: res.statusCode, body: data });
                    }
                });
            });
            req.on('error', (err: Error) => {
                server.close();
                reject(err);
            });
            req.end();
        });
    });
}

describe('Control Routes', () => {
    let app: express.Express;
    let ethCtx: ReturnType<typeof createMockChainContext>;

    beforeEach(() => {
        vi.clearAllMocks();
        ethCtx = createMockChainContext({ name: 'eth' });
        app = express();
        app.use(express.json());
        app.use('/api/controls', controlRoutes([ethCtx]));
    });

    describe('POST /api/controls/force-sell/:tradeId', () => {
        it('triggers sell for a pending trade', async () => {
            const trade = createMockTradeRow({ id: 42, chain: 'eth' });
            mockGetPendingTrade.mockReturnValue(trade);
            mockExecuteFullSell.mockResolvedValue(true);

            const res = await request(app, 'POST', '/api/controls/force-sell/42');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.tradeId).toBe(42);
            expect(res.body.token).toBe(trade.token);
            expect(res.body.chain).toBe('eth');

            // Verify Pitfall 3 prevention: timers cleared before sell
            expect(mockClearAllTimersForToken).toHaveBeenCalledWith('eth', trade.token);
            expect(mockExecuteFullSell).toHaveBeenCalledWith(
                ethCtx,
                expect.any(Object), // DexConfig
                trade.token,
                trade.fee_tier,
                'urgency-market-sell',
                42,
                'Force sell triggered via dashboard',
            );
        });

        it('returns 404 for missing trade', async () => {
            mockGetPendingTrade.mockReturnValue(undefined);

            const res = await request(app, 'POST', '/api/controls/force-sell/999');
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Trade not found or already closed');
        });

        it('returns 409 when sell lock held', async () => {
            const trade = createMockTradeRow({ id: 42, chain: 'eth' });
            mockGetPendingTrade.mockReturnValue(trade);
            mockExecuteFullSell.mockResolvedValue(false);

            const res = await request(app, 'POST', '/api/controls/force-sell/42');
            expect(res.status).toBe(409);
            expect(res.body.error).toBe('Sell already in progress for this position');
        });

        it('returns 400 for invalid trade ID', async () => {
            const res = await request(app, 'POST', '/api/controls/force-sell/abc');
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid trade ID');
        });

        it('returns 500 when sell throws', async () => {
            const trade = createMockTradeRow({ id: 42, chain: 'eth' });
            mockGetPendingTrade.mockReturnValue(trade);
            mockExecuteFullSell.mockRejectedValue(new Error('Transaction reverted'));

            const res = await request(app, 'POST', '/api/controls/force-sell/42');
            expect(res.status).toBe(500);
            expect(res.body.error).toContain('Force sell failed: Transaction reverted');
        });
    });

    describe('POST /api/controls/emergency-sell', () => {
        it('sells all open positions', async () => {
            const trades = [
                createMockTradeRow({ id: 1, chain: 'eth', token: '0xaaa' }),
                createMockTradeRow({ id: 2, chain: 'eth', token: '0xbbb' }),
            ];
            mockGetAllPendingTrades.mockReturnValue(trades);
            mockExecuteFullSell.mockResolvedValue(true);

            const res = await request(app, 'POST', '/api/controls/emergency-sell');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.sold).toBe(2);
            expect(res.body.failed).toBe(0);

            // Verify timers cleared for each position
            expect(mockClearAllTimersForToken).toHaveBeenCalledTimes(2);
            expect(mockExecuteFullSell).toHaveBeenCalledTimes(2);
        });

        it('returns success with zero when no positions', async () => {
            mockGetAllPendingTrades.mockReturnValue([]);

            const res = await request(app, 'POST', '/api/controls/emergency-sell');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.sold).toBe(0);
            expect(res.body.message).toBe('No open positions to sell');
        });

        it('tracks errors when some sells fail', async () => {
            const trades = [
                createMockTradeRow({ id: 1, chain: 'eth', token: '0xaaa' }),
                createMockTradeRow({ id: 2, chain: 'eth', token: '0xbbb' }),
            ];
            mockGetAllPendingTrades.mockReturnValue(trades);
            mockExecuteFullSell
                .mockResolvedValueOnce(true)    // first succeeds
                .mockResolvedValueOnce(false);   // second fails (lock held)

            const res = await request(app, 'POST', '/api/controls/emergency-sell');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(false);
            expect(res.body.sold).toBe(1);
            expect(res.body.failed).toBe(1);
            expect(res.body.errors).toHaveLength(1);
            expect(res.body.message).toContain('Emergency sell encountered errors');
        });

        it('handles chain not available gracefully', async () => {
            const trades = [
                createMockTradeRow({ id: 1, chain: 'polygon', token: '0xaaa' }),
            ];
            mockGetAllPendingTrades.mockReturnValue(trades);

            const res = await request(app, 'POST', '/api/controls/emergency-sell');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(false);
            expect(res.body.failed).toBe(1);
            expect(res.body.errors[0].error).toBe('Chain not available');
        });
    });
});
