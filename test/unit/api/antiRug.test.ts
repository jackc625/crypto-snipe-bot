// test/unit/api/antiRug.test.ts
// Phase 19 / Plan 19-06 Task 1 — backend routes + dashboard types + WS dispatch.
//
// Tests:
//   Test 1: POST /api/anti-rug/circuit-breaker/xyz/reset on an unknown chain
//           returns 404 with `{error: 'Chain not found'}`.
//   Test 2: POST /api/anti-rug/circuit-breaker/eth/reset when CB not currently
//           tripped returns 409 with `{error: 'Circuit breaker not currently
//           tripped on this chain'}`.
//   Test 3: POST /api/anti-rug/circuit-breaker/eth/reset when CB tripped calls
//           resetCircuitBreaker(ctx) and returns 200 with `{ok: true, chain: 'eth'}`.
//   Test 4: POST /api/anti-rug/circuit-breaker/eth/reset when resetCircuitBreaker
//           throws returns 500 with `{error: 'Reset failed: ...'}`.
//   Test 5: GET /api/anti-rug/events/eth returns the recent triggers (mocked).
//   Test 6: src/api/server.ts mounts antiRugRoutes at /api/anti-rug AFTER the
//           existing controls mount (inherits authMiddleware).
//
// Dashboard-types + useWebSocket source-text guards:
//   Test 7: dashboard/src/types/api.ts Position interface includes
//           `antiRugState?: AntiRugMonitorState` (union of 6 states).
//   Test 8: dashboard/src/types/api.ts exports AntiRugEvent type union covering
//           `kind: 'trigger' | 'allowlist-suppression' | 'gap-detected'`.
//   Test 9: dashboard/src/hooks/useWebSocket.ts switch handles
//           `antirug_state_update`.
//   Test 10: dashboard/src/hooks/useWebSocket.ts switch handles `antirug_event`.
//   Test 11: dashboard/src/hooks/useWebSocket.ts switch handles
//            `chain_ws_health_change`.
//   Test 12: dashboard/src/hooks/useWebSocket.ts switch handles `cb_tripped`.
//   Test 13: dashboard/src/hooks/useWebSocket.ts switch handles `cb_reset`.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMockChainContext } from '../../fixtures/api.fixtures';

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

const resetCircuitBreakerMock = vi.fn();
const isCircuitBreakerTrippedMock = vi.fn();
const getRecentTriggersMock = vi.fn();

vi.mock('../../../src/anti-rug/circuitBreaker', () => ({
    resetCircuitBreaker: (...args: any[]) => resetCircuitBreakerMock(...args),
    isCircuitBreakerTripped: (...args: any[]) => isCircuitBreakerTrippedMock(...args),
    getRecentTriggers: (...args: any[]) => getRecentTriggersMock(...args),
}));

vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
            fatal: () => {},
            child: () => ({
                info: () => {},
                warn: () => {},
                error: () => {},
                debug: () => {},
                fatal: () => {},
            }),
        }),
    },
}));

// Must import after mocks
import { antiRugRoutes } from '../../../src/api/routes/antiRug';

