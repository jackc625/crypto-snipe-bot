// test/realpath/migrations/migrations.golden.test.ts
//
// Phase 23 plan 23-03 (CHAR-05, AC-04, AC-05, AC-06): golden tests over the REAL migrations.
//
// Each test runs src/utils/dbSchema.ts migrateSchema itself (never a mirror of it) on an
// in-memory database and compares the result with fixtures/schema-v7.json, which was generated
// once from the real migration on an empty database and committed. migrateSchema and
// CURRENT_SCHEMA_VERSION are imported from dbSchema.ts, not db.ts, because db.ts opens a
// connection at import.
//
// What is compared, per table (describeSchema below):
//   - PRAGMA table_xinfo (table_info plus hidden and generated columns): name, type, notnull,
//     default, primary key position
//   - PRAGMA index_list, plus each index's index_xinfo (key and auxiliary columns, collation,
//     descending order, expression columns) and its stored SQL
//   - PRAGMA foreign_key_list
//   - the table's stored SQL
// and any view or trigger in the schema. Stored SQL is compared after removing whitespace,
// `--` and `/* */` comments outside string literals, and double quotes around a plain identifier
// (RESEARCH Pitfall 9). These are the only differences between the two upgrade paths, measured
// at 5b2168f: `ALTER TABLE ... ADD COLUMN` writes `fee_tier INTEGER\n , dex_name` where a fresh
// table writes `fee_tier INTEGER,\n dex_name`; the version 3 table rebuild leaves SQLite's
// RENAME writing `CREATE TABLE "trades"` in quotes; and the frozen version 4 fixture carries a
// `--` comment. Everything inside a string literal (CHECK lists, defaults) is compared as is.
//
// The better-sqlite3 handle is always named `db` (the spawn gate accepts `.exec()` only on named
// receivers).

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, migrateSchema } from '../../../src/utils/dbSchema';
import { applyV4Schema } from './fixtures/v4Schema';

const RECORDING = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'schema-v7.json');

type Row = Record<string, unknown>;

interface IndexDescription {
    name: string;
    unique: number;
    origin: string;
    partial: number;
    sql: string | null;
    columns: Row[];
}

interface TableDescription {
    sql: string | null;
    columns: Row[];
    indexes: IndexDescription[];
    foreign_keys: Row[];
}

interface SchemaDescription {
    user_version: number;
    tables: Record<string, TableDescription>;
    other_objects: Row[];
}

/**
 * Stored SQL with the text SQLite or a hand-written statement may carry without changing the
 * schema removed: whitespace, comments, and double quotes around a plain identifier. String
 * literals are copied unchanged, so a changed CHECK list or default still differs.
 */
function normalizeSql(sql: string | null): string | null {
    if (sql === null) return null;
    let out = '';
    let i = 0;
    while (i < sql.length) {
        const c = sql[i];
        if (c === "'") {
            let j = i + 1;
            while (j < sql.length) {
                if (sql[j] === "'") {
                    if (sql[j + 1] === "'") {
                        j += 2;
                        continue;
                    }
                    break;
                }
                j += 1;
            }
            if (j >= sql.length) throw new Error(`normalizeSql: unterminated string literal in ${JSON.stringify(sql)}`);
            out += sql.slice(i, j + 1);
            i = j + 1;
            continue;
        }
        if (c === '-' && sql[i + 1] === '-') {
            const nl = sql.indexOf('\n', i);
            i = nl === -1 ? sql.length : nl;
            continue;
        }
        if (c === '/' && sql[i + 1] === '*') {
            const end = sql.indexOf('*/', i + 2);
            if (end === -1) throw new Error(`normalizeSql: unterminated comment in ${JSON.stringify(sql)}`);
            i = end + 2;
            continue;
        }
        if (c === '"') {
            const end = sql.indexOf('"', i + 1);
            if (end === -1) throw new Error(`normalizeSql: unterminated quoted identifier in ${JSON.stringify(sql)}`);
            const ident = sql.slice(i + 1, end);
            // A plain name loses its quotes; any other quoted identifier is kept verbatim.
            out += /^[A-Za-z_][A-Za-z0-9_]*$/.test(ident) ? ident : sql.slice(i, end + 1);
            i = end + 1;
            continue;
        }
        if (/\s/.test(c)) {
            i += 1;
            continue;
        }
        out += c;
        i += 1;
    }
    return out;
}

