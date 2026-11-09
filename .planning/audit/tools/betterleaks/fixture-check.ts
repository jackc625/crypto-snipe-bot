// .planning/audit/tools/betterleaks/fixture-check.ts
//
// Phase 22 / Plan 22-02 / NAC-01, AC-35 (D-17 as amended) — executable proof
// that the betterleaks configs in this folder detect what they claim, and the
// committed engine that runs the two-pass known-public classification.
//
// Why this exists (review concern L59@e2e59f6): a custom rule that never
// fires, or an allowlist that suppresses a co-located secret, produces a
// false-clean scan that would authorise the one-way Google Drive upload
// (D-10). Nothing is trusted until it is proven on planted fixtures.
//
// Modes:
//   --bin <betterleaks.exe> --out <FIXTURES.json>
//       Fixture proof. Builds a fixture folder under os.tmpdir() (outside the
//       repo), plants values generated at runtime with crypto.randomBytes,
//       runs the scanner over it once with extended.toml (pass 1), once with
//       known-public.toml (pass 2) and once with public-address.toml (pass 3)
//       using the exact flags a real scan uses, classifies with the same
//       three-pass diff, and writes FIXTURES.json (per-case
//       expected/observed/pass/note, all three config SHA-256s, the exe
//       SHA-256; never a value). Cases:
//         a  PRIVATE_KEY=0x<random 64 hex> in a .ts file -> one evm-private-key hit, non-public
//         b  Hardhat #0 after privateKey: -> known-public
//         c  Hardhat #0 and a random key on ONE line -> random non-public, Hardhat known-public
//         d  TELEGRAM_SESSION=<random base64, 300 chars> -> telegram-string-session, non-public
//         e  random 64 hex with no keyword (tx-hash shape) -> no evm-private-key hit
//         f  case-(a) shape inside a .tar.gz -> found (--max-archive-depth 2)
//         g  keyword-anchored random key inside a SQLite file -> detected true|false recorded
//            (false is the known dir-mode binary gap that the D-22 exact-value check covers)
//         h  default-ruleset Telegram bot token shape -> default-rule hit (useDefault active)
//         i  PRIVATE_KEY=0x + 63 zeros + 1 (test-sentinel shape) -> no hit
//       public-address label (operator ruling "classify-addresses", ESC-SECRET-01):
//         j  random 64 hex after token: -> flagged, every hit non-public (a key is never an address)
//         k  address immediately followed by more alnum after authAddress: -> every hit non-public
//         l  address as the tail of a longer token after token: -> every hit non-public
//         m  exact 0x+40hex after "token" and after "authAddress" (the capture-log
//            JSON shape) -> flagged on both lines, every hit public-address
//         n  one line holding an exact address (token) and a random 64-hex value
//            (apiToken) -> address public-address, 64-hex non-public (the label
//            cannot suppress a co-located secret)
//       plus engine checks: config-prefix, report-fields, redaction (no planted
//       value in any raw report or scanner output), pass-subset (each
//       allowlist only ever removes hits), bytes-scanned.
//       Exit 0 only if every case except (g) passes.
//
//   --scan --bin <exe> --fixtures <FIXTURES.json> --target <name>=<path> [--target ...]
//          --raw-dir <dir outside the repo and outside every target> --out <scan.json>
//          [--meta <json file whose top-level keys are merged into the output>]
//       Real scan. Refuses unless the exe SHA-256 equals TOOL.json and
//       FIXTURES.json, all three config SHA-256s equal the ones FIXTURES.json
//       proved, and FIXTURES.json shows every case except (g) passing. Runs
//       all three passes per target, keeps the raw redacted reports in --raw-dir,
//       and writes metadata only: per hit {rule_id, file, line, column, type,
//       classification}. Exit 0 when there are zero non-public hits, 1 when
//       any non-public hit exists (the caller escalates, D-16), 2 on crash or
//       refusal.
//   --git-fixture / --git-scan (added by 22-26, AC-35): git-history mode with
//       the full-history log-opts, proven on a throwaway fixture repo before
//       every real scan. See the "Git history mode" section below.
//   Flags accept both `--flag value` and `--flag=value`.
//
// Classification (AC-35): hits are keyed on (rule id, file, line, start
// column, end column, commit) and counted as a multiset, so two hits on one
// line are never merged. Key in passes 1, 2 and 3 -> non-public. Pass 1 only
// -> known-public:hardhat-0 (the only thing pass 2 adds is the Hardhat #0
// allowlist). Passes 1 and 2 but not 3 -> public-address (the only thing
// pass 3 adds is an allowlist whose one regex is ^0x[0-9a-fA-F]{40}$ on the
// flagged secret). Every hit stays listed under its label; nothing is dropped.
// A hit in a later pass but not an earlier one is impossible by construction;
// if it ever happens it is reported, counted, and treated as non-public.
//
// Scanner invocation (identical in both modes):
//   betterleaks.exe dir <target> --config <extended.toml|known-public.toml|public-address.toml>
//     --max-archive-depth 2 --redact --no-banner --no-color
//     --report-format json --report-path <temp file>
//     --exit-code 9 --ignore-gitleaks-allow --gitleaks-ignore-path <empty dir>
//   cwd = a fresh empty temp folder; env = a minimal allow-list plus
//   HTTPS_PROXY/HTTP_PROXY=http://127.0.0.1:1 (a belt that redirects
//   library-level HTTP attempts; NOT an enforced network boundary).
//   --exit-code 9 makes "leaks found" distinct from exit 1, which betterleaks
//   also uses for errors and partial scans. --validation,
//   --trust-local-git-config, --unsafe-auto-load-config and --baseline-path
//   are never passed.
//
// Value safety: planted values exist only in memory and in the temp fixture,
// which is deleted at the end. Nothing here prints, logs or writes a value.
// The Hardhat #0 key is public; it is read at runtime from
// test/fork/helpers/realMainnetGate.ts so this file adds no copy of it.
//
// Usage (Node 22.16.0 only, D-21):
//   N22=/c/Users/jackc/AppData/Local/nvm/v22.16.0
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js \
//       .planning/audit/tools/betterleaks/fixture-check.ts \
//       --bin C:/Users/jackc/tools/betterleaks-1.10.0/betterleaks.exe \
//       --out .planning/audit/tools/betterleaks/FIXTURES.json
//
// Exit codes: 0 ok, 1 a case failed / non-public hit found, 2 crash or refusal.
//
// Node built-ins only, plus better-sqlite3 (loaded lazily, only to build the
// case (g) fixture file).

if (process.versions.modules !== '127') {
    console.error(
        `fixture-check: requires Node 22.16.0 (ABI 127); this is Node ${process.version} ` +
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
import * as cp from 'child_process';

// ---------------------------------------------------------------------------
// Constants and paths
// ---------------------------------------------------------------------------

const HERE = __dirname;
const EXTENDED_TOML = path.join(HERE, 'extended.toml');
const KNOWN_PUBLIC_TOML = path.join(HERE, 'known-public.toml');
const PUBLIC_ADDRESS_TOML = path.join(HERE, 'public-address.toml');
const TOOL_JSON = path.join(HERE, 'TOOL.json');
const LEAKS_EXIT = 9;
const KNOWN_PUBLIC = 'known-public:hardhat-0';
const PUBLIC_ADDRESS = 'public-address';
const NON_PUBLIC = 'non-public';
const IGNORE_FILES = ['.betterleaksignore', '.gitleaksignore', '.betterleaks.toml', '.gitleaks.toml'];
const NET_BELT = 'http://127.0.0.1:1';

// The exact non-comment lines public-address.toml may add after the bytes of
// known-public.toml. Anything else (another regex, a paths/stopwords/condition
// key, an unanchored pattern) is refused, so the label can only ever cover a
// secret that is exactly 0x + 40 hex characters.
const PUBLIC_ADDRESS_BLOCK = [
    '[[allowlists]]',
    'description = "public-address: the flagged secret is exactly 0x + 40 hex characters (an EVM address)"',
    'regexTarget = "secret"',
    "regexes = ['''^0x[0-9a-fA-F]{40}$''']",
];

type Classification = typeof KNOWN_PUBLIC | typeof PUBLIC_ADDRESS | typeof NON_PUBLIC;

class Refusal extends Error {}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

function argValues(name: string): string[] {
    const out: string[] = [];
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith(`--${name}=`)) out.push(a.slice(name.length + 3));
        else if (a === `--${name}` && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
            out.push(argv[i + 1]);
            i++;
        }
    }
    return out;
}

function argValue(name: string): string | undefined {
    const v = argValues(name);
    if (v.length > 1) throw new Refusal(`--${name} given more than once`);
    return v[0];
}

function hasFlag(name: string): boolean {
    return process.argv.slice(2).includes(`--${name}`);
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function sha256Buffer(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(p: string): string {
    return sha256Buffer(fs.readFileSync(p));
}

function normSlashes(p: string): string {
    return p.replace(/\\/g, '/');
}

function canon(p: string): string {
    let r = normSlashes(path.resolve(p));
    if (process.platform === 'win32') r = r.toLowerCase();
    return r.replace(/\/+$/, '');
}

function isInside(child: string, parent: string): boolean {
    const c = canon(child);
    const p = canon(parent);
    return c === p || c.startsWith(p + '/');
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
                // not the repo package.json; keep walking
            }
        }
        const up = path.dirname(dir);
        if (up === dir) throw new Refusal('could not find the crypto-snipe-bot repo root above this script');
        dir = up;
    }
}

function mkTemp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTree(p: string): void {
    fs.rmSync(p, { recursive: true, force: true });
}

function randomHex32(): string {
    return crypto.randomBytes(32).toString('hex');
}

