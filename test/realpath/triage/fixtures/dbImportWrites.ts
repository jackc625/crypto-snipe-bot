// test/realpath/triage/fixtures/dbImportWrites.ts
// Phase 23 plan 23-13 Task 1 (AUDIT-02, AC-14): the child process for AUD-DB-006.test.ts. Started
// only through spawnRailedChild (the rails preload, the inert sentinel env, VITEST unset so the
// production branch of src/utils/db.ts runs), with DB_PATH pointing at a throwaway temp database
// through envOverrides and the working directory in a throwaway temp folder.
//
// argv: <mode>
//   import        require the real src/utils/db and nothing else, then process.exit(0) without
//                 closeDb. What the import does at load is exactly what the parent measures.
//   pragmas-only  the control: open the same file with better-sqlite3 and issue only the three
//                 pragmas src/utils/db.ts issues (journal_mode = WAL, synchronous = NORMAL,
//                 busy_timeout = 5000), with no migration, then process.exit(0) without close.
//
// Neither mode reads or writes anything else in the database, and neither closes its connection:
// a process that exits without closing runs no checkpoint, so whatever it committed stays in the
// -wal file (the parent also holds its own connection open, so this child is never the last one).
//
// Prints one marker line, IMPORTED <db path> or PRAGMAS_ONLY <db path>, before exiting 0. Any
// setup failure prints FIXTURE_SETUP_ERROR <why> and exits 3, so the parent reports it as a real
// failure (AC-09), never as a measured result.

import Database from 'better-sqlite3';

function setupError(why: string): never {
    process.stdout.write(`FIXTURE_SETUP_ERROR ${why}\n`);
    process.exit(3);
}

const mode = process.argv[2];
const dbPath = process.env.DB_PATH;
if (!dbPath) setupError('DB_PATH is not set');
if (process.env.VITEST) setupError('VITEST is set: this child must run the production branch of src/utils/db.ts');

if (mode === 'import') {
    let opened: string;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const m = require('../../../../src/utils/db') as typeof import('../../../../src/utils/db');
        // getDbFilePath is a string the module computed at load: no SQL runs here.
        opened = m.getDbFilePath();
    } catch (err) {
        setupError(`import of src/utils/db failed: ${String((err as Error)?.message ?? err)}`);
    }
    process.stdout.write(`IMPORTED ${opened}\n`);
    process.exit(0);
} else if (mode === 'pragmas-only') {
    try {
        const db = new Database(dbPath, { fileMustExist: true });
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('busy_timeout = 5000');
    } catch (err) {
        setupError(`pragmas-only open failed: ${String((err as Error)?.message ?? err)}`);
    }
    process.stdout.write(`PRAGMAS_ONLY ${dbPath}\n`);
    process.exit(0);
} else {
    setupError(`unknown mode ${String(mode)} (import or pragmas-only)`);
}
