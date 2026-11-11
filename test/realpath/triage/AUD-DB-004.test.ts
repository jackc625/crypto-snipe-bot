// test/realpath/triage/AUD-DB-004.test.ts
// Phase 23 plan 23-11 Task 3 (AUDIT-02, RC-14): AUD-DB-004 and AUD-DB-021, one root cause, two
// entries, each asserted on its own (AC-11).
//
// AUD-DB-004, the site. src/bot.ts handleNewPairForChain (V2 snipe; the V3 snipe is the same order)
// awaits submitBuyTx, which covers every private attempt and its confirm window, and only after it
// returns calls recordSnipe and the trades insert, the first and only durable record of the buy.
// The signed bundle can be included while that await is still pending.
//
// Proof on the real path (D-13, AC-12): a real ETH V2 snipe (the AC-01 path). Its one signed bundle
// targets the next three blocks (MEV_BUY_TARGET_BLOCKS 3). The chain is driven so the buy lands
// late: the first two target blocks are mined without it (each slot passes, then an empty block,
// as at a builder that did not include it; fixtures/AUD-TX-002-lock.ts missBundlesUntil), and the
// third includes it (fixtures/AUD-API-001-dashboard-sell.ts driveChain 'land'). Forced by mined
// blocks and fake time only. Positions are read from timeline.entries (never timestamps):
//   - the first submit of the buy's nonce from the bot's wallet;
//   - the moment the buy is mined (the timeline length when the drive first sees it mined, before
//     the bot has stepped again);
//   - any db entry (any table, insert or update) whose row names the token or a submitted hash of
//     the buy, which is what any durable record of this buy would be.
// Correct: a durable record exists before the first submission, and therefore when the buy lands.
// Observed: neither; the trades insert comes after the submit and after every relay body of the
// buy, and while the bundle was held and at the moment it was mined the table had no row.
// A fix that writes a buy intent row before the first submission (the finding's recommendation,
// into trades or a new table) reads "looks fixed" (D-08). The trades row's exact position and the
// empty table in the held window are asserted after the marker.
//
// Sub-claim 2 (the first shutdown signal closes the database without waiting for an in-flight buy)
// lives in the private shutdown handler built by startMultiChainBot, which this phase never boots,
// and stays code-read; sub-claim 4 (no boot reconciliation of wallet holdings) stays code-read.
//
// AUD-DB-021: src/utils/db.ts sets journal_mode WAL and synchronous NORMAL on its connection. The
// test reads PRAGMA synchronous from the bot's own connection, on a temp database file, right after
// that connection wrote a real buy's position record. Correct: FULL (2) or stricter for that
// record. Observed: NORMAL (1), the value recorded in the finding. What NORMAL means on a power loss
// or an OS crash (the last commits of a WAL database can be rolled back; a process crash alone loses
// nothing) is documented SQLite behavior that no test can prove; this test proves only the setting.
// Setting synchronous to FULL in db.ts reads "looks fixed".
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import type { DbEntry, SubmitEntry, TimelineEntry } from '../harness/capture';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, createTempDbFile, stepUntilTrue, type Scenario } from '../harness/world';
import { driveChain } from './fixtures/AUD-API-001-dashboard-sell';
import { buyAndMine, buyRow, listen, opLogged, waitAntiRugArmed } from './fixtures/AUD-EXIT-002-position';
import { missBundlesUntil, settleAntiRugArming } from './fixtures/AUD-TX-002-lock';

/** JSON with BigInt as whole-number text, lower-cased, for searching a row. */
function rowText(v: unknown): string {
    return JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x)).toLowerCase();
}

function tradeRowCount(sc: Scenario): number {
    return (sc.graph.db.prepare('SELECT COUNT(*) AS n FROM trades WHERE token = ?').get(sc.token.toLowerCase()) as { n: number }).n;
}

