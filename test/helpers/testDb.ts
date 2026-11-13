// test/helpers/testDb.ts
// In-memory SQLite factory for test isolation.
// Creates a fresh database built by the real migrations, at the current schema version.

import Database from 'better-sqlite3';
import { migrateSchema } from '../../src/utils/dbSchema';

/**
 * Create a fresh in-memory SQLite database with the full production schema.
 * Each call returns an isolated DB instance -- no cross-test contamination.
 *
 * The schema is built by the real migrations (migrateSchema in src/utils/dbSchema.ts, the same
 * function src/utils/db.ts runs), never by hand, so it is the production schema: every table,
 * column, index and default, including the failed-held exit columns and the pause_state table,
 * and user_version equals CURRENT_SCHEMA_VERSION. Phase 23 plan 23-03 (CHAR-05, AC-07) replaced
 * the hand-written version 4 schema this helper used to create (AUD-TESTI-001, RC-28).
 */
export function createTestDb(): Database.Database {
    const db = new Database(':memory:');

    // Match production pragmas (WAL is issued for parity but :memory: uses journal_mode=memory)
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');

    migrateSchema(db);

    return db;
}
