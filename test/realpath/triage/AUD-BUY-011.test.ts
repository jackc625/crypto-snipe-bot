// test/realpath/triage/AUD-BUY-011.test.ts
// Phase 23 plan 23-06 Task 3 (AUDIT-02): AUD-BUY-011, dashboard "stop chain" does not stop
// buying. The real stop route (src/api/routes/chains.ts POST /:name/stop) only adds the chain to
// stoppedChains and calls ctx.wsProvider.removeAllListeners() when a WebSocket provider exists.
// Nothing that buys reads stoppedChains: the HTTP pollers (src/bot.ts startHttpPollingListener,
// a setInterval whose handle is discarded) keep polling and buying, and Telegram alpha drops
// (src/telegramListener.ts) still route to the stopped chain.
//
// Proof on the real path: the real dashboard server (src/api/server.ts startApiServer) on a
// loopback port, the real login flow (POST /api/auth/login with DASHBOARD_API_KEY, the session
// cookie), and the real POST /api/chains/eth/stop, called with node:http (fixtures/
// AUD-BUY-011-dashboard.ts). GET /api/chains then reports the chain "stopped". Then a real ETH
// V2 launch is mined:
//   - http-poller-buys-after-stop: on a chain configured without a WebSocket URL (ETH_WS_URL
//     empty), the real listener is the HTTP poller; it still finds the PairCreated through
//     eth_getLogs and the bot submits a buy.
//   - telegram-routes-to-stopped-chain: on a WebSocket chain, stop does remove the factory
//     listener (the launch's PairCreated buys nothing, which holds either way); a Telegram message
//     from an allowlisted sender naming the token still routes to the stopped chain and the bot
//     submits a buy.
// Not proven here: "start" adding a second poller (its onRestart callback is private to
// startMultiChainBot); it stays code-read in the finding.
//
// Fix signal (D-08): a stopped-chain check at the top of handleNewPairForChain reads "looks
// fixed" on both claims (fix-shaped src mutation, restored).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { recordedLogs } from '../harness/capture';
import { encodeResult } from '../harness/chain';
import { knownBug } from '../harness/knownBug';
import { deliverTelegramMessage } from '../harness/telegram';
import { createScenario, stepFor, stepUntil, stepUntilTrue, type Scenario } from '../harness/world';
import { LOOPBACK_DASHBOARD_ENV, startDashboard, type Dashboard } from './fixtures/AUD-BUY-011-dashboard';

function logged(msg: string): Array<Record<string, unknown> | undefined> {
    return recordedLogs()
        .filter((l) => l.msg === msg)
        .map((l) => l.obj);
}

/** Step the clock until `pred` holds or `windowMs` of virtual time has passed. */
async function stepUntilOrFor(pred: () => boolean, windowMs: number): Promise<void> {
    const end = Date.now() + windowMs;
    while (!pred() && Date.now() < end) await stepFor(500);
}

/** The real dashboard for this scenario's graph, logged in. */
async function dashboardFor(sc: Scenario<'v2'>): Promise<{ dash: Dashboard; cookie: string }> {
    const { startApiServer } = await import('../../../src/api/server');
    const dash = await startDashboard(startApiServer as never, [sc.ctx]);
    const cookie = await dash.login();
    return { dash, cookie };
}

/** Stop the chain through the real route, and read back what the dashboard shows. */
async function stopChain(dash: Dashboard, cookie: string): Promise<void> {
    // Without the session the route is refused (the real auth middleware is in front of it).
    const refused = await dash.request('POST', '/api/chains/eth/stop');
    expect(refused.status).toBe(401);
    const stop = await dash.request('POST', '/api/chains/eth/stop', { cookie });
    expect(stop.status).toBe(200);
    expect(stop.body).toEqual({ ok: true, chain: 'eth', status: 'stopped' });
    const shown = await dash.request('GET', '/api/chains', { cookie });
    expect(shown.status).toBe(200);
    expect((shown.body as { chains: Array<{ name: string; status: string }> }).chains.map((c) => [c.name, c.status])).toEqual([['eth', 'stopped']]);
    expect(logged('Chain listeners stopped via dashboard')).toHaveLength(1);
}

/** Land the buy and wait until it is armed, so teardown cancels nothing. */
async function finishBuy(sc: Scenario<'v2'>, armedWhen: () => boolean): Promise<void> {
    const { node, graph } = sc;
    await stepFor(12_000);
    node.mine({ include: [node.submitted[0].hash] });
    await stepUntilTrue(() => graph.db.prepare('SELECT 1 FROM trades').get() !== undefined, { what: 'the trades row for the buy', maxSteps: 20_000 });
    await stepUntilTrue(() => recordedLogs().some((l) => l.obj?.op === 'exit.monitor.started') && armedWhen(), { what: 'the position being armed', maxSteps: 20_000 });
}

