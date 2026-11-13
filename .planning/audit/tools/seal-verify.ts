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
// The seal record is read from git, never from the working tree (Phase 23 review CR-10). The copy
// judged is the one first committed after sealed_sha (the anchor): the record must be added exactly
// once in sealed_sha..HEAD, and HEAD's copy must be byte-identical to the anchor's. A later edit to
// the record (a widened exempt list, a moved sealed_sha), an uncommitted edit, a second add, or a
// record committed before the revision it seals is INVALID; a re-seal is a new record. The scan
// record is read at HEAD, and an uncommitted edit to it is INVALID too.
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
//       Throwaway repos under os.tmpdir(): the exempt-pattern, tamper, merge, successor and
//       reviewed-hit cases, and a range-scan fixture run through the real scanner. Exit 0 pass, 1 fail.
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
//   - a hit labelled reviewed-inert in the scan record must sit at a REVIEWED_HITS location
//     whose ruling record is committed at sealed_sha, and the counts must match the hits
// SEAL.json itself is only ever read; no code path in this tool writes it.
//
// Reviewed hits (Phase 23 plan 23-26, operator ruling ESC-SECRET-03). --phase-scan labels a
// non-public hit reviewed-inert only when its rule id, file, commit, line and column equal one
// REVIEWED_HITS entry and that entry's ruling record, read at --sealed, has the operator's answer
// and lists the same location. Anything else stays non-public. --scan applies the same list, with
// each ruling read at the seal's sealed_sha (Phase 23 review WR-32).
//
// The scanner rules are those of fixture-check.ts --git-scan (22-26): the verified
// binary, the fixture-proven configs, the proxy belt, --redact, three-pass
// classification keyed on line and columns. Only the --log-opts range differs, and that
// range is proven here by rangeFixture() before any real scan. Raw reports stay out of
// the repo. No secret value is ever printed or written by this tool.
//
// --scan scans only what is new after the seal (WR-32): its log options list each merge commit by
// its remerge diff (the merge's result against git's own re-merge of its parents), not by its
// first-parent diff. A pull-request merge of the sealed branch then adds nothing of its own, the
// commits it brings in are each scanned, and content written in the merge itself (a conflict
// resolution, an edit made during the merge) is still scanned. The first-parent listing scanned
// the whole merged branch, including content committed before the seal, so the operator-ruled
// locations came back as non-public. mergeScanFixture() proves these log options before any real
// --scan. --phase-scan keeps its first-parent options (its records name them).
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
// --scan only (WR-32): a merge commit is listed by its remerge diff, so only what the merge itself wrote is scanned
export const SCAN_LOG_OPTS = '--full-history --diff-filter=tuxdb --diff-merges=remerge';

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

// ---------------------------------------------------------------------------
// Reviewed hits (Phase 23 plan 23-26, operator ruling ESC-SECRET-03)
// ---------------------------------------------------------------------------
//
// One rule, and only for --phase-scan: a hit the three passes call non-public is labelled
// reviewed-inert instead when its rule id, file, commit, line and column all equal one entry
// below, and that entry cites an operator ruling record that has the operator's answer and lists
// the same location. The same text in another file, another commit, on another line or column,
// or under another rule is still non-public and still blocks a seal. --scan (the commits after a
// seal) keeps the plain three-pass classification.

const REVIEWED_INERT = 'reviewed-inert';
const RULING_RE = /^ESC-[A-Z0-9]+-\d{2}$/;
const ESCALATIONS_REL = '.planning/audit/escalations';

interface HitLocation {
    rule_id: string;
    file: string;
    commit: string;
    line: number;
    column: number;
}

export interface ReviewedHit extends HitLocation {
    /** The escalation record that holds the operator's ruling on this exact location. */
    ruling: string;
    why: string;
}

export const REVIEWED_HITS: ReviewedHit[] = [
    {
        rule_id: 'generic-api-key',
        file: 'test/realpath/triage/fixtures/hostHeaderCrash.ts',
        commit: '3a449f54f89786b446c0f6e6e15cc2cdeb1e0390',
        line: 99,
        column: 28,
        ruling: 'ESC-SECRET-03',
        why: 'the RFC 6455 handshake sample nonce sent on a WebSocket upgrade request (AUD-SECRET-006)',
    },
    {
        rule_id: 'generic-credential-uri',
        file: 'test/realpath/recordingsGuard.test.ts',
        commit: 'babd7e40f002f0efa42810ed59990822ddc2f20a',
        line: 421,
        column: 80,
        ruling: 'ESC-SECRET-03',
        why: 'the planted placeholder URL the recordings guard test uses to prove a URL with a user name and password is refused (AUD-SECRET-007)',
    },
];

export function sameLocation(a: HitLocation, b: HitLocation): boolean {
    return (
        a.rule_id === b.rule_id &&
        a.file === b.file &&
        a.commit === b.commit &&
        a.line === b.line &&
        a.column === b.column
    );
}

const where = (e: HitLocation): string => `${e.rule_id} ${e.file}:${e.line}:${e.column}@${String(e.commit).slice(0, 8)}`;

/** Refuses the list unless every entry is a full location citing a ruling record that has the operator's answer and lists that exact location. */
export function checkReviewedList(list: ReviewedHit[], readRuling: (id: string) => any): void {
    const seen: HitLocation[] = [];
    for (const e of list) {
        const full = typeof e.rule_id === 'string' && e.rule_id !== '' && isPlainRel(e.file) && SHA40.test(e.commit) && Number.isInteger(e.line) && e.line >= 1 && Number.isInteger(e.column) && e.column >= 1;
        if (!full) throw new Refusal(`reviewed hit ${where(e)} is not a full location (rule id, file, 40-hex commit, line, column)`);
        if (typeof e.ruling !== 'string' || !RULING_RE.test(e.ruling)) throw new Refusal(`reviewed hit ${where(e)} cites no ruling record`);
        const rec = readRuling(e.ruling);
        if (!rec || typeof rec !== 'object') throw new Refusal(`reviewed hit ${where(e)}: ruling ${e.ruling} is missing`);
        if (typeof rec.operator_response !== 'string' || rec.operator_response.trim() === '') throw new Refusal(`reviewed hit ${where(e)}: ruling ${e.ruling} has no operator response`);
        const listed = Array.isArray(rec.resolution?.reviewed_hits) && rec.resolution.reviewed_hits.some((r: HitLocation) => sameLocation(r, e));
        if (!listed) throw new Refusal(`reviewed hit ${where(e)}: ruling ${e.ruling} does not list this exact location`);
        if (seen.some((s) => sameLocation(s, e))) throw new Refusal(`reviewed hit ${where(e)} is listed twice`);
        seen.push(e);
    }
}

