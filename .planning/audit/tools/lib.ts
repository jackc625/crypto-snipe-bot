// .planning/audit/tools/lib.ts
//
// Phase 22 / Plan 22-04 (AUDIT-01, AUDIT-03, AUDIT-05; D-15) - shared library
// for the audit register tools (slice-files.ts, check.ts, render.ts and any
// later audit tool). Everything that enumerates files, checks the universe,
// loads register files or writes them lives here, so every consumer uses one
// implementation.
//
// The enumerator (review concern L103@e2e59f6, orchestrator-confirmed glob
// defect): git pathspec globs are not portable between `git ls-tree` and
// `git ls-files` (`'src/api/**'` returns 0 files under ls-tree and 14 under
// ls-files; brace expressions return 0 under both; ls-tree rejects `:(glob)`).
// So no tool ever passes a slice selector to git as a pathspec. enumerateSlice
// lists the FULL tree at a SHA with `git ls-tree -r -z --full-tree <sha>` (no
// pathspec at all) and filters it in JavaScript by the slice's literal
// include/exclude entries:
//   - an entry ending in '/' is a directory prefix (matches by startsWith)
//   - any other entry is an exact file path (matches by equality)
//   - '*', '?', '[' and '{' are rejected outright (they would be glob syntax)
// (`--full-tree` plus the object-id columns is a superset of the
// `--name-only` listing: same enumeration, no pathspec, and it also yields
// each blob id so snapshots can be content-verified.)
//
// No secret is ever read here: the tools read only tracked files through git
// and the JSON register under .planning/audit/. They never read `.env`, never
// open `data/`, and load no native module.

