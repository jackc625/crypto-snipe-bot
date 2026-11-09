'use strict';
// test/rails/selfcheck.cjs
// Phase 22 plan 22-05 Task 1 — plain-Node end-to-end proof of every SAFE-02 setup-layer rail.
//
// Run (Node 22.16.0, VITEST unset — proves no rail depends on VITEST):
//   env -u VITEST -u CSB_RAIL_RUN_ID TELEGRAM_BOT_TOKEN=planted-not-sentinel \
//     node --require ./test/rails/preload.cjs test/rails/selfcheck.cjs
//
// It never touches the real data/ folder or the real .env: every block is proven against a
// FAKE repo root in os.tmpdir() (a package.json named crypto-snipe-bot, a data/ folder with a
// fixture bot.db, and a planted .env), and every network denial against the unroutable
// TEST-NET-1 address 192.0.2.1 or a `.invalid` name. The only real-repo calls are pure
// predicates (isProtectedDbPath / railsStatus). No Vitest, no Hardhat (D-13 / NAC-03).
// Prints one PASS/FAIL line per check (12 checks) and exits 1 on any FAIL.

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const dns = require('dns');
const dgram = require('dgram');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const rails = require('./core.cjs');

const TEST_NET = '192.0.2.1';
const FAST_MS = 3000;
const STATUS0 = rails.railsStatus();
const REPO = STATUS0.repoRoot;

const results = [];
function record(n, name, ok, detail) {
    results.push({ n, name, ok, detail });
    const line = `${ok ? 'PASS' : 'FAIL'} [${String(n).padStart(2, '0')}] ${name}${ok ? '' : ' :: ' + detail}`;
    console.log(line);
}

function findCode(err, code, depth = 0, seen = new Set()) {
    if (!err || typeof err !== 'object' || depth > 8 || seen.has(err)) return false;
    seen.add(err);
    if (err.code === code) return true;
    if (typeof err.message === 'string' && err.message.startsWith(code)) return true;
    const next = [err.cause, err.error, err.info, err.reason, err.originalError, err.innerError];
    if (Array.isArray(err.errors)) next.push(...err.errors);
    return next.some((e) => findCode(e, code, depth + 1, seen));
}

function syncThrows(fn, code) {
    try {
        fn();
    } catch (err) {
        return findCode(err, code) ? null : `threw ${err && err.code} ${err && String(err.message).slice(0, 120)}`;
    }
    return 'did not throw';
}

async function rejects(promiseFn, code) {
    try {
        await promiseFn();
    } catch (err) {
        return findCode(err, code) ? null : `rejected ${err && err.code} ${err && String(err.message).slice(0, 120)}`;
    }
    return 'did not reject';
}

function withTimeout(p, ms, label) {
    let t;
    return Promise.race([
        p.finally(() => clearTimeout(t)),
        new Promise((_, reject) => {
            t = setTimeout(() => reject(new Error(`TIMEOUT ${label} after ${ms}ms`)), ms);
        }),
    ]);
}

// Resolve with the first error a transport emits (or reject if it succeeds/times out).
async function expectDenied(label, start) {
    const t0 = Date.now();
    let err;
    try {
        err = await withTimeout(new Promise((resolve, reject) => start(resolve, reject)), FAST_MS, label);
    } catch (e) {
        return `${label}: ${e.message}`;
    }
    const ms = Date.now() - t0;
    if (!findCode(err, 'E_RAIL_NET_DENIED')) return `${label}: wrong error ${err && err.code} ${err && String(err.message).slice(0, 100)}`;
    if (ms >= FAST_MS) return `${label}: took ${ms}ms`;
    return null;
}

