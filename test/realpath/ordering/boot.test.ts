// test/realpath/ordering/boot.test.ts
// Phase 23 plan 23-24 Task 1 (CHAR-04, AC-30, D-06): boot, resume and arm ordering and listener
// counts, pinned from a real in-process start of the bot on the fake chain.
//
// What runs: the real src/bot.ts startMultiChainBot, called in this process on a scenario graph
// (D-06: never a bot process, never src/main.ts or src/bot.ts started as a program). It runs the
// real preflight, builds its own chain context, starts the real DEX listeners, resumes the exit
// monitor and anti-rug, starts the real dashboard API server and installs the real SIGINT/SIGTERM
// handler. Providers are cached per chain (src/utils/provider.ts), so the boot's context and the
// scenario's context share the same HTTP and WebSocket provider objects on the fake node.
//
// Setup the boot needs, all through public harness calls: the HoneypotChecker and every anti-rug
// allowlist address carry contract code (preflight and verifyAllowlistAtStartup read getCode), and
// DASHBOARD_API_KEY is 16 characters or more (preflight cross-env rule 5; test/.env.test's
// sentinel is 13 characters, which stops the boot).
//
// Open Question 3 (RESEARCH, Assumption A2), observed on Node 22.16.0: DASHBOARD_HOST=127.0.0.1 and
// DASHBOARD_PORT=0 bind a random free port on 127.0.0.1 (a different one each run, e.g. 63398, 54279).
// src/api/server.ts passes '0' through (parseInt('0' || '8080') is 0), so its own log line says
// `port: 0`. The test reads the real port from Node's built-in diagnostics channel
// `tracing:net.server.listen:asyncEnd`, which hands subscribers the bound net.Server; it observes
// the listen and mocks nothing. All boot tests stay in this one file.
//
// How each boot test ends (operator decision 1A, 2026-11-12, "Pin how far it gets"): through the
// real SIGINT listener the boot added, with the permitted process.exit spy installed. Today the
// real cleanup logs shutdown.cleanup and shutdown.api, stops the API server (it no longer accepts
// a connection), clears the bot's timer registry and destroys the WebSocket providers, then stops
// at its `require('./utils/db')`: inside a Vitest worker Node's own require cannot resolve a .ts
// file (ts-node does in production; plan 23-19 met the same limit in twoStageSigint.test.ts). The
// two-stage handler catches and logs that error, so shutdown.complete and exit(0) never happen
// here. That is a test-environment limit, not a bot bug (deferred-items.md, owner Phase 28). The
// test fails loudly, naming this file, if the limit is ever lifted (shutdown.complete logged, or
// exit called on the first signal). What the real cleanup never reaches is closed by the harness
// teardown (setup.ts afterEach, world.ts stopGraphParts); each is named where it happens.
//
// Resume order (operator decision 2A, "Pin today's order + log bug"): startMultiChainBot calls
// resumeMultiChainMonitoring without awaiting it, and that function returns before its balanceOf
// reads are answered, so the anti-rug resume starts before any exit timer is re-armed, although
// the comment above the anti-rug resume says exit timers come first. Today's completion order
// (exit timer armed before the allowlist is verified) holds only because the exit side needs one
// round trip and the allowlist check four, and AUD-TX-028 makes later reads wait. This is
// AUD-BUY-038 (registered by this plan). Invocation order and completion order are pinned
// separately, with no held call (2B was declined): invocation from the plain logs list and the
// node's callLog on the shared sequence counter, completion as the state when the boot returns.
//
// Known findings that decide what this file observes, each tagged where it does:
//   AUD-ANTIRUG-024 a fresh database logs one false antirug.backfill.gap-detected error per chain.
//   AUD-ANTIRUG-025 the resume drops the anti-rug subscription right after the boot returns (its
//                   own detail is asserted only in triage/AUD-ANTIRUG-025.test.ts).
//   AUD-EXIT-019    the exit-worker watchdog is installed after the resume.
//   AUD-TX-028      later reads of a chain's HTTP provider wait on its network check.
//
// Only the harness mocks are in use (harness/setup.ts). The one spy is vi.spyOn(process, 'exit'),
// which the AC-02 mock gate permits; it records the code and returns. The API server binds
// 127.0.0.1 only; every connection this file makes is to 127.0.0.1.

