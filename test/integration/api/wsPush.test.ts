// test/integration/api/wsPush.test.ts
// Integration test verifying WebSocket broadcast uses the shared
// buildPositionsWithLivePrices helper (DASH-01-e).
//
// Strategy: Mock the helper and broadcaster, then verify the 5s interval
// in server.ts calls buildPositionsWithLivePrices and broadcasts the result.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all server dependencies to isolate the broadcast interval logic
vi.mock('../../../src/api/helpers/positions', () => ({
    buildPositionsWithLivePrices: vi.fn().mockResolvedValue([
        {
            tradeId: 1,
            token: '0xabc',
            chain: 'eth',
            currentPrice: 0.05,
            priceStale: false,
            unrealizedPnl: 0.01,
            pnl: -0.04,
            buyCost: '0.05',
            buyGas: '0.001',
            buyTime: 1700000000,
            poolType: 'v2',
            feeTier: null,
            sellRevenue: 0,
            exitState: null,
            entryPrice: 0.04,
        },
    ]),
}));

vi.mock('../../../src/api/ws/broadcaster', () => ({
    broadcast: vi.fn(),
    getClientCount: vi.fn().mockReturnValue(1), // Simulate 1 connected client
    addClient: vi.fn(),
    removeClient: vi.fn(),
}));

vi.mock('../../../src/api/ws/handler', () => ({
    handleUpgrade: () => () => {},
}));

vi.mock('../../../src/api/middleware/auth', () => ({
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    sessions: new Map(),
}));

vi.mock('../../../src/api/routes/auth', () => ({
    authRoutes: () => {
        const { Router } = require('express');
        return Router();
    },
}));

vi.mock('../../../src/api/routes/trades', () => ({
    tradeRoutes: () => {
        const { Router } = require('express');
        return Router();
    },
}));

vi.mock('../../../src/api/routes/risk', () => ({
    riskRoutes: () => {
        const { Router } = require('express');
        return Router();
    },
}));

vi.mock('../../../src/api/routes/controls', () => ({
    controlRoutes: () => {
        const { Router } = require('express');
        return Router();
    },
}));

vi.mock('../../../src/utils/db', () => ({
    getOpenPositionCount: { get: () => ({ count: 0 }) },
    getTotalExposure: { get: () => ({ total: 0 }) },
    getPnL: () => [],
}));

vi.mock('../../../src/riskManager', () => ({
    getPortfolioExposure: () => ({ total: 0, byChain: {} }),
}));

vi.mock('../../../src/exitEngine', () => ({
    exitConfig: {
        urgencyWindowMs: 3600000,
        trailingStopPct: 10,
        stopLossPct: 15,
        partialSellTiers: [],
        pollIntervalMs: 5000,
    },
}));

vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        }),
    },
}));

import { buildPositionsWithLivePrices } from '../../../src/api/helpers/positions';
import { broadcast, getClientCount } from '../../../src/api/ws/broadcaster';

describe('WebSocket position broadcast (DASH-01-e)', () => {
    let serverHandle: { close: () => void } | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        vi.useFakeTimers();

        // Restore mock implementations after clearAllMocks
        (buildPositionsWithLivePrices as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                tradeId: 1,
                token: '0xabc',
                chain: 'eth',
                currentPrice: 0.05,
                priceStale: false,
                unrealizedPnl: 0.01,
            },
        ]);
        (getClientCount as ReturnType<typeof vi.fn>).mockReturnValue(1);
        (broadcast as ReturnType<typeof vi.fn>).mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        if (serverHandle) {
            serverHandle.close();
            serverHandle = null;
        }
    });

    it('calls buildPositionsWithLivePrices on broadcast interval', async () => {
        // Set a port to avoid collision with other tests
        process.env.DASHBOARD_PORT = '0';
        process.env.DASHBOARD_HOST = '127.0.0.1';

        const { startApiServer } = await import('../../../src/api/server');

        const mockContext = {
            chain: { name: 'eth', displayName: '[ETH]', chainId: 1, enabled: true, dexes: [] },
            httpProvider: { getBlockNumber: vi.fn().mockResolvedValue(100) },
            wsProvider: null,
            wallet: { address: '0x123' },
            log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        } as any;

        serverHandle = startApiServer([mockContext]);

        // buildPositionsWithLivePrices should not have been called yet
        expect(buildPositionsWithLivePrices).not.toHaveBeenCalled();

        // Advance past the 5s interval
        await vi.advanceTimersByTimeAsync(5100);

        // Now it should have been called at least once
        expect(buildPositionsWithLivePrices).toHaveBeenCalled();
        expect(buildPositionsWithLivePrices).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ chain: expect.objectContaining({ name: 'eth' }) })]),
        );
    });

    it('broadcasts positions data via WebSocket', async () => {
        process.env.DASHBOARD_PORT = '0';
        process.env.DASHBOARD_HOST = '127.0.0.1';

        const { startApiServer } = await import('../../../src/api/server');

        const mockContext = {
            chain: { name: 'eth', displayName: '[ETH]', chainId: 1, enabled: true, dexes: [] },
            httpProvider: { getBlockNumber: vi.fn().mockResolvedValue(100) },
            wsProvider: null,
            wallet: { address: '0x123' },
            log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        } as any;

        serverHandle = startApiServer([mockContext]);

        // Advance past the 5s interval
        await vi.advanceTimersByTimeAsync(5100);

        // broadcast should have been called with positions_update event
        expect(broadcast).toHaveBeenCalledWith(
            'positions_update',
            expect.objectContaining({
                positions: expect.arrayContaining([
                    expect.objectContaining({
                        token: '0xabc',
                        currentPrice: 0.05,
                        priceStale: false,
                        unrealizedPnl: 0.01,
                    }),
                ]),
            }),
        );
    });

    it('skips broadcast when no WebSocket clients connected', async () => {
        // No clients connected
        (getClientCount as ReturnType<typeof vi.fn>).mockReturnValue(0);

        process.env.DASHBOARD_PORT = '0';
        process.env.DASHBOARD_HOST = '127.0.0.1';

        const { startApiServer } = await import('../../../src/api/server');

        const mockContext = {
            chain: { name: 'eth', displayName: '[ETH]', chainId: 1, enabled: true, dexes: [] },
            httpProvider: { getBlockNumber: vi.fn().mockResolvedValue(100) },
            wsProvider: null,
            wallet: { address: '0x123' },
            log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        } as any;

        serverHandle = startApiServer([mockContext]);

        // Advance past the 5s interval
        await vi.advanceTimersByTimeAsync(5100);

        // buildPositionsWithLivePrices should NOT have been called (no clients)
        expect(buildPositionsWithLivePrices).not.toHaveBeenCalled();
        expect(broadcast).not.toHaveBeenCalled();
    });
});
