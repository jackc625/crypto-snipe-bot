// src/riskManager.ts
// Standalone risk gate module. All five risk controls checked in canSnipe().
// DB-backed state for positions/exposure/loss; in-memory Map for cooldowns (ephemeral per D-09).

import { db, getOpenPositionCount, getTotalExposure, getDailyRealizedLoss } from './utils/db';
import { logger } from './utils/logger';

// --- Types (Research Pattern 1: result object, not boolean) ---

export interface RiskCheckResult {
    allowed: boolean;
    reason?: string;    // 'position_size' | 'daily_loss_limit' | 'max_positions' | 'cooldown' | 'exposure_cap'
    details?: string;   // Human-readable for Telegram alert
}

// --- Config (Research Pattern 4: flat env vars with sensible defaults) ---

interface RiskConfig {
    maxOpenPositions: number;
    maxTotalExposure: number;
    dailyLossPct: number;
    snipeCooldownMs: number;
    maxPositionSize: number | null;
}

function loadRiskConfig(): RiskConfig {
    return {
        maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '10', 10),
        maxTotalExposure: parseFloat(process.env.MAX_TOTAL_EXPOSURE || '10.0'),
        dailyLossPct: parseFloat(process.env.DAILY_LOSS_PCT || '10'),
        snipeCooldownMs: parseInt(process.env.SNIPE_COOLDOWN_MS || '30000', 10),
        maxPositionSize: process.env.MAX_POSITION_SIZE ? parseFloat(process.env.MAX_POSITION_SIZE) : null,
    };
}

const riskConfig = loadRiskConfig();

// --- Cooldown State (in-memory, ephemeral by design per D-09) ---

const lastSnipeTime = new Map<string, number>(); // chain name -> Date.now() timestamp

// --- Logger ---

const log = logger.child({ module: 'riskManager' });

// --- Exposure by Chain (inline prepared statement, consistent with resumeMonitoring pattern from Phase 3) ---

const exposureByChain = db.prepare(
    `SELECT chain, COALESCE(SUM(CAST(amount_in AS REAL)), 0) AS deployed FROM trades WHERE status = 'pending' AND action = 'buy' GROUP BY chain`
);

// --- Public API ---

/**
 * Gate function: checks all 5 risk rules in sequence. First failure returns.
 * Called BEFORE expensive safety API calls (anti-pattern guidance: fast-fail).
 *
 * @param chainName - Chain identifier (e.g. 'eth', 'bsc')
 * @param amountNative - Snipe amount in native currency (e.g. '0.01')
 * @param maxCapitalNative - Per-chain max capital from ChainConfig (e.g. '1.0')
 */
export function canSnipe(chainName: string, amountNative: string, maxCapitalNative: string): RiskCheckResult {
    const amount = parseFloat(amountNative);

    // Check 1: Position size (RISK-01, D-01/D-02)
    // If maxPositionSize is set, reject if snipe amount exceeds hard cap.
    // Per D-02: reject entirely, never auto-reduce.
    if (riskConfig.maxPositionSize !== null && amount > riskConfig.maxPositionSize) {
        const result: RiskCheckResult = {
            allowed: false,
            reason: 'position_size',
            details: `Position size ${amountNative} exceeds max ${riskConfig.maxPositionSize}`,
        };
        log.warn({ chain: chainName, reason: result.reason, details: result.details }, 'Risk check failed');
        return result;
    }

    // Check 2: Daily loss circuit breaker (RISK-02, D-04/D-05/D-06/D-07)
    // Query realized losses in rolling 24h window for this chain.
    // Only halts new snipes; existing positions keep monitoring (D-07).
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const lossResult = getDailyRealizedLoss.get(chainName, oneDayAgo) as { total_loss: number };
    const maxCapital = parseFloat(maxCapitalNative);
    const lossThreshold = -(maxCapital * riskConfig.dailyLossPct / 100);

    if (lossResult.total_loss <= lossThreshold) {
        const result: RiskCheckResult = {
            allowed: false,
            reason: 'daily_loss_limit',
            details: `Daily loss on ${chainName}: ${Math.abs(lossResult.total_loss).toFixed(4)} exceeds ${riskConfig.dailyLossPct}% of ${maxCapitalNative}`,
        };
        log.warn({ chain: chainName, reason: result.reason, details: result.details }, 'Risk check failed');
        return result;
    }

    // Check 3: Open positions (RISK-03, D-08/D-10)
    // Global count across all chains.
    const posResult = getOpenPositionCount.get() as { count: number };
    if (posResult.count >= riskConfig.maxOpenPositions) {
        const result: RiskCheckResult = {
            allowed: false,
            reason: 'max_positions',
            details: `Open positions (${posResult.count}) at limit (${riskConfig.maxOpenPositions})`,
        };
        log.warn({ chain: chainName, reason: result.reason, details: result.details }, 'Risk check failed');
        return result;
    }

    // Check 4: Cooldown (RISK-04, D-09)
    // Per-chain cooldown. Different chains can snipe concurrently.
    const lastTime = lastSnipeTime.get(chainName);
    if (lastTime !== undefined && Date.now() - lastTime < riskConfig.snipeCooldownMs) {
        const remainingMs = riskConfig.snipeCooldownMs - (Date.now() - lastTime);
        const remainingSec = Math.ceil(remainingMs / 1000);
        const result: RiskCheckResult = {
            allowed: false,
            reason: 'cooldown',
            details: `Cooldown active on ${chainName}: ${remainingSec}s remaining`,
        };
        log.warn({ chain: chainName, reason: result.reason, details: result.details }, 'Risk check failed');
        return result;
    }

    // Check 5: Total exposure (RISK-05, D-11/D-12)
    // Portfolio-level safety net above per-chain budgets.
    const expResult = getTotalExposure.get() as { total: number };
    if (expResult.total + amount > riskConfig.maxTotalExposure) {
        const result: RiskCheckResult = {
            allowed: false,
            reason: 'exposure_cap',
            details: `Total exposure (${expResult.total.toFixed(4)} + ${amountNative}) would exceed cap (${riskConfig.maxTotalExposure})`,
        };
        log.warn({ chain: chainName, reason: result.reason, details: result.details }, 'Risk check failed');
        return result;
    }

    // All checks passed
    log.debug({ chain: chainName, amount: amountNative }, 'Risk check passed');
    return { allowed: true };
}

/**
 * Record a successful snipe for cooldown tracking.
 * Call AFTER successful TX submission (Pitfall 5: never before TX confirmation).
 */
export function recordSnipe(chainName: string): void {
    lastSnipeTime.set(chainName, Date.now());
    log.debug({ chain: chainName }, 'Snipe cooldown recorded');
}

/**
 * Query portfolio exposure at any time (RISK-05, D-11).
 * Returns total deployed capital and per-chain breakdown from DB.
 */
export function getPortfolioExposure(): { total: number; byChain: Record<string, number> } {
    const totalResult = getTotalExposure.get() as { total: number };
    const chainRows = exposureByChain.all() as Array<{ chain: string; deployed: number }>;

    const byChain: Record<string, number> = {};
    for (const row of chainRows) {
        byChain[row.chain] = row.deployed;
    }

    return {
        total: totalResult.total,
        byChain,
    };
}
