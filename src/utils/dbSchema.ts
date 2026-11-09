// src/utils/dbSchema.ts
//
// Phase 22 plan 22-09 (D-24, operator-accepted NAC-06 judgment call): the bot's schema and its
// migrations, in one module shared by src/utils/db.ts and scripts/db-init.ts. The function
// below was moved out of db.ts unchanged except its signature line; the mechanical
// byte-identity check against the audit base lives in the plan (22-09 Task 2) and 22-29
// re-reviews it. Do not edit a moved line here without a schema-version decision.
import Database from 'better-sqlite3';
import { logger } from './logger';

export const CURRENT_SCHEMA_VERSION = 7;

export function migrateSchema(db: Database.Database): void {
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
