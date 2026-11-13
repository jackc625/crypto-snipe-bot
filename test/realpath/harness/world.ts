// test/realpath/harness/world.ts
// Phase 23 plan 23-01 (CHAR-01, AC-01, AC-03): the world a real-path scenario runs in.
//
//   - Fixed clock (D-05): every timer and the date are fake and stepped by the test, including
//     ethers' 10 ms JSON-RPC batching timer and performance.now (src/exitEngine.ts measures with
//     it). SQLite's unixepoch() is overridden on the test connection so DEFAULT (unixepoch())
//     reads the same clock (RESEARCH Pattern 5); capture.ts installDbCapture does it together
//     with the DB capture (plan 23-02).
//   - loadGraph(): a whole-graph reset. closeDb() on the previous graph, vi.resetModules(), then
//     dynamic imports of the real src/ modules on a fresh :memory: database built by the real
//     migrations (src/utils/db.ts opens and migrates at import). The connection is the existing
//     `db` export; no getter is added (D-14 as corrected, SPEC Amendment A-3). Every new
//     connection gets the DB capture and the SQL clock in the same helper, so a reset can never
//     leave a connection uncaptured (RESEARCH Pitfall 5).
//   - A file database (plan 23-27): createTempDbFile() makes a new folder under os.tmpdir() and
//     returns a database path inside it; loadGraph({ db: { file } }) and createScenario({ db })
//     open the graph on that file. Before any src/ import, loadGraph refuses a file whose real
//     path is not inside the OS temp folder, and refuses a DB_PATH other than :memory: in memory
//     mode, so no proof can be pointed at the live database (T-23-43). restartGraph() stops the
//     running graph (timers, providers, held calls, closeDb) and loads the whole graph again on
//     the same file and the same FakeNode, as a process restart would.
//   - routeHttp(): per-scenario routes for the axios mock; an unmatched URL is a stray.
//   - The graph also holds the real src/telegramListener; its Telegram client is the setup.ts
//     fake, and scenario disposal (and a restart) empties the registered handlers (plan 23-27).
//   - createScenario(): one chain (eth, bsc, base or arb), one DEX (V2 or V3), a token, a pair or
//     pool and the reads a real node would answer, all built with real ethers encoders (D-04).
//     A non-ETH chain gets its *_HONEYPOT_CHECKER_ADDRESS before the graph loads (RESEARCH Open
//     Question 6). Each chain's MEV route is served: Flashbots on the node's relay endpoint,
//     bloXroute through the axios route, the public route through eth_sendRawTransaction.
//     fireNewPair() / fireNewPool() mine the real launch and deliver its event (D-06). It
//     registers one awaited disposer. (Plan 23-28.)
//   - assertNoStrays() / assertAllFaultsFired(): run in afterEach by setup.ts.
//
// The better-sqlite3 handle is named `db` in this file because test/unit/rails/spawnSites.test.ts
// accepts `.exec()` only on named receivers.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { ethers, AbiCoder, Interface, Wallet, getAddress, getCreate2Address, solidityPackedKeccak256, parseEther } from 'ethers';
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
import { createTimeline, installDbCapture, type Timeline } from './capture';

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

/**
 * Prove `promise` is still pending after `virtualMs` of fake time (RESEARCH Pattern 2: deadlock
 * findings). Steps the clock and fails, naming when, if the promise resolves or rejects inside
 * the window. Its rejection is observed here, so a settled promise never becomes unhandled.
 */
export async function expectStillPending(promise: Promise<unknown>, virtualMs: number, opts: { stepMs?: number; what?: string } = {}): Promise<void> {
    if (!vi.isFakeTimers()) throw new Error('expectStillPending: the fixed clock is not installed (call useFixedClock or createScenario first)');
    if (!(virtualMs > 0)) throw new Error(`expectStillPending: virtualMs must be positive, got ${virtualMs}`);
    const stepMs = opts.stepMs ?? 10;
    const what = opts.what ?? 'the promise';
    const start = Date.now();
    // Widened on purpose: the callbacks assign it, which control-flow narrowing cannot see.
    let state = 'pending' as 'pending' | 'resolved' | 'rejected';
    let outcome: unknown;
    let settledAt = 0;
    promise.then(
        (v) => {
            state = 'resolved';
            outcome = v;
            settledAt = Date.now() - start;
        },
        (e: unknown) => {
            state = 'rejected';
            outcome = e;
            settledAt = Date.now() - start;
        },
    );
    // One microtask turn first, so an already-settled promise is caught before any time passes.
    await Promise.resolve();
    const end = start + virtualMs;
    while (state === 'pending' && Date.now() < end) await vi.advanceTimersByTimeAsync(Math.min(stepMs, end - Date.now()));
    if (state === 'pending') return;
    const shown = state === 'rejected' ? (outcome instanceof Error ? `${outcome.name}: ${outcome.message}` : String(outcome)) : (() => {
        try {
            return JSON.stringify(outcome);
        } catch {
            return String(outcome);
        }
    })();
    throw new Error(`expectStillPending: ${what} settled (${state}) after ${settledAt} of ${virtualMs} virtual ms: ${shown}`);
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
type TelegramListenerModule = typeof import('../../../src/telegramListener');

export interface Graph {
    bot: BotModule;
    chainRegistry: ChainRegistryModule;
    dbModule: DbModule;
    exitEngine: ExitEngineModule;
    detector: DetectorModule;
    exitManager: ExitManagerModule;
    /** The real Telegram alpha listener; its client is the setup.ts fake (plan 23-27, telegram.ts). */
    telegramListener: TelegramListenerModule;
    /** The real better-sqlite3 connection src/utils/db.ts opened (its existing `db` export). */
    db: DbModule['db'];
}

let currentGraph: Graph | null = null;

function closeGraphDb(graph: Graph | null): void {
    if (graph && graph.db.open) graph.dbModule.closeDb();
}

// ---------------------------------------------------------------------------------------------
// File databases (plan 23-27, T-23-43)
// ---------------------------------------------------------------------------------------------

/** Where a graph's database lives: a fresh :memory: database (the default) or a temp file. */
export type GraphDb = 'memory' | { file: string };

export interface LoadGraphOptions {
    db?: GraphDb;
}

const IS_WIN = process.platform === 'win32';
const TEMP_DB_PREFIX = 'csb-realpath-db-';

/** The real path of the nearest existing ancestor plus the rest; opens nothing, creates nothing. */
function realPathOf(p: string): string {
    const tail: string[] = [];
    let cur = path.resolve(p);
    for (;;) {
        try {
            return path.join(fs.realpathSync.native(cur), ...tail);
        } catch {
            const parent = path.dirname(cur);
            if (parent === cur) return path.resolve(p);
            tail.unshift(path.basename(cur));
            cur = parent;
        }
    }
}

function comparable(p: string): string {
    const s = p.replace(/[\\/]+$/, '');
    return IS_WIN ? s.toLowerCase() : s;
}

/** True when `p` really sits inside `dir` (not equal to it), after resolving links on both. */
function isInside(p: string, dir: string): boolean {
    const target = comparable(realPathOf(p));
    const root = comparable(realPathOf(dir));
    return target.startsWith(root + path.sep);
}

/**
 * Refuse any database file a proof could use to reach a real database: it must be an absolute
 * path whose real location is inside the OS temp folder. Win32 device, UNC and alternate data
 * stream spellings are refused outright, because their real target cannot be read from the text.
 * Returns the path as given, resolved. Never opens or creates anything.
 */
export function assertTempDbFile(file: unknown): string {
    const rule = `a harness database file must be an absolute path inside the operating system's temp folder (${os.tmpdir()}), so no proof can reach the live database`;
    const refuse = (why: string): never => {
        throw new Error(`loadGraph: refused database file ${JSON.stringify(file)}: ${why}; ${rule}`);
    };
    if (typeof file !== 'string' || file === '') return refuse('it is not a non-empty string');
    if (file === ':memory:') return refuse(":memory: is not a file (use db: 'memory')");
    if (!path.isAbsolute(file)) return refuse('it is a relative path (src/utils/db.ts would resolve it against the repository root)');
    if (IS_WIN) {
        if (/^[\\/]{2}/.test(file)) return refuse('a UNC or device path cannot be checked');
        if (file.slice(2).includes(':')) return refuse('an alternate data stream name cannot be checked');
        if (file.split(/[\\/]+/).some((seg, i) => i > 0 && /[. ]$/.test(seg) && seg !== '.' && seg !== '..')) return refuse('a segment ending in a dot or space is renamed by Windows');
    }
    if (!isInside(file, os.tmpdir())) return refuse(`its real path ${realPathOf(file)} is not inside the temp folder`);
    return path.resolve(file);
}

/**
 * A database path inside a new folder under os.tmpdir(). The file itself does not exist yet (the
 * real db.ts creates and migrates it under Vitest). The folder is removed by the disposer of the
 * scenario that runs on it, or, if no scenario does, by its own disposer in afterEach.
 */
export function createTempDbFile(): string {
    const st = harnessState();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DB_PREFIX));
    st.tempDbDirs.push(dir);
    st.disposers.push(async () => removeTempDbDir(dir));
    return path.join(dir, 'graph.db');
}

