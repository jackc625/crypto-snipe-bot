// test/realpath/triage/AUD-EXIT-001.test.ts
// Phase 23 plan 23-07 Task 3 (AUDIT-02, RC-03): AUD-EXIT-001, private (MEV-routed) sells accept any
// output: amountOutMin is 0 on V2 and amountOutMinimum is 0 on V3, for full and partial sells.
//
// The sites (src/exitEngine.ts): buildV2SellTx encodes swapExactTokensForETH(amount, 0, path,
// wallet, deadline); buildV3SellTx sets amountOutMinimum: 0n inside exactInputSingle, wrapped in
// multicall(deadline, ...). executeFullSell and executePartialSell both use these builders for the
// private leg (on ETH a Flashbots bundle).
//
// Proof on the real path, one test per sell path (V2 and V3, full and partial): a real ETH snipe
// is bought and armed by the running bot; another wallet then trades the token (a real signed
// router call mined with the pool's own events, the reserves moving by the router's own math):
//   - full: it dumps 30 percent of the pool's tokens, the price falls about 41 percent and the
//     real poll loop fires the 25 percent stop-loss, so executeFullSell sends the private sell;
//   - partial (PARTIAL_SELL_TARGETS 2x:25): it buys with half the pool's ETH, the price rises
//     about 2.25x and the 2x tier fires, so executePartialSell sends the private sell.
// The bot's approve is mined, then its sell bundle lands one slot later (the sell side of the
// chain comes from fixtures/AUD-EXIT-001-sell-path.ts, computed from mined transactions). The sell
// is decoded with real ethers twice: from the transaction the node accepted (node.submitted) and
// from the raw transaction inside the relay's eth_sendBundle body.
//
// What is measured: whether the private sell carries an output floor above zero. Correct: it does
// (a bound from a fresh quote, as the public fallback already computes, or any positive floor).
// Today: 0 in both decodes, on every path. A positive-floor fix reads "looks fixed" (D-08). Whether
// 0 is deliberate for anti-rug exits is the open decision on card OD-14; this file proves the
// routine exits (stop-loss and take-profit), which the card's options all bound.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Transaction, getAddress } from 'ethers';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepUntilTrue, v2AmountOut, v3AmountOut, type Scenario } from '../harness/world';
import { recordedLogs } from '../harness/capture';
import { buyAndMine, buyRow, listen, opEntries, opLogged, waitAntiRugArmed } from './fixtures/AUD-EXIT-002-position';
import { decodeSellRaw, foreignTrade, installSellPath, landNextSell, sellRouterOf, type DecodedSell } from './fixtures/AUD-EXIT-001-sell-path';

interface SellCase {
    sell: DecodedSell;
    relayBodyMinOut: bigint;
    bought: bigint;
    trigger: string;
}

/**
 * Buy and arm a position, move the price with another wallet's trade, land the bot's private sell
 * and decode it from node.submitted and from the relay body that carried it.
 */
async function privateSell(sc: Scenario, move: 'dump' | 'pump'): Promise<SellCase> {
    const { node } = sc;
    await listen(sc);
    const { buy } = await buyAndMine(sc);
    // The arming wait first: it mines any public transaction of the wallet, so a fix that
    // approves at buy time does not stall the setup of this file.
    await waitAntiRugArmed(sc);
    expect(opLogged('exit.monitor.started')).toBe(true);
    const bought = sc.dex.dexType === 'v2' ? v2AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token) : v3AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token, sc.feeTier!);
    installSellPath(sc, { bought });
    const fromLog = recordedLogs().length;
    const fromSubmit = node.submitted.length;
    if (move === 'dump') await foreignTrade(sc, { sellTokens: (sc.reserves.token * 3n) / 10n });
    else await foreignTrade(sc, { buyEth: sc.reserves.weth / 2n });
    const { sell } = await landNextSell(sc, { fromSubmit });
    expect(sell.route).toBe('bundle');
    // The same transaction, as the relay received it in eth_sendBundle.
    const bodies = node.relay
        .filter((r) => r.method === 'eth_sendBundle')
        .flatMap((r) => ((r.params as Array<{ txs?: string[] }>)[0]?.txs ?? []))
        .filter((raw) => Transaction.from(raw).hash === sell.hash);
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    const fromBody = decodeSellRaw(bodies[0], sellRouterOf(sc), sc.token)!;
    expect(fromBody).toEqual(expect.objectContaining({ amountIn: sell.amountIn, call: sell.call }));
    const triggers = recordedLogs()
        .slice(fromLog)
        .map((l) => String(l.obj?.op ?? ''))
        .filter((op) => op === 'exit.full.submitted' || op === 'exit.partial.submitted');
    expect(triggers.length).toBeGreaterThanOrEqual(1);
    return { sell, relayBodyMinOut: fromBody.minOut, bought, trigger: triggers[0] };
}

