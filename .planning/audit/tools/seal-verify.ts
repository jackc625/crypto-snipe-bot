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
//   seal-verify.ts [--scan] [--repo <repo root>]
//       Prints `SEAL VALID` or `SEAL INVALID: <reasons>`. Exit 0 valid, 1 invalid.
//   seal-verify.ts --phase-scan --sealed <sha> --raw-dir <dir outside the repo> --out <json>
//       The NAC-11 scan of phase_start_sha..<sha>. Writes metadata only. Exit 0 clean,
//       1 any non-public hit, 2 refusal or crash.
//   seal-verify.ts --self-test
//       Throwaway repos under os.tmpdir(): the exempt-pattern and tamper cases, and a
//       range-scan fixture run through the real scanner. Exit 0 pass, 1 fail.
//
// Exempt paths are patterns: `*` matches any run of characters except `/`, everything
// else is literal, and the pattern must match the whole path. A path on the list is
// still scanned by --scan; the list only says it may change.
//
// A later change is found two ways: the net diff, and the paths touched by each later
// commit, both with renames off. So a non-exempt file changed and changed back, or
// renamed onto an exempt path, still shows up.
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
        const before = randomHex(32);
        const inside = randomHex(32);
        const addr = randomHex(20);
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
    changed: string[];
}

export function verifySeal(repo: string, opts: { scan: boolean; scan_fn?: (from: string, to: string) => Hit[] }): SealResult {
    const reasons: string[] = [];
    const sealPath = path.join(repo, ...SEAL_REL.split('/'));
    if (!fs.existsSync(sealPath)) return { valid: false, reasons: ['SEAL.json is missing'], changed: [] };
    const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
    const sealed = String(seal.sealed_sha);
    const start = String(seal.phase_start_sha);
    const patterns: string[] = Array.isArray(seal.exempt_paths) ? seal.exempt_paths.map(String) : [];
    if (!/^[0-9a-f]{40}$/.test(sealed)) return { valid: false, reasons: ['sealed_sha is not 40 hex'], changed: [] };
    if (!/^[0-9a-f]{40}$/.test(start)) return { valid: false, reasons: ['phase_start_sha is not 40 hex'], changed: [] };
    if (!gitOk(repo, ['cat-file', '-e', `${sealed}^{commit}`])) return { valid: false, reasons: ['sealed_sha names no commit'], changed: [] };

    for (const rel of [SEAL_REL, SCAN_REL]) if (!patterns.includes(rel)) reasons.push(`exempt_paths must list ${rel}`);
    if (!gitOk(repo, ['merge-base', '--is-ancestor', sealed, 'HEAD'])) return { valid: false, reasons: [...reasons, 'sealed_sha is not an ancestor of HEAD'], changed: [] };
    if (!gitOk(repo, ['merge-base', '--is-ancestor', start, 'HEAD'])) reasons.push('phase_start_sha is not an ancestor of HEAD');
    if (seal.final_check !== 'pass') reasons.push('SEAL.json final_check is not "pass"');
    if (!seal.scan || seal.scan.non_public !== 0) reasons.push('SEAL.json scan.non_public is not 0');

    const scanFile = path.join(repo, ...SCAN_REL.split('/'));
    if (!fs.existsSync(scanFile)) reasons.push('phase-scan.json is missing');
    else if (sha256(fs.readFileSync(scanFile)) !== seal.scan?.phase_scan_sha256) reasons.push('phase-scan.json does not match SEAL.json phase_scan_sha256');

    for (const [key, rel] of Object.entries(RENDERS)) {
        let blob = '';
        try {
            blob = sha256(gitOut(repo, ['cat-file', '-p', `${sealed}:${rel}`]));
        } catch {
            blob = 'missing';
        }
        if (blob !== seal.render_sha256?.[key]) reasons.push(`${rel} at sealed_sha does not match SEAL.json render_sha256.${key}`);
    }

    const range = `${sealed}..HEAD`;
    const changed = new Set<string>([
        ...splitNul(gitText(repo, ['diff', '--no-renames', '--name-only', '-z', range])),
        ...splitNul(gitText(repo, ['log', '--format=', '--name-only', '-z', '--no-renames', '--diff-merges=first-parent', range])),
    ]);
    const list = [...changed].sort();
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
    return { valid: reasons.length === 0, reasons, changed: list };
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

        const run = (name: string, mutate: () => void, expectValid: boolean, reason?: string) => {
            reset();
            mutate();
            const r = verifySeal(dir, { scan: false });
            ok(r.valid === expectValid && (!reason || r.reasons.join(' ').includes(reason)), `${name}: ${r.valid ? 'VALID' : `INVALID (${r.reasons.join('; ')})`}`);
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
            put('.planning/phases/22-safety-rails-audit/22-29-SUMMARY.md', `PRIVATE_KEY=0x${randomHex(32)}\n`);
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

function phaseScan(repo: string, sealedArg: string, rawDirArg: string, outArg: string): number {
    const sealed = gitText(repo, ['rev-parse', '--verify', `${sealedArg}^{commit}`]).trim();
    const startRec = JSON.parse(fs.readFileSync(path.join(repo, '.planning', 'baselines', 'phase-start.json'), 'utf8'));
    const start = String(startRec.phase_start_sha);
    if (!gitOk(repo, ['merge-base', '--is-ancestor', start, 'HEAD'])) throw new Refusal('phase_start_sha is not an ancestor of HEAD; history was rewritten');
    if (!gitOk(repo, ['merge-base', '--is-ancestor', sealed, 'HEAD'])) throw new Refusal('--sealed is not an ancestor of HEAD');
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
        phase: '22-safety-rails-audit',
        plan: '22-29',
        requirement: 'NAC-11',
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
        return phaseScan(repo, sealed, raw, out);
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
    const r = verifySeal(repo, { scan: doScan, scan_fn: scanFn });
    if (r.changed.length) console.log(`seal-verify: changed after the seal: ${r.changed.join(', ')}`);
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