function randomTokenChars(n: number): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    const bytes = crypto.randomBytes(n);
    let s = '';
    for (let i = 0; i < n; i++) s += alphabet[bytes[i] % alphabet.length];
    return s;
}

function randomDigits(n: number): string {
    let s = String(1 + crypto.randomInt(9));
    while (s.length < n) s += String(crypto.randomInt(10));
    return s;
}

function shannon(s: string): number {
    const counts = new Map<string, number>();
    for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    let h = 0;
    for (const c of counts.values()) {
        const p = c / s.length;
        h -= p * Math.log2(p);
    }
    return h;
}

// Random hex whose "0x"-prefixed form clears the default ruleset's 3.5
// entropy floor with margin, so a positive/negative case can never pass or
// fail by an unlucky low-entropy draw (a random 40-hex value averages ~3.7).
function randomHexStrong(bytes: number): string {
    for (let i = 0; i < 1000; i++) {
        const h = crypto.randomBytes(bytes).toString('hex');
        if (shannon(`0x${h}`) >= 3.65) return h;
    }
    throw new Error('could not draw a high-entropy fixture value');
}

function randomAlnumLower(n: number): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(n);
    let s = '';
    for (let i = 0; i < n; i++) s += alphabet[bytes[i] % alphabet.length];
    return s;
}

// ---------------------------------------------------------------------------
// Fixture builders: ustar + gzip (Node built-ins), SQLite (better-sqlite3)
// ---------------------------------------------------------------------------

function writeOctal(buf: Buffer, off: number, len: number, val: number): void {
    buf.write(val.toString(8).padStart(len - 1, '0') + '\0', off, len, 'ascii');
}

function tarEntry(name: string, data: Buffer): Buffer {
    if (Buffer.byteLength(name) > 99) throw new Error('tar member name too long');
    const h = Buffer.alloc(512, 0);
    h.write(name, 0, 100, 'utf8');
    writeOctal(h, 100, 8, 0o644);
    writeOctal(h, 108, 8, 0);
    writeOctal(h, 116, 8, 0);
    writeOctal(h, 124, 12, data.length);
    writeOctal(h, 136, 12, Math.floor(Date.now() / 1000));
    h.fill(0x20, 148, 156);
    h.write('0', 156, 1, 'ascii');
    h.write('ustar\0', 257, 6, 'ascii');
    h.write('00', 263, 2, 'ascii');
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    const pad = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
    return Buffer.concat([h, data, pad]);
}

function buildTarGz(entries: { name: string; data: Buffer }[]): Buffer {
    const parts = entries.map((e) => tarEntry(e.name, e.data));
    parts.push(Buffer.alloc(1024, 0));
    return zlib.gzipSync(Buffer.concat(parts));
}

function buildSqlite(file: string, rowText: string): void {
    // Lazy: the native addon is only needed for this one fixture file.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    const db = new Database(file);
    try {
        db.pragma('journal_mode = DELETE');
        db.exec('CREATE TABLE kv (k TEXT NOT NULL, v TEXT NOT NULL)');
        db.prepare('INSERT INTO kv (k, v) VALUES (?, ?)').run('settings', rowText);
    } finally {
        db.close();
    }
    for (const side of ['-journal', '-wal', '-shm']) {
        if (fs.existsSync(file + side)) throw new Error('sqlite fixture left a side file');
    }
}

// ---------------------------------------------------------------------------
// Tool and config integrity
// ---------------------------------------------------------------------------

interface ToolRecord {
    version: string;
    exe_path: string;
    exe_sha256: string;
}

function loadTool(): ToolRecord {
    const t = JSON.parse(fs.readFileSync(TOOL_JSON, 'utf8')) as ToolRecord;
    if (!/^[0-9a-f]{64}$/.test(t.exe_sha256)) throw new Refusal('TOOL.json exe_sha256 is not a SHA-256');
    return t;
}

function verifyExe(bin: string, tool: ToolRecord): string {
    if (!fs.existsSync(bin) || !fs.lstatSync(bin).isFile()) throw new Refusal('--bin is not a regular file');
    const h = sha256File(bin);
    if (h !== tool.exe_sha256) {
        throw new Refusal('the scanner executable SHA-256 differs from TOOL.json exe_sha256; refusing to run it');
    }
    return h;
}

interface ConfigHashes {
    extended: string;
    known_public: string;
    public_address: string;
}

