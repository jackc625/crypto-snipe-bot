// test/realpath/harness/world.ts
// Phase 23 plan 23-01 (CHAR-01, AC-01, AC-03): the world a real-path scenario runs in.
//
//   - Fixed clock (D-05): every timer and the date are fake and stepped by the test, including
//     ethers' 10 ms JSON-RPC batching timer and performance.now (src/exitEngine.ts measures with
//     it). SQLite's unixepoch() is overridden on the test connection so DEFAULT (unixepoch())
//     reads the same clock (RESEARCH Pattern 5).
//   - loadGraph(): a whole-graph reset. closeDb() on the previous graph, vi.resetModules(), then
//     dynamic imports of the real src/ modules on a fresh :memory: database built by the real
//     migrations (src/utils/db.ts opens and migrates at import). The connection is the existing
//     `db` export; no getter is added (D-14 as corrected, SPEC Amendment A-3).
//   - routeHttp(): per-scenario routes for the axios mock; an unmatched URL is a stray.
//   - createScenario(): one chain, one DEX, a token, a pair and the reads a real node would
//     answer, all built with real ethers encoders (D-04). It registers one awaited disposer.
//   - assertNoStrays() / assertAllFaultsFired(): run in afterEach by setup.ts.
//
// The better-sqlite3 handle is named `db` in this file because test/unit/rails/spawnSites.test.ts
// accepts `.exec()` only on named receivers.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { ethers, Interface, Wallet, getAddress, getCreate2Address, solidityPackedKeccak256, parseEther, toQuantity } from 'ethers';
import {
    FakeNode,
    FakeWebSocket,
    harnessState,
    installSeams,
    nextSeq,
    encodeResult,
    revertWith,
    revertReason,
    REVERT_EMPTY,
    labelAddress,
    type HttpHandler,
    type HttpRequestInfo,
    type Stray,
    type FakeLog,
} from './chain';

// ---------------------------------------------------------------------------------------------
// Fixed clock (D-05)
// ---------------------------------------------------------------------------------------------

/** 2026-01-01T00:00:00.000Z. */
export const FIXED_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

const TO_FAKE = ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'performance'];

export function useFixedClock(): void {
    if (vi.isFakeTimers()) return;
    vi.useFakeTimers({ now: FIXED_EPOCH_MS, toFake: TO_FAKE as never });
}

export interface StepOptions {
    stepMs?: number;
    maxSteps?: number;
}

/** Step the fake clock until `promise` settles; rethrows its rejection. */
export async function stepUntil<T>(promise: Promise<T>, opts: StepOptions = {}): Promise<T> {
    const stepMs = opts.stepMs ?? 10;
    const maxSteps = opts.maxSteps ?? 5000;
    let done = false;
    let failed = false;
    let value!: T;
    let err: unknown;
    promise.then(
        (v) => {
            done = true;
            value = v;
        },
        (e: unknown) => {
            done = true;
            failed = true;
            err = e;
        },
    );
    for (let i = 0; i < maxSteps && !done; i++) await vi.advanceTimersByTimeAsync(stepMs);
    if (!done) throw new Error(`stepUntil: the promise did not settle within ${stepMs * maxSteps} virtual ms; pending timers ${vi.getTimerCount()}`);
    if (failed) throw err;
    return value;
}

/** Step the fake clock until `predicate()` is true. */
export async function stepUntilTrue(predicate: () => boolean, opts: StepOptions & { what?: string } = {}): Promise<void> {
    const stepMs = opts.stepMs ?? 10;
    const maxSteps = opts.maxSteps ?? 5000;
    for (let i = 0; i <= maxSteps; i++) {
        if (predicate()) return;
        if (i === maxSteps) break;
        await vi.advanceTimersByTimeAsync(stepMs);
    }
    throw new Error(`stepUntilTrue: ${opts.what ?? 'the condition'} did not hold within ${stepMs * maxSteps} virtual ms; pending timers ${vi.getTimerCount()}\n${describeRecent()}`);
}