if (process.versions.modules !== '127') {
    process.stderr.write(
        `audit lib: requires Node 22.16.0 (ABI 127); this is Node ${process.version} ` +
            `(ABI ${process.versions.modules}). Run it with ` +
            `/c/Users/jackc/AppData/Local/nvm/v22.16.0/node.exe (D-21).\n`,
    );
    process.exit(2);
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as cp from 'child_process';

// ---------------------------------------------------------------------------
// Constants shared by check.ts and render.ts (the written contract is
// PROTOCOL.md; these values must stay identical to it).
// ---------------------------------------------------------------------------

export const AREAS = ['src', 'dashboard', 'test', 'scripts', 'contracts'] as const;
export const CLASS_IDS: string[] = Array.from({ length: 20 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`);
export const RC_IDS: string[] = Array.from({ length: 28 }, (_, i) => `RC-${String(i + 1).padStart(2, '0')}`);
export const SEVERITIES = ['S0', 'S1', 'S2', 'S3', 'S4'];
export const CAPITAL_IMPACTS = ['LOSS', 'STRAND', 'OVERSPEND', 'EXPOSURE', 'none'];
export const STATUSES = ['candidate', 'confirmed', 'decided', 'fixed', 'verified', 'NOT-A-BUG'];
export const ORIGINS = ['research-candidate', 'independent', 'external', 'rails-discovery', 're-audit'];
export const TIERS = ['immediate', 'area-batch', 'pre-phase'];
export const SECRET_CLASSES = ['known-public', 'non-public', 'scan-record'];
export const EVIDENCE_TYPES = ['code', 'command'];
export const CAPABILITY_KEYS = ['ledger', 'sweep', 'thresholds', 'findings_only'];
/** Escalation-record prefixes that are not slices (PROTOCOL.md section 4). */
export const ESCALATION_ONLY_PREFIXES = ['PRE', 'RAILS'];
/** AC-38: cards that must exist at stage consolidation. */
export const REQUIRED_CARDS = ['OD-6', 'OD-9', 'OD-10', 'OD-11', 'OD-14', 'OD-15', 'OD-16', 'OD-17', 'OD-18', 'OD-21', 'OD-25'];
/** NAC-12: the only cards that may carry status decided. */
export const DECIDABLE_CARDS = ['OD-1', 'OD-2', 'OD-7', 'OD-21'];
/** AC-37 threshold-row fields (every row carries every key; null is allowed where PROTOCOL says so). */
export const AC37_FIELDS = [
    'id', 'name', 'current_value', 'definition_sites', 'comparison', 'units', 'representation',
    'effective_unset', 'effective_empty', 'effective_non_numeric', 'rationale', 'overlap',
    'env_key', 'hardcoded', 'flags', 'recommendation', 'od_ref',
];
/** NAC-09 / P9: evidence may never cite a prior planning VERIFICATION or SUMMARY doc. */
export const NAC09_PATTERN = /\.planning\/.*(VERIFICATION|SUMMARY)/i;

export const RUBRIC: { id: string; text: string }[] = [
    { id: 'S0', text: 'Funds are lost or stranded on a live path with no unusual condition.' },
    { id: 'S1', text: 'Capital can be lost, stranded, overspent or exposed under a plausible condition.' },
    { id: 'S2', text: 'Correctness/robustness defect with bounded or indirect capital effect, or test/infra drift that can hide an S0/S1.' },
    { id: 'S3', text: 'Misleading behavior, telemetry or ops friction.' },
    { id: 'S4', text: 'Hygiene.' },
];
export const CAPITAL_TEXT: { id: string; text: string }[] = [
    { id: 'LOSS', text: 'Funds can be lost.' },
    { id: 'STRAND', text: 'A position is held without a working exit or protection.' },
    { id: 'OVERSPEND', text: 'More is spent than configured or capped.' },
    { id: 'EXPOSURE', text: 'A risk limit or trust boundary is bypassed.' },
    { id: 'none', text: 'No capital effect.' },
];
export const LIFECYCLE_TEXT =
    'candidate -> confirmed -> decided -> fixed -> verified, or NOT-A-BUG (never for a research candidate in Phase 22).';

export const ID_RE = {
    finding: /^AUD-([A-Z][A-Z0-9]*)-(\d{3})$/,
    escalation: /^ESC-([A-Z][A-Z0-9]*)-(\d{2,})$/,
    note: /^PN-(\d{3})$/,
    card: /^OD-([1-9]\d*)$/,
    proposed: /^([A-Z][A-Z0-9]*)-(\d{2,})$/,
    sha: /^[0-9a-f]{40}$/,
    date: /^\d{4}-\d{2}-\d{2}$/,
    rcAlias: /^rc:(RC-\d{2})$/,
    keyAlias: /^key:([A-Z][A-Z0-9]*):([a-z0-9][a-z0-9-]*)$/,
    inputAlias: /^input:([A-Za-z0-9._-]+)#(\d+)$/,
    codeRef: /^([^\s@:]+):(\d+)(?:-(\d+))?@([0-9a-f]{7,40})$/,
};

// ---------------------------------------------------------------------------
// Output plumbing: every tool's run() writes through an Io so the self-test can
// call the tools in-process and inspect exactly what they print.
// ---------------------------------------------------------------------------

export interface Io {
    out: (line: string) => void;
    err: (line: string) => void;
}

export const consoleIo: Io = {
    out: (l) => process.stdout.write(l + '\n'),
    err: (l) => process.stderr.write(l + '\n'),
};

export function captureIo(): Io & { lines: string[]; errLines: string[] } {
    const lines: string[] = [];
    const errLines: string[] = [];
    return { lines, errLines, out: (l) => lines.push(l), err: (l) => errLines.push(l) };
}

export class UsageError extends Error {}

// ---------------------------------------------------------------------------
// Argument parsing: `--flag value` and `--flag=value`; repeatable flags.
// ---------------------------------------------------------------------------

export type FlagKind = 'string' | 'bool' | 'multi';

export function parseArgs(
    argv: string[],
    spec: Record<string, FlagKind>,
): { flags: Record<string, string | boolean | string[] | undefined>; positional: string[] } {
    const flags: Record<string, string | boolean | string[] | undefined> = {};
    const positional: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) {
            positional.push(a);
            continue;
        }
        const eq = a.indexOf('=');
        const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
        const kind = spec[name];
        if (!kind) throw new UsageError(`unknown flag --${name}`);
        if (kind === 'bool') {
            if (eq >= 0) throw new UsageError(`--${name} takes no value`);
            flags[name] = true;
            continue;
        }
        let value: string;
        if (eq >= 0) value = a.slice(eq + 1);
        else {
            if (i + 1 >= argv.length) throw new UsageError(`--${name} needs a value`);
            value = argv[++i];
        }
        if (kind === 'multi') {
            const prev = (flags[name] as string[] | undefined) ?? [];
            prev.push(value);
            flags[name] = prev;
        } else {
            if (flags[name] !== undefined) throw new UsageError(`--${name} given twice`);
            flags[name] = value;
        }
    }
    return { flags, positional };
}

// ---------------------------------------------------------------------------
// Paths and git
// ---------------------------------------------------------------------------

/** Forward slashes; lower-case on Windows (case-insensitive file system). */
export function normPath(p: string): string {
    const f = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? f.toLowerCase() : f;
}

export function isInside(child: string, parent: string): boolean {
    const c = normPath(child);
    const p = normPath(parent);
    return c === p || c.startsWith(p + '/');
}

export function git(repo: string, args: string[], opts: { input?: Buffer } = {}): Buffer {
    try {
        return cp.execFileSync('git', ['-C', repo, ...args], {
            maxBuffer: 1 << 30,
            stdio: ['pipe', 'pipe', 'pipe'],
            input: opts.input,
            windowsHide: true,
        });
    } catch (e) {
        const err = e as { stderr?: Buffer; message?: string };
        const detail = err.stderr && err.stderr.length ? err.stderr.toString('utf8').trim() : String(err.message);
        throw new Error(`git ${args.join(' ')} failed: ${detail}`);
    }
}

export function gitText(repo: string, args: string[]): string {
    return git(repo, args).toString('utf8').trim();
}

export function repoToplevel(dir: string): string {
    return gitText(dir, ['rev-parse', '--show-toplevel']);
}

/** Resolves any revision (HEAD, a short SHA, a branch) to a full commit SHA. */
export function resolveSha(repo: string, rev: string): string {
    if (!rev || rev.startsWith('-')) throw new UsageError(`invalid revision '${rev}'`);
    const sha = gitText(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`]);
    if (!ID_RE.sha.test(sha)) throw new Error(`could not resolve revision '${rev}' to a commit`);
    return sha;
}

