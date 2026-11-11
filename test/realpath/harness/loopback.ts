// test/realpath/harness/loopback.ts
// Phase 23 plan 23-27 (CHAR-01): one simulated node a real child process can reach.
//
//   - serveLoopback(node): one real `http` server and one real `ws` WebSocketServer, each on
//     127.0.0.1 port 0, handing every JSON-RPC body (single or batch, as ethers sends both) to the
//     same FakeNode.handle the in-process seam uses. A child process started with these URLs sees
//     the same chain as the test: the same blocks, nonces, logs and subscriptions.
//   - Each real socket passes its own `connection` to node.handle, the same argument an
//     in-process FakeWebSocket passes, so eth_chainId, eth_subscribe and eth_unsubscribe run the
//     same node code on either transport, and emitLogs / mine push each eth_subscription
//     notification through the socket its subscription belongs to (plan 23-28's filter rules).
//     When a socket closes its subscriptions are removed (FakeNode.detachConnection), and a push
//     to a socket that is not open is recorded as a stray, so a dead socket can never swallow a
//     notification silently.
//   - runRailedChildToEnd(cmd, args, opts): starts the child only through spawnRailedChildAsync
//     (the railed spawner: sentinel env, rails preload, loopback-only network) and resolves
//     { status, signal, stdout, stderr } when it closes. The parent's event loop keeps serving the
//     node while the child runs, which the blocking spawnRailedChild could not do.
//   - The server side needs no timer: WebSocketServer defaults to allowSynchronousEvents, so a
//     real socket works under the fixed clock (measured, 23-27 plan context).
//
// Both the servers and any child still running are closed by the harness disposers, newest
// first, in afterEach.

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { killProcessTree, spawnRailedChildAsync, type SpawnRailedOptions } from '../../rails/spawnRailedChild';
import { harnessState, nextSeq, type Connection, type FakeNode } from './chain';

export interface Loopback {
    /** http://127.0.0.1:<port>/ : JSON-RPC over HTTP (POST to / only). */
    readonly httpUrl: string;
    /** ws://127.0.0.1:<port>/ : JSON-RPC over a real WebSocket. */
    readonly wsUrl: string;
    /** Sockets open right now. */
    readonly openSockets: number;
    /** Sockets ever accepted. */
    readonly socketsAccepted: number;
    /** Socket-level errors seen (for example a reset when a child dies), in order. */
    readonly socketErrors: readonly string[];
    /** Resolves when no socket is open, from the close events themselves (no timer). */
    whenSocketsClosed(): Promise<void>;
    /** Terminate every socket and close both servers. Idempotent; awaited by the disposer. */
    close(): Promise<void>;
}

function listen(server: http.Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
}

