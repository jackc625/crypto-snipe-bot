// test/realpath/scenarios/otherRoutes.test.ts
// Phase 23 plan 23-22 Task 1 (CHAR-02, AC-19 to AC-24): the golden-master recordings of the two
// non-Flashbots routes. bsc sends through bloXroute (bsc_private_tx, src/utils/mevStrategies/
// bloxroute.ts) and base through the public route (eth_sendRawTransaction then tx.wait(3),
// passthrough.ts), per the chain templates. Each test is one whole-graph scenario: a real
// PairCreated or PoolCreated reaches the real listener, the safety bank runs (the HoneypotChecker
// read at the scenario's checker address is asserted, RESEARCH Open Question 6, so a fail-closed
// skip can never pass as a route), and the bot buys, or sells a position it bought in the same
// scenario, through the route's real path. runScenario (driver.ts) records the ordered timeline of
// op logs, submitted transactions, relay bodies and DB writes and compares it byte for byte with
// test/realpath/recordings/<name>.jsonl. A normal run never writes a recording; only
// `npm run recordings:update` does (AC-25).
//
// public-v2-buy records today's skip, not a buy (operator ruling for this plan, 2026-11-12, "Record
// today's skip"): on base the V2 lock check asks GoPlus about the pair address, reads "not locked"
// and skips every V2 launch (AUD-BUY-016). Its assertComplete proves the skip finished (the skip
// line naming only the lock, GoPlus asked about the pair, no submission, no trades row), and the
// test fails with "AUD-BUY-016 looks fixed" when the bot buys instead. Phase 24's fix re-records it
// as the base V2 buy through a behavior: commit citing AUD-BUY-016. public-full-sell therefore
// buys through base V3, which the lock check does not cover.
//
// The chain moves at its own block time (driveBlocks below, a file-local driver on the public
// FakeNode API): BSC 750 ms (Maxwell), Base 2 s. Each block holds every transaction of the bot's
// wallet then waiting on the public pool or accepted by bloXroute, in nonce order (a bloXroute
// private transaction goes to the validators directly, so the next block takes it); an empty block
// is mined when nothing waits. driver.ts driveSlots is ETH's 12 s Flashbots cadence and includes
// only public and bundle transactions, so it cannot land a bloXroute transaction. Nothing is mined
// at the moment it is sent: the bot always reads the chain through ethers' 250 ms request cache
// first, as it would on the real network.
//
// Hold points (AUD-TX-028): nothing here holds a call in flight. No provider read, relay call or
// transaction is parked, so one stalled read on a chain's HTTP provider cannot decide a result. No
// scenario restarts the graph, so AUD-ANTIRUG-025 does not apply.
//
// Every assertComplete proves, in order, that the route finished (review concern: a checker read
// alone does not prove the route completed; relay acceptance, mined inclusion and confirmation
// depth differ): the signed transaction the route sent, parsed with real Transaction.from, has the
// hash the route returned and the bot stored; node.history shows that hash mined; the receipt the
// node returns for it is real (status 1, its logs decoded with real ethers) and the bot read it;
// on the public route the trades row was written only once the scenario had mined the three
// confirmations passthrough.ts waits for. The bot decodes receipt logs itself only on the sell
// path (exit.receipt.decoded); a buy's receipt is read by the bot for its status, and its logs are
// decoded here.
//
// Tags (AC-21, AC-46) are chosen from what each timeline shows against the register's confirmed
// findings; the SUMMARY of plan 23-22 lists, per scenario, the timeline lines behind each cited ID
// and the confirmed findings checked and ruled out.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Transaction, getAddress, parseEther, type Result } from 'ethers';
import { encodeResult, harnessState, revertReason, type Submitted } from '../harness/chain';
import { recordedAlerts, recordedLogs, type TimelineEntry } from '../harness/capture';
import type { Scenario } from '../harness/world';
import { stepFor, stepUntilTrue, v2AmountOut, v3AmountOut } from '../harness/world';
import { ERC20, V2_ROUTER, V3_ROUTER, buyRow, exitStateRow, listen, opEntries, opLogged, subscribedTo } from '../triage/fixtures/AUD-EXIT-002-position';
import { foreignTrade, installSellPath, sellsSubmitted, type DecodedSell } from '../triage/fixtures/AUD-EXIT-001-sell-path';
import { runScenario } from './driver';

type RouteChain = 'bsc' | 'base';
type Route = 'bloxroute' | 'public';

/** Each chain's block time in fake ms: BSC 0.75 s since its Maxwell upgrade, Base 2 s. */
const BLOCK_MS: Record<RouteChain, number> = { bsc: 750, base: 2_000 };
/** The route each chain's template names (src/chainRegistry.ts mevStrategy). */
const ROUTE_OF: Record<RouteChain, Route> = { bsc: 'bloxroute', base: 'public' };
/** Confirmations passthrough.ts waits for (tx.wait(3)): the inclusion block and two more. */
const PUBLIC_CONFIRMATIONS = 3;

