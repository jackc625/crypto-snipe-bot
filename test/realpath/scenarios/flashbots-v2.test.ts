// test/realpath/scenarios/flashbots-v2.test.ts
// Phase 23 plan 23-20 (CHAR-02, AC-19 to AC-26): the Flashbots V2 golden-master family. Each test
// is one whole-graph scenario on the fake ETH chain (Flashbots is ETH's MEV route): a real
// PairCreated log reaches the real listener, the bot buys through a real Flashbots bundle, the
// exit monitor polls on the fixed fake clock, and one exit type fires and its private sell reaches
// the relay and is mined. runScenario (driver.ts) records the ordered timeline of op logs,
// submitted transactions, relay bodies and DB writes, and compares it byte for byte with
// test/realpath/recordings/<name>.jsonl. A normal run never writes a recording; only
// `npm run recordings:update` does (AC-25).
//
// The chain answers through the triage fixtures, unchanged: the buy and arming
// (fixtures/AUD-EXIT-002-position.ts), the sell side computed from mined transactions and another
// wallet's real trades that move the price (fixtures/AUD-EXIT-001-sell-path.ts), the anti-rug live
// gates (fixtures/AUD-ANTIRUG-003-live.ts) and the deployer's real liquidity pull
// (fixtures/AUD-EXIT-014-rug.ts). After the trigger the chain moves at the network's 12 s cadence
// (driver.ts driveSlots). Nothing here holds a call in flight, so AUD-TX-028 (one held provider
// read stalls the chain's provider) cannot decide a result. No scenario restarts the graph, so
// AUD-ANTIRUG-025 does not apply.
//
// Every assertComplete proves its exit finished before anything is compared or written: the exit
// reason in the op log, the sell in node.history as mined, the receipt the node returns for it
// decoded with real ethers and equal to the row the bot wrote, and the resulting database state.
//
// Tags (AC-21, AC-46) are chosen from what each timeline shows against the register's confirmed
// findings; the SUMMARY of plan 23-20 lists, per scenario, the timeline lines behind each cited ID
// and the confirmed findings checked and ruled out.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, getAddress } from 'ethers';
import type { Scenario } from '../harness/world';
import { stepUntilTrue, v2AmountOut } from '../harness/world';
import { buyAndMine, buyRow, exitStateRow, listen, opEntries, opLogged, waitAntiRugArmed } from '../triage/fixtures/AUD-EXIT-002-position';
import { foreignTrade, installSellPath, sellsSubmitted, type DecodedSell } from '../triage/fixtures/AUD-EXIT-001-sell-path';
import { settleAntiRugArming } from '../triage/fixtures/AUD-TX-002-lock';
import { afterExitPoll, liveGates, liveOverrides } from '../triage/fixtures/AUD-ANTIRUG-003-live';
import { pullLiquidity } from '../triage/fixtures/AUD-EXIT-014-rug';
import { driveSlots, runScenario } from './driver';

/** A breaker threshold the one rug's dispatches cannot reach (AUD-ANTIRUG-003 counts each one). */
const ANTIRUG_BREAKER_TRIGGERS = 10;

const WETH_EVENTS = new Interface(['event Withdrawal(address indexed src, uint256 wad)']);

interface Held {
    tradeId: number;
    bought: bigint;
}

/** The real snipe, bought through its Flashbots bundle and armed (exit monitor and anti-rug). */
async function buyAndArm(sc: Scenario<'v2'>): Promise<Held> {
    await listen(sc);
    const { buy } = await buyAndMine(sc);
    await waitAntiRugArmed(sc);
    expect(opLogged('exit.monitor.started')).toBe(true);
    const bought = v2AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token);
    installSellPath(sc, { bought });
    const row = buyRow(sc);
    expect(row?.status).toBe('pending');
    return { tradeId: row!.id, bought };
}

interface TradeRowFull {
    tx_hash: string;
    amount_in: string;
    amount_out: string | null;
    price_at_action: string | null;
    status: string;
}