import * as dc from 'node:diagnostics_channel';
import * as http from 'node:http';
import * as net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { id, parseEther } from 'ethers';
import { encodeResult, FakeWebSocket } from '../harness/chain';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { createScenario, createTempDbFile, restartGraph, stepUntil, stepUntilTrue, useFixedClock, stepFor, type Scenario } from '../harness/world';
import { buyAndMine, listen, subscribedTo, waitAntiRugArmed } from '../triage/fixtures/AUD-EXIT-002-position';

const DEAD = '0x000000000000000000000000000000000000dead';
/** Runtime code for a deployed contract (the checker and the allowlist lockers are contracts). */
const CONTRACT_CODE = '0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063';
/** 26 characters: preflight cross-env rule 5 needs 16 or more. */
const BOOT_ENV = { DASHBOARD_HOST: '127.0.0.1', DASHBOARD_PORT: '0', DASHBOARD_API_KEY: 'realpath-ordering-boot-key' };
const PAIR_CREATED = id('PairCreated(address,address,address,uint256)');
const POOL_CREATED = id('PoolCreated(address,address,uint24,int24,address)');
const BALANCE_OF = id('balanceOf(address)').slice(0, 10);
/** The real-time event loop turn, captured before any scenario installs the fake clock. */
const REAL_SET_IMMEDIATE: (cb: () => void) => unknown = globalThis.setImmediate;
/** Signal listeners when this file loaded; the last test checks nothing a boot added is left. */
const FILE_START = { sigint: process.listeners('SIGINT'), sigterm: process.listeners('SIGTERM') };
const LISTEN_END = 'tracing:net.server.listen:asyncEnd';
const LISTEN_START = 'tracing:net.server.listen:asyncStart';
// The boot tests pay the cold import of the whole bot graph in createScenario. Measured times are
// in the SUMMARY of plan 23-24 and the comment at each test.
const BOOT_TEST_TIMEOUT_MS = 60_000;

type LogLine = ReturnType<typeof recordedLogs>[number];

/** Give the checker and every anti-rug allowlist address contract code, as on mainnet. */
function deployContracts(sc: Scenario): void {
    sc.node.setCode(sc.checker, CONTRACT_CODE);
    for (const e of [...sc.ctx.chain.antiRug.allowlistV2, ...sc.ctx.chain.antiRug.allowlistV3]) if (e.address.toLowerCase() !== DEAD) sc.node.setCode(e.address, CONTRACT_CODE);
}

function allowlistAddresses(sc: Scenario): Set<string> {
    return new Set([...sc.ctx.chain.antiRug.allowlistV2, ...sc.ctx.chain.antiRug.allowlistV3].map((e) => e.address.toLowerCase()).filter((a) => a !== DEAD));
}

/** A log line's label: its op when it has one, else its message. */
function label(l: LogLine): string {
    return typeof l.obj?.op === 'string' ? `op:${l.obj.op}` : (l.msg ?? '');
}

function firstLog(pred: (l: LogLine) => boolean, from: number, what: string): LogLine {
    const l = recordedLogs().slice(from).find(pred);
    if (!l) throw new Error(`no log line for ${what}`);
    return l;
}

const byMsg = (msg: string) => (l: LogLine): boolean => l.msg === msg;
const byOp = (op: string) => (l: LogLine): boolean => l.obj?.op === op;

/** Subscriptions on the node for one event topic, keyed by the factory address they filter on. */
function factorySubscriptions(sc: Scenario, topic: string): string[] {
    return sc.node.subscriptions
        .filter((s) => s.kind === 'logs' && JSON.stringify((s.filter as { topics?: unknown }).topics) === JSON.stringify([topic]))
        .map((s) => String((s.filter as { address?: unknown }).address).toLowerCase());
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

/** A real GET to the booted API server over loopback; also reports the peer address. */
function getLoopback(port: number, urlPath: string): Promise<{ status: number; body: unknown; remote: string | undefined }> {
    return settleWithBothClocks(
        new Promise((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', agent: false, headers: { connection: 'close' } }, (res) => {
                const remote = res.socket?.remoteAddress;
                let text = '';
                res.on('data', (c: Buffer) => (text += c.toString('utf8')));
                res.on('end', () => {
                    let body: unknown = text;
                    try {
                        body = JSON.parse(text);
                    } catch {
                        /* keep the text */
                    }
                    resolve({ status: res.statusCode ?? 0, body, remote });
                });
            });
            req.on('error', reject);
            req.end();
        }),
        `GET ${urlPath}`,
    );
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

