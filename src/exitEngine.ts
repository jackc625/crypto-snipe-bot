// src/exitEngine.ts
// Unified exit engine for smart position management (Phase 7).
// Handles trailing stops, partial sells, volatility adaptation, and time-weighted urgency.

import { ethers, Contract } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { CONFIG } from './config';
import { logger } from './utils/logger';
import type { ChainContext, DexConfig, DexConfigV2, DexConfigV3 } from './chainRegistry';
import { ROUTER_ABI, ERC20_ABI, V3_SWAP_ROUTER_ABI, V3_QUOTER_V2_ABI } from './utils/abis';
import { tryAcquireSellLock, releaseSellLock, registerExitMonitor, clearAllTimersForToken } from './utils/exitManager';
import { insertTrade, updateTradeStatus, upsertExitState, getExitState, deleteExitState } from './utils/db';
import { sendCtxAlert } from './utils/notifier';
import { sendTxWithRetry } from './utils/txManager';

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

// ---------------------------------------------------------------------------
// I/O Helpers: Price Query, Sell Execution, Notifications
// ---------------------------------------------------------------------------

/**
 * Query current price for a position. Dispatches to V2 (getAmountsOut) or V3 (QuoterV2).
 * Returns price as a Number for ratio comparisons. Returns null on error.
 * Token amounts stay as BigInt; only the price ratio is Number (safe for comparison).
 */
export async function queryPrice(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    buyAmountWei: bigint,
): Promise<number | null> {
    try {
        if (dex.dexType === 'v3' && feeTier != null) {
            const quoter = new Contract(dex.quoterAddress, V3_QUOTER_V2_ABI, ctx.httpProvider);
            const quoteParams = {
                tokenIn: tokenAddress,
                tokenOut: ctx.chain.wethAddress,
                amountIn: buyAmountWei,
                fee: feeTier,
                sqrtPriceLimitX96: 0n,
            };
            const [amountOut] = await quoter.quoteExactInputSingle.staticCall(quoteParams);
            return Number(amountOut);
        } else if (dex.dexType === 'v2') {
            const router = new Contract(dex.routerAddress, ROUTER_ABI, ctx.httpProvider);
            const path = [tokenAddress, ctx.chain.wethAddress];
            const amounts = await router.getAmountsOut(buyAmountWei, path);
            return Number(amounts[1]);
        }
        return null;
    } catch (e) {
        log.debug({ err: e, token: tokenAddress }, 'Price query failed');
        return null;
    }
}

/**
 * Build a TransactionRequest for a V2 swapExactTokensForETH call.
 * Used as txBuilder argument to sendTxWithRetry.
 */
function buildV2SellTx(
    dex: DexConfigV2,
    tokenAddress: string,
    wethAddress: string,
    walletAddress: string,
    amount: bigint,
    gasLimit: bigint,
): () => Promise<TransactionRequest> {
    return async () => {
        const router = new Contract(dex.routerAddress, ROUTER_ABI);
        const path = [tokenAddress, wethAddress];
        const deadline = Math.floor(Date.now() / 1000) + 60;
        const data = router.interface.encodeFunctionData('swapExactTokensForETH', [
            amount, 0, path, walletAddress, deadline,
        ]);
        return {
            to: dex.routerAddress,
            data,
            gasLimit,
        };
    };
}

/**
 * Build a TransactionRequest for a V3 exactInputSingle via multicall.
 * Used as txBuilder argument to sendTxWithRetry.
 */
function buildV3SellTx(
    dex: DexConfigV3,
    tokenAddress: string,
    wethAddress: string,
    walletAddress: string,
    amount: bigint,
    feeTier: number,
    gasLimit: bigint,
): () => Promise<TransactionRequest> {
    return async () => {
        const v3Router = new Contract(dex.swapRouterAddress, V3_SWAP_ROUTER_ABI);
        const swapParams = {
            tokenIn: tokenAddress,
            tokenOut: wethAddress,
            fee: feeTier,
            recipient: walletAddress,
            amountIn: amount,
            amountOutMinimum: 0n,
            sqrtPriceLimitX96: 0n,
        };
        const swapData = v3Router.interface.encodeFunctionData('exactInputSingle', [swapParams]);
        const deadline = Math.floor(Date.now() / 1000) + 60;
        const data = v3Router.interface.encodeFunctionData('multicall', [deadline, [swapData]]);
        return {
            to: dex.swapRouterAddress,
            data,
            gasLimit,
        };
    };
}

/**
 * Approve token spend if current allowance is insufficient.
 * Approval does not need MEV protection -- sent directly.
 */
async function ensureApproval(
    token: Contract,
    spender: string,
    amount: bigint,
    ownerAddress: string,
): Promise<void> {
    const currentAllowance: bigint = await token.allowance(ownerAddress, spender);
    if (currentAllowance < amount) {
        const approveTx = await token.approve(spender, amount);
        await approveTx.wait();
    }
}

