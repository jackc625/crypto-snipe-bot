// test/realpath/triage/fixtures/loopbackChain.ts
// Phase 23 plan 23-12 (AUDIT-02, D-02, D-04, AC-48): the outside world for the crash-class
// fixtures. Each fixture runs as its own railed child process (a worker cannot observe a real
// process death, RESEARCH Pitfall 3), so it brings its own chain: one real `http` JSON-RPC
// endpoint and, on a SEPARATE loopback port, one real `ws` WebSocketServer speaking JSON-RPC.
// Separate ports let a fixture close only the WebSocket listener, which gives a genuine refused
// connect while HTTP reads keep answering.
//
// The chain is `eth` (chain ID 1) at head block 100. Every value it answers is built with real
// ethers encoders (D-04) and is something a real node or relay can return (AC-48):
//   node methods  eth_chainId, eth_blockNumber, eth_getBlockByNumber, eth_gasPrice,
//                 eth_maxPriorityFeePerGas, eth_getBalance, eth_getTransactionCount,
//                 eth_getTransactionReceipt, eth_getLogs, eth_call, and over the socket
//                 eth_subscribe / eth_unsubscribe;
//   relay methods eth_callBundle, eth_sendBundle, flashbots_getBundleStatsV2 (the Flashbots
//                 relay is served on the same HTTP port, as a fixture sets relayUrl to it).
// Single and batch bodies are both accepted, as ethers sends both.
//
// Anything else (an unknown method, or an eth_call no fixture answers) is a setup error: the
// chain prints FIXTURE_SETUP_ERROR and the child exits 3, so a proof can never pass on a path
// a fixture did not foresee (the fixture contract in 23-12-PLAN.md Proof rule 4).
//
// Per-run options (so the fixtures need no change to this file):
//   blockAnswer(n)  the answer to eth_getBlockByNumber for block n: 'default' (an empty block
//                   when n <= head, else null, as a real node answers a future block), null (a
//                   load-balanced node behind its own head), or the block's transaction hashes;
//   logs(filter)    the logs eth_getLogs returns;
//   ethCall(call)   the answer to an eth_call ({ result } or a geth-shaped { error });
//   onFirstSendBundle(body)  called once, on the first eth_sendBundle;
//   onRequest / onAnswered   observers of every request and of every answer.
// Fixture controls:
//   pushLog(log)               deliver a log to every live `logs` subscription it matches;
//   dropSockets({ closePort }) end every live WebSocket from the server side (the client sees
//                              an abnormal close); with closePort the listener closes too, so
//                              the next connect is refused;
//   reopenWs()                 listen again on the same WebSocket port;
//   wsMark() / wsConnectedAfter(mark, { subscribed })  whether a WebSocket connection accepted
//                              after `mark` is open now (and, with subscribed, carries a live
//                              `logs` subscription): the fixtures' "the bot is connected again"
//                              check. A WebSocketProvider given its chain ID sends nothing until
//                              it is asked, so an open connection, not an answered request, is
//                              what a reconnect leaves behind (measured).
// The chain uses no timer of its own and never touches the bot: it is only the outside world.

import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { AbiCoder, Transaction, concat, keccak256, toBeHex, toQuantity, toUtf8Bytes, zeroPadValue } from 'ethers';
import { WebSocketServer, type WebSocket } from 'ws';

export const CHAIN_ID = 1n;
export const START_HEAD = 100;
const GWEI = 1_000_000_000n;
export const BASE_FEE = 10n * GWEI;
export const PRIORITY_FEE = 1n * GWEI;
const BLOCK_GAS_LIMIT = 30_000_000n;
const MINER = '0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5';
const GENESIS_TS = 1_767_225_600; // 2026-01-01T00:00:00Z, 12 s per block below

/** The fixture contract's stdout markers are written synchronously so a crash cannot lose them. */
export function mark(line: string): void {
    fs.writeSync(1, `${line}\n`);
}

/** A fixture's own setup failed (or the chain met a request it does not know): exit 3. */
export function setupError(why: string): never {
    mark(`FIXTURE_SETUP_ERROR ${why.replace(/\s+/g, ' ').slice(0, 400)}`);
    process.exit(3);
}

