// test/unit/utils/withTimeout.test.ts
// Phase 21.2 Plan 02 (STOP-THE-LINE-04-B, Finding B layer 3): proves the
// per-RPC-call timeout wrapper `withTimeout(op, ms, label)` deterministically
// frees the awaiting code path via Promise.race when a provider call hangs
// (ethers v6 has NO reliable per-call abort — #4122/#4765), passes through the
// op's value on early completion, rejects with a REAL Error (never a bare
// string — the Flashbots lib's own anti-pattern), and clears its `.unref()`'d
// timer in `finally` so no timer leaks / keeps the process alive (T-21.2-TIMER-LEAK).
//
// Fake timers make the time-out deterministic: a never-resolving op is held open
// while we advance the clock, proving the timeout fires on wall-clock alone.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout } from '../../../src/utils/withTimeout';

describe('Phase 21.2 — withTimeout per-RPC-call timeout wrapper', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('Test 1 (times out): rejects with a real Error after `ms` on a never-resolving op', async () => {
        // op never resolves → only the timeout can settle the race.
        const promise = withTimeout(() => new Promise<never>(() => {}), 1000, 'never');

        // Attach the rejection assertion BEFORE advancing timers so the rejected
        // promise is always observed (no unhandled-rejection noise).
        const assertion = expect(promise).rejects.toThrow('RPC timeout after 1000ms: never');

        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
    });

    it('Test 2 (resolves early): passes through the op value and never rejects when timers advance', async () => {
        const result = await withTimeout(() => Promise.resolve(42), 1000, 'fast');
        expect(result).toBe(42);

        // Advancing past the deadline must NOT turn a resolved op into a rejection.
        await vi.advanceTimersByTimeAsync(5000);
        // (reaching here without throwing proves the timeout did not fire post-resolution)
        expect(result).toBe(42);
    });

    it('Test 3 (real Error, not a bare string): the timeout rejection is instanceof Error', async () => {
        const promise = withTimeout(() => new Promise<never>(() => {}), 1000, 'never');
        const captured = promise.catch((e) => e);

        await vi.advanceTimersByTimeAsync(1000);

        const err = await captured;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('RPC timeout after 1000ms: never');
    });

    it('Test 4 (timer cleared): no pending timer remains after the op resolves (finally clearTimeout)', async () => {
        await withTimeout(() => Promise.resolve('done'), 1000, 'fast');
        // The `finally { clearTimeout(timer) }` must have removed the pending
        // timeout timer — a leaked timer here would keep the event loop alive.
        expect(vi.getTimerCount()).toBe(0);
    });
});