describe('AUD-BUY-011: dashboard Stop does not stop buying on the chain', () => {
    it('http-poller-buys-after-stop: on a chain without a WebSocket URL, after the real stop route the HTTP poller still finds a new pair and the bot buys', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { ETH_WS_URL: '', ...LOOPBACK_DASHBOARD_ENV } });
        const { node, graph } = sc;
        expect(sc.ctx.wsProvider).toBeNull();
        await graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
        await stepUntilTrue(() => logged('Listening for PairCreated events via HTTP polling').length === 1, { what: 'the HTTP poller starting' });
        const { dash, cookie } = await dashboardFor(sc);
        await stopChain(dash, cookie);

        const callsBeforeLaunch = node.callLog.length;
        const launch = await sc.fireNewPair();
        await stepUntilOrFor(() => node.submitted.length > 0, 60_000);
        knownBug(ctx, 'AUD-BUY-011', {
            claim: 'http-poller-buys-after-stop',
            correct: { chainShownStopped: true, buySubmittedAfterStop: false },
            observed: { chainShownStopped: true, buySubmittedAfterStop: true },
            actual: { chainShownStopped: true, buySubmittedAfterStop: node.submitted.length > 0 },
            expectedPlain: 'After the operator presses Stop for a chain in the dashboard, the bot makes no new buys on that chain.',
            actualPlain: 'The dashboard showed the chain stopped, but on a chain without a WebSocket URL the HTTP poller kept running, found the new pair and the bot sent a buy.',
        });
        // Bug details, after the marker: the poller itself kept querying the factory after the
        // stop, and its query covered the launch block.
        const factoryQueries = node.callLog
            .slice(callsBeforeLaunch)
            .filter((c) => c.method === 'eth_getLogs' && JSON.stringify(c.params).toLowerCase().includes(sc.dex.factoryAddress.toLowerCase()));
        expect(factoryQueries.length).toBeGreaterThan(0);
        expect(factoryQueries.some((c) => {
            const f = (c.params as Array<{ fromBlock?: string; toBlock?: string }>)[0];
            return Number(f.fromBlock) <= launch.block && Number(f.toBlock) >= launch.block;
        })).toBe(true);
        expect(logged('New pair detected').some((o) => String(o?.pair).toLowerCase() === sc.pair.toLowerCase())).toBe(true);
        await finishBuy(sc, () => true);
    });

    it('telegram-routes-to-stopped-chain: on a WebSocket chain, the real stop route removes the factory listener, yet a Telegram alpha drop from an allowlisted sender still routes to the stopped chain and the bot buys', async (ctx) => {
        const sc = await createScenario({
            chain: 'eth',
            dexType: 'v2',
            overrides: { ...LOOPBACK_DASHBOARD_ENV, TELEGRAM_ALLOWED_SENDERS: '111222333', TELEGRAM_ALLOWED_CHANNELS: '-1001112223334' },
        });
        const { node, graph, dex, pair, token } = sc;
        await graph.bot.startDexListener(sc.ctx, dex, sc.registry);
        await stepUntilTrue(() => node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === dex.factoryAddress.toLowerCase()), { what: 'the factory subscription' });
        const { dash, cookie } = await dashboardFor(sc);
        await stopChain(dash, cookie);

        // The WebSocket factory listener is gone: the launch reaches no handler (holds for the bug
        // and for a fix).
        await sc.fireNewPair();
        await stepFor(10_000);
        expect(logged('New pair detected')).toHaveLength(0);
        expect(node.submitted).toHaveLength(0);

        // A trusted alpha drop for the token, on the live pair.
        node.setRead(dex.factoryAddress, 'getPair(address,address)', encodeResult(['address'], [pair]));
        await graph.telegramListener.startTelegramListener([sc.ctx]);
        await stepUntil(deliverTelegramMessage({ text: `alpha ${token}`, senderId: '111222333', chatId: '-1001112223334' }));
        await stepUntilOrFor(() => node.submitted.length > 0, 60_000);
        knownBug(ctx, 'AUD-BUY-011', {
            claim: 'telegram-routes-to-stopped-chain',
            correct: { chainShownStopped: true, buySubmittedAfterStop: false },
            observed: { chainShownStopped: true, buySubmittedAfterStop: true },
            actual: { chainShownStopped: true, buySubmittedAfterStop: node.submitted.length > 0 },
            expectedPlain: 'After the operator presses Stop for a chain, a Telegram alpha drop does not buy on that chain.',
            actualPlain: 'The dashboard showed the chain stopped and its factory listener was removed, but the Telegram listener still routed the alpha drop to the stopped chain and the bot sent a buy.',
        });
        expect(logged('Routing alpha drop to chains')).toEqual([{ address: token.toLowerCase(), chains: ['eth'] }]);
        await finishBuy(sc, () => node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(pair.toLowerCase())));
    });
});
