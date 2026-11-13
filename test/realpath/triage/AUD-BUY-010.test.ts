// test/realpath/triage/AUD-BUY-010.test.ts
// Phase 23 plan 23-09 Task 3 (AUDIT-02, AC-12): AUD-BUY-010, the risk-limit race across tokens.
// src/bot.ts handleNewPairForChain calls src/riskManager.ts canSnipe near its start; canSnipe reads
// the open-position count and the exposure from the trades table (rows exist only after
// insertTrade) and the cooldown from an in-memory map (updated only by recordSnipe), and both of
// those writes happen only after submitBuyTx returned. Nothing is reserved when a handler passes,
// so concurrent handlers for DIFFERENT tokens all pass and the bot overshoots MAX_OPEN_POSITIONS,
// MAX_TOTAL_EXPOSURE and the cooldown. (The same-token race is AUD-BUY-004.)
//
// Proof on the real path, the order forced exactly (AC-12: a hold, mined blocks and steps of fake
// time, never a sleep), with MAX_OPEN_POSITIONS=1 and no open position, so the limit allows
// exactly one more:
//   - Token A launches on uniswap-v2 (the scenario's own pair); the real listener's handler passes
//     canSnipe and every gate and starts its buy inside the wallet lock, where its Flashbots
//     simulation (eth_callBundle on the relay) is HELD. Held on the relay, not on a read: a held
//     read of the bot's HTTP provider would stall every later call of that provider (AUD-TX-028),
//     including token B's handler before it ever reached canSnipe, and decide the test by that.
//   - Token B launches on sushiswap-v2 on the same chain and wallet
//     (fixtures/AUD-TX-003-second-launch.ts); the bot's real sushiswap listener handles it while A's
//     buy is parked and A's row is not written. Once B's handler has passed canSnipe and its gates
//     ("All safety checks passed, buying" for B), the simulation is released and the chain lands
//     each bundle at a block it targets.
//
// The per-chain snipe cooldown is switched off (SNIPE_COOLDOWN_MS=0), so the open-position limit is
// the only gate that can refuse B (review CR-06): with the default 30 s cooldown on, a fix that
// stamps only the cooldown when a handler passes canSnipe (no position reservation) refused B by
// cooldown and read "looks fixed", while MAX_OPEN_POSITIONS was still overshot whenever two chains
// snipe at once or the cooldown is 0. B's wait is bounded rather than required to end while A is
// parked, so a fix that serializes the buy pipeline per chain (the recommendation's other shape: B
// reaches canSnipe only after A's buy is recorded) is measured too instead of stalling the test.
//
// What is measured: how many buys landed, and which risk rule refused B. Correct: one buy, B
// refused by the open-position limit (reason max_positions) (card BUY-03: reserve the risk budget
// synchronously when a handler passes canSnipe). Today: both land, B is refused by nothing. An
// in-process reservation counted by canSnipe and taken when it passes reads "looks fixed" (D-08);
// a cooldown stamped when canSnipe passes, with no position reservation, refuses nothing with the
// cooldown off, so both buys land and the bug stays recorded (in-memory mutants, review CR-06).
// After the marker: the two submitted transactions
// decoded with real ethers (A on the uniswap router, B on the sushiswap router, consecutive
// nonces), and two open trades rows against a limit of one.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Transaction, getAddress } from 'ethers';
import type { Submitted } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepUntilTrue, type Scenario } from '../harness/world';
import { driveChain, stepUntilOrFor } from './fixtures/AUD-API-001-dashboard-sell';
import { listen, subscribedTo } from './fixtures/AUD-EXIT-002-position';
import { settleAntiRugArming } from './fixtures/AUD-TX-002-lock';
import { secondLaunch } from './fixtures/AUD-TX-003-second-launch';

const V2_ROUTER = new Interface(['function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)']);

function tokenMsgCount(msg: string, token: string): number {
    return recordedLogs().filter((l) => l.msg === msg && String(l.obj?.token ?? '').toLowerCase() === token.toLowerCase()).length;
}

/** Every buy the wallet submitted, decoded with real ethers. */
function walletBuys(sc: Scenario): Array<{ sub: Submitted; nonce: number; router: string; token: string; to: string; value: bigint }> {
    const out: Array<{ sub: Submitted; nonce: number; router: string; token: string; to: string; value: bigint }> = [];
    for (const s of sc.node.submitted) {
        const tx = Transaction.from(s.raw);
        if ((tx.from ?? '').toLowerCase() !== sc.wallet.address.toLowerCase() || !tx.to) continue;
        let call;
        try {
            call = V2_ROUTER.parseTransaction({ data: tx.data, value: tx.value });
        } catch {
            continue;
        }
        if (!call || call.name !== 'swapExactETHForTokens') continue;
        const path = (call.args[1] as string[]).map((a) => getAddress(a));
        out.push({ sub: s, nonce: tx.nonce, router: getAddress(tx.to), token: path[path.length - 1], to: getAddress(call.args[2] as string), value: tx.value });
    }
    return out;
}