interface BootRun {
    /** The bound net.Server of the dashboard API (from the listen diagnostics channel). */
    server: net.Server;
    port: number;
    /** Codes process.exit was called with (the spy records and returns). */
    exitCalls: unknown[];
    /** The SIGINT listener startMultiChainBot added (the real two-stage handler). */
    sigint: () => void;
    /** Log and call positions where the boot began. */
    fromLog: number;
    fromCall: number;
}

/**
 * Boot the real bot in process and run `body` on it. Before the boot: the signal listeners are
 * read, the listen diagnostics channel is subscribed and the process.exit spy is installed. After
 * `body`, whatever happened: every SIGINT/SIGTERM listener the boot added is removed, the channel
 * is unsubscribed and the spy restored; a server still listening (only when `body` failed before
 * its SIGINT) is closed. On success the listener lists must equal the ones before the boot.
 */
async function withInProcessBoot(sc: Scenario, body: (run: BootRun) => Promise<void>): Promise<void> {
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
        // The listen callback's own log line ("Dashboard API server started") follows the boot.
        await stepUntilTrue(() => recordedLogs().slice(fromLog).some(byMsg('Dashboard API server started')), { what: "the API server's listen callback" });

        // Listener counts: the boot adds exactly one SIGINT and one SIGTERM listener.
        const addedSigint = process.listeners('SIGINT').filter((l) => !sigintBefore.includes(l));
        const addedSigterm = process.listeners('SIGTERM').filter((l) => !sigtermBefore.includes(l));
        expect(addedSigint, 'SIGINT listeners the boot added').toHaveLength(1);
        expect(addedSigterm, 'SIGTERM listeners the boot added').toHaveLength(1);
        expect(process.listenerCount('SIGINT')).toBe(sigintBefore.length + 1);
        expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore.length + 1);

        // Open Question 3: one listen, asked for port 0 on 127.0.0.1, bound to a real free port there.
        expect(bound, 'servers that started listening during the boot').toHaveLength(1);
        const server = bound[0];
        expect(listenOptions.get(server)).toEqual({ port: 0, host: '127.0.0.1' });
        const addr = server.address() as net.AddressInfo;
        expect(addr.address).toBe('127.0.0.1');
        expect(addr.port).toBeGreaterThan(0);
        // The bot's own line reports the configured port, 0, not the bound one.
        expect(firstLog(byMsg('Dashboard API server started'), fromLog, 'the listen callback').obj).toEqual({ host: '127.0.0.1', port: 0 });
        expect(exitCalls, 'process.exit calls during the boot').toEqual([]);

        try {
            await body({ server, port: addr.port, exitCalls, sigint: addedSigint[0] as () => void, fromLog, fromCall });
        } catch (e) {
            // A body that failed before its SIGINT may leave a subscription request in flight (the
            // resume's AUD-ANTIRUG-025 re-subscribe); let it reach the node first, so the failure
            // is reported alone and the teardown never cancels it into an unhandled rejection.
            if (sc.ctx.wsProvider && !sc.ctx.wsProvider.destroyed) await settleSubscriptionTraffic(sc, 'after a failed boot test').catch(() => undefined);
            throw e;
        }
    } finally {
        for (const l of process.listeners('SIGINT').filter((x) => !sigintBefore.includes(x))) process.removeListener('SIGINT', l);
        for (const l of process.listeners('SIGTERM').filter((x) => !sigtermBefore.includes(x))) process.removeListener('SIGTERM', l);
        dc.unsubscribe(LISTEN_START, onStart);
        dc.unsubscribe(LISTEN_END, onEnd);
        exitSpy.mockRestore();
        // Only reached when `body` failed before its SIGINT: a listening server would outlive the test.
        for (const s of bound) if (s.listening) s.close();
    }
    expect(process.listeners('SIGINT'), 'SIGINT listeners after the test removed what the boot added').toEqual(sigintBefore);
    expect(process.listeners('SIGTERM'), 'SIGTERM listeners after the test removed what the boot added').toEqual(sigtermBefore);
}

/**
 * The shutdown the operator chose (1A): send the boot's real SIGINT listener the first signal and
 * pin how far the real cleanup gets today; then name what it never reaches. `armedToken` is a
 * position whose exit timer the cleanup must clear.
 */