const CHECKER = new Interface(['function checkV2(address router, address token, uint256 amountIn)', 'function checkV3(address router, address quoter, address token, uint256 amountIn, uint24 fee)']);
const ERC20_EVENTS = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
const APPROVE_SELECTOR = ERC20.getFunction('approve')!.selector;
const V2_SELL_SELECTOR = V2_ROUTER.getFunction('swapExactTokensForETH')!.selector;
const WETH_EVENTS = new Interface(['event Withdrawal(address indexed src, uint256 wad)', 'event Transfer(address indexed from, address indexed to, uint256 value)']);

// ---------------------------------------------------------------------------------------------
// The chain at its own cadence
// ---------------------------------------------------------------------------------------------

interface BlockClock {
    blockMs: number;
    /** Fake-clock ms of the last block mined. */
    lastBlockAt: number;
    /** Block number -> fake-clock ms it was mined at. */
    minedAt: Map<number, number>;
}

function blockClock(sc: Scenario): BlockClock {
    return { blockMs: BLOCK_MS[sc.chain as RouteChain], lastBlockAt: Date.now(), minedAt: new Map() };
}

/**
 * Drive the chain at its block time until `until()` holds: every `blockMs` of fake time one block
 * is mined, holding the wallet's transactions then waiting on the public pool or accepted by
 * bloXroute whose nonces continue the wallet's mined count, in nonce order. An empty block is
 * mined when nothing waits. Fake time only, 50 ms steps, no held call.
 */
async function driveBlocks(sc: Scenario, clock: BlockClock, opts: { until: () => boolean; what: string; maxVirtualMs?: number }): Promise<void> {
    const { node } = sc;
    const wallet = sc.wallet.address.toLowerCase();
    const sender = new WeakMap<Submitted, string>();
    const fromWallet = (s: Submitted): boolean => {
        let f = sender.get(s);
        if (f === undefined) {
            // Transaction.from recovers the sender on every read of `from`: read it once.
            f = (s.tx.from ?? '').toLowerCase();
            sender.set(s, f);
        }
        return f === wallet;
    };
    const maxVirtualMs = opts.maxVirtualMs ?? 600_000;
    const end = Date.now() + maxVirtualMs;
    while (!opts.until()) {
        if (Date.now() >= end) throw new Error(`driveBlocks: ${opts.what} did not happen within ${maxVirtualMs} virtual ms`);
        await stepFor(50, 50);
        if (Date.now() - clock.lastBlockAt < clock.blockMs) continue;
        const waiting = node.submitted.filter((s) => s.status === 'accepted' && (s.route === 'public' || s.route === 'bloxroute') && fromWallet(s)).sort((a, b) => a.tx.nonce - b.tx.nonce);
        const include: string[] = [];
        let next = node.minedCount(sc.wallet.address);
        for (const s of waiting) {
            if (s.tx.nonce !== next) continue;
            include.push(s.hash);
            next += 1;
        }
        const n = node.mine({ include });
        clock.lastBlockAt = Date.now();
        clock.minedAt.set(n, clock.lastBlockAt);
    }
}

// ---------------------------------------------------------------------------------------------
// Reading what the bot did
// ---------------------------------------------------------------------------------------------

/** The checker reads the safety path made (the honeypot gate actually ran on this chain). */
function checkerReads(sc: Scenario, fn: 'checkV2' | 'checkV3'): Result[] {
    const selector = CHECKER.getFunction(fn)!.selector;
    return sc.node.callLog
        .filter((c) => c.method === 'eth_call' && c.to === sc.checker.toLowerCase() && c.selector === selector)
        .map((c) => CHECKER.decodeFunctionData(fn, c.data!));
}

/** The checker ran for this scenario's token, through this scenario's router (and fee tier on V3). */
function assertCheckerRan(sc: Scenario): void {
    expect(process.env[`${sc.chain.toUpperCase()}_HONEYPOT_CHECKER_ADDRESS`]).toBe(sc.checker);
    expect(sc.ctx.chain.honeypotChecker.deployedAddress).toBe(sc.checker);
    if (sc.dex.dexType === 'v2') {
        const reads = checkerReads(sc, 'checkV2');
        expect(reads.length).toBeGreaterThan(0);
        for (const r of reads) expect([getAddress(r.router as string), getAddress(r.token as string)]).toEqual([getAddress(sc.dex.routerAddress), getAddress(sc.token)]);
    } else {
        const reads = checkerReads(sc, 'checkV3');
        expect(reads.length).toBeGreaterThan(0);
        for (const r of reads) expect([getAddress(r.router as string), getAddress(r.token as string), Number(r.fee)]).toEqual([getAddress(sc.dex.swapRouterAddress), getAddress(sc.token), sc.feeTier]);
    }
}

