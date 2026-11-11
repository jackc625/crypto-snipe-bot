// test/realpath/triage/AUD-EXIT-014.test.ts
// Phase 23 plan 23-08 Task 2 (AUDIT-02, AC-12): AUD-EXIT-014, an anti-rug exit is refused at once
// while another exit of the same token holds the sell lock.
//
// The site (src/exitEngine.ts executeFullSell): after the routine-pause gate, a failed
// tryAcquireSellLock(chain, token) logs "Another exit already handling token, skipping" (an info
// line with no op field, so it is on the plain logs list, not the timeline: review concern Codex
// 23-08 MEDIUM) and returns false, whatever the reason, anti-rug included. A routine full exit
// holds that lock for its whole ladder. src/anti-rug/exitTrigger.ts triggerAntiRugExit clears the
// token's timers, runs executeFullSell(..., 'anti-rug') under its watchdog budget, broadcasts
// antirug_state_update { state: 'exit-fired', success } with the returned value, and returns it.
//
// Proof on the real path, with the order forced exactly (AC-12: every wait is a hold, a step of
// fake time or a stepUntilTrue, never a sleep). A real ETH V2 snipe with anti-rug live
// (ETH_ANTIRUG_LIVE_EXECUTE=true through the createScenario overrides), bought and armed by the
// running bot, the anti-rug baseline recorded. Another wallet dumps 30 percent of the pool's tokens
// (a real router swap with the pair's own events), the real poll loop fires the stop-loss, and
// the real worker starts the routine exit: it takes the sell lock, approves (mined), logs
// exit.full.submitted and starts its private sell, whose Flashbots simulation (eth_callBundle on
// the relay) is held, so the routine exit stays inside the lock. The hold is on the relay, not on
// a read: a held read of the bot's HTTP provider stalls every later call of that provider
// (AUD-TX-028), which would stall the anti-rug evaluation too and decide this test by that finding.
// Then the deployer pulls 95 percent of the liquidity through the real router (fixtures/
// AUD-EXIT-014-rug.ts: the pair's own Transfer, Sync and Burn logs, reserves and LP supply moved
// by the pair's math). The real detector evaluates the rug as unsafe on the three signals,
// schedules its one-block confirm gate, the next block is mined, and it dispatches the anti-rug
// exit while the routine exit is still parked.
//
// What is measured: whether the anti-rug exit came back refused at once while the routine exit
// held the lock (its exit-fired broadcast carrying success false before the routine exit moved).
// Correct: it does not (the recommendation's shapes, card EXIT-11: pre-empt the in-flight exit,
// escalate it, or queue the anti-rug exit and retry; a fix that hands off to the in-flight exit
// must make the anti-rug call wait for, or adopt, that exit's result). Today: refused at once.
// A wait-for-the-lock fix reads "looks fixed" (D-08). After the marker: the refusal line on the
// plain logs list for reason anti-rug, the lock held, no sell sent while it was held, and the
// routine exit then selling with its routine reason. How many dispatches one pull makes (one per
// matching pair log) is AUD-ANTIRUG-003's claim and is not asserted here.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { harnessState, type HoldHandle } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepUntilTrue } from '../harness/world';
import { driveChain, heldPosition, sellsSince, stepUntilOrFor } from './fixtures/AUD-API-001-dashboard-sell';
import { buyRow, opEntries, opLogged } from './fixtures/AUD-EXIT-002-position';
import { foreignTrade } from './fixtures/AUD-EXIT-001-sell-path';
import { pullLiquidity } from './fixtures/AUD-EXIT-014-rug';

interface ExitFired {
    tradeId: number;
    state: string;
    success?: boolean;
}

function exitFiredSince(from: number, tradeId: number): ExitFired[] {
    return harnessState()
        .broadcasts.slice(from)
        .filter((b) => b.type === 'antirug_state_update')
        .map((b) => b.data as ExitFired)
        .filter((d) => d.state === 'exit-fired' && d.tradeId === tradeId);
}

