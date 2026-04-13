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
const CURRENT_SCHEMA_VERSION = 4;

function migrateSchema(): void {
    const version = db.pragma('user_version', { simple: true }) as number;

    if (version < 1) {
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
        logger.info('Created trades table (schema version 1)');
    }

    if (version < 2) {
        db.exec(`
            ALTER TABLE trades ADD COLUMN pool_type TEXT DEFAULT 'v2' CHECK(pool_type IN ('v2', 'v3'));
            ALTER TABLE trades ADD COLUMN fee_tier INTEGER;
        `);
        logger.info('Added pool_type and fee_tier columns (schema version 2)');
    }

    if (version < 3) {
        // Phase 7: exit_state table for smart exit strategy persistence (D-23, D-24)
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

        // Expand trades action CHECK to allow 'partial_sell' (D-10)
        // SQLite cannot ALTER CHECK constraints, so recreate table
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

        logger.info('Created exit_state table and expanded trades action CHECK (schema version 3)');
    }

    if (version < 4) {
        // D-14: Belt-and-suspenders column-existence guard
        const columns = db.prepare("PRAGMA table_info('trades')").all() as Array<{ name: string }>;
        const hasColumn = columns.some(c => c.name === 'dex_name');
        if (!hasColumn) {
            db.exec(`ALTER TABLE trades ADD COLUMN dex_name TEXT DEFAULT NULL`);
        }
        logger.info('Added dex_name column (schema version 4)');
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

        // Historical: the pre-Phase-4 JSON state file had no chain field because
        // the bot was single-chain ETH. Rows imported here are stamped 'mainnet'
        // for historical fidelity; normalizeLegacyMainnetRows() immediately
        // rewrites them to 'eth' (the canonical runtime identifier from
        // chainRegistry.ts) on the next line below migrateJsonState().
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

// --- Legacy Chain Identifier Normalization (Phase 15, CHAIN-02, D-A1) ---
//
// Pre-Phase-4 ETH trades were stored with chain='mainnet' (the old default
// and the hardcoded literal in migrateJsonState). The runtime identifier
// from chainRegistry.ts is 'eth' for the Ethereum chain. After Phase 15
// adds `WHERE chain = ?` to isTokenSniped, a WHERE clause that binds 'eth'
// would silently miss legacy rows stamped 'mainnet' — causing the bot to
// re-snipe already-sniped ETH tokens.
//
// This helper is idempotent: once all rows are 'eth', subsequent runs
// update zero rows. Safe to call on every module load.
//
// Scope is deliberately narrow: only the exact literal 'mainnet' is
// rewritten to 'eth'. Other chain identifiers ('bsc', 'base', 'arb') are
// untouched.
export function normalizeLegacyMainnetRows(database: Database.Database = db): void {
    const result = database.prepare(
        `UPDATE trades SET chain = 'eth' WHERE chain = 'mainnet'`
    ).run();
    if (result.changes > 0) {
        logger.info(
            { rowsNormalized: result.changes },
            'Normalized legacy mainnet → eth chain identifiers in trades table'
        );
    }
}

migrateJsonState();
normalizeLegacyMainnetRows();

// --- Prepared Statements (cached for performance) ---

const insertTrade = db.prepare(`
    INSERT INTO trades (token, chain, action, tx_hash, block, timestamp, amount_in, amount_out, gas_cost, price_at_action, status, pool_type, fee_tier, dex_name)
    VALUES (@token, @chain, @action, @txHash, @block, @timestamp, @amountIn, @amountOut, @gasCost, @priceAtAction, @status, @poolType, @feeTier, @dexName)
`);

const getTradesByToken = db.prepare(`
    SELECT * FROM trades WHERE token = ? AND chain = ? ORDER BY timestamp ASC
`);

const updateTradeStatus = db.prepare(`
    UPDATE trades SET status = ? WHERE token = ? AND chain = ? AND status = 'pending'
`);

/**
 * Factory for the chain-scoped `isTokenSniped` prepared statement.
 *
 * Exported so unit tests can build an equivalent statement against a fresh
 * in-memory DB and exercise the EXACT same SQL literal as production. Without
 * this factory, tests would have to either (a) import the production singleton
 * (which is bound to the real DB file via DB_PATH) or (b) copy the SQL into
 * the test file — the latter being what Gemini/Codex flagged in Phase 15
 * review as "testing the map, not the territory".
 *
 * Phase 15 / CHAIN-02 / INT-DEDUP-NO-CHAIN.
 */
export function makeIsTokenSnipedStmt(database: Database.Database): Database.Statement {
    return database.prepare(`
        SELECT 1 FROM trades WHERE token = ? AND chain = ? LIMIT 1
    `);
}

const isTokenSniped = makeIsTokenSnipedStmt(db);

// --- P&L Query (DB-04: computed on query, not stored) ---

const getPnLQuery = db.prepare(`
    SELECT
        b.id          AS buy_id,
        b.token,
        b.chain,
        b.amount_in   AS buy_cost,
        b.gas_cost    AS buy_gas,
        COALESCE(SUM(CAST(COALESCE(s.amount_out, '0') AS REAL)), 0) AS sell_revenue,
        COALESCE(SUM(CAST(COALESCE(s.gas_cost, '0') AS REAL)), 0)   AS sell_gas,
        COALESCE(SUM(CAST(COALESCE(s.amount_out, '0') AS REAL)), 0)
            - CAST(b.amount_in AS REAL)
            - CAST(COALESCE(b.gas_cost, '0') AS REAL)
            - COALESCE(SUM(CAST(COALESCE(s.gas_cost, '0') AS REAL)), 0)
            AS realized_pnl,
        b.timestamp   AS buy_time,
        MAX(s.timestamp) AS sell_time,
        COUNT(s.id)   AS sell_count,
        b.pool_type,
        b.fee_tier,
        b.dex_name,
        b.status      AS buy_status
    FROM trades b
    LEFT JOIN trades s ON b.token = s.token
                       AND b.chain = s.chain
                       AND s.action IN ('sell', 'partial_sell')
                       AND s.timestamp >= b.timestamp
    WHERE b.action = 'buy'
      AND (? IS NULL OR b.token = ?)
      AND (? IS NULL OR b.chain = ?)
      AND (? IS NULL OR b.timestamp >= ?)
      AND (? IS NULL OR b.timestamp <= ?)
    GROUP BY b.id
    ORDER BY b.timestamp DESC
`);

export interface PnLResult {
    buy_id: number;
    token: string;
    chain: string;
    buy_cost: string | null;
    buy_gas: string | null;
    sell_revenue: number;       // Aggregated SUM, always a number (0 when no sells)
    sell_gas: number;           // Aggregated SUM, always a number
    realized_pnl: number;      // Always a number (negative when no sells = -(buy_cost + buy_gas))
    buy_time: number;
    sell_time: number | null;
    sell_count: number;         // D-02: count of sell + partial_sell events
    pool_type: string;
    fee_tier: number | null;
    dex_name: string | null;    // DEX identity for multi-dex resolution (Phase 12)
    buy_status: string;         // 'pending' | 'sold' | 'failed' -- for open/closed detection
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

// --- Risk Management Prepared Statements ---

// RISK-03: Count open positions across all chains (D-10)
const getOpenPositionCount = db.prepare(
    `SELECT COUNT(*) AS count FROM trades WHERE status = 'pending' AND action = 'buy'`
);

// RISK-05: Total deployed capital across all chains (D-11) -- subtracts partial sell proceeds (Phase 10 D-04)
const getTotalExposure = db.prepare(`
    SELECT COALESCE(SUM(
        CAST(b.amount_in AS REAL)
        - COALESCE((
            SELECT SUM(CAST(COALESCE(ps.amount_out, '0') AS REAL))
            FROM trades ps
            WHERE ps.token = b.token
              AND ps.chain = b.chain
              AND ps.action = 'partial_sell'
        ), 0)
    ), 0) AS total
    FROM trades b
    WHERE b.status = 'pending' AND b.action = 'buy'
`);

// D-03: Deployed capital for a specific chain -- subtracts partial sell proceeds (Phase 10 D-04)
const getDeployedCapitalByChain = db.prepare(`
    SELECT COALESCE(SUM(
        CAST(b.amount_in AS REAL)
        - COALESCE((
            SELECT SUM(CAST(COALESCE(ps.amount_out, '0') AS REAL))
            FROM trades ps
            WHERE ps.token = b.token
              AND ps.chain = b.chain
              AND ps.action = 'partial_sell'
        ), 0)
    ), 0) AS deployed
    FROM trades b
    WHERE b.status = 'pending' AND b.action = 'buy' AND b.chain = ?
`);

// RISK-02: Realized losses in rolling 24h window for a chain -- includes partial_sell events (Phase 10 D-05)
const getDailyRealizedLoss = db.prepare(`
    SELECT COALESCE(SUM(
        CAST(COALESCE(s.amount_out, '0') AS REAL)
        - CAST(b.amount_in AS REAL)
        - CAST(COALESCE(b.gas_cost, '0') AS REAL)
        - CAST(COALESCE(s.gas_cost, '0') AS REAL)
    ), 0) AS total_loss
    FROM trades b
    INNER JOIN trades s ON b.token = s.token AND b.chain = s.chain AND s.action IN ('sell', 'partial_sell') AND s.timestamp >= b.timestamp
    WHERE b.action = 'buy'
      AND b.chain = ?
      AND s.timestamp >= ?
      AND (
          CAST(COALESCE(s.amount_out, '0') AS REAL)
          - CAST(b.amount_in AS REAL)
          - CAST(COALESCE(b.gas_cost, '0') AS REAL)
          - CAST(COALESCE(s.gas_cost, '0') AS REAL)
      ) < 0
`);

// --- Per-Event P&L Chart Data (Phase 10 D-07) ---

const getPnLChartDataQuery = db.prepare(`
    SELECT
        s.timestamp   AS sell_time,
        s.token,
        s.chain,
        s.action      AS sell_action,
        CAST(COALESCE(s.amount_out, '0') AS REAL) AS sell_revenue,
        CAST(COALESCE(s.gas_cost, '0') AS REAL)   AS sell_gas,
        CAST(b.amount_in AS REAL)                  AS buy_cost,
        CAST(COALESCE(b.gas_cost, '0') AS REAL)   AS buy_gas,
        (SELECT COUNT(*) FROM trades t
         WHERE t.token = b.token AND t.chain = b.chain
           AND t.action IN ('sell', 'partial_sell')
           AND t.timestamp >= b.timestamp) AS total_sells
    FROM trades s
    INNER JOIN trades b ON s.token = b.token
                        AND s.chain = b.chain
                        AND b.action = 'buy'
                        AND s.timestamp >= b.timestamp
    WHERE s.action IN ('sell', 'partial_sell')
      AND (? IS NULL OR s.timestamp >= ?)
    ORDER BY s.timestamp ASC
`);

export interface PnLChartDataRow {
    sell_time: number;
    token: string;
    chain: string;
    sell_action: string;
    sell_revenue: number;
    sell_gas: number;
    buy_cost: number;
    buy_gas: number;
    total_sells: number;
}

export function getPnLChartData(fromTimestamp?: number): PnLChartDataRow[] {
    const from = fromTimestamp ?? null;
    return getPnLChartDataQuery.all(from, from) as PnLChartDataRow[];
}

// --- Exit State Prepared Statements (Phase 7) ---
const upsertExitState = db.prepare(`
    INSERT INTO exit_state (trade_id, entry_price, high_water_mark, trailing_activated, partial_tiers_completed, original_token_amount, urgency_start_ts, volatility_samples)
    VALUES (@tradeId, @entryPrice, @highWaterMark, @trailingActivated, @partialTiersCompleted, @originalTokenAmount, @urgencyStartTs, @volatilitySamples)
    ON CONFLICT(trade_id) DO UPDATE SET
        high_water_mark = @highWaterMark,
        trailing_activated = @trailingActivated,
        partial_tiers_completed = @partialTiersCompleted,
        volatility_samples = @volatilitySamples
`);

const getExitState = db.prepare(`SELECT * FROM exit_state WHERE trade_id = ?`);

const deleteExitState = db.prepare(`DELETE FROM exit_state WHERE trade_id = ?`);

const getTradeIdForPendingToken = db.prepare(
    `SELECT id FROM trades WHERE token = ? AND chain = ? AND status = 'pending' AND action = 'buy' ORDER BY timestamp DESC LIMIT 1`
);

// --- Exports ---

export function closeDb(): void {
    db.close();
    logger.info('Database connection closed');
}

export { db, insertTrade, updateTradeStatus, isTokenSniped, getOpenPositionCount, getTotalExposure, getDailyRealizedLoss, upsertExitState, getExitState, deleteExitState, getTradeIdForPendingToken };
