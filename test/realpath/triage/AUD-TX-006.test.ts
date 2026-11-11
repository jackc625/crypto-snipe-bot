// test/realpath/triage/AUD-TX-006.test.ts
// Phase 23 plan 23-15 (AUDIT-02, candidate 26, RC-26): AUD-TX-006, the in-lock half.
//
// Finding: after every Flashbots bundle.wait() the strategy awaits
// flashbotsProvider.getBundleStatsV2 (src/utils/mevStrategies/flashbots.ts:343-366 at the audit
// base), and that code runs inside the submit closure, which runs inside the wallet's
// withNonceLock (src/bot.ts:264-268 for a buy; exitEngine.ts:788 and :1531 for sells). So every
// ETH attempt holds the wallet's nonce lock for one more relay round trip, up to the request's
// 300 s idle timeout if the relay hangs.
//
// Proof on the real path (review concern 23-15 MEDIUM: relay-log order alone does not show the
// mutex is still held): a real PairCreated drives the real listener, detection, safety and buy;
// real ethers signs the bundle; the simulated relay HOLDS the bot's flashbots_getBundleStatsV2
// call (node.hold). While it is held, a second operation for the same wallet is started through
// the real withNonceLock (the graph's own instance, shown by the control test below) and does not
// start. Releasing the held answer lets it start.
//
// The relay's answer. Research (STACK.md P-6) says the live relay has answered this method with
// HTTP 403 since 2025-06-09; the shared fake relay answers every relay call with HTTP 200
// (harness/chain.ts fetchHook), so it cannot send a 403 without a harness change, and the proof
// does not depend on the answer: the claim is measured while the call is held, before any answer
// exists. This test therefore asserts nothing about the answer's content. Plan 23-15 Task 3 sets
// the fake answer from the one recorded live response
// (.planning/audit/inputs/aud-tx-006-relay-response.json); if that response is an HTTP error
// status, replaying it needs the shared tools change and goes through the Harness Gap Procedure.
//
// The endpoint half of AUD-TX-006 (does the relay still answer the method?) is not provable in a
// test; it is settled, or left open, by the one manual request of AC-15
// (.planning/audit/tools/relay-probe-tx006.ts), sent only after operator approval.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, it, expect } from 'vitest';
import { harnessState } from '../harness/chain';
import { knownBug } from '../harness/knownBug';
import { createScenario, expectStillPending, stepFor, stepUntil, stepUntilTrue, type Scenario } from '../harness/world';

type NonceAuthorityModule = typeof import('../../../src/utils/nonceAuthority');

/**
 * The graph's own withNonceLock. loadGraph ran vi.resetModules() and then imported the graph, so
 * this import returns the module instance the bot's buy uses (a second copy would trip the Phase
 * 22 duplicate-load guard, and the control test proves the instance is shared).
 */
async function graphWithNonceLock(): Promise<NonceAuthorityModule['withNonceLock']> {
    const m = await import('../../../src/utils/nonceAuthority');
    return m.withNonceLock;
}

function opLogged(op: string): boolean {
    return harnessState().logs.some((l) => l.obj?.op === op);
}

/** Start the real listener and wait for its PairCreated subscription. */
async function listen(sc: Scenario): Promise<void> {
    await sc.graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
    await stepUntilTrue(
        () => sc.node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === sc.dex.factoryAddress.toLowerCase()),
        { what: 'the listener subscribing to PairCreated on the factory' },
    );
}

function tradeRow(sc: Scenario): { status: string; action: string; tx_hash: string } | undefined {
    return sc.graph.db.prepare('SELECT status, action, tx_hash FROM trades').get() as never;
}

/** Wait until the buy's position is armed, so the handler has finished before teardown. */
async function untilArmed(sc: Scenario): Promise<void> {
    const cursor = (): number | undefined => (sc.graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get('eth') as { b: number } | undefined)?.b;
    await stepUntilTrue(
        () =>
            opLogged('exit.monitor.started') &&
            sc.node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase())) &&
            cursor() === sc.node.head,
        { what: 'the position being armed (exit monitor, anti-rug subscription, block cursor)' },
    );
}

/** A promise that resolves once `predicate()` holds, checked on the fake clock. */
function whenTrue(predicate: () => boolean): Promise<void> {
    return new Promise<void>((resolve) => {
        const tick = (): void => {
            if (predicate()) resolve();
            else setTimeout(tick, 10);
        };
        tick();
    });
}

/**
 * How long the held telemetry call is kept outstanding: 60 s of fake time. The real request has
 * ethers' 300 s FetchRequest idle timeout (ethers lib.commonjs/utils/fetch.js:402), so a relay that
 * takes this long is still inside what production waits for.
 */
const HELD_MS = 60_000;