function checkConfigs(): ConfigHashes {
    const ext = fs.readFileSync(EXTENDED_TOML);
    const kp = fs.readFileSync(KNOWN_PUBLIC_TOML);
    const pa = fs.readFileSync(PUBLIC_ADDRESS_TOML);
    const problems: string[] = [];
    if (pa.length <= kp.length || !pa.subarray(0, kp.length).equals(kp)) {
        problems.push('public-address.toml does not start with the exact bytes of known-public.toml');
    }
    const paLines = pa
        .subarray(kp.length)
        .toString('utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('#'));
    if (JSON.stringify(paLines) !== JSON.stringify(PUBLIC_ADDRESS_BLOCK)) {
        problems.push('public-address.toml suffix must be exactly the one anchored 0x+40hex secret allowlist block');
    }
    if (kp.length <= ext.length || !kp.subarray(0, ext.length).equals(ext)) {
        problems.push('known-public.toml does not start with the exact bytes of extended.toml');
    }
    const suffix = kp.subarray(ext.length).toString('utf8');
    if ((suffix.match(/^\[\[allowlists\]\]\s*$/gm) || []).length !== 1) {
        problems.push('known-public.toml suffix must hold exactly one [[allowlists]] block');
    }
    if (/^\s*\[\[rules\]\]/m.test(suffix) || /^\s*\[extend\]/m.test(suffix)) {
        problems.push('known-public.toml suffix must not add rules or extends');
    }
    if (!/^regexTarget\s*=\s*"secret"\s*$/m.test(suffix)) {
        problems.push('known-public.toml allowlist must target the secret explicitly');
    }
    for (const [name, buf] of [['extended.toml', ext], ['known-public.toml', kp], ['public-address.toml', pa]] as const) {
        const text = buf.toString('utf8');
        if (/^\s*(?:pre)?filter\s*=/m.test(text)) {
            problems.push(`${name} sets a top-level filter/prefilter (would replace the default global filter)`);
        }
        if (/[0-9a-fA-F]{64}/.test(text)) problems.push(`${name} holds a contiguous 64-hex run`);
        if (!/^useDefault\s*=\s*true\s*$/m.test(text)) problems.push(`${name} does not extend the default ruleset`);
    }
    if (problems.length) throw new Refusal('config integrity: ' + problems.join('; '));
    return { extended: sha256Buffer(ext), known_public: sha256Buffer(kp), public_address: sha256Buffer(pa) };
}

// ---------------------------------------------------------------------------
// Scanner runner
// ---------------------------------------------------------------------------

interface Finding {
    RuleID: string;
    Description?: string;
    File: string;
    StartLine: number;
    EndLine?: number;
    StartColumn: number;
    EndColumn: number;
    Commit?: string;
    Secret?: string;
    Match?: string;
}

interface ScanRun {
    exitCode: number;
    findings: Finding[];
    bytesScanned: number | null;
    fieldsSeen: string[];
    reportPath: string;
    logText: string;
}

const REQUIRED_FIELDS: [keyof Finding, 'string' | 'number'][] = [
    ['RuleID', 'string'],
    ['File', 'string'],
    ['StartLine', 'number'],
    ['StartColumn', 'number'],
    ['EndColumn', 'number'],
];

function scannerEnv(): NodeJS.ProcessEnv {
    const keep = [
        'SystemRoot', 'windir', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA',
        'HOMEDRIVE', 'HOMEPATH', 'ComSpec', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
    ];
    const env: NodeJS.ProcessEnv = {};
    for (const k of keep) {
        const v = process.env[k];
        if (v !== undefined) env[k] = v;
    }
    env.HTTPS_PROXY = NET_BELT;
    env.HTTP_PROXY = NET_BELT;
    env.ALL_PROXY = NET_BELT;
    env.NO_PROXY = '';
    return env;
}

// 22-26 (AC-35, D-17 amended): the one full-history log-opts string. A custom
// --log-opts REPLACES betterleaks' default scope, so it is restated in full:
// every ref (--all), every reflog entry (--reflog: older stashes, reset/amended
// commits), path-unsimplified history, first-parent diffs of merges (stash
// commits are merges), additions/modifications only (tuxdb = gitleaks default).
const GIT_LOG_OPTS = '--full-history --all --reflog --diff-filter=tuxdb --diff-merges=first-parent';

type ScanKind = 'dir' | 'git';

function scannerArgs(target: string, config: string, reportPath: string, ignoreDir: string, mode: ScanKind = 'dir'): string[] {
    const head = mode === 'git' ? ['git', target, `--log-opts=${GIT_LOG_OPTS}`] : ['dir', target];
    return [
        ...head,
        '--config', config,
        '--max-archive-depth', '2',
        '--redact',
        '--no-banner',
        '--no-color',
        '--report-format', 'json',
        '--report-path', reportPath,
        '--exit-code', String(LEAKS_EXIT),
        '--ignore-gitleaks-allow',
        '--gitleaks-ignore-path', ignoreDir,
    ];
}

const SCANNER_ARGS_TEMPLATE = scannerArgs(
    '<target>',
    '<extended.toml|known-public.toml|public-address.toml>',
    '<report.json>',
    '<empty temp dir>',
);

function assertNoIgnoreFiles(target: string): void {
    const dir = fs.statSync(target).isDirectory() ? target : path.dirname(target);
    for (const n of IGNORE_FILES) {
        if (fs.existsSync(path.join(dir, n))) throw new Refusal(`target folder holds ${n}; refusing (it could suppress findings)`);
    }
}

function runScanner(
    bin: string,
    target: string,
    config: string,
    reportPath: string,
    logPath: string,
    mode: ScanKind = 'dir',
): ScanRun {
    if (fs.existsSync(reportPath)) throw new Refusal('report path already exists; refusing to overwrite');
    assertNoIgnoreFiles(target);
    const cwdDir = mkTemp('csb-bl-cwd-');
    try {
        const r = cp.spawnSync(bin, scannerArgs(target, config, reportPath, cwdDir, mode), {
            cwd: cwdDir,
            env: scannerEnv(),
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            windowsHide: true,
            timeout: 30 * 60 * 1000,
        });
        if (r.error) throw new Error(`scanner did not run: ${r.error.message}`);
        const logText = `${r.stdout ?? ''}${r.stderr ?? ''}`;
        fs.writeFileSync(logPath, logText);
        const exitCode = r.status === null ? -1 : r.status;
        if (fs.readdirSync(cwdDir).length !== 0) throw new Error('scanner wrote into its working folder');
        if (exitCode !== 0 && exitCode !== LEAKS_EXIT) {
            throw new Error(`scanner exit ${exitCode} (error or partial scan); see ${logPath}`);
        }
        if (/partial scan/i.test(logText)) throw new Error(`scanner reported a partial scan; see ${logPath}`);
        if (!fs.existsSync(reportPath)) throw new Error('scanner wrote no report');
        const parsed: unknown = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        if (!Array.isArray(parsed)) throw new Error('report is not a JSON array');
        const fields = new Set<string>();
        const findings: Finding[] = [];
        for (const item of parsed as Record<string, unknown>[]) {
            Object.keys(item).forEach((k) => fields.add(k));
            for (const [k, t] of REQUIRED_FIELDS) {
                if (typeof item[k] !== t) throw new Error(`report finding lacks ${k} (${t}); field names changed`);
            }
            findings.push(item as unknown as Finding);
        }
        if (exitCode === 0 && findings.length !== 0) throw new Error('scanner exit 0 but the report has findings');
        if (exitCode === LEAKS_EXIT && findings.length === 0) throw new Error('scanner exit 9 but the report is empty');
        const m = /scanned ~(\d+) bytes/.exec(logText);
        return {
            exitCode,
            findings,
            bytesScanned: m ? Number(m[1]) : null,
            fieldsSeen: [...fields].sort(),
            reportPath,
            logText,
        };
    } finally {
        rmTree(cwdDir);
    }
}

// ---------------------------------------------------------------------------
// Two-pass classification (AC-35)
// ---------------------------------------------------------------------------

interface ClassifiedHit {
    finding: Finding;
    classification: Classification;
    // set when a later pass reported a hit an earlier pass did not (impossible
    // by construction; reported, counted, and treated as non-public)
    anomaly: '' | 'pass2-only' | 'pass3-only';
}

interface Classified {
    hits: ClassifiedHit[];
    pass2OnlyCount: number;
    pass3OnlyCount: number;
}

function hitKey(f: Finding): string {
    return [f.RuleID, canon(f.File), f.StartLine, f.StartColumn, f.EndColumn, f.Commit ?? ''].join('\u0000');
}

// Per key (a multiset count per pass): n1 = pass 1, n2 = pass 2, n3 = pass 3.
//   non-public             = min(n1, n2, n3)        present in every pass
//   public-address         = min(n1, n2) - non-public  removed only by the pass-3 address allowlist
//   known-public:hardhat-0 = n1 - min(n1, n2)        removed by the pass-2 Hardhat #0 allowlist
// plus anomalies (n2 > n1, n3 > n2), each listed as non-public.
function classify(pass1: Finding[], pass2: Finding[], pass3: Finding[]): Classified {
    const groups = new Map<string, { p1: Finding[]; p2: Finding[]; p3: Finding[] }>();
    const add = (f: Finding, which: 'p1' | 'p2' | 'p3'): void => {
        const k = hitKey(f);
        const g = groups.get(k) ?? { p1: [], p2: [], p3: [] };
        g[which].push(f);
        groups.set(k, g);
    };
    pass1.forEach((f) => add(f, 'p1'));
    pass2.forEach((f) => add(f, 'p2'));
    pass3.forEach((f) => add(f, 'p3'));
    const hits: ClassifiedHit[] = [];
    let pass2OnlyCount = 0;
    let pass3OnlyCount = 0;
    for (const k of [...groups.keys()].sort()) {
        const g = groups.get(k)!;
        const n1 = g.p1.length;
        const n2 = g.p2.length;
        const n3 = g.p3.length;
        const in12 = Math.min(n1, n2);
        const inAll = Math.min(in12, n3);
        for (let i = 0; i < n1; i++) {
            const classification: Classification = i < inAll ? NON_PUBLIC : i < in12 ? PUBLIC_ADDRESS : KNOWN_PUBLIC;
            hits.push({ finding: g.p1[i], classification, anomaly: '' });
        }
        for (let i = n1; i < n2; i++) {
            pass2OnlyCount++;
            hits.push({ finding: g.p2[i], classification: NON_PUBLIC, anomaly: 'pass2-only' });
        }
        for (let i = n2; i < n3; i++) {
            pass3OnlyCount++;
            hits.push({ finding: g.p3[i], classification: NON_PUBLIC, anomaly: 'pass3-only' });
        }
    }
    return { hits, pass2OnlyCount, pass3OnlyCount };
}

function describe(hits: ClassifiedHit[]): string {
    if (hits.length === 0) return 'no hits';
    return hits
        .map((h) => `${h.finding.RuleID}:${h.classification}${h.anomaly ? `:${h.anomaly}` : ''}@L${h.finding.StartLine}C${h.finding.StartColumn}`)
        .join(', ');
}

// ---------------------------------------------------------------------------
// Fixture mode
// ---------------------------------------------------------------------------

interface CaseResult {
    id: string;
    expected: string;
    observed: string;
    pass: boolean;
    note: string;
    detected?: boolean;
}

function readHardhatKey(repo: string): string {
    const src = fs.readFileSync(path.join(repo, 'test', 'fork', 'helpers', 'realMainnetGate.ts'), 'utf8');
    const m = /FORK_ONLY_TEST_KEY\s*=\s*'0x([0-9a-f]{64})'/.exec(src);
    if (!m) throw new Refusal('Hardhat #0 literal (FORK_ONLY_TEST_KEY) not found in realMainnetGate.ts');
    return m[1];
}

function caseOf(file: string): string | null {
    const f = normSlashes(file);
    if (f.includes('/f.tar.gz')) return 'f';
    const m = /\/([a-n])\.(?:ts|sqlite|log)$/.exec(f);
    return m ? m[1] : null;
}

function fixtureMode(bin: string, outPath: string): number {
    const tool = loadTool();
    const exeSha = verifyExe(bin, tool);
    const configSha = checkConfigs();
    const repo = findRepoRoot(HERE);
    const hardhat = readHardhatKey(repo);

    const fx = mkTemp('csb-bl-fixture-');
    const work = mkTemp('csb-bl-work-');
    if (isInside(fx, repo) || isInside(work, repo)) throw new Refusal('temp folders resolved inside the repo');
    const planted: string[] = [];
    const results: CaseResult[] = [];
    try {
        // ---- plant (values never leave memory except into the temp fixture) ----
        const ka = randomHex32();
        const kc = randomHex32();
        const ke = randomHex32();
        const kf = randomHex32();
        const kg = randomHex32();
        const session = crypto.randomBytes(225).toString('base64');
        const botToken = `${randomDigits(10)}:A${randomTokenChars(34)}`;
        // public-address label cases (j-n): fresh values, never printed
        const kj = randomHexStrong(32);
        const ak = randomHexStrong(20);
        const tailK = randomAlnumLower(8);
        const al = randomHexStrong(20);
        const headL = randomAlnumLower(6);
        const am1 = randomHexStrong(20);
        const am2 = randomHexStrong(20);
        const an = randomHexStrong(20);
        const kn = randomHexStrong(32);
        planted.push(ka, kc, ke, kf, kg, session, botToken, botToken.split(':')[1]);
        planted.push(kj, ak, `${ak}${tailK}`, al, `${headL}0x${al}`, am1, am2, an, kn);
        if (session.length !== 300) throw new Error('session fixture length');

        const lineC = `export const accounts = { privateKey: '0x${hardhat}', signer: '0x${kc}' };`;
        const lineN = `{"level":30,"token":"0x${an}","apiToken":"0x${kn}","msg":"quote"}`;
        const files: Record<string, string> = {
            'a.ts': `PRIVATE_KEY=0x${ka}\n`,
            'b.ts': `export const forkAccount = { privateKey: '0x${hardhat}' };\n`,
            'c.ts': `${lineC}\n`,
            'd.ts': `TELEGRAM_SESSION=${session}\n`,
            'e.ts': `export const txHash = '0x${ke}';\n`,
            'h.ts': `TELEGRAM_BOT_TOKEN=${botToken}\n`,
            'i.ts': `PRIVATE_KEY=0x${'0'.repeat(63)}1\n`,
            'j.ts': `export const cfg = { token: '0x${kj}' };\n`,
            'k.ts': `export const cfg = { authAddress: '0x${ak}${tailK}' };\n`,
            'l.ts': `export const cfg = { token: '${headL}0x${al}' };\n`,
            'm.log':
                `{"level":30,"time":1717000000000,"token":"0x${am1}","msg":"pair detected"}\n` +
                `{"level":30,"time":1717000000001,"authAddress":"0x${am2}","msg":"bundle signed"}\n`,
            'n.log': `${lineN}\n`,
        };
        for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(fx, n), c);
        const fInner = Buffer.from(`PRIVATE_KEY=0x${kf}\n`);
        fs.writeFileSync(path.join(fx, 'f.tar.gz'), buildTarGz([{ name: 'inner/f.ts', data: fInner }]));
        const gRow = `PRIVATE_KEY=0x${kg}`;
        buildSqlite(path.join(fx, 'g.sqlite'), gRow);
        const gBytesHold = fs.readFileSync(path.join(fx, 'g.sqlite')).includes(Buffer.from(gRow));
        const gSize = fs.statSync(path.join(fx, 'g.sqlite')).size;
        const textBytes = Object.values(files).reduce((s, c) => s + Buffer.byteLength(c), 0) + fInner.length;

        // ---- three passes, same flags as a real scan ----
        const p1 = runScanner(bin, fx, EXTENDED_TOML, path.join(work, 'pass1.json'), path.join(work, 'pass1.log'));
        const p2 = runScanner(bin, fx, KNOWN_PUBLIC_TOML, path.join(work, 'pass2.json'), path.join(work, 'pass2.log'));
        const p3 = runScanner(bin, fx, PUBLIC_ADDRESS_TOML, path.join(work, 'pass3.json'), path.join(work, 'pass3.log'));
        const { hits, pass2OnlyCount, pass3OnlyCount } = classify(p1.findings, p2.findings, p3.findings);

        const byCase = new Map<string, ClassifiedHit[]>();
        const stray: ClassifiedHit[] = [];
        for (const h of hits) {
            const c = caseOf(h.finding.File);
            if (!c) stray.push(h);
            else byCase.set(c, [...(byCase.get(c) ?? []), h]);
        }
        const of = (id: string): ClassifiedHit[] => byCase.get(id) ?? [];
        const rule = (hs: ClassifiedHit[], r: string): ClassifiedHit[] => hs.filter((h) => h.finding.RuleID === r);
        const others = (hs: ClassifiedHit[], r: string): string => {
            const o = hs.filter((h) => h.finding.RuleID !== r);
            return o.length ? `other-rule hits: ${describe(o)}` : 'no other-rule hits';
        };

        // a
        {
            const hs = of('a');
            const e = rule(hs, 'evm-private-key');
            results.push({
                id: 'a',
                expected: 'exactly one evm-private-key hit, non-public; no known-public hit',
                observed: describe(hs),
                pass: e.length === 1 && e[0].classification === NON_PUBLIC && !hs.some((h) => h.classification === KNOWN_PUBLIC),
                note: others(hs, 'evm-private-key'),
            });
        }
        // b
        {
            const hs = of('b');
            const e = rule(hs, 'evm-private-key');
            results.push({
                id: 'b',
                expected: 'evm-private-key hit(s) on the Hardhat #0 key, every hit known-public, none non-public',
                observed: describe(hs),
                pass: e.length >= 1 && hs.every((h) => h.classification === KNOWN_PUBLIC),
                note: others(hs, 'evm-private-key'),
            });
        }
        // c
        {
            const hs = of('c');
            const pk = lineC.indexOf('privateKey');
            const sg = lineC.indexOf('signer');
            const mid = Math.floor((pk + sg) / 2);
            const hhSide = hs.filter((h) => h.finding.StartColumn <= mid);
            const rndSide = hs.filter((h) => h.finding.StartColumn > mid);
            const eH = rule(hhSide, 'evm-private-key');
            const eR = rule(rndSide, 'evm-private-key');
            const sameLine = hs.every((h) => h.finding.StartLine === 1);
            results.push({
                id: 'c',
                expected:
                    'same line: the Hardhat #0 hit is known-public, the random key is exactly one evm-private-key hit and non-public; ' +
                    'no non-public hit on the Hardhat span and no known-public hit on the random span',
                observed: describe(hs),
                pass:
                    sameLine &&
                    eH.length >= 1 &&
                    hhSide.every((h) => h.classification === KNOWN_PUBLIC) &&
                    eR.length === 1 &&
                    rndSide.every((h) => h.classification === NON_PUBLIC),
                note: `split column ${mid} (privateKey at ${pk}, signer at ${sg}, 0-based); ${others(hs, 'evm-private-key')}`,
            });
        }
        // d
        {
            const hs = of('d');
            const t = rule(hs, 'telegram-string-session');
            results.push({
                id: 'd',
                expected: 'telegram-string-session hit(s), all non-public',
                observed: describe(hs),
                pass: t.length >= 1 && t.every((h) => h.classification === NON_PUBLIC) && !hs.some((h) => h.classification === KNOWN_PUBLIC),
                note: others(hs, 'telegram-string-session'),
            });
        }
        // e
        {
            const hs = of('e');
            const e = rule(hs, 'evm-private-key');
            results.push({
                id: 'e',
                expected: 'no evm-private-key hit on a keyword-less 64-hex value',
                observed: describe(hs),
                pass: e.length === 0,
                note: others(hs, 'evm-private-key'),
            });
        }
        // f
        {
            const hs = of('f');
            const e = rule(hs, 'evm-private-key');
            const files = [...new Set(hs.map((h) => normSlashes(h.finding.File).slice(normSlashes(fx).length)))];
            results.push({
                id: 'f',
                expected: 'exactly one evm-private-key hit inside f.tar.gz, non-public (--max-archive-depth 2)',
                observed: describe(hs),
                pass: e.length === 1 && e[0].classification === NON_PUBLIC,
                note: `reported file(s): ${files.join(' | ') || 'none'}; ${others(hs, 'evm-private-key')}`,
            });
        }
        // g
        {
            const hs = of('g');
            const detected = hs.length > 0;
            results.push({
                id: 'g',
                expected: 'recorded, not required: detected true|false for a keyword-anchored key inside a SQLite file',
                observed: describe(hs),
                pass: detected && hs.every((h) => h.classification === NON_PUBLIC),
                detected,
                note:
                    `fixture bytes hold the row text contiguously: ${gBytesHold}. ` +
                    `bytes scanned (pass 1) ${p1.bytesScanned ?? 'unreported'} vs text fixtures + tar member ${textBytes} ` +
                    `(SQLite file ${gSize} B): ${p1.bytesScanned === textBytes ? 'equal, so the SQLite file contributed zero bytes' : 'NOT equal'}. ` +
                    (detected
                        ? 'dir mode scanned the SQLite file.'
                        : 'not detected: the known dir-mode binary-file gap; the D-22 exact-value check (scripts/nac01-exact-value-check.ts, binary-SQLite self-test case) covers it.'),
            });
        }
        // h
        {
            const hs = of('h');
            const t = rule(hs, 'telegram-bot-api-token');
            results.push({
                id: 'h',
                expected: 'a default-ruleset telegram-bot-api-token hit, non-public (proves useDefault is active)',
                observed: describe(hs),
                pass: t.length >= 1 && t.every((h) => h.classification === NON_PUBLIC),
                note: others(hs, 'telegram-bot-api-token'),
            });
        }
        // i
        {
            const hs = of('i');
            results.push({
                id: 'i',
                expected: 'no hit of any rule on PRIVATE_KEY=0x + 63 zeros + 1',
                observed: describe(hs),
                pass: hs.length === 0,
                note: 'low-entropy sentinel shape used by the 22-05 test env',
            });
        }
        // j, k, l: shapes the public-address label must NOT cover (operator ruling negatives)
        const negative = (id: string, expected: string, note: string): void => {
            const hs = of(id);
            results.push({
                id,
                expected,
                observed: describe(hs),
                pass: hs.length >= 1 && hs.every((h) => h.classification === NON_PUBLIC),
                note: `${note}; rules: ${[...new Set(hs.map((h) => h.finding.RuleID))].join(',') || 'none'}`,
            });
        };
        negative(
            'j',
            'a fresh random 64-hex value after token: is flagged and every hit is non-public (never public-address)',
            'a 64-hex secret is not an address; the anchored {40} regex cannot match it',
        );
        negative(
            'k',
            'an address immediately followed by 8 more alnum characters after authAddress: is flagged and every hit is non-public',
            'proves the end anchor: the flagged secret is longer than 0x+40hex',
        );
        negative(
            'l',
            'an address forming the tail of a longer token after token: is flagged and every hit is non-public',
            'proves the start anchor: the flagged secret has characters before 0x',
        );
        // m: the positive shape, as it appears in the bot capture logs
        {
            const hs = of('m');
            const lines = new Set(hs.map((h) => h.finding.StartLine));
            results.push({
                id: 'm',
                expected:
                    'an exact 0x+40hex value after "token" (line 1) and after "authAddress" (line 2) is flagged on both lines and every hit is public-address',
                observed: describe(hs),
                pass: lines.has(1) && lines.has(2) && hs.every((h) => h.classification === PUBLIC_ADDRESS),
                note: `capture-log JSON shape; rules: ${[...new Set(hs.map((h) => h.finding.RuleID))].join(',') || 'none'}`,
            });
        }
        // n: co-located address and 64-hex secret on one line
        {
            const hs = of('n');
            const split = lineN.indexOf('"apiToken"');
            const addrSide = hs.filter((h) => h.finding.StartColumn <= split);
            const keySide = hs.filter((h) => h.finding.StartColumn > split);
            results.push({
                id: 'n',
                expected:
                    'same line: the exact address (token) is public-address, the random 64-hex value (apiToken) is flagged and non-public; ' +
                    'the address label cannot suppress or relabel a co-located secret',
                observed: describe(hs),
                pass:
                    hs.every((h) => h.finding.StartLine === 1) &&
                    addrSide.length >= 1 &&
                    addrSide.every((h) => h.classification === PUBLIC_ADDRESS) &&
                    keySide.length >= 1 &&
                    keySide.every((h) => h.classification === NON_PUBLIC),
                note: `split column ${split} (0-based index of "apiToken"); rules: ${[...new Set(hs.map((h) => h.finding.RuleID))].join(',') || 'none'}`,
            });
        }

        // ---- engine checks ----
        results.push({
            id: 'config-prefix',
            expected:
                'known-public.toml = extended.toml bytes + one [[allowlists]] block targeting the secret; public-address.toml = known-public.toml bytes + ' +
                'exactly the anchored ^0x[0-9a-fA-F]{40}$ secret allowlist block; no top-level filter; no 64-hex run',
            observed:
                `extended ${configSha.extended.slice(0, 12)}..., known_public ${configSha.known_public.slice(0, 12)}..., ` +
                `public_address ${configSha.public_address.slice(0, 12)}...`,
            pass: true,
            note: 'checked by checkConfigs() before any scanner run',
        });
        const fieldsSeen = [...new Set([...p1.fieldsSeen, ...p2.fieldsSeen, ...p3.fieldsSeen])].sort();
        results.push({
            id: 'report-fields',
            expected: 'every finding has RuleID, File, StartLine, StartColumn, EndColumn',
            observed: `fields seen: ${fieldsSeen.join(',')}`,
            pass: p1.findings.length > 0,
            note: 'gitleaks-format JSON confirmed on the first fixture run',
        });
        const rawBlobs = [p1.reportPath, p2.reportPath, p3.reportPath]
            .map((p) => fs.readFileSync(p, 'utf8'))
            .concat([p1.logText, p2.logText, p3.logText]);
        const leaked = planted.filter((v) => rawBlobs.some((b) => b.includes(v) || b.toLowerCase().includes(v.toLowerCase()))).length;
        const unredacted = [...p1.findings, ...p2.findings, ...p3.findings].filter((f) => f.Secret !== undefined && f.Secret !== 'REDACTED').length;
        results.push({
            id: 'redaction',
            expected: 'no planted value appears in any raw report or scanner output; every Secret field is REDACTED',
            observed: `planted values found in raw output: ${leaked}; non-REDACTED Secret fields: ${unredacted}`,
            pass: leaked === 0 && unredacted === 0,
            note: `${planted.length} planted values checked (never printed)`,
        });
        results.push({
            id: 'pass-subset',
            expected:
                'each allowlist only ever removes hits: zero pass-2-only and zero pass-3-only hits, pass3 <= pass2 <= pass1; no hit outside the case files',
            observed:
                `pass1 ${p1.findings.length}, pass2 ${p2.findings.length}, pass3 ${p3.findings.length}, ` +
                `pass2-only ${pass2OnlyCount}, pass3-only ${pass3OnlyCount}, stray ${stray.length}`,
            pass:
                pass2OnlyCount === 0 &&
                pass3OnlyCount === 0 &&
                stray.length === 0 &&
                p2.findings.length <= p1.findings.length &&
                p3.findings.length <= p2.findings.length,
            note: stray.length ? `stray: ${describe(stray)}` : 'none stray',
        });
        results.push({
            id: 'bytes-scanned',
            expected: 'the scanner reports the same non-zero byte count for all three passes',
            observed: `pass1 ${p1.bytesScanned ?? 'unreported'}, pass2 ${p2.bytesScanned ?? 'unreported'}, pass3 ${p3.bytesScanned ?? 'unreported'}`,
            pass: (p1.bytesScanned ?? 0) > 0 && p1.bytesScanned === p2.bytesScanned && p2.bytesScanned === p3.bytesScanned,
            note: 'parsed from the scanner log line "scanned ~N bytes"',
        });

        const required = results.filter((r) => r.id !== 'g');
        const allPass = required.every((r) => r.pass);
        const doc = {
            tool: 'betterleaks',
            version: tool.version,
            exe_path: normSlashes(bin),
            exe_sha256: exeSha,
            config_sha256: configSha,
            config_relationship:
                'known-public.toml = extended.toml byte-for-byte + one appended [[allowlists]] block (regexTarget secret, Hardhat #0 only); ' +
                'public-address.toml = known-public.toml byte-for-byte + one appended [[allowlists]] block (regexTarget secret, ^0x[0-9a-fA-F]{40}$ only)',
            classification_labels: {
                [NON_PUBLIC]: 'reported by all three passes',
                [KNOWN_PUBLIC]: 'reported by pass 1, removed by the pass-2 Hardhat #0 allowlist',
                [PUBLIC_ADDRESS]:
                    'reported by passes 1 and 2, removed by the pass-3 allowlist: the flagged secret is exactly 0x + 40 hex (operator ruling "classify-addresses", ESC-SECRET-01)',
            },
            scanner_args: SCANNER_ARGS_TEMPLATE,
            scanner_cwd: 'fresh empty os.tmpdir() folder, deleted after each run',
            env_belt: `HTTPS_PROXY=HTTP_PROXY=ALL_PROXY=${NET_BELT} (belt only, not an enforced network boundary)`,
            report_fields_seen: fieldsSeen,
            exit_codes_seen: { pass1: p1.exitCode, pass2: p2.exitCode, pass3: p3.exitCode },
            classification_key: ['rule id', 'file', 'line', 'start column', 'end column', 'commit'],
            generated_at: new Date().toISOString(),
            node: process.version,
            all_pass_except_g: allPass,
            cases: results,
        };
        fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
        for (const r of results) {
            console.log(`CASE ${r.id} ${r.id === 'g' ? `RECORDED detected=${String(r.detected)}` : r.pass ? 'PASS' : 'FAIL'} | ${r.observed}`);
        }
        console.log(`RESULT ${allPass ? 'PASS' : 'FAIL'} (${required.filter((r) => r.pass).length}/${required.length} required)`);
        return allPass ? 0 : 1;
    } finally {
        rmTree(fx);
        rmTree(work);
        if (fs.existsSync(fx) || fs.existsSync(work)) console.error('fixture-check: WARNING temp fixture not fully removed');
    }
}

