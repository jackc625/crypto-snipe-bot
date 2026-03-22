// src/utils/db.ts
// SQLite database singleton with WAL mode, schema migrations, and prepared statements.
// Reads DB_PATH directly from process.env to avoid circular dependency with config.ts.
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'bot.db');

// Ensure data directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for concurrent reads during monitoring loops
db.pragma('journal_mode = WAL');
// synchronous = NORMAL is safe and fast for WAL mode
db.pragma('synchronous = NORMAL');
// Wait 5s for locks instead of failing immediately
db.pragma('busy_timeout = 5000');

// --- Schema Migration ---
const CURRENT_SCHEMA_VERSION = 1;

function migrateSchema(): void {
    const version = db.pragma('user_version', { simple: true }) as number;

    if (version < 1) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL COLLATE NOCASE,
                chain TEXT NOT NULL DEFAULT 'mainnet',
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
        logger.info('Created trades table (schema version 1)');
    }

    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
}

migrateSchema();

// --- Prepared Statements (cached for performance) ---

const insertTrade = db.prepare(`
    INSERT INTO trades (token, chain, action, tx_hash, block, timestamp, amount_in, amount_out, gas_cost, price_at_action, status)
    VALUES (@token, @chain, @action, @txHash, @block, @timestamp, @amountIn, @amountOut, @gasCost, @priceAtAction, @status)
`);

const getTradesByToken = db.prepare(`
    SELECT * FROM trades WHERE token = ? ORDER BY timestamp ASC
`);

const updateTradeStatus = db.prepare(`
    UPDATE trades SET status = ? WHERE token = ? AND status = 'pending'
`);

const isTokenSniped = db.prepare(`
    SELECT 1 FROM trades WHERE token = ? LIMIT 1
`);

// --- Exports ---

export function closeDb(): void {
    db.close();
    logger.info('Database connection closed');
}

export { db, insertTrade, getTradesByToken, updateTradeStatus, isTokenSniped };
