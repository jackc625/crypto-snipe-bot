// test/realpath/triage/AUD-ANTIRUG-005.test.ts
// Phase 23 plan 23-10 Task 3 (AUDIT-02, AC-12): AUD-ANTIRUG-005, the backfill does not keep its
// own contract.
//
// The sites (src/anti-rug/detector.ts): backfillSinceLastSeen replays the logs of the window
// (chain_state.last_seen_block + 1 .. head) through evaluateRugSignalsShim, which is the live
// evaluator; the evaluator itself schedules the confirm gate on an unsafe verdict, and the gate
// calls triggerAntiRugExit. The code's own contract, in three comments (startChainAntiRugListener,
// the backfill header and the replay loop, D-BACKFILL): backfilled triggers log
// antirug.backfill.too-late and NEVER call triggerAntiRugExit. On the WebSocket path
// last_seen_block is written only inside backfillSinceLastSeen; the live dispatcher
// (dispatchEvent) never advances it.
//
// Proof on the real path: a real ETH V2 snipe, bought and armed (the arming backfill writes the
// cursor at the head), anti-rug live (ETH_ANTIRUG_LIVE_EXECUTE=true, ETH_ANTIRUG_CONFIRM_BLOCKS=1,
// ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS=100 so the breaker cannot decide the result; fixtures/
// AUD-ANTIRUG-003-live.ts), and the deployer's real 95 percent router liquidity pull (all three
// signals trip; fixtures/AUD-EXIT-014-rug.ts).
//   - backfill-fires-live-exit: the fake node closes the socket from its side (dropSocket, 1006)
//     right after an exit-monitor poll, and the pull is mined while no socket is open, so no live
//     subscription sees it. One second later the anti-rug reconnect re-subscribes and runs the real
//     backfill, whose window holds the pull. Precondition, true for the bug and the contract alike:
//     the backfill evaluated the pull unsafe (op antirug.backfill.too-late with the live gates on).
//     Then one confirm block. Measured within 30 s of fake time: whether triggerAntiRugExit was
//     reached from that backfill (op antirug.exit.dispatch) and a new anti-rug sell entered
//     node.submitted (op exit.full.submitted with reason anti-rug, and the bundle on the node).
//   - live-dispatch-does-not-advance-cursor: the pull is delivered live on the open socket and
//     dispatched (precondition: op antirug.exit.dispatch, so a dry run or a gate miss fails here),
//     and the exit sells. Measured from the real database: whether chain_state.last_seen_block
//     reached the block of the log the bot dispatched live.
// The routine stop-loss takes no part: a pro-rata removal leaves the price unchanged, and each
// action starts right after an exit poll.
//
// Which contract is right for a still-held position (exit on a backfilled rug, or alert only) is
// card ANTIRUG-02's decision; this file holds the code to its own documented contract, as the plan
// directs. Sub-claims 3 to 5 stay code-read.
//
// Fix signals (D-08), fix-shaped src mutations, restored: a backfill replay that cannot schedule
// the confirm gate reads "looks fixed" on the first claim; a dispatcher that writes the dispatched
// log's block to chain_state reads "looks fixed" on the second.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepUntilTrue, type Scenario } from '../harness/world';
import { afterExitPoll, driveFor, liveGates, liveOverrides } from './fixtures/AUD-ANTIRUG-003-live';
import { heldPosition, sellsSince } from './fixtures/AUD-API-001-dashboard-sell';
import { buyRow, opEntries, opLogged } from './fixtures/AUD-EXIT-002-position';
import { pullLiquidity } from './fixtures/AUD-EXIT-014-rug';

const TRIGGERS = 100;

function cursor(sc: Scenario): number | undefined {
    return (sc.graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get('eth') as { b: number } | undefined)?.b;
}

function antiRugSubmitted(from: number): boolean {
    return opEntries('exit.full.submitted', from).some((o) => o.reason === 'anti-rug');
}