async function pinShutdown(sc: Scenario, run: BootRun, armedToken?: string): Promise<void> {
    const ws = sc.ctx.wsProvider;
    if (!ws) throw new Error('pinShutdown: the eth chain has no WebSocket provider');
    expect(ws.destroyed).toBe(false);
    if (armedToken) expect(sc.graph.exitManager.hasExitMonitorTimer('eth', armedToken)).toBe(true);
    const socketsBefore = sc.node.socketsOpened;
    const from = recordedLogs().length;

    run.sigint();

    const lines = recordedLogs().slice(from);
    // The limit is lifted: the cleanup now runs to its end under the test runner. Fail loudly.
    if (lines.some(byOp('shutdown.complete')) || run.exitCalls.length > 0) {
        throw new Error(
            'TEST-ENVIRONMENT LIMIT LIFTED in test/realpath/ordering/boot.test.ts: the first SIGINT now reaches ' +
                `shutdown.complete or process.exit (exit calls ${JSON.stringify(run.exitCalls)}). The cleanup's require('./utils/db') ` +
                'resolves under Vitest now. Update this test: assert shutdown.complete and exit(0), and drop the steps that say the harness ' +
                'teardown closes the database (deferred-items.md, plan 23-24 entry).',
        );
    }
    // How far the real cleanup gets, in order, synchronously inside the listener call.
    expect(lines.map(label)).toEqual([
        'Graceful shutdown begun (two-stage SIGINT) — send the signal again to force-exit now',
        'op:shutdown.cleanup',
        'op:shutdown.api',
        'Dashboard API server stopped',
        'Error during graceful shutdown cleanup — grace timer will force exit',
    ]);
    // The one armed force-exit timer: 8 s, the SIGINT_GRACE_MS default. It is a fake timer here.
    expect(lines[0].obj).toEqual({ signal: 'SIGINT', graceMs: 8000 });
    // The caught error: the require of the database module, which a Vitest worker cannot resolve.
    expect(lines[4].level).toBe('error');
    expect(String(lines[4].obj?.err)).toMatch(/^Cannot find module '\.\/utils\/db'/);
    // The API server stopped: not listening, and a new connection to its port is refused.
    expect(run.server.listening).toBe(false);
    expect(await connectOutcome(run.port)).toBe('ECONNREFUSED');
    // The bot's timer registry was cleared and the WebSocket provider destroyed.
    if (armedToken) expect(sc.graph.exitManager.hasExitMonitorTimer('eth', armedToken)).toBe(false);
    expect(ws.destroyed).toBe(true);

    // Not reached by the real cleanup (it stops at the require), each closed by the harness
    // teardown that runs after this test (setup.ts afterEach -> world.ts stopGraphParts):
    //   - the database: still open here; closed by teardown step 4 (closeDb on the scenario graph,
    //     which is the graph the boot ran in).
    expect(sc.graph.db.open).toBe(true);
    //   - the HTTP provider: never destroyed by the cleanup (it destroys only WebSocket providers);
    //     destroyed by teardown step 3, because the scenario context holds the same cached
    //     getProvider('eth') object the boot's context holds.
    expect(sc.ctx.httpProvider.destroyed).toBe(false);
    //   - the two 5-minute intervals the boot leaves untracked (MEV health check, mid-run wallet
    //     check), the armed 8 s force-exit timer, and each reconnect loop's delay timer: fake
    //     timers, cleared by teardown step 2 (vi.clearAllTimers) before any of them fires.
    //   - the WebSocket reconnect loops: in production exit(0) ends the process inside this same
    //     synchronous cleanup, before the destroyed socket's close events run. Here process.exit is
    //     the spy, so once microtasks run each DEX listener and the anti-rug lifecycle see the close
    //     and start a reconnect loop, which parks on its first delay timer. Teardown step 3 detaches
    //     the old sockets' listeners and step 2 clears those timers, so no loop ever reconnects.
    for (let i = 0; i < 50; i++) await Promise.resolve();
    const afterDrain = recordedLogs().slice(from + lines.length);
    expect(afterDrain.filter((l) => l.level === 'warn' || l.level === 'error' || l.level === 'fatal').map(label)).toEqual([
        'WebSocket disconnected, reconnecting',
        'WebSocket disconnected, reconnecting',
        'WebSocket disconnected (V3), reconnecting',
        'op:antirug.ws.disconnected',
    ]);
    // Parked, not reconnecting: no new socket was opened and none is open.
    expect(sc.node.socketsOpened).toBe(socketsBefore);
    expect(sc.node.openSocketCount).toBe(0);
    expect(run.exitCalls).toEqual([]);
}

