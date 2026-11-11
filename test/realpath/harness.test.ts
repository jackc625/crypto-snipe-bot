// test/realpath/harness.test.ts
// Phase 23 plan 23-01 (CHAR-01): the real-path harness proves itself.
//   - The Phase 22 rails are on for the realpath project.
//   - AC-01: one V2 Flashbots buy runs end to end: a real PairCreated log through the real
//     listener, real ethers signing, the simulated node, the real-migration :memory: database,
//     and a submitted transaction that decodes through real ethers to the expected swap call.
// Only the logger, notifier, broadcaster, axios and the Telegram library are mocked
// (harness/setup.ts); the chain is a transport seam (harness/chain.ts).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { Interface, Transaction, parseEther, getAddress } from 'ethers';
import { harnessState } from './harness/chain';
import { createScenario, stepUntilTrue, stepFor } from './harness/world';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = req('../rails/core.cjs') as {
    railsStatus(): { installed: boolean; mode: string; project: string; repoRoot: string; netDenyInstalled: boolean };
};

/** The canonical Uniswap V2 router ABI, independent of src/utils/abis.ts. */
const ROUTER = new Interface(['function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)']);

function opLogged(op: string): boolean {
    return harnessState().logs.some((l) => l.obj?.op === op);
}

describe('realpath harness', () => {
    it('rails installed in mode full for the realpath project', () => {
        const st = core.railsStatus();
        expect(st.installed).toBe(true);
        expect(st.mode).toBe('full');
        expect(st.project).toBe('realpath');
        expect(st.netDenyInstalled).toBe(true);
    });

    it('AC-01: one V2 Flashbots buy runs end to end on real ethers, the fake node and the real-migration database', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node, graph, ctx, dex, token, weth, wallet } = sc;

        // The real database came from the real migrations.
        expect(graph.db.pragma('user_version', { simple: true })).toBe(7);

        await graph.bot.startDexListener(ctx, dex, sc.registry);
        await stepUntilTrue(
            () => node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === dex.factoryAddress.toLowerCase()),
            { what: 'the listener subscribing to PairCreated on the factory' },
        );

        const launch = await sc.fireNewPair();

        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting its buy bundle' });
        const buy = node.submitted[0];
        expect(buy.route).toBe('bundle');
        expect(buy.status).toBe('accepted');
        // A relay acceptance changes no count at latest, and the receipt is a valid null.
        expect(node.minedCount(wallet.address)).toBe(0);
        const target = launch.block + 1;
        expect(buy.targetBlocks).toContain(target);

        // One slot passes, then a builder includes the bundle at its target block.
        await stepFor(12_000);
        const mined = node.mine({ include: [buy.hash] });
        expect(mined).toBe(target);
        expect(node.minedCount(wallet.address)).toBe(1);

        const tradeRow = (): { status: string; action: string; token: string; chain: string; tx_hash: string; amount_in: string } | undefined =>
            graph.db.prepare('SELECT status, action, token, chain, tx_hash, amount_in FROM trades').get() as never;
        await stepUntilTrue(() => tradeRow() !== undefined, { what: 'the trades row for the buy' });
        // Let the handler finish arming the position before teardown: the exit monitor started,
        // the pair's anti-rug subscription is on the node, and the anti-rug block cursor reached
        // the head (true on every backfill branch, so this pins no backfill behavior).
        const cursor = (): number | undefined => (graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get('eth') as { b: number } | undefined)?.b;
        await stepUntilTrue(
            () =>
                opLogged('exit.monitor.started') &&
                node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase())) &&
                cursor() === node.head,
            { what: 'the position being armed (exit monitor, anti-rug subscription, block cursor)' },
        );

        // The submitted transaction, decoded with real ethers.
        const tx = Transaction.from(buy.raw);
        expect(tx.hash).toBe(buy.hash);
        expect(getAddress(tx.to!)).toBe(getAddress(dex.routerAddress));
        expect(tx.value).toBe(parseEther(ctx.chain.snipeAmount));
        expect(tx.chainId).toBe(1n);
        expect(getAddress(tx.from!)).toBe(getAddress(wallet.address));
        const call = ROUTER.parseTransaction({ data: tx.data, value: tx.value });
        expect(call?.name).toBe('swapExactETHForTokens');
        expect((call!.args[1] as string[]).map((a) => getAddress(a))).toEqual([getAddress(weth), getAddress(token)]);
        expect(getAddress(call!.args[2] as string)).toBe(getAddress(wallet.address));

        // The trades row, read from the real connection.
        const row = tradeRow()!;
        expect(row.status).toBe('pending');
        expect(row.action).toBe('buy');
        expect(row.token).toBe(token.toLowerCase());
        expect(row.chain).toBe('eth');
        expect(row.tx_hash).toBe(buy.hash);
    });
});
