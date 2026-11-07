// scripts/nac01-exact-value-check.ts
//
// Phase 22 / Plan 22-02 / NAC-01 (D-22) — exact-value check of the backup.
// Proves that no byte sequence in a backup copy (the dated folder and the
// .tar.gz archive) contains any secret VALUE from the env file. The secret
// scanner (betterleaks) cannot do this on its own: it has no rule for a bare
// EVM key and its dir mode may skip binary DB files (RESEARCH.md Q2).
//
// D-22 RULE: ONLY THE OPERATOR RUNS THIS AGAINST THE REAL `.env`, at the 22-03
// human checkpoint, and pastes back only its output lines. No agent runs it
// against the real `.env`, reads `.env`, or sees more than those lines. Agents
// run `--self-test` only, which never touches `.env`.
//
// Secret invariant (pattern: scripts/pause.ts T-20-05): a value is NEVER
// printed, logged, written, returned, or passed as a CLI argument. Neither is
// a match offset or a file name. The env file is parsed with dotenv's `parse`
// (a pure function); dotenv's loader (its config function) is never called
// and nothing is copied into process.env.
//
// Usage (Node 22.16.0 only, D-21):
//   N22=/c/Users/jackc/AppData/Local/nvm/v22.16.0
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js scripts/nac01-exact-value-check.ts \
//       --target C:/Users/jackc/crypto-snipe-bot-backups/2026-11-06 \
//       --target C:/Users/jackc/crypto-snipe-bot-backups/crypto-snipe-bot-state-2026-11-06.tar.gz
//   ... --env-file <path>   (default: <repo>/.env)
//   ... --self-test         (fixtures in os.tmpdir() only; never reads .env)
//   A folder target must hold MANIFEST.json at its root (backup-state.ts
//   layout); an archive target must end in .tar.gz. At most one target of each
//   kind per run, so every output line is unambiguous.
//
// Output, in exactly this form and nothing else:
//   CHECKER sha256=<SHA-256 of this script file's bytes>
//   TARGET folder manifest_sha256=<SHA-256 of the folder's MANIFEST.json>
//   TARGET archive sha256=<SHA-256 of the archive file>
//   <KEY> <folder|archive>: yes|no|unset|too-short      (each D-22 key, each target)
//   ADDITIONAL
//   <KEY> <folder|archive>: yes|no|unset|too-short      (each additional key present in the env file)
//   RESULT: clean|found|incomplete
//
//   yes        the value (or a listed form of it) occurs in that target's bytes
//   no         it does not
//   unset      the key is absent or empty in the env file (nothing to search)
//   too-short  the value has fewer than 8 characters; it is NOT searched and
//              must be ruled on by the operator (never treated as clean)
//
// Keys. D-22 set: PRIVATE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_SESSION,
// TELEGRAM_API_HASH, FLASHBOTS_AUTH_KEY, DASHBOARD_API_KEY. ADDITIONAL (only
// when present in the env file): DEPLOY_PRIVATE_KEY, TEST_WALLET_PRIVATE_KEY,
// BLOXROUTE_AUTH_HEADER, every other key ending _API_KEY, every key ending
// _RPC_URL or _WS_URL, and ALCHEMY_URL (URLs often embed provider keys).
//
// Forms searched per value:
//   - the exact value bytes (UTF-8);
//   - a hex value (optional 0x, 16+ hex digits) case-insensitively, with and
//     without 0x; a 64-hex value (a private key) also as its 32 raw bytes;
//   - a URL value also by each path segment, query value, user name and
//     password of 16+ characters (where provider keys usually sit).
// Folder targets: every regular file's raw bytes (links or special entries
// refuse the run). Archive targets: gunzipped in memory with zlib, and the tar
// bytes are searched (tar stores each member's data contiguously).
//
// Exit codes: 0 clean (every line no or unset), 1 found (any yes),
// 3 incomplete (any too-short and no yes), 2 crash or refused input.
//
// Node built-ins plus dotenv's `parse`; better-sqlite3 is loaded only by the
// self-test, to build its binary-SQLite fixture.

