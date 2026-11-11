// test/realpath/harness/capture.ts
// Phase 23 plan 23-02 (CHAR-01, D-05, D-13, D-14): the ordered timeline and the DB capture.
//
//   - createTimeline(): the ONE ordered list that every feed appends to, in the order things
//     happened. Entries are never sorted. Four feeds, each tagged by `kind`:
//       op      the logger mock, for every log call whose fields carry `op` (setup.ts)
//       submit  a transaction the node accepted from the code under test (chain.ts FakeNode)
//       relay   a request body sent to a relay: Flashbots (chain.ts) or bloXroute (world.ts)
//       db      a row written to the database, captured by a TEMP trigger (installDbCapture)
//     record() stamps each entry with `at`, the fake clock's Date.now() at that moment.
//     Alerts never feed the timeline (AC-20 names what a recording holds, and plan 23-20's secret
//     scan relies on alert text not being recorded); they go on their own list (recordedAlerts).
//   - installDbCapture(db, timeline) (RESEARCH Pattern 5, Flag 4): one TEMP trigger per table and
//     operation, generated from the migrated schema, calling a recording function registered with
//     db.function. Columns are passed as separate SQL arguments with safeIntegers, never through a
//     JSON-building SQL function (Refinement 2: that rounds REAL values to 15 digits and loses
//     integers above 2^53). The same call overrides unixepoch() with the fake clock, so the
//     capture and the SQL clock can never be installed apart (D-05). TEMP triggers stay out of
//     sqlite_master, so the schema golden tests are unaffected.
//   - The recording function NEVER throws into SQLite. An error raised there surfaces from the
//     production statement (for example insertTrade.run) and is caught by production code such as
//     the broad catch in src/bot.ts handleNewPairForChain, so the scenario would carry on down a
//     failure path and record something misleading. A problem goes on the out-of-band
//     `violations` list instead, and assertNoViolations() (afterEach, setup.ts) fails the test.
//     Two problems are recorded: a write while db.inTransaction is true (RESEARCH Open Question 5:
//     the harness does not handle rollback yet, so a rolled-back write would read as landed), and
//     an argument passed to unixepoch() (it would read the real clock in production SQL).
//
// The better-sqlite3 handle is named `db` because test/unit/rails/spawnSites.test.ts accepts
// `.exec()` only on named receivers (RESEARCH Refinement 3).

import type Database from 'better-sqlite3';
import { harnessState, type AlertEntry, type LogSinkEntry, type Violation } from './chain';

// ---------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------

export type TimelineKind = 'op' | 'submit' | 'relay' | 'db';

/** A log call whose fields carry `op` (the bot's decision trace). */
export interface OpEntry {
    kind: 'op';
    at: number;
    level: string;
    op: string;
    msg: string | undefined;
    /** The log call's own fields object, as passed. */
    fields: Record<string, unknown>;
    /** The logger's child bindings (module, chain, ...). */
    bindings: Record<string, unknown>;
}

/** A transaction the node accepted from the code under test (public pool, bundle or bloXroute). */
export interface SubmitEntry {
    kind: 'submit';
    at: number;
    route: 'public' | 'bundle' | 'bloxroute';
    hash: string;
    raw: string;
    from: string;
    to: string | null;
    nonce: number;
    /** Where the node put it on arrival: pending (`accepted`) or a queued future nonce. */
    status: 'accepted' | 'queued';
}

/** A request body sent to a relay endpoint, recorded on arrival (before any hold or fault). */
export interface RelayBodyEntry {
    kind: 'relay';
    at: number;
    relay: 'flashbots' | 'bloxroute';
    url: string;
    method: string;
    params: unknown;
}

/** A row written to the database, exactly as it landed (values SQLite filled in included). */
export interface DbEntry {
    kind: 'db';
    at: number;
    table: string;
    op: 'insert' | 'update' | 'delete';
    /** Column name to value, in schema order: NEW for insert and update, OLD for delete. INTEGER values are BigInt (safeIntegers). */
    row: Record<string, unknown>;
    /** db.inTransaction when the trigger fired; true is also a violation (Open Question 5). */
    inTransaction: boolean;
}

export type TimelineEntry = OpEntry | SubmitEntry | RelayBodyEntry | DbEntry;
/** An entry as a feed hands it over; record() adds `at`. */
export type TimelineInput = TimelineEntry extends infer E ? (E extends TimelineEntry ? Omit<E, 'at'> : never) : never;

export interface Timeline {
    /** In the order recorded. Never sorted. */
    readonly entries: TimelineEntry[];
    /** Append one entry, stamped with the fake clock's Date.now(). */
    record(entry: TimelineInput): TimelineEntry;
}

const TIMELINE_KINDS: ReadonlySet<string> = new Set<TimelineKind>(['op', 'submit', 'relay', 'db']);

export function createTimeline(): Timeline {
    const entries: TimelineEntry[] = [];
    return {
        entries,
        record(entry: TimelineInput): TimelineEntry {
            if (!TIMELINE_KINDS.has((entry as { kind?: unknown }).kind as string)) {
                throw new Error(`timeline: unknown entry kind ${JSON.stringify((entry as { kind?: unknown }).kind)}`);
            }
            const stamped = { ...entry, at: Date.now() } as TimelineEntry;
            entries.push(stamped);
            return stamped;
        },
    };
}

// ---------------------------------------------------------------------------------------------
// DB capture (D-14) and the SQL clock (D-05)
// ---------------------------------------------------------------------------------------------