// ---------------------------------------------------------------------------
// Scan mode
// ---------------------------------------------------------------------------

interface FixturesDoc {
    exe_sha256: string;
    config_sha256: ConfigHashes;
    all_pass_except_g: boolean;
    cases: CaseResult[];
}

// Refuses unless FIXTURES.json was proven with this exact executable and these
// exact three configs, and shows every required case (all but g) passing.
function requireProvenFixtures(fixturesPath: string, exeSha: string, configSha: ConfigHashes): void {
    const fx = JSON.parse(fs.readFileSync(fixturesPath, 'utf8')) as FixturesDoc;
    if (fx.exe_sha256 !== exeSha) throw new Refusal('FIXTURES.json was proven with a different scanner executable');
    if (JSON.stringify(fx.config_sha256) !== JSON.stringify(configSha)) {
        throw new Refusal('config SHA-256s differ from the ones FIXTURES.json proved; re-run the fixture proof first');
    }
    const required = fx.cases.filter((c) => c.id !== 'g');
    if (!fx.all_pass_except_g || required.length < 8 || !required.every((c) => c.pass === true) || fx.cases.length < 9) {
        throw new Refusal('FIXTURES.json does not show every required case passing');
    }
    const mustHave = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'redaction', 'pass-subset', 'bytes-scanned'];
    const ids = new Set(fx.cases.map((c) => c.id));
    const missing = mustHave.filter((id) => !ids.has(id));
    if (missing.length) throw new Refusal(`FIXTURES.json lacks case(s) ${missing.join(',')}; re-run the fixture proof`);
}