describe('AUD-TX-006: Flashbots per-builder telemetry runs inside the wallet nonce lock (candidate 26, RC-26)', () => {
    it('control: the withNonceLock this file imports is the one the bot\'s buy waits on (while the test holds the wallet lock, no bundle is sent; after release the buy goes through)', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node } = sc;
        const withNonceLock = await graphWithNonceLock();

        let releaseTestLock!: () => void;
        const testLockHeld = new Promise<void>((r) => (releaseTestLock = r));
        let testOpRunning = false;
        const testOp = withNonceLock(sc.wallet.address, async () => {
            testOpRunning = true;
            await testLockHeld;
            return 'test-op-done';
        });
        await stepUntilTrue(() => testOpRunning, { what: 'the test operation taking the wallet lock' });

        await listen(sc);
        const launch = await sc.fireNewPair();
        // The bot reaches its locked submit and waits there: no relay call, no submission.
        await stepFor(HELD_MS, 100);
        expect(node.relay).toHaveLength(0);
        expect(node.submitted).toHaveLength(0);
        expect(tradeRow(sc)).toBeUndefined();

        releaseTestLock();
        expect(await stepUntil(testOp)).toBe('test-op-done');
        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting its buy bundle after the test released the wallet lock' });
        const buy = node.submitted[0];
        expect(buy.route).toBe('bundle');
        await stepFor(12_000);
        expect(node.mine({ include: [buy.hash] })).toBe(launch.block + 1);
        await stepUntilTrue(() => tradeRow(sc) !== undefined, { what: 'the trades row for the buy' });
        await untilArmed(sc);
    });

    it('stats-call-inside-lock: while the bot\'s flashbots_getBundleStatsV2 request is held, a second operation for the same wallet cannot start; it starts only after the answer is released', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node } = sc;
        const withNonceLock = await graphWithNonceLock();
        const stats = node.hold('flashbots_getBundleStatsV2');

        await listen(sc);
        const launch = await sc.fireNewPair();
        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting its buy bundle' });
        const buy = node.submitted[0];
        expect(buy.route).toBe('bundle');
        const target = launch.block + 1;
        expect(buy.targetBlocks).toContain(target);

        // One slot passes, then a builder includes the bundle at its target block, so the real
        // bundle.wait() resolves and the strategy goes on to its telemetry call.
        await stepFor(12_000);
        expect(node.mine({ include: [buy.hash] })).toBe(target);
        // Either the telemetry call arrives and is held, or (once fixed by removing the call) the
        // buy completes without one; both are measured the same way below.
        await stepUntilTrue(() => stats.parkedNow === 1 || tradeRow(sc) !== undefined, { what: 'the bot\'s flashbots_getBundleStatsV2 call being held (or the buy completing)' });
        const statsHeld = stats.parkedNow === 1;
        if (statsHeld) {
            // The held call is the bot's own, for the bundle it just sent and the target block.
            const call = node.relay.filter((r) => r.method === 'flashbots_getBundleStatsV2');
            expect(call).toHaveLength(1);
            expect(call[0].url).toBe(sc.ctx.chain.mevConfig.relayUrl);
            const p0 = (call[0].params as Array<{ bundleHash?: string; blockNumber?: string }>)[0];
            expect(p0.blockNumber).toBe(`0x${target.toString(16)}`);
            expect(p0.bundleHash).toMatch(/^0x[0-9a-f]{64}$/);
        }

        // A second operation for the same wallet, through the real lock.
        let secondStartedAt: number | null = null;
        let statsStillHeldAtSecondStart: boolean | null = null;
        const second = withNonceLock(sc.wallet.address, async () => {
            secondStartedAt = Date.now();
            statsStillHeldAtSecondStart = stats.parkedNow === 1;
            return 'second-op-done';
        });
        await stepFor(HELD_MS, 100);
        const startedWhileHeld = secondStartedAt !== null;

        knownBug(ctx, 'AUD-TX-006', {
            claim: 'stats-call-inside-lock',
            correct: { secondOperationWaitedForTelemetry: false },
            observed: { secondOperationWaitedForTelemetry: true },
            actual: { secondOperationWaitedForTelemetry: !startedWhileHeld },
            expectedPlain: 'The Flashbots per-builder report request runs outside the wallet lock, so another trade for the same wallet can start while the report is still being fetched.',
            actualPlain: `The report request runs inside the wallet lock: while the relay had not answered it (held ${HELD_MS / 1000} s), another operation for the same wallet could not start, and the bot's buy was not recorded.`,
        });

        // Still held, and the buy's own submission has not finished (its trades row is written only
        // after the locked submit returns).
        expect(statsHeld).toBe(true);
        expect(stats.parkedNow).toBe(1);
        await expectStillPending(whenTrue(() => tradeRow(sc) !== undefined), 1_000, { what: 'the bot\'s buy submission (its trades row)' });

        // Release the answer: the bot's locked section ends and the second operation then starts.
        const releasedAt = Date.now();
        stats.release();
        expect(await stepUntil(second)).toBe('second-op-done');
        expect(secondStartedAt).not.toBeNull();
        expect(secondStartedAt!).toBeGreaterThanOrEqual(releasedAt);
        expect(statsStillHeldAtSecondStart).toBe(false);
        expect(stats.heldCount).toBe(1);

        await stepUntilTrue(() => tradeRow(sc) !== undefined, { what: 'the trades row for the buy' });
        expect(tradeRow(sc)!.tx_hash).toBe(buy.hash);
        await untilArmed(sc);
    });
});
