// test/realpath/triage/AUD-API-002.test.ts
// Phase 23 plan 23-10 Task 1 (AUDIT-02): AUD-API-002 (RC-12), dashboard Stop disarms anti-rug.
//
// The site (src/api/routes/chains.ts POST /:name/stop): stoppedChains.add, then
// ctx.wsProvider.removeAllListeners() with no event argument, "Do NOT destroy the provider -- exit
// monitors may need it". In ethers 6.16.0 (abstract-provider.js removeAllListeners) that stops and
// deletes EVERY subscription on the provider: the DEX factory listeners and also the anti-rug
// rug-log filter that src/anti-rug/detector.ts startChainAntiRugListener installed on the same
// shared provider. POST /:name/start runs the bot's onRestart, which keeps a live provider and
// re-runs startDexListener per DEX; nothing calls startChainAntiRugListener. The heartbeat keeps
// broadcasting chain_ws_health_change "connected" every 30 s while the raw socket answers pings.
//
// Proof on the real path: a real ETH V2 snipe through the real listeners (every DEX of the chain,
// as boot step 4 starts them), bought, armed (exit monitor and anti-rug, the subscription read from
// the fake node's own list). A control LP transfer to an allowlisted locker is evaluated, so the
// delivery path is shown working before Stop. The real dashboard (real login, real routes, a
// loopback port, node:http; fixtures/AUD-BUY-011-dashboard.ts) stops the chain, and in the second
// test starts it again. The Start route's callback is a source-pinned mirror of src/bot.ts
// onRestart (fixtures/AUD-API-002-restart.ts: the real closure exists only inside a full boot,
// which this phase never runs; the mirror fails by name if that closure's text changes). One
// heartbeat later, right after one of the exit monitor's polls (so the routine stop-loss cannot
// take part), the deployer pulls 95 percent of the liquidity through the real router
// (fixtures/AUD-EXIT-014-rug.ts: the pair's own Transfer, Sync and Burn logs). Measured, from the
// node and the bot: the node's subscriptions covering the pair, whether the bot evaluated the rug
// (its unsafe verdict schedules op antirug.confirm-gate.scheduled within milliseconds when the
// log arrives), and the WS-health state the dashboard was last told. The observation window is
// bounded: 3 s of fake time after the pull, less than one exit-poll interval (5 s).
//
// Anti-rug stays in dry-run (the default), so a fix that keeps the subscription evaluates the rug
// and at most logs a would-have-sold; nothing is sold either way. How many dispatches one pull
// makes is AUD-ANTIRUG-003's claim and is not asserted here.
//
// Fix signal (D-08): a Stop that removes only the factory listeners (anti-rug untouched) reads
// "looks fixed" on both claims (fix-shaped src mutation, restored). A fix inside onRestart is seen
// by the pin, which then fails "onRestart changed" until the mirror is re-pointed.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Wallet, ethers, parseEther } from 'ethers';
import { harnessState } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, v2AmountOut, type Scenario } from '../harness/world';
import { dashboardOverrides, stepUntilOrFor } from './fixtures/AUD-API-001-dashboard-sell';
import { bootListeners, chainRoute, openDashboardWithRestart } from './fixtures/AUD-API-002-restart';
import { installSellPath } from './fixtures/AUD-EXIT-001-sell-path';
import { buyAndMine, buyRow, exitQuotes, opEntries, opLogged, waitAntiRugArmed } from './fixtures/AUD-EXIT-002-position';
import { pullLiquidity } from './fixtures/AUD-EXIT-014-rug';

const DEAD = '0x000000000000000000000000000000000000dead';
const V2_PAIR = new Interface(['function transfer(address to, uint256 value) returns (bool)', 'event Transfer(address indexed from, address indexed to, uint256 value)']);

/** Subscriptions on the node whose filter covers `address`. */
function subscriptionsCovering(sc: Scenario, address: string): number {
    return sc.node.subscriptions.filter((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(address.toLowerCase())).length;
}

/** The WS-health state the dashboard was last told for the chain, since broadcast index `from`. */
function healthShown(chain: string, from: number): string | null {
    const shown = harnessState()
        .broadcasts.slice(from)
        .filter((b) => b.type === 'chain_ws_health_change' && (b.data as { chain?: string }).chain === chain)
        .map((b) => String((b.data as { state?: string }).state));
    return shown.length > 0 ? shown[shown.length - 1] : null;
}

/** A bought, armed ETH V2 position, with every DEX listener started as boot does. */
async function armedPosition(sc: Scenario<'v2'>): Promise<number> {
    await bootListeners(sc);
    const { buy } = await buyAndMine(sc);
    await waitAntiRugArmed(sc);
    expect(opLogged('exit.monitor.started')).toBe(true);
    installSellPath(sc, { bought: v2AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token) });
    const row = buyRow(sc);
    expect(row?.status).toBe('pending');
    return row!.id;
}

