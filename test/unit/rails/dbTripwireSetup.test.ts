// test/unit/rails/dbTripwireSetup.test.ts
// Phase 22 plan 22-08 Task 2 — SAFE-02 setup-layer DB tripwire (AC-14 / E9) and raw data/
// fs block. Imports only test infrastructure and node/npm modules — nothing from src/ at
// module scope (the AC-14 module-scope import runs in a railed CHILD).
//
// Safety order (P3, T-22-20): beforeAll proves on a temp FAKE protected root that the DB
// tripwire and the data fs block are live (reads and every write form throw, fixture
// unchanged). Only after that liveness passes do the real-root cases run, and every real-root
// case is a refused OPEN or a READ attempt: no write is ever attempted against the real data/.
// Real-root opens also pass { readonly: true, fileMustExist: true } so that even a tripwire
// failure could not create or migrate anything.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { spawnRailedChild } from '../../rails/spawnRailedChild';
import { createTestDb } from '../../helpers/testDb';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = req('../../rails/core.cjs') as {
    railsStatus(): { installed: boolean; repoRoot: string; dbWrapperInstalled: boolean; dataBlockInstalled: boolean };
    addProtectedRoot(dir: string): string;
};

const REPO = core.railsStatus().repoRoot;
const IS_WIN = process.platform === 'win32';

function codeOf(fn: () => unknown): string {
    try {
        fn();
    } catch (e) {
        return String((e as { code?: unknown }).code ?? (e as Error).message);
    }
    return 'NO-THROW';
}

function canon(p: string): string {
    const r = fs.realpathSync.native(p);
    return IS_WIN ? r.toLowerCase() : r;
}

function statFacts(dir: string): string {
    return fs
        .readdirSync(dir)
        .sort()
        .map((n) => {
            const s = fs.statSync(path.join(dir, n));
            return `${n}:${s.size}:${s.mtimeMs}`;
        })
        .join('|');
}

function childSha256(file: string): string {
    // A railed child reads the FAKE fixture (its own rails protect only its repo root).
    const r = spawnRailedChild(process.execPath, ['-e', "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))", file]);
    if (r.status !== 0) throw new Error(`child hash failed: ${r.stderr}`);
    return r.stdout.trim();
}

let live = false;
let fake = '';
let fakeData = '';
let fixture = '';
const FIXTURE_BYTES = Buffer.from('rail-data-fixture-bytes');
let realDataBefore = '';

function requireLive(): void {
    if (!live) throw new Error('fake-root liveness did not pass: this real-root case refuses to run');
}

beforeAll(() => {
    expect(core.railsStatus().installed).toBe(true);
    realDataBefore = statFacts(path.join(REPO, 'data'));

    fake = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-dbtrip-'));
    fs.writeFileSync(path.join(fake, 'package.json'), JSON.stringify({ name: 'crypto-snipe-bot' }));
    fakeData = path.join(fake, 'data');
    fs.mkdirSync(path.join(fakeData, 'keep'), { recursive: true });
    fixture = path.join(fakeData, 'fixture.bin');
    fs.writeFileSync(fixture, FIXTURE_BYTES);
    const outside = path.join(fake, 'outside.txt');
    fs.writeFileSync(outside, 'outside');
    core.addProtectedRoot(fake);
    const listingBefore = statFacts(fakeData);

    // --- DB tripwire liveness: absolute, relative after chdir, upper-cased (win32), -wal ---
    const dbAbs = path.join(fakeData, 'bot.db');
    expect(codeOf(() => new Database(dbAbs))).toBe('RAIL_DB_TRIPWIRE');
    const cwd = process.cwd();
    try {
        process.chdir(fake);
        expect(codeOf(() => new Database(path.join('data', 'bot.db')))).toBe('RAIL_DB_TRIPWIRE');
    } finally {
        process.chdir(cwd);
    }
    if (IS_WIN) expect(codeOf(() => new Database(path.join(fake, 'DATA', 'BOT.DB')))).toBe('RAIL_DB_TRIPWIRE');
    expect(codeOf(() => new Database(path.join(fakeData, 'bot.db-wal')))).toBe('RAIL_DB_TRIPWIRE');
    expect(fs.existsSync(dbAbs)).toBe(false);
    expect(fs.existsSync(path.join(fakeData, 'bot.db-wal'))).toBe(false);

    // --- data fs block liveness: reads ---
    expect(codeOf(() => fs.readFileSync(fixture))).toBe('RAIL_DATA_TRIPWIRE');
    expect(codeOf(() => fs.createReadStream(fixture))).toBe('RAIL_DATA_TRIPWIRE');
    // fs.promises.readFile must reject; its outcome is awaited at the end of this hook.
    const p = fs.promises.readFile(fixture).then(
        () => 'NO-THROW',
        (e: { code?: string }) => String(e.code),
    );
    // --- writes (fake root only) ---
    expect(codeOf(() => fs.writeFileSync(path.join(fakeData, 'new.txt'), 'x'))).toBe('RAIL_DATA_TRIPWIRE');
    expect(codeOf(() => fs.appendFileSync(fixture, 'x'))).toBe('RAIL_DATA_TRIPWIRE');
    expect(codeOf(() => fs.copyFileSync(outside, path.join(fakeData, 'copy.txt')))).toBe('RAIL_DATA_TRIPWIRE');
    expect(codeOf(() => fs.renameSync(fixture, path.join(fakeData, 'renamed.bin')))).toBe('RAIL_DATA_TRIPWIRE');
    expect(codeOf(() => fs.unlinkSync(fixture))).toBe('RAIL_DATA_TRIPWIRE');
    expect(codeOf(() => fs.rmSync(path.join(fakeData, 'keep'), { recursive: true, force: true }))).toBe('RAIL_DATA_TRIPWIRE');
    expect(codeOf(() => fs.mkdirSync(path.join(fakeData, 'newdir')))).toBe('RAIL_DATA_TRIPWIRE');
    return p.then((promiseCode) => {
        expect(promiseCode).toBe('RAIL_DATA_TRIPWIRE');
        // Fixture unchanged: same listing / sizes / mtimes, and the same bytes (read by a child).
        expect(statFacts(fakeData)).toBe(listingBefore);
        expect(childSha256(fixture)).toBe(createHash('sha256').update(FIXTURE_BYTES).digest('hex'));
        live = true;
    });
}, 30_000);

