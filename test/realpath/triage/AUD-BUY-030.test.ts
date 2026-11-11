// test/realpath/triage/AUD-BUY-030.test.ts
// Phase 23 plan 23-05 Task 3 (AUDIT-02): AUD-BUY-030, the deliberate public buy is not pinned to
// the private attempt's nonce. In src/bot.ts executeDeliberateBuy the no-double-buy guard reads
// the wallet's `latest` nonce (step 2b), then awaits the live affordability re-check, a fresh
// quote and an alert, and only then sends the public swap through
// router.swapExactETHForTokensSupportingFeeOnTransferTokens with no nonce, so ethers fills in the
// next one ('pending'). If the last private bundle lands inside that window, the public buy takes
// the next nonce and becomes a second buy, instead of replacing the private one.
//
// Proof on the real path, with the late landing forced exactly (AC-12): the real
// executeDeliberateBuy runs its real private leg on the simulated relay (two attempts at one
// nonce, each not included at its first target block, so `latest` never moves), its real guard
// (reconcile over the confirm window, then balanceOf and `latest`), and its real public leg. The
// public leg's own nonce read, eth_getTransactionCount for the wallet after the bot logged
// buy.fallback.public.submit, is held on the node; while it is held a builder includes the last
// private attempt at a block it was still targeting; then the read is released. Every block is
// mined by name (FakeNode.mine({ include })), and `latest` counts mined transactions only.
//
// What is measured: how many buys landed for the one deliberate intent. Correct is one (a pinned
// public send at the private nonce can only replace it, and here is refused as nonce too low; a
// fix that re-checks before sending sends nothing). Both fixes read as "looks fixed" (D-08). The
// two decoded nonces are asserted right after the marker.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, it, expect } from 'vitest';
import { Interface, Transaction, getAddress, parseEther } from 'ethers';
import { encodeResult, type Submitted } from '../harness/chain';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue } from '../harness/world';

const V2_ROUTER = new Interface([
    'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
    'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
]);

function opLogged(op: string): boolean {
    return recordedLogs().some((l) => l.obj?.op === op);
}

function opCount(op: string): number {
    return recordedLogs().filter((l) => l.obj?.op === op).length;
}

function decode(raw: string): { nonce: number; name: string; to: string; value: bigint } {
    const tx = Transaction.from(raw);
    const call = V2_ROUTER.parseTransaction({ data: tx.data, value: tx.value });
    if (!call) throw new Error(`decode: ${tx.hash} is not a router swap`);
    return { nonce: tx.nonce, name: call.name, to: getAddress(tx.to!), value: tx.value };
}

