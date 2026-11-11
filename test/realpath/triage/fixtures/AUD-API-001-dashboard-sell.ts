// test/realpath/triage/fixtures/AUD-API-001-dashboard-sell.ts
// Phase 23 plan 23-08 (AUDIT-02): helpers shared by the dashboard-sell and exit-lifecycle triage
// files of this plan (AUD-API-001, AUD-EXIT-008, AUD-EXIT-007). Lives beside its tests: the harness
// is read-only for triage plans. It adds no behavior to the simulated node; every answer still
// comes from the scenario's reads, the sell-path reads of fixtures/AUD-EXIT-001-sell-path.ts, or a
// read set here through the public FakeNode API from transactions the node really mined.
//
// - openDashboard: the real dashboard API (src/api/server.ts startApiServer, the real auth flow)
//   on a loopback port, through fixtures/AUD-BUY-011-dashboard.ts.
// - postDriven: one POST to a real dashboard route, over node:http (never axios: the realpath
//   setup routes axios to the harness, so a call through it never reaches the real route), while
//   the chain is driven the way the network would answer the sell the route may start: a public
//   transaction of the wallet is mined in the next block; a bundle transaction either lands one
//   slot (12 s) after it was first seen ('land'), or the slot passes with an empty block, as a
//   builder that did not include it would leave it ('miss'). Every wait is a step of fake time
//   followed by one real event-loop turn (the HTTP answer is real I/O), never a sleep.
// - heldPosition: a real snipe through the real listener, bought, armed (exit monitor and
//   anti-rug), with the sell side of the chain installed.

import * as http from 'node:http';
import { vi } from 'vitest';
import { Interface, Wallet, ethers, getAddress, parseEther } from 'ethers';
import type { Submitted } from '../../harness/chain';
import { encodeResult } from '../../harness/chain';
import { stepFor, v2AmountOut, v3AmountOut, type Scenario } from '../../harness/world';
import { freeLoopbackPort, startDashboard, type Dashboard } from './AUD-BUY-011-dashboard';
import { buyAndMine, buyRow, listen, opLogged, waitAntiRugArmed } from './AUD-EXIT-002-position';
import { decodeSellRaw, installSellPath, sellRouterOf } from './AUD-EXIT-001-sell-path';

// The real setImmediate, captured when this module loads (before any scenario installs the fake
// clock, which also patches the timers module).
const REAL_SET_IMMEDIATE: (cb: () => void) => unknown = globalThis.setImmediate;
const realTurn = (): Promise<void> => new Promise<void>((resolve) => REAL_SET_IMMEDIATE(resolve));

/** Env overrides that put the real dashboard on a free loopback port (set before the graph loads). */
export async function dashboardOverrides(): Promise<Record<string, string>> {
    return { DASHBOARD_HOST: '127.0.0.1', DASHBOARD_PORT: String(await freeLoopbackPort()) };
}

/** The real dashboard API for this scenario's graph, logged in through the real login route. */
export async function openDashboard(sc: Scenario): Promise<{ dash: Dashboard; cookie: string }> {
    const { startApiServer } = await import('../../../../src/api/server');
    const dash = await startDashboard(startApiServer as never, [sc.ctx]);
    const cookie = await dash.login();
    return { dash, cookie };
}

export interface DrivenReply {
    status: number;
    body: unknown;
}

function rawPost(port: number, urlPath: string, cookie: string): Promise<DrivenReply> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { host: '127.0.0.1', port, path: urlPath, method: 'POST', agent: false, headers: { connection: 'close', cookie, 'content-type': 'application/json', 'content-length': '2' } },
            (res) => {
                let text = '';
                res.on('data', (c: Buffer) => (text += c.toString('utf8')));
                res.on('end', () => {
                    let body: unknown = text;
                    try {
                        body = text === '' ? null : JSON.parse(text);
                    } catch {
                        /* keep the text */
                    }
                    resolve({ status: res.statusCode ?? 0, body });
                });
            },
        );
        req.on('error', reject);
        req.end('{}');
    });
}