/** The boot steps every in-process start logs up to its listeners, in order (D-06 boot order). */
const BOOT_PREFIX = [
    'Starting multi-chain bot',
    'Chain registry built',
    // preflight (src/preflight.ts), with its own MEV check, then its summary
    'Flashbots health check passed',
    'Preflight summary for eth',
    'Preflight passed',
    // the chain context: startMultiChainBot's per-chain MEV health check, run right after
    // createChainContext (which logs nothing itself)
    'Flashbots health check passed',
    // one listener per DEX (two V2, one V3), then the per-chain line
    'Listening for PairCreated events via WebSocket',
    'Listening for PairCreated events via WebSocket',
    'Listening for V3 PoolCreated events via WebSocket',
    'Chain listeners started',
];

/**
 * Wait until no eth_subscribe or eth_unsubscribe has reached the node for one virtual second, so
 * neither a signal nor the harness teardown destroys a provider under an in-flight subscription
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

/** Exactly one PairCreated subscription per V2 DEX and one PoolCreated per V3 DEX. */
function expectDexSubscriptions(sc: Scenario): void {
    const v2 = sc.ctx.chain.dexes.filter((d) => d.dexType === 'v2').map((d) => d.factoryAddress.toLowerCase()).sort();
    const v3 = sc.ctx.chain.dexes.filter((d) => d.dexType === 'v3').map((d) => d.factoryAddress.toLowerCase()).sort();
    expect(v2).toHaveLength(2);
    expect(v3).toHaveLength(1);
    expect(factorySubscriptions(sc, PAIR_CREATED).sort()).toEqual(v2);
    expect(factorySubscriptions(sc, POOL_CREATED).sort()).toEqual(v3);
}

