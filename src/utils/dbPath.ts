// src/utils/dbPath.ts
//
// Phase 22 plan 22-09 (SAFE-05 + the SAFE-02 src layer): where the bot's SQLite file lives and
// whether it may be opened. db.ts and scripts/db-init.ts share these functions so both resolve
// the path the same way. This file holds no module-level state and opens nothing at import.
//
// Rails are env-independent where it matters: no env var or flag relaxes any guard here.

import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

const IS_WIN = process.platform === 'win32';
const MEMORY_DB = ':memory:';

export interface ResolveDbPathOptions {
    vitest: boolean;
}

/**
 * Resolve the raw DB_PATH value to the absolute path the DB layer uses.
 *
 * - Under Vitest an unset or empty value gets a fresh per-worker temp file, never the repo
 *   default (E10): a test can never reach the live data folder through an empty sentinel.
 * - Outside Vitest an unset value is <repoRoot>/data/bot.db.
 * - A relative value is resolved against the repo root, never the current directory (AC-25).
 * - An absolute value is returned normalised.
 */
export function resolveDbPath(raw: string | undefined, repoRoot: string, opts: ResolveDbPathOptions): string {
    if (raw === undefined || raw === '') {
        if (opts.vitest) {
            const dir = path.join(os.tmpdir(), 'crypto-snipe-bot-test-db');
            fs.mkdirSync(dir, { recursive: true });
            const unique = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
            return path.join(dir, `${unique}.db`);
        }
        return path.join(repoRoot, 'data', 'bot.db');
    }
    if (raw === MEMORY_DB) return raw;
    return path.resolve(repoRoot, raw);
}

/** Win32: map "\\?\" prefixes, trailing dots/spaces and ":stream" names to what the OS opens. */
function normalizeWinForm(p: string): string {
    if (!IS_WIN) return p;
    let s = p;
    if (/^\\\\[?.]\\UNC\\/i.test(s)) s = '\\\\' + s.slice(8);
    else if (/^\\\\[?.]\\[A-Za-z]:/.test(s)) s = s.slice(4);
    const root = path.parse(s).root;
    const segments = s
        .slice(root.length)
        .split(/[\\/]+/)
        .map((x) => x.replace(/:.*$/, '').replace(/[. ]+$/, ''))
        .filter((x) => x !== '');
    return root + segments.join('\\');
}

/**
 * The real path of the nearest existing ancestor plus the remainder. Never opens the file, and
 * tolerates any path form (a rail block or a missing segment just moves one level up).
 */
export function canonicalDbPath(p: string): string {
    if (p === MEMORY_DB) return p;
    const abs = path.resolve(normalizeWinForm(p));
    const tail: string[] = [];
    let cur = abs;
    for (;;) {
        try {
            return path.join(normalizeWinForm(fs.realpathSync.native(cur)), ...tail);
        } catch {
            const parent = path.dirname(cur);
            if (parent === cur) return abs;
            tail.unshift(path.basename(cur));
            cur = parent;
        }
    }
}

function comparisonForm(p: string): string {
    const s = normalizeWinForm(p).replace(/[\\/]+$/, '');
    return IS_WIN ? s.toLowerCase() : s;
}

function refusal(code: string, message: string): Error {
    const e = new Error(message) as Error & { code: string };
    e.code = code;
    return e;
}

/**
 * Under Vitest, refuse any path canonically inside <repoRoot>/data/ (SAFE-02, src layer; every
 * spelling of bot.db, -wal, -shm and -journal lands inside the folder).
 */
export function assertNotProdDbUnderVitest(p: string, repoRoot: string): void {
    if (p === MEMORY_DB) return;
    const dataDir = comparisonForm(path.join(canonicalDbPath(repoRoot), 'data'));
    const target = comparisonForm(canonicalDbPath(p));
    if (target === dataDir || target.startsWith(dataDir + path.sep)) {
        throw refusal(
            'RAIL_DB_TRIPWIRE_SRC',
            `RAIL_DB_TRIPWIRE_SRC: refused to open ${path.resolve(p)} under Vitest: this guard protects the live bot DB (SAFE-02, src layer)`,
        );
    }
}

// ---------------------------------------------------------------------------
// Read-only probe and the guarded open (SAFE-05: AC-24, AC-26, D-08)
// ---------------------------------------------------------------------------

export interface DbIdentity {
    dev: bigint;
    ino: bigint;
}

export interface DbProbe {
    exists: boolean;
    size: number;
    userVersion: number | null;
    schemaObjectCount: number | null;
    identity: DbIdentity | null;
}

export interface OpenableCheckOptions {
    vitest: boolean;
    current: number;
}

export interface OpenGuardedDbOptions extends OpenableCheckOptions {
    /**
     * Fixture-only test hook: runs after the probe and before the read-write open, so a test
     * can swap or delete the file in that window. Production code never passes it, and no env
     * var or flag can set it.
     */
    raceHookForTests?: () => void;
}

interface SchemaFacts {
    userVersion: number;
    schemaObjectCount: number;
}

function readSchemaFacts(p: string): SchemaFacts {
    const db = new Database(p, { readonly: true, fileMustExist: true, timeout: 5000 });
    try {
        return {
            userVersion: db.pragma('user_version', { simple: true }) as number,
            schemaObjectCount: (db.prepare('SELECT count(*) AS c FROM sqlite_master').get() as { c: number }).c,
        };
    } finally {
        db.close();
    }
}

/**
 * A read-only open of a WAL-mode file still creates or rewrites its -shm and -wal companions
 * beside it (measured, 22-09). The probe must not, so WAL files are probed through a private
 * copy of the main file and its -wal in a throwaway temp folder. SQLite rebuilds the -shm
 * there; the real files are only read.
 */
