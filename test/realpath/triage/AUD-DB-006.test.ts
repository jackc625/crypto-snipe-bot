// test/realpath/triage/AUD-DB-006.test.ts
// Phase 23 plan 23-13 Task 1 (AUDIT-02, AC-14, D-07, D-08): AUD-DB-006, the half of the finding the
// Phase 22 rail did not close: every import of src/utils/db.ts writes to the database, including
// imports by commands that only read (the preflight command loads it too).
//
// The finding has two halves:
//   - newer-schema: an older build opened on a newer database silently rewrote its version. Closed
//     by the 22-09 rail (the read-only version probe in src/utils/dbPath.ts refuses a newer schema
//     with the file's bytes unchanged). Its rail test is "AC-24 schema version guard > a v8 database
//     (CURRENT+1) refuses and its bytes are unchanged" in test/integration/dbGuards.test.ts (RED
//     proof row 11 of .planning/phases/22-safety-rails-audit/red-proofs/INDEX.md). Not re-tested
//     here.
//   - import-writes (still open, asserted here): after the probe, db.ts opens read-write, sets the
//     pragmas, runs migrateSchema, whose last line writes PRAGMA user_version = 7 unconditionally
//     (src/utils/dbSchema.ts, end of migrateSchema), and runs the normalizeLegacyMainnetRows UPDATE.
//     On an up-to-date database the UPDATE matches no row and commits nothing; the version write
//     commits one page.
//
// Where the write lands (measured on this project's better-sqlite3 under Node 22, 2026-11-09 and
// again here): the connection is in WAL mode, so the committed page goes to the -wal file as one
// frame, and the main database file's bytes do not change until a checkpoint copies it back. A
// process that exits without closeDb runs no checkpoint, and this test holds its own connection open
// through the child, so the child is never the last connection either. A hash of the main file
// alone would therefore report no write. The proof reads the write where it lands:
//   - committedWrite        PRAGMA data_version on the test's own held connection changed across
//                           the child (SQLite changes it when another connection commits);
//   - databaseBytesChanged  one SHA-256 over the main file's bytes followed by the -wal file's bytes
//                           (an absent or empty -wal adds nothing) changed across the child;
//   - walFrames             the `log` field of PRAGMA wal_checkpoint(PASSIVE), read last, because
//                           that call moves frames.
// Correct: { false, false, 0 }, an import with no write operation commits nothing. Observed today:
// { true, true, 1 }.
//
// Control (pragmas-only): a child that opens the same kind of file with better-sqlite3 and issues
// only the three pragmas db.ts issues (journal_mode = WAL, synchronous = NORMAL, busy_timeout =
// 5000), with no migration, measured the same way, reports { false, false, 0 }. So the test can see
// "no write", and the real import's write is the version write, not journal setup.
//
// Setup: a real temp SQLite file built by the real migrations (migrateSchema) in WAL mode,
// checkpointed with wal_checkpoint(TRUNCATE), closed, with its -wal and -shm removed. Every child is
// railed (spawnRailedChild, VITEST unset so the production branch of db.ts runs, its own case ledger
// checked: rails started, no network use, nothing denied), started from a throwaway working folder
// (so migrateJsonState finds no .bot-state.json), with DB_PATH set to the temp file. No path here
// opens data/.
//
// Phase 24 reading: making the version write conditional (write only when user_version differs),
// with nothing else changed, flips the claim to "looks fixed" (shown by a fix-shaped mutation of
// src/utils/dbSchema.ts, restored byte for byte).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it, onTestFailed } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { REPO_ROOT, spawnRailedChild, type CliResult } from '../../rails/spawnRailedChild';
import { CURRENT_SCHEMA_VERSION, migrateSchema } from '../../../src/utils/dbSchema';
import { harnessState } from '../harness/chain';
import { knownBug } from '../harness/knownBug';

// Each test starts one railed child that loads ts-node. The explicit limit is headroom for a child
// process on a loaded machine (measured times are in the plan summary).
const CHILD_TIMEOUT_MS = 110_000;
const TEST_TIMEOUT_MS = 120_000;
const FIXTURE = path.join(REPO_ROOT, 'test', 'realpath', 'triage', 'fixtures', 'dbImportWrites.ts');
const TS_NODE_BIN = path.join(REPO_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');
const LEDGER_ROOT = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger');

interface WriteSeen {
    committedWrite: boolean;
    databaseBytesChanged: boolean;
    walFrames: number;
}

const NO_WRITE: WriteSeen = { committedWrite: false, databaseBytesChanged: false, walFrames: 0 };

function tempFolder(label: string): string {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `csb-aud-db-006-${label}-`)));
    harnessState().disposers.push(async () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    return dir;
}

let caseCounter = 0;
function newCaseId(label: string): string {
    caseCounter += 1;
    const id = `case-realpath-db006-${label}-${process.pid}-${caseCounter}-${Math.random().toString(36).slice(2, 10)}`;
    harnessState().disposers.push(async () => fs.rmSync(path.join(LEDGER_ROOT, id), { recursive: true, force: true }));
    return id;
}

/** The child's own rail ledger: the rails started, no network was used and nothing was denied. */
function expectRailedNoNetwork(runId: string): void {
    const dir = path.join(LEDGER_ROOT, runId);
    const entries: Array<{ kind: string }> = [];
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue;
        for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) if (line.trim() !== '') entries.push(JSON.parse(line) as { kind: string });
    }
    expect(entries.some((e) => e.kind === 'worker-start'), 'the child ran with the rails').toBe(true);
    expect(entries.filter((e) => e.kind.startsWith('net-') || /deny|blocked|tripwire/.test(e.kind))).toEqual([]);
}

