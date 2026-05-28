// src/utils/withTimeout.ts
//
// Phase 21.2 Plan 02 (STOP-THE-LINE-04-B, Finding B layer 3): per-RPC-call
// wall-clock timeout wrapper.
//
// WHY: ethers v6 has NO reliable per-call abort. `FetchRequest.timeout` does
// not actually abort an in-flight request (ethers issues #4122 / #4765), so a
// slow/stalled RPC can park the single Node event loop indefinitely, blocking
// ALL monitoring (threat T-21.2-HANG). `Promise.race([op(), timeout])` frees the
// awaiting code path deterministically after `ms` — it does NOT cancel the
// underlying network request (nothing in ethers v6 can), it just stops US from
// waiting on it, which is the lever we actually need.
//
// SAFETY (threat T-21.2-TIMER-LEAK): the timeout timer is `.unref()`'d so it can
// never keep the process alive (mirrors the force-exit timer at bot.ts:1401-1404),
// and is cleared in `finally` whichever branch of the race settles first, so no
// timer ever leaks.
//
// The rejection is a REAL `Error` (NEVER a bare string — that is the Flashbots
// lib's own anti-pattern at bundle.wait(), and callers guard with
// `e instanceof Error ? e.message : String(e)`).

/**
 * Bound a promise-returning operation by a wall-clock timeout.
 *
 * Resolves to `op()`'s value if it settles within `ms`. Otherwise rejects with
 * an `Error` whose message is `RPC timeout after <ms>ms: <label>`. The underlying
 * `op()` is NOT cancelled (ethers v6 cannot reliably abort) — this only frees the
 * caller from awaiting it.
 *
 * @param op    Factory invoked once to start the operation (e.g. `() => provider.getBalance(addr)`).
 * @param ms    Wall-clock budget in milliseconds before the timeout fires.
 * @param label Human-readable tag for the call, surfaced in the timeout Error message.
 */
export async function withTimeout<T>(
    op: () => Promise<T>,
    ms: number,
    label: string,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`RPC timeout after ${ms}ms: ${label}`)),
            ms,
        );
        // Never let the timeout timer keep the Node process alive (T-21.2-TIMER-LEAK).
        // `unref` exists on Node's Timeout but is absent on some shims, so guard it.
        if (timer.unref) timer.unref();
    });
    try {
        return await Promise.race([op(), timeout]);
    } finally {
        // Clear whichever branch won so the timer never leaks (proven by Test 4).
        clearTimeout(timer!);
    }
}
