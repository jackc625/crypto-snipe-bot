// test/realpath/triage/AUD-TX-002.test.ts
// Phase 23 plan 23-09 Task 1 (AUDIT-02, AC-11, AC-12, SPEC nonce constraint): RC-10 (b), a wait()
// with no timeout runs inside the wallet's real withNonceLock, so a transaction that is never mined
// keeps the lock and every later buy and exit of that wallet waits behind it. One root cause, three
// sites, each its own test and its own knownBug (D-10, AC-11):
//   - AUD-TX-002: the Base/Arbitrum private-path strategy. src/utils/mevStrategies/passthrough.ts
//     sends the swap publicly and awaits tx.wait(3) with no timeout argument (its comment says the
//     wait "may TIME OUT"; with ethers 6.16.0 it cannot), inside submitWithReconciliation, inside
//     src/bot.ts submitBuyTx = withNonceLock(wallet, () => sendTxWithRetry(...)). A real base V3
//     snipe (route passthrough; base V2 snipes are skipped today by AUD-BUY-016).
//   - AUD-BUY-025: the deliberate buy's public leg. src/bot.ts executeDeliberateBuy, after its
//     private leg did not land and the no-double-buy guard cleared, runs
//     withNonceLock(wallet, async () => { stx = await router.swap...(); await stx.wait(); }).
//     A real ETH V2 deliberate buy whose two private attempts are not included.
//   - AUD-EXIT-009: an exit site. src/exitEngine.ts executeFullSell runs
//     withNonceLock(wallet, () => ensureApproval(...)), and ensureApproval awaits approveTx.wait()
//     with no timeout. A real ETH V2 position, bought and armed by the running bot, then the real
//     executeFullSell (reason stop-loss) on it.
//
// How "never mined" is made (review concern Codex 23-09 MEDIUM, both): the node accepts the bot's
// transaction into its public pool and FakeNode.neverMine keeps it out of every block, so the real
// eth_getTransactionReceipt answers a valid null and the wallet's `latest` nonce never moves, while
// the test mines a new block every 12 s of fake time, carrying the chain past any deadline a bounded
// wait could have had. Nothing is held: a held RPC call would prove a stalled transport instead
// (and on the bot's HTTP provider would stall every later call, AUD-TX-028).
//
// What is measured, per site, as a BOUNDED observation (review concern Codex 23-09 MEDIUM): one
// later operation for the same wallet is queued through the graph's own withNonceLock
// (fixtures/AUD-TX-002-lock.ts) right after the bot's transaction reached the node, and the test
// records whether that operation started within a stated window of 30 minutes of fake time (150
// blocks), and whether the stuck nonce was settled when it started (the wallet's mined count on the
// node, its `latest` nonce, was past the stuck transaction's nonce). Correct, as the finding's
// recommendation states it: the wait is bounded, the stuck nonce is settled (a same-nonce
// replacement or cancel is mined; pendingWindow mines every 12 s, so a replacement in the pool is
// included) and only then is the lock released, so the later operation starts inside the window
// on a settled nonce. Today: it does not start in the window. A fix that only bounds the wait and
// releases the lock with the stuck transaction still pending reads "the failure changed", not
// "looks fixed" (review CR-03): the next buy or sell would sign the same nonce. So does a lock
// released for an unrelated reason (an RPC error during the wait) with the nonce unsettled. The
// result is never stated as "forever".
//
// Controls (same file, one per site): the same path with the transaction mined and three
// confirmations mined (the transaction's block and two more) settles, frees the lock, and the
// later operation starts; the bot's own path then completes. At teardown the harness clears every
// fake timer and destroys the providers, so nothing left waiting keeps running.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Transaction, parseEther } from 'ethers';
import { encodeResult, type Submitted } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, expectStillPending, stepUntil, stepUntilTrue, type Scenario } from '../harness/world';
import { driveChain, heldPosition } from './fixtures/AUD-API-001-dashboard-sell';
import { buyRow, listen, opEntries, opLogged, subscribedTo } from './fixtures/AUD-EXIT-002-position';
import { approvalsSubmitted, sellsSubmitted } from './fixtures/AUD-EXIT-001-sell-path';
import { missBundlesUntil, pendingWindow, probeWalletLock, type LockProbe } from './fixtures/AUD-TX-002-lock';