if (process.versions.modules !== '127') {
    console.error(
        `nac01-exact-value-check: requires Node 22.16.0 (ABI 127); this is Node ${process.version} ` +
            `(ABI ${process.versions.modules}). Run it with ` +
            'C:\\Users\\jackc\\AppData\\Local\\nvm\\v22.16.0\\node.exe (D-21).',
    );
    process.exit(1);
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { parse as parseEnvFile } from 'dotenv';

// ---------------------------------------------------------------------------
// Key sets and result enum
// ---------------------------------------------------------------------------

const D22_KEYS = [
    'PRIVATE_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_SESSION',
    'TELEGRAM_API_HASH',
    'FLASHBOTS_AUTH_KEY',
    'DASHBOARD_API_KEY',
] as const;

const NAMED_ADDITIONAL = ['DEPLOY_PRIVATE_KEY', 'TEST_WALLET_PRIVATE_KEY', 'BLOXROUTE_AUTH_HEADER'];
const MIN_VALUE_LENGTH = 8;
const MIN_COMPONENT_LENGTH = 16;

type Result = 'yes' | 'no' | 'unset' | 'too-short';
type Kind = 'folder' | 'archive';

function isAdditionalKey(k: string): boolean {
    if ((D22_KEYS as readonly string[]).includes(k)) return false;
    return (
        NAMED_ADDITIONAL.includes(k) ||
        k.endsWith('_API_KEY') ||
        k.endsWith('_RPC_URL') ||
        k.endsWith('_WS_URL') ||
        k === 'ALCHEMY_URL'
    );
}

class Refusal extends Error {}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function sha256(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function lowerAscii(buf: Buffer): Buffer {
    const out = Buffer.from(buf);
    for (let i = 0; i < out.length; i++) {
        const b = out[i];
        if (b >= 0x41 && b <= 0x5a) out[i] = b + 0x20;
    }
    return out;
}

function findRepoRoot(start: string): string {
    let dir = path.resolve(start);
    for (;;) {
        const pj = path.join(dir, 'package.json');
        if (fs.existsSync(pj)) {
            try {
                const name = (JSON.parse(fs.readFileSync(pj, 'utf8')) as { name?: string }).name;
                if (name === 'crypto-snipe-bot') return dir;
            } catch {
                // keep walking
            }
        }
        const up = path.dirname(dir);
        if (up === dir) throw new Refusal('could not find the repo root above this script');
        dir = up;
    }
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

interface Target {
    kind: Kind;
    hashLine: string;
    blobs: Buffer[];
    lowered: Buffer[] | null;
}

function walkFolder(root: string): Buffer[] {
    const out: Buffer[] = [];
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop()!;
        for (const name of fs.readdirSync(dir)) {
            const p = path.join(dir, name);
            const st = fs.lstatSync(p);
            if (st.isSymbolicLink()) throw new Refusal('a folder target contains a link');
            if (st.isDirectory()) stack.push(p);
            else if (st.isFile()) out.push(fs.readFileSync(p));
            else throw new Refusal('a folder target contains a special entry');
        }
    }
    return out;
}

function loadTarget(p: string): Target {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) throw new Refusal('a target does not exist');
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) throw new Refusal('a target is a link');
    if (st.isDirectory()) {
        const manifest = path.join(abs, 'MANIFEST.json');
        if (!fs.existsSync(manifest) || !fs.lstatSync(manifest).isFile()) {
            throw new Refusal('a folder target has no MANIFEST.json at its root');
        }
        return {
            kind: 'folder',
            hashLine: `TARGET folder manifest_sha256=${sha256(fs.readFileSync(manifest))}`,
            blobs: walkFolder(abs),
            lowered: null,
        };
    }
    if (st.isFile() && /\.tar\.gz$/i.test(abs)) {
        const gz = fs.readFileSync(abs);
        let tar: Buffer;
        try {
            tar = zlib.gunzipSync(gz);
        } catch {
            throw new Refusal('an archive target is not valid gzip');
        }
        return { kind: 'archive', hashLine: `TARGET archive sha256=${sha256(gz)}`, blobs: [tar], lowered: null };
    }
    throw new Refusal('a target is neither a folder nor a .tar.gz archive');
}

