// test/realpath/triage/fixtures/AUD-API-002-restart.ts
// Phase 23 plans 23-10 and 23-32 (AUDIT-02): the dashboard Stop/Start pair and the boot listener
// set, for the WebSocket-lifecycle triage files (AUD-API-002, AUD-BUY-008, AUD-ANTIRUG-001). Lives
// beside its tests: the harness is read-only for triage plans. Nothing here mocks anything, and
// nothing adds behavior to the simulated node. It reads no src/ or scripts/ file as text.
//
// - bootListeners (plan 23-10, unchanged): what startMultiChainBot does per chain at boot
//   (src/bot.ts step 4): the real startDexListener for EVERY DEX of the chain, in registry order.
//   Each one adds its own factory listener and its own close handler on the chain's one
//   WebSocket. AUD-ANTIRUG-001.test.ts uses it; it never restarts a chain.
// - withRealBoot (plan 23-32, operator ruling 2026-11-12 "Fix it now"): one real in-process
//   startMultiChainBot on the scenario's fake chain, the recipe of test/realpath/ordering/boot.test.ts
//   (plan 23-24), so the dashboard Start route runs the bot's REAL onRestart, the private closure
//   inside startMultiChainBot, instead of a copy of it. The boot runs the real preflight, builds its
//   own chain context (providers are cached per chain in src/utils/provider.ts, so it shares the
//   scenario context's HTTP and WebSocket provider objects on the fake node), starts every DEX
//   listener, arms the anti-rug WebSocket lifecycle with no position (no position exists at boot,
//   so nothing is resumed and AUD-ANTIRUG-025's resume drop cannot take part: every test buys after
//   the boot), starts the real dashboard API with its onRestart and installs the real SIGINT/SIGTERM
//   handler. The test then reaches the real login and the real POST /api/chains/:name/stop and
//   /start routes over loopback.
//   Setup the boot needs, all through public harness calls (deployBootContracts, BOOT_OVERRIDES):
//   contract code at the HoneypotChecker and every anti-rug allowlist address (preflight and the
//   allowlist check read getCode); DASHBOARD_API_KEY of 16 characters or more (preflight cross-env
//   rule 5; test/.env.test's sentinel is 13); DASHBOARD_HOST=127.0.0.1 and DASHBOARD_PORT=0. The
//   bot logs the configured port 0, so the bound server is read from Node's
//   tracing:net.server.listen diagnostics channel, which observes the listen and mocks nothing.
//   The boot's own lines are checked as setup facts that hold under every finding's fix: one SIGINT
//   and one SIGTERM listener added, one server on 127.0.0.1, no warning, no exit call, and as the
//   only error line at most one antirug.backfill.gap-detected (SUSPECT(AUD-ANTIRUG-024): the fresh
//   database's false gap; its fix removes the line, which still passes).
//   How it ends (operator decision 1A at plan 23-24, "Pin how far it gets"): after the subscription
//   traffic settles, through the real SIGINT listener the boot added, with the permitted
//   process.exit spy. Today the real cleanup logs shutdown.cleanup and shutdown.api, stops the API
//   server, clears the bot's timer registry and destroys the WebSocket provider of the boot's
//   context, then stops at its require('./utils/db'), which a Vitest worker cannot resolve; the
//   two-stage handler catches that, so shutdown.complete and exit(0) never happen here (a
//   test-environment limit, deferred-items.md, owner Phase 28). The end fails loudly, naming this
//   file, if the limit is lifted. What the real cleanup never reaches is closed by the harness
//   teardown (setup.ts afterEach, world.ts stopGraphParts): the database (step 4), the HTTP
//   provider and the scenario context's WebSocket provider (step 3, the same cached objects), the
//   two untracked 5-minute intervals, the armed 8 s force-exit timer and the parked reconnect
//   loops' delay timers (step 2, fake timers), and every old socket's listeners (step 3). The
//   SIGINT/SIGTERM listeners the boot added are removed, also when the body failed.
// - chainRoute (plan 23-10, unchanged): one dashboard chain route with the session cookie.