/**
 * Execute a full sell of remaining token balance.
 * Per D-05: sell entire remaining balance after partial sells.
 * Routes through sendTxWithRetry for MEV protection (Flashbots/bloXroute/passthrough).
 */
export async function executeFullSell(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    reason: 'trailing-stop' | 'stop-loss' | 'urgency-market-sell',
    tradeId: number,
    reasonDetail: string,
): Promise<boolean> {
    if (!tryAcquireSellLock(ctx.chain.name, tokenAddress)) {
        ctx.log.info({ token: tokenAddress, reason }, 'Another exit already handling token, skipping');
        return false;
    }

    try {
        const token = new Contract(tokenAddress, ERC20_ABI, ctx.wallet);
        const balance: bigint = await token.balanceOf(ctx.wallet.address);

        if (balance === 0n) {
            ctx.log.info({ token: tokenAddress, reason }, 'Zero balance, cleaning up');
            updateTradeStatus.run('sold', tokenAddress.toLowerCase());
            clearAllTimersForToken(ctx.chain.name, tokenAddress);
            deleteExitState.run(tradeId);
            return true;
        }

        const gasLimit = ctx.chain.gas.maxGasLimit;

        // Build txBuilder for MEV-protected submission
        let txBuilder: () => Promise<TransactionRequest>;
        if (dex.dexType === 'v3' && feeTier != null) {
            await ensureApproval(token, dex.swapRouterAddress, balance, ctx.wallet.address);
            txBuilder = buildV3SellTx(dex, tokenAddress, ctx.chain.wethAddress, ctx.wallet.address, balance, feeTier, gasLimit);
        } else if (dex.dexType === 'v2') {
            await ensureApproval(token, dex.routerAddress, balance, ctx.wallet.address);
            txBuilder = buildV2SellTx(dex, tokenAddress, ctx.chain.wethAddress, ctx.wallet.address, balance, gasLimit);
        } else {
            ctx.log.error({ token: tokenAddress, dexType: dex.dexType }, 'Unknown DEX type for sell');
            return false;
        }

        // Submit via sendTxWithRetry for MEV protection
        ctx.log.info({ token: tokenAddress, reason }, 'Submitting exit sell via MEV-protected path');
        await sendCtxAlert(ctx, `*${reason}:* ${reasonDetail}`);
        const txHash = await sendTxWithRetry(txBuilder, ctx);

        ctx.log.info({ token: tokenAddress, reason, txHash }, 'Exit sell TX confirmed');

        // Record sell trade
        insertTrade.run({
            token: tokenAddress.toLowerCase(),
            chain: ctx.chain.name,
            action: 'sell',
            txHash: txHash || null,
            block: null,
            timestamp: Math.floor(Date.now() / 1000),
            amountIn: balance.toString(),
            amountOut: null,
            gasCost: null,
            priceAtAction: null,
            status: 'sold',
            poolType: dex.dexType,
            feeTier: feeTier,
        });
        updateTradeStatus.run('sold', tokenAddress.toLowerCase());
        clearAllTimersForToken(ctx.chain.name, tokenAddress);
        deleteExitState.run(tradeId);

        await sendCtxAlert(ctx, `*${reason} confirmed*`);
        return true;
    } catch (e) {
        ctx.log.error({ err: e, token: tokenAddress, reason }, 'Exit sell failed');
        // Full exit failure: mark failed and clean up (Pitfall 6)
        updateTradeStatus.run('failed', tokenAddress.toLowerCase());
        clearAllTimersForToken(ctx.chain.name, tokenAddress);
        deleteExitState.run(tradeId);
        await sendCtxAlert(ctx, `*${reason} sell failed:* ${e instanceof Error ? e.message : String(e)}`);
        return false;
    } finally {
        releaseSellLock(ctx.chain.name, tokenAddress);
    }
}

/**
 * Execute a partial sell for one or more tiers combined.
 * Per D-07: percentage of ORIGINAL buy amount.
 * Per D-08: combined into single TX for gap sells.
 * Per D-09: same V2/V3 sell path with reduced amount.
 * Per D-10: recorded as 'partial_sell' trade row.
 * Per D-11: high-water mark NOT reset after partial sell.
 * Routes through sendTxWithRetry for MEV protection.
 * On failure: logs warning, does NOT kill the exit monitor (Pitfall 6).
 */
