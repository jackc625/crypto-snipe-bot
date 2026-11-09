// test/integration/dbInit.test.ts
// Phase 22 plan 22-09 Task 3 — scripts/db-init.ts (D-08). Every target is a fresh temp path:
// the live data/ is never named. Each case runs the real script in a railed child.

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { spawnRailedChild } from '../rails/spawnRailedChild';
import { migrateSchema, CURRENT_SCHEMA_VERSION } from '../../src/utils/dbSchema';

const CHILD_TIMEOUT = 90_000;

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'csb-dbinit-'));
}

function sha(p: string): string {
    return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function runInit(target: string, args: string[] = [], input?: string): { status: number | null; out: string } {
    const r = spawnRailedChild('npx', ['ts-node', 'scripts/db-init.ts', ...args], {
        envOverrides: { DB_PATH: target },
        input,
        timeoutMs: CHILD_TIMEOUT,
    });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

function buildV7(p: string): void {
    const db = new Database(p);
    migrateSchema(db);
    db.close();
}

function schemaSql(db: Database.Database): string[] {
    return (db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all() as Array<{ type: string; name: string; sql: string | null }>)
        .map((r) => `${r.type}|${r.name}|${r.sql}`);
}

function userVersion(p: string): number {
    const db = new Database(p, { readonly: true, fileMustExist: true });
    try {
        return db.pragma('user_version', { simple: true }) as number;
    } finally {
        db.close();
    }
}

const SAVED_DB_PATH = process.env.DB_PATH;

afterEach(() => {
    if (SAVED_DB_PATH === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = SAVED_DB_PATH;
    vi.resetModules();
});

// Case (d) from the plan, the absolute target printed every time, is asserted inside each case.
describe('npm run db:init (D-08)', () => {
    it('(a) creates a fresh database at CURRENT with the same schema db.ts builds, no temp left', { timeout: CHILD_TIMEOUT }, async () => {
        const dir = tempDir();
        const target = path.join(dir, 'fresh.db');

        const r = runInit(target);
        expect(r.status, r.out).toBe(0);
        expect(r.out).toContain(`Target database: ${target}`);
        expect(r.out).toContain(`CREATED ${target} v${CURRENT_SCHEMA_VERSION}`);
        expect(userVersion(target)).toBe(CURRENT_SCHEMA_VERSION);
        expect(fs.readdirSync(dir)).toEqual(['fresh.db']);

        const refDir = tempDir();
        process.env.DB_PATH = path.join(refDir, 'ref.db');
        vi.resetModules();
        const mod = await import('../../src/utils/db');
        const refSql = schemaSql(mod.db);
        mod.closeDb();

        const fresh = new Database(target, { readonly: true, fileMustExist: true });
        const freshSql = schemaSql(fresh);
        fresh.close();
        expect(freshSql).toEqual(refSql);
    });

    it('(b) refuses an existing v7 database, hash unchanged', { timeout: CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const target = path.join(dir, 'existing.db');
        buildV7(target);
        const before = sha(target);
        const r = runInit(target);
        expect(r.status, r.out).toBe(1);
        expect(r.out).toContain(`Target database: ${target}`);
        expect(r.out).toContain('already holds a database at schema version 7');
        expect(sha(target)).toBe(before);
    });

    it('(c) a 0-byte file: refused without the flag, refused on a wrong path, created on the exact path', { timeout: 3 * CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const target = path.join(dir, 'empty.db');
        fs.writeFileSync(target, '');

        const noFlag = runInit(target);
        expect(noFlag.status, noFlag.out).toBe(1);
        expect(noFlag.out).toContain(`Target database: ${target}`);
        expect(fs.statSync(target).size).toBe(0);

        const wrong = runInit(target, ['--replace-empty'], `${target}x\n`);
        expect(wrong.status, wrong.out).toBe(1);
        expect(wrong.out).toContain('did not match');
        expect(fs.statSync(target).size).toBe(0);

        const right = runInit(target, ['--replace-empty'], `${target}\n`);
        expect(right.status, right.out).toBe(0);
        expect(right.out).toContain(`Target database: ${target}`);
        expect(right.out).toContain(`CREATED ${target} v${CURRENT_SCHEMA_VERSION}`);
        expect(userVersion(target)).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('(e) a version-0 file holding a table is refused even with the flag and the right path', { timeout: CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const target = path.join(dir, 'held.db');
        const db = new Database(target);
        db.exec('CREATE TABLE precious (a)');
        db.close();
        const before = sha(target);
        const r = runInit(target, ['--replace-empty'], `${target}\n`);
        expect(r.status, r.out).toBe(1);
        expect(r.out).toContain(`Target database: ${target}`);
        expect(r.out).toContain('holds 1 schema objects');
        expect(sha(target)).toBe(before);
    });

    it('(f) a missing target with a stale -wal beside it is refused, nothing created', { timeout: CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const target = path.join(dir, 'missing.db');
        fs.writeFileSync(`${target}-wal`, 'stale frames');
        const r = runInit(target);
        expect(r.status, r.out).toBe(1);
        expect(r.out).toContain(`Target database: ${target}`);
        expect(r.out).toContain(`${target}-wal`);
        expect(fs.existsSync(target)).toBe(false);
    });

    it('(f2) a version-0 empty file with a stale -wal beside it is refused even when confirmed', { timeout: CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const target = path.join(dir, 'v0empty.db');
        const db = new Database(target);
        db.exec('CREATE TABLE x (a); DROP TABLE x;');
        db.close();
        const before = sha(target);
        fs.writeFileSync(`${target}-wal`, 'stale frames');
        const r = runInit(target, ['--replace-empty'], `${target}\n`);
        expect(r.status, r.out).toBe(1);
        expect(r.out).toContain(`${target}-wal`);
        expect(sha(target)).toBe(before);
    });

    it('(g) a leftover .init-*.tmp is refused and named', { timeout: CHILD_TIMEOUT }, () => {
        const dir = tempDir();
        const target = path.join(dir, 'left.db');
        const tmp = `${target}.init-1234.tmp`;
        fs.writeFileSync(tmp, 'partial');
        const r = runInit(target);
        expect(r.status, r.out).toBe(1);
        expect(r.out).toContain(`Target database: ${target}`);
        expect(r.out).toContain(tmp);
        expect(fs.existsSync(target)).toBe(false);
    });
});