export interface TreeEntry {
    mode: string;
    type: string;
    oid: string;
}

const treeCache = new Map<string, Map<string, TreeEntry>>();

/**
 * The full tracked tree at a commit: `git ls-tree -r -z --full-tree <sha>`,
 * with no pathspec, so no git glob semantics are ever involved.
 */
export function listTree(repo: string, sha: string): Map<string, TreeEntry> {
    if (!ID_RE.sha.test(sha)) throw new Error(`listTree needs a full 40-hex commit SHA, got '${sha}'`);
    const key = `${normPath(repo)}\u0000${sha}`;
    const hit = treeCache.get(key);
    if (hit) return hit;
    const raw = git(repo, ['ls-tree', '-r', '-z', '--full-tree', sha]).toString('utf8');
    const map = new Map<string, TreeEntry>();
    for (const rec of raw.split('\u0000')) {
        if (!rec) continue;
        const tab = rec.indexOf('\t');
        if (tab < 0) throw new Error(`unexpected ls-tree record: ${JSON.stringify(rec)}`);
        const [mode, type, oid] = rec.slice(0, tab).split(' ');
        map.set(rec.slice(tab + 1), { mode, type, oid });
    }
    treeCache.set(key, map);
    return map;
}

export function listTreePaths(repo: string, sha: string): string[] {
    return [...listTree(repo, sha).keys()].sort(cmp);
}

/** The commit that last changed (or deleted) a path, as seen from `rev`. Empty string if never. */
const lastChangeCache = new Map<string, string>();
export function lastChangeSha(repo: string, rev: string, p: string): string {
    const key = `${normPath(repo)}\u0000${rev}\u0000${p}`;
    const hit = lastChangeCache.get(key);
    if (hit !== undefined) return hit;
    const sha = gitText(repo, ['--literal-pathspecs', 'log', '-1', '--format=%H', rev, '--', p]);
    lastChangeCache.set(key, sha);
    return sha;
}

export function isAncestor(repo: string, ancestor: string, rev: string): boolean {
    try {
        git(repo, ['merge-base', '--is-ancestor', ancestor, rev]);
        return true;
    } catch {
        return false;
    }
}

