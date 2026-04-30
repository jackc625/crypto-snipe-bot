// test/integration/api/health.test.ts
// Health endpoint tests: 200 ok when connected, 503 degraded when disconnected.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createMockChainContext, createDisconnectedContext } from '../../fixtures/api.fixtures';

// Mock db module to avoid SQLite initialization in tests
vi.mock('../../../src/utils/db', () => ({
    getOpenPositionCount: { get: () => ({ count: 3 }) },
    getTotalExposure: { get: () => ({ total: 0.15 }) },
    getPnL: () => [
        { realized_pnl: 0.05 },
        { realized_pnl: -0.02 },
    ],
}));

// Mock riskManager
vi.mock('../../../src/riskManager', () => ({
    getPortfolioExposure: () => ({ total: 0.15, byChain: { eth: 0.15 } }),
}));

// Dynamic import after mocks
const { healthRoutes } = await import('../../../src/api/routes/health');

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
        expect(body).toHaveProperty('version');
        expect(typeof body.version).toBe('string');
        expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
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
        expect(chains[0].latestBlock).toBe(12345678);
    });

    // D-19: Telegram status tests
    it('includes telegramConnected: true when getter reports connected', async () => {
        const ctx = createMockChainContext();
        const getTelegramStatus = () => ({ connected: true, error: null });
        const app = express();
        app.use('/health', healthRoutes([ctx], getTelegramStatus));

        const { status, body } = await requestHealth(app);

        expect(status).toBe(200);
        expect(body.telegramConnected).toBe(true);
        expect(body.telegramError).toBeNull();
    });

    it('includes telegramConnected: false when getter reports not configured', async () => {
        const ctx = createMockChainContext();
        const getTelegramStatus = () => ({ connected: false, error: 'Not configured' });
        const app = express();
        app.use('/health', healthRoutes([ctx], getTelegramStatus));

        const { status, body } = await requestHealth(app);

        expect(status).toBe(200);
        expect(body.telegramConnected).toBe(false);
        expect(body.telegramError).toBe('Not configured');
    });

    it('defaults telegramConnected to false when no getter provided', async () => {
        const ctx = createMockChainContext();
        const app = express();
        // No getTelegramStatus parameter
        app.use('/health', healthRoutes([ctx]));

        const { status, body } = await requestHealth(app);

        expect(status).toBe(200);
        expect(body.telegramConnected).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Phase 17 / DEBT-05 retroactive harm-prevention block.
// Phase 8 DASH/MON: /health body.version emits the package.json version field
// (INT-HEALTH-VERSION closure from v6.16-MILESTONE-AUDIT.md line 167).
// ---------------------------------------------------------------------------

describe('Phase 8 harm-prevention: DASH/MON /health emits version from package.json (INT-HEALTH-VERSION closure)', () => {
    it('GET /health response body.version equals package.json version field exactly', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const pkgPath = path.resolve(process.cwd(), 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };

        const ctx = createMockChainContext();
        const app = express();
        app.use('/health', healthRoutes([ctx]));

        const { status, body } = await requestHealth(app);

        // D-04 observable effect 1: 200 OK
        expect(status).toBe(200);
        // D-04 observable effect 2: version field present and string-typed
        expect(typeof body.version).toBe('string');
        // D-04 observable effect 3: dynamic equality with package.json (MATERIALLY STRONGER than the existing semver-only check at lines 57-72;
        // semver regex passes against any '1.0.0'-shaped string, but `.toBe(pkg.version)` falsifies if pkg.version → body.version flow breaks).
        expect(body.version).toBe(pkg.version);
        // D-04 observable effect 4: still semver-shaped (regression guard against non-semver string sneaking in)
        expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    });
});