function isWalMode(p: string): boolean {
    if (fs.existsSync(`${p}-wal`)) return true;
    const header = Buffer.alloc(20);
    const fd = fs.openSync(p, 'r');
    try {
        fs.readSync(fd, header, 0, 20, 0);
    } finally {
        fs.closeSync(fd);
    }
    return header[18] === 2 && header[19] === 2;
}

function readSchemaFactsNoTouch(p: string): SchemaFacts {
    if (!isWalMode(p)) return readSchemaFacts(p); // rollback-journal mode: a read-only open creates nothing

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-db-probe-'));
    try {
        const copy = path.join(dir, 'probe.db');
        fs.copyFileSync(p, copy);
        if (fs.existsSync(`${p}-wal`)) fs.copyFileSync(`${p}-wal`, `${copy}-wal`);
        return readSchemaFacts(copy);
    } catch (err) {
        // A copy taken while a live writer checkpoints can be torn. With -wal and -shm both
        // present the direct read-only open creates nothing new, and a live writer rewrites
        // -shm anyway; otherwise fail closed rather than create companions beside the file.
        if (fs.existsSync(`${p}-wal`) && fs.existsSync(`${p}-shm`)) return readSchemaFacts(p);
        throw err;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * Metadata only for a missing or 0-byte file (no SQLite call, so nothing can be created);
 * otherwise read user_version and the schema object count without touching the file.
 */
export function probeExistingDb(p: string): DbProbe {
    let st: fs.BigIntStats;
    try {
        st = fs.statSync(p, { bigint: true });
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return { exists: false, size: 0, userVersion: null, schemaObjectCount: null, identity: null };
        }
        throw err;
    }
    const size = Number(st.size);
    const identity = { dev: st.dev, ino: st.ino };
    if (size === 0) return { exists: true, size, userVersion: null, schemaObjectCount: null, identity };
    const facts = readSchemaFactsNoTouch(p);
    return { exists: true, size, userVersion: facts.userVersion, schemaObjectCount: facts.schemaObjectCount, identity };
}

/** Refuse a DB the bot must not open; every refusal names the absolute path. */
export function assertDbOpenable(p: string, probe: DbProbe, opts: OpenableCheckOptions): void {
    const abs = path.resolve(p);
    const initHint = 'first-time creation is only through: npm run db:init';
    if (!opts.vitest) {
        if (!probe.exists) {
            throw refusal('DB_REFUSED_MISSING', `DB_REFUSED_MISSING: no database at ${abs}; refusing to create one at boot (${initHint})`);
        }
        if (probe.size === 0) {
            throw refusal('DB_REFUSED_EMPTY', `DB_REFUSED_EMPTY: database at ${abs} is 0 bytes; refusing to create a schema at boot (${initHint})`);
        }
        if (probe.userVersion === 0) {
            const held = (probe.schemaObjectCount ?? 0) > 0 ? `, and it holds ${probe.schemaObjectCount} schema objects so it must not be replaced` : '';
            throw refusal('DB_REFUSED_UNINITIALISED', `DB_REFUSED_UNINITIALISED: database at ${abs} has user_version 0${held} (${initHint})`);
        }
    }
    if (probe.userVersion !== null && probe.userVersion > opts.current) {
        throw refusal('DB_REFUSED_NEWER_SCHEMA', `DB_REFUSED_NEWER_SCHEMA: database at ${abs} has schema version ${probe.userVersion}, this build supports up to ${opts.current}; refusing to open it`);
    }
}

/**
 * Probe, refuse, then open read-write, without running any pragma or write. Outside Vitest the
 * checks are held at the write boundary: fileMustExist never creates a file that vanished after
 * the probe, the file must still be the same one the probe saw (dev+ino), and user_version is
 * re-read through the write handle before the caller can write anything.
 */
export function openGuardedDb(p: string, opts: OpenGuardedDbOptions): Database.Database {
    const probe = p === MEMORY_DB ? null : probeExistingDb(p);
    if (probe) assertDbOpenable(p, probe, opts);
    opts.raceHookForTests?.();
    if (opts.vitest) return new Database(p);

    const abs = path.resolve(p);
    let db: Database.Database;
    try {
        db = new Database(p, { fileMustExist: true });
    } catch (err) {
        if (!fs.existsSync(p)) {
            throw refusal('DB_REFUSED_MISSING', `DB_REFUSED_MISSING: no database at ${abs}; it vanished before the write open and is not being created (first-time creation is only through: npm run db:init)`);
        }
        throw err;
    }
    let handedOver = false;
    try {
        const after = fs.statSync(p, { bigint: true });
        if (!probe?.identity || after.dev !== probe.identity.dev || after.ino !== probe.identity.ino) {
            throw refusal('DB_REFUSED_REPLACED', `DB_REFUSED_REPLACED: database at ${abs} changed identity between the version probe and the write open; refusing to open it`);
        }
        const version = db.pragma('user_version', { simple: true }) as number;
        if (version > opts.current) {
            throw refusal('DB_REFUSED_NEWER_SCHEMA', `DB_REFUSED_NEWER_SCHEMA: database at ${abs} has schema version ${version}, this build supports up to ${opts.current}; refusing to open it`);
        }
        if (version === 0) {
            throw refusal('DB_REFUSED_UNINITIALISED', `DB_REFUSED_UNINITIALISED: database at ${abs} has user_version 0 at the write open (first-time creation is only through: npm run db:init)`);
        }
        handedOver = true;
        return db;
    } finally {
        if (!handedOver) db.close();
    }
}