/** Code-point order, never locale order: output must be byte-deterministic. */
export function cmp(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

export function gitBlobOid(data: Buffer): string {
    return crypto
        .createHash('sha1')
        .update(Buffer.concat([Buffer.from(`blob ${data.length}\u0000`, 'utf8'), data]))
        .digest('hex');
}

// ---------------------------------------------------------------------------
// Slices and the universe
// ---------------------------------------------------------------------------

export interface Slice {
    slice: string;
    id_prefix: string;
    area: string | null;
    capabilities: { ledger: boolean; sweep: boolean; thresholds: boolean; findings_only: boolean };
    include: string[];
    exclude: string[];
    anchors: string[];
    files_at_base: string[];
    count_at_base: number;
    owned_rc: number[];
    owned_section_c: { id: string; candidate: string; ref: string }[];
    owned_od_cards: string[];
    plan: string;
    [k: string]: unknown;
}

export interface ScopeEntry {
    prefix: string;
    reason: string;
}

const FORBIDDEN_ENTRY = /[*?[{]/;

/** Returns a reason string if a literal include/exclude entry is not allowed, else null. */
export function entryError(entry: unknown): string | null {
    if (typeof entry !== 'string' || entry.length === 0) return 'entry must be a non-empty string';
    if (FORBIDDEN_ENTRY.test(entry)) return `entry '${entry}' contains a glob or brace character (* ? [ {); use literal paths`;
    if (entry.includes('\\')) return `entry '${entry}' contains a backslash; use forward slashes`;
    if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) return `entry '${entry}' is absolute; entries are repo-relative`;
    if (entry.startsWith(':')) return `entry '${entry}' starts with ':' (git pathspec magic)`;
    const segs = entry.replace(/\/$/, '').split('/');
    if (segs.some((s) => s === '' || s === '.' || s === '..')) return `entry '${entry}' has an empty, '.' or '..' segment`;
    return null;
}

export function entryMatches(entry: string, p: string): boolean {
    return entry.endsWith('/') ? p.startsWith(entry) : p === entry;
}

export function sliceMatches(slice: Pick<Slice, 'include' | 'exclude'>, p: string): boolean {
    return (slice.include ?? []).some((e) => entryMatches(e, p)) && !(slice.exclude ?? []).some((e) => entryMatches(e, p));
}

function assertEntries(slice: Pick<Slice, 'slice' | 'include' | 'exclude'>): void {
    for (const list of ['include', 'exclude'] as const) {
        const entries = (slice as Record<string, unknown>)[list];
        if (entries === undefined) continue;
        if (!Array.isArray(entries)) throw new Error(`slice ${slice.slice}: ${list} must be an array`);
        for (const e of entries) {
            const why = entryError(e);
            if (why) throw new Error(`slice ${slice.slice}: ${list} ${why}`);
        }
    }
}

/**
 * The single enumerator: the sorted list of tracked files at `sha` that the
 * slice selects. Throws on any glob/brace character in an entry.
 */
export function enumerateSlice(sha: string, slice: Pick<Slice, 'slice' | 'include' | 'exclude'>, opts: { repo: string }): string[] {
    assertEntries(slice);
    return listTreePaths(opts.repo, sha).filter((p) => sliceMatches(slice, p));
}

export interface UniverseResult {
    sha: string;
    total: number;
    unassigned: string[];
    multiply_assigned: { path: string; owners: string[] }[];
}

/**
 * Every tracked path at `sha` must belong to exactly one slice (by the
 * enumerator) or one out-of-scope prefix in scope.json.
 */
export function checkUniverse(sha: string, opts: { repo: string; slices: Slice[]; scope: ScopeEntry[] }): UniverseResult {
    for (const s of opts.slices) assertEntries(s);
    const paths = listTreePaths(opts.repo, sha);
    const unassigned: string[] = [];
    const multiply: { path: string; owners: string[] }[] = [];
    for (const p of paths) {
        const owners: string[] = [];
        for (const s of opts.slices) if (sliceMatches(s, p)) owners.push(`slice:${s.slice}`);
        for (const o of opts.scope) if (p.startsWith(o.prefix)) owners.push(`out-of-scope:${o.prefix}`);
        if (owners.length === 0) unassigned.push(p);
        else if (owners.length > 1) multiply.push({ path: p, owners });
    }
    return { sha, total: paths.length, unassigned, multiply_assigned: multiply };
}

/** Validates slices.json structure. Returns a list of [field, message] problems. */
export function validateSlices(raw: unknown): { problems: [string, string][]; slices: Slice[] } {
    const problems: [string, string][] = [];
    if (!Array.isArray(raw)) return { problems: [['(root)', 'slices.json must be a JSON array']], slices: [] };
    const seen = new Set<string>();
    const rcOwner = new Map<number, string>();
    const odOwner = new Map<string, string>();
    const scOwner = new Map<string, string>();
    raw.forEach((s: any, i: number) => {
        const at = `[${i}]${s && typeof s.slice === 'string' ? ' ' + s.slice : ''}`;
        if (!s || typeof s !== 'object') {
            problems.push([at, 'slice entry must be an object']);
            return;
        }
        if (typeof s.slice !== 'string' || !/^[A-Z][A-Z0-9]*$/.test(s.slice)) problems.push([at, 'slice name must match ^[A-Z][A-Z0-9]*$']);
        else if (seen.has(s.slice)) problems.push([at, `duplicate slice name ${s.slice}`]);
        else seen.add(s.slice);
        if (s.id_prefix !== `AUD-${s.slice}`) problems.push([`${at}.id_prefix`, `must be AUD-${s.slice}`]);
        const caps = s.capabilities;
        if (!caps || typeof caps !== 'object' || CAPABILITY_KEYS.some((k) => typeof caps[k] !== 'boolean')) {
            problems.push([`${at}.capabilities`, `must hold the booleans ${CAPABILITY_KEYS.join(', ')}`]);
        } else if (caps.findings_only) {
            if (caps.ledger || caps.sweep || caps.thresholds) problems.push([`${at}.capabilities`, 'findings_only excludes ledger, sweep and thresholds']);
            if ((s.include ?? []).length || (s.exclude ?? []).length || (s.anchors ?? []).length)
                problems.push([at, 'a findings-only slice has no include, exclude or anchors']);
            if (s.area !== null) problems.push([`${at}.area`, 'a findings-only slice has area null']);
        } else {
            if (!caps.ledger) problems.push([`${at}.capabilities`, 'a file-owning slice must have the ledger capability']);
            if (caps.sweep && !(AREAS as readonly string[]).includes(s.area)) problems.push([`${at}.area`, `a sweep slice needs one of ${AREAS.join(', ')}`]);
            if (!caps.sweep && !((AREAS as readonly string[]).includes(s.area) || s.area === 'root'))
                problems.push([`${at}.area`, `area must be one of ${AREAS.join(', ')} or root`]);
            if (!Array.isArray(s.include) || s.include.length === 0) problems.push([`${at}.include`, 'a file-owning slice needs at least one literal include entry']);
            if (!Array.isArray(s.anchors) || s.anchors.length === 0) problems.push([`${at}.anchors`, 'a file-owning slice needs at least one anchor']);
        }
        for (const list of ['include', 'exclude', 'anchors']) {
            if (s[list] === undefined) continue;
            if (!Array.isArray(s[list])) {
                problems.push([`${at}.${list}`, 'must be an array']);
                continue;
            }
            for (const e of s[list]) {
                const why = entryError(e);
                if (why) problems.push([`${at}.${list}`, why]);
                else if (list === 'anchors' && String(e).endsWith('/')) problems.push([`${at}.anchors`, `anchor '${e}' must be an exact file path`]);
            }
        }
        if (!Array.isArray(s.files_at_base) || s.files_at_base.some((f: unknown) => typeof f !== 'string'))
            problems.push([`${at}.files_at_base`, 'must be an array of paths']);
        else {
            const sorted = [...s.files_at_base].sort(cmp);
            if (sorted.join('\n') !== s.files_at_base.join('\n') || new Set(sorted).size !== sorted.length)
                problems.push([`${at}.files_at_base`, 'must be sorted and unique']);
            if (s.count_at_base !== s.files_at_base.length) problems.push([`${at}.count_at_base`, 'must equal files_at_base length']);
        }
        if (!Array.isArray(s.owned_rc)) problems.push([`${at}.owned_rc`, 'must be an array of RC numbers']);
        else
            for (const n of s.owned_rc) {
                if (!Number.isInteger(n) || n < 1 || n > 28) problems.push([`${at}.owned_rc`, `RC number ${n} is not 1..28`]);
                else if (rcOwner.has(n)) problems.push([`${at}.owned_rc`, `RC-${String(n).padStart(2, '0')} already owned by ${rcOwner.get(n)}`]);
                else rcOwner.set(n, s.slice);
            }
        if (!Array.isArray(s.owned_od_cards)) problems.push([`${at}.owned_od_cards`, 'must be an array']);
        else
            for (const od of s.owned_od_cards) {
                if (typeof od !== 'string' || !ID_RE.card.test(od)) problems.push([`${at}.owned_od_cards`, `'${od}' is not OD-N`]);
                else if (odOwner.has(od)) problems.push([`${at}.owned_od_cards`, `${od} already owned by ${odOwner.get(od)}`]);
                else odOwner.set(od, s.slice);
            }
        if (!Array.isArray(s.owned_section_c)) problems.push([`${at}.owned_section_c`, 'must be an array']);
        else
            for (const c of s.owned_section_c) {
                if (!c || typeof c.id !== 'string' || !/^SC-\d{2}$/.test(c.id) || typeof c.candidate !== 'string' || !c.candidate)
                    problems.push([`${at}.owned_section_c`, 'entries are {id: SC-NN, candidate, ref}']);
                else if (scOwner.has(c.id)) problems.push([`${at}.owned_section_c`, `${c.id} already owned by ${scOwner.get(c.id)}`]);
                else scOwner.set(c.id, s.slice);
            }
        if (typeof s.plan !== 'string' || !/^22-\d{2}$/.test(s.plan)) problems.push([`${at}.plan`, 'must name the owning plan (22-NN)']);
    });
    for (let n = 1; n <= 28; n++)
        if (!rcOwner.has(n)) problems.push(['(root)', `RC-${String(n).padStart(2, '0')} is owned by no slice`]);
    return { problems, slices: problems.length ? (raw as Slice[]) : (raw as Slice[]) };
}

export function validateScope(raw: unknown): { problems: [string, string][]; scope: ScopeEntry[] } {
    const problems: [string, string][] = [];
    const list = (raw as any)?.out_of_scope;
    if (!Array.isArray(list)) return { problems: [['out_of_scope', 'scope.json needs an out_of_scope array']], scope: [] };
    const seen = new Set<string>();
    list.forEach((o: any, i: number) => {
        const why = entryError(o?.prefix);
        if (why) problems.push([`out_of_scope[${i}].prefix`, why]);
        else if (!String(o.prefix).endsWith('/')) problems.push([`out_of_scope[${i}].prefix`, 'an out-of-scope prefix must end with /']);
        else if (seen.has(o.prefix)) problems.push([`out_of_scope[${i}].prefix`, `duplicate prefix ${o.prefix}`]);
        else seen.add(o.prefix);
        if (typeof o?.reason !== 'string' || !o.reason.trim()) problems.push([`out_of_scope[${i}].reason`, 'every out-of-scope prefix needs a reason']);
    });
    return { problems, scope: list as ScopeEntry[] };
}

// ---------------------------------------------------------------------------
// Snapshot: git archive -> in-process tar reader -> verified folder
// ---------------------------------------------------------------------------

interface TarFile {
    path: string;
    data: Buffer;
}

function cstr(buf: Buffer, start: number, len: number): string {
    const s = buf.subarray(start, start + len);
    const nul = s.indexOf(0);
    return (nul >= 0 ? s.subarray(0, nul) : s).toString('utf8');
}

function parsePax(data: Buffer): Record<string, string> {
    const out: Record<string, string> = {};
    let off = 0;
    while (off < data.length) {
        const sp = data.indexOf(0x20, off);
        if (sp < 0) break;
        const len = parseInt(data.subarray(off, sp).toString('ascii'), 10);
        if (!Number.isFinite(len) || len <= 0) throw new Error('malformed pax header');
        const rec = data.subarray(sp + 1, off + len - 1).toString('utf8');
        const eq = rec.indexOf('=');
        if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
        off += len;
    }
    return out;
}

/** Minimal ustar/pax reader for `git archive --format=tar` output. */
export function parseTar(buf: Buffer): TarFile[] {
    const files: TarFile[] = [];
    let off = 0;
    let pax: Record<string, string> = {};
    while (off + 512 <= buf.length) {
        const h = buf.subarray(off, off + 512);
        if (h.every((b) => b === 0)) break;
        if (h[124] & 0x80) throw new Error('tar entry uses base-256 size (unsupported)');
        const size = parseInt(cstr(h, 124, 12).trim() || '0', 8);
        const type = h[156] === 0 ? '0' : String.fromCharCode(h[156]);
        const name = cstr(h, 0, 100);
        const prefix = cstr(h, 257, 6).startsWith('ustar') ? cstr(h, 345, 155) : '';
        const linkname = cstr(h, 157, 100);
        const data = buf.subarray(off + 512, off + 512 + size);
        off += 512 + Math.ceil(size / 512) * 512;
        if (type === 'g') continue;
        if (type === 'x') {
            pax = parsePax(data);
            continue;
        }
        const full = pax.path ?? (prefix ? `${prefix}/${name}` : name);
        const link = pax.linkpath ?? linkname;
        pax = {};
        if (type === '5') continue;
        if (type === '0' || type === '7') files.push({ path: full, data: Buffer.from(data) });
        else if (type === '2') files.push({ path: full, data: Buffer.from(link, 'utf8') });
        else throw new Error(`unsupported tar entry type '${type}' for ${full}`);
    }
    return files;
}

function walkFiles(dir: string, base = dir): string[] {
    const out: string[] = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...walkFiles(abs, base));
        else out.push(path.relative(base, abs).split(path.sep).join('/'));
    }
    return out;
}

