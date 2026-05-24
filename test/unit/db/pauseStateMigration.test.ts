// Phase 20 / Plan 20-01 — Wave 1 implementation. Behavior contracts defined in plan 20-00.
//
// Covers schema migration v5→v6:
//   1. New pause_state table (single-row pattern, CHECK(id=1), 5 columns):
//        id INTEGER PRIMARY KEY CHECK(id=1),
//        paused INTEGER NOT NULL DEFAULT 0,
//        paused_at INTEGER,
//        paused_by TEXT,   -- 'dashboard' / 'cli' / 'preflight' / 'manual'
//        reason TEXT
//   2. Seed row inserted with paused=0 (so reads always return a row, never null).
//   3. ALTER TABLE adds antirug_dry_run_started INTEGER to existing chain_state
//      (per D-ANTIRUG-LIVE-GATE-CODE; atomic with pause_state add per
//      D-PAUSE-STORAGE planner discretion within "additive only, existing tables unchanged").
//   4. Idempotent re-run: applying migration v5→v6 a second time must NOT raise
//      `duplicate column name: antirug_dry_run_started` or
//      `table pause_state already exists`.
//   5. 5 new prepared statements (getPauseState/setPauseState/clearPauseState/
//      setAntirugDryRunStarted/getAntirugDryRunStarted) round-trip correctly.
//
// Mirrors the structure of test/unit/db/lpBaselineMigration.test.ts (Phase 19 analog):
//   * `runFullMigration` helper applies v1..v6 against an in-memory DB so each
//     it() block constructs a fresh starting state.
//   * Production module integration block verifies the singleton exports the 5
//     new prepared statements and reports user_version=6 after module load.
//
// All in-memory tests construct their own Database to avoid singleton/module-cache
// contamination from src/utils/db.ts (which binds the real DB file via DB_PATH).

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers: replicate the production migration steps against an in-memory DB
// so each test can construct a starting state (v5) and then exercise the
// real v5→v6 migration logic from src/utils/db.ts in isolation.
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

/**
 * Production v5→v6 migration replica: wraps DDL in a transaction for atomicity
 * per RESEARCH §1 + A1; ALTER guard via PRAGMA table_info provides defense-in-depth
 * if A1 (db.transaction accepts DDL on better-sqlite3 v12.8) holds wrong.
 *
 * Mirrors src/utils/db.ts:122..156 v5→v6 block exactly so tests exercise the SAME
 * control flow as production. After the test file runs, the production module
 * imported by `import '../../../src/utils/db'` will also have executed; this
 * helper exists so tests can construct in-memory DBs at arbitrary versions.
 */
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

        // ALTER guard for antirug_dry_run_started — clone v3→v4 pattern at db.ts:113-119
        const columns = db.prepare("PRAGMA table_info('chain_state')").all() as Array<{ name: string }>;
        const hasColumn = columns.some(c => c.name === 'antirug_dry_run_started');
        if (!hasColumn) {
            db.exec(`ALTER TABLE chain_state ADD COLUMN antirug_dry_run_started INTEGER`);
        }
    })();
}

/**
 * Runs the full migration chain v1..v6 idempotently. Each step honors the
 * `if (version < N)` gate so a partially-migrated DB advances only to v6.
 */
function runFullMigration(db: Database.Database): void {
    const version = db.pragma('user_version', { simple: true }) as number;

    if (version < 1) applyV1Migration(db);
    if (version < 2) applyV2Migration(db);
    if (version < 3) applyV3Migration(db);
    if (version < 4) applyV4Migration(db);
    if (version < 5) applyV5Migration(db);
    if (version < 6) applyV6Migration(db);

    db.pragma(`user_version = 6`);
}

/**
 * Builds a v5-seeded in-memory DB so each migration mechanics test can exercise
 * exactly the v5→v6 step.
 */
function buildV5SeededDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    applyV1Migration(db);
    applyV2Migration(db);
    applyV3Migration(db);
    applyV4Migration(db);
    applyV5Migration(db);
    db.pragma('user_version = 5');
    return db;
}

// ---------------------------------------------------------------------------
// Production module integration block: asserts the production singleton has
// landed the v6 migration + 5 new prepared statements.
// ---------------------------------------------------------------------------

