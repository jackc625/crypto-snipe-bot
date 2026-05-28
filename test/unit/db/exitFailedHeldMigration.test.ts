// test/unit/db/exitFailedHeldMigration.test.ts
// Phase 21.2 / Plan 21.2-03 / STOP-THE-LINE-04-D / D-PERSIST-FAILED-HELD.
//
// Schema migration v6→v7: persist a still-held FAILED exit so it survives restart.
// On a failed exit of a still-held position the engine must NOT delete `exit_state`;
// it marks a distinct status `exit_failed_held` (separate from `sold` and from
// `failed`=dead) and bumps a persisted failure counter (`exit_failure_count`) that
// drives the bounded-routine-retry logic in 21.2-07. On restart, `exit_failed_held`
// rows re-enter monitoring + re-register anti-rug (proven on a fork in 21.2-10).
//
// Per RESEARCH A9 + Runtime State Inventory, the new status + counter live on the
// `exit_state` table (the monitoring-lifecycle table, already keyed by trade_id) —
// this is the ADDITIVE ALTER-guard path (db.ts:185-189 idiom), explicitly chosen
// OVER recreating the trades.status CHECK constraint (SQLite cannot ALTER a CHECK;
// that path is heavier and risks the trades table).
//
// Behavior contracts (from 21.2-03-PLAN.md <behavior>):
//   Test 1 (version bump): after migration the DB user_version is 7.
//   Test 2 (columns added): PRAGMA table_info('exit_state') includes
//           `exit_failure_count` (INTEGER NOT NULL DEFAULT 0) and `exit_status` (TEXT).
//   Test 3 (idempotent re-run): re-applying the migration does not throw and does
//           NOT add the columns twice (column count unchanged).
//   Test 4 (existing rows survive): seed a v6-shaped exit_state row + trades rows
//           (status 'pending' / 'sold' / 'failed') BEFORE migration; assert they
//           still exist with unchanged values AFTER migration, with
//           exit_failure_count defaulted to 0.
//   Test 5 (statement round-trip): a prepared statement sets
//           exit_status='exit_failed_held' + an incremented exit_failure_count for a
//           trade_id; reading the row back returns those values.
//
// Mirrors the structure of test/unit/db/pauseStateMigration.test.ts (v5→v6 analog)
// and test/unit/db/lpBaselineMigration.test.ts (v4→v5 analog). All in-memory tests
// construct their own Database to avoid singleton/module-cache contamination from
// src/utils/db.ts (which binds the real DB file via DB_PATH).

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers: replicate the production migration steps against an in-memory DB so
// each test can construct a starting state (v6) and then exercise exactly the
// v6→v7 step from src/utils/db.ts in isolation.
// ---------------------------------------------------------------------------

function applyV1Migration(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL COLLATE NOCASE,
            chain TEXT NOT NULL DEFAULT 'eth',
            action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'fail')),
            tx_hash TEXT,
            block INTEGER,
            timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
            amount_in TEXT,
            amount_out TEXT,
            gas_cost TEXT,
            price_at_action TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sold', 'failed'))
        );
        CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token);
        CREATE INDEX IF NOT EXISTS idx_trades_chain ON trades(chain);
        CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
        CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
    `);
}

function applyV2Migration(db: Database.Database): void {
    db.exec(`
        ALTER TABLE trades ADD COLUMN pool_type TEXT DEFAULT 'v2' CHECK(pool_type IN ('v2', 'v3'));
        ALTER TABLE trades ADD COLUMN fee_tier INTEGER;
    `);
}

function applyV3Migration(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS exit_state (
            trade_id INTEGER PRIMARY KEY,
            entry_price REAL NOT NULL,
            high_water_mark REAL NOT NULL,
            trailing_activated INTEGER NOT NULL DEFAULT 0,
            partial_tiers_completed TEXT NOT NULL DEFAULT '[]',
            original_token_amount TEXT NOT NULL,
            urgency_start_ts INTEGER NOT NULL,
            volatility_samples TEXT NOT NULL DEFAULT '[]',
            FOREIGN KEY (trade_id) REFERENCES trades(id)
        );
        CREATE INDEX IF NOT EXISTS idx_exit_state_trade ON exit_state(trade_id);
    `);
    db.exec(`
        CREATE TABLE trades_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL COLLATE NOCASE,
            chain TEXT NOT NULL DEFAULT 'eth',
            action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'partial_sell', 'fail')),
            tx_hash TEXT,
            block INTEGER,
            timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
            amount_in TEXT,
            amount_out TEXT,
            gas_cost TEXT,
            price_at_action TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sold', 'failed')),
            pool_type TEXT DEFAULT 'v2' CHECK(pool_type IN ('v2', 'v3')),
            fee_tier INTEGER
        );
        INSERT INTO trades_new SELECT * FROM trades;
        DROP TABLE trades;
        ALTER TABLE trades_new RENAME TO trades;
        CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token);
        CREATE INDEX IF NOT EXISTS idx_trades_chain ON trades(chain);
        CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
        CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
    `);
}

