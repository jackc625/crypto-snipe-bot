// test/unit/exitEngine.test.ts
// Unit tests for exit engine pure functions (TEST-04 partial).
// All .todo stubs from Phase 7 replaced with real test implementations.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    createMockExitState,
    createMockTiers,
    priceSequences,
    createMockExitStateRow,
} from '../fixtures/exitEngine.fixtures';

// ---- Mock dependencies that exitEngine.ts imports at top level ----

vi.mock('../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: vi.fn() },
    updateTradeStatus: { run: vi.fn() },
    upsertExitState: { run: vi.fn() },
    getExitState: { get: vi.fn() },
    deleteExitState: { run: vi.fn() },
    getTradeIdForPendingToken: { get: vi.fn() },
}));

vi.mock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
        }),
    },
}));

vi.mock('../../src/config', () => ({
    CONFIG: {
        trailingStopPct: 15,
        trailingMinPct: 5,
        trailingMaxPct: 40,
        stopLossPercent: 25,
        partialSellTargets: '2x:50,5x:25',
        exitPollIntervalMs: 5000,
        urgencyWindowMs: 30 * 60 * 1000,
        volatilityBaselineCV: 0.03,
        volatilityMaxSamples: 60,
        volatilityMinSamples: 12,
    },
}));

vi.mock('../../src/utils/exitManager', () => ({
    tryAcquireSellLock: vi.fn(),
    releaseSellLock: vi.fn(),
    registerExitMonitor: vi.fn(),
    clearAllTimersForToken: vi.fn(),
}));

vi.mock('../../src/utils/notifier', () => ({
    sendCtxAlert: vi.fn(),
}));

vi.mock('../../src/utils/txManager', () => ({
    sendTxWithRetry: vi.fn(),
}));

// Import after mocks
let parsePartialSellTargets: typeof import('../../src/exitEngine')['parsePartialSellTargets'];
let computeUrgencyMultiplier: typeof import('../../src/exitEngine')['computeUrgencyMultiplier'];
let computeEffectiveTrailingPct: typeof import('../../src/exitEngine')['computeEffectiveTrailingPct'];
let getUnfilledTiers: typeof import('../../src/exitEngine')['getUnfilledTiers'];
let calculatePartialSellAmount: typeof import('../../src/exitEngine')['calculatePartialSellAmount'];
let VolatilityTracker: typeof import('../../src/exitEngine')['VolatilityTracker'];
let serializeExitState: typeof import('../../src/exitEngine')['serializeExitState'];
let deserializeExitState: typeof import('../../src/exitEngine')['deserializeExitState'];

beforeEach(async () => {
    const mod = await import('../../src/exitEngine');
    parsePartialSellTargets = mod.parsePartialSellTargets;
    computeUrgencyMultiplier = mod.computeUrgencyMultiplier;
    computeEffectiveTrailingPct = mod.computeEffectiveTrailingPct;
    getUnfilledTiers = mod.getUnfilledTiers;
    calculatePartialSellAmount = mod.calculatePartialSellAmount;
    VolatilityTracker = mod.VolatilityTracker;
    serializeExitState = mod.serializeExitState;
    deserializeExitState = mod.deserializeExitState;
});

// ============================================================
// parsePartialSellTargets
// ============================================================
describe('parsePartialSellTargets', () => {
    it('parses "2x:50,5x:25" into sorted PartialTier array', () => {
        const result = parsePartialSellTargets('2x:50,5x:25');
        expect(result).toEqual([
            { multiple: 2, percent: 50 },
            { multiple: 5, percent: 25 },
        ]);
    });

    it('returns empty array for empty string', () => {
        expect(parsePartialSellTargets('')).toEqual([]);
    });

    it('returns empty array for undefined', () => {
        expect(parsePartialSellTargets(undefined)).toEqual([]);
    });

    it('throws on total percentage >= 100%', () => {
        expect(() => parsePartialSellTargets('2x:60,5x:50')).toThrow(/must be < 100%/);
    });

    it('sorts tiers by multiple ascending', () => {
        const result = parsePartialSellTargets('5x:25,2x:50');
        expect(result[0].multiple).toBe(2);
        expect(result[1].multiple).toBe(5);
    });
});

// ============================================================
// computeUrgencyMultiplier
// ============================================================
describe('computeUrgencyMultiplier', () => {
    const windowMs = 30 * 60 * 1000; // 30 minutes

    it('returns 1.0 at t=0 (urgencyStartTs === nowMs)', () => {
        const result = computeUrgencyMultiplier(1000, 1000, windowMs);
        expect(result).toBe(1.0);
    });

    it('returns ~0.5 at half the urgency window', () => {
        const result = computeUrgencyMultiplier(1000, 1000 + windowMs / 2, windowMs);
        expect(result).toBeCloseTo(0.5, 2);
    });

    it('returns 0.0 at the urgency window end', () => {
        const result = computeUrgencyMultiplier(1000, 1000 + windowMs, windowMs);
        expect(result).toBe(0.0);
    });

    it('returns 0.0 past the urgency window', () => {
        const result = computeUrgencyMultiplier(1000, 1000 + windowMs * 2, windowMs);
        expect(result).toBe(0.0);
    });

    it('returns 1.0 when nowMs is before urgencyStartTs', () => {
        const result = computeUrgencyMultiplier(2000, 1000, windowMs);
        expect(result).toBe(1.0);
    });
});