function cursor(sc: Scenario): number | undefined {
    return (sc.graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get(sc.chain) as { b: number } | undefined)?.b;
}

function opCount(pred: (op: string) => boolean): number {
    return recordedLogs().filter((l) => typeof l.obj?.op === 'string' && pred(l.obj.op as string)).length;
}

/** The first log line with this message (lines with no op are not in the recording). */
function msgEntry(msg: string): Record<string, unknown> | undefined {
    return recordedLogs().find((l) => l.msg === msg)?.obj;
}

/**
 * A predicate that holds once the subscription traffic (eth_subscribe / eth_unsubscribe) has not
 * changed for one second of fake time, so no anti-rug (un)subscription is still in flight when the
 * scenario ends (the condition fixtures/AUD-TX-002-lock.ts settleAntiRugArming waits for, here
 * checked while the chain keeps moving).
 */
function trafficSettled(sc: Scenario): () => boolean {
    const traffic = (): number => sc.node.callLog.filter((c) => c.method === 'eth_subscribe' || c.method === 'eth_unsubscribe').length;
    let last = traffic();
    let stableSince = Date.now();
    return () => {
        const n = traffic();
        if (n !== last) {
            last = n;
            stableSince = Date.now();
        }
        return Date.now() - stableSince >= 1_000;
    };
}

/** The scenario token's trades rows of one action. */
interface TradeRowFull {
    id: number;
    tx_hash: string;
    amount_in: string;
    amount_out: string | null;
    status: string;
    pool_type: string;
    fee_tier: number | null;
    dex_name: string | null;
}

function rowsOf(sc: Scenario, action: 'buy' | 'sell'): TradeRowFull[] {
    return sc.graph.db
        .prepare('SELECT id, tx_hash, amount_in, amount_out, status, pool_type, fee_tier, dex_name FROM trades WHERE token = ? AND chain = ? AND action = ? ORDER BY id')
        .all(sc.token.toLowerCase(), sc.chain, action) as TradeRowFull[];
}

/** The `at` of the first DB timeline entry inserting into `table` a row whose tx_hash is `hash`. */
function insertAt(sc: Scenario, table: string, hash: string): number | undefined {
    const e = sc.timeline.entries.find((x: TimelineEntry) => x.kind === 'db' && x.table === table && x.op === 'insert' && String((x.row as Record<string, unknown>).tx_hash) === hash);
    return e?.at;
}

// ---------------------------------------------------------------------------------------------
// The buy, on its route
// ---------------------------------------------------------------------------------------------

/**
 * A buy's receipt carries the token Transfer(pair or pool -> wallet, out) a real swap emits, with
 * `out` the router's own answer on the scenario reserves. The bot reads only the buy receipt's
 * status; the scenario decodes the log (assertRouteLanded).
 */
function installBuyReceipt(sc: Scenario): void {
    const { node, token, pair, weth, reserves, wallet } = sc;
    if (sc.dex.dexType === 'v2') {
        node.setReceiptLogs({ to: sc.dex.routerAddress, selector: V2_ROUTER.getFunction('swapExactETHForTokens')!.selector }, (tx) => {
            const call = V2_ROUTER.parseTransaction({ data: tx.data, value: tx.value });
            const path = (call!.args[1] as string[]).map((a) => getAddress(a));
            if (path[0] !== getAddress(weth) || path[1] !== getAddress(token) || getAddress(tx.from!) !== getAddress(wallet.address)) return [];
            const e = ERC20_EVENTS.encodeEventLog('Transfer', [pair, wallet.address, v2AmountOut(tx.value, reserves.weth, reserves.token)]);
            return [{ address: token, topics: e.topics, data: e.data }];
        });
    } else {
        const fee = sc.feeTier!;
        node.setReceiptLogs({ to: sc.dex.swapRouterAddress, selector: V3_ROUTER.getFunction('multicall')!.selector }, (tx) => {
            // A sell is a multicall to the same router: only the wallet's WETH-in call is a buy.
            const outer = V3_ROUTER.parseTransaction({ data: tx.data, value: tx.value });
            const inner = V3_ROUTER.parseTransaction({ data: (outer!.args[1] as string[])[0] });
            if (inner?.name !== 'exactInputSingle') return [];
            const p = inner.args[0] as unknown as { tokenIn: string; tokenOut: string; amountIn: bigint };
            if (getAddress(p.tokenIn) !== getAddress(weth) || getAddress(p.tokenOut) !== getAddress(token) || getAddress(tx.from!) !== getAddress(wallet.address)) return [];
            const e = ERC20_EVENTS.encodeEventLog('Transfer', [pair, wallet.address, v3AmountOut(p.amountIn, reserves.weth, reserves.token, fee)]);
            return [{ address: token, topics: e.topics, data: e.data }];
        });
    }
}

