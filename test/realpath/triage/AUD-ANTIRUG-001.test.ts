// test/realpath/triage/AUD-ANTIRUG-001.test.ts
// Phase 23 plan 23-10 Task 2 (AUDIT-02, AC-12): AUD-ANTIRUG-001 (RC-13), three reconnect paths
// rewrite one shared ctx.wsProvider.
//
// The sites: src/anti-rug/detector.ts handleWsClose (a close handler on the socket for each
// startChainAntiRugListener call) waits 1 s, removeWsProvider(chain), builds its own
// WebSocketProvider, sets ctx.wsProvider and re-subscribes the rug-log filter on it. src/bot.ts
// startDexListener adds one close handler per DEX (handleWsClose for V2, handleWsCloseV3 for V3);
// each builds its own WebSocketProvider after 1 s, writes ctx.wsProvider and re-subscribes its own
// factory listener there. src/utils/provider.ts removeWsProvider destroys only the provider cached
// under the chain name, and none of the loop-built providers is ever cached. The anti-rug
// re-subscribe (startChainAntiRugListener) calls off() for its previous dispatcher and on() for the
// new filter on whatever ctx.wsProvider is at that moment.
//
// Proof on the real path, with the order forced by a real socket drop and fake time (AC-12): a
// real ETH V2 snipe through every DEX listener of the chain (boot step 4 starts uniswap-v2,
// sushiswap-v2 and uniswap-v3, fixtures/AUD-API-002-restart.ts bootListeners), bought and armed
// (exit monitor and anti-rug). The fake node then closes every socket from its side
// (node.dropSocket(), code 1006), as a node restart or a dropped connection would, and the fake
// clock is stepped past the 1 s reconnect delays. Provider facts come from the real objects
// (ctx.wsProvider and its socket) and subscription facts from the fake node's own list, each
// subscription carrying the socket that opened it.
//   - reconnect-leaves-subscription-off-ctx-provider: after one drop the rug-log subscription
//     exists once, but on the anti-rug loop's socket, while ctx.wsProvider ends on the provider of
//     whichever DEX loop wrote last.
//   - second-registration-duplicates-dispatch: a later buy on the chain (token B on sushiswap-v2,
//     fixtures/AUD-TX-003-second-launch.ts) registers through registerAntiRugPosition; its off()
//     runs against ctx.wsProvider, where the old dispatcher never was, and its on() adds a second
//     subscription covering pair A, so one LP transfer on pair A is evaluated twice.
//   - replaced-providers-left-alive: after one drop the providers ctx.wsProvider no longer points at
//     are not destroyed: their sockets stay open on the node.
// Each test asserts its own claim only. The DEX side of the same mechanism (one reconnect loop per
// close handler, a dashboard restart stacking another) is AUD-BUY-008's file; dashboard Stop
// removing the subscription is AUD-API-002's.
//
// Fix signal (D-08): one reconnect owner per chain that rebuilds the provider once and re-attaches
// every consumer on it, destroying what it replaces (card OD-11), reads "looks fixed" on all three
// claims; fix-shaped src mutations, restored.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Wallet, ethers, parseEther } from 'ethers';
import { FakeWebSocket, type Subscription } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, v2AmountOut, type Scenario } from '../harness/world';
import { driveChain } from './fixtures/AUD-API-001-dashboard-sell';
import { bootListeners } from './fixtures/AUD-API-002-restart';
import { installSellPath } from './fixtures/AUD-EXIT-001-sell-path';
import { buyAndMine, buyRow, opEntries, opLogged, waitAntiRugArmed } from './fixtures/AUD-EXIT-002-position';
import { settleAntiRugArming } from './fixtures/AUD-TX-002-lock';
import { secondLaunch } from './fixtures/AUD-TX-003-second-launch';

const DEAD = '0x000000000000000000000000000000000000dead';
const V2_PAIR = new Interface(['function transfer(address to, uint256 value) returns (bool)', 'event Transfer(address indexed from, address indexed to, uint256 value)']);

function covering(sc: Scenario, address: string): Subscription[] {
    return sc.node.subscriptions.filter((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(address.toLowerCase()));
}

function ctxSocket(sc: Scenario): FakeWebSocket | undefined {
    return (sc.ctx.wsProvider as unknown as { websocket?: FakeWebSocket } | null)?.websocket;
}

/** Sockets of the chain's WebSocket URL that are still open on the node side. */
function openSockets(sc: Scenario): FakeWebSocket[] {
    return FakeWebSocket.instances.filter((w) => w.url === sc.ctx.chain.wsRpcUrl && w.readyState === FakeWebSocket.OPEN);
}

/** A bought, armed ETH V2 position, with every DEX listener started as boot does. */
async function armedPosition(sc: Scenario<'v2'>): Promise<number> {
    await bootListeners(sc);
    const { buy } = await buyAndMine(sc);
    await waitAntiRugArmed(sc);
    expect(opLogged('exit.monitor.started')).toBe(true);
    installSellPath(sc, { bought: v2AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token) });
    expect(buyRow(sc)?.status).toBe('pending');
    return buyRow(sc)!.id;
}

