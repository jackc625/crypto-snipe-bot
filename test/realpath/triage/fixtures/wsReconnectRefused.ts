// test/realpath/triage/fixtures/wsReconnectRefused.ts
// Phase 23 plan 23-12 Task 1 (AUDIT-02, D-02, D-08): AUD-ANTIRUG-002 as a real process death.
// Started only by test/realpath/triage/AUD-ANTIRUG-002.test.ts through spawnRailedChild:
//   node -r ts-node/register/transpile-only <this file> <site> <mode>
//
// The finding: no WebSocket the bot builds has an 'error' listener, so a connect that is refused
// makes the ws library emit 'error' with no listener, which Node throws as an uncaught exception,
// and the whole process exits. Each site is one the finding names, reached through the bot's own
// code; this file never builds a WebSocketProvider itself:
//   detector  the real startChainAntiRugListener(ctx) (src/anti-rug/detector.ts) arms the socket's
//             close handler, which runs the private handleWsClose; that builds the new
//             WebSocketProvider in its reconnect loop.
//   dex-v3    the real startDexListener(ctx, dex, registry) (src/bot.ts) with the registry's first
//             V3 dex (isDexV3): its handleWsCloseV3 builds the new provider.
//   dex-v2    the same with the first V2 dex (isDexV2): its handleWsClose builds the new provider.
//   boot      the real getWsProvider (src/utils/provider.ts), the call createChainContext makes at
//             boot; BOOT_CONNECT_ATTEMPTED is printed just before it.
//
// Modes (23-12-PLAN.md Proof rules 2 to 4b):
//   fault      detector / dex: once the listener is armed, the loopback chain ends every
//              WebSocket from the server side and closes the listener (dropSockets closePort
//              true), so the bot's reconnect, 1 s later, meets a refused port. boot: the boot
//              connect itself meets a refused port.
//   healthy    the same, but the listener stays open (closePort false; boot: the port is open),
//              so the same reconnect (or boot connect) succeeds.
//   contained  fault, with process handlers registered first (installContainment).
// In fault and contained the listener is opened again REOPEN_AFTER_MS after the trigger, so a
// bot that survived the refusal and stayed in backoff can reconnect inside the window: that is
// the correct behavior the finding asks for, and it is what lets a real fix read "looks fixed"
// rather than "work pending". Today's first reconnect attempt is due 1 s after the trigger, so
// the 4 s reopen leaves a 3 s margin before a refusal could be missed.
//
// Work under test. Reconnect sites: the bot connected again over a WebSocket. WORK_SETTLED when, at
// the end of the window, a WebSocket connection the chain accepted after the trigger is open, and
// for the two DEX sites also carries the listener's re-made `logs` subscription (the anti-rug
// listener with no registered position sends nothing until asked, so for it the open connection
// is the whole result). Boot: the boot connect finished, either connected or failed with the
// bot's socket cleanly CLOSED (nothing at boot re-attempts a WebSocket). WORK_PENDING otherwise.
// BOT_WS_STATE <readyState> is printed for every run that is still alive. Survival window:
// WINDOW_MS of real time after the trigger (D-02: real ws on loopback, real time, never part of
// the recording).

import { installContainment, finishAlive, mark, parseMode, runFixture, setupError, sleep, startLoopbackChain, startTicker, until, type Mode } from './loopbackChain';

const SITES = ['detector', 'dex-v3', 'dex-v2', 'boot'] as const;
type Site = (typeof SITES)[number];

const REOPEN_AFTER_MS = 4_000;
const WINDOW_MS = 12_000;

function parseSite(raw: string | undefined): Site {
    if ((SITES as readonly string[]).includes(raw ?? '')) return raw as Site;
    return setupError(`unknown site ${JSON.stringify(raw)} (${SITES.join(', ')})`);
}

