// test/realpath/env/envMatrix.test.ts
// Phase 23 plan 23-23 (CHAR-03, AC-27, AC-28, AC-29, AC-51; D-16, D-17, D-18; SPEC Amendments A-1,
// A-2): how the bot's settings parse, for unset, '', '0', 'abc' and a valid value of every variable
// the three settings modules read: the config module (exports CONFIG), the chain registry (exports
// buildChainRegistry) and the risk gate (exports canSnipe; Amendment A-1, the five risk limits that
// Phase 24's CAP-06 changes). src/ is not changed.
//
// The modules are found by the symbols they export in a directory walk of src/
// (test/helpers/sourceGraph.ts), never by a file name (the AC-37 gate, test/unit/sourceTextGate.test.ts).
//
// One case = one module load (RESEARCH Pattern 7): vi.resetModules(), the env applied, a
// process.exit spy installed for this case only (mockReset strips a longer-lived one, RESEARCH
// E6c), then each module evaluated in its own try, in the order config, registry, risk. The risk
// gate imports neither of the others, so a config exit does not hide what it parses. The chain
// registry imports the config module (through the provider module), so a config exit also ends the
// registry's load; that registry result carries from: 'config' (the same exit, raised again by the
// import, with no log of its own). Each module's result is { kind: 'ok', value, logs },
// { kind: 'exit', code, logs, from? } or { kind: 'threw', error, logs, from? } (AC-28: a value that
// makes parsing exit or throw is recorded as the result, never a test failure). `logs` are the warn,
// error and fatal logger calls the module made while loading (the realpath harness logger,
// test/realpath/harness/setup.ts), so an exit records its fatal reason. The risk gate's
// settings are private (riskConfig), so its value is five probes through the real exported canSnipe,
// one per setting, each on a database state (real insertTrade rows on the case's :memory: database,
// or the real recordSnipe) that trips only that setting's rule: canSnipe stops at the first failing
// rule, and a value that parses to NaN shows as a rule that does not fire. In a finally the case
// restores process.env, its spy and its database connection (closeDb).
//
// Files (test/realpath/recordings/env/, LF, keys sorted by name at every level, AC-29; values
// normalized by the serializer, test/realpath/harness/serializer.ts, so NaN is {"$nonFinite":"NaN"}):
//   _baseline.json  { about, env, outcome }: every listed variable at its valid value, and what the
//                   three modules parse from that (D-16: the one full baseline).
//   <VAR>.json      { cases: { 0, abc, empty, unset, valid }, variable }: each case varies only VAR,
//                   every other variable at its valid value (AC-29), and records its env input and
//                   `changes`, only the fields whose parsed value differs from the live baseline, at
//                   the same path ({"$absent":true} for a field the case removed; an array is written
//                   whole; {} when nothing differs) (D-16). One file per variable (D-17, Amendment A-2):
//                   a new variable adds a file and a changed case is a changed file the commit check
//                   of plan 23-25 judges (D-18).
//
// The variable list is the union of a structural inventory (every process.env.X member access and
// process.env['X'] literal in the three modules, through the TypeScript AST) and a run-time read
// recorder: process.env is replaced, for the case only, by a Proxy with get, has, set and
// deleteProperty traps whose reads count only when the reading stack frame is in one of the three
// modules (library reads such as WS_NO_BUFFER_UTIL are left out; RESEARCH Flag 6). The baseline run
// repeats until a pass with every listed variable valid reads no new name. Every case asserts its
// reads are a subset of the _baseline.json env keys, naming the first extra read, so a name read
// only through a computed key under a varied value cannot surface after that file is committed.
// VITEST is in the list but never varied in this worker (unsetting it would make the config module
// load .env from the repo root); its five values run in railed children (test VITEST below), and
// VITEST.json records, per case, the env input and the child's { dotenvLoaded } instead of `changes`.
//
// The only spy is vi.spyOn(process, 'exit'), the one the AC-02 mock gate permits. Writing happens
// only through npm run recordings:update (the serializer's switch); a normal run compares bytes.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as ts from 'typescript';
import { getAddress } from 'ethers';
import { parse as parseDotenv } from 'dotenv';
import { recordedLogs } from '../harness/capture';
import { RECORDINGS_DIR, compareRecording, normalizeForRecording } from '../harness/serializer';
import { REPO_ROOT, loadRepoModules, moduleExporting } from '../../helpers/sourceGraph';
import { spawnRailedChild } from '../../rails/spawnRailedChild';