afterAll(() => {
    // Real data/ metadata unchanged by this file (the wrapper checks hashes too).
    if (realDataBefore) expect(statFacts(path.join(REPO, 'data'))).toBe(realDataBefore);
});

describe('fake-root liveness', () => {
    it('DB tripwire and data fs block tripped on the fake root with the fixture unchanged', () => {
        expect(live).toBe(true);
    });
});

describe('real root (runs only after the fake-root liveness passed)', () => {
    it('the worker cwd is the repo root', () => {
        requireLive();
        expect(canon(process.cwd())).toBe(canon(REPO));
    });

    it("new Database('./data/bot.db') throws RAIL_DB_TRIPWIRE (AC-14)", () => {
        requireLive();
        expect(codeOf(() => new Database('./data/bot.db', { readonly: true, fileMustExist: true }))).toBe('RAIL_DB_TRIPWIRE');
    });

    it('the absolute path (and on win32 an upper-cased variant) throws RAIL_DB_TRIPWIRE', () => {
        requireLive();
        const abs = path.join(REPO, 'data', 'bot.db');
        expect(codeOf(() => new Database(abs, { readonly: true, fileMustExist: true }))).toBe('RAIL_DB_TRIPWIRE');
        if (IS_WIN) {
            expect(codeOf(() => new Database(abs.toUpperCase(), { readonly: true, fileMustExist: true }))).toBe('RAIL_DB_TRIPWIRE');
        }
    });

    it('data/bot.db-wal throws RAIL_DB_TRIPWIRE', () => {
        requireLive();
        expect(codeOf(() => new Database(path.join(REPO, 'data', 'bot.db-wal'), { readonly: true, fileMustExist: true }))).toBe('RAIL_DB_TRIPWIRE');
    });

    it('a raw fs.readFileSync of data/bot.db throws RAIL_DATA_TRIPWIRE (read only, never a write)', () => {
        requireLive();
        expect(codeOf(() => fs.readFileSync(path.join(REPO, 'data', 'bot.db')))).toBe('RAIL_DATA_TRIPWIRE');
    });

    it('a railed child that sets DB_PATH=./data/bot.db and imports src/utils/db at module scope is blocked (AC-14)', () => {
        requireLive();
        const before = statFacts(path.join(REPO, 'data'));
        const r = spawnRailedChild(process.execPath, ['test/rails/probes/moduleScopeDb.cjs'], { timeoutMs: 60_000 });
        expect(r.status).not.toBe(0);
        expect(r.status).not.toBe(3); // 3 = the probe refused because its own rails were not live
        expect(r.stderr).toContain('RAIL_DB_TRIPWIRE');
        expect(statFacts(path.join(REPO, 'data'))).toBe(before);
    }, 60_000);
});

describe('D-01: the setup layer does not depend on VITEST', () => {
    it('with process.env.VITEST deleted the fake-root DB open and data read still throw', () => {
        requireLive();
        const saved = process.env.VITEST;
        try {
            delete process.env.VITEST;
            expect(process.env.VITEST).toBeUndefined();
            expect(codeOf(() => new Database(path.join(fakeData, 'bot.db')))).toBe('RAIL_DB_TRIPWIRE');
            expect(codeOf(() => fs.readFileSync(fixture))).toBe('RAIL_DATA_TRIPWIRE');
        } finally {
            if (saved === undefined) delete process.env.VITEST;
            else process.env.VITEST = saved;
        }
        expect(process.env.VITEST).toBe(saved);
    });
});

describe('allowed databases keep working', () => {
    it(':memory: works', () => {
        const db = new Database(':memory:');
        db.exec('CREATE TABLE t (x INTEGER)');
        db.prepare('INSERT INTO t VALUES (?)').run(7);
        expect(db.prepare('SELECT x FROM t').get()).toEqual({ x: 7 });
        db.close();
    });

    it('a temp-file DB outside data/ works, and so does a Buffer DB built from it', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-tmpdb-'));
        const file = path.join(dir, 'ok.db');
        const db = new Database(file);
        db.exec('CREATE TABLE t (x INTEGER)');
        db.prepare('INSERT INTO t VALUES (?)').run(42);
        db.close();
        const buf = fs.readFileSync(file);
        const mem = new Database(buf);
        expect(mem.prepare('SELECT x FROM t').get()).toEqual({ x: 42 });
        mem.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('the in-memory test DB helper (test/helpers/testDb.ts) works', () => {
        const db = createTestDb();
        expect(db.pragma('user_version', { simple: true })).toBeTypeOf('number');
        db.close();
    });
});
