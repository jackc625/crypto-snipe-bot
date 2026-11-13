// test/unit/rails/dbTripwireSrc.test.ts
// Phase 22 plan 22-09 Task 1 — SAFE-02 src-layer DB tripwire (AC-14, D-01) and repo-root
// anchoring at the db.ts boundary (AC-25).
//
// Safety order (P3): beforeAll proves, on a temp FAKE root, that BOTH layers are live (the src
// tripwire through assertNotProdDbUnderVitest, the setup tripwire through a refused open). The
// real-root cases then point DB_PATH at the live folder and expect a refused import: the src
// tripwire throws before any better-sqlite3 call, so nothing is opened, read or written. If the
// src tripwire were removed, the setup layer still stops the open (RED proof 22-09-1).

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = req('../../rails/core.cjs') as {
    railsStatus(): { installed: boolean; repoRoot: string; dbWrapperInstalled: boolean };
    addProtectedRoot(dir: string): string;
};

const REPO = core.railsStatus().repoRoot;
const IS_WIN = process.platform === 'win32';
const SAVED_DB_PATH = process.env.DB_PATH;
// data/ is gitignored, so a fresh checkout (CI) has no folder at all. What must hold is that this
// file does not change that: an existing folder is not removed, and a missing one is not created.
const DATA_EXISTED_AT_START = fs.existsSync(path.join(REPO, 'data'));

function restoreEnv(): void {
    if (SAVED_DB_PATH === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = SAVED_DB_PATH;
}

function codeOf(fn: () => unknown): string {
    try {
        fn();
    } catch (e) {
        return String((e as { code?: unknown }).code ?? (e as Error).message);
    }
    return 'NO-THROW';
}

let live = false;
let fake = '';

function requireLive(): void {
    if (!live) throw new Error('fake-root liveness did not pass: this real-root case refuses to run');
}

beforeAll(async () => {
    expect(core.railsStatus().installed).toBe(true);
    expect(core.railsStatus().dbWrapperInstalled).toBe(true);

    fake = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-dbtrip-src-'));
    const fakeData = path.join(fake, 'data');
    fs.mkdirSync(fakeData);

    // Src-layer liveness on the fake root (needs no protected-root registration).
    const { assertNotProdDbUnderVitest } = await import('../../../src/utils/dbPath');
    expect(codeOf(() => assertNotProdDbUnderVitest(path.join(fakeData, 'bot.db'), fake))).toBe('RAIL_DB_TRIPWIRE_SRC');
    expect(codeOf(() => assertNotProdDbUnderVitest(path.join(fake, 'elsewhere', 'bot.db'), fake))).toBe('NO-THROW');

    // Setup-layer liveness on the fake root: if the src layer ever fails, this one still stops
    // the open, so the real-root cases below can never reach the live DB.
    core.addProtectedRoot(fake);
    expect(codeOf(() => new Database(path.join(fakeData, 'bot.db')))).toBe('RAIL_DB_TRIPWIRE');
    expect(fs.readdirSync(fakeData)).toEqual([]);

    live = true;
});

afterAll(() => {
    // The fake root stays a protected root for the life of this worker, so its temp folder is
    // left in the OS temp directory (same as dbTripwireSetup.test.ts).
    expect(fs.existsSync(path.join(REPO, 'data'))).toBe(DATA_EXISTED_AT_START);
});

afterEach(() => {
    restoreEnv();
    vi.resetModules();
});

async function importDbExpectRefused(dbPath: string): Promise<void> {
    requireLive();
    process.env.DB_PATH = dbPath;
    vi.resetModules();
    await expect(import('../../../src/utils/db')).rejects.toMatchObject({ code: 'RAIL_DB_TRIPWIRE_SRC' });
}

describe('src tripwire on the live data folder (fires before the setup layer)', () => {
    // closes-finding: AUD-RAIL-002 (rail test, RED proof row 10 of red-proofs/INDEX.md; re-run by 23-14 as 23-14-5-db-tripwire-src.txt)
    // closes-finding: AUD-TESTU-001 (rail test for its live-DB reach, RED proof row 10 of red-proofs/INDEX.md; re-run by 23-14 as 23-14-5-db-tripwire-src.txt)
    it('DB_PATH=./data/bot.db', async () => {
        await importDbExpectRefused('./data/bot.db');
    });

    it('the absolute <repo>/data/bot.db', async () => {
        await importDbExpectRefused(path.join(REPO, 'data', 'bot.db'));
    });

    it('an upper-cased variant (win32 only; the plain path elsewhere)', async () => {
        const variant = IS_WIN ? path.join(REPO, 'DATA', 'BOT.DB').toUpperCase() : path.join(REPO, 'data', 'bot.db');
        await importDbExpectRefused(variant);
    });

    it('<repo>/data/bot.db-wal', async () => {
        await importDbExpectRefused(path.join(REPO, 'data', 'bot.db-wal'));
    });
});

describe('unset or empty DB_PATH under Vitest', () => {
    async function importAndCheckTemp(): Promise<void> {
        requireLive();
        vi.resetModules();
        const mod = await import('../../../src/utils/db');
        try {
            const p = mod.getDbFilePath();
            const tmp = fs.realpathSync.native(os.tmpdir()).toLowerCase();
            expect(fs.realpathSync.native(path.dirname(p)).toLowerCase().startsWith(tmp)).toBe(true);
            expect(path.basename(path.dirname(p))).toBe('crypto-snipe-bot-test-db');
        } finally {
            const p = mod.getDbFilePath();
            mod.closeDb();
            for (const suffix of ['', '-wal', '-shm']) fs.rmSync(p + suffix, { force: true });
        }
    }

    it("DB_PATH='' opens a per-worker temp file", async () => {
        process.env.DB_PATH = '';
        await importAndCheckTemp();
    });

    it('DB_PATH unset opens a per-worker temp file', async () => {
        delete process.env.DB_PATH;
        await importAndCheckTemp();
    });
});

describe('a data folder that is a link', () => {
    it('refuses a target reached through a junction or symlink at <repo>/data (review WR-05)', async () => {
        const { assertNotProdDbUnderVitest } = await import('../../../src/utils/dbPath');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-dbtrip-link-'));
        const repo = path.join(root, 'repo');
        const linked = path.join(root, 'elsewhere');
        fs.mkdirSync(repo);
        fs.mkdirSync(linked);
        const link = path.join(repo, 'data');
        fs.symlinkSync(linked, link, IS_WIN ? 'junction' : 'dir');
        try {
            expect(codeOf(() => assertNotProdDbUnderVitest(path.join(linked, 'bot.db'), repo))).toBe('RAIL_DB_TRIPWIRE_SRC');
            expect(codeOf(() => assertNotProdDbUnderVitest(path.join(link, 'bot.db'), repo))).toBe('RAIL_DB_TRIPWIRE_SRC');
            expect(codeOf(() => assertNotProdDbUnderVitest(path.join(root, 'unrelated.db'), repo))).toBe('NO-THROW');
        } finally {
            fs.unlinkSync(link);
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('path anchoring', () => {
    it('a relative DB_PATH resolves against the repo root, not the working directory', async () => {
        const { resolveDbPath } = await import('../../../src/utils/dbPath');
        expect(resolveDbPath('./data/bot.db', REPO, { vitest: false })).toBe(path.join(REPO, 'data', 'bot.db'));
    });
});
