// test/realpath/triage/AUD-TX-029.test.ts
// Phase 23 plan 23-09 (AUDIT-02): AUD-TX-029, registered by the 23-09 executor under the
// operator's standing instruction of 2026-11-11 (found while diagnosing the warn/error lines of
// AUD-TX-003's run). src/utils/mevStrategies/reconciliation.ts submitWithReconciliation ends a
// not-landed escalation with one branch, `if (ceilingHit || attempt >= cfg.maxRetries)`, and that
// branch always logs op mev.escalation.ceiling-hit and throws "MEV bundle not included after N
// attempt(s); priority-fee ceiling (<ceiling> wei) reached. Increase MEV_MAX_PRIORITY_FEE_GWEI
// ...", whichever cause ended the loop. When the attempt budget runs out first, the ceiling was
// not reached: the escalated fee is step x (attempt + 1), against a 25 gwei ceiling.
//
// Re-triaged on the realistic chain (Phase 23 review WR-01, operator ruling 2026-11-13). The relay
// now simulates as a real one does, so an attempt made after the swap's own deadline (fixed at
// build time: src/bot.ts:1045 for a snipe, src/exitEngine.ts:364 for a V2 sell, both now + 60 s)
// is refused by eth_callBundle ("UniswapV2Router: EXPIRED") and the escalation ends there with
// "Flashbots simulate: tx would revert". Measured:
//   - The first claim, a snipe whose FOUR attempts all miss (claim
//     attempt-budget-reported-as-ceiling-hit), does not happen at default settings: each attempt
//     takes about 52 to 64 s (target block, stats, 45 s confirm window), so the snipe's second or
//     third attempt is already past its deadline, the relay refuses it, and the snipe fails clean
//     with "Flashbots simulate: tx would revert (execution reverted)" after one or two bundles. No
//     mev.escalation.ceiling-hit line is logged. That claim is retired here; see the fix report's
//     proposal for the register.
//   - The misreport itself still happens, on the two-attempt private legs: a routine private sell
//     (MEV_SELL_FALLBACK_ATTEMPTS, default 2) whose first attempt ends before the sell's 60 s
//     deadline, so its second attempt is simulated, sent and missed inside the deadline. The
//     budget then ends the loop and the bot reports the 25 gwei ceiling as reached at a 2 gwei
//     bid. That is the claim below (new name: sell-attempt-budget-reported-as-ceiling-hit).
//
// Proof on the real path: a real ETH V2 position, bought and armed (fixtures/AUD-API-001-dashboard-
// sell.ts heldPosition), falls 41 percent when another trader dumps (fixtures/AUD-EXIT-001-sell-
// path.ts foreignTrade), and the real stop-loss escalates privately. The router's sell read below
// is the realistic one for this leg: it reverts "UniswapV2Router: EXPIRED" past the swap's deadline
// (the scenario's default router has no sell read, so it would never refuse an expired sell). No
// bundle is ever included, and each target block arrives 2 s after the bundle was first sent
// (a block early in its slot, which is what lets the first attempt end inside the deadline; with a
// block 12 s after the bundle the first attempt ends at about 64 s and the second is refused as
// expired, as for the snipe). The fees bid are read from the signed bundle transactions with real
// ethers; the deadline from the signed swap.
//
// What is measured: whether the bot reported the ceiling as reached (an error line whose message
// or reason says "ceiling ... reached") while the highest priority fee it submitted on that leg
// was below that ceiling. Correct: no. Today: yes. In-memory mutants (fix report): a separate
// attempt-budget message reads "looks fixed"; the same message given only for a snipe-sized budget
// (attempt >= 3) does not.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it, vi } from 'vitest';
import { Interface, Transaction, getAddress } from 'ethers';
import { encodeResult, revertReason, type Submitted } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, v2AmountOut, type Scenario } from '../harness/world';
import { driveChain, heldPosition } from './fixtures/AUD-API-001-dashboard-sell';
import { decodeSellRaw, foreignTrade, sellRouterOf } from './fixtures/AUD-EXIT-001-sell-path';
import { buyRow, opEntries, opLogged } from './fixtures/AUD-EXIT-002-position';

