// test/realpath/triage/fixtures/hostHeaderCrash.ts
// Phase 23 plan 23-12 Task 3 (AUDIT-02, D-08): AUD-API-008 as a real process death.
// Started only by test/realpath/triage/AUD-API-008.test.ts through spawnRailedChild:
//   node -r ts-node/register/transpile-only <this file> <mode>
//
// The finding: the dashboard's WebSocket upgrade handler (src/api/ws/handler.ts) parses the Host
// header with new URL() before any check and outside any try; src/api/server.ts registers it as
// the http server's 'upgrade' listener, so a malformed Host throws out of the listener as an
// uncaught exception and the whole bot process exits. No credentials are needed.
//
// What runs: the real startApiServer([]) (src/api/server.ts), which registers the real
// handleUpgrade, bound to a free loopback port (bind port 0, read it, close it; DASHBOARD_PORT and
// DASHBOARD_HOST=127.0.0.1 are set on process.env, because startApiServer returns only close and
// cannot report a port-0 assignment). Its own log "Dashboard API server started" shows it is
// listening. Then this child itself opens a raw TCP connection with Node's net module (the parent
// is blocked inside spawnRailedChild while the child runs) and sends GET /ws with Upgrade:
// websocket and a Host header:
//   fault      Host "a b" (a raw client can send it; a browser cannot);
//   healthy    Host "127.0.0.1:<port>", which the real handler answers 401 (no session);
//   contained  fault, with process handlers registered first.
// RAW_REQUEST_SENT is printed when the request is written, RAW_RESPONSE <status line> when the
// server answers, RAW_SOCKET_CLOSED when the server ends the connection.
//
// Work under test: the request. WORK_SETTLED once the server has answered it or closed the
// connection; WORK_PENDING if it has done neither by the end of the window. Survival window:
// WINDOW_MS of real time after the send.

import * as net from 'node:net';
import { finishAlive, freePort, installContainment, mark, parseMode, runFixture, setupError, sleep, startLoopbackChain, startTicker } from './loopbackChain';

const WINDOW_MS = 3_000;

function connect(port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        const s = net.connect({ host: '127.0.0.1', port });
        s.once('connect', () => resolve(s));
        s.once('error', reject);
    });
}

async function main(): Promise<void> {
    const mode = parseMode(process.argv[2]);
    if (mode === 'contained') installContainment();

    const chain = await startLoopbackChain();
    const port = await freePort();
    process.env.ETH_RPC_URL = chain.httpUrl;
    process.env.ETH_WS_URL = '';
    process.env.DB_PATH = ':memory:';
    process.env.DASHBOARD_PORT = String(port);
    process.env.DASHBOARD_HOST = '127.0.0.1';

    await import('../../../../src/main');
    await import('../../../../src/bot');
    const reg = await import('../../../../src/chainRegistry');
    const cfg = reg.buildChainRegistry().get('eth');
    if (!cfg) return setupError('the real registry has no eth chain');
    const ctx = reg.createChainContext(cfg);
    const { startApiServer } = await import('../../../../src/api/server');
    startApiServer([]);

    // Wait until the real server accepts connections (its listen is asynchronous).
    let sock: net.Socket | null = null;
    const end = Date.now() + 10_000;
    while (!sock) {
        try {
            sock = await connect(port);
        } catch {
            if (Date.now() > end) return setupError(`the real API server never listened on 127.0.0.1:${port}`);
            await sleep(25);
        }
    }

    const host = mode === 'healthy' ? `127.0.0.1:${port}` : 'a b';
    let answered = false;
    let closed = false;
    let buffered = '';
    sock.on('data', (chunk: Buffer) => {
        buffered += chunk.toString('latin1');
        if (!answered && buffered.includes('\r\n')) {
            answered = true;
            mark(`RAW_RESPONSE ${buffered.split('\r\n')[0]}`);
        }
    });
    sock.on('close', () => {
        closed = true;
        mark('RAW_SOCKET_CLOSED');
    });
    sock.on('error', () => {
        /* a reset is seen as the close that follows */
    });

    const ticker = startTicker();
    sock.write(
        'GET /ws HTTP/1.1\r\n' +
            `Host: ${host}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            '\r\n',
    );
    mark('RAW_REQUEST_SENT');
    await sleep(WINDOW_MS);
    await finishAlive(ticker, () => ctx.httpProvider.getBlockNumber(), answered || closed);
}

runFixture(main);