interface Bought {
    buy: Submitted;
    tradeId: number;
    /** Token units the buy received (the router's answer on the reserves at the buy). */
    bought: bigint;
}

/**
 * Launch the scenario's pair or pool through the real listener, then run the chain at its block
 * time until the bot's buy has landed on its route, the trades row is written and the position is
 * armed (exit monitor started, anti-rug subscription on the pair, backfill cursor past the buy's
 * block, subscription traffic settled).
 */
async function buyOnRoute(sc: Scenario, clock: BlockClock): Promise<Bought> {
    installBuyReceipt(sc);
    await listen(sc);
    if (sc.dex.dexType === 'v2') await sc.fireNewPair();
    else await sc.fireNewPool();
    await stepUntilTrue(() => sc.node.submitted.length === 1, { what: `the bot sending its ${sc.chain} buy on route ${ROUTE_OF[sc.chain as RouteChain]}` });
    const buy = sc.node.submitted[0];
    const settled = trafficSettled(sc);
    await driveBlocks(sc, clock, {
        what: `the ${sc.chain} buy landing and the position being armed`,
        until: () => {
            const row = buyRow(sc);
            const block = sc.node.isMined(buy.hash) ? sc.node.submitted.find((s) => s.hash === buy.hash)!.block! : Infinity;
            const c = cursor(sc);
            return (
                row !== undefined &&
                opLogged('exit.monitor.started') &&
                subscribedTo(sc, sc.pair) &&
                c !== undefined &&
                c >= block &&
                opCount((op) => op === 'antirug.register') >= 1 &&
                opCount((op) => op.startsWith('antirug.backfill.')) >= 1 &&
                settled()
            );
        },
    });
    const bought = sc.dex.dexType === 'v2' ? v2AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token) : v3AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token, sc.feeTier!);
    return { buy, tradeId: buyRow(sc)!.id, bought };
}

/** The raw signed transaction the route carried for `hash`, and the hash the route answered. */
function routeSent(sc: Scenario, hash: string): { raw: string; answered: string } {
    if (ROUTE_OF[sc.chain as RouteChain] === 'bloxroute') {
        // The relay body bloXroute received (timeline relay entry) and its answer, which the bot
        // logs as relayHash (bloXroute answers the hash without 0x).
        const bodies = sc.timeline.entries.filter((e: TimelineEntry) => e.kind === 'relay' && e.relay === 'bloxroute' && e.method === 'bsc_private_tx');
        const raws = bodies.map((e) => String(((e as { params?: { transaction?: string } }).params ?? {}).transaction)).map((r) => (r.startsWith('0x') ? r : `0x${r}`));
        const raw = raws.find((r) => Transaction.from(r).hash === hash);
        expect(raw, `a bsc_private_tx body carried ${hash}`).toBeDefined();
        const accepted = opEntries('bloxroute.relay.accepted').filter((e) => e.signedTxHash === hash);
        expect(accepted).toHaveLength(1);
        const relayHash = accepted[0].relayHash as { txHash?: string };
        return { raw: raw!, answered: `0x${String(relayHash.txHash)}` };
    }
    // The public route: the eth_sendRawTransaction the node received, and the hash the bot's
    // wallet.sendTransaction returned (its 'TX sent (passthrough)' line).
    const raws = sc.node.callLog.filter((c) => c.method === 'eth_sendRawTransaction').map((c) => String((c.params as unknown[])[0]));
    const raw = raws.find((r) => Transaction.from(r).hash === hash);
    expect(raw, `an eth_sendRawTransaction carried ${hash}`).toBeDefined();
    const sent = recordedLogs().filter((l) => l.msg === 'TX sent (passthrough)' && l.obj?.txHash === hash);
    expect(sent).toHaveLength(1);
    return { raw: raw!, answered: String(sent[0].obj!.txHash) };
}

/** The node's receipt for `hash`, as JSON-RPC answers it. */
async function nodeReceipt(sc: Scenario, hash: string): Promise<{ status: string; blockNumber: string; logs: Array<{ address: string; topics: string[]; data: string }> }> {
    const reply = (await sc.node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] })) as {
        result?: { status: string; blockNumber: string; logs: Array<{ address: string; topics: string[]; data: string }> } | null;
    };
    expect(reply.result, `the node has a receipt for ${hash}`).toBeTruthy();
    return reply.result!;
}