// ---------------------------------------------------------------------------
// Needles and search
// ---------------------------------------------------------------------------

interface Needle {
    bytes: Buffer;
    caseInsensitive: boolean;
}

function needlesFor(value: string): Needle[] {
    const out: Needle[] = [{ bytes: Buffer.from(value, 'utf8'), caseInsensitive: false }];
    const hex = /^(?:0x)?([0-9a-fA-F]+)$/.exec(value);
    if (hex && hex[1].length >= 16) {
        const h = hex[1].toLowerCase();
        out.push({ bytes: Buffer.from(h, 'ascii'), caseInsensitive: true });
        out.push({ bytes: Buffer.from('0x' + h, 'ascii'), caseInsensitive: true });
        if (h.length === 64) out.push({ bytes: Buffer.from(h, 'hex'), caseInsensitive: false });
    }
    if (/^(?:https?|wss?):\/\//i.test(value)) {
        try {
            const u = new URL(value);
            const parts = [
                ...u.pathname.split('/'),
                ...[...u.searchParams.values()],
                decodeURIComponent(u.username),
                decodeURIComponent(u.password),
            ];
            for (const part of parts) {
                if (part.length >= MIN_COMPONENT_LENGTH) out.push({ bytes: Buffer.from(part, 'utf8'), caseInsensitive: false });
            }
        } catch {
            // not a parseable URL: the exact-value needle still applies
        }
    }
    return out;
}

function occursIn(t: Target, n: Needle): boolean {
    if (n.caseInsensitive) {
        if (!t.lowered) t.lowered = t.blobs.map(lowerAscii);
        const needle = lowerAscii(n.bytes);
        return t.lowered.some((b) => b.includes(needle));
    }
    return t.blobs.some((b) => b.includes(n.bytes));
}

function resultFor(value: string | undefined, t: Target): Result {
    if (value === undefined || value === '') return 'unset';
    if (value.length < MIN_VALUE_LENGTH) return 'too-short';
    return needlesFor(value).some((n) => occursIn(t, n)) ? 'yes' : 'no';
}

// ---------------------------------------------------------------------------
// Core run (shared by the CLI and the self-test)
// ---------------------------------------------------------------------------

interface RunOutcome {
    code: number;
    lines: string[];
    refusal: string | null;
}

function run(envFile: string, targetPaths: string[]): RunOutcome {
    try {
        if (targetPaths.length === 0) throw new Refusal('at least one --target is required');
        let envBytes: Buffer;
        try {
            envBytes = fs.readFileSync(envFile);
        } catch {
            throw new Refusal('the env file could not be read');
        }
        const env = parseEnvFile(envBytes);
        const targets = targetPaths.map(loadTarget);
        const kinds = targets.map((t) => t.kind);
        if (new Set(kinds).size !== kinds.length) throw new Refusal('at most one folder and one archive target per run');

        const lines: string[] = [];
        lines.push(`CHECKER sha256=${sha256(fs.readFileSync(__filename))}`);
        for (const t of targets) lines.push(t.hashLine);
        const all: Result[] = [];
        const emit = (key: string): void => {
            for (const t of targets) {
                const r = resultFor(env[key], t);
                all.push(r);
                lines.push(`${key} ${t.kind}: ${r}`);
            }
        };
        for (const k of D22_KEYS) emit(k);
        lines.push('ADDITIONAL');
        for (const k of Object.keys(env).filter(isAdditionalKey).sort()) emit(k);
        const found = all.includes('yes');
        const incomplete = all.includes('too-short');
        lines.push(`RESULT: ${found ? 'found' : incomplete ? 'incomplete' : 'clean'}`);
        return { code: found ? 1 : incomplete ? 3 : 0, lines, refusal: null };
    } catch (e) {
        if (e instanceof Refusal) return { code: 2, lines: [], refusal: e.message };
        // Never echo an exception message: it could carry a path or a value.
        const code = (e as NodeJS.ErrnoException).code;
        return { code: 2, lines: [], refusal: `unexpected ${e instanceof Error ? e.name : 'error'}${code ? ` (${code})` : ''}` };
    }
}

