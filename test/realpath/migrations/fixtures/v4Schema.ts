// test/realpath/migrations/fixtures/v4Schema.ts
//
// Phase 23 plan 23-03 (CHAR-05, AC-05): a FROZEN historic version 4 database.
//
// This is the two-table schema body that test/helpers/testDb.ts hand-wrote until plan 23-03,
// copied unchanged from that file at 5b2168f before the helper was switched to the real
// migrations. It is frozen on purpose: it stands for a database that stopped at version 4, so it
// must NOT follow later migrations. Do not add the version 5, 6 or 7 tables or columns here, and
// do not "fix" its text. The golden test upgrades it with the real migrateSchema and checks that
// the result matches the recorded version 7 schema and that the rows seeded here survive.
//
// Its stored SQL text is not byte-identical to what the real migrations store for `trades`
// (it carries a `--` comment, and SQLite writes `"trades"` in quotes after the version 3
// rename), so the golden test compares stored SQL after removing whitespace, comments and
// identifier quotes. Every column, index, default, constraint and foreign key is compared as is.
//
// This file is the only hand-written schema left in the repo's test helpers, and it is a fixture
// of the past, not a model of the current schema (AC-07 concerns test/helpers/testDb.ts).

import type Database from 'better-sqlite3';

/** Apply the frozen version 4 schema to an empty connection and set user_version to 4. */
export function applyV4Schema(db: Database.Database): void {
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

    // Version 4: the frozen historic schema stops here.
    db.pragma('user_version = 4');
}