/**
 * The route finished for `hash`, in the order the review asked: the signed transaction the route
 * sent has the hash the route answered and the bot stored; it is mined in node.history; its real
 * receipt (status 1) was read by the bot; and on the public route the stored row came only after
 * the three confirmations passthrough.ts waits for were mined. Returns the receipt.
 */
async function assertRouteLanded(sc: Scenario, clock: BlockClock, hash: string, rowTable: 'trades'): Promise<{ logs: Array<{ address: string; topics: string[]; data: string }> }> {
    const route = ROUTE_OF[sc.chain as RouteChain];
    expect(sc.node.submitted.find((s) => s.hash === hash)?.route).toBe(route);
    const { raw, answered } = routeSent(sc, hash);
    const tx = Transaction.from(raw);
    expect(tx.hash).toBe(hash);
    expect(answered).toBe(hash);
    expect(tx.chainId).toBe(BigInt(sc.node.chainId));
    expect(getAddress(tx.from!)).toBe(getAddress(sc.wallet.address));
    // Mined, in the node's ordered history.
    const mined = sc.node.history.filter((h) => h.event === 'mined' && h.hash === hash);
    expect(mined).toHaveLength(1);
    const block = mined[0].block;
    // The real receipt, and the bot read it.
    const receipt = await nodeReceipt(sc, hash);
    expect(receipt.status).toBe('0x1');
    expect(Number(receipt.blockNumber)).toBe(block);
    expect(sc.node.callLog.some((c) => c.method === 'eth_getTransactionReceipt' && String((c.params as unknown[])[0]) === hash)).toBe(true);
    if (route === 'public') {
        // tx.wait(3): the bot confirmed at the inclusion block, and its row came only once the
        // inclusion block and two more had been mined.
        expect(recordedLogs().filter((l) => l.msg === 'TX confirmed' && l.obj?.txHash === hash).map((l) => l.obj!.block)).toEqual([block]);
        const depthAt = clock.minedAt.get(block + PUBLIC_CONFIRMATIONS - 1);
        expect(depthAt, `block ${block + PUBLIC_CONFIRMATIONS - 1} was mined`).toBeDefined();
        const rowAt = insertAt(sc, rowTable, hash);
        expect(rowAt).toBeDefined();
        expect(rowAt!).toBeGreaterThanOrEqual(depthAt!);
    } else {
        // bloXroute: relay acceptance is not inclusion; the bot reconciled the receipt.
        expect(opEntries('mev.reconcile.included').map((e) => e.minedTxHash)).toContain(hash);
    }
    return receipt;
}

/** The buy half of assertComplete: route landed, receipt Transfer to the wallet, buy row. */
async function assertBuyComplete(sc: Scenario, clock: BlockClock, held: Bought, rowStatus: 'pending' | 'sold' = 'pending'): Promise<void> {
    const receipt = await assertRouteLanded(sc, clock, held.buy.hash, 'trades');
    const transfers = receipt.logs
        .filter((l) => getAddress(l.address) === getAddress(sc.token))
        .map((l) => ERC20_EVENTS.parseLog(l)!)
        .filter((p) => p.name === 'Transfer' && getAddress(p.args.to as string) === getAddress(sc.wallet.address));
    expect(transfers.map((p) => p.args.value as bigint)).toEqual([held.bought]);
    // What the bot sent: the snipe amount, through the scenario's router.
    const tx = Transaction.from(held.buy.raw);
    expect(tx.value).toBe(parseEther(sc.ctx.chain.snipeAmount));
    if (sc.dex.dexType === 'v2') {
        expect(getAddress(tx.to!)).toBe(getAddress(sc.dex.routerAddress));
        const call = V2_ROUTER.parseTransaction({ data: tx.data, value: tx.value })!;
        expect(call.name).toBe('swapExactETHForTokens');
        expect((call.args[1] as string[]).map((a) => getAddress(a))).toEqual([getAddress(sc.weth), getAddress(sc.token)]);
    } else {
        expect(getAddress(tx.to!)).toBe(getAddress(sc.dex.swapRouterAddress));
        const outer = V3_ROUTER.parseTransaction({ data: tx.data, value: tx.value })!;
        expect(outer.name).toBe('multicall');
        const inner = (outer.args[1] as string[]).map((d) => V3_ROUTER.parseTransaction({ data: d })!);
        expect(inner.map((c) => c.name)).toEqual(['exactInputSingle']);
        const p = inner[0].args[0] as unknown as { tokenIn: string; tokenOut: string; fee: bigint; recipient: string; amountIn: bigint };
        expect([getAddress(p.tokenIn), getAddress(p.tokenOut), Number(p.fee), getAddress(p.recipient), p.amountIn]).toEqual([getAddress(sc.weth), getAddress(sc.token), sc.feeTier, getAddress(sc.wallet.address), tx.value]);
    }
    // The bot's row: the hash the route returned, the scenario's pool type and DEX.
    expect(rowsOf(sc, 'buy')).toEqual([
        expect.objectContaining({ id: held.tradeId, tx_hash: held.buy.hash, status: rowStatus, pool_type: sc.dex.dexType, fee_tier: sc.feeTier, dex_name: sc.dex.name }),
    ]);
    expect(opLogged('exit.monitor.started')).toBe(true);
}