// ============================================================
// computeEffectiveTrailingPct
// ============================================================
describe('computeEffectiveTrailingPct', () => {
    it('returns base pct when vol=1.0 and urgency=1.0', () => {
        const result = computeEffectiveTrailingPct(15, 1.0, 1.0, 5, 40);
        expect(result).toBe(15);
    });

    it('widens trailing stop with high volatility multiplier', () => {
        const result = computeEffectiveTrailingPct(15, 2.0, 1.0, 5, 40);
        expect(result).toBe(30); // 15 * 2.0 * 1.0 = 30
    });

    it('tightens trailing stop with low urgency multiplier', () => {
        const result = computeEffectiveTrailingPct(15, 1.0, 0.5, 5, 40);
        expect(result).toBe(7.5); // 15 * 1.0 * 0.5 = 7.5
    });

    it('clamps to min pct', () => {
        const result = computeEffectiveTrailingPct(15, 1.0, 0.1, 5, 40);
        expect(result).toBe(5); // 15 * 0.1 = 1.5, clamped to min 5
    });

    it('clamps to max pct', () => {
        const result = computeEffectiveTrailingPct(15, 3.0, 1.0, 5, 40);
        expect(result).toBe(40); // 15 * 3.0 = 45, clamped to max 40
    });
});

// ============================================================
// getUnfilledTiers
// ============================================================
describe('getUnfilledTiers', () => {
    const tiers = createMockTiers(); // [{multiple:2,percent:50},{multiple:5,percent:25}]

    it('returns tiers reached by currentMultiple but not in completedIndices', () => {
        const result = getUnfilledTiers(tiers, new Set(), 3.0);
        expect(result).toHaveLength(1);
        expect(result[0].tier.multiple).toBe(2.0);
        expect(result[0].index).toBe(0);
    });

    it('returns empty when all tiers completed', () => {
        const result = getUnfilledTiers(tiers, new Set([0, 1]), 6.0);
        expect(result).toHaveLength(0);
    });

    it('returns all missed tiers on price gap (currentMultiple=6, both 2x and 5x)', () => {
        const result = getUnfilledTiers(tiers, new Set(), 6.0);
        expect(result).toHaveLength(2);
        expect(result[0].tier.multiple).toBe(2.0);
        expect(result[1].tier.multiple).toBe(5.0);
    });

    it('excludes already-completed tiers', () => {
        const result = getUnfilledTiers(tiers, new Set([0]), 6.0);
        expect(result).toHaveLength(1);
        expect(result[0].tier.multiple).toBe(5.0);
    });

    it('returns empty when price below all tiers', () => {
        const result = getUnfilledTiers(tiers, new Set(), 1.5);
        expect(result).toHaveLength(0);
    });
});

// ============================================================
// calculatePartialSellAmount
// ============================================================
describe('calculatePartialSellAmount', () => {
    it('calculates amount from original buy amount using BigInt math', () => {
        const original = 1000000000000000000n; // 1e18
        const tiers = [{ tier: { multiple: 2, percent: 50 }, index: 0 }];
        const result = calculatePartialSellAmount(original, tiers);
        expect(result).toBe(500000000000000000n); // 50% of 1e18
    });

    it('combines percentages for multi-tier gap sell', () => {
        const original = 1000000000000000000n; // 1e18
        const tiers = [
            { tier: { multiple: 2, percent: 50 }, index: 0 },
            { tier: { multiple: 5, percent: 25 }, index: 1 },
        ];
        const result = calculatePartialSellAmount(original, tiers);
        expect(result).toBe(750000000000000000n); // 75% of 1e18
    });

    it('returns 0n for empty tiers array', () => {
        const original = 1000000000000000000n;
        const result = calculatePartialSellAmount(original, []);
        expect(result).toBe(0n);
    });
});