function quoteIdent(name: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unexpected schema object name ${JSON.stringify(name)}`);
    return `"${name}"`;
}

/** The whole schema of a connection, in a stable order, as plain JSON. */
function describeSchema(db: Database.Database): SchemaDescription {
    const tables: Record<string, TableDescription> = {};
    const tableRows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string; sql: string | null }>;
    for (const t of tableRows) {
        const indexList = db.prepare('SELECT name, "unique", origin, partial FROM pragma_index_list(?) ORDER BY name').all(t.name) as Array<{
            name: string;
            unique: number;
            origin: string;
            partial: number;
        }>;
        const indexes: IndexDescription[] = indexList.map((ix) => {
            const stored = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(ix.name) as { sql: string | null } | undefined;
            if (!stored) throw new Error(`index ${ix.name} is in index_list but not in sqlite_master`);
            return {
                name: ix.name,
                unique: ix.unique,
                origin: ix.origin,
                partial: ix.partial,
                sql: normalizeSql(stored.sql),
                columns: db.prepare('SELECT seqno, cid, name, "desc", coll, "key" FROM pragma_index_xinfo(?) ORDER BY seqno').all(ix.name) as Row[],
            };
        });
        tables[t.name] = {
            sql: normalizeSql(t.sql),
            columns: db.prepare('SELECT cid, name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?) ORDER BY cid').all(t.name) as Row[],
            indexes,
            foreign_keys: db
                .prepare('SELECT id, seq, "table", "from", "to", on_update, on_delete, "match" FROM pragma_foreign_key_list(?) ORDER BY id, seq')
                .all(t.name) as Row[],
        };
    }
    // Every index must belong to a described table, so none can hide from the comparison.
    const allIndexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all() as Array<{ name: string }>;
    const described = new Set(Object.values(tables).flatMap((t) => t.indexes.map((ix) => ix.name)));
    for (const ix of allIndexes) {
        if (!described.has(ix.name)) throw new Error(`index ${ix.name} is not reported by any table's index_list`);
    }
    const otherObjects = (db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type NOT IN ('table', 'index') ORDER BY type, name").all() as Row[]).map(
        (o) => ({ ...o, sql: normalizeSql(o.sql as string | null) }),
    );
    return {
        user_version: db.pragma('user_version', { simple: true }) as number,
        tables,
        other_objects: otherObjects,
    };
}

/** Every row of every table, in rowid order. */
function allRows(db: Database.Database): Record<string, Row[]> {
    const out: Record<string, Row[]> = {};
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    for (const { name } of names) {
        out[name] = db.prepare(`SELECT * FROM ${quoteIdent(name)} ORDER BY rowid`).all() as Row[];
    }
    return out;
}

function loadRecording(): SchemaDescription {
    return JSON.parse(fs.readFileSync(RECORDING, 'utf8')) as SchemaDescription;
}

function userVersion(db: Database.Database): number {
    return db.pragma('user_version', { simple: true }) as number;
}

// Rows seeded into the frozen version 4 database (AC-05). Every column is given explicitly, so
// nothing depends on unixepoch() or on the clock.
const V4_TRADES: Row[] = [
    {
        id: 1,
        token: '0x1111111111111111111111111111111111111111',
        chain: 'eth',
        action: 'buy',
        tx_hash: '0xaaaa000000000000000000000000000000000000000000000000000000000001',
        block: 18000000,
        timestamp: 1700000000,
        amount_in: '0.05',
        amount_out: '123456789000000000000',
        gas_cost: '2100000000000000',
        price_at_action: '0.000000000405',
        status: 'pending',
        pool_type: 'v2',
        fee_tier: null,
        dex_name: 'uniswap-v2',
    },
    {
        id: 2,
        token: '0x2222222222222222222222222222222222222222',
        chain: 'eth',
        action: 'sell',
        tx_hash: '0xbbbb000000000000000000000000000000000000000000000000000000000002',
        block: 18000050,
        timestamp: 1700000600,
        amount_in: '987654321000000000000',
        amount_out: '61000000000000000',
        gas_cost: '1900000000000000',
        price_at_action: '0.000000000061',
        status: 'sold',
        pool_type: 'v3',
        fee_tier: 3000,
        dex_name: 'uniswap-v3',
    },
];