// ---------------------------------------------------------------------------------------------
// The full sell, on its route
// ---------------------------------------------------------------------------------------------

/** The one sell the wallet sent through the scenario's sell router since `fromSubmit`. */
function onlySell(sc: Scenario, fromSubmit: number): DecodedSell {
    const sells = sellsSubmitted(sc).filter((s) => sc.node.submitted.findIndex((x) => x.hash === s.hash) >= fromSubmit);
    expect(sells).toHaveLength(1);
    return sells[0];
}

/** The position is closed: the buy row sold and its exit_state row gone. */
function closed(sc: Scenario, held: Bought): boolean {
    return rowsOf(sc, 'buy')[0]?.status === 'sold' && exitStateRow(sc, held.tradeId) === undefined;
}

/**
 * The V2 router's answer to an eth_call of the bot's own sell, which bloxroute.ts and
 * passthrough.ts simulate with provider.call before they send it (Flashbots simulates through the
 * relay's eth_callBundle instead, so the ETH scenarios never make this read). A real router
 * answers the amounts on the current reserves, and reverts as the router does when the path, the
 * deadline, the wallet's balance or allowance (replayed from its mined approves and sells) or the
 * minimum output does not hold. The V3 sell simulation is the harness's own multicall read.
 */
function installV2SellSimulation(sc: Scenario<'v2'>, bought: bigint): void {
    const { node, token, weth, reserves, wallet } = sc;
    const router = getAddress(sc.dex.routerAddress);
    node.setRead(router, 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)', ({ args, from }) => {
        const [amountIn, minOut, path, , deadline] = args as unknown as [bigint, bigint, string[], string, bigint];
        if (path.length !== 2 || getAddress(path[0]) !== getAddress(token) || getAddress(path[1]) !== getAddress(weth)) return revertReason('UniswapV2Router: INVALID_PATH');
        if (deadline < BigInt(Math.floor(Date.now() / 1000))) return revertReason('UniswapV2Router: EXPIRED');
        let allowance = 0n;
        let held = from !== undefined && getAddress(from) === getAddress(wallet.address) ? bought : 0n;
        for (const s of node.submitted.filter((x) => x.status === 'mined' && x.tx.from && getAddress(x.tx.from) === getAddress(wallet.address)).sort((a, b) => a.tx.nonce - b.tx.nonce)) {
            if (s.tx.to && getAddress(s.tx.to) === getAddress(token) && s.tx.data.startsWith(APPROVE_SELECTOR)) {
                const a = ERC20.decodeFunctionData('approve', s.tx.data);
                if (getAddress(a[0] as string) === router) allowance = a[1] as bigint;
            } else if (s.tx.to && getAddress(s.tx.to) === router && s.tx.data.startsWith(V2_SELL_SELECTOR)) {
                const spent = V2_ROUTER.decodeFunctionData('swapExactTokensForETH', s.tx.data)[0] as bigint;
                allowance = allowance > spent ? allowance - spent : 0n;
                held = held > spent ? held - spent : 0n;
            }
        }
        if (from === undefined || getAddress(from) !== getAddress(wallet.address) || amountIn > held || amountIn > allowance) return revertReason('TransferHelper: TRANSFER_FROM_FAILED');
        const out = v2AmountOut(amountIn, reserves.token, reserves.weth);
        if (out < minOut) return revertReason('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
        return encodeResult(['uint256[]'], [[amountIn, out]]);
    });
}

/**
 * Buy on the route, then another wallet dumps 30 percent of the pool's tokens (the price falls
 * about 41 percent, past the 25 percent stop-loss), and the chain runs until the stop-loss exit
 * has sold the whole position on the same route and the position is closed.
 */
async function buyThenStopLoss(sc: Scenario, clock: BlockClock): Promise<{ held: Bought; sell: DecodedSell }> {
    const held = await buyOnRoute(sc, clock);
    installSellPath(sc, { bought: held.bought });
    if (sc.dex.dexType === 'v2') installV2SellSimulation(sc as Scenario<'v2'>, held.bought);
    const fromSubmit = sc.node.submitted.length;
    await foreignTrade(sc, { sellTokens: (sc.reserves.token * 3n) / 10n });
    const settled = trafficSettled(sc);
    await driveBlocks(sc, clock, { what: `the ${sc.chain} stop-loss exit closing the position`, until: () => closed(sc, held) && settled() });
    return { held, sell: onlySell(sc, fromSubmit) };
}