const ENV_TEST_FILE = path.join(REPO_ROOT, 'test', '.env.test');
const BASELINE_REL = 'env/_baseline.json';
const BASELINE_FILE = path.join(RECORDINGS_DIR, 'env', '_baseline.json');

// ---------------------------------------------------------------------------------------------
// Valid values
// ---------------------------------------------------------------------------------------------

/** An inert, test-chosen address (no key, no deployed contract). */
const testAddress = (n: number): string => getAddress(`0x${n.toString(16).padStart(40, '0')}`);

/**
 * Valid values this test chooses: the variables test/.env.test leaves empty or absent, and
 * ENABLED_CHAINS, which the baseline needs with all four chains (RESEARCH Flag 6). Every other
 * listed variable takes its test/.env.test value. All are inert (AC-51).
 */
const VALID_VALUES: Readonly<Record<string, string>> = {
    ENABLED_CHAINS: 'eth,bsc,base,arb',
    // The process's own value under Vitest; never varied here (see the header).
    VITEST: 'true',
    // Absent from test/.env.test; values differ from the template defaults so `unset` shows them.
    ETH_MIN_LIQUIDITY: '0.75',
    BSC_MIN_LIQUIDITY: '1.5',
    BASE_MIN_LIQUIDITY: '0.2',
    ARB_MIN_LIQUIDITY: '0.2',
    // Empty in test/.env.test: an enabled bsc, base or arb exits without one (RESEARCH Flag 6).
    ETH_HONEYPOT_CHECKER_ADDRESS: testAddress(0xe1),
    BSC_HONEYPOT_CHECKER_ADDRESS: testAddress(0xb1),
    BASE_HONEYPOT_CHECKER_ADDRESS: testAddress(0xba),
    ARB_HONEYPOT_CHECKER_ADDRESS: testAddress(0xa1),
    // Empty in test/.env.test: one operator-overlay locker address each.
    ETH_ANTIRUG_ALLOWLIST_EXTRA: testAddress(0xe10),
    ETH_ANTIRUG_ALLOWLIST_EXTRA_V2: testAddress(0xe12),
    ETH_ANTIRUG_ALLOWLIST_EXTRA_V3: testAddress(0xe13),
    BSC_ANTIRUG_ALLOWLIST_EXTRA: testAddress(0xb10),
    BSC_ANTIRUG_ALLOWLIST_EXTRA_V2: testAddress(0xb12),
    BSC_ANTIRUG_ALLOWLIST_EXTRA_V3: testAddress(0xb13),
    BASE_ANTIRUG_ALLOWLIST_EXTRA: testAddress(0xba0),
    BASE_ANTIRUG_ALLOWLIST_EXTRA_V2: testAddress(0xba2),
    BASE_ANTIRUG_ALLOWLIST_EXTRA_V3: testAddress(0xba3),
    ARB_ANTIRUG_ALLOWLIST_EXTRA: testAddress(0xa10),
    ARB_ANTIRUG_ALLOWLIST_EXTRA_V2: testAddress(0xa12),
    ARB_ANTIRUG_ALLOWLIST_EXTRA_V3: testAddress(0xa13),
    // Empty in test/.env.test (no cap): the position-size probe needs a cap below its 0.5 amount.
    MAX_POSITION_SIZE: '0.1',
    PARTIAL_SELL_TARGETS: '2x:50,5x:25',
};

const ENV_TEST: Readonly<Record<string, string>> = parseDotenv(fs.readFileSync(ENV_TEST_FILE, 'utf8'));

/** The valid value of one listed variable; throws naming a variable that has none. */
function validValue(name: string): string {
    const v = VALID_VALUES[name] ?? ENV_TEST[name];
    if (v === undefined || v === '') throw new Error(`no valid value for ${name}: test/.env.test leaves it empty or absent; add it to VALID_VALUES`);
    return v;
}

// ---------------------------------------------------------------------------------------------
// The three modules, by the symbols they export, and their structural inventory
// ---------------------------------------------------------------------------------------------

type ModuleLabel = 'config' | 'registry' | 'risk';

