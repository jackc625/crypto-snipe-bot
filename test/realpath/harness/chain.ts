// test/realpath/harness/chain.ts
// Phase 23 plan 23-01 (CHAR-01, AC-01, AC-03): the fake chain under the real-path harness.
//
// What lives here:
//   - harnessState(): the one globalThis-anchored state object. vi.resetModules() re-evaluates
//     harness modules loaded through Vitest, so any module-level state would split between the
//     copy a test imported and the copy a mock factory reloads. Everything shared lives here.
//   - installSeams(): attaches the fake transport to REAL ethers and proves it attached (D-01 as
//     corrected, SPEC Amendment A-4). The realpath Vitest project aliases `ethers` to its CJS
//     build, so src/, this file and @flashbots/ethers-provider-bundle share one FetchRequest; the
//     WebSocket swap targets the ws copy nested inside ethers, which is the only one ethers reads.
//     A seam that does not attach throws an error containing "did not reach".
//   - FakeWebSocket: replaces ws.WebSocket inside ethers. In-process, no socket is opened.
//   - FakeNode: a small simulated node (D-03). It parses the real signed bytes with real
//     Transaction.from, computes the real hash, mines only on command and returns real-shaped
//     receipts. Contract reads come from a per-scenario table built with real ethers encoders
//     (D-04); a read, method or URL it does not know is recorded as a stray and fails the test in
//     afterEach (AC-03), because a caller's catch can swallow the returned error.
//     failNext() and hold() name the exact operation they target (method, selector, target,
//     stage); one that never fires fails the test in afterEach (assertAllFaultsFired).
//   - Relay answers go out as HTTP 200 with a JSON-RPC body, unless a setRelay handler returns
//     `{ http: { status, body } }`: then that status and that raw body are sent as they are (plan
//     23-15 harness gap: a live relay refuses with a non-2xx status, which the Flashbots library
//     throws on, and a 200 cannot show that).
//
// Transaction state (plan 23-28 Task 1), per account and explicit:
//   - `latest` counts mined transactions only; `pending` adds the public pool's contiguous run. A
//     relay acceptance (bundle, bloXroute) changes no count and a receipt is a valid null until
//     mine() includes that hash (review HIGH on 23-01: production stops retrying once `latest`
//     moves, src/utils/mevStrategies/reconciliation.ts:478).
//   - eth_sendRawTransaction admits with a geth node's checks and text: chain ID, nonce too low,
//     intrinsic gas, funds, the 10 percent same-nonce replacement bump, and a future nonce that
//     is queued (or refused with `nonce too high` under setFutureNoncePolicy('reject')).
//   - mine() takes named hashes or the includable public pool; another transaction at a nonce it
//     consumes is dropped; neverMine() and `exclude` keep hashes out. Every transition is in
//     `history`, in order.

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { STATUS_CODES } from 'node:http';
import {
    ethers,
    AbiCoder,
    FetchRequest,
    FunctionFragment,
    Transaction,
    getAddress,
    keccak256,
    toQuantity,
    concat,
    toUtf8Bytes,
} from 'ethers';
import type { Timeline } from './capture';

// ---------------------------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------------------------

export const HARNESS_KEY = Symbol.for('csb.realpath.harness');

export interface LogSinkEntry {
    seq: number;
    level: string;
    bindings: Record<string, unknown>;
    obj: Record<string, unknown> | undefined;
    msg: string | undefined;
}

/** One notifier call, in call order, with the exact text the caller passed (plan 23-02). */
export interface AlertEntry {
    /** Which notifier function: sendTelegramAlert, sendChainAlert or sendCtxAlert. */
    via: 'telegram' | 'chain' | 'ctx';
    /** The chain display name (sendChainAlert), ctx.chain.name (sendCtxAlert), or null. */
    chain: string | null;
    message: unknown;
}

/** A capture problem, kept out of band so production catches cannot hide it (capture.ts). */
export type Violation =
    | { kind: 'db-transaction-open'; table: string; op: 'insert' | 'update' | 'delete' }
    | { kind: 'unixepoch-argument'; args: unknown[] }
    | { kind: 'capture-error'; message: string };

export interface Stray {
    seq: number;
    kind: 'method' | 'read' | 'url';
    method?: string;
    url?: string;
    to?: string;
    selector?: string;
    detail: string;
}

export interface HttpRoute {
    prefix: string;
    handler: HttpHandler;
}

export interface HttpRequestInfo {
    method: string;
    url: string;
    data: unknown;
    config: unknown;
}

export interface HttpReply {
    status?: number;
    data: unknown;
    headers?: Record<string, string>;
}

export type HttpHandler = (req: HttpRequestInfo) => HttpReply | Promise<HttpReply>;

/**
 * One handler registered on the Telegram client fake (setup.ts): the callback the real
 * src/telegramListener.ts passes to addEventHandler, the event builder it passed with it, and the
 * client it was registered on (plan 23-27). telegram.ts delivers to these.
 */
export interface TelegramHandlerEntry {
    handler: unknown;
    builder: unknown;
    client: unknown;
}

export interface HarnessState {
    seq: number;
    seamsInstalled: boolean;
    getUrlInstalled: boolean;
    /** The node every transport routes to right now (one scenario at a time per worker). */
    node: FakeNode | null;
    /** Every node created in the current test, for the afterEach stray and fault checks. */
    nodes: FakeNode[];
    /** Strays seen while no node was current. */
    orphanStrays: Stray[];
    /** Every log call, with or without an `op` field (capture.ts recordedLogs). */
    logs: LogSinkEntry[];
    /** Every notifier call (capture.ts recordedAlerts). Never on the timeline. */
    alerts: AlertEntry[];
    broadcasts: Array<{ seq: number; type: string; data: unknown }>;
    httpRoutes: HttpRoute[];
    /** Every axios call; `params` is the request's axios `params` (the query string), as given. */
    httpLog: Array<{ seq: number; method: string; url: string; data: unknown; params?: unknown; matched: boolean }>;
    /** The Telegram client fake's record: every client built and every handler registered, in order. */
    telegram: { clients: unknown[]; handlers: TelegramHandlerEntry[] };
    /** Awaited by disposeScenarios() in reverse order. */
    disposers: Array<() => Promise<void>>;
    /** Set by world.ts; the axios mock in setup.ts delegates to it. */
    routeAxios: ((method: string, url: string, data: unknown, config: unknown) => Promise<unknown>) | null;
    /** The ordered timeline every feed appends to; createScenario starts a fresh one (capture.ts). */
    timeline: Timeline | null;
    /** Capture violations, checked by assertNoViolations() in afterEach (capture.ts). */
    violations: Violation[];
    /** Folders made by world.ts createTempDbFile, each removed by its disposer (plan 23-27). */
    tempDbDirs: string[];
    /**
     * True while world.ts restartGraph stops the old graph. Only the old graph runs then, so the
     * setup.ts logger, notifier and broadcaster drop every call, as a killed process records
     * nothing (Phase 23 review WR-06).
     */
    stoppingGraph: boolean;
}

export function harnessState(): HarnessState {
    const g = globalThis as unknown as Record<symbol, HarnessState | undefined>;
    let st = g[HARNESS_KEY];
    if (!st) {
        st = {
            seq: 0,
            seamsInstalled: false,
            getUrlInstalled: false,
            node: null,
            nodes: [],
            orphanStrays: [],
            logs: [],
            alerts: [],
            broadcasts: [],
            httpRoutes: [],
            httpLog: [],
            telegram: { clients: [], handlers: [] },
            disposers: [],
            routeAxios: null,
            timeline: null,
            violations: [],
            tempDbDirs: [],
            stoppingGraph: false,
        };
        g[HARNESS_KEY] = st;
    }
    return st;
}

export function nextSeq(): number {
    const st = harnessState();
    st.seq += 1;
    return st.seq;
}

// ---------------------------------------------------------------------------------------------
// Real encoders (D-04)
// ---------------------------------------------------------------------------------------------

const coder = AbiCoder.defaultAbiCoder();
const ERROR_STRING = new ethers.Interface(['function Error(string)']);

/** ABI-encode return data with the real ethers coder. */
export function encodeResult(types: readonly string[], values: readonly unknown[]): string {
    return coder.encode(types as string[], values as unknown[]);
}

/** A revert carrying `data` (already ABI-encoded custom error or Error(string)). */
export function revertWith(data: string): ReadRevert {
    return { revert: data };
}

/** A revert with the standard Error(string) payload, as a require(..., "msg") produces. */
export function revertReason(message: string): ReadRevert {
    return { revert: ERROR_STRING.encodeFunctionData('Error', [message]) };
}

/** A revert with no data, as calling a function the contract does not have produces. */
export const REVERT_EMPTY: ReadRevert = Object.freeze({ revert: '0x' });

// ---------------------------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------------------------

// Every createRequire call uses a literal specifier (test/unit/rails/spawnSites.test.ts:120-128).
const req = createRequire(import.meta.url);

export interface InstallSeamsOptions {
    /**
     * Self-test hook (plan 23-01 Task 2): the ws module object to swap. Defaults to the ws copy
     * nested inside ethers. Passing a module object ethers does not read proves the self-check
     * throws instead of passing silently. This injects an object, never a specifier.
     */
    wsExports?: { WebSocket: unknown };
}

/**
 * Attach the fake transport to real ethers and prove it attached. Idempotent per worker.
 * Throws an error containing "did not reach" when any seam misses.
 */
export function installSeams(opts: InstallSeamsOptions = {}): void {
    const st = harnessState();
    if (st.seamsInstalled && opts.wsExports === undefined) return;

    // 1. The alias: the ethers this file imports (through the realpath project alias, the same
    //    resolution src/ gets) must be the CJS build that require() and the Flashbots library load.
    const ethersCjs = req('ethers') as { FetchRequest: unknown };
    if (FetchRequest !== ethersCjs.FetchRequest) {
        throw new Error('realpath harness: the ethers alias did not reach this module: two ethers copies are loaded (is the realpath project alias missing?)');
    }
    const flashbotsEthers = createRequire(req.resolve('@flashbots/ethers-provider-bundle'))('ethers') as { FetchRequest: unknown };
    if (flashbotsEthers.FetchRequest !== FetchRequest) {
        throw new Error('realpath harness: the ethers alias did not reach @flashbots/ethers-provider-bundle: it loads a second ethers copy');
    }

    // 2. HTTP: one getUrl hook for every FetchRequest in the shared copy (RPC and relay).
    if (!st.getUrlInstalled) {
        FetchRequest.registerGetUrl(fetchHook as never);
        st.getUrlInstalled = true;
    }
    const probeRequest = new FetchRequest('http://127.0.0.1:1/');
    if (probeRequest.getUrlFunc !== (fetchHook as unknown)) {
        throw new Error('realpath harness: the HTTP getUrl hook did not reach ethers FetchRequest');
    }

    // 3. WebSocket: swap on the target module, then prove ethers constructed the class this call
    //    installed (a fresh subclass, so an earlier successful swap cannot mask a miss).
    const target = opts.wsExports ?? (createRequire(req.resolve('ethers'))('ws') as { WebSocket: unknown });
    const previous = target.WebSocket;
    class SeamProbe extends FakeWebSocket {}
    target.WebSocket = SeamProbe;
    let reached = false;
    let probeSocket: unknown;
    try {
        const probe = new ethers.WebSocketProvider('ws://127.0.0.1:1', 1);
        probeSocket = probe.websocket;
        reached = probeSocket instanceof SeamProbe;
        // The probe is destroyed while its socket is still CONNECTING, which emits 'error' as ws
        // does (WR-03); the harness's own probe listens for it, so nothing is thrown.
        if (probeSocket instanceof EventEmitter) probeSocket.on('error', () => undefined);
        void probe.destroy();
    } finally {
        FakeWebSocket.instances.splice(0, FakeWebSocket.instances.length, ...FakeWebSocket.instances.filter((w) => w !== probeSocket));
    }
    if (!reached) {
        target.WebSocket = previous;
        throw new Error('realpath harness: the WebSocket swap did not reach ethers (ethers constructed a socket class this swap did not install)');
    }
    target.WebSocket = FakeWebSocket;
    if (opts.wsExports === undefined) st.seamsInstalled = true;
}

interface GetUrlRequest {
    url: string;
    method: string;
    body: Uint8Array | null;
}

interface GetUrlResponse {
    statusCode: number;
    statusMessage: string;
    headers: Record<string, string>;
    body: Uint8Array;
}

