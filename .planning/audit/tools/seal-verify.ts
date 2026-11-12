// .planning/audit/tools/seal-verify.ts
//
// Phase 22 / Plan 22-29 (review concern L661@e2e59f6, NAC-11, T-22-97) - the seal check.
//
// The phase is sealed on one revision (sealed_sha). This tool proves that nothing
// that could matter changed after it:
//   - sealed_sha and phase_start_sha are ancestors of HEAD (no history rewrite)
//   - every path changed after sealed_sha is on the exempt list in SEAL.json
//   - SEAL.json's own numbers still match the files they point at
//   - with --scan, every commit after sealed_sha is scanned for secrets
//
// Usage (Node 22.16.0 by absolute path, D-21):
//   seal-verify.ts [--scan] [--seal <repo-relative seal record>] [--repo <repo root>]
//       Prints `SEAL VALID` or `SEAL INVALID: <reasons>`. Exit 0 valid, 1 invalid.
//       --seal defaults to .planning/audit/SEAL.json (the Phase 22 seal, handled as before).
//   seal-verify.ts --phase-scan --sealed <sha> [--start <sha> --phase-name <s> --plan-id <s>
//                  --requirement <s>] --raw-dir <dir outside the repo> --out <json>
//       The NAC-11 scan of <start>..<sealed>. Without --start the start is
//       .planning/baselines/phase-start.json (Phase 22). Writes metadata only, never a seal
//       record. Exit 0 clean, 1 any non-public hit, 2 refusal or crash.
//   seal-verify.ts --self-test
//       Throwaway repos under os.tmpdir(): the exempt-pattern, tamper, merge and successor
//       cases, and a range-scan fixture run through the real scanner. Exit 0 pass, 1 fail.
//
// Exempt paths are patterns: `*` matches any run of characters except `/`, everything
// else is literal, and the pattern must match the whole path. A path on the list is
// still scanned by --scan; the list only says it may change.
//
// A later change is found two ways: the net diff, and the paths touched by each later
// commit, both with renames off. So a non-exempt file changed and changed back, or
// renamed onto an exempt path, still shows up. A merge commit adds only the paths where
// its result differs from every parent (git's combined listing): a clean merge adds
// nothing of its own, the commits it brings in are each counted, and a change made in the
// merge itself is still caught (Phase 23 D-19; a first-parent listing counted the whole
// merged branch, including everything before the seal).
//
// Successor seals (Phase 23 D-19). A record that carries `previous_seal` is a successor and
// must carry all of: covers, previous_seal, previous_sealed_sha, changed_since_previous,
// scan_record, scan_start_sha. Then:
//   - only paths under `covers` (compared without letter case) are judged against
//     exempt_paths; a change elsewhere is permitted by design
//   - `scan_record` replaces inputs/phase-scan.json for the exempt-list and digest checks,
//     and that scan file's sealed_sha, phase_start_sha and range must be the record's
//   - previous_sealed_sha must equal the sealed_sha of the record `previous_seal` names (read
//     at the successor's sealed_sha) and be an ancestor of sealed_sha
//   - changed_since_previous must equal the paths under `covers` changed from
//     previous_sealed_sha to sealed_sha, found the same way as later changes
// SEAL.json itself is only ever read; no code path in this tool writes it.
//
// The scanner rules are those of fixture-check.ts --git-scan (22-26): the verified
// binary, the fixture-proven configs, the proxy belt, --redact, three-pass
// classification keyed on line and columns. Only the --log-opts range differs, and that
// range is proven here by rangeFixture() before any real scan. Raw reports stay out of
// the repo. No secret value is ever printed or written by this tool.
//
// Never reads .env, never opens data/ and loads no native module. Node built-ins only.

if (process.versions.modules !== '127') {
    process.stderr.write(
        `seal-verify: requires Node 22.16.0 (ABI 127); this is Node ${process.version} ` +
            `(ABI ${process.versions.modules}). Run it with ` +
            `/c/Users/jackc/AppData/Local/nvm/v22.16.0/node.exe (D-21).\n`,
    );
    process.exit(2);
}

import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HERE = __dirname;
const BL = path.join(HERE, 'betterleaks');
const EXTENDED_TOML = path.join(BL, 'extended.toml');
const KNOWN_PUBLIC_TOML = path.join(BL, 'known-public.toml');
const PUBLIC_ADDRESS_TOML = path.join(BL, 'public-address.toml');
const TOOL_JSON = path.join(BL, 'TOOL.json');
const FIXTURES_JSON = path.join(BL, 'FIXTURES.json');
const LEAKS_EXIT = 9;
const NET_BELT = 'http://127.0.0.1:1';
const KNOWN_PUBLIC = 'known-public:hardhat-0';
const PUBLIC_ADDRESS = 'public-address';
const NON_PUBLIC = 'non-public';
const IGNORE_FILES = ['.betterleaksignore', '.gitleaksignore', '.betterleaks.toml', '.gitleaks.toml'];
const FIREWALL_RULE = 'csb-betterleaks-outbound-block';
const BL_GIT_TEMP_PREFIX = 'betterleaks-git-';
// fixture-check.ts GIT_LOG_OPTS minus --all and --reflog, which would widen a range to all history
const RANGE_LOG_OPTS = '--full-history --diff-filter=tuxdb --diff-merges=first-parent';

const SEAL_REL = '.planning/audit/SEAL.json';
const SCAN_REL = '.planning/audit/inputs/phase-scan.json';
const RENDERS: Record<string, string> = {
    findings: '.planning/audit/AUDIT-FINDINGS.md',
    decisions: '.planning/audit/OPERATOR-DECISIONS.md',
};

class Refusal extends Error {}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sha256(b: Buffer | string): string {
    return crypto.createHash('sha256').update(b).digest('hex');
}

function normSlashes(p: string): string {
    return p.replace(/\\/g, '/');
}

function isInside(child: string, parent: string): boolean {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function mkTemp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTree(p: string): void {
    fs.rmSync(p, { recursive: true, force: true });
}

function readGitEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_OPTIONAL_LOCKS = '0';
    return env;
}