const V4_EXIT_STATE: Row = {
    trade_id: 1,
    entry_price: 0.000000000405,
    high_water_mark: 0.0000000005,
    trailing_activated: 1,
    partial_tiers_completed: '[1]',
    original_token_amount: '123456789000000000000',
    urgency_start_ts: 1700000000000,
    volatility_samples: '[0.01,0.02]',
};

function insertRow(db: Database.Database, table: string, row: Row): void {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
}

/** A version 4 database built from the frozen fixture, with its seed rows. */
function seededV4(): Database.Database {
    const db = new Database(':memory:');
    applyV4Schema(db);
    for (const row of V4_TRADES) insertRow(db, 'trades', row);
    insertRow(db, 'exit_state', V4_EXIT_STATE);
    return db;
}

/** A version 0 database migrated to version 7, then given rows in every table it has. */
function populatedV7FromV0(): Database.Database {
    const db = new Database(':memory:');
    migrateSchema(db);
    for (const row of V4_TRADES) insertRow(db, 'trades', row);
    insertRow(db, 'exit_state', { ...V4_EXIT_STATE, exit_failure_count: 2, exit_status: 'exit_failed_held' });
    insertRow(db, 'lp_baseline', {
        trade_id: 1,
        pool_type: 'v2',
        pair_or_pool_address: '0x3333333333333333333333333333333333333333',
        v2_token0_reserve: '1000000000000000000000',
        v2_token1_reserve: '5000000000000000000',
        v2_lp_total_supply: '70710678118654752440',
        v3_active_liquidity: null,
        v3_tick_at_snapshot: null,
        v3_position_nft_id: null,
        v3_fee_tier: null,
        snapshot_block: 18000001,
        snapshot_ts: 1700000012,
    });
    insertRow(db, 'chain_state', { chain: 'eth', last_seen_block: 18000100, last_updated_ts: 1700001200, antirug_dry_run_started: 1699000000 });
    // A paused bot: a second migration run must not reset the operator's kill switch.
    db.prepare("UPDATE pause_state SET paused = 1, paused_at = 1700001300, paused_by = 'cli', reason = 'golden test' WHERE id = 1").run();
    return db;
}