function applyV4Migration(db: Database.Database): void {
    const columns = db.prepare("PRAGMA table_info('trades')").all() as Array<{ name: string }>;
    const hasColumn = columns.some(c => c.name === 'dex_name');
    if (!hasColumn) {
        db.exec(`ALTER TABLE trades ADD COLUMN dex_name TEXT DEFAULT NULL`);
    }
}

function applyV5Migration(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS lp_baseline (
            trade_id INTEGER PRIMARY KEY,
            pool_type TEXT NOT NULL CHECK(pool_type IN ('v2', 'v3')),
            pair_or_pool_address TEXT NOT NULL COLLATE NOCASE,
            v2_token0_reserve TEXT,
            v2_token1_reserve TEXT,
            v2_lp_total_supply TEXT,
            v3_active_liquidity TEXT,
            v3_tick_at_snapshot INTEGER,
            v3_position_nft_id TEXT,
            v3_fee_tier INTEGER,
            snapshot_block INTEGER NOT NULL,
            snapshot_ts INTEGER NOT NULL,
            FOREIGN KEY (trade_id) REFERENCES trades(id)
        );
        CREATE INDEX IF NOT EXISTS idx_lp_baseline_pool ON lp_baseline(pair_or_pool_address);

        CREATE TABLE IF NOT EXISTS chain_state (
            chain TEXT PRIMARY KEY,
            last_seen_block INTEGER NOT NULL,
            last_updated_ts INTEGER NOT NULL
        );
    `);
}

function applyV6Migration(db: Database.Database): void {
    db.transaction(() => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS pause_state (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                paused INTEGER NOT NULL DEFAULT 0,
                paused_at INTEGER,
                paused_by TEXT,
                reason TEXT
            );
        `);
        db.exec(`INSERT OR IGNORE INTO pause_state (id, paused, paused_at, paused_by, reason) VALUES (1, 0, NULL, NULL, NULL)`);

        const columns = db.prepare("PRAGMA table_info('chain_state')").all() as Array<{ name: string }>;
        const hasColumn = columns.some(c => c.name === 'antirug_dry_run_started');
        if (!hasColumn) {
            db.exec(`ALTER TABLE chain_state ADD COLUMN antirug_dry_run_started INTEGER`);
        }
    })();
}

/**
 * Production v6→v7 migration replica. Mirrors the `if (version < 7) { ... }` block
 * in src/utils/db.ts exactly so the tests exercise the SAME control flow as
 * production: an additive ALTER-guard (PRAGMA table_info) wrapped in db.transaction()
 * for atomicity. Re-running is a no-op because the guard skips the ALTER when the
 * columns already exist.
 */
function applyV7Migration(db: Database.Database): void {
    db.transaction(() => {
        const columns = db.prepare("PRAGMA table_info('exit_state')").all() as Array<{ name: string }>;
        const hasCol = columns.some(c => c.name === 'exit_failure_count');
        if (!hasCol) {
            db.exec(`ALTER TABLE exit_state ADD COLUMN exit_failure_count INTEGER NOT NULL DEFAULT 0`);
            db.exec(`ALTER TABLE exit_state ADD COLUMN exit_status TEXT`);
        }
    })();
}

/**
 * Runs the full migration chain v1..v7 idempotently. Each step honors the
 * `if (version < N)` gate so a partially-migrated DB advances only to v7.
 */
function runFullMigration(db: Database.Database): void {
    const version = db.pragma('user_version', { simple: true }) as number;

    if (version < 1) applyV1Migration(db);
    if (version < 2) applyV2Migration(db);
    if (version < 3) applyV3Migration(db);
    if (version < 4) applyV4Migration(db);
    if (version < 5) applyV5Migration(db);
    if (version < 6) applyV6Migration(db);
    if (version < 7) applyV7Migration(db);

    db.pragma(`user_version = 7`);
}

/**
 * Builds a v6-seeded in-memory DB so each migration mechanics test can exercise
 * exactly the v6→v7 step.
 */
