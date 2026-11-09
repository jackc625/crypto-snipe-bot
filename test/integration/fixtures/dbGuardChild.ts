// test/integration/fixtures/dbGuardChild.ts
//
// Phase 22 plan 22-09 Task 2 — child process for test/integration/dbGuards.test.ts. Runs
// OUTSIDE Vitest (withVitestEnv: false) under the rails preload, against temp fixtures only.
// argv: <mode> <db path>
//   boot:                  import src/utils/db (the real production module path)
//   race-delete:           the file is deleted between the probe and the write open
//   race-replace-v8/-v0/-other-v7: the file is replaced by the prepared sibling <path>.v8,
//                          <path>.v0 or <path>.other7 in that window (a rename: a new file)
// Prints OPENED <path> v<version> or REFUSED <code> <message>, then for race modes
// AFTER exists=<bool> sha256=<hex|none>. Exit 0 opened, 1 refused.

import { createHash } from 'crypto';
import * as fs from 'fs';
import { openGuardedDb } from '../../../src/utils/dbPath';
import { CURRENT_SCHEMA_VERSION } from '../../../src/utils/dbSchema';

const [, , mode, dbPath] = process.argv;

function sha(p: string): string {
    return fs.existsSync(p) ? createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'none';
}

function printAfter(): void {
    process.stdout.write(`AFTER exists=${fs.existsSync(dbPath)} sha256=${sha(dbPath)}\n`);
}

function refused(err: unknown): never {
    const e = err as { code?: string; message?: string };
    process.stdout.write(`REFUSED ${e.code ?? 'UNKNOWN'} ${e.message ?? String(err)}\n`);
    if (mode !== 'boot') printAfter();
    process.exit(1);
}

if (mode === 'boot') {
    process.env.DB_PATH = dbPath;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const m = require('../../../src/utils/db') as typeof import('../../../src/utils/db');
        const version = m.db.pragma('user_version', { simple: true });
        process.stdout.write(`OPENED ${m.getDbFilePath()} v${version}\n`);
        m.closeDb();
        process.exit(0);
    } catch (err) {
        refused(err);
    }
}

const hooks: Record<string, () => void> = {
    'race-delete': () => fs.unlinkSync(dbPath),
    'race-replace-v8': () => fs.renameSync(`${dbPath}.v8`, dbPath),
    'race-replace-v0': () => fs.renameSync(`${dbPath}.v0`, dbPath),
    'race-replace-other-v7': () => fs.renameSync(`${dbPath}.other7`, dbPath),
};

const hook = hooks[mode];
if (!hook) {
    process.stdout.write(`REFUSED BAD_MODE unknown mode ${mode}\n`);
    process.exit(2);
}

try {
    const db = openGuardedDb(dbPath, { vitest: false, current: CURRENT_SCHEMA_VERSION, raceHookForTests: hook });
    const version = db.pragma('user_version', { simple: true });
    process.stdout.write(`OPENED ${dbPath} v${version}\n`);
    db.close();
    printAfter();
    process.exit(0);
} catch (err) {
    refused(err);
}