/** The stated window: 30 minutes of fake time, a block every 12 s (150 blocks). */
const WINDOW_MS = 30 * 60_000;
const WINDOW_TEXT = 'a 30-minute fake-time window (150 blocks)';

function msgLogged(msg: string, from = 0): boolean {
    return recordedLogs().slice(from).some((l) => l.msg === msg);
}

/** Every eth_getTransactionReceipt the bot sent for `hash` (each answered with a valid null while it is not mined). */
function receiptPolls(sc: Scenario, hash: string): number {
    return sc.node.callLog.filter((c) => c.method === 'eth_getTransactionReceipt' && Array.isArray(c.params) && String((c.params as unknown[])[0]).toLowerCase() === hash.toLowerCase()).length;
}

function walletPublicSends(sc: Scenario, fromSubmit = 0): Submitted[] {
    const w = sc.wallet.address.toLowerCase();
    return sc.node.submitted.slice(fromSubmit).filter((s) => s.route === 'public' && (s.tx.from ?? '').toLowerCase() === w);
}

/** Launch the base V3 pool through the real listener and wait for the passthrough strategy to send the buy. */
async function baseSnipeSent(sc: Scenario<'v3'>): Promise<Submitted> {
    await listen(sc);
    await sc.fireNewPool();
    await stepUntilTrue(() => sc.node.submitted.length === 1, { what: 'the bot sending its base V3 buy (passthrough)', maxSteps: 20_000 });
    const buy = sc.node.submitted[0];
    if (buy.route !== 'public') throw new Error(`baseSnipeSent: expected the passthrough buy on the public route, got ${buy.route}`);
    return buy;
}

/** A deliberate ETH V2 buy whose two private attempts are not included, run up to its public send. */
async function deliberatePublicSent(sc: Scenario<'v2'>): Promise<{ buy: Promise<string | null>; publicSend: Submitted; settled(): boolean }> {
    // The pair already exists (a deliberate buy is made on a live pair); the factory answers getPair
    // for it, as the real one does, for the record-and-arm step.
    sc.node.setRead(sc.dex.factoryAddress, 'getPair(address,address)', encodeResult(['address'], [sc.pair]));
    const buy = sc.graph.bot.executeDeliberateBuy(sc.ctx, sc.token, parseEther(sc.ctx.chain.snipeAmount), sc.dex);
    let settled = false;
    buy.then(
        () => (settled = true),
        () => (settled = true),
    );
    await missBundlesUntil(sc, { until: () => walletPublicSends(sc).length > 0 || settled, what: 'the deliberate buy reaching its public send' });
    const sends = walletPublicSends(sc);
    if (sends.length !== 1) throw new Error(`deliberatePublicSent: expected one public send, got ${sends.length} (settled ${settled})`);
    return { buy, publicSend: sends[0], settled: () => settled };
}

/** The nonce of the transaction the node accepted as `hash` (throws if the node never saw it). */
function submittedNonce(sc: Scenario, hash: string): number {
    const s = sc.node.submitted.find((x) => x.hash === hash);
    if (!s) throw new Error(`submittedNonce: the node never accepted ${hash}`);
    return s.tx.nonce;
}

/**
 * True when the probe started with the stuck nonce settled: the wallet's mined count on the node
 * (its `latest` nonce) was past `stuckNonce` when the probe's body ran inside the lock.
 */
function stuckNonceSettled(probe: LockProbe, stuckNonce: number): boolean {
    const mined = probe.minedAtStart();
    return mined !== null && mined > stuckNonce;
}

/** Mine the transaction and two more blocks: three confirmations. */
function mineWithThreeConfirmations(sc: Scenario, hash: string): void {
    sc.node.mine({ include: [hash] });
    sc.node.mine({ include: [] });
    sc.node.mine({ include: [] });
}