// Helper: create supertest-like request function using raw http
async function request(
    app: express.Express,
    method: 'GET' | 'POST',
    path: string,
): Promise<{ status: number; body: any }> {
    return new Promise((resolveReq, reject) => {
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
                        resolveReq({ status: res.statusCode, body: JSON.parse(data) });
                    } catch {
                        resolveReq({ status: res.statusCode, body: data });
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

describe('Phase 19 — /api/anti-rug routes', () => {
    let app: express.Express;
    let ethCtx: ReturnType<typeof createMockChainContext>;

    beforeEach(() => {
        vi.clearAllMocks();
        ethCtx = createMockChainContext({ name: 'eth' });
        app = express();
        app.use(express.json());
        app.use('/api/anti-rug', antiRugRoutes([ethCtx]));
    });

    describe('POST /api/anti-rug/circuit-breaker/:chain/reset', () => {
        it('Test 1: returns 404 for unknown chain', async () => {
            const res = await request(app, 'POST', '/api/anti-rug/circuit-breaker/xyz/reset');
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Chain not found');
        });

        it('Test 2: returns 409 when CB not currently tripped', async () => {
            isCircuitBreakerTrippedMock.mockReturnValue(false);
            const res = await request(app, 'POST', '/api/anti-rug/circuit-breaker/eth/reset');
            expect(res.status).toBe(409);
            expect(res.body.error).toBe('Circuit breaker not currently tripped on this chain');
        });

        it('Test 3: returns 200 + calls resetCircuitBreaker when CB tripped', async () => {
            isCircuitBreakerTrippedMock.mockReturnValue(true);
            const res = await request(app, 'POST', '/api/anti-rug/circuit-breaker/eth/reset');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.chain).toBe('eth');
            expect(resetCircuitBreakerMock).toHaveBeenCalledWith(ethCtx);
        });

        it('Test 4: returns 500 when resetCircuitBreaker throws', async () => {
            isCircuitBreakerTrippedMock.mockReturnValue(true);
            resetCircuitBreakerMock.mockImplementation(() => {
                throw new Error('Database locked');
            });
            const res = await request(app, 'POST', '/api/anti-rug/circuit-breaker/eth/reset');
            expect(res.status).toBe(500);
            expect(res.body.error).toContain('Reset failed:');
            expect(res.body.error).toContain('Database locked');
        });
    });

    describe('GET /api/anti-rug/events/:chain', () => {
        it('Test 5: returns recent triggers for known chain', async () => {
            const triggers = [
                {
                    token: '0xaaa',
                    pair: '0xbbb',
                    signals: {
                        lpRemovedPct: 75,
                        destination: '0xccc',
                        allowlistHit: 'unsafe',
                        sellSimSlippagePct: 80,
                        v2ReservePctBelow: null,
                    },
                    outcome: 'dry-run-would-have-sold',
                    timestamp: 1700000000000,
                    chain: 'eth',
                },
            ];
            getRecentTriggersMock.mockReturnValue(triggers);
            const res = await request(app, 'GET', '/api/anti-rug/events/eth');
            expect(res.status).toBe(200);
            expect(res.body.events).toEqual(triggers);
            expect(res.body.chain).toBe('eth');
            expect(getRecentTriggersMock).toHaveBeenCalledWith('eth');
        });

        it('returns 404 for unknown chain on GET /events', async () => {
            const res = await request(app, 'GET', '/api/anti-rug/events/xyz');
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Chain not found');
        });
    });
});

describe('Phase 19 — src/api/server.ts mount', () => {
    it('Test 6: mounts antiRugRoutes at /api/anti-rug after the /controls mount', () => {
        const serverSrc = readFileSync(
            resolve(__dirname, '../../../src/api/server.ts'),
            'utf-8',
        ).replace(/\r\n/g, '\n');
        // The router is imported
        expect(serverSrc).toMatch(/import\s+\{\s*antiRugRoutes\s*\}\s+from\s+['"]\.\/routes\/antiRug['"]/);
        // The router is mounted at /anti-rug AFTER /controls
        const controlsIdx = serverSrc.indexOf("apiRouter.use('/controls'");
        const antiRugIdx = serverSrc.indexOf("apiRouter.use('/anti-rug'");
        expect(controlsIdx).toBeGreaterThan(0);
        expect(antiRugIdx).toBeGreaterThan(controlsIdx);
        // The mount passes the contexts factory pattern
        expect(serverSrc).toMatch(/apiRouter\.use\(['"]\/anti-rug['"],\s*antiRugRoutes\(contexts\)\)/);
    });
});

describe('Phase 19 — dashboard/src/types/api.ts extensions', () => {
    let typesSrc: string;
    beforeEach(() => {
        typesSrc = readFileSync(
            resolve(__dirname, '../../../dashboard/src/types/api.ts'),
            'utf-8',
        ).replace(/\r\n/g, '\n');
    });

    it('Test 7: Position interface includes antiRugState?: AntiRugMonitorState', () => {
        // 6-state union must be exported as type AntiRugMonitorState
        expect(typesSrc).toMatch(/export\s+type\s+AntiRugMonitorState\s*=/);
        for (const state of ['live', 'dry-run', 'would-have-sold', 'exit-fired', 'halted', 'unmonitored']) {
            expect(typesSrc).toContain(`'${state}'`);
        }
        // Position field
        expect(typesSrc).toMatch(/antiRugState\?\s*:\s*AntiRugMonitorState/);
    });

    it('Test 8: exports AntiRugEvent with kind union (trigger | allowlist-suppression | gap-detected)', () => {
        expect(typesSrc).toMatch(/export\s+interface\s+AntiRugEvent/);
        expect(typesSrc).toContain("'trigger'");
        expect(typesSrc).toContain("'allowlist-suppression'");
        expect(typesSrc).toContain("'gap-detected'");
        // Other expected exported types per UI-SPEC Realtime Push Contract
        expect(typesSrc).toMatch(/export\s+interface\s+ChainWsHealthChange/);
        expect(typesSrc).toMatch(/export\s+interface\s+CbTrippedPayload/);
        expect(typesSrc).toMatch(/export\s+interface\s+CbResetPayload/);
        expect(typesSrc).toMatch(/export\s+interface\s+RugSignals/);
        expect(typesSrc).toMatch(/export\s+interface\s+TriggerEvent/);
    });
});

describe('Phase 19 — dashboard/src/hooks/useWebSocket.ts switch dispatch', () => {
    let hookSrc: string;
    beforeEach(() => {
        hookSrc = readFileSync(
            resolve(__dirname, '../../../dashboard/src/hooks/useWebSocket.ts'),
            'utf-8',
        ).replace(/\r\n/g, '\n');
    });

    it('Test 9: handles antirug_state_update case', () => {
        expect(hookSrc).toMatch(/case\s+['"]antirug_state_update['"]/);
        // Updates positions by tradeId
        expect(hookSrc).toMatch(/setPositions/);
    });

    it('Test 10: handles antirug_event case', () => {
        expect(hookSrc).toMatch(/case\s+['"]antirug_event['"]/);
        // Updates a per-chain events map
        expect(hookSrc).toMatch(/setAntiRugEvents/);
    });

    it('Test 11: handles chain_ws_health_change case', () => {
        expect(hookSrc).toMatch(/case\s+['"]chain_ws_health_change['"]/);
        expect(hookSrc).toMatch(/setChainWsHealth/);
    });

    it('Test 12: handles cb_tripped case', () => {
        expect(hookSrc).toMatch(/case\s+['"]cb_tripped['"]/);
        expect(hookSrc).toMatch(/setCircuitBreakerTrips/);
    });

    it('Test 13: handles cb_reset case', () => {
        expect(hookSrc).toMatch(/case\s+['"]cb_reset['"]/);
        // cb_reset removes a chain key from the trips map — must touch that setter
        expect(hookSrc).toMatch(/setCircuitBreakerTrips/);
    });

    it('UseWebSocketResult interface exposes the new state', () => {
        expect(hookSrc).toMatch(/antiRugEvents\s*:/);
        expect(hookSrc).toMatch(/chainWsHealth\s*:/);
        expect(hookSrc).toMatch(/circuitBreakerTrips\s*:/);
    });
});