function removeCompanions(file: string): void {
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
}

/**
 * A real up-to-date database: the real migrations in WAL mode, checkpointed into the main file
 * (TRUNCATE leaves an empty -wal), closed, companions removed. Returns the file's path.
 */
function seedWalDatabase(dir: string): string {
    const file = path.join(dir, 'bot.db');
    const setup = new Database(file);
    try {
        setup.pragma('journal_mode = WAL');
        migrateSchema(setup);
        setup.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
        setup.close();
    }
    removeCompanions(file);
    expect(fs.existsSync(`${file}-wal`) || fs.existsSync(`${file}-shm`), 'the seeded database has no -wal or -shm left').toBe(false);
    // WAL mode is recorded in the file header (bytes 18 and 19 are 2).
    const header = fs.readFileSync(file).subarray(0, 20);
    expect([header[18], header[19]], 'the seeded database is in WAL mode').toEqual([2, 2]);
    return file;
}

/** One SHA-256 over the main file's bytes followed by the -wal file's bytes (absent or empty adds nothing). */
function mainPlusWalHash(file: string): string {
    const h = createHash('sha256');
    h.update(fs.readFileSync(file));
    if (fs.existsSync(`${file}-wal`)) h.update(fs.readFileSync(`${file}-wal`));
    return h.digest('hex');
}

function describeRun(r: CliResult): string {
    return `status ${r.status}\nstdout (tail):\n${r.stdout.slice(-2000)}\nstderr (tail):\n${r.stderr.slice(-2000)}`;
}

const same = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * Seed a database, hold a connection to it, run the child in `mode`, and measure what it committed
 * from the held connection: data_version and the main-plus-WAL hash before and after, then the
 * WAL frame count (read last, because wal_checkpoint moves frames).
 */
function measureChild(mode: 'import' | 'pragmas-only'): { seen: WriteSeen; run: CliResult; file: string; versionAfter: number } {
    const dbDir = tempFolder('db');
    const cwd = tempFolder('cwd');
    const file = seedWalDatabase(dbDir);

    const db = new Database(file);
    try {
        const versionBefore = db.pragma('data_version', { simple: true }) as number;
        expect(db.pragma('user_version', { simple: true }), 'the seeded database is at the current schema version').toBe(CURRENT_SCHEMA_VERSION);
        const hashBefore = mainPlusWalHash(file);

        const ledgerRunId = newCaseId(mode);
        const run = spawnRailedChild(process.execPath, [TS_NODE_BIN, '--transpile-only', FIXTURE, mode], {
            cwd,
            withVitestEnv: false,
            envOverrides: { DB_PATH: file },
            ledgerRunId,
            timeoutMs: CHILD_TIMEOUT_MS,
        });
        onTestFailed(() => {
            console.error(`[AUD-DB-006 ${mode}] ${describeRun(run)}`);
        });
        // The path check (AC-09): the child ran its mode to the end on this file, under the rails.
        expect(run.stdout, 'the fixture reported no setup error').not.toContain('FIXTURE_SETUP_ERROR');
        expect(run.status, 'the child exited 0').toBe(0);
        const marker = mode === 'import' ? 'IMPORTED ' : 'PRAGMAS_ONLY ';
        const line = run.stdout.split(/\r?\n/).find((l) => l.startsWith(marker));
        expect(line, `the child printed ${marker.trim()}`).toBeDefined();
        expect(same(line!.slice(marker.length).trim(), file), 'the child opened the temp database').toBe(true);
        expectRailedNoNetwork(ledgerRunId);
        // Nothing appeared in the throwaway working folder.
        expect(fs.readdirSync(cwd)).toEqual([]);

        const versionAfter = db.pragma('data_version', { simple: true }) as number;
        const hashAfter = mainPlusWalHash(file);
        const checkpoint = db.pragma('wal_checkpoint(PASSIVE)') as Array<{ busy: number; log: number; checkpointed: number }>;
        const userVersionAfter = db.pragma('user_version', { simple: true }) as number;
        return {
            seen: { committedWrite: versionAfter !== versionBefore, databaseBytesChanged: hashAfter !== hashBefore, walFrames: checkpoint[0].log },
            run,
            file,
            versionAfter: userVersionAfter,
        };
    } finally {
        db.close();
    }
}

describe('AUD-DB-006 (open half): every import of src/utils/db.ts writes to the database', () => {
    it('import-writes-database: importing src/utils/db on an up-to-date WAL database commits a write (one WAL frame)', { timeout: TEST_TIMEOUT_MS }, (ctx) => {
        const { seen, versionAfter } = measureChild('import');
        knownBug(ctx, 'AUD-DB-006', {
            claim: 'import-writes-database',
            correct: NO_WRITE,
            observed: { committedWrite: true, databaseBytesChanged: true, walFrames: 1 },
            actual: seen,
            expectedPlain: 'Loading the database module on an up-to-date database (for example by the read-only preflight command) writes nothing to it.',
            actualPlain: 'Every load of the database module commits a write: it rewrites the schema version (one page in the WAL file) even when nothing changed.',
        });
        // The version it rewrote is the same version: the write changed no value.
        expect(versionAfter).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('control (pragmas-only): the journal pragmas db.ts issues, with no migration, commit nothing', { timeout: TEST_TIMEOUT_MS }, () => {
        const { seen } = measureChild('pragmas-only');
        expect(seen).toEqual(NO_WRITE);
    });
});
