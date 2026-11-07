'use strict';
// test/rails/core.cjs
// Phase 22 plan 22-05 Task 1 — SAFE-02 test-isolation rails, setup layer (D-01 layer a).
//
// ONE plain-CommonJS module, loaded two ways (D-01 / D-03):
//   - as Vitest `setupFiles` through test/rails/setup.cjs (unit + integration, mode 'full')
//     and test/rails/setup-fork.cjs (fork, mode 'fork');
//   - as the `NODE_OPTIONS=--require` preload through test/rails/preload.cjs (mode 'full'),
//     so railed child processes get the same rails.
// This is PURE test infrastructure (D-ROLLBACK): no production-code change, and there is
// NO bypass env var or flag (NAC-05). No rail decision reads any env var, VITEST included.
// The only env reads are: the app keys this module deletes (D-02), the two FORK_SHELL_KEYS
// values it carries through to fork tests (never deciding enforcement), and the ledger
// labels CSB_RAIL_RUN_ID / CSB_RAIL_PROJECT, which choose a ledger location or label only
// and are captured once at the first install. Re-installing can only ADD protection.
//
// Rails installed (each block is appended to the per-process rail ledger):
//   (1) env scrub + sentinel load (D-02): delete every app key, then load the committed
//       test/.env.test (inert sentinels). Fork mode re-applies exactly FORK_SHELL_KEYS from
//       the first capture of the inherited (shell) env (SPEC R4 / AC-17).
//   (2) .env block: any fs content access to <protected root>/.env or .env.* (except
//       .env.example) fails with an ENOENT-coded RAIL_ENV_BLOCKED error, which dotenv
//       swallows exactly as it swallows a missing file today (D-04).
//   (3) data fs block: every content-reading/-writing fs API on a path canonically inside
//       <protected root>/data/ throws RAIL_DATA_TRIPWIRE ("protects the live bot data
//       folder"). Metadata (stat, lstat, exists, readdir, access, opendir) stays allowed.
//       This also closes the Buffer-constructed DB route (better-sqlite3 lib/database.js:16):
//       the live DB bytes can no longer be read into a Buffer.
//   (4) DB tripwire (D-04): the better-sqlite3 native addon `Database` constructor (found in
//       require.cache after one ':memory:' open) throws RAIL_DB_TRIPWIRE for any filename
//       inside <protected root>/data/; ATTACH / VACUUM INTO / backup() targets are checked too.
//   (5) network deny (Claude's Discretion): one choke point at net.Socket.prototype.connect
//       (`!!options.path` pipe test), plus dns lookup/resolve and dgram send/connect. Mode
//       'full' denies every non-loopback destination; mode 'fork' denies Telegram only
//       (SPEC R4). A denied connect fails asynchronously with E_RAIL_NET_DENIED, like a
//       refused connection (D-04).
//
// Residual risk (recorded, not covered by this layer): a native addon, process.binding /
// internalBinding, a worker_threads realm, a module that captured fs/net functions before
// this module installed (e.g. graceful-fs loaded earlier), and a pre-existing symlink or
// junction whose spelled path contains neither "data" nor ".env" (the plan's fast paths).
// The src-layer guards (22-09 db.ts, 22-10 notifier.ts) and the DB tripwire (which is NOT
// fast-pathed) still cover src/utils/db.ts.

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const dns = require('dns');
const dgram = require('dgram');
const Module = require('module');
const { fileURLToPath } = require('url');

const STATE_KEY = Symbol.for('crypto-snipe-bot.rails');
const LEDGER_GLOBAL_KEY = Symbol.for('crypto-snipe-bot.railLedger');
const WRAP_MARK = Symbol.for('crypto-snipe-bot.rails.wrapper');

const IS_WIN = process.platform === 'win32';
const CASE_INSENSITIVE = IS_WIN || process.platform === 'darwin';
const SEP = path.sep;

// The two keys fork mode carries through from the operator's shell (SPEC R4 / AC-17,
// D-GATE-BOTH-LAYERS). Widening this list is a code change pinned by a 22-08 test.
const FORK_SHELL_KEYS = Object.freeze(['ETH_FORK_RPC_URL', 'ALLOW_REAL_MAINNET']);
// What an ABSENT shell key becomes in fork mode: ETH_FORK_RPC_URL is deleted (the fork
// resolver then fails with its clear error instead of forking from the 127.0.0.1:1
// sentinel); ALLOW_REAL_MAINNET is '' (real-mainnet gate closed).
const FORK_SHELL_ABSENT = Object.freeze({ ETH_FORK_RPC_URL: 'delete', ALLOW_REAL_MAINNET: 'empty' });

// Every `process.env.X` key read by src/ or scripts/, from
//   git grep -ohE "process\.env\.[A-Z0-9_]+" -- src scripts
// at 22-05 implementation time (HEAD f9779b3). Committed verbatim: 22-08 re-greps and fails
// on any uncovered key. `X` comes from a comment in src/preflight.ts:63 and NODE_ENV is an
// OS/Node essential (listed for parity with the grep; never deleted, see ESSENTIAL_ENV_KEYS).
const STATIC_SOURCE_ENV_KEYS = Object.freeze([
    'ALCHEMY_URL', 'BLOXROUTE_AUTH_HEADER', 'BSC_RPC_URL', 'CAPTURE_ARCHIVE_RPC_URL',
    'DAILY_LOSS_PCT', 'DASHBOARD_ALLOWED_ORIGINS', 'DASHBOARD_API_KEY', 'DASHBOARD_HOST',
    'DASHBOARD_PORT', 'DASHBOARD_TRUST_PROXY_PROTO', 'DASHBOARD_URL', 'DB_PATH',
    'DELIBERATE_BUY_GAS_BUFFER', 'DELIBERATE_BUY_PRIVATE_ATTEMPTS', 'DELIBERATE_BUY_SLIPPAGE_PCT',
    'DEPLOY_PRIVATE_KEY', 'ENABLED_CHAINS', 'ETH_FORK_RPC_URL', 'ETH_RPC_URL', 'ETHERSCAN_API_KEY',
    'EXIT_DUST_THRESHOLD_BPS', 'EXIT_GATE_SELL_GAS_BUFFER', 'EXIT_ROUTINE_MAX_FAILURES',
    'FLASHBOTS_AUTH_KEY', 'LOG_LEVEL', 'MAX_OPEN_POSITIONS', 'MAX_POSITION_SIZE', 'MAX_TOTAL_EXPOSURE',
    'MEV_BUILDERS', 'MEV_BUY_TARGET_BLOCKS', 'MEV_SELL_ANTIRUG_SLIPPAGE_PCT', 'MEV_SELL_FALLBACK_ATTEMPTS',
    'MEV_STRATEGY', 'MID_RUN_CHECK_INTERVAL_SEC', 'NETWORK', 'NODE_ENV', 'PARTIAL_SELL_TARGETS',
    'PRIVATE_KEY', 'SIGINT_GRACE_MS', 'SNIPE_COOLDOWN_MS', 'STALE_ERROR_SEC', 'STALE_WARN_SEC',
    'STOP_LOSS_PCT', 'TELEGRAM_ALLOWED_CHANNELS', 'TELEGRAM_ALLOWED_SENDERS', 'TELEGRAM_API_HASH',
    'TELEGRAM_API_ID', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_SESSION',
    'TRAILING_MAX_PCT', 'TRAILING_MIN_PCT', 'TRAILING_STOP_PCT', 'WATCHDOG_BUDGET_MS', 'X',
]);
// Keys D-02 names explicitly that no static grep finds (RESEARCH Runtime State Inventory).
const EXTRA_SCRUB_KEYS = Object.freeze([
    'STOP_LOSS_PERCENT', 'MEV_STRATEGY', 'TEST_WALLET_PRIVATE_KEY', ...FORK_SHELL_KEYS,
]);
// Dynamically built keys (e.g. `${envPrefix}_SNIPE_AMOUNT`, src/chainRegistry.ts:663-674).
const SCRUB_PREFIX_RE = new RegExp(
    '^(ETH|BSC|BASE|ARB|SEPOLIA|TELEGRAM|DASHBOARD|MEV|DELIBERATE_BUY|EXIT|CAPTURE|ANTIRUG)_',
    IS_WIN ? 'i' : '',
);
const DOTENV_PREFIX_RE = new RegExp('^DOTENV_', IS_WIN ? 'i' : '');
// Never deleted and never overridable: OS / Node / Vitest essentials and the ledger labels.
const ESSENTIAL_ENV_KEYS = Object.freeze([
    'PATH', 'Path', 'SystemRoot', 'ComSpec', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE',
    'HOME', 'TEMP', 'TMP', 'TMPDIR', 'NODE_OPTIONS', 'NODE_ENV', 'CI',
]);
const LABEL_ENV_KEYS = Object.freeze(['CSB_RAIL_RUN_ID', 'CSB_RAIL_PROJECT']);
const VITEST_PREFIX_RE = new RegExp('^VITEST', IS_WIN ? 'i' : '');
const CSB_RAIL_PREFIX_RE = new RegExp('^CSB_RAIL_', IS_WIN ? 'i' : '');

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LEDGER_KIND_RE = /^[a-z][a-z0-9-]{0,47}$/;

