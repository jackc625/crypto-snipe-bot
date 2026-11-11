// test/realpath/triage/AUD-DB-003.test.ts
// Phase 23 plan 23-11 Task 2 (AUDIT-02): AUD-DB-003, a position the bot still holds after a failed
// sell drops out of the risk limits.
//
// The sites. The catch path of src/exitEngine.ts executeFullSell re-reads balanceOf and, when the
// tokens are still held, sets trades.status to 'failed' (updateTradeStatus.run('failed', ...)) and
// runs keepMonitoringFailedHeld, which stamps exit_state.exit_status 'exit_failed_held' and keeps
// monitoring the position. src/utils/db.ts getOpenPositionCount and getTotalExposure count only
// trades with status 'pending', so src/riskManager.ts canSnipe no longer sees the position in its
// open-position limit or its exposure cap, while the bot's own restart query
// (getResumeExitMonitorTrades) still counts it as open.
//
// Proof on the real path. A real ETH V2 snipe on a temp database file (the AC-01 path), bought and
// armed (fixtures/AUD-API-001-dashboard-sell.ts heldPosition). Another wallet dumps 30 percent of
// the pool's token reserve, so the real poll loop fires the stop-loss and the exit worker runs the
// real executeFullSell: its public approve is mined, its private Flashbots attempts miss their
// slots (empty blocks), and the public fallback swap is refused at gas estimation with the answer a
// real node gives for a token that blocks sells (geth code 3, "execution reverted: TransferHelper:
// TRANSFER_FROM_FAILED", as in AUD-API-001). The catch path then finds every token still held.
// EXIT_ROUTINE_MAX_FAILURES is 1, so routine retries pause after that one failure and no further
// sell is sent (the fatal exit.failed.held.routine-paused line is that forced setting; the
// mev.reconcile.not-landed, mev.escalation.ceiling-hit, exit.private.not-landed and exit.full.failed
// lines are the forced misses and refusal). Preconditions asserted: trades.status 'failed',
// exit_status 'exit_failed_held', the fault fired once, the tokens still held. Then the graph is
// reloaded on the same file (restartGraph) under one tight limit at a time, and the real canSnipe is
// asked for the next 0.01 ETH snipe:
//   - failed-held-not-counted-open: MAX_OPEN_POSITIONS 1 (exposure cap 10). Correct: the held
//     position fills the one slot and canSnipe refuses with max_positions.
//   - failed-held-not-counted-in-exposure: MAX_TOTAL_EXPOSURE 0.015 (open limit 10). Correct: the
//     held 0.01 ETH counts, 0.01 + 0.01 is over 0.015, and canSnipe refuses with exposure_cap.
// The restart is the realistic case (the bot restarted while the position is held) and empties the
// in-memory cooldown map, so the cooldown rule never decides the result; no sell row exists, so the
// daily-loss rule is clear.
//
// What is measured: the risk gate's answer (the harm). A fix that counts open positions from the
// exit lifecycle, as the finding recommends, reads "looks fixed" (D-08) on each claim separately.
// After the markers: both statements return 0 for the position and the restart query returns it.
//
// The daily-loss half (an unsold held position has no sell row) is the unrealized-loss question of
// card DB-01 and stays code-read. Only the harness mocks are in use (harness/setup.ts); nothing here
// mocks anything.

import { describe, expect, it } from 'vitest';
import { revertReason } from '../harness/chain';
import { knownBug } from '../harness/knownBug';
import { createScenario, createTempDbFile, stepUntil, type Scenario } from '../harness/world';
import { driveChain, exitStatusOf, heldPosition, sellsSince, type HeldPosition } from './fixtures/AUD-API-001-dashboard-sell';
import { reloadAndCheck } from './fixtures/AUD-DB-001-limits';
import { openPositionCount, totalExposure } from './fixtures/AUD-DB-002-risk';
import { foreignTrade } from './fixtures/AUD-EXIT-001-sell-path';
import { ERC20, buyRow, opEntries } from './fixtures/AUD-EXIT-002-position';
import { settleAntiRugArming } from './fixtures/AUD-TX-002-lock';

/** The public fallback's swap (src/exitEngine.ts executePublicFallbackSell). */
const PUBLIC_FALLBACK_SWAP = 'swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)';

async function heldBalance(sc: Scenario): Promise<bigint> {
    const data = ERC20.encodeFunctionData('balanceOf', [sc.wallet.address]);
    const res = await stepUntil(sc.ctx.httpProvider.call({ to: sc.token, data }));
    return ERC20.decodeFunctionResult('balanceOf', res)[0] as bigint;
}

