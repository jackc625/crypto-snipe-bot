// test/realpath/triage/AUD-API-001.test.ts
// Phase 23 plan 23-08 Task 1 (AUDIT-02, ESC-PRE-04): AUD-API-001, the dashboard's emergency-sell
// and force-sell skip a still-held position whose exit already failed.
//
// The sites. The catch path of src/exitEngine.ts executeFullSell re-reads balanceOf and, when the
// tokens are still held, sets trades.status to 'failed' (updateTradeStatus.run('failed', ...)) and
// runs keepMonitoringFailedHeld, which stamps exit_state.exit_status 'exit_failed_held' and keeps
// the bot's own monitoring. src/api/routes/controls.ts selects positions with
// "FROM trades WHERE [id = ? AND] status = 'pending' AND action = 'buy'", so force-sell answers 404
// "Trade not found or already closed" and emergency-sell answers "No open positions to sell" for
// that position, while the bot's own restart query (getResumeExitMonitorTrades) counts it as open.
//
// Proof on the real path. A real ETH V2 snipe (the AC-01 path), bought and armed by the running
// bot. The real dashboard API (startApiServer, the real login, the real routes behind the real
// auth middleware) on a loopback port, called over node:http. The operator presses force-sell; the
// real executeFullSell sends a public approve (mined), then two private Flashbots attempts whose
// slots pass without them (empty blocks), reconciles, finds the tokens still held and goes to the
// public fallback, whose swap is refused at gas estimation with the answer a real node gives for a
// token that blocks sells (geth code 3, "execution reverted: TransferHelper: TRANSFER_FROM_FAILED",
// the router's own revert when the token's transferFrom fails). That throw reaches the catch path
// while balanceOf still reports every token. Preconditions asserted before the second press:
// trades.status 'failed', exit_state.exit_status 'exit_failed_held', the fault fired once, the
// tokens still held. Then, one test per route:
//   - force-sell-skips-failed-held: POST /api/controls/force-sell/<id> again;
//   - emergency-sell-skips-failed-held: POST /api/controls/emergency-sell.
//
// What is measured: whether the operator's sell reaches the position, i.e. a new sell of it is
// submitted. Correct: it is. A fix that selects open positions the way the bot's own recovery does
// (status 'pending' buys plus exit_status 'exit_failed_held', the finding's recommendation) reads
// "looks fixed" (D-08): the second press then sells the position, and the drive lands it. The
// route answers (404, "No open positions to sell") are asserted after the marker. For
// emergency-sell, an answer that names the skipped position also counts as reaching it (the
// recommendation's "report every position it did not sell").
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { recordedLogs } from '../harness/capture';
import { revertReason } from '../harness/chain';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepUntil, type Scenario } from '../harness/world';
import type { Dashboard } from './fixtures/AUD-BUY-011-dashboard';
import { dashboardOverrides, exitStatusOf, heldPosition, openDashboard, postDriven, sellsSince, type HeldPosition } from './fixtures/AUD-API-001-dashboard-sell';
import { ERC20, buyRow, opEntries } from './fixtures/AUD-EXIT-002-position';

/** The public fallback's swap (src/exitEngine.ts executePublicFallbackSell). */
const PUBLIC_FALLBACK_SWAP = 'swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)';

interface FailedHeld {
    sc: Scenario;
    dash: Dashboard;
    cookie: string;
    pos: HeldPosition;
}

/** The wallet's token balance as the node answers it now. */
async function heldBalance(sc: Scenario): Promise<bigint> {
    const data = ERC20.encodeFunctionData('balanceOf', [sc.wallet.address]);
    const res = await stepUntil(sc.ctx.httpProvider.call({ to: sc.token, data }));
    return ERC20.decodeFunctionResult('balanceOf', res)[0] as bigint;
}

/**
 * A position driven through the real catch path by a real dashboard force-sell whose public
 * fallback swap is refused, with the tokens still held. Returns once the preconditions hold.
 */
