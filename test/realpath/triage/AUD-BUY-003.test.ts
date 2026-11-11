// test/realpath/triage/AUD-BUY-003.test.ts
// Phase 23 plan 23-05 Task 2 (AUDIT-02, RC-02): AUD-BUY-003, the snipe buy's minimum output fails
// open. When the quote read fails, src/bot.ts catches it, keeps minOut = 0n and still sends the
// swap: V2 handleNewPairForChain (getAmountsOut, then swapExactETHForTokens(amountOutMin = minOut))
// and V3 handleNewV3PoolForChain (QuoterV2 quoteExactInputSingle, then SwapRouter02
// multicall(deadline, [exactInputSingle(amountOutMinimum = minOut)])). One root cause, two sites,
// one test each (D-10, AC-11).
//
// Each test drives the real snipe from a real PairCreated or PoolCreated through the real
// listener, detection and safety bank. The ONE quote read for the snipe amount fails with a real
// node answer: the fault names the method's selector and its target, and is armed only after the
// bot logged that every safety check passed, so it cannot hit a safety-bank or liquidity read
// (the V3 liquidity gate calls the same quoter). The submitted transaction is decoded with real
// ethers (Transaction.from and the router ABI).
//
// What is measured: whether an unbounded swap (amountOutMin 0) was sent. Correct is that none was:
// either the snipe is skipped (fail closed, like the deliberate public leg, src/bot.ts
// buy.fallback.quote-failed) or it is sent with a bound above zero. Both fixes read as "looks
// fixed" (D-08). The decoded amountOutMin is asserted right after the marker.
//
// Not proven here: the fractional-slippage RangeError path (BigInt() of a fractional percent
// thrown into the same catch). It is latent today because slippagePercent is hard-coded 5
// (src/config.ts), so no configuration reaches it; recorded as in the finding.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, it, expect } from 'vitest';
import { Interface, Transaction, getAddress, parseEther } from 'ethers';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, type Scenario } from '../harness/world';

const V2_ROUTER = new Interface(['function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)']);
const V3_ROUTER = new Interface([
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
    'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
]);
const V2_QUOTE = new Interface(['function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)']);
const V2_QUOTE_SELECTOR = V2_QUOTE.getFunction('getAmountsOut')!.selector;
const V3_QUOTER = new Interface([
    'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);
const V3_QUOTE_SELECTOR = V3_QUOTER.getFunction('quoteExactInputSingle')!.selector;

function opLogged(op: string): boolean {
    return recordedLogs().some((l) => l.obj?.op === op);
}

function msgLogged(msg: string): boolean {
    return recordedLogs().some((l) => l.msg === msg);
}

async function listen(sc: Scenario): Promise<void> {
    await sc.graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
    await stepUntilTrue(
        () => sc.node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === sc.dex.factoryAddress.toLowerCase()),
        { what: 'the listener subscribing to the factory' },
    );
}

/** Let the buy finish (mined, recorded, armed) so the handler is done before teardown. */
async function mineAndArm(sc: Scenario, hash: string, block: number): Promise<void> {
    await stepFor(12_000);
    expect(sc.node.mine({ include: [hash] })).toBe(block);
    await stepUntilTrue(() => sc.graph.db.prepare('SELECT 1 FROM trades').get() !== undefined, { what: 'the trades row for the buy', maxSteps: 20_000 });
    const cursor = (): number | undefined => (sc.graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get(sc.chain) as { b: number } | undefined)?.b;
    await stepUntilTrue(
        () => opLogged('exit.monitor.started') && sc.node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase())) && cursor() === sc.node.head,
        { what: 'the position being armed' },
    );
}

/** How long the bot is given, after the quote fault fired, to submit (it takes well under a second of fake time). */
const SUBMIT_WINDOW_MS = 5_000;