export type BlockAnswer = 'default' | null | { transactions: string[] };

export interface RpcRequest {
    via: 'http' | 'ws';
    /** WebSocket connection number (1, 2, ...) for via ws. */
    conn?: number;
    method: string;
    params: unknown[];
}

export interface LogJson {
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

export interface EthCallAnswer {
    result?: string;
    error?: { code: number; message: string; data?: string };
}

export interface LoopbackChainOptions {
    blockAnswer?: (n: number) => BlockAnswer;
    logs?: (filter: Record<string, unknown>) => LogJson[];
    ethCall?: (call: { to: string; data: string }) => EthCallAnswer | undefined;
    onFirstSendBundle?: (params: Record<string, unknown>) => void;
    onRequest?: (r: RpcRequest) => void;
    onAnswered?: (r: RpcRequest, result: unknown) => void;
    /** Balance answered for any address (default 10 ETH). */
    balanceWei?: bigint;
    /** Bind the WebSocket listener on this port and start it closed (a boot-time refusal). */
    wsStartsClosed?: boolean;
}

export interface LoopbackChain {
    readonly httpUrl: string;
    readonly wsUrl: string;
    readonly wsPort: number;
    readonly head: number;
    setHead(n: number): void;
    /** Mine these signed transactions into `block`, each with a status-1 receipt. */
    include(block: number, rawTxs: string[]): void;
    readonly requests: RpcRequest[];
    readonly openSockets: number;
    pushLog(log: LogJson): number;
    /** Live `logs` subscriptions (all sockets). */
    readonly logSubscriptions: number;
    dropSockets(opts: { closePort: boolean }): Promise<void>;
    reopenWs(): Promise<void>;
    wsMark(): number;
    wsConnectedAfter(mark: number, opts?: { subscribed?: boolean }): boolean;
    close(): Promise<void>;
}

interface Sub {
    id: string;
    kind: string;
    filter: Record<string, unknown>;
    conn: number;
}

const lc = (v: unknown): string => String(v).toLowerCase();

export function blockHash(n: number): string {
    return keccak256(toUtf8Bytes(`loopback-chain-block:${n}`));
}

/** A real-shaped log; `data` and topics come from real ethers encoders at the call site. */
export function makeLog(address: string, topics: string[], data: string, block: number, logIndex = 0): LogJson {
    return {
        address: lc(address),
        topics,
        data,
        blockNumber: toQuantity(block),
        blockHash: blockHash(block),
        transactionHash: keccak256(toUtf8Bytes(`loopback-chain-tx:${block}:${logIndex}`)),
        transactionIndex: '0x0',
        logIndex: toQuantity(logIndex),
        removed: false,
    };
}

/** Topic of an address argument (indexed address). */
export function addressTopic(a: string): string {
    return zeroPadValue(lc(a), 32);
}

function topicMatches(want: unknown, have: string | undefined): boolean {
    if (want === null || want === undefined) return true;
    if (Array.isArray(want)) return want.some((w) => w === null || lc(w) === lc(have));
    return lc(want) === lc(have);
}

export function logMatches(log: LogJson, filter: Record<string, unknown>): boolean {
    const addr = filter.address;
    if (addr !== undefined && addr !== null) {
        const list = Array.isArray(addr) ? addr : [addr];
        if (!list.some((a) => lc(a) === log.address)) return false;
    }
    const topics = (filter.topics ?? []) as unknown[];
    for (let i = 0; i < topics.length; i++) if (!topicMatches(topics[i], log.topics[i])) return false;
    return true;
}

function bundleHashOf(txHashes: string[]): string {
    return keccak256('0x' + txHashes.map((h) => h.slice(2)).join(''));
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const parts: Buffer[] = [];
        req.on('data', (c: Buffer) => parts.push(c));
        req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
        req.on('error', reject);
    });
}

function listen(server: http.Server, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            server.off('error', reject);
            resolve((server.address() as AddressInfo).port);
        });
    });
}

/** A free loopback port: bind port 0, read it, close it. */
export async function freePort(): Promise<number> {
    const s = http.createServer();
    const port = await listen(s, 0);
    await new Promise<void>((r) => s.close(() => r()));
    return port;
}

