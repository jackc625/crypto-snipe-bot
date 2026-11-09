// test/integration/dbGuards.test.ts
// Phase 22 plan 22-09 Task 2 — SAFE-05 DB guards (AC-24, AC-25, AC-26) and the write-boundary
// races, all on temp fixtures. Children run the real src/utils/db (or openGuardedDb) OUTSIDE
// Vitest through spawnRailedChild, so the production branch is exercised; the live data/ is
// never named by any test here.

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { REPO_ROOT, spawnRailedChild } from '../rails/spawnRailedChild';
import { migrateSchema, CURRENT_SCHEMA_VERSION } from '../../src/utils/dbSchema';
import { probeExistingDb } from '../../src/utils/dbPath';

const CHILD = 'test/integration/fixtures/dbGuardChild.ts';
const CHILD_TIMEOUT = 90_000;

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'csb-dbguards-'));
}

function sha(p: string): string {
    return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function runChild(mode: string, dbPath: string): { status: number | null; out: string } {
    const r = spawnRailedChild('npx', ['ts-node', CHILD, mode, dbPath], { withVitestEnv: false, timeoutMs: CHILD_TIMEOUT });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

function buildV7(p: string): void {
    const db = new Database(p);
    migrateSchema(db);
    db.close();
}

function buildVersion(p: string, v: number): void {
    buildV7(p);
    const db = new Database(p);
    db.pragma(`user_version = ${v}`);
    db.close();
}

function buildEmptyV0(p: string): void {
    const db = new Database(p);
    db.exec('CREATE TABLE x (a); DROP TABLE x;');
    db.close();
}

function buildV0WithTable(p: string): void {
    const db = new Database(p);
    db.exec('CREATE TABLE precious (a)');
    db.close();
}

function refusedLine(out: string): string {
    return out.split('\n').find((l) => l.startsWith('REFUSED ')) ?? '';
}

function afterLine(out: string): { exists: boolean; sha: string } {
    const m = out.match(/AFTER exists=(true|false) sha256=(\S+)/);
    if (!m) throw new Error(`no AFTER line in child output: ${out}`);
    return { exists: m[1] === 'true', sha: m[2] };
}

let realRoot = '';

beforeAll(() => {
    realRoot = fs.realpathSync.native(REPO_ROOT);
});

describe('AC-24 schema version guard', () => {
    it('a v7 database opens through the production path', { timeout: CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const p = path.join(dir, 'guard.db');
        buildV7(p);
        const r = runChild('boot', p);
        expect(r.status, r.out).toBe(0);
        expect(r.out).toContain(`OPENED ${p} v${CURRENT_SCHEMA_VERSION}`);
    });

    it('a v8 database (CURRENT+1) refuses and its bytes are unchanged', { timeout: CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const p = path.join(dir, 'guard.db');
        buildVersion(p, CURRENT_SCHEMA_VERSION + 1);
        const before = sha(p);
        const r = runChild('boot', p);
        // Hash first: a refused newer DB must never be written, whatever the child printed.
        expect(sha(p)).toBe(before);
        expect(r.status, r.out).toBe(1);
        expect(refusedLine(r.out)).toMatch(/^REFUSED DB_REFUSED_NEWER_SCHEMA .*schema version 8.*up to 7/);
    });
});

describe('AC-26 refuse-to-create outside Vitest', () => {
    it('a missing path refuses, names the absolute path and creates nothing', { timeout: CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const p = path.join(dir, 'missing.db');
        const r = runChild('boot', p);
        // Checked first: a refused missing path must never be created, whatever the child printed.
        expect(fs.existsSync(p)).toBe(false);
        expect(r.status, r.out).toBe(1);
        expect(refusedLine(r.out)).toContain('DB_REFUSED_MISSING');
        expect(refusedLine(r.out)).toContain(p);
        expect(refusedLine(r.out)).toContain('npm run db:init');
    });

    it('a 0-byte file refuses and stays 0 bytes', { timeout: CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const p = path.join(dir, 'empty.db');
        fs.writeFileSync(p, '');
        const r = runChild('boot', p);
        expect(r.status, r.out).toBe(1);
        expect(refusedLine(r.out)).toContain('DB_REFUSED_EMPTY');
        expect(refusedLine(r.out)).toContain(p);
        expect(fs.statSync(p).size).toBe(0);
    });

    it('a valid SQLite file at user_version 0 with no objects refuses', { timeout: CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const p = path.join(dir, 'v0.db');
        buildEmptyV0(p);
        const r = runChild('boot', p);
        expect(r.status, r.out).toBe(1);
        expect(refusedLine(r.out)).toContain('DB_REFUSED_UNINITIALISED');
        expect(refusedLine(r.out)).toContain(p);
    });

    it('version 0 holding a table refuses and names the object count', { timeout: CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const p = path.join(dir, 'v0-table.db');
        buildV0WithTable(p);
        const r = runChild('boot', p);
        expect(r.status, r.out).toBe(1);
        expect(refusedLine(r.out)).toMatch(/^REFUSED DB_REFUSED_UNINITIALISED .*holds 1 schema objects/);
        expect(refusedLine(r.out)).toContain(p);
    });
});

describe('write boundary races (nothing created or migrated)', () => {
    function raceFixture(): string {
        const dir = tempDir();
        const p = path.join(dir, 'race.db');
        buildV7(p);
        return p;
    }

    it('race-delete: the file vanishes after the probe and is not created', { timeout: CHILD_TIMEOUT }, () => {
        const p = raceFixture();
        const r = runChild('race-delete', p);
        expect(afterLine(r.out).exists).toBe(false);
        expect(r.status, r.out).toBe(1);
        expect(refusedLine(r.out)).toContain('DB_REFUSED_MISSING');
    });

    it('race-replace-v8: a newer DB swapped in is refused, unchanged', { timeout: CHILD_TIMEOUT }, () => {
        const p = raceFixture();
        buildVersion(`${p}.v8`, CURRENT_SCHEMA_VERSION + 1);
        const replacementSha = sha(`${p}.v8`);
        const r = runChild('race-replace-v8', p);
        expect(r.status, r.out).toBe(1);
        expect(refusedLine(r.out)).toMatch(/DB_REFUSED_NEWER_SCHEMA|DB_REFUSED_REPLACED/);
        expect(afterLine(r.out).sha).toBe(replacementSha);
    });

    it('race-replace-v0: an uninitialised DB swapped in is refused', { timeout: CHILD_TIMEOUT }, () => {
        const p = raceFixture();
        buildEmptyV0(`${p}.v0`);
        const r = runChild('race-replace-v0', p);
        expect(r.status, r.out).toBe(1);
        expect(refusedLine(r.out)).toMatch(/^REFUSED /);
    });

    it('race-replace-other-v7: a different v7 file swapped in is refused', { timeout: CHILD_TIMEOUT }, () => {
        const p = raceFixture();
        buildV7(`${p}.other7`);
        const replacementSha = sha(`${p}.other7`);
        const r = runChild('race-replace-other-v7', p);
        expect(r.status, r.out).toBe(1);
        expect(refusedLine(r.out)).toContain('DB_REFUSED_REPLACED');
        expect(afterLine(r.out).sha).toBe(replacementSha);
    });
});

describe('AC-25 repo-root anchoring from another directory', () => {
    it('./data/bot.db resolves under the repo root from os.tmpdir() (string only, nothing opened)', { timeout: CHILD_TIMEOUT }, () => {
        const R = JSON.stringify(REPO_ROOT);
        const script =
            `const R=${R};require(R+'/node_modules/ts-node').register({transpileOnly:true,cwd:R});` +
            `const {resolveDbPath}=require(R+'/src/utils/dbPath');const {findRepoRoot}=require(R+'/src/utils/repoRoot');` +
            `console.log(resolveDbPath('./data/bot.db',findRepoRoot(),{vitest:false}));`;
        const r = spawnRailedChild(process.execPath, ['-e', script], { cwd: os.tmpdir(), withVitestEnv: false, timeoutMs: CHILD_TIMEOUT });
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout.trim().toLowerCase()).toBe(path.join(realRoot, 'data', 'bot.db').toLowerCase());
    });
});

describe('the probe itself leaves no trace (no new files, no changed bytes)', () => {
    function snapshot(dir: string): string[] {
        return fs
            .readdirSync(dir)
            .sort()
            .map((n) => `${n}:${fs.statSync(path.join(dir, n)).size}:${sha(path.join(dir, n))}`);
    }

    function buildWalWriter(p: string): Database.Database {
        const w = new Database(p);
        w.pragma('journal_mode = WAL');
        w.pragma('wal_autocheckpoint = 0');
        migrateSchema(w);
        w.exec("INSERT INTO trades (token, action) VALUES ('0xabc', 'buy')");
        return w;
    }

    it('WAL-mode file with no companions (cleanly closed)', () => {
        const dir = tempDir();
        const p = path.join(dir, 'wal.db');
        const w = buildWalWriter(p);
        w.close();
        expect(fs.readdirSync(dir)).toEqual(['wal.db']);
        const before = snapshot(dir);
        const probe = probeExistingDb(p);
        expect(probe.userVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(probe.schemaObjectCount).toBeGreaterThan(0);
        expect(snapshot(dir)).toEqual(before);
    });

    it('WAL-mode copy with -wal and -shm (user_version read from the WAL)', () => {
        const src = tempDir();
        const p = path.join(src, 'wal.db');
        const w = buildWalWriter(p);
        const dir = tempDir();
        for (const n of fs.readdirSync(src)) fs.copyFileSync(path.join(src, n), path.join(dir, n));
        w.close();
        const q = path.join(dir, 'wal.db');
        const before = snapshot(dir);
        expect(before.some((l) => l.startsWith('wal.db-wal:'))).toBe(true);
        expect(before.some((l) => l.startsWith('wal.db-shm:'))).toBe(true);
        const probe = probeExistingDb(q);
        expect(probe.userVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(snapshot(dir)).toEqual(before);
    });

    it('WAL-mode copy with -wal only', () => {
        const src = tempDir();
        const p = path.join(src, 'wal.db');
        const w = buildWalWriter(p);
        const dir = tempDir();
        for (const n of fs.readdirSync(src)) if (!n.endsWith('-shm')) fs.copyFileSync(path.join(src, n), path.join(dir, n));
        w.close();
        const q = path.join(dir, 'wal.db');
        const before = snapshot(dir);
        expect(before.some((l) => l.startsWith('wal.db-shm:'))).toBe(false);
        const probe = probeExistingDb(q);
        expect(probe.userVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(snapshot(dir)).toEqual(before);
    });

    it('rollback-journal file', () => {
        const dir = tempDir();
        const p = path.join(dir, 'rollback.db');
        buildV7(p);
        const before = snapshot(dir);
        expect(probeExistingDb(p).userVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(snapshot(dir)).toEqual(before);
    });

    it('a missing file: nothing is created', () => {
        const dir = tempDir();
        const p = path.join(dir, 'none.db');
        expect(probeExistingDb(p).exists).toBe(false);
        expect(fs.readdirSync(dir)).toEqual([]);
    });
});

describe('healthy WAL-mode database (the production case)', () => {
    function buildHealthyWal(p: string): void {
        const w = new Database(p);
        w.pragma('journal_mode = WAL');
        migrateSchema(w);
        w.close();
    }

    it('a healthy WAL database boots through src/utils/db', { timeout: CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const p = path.join(dir, 'healthy.db');
        buildHealthyWal(p);
        const r = runChild('boot', p);
        expect(r.status, r.out).toBe(0);
        expect(r.out).toContain(`OPENED ${p} v${CURRENT_SCHEMA_VERSION}`);
    });

    it('npm run preflight reaches its report on a healthy database (no DB refusal)', { timeout: 150_000 }, () => {
        const dir = tempDir();
        const p = path.join(dir, 'healthy.db');
        buildHealthyWal(p);
        const r = spawnRailedChild('npx', ['ts-node', 'scripts/preflight.ts'], {
            withVitestEnv: false,
            envOverrides: { DB_PATH: p },
            timeoutMs: 140_000,
        });
        const out = `${r.stdout}\n${r.stderr}`;
        expect(out).not.toContain('DB_REFUSED');
        expect(out).toMatch(/\b(PASS|FAIL)\s+\w/);
        // 0 = all checks passed, 1 = checks failed (sentinel RPCs are refused); never 2 (a crash)
        expect([0, 1]).toContain(r.status);
    });
});
