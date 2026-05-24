// src/anti-rug/exitTrigger.ts
// Phase 19 / Plan 19-05 — real bridge from the anti-rug detector to
// exitEngine.executeFullSell per ANTIRUG-08.
//
// This module is the SINGLE bridge from the multi-signal AND-chain evaluator
// (Plan 19-04b) to the production sell pipeline. It applies TWO sequential
// gates before invoking executeFullSell:
//
//   1. Dry-run gate (D-LIVE-PER-CHAIN + D-DRY-TELEMETRY): if
//      ctx.chain.antiRug.liveExecute === false (default), log the would-have-
//      sold telemetry + emit the [DRY-RUN] Telegram alert + broadcast
//      'antirug_state_update' with state='would-have-sold' + return false
//      WITHOUT calling executeFullSell. This is the 7-day dry-run mode per
//      D-LIVE-GATE — operator graduates per chain to live by flipping the
//      <CHAIN>_ANTIRUG_LIVE_EXECUTE env + restart.
//
//   2. Circuit-breaker gate (ANTIRUG-09): if isCircuitBreakerTripped(chain)
//      is true, log the suppression + return false WITHOUT calling
//      executeFullSell. The breaker auto-disables anti-rug exits after N
//      triggers in W hours (default 3/1h). Operator manually resets via the
//      dashboard (Plan 19-06).
//
// Live execute path (both gates pass):
//   - clearAllTimersForToken(chain, token) FIRST to eliminate race with the
//     existing exit-engine timers (precedent: force-sell handler in
//     src/api/routes/controls.ts:82-110).
//   - executeFullSell(ctx, dex, tokenAddress, feeTier, 'anti-rug', tradeId,
//     reasonDetail). The new 'anti-rug' reason variant landed in Plan 19-05
//     Task 1a — it threads the elevated gas multiplier per ANTIRUG-08 and
//     fires the [ANTI-RUG EXIT] Telegram alert per D-VIS-LIVE-EXIT.
//   - broadcast 'antirug_state_update' with state='exit-fired'.
//   - incrementCircuitBreaker(ctx, evt) — recorded on BOTH success AND
//     failure paths. A failed exit still consumed a trigger slot: the
//     breaker is a defense against rapid-fire false positives regardless of
//     outcome (see Plan 19-05 PLAN.md Test 12 rationale).
//
// reasonDetail format (consumed by the [ANTI-RUG EXIT] alert + the trades
// row's reasonDetail column): `LP removed {pct}% by {destination}; {Y}%
// sell-sim/reserves slippage` where Y prefers the V3 sell-sim slippage if
// available, falls back to the V2 reserves percent-below, and finally
// reports 'n/a' when neither is set.
//
// References:
//   - .planning/REQUIREMENTS.md ANTIRUG-08, ANTIRUG-09, ANTIRUG-10
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md
//       D-LIVE-PER-CHAIN, D-DRY-TELEMETRY, D-VIS-LIVE-EXIT
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md
//       §"src/anti-rug/exitTrigger.ts" (lines 202-278)
//   - src/exitEngine.ts:424-519 — the executeFullSell pipeline this module
//     bridges to.
//   - src/api/routes/controls.ts:51-111 — the force-sell handler precedent
//     for the clearAllTimersForToken-then-executeFullSell sequence.

import type { ChainContext, DexConfig } from '../chainRegistry';
import type { RugEvaluation, TriggerEvent } from './types';
import { executeFullSell } from '../exitEngine';
import { clearAllTimersForToken } from '../utils/exitManager';
import { sendCtxAlert } from '../utils/notifier';
import { broadcast } from '../api/ws/broadcaster';
import { logger } from '../utils/logger';
import { isCircuitBreakerTripped, incrementCircuitBreaker } from './circuitBreaker';

const log = logger.child({ module: 'antiRug:exitTrigger' });

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the human-readable reasonDetail string passed downstream into
 * executeFullSell and surfaced via the [ANTI-RUG EXIT] Telegram alert plus
 * the trades-row reasonDetail column.
 *
 * Slippage source preference:
 *   1. V3 sell-sim slippage (`sellSimSlippagePct`) when present (V3 path).
 *   2. V2 reserves percent below threshold (`v2ReservePctBelow`) as the V2
 *      fallback.
 *   3. Literal 'n/a' when neither is set (defensive — never expected on the
 *      'unsafe' verdict branch because the multi-signal AND chain requires
 *      one of the two).
 */
function formatReasonDetail(evaluation: RugEvaluation): string {
    // Only the 'allowlisted' / 'unsafe' / 'safe' variants carry `signals`;
    // the 'unknown' variant does not. Guard via `'signals' in evaluation`.
    if (!('signals' in evaluation)) {
        return `Anti-rug verdict='${evaluation.verdict}'`;
    }
    const { signals } = evaluation;
    const slippage =
        signals.sellSimSlippagePct ?? signals.v2ReservePctBelow ?? 'n/a';
    return `LP removed ${signals.lpRemovedPct}% by ${signals.destination}; ${slippage}% sell-sim/reserves slippage`;
}

/**
 * Build the TriggerEvent payload for the circuit-breaker ring buffer + the
 * dashboard 'antirug_state_update' broadcast.
 */