// Telegram (fork mode keeps this deny; SPEC R4). Hostname suffixes plus Telegram's
// published address ranges (gramjs connects to data-centre IPs directly).
const TELEGRAM_HOST_SUFFIXES = Object.freeze(['telegram.org', 't.me', 'telegram.me', 'telegram.dog']);
const TELEGRAM_V4_CIDRS = Object.freeze([
    '91.108.4.0/22', '91.108.8.0/22', '91.108.12.0/22', '91.108.16.0/22', '91.108.56.0/22',
    '149.154.160.0/20', '95.161.64.0/20',
]);
const TELEGRAM_V6_PREFIXES48 = Object.freeze(['2001:67c:4e8::', '2001:b28:f23d::', '2001:b28:f23f::']);

// Originals captured at module load (before any wrapper of this module exists).
const ORIG = Object.freeze({
    lstatSync: fs.lstatSync,
    readlinkSync: fs.readlinkSync,
    realpathNative: fs.realpathSync.native,
    readFileSync: fs.readFileSync,
    appendFileSync: fs.appendFileSync,
    mkdirSync: fs.mkdirSync,
    existsSync: fs.existsSync,
});

// Values of the fork shell keys live here, NOT on the globally reachable state object.
const forkShellValues = new Map();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function getState() {
    return globalThis[STATE_KEY];
}

function requireState() {
    const st = getState();
    if (!st) throw new Error('SAFE-02 rails are not installed: call installRails() first');
    return st;
}

function findRepoRoot() {
    let dir = __dirname;
    for (;;) {
        const pkg = path.join(dir, 'package.json');
        if (ORIG.existsSync(pkg)) {
            let name;
            try {
                name = JSON.parse(ORIG.readFileSync(pkg, 'utf8')).name;
            } catch {
                name = undefined;
            }
            if (name === 'crypto-snipe-bot') return ORIG.realpathNative(dir);
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error('SAFE-02 rails install failed: no package.json named crypto-snipe-bot above ' + __dirname);
        }
        dir = parent;
    }
}

function createState(firstMode) {
    const repoRoot = findRepoRoot();

    const rawRunId = process.env.CSB_RAIL_RUN_ID;
    let runId = 'no-run';
    if (typeof rawRunId === 'string' && rawRunId !== '') {
        if (!RUN_ID_RE.test(rawRunId) || rawRunId === '.' || rawRunId === '..') {
            throw new Error('SAFE-02 rails install failed: CSB_RAIL_RUN_ID is not a valid run id ([A-Za-z0-9._-], max 128)');
        }
        runId = rawRunId;
    }
    const rawProject = process.env.CSB_RAIL_PROJECT;
    const project = typeof rawProject === 'string' && rawProject !== '' ? rawProject.slice(0, 64) : 'none';
    const ledgerDir = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger', runId);
    const ledgerFile = path.join(ledgerDir, process.pid + '.jsonl');

    const st = {
        version: 1,
        firstMode,
        mode: firstMode,
        installCount: 0,
        installError: null,
        repoRoot,
        protectedRoots: [],
        runId,
        project,
        ledgerDir,
        ledgerFile,
        ledgerErrors: 0,
        envInstalled: false,
        envBlockInstalled: false,
        dataBlockInstalled: false,
        dbWrapperInstalled: false,
        netWrappersInstalled: false,
        exampleKeys: [],
        sentinels: {},
        forkShell: {},
    };
    return st;
}

function strictestMode(a, b) {
    return a === 'full' || b === 'full' ? 'full' : 'fork';
}

// ---------------------------------------------------------------------------
// Path canonicalisation (fs.realpathSync.native on existing directories; win32 aware)
// ---------------------------------------------------------------------------

function toPathString(p) {
    if (typeof p === 'string') return p;
    if (Buffer.isBuffer(p)) return p.toString('utf8');
    if (p instanceof URL || (p && typeof p === 'object' && typeof p.href === 'string' && typeof p.protocol === 'string')) {
        if (p.protocol !== 'file:') return null;
        try {
            return fileURLToPath(p.href);
        } catch {
            return null;
        }
    }
    return null;
}

function stripWinPrefix(p) {
    if (!IS_WIN) return p;
    if (/^\\\\[?.]\\UNC\\/i.test(p)) return '\\\\' + p.slice(8);
    if (/^\\\\[?.]\\[A-Za-z]:/.test(p)) return p.slice(4);
    return p;
}

// Win32 maps "data." / "data " / "data::$INDEX_ALLOCATION" / ".env::$DATA" to the plain
// name; normalise every segment so the lexical comparison sees what Windows opens.
function normalizeWinSegments(p) {
    if (!IS_WIN) return p;
    const root = path.parse(p).root;
    const rest = p.slice(root.length);
    const segs = rest.split(/[\\/]+/).map((s) => s.replace(/:.*$/, '').replace(/[. ]+$/, '')).filter((s) => s !== '');
    return root + segs.join('\\');
}

function lexicalAbs(p) {
    return normalizeWinSegments(stripWinPrefix(path.resolve(p)));
}