/**
 * The fake node closes every socket from its side; step past the 1 s reconnect delays until the
 * chain's WebSocket is attached again, then stay settled.
 *
 * The wait is on the outcome every reconnect shape must reach, never on per-loop log text (review
 * CR-01): the dropped socket is gone, a new socket of the chain is open, the node holds a rug-log
 * subscription covering the pair, and every DEX factory is subscribed again. Today four loops reach
 * that state (the anti-rug loop and one per DEX close handler); the recommended fix (one reconnect
 * owner per chain, card OD-11) reaches it with one loop and one reconnect line, and the same wait
 * returns for both, so a correct fix reads "looks fixed" instead of stalling here.
 */
async function dropAndReconnect(sc: Scenario): Promise<void> {
    expect(openSockets(sc)).toHaveLength(1);
    const dropped = openSockets(sc)[0];
    sc.node.dropSocket();
    const reattached = (): boolean =>
        dropped.readyState === FakeWebSocket.CLOSED
        && FakeWebSocket.instances.some((w) => w !== dropped && w.url === sc.ctx.chain.wsRpcUrl && w.readyState === FakeWebSocket.OPEN)
        && covering(sc, sc.pair).length >= 1
        && sc.ctx.chain.dexes.every((d) => sc.node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(d.factoryAddress.toLowerCase())));
    await stepUntilTrue(reattached, { what: 'the chain WebSocket re-attached after the drop (rug-log filter and every DEX factory)', maxSteps: 2_000 });
    // Let the re-subscriptions and the anti-rug backfill reach the node, then stay settled.
    await stepFor(5_000);
}

/** An LP-token transfer of `pair` to `locker`, signed by an LP holder and mined with its Transfer log. */
function lpTransfer(sc: Scenario): (pair: string, locker: string) => Promise<void> {
    const holder = new Wallet(ethers.id('realpath.aud-antirug-001.lp-holder'));
    sc.node.setBalance(holder.address, parseEther('1'));
    return async (pair: string, locker: string): Promise<void> => {
        const raw = await holder.signTransaction({
            chainId: 1, nonce: sc.node.minedCount(holder.address), to: pair, value: 0n, gasLimit: 80_000n, type: 2,
            maxFeePerGas: 60_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
            data: V2_PAIR.encodeFunctionData('transfer', [locker, 1_000n]),
        });
        const hash = sc.node.addForeignTransaction(raw);
        const log = V2_PAIR.encodeEventLog('Transfer', [holder.address, locker, 1_000n]);
        sc.node.mine({ include: [hash], logs: [{ address: pair, topics: log.topics, data: log.data, transactionHash: hash }] });
    };
}

/** The evaluations of trade `tradeId` for a transfer to `destination`, logged since `from`. */
function evaluations(tradeId: number, destination: string, from: number): number {
    return opEntries('antirug.allowlist-hit', from).filter((o) => o.tradeId === tradeId && String(o.destination).toLowerCase() === destination.toLowerCase()).length;
}