function scanMode(bin: string): number {
    const fixturesPath = argValue('fixtures');
    const outPath = argValue('out');
    const rawDir = argValue('raw-dir');
    const metaPath = argValue('meta');
    const targets = argValues('target');
    if (!fixturesPath || !outPath || !rawDir || targets.length === 0) {
        throw new Refusal('--scan needs --fixtures, --out, --raw-dir and at least one --target name=path');
    }
    const tool = loadTool();
    const exeSha = verifyExe(bin, tool);
    const configSha = checkConfigs();
    requireProvenFixtures(fixturesPath, exeSha, configSha);
    const repo = findRepoRoot(HERE);
    const parsedTargets = targets.map((t) => {
        const eq = t.indexOf('=');
        if (eq <= 0) throw new Refusal('--target must be name=path');
        const name = t.slice(0, eq);
        const p = path.resolve(t.slice(eq + 1));
        if (!/^[a-z0-9-]+$/.test(name)) throw new Refusal('--target name must be [a-z0-9-]+');
        if (!fs.existsSync(p)) throw new Refusal(`target ${name} does not exist`);
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink()) throw new Refusal(`target ${name} is a link`);
        const kind = st.isDirectory() ? 'folder' : /\.tar\.gz$/i.test(p) ? 'archive' : 'file';
        if (isInside(p, repo)) throw new Refusal(`target ${name} is inside the repo`);
        return { name, path: p, kind };
    });
    if (new Set(parsedTargets.map((t) => t.name)).size !== parsedTargets.length) throw new Refusal('duplicate --target name');
    const raw = path.resolve(rawDir);
    if (isInside(raw, repo)) throw new Refusal('--raw-dir must be outside the repo');
    for (const t of parsedTargets) {
        if (isInside(raw, t.path) || (t.kind === 'folder' && isInside(t.path, raw))) {
            throw new Refusal(`--raw-dir must be outside target ${t.name}`);
        }
    }
    fs.mkdirSync(raw, { recursive: true });
    let meta: Record<string, unknown> = {};
    if (metaPath) meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outTargets: Record<string, unknown>[] = [];
    const outHits: Record<string, unknown>[] = [];
    for (const t of parsedTargets) {
        const base = path.join(raw, `${t.name}-${stamp}`);
        const p1 = runScanner(bin, t.path, EXTENDED_TOML, `${base}.pass1.json`, `${base}.pass1.log`);
        const p2 = runScanner(bin, t.path, KNOWN_PUBLIC_TOML, `${base}.pass2.json`, `${base}.pass2.log`);
        const p3 = runScanner(bin, t.path, PUBLIC_ADDRESS_TOML, `${base}.pass3.json`, `${base}.pass3.log`);
        if ((p1.bytesScanned ?? 0) <= 0 || (p2.bytesScanned ?? 0) <= 0 || (p3.bytesScanned ?? 0) <= 0) {
            throw new Error(`scanner read no bytes of target ${t.name}`);
        }
        if (p1.bytesScanned !== p2.bytesScanned || p2.bytesScanned !== p3.bytesScanned) {
            throw new Error(`the three passes read different byte counts of target ${t.name}`);
        }
        const { hits, pass2OnlyCount, pass3OnlyCount } = classify(p1.findings, p2.findings, p3.findings);
        const prefix = normSlashes(t.path);
        for (const h of hits) {
            let rel = normSlashes(h.finding.File);
            if (rel.toLowerCase().startsWith(prefix.toLowerCase())) rel = rel.slice(prefix.length);
            rel = rel.replace(/^\/+/, '');
            outHits.push({
                rule_id: h.finding.RuleID,
                file: `${t.name}:${rel}`,
                line: h.finding.StartLine,
                column: h.finding.StartColumn,
                type: h.finding.Description ?? h.finding.RuleID,
                classification: h.classification,
            });
        }
        const targetSha =
            t.kind === 'folder'
                ? fs.existsSync(path.join(t.path, 'MANIFEST.json'))
                    ? { manifest_sha256: sha256File(path.join(t.path, 'MANIFEST.json')) }
                    : { manifest_sha256: null }
                : { file_sha256: sha256File(t.path) };
        outTargets.push({
            name: t.name,
            kind: t.kind,
            path: normSlashes(t.path),
            ...targetSha,
            hit_count: hits.length,
            non_public_count: hits.filter((h) => h.classification === NON_PUBLIC).length,
            known_public_count: hits.filter((h) => h.classification === KNOWN_PUBLIC).length,
            public_address_count: hits.filter((h) => h.classification === PUBLIC_ADDRESS).length,
            pass1_count: p1.findings.length,
            pass2_count: p2.findings.length,
            pass3_count: p3.findings.length,
            pass2_only_count: pass2OnlyCount,
            pass3_only_count: pass3OnlyCount,
            bytes_scanned: { pass1: p1.bytesScanned, pass2: p2.bytesScanned, pass3: p3.bytesScanned },
            raw_reports: [p1.reportPath, p2.reportPath, p3.reportPath].map(normSlashes),
        });
    }
    const nonPublic = outHits.filter((h) => h.classification === NON_PUBLIC).length;
    const computed: Record<string, unknown> = {
        tool: 'betterleaks',
        version: tool.version,
        exe_sha256: exeSha,
        config_sha256: configSha,
        fixtures_pass: true,
        fixtures_sha256: sha256File(fixturesPath),
        scanned_at: new Date().toISOString(),
        node: process.version,
        scanner_args: SCANNER_ARGS_TEMPLATE,
        env_belt: `HTTPS_PROXY=HTTP_PROXY=ALL_PROXY=${NET_BELT} (belt only, not an enforced network boundary)`,
        raw_report_dir: normSlashes(raw),
        targets: outTargets,
        non_public_count: nonPublic,
        known_public_count: outHits.filter((h) => h.classification === KNOWN_PUBLIC).length,
        public_address_count: outHits.filter((h) => h.classification === PUBLIC_ADDRESS).length,
        classification_labels: {
            [NON_PUBLIC]: 'reported by all three passes',
            [KNOWN_PUBLIC]: 'reported by pass 1, removed by the pass-2 Hardhat #0 allowlist',
            [PUBLIC_ADDRESS]:
                'reported by passes 1 and 2, removed by the pass-3 allowlist: the flagged secret is exactly 0x + 40 hex (operator ruling "classify-addresses", ESC-SECRET-01)',
        },
        hits: outHits,
    };
    for (const k of Object.keys(meta)) {
        if (k in computed) throw new Refusal(`--meta key ${k} would override a computed field`);
    }
    const doc = { ...computed, ...meta };
    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
    for (const t of outTargets) {
        console.log(
            `TARGET ${String(t.name)} kind=${String(t.kind)} hits=${String(t.hit_count)} non-public=${String(t.non_public_count)} ` +
                `known-public=${String(t.known_public_count)} public-address=${String(t.public_address_count)}`,
        );
    }
    console.log(`RESULT ${nonPublic === 0 ? 'CLEAN (zero non-public hits)' : `NON-PUBLIC HITS: ${nonPublic}`}`);
    return nonPublic === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Git history mode (22-26, AC-35, D-17 amended)