// ---------------------------------------------------------------------------
// Self-test (fixtures under os.tmpdir() only; never reads .env)
// ---------------------------------------------------------------------------

function writeOctal(buf: Buffer, off: number, len: number, val: number): void {
    buf.write(val.toString(8).padStart(len - 1, '0') + '\0', off, len, 'ascii');
}

function buildTarGz(entries: { name: string; data: Buffer }[]): Buffer {
    const parts: Buffer[] = [];
    for (const e of entries) {
        const h = Buffer.alloc(512, 0);
        h.write(e.name, 0, 100, 'utf8');
        writeOctal(h, 100, 8, 0o644);
        writeOctal(h, 108, 8, 0);
        writeOctal(h, 116, 8, 0);
        writeOctal(h, 124, 12, e.data.length);
        writeOctal(h, 136, 12, Math.floor(Date.now() / 1000));
        h.fill(0x20, 148, 156);
        h.write('0', 156, 1, 'ascii');
        h.write('ustar\0', 257, 6, 'ascii');
        h.write('00', 263, 2, 'ascii');
        let sum = 0;
        for (const b of h) sum += b;
        h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
        parts.push(h, e.data, Buffer.alloc((512 - (e.data.length % 512)) % 512, 0));
    }
    parts.push(Buffer.alloc(1024, 0));
    return zlib.gzipSync(Buffer.concat(parts));
}

function rnd(n: number): string {
    return crypto.randomBytes(n).toString('base64url');
}

