// test/unit/bot/twoStageSigint.test.ts
// Phase 21.2 Plan 21.2-09 / Task 1 — Finding B layer 2 (STOP-THE-LINE-04-B,
// D-SIGINT-TWO-STAGE + T-21.2-WEDGE / T-21.2-DOUBLE-TIMER).
//
// The OLD single-stage `gracefulShutdown` (bot.ts) armed a single 5s `.unref()`
// force-exit timer and then ran cleanup + `process.exit(0)` inline. On a PARKED
// event loop (the Finding B symptom: a synchronous `bundle.wait()` await chain),
// that handler is QUEUED but never runs, and its 5s timer competes with the same
// parked loop — so "Ctrl+C does nothing" until `taskkill`. RESEARCH Candidate
// Escalation #3 mandates REPLACING it with a two-stage handler, NOT augmenting
// it (two competing force-exit timers is the very symptom).
//
// These are OBSERVABLE-EFFECT tests (no hollow assertions) over the exported
// pure state machine `createTwoStageShutdown` (the cleanup body is injected so
// the test never boots the bot or touches real providers/DB):
//
//   Test 1 (first signal graceful): first SIGINT → graceful path begins
//     (shuttingDown set, the injected cleanup runs once), and a force-exit timer
//     is ARMED over SIGINT_GRACE_MS. process.exit is NOT forced on the first
//     signal — the armed grace timer / a second signal owns the force-exit.
//   Test 2 (second signal forces exit): a SECOND SIGINT while shuttingDown →
//     process.exit(130) immediately (cleanup is NOT re-run).
//   Test 3 (grace timeout forces exit): advancing fake timers past
//     SIGINT_GRACE_MS with no clean completion → process.exit(1) by the armed
//     `.unref()`'d grace timer.
//   Test 4 (single force-exit path): exactly ONE force-exit timer is armed per
//     shutdown (the old 5s timer is gone — no two competing timers); a static
//     source grep proves `gracefulShutdown` and the "Force exit after 5s timeout"
//     string no longer exist in bot.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTwoStageShutdown } from '../../../src/bot';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.useFakeTimers();
    log.info.mockClear();
    log.warn.mockClear();
    log.error.mockClear();
    // Mock process.exit so the handler never actually kills the test runner.
    exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation(((_code?: number) => undefined) as unknown as typeof process.exit);
});

afterEach(() => {
    vi.useRealTimers();
    exitSpy.mockRestore();
});

describe('Two-stage SIGINT — first signal is graceful (Test 1)', () => {
    it('begins graceful shutdown, runs cleanup once, and arms a grace timer (no immediate force-exit)', () => {
        const cleanup = vi.fn();
        const sd = createTwoStageShutdown({ log: log as never, graceMs: 8000, cleanup });

        sd.stage('SIGINT');

        // Graceful path began: cleanup invoked exactly once.
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(sd.isShuttingDown()).toBe(true);

        // A force-exit grace timer is armed (exactly one pending timer).
        expect(vi.getTimerCount()).toBe(1);

        // The FIRST signal does not force an exit code 130 / 1 — the grace timer
        // (or a second signal) owns the force-exit. (A clean cleanup would call
        // process.exit(0) itself; the injected no-op cleanup does not, so no exit
        // has fired yet.)
        expect(exitSpy).not.toHaveBeenCalled();
    });
});

describe('Two-stage SIGINT — second signal forces immediate exit (Test 2)', () => {
    it('a second signal while shutting down calls process.exit(130) and does not re-run cleanup', () => {
        const cleanup = vi.fn();
        const sd = createTwoStageShutdown({ log: log as never, graceMs: 8000, cleanup });

        sd.stage('SIGINT');
        expect(cleanup).toHaveBeenCalledTimes(1);
        exitSpy.mockClear();

        // Second signal: hard stop, no waiting.
        sd.stage('SIGINT');
        expect(exitSpy).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(130);
        // Cleanup must NOT run a second time.
        expect(cleanup).toHaveBeenCalledTimes(1);
    });
});

describe('Two-stage SIGINT — grace timeout forces exit (Test 3)', () => {
    it('advancing past SIGINT_GRACE_MS with no clean completion fires the armed force-exit timer', () => {
        const graceMs = 8000;
        // A cleanup that never completes (mirrors a parked loop): the armed
        // `.unref()`'d grace timer is the only thing that can force the exit.
        const cleanup = vi.fn();
        const sd = createTwoStageShutdown({ log: log as never, graceMs, cleanup });

        sd.stage('SIGTERM');
        expect(exitSpy).not.toHaveBeenCalled();

        // Just before the deadline: still not forced.
        vi.advanceTimersByTime(graceMs - 1);
        expect(exitSpy).not.toHaveBeenCalled();

        // At the deadline: the armed grace timer forces process.exit(1).
        vi.advanceTimersByTime(1);
        expect(exitSpy).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});

describe('Two-stage SIGINT — single force-exit path (Test 4)', () => {
    it('arms exactly ONE force-exit timer per shutdown (no two competing timers)', () => {
        const cleanup = vi.fn();
        const sd = createTwoStageShutdown({ log: log as never, graceMs: 8000, cleanup });

        sd.stage('SIGINT');
        // Exactly one pending timer (the single grace force-exit).
        expect(vi.getTimerCount()).toBe(1);

        // A second signal must NOT arm another timer — it force-exits immediately.
        sd.stage('SIGINT');
        expect(vi.getTimerCount()).toBe(1);
    });

    it('bot.ts no longer contains the old single-stage gracefulShutdown / 5s force-exit timer', () => {
        const src = readFileSync(resolve(__dirname, '../../../src/bot.ts'), 'utf8');
        // The old handler and its hardcoded 5s force-exit message are gone.
        expect(src).not.toContain('function gracefulShutdown');
        expect(src).not.toContain('Force exit after 5s timeout');
        // The two-stage path is present and reads the grace knob.
        expect(src).toContain('SIGINT_GRACE_MS');
        expect(src).toContain('createTwoStageShutdown');
        // Both signals route through the two-stage handler.
        expect(src).toContain("process.on('SIGINT'");
        expect(src).toContain("process.on('SIGTERM'");
    });
});
