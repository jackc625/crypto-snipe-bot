// test/realpath/triage/fixtures/AUD-BUY-011-dashboard.ts
// Plan 23-06 Task 3 fixture (not a test file): the real dashboard API server on a loopback port,
// driven over real HTTP with the real login flow, for AUD-BUY-011. Lives beside its test (the
// harness is read-only for triage plans).
//
// The server is the real src/api/server.ts startApiServer, imported from the scenario's own module
// graph, bound to 127.0.0.1; calls go through node:http with no keep-alive agent (never axios: the
// realpath setup routes axios to the harness, so a call through it would never reach the real
// route). Real loopback is allowed by the rails (D-02 limits only crash tests).
//
// The port (review WR-20). The preferred setting is DASHBOARD_PORT=0 (LOOPBACK_DASHBOARD_ENV): the
// real server binds a port the OS assigns at listen time, so there is no gap between picking a port
// and binding it in which another parallel worker's server can take it. Either way startDashboard
// identifies the server this call bound through Node's own tracing:net.server.listen diagnostics
// channel (it observes the listen and mocks nothing, as fixtures/AUD-API-002-restart.ts does), reads
// the port from that server's own address(), and talks only to it: /health, login and every route
// reach this test's server, never another test's dashboard that shares the sentinel API key and
// chain name. A listen that fails (EADDRINUSE on a fixed port another worker took) is turned into a
// named startDashboard error instead of an uncaught exception in the worker (src/api/server.ts
// calls server.listen with no 'error' listener).

import * as dc from 'node:diagnostics_channel';
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

/** Env values that put the real dashboard on loopback at a port the OS assigns at listen time. */
export const LOOPBACK_DASHBOARD_ENV: Readonly<Record<string, string>> = { DASHBOARD_HOST: '127.0.0.1', DASHBOARD_PORT: '0' };

/**
 * A loopback port that was free a moment ago. Racy across parallel workers (another worker can bind
 * it before the server does): prefer LOOPBACK_DASHBOARD_ENV. Kept for callers that still pick a
 * port; startDashboard then checks that the server it started is the one on that port.
 */
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

const LISTEN_START = 'tracing:net.server.listen:asyncStart';
const LISTEN_ERROR = 'tracing:net.server.listen:error';

/**
 * Start the real API server (startApiServer from the scenario graph's own module registry) on
 * DASHBOARD_HOST:DASHBOARD_PORT, which the caller set before the graph loaded: 127.0.0.1 and port 0
 * (preferred, LOOPBACK_DASHBOARD_ENV) or a port picked free. The server this call bound is read from
 * the listen diagnostics channel and its own address(); its port is the one every call uses. Waits
 * until /health answers. The server is closed by a harness disposer.
 */
export async function startDashboard(startApiServer: (contexts: never[]) => { close: () => void }, contexts: unknown[]): Promise<Dashboard> {
    const host = process.env.DASHBOARD_HOST;
    const envPort = Number(process.env.DASHBOARD_PORT);
    if (host !== '127.0.0.1' || !Number.isInteger(envPort) || envPort < 0) throw new Error(`startDashboard: DASHBOARD_HOST/PORT must be 127.0.0.1 and 0 (or a free port), got ${String(host)}:${String(process.env.DASHBOARD_PORT)}`);
    // The server(s) that start listening during the startApiServer call, and any listen failure.
    // asyncStart is published synchronously inside server.listen (Node 22), so the call below is
    // the whole window; a test file's tests run one at a time in their worker, so nothing else in
    // this worker listens in it.
    const started: Array<{ server: net.Server; options: unknown }> = [];
    let listenError: unknown;
    const onStart = (m: unknown): void => {
        const { server, options } = m as { server: net.Server; options: unknown };
        started.push({ server, options });
        // An 'error' listener, so a failed listen is reported here instead of crashing the worker.
        server.once('error', (e: unknown) => (listenError = e));
    };
    const onError = (m: unknown): void => void (listenError = (m as { error?: unknown }).error ?? m);
    dc.subscribe(LISTEN_START, onStart);
    dc.subscribe(LISTEN_ERROR, onError);
    let handle: { close: () => void };
    try {
        handle = startApiServer(contexts as never[]);
    } finally {
        dc.unsubscribe(LISTEN_START, onStart);
    }
    harnessState().disposers.push(async () => handle.close());
    try {
        if (started.length !== 1) throw new Error(`startDashboard: expected startApiServer to start exactly one listen, saw ${started.length}`);
        const { server, options } = started[0];
        if (JSON.stringify(options) !== JSON.stringify({ port: envPort, host: '127.0.0.1' })) throw new Error(`startDashboard: the server listened with ${JSON.stringify(options)}, not 127.0.0.1:${envPort}`);
        // The bind is real I/O: turn the event loop (no timer) until it listens or fails.
        for (let i = 0; i < 2_000 && !server.listening && listenError === undefined; i++) await new Promise<void>((resolve) => REAL_SET_IMMEDIATE(resolve));
        if (listenError !== undefined) throw new Error(`startDashboard: the API server could not listen on 127.0.0.1:${envPort}: ${String((listenError as Error)?.message ?? listenError)}`);
        if (!server.listening) throw new Error('startDashboard: the API server never started listening');
        const addr = server.address() as net.AddressInfo;
        if (addr.address !== '127.0.0.1' || (envPort !== 0 && addr.port !== envPort)) throw new Error(`startDashboard: the API server is bound to ${addr.address}:${addr.port}, not 127.0.0.1:${envPort || '<os port>'}`);
        return await connectDashboard(addr.port);
    } finally {
        dc.unsubscribe(LISTEN_ERROR, onError);
    }
}

/** The real API server that `startDashboard` bound on `port`: wait until /health answers, then the client. */
async function connectDashboard(port: number): Promise<Dashboard> {
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