function selfTest(): number {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-nac01-selftest-'));
    const repo = findRepoRoot(__dirname);
    const realEnv = path.join(repo, '.env');
    const results: { name: string; ok: boolean; why: string }[] = [];
    const outputs: string[] = [];
    const planted: string[] = [];
    const check = (name: string, ok: boolean, why: string): void => {
        results.push({ name, ok, why });
    };
    try {
        if (path.resolve(root).toLowerCase().startsWith(path.resolve(repo).toLowerCase())) {
            throw new Refusal('self-test temp folder resolved inside the repo');
        }
        // ---- fixture env (random values; never printed) ----
        const pk = crypto.randomBytes(32).toString('hex');
        const v: Record<string, string> = {
            PRIVATE_KEY: '0x' + pk,
            TELEGRAM_BOT_TOKEN: `7${crypto.randomInt(100000000, 999999999)}:A${rnd(26)}`,
            TELEGRAM_SESSION: '1' + rnd(240),
            TELEGRAM_API_HASH: crypto.randomBytes(16).toString('hex'),
            FLASHBOTS_AUTH_KEY: '0x' + crypto.randomBytes(32).toString('hex'),
            DASHBOARD_API_KEY: rnd(24),
            DEPLOY_PRIVATE_KEY: crypto.randomBytes(32).toString('hex'),
            ETHERSCAN_API_KEY: rnd(24).toUpperCase(),
            ETH_RPC_URL: `https://eth-mainnet.example.invalid/v2/${rnd(24)}`,
        };
        const urlKeyPart = v.ETH_RPC_URL.split('/').pop()!;
        planted.push(...Object.values(v), pk, urlKeyPart);
        const envText = (vals: Record<string, string>, extra = ''): string =>
            Object.entries(vals)
                .map(([k, val]) => `${k}=${val}`)
                .join('\n') + `\nLOG_LEVEL=info\n${extra}`;
        const writeEnv = (name: string, text: string): string => {
            const p = path.join(root, name);
            fs.writeFileSync(p, text);
            if (path.resolve(p).toLowerCase() === realEnv.toLowerCase()) throw new Refusal('self-test env path is the real .env');
            return p;
        };
        const envFull = writeEnv('full.env', envText(v));

        const mkFolder = (name: string, files: Record<string, Buffer | string>): string => {
            const d = path.join(root, name);
            fs.mkdirSync(path.join(d, 'data'), { recursive: true });
            fs.writeFileSync(path.join(d, 'MANIFEST.json'), JSON.stringify({ fixture: name }) + '\n');
            for (const [rel, c] of Object.entries(files)) fs.writeFileSync(path.join(d, rel), c);
            return d;
        };
        const mkArchive = (name: string, files: Record<string, string>): string => {
            const p = path.join(root, name);
            fs.writeFileSync(
                p,
                buildTarGz(Object.entries(files).map(([n, c]) => ({ name: `snapshot/${n}`, data: Buffer.from(c) }))),
            );
            return p;
        };
        const cleanFiles = { 'data/notes.txt': 'nothing secret here\n', 'data/log.jsonl': '{"event":"start"}\n' };
        const runOut = (env: string, targets: string[]): RunOutcome => {
            const r = run(env, targets);
            outputs.push(...r.lines, r.refusal ?? '');
            return r;
        };
        const lineOf = (r: RunOutcome, key: string, kind: Kind): string | undefined =>
            r.lines.find((l) => l.startsWith(`${key} ${kind}: `));
        const valOf = (r: RunOutcome, key: string, kind: Kind): string | undefined => lineOf(r, key, kind)?.split(': ')[1];

        const cleanFolder = mkFolder('clean-folder', cleanFiles);
        const cleanArchive = mkArchive('clean.tar.gz', cleanFiles);

        // 1. planted in the folder -> yes, exit 1 (exact token; private key as bare UPPERCASE hex)
        {
            const f = mkFolder('planted-folder', {
                'data/a.log': `boot ok token=${v.TELEGRAM_BOT_TOKEN} done\n`,
                'data/b.log': `key ${pk.toUpperCase()} end\n`,
            });
            const r = runOut(envFull, [f, cleanArchive]);
            const ok =
                r.code === 1 &&
                valOf(r, 'TELEGRAM_BOT_TOKEN', 'folder') === 'yes' &&
                valOf(r, 'PRIVATE_KEY', 'folder') === 'yes' &&
                valOf(r, 'TELEGRAM_BOT_TOKEN', 'archive') === 'no' &&
                valOf(r, 'DASHBOARD_API_KEY', 'folder') === 'no' &&
                r.lines[r.lines.length - 1] === 'RESULT: found';
            check('planted', ok, `exit ${r.code}`);
        }
        // 2. clean set -> every key line no, exit 0
        {
            const r = runOut(envFull, [cleanFolder, cleanArchive]);
            const keyLines = r.lines.filter((l) => / (?:folder|archive): /.test(l));
            const ok =
                r.code === 0 &&
                keyLines.length > 0 &&
                keyLines.every((l) => l.endsWith(': no')) &&
                r.lines[r.lines.length - 1] === 'RESULT: clean';
            check('clean', ok, `exit ${r.code}, ${keyLines.filter((l) => !l.endsWith(': no')).length} non-no lines`);
        }
        // 3. value only inside the archive -> archive yes, folder no (found only after gunzip)
        {
            const a = mkArchive('planted.tar.gz', { ...cleanFiles, 'data/session.txt': `s=${v.TELEGRAM_SESSION}\n` });
            const gzHolds = fs.readFileSync(a).includes(Buffer.from(v.TELEGRAM_SESSION));
            const r = runOut(envFull, [cleanFolder, a]);
            const ok =
                r.code === 1 &&
                valOf(r, 'TELEGRAM_SESSION', 'archive') === 'yes' &&
                valOf(r, 'TELEGRAM_SESSION', 'folder') === 'no' &&
                !gzHolds;
            check('archive', ok, `exit ${r.code}, compressed bytes hold the value: ${gzHolds}`);
        }
        // 4. value stored in a SQLite file in the folder -> folder yes (binary case);
        //    the private key stored as a 32-byte BLOB is found through its raw-bytes form
        {
            const f = mkFolder('sqlite-folder', cleanFiles);
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const Database = require('better-sqlite3') as typeof import('better-sqlite3');
            const dbFile = path.join(f, 'data', 'fixture.db');
            const db = new Database(dbFile);
            try {
                db.pragma('journal_mode = DELETE');
                db.exec('CREATE TABLE t (k TEXT, v TEXT, b BLOB)');
                db.prepare('INSERT INTO t VALUES (?, ?, ?)').run('api', v.DASHBOARD_API_KEY, Buffer.from(pk, 'hex'));
            } finally {
                db.close();
            }
            const r = runOut(envFull, [f, cleanArchive]);
            const ok =
                r.code === 1 &&
                valOf(r, 'DASHBOARD_API_KEY', 'folder') === 'yes' &&
                valOf(r, 'PRIVATE_KEY', 'folder') === 'yes' &&
                valOf(r, 'DASHBOARD_API_KEY', 'archive') === 'no';
            check('binary-sqlite', ok, `exit ${r.code}`);
        }
        // 5. a 5-character value -> too-short, exit 3, RESULT incomplete
        {
            const envShort = writeEnv('short.env', envText({ ...v, FLASHBOTS_AUTH_KEY: rnd(4).slice(0, 5) }));
            const r = runOut(envShort, [cleanFolder, cleanArchive]);
            const ok =
                r.code === 3 &&
                valOf(r, 'FLASHBOTS_AUTH_KEY', 'folder') === 'too-short' &&
                valOf(r, 'FLASHBOTS_AUTH_KEY', 'archive') === 'too-short' &&
                r.lines[r.lines.length - 1] === 'RESULT: incomplete';
            check('too-short', ok, `exit ${r.code}`);
        }
        // 6. every key has one line per target; enum respected; unset is reported; only credential keys listed
        {
            const noHash = { ...v };
            delete (noHash as Record<string, string | undefined>).TELEGRAM_API_HASH;
            const envNoHash = writeEnv('nohash.env', envText(noHash));
            const r = runOut(envNoHash, [cleanFolder, cleanArchive]);
            const addIdx = r.lines.indexOf('ADDITIONAL');
            const expectKeys = [...D22_KEYS, ...['DEPLOY_PRIVATE_KEY', 'ETHERSCAN_API_KEY', 'ETH_RPC_URL'].sort()];
            const keyLines = r.lines.filter((l) => / (?:folder|archive): /.test(l));
            let ok = addIdx > 0 && keyLines.length === expectKeys.length * 2;
            for (const k of expectKeys) {
                for (const kind of ['folder', 'archive'] as const) {
                    if (r.lines.filter((l) => l.startsWith(`${k} ${kind}: `)).length !== 1) ok = false;
                }
            }
            ok =
                ok &&
                keyLines.every((l) => /: (?:yes|no|unset|too-short)$/.test(l)) &&
                valOf(r, 'TELEGRAM_API_HASH', 'folder') === 'unset' &&
                !r.lines.some((l) => l.startsWith('LOG_LEVEL ')) &&
                r.lines.indexOf(`DEPLOY_PRIVATE_KEY folder: no`) > addIdx &&
                r.code === 0;
            check('per-target', ok, `exit ${r.code}, ${keyLines.length} key lines`);
        }
        // 7. header lines: CHECKER and TARGET hashes are 64-hex and correct
        {
            const r = runOut(envFull, [cleanFolder, cleanArchive]);
            const scriptSha = sha256(fs.readFileSync(__filename));
            const ok =
                r.lines[0] === `CHECKER sha256=${scriptSha}` &&
                /^CHECKER sha256=[0-9a-f]{64}$/.test(r.lines[0]) &&
                r.lines[1] === `TARGET folder manifest_sha256=${sha256(fs.readFileSync(path.join(cleanFolder, 'MANIFEST.json')))}` &&
                r.lines[2] === `TARGET archive sha256=${sha256(fs.readFileSync(cleanArchive))}` &&
                /^TARGET folder manifest_sha256=[0-9a-f]{64}$/.test(r.lines[1]) &&
                /^TARGET archive sha256=[0-9a-f]{64}$/.test(r.lines[2]);
            check('header', ok, 'CHECKER/TARGET lines');
        }
        // 8. a provider key embedded in a URL value is found by its path segment
        {
            const f = mkFolder('url-folder', { 'data/c.log': `rpc key ${urlKeyPart} used\n` });
            const r = runOut(envFull, [f, cleanArchive]);
            check('url-component', r.code === 1 && valOf(r, 'ETH_RPC_URL', 'folder') === 'yes', `exit ${r.code}`);
        }
        // 9. refusals: two targets of one kind; a missing MANIFEST.json
        {
            const r1 = runOut(envFull, [cleanFolder, cleanFolder]);
            const bare = path.join(root, 'bare-folder');
            fs.mkdirSync(bare);
            const r2 = runOut(envFull, [bare]);
            check('refusals', r1.code === 2 && r1.lines.length === 0 && r2.code === 2 && r2.lines.length === 0, `exits ${r1.code}/${r2.code}`);
        }
        // 10. no output line ever holds a value, a fixture file name, or the temp path
        {
            const text = outputs.join('\n');
            const lower = text.toLowerCase();
            const leaks = planted.filter((p) => p && (text.includes(p) || lower.includes(p.toLowerCase()))).length;
            const names = ['a.log', 'b.log', 'c.log', 'session.txt', 'fixture.db', 'notes.txt', 'log.jsonl'].filter((n) => text.includes(n)).length;
            const tmp = lower.includes(path.resolve(root).toLowerCase().replace(/\\/g, '/')) || lower.includes(path.resolve(root).toLowerCase());
            check('no-leak', leaks === 0 && names === 0 && !tmp, `${planted.length} values checked`);
        }
    } catch (e) {
        check('harness', false, e instanceof Refusal ? e.message : `unexpected ${e instanceof Error ? e.name : 'error'}`);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} (${r.why})`);
    const allOk = results.length >= 10 && results.every((r) => r.ok);
    console.log(`SELF-TEST: ${allOk ? 'PASS' : 'FAIL'} (${results.filter((r) => r.ok).length}/${results.length})`);
    return allOk ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValues(name: string): string[] {
    const out: string[] = [];
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith(`--${name}=`)) out.push(a.slice(name.length + 3));
        else if (a === `--${name}` && i + 1 < argv.length) {
            out.push(argv[i + 1]);
            i++;
        }
    }
    return out;
}

function main(): number {
    const argv = process.argv.slice(2);
    if (argv.includes('--self-test')) {
        if (argv.length !== 1) {
            console.error('nac01-exact-value-check: REFUSED: --self-test takes no other arguments');
            return 2;
        }
        return selfTest();
    }
    const envFiles = argValues('env-file');
    if (envFiles.length > 1) {
        console.error('nac01-exact-value-check: REFUSED: --env-file given more than once');
        return 2;
    }
    const envFile = envFiles[0] ?? path.join(findRepoRoot(__dirname), '.env');
    const r = run(envFile, argValues('target'));
    if (r.refusal) {
        console.error(`nac01-exact-value-check: REFUSED: ${r.refusal}`);
        return 2;
    }
    for (const l of r.lines) console.log(l);
    return r.code;
}

try {
    process.exitCode = main();
} catch (e) {
    console.error(`nac01-exact-value-check: CRASH: ${e instanceof Error ? e.name : 'error'}`);
    process.exitCode = 2;
}