import * as dc from 'node:diagnostics_channel';
import * as http from 'node:http';
import * as net from 'node:net';
import { expect, vi } from 'vitest';
import { recordedLogs } from '../../harness/capture';
import { stepUntil, stepUntilTrue, type Scenario } from '../../harness/world';
import type { Dashboard, DashboardReply } from './AUD-BUY-011-dashboard';
import { subscribedTo } from './AUD-EXIT-002-position';

const DEAD = '0x000000000000000000000000000000000000dead';
/** Runtime code for a deployed contract (the checker and the allowlist lockers are contracts). */
const CONTRACT_CODE = '0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063';
const LISTEN_END = 'tracing:net.server.listen:asyncEnd';
const LISTEN_START = 'tracing:net.server.listen:asyncStart';
/** The real-time event loop turn, captured when this module loads (before any fake clock). */
const REAL_SET_IMMEDIATE: (cb: () => void) => unknown = globalThis.setImmediate;

/**
 * Env overrides for the in-process boot (set before the graph loads): the dashboard on a random
 * free loopback port, and an API key of 27 characters (preflight cross-env rule 5 needs 16+).
 */
export const BOOT_OVERRIDES: Readonly<Record<string, string>> = { DASHBOARD_HOST: '127.0.0.1', DASHBOARD_PORT: '0', DASHBOARD_API_KEY: 'realpath-restart-triage-key' };

/** Give the checker and every anti-rug allowlist address contract code, as on mainnet. */
export function deployBootContracts(sc: Scenario): void {
    sc.node.setCode(sc.checker, CONTRACT_CODE);
    for (const e of [...sc.ctx.chain.antiRug.allowlistV2, ...sc.ctx.chain.antiRug.allowlistV3]) if (e.address.toLowerCase() !== DEAD) sc.node.setCode(e.address, CONTRACT_CODE);
}

type LogLine = ReturnType<typeof recordedLogs>[number];

/** A log line's label: its op when it has one, else its message. */
function label(l: LogLine): string {
    return typeof l.obj?.op === 'string' ? `op:${l.obj.op}` : (l.msg ?? '');
}

/** Settle `p` while letting both clocks move: one fake 10 ms step, then one real event-loop turn. */
async function settleWithBothClocks<T>(p: Promise<T>, what: string): Promise<T> {
    let state: 'pending' | 'done' | 'failed' = 'pending';
    let value!: T;
    let err: unknown;
    p.then(
        (v) => {
            state = 'done';
            value = v;
        },
        (e: unknown) => {
            state = 'failed';
            err = e;
        },
    );
    for (let i = 0; i < 20_000 && state === 'pending'; i++) {
        if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
        await new Promise<void>((resolve) => REAL_SET_IMMEDIATE(resolve));
    }
    if (state === 'pending') throw new Error(`${what}: not settled after 20000 turns`);
    if (state === 'failed') throw err;
    return value;
}

function rawCall(port: number, method: string, urlPath: string, headers: Record<string, string>, body?: string): Promise<DashboardReply> {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent: false, headers: { connection: 'close', ...headers } }, (res) => {
            let text = '';
            res.on('data', (c: Buffer) => (text += c.toString('utf8')));
            res.on('end', () => {
                let parsed: unknown = text;
                try {
                    parsed = text === '' ? null : JSON.parse(text);
                } catch {
                    /* keep the text */
                }
                const raw = res.headers['set-cookie'];
                resolve({ status: res.statusCode ?? 0, body: parsed, setCookie: Array.isArray(raw) ? raw : raw ? [raw] : [] });
            });
        });
        req.on('error', reject);
        req.end(body);
    });
}