/** Serve `node` on real loopback HTTP and WebSocket ports. */
export async function serveLoopback(node: FakeNode): Promise<Loopback> {
    const st = harnessState();
    const stray = (url: string, detail: string): void => {
        node.strays.push({ seq: nextSeq(), kind: 'url', url, detail });
    };

    let httpUrl = '';
    const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            const reply = (status: number, body: string): void => {
                res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
                res.end(body);
            };
            if (req.method !== 'POST' || (req.url ?? '/') !== '/') {
                stray(`${httpUrl.replace(/\/$/, '')}${req.url ?? ''}`, `unknown loopback request ${String(req.method)} ${String(req.url)} (HTTP)`);
                reply(404, JSON.stringify({ error: 'not found' }));
                return;
            }
            const text = Buffer.concat(chunks).toString('utf8');
            node.handle(text, undefined, { endpoint: 'rpc', url: httpUrl }).then(
                (answer) => reply(200, answer === undefined ? '' : JSON.stringify(answer)),
                (e: unknown) => {
                    stray(httpUrl, `harness error answering a loopback HTTP body: ${e instanceof Error ? e.message : String(e)}`);
                    reply(500, JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'internal error' } }));
                },
            );
        });
    });
    await listen(server);
    httpUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve, reject) => {
        wss.once('error', reject);
        wss.once('listening', () => {
            wss.off('error', reject);
            resolve();
        });
    });
    const wsUrl = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/`;

    const sockets = new Set<WebSocket>();
    const socketErrors: string[] = [];
    const closedWaiters: Array<() => void> = [];
    let accepted = 0;
    const wakeClosed = (): void => {
        if (sockets.size > 0) return;
        for (const w of closedWaiters.splice(0)) w();
    };

    wss.on('connection', (socket, req) => {
        accepted += 1;
        sockets.add(socket);
        if ((req.url ?? '/') !== '/') stray(`${wsUrl.replace(/\/$/, '')}${req.url ?? ''}`, `unknown loopback WebSocket path ${String(req.url)}`);
        const connection: Connection = {
            send(text: string): void {
                if (socket.readyState !== WebSocket.OPEN) {
                    stray(wsUrl, `a push to a loopback socket that is not open (readyState ${socket.readyState}): ${text.slice(0, 160)}`);
                    return;
                }
                socket.send(text);
            },
        };
        // The route: every frame is one JSON-RPC body (single or batch) for the same node code
        // the in-process seam runs, with this socket's own connection, so a subscription it
        // opens is pushed back through this socket and no other.
        socket.on('message', (data, isBinary) => {
            const text = isBinary ? '' : Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
            if (isBinary) {
                stray(wsUrl, 'a binary frame on the loopback socket (JSON-RPC is text)');
                return;
            }
            node.handle(text, connection, { endpoint: 'ws', url: wsUrl }).then(
                (answer) => {
                    if (answer !== undefined) connection.send(JSON.stringify(answer));
                },
                (e: unknown) => stray(wsUrl, `harness error answering a loopback WebSocket frame: ${e instanceof Error ? e.message : String(e)}`),
            );
        });
        socket.on('error', (e: Error) => socketErrors.push(e.message));
        socket.on('close', () => {
            node.detachConnection(connection);
            sockets.delete(socket);
            wakeClosed();
        });
    });

    let closing: Promise<void> | null = null;
    const close = (): Promise<void> => {
        if (closing) return closing;
        closing = (async () => {
            for (const s of sockets) s.terminate();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
        })();
        return closing;
    };
    st.disposers.push(close);

    return {
        httpUrl,
        wsUrl,
        get openSockets() {
            return sockets.size;
        },
        get socketsAccepted() {
            return accepted;
        },
        socketErrors,
        whenSocketsClosed(): Promise<void> {
            if (sockets.size === 0) return Promise.resolve();
            return new Promise((resolve) => closedWaiters.push(resolve));
        },
        close,
    };
}

/** The railed child type, named without importing a process module (spawn gate, 22-11). */
export type RailedChild = ReturnType<typeof spawnRailedChildAsync>;

export interface ChildRun {
    status: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
}

/**
 * Start a railed child (spawnRailedChildAsync, so every limit and the rails apply) and resolve
 * when it closes, with everything it wrote. A child still running at teardown is killed by the
 * disposer and fails the test by name: a proof must wait for its child.
 */
export function runRailedChildToEnd(cmd: string, args: string[], opts: SpawnRailedOptions = {}): Promise<ChildRun> {
    const child: RailedChild = spawnRailedChildAsync(cmd, args, opts);
    let stdout = '';
    let stderr = '';
    let ended = false;
    child.stdout?.on('data', (c: Buffer) => {
        stdout += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
        stderr += c.toString('utf8');
    });
    const done = new Promise<ChildRun>((resolve, reject) => {
        child.once('error', (e) => {
            ended = true;
            reject(new Error(`runRailedChildToEnd: the child could not run: ${e.message}`));
        });
        child.once('close', (status, signal) => {
            ended = true;
            resolve({ status, signal, stdout, stderr });
        });
    });
    harnessState().disposers.push(async () => {
        if (ended) return;
        if (child.pid !== undefined) killProcessTree(child.pid);
        await done.catch(() => undefined);
        throw new Error(`runRailedChildToEnd: a railed child (${cmd} ${args.join(' ')}) was still running at teardown and was killed; stdout so far: ${stdout.slice(-400)}`);
    });
    return done;
}
