// test/realpath/triage/AUD-TX-003.test.ts
// Phase 23 plan 23-09 Task 2 (AUDIT-02, AC-12, SPEC nonce constraint): RC-11 head-of-line
// blocking. src/bot.ts submitBuyTx = withNonceLock(wallet, () => sendTxWithRetry(...)) holds the
// wallet lock through every private attempt of a snipe buy (each a Flashbots bundle, its wait for
// the first target block, the stats call and the 45 s confirm window), until the escalation ends.
//
// Re-triaged on the realistic chain (Phase 23 review WR-01, operator ruling 2026-11-13): the relay
// now simulates the buy as a real one does, so once the buy's own 60 s deadline (src/bot.ts:1045,
// fixed when the swap is built) has passed, the next attempt's eth_callBundle answers
// "UniswapV2Router: EXPIRED" and the escalation ends there with "Flashbots simulate: tx would
// revert". It does not run the 4 attempts the finding first assumed. Measured here: B's first
// attempt is sent at once, its second about 52 s later, and the third attempt's simulation is
// refused about 105 s after the first submission, which is when B fails clean and lets the lock
// go. The anti-rug exit is dispatched about 8 s into B's escalation, so it still waits behind the
// buy for longer than its 60 s budget. The bug still holds; its lock hold is about 1.75 minutes,
// not about 4. The lock is strictly first-in first-out (src/utils/nonceAuthority.ts): no priority lane
// and no abort. An anti-rug exit of ANOTHER position on the same wallet (src/anti-rug/exitTrigger.ts
// triggerAntiRugExit -> executeFullSell(..., 'anti-rug') under withTimeout(WATCHDOG_BUDGET_MS,
// default 60000)) needs that lock for its approval (src/exitEngine.ts executeFullSell,
// withNonceLock(wallet, () => ensureApproval(...))), so it cannot start, the budget frees the
// caller at 60 s (antirug.exit.bounded-abort), and the abandoned executeFullSell stays queued and
// runs later, when the buy lets go.
//
// Proof on the real path, the order forced exactly (AC-12: every wait is a step of fake time, a
// mined block or a stepUntilTrue; nothing is held, so the bot's HTTP provider never stalls,
// AUD-TX-028). On one simulated ETH chain and one wallet:
//   1. Position A: a real uniswap-v2 snipe with anti-rug live (ETH_ANTIRUG_LIVE_EXECUTE=true),
//      bought, armed (exit monitor and anti-rug) and given the sell side of the chain
//      (fixtures/AUD-API-001-dashboard-sell.ts heldPosition).
//   2. 31 s later (past the 30 s snipe cooldown), token B launches on sushiswap-v2
//      (fixtures/AUD-TX-003-second-launch.ts) and the bot's real sushiswap listener snipes it. B's
//      bundles are never included: each gets its 12 s slot and an empty block
//      (fixtures/AUD-TX-002-lock.ts missBundlesUntil). The buy now holds the wallet lock.
//   3. Right after one of A's exit-monitor polls (a fixed 5 s interval), the deployer pulls 95
//      percent of A's liquidity through the real router (fixtures/AUD-EXIT-014-rug.ts); the real
//      detector evaluates the rug, schedules its one-block confirm gate, the next block is mined,
//      and it dispatches the anti-rug exit, which clears A's timers, so no routine stop-loss exit
//      of A can take A's sell lock first (asserted after the marker).
//
// What is measured, from the `at` field (fake-clock ms) of the timeline's op and submit entries
// (plan 23-02): whether A's emergency sell started (an approve or sell of A from the wallet, or its
// exit.full.submitted line) within the 60 s budget after antirug.exit.dispatch. Correct: it starts
// within its budget (card OD-17: a priority lane for anti-rug exits, an abortable buy escalation,
// or releasing the lock between attempts). Today: it does not; antirug.exit.bounded-abort is
// logged exactly 60 000 fake ms after the dispatch, while B's escalation still holds the lock. A
// fix-shaped in-memory mutant that lets the anti-rug approval skip the queue reads "looks fixed"
// (D-08); a wrong fix that gives only the anti-rug private SELL a priority lane (the approval still
// queues) records the bug unchanged. After the marker: the abort's elapsed time, B still
// escalating at the abort, then B's buy failing clean once the relay refuses its expired third
// attempt (lock held about 105 s) and only then A's abandoned exit sending its approval, and
// selling the remains.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Transaction, getAddress } from 'ethers';
import type { OpEntry, SubmitEntry } from '../harness/capture';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, type Scenario } from '../harness/world';
import { driveChain, heldPosition } from './fixtures/AUD-API-001-dashboard-sell';
import { ERC20, buyRow, exitQuotes, opLogged, subscribedTo } from './fixtures/AUD-EXIT-002-position';
import { decodeSellRaw, sellRouterOf, sellsSubmitted } from './fixtures/AUD-EXIT-001-sell-path';
import { pullLiquidity } from './fixtures/AUD-EXIT-014-rug';
import { missBundlesUntil } from './fixtures/AUD-TX-002-lock';
import { secondLaunch } from './fixtures/AUD-TX-003-second-launch';

