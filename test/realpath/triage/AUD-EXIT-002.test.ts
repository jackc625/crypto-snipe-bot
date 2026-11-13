// test/realpath/triage/AUD-EXIT-002.test.ts
// Phase 23 plan 23-07 Task 1 (AUDIT-02, RC-07): AUD-EXIT-002, the exit monitor silently never
// starts when its first price quote fails, so a held position has no stop-loss, trailing stop,
// partial take-profit or 30-minute exit until a restart.
//
// The site (src/exitEngine.ts startExitMonitor): entryPrice = await queryPrice(...); queryPrice
// returns null on any error; on null the function logs "Cannot query initial price, exit monitor
// not started" and returns. No interval, no exit_state row, no retry, no alert. Its caller
// (src/bot.ts armPositionMonitoring) cannot tell, and goes on to the anti-rug registration.
//
// Proof on the real path: a real ETH V2 snipe (the AC-01 path: a real PairCreated through the real
// listener, detection, safety and a real Flashbots bundle signed by real ethers, mined by the
// simulated node, recorded in the real migrated database). getAmountsOut reads on the router fail
// with a real node answer. The fault names the method's selector and the router, and is armed only
// once the buy is mined (review concern 23-07 MEDIUM: the snipe's own getAmountsOut runs before
// submission, src/bot.ts handleNewPairForChain). Then six exit-poll intervals of fake time pass.
// Two claims, by how long the node keeps failing (review CR-07):
//   - first-quote-failure-leaves-position-unmonitored: every matching read fails for the whole
//     observation (a node that stays behind). A fix that retries the first quote once (or a few
//     times) still finds no price, so only a fix that changes the failure path (keep the interval
//     armed, or tell the operator) reads "looks fixed".
//   - first-quote-transient-failure-leaves-position-unmonitored: ONE read fails (a node that
//     catches up at once). Here a retry of the first quote is itself a correct fix, and reads
//     "looks fixed".
//
// What is measured: whether the held position ends up protected or the operator is told it is
// not. Correct is either: a monitor exists (an exit-monitor timer in the bot's real registry, or
// an exit_state row), or an alert says the position is unprotected. Both fix shapes read "looks
// fixed" (D-08). The details of today's failure (no timer, no row, no such alert, the error line,
// anti-rug armed) are asserted after the marker.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { getAddress, parseEther } from 'ethers';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor } from '../harness/world';
import { GET_AMOUNTS_OUT, buyAndMine, buyRow, exitQuotes, exitStateRow, listen, msgLogged, opLogged, waitAntiRugArmed } from './fixtures/AUD-EXIT-002-position';

/** An alert telling the operator a position has no exit monitoring (any wording a fix might use). */
const UNPROTECTED = /unprotected|unmonitored|not monitored|no exit monitor|monitor (not started|failed)|exit monitor.*(fail|not)/i;

type Ctx = Parameters<typeof knownBug>[0];

/**
 * The shared proof of both claims. `persistent`: every matching getAmountsOut fails until the six
 * poll intervals have passed; otherwise exactly one fails.
 */
