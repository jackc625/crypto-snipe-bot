// test/realpath/triage/AUD-BUY-001.test.ts
// Phase 23 plan 23-06 Task 1 (AUDIT-02): AUD-BUY-001, the only S0 in the register. A landed
// deliberate buy is armed for exit and anti-rug only inside the short-lived operator script
// (scripts/deliberate-buy.ts), which calls process.exit(0) right after printing the result. The
// exit monitor (a setInterval in the in-memory timer registry, src/utils/exitManager.ts) and the
// anti-rug registration (the in-memory position registry and its WebSocket subscription,
// src/anti-rug/detector.ts) die with that process. A main bot that is already running re-reads
// open trades only at boot (resumeMultiChainMonitoring, resumeAntiRugMonitoring), so it never
// picks the position up until it is restarted.
//
// Proof on the real path with two real operating-system processes sharing one real SQLite file
// and one simulated chain (plan 23-27 helpers):
//   - The running bot is this test process: a base V2 graph on a temp-file database, its real
//     dex listener, then the real resumeMultiChainMonitoring and resumeAntiRugMonitoring. Its
//     readiness acknowledgement: both returned, nothing is monitored or registered for the
//     token, and both resume queries are empty.
//   - The operator's script is the real scripts/deliberate-buy.ts, run to its own end as a railed
//     child (spawnRailedChildAsync: sentinel env and key, rails preload, loopback-only network)
//     against serveLoopback(node), with node.autoMine({ confirmations: 3 }) so its public-route
//     buy is mined on real time. Base is used (route passthrough, the public mempool) because the
//     ETH relay URL is a fixed constant (src/chainRegistry.ts:202) a child cannot be pointed at;
//     the finding is about process lifetime, not the route. Base V2 snipes are skipped by
//     AUD-BUY-016, but a deliberate buy runs no lock check, so it lands.
//   - The script's monitoring acknowledgement comes from its own output: exit status 0,
//     "RESULT: BUY LANDED", and the exit.monitor.started, antirug.lp-baseline.snapshot and
//     antirug.register log lines, plus its eth_subscribe for the pair on the loopback socket.
//     These are plain expects BEFORE any marker, so an arming failure in the child (a read the
//     table lacks, antirug.baseline-snapshot-failed) is a real failure, never the finding.
//   - Then, in the running bot: the row is visible through its own connection and in both
//     resume queries, and after ten exit-poll intervals of its clock it still monitors nothing
//     and holds no anti-rug registration for the pair. Each protection is its own claim.
//
// Fix signal (D-08), measured with fix-shaped src mutations: a fix that hands the position to the
// running bot (it re-scans pending buys it does not monitor, card OD-26 option a) reads "looks
// fixed" on each claim separately (an exit-monitor-only and an anti-rug-only re-scan were each
// run; under the exit one the resumed monitor's later polls also read the token's allowance,
// which this table does not answer, so a stray follows the looks-fixed error; extend the table
// then). Two other fix shapes on the card are not this measure: a
// script that refuses while the main bot runs (option b) exits 1 before buying, and a script
// that stays alive (option c) never exits; both fail on the plain expects above with the child's
// output, and this file must be rewritten with such a fix.
//
// Controls (same file): the same deliberate buy run inside the running bot's own process arms
// both protections, and so does a normal base V3 snipe, read through the same two registries.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Wallet, parseEther } from 'ethers';
import { encodeResult, harnessState, type FakeNode } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { runRailedChildToEnd, serveLoopback, type ChildRun } from '../harness/loopback';
import { createScenario, createTempDbFile, restartGraph, stepFor, stepUntil, stepUntilTrue, type Scenario } from '../harness/world';
import { readSentinels } from '../../rails/spawnRailedChild';

const CHILD_TIMEOUT_MS = 110_000;
const TEST_TIMEOUT_MS = 120_000;
const TS_NODE = ['-r', 'ts-node/register/transpile-only'];
const LEDGER_ROOT = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger');
const DEAD = '0x000000000000000000000000000000000000dead';
/** Runtime code for an allowlisted locker: these are deployed contracts on Base, so getCode is non-empty. */
const LOCKER_CODE = '0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063';