// ---------------------------------------------------------------------------
//
//   --git-fixture --bin <exe> --fixtures <FIXTURES.json> [--out <json>]
//       Git-mode proof only: builds a throwaway repo under os.tmpdir(), plants
//       random keys (never printed) and runs the three passes in git mode with
//       GIT_LOG_OPTS over it. Exit 0 only if every git case passes.
//   --git-scan --bin <exe> --fixtures <FIXTURES.json> --repo <repo root>
//              --raw-dir <dir outside the repo> --out <history-scan.json> [--meta <json>]
//       Runs the git fixture proof FIRST with the identical scanner arguments
//       and refuses the real scan unless it passes; then scans the repo's full
//       history (three passes), keeps the raw redacted reports in --raw-dir and
//       writes metadata only: per hit {rule_id, file, commit, line, column,
//       type, classification}. Exit 0 zero non-public hits, 1 any non-public
//       hit (the caller escalates, D-16 immediate tier), 2 crash or refusal.
//
// Git cases (fixture repo, commits made with an isolated git config):
//   git-history        a key added in commit A and deleted in commit B is found at A
//   git-reflog         a key in commit C, then `reset --hard` back to B, so C is
//                      reachable only from the reflog (proven with rev-list), is found at C
//   git-stash-reflog   a key in the OLDER of two stashes (stash@{1}; --all reaches only
//                      the refs/stash tip, proven with rev-list) is found at its commit
//   git-ref-no-reflog  a key in commit D reachable only from refs/backup/d, a ref with no
//                      reflog (proven with rev-list), is found at D (this needs --all)
//   git-known-public   Hardhat #0 in commit A -> every hit known-public:hardhat-0
//   git-public-address an exact 0x+40hex after "token" in commit A -> every hit public-address
//   plus git-redaction, git-pass-subset, git-bytes-scanned, git-no-stray and
//   git-temp-clean (the scanner's own temporary git copy is gone after each run).

const BL_GIT_TEMP_PREFIX = 'betterleaks-git-';

function scannerTempLeftovers(): string[] {
    return fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(BL_GIT_TEMP_PREFIX)).sort();
}

