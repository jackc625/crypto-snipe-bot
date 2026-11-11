// test/realpath/triage/AUD-BUY-028.test.ts
// Phase 23 plan 23-06 Task 3 (AUDIT-02): AUD-BUY-028, the liquidity-lock gate passes on any
// active lock, however small a share of the LP tokens it covers. src/utils/safetyProviders/
// unicrypt.ts passes when locks.some(unlock_date > now) and mudra.ts when locks.some(unlockDate >
// now); neither reads the locked amount or compares it with the LP supply. (goplus.ts never reads
// holder.percent either, but on base and Arbitrum, the GoPlus lock chains, every V2 launch is
// skipped first by AUD-BUY-016, so that site is not reachable on the real path today.)
//
// Proof on the real path: an ordinary V2 launch through the real listener and safety bank, with
// the lock API answering in the provider's own shape, for this pair, an active lock of 1 percent
// of the pair's LP supply (the scenario's own answer, its amount divided by 100; the rest stays
// with the deployer). ETH asks Unicrypt, BSC asks Mudra; each is its own claim. Measured: whether
// the bot bought. Correct: the gate refuses a lock that covers a sliver of the LP.
//
// Fix signal (D-08): requiring the active locks to cover at least half of the pair's LP supply
// reads "looks fixed" for each provider (fix-shaped src mutations, restored).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { harnessState, type HttpReply, type HttpRequestInfo } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, type Scenario } from '../harness/world';

const UNICRYPT = 'https://api.unicrypt.network/api/v2/locker/pair/';
const MUDRA = 'https://api.mudra.website/api/v1/locker/pair/';

function logged(msg: string): Array<Record<string, unknown> | undefined> {
    return recordedLogs()
        .filter((l) => l.msg === msg)
        .map((l) => l.obj);
}

async function stepUntilOrFor(pred: () => boolean, windowMs: number): Promise<void> {
    const end = Date.now() + windowMs;
    while (!pred() && Date.now() < end) await stepFor(500);
}

/**
 * Re-answer the scenario's own lock route for its pair with every lock's amount divided by 100.
 * Everything else about the answer (shape, unlock date, 404 for other pairs) is the scenario's.
 * Returns the full and the answered amounts the route gave for the pair.
 */
async function lockOnePercent(sc: Scenario<'v2'>, prefix: string, locksOf: (data: unknown) => Array<Record<string, unknown>>): Promise<{ full: bigint; answered: bigint }> {
    const route = harnessState().httpRoutes.find((r) => r.prefix === prefix);
    if (!route) throw new Error(`lockOnePercent: the scenario has no ${prefix} route`);
    const original = route.handler;
    const probeUrl = prefix === UNICRYPT ? `${UNICRYPT}${sc.pair.toLowerCase()}?chainId=${sc.ctx.chain.chainId}` : `${MUDRA}${sc.pair.toLowerCase()}`;
    const full = await original({ method: 'get', url: probeUrl, data: undefined, config: {} });
    const fullLocks = locksOf(full.data);
    expect(fullLocks).toHaveLength(1);
    const fullAmount = BigInt(String(fullLocks[0].amount));
    route.handler = async (req: HttpRequestInfo): Promise<HttpReply> => {
        const reply = await original(req);
        if (reply.status !== undefined && reply.status >= 400) return reply;
        const copy = JSON.parse(JSON.stringify(reply.data)) as unknown;
        for (const lock of locksOf(copy)) lock.amount = (BigInt(String(lock.amount)) / 100n).toString();
        return { ...reply, data: copy };
    };
    const after = locksOf((await route.handler({ method: 'get', url: probeUrl, data: undefined, config: {} })).data);
    return { full: fullAmount, answered: BigInt(String(after[0].amount)) };
}

