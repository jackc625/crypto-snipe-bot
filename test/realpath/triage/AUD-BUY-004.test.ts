// test/realpath/triage/AUD-BUY-004.test.ts
// Phase 23 plan 23-09 Task 3 (AUDIT-02, AC-12): AUD-BUY-004, the double-buy race. src/bot.ts
// handleNewPairForChain reads isTokenSniped (SELECT 1 FROM trades WHERE token AND chain) once, as
// its first statement, and the token's trades row is written only after submitBuyTx returned, many
// awaits later. submitBuyTx serializes the two submits through withNonceLock but nothing re-checks
// the token inside the lock, so a second handler for the same token that passed the check while
// the first was still buying waits for the lock and then buys again. Concurrency sources the
// finding traced: V2 and V3 events for one token, two V2 DEXes, the Telegram alpha route
// (src/alphaDrop.ts calls handleNewPairForChain directly), overlapping HTTP-poll cycles and
// duplicate listeners. This test uses the listener plus a direct handleNewPairForChain call, the
// alpha-drop shape.
//
// Proof on the real path, the order forced exactly (AC-12: a hold, mined blocks and steps of fake
// time, never a sleep). A real ETH V2 launch reaches the real listener; its handler passes the
// check and every gate and starts its buy inside the wallet lock, where its Flashbots simulation
// (eth_callBundle on the relay) is HELD. The hold is on the relay, not on a read: a held read of the
// bot's HTTP provider would stall every later call of that provider (AUD-TX-028), including the
// second handler's own gates, and decide this test by that finding. While the first buy is parked
// and its row is not yet written, the same PairCreated is handed to the real handleNewPairForChain
// directly. Once the second handler has passed the check ("New pair detected" logged twice), the
// simulation is released and the chain lands each bundle at a block it targets.
//
// What is measured: how many buys of the token landed. Correct: one (card BUY-03: claim the token
// synchronously before the first await and re-check inside the lock). Today: two. A fix-shaped
// src mutation (an in-process claim set checked and set before the first await) reads "looks
// fixed" (D-08), src restored byte for byte. After the marker: the two submitted transactions,
// decoded with real ethers (the same swapExactETHForTokens of the same token at consecutive
// nonces), and the token's two trades rows.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Transaction, getAddress } from 'ethers';
import type { Submitted } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepUntilTrue, type Scenario } from '../harness/world';
import { driveChain } from './fixtures/AUD-API-001-dashboard-sell';
import { listen } from './fixtures/AUD-EXIT-002-position';
import { settleAntiRugArming } from './fixtures/AUD-TX-002-lock';

const V2_ROUTER = new Interface(['function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)']);

function msgCount(msg: string, token?: string): number {
    return recordedLogs().filter((l) => l.msg === msg && (token === undefined || String(l.obj?.token ?? '').toLowerCase() === token.toLowerCase())).length;
}

/** The wallet's buys of `token` through `router`, decoded with real ethers. */
function buysOf(sc: Scenario, router: string, token: string): Array<{ sub: Submitted; nonce: number; path: string[]; to: string; value: bigint }> {
    const out: Array<{ sub: Submitted; nonce: number; path: string[]; to: string; value: bigint }> = [];
    for (const s of sc.node.submitted) {
        const tx = Transaction.from(s.raw);
        if ((tx.from ?? '').toLowerCase() !== sc.wallet.address.toLowerCase() || !tx.to || getAddress(tx.to) !== getAddress(router)) continue;
        const call = V2_ROUTER.parseTransaction({ data: tx.data, value: tx.value });
        if (!call || call.name !== 'swapExactETHForTokens') continue;
        const path = (call.args[1] as string[]).map((a) => getAddress(a));
        if (path[path.length - 1] !== getAddress(token)) continue;
        out.push({ sub: s, nonce: tx.nonce, path, to: getAddress(call.args[2] as string), value: tx.value });
    }
    return out;
}

