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
//   - Transactions (RESEARCH Open Question 5, Phase 23 review WR-05). A row written while
//     db.inTransaction is true is held, not recorded, until SQLite decides its fate. The trigger
//     that captured it also inserts a key into a TEMP table on the same connection; TEMP tables
//     take part in the connection's transaction, so the key survives exactly when the write
//     does: a COMMIT keeps it, a ROLLBACK (whole transaction, ROLLBACK TO a savepoint, or a
//     failed statement's own undo) removes it. Whichever way the transaction was opened
//     (db.transaction made before or after the capture, a nested one, raw BEGIN through db.exec),
//     the outcome is read the same way. Reading `timeline.entries` settles every held row whose
//     transaction has ended: a committed row joins the timeline at the position it was written
//     (so the order is still the order things happened), a rolled-back row is dropped. Closing
//     the connection settles it first. A row whose transaction is still open when the
//     connection closes never landed and is a `db-transaction-open` violation.
//     The other violation is an argument passed to unixepoch() (it would read the real clock in
//     production SQL).
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
    /**
     * db.inTransaction when the trigger fired. A true entry was written inside a transaction that
     * then committed (a rolled-back one never reaches the timeline; see the header, WR-05).
     */
    inTransaction: boolean;
}

export type TimelineEntry = OpEntry | SubmitEntry | RelayBodyEntry | DbEntry;
/** An entry as a feed hands it over; record() adds `at`. */
export type TimelineInput = TimelineEntry extends infer E ? (E extends TimelineEntry ? Omit<E, 'at'> : never) : never;

export interface Timeline {
    /**
     * In the order things happened. Never sorted. Reading it first settles DB rows held for a
     * transaction that has since ended (WR-05), so read it again after a commit rather than
     * keeping an older reference.
     */
    readonly entries: TimelineEntry[];
    /** Append one entry, stamped with the fake clock's Date.now(). */
    record(entry: TimelineInput): TimelineEntry;
}

const TIMELINE_KINDS: ReadonlySet<string> = new Set<TimelineKind>(['op', 'submit', 'relay', 'db']);

/** A DB row written inside a transaction, waiting for its transaction's outcome (WR-05). */
interface HeldSlot {
    /** Its place in the timeline's record order. */
    ord: number;
    entry: TimelineEntry;
    state: 'pending' | 'committed' | 'dropped';
}

/** The capture's private hooks on a timeline (a registry symbol: vi.resetModules makes copies). */
interface TimelineHolds {
    /** Stamp `entry` now and keep its place, without showing it until it is settled. */
    hold(entry: TimelineInput): HeldSlot;
    /** Called before every read of `entries`, to decide pending slots. Added once per function. */
    addSettler(settle: () => void): void;
}

const TIMELINE_HOLDS = Symbol.for('csb.realpath.timeline.holds');

function holdsOf(timeline: Timeline): TimelineHolds {
    const h = (timeline as unknown as Record<symbol, TimelineHolds | undefined>)[TIMELINE_HOLDS];
    if (!h) throw new Error('installDbCapture: the timeline was not made by createTimeline');
    return h;
}

function stampEntry(entry: TimelineInput): TimelineEntry {
    if (!TIMELINE_KINDS.has((entry as { kind?: unknown }).kind as string)) {
        throw new Error(`timeline: unknown entry kind ${JSON.stringify((entry as { kind?: unknown }).kind)}`);
    }
    return { ...entry, at: Date.now() } as TimelineEntry;
}