export async function startLoopbackChain(opts: LoopbackChainOptions = {}): Promise<LoopbackChain> {
    let head = START_HEAD;
    const mined = new Map<number, string[]>();
    const receipts = new Map<string, { block: number; tx: Transaction }>();
    const requests: RpcRequest[] = [];
    const subs: Sub[] = [];
    let subSeq = 0;
    let firstSendBundleSeen = false;
    const balance = opts.balanceWei ?? 10n * 10n ** 18n;

    const formatBlock = (n: number, txs: string[]): Record<string, unknown> => ({
        number: toQuantity(n),
        hash: blockHash(n),
        parentHash: blockHash(n - 1),
        nonce: '0x0000000000000000',
        sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
        logsBloom: '0x' + '00'.repeat(256),
        transactionsRoot: keccak256(concat([toUtf8Bytes('tx-root'), ...txs])),
        stateRoot: keccak256(toUtf8Bytes(`state-root:${n}`)),
        receiptsRoot: keccak256(toUtf8Bytes(`receipts-root:${n}`)),
        miner: MINER,
        difficulty: '0x0',
        totalDifficulty: '0xc70d815d562d3cfa955',
        extraData: '0x',
        size: toQuantity(1000 + txs.length * 200),
        gasLimit: toQuantity(BLOCK_GAS_LIMIT),
        gasUsed: toQuantity(21_000n * BigInt(txs.length)),
        timestamp: toQuantity(GENESIS_TS + n * 12),
        mixHash: keccak256(toUtf8Bytes(`mix:${n}`)),
        baseFeePerGas: toQuantity(BASE_FEE),
        withdrawalsRoot: keccak256(toUtf8Bytes(`withdrawals:${n}`)),
        blobGasUsed: '0x0',
        excessBlobGas: '0x0',
        parentBeaconBlockRoot: keccak256(toUtf8Bytes(`beacon:${n}`)),
        uncles: [],
        withdrawals: [],
        transactions: txs,
    });

    const blockNumberOf = (tag: unknown): number => {
        if (tag === 'latest' || tag === 'pending' || tag === 'safe' || tag === 'finalized' || tag === undefined) return head;
        if (tag === 'earliest') return 0;
        return Number(BigInt(String(tag)));
    };

    const getBlock = (tag: unknown): unknown => {
        const n = blockNumberOf(tag);
        const answer = opts.blockAnswer ? opts.blockAnswer(n) : 'default';
        if (answer === null) return null;
        if (answer === 'default') return n <= head ? formatBlock(n, mined.get(n) ?? []) : null;
        return formatBlock(n, answer.transactions);
    };

    const receiptOf = (hash: string): unknown => {
        const rec = receipts.get(lc(hash));
        if (rec === undefined) return null;
        const block = rec.block;
        const txs = mined.get(block) ?? [];
        const index = txs.indexOf(lc(hash));
        return {
            transactionHash: lc(hash),
            transactionIndex: toQuantity(index),
            blockHash: blockHash(block),
            blockNumber: toQuantity(block),
            from: lc(rec.tx.from),
            to: rec.tx.to ? lc(rec.tx.to) : null,
            cumulativeGasUsed: toQuantity(21_000n * BigInt(index + 1)),
            gasUsed: toQuantity(21_000n),
            effectiveGasPrice: toQuantity(BASE_FEE + PRIORITY_FEE),
            contractAddress: null,
            logs: [],
            logsBloom: '0x' + '00'.repeat(256),
            status: '0x1',
            type: '0x2',
        };
    };

    const callBundle = (p: Record<string, unknown>): unknown => {
        const results = ((p.txs ?? []) as string[]).map((raw) => {
            const tx = Transaction.from(raw);
            const gasUsed = 21_000;
            const priority = tx.maxPriorityFeePerGas ?? 0n;
            const gasPrice = BASE_FEE + priority;
            return {
                coinbaseDiff: (BigInt(gasUsed) * priority).toString(),
                ethSentToCoinbase: '0',
                fromAddress: tx.from,
                gasFees: (BigInt(gasUsed) * gasPrice).toString(),
                gasPrice: gasPrice.toString(),
                gasUsed,
                toAddress: tx.to,
                txHash: tx.hash,
                value: '0x',
            };
        });
        const totalGas = results.reduce((a, r) => a + r.gasUsed, 0);
        const totalFees = results.reduce((a, r) => a + BigInt(r.gasFees), 0n);
        return {
            bundleGasPrice: totalGas > 0 ? (totalFees / BigInt(totalGas)).toString() : '0',
            bundleHash: bundleHashOf(results.map((r) => r.txHash as string)),
            coinbaseDiff: results.reduce((a, r) => a + BigInt(r.coinbaseDiff), 0n).toString(),
            ethSentToCoinbase: '0',
            gasFees: totalFees.toString(),
            results,
            stateBlockNumber: head,
            totalGasUsed: totalGas,
        };
    };

    const bundleStats = (): unknown => {
        const at = new Date().toISOString();
        const builder = { pubkey: '0x' + 'ab'.repeat(48), timestamp: at };
        return { isHighPriority: true, isSimulated: true, simulatedAt: at, receivedAt: at, consideredByBuildersAt: [builder], sealedByBuildersAt: [] };
    };

    /** One JSON-RPC call. Returns the result, or throws a { code, message, data } error object. */
    const handle = (r: RpcRequest): unknown => {
        const p = r.params;
        switch (r.method) {
            case 'eth_chainId':
                return toQuantity(CHAIN_ID);
            case 'eth_blockNumber':
                return toQuantity(head);
            case 'eth_getBlockByNumber':
                return getBlock(p[0]);
            case 'eth_gasPrice':
                return toQuantity(BASE_FEE + PRIORITY_FEE);
            case 'eth_maxPriorityFeePerGas':
                return toQuantity(PRIORITY_FEE);
            case 'eth_getBalance':
                return toQuantity(balance);
            case 'eth_getTransactionCount':
                return '0x0';
            case 'eth_getTransactionReceipt':
                return receiptOf(String(p[0]));
            case 'eth_getLogs':
                return opts.logs ? opts.logs((p[0] ?? {}) as Record<string, unknown>) : [];
            case 'eth_call': {
                const call = (p[0] ?? {}) as { to?: string; data?: string; input?: string };
                const to = lc(call.to ?? '');
                const data = lc(call.data ?? call.input ?? '0x');
                const reply = opts.ethCall ? opts.ethCall({ to, data }) : undefined;
                if (!reply) return setupError(`the loopback chain has no answer for eth_call to ${to} selector ${data.slice(0, 10)}`);
                if (reply.error) throw reply.error;
                return reply.result;
            }
            case 'eth_subscribe': {
                if (r.via !== 'ws' || r.conn === undefined) throw { code: -32601, message: 'notifications not supported' };
                const kind = String(p[0]);
                if (kind !== 'logs' && kind !== 'newHeads') setupError(`the loopback chain has no "${kind}" subscription`);
                subSeq += 1;
                const id = toBeHex(BigInt(keccak256(toUtf8Bytes(`loopback-sub:${subSeq}`))) >> 128n);
                subs.push({ id, kind, filter: (p[1] ?? {}) as Record<string, unknown>, conn: r.conn });
                return id;
            }
            case 'eth_unsubscribe': {
                const i = subs.findIndex((s) => s.id === p[0]);
                if (i < 0) return false;
                subs.splice(i, 1);
                return true;
            }
            case 'eth_callBundle':
                return callBundle((p[0] ?? {}) as Record<string, unknown>);
            case 'eth_sendBundle': {
                const p0 = (p[0] ?? {}) as Record<string, unknown>;
                const hashes = ((p0.txs ?? []) as string[]).map((raw) => keccak256(raw));
                if (!firstSendBundleSeen) {
                    firstSendBundleSeen = true;
                    opts.onFirstSendBundle?.(p0);
                }
                return { bundleHash: bundleHashOf(hashes) };
            }
            case 'flashbots_getBundleStatsV2':
                return bundleStats();
            default:
                return setupError(`the loopback chain does not know the JSON-RPC method ${r.method}`);
        }
    };

    const answer = (r: RpcRequest, id: unknown): Record<string, unknown> => {
        requests.push(r);
        opts.onRequest?.(r);
        try {
            const result = handle(r);
            opts.onAnswered?.(r, result);
            return { jsonrpc: '2.0', id, result };
        } catch (e) {
            const err = e as { code?: number; message?: string; data?: string };
            if (typeof err?.code !== 'number') throw e;
            return { jsonrpc: '2.0', id, error: err };
        }
    };

    const dispatch = (body: string, via: 'http' | 'ws', conn?: number): string => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch {
            return setupError(`the loopback chain got a body that is not JSON: ${body.slice(0, 80)}`);
        }
        const one = (m: unknown): Record<string, unknown> => {
            const msg = m as { id?: unknown; method?: unknown; params?: unknown };
            return answer({ via, conn, method: String(msg.method), params: Array.isArray(msg.params) ? msg.params : [] }, msg.id);
        };
        return JSON.stringify(Array.isArray(parsed) ? parsed.map(one) : one(parsed));
    };

    // ---- HTTP (node and relay) ----
    const httpServer = http.createServer((req, res) => {
        readBody(req)
            .then((body) => {
                const out = dispatch(body, 'http');
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(out);
            })
            .catch((e: unknown) => setupError(`loopback HTTP: ${String(e)}`));
    });
    const httpSockets = new Set<Socket>();
    httpServer.on('connection', (s: Socket) => {
        httpSockets.add(s);
        s.on('close', () => httpSockets.delete(s));
    });
    const httpPort = await listen(httpServer, 0);

    // ---- WebSocket ----
    const wss = new WebSocketServer({ noServer: true });
    let connSeq = 0;
    const live = new Map<number, WebSocket>();
    let wsServer: http.Server | null = null;
    const wsRawSockets = new Set<Socket>();

    const startWsServer = async (port: number): Promise<number> => {
        const server = http.createServer((_req, res) => {
            res.writeHead(426);
            res.end();
        });
        server.on('connection', (s: Socket) => {
            wsRawSockets.add(s);
            s.on('close', () => wsRawSockets.delete(s));
        });
        server.on('upgrade', (req, socket, head) => {
            wss.handleUpgrade(req, socket, head, (ws) => {
                connSeq += 1;
                const conn = connSeq;
                live.set(conn, ws);
                ws.on('message', (data) => {
                    const out = dispatch(String(data), 'ws', conn);
                    ws.send(out);
                });
                ws.on('close', () => {
                    live.delete(conn);
                    for (let i = subs.length - 1; i >= 0; i--) if (subs[i].conn === conn) subs.splice(i, 1);
                });
                ws.on('error', () => {
                    /* a client that dies mid-frame; the close handler cleans up */
                });
            });
        });
        const bound = await listen(server, port);
        wsServer = server;
        return bound;
    };

    let wsPort: number;
    if (opts.wsStartsClosed) {
        wsPort = await freePort();
    } else {
        wsPort = await startWsServer(0);
    }

    const closeWsListener = (): Promise<void> =>
        new Promise((resolve) => {
            const s = wsServer;
            wsServer = null;
            if (!s) return resolve();
            s.close(() => resolve());
        });

    const chain: LoopbackChain = {
        httpUrl: `http://127.0.0.1:${httpPort}/`,
        wsUrl: `ws://127.0.0.1:${wsPort}/`,
        wsPort,
        get head() {
            return head;
        },
        setHead(n: number) {
            head = n;
        },
        include(block: number, rawTxs: string[]) {
            const list = mined.get(block) ?? [];
            for (const raw of rawTxs) {
                const tx = Transaction.from(raw);
                const h = lc(tx.hash);
                list.push(h);
                receipts.set(h, { block, tx });
            }
            mined.set(block, list);
        },
        requests,
        get openSockets() {
            return live.size;
        },
        get logSubscriptions() {
            return subs.filter((s) => s.kind === 'logs').length;
        },
        pushLog(log: LogJson): number {
            let n = 0;
            for (const s of subs) {
                if (s.kind !== 'logs' || !logMatches(log, s.filter)) continue;
                const ws = live.get(s.conn);
                if (!ws) continue;
                ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'eth_subscription', params: { subscription: s.id, result: log } }));
                n += 1;
            }
            return n;
        },
        async dropSockets({ closePort }: { closePort: boolean }) {
            const listenerClosed = closePort ? closeWsListener() : Promise.resolve();
            for (const ws of [...live.values()]) ws.terminate();
            if (closePort) for (const s of [...wsRawSockets]) s.destroy();
            await listenerClosed;
        },
        async reopenWs() {
            if (wsServer) return;
            await startWsServer(wsPort);
        },
        wsMark(): number {
            return connSeq;
        },
        wsConnectedAfter(markAt: number, o: { subscribed?: boolean } = {}): boolean {
            for (const c of live.keys()) {
                if (c <= markAt) continue;
                if (!o.subscribed || subs.some((x) => x.conn === c && x.kind === 'logs')) return true;
            }
            return false;
        },
        async close() {
            for (const ws of [...live.values()]) ws.terminate();
            await closeWsListener();
            for (const s of [...httpSockets]) s.destroy();
            await new Promise<void>((r) => httpServer.close(() => r()));
        },
    };
    return chain;
}