describe('AUD-BUY-003: the snipe buy minOut fails open when the quote fails (RC-02)', () => {
    it('v2-quote-failure-sends-zero-amount-out-min: a failed getAmountsOut leaves minOut 0 and the V2 swap is still sent with amountOutMin 0', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node, dex } = sc;
        await listen(sc);
        // geth's answer from a load-balanced node that has not seen the launch block yet.
        const quote = node.failNext('eth_call', {
            selector: 'getAmountsOut(uint256,address[])',
            to: dex.routerAddress,
            after: () => msgLogged('All safety checks passed, buying'),
            error: { code: -32000, message: 'header not found' },
        });
        const launch = await sc.fireNewPair();
        await stepUntilTrue(() => quote.fired === 1, { what: 'the snipe-size getAmountsOut read failing' });
        await stepFor(SUBMIT_WINDOW_MS);

        // Setup facts: the failed read was the snipe-size quote on [WETH, token].
        const failed = node.callLog.filter((c) => c.method === 'eth_call' && c.to === dex.routerAddress.toLowerCase() && c.selector === V2_QUOTE_SELECTOR).at(-1)!;
        const quoted = V2_QUOTE.decodeFunctionData('getAmountsOut', failed.data!);
        expect(quoted[0]).toBe(parseEther(sc.ctx.chain.snipeAmount));
        expect((quoted[1] as string[]).map((a) => getAddress(a))).toEqual([getAddress(sc.weth), getAddress(sc.token)]);

        const sent = node.submitted.filter((s) => s.tx.to?.toLowerCase() === dex.routerAddress.toLowerCase());
        const decoded = sent.map((s) => {
            const tx = Transaction.from(s.raw);
            const call = V2_ROUTER.parseTransaction({ data: tx.data, value: tx.value })!;
            expect(call.name).toBe('swapExactETHForTokens');
            return { amountOutMin: call.args[0] as bigint, value: tx.value, hash: s.hash };
        });
        knownBug(ctx, 'AUD-BUY-003', {
            claim: 'v2-quote-failure-sends-zero-amount-out-min',
            correct: { unboundedSwapSent: false },
            observed: { unboundedSwapSent: true },
            actual: { unboundedSwapSent: decoded.some((d) => d.amountOutMin === 0n) },
            expectedPlain: 'When the V2 price quote fails, the snipe is skipped or sent with a minimum-output limit above zero.',
            actualPlain: 'When the V2 price quote failed, the bot still sent the swap with a minimum output of 0, so it accepts any price.',
        });
        // The decoded swap: amountOutMin 0, the whole snipe amount as value.
        expect(decoded).toHaveLength(1);
        expect(decoded[0].amountOutMin).toBe(0n);
        expect(decoded[0].value).toBe(parseEther(sc.ctx.chain.snipeAmount));
        expect(msgLogged('Failed to calculate slippage-adjusted minOut, defaulting to 0')).toBe(true);
        await mineAndArm(sc, decoded[0].hash, launch.block + 1);
    });

    it('v3-quote-failure-sends-zero-amount-out-minimum: a failed quoteExactInputSingle leaves minOut 0 and the V3 multicall still carries amountOutMinimum 0', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v3' });
        const { node, dex } = sc;
        await listen(sc);
        // The quoter reverts with no data, as QuoterV2 does when the swap it simulates fails.
        const quote = node.failNext('eth_call', {
            selector: 'quoteExactInputSingle((address,address,uint256,uint24,uint160))',
            to: dex.quoterAddress,
            after: () => msgLogged('All V3 safety checks passed, buying'),
            error: { code: -32000, message: 'execution reverted' },
        });
        const launch = await sc.fireNewPool();
        await stepUntilTrue(() => quote.fired === 1, { what: 'the snipe-size quoteExactInputSingle read failing' });
        await stepFor(SUBMIT_WINDOW_MS);

        // Setup facts: the failed read was the snipe-size quote of WETH for the token at the pool's fee.
        const failed = node.callLog.filter((c) => c.method === 'eth_call' && c.to === dex.quoterAddress.toLowerCase() && c.selector === V3_QUOTE_SELECTOR).at(-1)!;
        const q = V3_QUOTER.decodeFunctionData('quoteExactInputSingle', failed.data!)[0] as unknown as { tokenIn: string; tokenOut: string; amountIn: bigint; fee: bigint };
        expect([getAddress(q.tokenIn), getAddress(q.tokenOut), q.amountIn, Number(q.fee)]).toEqual([getAddress(sc.weth), getAddress(sc.token), parseEther(sc.ctx.chain.snipeAmount), sc.feeTier]);

        const sent = node.submitted.filter((s) => s.tx.to?.toLowerCase() === dex.swapRouterAddress.toLowerCase());
        const decoded = sent.map((s) => {
            const tx = Transaction.from(s.raw);
            const outer = V3_ROUTER.parseTransaction({ data: tx.data, value: tx.value })!;
            expect(outer.name).toBe('multicall');
            const inner = (outer.args[1] as string[]).map((d) => V3_ROUTER.parseTransaction({ data: d, value: tx.value })!);
            const swap = inner.find((c) => c.name === 'exactInputSingle')!;
            const p = swap.args[0] as unknown as { amountIn: bigint; amountOutMinimum: bigint };
            return { amountOutMin: p.amountOutMinimum, amountIn: p.amountIn, value: tx.value, hash: s.hash };
        });
        knownBug(ctx, 'AUD-BUY-003', {
            claim: 'v3-quote-failure-sends-zero-amount-out-minimum',
            correct: { unboundedSwapSent: false },
            observed: { unboundedSwapSent: true },
            actual: { unboundedSwapSent: decoded.some((d) => d.amountOutMin === 0n) },
            expectedPlain: 'When the V3 price quote fails, the snipe is skipped or sent with a minimum-output limit above zero.',
            actualPlain: 'When the V3 price quote failed, the bot still sent the swap with a minimum output of 0, so it accepts any price.',
        });
        expect(decoded).toHaveLength(1);
        expect(decoded[0].amountOutMin).toBe(0n);
        expect(decoded[0].amountIn).toBe(parseEther(sc.ctx.chain.snipeAmount));
        expect(msgLogged('Failed to get V3 quote for slippage calc, defaulting minOut to 0')).toBe(true);
        await mineAndArm(sc, decoded[0].hash, launch.block + 1);
    });
});
