// test/realpath/triage/AUD-TX-001.test.ts
// Phase 23 plan 23-09 Task 2 (AUDIT-02, SPEC nonce constraint): RC-10 (a), re-entrancy.
// src/utils/nonceAuthority.ts withNonceLock is a per-wallet promise chain: it reads the wallet's
// tail, chains the new op after it (prior.catch(() => {}).then(op)) and stores the new tail. It
// records nothing about who holds the lock, so an op that takes the same wallet's lock again from
// inside its own body queues behind itself: the nested acquire waits for the outer op to settle,
// and the outer op waits for the nested acquire. Every later op for that wallet then queues behind
// the outer one. This shipped once already (CR-01, documented at src/exitEngine.ts, the worker's
// outer lock around executeFullSell); the fix then removed the outer lock, it did not detect
// nesting. No production path nests today (the finding's sibling check traced all 12 lock sites);
// the defect is the missing guard, which is what this file proves on the real module.
//
// Proof on the real lock: the graph's own withNonceLock (fixtures/AUD-TX-002-lock.ts; the same
// instance every buy and exit of the loaded graph uses). An outer op for the scenario wallet calls
// withNonceLock for the same wallet inside its body; a third op for the wallet is queued after it.
// Over a stated window of 30 minutes of fake time, expectStillPending watches the outer call and
// the third op together.
//
// What is measured: whether the outer call settled and the third op started within the window.
// Correct: the nested acquire is detected (it throws, so the outer call settles with that error,
// or the lock is re-entrant for its holder, so the nested op runs), and the third op then starts.
// Today: neither settles nor starts within the window. Both fix shapes on card OD-17 read "looks
// fixed" (D-08; a throw-on-nested-acquire mutation of src/utils/nonceAuthority.ts was run, src
// restored byte for byte). The result is a bounded observation over the window, never "forever".
//
// Control (same file): the same nested shape on two different wallets completes at once, and the
// third op starts: the lock is per wallet, and only a same-wallet nesting deadlocks.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Wallet, ethers } from 'ethers';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, expectStillPending, stepUntil } from '../harness/world';
import { graphWithNonceLock } from './fixtures/AUD-TX-002-lock';

const WINDOW_MS = 30 * 60_000;

interface Tracked<T> {
    promise: Promise<T>;
    settled(): boolean;
    outcome(): 'pending' | 'resolved' | 'rejected';
    error(): unknown;
}

function track<T>(promise: Promise<T>): Tracked<T> {
    let state: 'pending' | 'resolved' | 'rejected' = 'pending';
    let err: unknown;
    promise.then(
        () => (state = 'resolved'),
        (e: unknown) => {
            state = 'rejected';
            err = e;
        },
    );
    return { promise, settled: () => state !== 'pending', outcome: () => state, error: () => err };
}

describe('AUD-TX-001: withNonceLock has no owner tracking, so a nested same-wallet acquire never settles (RC-10 re-entrancy)', () => {
    it('nested-acquire-never-settles: a same-wallet acquire inside a withNonceLock op leaves the outer call unsettled and a later op for the wallet unstarted within a 30-minute fake-time window', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const withNonceLock = await graphWithNonceLock();
        const wallet = sc.wallet.address;
        let outerStarted = false;
        let nestedRan = false;
        let thirdStartedAt: number | null = null;
        const outer = track(
            withNonceLock(wallet, async () => {
                outerStarted = true;
                // The same wallet, spelled the way a checksummed caller spells it (keys are lowercased).
                await withNonceLock(ethers.getAddress(wallet), async () => {
                    nestedRan = true;
                    return 'nested';
                });
                return 'outer';
            }),
        );
        const third = track(
            withNonceLock(wallet.toLowerCase(), async () => {
                thirdStartedAt = Date.now();
                return 'third';
            }),
        );
        // Either settling ends the watch; expectStillPending throws only when one did.
        const either = Promise.race([outer.promise.then(() => undefined, () => undefined), third.promise.then(() => undefined, () => undefined)]);
        const start = Date.now();
        let settledInWindow = false;
        try {
            await expectStillPending(either, WINDOW_MS, { stepMs: 1_000, what: 'the outer call and the third op for the wallet' });
        } catch (e) {
            if (!outer.settled() && !third.settled()) throw e;
            settledInWindow = true;
        }
        // Let a settled outer call hand the lock on, so a fix shows the third op starting too.
        if (settledInWindow) await stepUntil(third.promise.then(() => undefined, () => undefined), { maxSteps: 100 });

        knownBug(ctx, 'AUD-TX-001', {
            claim: 'nested-acquire-never-settles',
            correct: { outerCallSettled: true, laterOperationStarted: true },
            observed: { outerCallSettled: false, laterOperationStarted: false },
            actual: { outerCallSettled: outer.settled(), laterOperationStarted: thirdStartedAt !== null },
            expectedPlain: 'A nested acquire of the same wallet lock is detected (it fails with an error, or the lock lets its holder in), so the outer operation finishes and the wallet\'s later operations run.',
            actualPlain: 'An operation that took the wallet lock again from inside itself waited on itself: over 30 minutes of fake time the outer operation never finished, the nested one never ran, and a later operation for the same wallet never started, with no error or log.',
        });

        expect(settledInWindow).toBe(false);
        expect(Date.now() - start).toBe(WINDOW_MS);
        expect(outerStarted).toBe(true);
        expect(nestedRan).toBe(false);
        expect(outer.outcome()).toBe('pending');
        expect(third.outcome()).toBe('pending');
        // Nothing reported it: no warning or error was logged and no alert was sent.
        expect(recordedLogs().filter((l) => l.level === 'warn' || l.level === 'error' || l.level === 'fatal')).toEqual([]);
        expect(recordedAlerts()).toEqual([]);
        await expectStillPending(outer.promise, 60_000, { what: 'the outer call holding the nested acquire, one more minute' });
        expect(thirdStartedAt).toBeNull();
    });

    it('control: the same nested shape on two different wallets completes at once and the later op for the first wallet starts', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const withNonceLock = await graphWithNonceLock();
        const wallet = sc.wallet.address;
        const other = new Wallet(ethers.id('realpath.plan-23-09.other-wallet')).address;
        let nestedRan = false;
        const outer = withNonceLock(wallet, async () => {
            await withNonceLock(other, async () => {
                nestedRan = true;
            });
            return 'outer';
        });
        const third = withNonceLock(wallet, async () => 'third');
        expect(await stepUntil(outer, { maxSteps: 10 })).toBe('outer');
        expect(await stepUntil(third, { maxSteps: 10 })).toBe('third');
        expect(nestedRan).toBe(true);
    });
});
