// src/anti-rug/exitTrigger.ts
// Phase 19 / Plan 19-04b — STUB placeholder for the exitTrigger bridge.
//
// THE FULL IMPLEMENTATION LANDS IN PLAN 19-05 (ANTIRUG-08).
//
// Plan 19-04b's evaluator imports `triggerAntiRugExit` from this module so
// that the verdict='unsafe' branch can dispatch to the exit-engine bridge
// after the confirm-after-N-blocks gate. Plan 19-05 replaces this stub with
// the real implementation that:
//   - Acquires the existing exitEngine sell-lock (tryAcquireSellLock).
//   - Builds the appropriate V2 / V3 sell tx with `ctx.chain.antiRug.gasMultiplier`
//     elevated gas.
//   - Submits via the chain's MEV strategy (Flashbots on ETH; bloXroute on BSC;
//     passthrough on Base/Arb).
//   - Records the exit with `reason: 'anti-rug'` in the trades table.
//   - Emits the D-VIS-LIVE-EXIT Telegram alert + structured pino log.
//
// For Plan 19-04b ship time, this stub:
//   - Returns immediately when ctx.chain.antiRug.liveExecute === false (default;
//     dry-run mode per D-LIVE-PER-CHAIN). Emits a 'antirug.dry-run.would-have-sold'
//     log line carrying the full evaluation evidence.
//   - Logs a warn 'antirug.exit-trigger.stub-live-call' when liveExecute=true
//     because the real implementation is not yet wired — this is a safety guard.
//     Plan 19-05 replaces the stub before the operator graduates ANY chain to
//     live, so the warn branch only fires if the integration order is broken.
//
// References:
//   - .planning/REQUIREMENTS.md ANTIRUG-08 — exit bridge with elevated gas
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md
//       D-LIVE-PER-CHAIN, D-VIS-LIVE-EXIT
//   - src/exitEngine.ts:424-519 — the executeFullSell path Plan 19-05 bridges to

import type { ChainContext, DexConfig } from '../chainRegistry';
import type { RugEvaluation } from './types';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'antiRug:exitTrigger' });

/**
 * Dispatch the anti-rug exit. Plan 19-05 replaces this stub with the real
 * implementation that bridges to `exitEngine.executeFullSell` with
 * `reason: 'anti-rug'` and elevated gas per D-VIS-LIVE-EXIT + ANTIRUG-08.
 *
 * Stub behavior (Plan 19-04b ship time):
 *   - liveExecute=false (default dry-run) → log structured evidence + return.
 *   - liveExecute=true → log warn (real impl not yet wired) + return.
 *
 * In both branches, the function returns `true` to signal "dispatch attempted"
 * so the caller (Plan 19-04b's evaluator) can record the outcome for the
 * dashboard's frontrun-distribution panel (D-RACE-TELEMETRY).
 *
 * @param ctx          ChainContext with the antiRug config (liveExecute flag).
 * @param dex          DexConfig the position was opened against.
 * @param tokenAddress The token being exited.
 * @param feeTier      V3 fee tier (null for V2).
 * @param tradeId      trades.id of the position to exit.
 * @param evaluation   The RugEvaluation that triggered the exit.
 */
export async function triggerAntiRugExit(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    tradeId: number,
    evaluation: RugEvaluation,
): Promise<boolean> {
    const liveExecute = ctx.chain.antiRug.liveExecute;

    if (!liveExecute) {
        log.info(
            {
                chain: ctx.chain.name,
                tradeId,
                token: tokenAddress,
                feeTier,
                verdict: evaluation.verdict,
                signals: 'signals' in evaluation ? evaluation.signals : undefined,
                op: 'antirug.dry-run.would-have-sold',
            },
            '[DRY-RUN] Anti-rug exit would have fired — liveExecute disabled',
        );
        return true;
    }

    // Live-execute branch — Plan 19-05 ships the real bridge. If we reach
    // this branch before Plan 19-05 lands, log a structured warn so the
    // operator's audit trail surfaces the gap.
    log.warn(
        {
            chain: ctx.chain.name,
            tradeId,
            token: tokenAddress,
            feeTier,
            verdict: evaluation.verdict,
            op: 'antirug.exit-trigger.stub-live-call',
        },
        'Anti-rug exit dispatched in liveExecute mode but Plan 19-05 bridge not yet wired',
    );
    return true;
}
