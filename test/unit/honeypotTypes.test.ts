// test/unit/honeypotTypes.test.ts
// HONEY-06 compile-gate tests for `src/utils/honeypot/types.ts`.
//
// The discriminated-union `HoneypotResult` must make a vacuous-pass
// literal `{ verdict: 'safe', evidence: {} }` fail `tsc --noEmit`.
//
// These tests have NO runtime assertions. The test PASSING means:
//   1. `tsc --noEmit` passed, AND
//   2. each `// @ts-expect-error` directive matched a real type error.
//
// If a positive case (no `@ts-expect-error`) stops compiling, OR a
// negative case (with `@ts-expect-error`) starts compiling cleanly,
// `tsc` will fail and this test file will fail to load.

import { describe, it, expect } from 'vitest';
import type { HoneypotResult } from '../../src/utils/honeypot/types';

describe('HONEY-06: HoneypotResult discriminated union (compile-gate)', () => {
    it('Test 1: literal { verdict: \'safe\', evidence: {} } fails tsc --noEmit', () => {
        // @ts-expect-error — vacuous-pass: empty evidence does not satisfy `safe` variant
        const bad: HoneypotResult = { verdict: 'safe', evidence: {} };
        // Touch the var so the linter doesn't strip it before tsc sees the directive.
        expect(bad.verdict).toBe('safe');
    });

    it('Test 2: literal { verdict: \'safe\', evidence: { method: ... } } (missing tax fields) fails tsc --noEmit', () => {
        // @ts-expect-error — `safe` variant requires buyTaxBps + sellTaxBps as `number` (not optional)
        const bad: HoneypotResult = {
            verdict: 'safe',
            evidence: { method: 'on-chain-contract' },
        };
        expect(bad.verdict).toBe('safe');
    });

    it('Test 3: literal { verdict: \'safe\', evidence: { buyTaxBps, sellTaxBps, method } } compiles cleanly', () => {
        // No @ts-expect-error: this MUST compile. If it stops compiling, the
        // `safe` variant got over-tightened.
        const good: HoneypotResult = {
            verdict: 'safe',
            evidence: { buyTaxBps: 100, sellTaxBps: 100, method: 'on-chain-contract' },
        };
        expect(good.verdict).toBe('safe');
    });

    it('Test 4: literal { verdict: \'unsafe\', evidence: { method: ... } } (missing reason) fails tsc --noEmit', () => {
        // @ts-expect-error — `unsafe` variant requires `reason: string`
        const bad: HoneypotResult = {
            verdict: 'unsafe',
            evidence: { method: 'on-chain-contract' },
        };
        expect(bad.verdict).toBe('unsafe');
    });

    it('Test 5: narrowing on verdict === \'safe\' exposes buyTaxBps as `number` (not undefined)', () => {
        function asTaxNumber(r: HoneypotResult): number {
            if (r.verdict === 'safe') {
                // If narrowing failed, `r.evidence.buyTaxBps` would be `number | undefined`
                // and TS would require a `?? 0` fallback. The fact that this assignment
                // compiles WITHOUT a fallback proves narrowing tightened the type.
                const tax: number = r.evidence.buyTaxBps;
                return tax;
            }
            return 0;
        }
        // Runtime sanity — but the real assertion is at compile time.
        expect(typeof asTaxNumber).toBe('function');
    });
});
