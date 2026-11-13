// test/realpath/triage/AUD-EXIT-005.test.ts
// Phase 23 plan 23-08 Task 2 (AUDIT-02, RC-21, AC-12): AUD-EXIT-005, the per-position exit poll is
// a setInterval(async) with no in-flight guard and its price quote has no timeout, so a slow quote
// lets the next cycle start while the first is still pending, on one shared state object.
//
// The site (src/exitEngine.ts startExitMonitor; resumeExitMonitor has the identical loop): each
// 5 s tick awaits pollExitStrategy(..., state) with no running flag; pollExitStrategy awaits
// queryPrice (getAmountsOut through ethers, bounded only by the FetchRequest default), then
// mutates the shared `state` (high-water mark, volatility samples) and persists it with
// upsertExitState. The exit.poll.cycle telemetry is logged only when a cycle completes.
//
// Proof on the real path, with the order forced exactly (AC-12: every wait is a hold or a step of
// fake time, never a sleep). A real ETH V2 snipe, bought and armed by the running bot. Then the
// next exit quote, getAmountsOut on the router, is held on the node (the hold takes only the first
// such call, so it names one exact operation and is proven to fire). The fake clock then steps
// past the next poll interval, and short of the one after: the next tick starts a second cycle,
// which sends its own quote while the first cycle is still pending. Then another wallet buys a
// little of the token (a real router swap mined with the pair's own events) and the held quote is
// released, answered on the moved pool.
//
// What is measured: the most poll cycles of the position in flight together, read from the exact
// order of events (one counter numbers the node's calls and the bot's logs): a cycle starts with
// its exit quote reaching the node and finishes with its exit.poll.cycle log (or "Exit engine poll
// error"). Correct: one (a skipped tick or a self-rescheduling poll never starts a cycle while one
// is pending; a quote timeout shorter than the poll ends the first cycle before the next starts).
// Today: two. Each of those fixes reads "looks fixed" (D-08). After the marker: the held-call
// count, and the shared-state writes: both cycles persist the one state object, so the later
// exit_state write carries every sample of the earlier one plus its own, and only the first cycle
// reports the overrun, when it completes. When each cycle may finish while the other is pending
// (and so which price is saved last) is AUD-TX-028's claim, proven in its own file: these details
// hold either way.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { getAddress, parseEther } from 'ethers';
import type { HoldHandle, LogSinkEntry } from '../harness/chain';
import { recordedLogs, type DbEntry } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, v2AmountOut, type Scenario } from '../harness/world';
import { GET_AMOUNTS_OUT, buyAndMine, buyRow, exitQuotes, listen, opEntries, opLogged, waitAntiRugArmed } from './fixtures/AUD-EXIT-002-position';
import { foreignTrade } from './fixtures/AUD-EXIT-001-sell-path';

/** The position's exit_state writes recorded on the timeline from entry `from`. */
function exitStateWrites(sc: Scenario, tradeId: number, from: number): DbEntry[] {
    return sc.timeline.entries
        .slice(from)
        .filter((e): e is DbEntry => e.kind === 'db' && e.table === 'exit_state' && (e.op === 'insert' || e.op === 'update') && e.row.trade_id === BigInt(tradeId));
}

function samplesOf(w: DbEntry): number[] {
    return JSON.parse(String(w.row.volatility_samples)) as number[];
}