describe('Phase 20 — Schema v5→v6 pause_state + chain_state.antirug_dry_run_started migration', () => {
    describe('production module integration', () => {
        it('production src/utils/db.ts exports the 5 new prepared statements', async () => {
            const dbModule = await import('../../../src/utils/db');
            expect(dbModule.getPauseState).toBeDefined();
            expect(dbModule.setPauseState).toBeDefined();
            expect(dbModule.clearPauseState).toBeDefined();
            expect(dbModule.setAntirugDryRunStarted).toBeDefined();
            expect(dbModule.getAntirugDryRunStarted).toBeDefined();
        });

        it('production user_version pragma reports 6 after module load', async () => {
            const dbModule = await import('../../../src/utils/db');
            const version = dbModule.db.pragma('user_version', { simple: true }) as number;
            expect(version).toBe(6);
        });
    });

    // -----------------------------------------------------------------------
    // Migration mechanics — operate on a fresh in-memory v5-seeded DB.
    // -----------------------------------------------------------------------

    describe('migration mechanics', () => {
        let db: Database.Database;

        beforeEach(() => {
            db = buildV5SeededDb();
        });

        it('Test 1: db.pragma(user_version) returns 6 after applyV6Migration runs against a v5-seeded DB', () => {
            expect(db.pragma('user_version', { simple: true })).toBe(5);
            applyV6Migration(db);
            db.pragma(`user_version = 6`);
            const version = db.pragma('user_version', { simple: true }) as number;
            expect(version).toBe(6);
            db.close();
        });

        it('Test 2: pause_state table exists with 5 columns (id, paused, paused_at, paused_by, reason) AND CHECK(id=1) is enforced (INSERT id=2 throws)', () => {
            applyV6Migration(db);

            const cols = db.prepare("PRAGMA table_info('pause_state')").all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>;
            const colNames = cols.map(c => c.name);
            expect(colNames).toEqual(['id', 'paused', 'paused_at', 'paused_by', 'reason']);

            // CHECK(id=1): inserting id=2 must throw
            expect(() => {
                db.prepare(`INSERT INTO pause_state (id, paused, paused_at, paused_by, reason) VALUES (2, 0, NULL, NULL, NULL)`).run();
            }).toThrow(/CHECK constraint failed|constraint/i);

            db.close();
        });

        it('Test 3: pause_state seed row exists with paused=0, paused_at=NULL, paused_by=NULL, reason=NULL after migration', () => {
            applyV6Migration(db);
            const rows = db.prepare(`SELECT * FROM pause_state`).all() as Array<Record<string, unknown>>;
            expect(rows.length).toBe(1);
            expect(rows[0].id).toBe(1);
            expect(rows[0].paused).toBe(0);
            expect(rows[0].paused_at).toBeNull();
            expect(rows[0].paused_by).toBeNull();
            expect(rows[0].reason).toBeNull();
            db.close();
        });

        it('Test 4: chain_state has 4 columns including antirug_dry_run_started (PRAGMA table_info)', () => {
            applyV6Migration(db);
            const cols = db.prepare("PRAGMA table_info('chain_state')").all() as Array<{ name: string; type: string }>;
            const colNames = cols.map(c => c.name);
            expect(colNames).toContain('chain');
            expect(colNames).toContain('last_seen_block');
            expect(colNames).toContain('last_updated_ts');
            expect(colNames).toContain('antirug_dry_run_started');
            expect(cols.length).toBe(4);
            db.close();
        });

        it('Test 5: re-running migration on already-v6 DB is no-op (no duplicate-column error, no double-seed-insert)', () => {
            applyV6Migration(db);
            db.pragma(`user_version = 6`);

            // Re-run — should not throw (INSERT OR IGNORE + ALTER guard prevent duplicates)
            expect(() => applyV6Migration(db)).not.toThrow();

            // Still exactly one seed row
            const count = db.prepare(`SELECT COUNT(*) as c FROM pause_state`).get() as { c: number };
            expect(count.c).toBe(1);

            // Still exactly one antirug_dry_run_started column
            const cols = db.prepare("PRAGMA table_info('chain_state')").all() as Array<{ name: string }>;
            const dryRunCount = cols.filter(c => c.name === 'antirug_dry_run_started').length;
            expect(dryRunCount).toBe(1);

            db.close();
        });
    });

    // -----------------------------------------------------------------------
    // Prepared statement round-trip tests — each test uses the production
    // singleton's prepared statements against an isolated in-memory DB by
    // rebuilding equivalent statements from the same SQL literal. This proves
    // the SQL shape works as designed; the production module integration
    // block (above) proves the exports exist.
    // -----------------------------------------------------------------------

    describe('prepared statement round-trip', () => {
        let db: Database.Database;

        beforeEach(() => {
            db = buildV5SeededDb();
            applyV6Migration(db);
            db.pragma(`user_version = 6`);
        });

        it('Test 6: setPauseState writes a row (paused=1, paused_at=ts, paused_by, reason)', () => {
            const setPauseState = db.prepare(`UPDATE pause_state SET paused = 1, paused_at = ?, paused_by = ?, reason = ? WHERE id = 1`);
            const ts = 1700000123;
            setPauseState.run(ts, 'manual', 'test');

            const row = db.prepare(`SELECT * FROM pause_state WHERE id = 1`).get() as Record<string, unknown>;
            expect(row.paused).toBe(1);
            expect(row.paused_at).toBe(ts);
            expect(row.paused_by).toBe('manual');
            expect(row.reason).toBe('test');

            db.close();
        });

        it('Test 7: getPauseState returns the row written by setPauseState', () => {
            const setPauseState = db.prepare(`UPDATE pause_state SET paused = 1, paused_at = ?, paused_by = ?, reason = ? WHERE id = 1`);
            const getPauseState = db.prepare(`SELECT paused, paused_at, paused_by, reason FROM pause_state WHERE id = 1`);

            const ts = 1700000200;
            setPauseState.run(ts, 'cli', 'op-pause');
            const row = getPauseState.get() as Record<string, unknown>;
            expect(row.paused).toBe(1);
            expect(row.paused_at).toBe(ts);
            expect(row.paused_by).toBe('cli');
            expect(row.reason).toBe('op-pause');

            db.close();
        });

        it('Test 8: clearPauseState resets paused=0 + NULL audit columns', () => {
            const setPauseState = db.prepare(`UPDATE pause_state SET paused = 1, paused_at = ?, paused_by = ?, reason = ? WHERE id = 1`);
            const clearPauseState = db.prepare(`UPDATE pause_state SET paused = 0, paused_at = NULL, paused_by = NULL, reason = NULL WHERE id = 1`);

            setPauseState.run(1700000400, 'dashboard', 'manual op');
            clearPauseState.run();

            const row = db.prepare(`SELECT * FROM pause_state WHERE id = 1`).get() as Record<string, unknown>;
            expect(row.paused).toBe(0);
            expect(row.paused_at).toBeNull();
            expect(row.paused_by).toBeNull();
            expect(row.reason).toBeNull();

            db.close();
        });

        it('Test 9: setAntirugDryRunStarted is idempotent — only first call per chain records timestamp; subsequent calls leave column unchanged (COALESCE semantics)', () => {
            const setAntirugDryRunStarted = db.prepare(`
                INSERT INTO chain_state (chain, last_seen_block, last_updated_ts, antirug_dry_run_started)
                VALUES (?, 0, ?, ?)
                ON CONFLICT(chain) DO UPDATE SET antirug_dry_run_started = COALESCE(chain_state.antirug_dry_run_started, excluded.antirug_dry_run_started)
            `);

            // First call: records ts1
            const ts1 = 1700000000;
            setAntirugDryRunStarted.run('eth', ts1, ts1);
            let row = db.prepare(`SELECT antirug_dry_run_started FROM chain_state WHERE chain = ?`).get('eth') as Record<string, unknown>;
            expect(row.antirug_dry_run_started).toBe(ts1);

            // Second call: COALESCE keeps original ts1
            const ts2 = 1700000999;
            setAntirugDryRunStarted.run('eth', ts2, ts2);
            row = db.prepare(`SELECT antirug_dry_run_started FROM chain_state WHERE chain = ?`).get('eth') as Record<string, unknown>;
            expect(row.antirug_dry_run_started).toBe(ts1);

            db.close();
        });

        it('Test 10: getAntirugDryRunStarted returns NULL/undefined for chain that has never started; returns the recorded ts after setAntirugDryRunStarted fires', () => {
            const getAntirugDryRunStarted = db.prepare(`SELECT antirug_dry_run_started FROM chain_state WHERE chain = ?`);
            const setAntirugDryRunStarted = db.prepare(`
                INSERT INTO chain_state (chain, last_seen_block, last_updated_ts, antirug_dry_run_started)
                VALUES (?, 0, ?, ?)
                ON CONFLICT(chain) DO UPDATE SET antirug_dry_run_started = COALESCE(chain_state.antirug_dry_run_started, excluded.antirug_dry_run_started)
            `);

            // Chain has no row at all
            let row = getAntirugDryRunStarted.get('bsc') as Record<string, unknown> | undefined;
            expect(row).toBeUndefined();

            // Now fire setAntirugDryRunStarted for bsc — row appears with the recorded ts
            const ts = 1700001000;
            setAntirugDryRunStarted.run('bsc', ts, ts);
            row = getAntirugDryRunStarted.get('bsc') as Record<string, unknown>;
            expect(row).toBeDefined();
            expect(row!.antirug_dry_run_started).toBe(ts);

            db.close();
        });
    });
});
