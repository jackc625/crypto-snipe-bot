// test/realpath/triage/AUD-EXIT-003.test.ts
// Phase 23 plan 23-07 Task 2 (AUDIT-02, RC-08): AUD-EXIT-003, the exit price signal is not a price.
// A fixed probe (the ETH buy amount in wei, reused as a raw TOKEN amount) is quoted token -> WETH,
// and the ratio of two quote outputs (current / entry) drives every exit decision.
//
// The sites (src/exitEngine.ts): startExitMonitor computes buyAmountWei = parseEther(buyAmount)
// and passes it to queryPrice as amountIn of a token -> WETH quote; entryPrice is that output, and
// pollExitStrategy divides each later output by it (priceMultiple). Only a null entry is
// rejected; a 0 entry is kept. A null quote returns 'continue' before every check, including the
// 30-minute urgency exit.
//
// Proven on the real path (a real ETH V2 snipe through the real listener, safety, Flashbots bundle
// and database; quotes from the router's own constant-product math on the scenario reserves):
//   - probe-is-eth-buy-wei-as-token-amount (sub-claim 1): for a token with 9 decimals, every
//     exit quote's amountIn is parseEther(snipe amount), 1e16 raw units, i.e. 10,000,000 whole
//     tokens: the ETH amount is used as a raw token amount, with no decimals read.
//   - zero-entry-infinite-ratio-fires-every-partial-tier (sub-claim 4, Infinity half): a high
//     supply 18-decimal token (1 quadrillion tokens in a 1 ETH pool, a common meme-coin shape)
//     with a 0.001 snipe: the 1e15 probe quotes 0 at the monitor's start (real V2 integer math), and
//     0 is kept as the entry price. Another buyer then moves the price up 1 percent, the probe
//     quotes 1, priceMultiple is Infinity, and every partial tier (2x and 5x) is sold at once.
//   - zero-entry-nan-ratio-fires-stop-loss (sub-claim 4, NaN half): the same pool with no price
//     move: the probe quotes 0 again, 0/0 is NaN, the fixed stop price is 0 and 0 <= 0, so the
//     stop-loss sells the whole position on the first tick.
//   - null-quote-suppresses-urgency-exit (the evidence row "a null quote returns continue before
//     every check, including the 30-minute urgency exit"): every exit quote fails (the provider's
//     rate-limit answer) for 31 minutes after the buy; the urgency exit never fires.
// Each marker measures the harm (what was sold, or whether an exit fired, against what the real
// price did), so every fix shape the recommendation names reads "looks fixed" (D-08). The sell side
// of the chain comes from fixtures/AUD-EXIT-001-sell-path.ts, computed from mined transactions.
//
// Needs a fork (AC-16, recorded with --needs-fork): sub-claim 2 (the quote saturates and the ratio
// tracks about the square root of the price when the probe is large against a thin pool's token
// reserve) and sub-claim 3 (a few-wei quote moves priceMultiple in large steps) depend on how real
// tokens and pools answer (decimals, supply, depth and fee-on-transfer), which the synthetic pool
// cannot show honestly.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Wallet, ethers, getAddress, parseEther } from 'ethers';
import { encodeResult } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, v2AmountOut, type Scenario } from '../harness/world';
import { GET_AMOUNTS_OUT, V2_ROUTER, buyAndMine, buyRow, exitQuotes, exitStateRow, listen, opEntries, opLogged, waitAntiRugArmed } from './fixtures/AUD-EXIT-002-position';
import { driveExits, installSellPath, landNextSell, sellRouterOf, sellsSubmitted } from './fixtures/AUD-EXIT-001-sell-path';

const PAIR_EVENTS = new Interface([
    'event Sync(uint112 reserve0, uint112 reserve1)',
    'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
]);
const QUADRILLION = 10n ** 33n; // 1e15 whole tokens at 18 decimals

/** A pool of 1 ETH and 1 quadrillion tokens (a common meme-coin shape), set before the launch. */
function highSupplyPool(sc: Scenario): void {
    sc.reserves.weth = parseEther('1');
    sc.reserves.token = QUADRILLION;
    // The pair holds half the supply (a real token's supply covers what the pair holds).
    sc.node.setRead(sc.token, 'totalSupply()', encodeResult(['uint256'], [2n * QUADRILLION]));
}

/**
 * Another wallet buys `ethIn` of the token on the router: a real signed swapExactETHForTokens,
 * mined with its Swap and Sync logs, and the pool's reserves move by the router's own math.
 */
