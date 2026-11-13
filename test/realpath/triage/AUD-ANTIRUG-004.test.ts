// test/realpath/triage/AUD-ANTIRUG-004.test.ts
// Phase 23 plan 23-10 Task 3 (AUDIT-02, AC-12): AUD-ANTIRUG-004, a failed anti-rug escape is never
// retried by the detector.
//
// The sites: src/anti-rug/detector.ts scheduleConfirmBlocksGate removes its block handler before
// it re-evaluates (one gate is one attempt), awaits triggerAntiRugExit and discards the boolean; no
// pending-rug state is kept anywhere in the module, and dispatch is driven only by new logs (plus
// backfill replays and the V3 grace watcher). src/anti-rug/exitTrigger.ts clears every timer of
// the token before executeFullSell and, on a false result, only broadcasts exit-fired success
// false and counts the breaker; its comment says the position "retries on a later poll/anti-rug
// cycle", but no anti-rug cycle exists.
//
// Proof on the real path: a real ETH V2 snipe, bought and armed, anti-rug live
// (ETH_ANTIRUG_LIVE_EXECUTE=true, ETH_ANTIRUG_CONFIRM_BLOCKS=1, and
// ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS=100 so the breaker cannot decide the result; fixtures/
// AUD-ANTIRUG-003-live.ts). Right after an exit-monitor poll, the deployer pulls 95 percent of the
// liquidity through the real router (all three signals trip), the confirm block is mined and the
// anti-rug exit is dispatched. Its first submission, the token approval's eth_sendRawTransaction,
// is refused once by the node (FakeNode.failNext, aimed at that call only, with a geth-shaped
// "transaction underpriced" error, as a node refuses a transaction whose fee it will not accept),
// so the escape fails before any sell is sent. Then the chain runs for 2 minutes of fake time, an
// empty block every 12 s and every transaction of the wallet landed as the network would. Measured:
// whether anti-rug dispatched the escape again within that window. The routine exit monitor's own
// behavior after the failure is AUD-EXIT-007's ground and is neither driven nor asserted; any sell
// it makes carries reason stop-loss, never anti-rug.
//
// Why this failure and not a held sell lock: a refusal by the sell lock is AUD-EXIT-014's claim, and
// its fix (the anti-rug exit waits for, or pre-empts, the exit in flight) would remove the refusal
// this test needs. A refused approval is a failure no other finding's fix removes.
//
// Fix signal (D-08): a gate that keeps the unsafe verdict pending and re-dispatches on the next
// block while the position is still held (the recommendation, card ANTIRUG-01) reads "looks fixed"
// (fix-shaped src mutation, restored).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { harnessState } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepUntilTrue } from '../harness/world';
import { afterExitPoll, driveFor, exitFiredSince, liveGates, liveOverrides, noExitInFlight } from './fixtures/AUD-ANTIRUG-003-live';
import { heldPosition, sellsSince } from './fixtures/AUD-API-001-dashboard-sell';
import { buyRow, opEntries, opLogged } from './fixtures/AUD-EXIT-002-position';
import { pullLiquidity } from './fixtures/AUD-EXIT-014-rug';

const TRIGGERS = 100;
const WINDOW_MS = 120_000;

describe('AUD-ANTIRUG-004: a failed anti-rug escape is not retried', () => {
    it('failed-escape-not-retried: an anti-rug exit whose approval the node refuses is never dispatched again within 2 minutes of fake time while the position is still held', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: liveOverrides(TRIGGERS) });
        const { node } = sc;
        liveGates(sc, TRIGGERS);
        const pos = await heldPosition(sc);

        // The escape's first submission (its approval) is refused once by the node.
        const fromLog = recordedLogs().length;
        const fromBroadcast = harnessState().broadcasts.length;
        const fromSubmit = node.submitted.length;
        const refusal = node.failNext('eth_sendRawTransaction', {
            after: () => opLogged('antirug.exit.dispatch', fromLog),
            error: { code: -32000, message: 'transaction underpriced' },
        });

        await afterExitPoll(sc);
        await pullLiquidity(sc, { removeBps: 9_500n });
        await stepUntilTrue(() => opLogged('antirug.confirm-gate.scheduled', fromLog), { what: 'the anti-rug confirm gate being scheduled', maxSteps: 2_000 });
        node.mine({ include: [] });
        await stepUntilTrue(() => opLogged('antirug.exit.dispatch', fromLog), { what: 'the anti-rug exit being dispatched', maxSteps: 2_000 });
        const firstDispatches = (): number => opEntries('antirug.exit.dispatch', fromLog).length;
        // The escape returned after its refused approval: the refusal fired, an exit-fired broadcast
        // came, and no exit of the token is in flight. An outcome wait, never a count match of
        // broadcasts to dispatch logs, so the AUD-ANTIRUG-003 fix (an in-flight duplicate returns
        // early without a broadcast) does not stall this setup (review WR-09).
        await stepUntilTrue(() => refusal.fired >= 1 && exitFiredSince(fromBroadcast, pos.tradeId).length >= 1 && noExitInFlight(sc), { what: 'the anti-rug escape returning after its refused approval', maxSteps: 2_000 });
        const dispatchesOfTheRug = firstDispatches();
        expect(exitFiredSince(fromBroadcast, pos.tradeId).every((f) => f.success === false)).toBe(true);
        // The escape failed on a still-held position (no sell was sent).
        expect(buyRow(sc)!.status).not.toBe('sold');
        expect(sellsSince(sc, fromSubmit)).toEqual([]);

        // The window: 2 minutes of fake time, a block every 12 s, the wallet's transactions landed.
        const fromRetry = recordedLogs().length;
        const retried = (): boolean => opEntries('antirug.exit.dispatch', fromRetry).length > 0;
        await driveFor(sc, retried, WINDOW_MS);

        knownBug(ctx, 'AUD-ANTIRUG-004', {
            claim: 'failed-escape-not-retried',
            correct: { escapeDispatchedAgain: true },
            observed: { escapeDispatchedAgain: false },
            actual: { escapeDispatchedAgain: retried() },
            expectedPlain: 'When an anti-rug escape fails while the position is still held, the detector keeps the rug verdict and tries the escape again on a later block.',
            actualPlain: 'The node refused the escape\'s approval once; anti-rug never dispatched the escape again during 2 minutes of fake time (10 blocks), and only a new LP log could have re-triggered it.',
        });
        // Bug details, after the marker: the escape ended in its refused approval, no anti-rug sell
        // was ever submitted, and the position stayed registered with anti-rug throughout.
        expect(opEntries('exit.full.submitted', fromLog).filter((o) => o.reason === 'anti-rug')).toEqual([]);
        expect(opEntries('exit.full.failed', fromLog).filter((o) => o.reason === 'anti-rug').length).toBeGreaterThanOrEqual(1);
        expect(dispatchesOfTheRug).toBeGreaterThanOrEqual(1);
        expect(opEntries('antirug.unregister', fromLog).filter((o) => o.tradeId === pos.tradeId).length === 0 || buyRow(sc)!.status === 'sold').toBe(true);
    });
});