function gitOut(repo: string, args: string[]): Buffer {
    const r = cp.spawnSync('git', args, { cwd: repo, env: readGitEnv(), windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    if (r.error) throw new Error(`git did not run: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`git ${args.slice(0, 2).join(' ')} failed (exit ${r.status})`);
    return r.stdout;
}

const gitText = (repo: string, args: string[]): string => gitOut(repo, args).toString('utf8');

function gitOk(repo: string, args: string[]): boolean {
    const r = cp.spawnSync('git', args, { cwd: repo, env: readGitEnv(), windowsHide: true, stdio: 'ignore' });
    return r.status === 0;
}

function splitNul(s: string): string[] {
    return s
        .split('\0')
        .map((x) => x.replace(/^\n+/, ''))
        .filter(Boolean);
}

/** Whole-path match: `*` is any run of characters except `/`, everything else is literal. */
export function patternToRe(pattern: string): RegExp {
    const body = pattern
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*');
    return new RegExp(`^${body}$`);
}

export function isExempt(p: string, patterns: string[]): boolean {
    return patterns.some((x) => patternToRe(x).test(p));
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

interface Finding {
    RuleID: string;
    Description?: string;
    File: string;
    StartLine: number;
    StartColumn: number;
    EndColumn: number;
    Commit?: string;
    Secret?: string;
}

interface ConfigHashes {
    extended: string;
    known_public: string;
    public_address: string;
}

interface Hit {
    rule_id: string;
    file: string;
    commit: string;
    line: number;
    column: number;
    type: string;
    classification: string;
}

interface ScanSet {
    range: string;
    log_opts: string;
    hits: Hit[];
    pass_counts: { pass1: number; pass2: number; pass3: number; pass2_only: number; pass3_only: number };
    bytes_scanned: { pass1: number | null; pass2: number | null; pass3: number | null };
    raw_reports: string[];
}

function configHashes(): ConfigHashes {
    return {
        extended: sha256(fs.readFileSync(EXTENDED_TOML)),
        known_public: sha256(fs.readFileSync(KNOWN_PUBLIC_TOML)),
        public_address: sha256(fs.readFileSync(PUBLIC_ADDRESS_TOML)),
    };
}

/** The binary and configs must be exactly the ones FIXTURES.json proved. */
function verifiedScanner(): { bin: string; exeSha: string; version: string; configSha: ConfigHashes; fixtures: any } {
    const tool = JSON.parse(fs.readFileSync(TOOL_JSON, 'utf8'));
    const bin = String(tool.exe_path);
    if (!fs.existsSync(bin) || !fs.lstatSync(bin).isFile()) throw new Refusal('the scanner executable named in TOOL.json is missing');
    const exeSha = sha256(fs.readFileSync(bin));
    if (exeSha !== tool.exe_sha256) throw new Refusal('the scanner executable differs from TOOL.json; refusing to run it');
    const fixtures = JSON.parse(fs.readFileSync(FIXTURES_JSON, 'utf8'));
    if (fixtures.exe_sha256 !== exeSha) throw new Refusal('FIXTURES.json was proven with a different scanner executable');
    const configSha = configHashes();
    if (JSON.stringify(fixtures.config_sha256) !== JSON.stringify(configSha)) throw new Refusal('the scanner configs differ from the ones FIXTURES.json proved');
    const required = (fixtures.cases as any[]).filter((c) => c.id !== 'g');
    if (fixtures.all_pass_except_g !== true || required.some((c) => c.pass !== true)) throw new Refusal('FIXTURES.json does not show every required case passing');
    return { bin, exeSha, version: tool.version, configSha, fixtures };
}

function scannerEnv(): NodeJS.ProcessEnv {
    const keep = [
        'SystemRoot', 'windir', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA',
        'HOMEDRIVE', 'HOMEPATH', 'ComSpec', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
    ];
    const env: NodeJS.ProcessEnv = {};
    for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
    env.HTTPS_PROXY = NET_BELT;
    env.HTTP_PROXY = NET_BELT;
    env.ALL_PROXY = NET_BELT;
    env.NO_PROXY = '';
    return env;
}

function scannerArgs(target: string, logOpts: string, config: string, report: string, ignoreDir: string): string[] {
    return [
        'git', target, `--log-opts=${logOpts}`,
        '--config', config,
        '--max-archive-depth', '2',
        '--redact',
        '--no-banner',
        '--no-color',
        '--report-format', 'json',
        '--report-path', report,
        '--exit-code', String(LEAKS_EXIT),
        '--ignore-gitleaks-allow',
        '--gitleaks-ignore-path', ignoreDir,
    ];
}

/** The flags after the target must be the ones FIXTURES.json proved. */
function assertFlagParity(fixtures: any): void {
    const proven: string[] = fixtures.scanner_args;
    const mine = scannerArgs('<target>', 'x', '<extended.toml|known-public.toml|public-address.toml>', '<report.json>', '<empty temp dir>').slice(3);
    if (JSON.stringify(proven.slice(2)) !== JSON.stringify(mine)) throw new Refusal('scanner flags differ from the ones FIXTURES.json proved');
}

function runPass(bin: string, repo: string, logOpts: string, config: string, report: string): { findings: Finding[]; bytes: number | null } {
    if (fs.existsSync(report)) throw new Refusal('report path already exists; refusing to overwrite');
    for (const n of IGNORE_FILES) if (fs.existsSync(path.join(repo, n))) throw new Refusal(`repo root holds ${n}; refusing (it could suppress findings)`);
    const cwd = mkTemp('csb-bl-cwd-');
    try {
        const r = cp.spawnSync(bin, scannerArgs(repo, logOpts, config, report, cwd), {
            cwd,
            env: scannerEnv(),
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            windowsHide: true,
            timeout: 30 * 60 * 1000,
        });
        if (r.error) throw new Error(`scanner did not run: ${r.error.message}`);
        const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
        fs.writeFileSync(report.replace(/\.json$/, '.log'), log);
        const exit = r.status === null ? -1 : r.status;
        if (exit !== 0 && exit !== LEAKS_EXIT) throw new Error(`scanner exit ${exit} (error or partial scan)`);
        if (/partial scan/i.test(log)) throw new Error('the scanner reported a partial scan');
        if (!fs.existsSync(report)) throw new Error('the scanner wrote no report');
        const parsed: unknown = JSON.parse(fs.readFileSync(report, 'utf8'));
        if (!Array.isArray(parsed)) throw new Error('the report is not a JSON array');
        const findings = parsed as Finding[];
        for (const f of findings) {
            if (typeof f.RuleID !== 'string' || typeof f.File !== 'string' || typeof f.StartLine !== 'number' || typeof f.StartColumn !== 'number' || typeof f.EndColumn !== 'number') {
                throw new Error('a report finding lacks a required field');
            }
            if (typeof f.Commit !== 'string' || !/^[0-9a-f]{40}$/.test(f.Commit)) throw new Error('a git-mode finding lacks a 40-hex Commit');
            if (f.Secret !== 'REDACTED') throw new Error('a finding carries a non-REDACTED Secret field');
        }
        if (exit === 0 && findings.length) throw new Error('scanner exit 0 but the report has findings');
        if (exit === LEAKS_EXIT && !findings.length) throw new Error('scanner exit 9 but the report is empty');
        const m = /scanned ~(\d+) bytes/.exec(log);
        return { findings, bytes: m ? Number(m[1]) : null };
    } finally {
        rmTree(cwd);
    }
}

const hitKey = (f: Finding): string => [f.RuleID, normSlashes(f.File), f.StartLine, f.StartColumn, f.EndColumn, f.Commit ?? ''].join('\u0000');

function classify(p1: Finding[], p2: Finding[], p3: Finding[]): { hits: { finding: Finding; classification: string }[]; pass2Only: number; pass3Only: number } {
    const groups = new Map<string, { a: Finding[]; b: Finding[]; c: Finding[] }>();
    const add = (f: Finding, w: 'a' | 'b' | 'c') => {
        const k = hitKey(f);
        const g = groups.get(k) ?? { a: [], b: [], c: [] };
        g[w].push(f);
        groups.set(k, g);
    };
    p1.forEach((f) => add(f, 'a'));
    p2.forEach((f) => add(f, 'b'));
    p3.forEach((f) => add(f, 'c'));
    const hits: { finding: Finding; classification: string }[] = [];
    let pass2Only = 0;
    let pass3Only = 0;
    for (const k of [...groups.keys()].sort()) {
        const g = groups.get(k)!;
        const n1 = g.a.length;
        const n2 = g.b.length;
        const n3 = g.c.length;
        const in12 = Math.min(n1, n2);
        const inAll = Math.min(in12, n3);
        for (let i = 0; i < n1; i++) hits.push({ finding: g.a[i], classification: i < inAll ? NON_PUBLIC : i < in12 ? PUBLIC_ADDRESS : KNOWN_PUBLIC });
        for (let i = n1; i < n2; i++) {
            pass2Only++;
            hits.push({ finding: g.b[i], classification: NON_PUBLIC });
        }
        for (let i = n2; i < n3; i++) {
            pass3Only++;
            hits.push({ finding: g.c[i], classification: NON_PUBLIC });
        }
    }
    return { hits, pass2Only, pass3Only };
}

function tempLeftovers(): string[] {
    return fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(BL_GIT_TEMP_PREFIX)).sort();
}

export function scanRange(bin: string, repo: string, from: string, to: string, rawDir: string): ScanSet {
    if (!/^[0-9a-f]{40}$/.test(from) || !/^[0-9a-f]{40}$/.test(to)) throw new Refusal('the scan range must be two 40-hex commits');
    const range = `${from}..${to}`;
    const logOpts = `${RANGE_LOG_OPTS} ${range}`;
    fs.mkdirSync(rawDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const before = tempLeftovers();
    const rep = (n: number) => path.join(rawDir, `range-${stamp}.pass${n}.json`);
    const a = runPass(bin, repo, logOpts, EXTENDED_TOML, rep(1));
    const b = runPass(bin, repo, logOpts, KNOWN_PUBLIC_TOML, rep(2));
    const c = runPass(bin, repo, logOpts, PUBLIC_ADDRESS_TOML, rep(3));
    const left = tempLeftovers().filter((n) => !before.includes(n));
    if (left.length) throw new Error(`the scanner left ${left.length} temporary git copy folder(s)`);
    if ((a.bytes ?? 0) <= 0 || a.bytes !== b.bytes || b.bytes !== c.bytes) throw new Error('the three passes read zero or different byte counts');
    const cl = classify(a.findings, b.findings, c.findings);
    return {
        range,
        log_opts: logOpts,
        hits: cl.hits.map((h) => ({
            rule_id: h.finding.RuleID,
            file: normSlashes(h.finding.File).replace(/^\/+/, ''),
            commit: String(h.finding.Commit),
            line: h.finding.StartLine,
            column: h.finding.StartColumn,
            type: h.finding.Description ?? h.finding.RuleID,
            classification: h.classification,
        })),
        pass_counts: { pass1: a.findings.length, pass2: b.findings.length, pass3: c.findings.length, pass2_only: cl.pass2Only, pass3_only: cl.pass3Only },
        bytes_scanned: { pass1: a.bytes, pass2: b.bytes, pass3: c.bytes },
        raw_reports: [rep(1), rep(2), rep(3)].map(normSlashes),
    };
}

function fixtureGit(dir: string, hooks: string): (...args: string[]) => string {
    const env = readGitEnv();
    env.GIT_CONFIG_NOSYSTEM = '1';
    const emptyGlobal = path.join(hooks, 'empty.gitconfig');
    fs.writeFileSync(emptyGlobal, '');
    env.GIT_CONFIG_GLOBAL = emptyGlobal;
    const C = [
        '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
        '-c', 'core.autocrlf=false', '-c', `core.hooksPath=${normSlashes(hooks)}`, '-c', 'init.defaultBranch=main',
    ];
    return (...args: string[]) => {
        const r = cp.spawnSync('git', [...C, ...args], { cwd: dir, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
        if (r.error) throw new Error(`git did not run: ${r.error.message}`);
        if (r.status !== 0) throw new Error(`git ${args[0]} failed (exit ${r.status}): ${r.stderr}`);
        return r.stdout.trim();
    };
}

function readHardhatKey(repo: string): string {
    const src = fs.readFileSync(path.join(repo, 'test', 'fork', 'helpers', 'realMainnetGate.ts'), 'utf8');
    const m = /FORK_ONLY_TEST_KEY\s*=\s*'0x([0-9a-f]{64})'/.exec(src);
    if (!m) throw new Refusal('Hardhat #0 literal (FORK_ONLY_TEST_KEY) not found in realMainnetGate.ts');
    return m[1];
}

const randomHex = (bytes: number) => crypto.randomBytes(bytes).toString('hex');

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

/**
 * Random hex whose bare and "0x"-prefixed forms both clear the rules' 3.5 entropy floor with
 * margin, as fixture-check.ts randomHexStrong does (Phase 23 plan 23-26). With plain random
 * values about 1 percent of runs planted an address the default rule skips, failing
 * range-public-address by chance (measured), and a low-entropy "before" key would let
 * range-excludes-earlier-commit pass without proving anything.
 */
export function randomHexStrong(bytes: number): string {
    for (let i = 0; i < 1000; i++) {
        const h = randomHex(bytes);
        if (shannon(h) >= 3.65 && shannon(`0x${h}`) >= 3.65) return h;
    }
    throw new Error('could not draw a high-entropy fixture value');
}

export interface RangeFixture {
    pass: boolean;
    cases: { id: string; pass: boolean; observed: string }[];
}

/** Proves the range log-opts: a key before the range is not reported, one inside it is. Keys are random and never printed. */
export function rangeFixture(bin: string, repoForHardhat: string): RangeFixture {
    const fx = mkTemp('csb-seal-range-');
    const raw = mkTemp('csb-seal-range-raw-');
    const hooks = mkTemp('csb-seal-hooks-');
    const cases: { id: string; pass: boolean; observed: string }[] = [];
    try {
        const g = fixtureGit(fx, hooks);
        const before = randomHexStrong(32);
        const inside = randomHexStrong(32);
        const addr = randomHexStrong(20);
        const hardhat = readHardhatKey(repoForHardhat);
        g('init', '-q');
        fs.writeFileSync(path.join(fx, 'a.ts'), `PRIVATE_KEY=0x${before}\n`);
        g('add', '--', 'a.ts');
        g('commit', '-q', '-m', 'A');
        fs.writeFileSync(path.join(fx, 'inert.ts'), 'export const inert = 1;\n');
        g('add', '--', 'inert.ts');
        g('commit', '-q', '-m', 'B');
        const shaB = g('rev-parse', 'HEAD');
        fs.writeFileSync(path.join(fx, 'c.ts'), `PRIVATE_KEY=0x${inside}\n`);
        fs.writeFileSync(path.join(fx, 'h.ts'), `export const forkAccount = { privateKey: '0x${hardhat}' };\n`);
        fs.writeFileSync(path.join(fx, 'm.log'), `{"level":30,"time":1717000000000,"token":"0x${addr}","msg":"pair detected"}\n`);
        g('add', '--', 'c.ts', 'h.ts', 'm.log');
        g('commit', '-q', '-m', 'C');
        const shaC = g('rev-parse', 'HEAD');
        g('rm', '-q', '--', 'c.ts');
        g('commit', '-q', '-m', 'D');
        const shaD = g('rev-parse', 'HEAD');
        const set = scanRange(bin, fx, shaB, shaD, raw);
        const inFile = (n: string) => set.hits.filter((h) => h.file === n || h.file.endsWith(`/${n}`));
        const add = (id: string, pass: boolean, observed: string) => cases.push({ id, pass, observed });
        add('range-excludes-earlier-commit', inFile('a.ts').length === 0, `a.ts hits ${inFile('a.ts').length}`);
        const cHits = inFile('c.ts');
        add('range-includes-inner-commit', cHits.length > 0 && cHits.every((h) => h.classification === NON_PUBLIC && h.commit === shaC), `c.ts ${cHits.map((h) => h.classification).join(',')}`);
        const hHits = inFile('h.ts');
        add('range-known-public', hHits.length > 0 && hHits.every((h) => h.classification === KNOWN_PUBLIC), `h.ts ${hHits.map((h) => h.classification).join(',')}`);
        const mHits = inFile('m.log');
        add('range-public-address', mHits.length > 0 && mHits.every((h) => h.classification === PUBLIC_ADDRESS), `m.log ${mHits.map((h) => h.classification).join(',')}`);
        add('range-pass-subset', set.pass_counts.pass2_only === 0 && set.pass_counts.pass3_only === 0, JSON.stringify(set.pass_counts));
        const reports = set.raw_reports.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
        const leaked = [before, inside, addr].filter((v) => reports.includes(v)).length;
        add('range-redaction', leaked === 0, `planted values in raw reports: ${leaked}`);
        return { pass: cases.every((c) => c.pass), cases };
    } finally {
        rmTree(fx);
        rmTree(raw);
        rmTree(hooks);
    }
}

/** Reads back the firewall rule that blocks the scanner's outbound traffic; refuses if it is not in force. */
function networkBoundary(bin: string): Record<string, unknown> {
    if (process.platform !== 'win32') throw new Refusal('the recorded network boundary is a Windows Firewall rule');
    const r = cp.spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE}`, 'verbose'], { encoding: 'utf8', windowsHide: true });
    const out = `${r.stdout ?? ''}`;
    const field = (name: string): string => (new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'mi').exec(out) || [])[1] ?? '';
    const rec = {
        kind: 'firewall-rule',
        rule: FIREWALL_RULE,
        enabled: field('Enabled'),
        direction: field('Direction'),
        action: field('Action'),
        profiles: field('Profiles'),
        program: field('Program'),
        program_matches_exe_path: normSlashes(field('Program')).toLowerCase() === normSlashes(bin).toLowerCase(),
        read_with: 'netsh advfirewall firewall show rule name=<rule> verbose, by this tool, before the scanner ran',
    };
    if (r.status !== 0 || rec.enabled !== 'Yes' || rec.direction !== 'Out' || rec.action !== 'Block' || !rec.program_matches_exe_path) {
        throw new Refusal(`the firewall rule ${FIREWALL_RULE} is not in force for the scanner`);
    }
    return rec;
}

