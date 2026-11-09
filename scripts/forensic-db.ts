// scripts/forensic-db.ts
//
// Phase 22 / R3 / SAFE-01 + AUDIT-01: read-only forensic report on a COPY of
// the backed-up live DB (D-12 two-image method, RESEARCH.md STL-3 header-patch
// correction).
//
// Usage (Node 22.16.0 by absolute path, D-21):
//   N22=/c/Users/jackc/AppData/Local/nvm/v22.16.0
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js scripts/forensic-db.ts --self-test
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js scripts/forensic-db.ts \
//       --source <backup dated folder> --out <report folder outside the repo> \
//       --test-literals-sha <40-hex commit>
//
// Method (D-12 as corrected by STL-3):
//   1. Copy data/bot.db, bot.db-wal, bot.db-shm from the SOURCE (a backup
//      dated folder) into a fresh temp folder E as raw bytes. E is hashed and
//      is NEVER opened through SQLite (a read-only open of a WAL copy creates
//      or rewrites -shm, STL-3 bonus fact).
//   2. Copy E's bytes into a second fresh temp folder W. W is the only file
//      SQLite ever opens: read-write, so SQLite recovers W's WAL, then
//      serialize() and close. W is disposable and deleted afterwards.
//   3. Image A (merged, the 20:25 state) = the serialized W buffer; image B
//      (last checkpoint, the 17:33 state) = E's bot.db bytes read with
//      fs.readFileSync. On both in-memory buffers, header bytes 18-19 are set
//      from 2 (WAL) to 1 (rollback); otherwise SQLite refuses the image with
//      SQLITE_CANTOPEN at the first read (the constructor itself succeeds).
//      Both are opened { readonly: true } from the Buffer. No SQLite URI
//      parameters are used (better-sqlite3 does not parse file: URIs).
//   4. Report: user_version, integrity_check, per-table counts, full
//      pause_state / chain_state rows, a row-level diff B -> A keyed by each
//      table's primary key, and a cross-reference of token / tx_hash /
//      pair_or_pool_address values against the hex literals in test/ at
//      --test-literals-sha.
//   5. Blind-spot closers (added during 22-06 execution): a WAL frame
//      inventory plus a commit-by-commit replay (each commit state rebuilt by
//      SQLite's own recovery on a throwaway copy holding E's main bytes and a
//      WAL truncated at that commit), which surfaces rows inserted and deleted
//      again inside the window ("transient rows"); sqlite_sequence per image
//      (reveals deleted AUTOINCREMENT ids); and a scan of E's raw bytes for
//      0x hex strings that no live row holds (residue of deleted rows).
//
// A literal match is not proof of test authorship. Each matched literal has a
// provenance class:
//   production-constant  the literal also occurs in src/ (router, WETH, ...)
//   public-historical    a containing path is a captured real-mainnet fixture
//                        (test/fork/fixtures/realLaunches|rugs|honeypots/)
//   synthetic            it occurs only in test code
// and each matched row an attribution class:
//   attributed-test-write         synthetic literal AND a corroborating signal
//                                 (row added/changed in the B -> A diff, or at
//                                 least two other non-trivial column values
//                                 equal values found within WINDOW_LINES lines
//                                 of the literal in the same test file)
//   literal-match-uncorroborated  synthetic literal, no corroboration
//   public-historical-literal     the row may be a real trade of a real token
//   production-constant-literal   the value is a production constant
// Diff rows with no literal match are listed as unknown-origin, never "clean".
// Test files that generate addresses or hashes at runtime are listed as
// extraction limits: rows such tests wrote cannot be matched by literals.
//
// Integrity is fatal: integrity_check other than 'ok' on either image (or an
// image that cannot be opened) writes the report with integrity_failed: true
// and exits 1. A change of any E or source hash also exits 1.
//
// Outputs (in --out): report.json (sorted keys and rows, no run timestamps or
// temp paths, so two runs are byte-identical) and run-meta.json (times, E and
// source hashes before/after, script identity). Exit 0 ok, 1 check failed,
// 2 crash.
//
// Safety: refuses a --source or --out inside this repository (NAC-03: the
// live data/ folder is never read; the report holds trade history and must
// stay outside the repo). No dotenv, nothing imported from src/ (import-time
// side effects there open the live DB). The self-test runs only on temp
// fixtures under os.tmpdir().

if (process.versions.modules !== '127') {
    console.error(
        `forensic-db: requires Node 22.16.0 (ABI 127); this is Node ${process.version} ` +
            `(ABI ${process.versions.modules}). Run it with ` +
            'C:\\Users\\jackc\\AppData\\Local\\nvm\\v22.16.0\\node.exe (D-21).',
    );
    process.exit(1);
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as cp from 'child_process';

// Loaded only after the ABI assert above (a wrong ABI would crash at load).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3') as typeof import('better-sqlite3');
type DB = import('better-sqlite3').Database;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..');
const DB_FILES = ['data/bot.db', 'data/bot.db-shm', 'data/bot.db-wal'] as const;
/** Sorted. Primary keys re-confirmed from the image schema (PRAGMA table_info). */
const TABLES = ['chain_state', 'exit_state', 'lp_baseline', 'pause_state', 'trades'] as const;
type TableName = (typeof TABLES)[number];
const EXPECTED_PK: Record<TableName, string> = {
    chain_state: 'chain',
    exit_state: 'trade_id',
    lp_baseline: 'trade_id',
    pause_state: 'id',
    trades: 'id',
};
/** Columns cross-referenced against test literals (pair_or_pool_address: see SUMMARY deviation). */
const MATCH_COLUMNS = ['pair_or_pool_address', 'token', 'tx_hash'] as const;
const PUBLIC_HISTORICAL_PREFIXES = [
    'test/fork/fixtures/honeypots/',
    'test/fork/fixtures/realLaunches/',
    'test/fork/fixtures/rugs/',
];
const WINDOW_LINES = 30;
const IMAGE_A = 'A_merged_2025';
const IMAGE_B = 'B_checkpoint_1733';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Cell = string | number | null;
type Row = Record<string, Cell>;

interface FileHash {
    present: boolean;
    size: number | null;
    sha256: string | null;
}
type HashSet = Record<string, FileHash>;

interface TableInfo {
    present: boolean;
    pk: string | null;
    pk_expected: string;
    pk_matches_expected: boolean | null;
    columns: string[];
    count: number | null;
}

interface ImageData {
    opened: boolean;
    open_error: string | null;
    header_bytes_18_19_original: number[] | null;
    header_patched: boolean;
    user_version: number | null;
    change_counter: number | null;
    integrity: string;
    integrity_ok: boolean;
    tables: Record<string, TableInfo>;
    rows: Record<string, Row[]>;
    sqlite_sequence: Row[];
}

interface WalFrame {
    frame: number;
    page: number;
    commit_db_pages: number;
    salt_matches_header: boolean;
}

interface CommitPoint {
    frame: number;
    pages_written: number[];
    user_version: number | null;
    change_counter: number | null;
    integrity: string;
    counts: Record<string, number | 'absent'>;
    rows_equal_merged_image: boolean;
}

interface TransientRow {
    table: string;
    key: string;
    first_commit_frame: number;
    last_commit_frame: number;
    literal_matches: { column: string; literal: string; literal_provenance: LiteralInfo['provenance']; test_paths: string[] }[];
    corroboration: string[];
    attribution: MatchEntry['attribution'] | 'unknown-origin';
    row: Row;
}

interface WalReport {
    present: boolean;
    bytes: number;
    magic: string | null;
    format_version: number | null;
    page_size: number | null;
    checkpoint_sequence: number | null;
    salts: string[] | null;
    frame_count: number;
    trailing_bytes: number;
    frames_salt_matching: number;
    commit_frames: number;
    pages_touched: number[];
    frames: WalFrame[];
    replay_method: string;
    commit_points: CommitPoint[];
    distinct_row_states: number;
    transient_rows: TransientRow[];
}

interface ResidualHex {
    file: string;
    /** The test literal hit, or (no hit) the 64-hex candidate if the run is long enough, else the 40-hex one. */
    literal: string;
    /** In SQLite records adjacent column bytes follow a value directly, so a run is cut at 40 and/or 64 hex. */
    candidates: string[];
    occurrences: number;
    test_literal_provenance: LiteralInfo['provenance'] | null;
    test_paths: string[];
}

interface LiteralInfo {
    literal: string;
    provenance: 'synthetic' | 'public-historical' | 'production-constant';
    /** path -> 1-based line numbers where the literal occurs (plain or concat-expanded). */
    occurrences: Map<string, number[]>;
    forms: Set<'plain' | 'concat-expanded'>;
}

interface LiteralInput {
    sha: string;
    /** repo-relative test/ path -> content */
    testFiles: Map<string, string>;
    /** repo-relative src/ path -> content */
    srcFiles: Map<string, string>;
}

interface LiteralIndex {
    literals: Map<string, LiteralInfo>;
    limits: { path: string; patterns: string[] }[];
    lines: Map<string, string[]>;
    srcLiteralCount: number;
}

interface MatchEntry {
    table: string;
    key: string;
    image: 'A' | 'B' | 'A+B';
    matched_column: string;
    literal: string;
    literal_provenance: LiteralInfo['provenance'];
    literal_forms: string[];
    test_paths: string[];
    in_diff: 'added' | 'changed' | 'unchanged' | 'removed';
    corroboration: string[];
    attribution:
        | 'attributed-test-write'
        | 'literal-match-uncorroborated'
        | 'public-historical-literal'
        | 'production-constant-literal';
    linked_rows: { table: string; key: string }[];
    row: Row;
}

interface UnknownOriginRow {
    table: string;
    key: string;
    change: 'added' | 'changed' | 'removed';
    linked_trade_id: string | null;
    linked_trade_attribution: string | null;
}

interface ChangedRow {
    key: string;
    columns: { column: string; before: Cell; after: Cell }[];
}

interface TableDiff {
    added: Row[];
    removed: Row[];
    changed: ChangedRow[];
}

interface Report {
    tool: string;
    report_version: number;
    source: { folder: string; files: HashSet };
    test_literals: {
        sha: string;
        test_file_count: number;
        src_file_count: number;
        literal_count: number;
        by_provenance: Record<string, number>;
        window_lines: number;
        match_columns: string[];
    };
    integrity_failed: boolean;
    images: Record<string, unknown>;
    diff: Record<string, TableDiff> | null;
    diff_counts: Record<string, { added: number; removed: number; changed: number }> | null;
    state_changes: Record<string, boolean> | null;
    test_literal_matches: MatchEntry[];
    attribution_counts: Record<string, number>;
    unknown_origin_diff_rows: UnknownOriginRow[];
    extraction_limits: { path: string; patterns: string[] }[];
    wal: WalReport | null;
    residual_hex_strings: ResidualHex[] | null;
    rows_merged_image: Record<string, Row[]> | null;
}

interface RunMeta {
    tool: string;
    started_at: string;
    finished_at: string;
    node: string;
    node_abi: string;
    script_sha256: string;
    script_git_blob_sha: string | null;
    source: string;
    out: string;
    source_hashes_before: HashSet;
    source_hashes_after: HashSet;
    source_unchanged: boolean;
    e_hashes_before: HashSet;
    e_hashes_after: HashSet;
    e_unchanged: boolean;
    e_equals_source: boolean;
    report_sha256: string;
    exit_code: number;
    failures: string[];
}

interface RunResult {
    exitCode: 0 | 1;
    reportPath: string;
    metaPath: string;
    report: Report;
    meta: RunMeta;
}

class ForensicFailure extends Error {
    constructor(readonly reasons: string[]) {
        super(reasons.join('; '));
    }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function canon(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canon);
    if (v !== null && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(o).sort()) out[k] = canon(o[k]);
        return out;
    }
    return v;
}