export interface SnapshotResult {
    sha: string;
    out: string;
    files: string[];
}

/**
 * Extracts exactly the enumerated files of `slices` at `sha` into `outDir`
 * (outside the repo, empty or absent), via `git archive` of the literal
 * include entries. Throws unless the extracted list equals the enumerator's
 * list and every extracted file's blob id equals the tree's (so a snapshot can
 * never silently be partial or altered).
 */
export function snapshot(repo: string, sha: string, slices: Slice[], outDir: string): SnapshotResult {
    const top = repoToplevel(repo);
    const outAbs = path.resolve(outDir);
    let outReal = outAbs;
    if (fs.existsSync(outAbs)) {
        outReal = fs.realpathSync.native(outAbs);
        if (!fs.statSync(outAbs).isDirectory()) throw new Error(`--out ${outDir} exists and is not a directory`);
        if (fs.readdirSync(outAbs).length) throw new Error(`--out ${outDir} is not empty; a snapshot needs an empty or new folder`);
    }
    if (isInside(outReal, fs.realpathSync.native(top)) || isInside(outAbs, top))
        throw new Error(`--out ${outDir} is inside the repository; snapshots must live outside it`);
    const tree = listTree(repo, sha);
    const expected = [...new Set(slices.flatMap((s) => enumerateSlice(sha, s, { repo })))].sort(cmp);
    if (expected.length === 0) throw new Error(`slices ${slices.map((s) => s.slice).join(',')} select zero files at ${sha}`);
    const paths = [...tree.keys()];
    const entries = [
        ...new Set(
            slices.flatMap((s) => s.include.filter((e) => paths.some((p) => entryMatches(e, p))).map((e) => e.replace(/\/$/, ''))),
        ),
    ].sort(cmp);
    const tar = git(repo, ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '--literal-pathspecs', 'archive', '--format=tar', sha, '--', ...entries]);
    const archived = parseTar(tar);
    const want = new Set(expected);
    const kept = archived.filter((f) => slices.some((s) => sliceMatches(s, f.path)));
    for (const f of kept) {
        if (f.path.split('/').some((seg) => seg === '..' || seg === '') || path.isAbsolute(f.path))
            throw new Error(`archive entry with unsafe path ${JSON.stringify(f.path)}`);
        if (!want.has(f.path)) throw new Error(`archive produced ${f.path}, which the enumerator does not list`);
        const oid = gitBlobOid(f.data);
        if (oid !== tree.get(f.path)?.oid) throw new Error(`archive content of ${f.path} does not match its blob ${tree.get(f.path)?.oid}`);
    }
    const keptPaths = kept.map((f) => f.path).sort(cmp);
    if (keptPaths.join('\n') !== expected.join('\n')) {
        const missing = expected.filter((p) => !keptPaths.includes(p));
        throw new Error(`archive is missing ${missing.length} enumerated file(s): ${missing.slice(0, 10).join(', ')}`);
    }
    fs.mkdirSync(outAbs, { recursive: true });
    for (const f of kept) {
        const dest = path.join(outAbs, ...f.path.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.data);
    }
    const onDisk = walkFiles(outAbs).sort(cmp);
    if (onDisk.join('\n') !== expected.join('\n')) throw new Error('extracted folder does not equal the enumerated list');
    for (const p of onDisk) {
        if (gitBlobOid(fs.readFileSync(path.join(outAbs, ...p.split('/')))) !== tree.get(p)?.oid)
            throw new Error(`extracted ${p} does not match its blob`);
    }
    return { sha, out: outAbs, files: onDisk };
}

