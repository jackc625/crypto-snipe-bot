// test/realpath/triage/AUD-DB-002.test.ts
// Phase 23 plan 23-11 Task 1 (AUDIT-02): AUD-DB-002, the daily-loss breaker and the exposure cap
// compare amounts in two different units, so an ordinary losing trade is never counted as a loss
// and one partial sell makes total exposure hugely negative.
//
// The sites. The buy rows are written by src/bot.ts (the V2 snipe's trades insert, amountIn =
// ctx.chain.snipeAmount, a decimal native-unit string such as "0.05", gasCost null). The sell and
// partial-sell rows are written by src/exitEngine.ts executeFullSell and executePartialSell with
// amountOut and gasCost straight from src/utils/receiptDecoder.ts: the WETH Withdrawal wad and
// gasUsed * gasPrice, both wei integer strings. src/utils/db.ts getDailyRealizedLoss sums
// CAST(amount_out) - CAST(amount_in) - gas over sold positions where that is below zero, and
// getTotalExposure sums CAST(buy amount_in) - SUM(CAST(partial_sell amount_out)): wei against a
// decimal ETH amount in both. src/riskManager.ts canSnipe compares those sums with
// -(maxCapital * DAILY_LOSS_PCT / 100) and with MAX_TOTAL_EXPOSURE, both in native units.
//
// Proof on the real path. Every row comes from the real insert sites, never from this file: a real
// ETH V2 snipe (the AC-01 path) writes the buy row, and the real exit path writes the sell row
// through the real receipt decoder. The chain answers as fixtures/AUD-EXIT-001-sell-path.ts
// describes: the sell receipt carries a real-encoded WETH Withdrawal(router, out) set with
// node.setReceiptLogs, where `out` is the router's own constant-product answer on the pool's
// reserves at that moment. Then the real canSnipe runs (fixtures/AUD-DB-002-risk.ts), which reads
// the real risk statements.
//   - ordinary-loss-not-counted: ETH_SNIPE_AMOUNT 0.05, ETH_MAX_CAPITAL 1.0, DAILY_LOSS_PCT 2 (a
//     0.02 ETH daily limit), set before the graph loads. Another wallet dumps tokens worth half the
//     pool's token reserve, the price falls about 56 percent, the real poll loop fires the stop-loss
//     and executeFullSell sells the whole position. The proceeds are far above the sell's gas (an
//     ordinary loss, not a near-total one), and cost minus proceeds is above the 0.02 ETH limit.
//     Correct: the loss is counted and canSnipe refuses with daily_loss_limit.
//   - partial-sell-makes-exposure-negative: PARTIAL_SELL_TARGETS 2x:25 and MAX_TOTAL_EXPOSURE 0.012,
//     set before the graph loads. Another wallet buys with half the pool's ETH (price about 2.25x),
//     the 2x tier fires and executePartialSell sells a quarter. The position stays open, so its
//     remaining exposure is positive and the next 0.01 ETH snipe would put total exposure above
//     0.012. Correct: exposure stays positive and canSnipe refuses with exposure_cap.
// In both, SNIPE_COOLDOWN_MS is 1000 so the cooldown rule never decides the result (the canSnipe
// call comes long after the buy), and the other rules are clear (no MAX_POSITION_SIZE, one or no
// open position against 10).
//
// What is measured: the harm, so a fix that stores one unit at the insert sites or one that
// converts at the SQL boundary both read "looks fixed" (D-08). After each marker the mixed-unit
// rows are asserted as details: the decimal buy amount and the wei sell amounts, and the exact
// statement results.
//
// Sub-claim 4 (dashboard P&L shows mixed-unit numbers) is the API slice's display and stays
// code-read here. Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { formatEther, parseEther } from 'ethers';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepUntilTrue, v2AmountOut } from '../harness/world';
import { heldPosition } from './fixtures/AUD-API-001-dashboard-sell';
import { canSnipeNow, realizedLoss24h, totalExposure, tradeRows } from './fixtures/AUD-DB-002-risk';
import { foreignTrade, landNextSell } from './fixtures/AUD-EXIT-001-sell-path';
import { buyRow, opEntries, opLogged } from './fixtures/AUD-EXIT-002-position';

