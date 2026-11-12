// test/realpath/scenarios/flashbots-v3.test.ts
// Phase 23 plan 23-21 (CHAR-02, AC-19 to AC-24): the Flashbots V3 golden-master family. V3 has its
// own buy shape (QuoterV2 quote, SwapRouter02 multicall(deadline, [exactInputSingle]) with the fee
// tier) and its own sells, so the V2 recordings of plan 23-20 do not cover it. Each test is one
// whole-graph scenario on the fake ETH chain (Flashbots is ETH's MEV route): the launch's real
// NonfungiblePositionManager create-and-mint is mined and its real PoolCreated log reaches the real
// V3 listener, the bot finds the same-block Mint (waitForLiquidity), quotes through the real
// QuoterV2 read, buys through a real Flashbots bundle, the exit monitor polls the quoter on the
// fixed fake clock, and one exit type fires and its private V3 sell reaches the relay and is mined.
// runScenario (driver.ts) records the ordered timeline of op logs, submitted transactions, relay
// bodies and DB writes, and compares it byte for byte with test/realpath/recordings/<name>.jsonl. A
// normal run never writes a recording; only `npm run recordings:update` does (AC-25).
//
// The chain answers through the triage fixtures, unchanged: the buy and arming
// (fixtures/AUD-EXIT-002-position.ts), the sell side computed from mined transactions and another
// wallet's real SwapRouter02 trades that move the price (fixtures/AUD-EXIT-001-sell-path.ts, whose
// V3 sell receipt is the WETH Transfer(pool, wallet, out) SwapRouter02 emits) and the anti-rug live
// gates (fixtures/AUD-ANTIRUG-003-live.ts). The V3 liquidity pull is this file's own (pullV3Liquidity
// below): fixtures/AUD-EXIT-014-rug.ts pulls V2 liquidity only. After the trigger the chain moves at
// the network's 12 s cadence (driver.ts driveSlots).
//
// Hold points (AUD-TX-028): nothing here holds a call in flight. No provider read, relay call or
// bundle is parked, so one stalled read on the chain's HTTP provider cannot decide a result. No
// scenario restarts the graph, so AUD-ANTIRUG-025 does not apply.
//
// Every assertComplete proves its exit finished before anything is compared or written: the exit
// reason in the op log, the V3 sell (multicall/exactInputSingle to SwapRouter02) in node.history as
// mined, the receipt the node returns for it decoded with real ethers and equal to the row the bot
// wrote, and the resulting database state.
//
// Tags (AC-21, AC-46) are chosen from what each timeline shows against the register's confirmed
// findings; the SUMMARY of plan 23-21 lists, per scenario, the timeline lines behind each cited ID
// and the confirmed findings checked and ruled out.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Transaction, getAddress } from 'ethers';
import type { Scenario } from '../harness/world';
import { stepUntilTrue, v3AmountOut } from '../harness/world';
import { V3_QUOTER, V3_ROUTER, buyAndMine, buyRow, exitStateRow, listen, opEntries, opLogged, waitAntiRugArmed } from '../triage/fixtures/AUD-EXIT-002-position';
import { foreignTrade, installSellPath, sellsSubmitted, type DecodedSell } from '../triage/fixtures/AUD-EXIT-001-sell-path';
import { settleAntiRugArming } from '../triage/fixtures/AUD-TX-002-lock';
import { driveSlots, runScenario } from './driver';

const WETH_EVENTS = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);

interface Held {
    tradeId: number;
    bought: bigint;
}

/**
 * The real V3 snipe, bought through its Flashbots bundle and armed (exit monitor and anti-rug).
 * Also proves the V3 buy shape: the QuoterV2 buy quote (WETH in) came before the buy, and the buy
 * is SwapRouter02 multicall(deadline, [exactInputSingle(WETH -> token, the scenario fee tier, the
 * wallet)]) carrying the snipe amount as value.
 */