/** Recent log lines, node calls and strays, so a stall names where the path stopped. */
export function describeRecent(n = 12): string {
    const st = harnessState();
    const logs = st.logs.slice(-n).map((l) => `  log ${l.level} ${String(l.obj?.op ?? '')} ${l.msg ?? ''}${l.obj?.err ? ` err=${String((l.obj.err as Error)?.message ?? l.obj.err)}` : ''}`);
    const calls = (st.node?.callLog ?? []).slice(-n).map((c) => `  call ${c.endpoint} ${c.method}${c.to ? ` to=${c.to}` : ''}${c.selector ? ` sel=${c.selector}` : ''}`);
    const strays = allStrays().map((s) => `  stray ${s.detail}`);
    // The whole op trail, consecutive repeats collapsed, and every warn/error line with its error.
    const trail: string[] = [];
    for (const l of st.logs) {
        const op = l.obj?.op;
        if (typeof op !== 'string') continue;
        const last = trail[trail.length - 1];
        const m = last?.match(/^(.*) x(\d+)$/);
        if (last === op) trail[trail.length - 1] = `${op} x2`;
        else if (m && m[1] === op) trail[trail.length - 1] = `${op} x${Number(m[2]) + 1}`;
        else trail.push(op);
    }
    const errorText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : typeof e === 'object' && e !== null ? JSON.stringify(e).slice(0, 300) : String(e));
    const problems = st.logs
        .filter((l) => l.level === 'warn' || l.level === 'error' || l.level === 'fatal')
        .map((l) => `  ${l.level} ${String(l.obj?.op ?? '')} ${l.msg ?? ''}${l.obj?.err !== undefined ? ` err=${errorText(l.obj.err)}` : ''}`);
    return [
        'op trail:',
        `  ${trail.join(' > ') || 'none'}`,
        'warn/error lines:',
        ...(problems.length ? problems : ['  none']),
        'recent logs:',
        ...logs,
        'recent calls:',
        ...calls,
        'strays:',
        ...(strays.length ? strays : ['  none']),
    ].join('\n');
}

/** Step `virtualMs` of fake time (for example one 12 s slot). */
export async function stepFor(virtualMs: number, stepMs = 10): Promise<void> {
    const end = Date.now() + virtualMs;
    while (Date.now() < end) await vi.advanceTimersByTimeAsync(Math.min(stepMs, end - Date.now()));
}

// ---------------------------------------------------------------------------------------------
// Whole-graph reset
// ---------------------------------------------------------------------------------------------

type BotModule = typeof import('../../../src/bot');
type ChainRegistryModule = typeof import('../../../src/chainRegistry');
type DbModule = typeof import('../../../src/utils/db');
type ExitEngineModule = typeof import('../../../src/exitEngine');
type DetectorModule = typeof import('../../../src/anti-rug/detector');
type ExitManagerModule = typeof import('../../../src/utils/exitManager');

export interface Graph {
    bot: BotModule;
    chainRegistry: ChainRegistryModule;
    dbModule: DbModule;
    exitEngine: ExitEngineModule;
    detector: DetectorModule;
    exitManager: ExitManagerModule;
    /** The real better-sqlite3 connection src/utils/db.ts opened (its existing `db` export). */
    db: DbModule['db'];
}

let currentGraph: Graph | null = null;

function closeGraphDb(graph: Graph | null): void {
    if (graph && graph.db.open) graph.dbModule.closeDb();
}

/**
 * Close the previous graph's DB, reset every module, and import the real graph on a fresh
 * :memory: database. Fixes SQLite's clock to the fake one (D-05).
 */