describe('boot ordering: a real in-process startMultiChainBot on the fake chain', () => {
    it(
        'a fresh boot runs preflight, the chain context, the DEX listeners, the anti-rug start and the API server in that order, subscribes once per DEX, and ends through the real SIGINT handler',
        async () => {
            const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: BOOT_ENV, db: { file: createTempDbFile() } });
            deployContracts(sc);
            await withInProcessBoot(sc, async (run) => {
                const boot = recordedLogs().slice(run.fromLog);
                const seqOf = (pred: (l: LogLine) => boolean, what: string): number => firstLog(pred, run.fromLog, what).seq;
                // Every boot line in order, debug excluded. Two lines are left out of the strict
                // sequence because a known finding decides them and its fix would move them:
                //   - antirug.backfill.gap-detected (error): SUSPECT(AUD-ANTIRUG-024), the fresh
                //     database's false gap; checked below as the only error line.
                //   - the watchdog line: SUSPECT(AUD-EXIT-019), pinned on its own below.
                const ordered = boot.filter((l) => l.level !== 'debug' && !byOp('antirug.backfill.gap-detected')(l) && !byOp('watchdog.installed')(l)).map(label);
                expect(ordered).toEqual([
                    ...BOOT_PREFIX,
                    // the anti-rug resume: allowlist check, then the per-chain lifecycle with no position
                    'Anti-rug allowlist verified at startup',
                    'op:antirug.listener.armed-no-positions',
                    // the API server, then the Telegram listener (the setup.ts client fake)
                    'API server started',
                    'Telegram listener connected and listening',
                    'Telegram listener integrated into orchestrator',
                    'Multi-chain bot fully started',
                    // the API server's listen callback, after startMultiChainBot's last line
                    'Dashboard API server started',
                ]);
                // SUSPECT(AUD-EXIT-019): the exit-worker watchdog is installed after the resume and
                // the API server. A fix that installs it before the resume moves this line.
                const watchdog = seqOf(byOp('watchdog.installed'), 'watchdog.installed');
                expect(watchdog, 'AUD-EXIT-019: the watchdog is installed after the API server and Telegram (if it moved before the resume, AUD-EXIT-019 looks fixed: update this pin)').toBeGreaterThan(
                    seqOf(byMsg('Telegram listener integrated into orchestrator'), 'the Telegram line'),
                );
                expect(watchdog).toBeLessThan(seqOf(byMsg('Multi-chain bot fully started'), 'the last boot line'));
                // The only error line of the boot: SUSPECT(AUD-ANTIRUG-024), at most one per chain.
                expect(boot.filter((l) => l.level === 'error' || l.level === 'fatal').map(label).filter((x) => x !== 'op:antirug.backfill.gap-detected')).toEqual([]);
                expect(boot.filter(byOp('antirug.backfill.gap-detected')).length).toBeLessThanOrEqual(1);
                expect(boot.filter((l) => l.level === 'warn').map(label)).toEqual([]);

                // The order on the node, on the shared sequence counter: preflight's reads, then the
                // three DEX subscriptions (ethers sends each eth_subscribe after the listener's
                // synchronous log lines, so they reach the node after "Chain listeners started"),
                // then the allowlist reads.
                const calls = sc.node.callLog.slice(run.fromCall);
                const allowlist = allowlistAddresses(sc);
                const subscribes = calls.filter((c) => c.method === 'eth_subscribe');
                const allowlistReads = calls.filter((c) => c.method === 'eth_getCode' && allowlist.has(String((c.params as unknown[])[0]).toLowerCase()));
                const checkerRead = calls.find((c) => c.method === 'eth_getCode' && String((c.params as unknown[])[0]).toLowerCase() === sc.checker.toLowerCase());
                expect(subscribes).toHaveLength(3);
                expect(allowlistReads).toHaveLength(allowlist.size);
                expect(checkerRead, "preflight's read of the HoneypotChecker code").toBeDefined();
                expect(checkerRead!.seq).toBeLessThan(seqOf(byMsg('Preflight passed'), 'Preflight passed'));
                expect(subscribes[0].seq).toBeGreaterThan(seqOf(byMsg('Preflight passed'), 'Preflight passed'));
                expect(subscribes[0].seq).toBeGreaterThan(seqOf(byMsg('Chain listeners started'), 'Chain listeners started'));
                expect(subscribes[2].seq).toBeLessThan(allowlistReads[0].seq);
                expect(allowlistReads[allowlistReads.length - 1].seq).toBeLessThan(seqOf(byMsg('Anti-rug allowlist verified at startup'), 'the allowlist line'));
                // Subscriptions held by the node after the boot: one per DEX, nothing else.
                expectDexSubscriptions(sc);
                expect(sc.node.subscriptions).toHaveLength(3);
                expect(sc.node.strays).toEqual([]);

                // The API server answers on its real port over loopback.
                const health = await getLoopback(run.port, '/health');
                expect(health.status).toBe(200);
                expect(health.remote).toBe('127.0.0.1');

                await pinShutdown(sc, run);
            });
        },
        BOOT_TEST_TIMEOUT_MS,
    );

    it(
        'a boot that resumes an open position calls the exit-monitor resume first but starts the anti-rug resume before any exit timer is re-armed (AUD-BUY-038); when the boot returns both are armed',
        async () => {
            const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: BOOT_ENV, db: { file: createTempDbFile() } });
            deployContracts(sc);
            // An open position from the real snipe path (AC-01): the trades, exit_state and
            // lp_baseline rows are written by the real code, never by this test.
            await listen(sc);
            await buyAndMine(sc);
            await waitAntiRugArmed(sc);
            // The process dies and comes back on the same file (restartGraph stops the old graph's
            // timers, providers and sockets as a process death would), then the real boot runs.
            await restartGraph(sc);
            const token = sc.token;
            expect(sc.graph.exitManager.hasExitMonitorTimer('eth', token)).toBe(false);

            await withInProcessBoot(sc, async (run) => {
                const boot = recordedLogs().slice(run.fromLog);
                const seqOf = (pred: (l: LogLine) => boolean, what: string): number => firstLog(pred, run.fromLog, what).seq;
                // The boot steps up to the listeners are the fresh boot's.
                expect(boot.filter((l) => l.level !== 'debug').map(label).slice(0, BOOT_PREFIX.length)).toEqual(BOOT_PREFIX);
                expectDexSubscriptions(sc);

                const resumeCall = firstLog(byMsg('Resuming exit monitor for pending token'), run.fromLog, 'the exit-monitor resume');
                expect(resumeCall.obj).toMatchObject({ token: token.toLowerCase(), poolType: 'v2' });
                const calls = sc.node.callLog.slice(run.fromCall);
                const allowlist = allowlistAddresses(sc);
                const firstAllowlistRead = calls.find((c) => c.method === 'eth_getCode' && allowlist.has(String((c.params as unknown[])[0]).toLowerCase()));
                const balanceRead = calls.find((c) => c.method === 'eth_call' && c.to === token.toLowerCase() && c.selector === BALANCE_OF);
                expect(firstAllowlistRead, 'the anti-rug resume reading the allowlist').toBeDefined();
                expect(balanceRead, "the exit-monitor resume's balanceOf read").toBeDefined();
                const resumed = seqOf(byOp('exit.monitor.resumed'), 'exit.monitor.resumed');
                const verified = seqOf(byMsg('Anti-rug allowlist verified at startup'), 'the allowlist line');

                // Invocation order: the exit-monitor resume is called first, after the listeners.
                expect(resumeCall.seq).toBeGreaterThan(seqOf(byMsg('Chain listeners started'), 'Chain listeners started'));
                expect(resumeCall.seq).toBeLessThan(firstAllowlistRead!.seq);
                // SUSPECT(AUD-BUY-038): the anti-rug resume sends its first request before the exit
                // monitor is re-armed (resumeMultiChainMonitoring returns before its balanceOf is
                // answered and the boot does not wait). Today it is even sent before the balance read.
                if (firstAllowlistRead!.seq > resumed) {
                    throw new Error(
                        'AUD-BUY-038 looks fixed: the anti-rug resume now starts after the exit monitor was re-armed. ' +
                            'Update test/realpath/ordering/boot.test.ts to pin the new order (exit.monitor.resumed before the first allowlist read).',
                    );
                }
                expect(firstAllowlistRead!.seq).toBeLessThan(balanceRead!.seq);
                expect(balanceRead!.seq).toBeLessThan(resumed);

                // Completion order. SUSPECT(AUD-BUY-038, AUD-TX-028): the exit timer is re-armed
                // before the allowlist check finishes only because the exit side needs one round trip
                // and the allowlist four, each waiting on the provider's network check.
                expect(resumed).toBeLessThan(verified);
                const registered = seqOf(byOp('antirug.register'), 'antirug.register');
                expect(registered).toBeGreaterThan(verified);
                expect(registered).toBeLessThan(seqOf(byMsg('API server started'), 'API server started'));
                // The state when startMultiChainBot returns: the exit timer is armed and the
                // anti-rug subscription covers the pair. SUSPECT(AUD-ANTIRUG-025): the resume drops
                // that subscription right after the boot returns, which is why it is read here and
                // nowhere later (its own detail is asserted only in its own file).
                expect(sc.graph.exitManager.hasExitMonitorTimer('eth', token)).toBe(true);
                expect(subscribedTo(sc, sc.pair)).toBe(true);
                expect(sc.graph.detector.getRegisteredPositions('eth').some((p) => p.pairOrPoolAddress === sc.pair.toLowerCase())).toBe(true);
                // Nothing in the resume boot warned or failed (the cursor is already at the head, so
                // no AUD-ANTIRUG-024 gap line here).
                expect(boot.filter((l) => l.level === 'warn' || l.level === 'error' || l.level === 'fatal').map(label)).toEqual([]);

                // Let the subscription traffic settle before the signal, so the shutdown never
                // races an in-flight eth_subscribe or eth_unsubscribe.
                await settleSubscriptionTraffic(sc, 'after the boot');
                expect(sc.node.strays).toEqual([]);

                await pinShutdown(sc, run, token);
            });
        },
        BOOT_TEST_TIMEOUT_MS,
    );
});