interface Discovered {
    /** Repo-relative path per label. */
    files: Record<ModuleLabel, string>;
    /** Comparable absolute form (forward slashes; lower case on Windows) -> label. */
    byPath: Map<string, ModuleLabel>;
    /** Every process.env.X / process.env['X'] literal name per label. */
    astNames: Record<ModuleLabel, Set<string>>;
}

const comparable = (p: string): string => {
    const s = p.replace(/^file:\/\/\/?/i, '').replace(/\\/g, '/');
    return process.platform === 'win32' ? s.toLowerCase() : s;
};

function isProcessEnv(e: ts.Expression): boolean {
    return ts.isPropertyAccessExpression(e) && e.name.text === 'env' && ts.isIdentifier(e.expression) && e.expression.text === 'process';
}

/** Every process.env.X member access and process.env['X'] literal in one source file. */
function envNamesIn(sf: ts.SourceFile): Set<string> {
    const out = new Set<string>();
    const visit = (n: ts.Node): void => {
        if (ts.isPropertyAccessExpression(n) && isProcessEnv(n.expression)) out.add(n.name.text);
        if (ts.isElementAccessExpression(n) && isProcessEnv(n.expression) && ts.isStringLiteralLike(n.argumentExpression)) out.add(n.argumentExpression.text);
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

function discover(): Discovered {
    const mods = loadRepoModules(['src']);
    const found: Record<ModuleLabel, ReturnType<typeof moduleExporting>> = {
        config: moduleExporting(mods, 'CONFIG'),
        registry: moduleExporting(mods, 'buildChainRegistry'),
        risk: moduleExporting(mods, 'canSnipe'),
    };
    const files = { config: found.config.file, registry: found.registry.file, risk: found.risk.file };
    const byPath = new Map<string, ModuleLabel>();
    for (const label of Object.keys(files) as ModuleLabel[]) byPath.set(comparable(path.join(REPO_ROOT, files[label])), label);
    if (byPath.size !== 3) throw new Error(`the three settings modules are not three distinct files: ${JSON.stringify(files)}`);
    return {
        files,
        byPath,
        astNames: { config: envNamesIn(found.config.sf), registry: envNamesIn(found.registry.sf), risk: envNamesIn(found.risk.sf) },
    };
}

// ---------------------------------------------------------------------------------------------
// The process.env read recorder
// ---------------------------------------------------------------------------------------------

/** Variable name -> the modules that read it. */
type Reads = Map<string, Set<ModuleLabel>>;

const FRAME_FILE = /((?:[A-Za-z]:)?[^\s():]+\.(?:ts|mts|cts|js|mjs|cjs)):\d+:\d+\)?\s*$/;

/** The label of the module whose code made the access (the first frame above `trap`), or null. */
function readerOf(trap: (...args: never[]) => unknown, byPath: Map<string, ModuleLabel>): ModuleLabel | null {
    const holder: { stack?: string } = {};
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    try {
        Error.captureStackTrace(holder, trap);
    } finally {
        Error.stackTraceLimit = limit;
    }
    const first = (holder.stack ?? '').split('\n')[1] ?? '';
    const m = first.match(FRAME_FILE);
    return m ? (byPath.get(comparable(m[1])) ?? null) : null;
}

/**
 * Replace process.env by a recording Proxy until restore(). Reads go to the real object, writes and
 * deletes too (the traps are required: without them assignment fails with
 * ERR_INVALID_OBJECT_DEFINE_PROPERTY, RESEARCH Flag 6), so the rails and every library see the same
 * values as before; only reads from the three modules are counted.
 */
function installRecorder(byPath: Map<string, ModuleLabel>): { reads: Reads; restore(): void } {
    const original = process.env;
    const reads: Reads = new Map();
    const note = (key: string | symbol, trap: (...args: never[]) => unknown): void => {
        if (typeof key !== 'string') return;
        const label = readerOf(trap, byPath);
        if (label === null) return;
        const set = reads.get(key) ?? new Set<ModuleLabel>();
        set.add(label);
        reads.set(key, set);
    };
    const handler: ProxyHandler<NodeJS.ProcessEnv> = {
        get(target, key) {
            note(key, handler.get as never);
            return Reflect.get(target, key);
        },
        has(target, key) {
            note(key, handler.has as never);
            return Reflect.has(target, key);
        },
        set(target, key, value) {
            if (typeof key === 'string') target[key] = value as string;
            return true;
        },
        deleteProperty(target, key) {
            if (typeof key === 'string') delete target[key];
            return true;
        },
    };
    process.env = new Proxy(original, handler);
    return {
        reads,
        restore(): void {
            process.env = original;
        },
    };
}

// ---------------------------------------------------------------------------------------------
// One case
// ---------------------------------------------------------------------------------------------

class ExitCalled extends Error {
    constructor(readonly code: unknown) {
        super(`process.exit(${String(code)})`);
    }
}

interface LogLine {
    level: string;
    msg: string | undefined;
    fields: Record<string, unknown> | undefined;
    bindings: Record<string, unknown>;
}

type ModuleOutcome =
    | { kind: 'ok'; value: unknown; logs: LogLine[] }
    | { kind: 'exit'; code: unknown; logs: LogLine[]; from?: ModuleLabel }
    | { kind: 'threw'; error: unknown; logs: LogLine[]; from?: ModuleLabel };

type CaseOutcome = Record<ModuleLabel, ModuleOutcome>;

/** The levels a snapshot keeps: why a module exited or warned, not its progress lines (D-16). */
const LOGGED_LEVELS: ReadonlySet<string> = new Set(['warn', 'error', 'fatal']);

/**
 * Evaluate one module, turning an exit or a throw into data (AC-28). `load` parses (its warn, error
 * and fatal logs are kept); `observe`, when given, reads the loaded module afterwards (the risk
 * probes, whose own "Risk check failed" lines repeat the probe results and are not kept).
 * `raised` holds the errors earlier modules of the same case ended with: the same error object
 * caught again means an import raised that module's failure again, recorded as `from`.
 */
async function evaluateModule<T>(label: ModuleLabel, raised: Map<unknown, ModuleLabel>, load: () => Promise<T>, observe?: (loaded: T) => unknown): Promise<ModuleOutcome> {
    const start = recordedLogs().length;
    let end: number | null = null;
    const logs = (): LogLine[] =>
        recordedLogs()
            .slice(start, end ?? undefined)
            .filter((l) => LOGGED_LEVELS.has(l.level))
            .map((l) => ({ level: l.level, msg: l.msg, fields: l.obj, bindings: l.bindings }));
    try {
        const loaded = await load();
        end = recordedLogs().length;
        const value = observe ? observe(loaded) : loaded;
        return { kind: 'ok', value, logs: logs() };
    } catch (e) {
        const from = raised.get(e);
        if (from === undefined) raised.set(e, label);
        const via = from === undefined ? {} : { from };
        if (e instanceof ExitCalled) return { kind: 'exit', code: e.code, logs: logs(), ...via };
        return { kind: 'threw', error: e, logs: logs(), ...via };
    }
}

type RiskModule = typeof import('../../../src/riskManager');
type DbModule = typeof import('../../../src/utils/db');

interface Probe {
    allowed: boolean;
    reason?: string;
    details?: string;
}

/**
 * The five risk settings through the real canSnipe, one state per setting that trips only that
 * setting's rule while the other four stay clear (valid values: MAX_POSITION_SIZE 0.1,
 * DAILY_LOSS_PCT 10, MAX_OPEN_POSITIONS 10, SNIPE_COOLDOWN_MS 30000, MAX_TOTAL_EXPOSURE 10.0).
 * Each probe uses its own chain name (the loss and cooldown rules are per chain) and starts from an
 * empty trades table (the position and exposure rules are global).
 */
function riskProbes(risk: RiskModule, dbm: DbModule): Record<string, Probe> {
    const now = Math.floor(Date.now() / 1000);
    let n = 0;
    const insert = (chain: string, action: 'buy' | 'sell', status: 'pending' | 'sold', amountIn: string | null, amountOut: string | null, token?: string): string => {
        n += 1;
        const t = token ?? testAddress(0x7000 + n).toLowerCase();
        dbm.insertTrade.run({
            token: t, chain, action, txHash: null, block: null, timestamp: now, amountIn, amountOut, gasCost: null, priceAtAction: null,
            status, poolType: 'v2', feeTier: null, dexName: 'uniswap-v2',
        });
        return t;
    };
    const clear = (): void => {
        dbm.db.prepare('DELETE FROM trades').run();
    };
    const probe = (chain: string, amount: string, maxCapital: string): Probe => {
        const r = risk.canSnipe(chain, amount, maxCapital);
        return { allowed: r.allowed, reason: r.reason, details: r.details };
    };
    const out: Record<string, Probe> = {};
    // MAX_POSITION_SIZE: 0.5 is above the valid cap of 0.1; the database is empty.
    clear();
    out.MAX_POSITION_SIZE = probe('probe-position-size', '0.5', '1.0');
    // DAILY_LOSS_PCT: a buy of 1.0 sold for 0.5 today, a 0.5 loss on a capital of 1.0 (10 percent is 0.1).
    clear();
    const lossToken = insert('probe-daily-loss', 'buy', 'sold', '1.0', null);
    insert('probe-daily-loss', 'sell', 'sold', null, '0.5', lossToken);
    out.DAILY_LOSS_PCT = probe('probe-daily-loss', '0.01', '1.0');
    // MAX_OPEN_POSITIONS: ten pending buys of 0.01 (the valid limit is 10; exposure 0.1 stays far below 10).
    clear();
    for (let i = 0; i < 10; i++) insert('probe-open-positions', 'buy', 'pending', '0.01', null);
    out.MAX_OPEN_POSITIONS = probe('probe-open-positions-next', '0.01', '1.0');
    // SNIPE_COOLDOWN_MS: the real recordSnipe, then a probe inside the window; the database is empty.
    clear();
    risk.recordSnipe('probe-cooldown');
    out.SNIPE_COOLDOWN_MS = probe('probe-cooldown', '0.01', '1.0');
    // MAX_TOTAL_EXPOSURE: one pending buy of 9.995, so 0.01 more crosses the valid cap of 10.
    clear();
    insert('probe-exposure', 'buy', 'pending', '9.995', null);
    out.MAX_TOTAL_EXPOSURE = probe('probe-exposure-next', '0.01', '1.0');
    clear();
    return out;
}

/** The value of `env` for one case: every listed variable valid, then the case's own change. */
type EnvCase = { name: string; value: string | undefined } | null;

async function evaluateCase(list: readonly string[], change: EnvCase, found: Discovered): Promise<{ outcome: CaseOutcome; reads: Reads }> {
    if (change !== null && change.name === 'VITEST') throw new Error('VITEST is never varied in the worker (see the header)');
    vi.resetModules();
    const touched = [...new Set([...list.filter((k) => k !== 'VITEST'), 'DB_PATH'])];
    const saved = new Map<string, string | undefined>(touched.map((k) => [k, process.env[k]]));
    let exitSpy: { mockRestore(): void } | null = null;
    let recorder: { reads: Reads; restore(): void } | null = null;
    let dbm: DbModule | null = null;
    try {
        for (const k of list) if (k !== 'VITEST') process.env[k] = validValue(k);
        // db.ts's own path variable (not one of the three modules'): the case's database is :memory:.
        process.env.DB_PATH = ':memory:';
        if (change !== null) {
            if (change.value === undefined) delete process.env[change.name];
            else process.env[change.name] = change.value;
        }
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: unknown) => {
            throw new ExitCalled(code);
        }) as never);
        recorder = installRecorder(found.byPath);
        const raised = new Map<unknown, ModuleLabel>();
        const config = await evaluateModule('config', raised, async () => {
            const m = await import('../../../src/config');
            return { CONFIG: m.CONFIG };
        });
        const registry = await evaluateModule('registry', raised, async () => {
            const m = await import('../../../src/chainRegistry');
            return Object.fromEntries(m.buildChainRegistry());
        });
        const risk = await evaluateModule(
            'risk',
            raised,
            async () => {
                const m = await import('../../../src/riskManager');
                const d = await import('../../../src/utils/db');
                dbm = d;
                return { m, d };
            },
            ({ m, d }) => ({ probes: riskProbes(m, d) }),
        );
        return { outcome: { config, registry, risk }, reads: recorder.reads };
    } finally {
        recorder?.restore();
        try {
            (dbm as DbModule | null)?.closeDb();
        } finally {
            exitSpy?.mockRestore();
            for (const [k, v] of saved) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Normalized, sorted documents and the per-case diff
// ---------------------------------------------------------------------------------------------

/** Every object's keys sorted by name, recursively (AC-29); arrays keep their order. */
function sortKeys(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v !== null && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
        return out;
    }
    return v;
}

const doc = (v: unknown): unknown => sortKeys(normalizeForRecording(v));
const fileText = (v: unknown): string => `${JSON.stringify(doc(v), null, 2)}\n`;

const ABSENT = { $absent: true };
const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A serializer marker such as {"$nonFinite":"NaN"}: compared whole, never descended into. */
const isMarker = (v: unknown): boolean => isPlain(v) && Object.keys(v).length === 1 && Object.keys(v)[0].startsWith('$');

/** The fields of `now` that differ from `base`, at the same path; undefined when equal (D-16). */
function diff(base: unknown, now: unknown): unknown {
    if (JSON.stringify(base) === JSON.stringify(now)) return undefined;
    if (isPlain(base) && isPlain(now) && !isMarker(base) && !isMarker(now)) {
        const out: Record<string, unknown> = {};
        for (const k of [...new Set([...Object.keys(base), ...Object.keys(now)])].sort()) {
            if (!(k in now)) out[k] = ABSENT;
            else if (!(k in base)) out[k] = now[k];
            else {
                const d = diff(base[k], now[k]);
                if (d !== undefined) out[k] = d;
            }
        }
        return out;
    }
    return now;
}

/** The five values of AC-27, by case name (sorted by name in the file, AC-29). */
const CASES: ReadonlyArray<{ key: string; value: (name: string) => string | undefined }> = [
    { key: 'unset', value: () => undefined },
    { key: 'empty', value: () => '' },
    { key: '0', value: () => '0' },
    { key: 'abc', value: () => 'abc' },
    { key: 'valid', value: (name) => validValue(name) },
];

/** The env keys of the committed baseline (the list the matrix runs), or [] before it exists. */
function committedList(): string[] {
    if (!fs.existsSync(BASELINE_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as { env?: Record<string, unknown> };
    return Object.keys(parsed.env ?? {});
}

const COMMITTED = committedList();

/**
 * Every listed variable except VITEST, from the committed baseline (one test per variable, so a
 * failure names it). Before the baseline exists there is none; npm run recordings:update writes
 * the baseline first, and a second update run writes the variable files.
 */
const VARIED: readonly string[] = COMMITTED.filter((k) => k !== 'VITEST');

// ---------------------------------------------------------------------------------------------
// VITEST through railed children
// ---------------------------------------------------------------------------------------------

const TS_NODE_BIN = path.join(REPO_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');
const FLAG_CHILD = path.join(REPO_ROOT, 'test', 'realpath', 'env', 'fixtures', 'vitestFlagChild.ts');
const LEDGER_ROOT = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger');
/** The fake .env line the child's temp cwd holds (fixtures/vitestFlagChild.ts compares the same value). */
const FAKE_ENV_LINE = 'FAKE_ENV_PROBE_KEY=from-fake-env-file\n';
const CHILD_TIMEOUT_MS = 110_000;
/** The five values, by the case names the child takes (fixtures/vitestFlagChild.ts FLAG_CASES). */
const FLAG_CASES: ReadonlyArray<{ key: string; value: string | undefined }> = [
    { key: 'unset', value: undefined },
    { key: 'empty', value: '' },
    { key: '0', value: '0' },
    { key: 'abc', value: 'abc' },
    { key: 'valid', value: 'true' },
];

interface LedgerEntry {
    kind: string;
    target?: unknown;
}

/** Every rail ledger line the child's own case folder holds, then the folder removed. */
function takeCaseLedger(runId: string): LedgerEntry[] {
    const dir = path.join(LEDGER_ROOT, runId);
    const entries: LedgerEntry[] = [];
    try {
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.jsonl')) continue;
            for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) if (line.trim() !== '') entries.push(JSON.parse(line) as LedgerEntry);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    return entries;
}

const lastLine = (s: string): string => s.trim().split(/\r?\n/).pop() ?? '';

// ---------------------------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------------------------

interface Baseline {
    found: Discovered;
    list: string[];
    reads: Reads;
    outcome: unknown;
}

let baseline: Baseline | null = null;

/**
 * The list and the baseline: start from the AST inventory, run the baseline with every listed
 * variable valid, add every name the run read, and repeat until a run reads no new name.
 */
async function buildBaseline(): Promise<Baseline> {
    const found = discover();
    const names = new Set<string>([...found.astNames.config, ...found.astNames.registry, ...found.astNames.risk]);
    for (let round = 0; round < 10; round++) {
        const list = [...names].sort();
        const { outcome, reads } = await evaluateCase(list, null, found);
        const before = names.size;
        for (const k of reads.keys()) names.add(k);
        if (names.size === before) return { found, list, reads, outcome: doc(outcome) };
    }
    throw new Error('the baseline read list did not settle within 10 rounds');
}

describe('env matrix (CHAR-03: AC-27, AC-28, AC-29, Amendment A-1)', () => {
    // Measured 2026-11-12 (Node 22.16.0): the src/ walk plus the settled baseline took 1.1 s alone
    // and 2.3 s under the full parallel run, 23 percent of the default 10 s hook limit; 60 s leaves
    // room for a slower machine.
    beforeAll(async () => {
        baseline = await buildBaseline();
    }, 60_000);

    it('the variable list is the AST inventory plus every read the recorder saw, and _baseline.json records it', () => {
        const b = baseline as Baseline;
        // AC-27 coverage: each of the three modules read variables on the baseline run, and every
        // literal name the AST found is in the list.
        for (const label of ['config', 'registry', 'risk'] as ModuleLabel[]) {
            const readBy = [...b.reads].filter(([, by]) => by.has(label)).map(([k]) => k);
            expect(readBy.length, `the ${label} module (${b.found.files[label]}) read no variable on the baseline run`).toBeGreaterThan(0);
            for (const k of b.found.astNames[label]) expect(b.list, `${k} (a literal read in ${b.found.files[label]})`).toContain(k);
        }
        for (const k of b.reads.keys()) expect(b.list).toContain(k);
        expect(b.list).toContain('VITEST');
        // The five risk limits (Amendment A-1) are read by the risk gate.
        for (const k of ['MAX_OPEN_POSITIONS', 'MAX_TOTAL_EXPOSURE', 'DAILY_LOSS_PCT', 'SNIPE_COOLDOWN_MS', 'MAX_POSITION_SIZE']) {
            expect(b.reads.get(k)?.has('risk'), `${k} read by the risk gate`).toBe(true);
        }
        const env = Object.fromEntries(b.list.map((k) => [k, validValue(k)]));
        const text = fileText({
            about:
                'Plan 23-23 env snapshot (CHAR-03). env: every variable the config module, the chain registry and the risk gate read, at its valid value. outcome: what each module parses from that; risk.value.probes are the real canSnipe under one state per risk setting. Each <VAR>.json varies only VAR and records only the fields that differ from this outcome, at the same path ({"$absent":true} = removed; arrays whole). Written only by npm run recordings:update; see test/realpath/env/envMatrix.test.ts.',
            env,
            outcome: b.outcome,
        });
        compareRecording(BASELINE_REL, text);
        // The committed baseline's env keys are exactly the list (the list the matrix runs).
        expect(Object.keys((JSON.parse(text) as { env: Record<string, string> }).env)).toEqual(b.list);
        if (COMMITTED.length > 0) expect(COMMITTED).toEqual(b.list);
    });

    for (const name of VARIED) {
        it(`${name}: unset, '', 0, abc and valid, one variable varied at a time`, async () => {
            const b = baseline as Baseline;
            const allowed = new Set(COMMITTED.length > 0 ? COMMITTED : b.list);
            const cases: Record<string, unknown> = {};
            for (const c of CASES) {
                const value = c.value(name);
                const { outcome, reads } = await evaluateCase(b.list, { name, value }, b.found);
                const extra = [...reads.keys()].filter((k) => !allowed.has(k));
                expect(extra, `case ${name}=${c.key} read ${extra[0]}, which is not a key of ${BASELINE_REL} env`).toEqual([]);
                cases[c.key] = { env: { [name]: value === undefined ? { $unset: true } : value }, changes: diff(b.outcome, doc(outcome)) ?? {} };
            }
            compareRecording(`env/${name}.json`, fileText({ variable: name, cases }));
        });
    }

    it('AC-28 and the non-finite form: an exit and a NaN are recorded as data', async () => {
        const b = baseline as Baseline;
        // A value that makes parsing exit is the result, not a failure.
        const chains = doc((await evaluateCase(b.list, { name: 'ENABLED_CHAINS', value: 'abc' }, b.found)).outcome) as CaseOutcome;
        expect(chains.registry.kind).toBe('exit');
        expect((chains.registry as { code: unknown }).code).toBe(1);
        expect(chains.registry.logs.map((l) => `${l.level} ${String(l.msg)}`)).toContain('fatal Unknown chain name in ENABLED_CHAINS');
        // A config exit ends the registry's load too (it imports the config module); the risk gate parses on.
        const key = doc((await evaluateCase(b.list, { name: 'PRIVATE_KEY', value: undefined }, b.found)).outcome) as CaseOutcome;
        expect(key.config).toMatchObject({ kind: 'exit', code: 1 });
        expect(key.config.logs.map((l) => `${l.level} ${String(l.msg)}`)).toEqual(['fatal Missing required environment variables']);
        expect(key.registry).toEqual({ kind: 'exit', code: 1, from: 'config', logs: [] });
        expect(key.risk.kind).toBe('ok');
        // A value that parses to NaN is the distinct $nonFinite object (the serializer's form).
        const trailing = doc((await evaluateCase(b.list, { name: 'TRAILING_STOP_PCT', value: 'abc' }, b.found)).outcome) as CaseOutcome;
        expect((trailing.config as { value: { CONFIG: { trailingStopPct: unknown } } }).value.CONFIG.trailingStopPct).toEqual({ $nonFinite: 'NaN' });
        // A risk limit that parses to NaN is a rule that does not fire.
        const exposure = doc((await evaluateCase(b.list, { name: 'MAX_TOTAL_EXPOSURE', value: 'abc' }, b.found)).outcome) as CaseOutcome;
        expect((exposure.risk as { value: { probes: Record<string, unknown> } }).value.probes.MAX_TOTAL_EXPOSURE).toEqual({ allowed: true });
    });

    // Five children in sequence, each ts-node on the config module (about 2 s each). Measured
    // 2026-11-12: 6.9 to 9.0 s alone, 26.7 s under the full parallel run, of the 120 s the plan sets
    // (each child may take up to 110 s before spawnRailedChild stops it).
    it('VITEST: its five values, each in a railed child whose only reachable .env is a fake one in a temp cwd', { timeout: 120_000 }, () => {
        const cases: Record<string, unknown> = {};
        for (const c of FLAG_CASES) {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-env-vitest-'));
            const runId = `case-env-vitest-${c.key}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
            try {
                fs.writeFileSync(path.join(tmp, '.env'), FAKE_ENV_LINE);
                const r = spawnRailedChild(process.execPath, [TS_NODE_BIN, FLAG_CHILD, c.key], { cwd: tmp, withVitestEnv: false, timeoutMs: CHILD_TIMEOUT_MS, ledgerRunId: runId });
                const ledger = takeCaseLedger(runId);
                expect(r.status, `child ${c.key}: status ${String(r.status)}\nstderr:\n${r.stderr.slice(-2000)}`).toBe(0);
                // The child ran railed (its preload wrote worker-start) and reached no protected
                // path: dotenv resolves .env against the cwd, the temp folder, so the repo's .env is
                // never even attempted and no rail had anything to block (no env-read-blocked, no
                // deny). Measured 2026-11-12: each child's ledger is exactly one worker-start.
                expect(ledger.map((e) => e.kind), `child ${c.key} ledger`).toEqual(['worker-start']);
                const out = JSON.parse(lastLine(r.stdout)) as { dotenvLoaded: boolean };
                // When dotenv loads, it loads the one line of the fake file and nothing else.
                if (out.dotenvLoaded) expect(r.stdout, `child ${c.key} stdout`).toContain('injecting env (1) from .env');
                else expect(r.stdout, `child ${c.key} stdout`).not.toContain('injecting env');
                cases[c.key] = { child: out, env: { VITEST: c.value === undefined ? { $unset: true } : c.value } };
            } finally {
                fs.rmSync(tmp, { recursive: true, force: true });
            }
        }
        // The child observes both outcomes: unset loads the fake file, the valid value skips it.
        expect((cases.unset as { child: { dotenvLoaded: boolean } }).child.dotenvLoaded).toBe(true);
        expect((cases.valid as { child: { dotenvLoaded: boolean } }).child.dotenvLoaded).toBe(false);
        compareRecording('env/VITEST.json', fileText({ variable: 'VITEST', cases }));
    });
});