function canonicalAbs(p, depth) {
    const d = depth || 0;
    const start = lexicalAbs(p);
    if (d > 16) return start;
    const tail = [];
    let cur = start;
    for (;;) {
        let st;
        try {
            st = ORIG.lstatSync(cur, { throwIfNoEntry: false });
        } catch {
            st = undefined;
        }
        if (st) {
            if (st.isSymbolicLink()) {
                let target;
                try {
                    target = ORIG.readlinkSync(cur);
                } catch {
                    return path.join(cur, ...tail.slice().reverse());
                }
                const resolved = path.resolve(path.dirname(cur), stripWinPrefix(target));
                return canonicalAbs(path.join(resolved, ...tail.slice().reverse()), d + 1);
            }
            if (st.isDirectory() || (IS_WIN && path.basename(cur).includes('~'))) {
                let real = cur;
                try {
                    real = normalizeWinSegments(stripWinPrefix(ORIG.realpathNative(cur)));
                } catch {
                    real = cur;
                }
                return path.join(real, ...tail.slice().reverse());
            }
            // A regular file: canonicalise its directory, keep the name (no open of the file).
        }
        const parent = path.dirname(cur);
        if (parent === cur) return start;
        tail.push(path.basename(cur));
        cur = parent;
    }
}

function cmpForm(p) {
    let s = IS_WIN ? p.replace(/[\\/]+/g, SEP) : p.replace(/\/+/g, SEP);
    if (s.length > 1 && s.endsWith(SEP) && !/^[A-Za-z]:\\$/.test(s)) s = s.slice(0, -1);
    return CASE_INSENSITIVE ? s.toLowerCase() : s;
}

function isInsideOrEqual(child, parent) {
    return child === parent || child.startsWith(parent.endsWith(SEP) ? parent : parent + SEP);
}

function forms(p) {
    const lex = cmpForm(lexicalAbs(p));
    const can = cmpForm(canonicalAbs(p));
    return lex === can ? [lex] : [lex, can];
}

function makeRootRecord(dir) {
    const lexRoot = lexicalAbs(dir);
    const canRoot = canonicalAbs(dir);
    const dataLex = path.join(lexRoot, 'data');
    const dataCan = canonicalAbs(path.join(canRoot, 'data'));
    return {
        root: canRoot,
        rootForms: Array.from(new Set([cmpForm(lexRoot), cmpForm(canRoot)])),
        dataDir: dataCan,
        dataForms: Array.from(new Set([cmpForm(dataLex), cmpForm(dataCan)])),
    };
}

// Returns the protected data dir a path lies in (or, with ancestor=true, also a path that
// CONTAINS a protected data dir), else null.
function protectedDataHit(p, ancestor) {
    const st = getState();
    if (!st) return null;
    const pf = forms(p);
    for (const r of st.protectedRoots) {
        for (const f of pf) {
            for (const d of r.dataForms) {
                if (isInsideOrEqual(f, d)) return r.dataDir;
                if (ancestor && isInsideOrEqual(d, f)) return r.dataDir;
            }
        }
    }
    return null;
}

function envBasenameBlocked(base) {
    let b = base;
    if (IS_WIN) b = b.replace(/:.*$/, '').replace(/[. ]+$/, '');
    if (CASE_INSENSITIVE) b = b.toLowerCase();
    if (b === '.env') return true;
    return b.startsWith('.env.') && b !== '.env.example';
}

function protectedEnvHit(p) {
    const st = getState();
    if (!st) return null;
    const cands = [lexicalAbs(p), canonicalAbs(p)];
    for (const c of cands) {
        if (!envBasenameBlocked(path.basename(c))) continue;
        const dir = cmpForm(path.dirname(c));
        for (const r of st.protectedRoots) {
            if (r.rootForms.includes(dir)) return c;
        }
    }
    return null;
}

// Fast paths (plan): only canonicalise when the resolved path mentions "data" / ".env".
function maybeData(abs) {
    return /data/i.test(abs) || (IS_WIN && abs.includes('~'));
}

function maybeEnv(abs) {
    const b = path.basename(abs);
    return (CASE_INSENSITIVE ? /^\.env/i : /^\.env/).test(b) || (IS_WIN && b.includes('~'));
}

function isProtectedDataPath(p) {
    const s = toPathString(p);
    if (s === null || s === '') return false;
    return protectedDataHit(s, false) !== null;
}

