// test/realpath/triage/fixtures/AUD-API-002-restart.ts
// Phase 23 plan 23-10 (AUDIT-02): the dashboard Stop/Start pair and the boot listener set, for the
// WebSocket-lifecycle triage files of this plan (AUD-API-002, AUD-BUY-008, AUD-ANTIRUG-001). Lives
// beside its tests: the harness is read-only for triage plans. Nothing here mocks anything, and
// nothing adds behavior to the simulated node.
//
// - bootListeners: what startMultiChainBot does per chain at boot (src/bot.ts step 4): the real
//   startDexListener for EVERY DEX of the chain, in registry order. Each one adds its own factory
//   listener and its own close handler on the chain's one WebSocket.
// - openDashboardWithRestart: the real dashboard API (src/api/server.ts startApiServer, the real
//   login, the real POST /api/chains/:name/stop and /start routes) on a loopback port, through
//   fixtures/AUD-BUY-011-dashboard.ts, with a restart callback.
// - The restart callback. The real one, `onRestart`, is a closure inside startMultiChainBot
//   (src/bot.ts), which only a full boot builds (preflight, every chain context, Telegram, signal
//   handlers), and this phase never boots the bot. So the callback here is a line-for-line mirror
//   of that closure, run on the scenario graph's own module instances (loadGraph reset the module
//   registry and imported the graph, so these imports return the instances the bot uses):
//   replace ctx.wsProvider through removeWsProvider + getWsProvider only when it is missing or
//   destroyed, run the MEV health check, then startDexListener for every DEX of the chain.
//   A mirror can drift from the code it copies, so it is pinned: assertOnRestartUnchanged() hashes
//   the closure's source text in src/bot.ts and fails, by name, the moment that text changes. A
//   Phase 24 fix inside onRestart therefore turns these tests red with "onRestart changed" (re-point
//   the mirror), never into a silent stale pass.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChainContext } from '../../../../src/chainRegistry';
import { stepUntilTrue, type Scenario } from '../../harness/world';
import { startDashboard, type Dashboard } from './AUD-BUY-011-dashboard';
import { subscribedTo } from './AUD-EXIT-002-position';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** sha256 of the onRestart closure in src/bot.ts (LF line ends), when this mirror was written. */
const ON_RESTART_SHA256 = '8cea5dd27d26eaed85b578f4efcb4e73da4728373d1c8769f07c4d79d5cc49d3';
const ON_RESTART_START = '    const onRestart = async (ctx: ChainContext)';
const ON_RESTART_END = '\n    };\n';

/** The onRestart closure's source text in src/bot.ts as it is on disk now. */
export function onRestartSource(): string {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'src', 'bot.ts'), 'utf8').replace(/\r\n/g, '\n');
    const start = text.indexOf(ON_RESTART_START);
    if (start < 0) throw new Error('onRestart changed: src/bot.ts no longer declares `const onRestart = async (ctx: ChainContext)`; re-point the restart mirror in fixtures/AUD-API-002-restart.ts');
    const end = text.indexOf(ON_RESTART_END, start);
    if (end < 0) throw new Error('onRestart changed: the end of the onRestart closure was not found in src/bot.ts; re-point the restart mirror');
    return text.slice(start, end + ON_RESTART_END.length);
}

/** Fail by name when src/bot.ts onRestart no longer matches the closure this mirror copies. */
export function assertOnRestartUnchanged(): void {
    const sha = createHash('sha256').update(onRestartSource()).digest('hex');
    if (sha !== ON_RESTART_SHA256) {
        throw new Error(`onRestart changed: src/bot.ts onRestart hashes to ${sha}, not the ${ON_RESTART_SHA256} this mirror copies; re-point the restart mirror in fixtures/AUD-API-002-restart.ts before trusting the Start half of these tests`);
    }
}

type RestartCallback = (ctx: ChainContext) => Promise<{ warnings: string[] }>;

/** The mirror of src/bot.ts onRestart (see the file header), on the scenario graph's modules. */
export async function onRestartMirror(sc: Scenario): Promise<RestartCallback> {
    assertOnRestartUnchanged();
    const { removeWsProvider, getWsProvider } = await import('../../../../src/utils/provider');
    const { createMevStrategy } = await import('../../../../src/utils/txManager');
    const { startDexListener } = sc.graph.bot;
    const registry = sc.registry;
    return async (ctx: ChainContext): Promise<{ warnings: string[] }> => {
        const warnings: string[] = [];
        if (!ctx.wsProvider || ctx.wsProvider.destroyed) {
            if (ctx.chain.wsRpcUrl) {
                removeWsProvider(ctx.chain.name);
                const newWs = getWsProvider(ctx.chain.name, ctx.chain.wsRpcUrl, ctx.chain.chainId);
                ctx.wsProvider = newWs;
                ctx.log.info('WebSocket provider reconnected for chain restart');
            } else {
                warnings.push('No WebSocket URL configured, using HTTP polling');
            }
        }
        try {
            const strategy = createMevStrategy(ctx.chain);
            const mevHealthy = await strategy.healthCheck();
            if (!mevHealthy) {
                warnings.push('MEV service unreachable');
                ctx.log.warn('MEV service unreachable during chain restart');
            }
        } catch (err) {
            warnings.push(`MEV health check failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        for (const dex of ctx.chain.dexes) {
            try {
                await startDexListener(ctx, dex, registry);
                ctx.log.info({ dex: dex.name }, 'DEX listener restarted');
            } catch (err) {
                const msg = `Failed to restart ${dex.name}: ${err instanceof Error ? err.message : String(err)}`;
                warnings.push(msg);
                ctx.log.error({ err, dex: dex.name }, 'Failed to restart DEX listener');
            }
        }
        if (warnings.length > 0) {
            ctx.log.warn({ warnings }, 'Chain restarted with warnings');
        }
        return { warnings };
    };
}

/** The real dashboard API with the restart mirror as its onRestart, logged in. */
export async function openDashboardWithRestart(sc: Scenario): Promise<{ dash: Dashboard; cookie: string }> {
    const { startApiServer } = await import('../../../../src/api/server');
    const onRestart = await onRestartMirror(sc);
    const dash = await startDashboard(((contexts: never[]) => startApiServer(contexts, onRestart)) as never, [sc.ctx]);
    const cookie = await dash.login();
    return { dash, cookie };
}

/** Boot step 4 of startMultiChainBot for the scenario chain: every DEX listener, in order. */
export async function bootListeners(sc: Scenario): Promise<void> {
    for (const dex of sc.ctx.chain.dexes) {
        await sc.graph.bot.startDexListener(sc.ctx, dex, sc.registry);
        await stepUntilTrue(() => subscribedTo(sc, dex.factoryAddress), { what: `the ${dex.name} listener subscribing to its factory` });
    }
}

/** POST a dashboard chain route with the session and expect HTTP 200 with the given status. */
export async function chainRoute(dash: Dashboard, cookie: string, chain: string, action: 'stop' | 'start'): Promise<unknown> {
    const r = await dash.request('POST', `/api/chains/${chain}/${action}`, { cookie });
    if (r.status !== 200) throw new Error(`POST /api/chains/${chain}/${action}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
}
