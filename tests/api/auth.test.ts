// tests/api/auth.test.ts
// Auth login + middleware tests: valid/invalid key, session cookie flow.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { MOCK_API_KEY } from '../fixtures/api.fixtures';
import http from 'http';

// Mock db module to avoid SQLite initialization in tests
vi.mock('../../src/utils/db', () => ({
    getOpenPositionCount: { get: () => ({ count: 0 }) },
    getTotalExposure: { get: () => ({ total: 0 }) },
    getPnL: () => [],
}));

// Mock riskManager
vi.mock('../../src/riskManager', () => ({
    getPortfolioExposure: () => ({ total: 0, byChain: {} }),
}));

// Dynamic imports after mocks
const { loginHandler, authMiddleware, sessions } = await import('../../src/api/middleware/auth');
const { authRoutes } = await import('../../src/api/routes/auth');

/**
 * Helper: make an HTTP request to a test server.
 */
function makeRequest(
    server: http.Server,
    options: { method: string; path: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ status: number; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const addr = server.address() as { port: number };
        const bodyStr = options.body ? JSON.stringify(options.body) : undefined;
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: addr.port,
                path: options.path,
                method: options.method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers || {}),
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk; });
                res.on('end', () => {
                    let parsed: Record<string, unknown> = {};
                    try { parsed = JSON.parse(data); } catch { parsed = { raw: data }; }
                    resolve({ status: res.statusCode!, body: parsed, headers: res.headers });
                });
            },
        );
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

describe('POST /api/auth/login', () => {
    let server: http.Server;
    let app: express.Express;

    beforeEach(() => {
        process.env.DASHBOARD_API_KEY = MOCK_API_KEY;
        sessions.clear();

        app = express();
        app.use(express.json());
        app.use(cookieParser());
        app.use('/api/auth', authRoutes());

        // Protected test endpoint
        app.use('/api', authMiddleware, (_req, res) => {
            res.json({ ok: true });
        });

        return new Promise<void>((resolve) => {
            server = http.createServer(app).listen(0, '127.0.0.1', () => resolve());
        });
    });

    afterEach(() => {
        delete process.env.DASHBOARD_API_KEY;
        sessions.clear();
        return new Promise<void>((resolve) => { server.close(() => resolve()); });
    });

    it('with valid key returns 200 and sets cookie', async () => {
        const { status, body, headers } = await makeRequest(server, {
            method: 'POST',
            path: '/api/auth/login',
            body: { apiKey: MOCK_API_KEY },
        });

        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        const setCookie = headers['set-cookie'];
        expect(setCookie).toBeDefined();
        expect(setCookie![0]).toContain('session=');
    });

    it('with invalid key returns 401', async () => {
        const { status, body } = await makeRequest(server, {
            method: 'POST',
            path: '/api/auth/login',
            body: { apiKey: 'wrong-key' },
        });

        expect(status).toBe(401);
        expect((body.error as string)).toContain('Invalid');
    });

    it('GET /api/* without session returns 401', async () => {
        const { status } = await makeRequest(server, {
            method: 'GET',
            path: '/api/test',
        });

        expect(status).toBe(401);
    });

    it('GET /api/* with valid session returns 200', async () => {
        // First login to get session cookie
        const loginRes = await makeRequest(server, {
            method: 'POST',
            path: '/api/auth/login',
            body: { apiKey: MOCK_API_KEY },
        });

        const setCookie = loginRes.headers['set-cookie']!;
        // Extract the cookie value from Set-Cookie header
        const cookieStr = setCookie[0].split(';')[0];

        // Now request a protected endpoint with the cookie
        const { status, body } = await makeRequest(server, {
            method: 'GET',
            path: '/api/test',
            headers: { Cookie: cookieStr },
        });

        expect(status).toBe(200);
        expect(body.ok).toBe(true);
    });
});
