// test/realpath/triage/AUD-BUY-008.test.ts
// Phase 23 plan 23-10 Task 2 (AUDIT-02, AC-12): AUD-BUY-008 (RC-20), a dashboard restart stacks a
// second reconnect loop per DEX on the chain's WebSocket. Plan 23-32 moved both tests to a real
// in-process boot, so Start runs the bot's real onRestart.
//
// The sites (src/bot.ts startDexListener): each call subscribes the DEX's factory listener and adds
// its own close handler on the provider's raw socket (handleWsClose for V2, handleWsCloseV3 for
// V3). On a close, every handler runs its own loop: removeWsProvider, wait 1 s, build a new
// WebSocketProvider, write ctx.wsProvider, re-subscribe its factory listener there. The dashboard
// Stop route (src/api/routes/chains.ts) removes the provider's ethers listeners but not the
// raw-socket close handlers, and Start runs onRestart, which keeps the live provider and calls
// startDexListener again for every DEX: one more close handler each, on the same socket.
//
// Proof on the real path, with the order forced by a real socket drop and fake time (AC-12): a
// real in-process startMultiChainBot on the fake chain (fixtures/AUD-API-002-restart.ts
// withRealBoot, plan 23-24's recipe), which starts the real listeners for every DEX of the ETH
// chain (boot step 4) and the real dashboard API with the bot's own onRestart; the booted bot's
// dashboard (real login, real Stop and Start routes over loopback; Start runs the real onRestart,
// the private closure inside startMultiChainBot); then the fake node closes the socket from its
// side (node.dropSocket(), code 1006) and the fake clock runs 10 s, ten times the 1 s reconnect
// delay. Measured: how many reconnect loops ran for each DEX of the chain (each logs "WebSocket
// reconnected, re-subscribed to PairCreated", or "... to V3 PoolCreated", with its DEX name): the
// two V2 DEXes (handleWsClose) and the V3 DEX (handleWsCloseV3), which are separate close
// handlers. All three are in the marker, so a fix that makes only one handler's registration
// idempotent reads "the failure changed", never "looks fixed" (review CR-04). The control boots the same way
// and shows the same drop without a restart reconnecting each DEX once. Each test ends through
// the real SIGINT listener the boot added (operator decision 1A, plan 23-24).
//
// The boot also arms the anti-rug WebSocket lifecycle with no position (its own close handler on
// the same socket), so the drop also runs the anti-rug reconnect loop. Its lines carry no DEX name
// and its alert has another text, so it is in neither count below; where its provider ends up is
// AUD-ANTIRUG-001's claim.
//
// What two loops do next (each re-subscribes the factory listener, so every later PairCreated
// reaches the handler twice and AUD-BUY-004 lets both handlers buy) is not asserted here: the
// double buy is AUD-BUY-004's file, and the anti-rug consumer of the same shared handle is
// AUD-ANTIRUG-001's.
//
// Fix signal (D-08): a startDexListener that registers its close handler once per DEX and socket,
// for the V2 and the V3 handler alike (an idempotent registration, the finding's recommendation),
// reads "looks fixed" (in-memory mutant). The same registration made idempotent for V2 only leaves
// uniswap-v3 at two loops and reads "the failure changed" (in-memory mutant, review CR-04).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, type Scenario } from '../harness/world';
import { BOOT_OVERRIDES, chainRoute, deployBootContracts, withRealBoot } from './fixtures/AUD-API-002-restart';

// Each test pays a real boot and, first in the file, the cold import of the bot graph, so each has
// an explicit limit like test/realpath/ordering/boot.test.ts (a realpath test that times out keeps
// running into the next test, AUD-TESTI-029). Measured on Node 22.16.0 (plan 23-32): the control
// 1.21 s and restart-stacks-reconnect-loop 0.12 s alone; 1.39 s and 0.29 s under the full parallel
// run (210 files).
const RESTART_TEST_TIMEOUT_MS = 60_000;
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
    it('control: without a restart, one socket close reconnects each DEX once', { timeout: RESTART_TEST_TIMEOUT_MS }, async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: BOOT_OVERRIDES });
        deployBootContracts(sc);
        await withRealBoot(sc, async () => {
            const from = await dropAndWait(sc);
            for (const dex of sc.ctx.chain.dexes) {
                expect(reconnects(dex.name, from)).toBe(1);
                expect(factorySubscriptions(sc, dex.factoryAddress)).toBe(1);
            }
        });
    });

    it('restart-stacks-reconnect-loop: after a dashboard Stop and Start on a connected socket, one socket close runs two reconnect loops for the DEX', { timeout: RESTART_TEST_TIMEOUT_MS }, async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: BOOT_OVERRIDES });
        deployBootContracts(sc);
        await withRealBoot(sc, async ({ dash, cookie }) => {
            expect(await chainRoute(dash, cookie, 'eth', 'stop')).toEqual({ ok: true, chain: 'eth', status: 'stopped' });
            expect(await chainRoute(dash, cookie, 'eth', 'start')).toEqual({ ok: true, chain: 'eth', status: 'running', warnings: [] });
            // Start re-attached each factory listener on the still-connected socket (bug and fix alike).
            for (const dex of sc.ctx.chain.dexes) await stepUntilTrue(() => factorySubscriptions(sc, dex.factoryAddress) === 1, { what: `the ${dex.name} factory listener after Start` });
            const alertsBefore = recordedAlerts().length;
            const from = await dropAndWait(sc);

            // Every DEX of the chain, V2 (handleWsClose) and V3 (handleWsCloseV3), is measured in the one
            // marker: the ETH chain's three DEXes, named literally so `correct` never comes from `actual`.
            expect(sc.ctx.chain.dexes.map((d) => `${d.name}:${d.dexType}`)).toEqual(['uniswap-v2:v2', 'sushiswap-v2:v2', 'uniswap-v3:v3']);
            knownBug(ctx, 'AUD-BUY-008', {
                claim: 'restart-stacks-reconnect-loop',
                correct: { reconnectLoopsForOneClose: { 'uniswap-v2': 1, 'sushiswap-v2': 1, 'uniswap-v3': 1 } },
                observed: { reconnectLoopsForOneClose: { 'uniswap-v2': 2, 'sushiswap-v2': 2, 'uniswap-v3': 2 } },
                actual: { reconnectLoopsForOneClose: Object.fromEntries(sc.ctx.chain.dexes.map((d) => [d.name, reconnects(d.name, from)])) },
                expectedPlain: 'After a dashboard Stop and Start, one WebSocket close reconnects each DEX listener once, V2 and V3 alike.',
                actualPlain: 'After a dashboard Stop and Start, one WebSocket close ran two reconnect loops for every DEX of the chain (both V2 DEXes and the V3 DEX), each building its own provider and re-subscribing the factory listener there.',
            });
            // Bug details, after the marker: each loop sent its own disconnect alert. (Where the two
            // loops put the listener is not asserted: today each builds its own provider, so the node
            // holds two factory subscriptions; under the single-provider shape of AUD-ANTIRUG-001's fix
            // both would sit on one provider, still twice.)
            const disconnectAlerts = recordedAlerts()
                .slice(alertsBefore)
                .filter((a) => a.message === `WebSocket disconnected for ${sc.dex.name}, reconnecting...`);
            expect(disconnectAlerts).toHaveLength(2);
        });
    });
});
