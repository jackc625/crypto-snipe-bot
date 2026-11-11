// test/realpath/triage/AUD-EXIT-015.test.ts
// Phase 23 plan 23-07 Task 2 (AUDIT-02): AUD-EXIT-015. The probe size that produced a position's
// stored entry price is not stored; resume (and the re-arm after a failed exit) quote with the
// CURRENT snipe amount, so a changed setting (or a deliberate buy of another size) moves the price
// ratio with no price change and fires false stop-loss or trailing exits.
//
// The sites: src/exitEngine.ts startExitMonitor probes with parseEther(buyAmountNative) (for a
// snipe, the snipe amount at buy time) and stores only the probe's OUTPUT as entry_price;
// src/bot.ts resumeMultiChainMonitoring passes ctx.chain.snipeAmount (the current setting) to
// resumeExitMonitor, which re-quotes with it and divides by the stored entry price.
//
// Proof on the real path (review blocker 23-07 HIGH: a reload onto a fresh in-memory graph loses
// the exit_state row and tests a different branch). The scenario runs on a temp-file database. A
// real ETH V2 snipe at ETH_SNIPE_AMOUNT 0.01 is armed by the running bot. The bot is restarted on
// the same file (restartGraph) with ETH_SNIPE_AMOUNT 0.002, the real resumeMultiChainMonitoring
// runs, and the pool does not move. Before anything is evaluated, the test asserts that the
// original exit_state row is on the new connection with its stored entry price, and that the real
// resume logged exit.monitor.resumed for that trade (not a fresh start).
//
// What is measured:
//   - resume-probes-with-current-snipe-amount: the probe amounts of the resumed monitor's quotes,
//     decoded with real ethers from each eth_call's data in the node's call log. Correct: the
//     probe that produced the stored entry price (0.01). Today: the current setting (0.002).
//   - stop-loss-fires-without-price-change: whether an exit triggers in the first three poll
//     intervals after the restart, with the pool unchanged. Correct: none. Today: the 0.002 probe
//     answers about a fifth of the stored 0.01 output, priceMultiple about 0.2, and the 25 percent
//     stop-loss fires on the first tick. After the marker the market sell is landed and decoded:
//     the whole position sold and the position closed.
// The sell side of the chain (allowance, the wallet's balance after the sell, the sell receipt's
// WETH Withdrawal) comes from fixtures/AUD-EXIT-001-sell-path.ts, computed from mined transactions.
//
// Not proven here (code read, recorded in the finding): the other direction (a larger probe
// activates trailing at once, disables stop-loss and fires every partial tier), the deliberate buy
// (any amount other than the snipe amount breaks the first resume or re-arm), and the re-arm after
// a failed exit (src/exitEngine.ts keepMonitoringFailedHeld, the same ctx.chain.snipeAmount).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { getAddress, parseEther } from 'ethers';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, createTempDbFile, restartGraph, stepFor, stepUntilTrue, v2AmountOut } from '../harness/world';
import { buyAndMine, buyRow, exitQuotes, exitStateRow, listen, msgLogged, opEntries, opLogged, waitAntiRugArmed } from './fixtures/AUD-EXIT-002-position';
import { installSellPath, landNextSell, sellRouterOf } from './fixtures/AUD-EXIT-001-sell-path';