async function foreignBuy(sc: Scenario<'v2'>, ethIn: bigint): Promise<void> {
    const buyer = new Wallet(ethers.id('realpath.aud-exit-003.other-buyer'));
    sc.node.setBalance(buyer.address, parseEther('10'));
    const out = v2AmountOut(ethIn, sc.reserves.weth, sc.reserves.token);
    const raw = await buyer.signTransaction({
        chainId: 1, nonce: 0, to: sc.dex.routerAddress, value: ethIn, gasLimit: 200_000n, type: 2,
        maxFeePerGas: 60_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
        data: V2_ROUTER.encodeFunctionData('swapExactETHForTokens', [0n, [sc.weth, sc.token], buyer.address, BigInt(Math.floor(Date.now() / 1000) + 600)]),
    });
    const hash = sc.node.addForeignTransaction(raw);
    sc.reserves.weth += ethIn;
    sc.reserves.token -= out;
    const wethIs0 = sc.weth.toLowerCase() < sc.token.toLowerCase();
    const [r0, r1] = wethIs0 ? [sc.reserves.weth, sc.reserves.token] : [sc.reserves.token, sc.reserves.weth];
    const sync = PAIR_EVENTS.encodeEventLog('Sync', [r0, r1]);
    const swap = PAIR_EVENTS.encodeEventLog('Swap', [sc.dex.routerAddress, wethIs0 ? ethIn : 0n, wethIs0 ? 0n : ethIn, wethIs0 ? 0n : out, wethIs0 ? out : 0n, buyer.address]);
    sc.node.mine({ include: [hash], logs: [
        { address: sc.pair, topics: sync.topics, data: sync.data, transactionHash: hash },
        { address: sc.pair, topics: swap.topics, data: swap.data, transactionHash: hash },
    ] });
}

/**
 * Buy, wait for the position's arming to finish (armPositionMonitoring runs the anti-rug arming
 * after startExitMonitor returns, whether or not a monitor started, so this holds under the bug and
 * a fix that refuses a 0 entry), and freeze the position for the sell path.
 */
async function snipeAndArm(sc: Scenario): Promise<{ bought: bigint; tradeId: number }> {
    await listen(sc);
    const { buy } = await buyAndMine(sc);
    await waitAntiRugArmed(sc);
    const bought = v2AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token);
    const row = buyRow(sc)!;
    expect(row.status).toBe('pending');
    installSellPath(sc, { bought });
    return { bought, tradeId: row.id };
}

function exitTriggers(fromLog: number): string[] {
    return recordedLogs()
        .slice(fromLog)
        .filter((l) => /^exit\.trigger\./.test(String(l.obj?.op ?? '')))
        .map((l) => String(l.obj!.op));
}

