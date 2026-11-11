// test/realpath/harnessRestart.test.ts
// Phase 23 plan 23-27 (CHAR-01): the harness can show a restart and a second process.
//   - Task 1: a graph on a temp-file database survives restartGraph. A real V2 buy leaves its
//     exit_state row; after the restart the row is read through the NEW connection and the real
//     resumeMultiChainMonitoring takes the resume branch (exit.monitor.resumed), not a fresh
//     start. A database file outside the OS temp folder is refused before any src/ import, the
//     disposer removes the temp folder, and alerts recorded before a restart are still there.
//   - Task 2: a real railed child process (fixtures/sharedDbChild.ts) reaches the same FakeNode
//     over a real loopback HTTP port (serveLoopback) and writes through the real insertTrade into
//     the same temp file, and the parent reads the row through its own real connection; a control
//     child on another file leaves the parent's table empty. A real child's ethers
//     WebSocketProvider (fixtures/wsSubscribeChild.ts) subscribes over a real loopback socket,
//     gets the log its filter matches and not the other, and each mined head. Each child's own
//     rail ledger shows loopback connections only. autoMine is proven on the in-process seam.
// Only the logger, notifier, broadcaster, axios and the Telegram library are mocked
// (harness/setup.ts); the chain is a transport seam (harness/chain.ts).
//
// The better-sqlite3 handle is named `db` (test/unit/rails/spawnSites.test.ts accepts `.exec()`
// only on named receivers).

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { Interface, JsonRpcProvider, Network, Wallet, ethers, parseEther } from 'ethers';
import { FakeNode, harnessState, installSeams, labelAddress } from './harness/chain';
import { recordedAlerts, recordedLogs, type OpEntry } from './harness/capture';
import { runRailedChildToEnd, serveLoopback, type ChildRun } from './harness/loopback';
import { createScenario, createTempDbFile, loadGraph, restartGraph, stepFor, stepUntil, stepUntilTrue, useFixedClock, type Scenario } from './harness/world';
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

// ---------------------------------------------------------------------------------------------
// Task 2: a real second process on one database and one chain
// ---------------------------------------------------------------------------------------------

const CHILD_TIMEOUT_MS = 110_000;
const TEST_TIMEOUT_MS = 120_000;
const TS_NODE = ['-r', 'ts-node/register/transpile-only'];
const LEDGER_ROOT = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger');

let caseCounter = 0;
/**
 * A case ledger ID for one child (Date.now() is frozen under the fixed clock, so a random part
 * keeps IDs unique across runs). Its folder is removed in afterEach if the test did not take it.
 */
function newCaseId(label: string): string {
    caseCounter += 1;
    const id = `case-realpath-${label}-${process.pid}-${caseCounter}-${Math.random().toString(36).slice(2, 10)}`;
    harnessState().disposers.push(async () => fs.rmSync(path.join(LEDGER_ROOT, id), { recursive: true, force: true }));
    return id;
}

interface LedgerEntry {
    kind: string;
    target?: { host?: string; class?: string } | string | null;
}

/** Every process's rail ledger in one case folder (the child's own), then the folder removed. */
function takeCaseLedger(runId: string): LedgerEntry[] {
    const dir = path.join(LEDGER_ROOT, runId);
    const entries: LedgerEntry[] = [];
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue;
        for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) if (line.trim() !== '') entries.push(JSON.parse(line) as LedgerEntry);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return entries;
}

/** The child ran railed, reached the network only on loopback, and was denied nothing. */
function expectLoopbackOnly(entries: LedgerEntry[]): void {
    expect(entries.some((e) => e.kind === 'worker-start')).toBe(true);
    const allowed = entries.filter((e) => e.kind === 'net-allow');
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed.filter((e) => typeof e.target !== 'object' || e.target === null || e.target.class !== 'loopback')).toEqual([]);
    expect(entries.filter((e) => /deny|blocked|tripwire/.test(e.kind))).toEqual([]);
}

function describeRun(r: ChildRun): string {
    return `status ${r.status} signal ${r.signal}\nstdout:\n${r.stdout.slice(-3000)}\nstderr:\n${r.stderr.slice(-3000)}`;
}