const stableJson = (v: unknown): string => JSON.stringify(canon(v), null, 2) + '\n';

const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

const posix = (p: string): string => p.split(path.sep).join('/');

function hashFolder(root: string, layout: 'source' | 'flat'): HashSet {
    const out: HashSet = {};
    for (const rel of DB_FILES) {
        const p = layout === 'source' ? path.join(root, rel) : path.join(root, path.basename(rel));
        if (!fs.existsSync(p)) {
            out[rel] = { present: false, size: null, sha256: null };
            continue;
        }
        const b = fs.readFileSync(p);
        out[rel] = { present: true, size: b.length, sha256: sha256(b) };
    }
    return out;
}

const sameHashes = (a: HashSet, b: HashSet): boolean => stableJson(a) === stableJson(b);

function isInside(child: string, parent: string): boolean {
    const real = (p: string): string => {
        let cur = path.resolve(p);
        const tail: string[] = [];
        // realpath of the deepest existing ancestor (the target may not exist yet)
        while (!fs.existsSync(cur)) {
            tail.unshift(path.basename(cur));
            const up = path.dirname(cur);
            if (up === cur) break;
            cur = up;
        }
        return path.join(fs.realpathSync.native(cur), ...tail);
    };
    const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
    const c = norm(real(child));
    const pr = norm(real(parent));
    return c === pr || c.startsWith(pr.endsWith(path.sep) ? pr : pr + path.sep);
}

function normCell(v: unknown): Cell {
    if (v === null || v === undefined) return null;
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number' || typeof v === 'string') return v;
    if (Buffer.isBuffer(v)) return `x'${v.toString('hex')}'`;
    return String(v);
}

function compareKeys(a: string, b: string): number {
    const ia = /^-?\d+$/.test(a);
    const ib = /^-?\d+$/.test(b);
    if (ia && ib) {
        const x = BigInt(a);
        const y = BigInt(b);
        return x < y ? -1 : x > y ? 1 : 0;
    }
    if (ia !== ib) return ia ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
}

/** RESEARCH.md STL-3: set header bytes 18-19 from 2 (WAL) to 1 (rollback) on an in-memory copy. */
function toRollbackHeader(b: Buffer): { buf: Buffer; original: number[]; patched: boolean } {
    const c = Buffer.from(b);
    if (c.length < 100 || c.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') {
        throw new ForensicFailure(['buffer is not an SQLite database image (bad header)']);
    }
    const original = [c[18], c[19]];
    let patched = false;
    if (c[18] === 2 && c[19] === 2) {
        c[18] = 1;
        c[19] = 1;
        patched = true;
    }
    return { buf: c, original, patched };
}

function errMsg(e: unknown): string {
    if (e instanceof Error) {
        const code = (e as { code?: unknown }).code;
        return typeof code === 'string' ? `${code}: ${e.message}` : e.message;
    }
    return String(e);
}

// ---------------------------------------------------------------------------
// Image analysis (in-memory, read-only)
// ---------------------------------------------------------------------------

function emptyImage(): ImageData {
    return {
        opened: false,
        open_error: null,
        header_bytes_18_19_original: null,
        header_patched: false,
        user_version: null,
        change_counter: null,
        integrity: 'not run',
        integrity_ok: false,
        tables: {},
        rows: {},
        sqlite_sequence: [],
    };
}

function openImage(raw: Buffer | null, rawError: string | null): { img: ImageData; db: DB | null } {
    const img = emptyImage();
    if (raw === null) {
        img.open_error = rawError ?? 'no image';
        img.integrity = `open failed: ${img.open_error}`;
        return { img, db: null };
    }
    let db: DB;
    try {
        const p = toRollbackHeader(raw);
        img.header_bytes_18_19_original = p.original;
        img.header_patched = p.patched;
        img.change_counter = p.buf.readUInt32BE(24);
        db = new Database(p.buf, { readonly: true });
        db.defaultSafeIntegers(true);
    } catch (e) {
        img.open_error = errMsg(e);
        img.integrity = `open failed: ${img.open_error}`;
        return { img, db: null };
    }
    img.opened = true;
    try {
        const res = db.pragma('integrity_check') as { integrity_check: unknown }[];
        const lines = res.map((r) => String(normCell(r.integrity_check)));
        img.integrity = lines.join('\n');
        img.integrity_ok = lines.length === 1 && lines[0] === 'ok';
    } catch (e) {
        img.integrity = `integrity_check error: ${errMsg(e)}`;
        img.integrity_ok = false;
    }
    if (!img.integrity_ok) return { img, db };
    try {
        img.user_version = Number(normCell(db.pragma('user_version', { simple: true })));
        for (const t of TABLES) {
            const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t);
            if (!exists) {
                img.tables[t] = { present: false, pk: null, pk_expected: EXPECTED_PK[t], pk_matches_expected: null, columns: [], count: null };
                img.rows[t] = [];
                continue;
            }
            const info = db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string; pk: unknown }[];
            const pkCols = info
                .filter((c) => Number(normCell(c.pk)) > 0)
                .sort((a, b) => Number(normCell(a.pk)) - Number(normCell(b.pk)))
                .map((c) => c.name);
            const pk = pkCols.length === 1 ? pkCols[0] : pkCols.length === 0 ? 'rowid' : pkCols.join(',');
            const rows = (db.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[]).map((r) => {
                const o: Row = {};
                for (const k of Object.keys(r)) o[k] = normCell(r[k]);
                return o;
            });
            if (pk === 'rowid') throw new ForensicFailure([`table ${t} has no declared primary key; cannot key a diff`]);
            if (pk.includes(',')) throw new ForensicFailure([`table ${t} has a composite primary key (${pk}); unsupported`]);
            rows.sort((a, b) => compareKeys(String(a[pk]), String(b[pk])));
            img.tables[t] = {
                present: true,
                pk,
                pk_expected: EXPECTED_PK[t],
                pk_matches_expected: pk === EXPECTED_PK[t],
                columns: info.map((c) => c.name),
                count: rows.length,
            };
            img.rows[t] = rows;
        }
        if (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'`).get()) {
            img.sqlite_sequence = (db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all() as Record<string, unknown>[]).map((r) => {
                const o: Row = {};
                for (const k of Object.keys(r)) o[k] = normCell(r[k]);
                return o;
            });
        }
    } catch (e) {
        if (e instanceof ForensicFailure) throw e;
        img.integrity = `${img.integrity}\nquery error after integrity ok: ${errMsg(e)}`;
        img.integrity_ok = false;
    }
    return { img, db };
}

function imageSummary(img: ImageData): Record<string, unknown> {
    const counts: Record<string, number | 'absent'> = {};
    const tables: Record<string, unknown> = {};
    for (const t of TABLES) {
        const ti = img.tables[t];
        counts[t] = ti ? (ti.present ? (ti.count as number) : 'absent') : 'absent';
        if (ti) tables[t] = { present: ti.present, pk: ti.pk, pk_matches_expected: ti.pk_matches_expected, columns: ti.columns };
    }
    return {
        opened: img.opened,
        open_error: img.open_error,
        header_bytes_18_19_original: img.header_bytes_18_19_original,
        header_patched: img.header_patched,
        user_version: img.user_version,
        change_counter: img.change_counter,
        integrity: img.integrity,
        counts,
        tables,
        sqlite_sequence: img.sqlite_sequence,
        pause_state: img.rows.pause_state ?? [],
        chain_state: img.rows.chain_state ?? [],
    };
}