/** A client for the booted bot's own dashboard API on 127.0.0.1:port (node:http, no keep-alive). */
function loopbackDashboard(port: number): Dashboard {
    const request: Dashboard['request'] = (method, urlPath, opts = {}) => {
        const headers: Record<string, string> = {};
        if (opts.cookie) headers.cookie = opts.cookie;
        let body: string | undefined;
        if (opts.json !== undefined) {
            body = JSON.stringify(opts.json);
            headers['content-type'] = 'application/json';
            headers['content-length'] = String(Buffer.byteLength(body));
        }
        return settleWithBothClocks(rawCall(port, method, urlPath, headers, body), `${method} ${urlPath}`);
    };
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        request,
        async login(): Promise<string> {
            const r = await request('POST', '/api/auth/login', { json: { apiKey: process.env.DASHBOARD_API_KEY } });
            if (r.status !== 200) throw new Error(`login: HTTP ${r.status} ${JSON.stringify(r.body)}`);
            const session = r.setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('session='));
            if (!session) throw new Error(`login: no session cookie in ${JSON.stringify(r.setCookie)}`);
            return session;
        },
    };
}

/** What a plain TCP connect to 127.0.0.1:port gets: 'connected' or the error code. */
function connectOutcome(port: number): Promise<string> {
    return settleWithBothClocks(
        new Promise((resolve) => {
            const s = net.connect({ host: '127.0.0.1', port });
            s.once('connect', () => {
                s.destroy();
                resolve('connected');
            });
            s.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
        }),
        `connect 127.0.0.1:${port}`,
    );
}

/**
 * Wait until no eth_subscribe or eth_unsubscribe has reached the node for one virtual second, so
 * neither the signal nor the harness teardown destroys a provider under an in-flight subscription
 * request (ethers would cancel it into an unhandled rejection). A bounded wait (stepUntilTrue).
 */
async function settleSubscriptionTraffic(sc: Scenario, what: string): Promise<void> {
    const traffic = (): number => sc.node.callLog.filter((c) => c.method === 'eth_subscribe' || c.method === 'eth_unsubscribe').length;
    let last = traffic();
    let since = Date.now();
    await stepUntilTrue(
        () => {
            const n = traffic();
            if (n !== last) {
                last = n;
                since = Date.now();
            }
            return Date.now() - since >= 1_000;
        },
        { what: `the subscription traffic settling ${what}` },
    );
}

/** The booted bot, as a test body sees it. */
export interface RealBoot {
    /** The real dashboard API the boot started, at its bound loopback port. */
    dash: Dashboard;
    /** The session cookie from the real login route. */
    cookie: string;
    port: number;
    /** Log and node-call positions where the boot began. */
    fromLog: number;
    fromCall: number;
}

interface BootRun {
    server: net.Server;
    port: number;
    exitCalls: unknown[];
    sigint: () => void;
}

/** The first SIGINT's cleanup lines today, in order, synchronously inside the listener call. */
const CLEANUP_TODAY = [
    'Graceful shutdown begun (two-stage SIGINT) — send the signal again to force-exit now',
    'op:shutdown.cleanup',
    'op:shutdown.api',
    'Dashboard API server stopped',
    'Error during graceful shutdown cleanup — grace timer will force exit',
];
/** The first line of each reconnect loop a closed socket starts (DEX V2, DEX V3, anti-rug). */
const RECONNECT_STARTS = new Set(['WebSocket disconnected, reconnecting', 'WebSocket disconnected (V3), reconnecting', 'op:antirug.ws.disconnected']);

/**
 * End the boot through its real SIGINT listener and pin how far the real cleanup gets today
 * (operator decision 1A, plan 23-24). `armedToken` is a position whose exit timer the cleanup must
 * clear. Everything checked here holds under every triage finding's fix.
 */