describe('AUD-ANTIRUG-005: the anti-rug backfill does not keep its own contract', () => {
    it('backfill-fires-live-exit: a rug mined while the socket was down is replayed by the reconnect backfill, which reaches triggerAntiRugExit and submits an anti-rug sell', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: liveOverrides(TRIGGERS) });
        const { node } = sc;
        liveGates(sc, TRIGGERS);
        const pos = await heldPosition(sc);
        const armedAt = cursor(sc)!;

        await afterExitPoll(sc);
        const fromLog = recordedLogs().length;
        const fromSubmit = node.submitted.length;
        node.dropSocket();
        const pull = await pullLiquidity(sc, { removeBps: 9_500n });
        expect(node.subscriptions).toEqual([]);
        // The reconnect's backfill replays the window holding the pull and evaluates it unsafe.
        await stepUntilTrue(() => opEntries('antirug.backfill.too-late', fromLog).some((o) => o.tradeId === pos.tradeId), { what: 'the reconnect backfill evaluating the pull', maxSteps: 2_000 });
        const window = opEntries('antirug.backfill.window', fromLog);
        expect(window).toHaveLength(1);
        expect(Number(window[0].fromBlock)).toBeLessThanOrEqual(pull.block);
        expect(Number(window[0].toBlock)).toBeGreaterThanOrEqual(pull.block);
        node.mine({ include: [] });
        const fired = (): boolean => opEntries('antirug.exit.dispatch', fromLog).some((o) => o.tradeId === pos.tradeId) && antiRugSubmitted(fromLog) && sellsSince(sc, fromSubmit).length > 0;
        await driveFor(sc, fired, 30_000);

        knownBug(ctx, 'AUD-ANTIRUG-005', {
            claim: 'backfill-fires-live-exit',
            correct: { triggerAntiRugExitReachedFromBackfill: false, antiRugSellSubmitted: false },
            observed: { triggerAntiRugExitReachedFromBackfill: true, antiRugSellSubmitted: true },
            actual: {
                triggerAntiRugExitReachedFromBackfill: opEntries('antirug.exit.dispatch', fromLog).some((o) => o.tradeId === pos.tradeId),
                antiRugSellSubmitted: antiRugSubmitted(fromLog) && sellsSince(sc, fromSubmit).length > 0,
            },
            expectedPlain: 'A rug found by the backfill after a reconnect is reported as too late to exit, and the backfill never fires a live exit (the code\'s own D-BACKFILL contract; card ANTIRUG-02 decides the policy).',
            actualPlain: 'The reconnect backfill replayed a rug mined while the socket was down, logged it as too late, and still reached triggerAntiRugExit through the live evaluator\'s confirm gate and submitted an anti-rug sell.',
        });
        // Bug details, after the marker: the replayed log and the live exit belong to the one pull,
        // the cursor moved only through the backfill, and the exit sells the position.
        expect(armedAt).toBeLessThan(pull.block);
        expect(cursor(sc)).toBeGreaterThanOrEqual(pull.block);
        expect(opEntries('antirug.ws.reconnected', fromLog)).toHaveLength(1);
        await driveFor(sc, () => buyRow(sc)!.status === 'sold', 120_000);
        expect(buyRow(sc)!.status).toBe('sold');
    });

    it('live-dispatch-does-not-advance-cursor: a rug log dispatched live leaves chain_state.last_seen_block at the arming backfill block, behind the log the bot already acted on', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: liveOverrides(TRIGGERS) });
        const { node } = sc;
        liveGates(sc, TRIGGERS);
        const pos = await heldPosition(sc);
        const armedAt = cursor(sc)!;

        await afterExitPoll(sc);
        const fromLog = recordedLogs().length;
        const pull = await pullLiquidity(sc, { removeBps: 9_500n });
        await stepUntilTrue(() => opLogged('antirug.confirm-gate.scheduled', fromLog), { what: 'the live anti-rug confirm gate being scheduled', maxSteps: 2_000 });
        node.mine({ include: [] });
        await stepUntilTrue(() => opEntries('antirug.exit.dispatch', fromLog).some((o) => o.tradeId === pos.tradeId), { what: 'the live anti-rug exit being dispatched', maxSteps: 2_000 });
        await driveFor(sc, () => buyRow(sc)!.status === 'sold', 120_000);
        expect(buyRow(sc)!.status).toBe('sold');

        knownBug(ctx, 'AUD-ANTIRUG-005', {
            claim: 'live-dispatch-does-not-advance-cursor',
            correct: { cursorReachedDispatchedLogBlock: true },
            observed: { cursorReachedDispatchedLogBlock: false },
            actual: { cursorReachedDispatchedLogBlock: (cursor(sc) ?? -1) >= pull.block },
            expectedPlain: 'Every rug log the bot dispatches live moves chain_state.last_seen_block to its block, so a later backfill neither replays it nor starts its window from an old block.',
            actualPlain: 'The bot dispatched the pull live and sold the position, but chain_state.last_seen_block stayed at the arming backfill block, behind the log it had already acted on.',
        });
        // Bug details, after the marker: the cursor is exactly where the arming backfill left it,
        // and no backfill ran after the arming.
        expect(cursor(sc)).toBe(armedAt);
        expect(opEntries('antirug.backfill.window', fromLog)).toEqual([]);
        expect(opLogged('antirug.backfill.too-late', fromLog)).toBe(false);
    });
});