describe('AUD-BUY-010: risk limits are checked long before the snipe is recorded, so concurrent handlers for different tokens all pass', () => {
    it('max-open-positions-overspent: with room for exactly one more position, handlers for two different tokens both pass canSnipe and both buys land', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { MAX_OPEN_POSITIONS: '1', SNIPE_COOLDOWN_MS: '0' } });
        const { node, dex } = sc;
        const b = secondLaunch(sc);
        const openPositions = (): number => (sc.graph.db.prepare("SELECT COUNT(*) AS n FROM trades WHERE status = 'pending' AND action = 'buy'").get() as { n: number }).n;
        expect(openPositions()).toBe(0);
        const sim = node.hold('eth_callBundle');
        await listen(sc);
        await sc.graph.bot.startDexListener(sc.ctx, b.dex, sc.registry);
        await stepUntilTrue(() => subscribedTo(sc, b.dex.factoryAddress), { what: 'the sushiswap listener subscribing to PairCreated' });

        // Token A: its handler passes canSnipe and is parked inside the wallet lock at its simulation.
        await sc.fireNewPair();
        await stepUntilTrue(() => sim.parkedNow === 1, { what: "token A's Flashbots simulation being held", maxSteps: 20_000 });
        expect(tokenMsgCount('All safety checks passed, buying', sc.token)).toBe(1);

        // Token B, while A's buy is parked and A's row is not written.
        const rowsBeforeB = openPositions();
        await b.fire();
        // B's handler decides at the risk gate while A is parked (today), or waits for A's buy (a
        // per-chain serialized pipeline): a bounded wait of virtual time, then A is released either way.
        const bPassed = (): boolean => tokenMsgCount('All safety checks passed, buying', b.token) === 1;
        const bRefused = (): boolean => tokenMsgCount('Risk check failed, skipping snipe', b.token) === 1;
        // 20 s: well inside A's 60 s swap deadline, so a serialized A still lands once released.
        await stepUntilOrFor(() => bPassed() || bRefused(), 20_000);
        const bPassedWhileParked = bPassed();
        expect(sim.parkedNow).toBe(1);

        // Release the simulation; each bundle lands at a block it targets. Settled: B decided, and
        // every handler that passed its checks has submitted its bundle or failed clean.
        sim.release();
        const handlersBuying = (): number => 1 + (bPassed() ? 1 : 0);
        const finished = (): number => recordedLogs().filter((l) => l.msg === 'MEV bundle submitted' || l.obj?.op === 'buy.snipe.fail-clean').length;
        await driveChain(sc, { mode: 'land', until: () => (bPassed() || bRefused()) && finished() >= handlersBuying(), what: "token B's decision and the buys finishing" });
        await stepUntilTrue(() => recordedLogs().filter((l) => l.obj?.op === 'exit.monitor.started').length >= handlersBuying(), { what: 'each bought position being armed', maxSteps: 20_000 });
        await settleAntiRugArming(sc, handlersBuying());
        const landed = walletBuys(sc).filter((x) => node.statusOf(x.sub.hash) === 'mined');
        // Which risk rule refused B, read from the bot's own refusal line (null: nothing refused it).
        const bRefusal = recordedLogs().find((l) => l.msg === 'Risk check failed, skipping snipe' && String(l.obj?.token ?? '').toLowerCase() === b.token.toLowerCase());
        const bRefusedBy = bRefusal === undefined ? null : String(bRefusal.obj?.reason);

        knownBug(ctx, 'AUD-BUY-010', {
            claim: 'max-open-positions-overspent',
            correct: { buysLanded: 1, bRefusedBy: 'max_positions' },
            observed: { buysLanded: 2, bRefusedBy: null },
            actual: { buysLanded: landed.length, bRefusedBy },
            expectedPlain: 'With room for one more position, two new tokens arriving together get one buy; the second is refused by the open-position limit.',
            actualPlain: 'With MAX_OPEN_POSITIONS at 1, no open position and the snipe cooldown off, the handlers for two different new tokens both passed the risk check before either buy was recorded, nothing refused the second, and both buys landed: two open positions against a limit of one.',
        });

        // The forced order: B passed the risk gate while A's buy was parked and unrecorded.
        expect(bPassedWhileParked).toBe(true);
        expect(rowsBeforeB).toBe(0);
        expect(sim.heldCount).toBe(1);
        expect(tokenMsgCount('Risk check failed, skipping snipe', b.token)).toBe(0);
        // The two transactions, decoded with real ethers: A through the uniswap router, B through the
        // sushiswap router, consecutive nonces of the one wallet.
        const buys = walletBuys(sc);
        expect(buys).toHaveLength(2);
        expect(buys.map((x) => [x.router, x.token])).toEqual([
            [getAddress(dex.routerAddress), getAddress(sc.token)],
            [getAddress(b.dex.routerAddress), getAddress(b.token)],
        ]);
        expect(buys[1].nonce).toBe(buys[0].nonce + 1);
        expect(buys.every((x) => x.to === getAddress(sc.wallet.address) && x.sub.route === 'bundle')).toBe(true);
        // Two open trades rows against the limit of one.
        const rows = sc.graph.db.prepare("SELECT token, status, tx_hash FROM trades WHERE action = 'buy' ORDER BY id").all() as Array<{ token: string; status: string; tx_hash: string }>;
        expect(rows).toEqual([
            { token: sc.token.toLowerCase(), status: 'pending', tx_hash: buys[0].sub.hash },
            { token: b.token.toLowerCase(), status: 'pending', tx_hash: buys[1].sub.hash },
        ]);
        expect(openPositions()).toBe(2);
        expect(Number(process.env.MAX_OPEN_POSITIONS)).toBe(1);
    });
});