function tokenRows(sc: Scenario, token: string): Array<{ status: string; tx_hash: string; action: string }> {
    return sc.graph.db.prepare("SELECT status, tx_hash, action FROM trades WHERE token = ? AND chain = 'eth' ORDER BY id").all(token.toLowerCase()) as never;
}

describe('AUD-BUY-004: the already-sniped check is read once, long before the row is written, so two handlers for one token both buy', () => {
    it('double-buy-same-token: a second handler for the same PairCreated passes the check while the first buy is inside the lock, and both buys land', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node, token, dex } = sc;
        const sim = node.hold('eth_callBundle');
        await listen(sc);
        const launch = await sc.fireNewPair();

        // The first handler (the listener's) is parked inside the wallet lock at its simulation.
        await stepUntilTrue(() => sim.parkedNow === 1, { what: "the first buy's Flashbots simulation being held", maxSteps: 20_000 });
        expect(msgCount('New pair detected')).toBe(1);
        expect(tokenRows(sc, token)).toEqual([]);

        // The same PairCreated, handed to the real handler directly (the alpha-drop shape).
        const [token0, token1] = [launch.log.topics[1], launch.log.topics[2]].map((t) => getAddress('0x' + t.slice(26)));
        const second = sc.graph.bot.handleNewPairForChain(sc.ctx, dex, token0, token1, sc.pair);
        let secondSettled = false;
        second.then(
            () => (secondSettled = true),
            () => (secondSettled = true),
        );
        await stepUntilTrue(() => msgCount('New pair detected') === 2 || secondSettled, { what: 'the second handler passing (or refusing at) the already-sniped check', maxSteps: 20_000 });
        const passedCheck = msgCount('New pair detected');
        const rowsWhenSecondChecked = tokenRows(sc, token).length;

        // Release the simulation; each bundle lands at a block it targets.
        sim.release();
        const done = (): boolean => secondSettled && msgCount('MEV bundle submitted') + recordedLogs().filter((l) => l.obj?.op === 'buy.snipe.fail-clean').length >= passedCheck;
        await driveChain(sc, { mode: 'land', until: done, what: 'both handlers finishing their buys' });
        await settleAntiRugArming(sc, passedCheck);
        const landed = buysOf(sc, dex.routerAddress, token).filter((b) => node.statusOf(b.sub.hash) === 'mined');

        knownBug(ctx, 'AUD-BUY-004', {
            claim: 'double-buy-same-token',
            correct: { buysLanded: 1 },
            observed: { buysLanded: 2 },
            actual: { buysLanded: landed.length },
            expectedPlain: 'Two signals for the same new token buy it once: the second handler sees the first one\'s claim and skips.',
            actualPlain: 'A second handler for the same new pair passed the already-sniped check while the first buy was still inside the wallet lock, waited for the lock, then bought the same token again: two buys landed, twice the snipe amount spent.',
        });

        // The forced order: the second handler checked while the first had written no row.
        expect(passedCheck).toBe(2);
        expect(rowsWhenSecondChecked).toBe(0);
        expect(sim.heldCount).toBe(1);
        // The two transactions, decoded with real ethers: the same swap of the same token, consecutive nonces.
        const buys = buysOf(sc, dex.routerAddress, token);
        expect(buys).toHaveLength(2);
        expect(buys.map((b) => b.sub.route)).toEqual(['bundle', 'bundle']);
        expect(buys[1].nonce).toBe(buys[0].nonce + 1);
        for (const b of buys) {
            expect(b.path).toEqual([getAddress(sc.weth), getAddress(token)]);
            expect(b.to).toBe(getAddress(sc.wallet.address));
            expect(b.value).toBe(buys[0].value);
        }
        // Two trades rows for the one token, each with its own landed hash.
        const rows = tokenRows(sc, token);
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => [r.action, r.status])).toEqual([
            ['buy', 'pending'],
            ['buy', 'pending'],
        ]);
        expect(rows.map((r) => r.tx_hash)).toEqual(buys.map((b) => b.sub.hash));
        await expect(second).resolves.toBeUndefined();
    });
});