function gitRun(cwd: string, args: string[], env: NodeJS.ProcessEnv): string {
    const r = cp.spawnSync('git', args, {
        cwd,
        env,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 256 * 1024 * 1024,
    });
    if (r.error) throw new Error(`git did not run: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`git ${args.filter((a) => !a.startsWith('-c')).slice(0, 2).join(' ')} failed (exit ${r.status})`);
    return r.stdout;
}

// Read-only git env for the real repo: the caller's env minus GIT_* overrides.
function readGitEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_OPTIONAL_LOCKS = '0';
    return env;
}

interface GitRunSet {
    p1: ScanRun;
    p2: ScanRun;
    p3: ScanRun;
    classified: Classified;
    tempLeftovers: string[];
}

function runGitPasses(bin: string, repoPath: string, base: string): GitRunSet {
    const before = scannerTempLeftovers();
    const p1 = runScanner(bin, repoPath, EXTENDED_TOML, `${base}.pass1.json`, `${base}.pass1.log`, 'git');
    const p2 = runScanner(bin, repoPath, KNOWN_PUBLIC_TOML, `${base}.pass2.json`, `${base}.pass2.log`, 'git');
    const p3 = runScanner(bin, repoPath, PUBLIC_ADDRESS_TOML, `${base}.pass3.json`, `${base}.pass3.log`, 'git');
    const after = scannerTempLeftovers();
    const tempLeftovers = after.filter((n) => !before.includes(n));
    for (const f of [...p1.findings, ...p2.findings, ...p3.findings]) {
        if (typeof f.Commit !== 'string' || !/^[0-9a-f]{40}$/.test(f.Commit)) {
            throw new Error('a git-mode finding lacks a 40-hex Commit; report shape changed');
        }
    }
    return { p1, p2, p3, classified: classify(p1.findings, p2.findings, p3.findings), tempLeftovers };
}

interface GitFixtureOutcome {
    pass: boolean;
    history_hit: boolean;
    reflog_hit: boolean;
    stash_reflog_hit: boolean;
    ref_without_reflog_hit: boolean;
    known_public_hit: boolean;
    public_address_hit: boolean;
    reflog_only_proven: boolean;
    stash_only_proven: boolean;
    ref_without_reflog_proven: boolean;
    commits_all: number;
    commits_all_reflog: number;
    pass_counts: { pass1: number; pass2: number; pass3: number; pass2_only: number; pass3_only: number };
    bytes_scanned: { pass1: number | null; pass2: number | null; pass3: number | null };
    cases: CaseResult[];
    log_opts: string;
    generated_at: string;
}

function gitFixture(bin: string): GitFixtureOutcome {
    const repo = findRepoRoot(HERE);
    const hardhat = readHardhatKey(repo);
    const fx = mkTemp('csb-bl-gitfx-');
    const work = mkTemp('csb-bl-gitwork-');
    const hooks = mkTemp('csb-bl-githooks-');
    if ([fx, work, hooks].some((d) => isInside(d, repo))) throw new Refusal('temp folders resolved inside the repo');
    const emptyGlobal = path.join(work, 'empty.gitconfig');
    fs.writeFileSync(emptyGlobal, '');
    const env = readGitEnv();
    env.GIT_CONFIG_NOSYSTEM = '1';
    env.GIT_CONFIG_GLOBAL = emptyGlobal;
    const C = [
        '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
        '-c', 'core.autocrlf=false', '-c', `core.hooksPath=${normSlashes(hooks)}`, '-c', 'init.defaultBranch=main',
    ];
    const g = (...args: string[]): string => gitRun(fx, [...C, ...args], env).trim();
    const results: CaseResult[] = [];
    const planted: string[] = [];
    try {
        const k1 = randomHexStrong(32);
        const k2 = randomHexStrong(32);
        const k3 = randomHexStrong(32);
        const k4 = randomHexStrong(32);
        const addr = randomHexStrong(20);
        planted.push(k1, k2, k3, k4, addr);
        g('init', '-q');
        // commit A: deleted-later key, Hardhat #0, an address, a placeholder for the stash case
        fs.writeFileSync(path.join(fx, 'a.ts'), `PRIVATE_KEY=0x${k1}\n`);
        fs.writeFileSync(path.join(fx, 'h.ts'), `export const forkAccount = { privateKey: '0x${hardhat}' };\n`);
        fs.writeFileSync(path.join(fx, 'm.log'), `{"level":30,"time":1717000000000,"token":"0x${addr}","msg":"pair detected"}\n`);
        fs.writeFileSync(path.join(fx, 's.ts'), 'export const placeholder = 1;\n');
        g('add', '--', 'a.ts', 'h.ts', 'm.log', 's.ts');
        g('commit', '-q', '-m', 'A');
        const shaA = g('rev-parse', 'HEAD');
        // commit B: delete the key file
        g('rm', '-q', '--', 'a.ts');
        g('commit', '-q', '-m', 'B');
        const shaB = g('rev-parse', 'HEAD');
        // commit C: a second key, then reset back so C is reflog-only
        fs.writeFileSync(path.join(fx, 'c.ts'), `PRIVATE_KEY=0x${k2}\n`);
        g('add', '--', 'c.ts');
        g('commit', '-q', '-m', 'C');
        const shaC = g('rev-parse', 'HEAD');
        g('reset', '-q', '--hard', shaB);
        // commit D: a fourth key reachable only from refs/backup/d, a ref that has
        // NO reflog (core.logAllRefUpdates logs only heads/remotes/notes/HEAD),
        // like this repo's refs/backup ref and its tags: needs --all, not --reflog
        fs.writeFileSync(path.join(fx, 'd.ts'), `PRIVATE_KEY=0x${k4}\n`);
        g('add', '--', 'd.ts');
        const treeD = g('write-tree');
        const shaD = g('commit-tree', treeD, '-p', shaB, '-m', 'D');
        g('update-ref', 'refs/backup/d', shaD);
        g('rm', '-q', '--cached', '--', 'd.ts');
        fs.unlinkSync(path.join(fx, 'd.ts'));
        // stash 1 holds a third key; stash 2 (innocuous) pushes it to stash@{1}
        fs.writeFileSync(path.join(fx, 's.ts'), `PRIVATE_KEY=0x${k3}\n`);
        g('stash', 'push', '-q', '-m', 's1');
        const shaS1 = g('rev-parse', 'refs/stash');
        fs.writeFileSync(path.join(fx, 's.ts'), 'export const placeholder = 2;\n');
        g('stash', 'push', '-q', '-m', 's2');
        const shaS2 = g('rev-parse', 'refs/stash');
        const all = new Set(g('rev-list', '--all').split(/\r?\n/).filter(Boolean));
        const allReflog = new Set(g('rev-list', '--all', '--reflog').split(/\r?\n/).filter(Boolean));
        const reflogOnly = !all.has(shaC) && allReflog.has(shaC);
        const stashOnly = shaS1 !== shaS2 && !all.has(shaS1) && allReflog.has(shaS1);
        const reflogAlone = new Set(g('rev-list', '--reflog').split(/\r?\n/).filter(Boolean));
        const noReflogRef = all.has(shaD) && !reflogAlone.has(shaD) && !g('rev-list', 'HEAD').split(/\r?\n/).includes(shaD);
        if (!all.has(shaA) || !all.has(shaB)) throw new Error('git fixture: A/B not reachable from --all');

        const run = runGitPasses(bin, fx, path.join(work, 'gitfx'));
        const hits = run.classified.hits;
        const fileOf = (h: ClassifiedHit): string => normSlashes(h.finding.File).replace(/^\/+/, '');
        const sel = (file: string): ClassifiedHit[] => hits.filter((h) => fileOf(h) === file);
        const desc = (hs: ClassifiedHit[]): string =>
            hs.length === 0
                ? 'no hits'
                : hs.map((h) => `${h.finding.RuleID}:${h.classification}@${(h.finding.Commit ?? '').slice(0, 7)}:L${h.finding.StartLine}C${h.finding.StartColumn}`).join(', ');
        const keyCase = (id: string, file: string, sha: string, what: string, extra: boolean): boolean => {
            const hs = sel(file);
            const ok =
                extra &&
                hs.some((h) => h.finding.RuleID === 'evm-private-key' && h.finding.Commit === sha && h.classification === NON_PUBLIC) &&
                hs.every((h) => h.classification === NON_PUBLIC && h.finding.Commit === sha);
            results.push({ id, expected: what, observed: desc(hs), pass: ok, note: `expected commit ${sha.slice(0, 7)}` });
            return ok;
        };
        const historyHit = keyCase(
            'git-history',
            'a.ts',
            shaA,
            'a random key added in commit A and deleted in commit B: an evm-private-key hit at A, every a.ts hit non-public at A',
            true,
        );
        const reflogHit = keyCase(
            'git-reflog',
            'c.ts',
            shaC,
            'a random key in commit C after reset --hard back to B (C reachable only from the reflog): an evm-private-key hit at C, every c.ts hit non-public',
            reflogOnly,
        );
        const stashHit = keyCase(
            'git-stash-reflog',
            's.ts',
            shaS1,
            'a random key in the older stash (stash@{1}, not reachable from --all): an evm-private-key hit at that stash commit, every s.ts hit non-public',
            stashOnly,
        );
        const refNoReflogHit = keyCase(
            'git-ref-no-reflog',
            'd.ts',
            shaD,
            'a random key in commit D reachable only from refs/backup/d, a ref with no reflog (not from HEAD, not from any reflog): an evm-private-key hit at D, every d.ts hit non-public',
            noReflogRef,
        );
        const hh = sel('h.ts');
        const kpHit = hh.some((h) => h.finding.RuleID === 'evm-private-key') && hh.every((h) => h.classification === KNOWN_PUBLIC);
        results.push({
            id: 'git-known-public',
            expected: 'Hardhat #0 in commit A: an evm-private-key hit, every h.ts hit known-public:hardhat-0',
            observed: desc(hh),
            pass: kpHit,
            note: 'the pass-2 allowlist works in git mode',
        });
        const mh = sel('m.log');
        const paHit = mh.length > 0 && mh.every((h) => h.classification === PUBLIC_ADDRESS);
        results.push({
            id: 'git-public-address',
            expected: 'an exact 0x+40hex after "token" in commit A: flagged, every m.log hit public-address',
            observed: desc(mh),
            pass: paHit,
            note: 'the pass-3 allowlist works in git mode',
        });
        const known = new Set(['a.ts', 'c.ts', 'd.ts', 's.ts', 'h.ts', 'm.log']);
        const stray = hits.filter((h) => !known.has(fileOf(h)));
        results.push({ id: 'git-no-stray', expected: 'no hit outside the six case files', observed: desc(stray), pass: stray.length === 0, note: '' });
        const rawBlobs = [run.p1.reportPath, run.p2.reportPath, run.p3.reportPath]
            .map((p) => fs.readFileSync(p, 'utf8'))
            .concat([run.p1.logText, run.p2.logText, run.p3.logText]);
        const leaked = planted.filter((v) => rawBlobs.some((b) => b.toLowerCase().includes(v.toLowerCase()))).length;
        const unredacted = [...run.p1.findings, ...run.p2.findings, ...run.p3.findings].filter((f) => f.Secret !== 'REDACTED').length;
        results.push({
            id: 'git-redaction',
            expected: 'no planted value in any raw report or scanner output; every Secret field is REDACTED',
            observed: `planted values found in raw output: ${leaked}; non-REDACTED Secret fields: ${unredacted}`,
            pass: leaked === 0 && unredacted === 0,
            note: `${planted.length} planted values checked (never printed)`,
        });
        const { pass2OnlyCount, pass3OnlyCount } = run.classified;
        const n1 = run.p1.findings.length;
        const n2 = run.p2.findings.length;
        const n3 = run.p3.findings.length;
        results.push({
            id: 'git-pass-subset',
            expected: 'each allowlist only removes hits: zero pass-2-only and zero pass-3-only hits, pass3 <= pass2 <= pass1',
            observed: `pass1 ${n1}, pass2 ${n2}, pass3 ${n3}, pass2-only ${pass2OnlyCount}, pass3-only ${pass3OnlyCount}`,
            pass: pass2OnlyCount === 0 && pass3OnlyCount === 0 && n3 <= n2 && n2 <= n1,
            note: '',
        });
        const b = [run.p1.bytesScanned, run.p2.bytesScanned, run.p3.bytesScanned];
        results.push({
            id: 'git-bytes-scanned',
            expected: 'the same non-zero byte count for all three passes',
            observed: `pass1 ${b[0]}, pass2 ${b[1]}, pass3 ${b[2]}`,
            pass: (b[0] ?? 0) > 0 && b[0] === b[1] && b[1] === b[2],
            note: 'parsed from "scanned ~N bytes"',
        });
        results.push({
            id: 'git-temp-clean',
            expected: `no ${BL_GIT_TEMP_PREFIX}* folder left in the temp folder after the three runs`,
            observed: `${run.tempLeftovers.length} left`,
            pass: run.tempLeftovers.length === 0,
            note: 'the scanner copies the git dir to a temp folder for each run',
        });
        return {
            pass: results.every((r) => r.pass),
            history_hit: historyHit,
            reflog_hit: reflogHit,
            stash_reflog_hit: stashHit,
            ref_without_reflog_hit: refNoReflogHit,
            known_public_hit: kpHit,
            public_address_hit: paHit,
            reflog_only_proven: reflogOnly,
            stash_only_proven: stashOnly,
            ref_without_reflog_proven: noReflogRef,
            commits_all: all.size,
            commits_all_reflog: allReflog.size,
            pass_counts: { pass1: n1, pass2: n2, pass3: n3, pass2_only: pass2OnlyCount, pass3_only: pass3OnlyCount },
            bytes_scanned: { pass1: b[0], pass2: b[1], pass3: b[2] },
            cases: results,
            log_opts: GIT_LOG_OPTS,
            generated_at: new Date().toISOString(),
        };
    } finally {
        rmTree(fx);
        rmTree(work);
        rmTree(hooks);
    }
}

function gitFixtureMode(bin: string): number {
    const fixturesPath = argValue('fixtures');
    if (!fixturesPath) throw new Refusal('--git-fixture needs --fixtures');
    const tool = loadTool();
    const exeSha = verifyExe(bin, tool);
    requireProvenFixtures(fixturesPath, exeSha, checkConfigs());
    const out = gitFixture(bin);
    const outPath = argValue('out');
    if (outPath) fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
    for (const c of out.cases) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.id}: ${c.observed}`);
    console.log(`GIT FIXTURE ${out.pass ? 'PASS' : 'FAIL'}`);
    return out.pass ? 0 : 1;
}