describe('AUD-TX-002, AUD-BUY-025, AUD-EXIT-009: a wait() with no timeout inside the real withNonceLock (RC-10 never-settling wait)', () => {
    it(`passthrough-wait-holds-wallet-lock: a base V3 snipe whose transaction is never mined keeps the wallet lock, and a later operation for the wallet does not start within ${WINDOW_TEXT}`, async (ctx) => {
        const sc = await createScenario({ chain: 'base', dexType: 'v3' });
        expect(sc.ctx.chain.mevStrategy).toBe('passthrough');
        const buy = await baseSnipeSent(sc);
        sc.node.neverMine(buy.hash);
        const stuckNonce = submittedNonce(sc, buy.hash);
        // Setup fact, true under the bug and every fix: the stuck transaction holds the wallet's next nonce.
        expect(sc.node.minedCount(sc.wallet.address)).toBe(stuckNonce);
        const probe = await probeWalletLock(sc);
        const result = await pendingWindow(sc, probe, { windowMs: WINDOW_MS, what: 'the later operation for the wallet (AUD-TX-002 site)' });

        knownBug(ctx, 'AUD-TX-002', {
            claim: 'passthrough-wait-holds-wallet-lock',
            correct: { laterOperationStartedInWindow: true, stuckNonceSettledBeforeRelease: true },
            observed: { laterOperationStartedInWindow: false, stuckNonceSettledBeforeRelease: false },
            actual: { laterOperationStartedInWindow: result.settledAfterMs !== null, stuckNonceSettledBeforeRelease: stuckNonceSettled(probe, stuckNonce) },
            expectedPlain: 'On Base and Arbitrum a buy whose transaction is never mined gives up waiting after a bounded time, settles the stuck nonce (a same-nonce replacement or cancel is mined) and only then releases the wallet lock, so the wallet can buy and sell again without signing that nonce twice.',
            actualPlain: `The Base buy waited for 3 confirmations with no time limit while holding the wallet lock; the transaction was never mined and, over 30 minutes of fake time (150 new blocks), a later operation for the same wallet never started.`,
        });

        // The window, and what the bot did in it: it kept polling the receipt (a valid null) as
        // blocks mined, never logged a wait timeout or a confirmation, and wrote no trades row.
        expect(result).toEqual({ settledAfterMs: null, blocksMined: 150, windowMs: WINDOW_MS });
        expect(sc.node.statusOf(buy.hash)).toBe('accepted');
        expect(sc.node.minedCount(sc.wallet.address)).toBe(Transaction.from(buy.raw).nonce);
        expect(receiptPolls(sc, buy.hash)).toBeGreaterThan(100);
        expect(msgLogged('TX sent (passthrough)')).toBe(true);
        expect(msgLogged('TX confirmed')).toBe(false);
        expect(opLogged('passthrough.wait.timeout')).toBe(false);
        expect(sc.graph.db.prepare('SELECT COUNT(*) AS n FROM trades').get()).toEqual({ n: 0 });
        expect(sc.node.submitted).toHaveLength(1);
        await expectStillPending(probe.promise, 12_000, { what: 'the later operation for the wallet (AUD-TX-002 site), one more block' });
    });

    it('control (AUD-TX-002 site): the same base V3 snipe, mined with three confirmations, frees the wallet lock and the later operation starts', async () => {
        const sc = await createScenario({ chain: 'base', dexType: 'v3' });
        const buy = await baseSnipeSent(sc);
        const probe = await probeWalletLock(sc);
        await expectStillPending(probe.promise, 12_000, { what: 'the later operation while the buy is unmined' });
        mineWithThreeConfirmations(sc, buy.hash);
        const thirdBlockAt = Date.now();
        expect(await stepUntil(probe.promise, { maxSteps: 20_000 })).toBe('probe-ran');
        expect(probe.startedAt()!).toBeGreaterThanOrEqual(thirdBlockAt);
        expect(msgLogged('TX confirmed')).toBe(true);
        // The handler goes on to record and arm the position.
        await stepUntilTrue(() => opLogged('exit.monitor.started') && subscribedTo(sc, sc.pair), { what: 'the base V3 position being armed', maxSteps: 20_000 });
        expect(buyRow(sc)?.status).toBe('pending');
    });

    it(`deliberate-public-wait-holds-wallet-lock: a deliberate buy whose public transaction is never mined keeps the wallet lock, and a later operation for the wallet does not start within ${WINDOW_TEXT}`, async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { buy, publicSend, settled } = await deliberatePublicSent(sc);
        sc.node.neverMine(publicSend.hash);
        const stuckNonce = submittedNonce(sc, publicSend.hash);
        // Setup fact, true under the bug and every fix: the stuck transaction holds the wallet's next nonce.
        expect(sc.node.minedCount(sc.wallet.address)).toBe(stuckNonce);
        const probe = await probeWalletLock(sc);
        const result = await pendingWindow(sc, probe, { windowMs: WINDOW_MS, what: 'the later operation for the wallet (AUD-BUY-025 site)' });

        knownBug(ctx, 'AUD-BUY-025', {
            claim: 'deliberate-public-wait-holds-wallet-lock',
            correct: { laterOperationStartedInWindow: true, stuckNonceSettledBeforeRelease: true },
            observed: { laterOperationStartedInWindow: false, stuckNonceSettledBeforeRelease: false },
            actual: { laterOperationStartedInWindow: result.settledAfterMs !== null, stuckNonceSettledBeforeRelease: stuckNonceSettled(probe, stuckNonce) },
            expectedPlain: 'A deliberate public buy whose transaction is never mined gives up waiting after a bounded time, settles the stuck nonce (a same-nonce replacement or cancel is mined) and only then releases the wallet lock.',
            actualPlain: 'The deliberate buy\'s public leg waited for its receipt with no time limit while holding the wallet lock; the transaction was never mined and, over 30 minutes of fake time (150 new blocks), a later operation for the same wallet never started.',
        });

        expect(result).toEqual({ settledAfterMs: null, blocksMined: 150, windowMs: WINDOW_MS });
        expect(opLogged('buy.private.not-landed')).toBe(true);
        expect(opLogged('buy.fallback.public.submit')).toBe(true);
        expect(opLogged('buy.fallback.public.mined')).toBe(false);
        expect(sc.node.statusOf(publicSend.hash)).toBe('accepted');
        expect(receiptPolls(sc, publicSend.hash)).toBeGreaterThan(100);
        expect(settled()).toBe(false);
        expect(sc.graph.db.prepare('SELECT COUNT(*) AS n FROM trades').get()).toEqual({ n: 0 });
        await expectStillPending(buy, 12_000, { what: 'the deliberate buy, one more block' });
    });

    it('control (AUD-BUY-025 site): the same deliberate public buy, mined with three confirmations, frees the wallet lock and the later operation starts', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { buy, publicSend } = await deliberatePublicSent(sc);
        const probe = await probeWalletLock(sc);
        await expectStillPending(probe.promise, 12_000, { what: 'the later operation while the public buy is unmined' });
        mineWithThreeConfirmations(sc, publicSend.hash);
        expect(await stepUntil(probe.promise, { maxSteps: 20_000 })).toBe('probe-ran');
        expect(await stepUntil(buy, { maxSteps: 30_000 })).toBe(publicSend.hash);
        expect(opLogged('buy.fallback.public.mined')).toBe(true);
        await stepUntilTrue(() => opLogged('exit.monitor.started') && subscribedTo(sc, sc.pair), { what: 'the deliberate position being armed' });
    });

    it(`approval-wait-holds-wallet-lock: an exit whose approval is never mined keeps the wallet lock, and a later operation for the wallet does not start within ${WINDOW_TEXT}`, async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const pos = await heldPosition(sc);
        const fromSubmit = sc.node.submitted.length;
        const exit = sc.graph.exitEngine.executeFullSell(sc.ctx, sc.dex, sc.token, null, 'stop-loss', pos.tradeId, 'triage AUD-EXIT-009');
        let exitSettled = false;
        exit.then(
            () => (exitSettled = true),
            () => (exitSettled = true),
        );
        await stepUntilTrue(() => walletPublicSends(sc, fromSubmit).length > 0 || exitSettled, { what: 'the exit sending its approval', maxSteps: 20_000 });
        const [approve] = approvalsSubmitted(sc).filter((a) => sc.node.submitted.findIndex((s) => s.hash === a.hash) >= fromSubmit);
        sc.node.neverMine(approve.hash);
        const stuckNonce = submittedNonce(sc, approve.hash);
        // Setup fact, true under the bug and every fix: the stuck transaction holds the wallet's next nonce.
        expect(sc.node.minedCount(sc.wallet.address)).toBe(stuckNonce);
        const probe = await probeWalletLock(sc);
        const result = await pendingWindow(sc, probe, { windowMs: WINDOW_MS, what: 'the later operation for the wallet (AUD-EXIT-009 site)' });

        knownBug(ctx, 'AUD-EXIT-009', {
            claim: 'approval-wait-holds-wallet-lock',
            correct: { laterOperationStartedInWindow: true, stuckNonceSettledBeforeRelease: true },
            observed: { laterOperationStartedInWindow: false, stuckNonceSettledBeforeRelease: false },
            actual: { laterOperationStartedInWindow: result.settledAfterMs !== null, stuckNonceSettledBeforeRelease: stuckNonceSettled(probe, stuckNonce) },
            expectedPlain: 'An exit whose approval transaction is never mined gives up waiting after a bounded time, settles the stuck nonce (a same-nonce replacement or cancel is mined) and only then releases the wallet lock and the token\'s sell lock.',
            actualPlain: 'The exit waited for its approval receipt with no time limit while holding the wallet lock; the approval was never mined and, over 30 minutes of fake time (150 new blocks), a later operation for the same wallet never started.',
        });

        expect(result).toEqual({ settledAfterMs: null, blocksMined: 150, windowMs: WINDOW_MS });
        expect(sc.node.statusOf(approve.hash)).toBe('accepted');
        expect(approve.spender).toBe(sc.dex.routerAddress);
        expect(receiptPolls(sc, approve.hash)).toBeGreaterThan(100);
        expect(exitSettled).toBe(false);
        expect(sellsSubmitted(sc)).toEqual([]);
        expect(opLogged('exit.full.submitted')).toBe(false);
        // The never-settling wait also pins the token's sell lock: another exit of the token is refused.
        const lockFree = sc.graph.exitManager.tryAcquireSellLock('eth', sc.token);
        if (lockFree) sc.graph.exitManager.releaseSellLock('eth', sc.token);
        expect(lockFree).toBe(false);
        expect(buyRow(sc)?.status).toBe('pending');
        await expectStillPending(exit, 12_000, { what: 'the exit, one more block' });
    });

    it('control (AUD-EXIT-009 site): the same exit, its approval mined with three confirmations, frees the wallet lock, the later operation starts and the exit sells', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const pos = await heldPosition(sc);
        const fromSubmit = sc.node.submitted.length;
        const exit = sc.graph.exitEngine.executeFullSell(sc.ctx, sc.dex, sc.token, null, 'stop-loss', pos.tradeId, 'triage AUD-EXIT-009 control');
        let exitResult: boolean | undefined;
        exit.then((v) => (exitResult = v));
        await stepUntilTrue(() => walletPublicSends(sc, fromSubmit).length > 0, { what: 'the exit sending its approval', maxSteps: 20_000 });
        const approve = walletPublicSends(sc, fromSubmit)[0];
        const probe = await probeWalletLock(sc);
        await expectStillPending(probe.promise, 12_000, { what: 'the later operation while the approval is unmined' });
        mineWithThreeConfirmations(sc, approve.hash);
        expect(await stepUntil(probe.promise, { maxSteps: 20_000 })).toBe('probe-ran');
        // The exit then takes the lock again for its private sell, which lands.
        await driveChain(sc, { mode: 'land', until: () => exitResult !== undefined, what: 'the exit completing' });
        expect(exitResult).toBe(true);
        expect(buyRow(sc)?.status).toBe('sold');
        expect(opEntries('exit.full.submitted').map((o) => o.reason)).toEqual(['stop-loss']);
    });
});