async function endThroughSigint(sc: Scenario, run: BootRun, armedToken: string | undefined): Promise<void> {
    await settleSubscriptionTraffic(sc, 'before the signal');
    if (armedToken) expect(sc.graph.exitManager.hasExitMonitorTimer('eth', armedToken), 'the exit timer before the signal').toBe(true);
    const openBefore = sc.node.openSocketCount;
    const socketsBefore = sc.node.socketsOpened;
    const from = recordedLogs().length;

    run.sigint();

    const lines = recordedLogs().slice(from);
    if (lines.some((l) => l.obj?.op === 'shutdown.complete') || run.exitCalls.length > 0) {
        throw new Error(
            'TEST-ENVIRONMENT LIMIT LIFTED in test/realpath/triage/fixtures/AUD-API-002-restart.ts: the first SIGINT now reaches ' +
                `shutdown.complete or process.exit (exit calls ${JSON.stringify(run.exitCalls)}). The cleanup's require('./utils/db') ` +
                'resolves under Vitest now. Update endThroughSigint (and test/realpath/ordering/boot.test.ts): assert shutdown.complete ' +
                'and exit(0), and drop the steps that say the harness teardown closes the database (deferred-items.md, plan 23-24 entry).',
        );
    }
    expect(lines.map(label), 'how far the real cleanup gets today').toEqual(CLEANUP_TODAY);
    expect(lines[0].obj).toEqual({ signal: 'SIGINT', graceMs: 8000 });
    expect(lines[4].level).toBe('error');
    expect(String(lines[4].obj?.err)).toMatch(/^Cannot find module '\.\/utils\/db'/);
    // The API server stopped: not listening, and a new connection to its port is refused.
    expect(run.server.listening).toBe(false);
    expect(await connectOutcome(run.port)).toBe('ECONNREFUSED');
    // The bot's timer registry was cleared.
    if (armedToken) expect(sc.graph.exitManager.hasExitMonitorTimer('eth', armedToken), 'the exit timer after the signal').toBe(false);
    // The WebSocket provider the boot's context holds was destroyed: exactly one open socket
    // closed. (Which provider that is depends on what the test did: after a reconnect it is the
    // one the last loop wrote, AUD-ANTIRUG-001, so it is counted on the node, not named.)
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(sc.node.openSocketCount, 'open sockets after the signal').toBe(openBefore - 1);
    // The closed socket's handlers start their reconnect loops (process.exit is the spy here, so
    // the process does not end inside the cleanup as in production); each parks on its first fake
    // delay timer, which teardown step 2 clears. Every warning after the cleanup is such a start,
    // and no socket was opened.
    const after = recordedLogs().slice(from + lines.length).filter((l) => l.level === 'warn' || l.level === 'error' || l.level === 'fatal').map(label);
    expect(after.length, 'reconnect loops started by the destroyed socket').toBeGreaterThan(0);
    expect(after.filter((x) => !RECONNECT_STARTS.has(x)), 'warnings after the cleanup that are not a reconnect start').toEqual([]);
    expect(sc.node.socketsOpened).toBe(socketsBefore);
    // Not reached by the cleanup: the database (closed by teardown step 4).
    expect(sc.graph.db.open).toBe(true);
    expect(run.exitCalls).toEqual([]);
}

/**
 * Boot the real bot in process on the scenario's chain (call deployBootContracts first, and create
 * the scenario with BOOT_OVERRIDES), log in to its own dashboard API, run `body`, then end through
 * the real SIGINT listener. Whatever happens, the SIGINT/SIGTERM listeners the boot added are
 * removed, the diagnostics channel is unsubscribed and the process.exit spy restored; a server still
 * listening (only when the test failed before the signal) is closed.
 */