describe('AUD-DB-002: the daily-loss breaker and the exposure cap mix decimal ETH with wei', () => {
    it('ordinary-loss-not-counted: after a real buy and a real stop-loss sell at a loss above the daily limit, the loss is not counted and canSnipe still allows the next snipe', async (ctx) => {
        const sc = await createScenario({
            chain: 'eth',
            dexType: 'v2',
            overrides: { ETH_SNIPE_AMOUNT: '0.05', ETH_MAX_CAPITAL: '1.0', DAILY_LOSS_PCT: '2', SNIPE_COOLDOWN_MS: '1000' },
        });
        const { node } = sc;
        const pos = await heldPosition(sc);
        const cost = parseEther(sc.ctx.chain.snipeAmount);
        const limit = parseEther(sc.ctx.chain.maxCapital) * 2n / 100n;

        // An ordinary losing trade: another wallet dumps, the real stop-loss sells the whole position.
        const fromSubmit = node.submitted.length;
        await foreignTrade(sc, { sellTokens: sc.reserves.token / 2n });
        const proceeds = v2AmountOut(pos.bought, sc.reserves.token, sc.reserves.weth);
        const { sell } = await landNextSell(sc, { fromSubmit });
        await stepUntilTrue(() => buyRow(sc)?.status === 'sold' && tradeRows(sc).some((r) => r.action === 'sell'), { what: 'the sell row and the position closing', maxSteps: 20_000 });
        const sellRow = tradeRows(sc).find((r) => r.action === 'sell')!;
        const sellGas = BigInt(sellRow.gas_cost ?? '0');
        // Setup facts, true under the bug and every fix: the whole position was sold by the stop-loss
        // through the real path; proceeds are far above the sell's gas; the loss is above the limit.
        expect(sell.amountIn).toBe(pos.bought);
        expect(opEntries('exit.trigger.stop-loss').length).toBeGreaterThanOrEqual(1);
        expect(node.statusOf(sell.hash)).toBe('mined');
        expect(proceeds).toBeGreaterThan(sellGas * 2n);
        expect(cost - proceeds).toBeGreaterThan(limit);

        const result = await canSnipeNow(sc);
        const loss = realizedLoss24h(sc);

        knownBug(ctx, 'AUD-DB-002', {
            claim: 'ordinary-loss-not-counted',
            correct: { lossCounted: true, breakerTrips: true },
            observed: { lossCounted: false, breakerTrips: false },
            actual: { lossCounted: loss < 0, breakerTrips: result.reason === 'daily_loss_limit' },
            expectedPlain: 'A sold position that lost more than the daily limit (here 0.02 ETH, 2 percent of 1 ETH) is counted as a realized loss, and the risk gate refuses the next snipe on that chain.',
            actualPlain: 'A 0.05 ETH buy sold by the stop-loss for about 0.022 ETH was not counted at all: the daily realized loss stayed 0 and the risk gate allowed the next snipe, because the sell proceeds are stored in wei and the buy cost in decimal ETH.',
        });

        // Details: the rows as the real insert sites wrote them, in two units.
        const buy = tradeRows(sc).find((r) => r.action === 'buy')!;
        expect(buy).toMatchObject({ id: pos.tradeId, amount_in: '0.05', amount_out: null, gas_cost: null, status: 'sold' });
        expect(sellRow).toMatchObject({ action: 'sell', tx_hash: sell.hash, amount_in: pos.bought.toString(), amount_out: proceeds.toString(), status: 'sold' });
        expect(sellGas).toBeGreaterThan(0n);
        // getDailyRealizedLoss computes wei proceeds minus decimal cost minus wei gas: positive, so the
        // row is skipped by its "< 0" filter and the sum is exactly 0.
        expect(Number(proceeds) - 0.05 - Number(sellGas)).toBeGreaterThan(0);
        expect(loss).toBe(0);
        expect(result).toEqual({ allowed: true });
        expect(Number(formatEther(cost - proceeds))).toBeGreaterThan(0.02);
        expect(recordedLogs().some((l) => l.msg === 'Risk check failed')).toBe(false);
    });

    it('partial-sell-makes-exposure-negative: after a real buy and a real 2x partial sell of a quarter, total exposure is hugely negative and canSnipe allows a snipe the exposure cap should refuse', async (ctx) => {
        const sc = await createScenario({
            chain: 'eth',
            dexType: 'v2',
            overrides: { PARTIAL_SELL_TARGETS: '2x:25', MAX_TOTAL_EXPOSURE: '0.012', SNIPE_COOLDOWN_MS: '1000' },
        });
        const { node } = sc;
        const pos = await heldPosition(sc);
        const cost = parseEther(sc.ctx.chain.snipeAmount);
        const cap = parseEther('0.012');

        const fromLog = recordedLogs().length;
        const fromSubmit = node.submitted.length;
        await foreignTrade(sc, { buyEth: sc.reserves.weth / 2n });
        const quarter = (pos.bought * 25n) / 100n;
        const proceeds = v2AmountOut(quarter, sc.reserves.token, sc.reserves.weth);
        const { sell } = await landNextSell(sc, { fromSubmit });
        await stepUntilTrue(() => opLogged('exit.partial.executed', fromLog) && tradeRows(sc).some((r) => r.action === 'partial_sell'), { what: 'the partial sell row', maxSteps: 20_000 });
        // Setup facts, true under the bug and every fix: a quarter was sold through the real partial
        // path, the position is still open, and what is left of its cost (whether counted as cost
        // minus proceeds or as the unsold share) plus the next snipe is above the 0.012 cap.
        expect(sell.amountIn).toBe(quarter);
        expect(node.statusOf(sell.hash)).toBe('mined');
        expect(buyRow(sc)?.status).toBe('pending');
        expect(proceeds).toBeLessThan(cost);
        expect(cost - proceeds + cost).toBeGreaterThan(cap);
        expect((cost * 75n) / 100n + cost).toBeGreaterThan(cap);

        const exposure = totalExposure(sc);
        const result = await canSnipeNow(sc);

        knownBug(ctx, 'AUD-DB-002', {
            claim: 'partial-sell-makes-exposure-negative',
            correct: { exposurePositive: true, exposureCapRefuses: true },
            observed: { exposurePositive: false, exposureCapRefuses: false },
            actual: { exposurePositive: exposure > 0, exposureCapRefuses: result.reason === 'exposure_cap' },
            expectedPlain: 'After a take-profit partial sell the position is still open, so its remaining exposure stays positive and the exposure cap (here 0.012 ETH) refuses a snipe that would go over it.',
            actualPlain: 'One partial sell of a quarter made total exposure about minus 5.6 quadrillion (wei proceeds subtracted from a 0.01 ETH cost), so the exposure cap can never refuse while that position is open, and the next snipe was allowed.',
        });

        // Details: the decimal buy cost minus the wei partial proceeds.
        const partial = tradeRows(sc).find((r) => r.action === 'partial_sell')!;
        expect(partial).toMatchObject({ tx_hash: sell.hash, amount_in: quarter.toString(), amount_out: proceeds.toString(), status: 'sold' });
        expect(tradeRows(sc).find((r) => r.action === 'buy')).toMatchObject({ id: pos.tradeId, amount_in: '0.01', status: 'pending' });
        expect(exposure).toBe(0.01 - Number(proceeds));
        expect(exposure).toBeLessThan(-1e15);
        expect(result).toEqual({ allowed: true });
    });
});