function gitScanMode(bin: string): number {
    const fixturesPath = argValue('fixtures');
    const outPath = argValue('out');
    const rawDir = argValue('raw-dir');
    const repoArg = argValue('repo');
    const metaPath = argValue('meta');
    if (!fixturesPath || !outPath || !rawDir || !repoArg) {
        throw new Refusal('--git-scan needs --fixtures, --repo, --raw-dir and --out');
    }
    const tool = loadTool();
    const exeSha = verifyExe(bin, tool);
    const configSha = checkConfigs();
    requireProvenFixtures(fixturesPath, exeSha, configSha);
    const repo = findRepoRoot(HERE);
    const target = path.resolve(repoArg);
    if (canon(target) !== canon(repo)) throw new Refusal('--repo must be exactly this repository root');
    const raw = path.resolve(rawDir);
    if (isInside(raw, repo)) throw new Refusal('--raw-dir must be outside the repo');
    if (fs.existsSync(raw) && fs.readdirSync(raw).length !== 0) throw new Refusal('--raw-dir must be new or empty');
    let meta: Record<string, unknown> = {};
    if (metaPath) meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;

    // 1. git-mode fixture proof with the identical scanner arguments
    const fixture = gitFixture(bin);
    for (const c of fixture.cases) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.id}: ${c.observed}`);
    if (!fixture.pass) throw new Refusal('the git-mode fixture proof failed; the log-opts do not cover what AC-35 needs');

    // 2. the commit universe (read-only git)
    const env = readGitEnv();
    const rg = (...args: string[]): string => gitRun(repo, args, env);
    const headSha = rg('rev-parse', 'HEAD').trim();
    const commitsAll = Number(rg('rev-list', '--all', '--count').trim());
    const commitsAllReflog = Number(rg('rev-list', '--all', '--reflog', '--count').trim());
    const refs = rg('for-each-ref', '--format=%(refname)').split(/\r?\n/).filter(Boolean);
    const stashCount = rg('stash', 'list').split(/\r?\n/).filter(Boolean).length;
    const reflogSet = new Set(rg('rev-list', '--all', '--reflog').split(/\r?\n/).filter(Boolean));
    const gitVersion = rg('--version').trim();

    // 3. the real three passes
    fs.mkdirSync(raw, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const run = runGitPasses(bin, repo, path.join(raw, `history-${stamp}`));
    if ((run.p1.bytesScanned ?? 0) <= 0 || run.p1.bytesScanned !== run.p2.bytesScanned || run.p2.bytesScanned !== run.p3.bytesScanned) {
        throw new Error('the three history passes read zero or different byte counts');
    }
    if (run.tempLeftovers.length) throw new Error(`the scanner left ${run.tempLeftovers.length} temporary git copy folder(s)`);
    const unredacted = [...run.p1.findings, ...run.p2.findings, ...run.p3.findings].filter((f) => f.Secret !== 'REDACTED').length;
    if (unredacted) throw new Error(`${unredacted} finding(s) carry a non-REDACTED Secret field`);
    const outsideUniverse = run.classified.hits.filter((h) => !reflogSet.has(h.finding.Commit ?? '')).length;
    const hits = run.classified.hits.map((h) => ({
        rule_id: h.finding.RuleID,
        file: normSlashes(h.finding.File).replace(/^\/+/, ''),
        commit: h.finding.Commit,
        line: h.finding.StartLine,
        column: h.finding.StartColumn,
        type: h.finding.Description ?? h.finding.RuleID,
        classification: h.classification,
    }));
    const count = (c: Classification): number => hits.filter((h) => h.classification === c).length;
    const nonPublic = count(NON_PUBLIC);
    const computed: Record<string, unknown> = {
        tool: 'betterleaks',
        version: tool.version,
        binary_sha256: exeSha,
        config_sha256: configSha,
        fixtures_sha256: sha256File(fixturesPath),
        engine: '.planning/audit/tools/betterleaks/fixture-check.ts --git-scan (three-pass classification, operator ruling classify-addresses)',
        mode: 'git',
        log_opts: GIT_LOG_OPTS,
        scanner_args: scannerArgs('<repo root>', '<extended.toml|known-public.toml|public-address.toml>', '<report.json>', '<empty temp dir>', 'git'),
        env_belt: `HTTPS_PROXY=HTTP_PROXY=ALL_PROXY=${NET_BELT} (belt only, not an enforced network boundary)`,
        scanned_at: new Date().toISOString(),
        node: process.version,
        git_version: gitVersion,
        git_fixture: fixture,
        head_sha: headSha,
        commits_all: commitsAll,
        commits_all_reflog: commitsAllReflog,
        refs,
        ref_count: refs.length,
        stash_count: stashCount,
        hits_outside_commit_universe: outsideUniverse,
        bytes_scanned: { pass1: run.p1.bytesScanned, pass2: run.p2.bytesScanned, pass3: run.p3.bytesScanned },
        pass_counts: {
            pass1: run.p1.findings.length,
            pass2: run.p2.findings.length,
            pass3: run.p3.findings.length,
            pass2_only: run.classified.pass2OnlyCount,
            pass3_only: run.classified.pass3OnlyCount,
        },
        raw_report_dir: normSlashes(raw),
        raw_reports: [run.p1.reportPath, run.p2.reportPath, run.p3.reportPath].map(normSlashes),
        classification_labels: {
            [NON_PUBLIC]: 'reported by all three passes',
            [KNOWN_PUBLIC]: 'reported by pass 1, removed by the pass-2 Hardhat #0 allowlist',
            [PUBLIC_ADDRESS]:
                'reported by passes 1 and 2, removed by the pass-3 allowlist: the flagged secret is exactly 0x + 40 hex (operator ruling "classify-addresses", ESC-SECRET-01)',
        },
        classification_key: ['rule id', 'file', 'commit', 'line', 'start column', 'end column'],
        hit_counts: {
            total: hits.length,
            [NON_PUBLIC]: nonPublic,
            [KNOWN_PUBLIC]: count(KNOWN_PUBLIC),
            [PUBLIC_ADDRESS]: count(PUBLIC_ADDRESS),
        },
        hits,
    };
    for (const k of Object.keys(meta)) {
        if (k in computed) throw new Refusal(`--meta key ${k} would override a computed field`);
    }
    fs.writeFileSync(outPath, JSON.stringify({ ...computed, ...meta }, null, 2) + '\n');
    console.log(
        `HISTORY commits_all=${commitsAll} commits_all_reflog=${commitsAllReflog} refs=${refs.length} stashes=${stashCount} ` +
            `hits=${hits.length} non-public=${nonPublic} known-public=${count(KNOWN_PUBLIC)} public-address=${count(PUBLIC_ADDRESS)}`,
    );
    console.log(`RESULT ${nonPublic === 0 ? 'CLEAN (zero non-public hits)' : `NON-PUBLIC HITS: ${nonPublic}`}`);
    return nonPublic === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): number {
    const bin = argValue('bin');
    if (!bin) throw new Refusal('--bin <betterleaks.exe> is required');
    if (hasFlag('git-scan')) return gitScanMode(path.resolve(bin));
    if (hasFlag('git-fixture')) return gitFixtureMode(path.resolve(bin));
    if (hasFlag('scan')) return scanMode(path.resolve(bin));
    const out = argValue('out');
    if (!out) throw new Refusal('--out <FIXTURES.json> is required');
    return fixtureMode(path.resolve(bin), path.resolve(out));
}

try {
    process.exitCode = main();
} catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`fixture-check: ${e instanceof Refusal ? 'REFUSED' : 'CRASH'}: ${msg}`);
    process.exitCode = 2;
}