async function failedHeldPosition(): Promise<FailedHeld> {
    const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: await dashboardOverrides() });
    const pos = await heldPosition(sc);
    const { dash, cookie } = await openDashboard(sc);
    const revert = sc.node.failNext('eth_estimateGas', {
        selector: PUBLIC_FALLBACK_SWAP,
        to: sc.dex.routerAddress,
        error: { code: 3, message: 'execution reverted: TransferHelper: TRANSFER_FROM_FAILED', data: revertReason('TransferHelper: TRANSFER_FROM_FAILED').revert },
    });
    // The operator's first press: the sell runs, its private attempts miss their slots, and the
    // public fallback swap is refused. The route's answer to this press is not this finding's.
    const first = await postDriven(sc, dash, `/api/controls/force-sell/${pos.tradeId}`, cookie, 'miss');
    expect(first.status).not.toBe(200);

    // Preconditions: the catch path ran on a still-held position.
    expect(revert.fired).toBe(1);
    expect(opEntries('exit.private.not-landed').length).toBeGreaterThanOrEqual(1);
    expect(opEntries('exit.fallback.public.submit').length).toBe(1);
    const failedOps = opEntries('exit.full.failed');
    expect(failedOps).toHaveLength(1);
    expect(String((failedOps[0].err as Error)?.message ?? failedOps[0].err)).toContain('TRANSFER_FROM_FAILED');
    expect(buyRow(sc)?.status).toBe('failed');
    expect(exitStatusOf(sc, pos.tradeId)).toEqual({ exit_status: 'exit_failed_held', exit_failure_count: 1 });
    expect(opEntries('exit.failed.held').map((o) => o.tradeId)).toEqual([pos.tradeId]);
    expect(await heldBalance(sc)).toBe(pos.bought);
    // No sell of the position ever landed (the only sells sent are the missed private attempts).
    expect(sellsSince(sc, 0).every((s) => sc.node.statusOf(s.hash) !== 'mined')).toBe(true);
    return { sc, dash, cookie, pos };
}

describe('AUD-API-001: dashboard force-sell and emergency-sell skip a still-held position whose exit failed (ESC-PRE-04)', () => {
    it('force-sell-skips-failed-held: after the catch path marks the position failed while its tokens are still held, force-sell answers 404 and sends no sell', async (ctx) => {
        const { sc, dash, cookie, pos } = await failedHeldPosition();
        const fromSubmit = sc.node.submitted.length;
        const reply = await postDriven(sc, dash, `/api/controls/force-sell/${pos.tradeId}`, cookie, 'land');
        const newSells = sellsSince(sc, fromSubmit);

        knownBug(ctx, 'AUD-API-001', {
            claim: 'force-sell-skips-failed-held',
            correct: { operatorSellReachesPosition: true },
            observed: { operatorSellReachesPosition: false },
            actual: { operatorSellReachesPosition: newSells.length > 0 },
            expectedPlain: 'Force-sell from the dashboard reaches a position whose last exit failed while its tokens are still held, and sells it.',
            actualPlain: 'After a sell failed with the tokens still in the wallet, the dashboard force-sell answered 404 "Trade not found or already closed" and sent no sell.',
        });
        expect(reply).toEqual({ status: 404, body: { error: 'Trade not found or already closed' } });
        expect(sc.node.submitted.length).toBe(fromSubmit);
        // The bot's own restart query counts the same position as open.
        const resumable = sc.graph.db.prepare('SELECT id FROM trades t LEFT JOIN exit_state e ON e.trade_id = t.id WHERE (t.status = \'pending\' AND t.action = \'buy\') OR e.exit_status = \'exit_failed_held\'').all() as Array<{ id: number }>;
        expect(resumable.map((r) => r.id)).toEqual([pos.tradeId]);
        expect(await heldBalance(sc)).toBe(pos.bought);
        expect(recordedLogs().some((l) => l.msg === 'Cleared exit timers for force sell' && l.bindings.tradeId === pos.tradeId)).toBe(true);
    });

    it('emergency-sell-skips-failed-held: after the catch path marks the position failed while its tokens are still held, emergency-sell answers "No open positions to sell" and sends no sell', async (ctx) => {
        const { sc, dash, cookie, pos } = await failedHeldPosition();
        const fromSubmit = sc.node.submitted.length;
        const reply = await postDriven(sc, dash, '/api/controls/emergency-sell', cookie, 'land');
        const newSells = sellsSince(sc, fromSubmit);
        const namesPosition = JSON.stringify(reply.body).includes(`"tradeId":${pos.tradeId}`);

        knownBug(ctx, 'AUD-API-001', {
            claim: 'emergency-sell-skips-failed-held',
            correct: { emergencySellReachesPosition: true },
            observed: { emergencySellReachesPosition: false },
            actual: { emergencySellReachesPosition: newSells.length > 0 || namesPosition },
            expectedPlain: 'Emergency sell-all reaches a position whose last exit failed while its tokens are still held: it sells it, or at least reports it as not sold.',
            actualPlain: 'After a sell failed with the tokens still in the wallet, emergency sell-all answered "No open positions to sell", sent no sell and named nothing it skipped.',
        });
        expect(reply).toEqual({ status: 200, body: { ok: true, sold: 0, failed: 0, message: 'No open positions to sell' } });
        expect(sc.node.submitted.length).toBe(fromSubmit);
        expect(recordedLogs().some((l) => l.msg === 'Emergency sell initiated')).toBe(false);
        expect(await heldBalance(sc)).toBe(pos.bought);
    });
});
