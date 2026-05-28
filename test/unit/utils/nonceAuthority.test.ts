// test/unit/utils/nonceAuthority.test.ts
// Phase 21.2 Plan 01 (D-NONCE-AUTHORITY-ALL, Finding C): proves the per-wallet
// serialization mutex `withNonceLock(walletAddress, op)` actually serializes
// concurrent signing ops for the SAME wallet (no two op bodies ever overlap),
// keeps DIFFERENT wallets independent, survives a rejecting op without
// deadlocking the chain, passes through the op's return value, and keys
// case-insensitively. Serialization is proven by an OBSERVABLE shared in-flight
// counter (never a hollow `expect(true)`) so a no-op passthrough implementation
// fails Test 1.
import { describe, it, expect, afterEach } from 'vitest';
import { withNonceLock, _resetNonceChainsForTesting } from '../../../src/utils/nonceAuthority';

// A manually-resolvable promise so a test can hold op1 "in flight" while it
// enqueues op2, then release op1 on demand.
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// Yield to the microtask queue so enqueued .then() callbacks get a chance to run.
const tick = () => Promise.resolve();

const WALLET_A = '0x1111111111111111111111111111111111111111';
const WALLET_B = '0x2222222222222222222222222222222222222222';

describe('Phase 21.2 — withNonceLock per-wallet serialization mutex', () => {
    afterEach(() => {
        _resetNonceChainsForTesting();
    });

    it('Test 1 (serialization): same-wallet ops never run concurrently (in-flight counter stays <= 1)', async () => {
        let inFlight = 0;
        let maxObserved = 0;

        // op1 is held open via a deferred until we explicitly release it.
        const gate1 = deferred();
        const op1 = async () => {
            inFlight += 1;
            maxObserved = Math.max(maxObserved, inFlight);
            await gate1.promise; // hold the lock open
            inFlight -= 1;
            return 'op1';
        };

        let op2Started = false;
        const op2 = async () => {
            op2Started = true;
            inFlight += 1;
            maxObserved = Math.max(maxObserved, inFlight);
            inFlight -= 1;
            return 'op2';
        };

        const p1 = withNonceLock(WALLET_A, op1);
        const p2 = withNonceLock(WALLET_A, op2);

        // Let op1's body start. op2 must NOT have begun while op1 holds the lock.
        await tick();
        await tick();
        expect(inFlight).toBe(1); // op1 is in-flight
        expect(op2Started).toBe(false); // op2 blocked behind op1

        // Release op1; op2 may now run.
        gate1.resolve();
        const [r1, r2] = await Promise.all([p1, p2]);

        expect(r1).toBe('op1');
        expect(r2).toBe('op2');
        expect(op2Started).toBe(true);
        // The load-bearing assertion: the two bodies never overlapped.
        expect(maxObserved).toBe(1);
    });

    it('Test 2 (different wallets independent): ops for DIFFERENT addresses CAN overlap', async () => {
        let bothInFlight = false;

        const gateA = deferred();
        const gateB = deferred();
        let aStarted = false;
        let bStarted = false;

        const opA = async () => {
            aStarted = true;
            if (bStarted) bothInFlight = true; // B was already running when A entered
            await gateA.promise;
            return 'A';
        };
        const opB = async () => {
            bStarted = true;
            if (aStarted) bothInFlight = true; // A was already running when B entered
            await gateB.promise;
            return 'B';
        };

        const pA = withNonceLock(WALLET_A, opA);
        const pB = withNonceLock(WALLET_B, opB);

        // Both bodies should be able to start without either resolving — proving
        // the chains are per-address, not a single global queue.
        await tick();
        await tick();
        expect(aStarted).toBe(true);
        expect(bStarted).toBe(true);
        expect(bothInFlight).toBe(true);

        gateA.resolve();
        gateB.resolve();
        const [rA, rB] = await Promise.all([pA, pB]);
        expect(rA).toBe('A');
        expect(rB).toBe('B');
    });

    it('Test 3 (rejection does not deadlock): a rejecting op leaves the chain usable for the next op', async () => {
        const failing = async () => {
            throw new Error('boom');
        };
        // The caller still sees the real rejection.
        await expect(withNonceLock(WALLET_A, failing)).rejects.toThrow('boom');

        // A subsequent op on the SAME address must still run and resolve.
        let ranAfter = false;
        const after = async () => {
            ranAfter = true;
            return 'after';
        };
        await expect(withNonceLock(WALLET_A, after)).resolves.toBe('after');
        expect(ranAfter).toBe(true);
    });

    it('Test 4 (return value passthrough): resolves to the op return value', async () => {
        const obj = { nonce: 7, hash: '0xabc' };
        await expect(withNonceLock(WALLET_A, async () => obj)).resolves.toBe(obj);
        await expect(withNonceLock(WALLET_A, async () => 42)).resolves.toBe(42);
    });

    it('Test 5 (key normalization): same address in different letter-cases serializes together', async () => {
        const upper = WALLET_A.toUpperCase(); // 0X1111... vs 0x1111...
        let inFlight = 0;
        let maxObserved = 0;

        const gate1 = deferred();
        const op1 = async () => {
            inFlight += 1;
            maxObserved = Math.max(maxObserved, inFlight);
            await gate1.promise;
            inFlight -= 1;
            return 'lower';
        };
        let op2Started = false;
        const op2 = async () => {
            op2Started = true;
            inFlight += 1;
            maxObserved = Math.max(maxObserved, inFlight);
            inFlight -= 1;
            return 'upper';
        };

        const p1 = withNonceLock(WALLET_A, op1); // lowercase
        const p2 = withNonceLock(upper, op2); // UPPERCASE — must share the same chain

        await tick();
        await tick();
        expect(inFlight).toBe(1);
        expect(op2Started).toBe(false); // serialized despite differing case

        gate1.resolve();
        await Promise.all([p1, p2]);
        expect(maxObserved).toBe(1);
    });
});