type Db = Database.Database;

function sqlString(s: string): string {
    return `'${s.replace(/'/g, "''")}'`;
}

function sqlIdent(s: string): string {
    return `"${s.replace(/"/g, '""')}"`;
}

function pushViolation(v: Violation): void {
    harnessState().violations.push(v);
}

/**
 * Capture every row written on `db` into `timeline`, and fix SQLite's clock to the fake one.
 * Safe to call again on the same connection: the triggers are rebuilt and the functions point at
 * the new timeline. Returns the captured tables, in schema order.
 */
export function installDbCapture(db: Db, timeline: Timeline): string[] {
    if (!db.open) throw new Error('installDbCapture: the connection is closed');
    // unixepoch() with no argument reads the fake clock, also through DEFAULT (unixepoch()) and
    // through statements prepared before this override (RESEARCH E4c). An argument is never
    // thrown into SQLite: it is a violation, answered with the fake second so nothing fails here.
    db.function('unixepoch', { varargs: true, deterministic: false }, (...args: unknown[]) => {
        if (args.length > 0) pushViolation({ kind: 'unixepoch-argument', args: args.map((a) => (typeof a === 'bigint' ? a.toString() : a)) });
        return Math.floor(Date.now() / 1000);
    });

    const tables = (db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all() as Array<{ name: string }>).map((t) => t.name);
    const columns = new Map<string, string[]>();
    for (const name of tables) {
        const cols = (db.prepare(`PRAGMA main.table_info(${sqlString(name)})`).all() as Array<{ name: string }>).map((c) => c.name);
        if (cols.length === 0) throw new Error(`installDbCapture: table ${name} has no columns`);
        columns.set(name, cols);
    }

    // Separate arguments with safeIntegers: REAL keeps the exact double, INTEGER arrives as a
    // BigInt and stays whole above 2^53 (Refinement 2). Not directOnly, so triggers may call it.
    db.function('__realpath_rec', { varargs: true, safeIntegers: true, deterministic: false }, (...args: unknown[]) => {
        try {
            const table = String(args[0]);
            const op = String(args[1]) as DbEntry['op'];
            const values = args.slice(2);
            const cols = columns.get(table) ?? values.map((_, i) => `col${i}`);
            const row: Record<string, unknown> = {};
            cols.forEach((c, i) => {
                row[c] = values[i];
            });
            const inTransaction = db.inTransaction;
            timeline.record({ kind: 'db', table, op, row, inTransaction });
            if (inTransaction) pushViolation({ kind: 'db-in-transaction', table, op });
        } catch (e) {
            // Never into SQLite (see the header): a harness fault is a violation.
            pushViolation({ kind: 'capture-error', message: e instanceof Error ? e.message : String(e) });
        }
        return null;
    });

    for (const name of tables) {
        const cols = columns.get(name)!;
        const args = (prefix: 'NEW' | 'OLD'): string => cols.map((c) => `${prefix}.${sqlIdent(c)}`).join(', ');
        const ops: Array<[suffix: string, event: string, op: DbEntry['op'], prefix: 'NEW' | 'OLD']> = [
            ['i', 'INSERT', 'insert', 'NEW'],
            ['u', 'UPDATE', 'update', 'NEW'],
            ['d', 'DELETE', 'delete', 'OLD'],
        ];
        for (const [suffix, event, op, prefix] of ops) {
            const trigger = sqlIdent(`__realpath_rec_${name}_${suffix}`);
            db.exec(`DROP TRIGGER IF EXISTS temp.${trigger}`);
            db.exec(`CREATE TEMP TRIGGER ${trigger} AFTER ${event} ON main.${sqlIdent(name)} BEGIN SELECT __realpath_rec(${sqlString(name)}, ${sqlString(op)}, ${args(prefix)}); END`);
        }
    }
    return tables;
}

// ---------------------------------------------------------------------------------------------
// Out-of-band checks and readers
// ---------------------------------------------------------------------------------------------

function describeViolation(v: Violation): string {
    switch (v.kind) {
        case 'db-in-transaction':
            return `${v.op === 'insert' ? 'an' : 'a'} ${v.op} on table ${v.table} was captured inside a transaction (db.inTransaction true); the harness does not handle rollback yet, so this write may never have landed (RESEARCH Open Question 5)`;
        case 'unixepoch-argument':
            return `unixepoch() was called with arguments ${JSON.stringify(v.args)}; only the no-argument form reads the fake clock`;
        case 'capture-error':
            return `the DB capture failed: ${v.message}`;
    }
}

/** Throw naming the first capture violation (afterEach, setup.ts). A production catch cannot hide it. */
export function assertNoViolations(): void {
    const list = harnessState().violations;
    if (list.length === 0) return;
    const more = list.length > 1 ? ` (and ${list.length - 1} more: ${list.slice(1, 6).map(describeViolation).join('; ')})` : '';
    throw new Error(`realpath harness: capture violation: ${describeViolation(list[0])}${more}`);
}

/** Return the violations recorded so far and clear them (for a test that provokes one on purpose). */
export function takeViolations(): Violation[] {
    const st = harnessState();
    const taken = st.violations;
    st.violations = [];
    return taken;
}

/** Every alert the bot sent through the notifier, in call order, with its exact text. */
export function recordedAlerts(): readonly AlertEntry[] {
    return harnessState().alerts;
}

/** Every log call, with or without an `op` field, in call order. */
export function recordedLogs(): readonly LogSinkEntry[] {
    return harnessState().logs;
}
