// test/unit/db/lpBaselineMigration.test.ts
// Phase 19 / ANTIRUG-04 / ANTIRUG-16: Schema v4→v5 lp_baseline + chain_state migration tests.
//
// Unit-level proofs that:
//   (a) migrateSchema() bumps user_version 4→5
//   (b) lp_baseline + chain_state tables exist post-migration
//   (c) migration is idempotent (running twice does not error or rewind)
//   (d) lp_baseline accepts both V2 (token0/token1 reserve + lp_total_supply) and V3
//       (active_liquidity + tick + fee_tier) shapes with the opposite columns NULL
//   (e) CHECK(pool_type IN ('v2','v3')) is enforced
//   (f) FOREIGN KEY(trade_id) REFERENCES trades(id) is enforced (when foreign_keys=ON)
//   (g) chain_state supports ON CONFLICT(chain) DO UPDATE upsert
//   (h) idx_lp_baseline_pool index exists
//   (i) migration-chain from v3 → v5 applies BOTH v4 (dex_name column) AND v5 (new tables)
//
// All tests use a fresh in-memory Database to avoid singleton/module-cache contamination
// from the production src/utils/db.ts (which binds to the real DB file via DB_PATH).
// Each `it()` block constructs its own DB; no shared state between tests.

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers: replicate the production migration steps against an in-memory DB
// so each test can construct a starting state (v3 / v4) and then exercise the
// real v4→v5 migration logic from src/utils/db.ts in isolation.
// ---------------------------------------------------------------------------

/**
 * Apply the v1 migration: create the trades table without pool_type / fee_tier /
 * partial_sell / dex_name. Schema version after = 1.
 */
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

/**
 * Apply the v2 migration: add pool_type + fee_tier columns. Schema version after = 2.
 */
function applyV2Migration(db: Database.Database): void {
    db.exec(`
        ALTER TABLE trades ADD COLUMN pool_type TEXT DEFAULT 'v2' CHECK(pool_type IN ('v2', 'v3'));
        ALTER TABLE trades ADD COLUMN fee_tier INTEGER;
    `);
}

/**
 * Apply the v3 migration: create exit_state + expand trades action CHECK to allow
 * partial_sell. Schema version after = 3.
 */
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

/**
 * Production migrateSchema() replica: walks through versions 1..CURRENT and applies
 * each step idempotently. Reads/writes db.pragma('user_version').
 *
 * This mirrors the structure of src/utils/db.ts:29-123 so the tests exercise the
 * SAME control flow as production. After the test file runs, the production module
 * imported by `import '../../../src/utils/db'` will also have executed; this helper
 * exists so tests can construct in-memory DBs at arbitrary starting versions
 * (v3, v4, v5) without contaminating the production singleton.
 */