function buildV6SeededDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    applyV1Migration(db);
    applyV2Migration(db);
    applyV3Migration(db);
    applyV4Migration(db);
    applyV5Migration(db);
    applyV6Migration(db);
    db.pragma('user_version = 6');
    return db;
}

/** Insert a minimal trade row so exit_state FK references resolve. Returns the id. */
function insertTradeRow(
    db: Database.Database,
    token: string,
    status: 'pending' | 'sold' | 'failed' = 'pending',
): number {
    const result = db.prepare(
        `INSERT INTO trades (token, chain, action, status, amount_in) VALUES (?, 'eth', 'buy', ?, '0.01')`
    ).run(token, status);
    return Number(result.lastInsertRowid);
}

/** Seed a v6-shaped exit_state row (8 columns, pre-v7) for a given trade_id. */
function insertV6ExitStateRow(db: Database.Database, tradeId: number): void {
    db.prepare(`
        INSERT INTO exit_state (
            trade_id, entry_price, high_water_mark, trailing_activated,
            partial_tiers_completed, original_token_amount, urgency_start_ts, volatility_samples
        ) VALUES (?, 0.0001, 0.0002, 1, '[0]', '1000000000000000000', 1700000000, '[1.0,1.1]')
    `).run(tradeId);
}

// ---------------------------------------------------------------------------
// Production module integration block: asserts the production singleton landed
// the v7 migration + the exit_failed_held statements.
// ---------------------------------------------------------------------------