export function createTimeline(): Timeline {
    const list: TimelineEntry[] = [];
    /** ords[i] is list[i]'s place in record order; a settled slot is spliced in by it. */
    const ords: number[] = [];
    const held: HeldSlot[] = [];
    const settlers = new Set<() => void>();
    let nextOrd = 0;
    const settle = (): void => {
        if (held.length === 0) return;
        for (const s of settlers) s();
        for (let i = 0; i < held.length; ) {
            const slot = held[i];
            if (slot.state === 'pending') {
                i += 1;
                continue;
            }
            held.splice(i, 1);
            if (slot.state === 'dropped') continue;
            let at = ords.length;
            while (at > 0 && ords[at - 1] > slot.ord) at -= 1;
            list.splice(at, 0, slot.entry);
            ords.splice(at, 0, slot.ord);
        }
    };
    const holds: TimelineHolds = {
        hold(entry: TimelineInput): HeldSlot {
            const slot: HeldSlot = { ord: nextOrd++, entry: stampEntry(entry), state: 'pending' };
            held.push(slot);
            return slot;
        },
        addSettler(fn: () => void): void {
            settlers.add(fn);
        },
    };
    const timeline: Timeline = {
        get entries(): TimelineEntry[] {
            settle();
            return list;
        },
        record(entry: TimelineInput): TimelineEntry {
            const stamped = stampEntry(entry);
            list.push(stamped);
            ords.push(nextOrd++);
            return stamped;
        },
    };
    Object.defineProperty(timeline, TIMELINE_HOLDS, { value: holds, enumerable: false });
    return timeline;
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

/** One connection's rows held for an open transaction (WR-05), kept on the connection itself. */
interface ConnectionHolds {
    /** Key the trigger stores in the TEMP table for the row it just captured, or null. */
    pendingKey: number | null;
    nextKey: number;
    slots: Array<{ key: number; slot: HeldSlot }>;
    /** Decide every slot whose transaction has ended; a no-op while one is open. */
    settle(): void;
}

const CONNECTION_HOLDS = Symbol.for('csb.realpath.capture.connectionHolds');
/** The TEMP table holding the keys of rows written inside a transaction that is still undecided. */
const HELD_TABLE = '__realpath_held';

/**
 * The connection's held-row state, created on first install: the TEMP table, the settle step and
 * a close() that settles first and turns a row of a still-open transaction into a violation.
 */
function connectionHolds(db: Db): ConnectionHolds {
    const own = db as unknown as Record<symbol, ConnectionHolds | undefined>;
    const existing = own[CONNECTION_HOLDS];
    if (existing) return existing;
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS ${sqlIdent(HELD_TABLE)} (k INTEGER)`);
    const readKeys = db.prepare(`SELECT k FROM temp.${sqlIdent(HELD_TABLE)}`).pluck();
    const clearKeys = db.prepare(`DELETE FROM temp.${sqlIdent(HELD_TABLE)}`);
    const conn: ConnectionHolds = {
        pendingKey: null,
        nextKey: 1,
        slots: [],
        settle(): void {
            if (conn.slots.length === 0 || !db.open || db.inTransaction) return;
            let kept: Set<number>;
            try {
                kept = new Set((readKeys.all() as Array<number | bigint>).map((k) => Number(k)));
                clearKeys.run();
            } catch (e) {
                // The connection is busy (a statement mid-iteration): decide on a later read.
                if (e instanceof TypeError && /busy/i.test(e.message)) return;
                pushViolation({ kind: 'capture-error', message: `settling held transaction rows failed: ${e instanceof Error ? e.message : String(e)}` });
                return;
            }
            for (const { key, slot } of conn.slots) slot.state = kept.has(key) ? 'committed' : 'dropped';
            conn.slots = [];
        },
    };
    const close = db.close;
    Object.defineProperty(db, 'close', {
        configurable: true,
        writable: true,
        value: function closeSettlingHeldRows(this: Db): Db {
            conn.settle();
            const stillOpen = db.open && db.inTransaction;
            const result = close.call(this);
            // Closing rolls an open transaction back: its rows never landed.
            for (const { slot } of conn.slots) {
                slot.state = 'dropped';
                if (stillOpen && slot.entry.kind === 'db') pushViolation({ kind: 'db-transaction-open', table: slot.entry.table, op: slot.entry.op });
            }
            conn.slots = [];
            return result;
        },
    });
    Object.defineProperty(db, CONNECTION_HOLDS, { value: conn, enumerable: false });
    return conn;
}

/**
 * Capture every row written on `db` into `timeline`, and fix SQLite's clock to the fake one.
 * Safe to call again on the same connection: the triggers are rebuilt and the functions point at
 * the new timeline. Returns the captured tables, in schema order.
 */
export function installDbCapture(db: Db, timeline: Timeline): string[] {
    if (!db.open) throw new Error('installDbCapture: the connection is closed');
    const holds = holdsOf(timeline);
    const conn = connectionHolds(db);
    holds.addSettler(conn.settle);
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
            if (inTransaction) {
                // Held until the transaction's outcome is known; the trigger's next step stores
                // this key in the TEMP table, inside the same transaction (WR-05).
                const key = conn.nextKey++;
                conn.slots.push({ key, slot: holds.hold({ kind: 'db', table, op, row, inTransaction }) });
                conn.pendingKey = key;
            } else {
                timeline.record({ kind: 'db', table, op, row, inTransaction });
            }
        } catch (e) {
            // Never into SQLite (see the header): a harness fault is a violation.
            pushViolation({ kind: 'capture-error', message: e instanceof Error ? e.message : String(e) });
        }
        return null;
    });
    // The trigger's second step: true while a held row's key is waiting to be stored...
    db.function('__realpath_held_pending', { deterministic: false }, () => (conn.pendingKey === null ? 0 : 1));
    // ...and the key itself, handed over once.
    db.function('__realpath_held_take', { deterministic: false }, () => {
        const key = conn.pendingKey;
        conn.pendingKey = null;
        return key;
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
            // The TEMP table has no constraint, so an outer statement's OR clause can never turn
            // the second step into a failure of the production statement.
            db.exec(
                `CREATE TEMP TRIGGER ${trigger} AFTER ${event} ON main.${sqlIdent(name)} BEGIN ` +
                    `SELECT __realpath_rec(${sqlString(name)}, ${sqlString(op)}, ${args(prefix)}); ` +
                    `INSERT INTO ${sqlIdent(HELD_TABLE)} (k) SELECT __realpath_held_take() WHERE __realpath_held_pending(); ` +
                    `END`,
            );
        }
    }
    return tables;
}

// ---------------------------------------------------------------------------------------------
// Out-of-band checks and readers
// ---------------------------------------------------------------------------------------------

function describeViolation(v: Violation): string {
    switch (v.kind) {
        case 'db-transaction-open':
            return `${v.op === 'insert' ? 'an' : 'a'} ${v.op} on table ${v.table} was written inside a transaction that was still open when the connection closed, so it never landed (WR-05)`;
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
