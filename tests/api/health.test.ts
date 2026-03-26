// tests/api/health.test.ts
// Health endpoint tests: 200 ok when connected, 503 degraded when disconnected.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createMockChainContext, createDisconnectedContext } from '../fixtures/api.fixtures';

// Mock db module to avoid SQLite initialization in tests
vi.mock('../../src/utils/db', () => ({
    getOpenPositionCount: { get: () => ({ count: 3 }) },
    getTotalExposure: { get: () => ({ total: 0.15 }) },
    getPnL: () => [
        { realized_pnl: 0.05 },
        { realized_pnl: -0.02 },
    ],
}));

// Mock riskManager
vi.mock('../../src/riskManager', () => ({
    getPortfolioExposure: () => ({ total: 0.15, byChain: { eth: 0.15 } }),
}));

// Dynamic import after mocks
const { healthRoutes } = await import('../../src/api/routes/health');

/**
 * Helper: create an Express app with healthRoutes mounted,
 * then use Node's built-in http to make a request.
 */
async function requestHealth(app: express.Express): Promise<{ status: number; body: Record<string, unknown> }> {
    const http = await import('http');
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            const req = http.request(
                { hostname: '127.0.0.1', port: addr.port, path: '/health', method: 'GET' },
                (res) => {
                    let data = '';
                    res.on('data', (chunk: Buffer) => { data += chunk; });
                    res.on('end', () => {
                        server.close();
                        resolve({ status: res.statusCode!, body: JSON.parse(data) });
                    });
                },
            );
            req.on('error', (err) => { server.close(); reject(err); });
            req.end();
        });
    });
}

describe('GET /health', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('returns 200 with status ok when chain connected', async () => {
        const ctx = createMockChainContext();
        const app = express();
        app.use('/health', healthRoutes([ctx]));

        const { status, body } = await requestHealth(app);

        expect(status).toBe(200);
        expect(body.status).toBe('ok');
        expect((body.chains as Array<Record<string, unknown>>)[0].connected).toBe(true);
        expect((body.positions as Record<string, unknown>).open).toBeTypeOf('number');
        expect(body.uptime).toBeTypeOf('number');
    });

    it('returns 503 when chain disconnected', async () => {
        const ctx = createDisconnectedContext();
        const app = express();
        app.use('/health', healthRoutes([ctx]));

        const { status, body } = await requestHealth(app);

        expect(status).toBe(503);
        expect(body.status).toBe('degraded');
    });

    it('returns chain details', async () => {
        const ctx = createMockChainContext();
        const app = express();
        app.use('/health', healthRoutes([ctx]));

        const { status, body } = await requestHealth(app);

        expect(status).toBe(200);
        const chains = body.chains as Array<Record<string, unknown>>;
        expect(chains[0].name).toBe('eth');
        expect(chains[0].latestBlock).toBe(12345);
    });
});
