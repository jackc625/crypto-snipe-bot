// src/utils/exitWatchdog.ts
//
// Phase 21.2 Plan 09 (STOP-THE-LINE-04-B, Finding B layer 1): the EXIT-WORKER
// WATCHDOG (D-WATCHDOG-ABORT). A small helper that bot.ts owns and wires into the
// serial ExitWorker (exitEngine.ts) via `setExitWorkerWatchdog`.
//
// WHY a dedicated module (D-QUALITY-FIRST): the watchdog is a self-contained
// liveness primitive. Keeping it out of the heavy bot.ts import graph makes it
// independently unit-testable with fake timers (test/unit/bot/watchdog.test.ts)
// and reusable, without pulling the entire bot/riskManager/api/telegram tree into
// a focused unit test. bot.ts re-exports `makeExitWatchdog` and owns the budget
// knob (WATCHDOG_BUDGET_MS) + the install call.
//
// WHY Promise.race (NOT a relied-upon AbortSignal): ethers v6 has NO reliable
// per-call abort (#4122/#4765 — confirmed in 21.2-02's withTimeout.ts). An
// AbortController passed to a hung ethers call does nothing (threat
// T-21.2-ABORT-NOOP / RESEARCH Pitfall 6). The lever that actually works is
// racing the submit against a wall-clock rejection: it frees the AWAITING code
// path (the drain loop) deterministically — it does NOT cancel the underlying
// socket (nothing in ethers v6 can), but freeing the loop is what we need so the
// bot can move to the next queued exit.
//
// On overrun the watchdog logs a dotted `op:'watchdog.abort'` (D-ALERTS) + sends
// a per-chain Telegram alert with a remediation pointer, then resolves to `false`
// so the drain loop KEEPS the bot alive. The stuck position stays held +
// monitored (21.2-07 D-FAILED-EXIT-KEEP-MONITORING) and is retried on a later
// poll tick. The race timer is `.unref()`'d and cleared in `finally` so it never
// leaks / keeps the process alive (mirrors withTimeout.ts, T-21.2-TIMER-LEAK).

import { sendCtxAlert } from './notifier';
import type { ExitWatchdog, ExitWorkItem } from '../exitEngine';

export interface ExitWatchdogOptions {
    /** Wall-clock budget per submit (ms). Must exceed one 45s confirm-window + margin. */
    budgetMs: number;
}

/**
 * Build the exit-worker watchdog wrapper (D-WATCHDOG-ABORT). It races the
 * (nonce-locked) submit against a `budgetMs` rejection timer; on overrun it frees
 * the awaiting drain loop (the bot stays alive), logs `op:'watchdog.abort'`, and
 * Telegram-alerts with a remediation pointer. A submit that settles under budget
 * passes its value straight through.
 */
export function makeExitWatchdog(opts: ExitWatchdogOptions): ExitWatchdog {
    const { budgetMs } = opts;
    return async (item: ExitWorkItem, op: () => Promise<boolean>): Promise<boolean> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        // A unique sentinel so a budget-overrun is distinguishable from a normal
        // false/true result WITHOUT throwing across the race. We RESOLVE the race
        // to the sentinel rather than rejecting it: a thrown timeout would surface
        // as a worker submit-failed log and muddy the survive-and-continue path.
        const WATCHDOG_ABORTED = Symbol('watchdog-aborted');
        const budget = new Promise<typeof WATCHDOG_ABORTED>((resolve) => {
            timer = setTimeout(() => resolve(WATCHDOG_ABORTED), budgetMs);
            // Never let the race timer keep the process alive (T-21.2-TIMER-LEAK).
            if (timer.unref) timer.unref();
        });
        try {
            const result = await Promise.race([op(), budget]);
            if (result === WATCHDOG_ABORTED) {
                // Budget overrun: the submit is still running on the (un-killable)
                // socket, but we FREE the drain loop. Position stays held+monitored.
                item.ctx.log.error(
                    {
                        op: 'watchdog.abort',
                        token: item.tokenAddress,
                        reason: item.reason,
                        tradeId: item.tradeId,
                        budgetMs,
                    },
                    'Exit submit exceeded the watchdog wall-clock budget — freeing the worker; ' +
                        'position stays held + monitored and will retry on a later poll tick',
                );
                await sendCtxAlert(
                    item.ctx,
                    `*Watchdog abort:* ${item.reason} submit for ${item.tokenAddress} exceeded ${budgetMs}ms. ` +
                        'Bot stays alive; the position is still held + monitored and will retry. ' +
                        'Check RPC/relay health; if it persists, exit manually via the public-mempool path.',
                );
                return false;
            }
            return result;
        } finally {
            // Clear whichever branch won so the budget timer never leaks.
            if (timer) clearTimeout(timer);
        }
    };
}