/** ABI coder for log data (real ethers encoder, D-04). */
export const abi = AbiCoder.defaultAbiCoder();

// ---------------------------------------------------------------------------------------------
// The fixture contract shared by the four crash fixtures (23-12-PLAN.md Proof rules 2 to 4b)
// ---------------------------------------------------------------------------------------------

export type Mode = 'fault' | 'healthy' | 'contained';

export function parseMode(raw: string | undefined): Mode {
    if (raw === 'fault' || raw === 'healthy' || raw === 'contained') return raw;
    return setupError(`unknown mode ${JSON.stringify(raw)} (fault, healthy or contained)`);
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `cond` on real time; a setup error when it is still false after `ms`. */
export async function until(cond: () => boolean, ms: number, what: string): Promise<void> {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end) setupError(`timed out after ${ms} ms waiting for ${what}`);
        await sleep(20);
    }
}

function firstLine(e: unknown): string {
    const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return text.split('\n')[0].slice(0, 300);
}

/**
 * Contained mode only, and FIRST in the child (Proof rule 2): process handlers for an uncaught
 * exception and an unhandled rejection, each printing CONTAINED <kind> <first line>, so the parent
 * can see the same fault happened and the process kept running.
 */
export function installContainment(): void {
    process.on('uncaughtException', (e) => mark(`CONTAINED uncaughtException ${firstLine(e)}`));
    process.on('unhandledRejection', (e) => mark(`CONTAINED unhandledRejection ${firstLine(e)}`));
}