// ---------------------------------------------------------------------------
// Seal verification
// ---------------------------------------------------------------------------

export interface SealResult {
    valid: boolean;
    reasons: string[];
    /** Paths changed after sealed_sha that the seal judges (for a successor: those under `covers`). */
    changed: string[];
    /** Successor seals only: how many changed paths lie outside `covers` and were not judged. */
    outside_covers: number;
}

const SHA40 = /^[0-9a-f]{40}$/;
const SUCCESSOR_FIELDS = ['covers', 'previous_seal', 'previous_sealed_sha', 'changed_since_previous', 'scan_record', 'scan_start_sha'];

/**
 * Every path changed from `from` to `to`: the net diff plus the paths each commit in the range
 * touched, renames off. A merge commit adds only the paths where its result differs from every
 * parent (combined listing), so a clean merge adds nothing of its own while the commits it brings
 * in each count (D-19: a first-parent listing counted the whole merged branch).
 */
export function changedPaths(repo: string, from: string, to: string): string[] {
    const range = `${from}..${to}`;
    return [
        ...new Set<string>([
            ...splitNul(gitText(repo, ['diff', '--no-renames', '--name-only', '-z', range])),
            ...splitNul(gitText(repo, ['log', '--format=', '--name-only', '-z', '--no-renames', '--diff-merges=combined', range])),
        ]),
    ].sort();
}