describe('real migrations, golden schema (CHAR-05)', () => {
    it('the recording is the current schema version and holds every production table', () => {
        const rec = loadRecording();
        expect(rec.user_version).toBe(CURRENT_SCHEMA_VERSION);
        expect(Object.keys(rec.tables)).toEqual(expect.arrayContaining(['trades', 'exit_state', 'lp_baseline', 'chain_state', 'pause_state']));
        // The failed-held and pause columns production has, which the old hand-written helper
        // did not (AUD-TESTI-001, RC-28).
        const cols = (t: string): unknown[] => rec.tables[t].columns.map((c) => c.name);
        expect(cols('exit_state')).toEqual(expect.arrayContaining(['exit_failure_count', 'exit_status']));
        expect(cols('pause_state')).toEqual(['id', 'paused', 'paused_at', 'paused_by', 'reason']);
        expect(cols('chain_state')).toContain('antirug_dry_run_started');
    });

    it('AC-04: the real migrations take an empty version 0 database to version 7 and match the recorded schema', () => {
        const db = new Database(':memory:');
        try {
            expect(userVersion(db)).toBe(0);
            expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get()).toEqual({ n: 0 });

            migrateSchema(db);

            expect(userVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
            expect(describeSchema(db)).toEqual(loadRecording());
            // The rows a fresh migration writes: the unpaused kill-switch row, and a
            // sqlite_sequence row at 0 for trades. The second is SQLite's, not the bot's: the
            // version 3 rebuild runs INSERT INTO trades_new SELECT * FROM trades into an
            // AUTOINCREMENT table, which writes the sequence row even when no row is copied, and
            // the RENAME carries it over to `trades` (measured at 5b2168f).
            expect(allRows(db)).toEqual({
                chain_state: [],
                exit_state: [],
                lp_baseline: [],
                pause_state: [{ id: 1, paused: 0, paused_at: null, paused_by: null, reason: null }],
                sqlite_sequence: [{ name: 'trades', seq: 0 }],
                trades: [],
            });
        } finally {
            db.close();
        }
    });

    it('AC-05: a frozen version 4 database upgrades to version 7, matches the recorded schema, and keeps the rows seeded at version 4', () => {
        const db = seededV4();
        try {
            // The fixture really is a version 4 database: none of the version 5 to 7 objects exist.
            expect(userVersion(db)).toBe(4);
            const tablesAt4 = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
            expect(tablesAt4).toEqual(['exit_state', 'sqlite_sequence', 'trades']);
            const exitColsAt4 = (db.prepare("SELECT name FROM pragma_table_info('exit_state')").all() as Array<{ name: string }>).map((r) => r.name);
            expect(exitColsAt4).not.toContain('exit_failure_count');
            const before = allRows(db);

            migrateSchema(db);

            expect(userVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
            expect(describeSchema(db)).toEqual(loadRecording());

            const after = allRows(db);
            // Seeded trades rows: present, with every value unchanged.
            expect(after.trades).toEqual(V4_TRADES);
            expect(after.trades).toEqual(before.trades);
            // The seeded exit_state row keeps its values; the columns added at version 7 hold
            // their defaults (exit_failure_count 0, exit_status NULL).
            expect(after.exit_state).toEqual([{ ...V4_EXIT_STATE, exit_failure_count: 0, exit_status: null }]);
            // Tables added after version 4: empty, apart from the default unpaused row.
            expect(after.lp_baseline).toEqual([]);
            expect(after.chain_state).toEqual([]);
            expect(after.pause_state).toEqual([{ id: 1, paused: 0, paused_at: null, paused_by: null, reason: null }]);
            expect(after.sqlite_sequence).toEqual(before.sqlite_sequence);
            expect(after.sqlite_sequence).toEqual([{ name: 'trades', seq: 2 }]);
        } finally {
            db.close();
        }
    });

    it.each([
        ['an empty version 0 database migrated to version 7, with rows in every table', populatedV7FromV0],
        ['the seeded version 4 database upgraded to version 7', (): Database.Database => {
            const db = seededV4();
            migrateSchema(db);
            return db;
        }],
    ])('AC-06: running the migrations again on %s leaves schema and rows unchanged', (_label, build) => {
        const db = build();
        try {
            expect(userVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
            const schemaBefore = describeSchema(db);
            const rowsBefore = allRows(db);
            expect(schemaBefore).toEqual(loadRecording());

            migrateSchema(db);

            expect(userVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
            expect(describeSchema(db)).toEqual(schemaBefore);
            expect(allRows(db)).toEqual(rowsBefore);
        } finally {
            db.close();
        }
    });

    it('AC-06: the rows survive a second run, including a paused kill switch and a failed-held exit', () => {
        const db = populatedV7FromV0();
        try {
            migrateSchema(db);
            const rows = allRows(db);
            expect(rows.pause_state).toEqual([{ id: 1, paused: 1, paused_at: 1700001300, paused_by: 'cli', reason: 'golden test' }]);
            expect(rows.exit_state).toEqual([{ ...V4_EXIT_STATE, exit_failure_count: 2, exit_status: 'exit_failed_held' }]);
            expect(rows.chain_state).toEqual([{ chain: 'eth', last_seen_block: 18000100, last_updated_ts: 1700001200, antirug_dry_run_started: 1699000000 }]);
            expect(rows.trades).toEqual(V4_TRADES);
            expect(rows.lp_baseline).toHaveLength(1);
        } finally {
            db.close();
        }
    });
});

describe('normalizeSql (the stored-SQL comparison used above)', () => {
    it('removes only whitespace, comments and plain identifier quotes', () => {
        expect(normalizeSql('CREATE TABLE "trades" (\n  a INTEGER -- note\n , b TEXT /* x */)')).toBe('CREATETABLEtrades(aINTEGER,bTEXT)');
        expect(normalizeSql(null)).toBeNull();
    });

    it('keeps string literals, so a changed CHECK list or default still differs', () => {
        expect(normalizeSql("CHECK(a IN ('v2', 'v3'))")).toBe("CHECK(aIN('v2','v3'))");
        expect(normalizeSql("CHECK(a IN ('v2', 'v3'))")).not.toBe(normalizeSql("CHECK(a IN ('v2', 'v4'))"));
        expect(normalizeSql("DEFAULT 'a b'")).not.toBe(normalizeSql("DEFAULT 'ab'"));
        expect(normalizeSql("DEFAULT '-- not a comment'")).toBe("DEFAULT'-- not a comment'");
        expect(normalizeSql("DEFAULT 'it''s'")).toBe("DEFAULT'it''s'");
    });

    it('keeps quotes around an identifier that is not a plain name', () => {
        expect(normalizeSql('CREATE TABLE "odd name" (a)')).toBe('CREATETABLE"odd name"(a)');
    });
});
