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
//       runs the scanner over it once with extended.toml (pass 1) and once
//       with known-public.toml (pass 2) using the exact flags a real scan
//       uses, classifies with the same two-pass diff, and writes FIXTURES.json
//       (per-case expected/observed/pass/note, both config SHA-256s, the exe
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
//       plus engine checks: config-prefix, report-fields, redaction (no planted
//       value in any raw report or scanner output), pass2-subset (the
//       allowlist only ever removes hits), bytes-scanned.
//       Exit 0 only if every case except (g) passes.
//
//   --scan --bin <exe> --fixtures <FIXTURES.json> --target <name>=<path> [--target ...]
//          --raw-dir <dir outside the repo and outside every target> --out <scan.json>
//          [--meta <json file whose top-level keys are merged into the output>]
//       Real scan. Refuses unless the exe SHA-256 equals TOOL.json and
//       FIXTURES.json, both config SHA-256s equal the ones FIXTURES.json
//       proved, and FIXTURES.json shows every case except (g) passing. Runs
//       both passes per target, keeps the raw redacted reports in --raw-dir,
//       and writes metadata only: per hit {rule_id, file, line, column, type,
//       classification}. Exit 0 when there are zero non-public hits, 1 when
//       any non-public hit exists (the caller escalates, D-16), 2 on crash or
//       refusal.
//   Flags accept both `--flag value` and `--flag=value`.
//
// Classification (AC-35): hits are keyed on (rule id, file, line, start
// column, end column, commit) and counted as a multiset, so two hits on one
// line are never merged. Key in pass 1 and pass 2 -> non-public. Pass 1 only
// -> known-public:hardhat-0 (the only thing pass 2 adds is the Hardhat #0
// allowlist). Pass 2 only is impossible by construction; if it ever happens it
// is reported, counted, and treated as non-public.
//
// Scanner invocation (identical in both modes):
//   betterleaks.exe dir <target> --config <extended.toml|known-public.toml>
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
const TOOL_JSON = path.join(HERE, 'TOOL.json');
const LEAKS_EXIT = 9;
const KNOWN_PUBLIC = 'known-public:hardhat-0';
const NON_PUBLIC = 'non-public';
const IGNORE_FILES = ['.betterleaksignore', '.gitleaksignore', '.betterleaks.toml', '.gitleaks.toml'];
const NET_BELT = 'http://127.0.0.1:1';

type Classification = typeof KNOWN_PUBLIC | typeof NON_PUBLIC;

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
}