function dbFilenameCandidates(filename) {
    if (typeof filename !== 'string') return [];
    const f = filename.trim();
    if (f === '' || f === ':memory:') return [];
    const out = [f];
    if (/^file:/i.test(f)) {
        let s = f.slice(5).replace(/[?#].*$/, '');
        if (s.startsWith('//')) s = s.slice(2);
        if (IS_WIN && /^\/[A-Za-z]:/.test(s)) s = s.slice(1);
        try {
            s = decodeURIComponent(s);
        } catch {
            /* keep raw */
        }
        if (s !== '' && s !== ':memory:') out.push(s);
    }
    return out;
}

function isProtectedDbPath(p) {
    const s = toPathString(p);
    if (s === null) return false;
    for (const c of dbFilenameCandidates(s)) {
        if (protectedDataHit(c, false) !== null) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

const CORE_FRAME_RE = /[\\/]test[\\/]rails[\\/]core\.cjs/;

function captureStack() {
    const old = Error.stackTraceLimit;
    Error.stackTraceLimit = 60;
    const s = new Error().stack || '';
    Error.stackTraceLimit = old;
    return s
        .split('\n')
        .slice(1)
        .map((l) => l.trim())
        .filter((l) => l !== '' && !CORE_FRAME_RE.test(l))
        .slice(0, 8);
}

function ledgerAppend(entry) {
    const st = requireState();
    if (!entry || typeof entry !== 'object') throw new TypeError('ledgerAppend(entry): entry must be an object');
    const kind = entry.kind;
    if (typeof kind !== 'string' || !LEDGER_KIND_RE.test(kind)) {
        throw new TypeError('ledgerAppend(entry): kind must match ' + LEDGER_KIND_RE);
    }
    let target = entry.target === undefined ? null : entry.target;
    if (typeof target === 'string' && target.length > 500) target = target.slice(0, 500);
    const rec = {
        ts: new Date().toISOString(),
        runId: st.runId,
        pid: process.pid,
        ppid: process.ppid,
        project: st.project,
        kind,
        target,
        stack: captureStack(),
    };
    let line;
    try {
        line = JSON.stringify(rec) + '\n';
    } catch {
        line = JSON.stringify({ ...rec, target: '[unserialisable target]' }) + '\n';
    }
    try {
        ORIG.mkdirSync(st.ledgerDir, { recursive: true });
        ORIG.appendFileSync(st.ledgerFile, line, 'utf8');
    } catch (err) {
        // The block itself still happens (safe direction); the evidence loss is surfaced.
        st.ledgerErrors += 1;
        if (st.ledgerErrors === 1) {
            process.stderr.write(`[SAFE-02 rails] rail ledger write failed (${st.ledgerFile}): ${err && err.message}\n`);
        }
    }
    return rec;
}

function readLedger(opts) {
    const st = getState();
    const o = opts || {};
    const runId = o.runId !== undefined ? o.runId : st ? st.runId : 'no-run';
    const pid = o.pid !== undefined ? o.pid : process.pid;
    if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) throw new TypeError('readLedger: invalid runId');
    if (!Number.isInteger(pid) || pid <= 0) throw new TypeError('readLedger: invalid pid');
    const file = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger', runId, pid + '.jsonl');
    const finalFile = st && st.runId === runId && pid === process.pid ? st.ledgerFile : file;
    let text;
    try {
        text = ORIG.readFileSync(finalFile, 'utf8');
    } catch {
        return [];
    }
    const out = [];
    for (const l of text.split('\n')) {
        if (l.trim() === '') continue;
        try {
            out.push(JSON.parse(l));
        } catch {
            out.push({ kind: 'unparseable-line' });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function envBlockedError(api, p) {
    const e = new Error(
        `RAIL_ENV_BLOCKED: ENOENT: no such file or directory, ${api} '${p}' ` +
            '(the SAFE-02 test rail blocks access to the real .env; tests run on test/.env.test sentinels)',
    );
    e.code = 'ENOENT';
    e.errno = IS_WIN ? -4058 : -2;
    e.syscall = 'open';
    e.path = p;
    e.railCode = 'RAIL_ENV_BLOCKED';
    return e;
}

function dataBlockedError(api, p, dataDir) {
    const e = new Error(
        `RAIL_DATA_TRIPWIRE: refused fs.${api}('${p}') — the SAFE-02 test rail protects the live bot data folder (${dataDir})`,
    );
    e.code = 'RAIL_DATA_TRIPWIRE';
    e.path = p;
    return e;
}

function dbBlockedError(what, dataDir) {
    const e = new Error(
        `RAIL_DB_TRIPWIRE: refused to open SQLite database ${what} — the SAFE-02 test rail protects the live bot DB (${dataDir})`,
    );
    e.code = 'RAIL_DB_TRIPWIRE';
    return e;
}

function netDeniedError(kind, host, port) {
    const who = kind === 'telegram' ? 'Telegram' : 'non-loopback';
    const e = new Error(
        `E_RAIL_NET_DENIED: connection to ${host}${port !== undefined && port !== null ? ':' + port : ''} denied — ` +
            `the SAFE-02 test rail blocks ${who} network from tests`,
    );
    e.code = 'E_RAIL_NET_DENIED';
    e.host = host;
    if (port !== undefined && port !== null) e.port = port;
    return e;
}

// ---------------------------------------------------------------------------
// Host classification
// ---------------------------------------------------------------------------

function ipv4ToInt(s) {
    const p = s.split('.').map(Number);
    return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function inV4Cidr(ip, cidr) {
    const [base, bitsS] = cidr.split('/');
    const bits = Number(bitsS);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((ipv4ToInt(ip) & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

function expandIPv6(s) {
    let str = s;
    const m = str.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (m) {
        const p = m[1].split('.').map(Number);
        str = str.slice(0, -m[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
    }
    const halves = str.split('::');
    const head = halves[0] ? halves[0].split(':') : [];
    let groups;
    if (halves.length === 1) {
        groups = head;
    } else {
        const tail = halves[1] ? halves[1].split(':') : [];
        groups = [...head, ...new Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
    }
    return groups.map((g) => parseInt(g || '0', 16));
}

function normHost(host) {
    let s = String(host === undefined || host === null ? '' : host).trim().toLowerCase();
    if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
    s = s.replace(/%.*$/, '');
    while (s.endsWith('.')) s = s.slice(0, -1);
    return s;
}

function classifyHost(host, mode) {
    if (mode !== undefined && mode !== 'full' && mode !== 'fork') throw new TypeError("classifyHost: mode must be 'full' or 'fork'");
    const s = normHost(host);
    if (s === '') return 'other';
    let v4 = null;
    if (net.isIPv4(s)) v4 = s;
    else if (net.isIPv6(s)) {
        const g = expandIPv6(s);
        if (g.length === 8 && g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
            v4 = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
        } else {
            if (g.length === 8 && g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return 'loopback';
            for (const pfx of TELEGRAM_V6_PREFIXES48) {
                const pg = expandIPv6(pfx);
                if (g[0] === pg[0] && g[1] === pg[1] && g[2] === pg[2]) return 'telegram';
            }
            return 'other';
        }
    }
    if (v4 !== null) {
        if (v4.startsWith('127.')) return 'loopback';
        for (const c of TELEGRAM_V4_CIDRS) if (inV4Cidr(v4, c)) return 'telegram';
        return 'other';
    }
    if (s === 'localhost') return 'loopback';
    // Textual suffix match (stricter: in fork mode it can only deny MORE).
    for (const d of TELEGRAM_HOST_SUFFIXES) if (s.endsWith(d)) return 'telegram';
    return 'other';
}

function hostAllowed(cls, mode) {
    return mode === 'full' ? cls === 'loopback' : cls !== 'telegram';
}

// ---------------------------------------------------------------------------
// Wrapping helpers
// ---------------------------------------------------------------------------

function markWrapper(wrapper, orig) {
    for (const k of Reflect.ownKeys(orig)) {
        if (k === 'length' || k === 'name' || k === 'prototype' || k === 'caller' || k === 'arguments') continue;
        const desc = Object.getOwnPropertyDescriptor(orig, k);
        if (desc) {
            try {
                Object.defineProperty(wrapper, k, desc);
            } catch {
                /* non-configurable on target: skip */
            }
        }
    }
    try {
        Object.defineProperty(wrapper, 'name', { value: orig.name, configurable: true });
    } catch {
        /* ignore */
    }
    Object.defineProperty(wrapper, WRAP_MARK, { value: true });
    return wrapper;
}

function replaceMethod(obj, key, makeWrapper, label) {
    const orig = obj[key];
    if (typeof orig !== 'function') return false;
    if (orig[WRAP_MARK]) return true;
    const w = markWrapper(makeWrapper(orig), orig);
    obj[key] = w;
    if (obj[key] !== w) throw new Error(`SAFE-02 rails install failed: could not replace ${label}`);
    return true;
}

// ---------------------------------------------------------------------------
// (2) + (3) fs blocks
// ---------------------------------------------------------------------------

// [name, path-argument indices, env-read?, ancestor-check?]
const FS_PATH_APIS = Object.freeze([
    ['readFile', [0], true, false],
    ['open', [0], true, false],
    ['openAsBlob', [0], true, false],
    ['writeFile', [0], false, false],
    ['appendFile', [0], false, false],
    ['truncate', [0], false, false],
    ['mkdir', [0], false, false],
    ['mkdtemp', [0], false, false],
    ['utimes', [0], false, false],
    ['lutimes', [0], false, false],
    ['chmod', [0], false, false],
    ['lchmod', [0], false, false],
    ['chown', [0], false, false],
    ['lchown', [0], false, false],
    ['unlink', [0], false, false],
    ['rm', [0], false, true],
    ['rmdir', [0], false, true],
    ['copyFile', [0, 1], true, false],
    ['cp', [0, 1], true, true],
    ['rename', [0, 1], true, true],
    ['link', [0, 1], true, false],
    ['symlink', [0, 1], true, false],
]);

function checkFsCall(api, idxs, envRead, ancestor, args) {
    const baseApi = api.replace(/^promises\./, '');
    for (const i of idxs) {
        const raw = toPathString(args[i]);
        if (raw === null || raw === '') continue;
        const cands = [raw];
        // symlink(target, path): a relative target is resolved against the link's directory.
        if (baseApi.startsWith('symlink') && i === 0) {
            const linkPath = toPathString(args[1]);
            if (linkPath) cands.push(path.resolve(path.dirname(path.resolve(linkPath)), raw));
        }
        for (const c of cands) {
            const abs = path.resolve(c);
            if (maybeEnv(abs)) {
                const hit = protectedEnvHit(c);
                if (hit) {
                    const readLike = envRead && /^(readFile|open|openAsBlob|createReadStream|ReadStream)/.test(baseApi);
                    ledgerAppend({ kind: readLike ? 'env-read-blocked' : 'env-write-blocked', target: hit });
                    return envBlockedError(api, abs);
                }
            }
            if (maybeData(abs) || ancestor) {
                const dataDir = protectedDataHit(c, ancestor);
                if (dataDir) {
                    ledgerAppend({ kind: 'data-access-blocked', target: { api, path: abs } });
                    return dataBlockedError(api, abs, dataDir);
                }
            }
        }
    }
    return null;
}

function makeFsWrapper(api, idxs, envRead, ancestor, form) {
    return (orig) =>
        function railFsWrapper(...args) {
            const err = checkFsCall(api, idxs, envRead, ancestor, args);
            if (err) {
                if (form === 'cb') {
                    const cb = args[args.length - 1];
                    if (typeof cb === 'function') {
                        process.nextTick(cb, err);
                        return undefined;
                    }
                    throw err;
                }
                if (form === 'promise') return Promise.reject(err);
                throw err;
            }
            return Reflect.apply(orig, this, args);
        };
}

function makeStreamClassProxy(Cls, api, envRead) {
    if (typeof Cls !== 'function' || Cls[WRAP_MARK]) return Cls;
    const check = (args) => checkFsCall(api, [0], envRead, false, args);
    const proxy = new Proxy(Cls, {
        construct(target, args, newTarget) {
            const err = check(args);
            if (err) throw err;
            return Reflect.construct(target, args, newTarget);
        },
        apply(target, thisArg, args) {
            const err = check(args);
            if (err) throw err;
            return Reflect.apply(target, thisArg, args);
        },
        get(target, prop, receiver) {
            if (prop === WRAP_MARK) return true;
            return Reflect.get(target, prop, receiver);
        },
    });
    return proxy;
}

function installFsBlocks(st) {
    if (st.envBlockInstalled && st.dataBlockInstalled) return;
    for (const [name, idxs, envRead, ancestor] of FS_PATH_APIS) {
        if (name !== 'openAsBlob') {
            replaceMethod(fs, name, makeFsWrapper(name, idxs, envRead, ancestor, 'cb'), 'fs.' + name);
            replaceMethod(fs, name + 'Sync', makeFsWrapper(name + 'Sync', idxs, envRead, ancestor, 'sync'), 'fs.' + name + 'Sync');
        } else {
            replaceMethod(fs, name, makeFsWrapper(name, idxs, envRead, ancestor, 'promise'), 'fs.' + name);
        }
        if (fs.promises && typeof fs.promises[name] === 'function') {
            replaceMethod(fs.promises, name, makeFsWrapper('promises.' + name, idxs, envRead, ancestor, 'promise'), 'fs.promises.' + name);
        }
    }
    replaceMethod(fs, 'createReadStream', makeFsWrapper('createReadStream', [0], true, false, 'sync'), 'fs.createReadStream');
    replaceMethod(fs, 'createWriteStream', makeFsWrapper('createWriteStream', [0], true, false, 'sync'), 'fs.createWriteStream');
    // `new fs.ReadStream(path)` / `new fs.WriteStream(path)` bypass createXStream.
    const RS = makeStreamClassProxy(fs.ReadStream, 'ReadStream', true);
    const WS = makeStreamClassProxy(fs.WriteStream, 'WriteStream', true);
    fs.ReadStream = RS;
    fs.WriteStream = WS;
    // Fail closed: verify the core wrappers really are in place.
    for (const k of ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream', 'writeFileSync', 'rmSync', 'renameSync']) {
        if (!fs[k] || !fs[k][WRAP_MARK]) throw new Error('SAFE-02 rails install failed: fs.' + k + ' is not wrapped');
    }
    for (const k of ['readFile', 'open', 'writeFile', 'rm', 'rename']) {
        if (!fs.promises[k] || !fs.promises[k][WRAP_MARK]) throw new Error('SAFE-02 rails install failed: fs.promises.' + k + ' is not wrapped');
    }
    st.envBlockInstalled = true;
    st.dataBlockInstalled = true;
}

// ---------------------------------------------------------------------------
// (4) DB tripwire through the better-sqlite3 native addon
// ---------------------------------------------------------------------------

// Comments and quoted tokens are removed first so a word inside a string literal never
// counts as a statement; string literals are kept for the target check.
function sqlFileTargets(sql) {
    if (typeof sql !== 'string' || !/attach|vacuum/i.test(sql)) return [];
    const lits = [];
    let out = '';
    let i = 0;
    while (i < sql.length) {
        const c = sql[i];
        if (c === "'") {
            let j = i + 1;
            let v = '';
            while (j < sql.length) {
                if (sql[j] === "'") {
                    if (sql[j + 1] === "'") {
                        v += "'";
                        j += 2;
                        continue;
                    }
                    break;
                }
                v += sql[j];
                j += 1;
            }
            lits.push(v);
            out += ` \u0001${lits.length - 1}\u0001 `;
            i = j + 1;
            continue;
        }
        if (c === '"' || c === '`' || c === '[') {
            const close = c === '[' ? ']' : c;
            let j = i + 1;
            while (j < sql.length) {
                if (sql[j] === close) {
                    if (close !== ']' && sql[j + 1] === close) {
                        j += 2;
                        continue;
                    }
                    break;
                }
                j += 1;
            }
            out += ' \u0002 ';
            i = j + 1;
            continue;
        }
        if (c === '-' && sql[i + 1] === '-') {
            while (i < sql.length && sql[i] !== '\n') i += 1;
            out += ' ';
            continue;
        }
        if (c === '/' && sql[i + 1] === '*') {
            const end = sql.indexOf('*/', i + 2);
            i = end === -1 ? sql.length : end + 2;
            out += ' ';
            continue;
        }
        out += c;
        i += 1;
    }
    const targets = [];
    const lit = (expr) => {
        const m = expr.trim().match(/^\u0001(\d+)\u0001$/);
        return m ? lits[Number(m[1])] : null;
    };
    const stmtStart = '(?:^|;)\\s*(?:EXPLAIN\\s+(?:QUERY\\s+PLAN\\s+)?)?';
    const attachRe = new RegExp(stmtStart + 'ATTACH\\b(?:\\s+DATABASE\\b)?([\\s\\S]*?)(?:\\bAS\\b|;|$)', 'gi');
    let m;
    while ((m = attachRe.exec(out)) !== null) {
        targets.push({ stmt: 'ATTACH', literal: lit(m[1]) });
        if (m[0].length === 0) attachRe.lastIndex += 1;
    }
    const vacRe = new RegExp(stmtStart + 'VACUUM\\b((?:(?!;)[\\s\\S])*)', 'gi');
    while ((m = vacRe.exec(out)) !== null) {
        const into = m[1].match(/\bINTO\b([\s\S]*)$/i);
        if (into) targets.push({ stmt: 'VACUUM INTO', literal: lit(into[1]) });
        if (m[0].length === 0) vacRe.lastIndex += 1;
    }
    return targets;
}

function dataDirForMessage() {
    const st = getState();
    return st && st.protectedRoots[0] ? st.protectedRoots[0].dataDir : '<repo>/data';
}

function checkDbFilenameOrThrow(filename, what) {
    for (const c of dbFilenameCandidates(filename)) {
        const dataDir = protectedDataHit(c, false);
        if (dataDir) {
            const abs = lexicalAbs(c);
            ledgerAppend({ kind: 'db-tripwire', target: { via: what, path: abs } });
            throw dbBlockedError(abs, dataDir);
        }
    }
}

function checkSqlOrThrow(sql) {
    for (const t of sqlFileTargets(sql)) {
        if (t.literal === null) {
            ledgerAppend({ kind: 'db-tripwire', target: { via: t.stmt, path: '<non-literal target>' } });
            throw dbBlockedError(`via ${t.stmt} with a non-literal target (only a literal path can be checked)`, dataDirForMessage());
        }
        checkDbFilenameOrThrow(t.literal, t.stmt);
    }
}

function wrapAddon(addon) {
    if (!addon || typeof addon.Database !== 'function') {
        throw new Error('SAFE-02 rails install failed: better_sqlite3.node exports no Database constructor');
    }
    const orig = addon.Database;
    if (orig[WRAP_MARK]) return;
    const proto = orig.prototype;
    for (const m of ['exec', 'prepare', 'backup']) {
        if (typeof proto[m] !== 'function') throw new Error('SAFE-02 rails install failed: addon Database.prototype.' + m + ' missing');
    }
    replaceMethod(proto, 'exec', (o) =>
        function railExec(...args) {
            checkSqlOrThrow(args[0]);
            return Reflect.apply(o, this, args);
        }, 'addon.Database.prototype.exec');
    replaceMethod(proto, 'prepare', (o) =>
        function railPrepare(...args) {
            checkSqlOrThrow(args[0]);
            return Reflect.apply(o, this, args);
        }, 'addon.Database.prototype.prepare');
    replaceMethod(proto, 'backup', (o) =>
        function railBackup(...args) {
            checkDbFilenameOrThrow(args[2], 'backup');
            return Reflect.apply(o, this, args);
        }, 'addon.Database.prototype.backup');
    const wrapped = function Database(...args) {
        if (!new.target) return Reflect.apply(orig, this, args);
        // Native signature (lib/database.js:69): (filename, filenameGiven, anonymous, ...).
        // The `anonymous` flag is not trusted: both names are checked unless '' / ':memory:'.
        checkDbFilenameOrThrow(args[0], 'open');
        checkDbFilenameOrThrow(args[1], 'open');
        return Reflect.construct(orig, args, new.target === wrapped ? orig : new.target);
    };
    wrapped.prototype = proto;
    Object.setPrototypeOf(wrapped, orig);
    markWrapper(wrapped, orig);
    addon.Database = wrapped;
    if (addon.Database !== wrapped) throw new Error('SAFE-02 rails install failed: could not replace addon Database');
}

function isBetterSqliteAddonPath(p) {
    return typeof p === 'string' && path.basename(p).toLowerCase() === 'better_sqlite3.node';
}

function installDbTripwire(st) {
    if (st.dbWrapperInstalled) return;
    const req = Module.createRequire(path.join(st.repoRoot, 'package.json'));
    const BetterSqlite = req('better-sqlite3');
    const probe = new BetterSqlite(':memory:');
    probe.close();
    const keys = Object.keys(require.cache).filter(isBetterSqliteAddonPath);
    if (keys.length === 0) throw new Error('SAFE-02 rails install failed: better_sqlite3.node not found in require.cache');
    for (const k of keys) wrapAddon(require.cache[k].exports);
    // Any copy of the addon loaded later is wrapped as it loads.
    const origNodeExt = Module._extensions['.node'];
    if (typeof origNodeExt === 'function' && !origNodeExt[WRAP_MARK]) {
        const ext = markWrapper(function railNodeExtension(module, filename) {
            const r = Reflect.apply(origNodeExt, this, [module, filename]);
            if (isBetterSqliteAddonPath(filename)) wrapAddon(module.exports);
            return r;
        }, origNodeExt);
        Module._extensions['.node'] = ext;
    }
    for (const k of keys) {
        if (!require.cache[k].exports.Database[WRAP_MARK]) throw new Error('SAFE-02 rails install failed: addon Database not wrapped');
    }
    st.dbWrapperInstalled = true;
}

// ---------------------------------------------------------------------------
// (5) Network: TCP/TLS connect, DNS, UDP
// ---------------------------------------------------------------------------

function denyKind(base, cls) {
    return cls === 'telegram' ? 'telegram-deny' : base;
}

function makeConnectWrapper(orig) {
    return function railConnect(...args) {
        const st = getState();
        const a0 = args[0];
        let opts = null;
        let pipe = false;
        let host;
        let port;
        if (Array.isArray(a0)) opts = a0[0] && typeof a0[0] === 'object' ? a0[0] : {};
        else if (a0 !== null && typeof a0 === 'object') opts = a0;
        if (opts) {
            if (opts.path) pipe = true; // mirrors Node: http agents pass `path: null` (Pitfall 3)
            host = opts.host;
            port = opts.port;
        } else if (typeof a0 === 'string' && !(Number(a0) >= 0)) {
            pipe = true;
        } else {
            port = a0;
            host = typeof args[1] === 'string' ? args[1] : undefined;
        }
        if (pipe || !st) return Reflect.apply(orig, this, args);
        const h = host === undefined || host === null || host === '' ? 'localhost' : String(host);
        const cls = classifyHost(h);
        if (hostAllowed(cls, st.mode)) {
            ledgerAppend({ kind: 'net-allow', target: { host: h, port: port === undefined ? null : String(port), class: cls } });
            return Reflect.apply(orig, this, args);
        }
        ledgerAppend({ kind: denyKind('net-deny', cls), target: { host: h, port: port === undefined ? null : String(port) } });
        const err = netDeniedError(cls, h, port);
        process.nextTick(() => this.destroy(err));
        return this;
    };
}

function lookupResultsDenied(st, address) {
    const list = Array.isArray(address) ? address.map((a) => (a && typeof a === 'object' ? a.address : a)) : [address];
    for (const a of list) {
        if (a === null || a === undefined) continue;
        const cls = classifyHost(a);
        if (!hostAllowed(cls, st.mode)) return { address: String(a), cls };
    }
    return null;
}

function makeDnsLookupWrapper(orig) {
    return function railLookup(hostname, ...rest) {
        const st = getState();
        const cb = typeof rest[rest.length - 1] === 'function' ? rest[rest.length - 1] : null;
        // An IP literal does no network I/O (Node short-circuits it); it is how bind/listen
        // resolve '0.0.0.0' / '::'. Connects and sends to it are checked at their choke points.
        if (!st || !cb || !hostname || net.isIP(String(hostname))) return Reflect.apply(orig, this, [hostname, ...rest]);
        const cls = classifyHost(hostname);
        if (!hostAllowed(cls, st.mode)) {
            ledgerAppend({ kind: denyKind('dns-deny', cls), target: { host: String(hostname), api: 'lookup' } });
            process.nextTick(cb, netDeniedError(cls, String(hostname)));
            return {};
        }
        const args = rest.slice(0, -1);
        return Reflect.apply(orig, this, [
            hostname,
            ...args,
            function railLookupResult(err, address, family) {
                if (!err) {
                    const bad = lookupResultsDenied(st, address);
                    if (bad) {
                        ledgerAppend({ kind: denyKind('dns-deny', bad.cls), target: { host: String(hostname), resolved: bad.address, api: 'lookup' } });
                        return cb(netDeniedError(bad.cls, String(hostname)));
                    }
                }
                return cb(err, address, family);
            },
        ]);
    };
}

function makeDnsPromiseLookupWrapper(orig) {
    return function railPromiseLookup(hostname, ...rest) {
        const st = getState();
        if (!st || !hostname || net.isIP(String(hostname))) return Reflect.apply(orig, this, [hostname, ...rest]);
        const cls = classifyHost(hostname);
        if (!hostAllowed(cls, st.mode)) {
            ledgerAppend({ kind: denyKind('dns-deny', cls), target: { host: String(hostname), api: 'promises.lookup' } });
            return Promise.reject(netDeniedError(cls, String(hostname)));
        }
        return Reflect.apply(orig, this, [hostname, ...rest]).then((res) => {
            const addrs = Array.isArray(res) ? res : [res && res.address];
            const bad = lookupResultsDenied(st, addrs);
            if (bad) {
                ledgerAppend({ kind: denyKind('dns-deny', bad.cls), target: { host: String(hostname), resolved: bad.address, api: 'promises.lookup' } });
                throw netDeniedError(bad.cls, String(hostname));
            }
            return res;
        });
    };
}

// resolve*/reverse send queries to the configured DNS server whatever the name, so mode
// 'full' denies every call; mode 'fork' denies Telegram names/addresses only.
function resolveDenied(st, name) {
    if (st.mode === 'full') return classifyHost(name) === 'telegram' ? 'telegram' : 'other';
    const cls = classifyHost(name);
    return cls === 'telegram' ? 'telegram' : null;
}

function makeDnsResolveWrapper(label, promiseForm) {
    return (orig) =>
        function railResolve(...args) {
            const st = getState();
            if (!st) return Reflect.apply(orig, this, args);
            const name = String(args[0]);
            const denied = resolveDenied(st, name);
            if (!denied) return Reflect.apply(orig, this, args);
            ledgerAppend({ kind: denyKind('dns-deny', denied), target: { host: name, api: label } });
            const err = netDeniedError(denied, name);
            if (promiseForm) return Promise.reject(err);
            const cb = args[args.length - 1];
            if (typeof cb === 'function') {
                process.nextTick(cb, err);
                return {};
            }
            throw err;
        };
}

function wrapResolveFamily(obj, labelPrefix, promiseForm) {
    if (!obj) return;
    for (const k of Object.getOwnPropertyNames(obj)) {
        if (!/^(resolve|reverse|lookupService)/.test(k)) continue;
        let desc;
        try {
            desc = Object.getOwnPropertyDescriptor(obj, k);
        } catch {
            continue;
        }
        if (!desc || typeof desc.value !== 'function') continue;
        replaceMethod(obj, k, makeDnsResolveWrapper(labelPrefix + k, promiseForm), labelPrefix + k);
    }
}

function udpDefaultAddress(sock) {
    return sock && sock.type === 'udp6' ? '::1' : '127.0.0.1';
}

function emitUdpError(sock, err, cb) {
    if (typeof cb === 'function') process.nextTick(cb, err);
    else process.nextTick(() => sock.emit('error', err));
}

function makeUdpSendWrapper(orig) {
    return function railUdpSend(...args) {
        const st = getState();
        if (!st) return Reflect.apply(orig, this, args);
        let connected = false;
        try {
            this.remoteAddress();
            connected = true;
        } catch {
            connected = false;
        }
        if (connected) return Reflect.apply(orig, this, args); // vetted at connect()
        // Mirror Node's argument shuffle (lib/dgram.js Socket.prototype.send).
        let [, offset, length, port, address, callback] = args;
        if (!(address || (port && typeof port !== 'function'))) {
            callback = port;
            port = offset;
            address = length;
        }
        if (typeof address === 'function') {
            callback = address;
            address = undefined;
        }
        const dest = address === undefined || address === null || address === '' ? udpDefaultAddress(this) : String(address);
        const cls = classifyHost(dest);
        if (hostAllowed(cls, st.mode)) return Reflect.apply(orig, this, args);
        ledgerAppend({ kind: cls === 'telegram' ? 'telegram-deny' : 'udp-deny', target: { host: dest, port: port === undefined ? null : String(port), api: 'dgram.send' } });
        emitUdpError(this, netDeniedError(cls, dest, port), typeof callback === 'function' ? callback : null);
        return undefined;
    };
}

function makeUdpConnectWrapper(orig) {
    return function railUdpConnect(...args) {
        const st = getState();
        if (!st) return Reflect.apply(orig, this, args);
        const [port] = args;
        let address = args[1];
        if (typeof address === 'function') address = undefined;
        const dest = address === undefined || address === null || address === '' ? udpDefaultAddress(this) : String(address);
        const cls = classifyHost(dest);
        if (hostAllowed(cls, st.mode)) return Reflect.apply(orig, this, args);
        ledgerAppend({ kind: cls === 'telegram' ? 'telegram-deny' : 'udp-deny', target: { host: dest, port: port === undefined ? null : String(port), api: 'dgram.connect' } });
        emitUdpError(this, netDeniedError(cls, dest, port), null);
        return undefined;
    };
}

function installNet(st) {
    if (st.netWrappersInstalled) return;
    replaceMethod(net.Socket.prototype, 'connect', makeConnectWrapper, 'net.Socket.prototype.connect');
    replaceMethod(dns, 'lookup', makeDnsLookupWrapper, 'dns.lookup');
    replaceMethod(dns.promises, 'lookup', makeDnsPromiseLookupWrapper, 'dns.promises.lookup');
    wrapResolveFamily(dns, 'dns.', false);
    wrapResolveFamily(dns.Resolver && dns.Resolver.prototype, 'dns.Resolver.prototype.', false);
    wrapResolveFamily(dns.promises, 'dns.promises.', true);
    wrapResolveFamily(dns.promises.Resolver && dns.promises.Resolver.prototype, 'dns.promises.Resolver.prototype.', true);
    replaceMethod(dgram.Socket.prototype, 'send', makeUdpSendWrapper, 'dgram.Socket.prototype.send');
    replaceMethod(dgram.Socket.prototype, 'connect', makeUdpConnectWrapper, 'dgram.Socket.prototype.connect');
    const must = [
        [net.Socket.prototype.connect, 'net.Socket.prototype.connect'],
        [dns.lookup, 'dns.lookup'],
        [dns.promises.lookup, 'dns.promises.lookup'],
        [dns.resolve4, 'dns.resolve4'],
        [dns.Resolver.prototype.resolve4, 'dns.Resolver.prototype.resolve4'],
        [dns.promises.resolve4, 'dns.promises.resolve4'],
        [dgram.Socket.prototype.send, 'dgram.Socket.prototype.send'],
        [dgram.Socket.prototype.connect, 'dgram.Socket.prototype.connect'],
    ];
    for (const [fn, label] of must) {
        if (typeof fn !== 'function' || !fn[WRAP_MARK]) throw new Error('SAFE-02 rails install failed: ' + label + ' is not wrapped');
    }
    st.netWrappersInstalled = true;
}

// ---------------------------------------------------------------------------
// (1) Env scrub + sentinel load (D-02) and fork shell keys (SPEC R4 / AC-17)
// ---------------------------------------------------------------------------

function keyEq(a, b) {
    return IS_WIN ? a.toUpperCase() === b.toUpperCase() : a === b;
}

function isEssentialKey(k) {
    if (VITEST_PREFIX_RE.test(k)) return true;
    for (const e of ESSENTIAL_ENV_KEYS) if (keyEq(k, e)) return true;
    for (const e of LABEL_ENV_KEYS) if (keyEq(k, e)) return true;
    return false;
}

function loadEnvFiles(st) {
    if (st.envFilesLoaded) return;
    const req = Module.createRequire(path.join(st.repoRoot, 'package.json'));
    const dotenv = req('dotenv');
    const examplePath = path.join(st.repoRoot, '.env.example');
    const sentinelPath = path.join(st.repoRoot, 'test', '.env.test');
    const example = dotenv.parse(ORIG.readFileSync(examplePath));
    const sentinels = dotenv.parse(ORIG.readFileSync(sentinelPath));
    if (Object.keys(sentinels).length === 0) throw new Error('SAFE-02 rails install failed: test/.env.test holds no keys');
    st.exampleKeys = Object.keys(example);
    st.sentinels = Object.freeze({ ...sentinels });
    st.envFilesLoaded = true;
}

function captureForkShellKeys(st) {
    // Only the FIRST install in a process captures; later process.env writes are never
    // re-captured. A full-mode first install keeps presence only: strictest-wins means the
    // effective mode can never become 'fork' afterwards, so the value is never retained.
    for (const k of FORK_SHELL_KEYS) {
        const v = process.env[k];
        const present = typeof v === 'string' && v !== '' && v !== st.sentinels[k];
        st.forkShell[k] = { present };
        if (present && st.firstMode === 'fork') forkShellValues.set(k, v);
    }
}

function applyEnv(st) {
    const del = new Set([...st.exampleKeys, ...Object.keys(st.sentinels), ...STATIC_SOURCE_ENV_KEYS, ...EXTRA_SCRUB_KEYS]);
    for (const k of Object.keys(process.env)) {
        if (SCRUB_PREFIX_RE.test(k) || DOTENV_PREFIX_RE.test(k)) del.add(k);
    }
    for (const k of del) {
        if (!isEssentialKey(k)) delete process.env[k];
    }
    for (const [k, v] of Object.entries(st.sentinels)) {
        if (isEssentialKey(k)) throw new Error('SAFE-02 rails install failed: test/.env.test may not set ' + k);
        process.env[k] = v;
    }
    if (st.mode === 'fork') {
        for (const k of FORK_SHELL_KEYS) {
            if (forkShellValues.has(k)) process.env[k] = forkShellValues.get(k);
            else if (FORK_SHELL_ABSENT[k] === 'delete') delete process.env[k];
            else process.env[k] = '';
            ledgerAppend({ kind: 'fork-shell-key', target: { key: k, state: forkShellValues.has(k) ? 'preserved' : 'absent' } });
        }
    }
    st.envInstalled = true;
}

function applyChildOverrides(obj) {
    const st = requireState();
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new TypeError('applyChildOverrides(obj): obj must be a plain object');
    const allowed = Object.keys(st.sentinels);
    const entries = Object.entries(obj);
    // Validate everything before applying anything (the child dies at preload: fail closed).
    for (const [k, v] of entries) {
        if (keyEq(k, 'NODE_OPTIONS') || keyEq(k, 'PATH') || VITEST_PREFIX_RE.test(k) || CSB_RAIL_PREFIX_RE.test(k) || isEssentialKey(k)) {
            throw new Error(`SAFE-02 applyChildOverrides: refusing to override protected key ${k}`);
        }
        if (!allowed.includes(k)) throw new Error(`SAFE-02 applyChildOverrides: ${k} is not a test/.env.test key`);
        if (typeof v !== 'string') throw new TypeError(`SAFE-02 applyChildOverrides: value for ${k} must be a string`);
    }
    for (const [k, v] of entries) {
        process.env[k] = v;
        ledgerAppend({ kind: 'env-override', target: { key: k } });
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function addRootToState(st, dir) {
    const rec = makeRootRecord(dir);
    const exists = st.protectedRoots.some((r) => r.rootForms.some((f) => rec.rootForms.includes(f)));
    if (!exists) st.protectedRoots.push(rec);
    return rec.root;
}

function addProtectedRoot(dir) {
    const st = requireState();
    const s = toPathString(dir);
    if (!s) throw new TypeError('addProtectedRoot(dir): dir must be a path');
    const abs = path.resolve(s);
    let isDir = false;
    try {
        isDir = ORIG.lstatSync(abs).isDirectory() || fs.statSync(abs).isDirectory();
    } catch {
        isDir = false;
    }
    if (!isDir) throw new Error('addProtectedRoot(dir): not an existing directory: ' + abs);
    return addRootToState(st, abs);
}

function installRails(opts) {
    const mode = opts && opts.mode;
    if (mode !== 'full' && mode !== 'fork') throw new TypeError("installRails({mode}): mode must be 'full' or 'fork'");
    let st = getState();
    let first = false;
    if (!st) {
        st = createState(mode);
        Object.defineProperty(globalThis, STATE_KEY, { value: st, writable: false, configurable: false, enumerable: false });
        first = true;
    }
    if (st.installError) throw new Error('SAFE-02 rails: an earlier install failed (fail closed): ' + st.installError);
    try {
        if (first) {
            addRootToState(st, st.repoRoot);
            ledgerAppend({ kind: 'worker-start', target: { mode, node: process.version, platform: process.platform } });
            if (!(LEDGER_GLOBAL_KEY in globalThis)) {
                Object.defineProperty(globalThis, LEDGER_GLOBAL_KEY, {
                    value: Object.freeze({ append: (entry) => ledgerAppend(entry) }),
                    writable: false,
                    configurable: false,
                    enumerable: false,
                });
            }
        }
        st.mode = strictestMode(st.mode, mode);
        installFsBlocks(st);
        installDbTripwire(st);
        installNet(st);
        loadEnvFiles(st);
        if (first) captureForkShellKeys(st);
        applyEnv(st);
        try {
            Module.syncBuiltinESMExports();
        } catch (err) {
            throw new Error('SAFE-02 rails install failed: syncBuiltinESMExports: ' + (err && err.message));
        }
        st.installCount += 1;
    } catch (err) {
        st.installError = String((err && err.message) || err);
        throw err;
    }
    return railsStatus();
}

function railsStatus() {
    const st = getState();
    if (!st) {
        return { installed: false, mode: null, envInstalled: false, envBlockInstalled: false, dataBlockInstalled: false, dbWrapperInstalled: false, netDenyInstalled: false, dnsDenyInstalled: false, udpDenyInstalled: false, telegramDenyInstalled: false };
    }
    const general = st.netWrappersInstalled && st.mode === 'full';
    const forkShellKeys = {};
    for (const k of FORK_SHELL_KEYS) {
        forkShellKeys[k] = st.mode === 'fork' ? (forkShellValues.has(k) ? 'preserved' : 'absent') : 'scrubbed';
    }
    return {
        installed: st.installCount > 0 && !st.installError,
        installError: st.installError,
        installCount: st.installCount,
        mode: st.mode,
        firstMode: st.firstMode,
        envInstalled: st.envInstalled,
        envBlockInstalled: st.envBlockInstalled,
        dataBlockInstalled: st.dataBlockInstalled,
        dbWrapperInstalled: st.dbWrapperInstalled,
        netDenyInstalled: general,
        dnsDenyInstalled: general,
        udpDenyInstalled: general,
        telegramDenyInstalled: st.netWrappersInstalled,
        repoRoot: st.repoRoot,
        protectedRoots: st.protectedRoots.map((r) => r.root),
        runId: st.runId,
        project: st.project,
        ledgerPath: st.ledgerFile,
        ledgerErrors: st.ledgerErrors,
        forkShellKeys,
    };
}

module.exports = {
    installRails,
    railsStatus,
    addProtectedRoot,
    classifyHost,
    isProtectedDbPath,
    isProtectedDataPath,
    ledgerAppend,
    readLedger,
    applyChildOverrides,
    FORK_SHELL_KEYS,
};
