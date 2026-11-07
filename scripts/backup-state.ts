// scripts/backup-state.ts
//
// Phase 22 / Plan 22-01 / SAFE-01 — raw-byte backup of the irreplaceable state:
// every file under `ignition/deployments/` and `data/`, plus the repo-root
// `.bot-state.json.bak`. The copy lands in a dated folder OUTSIDE the repo
// under a sorted SHA-256 manifest, and one dated `.tar.gz` archive is built
// for the off-machine copy (plan 22-03 uploads it).
//
// Modes:
//   --self-check
//       Builds throwaway fixture trees under os.tmpdir() and runs the REAL
//       build/verify functions against them: missing bot.db / chain-1 journal,
//       torn snapshot, no-overwrite re-run, flipped byte, forbidden
//       destination, link inside the tree, missing derived artifact, copy
//       omission, missing git-tracked file, absent -wal/-shm. Never touches
//       real state. One PASS/FAIL line per case.
//   --source <repo root> --dest <backup root>
//       Real build. <dest> must already exist and must be outside the repo
//       and outside C:\Users\jackc\OneDrive (D-09). Writes
//       <dest>/<YYYY-MM-DD>[-N]/ (MANIFEST.json, SHA256SUMS, the copies) and
//       <dest>/crypto-snipe-bot-state-<YYYY-MM-DD>[-N].tar.gz + .sha256.
//   --verify <folder>
//       Re-hashes every MANIFEST entry; fails on any mismatch, missing PRESENT
//       file, extra file, link, or SHA256SUMS drift.
//   --verify <archive.tar.gz> [--expected-sha <hex>]
//       Checks the archive SHA-256 against --expected-sha (or the sibling
//       <archive>.sha256), extracts into a fresh os.tmpdir() folder, verifies
//       every MANIFEST entry there, then deletes the temp folder.
//   Flags accept both `--flag value` and `--flag=value`.
//
// Usage (Node 22.16.0 only, D-21):
//   N22=/c/Users/jackc/AppData/Local/nvm/v22.16.0
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js scripts/backup-state.ts --self-check
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js scripts/backup-state.ts \
//       --source . --dest /c/Users/jackc/crypto-snipe-bot-backups
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js scripts/backup-state.ts --verify <folder|archive>
//   (npm script: `npm run backup:state -- <args>`, which must also run on Node 22)
//
// Exit codes:
//   0  ok (build verified / verify passed / every self-check case behaved)
//   1  check failed or bad input (refused destination, missing required file,
//      link in tree, torn snapshot, hash mismatch, wrong Node ABI, bad args)
//   2  crash (unexpected exception)
//
// Inventory rules (review concern L38@e2e59f6):
//   - The walk uses fs.lstatSync and NEVER follows links: any symlink,
//     junction or other reparse point inside the walked trees FAILS the backup
//     and is named.
//   - The expected set is the union of the walk, every `git ls-files` path
//     under ignition/deployments, and the mandatory per-deployment set derived
//     from the files themselves: for each ignition/deployments/<chain>/ folder,
//     journal.jsonl, deployed_addresses.json, at least one build-info/*.json,
//     and for every future id key in deployed_addresses.json the Ignition
//     artifact pair artifacts/<futureId>.json + artifacts/<futureId>.dbg.json
//     (naming observed on disk 2026-11-06). Plus data/bot.db, the chain-1
//     journal and .bot-state.json.bak (required) and data/bot.db-wal /
//     data/bot.db-shm (listed PRESENT or ABSENT — the only paths allowed to be
//     ABSENT).
//   - After copying, the staging folder is walked the same way and its
//     inventory must equal the source inventory exactly.
//
// Data safety:
//   - Live data/ files are hashed and copied as RAW BYTES with plain fs reads.
//     Nothing here opens them through SQLite (no better-sqlite3 import at all),
//     so no WAL checkpoint, -shm rewrite or journal write can happen.
//   - Every source file is hashed before and after the copy; any difference is
//     a torn snapshot and FAILS.
//   - The build happens in <dest>/.staging-<date>-<pid>/ and only becomes a
//     dated folder after its manifest verifies. An existing dated folder or
//     archive is never overwritten or merged into; the next free -N suffix is
//     used instead.
//   - No environment file is loaded, no secret is read, and nothing from the
//     bot's own source tree is imported (import-time side effects there open
//     the live DB). An entry whose file name starts with `.env` FAILS (P1).
//   - The self-check test hooks (torn-snapshot write, copy omission) are an
//     internal function parameter reachable only from the self-check code path,
//     never from argv or env.
//
// Zero new npm deps — Node built-ins only (fs, path, crypto, os,
// child_process for `git` and GNU `tar`).

if (process.versions.modules !== '127') {
    console.error(
        `backup-state: requires Node 22.16.0 (ABI 127); this is Node ${process.version} ` +
            `(ABI ${process.versions.modules}). Run it with ` +
            'C:\\Users\\jackc\\AppData\\Local\\nvm\\v22.16.0\\node.exe (D-21).',
    );
    process.exit(1);
}

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import * as cp from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntryStatus = 'PRESENT' | 'ABSENT';

interface ManifestEntry {
    path: string;
    status: EntryStatus;
    size: number | null;
    sha256: string | null;
    mtime: string | null;
}

interface InventoryCheck {
    walked: number;
    git_tracked_ignition: string[];
    mandatory_derived: string[];
    allowed_absent: string[];
    missing: string[];
    links: string[];
}

interface ManifestMeta {
    tool: string;
    created_at: string;
    source_root: string;
    phase_start_sha: string;
    head_at_backup: string;
    node: string;
    node_abi: string;
    script_sha256: string;
    inventory_check: InventoryCheck;
    torn_check: { files_compared: number; equal: boolean };
}

interface Manifest {
    meta: ManifestMeta;
    entries: ManifestEntry[];
}

/** Self-check-only hooks. Never wired to argv or env. */
interface SelfCheckHooks {
    /** Runs after every file is copied and before the after-hash (torn-snapshot simulation). */
    betweenHashes?: () => void;
    /** Relative POSIX path whose copy is silently skipped (copy-omission simulation). */
    skipCopyOf?: string;
}

interface BuildOptions {
    source: string;
    dest: string;
    now?: Date;
    hooks?: SelfCheckHooks;
    log?: (line: string) => void;
}

interface BuildResult {
    datedFolder: string;
    archivePath: string;
    archiveSha256: string;
    manifestSha256: string;
    entryCount: number;
    presentCount: number;
    absentCount: number;
    inventory: InventoryCheck;
    dbSet: ManifestEntry[];
}

interface FolderVerify {
    errors: string[];
    manifestSha256: string;
    entryCount: number;
    presentCount: number;
    absentCount: number;
}

interface ArchiveVerify {
    errors: string[];
    archiveSha256: string;
    inner?: FolderVerify;
}