/** Remove a folder createTempDbFile made (and only such a folder). Idempotent. */
function removeTempDbDir(dir: string): void {
    const st = harnessState();
    const i = st.tempDbDirs.indexOf(dir);
    if (i < 0) return;
    if (!path.basename(dir).startsWith(TEMP_DB_PREFIX) || !isInside(dir, os.tmpdir())) throw new Error(`removeTempDbDir: ${dir} is not a harness temp folder`);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (fs.existsSync(dir)) throw new Error(`removeTempDbDir: ${dir} is still there after removal`);
    st.tempDbDirs.splice(i, 1);
}

/** The createTempDbFile folder holding `file`, or undefined when the file is not in one. */
function tempDbDirOf(file: string): string | undefined {
    const dir = path.dirname(path.resolve(file));
    return harnessState().tempDbDirs.find((d) => comparable(d) === comparable(dir));
}

/**
 * Close the previous graph's DB, reset every module, and import the real graph on a fresh
 * :memory: database, or on `db.file` (see assertTempDbFile). Fixes SQLite's clock to the fake
 * one (D-05). Every refusal happens before any src/ module is imported.
 */
export async function loadGraph(opts: LoadGraphOptions = {}): Promise<Graph> {
    const dbOpt = opts.db ?? 'memory';
    let file: string | null = null;
    if (dbOpt === 'memory') {
        const raw = process.env.DB_PATH;
        if (raw !== undefined && raw !== '' && raw !== ':memory:') {
            throw new Error(`loadGraph: refused DB_PATH ${JSON.stringify(raw)} in memory mode: a harness graph opens :memory: or a temp file given as db: { file } (createTempDbFile), so no proof can reach the live database`);
        }
    } else if (typeof dbOpt === 'object' && dbOpt !== null && 'file' in dbOpt) {
        file = assertTempDbFile(dbOpt.file);
    } else {
        throw new Error(`loadGraph: db must be 'memory' or { file }, got ${JSON.stringify(dbOpt)}`);
    }
    closeGraphDb(currentGraph);
    currentGraph = null;
    vi.resetModules();
    process.env.DB_PATH = file ?? ':memory:';
    const dbModule = await import('../../../src/utils/db');
    if (file !== null && comparable(realPathOf(dbModule.getDbFilePath())) !== comparable(realPathOf(file))) {
        dbModule.closeDb();
        throw new Error(`loadGraph: the graph opened ${dbModule.getDbFilePath()}, not the requested ${file}`);
    }
    const chainRegistry = await import('../../../src/chainRegistry');
    const exitManager = await import('../../../src/utils/exitManager');
    const exitEngine = await import('../../../src/exitEngine');
    const detector = await import('../../../src/anti-rug/detector');
    const bot = await import('../../../src/bot');
    const telegramListener = await import('../../../src/telegramListener');
    const db = dbModule.db;
    // The capture and the SQL clock, one call, on every new connection (Pitfall 5). unixepoch()
    // with no argument reads the fake clock; an argument is a capture violation (capture.ts).
    const st = harnessState();
    if (!st.timeline) st.timeline = createTimeline();
    installDbCapture(db, st.timeline);
    currentGraph = { bot, chainRegistry, dbModule, exitEngine, detector, exitManager, telegramListener, db };
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
    const params = (config as { params?: unknown } | undefined)?.params;
    st.httpLog.push({ seq: nextSeq(), method, url, data, ...(params !== undefined ? { params } : {}), matched: route !== undefined });
    if (!route) {
        const stray: Stray = { seq: nextSeq(), kind: 'url', url, detail: `unknown URL ${url} (axios ${method.toUpperCase()})` };
        if (st.node) st.node.strays.push(stray);
        else st.orphanStrays.push(stray);
        throw axiosError(`realpath harness: no route for ${method.toUpperCase()} ${url}`, config, undefined, 'ERR_REALPATH_NO_ROUTE');
    }
    const req: HttpRequestInfo = { method, url, data, config };
    let reply: Awaited<ReturnType<HttpHandler>>;
    try {
        reply = await route.handler(req);
    } catch (e) {
        // A harness bug must not look like a service answer (as on the JSON-RPC path, chain.ts):
        // production catches every axios error, so the stray is what fails the test (WR-04).
        const detail = `harness error answering axios ${method.toUpperCase()} ${url}: ${e instanceof Error ? e.message : String(e)}`;
        const stray: Stray = { seq: nextSeq(), kind: 'url', url, detail };
        if (st.node) st.node.strays.push(stray);
        else st.orphanStrays.push(stray);
        throw axiosError('realpath harness: internal error', config, { status: 500, data: { error: 'internal error' }, headers: { 'content-type': 'application/json' } }, 'ERR_REALPATH_HARNESS');
    }
    const status = reply.status ?? 200;
    const headers = reply.headers ?? { 'content-type': 'application/json' };
    if (status >= 400) throw axiosError(`Request failed with status code ${status}`, config, { status, data: reply.data, headers }, 'ERR_BAD_RESPONSE');
    return { data: reply.data, status, statusText: 'OK', headers, config };
}

