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
//
// The count at `latest` moves only when a transaction is mined. A relay acceptance changes no
// count and a receipt is a valid null until mine() includes that hash (review HIGH on 23-01:
// production stops retrying once `latest` moves, src/utils/mevStrategies/reconciliation.ts:478).
// Plan 23-28 adds the public route's nonce and chain ID rules, fee schedules, receipt logs and
// replacements on this base.

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
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
    logs: LogSinkEntry[];
    alerts: Array<{ seq: number; fn: string; args: unknown[] }>;
    broadcasts: Array<{ seq: number; type: string; data: unknown }>;
    httpRoutes: HttpRoute[];
    httpLog: Array<{ seq: number; method: string; url: string; data: unknown; matched: boolean }>;
    telegram: { clients: unknown[] };
    /** Awaited by disposeScenarios() in reverse order. */
    disposers: Array<() => Promise<void>>;
    /** Set by world.ts; the axios mock in setup.ts delegates to it. */
    routeAxios: ((method: string, url: string, data: unknown, config: unknown) => Promise<unknown>) | null;
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
            telegram: { clients: [] },
            disposers: [],
            routeAxios: null,
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
 * send, ping, terminate, close, readyState, onopen, onmessage, onclose (src/ calls
 * `.websocket.on('close' | 'pong')`, `ping()` and `terminate()` directly).
 * Events are delivered on the microtask queue, so ordering is exact and needs no timer.
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

    constructor(url: string | URL, _protocols?: unknown, _options?: unknown) {
        super();
        this.url = String(url);
        const self = this;
        this.connection = {
            send(text: string): void {
                self.#deliver(text);
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
        this.#node = node;
        node.attachSocket(this);
        this.#state = OPEN;
        this.emit('open');
        this.onopen?.({ type: 'open', target: this });
    }

    send(data: unknown, cb?: (err?: Error) => void): void {
        if (this.#state !== OPEN) {
            const names = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
            const err = new Error(`WebSocket is not open: readyState ${this.#state} (${names[this.#state]})`);
            if (cb) {
                cb(err);
                return;
            }
            throw err;
        }
        const text = typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf8');
        const node = this.#node!;
        void node.handle(text, this.connection, { endpoint: 'ws', url: this.url }).then((reply) => {
            if (reply !== undefined) this.#deliver(JSON.stringify(reply));
        });
        cb?.();
    }

    #deliver(text: string): void {
        if (this.#state !== OPEN) return;
        this.emit('message', Buffer.from(text, 'utf8'), false);
        this.onmessage?.({ data: text, type: 'message', target: this });
    }

    ping(_data?: unknown): void {
        if (this.#state !== OPEN) return;
        // A real node answers a ping frame with a pong frame.
        queueMicrotask(() => {
            if (this.#state === OPEN) this.emit('pong', Buffer.alloc(0));
        });
    }

    terminate(): void {
        if (this.#state === CLOSED) return;
        this.#closeNow(1006, '');
    }

    close(code = 1000, reason = ''): void {
        if (this.#state === CLOSED || this.#state === CLOSING) return;
        if (this.#state === CONNECTING) {
            this.#closeNow(1006, '');
            return;
        }
        this.#state = CLOSING;
        queueMicrotask(() => this.#closeNow(code, reason));
    }

    /** Server-initiated close (FakeNode.dropSocket). */
    serverClose(code = 1006, reason = ''): void {
        if (this.#state === CLOSED) return;
        this.#closeNow(code, reason);
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

export interface HistoryEvent {
    seq: number;
    event: 'accepted' | 'mined';
    hash: string;
    from: string;
    nonce: number;
    route: string;
    block: number;
}

export interface Subscription {
    id: string;
    kind: string;
    filter: unknown;
    connection: Connection;
}

export interface Submitted {
    raw: string;
    hash: string;
    tx: Transaction;
    route: 'bundle';
    status: 'accepted' | 'mined';
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
    raw: string;
    hash: string;
    tx: Transaction;
    from: string;
    route: string;
    status: 'accepted' | 'mined';
    block: number | null;
    index: number | null;
}

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

export type RelayHandler = (params: unknown, entry: RelayEntry) => Outcome | Promise<Outcome>;

const ZERO_HASH = '0x' + '00'.repeat(32);
const ZERO_BLOOM = '0x' + '00'.repeat(256);
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
    #head: BlockRecord;
    #subSeq = 0;

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

    /** Override the response of a relay method such as eth_callBundle. */
    setRelay(method: string, handler: RelayHandler): void {
        this.#relayOverrides.set(method, handler);
    }

    /** Placeholder for plan 23-01 Task 2 (holds); nothing is parked yet. */
    releaseAll(): void {
        // Task 2 adds hold(); until then there is never a parked call.
    }

    // -- transactions from other actors ------------------------------------------------------

    /** A signed transaction from an actor other than the bot, waiting in the public pool. */
    addForeignTransaction(raw: string): string {
        const tx = Transaction.from(raw);
        if (!tx.from || !tx.hash) throw new Error('addForeignTransaction: the transaction is not signed');
        const known: KnownTx = { raw, hash: tx.hash, tx, from: tx.from, route: 'foreign', status: 'accepted', block: null, index: null };
        this.#txs.set(tx.hash, known);
        this.foreign.push(known);
        this.history.push({ seq: nextSeq(), event: 'accepted', hash: tx.hash, from: tx.from, nonce: tx.nonce, route: 'foreign', block: this.#head.number + 1 });
        return tx.hash;
    }

    /** True once mine() has included `hash`. */
    isMined(hash: string): boolean {
        return this.#receipts.has(hash);
    }

    minedCount(address: string, atBlock = this.#head.number): number {
        let n = 0;
        for (const t of this.#txs.values()) if (t.status === 'mined' && t.block !== null && t.block <= atBlock && lc(t.from) === lc(address)) n += 1;
        return n;
    }

    /**
     * Mine one block. `include` names exact hashes; each must be waiting, carry the sender's next
     * nonce and this chain's ID, and, for a bundle, target this block, or mine() throws (a real
     * block could not hold it). Returns the new block number.
     */
    mine(opts: { baseFeePerGas?: bigint; include?: string[] } = {}): number {
        const number = this.#head.number + 1;
        const include = opts.include ?? [];
        const nextNonce = new Map<string, number>();
        const picked: KnownTx[] = [];
        for (const hash of include) {
            const t = this.#txs.get(hash);
            if (!t) throw new Error(`mine: ${hash} was never accepted by this node`);
            if (t.status !== 'accepted') throw new Error(`mine: ${hash} is already mined`);
            if (t.tx.chainId !== BigInt(this.chainId)) throw new Error(`mine: ${hash} is signed for chain ${t.tx.chainId}, this node is chain ${this.chainId}`);
            const sub = this.submitted.find((s) => s.hash === hash);
            if (sub && !sub.targetBlocks.includes(number)) {
                throw new Error(`mine: bundle ${hash} targets blocks ${sub.targetBlocks.join(', ')}, not ${number}`);
            }
            const key = lc(t.from);
            const expected = nextNonce.get(key) ?? this.minedCount(t.from);
            if (t.tx.nonce !== expected) throw new Error(`mine: ${hash} has nonce ${t.tx.nonce} but the next nonce for ${t.from} is ${expected}`);
            nextNonce.set(key, expected + 1);
            picked.push(t);
        }
        const baseFeePerGas = opts.baseFeePerGas ?? this.#head.baseFeePerGas;
        const parent = this.#head;
        const hashes = picked.map((t) => t.hash);
        let gasUsed = 0n;
        picked.forEach((t, index) => {
            const used = t.tx.gasLimit < DEFAULT_ESTIMATE ? t.tx.gasLimit : DEFAULT_ESTIMATE;
            gasUsed += used;
            const effectiveGasPrice =
                t.tx.type === 2
                    ? (t.tx.maxFeePerGas! < baseFeePerGas + t.tx.maxPriorityFeePerGas! ? t.tx.maxFeePerGas! : baseFeePerGas + t.tx.maxPriorityFeePerGas!)
                    : (t.tx.gasPrice ?? 0n);
            t.status = 'mined';
            t.block = number;
            t.index = index;
            this.#receipts.set(t.hash, { hash: t.hash, block: number, index, gasUsed: used, effectiveGasPrice, status: 1 });
            const sub = this.submitted.find((s) => s.hash === t.hash);
            if (sub) {
                sub.status = 'mined';
                sub.block = number;
            }
            this.history.push({ seq: nextSeq(), event: 'mined', hash: t.hash, from: t.from, nonce: t.tx.nonce, route: t.route, block: number });
        });
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
        for (const s of this.subscriptions) {
            if (s.kind === 'newHeads') this.#push(s, this.#formatBlock(block, false, true));
        }
        return number;
    }

    blockHash(number: number): string {
        return this.#blockAt(number)?.hash ?? ZERO_HASH;
    }

    /** Deliver logs, in exactly the given order, to every logs subscription whose filter matches. */
    emitLogs(logs: FakeLog[]): void {
        for (const log of logs) {
            this.logs.push(log);
            for (const s of this.subscriptions) {
                if (s.kind === 'logs' && logMatches(log, s.filter)) this.#push(s, log);
            }
        }
    }

    /** Server-side close of every open socket on this node (default code 1006, abnormal). */
    dropSocket(code = 1006): void {
        for (const ws of [...this.#sockets]) ws.serverClose(code, '');
    }

    attachSocket(ws: FakeWebSocket): void {
        this.#sockets.add(ws);
    }

    detachSocket(ws: FakeWebSocket): void {
        this.#sockets.delete(ws);
        for (let i = this.subscriptions.length - 1; i >= 0; i--) {
            if (this.subscriptions[i].connection === ws.connection) this.subscriptions.splice(i, 1);
        }
    }

    // -- JSON-RPC entry point ----------------------------------------------------------------

    /**
     * The one entry point for every JSON-RPC call (HTTP, WebSocket and relay). `body` is one
     * request or a batch (object, array or JSON text); `connection` is the server-side end a
     * subscription delivers through (FakeWebSocket passes its own; HTTP leaves it out).
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
        let outcome: Outcome;
        try {
            outcome = await this.#dispatch(method, params, connection, via, entry);
        } catch (e) {
            // A harness bug must not look like a node answer: fail loudly in afterEach as well.
            const detail = `harness error answering ${method}: ${e instanceof Error ? e.message : String(e)}`;
            this.strays.push({ seq: nextSeq(), kind: 'method', method, detail });
            outcome = { error: { code: -32603, message: 'internal error' } };
        }
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

    async #dispatch(method: string, params: unknown, connection: Connection | undefined, via: Via, entry: CallLogEntry): Promise<Outcome> {
        if (via.endpoint === 'relay') return this.#relayMethod(method, params, via);
        const p = (Array.isArray(params) ? params : []) as unknown[];
        switch (method) {
            case 'eth_chainId':
                return { result: toQuantity(this.chainId) };
            case 'net_version':
                return { result: String(this.chainId) };
            case 'eth_blockNumber':
                return { result: toQuantity(this.#head.number) };
            case 'eth_gasPrice':
                return { result: toQuantity(this.#head.baseFeePerGas + this.priorityFeePerGas) };
            case 'eth_maxPriorityFeePerGas':
                return { result: toQuantity(this.priorityFeePerGas) };
            case 'eth_estimateGas':
                return { result: toQuantity(DEFAULT_ESTIMATE) };
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
            case 'eth_getTransactionReceipt':
                return { result: this.#formatReceipt(String(p[0])) };
            case 'eth_getTransactionByHash':
                return { result: this.#formatTxByHash(String(p[0])) };
            case 'eth_call':
                return this.#ethCall(p, entry);
            case 'eth_getLogs':
                return { result: this.#getLogs(p[0]) };
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
        if (tag === 'pending') {
            let n = this.minedCount(address);
            for (const t of this.foreign) if (t.status === 'accepted' && lc(t.from) === lc(address)) n += 1;
            return n;
        }
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
            logsBloom: ZERO_BLOOM,
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
            baseFeePerGas: toQuantity(b.baseFeePerGas),
            mixHash: keccak256(toUtf8Bytes(`mix:${b.number}`)),
            withdrawalsRoot: keccak256(toUtf8Bytes(`withdrawals:${b.number}`)),
            blobGasUsed: '0x0',
            excessBlobGas: '0x0',
            parentBeaconBlockRoot: keccak256(toUtf8Bytes(`beacon:${b.number}`)),
        };
        if (!header) {
            out.uncles = [];
            out.withdrawals = [];
            out.transactions = fullTx ? b.transactions.map((h) => this.#formatTxByHash(h)) : [...b.transactions];
        }
        return out;
    }

    #formatTxByHash(hash: string): Record<string, unknown> | null {
        const t = this.#txs.get(hash);
        if (!t) return null;
        // A private bundle is invisible to a node until it is mined.
        if (t.status !== 'mined' && t.route === 'bundle') return null;
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
            logsBloom: ZERO_BLOOM,
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

    #getLogs(filter: unknown): FakeLog[] {
        const f = (filter ?? {}) as { fromBlock?: unknown; toBlock?: unknown; blockHash?: string };
        const from = this.#resolveBlock(f.fromBlock ?? 'latest')?.number ?? 0;
        const to = this.#resolveBlock(f.toBlock ?? 'latest')?.number ?? this.#head.number;
        return this.logs.filter((l) => {
            const n = Number(BigInt(l.blockNumber));
            if (f.blockHash) return l.blockHash === lc(f.blockHash) && logMatches(l, filter);
            return n >= from && n <= to && logMatches(l, filter);
        });
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
        return { result: id };
    }

    #push(s: Subscription, result: unknown): void {
        s.connection.send(JSON.stringify({ jsonrpc: '2.0', method: 'eth_subscription', params: { subscription: s.id, result } }));
    }

    // -- relay (Flashbots JSON-RPC) ----------------------------------------------------------

    async #relayMethod(method: string, params: unknown, via: Via): Promise<Outcome> {
        const entry: RelayEntry = { seq: nextSeq(), method, params, url: via.url };
        this.relay.push(entry);
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
                this.submitted.push(sub);
                this.#txs.set(hash, { raw, hash, tx, from: tx.from!, route: 'bundle', status: 'accepted', block: null, index: null });
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
        const baseFee = this.#head.baseFeePerGas;
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

function bundleHashOf(txHashes: string[]): string {
    return keccak256('0x' + txHashes.map((h) => h.slice(2)).join(''));
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
