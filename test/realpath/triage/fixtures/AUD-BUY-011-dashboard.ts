// test/realpath/triage/fixtures/AUD-BUY-011-dashboard.ts
// Plan 23-06 Task 3 fixture (not a test file): the real dashboard API server on a loopback port,
// driven over real HTTP with the real login flow, for AUD-BUY-011. Lives beside its test (the
// harness is read-only for triage plans).
//
// The server is the real src/api/server.ts startApiServer, imported from the scenario's own module
// graph, bound to 127.0.0.1 on a port picked free just before; calls go through node:http with no
// keep-alive agent (never axios: the realpath setup routes axios to the harness, so a call through
// it would never reach the real route). Real loopback is allowed by the rails (D-02 limits only
// crash tests).

import * as http from 'node:http';
import * as net from 'node:net';
import { vi } from 'vitest';
import { harnessState } from '../../harness/chain';

// The real setImmediate, captured when this module loads (before any scenario installs the fake
// clock, which also patches the timers module). A request to the real server can need the fake
// clock to move (the server's own RPC reads wait on ethers' fake drain timer) while its answer
// arrives as real I/O, so a waiting caller alternates one fake 10 ms step with one real turn of
// the event loop.
const REAL_SET_IMMEDIATE: (cb: () => void) => unknown = globalThis.setImmediate;

async function settleWithClock<T>(p: Promise<T>, what: string): Promise<T> {
    let done = false;
    let failed = false;
    let value!: T;
    let err: unknown;
    p.then(
        (v) => {
            done = true;
            value = v;
        },
        (e: unknown) => {
            done = true;
            failed = true;
            err = e;
        },
    );
    for (let i = 0; i < 20_000 && !done; i++) {
        if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
        await new Promise<void>((resolve) => REAL_SET_IMMEDIATE(resolve));
    }
    if (!done) throw new Error(`${what}: no answer after 20000 turns`);
    if (failed) throw err;
    return value;
}

export interface DashboardReply {
    status: number;
    body: unknown;
    setCookie: string[];
}

export interface Dashboard {
    readonly baseUrl: string;
    /** POST /api/auth/login with the configured DASHBOARD_API_KEY; returns the session cookie. */
    login(): Promise<string>;
    request(method: 'GET' | 'POST', urlPath: string, opts?: { cookie?: string; json?: unknown }): Promise<DashboardReply>;
}

/** A loopback port that was free a moment ago (the server binds it right after). */
export async function freeLoopbackPort(): Promise<number> {
    const srv = net.createServer();
    await new Promise<void>((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (srv.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    return port;
}

function call(port: number, method: string, urlPath: string, headers: Record<string, string>, body?: string): Promise<DashboardReply> {
    return settleWithClock(rawCall(port, method, urlPath, headers, body), `${method} ${urlPath}`);
}

function rawCall(port: number, method: string, urlPath: string, headers: Record<string, string>, body?: string): Promise<DashboardReply> {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent: false, headers: { connection: 'close', ...headers } }, (res) => {
            let text = '';
            res.on('data', (c: Buffer) => (text += c.toString('utf8')));
            res.on('end', () => {
                let parsed: unknown = text;
                try {
                    parsed = text === '' ? null : JSON.parse(text);
                } catch {
                    /* keep the text */
                }
                const raw = res.headers['set-cookie'];
                resolve({ status: res.statusCode ?? 0, body: parsed, setCookie: Array.isArray(raw) ? raw : raw ? [raw] : [] });
            });
        });
        req.on('error', reject);
        req.end(body);
    });
}

/**
 * Start the real API server (startApiServer from the scenario graph's own module registry) on
 * DASHBOARD_HOST:DASHBOARD_PORT, which the caller set to 127.0.0.1 and a free port before the
 * graph loaded. Waits until /health answers. The server is closed by a harness disposer.
 */
export async function startDashboard(startApiServer: (contexts: never[]) => { close: () => void }, contexts: unknown[]): Promise<Dashboard> {
    const host = process.env.DASHBOARD_HOST;
    const port = Number(process.env.DASHBOARD_PORT);
    if (host !== '127.0.0.1' || !Number.isInteger(port) || port <= 0) throw new Error(`startDashboard: DASHBOARD_HOST/PORT must be 127.0.0.1 and a free port, got ${String(host)}:${String(process.env.DASHBOARD_PORT)}`);
    const handle = startApiServer(contexts as never[]);
    harnessState().disposers.push(async () => handle.close());
    // Each refused connect is real I/O, so the event loop turns between attempts (no timer).
    let lastErr: unknown;
    for (let i = 0; i < 200; i++) {
        try {
            const r = await call(port, 'GET', '/health', {});
            if (r.status > 0) {
                lastErr = undefined;
                break;
            }
        } catch (e) {
            lastErr = e;
        }
    }
    if (lastErr !== undefined) throw new Error(`startDashboard: the API server never answered on 127.0.0.1:${port}: ${String(lastErr)}`);
    const request: Dashboard['request'] = (method, urlPath, opts = {}) => {
        const headers: Record<string, string> = {};
        if (opts.cookie) headers.cookie = opts.cookie;
        let body: string | undefined;
        if (opts.json !== undefined) {
            body = JSON.stringify(opts.json);
            headers['content-type'] = 'application/json';
            headers['content-length'] = String(Buffer.byteLength(body));
        }
        return call(port, method, urlPath, headers, body);
    };
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        request,
        async login(): Promise<string> {
            const r = await request('POST', '/api/auth/login', { json: { apiKey: process.env.DASHBOARD_API_KEY } });
            if (r.status !== 200) throw new Error(`login: HTTP ${r.status} ${JSON.stringify(r.body)}`);
            const session = r.setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('session='));
            if (!session) throw new Error(`login: no session cookie in ${JSON.stringify(r.setCookie)}`);
            return session;
        },
    };
}
