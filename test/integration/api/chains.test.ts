// test/integration/api/chains.test.ts
// Unit tests for chain status and control routes.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { chainRoutes, maskUrl } from '../../../src/api/routes/chains';
import { createMockChainContext, createDisconnectedChainContext } from '../../fixtures/api.fixtures';

// Mock exitEngine to avoid importing config/db dependencies
vi.mock('../../../src/exitEngine', () => ({
    exitConfig: {
        trailingStopPct: 15,
        stopLossPct: 25,
        partialSellTiers: [{ multiple: 2.0, percent: 50 }],
        urgencyWindowMs: 1800000,
    },
}));

// Mock logger to avoid pino side effects
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
        }),
    },
}));

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

describe('Chain Routes', () => {
    let app: express.Express;
    let stoppedChains: Set<string>;

    beforeEach(() => {
        stoppedChains = new Set<string>();
        app = express();
        app.use(express.json());
    });

    describe('maskUrl', () => {
        it('extracts hostname from URL', () => {
            expect(maskUrl('https://eth-mainnet.g.alchemy.com/v2/abc123')).toBe(
                'eth-mainnet.g.alchemy.com',
            );
        });

        it('returns (invalid url) for malformed input', () => {
            expect(maskUrl('not-a-url')).toBe('(invalid url)');
        });
    });

    describe('GET /api/chains', () => {
        it('lists all chains with status', async () => {
            const ethCtx = createMockChainContext({ name: 'eth', displayName: '[ETH]' });
            const bscCtx = createMockChainContext({
                name: 'bsc',
                displayName: '[BSC]',
                chainId: 56,
                httpRpcUrl: 'https://bsc-rpc.example.com/key',
            });

            app.use('/api/chains', chainRoutes([ethCtx, bscCtx], stoppedChains));

            const res = await request(app, 'GET', '/api/chains');
            expect(res.status).toBe(200);
            expect(res.body.chains).toHaveLength(2);

            const ethChain = res.body.chains.find((c: any) => c.name === 'eth');
            expect(ethChain).toBeDefined();
            expect(ethChain.status).toBe('running');
            expect(ethChain.displayName).toBe('[ETH]');
            expect(ethChain.snipeParams.snipeAmount).toBe('0.01');
            expect(ethChain.snipeParams.maxCapital).toBe('1.0');
            expect(ethChain.connection.rpcUrl).toBe('eth-mainnet.g.alchemy.com');
            expect(ethChain.connection.lastBlock).toBe(12345678);
            expect(ethChain.exitStrategy.trailingStopPct).toBe(15);
            expect(ethChain.exitStrategy.stopLossPct).toBe(25);

            const bscChain = res.body.chains.find((c: any) => c.name === 'bsc');
            expect(bscChain).toBeDefined();
            expect(bscChain.status).toBe('running');
            expect(bscChain.connection.rpcUrl).toBe('bsc-rpc.example.com');
        });

        it('shows disconnected status when provider fails', async () => {
            const ctx = createDisconnectedChainContext({ name: 'eth' });
            app.use('/api/chains', chainRoutes([ctx], stoppedChains));

            const res = await request(app, 'GET', '/api/chains');
            expect(res.status).toBe(200);
            expect(res.body.chains[0].status).toBe('disconnected');
        });

        it('shows stopped status when chain is in stoppedChains', async () => {
            const ctx = createMockChainContext({ name: 'eth' });
            stoppedChains.add('eth');
            app.use('/api/chains', chainRoutes([ctx], stoppedChains));

            const res = await request(app, 'GET', '/api/chains');
            expect(res.status).toBe(200);
            expect(res.body.chains[0].status).toBe('stopped');
        });
    });

    describe('POST /api/chains/:name/stop', () => {
        it('returns 200 and marks chain stopped', async () => {
            const ctx = createMockChainContext({ name: 'eth' });
            const removeAllListeners = vi.fn();
            (ctx.wsProvider as any).removeAllListeners = removeAllListeners;
            app.use('/api/chains', chainRoutes([ctx], stoppedChains));

            const res = await request(app, 'POST', '/api/chains/eth/stop');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.status).toBe('stopped');
            expect(stoppedChains.has('eth')).toBe(true);
            expect(removeAllListeners).toHaveBeenCalled();
        });

        it('returns 404 for unknown chain', async () => {
            const ctx = createMockChainContext({ name: 'eth' });
            app.use('/api/chains', chainRoutes([ctx], stoppedChains));

            const res = await request(app, 'POST', '/api/chains/polygon/stop');
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Chain not found');
        });

        it('returns 400 when chain already stopped', async () => {
            const ctx = createMockChainContext({ name: 'eth' });
            stoppedChains.add('eth');
            app.use('/api/chains', chainRoutes([ctx], stoppedChains));

            const res = await request(app, 'POST', '/api/chains/eth/stop');
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Chain already stopped');
        });
    });

    describe('POST /api/chains/:name/start', () => {
        it('removes chain from stopped set', async () => {
            const ctx = createMockChainContext({ name: 'eth' });
            stoppedChains.add('eth');
            app.use('/api/chains', chainRoutes([ctx], stoppedChains));

            const res = await request(app, 'POST', '/api/chains/eth/start');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.status).toBe('running');
            expect(stoppedChains.has('eth')).toBe(false);
        });

        it('returns 404 for unknown chain', async () => {
            const ctx = createMockChainContext({ name: 'eth' });
            app.use('/api/chains', chainRoutes([ctx], stoppedChains));

            const res = await request(app, 'POST', '/api/chains/polygon/start');
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Chain not found');
        });

        it('returns 400 when chain is already running', async () => {
            const ctx = createMockChainContext({ name: 'eth' });
            app.use('/api/chains', chainRoutes([ctx], stoppedChains));

            const res = await request(app, 'POST', '/api/chains/eth/start');
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Chain is already running');
        });

        it('returns warnings array from onRestart callback (D-12)', async () => {
            const ctx = createMockChainContext({ name: 'eth' });
            stoppedChains.add('eth');

            const onRestart = vi.fn().mockResolvedValue({
                warnings: ['MEV unreachable', 'DEX uniswap-v3 failed to restart'],
            });

            app.use('/api/chains', chainRoutes([ctx], stoppedChains, onRestart));

            const res = await request(app, 'POST', '/api/chains/eth/start');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.status).toBe('running');
            expect(res.body.warnings).toEqual(['MEV unreachable', 'DEX uniswap-v3 failed to restart']);
            expect(onRestart).toHaveBeenCalledOnce();
        });

        it('returns empty warnings array on successful restart', async () => {
            const ctx = createMockChainContext({ name: 'eth' });
            stoppedChains.add('eth');

            const onRestart = vi.fn().mockResolvedValue({ warnings: [] });
            app.use('/api/chains', chainRoutes([ctx], stoppedChains, onRestart));

            const res = await request(app, 'POST', '/api/chains/eth/start');
            expect(res.status).toBe(200);
            expect(res.body.warnings).toEqual([]);
        });

        it('returns warning about needing bot restart when no onRestart callback', async () => {
            const ctx = createMockChainContext({ name: 'eth' });
            stoppedChains.add('eth');

            // No onRestart passed
            app.use('/api/chains', chainRoutes([ctx], stoppedChains));

            const res = await request(app, 'POST', '/api/chains/eth/start');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.warnings).toBeInstanceOf(Array);
            expect(res.body.warnings.length).toBeGreaterThan(0);
            expect(res.body.warnings[0]).toContain('restart');
        });
    });
});
