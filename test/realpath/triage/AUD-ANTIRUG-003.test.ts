// test/realpath/triage/AUD-ANTIRUG-003.test.ts
// Phase 23 plan 23-10 Task 3 (AUDIT-02, AC-12): AUD-ANTIRUG-003, the anti-rug circuit breaker
// counts dispatches, not rugs.
//
// The sites: src/anti-rug/detector.ts subscribes one filter for four topics on every registered
// pair (V2 Burn, V2 Transfer, V3 Burn, V3 Collect) and evaluates each matching log on its own; each
// unsafe verdict schedules its own confirm gate, and each gate calls triggerAntiRugExit. In
// src/anti-rug/exitTrigger.ts every call that passes the dry-run and breaker gates runs
// executeFullSell (which refuses at once while another exit of the token holds the sell lock) and
// then incrementCircuitBreaker, success or failure, after the sell attempt returns. The breaker
// (src/anti-rug/circuitBreaker.ts) trips at `circuitBreakerTriggers` counts in its window, and a
// tripped breaker suppresses every later anti-rug exit on the chain.
//
// Proof on the real path, with the order forced exactly (AC-12): a real ETH V2 snipe, bought and
// armed, anti-rug live (ETH_ANTIRUG_LIVE_EXECUTE=true, ETH_ANTIRUG_CONFIRM_BLOCKS=1,
// ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS=3, the defaults made explicit; fixtures/
// AUD-ANTIRUG-003-live.ts). Right after an exit-monitor poll, the deployer pulls 95 percent of the
// liquidity through the real router: ONE removal, whose block holds the pair's own logs in
// UniswapV2Pair order (fixtures/AUD-EXIT-014-rug.ts: Transfer deployer->pair, Transfer pair->0,
// Sync, Burn), all built with real ethers encoders. The first anti-rug exit's private sell is held
// at its Flashbots simulation (eth_callBundle on the relay, never a provider read, so AUD-TX-028
// cannot decide the test) while the other dispatches of the same removal run; then it is released
// and its bundle lands. Measured from the real breaker (getRecentTriggers, isCircuitBreakerTripped):
// how many triggers this one rug counted, and whether the breaker tripped.
//
// Sub-claim 2 (how many matching logs a REAL removal emits on mainnet) needs real contract
// semantics: the order above is UniswapV2Pair's, written by hand from the contract, not replayed
// from a real transaction. It is recorded with needs_fork (AC-16) for the Phase 25 fork run.
//
// Fix signal (D-08): one in-flight anti-rug dispatch per position that does not count the refused
// duplicates (the recommendation, card ANTIRUG-01) reads "looks fixed" (fix-shaped src mutation,
// restored). The refusal of the duplicates by the sell lock is AUD-EXIT-014's claim and the
// missing retry AUD-ANTIRUG-004's; neither is asserted here.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { harnessState, type HoldHandle } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepUntilTrue } from '../harness/world';
import { afterExitPoll, breaker, exitFiredSince, liveGates, liveOverrides, noExitInFlight } from './fixtures/AUD-ANTIRUG-003-live';
import { driveChain, heldPosition, stepUntilOrFor } from './fixtures/AUD-API-001-dashboard-sell';
import { buyRow, opEntries, opLogged } from './fixtures/AUD-EXIT-002-position';
import { pullLiquidity } from './fixtures/AUD-EXIT-014-rug';

const TRIGGERS = 3;