/** A repo-relative path with forward slashes, no `..` segment and no drive or leading slash. */
export function isPlainRel(p: string): boolean {
    if (!p || p !== normSlashes(p) || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
    return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** Under `covers` (a folder prefix ending in `/`), compared without letter case: a case variant of the folder is the same folder on Windows. */
export function underCovers(p: string, covers: string): boolean {
    return p.toLowerCase().startsWith(covers.toLowerCase());
}

export function verifySeal(repo: string, opts: { scan: boolean; scan_fn?: (from: string, to: string) => Hit[]; seal_rel?: string }): SealResult {
    const reasons: string[] = [];
    const sealRel = opts.seal_rel ?? SEAL_REL;
    const fail = (why: string[]): SealResult => ({ valid: false, reasons: why, changed: [], outside_covers: 0 });
    if (!isPlainRel(sealRel)) return fail([`--seal must be a plain repo-relative path: ${sealRel}`]);
    const sealName = path.posix.basename(sealRel);
    const sealPath = path.join(repo, ...sealRel.split('/'));
    if (!fs.existsSync(sealPath)) return fail([`${sealRel} is missing`]);
    const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
    const sealed = String(seal.sealed_sha);
    const start = String(seal.phase_start_sha);
    const patterns: string[] = Array.isArray(seal.exempt_paths) ? seal.exempt_paths.map(String) : [];
    if (!SHA40.test(sealed)) return fail(['sealed_sha is not 40 hex']);
    if (!SHA40.test(start)) return fail(['phase_start_sha is not 40 hex']);
    if (!gitOk(repo, ['cat-file', '-e', `${sealed}^{commit}`])) return fail(['sealed_sha names no commit']);

    // A successor carries previous_seal; any one successor field makes the whole set required,
    // so a partial record can never fall back to the weaker reading.
    const successor = SUCCESSOR_FIELDS.some((k) => seal[k] !== undefined);
    let scanRel = SCAN_REL;
    let covers: string | null = null;
    if (successor) {
        const missing = SUCCESSOR_FIELDS.filter((k) => seal[k] === undefined);
        if (missing.length) return fail([`a successor seal must carry ${missing.join(', ')}`]);
        covers = String(seal.covers);
        if (!isPlainRel(covers.replace(/\/$/, '')) || !covers.endsWith('/')) return fail([`covers must be a repo-relative folder ending in /: ${covers}`]);
        scanRel = String(seal.scan_record);
        if (!isPlainRel(scanRel)) return fail([`scan_record must be a plain repo-relative path: ${scanRel}`]);
        if (!isPlainRel(String(seal.previous_seal))) return fail([`previous_seal must be a plain repo-relative path: ${seal.previous_seal}`]);
        if (String(seal.previous_seal) === sealRel) return fail(['previous_seal names this seal record itself']);
    }

    for (const rel of [sealRel, scanRel]) if (!patterns.includes(rel)) reasons.push(`exempt_paths must list ${rel}`);
    if (!gitOk(repo, ['merge-base', '--is-ancestor', sealed, 'HEAD'])) return fail([...reasons, 'sealed_sha is not an ancestor of HEAD']);
    if (!gitOk(repo, ['merge-base', '--is-ancestor', start, 'HEAD'])) reasons.push('phase_start_sha is not an ancestor of HEAD');
    if (seal.final_check !== 'pass') reasons.push(`${sealName} final_check is not "pass"`);
    if (!seal.scan || seal.scan.non_public !== 0) reasons.push(`${sealName} scan.non_public is not 0`);

    const scanFile = path.join(repo, ...scanRel.split('/'));
    let scanText: Buffer | null = null;
    if (!fs.existsSync(scanFile)) reasons.push(`${scanRel} is missing`);
    else {
        scanText = fs.readFileSync(scanFile);
        if (sha256(scanText) !== seal.scan?.phase_scan_sha256) reasons.push(`${scanRel} does not match ${sealName} phase_scan_sha256`);
    }

    if (successor) {
        // The scan record must be the scan of exactly this seal's range.
        const scanStart = String(seal.scan_start_sha);
        const wantRange = `${scanStart}..${sealed}`;
        if (!SHA40.test(scanStart)) reasons.push('scan_start_sha is not 40 hex');
        else if (!gitOk(repo, ['merge-base', '--is-ancestor', scanStart, sealed])) reasons.push('scan_start_sha is not an ancestor of sealed_sha');
        if (start !== scanStart) reasons.push('phase_start_sha differs from scan_start_sha');
        if (seal.scan?.range !== wantRange) reasons.push(`${sealName} scan.range is not ${wantRange}`);
        if (scanText) {
            let doc: any = null;
            try {
                doc = JSON.parse(scanText.toString('utf8'));
            } catch {
                reasons.push(`${scanRel} is not JSON`);
            }
            if (doc) {
                if (doc.sealed_sha !== sealed) reasons.push(`${scanRel} sealed_sha is not the record's sealed_sha`);
                if (doc.phase_start_sha !== scanStart) reasons.push(`${scanRel} phase_start_sha is not the record's scan_start_sha`);
                if (doc.range !== wantRange) reasons.push(`${scanRel} range is not ${wantRange}`);
                if (doc.hit_counts?.['non-public'] !== 0) reasons.push(`${scanRel} hit_counts non-public is not 0`);
            }
        }

        // Predecessor linkage, read at the successor's own sealed revision.
        const prevSha = String(seal.previous_sealed_sha);
        let prev: any = null;
        try {
            prev = JSON.parse(gitText(repo, ['cat-file', '-p', `${sealed}:${String(seal.previous_seal)}`]));
        } catch {
            reasons.push(`previous_seal ${seal.previous_seal} is missing or not JSON at sealed_sha`);
        }
        if (prev && prev.sealed_sha !== prevSha) reasons.push(`previous_sealed_sha is not the sealed_sha of ${seal.previous_seal}`);
        if (!SHA40.test(prevSha) || !gitOk(repo, ['cat-file', '-e', `${prevSha}^{commit}`])) reasons.push('previous_sealed_sha names no commit');
        else {
            if (!gitOk(repo, ['merge-base', '--is-ancestor', prevSha, sealed])) reasons.push('previous_sealed_sha is not an ancestor of sealed_sha');
            else {
                const want = changedPaths(repo, prevSha, sealed).filter((p) => underCovers(p, covers!));
                const got: string[] | null = Array.isArray(seal.changed_since_previous) ? (seal.changed_since_previous as unknown[]).map(String).sort() : null;
                if (!got || JSON.stringify(got) !== JSON.stringify(want)) {
                    const gotSet = new Set(got ?? []);
                    const wantSet = new Set(want);
                    const lacks = want.filter((p) => !gotSet.has(p));
                    const extra = (got ?? []).filter((p) => !wantSet.has(p));
                    reasons.push(`changed_since_previous is not the paths under ${covers} changed since previous_sealed_sha (missing ${lacks.length}: ${lacks.slice(0, 5).join(', ')}; extra ${extra.length}: ${extra.slice(0, 5).join(', ')})`);
                }
            }
        }
    }

    for (const [key, rel] of Object.entries(RENDERS)) {
        let blob = '';
        try {
            blob = sha256(gitOut(repo, ['cat-file', '-p', `${sealed}:${rel}`]));
        } catch {
            blob = 'missing';
        }
        if (blob !== seal.render_sha256?.[key]) reasons.push(`${rel} at sealed_sha does not match ${sealName} render_sha256.${key}`);
    }

    const range = `${sealed}..HEAD`;
    const all = changedPaths(repo, sealed, 'HEAD');
    const list = covers ? all.filter((p) => underCovers(p, covers!)) : all;
    const outside = list.filter((p) => !isExempt(p, patterns));
    if (outside.length) reasons.push(`changed after the seal and not exempt: ${outside.join(', ')}`);

    if (opts.scan) {
        const head = gitText(repo, ['rev-parse', 'HEAD']).trim();
        if (head !== sealed) {
            const hits = opts.scan_fn ? opts.scan_fn(sealed, head) : [];
            const nonPublic = hits.filter((h) => h.classification === NON_PUBLIC);
            if (nonPublic.length) reasons.push(`the scan of ${range} found ${nonPublic.length} non-public hit(s): ${nonPublic.map((h) => `${h.file}:${h.line}@${h.commit.slice(0, 8)}`).join(', ')}`);
        }
    }
    return { valid: reasons.length === 0, reasons, changed: list, outside_covers: all.length - list.length };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

const REAL_EXEMPT = [
    SEAL_REL,
    SCAN_REL,
    '.planning/phases/22-safety-rails-audit/*-SUMMARY.md',
    '.planning/phases/22-safety-rails-audit/*-VERIFICATION.md',
    '.planning/STATE.md',
    '.planning/ROADMAP.md',
    '.planning/REQUIREMENTS.md',
    '.planning/state.json',
    '.planning/phases/22-safety-rails-audit/*-REVIEW*.md',
    '.planning/phases/22-safety-rails-audit/*-UAT.md',
    '.planning/phases/22-safety-rails-audit/*-SECURITY.md',
    '.planning/phases/22-safety-rails-audit/22-ORCHESTRATOR-NOTES.md',
    '.planning/phases/22-safety-rails-audit/.continue-here.md',
];

function selfTest(repoRoot: string): number {
    const fails: string[] = [];
    const ok = (cond: boolean, what: string) => {
        if (!cond) fails.push(what);
        console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`);
    };

    // Pattern semantics
    const P = (x: string, p: string) => patternToRe(p).test(x);
    ok(P('.planning/STATE.md', '.planning/STATE.md'), 'literal pattern matches itself');
    ok(!P('.planning/STATE.md.bak', '.planning/STATE.md'), 'literal pattern is anchored at the end');
    ok(!P('x/.planning/STATE.md', '.planning/STATE.md'), 'literal pattern is anchored at the start');
    ok(!P('.planning/STATExmd', '.planning/STATE.md'), 'a dot in a pattern is literal');
    ok(P('.planning/phases/22-safety-rails-audit/22-29-SUMMARY.md', '.planning/phases/22-safety-rails-audit/*-SUMMARY.md'), 'star matches a file-name run');
    ok(!P('.planning/phases/22-safety-rails-audit/x/22-SUMMARY.md', '.planning/phases/22-safety-rails-audit/*-SUMMARY.md'), 'star does not cross a slash');
    ok(P('.planning/phases/22-safety-rails-audit/22-REVIEW-FIX.md', '.planning/phases/22-safety-rails-audit/*-REVIEW*.md'), 'two stars in one pattern');
    const draws = Array.from({ length: 500 }, (_, i) => randomHexStrong(i % 2 ? 20 : 32));
    ok(draws.every((h) => shannon(h) >= 3.65 && shannon(`0x${h}`) >= 3.65), 'planted fixture values clear the scanner entropy floor (500 draws, bare and 0x forms at least 3.65)');

    const dir = mkTemp('csb-seal-st-');
    const hooks = mkTemp('csb-seal-st-hooks-');
    try {
        const g = fixtureGit(dir, hooks);
        const put = (rel: string, text: string) => {
            fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
            fs.writeFileSync(path.join(dir, rel), text);
        };
        const commit = (m: string) => {
            g('add', '-A');
            g('commit', '-q', '-m', m);
        };
        g('init', '-q');
        put('src/a.ts', 'export const a = 1;\n');
        put('.planning/audit/findings/x.json', '{}\n');
        put('.planning/audit/AUDIT-FINDINGS.md', 'findings\n');
        put('.planning/audit/OPERATOR-DECISIONS.md', 'decisions\n');
        put('.planning/STATE.md', 'state\n');
        put('.planning/state.json', '{}\n');
        put('.planning/phases/22-safety-rails-audit/22-ORCHESTRATOR-NOTES.md', 'n\n');
        commit('start');
        const startSha = g('rev-parse', 'HEAD');
        put('src/b.ts', 'export const b = 2;\n');
        commit('sealed revision');
        const sealed = g('rev-parse', 'HEAD');
        const scanText = '{"hit_counts":{"non-public":0}}\n';
        put(SCAN_REL, scanText);
        const baseSeal = () => ({
            sealed_sha: sealed,
            sealed_at: '2026-11-09T00:00:00Z',
            phase_start_sha: startSha,
            scan: { range: `${startSha}..${sealed}`, non_public: 0, known_public: 0, phase_scan_sha256: sha256(scanText) },
            final_check: 'pass',
            render_sha256: { findings: sha256('findings\n'), decisions: sha256('decisions\n') },
            exempt_paths: REAL_EXEMPT,
            rule: 'any later change outside exempt_paths invalidates this seal; run seal-verify.ts --scan',
        });
        put(SEAL_REL, JSON.stringify(baseSeal(), null, 2) + '\n');
        commit('seal record');
        const base = g('rev-parse', 'HEAD');
        const reset = () => g('checkout', '-q', '-B', 'case', base);

        const sameList = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
        const run = (name: string, mutate: () => void, expectValid: boolean, reason?: string, o: { changed?: string[]; seal_rel?: string; from?: () => void } = {}) => {
            (o.from ?? reset)();
            mutate();
            const r = verifySeal(dir, { scan: false, seal_rel: o.seal_rel });
            const changedOk = !o.changed || sameList(r.changed, o.changed);
            ok(
                r.valid === expectValid && (!reason || r.reasons.join(' ').includes(reason)) && changedOk,
                `${name}: ${r.valid ? 'VALID' : `INVALID (${r.reasons.join('; ')})`}${o.changed ? ` changed [${r.changed.join(', ')}]` : ''}`,
            );
        };

        run('no later change', () => {}, true);
        run('STATE.md (literal exempt)', () => { put('.planning/STATE.md', 'state2\n'); commit('c'); }, true);
        run('later SUMMARY (exempt glob)', () => { put('.planning/phases/22-safety-rails-audit/22-29-SUMMARY.md', 's\n'); commit('c'); }, true);
        run('later REVIEW-FIX (exempt double-star glob)', () => { put('.planning/phases/22-safety-rails-audit/22-REVIEW-FIX.md', 'r\n'); commit('c'); }, true);
        run('workflow bookkeeping files', () => {
            put('.planning/state.json', '{"a":1}\n');
            put('.planning/phases/22-safety-rails-audit/22-ORCHESTRATOR-NOTES.md', 'n2\n');
            put('.planning/phases/22-safety-rails-audit/.continue-here.md', 'c\n');
            commit('c');
        }, true);
        run('source change after the seal', () => { put('src/a.ts', 'export const a = 2;\n'); commit('c'); }, false, 'src/a.ts');
        run('register change after the seal', () => { put('.planning/audit/findings/x.json', '{"z":1}\n'); commit('c'); }, false, '.planning/audit/findings/x.json');
        run('a file one folder below an exempt pattern', () => { put('.planning/phases/22-safety-rails-audit/sub/22-29-SUMMARY.md', 's\n'); commit('c'); }, false, 'sub/22-29-SUMMARY.md');
        run('a name that only starts like an exempt path', () => { put('.planning/STATE.md.bak', 's\n'); commit('c'); }, false, 'STATE.md.bak');
        run('rename of a non-exempt file onto an exempt path', () => {
            g('mv', 'src/b.ts', '.planning/phases/22-safety-rails-audit/b-SUMMARY.md');
            commit('c');
        }, false, 'src/b.ts');
        run('a file changed and changed back', () => {
            put('src/a.ts', 'export const a = 3;\n');
            commit('c1');
            put('src/a.ts', 'export const a = 1;\n');
            commit('c2');
        }, false, 'src/a.ts');
        run('sealed_sha not an ancestor', () => {
            const tree = g('rev-parse', 'HEAD^{tree}');
            const orphan = g('commit-tree', tree, '-m', 'orphan');
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), sealed_sha: orphan }, null, 2) + '\n');
            commit('c');
        }, false, 'ancestor');
        run('phase-scan.json altered', () => { put(SCAN_REL, '{"hit_counts":{"non-public":1}}\n'); commit('c'); }, false, 'phase_scan_sha256');
        run('a render altered in SEAL.json', () => {
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), render_sha256: { findings: '0'.repeat(64), decisions: sha256('decisions\n') } }, null, 2) + '\n');
            commit('c');
        }, false, 'render_sha256.findings');
        run('final_check not pass', () => {
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), final_check: 'fail' }, null, 2) + '\n');
            commit('c');
        }, false, 'final_check');
        run('scan not clean', () => {
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), scan: { ...baseSeal().scan, non_public: 2 } }, null, 2) + '\n');
            commit('c');
        }, false, 'non_public');

        // --- D-19: merge commits ------------------------------------------------------------
        // A merge (no fast-forward) brings in commits; it must not add the whole merged branch.
        const mergeNoFf = (branch: string, msg: string) => g('merge', '-q', '--no-ff', '-m', msg, branch);
        let floodListing = '';
        run('merge: a pull-request style merge of the sealed branch with an exempt change after the seal reports the exempt path only', () => {
            put('.planning/STATE.md', 'state after the seal\n');
            commit('exempt change after the seal');
            const tip = g('rev-parse', 'HEAD');
            g('checkout', '-q', '-B', 'mainline', startSha);
            mergeNoFf(tip, 'Merge pull request');
            floodListing = g('log', '--format=', '--name-only', '--no-renames', '--diff-merges=first-parent', `${sealed}..HEAD`);
        }, true, undefined, { changed: [SEAL_REL, SCAN_REL, '.planning/STATE.md'] });
        // The fixture really is the D-19 situation: the old first-parent listing names a pre-seal file.
        ok(floodListing.split(/\r?\n/).includes('src/b.ts'), 'merge: the fixture reproduces the D-19 flood (a first-parent listing names the pre-seal src/b.ts)');
        run('merge: a merge commit bringing in a real commit on the branch that adds a non-exempt path is still reported', () => {
            g('checkout', '-q', '-B', 'side');
            put('src/c.ts', 'export const c = 3;\n');
            commit('real commit on the branch');
            g('checkout', '-q', 'case');
            mergeNoFf('side', 'merge side');
        }, false, 'src/c.ts');
        run('merge: a non-exempt file changed and changed back on a merged branch is still reported (inner commits count)', () => {
            g('checkout', '-q', '-B', 'side');
            put('src/a.ts', 'export const a = 3;\n');
            commit('c1');
            put('src/a.ts', 'export const a = 1;\n');
            commit('c2');
            g('checkout', '-q', 'case');
            mergeNoFf('side', 'merge side');
        }, false, 'src/a.ts');
        run('merge: a change made inside a merge commit and undone inside a later merge is still reported (combined listing)', () => {
            g('checkout', '-q', '-B', 'side1');
            put('.planning/STATE.md', 'side1\n');
            commit('side1');
            g('checkout', '-q', 'case');
            g('merge', '-q', '--no-ff', '--no-commit', 'side1');
            put('src/a.ts', 'export const a = 9;\n');
            g('add', '-A');
            g('commit', '-q', '-m', 'merge side1, changing src/a.ts in the merge itself');
            g('checkout', '-q', '-B', 'side2', base);
            put('.planning/state.json', '{"s":2}\n');
            commit('side2');
            g('checkout', '-q', 'case');
            g('merge', '-q', '--no-ff', '--no-commit', 'side2');
            put('src/a.ts', 'export const a = 1;\n');
            g('add', '-A');
            g('commit', '-q', '-m', 'merge side2, undoing it');
        }, false, 'src/a.ts');

        // --- D-19: successor seals ----------------------------------------------------------
        const SUCC_REL = '.planning/audit/SEAL-23.json';
        const SCAN23_REL = '.planning/audit/inputs/phase-scan-23.json';
        const COVERS = '.planning/audit/';
        reset();
        put('.planning/audit/findings/x.json', '{"phase":23}\n');
        put('.planning/audit/AUDIT-FINDINGS.md', 'findings 23\n');
        put('.planning/audit/OPERATOR-DECISIONS.md', 'decisions 23\n');
        put('src/a.ts', 'export const a = 23;\n');
        commit('phase 23 register work');
        const sealed2 = g('rev-parse', 'HEAD');
        // Under the folder, changed from the predecessor's sealed_sha to sealed2 (hand-listed, not computed by the code under test).
        const CHANGED_SINCE = [SEAL_REL, SCAN_REL, '.planning/audit/AUDIT-FINDINGS.md', '.planning/audit/OPERATOR-DECISIONS.md', '.planning/audit/findings/x.json'].sort();
        const scan23 = (o: Record<string, unknown> = {}) =>
            JSON.stringify({ range: `${base}..${sealed2}`, phase_start_sha: base, sealed_sha: sealed2, hit_counts: { 'non-public': 0 }, ...o }, null, 2) + '\n';
        const succ = (scanText: string, o: Record<string, unknown> = {}) => ({
            sealed_sha: sealed2,
            sealed_at: '2026-11-12T00:00:00Z',
            phase_start_sha: base,
            scan: { range: `${base}..${sealed2}`, non_public: 0, known_public: 0, public_address: 0, phase_scan_sha256: sha256(scanText) },
            final_check: 'pass',
            render_sha256: { findings: sha256('findings 23\n'), decisions: sha256('decisions 23\n') },
            exempt_paths: [SUCC_REL, SCAN23_REL],
            rule: 'any later change under covers outside exempt_paths invalidates this seal',
            covers: COVERS,
            previous_seal: SEAL_REL,
            previous_sealed_sha: sealed,
            changed_since_previous: CHANGED_SINCE,
            scan_record: SCAN23_REL,
            scan_start_sha: base,
            ...o,
        });
        const writeSucc = (scanText: string, o: Record<string, unknown> = {}) => {
            put(SCAN23_REL, scanText);
            put(SUCC_REL, JSON.stringify(succ(scanText, o), null, 2) + '\n');
        };
        writeSucc(scan23());
        commit('successor seal record');
        const base2 = g('rev-parse', 'HEAD');
        const reset2 = () => g('checkout', '-q', '-B', 'case2', base2);
        const S = { seal_rel: SUCC_REL, from: reset2 };
        const runS = (name: string, mutate: () => void, expectValid: boolean, reason?: string, changed?: string[]) => run(name, mutate, expectValid, reason, { ...S, changed });

        runS('successor: no later change (only the seal record and its scan are under the folder)', () => {}, true, undefined, [SCAN23_REL, SUCC_REL]);
        run('successor: the default seal (SEAL.json) still judges every path, so the same tree is INVALID for it', () => {}, false, 'findings/x.json', { from: reset2 });
        runS('successor: permitted change outside the folder (a src/ change after the seal) stays VALID', () => {
            put('src/a.ts', 'export const a = 24;\n');
            put('.planning/STATE.md', 'later\n');
            commit('c');
        }, true, undefined, [SCAN23_REL, SUCC_REL]);
        runS('successor: audit-folder tampering after the seal (a register file) is INVALID', () => {
            put('.planning/audit/findings/x.json', '{"phase":23,"tampered":true}\n');
            commit('c');
        }, false, 'findings/x.json');
        runS('successor: audit-folder tampering after the seal (the predecessor SEAL.json) is INVALID', () => {
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), final_check: 'fail' }, null, 2) + '\n');
            commit('c');
        }, false, SEAL_REL);
        runS('successor: audit-folder tampering after the seal (a new file, changed and removed again) is INVALID', () => {
            put('.planning/audit/new.json', '{}\n');
            commit('c1');
            g('rm', '-q', '--', '.planning/audit/new.json');
            commit('c2');
        }, false, '.planning/audit/new.json');
        runS('successor: audit-folder tampering after the seal (a letter-case variant of the folder) is INVALID', () => {
            fs.writeFileSync(path.join(hooks, 'blob.txt'), 'case variant\n');
            const blob = g('hash-object', '-w', '--', normSlashes(path.join(hooks, 'blob.txt')));
            g('update-index', '--add', '--cacheinfo', `100644,${blob},.PLANNING/Audit/evil.json`);
            g('commit', '-q', '-m', 'case variant');
        }, false, '.PLANNING/Audit/evil.json');
        runS('successor: a pull-request style merge after the seal stays VALID (merge handling under covers)', () => {
            put('.planning/STATE.md', 'after successor\n');
            commit('exempt change after the successor');
            const tip = g('rev-parse', 'HEAD');
            g('checkout', '-q', '-B', 'mainline', startSha);
            mergeNoFf(tip, 'Merge pull request');
        }, true, undefined, [SCAN23_REL, SUCC_REL]);
        runS('successor: predecessor linkage, a wrong previous_sealed_sha is INVALID', () => {
            put(SUCC_REL, JSON.stringify(succ(scan23(), { previous_sealed_sha: startSha }), null, 2) + '\n');
            commit('c');
        }, false, 'previous_sealed_sha is not the sealed_sha');
        runS('successor: predecessor linkage, previous_seal naming no record at sealed_sha is INVALID', () => {
            put(SUCC_REL, JSON.stringify(succ(scan23(), { previous_seal: '.planning/audit/SEAL-21.json' }), null, 2) + '\n');
            commit('c');
        }, false, 'previous_seal');
        runS('successor: predecessor linkage, a previous seal that is not an ancestor of sealed_sha is INVALID', () => {
            // The predecessor record at sealed3 names an orphan commit, and the successor links to it consistently.
            const orphan = g('commit-tree', g('rev-parse', 'HEAD^{tree}'), '-m', 'orphan');
            g('checkout', '-q', '-B', 'case3', sealed2);
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), sealed_sha: orphan }, null, 2) + '\n');
            commit('predecessor names an orphan');
            const sealed3 = g('rev-parse', 'HEAD');
            const t = scan23({ range: `${base}..${sealed3}`, sealed_sha: sealed3 });
            put(SCAN23_REL, t);
            put(SUCC_REL, JSON.stringify(succ(t, { sealed_sha: sealed3, previous_sealed_sha: orphan, scan: { ...succ(t).scan, range: `${base}..${sealed3}` } }), null, 2) + '\n');
            commit('successor');
        }, false, 'previous_sealed_sha is not an ancestor of sealed_sha');
        runS('successor: scan substitution, a scan file that does not match the record digest is INVALID', () => {
            put(SCAN23_REL, scan23({ note: 'substituted' }));
            commit('c');
        }, false, 'phase_scan_sha256');
        runS('successor: scan substitution, a scan of another range (other start) re-digested in the record is INVALID', () => {
            writeSucc(scan23({ range: `${startSha}..${sealed2}`, phase_start_sha: startSha }));
            commit('c');
        }, false, 'phase_start_sha is not the record');
        runS('successor: scan substitution, a scan of another revision (other end) re-digested in the record is INVALID', () => {
            writeSucc(scan23({ range: `${base}..${sealed}`, sealed_sha: sealed }));
            commit('c');
        }, false, 'sealed_sha is not the record');
        runS('successor: scan substitution, the record pointed at the Phase 22 scan file is INVALID', () => {
            put(SUCC_REL, JSON.stringify(succ(scanText, { scan_record: SCAN_REL }), null, 2) + '\n');
            commit('c');
        }, false, `exempt_paths must list ${SCAN_REL}`);
        runS('successor: scan substitution, a scan file reporting a non-public hit is INVALID', () => {
            writeSucc(scan23({ hit_counts: { 'non-public': 1 } }));
            commit('c');
        }, false, 'non-public is not 0');
        runS('successor: a record whose scan.range is not scan_start_sha..sealed_sha is INVALID', () => {
            const t = scan23();
            put(SUCC_REL, JSON.stringify(succ(t, { scan: { ...succ(t).scan, range: `${startSha}..${sealed2}` } }), null, 2) + '\n');
            commit('c');
        }, false, 'scan.range is not');
        runS('successor: changed_since_previous missing a path is INVALID', () => {
            put(SUCC_REL, JSON.stringify(succ(scan23(), { changed_since_previous: CHANGED_SINCE.filter((p) => !p.endsWith('x.json')) }), null, 2) + '\n');
            commit('c');
        }, false, 'changed_since_previous');
        runS('successor: changed_since_previous naming a path outside the folder is INVALID', () => {
            put(SUCC_REL, JSON.stringify(succ(scan23(), { changed_since_previous: [...CHANGED_SINCE, 'src/a.ts'] }), null, 2) + '\n');
            commit('c');
        }, false, 'changed_since_previous');
        runS('successor: a record missing covers is INVALID (no fallback to a weaker reading)', () => {
            const rec: Record<string, unknown> = succ(scan23());
            delete rec.covers;
            put(SUCC_REL, JSON.stringify(rec, null, 2) + '\n');
            commit('c');
        }, false, 'must carry covers');
        runS('successor: a record not listing itself on exempt_paths is INVALID', () => {
            put(SUCC_REL, JSON.stringify(succ(scan23(), { exempt_paths: [SCAN23_REL] }), null, 2) + '\n');
            commit('c');
        }, false, `exempt_paths must list ${SUCC_REL}`);
        runS('successor: final_check not pass is INVALID', () => {
            put(SUCC_REL, JSON.stringify(succ(scan23(), { final_check: 'fail' }), null, 2) + '\n');
            commit('c');
        }, false, 'final_check');
        runS('successor: a render hash that does not match sealed_sha is INVALID', () => {
            put(SUCC_REL, JSON.stringify(succ(scan23(), { render_sha256: { findings: sha256('findings\n'), decisions: sha256('decisions 23\n') } }), null, 2) + '\n');
            commit('c');
        }, false, 'render_sha256.findings');
        {
            reset2();
            const r = verifySeal(dir, { scan: false, seal_rel: '../SEAL-23.json' });
            ok(!r.valid && r.reasons.join(' ').includes('plain repo-relative'), `successor: --seal outside the repo is refused: ${r.reasons.join('; ')}`);
        }

        // --- --phase-scan bounds and its output guard -----------------------------------------
        reset2();
        put('.planning/baselines/phase-start.json', JSON.stringify({ phase_start_sha: startSha }) + '\n');
        commit('phase-start record');
        const refused = (f: () => unknown, what: string): string => {
            try {
                f();
                return 'not refused';
            } catch (e) {
                return e instanceof Refusal && (e.message.includes(what) || !what) ? 'refused' : `wrong error: ${(e as Error).message}`;
            }
        };
        const b1 = scanBounds(dir, sealed2, base);
        ok(b1.start === base && b1.sealed === sealed2 && b1.start_source === '--start', `phase scan: --start is used when given (${b1.start_source})`);
        const b2 = scanBounds(dir, sealed2);
        ok(b2.start === startSha && b2.start_source === '.planning/baselines/phase-start.json', `phase scan: without --start the start is phase-start.json (${b2.start_source})`);
        let r3 = refused(() => scanBounds(dir, base, sealed2), 'not an ancestor of --sealed');
        ok(r3 === 'refused', `phase scan: a --start after --sealed is refused (${r3})`);
        r3 = refused(() => scanBounds(dir, sealed2, '0'.repeat(40)), 'names no commit');
        ok(r3 === 'refused', `phase scan: a --start naming no commit is refused (${r3})`);
        r3 = refused(() => refuseSealOut(dir, path.join(dir, '.planning', 'audit', 'SEAL.json')), 'seal record');
        ok(r3 === 'refused', `phase scan: --out onto SEAL.json is refused (${r3})`);
        r3 = refused(() => refuseSealOut(dir, path.join(dir, '.planning', 'audit', 'seal-23.JSON')), 'seal record');
        ok(r3 === 'refused', `phase scan: --out onto any SEAL*.json in the audit folder is refused (${r3})`);
        r3 = refused(() => refuseSealOut(dir, path.join(dir, '.planning', 'audit', 'inputs', 'phase-scan-23.json')), '');
        ok(r3 === 'not refused', `phase scan: --out onto a scan record is allowed (${r3})`);

        // The real scanner: a range fixture, then the --scan behaviour of verifySeal.
        const v = verifiedScanner();
        assertFlagParity(v.fixtures);
        const fx = rangeFixture(v.bin, repoRoot);
        for (const c of fx.cases) ok(c.pass, `${c.id}: ${c.observed}`);
        const raw = mkTemp('csb-seal-st-raw-');
        try {
            const scanFn = (from: string, to: string) => scanRange(v.bin, dir, from, to, path.join(raw, randomHex(4))).hits;
            reset();
            put('.planning/phases/22-safety-rails-audit/22-29-SUMMARY.md', 'clean text\n');
            commit('c');
            const clean = verifySeal(dir, { scan: true, scan_fn: scanFn });
            ok(clean.valid, `--scan over a clean later commit: ${clean.valid ? 'VALID' : clean.reasons.join('; ')}`);
            reset();
            put('.planning/phases/22-safety-rails-audit/22-29-SUMMARY.md', `PRIVATE_KEY=0x${randomHexStrong(32)}\n`);
            commit('c');
            const dirty = verifySeal(dir, { scan: true, scan_fn: scanFn });
            ok(!dirty.valid && dirty.reasons.join(' ').includes('non-public'), `--scan over a later key in an exempt file: ${dirty.valid ? 'VALID' : 'INVALID, non-public hit reported'}`);
        } finally {
            rmTree(raw);
        }
    } finally {
        rmTree(dir);
        rmTree(hooks);
    }
    console.log(fails.length ? `RESULT FAIL (${fails.length})` : 'RESULT PASS');
    return fails.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Phase scan (NAC-11)
// ---------------------------------------------------------------------------

export interface ScanLabels {
    phase: string;
    plan: string;
    requirement: string;
}

const PHASE22_LABELS: ScanLabels = { phase: '22-safety-rails-audit', plan: '22-29', requirement: 'NAC-11' };

/**
 * The scan's start and end. `--start` is used when given (a successor seal's own start, D-19);
 * without it the start is .planning/baselines/phase-start.json, the Phase 22 record. Both must be
 * ancestors of HEAD, and the start an ancestor of the end.
 */
export function scanBounds(repo: string, sealedArg: string, startArg?: string): { start: string; sealed: string; start_source: string } {
    const resolve = (x: string, what: string): string => {
        try {
            return gitText(repo, ['rev-parse', '--verify', `${x}^{commit}`]).trim();
        } catch {
            throw new Refusal(`${what} names no commit`);
        }
    };
    const sealed = resolve(sealedArg, '--sealed');
    let start: string;
    let source: string;
    if (startArg !== undefined) {
        start = resolve(startArg, '--start');
        source = '--start';
    } else {
        const startRec = JSON.parse(fs.readFileSync(path.join(repo, '.planning', 'baselines', 'phase-start.json'), 'utf8'));
        start = String(startRec.phase_start_sha);
        source = '.planning/baselines/phase-start.json';
    }
    if (!SHA40.test(start)) throw new Refusal('the scan start is not 40 hex');
    if (!gitOk(repo, ['merge-base', '--is-ancestor', start, 'HEAD'])) throw new Refusal('phase_start_sha is not an ancestor of HEAD; history was rewritten');
    if (!gitOk(repo, ['merge-base', '--is-ancestor', sealed, 'HEAD'])) throw new Refusal('--sealed is not an ancestor of HEAD');
    if (start === sealed || !gitOk(repo, ['merge-base', '--is-ancestor', start, sealed])) throw new Refusal('the scan start is not an ancestor of --sealed');
    return { start, sealed, start_source: source };
}

/** The scan writes metadata only: never onto a seal record (SEAL.json or any SEAL*.json under .planning/audit/). */
export function refuseSealOut(repo: string, outArg: string): void {
    const rel = normSlashes(path.relative(path.resolve(repo), path.resolve(outArg))).toLowerCase();
    if (/^\.planning\/audit\/seal[^/]*\.json$/.test(rel)) throw new Refusal('--out names a seal record; the phase scan never writes one');
}

function phaseScan(repo: string, sealedArg: string, rawDirArg: string, outArg: string, startArg?: string, labels: ScanLabels = PHASE22_LABELS): number {
    const { start, sealed, start_source } = scanBounds(repo, sealedArg, startArg);
    refuseSealOut(repo, outArg);
    const raw = path.resolve(rawDirArg);
    if (isInside(raw, repo)) throw new Refusal('--raw-dir must be outside the repo');
    if (fs.existsSync(raw) && fs.readdirSync(raw).length !== 0) throw new Refusal('--raw-dir must be new or empty');
    if (isInside(path.resolve(outArg), raw)) throw new Refusal('--out must not be inside --raw-dir');

    const v = verifiedScanner();
    assertFlagParity(v.fixtures);
    const boundary = networkBoundary(v.bin);
    const fixture = rangeFixture(v.bin, repo);
    for (const c of fixture.cases) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.id}: ${c.observed}`);
    if (!fixture.pass) throw new Refusal('the range fixture failed; the log-opts do not cover what NAC-11 needs');

    const set = scanRange(v.bin, repo, start, sealed, raw);
    const inRange = new Set(gitText(repo, ['rev-list', `${start}..${sealed}`]).split(/\r?\n/).filter(Boolean));
    const outside = set.hits.filter((h) => !inRange.has(h.commit)).length;
    if (outside) throw new Error(`${outside} hit(s) fall outside the commit range`);
    const count = (c: string) => set.hits.filter((h) => h.classification === c).length;
    const nonPublic = count(NON_PUBLIC);
    const doc = {
        tool: 'betterleaks',
        version: v.version,
        binary_sha256: v.exeSha,
        config_sha256: v.configSha,
        fixtures_sha256: sha256(fs.readFileSync(FIXTURES_JSON)),
        engine: '.planning/audit/tools/seal-verify.ts --phase-scan (three-pass classification, operator ruling classify-addresses)',
        mode: 'git',
        range: set.range,
        log_opts: set.log_opts,
        scanner_args: scannerArgs('<repo root>', '<log_opts>', '<extended.toml|known-public.toml|public-address.toml>', '<report.json>', '<empty temp dir>'),
        env_belt: `HTTPS_PROXY=HTTP_PROXY=ALL_PROXY=${NET_BELT} (belt only, not an enforced network boundary)`,
        network_boundary: boundary,
        scanned_at: new Date().toISOString(),
        node: process.version,
        git_version: gitText(repo, ['--version']).trim(),
        range_fixture: fixture,
        phase_start_sha: start,
        phase_start_source: start_source,
        sealed_sha: sealed,
        phase_start_is_ancestor_of_head: true,
        history_rewritten: false,
        commits_in_range: inRange.size,
        bytes_scanned: set.bytes_scanned,
        pass_counts: set.pass_counts,
        raw_report_dir: normSlashes(raw),
        raw_reports: set.raw_reports,
        classification_labels: {
            [NON_PUBLIC]: 'reported by all three passes',
            [KNOWN_PUBLIC]: 'reported by pass 1, removed by the pass-2 Hardhat #0 allowlist',
            [PUBLIC_ADDRESS]: 'reported by passes 1 and 2, removed by the pass-3 allowlist: the flagged secret is exactly 0x + 40 hex (operator ruling "classify-addresses", ESC-SECRET-01)',
        },
        classification_key: ['rule id', 'file', 'commit', 'line', 'start column', 'end column'],
        hit_counts: { total: set.hits.length, [NON_PUBLIC]: nonPublic, [KNOWN_PUBLIC]: count(KNOWN_PUBLIC), [PUBLIC_ADDRESS]: count(PUBLIC_ADDRESS) },
        hits: set.hits,
        value_policy: 'hits hold rule id, file, commit, line, column, type and classification only; raw redacted reports stay in raw_report_dir outside the repo',
        phase: labels.phase,
        plan: labels.plan,
        requirement: labels.requirement,
    };
    fs.mkdirSync(path.dirname(path.resolve(outArg)), { recursive: true });
    fs.writeFileSync(path.resolve(outArg), JSON.stringify(doc, null, 2) + '\n');
    console.log(`PHASE-SCAN range=${set.range} commits=${inRange.size} hits=${set.hits.length} non-public=${nonPublic} known-public=${count(KNOWN_PUBLIC)} public-address=${count(PUBLIC_ADDRESS)}`);
    console.log(`RESULT ${nonPublic === 0 ? 'CLEAN (zero non-public hits)' : `NON-PUBLIC HITS: ${nonPublic}`}`);
    return nonPublic === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function repoRootDefault(): string {
    return path.resolve(HERE, '..', '..', '..');
}

function main(): number {
    const repo = path.resolve(argValue('repo') ?? repoRootDefault());
    if (hasFlag('self-test')) return selfTest(repo);
    if (hasFlag('phase-scan')) {
        const sealed = argValue('sealed');
        const raw = argValue('raw-dir');
        const out = argValue('out');
        if (!sealed || !raw || !out) throw new Refusal('--phase-scan needs --sealed, --raw-dir and --out');
        const start = argValue('start');
        if (start === undefined) {
            if (hasFlag('phase-name') || hasFlag('plan-id') || hasFlag('requirement')) throw new Refusal('--phase-name, --plan-id and --requirement go with --start');
            return phaseScan(repo, sealed, raw, out);
        }
        // A scan from another start describes another phase: its record must say which, never the Phase 22 labels.
        const phase = argValue('phase-name');
        const plan = argValue('plan-id');
        const requirement = argValue('requirement');
        if (!phase || !plan || !requirement) throw new Refusal('--start needs --phase-name, --plan-id and --requirement for the scan record');
        return phaseScan(repo, sealed, raw, out, start, { phase, plan, requirement });
    }
    const doScan = hasFlag('scan');
    let scanFn: ((from: string, to: string) => Hit[]) | undefined;
    let rawDir: string | null = null;
    if (doScan) {
        const v = verifiedScanner();
        assertFlagParity(v.fixtures);
        networkBoundary(v.bin);
        const fixture = rangeFixture(v.bin, repo);
        if (!fixture.pass) throw new Refusal('the range fixture failed');
        rawDir = mkTemp('csb-seal-scan-');
        const base = rawDir;
        scanFn = (from, to) => {
            const set = scanRange(v.bin, repo, from, to, path.join(base, 'range'));
            const count = (c: string) => set.hits.filter((h) => h.classification === c).length;
            console.log(`seal-verify: scanned ${set.range}: ${set.hits.length} hit(s), non-public ${count(NON_PUBLIC)}, known-public ${count(KNOWN_PUBLIC)}, public-address ${count(PUBLIC_ADDRESS)}`);
            return set.hits;
        };
    }
    const sealRel = argValue('seal') ?? SEAL_REL;
    if (hasFlag('seal') && argValue('seal') === undefined) throw new Error('--seal needs a repo-relative path');
    console.log(`seal-verify: seal record ${sealRel}`);
    const r = verifySeal(repo, { scan: doScan, scan_fn: scanFn, seal_rel: sealRel });
    if (r.changed.length) console.log(`seal-verify: changed after the seal: ${r.changed.join(', ')}`);
    if (r.outside_covers) console.log(`seal-verify: ${r.outside_covers} changed path(s) lie outside the seal's covers and are not judged`);
    if (rawDir) {
        if (r.reasons.some((x) => x.includes('non-public'))) console.log(`seal-verify: raw reports kept at ${normSlashes(rawDir)} (redacted)`);
        else rmTree(rawDir);
    }
    if (r.valid) {
        console.log('SEAL VALID');
        return 0;
    }
    console.log(`SEAL INVALID: ${r.reasons.join('; ')}`);
    return 1;
}

try {
    process.exitCode = main();
} catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (hasFlag('phase-scan') || hasFlag('self-test')) {
        console.error(`seal-verify: ${e instanceof Refusal ? 'REFUSED' : 'CRASH'}: ${msg}`);
        process.exitCode = 2;
    } else {
        console.log(`SEAL INVALID: ${msg}`);
        process.exitCode = 1;
    }
}