export async function loadGraph(): Promise<Graph> {
    closeGraphDb(currentGraph);
    currentGraph = null;
    vi.resetModules();
    if (process.env.DB_PATH === undefined || process.env.DB_PATH === '') process.env.DB_PATH = ':memory:';
    const dbModule = await import('../../../src/utils/db');
    const chainRegistry = await import('../../../src/chainRegistry');
    const exitManager = await import('../../../src/utils/exitManager');
    const exitEngine = await import('../../../src/exitEngine');
    const detector = await import('../../../src/anti-rug/detector');
    const bot = await import('../../../src/bot');
    const db = dbModule.db;
    // unixepoch() with no argument reads the fake clock; any argument fails loudly, because a
    // future unixepoch(x) would otherwise read the real clock unnoticed.
    db.function('unixepoch', { varargs: true, deterministic: false }, (...args: unknown[]) => {
        if (args.length > 0) throw new Error(`realpath harness unixepoch: arguments are not supported: ${JSON.stringify(args)}`);
        return Math.floor(Date.now() / 1000);
    });
    currentGraph = { bot, chainRegistry, dbModule, exitEngine, detector, exitManager, db };
    return currentGraph;
}

// ---------------------------------------------------------------------------------------------
// HTTP routing for the axios mock (Pitfall 10)
// ---------------------------------------------------------------------------------------------

/** Route axios calls whose URL starts with `urlPrefix`. An unmatched URL is a stray. */
export function routeHttp(urlPrefix: string, handler: HttpHandler): void {
    harnessState().httpRoutes.push({ prefix: urlPrefix, handler });
}

interface AxiosLikeError extends Error {
    isAxiosError: true;
    code?: string;
    response?: { status: number; data: unknown; headers: Record<string, string> };
    config: unknown;
}

function axiosError(message: string, config: unknown, response?: AxiosLikeError['response'], code?: string): AxiosLikeError {
    const e = new Error(message) as AxiosLikeError;
    e.name = 'AxiosError';
    e.isAxiosError = true;
    e.config = config;
    if (response) e.response = response;
    if (code) e.code = code;
    return e;
}

async function routeAxios(method: string, url: string, data: unknown, config: unknown): Promise<unknown> {
    const st = harnessState();
    const route = st.httpRoutes.find((r) => url.startsWith(r.prefix));
    st.httpLog.push({ seq: nextSeq(), method, url, data, matched: route !== undefined });
    if (!route) {
        const stray: Stray = { seq: nextSeq(), kind: 'url', url, detail: `unknown URL ${url} (axios ${method.toUpperCase()})` };
        if (st.node) st.node.strays.push(stray);
        else st.orphanStrays.push(stray);
        throw axiosError(`realpath harness: no route for ${method.toUpperCase()} ${url}`, config, undefined, 'ERR_REALPATH_NO_ROUTE');
    }
    const req: HttpRequestInfo = { method, url, data, config };
    const reply = await route.handler(req);
    const status = reply.status ?? 200;
    const headers = reply.headers ?? { 'content-type': 'application/json' };
    if (status >= 400) throw axiosError(`Request failed with status code ${status}`, config, { status, data: reply.data, headers }, 'ERR_BAD_RESPONSE');
    return { data: reply.data, status, statusText: 'OK', headers, config };
}

harnessState().routeAxios = routeAxios;

// ---------------------------------------------------------------------------------------------
// Stray and fault checks (AC-03)
// ---------------------------------------------------------------------------------------------

function allStrays(): Stray[] {
    const st = harnessState();
    return [...st.orphanStrays, ...st.nodes.flatMap((n) => n.strays)].sort((a, b) => a.seq - b.seq);
}

/** Throw naming the first stray call (unknown method, read or URL). */
export function assertNoStrays(): void {
    const strays = allStrays();
    if (strays.length === 0) return;
    const more = strays.length > 1 ? ` (and ${strays.length - 1} more: ${strays.slice(1, 6).map((s) => s.detail).join('; ')})` : '';
    throw new Error(`realpath harness: stray call: ${strays[0].detail}${more}`);
}

/** Throw naming a fault or hold that never fired (plan 23-01 Task 2 arms faults). */
export function assertAllFaultsFired(): void {
    const st = harnessState();
    for (const node of st.nodes) {
        const unfired = (node as unknown as { faults?: Array<{ fired: number; describe(): string }> }).faults?.find((f) => f.fired === 0);
        if (unfired) throw new Error(`realpath harness: a fault never fired: ${unfired.describe()}`);
    }
}