/** A recurring real timer, started when the fault is triggered. */
export function startTicker(): { ticks: () => number } {
    let ticks = 0;
    setInterval(() => {
        ticks += 1;
    }, 100);
    return { ticks: () => ticks };
}

/**
 * The end of every run that is still alive (Proof rules 4 and 4a): the ticker must still be
 * rising, one independent JSON-RPC call through the bot's real HTTP provider must succeed, then
 * FIXTURE_LIVE <ticks> <block>, WORK_SETTLED or WORK_PENDING, FIXTURE_SURVIVED, exit 0.
 */
export async function finishAlive(ticker: { ticks: () => number }, readBlock: () => Promise<number>, workSettled: boolean): Promise<never> {
    const before = ticker.ticks();
    await sleep(500);
    const after = ticker.ticks();
    if (after <= before) setupError(`the heartbeat timer stopped (${before} then ${after})`);
    let block: number;
    try {
        block = await readBlock();
    } catch (e) {
        return setupError(`the heartbeat JSON-RPC call failed: ${firstLine(e)}`);
    }
    mark(`FIXTURE_LIVE ${after} ${block}`);
    mark(workSettled ? 'WORK_SETTLED' : 'WORK_PENDING');
    mark('FIXTURE_SURVIVED');
    process.exit(0);
}

/** Run a fixture's main: any error of the fixture's own (never the bot's) is a setup error. */
export function runFixture(main: () => Promise<void>): void {
    main().catch((e: unknown) => setupError(`fixture: ${e instanceof Error ? e.stack ?? e.message : String(e)}`));
}