describe('Phase 21.2 — Schema v6→v7 exit_failed_held + exit_failure_count migration', () => {
    describe('production module integration', () => {
        it('production src/utils/db.ts exports the exit_failed_held statements', async () => {
            const dbModule = await import('../../../src/utils/db');
            expect(dbModule.markExitFailedHeld).toBeDefined();
            expect(dbModule.getExitState).toBeDefined();
        });

        it('production user_version pragma reports 7 after module load', async () => {
            const dbModule = await import('../../../src/utils/db');
            const version = dbModule.db.pragma('user_version', { simple: true }) as number;
            expect(version).toBe(7);
        });

        it("production exit_state table has exit_failure_count + exit_status columns after module load", async () => {
            const dbModule = await import('../../../src/utils/db');
            const cols = (dbModule.db.prepare("PRAGMA table_info('exit_state')").all() as Array<{ name: string }>).map(c => c.name);
            expect(cols).toContain('exit_failure_count');
            expect(cols).toContain('exit_status');
        });
    });

    // -----------------------------------------------------------------------
    // Migration mechanics — operate on a fresh in-memory v6-seeded DB.
    // -----------------------------------------------------------------------

    describe('migration mechanics', () => {
        let db: Database.Database;

        beforeEach(() => {
            db = buildV6SeededDb();
        });

        it('Test 1 (version bump): db.pragma(user_version) returns 7 after applyV7Migration runs against a v6-seeded DB', () => {
            expect(db.pragma('user_version', { simple: true })).toBe(6);
            applyV7Migration(db);
            db.pragma(`user_version = 7`);
            const version = db.pragma('user_version', { simple: true }) as number;
            expect(version).toBe(7);
            db.close();
        });

        it("Test 2 (columns added): exit_state gains exit_failure_count (INTEGER NOT NULL DEFAULT 0) and exit_status (TEXT)", () => {
            applyV7Migration(db);

            const cols = db.prepare("PRAGMA table_info('exit_state')").all() as Array<{
                name: string; type: string; notnull: number; dflt_value: unknown;
            }>;

            const failureCount = cols.find(c => c.name === 'exit_failure_count');
            expect(failureCount).toBeDefined();
            expect(failureCount!.type).toBe('INTEGER');
            expect(failureCount!.notnull).toBe(1);
            // dflt_value comes back as the literal text '0' from PRAGMA table_info
            expect(Number(failureCount!.dflt_value)).toBe(0);

            const exitStatus = cols.find(c => c.name === 'exit_status');
            expect(exitStatus).toBeDefined();
            expect(exitStatus!.type).toBe('TEXT');

            db.close();
        });

        it('Test 3 (idempotent re-run): re-applying the migration does not throw and does NOT duplicate columns', () => {
            applyV7Migration(db);
            db.pragma(`user_version = 7`);

            const colsAfterFirst = db.prepare("PRAGMA table_info('exit_state')").all() as Array<{ name: string }>;
            const countAfterFirst = colsAfterFirst.length;

            // Re-run — the PRAGMA guard must make this a no-op (no duplicate-column error).
            expect(() => applyV7Migration(db)).not.toThrow();

            const colsAfterSecond = db.prepare("PRAGMA table_info('exit_state')").all() as Array<{ name: string }>;
            expect(colsAfterSecond.length).toBe(countAfterFirst);

            // Exactly one of each new column.
            expect(colsAfterSecond.filter(c => c.name === 'exit_failure_count').length).toBe(1);
            expect(colsAfterSecond.filter(c => c.name === 'exit_status').length).toBe(1);

            db.close();
        });

        it('Test 4 (existing rows survive): pre-migration exit_state + trades (pending/sold/failed) rows survive unchanged with exit_failure_count defaulted to 0', () => {
            // Seed BEFORE migration: three trades rows across the three statuses, plus
            // a v6-shaped exit_state row referencing the pending trade.
            const pendingId = insertTradeRow(db, '0xpending00000000000000000000000000000001', 'pending');
            const soldId = insertTradeRow(db, '0xsold0000000000000000000000000000000002', 'sold');
            const failedId = insertTradeRow(db, '0xfailed00000000000000000000000000000003', 'failed');
            insertV6ExitStateRow(db, pendingId);

            // Snapshot exit_state values before migration.
            const before = db.prepare(`SELECT * FROM exit_state WHERE trade_id = ?`).get(pendingId) as Record<string, unknown>;

            applyV7Migration(db);
            db.pragma(`user_version = 7`);

            // trades rows survive with unchanged status values.
            const trades = db.prepare(`SELECT id, status FROM trades ORDER BY id`).all() as Array<{ id: number; status: string }>;
            expect(trades).toEqual([
                { id: pendingId, status: 'pending' },
                { id: soldId, status: 'sold' },
                { id: failedId, status: 'failed' },
            ]);

            // exit_state row survives with its original values intact.
            const after = db.prepare(`SELECT * FROM exit_state WHERE trade_id = ?`).get(pendingId) as Record<string, unknown>;
            expect(after.entry_price).toBe(before.entry_price);
            expect(after.high_water_mark).toBe(before.high_water_mark);
            expect(after.trailing_activated).toBe(before.trailing_activated);
            expect(after.partial_tiers_completed).toBe(before.partial_tiers_completed);
            expect(after.original_token_amount).toBe(before.original_token_amount);
            expect(after.urgency_start_ts).toBe(before.urgency_start_ts);
            expect(after.volatility_samples).toBe(before.volatility_samples);

            // The new column on the pre-existing row defaults to 0 / NULL.
            expect(after.exit_failure_count).toBe(0);
            expect(after.exit_status).toBeNull();

            db.close();
        });
    });

    // -----------------------------------------------------------------------
    // Prepared statement round-trip — uses the SAME SQL literals the production
    // singleton uses, against an isolated in-memory v7 DB. Proves the SQL shape
    // works; the production integration block above proves the exports exist.
    // -----------------------------------------------------------------------

    describe('prepared statement round-trip', () => {
        let db: Database.Database;
        let tradeId: number;

        beforeEach(() => {
            db = buildV6SeededDb();
            applyV7Migration(db);
            db.pragma(`user_version = 7`);
            tradeId = insertTradeRow(db, '0xheld0000000000000000000000000000000099', 'pending');
            insertV6ExitStateRow(db, tradeId);
        });

        it("Test 5 (statement round-trip): markExitFailedHeld sets exit_status='exit_failed_held' + increments exit_failure_count; getExitState reads them back", () => {
            // markExitFailedHeld production SQL: idempotently mark + bump the counter.
            const markExitFailedHeld = db.prepare(`
                UPDATE exit_state
                SET exit_status = 'exit_failed_held',
                    exit_failure_count = exit_failure_count + 1
                WHERE trade_id = ?
            `);
            const getExitState = db.prepare(`SELECT * FROM exit_state WHERE trade_id = ?`);

            // First failed-still-held exit: counter 0 -> 1, status set.
            markExitFailedHeld.run(tradeId);
            let row = getExitState.get(tradeId) as Record<string, unknown>;
            expect(row.exit_status).toBe('exit_failed_held');
            expect(row.exit_failure_count).toBe(1);

            // Second failed-still-held exit: counter 1 -> 2, status still the marker.
            markExitFailedHeld.run(tradeId);
            row = getExitState.get(tradeId) as Record<string, unknown>;
            expect(row.exit_status).toBe('exit_failed_held');
            expect(row.exit_failure_count).toBe(2);

            db.close();
        });
    });
});