/** Clear per-test state after the afterEach checks (setup.ts). */
export function resetTestState(): void {
    const st = harnessState();
    st.node = null;
    st.nodes = [];
    st.orphanStrays = [];
    st.logs = [];
    st.alerts = [];
    st.broadcasts = [];
    st.httpRoutes = [];
    st.httpLog = [];
    st.telegram = { clients: [] };
}

// ---------------------------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------------------------

/** Canonical Uniswap V2 ABIs, written here independently of src/utils/abis.ts. */
const UNISWAP_V2_ROUTER = new Interface([
    'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
    'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
    'function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)',
]);
const UNISWAP_V2_FACTORY = new Interface(['event PairCreated(address indexed token0, address indexed token1, address pair, uint256)']);
/** keccak256 of the UniswapV2Pair creation code (mainnet factory 0x5C69...aA6f). */
const UNISWAP_V2_INIT_CODE_HASH = '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The deployed HoneypotChecker ABI from the Ignition artifact (the contract's own errors). */
function checkerInterface(): Interface {
    const file = path.join(REPO_ROOT, 'ignition', 'deployments', 'chain-1', 'artifacts', 'HoneypotCheckerModule#HoneypotChecker.json');
    const artifact = JSON.parse(fs.readFileSync(file, 'utf8')) as { abi: ethers.InterfaceAbi };
    return new Interface(artifact.abi);
}

/** Uniswap V2 getAmountOut with the 0.3% fee. */
export function v2AmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
    const withFee = amountIn * 997n;
    return (withFee * reserveOut) / (reserveIn * 1000n + withFee);
}

export interface ScenarioOptions {
    chain: 'eth';
    dexType: 'v2';
    /** Env values applied before the graph loads and restored by dispose. */
    overrides?: Record<string, string | undefined>;
    /**
     * Self-test hook (plan 23-01 Task 2): throw after this stage so the partial-startup cleanup
     * can be proven. Never set by a scenario.
     */
    failAfter?: 'graph' | 'context';
}

type ChainContext = ReturnType<ChainRegistryModule['createChainContext']>;
type ChainConfig = Parameters<ChainRegistryModule['createChainContext']>[0];
type DexConfigV2 = Extract<ChainConfig['dexes'][number], { dexType: 'v2' }>;

export interface Scenario {
    node: FakeNode;
    graph: Graph;
    registry: Map<string, ChainConfig>;
    ctx: ChainContext;
    dex: DexConfigV2;
    token: string;
    pair: string;
    wallet: ChainContext['wallet'];
    weth: string;
    reserves: { weth: bigint; token: bigint };
    /** Mine the launch's addLiquidityETH and deliver its real PairCreated log (D-06). */
    fireNewPair(): Promise<{ block: number; log: FakeLog }>;
    dispose(): Promise<void>;
}