function jsonResponse(payload: unknown, statusCode = 200, statusMessage = 'OK'): GetUrlResponse {
    return {
        statusCode,
        statusMessage,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(payload), 'utf8'),
    };
}

async function fetchHook(request: GetUrlRequest): Promise<GetUrlResponse> {
    const st = harnessState();
    const url = request.url;
    const node = st.node;
    const endpoint = node?.endpointOf(url, 'http');
    if (!node || endpoint === undefined) {
        const stray: Stray = { seq: nextSeq(), kind: 'url', url, detail: `unknown URL ${url} (FetchRequest ${request.method || 'GET'})` };
        if (node) node.strays.push(stray);
        else st.orphanStrays.push(stray);
        return jsonResponse({ error: 'not found' }, 404, 'Not Found');
    }
    const text = request.body ? Buffer.from(request.body).toString('utf8') : '';
    const reply = await node.handle(text, undefined, { endpoint, url });
    // A relay handler's http answer: its own status, headers and raw body (plan 23-15 harness gap).
    if (isRelayHttpReply(reply)) {
        return { statusCode: reply.status, statusMessage: reply.statusMessage, headers: { ...reply.headers }, body: Buffer.from(reply.body, 'utf8') };
    }
    return jsonResponse(reply);
}

// ---------------------------------------------------------------------------------------------
// FakeWebSocket
// ---------------------------------------------------------------------------------------------

/** The server-side end of a connection: send(text) delivers a message to the client. */
export interface Connection {
    send(text: string): void;
    readonly socket?: FakeWebSocket;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/**
 * Replaces ws.WebSocket inside ethers. Members are those ethers and src/ use: on, once, off,
 * send, ping, terminate, close, readyState, onopen, onmessage, onclose, onerror (src/ calls
 * `.websocket.on('close' | 'pong')`, `ping()` and `terminate()` directly).
 *
 * Off the OPEN path it follows ws 8.17.1 (node_modules/ethers/node_modules/ws/lib/websocket.js,
 * the copy production loads; Phase 23 review WR-03):
 *   - send(data, options?, cb?) and ping(data?, mask?, cb?) throw only while CONNECTING. On
 *     CLOSING or CLOSED the frame is dropped and a callback, if given, gets "WebSocket is not
 *     open: readyState N (NAME)" on the next tick (ws sendAfterClose). So a request ethers writes
 *     to a dropped socket hangs, as in production, instead of rejecting.
 *   - close() or terminate() while CONNECTING goes CLOSING at once, then on the next tick emits
 *     'error' ("WebSocket was closed before the connection was established") and 'close' 1006
 *     (ws abortHandshake). With no 'error' listener and no onerror, that 'error' throws, as an
 *     EventEmitter does in ws: the uncaught exception behind AUD-ANTIRUG-002.
 *   - FakeNode.hangSocketOpens(true) keeps new sockets CONNECTING (a stalled handshake).
 * Timing: the handshake, a reply to send(), every push the node makes (subscription messages
 * from mine() or emitLogs()) and a server close (dropSocket()) arrive on the microtask queue,
 * never inside the call that caused them, as on ws, where they come from socket I/O. Until a
 * server close arrives the socket still reads OPEN, as ws's does until its 'close' event.
 */
export class FakeWebSocket extends EventEmitter {
    static readonly CONNECTING = CONNECTING;
    static readonly OPEN = OPEN;
    static readonly CLOSING = CLOSING;
    static readonly CLOSED = CLOSED;
    /** Every socket constructed since the last scenario teardown. */
    static instances: FakeWebSocket[] = [];

    readonly url: string;
    readonly connection: Connection;
    onopen: ((ev: { type: string; target: FakeWebSocket }) => void) | null = null;
    onmessage: ((ev: { data: string; type: string; target: FakeWebSocket }) => void) | null = null;
    onclose: ((ev: { code: number; reason: string; wasClean: boolean; type: string; target: FakeWebSocket }) => void) | null = null;
    onerror: ((ev: { error: Error; message: string; type: string; target: FakeWebSocket }) => void) | null = null;
    /** Written by src/anti-rug/detector.ts heartbeat code. */
    isAlive?: boolean;
    #state = CONNECTING;
    #node: FakeNode | null = null;
    #openHeld = false;