async function firstQuoteFailure(ctx: Ctx, persistent: boolean): Promise<void> {
    const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
    const { node, token } = sc;
    const pollMs = sc.graph.exitEngine.exitConfig.pollIntervalMs;
    expect(pollMs).toBe(5_000);
    await listen(sc);

    let monitorQuote: ReturnType<typeof node.failNext> | undefined;
    let faultWindow = true;
    const { buy } = await buyAndMine(sc, {
        beforeMine: (b) => {
            expect(b.route).toBe('bundle');
            // The getAmountsOut reads on the router after the buy is mined, starting with the exit
            // monitor's entry quote: geth's answer from a node that has not caught up yet. One read
            // (transient) or every read until the observation ends (persistent).
            monitorQuote = node.failNext('eth_call', {
                selector: GET_AMOUNTS_OUT,
                to: sc.dex.routerAddress,
                after: () => faultWindow && node.isMined(b.hash),
                times: persistent ? 1_000 : 1,
                error: { code: -32000, message: 'header not found' },
            });
        },
    });
    expect(node.isMined(buy.hash)).toBe(true);
    const fromCall = node.callLog.findIndex((c) => c.method === 'eth_getTransactionReceipt');
    await waitAntiRugArmed(sc);
    // Six exit-poll intervals: nothing retries, re-arms or alerts in that time.
    const fromAlert = recordedAlerts().length;
    const quotesBeforeObservation = exitQuotes(sc).length;
    await stepFor(6 * pollMs, 50);
    faultWindow = false;

    // Setup facts, true under the bug and under either fix: the fault fired, the buy is
    // recorded as an open position, and the tokens are held.
    expect(monitorQuote!.fired).toBeGreaterThanOrEqual(1);
    const row = buyRow(sc);
    expect(row?.status).toBe('pending');
    const heldStateRow = row ? exitStateRow(sc, row.id) : undefined;
    const timer = sc.graph.exitManager.hasExitMonitorTimer('eth', token);
    const unprotectedAlert = recordedAlerts().some((a) => UNPROTECTED.test(String(a.message)));

    const protectedOrOperatorTold = timer || heldStateRow !== undefined || unprotectedAlert;
    if (persistent) {
        knownBug(ctx, 'AUD-EXIT-002', {
            claim: 'first-quote-failure-leaves-position-unmonitored',
            correct: { protectedOrOperatorTold: true },
            observed: { protectedOrOperatorTold: false },
            actual: { protectedOrOperatorTold },
            expectedPlain: 'When the price quotes after a buy keep failing, the bot still arms the exit monitor (so it baselines on the first good quote) or tells the operator the position is unprotected.',
            actualPlain: 'With the price quote failing right after the buy, the held position got no exit monitor, no saved exit state and no alert, and nothing re-armed it over six poll intervals.',
        });
    } else {
        knownBug(ctx, 'AUD-EXIT-002', {
            claim: 'first-quote-transient-failure-leaves-position-unmonitored',
            correct: { protectedOrOperatorTold: true },
            observed: { protectedOrOperatorTold: false },
            actual: { protectedOrOperatorTold },
            expectedPlain: 'When the first price quote after a buy fails once, the bot retries it and arms the exit monitor, or tells the operator the position is unprotected.',
            actualPlain: 'One failed price quote right after the buy left the held position with no exit monitor, no saved exit state and no alert, and nothing re-armed it over six poll intervals.',
        });
    }

    // How it fails today. The failed call was the monitor's entry quote: the snipe amount as the
    // probe, token -> WETH, on the router, the first such quote after the buy.
    const firstExitQuote = exitQuotes(sc, Math.max(0, fromCall))[0];
    expect(firstExitQuote).toEqual(expect.objectContaining({ to: getAddress(sc.dex.routerAddress), amountIn: parseEther(sc.ctx.chain.snipeAmount), tokenOut: getAddress(sc.weth) }));
    expect(msgLogged('Cannot query initial price, exit monitor not started')).toBe(true);
    expect(opLogged('exit.monitor.started')).toBe(false);
    expect(timer).toBe(false);
    expect(heldStateRow).toBeUndefined();
    expect(unprotectedAlert).toBe(false);
    // No exit quote at all during the six poll intervals: no poll loop exists.
    expect(exitQuotes(sc).length).toBe(quotesBeforeObservation);
    expect(recordedAlerts().slice(fromAlert)).toEqual([]);
    // The caller went on as if the monitor was armed: anti-rug registered the position.
    expect(sc.graph.detector.getRegisteredPositions('eth').some((p) => p.tradeId === row!.id)).toBe(true);
    // The only error lines: this one, and the false first-start gap of a fresh database
    // (AUD-ANTIRUG-024, registered by plan 23-01).
    expect(recordedLogs().filter((l) => l.level === 'error').map((l) => l.msg)).toEqual([
        'Cannot query initial price, exit monitor not started',
        '[GAP DETECTED] backfill skipped — gap exceeds maxBackfillBlocks',
    ]);
}

describe('AUD-EXIT-002: a failed first quote leaves a held position with no exit monitor (RC-07)', () => {
    it('first-quote-failure-leaves-position-unmonitored: with getAmountsOut failing from monitor start, the held position gets no timer, no exit_state row and no alert, and nothing recovers over six poll intervals', async (ctx) => {
        await firstQuoteFailure(ctx, true);
    });

    it('first-quote-transient-failure-leaves-position-unmonitored: one failed getAmountsOut at monitor start leaves no timer, no exit_state row and no alert, and nothing recovers over six poll intervals', async (ctx) => {
        await firstQuoteFailure(ctx, false);
    });
});