describe('AUD-EXIT-003: the exit price signal is a ratio of fixed-probe quote outputs, not a price (RC-08)', () => {
    it('probe-is-eth-buy-wei-as-token-amount: for a 9-decimal token every exit quote sells parseEther(snipe amount) raw token units', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const pollMs = sc.graph.exitEngine.exitConfig.pollIntervalMs;
        sc.node.setRead(sc.token, 'decimals()', encodeResult(['uint8'], [9]));
        const fromCall = sc.node.callLog.length;
        await listen(sc);
        await buyAndMine(sc);
        // The arming wait first: it mines any public transaction of the wallet, so a fix that
        // approves at buy time does not stall the setup of this file.
        await waitAntiRugArmed(sc);
        expect(opLogged('exit.monitor.started')).toBe(true);
        await stepFor(2 * pollMs, 50);
        const quotes = exitQuotes(sc, fromCall);
        expect(quotes.length).toBeGreaterThanOrEqual(3);
        const ethBuyWei = parseEther(sc.ctx.chain.snipeAmount);

        knownBug(ctx, 'AUD-EXIT-003', {
            claim: 'probe-is-eth-buy-wei-as-token-amount',
            correct: { probeIsEthBuyAmountInWei: false },
            observed: { probeIsEthBuyAmountInWei: true },
            actual: { probeIsEthBuyAmountInWei: quotes.every((q) => q.amountIn === ethBuyWei) },
            expectedPlain: 'The exit price is measured with a token amount that fits the token (its decimals and the size of the position), or with the pool price itself.',
            actualPlain: 'For a token with 9 decimals the exit monitor quotes 1e16 raw units, the 0.01 ETH buy size in wei, which is 10,000,000 tokens, whatever the token or the position size.',
        });
        // Bug details: one probe for the entry and every tick, 1e16 raw = 10,000,000 whole tokens.
        expect(ethBuyWei).toBe(10n ** 16n);
        expect(ethBuyWei / 10n ** 9n).toBe(10_000_000n);
        expect(quotes.every((q) => q.to === getAddress(sc.dex.routerAddress) && q.tokenOut === getAddress(sc.weth))).toBe(true);
    });

    // Own limit: this test drives a minute of simulated chain time in small steps. Alone it runs
    // in about 8.6 s; under the full parallel `npm test` load it went past the project's 15 s
    // default twice in a row and took 29.7 s once given room (2026-11-11), so it gets 90 s,
    // about 3x its measured run time under load.
    it('zero-entry-infinite-ratio-fires-every-partial-tier: a 0 first quote is kept as the entry, a 1 percent price rise reads Infinity and both partial tiers sell at once', { timeout: 90_000 }, async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { ETH_SNIPE_AMOUNT: '0.001', PARTIAL_SELL_TARGETS: '2x:25,5x:25' } });
        const pollMs = sc.graph.exitEngine.exitConfig.pollIntervalMs;
        expect(sc.graph.exitEngine.exitConfig.partialSellTiers).toEqual([{ multiple: 2, percent: 25 }, { multiple: 5, percent: 25 }]);
        highSupplyPool(sc);
        const probe = parseEther('0.001');
        const { bought, tradeId } = await snipeAndArm(sc);
        // The monitor's entry quote: the router's own math answers 0 for 1e15 raw tokens.
        expect(v2AmountOut(probe, sc.reserves.token, sc.reserves.weth)).toBe(0n);
        const fromLog = recordedLogs().length;
        const fromSubmit = sc.node.submitted.length;

        // Before the first tick, another buyer moves the price up about 1 percent.
        const priceBefore = (sc.reserves.weth * 10n ** 18n) / sc.reserves.token;
        await foreignBuy(sc, parseEther('0.005'));
        const priceAfter = (sc.reserves.weth * 10n ** 18n) / sc.reserves.token;
        const realMultiple = Number(priceAfter) / Number(priceBefore);
        expect(realMultiple).toBeGreaterThan(1.009);
        expect(realMultiple).toBeLessThan(1.011);
        expect(v2AmountOut(probe, sc.reserves.token, sc.reserves.weth)).toBe(1n);
        // One minute of the chain answering the bot (twelve poll intervals): a public approve is
        // mined in the next block and a sell bundle one slot after it is sent.
        const sold = await driveExits(sc, { fromSubmit, forMs: 60_000 });
        // Share of the position, to the nearest percent.
        const share = (amount: bigint): string => `${Math.round(Number((amount * 10_000n) / bought) / 100)}%`;

        knownBug(ctx, 'AUD-EXIT-003', {
            claim: 'zero-entry-infinite-ratio-fires-every-partial-tier',
            correct: { soldAtA1PercentRise: [] as string[] },
            observed: { soldAtA1PercentRise: ['50%'] },
            actual: { soldAtA1PercentRise: sold.map((s) => share(s.amountIn)) },
            expectedPlain: 'After a 1 percent price rise no partial take-profit tier (2x, 5x) sells.',
            actualPlain: 'The first quote of a high-supply token answered 0 and was kept as the entry price; after a 1 percent rise the ratio read Infinity, trailing activated and the 2x and 5x tiers sold half the position at once.',
        });
        // Bug details: the entry price 0 is stored, trailing activated at Infinity, one combined
        // partial sell of both tiers (half the position) confirmed, no full exit. (The sell's
        // output floor is AUD-EXIT-001's claim, proven in that file.)
        expect(exitStateRow(sc, tradeId)).toEqual(expect.objectContaining({ entry_price: 0, original_token_amount: bought.toString() }));
        expect(opEntries('exit.trailing.activated', fromLog).map((e) => e.priceMultiple)).toEqual(['Infinity']);
        expect(opEntries('exit.partial.submitted', fromLog).map((e) => e.tiers)).toEqual(['2x:25%+5x:25%']);
        expect(sold).toEqual([expect.objectContaining({ to: sellRouterOf(sc), call: 'swapExactTokensForETH', amountIn: bought / 2n })]);
        expect(opLogged('exit.partial.executed', fromLog)).toBe(true);
        expect(exitTriggers(fromLog)).toEqual([]);
    });

    it('zero-entry-nan-ratio-fires-stop-loss: a 0 first quote and an unchanged pool read NaN, and the stop-loss sells the whole position on the first tick', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { ETH_SNIPE_AMOUNT: '0.001' } });
        const pollMs = sc.graph.exitEngine.exitConfig.pollIntervalMs;
        highSupplyPool(sc);
        const { bought, tradeId } = await snipeAndArm(sc);
        expect(v2AmountOut(parseEther('0.001'), sc.reserves.token, sc.reserves.weth)).toBe(0n);
        const fromLog = recordedLogs().length;
        const fromSubmit = sc.node.submitted.length;
        const reservesBefore = { ...sc.reserves };
        await stepFor(3 * pollMs, 50);
        expect(sc.reserves).toEqual(reservesBefore);

        knownBug(ctx, 'AUD-EXIT-003', {
            claim: 'zero-entry-nan-ratio-fires-stop-loss',
            correct: { exitTriggeredWithNoPriceMove: false },
            observed: { exitTriggeredWithNoPriceMove: true },
            actual: { exitTriggeredWithNoPriceMove: exitTriggers(fromLog).length > 0 },
            expectedPlain: 'With the pool unchanged, no exit fires.',
            actualPlain: 'The first quote of a high-supply token answered 0 and was kept as the entry price; with the pool unchanged the next quote was 0 too, 0/0 gave NaN, and the stop-loss sold the whole position on the first tick.',
        });
        // Bug details: the stop-loss (the NaN ratio in its alert text) and a market sell of
        // everything.
        expect(exitStateRow(sc, tradeId)).toEqual(expect.objectContaining({ entry_price: 0, original_token_amount: bought.toString() }));
        expect(new Set(exitTriggers(fromLog))).toEqual(new Set(['exit.trigger.stop-loss']));
        expect(String(opEntries('exit.trigger.stop-loss', fromLog)[0].detail)).toBe('Fixed stop-loss at NaNx (+NaN%)');
        const { sell } = await landNextSell(sc, { fromSubmit });
        expect(sell).toEqual(expect.objectContaining({ call: 'swapExactTokensForETH', amountIn: bought }));
        await stepUntilTrue(() => buyRow(sc)!.status === 'sold', { what: 'the position closing after the stop-loss sell', maxSteps: 20_000 });
    });

    it('null-quote-suppresses-urgency-exit: with every exit quote failing for 31 minutes after the buy, the 30-minute urgency exit never fires', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node } = sc;
        const urgencyMs = sc.graph.exitEngine.exitConfig.urgencyWindowMs;
        expect(urgencyMs).toBe(30 * 60_000);
        const { tradeId } = await snipeAndArm(sc);
        const startedAt = exitStateRow(sc, tradeId)!.urgency_start_ts;
        const fromLog = recordedLogs().length;
        const fromSubmit = node.submitted.length;
        // The provider refuses every exit quote from now on (Infura's rate-limit answer); every
        // other call is answered.
        const refused = node.failNext('eth_call', {
            selector: GET_AMOUNTS_OUT,
            to: sc.dex.routerAddress,
            times: 1_000,
            error: { code: -32005, message: 'daily request count exceeded, request rate limited' },
        });
        await stepFor(urgencyMs + 60_000 - (Date.now() - startedAt), 1_000);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(urgencyMs + 60_000);
        expect(refused.fired).toBeGreaterThanOrEqual(360);

        knownBug(ctx, 'AUD-EXIT-003', {
            claim: 'null-quote-suppresses-urgency-exit',
            correct: { urgencyExitFired: true },
            observed: { urgencyExitFired: false },
            actual: { urgencyExitFired: opLogged('exit.trigger.urgency', fromLog) },
            expectedPlain: 'Thirty minutes after the buy the urgency exit sells the position, whether or not the price can be read.',
            actualPlain: 'With every price quote failing, each poll returned before the urgency check, so 31 minutes after the buy no exit had fired and the position was still held.',
        });
        // Bug details: every tick skipped, nothing sent, the position still open.
        expect(exitTriggers(fromLog)).toEqual([]);
        expect(recordedLogs().slice(fromLog).filter((l) => l.msg === 'Price query returned null, skipping cycle').length).toBe(refused.fired);
        expect(sellsSubmitted(sc)).toEqual([]);
        expect(node.submitted.length).toBe(fromSubmit);
        expect(buyRow(sc)!.status).toBe('pending');
    });
});