const CEILING_REACHED = /ceiling[^.]*reached/i;
const V2_SELL = new Interface(['function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)']);

/** The router's answer to the V2 sell, simulated or mined: the path, the deadline and the minimum output, as a router checks them. */
function installSellDeadline(sc: Scenario<'v2'>): void {
    const { node, token, weth, reserves } = sc;
    node.setRead(sc.dex.routerAddress, 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)', ({ args }) => {
        const [amountIn, minOut, path, , deadline] = args as unknown as [bigint, bigint, string[], string, bigint];
        if (path.length !== 2 || getAddress(path[0]) !== getAddress(token) || getAddress(path[1]) !== getAddress(weth)) return revertReason('UniswapV2Router: INVALID_PATH');
        if (deadline < BigInt(Math.floor(Date.now() / 1000))) return revertReason('UniswapV2Router: EXPIRED');
        const out = v2AmountOut(amountIn, reserves.token, reserves.weth);
        if (out < minOut) return revertReason('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
        return encodeResult(['uint256[]'], [[amountIn, out]]);
    });
}

/**
 * Step the fake clock 50 ms at a time until `until()` holds. Each of the wallet's bundle
 * transactions gets its first block `blockAfterMs` after it was first seen, then one every 12 s
 * (its later target blocks), none of which holds it; the
 * wallet's public transactions (the approval) are mined in the next block, as driveChain does.
 */
async function missBundlesEarly(sc: Scenario, opts: { until: () => boolean; blockAfterMs: number; what: string; maxVirtualMs: number }): Promise<void> {
    const wallet = sc.wallet.address.toLowerCase();
    const seen = new Map<string, number>();
    const sender = new WeakMap<Submitted, string>();
    const from = (s: Submitted): string => {
        let f = sender.get(s);
        if (f === undefined) {
            f = (s.tx.from ?? '').toLowerCase();
            sender.set(s, f);
        }
        return f;
    };
    const end = Date.now() + opts.maxVirtualMs;
    while (!opts.until()) {
        if (Date.now() >= end) throw new Error(`missBundlesEarly: ${opts.what} did not happen within ${opts.maxVirtualMs} virtual ms`);
        await vi.advanceTimersByTimeAsync(50);
        const publicTxs = sc.node.submitted.filter((s) => s.route === 'public' && s.status === 'accepted' && from(s) === wallet).map((s) => s.hash);
        if (publicTxs.length > 0) sc.node.mine({ include: publicTxs });
        const bundled = sc.node.submitted.filter((s) => s.route === 'bundle' && s.status === 'accepted' && from(s) === wallet);
        for (const s of bundled) if (!seen.has(s.hash)) seen.set(s.hash, Date.now());
        const due = bundled.filter((s) => Date.now() - seen.get(s.hash)! >= opts.blockAfterMs);
        if (due.length === 0) continue;
        sc.node.mine({ include: [] });
        // The next block for each of them comes one slot later.
        for (const s of due) seen.set(s.hash, Date.now() + 12_000 - opts.blockAfterMs);
    }
}

