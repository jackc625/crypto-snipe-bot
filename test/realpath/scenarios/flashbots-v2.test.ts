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
// wallet's real trades that move the price (fixtures/AUD-EXIT-001-sell-path.ts). Nothing here
// holds a call in flight (AUD-TX-028 cannot decide a result).
//
// Tags (AC-21, AC-46) are chosen from what each timeline shows against the register's confirmed
// findings; the SUMMARY of plan 23-20 lists, per scenario, the timeline lines behind each cited ID
// and the confirmed findings checked and ruled out.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { getAddress } from 'ethers';
import type { Scenario } from '../harness/world';
import { stepUntilTrue, v2AmountOut } from '../harness/world';
import { buyAndMine, buyRow, exitStateRow, listen, opEntries, opLogged, waitAntiRugArmed } from '../triage/fixtures/AUD-EXIT-002-position';
import { foreignTrade, installSellPath, sellsSubmitted, type DecodedSell } from '../triage/fixtures/AUD-EXIT-001-sell-path';
import { settleAntiRugArming } from '../triage/fixtures/AUD-TX-002-lock';
import { driveSlots, runScenario } from './driver';

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

/** The sold position: the sell row, its receipt and the closed buy row. */
function soldRows(sc: Scenario<'v2'>): { buy: { status: string } | undefined; sell: { tx_hash: string; amount_in: string; amount_out: string | null; status: string } | undefined } {
    const buy = sc.graph.db.prepare("SELECT status FROM trades WHERE token = ? AND chain = ? AND action = 'buy'").get(sc.token.toLowerCase(), sc.chain) as { status: string } | undefined;
    const sell = sc.graph.db.prepare("SELECT tx_hash, amount_in, amount_out, status FROM trades WHERE token = ? AND chain = ? AND action = 'sell'").get(sc.token.toLowerCase(), sc.chain) as
        | { tx_hash: string; amount_in: string; amount_out: string | null; status: string }
        | undefined;
    return { buy, sell };
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

/** The completion proof every full exit shares (see each test's assertComplete). */
function assertFullExitComplete(sc: Scenario<'v2'>, held: Held, sell: DecodedSell, trigger: string): void {
    expect(opEntries(trigger).length).toBeGreaterThanOrEqual(1);
    // The private sell, mined: node status and its history event.
    expect(sell.route).toBe('bundle');
    expect(sc.node.statusOf(sell.hash)).toBe('mined');
    expect(sc.node.history.some((h) => h.event === 'mined' && h.hash === sell.hash)).toBe(true);
    // A real decoded receipt: the WETH the router paid out, read by the bot's receipt decoder.
    const decoded = opEntries('exit.receipt.decoded').filter((e) => e.txHash === sell.hash);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].amountOut).not.toBeNull();
    expect(BigInt(String(decoded[0].amountOut))).toBeGreaterThan(0n);
    // The database: a sell row carrying that hash and receipt, the buy row sold, exit_state gone.
    const rows = soldRows(sc);
    expect(rows.buy?.status).toBe('sold');
    expect(rows.sell).toEqual(expect.objectContaining({ tx_hash: sell.hash, amount_in: held.bought.toString(), amount_out: String(decoded[0].amountOut), status: 'sold' }));
    expect(exitStateRow(sc, held.tradeId)).toBeUndefined();
    expect(sell.call).toBe('swapExactTokensForETH');
    expect(sell.tokenOut).toBe(getAddress(sc.weth));
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
            assertComplete(sc) {
                assertFullExitComplete(sc, held, sell, 'exit.trigger.trailing-stop');
                expect(opLogged('exit.trigger.stop-loss')).toBe(false);
            },
        });
    });
});
