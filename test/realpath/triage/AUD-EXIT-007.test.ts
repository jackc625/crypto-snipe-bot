// test/realpath/triage/AUD-EXIT-007.test.ts
// Phase 23 plan 23-08 Task 1 (AUDIT-02): AUD-EXIT-007, exits that end with nowhere to go return
// false without marking the position failed-held or re-arming its poll timer, after the anti-rug
// and dashboard callers already cleared that timer.
//
// The sites (src/exitEngine.ts executeFullSell). A V3 position whose private escalation did not
// land logs exit.fallback.unsupported-dex, alerts "Position stays held + monitored", and returns
// false. A dex that is neither V3-with-a-fee-tier nor V2 logs "Unknown DEX type for sell" and
// returns false. Neither runs keepMonitoringFailedHeld, the path that persists exit_failed_held and
// re-arms the poll timer. Their callers clear the token's timers first: src/api/routes/controls.ts
// force-sell (clearAllTimersForToken before executeFullSell; emergency-sell the same) and
// src/anti-rug/exitTrigger.ts. So the position stays held with no routine poll at all.
//
// Proof on the real path, through the dashboard caller. A real ETH Uniswap V3 snipe (the AC-01
// path), bought and armed by the running bot. The real dashboard API (startApiServer, the real
// login, the real routes behind the real auth middleware) on a loopback port, over node:http.
//   - v3-private-not-landed-leaves-no-poll: the operator presses force-sell. The bot approves
//     (mined) and sends two private Flashbots attempts whose slots pass without them (empty
//     blocks); it reconciles, finds the tokens still held, and takes the V3 no-fallback return.
//   - unknown-dex-leaves-no-poll: the stored buy row's fee_tier is set to NULL before the press,
//     so force-sell hands executeFullSell the chain's V3 dex with no fee tier and it takes the
//     unknown-dex return. No code in src/ or scripts/ writes a V3 trade row without a fee tier
//     today (bot.ts writes V2 rows with NULL and V3 rows with the pool's fee; migration v2 added
//     pool_type and fee_tier together), so this proves what the branch does when reached, not how
//     a live position reaches it.
// Each case asserts its own return path was taken before the marker.
//
// The no-fallback return does not depend on who called executeFullSell, and three callers clear the
// timers first, so the V3 not-landed return is proven once per caller (review CR-05):
//   - v3-private-not-landed-leaves-no-poll: the dashboard force-sell (above).
//   - emergency-sell-v3-not-landed-leaves-no-poll: the operator presses the dashboard's
//     emergency-sell (POST /api/controls/emergency-sell, every open position); the same private
//     attempts miss and the same V3 return is taken for the one position.
//   - antirug-v3-not-landed-leaves-no-poll: a real V3 rug on a live anti-rug position. The deployer
//     pulls 95 percent of the pool's liquidity through the real position manager
//     (fixtures/AUD-EXIT-014-rug.ts pullV3Liquidity: the pool's own Burn and Collect logs, reserves
//     and liquidity() moved); the real detector evaluates it unsafe, its one-block confirm gate
//     passes, and the real triggerAntiRugExit clears the timers and runs executeFullSell(...,
//     'anti-rug'); the private attempts miss and the V3 return is taken with reason anti-rug. This
//     is the case that matters most for capital: a rugged position left with no routine poll.
//
// What is measured: whether the still-held position is polled again (an exit-monitor timer in the
// bot's real registry). Correct: it is. Routing these returns through keepMonitoringFailedHeld (the
// recommendation's first shape) reads "looks fixed" (D-08) in every claim. Having the caller
// re-arm when the sell returns false (its second shape) reads "looks fixed" only for the callers
// that do it: a re-arm added to the force-sell route alone flips that claim and leaves the
// emergency-sell and anti-rug claims recorded, so the finding does not read fixed (in-memory
// mutants, review CR-05). Today's details (no exit_failed_held stamp, failure count 0, the alert
// that says the position stays monitored) are asserted after the marker.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { harnessState } from '../harness/chain';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepUntilTrue } from '../harness/world';
import { dashboardOverrides, driveChain, exitStatusOf, heldPosition, openDashboard, postDriven, sellsSince } from './fixtures/AUD-API-001-dashboard-sell';
import { buyRow, opEntries, opLogged } from './fixtures/AUD-EXIT-002-position';
import { pullV3Liquidity } from './fixtures/AUD-EXIT-014-rug';