/** The scenario token's trades rows of one action. */
function rowsOf(sc: Scenario<'v2'>, action: 'buy' | 'sell' | 'partial_sell'): TradeRowFull[] {
    return sc.graph.db
        .prepare('SELECT tx_hash, amount_in, amount_out, price_at_action, status FROM trades WHERE token = ? AND chain = ? AND action = ? ORDER BY id')
        .all(sc.token.toLowerCase(), sc.chain, action) as TradeRowFull[];
}

/** The sold position: the sell row, its receipt and the closed buy row. */
function soldRows(sc: Scenario<'v2'>): { buy: { status: string } | undefined; sell: TradeRowFull | undefined } {
    return { buy: rowsOf(sc, 'buy')[0], sell: rowsOf(sc, 'sell')[0] };
}

/** The position is closed: the buy row sold and its exit_state row gone. */
function closed(sc: Scenario<'v2'>, held: Held): boolean {
    return soldRows(sc).buy?.status === 'sold' && exitStateRow(sc, held.tradeId) === undefined;
}

/** The one sell the wallet sent through the router since `fromSubmit`. */
function onlySell(sc: Scenario<'v2'>, fromSubmit: number): DecodedSell {
    const sells = sellsSubmitted(sc).filter((s) => sc.node.submitted.findIndex((x) => x.hash === s.hash) >= fromSubmit);
    expect(sells).toHaveLength(1);
    return sells[0];
}

/**
 * The WETH the router paid out for `hash`, read from the receipt the node returns for it and
 * decoded with real ethers (the Withdrawal log the bot's receipt decoder reads).
 */
async function receiptWethOut(sc: Scenario<'v2'>, hash: string): Promise<bigint> {
    const reply = (await sc.node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] })) as {
        result?: { status: string; logs: Array<{ address: string; topics: string[]; data: string }> } | null;
    };
    const receipt = reply.result;
    expect(receipt, `the node has a receipt for ${hash}`).toBeTruthy();
    expect(receipt!.status).toBe('0x1');
    const outs = receipt!.logs
        .filter((l) => getAddress(l.address) === getAddress(sc.weth))
        .map((l) => WETH_EVENTS.parseLog(l))
        .filter((p) => p?.name === 'Withdrawal')
        .map((p) => p!.args.wad as bigint);
    expect(outs).toHaveLength(1);
    return outs[0];
}

/** The private sell, mined: route, node status and its history event. */
function assertMinedPrivateSell(sc: Scenario<'v2'>, sell: DecodedSell, amountIn: bigint): void {
    expect(sell.route).toBe('bundle');
    expect(sc.node.statusOf(sell.hash)).toBe('mined');
    expect(sc.node.history.some((h) => h.event === 'mined' && h.hash === sell.hash)).toBe(true);
    expect(sell.call).toBe('swapExactTokensForETH');
    expect(sell.tokenOut).toBe(getAddress(sc.weth));
    expect(sell.amountIn).toBe(amountIn);
}

/** The completion proof every full exit shares (see each test's assertComplete). */
async function assertFullExitComplete(sc: Scenario<'v2'>, held: Held, sell: DecodedSell, trigger: string, reason: string): Promise<void> {
    expect(opEntries(trigger).length).toBeGreaterThanOrEqual(1);
    assertMinedPrivateSell(sc, sell, held.bought);
    expect(opEntries('exit.full.executed').map((e) => [e.reason, e.txHash])).toEqual([[reason, sell.hash]]);
    // A real decoded receipt: the bot's decoder and the node's receipt agree on the WETH paid out.
    const out = await receiptWethOut(sc, sell.hash);
    const decoded = opEntries('exit.receipt.decoded').filter((e) => e.txHash === sell.hash);
    expect(decoded.map((e) => e.amountOut)).toEqual([out.toString()]);
    // The database: a sell row carrying that hash and receipt, the buy row sold, exit_state gone.
    const rows = soldRows(sc);
    expect(rows.buy?.status).toBe('sold');
    expect(rows.sell).toEqual(expect.objectContaining({ tx_hash: sell.hash, amount_in: held.bought.toString(), amount_out: out.toString(), status: 'sold' }));
    expect(exitStateRow(sc, held.tradeId)).toBeUndefined();
}