describe('AUD-EXIT-005: overlapping exit-poll cycles on one shared state (RC-21)', () => {
    it('poll-cycles-overlap-on-slow-quote: while one exit quote is held, the next poll tick starts a second cycle on the same position', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node } = sc;
        const pollMs = sc.graph.exitEngine.exitConfig.pollIntervalMs;
        expect(pollMs).toBe(5_000);
        await listen(sc);
        await buyAndMine(sc);
        await waitAntiRugArmed(sc);
        expect(opLogged('exit.monitor.started')).toBe(true);
        const tradeId = buyRow(sc)!.id;
        const probe = parseEther(sc.ctx.chain.snipeAmount);

        // The next exit quote on the router is held: only the first such call (the poll's own).
        let held: HoldHandle | undefined;
        held = node.hold('eth_call', { selector: GET_AMOUNTS_OUT, to: sc.dex.routerAddress, after: () => (held?.heldCount ?? 0) === 0 });
        const fromCall = node.callLog.length;
        const fromTimeline = sc.timeline.entries.length;
        const fromLog = recordedLogs().length;
        await stepUntilTrue(() => held!.parkedNow === 1, { what: 'the next exit-poll quote being held', maxSteps: 1_000 });
        const heldQuote = exitQuotes(sc, fromCall);
        expect(heldQuote).toHaveLength(1);
        expect(heldQuote[0]).toEqual(expect.objectContaining({ to: getAddress(sc.dex.routerAddress), amountIn: probe, tokenOut: getAddress(sc.weth) }));
        const priceBeforeMove = Number(v2AmountOut(probe, sc.reserves.token, sc.reserves.weth));

        // Past the next poll interval, short of the one after; the first quote is still held.
        await stepFor(pollMs + 2_000);
        expect(held!.parkedNow).toBe(1);
        const finishedOf = (l: LogSinkEntry): boolean => l.obj?.op === 'exit.poll.cycle' || l.msg === 'Exit engine poll error';
        const events = [
            ...exitQuotes(sc, fromCall).map((q) => ({ seq: q.seq, step: 1 })),
            ...recordedLogs().slice(fromLog).filter(finishedOf).map((l) => ({ seq: l.seq, step: -1 })),
        ].sort((a, b) => a.seq - b.seq);
        let inFlight = 0;
        let maxInFlight = 0;
        for (const e of events) {
            inFlight += e.step;
            maxInFlight = Math.max(maxInFlight, inFlight);
        }

        knownBug(ctx, 'AUD-EXIT-005', {
            claim: 'poll-cycles-overlap-on-slow-quote',
            correct: { cyclesInFlightTogether: 1 },
            observed: { cyclesInFlightTogether: 2 },
            actual: { cyclesInFlightTogether: maxInFlight },
            expectedPlain: 'A position runs one exit-poll cycle at a time: while a price quote is still pending, the next tick does not start another cycle.',
            actualPlain: 'While one exit quote was held, the next 5 s tick started a second poll cycle on the same position, and both cycles then wrote the one shared exit state.',
        });

        // Held-call count: only the first quote was parked; the second cycle's quote reached the node.
        expect(held!.heldCount).toBe(1);
        expect(exitQuotes(sc, fromCall).map((q) => q.amountIn)).toEqual([probe, probe]);

        // Another wallet moves the price, then the held quote is answered on the moved pool.
        await foreignTrade(sc, { buyEth: sc.reserves.weth / 100n });
        const priceAfterMove = Number(v2AmountOut(probe, sc.reserves.token, sc.reserves.weth));
        expect(priceAfterMove).not.toBe(priceBeforeMove);
        held!.release();
        await stepFor(1_000);

        // Both cycles persisted the one state object: two writes, the later carrying every sample of
        // the earlier plus one more, and between them both cycles' prices (the second cycle's quote
        // was answered before the move, the first cycle's after it).
        const writes = exitStateWrites(sc, tradeId, fromTimeline);
        expect(writes).toHaveLength(2);
        const [earlier, later] = writes.map(samplesOf);
        expect(later.length).toBeGreaterThanOrEqual(earlier.length);
        expect(later).toEqual([...earlier, later[later.length - 1]].slice(-later.length));
        expect([...later.slice(-2)].sort((a, b) => a - b)).toEqual([priceBeforeMove, priceAfterMove].sort((a, b) => a - b));
        // Each cycle's telemetry appears when it completes; only the first one overran the budget.
        const cycles = opEntries('exit.poll.cycle', fromLog);
        expect(cycles).toHaveLength(2);
        expect(cycles.filter((o) => o.overruns === true).map((o) => Number(o.durationMs) > pollMs + 2_000)).toEqual([true]);
    });
});
