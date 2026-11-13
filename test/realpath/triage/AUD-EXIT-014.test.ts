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
// What is measured: the anti-rug exit's outcome, not its timing (review WR-17: "no broadcast within
// 2 s" let a fix that waits longer and then still refuses read "looks fixed"). The routine exit's
// simulation is released and the chain is driven until the position is closed and the anti-rug
// exit has reported what it returned; the anti-rug exit succeeded when its exit-fired broadcast
// carries success true, or a sell was submitted with reason anti-rug. Correct: it succeeded (the
// recommendation's shapes, card EXIT-11: pre-empt the in-flight exit, escalate it, or queue the
// anti-rug exit and retry; a fix that hands off to the in-flight exit must make the anti-rug call
// wait for, or adopt, that exit's result). Today: it never succeeds. "Refused at once" (an
// exit-fired success false within 2 s while the routine exit was still parked) is kept as a fact,
// asserted after the marker; it is not in the marker, because queue-and-retry, one of the card's
// shapes, may refuse at once and still succeed later.
//
// Measured with in-memory mutants: triggerAntiRugExit queueing the anti-rug exit until the
// in-flight exit releases the sell lock and then running it again reads "looks fixed"; an anti-rug
// exit that waits 3 s for the lock and then still refuses records the bug. Two shapes that stay
// inside the 60 s watchdog do NOT read "looks fixed" here, and are not complete fixes: the
// in-flight routine exit (its first private attempt misses, the second lands about 76 s after the
// rug) holds the sell lock and the wallet's nonce lock for longer than triggerAntiRugExit's 60 s
// watchdog, so a plain wait-for-the-lock inside executeFullSell, and an anti-rug exit that skips
// the sell lock but still waits on the nonce lock, each end in antirug.exit.bounded-abort (success
// false). After the marker: the refusal line on the plain logs list for reason anti-rug, the lock
// held, no sell sent while it was held (all read at the 2 s mark), and the routine exit selling with
// its routine reason. How many dispatches one pull makes (one per matching pair log) is
// AUD-ANTIRUG-003's claim and is not asserted here.
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
        // The 2 s mark: what had happened while the routine exit was still parked (asserted after the
        // marker, so a fix that pre-empts the routine exit is measured, not failed here).
        const firedAtOnce = exitFiredSince(fromBroadcast, pos.tradeId);
        const antiRugExitRefusedAtOnce = firedAtOnce.length > 0 && firedAtOnce.every((f) => f.success === false);
        const parkedAt2s = sim!.parkedNow;
        const refusals = recordedLogs()
            .slice(fromLog)
            .filter((l) => l.msg === 'Another exit already handling token, skipping');
        const lockFree = sc.graph.exitManager.tryAcquireSellLock('eth', sc.token);
        if (lockFree) sc.graph.exitManager.releaseSellLock('eth', sc.token);
        const submittedAt2s = node.submitted.length;
        const sellsAt2s = sellsSince(sc, fromSubmit);

        // The outcome: the routine exit's simulation is released, and the chain is driven until the
        // position is closed and the anti-rug exit has reported what it returned.
        sim!.release();
        await driveChain(sc, {
            mode: 'land',
            until: () => buyRow(sc)!.status === 'sold' && exitFiredSince(fromBroadcast, pos.tradeId).length > 0,
            what: 'the position closing and the anti-rug exit reporting',
        });
        const fired = exitFiredSince(fromBroadcast, pos.tradeId);
        const antiRugExitSucceeded = fired.some((f) => f.success === true) || opEntries('exit.full.submitted', fromLog).some((o) => o.reason === 'anti-rug');

        knownBug(ctx, 'AUD-EXIT-014', {
            claim: 'antirug-exit-refused-while-sell-lock-held',
            correct: { antiRugExitSucceeded: true },
            observed: { antiRugExitSucceeded: false },
            actual: { antiRugExitSucceeded },
            expectedPlain: 'An anti-rug exit fired while another exit of the same token is running takes precedence over it or waits and runs (or adopts that exit\'s result), instead of giving up.',
            actualPlain: 'A rug was detected while a routine stop-loss exit held the token\'s sell lock; the anti-rug exit logged "Another exit already handling token, skipping", returned false at once and never succeeded; the routine exit sold later with its own reason.',
        });
        // At the 2 s mark: the anti-rug exit had come back refused at once, the routine exit had not
        // moved (its simulation still held); the refusal was the plain-log line (it has no op field)
        // for reason anti-rug; the lock was held; nothing was sent while the routine exit held it.
        expect(antiRugExitRefusedAtOnce).toBe(true);
        expect(parkedAt2s).toBe(1);
        expect(refusals.length).toBeGreaterThanOrEqual(1);
        expect(refusals.every((l) => l.obj?.reason === 'anti-rug' && l.obj?.token === sc.token)).toBe(true);
        expect(refusals.every((l) => l.obj?.op === undefined)).toBe(true);
        expect(lockFree).toBe(false);
        expect(submittedAt2s).toBe(submittedWhileHeld);
        expect(sellsAt2s).toEqual([]);
        expect(opEntries('antirug.exit.dispatch', fromLog).every((o) => o.tradeId === pos.tradeId)).toBe(true);
        expect(opEntries('exit.full.submitted', fromLog).filter((o) => o.reason === 'anti-rug')).toEqual([]);
        // Released, the routine exit sold with its routine reason and the position closed.
        expect(sellsSince(sc, fromSubmit).every((s) => s.route === 'bundle')).toBe(true);
        expect(opEntries('exit.full.private-landed').map((o) => o.reason)).toEqual(['stop-loss']);
    });
});