/** Build a scenario. Every partial start is cleaned up by the same disposer before rethrowing. */
export async function createScenario(opts: ScenarioOptions): Promise<Scenario> {
    if (opts.chain !== 'eth' || opts.dexType !== 'v2') {
        throw new Error(`createScenario: ${opts.chain}/${opts.dexType} is not built yet (plan 23-28 adds the other chains and V3)`);
    }
    const st = harnessState();
    const envSnapshot: Record<string, string | undefined> = { ...process.env };
    const installedClock = !vi.isFakeTimers();
    const built: { node?: FakeNode; graph?: Graph; ctx?: ChainContext } = {};
    let disposed = false;

    const dispose = async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        const errors: unknown[] = [];
        const step = async (what: string, fn: () => unknown): Promise<void> => {
            try {
                await fn();
            } catch (e) {
                errors.push(new Error(`dispose: ${what} failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e }));
            }
        };
        // 1. Nothing stays parked.
        await step('release held calls', () => built.node?.releaseAll());
        // 2. Timers: the bot's own registry, then every fake timer.
        await step('clear bot timers', () => built.graph?.exitManager.clearAllTimers());
        await step('clear fake timers', () => {
            if (vi.isFakeTimers()) vi.clearAllTimers();
        });
        // 3. Providers: raw socket listeners first so a teardown close cannot start a reconnect.
        await step('detach socket listeners', () => {
            for (const ws of FakeWebSocket.instances) ws.removeAllListeners();
        });
        await step('destroy providers', async () => {
            // ethers' destroy() cancels pending requests, marks the provider destroyed, then
            // removes every listener; subscriber stop() then sees `destroyed` and sends no
            // eth_unsubscribe. Calling removeAllListeners() first would queue eth_unsubscribe
            // payloads that destroy() cancels into unhandled rejections (measured).
            const providers = [built.ctx?.wsProvider, built.ctx?.httpProvider].filter((p) => p != null);
            for (const p of providers) await p!.destroy();
        });
        // 4. Database.
        await step('close database', () => {
            closeGraphDb(built.graph ?? null);
            if (built.graph && currentGraph === built.graph) currentGraph = null;
        });
        // 5. Environment, sockets, routes, clock.
        await step('restore environment', () => {
            for (const k of Object.keys(process.env)) if (!(k in envSnapshot)) delete process.env[k];
            for (const [k, v] of Object.entries(envSnapshot)) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
            }
        });
        await step('clear sockets', () => {
            FakeWebSocket.instances.length = 0;
        });
        await step('clear routes', () => {
            if (st.node === built.node) st.node = null;
            st.httpRoutes = [];
        });
        await step('restore clock', () => {
            if (installedClock && vi.isFakeTimers()) vi.useRealTimers();
        });
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, `dispose: ${errors.length} teardown steps failed`);
    };
    st.disposers.push(dispose);

    try {
        useFixedClock();
        for (const [k, v] of Object.entries(opts.overrides ?? {})) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';
        installSeams();

        const node = new FakeNode({ chainId: 1 });
        built.node = node;
        st.node = node;
        st.nodes.push(node);

        const graph = await loadGraph();
        built.graph = graph;
        if (opts.failAfter === 'graph') throw new Error('createScenario: injected failure after the graph loaded');

        const registry = graph.chainRegistry.buildChainRegistry();
        const chain = registry.get('eth');
        if (!chain || !chain.enabled) throw new Error('createScenario: the eth chain is not enabled in the test environment');
        node.serve({
            rpc: [chain.httpRpcUrl],
            ws: chain.wsRpcUrl ? [chain.wsRpcUrl] : [],
            relay: [chain.mevConfig.relayUrl],
        });
        const ctx = graph.chainRegistry.createChainContext(chain);
        built.ctx = ctx;
        if (opts.failAfter === 'context') {
            // Let the WebSocket open first, so the cleanup has a live socket to take down.
            await Promise.resolve();
            await Promise.resolve();
            throw new Error('createScenario: injected failure after the chain context was built');
        }
        const dex = chain.dexes.find((d) => d.dexType === 'v2' && d.name === 'uniswap-v2') as DexConfigV2 | undefined;
        if (!dex) throw new Error('createScenario: uniswap-v2 is missing from the eth template');

        const weth = getAddress(chain.wethAddress);
        const token = labelAddress('eth.v2.token');
        const [token0, token1] = token.toLowerCase() < weth.toLowerCase() ? [token, weth] : [weth, token];
        const pair = getCreate2Address(dex.factoryAddress, solidityPackedKeccak256(['address', 'address'], [token0, token1]), UNISWAP_V2_INIT_CODE_HASH);
        const wallet = ctx.wallet;
        const reserves = { weth: parseEther('5'), token: parseEther('1000000') };
        const tokenSupply = parseEther('1000000000');
        const lpSupply = parseEther('2236');
        const router = dex.routerAddress;
        const reserveOf = (addr: string): bigint | undefined =>
            addr.toLowerCase() === weth.toLowerCase() ? reserves.weth : addr.toLowerCase() === token.toLowerCase() ? reserves.token : undefined;

        node.setBalance(wallet.address, parseEther('10'));
        // Runtime code of a plain ERC-20: a PUSH4 per implemented selector, none of the setter
        // selectors src/utils/honeypot/bytecodeScan.ts looks for.
        const erc20Selectors = ['06fdde03', '95d89b41', '313ce567', '18160ddd', '70a08231', 'a9059cbb', '095ea7b3', 'dd62ed3e', '23b872dd'];
        node.setCode(token, '0x608060405234801561001057600080fd5b50600436106100a95760003560e01c' + erc20Selectors.map((s) => `8063${s}14`).join(''));
        node.setCode(pair, '0x608060405234801561001057600080fd5b50600436106101b05760003560e01c80630902f1ac14');

        // Token reads.
        node.setRead(token, 'name()', encodeResult(['string'], ['Realpath Launch Token']));
        node.setRead(token, 'symbol()', encodeResult(['string'], ['RPLT']));
        node.setRead(token, 'decimals()', encodeResult(['uint8'], [18]));
        node.setRead(token, 'totalSupply()', encodeResult(['uint256'], [tokenSupply]));
        node.setRead(token, 'tradingEnabled()', encodeResult(['bool'], [true]));
        // A token with no wallet or transaction limit has none of these functions: a real node reverts.
        for (const sig of ['maxWalletAmount()', 'maxWallet()', 'maxTxAmount()', 'maxTransactionAmount()']) node.setRead(token, sig, REVERT_EMPTY);
        node.setRead(token, 'balanceOf(address)', ({ args }) => {
            const who = String(args[0]).toLowerCase();
            if (who === pair.toLowerCase()) return encodeResult(['uint256'], [reserves.token]);
            if (who === wallet.address.toLowerCase()) {
                const bought = node.submitted.filter((s) => s.status === 'mined' && s.tx.to?.toLowerCase() === router.toLowerCase() && s.tx.from?.toLowerCase() === who);
                const total = bought.reduce((a, s) => a + v2AmountOut(s.tx.value, reserves.weth, reserves.token), 0n);
                return encodeResult(['uint256'], [total]);
            }
            return encodeResult(['uint256'], [0n]);
        });

        // Pair reads.
        node.setRead(pair, 'token0()', encodeResult(['address'], [token0]));
        node.setRead(pair, 'token1()', encodeResult(['address'], [token1]));
        node.setRead(pair, 'getReserves()', () => {
            const r0 = token0 === weth ? reserves.weth : reserves.token;
            const r1 = token0 === weth ? reserves.token : reserves.weth;
            return encodeResult(['uint112', 'uint112', 'uint32'], [r0, r1, Math.floor(FIXED_EPOCH_MS / 1000) - 12]);
        });
        node.setRead(pair, 'totalSupply()', encodeResult(['uint256'], [lpSupply]));

        // Router reads: constant-product quotes on the scenario reserves.
        node.setRead(router, 'getAmountsOut(uint256,address[])', ({ args }) => {
            const amountIn = args[0] as bigint;
            const p = (args[1] as string[]).map(String);
            if (p.length !== 2) return revertReason('UniswapV2Library: INVALID_PATH');
            const rin = reserveOf(p[0]);
            const rout = reserveOf(p[1]);
            if (rin === undefined || rout === undefined) return REVERT_EMPTY; // no pair: getReserves on a missing pair reverts
            return encodeResult(['uint256[]'], [[amountIn, v2AmountOut(amountIn, rin, rout)]]);
        });
        node.setRead(router, 'swapExactETHForTokens(uint256,address[],address,uint256)', ({ args, value }) => {
            const p = (args[1] as string[]).map(String);
            if (p[0].toLowerCase() !== weth.toLowerCase()) return revertReason('UniswapV2Router: INVALID_PATH');
            const rout = reserveOf(p[1]);
            if (rout === undefined) return REVERT_EMPTY;
            if ((args[3] as bigint) < BigInt(Math.floor(Date.now() / 1000))) return revertReason('UniswapV2Router: EXPIRED');
            const out = v2AmountOut(value, reserves.weth, rout);
            if (out < (args[0] as bigint)) return revertReason('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
            return encodeResult(['uint256[]'], [[value, out]]);
        });

        // HoneypotChecker (the committed ETH default address): a clean round trip ends in the
        // RoundtripResult custom-error revert with status 0x07 and 0 bps both ways.
        const checker = checkerInterface();
        const checkerAddress = chain.honeypotChecker.deployedAddress;
        if (!checkerAddress) throw new Error('createScenario: the eth chain has no HoneypotChecker address');
        node.setRead(checkerAddress, 'checkV2(address,address,uint256)', ({ args }) => {
            if (String(args[1]).toLowerCase() !== token.toLowerCase()) return revertWith(checker.encodeErrorResult('BuyFailed', ['no liquidity']));
            return revertWith(checker.encodeErrorResult('RoundtripResult', [0n, 0n, 7]));
        });

        // ETH safety APIs routed by URL (Pitfall 10): Unicrypt reports a lock that runs 30 days.
        routeHttp('https://api.unicrypt.network/api/v2/locker/pair/', (req) => {
            if (!req.url.toLowerCase().startsWith(`https://api.unicrypt.network/api/v2/locker/pair/${pair.toLowerCase()}?`)) return { status: 404, data: { message: 'not found' } };
            return { data: { locks: [{ unlock_date: Math.floor(Date.now() / 1000) + 30 * 86_400, amount: lpSupply.toString() }] } };
        });

        const deployer = new Wallet(ethers.id('realpath.deployer'));
        node.setBalance(deployer.address, parseEther('20'));
        let fired = false;
        const fireNewPair = async (): Promise<{ block: number; log: FakeLog }> => {
            if (fired) throw new Error('fireNewPair: this scenario already launched its pair');
            fired = true;
            const raw = await deployer.signTransaction({
                type: 2,
                chainId: 1,
                nonce: node.minedCount(deployer.address),
                to: router,
                value: reserves.weth,
                gasLimit: 4_000_000n,
                maxFeePerGas: 40n * 1_000_000_000n,
                maxPriorityFeePerGas: 2n * 1_000_000_000n,
                data: UNISWAP_V2_ROUTER.encodeFunctionData('addLiquidityETH', [token, reserves.token, reserves.token, reserves.weth, deployer.address, Math.floor(Date.now() / 1000) + 600]),
            });
            const hash = node.addForeignTransaction(raw);
            const block = node.mine({ include: [hash] });
            const encoded = UNISWAP_V2_FACTORY.encodeEventLog('PairCreated', [token0, token1, pair, 1n]);
            const log: FakeLog = {
                address: dex.factoryAddress.toLowerCase(),
                topics: encoded.topics,
                data: encoded.data,
                blockNumber: toQuantity(block),
                blockHash: node.blockHash(block),
                transactionHash: hash,
                transactionIndex: '0x0',
                logIndex: '0x0',
                removed: false,
            };
            node.emitLogs([log]);
            return { block, log };
        };

        return { node, graph, registry, ctx, dex, token, pair, wallet, weth, reserves, fireNewPair, dispose };
    } catch (e) {
        let teardown: unknown;
        try {
            await dispose();
        } catch (d) {
            teardown = d;
        }
        if (teardown !== undefined) throw new AggregateError([e, teardown], `createScenario failed and its cleanup also failed: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
    }
}

/** Await every registered disposer, newest first. Idempotent; never discards a teardown error. */
export async function disposeScenarios(): Promise<void> {
    const st = harnessState();
    const errors: unknown[] = [];
    while (st.disposers.length > 0) {
        const d = st.disposers.pop()!;
        try {
            await d();
        } catch (e) {
            errors.push(e);
        }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `disposeScenarios: ${errors.length} scenarios failed to tear down`);
}
