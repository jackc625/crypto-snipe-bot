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
// simulated node, recorded in the real migrated database). ONE getAmountsOut read on the router
// fails with a real node answer. The fault names the method's selector and the router, and is
// armed only once the buy is mined (review concern 23-07 MEDIUM: the snipe's own getAmountsOut
// runs before submission, src/bot.ts handleNewPairForChain). Then six exit-poll intervals of fake
// time pass.
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

describe('AUD-EXIT-002: a failed first quote leaves a held position with no exit monitor (RC-07)', () => {
    it('first-quote-failure-leaves-position-unmonitored: one failed getAmountsOut at monitor start leaves no timer, no exit_state row and no alert, and nothing recovers over six poll intervals', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node, token } = sc;
        const pollMs = sc.graph.exitEngine.exitConfig.pollIntervalMs;
        expect(pollMs).toBe(5_000);
        await listen(sc);

        let monitorQuote: ReturnType<typeof node.failNext> | undefined;
        const { buy } = await buyAndMine(sc, {
            beforeMine: (b) => {
                expect(b.route).toBe('bundle');
                // The first getAmountsOut on the router after the buy is mined: the exit monitor's
                // entry quote. geth's answer from a node that has not caught up yet.
                monitorQuote = node.failNext('eth_call', {
                    selector: GET_AMOUNTS_OUT,
                    to: sc.dex.routerAddress,
                    after: () => node.isMined(b.hash),
                    error: { code: -32000, message: 'header not found' },
                });
            },
        });
        expect(node.isMined(buy.hash)).toBe(true);
        const fromCall = node.callLog.findIndex((c) => c.method === 'eth_getTransactionReceipt');
        await waitAntiRugArmed(sc);
        // Six exit-poll intervals: nothing retries, re-arms or alerts in that time.
        const fromAlert = recordedAlerts().length;
        await stepFor(6 * pollMs, 50);

        // Setup facts, true under the bug and under either fix: the fault fired once, the buy is
        // recorded as an open position, and the tokens are held.
        expect(monitorQuote!.fired).toBe(1);
        const row = buyRow(sc);
        expect(row?.status).toBe('pending');
        const heldStateRow = row ? exitStateRow(sc, row.id) : undefined;
        const timer = sc.graph.exitManager.hasExitMonitorTimer('eth', token);
        const unprotectedAlert = recordedAlerts().some((a) => UNPROTECTED.test(String(a.message)));

        knownBug(ctx, 'AUD-EXIT-002', {
            claim: 'first-quote-failure-leaves-position-unmonitored',
            correct: { protectedOrOperatorTold: true },
            observed: { protectedOrOperatorTold: false },
            actual: { protectedOrOperatorTold: timer || heldStateRow !== undefined || unprotectedAlert },
            expectedPlain: 'When the first price quote after a buy fails, the bot still arms the exit monitor (retrying the quote) or tells the operator the position is unprotected.',
            actualPlain: 'One failed price quote right after the buy left the held position with no exit monitor, no saved exit state and no alert, and nothing re-armed it over six poll intervals.',
        });

        // How it fails today. The failed call was the monitor's entry quote: the snipe amount as the
        // probe, token -> WETH, on the router, the first such quote after the buy.
        const firstExitQuote = exitQuotes(sc, Math.max(0, fromCall))[0];
        expect(firstExitQuote).toEqual(expect.objectContaining({ to: getAddress(sc.dex.routerAddress), amountIn: parseEther(sc.ctx.chain.snipeAmount), tokenOut: getAddress(sc.weth) }));
        expect(msgLogged('Cannot query initial price, exit monitor not started')).toBe(true);
        expect(opLogged('exit.monitor.started')).toBe(false);
        expect(timer).toBe(false);
        expect(heldStateRow).toBeUndefined();
        expect(unprotectedAlert).toBe(false);
        // No exit quote at all after the failed one: no poll loop exists.
        expect(exitQuotes(sc).filter((q) => q.seq > firstExitQuote.seq)).toEqual([]);
        expect(recordedAlerts().slice(fromAlert)).toEqual([]);
        // The caller went on as if the monitor was armed: anti-rug registered the position.
        expect(sc.graph.detector.getRegisteredPositions('eth').some((p) => p.tradeId === row!.id)).toBe(true);
        // The only error lines: this one, and the false first-start gap of a fresh database
        // (AUD-ANTIRUG-024, registered by plan 23-01).
        expect(recordedLogs().filter((l) => l.level === 'error').map((l) => l.msg)).toEqual([
            'Cannot query initial price, exit monitor not started',
            '[GAP DETECTED] backfill skipped — gap exceeds maxBackfillBlocks',
        ]);
    });
});
