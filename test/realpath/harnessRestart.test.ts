// test/realpath/harnessRestart.test.ts
// Phase 23 plan 23-27 (CHAR-01): the harness can show a restart and a second process.
//   - Task 1: a graph on a temp-file database survives restartGraph. A real V2 buy leaves its
//     exit_state row; after the restart the row is read through the NEW connection and the real
//     resumeMultiChainMonitoring takes the resume branch (exit.monitor.resumed), not a fresh
//     start. A database file outside the OS temp folder is refused before any src/ import, the
//     disposer removes the temp folder, and alerts recorded before a restart are still there.
// Only the logger, notifier, broadcaster, axios and the Telegram library are mocked
// (harness/setup.ts); the chain is a transport seam (harness/chain.ts).
//
// The better-sqlite3 handle is named `db` (test/unit/rails/spawnSites.test.ts accepts `.exec()`
// only on named receivers).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { harnessState } from './harness/chain';
import { recordedAlerts, recordedLogs, type OpEntry } from './harness/capture';
import { createScenario, createTempDbFile, loadGraph, restartGraph, stepFor, stepUntilTrue, type Scenario } from './harness/world';
import { sendTelegramAlert } from '../../src/utils/notifier';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function opLogged(op: string, from = 0): boolean {
    return recordedLogs().slice(from).some((l) => l.obj?.op === op);
}

/**
 * The AC-01 buy (plan 23-01) on the given scenario: a real PairCreated through the real
 * listener, the real Flashbots bundle mined at its target, then the position armed (trades row,
 * exit monitor with its exit_state row, anti-rug subscription, block cursor at the head).
 */
async function buyAndArm(sc: Scenario<'v2'>): Promise<{ buyHash: string }> {
    const { node, graph, ctx, dex } = sc;
    await graph.bot.startDexListener(ctx, dex, sc.registry);
    await stepUntilTrue(
        () => node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === dex.factoryAddress.toLowerCase()),
        { what: 'the listener subscribing to PairCreated on the factory' },
    );
    await sc.fireNewPair();
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
    return { buyHash };
}