harnessState().routeAxios = routeAxios;
// A timeline exists from the start, so no feed ever records into nothing; createScenario and
// resetTestState start a fresh one.
if (!harnessState().timeline) harnessState().timeline = createTimeline();

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

/**
 * Throw naming a fault or hold that never fired: a fault aimed at the wrong operation, or armed
 * behind an `after` stage the scenario never reached, would otherwise pass unnoticed.
 */
export function assertAllFaultsFired(): void {
    const st = harnessState();
    const unfired = st.nodes.flatMap((n) => n.faults.filter((f) => f.fired === 0));
    if (unfired.length === 0) return;
    const more = unfired.length > 1 ? ` (and ${unfired.length - 1} more: ${unfired.slice(1, 6).map((f) => f.describe()).join('; ')})` : '';
    throw new Error(`realpath harness: a ${unfired[0].kind} never fired: ${unfired[0].describe()}${more}`);
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
    st.telegram = { clients: [], handlers: [] };
    st.timeline = createTimeline();
    st.violations = [];
    // Each folder's disposer removed it already (a failed removal failed the test by name).
    st.tempDbDirs = [];
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
/** Canonical Uniswap V3 ABIs (factory, pool, QuoterV2, SwapRouter02, NonfungiblePositionManager). */
const UNISWAP_V3_FACTORY = new Interface(['event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)']);
const UNISWAP_V3_POOL = new Interface([
    'event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
]);
const UNISWAP_V3_QUOTER_V2 = new Interface([
    'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);
const UNISWAP_V3_SWAP_ROUTER_02 = new Interface([
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
    'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
]);
const UNISWAP_V3_NPM = new Interface([
    'function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)',
    'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
    'function multicall(bytes[] data) payable returns (bytes[] results)',
]);

/** CREATE2 pair init code hashes of the real V2 factories (keccak256 of the pair creation code). */
const V2_INIT_CODE_HASH: Record<string, string> = {
    'eth/uniswap-v2': '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
    'eth/sushiswap-v2': '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c520363afb7d6c5a5f0f1a',
    'bsc/pancakeswap-v2': '0x00fb7f630766e6a796048ea87d01acd3068e8ff67d078148a3fa3f4a84f69bd5',
    'base/uniswap-v2': '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
    'arb/uniswap-v2': '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
};
/** Uniswap V3 POOL_INIT_CODE_HASH (pools deployed by the factory itself). */
const UNISWAP_V3_POOL_INIT_CODE_HASH = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54';
/** The real NonfungiblePositionManager per chain and V3 DEX (the launch transaction's target). */
const V3_POSITION_MANAGER: Record<string, string> = {
    'eth/uniswap-v3': '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    'arb/uniswap-v3': '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    'base/uniswap-v3': '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
    'bsc/uniswap-v3': '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613',
    'bsc/pancakeswap-v3': '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364',
};
/** V3 fee tier to tick spacing (Uniswap V3 factory defaults). */
const TICK_SPACING: Record<number, number> = { 100: 1, 500: 10, 3000: 60, 10000: 200 };

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

/**
 * A V3 exact-input quote on the pool's virtual reserves (constant product inside one full-range
 * position, fee in hundredths of a basis point). Close enough for every quote the bot sizes from;
 * an exact tick-by-tick quote is fork territory (AC-16).
 */
export function v3AmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, fee: number): bigint {
    const afterFee = (amountIn * BigInt(1_000_000 - fee)) / 1_000_000n;
    return (afterFee * reserveOut) / (reserveIn + afterFee);
}

function isqrt(n: bigint): bigint {
    if (n < 2n) return n;
    let x = n;
    let y = (x + 1n) / 2n;
    while (y < x) {
        x = y;
        y = (x + n / x) / 2n;
    }
    return x;
}

export type ScenarioChain = 'eth' | 'bsc' | 'base' | 'arb';
export type ScenarioDexType = 'v2' | 'v3';

export interface ScenarioOptions<D extends ScenarioDexType = ScenarioDexType> {
    chain: ScenarioChain;
    dexType: D;
    /** A DEX of that type by name (default: the chain template's first one, e.g. pancakeswap-v2). */
    dexName?: string;
    /** V3 fee tier (default 3000). */
    feeTier?: number;
    /** Env values applied before the graph loads and restored by dispose. */
    overrides?: Record<string, string | undefined>;
    /**
     * The graph's database: 'memory' (default) or { file } inside the OS temp folder, normally
     * from createTempDbFile(). A file database survives restartGraph(); dispose removes the
     * folder when createTempDbFile made it.
     */
    db?: GraphDb;
    /**
     * Self-test hook (plan 23-01 Task 2): throw after this stage so the partial-startup cleanup
     * can be proven. Never set by a scenario.
     */
    failAfter?: 'graph' | 'context';
}

type ChainContext = ReturnType<ChainRegistryModule['createChainContext']>;
type ChainConfig = Parameters<ChainRegistryModule['createChainContext']>[0];
type DexConfigV2 = Extract<ChainConfig['dexes'][number], { dexType: 'v2' }>;
type DexConfigV3 = Extract<ChainConfig['dexes'][number], { dexType: 'v3' }>;
export type ScenarioDex<D extends ScenarioDexType> = D extends 'v3' ? DexConfigV3 : DexConfigV2;

/**
 * What each chain's node looks like (D-04: synthetic, real-shaped). BSC blocks carry a zero base
 * fee, as BSC has since its EIP-1559 fork, so ethers treats it as a gasPrice chain; Base and
 * Arbitrum carry their small L2 base fees; Arbitrum's priority fee is zero.
 */
const CHAIN_NODE: Record<ScenarioChain, { chainId: number; headBlock: number; baseFeePerGas: bigint; priorityFeePerGas: bigint; nativeReserve: bigint }> = {
    eth: { chainId: 1, headBlock: 21_000_000, baseFeePerGas: 10_000_000_000n, priorityFeePerGas: 1_000_000_000n, nativeReserve: parseEther('5') },
    bsc: { chainId: 56, headBlock: 50_000_000, baseFeePerGas: 0n, priorityFeePerGas: 1_000_000_000n, nativeReserve: parseEther('20') },
    base: { chainId: 8453, headBlock: 30_000_000, baseFeePerGas: 5_000_000n, priorityFeePerGas: 1_000_000n, nativeReserve: parseEther('5') },
    arb: { chainId: 42161, headBlock: 300_000_000, baseFeePerGas: 10_000_000n, priorityFeePerGas: 0n, nativeReserve: parseEther('5') },
};

export interface Scenario<D extends ScenarioDexType = ScenarioDexType> {
    node: FakeNode;
    graph: Graph;
    registry: Map<string, ChainConfig>;
    ctx: ChainContext;
    chain: ScenarioChain;
    dex: ScenarioDex<D>;
    token: string;
    /** The V2 pair, or the V3 pool. */
    pair: string;
    /** V3 fee tier, null for V2. */
    feeTier: number | null;
    /** The HoneypotChecker address the chain reads (the template default on ETH, a scenario address elsewhere). */
    checker: string;
    wallet: ChainContext['wallet'];
    weth: string;
    reserves: { weth: bigint; token: bigint };
    /** The ordered timeline of this scenario: op logs, submissions, relay bodies, DB writes (D-13). */
    timeline: Timeline;
    /** V2: mine the launch's addLiquidityETH and deliver its real PairCreated log (D-06). */
    fireNewPair(): Promise<{ block: number; log: FakeLog }>;
    /** V3: mine the launch's create-and-mint and deliver its real PoolCreated, with the same-block Mint stored for eth_getLogs. */
    fireNewPool(): Promise<{ block: number; poolCreated: FakeLog; mint: FakeLog }>;
    dispose(): Promise<void>;
}

interface BuiltParts {
    node?: FakeNode;
    graph?: Graph;
    ctx?: ChainContext;
}

/** What restartGraph needs from a scenario that the scenario object does not expose. */
interface ScenarioInternals {
    built: BuiltParts;
    db: GraphDb;
    chainName: ScenarioChain;
    dexName: string;
    isDisposed(): boolean;
}

const SCENARIO_INTERNALS = new WeakMap<object, ScenarioInternals>();

/**
 * The graph-level half of teardown, shared by dispose and restartGraph so a restart stops the
 * running graph exactly as a teardown does. Each step's error is collected, never thrown early.
 */
async function stopGraphParts(built: BuiltParts, step: (what: string, fn: () => unknown) => Promise<void>): Promise<void> {
    // 1. Nothing stays parked. A call still parked is answered with an error (never a node
    //    answer), and microtasks drain before timers stop and providers are destroyed, so the
    //    answer reaches its caller instead of a "provider destroyed" cancellation. Microtasks
    //    only: no timer-driven work runs during teardown.
    await step('release held calls', async () => {
        const parked = built.node?.releaseAll() ?? 0;
        if (parked > 0) for (let i = 0; i < 50; i++) await Promise.resolve();
    });
    // 2. Timers: the bot's own registry, then every fake timer.
    await step('clear bot timers', () => built.graph?.exitManager.clearAllTimers());
    await step('clear fake timers', () => {
        if (vi.isFakeTimers()) vi.clearAllTimers();
    });
    // 3. Providers: raw socket listeners first so a teardown close cannot start a reconnect.
    await step('detach socket listeners', () => {
        // A socket still CONNECTING emits 'error' when the teardown closes it, as ws does (WR-03).
        // That close is the harness's, not the bot's, so the teardown listens for it.
        for (const ws of FakeWebSocket.instances) {
            ws.removeAllListeners();
            ws.on('error', () => undefined);
        }
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
}

/** Build a scenario. Every partial start is cleaned up by the same disposer before rethrowing. */
export async function createScenario<D extends ScenarioDexType>(opts: ScenarioOptions<D>): Promise<Scenario<D>> {
    if (!(opts.chain in CHAIN_NODE)) throw new Error(`createScenario: unknown chain ${String(opts.chain)} (eth, bsc, base or arb)`);
    if (opts.dexType !== 'v2' && opts.dexType !== 'v3') throw new Error(`createScenario: unknown dexType ${String(opts.dexType)} (v2 or v3)`);
    const st = harnessState();
    const envSnapshot: Record<string, string | undefined> = { ...process.env };
    const installedClock = !vi.isFakeTimers();
    const built: BuiltParts = {};
    const dbOpt: GraphDb = opts.db ?? 'memory';
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
        // 1-4. Held calls, timers, providers, database.
        await stopGraphParts(built, step);
        // The temp folder of a file database, once its connection is closed.
        await step('remove temp database folder', () => {
            if (dbOpt === 'memory' || typeof dbOpt !== 'object' || dbOpt === null || typeof dbOpt.file !== 'string') return;
            const dir = tempDbDirOf(dbOpt.file);
            if (dir) removeTempDbDir(dir);
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
        await step('clear Telegram handlers', () => {
            st.telegram.handlers.length = 0;
            st.telegram.clients.length = 0;
        });
        await step('restore clock', () => {
            if (installedClock && vi.isFakeTimers()) vi.useRealTimers();
        });
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, `dispose: ${errors.length} teardown steps failed`);
    };
    st.disposers.push(dispose);

    // A test reads only its own scenario: alerts, logs and the timeline start empty here.
    st.alerts = [];
    st.logs = [];
    const timeline = createTimeline();
    st.timeline = timeline;

    try {
        useFixedClock();
        const chainName = opts.chain;
        const prefix = chainName.toUpperCase();
        // Scenario configuration, before the graph loads (RESEARCH Open Question 6): only this
        // chain is enabled, and a non-ETH chain gets a checker address in the fake table, because
        // BSC, Base and Arbitrum have no default and are fail-closed without one.
        process.env.ENABLED_CHAINS = chainName;
        const scenarioChecker = chainName === 'eth' ? undefined : labelAddress(`${chainName}.honeypot-checker`);
        if (scenarioChecker) process.env[`${prefix}_HONEYPOT_CHECKER_ADDRESS`] = scenarioChecker;
        for (const [k, v] of Object.entries(opts.overrides ?? {})) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        installSeams();

        const profile = CHAIN_NODE[chainName];
        const node = new FakeNode({ chainId: profile.chainId, headBlock: profile.headBlock, baseFeePerGas: profile.baseFeePerGas, priorityFeePerGas: profile.priorityFeePerGas });
        built.node = node;
        st.node = node;
        st.nodes.push(node);

        const graph = await loadGraph({ db: dbOpt });
        built.graph = graph;
        if (opts.failAfter === 'graph') throw new Error('createScenario: injected failure after the graph loaded');

        const registry = graph.chainRegistry.buildChainRegistry();
        const chain = registry.get(chainName);
        if (!chain || !chain.enabled) throw new Error(`createScenario: the ${chainName} chain is not enabled in the test environment`);
        if (chain.chainId !== profile.chainId) throw new Error(`createScenario: the ${chainName} template is chain ${chain.chainId}, the scenario node is ${profile.chainId}`);
        node.serve({
            rpc: [chain.httpRpcUrl],
            ws: chain.wsRpcUrl ? [chain.wsRpcUrl] : [],
            relay: chain.mevStrategy === 'flashbots' ? [chain.mevConfig.relayUrl] : [],
        });
        const ctx = graph.chainRegistry.createChainContext(chain);
        built.ctx = ctx;
        if (opts.failAfter === 'context') {
            // Let the WebSocket open first, so the cleanup has a live socket to take down.
            await Promise.resolve();
            await Promise.resolve();
            throw new Error('createScenario: injected failure after the chain context was built');
        }
        const dex = chain.dexes.find((d) => d.dexType === opts.dexType && (opts.dexName === undefined || d.name === opts.dexName));
        if (!dex) throw new Error(`createScenario: ${chainName} has no ${opts.dexType} DEX${opts.dexName ? ` named ${opts.dexName}` : ''}`);
        const checker = chain.honeypotChecker.deployedAddress;
        if (!checker) throw new Error(`createScenario: the ${chainName} chain has no HoneypotChecker address`);
        if (scenarioChecker && checker.toLowerCase() !== scenarioChecker.toLowerCase()) throw new Error(`createScenario: ${prefix}_HONEYPOT_CHECKER_ADDRESS did not reach the registry (${checker})`);

        const chainId = chain.chainId;
        const weth = getAddress(chain.wethAddress);
        const token = labelAddress(`${chainName}.${opts.dexType}.token`);
        const [token0, token1] = token.toLowerCase() < weth.toLowerCase() ? [token, weth] : [weth, token];
        const wallet = ctx.wallet;
        const reserves = { weth: profile.nativeReserve, token: parseEther('1000000') };
        const tokenSupply = parseEther('1000000000');
        const lpSupply = isqrt(reserves.weth * reserves.token);
        const reserveOf = (addr: string): bigint | undefined =>
            addr.toLowerCase() === weth.toLowerCase() ? reserves.weth : addr.toLowerCase() === token.toLowerCase() ? reserves.token : undefined;

        // Pair (V2) or pool (V3) address, by the real CREATE2 rule where the init code hash is known.
        let pair: string;
        let feeTier: number | null = null;
        let swapTarget: string;
        let quoteOut: (amountIn: bigint, tokenIn: string, tokenOut: string) => bigint | undefined;
        if (dex.dexType === 'v2') {
            const initHash = V2_INIT_CODE_HASH[`${chainName}/${dex.name}`];
            pair = initHash
                ? getCreate2Address(dex.factoryAddress, solidityPackedKeccak256(['address', 'address'], [token0, token1]), initHash)
                : labelAddress(`${chainName}.${dex.name}.pair`);
            swapTarget = dex.routerAddress;
            quoteOut = (amountIn, tokenIn, tokenOut) => {
                const rin = reserveOf(tokenIn);
                const rout = reserveOf(tokenOut);
                return rin === undefined || rout === undefined ? undefined : v2AmountOut(amountIn, rin, rout);
            };
        } else {
            feeTier = opts.feeTier ?? 3000;
            if (!(feeTier in TICK_SPACING)) throw new Error(`createScenario: fee tier ${feeTier} is not a V3 factory default (100, 500, 3000, 10000)`);
            const fee = feeTier;
            pair = dex.name === 'uniswap-v3'
                ? getCreate2Address(dex.factoryAddress, ethers.keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint24'], [token0, token1, fee])), UNISWAP_V3_POOL_INIT_CODE_HASH)
                : labelAddress(`${chainName}.${dex.name}.pool.${fee}`);
            swapTarget = dex.swapRouterAddress;
            quoteOut = (amountIn, tokenIn, tokenOut) => {
                const rin = reserveOf(tokenIn);
                const rout = reserveOf(tokenOut);
                return rin === undefined || rout === undefined ? undefined : v3AmountOut(amountIn, rin, rout, fee);
            };
        }

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
        // The bot's token balance: what each of its mined buys bought, at the scenario price. A buy
        // that reverted on chain bought nothing (WR-01).
        const boughtBy = (who: string): bigint =>
            node.submitted
                .filter((s) => s.status === 'mined' && node.succeeded(s.hash) && s.tx.to?.toLowerCase() === swapTarget.toLowerCase() && s.tx.from?.toLowerCase() === who)
                .reduce((a, s) => a + (quoteOut(s.tx.value, weth, token) ?? 0n), 0n);
        node.setRead(token, 'balanceOf(address)', ({ args }) => {
            const who = String(args[0]).toLowerCase();
            if (who === pair.toLowerCase()) return encodeResult(['uint256'], [reserves.token]);
            if (who === wallet.address.toLowerCase()) return encodeResult(['uint256'], [boughtBy(who)]);
            return encodeResult(['uint256'], [0n]);
        });

        const checkerAbi = checkerInterface();
        const httpGet = (url: string, req: HttpRequestInfo): string | undefined => {
            const params = (req.config as { params?: Record<string, string> } | undefined)?.params;
            return params?.[url];
        };

        if (dex.dexType === 'v2') {
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
            const router = dex.routerAddress;
            node.setRead(router, 'getAmountsOut(uint256,address[])', ({ args }) => {
                const amountIn = args[0] as bigint;
                const p = (args[1] as string[]).map(String);
                if (p.length !== 2) return revertReason('UniswapV2Library: INVALID_PATH');
                const out = quoteOut(amountIn, p[0], p[1]);
                if (out === undefined) return REVERT_EMPTY; // no pair: getReserves on a missing pair reverts
                return encodeResult(['uint256[]'], [[amountIn, out]]);
            });
            node.setRead(router, 'swapExactETHForTokens(uint256,address[],address,uint256)', ({ args, value }) => {
                const p = (args[1] as string[]).map(String);
                if (p[0].toLowerCase() !== weth.toLowerCase()) return revertReason('UniswapV2Router: INVALID_PATH');
                const out = quoteOut(value, p[0], p[1]);
                if (out === undefined) return REVERT_EMPTY;
                if ((args[3] as bigint) < BigInt(Math.floor(Date.now() / 1000))) return revertReason('UniswapV2Router: EXPIRED');
                if (out < (args[0] as bigint)) return revertReason('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
                return encodeResult(['uint256[]'], [[value, out]]);
            });

            // HoneypotChecker: a clean round trip ends in the RoundtripResult custom-error revert
            // with status 0x07 and 0 bps both ways.
            node.setRead(checker, 'checkV2(address,address,uint256)', ({ args }) => {
                if (String(args[1]).toLowerCase() !== token.toLowerCase()) return revertWith(checkerAbi.encodeErrorResult('BuyFailed', ['no liquidity']));
                return revertWith(checkerAbi.encodeErrorResult('RoundtripResult', [0n, 0n, 7]));
            });
        } else {
            const fee = feeTier!;
            const tickSpacing = TICK_SPACING[fee];
            // sqrtPriceX96 = sqrt(token1 / token0) * 2^96, from the virtual reserves.
            const [r0, r1] = token0 === weth ? [reserves.weth, reserves.token] : [reserves.token, reserves.weth];
            const sqrtPriceX96 = isqrt((r1 << 192n) / r0);
            const liquidity = isqrt(r0 * r1);
            node.setRead(pair, 'token0()', encodeResult(['address'], [token0]));
            node.setRead(pair, 'token1()', encodeResult(['address'], [token1]));
            node.setRead(pair, 'fee()', encodeResult(['uint24'], [fee]));
            node.setRead(pair, 'tickSpacing()', encodeResult(['int24'], [tickSpacing]));
            node.setRead(pair, 'liquidity()', encodeResult(['uint128'], [liquidity]));
            node.setRead(pair, 'slot0()', encodeResult(['uint160', 'int24', 'uint16', 'uint16', 'uint16', 'uint8', 'bool'], [sqrtPriceX96, 0, 0, 1, 1, 0, true]));

            // QuoterV2: a real eth_call of quoteExactInputSingle returns its four values.
            node.setRead(dex.quoterAddress, 'quoteExactInputSingle((address,address,uint256,uint24,uint160))', ({ args }) => {
                // Positional: (tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96).
                const [tokenIn, tokenOut, amountIn, qFee] = args[0] as unknown as [string, string, bigint, bigint, bigint];
                if (Number(qFee) !== fee) return REVERT_EMPTY; // no pool at that fee: the quoter's callback target has no code
                const out = quoteOut(amountIn, String(tokenIn), String(tokenOut));
                if (out === undefined) return REVERT_EMPTY;
                return encodeResult(['uint256', 'uint160', 'uint32', 'uint256'], [out, sqrtPriceX96, 1, 80_000n]);
            });
            // SwapRouter02: multicall(deadline, [exactInputSingle]) as the bot builds its buy.
            const exactIn = (data: string, value: bigint): { out?: bigint; revert?: ReturnType<typeof revertReason> } => {
                const call = UNISWAP_V3_SWAP_ROUTER_02.parseTransaction({ data, value });
                if (!call || call.name !== 'exactInputSingle') return { revert: REVERT_EMPTY };
                const p = call.args[0] as unknown as { tokenIn: string; tokenOut: string; fee: bigint; amountIn: bigint; amountOutMinimum: bigint };
                if (Number(p.fee) !== fee) return { revert: REVERT_EMPTY };
                if (p.tokenIn.toLowerCase() === weth.toLowerCase() && value !== p.amountIn) return { revert: revertReason('STF') };
                const out = quoteOut(p.amountIn, p.tokenIn, p.tokenOut);
                if (out === undefined) return { revert: REVERT_EMPTY };
                if (out < p.amountOutMinimum) return { revert: revertReason('Too little received') };
                return { out };
            };
            node.setRead(swapTarget, 'multicall(uint256,bytes[])', ({ args, value }) => {
                if ((args[0] as bigint) < BigInt(Math.floor(Date.now() / 1000))) return revertReason('Transaction too old');
                const results: string[] = [];
                for (const inner of args[1] as string[]) {
                    const r = exactIn(inner, value);
                    if (r.revert) return r.revert;
                    results.push(encodeResult(['uint256'], [r.out!]));
                }
                return encodeResult(['bytes[]'], [results]);
            });
            node.setRead(swapTarget, 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))', ({ data, value }) => {
                const r = exactIn(data, value);
                return r.revert ?? encodeResult(['uint256'], [r.out!]);
            });

            // HoneypotChecker V3: a clean round trip ends in RoundtripResultV3 with status 0x07.
            node.setRead(checker, 'checkV3(address,address,address,uint256,uint24)', ({ args }) => {
                if (String(args[2]).toLowerCase() !== token.toLowerCase() || Number(args[4]) !== fee) return revertWith(checkerAbi.encodeErrorResult('QuoteFailed', ['no pool']));
                return revertWith(checkerAbi.encodeErrorResult('RoundtripResultV3', [0n, 0n, 7]));
            });
        }

        // Safety APIs, routed by URL (Pitfall 10), only those this chain's template names.
        const lockUntil = (): number => Math.floor(Date.now() / 1000) + 30 * 86_400;
        const lockers = new Set([chain.safetyApis.liquidityLock, chain.safetyApis.tokenSecurity, chain.safetyApis.honeypot]);
        if (lockers.has('unicrypt')) {
            routeHttp('https://api.unicrypt.network/api/v2/locker/pair/', (req) => {
                if (!req.url.toLowerCase().startsWith(`https://api.unicrypt.network/api/v2/locker/pair/${pair.toLowerCase()}?`)) return { status: 404, data: { message: 'not found' } };
                return { data: { locks: [{ unlock_date: lockUntil(), amount: lpSupply.toString() }] } };
            });
        }
        if (lockers.has('mudra')) {
            routeHttp('https://api.mudra.website/api/v1/locker/pair/', (req) => {
                if (req.url.toLowerCase() !== `https://api.mudra.website/api/v1/locker/pair/${pair.toLowerCase()}`) return { status: 404, data: { message: 'not found' } };
                return { data: { data: { locks: [{ unlockDate: lockUntil(), amount: lpSupply.toString() }] } } };
            });
        }
        if (lockers.has('goplus')) {
            // GoPlus token_security answers per queried address. For the token it reports the
            // LP holders of the token's pair, with the locker. For an address that is not a token
            // traded on a DEX (an LP pair queried as a token) "is_in_dex" is "0" and lp_holders
            // is not returned (docs.gopluslabs.io response details: "When is_in_dex: 0, there
            // will be no return") - the answer behind AUD-BUY-016.
            routeHttp(`https://api.gopluslabs.io/api/v1/token_security/${chainId}`, (req) => {
                if (req.url !== `https://api.gopluslabs.io/api/v1/token_security/${chainId}`) return { status: 404, data: { message: 'not found' } };
                const asked = String(httpGet('contract_addresses', req) ?? '').toLowerCase();
                const base = { is_honeypot: '0', buy_tax: '0', sell_tax: '0', is_open_source: '1', is_proxy: '0', is_mintable: '0', owner_address: '', total_supply: '' };
                if (asked === token.toLowerCase()) {
                    const lpHolder = { address: labelAddress(`${chainName}.lp-locker`).toLowerCase(), tag: 'locker', is_contract: 1, balance: (lpSupply / 10n ** 18n).toString(), percent: '0.95', is_locked: 1, locked_detail: [{ amount: (lpSupply / 10n ** 18n).toString(), end_time: String(lockUntil()), opt_time: String(Math.floor(Date.now() / 1000)) }] };
                    return { data: { code: 1, message: 'OK', result: { [asked]: { ...base, token_name: 'Realpath Launch Token', token_symbol: 'RPLT', total_supply: (tokenSupply / 10n ** 18n).toString(), is_in_dex: '1', lp_holder_count: '1', lp_total_supply: (lpSupply / 10n ** 18n).toString(), lp_holders: [lpHolder], dex: [{ liquidity_type: dex.dexType === 'v2' ? 'UniV2' : 'UniV3', name: dex.name, pair: pair.toLowerCase() }] } } } };
                }
                if (asked === pair.toLowerCase()) {
                    return { data: { code: 1, message: 'OK', result: { [asked]: { ...base, token_name: 'Uniswap V2', token_symbol: 'UNI-V2', total_supply: (lpSupply / 10n ** 18n).toString(), is_in_dex: '0', dex: [] } } } };
                }
                return { data: { code: 1, message: 'OK', result: {} } };
            });
        }

        // MEV routes. Flashbots is served by the node's relay endpoint (above); bloXroute is an
        // axios JSON-RPC call (bsc_private_tx) that the node records as a relay acceptance.
        if (chain.mevStrategy === 'bloxroute') {
            const endpoint = chain.mevConfig.endpoint;
            routeHttp(endpoint, (req) => {
                const body = (req.data ?? {}) as { id?: unknown; method?: string; params?: { transaction?: string } };
                const headers = ((req.config as { headers?: Record<string, string> } | undefined)?.headers ?? {}) as Record<string, string>;
                const id = body.id ?? null;
                // The relay body, on arrival (D-13), before anything is decided about it.
                harnessState().timeline?.record({ kind: 'relay', relay: 'bloxroute', url: req.url, method: String(body.method), params: body.params });
                if (req.method !== 'post' || req.url.replace(/\/$/, '') !== endpoint.replace(/\/$/, '')) return { status: 404, data: { message: 'not found' } };
                if (!headers.Authorization || headers.Authorization !== process.env.BLOXROUTE_AUTH_HEADER) {
                    return { status: 401, data: { jsonrpc: '2.0', id, error: { code: 401, message: 'Unauthorized', data: 'account must have a valid Authorization header' } } };
                }
                if (body.method === 'ping') return { data: { jsonrpc: '2.0', id, result: { pong: new Date(Date.now()).toISOString() } } };
                if (body.method === 'bsc_private_tx') {
                    const raw = body.params?.transaction;
                    if (typeof raw !== 'string') return { data: { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params', data: 'transaction is required' } } };
                    // bloXroute answers with the hash, hex without the 0x prefix.
                    const hash = node.acceptRelayTransaction(raw.startsWith('0x') ? raw : `0x${raw}`, 'bloxroute');
                    return { data: { jsonrpc: '2.0', id, result: { txHash: hash.slice(2) } } };
                }
                node.strays.push({ seq: nextSeq(), kind: 'url', url: req.url, detail: `unknown bloXroute method ${String(body.method)} at ${req.url}` });
                return { data: { jsonrpc: '2.0', id, error: { code: -32601, message: 'Invalid method', data: String(body.method) } } };
            });
        }

        const deployer = new Wallet(ethers.id(`realpath.deployer.${chainName}`));
        node.setBalance(deployer.address, reserves.weth * 4n);
        const deadline = (): number => Math.floor(Date.now() / 1000) + 600;
        const signLaunch = (to: string, data: string, value: bigint, gasLimit: bigint): Promise<string> => {
            const nonce = node.minedCount(deployer.address);
            const base = { chainId, nonce, to, value, gasLimit, data };
            if (profile.baseFeePerGas === 0n) return deployer.signTransaction({ ...base, type: 0, gasPrice: 3n * 1_000_000_000n });
            return deployer.signTransaction({ ...base, type: 2, maxFeePerGas: profile.baseFeePerGas * 4n + 2n * 1_000_000_000n, maxPriorityFeePerGas: profile.priorityFeePerGas });
        };
        let fired = false;
        const once = (what: string): void => {
            if (fired) throw new Error(`${what}: this scenario already launched`);
            fired = true;
        };
        const fireNewPair = async (): Promise<{ block: number; log: FakeLog }> => {
            if (dex.dexType !== 'v2') throw new Error('fireNewPair: this is a V3 scenario (use fireNewPool)');
            once('fireNewPair');
            const data = UNISWAP_V2_ROUTER.encodeFunctionData('addLiquidityETH', [token, reserves.token, reserves.token, reserves.weth, deployer.address, deadline()]);
            const hash = node.addForeignTransaction(await signLaunch(dex.routerAddress, data, reserves.weth, 4_000_000n));
            const encoded = UNISWAP_V2_FACTORY.encodeEventLog('PairCreated', [token0, token1, pair, 1n]);
            const block = node.mine({ include: [hash], logs: [{ address: dex.factoryAddress, topics: encoded.topics, data: encoded.data, transactionHash: hash }] });
            const log = node.logs.find((l) => l.transactionHash === hash && l.address === dex.factoryAddress.toLowerCase())!;
            return { block, log };
        };
        const fireNewPool = async (): Promise<{ block: number; poolCreated: FakeLog; mint: FakeLog }> => {
            if (dex.dexType !== 'v3') throw new Error('fireNewPool: this is a V2 scenario (use fireNewPair)');
            once('fireNewPool');
            const fee = feeTier!;
            const tickSpacing = TICK_SPACING[fee];
            const tickBound = Math.floor(887272 / tickSpacing) * tickSpacing;
            const [r0, r1] = token0 === weth ? [reserves.weth, reserves.token] : [reserves.token, reserves.weth];
            const sqrtPriceX96 = isqrt((r1 << 192n) / r0);
            const liquidity = isqrt(r0 * r1);
            const npm = V3_POSITION_MANAGER[`${chainName}/${dex.name}`] ?? labelAddress(`${chainName}.${dex.name}.position-manager`);
            // The real launch shape: one NonfungiblePositionManager multicall that creates and
            // initializes the pool and mints the first full-range position.
            const data = UNISWAP_V3_NPM.encodeFunctionData('multicall', [
                [
                    UNISWAP_V3_NPM.encodeFunctionData('createAndInitializePoolIfNecessary', [token0, token1, fee, sqrtPriceX96]),
                    UNISWAP_V3_NPM.encodeFunctionData('mint', [[token0, token1, fee, -tickBound, tickBound, r0, r1, 0n, 0n, deployer.address, deadline()]]),
                ],
            ]);
            const hash = node.addForeignTransaction(await signLaunch(npm, data, reserves.weth, 6_000_000n));
            const created = UNISWAP_V3_FACTORY.encodeEventLog('PoolCreated', [token0, token1, fee, tickSpacing, pair]);
            const minted = UNISWAP_V3_POOL.encodeEventLog('Mint', [npm, npm, -tickBound, tickBound, liquidity, r0, r1]);
            const block = node.mine({
                include: [hash],
                logs: [
                    { address: dex.factoryAddress, topics: created.topics, data: created.data, transactionHash: hash },
                    { address: pair, topics: minted.topics, data: minted.data, transactionHash: hash },
                ],
            });
            const [poolCreated, mint] = node.logs.filter((l) => l.transactionHash === hash);
            return { block, poolCreated, mint };
        };

        const scenario: Scenario<D> = { node, graph, registry, ctx, chain: chainName, dex: dex as ScenarioDex<D>, token, pair, feeTier, checker, wallet, weth, reserves, timeline, fireNewPair, fireNewPool, dispose };
        SCENARIO_INTERNALS.set(scenario, { built, db: dbOpt, chainName, dexName: dex.name, isDisposed: () => disposed });
        return scenario;
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

export interface RestartOptions {
    /** Env values applied before the new graph loads (undefined deletes); dispose restores them. */
    env?: Record<string, string | undefined>;
}

/**
 * Restart the scenario's bot on the same database file and the same simulated chain, as a
 * process restart would. The running graph is fenced first (WR-06): its database is closed and,
 * until it has stopped, every logger, notifier and broadcaster call is dropped, because a killed
 * process writes, logs and alerts nothing. Then it is stopped by the same steps dispose uses (held
 * calls answered with an error, the bot's timer registry cleared, every fake timer cleared,
 * providers destroyed), any socket of the old graph still open is closed, and timers a catch path
 * set while it stopped are cleared, because a dead process's timers and sockets die with it.
 * The fence holds only while the graph stops: once the new graph loads, a call cannot be told
 * apart by graph, so old-graph code still running then would record again (nothing of it is
 * left to run: its timers are gone, its providers destroyed, its sockets closed). The file, the FakeNode, the clock, the env snapshot
 * and the scenario's alerts, logs and timeline stay: a restart is the same scenario continuing,
 * and a test reads what happened on both sides of it. Then `env` is applied and loadGraph opens
 * the whole graph again on the file, which reinstalls the DB capture and the SQL clock on the new
 * connection (RESEARCH Pitfall 5). scenario.graph, registry, ctx, dex and wallet point at the new
 * graph afterwards. Nothing is restarted: the test calls the real resume paths itself.
 */
export async function restartGraph<D extends ScenarioDexType>(scenario: Scenario<D>, opts: RestartOptions = {}): Promise<Scenario<D>> {
    const internals = SCENARIO_INTERNALS.get(scenario);
    if (!internals) throw new Error('restartGraph: this object was not made by createScenario');
    if (internals.isDisposed()) throw new Error('restartGraph: the scenario was already disposed');
    if (internals.db === 'memory') {
        throw new Error('restartGraph: this scenario runs on an in-memory database, which no restart can keep; create it with db: { file: createTempDbFile() }');
    }
    const { built } = internals;
    const st = harnessState();
    const oldSockets = [...FakeWebSocket.instances];

    const errors: unknown[] = [];
    const step = async (what: string, fn: () => unknown): Promise<void> => {
        try {
            await fn();
        } catch (e) {
            errors.push(new Error(`restartGraph: ${what} failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e }));
        }
    };
    // Fence the old graph before anything of it can run again (WR-06). Releasing a held call or
    // destroying a provider resumes the old graph's awaits, and a killed process runs no catch
    // path. Until the stop ends, nothing but the old graph runs (the test is awaiting this call
    // and no new graph exists), so every logger, notifier and broadcaster call is the old graph's
    // and is dropped; and its database closes first, so a write from such a catch path throws
    // into that catch instead of landing. dispose keeps the original order, where the answer
    // reaching its caller is the point.
    st.stoppingGraph = true;
    try {
        await step('fence the old graph database', () => {
            closeGraphDb(built.graph ?? null);
            if (built.graph && currentGraph === built.graph) currentGraph = null;
        });
        await stopGraphParts(built, step);
        await step('drop the old graph Telegram client', () => {
            // The old process's Telegram client and its handlers die with it; a delivery after the
            // restart reaches only a handler the new graph registers.
            st.telegram.handlers.length = 0;
            st.telegram.clients.length = 0;
        });
        await step('close the old graph sockets', () => {
            for (const ws of oldSockets) if (ws.readyState !== FakeWebSocket.CLOSED) ws.terminate();
            FakeWebSocket.instances.splice(0, FakeWebSocket.instances.length, ...FakeWebSocket.instances.filter((w) => !oldSockets.includes(w)));
        });
        // A catch path that ran while the graph stopped may have set a timer (a retry); it dies
        // with the process too.
        await step('clear timers set while stopping', () => {
            built.graph?.exitManager.clearAllTimers();
            if (vi.isFakeTimers()) vi.clearAllTimers();
        });
    } finally {
        st.stoppingGraph = false;
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `restartGraph: ${errors.length} stop steps failed`);
    built.graph = undefined;
    built.ctx = undefined;

    for (const [k, v] of Object.entries(opts.env ?? {})) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    // The node is the one every transport routes to again (a test may have pointed elsewhere).
    if (built.node) st.node = built.node;
    const graph = await loadGraph({ db: internals.db });
    built.graph = graph;
    const registry = graph.chainRegistry.buildChainRegistry();
    const chain = registry.get(internals.chainName);
    if (!chain || !chain.enabled) throw new Error(`restartGraph: the ${internals.chainName} chain is not enabled after the restart`);
    if (built.node && chain.chainId !== built.node.chainId) throw new Error(`restartGraph: the ${internals.chainName} template is chain ${chain.chainId}, the scenario node is ${built.node.chainId}`);
    if (chain.honeypotChecker.deployedAddress?.toLowerCase() !== scenario.checker.toLowerCase()) {
        throw new Error(`restartGraph: the checker address changed across the restart (${chain.honeypotChecker.deployedAddress} vs ${scenario.checker})`);
    }
    const dex = chain.dexes.find((d) => d.name === internals.dexName);
    if (!dex) throw new Error(`restartGraph: ${internals.chainName} has no DEX named ${internals.dexName} after the restart`);
    const ctx = graph.chainRegistry.createChainContext(chain);
    built.ctx = ctx;
    if (ctx.wallet.address.toLowerCase() !== scenario.wallet.address.toLowerCase()) throw new Error('restartGraph: the bot wallet changed across the restart');
    scenario.graph = graph;
    scenario.registry = registry;
    scenario.ctx = ctx;
    scenario.dex = dex as ScenarioDex<D>;
    scenario.wallet = ctx.wallet;
    return scenario;
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