function imageCounts(img: ImageData): Record<string, number | 'absent'> {
    const counts: Record<string, number | 'absent'> = {};
    for (const t of TABLES) {
        const ti = img.tables[t];
        counts[t] = ti && ti.present ? (ti.count as number) : 'absent';
    }
    return counts;
}

// ---------------------------------------------------------------------------
// Diff B -> A
// ---------------------------------------------------------------------------

function diffImages(A: ImageData, B: ImageData): Record<string, TableDiff> {
    const out: Record<string, TableDiff> = {};
    for (const t of TABLES) {
        const pkA = A.tables[t]?.pk ?? EXPECTED_PK[t];
        const pkB = B.tables[t]?.pk ?? EXPECTED_PK[t];
        if (A.tables[t]?.present && B.tables[t]?.present && pkA !== pkB) {
            throw new ForensicFailure([`table ${t}: primary key differs between images (${pkB} vs ${pkA})`]);
        }
        const mapA = new Map((A.rows[t] ?? []).map((r) => [String(r[pkA]), r]));
        const mapB = new Map((B.rows[t] ?? []).map((r) => [String(r[pkB]), r]));
        const d: TableDiff = { added: [], removed: [], changed: [] };
        const keys = [...new Set([...mapA.keys(), ...mapB.keys()])].sort(compareKeys);
        for (const k of keys) {
            const a = mapA.get(k);
            const b = mapB.get(k);
            if (a && !b) d.added.push(a);
            else if (b && !a) d.removed.push(b);
            else if (a && b && stableJson(a) !== stableJson(b)) {
                const cols = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
                d.changed.push({
                    key: k,
                    columns: cols
                        .filter((c) => stableJson(a[c] ?? null) !== stableJson(b[c] ?? null))
                        .map((c) => ({ column: c, before: b[c] ?? null, after: a[c] ?? null })),
                });
            }
        }
        out[t] = d;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Test-literal index
// ---------------------------------------------------------------------------

const HEX_RE = /(?<![0-9A-Za-z_$])0x(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{40})(?![0-9A-Za-z_$])/g;
const VALID_LIT = /^0x(?:[0-9a-f]{64}|[0-9a-f]{40})$/;
const PIECE = String.raw`(?:'[^'\\\n]*'|"[^"\\\n]*")(?:\.repeat\(\s*\d+\s*\))?`;
const CHAIN_RE = new RegExp(String.raw`${PIECE}(?:\s*\+\s*${PIECE})+`, 'g');
const PIECE_RE = /(?:'([^'\\\n]*)'|"([^"\\\n]*)")(?:\.repeat\(\s*(\d+)\s*\))?/y;

const COMPUTED_CONCAT = "computed '0x' + ... concatenation";
const LIMIT_PATTERNS: { name: string; re: RegExp }[] = [
    { name: 'createRandom', re: /createRandom\s*\(/ },
    { name: 'randomBytes', re: /randomBytes\s*\(/ },
    { name: 'keccak256(', re: /(?<![A-Za-z])keccak256\s*\(/ },
    { name: 'solidityPackedKeccak256', re: /solidityPackedKeccak256\s*\(/ },
    // getAddress( over computed input: anything but a single plain address literal argument
    { name: 'getAddress(computed)', re: /getAddress\s*\(\s*(?!['"]0x[0-9a-fA-F]{40}['"]\s*\))/ },
    { name: 'computeAddress/getCreateAddress', re: /\b(?:computeAddress|getCreateAddress|getCreate2Address)\s*\(/ },
    { name: 'new Wallet(', re: /new\s+(?:ethers\s*\.\s*)?Wallet\s*\(/ },
    { name: 'hex helpers (zeroPadValue/toBeHex/hexlify/ethers.id)', re: /\b(?:zeroPadValue|toBeHex|hexlify)\s*\(|\bethers\s*\.\s*id\s*\(/ },
    { name: 'template 0x${...}', re: /`0x\$\{/ },
    // '0x...' + <non-literal operand>, e.g. '0x' + suffix or '0x' + String(n)
    { name: COMPUTED_CONCAT, re: /['"]0x[0-9a-fA-F]*['"]\s*\+\s*(?!['"\s])/ },
];

function lineStarts(s: string): number[] {
    const out = [0];
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) out.push(i + 1);
    return out;
}

function lineOf(starts: number[], off: number): number {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= off) lo = mid;
        else hi = mid - 1;
    }
    return lo + 1;
}

/** Hex literals in a file: plain 0x literals plus fully-literal string concatenations ('0x' + 'ab'.repeat(20)). */
function extractLiterals(content: string): { plain: { lit: string; line: number }[]; concat: { lit: string; line: number }[]; computedConcat: boolean } {
    const starts = lineStarts(content);
    const plain: { lit: string; line: number }[] = [];
    for (const m of content.matchAll(HEX_RE)) plain.push({ lit: m[0].toLowerCase(), line: lineOf(starts, m.index ?? 0) });
    const concat: { lit: string; line: number }[] = [];
    let computedConcat = false;
    for (const m of content.matchAll(CHAIN_RE)) {
        const idx = m.index ?? 0;
        let value = '';
        PIECE_RE.lastIndex = 0;
        const text = m[0];
        let pos = 0;
        while (pos < text.length) {
            PIECE_RE.lastIndex = pos;
            const p = PIECE_RE.exec(text);
            if (!p) {
                pos++;
                continue;
            }
            const s = p[1] ?? p[2] ?? '';
            value += p[3] !== undefined ? s.repeat(Number(p[3])) : s;
            pos = PIECE_RE.lastIndex;
        }
        const before = content.slice(Math.max(0, idx - 20), idx);
        const after = content.slice(idx + text.length, idx + text.length + 20);
        const partial = /\+\s*$/.test(before) || /^\s*\+/.test(after);
        const v = value.toLowerCase();
        if (!v.startsWith('0x')) continue;
        if (!partial && VALID_LIT.test(v)) concat.push({ lit: v, line: lineOf(starts, idx) });
        else if (partial) computedConcat = true;
    }
    return { plain, concat, computedConcat };
}

function buildLiteralIndex(input: LiteralInput): LiteralIndex {
    const srcSet = new Set<string>();
    for (const content of input.srcFiles.values()) {
        const ex = extractLiterals(content);
        for (const x of [...ex.plain, ...ex.concat]) srcSet.add(x.lit);
    }
    const literals = new Map<string, LiteralInfo>();
    const limits: { path: string; patterns: string[] }[] = [];
    const lines = new Map<string, string[]>();
    for (const p of [...input.testFiles.keys()].sort()) {
        const content = input.testFiles.get(p) as string;
        lines.set(p, content.split('\n'));
        const ex = extractLiterals(content);
        const add = (lit: string, line: number, form: 'plain' | 'concat-expanded'): void => {
            let li = literals.get(lit);
            if (!li) {
                li = { literal: lit, provenance: 'synthetic', occurrences: new Map(), forms: new Set() };
                literals.set(lit, li);
            }
            const arr = li.occurrences.get(p) ?? [];
            arr.push(line);
            li.occurrences.set(p, arr);
            li.forms.add(form);
        };
        for (const x of ex.plain) add(x.lit, x.line, 'plain');
        for (const x of ex.concat) add(x.lit, x.line, 'concat-expanded');
        const pats = new Set(LIMIT_PATTERNS.filter((lp) => lp.re.test(content)).map((lp) => lp.name));
        if (ex.computedConcat) pats.add(COMPUTED_CONCAT);
        if (pats.size > 0) limits.push({ path: p, patterns: [...pats].sort() });
    }
    for (const li of literals.values()) {
        const paths = [...li.occurrences.keys()];
        if (srcSet.has(li.literal)) li.provenance = 'production-constant';
        else if (paths.some((p) => PUBLIC_HISTORICAL_PREFIXES.some((pre) => p.startsWith(pre)))) li.provenance = 'public-historical';
        else li.provenance = 'synthetic';
    }
    return { literals, limits, lines, srcLiteralCount: srcSet.size };
}

/** Value tokens (lowercased string-literal contents and numbers) within WINDOW_LINES of the literal's lines. */
function windowValues(idx: LiteralIndex, p: string, lineNos: number[]): Set<string> {
    const ls = idx.lines.get(p) ?? [];
    const out = new Set<string>();
    for (const ln of lineNos) {
        const lo = Math.max(0, ln - 1 - WINDOW_LINES);
        const hi = Math.min(ls.length, ln + WINDOW_LINES);
        const text = ls.slice(lo, hi).join('\n');
        for (const m of text.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\\n$]*)`/g)) out.add((m[1] ?? m[2] ?? m[3] ?? '').toLowerCase());
        for (const m of text.matchAll(/(?<![\w.])(\d[\d_]*(?:\.\d+)?)n?(?![\w.])/g)) out.add(m[1].replace(/_/g, ''));
        for (const x of extractLiterals(text).concat) out.add(x.lit);
    }
    return out;
}

/** A column value counts as a corroborating match only if it is non-trivial. */
function isTrivialValue(v: string): boolean {
    return v === '' || v === '0' || v === '1' || v === 'null' || v === '[]';
}

// ---------------------------------------------------------------------------
// Matching and classification
// ---------------------------------------------------------------------------

/** "values:<cols>@<path>" for every test file where >= 2 other non-trivial column values sit near the literal. */
function valueCorroboration(row: Row, pk: string, col: string, li: LiteralInfo, idx: LiteralIndex): string[] {
    const out: string[] = [];
    if (li.provenance !== 'synthetic') return out;
    for (const p of [...li.occurrences.keys()].sort()) {
        const vals = windowValues(idx, p, li.occurrences.get(p) as number[]);
        const hit = Object.keys(row)
            .filter((c) => c !== pk && c !== col)
            .filter((c) => {
                const cv = row[c];
                if (cv === null) return false;
                const s = String(cv).toLowerCase();
                return !isTrivialValue(s) && vals.has(s);
            })
            .sort();
        if (hit.length >= 2) out.push(`values:${hit.join(',')}@${p}`);
    }
    return out;
}

function attributionOf(li: LiteralInfo, corroboration: string[]): MatchEntry['attribution'] {
    if (li.provenance === 'production-constant') return 'production-constant-literal';
    if (li.provenance === 'public-historical') return 'public-historical-literal';
    return corroboration.length > 0 ? 'attributed-test-write' : 'literal-match-uncorroborated';
}

const ATTRIBUTION_RANK: Record<MatchEntry['attribution'], number> = {
    'attributed-test-write': 3,
    'literal-match-uncorroborated': 2,
    'public-historical-literal': 1,
    'production-constant-literal': 0,
};

function literalHitsOfRow(row: Row, idx: LiteralIndex): { column: string; li: LiteralInfo }[] {
    const out: { column: string; li: LiteralInfo }[] = [];
    for (const col of MATCH_COLUMNS) {
        const v = row[col];
        if (typeof v !== 'string') continue;
        const li = idx.literals.get(v.toLowerCase());
        if (li) out.push({ column: col, li });
    }
    return out;
}

function classify(
    A: ImageData,
    B: ImageData,
    diff: Record<string, TableDiff>,
    idx: LiteralIndex,
): { matches: MatchEntry[]; unknown: UnknownOriginRow[] } {
    const matches: MatchEntry[] = [];
    const matchedKeys = new Set<string>();
    const tradeAttribution = new Map<string, string>();

    const changeOf = (t: string, k: string): MatchEntry['in_diff'] => {
        const d = diff[t];
        const pk = A.tables[t]?.pk ?? B.tables[t]?.pk ?? EXPECTED_PK[t as TableName];
        if (d.added.some((r) => String(r[pk]) === k)) return 'added';
        if (d.removed.some((r) => String(r[pk]) === k)) return 'removed';
        if (d.changed.some((c) => c.key === k)) return 'changed';
        return 'unchanged';
    };

    const rank = ATTRIBUTION_RANK;

    for (const t of TABLES) {
        const pk = A.tables[t]?.pk ?? B.tables[t]?.pk ?? EXPECTED_PK[t];
        const rowsA = new Map((A.rows[t] ?? []).map((r) => [String(r[pk]), r]));
        const rowsB = new Map((B.rows[t] ?? []).map((r) => [String(r[pk]), r]));
        const keys = [...new Set([...rowsA.keys(), ...rowsB.keys()])].sort(compareKeys);
        for (const k of keys) {
            for (const col of MATCH_COLUMNS) {
                const va = rowsA.get(k)?.[col];
                const vb = rowsB.get(k)?.[col];
                const lits = new Map<string, Set<'A' | 'B'>>();
                for (const [img, v] of [['A', va], ['B', vb]] as const) {
                    if (typeof v !== 'string') continue;
                    const lv = v.toLowerCase();
                    if (!idx.literals.has(lv)) continue;
                    const s = lits.get(lv) ?? new Set();
                    s.add(img);
                    lits.set(lv, s);
                }
                for (const [lit, imgs] of [...lits.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
                    const li = idx.literals.get(lit) as LiteralInfo;
                    const row = (rowsA.get(k) ?? rowsB.get(k)) as Row;
                    const inDiff = changeOf(t, k);
                    const corroboration: string[] = [];
                    if (inDiff === 'added' || inDiff === 'changed') corroboration.push(`diff:${inDiff}`);
                    corroboration.push(...valueCorroboration(row, pk, col, li, idx));
                    const attribution = attributionOf(li, corroboration);
                    const image: MatchEntry['image'] = imgs.has('A') && imgs.has('B') ? 'A+B' : imgs.has('A') ? 'A' : 'B';
                    matches.push({
                        table: t,
                        key: k,
                        image,
                        matched_column: col,
                        literal: lit,
                        literal_provenance: li.provenance,
                        literal_forms: [...li.forms].sort(),
                        test_paths: [...li.occurrences.keys()].sort(),
                        in_diff: inDiff,
                        corroboration,
                        attribution,
                        linked_rows: [],
                        row,
                    });
                    matchedKeys.add(`${t}\u0000${k}`);
                    if (t === 'trades') {
                        const prev = tradeAttribution.get(k);
                        if (prev === undefined || rank[attribution] > rank[prev as MatchEntry['attribution']]) tradeAttribution.set(k, attribution);
                    }
                }
            }
        }
    }

    // Rows keyed by trade_id that belong to a matched trade.
    for (const m of matches) {
        if (m.table !== 'trades') continue;
        for (const t of ['exit_state', 'lp_baseline'] as const) {
            const present = (A.rows[t] ?? []).some((r) => String(r.trade_id) === m.key) || (B.rows[t] ?? []).some((r) => String(r.trade_id) === m.key);
            if (present) m.linked_rows.push({ table: t, key: m.key });
        }
    }

    const unknown: UnknownOriginRow[] = [];
    for (const t of TABLES) {
        const pk = A.tables[t]?.pk ?? B.tables[t]?.pk ?? EXPECTED_PK[t];
        const d = diff[t];
        const entries: { key: string; change: UnknownOriginRow['change']; row: Row | null }[] = [
            ...d.added.map((r) => ({ key: String(r[pk]), change: 'added' as const, row: r })),
            ...d.changed.map((c) => ({ key: c.key, change: 'changed' as const, row: null })),
            ...d.removed.map((r) => ({ key: String(r[pk]), change: 'removed' as const, row: r })),
        ];
        for (const e of entries) {
            if (matchedKeys.has(`${t}\u0000${e.key}`)) continue;
            let linked: string | null = null;
            if (t === 'exit_state' || t === 'lp_baseline') linked = e.key;
            unknown.push({
                table: t,
                key: e.key,
                change: e.change,
                linked_trade_id: linked,
                linked_trade_attribution: linked !== null ? tradeAttribution.get(linked) ?? null : null,
            });
        }
    }
    unknown.sort((a, b) => (a.table !== b.table ? (a.table < b.table ? -1 : 1) : compareKeys(a.key, b.key)));
    matches.sort((a, b) =>
        a.table !== b.table
            ? a.table < b.table
                ? -1
                : 1
            : compareKeys(a.key, b.key) || (a.matched_column < b.matched_column ? -1 : a.matched_column > b.matched_column ? 1 : 0) || (a.literal < b.literal ? -1 : a.literal > b.literal ? 1 : 0),
    );
    return { matches, unknown };
}

// ---------------------------------------------------------------------------
// WAL frame inventory and commit-by-commit replay
// ---------------------------------------------------------------------------
//
// The two-image diff cannot see a row that was inserted and deleted again
// inside the window. The replay closes that gap without hand-parsing pages:
// for every commit frame k, a fresh throwaway folder R gets E's main-file
// bytes plus the first k frames of E's -wal (truncated at a frame boundary);
// SQLite's own recovery then yields exactly the state as of commit k. Only
// the frame headers are read here (page number, commit marker, salts).

const REPLAY_METHOD =
    'per commit frame k: throwaway copy = E main bytes + first k WAL frames; SQLite recovery, serialize, header patch, read-only in-memory open';

const hex8 = (n: number): string => '0x' + n.toString(16).padStart(8, '0');

function analyzeWal(E: string, A: ImageData, B: ImageData, idx: LiteralIndex): { report: WalReport; failures: string[] } {
    const failures: string[] = [];
    const rep: WalReport = {
        present: false,
        bytes: 0,
        magic: null,
        format_version: null,
        page_size: null,
        checkpoint_sequence: null,
        salts: null,
        frame_count: 0,
        trailing_bytes: 0,
        frames_salt_matching: 0,
        commit_frames: 0,
        pages_touched: [],
        frames: [],
        replay_method: REPLAY_METHOD,
        commit_points: [],
        distinct_row_states: 0,
        transient_rows: [],
    };
    const walPath = path.join(E, 'bot.db-wal');
    if (!fs.existsSync(walPath)) return { report: rep, failures };
    const wal = fs.readFileSync(walPath);
    rep.present = true;
    rep.bytes = wal.length;
    if (wal.length < 32) {
        rep.trailing_bytes = wal.length;
        return { report: rep, failures };
    }
    const magic = wal.readUInt32BE(0);
    rep.magic = hex8(magic);
    if (magic !== 0x377f0682 && magic !== 0x377f0683) {
        failures.push(`WAL magic ${rep.magic} is not a SQLite WAL header`);
        return { report: rep, failures };
    }
    rep.format_version = wal.readUInt32BE(4);
    const ps = wal.readUInt32BE(8);
    rep.page_size = ps;
    rep.checkpoint_sequence = wal.readUInt32BE(12);
    const salt1 = wal.readUInt32BE(16);
    const salt2 = wal.readUInt32BE(20);
    rep.salts = [hex8(salt1), hex8(salt2)];
    const fsz = 24 + ps;
    const n = Math.floor((wal.length - 32) / fsz);
    rep.frame_count = n;
    rep.trailing_bytes = wal.length - 32 - n * fsz;
    const pages = new Set<number>();
    for (let i = 0; i < n; i++) {
        const o = 32 + i * fsz;
        const f: WalFrame = {
            frame: i + 1,
            page: wal.readUInt32BE(o),
            commit_db_pages: wal.readUInt32BE(o + 4),
            salt_matches_header: wal.readUInt32BE(o + 8) === salt1 && wal.readUInt32BE(o + 12) === salt2,
        };
        rep.frames.push(f);
        if (f.salt_matches_header) {
            rep.frames_salt_matching++;
            pages.add(f.page);
            if (f.commit_db_pages > 0) rep.commit_frames++;
        }
    }
    rep.pages_touched = [...pages].sort((a, b) => a - b);

    const pkOf = (t: TableName): string => A.tables[t]?.pk ?? B.tables[t]?.pk ?? EXPECTED_PK[t];
    const finalRows = new Map<string, string>();
    const startRows = new Map<string, string>();
    for (const t of TABLES) {
        for (const r of A.rows[t] ?? []) finalRows.set(`${t}\u0000${String(r[pkOf(t)])}`, stableJson(r));
        for (const r of B.rows[t] ?? []) startRows.set(`${t}\u0000${String(r[pkOf(t)])}`, stableJson(r));
    }
    const states = new Set<string>([stableJson(B.rows)]);
    const transient = new Map<string, TransientRow>();
    const mainBytes = path.join(E, 'bot.db');
    let pending: number[] = [];
    for (const f of rep.frames) {
        if (!f.salt_matches_header) continue;
        pending.push(f.page);
        if (f.commit_db_pages === 0) continue;
        const R = fs.mkdtempSync(path.join(os.tmpdir(), 'forensic-R-'));
        let buf: Buffer | null = null;
        let err: string | null = null;
        try {
            fs.copyFileSync(mainBytes, path.join(R, 'bot.db'));
            fs.writeFileSync(path.join(R, 'bot.db-wal'), wal.subarray(0, 32 + f.frame * fsz));
            const r = new Database(path.join(R, 'bot.db'), { fileMustExist: true });
            try {
                buf = r.serialize();
            } finally {
                r.close();
            }
        } catch (e) {
            err = `replay copy at frame ${f.frame} could not be opened/serialized: ${errMsg(e)}`;
        } finally {
            fs.rmSync(R, { recursive: true, force: true });
        }
        const { img, db } = openImage(buf, err);
        db?.close();
        if (!img.integrity_ok) failures.push(`replay image at commit frame ${f.frame} integrity: ${img.integrity}`);
        rep.commit_points.push({
            frame: f.frame,
            pages_written: [...new Set(pending)].sort((a, b) => a - b),
            user_version: img.user_version,
            change_counter: img.change_counter,
            integrity: img.integrity,
            counts: imageCounts(img),
            rows_equal_merged_image: stableJson(img.rows) === stableJson(A.rows),
        });
        pending = [];
        if (!img.integrity_ok) continue;
        states.add(stableJson(img.rows));
        for (const t of TABLES) {
            const pk = pkOf(t);
            for (const r of img.rows[t] ?? []) {
                const k = String(r[pk]);
                const id = `${t}\u0000${k}`;
                const rj = stableJson(r);
                if (rj === finalRows.get(id) || rj === startRows.get(id)) continue;
                const tid = `${id}\u0000${rj}`;
                const prev = transient.get(tid);
                if (prev) {
                    prev.last_commit_frame = f.frame;
                    continue;
                }
                const hits = literalHitsOfRow(r, idx);
                let best: TransientRow['attribution'] = 'unknown-origin';
                const corroboration = ['diff:transient'];
                for (const h of hits) {
                    const vc = valueCorroboration(r, pk, h.column, h.li, idx);
                    corroboration.push(...vc);
                    const a = attributionOf(h.li, ['diff:transient', ...vc]);
                    if (best === 'unknown-origin' || ATTRIBUTION_RANK[a] > ATTRIBUTION_RANK[best]) best = a;
                }
                transient.set(tid, {
                    table: t,
                    key: k,
                    first_commit_frame: f.frame,
                    last_commit_frame: f.frame,
                    literal_matches: hits.map((h) => ({
                        column: h.column,
                        literal: h.li.literal,
                        literal_provenance: h.li.provenance,
                        test_paths: [...h.li.occurrences.keys()].sort(),
                    })),
                    corroboration: [...new Set(corroboration)].sort(),
                    attribution: best,
                    row: r,
                });
            }
        }
    }
    rep.distinct_row_states = states.size;
    rep.transient_rows = [...transient.values()].sort((a, b) =>
        a.table !== b.table ? (a.table < b.table ? -1 : 1) : compareKeys(a.key, b.key) || a.first_commit_frame - b.first_commit_frame,
    );
    return { report: rep, failures };
}

/**
 * 0x hex strings in the raw bytes of E's main file and -wal that are not a value of any
 * live row in either image: leftovers of deleted or overwritten rows (secure_delete is
 * off in this SQLite build, so freed cell bytes usually survive until a page rewrite).
 */
function residualHex(E: string, A: ImageData, B: ImageData, idx: LiteralIndex): ResidualHex[] {
    const live = new Set<string>();
    for (const img of [A, B]) {
        for (const t of TABLES) for (const r of img.rows[t] ?? []) for (const v of Object.values(r)) if (typeof v === 'string') live.add(v.toLowerCase());
    }
    const out: ResidualHex[] = [];
    for (const rel of ['data/bot.db', 'data/bot.db-wal']) {
        const p = path.join(E, path.basename(rel));
        if (!fs.existsSync(p)) continue;
        // No boundary assertions: record bytes are packed, so the next column ('eth', digits)
        // often continues the hex run. Each run is judged by its 40- and 64-hex prefixes.
        const found = new Map<string, { candidates: string[]; li: LiteralInfo | undefined; count: number }>();
        for (const m of fs.readFileSync(p).toString('latin1').matchAll(/0x([0-9a-fA-F]{40,})/g)) {
            const h = m[1].toLowerCase();
            const c40 = '0x' + h.slice(0, 40);
            const c64 = h.length >= 64 ? '0x' + h.slice(0, 64) : null;
            if (live.has(c40) || (c64 !== null && live.has(c64))) continue;
            const li = (c64 !== null ? idx.literals.get(c64) : undefined) ?? idx.literals.get(c40);
            const key = li ? li.literal : (c64 ?? c40);
            const prev = found.get(key);
            if (prev) prev.count++;
            else found.set(key, { candidates: c64 !== null ? [c40, c64] : [c40], li, count: 1 });
        }
        for (const [lit, f] of [...found.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
            out.push({
                file: rel,
                literal: lit,
                candidates: f.candidates,
                occurrences: f.count,
                test_literal_provenance: f.li ? f.li.provenance : null,
                test_paths: f.li ? [...f.li.occurrences.keys()].sort() : [],
            });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Git reading (real runs)
// ---------------------------------------------------------------------------

function git(args: string[], input?: string): Buffer {
    const r = cp.spawnSync('git', ['-C', REPO_ROOT, ...args], { input, maxBuffer: 1 << 30, windowsHide: true });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new ForensicFailure([`git ${args.join(' ')} failed: ${r.stderr.toString('utf8').trim()}`]);
    return r.stdout;
}

function readTreeAt(sha: string, prefix: string): Map<string, string> {
    const paths = git(['ls-tree', '-r', '-z', '--name-only', sha, '--', prefix])
        .toString('utf8')
        .split('\u0000')
        .filter((p) => p.length > 0 && (p === prefix || p.startsWith(prefix + '/')))
        .sort();
    const out = new Map<string, string>();
    if (paths.length === 0) return out;
    const buf = git(['cat-file', '--batch'], paths.map((p) => `${sha}:${p}`).join('\n') + '\n');
    let pos = 0;
    for (const p of paths) {
        const nl = buf.indexOf(10, pos);
        const header = buf.subarray(pos, nl).toString('utf8');
        const m = /^[0-9a-f]{40} blob (\d+)$/.exec(header);
        if (!m) throw new ForensicFailure([`git cat-file: unexpected header for ${p}: ${header}`]);
        const size = Number(m[1]);
        out.set(p, buf.subarray(nl + 1, nl + 1 + size).toString('utf8'));
        pos = nl + 1 + size + 1;
    }
    return out;
}

function gitLiteralInput(sha: string): LiteralInput {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new ForensicFailure(['--test-literals-sha must be a full 40-hex commit SHA']);
    git(['cat-file', '-e', `${sha}^{commit}`]);
    return { sha, testFiles: readTreeAt(sha, 'test'), srcFiles: readTreeAt(sha, 'src') };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function scriptIdentity(): { sha: string; blob: string | null } {
    const self = fs.readFileSync(__filename);
    let blob: string | null = null;
    try {
        blob = git(['hash-object', '--', __filename]).toString('utf8').trim();
    } catch {
        blob = null;
    }
    return { sha: sha256(self), blob };
}

function runForensic(o: { source: string; out: string; literals: LiteralInput; log: (l: string) => void }): RunResult {
    const startedAt = new Date().toISOString();
    const source = path.resolve(o.source);
    const out = path.resolve(o.out);
    if (isInside(source, REPO_ROOT)) throw new ForensicFailure([`--source ${source} is inside the repository; only a backup copy outside the repo may be read (NAC-03)`]);
    if (isInside(out, REPO_ROOT)) throw new ForensicFailure([`--out ${out} is inside the repository; the report holds trade history and must stay outside the repo`]);
    if (!fs.existsSync(path.join(source, 'data', 'bot.db'))) throw new ForensicFailure([`--source ${source} has no data/bot.db`]);
    fs.mkdirSync(out, { recursive: true });
    const reportPath = path.join(out, 'report.json');
    const metaPath = path.join(out, 'run-meta.json');
    for (const p of [reportPath, metaPath]) if (fs.existsSync(p)) throw new ForensicFailure([`${p} already exists; refusing to overwrite`]);

    const failures: string[] = [];
    const srcBefore = hashFolder(source, 'source');
    const E = fs.mkdtempSync(path.join(os.tmpdir(), 'forensic-E-'));
    const W = fs.mkdtempSync(path.join(os.tmpdir(), 'forensic-W-'));
    let eBefore: HashSet = {};
    let eAfter: HashSet = {};
    let report: Report;
    const dbs: DB[] = [];
    try {
        // E: byte copy of the source DB set; hashed; never opened.
        for (const rel of DB_FILES) {
            if (srcBefore[rel].present) fs.copyFileSync(path.join(source, rel), path.join(E, path.basename(rel)));
        }
        eBefore = hashFolder(E, 'flat');
        if (!sameHashes(eBefore, srcBefore)) failures.push('E copy hashes differ from the source hashes');
        // W: byte copy of E; the only file SQLite opens.
        for (const rel of DB_FILES) {
            const f = path.join(E, path.basename(rel));
            if (fs.existsSync(f)) fs.copyFileSync(f, path.join(W, path.basename(rel)));
        }
        let merged: Buffer | null = null;
        let mergedErr: string | null = null;
        try {
            const w = new Database(path.join(W, 'bot.db'), { fileMustExist: true });
            try {
                merged = w.serialize();
            } finally {
                w.close();
            }
        } catch (e) {
            mergedErr = `throwaway copy W could not be opened/serialized: ${errMsg(e)}`;
        }
        const checkpointBytes = fs.readFileSync(path.join(E, 'bot.db'));

        const a = openImage(merged, mergedErr);
        const b = openImage(checkpointBytes, null);
        if (a.db) dbs.push(a.db);
        if (b.db) dbs.push(b.db);
        const A = a.img;
        const B = b.img;
        const integrityFailed = !A.integrity_ok || !B.integrity_ok;
        if (!A.integrity_ok) failures.push(`image A (merged) integrity: ${A.integrity}`);
        if (!B.integrity_ok) failures.push(`image B (checkpoint) integrity: ${B.integrity}`);

        const idx = buildLiteralIndex(o.literals);
        const byProv: Record<string, number> = { 'production-constant': 0, 'public-historical': 0, synthetic: 0 };
        for (const li of idx.literals.values()) byProv[li.provenance]++;

        report = {
            tool: 'scripts/forensic-db.ts',
            report_version: 1,
            source: { folder: posix(source), files: srcBefore },
            test_literals: {
                sha: o.literals.sha,
                test_file_count: o.literals.testFiles.size,
                src_file_count: o.literals.srcFiles.size,
                literal_count: idx.literals.size,
                by_provenance: byProv,
                window_lines: WINDOW_LINES,
                match_columns: [...MATCH_COLUMNS],
            },
            integrity_failed: integrityFailed,
            images: { [IMAGE_A]: imageSummary(A), [IMAGE_B]: imageSummary(B) },
            diff: null,
            diff_counts: null,
            state_changes: null,
            test_literal_matches: [],
            attribution_counts: {
                'attributed-test-write': 0,
                'literal-match-uncorroborated': 0,
                'production-constant-literal': 0,
                'public-historical-literal': 0,
            },
            unknown_origin_diff_rows: [],
            extraction_limits: idx.limits,
            wal: null,
            residual_hex_strings: null,
            rows_merged_image: null,
        };
        if (!integrityFailed) {
            const diff = diffImages(A, B);
            const { matches, unknown } = classify(A, B, diff, idx);
            const diffCounts: Record<string, { added: number; removed: number; changed: number }> = {};
            for (const t of TABLES) diffCounts[t] = { added: diff[t].added.length, removed: diff[t].removed.length, changed: diff[t].changed.length };
            const changed = (t: string): boolean => diffCounts[t].added + diffCounts[t].removed + diffCounts[t].changed > 0;
            report.diff = diff;
            report.diff_counts = diffCounts;
            report.state_changes = {
                chain_state_changed: changed('chain_state'),
                exit_state_changed: changed('exit_state'),
                lp_baseline_changed: changed('lp_baseline'),
                pause_state_changed: changed('pause_state'),
                trades_changed: changed('trades'),
                user_version_changed: A.user_version !== B.user_version,
            };
            report.test_literal_matches = matches;
            for (const m of matches) report.attribution_counts[m.attribution]++;
            report.unknown_origin_diff_rows = unknown;
            const w = analyzeWal(E, A, B, idx);
            failures.push(...w.failures);
            report.wal = w.report;
            report.state_changes.transient_rows_found = w.report.transient_rows.length > 0;
            report.residual_hex_strings = residualHex(E, A, B, idx);
            report.rows_merged_image = A.rows;
        }
    } finally {
        for (const d of dbs) {
            try {
                d.close();
            } catch {
                /* in-memory image */
            }
        }
        fs.rmSync(W, { recursive: true, force: true });
        eAfter = hashFolder(E, 'flat');
        fs.rmSync(E, { recursive: true, force: true });
    }
    const srcAfter = hashFolder(source, 'source');
    const eUnchanged = sameHashes(eBefore, eAfter);
    const srcUnchanged = sameHashes(srcBefore, srcAfter);
    if (!eUnchanged) failures.push('E hashes changed during the run');
    if (!srcUnchanged) failures.push('source hashes changed during the run');

    const reportText = stableJson(report);
    fs.writeFileSync(reportPath, reportText);
    const exitCode: 0 | 1 = failures.length > 0 ? 1 : 0;
    const id = scriptIdentity();
    const meta: RunMeta = {
        tool: 'scripts/forensic-db.ts',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        node: process.version,
        node_abi: process.versions.modules,
        script_sha256: id.sha,
        script_git_blob_sha: id.blob,
        source: posix(source),
        out: posix(out),
        source_hashes_before: srcBefore,
        source_hashes_after: srcAfter,
        source_unchanged: srcUnchanged,
        e_hashes_before: eBefore,
        e_hashes_after: eAfter,
        e_unchanged: eUnchanged,
        e_equals_source: sameHashes(eBefore, srcBefore),
        report_sha256: sha256(Buffer.from(reportText, 'utf8')),
        exit_code: exitCode,
        failures,
    };
    fs.writeFileSync(metaPath, stableJson(meta));
    for (const f of failures) o.log(`forensic-db: FAIL: ${f}`);
    return { exitCode, reportPath, metaPath, report, meta };
}

function printDigest(r: RunResult, log: (l: string) => void): void {
    const rep = r.report;
    log(`report:      ${posix(r.reportPath)}`);
    log(`report sha:  ${r.meta.report_sha256}`);
    log(`E unchanged: ${String(r.meta.e_unchanged)}  source unchanged: ${String(r.meta.source_unchanged)}`);
    log(`integrity_failed: ${String(rep.integrity_failed)}`);
    for (const k of [IMAGE_A, IMAGE_B]) {
        const im = rep.images[k] as { user_version: number | null; integrity: string; counts: Record<string, unknown> };
        log(`${k}: user_version=${String(im.user_version)} integrity=${im.integrity.split('\n')[0]} counts=${JSON.stringify(im.counts)}`);
    }
    if (rep.diff_counts) log(`diff B->A:   ${JSON.stringify(rep.diff_counts)}`);
    if (rep.state_changes) log(`state:       ${JSON.stringify(rep.state_changes)}`);
    log(`literals:    ${rep.test_literals.literal_count} ${JSON.stringify(rep.test_literals.by_provenance)}`);
    log(`matches:     ${rep.test_literal_matches.length} ${JSON.stringify(rep.attribution_counts)}`);
    log(`unknown-origin diff rows: ${rep.unknown_origin_diff_rows.length}`);
    if (rep.wal) {
        const w = rep.wal;
        const headerOnly = w.commit_points.filter((c) => c.pages_written.length === 1 && c.pages_written[0] === 1).length;
        log(
            `wal:         ${w.bytes} B, ${w.frame_count} frames (${w.frames_salt_matching} current), ${w.commit_frames} commits, ` +
                `pages ${JSON.stringify(w.pages_touched)}, header-only commits ${headerOnly}, distinct row states ${w.distinct_row_states}, transient rows ${w.transient_rows.length}`,
        );
    }
    if (rep.residual_hex_strings) log(`residual hex strings (not in live rows): ${rep.residual_hex_strings.length}`);
    log(`extraction limits: ${rep.extraction_limits.length} test files`);
}

// ---------------------------------------------------------------------------
// Self-test (temp fixtures only)
// ---------------------------------------------------------------------------

const FIXTURE_SCHEMA = `
CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL COLLATE NOCASE, chain TEXT NOT NULL DEFAULT 'eth',
  action TEXT NOT NULL, tx_hash TEXT, amount_in TEXT, status TEXT NOT NULL DEFAULT 'pending');
CREATE TABLE exit_state (trade_id INTEGER PRIMARY KEY, entry_price REAL NOT NULL, original_token_amount TEXT NOT NULL);
CREATE TABLE pause_state (id INTEGER PRIMARY KEY CHECK(id = 1), paused INTEGER NOT NULL DEFAULT 0, paused_at INTEGER, paused_by TEXT, reason TEXT);
CREATE TABLE chain_state (chain TEXT PRIMARY KEY, last_seen_block INTEGER NOT NULL, last_updated_ts INTEGER NOT NULL);
CREATE TABLE lp_baseline (trade_id INTEGER PRIMARY KEY, pool_type TEXT NOT NULL, pair_or_pool_address TEXT NOT NULL COLLATE NOCASE, snapshot_block INTEGER NOT NULL);
`;

const hx = (pair: string, n: number): string => '0x' + pair.repeat(n);

async function selfTest(): Promise<number> {
    const results: { name: string; ok: boolean; detail: string }[] = [];
    const check = (name: string, ok: boolean, detail = ''): void => {
        results.push({ name, ok, detail });
        console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forensic-selftest-'));
    const L = {
        R: hx('d4', 20), // synthetic, unchanged, no matching values
        V: hx('e5', 20), // synthetic, unchanged, two matching values
        C: hx('f6', 20), // production constant (also in src/)
        X: hx('ab', 20), // only as '0x' + 'ab'.repeat(20) in a test
        S: hx('51', 20), // synthetic, WAL-only (added)
        STX: hx('77', 32), // S's tx hash, synthetic
        P: hx('b2', 20), // only in a realLaunches fixture
        U: hx('c3', 20), // matches no literal
        PAIR: hx('99', 20), // lp_baseline pair, no literal
        T: hx('3e', 20), // synthetic; inserted and deleted again inside the WAL (transient)
        RES: hx('4d', 20), // synthetic; inserted and deleted before the checkpoint (residual bytes)
    };
    try {
        // --- fixture DB: base rows checkpointed into the main file ---
        const src = path.join(root, 'backup');
        fs.mkdirSync(path.join(src, 'data'), { recursive: true });
        const dbPath = path.join(src, 'data', 'bot.db');
        const base = new Database(dbPath);
        base.pragma('journal_mode = WAL');
        base.exec(FIXTURE_SCHEMA);
        const ins = base.prepare('INSERT INTO trades (id, token, chain, action, tx_hash, amount_in, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
        ins.run(1, L.R, 'eth', 'buy', null, '5550001', 'pending');
        ins.run(2, L.V, 'arbitrum', 'buy', null, '987654321', 'pending');
        ins.run(3, L.C, 'eth', 'buy', null, '1234', 'sold');
        ins.run(4, L.X, 'eth', 'buy', null, '3141592', 'pending');
        ins.run(8, L.RES, 'eth', 'buy', null, '8080', 'pending');
        base.exec('DELETE FROM trades WHERE id = 8');
        base.exec(`INSERT INTO pause_state (id, paused) VALUES (1, 0); INSERT INTO chain_state VALUES ('eth', 100, 1700000000);`);
        base.close(); // checkpoints; the main file now holds every base row

        // --- child process writes WAL-only rows and is force-killed before any checkpoint ---
        const childCode = [
            'const a = JSON.parse(process.argv[1]);',
            'const Database = require(a.mod);',
            'const db = new Database(a.db);',
            "db.pragma('wal_autocheckpoint = 0');",
            'db.exec(a.sql);',
            "process.stdout.write('READY\\n');",
            'setInterval(() => {}, 1000);',
        ].join('\n');
        const walSql = [
            `INSERT INTO trades (id, token, chain, action, tx_hash, amount_in, status) VALUES (5, '${L.S}', 'base', 'buy', '${L.STX}', '424242', 'pending');`,
            `INSERT INTO trades (id, token, chain, action, tx_hash, amount_in, status) VALUES (6, '${L.P.toUpperCase().replace('0X', '0x')}', 'eth', 'buy', NULL, '1000', 'pending');`,
            `INSERT INTO trades (id, token, chain, action, tx_hash, amount_in, status) VALUES (7, '${L.U}', 'eth', 'buy', NULL, '2000', 'pending');`,
            `INSERT INTO exit_state VALUES (5, 0.5, '424242');`,
            `INSERT INTO lp_baseline VALUES (6, 'v2', '${L.PAIR}', 17000000);`,
            `UPDATE pause_state SET paused = 1, paused_by = 'cli', reason = 'selftest' WHERE id = 1;`,
            `INSERT INTO trades (id, token, chain, action, tx_hash, amount_in, status) VALUES (9, '${L.T}', 'eth', 'buy', NULL, '9090', 'pending');`,
            `DELETE FROM trades WHERE id = 9;`,
        ].join('\n');
        const payload = JSON.stringify({ mod: require.resolve('better-sqlite3'), db: dbPath, sql: walSql });
        const env: NodeJS.ProcessEnv = {};
        for (const k of ['SystemRoot', 'TEMP', 'TMP']) if (process.env[k]) env[k] = process.env[k];
        const child = cp.spawn(process.execPath, ['-e', childCode, payload], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env });
        let stderr = '';
        child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
        const exited = new Promise<void>((res) => child.on('exit', () => res()));
        await new Promise<void>((res, rej) => {
            let buf = '';
            const t = setTimeout(() => rej(new Error(`child did not become READY: ${stderr}`)), 30000);
            child.stdout.on('data', (d: Buffer) => {
                buf += d.toString('utf8');
                if (buf.includes('READY')) {
                    clearTimeout(t);
                    res();
                }
            });
            child.on('exit', (c) => {
                clearTimeout(t);
                if (!buf.includes('READY')) rej(new Error(`child exited ${String(c)} before READY: ${stderr}`));
            });
        });
        if (process.platform === 'win32') cp.spawnSync('taskkill', ['/F', '/PID', String(child.pid)], { windowsHide: true });
        else child.kill('SIGKILL');
        await exited;
        const walSize = fs.existsSync(dbPath + '-wal') ? fs.statSync(dbPath + '-wal').size : 0;
        check('fixture: writer force-killed with uncheckpointed frames in -wal', walSize > 0, `wal ${walSize} B`);

        // --- injected literal sources (instead of git show) ---
        const testFiles = new Map<string, string>([
            ['test/unit/r.test.ts', `export const R_TOKEN = '${L.R}';\n`],
            ['test/unit/v.test.ts', `const token = '${L.V}';\ninsertTrade({ token, chain: 'arbitrum', amount_in: '987654321' });\n`],
            ['test/unit/c.test.ts', `const WETH = '${L.C}';\n`],
            ['test/unit/x.test.ts', `const token = '0x' + 'ab'.repeat(20); // deterministic\n`],
            ['test/unit/s.test.ts', `const S = '${L.S}';\nconst tx = '${L.STX}';\ninsert({ token: S, chain: 'base', amount_in: '424242', tx_hash: tx });\n`],
            ['test/fork/fixtures/realLaunches/fixture-p.json', `{ "tokenAddress": "${'0x' + L.P.slice(2).toUpperCase()}", "chain": "eth" }\n`],
            ['test/unit/random.test.ts', `const w = ethers.Wallet.createRandom();\nconst t = '0x' + suffix;\n`],
            ['test/unit/t.test.ts', `const TRANSIENT = '${L.T}';\nconst GONE = '${L.RES}';\n`],
        ]);
        const srcFiles = new Map<string, string>([['src/constants.ts', `export const WETH = '${L.C}';\n`]]);
        const literals: LiteralInput = { sha: '0'.repeat(40), testFiles, srcFiles };

        const srcHashesBefore = hashFolder(src, 'source');
        const quiet = (): void => {};
        const r1 = runForensic({ source: src, out: path.join(root, 'run1'), literals, log: quiet });
        const r2 = runForensic({ source: src, out: path.join(root, 'run2'), literals, log: quiet });
        const rep = r1.report;
        check('run exits 0 on a healthy fixture', r1.exitCode === 0 && r2.exitCode === 0, `exit ${r1.exitCode}/${r2.exitCode}; ${r1.meta.failures.join('; ')}`);

        const imgA = rep.images[IMAGE_A] as { counts: Record<string, unknown>; header_patched: boolean };
        const imgB = rep.images[IMAGE_B] as { counts: Record<string, unknown>; header_patched: boolean };
        check('WAL-only rows are in image A counts', imgA.counts.trades === 7 && imgA.counts.exit_state === 1 && imgA.counts.lp_baseline === 1, JSON.stringify(imgA.counts));
        check('image B (checkpoint) does not contain the WAL-only rows', imgB.counts.trades === 4 && imgB.counts.exit_state === 0 && imgB.counts.lp_baseline === 0, JSON.stringify(imgB.counts));
        check('both in-memory images were header-patched 2 -> 1', imgA.header_patched && imgB.header_patched);
        const addedKeys = (rep.diff?.trades.added ?? []).map((r) => String(r.id));
        check('WAL-only rows are added in the B -> A diff', addedKeys.join(',') === '5,6,7', addedKeys.join(','));
        check('pause_state change detected (changed row, state_changes)', rep.state_changes?.pause_state_changed === true && (rep.diff?.pause_state.changed.length ?? 0) === 1);

        const m = (key: string, col = 'token'): MatchEntry | undefined => rep.test_literal_matches.find((x) => x.table === 'trades' && x.key === key && x.matched_column === col);
        const S = m('5');
        check('S (synthetic + added) is attributed-test-write', S?.attribution === 'attributed-test-write' && S.in_diff === 'added', JSON.stringify(S?.corroboration));
        const Stx = m('5', 'tx_hash');
        check('S tx_hash literal match is attributed-test-write', Stx?.attribution === 'attributed-test-write');
        check('S is linked to its exit_state row', (S?.linked_rows ?? []).some((l) => l.table === 'exit_state'));
        const P = m('6');
        check('P (realLaunches fixture literal) is public-historical-literal, not attributed', P?.attribution === 'public-historical-literal' && P.literal_provenance === 'public-historical', String(P?.attribution));
        const U = rep.unknown_origin_diff_rows.find((x) => x.table === 'trades' && x.key === '7');
        check('U (no literal) is an unknown-origin diff row', U?.change === 'added' && m('7') === undefined);
        const lp = rep.unknown_origin_diff_rows.find((x) => x.table === 'lp_baseline' && x.key === '6');
        check('linked lp_baseline row is unknown-origin with the trade attribution attached', lp?.linked_trade_attribution === 'public-historical-literal');
        const R = m('1');
        check('R (synthetic, unchanged, no matching columns) is literal-match-uncorroborated', R?.attribution === 'literal-match-uncorroborated' && R.in_diff === 'unchanged' && R.corroboration.length === 0);
        const V = m('2');
        check(
            'V (synthetic, unchanged, two matching column values) is attributed-test-write by values',
            V?.attribution === 'attributed-test-write' && V.in_diff === 'unchanged' && V.corroboration.some((c) => c.startsWith('values:amount_in,chain@')),
            JSON.stringify(V?.corroboration),
        );
        const C = m('3');
        check('C (also in src/) is production-constant-literal', C?.attribution === 'production-constant-literal');
        const X = m('4');
        check("X ('0x' + 'ab'.repeat(20)) is matched via concat expansion", X?.attribution === 'literal-match-uncorroborated' && (X?.literal_forms ?? []).includes('concat-expanded'));
        const lim = rep.extraction_limits.find((e) => e.path === 'test/unit/random.test.ts');
        check('extraction limits list the runtime-generating test file', !!lim && lim.patterns.includes('createRandom') && lim.patterns.some((p) => p.startsWith('computed')), JSON.stringify(lim?.patterns));
        const wal = rep.wal;
        check(
            'WAL replay visits every commit frame (8 single-statement commits)',
            !!wal && wal.commit_frames === 8 && wal.commit_points.length === 8 && wal.commit_points[wal.commit_points.length - 1].rows_equal_merged_image,
            `commits ${String(wal?.commit_frames)}, points ${String(wal?.commit_points.length)}`,
        );
        const T = wal?.transient_rows.find((x) => x.table === 'trades' && x.key === '9');
        check(
            'T (inserted and deleted inside the WAL) is a transient row, attributed-test-write, absent from A and B',
            T?.attribution === 'attributed-test-write' && T.corroboration.includes('diff:transient') && m('9') === undefined && !addedKeys.includes('9'),
            JSON.stringify(T?.corroboration),
        );
        const unrelatedTransient = (wal?.transient_rows ?? []).filter((x) => !(x.table === 'trades' && x.key === '9'));
        check('no other row is reported transient (rows added once are not transient)', unrelatedTransient.length === 0, JSON.stringify(unrelatedTransient.map((x) => `${x.table}:${x.key}`)));
        const res = (rep.residual_hex_strings ?? []).find((x) => x.literal === L.RES && x.file === 'data/bot.db');
        check('RES (deleted before the checkpoint) is found as a residual hex string in the main file', res?.test_literal_provenance === 'synthetic', JSON.stringify(res));
        const resT = (rep.residual_hex_strings ?? []).find((x) => x.literal === L.T && x.file === 'data/bot.db-wal');
        check('T (transient) also leaves residual bytes in the -wal', resT?.test_literal_provenance === 'synthetic');
        const liveVals = new Set([L.R, L.V, L.C, L.X, L.S, L.STX, L.P, L.U, L.PAIR]);
        const liveReported = (rep.residual_hex_strings ?? []).filter((x) => x.candidates.some((c) => liveVals.has(c)));
        check('no live value is reported as residual (packed record bytes handled)', liveReported.length === 0, JSON.stringify(liveReported.map((x) => x.literal)));
        const seqB = (rep.images[IMAGE_B] as { sqlite_sequence: Row[] }).sqlite_sequence.find((r) => r.name === 'trades');
        check('sqlite_sequence shows the deleted id (trades seq 8 in B)', seqB?.seq === '8', JSON.stringify(seqB));
        check('E hashes unchanged and E equals the source', r1.meta.e_unchanged && r1.meta.e_equals_source && r2.meta.e_unchanged);
        check('source fixture folder unchanged', sameHashes(srcHashesBefore, hashFolder(src, 'source')) && r1.meta.source_unchanged);
        const b1 = fs.readFileSync(r1.reportPath);
        const b2 = fs.readFileSync(r2.reportPath);
        check('second run report.json is byte-identical', b1.equals(b2), `${sha256(b1).slice(0, 12)} vs ${sha256(b2).slice(0, 12)}`);

        // --- STL-3: the unpatched serialized buffer is refused ---
        const W2 = path.join(root, 'stl3');
        fs.mkdirSync(W2);
        for (const f of ['bot.db', 'bot.db-wal', 'bot.db-shm']) if (fs.existsSync(path.join(src, 'data', f))) fs.copyFileSync(path.join(src, 'data', f), path.join(W2, f));
        const w2 = new Database(path.join(W2, 'bot.db'));
        const raw = w2.serialize();
        w2.close();
        // better-sqlite3 12.8.0 accepts the Buffer in the constructor; SQLite refuses at the
        // first read (diagnosed during 22-06: the constructor succeeds, the first query
        // returns SQLITE_CANTOPEN), so the control opens AND reads.
        let refused = '';
        let unpatched: DB | null = null;
        try {
            unpatched = new Database(raw, { readonly: true });
            unpatched.prepare('SELECT count(*) AS n FROM sqlite_master').get();
        } catch (e) {
            refused = errMsg(e);
        } finally {
            unpatched?.close();
        }
        const patchedOk = (() => {
            const pdb = new Database(toRollbackHeader(raw).buf, { readonly: true });
            try {
                return Number((pdb.prepare('SELECT count(*) AS n FROM trades').get() as { n: number }).n) === 7;
            } finally {
                pdb.close();
            }
        })();
        check(
            'unpatched WAL-header buffer is refused at first read; the patched copy reads (STL-3)',
            /CANTOPEN/.test(refused) && raw[18] === 2 && raw[19] === 2 && patchedOk,
            `${refused}; patched reads 7 trades: ${String(patchedOk)}`,
        );

        // --- integrity failure is fatal ---
        const bad = path.join(root, 'bad');
        fs.mkdirSync(path.join(bad, 'data'), { recursive: true });
        const badDb = path.join(bad, 'data', 'bot.db');
        const g = new Database(badDb);
        g.pragma('journal_mode = WAL');
        g.exec(FIXTURE_SCHEMA);
        const gi = g.prepare('INSERT INTO trades (token, chain, action, amount_in) VALUES (?, ?, ?, ?)');
        for (let i = 0; i < 200; i++) gi.run(hx('0' + (i % 10).toString(), 20), 'eth', 'buy', 'x'.repeat(100));
        const rootpage = Number((g.prepare(`SELECT rootpage FROM sqlite_master WHERE name = 'trades'`).get() as { rootpage: number }).rootpage);
        const pageSize = Number(g.pragma('page_size', { simple: true }));
        g.close();
        const bytes = fs.readFileSync(badDb);
        bytes[(rootpage - 1) * pageSize] = 0x00; // invalid b-tree page type
        fs.writeFileSync(badDb, bytes);
        const rb = runForensic({ source: bad, out: path.join(root, 'bad-run'), literals, log: quiet });
        const rbJson = JSON.parse(fs.readFileSync(rb.reportPath, 'utf8')) as { integrity_failed: boolean };
        check('corrupted fixture exits 1 with integrity_failed: true', rb.exitCode === 1 && rbJson.integrity_failed === true, rb.meta.failures[0]?.split('\n')[0] ?? '');

        // --- guards ---
        let guard = '';
        try {
            runForensic({ source: REPO_ROOT, out: path.join(root, 'guard'), literals, log: quiet });
        } catch (e) {
            guard = errMsg(e);
        }
        check('a --source inside the repository is refused', /inside the repository/.test(guard));
    } catch (e) {
        check('self-test crashed', false, e instanceof Error ? e.stack ?? e.message : String(e));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed === 0 ? `SELF-TEST OK (${results.length} checks)` : `SELF-TEST FAILED (${failed} of ${results.length})`);
    return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
    'usage:',
    '  forensic-db.ts --self-test',
    '  forensic-db.ts --source <backup dated folder> --out <report folder> --test-literals-sha <40-hex sha>',
].join('\n');

function parseArgs(argv: string[]): Map<string, string | true> {
    const known = new Set(['--self-test', '--source', '--out', '--test-literals-sha']);
    const valued = new Set(['--source', '--out', '--test-literals-sha']);
    const out = new Map<string, string | true>();
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!known.has(a)) throw new ForensicFailure([`unknown argument: ${a}`, USAGE]);
        if (out.has(a)) throw new ForensicFailure([`duplicate argument: ${a}`, USAGE]);
        if (valued.has(a)) {
            const v = argv[i + 1];
            if (v === undefined || v.startsWith('--')) throw new ForensicFailure([`${a} needs a value`, USAGE]);
            out.set(a, v);
            i++;
        } else out.set(a, true);
    }
    return out;
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2));
    if (args.has('--self-test')) {
        if (args.size !== 1) throw new ForensicFailure(['--self-test takes no other arguments', USAGE]);
        return selfTest();
    }
    const source = args.get('--source');
    const out = args.get('--out');
    const sha = args.get('--test-literals-sha');
    if (typeof source !== 'string' || typeof out !== 'string' || typeof sha !== 'string') {
        throw new ForensicFailure(['--source, --out and --test-literals-sha are all required', USAGE]);
    }
    const log = (l: string): void => console.log(l);
    const r = runForensic({ source, out, literals: gitLiteralInput(sha), log });
    printDigest(r, log);
    console.log(r.exitCode === 0 ? 'FORENSIC OK' : 'FORENSIC CHECK FAILED');
    return r.exitCode;
}

main().then(
    (code) => {
        process.exitCode = code;
    },
    (e: unknown) => {
        if (e instanceof ForensicFailure) {
            for (const r of e.reasons) console.error(`forensic-db: FAIL: ${r}`);
            process.exitCode = 1;
        } else {
            console.error(`forensic-db: CRASH: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
            process.exitCode = 2;
        }
    },
);