/** Labels a non-public hit reviewed-inert only when one entry names its exact location; every other hit is returned unchanged. */
export function applyReviewed(hits: Hit[], list: ReviewedHit[]): Hit[] {
    return hits.map((h) => (h.classification === NON_PUBLIC && list.some((e) => sameLocation(e, h)) ? { ...h, classification: REVIEWED_INERT } : h));
}

/** A ruling record as committed at `rev` (never the working tree), or null. */
function rulingAt(repo: string, rev: string): (id: string) => any {
    return (id: string) => {
        if (!RULING_RE.test(id)) return null;
        try {
            return JSON.parse(gitText(repo, ['cat-file', '-p', `${rev}:${ESCALATIONS_REL}/${id}.json`]));
        } catch {
            return null;
        }
    };
}

function tempLeftovers(): string[] {
    return fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(BL_GIT_TEMP_PREFIX)).sort();
}

export function scanRange(bin: string, repo: string, from: string, to: string, rawDir: string, baseLogOpts: string = RANGE_LOG_OPTS): ScanSet {
    if (!/^[0-9a-f]{40}$/.test(from) || !/^[0-9a-f]{40}$/.test(to)) throw new Refusal('the scan range must be two 40-hex commits');
    if (baseLogOpts !== RANGE_LOG_OPTS && baseLogOpts !== SCAN_LOG_OPTS) throw new Refusal('unknown scan log options');
    const range = `${from}..${to}`;
    const logOpts = `${baseLogOpts} ${range}`;
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
 *
 * It also holds no run of four or more letters a-f (23-26 continuation, measured): such a run
 * can spell a stop word (feed, dead, added, faded, ceded seen), and the default generic-api-key
 * rule skips any value containing one. Of 3000 entropy-qualified addresses the scanner missed 8,
 * every one holding such a word, and missed the same 8 again alone; that was the residual
 * intermittent range-public-address failure. The project's evm-private-key rule has no stop
 * words (1000 of 1000 keys with a word inside were reported). AUD-SECRET-008.
 */
const STOPWORD_RUN = /[a-f]{4}/;
export function randomHexStrong(bytes: number): string {
    for (let i = 0; i < 1000; i++) {
        const h = randomHex(bytes);
        if (shannon(h) >= 3.65 && shannon(`0x${h}`) >= 3.65 && !STOPWORD_RUN.test(h)) return h;
    }
    throw new Error('could not draw a high-entropy fixture value');
}

export interface RangeFixture {
    pass: boolean;
    cases: { id: string; pass: boolean; observed: string }[];
}

/** Proves the range log-opts: a key before the range is not reported, one inside it is. Keys are random and never printed. */
export function rangeFixture(bin: string, repoForHardhat: string, baseLogOpts: string = RANGE_LOG_OPTS): RangeFixture {
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
        const set = scanRange(bin, fx, shaB, shaD, raw, baseLogOpts);
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

/**
 * Proves the --scan log options on merges (WR-32). The range starts at the sealed revision S of a
 * branch that is then merged pull-request style into a mainline that forked before it:
 *   - a key committed on the branch BEFORE S, merged in after S, is not reported;
 *   - a key in a commit on a merged side branch inside the range is reported, at that commit;
 *   - a key written in a merge commit itself (an edit made during the merge) is reported, at the merge;
 *   - a key written in a conflict resolution is reported, at the merge.
 * Keys are random and never printed.
 */
export function mergeScanFixture(bin: string, baseLogOpts: string): RangeFixture {
    const fx = mkTemp('csb-seal-merge-');
    const raw = mkTemp('csb-seal-merge-raw-');
    const hooks = mkTemp('csb-seal-merge-hooks-');
    const cases: { id: string; pass: boolean; observed: string }[] = [];
    try {
        const g = fixtureGit(fx, hooks);
        const put = (rel: string, text: string) => fs.writeFileSync(path.join(fx, rel), text);
        const commit = (m: string) => {
            g('add', '-A');
            g('commit', '-q', '-m', m);
            return g('rev-parse', 'HEAD');
        };
        const [before, side, inMerge, resolution] = [0, 1, 2, 3].map(() => randomHexStrong(32));
        g('init', '-q');
        put('base.ts', 'export const base = 1;\n');
        put('f.ts', 'export const f = 0;\n');
        const root = commit('root');
        g('checkout', '-q', '-b', 'phase');
        put('before.ts', `PRIVATE_KEY=0x${before}\n`);
        commit('a key before the seal');
        put('inert.ts', 'export const inert = 1;\n');
        const sealedS = commit('the sealed revision');
        put('after.ts', 'export const after = 1;\n');
        const tip = commit('a clean commit after the seal');
        g('checkout', '-q', '-b', 'mainline', root);
        put('main.ts', 'export const main = 1;\n');
        commit('mainline work');
        g('merge', '-q', '--no-ff', '-m', 'Merge pull request (phase)', tip);
        const prMerge = g('rev-parse', 'HEAD');
        // A side branch with a key in its own commit, merged in.
        g('checkout', '-q', '-b', 'side', prMerge);
        put('side.ts', `PRIVATE_KEY=0x${side}\n`);
        const sideCommit = commit('a key on a side branch');
        g('checkout', '-q', 'mainline');
        put('main2.ts', 'export const main2 = 1;\n');
        commit('more mainline work');
        g('merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
        // A clean merge with a key added during the merge itself.
        g('checkout', '-q', '-b', 'clean', 'mainline');
        put('clean.ts', 'export const clean = 1;\n');
        commit('a clean branch');
        g('checkout', '-q', 'mainline');
        g('merge', '-q', '--no-ff', '--no-commit', 'clean');
        put('evil.ts', `PRIVATE_KEY=0x${inMerge}\n`);
        const evilMerge = commit('Merge clean, adding a file during the merge');
        // A conflicting merge whose resolution writes a key.
        g('checkout', '-q', '-b', 'x', 'mainline');
        put('f.ts', 'export const f = 1;\n');
        commit('x edits f');
        g('checkout', '-q', 'mainline');
        put('f.ts', 'export const f = 2;\n');
        commit('mainline edits f');
        let mergedCleanly = false;
        try {
            g('merge', '-q', '--no-ff', 'x');
            mergedCleanly = true;
        } catch {
            // the expected conflict
        }
        if (mergedCleanly) throw new Error('the conflict fixture merged cleanly');
        put('f.ts', `PRIVATE_KEY=0x${resolution}\n`);
        const conflictMerge = commit('Merge x, resolving the conflict');
        const head = g('rev-parse', 'HEAD');

        const set = scanRange(bin, fx, sealedS, head, raw, baseLogOpts);
        const inFile = (n: string) => set.hits.filter((h) => h.file === n || h.file.endsWith(`/${n}`));
        const add = (id: string, pass: boolean, observed: string) => cases.push({ id, pass, observed });
        const at = (hs: Hit[]) => hs.map((h) => `${h.classification}@${h.commit.slice(0, 8)}`).join(',') || 'none';
        add('merge-excludes-content-committed-before-the-range', inFile('before.ts').length === 0, `before.ts ${at(inFile('before.ts'))}`);
        const sideHits = inFile('side.ts');
        add('merge-includes-a-merged-branch-commit', sideHits.length > 0 && sideHits.every((h) => h.classification === NON_PUBLIC && h.commit === sideCommit), `side.ts ${at(sideHits)}`);
        const evilHits = inFile('evil.ts');
        add('merge-includes-content-written-in-the-merge', evilHits.length > 0 && evilHits.every((h) => h.classification === NON_PUBLIC && h.commit === evilMerge), `evil.ts ${at(evilHits)}`);
        const fHits = inFile('f.ts');
        add('merge-includes-a-conflict-resolution', fHits.length > 0 && fHits.every((h) => h.classification === NON_PUBLIC && h.commit === conflictMerge), `f.ts ${at(fHits)}`);
        const reports = set.raw_reports.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
        const leaked = [before, side, inMerge, resolution].filter((v) => reports.includes(v)).length;
        add('merge-redaction', leaked === 0, `planted values in raw reports: ${leaked}`);
        return { pass: cases.every((c) => c.pass), cases };
    } finally {
        rmTree(fx);
        rmTree(raw);
        rmTree(hooks);
    }
}

/** The --scan scanner: what is new after the seal (SCAN_LOG_OPTS), one raw folder per call under `rawBase`. */
export function postSealScanFn(bin: string, repo: string, rawBase: string, log: (s: string) => void = () => {}): (from: string, to: string) => Hit[] {
    let n = 0;
    return (from, to) => {
        const set = scanRange(bin, repo, from, to, path.join(rawBase, `range-${n++}`), SCAN_LOG_OPTS);
        const count = (c: string) => set.hits.filter((h) => h.classification === c).length;
        log(`seal-verify: scanned ${set.range} (${SCAN_LOG_OPTS}): ${set.hits.length} hit(s), non-public ${count(NON_PUBLIC)}, known-public ${count(KNOWN_PUBLIC)}, public-address ${count(PUBLIC_ADDRESS)}`);
        return set.hits;
    };
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

/** A JSON object committed at `rev:rel`, or null (absent, not JSON, or not an object). */
function jsonObjectAt(repo: string, rev: string, rel: string): Record<string, any> | null {
    try {
        const v: unknown = JSON.parse(gitText(repo, ['cat-file', '-p', `${rev}:${rel}`]));
        return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null;
    } catch {
        return null;
    }
}

/**
 * The commits in `sealed..HEAD` that add `rel`, parents before children (CR-10). Every commit that
 * adds the path counts, a side branch included (--full-history); a merge adds nothing of its own
 * here (--diff-merges=off), so a pull-request merge of the branch that added the record does not
 * count as a second add.
 */
export function recordAdds(repo: string, sealed: string, rel: string): string[] {
    return gitText(repo, ['log', '--reverse', '--topo-order', '--format=%H', '--full-history', '--diff-merges=off', '--no-renames', '--diff-filter=A', `${sealed}..HEAD`, '--', rel])
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
}

export function verifySeal(repo: string, opts: { scan: boolean; scan_fn?: (from: string, to: string) => Hit[]; seal_rel?: string; reviewed?: ReviewedHit[] }): SealResult {
    const reasons: string[] = [];
    const sealRel = opts.seal_rel ?? SEAL_REL;
    const fail = (why: string[]): SealResult => ({ valid: false, reasons: why, changed: [], outside_covers: 0 });
    if (!isPlainRel(sealRel)) return fail([`--seal must be a plain repo-relative path: ${sealRel}`]);
    const sealName = path.posix.basename(sealRel);

    // CR-10: the record is read from git, never from the working tree, and judged as it was first
    // committed after the revision it seals. The record is on its own exempt list (it is committed
    // after sealed_sha), so without this a later edit to it (widening exempt_paths, moving
    // sealed_sha) would turn tampering into SEAL VALID. A later edit is a reason, never a new reading.
    if (!gitOk(repo, ['cat-file', '-e', `HEAD:${sealRel}`])) return fail([`${sealRel} is missing at HEAD (a seal record is judged as committed)`]);
    const headSeal = jsonObjectAt(repo, 'HEAD', sealRel);
    if (!headSeal) return fail([`${sealRel} at HEAD is not a JSON object`]);
    if (!gitOk(repo, ['diff', '--quiet', 'HEAD', '--', sealRel])) reasons.push(`the working-tree copy of ${sealRel} differs from HEAD (an uncommitted edit); the record is judged as committed`);
    const headSealed = String(headSeal.sealed_sha);
    if (!SHA40.test(headSealed)) return fail([...reasons, 'sealed_sha is not 40 hex']);
    if (!gitOk(repo, ['cat-file', '-e', `${headSealed}^{commit}`])) return fail([...reasons, 'sealed_sha names no commit']);
    if (!gitOk(repo, ['merge-base', '--is-ancestor', headSealed, 'HEAD'])) return fail([...reasons, 'sealed_sha is not an ancestor of HEAD']);
    const adds = recordAdds(repo, headSealed, sealRel);
    if (adds.length === 0) {
        return fail([...reasons, `${sealRel} was not added after sealed_sha ${headSealed.slice(0, 8)}: a seal record is committed once, after the revision it seals, and moving sealed_sha needs a new record`]);
    }
    if (adds.length > 1) reasons.push(`${sealRel} was added more than once after sealed_sha (${adds.map((a) => a.slice(0, 8)).join(', ')}); a seal record is committed once, and a re-seal needs a new record`);
    const anchor = adds[0];
    const seal = jsonObjectAt(repo, anchor, sealRel);
    if (!seal) return fail([...reasons, `${sealRel} as first committed at ${anchor.slice(0, 8)} is not a JSON object`]);
    if (gitText(repo, ['rev-parse', `${anchor}:${sealRel}`]).trim() !== gitText(repo, ['rev-parse', `HEAD:${sealRel}`]).trim()) {
        const keys = [...new Set([...Object.keys(seal), ...Object.keys(headSeal)])].filter((k) => JSON.stringify(seal[k]) !== JSON.stringify(headSeal[k]));
        reasons.push(
            `${sealRel} changed after the record was first committed at ${anchor.slice(0, 8)} (${keys.length ? `fields: ${keys.join(', ')}` : 'formatting only'}); ` +
                'it is judged as first committed, and a re-seal needs a new record',
        );
    }

    const sealed = String(seal.sealed_sha);
    const start = String(seal.phase_start_sha);
    const patterns: string[] = Array.isArray(seal.exempt_paths) ? seal.exempt_paths.map(String) : [];
    if (!SHA40.test(sealed)) return fail([...reasons, 'sealed_sha is not 40 hex']);
    if (!SHA40.test(start)) return fail([...reasons, 'phase_start_sha is not 40 hex']);
    if (!gitOk(repo, ['cat-file', '-e', `${sealed}^{commit}`])) return fail([...reasons, 'sealed_sha names no commit']);

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

    // The scan record too is read as committed at HEAD (CR-10); its digest is pinned by the anchored record.
    let scanText: Buffer | null = null;
    if (!gitOk(repo, ['cat-file', '-e', `HEAD:${scanRel}`])) reasons.push(`${scanRel} is missing at HEAD`);
    else {
        scanText = gitOut(repo, ['cat-file', '-p', `HEAD:${scanRel}`]);
        if (!gitOk(repo, ['diff', '--quiet', 'HEAD', '--', scanRel])) reasons.push(`the working-tree copy of ${scanRel} differs from HEAD (an uncommitted edit); the scan record is judged as committed`);
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
                // The reviewed-inert label holds only at a listed location, with its ruling at sealed_sha.
                const docHits: any[] = Array.isArray(doc.hits) ? doc.hits : [];
                if (docHits.some((h) => h?.classification === NON_PUBLIC)) reasons.push(`${scanRel} holds a non-public hit`);
                const reviewed = docHits.filter((h) => h?.classification === REVIEWED_INERT);
                const unlisted = reviewed.filter((h) => !REVIEWED_HITS.some((e) => sameLocation(e, h)));
                if (unlisted.length) reasons.push(`${scanRel} labels ${unlisted.length} hit(s) reviewed-inert that no reviewed entry names: ${unlisted.slice(0, 5).map(where).join(', ')}`);
                if ((doc.hit_counts?.[REVIEWED_INERT] ?? 0) !== reviewed.length) reasons.push(`${scanRel} hit_counts ${REVIEWED_INERT} is not the number of ${REVIEWED_INERT} hits (${reviewed.length})`);
                if (reviewed.length) {
                    try {
                        checkReviewedList(REVIEWED_HITS.filter((e) => reviewed.some((h) => sameLocation(e, h))), rulingAt(repo, sealed));
                    } catch (e) {
                        reasons.push(`${scanRel} reviewed hits: ${(e as Error).message}`);
                    }
                }
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
            const raw = opts.scan_fn ? opts.scan_fn(sealed, head) : [];
            // WR-32: the reviewed list holds here too, each entry only with its ruling committed at sealed_sha.
            const listed = opts.reviewed ?? REVIEWED_HITS;
            const matched = listed.filter((e) => raw.some((h) => h.classification === NON_PUBLIC && sameLocation(e, h)));
            let hits = raw;
            if (matched.length) {
                try {
                    checkReviewedList(matched, rulingAt(repo, sealed));
                    hits = applyReviewed(raw, matched);
                } catch (e) {
                    reasons.push(`the scan of ${range} hit ${matched.length} reviewed location(s) whose ruling does not hold at sealed_sha: ${(e as Error).message}`);
                }
            }
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
    ok(draws.every((h) => !/[a-f]{4}/.test(h)), 'planted fixture values hold no run of four letters a-f that could spell a scanner stop word (500 draws)');

    // Reviewed hits (ESC-SECRET-03): the label holds at an exact listed location only.
    const asHit = (e: HitLocation, classification = NON_PUBLIC): Hit => ({ rule_id: e.rule_id, file: e.file, commit: e.commit, line: e.line, column: e.column, type: e.rule_id, classification });
    const label = (h: Hit) => applyReviewed([h], REVIEWED_HITS)[0].classification;
    ok(REVIEWED_HITS.length === 2 && REVIEWED_HITS.every((e) => e.ruling === 'ESC-SECRET-03'), `reviewed: the list holds the two ESC-SECRET-03 locations and nothing else (${REVIEWED_HITS.length} entries)`);
    for (const e of REVIEWED_HITS) {
        ok(label(asHit(e)) === REVIEWED_INERT, `reviewed: the listed hit ${where(e)} is reviewed-inert`);
        const otherRule = e.rule_id === 'generic-api-key' ? 'generic-credential-uri' : 'generic-api-key';
        const variants: [string, Partial<HitLocation>][] = [
            ['another rule', { rule_id: otherRule }],
            ['another file', { file: e.file.replace(/\.ts$/, '.copy.ts') }],
            ['a letter-case variant of the file', { file: e.file.toUpperCase() }],
            ['another commit', { commit: (e.commit[0] === '0' ? '1' : '0') + e.commit.slice(1) }],
            ['another line', { line: e.line + 1 }],
            ['another column', { column: e.column + 1 }],
        ];
        for (const [what, d] of variants) {
            const h = asHit({ ...e, ...d });
            ok(label(h) === NON_PUBLIC, `reviewed: the same hit at ${what} (${where(h)}) is still non-public`);
        }
        ok(label(asHit(e, PUBLIC_ADDRESS)) === PUBLIC_ADDRESS, `reviewed: a public-address hit at ${where(e)} keeps its own label`);
    }
    const locs = (list: HitLocation[]) => list.map(({ rule_id, file, commit, line, column }) => ({ rule_id, file, commit, line, column }));
    const rulingRec = (o: Record<string, unknown> = {}, hits: HitLocation[] = locs(REVIEWED_HITS)) => ({ id: 'ESC-SECRET-03', operator_response: 'fixture operator words', resolution: { status: 'closed', reviewed_hits: hits }, ...o });
    const reader = (rec: unknown) => (id: string) => (id === 'ESC-SECRET-03' ? rec : null);
    const refusedWith = (f: () => void, what: string): string => {
        try {
            f();
            return 'not refused';
        } catch (err) {
            return err instanceof Refusal && (err as Error).message.includes(what) ? 'refused' : `wrong error: ${(err as Error).message}`;
        }
    };
    let rr = refusedWith(() => checkReviewedList(REVIEWED_HITS, reader(rulingRec())), '');
    ok(rr === 'not refused', `reviewed: the list is accepted when its ruling record has the operator's answer and lists each location (${rr})`);
    const e0 = REVIEWED_HITS[0];
    const noRuling: Record<string, unknown> = { ...e0 };
    delete noRuling.ruling;
    rr = refusedWith(() => checkReviewedList([noRuling as unknown as ReviewedHit], reader(rulingRec())), 'cites no ruling record');
    ok(rr === 'refused', `reviewed: an entry without a ruling reference is refused (${rr})`);
    rr = refusedWith(() => checkReviewedList([{ ...e0, ruling: '' }], reader(rulingRec())), 'cites no ruling record');
    ok(rr === 'refused', `reviewed: an entry with an empty ruling reference is refused (${rr})`);
    rr = refusedWith(() => checkReviewedList([{ ...e0, ruling: 'operator said so' }], reader(rulingRec())), 'cites no ruling record');
    ok(rr === 'refused', `reviewed: a ruling reference that is not an escalation id is refused (${rr})`);
    rr = refusedWith(() => checkReviewedList([e0], () => null), 'is missing');
    ok(rr === 'refused', `reviewed: an entry whose ruling record is missing is refused (${rr})`);
    rr = refusedWith(() => checkReviewedList([e0], reader(rulingRec({ operator_response: null }))), 'has no operator response');
    ok(rr === 'refused', `reviewed: an entry whose ruling record has no operator response is refused (${rr})`);
    rr = refusedWith(() => checkReviewedList([e0], reader(rulingRec({}, locs([{ ...e0, column: e0.column + 1 }, REVIEWED_HITS[1]])))), 'does not list this exact location');
    ok(rr === 'refused', `reviewed: an entry whose ruling record lists another location is refused (${rr})`);
    rr = refusedWith(() => checkReviewedList([{ ...e0, commit: e0.commit.slice(0, 8) }], reader(rulingRec())), 'not a full location');
    ok(rr === 'refused', `reviewed: an entry with a short commit is refused (${rr})`);
    rr = refusedWith(() => checkReviewedList([e0, { ...e0 }], reader(rulingRec())), 'listed twice');
    ok(rr === 'refused', `reviewed: an entry listed twice is refused (${rr})`);

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
        const reset = () => g('checkout', '-q', '-f', '-B', 'case', base);

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
        // The record's own checks, on a record whose FIRST committed copy is wrong (CR-10: a later
        // edit is caught by the anchor before these checks could see it; the tamper cases below).
        const firstAdd = { from: () => { g('checkout', '-q', '-f', '-B', 'case', sealed); put(SCAN_REL, scanText); } };
        run('a render altered in SEAL.json (as first committed)', () => {
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), render_sha256: { findings: '0'.repeat(64), decisions: sha256('decisions\n') } }, null, 2) + '\n');
            commit('c');
        }, false, 'render_sha256.findings', firstAdd);
        run('final_check not pass (as first committed)', () => {
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), final_check: 'fail' }, null, 2) + '\n');
            commit('c');
        }, false, 'final_check', firstAdd);
        run('scan not clean (as first committed)', () => {
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), scan: { ...baseSeal().scan, non_public: 2 } }, null, 2) + '\n');
            commit('c');
        }, false, 'non_public', firstAdd);
        run('the same record after a later edit reports which fields changed (CR-10)', () => {
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), final_check: 'fail', render_sha256: { findings: '0'.repeat(64), decisions: sha256('decisions\n') } }, null, 2) + '\n');
            commit('c');
        }, false, 'fields: final_check, render_sha256');

        // --- CR-10: the record is judged as first committed after sealed_sha, never as edited later ---
        run('tamper (CR-10): a later commit widens exempt_paths in SEAL.json to cover its own source change', () => {
            put('src/a.ts', 'export const a = 7;\n');
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), exempt_paths: [...REAL_EXEMPT, 'src/*'] }, null, 2) + '\n');
            commit('c');
        }, false, 'changed after the record was first committed');
        run('tamper (CR-10): sealed_sha moved forward in SEAL.json past a later source change', () => {
            put('src/a.ts', 'export const a = 7;\n');
            commit('c1');
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), sealed_sha: g('rev-parse', 'HEAD') }, null, 2) + '\n');
            commit('c2');
        }, false, 'was not added after sealed_sha');
        run('tamper (CR-10): SEAL.json deleted and re-added with a widened exempt list', () => {
            g('rm', '-q', '--', SEAL_REL);
            commit('c1');
            put('src/a.ts', 'export const a = 7;\n');
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), exempt_paths: [...REAL_EXEMPT, 'src/a.ts'] }, null, 2) + '\n');
            commit('c2');
        }, false, 'added more than once after sealed_sha');
        run('tamper (CR-10): an uncommitted edit to SEAL.json exempting a committed source change', () => {
            put('src/a.ts', 'export const a = 8;\n');
            commit('c');
            put(SEAL_REL, JSON.stringify({ ...baseSeal(), exempt_paths: [...REAL_EXEMPT, 'src/a.ts'] }, null, 2) + '\n');
        }, false, 'differs from HEAD');

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
        const reset2 = () => g('checkout', '-q', '-f', '-B', 'case2', base2);
        const S = { seal_rel: SUCC_REL, from: reset2 };
        const runS = (name: string, mutate: () => void, expectValid: boolean, reason?: string, changed?: string[]) => run(name, mutate, expectValid, reason, { ...S, changed });
        // A successor record whose FIRST committed copy is wrong: built on sealed2, where it does not exist yet (CR-10).
        const runS1 = (name: string, mutate: () => void, expectValid: boolean, reason?: string) =>
            run(name, mutate, expectValid, reason, { seal_rel: SUCC_REL, from: () => g('checkout', '-q', '-f', '-B', 'case2', sealed2) });

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
        runS('successor tamper (CR-10): a later commit changes a register file and adds it to the record\'s exempt_paths', () => {
            put('.planning/audit/findings/x.json', '{"phase":23,"severity":"changed"}\n');
            put(SUCC_REL, JSON.stringify(succ(scan23(), { exempt_paths: [SUCC_REL, SCAN23_REL, '.planning/audit/findings/*'] }), null, 2) + '\n');
            commit('c');
        }, false, 'changed after the record was first committed');
        runS('successor tamper (CR-10): the same edit to the record left uncommitted', () => {
            put('.planning/audit/findings/x.json', '{"phase":23,"severity":"changed"}\n');
            commit('c');
            put(SUCC_REL, JSON.stringify(succ(scan23(), { exempt_paths: [SUCC_REL, SCAN23_REL, '.planning/audit/findings/*'] }), null, 2) + '\n');
        }, false, 'differs from HEAD');
        runS('successor tamper (CR-10): a second copy of the record added on a side branch and merged in', () => {
            g('checkout', '-q', '-B', 'forged', sealed2);
            put('.planning/audit/findings/x.json', '{"phase":23,"forged":true}\n');
            writeSucc(scan23(), { exempt_paths: [SUCC_REL, SCAN23_REL, '.planning/audit/findings/*'] });
            commit('forged record');
            g('checkout', '-q', 'case2');
            g('merge', '-q', '--no-ff', '--no-commit', '-X', 'theirs', 'forged');
            g('commit', '-q', '-m', 'merge the forged record');
        }, false, 'added more than once after sealed_sha');
        runS('successor: a pull-request style merge after the seal stays VALID (merge handling under covers)', () => {
            put('.planning/STATE.md', 'after successor\n');
            commit('exempt change after the successor');
            const tip = g('rev-parse', 'HEAD');
            g('checkout', '-q', '-B', 'mainline', startSha);
            mergeNoFf(tip, 'Merge pull request');
        }, true, undefined, [SCAN23_REL, SUCC_REL]);
        runS1('successor: predecessor linkage, a wrong previous_sealed_sha is INVALID (as first committed)', () => {
            writeSucc(scan23(), { previous_sealed_sha: startSha });
            commit('c');
        }, false, 'previous_sealed_sha is not the sealed_sha');
        runS1('successor: predecessor linkage, previous_seal naming no record at sealed_sha is INVALID (as first committed)', () => {
            writeSucc(scan23(), { previous_seal: '.planning/audit/SEAL-21.json' });
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
        runS1('successor: scan substitution, a scan of another range (other start) re-digested in the record is INVALID (as first committed)', () => {
            writeSucc(scan23({ range: `${startSha}..${sealed2}`, phase_start_sha: startSha }));
            commit('c');
        }, false, 'phase_start_sha is not the record');
        runS1('successor: scan substitution, a scan of another revision (other end) re-digested in the record is INVALID (as first committed)', () => {
            writeSucc(scan23({ range: `${base}..${sealed}`, sealed_sha: sealed }));
            commit('c');
        }, false, 'sealed_sha is not the record');
        runS1('successor: scan substitution, the record pointed at the Phase 22 scan file is INVALID (as first committed)', () => {
            put(SUCC_REL, JSON.stringify(succ(scanText, { scan_record: SCAN_REL }), null, 2) + '\n');
            commit('c');
        }, false, `exempt_paths must list ${SCAN_REL}`);
        runS1('successor: scan substitution, a scan file reporting a non-public hit is INVALID (as first committed)', () => {
            writeSucc(scan23({ hit_counts: { 'non-public': 1 } }));
            commit('c');
        }, false, 'non-public is not 0');
        runS1('successor: a record whose scan.range is not scan_start_sha..sealed_sha is INVALID (as first committed)', () => {
            const t = scan23();
            writeSucc(t, { scan: { ...succ(t).scan, range: `${startSha}..${sealed2}` } });
            commit('c');
        }, false, 'scan.range is not');
        runS1('successor: changed_since_previous missing a path is INVALID (as first committed)', () => {
            writeSucc(scan23(), { changed_since_previous: CHANGED_SINCE.filter((p) => !p.endsWith('x.json')) });
            commit('c');
        }, false, 'changed_since_previous');
        runS1('successor: changed_since_previous naming a path outside the folder is INVALID (as first committed)', () => {
            writeSucc(scan23(), { changed_since_previous: [...CHANGED_SINCE, 'src/a.ts'] });
            commit('c');
        }, false, 'changed_since_previous');
        runS1('successor: a record missing covers is INVALID (no fallback to a weaker reading) (as first committed)', () => {
            const rec: Record<string, unknown> = succ(scan23());
            delete rec.covers;
            put(SCAN23_REL, scan23());
            put(SUCC_REL, JSON.stringify(rec, null, 2) + '\n');
            commit('c');
        }, false, 'must carry covers');
        runS1('successor: a record not listing itself on exempt_paths is INVALID (as first committed)', () => {
            writeSucc(scan23(), { exempt_paths: [SCAN23_REL] });
            commit('c');
        }, false, `exempt_paths must list ${SUCC_REL}`);
        runS1('successor: final_check not pass is INVALID (as first committed)', () => {
            writeSucc(scan23(), { final_check: 'fail' });
            commit('c');
        }, false, 'final_check');
        runS1('successor: a render hash that does not match sealed_sha is INVALID (as first committed)', () => {
            writeSucc(scan23(), { render_sha256: { findings: sha256('findings\n'), decisions: sha256('decisions 23\n') } });
            commit('c');
        }, false, 'render_sha256.findings');

        // --- Reviewed hits in a successor's scan record (ESC-SECRET-03) ------------------------
        // At sealed2 there is no ruling record, so a scan record labelling a listed hit reviewed-inert is INVALID there.
        const reviewedHits = REVIEWED_HITS.map((e) => asHit(e, REVIEWED_INERT));
        const withHits = (hits: Hit[], counts: Record<string, number> = {}) => ({ hits, hit_counts: { 'non-public': 0, [REVIEWED_INERT]: hits.filter((h) => h.classification === REVIEWED_INERT).length, ...counts } });
        runS1('successor: reviewed hits whose ruling record is not committed at sealed_sha are INVALID (as first committed)', () => {
            writeSucc(scan23(withHits(reviewedHits)));
            commit('c');
        }, false, 'ruling ESC-SECRET-03 is missing');
        // sealed4 commits the ruling record on sealed2 (no successor record yet); base4 adds a successor
        // whose scan record holds both listed hits, as that record's first committed copy (CR-10).
        g('checkout', '-q', '-f', '-B', 'case4', sealed2);
        const ESC_REL = `${ESCALATIONS_REL}/ESC-SECRET-03.json`;
        put(ESC_REL, JSON.stringify(rulingRec(), null, 2) + '\n');
        commit('the ruling record');
        const sealed4 = g('rev-parse', 'HEAD');
        const CHANGED4 = [...CHANGED_SINCE, ESC_REL].sort();
        const scan4 = (o: Record<string, unknown> = {}) => scan23({ range: `${base}..${sealed4}`, sealed_sha: sealed4, ...o });
        const writeSucc4 = (t: string) => {
            put(SCAN23_REL, t);
            put(SUCC_REL, JSON.stringify(succ(t, { sealed_sha: sealed4, changed_since_previous: CHANGED4, scan: { ...succ(t).scan, range: `${base}..${sealed4}` } }), null, 2) + '\n');
        };
        writeSucc4(scan4(withHits([...reviewedHits, asHit({ ...REVIEWED_HITS[0], line: 7 }, PUBLIC_ADDRESS)], { 'public-address': 1 })));
        commit('successor with reviewed hits');
        const base4 = g('rev-parse', 'HEAD');
        const R4 = { seal_rel: SUCC_REL, from: () => g('checkout', '-q', '-f', '-B', 'case4', base4) };
        run('successor: a scan record whose reviewed-inert hits are the listed locations, with the ruling at sealed_sha, is VALID', () => {}, true, undefined, { ...R4, changed: [SCAN23_REL, SUCC_REL] });
        // The bad scan records below are each the record's first committed copy (built on sealed4).
        const R4first = { seal_rel: SUCC_REL, from: () => g('checkout', '-q', '-f', '-B', 'case4', sealed4) };
        run('successor: a scan record labelling an unlisted location reviewed-inert (another line) is INVALID', () => {
            writeSucc4(scan4(withHits([reviewedHits[0], asHit({ ...REVIEWED_HITS[1], line: REVIEWED_HITS[1].line + 1 }, REVIEWED_INERT)])));
            commit('c');
        }, false, 'no reviewed entry names', R4first);
        run('successor: a scan record labelling the listed text in another file reviewed-inert is INVALID', () => {
            writeSucc4(scan4(withHits([reviewedHits[0], asHit({ ...REVIEWED_HITS[0], file: 'test/other.ts' }, REVIEWED_INERT)])));
            commit('c');
        }, false, 'no reviewed entry names', R4first);
        run('successor: a scan record whose reviewed-inert count differs from its hits is INVALID', () => {
            writeSucc4(scan4(withHits(reviewedHits, { [REVIEWED_INERT]: 1 })));
            commit('c');
        }, false, `hit_counts ${REVIEWED_INERT} is not the number`, R4first);
        run('successor: a scan record holding a non-public hit while its counts say 0 is INVALID', () => {
            writeSucc4(scan4(withHits([...reviewedHits, asHit({ ...REVIEWED_HITS[0], line: 5 })])));
            commit('c');
        }, false, 'holds a non-public hit', R4first);
        // --- WR-32: --scan applies the reviewed list, with each ruling read at sealed_sha ----------
        const scanCase = (name: string, from: () => void, hits: Hit[], expectValid: boolean, reason?: string) => {
            from();
            const r = verifySeal(dir, { scan: true, scan_fn: () => hits, seal_rel: SUCC_REL });
            ok(r.valid === expectValid && (!reason || r.reasons.join(' ').includes(reason)), `${name}: ${r.valid ? 'VALID' : `INVALID (${r.reasons.join('; ')})`}`);
        };
        scanCase('scan (WR-32): hits at the two listed locations, with the ruling committed at sealed_sha, are not counted', R4.from, REVIEWED_HITS.map((e) => asHit(e)), true);
        scanCase('scan (WR-32): a hit at a listed location whose ruling is not committed at sealed_sha still blocks', reset2, [asHit(REVIEWED_HITS[0])], false, 'ruling ESC-SECRET-03 is missing');
        scanCase('scan (WR-32): the listed text on another line is still non-public', R4.from, [asHit({ ...REVIEWED_HITS[0], line: REVIEWED_HITS[0].line + 1 })], false, 'non-public hit');
        scanCase('scan (WR-32): a listed location next to an unlisted hit: only the unlisted one is reported', R4.from, [asHit(REVIEWED_HITS[0]), asHit({ ...REVIEWED_HITS[1], column: 1 })], false, `found 1 non-public hit(s): ${REVIEWED_HITS[1].file}:${REVIEWED_HITS[1].line}@`);
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
        // WR-32: the --scan log options, proven on a straight range and on merges; the first-parent
        // options are shown to reproduce the flood (a key committed before the range is reported).
        for (const c of rangeFixture(v.bin, repoRoot, SCAN_LOG_OPTS).cases) ok(c.pass, `${c.id} (--scan options): ${c.observed}`);
        for (const c of mergeScanFixture(v.bin, SCAN_LOG_OPTS).cases) ok(c.pass, `${c.id} (--scan options): ${c.observed}`);
        const flood = mergeScanFixture(v.bin, RANGE_LOG_OPTS).cases.find((c) => c.id === 'merge-excludes-content-committed-before-the-range');
        ok(!!flood && !flood.pass, `merge fixture reproduces WR-32 under the first-parent options (a key committed before the range is reported): ${flood?.observed}`);
        const raw = mkTemp('csb-seal-st-raw-');
        try {
            const scanFn = (from: string, to: string) => scanRange(v.bin, dir, from, to, path.join(raw, randomHex(4))).hits;
            const postScan = postSealScanFn(v.bin, dir, path.join(raw, 'post'));
            reset();
            put('.planning/phases/22-safety-rails-audit/22-29-SUMMARY.md', 'clean text\n');
            commit('c');
            const clean = verifySeal(dir, { scan: true, scan_fn: postScan });
            ok(clean.valid, `--scan over a clean later commit: ${clean.valid ? 'VALID' : clean.reasons.join('; ')}`);
            reset();
            put('.planning/phases/22-safety-rails-audit/22-29-SUMMARY.md', `PRIVATE_KEY=0x${randomHexStrong(32)}\n`);
            commit('c');
            const dirty = verifySeal(dir, { scan: true, scan_fn: postScan });
            ok(!dirty.valid && dirty.reasons.join(' ').includes('non-public'), `--scan over a later key in an exempt file: ${dirty.valid ? 'VALID' : 'INVALID, non-public hit reported'}`);
            // WR-32 on the real scanner: a sealed branch holding a key committed BEFORE the seal,
            // merged pull-request style into a mainline that forked before it.
            const prBranch = (): string => {
                g('checkout', '-q', '-f', '-B', 'wr32', startSha);
                put('src/k.ts', `PRIVATE_KEY=0x${randomHexStrong(32)}\n`);
                commit('a key committed before the seal');
                const sealedK = g('rev-parse', 'HEAD');
                put(SCAN_REL, scanText);
                put(SEAL_REL, JSON.stringify({ ...baseSeal(), sealed_sha: sealedK }, null, 2) + '\n');
                commit('seal record');
                put('.planning/STATE.md', 'after the seal\n');
                commit('exempt change after the seal');
                const tip = g('rev-parse', 'HEAD');
                g('checkout', '-q', '-f', '-B', 'wr32-main', startSha);
                put('.planning/state.json', '{"main":1}\n');
                commit('mainline work');
                return tip;
            };
            g('merge', '-q', '--no-ff', '-m', 'Merge pull request', prBranch());
            const pr = verifySeal(dir, { scan: true, scan_fn: postScan });
            ok(pr.valid, `--scan (WR-32): a pull-request merge of a sealed branch holding a key committed before the seal stays VALID: ${pr.valid ? 'VALID' : `INVALID (${pr.reasons.join('; ')})`}`);
            g('merge', '-q', '--no-ff', '--no-commit', prBranch());
            put('.planning/phases/22-safety-rails-audit/22-29-SUMMARY.md', `PRIVATE_KEY=0x${randomHexStrong(32)}\n`);
            g('add', '-A');
            g('commit', '-q', '-m', 'Merge pull request, adding a key in an exempt file during the merge');
            const prEvil = verifySeal(dir, { scan: true, scan_fn: postScan });
            const evilWhy = prEvil.reasons.join(' ');
            ok(!prEvil.valid && evilWhy.includes('non-public hit(s): .planning/phases/22-safety-rails-audit/22-29-SUMMARY.md:1@') && !evilWhy.includes('src/k.ts'), `--scan (WR-32): the same merge with a key written in the merge itself is INVALID for that key only (the pre-seal key in src/k.ts is not reported): ${prEvil.valid ? 'VALID' : `INVALID (${prEvil.reasons.join('; ')})`}`);
            // The reviewed rule on real scanner output: one planted key in two files, one exact location listed.
            reset();
            const plantedKey = `PRIVATE_KEY=0x${randomHexStrong(32)}\n`;
            put('src/r1.ts', plantedKey);
            put('src/r2.ts', plantedKey);
            commit('one key in two files');
            const realHits = scanFn(base, g('rev-parse', 'HEAD'));
            const inR = (hs: Hit[], n: string) => hs.filter((h) => h.file === n || h.file.endsWith(`/${n}`));
            const first = inR(realHits, 'src/r1.ts')[0];
            const entry: ReviewedHit | null = first ? { rule_id: first.rule_id, file: first.file, commit: first.commit, line: first.line, column: first.column, ruling: 'ESC-SECRET-03', why: 'fixture' } : null;
            const relabelled = entry ? applyReviewed(realHits, [entry]) : [];
            const atEntry = relabelled.filter((h) => entry && sameLocation(h, entry));
            const others = relabelled.filter((h) => !(entry && sameLocation(h, entry)));
            const r2 = inR(relabelled, 'src/r2.ts');
            ok(
                !!entry && atEntry.length > 0 && atEntry.every((h) => h.classification === REVIEWED_INERT) && r2.length > 0 && others.every((h) => h.classification === NON_PUBLIC),
                `reviewed on real scanner output: the listed location is reviewed-inert (${atEntry.length}) and the same key elsewhere stays non-public (${others.filter((h) => h.classification === NON_PUBLIC).length} of ${others.length}, ${r2.length} in src/r2.ts)`,
            );
            // The same through the real --phase-scan path: the list is checked against a ruling committed at --sealed, applied, counted and recorded.
            if (entry) {
                put(`${ESCALATIONS_REL}/ESC-SECRET-03.json`, JSON.stringify(rulingRec({}, locs([entry])), null, 2) + '\n');
                commit('fixture ruling record');
                const sealedW = g('rev-parse', 'HEAD');
                const outW = path.join(raw, 'phase-scan-wiring.json');
                let code = -1;
                let why = '';
                // phaseScan's range fixture reads the Hardhat #0 literal from the scanned repo: an untracked copy, never committed or scanned.
                const hardhatRel = path.join('test', 'fork', 'helpers', 'realMainnetGate.ts');
                fs.mkdirSync(path.dirname(path.join(dir, hardhatRel)), { recursive: true });
                fs.copyFileSync(path.join(repoRoot, hardhatRel), path.join(dir, hardhatRel));
                try {
                    code = phaseScan(dir, sealedW, path.join(raw, 'wiring-raw'), outW, base, { phase: 'self-test', plan: 'self-test', requirement: 'self-test' }, [entry]);
                } catch (err) {
                    why = (err as Error).message;
                } finally {
                    fs.rmSync(path.join(dir, 'test'), { recursive: true, force: true });
                }
                const doc = fs.existsSync(outW) ? JSON.parse(fs.readFileSync(outW, 'utf8')) : null;
                const docHits: Hit[] = doc ? doc.hits : [];
                const wired =
                    !!doc &&
                    code === 1 &&
                    doc.hit_counts[REVIEWED_INERT] === atEntry.length &&
                    doc.hit_counts[NON_PUBLIC] === others.length &&
                    docHits.filter((h) => sameLocation(h, entry)).every((h) => h.classification === REVIEWED_INERT) &&
                    doc.reviewed_hits.length === 1 &&
                    doc.reviewed_hits[0].matched === true;
                ok(wired, `reviewed through --phase-scan: exit ${code}${why ? ` (${why})` : ''}, reviewed-inert ${doc?.hit_counts?.[REVIEWED_INERT]}, non-public ${doc?.hit_counts?.[NON_PUBLIC]}, entry matched ${doc?.reviewed_hits?.[0]?.matched}`);
            } else ok(false, 'reviewed through --phase-scan: the planted key produced no hit to list');
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

/** `reviewed` is always REVIEWED_HITS from the command line; the self-test passes a fixture list to drive this path end to end. */
function phaseScan(repo: string, sealedArg: string, rawDirArg: string, outArg: string, startArg?: string, labels: ScanLabels = PHASE22_LABELS, reviewed: ReviewedHit[] = REVIEWED_HITS): number {
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
    // Every reviewed entry must cite a ruling committed at the sealed revision that lists its exact location.
    checkReviewedList(reviewed, rulingAt(repo, sealed));

    const set = scanRange(v.bin, repo, start, sealed, raw);
    const inRange = new Set(gitText(repo, ['rev-list', `${start}..${sealed}`]).split(/\r?\n/).filter(Boolean));
    const outside = set.hits.filter((h) => !inRange.has(h.commit)).length;
    if (outside) throw new Error(`${outside} hit(s) fall outside the commit range`);
    const hits = applyReviewed(set.hits, reviewed);
    const matched = reviewed.filter((e) => hits.some((h) => h.classification === REVIEWED_INERT && sameLocation(e, h)));
    const count = (c: string) => hits.filter((h) => h.classification === c).length;
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
            [REVIEWED_INERT]: 'reported by all three passes at a location the operator ruled not a secret: rule id, file, commit, line and column equal one entry of seal-verify.ts REVIEWED_HITS, whose ruling record (committed at sealed_sha) lists the same location',
        },
        classification_key: ['rule id', 'file', 'commit', 'line', 'start column', 'end column'],
        hit_counts: { total: hits.length, [NON_PUBLIC]: nonPublic, [KNOWN_PUBLIC]: count(KNOWN_PUBLIC), [PUBLIC_ADDRESS]: count(PUBLIC_ADDRESS), [REVIEWED_INERT]: count(REVIEWED_INERT) },
        reviewed_hits: reviewed.map((e) => ({ ...e, matched: matched.includes(e) })),
        hits,
        value_policy: 'hits and reviewed_hits hold rule id, file, commit, line, column, type, classification and the ruling reference only; raw redacted reports stay in raw_report_dir outside the repo',
        phase: labels.phase,
        plan: labels.plan,
        requirement: labels.requirement,
    };
    fs.mkdirSync(path.dirname(path.resolve(outArg)), { recursive: true });
    fs.writeFileSync(path.resolve(outArg), JSON.stringify(doc, null, 2) + '\n');
    console.log(`PHASE-SCAN range=${set.range} commits=${inRange.size} hits=${hits.length} non-public=${nonPublic} known-public=${count(KNOWN_PUBLIC)} public-address=${count(PUBLIC_ADDRESS)} reviewed-inert=${count(REVIEWED_INERT)} (reviewed entries matched ${matched.length} of ${reviewed.length})`);
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
        // The --scan log options are proven on a straight range and on merges before any real scan (WR-32).
        const fixture = rangeFixture(v.bin, repo, SCAN_LOG_OPTS);
        const merges = mergeScanFixture(v.bin, SCAN_LOG_OPTS);
        for (const c of [...fixture.cases, ...merges.cases]) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.id}: ${c.observed}`);
        if (!fixture.pass || !merges.pass) throw new Refusal('the range or merge fixture failed; the --scan log options do not cover what the seal needs');
        rawDir = mkTemp('csb-seal-scan-');
        scanFn = postSealScanFn(v.bin, repo, rawDir, (s) => console.log(s));
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
