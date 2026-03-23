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
const CURRENT_SCHEMA_VERSION = 2;

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

    if (version < 2) {
        db.exec(`
            ALTER TABLE trades ADD COLUMN pool_type TEXT DEFAULT 'v2' CHECK(pool_type IN ('v2', 'v3'));
            ALTER TABLE trades ADD COLUMN fee_tier INTEGER;
        `);
        logger.info('Added pool_type and fee_tier columns (schema version 2)');
    }

    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
}

migrateSchema();

// --- JSON State Migration (D-07) ---
// Runs once at startup. Imports .bot-state.json into SQLite, renames to .bak.
// Idempotent: skips if DB already has trades data.

function migrateJsonState(): void {
    const jsonPath = path.join(process.cwd(), '.bot-state.json');
    if (!fs.existsSync(jsonPath)) return;

    // Skip if DB already has data (idempotent)
    const count = db.prepare('SELECT COUNT(*) as c FROM trades').get() as { c: number };
    if (count.c > 0) return;

    try {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        const state = JSON.parse(raw);

        const insert = db.prepare(`
            INSERT INTO trades (token, chain, action, tx_hash, timestamp, status)
            VALUES (?, 'mainnet', 'buy', ?, ?, ?)
        `);

        const validStatuses = new Set(['pending', 'sold', 'failed']);
        const importAll = db.transaction((sniped: Record<string, any>) => {
            for (const [token, info] of Object.entries(sniped)) {
                const typedInfo = info as { txHash?: string; timestamp?: number; status?: string };
                const status = validStatuses.has(typedInfo.status || '') ? typedInfo.status! : 'pending';
                insert.run(
                    token.toLowerCase(),
                    typedInfo.txHash || null,
                    typedInfo.timestamp ? Math.floor(typedInfo.timestamp / 1000) : Math.floor(Date.now() / 1000),
                    status
                );
            }
        });

        importAll(state.sniped || {});

        // Rename original file to .bak
        fs.renameSync(jsonPath, jsonPath + '.bak');
        logger.info({ migrated: Object.keys(state.sniped || {}).length }, 'Migrated .bot-state.json to SQLite');
    } catch (e) {
        // Corrupted JSON: log warning, do not block startup
        logger.warn({ err: e }, 'Failed to migrate .bot-state.json, file may be corrupted, skipping');
    }
}

migrateJsonState();

// --- Prepared Statements (cached for performance) ---

const insertTrade = db.prepare(`
    INSERT INTO trades (token, chain, action, tx_hash, block, timestamp, amount_in, amount_out, gas_cost, price_at_action, status, pool_type, fee_tier)
    VALUES (@token, @chain, @action, @txHash, @block, @timestamp, @amountIn, @amountOut, @gasCost, @priceAtAction, @status, @poolType, @feeTier)
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

// --- P&L Query (DB-04: computed on query, not stored) ---

const getPnLQuery = db.prepare(`
    SELECT
        b.token,
        b.chain,
        b.amount_in  AS buy_cost,
        b.gas_cost    AS buy_gas,
        s.amount_out  AS sell_revenue,
        s.gas_cost    AS sell_gas,
        CAST(COALESCE(s.amount_out, '0') AS REAL) - CAST(b.amount_in AS REAL)
            - CAST(COALESCE(b.gas_cost, '0') AS REAL) - CAST(COALESCE(s.gas_cost, '0') AS REAL)
            AS realized_pnl,
        b.timestamp   AS buy_time,
        s.timestamp   AS sell_time,
        b.pool_type,
        b.fee_tier
    FROM trades b
    LEFT JOIN trades s ON b.token = s.token AND s.action = 'sell'
    WHERE b.action = 'buy'
      AND (? IS NULL OR b.token = ?)
      AND (? IS NULL OR b.chain = ?)
      AND (? IS NULL OR b.timestamp >= ?)
      AND (? IS NULL OR b.timestamp <= ?)
    ORDER BY b.timestamp DESC
`);

export interface PnLResult {
    token: string;
    chain: string;
    buy_cost: string | null;
    buy_gas: string | null;
    sell_revenue: string | null;
    sell_gas: string | null;
    realized_pnl: number | null;
    buy_time: number;
    sell_time: number | null;
    pool_type: string;
    fee_tier: number | null;
}

export function getPnL(filters?: {
    token?: string;
    chain?: string;
    fromTimestamp?: number;
    toTimestamp?: number;
}): PnLResult[] {
    const token = filters?.token?.toLowerCase() ?? null;
    const chain = filters?.chain ?? null;
    const from = filters?.fromTimestamp ?? null;
    const to = filters?.toTimestamp ?? null;
    return getPnLQuery.all(token, token, chain, chain, from, from, to, to) as PnLResult[];
}

// --- Exports ---

export function closeDb(): void {
    db.close();
    logger.info('Database connection closed');
}

export { db, insertTrade, getTradesByToken, updateTradeStatus, isTokenSniped };