type ChildLine = Record<string, unknown> & { op?: string; msg?: string };

/** The child's pino lines (JSON on stdout), in order. Console text lines are skipped. */
function childLines(stdout: string): ChildLine[] {
    const out: ChildLine[] = [];
    for (const line of stdout.split(/\r?\n/)) {
        if (!line.startsWith('{')) continue;
        try {
            out.push(JSON.parse(line) as ChildLine);
        } catch {
            /* a console line that happens to start with a brace */
        }
    }
    return out;
}

function describeRun(r: ChildRun): string {
    return `status ${r.status} signal ${r.signal}\nstdout:\n${r.stdout.slice(-4000)}\nstderr:\n${r.stderr.slice(-3000)}`;
}

let caseCounter = 0;
/**
 * A case ledger ID for one child (Date.now() is frozen under the fixed clock, so a random part
 * keeps IDs unique); the folder is removed at teardown if the test did not take it.
 */
function newCaseId(label: string): string {
    caseCounter += 1;
    const id = `case-realpath-aud-buy-001-${label}-${process.pid}-${caseCounter}-${Math.random().toString(36).slice(2, 10)}`;
    harnessState().disposers.push(async () => fs.rmSync(path.join(LEDGER_ROOT, id), { recursive: true, force: true }));
    return id;
}

interface LedgerEntry {
    kind: string;
    target?: unknown;
}

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

/** Answer the reads a deliberate buy and the anti-rug boot path make that the scenario table lacks. */
function liveMarket(sc: Scenario<'v2'> | Scenario<'v3'>): void {
    const { node, ctx } = sc;
    // The pair already exists (a deliberate buy is made on a live pair); the factory answers
    // getPair for it, as the real one does, for the record-and-arm step.
    if (sc.dex.dexType === 'v2') node.setRead(sc.dex.factoryAddress, 'getPair(address,address)', encodeResult(['address'], [sc.pair]));
    // The anti-rug allowlist lockers are deployed contracts (verifyAllowlistAtStartup reads their code).
    for (const e of [...ctx.chain.antiRug.allowlistV2, ...ctx.chain.antiRug.allowlistV3]) {
        if (e.address.toLowerCase() !== DEAD) node.setCode(e.address, LOCKER_CODE);
    }
}

function opLogged(op: string, from = 0): boolean {
    return recordedLogs().slice(from).some((l) => l.obj?.op === op);
}

function subscribedTo(node: FakeNode, address: string): boolean {
    return node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(address.toLowerCase()));
}