describe('AUD-DB-004 and AUD-DB-021: a landed buy has no durable record until its submission returns, on a connection at synchronous NORMAL (RC-14)', () => {
    it('row-written-after-submit: a buy that lands in its third target block had no database record at its first submission or when it was mined', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node } = sc;
        const entries: TimelineEntry[] = sc.timeline.entries;
        const wallet = sc.wallet.address.toLowerCase();
        const token = sc.token.toLowerCase();
        expect(process.env.MEV_BUY_TARGET_BLOCKS).toBe('3');
        await listen(sc);

        await sc.fireNewPair();
        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting its buy bundle', maxSteps: 20_000 });
        const first = node.submitted[0];
        const nonce = first.tx.nonce;
        const startHead = node.head;
        expect(first.route).toBe('bundle');
        expect(first.targetBlocks).toEqual([startHead + 1, startHead + 2, startHead + 3]);

        // The held window: two target blocks pass without the buy.
        let rowDuringHold = false;
        await missBundlesUntil(sc, {
            until: () => {
                if (tradeRowCount(sc) > 0) rowDuringHold = true;
                return node.head >= startHead + 2;
            },
            what: 'the first two target blocks passing without the buy',
        });
        // Then a builder includes it.
        const buySubmits = (): SubmitEntry[] => entries.filter((e): e is SubmitEntry => e.kind === 'submit' && e.from.toLowerCase() === wallet && e.nonce === nonce);
        let landedAt = -1;
        let rowsWhenLanded = -1;
        let landedHash = '';
        await driveChain(sc, {
            mode: 'land',
            until: () => {
                const mined = buySubmits().find((s) => node.statusOf(s.hash) === 'mined');
                if (mined && landedAt < 0) {
                    landedAt = entries.length;
                    rowsWhenLanded = tradeRowCount(sc);
                    landedHash = mined.hash;
                }
                return mined !== undefined;
            },
            what: 'the buy landing in a later target block',
        });
        await stepUntilTrue(() => recordedLogs().some((l) => l.msg === 'MEV bundle submitted'), { what: 'the buy path returning', maxSteps: 20_000 });
        await waitAntiRugArmed(sc);
        await settleAntiRugArming(sc, 1);
        // Setup facts, true under the bug and every fix: the first signed buy landed in its third
        // target block, two blocks late.
        expect(landedAt).toBeGreaterThan(0);
        expect(landedHash).toBe(first.hash);
        expect(node.submitted.find((s) => s.hash === landedHash)?.block).toBe(startHead + 3);

        const hashes = new Set(buySubmits().map((s) => s.hash.toLowerCase()));
        const firstSubmitIdx = entries.findIndex((e) => e.kind === 'submit' && e.from.toLowerCase() === wallet && e.nonce === nonce);
        const recordsBuy = (e: TimelineEntry): e is DbEntry => {
            if (e.kind !== 'db' || e.op === 'delete') return false;
            const text = rowText(e.row);
            return text.includes(token) || [...hashes].some((h) => text.includes(h));
        };
        const recordIdx = entries.findIndex(recordsBuy);
        const before = (idx: number): boolean => recordIdx >= 0 && recordIdx < idx;

        knownBug(ctx, 'AUD-DB-004', {
            claim: 'row-written-after-submit',
            correct: { recordBeforeFirstSubmit: true, recordWhenLanded: true },
            observed: { recordBeforeFirstSubmit: false, recordWhenLanded: false },
            actual: { recordBeforeFirstSubmit: before(firstSubmitIdx), recordWhenLanded: before(landedAt) },
            expectedPlain: 'A buy is written to the database before its first submission, so a stop or crash while the bundle is pending can never leave a held token the bot does not know about.',
            actualPlain: 'The buy bundle was sent, missed two blocks and landed in the third, and through all of it the database held no record of the buy: the trades row was written only after the submission returned, so a stop or crash in that window strands the bought tokens.',
        });

        // Details: the trades insert sits after the submit and after every relay body of the buy, and
        // the table was empty while the bundle was held and when it was mined.
        const tradesInsertIdx = entries.findIndex((e) => e.kind === 'db' && e.table === 'trades' && e.op === 'insert');
        expect(recordIdx).toBe(tradesInsertIdx);
        expect(tradesInsertIdx).toBeGreaterThan(firstSubmitIdx);
        expect(tradesInsertIdx).toBeGreaterThan(landedAt);
        const rawHex = first.raw.slice(2).toLowerCase();
        const relayIdxs = entries.flatMap((e, i) => (e.kind === 'relay' && rowText(e.params).includes(rawHex) ? [i] : []));
        expect(relayIdxs.length).toBeGreaterThanOrEqual(4);
        expect(Math.max(...relayIdxs)).toBeLessThan(tradesInsertIdx);
        const lastRelayIdx = entries.reduce((last, e, i) => (e.kind === 'relay' && i < tradesInsertIdx ? i : last), -1);
        expect(lastRelayIdx).toBeLessThan(tradesInsertIdx);
        expect(rowDuringHold).toBe(false);
        expect(rowsWhenLanded).toBe(0);
        expect(entries[tradesInsertIdx]).toMatchObject({ kind: 'db', table: 'trades', op: 'insert', row: { token, action: 'buy', status: 'pending', tx_hash: landedHash } });
        expect(buyRow(sc)?.status).toBe('pending');
        expect(opLogged('exit.monitor.started')).toBe(true);
    });

    it('synchronous-normal: the connection that wrote a real buy\'s position record runs at PRAGMA synchronous NORMAL in WAL mode', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() } });
        await listen(sc);
        await buyAndMine(sc);
        await stepUntilTrue(() => buyRow(sc)?.status === 'pending', { what: 'the buy row', maxSteps: 20_000 });
        await waitAntiRugArmed(sc);
        await settleAntiRugArming(sc, 1);
        // Setup facts: the bot's own connection, on a real file, holds the position it just wrote.
        expect(sc.graph.db.open).toBe(true);
        expect(sc.graph.db.memory).toBe(false);
        expect(sc.graph.dbModule.getDbFilePath()).toBeTruthy();
        const synchronous = sc.graph.db.pragma('synchronous', { simple: true }) as number;

        knownBug(ctx, 'AUD-DB-021', {
            claim: 'synchronous-normal',
            correct: { atLeastFull: true },
            observed: { atLeastFull: false },
            actual: { atLeastFull: synchronous >= 2 },
            expectedPlain: 'The connection that writes position records runs at PRAGMA synchronous FULL (or stricter), so a just-written position survives a power loss or OS crash.',
            actualPlain: 'The bot\'s database connection runs WAL at PRAGMA synchronous NORMAL (1), so the last committed position rows can be rolled back by a power loss or OS crash (documented SQLite behavior; a process crash alone loses nothing). The test proves the setting, not the power loss.',
        });
        expect(synchronous).toBe(1);
        expect(sc.graph.db.pragma('journal_mode', { simple: true })).toBe('wal');
    });
});
