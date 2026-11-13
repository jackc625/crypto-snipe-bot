// test/realpath/harnessCapture.test.ts
// Phase 23 plan 23-02 (CHAR-01): the harness instruments every later plan needs.
//   - The ordered timeline (D-13): op logs, submissions, relay bodies and DB writes, in the order
//     they happened, each stamped with the fake clock's time.
//   - The DB capture (D-14, D-05): TEMP triggers from the migrated schema calling a recording
//     function, and SQLite's unixepoch() on the fake clock. A capture problem never throws into
//     SQLite; it fails the test from afterEach, so a production catch cannot hide it.
//   - The plain log and alert lists (recordedLogs, recordedAlerts), which never feed the timeline.
//   - The known-bug marker (D-07, D-08): only the exact recorded failure passes and is recorded on
//     task meta; a fixed bug and a changed failure both fail. Every knownBug call in this file
//     cites the reserved literal HARNESS-SELFTEST, never a finding ID (plan 23-04 accepts that
//     literal outside test/realpath/triage/ and reads it for no finding rule).
// Only the logger, notifier, broadcaster, axios and the Telegram library are mocked
// (harness/setup.ts); the chain is a transport seam (harness/chain.ts).
//
// The better-sqlite3 handle is named `db` (test/unit/rails/spawnSites.test.ts accepts `.exec()`
// only on named receivers).

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { Interface, Transaction, getAddress } from 'ethers';
import { harnessState } from './harness/chain';
import {
    assertNoViolations,
    createTimeline,
    installDbCapture,
    recordedAlerts,
    recordedLogs,
    takeViolations,
    type DbEntry,
    type TimelineEntry,
} from './harness/capture';
import { knownBug } from './harness/knownBug';
import { FIXED_EPOCH_MS, createScenario, loadGraph, stepFor, stepUntilTrue, type Scenario } from './harness/world';
import { logger } from '../../src/utils/logger';
import { sendTelegramAlert } from '../../src/utils/notifier';

const ROUTER = new Interface(['function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)']);

function opLogged(op: string): boolean {
    return recordedLogs().some((l) => l.obj?.op === op);
}

/** JSON with BigInt as whole-number text, for searching a timeline. */
function textOf(v: unknown): string {
    return JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));
}

/** The error `fn` throws (fails the test if it throws nothing). */
function thrown(fn: () => unknown): Error {
    try {
        fn();
    } catch (e) {
        return e as Error;
    }
    throw new Error('expected the call to throw');
}

function dbEntries(entries: readonly TimelineEntry[], table: string, op?: DbEntry['op']): DbEntry[] {
    return entries.filter((e): e is DbEntry => e.kind === 'db' && e.table === table && (op === undefined || e.op === op));
}

/**
 * The AC-01 buy (plan 23-01): a real PairCreated through the real listener, the real Flashbots
 * bundle, mined at its target, then the position armed. With `holdSend`, the first
 * eth_sendBundle is parked so the test can read the fake clock at the moment of submission.
 */
async function driveBuy(opts: { holdSend?: boolean } = {}): Promise<{ sc: Scenario<'v2'>; buyHash: string; submittedAt: number | null }> {
    const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
    const { node, graph, ctx, dex } = sc;
    await graph.bot.startDexListener(ctx, dex, sc.registry);
    await stepUntilTrue(
        () => node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === dex.factoryAddress.toLowerCase()),
        { what: 'the listener subscribing to PairCreated on the factory' },
    );
    const held = opts.holdSend ? node.hold('eth_sendBundle') : null;
    await sc.fireNewPair();

    let submittedAt: number | null = null;
    if (held) {
        await stepUntilTrue(() => held.heldCount >= 1, { what: 'the bot sending its bundle' });
        expect(node.submitted).toHaveLength(0);
        // The fake clock at submission: no time passes from here until the node accepts it.
        submittedAt = Date.now();
        held.release();
        for (let i = 0; i < 50 && node.submitted.length === 0; i++) await Promise.resolve();
        expect(node.submitted).toHaveLength(1);
        expect(Date.now()).toBe(submittedAt);
    }
    await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting its buy bundle' });
    const buyHash = node.submitted[0].hash;

    await stepFor(12_000);
    node.mine({ include: [buyHash] });
    await stepUntilTrue(() => graph.db.prepare('SELECT 1 FROM trades').get() !== undefined, { what: 'the trades row for the buy' });
    const cursor = (): number | undefined => (graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get('eth') as { b: number } | undefined)?.b;
    await stepUntilTrue(
        () => opLogged('exit.monitor.started') && node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase())) && cursor() === node.head,
        { what: 'the position being armed (exit monitor, anti-rug subscription, block cursor)' },
    );
    return { sc, buyHash, submittedAt };
}