/** Wait for `n` subscriptions on the node, failing by name if the child ends first. */
async function untilSubscribed(node: FakeNode, n: number, run: Promise<ChildRun>): Promise<void> {
    const ended = run.then((r) => r);
    ended.catch(() => undefined);
    const first = await Promise.race([node.waitForSubscriptions(n).then(() => null), ended]);
    if (first !== null) throw new Error(`the child ended before ${n} subscriptions existed: ${describeRun(first)}`);
}

/** A node with no bot graph, under the fixed clock, torn down by the same afterEach. */
function bareNode(chainId = 1): FakeNode {
    const st = harnessState();
    const installedClock = !vi.isFakeTimers();
    useFixedClock();
    const node = new FakeNode({ chainId });
    st.node = node;
    st.nodes.push(node);
    st.disposers.push(async () => {
        node.releaseAll();
        if (st.node === node) st.node = null;
        if (installedClock && vi.isFakeTimers()) vi.useRealTimers();
    });
    return node;
}

const V2_PAIR = new Interface(['event Sync(uint112 reserve0, uint112 reserve1)', 'event Transfer(address indexed from, address indexed to, uint256 value)']);

describe('realpath harness: a real child shares the database and the chain (plan 23-27 Task 2)', () => {
    it(
        'a real child reads the node over loopback HTTP and writes a row through the real insertTrade that the parent reads through its own real connection on the same file',
        async () => {
            const file = createTempDbFile();
            const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file } });
            const lb = await serveLoopback(sc.node);
            expect(sc.graph.db.prepare('SELECT count(*) AS n FROM trades').get()).toEqual({ n: 0 });
            const ledgerRunId = newCaseId('shared-db');
            const run = await runRailedChildToEnd('node', [...TS_NODE, 'test/realpath/fixtures/sharedDbChild.ts', sc.token], {
                envOverrides: { DB_PATH: file, ETH_RPC_URL: lb.httpUrl, ETH_WS_URL: lb.wsUrl },
                timeoutMs: CHILD_TIMEOUT_MS,
                ledgerRunId,
            });
            expect(run.status, describeRun(run)).toBe(0);
            const done = run.stdout.split(/\r?\n/).filter((l) => l.startsWith('CHILD_DONE '));
            expect(done, describeRun(run)).toEqual([`CHILD_DONE ${sc.node.head} ${sc.token.toLowerCase()}`]);
            // The node saw the child's own request, on the loopback HTTP port.
            const childCalls = sc.node.callLog.filter((c) => c.url === lb.httpUrl);
            expect(childCalls.map((c) => c.method)).toContain('eth_blockNumber');
            expect(childCalls.every((c) => c.endpoint === 'rpc')).toBe(true);
            // The row, read through the parent's real connection (the graph's db.ts handle).
            const rows = sc.graph.db.prepare('SELECT token, chain, action, block, status, tx_hash FROM trades').all();
            expect(rows).toEqual([{ token: sc.token.toLowerCase(), chain: 'eth', action: 'buy', block: sc.node.head, status: 'pending', tx_hash: `0x${'c'.repeat(64)}` }]);
            expectLoopbackOnly(takeCaseLedger(ledgerRunId));
            expect(sc.node.strays).toEqual([]);
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'control: the same child on a different temp file writes its row there and leaves the parent table empty',
        async () => {
            const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() } });
            const lb = await serveLoopback(sc.node);
            const other = createTempDbFile();
            const ledgerRunId = newCaseId('other-db');
            const run = await runRailedChildToEnd('node', [...TS_NODE, 'test/realpath/fixtures/sharedDbChild.ts', sc.token], {
                envOverrides: { DB_PATH: other, ETH_RPC_URL: lb.httpUrl, ETH_WS_URL: lb.wsUrl },
                timeoutMs: CHILD_TIMEOUT_MS,
                ledgerRunId,
            });
            expect(run.status, describeRun(run)).toBe(0);
            expect(run.stdout).toContain(`CHILD_DONE ${sc.node.head} ${sc.token.toLowerCase()}`);
            expect(sc.graph.db.prepare('SELECT count(*) AS n FROM trades').get()).toEqual({ n: 0 });
            // The child really wrote: its row is in the other file.
            const db = new Database(other, { readonly: true });
            try {
                expect(db.prepare('SELECT token FROM trades').all()).toEqual([{ token: sc.token.toLowerCase() }]);
            } finally {
                db.close();
            }
            expectLoopbackOnly(takeCaseLedger(ledgerRunId));
        },
        TEST_TIMEOUT_MS,
    );

    it(
        "a real child's ethers WebSocketProvider subscribes over the loopback socket, receives the matching log and not the other one, and reports the mined head",
        async () => {
            const node = bareNode(1);
            const lb = await serveLoopback(node);
            // A block holding a real transaction, so a log can come from it.
            const sender = new Wallet(ethers.id('realpath.loopback.sender'));
            node.setBalance(sender.address, parseEther('1'));
            const raw = await sender.signTransaction({ chainId: 1, nonce: 0, to: labelAddress('loopback.recipient'), value: 1n, gasLimit: 21_000n, type: 2, maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
            const txHash = node.addForeignTransaction(raw);
            node.mine({ include: [txHash] });

            const watched = labelAddress('loopback.watched-pair');
            const other = labelAddress('loopback.other-pair');
            const syncTopic = V2_PAIR.getEvent('Sync')!.topicHash;
            const transferTopic = V2_PAIR.getEvent('Transfer')!.topicHash;
            const ledgerRunId = newCaseId('ws-subscribe');
            const running = runRailedChildToEnd('node', [...TS_NODE, 'test/realpath/fixtures/wsSubscribeChild.ts', watched, syncTopic, transferTopic], {
                envOverrides: { ETH_RPC_URL: lb.httpUrl, ETH_WS_URL: lb.wsUrl },
                timeoutMs: CHILD_TIMEOUT_MS,
                ledgerRunId,
            });
            await untilSubscribed(node, 2, running);
            expect(node.subscriptions.map((s) => s.kind).sort()).toEqual(['logs', 'newHeads']);

            // A log for another address first (the filter must drop it), then one it matches.
            const sync = V2_PAIR.encodeEventLog('Sync', [1000n, 2000n]);
            node.emitLogs([
                { address: other, topics: sync.topics, data: sync.data, transactionHash: txHash },
                { address: watched, topics: sync.topics, data: sync.data, transactionHash: txHash },
            ]);
            const head = node.mine();
            const run = await running;

            expect(run.status, describeRun(run)).toBe(0);
            const lines = run.stdout.split(/\r?\n/);
            expect(lines.filter((l) => l.startsWith('CHILD_WS_LOG ')), describeRun(run)).toEqual([`CHILD_WS_LOG ${watched.toLowerCase()} ${syncTopic}`]);
            expect(lines.filter((l) => l.startsWith('CHILD_WS_HEAD ')), describeRun(run)).toEqual([`CHILD_WS_HEAD ${head}`]);
            expect(lines).toContain('CHILD_WS_READY 1');
            const subscribes = node.callLog.filter((c) => c.method === 'eth_subscribe');
            expect(subscribes.map((c) => (c.params as unknown[])[0]).sort()).toEqual(['logs', 'newHeads']);
            expect(subscribes.every((c) => c.endpoint === 'ws' && c.url === lb.wsUrl)).toBe(true);
            const logsSub = subscribes.find((c) => (c.params as unknown[])[0] === 'logs')!;
            expect(JSON.stringify((logsSub.params as unknown[])[1]).toLowerCase()).toContain(watched.toLowerCase());

            // Once the child is gone its socket's subscriptions are gone: a later push writes to
            // no dead socket and records no stray.
            await lb.whenSocketsClosed();
            expect(lb.socketsAccepted).toBe(1);
            expect(node.subscriptions).toEqual([]);
            const later = node.addForeignTransaction(await sender.signTransaction({ chainId: 1, nonce: 1, to: labelAddress('loopback.recipient'), value: 1n, gasLimit: 21_000n, type: 2, maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }));
            node.mine({ include: [later] });
            expect(() => node.emitLogs([{ address: watched, topics: sync.topics, data: sync.data, transactionHash: later }])).not.toThrow();
            node.mine();
            expect(node.strays).toEqual([]);
            expectLoopbackOnly(takeCaseLedger(ledgerRunId));
        },
        TEST_TIMEOUT_MS,
    );

    it('the loopback HTTP port answers a single and a batch JSON-RPC body from the same node, and an unknown request is a stray', async () => {
        const node = bareNode(1);
        const lb = await serveLoopback(node);
        const post = (body: string, method = 'POST', urlPath = '/'): Promise<{ status: number; text: string }> =>
            new Promise((resolve, reject) => {
                const u = new URL(lb.httpUrl);
                const req = http.request({ host: u.hostname, port: Number(u.port), path: urlPath, method, headers: { 'content-type': 'application/json' } }, (res) => {
                    let text = '';
                    res.on('data', (c: Buffer) => (text += c.toString('utf8')));
                    res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
                });
                req.on('error', reject);
                req.end(body);
            });
        const single = await post(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'eth_chainId', params: [] }));
        expect(single.status).toBe(200);
        expect(JSON.parse(single.text)).toEqual({ jsonrpc: '2.0', id: 7, result: '0x1' });
        const batch = await post(JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }, { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] }]));
        expect(JSON.parse(batch.text)).toEqual([
            { jsonrpc: '2.0', id: 1, result: '0x1' },
            { jsonrpc: '2.0', id: 2, result: ethers.toQuantity(node.head) },
        ]);
        // Over HTTP a subscription is refused with geth's text: it needs a socket.
        const sub = await post(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_subscribe', params: ['newHeads'] }));
        expect(JSON.parse(sub.text)).toEqual({ jsonrpc: '2.0', id: 3, error: { code: -32601, message: 'notifications not supported' } });
        expect(node.callLog.filter((c) => c.url === lb.httpUrl).map((c) => c.method)).toEqual(['eth_chainId', 'eth_chainId', 'eth_blockNumber', 'eth_subscribe']);

        const get = await post('', 'GET');
        expect(get.status).toBe(404);
        const wrongPath = await post('{}', 'POST', '/other');
        expect(wrongPath.status).toBe(404);
        const strays = node.strays.splice(0);
        expect(strays.map((s) => s.detail)).toEqual(['unknown loopback request GET / (HTTP)', 'unknown loopback request POST /other (HTTP)']);
    });

    it('autoMine mines an accepted public transaction and confirmations - 1 empty blocks in the same tick; it is off by default', async () => {
        const node = bareNode(1);
        installSeams();
        const url = 'http://realpath-automine.invalid/rpc';
        node.serve({ rpc: [url] });
        const provider = new JsonRpcProvider(url, 1, { staticNetwork: Network.from(1), cacheTimeout: -1 });
        harnessState().disposers.push(async () => provider.destroy());
        const wallet = new Wallet(ethers.id('realpath.automine'), provider);
        node.setBalance(wallet.address, parseEther('1'));
        const to = labelAddress('automine.recipient');

        // Off by default: the transaction is accepted and stays pending.
        const first = await stepUntil(wallet.sendTransaction({ to, value: 1n }));
        expect(node.statusOf(first.hash)).toBe('accepted');
        const headBefore = node.head;
        node.mine({ include: [first.hash] });

        node.autoMine({ confirmations: 3 });
        const start = node.head;
        expect(start).toBe(headBefore + 1);
        const second = await stepUntil(wallet.sendTransaction({ to, value: 2n }));
        expect(node.statusOf(second.hash)).toBe('mined');
        expect(node.head).toBe(start + 3);
        const receipt = await stepUntil(provider.getTransactionReceipt(second.hash));
        expect(receipt?.blockNumber).toBe(start + 1);
        expect(await stepUntil(receipt!.confirmations())).toBe(3);

        node.autoMine(false);
        const third = await stepUntil(wallet.sendTransaction({ to, value: 3n }));
        expect(node.statusOf(third.hash)).toBe('accepted');
        expect(node.head).toBe(start + 3);
        expect(() => node.autoMine({ confirmations: 0 })).toThrow(/positive integer/);
        node.mine({ include: [third.hash] });
    });
});