describe('AUD-BUY-001: a landed deliberate buy is armed only in the short-lived script process', () => {
    it(
        'monitor-dies-with-script and anti-rug-dies-with-script: the real scripts/deliberate-buy.ts lands a buy and arms both protections in its own process, exits 0, and the running bot on the same database picks up neither',
        async (ctx) => {
            // --- The running bot (this process) on a temp-file database ---
            const file = createTempDbFile();
            const sc = await createScenario({ chain: 'base', dexType: 'v2', db: { file } });
            const { node, graph, dex, token, pair } = sc;
            liveMarket(sc);
            expect(sc.ctx.chain.mevStrategy).toBe('passthrough');
            const sentinelAddress = new Wallet(readSentinels().PRIVATE_KEY).address;
            expect(sc.wallet.address).toBe(sentinelAddress);

            await graph.bot.startDexListener(sc.ctx, dex, sc.registry);
            await stepUntilTrue(() => subscribedTo(node, dex.factoryAddress), { what: 'the running bot subscribing to PairCreated on the factory' });
            graph.bot.resumeMultiChainMonitoring([sc.ctx]);
            await stepUntil(graph.bot.resumeAntiRugMonitoring([sc.ctx]));
            // Readiness acknowledgement: both resume paths returned, nothing is held for the token.
            expect(opLogged('antirug.allowlist-verify-rpc-failed')).toBe(false);
            expect(graph.exitManager.hasExitMonitorTimer('base', token)).toBe(false);
            expect(graph.detector.getRegisteredPositions('base').filter((p) => p.pairOrPoolAddress === pair.toLowerCase())).toEqual([]);
            expect(graph.dbModule.getResumeExitMonitorTrades.all()).toEqual([]);
            expect(graph.dbModule.getResumeAntiRugTrades.all()).toEqual([]);
            const tradesBefore = graph.db.prepare('SELECT count(*) AS n FROM trades').get();
            expect(tradesBefore).toEqual({ n: 0 });

            // --- The operator's script, a real second process, run to its own end ---
            const lb = await serveLoopback(node);
            node.autoMine({ confirmations: 3 });
            const headBefore = node.head;
            const ledgerRunId = newCaseId('deliberate');
            const run = await runRailedChildToEnd('node', [...TS_NODE, 'scripts/deliberate-buy.ts', 'base', token, '0.01'], {
                envOverrides: {
                    DB_PATH: file,
                    ENABLED_CHAINS: 'base',
                    BASE_RPC_URL: lb.httpUrl,
                    BASE_WS_URL: lb.wsUrl,
                    BASE_HONEYPOT_CHECKER_ADDRESS: sc.checker,
                },
                timeoutMs: CHILD_TIMEOUT_MS,
                ledgerRunId,
            });

            // The script's monitoring acknowledgement, from its own output (plain expects: an
            // arming failure in the child is a real failure, never the finding).
            const lines = childLines(run.stdout);
            const ops = lines.map((l) => l.op).filter((o): o is string => typeof o === 'string');
            expect(run.status, describeRun(run)).toBe(0);
            expect(run.stdout, describeRun(run)).toContain('--- RESULT: BUY LANDED ---');
            expect(ops, describeRun(run)).toContain('exit.monitor.started');
            expect(ops, describeRun(run)).toContain('antirug.lp-baseline.snapshot');
            expect(ops, describeRun(run)).toContain('antirug.register');
            expect(ops, describeRun(run)).not.toContain('antirug.baseline-snapshot-failed');
            expect(ops, describeRun(run)).not.toContain('antirug.register.no-baseline');
            // The wallet it signed with is the sentinel key's, so no real key reached it.
            const printed = run.stdout.match(/^\s*Wallet:\s+(0x[0-9a-fA-F]{40})\s*$/m);
            expect(printed?.[1], describeRun(run)).toBe(sentinelAddress);
            // Its anti-rug subscription for the pair reached the real loopback socket.
            const childSubscribes = node.callLog.filter((c) => c.method === 'eth_subscribe' && c.url === lb.wsUrl);
            expect(childSubscribes.some((c) => JSON.stringify(c.params).toLowerCase().includes(pair.toLowerCase())), describeRun(run)).toBe(true);
            // Its buy was mined on the shared chain.
            const landed = node.submitted.filter((s) => s.status === 'mined' && s.tx.from?.toLowerCase() === sentinelAddress.toLowerCase() && s.tx.to?.toLowerCase() === dex.routerAddress.toLowerCase());
            expect(landed, describeRun(run)).toHaveLength(1);
            expect(node.head).toBeGreaterThan(headBefore);
            const armedInScript = ops.includes('exit.monitor.started');
            const antiRugArmedInScript = ops.includes('antirug.lp-baseline.snapshot') && ops.includes('antirug.register');
            const pollMs = Number(lines.find((l) => l.op === 'exit.monitor.started')?.pollMs);
            expect(pollMs).toBeGreaterThan(0);

            // The shared file, through the running bot's own connection: the row is there and
            // pending, and both resume queries now return it (only a boot would read them).
            const row = graph.db.prepare("SELECT id, status, tx_hash FROM trades WHERE token = ? AND action = 'buy'").get(token.toLowerCase()) as { id: number; status: string; tx_hash: string } | undefined;
            expect(row).toMatchObject({ status: 'pending', tx_hash: landed[0].hash });
            const exitResume = graph.dbModule.getResumeExitMonitorTrades.all() as Array<{ id: number }>;
            const antiRugResume = graph.dbModule.getResumeAntiRugTrades.all() as Array<{ id: number; pair_or_pool_address: string }>;
            expect(exitResume.map((t) => t.id)).toEqual([row!.id]);
            expect(antiRugResume.map((t) => [t.id, t.pair_or_pool_address.toLowerCase()])).toEqual([[row!.id, pair.toLowerCase()]]);

            // The running bot keeps running: ten exit-poll intervals of its own clock.
            await stepFor(10 * pollMs + 1_000);

            const monitoredByRunningProcess = graph.exitManager.hasExitMonitorTimer('base', token);
            const rowVisibleToRunningProcess = (graph.dbModule.getResumeExitMonitorTrades.all() as Array<{ id: number }>).some((t) => t.id === row!.id);
            knownBug(ctx, 'AUD-BUY-001', {
                claim: 'monitor-dies-with-script',
                correct: { monitoredByRunningProcess: true, rowVisibleToRunningProcess: true, scriptExitStatus: 0, armedInScript: true },
                observed: { monitoredByRunningProcess: false, rowVisibleToRunningProcess: true, scriptExitStatus: 0, armedInScript: true },
                actual: { monitoredByRunningProcess, rowVisibleToRunningProcess, scriptExitStatus: run.status, armedInScript },
                expectedPlain: 'After a deliberate buy lands, the position stays under an exit monitor: the bot that keeps running watches it, so take-profit and stop-loss keep working after the operator script ends.',
                actualPlain: 'The script armed the exit monitor in its own process and then exited; the main bot already running on the same database never started one, so the position has no exit monitor until the bot is restarted.',
            });

            const antiRugHeldByRunningProcess = graph.detector.getRegisteredPositions('base').some((p) => p.pairOrPoolAddress === pair.toLowerCase());
            const baselineVisibleToRunningProcess = (graph.dbModule.getResumeAntiRugTrades.all() as Array<{ id: number; pair_or_pool_address: string }>).some(
                (t) => t.id === row!.id && t.pair_or_pool_address.toLowerCase() === pair.toLowerCase(),
            );
            knownBug(ctx, 'AUD-BUY-001', {
                claim: 'anti-rug-dies-with-script',
                correct: { antiRugHeldByRunningProcess: true, baselineVisibleToRunningProcess: true, scriptExitStatus: 0, antiRugArmedInScript: true },
                observed: { antiRugHeldByRunningProcess: false, baselineVisibleToRunningProcess: true, scriptExitStatus: 0, antiRugArmedInScript: true },
                actual: { antiRugHeldByRunningProcess, baselineVisibleToRunningProcess, scriptExitStatus: run.status, antiRugArmedInScript },
                expectedPlain: 'After a deliberate buy lands, its pair stays under anti-rug watch: the bot that keeps running registers it and listens for liquidity removal.',
                actualPlain: 'The script registered the pair for anti-rug in its own process and then exited; the main bot already running never registered it, so a rug pull on that pair goes unseen until the bot is restarted.',
            });

            // Bug details, after the markers. The running bot never logged arming for this trade.
            expect(recordedLogs().some((l) => l.obj?.op === 'exit.monitor.started' || l.obj?.op === 'exit.monitor.resumed')).toBe(false);
            expect(recordedLogs().some((l) => l.obj?.op === 'antirug.register')).toBe(false);
            // Only a restart picks it up: the same bot, restarted on the same file, re-arms the exit
            // monitor and re-registers the pair. (Its anti-rug WebSocket subscription for the pair
            // does not survive that resume: AUD-ANTIRUG-025, proven in its own file. Here the
            // restart's re-subscribe is only waited out, so teardown cancels nothing it queued.)
            await restartGraph(sc);
            const fromLog = recordedLogs().length;
            const fromCall = node.callLog.length;
            sc.graph.bot.resumeMultiChainMonitoring([sc.ctx]);
            await stepUntil(sc.graph.bot.resumeAntiRugMonitoring([sc.ctx]));
            await stepUntilTrue(() => opLogged('exit.monitor.resumed', fromLog) && sc.graph.exitManager.hasExitMonitorTimer('base', token), { what: 'the restarted bot resuming the exit monitor' });
            expect(sc.graph.detector.getRegisteredPositions('base').some((p) => p.pairOrPoolAddress === pair.toLowerCase() && p.tradeId === row!.id)).toBe(true);
            const resubscribes = recordedLogs().slice(fromLog).filter((l) => l.obj?.op === 'antirug.listener.subscribed').length;
            expect(resubscribes).toBe(2);
            await stepUntilTrue(() => node.callLog.slice(fromCall).filter((c) => c.method === 'eth_unsubscribe').length === resubscribes - 1, { what: "the restarted bot's re-subscribe reaching the node" });

            // The child ran railed: its own ledger shows the sentinel env, loopback-only network,
            // and the script's own dotenv.config() refused by the rails (the repo .env).
            const ledger = takeCaseLedger(ledgerRunId);
            expect(ledger.some((e) => e.kind === 'worker-start')).toBe(true);
            const allowed = ledger.filter((e) => e.kind === 'net-allow');
            expect(allowed.length).toBeGreaterThan(0);
            expect(allowed.filter((e) => (e.target as { class?: string } | null)?.class !== 'loopback')).toEqual([]);
            const blocked = ledger.filter((e) => /deny|blocked|tripwire/.test(e.kind));
            expect(blocked.map((e) => e.kind)).toEqual(['env-read-blocked']);
            expect(JSON.stringify(blocked[0].target)).toMatch(/\.env/);
            expect(node.strays).toEqual([]);
        },
        TEST_TIMEOUT_MS,
    );

    it('control: the same deliberate buy run inside the running bot process arms both protections, read through the same registries', async () => {
        const sc = await createScenario({ chain: 'base', dexType: 'v2' });
        const { node, graph, dex, token, pair } = sc;
        liveMarket(sc);
        node.autoMine({ confirmations: 3 });
        const landedHash = await stepUntil(graph.bot.executeDeliberateBuy(sc.ctx, token, parseEther('0.01'), dex), { maxSteps: 20_000 });
        expect(landedHash).toMatch(/^0x[0-9a-f]{64}$/);
        await stepUntilTrue(
            () => opLogged('exit.monitor.started') && opLogged('antirug.register') && subscribedTo(node, pair) && recordedLogs().some((l) => typeof l.obj?.op === 'string' && l.obj.op.startsWith('antirug.backfill.')),
            { what: 'the in-process deliberate position being armed (exit monitor, anti-rug subscription on the pair, backfill)' },
        );
        expect(graph.exitManager.hasExitMonitorTimer('base', token)).toBe(true);
        expect(graph.detector.getRegisteredPositions('base').some((p) => p.pairOrPoolAddress === pair.toLowerCase())).toBe(true);
    });

    it('control: a normal base V3 snipe in the running bot arms both protections, read through the same registries', async () => {
        const sc = await createScenario({ chain: 'base', dexType: 'v3' });
        const { node, graph, dex, token, pair } = sc;
        await graph.bot.startDexListener(sc.ctx, dex, sc.registry);
        await stepUntilTrue(() => subscribedTo(node, dex.factoryAddress), { what: 'the listener subscribing to PoolCreated on the factory' });
        await sc.fireNewPool();
        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot sending its base V3 buy publicly', maxSteps: 20_000 });
        expect(node.submitted[0].route).toBe('public');
        node.mine({ include: [node.submitted[0].hash] });
        node.mine();
        node.mine();
        await stepUntilTrue(
            () => opLogged('exit.monitor.started') && opLogged('antirug.register') && subscribedTo(node, pair),
            { what: 'the base V3 position being armed (exit monitor, anti-rug subscription on the pool)', maxSteps: 20_000 },
        );
        expect(graph.exitManager.hasExitMonitorTimer('base', token)).toBe(true);
        expect(graph.detector.getRegisteredPositions('base').some((p) => p.pairOrPoolAddress === pair.toLowerCase())).toBe(true);
    });
});