export async function withRealBoot(sc: Scenario, body: (boot: RealBoot) => Promise<void>, opts: { armedToken?: string } = {}): Promise<void> {
    const sigintBefore = process.listeners('SIGINT');
    const sigtermBefore = process.listeners('SIGTERM');
    const listenOptions = new Map<net.Server, unknown>();
    const bound: net.Server[] = [];
    const onStart = (m: unknown): void => void listenOptions.set((m as { server: net.Server }).server, (m as { options: unknown }).options);
    const onEnd = (m: unknown): void => void bound.push((m as { server: net.Server }).server);
    dc.subscribe(LISTEN_START, onStart);
    dc.subscribe(LISTEN_END, onEnd);
    const exitCalls: unknown[] = [];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: unknown) => void exitCalls.push(code)) as never);
    const fromLog = recordedLogs().length;
    const fromCall = sc.node.callLog.length;
    try {
        await stepUntil(sc.graph.bot.startMultiChainBot(), { maxSteps: 20_000 });
        // The listen callback's own log line follows the boot; ethers sends each DEX listener's
        // eth_subscribe after the listener's synchronous lines.
        await stepUntilTrue(() => recordedLogs().slice(fromLog).some((l) => l.msg === 'Dashboard API server started'), { what: "the API server's listen callback" });
        for (const dex of sc.ctx.chain.dexes) await stepUntilTrue(() => subscribedTo(sc, dex.factoryAddress), { what: `the booted ${dex.name} listener subscribing to its factory` });

        // Setup facts of the boot (they hold under every finding's fix).
        const added = { sigint: process.listeners('SIGINT').filter((l) => !sigintBefore.includes(l)), sigterm: process.listeners('SIGTERM').filter((l) => !sigtermBefore.includes(l)) };
        expect(added.sigint, 'SIGINT listeners the boot added').toHaveLength(1);
        expect(added.sigterm, 'SIGTERM listeners the boot added').toHaveLength(1);
        expect(bound, 'servers that started listening during the boot').toHaveLength(1);
        const server = bound[0];
        expect(listenOptions.get(server)).toEqual({ port: 0, host: '127.0.0.1' });
        const addr = server.address() as net.AddressInfo;
        expect(addr.address).toBe('127.0.0.1');
        expect(addr.port).toBeGreaterThan(0);
        expect(exitCalls, 'process.exit calls during the boot').toEqual([]);
        const boot = recordedLogs().slice(fromLog);
        // No position exists at boot, so nothing is resumed (AUD-ANTIRUG-025 kept out): the anti-rug
        // lifecycle is armed with no position, and the exit monitor resumes nothing.
        expect(boot.some((l) => l.obj?.op === 'antirug.listener.armed-no-positions'), 'the anti-rug lifecycle armed with no position').toBe(true);
        expect(boot.some((l) => l.msg === 'Resuming exit monitor for pending token'), 'a position resumed at boot').toBe(false);
        expect(boot.some((l) => l.msg === 'Multi-chain bot fully started')).toBe(true);
        // SUSPECT(AUD-ANTIRUG-024): the fresh database's false gap is the only error line, at most once.
        expect(boot.filter((l) => l.level === 'error' || l.level === 'fatal').map(label).filter((x) => x !== 'op:antirug.backfill.gap-detected'), 'error lines of the boot').toEqual([]);
        expect(boot.filter((l) => l.obj?.op === 'antirug.backfill.gap-detected').length).toBeLessThanOrEqual(1);
        expect(boot.filter((l) => l.level === 'warn').map(label), 'warnings of the boot').toEqual([]);

        const run: BootRun = { server, port: addr.port, exitCalls, sigint: added.sigint[0] as () => void };
        try {
            const dash = loopbackDashboard(addr.port);
            const cookie = await dash.login();
            await body({ dash, cookie, port: addr.port, fromLog, fromCall });
            await endThroughSigint(sc, run, opts.armedToken);
        } catch (e) {
            // A test that failed before its signal may leave a subscription request in flight; let it
            // reach the node first, so the failure is reported alone and the teardown never cancels it
            // into an unhandled rejection.
            await settleSubscriptionTraffic(sc, 'after a failed test').catch(() => undefined);
            throw e;
        }
    } finally {
        for (const l of process.listeners('SIGINT').filter((x) => !sigintBefore.includes(x))) process.removeListener('SIGINT', l);
        for (const l of process.listeners('SIGTERM').filter((x) => !sigtermBefore.includes(x))) process.removeListener('SIGTERM', l);
        dc.unsubscribe(LISTEN_START, onStart);
        dc.unsubscribe(LISTEN_END, onEnd);
        exitSpy.mockRestore();
        // Only reached when the test failed before the signal: a listening server would outlive it.
        for (const s of bound) if (s.listening) s.close();
    }
    expect(process.listeners('SIGINT'), 'SIGINT listeners after removing what the boot added').toEqual(sigintBefore);
    expect(process.listeners('SIGTERM'), 'SIGTERM listeners after removing what the boot added').toEqual(sigtermBefore);
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