describe('AUD-EXIT-001: private sells accept any output (RC-03)', () => {
    it('v2-full-private-sell-no-output-floor: a V2 stop-loss sell is sent privately with amountOutMin 0', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const c = await privateSell(sc, 'dump');
        // Setup facts, true under the bug and a fix: the whole position, through the V2 router.
        expect(c.trigger).toBe('exit.full.submitted');
        expect(c.sell).toEqual(expect.objectContaining({ to: getAddress(sc.dex.routerAddress), call: 'swapExactTokensForETH', amountIn: c.bought, tokenOut: getAddress(sc.weth), recipient: getAddress(sc.wallet.address) }));

        knownBug(ctx, 'AUD-EXIT-001', {
            claim: 'v2-full-private-sell-no-output-floor',
            correct: { outputFloorAboveZero: { submitted: true, relayBody: true } },
            observed: { outputFloorAboveZero: { submitted: false, relayBody: false } },
            actual: { outputFloorAboveZero: { submitted: c.sell.minOut > 0n, relayBody: c.relayBodyMinOut > 0n } },
            expectedPlain: 'A private full exit on V2 carries a minimum output above zero, so a price move before inclusion or a raised sell tax cannot take the sale for almost nothing.',
            actualPlain: 'The V2 stop-loss sell went out in the Flashbots bundle with amountOutMin 0: it would accept any output.',
        });
        expect([c.sell.minOut, c.relayBodyMinOut]).toEqual([0n, 0n]);
        expect(opEntries('exit.trigger.stop-loss').length).toBeGreaterThanOrEqual(1);
        await stepUntilTrue(() => buyRow(sc)!.status === 'sold', { what: 'the position closing', maxSteps: 20_000 });
    });

    it('v3-full-private-sell-no-output-floor: a V3 stop-loss sell is sent privately with amountOutMinimum 0', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v3' });
        const c = await privateSell(sc, 'dump');
        expect(c.trigger).toBe('exit.full.submitted');
        // (Who receives the WETH is AUD-EXIT-027's claim, proven in that file.)
        expect(c.sell).toEqual(expect.objectContaining({ to: getAddress(sc.dex.swapRouterAddress), call: 'multicall/exactInputSingle', amountIn: c.bought, tokenOut: getAddress(sc.weth) }));

        knownBug(ctx, 'AUD-EXIT-001', {
            claim: 'v3-full-private-sell-no-output-floor',
            correct: { outputFloorAboveZero: { submitted: true, relayBody: true } },
            observed: { outputFloorAboveZero: { submitted: false, relayBody: false } },
            actual: { outputFloorAboveZero: { submitted: c.sell.minOut > 0n, relayBody: c.relayBodyMinOut > 0n } },
            expectedPlain: 'A private full exit on V3 carries a minimum output above zero.',
            actualPlain: 'The V3 stop-loss sell went out in the Flashbots bundle as multicall(exactInputSingle) with amountOutMinimum 0: it would accept any output.',
        });
        expect([c.sell.minOut, c.relayBodyMinOut]).toEqual([0n, 0n]);
        expect(opEntries('exit.trigger.stop-loss').length).toBeGreaterThanOrEqual(1);
        await stepUntilTrue(() => buyRow(sc)!.status === 'sold', { what: 'the position closing', maxSteps: 20_000 });
    });

    it('v2-partial-private-sell-no-output-floor: a V2 take-profit partial sell is sent privately with amountOutMin 0', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { PARTIAL_SELL_TARGETS: '2x:25' } });
        const c = await privateSell(sc, 'pump');
        expect(c.trigger).toBe('exit.partial.submitted');
        expect(c.sell).toEqual(expect.objectContaining({ to: getAddress(sc.dex.routerAddress), call: 'swapExactTokensForETH', amountIn: (c.bought * 25n) / 100n }));

        knownBug(ctx, 'AUD-EXIT-001', {
            claim: 'v2-partial-private-sell-no-output-floor',
            correct: { outputFloorAboveZero: { submitted: true, relayBody: true } },
            observed: { outputFloorAboveZero: { submitted: false, relayBody: false } },
            actual: { outputFloorAboveZero: { submitted: c.sell.minOut > 0n, relayBody: c.relayBodyMinOut > 0n } },
            expectedPlain: 'A private partial take-profit sell on V2 carries a minimum output above zero.',
            actualPlain: 'The V2 2x take-profit sell of a quarter of the position went out in the Flashbots bundle with amountOutMin 0.',
        });
        expect([c.sell.minOut, c.relayBodyMinOut]).toEqual([0n, 0n]);
        await stepUntilTrue(() => opLogged('exit.partial.executed'), { what: 'the partial sell confirming', maxSteps: 20_000 });
    });

    it('v3-partial-private-sell-no-output-floor: a V3 take-profit partial sell is sent privately with amountOutMinimum 0', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v3', overrides: { PARTIAL_SELL_TARGETS: '2x:25' } });
        const c = await privateSell(sc, 'pump');
        expect(c.trigger).toBe('exit.partial.submitted');
        expect(c.sell).toEqual(expect.objectContaining({ to: getAddress(sc.dex.swapRouterAddress), call: 'multicall/exactInputSingle', amountIn: (c.bought * 25n) / 100n }));

        knownBug(ctx, 'AUD-EXIT-001', {
            claim: 'v3-partial-private-sell-no-output-floor',
            correct: { outputFloorAboveZero: { submitted: true, relayBody: true } },
            observed: { outputFloorAboveZero: { submitted: false, relayBody: false } },
            actual: { outputFloorAboveZero: { submitted: c.sell.minOut > 0n, relayBody: c.relayBodyMinOut > 0n } },
            expectedPlain: 'A private partial take-profit sell on V3 carries a minimum output above zero.',
            actualPlain: 'The V3 2x take-profit sell of a quarter of the position went out in the Flashbots bundle as multicall(exactInputSingle) with amountOutMinimum 0.',
        });
        expect([c.sell.minOut, c.relayBodyMinOut]).toEqual([0n, 0n]);
        await stepUntilTrue(() => opLogged('exit.partial.executed'), { what: 'the partial sell confirming', maxSteps: 20_000 });
    });
});