/** Control: an LP-token transfer of the pair to an allowlisted locker reaches the evaluator. */
async function controlTransferEvaluated(sc: Scenario<'v2'>, tradeId: number): Promise<void> {
    const locker = sc.ctx.chain.antiRug.allowlistV2.map((e) => e.address).find((a) => a.toLowerCase() !== DEAD);
    expect(locker).toBeDefined();
    const holder = new Wallet(ethers.id('realpath.aud-api-002.lp-holder'));
    sc.node.setBalance(holder.address, parseEther('1'));
    const raw = await holder.signTransaction({
        chainId: 1, nonce: 0, to: sc.pair, value: 0n, gasLimit: 80_000n, type: 2,
        maxFeePerGas: 60_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
        data: V2_PAIR.encodeFunctionData('transfer', [locker!, 1_000n]),
    });
    const hash = sc.node.addForeignTransaction(raw);
    const log = V2_PAIR.encodeEventLog('Transfer', [holder.address, locker!, 1_000n]);
    const from = recordedLogs().length;
    sc.node.mine({ include: [hash], logs: [{ address: sc.pair, topics: log.topics, data: log.data, transactionHash: hash }] });
    await stepUntilTrue(() => opEntries('antirug.allowlist-hit', from).some((o) => o.tradeId === tradeId), { what: 'the control LP transfer being evaluated before Stop' });
}

interface RugOutcome {
    antiRugSubscriptionsForPair: number;
    rugEvaluated: boolean;
    healthShown: string | null;
}

/**
 * One heartbeat (30 s) after `fromBroadcast`, right after an exit-monitor poll, pull 95 percent of
 * the liquidity and watch 3 s of fake time.
 */
async function rugAfterHeartbeat(sc: Scenario<'v2'>, tradeId: number, fromBroadcast: number): Promise<RugOutcome & { fromLog: number }> {
    await stepFor(31_000);
    const quotes = exitQuotes(sc).length;
    await stepUntilTrue(() => exitQuotes(sc).length > quotes, { what: 'one exit-monitor poll', maxSteps: 2_000 });
    const fromLog = recordedLogs().length;
    await pullLiquidity(sc, { removeBps: 9_500n });
    const evaluated = (): boolean => opEntries('antirug.confirm-gate.scheduled', fromLog).some((o) => o.tradeId === tradeId);
    await stepUntilOrFor(evaluated, 3_000);
    return { antiRugSubscriptionsForPair: subscriptionsCovering(sc, sc.pair), rugEvaluated: evaluated(), healthShown: healthShown('eth', fromBroadcast), fromLog };
}