/** Launch, let the bank decide, and return whether the bot bought. */
async function launchAndDecide(sc: Scenario<'v2'>, lockUrl: string): Promise<{ buySubmitted: boolean }> {
    const { node, dex } = sc;
    await sc.graph.bot.startDexListener(sc.ctx, dex, sc.registry);
    await stepUntilTrue(() => node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === dex.factoryAddress.toLowerCase()), { what: 'the factory subscription' });
    await sc.fireNewPair();
    await stepUntilOrFor(() => node.submitted.length > 0 || logged('Safety checks failed, skipping').length > 0, 60_000);
    // The lock API was asked about this pair (holds for the bug and for a fix).
    expect(harnessState().httpLog.some((h) => h.url.toLowerCase().startsWith(lockUrl))).toBe(true);
    return { buySubmitted: node.submitted.length > 0 };
}

/** Land the buy and wait until it is armed, so teardown cancels nothing. */
async function finishBuy(sc: Scenario<'v2'>): Promise<void> {
    const { node, graph } = sc;
    await stepFor(12_000);
    node.mine({ include: [node.submitted[0].hash] });
    await stepUntilTrue(() => graph.db.prepare('SELECT 1 FROM trades').get() !== undefined, { what: 'the trades row', maxSteps: 20_000 });
    const cursor = (): number | undefined => (graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get(sc.chain) as { b: number } | undefined)?.b;
    await stepUntilTrue(
        () => recordedLogs().some((l) => l.obj?.op === 'exit.monitor.started') && node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase())) && cursor() === node.head,
        { what: 'the position being armed', maxSteps: 20_000 },
    );
}

describe('AUD-BUY-028: the lock gate passes on any active lock, whatever share of the LP it covers', () => {
    it('unicrypt-one-percent-lock-passes: on ETH, a Unicrypt lock of 1 percent of the LP supply passes the lock gate and the bot buys', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        expect(sc.ctx.chain.safetyApis.liquidityLock).toBe('unicrypt');
        const { full, answered } = await lockOnePercent(sc, UNICRYPT, (d) => ((d as { locks?: Array<Record<string, unknown>> }).locks ?? []));
        expect(answered * 100n).toBe(full - (full % 100n));
        const result = await launchAndDecide(sc, `${UNICRYPT}${sc.pair.toLowerCase()}`);
        knownBug(ctx, 'AUD-BUY-028', {
            claim: 'unicrypt-one-percent-lock-passes',
            correct: { lockedShareOfLpPct: 1, buySubmitted: false },
            observed: { lockedShareOfLpPct: 1, buySubmitted: true },
            actual: { lockedShareOfLpPct: 1, buySubmitted: result.buySubmitted },
            expectedPlain: 'A pair whose locked LP is only 1 percent of its supply fails the liquidity-lock gate: the other 99 percent can be pulled at any time.',
            actualPlain: 'Unicrypt reported one active lock covering 1 percent of the LP; the gate counted any active lock as locked, so every check passed and the bot bought.',
        });
        expect(logged('All safety checks passed, buying')).toHaveLength(1);
        await finishBuy(sc);
    });

    it('mudra-one-percent-lock-passes: on BSC, a Mudra lock of 1 percent of the LP supply passes the lock gate and the bot buys', async (ctx) => {
        const sc = await createScenario({ chain: 'bsc', dexType: 'v2' });
        expect(sc.ctx.chain.safetyApis.liquidityLock).toBe('mudra');
        const { full, answered } = await lockOnePercent(sc, MUDRA, (d) => ((d as { data?: { locks?: Array<Record<string, unknown>> } }).data?.locks ?? []));
        expect(answered * 100n).toBe(full - (full % 100n));
        const result = await launchAndDecide(sc, `${MUDRA}${sc.pair.toLowerCase()}`);
        knownBug(ctx, 'AUD-BUY-028', {
            claim: 'mudra-one-percent-lock-passes',
            correct: { lockedShareOfLpPct: 1, buySubmitted: false },
            observed: { lockedShareOfLpPct: 1, buySubmitted: true },
            actual: { lockedShareOfLpPct: 1, buySubmitted: result.buySubmitted },
            expectedPlain: 'A pair whose locked LP is only 1 percent of its supply fails the liquidity-lock gate on BSC too.',
            actualPlain: 'Mudra reported one active lock covering 1 percent of the LP; the gate counted any active lock as locked, so every check passed and the bot bought.',
        });
        expect(logged('All safety checks passed, buying')).toHaveLength(1);
        await finishBuy(sc);
    });
});