const BUDGET_MS = 60_000;
const APPROVE = ERC20.getFunction('approve')!.selector;
const B_SWAP = new Interface(['function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)']);

function opsAt(sc: Scenario, op: string, from = 0): OpEntry[] {
    return sc.timeline.entries.slice(from).filter((e): e is OpEntry => e.kind === 'op' && e.op === op);
}

function submitsAt(sc: Scenario, from = 0): SubmitEntry[] {
    return sc.timeline.entries.slice(from).filter((e): e is SubmitEntry => e.kind === 'submit');
}

describe('AUD-TX-003: a snipe buy holds the wallet nonce lock through its private attempts, so an anti-rug exit of another position cannot start (RC-11)', () => {
    // Own time limit: about 6 minutes of fake time are stepped. Measured on Node 22.16.0: 1.8 s alone
    // and 6.2 s in the full parallel `npm test` run, above 40 percent of the 15 s default (before
    // the submission classifier was cached it took 9 s alone and timed out at 15 s in the full run).
    it('antirug-exit-queued-behind-buy: a rug of position A while a snipe of token B escalates privately gets an emergency sell that does not start within its 60 s budget and runs only after the buy lets go', { timeout: 30_000 }, async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { ETH_ANTIRUG_LIVE_EXECUTE: 'true' } });
        const { node } = sc;
        expect(sc.ctx.chain.antiRug.liveExecute).toBe(true);
        const b = secondLaunch(sc);

        // 1. Position A, bought and armed.
        const pos = await heldPosition(sc);
        expect(sc.graph.detector.getRegisteredPositions('eth').map((p) => p.tradeId)).toEqual([pos.tradeId]);

        // 2. Token B launches 31 s later (past the 30 s cooldown) and the bot snipes it; its bundles miss.
        await sc.graph.bot.startDexListener(sc.ctx, b.dex, sc.registry);
        await stepUntilTrue(() => subscribedTo(sc, b.dex.factoryAddress), { what: 'the sushiswap listener subscribing to PairCreated' });
        await stepFor(31_000, 100);
        const bRouter = getAddress(b.dex.routerAddress);
        const bBuys = (): string[] => node.submitted.filter((s) => s.route === 'bundle' && s.tx.to !== null && getAddress(s.tx.to) === bRouter).map((s) => s.hash);
        await b.fire();
        await missBundlesUntil(sc, { until: () => bBuys().length === 1, what: "B's first private buy attempt", maxVirtualMs: 60_000 });
        const bFirstSubmit = submitsAt(sc).find((e) => e.hash === bBuys()[0])!;

        // 3. Right after one of A's exit polls, the rug; the confirm block; the anti-rug dispatch.
        const quotesBefore = exitQuotes(sc).length;
        await missBundlesUntil(sc, { until: () => exitQuotes(sc).length > quotesBefore, what: "one of A's exit-monitor polls", maxVirtualMs: 10_000 });
        const fromLog = recordedLogs().length;
        const fromEntry = sc.timeline.entries.length;
        await pullLiquidity(sc, { removeBps: 9_500n });
        await stepUntilTrue(() => opLogged('antirug.confirm-gate.scheduled', fromLog), { what: 'the anti-rug confirm gate being scheduled', maxSteps: 2_000 });
        node.mine({ include: [] });
        await stepUntilTrue(() => opLogged('antirug.exit.dispatch', fromLog), { what: 'the anti-rug exit being dispatched', maxSteps: 2_000 });
        const dispatch = opsAt(sc, 'antirug.exit.dispatch', fromEntry)[0];
        expect(dispatch.fields.tradeId).toBe(pos.tradeId);

        // A's emergency sell has started once the wallet sends an approve or sell of A, or logs it.
        // Each submission is classified once (a Transaction recovers its sender on every read of
        // `from`, too slow to repeat at every 50 ms step); the timeline entry already carries the
        // sender and target, and the raw transaction is decoded with real ethers.
        const isAExit = new Map<string, boolean>();
        const classify = (e: SubmitEntry): boolean => {
            let v = isAExit.get(e.hash);
            if (v === undefined) {
                const fromWallet = e.from === getAddress(sc.wallet.address);
                const approveOfA = e.to === getAddress(sc.token) && Transaction.from(e.raw).data.startsWith(APPROVE);
                v = fromWallet && (approveOfA || decodeSellRaw(e.raw, sellRouterOf(sc), sc.token) !== null);
                isAExit.set(e.hash, v);
            }
            return v;
        };
        const aStarts = (): number[] => [
            ...submitsAt(sc, fromEntry)
                .filter(classify)
                .map((e) => e.at),
            ...opsAt(sc, 'exit.full.submitted', fromEntry).filter((e) => e.fields.reason === 'anti-rug').map((e) => e.at),
        ];
        await missBundlesUntil(sc, { until: () => aStarts().length > 0 || opLogged('antirug.exit.bounded-abort', fromLog), what: "A's emergency sell starting or its budget running out", maxVirtualMs: BUDGET_MS + 10_000 });
        const startedInBudget = aStarts().some((at) => at - dispatch.at <= BUDGET_MS);

        knownBug(ctx, 'AUD-TX-003', {
            claim: 'antirug-exit-queued-behind-buy',
            correct: { emergencySellStartedWithinBudget: true },
            observed: { emergencySellStartedWithinBudget: false },
            actual: { emergencySellStartedWithinBudget: startedInBudget },
            expectedPlain: 'An anti-rug emergency sell of one position starts within its time budget even while a snipe of another token is still trying to land on the same wallet.',
            actualPlain: 'While a snipe of token B held the wallet lock through its private attempts (about 105 s: two attempts, then the relay refused the third once the buy deadline had passed), the anti-rug exit of position A could not send anything: it gave up after its 60 s budget and stayed queued behind the buy.',
        });

        // The abort, from the timeline: exactly the budget after the dispatch, while B still escalates.
        const abort = opsAt(sc, 'antirug.exit.bounded-abort', fromEntry);
        expect(abort).toHaveLength(1);
        expect(abort[0].fields.budgetMs).toBe(BUDGET_MS);
        expect(abort[0].at - dispatch.at).toBe(BUDGET_MS);
        expect(aStarts()).toEqual([]);
        expect(opLogged('buy.snipe.fail-clean')).toBe(false);
        expect(bBuys().length).toBeGreaterThanOrEqual(2);
        // No routine exit of A ran before the anti-rug dispatch or took A's sell lock from it. The
        // first anti-rug exit took the lock and is the one that timed out; the pull's other pair
        // logs each dispatched again at the same fake time (how many is AUD-ANTIRUG-003's claim,
        // not asserted here), and each of those was refused by that held sell lock, for reason
        // anti-rug, at once.
        expect(opsAt(sc, 'exit.full.submitted')).toEqual([]);
        const dispatches = opsAt(sc, 'antirug.exit.dispatch', fromEntry);
        expect(dispatches.every((d) => d.at === dispatch.at && d.fields.tradeId === pos.tradeId)).toBe(true);
        const refusals = recordedLogs()
            .slice(fromLog)
            .filter((l) => l.msg === 'Another exit already handling token, skipping');
        expect(refusals).toHaveLength(dispatches.length - 1);
        expect(refusals.every((l) => l.obj?.reason === 'anti-rug' && l.obj?.token === sc.token)).toBe(true);
        const lockFree = sc.graph.exitManager.tryAcquireSellLock('eth', sc.token);
        if (lockFree) sc.graph.exitManager.releaseSellLock('eth', sc.token);
        expect(lockFree).toBe(false);

        // B's buy keeps the lock through its second attempt; the relay refuses the third, past the
        // buy's own 60 s deadline, and B fails clean; only then does A's abandoned exit send its
        // approval.
        await missBundlesUntil(sc, { until: () => opLogged('buy.snipe.fail-clean'), what: "B's buy failing clean", maxVirtualMs: 400_000 });
        const failClean = opsAt(sc, 'buy.snipe.fail-clean')[0];
        expect(new Set(bBuys().map((h) => node.submitted.find((s) => s.hash === h)!.tx.nonce)).size).toBe(1);
        expect(bBuys()).toHaveLength(2);
        const refused = opsAt(sc, 'flashbots.simulate.revert', fromEntry);
        expect(refused.map((e) => e.fields.attempt)).toEqual([2]);
        expect(refused[0].at).toBe(failClean.at);
        expect(String(failClean.fields.reason)).toBe('Flashbots simulate: tx would revert (execution reverted)');
        // The cause: the swap's own deadline, decoded from B's signed bundle transaction with real
        // ethers, had passed when the relay simulated the third attempt.
        const bDeadlines = bBuys().map((h) => B_SWAP.decodeFunctionData('swapExactETHForTokens', node.submitted.find((s) => s.hash === h)!.tx.data)[3] as bigint);
        expect(new Set(bDeadlines.map(String)).size).toBe(1);
        expect(bDeadlines[0]).toBeLessThan(BigInt(Math.floor(refused[0].at / 1000)));
        expect(bDeadlines[0]).toBeGreaterThanOrEqual(BigInt(Math.floor(opsAt(sc, 'mev.reconcile.not-landed', fromEntry)[0].at / 1000)));
        // The lock hold: from B's first submission to its fail-clean, past the 60 s deadline.
        expect(failClean.at - bFirstSubmit.at).toBeGreaterThan(90_000);
        expect(failClean.at - bFirstSubmit.at).toBeLessThan(120_000);
        await stepUntilTrue(() => aStarts().length > 0, { what: "A's abandoned exit sending its approval", maxSteps: 20_000 });
        expect(Math.min(...aStarts())).toBeGreaterThanOrEqual(failClean.at);
        expect(Math.min(...aStarts()) - dispatch.at).toBeGreaterThan(BUDGET_MS + 30_000);
        // It then sells the remains of A (one quick private attempt), long after the rug.
        await driveChain(sc, { mode: 'land', until: () => buyRow(sc)!.status === 'sold', what: "A's abandoned exit selling" });
        expect(sellsSubmitted(sc).length).toBeGreaterThanOrEqual(1);
    });
});