describe('AUD-API-002: dashboard Stop removes the anti-rug subscription and Start does not bring it back', () => {
    it('stop-disarms-antirug: after the real Stop route, the node holds no anti-rug subscription for the pair, a 95 percent liquidity pull is never evaluated, and the dashboard is still told the chain is connected', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: await dashboardOverrides() });
        const tradeId = await armedPosition(sc);
        expect(subscriptionsCovering(sc, sc.pair)).toBe(1);
        await controlTransferEvaluated(sc, tradeId);

        const { dash, cookie } = await openDashboardWithRestart(sc);
        const fromCall = sc.node.callLog.length;
        const fromBroadcast = harnessState().broadcasts.length;
        expect(await chainRoute(dash, cookie, 'eth', 'stop')).toEqual({ ok: true, chain: 'eth', status: 'stopped' });
        const out = await rugAfterHeartbeat(sc, tradeId, fromBroadcast);

        knownBug(ctx, 'AUD-API-002', {
            claim: 'stop-disarms-antirug',
            correct: { antiRugSubscriptionsForPair: 1, rugEvaluated: true, healthShown: 'connected' },
            observed: { antiRugSubscriptionsForPair: 0, rugEvaluated: false, healthShown: 'connected' },
            actual: { antiRugSubscriptionsForPair: out.antiRugSubscriptionsForPair, rugEvaluated: out.rugEvaluated, healthShown: out.healthShown },
            expectedPlain: 'Stopping a chain in the dashboard stops new buys only; anti-rug keeps watching the open positions, so a liquidity pull on one of them is still evaluated.',
            actualPlain: 'After Stop the node held no anti-rug subscription for the pair, a 95 percent liquidity pull was never evaluated, and the dashboard kept being told the chain was connected.',
        });
        // Bug details, after the marker. The Stop route itself unsubscribed every subscription,
        // the anti-rug filter included (an eth_unsubscribe per subscription, none after it).
        const unsubscribes = sc.node.callLog.slice(fromCall).filter((c) => c.endpoint === 'ws' && c.method === 'eth_unsubscribe');
        expect(unsubscribes.length).toBeGreaterThanOrEqual(1 + sc.ctx.chain.dexes.length);
        expect(sc.node.subscriptions.filter((s) => s.kind === 'logs')).toEqual([]);
        // The bot's own state still says the position is protected, and the routine exit runs.
        expect(sc.graph.detector.getRegisteredPositions('eth').map((p) => p.tradeId)).toEqual([tradeId]);
        expect(sc.graph.exitManager.hasExitMonitorTimer('eth', sc.token)).toBe(true);
        expect(opLogged('antirug.dry-run.would-have-sold', out.fromLog)).toBe(false);
        // The pull was mined with the pair's own logs the filter watches.
        expect(sc.node.logs.filter((l) => l.address.toLowerCase() === sc.pair.toLowerCase()).length).toBeGreaterThanOrEqual(4);
        const shown = await dash.request('GET', '/api/chains', { cookie });
        expect((shown.body as { chains: Array<{ name: string; status: string }> }).chains.map((c) => [c.name, c.status])).toEqual([['eth', 'stopped']]);
    });

    it('start-does-not-rearm-antirug: after the real Stop and Start routes (Start running the pinned onRestart mirror), the node still holds no anti-rug subscription for the pair and a liquidity pull is never evaluated', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: await dashboardOverrides() });
        const tradeId = await armedPosition(sc);
        expect(subscriptionsCovering(sc, sc.pair)).toBe(1);
        await controlTransferEvaluated(sc, tradeId);

        const { dash, cookie } = await openDashboardWithRestart(sc);
        const fromLogStart = recordedLogs().length;
        await chainRoute(dash, cookie, 'eth', 'stop');
        const fromBroadcast = harnessState().broadcasts.length;
        const started = (await chainRoute(dash, cookie, 'eth', 'start')) as { status: string; warnings: string[] };
        expect(started).toEqual({ ok: true, chain: 'eth', status: 'running', warnings: [] });
        // Start re-attached every factory listener (holds for the bug and for a fix).
        for (const dex of sc.ctx.chain.dexes) await stepUntilTrue(() => subscriptionsCovering(sc, dex.factoryAddress) === 1, { what: `the ${dex.name} factory listener after Start` });
        const out = await rugAfterHeartbeat(sc, tradeId, fromBroadcast);

        knownBug(ctx, 'AUD-API-002', {
            claim: 'start-does-not-rearm-antirug',
            correct: { antiRugSubscriptionsForPair: 1, rugEvaluated: true, healthShown: 'connected' },
            observed: { antiRugSubscriptionsForPair: 0, rugEvaluated: false, healthShown: 'connected' },
            actual: { antiRugSubscriptionsForPair: out.antiRugSubscriptionsForPair, rugEvaluated: out.rugEvaluated, healthShown: out.healthShown },
            expectedPlain: 'After the operator stops and starts a chain in the dashboard, anti-rug watches the open positions again, so a liquidity pull on one of them is evaluated.',
            actualPlain: 'After Stop and Start the factory listeners came back but the anti-rug subscription did not: a 95 percent liquidity pull was never evaluated, while the dashboard was told the chain was connected.',
        });
        // Bug details, after the marker: Start re-ran the DEX listeners only; nothing re-armed anti-rug.
        expect(recordedLogs().slice(fromLogStart).filter((l) => l.msg === 'DEX listener restarted')).toHaveLength(sc.ctx.chain.dexes.length);
        expect(opLogged('antirug.listener.subscribed', fromLogStart)).toBe(false);
        expect(sc.graph.detector.getRegisteredPositions('eth').map((p) => p.tradeId)).toEqual([tradeId]);
        expect(sc.node.subscriptions.filter((s) => s.kind === 'logs').length).toBe(sc.ctx.chain.dexes.length);
    });
});
