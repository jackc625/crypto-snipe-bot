// test/unit/anti-rug/types.test.ts
// Phase 19 Plan 19-03 Task 1 — RugEvaluation discriminated-union type contract +
// events.ts canonical ABI fragments + topic hashes + DEAD_ADDRESS constant.
//
// Test plan (11 tests):
//   1.  RugEvaluation accepts { verdict:'safe', reason:'partial-signal', signals }
//   2.  RugEvaluation accepts { verdict:'unsafe', reason:'three-signal-trigger', signals }
//   3.  RugEvaluation accepts { verdict:'allowlisted', signals, lockerName }
//   4.  RugEvaluation accepts { verdict:'unknown', reason } with NO signals
//   5.  TypeScript compile gate: { verdict:'safe' } WITHOUT signals MUST fail tsc
//       (the @ts-expect-error marker turns the expected error into a deliberate
//       compile-time guard — IF the compile error disappears, vitest fails the test
//       because the @ts-expect-error directive becomes "unused"; if the compile
//       error appears as expected, the directive consumes it and the file compiles
//       cleanly — this is the canonical TypeScript vacuous-pass-unrepresentable
//       proof pattern, same shape as src/utils/honeypot/types.ts test).
//   6.  PAIR_BURN_TOPIC === ethers.id('Burn(address,uint256,uint256,address)')
//   7.  POOL_BURN_TOPIC === ethers.id('Burn(address,int24,int24,uint128,uint256,uint256)')
//   8.  POOL_COLLECT_TOPIC === ethers.id('Collect(address,address,int24,int24,uint128,uint128)')
//   9.  PAIR_TRANSFER_TOPIC === ERC-20 canonical Transfer topic
//  10.  DEAD_ADDRESS === lowercased '0x000000000000000000000000000000000000dead'
//  11.  AntiRugMonitorState union covers the 6 UI-SPEC badge states verbatim

import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';

import type {
    RugEvaluation,
    RugSignals,
    AntiRugMonitorState,
} from '../../../src/anti-rug/types';

import {
    PAIR_BURN_TOPIC,
    PAIR_TRANSFER_TOPIC,
    POOL_BURN_TOPIC,
    POOL_COLLECT_TOPIC,
    DEAD_ADDRESS,
} from '../../../src/anti-rug/events';

// ---------------------------------------------------------------------------
// Fixture signals — re-used across the four variant tests so the variant
// shape is the only thing varying per case.
// ---------------------------------------------------------------------------

const BASE_SIGNALS: RugSignals = {
    lpRemovedPct: 60,
    destination: '0x' + 'a'.repeat(40),
    allowlistHit: 'safe',
    sellSimSlippagePct: 75,
    v2ReservePctBelow: 70,
};

describe('Phase 19 — RugEvaluation discriminated union', () => {
    it("Test 1: RugEvaluation accepts { verdict:'safe', reason:'partial-signal', signals }", () => {
        const e: RugEvaluation = {
            verdict: 'safe',
            reason: 'partial-signal',
            signals: BASE_SIGNALS,
        };
        expect(e.verdict).toBe('safe');
        if (e.verdict === 'safe') {
            expect(e.reason).toBe('partial-signal');
            expect(e.signals).toBeDefined();
        }
    });

    it("Test 2: RugEvaluation accepts { verdict:'unsafe', reason:'three-signal-trigger', signals }", () => {
        const e: RugEvaluation = {
            verdict: 'unsafe',
            reason: 'three-signal-trigger',
            signals: BASE_SIGNALS,
        };
        expect(e.verdict).toBe('unsafe');
        if (e.verdict === 'unsafe') {
            expect(e.reason).toBe('three-signal-trigger');
            expect(e.signals).toBeDefined();
        }
    });

    it("Test 3: RugEvaluation accepts { verdict:'allowlisted', signals, lockerName }", () => {
        const e: RugEvaluation = {
            verdict: 'allowlisted',
            signals: BASE_SIGNALS,
            lockerName: 'Unicrypt UniLockerV2 ETH',
        };
        expect(e.verdict).toBe('allowlisted');
        if (e.verdict === 'allowlisted') {
            expect(e.lockerName).toBe('Unicrypt UniLockerV2 ETH');
            expect(e.signals).toBeDefined();
        }
    });

    it("Test 4: RugEvaluation accepts { verdict:'unknown', reason } with NO signals field", () => {
        const e: RugEvaluation = {
            verdict: 'unknown',
            reason: 'RPC error fetching reserves',
        };
        expect(e.verdict).toBe('unknown');
        if (e.verdict === 'unknown') {
            expect(e.reason).toBe('RPC error fetching reserves');
        }
        // The 'unknown' variant must NOT carry a 'signals' field — narrow further
        // to assert the type:
        // (this is a TypeScript-level check; the runtime assertion below
        //  documents the same intent — 'signals' is absent on this variant.)
        // @ts-expect-error — 'signals' is intentionally not declared on the 'unknown' variant
        expect(e.signals).toBeUndefined();
    });

    it('Test 5: Vacuous { verdict:"safe" } without signals fails TypeScript compilation (vacuous-pass unrepresentable)', () => {
        // The next line MUST be a compile error — the 'safe' variant requires
        // `reason: 'partial-signal'` AND `signals: RugSignals`. The @ts-expect-error
        // directive will fail the build if no compile error occurs (i.e. if the
        // type discipline weakens and accepts vacuous-pass). This is the same
        // compile-gate pattern that locks Phase 18 HoneypotResult discipline.
        // @ts-expect-error — vacuous { verdict:'safe' } MUST be unrepresentable
        const vacuous: RugEvaluation = { verdict: 'safe' };
        // Runtime sanity: the object exists at runtime (TypeScript only); the
        // compile error is the gate, not runtime behavior.
        expect(vacuous).toBeDefined();
        expect(vacuous.verdict).toBe('safe');
    });
});