function checkConfigs(): ConfigHashes {
    const ext = fs.readFileSync(EXTENDED_TOML);
    const kp = fs.readFileSync(KNOWN_PUBLIC_TOML);
    const problems: string[] = [];
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
    for (const [name, buf] of [['extended.toml', ext], ['known-public.toml', kp]] as const) {
        const text = buf.toString('utf8');
        if (/^\s*(?:pre)?filter\s*=/m.test(text)) {
            problems.push(`${name} sets a top-level filter/prefilter (would replace the default global filter)`);
        }
        if (/[0-9a-fA-F]{64}/.test(text)) problems.push(`${name} holds a contiguous 64-hex run`);
        if (!/^useDefault\s*=\s*true\s*$/m.test(text)) problems.push(`${name} does not extend the default ruleset`);
    }
    if (problems.length) throw new Refusal('config integrity: ' + problems.join('; '));
    return { extended: sha256Buffer(ext), known_public: sha256Buffer(kp) };
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

function scannerArgs(target: string, config: string, reportPath: string, ignoreDir: string): string[] {
    return [
        'dir', target,
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

const SCANNER_ARGS_TEMPLATE = scannerArgs('<target>', '<extended.toml|known-public.toml>', '<report.json>', '<empty temp dir>');

function assertNoIgnoreFiles(target: string): void {
    const dir = fs.statSync(target).isDirectory() ? target : path.dirname(target);
    for (const n of IGNORE_FILES) {
        if (fs.existsSync(path.join(dir, n))) throw new Refusal(`target folder holds ${n}; refusing (it could suppress findings)`);
    }
}

function runScanner(bin: string, target: string, config: string, reportPath: string, logPath: string): ScanRun {
    if (fs.existsSync(reportPath)) throw new Refusal('report path already exists; refusing to overwrite');
    assertNoIgnoreFiles(target);
    const cwdDir = mkTemp('csb-bl-cwd-');
    try {
        const r = cp.spawnSync(bin, scannerArgs(target, config, reportPath, cwdDir), {
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
    pass2Only: boolean;
}

function hitKey(f: Finding): string {
    return [f.RuleID, canon(f.File), f.StartLine, f.StartColumn, f.EndColumn, f.Commit ?? ''].join('\u0000');
}

function classify(pass1: Finding[], pass2: Finding[]): { hits: ClassifiedHit[]; pass2OnlyCount: number } {
    const groups = new Map<string, { p1: Finding[]; n2: number; p2: Finding[] }>();
    for (const f of pass1) {
        const k = hitKey(f);
        const g = groups.get(k) ?? { p1: [], n2: 0, p2: [] };
        g.p1.push(f);
        groups.set(k, g);
    }
    for (const f of pass2) {
        const k = hitKey(f);
        const g = groups.get(k) ?? { p1: [], n2: 0, p2: [] };
        g.n2++;
        g.p2.push(f);
        groups.set(k, g);
    }
    const hits: ClassifiedHit[] = [];
    let pass2OnlyCount = 0;
    for (const k of [...groups.keys()].sort()) {
        const g = groups.get(k)!;
        const both = Math.min(g.p1.length, g.n2);
        for (let i = 0; i < g.p1.length; i++) {
            hits.push({ finding: g.p1[i], classification: i < both ? NON_PUBLIC : KNOWN_PUBLIC, pass2Only: false });
        }
        for (let i = g.p1.length; i < g.n2; i++) {
            pass2OnlyCount++;
            hits.push({ finding: g.p2[i], classification: NON_PUBLIC, pass2Only: true });
        }
    }
    return { hits, pass2OnlyCount };
}

function describe(hits: ClassifiedHit[]): string {
    if (hits.length === 0) return 'no hits';
    return hits
        .map((h) => `${h.finding.RuleID}:${h.classification}${h.pass2Only ? ':pass2-only' : ''}@L${h.finding.StartLine}C${h.finding.StartColumn}`)
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
    const m = /\/([a-i])\.(?:ts|sqlite)$/.exec(f);
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
        planted.push(ka, kc, ke, kf, kg, session, botToken, botToken.split(':')[1]);
        if (session.length !== 300) throw new Error('session fixture length');

        const lineC = `export const accounts = { privateKey: '0x${hardhat}', signer: '0x${kc}' };`;
        const files: Record<string, string> = {
            'a.ts': `PRIVATE_KEY=0x${ka}\n`,
            'b.ts': `export const forkAccount = { privateKey: '0x${hardhat}' };\n`,
            'c.ts': `${lineC}\n`,
            'd.ts': `TELEGRAM_SESSION=${session}\n`,
            'e.ts': `export const txHash = '0x${ke}';\n`,
            'h.ts': `TELEGRAM_BOT_TOKEN=${botToken}\n`,
            'i.ts': `PRIVATE_KEY=0x${'0'.repeat(63)}1\n`,
        };
        for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(fx, n), c);
        fs.writeFileSync(
            path.join(fx, 'f.tar.gz'),
            buildTarGz([{ name: 'inner/f.ts', data: Buffer.from(`PRIVATE_KEY=0x${kf}\n`) }]),
        );
        const gRow = `PRIVATE_KEY=0x${kg}`;
        buildSqlite(path.join(fx, 'g.sqlite'), gRow);
        const gBytesHold = fs.readFileSync(path.join(fx, 'g.sqlite')).includes(Buffer.from(gRow));

        // ---- two passes, same flags as a real scan ----
        const p1 = runScanner(bin, fx, EXTENDED_TOML, path.join(work, 'pass1.json'), path.join(work, 'pass1.log'));
        const p2 = runScanner(bin, fx, KNOWN_PUBLIC_TOML, path.join(work, 'pass2.json'), path.join(work, 'pass2.log'));
        const { hits, pass2OnlyCount } = classify(p1.findings, p2.findings);

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

        // ---- engine checks ----
        results.push({
            id: 'config-prefix',
            expected: 'known-public.toml = extended.toml bytes + one [[allowlists]] block targeting the secret; no top-level filter; no 64-hex run',
            observed: `extended ${configSha.extended.slice(0, 12)}..., known_public ${configSha.known_public.slice(0, 12)}...`,
            pass: true,
            note: 'checked by checkConfigs() before any scanner run',
        });
        const fieldsSeen = [...new Set([...p1.fieldsSeen, ...p2.fieldsSeen])].sort();
        results.push({
            id: 'report-fields',
            expected: 'every finding has RuleID, File, StartLine, StartColumn, EndColumn',
            observed: `fields seen: ${fieldsSeen.join(',')}`,
            pass: p1.findings.length > 0,
            note: 'gitleaks-format JSON confirmed on the first fixture run',
        });
        const rawBlobs = [p1.reportPath, p2.reportPath].map((p) => fs.readFileSync(p, 'utf8')).concat([p1.logText, p2.logText]);
        const leaked = planted.filter((v) => rawBlobs.some((b) => b.includes(v) || b.toLowerCase().includes(v.toLowerCase()))).length;
        const unredacted = [...p1.findings, ...p2.findings].filter((f) => f.Secret !== undefined && f.Secret !== 'REDACTED').length;
        results.push({
            id: 'redaction',
            expected: 'no planted value appears in any raw report or scanner output; every Secret field is REDACTED',
            observed: `planted values found in raw output: ${leaked}; non-REDACTED Secret fields: ${unredacted}`,
            pass: leaked === 0 && unredacted === 0,
            note: `${planted.length} planted values checked (never printed)`,
        });
        results.push({
            id: 'pass2-subset',
            expected: 'pass 2 (known-public.toml) only ever removes hits: zero pass-2-only hits; no hit outside the case files',
            observed: `pass1 ${p1.findings.length}, pass2 ${p2.findings.length}, pass2-only ${pass2OnlyCount}, stray ${stray.length}`,
            pass: pass2OnlyCount === 0 && stray.length === 0 && p2.findings.length <= p1.findings.length,
            note: stray.length ? `stray: ${describe(stray)}` : 'none stray',
        });
        results.push({
            id: 'bytes-scanned',
            expected: 'the scanner reports a non-zero byte count for both passes',
            observed: `pass1 ${p1.bytesScanned ?? 'unreported'}, pass2 ${p2.bytesScanned ?? 'unreported'}`,
            pass: (p1.bytesScanned ?? 0) > 0 && (p2.bytesScanned ?? 0) > 0,
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
            config_relationship: 'known-public.toml = extended.toml byte-for-byte + one appended [[allowlists]] block (regexTarget secret, Hardhat #0 only)',
            scanner_args: SCANNER_ARGS_TEMPLATE,
            scanner_cwd: 'fresh empty os.tmpdir() folder, deleted after each run',
            env_belt: `HTTPS_PROXY=HTTP_PROXY=ALL_PROXY=${NET_BELT} (belt only, not an enforced network boundary)`,
            report_fields_seen: fieldsSeen,
            exit_codes_seen: { pass1: p1.exitCode, pass2: p2.exitCode },
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
    const fx = JSON.parse(fs.readFileSync(fixturesPath, 'utf8')) as FixturesDoc;
    if (fx.exe_sha256 !== exeSha) throw new Refusal('FIXTURES.json was proven with a different scanner executable');
    if (JSON.stringify(fx.config_sha256) !== JSON.stringify(configSha)) {
        throw new Refusal('config SHA-256s differ from the ones FIXTURES.json proved; re-run the fixture proof first');
    }
    const required = fx.cases.filter((c) => c.id !== 'g');
    if (!fx.all_pass_except_g || required.length < 8 || !required.every((c) => c.pass === true) || fx.cases.length < 9) {
        throw new Refusal('FIXTURES.json does not show every required case passing');
    }
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
        if ((p1.bytesScanned ?? 0) <= 0 || (p2.bytesScanned ?? 0) <= 0) throw new Error(`scanner read no bytes of target ${t.name}`);
        const { hits, pass2OnlyCount } = classify(p1.findings, p2.findings);
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
            pass1_count: p1.findings.length,
            pass2_count: p2.findings.length,
            pass2_only_count: pass2OnlyCount,
            bytes_scanned: { pass1: p1.bytesScanned, pass2: p2.bytesScanned },
            raw_reports: [p1.reportPath, p2.reportPath].map(normSlashes),
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
        hits: outHits,
    };
    for (const k of Object.keys(meta)) {
        if (k in computed) throw new Refusal(`--meta key ${k} would override a computed field`);
    }
    const doc = { ...computed, ...meta };
    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
    for (const t of outTargets) {
        console.log(`TARGET ${String(t.name)} kind=${String(t.kind)} hits=${String(t.hit_count)} non-public=${String(t.non_public_count)} known-public=${String(t.known_public_count)}`);
    }
    console.log(`RESULT ${nonPublic === 0 ? 'CLEAN (zero non-public hits)' : `NON-PUBLIC HITS: ${nonPublic}`}`);
    return nonPublic === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): number {
    const bin = argValue('bin');
    if (!bin) throw new Refusal('--bin <betterleaks.exe> is required');
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