describe('realpath harness: timeline and DB capture (plan 23-02 Task 1)', () => {
    it('D-13, CAP-14 order: on the real buy the trades insert is recorded after the relay bodies and the submit that carried the buy, by position in the timeline', async () => {
        const { sc, buyHash } = await driveBuy();
        const entries = sc.timeline.entries;
        expect(harnessState().timeline).toBe(sc.timeline);

        // The submission: the bundle transaction, decoded with real ethers.
        const submits = entries.filter((e) => e.kind === 'submit');
        expect(submits).toHaveLength(1);
        const submitIdx = entries.findIndex((e) => e.kind === 'submit' && e.hash === buyHash);
        const submit = entries[submitIdx] as Extract<TimelineEntry, { kind: 'submit' }>;
        expect(submit.route).toBe('bundle');
        const tx = Transaction.from(submit.raw);
        expect(tx.hash).toBe(buyHash);
        expect(ROUTER.parseTransaction({ data: tx.data, value: tx.value })?.name).toBe('swapExactETHForTokens');
        expect(getAddress(submit.to!)).toBe(getAddress(sc.dex.routerAddress));

        // The relay bodies that carried it: the simulation, then the bundle naming this transaction.
        const relayIdx = (method: string): number => entries.findIndex((e) => e.kind === 'relay' && e.method === method && textOf(e.params).includes(submit.raw.slice(2)));
        const callBundleIdx = relayIdx('eth_callBundle');
        const sendBundleIdx = relayIdx('eth_sendBundle');
        expect(callBundleIdx).toBeGreaterThanOrEqual(0);
        expect(sendBundleIdx).toBeGreaterThan(callBundleIdx);
        expect(submitIdx).toBeGreaterThan(sendBundleIdx);

        // The DB write, exactly as it landed, after all of them.
        const inserts = dbEntries(entries, 'trades', 'insert');
        expect(inserts).toHaveLength(1);
        const insertIdx = entries.indexOf(inserts[0]);
        expect(insertIdx).toBeGreaterThan(submitIdx);
        expect(insertIdx).toBeGreaterThan(sendBundleIdx);
        expect(inserts[0].row).toMatchObject({ token: sc.token.toLowerCase(), chain: 'eth', action: 'buy', tx_hash: buyHash, status: 'pending', pool_type: 'v2' });
        expect(inserts[0].inTransaction).toBe(false);
        // Today the insert follows every relay body of the buy: the bundle fan-out and the stats
        // query all come first (CAP-14 depends on where this write sits).
        const lastRelayIdx = entries.reduce((last, e, i) => (e.kind === 'relay' ? i : last), -1);
        expect(lastRelayIdx).toBeGreaterThan(sendBundleIdx);
        expect(insertIdx).toBeGreaterThan(lastRelayIdx);
        expect(entries.slice(0, insertIdx).some((e) => e.kind === 'op' && e.op === 'flashbots.bundle.included')).toBe(true);
    });

    it('timeline time: the submit entry carries the fake clock at the moment the node accepted it', async () => {
        const { sc, buyHash, submittedAt } = await driveBuy({ holdSend: true });
        const submit = sc.timeline.entries.find((e) => e.kind === 'submit' && e.hash === buyHash)!;
        expect(submittedAt).not.toBeNull();
        expect(submit.at).toBe(submittedAt);
        expect(submit.at).toBeGreaterThan(FIXED_EPOCH_MS);
        // Entries are in the order they happened, so their times never go backwards.
        const times = sc.timeline.entries.map((e) => e.at);
        expect(times).toEqual([...times].sort((a, b) => a - b));
        // The trades insert came later on the same fake clock.
        const insert = dbEntries(sc.timeline.entries, 'trades', 'insert')[0];
        expect(insert.at).toBeGreaterThan(submit.at);
    });

    it('D-05: a trades.timestamp filled by DEFAULT (unixepoch()) is the fake clock second, in the capture and in the table', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        await stepFor(5_000);
        const fakeSecond = Math.floor(Date.now() / 1000);
        expect(fakeSecond).toBe(Math.floor(FIXED_EPOCH_MS / 1000) + 5);
        const db = sc.graph.db;
        const info = db.prepare("INSERT INTO trades (token, chain, action) VALUES (?, 'eth', 'buy')").run('0x00000000000000000000000000000000000d0505');
        const insert = dbEntries(sc.timeline.entries, 'trades', 'insert').at(-1)!;
        expect(insert.row.timestamp).toBe(BigInt(fakeSecond));
        expect(insert.row.id).toBe(BigInt(info.lastInsertRowid));
        expect((db.prepare('SELECT timestamp FROM trades WHERE id = ?').get(info.lastInsertRowid) as { timestamp: number }).timestamp).toBe(fakeSecond);
    });

    it('D-05: a statement prepared before the capture was installed also reads the fake clock through its DEFAULT', async () => {
        await createScenario({ chain: 'eth', dexType: 'v2' });
        await stepFor(7_000);
        const db = new Database(':memory:');
        try {
            db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL DEFAULT (unixepoch()))');
            const early = db.prepare('INSERT INTO t DEFAULT VALUES');
            const timeline = createTimeline();
            expect(installDbCapture(db, timeline)).toEqual(['t']);
            early.run();
            const fakeSecond = BigInt(Math.floor(Date.now() / 1000));
            expect(timeline.entries).toEqual([{ kind: 'db', table: 't', op: 'insert', row: { id: 1n, ts: fakeSecond }, inTransaction: false, at: Date.now() }]);
        } finally {
            db.close();
        }
    });

    it('RESEARCH Refinement 2: a REAL value round-trips exactly and an integer above 2^53 stays whole in the capture (real upsertExitState)', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { db, dbModule } = sc.graph;
        const tradeId = Number(db.prepare("INSERT INTO trades (token, chain, action) VALUES (?, 'eth', 'buy')").run('0x00000000000000000000000000000000000d0a02').lastInsertRowid);
        const entryPrice = 0.1 + 0.2; // 0.30000000000000004: a JSON-building SQL function would print 0.3
        const highWater = 1 / 3;
        const urgency = 9007199254740993n; // 2^53 + 1: a plain JS number would read 9007199254740992
        const params = { tradeId, entryPrice, highWaterMark: highWater, trailingActivated: 0, partialTiersCompleted: '[]', originalTokenAmount: '1000000000000000000000', urgencyStartTs: urgency, volatilitySamples: '[]' };
        dbModule.upsertExitState.run(params);
        dbModule.upsertExitState.run({ ...params, highWaterMark: 2 / 3 });
        const writes = dbEntries(sc.timeline.entries, 'exit_state');
        // ON CONFLICT DO UPDATE reads as an update (RESEARCH Flag 4).
        expect(writes.map((w) => w.op)).toEqual(['insert', 'update']);
        expect(Object.is(writes[0].row.entry_price, 0.30000000000000004)).toBe(true);
        expect(Object.is(writes[0].row.high_water_mark, highWater)).toBe(true);
        expect(writes[0].row.urgency_start_ts).toBe(9007199254740993n);
        expect(writes[0].row.trade_id).toBe(BigInt(tradeId));
        expect(Object.is(writes[1].row.high_water_mark, 2 / 3)).toBe(true);
        expect(writes[1].row.urgency_start_ts).toBe(9007199254740993n);
    });

    it('Open Question 5: an ordinary autocommit insert records no violation', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        sc.graph.db.prepare("INSERT INTO trades (token, chain, action) VALUES (?, 'eth', 'buy')").run('0x00000000000000000000000000000000000a0c01');
        const insert = dbEntries(sc.timeline.entries, 'trades', 'insert').at(-1)!;
        expect(insert.inTransaction).toBe(false);
        expect(harnessState().violations).toEqual([]);
        expect(() => assertNoViolations()).not.toThrow();
    });

    // WR-05 (Phase 23 review): an atomic write is the idiomatic better-sqlite3 fix for several
    // Phase 24 findings (AUD-DB-004, AUD-BUY-004, AUD-BUY-010), so the capture must judge a
    // transaction by its outcome: a committed write is on the timeline, a rolled-back one is not,
    // and neither is a violation. Only a transaction still open when its connection closes is.
    it('WR-05: writes inside a committed db.transaction (made before the capture, as a module-level one is) are captured once each, at their write position, with no violation', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { db, dbModule } = sc.graph;
        const token = '0x00000000000000000000000000000000000a0c03';
        const row = { token, chain: 'eth', action: 'buy', txHash: '0x' + '0c'.repeat(32), block: 1, timestamp: Math.floor(Date.now() / 1000), amountIn: '1', amountOut: '2', gasCost: '0', priceAtAction: 0, status: 'pending', poolType: 'v2', feeTier: null, dexName: 'uniswap-v2' };
        // Made before installDbCapture runs on this connection again, as src/utils/db.ts would make
        // a module-level transaction at import (before loadGraph installs the capture).
        const atomic = db.transaction(() => {
            const info = dbModule.insertTrade.run(row);
            logger.info({ op: 'harness.inside-transaction' }, 'between the two writes');
            dbModule.upsertExitState.run({ tradeId: Number(info.lastInsertRowid), entryPrice: 1, highWaterMark: 1, trailingActivated: 0, partialTiersCompleted: '[]', originalTokenAmount: '2', urgencyStartTs: 0, volatilitySamples: '[]' });
            return info;
        });
        installDbCapture(db, sc.timeline);
        const before = sc.timeline.entries.length;
        const info = atomic();
        // The harness's own bookkeeping inside the trigger leaves the production RunResult alone.
        const stored = db.prepare('SELECT id FROM trades WHERE token = ?').get(token) as { id: number };
        expect(Number(info.lastInsertRowid)).toBe(stored.id);
        expect(info.changes).toBe(1);
        const added = sc.timeline.entries.slice(before);
        expect(added.map((e) => (e.kind === 'db' ? `db ${e.op} ${e.table}` : e.kind === 'op' ? `op ${e.op}` : e.kind))).toEqual(['db insert trades', 'op harness.inside-transaction', 'db insert exit_state']);
        const [tradeInsert, , exitInsert] = added as [DbEntry, TimelineEntry, DbEntry];
        expect(tradeInsert.inTransaction).toBe(true);
        expect(tradeInsert.row).toMatchObject({ id: BigInt(stored.id), token, status: 'pending' });
        expect(exitInsert.inTransaction).toBe(true);
        expect(exitInsert.row.trade_id).toBe(BigInt(stored.id));
        // Read again: settled once, never duplicated.
        expect(sc.timeline.entries.slice(before)).toHaveLength(3);
        expect(harnessState().violations).toEqual([]);
        expect(() => assertNoViolations()).not.toThrow();
        // A later autocommit write still lands after them, as before.
        dbModule.updateTradeStatus.run('failed', token, 'eth');
        expect(dbEntries(sc.timeline.entries, 'trades').map((e) => [e.op, e.inTransaction])).toEqual([['insert', true], ['update', false]]);
    });

    it('WR-05: a db.transaction that rolls back, even under a catch that swallows everything, leaves no entry and no violation', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const db = sc.graph.db;
        const insert = db.prepare("INSERT INTO trades (token, chain, action) VALUES (?, 'eth', 'buy')");
        const before = sc.timeline.entries.length;
        let caught: unknown;
        // A production-style catch: the capture must not depend on an error escaping it.
        try {
            db.transaction(() => {
                insert.run('0x00000000000000000000000000000000000a0c02');
                throw new Error('roll back');
            })();
        } catch (e) {
            caught = e;
        }
        expect((caught as Error).message).toBe('roll back');
        expect(db.prepare('SELECT COUNT(*) AS c FROM trades').get()).toEqual({ c: 0 });
        // The capture records what landed: nothing.
        expect(dbEntries(sc.timeline.entries.slice(before), 'trades')).toEqual([]);
        expect(harnessState().violations).toEqual([]);
        expect(() => assertNoViolations()).not.toThrow();
    });

    it('WR-05: a nested transaction rolled back inside a committed one drops only its own writes; raw BEGIN/COMMIT and BEGIN/ROLLBACK through db.exec are judged the same way', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const db = sc.graph.db;
        const insert = db.prepare("INSERT INTO trades (token, chain, action) VALUES (?, 'eth', 'buy')");
        const tokens = (): string[] => dbEntries(sc.timeline.entries, 'trades', 'insert').map((e) => String(e.row.token));
        const kept = '0x00000000000000000000000000000000000a0c10';
        const undone = '0x00000000000000000000000000000000000a0c11';
        const after = '0x00000000000000000000000000000000000a0c12';
        db.transaction(() => {
            insert.run(kept);
            try {
                db.transaction(() => {
                    insert.run(undone);
                    throw new Error('inner rolls back');
                })();
            } catch {
                // swallowed, as a production catch would
            }
            insert.run(after);
        })();
        expect((db.prepare('SELECT token FROM trades ORDER BY id').all() as Array<{ token: string }>).map((r) => r.token)).toEqual([kept, after]);
        expect(tokens()).toEqual([kept, after]);

        const rawKept = '0x00000000000000000000000000000000000a0c13';
        const rawUndone = '0x00000000000000000000000000000000000a0c14';
        db.exec('BEGIN');
        insert.run(rawKept);
        // While the transaction is open the write has not landed, so it is not on the timeline yet.
        expect(tokens()).toEqual([kept, after]);
        db.exec('COMMIT');
        expect(tokens()).toEqual([kept, after, rawKept]);
        db.exec('BEGIN');
        insert.run(rawUndone);
        db.exec('ROLLBACK');
        expect(tokens()).toEqual([kept, after, rawKept]);
        expect(harnessState().violations).toEqual([]);
    });

    it('WR-05: a transaction still open when its connection closes is a violation naming the table, and its write is not on the timeline', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const db = sc.graph.db;
        db.exec('BEGIN');
        db.prepare("INSERT INTO trades (token, chain, action) VALUES (?, 'eth', 'buy')").run('0x00000000000000000000000000000000000a0c20');
        sc.graph.dbModule.closeDb();
        expect(db.open).toBe(false);
        expect(dbEntries(sc.timeline.entries, 'trades')).toEqual([]);
        expect(() => assertNoViolations()).toThrow(/capture violation: an insert on table trades was written inside a transaction that was still open when the connection closed/);
        expect(takeViolations()).toEqual([{ kind: 'db-transaction-open', table: 'trades', op: 'insert' }]);
        expect(() => assertNoViolations()).not.toThrow();
    });

    it('D-05: unixepoch() with an argument never throws into SQLite; it answers the fake second and fails the test from afterEach', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const row = sc.graph.db.prepare('SELECT unixepoch(?) AS t').get('now') as { t: number };
        expect(row.t).toBe(Math.floor(Date.now() / 1000));
        expect(() => assertNoViolations()).toThrow(/unixepoch\(\) was called with arguments \["now"\]/);
        expect(takeViolations()).toEqual([{ kind: 'unixepoch-argument', args: ['now'] }]);
    });

    it('RESEARCH Pitfall 5: after a second loadGraph the new connection is captured too', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const graph2 = await loadGraph();
        try {
            expect(graph2.db).not.toBe(sc.graph.db);
            expect(sc.graph.db.open).toBe(false);
            graph2.db.prepare("INSERT INTO trades (token, chain, action) VALUES (?, 'eth', 'buy')").run('0x00000000000000000000000000000000000b0002');
            const insert = dbEntries(sc.timeline.entries, 'trades', 'insert').at(-1)!;
            expect(insert.row.token).toBe('0x00000000000000000000000000000000000b0002');
            // And its SQL clock is the fake one.
            expect(insert.row.timestamp).toBe(BigInt(Math.floor(Date.now() / 1000)));
        } finally {
            graph2.dbModule.closeDb();
        }
    });

    it('logs: a log call with no op field is on the plain log list and never on the timeline; an op call is on both', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const before = sc.timeline.entries.length;
        logger.info('Preflight passed');
        logger.warn({ token: '0xabc' }, 'a decision line with fields but no op');
        logger.info({ op: 'harness.selftest', n: 1 }, 'an op line');
        const logs = recordedLogs();
        expect(logs.some((l) => l.msg === 'Preflight passed' && l.level === 'info' && l.obj === undefined)).toBe(true);
        expect(logs.some((l) => l.msg === 'a decision line with fields but no op' && l.level === 'warn' && l.obj?.token === '0xabc')).toBe(true);
        const added = sc.timeline.entries.slice(before);
        expect(added).toEqual([{ kind: 'op', level: 'info', op: 'harness.selftest', msg: 'an op line', fields: { op: 'harness.selftest', n: 1 }, bindings: {}, at: Date.now() }]);
        expect(textOf(sc.timeline.entries)).not.toContain('Preflight passed');
        expect(textOf(sc.timeline.entries)).not.toContain('a decision line with fields but no op');
    });

    it('alerts: the real buy leaves its exact "*New Token Detected!*" text on recordedAlerts, sent through sendCtxAlert for eth, and no alert text on the timeline', async () => {
        const { sc } = await driveBuy();
        const detected = recordedAlerts().filter((a) => typeof a.message === 'string' && a.message.startsWith('*New Token Detected!*'));
        expect(detected).toHaveLength(1);
        const alert = detected[0];
        expect(alert.via).toBe('ctx');
        expect(alert.chain).toBe('eth');
        const text = alert.message as string;
        expect(text.startsWith('*New Token Detected!*\nSymbol: `RPLT`\nDecimals: `18`\n')).toBe(true);
        expect(text).toContain('\nLocked: `Yes`\nHoneypot: `No`\n');
        expect(text).toContain(`Token: [\`${sc.token}\`](${sc.ctx.chain.explorerUrl}/token/${sc.token})`);
        expect(text).toContain(`Pair: [\`${sc.pair}\`](${sc.ctx.chain.explorerUrl}/address/${sc.pair})`);
        // Alerts never feed the recording (AC-20; plan 23-20's secret scan relies on it).
        const timelineText = textOf(sc.timeline.entries);
        for (const a of recordedAlerts()) expect(timelineText).not.toContain(String(a.message));
        expect(new Set(sc.timeline.entries.map((e) => e.kind))).toEqual(new Set(['op', 'submit', 'relay', 'db']));
    });

    it('a new scenario starts with empty alert and log lists and a fresh timeline', async () => {
        logger.info({ op: 'harness.before-scenario' }, 'logged before the scenario');
        await sendTelegramAlert('an alert sent before the scenario');
        expect(recordedAlerts()).toEqual([{ via: 'telegram', chain: null, message: 'an alert sent before the scenario' }]);
        const earlier = harnessState().timeline;
        expect(earlier?.entries.some((e) => e.kind === 'op' && e.op === 'harness.before-scenario')).toBe(true);

        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        expect(recordedAlerts()).toEqual([]);
        expect(recordedLogs().some((l) => l.msg === 'logged before the scenario')).toBe(false);
        expect(sc.timeline).not.toBe(earlier);
        expect(sc.timeline.entries.some((e) => e.kind === 'op' && e.op === 'harness.before-scenario')).toBe(false);
    });
});

