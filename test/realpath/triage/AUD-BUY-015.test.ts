// test/realpath/triage/AUD-BUY-015.test.ts
// Phase 23 plan 23-05 Task 3 (AUDIT-02): AUD-BUY-015, the V3 minimum-liquidity check only proves
// the quoter did not revert. src/bot.ts checkMinLiquidity quotes 0.001 native and then the full
// threshold (ETH: 0.5) through QuoterV2 quoteExactInputSingle, ignores both answers, and returns
// true when neither reverted. It is the only depth gate on a V3 snipe.
//
// Proven here, the gate half: a real V3 launch on a THIN pool goes through the real listener and
// the real gate. The pool holds 0.001 ETH against 200 tokens, the same price as the scenario's
// ordinary pool (5 ETH : 1 000 000 tokens), built by scaling the scenario's own reserves before
// the launch, so the quoter, the swap, the launch's Mint and the pool's token balance all answer
// for the same thin pool; its liquidity() read is set to match. The read table answers the
// threshold-size quote with a real-shaped (uint256, uint160, uint32, uint256): about 199.6 tokens,
// worth about 0.001 ETH at the pool price, far below the 0.5 ETH threshold. The gate passes and
// the bot buys (claim thin-pool-passes-min-liquidity-gate).
//
// Not proven here, and flagged for the Phase 25 fork run (AC-16): that the real QuoterV2 answers
// a threshold-size exact-input quote on a thin pool without reverting (the finding: it reverts
// only when nothing fills). That is the deployed quoter's behavior on a real pool, which the
// simulated node does not execute.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, it, expect } from 'vitest';
import { Interface, getAddress, parseEther } from 'ethers';
import { encodeResult } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, v3AmountOut, type Scenario } from '../harness/world';

const V3_QUOTER = new Interface([
    'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);
const QUOTE_SELECTOR = V3_QUOTER.getFunction('quoteExactInputSingle')!.selector;

function msgLogged(msg: string): boolean {
    return recordedLogs().some((l) => l.msg === msg);
}

function opLogged(op: string): boolean {
    return recordedLogs().some((l) => l.obj?.op === op);
}

function isqrt(n: bigint): bigint {
    if (n < 2n) return n;
    let x = n;
    let y = (x + 1n) / 2n;
    while (y < x) {
        x = y;
        y = (x + n / x) / 2n;
    }
    return x;
}

async function listen(sc: Scenario): Promise<void> {
    await sc.graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
    await stepUntilTrue(
        () => sc.node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === sc.dex.factoryAddress.toLowerCase()),
        { what: 'the listener subscribing to the V3 factory' },
    );
}

describe('AUD-BUY-015: the V3 minimum-liquidity gate only proves the quoter did not revert', () => {
    it('thin-pool-passes-min-liquidity-gate: a pool with 0.001 ETH of depth against a 0.5 ETH threshold passes the gate and the bot buys', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v3' });
        const { node, dex } = sc;
        const threshold = parseEther(sc.ctx.chain.minLiquidityThreshold);
        expect(threshold).toBe(parseEther('0.5'));

        // The thin pool: the scenario's reserves scaled down at the same price, before the launch.
        const price = sc.reserves.token / sc.reserves.weth;
        sc.reserves.weth = parseEther('0.001');
        sc.reserves.token = sc.reserves.weth * price;
        expect(sc.reserves.token).toBe(parseEther('200'));
        node.setRead(sc.pair, 'liquidity()', encodeResult(['uint128'], [isqrt(sc.reserves.weth * sc.reserves.token)]));

        await listen(sc);
        const launch = await sc.fireNewPool();
        await stepUntilTrue(() => msgLogged('V3 pool below min liquidity threshold, skipping') || msgLogged('All V3 safety checks passed, buying'), { what: 'the V3 gates deciding', maxSteps: 20_000 });
        const refused = msgLogged('V3 pool below min liquidity threshold, skipping');

        knownBug(ctx, 'AUD-BUY-015', {
            claim: 'thin-pool-passes-min-liquidity-gate',
            correct: { thinPoolRefused: true },
            observed: { thinPoolRefused: false },
            actual: { thinPoolRefused: refused },
            expectedPlain: 'A V3 pool with far less depth than the minimum-liquidity threshold is refused before the buy.',
            actualPlain: 'A V3 pool holding 0.001 ETH passed the 0.5 ETH minimum-liquidity check, because the check only asks whether the quote reverts; the bot went on to buy.',
        });

        // The gate's two quotes, as the bot sent them: 0.001 native, then the full threshold, both
        // WETH for the token at the pool's fee, and both answered (no revert).
        const quotes = node.callLog
            .filter((c) => c.method === 'eth_call' && c.to === dex.quoterAddress.toLowerCase() && c.selector === QUOTE_SELECTOR)
            .map((c) => V3_QUOTER.decodeFunctionData('quoteExactInputSingle', c.data!)[0] as unknown as { tokenIn: string; tokenOut: string; amountIn: bigint; fee: bigint });
        expect(quotes.slice(0, 2).map((q) => q.amountIn)).toEqual([parseEther('0.001'), threshold]);
        expect(quotes.every((q) => getAddress(q.tokenIn) === getAddress(sc.weth) && getAddress(q.tokenOut) === getAddress(sc.token) && Number(q.fee) === sc.feeTier)).toBe(true);
        // What the threshold-size quote answered, and what that output is worth at the pool price.
        const out = v3AmountOut(threshold, sc.reserves.weth, sc.reserves.token, sc.feeTier!);
        expect(out > 0n && out < sc.reserves.token).toBe(true);
        const worth = out / price;
        expect(worth * 100n).toBeLessThan(threshold);
        expect(msgLogged('V3 pool below minimum liquidity threshold')).toBe(false);

        // The bot buys into the thin pool; let it finish (mined, recorded, armed) before teardown.
        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting its V3 buy into the thin pool' });
        const buy = node.submitted[0];
        await stepFor(12_000);
        expect(node.mine({ include: [buy.hash] })).toBe(launch.block + 1);
        await stepUntilTrue(() => sc.graph.db.prepare('SELECT 1 FROM trades').get() !== undefined, { what: 'the trades row for the V3 buy', maxSteps: 20_000 });
        const cursor = (): number | undefined => (sc.graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get('eth') as { b: number } | undefined)?.b;
        await stepUntilTrue(
            () => opLogged('exit.monitor.started') && node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase())) && cursor() === node.head,
            { what: 'the V3 position being armed' },
        );
    });
});