async function main(): Promise<void> {
    const site = parseSite(process.argv[2]);
    const mode: Mode = parseMode(process.argv[3]);
    // Proof rule 2, in this order: handlers, loopback ports and their URLs, then the modules.
    if (mode === 'contained') installContainment();

    const chain = await startLoopbackChain({ wsStartsClosed: site === 'boot' && mode !== 'healthy' });
    process.env.ETH_RPC_URL = chain.httpUrl;
    process.env.ETH_WS_URL = chain.wsUrl;
    process.env.DB_PATH = ':memory:';

    // The two modules the production entry loads (literal specifiers; spawnSites refuses a
    // computed one). Neither runMain nor startMultiChainBot is called: the bot stays off.
    await import('../../../../src/main');
    const bot = await import('../../../../src/bot');
    const reg = await import('../../../../src/chainRegistry');
    const registry = reg.buildChainRegistry();
    const cfg = registry.get('eth');
    if (!cfg) return setupError('the real registry has no eth chain');

    const ticker = { current: null as null | ReturnType<typeof startTicker> };
    let markAt = 0;
    let ctx: ReturnType<typeof reg.createChainContext>;

    if (site === 'boot') {
        const { getWsProvider } = await import('../../../../src/utils/provider');
        markAt = chain.wsMark();
        ticker.current = startTicker();
        mark('BOOT_CONNECT_ATTEMPTED');
        getWsProvider(cfg.name, cfg.wsRpcUrl, cfg.chainId);
        // createChainContext calls the same getWsProvider and gets the provider just built.
        ctx = reg.createChainContext(cfg);
    } else {
        ctx = reg.createChainContext(cfg);
        await until(() => chain.wsConnectedAfter(0), 10_000, 'the boot WebSocket to connect');
        if (site === 'detector') {
            const detector = await import('../../../../src/anti-rug/detector');
            await detector.startChainAntiRugListener(ctx);
        } else {
            const dex = site === 'dex-v3' ? cfg.dexes.find(reg.isDexV3) : cfg.dexes.find(reg.isDexV2);
            if (!dex) return setupError(`the real registry has no ${site} dex on eth`);
            await bot.startDexListener(ctx, dex, registry);
            await until(() => chain.logSubscriptions >= 1, 10_000, `the ${site} listener's eth_subscribe`);
        }
        mark(`ARMED ${site}`);
        markAt = chain.wsMark();
        ticker.current = startTicker();
        await chain.dropSockets({ closePort: mode !== 'healthy' });
        mark(`TRIGGER ${mode === 'healthy' ? 'sockets-dropped-port-open' : 'sockets-dropped-port-closed'}`);
    }

    if (mode !== 'healthy') {
        setTimeout(() => {
            chain
                .reopenWs()
                .then(() => mark('WS_REOPENED'))
                .catch((e: unknown) => setupError(`reopening the WebSocket port failed: ${String(e)}`));
        }, REOPEN_AFTER_MS);
    }

    await sleep(WINDOW_MS);
    // The readyState of the socket the bot holds now (ctx.wsProvider is replaced by each reconnect):
    // 1 OPEN, 3 CLOSED, and 2 (CLOSING) for a socket whose failed connect never emitted 'close',
    // because the ws library's emit('error') threw before it could.
    let state = 'none';
    try {
        state = String((ctx.wsProvider?.websocket as unknown as { readyState?: number } | undefined)?.readyState);
    } catch {
        state = 'destroyed';
    }
    mark(`BOT_WS_STATE ${state}`);
    // Reconnect sites: settled only when the bot is connected again (the DEX listeners also
    // re-subscribed). Boot: the operation is the boot connect itself, and nothing at boot re-attempts
    // a WebSocket, so it is settled when that attempt finished: connected, or failed and cleanly
    // CLOSED. A connect stuck CONNECTING or CLOSING is pending.
    const settled =
        chain.wsConnectedAfter(markAt, { subscribed: site === 'dex-v3' || site === 'dex-v2' }) || (site === 'boot' && state === '3');
    // The independent heartbeat call goes through the bot's own HTTP provider for this chain.
    const { getProvider } = await import('../../../../src/utils/provider');
    await finishAlive(ticker.current!, () => getProvider(cfg.name, cfg.httpRpcUrl).getBlockNumber(), settled);
}

runFixture(main);