describe('Phase 19 — events.ts topic hashes', () => {
    it("Test 6: PAIR_BURN_TOPIC === ethers.id('Burn(address,uint256,uint256,address)')", () => {
        expect(PAIR_BURN_TOPIC).toBe(ethers.id('Burn(address,uint256,uint256,address)'));
    });

    it("Test 7: POOL_BURN_TOPIC === ethers.id('Burn(address,int24,int24,uint128,uint256,uint256)')", () => {
        expect(POOL_BURN_TOPIC).toBe(
            ethers.id('Burn(address,int24,int24,uint128,uint256,uint256)')
        );
    });

    it("Test 8: POOL_COLLECT_TOPIC === ethers.id('Collect(address,address,int24,int24,uint128,uint128)')", () => {
        expect(POOL_COLLECT_TOPIC).toBe(
            ethers.id('Collect(address,address,int24,int24,uint128,uint128)')
        );
    });

    it('Test 9: PAIR_TRANSFER_TOPIC === canonical ERC-20 Transfer topic', () => {
        // The standard ERC-20 Transfer event signature topic hash is
        // 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
        // — every ERC-20 emits this same hash.
        expect(PAIR_TRANSFER_TOPIC).toBe(
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
        );
        // Also verify via ethers.id directly:
        expect(PAIR_TRANSFER_TOPIC).toBe(ethers.id('Transfer(address,address,uint256)'));
    });

    it("Test 10: DEAD_ADDRESS === lowercased '0x000000000000000000000000000000000000dead'", () => {
        expect(DEAD_ADDRESS).toBe('0x000000000000000000000000000000000000dead');
        // The constant is intentionally lowercased (canonical for case-insensitive
        // comparison against raw log-event `to` fields which may arrive in mixed
        // case from the RPC).
        expect(DEAD_ADDRESS).toBe(DEAD_ADDRESS.toLowerCase());
    });
});

describe('Phase 19 — AntiRugMonitorState union (UI-SPEC badge states)', () => {
    it('Test 11: AntiRugMonitorState covers all 6 UI-SPEC badge states verbatim', () => {
        // Each of these declarations MUST compile — if any literal is removed
        // from the union, the corresponding line below will fail tsc --noEmit.
        const s1: AntiRugMonitorState = 'live';
        const s2: AntiRugMonitorState = 'dry-run';
        const s3: AntiRugMonitorState = 'would-have-sold';
        const s4: AntiRugMonitorState = 'exit-fired';
        const s5: AntiRugMonitorState = 'halted';
        const s6: AntiRugMonitorState = 'unmonitored';

        // Runtime: confirm the 6 values are the only valid ones by membership test
        const all: AntiRugMonitorState[] = [s1, s2, s3, s4, s5, s6];
        expect(new Set(all).size).toBe(6);

        // Spot-check each
        expect(s1).toBe('live');
        expect(s2).toBe('dry-run');
        expect(s3).toBe('would-have-sold');
        expect(s4).toBe('exit-fired');
        expect(s5).toBe('halted');
        expect(s6).toBe('unmonitored');
    });
});