function makeTriggerEvent(
    chain: string,
    tokenAddress: string,
    pairAddress: string,
    evaluation: RugEvaluation,
    outcome: string,
): TriggerEvent {
    const signals = 'signals' in evaluation
        ? evaluation.signals
        : {
              // Default fail-closed shape if the verdict variant lacks signals
              // (e.g. 'unknown'); we should never reach this code path but a
              // type-safe default keeps callers honest.
              lpRemovedPct: 0,
              destination: '0x0000000000000000000000000000000000000000',
              allowlistHit: 'unknown' as const,
              sellSimSlippagePct: null,
              v2ReservePctBelow: null,
          };
    return {
        token: tokenAddress,
        pair: pairAddress,
        signals,
        outcome,
        timestamp: Date.now(),
        chain,
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dispatch the anti-rug exit after the multi-signal AND chain emits an
 * 'unsafe' verdict and the confirm-after-N-blocks gate (Plan 19-04b) has
 * elapsed.
 *
 * @param ctx          ChainContext (carries antiRug.liveExecute + chain.name).
 * @param dex          DexConfig the position was opened against.
 * @param tokenAddress Token being exited.
 * @param feeTier      V3 fee tier (null for V2).
 * @param tradeId      trades.id of the position to exit.
 * @param evaluation   RugEvaluation that triggered (carries the signals
 *                     surfaced into reasonDetail + the dashboard broadcast).
 * @returns true if a live exit was fired and executeFullSell returned true;
 *          false on dry-run gate, CB gate, or executeFullSell failure.
 */
export async function triggerAntiRugExit(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    tradeId: number,
    evaluation: RugEvaluation,
): Promise<boolean> {
    const chain = ctx.chain.name;
    const pairAddress = 'signals' in evaluation ? evaluation.signals.destination : '0x';
    const liveExecute = ctx.chain.antiRug.liveExecute;

    // -------------------------------------------------------------------
    // GATE 1 — Dry-run (D-LIVE-PER-CHAIN + D-DRY-TELEMETRY)
    // -------------------------------------------------------------------
    if (!liveExecute) {
        log.info(
            {
                chain,
                tradeId,
                token: tokenAddress,
                feeTier,
                verdict: evaluation.verdict,
                signals: 'signals' in evaluation ? evaluation.signals : undefined,
                op: 'antirug.dry-run.would-have-sold',
            },
            '[DRY-RUN] Anti-rug exit would have fired — liveExecute disabled',
        );

        // [DRY-RUN] Telegram alert per D-DRY-TELEMETRY phrasing.
        const reasonDetail = formatReasonDetail(evaluation);
        await sendCtxAlert(
            ctx,
            `*[DRY-RUN] Anti-rug would-have-sold:* \`${tokenAddress}\`\nChain: ${ctx.chain.displayName}\nSignals: ${reasonDetail}`,
        ).catch((err: unknown) => {
            log.warn({ err, chain, op: 'antirug.dry-run.alert-failed' }, 'Dry-run alert failed');
        });

        // Dashboard push per UI-SPEC §"Realtime Push Contract".
        // CR-06: send `undefined` (omit field) for the unknown-verdict
        // path instead of literal `null`. Frontend type allows both, but
        // omitting is cleaner — `useWebSocket` normalises either to
        // undefined before storing on Position.
        broadcast('antirug_state_update', {
            tradeId,
            chain,
            state: 'would-have-sold',
            lastEventTs: Date.now(),
            lastSignals: 'signals' in evaluation ? evaluation.signals : undefined,
        });

        return false;
    }

    // -------------------------------------------------------------------
    // GATE 2 — Circuit breaker (ANTIRUG-09)
    // -------------------------------------------------------------------
    if (isCircuitBreakerTripped(chain)) {
        log.fatal(
            {
                chain,
                tradeId,
                token: tokenAddress,
                op: 'antirug.cb-tripped.exit-suppressed',
            },
            'Anti-rug exit suppressed — circuit breaker tripped',
        );
        return false;
    }

    // -------------------------------------------------------------------
    // LIVE EXECUTE PATH
    // -------------------------------------------------------------------
    // (a) Clear all timers for this token FIRST — eliminates the race with
    // the existing exit-engine poll-loop (precedent: src/api/routes/controls.ts
    // force-sell handler lines 82-110).
    clearAllTimersForToken(chain, tokenAddress);

    const reasonDetail = formatReasonDetail(evaluation);
    log.info(
        {
            chain,
            tradeId,
            token: tokenAddress,
            feeTier,
            verdict: evaluation.verdict,
            op: 'antirug.exit.dispatch',
        },
        'Anti-rug exit dispatched to executeFullSell',
    );

    // (b) Bridge to executeFullSell with reason='anti-rug'.
    const success = await executeFullSell(
        ctx,
        dex,
        tokenAddress,
        feeTier,
        'anti-rug',
        tradeId,
        reasonDetail,
    );

    // (c) Broadcast exit-fired update for the dashboard.
    // CR-06: `success` is now declared on the frontend
    // AntiRugStateUpdate type so the value reaches the dashboard.
    // `lastSignals: undefined` (omitted) for the unknown-verdict path
    // instead of literal `null`.
    broadcast('antirug_state_update', {
        tradeId,
        chain,
        state: 'exit-fired',
        lastEventTs: Date.now(),
        lastSignals: 'signals' in evaluation ? evaluation.signals : undefined,
        success,
    });

    // (d) Record toward the circuit breaker on BOTH success AND failure.
    // A failed exit still consumed a trigger slot — the breaker protects
    // against rapid-fire false positives regardless of outcome (Test 12).
    const outcome = success ? 'exit-fired-success' : 'exit-fired-failure';
    incrementCircuitBreaker(
        ctx,
        makeTriggerEvent(chain, tokenAddress, pairAddress, evaluation, outcome),
    );

    return success;
}