class BackupFailure extends Error {
    readonly reasons: string[];
    constructor(reasons: string[]) {
        super(reasons.join('\n'));
        this.name = 'BackupFailure';
        this.reasons = reasons;
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOL = 'scripts/backup-state.ts';
const IGNITION_ROOT = 'ignition/deployments';
const DATA_ROOT = 'data';
const BOT_STATE_BAK = '.bot-state.json.bak';
const DB_FILE = 'data/bot.db';
const DB_SET = ['data/bot.db', 'data/bot.db-wal', 'data/bot.db-shm'];
const ALLOWED_ABSENT = ['data/bot.db-wal', 'data/bot.db-shm'];
const CHAIN1_JOURNAL = 'ignition/deployments/chain-1/journal.jsonl';
const FIXED_REQUIRED = [DB_FILE, CHAIN1_JOURNAL, BOT_STATE_BAK];
const MANIFEST_NAME = 'MANIFEST.json';
const SUMS_NAME = 'SHA256SUMS';
const ARCHIVE_PREFIX = 'crypto-snipe-bot-state-';
const PHASE_START_REL = '.planning/baselines/phase-start.json';
const SHA_RE = /^[0-9a-f]{64}$/;
const GIT_SHA_RE = /^[0-9a-f]{40}$/;
const CASE_INSENSITIVE = process.platform === 'win32';
const CHUNK = 1 << 20;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function isErrno(e: unknown): e is NodeJS.ErrnoException {
    return typeof e === 'object' && e !== null && 'code' in e;
}

function cmpKey(p: string): string {
    const r = path.resolve(p).replace(/[\\/]+$/, '');
    return CASE_INSENSITIVE ? r.toLowerCase() : r;
}

function samePath(a: string, b: string): boolean {
    return cmpKey(a) === cmpKey(b);
}

function isInside(child: string, parent: string): boolean {
    const c = cmpKey(child);
    const p = cmpKey(parent);
    return c === p || c.startsWith(p + path.sep);
}

function lexists(abs: string): boolean {
    try {
        fs.lstatSync(abs);
        return true;
    } catch (e) {
        if (isErrno(e) && e.code === 'ENOENT') return false;
        throw e;
    }
}

/** Resolve through the nearest existing ancestor so a link above a not-yet-created folder is seen. */
function resolveThroughExisting(p: string): string {
    let cur = path.resolve(p);
    const tail: string[] = [];
    for (;;) {
        if (lexists(cur)) break;
        const parent = path.dirname(cur);
        if (parent === cur) return path.resolve(p);
        tail.unshift(path.basename(cur));
        cur = parent;
    }
    return path.join(fs.realpathSync.native(cur), ...tail);
}

function toAbs(base: string, rel: string): string {
    return rel ? path.join(base, ...rel.split('/')) : base;
}

function joinRel(a: string, b: string): string {
    return a ? `${a}/${b}` : b;
}

/** Forward-slash form for GNU tar (MSYS) arguments. */
function fwd(p: string): string {
    return p.split(path.sep).join('/');
}

function safeName(name: string): boolean {
    return name !== '.' && name !== '..' && !/[\u0000-\u001f\u007f\\]/.test(name);
}

function safeRelPath(rel: string): boolean {
    if (!rel || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return false;
    return rel.split('/').every((seg) => seg.length > 0 && safeName(seg));
}

function localDate(d: Date): string {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Hashing and raw-byte copy
// ---------------------------------------------------------------------------

function sha256Buffer(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function hashFile(abs: string): string {
    const h = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(CHUNK);
    const fd = fs.openSync(abs, 'r');
    try {
        for (;;) {
            const n = fs.readSync(fd, buf, 0, buf.length, null);
            if (n === 0) break;
            h.update(buf.subarray(0, n));
        }
    } finally {
        fs.closeSync(fd);
    }
    return h.digest('hex');
}

/** Raw-byte copy into a NEW file ('wx': never overwrites); returns the hash of the bytes written. */
function copyWithHash(fromAbs: string, toAbsPath: string, st: fs.Stats): { sha256: string; size: number } {
    fs.mkdirSync(path.dirname(toAbsPath), { recursive: true });
    const h = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(CHUNK);
    let size = 0;
    const inFd = fs.openSync(fromAbs, 'r');
    let outFd: number | undefined;
    try {
        outFd = fs.openSync(toAbsPath, 'wx');
        for (;;) {
            const n = fs.readSync(inFd, buf, 0, buf.length, null);
            if (n === 0) break;
            h.update(buf.subarray(0, n));
            let off = 0;
            while (off < n) off += fs.writeSync(outFd, buf, off, n - off);
            size += n;
        }
        fs.fsyncSync(outFd);
    } finally {
        fs.closeSync(inFd);
        if (outFd !== undefined) fs.closeSync(outFd);
    }
    fs.utimesSync(toAbsPath, st.atime, st.mtime);
    return { sha256: h.digest('hex'), size };
}

// ---------------------------------------------------------------------------
// lstat walk (links are never followed)
// ---------------------------------------------------------------------------

interface Walk {
    files: Map<string, fs.Stats>;
    links: string[];
    special: string[];
    badNames: string[];
}

function newWalk(): Walk {
    return { files: new Map(), links: [], special: [], badNames: [] };
}

function visit(abs: string, rel: string, st: fs.Stats, out: Walk): void {
    const label = rel || '.';
    if (st.isSymbolicLink()) {
        out.links.push(label);
        return;
    }
    // Other reparse points (not surfaced as symlinks by lstat) resolve elsewhere.
    if (!samePath(fs.realpathSync.native(abs), abs)) {
        out.links.push(`${label} (reparse point)`);
        return;
    }
    if (st.isDirectory()) {
        for (const name of fs.readdirSync(abs).sort()) {
            const childRel = joinRel(rel, name);
            if (!safeName(name)) {
                out.badNames.push(childRel);
                continue;
            }
            const childAbs = path.join(abs, name);
            visit(childAbs, childRel, fs.lstatSync(childAbs), out);
        }
        return;
    }
    if (st.isFile()) {
        out.files.set(rel, st);
        return;
    }
    out.special.push(label);
}

/** Walk <baseAbs>/<rel> (rel '' = the base itself) into `out`. A missing start is not an error here. */
function walkInto(baseAbs: string, rel: string, out: Walk): void {
    const abs = toAbs(baseAbs, rel);
    let st: fs.Stats;
    try {
        st = fs.lstatSync(abs);
    } catch (e) {
        if (isErrno(e) && e.code === 'ENOENT') return;
        throw e;
    }
    visit(abs, rel, st, out);
}

function walkErrors(w: Walk, where: string): string[] {
    const errs: string[] = [];
    for (const l of w.links) errs.push(`link or reparse point refused (never followed)${where}: ${l}`);
    for (const s of w.special) errs.push(`not a regular file or directory${where}: ${s}`);
    for (const b of w.badNames) errs.push(`unsafe file name (control character or backslash)${where}: ${b}`);
    return errs;
}

// ---------------------------------------------------------------------------
// git and tar
// ---------------------------------------------------------------------------

function git(dir: string, args: string[]): { status: number; stdout: string; stderr: string } {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    const r = cp.spawnSync('git', ['-C', dir, ...args], {
        encoding: 'utf8',
        env,
        windowsHide: true,
        maxBuffer: 64 << 20,
    });
    if (r.error) throw new BackupFailure([`git ${args.join(' ')} could not run: ${r.error.message}`]);
    return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function gitOrFail(dir: string, args: string[], what: string): string {
    const r = git(dir, args);
    if (r.status !== 0) throw new BackupFailure([`${what} failed (git exit ${r.status}): ${r.stderr.trim()}`]);
    return r.stdout;
}

let gnuTarConfirmed = false;

function runTar(args: string[]): string {
    if (!gnuTarConfirmed) {
        const v = cp.spawnSync('tar', ['--version'], { encoding: 'utf8', windowsHide: true });
        if (v.error || v.status !== 0 || !/GNU tar/.test(v.stdout)) {
            const seen = v.error ? v.error.message : v.stdout.split('\n')[0];
            throw new BackupFailure([
                `GNU tar is required (run from Git Bash so its /usr/bin/tar is first on PATH); found: ${seen}`,
            ]);
        }
        gnuTarConfirmed = true;
    }
    const r = cp.spawnSync('tar', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 });
    if (r.error) throw new BackupFailure([`tar ${args.join(' ')} could not run: ${r.error.message}`]);
    if (r.status !== 0) throw new BackupFailure([`tar ${args.join(' ')} exited ${r.status}: ${r.stderr.trim()}`]);
    return r.stdout;
}

// ---------------------------------------------------------------------------
// Safe removal of trees this script created (links are unlinked, never followed)
// ---------------------------------------------------------------------------

function removeOwnTree(abs: string): void {
    let st: fs.Stats;
    try {
        st = fs.lstatSync(abs);
    } catch (e) {
        if (isErrno(e) && e.code === 'ENOENT') return;
        throw e;
    }
    if (st.isSymbolicLink()) {
        fs.unlinkSync(abs);
        return;
    }
    if (st.isDirectory()) {
        for (const name of fs.readdirSync(abs)) removeOwnTree(path.join(abs, name));
        fs.rmdirSync(abs);
        return;
    }
    try {
        fs.chmodSync(abs, 0o666); // git writes read-only object files; Windows refuses to unlink those
    } catch {
        /* best effort */
    }
    fs.unlinkSync(abs);
}

// ---------------------------------------------------------------------------
// Source / destination validation
// ---------------------------------------------------------------------------

function canonicalSource(source: string): string {
    const abs = path.resolve(source);
    let st: fs.Stats;
    try {
        st = fs.statSync(abs);
    } catch {
        throw new BackupFailure([`source ${abs} does not exist`]);
    }
    if (!st.isDirectory()) throw new BackupFailure([`source ${abs} is not a directory`]);
    const canon = fs.realpathSync.native(abs);
    const top = gitOrFail(canon, ['rev-parse', '--show-toplevel'], `git rev-parse --show-toplevel in ${canon}`).trim();
    if (!top || !samePath(fs.realpathSync.native(path.resolve(top)), canon)) {
        throw new BackupFailure([
            `source ${canon} is not the top level of its own git work tree (git reports ${top || '<none>'}); ` +
                'the git-tracked cross-check needs the repo root',
        ]);
    }
    return canon;
}

function oneDriveRoots(): string[] {
    const candidates: string[] = [path.join(os.homedir(), 'OneDrive')];
    if (process.platform === 'win32') candidates.push('C:\\Users\\jackc\\OneDrive');
    for (const k of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
        const v = process.env[k];
        if (v) candidates.push(v);
    }
    const out = new Set<string>();
    for (const c of candidates) {
        out.add(path.resolve(c));
        out.add(resolveThroughExisting(c));
    }
    return [...out];
}

/** Refuses a destination inside the source repo or inside OneDrive (D-09). Runs before ANY write. */
function checkDestination(dest: string, sourceCanon: string): string {
    const resolved = resolveThroughExisting(dest);
    const reasons: string[] = [];
    if (isInside(resolved, sourceCanon)) {
        reasons.push(
            `destination ${resolved} is inside the source repo ${sourceCanon}; backups must live outside the repo (D-09)`,
        );
    }
    for (const od of oneDriveRoots()) {
        if (isInside(resolved, od)) {
            reasons.push(
                `destination ${resolved} is inside ${od}, a OneDrive folder that is local-only on this machine ` +
                    'and never counts as a backup location (D-09)',
            );
            break;
        }
    }
    if (reasons.length > 0) throw new BackupFailure(reasons);
    let st: fs.Stats;
    try {
        st = fs.lstatSync(resolved);
    } catch {
        throw new BackupFailure([`destination ${resolved} does not exist; create it first`]);
    }
    if (!st.isDirectory()) throw new BackupFailure([`destination ${resolved} is not a directory`]);
    return resolved;
}

// ---------------------------------------------------------------------------
// Source inventory
// ---------------------------------------------------------------------------

interface SourceInventory {
    files: Map<string, fs.Stats>;
    expected: string[];
    check: InventoryCheck;
    errors: string[];
}

function sourceInventory(sourceCanon: string): SourceInventory {
    const errors: string[] = [];
    const w = newWalk();
    walkInto(sourceCanon, IGNITION_ROOT, w);
    walkInto(sourceCanon, DATA_ROOT, w);
    walkInto(sourceCanon, BOT_STATE_BAK, w);
    errors.push(...walkErrors(w, ' in source'));

    // (a) every git-tracked path under ignition/deployments
    const tracked = gitOrFail(sourceCanon, ['ls-files', '-z', '--', IGNITION_ROOT], 'git ls-files ignition/deployments')
        .split('\0')
        .filter((p) => p.length > 0)
        .sort();

    // (b) mandatory per-deployment files derived from the deployments themselves
    const mandatory = new Set<string>();
    const deploymentsAbs = toAbs(sourceCanon, IGNITION_ROOT);
    const chains: string[] = [];
    if (lexists(deploymentsAbs) && fs.lstatSync(deploymentsAbs).isDirectory()) {
        for (const name of fs.readdirSync(deploymentsAbs).sort()) {
            const st = fs.lstatSync(path.join(deploymentsAbs, name));
            if (st.isDirectory() && !st.isSymbolicLink()) chains.push(name);
        }
    }
    if (chains.length === 0) errors.push(`no deployment folders found under ${IGNITION_ROOT}/`);
    const walkedPaths = [...w.files.keys()];
    const missingBuildInfo: string[] = [];
    for (const chain of chains) {
        const base = `${IGNITION_ROOT}/${chain}`;
        mandatory.add(`${base}/journal.jsonl`);
        mandatory.add(`${base}/deployed_addresses.json`);
        const buildInfoPrefix = `${base}/build-info/`;
        const hasBuildInfo = walkedPaths.some(
            (p) => p.startsWith(buildInfoPrefix) && p.endsWith('.json') && !p.slice(buildInfoPrefix.length).includes('/'),
        );
        if (!hasBuildInfo) {
            missingBuildInfo.push(`${buildInfoPrefix}*.json`);
            errors.push(`required file missing: ${buildInfoPrefix}*.json (no build-info JSON found)`);
        }
        const addrRel = `${base}/deployed_addresses.json`;
        if (w.files.has(addrRel)) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(fs.readFileSync(toAbs(sourceCanon, addrRel), 'utf8'));
            } catch (e) {
                errors.push(`${addrRel} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
                continue;
            }
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                errors.push(`${addrRel} is not a JSON object of future id -> address`);
                continue;
            }
            for (const futureId of Object.keys(parsed as Record<string, unknown>).sort()) {
                if (!safeName(futureId) || futureId.includes('/')) {
                    errors.push(`${addrRel} names an unsafe future id: ${JSON.stringify(futureId)}`);
                    continue;
                }
                mandatory.add(`${base}/artifacts/${futureId}.json`);
                mandatory.add(`${base}/artifacts/${futureId}.dbg.json`);
            }
        }
    }

    const expectedSet = new Set<string>([...w.files.keys(), ...tracked, ...mandatory, ...FIXED_REQUIRED, ...ALLOWED_ABSENT]);
    const expected = [...expectedSet].sort();
    const missing = expected.filter((p) => !w.files.has(p) && !ALLOWED_ABSENT.includes(p));
    for (const m of missing) errors.push(`required file missing: ${m}`);
    for (const p of expected) {
        if (!safeRelPath(p)) errors.push(`unsafe relative path: ${JSON.stringify(p)}`);
        if (path.posix.basename(p).startsWith('.env')) errors.push(`environment file refused in the backup set (P1): ${p}`);
        if (p === MANIFEST_NAME || p === SUMS_NAME) errors.push(`path collides with the manifest files: ${p}`);
    }

    return {
        files: w.files,
        expected,
        check: {
            walked: w.files.size,
            git_tracked_ignition: tracked,
            mandatory_derived: [...mandatory].sort(),
            allowed_absent: [...ALLOWED_ABSENT],
            missing: [...missing, ...missingBuildInfo],
            links: [...w.links],
        },
        errors,
    };
}

// ---------------------------------------------------------------------------
// Manifest text
// ---------------------------------------------------------------------------

function sumsText(entries: ManifestEntry[]): string {
    return entries
        .filter((e) => e.status === 'PRESENT')
        .map((e) => `${String(e.sha256)}  ${e.path}\n`)
        .join('');
}

// ---------------------------------------------------------------------------
// Verify a backup folder
// ---------------------------------------------------------------------------

function verifyFolder(dirIn: string): FolderVerify {
    const dir = path.resolve(dirIn);
    const errors: string[] = [];
    const result: FolderVerify = { errors, manifestSha256: '', entryCount: 0, presentCount: 0, absentCount: 0 };
    let st: fs.Stats;
    try {
        st = fs.lstatSync(dir);
    } catch {
        errors.push(`backup folder ${dir} does not exist`);
        return result;
    }
    if (!st.isDirectory() || st.isSymbolicLink()) {
        errors.push(`backup folder ${dir} is not a plain directory`);
        return result;
    }
    const manifestAbs = path.join(dir, MANIFEST_NAME);
    let raw: Buffer;
    try {
        raw = fs.readFileSync(manifestAbs);
    } catch {
        errors.push(`${MANIFEST_NAME} missing in ${dir}`);
        return result;
    }
    result.manifestSha256 = sha256Buffer(raw);
    let manifest: Manifest;
    try {
        manifest = JSON.parse(raw.toString('utf8')) as Manifest;
    } catch (e) {
        errors.push(`${MANIFEST_NAME} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
        return result;
    }
    if (typeof manifest !== 'object' || manifest === null || typeof manifest.meta !== 'object' || !Array.isArray(manifest.entries)) {
        errors.push(`${MANIFEST_NAME} does not have the { meta, entries } shape`);
        return result;
    }
    if (!GIT_SHA_RE.test(String(manifest.meta.phase_start_sha))) errors.push('meta.phase_start_sha is not a 40-hex git SHA');
    const entries = manifest.entries;
    result.entryCount = entries.length;
    const present = new Set<string>();
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (typeof e !== 'object' || e === null || typeof e.path !== 'string' || !safeRelPath(e.path)) {
            errors.push(`entry #${i} has an unsafe or missing path`);
            continue;
        }
        if (i > 0 && !(entries[i - 1].path < e.path)) errors.push(`entries not strictly sorted at ${e.path}`);
        if (e.status === 'PRESENT') {
            result.presentCount++;
            present.add(e.path);
            if (typeof e.sha256 !== 'string' || !SHA_RE.test(e.sha256) || typeof e.size !== 'number') {
                errors.push(`PRESENT entry without a valid size/sha256: ${e.path}`);
                continue;
            }
            const abs = toAbs(dir, e.path);
            let fst: fs.Stats;
            try {
                fst = fs.lstatSync(abs);
            } catch {
                errors.push(`PRESENT file missing from the backup: ${e.path}`);
                continue;
            }
            if (!fst.isFile()) {
                errors.push(`PRESENT entry is not a regular file in the backup: ${e.path}`);
                continue;
            }
            if (fst.size !== e.size) errors.push(`size mismatch: ${e.path} (manifest ${e.size}, file ${fst.size})`);
            const h = hashFile(abs);
            if (h !== e.sha256) errors.push(`sha256 mismatch: ${e.path} (manifest ${e.sha256}, file ${h})`);
        } else if (e.status === 'ABSENT') {
            result.absentCount++;
            if (lexists(toAbs(dir, e.path))) errors.push(`ABSENT entry exists in the backup: ${e.path}`);
        } else {
            errors.push(`entry has an invalid status: ${e.path}`);
        }
    }
    // SHA256SUMS must be exactly the manifest's PRESENT entries in the same order.
    let sums: string | undefined;
    try {
        sums = fs.readFileSync(path.join(dir, SUMS_NAME), 'utf8');
    } catch {
        errors.push(`${SUMS_NAME} missing in ${dir}`);
    }
    if (sums !== undefined && sums !== sumsText(entries)) errors.push(`${SUMS_NAME} does not match ${MANIFEST_NAME}`);
    // The folder holds exactly the PRESENT files plus the two manifest files; no links anywhere.
    const w = newWalk();
    walkInto(dir, '', w);
    errors.push(...walkErrors(w, ' in backup'));
    for (const f of w.files.keys()) {
        if (f !== MANIFEST_NAME && f !== SUMS_NAME && !present.has(f)) errors.push(`file not listed in the manifest: ${f}`);
    }
    return result;
}

// ---------------------------------------------------------------------------
// Verify an archive
// ---------------------------------------------------------------------------

function verifyArchive(archiveIn: string, expectedShaIn?: string): ArchiveVerify {
    const abs = path.resolve(archiveIn);
    let st: fs.Stats;
    try {
        st = fs.lstatSync(abs);
    } catch {
        return { errors: [`archive ${abs} does not exist`], archiveSha256: '' };
    }
    if (!st.isFile()) return { errors: [`archive ${abs} is not a regular file`], archiveSha256: '' };
    let expected = expectedShaIn?.toLowerCase();
    let expectedFrom = '--expected-sha';
    if (expected === undefined) {
        const side = `${abs}.sha256`;
        expectedFrom = side;
        let line: string;
        try {
            line = fs.readFileSync(side, 'utf8').split(/\r?\n/)[0];
        } catch {
            return { errors: [`no --expected-sha given and no sibling ${side}`], archiveSha256: '' };
        }
        const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
        if (!m) return { errors: [`${side} is not in sha256sum format`], archiveSha256: '' };
        if (m[2] !== path.basename(abs)) return { errors: [`${side} names ${m[2]}, not ${path.basename(abs)}`], archiveSha256: '' };
        expected = m[1];
    }
    if (!SHA_RE.test(expected)) return { errors: [`expected SHA-256 is not 64 hex characters (from ${expectedFrom})`], archiveSha256: '' };
    const actual = hashFile(abs);
    if (actual !== expected) {
        return { errors: [`archive SHA-256 ${actual} does not match expected ${expected} (from ${expectedFrom})`], archiveSha256: actual };
    }
    // Inspect members before extracting: one top-level folder, relative names, files and dirs only.
    const names = runTar(['--force-local', '-tzf', fwd(abs)])
        .split('\n')
        .map((l) => l.replace(/\r$/, ''))
        .filter((l) => l.length > 0);
    const types = runTar(['--force-local', '-tvzf', fwd(abs)])
        .split('\n')
        .map((l) => l.replace(/\r$/, ''))
        .filter((l) => l.length > 0)
        .map((l) => l[0]);
    const errors: string[] = [];
    if (names.length === 0) errors.push('archive is empty');
    if (types.length !== names.length) errors.push('archive listing is inconsistent');
    if (types.some((t) => t !== '-' && t !== 'd')) errors.push('archive contains a member that is not a plain file or directory');
    const tops = new Set<string>();
    for (const n of names) {
        const clean = n.replace(/\/$/, '');
        if (!safeRelPath(clean)) errors.push(`unsafe archive member name: ${JSON.stringify(n)}`);
        tops.add(clean.split('/')[0]);
    }
    if (tops.size !== 1) errors.push(`archive must hold exactly one top-level folder (found ${tops.size})`);
    if (errors.length > 0) return { errors, archiveSha256: actual };
    const top = [...tops][0];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-state-verify-'));
    try {
        runTar(['--force-local', '-xzf', fwd(abs), '-C', fwd(tmp)]);
        const extractedTop = fs.readdirSync(tmp);
        if (extractedTop.length !== 1 || extractedTop[0] !== top) {
            return { errors: [`extraction produced unexpected top level: ${extractedTop.join(', ')}`], archiveSha256: actual };
        }
        const inner = verifyFolder(path.join(tmp, top));
        return { errors: inner.errors.map((e) => `extracted copy: ${e}`), archiveSha256: actual, inner };
    } finally {
        removeOwnTree(tmp);
    }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function readPhaseStartSha(sourceCanon: string): string {
    const abs = toAbs(sourceCanon, PHASE_START_REL);
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
        throw new BackupFailure([`cannot read ${PHASE_START_REL}: ${e instanceof Error ? e.message : String(e)}`]);
    }
    const sha = (parsed as { phase_start_sha?: unknown } | null)?.phase_start_sha;
    if (typeof sha !== 'string' || !GIT_SHA_RE.test(sha)) {
        throw new BackupFailure([`${PHASE_START_REL} has no 40-hex phase_start_sha`]);
    }
    return sha;
}

function chooseFinalName(destCanon: string, date: string): { folder: string; archive: string } {
    for (let n = 1; n < 1000; n++) {
        const folder = n === 1 ? date : `${date}-${n}`;
        const archive = `${ARCHIVE_PREFIX}${folder}.tar.gz`;
        if (![folder, archive, `${archive}.sha256`].some((x) => lexists(path.join(destCanon, x)))) return { folder, archive };
    }
    throw new BackupFailure([`no free dated folder name for ${date} in ${destCanon}`]);
}

function buildBackup(opts: BuildOptions): BuildResult {
    const log = opts.log ?? ((): void => undefined);
    const hooks = opts.hooks ?? {};
    // 1. Validate source and destination before anything is written.
    const sourceCanon = canonicalSource(opts.source);
    const destCanon = checkDestination(opts.dest, sourceCanon);
    const date = localDate(opts.now ?? new Date());

    // 2. Inventory (lstat walk + git-tracked + derived mandatory set).
    const inv = sourceInventory(sourceCanon);
    if (inv.errors.length > 0) throw new BackupFailure(inv.errors);
    const phaseStartSha = readPhaseStartSha(sourceCanon);
    const head = gitOrFail(sourceCanon, ['rev-parse', 'HEAD'], 'git rev-parse HEAD').trim();
    if (!GIT_SHA_RE.test(head)) throw new BackupFailure([`git rev-parse HEAD returned ${head}`]);
    const presentPaths = inv.expected.filter((p) => inv.files.has(p));
    const absentPaths = inv.expected.filter((p) => !inv.files.has(p));
    log(`inventory: ${presentPaths.length} PRESENT, ${absentPaths.length} ABSENT, ${inv.check.links.length} links`);

    // 3. Before-hash every PRESENT source file (raw bytes).
    const before = new Map<string, string>();
    for (const p of presentPaths) before.set(p, hashFile(toAbs(sourceCanon, p)));

    // 4. Copy into a fresh staging folder.
    const staging = path.join(destCanon, `.staging-${date}-${process.pid}`);
    try {
        fs.mkdirSync(staging);
    } catch (e) {
        throw new BackupFailure([`cannot create staging folder ${staging}: ${e instanceof Error ? e.message : String(e)}`]);
    }
    let renamed = false;
    try {
        const copied = new Map<string, { sha256: string; size: number }>();
        for (const p of presentPaths) {
            if (hooks.skipCopyOf === p) continue;
            const st = inv.files.get(p) as fs.Stats;
            copied.set(p, copyWithHash(toAbs(sourceCanon, p), toAbs(staging, p), st));
        }
        if (hooks.betweenHashes) hooks.betweenHashes();

        // 5. After-hash: the source must be byte-identical to the before-hash (torn snapshot check).
        const errors: string[] = [];
        for (const p of presentPaths) {
            const abs = toAbs(sourceCanon, p);
            if (!lexists(abs)) {
                errors.push(`torn snapshot: ${p} disappeared during the copy`);
                continue;
            }
            const after = hashFile(abs);
            if (after !== before.get(p)) errors.push(`torn snapshot: ${p} changed during the copy (before ${before.get(p)}, after ${after})`);
            const c = copied.get(p);
            if (c && c.sha256 !== before.get(p)) errors.push(`copy mismatch: ${p} (source ${before.get(p)}, copied ${c.sha256})`);
            const st = inv.files.get(p) as fs.Stats;
            if (c && c.size !== st.size) errors.push(`torn snapshot: ${p} size changed during the copy (${st.size} -> ${c.size})`);
        }
        for (const p of absentPaths) {
            if (lexists(toAbs(sourceCanon, p))) errors.push(`torn snapshot: ${p} appeared during the copy`);
        }

        // 6. Staging inventory must equal the source inventory exactly.
        const sw = newWalk();
        walkInto(staging, '', sw);
        errors.push(...walkErrors(sw, ' in staging'));
        const stagingSet = new Set(sw.files.keys());
        for (const p of presentPaths) if (!stagingSet.has(p)) errors.push(`staging inventory differs from source inventory: missing in staging: ${p}`);
        for (const p of stagingSet) if (!before.has(p)) errors.push(`staging inventory differs from source inventory: unexpected in staging: ${p}`);
        if (errors.length > 0) throw new BackupFailure(errors);

        // 7. MANIFEST.json + SHA256SUMS (sorted by POSIX relative path).
        const entries: ManifestEntry[] = inv.expected.map((p) => {
            const st = inv.files.get(p);
            if (!st) return { path: p, status: 'ABSENT', size: null, sha256: null, mtime: null };
            return { path: p, status: 'PRESENT', size: st.size, sha256: before.get(p) as string, mtime: st.mtime.toISOString() };
        });
        const manifest: Manifest = {
            meta: {
                tool: TOOL,
                created_at: new Date().toISOString(),
                source_root: sourceCanon,
                phase_start_sha: phaseStartSha,
                head_at_backup: head,
                node: process.version,
                node_abi: process.versions.modules,
                script_sha256: hashFile(__filename),
                inventory_check: inv.check,
                torn_check: { files_compared: presentPaths.length, equal: true },
            },
            entries,
        };
        fs.writeFileSync(path.join(staging, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
        fs.writeFileSync(path.join(staging, SUMS_NAME), sumsText(entries), { flag: 'wx' });

        // 8. Verify the staging copy; only a verified staging folder becomes a dated folder.
        const sv = verifyFolder(staging);
        if (sv.errors.length > 0) throw new BackupFailure(sv.errors.map((e) => `staging verify: ${e}`));

        // 9. Rename to the next free dated name (never overwrite, never merge).
        const names = chooseFinalName(destCanon, date);
        const datedFolder = path.join(destCanon, names.folder);
        if (lexists(datedFolder)) throw new BackupFailure([`refusing to overwrite existing ${datedFolder}`]);
        fs.renameSync(staging, datedFolder);
        renamed = true;
        const fv = verifyFolder(datedFolder);
        if (fv.errors.length > 0 || fv.manifestSha256 !== sv.manifestSha256) {
            throw new BackupFailure([`dated folder failed re-verification after rename: ${fv.errors.join('; ')}`]);
        }
        log(`verified backup folder: ${datedFolder}`);

        // 10. Archive (GNU tar, relative folder name) + its .sha256, then verify the archive itself.
        const archivePath = path.join(destCanon, names.archive);
        runTar(['--force-local', '--sort=name', '-czf', fwd(archivePath), '-C', fwd(destCanon), names.folder]);
        const archiveSha256 = hashFile(archivePath);
        fs.writeFileSync(`${archivePath}.sha256`, `${archiveSha256}  ${names.archive}\n`, { flag: 'wx' });
        const av = verifyArchive(archivePath);
        if (av.errors.length > 0) {
            removeOwnTree(archivePath);
            removeOwnTree(`${archivePath}.sha256`);
            throw new BackupFailure(av.errors.map((e) => `archive verify: ${e}`));
        }
        return {
            datedFolder,
            archivePath,
            archiveSha256,
            manifestSha256: fv.manifestSha256,
            entryCount: entries.length,
            presentCount: presentPaths.length,
            absentCount: absentPaths.length,
            inventory: inv.check,
            dbSet: entries.filter((e) => DB_SET.includes(e.path)),
        };
    } finally {
        if (!renamed) removeOwnTree(staging); // an unverified staging folder never survives
    }
}

// ---------------------------------------------------------------------------
// Self-check (fixtures under os.tmpdir() only)
// ---------------------------------------------------------------------------

const FIXTURE_FUTURE = 'FixtureModule#Checker';
const FIXTURE_PHASE_SHA = 'f'.repeat(40);
const FIXTURE_NOW = new Date(2026, 0, 2, 12, 0, 0);
const FIXTURE_DATE = localDate(FIXTURE_NOW);
const FIXTURE_TRACKED = [
    '.planning/baselines/phase-start.json',
    'ignition/deployments/chain-1/build-info/aaa.json',
    'ignition/deployments/chain-1/build-info/bbb.json',
    'ignition/deployments/chain-1/deployed_addresses.json',
    'ignition/deployments/chain-11155111/build-info/aaa.json',
    'ignition/deployments/chain-11155111/deployed_addresses.json',
];

interface Fixture {
    source: string;
    dest: string;
    caseRoot: string;
}

function writeRel(base: string, rel: string, data: string | Buffer): void {
    const abs = toAbs(base, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
}

function makeFixture(selfRoot: string, name: string, withWalShm = true): Fixture {
    const caseRoot = path.join(selfRoot, name);
    const source = path.join(caseRoot, 'repo');
    const dest = path.join(caseRoot, 'backups');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    writeRel(source, PHASE_START_REL, `${JSON.stringify({ phase_start_sha: FIXTURE_PHASE_SHA })}\n`);
    for (const chain of ['chain-1', 'chain-11155111']) {
        const b = `${IGNITION_ROOT}/${chain}`;
        writeRel(source, `${b}/journal.jsonl`, '{"type":"DEPLOYMENT_INITIALIZE","chainId":1}\n');
        writeRel(source, `${b}/deployed_addresses.json`, `${JSON.stringify({ [FIXTURE_FUTURE]: '0x000000000000000000000000000000000000dEaD' }, null, 2)}\n`);
        writeRel(source, `${b}/artifacts/${FIXTURE_FUTURE}.json`, '{"contractName":"Checker"}\n');
        writeRel(source, `${b}/artifacts/${FIXTURE_FUTURE}.dbg.json`, '{"buildInfo":"../build-info/aaa.json"}\n');
        writeRel(source, `${b}/build-info/aaa.json`, '{"id":"aaa"}\n');
    }
    writeRel(source, `${IGNITION_ROOT}/chain-1/build-info/bbb.json`, '{"id":"bbb"}\n');
    writeRel(source, DB_FILE, crypto.randomBytes(4096));
    if (withWalShm) {
        writeRel(source, 'data/bot.db-wal', crypto.randomBytes(8192));
        writeRel(source, 'data/bot.db-shm', crypto.randomBytes(1024));
    }
    writeRel(source, 'data/capture.log', 'fixture log line\n');
    writeRel(source, BOT_STATE_BAK, '{"fixture":true}\n');
    const noHooks = path.join(caseRoot, 'no-hooks');
    fs.mkdirSync(noHooks);
    gitOrFail(source, ['init', '-q'], 'fixture git init');
    gitOrFail(source, ['add', '--', ...FIXTURE_TRACKED], 'fixture git add');
    gitOrFail(
        source,
        [
            '-c', 'user.name=backup-state self-check',
            '-c', 'user.email=self-check@invalid',
            '-c', 'commit.gpgsign=false',
            '-c', `core.hooksPath=${fwd(noHooks)}`,
            'commit', '-q', '-m', 'fixture',
        ],
        'fixture git commit',
    );
    return { source, dest, caseRoot };
}

function treeDigest(dir: string): string {
    const w = newWalk();
    walkInto(dir, '', w);
    const lines = [...w.files.keys()].sort().map((f) => `${f}:${hashFile(toAbs(dir, f))}`);
    return sha256Buffer(Buffer.from(lines.join('\n'), 'utf8'));
}

function flipByte(abs: string, offset: number): void {
    const fd = fs.openSync(abs, 'r+');
    try {
        const b = Buffer.alloc(1);
        fs.readSync(fd, b, 0, 1, offset);
        b[0] = b[0] ^ 0xff;
        fs.writeSync(fd, b, 0, 1, offset);
    } finally {
        fs.closeSync(fd);
    }
}

interface CaseResult {
    id: string;
    desc: string;
    pass: boolean;
    detail: string;
}

/** Runs a build that MUST fail with a reason matching `want`, and must leave `dest` empty. */
function expectBuildFailure(opts: BuildOptions, want: (r: string) => boolean, wantDesc: string, destMustStayEmpty = true): { pass: boolean; detail: string } {
    try {
        buildBackup(opts);
        return { pass: false, detail: 'build unexpectedly succeeded' };
    } catch (e) {
        if (!(e instanceof BackupFailure)) {
            return { pass: false, detail: `unexpected crash: ${e instanceof Error ? e.stack ?? e.message : String(e)}` };
        }
        if (!e.reasons.some(want)) return { pass: false, detail: `failed for the wrong reason (wanted ${wantDesc}): ${e.reasons.join(' | ')}` };
        if (destMustStayEmpty && lexists(opts.dest) && fs.readdirSync(opts.dest).length > 0) {
            return { pass: false, detail: `failed correctly but left files in dest: ${fs.readdirSync(opts.dest).join(', ')}` };
        }
        return { pass: true, detail: e.reasons.find(want) ?? '' };
    }
}

function selfCheck(): number {
    const selfRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-state-selfcheck-')));
    const repoOfScript = path.resolve(__dirname, '..');
    if (isInside(selfRoot, repoOfScript) || oneDriveRoots().some((od) => isInside(selfRoot, od))) {
        console.error(`self-check temp root ${selfRoot} is inside the repo or OneDrive; refusing`);
        removeOwnTree(selfRoot);
        return 1;
    }
    console.log(`self-check fixtures under ${selfRoot}`);
    const results: CaseResult[] = [];
    const run = (id: string, desc: string, fn: () => { pass: boolean; detail: string }): void => {
        try {
            const r = fn();
            results.push({ id, desc, pass: r.pass, detail: r.detail });
        } catch (e) {
            results.push({ id, desc, pass: false, detail: `crash: ${e instanceof Error ? e.stack ?? e.message : String(e)}` });
        }
    };
    const base = (f: Fixture, hooks?: SelfCheckHooks): BuildOptions => ({ source: f.source, dest: f.dest, now: FIXTURE_NOW, hooks });

    try {
        run('a', 'complete fixture builds, verifies, sorted MANIFEST.json + SHA256SUMS, archive verifies', () => {
            const f = makeFixture(selfRoot, 'a');
            const r = buildBackup(base(f));
            const problems: string[] = [];
            if (path.basename(r.datedFolder) !== FIXTURE_DATE) problems.push(`folder name ${path.basename(r.datedFolder)}`);
            const m = JSON.parse(fs.readFileSync(path.join(r.datedFolder, MANIFEST_NAME), 'utf8')) as Manifest;
            const ps = m.entries.map((e) => e.path);
            if (!ps.every((p, i) => i === 0 || ps[i - 1] < p)) problems.push('MANIFEST entries not sorted');
            const sumsPaths = fs.readFileSync(path.join(r.datedFolder, SUMS_NAME), 'utf8').trim().split('\n').map((l) => l.slice(66));
            if (!sumsPaths.every((p, i) => i === 0 || sumsPaths[i - 1] < p)) problems.push('SHA256SUMS not sorted');
            if (sumsPaths.length !== 16 || m.entries.length !== 16) problems.push(`expected 16 entries, got manifest ${m.entries.length} / sums ${sumsPaths.length}`);
            if (m.entries.some((e) => e.status !== 'PRESENT')) problems.push('an entry is not PRESENT');
            if (m.meta.phase_start_sha !== FIXTURE_PHASE_SHA) problems.push('meta.phase_start_sha not read from phase-start.json');
            if (m.meta.inventory_check.missing.length || m.meta.inventory_check.links.length) problems.push('inventory_check not clean');
            if (m.meta.inventory_check.git_tracked_ignition.length !== 5) problems.push(`git_tracked_ignition ${m.meta.inventory_check.git_tracked_ignition.length} != 5`);
            const fv = verifyFolder(r.datedFolder);
            if (fv.errors.length) problems.push(`verifyFolder: ${fv.errors.join('; ')}`);
            const av = verifyArchive(r.archivePath);
            if (av.errors.length) problems.push(`verifyArchive: ${av.errors.join('; ')}`);
            const av2 = verifyArchive(r.archivePath, r.archiveSha256);
            if (av2.errors.length) problems.push(`verifyArchive --expected-sha: ${av2.errors.join('; ')}`);
            return { pass: problems.length === 0, detail: problems.join('; ') || `${r.entryCount} entries, archive ${path.basename(r.archivePath)}` };
        });

        run('b', 'fixture with data/bot.db removed FAILS', () => {
            const f = makeFixture(selfRoot, 'b');
            fs.unlinkSync(toAbs(f.source, DB_FILE));
            return expectBuildFailure(base(f), (r) => r === `required file missing: ${DB_FILE}`, 'missing data/bot.db');
        });

        run('c', 'fixture with chain-1 journal.jsonl removed FAILS', () => {
            const f = makeFixture(selfRoot, 'c');
            fs.unlinkSync(toAbs(f.source, CHAIN1_JOURNAL));
            return expectBuildFailure(base(f), (r) => r === `required file missing: ${CHAIN1_JOURNAL}`, 'missing chain-1 journal');
        });

        run('d', 'torn snapshot (bytes appended to bot.db-wal between before- and after-hash) FAILS', () => {
            const f = makeFixture(selfRoot, 'd');
            const wal = toAbs(f.source, 'data/bot.db-wal');
            return expectBuildFailure(
                base(f, { betweenHashes: () => fs.appendFileSync(wal, Buffer.from('torn-write')) }),
                (r) => r.startsWith('torn snapshot: data/bot.db-wal changed'),
                'torn snapshot on data/bot.db-wal',
            );
        });

        run('e', 're-run creates a NEW dated folder (-2) and the first folder and archive are unchanged', () => {
            const f = makeFixture(selfRoot, 'e');
            const r1 = buildBackup(base(f));
            const d1 = treeDigest(r1.datedFolder);
            const a1 = hashFile(r1.archivePath);
            const s1 = fs.readFileSync(`${r1.archivePath}.sha256`, 'utf8');
            const r2 = buildBackup(base(f));
            const problems: string[] = [];
            if (path.basename(r1.datedFolder) !== FIXTURE_DATE) problems.push(`first folder ${path.basename(r1.datedFolder)}`);
            if (path.basename(r2.datedFolder) !== `${FIXTURE_DATE}-2`) problems.push(`second folder ${path.basename(r2.datedFolder)}`);
            if (path.basename(r2.archivePath) !== `${ARCHIVE_PREFIX}${FIXTURE_DATE}-2.tar.gz`) problems.push(`second archive ${path.basename(r2.archivePath)}`);
            if (treeDigest(r1.datedFolder) !== d1) problems.push('first folder bytes changed');
            if (hashFile(r1.archivePath) !== a1) problems.push('first archive bytes changed');
            if (fs.readFileSync(`${r1.archivePath}.sha256`, 'utf8') !== s1) problems.push('first .sha256 changed');
            if (verifyFolder(r2.datedFolder).errors.length) problems.push('second folder does not verify');
            return { pass: problems.length === 0, detail: problems.join('; ') || `${path.basename(r1.datedFolder)} kept, ${path.basename(r2.datedFolder)} created` };
        });

        run('f', 'a flipped byte in a copied file makes --verify FAIL (folder and archive)', () => {
            const f = makeFixture(selfRoot, 'f');
            const r = buildBackup(base(f));
            const problems: string[] = [];
            flipByte(toAbs(r.datedFolder, DB_FILE), 100);
            const fv = verifyFolder(r.datedFolder);
            if (!fv.errors.some((e) => e.startsWith(`sha256 mismatch: ${DB_FILE}`))) problems.push(`folder verify did not flag ${DB_FILE}: ${fv.errors.join('; ')}`);
            const tampered = path.join(f.caseRoot, 'tampered.tar.gz');
            fs.copyFileSync(r.archivePath, tampered);
            flipByte(tampered, Math.floor(fs.statSync(tampered).size / 2));
            const av = verifyArchive(tampered, r.archiveSha256);
            if (!av.errors.some((e) => e.includes('does not match expected'))) problems.push(`archive verify did not flag the flip: ${av.errors.join('; ')}`);
            return { pass: problems.length === 0, detail: problems.join('; ') || `${fv.errors[0]} | ${av.errors[0]}` };
        });

        run('g', 'a destination inside the source repo or inside C:\\Users\\jackc\\OneDrive is refused (D-09)', () => {
            const f = makeFixture(selfRoot, 'g');
            const inRepo = path.join(f.source, 'inner-backups');
            fs.mkdirSync(inRepo);
            const r1 = expectBuildFailure(
                { source: f.source, dest: inRepo, now: FIXTURE_NOW },
                (r) => r.includes('is inside the source repo'),
                'inside-repo refusal',
                false,
            );
            const oneDrive = process.platform === 'win32' ? 'C:\\Users\\jackc\\OneDrive' : path.join(os.homedir(), 'OneDrive');
            const odDest = path.join(oneDrive, `backup-state-selfcheck-never-created-${process.pid}`);
            // Match the refusal text itself: the generic "does not exist" message also contains the OneDrive path.
            const r2 = expectBuildFailure(
                { source: f.source, dest: odDest, now: FIXTURE_NOW },
                (r) => r.includes('a OneDrive folder that is local-only'),
                'OneDrive refusal',
                false,
            );
            const problems: string[] = [];
            if (!r1.pass) problems.push(`in-repo: ${r1.detail}`);
            if (!r2.pass) problems.push(`OneDrive: ${r2.detail}`);
            if (lexists(odDest)) problems.push(`OneDrive test path was created: ${odDest}`);
            if (fs.readdirSync(inRepo).length > 0) problems.push('in-repo destination was written to');
            return { pass: problems.length === 0, detail: problems.join('; ') || 'both refused before any write' };
        });

        run('h', `a ${process.platform === 'win32' ? 'directory junction' : 'symlink'} under ignition/deployments/ FAILS and names the link`, () => {
            const f = makeFixture(selfRoot, 'h');
            const target = path.join(f.caseRoot, 'outside-target');
            fs.mkdirSync(target);
            fs.writeFileSync(path.join(target, 'escaped.json'), '{}\n');
            const linkRel = `${IGNITION_ROOT}/chain-1/linked`;
            fs.symlinkSync(target, toAbs(f.source, linkRel), process.platform === 'win32' ? 'junction' : 'dir');
            return expectBuildFailure(base(f), (r) => r.startsWith('link or reparse point refused') && r.endsWith(linkRel), `link refusal naming ${linkRel}`);
        });

        run('i', 'deployed_addresses.json names a future id whose artifacts/<futureId>.json was removed: FAILS', () => {
            const f = makeFixture(selfRoot, 'i');
            const rel = `${IGNITION_ROOT}/chain-1/artifacts/${FIXTURE_FUTURE}.json`;
            fs.unlinkSync(toAbs(f.source, rel));
            return expectBuildFailure(base(f), (r) => r === `required file missing: ${rel}`, `missing ${rel}`);
        });

        run('j', 'a simulated copy omission (one file skipped) FAILS the source-vs-staging inventory comparison', () => {
            const f = makeFixture(selfRoot, 'j');
            return expectBuildFailure(
                base(f, { skipCopyOf: 'data/capture.log' }),
                (r) => r === 'staging inventory differs from source inventory: missing in staging: data/capture.log',
                'staging inventory mismatch on data/capture.log',
            );
        });

        run('k', 'a git-tracked Ignition file deleted from disk (still in the index) FAILS', () => {
            const f = makeFixture(selfRoot, 'k');
            const rel = `${IGNITION_ROOT}/chain-1/build-info/bbb.json`;
            fs.unlinkSync(toAbs(f.source, rel));
            return expectBuildFailure(base(f), (r) => r === `required file missing: ${rel}`, `missing tracked ${rel}`);
        });

        run('l', 'absent bot.db-wal / bot.db-shm are listed ABSENT and the build still verifies', () => {
            const f = makeFixture(selfRoot, 'l', false);
            const r = buildBackup(base(f));
            const m = JSON.parse(fs.readFileSync(path.join(r.datedFolder, MANIFEST_NAME), 'utf8')) as Manifest;
            const problems: string[] = [];
            for (const p of ALLOWED_ABSENT) {
                const e = m.entries.find((x) => x.path === p);
                if (!e || e.status !== 'ABSENT') problems.push(`${p} not listed ABSENT`);
            }
            if (r.absentCount !== 2 || r.presentCount !== 14) problems.push(`counts present=${r.presentCount} absent=${r.absentCount}`);
            if (verifyFolder(r.datedFolder).errors.length) problems.push('folder does not verify');
            if (verifyArchive(r.archivePath).errors.length) problems.push('archive does not verify');
            return { pass: problems.length === 0, detail: problems.join('; ') || 'wal/shm ABSENT, 14 PRESENT' };
        });
    } finally {
        removeOwnTree(selfRoot);
    }

    for (const r of results) {
        console.log(`${r.pass ? 'PASS' : 'FAIL'} (${r.id}) ${r.desc}${r.pass ? '' : ` -- ${r.detail}`}`);
    }
    const passed = results.filter((r) => r.pass).length;
    const leftover = lexists(selfRoot);
    if (leftover) console.log(`WARNING: self-check temp root still exists: ${selfRoot}`);
    const ok = passed === results.length && results.length === 12 && !leftover;
    console.log(`SELF-CHECK ${ok ? 'PASSED' : 'FAILED'}: ${passed}/${results.length} cases`);
    return ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const KNOWN_FLAGS = new Set(['--self-check', '--verify', '--expected-sha', '--source', '--dest']);
const VALUE_FLAGS = new Set(['--verify', '--expected-sha', '--source', '--dest']);

const USAGE = [
    'Usage (Node 22.16.0):',
    '  backup-state.ts --self-check',
    '  backup-state.ts --source <repo root> --dest <backup root>',
    '  backup-state.ts --verify <backup folder>',
    '  backup-state.ts --verify <archive.tar.gz> [--expected-sha <hex>]',
].join('\n');

function parseArgs(argv: string[]): Map<string, string | true> {
    const out = new Map<string, string | true>();
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const eq = a.indexOf('=');
        const flag = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
        if (!KNOWN_FLAGS.has(flag)) throw new BackupFailure([`unknown argument: ${a}`, USAGE]);
        if (out.has(flag)) throw new BackupFailure([`duplicate argument: ${flag}`, USAGE]);
        if (VALUE_FLAGS.has(flag)) {
            let value: string | undefined;
            if (flag !== a) value = a.slice(eq + 1);
            else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) value = argv[++i];
            if (!value) throw new BackupFailure([`${flag} needs a value`, USAGE]);
            out.set(flag, value);
        } else {
            if (flag !== a) throw new BackupFailure([`${flag} takes no value`, USAGE]);
            out.set(flag, true);
        }
    }
    return out;
}

function main(): number {
    const args = parseArgs(process.argv.slice(2));
    const get = (k: string): string | undefined => {
        const v = args.get(k);
        return typeof v === 'string' ? v : undefined;
    };

    if (args.has('--self-check')) {
        if (args.size !== 1) throw new BackupFailure(['--self-check takes no other arguments', USAGE]);
        return selfCheck();
    }

    const verifyTarget = get('--verify');
    if (verifyTarget !== undefined) {
        if (args.has('--source') || args.has('--dest')) throw new BackupFailure(['--verify cannot be combined with --source/--dest', USAGE]);
        const abs = path.resolve(verifyTarget);
        let st: fs.Stats;
        try {
            st = fs.lstatSync(abs);
        } catch {
            throw new BackupFailure([`--verify target ${abs} does not exist`]);
        }
        if (st.isDirectory()) {
            if (args.has('--expected-sha')) throw new BackupFailure(['--expected-sha applies to an archive, not a folder']);
            const v = verifyFolder(abs);
            if (v.errors.length > 0) {
                for (const e of v.errors) console.error(`VERIFY FAIL: ${e}`);
                return 1;
            }
            console.log(`VERIFY OK folder ${abs}: ${v.entryCount} entries (${v.presentCount} PRESENT, ${v.absentCount} ABSENT); MANIFEST.json sha256 ${v.manifestSha256}`);
            return 0;
        }
        if (st.isFile() && abs.endsWith('.tar.gz')) {
            const v = verifyArchive(abs, get('--expected-sha'));
            if (v.errors.length > 0) {
                for (const e of v.errors) console.error(`VERIFY FAIL: ${e}`);
                return 1;
            }
            const inner = v.inner as FolderVerify;
            console.log(
                `VERIFY OK archive ${abs}: sha256 ${v.archiveSha256}; extracted ${inner.entryCount} entries ` +
                    `(${inner.presentCount} PRESENT, ${inner.absentCount} ABSENT); MANIFEST.json sha256 ${inner.manifestSha256}`,
            );
            return 0;
        }
        throw new BackupFailure([`--verify target must be a backup folder or a .tar.gz archive: ${abs}`]);
    }

    const source = get('--source');
    const dest = get('--dest');
    if (args.has('--expected-sha')) throw new BackupFailure(['--expected-sha is only valid with --verify <archive>', USAGE]);
    if (!source || !dest) throw new BackupFailure(['--source and --dest are both required for a build', USAGE]);
    const r = buildBackup({ source, dest, log: (l) => console.log(l) });
    console.log(`dated folder:     ${r.datedFolder}`);
    console.log(`archive:          ${r.archivePath}`);
    console.log(`archive sha256:   ${r.archiveSha256}`);
    console.log(`MANIFEST sha256:  ${r.manifestSha256}`);
    console.log(`entries:          ${r.entryCount} (${r.presentCount} PRESENT, ${r.absentCount} ABSENT)`);
    console.log(`inventory check:  walked ${r.inventory.walked}, git-tracked ${r.inventory.git_tracked_ignition.length}, mandatory ${r.inventory.mandatory_derived.length}, missing ${r.inventory.missing.length}, links ${r.inventory.links.length}`);
    for (const e of r.dbSet) {
        console.log(`db set:           ${e.path} ${e.status} size=${String(e.size)} sha256=${String(e.sha256)} mtime=${String(e.mtime)}`);
    }
    console.log('BACKUP OK');
    return 0;
}

try {
    process.exitCode = main();
} catch (e) {
    if (e instanceof BackupFailure) {
        for (const r of e.reasons) console.error(`backup-state: FAIL: ${r}`);
        process.exitCode = 1;
    } else {
        console.error(`backup-state: CRASH: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        process.exitCode = 2;
    }
}