describe('AUD-BUY-030: the deliberate public buy is not pinned to the private attempt nonce', () => {
    it('public-buy-not-pinned-to-private-nonce: the last private attempt lands after the guard read the nonce, and the public buy takes the next nonce and lands as a second buy', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node, wallet, dex } = sc;
        // The pair already exists (a deliberate buy is made on a live pair); the factory answers
        // getPair for it, as the real one does, for the record-and-arm step.
        node.setRead(dex.factoryAddress, 'getPair(address,address)', encodeResult(['address'], [sc.pair]));
        const amountIn = parseEther(sc.ctx.chain.snipeAmount);
        const head = node.head;
        const startNonce = node.minedCount(wallet.address);

        // Held: the public leg's nonce read (ethers fills a missing nonce from 'pending').
        const publicNonceRead = node.hold('eth_getTransactionCount', { to: wallet.address, after: () => opLogged('buy.fallback.public.submit') });

        const buy = sc.graph.bot.executeDeliberateBuy(sc.ctx, sc.token, amountIn, dex);
        let buyResult: string | null | undefined;
        let buyError: unknown;
        let settled = false;
        buy.then(
            (v) => {
                buyResult = v;
                settled = true;
            },
            (e: unknown) => {
                buyError = e;
                settled = true;
            },
        );

        // Private attempt 0 (nonce N), not included at its first target block.
        await stepUntilTrue(() => node.submitted.length === 1, { what: 'private attempt 0' });
        const p0 = node.submitted[0];
        expect(p0.route).toBe('bundle');
        await stepFor(12_000);
        expect(node.mine({ include: [] })).toBe(head + 1);
        // Private attempt 1 at the same nonce after the 45 s confirm window, not included either.
        await stepUntilTrue(() => node.submitted.length === 2, { what: 'private attempt 1', maxSteps: 20_000 });
        const p1 = node.submitted[1];
        expect(p1.route).toBe('bundle');
        expect(decode(p1.raw).nonce).toBe(decode(p0.raw).nonce);
        expect(p1.targetBlocks).toEqual([head + 2, head + 3, head + 4]);
        await stepFor(12_000);
        expect(node.mine({ include: [] })).toBe(head + 2);
        // The private leg gives up, the guard reconciles attempt 1 (not landed), checks balanceOf
        // and `latest` (both unchanged), re-checks affordability, quotes, and starts the public
        // buy, whose nonce read is now held. (A fix that pins the nonce makes no such read and
        // sends at once; one that re-checks inside the lock has its own read held here.)
        const publicSends = (): string[] =>
            node.callLog.filter((c) => c.method === 'eth_sendRawTransaction').map((c) => String((c.params as unknown[])[0]));
        await stepUntilTrue(() => publicNonceRead.parkedNow === 1 || publicSends().length > 0 || settled, { what: 'the public leg reading its nonce (or sending)', maxSteps: 30_000 });
        expect(opLogged('buy.private.not-landed')).toBe(true);
        expect(opLogged('buy.fallback.public.submit')).toBe(true);
        expect(node.minedCount(wallet.address)).toBe(startNonce);
        const heldWhenLanded = publicNonceRead.parkedNow;

        // The late landing: a builder includes private attempt 1 at a block it still targets.
        expect(node.mine({ include: [p1.hash] })).toBe(head + 3);
        expect(node.statusOf(p1.hash)).toBe('mined');
        expect(node.statusOf(p0.hash)).toBe('dropped');
        if (heldWhenLanded === 1) publicNonceRead.release();

        // The public leg sends (or a fix refuses or skips it). A sent public buy still waiting in
        // the pool is mined; one at the private nonce was dropped by the private landing. The
        // count of landed buys is then fixed, whatever the deliberate buy goes on to do.
        await stepUntilTrue(() => publicSends().length > 0 || settled, { what: 'the public leg sending (or the deliberate buy settling)', maxSteps: 20_000 });
        const publicSub: Submitted | undefined = node.submitted.find((s) => s.route === 'public');
        if (publicSub && node.statusOf(publicSub.hash) === 'accepted') expect(node.mine({ include: [publicSub.hash] })).toBe(head + 4);

        const landedBuys = node.submitted.filter((s) => node.statusOf(s.hash) === 'mined' && s.tx.from?.toLowerCase() === wallet.address.toLowerCase() && s.tx.to?.toLowerCase() === dex.routerAddress.toLowerCase());
        knownBug(ctx, 'AUD-BUY-030', {
            claim: 'public-buy-not-pinned-to-private-nonce',
            correct: { buysLanded: 1 },
            observed: { buysLanded: 2 },
            actual: { buysLanded: landedBuys.length },
            expectedPlain: 'A deliberate buy whose private attempt lands late spends once: the public buy is pinned to the private attempt\'s nonce, so it can only replace it.',
            actualPlain: 'The private attempt landed after the safety check read the nonce; the public buy then took the next nonce and landed too, so one deliberate buy spent twice.',
        });

        // The deliberate buy completes on the public hash and arms the position it recorded: the
        // exit monitor, the anti-rug subscription on the pair, and the anti-rug backfill. (On this
        // fresh database the backfill takes its "gap detected" branch, AUD-ANTIRUG-024, so the
        // block cursor is not at the head; that is not what this finding is about.)
        await stepUntilTrue(() => settled, { what: 'the deliberate buy settling', maxSteps: 30_000 });
        await stepUntilTrue(
            () =>
                opLogged('exit.monitor.started') &&
                node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase())) &&
                recordedLogs().some((l) => typeof l.obj?.op === 'string' && l.obj.op.startsWith('antirug.backfill.')),
            { what: 'the deliberate position being armed (exit monitor, anti-rug subscription on the pair, backfill)' },
        );
        // The landing happened while the public leg's own nonce read was held.
        expect(heldWhenLanded).toBe(1);
        // The two decoded nonces: the private buy at N, the public buy at N + 1.
        const priv = decode(p1.raw);
        const pub = decode(publicSends()[0]);
        expect(priv).toMatchObject({ nonce: startNonce, name: 'swapExactETHForTokens', to: getAddress(dex.routerAddress), value: amountIn });
        expect(pub).toMatchObject({ nonce: startNonce + 1, name: 'swapExactETHForTokensSupportingFeeOnTransferTokens', to: getAddress(dex.routerAddress), value: amountIn });
        expect(landedBuys.map((s) => s.hash)).toEqual([p1.hash, publicSub!.hash]);
        expect(buyError).toBeUndefined();
        expect(buyResult).toBe(publicSub!.hash);
        // The guard cleared because it read the nonce before the private bundle landed.
        expect(opCount('buy.fallback.aborted.chain-truth')).toBe(0);
        expect(recordedAlerts().some((a) => String(a.message).startsWith('*[DELIBERATE BUY → PUBLIC]*'))).toBe(true);
        expect(publicNonceRead.heldCount).toBe(1);
        // The public leg's trades row is the only one: the late private landing is not recorded.
        const rows = sc.graph.db.prepare('SELECT tx_hash FROM trades WHERE token = ?').all(sc.token.toLowerCase()) as Array<{ tx_hash: string }>;
        expect(rows.map((r) => r.tx_hash)).toEqual([publicSub!.hash]);
    });
});