export type BundleMode = 'land' | 'miss';

// A Transaction recovers its sender from the signature on every read of `from`, which is slow
// enough to dominate a long drive; each submission's sender is read once.
const SENDER = new WeakMap<Submitted, string>();
function senderOf(s: Submitted): string {
    let from = SENDER.get(s);
    if (from === undefined) {
        from = (s.tx.from ?? '').toLowerCase();
        SENDER.set(s, from);
    }
    return from;
}

/**
 * POST `urlPath` on the real dashboard with the session cookie and drive the chain until the
 * answer arrives (see the file header). Throws if no answer arrives within `maxVirtualMs`.
 */
export async function postDriven(sc: Scenario, dash: Dashboard, urlPath: string, cookie: string, mode: BundleMode, maxVirtualMs = 600_000): Promise<DrivenReply> {
    const port = Number(new URL(dash.baseUrl).port);
    let done = false;
    let failed = false;
    let reply!: DrivenReply;
    let err: unknown;
    rawPost(port, urlPath, cookie).then(
        (r) => {
            done = true;
            reply = r;
        },
        (e: unknown) => {
            done = true;
            failed = true;
            err = e;
        },
    );
    const { node } = sc;
    const wallet = sc.wallet.address.toLowerCase();
    const slotStart = new Map<string, number>();
    const end = Date.now() + maxVirtualMs;
    while (!done && Date.now() < end) {
        await vi.advanceTimersByTimeAsync(50);
        await realTurn();
        const waiting = node.submitted.filter((s) => s.status === 'accepted' && senderOf(s) === wallet);
        const publicTxs = waiting.filter((s) => s.route === 'public').map((s) => s.hash);
        if (publicTxs.length > 0) node.mine({ include: publicTxs });
        const bundled = waiting.filter((s) => s.route === 'bundle');
        for (const s of bundled) if (!slotStart.has(s.hash)) slotStart.set(s.hash, Date.now());
        const due = bundled.filter((s) => Date.now() - slotStart.get(s.hash)! >= 12_000);
        if (due.length === 0) continue;
        if (mode === 'miss') {
            // The slot passes and the builder's block does not hold the bundle.
            node.mine({ include: [] });
            for (const s of due) slotStart.set(s.hash, Date.now());
        } else {
            // The newest transaction per nonce that targets the next block lands.
            const next = node.head + 1;
            const byNonce = new Map<number, Submitted>();
            for (const s of bundled) if (s.targetBlocks.includes(next)) byNonce.set(s.tx.nonce, s);
            const include = [...byNonce.values()].sort((a, b) => a.tx.nonce - b.tx.nonce).map((s) => s.hash);
            node.mine({ include });
            for (const s of due) slotStart.set(s.hash, Date.now());
        }
    }
    if (!done) throw new Error(`postDriven ${urlPath}: no answer within ${maxVirtualMs} virtual ms`);
    if (failed) throw err;
    return reply;
}

/** Every sell the bot's wallet submitted through the scenario's sell router at or after `fromSubmit`. */
export function sellsSince(sc: Scenario, fromSubmit: number): Submitted[] {
    const router = sellRouterOf(sc);
    return sc.node.submitted.slice(fromSubmit).filter((s) => senderOf(s) === sc.wallet.address.toLowerCase() && decodeSellRaw(s.raw, router, sc.token) !== null);
}

export interface HeldPosition {
    tradeId: number;
    /** The tokens the bot's buy received. */
    bought: bigint;
}

/** Buy and arm a position on the real path, then install the sell side of the chain. */
export async function heldPosition(sc: Scenario): Promise<HeldPosition> {
    await listen(sc);
    const { buy } = await buyAndMine(sc);
    // The arming wait mines any public transaction of the wallet (a buy-time approve fix).
    await waitAntiRugArmed(sc);
    if (!opLogged('exit.monitor.started')) throw new Error('heldPosition: the exit monitor did not start');
    const bought = sc.dex.dexType === 'v2' ? v2AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token) : v3AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token, sc.feeTier!);
    installSellPath(sc, { bought });
    const row = buyRow(sc);
    if (!row || row.status !== 'pending') throw new Error(`heldPosition: no pending buy row (${JSON.stringify(row)})`);
    return { tradeId: row.id, bought };
}

