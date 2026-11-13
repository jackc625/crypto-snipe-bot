// test/realpath/triage/AUD-BUY-033.test.ts
// Phase 23 plan 23-05 Task 3 (AUDIT-02): AUD-BUY-033, a V3 snipe sends the whole amount as ETH
// value and never refunds it. src/bot.ts handleNewV3PoolForChain builds
// SwapRouter02 multicall(deadline, [exactInputSingle(amountIn = snipe amount, sqrtPriceLimitX96 0)])
// with value = the snipe amount; the batch holds the swap only, and the bot's V3 router ABI has no
// refundETH (src/utils/abis.ts). If the pool fills only part of the swap, the unspent ETH stays in
// the router, where refundETH (public) hands it to whoever calls it.
//
// Proven here, the calldata half: a real V3 snipe from a real PoolCreated on the ETH bundle route,
// its submitted transaction decoded with real ethers (Transaction.from) against SwapRouter02's
// published ABI, including refundETH, unwrapWETH9 and sweepToken so a refund call would be named
// if it were there (claim v3-multicall-has-no-refund).
//
// What is measured: whether the batch carries a call that returns unspent ETH (refundETH). The
// finding's first recommended fix adds it and reads as "looks fixed" (D-08). Its other fix shape,
// wrapping only what the swap will take and reverting on a partial fill, does not show in the
// batch's call list: under that fix this marker keeps passing and must be revisited with the fix.
//
// Not proven here, and flagged for the Phase 25 fork run (AC-16): that a partial fill really
// leaves the unspent ETH in SwapRouter02 and that refundETH pays it to any caller. That is the
// router and pool contracts' own behavior, which the simulated node does not execute.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, it, expect } from 'vitest';
import { Interface, Transaction, getAddress, parseEther } from 'ethers';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, type Scenario } from '../harness/world';

/** SwapRouter02's published functions the bot could put in its batch (Uniswap swap-router-contracts). */
const SWAP_ROUTER_02 = new Interface([
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
    'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
    'function refundETH() payable',
    'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
    'function sweepToken(address token, uint256 amountMinimum, address recipient) payable',
]);

function opLogged(op: string): boolean {
    return recordedLogs().some((l) => l.obj?.op === op);
}

async function listen(sc: Scenario): Promise<void> {
    await sc.graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
    await stepUntilTrue(
        () => sc.node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === sc.dex.factoryAddress.toLowerCase()),
        { what: 'the listener subscribing to the V3 factory' },
    );
}

describe('AUD-BUY-033: a V3 snipe sends the whole amount as ETH value and never refunds it', () => {
    it('v3-multicall-has-no-refund: the V3 snipe batch is multicall(deadline, [exactInputSingle]) with value the whole snipe amount and no refundETH', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v3' });
        const { node, dex } = sc;
        await listen(sc);
        const launch = await sc.fireNewPool();
        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting its V3 buy bundle' });
        const buy = node.submitted[0];
        expect(buy.route).toBe('bundle');

        // Decode with real ethers: the outer call, then every call in the batch, by name.
        const tx = Transaction.from(buy.raw);
        expect(getAddress(tx.to!)).toBe(getAddress(dex.swapRouterAddress));
        const outer = SWAP_ROUTER_02.parseTransaction({ data: tx.data, value: tx.value });
        expect(outer?.name).toBe('multicall');
        const inner = (outer!.args[1] as string[]).map((d) => SWAP_ROUTER_02.parseTransaction({ data: d, value: tx.value })?.name ?? `unknown ${d.slice(0, 10)}`);

        knownBug(ctx, 'AUD-BUY-033', {
            claim: 'v3-multicall-has-no-refund',
            correct: { refundsUnspentEth: true },
            observed: { refundsUnspentEth: false },
            actual: { refundsUnspentEth: inner.includes('refundETH') },
            expectedPlain: 'The V3 snipe batch ends with refundETH, so any ETH the swap does not use comes back to the wallet.',
            actualPlain: 'The V3 snipe sends the whole snipe amount as ETH and the batch holds only the swap, with no refundETH, so ETH a thin pool does not use stays in the router.',
        });
        // The batch as decoded: one exactInputSingle with no price limit, paid with the whole amount.
        expect(inner).toEqual(['exactInputSingle']);
        const swap = SWAP_ROUTER_02.parseTransaction({ data: (outer!.args[1] as string[])[0], value: tx.value })!;
        const p = swap.args[0] as unknown as { amountIn: bigint; sqrtPriceLimitX96: bigint; recipient: string };
        expect(tx.value).toBe(parseEther(sc.ctx.chain.snipeAmount));
        expect(p.amountIn).toBe(tx.value);
        expect(p.sqrtPriceLimitX96).toBe(0n);
        expect(getAddress(p.recipient)).toBe(getAddress(sc.wallet.address));

        // Let the buy finish (mined, recorded, armed) before teardown.
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
