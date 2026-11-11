// test/realpath/triage/AUD-EXIT-004.test.ts
// Phase 23 plan 23-07 Task 3 (AUDIT-02, RC-15): AUD-EXIT-004. Sell approvals go to the public
// mempool with ethers' default fees, outside the sell fee ceiling, and are for the exact amount,
// so each exit first needs a public approve before its private sell.
//
// The sites (src/exitEngine.ts): ensureApproval reads allowance and calls token.approve(spender,
// amount) through the wallet, then waits for it to be mined ("Approval does not need MEV
// protection -- sent directly"). executeFullSell and executePartialSell call it with exactly the
// amount being sold, before the private sell. A contract call through the wallet with no fee
// fields takes them from provider.getFeeData() (ethers abstract-signer populateTransaction):
// maxPriorityFeePerGas = the node's suggestion, maxFeePerGas = 2 x base fee + that suggestion. The
// sell-leg ceiling MEV_SELL_MAX_PRIORITY_FEE_GWEI (25 in the test env) is applied only inside the
// private escalation.
//
// Proof on the real path: a real ETH V2 snipe is bought and armed (PARTIAL_SELL_TARGETS 2x:25).
// The node's priority fee suggestion then rises to 50 gwei, as during a busy launch. Another
// wallet buys with half the pool's ETH (price about 2.25x), the 2x tier fires and executePartialSell
// sells a quarter of the position; later another wallet dumps half the pool's tokens (price down
// about 56 percent from the peak) and the trailing stop sells the rest through executeFullSell.
// The chain answers as fixtures/AUD-EXIT-001-sell-path.ts describes (allowance from mined
// approves and sells). Every approve and sell is decoded with real ethers from node.submitted.
//
// What is measured (each on the bot's own transactions, in the order the node received them):
//   - approve-sent-public-before-private-sell: an approve went to the public mempool before the
//     private sell. Correct: none (approve at buy time, or inside the private bundle).
//   - approve-fees-outside-sell-ceiling: that approve's priority fee is above the sell-leg
//     ceiling. Correct: no exit transaction outside the ceiling.
//   - second-exit-needs-new-public-approve: the next exit of the same position sent another public
//     approve, because the first was for exactly the amount sold. Correct: no second approve.
// Each measure reads "looks fixed" under its own fix shape (D-08); the details (spender, exact
// amounts, the fee fields equal to the provider's defaults, route) are asserted after the markers.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { getAddress, parseUnits } from 'ethers';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepUntilTrue, v2AmountOut } from '../harness/world';
import { recordedLogs } from '../harness/capture';
import { buyAndMine, buyRow, listen, opEntries, opLogged, waitAntiRugArmed } from './fixtures/AUD-EXIT-002-position';
import { foreignTrade, installSellPath, landNextSell } from './fixtures/AUD-EXIT-001-sell-path';

const GWEI = 1_000_000_000n;