async function buyAndArm(sc: Scenario<'v3'>): Promise<Held> {
    await listen(sc);
    const { buy } = await buyAndMine(sc);
    await waitAntiRugArmed(sc);
    expect(opLogged('exit.monitor.started')).toBe(true);
    const tx = Transaction.from(buy.raw);
    expect(getAddress(tx.to!)).toBe(getAddress(sc.dex.swapRouterAddress));
    const outer = V3_ROUTER.parseTransaction({ data: tx.data, value: tx.value })!;
    expect(outer.name).toBe('multicall');
    const inner = (outer.args[1] as string[]).map((d) => V3_ROUTER.parseTransaction({ data: d })!);
    expect(inner.map((c) => c.name)).toEqual(['exactInputSingle']);
    const p = inner[0].args[0] as unknown as { tokenIn: string; tokenOut: string; fee: bigint; recipient: string; amountIn: bigint };
    expect([getAddress(p.tokenIn), getAddress(p.tokenOut), Number(p.fee), getAddress(p.recipient), p.amountIn]).toEqual([
        getAddress(sc.weth), getAddress(sc.token), sc.feeTier, getAddress(sc.wallet.address), tx.value,
    ]);
    const buyQuotes = sc.node.callLog.filter((c) => {
        if (c.method !== 'eth_call' || !c.data || !c.to || getAddress(c.to) !== getAddress(sc.dex.quoterAddress)) return false;
        const q = V3_QUOTER.decodeFunctionData('quoteExactInputSingle', c.data)[0] as unknown as { tokenIn: string; tokenOut: string; fee: bigint };
        return getAddress(q.tokenIn) === getAddress(sc.weth) && getAddress(q.tokenOut) === getAddress(sc.token) && Number(q.fee) === sc.feeTier;
    });
    expect(buyQuotes.length).toBeGreaterThanOrEqual(1);
    const bought = v3AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token, sc.feeTier!);
    installSellPath(sc, { bought });
    const row = buyRow(sc);
    expect(row).toEqual(expect.objectContaining({ status: 'pending', pool_type: 'v3', fee_tier: sc.feeTier, dex_name: sc.dex.name }));
    return { tradeId: row!.id, bought };
}

interface TradeRowFull {
    tx_hash: string;
    amount_in: string;
    amount_out: string | null;
    price_at_action: string | null;
    status: string;
    pool_type: string;
    fee_tier: number | null;
}

/** The scenario token's trades rows of one action. */
function rowsOf(sc: Scenario<'v3'>, action: 'buy' | 'sell' | 'partial_sell'): TradeRowFull[] {
    return sc.graph.db
        .prepare('SELECT tx_hash, amount_in, amount_out, price_at_action, status, pool_type, fee_tier FROM trades WHERE token = ? AND chain = ? AND action = ? ORDER BY id')
        .all(sc.token.toLowerCase(), sc.chain, action) as TradeRowFull[];
}

/** The position is closed: the buy row sold and its exit_state row gone. */
function closed(sc: Scenario<'v3'>, held: Held): boolean {
    return rowsOf(sc, 'buy')[0]?.status === 'sold' && exitStateRow(sc, held.tradeId) === undefined;
}

/** The one sell the wallet sent through SwapRouter02 since `fromSubmit`. */
function onlySell(sc: Scenario<'v3'>, fromSubmit: number): DecodedSell {
    const sells = sellsSubmitted(sc).filter((s) => sc.node.submitted.findIndex((x) => x.hash === s.hash) >= fromSubmit);
    expect(sells).toHaveLength(1);
    return sells[0];
}

/**
 * The WETH SwapRouter02 paid the wallet for `hash`, read from the receipt the node returns for it
 * and decoded with real ethers (the WETH Transfer(pool, wallet) log the bot's receipt decoder reads).
 */
async function receiptWethOut(sc: Scenario<'v3'>, hash: string): Promise<bigint> {
    const reply = (await sc.node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] })) as {
        result?: { status: string; logs: Array<{ address: string; topics: string[]; data: string }> } | null;
    };
    const receipt = reply.result;
    expect(receipt, `the node has a receipt for ${hash}`).toBeTruthy();
    expect(receipt!.status).toBe('0x1');
    const outs = receipt!.logs
        .filter((l) => getAddress(l.address) === getAddress(sc.weth))
        .map((l) => WETH_EVENTS.parseLog(l))
        .filter((p) => p?.name === 'Transfer' && getAddress(p.args.from as string) === getAddress(sc.pair) && getAddress(p.args.to as string) === getAddress(sc.wallet.address))
        .map((p) => p!.args.value as bigint);
    expect(outs).toHaveLength(1);
    return outs[0];
}

