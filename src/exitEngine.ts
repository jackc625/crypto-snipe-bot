// src/exitEngine.ts
// Unified exit engine for smart position management (Phase 7).
// Handles trailing stops, partial sells, volatility adaptation, and time-weighted urgency.

import { CONFIG } from './config';
import { logger } from './utils/logger';

const log = logger.child({ module: 'exitEngine' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PartialTier {
    multiple: number;  // e.g., 2.0 for "2x"
    percent: number;   // e.g., 50 for "50%"
}

export interface ExitConfig {
    trailingStopPct: number;
    trailingMinPct: number;
    trailingMaxPct: number;
    stopLossPct: number;
    partialSellTiers: PartialTier[];
    pollIntervalMs: number;
    urgencyWindowMs: number;
    volatilityBaselineCV: number;
    volatilityMaxSamples: number;
    volatilityMinSamples: number;
}

export interface ExitStateData {
    tradeId: number;
    entryPrice: number;
    highWaterMark: number;
    trailingActivated: boolean;
    completedTierIndices: Set<number>;
    originalTokenAmount: bigint;
    urgencyStartTs: number;
    volatilityTracker: VolatilityTracker;
}

// DB row shape for exit_state table
export interface ExitStateRow {
    trade_id: number;
    entry_price: number;
    high_water_mark: number;
    trailing_activated: number;  // 0 or 1
    partial_tiers_completed: string;  // JSON array of completed tier indices
    original_token_amount: string;    // BigInt as string
    urgency_start_ts: number;
    volatility_samples: string;       // JSON array of price samples
}

// ---------------------------------------------------------------------------
// Config Parsing
// ---------------------------------------------------------------------------

/**
 * Parse PARTIAL_SELL_TARGETS env var string like "2x:50,5x:25" into PartialTier[].
 * Returns empty array if empty/undefined. Throws on invalid format or total >= 100%.
 * Per D-06: Parsed at startup.
 */
export function parsePartialSellTargets(envVal: string | undefined): PartialTier[] {
    if (!envVal || envVal.trim() === '') return [];

    const tiers = envVal.split(',').map(entry => {
        const [multStr, pctStr] = entry.trim().split(':');
        const multiple = parseFloat(multStr.replace('x', ''));
        const percent = parseInt(pctStr, 10);
        if (isNaN(multiple) || isNaN(percent) || multiple <= 0 || percent <= 0) {
            throw new Error(`Invalid PARTIAL_SELL_TARGETS entry: "${entry}"`);
        }
        return { multiple, percent };
    });

    // Validate: total percentage < 100 (Pitfall 7 from research)
    const totalPct = tiers.reduce((sum, t) => sum + t.percent, 0);
    if (totalPct >= 100) {
        throw new Error(`PARTIAL_SELL_TARGETS total percentage (${totalPct}%) must be < 100%`);
    }

    // Sort by multiple ascending for deterministic evaluation (D-08: gap sell)
    return tiers.sort((a, b) => a.multiple - b.multiple);
}

/**
 * Build ExitConfig from CONFIG values. Called once at module load.
 */
export function buildExitConfig(): ExitConfig {
    const tiers = parsePartialSellTargets(CONFIG.partialSellTargets);
    if (tiers.length > 0) {
        log.info({ tiers }, 'Partial sell targets configured');
    }

    return {
        trailingStopPct: CONFIG.trailingStopPct,
        trailingMinPct: CONFIG.trailingMinPct,
        trailingMaxPct: CONFIG.trailingMaxPct,
        stopLossPct: CONFIG.stopLossPercent,
        partialSellTiers: tiers,
        pollIntervalMs: CONFIG.exitPollIntervalMs,
        urgencyWindowMs: CONFIG.urgencyWindowMs,
        volatilityBaselineCV: CONFIG.volatilityBaselineCV,
        volatilityMaxSamples: CONFIG.volatilityMaxSamples,
        volatilityMinSamples: CONFIG.volatilityMinSamples,
    };
}

export const exitConfig = buildExitConfig();

// ---------------------------------------------------------------------------
// VolatilityTracker (D-12, D-13, D-14, D-15)
// ---------------------------------------------------------------------------

/**
 * Tracks price samples in a circular buffer and computes a volatility multiplier
 * based on coefficient of variation (CV = stddev / mean).
 * CV is dimensionless and normalizes across price ranges.
 * Per D-13: multiplier widens trailing stop percentage.
 * Per D-14: caller clamps result to min/max range.
 * Per D-15: recalculated every poll cycle.
 */
export class VolatilityTracker {
    private samples: number[] = [];
    private readonly maxSamples: number;
    private readonly minSamples: number;
    private readonly baselineCV: number;

    constructor(
        maxSamples: number = exitConfig.volatilityMaxSamples,
        minSamples: number = exitConfig.volatilityMinSamples,
        baselineCV: number = exitConfig.volatilityBaselineCV,
    ) {
        this.maxSamples = maxSamples;
        this.minSamples = minSamples;
        this.baselineCV = baselineCV;
    }

    addSample(price: number): void {
        this.samples.push(price);
        if (this.samples.length > this.maxSamples) {
            this.samples.shift();
        }
    }

    /** Returns multiplier >= 1.0. Higher volatility = wider stops. */
    getMultiplier(): number {
        if (this.samples.length < this.minSamples) return 1.0;

        const mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
        if (mean === 0) return 1.0;

        const variance = this.samples.reduce((sum, s) => sum + (s - mean) ** 2, 0) / this.samples.length;
        const stddev = Math.sqrt(variance);
        const cv = stddev / mean;

        return Math.max(1.0, cv / this.baselineCV);
    }

    /** Serialize samples array for DB persistence. */
    toJSON(): string {
        return JSON.stringify(this.samples);
    }

    /** Restore from DB JSON string. */
    static fromJSON(
        json: string,
        maxSamples: number = exitConfig.volatilityMaxSamples,
        minSamples: number = exitConfig.volatilityMinSamples,
        baselineCV: number = exitConfig.volatilityBaselineCV,
    ): VolatilityTracker {
        const tracker = new VolatilityTracker(maxSamples, minSamples, baselineCV);
        try {
            const parsed = JSON.parse(json);
            if (Array.isArray(parsed)) {
                tracker.samples = parsed.slice(-maxSamples);
            }
        } catch { /* start fresh on corrupt data */ }
        return tracker;
    }
}

// ---------------------------------------------------------------------------
// Pure Computation Helpers
// ---------------------------------------------------------------------------

/**
 * Compute urgency multiplier. D-17: 30-min window. D-19: Linear curve.
 * Returns 1.0 at t=0, decreasing linearly to 0.0 at urgencyWindowMs.
 * At 0.0 the caller triggers a hard market sell.
 */
export function computeUrgencyMultiplier(urgencyStartTs: number, nowMs: number, windowMs: number = exitConfig.urgencyWindowMs): number {
    const ageMs = nowMs - urgencyStartTs;
    if (ageMs <= 0) return 1.0;
    if (ageMs >= windowMs) return 0.0;
    return 1.0 - (ageMs / windowMs);
}

/**
 * Compute effective trailing stop percentage combining volatility + urgency.
 * D-13: volatility widens. D-18: urgency tightens. D-14: clamped to min/max.
 */
export function computeEffectiveTrailingPct(
    basePct: number,
    volMultiplier: number,
    urgencyMultiplier: number,
    minPct: number = exitConfig.trailingMinPct,
    maxPct: number = exitConfig.trailingMaxPct,
): number {
    const volAdjusted = basePct * volMultiplier;
    const urgencyAdjusted = volAdjusted * urgencyMultiplier;
    return Math.max(minPct, Math.min(maxPct, urgencyAdjusted));
}

/**
 * Get unfilled tiers that the current price multiple has reached.
 * D-08: If price gaps past multiple tiers, all are returned for combined sell.
 */
export function getUnfilledTiers(
    tiers: PartialTier[],
    completedIndices: Set<number>,
    priceMultiple: number,
): { tier: PartialTier; index: number }[] {
    return tiers
        .map((tier, index) => ({ tier, index }))
        .filter(({ tier, index }) => !completedIndices.has(index) && priceMultiple >= tier.multiple);
}

/**
 * Calculate partial sell token amount from original buy amount.
 * D-07: percentage of ORIGINAL buy amount, not current balance.
 * Uses BigInt math exclusively to avoid precision loss (Pitfall 1).
 */
export function calculatePartialSellAmount(
    originalAmount: bigint,
    tiers: { tier: PartialTier; index: number }[],
): bigint {
    const totalPct = tiers.reduce((sum, { tier }) => sum + tier.percent, 0);
    return originalAmount * BigInt(totalPct) / 100n;
}

/**
 * Serialize ExitStateData to DB row format.
 */
export function serializeExitState(state: ExitStateData): {
    tradeId: number;
    entryPrice: number;
    highWaterMark: number;
    trailingActivated: number;
    partialTiersCompleted: string;
    originalTokenAmount: string;
    urgencyStartTs: number;
    volatilitySamples: string;
} {
    return {
        tradeId: state.tradeId,
        entryPrice: state.entryPrice,
        highWaterMark: state.highWaterMark,
        trailingActivated: state.trailingActivated ? 1 : 0,
        partialTiersCompleted: JSON.stringify(Array.from(state.completedTierIndices)),
        originalTokenAmount: state.originalTokenAmount.toString(),
        urgencyStartTs: state.urgencyStartTs,
        volatilitySamples: state.volatilityTracker.toJSON(),
    };
}

/**
 * Deserialize DB row to ExitStateData.
 */
export function deserializeExitState(row: ExitStateRow): ExitStateData {
    let completedSet = new Set<number>();
    try {
        const parsed = JSON.parse(row.partial_tiers_completed);
        if (Array.isArray(parsed)) completedSet = new Set(parsed);
    } catch { /* empty set on corrupt data */ }

    return {
        tradeId: row.trade_id,
        entryPrice: row.entry_price,
        highWaterMark: row.high_water_mark,
        trailingActivated: row.trailing_activated === 1,
        completedTierIndices: completedSet,
        originalTokenAmount: BigInt(row.original_token_amount),
        urgencyStartTs: row.urgency_start_ts,
        volatilityTracker: VolatilityTracker.fromJSON(row.volatility_samples),
    };
}