/** The anti-rug exit-fired broadcasts for `tradeId` since broadcast index `from`. */
function exitFiredSince(from: number, tradeId: number): Array<{ success?: boolean }> {
    return harnessState()
        .broadcasts.slice(from)
        .filter((b) => b.type === 'antirug_state_update')
        .map((b) => b.data as { tradeId: number; state: string; success?: boolean })
        .filter((d) => d.state === 'exit-fired' && d.tradeId === tradeId);
}

describe('AUD-EXIT-007: exits with nowhere to go leave a held position with no poll timer', () => {
    it('v3-private-not-landed-leaves-no-poll: a dashboard force-sell of a V3 position whose private sell does not land returns false and the position is never polled again', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v3', overrides: await dashboardOverrides() });
        const pos = await heldPosition(sc);
        expect(sc.graph.exitManager.hasExitMonitorTimer('eth', sc.token)).toBe(true);
        const { dash, cookie } = await openDashboard(sc);
        const fromLog = recordedLogs().length;
        const fromSubmit = sc.node.submitted.length;
        const reply = await postDriven(sc, dash, `/api/controls/force-sell/${pos.tradeId}`, cookie, 'miss');

        // The V3 no-fallback return was taken: the private attempts were sent and none landed.
        const privateSells = sellsSince(sc, fromSubmit);
        expect(privateSells.length).toBeGreaterThanOrEqual(1);
        expect(privateSells.every((s) => s.route === 'bundle' && sc.node.statusOf(s.hash) !== 'mined')).toBe(true);
        expect(opEntries('exit.private.not-landed', fromLog)).toHaveLength(1);
        expect(opEntries('exit.fallback.unsupported-dex', fromLog).map((o) => o.reason)).toEqual(['urgency-market-sell']);
        expect(buyRow(sc)?.status).toBe('pending');
        const timer = sc.graph.exitManager.hasExitMonitorTimer('eth', sc.token);

        knownBug(ctx, 'AUD-EXIT-007', {
            claim: 'v3-private-not-landed-leaves-no-poll',
            correct: { stillPolled: true },
            observed: { stillPolled: false },
            actual: { stillPolled: timer },
            expectedPlain: 'When a V3 sell started from the dashboard does not land and the tokens are still held, the bot keeps polling the position (and records the failed exit).',
            actualPlain: 'The V3 private sell did not land and there is no public fallback for V3; the sell returned false after the dashboard had cleared the poll timer, so the held position was left with no exit monitor.',
        });
        expect(exitStatusOf(sc, pos.tradeId)).toEqual({ exit_status: null, exit_failure_count: 0 });
        expect(opEntries('exit.failed.held', fromLog)).toEqual([]);
        expect(recordedAlerts().some((a) => String(a.message).includes('[EXIT FALLBACK UNAVAILABLE]') && String(a.message).includes('stays held + monitored'))).toBe(true);
        expect(reply).toEqual({ status: 409, body: { error: 'Sell already in progress for this position' } });
    });

    it('unknown-dex-leaves-no-poll: a dashboard force-sell that reaches the unknown-dex return (a V3 row with no fee tier) returns false and the position is never polled again', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v3', overrides: await dashboardOverrides() });
        const pos = await heldPosition(sc);
        expect(sc.graph.exitManager.hasExitMonitorTimer('eth', sc.token)).toBe(true);
        sc.graph.db.prepare('UPDATE trades SET fee_tier = NULL WHERE id = ?').run(pos.tradeId);
        expect(buyRow(sc)).toEqual(expect.objectContaining({ status: 'pending', pool_type: 'v3', fee_tier: null }));
        const { dash, cookie } = await openDashboard(sc);
        const fromLog = recordedLogs().length;
        const fromSubmit = sc.node.submitted.length;
        const reply = await postDriven(sc, dash, `/api/controls/force-sell/${pos.tradeId}`, cookie, 'miss');

        // The unknown-dex return was taken, before any approve or sell.
        const unknown = recordedLogs().slice(fromLog).filter((l) => l.msg === 'Unknown DEX type for sell');
        expect(unknown.map((l) => l.obj?.dexType)).toEqual(['v3']);
        expect(sc.node.submitted.slice(fromSubmit)).toEqual([]);
        const timer = sc.graph.exitManager.hasExitMonitorTimer('eth', sc.token);

        knownBug(ctx, 'AUD-EXIT-007', {
            claim: 'unknown-dex-leaves-no-poll',
            correct: { stillPolled: true },
            observed: { stillPolled: false },
            actual: { stillPolled: timer },
            expectedPlain: 'When a dashboard sell cannot be built for the position\'s dex, the bot keeps polling the still-held position (and records the failed exit).',
            actualPlain: 'For a stored V3 trade with no fee tier (no current code writes one), the sell logged "Unknown DEX type for sell" and returned false after the dashboard had cleared the poll timer, so the held position was left with no exit monitor.',
        });
        expect(exitStatusOf(sc, pos.tradeId)).toEqual({ exit_status: null, exit_failure_count: 0 });
        expect(opEntries('exit.failed.held', fromLog)).toEqual([]);
        expect(reply).toEqual({ status: 409, body: { error: 'Sell already in progress for this position' } });
    });

    it('emergency-sell-v3-not-landed-leaves-no-poll: a dashboard emergency-sell of a V3 position whose private sell does not land returns false and the position is never polled again', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v3', overrides: await dashboardOverrides() });
        const pos = await heldPosition(sc);
        expect(sc.graph.exitManager.hasExitMonitorTimer('eth', sc.token)).toBe(true);
        const { dash, cookie } = await openDashboard(sc);
        const fromLog = recordedLogs().length;
        const fromSubmit = sc.node.submitted.length;
        const reply = await postDriven(sc, dash, '/api/controls/emergency-sell', cookie, 'miss');

        // The V3 no-fallback return was taken for the one open position, with the emergency route's reason.
        const privateSells = sellsSince(sc, fromSubmit);
        expect(privateSells.length).toBeGreaterThanOrEqual(1);
        expect(privateSells.every((s) => s.route === 'bundle' && sc.node.statusOf(s.hash) !== 'mined')).toBe(true);
        expect(opEntries('exit.private.not-landed', fromLog)).toHaveLength(1);
        expect(opEntries('exit.fallback.unsupported-dex', fromLog).map((o) => o.reason)).toEqual(['urgency-market-sell']);
        expect(buyRow(sc)?.status).toBe('pending');
        const timer = sc.graph.exitManager.hasExitMonitorTimer('eth', sc.token);

        knownBug(ctx, 'AUD-EXIT-007', {
            claim: 'emergency-sell-v3-not-landed-leaves-no-poll',
            correct: { stillPolled: true },
            observed: { stillPolled: false },
            actual: { stillPolled: timer },
            expectedPlain: 'When the dashboard emergency-sell cannot land a V3 sell and the tokens are still held, the bot keeps polling the position (and records the failed exit).',
            actualPlain: 'The emergency-sell cleared the poll timer, the V3 private sell did not land and there is no public fallback for V3; the sell returned false and the held position was left with no exit monitor.',
        });
        expect(exitStatusOf(sc, pos.tradeId)).toEqual({ exit_status: null, exit_failure_count: 0 });
        expect(opEntries('exit.failed.held', fromLog)).toEqual([]);
        expect(reply.status).toBe(200);
        expect(reply.body).toEqual(expect.objectContaining({ ok: false, sold: 0, failed: 1 }));
    });

    it('antirug-v3-not-landed-leaves-no-poll: a live anti-rug exit of a rugged V3 position whose private sell does not land returns false and the position is never polled again', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v3', overrides: { ETH_ANTIRUG_LIVE_EXECUTE: 'true' } });
        const { node } = sc;
        expect(sc.ctx.chain.antiRug.liveExecute).toBe(true);
        expect(sc.ctx.chain.antiRug.confirmBlocks).toBe(1);
        const pos = await heldPosition(sc);
        expect(sc.graph.exitManager.hasExitMonitorTimer('eth', sc.token)).toBe(true);
        expect(sc.graph.detector.getRegisteredPositions('eth').map((p) => p.tradeId)).toEqual([pos.tradeId]);

        // The rug: 95 percent of the pool's liquidity pulled through the position manager.
        const fromLog = recordedLogs().length;
        const fromBroadcast = harnessState().broadcasts.length;
        const fromSubmit = node.submitted.length;
        await pullV3Liquidity(sc, { removeBps: 9_500n });
        await stepUntilTrue(() => opLogged('antirug.confirm-gate.scheduled', fromLog), { what: 'the anti-rug confirm gate being scheduled', maxSteps: 2_000 });
        node.mine({ include: [] });
        await stepUntilTrue(() => opLogged('antirug.exit.dispatch', fromLog), { what: 'the anti-rug exit being dispatched', maxSteps: 2_000 });
        // Its private attempts miss; the exit returns, and triggerAntiRugExit broadcasts what it returned.
        await driveChain(sc, {
            mode: 'miss',
            until: () => opLogged('exit.fallback.unsupported-dex', fromLog) && exitFiredSince(fromBroadcast, pos.tradeId).length > 0,
            what: 'the anti-rug exit taking the V3 no-fallback return',
        });

        // The V3 no-fallback return was taken for reason anti-rug. (Measured today: the private
        // escalation outlasts triggerAntiRugExit's 60 s watchdog, so the broadcast's false comes from
        // the bounded abort and executeFullSell takes the V3 return after it. Neither is asserted:
        // whichever ends first, no code re-arms the timer, and a fix inside executeFullSell re-arms
        // it on the return either way.)
        const privateSells = sellsSince(sc, fromSubmit);
        expect(privateSells.length).toBeGreaterThanOrEqual(1);
        expect(privateSells.every((s) => s.route === 'bundle' && node.statusOf(s.hash) !== 'mined')).toBe(true);
        expect(opEntries('exit.full.submitted', fromLog).map((o) => o.reason)).toEqual(['anti-rug']);
        expect(opEntries('exit.fallback.unsupported-dex', fromLog).map((o) => o.reason)).toEqual(['anti-rug']);
        expect(exitFiredSince(fromBroadcast, pos.tradeId).map((f) => f.success)).toEqual([false]);
        expect(buyRow(sc)?.status).toBe('pending');
        const timer = sc.graph.exitManager.hasExitMonitorTimer('eth', sc.token);

        knownBug(ctx, 'AUD-EXIT-007', {
            claim: 'antirug-v3-not-landed-leaves-no-poll',
            correct: { stillPolled: true },
            observed: { stillPolled: false },
            actual: { stillPolled: timer },
            expectedPlain: 'When an anti-rug exit of a rugged V3 position cannot land and the tokens are still held, the bot keeps polling the position (and records the failed exit).',
            actualPlain: 'The anti-rug exit cleared the poll timer, its V3 private sell did not land and there is no public fallback for V3; it returned false and the rugged, still-held position was left with no exit monitor.',
        });
        expect(exitStatusOf(sc, pos.tradeId)).toEqual({ exit_status: null, exit_failure_count: 0 });
        expect(opEntries('exit.failed.held', fromLog)).toEqual([]);
    });
});