describe('AUD-TX-029: an escalation that ends on its attempt budget is reported as a priority-fee ceiling hit', () => {
    it('sell-attempt-budget-reported-as-ceiling-hit: a stop-loss whose two private sell attempts both miss inside the sell deadline, at 1 and 2 gwei, is reported as having reached the 25 gwei ceiling', { timeout: 30_000 }, async (ctx) => {
        const sc = (await createScenario({ chain: 'eth', dexType: 'v2' })) as Scenario<'v2'>;
        const { node } = sc;
        await heldPosition(sc);
        installSellDeadline(sc);
        const fromLog = recordedLogs().length;
        const fromSubmit = node.submitted.length;
        await foreignTrade(sc, { sellTokens: (sc.reserves.token * 3n) / 10n });
        await missBundlesEarly(sc, { until: () => opLogged('exit.private.not-landed', fromLog), blockAfterMs: 2_000, what: "the stop-loss's private leg ending", maxVirtualMs: 200_000 });

        const router = sellRouterOf(sc);
        const sells = node.submitted.slice(fromSubmit).filter((s) => s.route === 'bundle' && decodeSellRaw(s.raw, router, sc.token) !== null);
        const fees = sells.map((s) => Transaction.from(s.raw).maxPriorityFeePerGas!);
        const highestFee = fees.reduce((m, f) => (f > m ? f : m), 0n);
        // The ceiling from the bot's own reconcile config (the graph's module instance).
        const { buildReconcileConfig } = await import('../../../src/utils/mevStrategies/reconciliation');
        const ceilingWei = buildReconcileConfig(process.env, sc.ctx.chain.gas.maxGasLimit).maxPriorityFeeCeilingWei;
        const lines = recordedLogs().slice(fromLog);
        const claimsReached = lines.some((l) => (l.level === 'error' || l.level === 'warn') && (CEILING_REACHED.test(l.msg ?? '') || CEILING_REACHED.test(String(l.obj?.reason ?? ''))));

        knownBug(ctx, 'AUD-TX-029', {
            claim: 'sell-attempt-budget-reported-as-ceiling-hit',
            correct: { reportedCeilingReachedBelowCeiling: false },
            observed: { reportedCeilingReachedBelowCeiling: true },
            actual: { reportedCeilingReachedBelowCeiling: claimsReached && highestFee < ceilingWei },
            expectedPlain: 'A private sell that runs out of its two attempts while its fee is still below the ceiling is reported as having used up its attempts, not as having reached the fee ceiling.',
            actualPlain: 'The stop-loss sell missed with both of its private attempts, at 1 and 2 gwei and inside its 60 s deadline, yet the bot logged mev.escalation.ceiling-hit and reported that the 25 gwei priority-fee ceiling was reached and should be raised.',
        });

        // The two attempts, decoded with real ethers: one nonce, fees one step apart, far below the ceiling.
        expect(fees).toEqual([1_000_000_000n, 2_000_000_000n]);
        expect(new Set(sells.map((s) => s.tx.nonce)).size).toBe(1);
        expect(ceilingWei).toBe(25_000_000_000n);
        // Both were sent inside the swap's own deadline (decoded from the signed sell): the relay
        // simulated and accepted the second one, so it was the budget, not the deadline, that ended the leg.
        const deadline = V2_SELL.decodeFunctionData('swapExactTokensForETH', sells[0].tx.data)[4] as bigint;
        expect(sells.every((s) => V2_SELL.decodeFunctionData('swapExactTokensForETH', s.tx.data)[4] === deadline)).toBe(true);
        const secondSent = sc.timeline.entries.find((e) => e.kind === 'submit' && e.hash === sells[1].hash)!;
        expect(BigInt(Math.floor(secondSent.at / 1000))).toBeLessThanOrEqual(deadline);
        expect(opEntries('flashbots.simulate.revert', fromLog)).toEqual([]);
        // The report: the ceiling-hit line on the last attempt, with the ceiling text.
        const ceilingLines = opEntries('mev.escalation.ceiling-hit', fromLog);
        expect(ceilingLines).toHaveLength(1);
        expect(ceilingLines[0].attempt).toBe(1);
        expect(ceilingLines[0].ceilingWei).toBe(ceilingWei.toString());
        expect(lines.find((l) => l.obj?.op === 'mev.escalation.ceiling-hit')?.msg).toBe('MEV bundle not included after 2 attempt(s); priority-fee ceiling (25000000000 wei) reached. Increase MEV_MAX_PRIORITY_FEE_GWEI (within affordability) or resubmit manually.');
        expect(opEntries('exit.trigger.stop-loss', fromLog).length).toBeGreaterThanOrEqual(1);

        // Let the exit finish on the public fallback, so nothing is left in flight at teardown.
        await driveChain(sc, { mode: 'land', until: () => buyRow(sc)?.status === 'sold', what: 'the stop-loss selling on the public fallback' });
        expect(opEntries('exit.fallback.public.submit', fromLog)).toHaveLength(1);
    });
});