export interface ExitStatusRow {
    exit_status: string | null;
    exit_failure_count: number;
}

export function exitStatusOf(sc: Scenario, tradeId: number): ExitStatusRow | undefined {
    return sc.graph.db.prepare('SELECT exit_status, exit_failure_count FROM exit_state WHERE trade_id = ?').get(tradeId) as ExitStatusRow | undefined;
}

const ERC20_TRANSFER = new Interface(['function transfer(address to, uint256 amount) returns (bool)', 'event Transfer(address indexed from, address indexed to, uint256 value)']);

/**
 * Another holder of the token who sends some to the bot's wallet: a real signed ERC-20
 * transfer(wallet, amount), and the wallet's balanceOf re-served so it counts every such transfer
 * that was really mined, on top of the sell-path balance (bought minus every mined sell). The
 * sender's own balance is its holding minus what it sent, so a real token would accept the
 * transfer. Returns `send()`, which signs the transfer and enters it in the public pool, and the
 * Transfer log the token emits for it.
 */
export function incomingHolder(sc: Scenario, opts: { bought: bigint; holding: bigint }): {
    holder: string;
    send(amount: bigint): Promise<{ hash: string; log: { address: string; topics: string[]; data: string; transactionHash: string } }>;
} {
    const { node, token, pair, reserves } = sc;
    const holder = new Wallet(ethers.id('realpath.plan-23-08.token-holder'));
    node.setBalance(holder.address, parseEther('1'));
    const wallet = sc.wallet.address.toLowerCase();
    const router = sellRouterOf(sc);
    const sent: Array<{ hash: string; amount: bigint }> = [];
    const minedIn = (): bigint => sent.filter((t) => node.isMined(t.hash)).reduce((a, t) => a + t.amount, 0n);
    const soldOut = (): bigint =>
        node.submitted
            .filter((s) => s.status === 'mined' && senderOf(s) === wallet)
            .map((s) => decodeSellRaw(s.raw, router, token))
            .reduce((a, d) => a + (d?.amountIn ?? 0n), 0n);
    node.setRead(token, 'balanceOf(address)', ({ args }) => {
        const who = String(args[0]).toLowerCase();
        if (who === pair.toLowerCase()) return encodeResult(['uint256'], [reserves.token]);
        if (who === wallet) {
            const left = opts.bought - soldOut() + minedIn();
            return encodeResult(['uint256'], [left > 0n ? left : 0n]);
        }
        if (who === holder.address.toLowerCase()) return encodeResult(['uint256'], [opts.holding - minedIn()]);
        return encodeResult(['uint256'], [0n]);
    });
    return {
        holder: getAddress(holder.address),
        async send(amount: bigint) {
            const raw = await holder.signTransaction({
                chainId: node.chainId, nonce: node.minedCount(holder.address), to: token, value: 0n, gasLimit: 80_000n, type: 2,
                maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, data: ERC20_TRANSFER.encodeFunctionData('transfer', [sc.wallet.address, amount]),
            });
            const hash = node.addForeignTransaction(raw);
            sent.push({ hash, amount });
            const e = ERC20_TRANSFER.encodeEventLog('Transfer', [holder.address, sc.wallet.address, amount]);
            return { hash, log: { address: token, topics: e.topics, data: e.data, transactionHash: hash } };
        },
    };
}

/** Step the fake clock until `pred` holds or `windowMs` of virtual time passed (never throws). */
export async function stepUntilOrFor(pred: () => boolean, windowMs: number, stepMs = 50): Promise<void> {
    const end = Date.now() + windowMs;
    while (!pred() && Date.now() < end) await stepFor(stepMs, stepMs);
}