export async function executePartialSell(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    sellAmount: bigint,
    tiers: { tier: PartialTier; index: number }[],
    state: ExitStateData,
    currentMultiple: number,
): Promise<boolean> {
    if (!tryAcquireSellLock(ctx.chain.name, tokenAddress)) {
        ctx.log.info({ token: tokenAddress }, 'Sell lock held, skipping partial sell this cycle');
        return false;
    }

    try {
        const token = new Contract(tokenAddress, ERC20_ABI, ctx.wallet);
        const balance: bigint = await token.balanceOf(ctx.wallet.address);

        // Clamp sell amount to actual balance (Pitfall 7: gap sell exceed)
        const actualSellAmount = sellAmount > balance ? balance : sellAmount;
        if (actualSellAmount === 0n) {
            ctx.log.warn({ token: tokenAddress }, 'Partial sell amount is 0, skipping');
            return false;
        }

        const gasLimit = ctx.chain.gas.maxGasLimit;

        // Build txBuilder for MEV-protected submission
        let txBuilder: () => Promise<TransactionRequest>;
        if (dex.dexType === 'v3' && feeTier != null) {
            await ensureApproval(token, dex.swapRouterAddress, actualSellAmount, ctx.wallet.address);
            txBuilder = buildV3SellTx(dex, tokenAddress, ctx.chain.wethAddress, ctx.wallet.address, actualSellAmount, feeTier, gasLimit);
        } else if (dex.dexType === 'v2') {
            await ensureApproval(token, dex.routerAddress, actualSellAmount, ctx.wallet.address);
            txBuilder = buildV2SellTx(dex, tokenAddress, ctx.chain.wethAddress, ctx.wallet.address, actualSellAmount, gasLimit);
        } else {
            ctx.log.error({ token: tokenAddress }, 'Unknown DEX type for partial sell');
            return false;
        }

        const tierLabels = tiers.map(t => `${t.tier.multiple}x:${t.tier.percent}%`).join('+');
        ctx.log.info({ token: tokenAddress, tiers: tierLabels }, 'Submitting partial sell via MEV-protected path');
        await sendCtxAlert(ctx, `*Partial sell:* ${tierLabels} at ${currentMultiple.toFixed(2)}x`);

        // Submit via sendTxWithRetry for MEV protection
        const txHash = await sendTxWithRetry(txBuilder, ctx);

        ctx.log.info({ token: tokenAddress, tiers: tierLabels, txHash }, 'Partial sell TX confirmed');

        // D-10: Record each partial sell as separate trade row
        insertTrade.run({
            token: tokenAddress.toLowerCase(),
            chain: ctx.chain.name,
            action: 'partial_sell',
            txHash: txHash || null,
            block: null,
            timestamp: Math.floor(Date.now() / 1000),
            amountIn: actualSellAmount.toString(),
            amountOut: null,
            gasCost: null,
            priceAtAction: currentMultiple.toString(),
            status: 'sold',
            poolType: dex.dexType,
            feeTier: feeTier,
        });

        // Mark tiers as completed (D-11: high-water mark NOT reset)
        for (const { index } of tiers) {
            state.completedTierIndices.add(index);
        }

        const totalPctSold = tiers.reduce((sum, t) => sum + t.tier.percent, 0);
        const remainingPct = 100 - Array.from(state.completedTierIndices).reduce((sum, i) => {
            const tier = exitConfig.partialSellTiers[i];
            return tier ? sum + tier.percent : sum;
        }, 0);

        await sendCtxAlert(ctx, `*Partial sell confirmed:* sold ${totalPctSold}% | Remaining: ${remainingPct}% trailing`);
        return true;
    } catch (e) {
        // Pitfall 6: partial sell failure does NOT kill exit monitor
        ctx.log.warn({ err: e, token: tokenAddress }, 'Partial sell failed, will retry next cycle');
        return false;
    } finally {
        releaseSellLock(ctx.chain.name, tokenAddress);
    }
}

/**
 * Format detailed exit reason for Telegram notification.
 * Per D-26: includes strategy context.
 */
export function formatExitReason(
    reason: string,
    ctx: { entryPrice: number; highWaterMark: number; currentPrice: number; priceMultiple: number; effectivePct?: number },
): string {
    const pnlPct = ((ctx.currentPrice - ctx.entryPrice) / ctx.entryPrice * 100).toFixed(1);
    const sign = ctx.currentPrice >= ctx.entryPrice ? '+' : '';

    switch (reason) {
        case 'trailing-stop': {
            const pullback = ((ctx.highWaterMark - ctx.currentPrice) / ctx.highWaterMark * 100).toFixed(1);
            return `Trailing stop: peak ${ctx.highWaterMark.toFixed(0)}, pullback ${pullback}% (threshold ${ctx.effectivePct?.toFixed(1)}%) | ${ctx.priceMultiple.toFixed(2)}x (${sign}${pnlPct}%)`;
        }
        case 'stop-loss':
            return `Fixed stop-loss at ${ctx.priceMultiple.toFixed(2)}x (${sign}${pnlPct}%)`;
        case 'urgency-market-sell':
            return `Urgency market sell at 30min deadline | ${ctx.priceMultiple.toFixed(2)}x (${sign}${pnlPct}%)`;
        default:
            return `Exit: ${reason} at ${ctx.priceMultiple.toFixed(2)}x`;
    }
}