// ============================================================
// VolatilityTracker
// ============================================================
describe('VolatilityTracker', () => {
    it('returns multiplier 1.0 with insufficient samples', () => {
        const tracker = new VolatilityTracker(60, 12, 0.03);
        for (let i = 0; i < 5; i++) tracker.addSample(1000);
        expect(tracker.getMultiplier()).toBe(1.0);
    });

    it('returns > 1.0 for high volatility price sequence', () => {
        const tracker = new VolatilityTracker(60, 5, 0.03);
        for (const price of priceSequences.highVolatility) {
            tracker.addSample(price);
        }
        // High volatility should produce multiplier > 1.0
        expect(tracker.getMultiplier()).toBeGreaterThan(1.0);
    });

    it('returns ~1.0 for low volatility price sequence', () => {
        const tracker = new VolatilityTracker(60, 5, 0.03);
        for (const price of priceSequences.lowVolatility) {
            tracker.addSample(price);
        }
        const mult = tracker.getMultiplier();
        // Low volatility should be close to 1.0
        expect(mult).toBeGreaterThanOrEqual(1.0);
        expect(mult).toBeLessThan(1.5);
    });

    it('respects maxSamples circular buffer limit', () => {
        const maxSamples = 5;
        const tracker = new VolatilityTracker(maxSamples, 3, 0.03);
        for (let i = 0; i < 10; i++) {
            tracker.addSample(1000 + i);
        }
        // After 10 samples with max 5, only last 5 should be kept
        const serialized = JSON.parse(tracker.toJSON());
        expect(serialized).toHaveLength(maxSamples);
    });

    it('serializes to JSON and deserializes correctly', () => {
        const tracker = new VolatilityTracker(60, 5, 0.03);
        for (const price of priceSequences.highVolatility) {
            tracker.addSample(price);
        }
        const json = tracker.toJSON();
        const restored = VolatilityTracker.fromJSON(json, 60, 5, 0.03);
        expect(restored.getMultiplier()).toBe(tracker.getMultiplier());
    });
});

// ============================================================
// serializeExitState / deserializeExitState
// ============================================================
describe('State persistence', () => {
    it('round-trips ExitStateData through serialize/deserialize', () => {
        const tracker = new VolatilityTracker(60, 5, 0.03);
        for (const price of [1000, 1200, 1100]) {
            tracker.addSample(price);
        }

        const state = {
            tradeId: 42,
            entryPrice: 1000,
            highWaterMark: 2500,
            trailingActivated: true,
            completedTierIndices: new Set([0]),
            originalTokenAmount: 1000000000000000000n,
            urgencyStartTs: Date.now() - 10 * 60 * 1000,
            volatilityTracker: tracker,
        };

        const serialized = serializeExitState(state);
        expect(serialized.tradeId).toBe(42);
        expect(serialized.trailingActivated).toBe(1);
        expect(serialized.partialTiersCompleted).toBe('[0]');
        expect(serialized.originalTokenAmount).toBe('1000000000000000000');

        // Deserialize as if from DB
        const row = {
            trade_id: serialized.tradeId,
            entry_price: serialized.entryPrice,
            high_water_mark: serialized.highWaterMark,
            trailing_activated: serialized.trailingActivated,
            partial_tiers_completed: serialized.partialTiersCompleted,
            original_token_amount: serialized.originalTokenAmount,
            urgency_start_ts: serialized.urgencyStartTs,
            volatility_samples: serialized.volatilitySamples,
        };

        const deserialized = deserializeExitState(row);
        expect(deserialized.tradeId).toBe(42);
        expect(deserialized.entryPrice).toBe(1000);
        expect(deserialized.highWaterMark).toBe(2500);
        expect(deserialized.trailingActivated).toBe(true);
        expect(deserialized.completedTierIndices.has(0)).toBe(true);
        expect(deserialized.completedTierIndices.size).toBe(1);
        expect(deserialized.originalTokenAmount).toBe(1000000000000000000n);
    });

    it('handles empty completedTierIndices', () => {
        const row = createMockExitStateRow();
        row.partial_tiers_completed = '[]';
        const deserialized = deserializeExitState(row);
        expect(deserialized.completedTierIndices.size).toBe(0);
    });

    it('preserves BigInt originalTokenAmount', () => {
        const row = createMockExitStateRow();
        const deserialized = deserializeExitState(row);
        expect(typeof deserialized.originalTokenAmount).toBe('bigint');
        expect(deserialized.originalTokenAmount).toBe(1000000000000000000n);
    });

    it('handles corrupt JSON gracefully in partial_tiers_completed', () => {
        const row = createMockExitStateRow();
        row.partial_tiers_completed = 'not-json';
        const deserialized = deserializeExitState(row);
        expect(deserialized.completedTierIndices.size).toBe(0);
    });
});

// ============================================================
// Fixture smoke test
// ============================================================
describe('Fixtures', () => {
    it('fixture factories produce valid objects', () => {
        const state = createMockExitState();
        expect(state.tradeId).toBe(1);
        expect(state.entryPrice).toBe(1000);

        const tiers = createMockTiers();
        expect(tiers).toHaveLength(2);
        expect(tiers[0].multiple).toBe(2.0);

        const row = createMockExitStateRow();
        expect(row.trade_id).toBe(1);

        expect(priceSequences.trailingStopTrigger).toHaveLength(8);
    });
});