describe('realpath harness: restart on a temp-file database (plan 23-27 Task 1)', () => {
    it('a real V2 buy keeps its exit_state row across restartGraph, read through the new connection, and the real resumeMultiChainMonitoring resumes it instead of starting fresh', async () => {
        const file = createTempDbFile();
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file } });
        const { buyHash } = await buyAndArm(sc);

        // The graph really runs on the file (src/utils/db.ts's own answer), in WAL mode.
        expect(path.resolve(sc.graph.dbModule.getDbFilePath())).toBe(path.resolve(file));
        expect(sc.graph.db.pragma('journal_mode', { simple: true })).toBe('wal');

        const trade = sc.graph.db.prepare("SELECT id, status, action, tx_hash FROM trades WHERE action = 'buy'").get() as { id: number; status: string; action: string; tx_hash: string };
        expect(trade).toMatchObject({ status: 'pending', action: 'buy', tx_hash: buyHash });
        const before = sc.graph.db.prepare('SELECT * FROM exit_state WHERE trade_id = ?').get(trade.id) as Record<string, unknown> | undefined;
        expect(before).toBeDefined();
        const alertsBefore = [...recordedAlerts()];
        expect(alertsBefore.some((a) => String(a.message).includes('New Token Detected'))).toBe(true);
        const timelineBefore = sc.timeline.entries.length;

        const oldGraph = sc.graph;
        const oldCtx = sc.ctx;
        const restarted = await restartGraph(sc);
        expect(restarted).toBe(sc);
        expect(sc.graph).not.toBe(oldGraph);
        expect(sc.ctx).not.toBe(oldCtx);
        expect(oldGraph.db.open).toBe(false);
        expect(sc.graph.db.open).toBe(true);
        expect(path.resolve(sc.graph.dbModule.getDbFilePath())).toBe(path.resolve(file));

        // The row is on the NEW connection, with the values stored before the restart.
        const after = sc.graph.db.prepare('SELECT * FROM exit_state WHERE trade_id = ?').get(trade.id) as Record<string, unknown> | undefined;
        expect(after).toEqual(before);
        expect(sc.graph.db.prepare('SELECT status FROM trades WHERE id = ?').get(trade.id)).toEqual({ status: 'pending' });

        // The capture and the SQL clock are on the new connection (Pitfall 5): unixepoch() reads
        // the fake clock, and a write through a real statement lands on the same timeline.
        expect(sc.graph.db.prepare('SELECT unixepoch() AS t').get()).toEqual({ t: Math.floor(Date.now() / 1000) });
        const nowSec = Math.floor(Date.now() / 1000);
        sc.graph.dbModule.setAntirugDryRunStarted.run('eth', nowSec, nowSec);
        expect(sc.timeline.entries.slice(timelineBefore).some((e) => e.kind === 'db' && e.table === 'chain_state' && e.op === 'update')).toBe(true);

        // The real resume path, on the new graph.
        const fromLog = recordedLogs().length;
        sc.graph.bot.resumeMultiChainMonitoring([sc.ctx]);
        await stepUntilTrue(() => opLogged('exit.monitor.resumed', fromLog), { what: 'the exit monitor resuming from the stored exit_state row' });
        const resumed = sc.timeline.entries.filter((e): e is OpEntry => e.kind === 'op' && e.op === 'exit.monitor.resumed');
        expect(resumed).toHaveLength(1);
        expect(resumed[0].fields.tradeId).toBe(trade.id);
        expect(resumed[0].fields.token).toBe(sc.token.toLowerCase());
        // No fresh-state start: neither the pre-Phase-7 branch nor a new exit monitor.
        const sinceResume = recordedLogs().slice(fromLog);
        expect(sinceResume.some((l) => l.msg === 'Created fresh exit state for pre-Phase7 trade')).toBe(false);
        expect(sinceResume.some((l) => l.obj?.op === 'exit.monitor.started')).toBe(false);
        expect(sc.graph.db.prepare('SELECT count(*) AS n FROM exit_state').get()).toEqual({ n: 1 });

        // A restart is the same scenario continuing: what happened before it is still recorded.
        expect(recordedAlerts().slice(0, alertsBefore.length)).toEqual(alertsBefore);
        expect(sc.timeline.entries.slice(0, timelineBefore).some((e) => e.kind === 'submit' && e.hash === buyHash)).toBe(true);
    });

    it('a database file outside the OS temp folder is refused before any src/ import, and no file is created for it', async () => {
        const pid = process.pid;
        const outside = [
            path.join(REPO_ROOT, 'test', 'realpath', `refused-${pid}.db`),
            path.join(os.tmpdir(), '..', `refused-escape-${pid}.db`),
            `refused-relative-${pid}.db`,
            os.tmpdir(),
            ':memory:',
        ];
        const envBefore = process.env.DB_PATH;
        for (const file of outside) {
            const logsBefore = recordedLogs().length;
            await expect(loadGraph({ db: { file } }), file).rejects.toThrow(/refused database file .*inside the operating system's temp folder/);
            // Nothing from src/ ran: no log line, no DB_PATH change, no file.
            expect(recordedLogs().length, file).toBe(logsBefore);
            expect(process.env.DB_PATH, file).toBe(envBefore);
            if (file !== ':memory:' && file !== os.tmpdir()) expect(fs.existsSync(path.resolve(REPO_ROOT, file)), file).toBe(false);
        }

        // Through createScenario too, and the memory mode refuses a DB_PATH smuggled in through
        // an override, so no path can bypass the rule.
        const inRepo = outside[0];
        await expect(createScenario({ chain: 'eth', dexType: 'v2', db: { file: inRepo } })).rejects.toThrow(/refused database file/);
        expect(recordedLogs()).toHaveLength(0);
        await expect(createScenario({ chain: 'eth', dexType: 'v2', overrides: { DB_PATH: inRepo } })).rejects.toThrow(/refused DB_PATH .* in memory mode/);
        expect(recordedLogs()).toHaveLength(0);
        expect(fs.existsSync(inRepo)).toBe(false);
        expect(process.env.DB_PATH).toBe(envBefore);

        // The control: a temp file is accepted, and the same proxy shows src/ ran for it.
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() } });
        expect(recordedLogs().length).toBeGreaterThan(0);
        expect(fs.existsSync(sc.graph.dbModule.getDbFilePath())).toBe(true);
    });

    it('the scenario disposer removes the temp database folder, and restartGraph refuses an in-memory scenario', async () => {
        const file = createTempDbFile();
        const dir = path.dirname(file);
        expect(path.relative(os.tmpdir(), dir).startsWith('..')).toBe(false);
        expect(fs.existsSync(dir)).toBe(true);
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file } });
        expect(fs.existsSync(file)).toBe(true);
        expect(harnessState().tempDbDirs).toContain(dir);
        await sc.dispose();
        expect(sc.graph.db.open).toBe(false);
        expect(fs.existsSync(dir)).toBe(false);
        expect(harnessState().tempDbDirs).not.toContain(dir);
        await expect(restartGraph(sc)).rejects.toThrow(/already disposed/);

        const mem = await createScenario({ chain: 'eth', dexType: 'v2' });
        await expect(restartGraph(mem)).rejects.toThrow(/in-memory database, which no restart can keep/);
    });

    it('an alert recorded before restartGraph is still on recordedAlerts() after it', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() } });
        await sendTelegramAlert('realpath restart: an alert before the restart');
        const before = [...recordedAlerts()];
        expect(before).toEqual([{ via: 'telegram', chain: null, message: 'realpath restart: an alert before the restart' }]);
        const logsBefore = recordedLogs().length;
        await restartGraph(sc, { env: { REALPATH_RESTART_MARK: '1' } });
        expect(process.env.REALPATH_RESTART_MARK).toBe('1');
        expect(recordedAlerts()).toEqual(before);
        // The logs list kept its entries too, and the new graph's own lines come after them.
        expect(recordedLogs().length).toBeGreaterThan(logsBefore);
        expect(harnessState().timeline).toBe(sc.timeline);
    });
});