/** A position driven to exit_failed_held by the real stop-loss whose sell cannot go through. */
async function failedHeldPosition(): Promise<{ sc: Scenario; pos: HeldPosition }> {
    const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() }, overrides: { EXIT_ROUTINE_MAX_FAILURES: '1' } });
    const pos = await heldPosition(sc);
    const revert = sc.node.failNext('eth_estimateGas', {
        selector: PUBLIC_FALLBACK_SWAP,
        to: sc.dex.routerAddress,
        error: { code: 3, message: 'execution reverted: TransferHelper: TRANSFER_FROM_FAILED', data: revertReason('TransferHelper: TRANSFER_FROM_FAILED').revert },
    });
    await foreignTrade(sc, { sellTokens: (sc.reserves.token * 3n) / 10n });
    await driveChain(sc, { mode: 'miss', until: () => opEntries('exit.failed.held').length === 1, what: 'the stop-loss exit failing on a still-held position' });
    await settleAntiRugArming(sc, 1);

    // Preconditions: the real catch path ran on a still-held position.
    expect(revert.fired).toBe(1);
    expect(opEntries('exit.trigger.stop-loss').length).toBeGreaterThanOrEqual(1);
    expect(opEntries('exit.fallback.public.submit')).toHaveLength(1);
    expect(String((opEntries('exit.full.failed')[0]?.err as Error)?.message ?? '')).toContain('TRANSFER_FROM_FAILED');
    expect(buyRow(sc)?.status).toBe('failed');
    expect(exitStatusOf(sc, pos.tradeId)).toEqual({ exit_status: 'exit_failed_held', exit_failure_count: 1 });
    expect(opEntries('exit.failed.held.routine-paused').map((o) => o.tradeId)).toEqual([pos.tradeId]);
    expect(await heldBalance(sc)).toBe(pos.bought);
    expect(sellsSince(sc, 0).every((s) => sc.node.statusOf(s.hash) !== 'mined')).toBe(true);
    return { sc, pos };
}

function resumable(sc: Scenario): number[] {
    return (sc.graph.dbModule.getResumeExitMonitorTrades.all() as Array<{ id: number }>).map((r) => r.id);
}

describe('AUD-DB-003: a still-held position whose exit failed drops out of the risk limits', () => {
    it('failed-held-not-counted-open: with one still-held failed-exit position and MAX_OPEN_POSITIONS 1, canSnipe allows the next snipe', async (ctx) => {
        const { sc, pos } = await failedHeldPosition();
        const check = await reloadAndCheck(sc, { MAX_OPEN_POSITIONS: '1', MAX_TOTAL_EXPOSURE: '10.0' });
        expect(check.loaded).toBe(true);
        const result = check.loaded ? check.result : null;

        knownBug(ctx, 'AUD-DB-003', {
            claim: 'failed-held-not-counted-open',
            correct: { openLimitRefuses: true },
            observed: { openLimitRefuses: false },
            actual: { openLimitRefuses: result?.reason === 'max_positions' },
            expectedPlain: 'A position the bot still holds after a failed sell counts as open, so with MAX_OPEN_POSITIONS at 1 the risk gate refuses the next snipe.',
            actualPlain: 'After a stop-loss sell failed with every token still in the wallet, the position was marked failed and the open-position count dropped to 0, so with MAX_OPEN_POSITIONS at 1 the risk gate allowed another snipe.',
        });
        expect(result).toEqual({ allowed: true });
        expect(openPositionCount(sc)).toBe(0);
        // The bot's own restart query counts the same position as open.
        expect(resumable(sc)).toEqual([pos.tradeId]);
        expect(exitStatusOf(sc, pos.tradeId)?.exit_status).toBe('exit_failed_held');
    });

    it('failed-held-not-counted-in-exposure: with one still-held failed-exit 0.01 ETH position and MAX_TOTAL_EXPOSURE 0.015, canSnipe allows the next 0.01 ETH snipe', async (ctx) => {
        const { sc, pos } = await failedHeldPosition();
        const check = await reloadAndCheck(sc, { MAX_OPEN_POSITIONS: '10', MAX_TOTAL_EXPOSURE: '0.015' });
        expect(check.loaded).toBe(true);
        const result = check.loaded ? check.result : null;
        expect(sc.ctx.chain.snipeAmount).toBe('0.01');

        knownBug(ctx, 'AUD-DB-003', {
            claim: 'failed-held-not-counted-in-exposure',
            correct: { exposureCapRefuses: true },
            observed: { exposureCapRefuses: false },
            actual: { exposureCapRefuses: result?.reason === 'exposure_cap' },
            expectedPlain: 'A position the bot still holds after a failed sell counts in total exposure, so a 0.015 ETH cap refuses a second 0.01 ETH snipe.',
            actualPlain: 'After a stop-loss sell failed with every token still in the wallet, the held 0.01 ETH dropped out of total exposure (0), so a 0.015 ETH cap allowed another 0.01 ETH snipe.',
        });
        expect(result).toEqual({ allowed: true });
        expect(totalExposure(sc)).toBe(0);
        expect(resumable(sc)).toEqual([pos.tradeId]);
    });
});