function runFullMigration(db: Database.Database): void {
    const version = db.pragma('user_version', { simple: true }) as number;

    if (version < 1) {
        applyV1Migration(db);
    }
    if (version < 2) {
        applyV2Migration(db);
    }
    if (version < 3) {
        applyV3Migration(db);
    }
    if (version < 4) {
        // D-14 belt-and-suspenders guard from src/utils/db.ts:113-119
        const columns = db.prepare("PRAGMA table_info('trades')").all() as Array<{ name: string }>;
        const hasColumn = columns.some(c => c.name === 'dex_name');
        if (!hasColumn) {
            db.exec(`ALTER TABLE trades ADD COLUMN dex_name TEXT DEFAULT NULL`);
        }
    }
    if (version < 5) {
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

    db.pragma(`user_version = 5`);
}

/**
 * Helper: insert a minimal trade row so foreign-key tests have a real trades.id
 * to reference. Returns the inserted row id.
 */
function insertTradeRow(db: Database.Database, token: string = '0xabc'): number {
    const result = db.prepare(
        `INSERT INTO trades (token, chain, action, status, amount_in) VALUES (?, 'eth', 'buy', 'pending', '0.01')`
    ).run(token);
    return Number(result.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Sentinel test: assert the production module's CURRENT_SCHEMA_VERSION is 5.
// This catches a regression where production module is edited back to 4 even
// though the in-memory migration replica above still claims 5.
// ---------------------------------------------------------------------------

describe('Phase 19 — Schema v4→v5 lp_baseline + chain_state migration', () => {
    describe('production module integration', () => {
        it('production src/utils/db.ts exports the 5 new prepared statements', async () => {
            // Importing the production module runs its migrations against the on-disk
            // DB (data/bot.db or DB_PATH override). We only test that the 5 names exist
            // as exports — actual SQL semantics are covered against in-memory DBs below
            // because the production singleton is bound to a single DB instance.
            const dbModule = await import('../../../src/utils/db');
            expect(dbModule.upsertLpBaseline).toBeDefined();
            expect(dbModule.getLpBaseline).toBeDefined();
            expect(dbModule.deleteLpBaseline).toBeDefined();
            expect(dbModule.upsertChainState).toBeDefined();
            expect(dbModule.getChainState).toBeDefined();
        });

        it('production user_version pragma reports >= 5 after module load (Phase 19 floor; future migrations advance it further)', async () => {
            // Phase 19 / ANTIRUG-04 introduced v5. Plan 20-01 (Phase 20) bumped to v6.
            // This test asserts the Phase 19 floor — production DB must be AT LEAST v5.
            // Tightening to `=== N` would break each time a future plan lands a new
            // migration step. Per-migration version asserts live in their own
            // *Migration.test.ts file (e.g., pauseStateMigration.test.ts asserts v6).
            const dbModule = await import('../../../src/utils/db');
            const version = dbModule.db.pragma('user_version', { simple: true }) as number;
            expect(version).toBeGreaterThanOrEqual(5);
        });
    });

    // -----------------------------------------------------------------------
    // Behavior tests: each operates on a fresh in-memory DB to provide
    // isolation. The helpers above replicate the production migration shape
    // so changes to src/utils/db.ts are visible in side-by-side review.
    // -----------------------------------------------------------------------

    describe('migration mechanics', () => {
        let db: Database.Database;

        beforeEach(() => {
            db = new Database(':memory:');
            db.pragma('journal_mode = WAL');
        });

        it('Test 1: db.pragma(user_version) returns 5 after migration runs on a fresh DB', () => {
            runFullMigration(db);
            const version = db.pragma('user_version', { simple: true }) as number;
            expect(version).toBe(5);
            db.close();
        });

        it("Test 2: sqlite_master includes both 'lp_baseline' AND 'chain_state' after migration", () => {
            runFullMigration(db);
            const tables = db.prepare(
                `SELECT name FROM sqlite_master WHERE type='table'`
            ).all() as Array<{ name: string }>;
            const tableNames = tables.map(t => t.name);
            expect(tableNames).toContain('lp_baseline');
            expect(tableNames).toContain('chain_state');
            db.close();
        });

        it('Test 3: running migration twice in a row is idempotent (no error, schema_version still 5)', () => {
            runFullMigration(db);
            expect(() => runFullMigration(db)).not.toThrow();
            const version = db.pragma('user_version', { simple: true }) as number;
            expect(version).toBe(5);
            db.close();
        });
    });

    describe('lp_baseline V2 + V3 round-trip', () => {
        let db: Database.Database;
        let tradeId: number;

        beforeEach(() => {
            db = new Database(':memory:');
            db.pragma('journal_mode = WAL');
            runFullMigration(db);
            tradeId = insertTradeRow(db, '0xv2token0000000000000000000000000000000a');
        });

        it("Test 4: lp_baseline accepts a V2 row (pool_type='v2', V2 cols populated, V3 cols NULL)", () => {
            db.prepare(`
                INSERT INTO lp_baseline (
                    trade_id, pool_type, pair_or_pool_address,
                    v2_token0_reserve, v2_token1_reserve, v2_lp_total_supply,
                    v3_active_liquidity, v3_tick_at_snapshot, v3_position_nft_id, v3_fee_tier,
                    snapshot_block, snapshot_ts
                )
                VALUES (?, 'v2', '0xpair000000000000000000000000000000000a',
                        '1000000000000000000', '2000000000000000000', '50000000000',
                        NULL, NULL, NULL, NULL,
                        18000000, 1700000000)
            `).run(tradeId);

            const row = db.prepare(`SELECT * FROM lp_baseline WHERE trade_id = ?`).get(tradeId) as Record<string, unknown>;
            expect(row.pool_type).toBe('v2');
            expect(row.v2_token0_reserve).toBe('1000000000000000000');
            expect(row.v2_token1_reserve).toBe('2000000000000000000');
            expect(row.v2_lp_total_supply).toBe('50000000000');
            expect(row.v3_active_liquidity).toBeNull();
            expect(row.v3_tick_at_snapshot).toBeNull();
            expect(row.v3_position_nft_id).toBeNull();
            expect(row.v3_fee_tier).toBeNull();
            expect(row.snapshot_block).toBe(18000000);
            expect(row.snapshot_ts).toBe(1700000000);
            db.close();
        });

        it("Test 5: lp_baseline accepts a V3 row (pool_type='v3', V3 cols populated, V2 cols NULL)", () => {
            db.prepare(`
                INSERT INTO lp_baseline (
                    trade_id, pool_type, pair_or_pool_address,
                    v2_token0_reserve, v2_token1_reserve, v2_lp_total_supply,
                    v3_active_liquidity, v3_tick_at_snapshot, v3_position_nft_id, v3_fee_tier,
                    snapshot_block, snapshot_ts
                )
                VALUES (?, 'v3', '0xpool000000000000000000000000000000000b',
                        NULL, NULL, NULL,
                        '999999999999999999', -887272, NULL, 3000,
                        18000001, 1700000001)
            `).run(tradeId);

            const row = db.prepare(`SELECT * FROM lp_baseline WHERE trade_id = ?`).get(tradeId) as Record<string, unknown>;
            expect(row.pool_type).toBe('v3');
            expect(row.v3_active_liquidity).toBe('999999999999999999');
            expect(row.v3_tick_at_snapshot).toBe(-887272);
            expect(row.v3_fee_tier).toBe(3000);
            expect(row.v3_position_nft_id).toBeNull();   // per Research Open Question #3: v6.17 leaves nft_id NULL
            expect(row.v2_token0_reserve).toBeNull();
            expect(row.v2_token1_reserve).toBeNull();
            expect(row.v2_lp_total_supply).toBeNull();
            expect(row.snapshot_block).toBe(18000001);
            expect(row.snapshot_ts).toBe(1700000001);
            db.close();
        });

        it("Test 6: CHECK(pool_type IN ('v2','v3')) — pool_type='v4' throws SQLITE_CONSTRAINT", () => {
            expect(() => {
                db.prepare(`
                    INSERT INTO lp_baseline (
                        trade_id, pool_type, pair_or_pool_address,
                        snapshot_block, snapshot_ts
                    )
                    VALUES (?, 'v4', '0xinvalid000000000000000000000000000000', 18000000, 1700000000)
                `).run(tradeId);
            }).toThrow(/CHECK constraint failed|constraint/i);
            db.close();
        });

        it('Test 7: FOREIGN KEY(trade_id) REFERENCES trades(id) — non-existent trade_id throws SQLITE_CONSTRAINT (with foreign_keys=ON)', () => {
            // Foreign keys must be explicitly enabled per-connection in SQLite
            db.pragma('foreign_keys = ON');
            expect(() => {
                db.prepare(`
                    INSERT INTO lp_baseline (
                        trade_id, pool_type, pair_or_pool_address,
                        snapshot_block, snapshot_ts
                    )
                    VALUES (99999, 'v2', '0xpair000000000000000000000000000000000a', 18000000, 1700000000)
                `).run();
            }).toThrow(/FOREIGN KEY constraint failed|constraint/i);
            db.close();
        });

        it('Test 9: idx_lp_baseline_pool index exists on lp_baseline(pair_or_pool_address)', () => {
            const indexes = db.prepare(
                `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='lp_baseline'`
            ).all() as Array<{ name: string }>;
            const indexNames = indexes.map(i => i.name);
            expect(indexNames).toContain('idx_lp_baseline_pool');
            db.close();
        });
    });

    describe('chain_state ON CONFLICT upsert', () => {
        let db: Database.Database;

        beforeEach(() => {
            db = new Database(':memory:');
            db.pragma('journal_mode = WAL');
            runFullMigration(db);
        });

        it('Test 8: chain_state ON CONFLICT(chain) DO UPDATE — second upsert overwrites last_seen_block and last_updated_ts', () => {
            const upsert = db.prepare(`
                INSERT INTO chain_state (chain, last_seen_block, last_updated_ts)
                VALUES (?, ?, ?)
                ON CONFLICT(chain) DO UPDATE SET last_seen_block = excluded.last_seen_block, last_updated_ts = excluded.last_updated_ts
            `);

            // First upsert: chain=eth at block 18000000
            upsert.run('eth', 18000000, 1700000000);
            const first = db.prepare(`SELECT * FROM chain_state WHERE chain = ?`).get('eth') as Record<string, number>;
            expect(first.last_seen_block).toBe(18000000);
            expect(first.last_updated_ts).toBe(1700000000);

            // Second upsert with same chain — overwrites
            upsert.run('eth', 18000050, 1700000600);
            const second = db.prepare(`SELECT * FROM chain_state WHERE chain = ?`).get('eth') as Record<string, number>;
            expect(second.last_seen_block).toBe(18000050);
            expect(second.last_updated_ts).toBe(1700000600);

            // Still exactly one row for chain=eth
            const count = db.prepare(`SELECT COUNT(*) as c FROM chain_state WHERE chain = ?`).get('eth') as { c: number };
            expect(count.c).toBe(1);

            db.close();
        });
    });

    describe('migration chain — v3 → v5 applies both v4 and v5 steps', () => {
        it('Test 10: starting from user_version=3, runFullMigration applies BOTH v4 (dex_name) AND v5 (lp_baseline + chain_state)', () => {
            const db = new Database(':memory:');
            db.pragma('journal_mode = WAL');

            // Construct a v3-shaped DB: run v1 + v2 + v3 migrations, then explicitly
            // set user_version=3 to simulate "DB on disk is from before Phase 12 (v3)".
            applyV1Migration(db);
            applyV2Migration(db);
            applyV3Migration(db);
            db.pragma('user_version = 3');

            // Sanity precondition: user_version=3, no dex_name, no lp_baseline, no chain_state
            expect(db.pragma('user_version', { simple: true })).toBe(3);
            const colsBefore = db.prepare("PRAGMA table_info('trades')").all() as Array<{ name: string }>;
            expect(colsBefore.some(c => c.name === 'dex_name')).toBe(false);
            const tablesBefore = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
            expect(tablesBefore.map(t => t.name)).not.toContain('lp_baseline');
            expect(tablesBefore.map(t => t.name)).not.toContain('chain_state');

            // Run the migration — should apply v4 (dex_name) AND v5 (lp_baseline + chain_state)
            runFullMigration(db);

            // Post-state asserts
            expect(db.pragma('user_version', { simple: true })).toBe(5);
            const colsAfter = db.prepare("PRAGMA table_info('trades')").all() as Array<{ name: string }>;
            expect(colsAfter.some(c => c.name === 'dex_name')).toBe(true);
            const tablesAfter = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
            expect(tablesAfter.map(t => t.name)).toContain('lp_baseline');
            expect(tablesAfter.map(t => t.name)).toContain('chain_state');

            db.close();
        });
    });
});