// ---------------------------------------------------------------------------
// Register loading and atomic writes
// ---------------------------------------------------------------------------

export interface RegFile {
    /** Path relative to the register root, forward slashes. */
    rel: string;
    abs: string;
    data: any;
    error?: string;
}

export function readJson(abs: string, rel: string): RegFile {
    try {
        const text = fs.readFileSync(abs, 'utf8');
        return { rel, abs, data: JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) };
    } catch (e) {
        return { rel, abs, data: undefined, error: e instanceof Error ? e.message : String(e) };
    }
}

/** Every *.json file directly inside root/sub (not recursive), sorted by name. */
export function listJson(root: string, sub: string): RegFile[] {
    const dir = path.join(root, ...sub.split('/'));
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith('.json'))
        .map((d) => d.name)
        .sort(cmp)
        .map((name) => readJson(path.join(dir, name), `${sub}/${name}`));
}

export function stem(rel: string): string {
    return path.posix.basename(rel, '.json');
}

/** Writes a file atomically: temp file outside the register folders, then rename. */
export function writeAtomic(target: string, content: string | Buffer): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = path.join(os.tmpdir(), `.audit-write-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, content);
    try {
        fs.renameSync(tmp, target);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EXDEV') {
            fs.rmSync(tmp, { force: true });
            throw e;
        }
        fs.copyFileSync(tmp, target);
        fs.rmSync(tmp, { force: true });
    }
}

export function toJson(data: unknown): string {
    return JSON.stringify(data, null, 2) + '\n';
}

export interface Locations {
    /** Register root (default: the .planning/audit folder that holds this tool). */
    root: string;
    /** Git repository the register describes (default: the repository that holds this tool). */
    repo: string;
}

export function locations(flags: Record<string, unknown>): Locations {
    const root = path.resolve(typeof flags.root === 'string' ? flags.root : path.join(__dirname, '..'));
    const repo = typeof flags.repo === 'string' ? path.resolve(flags.repo) : repoToplevel(__dirname);
    return { root, repo };
}

export interface Config {
    base: RegFile;
    baseSha: string;
    slicesFile: RegFile;
    slices: Slice[];
    scopeFile: RegFile;
    scope: ScopeEntry[];
    classesFile: RegFile;
    problems: { file: string; field: string; msg: string }[];
}

/** Loads and validates BASE.json, slices.json, scope.json and classes.json. */
export function loadConfig(root: string): Config {
    const problems: { file: string; field: string; msg: string }[] = [];
    const base = readJson(path.join(root, 'BASE.json'), 'BASE.json');
    const slicesFile = readJson(path.join(root, 'slices.json'), 'slices.json');
    const scopeFile = readJson(path.join(root, 'scope.json'), 'scope.json');
    const classesFile = readJson(path.join(root, 'classes.json'), 'classes.json');
    for (const f of [base, slicesFile, scopeFile, classesFile]) if (f.error) problems.push({ file: f.rel, field: '(file)', msg: `unreadable: ${f.error}` });
    const baseSha = base.data?.audit_base_sha;
    if (!base.error && (typeof baseSha !== 'string' || !ID_RE.sha.test(baseSha)))
        problems.push({ file: 'BASE.json', field: 'audit_base_sha', msg: 'must be a full 40-hex commit SHA' });
    let slices: Slice[] = [];
    if (!slicesFile.error) {
        const v = validateSlices(slicesFile.data);
        slices = v.slices;
        for (const [field, msg] of v.problems) problems.push({ file: 'slices.json', field, msg });
    }
    let scope: ScopeEntry[] = [];
    if (!scopeFile.error) {
        const v = validateScope(scopeFile.data);
        scope = v.scope;
        for (const [field, msg] of v.problems) problems.push({ file: 'scope.json', field, msg });
    }
    if (!classesFile.error) {
        const c = classesFile.data;
        const ids = Array.isArray(c?.classes) ? c.classes.map((x: any) => x?.id) : [];
        if (ids.join(',') !== CLASS_IDS.join(',')) problems.push({ file: 'classes.json', field: 'classes', msg: 'must list C01..C20 in order' });
        if (!Array.isArray(c?.areas) || c.areas.join(',') !== AREAS.join(','))
            problems.push({ file: 'classes.json', field: 'areas', msg: `must be [${AREAS.join(', ')}]` });
        if (Array.isArray(c?.classes) && c.classes.some((x: any) => typeof x?.name !== 'string' || !x.name))
            problems.push({ file: 'classes.json', field: 'classes', msg: 'every class needs a name' });
    }
    return { base, baseSha: typeof baseSha === 'string' ? baseSha : '', slicesFile, slices, scopeFile, scope, classesFile, problems };
}