/**
 * armPositionMonitoring order on the real path, for each caller separately (the V3 snipe has its
 * own inline wiring, review concern 23-18): the exit_state insert, the exit monitor started, the
 * lp_baseline insert, the anti-rug register and its subscription, from the timeline, then the
 * pair's eth_subscribe on the node. chain_state writes and the backfill line are left out: the
 * fresh database's chain_state insert and false gap belong to SUSPECT(AUD-ANTIRUG-024).
 */
const ARM_STEPS = ['db:trades.insert', 'db:exit_state.insert', 'op:exit.monitor.started', 'db:lp_baseline.insert', 'op:antirug.lp-baseline.snapshot', 'op:antirug.register', 'op:antirug.listener.subscribed'];

function expectArmOrder(sc: Scenario, fromTimeline: number, fromLog: number, fromCall: number): void {
    const arm = sc.timeline.entries
        .slice(fromTimeline)
        .map((e) => (e.kind === 'db' ? `db:${e.table}.${e.op}` : e.kind === 'op' ? `op:${e.op}` : null))
        .filter((x): x is string => x !== null && ARM_STEPS.includes(x));
    expect(arm).toEqual(ARM_STEPS);
    const subscribed = firstLog(byOp('antirug.listener.subscribed'), fromLog, 'antirug.listener.subscribed');
    const pairSubscribes = sc.node.callLog.slice(fromCall).filter((c) => c.method === 'eth_subscribe' && JSON.stringify(c.params).toLowerCase().includes(sc.pair.toLowerCase()));
    expect(pairSubscribes).toHaveLength(1);
    expect(pairSubscribes[0].seq).toBeGreaterThan(subscribed.seq);
    expect(subscribedTo(sc, sc.pair)).toBe(true);
}

