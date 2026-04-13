// test/helpers/testDb.ts
// In-memory SQLite factory for test isolation.
// Creates a fresh database with the full production schema (user_version=4).

import Database from 'better-sqlite3';

/**
 * Create a fresh in-memory SQLite database with the full production schema.
 * Each call returns an isolated DB instance -- no cross-test contamination.
 *
 * Schema matches src/utils/db.ts exactly:
 * - trades table with all columns (id, token, chain, action, tx_hash, block,
 *   timestamp, amount_in, amount_out, gas_cost, price_at_action, status,
 *   pool_type, fee_tier, dex_name)
 * - exit_state table with FOREIGN KEY to trades(id)
 * - All indexes
 * - user_version = 4
 */
export function createTestDb(): Database.Database {
    const db = new Database(':memory:');

    // Match production pragmas (WAL is issued for parity but :memory: uses journal_mode=memory)
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');

    // Create trades table (schema version 3 -- includes pool_type, fee_tier, partial_sell action)
    db.exec(`
        CREATE TABLE trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL COLLATE NOCASE,
            chain TEXT NOT NULL DEFAULT 'eth', -- Phase 15 / CHAIN-02: canonical chainRegistry identifier is 'eth', not 'mainnet'
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
            fee_tier INTEGER,
            dex_name TEXT DEFAULT NULL
        );
        CREATE INDEX idx_trades_token ON trades(token);
        CREATE INDEX idx_trades_chain ON trades(chain);
        CREATE INDEX idx_trades_timestamp ON trades(timestamp);
        CREATE INDEX idx_trades_status ON trades(status);
    `);

    // Create exit_state table (schema version 3)
    db.exec(`
        CREATE TABLE exit_state (
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
        CREATE INDEX idx_exit_state_trade ON exit_state(trade_id);
    `);

    // Set schema version to match production
    db.pragma('user_version = 4');

    return db;
}