/** The private V3 sell, mined: route, node status, its history event and its decoded call. */
function assertMinedPrivateSell(sc: Scenario<'v3'>, sell: DecodedSell, amountIn: bigint): void {
    expect(sell.route).toBe('bundle');
    expect(sc.node.statusOf(sell.hash)).toBe('mined');
    expect(sc.node.history.some((h) => h.event === 'mined' && h.hash === sell.hash)).toBe(true);
    expect(sell.call).toBe('multicall/exactInputSingle');
    expect(sell.to).toBe(getAddress(sc.dex.swapRouterAddress));
    expect(sell.tokenIn).toBe(getAddress(sc.token));
    expect(sell.tokenOut).toBe(getAddress(sc.weth));
    expect(sell.recipient).toBe(getAddress(sc.wallet.address));
    expect(sell.amountIn).toBe(amountIn);
}

/** The completion proof every full exit shares (see each test's assertComplete). */
async function assertFullExitComplete(sc: Scenario<'v3'>, held: Held, sell: DecodedSell, trigger: string, reason: string): Promise<void> {
    expect(opEntries(trigger).length).toBeGreaterThanOrEqual(1);
    assertMinedPrivateSell(sc, sell, held.bought);
    expect(opEntries('exit.full.executed').map((e) => [e.reason, e.txHash])).toEqual([[reason, sell.hash]]);
    // A real decoded receipt: the bot's decoder and the node's receipt agree on the WETH paid out.
    const out = await receiptWethOut(sc, sell.hash);
    const decoded = opEntries('exit.receipt.decoded').filter((e) => e.txHash === sell.hash);
    expect(decoded.map((e) => e.amountOut)).toEqual([out.toString()]);
    // The database: a V3 sell row carrying that hash and receipt, the buy row sold, exit_state gone.
    const sold = rowsOf(sc, 'sell');
    expect(sold).toEqual([expect.objectContaining({ tx_hash: sell.hash, amount_in: held.bought.toString(), amount_out: out.toString(), status: 'sold', pool_type: 'v3', fee_tier: sc.feeTier })]);
    expect(rowsOf(sc, 'buy')[0].status).toBe('sold');
    expect(exitStateRow(sc, held.tradeId)).toBeUndefined();
}

describe('golden master: Flashbots V3 buys with each exit type (CHAR-02)', () => {
    it('flashbots-v3-trailing: a V3 Flashbots buy rises past 2x, falls back past the trailing stop, and the private V3 sell is mined', async () => {
        let held!: Held;
        let sell!: DecodedSell;
        await runScenario({
            name: 'flashbots-v3-trailing',
            tag: 'SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-027,AUD-TX-012)',
            chain: 'eth',
            dexType: 'v3',
            async steps(sc) {
                held = await buyAndArm(sc);
                // Another wallet buys through SwapRouter02 with half the pool's ETH: the price about
                // 2.25x, so a poll activates the trailing stop (no partial tiers: PARTIAL_SELL_TARGETS
                // is empty).
                await foreignTrade(sc, { buyEth: sc.reserves.weth / 2n });
                await stepUntilTrue(() => opLogged('exit.trailing.activated'), { what: 'the trailing stop activating', maxSteps: 2_000 });
                // Then it dumps half the pool's tokens: about 56 percent below the peak, past the
                // 15 percent trailing stop.
                const fromSubmit = sc.node.submitted.length;
                await foreignTrade(sc, { sellTokens: sc.reserves.token / 2n });
                // The network's 12 s cadence mines the bot's approve, then its sell bundle at a
                // block the bundle targets.
                await driveSlots(sc, { until: () => closed(sc, held), what: 'the trailing-stop exit closing the position' });
                sell = onlySell(sc, fromSubmit);
                await settleAntiRugArming(sc, 1);
            },
            async assertComplete(sc) {
                await assertFullExitComplete(sc, held, sell, 'exit.trigger.trailing-stop', 'trailing-stop');
                expect(opLogged('exit.trigger.stop-loss')).toBe(false);
            },
        });
    });
});