describe('arm ordering: armPositionMonitoring and its V3 twin, per caller, on the real path', () => {
    it(
        'a V2 snipe inserts exit_state, then lp_baseline, then subscribes to the pair',
        async () => {
            const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
            deployContracts(sc);
            await listen(sc);
            const at = { t: sc.timeline.entries.length, l: recordedLogs().length, c: sc.node.callLog.length };
            await buyAndMine(sc);
            await waitAntiRugArmed(sc);
            expectArmOrder(sc, at.t, at.l, at.c);
            await settleSubscriptionTraffic(sc, 'after the arming');
        },
        BOOT_TEST_TIMEOUT_MS,
    );

    it(
        'a V3 snipe (its own inline wiring) inserts exit_state, then lp_baseline, then subscribes to the pool',
        async () => {
            const sc = await createScenario({ chain: 'eth', dexType: 'v3' });
            deployContracts(sc);
            await listen(sc);
            const at = { t: sc.timeline.entries.length, l: recordedLogs().length, c: sc.node.callLog.length };
            await buyAndMine(sc);
            await waitAntiRugArmed(sc);
            expectArmOrder(sc, at.t, at.l, at.c);
            await settleSubscriptionTraffic(sc, 'after the arming');
        },
        BOOT_TEST_TIMEOUT_MS,
    );

    it(
        'a deliberate buy (executeDeliberateBuy in this process) inserts exit_state, then lp_baseline, then subscribes to the pair',
        async () => {
            // base V2: the deliberate path does not run the V2 lock check AUD-BUY-016 breaks on
            // base, and the public route lands with three confirmations under autoMine.
            const sc = await createScenario({ chain: 'base', dexType: 'v2' });
            deployContracts(sc);
            // The pair already exists (a deliberate buy is made on a live pair): the factory answers getPair.
            sc.node.setRead(sc.dex.factoryAddress, 'getPair(address,address)', encodeResult(['address'], [sc.pair]));
            sc.node.autoMine({ confirmations: 3 });
            const at = { t: sc.timeline.entries.length, l: recordedLogs().length, c: sc.node.callLog.length };
            const landed = await stepUntil(sc.graph.bot.executeDeliberateBuy(sc.ctx, sc.token, parseEther('0.01'), sc.dex), { maxSteps: 20_000 });
            expect(landed).toMatch(/^0x[0-9a-f]{64}$/);
            await waitAntiRugArmed(sc);
            expectArmOrder(sc, at.t, at.l, at.c);
            await settleSubscriptionTraffic(sc, 'after the arming');
        },
        BOOT_TEST_TIMEOUT_MS,
    );
});

describe('nothing a booted bot started outlives its test', () => {
    it('after the boot tests, ten virtual minutes and real event-loop turns bring no log, alert, socket or signal listener from them', async () => {
        // Runs after the two boot tests in this file (Vitest runs a file's tests in order). Their
        // reconnect loops were parked on fake timers that the harness teardown cleared, and their
        // sockets' listeners were detached; a fresh fake clock stepped for ten minutes and real
        // event-loop turns must show nothing from them.
        expect(recordedLogs()).toEqual([]);
        expect(recordedAlerts()).toEqual([]);
        useFixedClock();
        try {
            await stepFor(10 * 60_000, 1_000);
            for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => REAL_SET_IMMEDIATE(resolve));
            expect(recordedLogs()).toEqual([]);
            expect(recordedAlerts()).toEqual([]);
            expect(FakeWebSocket.instances).toEqual([]);
            expect(process.listeners('SIGINT')).toEqual(FILE_START.sigint);
            expect(process.listeners('SIGTERM')).toEqual(FILE_START.sigterm);
        } finally {
            vi.useRealTimers();
        }
    });
});
