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
