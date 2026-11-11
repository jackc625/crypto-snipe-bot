// test/realpath/triage/AUD-TX-028.test.ts
// Phase 23 plan 23-08 (AUDIT-02): AUD-TX-028, registered by the 23-08 executor under the
// operator's standing instruction of 2026-11-11. One stalled HTTP call of the bot's provider
// stalls every later call of that provider, including the anti-rug evaluation of a rug.
//
// The site. src/utils/provider.ts getProvider builds new ethers.JsonRpcProvider(url) with no
// network and no staticNetwork, and every chain context's httpProvider comes from it. In ethers
// 6.16.0 every call (provider call, getBalance, getTransactionCount and the rest) runs
// #checkNetwork, which awaits getNetwork -> _detectNetwork; that keeps ONE pending eth_chainId
// request (#pendingDetectNetwork) for every caller and sends it with send(), so it goes in the
// same JSON-RPC batch as the call that started it (batchStallTime 10 ms). A JSON-RPC server
// answers a batch in one response, when every member is done. So while one call's batch is
// unanswered, every later call of the provider gets its own answer from the node and still
// cannot return: it waits on the shared eth_chainId, up to the FetchRequest idle timeout (300 s,
// AUD-TX-008).
//
// Proof on the real path, with the order forced exactly (AC-12: every wait is a hold or a step of
// fake time). A real ETH V2 snipe, bought and armed (exit monitor and anti-rug, the baseline
// recorded). The next exit quote (getAmountsOut on the router) is held on the node. Then the
// deployer pulls 95 percent of the liquidity through the real router (fixtures/AUD-EXIT-014-rug.ts:
// the pair's own Transfer, Sync and Burn logs, reserves and LP supply moved by the pair's math).
// The anti-rug WebSocket subscription delivers the logs and the real detector starts its
// evaluation: its getReserves and totalSupply reads reach the node and are answered at once
// (they are not held), yet the evaluation does not finish while the unrelated exit quote is held.
// Released, the quote's batch completes with its eth_chainId, and the evaluation finishes.
//
// What is measured: whether the anti-rug evaluation finished (its three-signal verdict scheduling
// the confirm gate, op antirug.confirm-gate.scheduled) while the exit quote was held. Correct: it
// did (calls of one provider do not wait on each other's batch). Today: it did not. A provider
// that keeps the network it detected (staticNetwork) reads "looks fixed" (D-08). After the marker:
// the reads answered while held, the held quote's batch carrying the eth_chainId the node only
// reached at the release, and the evaluation finishing right after it.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { FunctionFragment } from 'ethers';
import type { HoldHandle } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue } from '../harness/world';
import { GET_AMOUNTS_OUT, buyAndMine, buyRow, listen, opEntries, opLogged, waitAntiRugArmed } from './fixtures/AUD-EXIT-002-position';
import { pullLiquidity } from './fixtures/AUD-EXIT-014-rug';

const GET_RESERVES = FunctionFragment.from('getReserves()').selector;
const TOTAL_SUPPLY = FunctionFragment.from('totalSupply()').selector;

describe('AUD-TX-028: one stalled HTTP call stalls every later call of the provider', () => {
    it('stalled-call-stalls-antirug-evaluation: while one exit quote is held, the anti-rug evaluation of a liquidity pull gets its reads answered but cannot finish', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node } = sc;
        await listen(sc);
        await buyAndMine(sc);
        await waitAntiRugArmed(sc);
        expect(opLogged('exit.monitor.started')).toBe(true);
        const tradeId = buyRow(sc)!.id;
        expect(sc.graph.detector.getRegisteredPositions('eth').map((p) => p.tradeId)).toEqual([tradeId]);

        // The next exit quote is held (only the first such call).
        let held: HoldHandle | undefined;
        held = node.hold('eth_call', { selector: GET_AMOUNTS_OUT, to: sc.dex.routerAddress, after: () => (held?.heldCount ?? 0) === 0 });
        await stepUntilTrue(() => held!.parkedNow === 1, { what: 'the next exit-poll quote being held', maxSteps: 1_000 });
        const heldSeq = node.callLog.filter((c) => c.selector === GET_AMOUNTS_OUT).at(-1)!.seq;

        // The liquidity pull, and the detector's reads of the pair.
        const pull = await pullLiquidity(sc, { removeBps: 9_500n });
        const fromCall = node.callLog.length;
        const fromLog = recordedLogs().length;
        const pairReads = (): Array<{ seq: number; selector: string | undefined }> =>
            node.callLog.slice(fromCall).filter((c) => c.method === 'eth_call' && c.to === sc.pair.toLowerCase() && (c.selector === GET_RESERVES || c.selector === TOTAL_SUPPLY));
        await stepUntilTrue(() => pairReads().some((c) => c.selector === GET_RESERVES) && pairReads().some((c) => c.selector === TOTAL_SUPPLY), { what: "the detector's reads of the pair", maxSteps: 2_000 });
        // Two more seconds of chain time, still short of the next poll tick.
        await stepFor(2_000);
        expect(held!.parkedNow).toBe(1);
        const finishedWhileHeld = opLogged('antirug.confirm-gate.scheduled', fromLog);

        knownBug(ctx, 'AUD-TX-028', {
            claim: 'stalled-call-stalls-antirug-evaluation',
            correct: { antiRugEvaluationFinishedWhileQuoteHeld: true },
            observed: { antiRugEvaluationFinishedWhileQuoteHeld: false },
            actual: { antiRugEvaluationFinishedWhileQuoteHeld: finishedWhileHeld },
            expectedPlain: 'One slow RPC call does not hold up the bot\'s other calls: the anti-rug check of a liquidity pull finishes while an unrelated price quote is still pending.',
            actualPlain: 'While one exit price quote was stalled, the anti-rug check of a 95 percent liquidity pull got its answers from the node but could not finish: every call of the provider waited on the network check sent with the stalled quote.',
        });
        // The node answered the detector's reads while the quote was held: none was parked.
        expect(held!.heldCount).toBe(1);
        expect(pairReads().length).toBeGreaterThanOrEqual(2);
        expect(opEntries('antirug.evaluator.v2-error', fromLog)).toEqual([]);
        // No eth_chainId reached the node after the held quote: it waits behind it in the batch.
        expect(node.callLog.filter((c) => c.seq > heldSeq && c.method === 'eth_chainId')).toEqual([]);

        // Released: the node answers the batch's eth_chainId, and the evaluation finishes.
        held!.release();
        await stepUntilTrue(() => opLogged('antirug.confirm-gate.scheduled', fromLog), { what: 'the anti-rug evaluation finishing', maxSteps: 2_000 });
        const chainIdAfter = node.callLog.find((c) => c.seq > heldSeq && c.method === 'eth_chainId');
        expect(chainIdAfter).toBeDefined();
        const scheduled = recordedLogs().slice(fromLog).find((l) => l.obj?.op === 'antirug.confirm-gate.scheduled')!;
        expect(chainIdAfter!.seq).toBeLessThan(scheduled.seq);
        expect(scheduled.obj?.tradeId).toBe(tradeId);
        expect(node.isMined(pull.hash)).toBe(true);
    });
});