/** The WETH the sell paid the wallet, from the node's receipt decoded with real ethers. */
function receiptWethOut(sc: Scenario, receipt: { logs: Array<{ address: string; topics: string[]; data: string }> }): bigint {
    const outs = receipt.logs
        .filter((l) => getAddress(l.address) === getAddress(sc.weth))
        .map((l) => WETH_EVENTS.parseLog(l)!)
        .filter((p) => (sc.dex.dexType === 'v2' ? p.name === 'Withdrawal' : p.name === 'Transfer' && getAddress(p.args.to as string) === getAddress(sc.wallet.address)))
        .map((p) => (sc.dex.dexType === 'v2' ? (p.args.wad as bigint) : (p.args.value as bigint)));
    expect(outs).toHaveLength(1);
    return outs[0];
}

/** The sell half of assertComplete: route landed, receipt decoded by the bot, rows closed. */
async function assertSellComplete(sc: Scenario, clock: BlockClock, held: Bought, sell: DecodedSell): Promise<void> {
    expect(opEntries('exit.trigger.stop-loss').length).toBeGreaterThanOrEqual(1);
    expect(sell.amountIn).toBe(held.bought);
    expect(sell.tokenIn).toBe(getAddress(sc.token));
    expect(sell.tokenOut).toBe(getAddress(sc.weth));
    const receipt = await assertRouteLanded(sc, clock, sell.hash, 'trades');
    // The bot decoded the real receipt's WETH log, and its row carries that amount.
    const out = receiptWethOut(sc, receipt);
    expect(opEntries('exit.receipt.decoded').filter((e) => e.txHash === sell.hash).map((e) => e.amountOut)).toEqual([out.toString()]);
    expect(opEntries('exit.full.executed').map((e) => [e.reason, e.txHash])).toEqual([['stop-loss', sell.hash]]);
    expect(rowsOf(sc, 'sell')).toEqual([expect.objectContaining({ tx_hash: sell.hash, amount_in: held.bought.toString(), amount_out: out.toString(), status: 'sold', pool_type: sc.dex.dexType, fee_tier: sc.feeTier })]);
    expect(rowsOf(sc, 'buy')[0].status).toBe('sold');
    expect(exitStateRow(sc, held.tradeId)).toBeUndefined();
}

// ---------------------------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------------------------

