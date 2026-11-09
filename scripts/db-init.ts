// scripts/db-init.ts
//
// Phase 22 plan 22-09 (SAFE-05, D-08): the only way to create the bot's database. The bot
// itself refuses to start on a missing or empty database, and this script is never part of
// boot: there is no bot flag or env var that runs it (D-ROLLBACK / P5).
//
// What it does: resolves the target with the same function db.ts uses, prints the absolute
// path, and refuses unless it is safe to create or replace it. Creation is atomic: the file is
// built beside the target as <target>.init-<pid>.tmp, migrated, verified, and only then renamed
// onto the target, so a crash cannot leave a half-built database at the target path.
//
// Refused (exit 1, naming each path):
//   - any <target>.init-*.tmp beside the target (an interrupted earlier run; delete it after
//     checking it);
//   - a -wal, -shm or -journal file beside a target that would be created or replaced (they
//     could be replayed into the new file);
//   - a target already at a schema version above 0;
//   - a version-0 target that holds any schema object (it holds data and is never replaced).
// A 0-byte target, or a version-0 target with no schema objects, is replaced only with
// --replace-empty AND the exact absolute path typed at the prompt.
//
// Exit codes: 0 created, 1 refused or failed, 2 uncaught error.
//
// Usage:
//   npm run db:init
//   npm run db:init -- --replace-empty

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import Database from 'better-sqlite3';
import { findRepoRoot } from '../src/utils/repoRoot';
import { probeExistingDb, resolveDbPath, type DbProbe } from '../src/utils/dbPath';
import { CURRENT_SCHEMA_VERSION, migrateSchema } from '../src/utils/dbSchema';

function fail(message: string): never {
    process.stderr.write(`db-init: refused: ${message}\n`);
    process.exit(1);
}

function assertRuntime(): void {
    if (process.versions.modules !== '127') {
        fail(`requires Node 22.16.0 (ABI 127); this is Node ${process.version} (ABI ${process.versions.modules})`);
    }
}

function refuseLeftovers(target: string): void {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) return;
    const prefix = `${path.basename(target)}.init-`;
    const stale = fs
        .readdirSync(dir)
        .filter((n) => n.startsWith(prefix) && n.endsWith('.tmp'))
        .map((n) => path.join(dir, n));
    if (stale.length > 0) {
        fail(`an earlier run was interrupted; check and delete: ${stale.join(', ')}`);
    }
}

function sidecars(target: string): string[] {
    return [`${target}-wal`, `${target}-shm`, `${target}-journal`].filter((p) => fs.existsSync(p));
}

function refuseSidecars(target: string): void {
    const found = sidecars(target);
    if (found.length > 0) {
        fail(`companion files beside the target could be replayed into a new database: ${found.join(', ')}`);
    }
}

function readConfirmationLine(): Promise<string | null> {
    return new Promise((resolve) => {
        process.stdout.write('Type the full path above to confirm: ');
        const rl = readline.createInterface({ input: process.stdin });
        let answered = false;
        rl.once('line', (line) => {
            answered = true;
            rl.close();
            resolve(line);
        });
        rl.once('close', () => {
            if (!answered) resolve(null);
        });
    });
}

function sameState(a: DbProbe, b: DbProbe): boolean {
    if (a.exists !== b.exists || a.size !== b.size) return false;
    if (!a.identity || !b.identity) return a.identity === b.identity;
    return a.identity.dev === b.identity.dev && a.identity.ino === b.identity.ino;
}

function buildAtomically(target: string, confirmed: DbProbe): number {
    const tmp = `${target}.init-${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
        const db = new Database(tmp);
        let version: number;
        try {
            migrateSchema(db);
            version = db.pragma('user_version', { simple: true }) as number;
        } finally {
            db.close();
        }
        if (version !== CURRENT_SCHEMA_VERSION) {
            throw new Error(`the new file reports user_version ${version}, expected ${CURRENT_SCHEMA_VERSION}`);
        }
        // The window between the checks above and the rename stays a few lines of code: the
        // target must still be exactly what was checked and confirmed.
        const now = probeExistingDb(target);
        if (!sameState(now, confirmed) || sidecars(target).length > 0) {
            throw new Error('the target changed while the new database was being built');
        }
        fs.renameSync(tmp, target);
        return version;
    } catch (err) {
        for (const suffix of ['', '-journal', '-wal', '-shm']) fs.rmSync(tmp + suffix, { force: true });
        fail(`could not create ${target}: ${(err as Error).message}`);
    }
}

async function main(): Promise<void> {
    assertRuntime();
    if (!process.env.VITEST) dotenv.config();

    const replaceEmpty = process.argv.includes('--replace-empty');
    const target = resolveDbPath(process.env.DB_PATH, findRepoRoot(__filename), { vitest: !!process.env.VITEST });
    process.stdout.write(`Target database: ${target}\n`);
    if (target === ':memory:') fail('DB_PATH is the in-memory database, which cannot be initialised');

    refuseLeftovers(target);

    let probe: DbProbe;
    try {
        probe = probeExistingDb(target);
    } catch (err) {
        fail(`could not read the existing file at ${target}: ${(err as Error).message}`);
    }

    if (probe.exists && (probe.userVersion ?? 0) > 0) {
        fail(`${target} already holds a database at schema version ${probe.userVersion}`);
    }
    if (probe.exists && (probe.schemaObjectCount ?? 0) > 0) {
        fail(`${target} is at version 0 but holds ${probe.schemaObjectCount} schema objects; it is never replaced, even with --replace-empty`);
    }
    refuseSidecars(target);

    if (probe.exists) {
        const label = probe.size === 0 ? 'is 0 bytes' : 'is an initialised-empty file at version 0';
        if (!replaceEmpty) fail(`${target} ${label}; pass --replace-empty and confirm the path to replace it`);
        const typed = await readConfirmationLine();
        if (typed !== target) fail('the typed path did not match the target exactly');
    }

    const version = buildAtomically(target, probe);
    process.stdout.write(`CREATED ${target} v${version}\n`);
}

main().catch((err) => {
    process.stderr.write(`db-init: uncaught error: ${(err as Error).message}\n`);
    process.exit(2);
});