    constructor(url: string | URL, _protocols?: unknown, _options?: unknown) {
        super();
        this.url = String(url);
        const self = this;
        this.connection = {
            send(text: string): void {
                // A push reaches the client after the call that made it, as socket I/O does.
                queueMicrotask(() => self.#deliver(text));
            },
            socket: this,
        };
        FakeWebSocket.instances.push(this);
        queueMicrotask(() => this.#open());
    }

    get readyState(): number {
        return this.#state;
    }

    #open(): void {
        if (this.#state !== CONNECTING) return;
        const st = harnessState();
        const node = st.node;
        if (!node || node.endpointOf(this.url, 'ws') === undefined) {
            const stray: Stray = { seq: nextSeq(), kind: 'url', url: this.url, detail: `unknown URL ${this.url} (WebSocket connect)` };
            if (node) node.strays.push(stray);
            else st.orphanStrays.push(stray);
            // A refused connection: the socket never opens and closes abnormally.
            this.#closeNow(1006, '');
            return;
        }
        // A stalled handshake (FakeNode.hangSocketOpens): stays CONNECTING until released.
        if (!this.#openHeld && node.holdSocketOpen(this)) {
            this.#openHeld = true;
            return;
        }
        this.#node = node;
        node.attachSocket(this);
        this.#state = OPEN;
        this.emit('open');
        this.onopen?.({ type: 'open', target: this });
    }

    /** Called by FakeNode.hangSocketOpens(false): finish a held handshake (a no-op once closed). */
    completeHeldOpen(): void {
        this.#open();
    }

    #notOpenError(): Error {
        const names = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
        return new Error(`WebSocket is not open: readyState ${this.#state} (${names[this.#state]})`);
    }

    /** ws sendAfterClose: the frame is dropped; a callback gets the error on the next tick. */
    #afterClose(cb: ((err?: Error) => void) | undefined): void {
        if (cb) process.nextTick(cb, this.#notOpenError());
    }

    send(data: unknown, options?: unknown, cb?: (err?: Error) => void): void {
        if (this.#state === CONNECTING) throw this.#notOpenError();
        if (typeof options === 'function') cb = options as (err?: Error) => void;
        if (this.#state !== OPEN) {
            this.#afterClose(cb);
            return;
        }
        const text = typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf8');
        const node = this.#node!;
        void node.handle(text, this.connection, { endpoint: 'ws', url: this.url }).then((reply) => {
            if (reply !== undefined) this.#deliver(JSON.stringify(reply));
        });
        // ws calls back once the frame is written out, never inside the call.
        if (cb) process.nextTick(cb);
    }

    #deliver(text: string): void {
        if (this.#state !== OPEN) return;
        this.emit('message', Buffer.from(text, 'utf8'), false);
        this.onmessage?.({ data: text, type: 'message', target: this });
    }

    ping(data?: unknown, mask?: unknown, cb?: (err?: Error) => void): void {
        if (this.#state === CONNECTING) throw this.#notOpenError();
        if (typeof data === 'function') cb = data as (err?: Error) => void;
        else if (typeof mask === 'function') cb = mask as (err?: Error) => void;
        if (this.#state !== OPEN) {
            this.#afterClose(cb);
            return;
        }
        // A real node answers a ping frame with a pong frame.
        queueMicrotask(() => {
            if (this.#state === OPEN) this.emit('pong', Buffer.alloc(0));
        });
        if (cb) process.nextTick(cb);
    }

    /** ws abortHandshake: CLOSING now, then 'error' and 'close' 1006 on the next tick. */
    #abortHandshake(): void {
        this.#state = CLOSING;
        const err = new Error('WebSocket was closed before the connection was established');
        process.nextTick(() => {
            this.#emitError(err);
            this.#closeNow(1006, '');
        });
    }

    /** An 'error' event: an onerror attribute is a listener too (ws registers it as one). */
    #emitError(err: Error): void {
        const attribute = this.onerror;
        // With no listener at all, EventEmitter throws, as ws's emit does.
        if (this.listenerCount('error') > 0 || !attribute) this.emit('error', err);
        attribute?.({ error: err, message: err.message, type: 'error', target: this });
    }

    terminate(): void {
        if (this.#state === CLOSED) return;
        if (this.#state === CONNECTING) {
            this.#abortHandshake();
            return;
        }
        this.#closeNow(1006, '');
    }

    close(code = 1000, reason = ''): void {
        if (this.#state === CLOSED || this.#state === CLOSING) return;
        if (this.#state === CONNECTING) {
            this.#abortHandshake();
            return;
        }
        this.#state = CLOSING;
        queueMicrotask(() => this.#closeNow(code, reason));
    }

    /** Server-initiated close (FakeNode.dropSocket), delivered after the call, as socket I/O is. */
    serverClose(code = 1006, reason = ''): void {
        if (this.#state === CLOSED) return;
        queueMicrotask(() => this.#closeNow(code, reason));
    }

    #closeNow(code: number, reason: string): void {
        if (this.#state === CLOSED) return;
        this.#state = CLOSED;
        this.#node?.detachSocket(this);
        this.emit('close', code, Buffer.from(reason, 'utf8'));
        this.onclose?.({ code, reason, wasClean: code === 1000, type: 'close', target: this });
    }
}

// ---------------------------------------------------------------------------------------------
// FakeNode
// ---------------------------------------------------------------------------------------------

export type Endpoint = 'rpc' | 'ws' | 'relay';

export interface Via {
    endpoint: Endpoint;
    url: string;
}

export interface ReadRevert {
    revert: string;
}

export interface ReadCall {
    to: string;
    from: string | undefined;
    data: string;
    value: bigint;
    blockTag: unknown;
    /** Arguments decoded with the signature registered in setRead. */
    args: ethers.Result;
}

export type ReadResult = string | ReadRevert;
export type ReadHandler = (call: ReadCall) => ReadResult;

export interface CallLogEntry {
    seq: number;
    endpoint: Endpoint;
    url: string;
    id: unknown;
    method: string;
    /** The raw JSON-RPC params exactly as received. */
    params: unknown;
    /** eth_call / eth_estimateGas target, lower-case. */
    to: string | undefined;
    selector: string | undefined;
    data: string | undefined;
    blockTag: unknown;
}

/** How a transaction reached the node: the public pool, a relay, or a harness-made other actor. */
export type TxRoute = 'public' | 'bundle' | 'bloxroute' | 'foreign';

/**
 * Where a transaction is now. `accepted` is pending (public pool, next nonce in line) or held by a
 * relay; `queued` is a public future nonce waiting for its gap to fill; `replaced` lost its pool
 * slot to a same-nonce transaction paying the bump; `dropped` lost its nonce to another
 * transaction that was mined; `mined` is in a block.
 */
export type TxStatus = 'accepted' | 'queued' | 'replaced' | 'dropped' | 'mined';

export interface HistoryEvent {
    seq: number;
    /** `queued` and `promoted` belong to the public pool's future-nonce queue. */
    event: 'accepted' | 'queued' | 'promoted' | 'replaced' | 'dropped' | 'mined';
    hash: string;
    from: string;
    nonce: number;
    route: TxRoute;
    /** Target block for a bundle, the earliest block for a pool transaction, the block for `mined`. */
    block: number;
    /** For `replaced`, the replacement; for `dropped`, the transaction mined at this nonce. */
    by?: string;
}

export interface Subscription {
    id: string;
    kind: string;
    filter: unknown;
    connection: Connection;
}

/** A transaction the code under test sent: through the public RPC, a bundle, or bloXroute. */
export interface Submitted {
    raw: string;
    hash: string;
    tx: Transaction;
    route: Exclude<TxRoute, 'foreign'>;
    status: TxStatus;
    /** Bundle target blocks (empty for the public pool and bloXroute, which name no block). */
    targetBlocks: number[];
    block: number | null;
}

export interface RelayEntry {
    seq: number;
    method: string;
    params: unknown;
    url: string;
}

export interface FakeLog {
    address: string;
    topics: string[];
    data: string;
    blockNumber: string;
    blockHash: string;
    transactionHash: string;
    transactionIndex: string;
    logIndex: string;
    removed: boolean;
}

interface BlockRecord {
    number: number;
    hash: string;
    parentHash: string;
    timestamp: number;
    baseFeePerGas: bigint;
    gasLimit: bigint;
    gasUsed: bigint;
    miner: string;
    transactions: string[];
}

interface KnownTx {
    /** Arrival order, so the default block fills the pool first come, first served. */
    seq: number;
    raw: string;
    hash: string;
    tx: Transaction;
    from: string;
    route: TxRoute;
    status: TxStatus;
    block: number | null;
    index: number | null;
}

/** Refused by the node: the JSON-RPC error a real node returns for this transaction. */
type Refusal = { error: JsonRpcError };

interface Receipt {
    hash: string;
    block: number;
    index: number;
    gasUsed: bigint;
    effectiveGasPrice: bigint;
    status: 1 | 0;
}

interface JsonRpcRequest {
    jsonrpc?: string;
    id?: unknown;
    method?: unknown;
    params?: unknown;
}

interface JsonRpcError {
    code: number;
    message: string;
    data?: string;
}

type Outcome = { result: unknown } | { error: JsonRpcError };

/**
 * A relay answer sent as its own HTTP response instead of a JSON-RPC envelope at HTTP 200 (plan
 * 23-15 harness gap). `status` is an integer from 200 to 599; `body` is the raw response text,
 * sent byte for byte (it is not parsed, and its JSON-RPC `id` is not matched to the request, so a
 * recorded live response replays exactly); `statusMessage` defaults to the standard reason phrase;
 * `headers` are added to `content-type: application/json` (names lower-cased; a given content-type
 * replaces the default). Only a setRelay handler can return one. One HTTP response carries one
 * status, so an http answer inside a JSON-RPC batch is a harness error (a stray), as is an
 * invalid one, never a node answer.
 */
export interface RelayHttpAnswer {
    http: { status: number; statusMessage?: string; body: string; headers?: Record<string, string> };
}

export type RelayHandler = (params: unknown, entry: RelayEntry) => Outcome | RelayHttpAnswer | Promise<Outcome | RelayHttpAnswer>;

/**
 * What FakeNode.handle() returns for a relay http answer, in place of a JSON-RPC envelope; the
 * HTTP seam (fetchHook) sends it as it is. Branded with a registry symbol, not a class, so the
 * check holds across the module copies vi.resetModules() creates (see harnessState).
 */
const RELAY_HTTP_REPLY = Symbol.for('csb.realpath.relayHttpReply');

export interface RelayHttpReply {
    readonly [RELAY_HTTP_REPLY]: true;
    readonly status: number;
    readonly statusMessage: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
}

export function isRelayHttpReply(x: unknown): x is RelayHttpReply {
    return typeof x === 'object' && x !== null && (x as Record<symbol, unknown>)[RELAY_HTTP_REPLY] === true;
}

function isRelayHttpAnswer(x: unknown): x is RelayHttpAnswer {
    return typeof x === 'object' && x !== null && 'http' in x;
}

/** Check a handler's http answer and build the reply; throws ("relay http answer: ...") if invalid. */
function toRelayHttpReply(answer: RelayHttpAnswer): RelayHttpReply {
    if ('result' in answer || 'error' in answer) throw new Error('relay http answer: an http answer cannot also carry result or error');
    const h = answer.http as Partial<RelayHttpAnswer['http']> | null | undefined;
    if (typeof h !== 'object' || h === null) throw new Error(`relay http answer: http must be an object, got ${String(h)}`);
    const { status, body, statusMessage, headers } = h;
    if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 599) {
        throw new Error(`relay http answer: status must be an integer from 200 to 599, got ${String(status)}`);
    }
    if (typeof body !== 'string') throw new Error(`relay http answer: body must be the raw response text (a string), got ${typeof body}`);
    if (statusMessage !== undefined && typeof statusMessage !== 'string') throw new Error(`relay http answer: statusMessage must be a string, got ${typeof statusMessage}`);
    const out: Record<string, string> = { 'content-type': 'application/json' };
    for (const [k, v] of Object.entries(headers ?? {})) {
        if (typeof v !== 'string') throw new Error(`relay http answer: header ${k} must be a string, got ${typeof v}`);
        out[k.toLowerCase()] = v;
    }
    return Object.freeze({ [RELAY_HTTP_REPLY]: true as const, status, statusMessage: statusMessage ?? STATUS_CODES[status] ?? '', headers: Object.freeze(out), body });
}

const ZERO_HASH = '0x' + '00'.repeat(32);
const MINER = '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5';
const GWEI = 1_000_000_000n;
const DEFAULT_ESTIMATE = 150_000n;
const DEFAULT_BLOCK_GAS_LIMIT = 30_000_000n;

function lc(a: unknown): string {
    return String(a).toLowerCase();
}

function blockHashOf(number: number, parentHash: string, txs: string[]): string {
    return keccak256(concat([toUtf8Bytes(`realpath-block:${number}`), parentHash, ...txs]));
}

function asBigInt(v: unknown, fallback = 0n): bigint {
    if (v === undefined || v === null || v === '') return fallback;
    return BigInt(v as string);
}

export interface FakeNodeOptions {
    chainId: number;
    headBlock?: number;
    baseFeePerGas?: bigint;
    priorityFeePerGas?: bigint;
}

export class FakeNode {
    readonly chainId: number;
    readonly callLog: CallLogEntry[] = [];
    readonly history: HistoryEvent[] = [];
    readonly subscriptions: Subscription[] = [];
    readonly submitted: Submitted[] = [];
    readonly relay: RelayEntry[] = [];
    readonly strays: Stray[] = [];
    /** Transactions from other actors (for example a launch's addLiquidityETH). */
    readonly foreign: KnownTx[] = [];
    readonly logs: FakeLog[] = [];
    /** Every fault and hold armed on this node, in arming order (assertAllFaultsFired reads it). */
    readonly faults: Array<FaultHandle | HoldHandle> = [];
    priorityFeePerGas: bigint;

    readonly #endpoints = new Map<string, Endpoint>();
    readonly #balances = new Map<string, bigint>();
    readonly #code = new Map<string, string>();
    readonly #reads = new Map<string, { fragment: FunctionFragment; result: ReadResult | ReadHandler }>();
    readonly #relayOverrides = new Map<string, RelayHandler>();
    readonly #blocks = new Map<number, BlockRecord>();
    readonly #txs = new Map<string, KnownTx>();
    readonly #receipts = new Map<string, Receipt>();
    readonly #sockets = new Set<FakeWebSocket>();
    readonly #neverMine = new Set<string>();
    #futureNoncePolicy: 'queue' | 'reject' = 'queue';
    /** A chain with no EIP-1559 fields (setFees({ legacy: true })). */
    #legacy = false;
    /** setFees overrides; undefined answers from the head block and the defaults. */
    #gasPrice: bigint | undefined;
    #estimateGas: bigint | undefined;
    readonly #receiptRules: ReceiptRule[] = [];
    #head: BlockRecord;
    #subSeq = 0;
    #socketsOpened = 0;
    /** hangSocketOpens: new sockets wait in CONNECTING while true (WR-03). */
    #hangOpens = false;
    readonly #heldOpens: FakeWebSocket[] = [];
    /** Waiters of waitForSubscriptions, resolved from the subscribe path (plan 23-27). */
    readonly #subscriptionWaiters: Array<{ n: number; resolve: () => void }> = [];
    /** autoMine: confirmations per accepted public transaction, or null when off (default). */
    #autoMineConfirmations: number | null = null;

    constructor(opts: FakeNodeOptions) {
        this.chainId = opts.chainId;
        this.priorityFeePerGas = opts.priorityFeePerGas ?? 1n * GWEI;
        const number = opts.headBlock ?? 21_000_000;
        const parentHash = keccak256(toUtf8Bytes(`realpath-block:${number - 1}`));
        this.#head = {
            number,
            hash: blockHashOf(number, parentHash, []),
            parentHash,
            timestamp: Math.floor(Date.now() / 1000) - 12,
            baseFeePerGas: opts.baseFeePerGas ?? 10n * GWEI,
            gasLimit: DEFAULT_BLOCK_GAS_LIMIT,
            gasUsed: 0n,
            miner: MINER,
            transactions: [],
        };
        this.#blocks.set(number, this.#head);
    }

    // -- scenario configuration ---------------------------------------------------------------

    /** Declare which URLs this node answers; anything else is a stray. */
    serve(urls: { rpc?: string[]; ws?: string[]; relay?: string[] }): void {
        for (const u of urls.rpc ?? []) this.#endpoints.set(`http|${u}`, 'rpc');
        for (const u of urls.relay ?? []) this.#endpoints.set(`http|${u}`, 'relay');
        for (const u of urls.ws ?? []) this.#endpoints.set(`ws|${u}`, 'ws');
    }

    endpointOf(url: string, transport: 'http' | 'ws'): Endpoint | undefined {
        return this.#endpoints.get(`${transport}|${url}`) ?? this.#endpoints.get(`${transport}|${url.replace(/\/$/, '')}`);
    }

    get head(): number {
        return this.#head.number;
    }

    setBalance(address: string, wei: bigint): void {
        this.#balances.set(lc(address), wei);
    }

    setCode(address: string, hex: string): void {
        this.#code.set(lc(address), hex);
    }

    /**
     * Register a contract read. `signature` is the human ABI form, e.g.
     * `getAmountsOut(uint256,address[])`. The result is ABI-encoded return data (build it with
     * encodeResult), a revert, or a handler that returns either.
     */
    setRead(address: string, signature: string, result: ReadResult | ReadHandler): void {
        const fragment = FunctionFragment.from(signature);
        this.#reads.set(`${lc(address)}|${fragment.selector}`, { fragment, result });
    }

    /**
     * Override the response of a relay method such as eth_callBundle. The handler returns a
     * JSON-RPC `{ result }` or `{ error }`, sent at HTTP 200, or `{ http: { status, body } }`, sent
     * as that HTTP status with that raw body (RelayHttpAnswer).
     */
    setRelay(method: string, handler: RelayHandler): void {
        this.#relayOverrides.set(method, handler);
    }

    // -- faults and holds (AC-03: each names its exact operation and proves it fired) --------

    /**
     * Fail the next matching call(s) of `method` with a JSON-RPC error. `selector` (4-byte hex or
     * a human signature such as `getReserves()`) and `to` narrow an eth_call or eth_estimateGas;
     * `to` also narrows eth_getBalance, eth_getCode and eth_getTransactionCount by their address.
     * `after` arms the fault only while it returns true, so a fault cannot hit an earlier call.
     * Works for relay methods (eth_sendBundle, eth_callBundle, flashbots_getBundleStatsV2) too.
     * A fault that never fires fails the test in afterEach (assertAllFaultsFired).
     */
    failNext(method: string, opts: FaultOptions = {}): FaultHandle {
        const f = new Fault(method, normaliseMatch(method, opts), opts.times ?? 1, opts.error);
        this.faults.push(f);
        return f;
    }

    /**
     * Park every matching call of `method` until `release()`. The call is logged (and, for a
     * relay method, recorded on `relay`) when it arrives; it is answered only once released.
     * Releasing ends the hold, so later calls pass. A hold that never parked a call fails the
     * test in afterEach (assertAllFaultsFired).
     */
    hold(method: string, opts: OperationMatch = {}): HoldHandle {
        const h = new Hold(method, normaliseMatch(method, opts));
        this.faults.push(h);
        return h;
    }

    /**
     * Teardown: release every hold. Calls still parked are answered with a JSON-RPC error, so a
     * call parked at teardown can never look like a node answer. Returns how many were parked.
     */
    releaseAll(): number {
        let parked = 0;
        for (const f of this.faults) {
            if (f instanceof Hold) parked += f.releaseForTeardown();
        }
        return parked;
    }

    /** Sockets ever opened on this node (a teardown proof needs to know one was live). */
    get socketsOpened(): number {
        return this.#socketsOpened;
    }

    /** Sockets currently open on this node. */
    get openSocketCount(): number {
        return this.#sockets.size;
    }

    // -- transactions from other actors ------------------------------------------------------

    /**
     * A signed transaction from an actor other than the bot, entering the public pool. It passes
     * the same admission rules as eth_sendRawTransaction; a refusal throws with the node's text,
     * because a scenario that builds an impossible foreign transaction is a harness mistake.
     */
    addForeignTransaction(raw: string): string {
        const r = this.#admitPublic(raw, 'foreign');
        if ('error' in r) throw new Error(`addForeignTransaction: the node refused it: ${r.error.message}`);
        return r.hash;
    }

    /**
     * Record a relay acceptance (bloXroute's bsc_private_tx; eth_sendBundle records its own). It
     * changes no count: only mine({ include }) can put it in a block. Returns the real hash.
     */
    acceptRelayTransaction(raw: string, route: 'bloxroute'): string {
        const tx = Transaction.from(raw);
        if (!tx.from || !tx.hash) throw new Error(`acceptRelayTransaction: the ${route} transaction is not signed`);
        let sub = this.submitted.find((s) => s.hash === tx.hash);
        if (!sub) {
            sub = { raw, hash: tx.hash, tx, route, status: 'accepted', targetBlocks: [], block: null };
            this.#pushSubmitted(sub);
            if (!this.#txs.has(tx.hash)) this.#txs.set(tx.hash, { seq: nextSeq(), raw, hash: tx.hash, tx, from: tx.from, route, status: 'accepted', block: null, index: null });
            this.history.push({ seq: nextSeq(), event: 'accepted', hash: tx.hash, from: tx.from, nonce: tx.nonce, route, block: this.#head.number + 1 });
        }
        return tx.hash;
    }

    /** True once mine() has included `hash`. */
    isMined(hash: string): boolean {
        return this.#receipts.has(hash);
    }

    /** Where `hash` is now (undefined when this node never accepted it). */
    statusOf(hash: string): TxStatus | undefined {
        return this.#txs.get(hash)?.status;
    }

    /** Transactions from `address` mined at or before `atBlock`: the count at that block. */
    minedCount(address: string, atBlock = this.#head.number): number {
        let n = 0;
        for (const t of this.#txs.values()) if (t.status === 'mined' && t.block !== null && t.block <= atBlock && lc(t.from) === lc(address)) n += 1;
        return n;
    }

    /** The count at `pending`: mined, plus the public pool's contiguous run from the next nonce. */
    pendingCount(address: string): number {
        let n = this.minedCount(address);
        const pool = this.#poolOf(address).filter((t) => t.status === 'accepted');
        while (pool.some((t) => t.tx.nonce === n)) n += 1;
        return n;
    }

    /**
     * What a future nonce (above the pending count) gets. `queue` (default) parks it until the gap
     * fills, as a geth pool does. `reject` refuses it with `nonce too high`, as some nodes and
     * provider front ends do.
     */
    setFutureNoncePolicy(policy: 'queue' | 'reject'): void {
        if (policy !== 'queue' && policy !== 'reject') throw new Error(`setFutureNoncePolicy: unknown policy ${String(policy)}`);
        this.#futureNoncePolicy = policy;
    }

    /**
     * Keep `hash` out of every block (a transaction no builder or validator picks up). Its receipt
     * stays a valid null while later blocks mine; naming it in mine({ include }) throws. If its
     * nonce is mined by another transaction it becomes dropped, as on a real chain.
     */
    neverMine(hash: string): void {
        if (!this.#txs.has(hash)) throw new Error(`neverMine: ${hash} was never accepted by this node`);
        this.#neverMine.add(hash);
    }

    /**
     * The one place a submission from the code under test is stored: on `submitted`, and as a
     * `submit` entry on the harness timeline (plan 23-02, D-13), in arrival order.
     */
    #pushSubmitted(sub: Submitted): void {
        if (sub.status !== 'accepted' && sub.status !== 'queued') throw new Error(`FakeNode: a new submission cannot arrive ${sub.status}`);
        this.submitted.push(sub);
        harnessState().timeline?.record({
            kind: 'submit',
            route: sub.route,
            hash: sub.hash,
            raw: sub.raw,
            from: getAddress(sub.tx.from!),
            to: sub.tx.to ? getAddress(sub.tx.to) : null,
            nonce: sub.tx.nonce,
            status: sub.status,
        });
    }

    // -- public pool admission (eth_sendRawTransaction) ----------------------------------------

    /** Public-pool transactions from `address` still waiting (pending or queued). */
    #poolOf(address: string): KnownTx[] {
        const a = lc(address);
        return [...this.#txs.values()].filter((t) => (t.route === 'public' || t.route === 'foreign') && (t.status === 'accepted' || t.status === 'queued') && lc(t.from) === a);
    }

    /**
     * Admit a raw transaction to the public pool with a real node's checks and text (geth
     * txpool / internal/ethapi). Accepted at the next nonce it is pending; above it, queued (or
     * refused under setFutureNoncePolicy('reject')); at a nonce the pool already holds, it
     * replaces that transaction only with a 10 percent bump on both fee fields.
     */
    #admitPublic(raw: string, route: 'public' | 'foreign'): { hash: string } | Refusal {
        const refuse = (message: string): Refusal => ({ error: { code: -32000, message } });
        let tx: Transaction;
        try {
            tx = Transaction.from(raw);
        } catch (e) {
            // The harness cannot be sure its decode text matches a node's, so this is also a stray.
            const detail = `eth_sendRawTransaction could not decode the raw transaction: ${e instanceof Error ? e.message : String(e)}`;
            this.strays.push({ seq: nextSeq(), kind: 'method', method: 'eth_sendRawTransaction', detail });
            return refuse('rlp: invalid transaction encoding');
        }
        if (!tx.signature || !tx.from || !tx.hash) return refuse('invalid sender');
        if (tx.type === 0 && tx.chainId === 0n) return refuse('only replay-protected (EIP-155) transactions allowed over RPC');
        if (this.#legacy && (tx.type ?? 0) >= 2) return refuse('transaction type not supported');
        if (tx.gasLimit > this.#head.gasLimit) return refuse('exceeds block gas limit');
        if (tx.type === 2 && tx.maxPriorityFeePerGas! > tx.maxFeePerGas!) return refuse('max priority fee per gas higher than max fee per gas');
        if (tx.chainId !== BigInt(this.chainId)) return refuse(`invalid sender: invalid chain id for signer: have ${tx.chainId} want ${this.chainId}`);
        const intrinsic = intrinsicGas(tx);
        if (tx.gasLimit < intrinsic) return refuse(`intrinsic gas too low: gas ${tx.gasLimit}, minimum needed ${intrinsic}`);
        // geth answers "already known" only for a hash still in its pool; a mined one falls
        // through to the nonce check, and a relay-held one is not in the public pool at all.
        const known = this.#txs.get(tx.hash);
        if (known && (known.route === 'public' || known.route === 'foreign') && (known.status === 'accepted' || known.status === 'queued')) return refuse('already known');
        const from = tx.from;
        const next = this.minedCount(from);
        if (tx.nonce < next) return refuse(`nonce too low: next nonce ${next}, tx nonce ${tx.nonce}`);

        // Funds: this transaction alone, then with what the sender's other pool transactions spend.
        const balance = this.#balances.get(lc(from)) ?? 0n;
        const cost = txCost(tx);
        if (balance < cost) return refuse(`insufficient funds for gas * price + value: balance ${balance}, tx cost ${cost}, overshot ${cost - balance}`);
        const pool = this.#poolOf(from);
        const existing = pool.find((t) => t.tx.nonce === tx.nonce);
        // geth ExistingExpenditure: everything the sender's pool transactions can spend.
        const spent = pool.reduce((a, t) => a + txCost(t.tx), 0n);
        if (existing) {
            const bump = cost - txCost(existing.tx);
            const need = spent + bump;
            if (balance < need) return refuse(`insufficient funds for gas * price + value: balance ${balance}, queued cost ${spent}, tx bumped ${bump}, overshot ${need - balance}`);
            // geth PriceBump 10: both the fee cap and the tip must clear old * 110 / 100.
            const capFloor = (feeCap(existing.tx) * 110n) / 100n;
            const tipFloor = (tipCap(existing.tx) * 110n) / 100n;
            if (feeCap(tx) < capFloor || tipCap(tx) < tipFloor) return refuse('replacement transaction underpriced');
        } else {
            const need = spent + cost;
            if (balance < need) return refuse(`insufficient funds for gas * price + value: balance ${balance}, queued cost ${spent}, overshot ${need - balance}`);
            const pendingNext = this.pendingCount(from);
            if (tx.nonce > pendingNext && this.#futureNoncePolicy === 'reject') return refuse(`nonce too high: next nonce ${pendingNext}, tx nonce ${tx.nonce}`);
        }

        const status: TxStatus = existing ? existing.status : tx.nonce > this.pendingCount(from) ? 'queued' : 'accepted';
        const entry: KnownTx = { seq: nextSeq(), raw, hash: tx.hash, tx, from, route, status, block: null, index: null };
        this.#txs.set(tx.hash, entry);
        if (route === 'foreign') this.foreign.push(entry);
        else this.#pushSubmitted({ raw, hash: tx.hash, tx, route, status, targetBlocks: [], block: null });
        this.history.push({ seq: nextSeq(), event: status === 'queued' ? 'queued' : 'accepted', hash: tx.hash, from, nonce: tx.nonce, route, block: this.#head.number + 1 });
        if (existing) {
            this.#setStatus(existing, 'replaced');
            this.history.push({ seq: nextSeq(), event: 'replaced', hash: existing.hash, from, nonce: existing.tx.nonce, route: existing.route, block: this.#head.number + 1, by: tx.hash });
        }
        this.#promote(from);
        return { hash: tx.hash };
    }

    /** Move queued transactions whose gap has filled into the pending run, in nonce order. */
    #promote(address: string): void {
        let n = this.minedCount(address);
        const pool = this.#poolOf(address);
        for (;;) {
            const t = pool.find((x) => x.tx.nonce === n);
            if (!t) return;
            if (t.status === 'queued') {
                this.#setStatus(t, 'accepted');
                this.history.push({ seq: nextSeq(), event: 'promoted', hash: t.hash, from: t.from, nonce: t.tx.nonce, route: t.route, block: this.#head.number + 1 });
            }
            n += 1;
        }
    }

    #setStatus(t: KnownTx, status: TxStatus): void {
        t.status = status;
        for (const sub of this.submitted) if (sub.hash === t.hash) sub.status = status;
    }

    /** Why `t` cannot go in block `number` right now, or undefined when it can. */
    #notIncludable(t: KnownTx, number: number, baseFeePerGas: bigint, expectedNonce: number, spent: bigint, gasUsed: bigint): string | undefined {
        if (t.status !== 'accepted') return `it is ${t.status}`;
        if (t.tx.chainId !== BigInt(this.chainId)) return `it is signed for chain ${t.tx.chainId}, this node is chain ${this.chainId}`;
        if (t.route === 'bundle') {
            const sub = this.submitted.find((s) => s.hash === t.hash);
            if (sub && !sub.targetBlocks.includes(number)) return `the bundle targets blocks ${sub.targetBlocks.join(', ')}, not ${number}`;
        }
        if (t.tx.nonce !== expectedNonce) return `it has nonce ${t.tx.nonce} but the next nonce for ${t.from} is ${expectedNonce}`;
        if (this.#legacy && (t.tx.type ?? 0) >= 2) return 'this chain has no EIP-1559 (transaction type not supported)';
        if (!this.#legacy && feeCap(t.tx) < baseFeePerGas) return `its fee cap ${feeCap(t.tx)} is below the block base fee ${baseFeePerGas}`;
        if (gasUsed + t.tx.gasLimit > this.#head.gasLimit) return 'it does not fit the block gas limit';
        const balance = (this.#balances.get(lc(t.from)) ?? 0n) - spent;
        if (balance < txCost(t.tx)) return `insufficient funds for gas * price + value: balance ${balance}, tx cost ${txCost(t.tx)}`;
        return undefined;
    }

    /**
     * Mine one block and return its number.
     * - `include` names exact hashes, in order. Each must be includable now: accepted (pending, or
     *   held by a relay), this chain's ID, the sender's next nonce, a bundle's target block, a fee
     *   cap at or above the base fee, and funds for gas and value. Otherwise mine() throws, because
     *   a real block could not hold it.
     * - Without `include`, the block takes every includable public pending transaction, first
     *   come first served, each sender's nonces in order. Relay transactions (bundle, bloXroute)
     *   go in only when named.
     * - `exclude` leaves the named hashes out of this block only; neverMine() keeps one out of
     *   every block.
     * A transaction whose nonce this block consumes through another transaction becomes dropped.
     */
    mine(opts: MineOptions = {}): number {
        const number = this.#head.number + 1;
        if (this.#legacy && opts.baseFeePerGas !== undefined) throw new Error('mine: a legacy chain (setFees({ legacy: true })) has no base fee');
        const baseFeePerGas = opts.baseFeePerGas ?? this.#head.baseFeePerGas;
        const exclude = new Set(opts.exclude ?? []);
        for (const h of exclude) if (!this.#txs.has(h)) throw new Error(`mine: exclude names ${h}, which this node never accepted`);
        const nextNonce = new Map<string, number>();
        const spent = new Map<string, bigint>();
        const picked: Array<{ t: KnownTx; used: bigint; effectiveGasPrice: bigint }> = [];
        let blockGas = 0n;
        const expectedOf = (t: KnownTx): number => nextNonce.get(lc(t.from)) ?? this.minedCount(t.from);
        const take = (t: KnownTx): void => {
            const used = t.tx.gasLimit < DEFAULT_ESTIMATE ? t.tx.gasLimit : DEFAULT_ESTIMATE;
            const effectiveGasPrice = this.#legacy || t.tx.type !== 2 ? (t.tx.gasPrice ?? 0n) : minBig(t.tx.maxFeePerGas!, baseFeePerGas + t.tx.maxPriorityFeePerGas!);
            const key = lc(t.from);
            nextNonce.set(key, t.tx.nonce + 1);
            spent.set(key, (spent.get(key) ?? 0n) + used * effectiveGasPrice + t.tx.value);
            blockGas += used;
            picked.push({ t, used, effectiveGasPrice });
        };
        const whyNot = (t: KnownTx): string | undefined => this.#notIncludable(t, number, baseFeePerGas, expectedOf(t), spent.get(lc(t.from)) ?? 0n, blockGas);
        if (opts.include) {
            for (const hash of opts.include) {
                const t = this.#txs.get(hash);
                if (!t) throw new Error(`mine: ${hash} was never accepted by this node`);
                if (exclude.has(hash)) throw new Error(`mine: ${hash} is named in both include and exclude`);
                if (this.#neverMine.has(hash)) throw new Error(`mine: ${hash} is under neverMine`);
                if (picked.some((p) => p.t === t)) throw new Error(`mine: ${hash} is named twice`);
                const why = whyNot(t);
                if (why) throw new Error(`mine: ${hash} cannot go in block ${number}: ${why}`);
                take(t);
            }
        } else {
            const pool = [...this.#txs.values()]
                .filter((t) => (t.route === 'public' || t.route === 'foreign') && t.status === 'accepted' && !exclude.has(t.hash) && !this.#neverMine.has(t.hash))
                .sort((a, b) => a.seq - b.seq);
            for (let progress = true; progress; ) {
                progress = false;
                for (const t of pool) {
                    if (picked.some((p) => p.t === t) || whyNot(t) !== undefined) continue;
                    take(t);
                    progress = true;
                }
            }
        }
        const parent = this.#head;
        const hashes = picked.map((p) => p.t.hash);
        // Validate explicit logs before any state changes: a real log always comes from a
        // transaction in its own block.
        const explicit = (opts.logs ?? []).map((l, i) => {
            const txHash = l.transactionHash ?? (hashes.length === 1 ? hashes[0] : undefined);
            if (txHash === undefined) throw new Error(`mine: logs[${i}] names no transactionHash and block ${number} holds ${hashes.length} transactions (a log must come from one of them)`);
            if (!hashes.includes(txHash)) throw new Error(`mine: logs[${i}] names ${txHash}, which is not in block ${number}`);
            return { ...l, transactionHash: txHash };
        });
        let gasUsed = 0n;
        picked.forEach(({ t, used, effectiveGasPrice }, index) => {
            gasUsed += used;
            this.#setStatus(t, 'mined');
            t.block = number;
            t.index = index;
            for (const sub of this.submitted) if (sub.hash === t.hash) sub.block = number;
            this.#receipts.set(t.hash, { hash: t.hash, block: number, index, gasUsed: used, effectiveGasPrice, status: 1 });
            // The sender pays for the gas it used and the value it sent.
            const key = lc(t.from);
            this.#balances.set(key, (this.#balances.get(key) ?? 0n) - used * effectiveGasPrice - t.tx.value);
            this.history.push({ seq: nextSeq(), event: 'mined', hash: t.hash, from: t.from, nonce: t.tx.nonce, route: t.route, block: number });
        });
        // Every other transaction at a nonce this block consumed is dropped, on every route.
        const senders = new Set(picked.map((p) => lc(p.t.from)));
        for (const other of this.#txs.values()) {
            if (other.status !== 'accepted' && other.status !== 'queued') continue;
            if (!senders.has(lc(other.from)) || other.tx.nonce >= nextNonce.get(lc(other.from))!) continue;
            const winner = picked.find((p) => lc(p.t.from) === lc(other.from) && p.t.tx.nonce === other.tx.nonce);
            this.#setStatus(other, 'dropped');
            this.history.push({ seq: nextSeq(), event: 'dropped', hash: other.hash, from: other.from, nonce: other.tx.nonce, route: other.route, block: number, ...(winner ? { by: winner.t.hash } : {}) });
        }
        const block: BlockRecord = {
            number,
            hash: blockHashOf(number, parent.hash, hashes),
            parentHash: parent.hash,
            timestamp: Math.max(parent.timestamp + 1, Math.floor(Date.now() / 1000)),
            baseFeePerGas,
            gasLimit: DEFAULT_BLOCK_GAS_LIMIT,
            gasUsed,
            miner: MINER,
            transactions: hashes,
        };
        this.#blocks.set(number, block);
        this.#head = block;
        // A relay transaction mined at a nonce can close a gap in the public queue.
        for (const s of senders) this.#promote(s);
        // Logs: each matching setReceiptLogs rule per mined transaction, then the explicit logs,
        // ordered by transaction index (a real block numbers its logs in transaction order).
        const queued: Array<LogInput & { transactionHash: string }> = [];
        for (const { t } of picked) {
            for (const rule of this.#receiptRules) {
                if (!receiptRuleMatches(rule, t.tx)) continue;
                for (const l of rule.make(t.tx)) queued.push({ address: l.address, topics: l.topics, data: l.data, transactionHash: t.hash });
            }
        }
        queued.push(...explicit);
        const ordered = queued.map((l, i) => ({ l, i })).sort((a, b) => hashes.indexOf(a.l.transactionHash) - hashes.indexOf(b.l.transactionHash) || a.i - b.i);
        const stored = this.#storeLogs(block, ordered.map((x) => x.l));
        // A real node announces the head, then each matching log, in block order.
        for (const s of this.subscriptions) {
            if (s.kind === 'newHeads') this.#push(s, this.#formatBlock(block, false, true));
        }
        this.#deliverLogs(stored);
        return number;
    }

    /** Store logs in block `b` with the real positional fields; returns them as stored. */
    #storeLogs(b: BlockRecord, logs: Array<LogInput & { transactionHash: string }>): FakeLog[] {
        let logIndex = this.logs.filter((l) => l.blockHash === b.hash).length;
        const out: FakeLog[] = [];
        for (const l of logs) {
            const txIndex = b.transactions.indexOf(l.transactionHash);
            if (txIndex < 0) throw new Error(`log: ${l.transactionHash} is not in block ${b.number}`);
            const log: FakeLog = {
                address: getAddress(l.address).toLowerCase(),
                topics: l.topics.map((t) => t.toLowerCase()),
                data: l.data.toLowerCase(),
                blockNumber: toQuantity(b.number),
                blockHash: b.hash,
                transactionHash: l.transactionHash,
                transactionIndex: toQuantity(txIndex),
                logIndex: toQuantity(logIndex),
                removed: false,
            };
            logIndex += 1;
            this.logs.push(log);
            out.push(log);
        }
        return out;
    }

    #deliverLogs(logs: FakeLog[]): void {
        for (const log of logs) {
            for (const s of this.subscriptions) {
                if (s.kind === 'logs' && logMatches(log, s.filter)) this.#push(s, log);
            }
        }
    }

    /**
     * Logs a matching mined transaction's receipt (and block) carries, for example the WETH
     * Withdrawal of a V2 sell that src/utils/receiptDecoder.ts reads. `to` and `selector` (4-byte
     * or a human signature) narrow which transactions match; `make` builds the logs with real
     * encoders. Rules apply in the order they were set.
     */
    setReceiptLogs(match: { to?: string; selector?: string }, make: (tx: Transaction) => LogInput[]): void {
        let selector: string | undefined;
        if (match.selector !== undefined) {
            selector = match.selector.includes('(') ? FunctionFragment.from(match.selector).selector : match.selector.toLowerCase();
            if (!/^0x[0-9a-f]{8}$/.test(selector)) throw new Error(`setReceiptLogs: "${match.selector}" is not a 4-byte selector or a function signature`);
        }
        this.#receiptRules.push({ to: match.to === undefined ? undefined : getAddress(match.to).toLowerCase(), selector, make });
    }

    /**
     * Fee answers, kept until changed. `gasPrice` answers eth_gasPrice (default: base fee plus the
     * priority fee); `maxPriorityFeePerGas` answers eth_maxPriorityFeePerGas; `estimateGas`
     * answers eth_estimateGas. `legacy: true` makes this a chain with no EIP-1559: blocks carry no
     * baseFeePerGas (nor the later Shanghai and Cancun fields), eth_maxPriorityFeePerGas answers
     * -32601 as such a node does, and a type-2 transaction is refused as not supported.
     */
    setFees(fees: { gasPrice?: bigint; maxPriorityFeePerGas?: bigint; estimateGas?: bigint; legacy?: boolean }): void {
        for (const [k, v] of Object.entries(fees)) {
            if (k === 'legacy') {
                if (typeof v !== 'boolean') throw new Error('setFees: legacy must be a boolean');
            } else if (k === 'gasPrice' || k === 'maxPriorityFeePerGas' || k === 'estimateGas') {
                if (typeof v !== 'bigint' || v < 0n) throw new Error(`setFees: ${k} must be a non-negative bigint`);
            } else {
                throw new Error(`setFees: unknown field ${k}`);
            }
        }
        if (fees.gasPrice !== undefined) this.#gasPrice = fees.gasPrice;
        if (fees.maxPriorityFeePerGas !== undefined) this.priorityFeePerGas = fees.maxPriorityFeePerGas;
        if (fees.estimateGas !== undefined) this.#estimateGas = fees.estimateGas;
        if (fees.legacy !== undefined) this.#legacy = fees.legacy;
    }

    blockHash(number: number): string {
        return this.#blockAt(number)?.hash ?? ZERO_HASH;
    }

    /**
     * Store logs on the head block (or the block a FakeLog names) and deliver them, in the given
     * order, to every logs subscription whose filter matches. Each comes from a transaction in its
     * block; block number, hash and the transaction and log indexes are the node's own, and a
     * FakeLog whose fields disagree with them throws.
     */
    emitLogs(logs: Array<FakeLog | LogInput>): void {
        const stored: FakeLog[] = [];
        for (const [i, l] of logs.entries()) {
            const full = l as Partial<FakeLog>;
            const b = full.blockNumber !== undefined ? this.#blocks.get(Number(BigInt(full.blockNumber))) : this.#head;
            if (!b) throw new Error(`emitLogs: logs[${i}] names block ${full.blockNumber}, which this node never mined`);
            if (full.blockHash !== undefined && full.blockHash.toLowerCase() !== b.hash) throw new Error(`emitLogs: logs[${i}] block hash ${full.blockHash} is not the hash of block ${b.number}`);
            const txHash = l.transactionHash ?? (b.transactions.length === 1 ? b.transactions[0] : undefined);
            if (txHash === undefined) throw new Error(`emitLogs: logs[${i}] names no transactionHash and block ${b.number} holds ${b.transactions.length} transactions`);
            const [log] = this.#storeLogs(b, [{ address: l.address, topics: l.topics, data: l.data, transactionHash: txHash }]);
            for (const k of ['transactionIndex', 'logIndex'] as const) {
                if (full[k] !== undefined && BigInt(full[k]!) !== BigInt(log[k])) {
                    this.logs.pop();
                    throw new Error(`emitLogs: logs[${i}] ${k} ${full[k]} disagrees with the node (${log[k]})`);
                }
            }
            stored.push(log);
        }
        this.#deliverLogs(stored);
    }

    /** Server-side close of every open socket on this node (default code 1006, abnormal). */
    dropSocket(code = 1006): void {
        for (const ws of [...this.#sockets]) ws.serverClose(code, '');
    }

    /**
     * A stalled WebSocket handshake (Phase 23 review WR-03): while on, a new socket to this node
     * stays CONNECTING, so a test can reach ws's CONNECTING paths (close or terminate during the
     * handshake, a ping or send before open). Turning it off opens every socket still waiting,
     * in the order they connected; one closed meanwhile never opens.
     */
    hangSocketOpens(on: boolean): void {
        if (typeof on !== 'boolean') throw new Error('hangSocketOpens: on must be a boolean');
        this.#hangOpens = on;
        if (on) return;
        for (const ws of this.#heldOpens.splice(0)) queueMicrotask(() => ws.completeHeldOpen());
    }

    /** FakeWebSocket asks before it opens: true (and kept) while hangSocketOpens is on. */
    holdSocketOpen(ws: FakeWebSocket): boolean {
        if (!this.#hangOpens) return false;
        this.#heldOpens.push(ws);
        return true;
    }

    attachSocket(ws: FakeWebSocket): void {
        this.#sockets.add(ws);
        this.#socketsOpened += 1;
    }

    detachSocket(ws: FakeWebSocket): void {
        this.#sockets.delete(ws);
        this.detachConnection(ws.connection);
    }

    /**
     * A connection closed (an in-process FakeWebSocket or a real loopback socket, loopback.ts):
     * its subscriptions go, so no later push is ever written to a dead socket.
     */
    detachConnection(connection: Connection): void {
        for (let i = this.subscriptions.length - 1; i >= 0; i--) {
            if (this.subscriptions[i].connection === connection) this.subscriptions.splice(i, 1);
        }
    }

    /**
     * Resolve once at least `n` subscriptions exist. Resolved from the subscribe path itself, with
     * no timer, so a test under the fixed clock can wait for a real child process to subscribe.
     * It never rejects: race it against the child's end so a child that dies is a loud failure.
     */
    waitForSubscriptions(n: number): Promise<void> {
        if (!Number.isInteger(n) || n < 1) throw new Error(`waitForSubscriptions: n must be a positive integer, got ${String(n)}`);
        if (this.subscriptions.length >= n) return Promise.resolve();
        return new Promise((resolve) => this.#subscriptionWaiters.push({ n, resolve }));
    }

    #wakeSubscriptionWaiters(): void {
        for (let i = this.#subscriptionWaiters.length - 1; i >= 0; i--) {
            const w = this.#subscriptionWaiters[i];
            if (this.subscriptions.length >= w.n) {
                this.#subscriptionWaiters.splice(i, 1);
                w.resolve();
            }
        }
    }

    /**
     * For a child process running on real time (plan 23-27): every public transaction
     * eth_sendRawTransaction accepts as pending is mined at once by the existing mining model
     * (mine(), the includable pool), and when it was included, `confirmations - 1` empty blocks
     * follow in the same tick, as an automining dev node would do. A transaction the model cannot
     * include (a queued future nonce, a fee cap under the base fee) stays where it is, because a
     * real block could not hold it either. Off by default; autoMine(false) turns it off. A
     * fake-clock scenario never needs it.
     */
    autoMine(opts: { confirmations: number } | false): void {
        if (opts === false) {
            this.#autoMineConfirmations = null;
            return;
        }
        const c = opts?.confirmations;
        if (!Number.isInteger(c) || c < 1) throw new Error(`autoMine: confirmations must be a positive integer, got ${String(c)}`);
        this.#autoMineConfirmations = c;
    }

    // -- JSON-RPC entry point ----------------------------------------------------------------

    /**
     * The one entry point for every JSON-RPC call (HTTP, WebSocket and relay). `body` is one
     * request or a batch (object, array or JSON text); `connection` is the server-side end a
     * subscription delivers through (FakeWebSocket passes its own; HTTP leaves it out). For a
     * single relay call whose setRelay handler returns an http answer, it returns that
     * RelayHttpReply (isRelayHttpReply) instead of a JSON-RPC envelope.
     */
    async handle(body: unknown, connection?: Connection, via: Via = { endpoint: 'rpc', url: '' }): Promise<unknown> {
        let parsed: unknown = body;
        if (typeof body === 'string') {
            try {
                parsed = JSON.parse(body);
            } catch {
                return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } };
            }
        }
        if (Array.isArray(parsed)) {
            const out: unknown[] = [];
            for (const r of parsed) {
                const one = await this.#one(r as JsonRpcRequest, connection, via);
                if (isRelayHttpReply(one)) {
                    // One HTTP response carries one status: a harness error, never a node answer.
                    const rq = r as JsonRpcRequest;
                    const m = typeof rq?.method === 'string' ? rq.method : '';
                    this.strays.push({ seq: nextSeq(), kind: 'method', method: m, detail: `harness error answering ${m}: a relay http answer cannot be sent inside a JSON-RPC batch (one HTTP response carries one status)` });
                    out.push({ jsonrpc: '2.0', id: rq?.id ?? null, error: { code: -32603, message: 'internal error' } });
                    continue;
                }
                if (one !== undefined) out.push(one);
            }
            return out;
        }
        return this.#one(parsed as JsonRpcRequest, connection, via);
    }

    async #one(r: JsonRpcRequest, connection: Connection | undefined, via: Via): Promise<unknown> {
        const id = r?.id ?? null;
        const method = typeof r?.method === 'string' ? r.method : '';
        const params = r?.params;
        const entry = this.#logCall(method, params, id, via);
        let relayEntry: RelayEntry | undefined;
        if (via.endpoint === 'relay') {
            relayEntry = { seq: nextSeq(), method, params, url: via.url };
            this.relay.push(relayEntry);
            harnessState().timeline?.record({ kind: 'relay', relay: 'flashbots', url: via.url, method, params });
        }
        let outcome: Outcome;
        let httpReply: RelayHttpReply | undefined;
        try {
            const op: Operation = { method, params, to: targetOf(method, params), selector: entry.selector };
            // A fault answers at once; a hold parks the call until released (or torn down).
            const fault = this.faults.find((f): f is Fault => f instanceof Fault && f.claims(op));
            const hold = fault ? undefined : this.faults.find((f): f is Hold => f instanceof Hold && f.claims(op));
            const parked = hold ? await hold.park() : undefined;
            if (fault) outcome = { error: fault.error };
            else if (parked) outcome = { error: parked };
            else {
                const answered = await this.#dispatch(method, params, connection, via, entry, relayEntry);
                // A setRelay handler's http answer (plan 23-15 harness gap); checked here, so an
                // invalid one lands in the catch below as a harness error.
                if (isRelayHttpAnswer(answered)) {
                    httpReply = toRelayHttpReply(answered);
                    outcome = { result: undefined };
                } else outcome = answered;
            }
        } catch (e) {
            // A harness bug must not look like a node answer: fail loudly in afterEach as well.
            const detail = `harness error answering ${method}: ${e instanceof Error ? e.message : String(e)}`;
            this.strays.push({ seq: nextSeq(), kind: 'method', method, detail });
            outcome = { error: { code: -32603, message: 'internal error' } };
            httpReply = undefined;
        }
        // An http answer is a whole HTTP response, sent whatever the request id.
        if (httpReply) return httpReply;
        if (r?.id === undefined) return undefined;
        return 'error' in outcome ? { jsonrpc: '2.0', id, error: outcome.error } : { jsonrpc: '2.0', id, result: outcome.result };
    }

    #logCall(method: string, params: unknown, id: unknown, via: Via): CallLogEntry {
        const p = Array.isArray(params) ? params : [];
        let to: string | undefined;
        let data: string | undefined;
        let blockTag: unknown;
        if (method === 'eth_call' || method === 'eth_estimateGas') {
            const tx = (p[0] ?? {}) as { to?: string; data?: string; input?: string };
            to = tx.to ? lc(tx.to) : undefined;
            data = tx.data ?? tx.input;
            blockTag = p[1];
        } else if (method === 'eth_getBalance' || method === 'eth_getCode' || method === 'eth_getTransactionCount') {
            blockTag = p[1];
        } else if (method === 'eth_getBlockByNumber') {
            blockTag = p[0];
        }
        const entry: CallLogEntry = {
            seq: nextSeq(),
            endpoint: via.endpoint,
            url: via.url,
            id,
            method,
            params,
            to,
            selector: data && data.length >= 10 ? data.slice(0, 10).toLowerCase() : undefined,
            data,
            blockTag,
        };
        this.callLog.push(entry);
        return entry;
    }

    async #dispatch(method: string, params: unknown, connection: Connection | undefined, via: Via, entry: CallLogEntry, relayEntry?: RelayEntry): Promise<Outcome | RelayHttpAnswer> {
        if (via.endpoint === 'relay') return this.#relayMethod(method, params, relayEntry ?? { seq: nextSeq(), method, params, url: via.url });
        const p = (Array.isArray(params) ? params : []) as unknown[];
        switch (method) {
            case 'eth_chainId':
                return { result: toQuantity(this.chainId) };
            case 'net_version':
                return { result: String(this.chainId) };
            case 'eth_blockNumber':
                return { result: toQuantity(this.#head.number) };
            case 'eth_gasPrice':
                return { result: toQuantity(this.#gasPrice ?? (this.#legacy ? 0n : this.#head.baseFeePerGas) + this.priorityFeePerGas) };
            case 'eth_maxPriorityFeePerGas':
                // A node with no EIP-1559 does not serve this method: geth's own text and no stray,
                // because a real node of that kind answers exactly this.
                if (this.#legacy) return { error: { code: -32601, message: 'the method eth_maxPriorityFeePerGas does not exist/is not available' } };
                return { result: toQuantity(this.priorityFeePerGas) };
            case 'eth_estimateGas':
                return { result: toQuantity(this.#estimateGas ?? DEFAULT_ESTIMATE) };
            case 'eth_getBalance':
                return { result: toQuantity(this.#balances.get(lc(p[0])) ?? 0n) };
            case 'eth_getCode':
                return { result: this.#code.get(lc(p[0])) ?? '0x' };
            case 'eth_getTransactionCount':
                return { result: toQuantity(this.#nonceAt(String(p[0]), p[1])) };
            case 'eth_getBlockByNumber': {
                const b = this.#resolveBlock(p[0]);
                return { result: b ? this.#formatBlock(b, p[1] === true, false) : null };
            }
            case 'eth_getBlockByHash': {
                const b = [...this.#blocks.values()].find((x) => x.hash === lc(p[0]));
                return { result: b ? this.#formatBlock(b, p[1] === true, false) : null };
            }
            case 'eth_sendRawTransaction': {
                const r = this.#admitPublic(String(p[0]), 'public');
                if ('error' in r) return r;
                if (this.#autoMineConfirmations !== null && this.statusOf(r.hash) === 'accepted') {
                    this.mine();
                    if (this.isMined(r.hash)) for (let i = 1; i < this.#autoMineConfirmations; i++) this.mine({ include: [] });
                }
                return { result: r.hash };
            }
            case 'eth_getTransactionReceipt':
                return { result: this.#formatReceipt(String(p[0])) };
            case 'eth_getTransactionByHash':
                return { result: this.#formatTxByHash(String(p[0])) };
            case 'eth_call':
                return this.#ethCall(p, entry);
            case 'eth_getLogs':
                return this.#getLogs(p[0]);
            case 'eth_subscribe':
                return this.#subscribe(p, connection);
            case 'eth_unsubscribe': {
                const i = this.subscriptions.findIndex((s) => s.id === p[0] && s.connection === connection);
                if (i >= 0) this.subscriptions.splice(i, 1);
                return { result: i >= 0 };
            }
            default:
                return this.#unknownMethod(method);
        }
    }

    #unknownMethod(method: string): Outcome {
        this.strays.push({ seq: nextSeq(), kind: 'method', method, detail: `unknown JSON-RPC method "${method}"` });
        // geth's own text for a method it does not serve.
        return { error: { code: -32601, message: `the method ${method} does not exist/is not available` } };
    }

    #nonceAt(address: string, tag: unknown): number {
        // 'latest' counts mined transactions only; 'pending' adds the public pool's contiguous run.
        // A relay acceptance moves neither (review HIGH on 23-01, reconciliation.ts:478).
        if (tag === 'pending') return this.pendingCount(address);
        const b = this.#resolveBlock(tag ?? 'latest');
        return this.minedCount(address, b ? b.number : this.#head.number);
    }

    #resolveBlock(tag: unknown): BlockRecord | null {
        if (tag === undefined || tag === 'latest' || tag === 'pending' || tag === 'safe' || tag === 'finalized') return this.#head;
        if (tag === 'earliest') return this.#blockAt(0);
        if (typeof tag === 'string' && tag.startsWith('0x')) return this.#blockAt(Number(BigInt(tag)));
        if (typeof tag === 'object' && tag !== null && 'blockNumber' in tag) return this.#blockAt(Number(BigInt((tag as { blockNumber: string }).blockNumber)));
        return null;
    }

    #blockAt(number: number): BlockRecord | null {
        if (number > this.#head.number || number < 0) return null;
        const stored = this.#blocks.get(number);
        if (stored) return stored;
        // An older block this scenario never touched: empty, 12 s apart, deterministic.
        const parentHash = keccak256(toUtf8Bytes(`realpath-block:${number - 1}`));
        const first = Math.min(...this.#blocks.keys());
        const firstBlock = this.#blocks.get(first)!;
        return {
            number,
            hash: number === first - 1 ? firstBlock.parentHash : blockHashOf(number, parentHash, []),
            parentHash,
            timestamp: firstBlock.timestamp - (first - number) * 12,
            baseFeePerGas: firstBlock.baseFeePerGas,
            gasLimit: DEFAULT_BLOCK_GAS_LIMIT,
            gasUsed: 0n,
            miner: MINER,
            transactions: [],
        };
    }

    #formatBlock(b: BlockRecord, fullTx: boolean, header: boolean): Record<string, unknown> {
        const out: Record<string, unknown> = {
            number: toQuantity(b.number),
            hash: b.hash,
            parentHash: b.parentHash,
            nonce: '0x0000000000000000',
            sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
            logsBloom: bloomOf(this.logs.filter((l) => l.blockHash === b.hash)),
            transactionsRoot: keccak256(concat([toUtf8Bytes('tx-root'), ...b.transactions])),
            stateRoot: keccak256(toUtf8Bytes(`state-root:${b.number}`)),
            receiptsRoot: keccak256(toUtf8Bytes(`receipts-root:${b.number}`)),
            miner: b.miner.toLowerCase(),
            difficulty: '0x0',
            totalDifficulty: '0xc70d815d562d3cfa955',
            extraData: '0x',
            size: toQuantity(1000 + b.transactions.length * 200),
            gasLimit: toQuantity(b.gasLimit),
            gasUsed: toQuantity(b.gasUsed),
            timestamp: toQuantity(b.timestamp),
            mixHash: keccak256(toUtf8Bytes(`mix:${b.number}`)),
        };
        // A chain with no EIP-1559 has no base fee and none of the later (Shanghai, Cancun) fields.
        if (!this.#legacy) {
            out.baseFeePerGas = toQuantity(b.baseFeePerGas);
            out.withdrawalsRoot = keccak256(toUtf8Bytes(`withdrawals:${b.number}`));
            out.blobGasUsed = '0x0';
            out.excessBlobGas = '0x0';
            out.parentBeaconBlockRoot = keccak256(toUtf8Bytes(`beacon:${b.number}`));
        }
        if (!header) {
            out.uncles = [];
            if (!this.#legacy) out.withdrawals = [];
            out.transactions = fullTx ? b.transactions.map((h) => this.#formatTxByHash(h)) : [...b.transactions];
        }
        return out;
    }

    #formatTxByHash(hash: string): Record<string, unknown> | null {
        const t = this.#txs.get(hash);
        if (!t) return null;
        // A private transaction (bundle, bloXroute) is invisible to a node until it is mined, and
        // a replaced or dropped one has left the pool.
        if (t.status !== 'mined' && (t.route === 'bundle' || t.route === 'bloxroute')) return null;
        if (t.status === 'replaced' || t.status === 'dropped') return null;
        const tx = t.tx;
        const block = t.block !== null ? this.#blocks.get(t.block)! : null;
        const sig = tx.signature!;
        const out: Record<string, unknown> = {
            hash: t.hash,
            from: t.from.toLowerCase(),
            to: tx.to ? tx.to.toLowerCase() : null,
            nonce: toQuantity(tx.nonce),
            gas: toQuantity(tx.gasLimit),
            value: toQuantity(tx.value),
            input: tx.data,
            chainId: toQuantity(tx.chainId),
            type: toQuantity(tx.type ?? 0),
            v: toQuantity(sig.v),
            r: sig.r,
            s: sig.s,
            yParity: toQuantity(sig.yParity),
            blockHash: block ? block.hash : null,
            blockNumber: block ? toQuantity(block.number) : null,
            transactionIndex: t.index !== null ? toQuantity(t.index) : null,
            accessList: [],
        };
        if (tx.type === 2) {
            out.maxFeePerGas = toQuantity(tx.maxFeePerGas ?? 0n);
            out.maxPriorityFeePerGas = toQuantity(tx.maxPriorityFeePerGas ?? 0n);
            out.gasPrice = toQuantity(this.#receipts.get(hash)?.effectiveGasPrice ?? tx.maxFeePerGas ?? 0n);
        } else {
            out.gasPrice = toQuantity(tx.gasPrice ?? 0n);
        }
        return out;
    }

    #formatReceipt(hash: string): Record<string, unknown> | null {
        const r = this.#receipts.get(hash);
        if (!r) return null;
        const t = this.#txs.get(hash)!;
        const block = this.#blocks.get(r.block)!;
        let cumulative = 0n;
        for (const h of block.transactions) {
            cumulative += this.#receipts.get(h)!.gasUsed;
            if (h === hash) break;
        }
        return {
            transactionHash: hash,
            transactionIndex: toQuantity(r.index),
            blockHash: block.hash,
            blockNumber: toQuantity(block.number),
            from: t.from.toLowerCase(),
            to: t.tx.to ? t.tx.to.toLowerCase() : null,
            cumulativeGasUsed: toQuantity(cumulative),
            gasUsed: toQuantity(r.gasUsed),
            effectiveGasPrice: toQuantity(r.effectiveGasPrice),
            contractAddress: null,
            logs: this.logs.filter((l) => l.transactionHash === hash),
            logsBloom: bloomOf(this.logs.filter((l) => l.transactionHash === hash)),
            status: toQuantity(r.status),
            type: toQuantity(t.tx.type ?? 0),
        };
    }

    #ethCall(p: unknown[], entry: CallLogEntry): Outcome {
        const tx = (p[0] ?? {}) as { to?: string; from?: string; data?: string; input?: string; value?: string };
        const data = (tx.data ?? tx.input ?? '0x').toLowerCase();
        const to = tx.to ? lc(tx.to) : '';
        const selector = data.slice(0, 10);
        const read = this.#reads.get(`${to}|${selector}`);
        if (!read) {
            this.strays.push({ seq: entry.seq, kind: 'read', method: 'eth_call', to, selector, detail: `unknown contract read ${selector} on ${to || '(no target)'}` });
            return { error: { code: -32000, message: 'execution reverted' } };
        }
        let result: ReadResult;
        if (typeof read.result === 'function') {
            const args = coder.decode(read.fragment.inputs, '0x' + data.slice(10));
            result = read.result({ to, from: tx.from, data, value: asBigInt(tx.value), blockTag: p[1], args });
        } else {
            result = read.result;
        }
        if (typeof result === 'string') return { result };
        // geth: code 3 with the revert data when there is any, -32000 when there is none.
        if (result.revert === '0x' || result.revert === '') return { error: { code: -32000, message: 'execution reverted' } };
        return { error: { code: 3, message: 'execution reverted', data: result.revert } };
    }

    /**
     * eth_getLogs with a geth node's rules: `blockHash` excludes a range; fromBlock and toBlock
     * default to latest; a named range with from above to is refused; a range wholly above the head
     * is empty and toBlock is capped at the head; address and topics filter as subscriptions do.
     */
    #getLogs(filter: unknown): Outcome {
        const f = (filter ?? {}) as { fromBlock?: unknown; toBlock?: unknown; blockHash?: string };
        if (f.blockHash !== undefined && f.blockHash !== null) {
            if (f.fromBlock !== undefined || f.toBlock !== undefined) {
                return { error: { code: -32602, message: 'invalid argument 0: cannot specify both BlockHash and FromBlock/ToBlock, choose one or the other' } };
            }
            const b = [...this.#blocks.values()].find((x) => x.hash === lc(f.blockHash));
            if (!b) return { error: { code: -32000, message: 'unknown block' } };
            return { result: this.logs.filter((l) => l.blockHash === b.hash && logMatches(l, filter)) };
        }
        const num = (tag: unknown): number => {
            if (tag === undefined || tag === null || tag === 'latest' || tag === 'pending' || tag === 'safe' || tag === 'finalized') return this.#head.number;
            if (tag === 'earliest') return 0;
            return Number(BigInt(String(tag)));
        };
        const from = num(f.fromBlock);
        const to = num(f.toBlock);
        if (from > to) return { error: { code: -32000, message: 'invalid block range params' } };
        const head = this.#head.number;
        if (from > head) return { result: [] };
        const top = to > head ? head : to;
        return {
            result: this.logs.filter((l) => {
                const n = Number(BigInt(l.blockNumber));
                return n >= from && n <= top && logMatches(l, filter);
            }),
        };
    }

    #subscribe(p: unknown[], connection: Connection | undefined): Outcome {
        if (!connection) return { error: { code: -32601, message: 'notifications not supported' } };
        const kind = String(p[0]);
        if (kind !== 'newHeads' && kind !== 'logs' && kind !== 'newPendingTransactions') {
            this.strays.push({ seq: nextSeq(), kind: 'method', method: 'eth_subscribe', detail: `unknown subscription kind "${kind}"` });
            return { error: { code: -32602, message: `no "${kind}" subscription in eth namespace` } };
        }
        this.#subSeq += 1;
        const id = toQuantity(BigInt(keccak256(toUtf8Bytes(`realpath-sub:${this.#subSeq}`))) >> 128n);
        this.subscriptions.push({ id, kind, filter: p[1] ?? {}, connection });
        this.#wakeSubscriptionWaiters();
        return { result: id };
    }

    #push(s: Subscription, result: unknown): void {
        s.connection.send(JSON.stringify({ jsonrpc: '2.0', method: 'eth_subscription', params: { subscription: s.id, result } }));
    }

    // -- relay (Flashbots JSON-RPC) ----------------------------------------------------------

    /** `entry` is already on `relay` (recorded on arrival, before any hold or fault). */
    async #relayMethod(method: string, params: unknown, entry: RelayEntry): Promise<Outcome | RelayHttpAnswer> {
        const override = this.#relayOverrides.get(method);
        if (override) return override(params, entry);
        const p0 = (Array.isArray(params) ? params[0] : undefined) as Record<string, unknown> | undefined;
        switch (method) {
            case 'eth_sendBundle':
                return this.#sendBundle(p0);
            case 'eth_callBundle':
                return this.#callBundle(p0);
            case 'flashbots_getBundleStatsV2':
                return this.#bundleStats(p0);
            default:
                return this.#unknownMethod(method);
        }
    }

    #sendBundle(p: Record<string, unknown> | undefined): Outcome {
        const txs = (p?.txs ?? []) as string[];
        const target = Number(BigInt(String(p?.blockNumber ?? '0x0')));
        const hashes: string[] = [];
        for (const raw of txs) {
            const tx = Transaction.from(raw);
            const hash = tx.hash!;
            hashes.push(hash);
            let sub = this.submitted.find((s) => s.hash === hash);
            if (!sub) {
                sub = { raw, hash, tx, route: 'bundle', status: 'accepted', targetBlocks: [], block: null };
                this.#pushSubmitted(sub);
                if (!this.#txs.has(hash)) this.#txs.set(hash, { seq: nextSeq(), raw, hash, tx, from: tx.from!, route: 'bundle', status: 'accepted', block: null, index: null });
            }
            if (!sub.targetBlocks.includes(target)) {
                sub.targetBlocks.push(target);
                this.history.push({ seq: nextSeq(), event: 'accepted', hash, from: tx.from!, nonce: tx.nonce, route: 'bundle', block: target });
            }
        }
        return { result: { bundleHash: bundleHashOf(hashes) } };
    }

    #callBundle(p: Record<string, unknown> | undefined): Outcome {
        const txs = (p?.txs ?? []) as string[];
        const baseFee = this.#legacy ? 0n : this.#head.baseFeePerGas;
        let totalGas = 0;
        let totalFees = 0n;
        const results = txs.map((raw) => {
            const tx = Transaction.from(raw);
            const gasUsed = Number(tx.gasLimit < DEFAULT_ESTIMATE ? tx.gasLimit : DEFAULT_ESTIMATE);
            const priority = tx.type === 2 ? tx.maxPriorityFeePerGas! : (tx.gasPrice ?? 0n) - baseFee;
            const gasPrice = tx.type === 2 ? baseFee + priority : (tx.gasPrice ?? 0n);
            const fees = BigInt(gasUsed) * gasPrice;
            totalGas += gasUsed;
            totalFees += fees;
            return {
                coinbaseDiff: (BigInt(gasUsed) * priority).toString(),
                ethSentToCoinbase: '0',
                fromAddress: tx.from,
                gasFees: fees.toString(),
                gasPrice: gasPrice.toString(),
                gasUsed,
                toAddress: tx.to,
                txHash: tx.hash,
                value: '0x',
            };
        });
        return {
            result: {
                bundleGasPrice: totalGas > 0 ? (totalFees / BigInt(totalGas)).toString() : '0',
                bundleHash: bundleHashOf(results.map((r) => r.txHash!)),
                coinbaseDiff: results.reduce((a, r) => a + BigInt(r.coinbaseDiff), 0n).toString(),
                ethSentToCoinbase: '0',
                gasFees: totalFees.toString(),
                results,
                stateBlockNumber: this.#head.number,
                totalGasUsed: totalGas,
            },
        };
    }

    #bundleStats(p: Record<string, unknown> | undefined): Outcome {
        const block = Number(BigInt(String(p?.blockNumber ?? '0x0')));
        const bundleHash = String(p?.bundleHash ?? '');
        const sub = this.submitted.find((s) => bundleHashOf([s.hash]) === bundleHash);
        const at = new Date(Date.now()).toISOString();
        const builder = { pubkey: '0x' + 'ab'.repeat(48), timestamp: at };
        return {
            result: {
                isHighPriority: true,
                isSimulated: true,
                simulatedAt: at,
                receivedAt: at,
                consideredByBuildersAt: sub ? [builder] : [],
                sealedByBuildersAt: sub && sub.block === block ? [builder] : [],
            },
        };
    }
}

// ---------------------------------------------------------------------------------------------
// Faults and holds
// ---------------------------------------------------------------------------------------------

/** Narrows a fault or hold to one exact operation. */
export interface OperationMatch {
    /** 4-byte selector (`0x0902f1ac`) or human signature (`getReserves()`); eth_call / eth_estimateGas only. */
    selector?: string;
    /** Call target (eth_call, eth_estimateGas) or queried address (eth_getBalance, eth_getCode, eth_getTransactionCount). */
    to?: string;
    /** Armed only while this returns true (for example once the scenario reached a stage). */
    after?: () => boolean;
}

export interface FaultOptions extends OperationMatch {
    /** How many matching calls fail (default 1). */
    times?: number;
    /** The JSON-RPC error returned (default code -32000 naming the injected fault). */
    error?: JsonRpcError;
}

export interface FaultHandle {
    readonly kind: 'fault';
    readonly method: string;
    /** Matching calls this fault has failed so far. */
    readonly fired: number;
    readonly times: number;
    describe(): string;
}

export interface HoldHandle {
    readonly kind: 'hold';
    readonly method: string;
    /** Calls this hold has parked so far. */
    readonly heldCount: number;
    /** Same as heldCount: a hold "fired" once it parked a call. */
    readonly fired: number;
    /** Calls parked right now. */
    readonly parkedNow: number;
    readonly released: boolean;
    /** Answer every parked call normally and end the hold (later calls pass). */
    release(): void;
    describe(): string;
}

export type { JsonRpcError };

interface Operation {
    method: string;
    params: unknown;
    to: string | undefined;
    selector: string | undefined;
}

interface NormalisedMatch {
    selector?: string;
    to?: string;
    after?: () => boolean;
    text: string;
}

const SELECTOR_METHODS = new Set(['eth_call', 'eth_estimateGas']);
const ADDRESS_METHODS = new Set(['eth_call', 'eth_estimateGas', 'eth_getBalance', 'eth_getCode', 'eth_getTransactionCount']);

/** Validate a match at arming time, so a fault that could never match fails at once, by name. */
function normaliseMatch(method: string, m: OperationMatch): NormalisedMatch {
    if (typeof method !== 'string' || method === '') throw new Error('fault/hold: a method name is required');
    let selector: string | undefined;
    if (m.selector !== undefined) {
        if (!SELECTOR_METHODS.has(method)) throw new Error(`fault/hold on ${method}: selector applies only to ${[...SELECTOR_METHODS].join(', ')}`);
        selector = m.selector.includes('(') ? FunctionFragment.from(m.selector).selector : m.selector.toLowerCase();
        if (!/^0x[0-9a-f]{8}$/.test(selector)) throw new Error(`fault/hold on ${method}: "${m.selector}" is not a 4-byte selector or a function signature`);
    }
    let to: string | undefined;
    if (m.to !== undefined) {
        if (!ADDRESS_METHODS.has(method)) throw new Error(`fault/hold on ${method}: to applies only to ${[...ADDRESS_METHODS].join(', ')}`);
        to = getAddress(m.to).toLowerCase();
    }
    const parts = [`"${method}"`];
    if (m.selector !== undefined) parts.push(`selector ${m.selector}${m.selector.includes('(') ? ` (${selector})` : ''}`);
    if (to) parts.push(`to ${to}`);
    if (m.after) parts.push('after <predicate>');
    return { selector, to, after: m.after, text: parts.join(', ') };
}

/** The address an operation targets, lower-case, for the `to` match. */
function targetOf(method: string, params: unknown): string | undefined {
    const p = Array.isArray(params) ? params : [];
    if (SELECTOR_METHODS.has(method)) {
        const t = (p[0] ?? {}) as { to?: string };
        return t.to ? lc(t.to) : undefined;
    }
    if (ADDRESS_METHODS.has(method)) return typeof p[0] === 'string' ? lc(p[0]) : undefined;
    return undefined;
}

function matches(m: NormalisedMatch, method: string, op: Operation): boolean {
    if (op.method !== method) return false;
    if (m.selector !== undefined && op.selector !== m.selector) return false;
    if (m.to !== undefined && op.to !== m.to) return false;
    if (m.after && !m.after()) return false;
    return true;
}

class Fault implements FaultHandle {
    readonly kind = 'fault' as const;
    readonly method: string;
    readonly times: number;
    readonly error: JsonRpcError;
    readonly #match: NormalisedMatch;
    #fired = 0;

    constructor(method: string, match: NormalisedMatch, times: number, error: JsonRpcError | undefined) {
        if (!Number.isInteger(times) || times < 1) throw new Error(`failNext ${match.text}: times must be a positive integer, got ${times}`);
        this.method = method;
        this.times = times;
        this.#match = match;
        this.error = error ?? { code: -32000, message: `realpath harness: injected fault on ${method}` };
    }

    get fired(): number {
        return this.#fired;
    }

    /** True, and counted, when this fault takes the call. A spent fault takes nothing. */
    claims(op: Operation): boolean {
        if (this.#fired >= this.times || !matches(this.#match, this.method, op)) return false;
        this.#fired += 1;
        return true;
    }

    describe(): string {
        return `failNext(${this.#match.text}, times ${this.times}): fired ${this.#fired} of ${this.times}`;
    }
}

class Hold implements HoldHandle {
    readonly kind = 'hold' as const;
    readonly method: string;
    readonly #match: NormalisedMatch;
    #held = 0;
    #released = false;
    #waiting: Array<(teardownError: JsonRpcError | undefined) => void> = [];

    constructor(method: string, match: NormalisedMatch) {
        this.method = method;
        this.#match = match;
    }

    get heldCount(): number {
        return this.#held;
    }

    get fired(): number {
        return this.#held;
    }

    get parkedNow(): number {
        return this.#waiting.length;
    }

    get released(): boolean {
        return this.#released;
    }

    claims(op: Operation): boolean {
        return !this.#released && matches(this.#match, this.method, op);
    }

    /** Resolves on release (undefined: answer normally) or teardown (the error to answer with). */
    park(): Promise<JsonRpcError | undefined> {
        this.#held += 1;
        return new Promise((resolve) => this.#waiting.push(resolve));
    }

    release(): void {
        this.#released = true;
        for (const w of this.#waiting.splice(0)) w(undefined);
    }

    releaseForTeardown(): number {
        this.#released = true;
        const waiting = this.#waiting.splice(0);
        for (const w of waiting) w({ code: -32000, message: `realpath harness: the scenario was torn down while ${this.method} was held` });
        return waiting.length;
    }

    describe(): string {
        return `hold(${this.#match.text}): held ${this.#held} call(s)${this.#released ? ', released' : ''}`;
    }
}

function bundleHashOf(txHashes: string[]): string {
    return keccak256('0x' + txHashes.map((h) => h.slice(2)).join(''));
}

export interface MineOptions {
    /** Base fee of the new block (default: the parent's). */
    baseFeePerGas?: bigint;
    /** Exact hashes to include, in order (default: every includable public pending transaction). */
    include?: string[];
    /** Hashes left out of this block only. */
    exclude?: string[];
    /**
     * Real-encoded logs stored in the new block, after any setReceiptLogs logs. Each names the
     * mined transaction it came from (optional when the block holds exactly one).
     */
    logs?: LogInput[];
}

/** A log before the node places it: the positional fields come from the block it lands in. */
export interface LogInput {
    address: string;
    topics: string[];
    data: string;
    transactionHash?: string;
}

interface ReceiptRule {
    to: string | undefined;
    selector: string | undefined;
    make: (tx: Transaction) => LogInput[];
}

function receiptRuleMatches(rule: ReceiptRule, tx: Transaction): boolean {
    if (rule.to !== undefined && (tx.to === null || tx.to.toLowerCase() !== rule.to)) return false;
    if (rule.selector !== undefined && tx.data.slice(0, 10).toLowerCase() !== rule.selector) return false;
    return true;
}

/** geth bloom9: three 11-bit indexes from keccak256 of each address and topic. */
function bloomOf(logs: Array<{ address: string; topics: string[] }>): string {
    const bits = new Uint8Array(256);
    const add = (hex: string): void => {
        const h = ethers.getBytes(keccak256(hex));
        for (let i = 0; i < 6; i += 2) {
            const v = ((h[i] << 8) | h[i + 1]) & 2047;
            bits[255 - (v >> 3)] |= 1 << (v & 7);
        }
    };
    for (const l of logs) {
        add(l.address);
        for (const t of l.topics) add(t);
    }
    return ethers.hexlify(bits);
}

function minBig(a: bigint, b: bigint): bigint {
    return a < b ? a : b;
}

/** The fee cap a pool compares: maxFeePerGas for EIP-1559, gasPrice otherwise. */
function feeCap(tx: Transaction): bigint {
    return tx.type === 2 ? tx.maxFeePerGas! : (tx.gasPrice ?? 0n);
}

/** The tip a pool compares: maxPriorityFeePerGas for EIP-1559, gasPrice otherwise. */
function tipCap(tx: Transaction): bigint {
    return tx.type === 2 ? tx.maxPriorityFeePerGas! : (tx.gasPrice ?? 0n);
}

/** geth tx.Cost(): gas limit times fee cap, plus value. */
function txCost(tx: Transaction): bigint {
    return tx.gasLimit * feeCap(tx) + tx.value;
}

/** geth core.IntrinsicGas after Shanghai (EIP-2028 calldata, EIP-2930 access list, EIP-3860 initcode). */
function intrinsicGas(tx: Transaction): bigint {
    const creation = tx.to === null;
    let gas = creation ? 53_000n : 21_000n;
    const data = ethers.getBytes(tx.data);
    for (const b of data) gas += b === 0 ? 4n : 16n;
    if (creation) gas += 2n * BigInt(Math.ceil(data.length / 32));
    for (const entry of tx.accessList ?? []) gas += 2_400n + 1_900n * BigInt(entry.storageKeys.length);
    return gas;
}

/** eth_subscribe / eth_getLogs filter: address (one or a list) and positional topics with OR lists. */
export function logMatches(log: FakeLog, filter: unknown): boolean {
    const f = (filter ?? {}) as { address?: string | string[]; topics?: Array<string | string[] | null> };
    if (f.address !== undefined && f.address !== null) {
        const list = (Array.isArray(f.address) ? f.address : [f.address]).map(lc);
        if (list.length > 0 && !list.includes(lc(log.address))) return false;
    }
    const topics = f.topics ?? [];
    for (let i = 0; i < topics.length; i++) {
        const want = topics[i];
        if (want === null || want === undefined) continue;
        const have = log.topics[i];
        if (have === undefined) return false;
        const options = (Array.isArray(want) ? want : [want]).map(lc);
        if (options.length > 0 && !options.includes(lc(have))) return false;
    }
    return true;
}

/** A deterministic synthetic address derived from a label (D-04: no captured data). */
export function labelAddress(label: string): string {
    return getAddress('0x' + keccak256(toUtf8Bytes(`realpath:${label}`)).slice(26));
}
