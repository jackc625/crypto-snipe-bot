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
// What is measured: whether the still-held position is polled again (an exit-monitor timer in the
// bot's real registry). Correct: it is. Both recommended fixes read "looks fixed" (D-08): routing
// these returns through keepMonitoringFailedHeld, or having the caller re-arm when the sell returns
// false. Today's details (no exit_failed_held stamp, failure count 0, the alert that says the
// position stays monitored) are asserted after the marker.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario } from '../harness/world';
import { dashboardOverrides, exitStatusOf, heldPosition, openDashboard, postDriven, sellsSince } from './fixtures/AUD-API-001-dashboard-sell';
import { buyRow, opEntries } from './fixtures/AUD-EXIT-002-position';

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
});