describe('AUD-EXIT-004: sell approvals go public with default fees, outside the sell ceiling, one per exit (RC-15)', () => {
    it('approve-sent-public-before-private-sell: each exit first sends an exact-amount approve to the public mempool at the provider default fee, above the sell ceiling', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { PARTIAL_SELL_TARGETS: '2x:25' } });
        const { node } = sc;
        const sellCeiling = parseUnits(String(process.env.MEV_SELL_MAX_PRIORITY_FEE_GWEI), 'gwei');
        expect(sellCeiling).toBe(25n * GWEI);
        const index = (hash: string): number => node.submitted.findIndex((s) => s.hash === hash);

        await listen(sc);
        const { buy } = await buyAndMine(sc);
        await waitAntiRugArmed(sc);
        expect(opLogged('exit.monitor.started')).toBe(true);
        const bought = v2AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token);
        installSellPath(sc, { bought });
        // A busy launch: the node now suggests a 50 gwei priority fee.
        node.setFees({ maxPriorityFeePerGas: 50n * GWEI });

        // Exit 1: the 2x take-profit tier.
        const fromLog = recordedLogs().length;
        const from1 = node.submitted.length;
        await foreignTrade(sc, { buyEth: sc.reserves.weth / 2n });
        const first = await landNextSell(sc, { fromSubmit: from1 });
        // Setup facts, true under the bug and every fix: the private partial sell of a quarter.
        expect(first.sell).toEqual(expect.objectContaining({ route: 'bundle', call: 'swapExactTokensForETH', amountIn: (bought * 25n) / 100n }));
        const publicBefore1 = first.approvals.filter((a) => a.route === 'public' && index(a.hash) < index(first.sell.hash));

        knownBug(ctx, 'AUD-EXIT-004', {
            claim: 'approve-sent-public-before-private-sell',
            correct: { publicApproveBeforePrivateSell: false },
            observed: { publicApproveBeforePrivateSell: true },
            actual: { publicApproveBeforePrivateSell: publicBefore1.length > 0 },
            expectedPlain: 'Before a private sell the bot sends no public transaction that announces it: the approval is done at buy time or travels inside the private bundle.',
            actualPlain: 'Before its private take-profit sell the bot first sent an approve of the token to the router through the public mempool and waited for it to be mined.',
        });
        knownBug(ctx, 'AUD-EXIT-004', {
            claim: 'approve-fees-outside-sell-ceiling',
            correct: { approvePriorityAboveSellCeiling: false },
            observed: { approvePriorityAboveSellCeiling: true },
            actual: { approvePriorityAboveSellCeiling: first.approvals.some((a) => a.route === 'public' && (a.maxPriorityFeePerGas ?? a.gasPrice ?? 0n) > sellCeiling) },
            expectedPlain: 'Every transaction of an exit, the approval included, stays inside the configured sell fee ceiling (25 gwei priority here).',
            actualPlain: 'The approve paid the node\'s 50 gwei priority suggestion, twice the 25 gwei sell ceiling, because it takes ethers\' default fees.',
        });
        // Details: one approve, to the router, at the provider's default fees (2 x the 10 gwei base
        // fee + the 50 gwei suggestion), mined before the private sell was sent.
        expect(publicBefore1).toEqual([
            expect.objectContaining({ spender: getAddress(sc.dex.routerAddress), type: 2, maxPriorityFeePerGas: 50n * GWEI, maxFeePerGas: 2n * 10n * GWEI + 50n * GWEI }),
        ]);
        expect(node.statusOf(publicBefore1[0].hash)).toBe('mined');
        await stepUntilTrue(() => opLogged('exit.partial.executed', fromLog), { what: 'the partial sell confirming', maxSteps: 20_000 });

        // Exit 2: the trailing stop after another wallet dumps half the pool's tokens.
        const from2 = node.submitted.length;
        await foreignTrade(sc, { sellTokens: sc.reserves.token / 2n });
        const second = await landNextSell(sc, { fromSubmit: from2 });
        expect(second.sell).toEqual(expect.objectContaining({ route: 'bundle', call: 'swapExactTokensForETH', amountIn: bought - (bought * 25n) / 100n }));

        knownBug(ctx, 'AUD-EXIT-004', {
            claim: 'second-exit-needs-new-public-approve',
            correct: { secondExitSentPublicApprove: false },
            observed: { secondExitSentPublicApprove: true },
            actual: { secondExitSentPublicApprove: second.approvals.some((a) => a.route === 'public') },
            expectedPlain: 'A position needs at most one approval for all its exits.',
            actualPlain: 'The first approve covered exactly the quarter sold, so the trailing-stop exit of the rest had to send a second public approve first.',
        });
        // Details: each approve was for exactly the amount its exit sold.
        expect(publicBefore1[0].amount).toBe((bought * 25n) / 100n);
        expect(second.approvals).toEqual([expect.objectContaining({ route: 'public', spender: getAddress(sc.dex.routerAddress), amount: bought - (bought * 25n) / 100n, maxPriorityFeePerGas: 50n * GWEI })]);
        expect(opEntries('exit.trigger.trailing-stop', fromLog).length).toBeGreaterThanOrEqual(1);
        await stepUntilTrue(() => buyRow(sc)!.status === 'sold', { what: 'the position closing', maxSteps: 20_000 });
    });
});