describe('AUD-ANTIRUG-001: the anti-rug reconnect and the DEX reconnect loops each rewrite ctx.wsProvider', () => {
    it('reconnect-leaves-subscription-off-ctx-provider: after one socket drop the rug-log subscription exists once but on the anti-rug loop socket, while ctx.wsProvider ends on a DEX loop provider', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        await armedPosition(sc);
        expect(covering(sc, sc.pair).map((s) => s.connection.socket)).toEqual([ctxSocket(sc)]);
        await dropAndReconnect(sc);
        const subs = covering(sc, sc.pair);

        knownBug(ctx, 'AUD-ANTIRUG-001', {
            claim: 'reconnect-leaves-subscription-off-ctx-provider',
            correct: { rugLogSubscriptions: 1, onCtxWsProvider: true },
            observed: { rugLogSubscriptions: 1, onCtxWsProvider: false },
            actual: { rugLogSubscriptions: subs.length, onCtxWsProvider: subs.length === 1 && subs[0].connection.socket === ctxSocket(sc) },
            expectedPlain: 'After a WebSocket reconnect, the rug-log subscription lives on the same provider the chain context uses, so the next re-subscribe replaces it.',
            actualPlain: 'After one socket drop the anti-rug loop and the three DEX loops each built a provider; the rug-log subscription sits on the anti-rug one while ctx.wsProvider ended on a DEX loop provider.',
        });
        // Bug details, after the marker: the provider ctx.wsProvider holds carries a DEX factory
        // subscription, the anti-rug socket carries the rug-log filter, and the old socket is closed.
        const onCtx = sc.node.subscriptions.filter((s) => s.connection.socket === ctxSocket(sc));
        expect(onCtx).toHaveLength(1);
        expect(sc.ctx.chain.dexes.some((d) => JSON.stringify(onCtx[0].filter).toLowerCase().includes(d.factoryAddress.toLowerCase()))).toBe(true);
        expect(opEntries('antirug.ws.reconnected')).toHaveLength(1);
        expect(opEntries('antirug.listener.subscribed').length).toBe(2);
    });

    it('second-registration-duplicates-dispatch: after one drop, the next buy on the chain adds a second rug-log subscription for the earlier position, so one LP transfer on its pair is evaluated twice', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const tradeA = await armedPosition(sc);
        const b = secondLaunch(sc);
        await dropAndReconnect(sc);
        expect(covering(sc, sc.pair)).toHaveLength(1);

        // Token B launches on sushiswap-v2 once the per-chain snipe cooldown (30 s) has passed; its
        // listener (on its own reconnect provider) buys it, and the buy registers B with anti-rug.
        await stepFor(31_000);
        await b.fire();
        await driveChain(sc, { mode: 'land', until: () => opEntries('antirug.register').length === 2, what: "token B's buy registering with anti-rug" });
        await settleAntiRugArming(sc, 2);
        await stepFor(5_000);

        // One LP transfer on pair A, to an allowlisted locker: the cheapest verdict the evaluator logs.
        const locker = sc.ctx.chain.antiRug.allowlistV2.map((e) => e.address).find((a) => a.toLowerCase() !== DEAD)!;
        const from = recordedLogs().length;
        await lpTransfer(sc)(sc.pair, locker);
        await stepFor(3_000);
        const subs = covering(sc, sc.pair);

        knownBug(ctx, 'AUD-ANTIRUG-001', {
            claim: 'second-registration-duplicates-dispatch',
            correct: { rugLogSubscriptionsForPairA: 1, evaluationsOfOneLog: 1 },
            observed: { rugLogSubscriptionsForPairA: 2, evaluationsOfOneLog: 2 },
            actual: { rugLogSubscriptionsForPairA: subs.length, evaluationsOfOneLog: evaluations(tradeA, locker, from) },
            expectedPlain: 'A new buy after a reconnect replaces the rug-log subscription, so each LP log of an earlier position is evaluated once.',
            actualPlain: 'After one socket drop, the next buy on the chain added a second rug-log subscription covering the earlier pair on another provider, and one LP transfer on that pair was evaluated twice.',
        });
        // Bug details, after the marker: the two subscriptions sit on different sockets, the old one
        // with pair A alone and the new one on ctx.wsProvider with both pairs.
        expect(new Set(subs.map((s) => s.connection.socket)).size).toBe(2);
        const onCtx = subs.filter((s) => s.connection.socket === ctxSocket(sc));
        expect(onCtx).toHaveLength(1);
        expect(JSON.stringify(onCtx[0].filter).toLowerCase()).toContain(b.pair.toLowerCase());
        const old = subs.filter((s) => s.connection.socket !== ctxSocket(sc));
        expect(JSON.stringify(old[0].filter).toLowerCase()).not.toContain(b.pair.toLowerCase());
    });

    it('replaced-providers-left-alive: after one socket drop, the providers ctx.wsProvider no longer points at are not destroyed and their sockets stay open', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        await armedPosition(sc);
        const original = ctxSocket(sc);
        await dropAndReconnect(sc);
        const replacedOpen = openSockets(sc).filter((w) => w !== ctxSocket(sc));

        knownBug(ctx, 'AUD-ANTIRUG-001', {
            claim: 'replaced-providers-left-alive',
            correct: { replacedProvidersStillOpen: 0 },
            observed: { replacedProvidersStillOpen: sc.ctx.chain.dexes.length },
            actual: { replacedProvidersStillOpen: replacedOpen.length },
            expectedPlain: 'A reconnect destroys every provider it replaces, so only the provider the chain context uses keeps a socket open.',
            actualPlain: 'After one socket drop four providers were built and only one is in use; the three it replaced were never destroyed and their sockets stayed open.',
        });
        // Bug details, after the marker: the dropped socket is closed (the cached provider was
        // destroyed); the replaced ones still carry live subscriptions (the anti-rug filter among them).
        expect(original?.readyState).toBe(FakeWebSocket.CLOSED);
        expect(replacedOpen.every((w) => sc.node.subscriptions.some((s) => s.connection.socket === w))).toBe(true);
        expect(covering(sc, sc.pair).every((s) => replacedOpen.includes(s.connection.socket as FakeWebSocket))).toBe(true);
    });
});
