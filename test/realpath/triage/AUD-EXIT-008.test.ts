// test/realpath/triage/AUD-EXIT-008.test.ts
// Phase 23 plan 23-08 Task 1 (AUDIT-02): AUD-EXIT-008, the dashboard's force-sell is sent as a
// routine exit, so once a position's routine retries are paused the operator cannot sell it from
// the dashboard, although the pause alert tells the operator to act manually.
//
// The sites. src/api/routes/controls.ts force-sell calls executeFullSell with reason
// 'urgency-market-sell' (emergency-sell does the same). src/exitEngine.ts executeFullSell returns
// false before the sell lock for any non-anti-rug reason while isRoutinePaused(chain, token) is
// true (op exit.routine.paused-skip). keepMonitoringFailedHeld sets that pause once the stored
// exit_failure_count reaches EXIT_ROUTINE_MAX_FAILURES (op exit.failed.held.routine-paused, alert
// "...resume manually"). The route reports any false as HTTP 409 "Sell already in progress for this
// position". Nothing in the code lifts the pause except a genuine close.
//
// Proof on the real path, on a row that stays 'pending' so force-sell's query finds it (review
// concern Codex 23-08 HIGH: the catch path sets trades.status 'failed' and the route then answers
// 404 before the pause gate, which is AUD-API-001's own proof). EXIT_ROUTINE_MAX_FAILURES=1 through
// the createScenario overrides. A real ETH V2 snipe, bought and armed. Another wallet dumps 30
// percent of the pool's tokens (a real router swap with the pair's own events), and the real poll
// loop fires the stop-loss. The bot approves (mined) and sends its private sell; in the block that
// includes the sell, another holder of the token also transfers some tokens to the bot's wallet (a
// real signed ERC-20 transfer, as an airdrop or a dusting transfer would). So the sell reports
// success but balanceOf after it stays above dust, and executeFullSell runs keepMonitoringFailedHeld
// on its success path, which leaves trades.status 'pending'. With the ceiling at 1 the routine
// retries pause. Preconditions asserted before the request: trades.status 'pending', the real
// exported isRoutinePaused is true, exit.failed.held.routine-paused is logged for the trade.
//
// Then the operator presses force-sell on the real dashboard (real login, real route behind the
// real auth middleware, over node:http). Correct: the operator's sell runs (a new sell of the
// position is submitted). Today: HTTP 409 "Sell already in progress for this position", the
// exit.routine.paused-skip op for the operator's reason, and no new sell. Those three are asserted
// after the marker. A fix that lets operator sells bypass the routine pause (the recommendation,
// card EXIT-07) reads "looks fixed" (D-08): the sell runs and the drive lands it.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue } from '../harness/world';
import { dashboardOverrides, exitStatusOf, heldPosition, incomingHolder, openDashboard, postDriven, sellsSince } from './fixtures/AUD-API-001-dashboard-sell';
import { buyRow, opEntries } from './fixtures/AUD-EXIT-002-position';
import { foreignTrade } from './fixtures/AUD-EXIT-001-sell-path';

describe('AUD-EXIT-008: dashboard sells are refused once routine retries are paused', () => {
    it('operator-sell-refused-while-routine-paused: after the routine retries of a still-held position pause, the dashboard force-sell answers 409 and sends no sell', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { ...(await dashboardOverrides()), EXIT_ROUTINE_MAX_FAILURES: '1' } });
        const { node } = sc;
        const pos = await heldPosition(sc);
        const holder = incomingHolder(sc, { bought: pos.bought, holding: pos.bought });
        const received = pos.bought / 10n;

        // The routine stop-loss exit, landed together with the incoming transfer.
        const fromSubmit = node.submitted.length;
        await foreignTrade(sc, { sellTokens: (sc.reserves.token * 3n) / 10n });
        const sellOf = (): (typeof node.submitted)[number] | undefined => sellsSince(sc, fromSubmit)[0];
        await stepUntilTrue(
            () => {
                const approves = node.submitted.slice(fromSubmit).filter((s) => s.route === 'public' && s.status === 'accepted').map((s) => s.hash);
                if (approves.length > 0) node.mine({ include: approves });
                return sellOf() !== undefined;
            },
            { what: 'the bot sending its stop-loss sell', maxSteps: 20_000 },
        );
        const sell = sellOf()!;
        expect(sell.route).toBe('bundle');
        const transfer = await holder.send(received);
        await stepFor(12_000);
        node.mine({ include: [sell.hash, transfer.hash], logs: [transfer.log] });
        await stepUntilTrue(() => opEntries('exit.failed.held.routine-paused').length > 0, { what: 'the routine retries pausing', maxSteps: 20_000 });

        // Preconditions, asserted before the request: the row is still 'pending' and the pause is on.
        expect(opEntries('exit.trigger.stop-loss').length).toBeGreaterThanOrEqual(1);
        expect(node.statusOf(sell.hash)).toBe('mined');
        expect(buyRow(sc)?.status).toBe('pending');
        expect(sc.graph.exitEngine.isRoutinePaused('eth', sc.token)).toBe(true);
        expect(opEntries('exit.failed.held.routine-paused').map((o) => [o.tradeId, o.reason, o.failureCount])).toEqual([[pos.tradeId, 'stop-loss', 1]]);
        expect(exitStatusOf(sc, pos.tradeId)).toEqual({ exit_status: 'exit_failed_held', exit_failure_count: 1 });
        expect(recordedAlerts().some((a) => String(a.message).includes('[EXIT ROUTINE PAUSED]') && String(a.message).includes('resume manually'))).toBe(true);

        // The operator presses force-sell.
        const { dash, cookie } = await openDashboard(sc);
        const fromRequest = node.submitted.length;
        const fromLog = recordedLogs().length;
        const reply = await postDriven(sc, dash, `/api/controls/force-sell/${pos.tradeId}`, cookie, 'land');
        const newSells = sellsSince(sc, fromRequest);

        knownBug(ctx, 'AUD-EXIT-008', {
            claim: 'operator-sell-refused-while-routine-paused',
            correct: { operatorSellRuns: true },
            observed: { operatorSellRuns: false },
            actual: { operatorSellRuns: newSells.length > 0 },
            expectedPlain: 'After the bot pauses its routine exit retries and tells the operator to act manually, the dashboard force-sell still sells the position.',
            actualPlain: 'With routine retries paused on a still-held position, the dashboard force-sell answered 409 "Sell already in progress for this position" and sent no sell.',
        });
        // The three parts of today's refusal.
        expect(reply).toEqual({ status: 409, body: { error: 'Sell already in progress for this position' } });
        const operatorSkips = opEntries('exit.routine.paused-skip', fromLog).filter((o) => o.reason === 'urgency-market-sell');
        expect(operatorSkips.map((o) => o.tradeId)).toEqual([pos.tradeId]);
        expect(node.submitted.slice(fromRequest)).toEqual([]);
        // Nothing else holds the sell: the refusal is the pause, not a lock.
        expect(recordedLogs().slice(fromLog).some((l) => l.msg === 'Another exit already handling token, skipping')).toBe(false);
        expect(sc.graph.exitEngine.isRoutinePaused('eth', sc.token)).toBe(true);
    });
});
