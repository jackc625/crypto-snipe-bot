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
const CURRENT_SCHEMA_VERSION = 7;

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

    if (version < 5) {
        // Phase 19 / ANTIRUG-04 / ANTIRUG-16: lp_baseline (LP-reserve / V3-active-liquidity
        // snapshot at buy-success per trade) + chain_state (last-seen-block per chain for
        // restart-time getLogs backfill per D-BACKFILL). Single-table-with-pool_type-
        // discriminator shape chosen per Research Open Question #1 + CONTEXT.md
        // D-V3-THRESHOLD. v3_position_nft_id stays NULLABLE — V3 baseline is pool-only
        // in v6.17; NFT-tracking deferred to v6.18+.
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
        logger.info('Created lp_baseline + chain_state tables (schema version 5)');
    }

    if (version < 6) {
        // Phase 20 / Plan 20-01 / OPS-LIVE-09 + D-PAUSE-STORAGE + D-ANTIRUG-LIVE-GATE-CODE.
        // Adds two operationally-critical surfaces atomically:
        //   (a) pause_state — single-row table (CHECK(id=1)) tracking the operator
        //       kill-switch flag, audit-columned (paused_at, paused_by, reason) so
        //       restart preserves the pause state per OPS-LIVE-09 + D-PAUSED-RESTART.
        //       paused_by sentinel values: 'dashboard' / 'cli' / 'preflight' / 'manual'.
        //   (b) chain_state.antirug_dry_run_started — INTEGER column added via
        //       PRAGMA-guarded ALTER (defense-in-depth) recording the first-ever
        //       dry-run timestamp per chain. The 7-day live-gate floor per
        //       D-ANTIRUG-LIVE-GATE-CODE checks this column.
        //
        // DDL wrapped in db.transaction() for atomicity (RESEARCH §1 + A1) — if any
        // statement fails, the whole migration rolls back so the bot never sees a
        // partial v5.5 state. INSERT OR IGNORE + ALTER guard make re-runs no-ops.
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

            // ALTER guard — clone v3→v4 pattern at db.ts:113-119. If the column already
            // exists (e.g. partial-rerun after a prior crash mid-transaction), skip the ALTER.
            const columns = db.prepare("PRAGMA table_info('chain_state')").all() as Array<{ name: string }>;
            const hasColumn = columns.some(c => c.name === 'antirug_dry_run_started');
            if (!hasColumn) {
                db.exec(`ALTER TABLE chain_state ADD COLUMN antirug_dry_run_started INTEGER`);
            }
        })();
        logger.info('Created pause_state table + antirug_dry_run_started column (schema version 6)');
    }

    if (version < 7) {
        // Phase 21.2 / Plan 21.2-03 / STOP-THE-LINE-04-D / D-PERSIST-FAILED-HELD.
        //
        // Persist a still-held FAILED exit so it survives restart. On a failed exit
        // of a still-held position (on-chain balanceOf > dust) the exit engine must
        // NOT delete exit_state; it marks a distinct status `exit_failed_held`
        // (separate from `sold` and from `failed`=dead) and bumps a persisted
        // failure counter (`exit_failure_count`) that drives the bounded-routine-retry
        // logic. On restart, `exit_failed_held` rows re-enter monitoring +
        // re-register anti-rug (the write path lands in 21.2-07; the fork
        // restart-resume proof lands in 21.2-10).
        //
        // RESEARCH A9 + Runtime State Inventory: the new status + counter live on
        // `exit_state` (the monitoring-lifecycle table, already keyed by trade_id) —
        // the ADDITIVE ALTER-guard path (clone of the v5.5/v6 idiom at :185-189),
        // explicitly chosen OVER recreating the trades.status CHECK constraint.
        // SQLite cannot ALTER a CHECK, so that path is the heavy recreate-table-copy
        // pattern (:83-107) which would risk the trades table; the additive ALTER on
        // exit_state is both lighter AND safer (D-QUALITY-FIRST: chosen for safety,
        // not for fewer lines).
        //
        // DDL wrapped in db.transaction() for atomicity (RESEARCH §1 + A1) — if the
        // second ALTER fails, the first rolls back so the bot never sees a partial v7
        // state. The PRAGMA table_info guard makes re-runs no-ops (idempotent): if
        // exit_failure_count already exists (partial-rerun after a prior crash
        // mid-transaction, or a re-open), both ALTERs are skipped together. The two
        // columns are always added as a pair, so guarding on the first is sufficient.
        db.transaction(() => {
            const columns = db.prepare("PRAGMA table_info('exit_state')").all() as Array<{ name: string }>;
            const hasCol = columns.some(c => c.name === 'exit_failure_count');
            if (!hasCol) {
                db.exec(`ALTER TABLE exit_state ADD COLUMN exit_failure_count INTEGER NOT NULL DEFAULT 0`);
                db.exec(`ALTER TABLE exit_state ADD COLUMN exit_status TEXT`);   // 'exit_failed_held' marker
            }
        })();
        logger.info('Added exit_failure_count + exit_status columns to exit_state (schema version 7)');
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

// getExitState returns the FULL row including the v7 columns (exit_failure_count +
// exit_status). The restart-resume path (21.2-10) reads exit_status to decide
// whether a row re-enters monitoring as a still-held failed exit.
const getExitState = db.prepare(`SELECT * FROM exit_state WHERE trade_id = ?`);

// --- Failed-Held Exit Persistence (Phase 21.2 / Plan 21.2-03 / D-PERSIST-FAILED-HELD) ---
//
// markExitFailedHeld: on a failed exit of a STILL-HELD position (on-chain
// balanceOf > dust), the exit engine (21.2-07) calls this INSTEAD of
// deleteExitState. It stamps the distinct lifecycle status `exit_failed_held`
// (separate from `sold` and from `trades.status='failed'`=dead) and atomically
// increments the persisted consecutive-failure counter. The counter drives the
// bounded-routine-retry logic (default N=5 → pause routine retries + hard-alert;
// anti-rug emergency exits still fire). On restart, getExitState surfaces
// exit_status so the row re-enters monitoring + re-registers anti-rug.
//
// `exit_failure_count + 1` reads the persisted column inside the UPDATE so the
// count is monotonic across process restarts (it is NOT reset by a reboot — that
// is the whole point of persisting it). A successful close calls deleteExitState,
// which removes the row (and thus the counter) entirely; on a fresh re-buy a new
// exit_state row starts the counter back at the DEFAULT 0.
//
// The status string literal MUST stay exactly 'exit_failed_held' — it is the
// shared contract with the consumer in 21.2-07 and the fork restart-resume test
// in 21.2-10.
const markExitFailedHeld = db.prepare(`
    UPDATE exit_state
    SET exit_status = 'exit_failed_held',
        exit_failure_count = exit_failure_count + 1
    WHERE trade_id = ?
`);

const deleteExitState = db.prepare(`DELETE FROM exit_state WHERE trade_id = ?`);

const getTradeIdForPendingToken = db.prepare(
    `SELECT id FROM trades WHERE token = ? AND chain = ? AND status = 'pending' AND action = 'buy' ORDER BY timestamp DESC LIMIT 1`
);

// WR-06: cached prepared statement for src/preflight.ts checkStaleData scan.
// Previously the statement was rebuilt inside checkStaleData on every call,
// bypassing the prepared-statement caching pattern used everywhere else here.
// One-shot scan today; setInterval-driven by a future phase (the comment at
// preflight.ts:482 already hints). Hoisting now keeps the SQL literal under
// the same test surface as the other cached statements and surfaces SQL syntax
// errors at module load instead of first call.
const getStaleTradesQuery = db.prepare(
    `SELECT id, token, chain, timestamp FROM trades WHERE status = 'pending' AND action = 'buy' AND timestamp < ?`
);

// --- Anti-Rug Prepared Statements (Phase 19 / ANTIRUG-04 / ANTIRUG-16) ---
//
// upsertLpBaseline: insert or refresh the LP-baseline snapshot for a trade.
// Called from src/anti-rug/lpBaseline.ts (Plan 19-03) on buy-success. Named bind
// parameters match better-sqlite3 v12.8 convention used by upsertExitState above.
// V2 callers populate v2_* columns and set v3_* to null; V3 callers do the inverse.
// On conflict (re-snapshot during resume / partial replay), V2 reserve fields and
// V3 active-liquidity / tick fields are refreshed alongside the new snapshot block
// + ts; pair_or_pool_address and pool_type are immutable per row (set on first insert).
const upsertLpBaseline = db.prepare(`
    INSERT INTO lp_baseline (
        trade_id, pool_type, pair_or_pool_address,
        v2_token0_reserve, v2_token1_reserve, v2_lp_total_supply,
        v3_active_liquidity, v3_tick_at_snapshot, v3_position_nft_id, v3_fee_tier,
        snapshot_block, snapshot_ts
    )
    VALUES (
        @tradeId, @poolType, @pairOrPoolAddress,
        @v2Token0Reserve, @v2Token1Reserve, @v2LpTotalSupply,
        @v3ActiveLiquidity, @v3TickAtSnapshot, @v3PositionNftId, @v3FeeTier,
        @snapshotBlock, @snapshotTs
    )
    ON CONFLICT(trade_id) DO UPDATE SET
        v2_token0_reserve = @v2Token0Reserve,
        v2_token1_reserve = @v2Token1Reserve,
        v2_lp_total_supply = @v2LpTotalSupply,
        v3_active_liquidity = @v3ActiveLiquidity,
        v3_tick_at_snapshot = @v3TickAtSnapshot,
        snapshot_block = @snapshotBlock,
        snapshot_ts = @snapshotTs
`);

const getLpBaseline = db.prepare(`SELECT * FROM lp_baseline WHERE trade_id = ?`);

const deleteLpBaseline = db.prepare(`DELETE FROM lp_baseline WHERE trade_id = ?`);

// chain_state: per-chain last-seen block for restart-time getLogs(lastSeen+1, current)
// backfill per CONTEXT.md D-BACKFILL. Consumed by src/anti-rug/detector.ts (Plan 19-04)
// on every confirmed event processed and on restart resume. Positional binds used to
// stay symmetric with the simple two-column row shape.
const upsertChainState = db.prepare(`
    INSERT INTO chain_state (chain, last_seen_block, last_updated_ts)
    VALUES (?, ?, ?)
    ON CONFLICT(chain) DO UPDATE SET
        last_seen_block = excluded.last_seen_block,
        last_updated_ts = excluded.last_updated_ts
`);

const getChainState = db.prepare(`SELECT last_seen_block, last_updated_ts FROM chain_state WHERE chain = ?`);

// --- Pause-State Prepared Statements (Phase 20 / Plan 20-01 / OPS-LIVE-09 / D-PAUSE-STORAGE) ---
//
// Single-row pause_state table; CHECK(id=1) guarantees the row is always at id=1
// and the v6 migration seeds it on first boot (INSERT OR IGNORE), so the SELECT
// here always returns a row — readers never need to handle null.
//
// Consumers (Plans 20-02 / 20-04 / 20-05 / 20-07 / 20-08):
//   - getPauseState: kill-switch checkpoints + dashboard read + startMultiChainBot
//                    boot-time pause replay (D-PAUSED-RESTART) read.
//   - setPauseState: dashboard pause endpoint + CLI pause script + preflight wallet
//                    undercut handler (paused_by sentinel values:
//                    'dashboard' / 'cli' / 'preflight' / 'manual').
//   - clearPauseState: dashboard resume + CLI resume.
const getPauseState = db.prepare(`SELECT paused, paused_at, paused_by, reason FROM pause_state WHERE id = 1`);
const setPauseState = db.prepare(`UPDATE pause_state SET paused = 1, paused_at = ?, paused_by = ?, reason = ? WHERE id = 1`);
const clearPauseState = db.prepare(`UPDATE pause_state SET paused = 0, paused_at = NULL, paused_by = NULL, reason = NULL WHERE id = 1`);

// --- Anti-Rug Dry-Run Gate (Phase 20 / Plan 20-01 / D-ANTIRUG-LIVE-GATE-CODE) ---
//
// setAntirugDryRunStarted is intentionally idempotent: ONLY the first call per
// chain records the timestamp. Subsequent calls preserve the original ts via
// COALESCE(chain_state.antirug_dry_run_started, excluded.antirug_dry_run_started).
// This guarantees the 7-day live-gate floor is measured from the operator's
// real first-ever dry-run boot, not from the most recent restart.
//
// Three positional binds: (chain, now-unix-ts as last_updated_ts, now-unix-ts as
// antirug_dry_run_started). When chain row already exists, last_updated_ts may
// also need refresh elsewhere — this statement is scoped to the dry-run-start
// signal only. last_seen_block defaults to 0 on first insert (the anti-rug
// detector will overwrite via upsertChainState on first event).
const setAntirugDryRunStarted = db.prepare(`
    INSERT INTO chain_state (chain, last_seen_block, last_updated_ts, antirug_dry_run_started)
    VALUES (?, 0, ?, ?)
    ON CONFLICT(chain) DO UPDATE SET
        antirug_dry_run_started = COALESCE(chain_state.antirug_dry_run_started, excluded.antirug_dry_run_started)
`);

const getAntirugDryRunStarted = db.prepare(`SELECT antirug_dry_run_started FROM chain_state WHERE chain = ?`);

// --- Exports ---

export function closeDb(): void {
    db.close();
    logger.info('Database connection closed');
}

/**
 * CR-04 fix: force a WAL fsync after kill-switch state mutations.
 *
 * The connection is configured `synchronous = NORMAL` (line 22) for throughput,
 * which means SQLite does NOT fsync the WAL on every commit — a "committed"
 * transaction can be lost on SIGKILL within the WAL-flush window. For most
 * data that is acceptable; for the pause/resume kill-switch it is NOT — the
 * D-PAUSED-RESTART contract per docs/operations/going-live.md and Plan 20-01
 * promises that a pause flag survives SIGKILL + restart.
 *
 * Call this AFTER setPauseState.run(...) or clearPauseState.run(...) to force
 * the WAL contents into the main DB file via a FULL checkpoint, giving the
 * single-write fsync the kill-switch contract requires. The performance cost
 * is one extra fsync per pause/resume — pause/resume are infrequent operator
 * actions, so the cost is amortized away.
 *
 * Implementation note: db.pragma('wal_checkpoint(FULL)') returns a row that
 * we deliberately ignore — the checkpoint succeeding is the durability
 * signal; the (busy, log, checkpointed) tuple is purely diagnostic.
 */
export function forceWalCheckpoint(): void {
    db.pragma('wal_checkpoint(FULL)');
}

export {
    db,
    insertTrade,
    updateTradeStatus,
    isTokenSniped,
    getOpenPositionCount,
    getTotalExposure,
    getDailyRealizedLoss,
    upsertExitState,
    getExitState,
    // Phase 21.2 / Plan 21.2-03 / D-PERSIST-FAILED-HELD
    markExitFailedHeld,
    deleteExitState,
    getTradeIdForPendingToken,
    // WR-06: cached query for preflight checkStaleData
    getStaleTradesQuery,
    // Phase 19 / ANTIRUG-04 / ANTIRUG-16
    upsertLpBaseline,
    getLpBaseline,
    deleteLpBaseline,
    upsertChainState,
    getChainState,
    // Phase 20 / Plan 20-01 / OPS-LIVE-09 / D-PAUSE-STORAGE + D-ANTIRUG-LIVE-GATE-CODE
    getPauseState,
    setPauseState,
    clearPauseState,
    setAntirugDryRunStarted,
    getAntirugDryRunStarted,
};