describe('golden master: Flashbots V2 buys with each exit type (CHAR-02)', () => {
    it('flashbots-v2-trailing: a V2 Flashbots buy rises past 2x, falls back past the trailing stop, and the private sell is mined', async () => {
        let held!: Held;
        let sell!: DecodedSell;
        await runScenario({
            name: 'flashbots-v2-trailing',
            tag: 'SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-TX-012)',
            chain: 'eth',
            dexType: 'v2',
            async steps(sc) {
                held = await buyAndArm(sc);
                // Another wallet buys with half the pool's ETH: the price about 2.25x, so a poll
                // activates the trailing stop (no partial tiers: PARTIAL_SELL_TARGETS is empty).
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

    it('flashbots-v2-partial: a V2 Flashbots buy crosses the 2x partial tier, and the private partial sell of a quarter is mined', async () => {
        let held!: Held;
        let sell!: DecodedSell;
        await runScenario({
            name: 'flashbots-v2-partial',
            tag: 'SUSPECT(AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-025,AUD-TX-012)',
            chain: 'eth',
            dexType: 'v2',
            overrides: { PARTIAL_SELL_TARGETS: '2x:25' },
            async steps(sc) {
                held = await buyAndArm(sc);
                // Another wallet buys with half the pool's ETH: the price about 2.25x, past the 2x tier.
                const fromSubmit = sc.node.submitted.length;
                await foreignTrade(sc, { buyEth: sc.reserves.weth / 2n });
                await driveSlots(sc, {
                    until: () => opLogged('exit.partial.dispatched.completed') && rowsOf(sc, 'partial_sell').length === 1,
                    what: 'the partial sell confirming and its tier being persisted',
                });
                sell = onlySell(sc, fromSubmit);
            },
            async assertComplete(sc) {
                const quarter = (held.bought * 25n) / 100n;
                expect(opEntries('exit.partial.submitted').map((e) => e.tiers)).toEqual(['2x:25%']);
                expect(opEntries('exit.partial.executed').map((e) => e.txHash)).toEqual([sell.hash]);
                assertMinedPrivateSell(sc, sell, quarter);
                // The partial-sell row carries the receipt the node returns for the sell.
                const out = await receiptWethOut(sc, sell.hash);
                const partial = rowsOf(sc, 'partial_sell');
                expect(partial).toEqual([expect.objectContaining({ tx_hash: sell.hash, amount_in: quarter.toString(), amount_out: out.toString(), status: 'sold' })]);
                // The position stays open with its tier recorded; no full exit fired.
                expect(rowsOf(sc, 'buy')[0].status).toBe('pending');
                const st = sc.graph.db.prepare('SELECT partial_tiers_completed FROM exit_state WHERE trade_id = ?').get(held.tradeId) as { partial_tiers_completed: string } | undefined;
                expect(st?.partial_tiers_completed).toBe('[0]');
                expect(rowsOf(sc, 'sell')).toEqual([]);
                for (const op of ['exit.trigger.trailing-stop', 'exit.trigger.stop-loss', 'exit.trigger.urgency']) expect(opLogged(op)).toBe(false);
            },
        });
    });

    it('flashbots-v2-stop-loss: a V2 Flashbots buy falls about 41 percent, past the 25 percent stop-loss, and the private sell is mined', async () => {
        let held!: Held;
        let sell!: DecodedSell;
        await runScenario({
            name: 'flashbots-v2-stop-loss',
            tag: 'SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-TX-012)',
            chain: 'eth',
            dexType: 'v2',
            async steps(sc) {
                held = await buyAndArm(sc);
                // Another wallet dumps 30 percent of the pool's tokens: the price falls about 41 percent.
                const fromSubmit = sc.node.submitted.length;
                await foreignTrade(sc, { sellTokens: (sc.reserves.token * 3n) / 10n });
                await driveSlots(sc, { until: () => closed(sc, held), what: 'the stop-loss exit closing the position' });
                sell = onlySell(sc, fromSubmit);
                await settleAntiRugArming(sc, 1);
            },
            async assertComplete(sc) {
                await assertFullExitComplete(sc, held, sell, 'exit.trigger.stop-loss', 'stop-loss');
                expect(opLogged('exit.trailing.activated')).toBe(false);
                expect(opLogged('exit.trigger.trailing-stop')).toBe(false);
            },
        });
    });

    it('flashbots-v2-urgency: a V2 Flashbots buy whose price never moves is sold by the urgency exit once the 30-minute window passes', async () => {
        let held!: Held;
        let sell!: DecodedSell;
        await runScenario({
            name: 'flashbots-v2-urgency',
            tag: 'SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-TX-012)',
            chain: 'eth',
            dexType: 'v2',
            async steps(sc) {
                held = await buyAndArm(sc);
                expect(sc.graph.exitEngine.exitConfig.urgencyWindowMs).toBe(30 * 60_000);
                const fromSubmit = sc.node.submitted.length;
                // The quiet window: a block every 12 s, 1 s steps, until the urgency exit fires.
                const lastBlockAt = await driveSlots(sc, { until: () => opLogged('exit.trigger.urgency'), what: 'the urgency exit firing', maxVirtualMs: 40 * 60_000, stepMs: 1_000 });
                // Then the exit itself at the normal step.
                await driveSlots(sc, { until: () => closed(sc, held), what: 'the urgency exit closing the position', lastBlockAt });
                sell = onlySell(sc, fromSubmit);
                await settleAntiRugArming(sc, 1);
            },
            async assertComplete(sc) {
                await assertFullExitComplete(sc, held, sell, 'exit.trigger.urgency', 'urgency-market-sell');
                // It fired only once the window had passed since the monitor started.
                const started = opEntries('exit.monitor.started');
                expect(started).toHaveLength(1);
                for (const op of ['exit.trailing.activated', 'exit.trigger.trailing-stop', 'exit.trigger.stop-loss']) expect(opLogged(op)).toBe(false);
            },
        });
    });

    it('flashbots-v2-anti-rug: with live anti-rug, a 95 percent liquidity pull trips all three signals, the confirm block passes, and the anti-rug private sell is mined', async () => {
        let held!: Held;
        let sell!: DecodedSell;
        await runScenario({
            name: 'flashbots-v2-anti-rug',
            tag: 'SUSPECT(AUD-ANTIRUG-003,AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-014,AUD-TX-012)',
            chain: 'eth',
            dexType: 'v2',
            // Live execution, one confirm block, and a breaker threshold the rug cannot reach,
            // set before the graph loads (fixtures/AUD-ANTIRUG-003-live.ts).
            overrides: liveOverrides(ANTIRUG_BREAKER_TRIGGERS),
            async steps(sc) {
                liveGates(sc, ANTIRUG_BREAKER_TRIGGERS);
                held = await buyAndArm(sc);
                // Right after an exit poll, the deployer pulls 95 percent of the liquidity through
                // the real router: LP removed above lpRemovalPct, a destination outside the
                // allowlist, and reserves below half the baseline (a pro-rata pull leaves the price
                // unchanged, so no routine exit takes part).
                await afterExitPoll(sc);
                const fromSubmit = sc.node.submitted.length;
                await pullLiquidity(sc, { removeBps: 9_500n });
                await stepUntilTrue(() => opLogged('antirug.confirm-gate.scheduled'), { what: 'the anti-rug confirm gate being scheduled', maxSteps: 2_000 });
                // The next block is the confirm block; then the exit runs at the network's cadence.
                await driveSlots(sc, { until: () => closed(sc, held), what: 'the anti-rug exit closing the position' });
                sell = onlySell(sc, fromSubmit);
                await settleAntiRugArming(sc, 1);
            },
            async assertComplete(sc) {
                expect(opLogged('antirug.exit.dispatch')).toBe(true);
                expect(opLogged('antirug.dry-run.would-have-sold')).toBe(false);
                expect(opLogged('antirug.cb-tripped')).toBe(false);
                await assertFullExitComplete(sc, held, sell, 'antirug.exit.dispatch', 'anti-rug');
                for (const op of ['exit.trigger.trailing-stop', 'exit.trigger.stop-loss', 'exit.trigger.urgency']) expect(opLogged(op)).toBe(false);
            },
        });
    });
});