describe('AUD-EXIT-014: an anti-rug exit is refused while another exit of the token holds the sell lock', () => {
    it('antirug-exit-refused-while-sell-lock-held: a rug detected while a routine stop-loss exit holds the sell lock gets an anti-rug exit that returns false at once', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { ETH_ANTIRUG_LIVE_EXECUTE: 'true' } });
        const { node } = sc;
        expect(sc.ctx.chain.antiRug.liveExecute).toBe(true);
        expect(sc.ctx.chain.antiRug.confirmBlocks).toBe(1);
        const pos = await heldPosition(sc);
        expect(sc.graph.detector.getRegisteredPositions('eth').map((p) => p.tradeId)).toEqual([pos.tradeId]);

        // The routine exit holding the lock: a stop-loss whose private sell simulation is held.
        let sim: HoldHandle | undefined;
        sim = node.hold('eth_callBundle', { after: () => opLogged('exit.full.submitted') && (sim?.heldCount ?? 0) === 0 });
        const fromSubmit = node.submitted.length;
        await foreignTrade(sc, { sellTokens: (sc.reserves.token * 3n) / 10n });
        await stepUntilTrue(
            () => {
                const approves = node.submitted.slice(fromSubmit).filter((s) => s.route === 'public' && s.status === 'accepted').map((s) => s.hash);
                if (approves.length > 0) node.mine({ include: approves });
                return sim!.parkedNow === 1;
            },
            { what: "the routine exit's private sell simulation being held", maxSteps: 20_000 },
        );
        expect(opEntries('exit.full.submitted').map((o) => o.reason)).toEqual(['stop-loss']);

        // The rug, while the routine exit is parked inside the lock.
        const fromLog = recordedLogs().length;
        const fromBroadcast = harnessState().broadcasts.length;
        const submittedWhileHeld = node.submitted.length;
        await pullLiquidity(sc, { removeBps: 9_500n });
        await stepUntilTrue(() => opLogged('antirug.confirm-gate.scheduled', fromLog), { what: 'the anti-rug confirm gate being scheduled', maxSteps: 2_000 });
        node.mine({ include: [] });
        await stepUntilTrue(() => opLogged('antirug.exit.dispatch', fromLog), { what: 'the anti-rug exit being dispatched', maxSteps: 2_000 });
        await stepUntilOrFor(() => exitFiredSince(fromBroadcast, pos.tradeId).length > 0, 2_000);
        // The routine exit has not moved: its simulation is still held.
        expect(sim!.parkedNow).toBe(1);
        const fired = exitFiredSince(fromBroadcast, pos.tradeId);

        knownBug(ctx, 'AUD-EXIT-014', {
            claim: 'antirug-exit-refused-while-sell-lock-held',
            correct: { antiRugExitRefusedAtOnce: false },
            observed: { antiRugExitRefusedAtOnce: true },
            actual: { antiRugExitRefusedAtOnce: fired.length > 0 && fired.every((f) => f.success === false) },
            expectedPlain: 'An anti-rug exit fired while another exit of the same token is running takes precedence over it or waits and runs, instead of giving up.',
            actualPlain: 'A rug was detected while a routine stop-loss exit held the token\'s sell lock; the anti-rug exit logged "Another exit already handling token, skipping" and returned false at once.',
        });
        // The refusal: the plain-log line (it has no op field) for reason anti-rug, the lock held,
        // and nothing sent while the routine exit held it.
        const refusals = recordedLogs()
            .slice(fromLog)
            .filter((l) => l.msg === 'Another exit already handling token, skipping');
        expect(refusals.length).toBeGreaterThanOrEqual(1);
        expect(refusals.every((l) => l.obj?.reason === 'anti-rug' && l.obj?.token === sc.token)).toBe(true);
        expect(refusals.every((l) => l.obj?.op === undefined)).toBe(true);
        const lockFree = sc.graph.exitManager.tryAcquireSellLock('eth', sc.token);
        if (lockFree) sc.graph.exitManager.releaseSellLock('eth', sc.token);
        expect(lockFree).toBe(false);
        expect(node.submitted.length).toBe(submittedWhileHeld);
        expect(sellsSince(sc, fromSubmit)).toEqual([]);
        expect(opEntries('antirug.exit.dispatch', fromLog).every((o) => o.tradeId === pos.tradeId)).toBe(true);
        expect(opEntries('exit.full.submitted', fromLog).filter((o) => o.reason === 'anti-rug')).toEqual([]);

        // Released, the routine exit sells with its routine reason and the position closes.
        sim!.release();
        await driveChain(sc, { mode: 'land', until: () => buyRow(sc)!.status === 'sold', what: 'the routine exit selling the position' });
        expect(sellsSince(sc, fromSubmit).every((s) => s.route === 'bundle')).toBe(true);
        expect(opEntries('exit.full.private-landed').map((o) => o.reason)).toEqual(['stop-loss']);
    });
});
