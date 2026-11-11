// test/realpath/triage/AUD-BUY-008.test.ts
// Phase 23 plan 23-10 Task 2 (AUDIT-02, AC-12): AUD-BUY-008 (RC-20), a dashboard restart stacks a
// second reconnect loop per DEX on the chain's WebSocket.
//
// The sites (src/bot.ts startDexListener): each call subscribes the DEX's factory listener and adds
// its own close handler on the provider's raw socket (handleWsClose for V2, handleWsCloseV3 for
// V3). On a close, every handler runs its own loop: removeWsProvider, wait 1 s, build a new
// WebSocketProvider, write ctx.wsProvider, re-subscribe its factory listener there. The dashboard
// Stop route (src/api/routes/chains.ts) removes the provider's ethers listeners but not the
// raw-socket close handlers, and Start runs onRestart, which keeps the live provider and calls
// startDexListener again for every DEX: one more close handler each, on the same socket.
//
// Proof on the real path, with the order forced by a real socket drop and fake time (AC-12): the
// real listeners for every DEX of the ETH chain, as boot step 4 starts them
// (fixtures/AUD-API-002-restart.ts bootListeners); the real dashboard (real login, real Stop and
// Start routes over loopback, the Start callback a source-pinned mirror of the private src/bot.ts
// onRestart, which fails by name if that closure changes); then the fake node closes the socket
// from its side (node.dropSocket(), code 1006) and the fake clock runs 10 s, ten times the 1 s
// reconnect delay. Measured: how many reconnect loops ran for the uniswap-v2 DEX (each logs
// "WebSocket reconnected, re-subscribed to PairCreated" with its DEX name). The control shows the
// same drop without a restart reconnecting each DEX once.
//
// What two loops do next (each re-subscribes the factory listener, so every later PairCreated
// reaches the handler twice and AUD-BUY-004 lets both handlers buy) is not asserted here: the
// double buy is AUD-BUY-004's file, and the anti-rug consumer of the same shared handle is
// AUD-ANTIRUG-001's.
//
// Fix signal (D-08): a startDexListener that registers its close handler once per DEX and socket
// (an idempotent registration, the finding's recommendation) reads "looks fixed" (fix-shaped src
// mutation, restored).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, type Scenario } from '../harness/world';
import { dashboardOverrides } from './fixtures/AUD-API-001-dashboard-sell';
import { bootListeners, chainRoute, openDashboardWithRestart } from './fixtures/AUD-API-002-restart';

const RECONNECTED = ['WebSocket reconnected, re-subscribed to PairCreated', 'WebSocket reconnected, re-subscribed to V3 PoolCreated'];

/** Reconnect loops that finished for `dex` since log index `from`. */
function reconnects(dex: string, from: number): number {
    return recordedLogs()
        .slice(from)
        .filter((l) => RECONNECTED.includes(String(l.msg)) && l.obj?.dex === dex).length;
}

function factorySubscriptions(sc: Scenario, factory: string): number {
    return sc.node.subscriptions.filter((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(factory.toLowerCase())).length;
}

/** The node closes every socket from its side; then 10 s of fake time (ten reconnect delays). */
async function dropAndWait(sc: Scenario): Promise<number> {
    const from = recordedLogs().length;
    sc.node.dropSocket();
    await stepFor(10_000);
    return from;
}

describe('AUD-BUY-008: a dashboard restart adds a second reconnect loop per DEX on the same socket', () => {
    it('control: without a restart, one socket close reconnects each DEX once', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        await bootListeners(sc);
        const from = await dropAndWait(sc);
        for (const dex of sc.ctx.chain.dexes) {
            expect(reconnects(dex.name, from)).toBe(1);
            expect(factorySubscriptions(sc, dex.factoryAddress)).toBe(1);
        }
    });

    it('restart-stacks-reconnect-loop: after a dashboard Stop and Start on a connected socket, one socket close runs two reconnect loops for the DEX', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: await dashboardOverrides() });
        await bootListeners(sc);
        const { dash, cookie } = await openDashboardWithRestart(sc);
        expect(await chainRoute(dash, cookie, 'eth', 'stop')).toEqual({ ok: true, chain: 'eth', status: 'stopped' });
        expect(await chainRoute(dash, cookie, 'eth', 'start')).toEqual({ ok: true, chain: 'eth', status: 'running', warnings: [] });
        // Start re-attached each factory listener on the still-connected socket (bug and fix alike).
        for (const dex of sc.ctx.chain.dexes) await stepUntilTrue(() => factorySubscriptions(sc, dex.factoryAddress) === 1, { what: `the ${dex.name} factory listener after Start` });
        const alertsBefore = recordedAlerts().length;
        const from = await dropAndWait(sc);

        knownBug(ctx, 'AUD-BUY-008', {
            claim: 'restart-stacks-reconnect-loop',
            correct: { reconnectLoopsForOneClose: 1 },
            observed: { reconnectLoopsForOneClose: 2 },
            actual: { reconnectLoopsForOneClose: reconnects(sc.dex.name, from) },
            expectedPlain: 'After a dashboard Stop and Start, one WebSocket close reconnects each DEX listener once.',
            actualPlain: 'After a dashboard Stop and Start, one WebSocket close ran two reconnect loops for the DEX, each building its own provider and re-subscribing the factory listener there.',
        });
        // Bug details, after the marker: every DEX of the chain got the second loop, and each loop
        // sent its own disconnect alert. (Where the two loops put the listener is not asserted: today
        // each builds its own provider, so the node holds two factory subscriptions; under the
        // single-provider shape of AUD-ANTIRUG-001's fix both would sit on one provider, still twice.)
        for (const dex of sc.ctx.chain.dexes) expect(reconnects(dex.name, from)).toBe(2);
        const disconnectAlerts = recordedAlerts()
            .slice(alertsBefore)
            .filter((a) => a.message === `WebSocket disconnected for ${sc.dex.name}, reconnecting...`);
        expect(disconnectAlerts).toHaveLength(2);
    });
});