describe('AUD-ANTIRUG-003: the anti-rug circuit breaker counts each dispatch of one rug', () => {
    it('breaker-counts-dispatches-not-rugs: one 95 percent liquidity pull, with the first anti-rug exit held in flight, counts three triggers and trips the chain breaker', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: liveOverrides(TRIGGERS) });
        const { node } = sc;
        liveGates(sc, TRIGGERS);
        const cb = await breaker();
        const pos = await heldPosition(sc);
        expect(cb.getRecentTriggers('eth')).toEqual([]);

        // The first anti-rug exit is parked at its Flashbots simulation; later calls pass.
        const fromLog = recordedLogs().length;
        const fromBroadcast = harnessState().broadcasts.length;
        let sim: HoldHandle | undefined;
        sim = node.hold('eth_callBundle', { after: () => opLogged('antirug.exit.dispatch', fromLog) && (sim?.heldCount ?? 0) === 0 });

        // One removal, right after an exit poll; one confirm block.
        await afterExitPoll(sc);
        const pull = await pullLiquidity(sc, { removeBps: 9_500n });
        await stepUntilTrue(() => opLogged('antirug.confirm-gate.scheduled', fromLog), { what: 'the anti-rug confirm gate being scheduled', maxSteps: 2_000 });
        node.mine({ include: [] });
        await stepUntilTrue(() => opLogged('antirug.exit.dispatch', fromLog), { what: 'the anti-rug exit being dispatched', maxSteps: 2_000 });
        // The confirm block's gates have all fired (no further block is mined before this read).
        await stepUntilOrFor(() => false, 100);
        const atConfirm = {
            dispatches: opEntries('antirug.exit.dispatch', fromLog).length,
            counted: cb.getRecentTriggers('eth').map((t) => t.outcome),
            fired: exitFiredSince(fromBroadcast, pos.tradeId).map((f) => f.success),
        };
        // The first exit approves (mined as the network would) and is parked at its simulation.
        await driveChain(sc, { mode: 'land', until: () => sim!.parkedNow === 1, what: "the first anti-rug exit's simulation being held" });

        // Released, the held exit's bundle lands and the position is sold. The wait is on the outcome
        // (sold, and no exit of the token in flight), never on matching broadcasts to dispatch logs,
        // so a fix that drops in-flight duplicates without a broadcast does not stall it (WR-09).
        // Then one more second of fake time, so every count of a returned exit has landed.
        sim!.release();
        await driveChain(sc, { mode: 'land', until: () => buyRow(sc)!.status === 'sold' && noExitInFlight(sc), what: 'the held anti-rug exit selling the position' });
        await stepUntilOrFor(() => false, 1_000);
        expect(atConfirm.dispatches).toBeGreaterThanOrEqual(1);

        knownBug(ctx, 'AUD-ANTIRUG-003', {
            claim: 'breaker-counts-dispatches-not-rugs',
            correct: { triggersCountedForOneRug: 1, breakerTripped: false },
            observed: { triggersCountedForOneRug: 3, breakerTripped: true },
            actual: { triggersCountedForOneRug: cb.getRecentTriggers('eth').length, breakerTripped: cb.isCircuitBreakerTripped('eth') },
            expectedPlain: 'One rug counts once toward the anti-rug circuit breaker, however many matching logs its removal emits.',
            actualPlain: 'One 95 percent liquidity pull emitted three logs the filter matches; each became its own anti-rug dispatch and each counted, so the single rug tripped the chain breaker (threshold 3) and every later anti-rug exit on the chain is suppressed.',
        });
        // Bug details, after the marker. Three dispatches at the confirm block for the one removal;
        // the two refused while the first was in flight counted at once, the first only after its
        // sell returned (sub-claim 4); every trigger names the same token.
        expect(atConfirm.dispatches).toBe(3);
        expect(atConfirm.counted).toEqual(['exit-fired-failure', 'exit-fired-failure']);
        expect(atConfirm.fired).toEqual([false, false]);
        expect(cb.getRecentTriggers('eth').some((t) => t.outcome === 'exit-fired-success')).toBe(true);
        expect(cb.getRecentTriggers('eth').every((t) => t.token.toLowerCase() === sc.token.toLowerCase())).toBe(true);
        expect(opEntries('antirug.cb-tripped', fromLog)).toHaveLength(1);
        // The three matched logs are the pull's: two LP Transfers and the Burn, one transaction.
        const pairLogs = node.logs.filter((l) => l.transactionHash === pull.hash && l.address.toLowerCase() === sc.pair.toLowerCase());
        expect(pairLogs).toHaveLength(4);
    });
});