describe('realpath harness: the known-bug marker (plan 23-02 Task 2, D-07, D-08)', () => {
    const plain = { expectedPlain: 'Five units are owed.', actualPlain: 'Four units are owed.' };

    it('D-07: still broken exactly as recorded passes and records the proof on task meta, BigInt as text', (ctx) => {
        knownBug(ctx, 'HARNESS-SELFTEST', { claim: 'selftest-still-broken', correct: { owed: 5n }, observed: { owed: 4n }, actual: { owed: 4n }, ...plain });
        const expected = [{ id: 'HARNESS-SELFTEST', claim: 'selftest-still-broken', expected: { owed: '5' }, actual: { owed: '4' }, expectedPlain: 'Five units are owed.', actualPlain: 'Four units are owed.' }];
        expect(ctx.task.meta.knownBugs).toEqual(expected);
        // What the JSON reporter writes (E10): the stored record survives JSON as is.
        expect(JSON.parse(JSON.stringify(ctx.task.meta)).knownBugs).toEqual(expected);
    });

    it('D-08: a marked value that now equals the correct one throws the looks-fixed message and records nothing', (ctx) => {
        const e = thrown(() => knownBug(ctx, 'HARNESS-SELFTEST', { claim: 'selftest-fixed', correct: { owed: 5n }, observed: { owed: 4n }, actual: { owed: 5n }, ...plain }));
        expect(e.message).toBe('HARNESS-SELFTEST now behaves correctly: remove this marker (it looks fixed)');
        expect(ctx.task.meta.knownBugs).toBeUndefined();
    });

    it('D-07: any third value fails with the failure-changed message and records nothing', (ctx) => {
        const e = thrown(() => knownBug(ctx, 'HARNESS-SELFTEST', { claim: 'selftest-changed', correct: { owed: 5n }, observed: { owed: 4n }, actual: { owed: 3n }, ...plain }));
        expect(e.message.startsWith('HARNESS-SELFTEST: the failure changed from what was recorded')).toBe(true);
        expect(e.message).toContain('3n');
        expect(e.message).toContain('4n');
        expect(ctx.task.meta.knownBugs).toBeUndefined();
    });

    it('AC-11: a shared-cause file calls the marker once per claim, and task meta holds both entries', (ctx) => {
        knownBug(ctx, 'HARNESS-SELFTEST', { claim: 'selftest-first-claim', correct: 'locked', observed: 'unlocked', actual: 'unlocked', expectedPlain: 'The pair reads locked.', actualPlain: 'The pair reads unlocked.' });
        knownBug(ctx, 'HARNESS-SELFTEST', { claim: 'selftest-second-claim', correct: [1n, 2n], observed: [1n], actual: [1n], expectedPlain: 'Two transactions are sent.', actualPlain: 'One transaction is sent.' });
        const bugs = ctx.task.meta.knownBugs!;
        expect(bugs).toHaveLength(2);
        expect(bugs.map((b) => [b.id, b.claim, b.expected, b.actual])).toEqual([
            ['HARNESS-SELFTEST', 'selftest-first-claim', 'locked', 'unlocked'],
            ['HARNESS-SELFTEST', 'selftest-second-claim', ['1', '2'], ['1']],
        ]);
    });

    it('D-07: a malformed marker is refused before any assertion (claim not kebab-case, correct equal to observed, a repeated claim)', (ctx) => {
        expect(thrown(() => knownBug(ctx, 'HARNESS-SELFTEST', { claim: 'Not Kebab', correct: 1, observed: 2, actual: 2, ...plain })).message).toMatch(/claim must be a short kebab-case literal/);
        expect(thrown(() => knownBug(ctx, 'HARNESS-SELFTEST', { claim: 'selftest-same', correct: 2, observed: 2, actual: 2, ...plain })).message).toMatch(/correct and observed are equal/);
        knownBug(ctx, 'HARNESS-SELFTEST', { claim: 'selftest-once', correct: 1, observed: 2, actual: 2, ...plain });
        expect(thrown(() => knownBug(ctx, 'HARNESS-SELFTEST', { claim: 'selftest-once', correct: 1, observed: 2, actual: 2, ...plain })).message).toMatch(/claim selftest-once is already recorded in this test/);
        expect(ctx.task.meta.knownBugs?.map((b) => b.claim)).toEqual(['selftest-once']);
    });

    it('D-07: the marker catches nothing else: an error raised while it compares reaches the test unchanged', (ctx) => {
        const broken = {
            get owed(): bigint {
                throw new TypeError('a broken value, not the bug');
            },
        };
        const e = thrown(() => knownBug(ctx, 'HARNESS-SELFTEST', { claim: 'selftest-broken-value', correct: { owed: 5n }, observed: { owed: 4n }, actual: broken as { owed: bigint }, ...plain }));
        expect(e).toBeInstanceOf(TypeError);
        expect(e.message).toBe('a broken value, not the bug');
        expect(ctx.task.meta.knownBugs).toBeUndefined();
    });
});