describe('AUD-EXIT-015: resume quotes with the current snipe amount, not the probe behind the stored entry price', () => {
    // Own limit: a restart plus a driven stop-loss sell. Under the full parallel `npm test` load it
    // took 11.6 s of the project's 15 s default (2026-11-11), the same pattern that made AUD-EXIT-003's
    // zero-entry test time out, so it gets 60 s, about 5x its measured run time under load.
    it('resume-probes-with-current-snipe-amount: after a restart with ETH_SNIPE_AMOUNT 0.01 -> 0.002 the resumed monitor probes 0.002 against an entry measured at 0.01, and the stop-loss fires with no price change', { timeout: 60_000 }, async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() } });
        const { node } = sc;
        const pollMs = sc.graph.exitEngine.exitConfig.pollIntervalMs;
        expect(sc.ctx.chain.snipeAmount).toBe('0.01');
        const entryProbe = parseEther('0.01');

        // A real snipe at 0.01, armed in the running bot.
        await listen(sc);
        const { buy } = await buyAndMine(sc);
        expect(buy.tx.value).toBe(entryProbe);
        // The arming wait first: it mines any public transaction of the wallet, so a fix that
        // approves at buy time does not stall the setup of this file.
        await waitAntiRugArmed(sc);
        expect(opLogged('exit.monitor.started')).toBe(true);
        const row = buyRow(sc)!;
        const bought = v2AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token);
        const saved = exitStateRow(sc, row.id)!;
        expect(saved.original_token_amount).toBe(bought.toString());
        installSellPath(sc, { bought });
        // Control, before the restart: the running monitor probes with the buy amount.
        await stepFor(pollMs, 50);
        expect(new Set(exitQuotes(sc).map((q) => q.amountIn))).toEqual(new Set([entryProbe]));
        expect(opLogged('exit.trigger.stop-loss')).toBe(false);

        // Restart on the same file with a different snipe amount; the pool does not move.
        const reservesBefore = { ...sc.reserves };
        await restartGraph(sc, { env: { ETH_SNIPE_AMOUNT: '0.002' } });
        expect(sc.ctx.chain.snipeAmount).toBe('0.002');
        // Before evaluating anything: the original row is on the new connection, entry price included.
        expect(exitStateRow(sc, row.id)).toEqual(saved);
        expect(saved.entry_price).toBe(Number(v2AmountOut(entryProbe, sc.reserves.token, sc.reserves.weth)));
        const fromLog = recordedLogs().length;
        const fromCall = node.callLog.length;
        const fromSubmit = node.submitted.length;
        sc.graph.bot.resumeMultiChainMonitoring([sc.ctx]);
        await stepUntilTrue(() => opEntries('exit.monitor.resumed', fromLog).some((e) => e.tradeId === row.id), { what: 'the real resume restoring the stored exit state' });
        expect(msgLogged('Created fresh exit state for pre-Phase7 trade', fromLog)).toBe(false);
        // The first poll interval after the resume (plus ethers' 10 ms request drain).
        await stepFor(pollMs + 1_000, 50);
        const probes = [...new Set(exitQuotes(sc, fromCall).map((q) => q.amountIn))];
        expect(probes.length).toBeGreaterThan(0);

        knownBug(ctx, 'AUD-EXIT-015', {
            claim: 'resume-probes-with-current-snipe-amount',
            correct: { probes: [entryProbe] },
            observed: { probes: [parseEther('0.002')] },
            actual: { probes },
            expectedPlain: 'After a restart the exit monitor re-quotes with the same probe that produced the stored entry price, so the price ratio moves only when the price moves.',
            actualPlain: 'After a restart with the snipe amount changed from 0.01 to 0.002, the resumed exit monitor quotes 0.002 against an entry price measured with 0.01.',
        });

        // Three poll intervals with the pool unchanged.
        await stepFor(2 * pollMs - 1_000, 50);
        expect(sc.reserves).toEqual(reservesBefore);
        const triggers = recordedLogs()
            .slice(fromLog)
            .filter((l) => /^exit\.trigger\./.test(String(l.obj?.op ?? '')))
            .map((l) => String(l.obj!.op));
        knownBug(ctx, 'AUD-EXIT-015', {
            claim: 'stop-loss-fires-without-price-change',
            correct: { exitTriggered: false },
            observed: { exitTriggered: true },
            actual: { exitTriggered: triggers.length > 0 },
            expectedPlain: 'A restart with a changed snipe amount, and no price change, triggers no exit.',
            actualPlain: 'With the pool unchanged, the resumed monitor read about a fifth of the entry price and the 25 percent stop-loss fired on its first tick, selling the whole position at market.',
        });

        // How it fails: the stop-loss, at about 0.2x, and a market sell of the whole position.
        expect(new Set(triggers)).toEqual(new Set(['exit.trigger.stop-loss']));
        const detail = String(opEntries('exit.trigger.stop-loss', fromLog)[0].detail);
        expect(detail).toBe('Fixed stop-loss at 0.20x (-80.0%)');
        const { sell } = await landNextSell(sc, { fromSubmit });
        // (Its output floor is AUD-EXIT-001's claim, proven in that file.)
        expect(sell).toEqual(expect.objectContaining({ to: sellRouterOf(sc), call: 'swapExactTokensForETH', amountIn: bought, tokenOut: getAddress(sc.weth) }));
        await stepUntilTrue(() => buyRow(sc)!.status === 'sold', { what: 'the position closing after the stop-loss sell', maxSteps: 20_000 });
        expect(exitStateRow(sc, row.id)).toBeUndefined();
    });
});