function shaOf(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

// Plain child process WITHOUT the rails (no --require, minimal env): used only to hash and to
// delete the FAKE root, which the rails (correctly) refuse to read or remove in-process.
function plainChild(code, arg) {
    const env = {};
    for (const k of ['SystemRoot', 'SYSTEMROOT', 'PATH', 'Path', 'TEMP', 'TMP', 'TMPDIR']) {
        if (process.env[k] !== undefined) env[k] = process.env[k];
    }
    const r = spawnSync(process.execPath, ['-e', code, arg], { env, encoding: 'utf8', timeout: 30000 });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function entropy(s) {
    const m = {};
    for (const c of s) m[c] = (m[c] || 0) + 1;
    return Object.values(m).reduce((h, n) => h - (n / s.length) * Math.log2(n / s.length), 0);
}

async function main() {
    // ---- Fake root (built BEFORE it is protected) ----
    const stamp = `${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    const fakeRoot = path.join(os.tmpdir(), `csb-rails-fakeroot-${stamp}`);
    const scratch = path.join(os.tmpdir(), `csb-rails-scratch-${stamp}`);
    const fakeData = path.join(fakeRoot, 'data');
    const fixtureDb = path.join(fakeData, 'bot.db');
    const MARKER = `RAIL_SELFCHECK_MARKER_${stamp}`;
    fs.mkdirSync(fakeData, { recursive: true });
    fs.mkdirSync(scratch, { recursive: true });
    fs.writeFileSync(path.join(fakeRoot, 'package.json'), JSON.stringify({ name: 'crypto-snipe-bot', private: true }));
    const fixtureBytes = Buffer.from(`fake bot.db fixture ${stamp}\n`);
    fs.writeFileSync(fixtureDb, fixtureBytes);
    fs.writeFileSync(path.join(fakeRoot, '.env'), `RAIL_SELFCHECK_PLANTED=${MARKER}\n`);
    fs.writeFileSync(path.join(fakeRoot, '.env.local'), `RAIL_SELFCHECK_PLANTED_LOCAL=${MARKER}\n`);
    fs.writeFileSync(path.join(fakeRoot, '.env.example'), 'RAIL_SELFCHECK_EXAMPLE=ok\n');
    const fixtureSha = shaOf(fixtureBytes);
    const protectedFake = rails.addProtectedRoot(fakeRoot);
    const cwd0 = process.cwd();

    try {
        // ---- (1) every component installed, mode full ----
        {
            const s = rails.railsStatus();
            const want = ['installed', 'envInstalled', 'envBlockInstalled', 'dataBlockInstalled', 'dbWrapperInstalled', 'netDenyInstalled', 'dnsDenyInstalled', 'udpDenyInstalled', 'telegramDenyInstalled'];
            const missing = want.filter((k) => s[k] !== true);
            const fsk = JSON.stringify(rails.FORK_SHELL_KEYS);
            const problems = [];
            if (missing.length) problems.push('not installed: ' + missing.join(','));
            if (s.mode !== 'full') problems.push('mode ' + s.mode);
            if (fsk !== '["ETH_FORK_RPC_URL","ALLOW_REAL_MAINNET"]' || !Object.isFrozen(rails.FORK_SHELL_KEYS)) problems.push('FORK_SHELL_KEYS ' + fsk);
            if (process.env.VITEST !== undefined) problems.push('VITEST is set (run with env -u VITEST)');
            record(1, 'railsStatus(): env, .env block, data block, DB wrapper, TCP/DNS deny, UDP deny installed; mode full; VITEST unset', problems.length === 0, problems.join('; '));
        }

        // ---- (2) env scrub + sentinel load; sentinel file shape (key set, small keys, entropy) ----
        {
            const dotenv = require('dotenv');
            const sentinels = dotenv.parse(fs.readFileSync(path.join(REPO, 'test', '.env.test')));
            const example = dotenv.parse(fs.readFileSync(path.join(REPO, '.env.example')));
            const problems = [];
            if (process.env.TELEGRAM_BOT_TOKEN === 'planted-not-sentinel') problems.push('planted TELEGRAM_BOT_TOKEN survived');
            for (const k of ['TELEGRAM_BOT_TOKEN', 'PRIVATE_KEY', 'ETH_RPC_URL']) {
                if (process.env[k] !== sentinels[k]) problems.push(k + ' is not its sentinel');
            }
            const mismatched = Object.keys(sentinels).filter((k) => process.env[k] !== sentinels[k]);
            if (mismatched.length) problems.push('env != sentinel for ' + mismatched.join(','));
            const a = Object.keys(example).sort();
            const b = Object.keys(sentinels).sort();
            const diff = a.filter((x) => !b.includes(x)).concat(b.filter((x) => !a.includes(x)));
            if (diff.length) problems.push('key sets differ: ' + diff.join(','));
            if (!a.includes('ETH_FORK_RPC_URL')) problems.push('.env.example lacks ETH_FORK_RPC_URL');
            const small = /^0x0{62}[0-9a-f]{2}$/;
            const HARDHAT0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
            const badKeys = Object.entries(sentinels)
                .filter(([k, v]) => (/PRIVATE_KEY|AUTH_KEY/.test(k) && !small.test(v)) || (/[0-9a-fA-F]{64}/.test(v) && !small.test(v)) || v.toLowerCase() === HARDHAT0)
                .map(([k]) => k);
            if (badKeys.length) problems.push('non-small private-key sentinel: ' + badKeys.join(','));
            const hi = Object.entries(sentinels)
                .filter(([k, v]) => v && /(TOKEN|SESSION|HASH|SECRET|PASSWORD|AUTH|API_KEY|_KEY$)/.test(k) && !small.test(v) && entropy(v) > 3.0)
                .map(([k]) => k);
            if (hi.length) problems.push('high-entropy sentinel: ' + hi.join(','));
            record(2, `planted TELEGRAM_BOT_TOKEN replaced; PRIVATE_KEY/ETH_RPC_URL and all ${b.length} keys at sentinel; key set == .env.example; small keys; entropy <= 3.0`, problems.length === 0, problems.join('; '));
        }

        // ---- (3) .env block on the fake root (real .env never touched) ----
        {
            const problems = [];
            const envPath = path.join(fakeRoot, '.env');
            const e1 = syncThrows(() => fs.readFileSync(envPath, 'utf8'), 'ENOENT');
            if (e1) problems.push('readFileSync: ' + e1);
            try {
                fs.readFileSync(envPath);
            } catch (err) {
                if (!String(err.message).startsWith('RAIL_ENV_BLOCKED')) problems.push('message prefix: ' + String(err.message).slice(0, 40));
            }
            const e2 = syncThrows(() => fs.openSync(envPath, 'r'), 'ENOENT');
            if (e2) problems.push('openSync: ' + e2);
            const e3 = syncThrows(() => fs.createReadStream(envPath), 'ENOENT');
            if (e3) problems.push('createReadStream: ' + e3);
            const e4 = await rejects(() => fs.promises.readFile(envPath), 'ENOENT');
            if (e4) problems.push('promises.readFile: ' + e4);
            const e5 = await rejects(() => new Promise((res, rej) => fs.readFile(envPath, (err, d) => (err ? rej(err) : res(d)))), 'ENOENT');
            if (e5) problems.push('readFile(cb): ' + e5);
            const e6 = syncThrows(() => fs.readFileSync(path.join(fakeRoot, '.env.local')), 'ENOENT');
            if (e6) problems.push('.env.local: ' + e6);
            if (process.platform === 'win32') {
                const e7 = syncThrows(() => fs.readFileSync(path.join(fakeRoot, '.ENV')), 'ENOENT');
                if (e7) problems.push('.ENV: ' + e7);
            }
            const e8 = syncThrows(() => fs.copyFileSync(envPath, path.join(scratch, 'copied.env')), 'ENOENT');
            if (e8) problems.push('copyFileSync(.env -> elsewhere): ' + e8);
            if (fs.readFileSync(path.join(fakeRoot, '.env.example'), 'utf8').indexOf('RAIL_SELFCHECK_EXAMPLE') === -1) problems.push('.env.example unreadable');
            const dotenv = require('dotenv');
            const r = dotenv.config({ path: envPath, quiet: true });
            if (process.env.RAIL_SELFCHECK_PLANTED !== undefined) problems.push('dotenv injected the planted marker');
            if (r.parsed && Object.values(r.parsed).includes(MARKER)) problems.push('dotenv parsed the marker');
            const kinds = rails.readLedger().filter((x) => x.kind === 'env-read-blocked');
            if (kinds.length === 0) problems.push('no env-read-blocked ledger entry');
            const s = rails.railsStatus();
            if (!s.protectedRoots.includes(REPO)) problems.push('real repo root not protected');
            if (!s.protectedRoots.includes(protectedFake)) problems.push('fake root not protected');
            record(3, '.env / .env.local / .ENV reads (sync, cb, promise, open, stream, copy) and dotenv.config blocked as ENOENT on the fake root; ledgered; repo root protected', problems.length === 0, problems.join('; '));
        }

        // ---- (4) DB tripwire ----
        {
            const problems = [];
            const Database = require('better-sqlite3');
            const tripCases = [
                ['absolute', fixtureDb],
                ['-wal', fixtureDb + '-wal'],
                ['new file in data/', path.join(fakeData, 'new.db')],
                ['file: URI', 'file:' + fixtureDb],
            ];
            for (const [label, p] of tripCases) {
                const e = syncThrows(() => new Database(p), 'RAIL_DB_TRIPWIRE');
                if (e) problems.push(label + ': ' + e);
            }
            process.chdir(fakeRoot);
            try {
                const e = syncThrows(() => new Database(path.join('data', 'bot.db')), 'RAIL_DB_TRIPWIRE');
                if (e) problems.push('relative: ' + e);
                if (process.platform === 'win32') {
                    const e2 = syncThrows(() => new Database(path.join('DATA', 'BOT.DB')), 'RAIL_DB_TRIPWIRE');
                    if (e2) problems.push('upper-cased: ' + e2);
                }
            } finally {
                process.chdir(cwd0);
            }
            const mem = new Database(':memory:');
            mem.exec('CREATE TABLE t (v TEXT)');
            mem.prepare('INSERT INTO t VALUES (?)').run('ok');
            // A string literal that merely mentions the words must not trip.
            mem.exec("INSERT INTO t VALUES ('please ATTACH this AS that; VACUUM INTO nothing')");
            if (mem.prepare('SELECT count(*) AS n FROM t').get().n !== 2) problems.push(':memory: DB broken');
            const attach = [
                ['ATTACH literal into data/', () => mem.exec(`ATTACH DATABASE '${fixtureDb.replace(/'/g, "''")}' AS live`)],
                ['ATTACH non-literal', () => mem.prepare('ATTACH ? AS live')],
                ['VACUUM INTO data/', () => mem.exec(`VACUUM INTO '${path.join(fakeData, 'copy.db').replace(/'/g, "''")}'`)],
            ];
            for (const [label, fn] of attach) {
                const e = syncThrows(fn, 'RAIL_DB_TRIPWIRE');
                if (e) problems.push(label + ': ' + e);
            }
            const e9 = await rejects(() => mem.backup(path.join(fakeData, 'backup.db')), 'RAIL_DB_TRIPWIRE');
            if (e9) problems.push('backup() into data/: ' + e9);
            const tmpDb = path.join(scratch, 'scratch.db');
            const okAttach = path.join(scratch, 'attached.db');
            mem.exec(`ATTACH '${okAttach.replace(/'/g, "''")}' AS side`);
            mem.exec('DETACH side');
            mem.close();
            const fileDb = new Database(tmpDb);
            fileDb.exec('CREATE TABLE t (v INTEGER); INSERT INTO t VALUES (42)');
            fileDb.close();
            const bufDb = new Database(fs.readFileSync(tmpDb));
            if (bufDb.prepare('SELECT v FROM t').get().v !== 42) problems.push('Buffer DB broken');
            bufDb.close();
            const left = fs.readdirSync(fakeData).sort();
            if (JSON.stringify(left) !== '["bot.db"]') problems.push('data/ now holds ' + JSON.stringify(left));
            // Predicates only (no open of the real files).
            const realDb = path.join(REPO, 'data', 'bot.db');
            for (const p of [realDb, realDb + '-wal', process.platform === 'win32' ? realDb.toUpperCase() : realDb]) {
                if (!rails.isProtectedDbPath(p)) problems.push('isProtectedDbPath false for ' + p);
            }
            if (rails.isProtectedDbPath(':memory:') || rails.isProtectedDbPath(tmpDb)) problems.push('isProtectedDbPath true for a safe path');
            record(4, 'RAIL_DB_TRIPWIRE for absolute/relative/upper-cased/-wal/new/file: opens and ATTACH/VACUUM INTO/backup into data/; :memory:, temp-file and Buffer DBs work; data/ untouched; predicates', problems.length === 0, problems.join('; '));
        }

        // ---- (5) loopback stays allowed ----
        {
            const problems = [];
            const server = http.createServer((req, res) => res.end('rail-loopback-ok'));
            await new Promise((r) => server.listen(0, '127.0.0.1', r));
            const port = server.address().port;
            try {
                const body = await withTimeout(
                    new Promise((resolve, reject) => {
                        http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
                            let d = '';
                            res.on('data', (c) => (d += c));
                            res.on('end', () => resolve(d));
                        }).on('error', reject);
                    }),
                    FAST_MS,
                    'http.get loopback',
                );
                if (body !== 'rail-loopback-ok') problems.push('http.get body ' + body);
                const f = await withTimeout(fetch(`http://127.0.0.1:${port}/`).then((r) => r.text()), FAST_MS, 'fetch loopback');
                if (f !== 'rail-loopback-ok') problems.push('fetch body ' + f);
                // Wildcard listen resolves '0.0.0.0' through dns.lookup: must stay allowed.
                const wild = http.createServer((req, res) => res.end('rail-wildcard-ok'));
                await withTimeout(new Promise((r, j) => wild.listen(0, '0.0.0.0', r).on('error', j)), FAST_MS, 'listen 0.0.0.0');
                const w = await withTimeout(fetch(`http://127.0.0.1:${wild.address().port}/`).then((r) => r.text()), FAST_MS, 'fetch wildcard');
                await new Promise((r) => wild.close(r));
                if (w !== 'rail-wildcard-ok') problems.push('wildcard body ' + w);
            } catch (err) {
                problems.push(err.message);
            } finally {
                await new Promise((r) => server.close(r));
            }
            record(5, 'loopback HTTP server on 127.0.0.1:0 answers http.get and fetch', problems.length === 0, problems.join('; '));
        }

        // ---- (6) every transport to a non-loopback address fails fast with E_RAIL_NET_DENIED ----
        {
            const axios = require('axios');
            const WebSocket = require('ws');
            const { ethers } = require('ethers');
            const cases = [
                ['http.get', (ok) => http.get(`http://${TEST_NET}/`).on('error', ok)],
                ['https.get', (ok) => https.get(`https://${TEST_NET}/`).on('error', ok)],
                ['http.get hostname', (ok) => http.get('http://rail-probe.invalid/').on('error', ok)],
                ['fetch http', (ok, bad) => fetch(`http://${TEST_NET}/`).then(() => bad(new Error('fetch resolved')), ok)],
                ['fetch https', (ok, bad) => fetch(`https://${TEST_NET}/`).then(() => bad(new Error('fetch resolved')), ok)],
                ['net.connect', (ok) => net.connect(80, TEST_NET).on('error', ok)],
                ['net.createConnection', (ok) => net.createConnection({ host: TEST_NET, port: 80 }).on('error', ok)],
                ['tls.connect', (ok) => tls.connect({ host: TEST_NET, port: 443, servername: 'rail.invalid' }).on('error', ok)],
                ['axios', (ok, bad) => axios.get(`http://${TEST_NET}/`).then(() => bad(new Error('axios resolved')), ok)],
                ['ws wss', (ok) => {
                    const sock = new WebSocket(`wss://${TEST_NET}`);
                    sock.on('error', ok);
                }],
                ['ethers JsonRpcProvider', (ok, bad) => {
                    const provider = new ethers.JsonRpcProvider(`http://${TEST_NET}`, 1, { staticNetwork: true });
                    provider.getBlockNumber().then(() => bad(new Error('provider resolved')), ok).finally(() => provider.destroy());
                }],
                ['dns.lookup', (ok, bad) => dns.lookup('rail-probe.invalid', (err) => (err ? ok(err) : bad(new Error('lookup resolved'))))],
                ['dns.promises.lookup', (ok, bad) => dns.promises.lookup('rail-probe.invalid').then(() => bad(new Error('resolved')), ok)],
                ['dns.resolve4', (ok, bad) => dns.resolve4('rail-probe.invalid', (err) => (err ? ok(err) : bad(new Error('resolved'))))],
                ['dns.Resolver#resolve4', (ok, bad) => new dns.Resolver().resolve4('rail-probe.invalid', (err) => (err ? ok(err) : bad(new Error('resolved'))))],
                ['dns.promises.resolve4', (ok, bad) => dns.promises.resolve4('rail-probe.invalid').then(() => bad(new Error('resolved')), ok)],
            ];
            const problems = [];
            for (const [label, start] of cases) {
                const p = await expectDenied(label, start);
                if (p) problems.push(p);
            }
            record(6, `${cases.length} transports (http/https/fetch x2/net x2/tls/axios/ws/ethers/dns x5) to 192.0.2.1 or .invalid fail with E_RAIL_NET_DENIED in < 3 s`, problems.length === 0, problems.join('; '));
        }

        // ---- (7) classifyHost ----
        {
            const want = [
                ['api.telegram.org', 'telegram'], ['149.154.167.220', 'telegram'], ['91.108.4.1', 'telegram'],
                ['2001:67c:4e8::1', 'telegram'], ['t.me', 'telegram'],
                ['127.0.0.1', 'loopback'], ['127.8.9.10', 'loopback'], ['::1', 'loopback'], ['[::1]', 'loopback'],
                ['localhost', 'loopback'], ['::ffff:127.0.0.1', 'loopback'],
                [TEST_NET, 'other'], ['example.invalid', 'other'], ['0.0.0.0', 'other'], ['', 'other'],
            ];
            const bad = want.filter(([h, c]) => rails.classifyHost(h, 'full') !== c).map(([h, c]) => `${h}=>${rails.classifyHost(h, 'full')} (want ${c})`);
            record(7, 'classifyHost: telegram for api.telegram.org / 149.154.167.220 (+ ranges), loopback for 127.0.0.1 / ::1 / localhost, other otherwise', bad.length === 0, bad.join('; '));
        }

        // ---- (8) re-install is idempotent and strictest-wins ----
        {
            const problems = [];
            const Database = require('better-sqlite3');
            const before = {
                connect: net.Socket.prototype.connect,
                readFileSync: fs.readFileSync,
                promisesReadFile: fs.promises.readFile,
                lookup: dns.lookup,
                send: dgram.Socket.prototype.send,
            };
            const s = rails.installRails({ mode: 'fork' });
            rails.installRails({ mode: 'full' });
            for (const [k, v] of Object.entries(before)) {
                const now = k === 'connect' ? net.Socket.prototype.connect : k === 'readFileSync' ? fs.readFileSync : k === 'promisesReadFile' ? fs.promises.readFile : k === 'lookup' ? dns.lookup : dgram.Socket.prototype.send;
                if (now !== v) problems.push(k + ' was re-wrapped');
            }
            if (s.mode !== 'full' || !s.netDenyInstalled) problems.push('fork re-install weakened the network deny');
            const e = syncThrows(() => new Database(fixtureDb), 'RAIL_DB_TRIPWIRE');
            if (e) problems.push('DB tripwire after re-install: ' + e);
            const p = await expectDenied('net.connect after re-install', (ok) => net.connect(80, TEST_NET).on('error', ok));
            if (p) problems.push(p);
            const bogus = syncThrows(() => rails.installRails({ mode: 'off' }), 'ERR_RAIL_NEVER');
            if (bogus === 'did not throw') problems.push("installRails({mode:'off'}) accepted");
            if (rails.railsStatus().installCount < 3) problems.push('installCount ' + rails.railsStatus().installCount);
            record(8, "installRails({mode:'fork'}) after full keeps the network deny; wrappers not stacked; invalid mode refused", problems.length === 0, problems.join('; '));
        }

        // ---- (9) ledger kinds + run id ----
        {
            const s = rails.railsStatus();
            const entries = rails.readLedger();
            const kinds = new Set(entries.map((x) => x.kind));
            const need = ['worker-start', 'env-read-blocked', 'db-tripwire', 'net-deny', 'dns-deny', 'net-allow'];
            const missing = need.filter((k) => !kinds.has(k));
            const wrongRun = entries.filter((x) => x.runId !== s.runId).length;
            const wrongPid = entries.filter((x) => x.pid !== process.pid).length;
            const problems = [];
            if (missing.length) problems.push('missing kinds ' + missing.join(','));
            if (wrongRun) problems.push(wrongRun + ' entries with another runId');
            if (wrongPid) problems.push(wrongPid + ' entries with another pid');
            if (s.runId !== 'no-run') problems.push('runId ' + s.runId + ' (expected no-run with CSB_RAIL_RUN_ID unset)');
            const expectFile = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger', s.runId, process.pid + '.jsonl');
            if (s.ledgerPath !== expectFile) problems.push('ledger path ' + s.ledgerPath);
            const leaked = entries.filter((x) => JSON.stringify(x).includes('planted-not-sentinel') || JSON.stringify(x).includes(MARKER)).length;
            if (leaked) problems.push(leaked + ' entries carry an env value');
            record(9, `ledger ${path.basename(s.ledgerPath)} holds worker-start, env-read-blocked, db-tripwire, net-deny, dns-deny, net-allow, all with runId ${s.runId}; no env values`, problems.length === 0, problems.join('; '));
        }

        // ---- (10) data fs block on the fake root ----
        {
            const problems = [];
            const outside = path.join(scratch, 'outside.bin');
            fs.writeFileSync(outside, 'x');
            const syncCases = [
                ['readFileSync', () => fs.readFileSync(fixtureDb)],
                ['createReadStream', () => fs.createReadStream(fixtureDb)],
                ['new fs.ReadStream', () => new fs.ReadStream(fixtureDb)],
                ['openSync', () => fs.openSync(fixtureDb, 'r')],
                ['writeFileSync', () => fs.writeFileSync(path.join(fakeData, 'w.txt'), 'x')],
                ['appendFileSync', () => fs.appendFileSync(fixtureDb, 'x')],
                ['createWriteStream', () => fs.createWriteStream(path.join(fakeData, 'ws.txt'))],
                ['copyFileSync into data/', () => fs.copyFileSync(outside, path.join(fakeData, 'c.bin'))],
                ['copyFileSync out of data/', () => fs.copyFileSync(fixtureDb, path.join(scratch, 'stolen.db'))],
                ['cpSync data/ out', () => fs.cpSync(fakeData, path.join(scratch, 'stolen-dir'), { recursive: true })],
                ['renameSync into data/', () => fs.renameSync(outside, path.join(fakeData, 'r.bin'))],
                ['renameSync out of data/', () => fs.renameSync(fixtureDb, path.join(scratch, 'moved.db'))],
                ['unlinkSync', () => fs.unlinkSync(fixtureDb)],
                ['rmSync file', () => fs.rmSync(fixtureDb)],
                ['rmSync fake root (ancestor)', () => fs.rmSync(fakeRoot, { recursive: true, force: true })],
                ['renameSync fake root (ancestor)', () => fs.renameSync(fakeRoot, fakeRoot + '-moved')],
                ['truncateSync', () => fs.truncateSync(fixtureDb, 0)],
                ['mkdirSync under data/', () => fs.mkdirSync(path.join(fakeData, 'sub'))],
                ['linkSync data/ -> out', () => fs.linkSync(fixtureDb, path.join(scratch, 'hard.db'))],
                ['symlinkSync -> data/', () => fs.symlinkSync(fixtureDb, path.join(scratch, 'soft.db'))],
                ['utimesSync', () => fs.utimesSync(fixtureDb, new Date(0), new Date(0))],
                ['chmodSync', () => fs.chmodSync(fixtureDb, 0o600)],
            ];
            for (const [label, fn] of syncCases) {
                const e = syncThrows(fn, 'RAIL_DATA_TRIPWIRE');
                if (e) problems.push(label + ': ' + e);
            }
            const asyncCases = [
                ['promises.readFile', () => fs.promises.readFile(fixtureDb)],
                ['promises.writeFile', () => fs.promises.writeFile(path.join(fakeData, 'p.txt'), 'x')],
                ['promises.rm', () => fs.promises.rm(fixtureDb)],
                ['readFile(cb)', () => new Promise((res, rej) => fs.readFile(fixtureDb, (err, d) => (err ? rej(err) : res(d))))],
                ['unlink(cb)', () => new Promise((res, rej) => fs.unlink(fixtureDb, (err) => (err ? rej(err) : res())))],
            ];
            for (const [label, fn] of asyncCases) {
                const e = await rejects(fn, 'RAIL_DATA_TRIPWIRE');
                if (e) problems.push(label + ': ' + e);
            }
            try {
                const st = fs.statSync(fixtureDb);
                if (st.size !== fixtureBytes.length) problems.push('statSync size ' + st.size);
                if (!fs.existsSync(fixtureDb)) problems.push('existsSync false');
                fs.lstatSync(fixtureDb);
                fs.accessSync(fixtureDb, fs.constants.F_OK);
                if (JSON.stringify(fs.readdirSync(fakeData)) !== '["bot.db"]') problems.push('readdirSync ' + JSON.stringify(fs.readdirSync(fakeData)));
            } catch (err) {
                problems.push('metadata call threw ' + err.code);
            }
            const h = plainChild("process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))", fixtureDb);
            if (h.status !== 0 || h.stdout.trim() !== fixtureSha) problems.push(`fixture sha changed or unreadable (status ${h.status})`);
            if (!rails.readLedger().some((x) => x.kind === 'data-access-blocked')) problems.push('no data-access-blocked ledger entry');
            record(10, `RAIL_DATA_TRIPWIRE for ${syncCases.length + asyncCases.length} content read/write/copy/rename/delete/link calls into or out of data/ (sync, cb, promise); fixture SHA-256 unchanged; stat/exists/readdir allowed; ledgered`, problems.length === 0, problems.join('; '));
        }

        // ---- (11) UDP ----
        {
            const problems = [];
            const recv = dgram.createSocket('udp4');
            await new Promise((r) => recv.bind(0, '127.0.0.1', r));
            const rport = recv.address().port;
            const got = new Promise((resolve) => recv.once('message', (m) => resolve(m.toString())));
            const sender = dgram.createSocket('udp4');
            try {
                const p = await expectDenied('dgram.send 192.0.2.1:9', (ok, bad) => sender.send(Buffer.from('x'), 9, TEST_NET, (err) => (err ? ok(err) : bad(new Error('sent')))));
                if (p) problems.push(p);
                const c = dgram.createSocket('udp4');
                const p2 = await expectDenied('dgram.connect 192.0.2.1', (ok) => {
                    c.on('error', ok);
                    c.connect(9, TEST_NET);
                });
                if (p2) problems.push(p2);
                c.close();
                sender.send(Buffer.from('rail-udp-ok'), rport, '127.0.0.1');
                const m = await withTimeout(got, FAST_MS, 'loopback udp');
                if (m !== 'rail-udp-ok') problems.push('loopback message ' + m);
            } catch (err) {
                problems.push(err.message);
            } finally {
                sender.close();
                recv.close();
            }
            if (!rails.readLedger().some((x) => x.kind === 'udp-deny')) problems.push('no udp-deny ledger entry');
            record(11, 'dgram udp4 send/connect to 192.0.2.1:9 fail with E_RAIL_NET_DENIED (udp-deny ledgered); a loopback datagram arrives', problems.length === 0, problems.join('; '));
        }

        // ---- (12) applyChildOverrides + run-id capture ----
        {
            const problems = [];
            const s0 = rails.railsStatus();
            rails.applyChildOverrides({ DASHBOARD_API_KEY: '' });
            if (process.env.DASHBOARD_API_KEY !== '') problems.push('override not applied');
            if (!rails.readLedger().some((x) => x.kind === 'env-override' && x.target && x.target.key === 'DASHBOARD_API_KEY')) problems.push('no env-override ledger entry');
            for (const bad of [{ NODE_OPTIONS: '--require x' }, { PATH: 'x' }, { VITEST: 'true' }, { CSB_RAIL_RUN_ID: 'x' }, { NOT_A_KEY: 'x' }, { DASHBOARD_API_KEY: 1 }]) {
                const k = Object.keys(bad)[0];
                try {
                    rails.applyChildOverrides(bad);
                    problems.push(k + ' accepted');
                } catch {
                    /* expected */
                }
            }
            const beforeLog = process.env.LOG_LEVEL;
            try {
                rails.applyChildOverrides({ LOG_LEVEL: 'silent', NODE_OPTIONS: 'x' });
                problems.push('mixed object accepted');
            } catch {
                if (process.env.LOG_LEVEL !== beforeLog) problems.push('mixed object partially applied');
            }
            process.env.CSB_RAIL_RUN_ID = 'run-selfcheck-redirect';
            rails.installRails({ mode: 'full' });
            rails.ledgerAppend({ kind: 'selfcheck-probe', target: 'after-runid-change' });
            const s1 = rails.railsStatus();
            if (s1.runId !== s0.runId || s1.ledgerPath !== s0.ledgerPath) problems.push('ledger moved after CSB_RAIL_RUN_ID change');
            if (!rails.readLedger({ runId: s0.runId }).some((x) => x.kind === 'selfcheck-probe')) problems.push('probe not in original ledger');
            delete process.env.CSB_RAIL_RUN_ID;
            const g = globalThis[Symbol.for('crypto-snipe-bot.railLedger')];
            if (!g || typeof g.append !== 'function') problems.push('railLedger global missing');
            record(12, 'applyChildOverrides applies a test/.env.test key and ledgers env-override; NODE_OPTIONS/PATH/VITEST/CSB_RAIL_RUN_ID/unknown/non-string refused, nothing partially applied; later CSB_RAIL_RUN_ID ignored', problems.length === 0, problems.join('; '));
        }
    } finally {
        process.chdir(cwd0);
        const rm = plainChild("require('fs').rmSync(process.argv[1], { recursive: true, force: true })", fakeRoot);
        if (rm.status !== 0 || fs.existsSync(fakeRoot)) console.log('WARN fake root cleanup failed: ' + fakeRoot);
        try {
            fs.rmSync(scratch, { recursive: true, force: true });
        } catch (err) {
            console.log('WARN scratch cleanup failed: ' + err.message);
        }
    }

    const failed = results.filter((r) => !r.ok).length;
    console.log(`SAFE-02 rails selfcheck: ${results.length - failed}/${results.length} PASS; ledger ${rails.railsStatus().ledgerPath}`);
    process.exit(failed === 0 && results.length === 12 ? 0 : 1);
}

main().catch((err) => {
    console.log('FAIL selfcheck crashed: ' + (err && err.stack));
    process.exit(1);
});