describe('golden master: bloXroute (bsc) and the public route (base) (CHAR-02)', () => {
    it('bloxroute-v2-buy: a bsc V2 launch passes the safety bank and the bot buys through bloXroute; the relayed transaction is mined and the position armed', async () => {
        let clock!: BlockClock;
        let held!: Bought;
        await runScenario({
            name: 'bloxroute-v2-buy',
            tag: 'SUSPECT(AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-003,AUD-TX-016)',
            chain: 'bsc',
            dexType: 'v2',
            async steps(sc) {
                clock = blockClock(sc);
                held = await buyOnRoute(sc, clock);
            },
            async assertComplete(sc) {
                assertCheckerRan(sc);
                // The Mudra lock answer was asked for this pair (bsc's V2 lock check).
                expect(harnessState().httpLog.some((h) => h.url.toLowerCase() === `https://api.mudra.website/api/v1/locker/pair/${sc.pair.toLowerCase()}`)).toBe(true);
                await assertBuyComplete(sc, clock, held);
            },
        });
    });

    it('bloxroute-v3-buy: a bsc V3 launch passes the V3 safety bank and the bot buys through bloXroute; the relayed transaction is mined and the position armed', async () => {
        let clock!: BlockClock;
        let held!: Bought;
        await runScenario({
            name: 'bloxroute-v3-buy',
            tag: 'SUSPECT(AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-003,AUD-TX-016)',
            chain: 'bsc',
            dexType: 'v3',
            async steps(sc) {
                clock = blockClock(sc);
                held = await buyOnRoute(sc, clock);
            },
            async assertComplete(sc) {
                assertCheckerRan(sc);
                await assertBuyComplete(sc, clock, held);
            },
        });
    });

    it('bloxroute-full-sell: a bsc V2 position bought through bloXroute falls about 41 percent, and the stop-loss sells all of it through bloXroute', async () => {
        let clock!: BlockClock;
        let held!: Bought;
        let sell!: DecodedSell;
        await runScenario({
            name: 'bloxroute-full-sell',
            tag: 'SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-TX-016)',
            chain: 'bsc',
            dexType: 'v2',
            async steps(sc) {
                clock = blockClock(sc);
                ({ held, sell } = await buyThenStopLoss(sc, clock));
            },
            async assertComplete(sc) {
                assertCheckerRan(sc);
                await assertBuyComplete(sc, clock, held, 'sold');
                await assertSellComplete(sc, clock, held, sell);
            },
        });
    });

    it('public-v2-buy: AUD-BUY-016 today: a base V2 launch is skipped before route public, because GoPlus is asked about the pair and reads "not locked" while every other safety check passes', async () => {
        let clock!: BlockClock;
        await runScenario({
            name: 'public-v2-buy',
            tag: 'SUSPECT(AUD-BUY-016)',
            chain: 'base',
            dexType: 'v2',
            async steps(sc) {
                clock = blockClock(sc);
                await listen(sc);
                await sc.fireNewPair();
                const buying = (): boolean => msgEntry('All safety checks passed, buying') !== undefined;
                await stepUntilTrue(() => msgEntry('Safety checks failed, skipping') !== undefined || buying(), { what: 'the base V2 safety bank deciding', maxSteps: 20_000 });
                // The fix signal (D-08): once the lock query is fixed the bank passes and the bot buys.
                if (buying()) {
                    throw new Error(
                        'AUD-BUY-016 looks fixed: the base V2 launch passed the lock check and the bot is buying. ' +
                            'Re-record public-v2-buy as the base V2 buy on route public, in a behavior: commit citing AUD-BUY-016.',
                    );
                }
                // A bounded window at the chain's cadence: 24 s of fake time (12 base blocks) pass
                // and nothing is sent on any route.
                const until = Date.now() + 24_000;
                await driveBlocks(sc, clock, { what: 'the 24 s window after the skip', until: () => Date.now() >= until });
            },
            assertComplete(sc) {
                expect(sc.ctx.chain.mevStrategy).toBe('passthrough');
                expect(sc.ctx.chain.safetyApis.liquidityLock).toBe('goplus');
                assertCheckerRan(sc);
                // GoPlus was asked about the pair, never the token: the query AUD-BUY-016 names.
                const asked = harnessState()
                    .httpLog.filter((h) => h.method === 'get' && h.url === `https://api.gopluslabs.io/api/v1/token_security/${sc.node.chainId}`)
                    .map((h) => String((h.params as { contract_addresses?: unknown } | undefined)?.contract_addresses).toLowerCase());
                expect(asked).toEqual([sc.pair.toLowerCase()]);
                // The skip line names the lock as the only failed check.
                const skip = msgEntry('Safety checks failed, skipping') as { token?: string; checks?: Record<string, unknown> };
                expect(getAddress(String(skip.token))).toBe(getAddress(sc.token));
                expect(skip.checks).toMatchObject({ isHoneypot: false, isBlacklisted: false, locked: false, sufficientLiquidity: true, validMetadata: true, canSwap: true, hasLimits: false, mutable: false });
                expect(recordedAlerts().some((a) => a.via === 'ctx' && a.chain === 'base' && typeof a.message === 'string' && a.message.includes('Locked: `No`'))).toBe(true);
                // Nothing was sent, on any route, and no trades row was written.
                expect(msgEntry('All safety checks passed, buying')).toBeUndefined();
                expect(sc.node.submitted).toHaveLength(0);
                expect(sc.node.callLog.some((c) => c.method === 'eth_sendRawTransaction')).toBe(false);
                expect(sc.graph.db.prepare('SELECT 1 FROM trades').get()).toBeUndefined();
                expect(sc.timeline.entries.some((e: TimelineEntry) => e.kind === 'submit')).toBe(false);
            },
        });
    });

    it('public-v3-buy: a base V3 launch passes the V3 safety bank and the bot buys through the public route; the trades row comes after three confirmations', async () => {
        let clock!: BlockClock;
        let held!: Bought;
        await runScenario({
            name: 'public-v3-buy',
            tag: 'SUSPECT(AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-003,AUD-TX-016)',
            chain: 'base',
            dexType: 'v3',
            async steps(sc) {
                clock = blockClock(sc);
                held = await buyOnRoute(sc, clock);
            },
            async assertComplete(sc) {
                assertCheckerRan(sc);
                await assertBuyComplete(sc, clock, held);
            },
        });
    });

    it('public-full-sell: a base V3 position bought through the public route falls about 41 percent, and the stop-loss sells all of it through the public route', async () => {
        let clock!: BlockClock;
        let held!: Bought;
        let sell!: DecodedSell;
        await runScenario({
            name: 'public-full-sell',
            tag: 'SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-027,AUD-TX-016)',
            chain: 'base',
            dexType: 'v3',
            async steps(sc) {
                clock = blockClock(sc);
                ({ held, sell } = await buyThenStopLoss(sc, clock));
            },
            async assertComplete(sc) {
                assertCheckerRan(sc);
                await assertBuyComplete(sc, clock, held, 'sold');
                await assertSellComplete(sc, clock, held, sell);
            },
        });
    });
});
