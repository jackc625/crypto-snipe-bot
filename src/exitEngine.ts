// src/exitEngine.ts
// Unified exit engine for smart position management (Phase 7).
// Handles trailing stops, partial sells, volatility adaptation, and time-weighted urgency.

import { ethers, Contract } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { CONFIG } from './config';
import { logger } from './utils/logger';
import type { ChainContext, DexConfig, DexConfigV2, DexConfigV3 } from './chainRegistry';
import { ROUTER_ABI, ERC20_ABI, V3_SWAP_ROUTER_ABI, V3_QUOTER_V2_ABI } from './utils/abis';
import { tryAcquireSellLock, releaseSellLock, registerExitMonitor, clearAllTimersForToken, hasExitMonitorTimer, tryEnqueuePosition, releasePositionQueue } from './utils/exitManager';
import { withNonceLock } from './utils/nonceAuthority';
import { insertTrade, updateTradeStatus, upsertExitState, getExitState, deleteExitState, markExitFailedHeld } from './utils/db';
import { sendCtxAlert } from './utils/notifier';
import { sendTxWithRetry, escalatePrivateSell } from './utils/txManager';
import { reconcileInclusion, buildReconcileConfig } from './utils/mevStrategies/reconciliation';
import { decodeReceipt } from './utils/receiptDecoder';
// Phase 19 / Plan 19-05 — terminate the anti-rug position subscription on
// every full-close path per CONTEXT.md D-TERMINATION. Imported under the
// shorter `unsubscribeAntiRug` alias to read cleanly at the call site
// (caller does not care about internal registry mechanics).
import { unregisterAntiRugPosition as unsubscribeAntiRug } from './anti-rug/detector';

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

// ---------------------------------------------------------------------------
// Finding A inclusion ladder helpers (Phase 21.2 / Plan 21.2-06)
// D-EXIT-INCLUSION + D-FALLBACK-TRIGGER + D-FALLBACK-NO-DOUBLE-SELL
// ---------------------------------------------------------------------------

type FullSellReason = 'trailing-stop' | 'stop-loss' | 'urgency-market-sell' | 'anti-rug';

/** never-NaN, never-negative positive-int env parse (mirrors reconciliation.ts). */
function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** never-NaN, never-negative positive-number env parse. */
function parsePositiveNumberEnv(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Reason-aware PRIVATE-attempt budget (D-FALLBACK-TRIGGER). A rug is happening
 * NOW, so anti-rug burns at most ONE quick private attempt before going public;
 * routine exits (trailing/stop-loss/urgency) escalate privately for
 * MEV_SELL_FALLBACK_ATTEMPTS (default 2) attempts before the public fallback.
 */
export function privateAttemptBudget(reason: FullSellReason): number {
    if (reason === 'anti-rug') return 1;
    return parsePositiveIntEnv(process.env.MEV_SELL_FALLBACK_ATTEMPTS, 2);
}

/**
 * Reason-aware public-fallback slippage percent (D-FALLBACK-NO-DOUBLE-SELL §Q3).
 * Routine fallbacks reuse the engine's configured exit slippage (~5%); anti-rug
 * fallbacks WIDEN (default 15%, never below a 10% floor) to maximize landing
 * while liquidity drains. A sandwiched sell beats a stranded position (T-21.2-SANDWICH).
 */
export function fallbackSlippagePct(reason: FullSellReason): number {
    // IN-02 (21.2-13): simplified from the opaque
    // `parsePositiveNumberEnv(undefined, CONFIG.slippagePercent || 5)` — with a
    // `undefined` raw that parse ALWAYS returned the fallback, so it read as if it
    // parsed an env var when it did not. This is just the configured exit slippage
    // (defaulting to 5%) written plainly.
    const routine = CONFIG.slippagePercent || 5;
    if (reason !== 'anti-rug') return routine;
    const antiRug = parsePositiveNumberEnv(process.env.MEV_SELL_ANTIRUG_SLIPPAGE_PCT, 15);
    // Never narrower than the 10% mainnet-proven floor (recover-sell-ladys.ts) and
    // never narrower than the routine slippage (anti-rug must bid AT LEAST as wide).
    return Math.max(antiRug, 10, routine);
}

/**
 * Compute the fee-on-transfer-safe public-sell minOut from a fresh quote and a
 * reason-aware slippage percent. BigInt-only (no float drift): minOut =
 * expectedOut × (100 - slippagePct) / 100.
 */
export function computePublicMinOut(expectedOut: bigint, slippagePct: number): bigint {
    // IN-03 (21.2-13): defensive UPPER clamp. A misconfigured slippage > 100% would
    // make `100 - slippagePct` negative → keepPct clamped to 0 → minOut = 0 (accept
    // ANY output, including a fully-sandwiched near-zero — an unbounded-loss public
    // sell on a typo). Cap EFFECTIVE slippage at 99% so minOut always keeps at
    // least 1% of the quote (a real, if wide, floor). The anti-rug widening
    // (fallbackSlippagePct: max(antiRug,10,routine)) and the never-negative env
    // parse make >100% hard to hit operationally, but this prevents the no-floor
    // case entirely. Lower bound 0 is retained (a 0%/negative slippage → keep 100%).
    const effectiveSlippage = Math.min(Math.max(0, slippagePct), 99);
    // Round to an integer percent for exact bigint math (matches the
    // recover-sell-ladys.ts `* 90n / 100n` idiom; 5% → ×95/100, 15% → ×85/100).
    const keepPct = BigInt(Math.max(1, Math.round(100 - effectiveSlippage)));
    return (expectedOut * keepPct) / 100n;
}

/**
 * The GUARANTEED public-mempool fallback sell (Finding A). Promotes the
 * mainnet-proven recover-sell-ladys.ts logic into the engine: quote → approve (if
 * needed) → swapExactTokensForETHSupportingFeeOnTransferTokens (fee-on-transfer-
 * safe). Both the approval AND the swap each run inside withNonceLock so the
 * per-wallet nonce authority serializes them (D-NONCE-AUTHORITY-ALL). The
 * `amountIn` is the RE-FETCHED held balance (sell only what is still held); the
 * `minOut` uses reason-aware slippage. Returns the real on-chain tx hash.
 */
async function executePublicFallbackSell(
    ctx: ChainContext,
    dex: DexConfigV2,
    token: Contract,
    tokenAddress: string,
    heldBalance: bigint,
    reason: FullSellReason,
): Promise<string> {
    const router = new Contract(dex.routerAddress, ROUTER_ABI, ctx.wallet);
    const path = [tokenAddress, ctx.chain.wethAddress];

    // Fresh quote → reason-aware minOut (anti-rug widens to maximize landing).
    const amounts: bigint[] = await router.getAmountsOut(heldBalance, path);
    const expectedOut = amounts[1];
    const slippagePct = fallbackSlippagePct(reason);
    const minOut = computePublicMinOut(expectedOut, slippagePct);

    ctx.log.info(
        {
            token: tokenAddress, reason, amountIn: heldBalance.toString(),
            expectedOut: expectedOut.toString(), minOut: minOut.toString(),
            slippagePct, op: 'exit.fallback.public.submit',
        },
        'Public-mempool fallback sell (private escalation did not land)',
    );
    await sendCtxAlert(
        ctx,
        `*[EXIT FALLBACK → PUBLIC]* ${reason}: private escalation did not land — selling on the public mempool ` +
        `(slippage ${slippagePct}%). Remediation: if this recurs at calm gas, raise MEV_SELL_MAX_PRIORITY_FEE_GWEI ` +
        `or inspect relay inclusion.`,
    );

    // Approval (nonce-locked). Only fires when the current allowance is short.
    const currentAllowance: bigint = await token.allowance(ctx.wallet.address, dex.routerAddress);
    if (currentAllowance < heldBalance) {
        await withNonceLock(ctx.wallet.address, async () => {
            const approveTx = await token.approve(dex.routerAddress, heldBalance);
            await approveTx.wait();
        });
    }

    // The swap (nonce-locked). Fee-on-transfer-safe variant + a generous deadline
    // (promoted from recover-sell-ladys.ts:76-80).
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const txHash = await withNonceLock(ctx.wallet.address, async () => {
        const stx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            heldBalance, minOut, path, ctx.wallet.address, deadline,
        );
        const rec = await stx.wait();
        ctx.log.info(
            { token: tokenAddress, reason, txHash: stx.hash, blockNumber: rec?.blockNumber, op: 'exit.fallback.public.mined' },
            'Public-mempool fallback sell mined',
        );
        return stx.hash as string;
    });
    return txHash;
}

// ---------------------------------------------------------------------------
// Finding D balance-truth teardown (Phase 21.2 / Plan 21.2-07)
// D-FAILED-EXIT-KEEP-MONITORING + D-BALANCE-IS-TRUTH + D-PERSIST-FAILED-HELD
// ---------------------------------------------------------------------------
//
// THE CAPITAL-SAFETY CROWN JEWEL. The cardinal invariant: a failed exit must
// NEVER strip anti-rug protection from a STILL-HELD position. The old catch
// (pre-21.2-07) treated a FAILED exit like a successful close —
// updateTradeStatus('failed') + clearAllTimersForToken + deleteExitState +
// unsubscribeAntiRug — which stripped rug protection from a still-held position
// (the LADYS evidence: 252,930,777 LADYS confirmed held AFTER the reported
// failure). This corrects a MISapplication of Phase 19 D-TERMINATION (which
// always meant "tear down when the position CLOSES"); it is NOT a reversal.
//
// The fix: on BOTH the success path AND the catch the teardown decision is made
// by a re-fetched on-chain balanceOf (the only signal that did not lie):
//   * balanceOf <= dust (relative to original_token_amount) → GENUINE close →
//     run the normal teardown (updateTradeStatus + clearAllTimersForToken +
//     deleteExitState + unsubscribeAntiRug).
//   * balanceOf > dust → STILL HELD → markExitFailedHeld (status
//     'exit_failed_held' + exit_failure_count++, DB v7 from 21.2-03), do NOT
//     deleteExitState, do NOT unsubscribeAntiRug, and RE-ARM the routine poll
//     timer if it was cleared (the anti-rug path clears it at exitTrigger.ts:222
//     BEFORE the sell). After N=5 consecutive ROUTINE failures, routine retries
//     pause + hard-alert; anti-rug emergency exits ALWAYS bypass the pause.

/** never-NaN/never-negative positive-int parse used for the Finding D knobs. */
function parsePositiveIntDefault(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** EXIT_ROUTINE_MAX_FAILURES (default 5): the bounded-routine-retry ceiling. */
function routineMaxFailures(): number {
    return parsePositiveIntDefault(process.env.EXIT_ROUTINE_MAX_FAILURES, 5);
}

/**
 * Dust threshold for a position, relative to its original token amount
 * (EXIT_DUST_THRESHOLD_BPS, default 1 bps = 0.01% per RESEARCH A6) PLUS a tiny
 * absolute floor so a fee-on-transfer remainder of a few wei never reads as
 * "still held". balanceOf <= this → genuine close; above → still held.
 *
 * `originalTokenAmount` comes from the exit_state row (the authoritative buy
 * amount). When it is unavailable (0 / no row), the relative term is 0 and only
 * the absolute floor applies — fail-safe toward "still held" for any non-trivial
 * balance (we never tear down a held position on missing metadata).
 */
function computeDustThreshold(originalTokenAmount: bigint): bigint {
    const bps = BigInt(parsePositiveIntDefault(process.env.EXIT_DUST_THRESHOLD_BPS, 1));
    const relative = (originalTokenAmount * bps) / 10_000n;
    // Absolute floor: 1000 wei of the token's smallest unit. Negligible value on
    // any real position; catches fee-on-transfer rounding crumbs.
    const absoluteFloor = 1_000n;
    return relative > absoluteFloor ? relative : absoluteFloor;
}

/**
 * Read the position's original token amount from the persisted exit_state row.
 * Returns 0n if the row is absent (the dust threshold then falls back to its
 * absolute floor — see computeDustThreshold).
 */
function readOriginalTokenAmount(tradeId: number): bigint {
    try {
        const row = getExitState.get(tradeId) as ExitStateRow | undefined;
        if (row && row.original_token_amount) return BigInt(row.original_token_amount);
    } catch { /* fall through to 0n */ }
    return 0n;
}

// Routine-retry pause registry (D-FAILED-EXIT-KEEP-MONITORING). Keyed
// "chain:token" (lowercased) to line up with the sell-lock / timer-registry /
// nonce-authority conventions. A position lands here once its persisted
// exit_failure_count reaches EXIT_ROUTINE_MAX_FAILURES; while present, ROUTINE
// (trailing-stop / stop-loss / urgency-market-sell) exits are skipped. ANTI-RUG
// exits ALWAYS bypass this set — an emergency exit must be able to fire no matter
// how many routine attempts have failed. A genuine close clears the entry.
const routinePausedPositions = new Set<string>();

function pauseKey(chainName: string, tokenAddress: string): string {
    return `${chainName}:${tokenAddress.toLowerCase()}`;
}

/** True if ROUTINE retries are paused for this position (anti-rug ignores it). */
export function isRoutinePaused(chainName: string, tokenAddress: string): boolean {
    return routinePausedPositions.has(pauseKey(chainName, tokenAddress));
}

/** Test-only: clear the routine-pause registry between tests. */
export function _resetRoutinePauseForTesting(): void {
    routinePausedPositions.clear();
}

/**
 * GENUINE-close teardown (balanceOf <= dust). Identical to the historical
 * success-path teardown (the CORRECT-close reference): mark sold, clear timers,
 * delete exit_state, unsubscribe anti-rug, and lift any routine pause. Used by
 * BOTH the success path and the catch once balanceOf confirms the position is
 * closed (D-BALANCE-IS-TRUTH).
 */
function teardownGenuineClose(ctx: ChainContext, tokenAddress: string, tradeId: number): void {
    updateTradeStatus.run('sold', tokenAddress.toLowerCase(), ctx.chain.name);
    clearAllTimersForToken(ctx.chain.name, tokenAddress);
    deleteExitState.run(tradeId);
    // Phase 19 / Plan 19-05 — terminate anti-rug subscription ONLY on a genuine
    // full-close (D-TERMINATION applied correctly: the position has CLOSED).
    unsubscribeAntiRug(ctx.chain.name, tradeId);
    routinePausedPositions.delete(pauseKey(ctx.chain.name, tokenAddress));
}

/**
 * STILL-HELD failed exit (balanceOf > dust) — the Finding D keep-monitoring path.
 * Persists exit_failed_held + increments the failure counter (does NOT delete
 * exit_state), KEEPS anti-rug registered (NO unsubscribeAntiRug), and RE-ARMS the
 * routine poll timer if it was cleared (the anti-rug path clears it BEFORE the
 * sell at exitTrigger.ts:222 — without the re-arm a still-held position would be
 * anti-rug-monitored but never routinely retried). After N=5 consecutive ROUTINE
 * failures it pauses routine retries + hard-alerts; anti-rug always bypasses the
 * pause. Returns nothing — the caller's catch/return value is unchanged.
 */
async function keepMonitoringFailedHeld(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    reason: FullSellReason,
    tradeId: number,
    heldBalance: bigint,
): Promise<void> {
    // Persist the distinct lifecycle status + increment the consecutive-failure
    // counter (DB v7, 21.2-03). NOTE: we do NOT call deleteExitState — the row
    // (and its restart-resume state) survives so the position keeps being
    // monitored and re-registers anti-rug on a reboot.
    markExitFailedHeld.run(tradeId);

    // Re-read the persisted counter for the bounded-retry decision (the UPDATE
    // does not return the new value; getExitState surfaces the full v7 row).
    let failureCount = 0;
    try {
        const row = getExitState.get(tradeId) as (ExitStateRow & { exit_failure_count?: number }) | undefined;
        failureCount = row?.exit_failure_count ?? 0;
    } catch { /* leave 0 — we still keep monitoring, just don't pause yet */ }

    ctx.log.error(
        {
            token: tokenAddress, reason, tradeId,
            heldBalance: heldBalance.toString(), failureCount,
            op: 'exit.failed.held',
        },
        'Exit FAILED on a STILL-HELD position — keeping anti-rug + the poll timer (balance-is-truth)',
    );

    // RE-ARM the routine poll timer if it was cleared (the anti-rug live-exit
    // path clears it at exitTrigger.ts:222 BEFORE the sell). A failed routine
    // exit never cleared its interval (routine triggers return 'continue'), so
    // hasExitMonitorTimer is already true there and we do NOT double-arm.
    if (!hasExitMonitorTimer(ctx.chain.name, tokenAddress)) {
        ctx.log.info(
            { token: tokenAddress, reason, tradeId, op: 'exit.failed.held.rearm-timer' },
            'Re-arming the routine poll timer for a still-held position (was cleared before the anti-rug exit)',
        );
        // resumeExitMonitor reloads exit_state and re-creates the 5s poll
        // interval. ctx.chain.snipeAmount is the same buy-amount baseline the
        // startup resume path uses (bot.ts:1289/1296) for the price quote.
        await resumeExitMonitor(ctx, dex, tokenAddress, feeTier, ctx.chain.snipeAmount, tradeId);
    }

    // Bounded ROUTINE retries (D-FAILED-EXIT-KEEP-MONITORING). Anti-rug NEVER
    // pauses — an emergency exit must be able to fire regardless of how many
    // routine attempts failed. Routine retries pause once the persisted
    // consecutive-failure counter reaches the ceiling, with a hard alert.
    if (reason !== 'anti-rug' && failureCount >= routineMaxFailures()) {
        routinePausedPositions.add(pauseKey(ctx.chain.name, tokenAddress));
        ctx.log.fatal(
            { token: tokenAddress, reason, tradeId, failureCount, max: routineMaxFailures(), op: 'exit.failed.held.routine-paused' },
            'ROUTINE exit retries PAUSED after consecutive failures — anti-rug emergency exits still fire',
        );
        await sendCtxAlert(
            ctx,
            `*[EXIT ROUTINE PAUSED]* ${reason}: ${failureCount} consecutive failed exits on a still-held position. ` +
            `Routine retries are PAUSED to stop burning gas; anti-rug emergency exits STILL fire. ` +
            `Remediation: inspect the position (sell-reverting? honeypot?) and resume manually.`,
        );
    } else {
        await sendCtxAlert(
            ctx,
            `*[EXIT FAILED — STILL HELD]* ${reason}: exit attempt failed but the position is STILL HELD ` +
            `(balance ${heldBalance.toString()}). Anti-rug protection KEPT + the poll timer is armed; ` +
            `the position will be retried (failure ${failureCount}/${routineMaxFailures()}).`,
        );
    }
}

/**
 * Execute a full sell of remaining token balance.
 * Per D-05: sell entire remaining balance after partial sells.
 *
 * Phase 21.2 / Finding A inclusion ladder (D-EXIT-INCLUSION + D-FALLBACK-TRIGGER +
 * D-FALLBACK-NO-DOUBLE-SELL): the exit (1) escalates PRIVATELY with the independent
 * sell-leg ceiling (reason-aware attempts), (2) runs the no-double-sell guard
 * (reconcileInclusion on the last private attempt + a re-fetched balanceOf) if not
 * landed, then (3) falls back to a guaranteed nonce-locked public-mempool sell.
 * The public fallback is an ENGINE PATH, not a bypass flag (D-ROLLBACK).
 *
 * Phase 21.2 / Finding D balance-truth teardown (D-FAILED-EXIT-KEEP-MONITORING +
 * D-BALANCE-IS-TRUTH + D-PERSIST-FAILED-HELD): on BOTH the success path AND the
 * catch the teardown decision is gated on a RE-FETCHED balanceOf. balanceOf <=
 * dust → genuine close (teardownGenuineClose). balanceOf > dust → still held
 * (keepMonitoringFailedHeld: KEEP anti-rug + re-arm the poll timer + persist
 * exit_failed_held; bounded routine retries, anti-rug always fires).
 */
export async function executeFullSell(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    reason: 'trailing-stop' | 'stop-loss' | 'urgency-market-sell' | 'anti-rug',
    tradeId: number,
    reasonDetail: string,
): Promise<boolean> {
    // Finding D bounded-routine-retry gate (D-FAILED-EXIT-KEEP-MONITORING). If a
    // position's routine retries are PAUSED (N consecutive failures), skip a
    // ROUTINE (trailing-stop / stop-loss / urgency) submit entirely — do NOT
    // tear down, do NOT submit (no more gas burn). ANTI-RUG exits ALWAYS bypass
    // the pause: an emergency exit must be able to fire regardless. The check is
    // BEFORE the sell-lock so a paused routine trigger does not even contend.
    if (reason !== 'anti-rug' && isRoutinePaused(ctx.chain.name, tokenAddress)) {
        ctx.log.warn(
            { token: tokenAddress, reason, tradeId, op: 'exit.routine.paused-skip' },
            'Routine exit retries are paused for this position — skipping submit (anti-rug would still fire)',
        );
        return false;
    }

    if (!tryAcquireSellLock(ctx.chain.name, tokenAddress)) {
        ctx.log.info({ token: tokenAddress, reason }, 'Another exit already handling token, skipping');
        return false;
    }

    try {
        const token = new Contract(tokenAddress, ERC20_ABI, ctx.wallet);
        const balance: bigint = await token.balanceOf(ctx.wallet.address);

        if (balance === 0n) {
            ctx.log.info({ token: tokenAddress, reason, op: 'exit.cleanup.zero-balance' }, 'Zero balance, cleaning up');
            // GENUINE close (no balance) → teardown (D-BALANCE-IS-TRUTH).
            teardownGenuineClose(ctx, tokenAddress, tradeId);
            return true;
        }

        // Phase 19 / Plan 19-05 — elevated-gas branch for anti-rug exits per
        // ANTIRUG-08. The gas multiplier (default 2.0×) reflects the higher
        // urgency of front-running a rug pull. All other reasons use the
        // chain's standard gas multiplier (unchanged behavior).
        //
        // Phase 19 Gap-1 closure (2026-05-24): the gas multiplier is
        // threaded into the MEV strategy via the sendTxWithRetry sixth
        // argument. When reason='anti-rug', the chain's anti-rug
        // multiplier (default 2.0 — see CHAIN_TEMPLATES) elevates the
        // EIP-1559 maxFee/priorityFee (or legacy gasPrice) of the
        // populated tx to improve race odds against the rug-puller.
        // For all other reasons, no multiplier is passed (raw feeData,
        // preserving prior behavior for trailing-stop / stop-loss /
        // urgency-market-sell).
        const gasMultiplier = reason === 'anti-rug' ? ctx.chain.antiRug.gasMultiplier : undefined;

        const gasLimit = ctx.chain.gas.maxGasLimit;

        // Build txBuilder for MEV-protected submission. The private-leg approval
        // signs a tx, so it routes through withNonceLock too (D-NONCE-AUTHORITY-ALL
        // — EVERY signing site, including approvals).
        let txBuilder: () => Promise<TransactionRequest>;
        if (dex.dexType === 'v3' && feeTier != null) {
            await withNonceLock(ctx.wallet.address, () => ensureApproval(token, dex.swapRouterAddress, balance, ctx.wallet.address));
            txBuilder = buildV3SellTx(dex, tokenAddress, ctx.chain.wethAddress, ctx.wallet.address, balance, feeTier, gasLimit);
        } else if (dex.dexType === 'v2') {
            await withNonceLock(ctx.wallet.address, () => ensureApproval(token, dex.routerAddress, balance, ctx.wallet.address));
            txBuilder = buildV2SellTx(dex, tokenAddress, ctx.chain.wethAddress, ctx.wallet.address, balance, gasLimit);
        } else {
            ctx.log.error({ token: tokenAddress, dexType: dex.dexType }, 'Unknown DEX type for sell');
            return false;
        }

        // ---------------------------------------------------------------------
        // Finding A inclusion ladder (Phase 21.2 / Plan 21.2-06): private escalate
        // → no-double-sell guard → public-mempool fallback. The ladder resolves to
        // a real on-chain tx hash (or null for a no-new-tx close, e.g. the private
        // bundle landed late or the balance is already 0), plus the amount actually
        // sold (`soldAmountIn`).
        // ---------------------------------------------------------------------
        ctx.log.info({ token: tokenAddress, reason, op: 'exit.full.submitted' }, 'Submitting exit sell via MEV-protected path');
        // Phase 19 / Plan 19-05 — D-VIS-LIVE-EXIT prefixes the live anti-rug
        // alert with `*[ANTI-RUG EXIT]*`. Existing reasons keep the prior
        // `*{reason}:*` heading shape (unchanged behavior).
        const alertHeader = reason === 'anti-rug' ? '*[ANTI-RUG EXIT]*' : `*${reason}:*`;
        await sendCtxAlert(ctx, `${alertHeader} ${reasonDetail}`);

        let txHash: string | null = null;
        let soldAmountIn: bigint = balance;

        // (1) PRIVATE escalation with the INDEPENDENT sell-leg ceiling, reason-aware
        // attempt budget (anti-rug → 1 quick attempt; routine → MEV_SELL_FALLBACK_
        // ATTEMPTS). escalatePrivateSell normalizes not-landed into a structured
        // result (it does NOT throw) so the ladder can fall through to the public
        // fallback — the GUARANTEED inclusion lever (D-EXIT-INCLUSION).
        const attempts = privateAttemptBudget(reason);
        const priv = await escalatePrivateSell(txBuilder, ctx, attempts, gasMultiplier);

        if (priv.landed && priv.txHash) {
            // The private bundle landed (possibly late-reconciled by 21.1). Done.
            txHash = priv.txHash;
            ctx.log.info({ token: tokenAddress, reason, txHash, op: 'exit.full.private-landed' }, 'Private exit bundle landed');
        } else {
            // (2) NO-DOUBLE-SELL GUARD before going public (D-FALLBACK-NO-DOUBLE-SELL).
            // (2a) Reconcile the last private attempt against chain state. CR-02 fix
            // (21.2-12): priv.lastSignedHash/lastNonce are now the ACTUALLY-BROADCAST
            // tx the strategy sent (surfaced via the BroadcastHandle side-channel) —
            // NOT a throwaway local pre-sign — so reconcileInclusion probes a hash
            // that REALLY hit the chain and can actually detect a late land.
            //   * 'included'        → the private bundle landed late (the LADYS /
            //                         STOP-THE-LINE-02 false-negative class). ABORT the
            //                         public fallback and treat it as a landed sell.
            //   * 'landed-not-ours' → the nonce was consumed but our hash has no
            //                         receipt yet — we CANNOT prove our private sell
            //                         did NOT land. FAIL SAFE toward not-selling-twice
            //                         (CR-02 interim mitigation): do NOT run the public
            //                         fallback on the optimistic balanceOf snapshot;
            //                         keep monitoring (balanceOf truth re-decides
            //                         teardown). A double-sell is the unrecoverable
            //                         harm; a delayed retry is recoverable.
            //   * 'reverted'/'not-landed' → fall through to the balanceOf-truth guard
            //                         (2b): the sell genuinely did not consume the
            //                         tokens, so the re-fetched held balance is the
            //                         authoritative amount to sell.
            // A bounded window/poll from the sell-leg reconcile config.
            let privateInclusionInconclusive = false;
            if (priv.lastSignedHash && priv.lastNonce != null) {
                const rcfg = buildReconcileConfig(process.env, ctx.chain.gas.maxGasLimit, attempts, 'sell');
                const recon = await reconcileInclusion(
                    priv.lastSignedHash, priv.lastNonce, ctx.wallet, ctx.httpProvider, rcfg.confirmWindowMs, rcfg.pollMs,
                );
                if (recon.outcome === 'included') {
                    txHash = recon.hash ?? priv.lastSignedHash;
                    ctx.log.info(
                        { token: tokenAddress, reason, txHash, op: 'exit.fallback.aborted.late-land' },
                        'No-double-sell guard: the private bundle landed late — aborting the public fallback',
                    );
                    await sendCtxAlert(
                        ctx,
                        `*[EXIT GUARD]* ${reason}: private bundle landed late (reconciled) — public fallback ABORTED ` +
                        `to prevent a double-sell.`,
                    );
                } else if (recon.outcome === 'landed-not-ours') {
                    // The submitted nonce was consumed but our broadcast hash has no
                    // receipt. We cannot prove the private sell did NOT land →
                    // FAIL SAFE: do NOT run the public fallback (a double-sell is the
                    // unrecoverable harm). Keep the position held + monitored; the
                    // next poll (or anti-rug) re-evaluates against balanceOf truth.
                    privateInclusionInconclusive = true;
                    ctx.log.warn(
                        { token: tokenAddress, reason, signedTxHash: priv.lastSignedHash, submittedNonce: priv.lastNonce, op: 'exit.fallback.failsafe.inconclusive' },
                        'No-double-sell guard: private inclusion INCONCLUSIVE (landed-not-ours) — failing SAFE, NOT running the public fallback (avoid double-sell)',
                    );
                    await sendCtxAlert(
                        ctx,
                        `*[EXIT GUARD]* ${reason}: private inclusion is INCONCLUSIVE (nonce consumed, our receipt not visible) — ` +
                        `public fallback DEFERRED to avoid a double-sell. Position stays held + monitored; it will retry on the next ` +
                        `poll cycle (anti-rug always still fires). Remediation: inspect whether the private sell landed.`,
                    );
                }
            }

            // CR-02 fail-safe (NF-01): an inconclusive private inclusion must NOT
            // proceed to the public fallback (a double-sell is the unrecoverable harm).
            // But do NOT bare-return — for an anti-rug exit the poll timer was cleared
            // BEFORE the sell (exitTrigger) and is never re-armed by a bare return, and
            // exit_failed_held is never persisted, so the still-held position would be
            // stranded at runtime AND dropped on restart (regressing S-1 / T-21.2-DROPRUG).
            // Apply the SAME balanceOf-truth teardown as the still-held/catch paths:
            // genuine close → tear down; still held → keep anti-rug + RE-ARM the poll
            // timer + persist exit_failed_held. The public fallback stays skipped either way.
            if (privateInclusionInconclusive) {
                const heldNow: bigint = await token.balanceOf(ctx.wallet.address);
                const dustNow = computeDustThreshold(readOriginalTokenAmount(tradeId));
                if (heldNow <= dustNow) {
                    // The nonce-consuming tx actually closed the position (our private
                    // sell landed after all) — tear down as a genuine close.
                    teardownGenuineClose(ctx, tokenAddress, tradeId);
                    return true;
                }
                // Still held → KEEP anti-rug + re-arm the poll timer + persist
                // exit_failed_held (restart-resumable), exactly like the still-held path.
                await keepMonitoringFailedHeld(ctx, dex, tokenAddress, feeTier, reason, tradeId, heldNow);
                return false;
            }

            // (2b) If still not resolved, balanceOf is the authoritative truth.
            // Re-fetch the on-chain held balance and sell ONLY what is still held.
            if (txHash === null) {
                const held: bigint = await token.balanceOf(ctx.wallet.address);
                if (held === 0n) {
                    // Already sold (private landed, or a manual/competing sell). Abort
                    // the public fallback — nothing to sell (T-21.2-SELLNOTHING).
                    ctx.log.info(
                        { token: tokenAddress, reason, op: 'exit.fallback.aborted.zero-held' },
                        'No-double-sell guard: re-fetched balance is 0 — aborting the public fallback (already sold)',
                    );
                    await sendCtxAlert(
                        ctx,
                        `*[EXIT GUARD]* ${reason}: re-fetched balance is 0 — public fallback ABORTED (position already closed).`,
                    );
                    // txHash stays null; the success teardown below treats it as a close.
                    soldAmountIn = 0n;
                } else if (dex.dexType === 'v2') {
                    // (3) PUBLIC-MEMPOOL FALLBACK (the GUARANTEED exit). Sell ONLY the
                    // re-fetched held balance via the fee-on-transfer-safe router call,
                    // reason-aware slippage, every submit nonce-locked.
                    soldAmountIn = held;
                    txHash = await executePublicFallbackSell(ctx, dex, token, tokenAddress, held, reason);
                } else {
                    // V3 has no fee-on-transfer-safe public router analog wired here;
                    // surface loudly rather than silently strand (D-ALERTS). The
                    // position stays held + monitored (the catch does not run on this
                    // return; 21.2-07 gates teardown on balanceOf).
                    ctx.log.error(
                        { token: tokenAddress, reason, dexType: dex.dexType, op: 'exit.fallback.unsupported-dex' },
                        'Public-mempool fallback is V2-only; private escalation did not land for a V3 position',
                    );
                    await sendCtxAlert(
                        ctx,
                        `*[EXIT FALLBACK UNAVAILABLE]* ${reason}: V3 position did not land privately and the public ` +
                        `fee-on-transfer fallback is V2-only. Position stays held + monitored — inspect manually.`,
                    );
                    return false;
                }
            }
        }

        // op:exit.full.executed names the success-criterion-4 op. D-OP-DB-TRUTH:
        // this log is for FILTERING confirmed-exit events, NOT proof an exit happened
        // — the ground truth is the trades.amount_out row + the on-chain receipt below.
        ctx.log.info({ token: tokenAddress, reason, txHash, op: 'exit.full.executed' }, 'Exit sell TX confirmed');

        // Decode receipt for amountOut, gasCost, blockNumber (D-01, D-03, D-06).
        // sendTxWithRetry has a single multi-chain dispatch path that delegates
        // to the per-chain MevStrategy and always returns a real on-chain tx hash
        // (Promise<string>); the legacy single-chain Flashbots branch that could
        // return void was deleted in Phase 21.1 (D-DELETE-LEGACY). The `if (txHash)`
        // guard below is now belt-and-suspenders against a strategy returning an
        // empty string, not the removed void path.
        let receiptData: { amountOut: string | null; gasCost: string | null; blockNumber: number | null } = {
            amountOut: null,
            gasCost: null,
            blockNumber: null,
        };
        if (txHash) {
            receiptData = await decodeReceipt(txHash, ctx.httpProvider, ctx.chain.wethAddress, ctx.wallet.address);
            // op:exit.receipt.decoded makes receipt decoding filterable (EXIT-LIVE-10).
            // D-OP-DB-TRUTH: this log MUST NOT be read as exit-success proof — the DB
            // trades.amount_out row + on-chain receipt remain the only ground truth.
            ctx.log.info({
                token: tokenAddress,
                txHash,
                amountOut: receiptData.amountOut,
                blockNumber: receiptData.blockNumber,
                op: 'exit.receipt.decoded',
            }, 'Exit sell receipt decoded');
        }

        // Record sell trade
        insertTrade.run({
            token: tokenAddress.toLowerCase(),
            chain: ctx.chain.name,
            action: 'sell',
            txHash: txHash || null,
            block: receiptData.blockNumber,
            timestamp: Math.floor(Date.now() / 1000),
            // Finding A: the recorded amountIn is what was ACTUALLY sold — the
            // original balance for a private-landed sell, or the re-fetched held
            // balance for a public-mempool fallback (sell-only-held). 0n when the
            // guard aborted a fallback on an already-closed position.
            amountIn: soldAmountIn.toString(),
            amountOut: receiptData.amountOut,
            gasCost: receiptData.gasCost,
            priceAtAction: null,
            status: 'sold',
            poolType: dex.dexType,
            feeTier: feeTier,
            dexName: dex.name,
        });
        // Finding D balance-truth teardown (D-BALANCE-IS-TRUTH) — SUCCESS PATH.
        // Even on the "success" path the submit-report can lie (a fee-on-transfer
        // remainder, a partial fill, a late-landed bundle that only sold part).
        // Re-fetch balanceOf and let it — not the report — decide teardown. <=
        // dust → genuine close; > dust → still held (keep anti-rug + re-arm
        // timer + persist exit_failed_held).
        const postSellBalance: bigint = await token.balanceOf(ctx.wallet.address);
        const dust = computeDustThreshold(readOriginalTokenAmount(tradeId));
        if (postSellBalance <= dust) {
            teardownGenuineClose(ctx, tokenAddress, tradeId);
            const confirmHeader = reason === 'anti-rug' ? '*[ANTI-RUG EXIT] confirmed*' : `*${reason} confirmed*`;
            await sendCtxAlert(ctx, confirmHeader);
            return true;
        }
        // The sell "succeeded" but the position is STILL HELD (dust check). Keep
        // monitoring rather than tear down — the trade row already recorded the
        // partial sell above; the position keeps anti-rug + a poll timer.
        await keepMonitoringFailedHeld(ctx, dex, tokenAddress, feeTier, reason, tradeId, postSellBalance);
        return false;
    } catch (e) {
        ctx.log.error({ err: e, token: tokenAddress, reason, op: 'exit.full.failed' }, 'Exit sell failed');
        // Finding D balance-truth teardown (D-FAILED-EXIT-KEEP-MONITORING +
        // D-BALANCE-IS-TRUTH) — CATCH PATH. The OLD code unconditionally tore
        // down here (updateTradeStatus('failed') + clearAllTimersForToken +
        // deleteExitState + unsubscribeAntiRug), STRIPPING rug protection from a
        // still-held position (the LADYS harm). Now the on-chain balanceOf gates
        // the decision: re-fetch it (the only signal that did not lie) and only
        // tear down when the position is genuinely closed.
        //
        // PRESERVE the `e instanceof Error ? e.message : String(e)` guard:
        // Flashbots bundle.wait() rejects with a BARE STRING, not an Error
        // (RESEARCH Finding B root cause). The error message is computed up front
        // so it is available on either branch.
        const errMsg = e instanceof Error ? e.message : String(e);
        let heldBalance: bigint;
        try {
            const token = new Contract(tokenAddress, ERC20_ABI, ctx.wallet);
            heldBalance = await token.balanceOf(ctx.wallet.address);
        } catch (balErr) {
            // The re-fetch ITSELF failed (RPC down mid-failure). FAIL SAFE toward
            // "still held" — NEVER tear down rug protection on a balance we could
            // not confirm as zero. Treat as held with a sentinel non-zero balance.
            ctx.log.error(
                { err: balErr, token: tokenAddress, reason, tradeId, op: 'exit.failed.balance-refetch-failed' },
                'Could not re-fetch balanceOf after a failed exit — failing safe to KEEP monitoring (never strip protection on an unknown balance)',
            );
            heldBalance = -1n; // sentinel: unknown but assumed held (definitely > dust)
        }

        const dust = computeDustThreshold(readOriginalTokenAmount(tradeId));
        if (heldBalance >= 0n && heldBalance <= dust) {
            // GENUINE close confirmed by balanceOf (the submit threw, but the
            // position is actually closed — e.g. a late-landed sell + a throwing
            // post-step). Tear down exactly as a real close.
            ctx.log.info(
                { token: tokenAddress, reason, tradeId, heldBalance: heldBalance.toString(), op: 'exit.failed.but-closed' },
                'Exit threw but balanceOf confirms the position is CLOSED — tearing down',
            );
            // teardownGenuineClose marks the trade 'sold' (the position is closed,
            // not failed) + clears timers + deletes exit_state + unsubscribes.
            teardownGenuineClose(ctx, tokenAddress, tradeId);
            const failHeader = reason === 'anti-rug' ? '*[ANTI-RUG EXIT]* sell reported failure but position closed' : `*${reason}* sell reported failure but position closed`;
            await sendCtxAlert(ctx, `${failHeader}: ${errMsg}`);
            return false;
        }

        // STILL HELD (balanceOf > dust, or unknown/sentinel). KEEP anti-rug + the
        // poll timer + persist exit_failed_held (the crown-jewel invariant). Mark
        // the trades row 'failed' for operator visibility — but do NOT delete
        // exit_state and do NOT unsubscribe anti-rug.
        updateTradeStatus.run('failed', tokenAddress.toLowerCase(), ctx.chain.name);
        await keepMonitoringFailedHeld(ctx, dex, tokenAddress, feeTier, reason, tradeId, heldBalance);
        const failHeader = reason === 'anti-rug' ? '*[ANTI-RUG EXIT] sell failed:*' : `*${reason} sell failed:*`;
        await sendCtxAlert(ctx, `${failHeader} ${errMsg}`);
        return false;
    } finally {
        releaseSellLock(ctx.chain.name, tokenAddress);
    }
}

// ---------------------------------------------------------------------------
// ExitWorker — serial priority-queue drainer (Phase 21.2 / Finding C)
// D-DECOUPLE-SERIAL-WORKER + D-EXIT-PRIORITY
// ---------------------------------------------------------------------------
//
// THE PROBLEM (Finding C): the 4-attempt sell reconciliation used to run
// synchronously INSIDE pollExitStrategy, blocking the WHOLE poll cycle for
// ~222s (exit.poll.cycle overruns:true). With multiple open positions, NONE
// were polled or exited during that window — one exit's retries starved every
// other position's monitoring.
//
// THE FIX: a poll tick that detects a trigger ENQUEUES {tradeId, reason,
// priority} and returns 'continue' IMMEDIATELY (cadence preserved). A SINGLE
// serial ExitWorker drains a priority queue, submitting ONE sell at a time:
//   * serial-by-construction → nonce-safe for the single wallet (no two submits
//     ever contend for the nonce). SINGLE-LEVEL LOCKING (21.2-12 / CR-01 fix):
//     the drain does NOT wrap the submit in an OUTER withNonceLock — that caused
//     a re-entrant deadlock against executeFullSell's own per-signing-site locks
//     (a non-reentrant promise-chain mutex; the inner acquire chained behind the
//     still-pending outer run, which could not settle until the inner resolved).
//     The authority layer is enforced WHERE the signing happens — every signing
//     site inside executeFullSell (approval, public fallback, partial submit) is
//     individually wrapped in withNonceLock(ctx.wallet.address, ...).
//   * a per-position lock (tryEnqueuePosition/releasePositionQueue in
//     exitManager.ts) prevents the SAME position being enqueued/sold twice
//     (no re-entrant self-sell).
//
// Priority (reason → rank): urgency-market-sell(1) = stop-loss(1) >
// trailing-stop(2). The queue orders the THREE ROUTINE triggers against each
// other (urgency/stop-loss before trailing).
//
// WR-03 (21.2-13) — ANTI-RUG IS NOT QUEUED. The anti-rug exit runs on a DIRECT,
// wall-clock-BOUNDED path (anti-rug/exitTrigger.ts → bounded executeFullSell),
// NOT through this worker — deliberately, for immediacy (a rug is happening NOW;
// routing it behind possibly-queued routine exits would delay the most
// time-critical exit). Rank 0 is therefore RESERVED but NOT EXERCISED in
// production: nothing enqueues an 'anti-rug' item, so the "late anti-rug jumps the
// queue" pre-emption never occurs. (Earlier comments claimed it did — corrected
// here to match the code.) WR-02 bounds the direct anti-rug path with the same
// WATCHDOG_BUDGET_MS the worker watchdog uses, so it is liveness-bounded WITHOUT
// being queued. partial-sell is decoupled to a dedicated non-blocking submit
// (WR-06) — also not via this worker — so rank 3 is likewise reserved/unused here.
//
// This plan ships the worker + queue + per-position lock + poll-tick
// conversion. It does NOT change WHAT executeFullSell does on submit — the
// inclusion ladder (21.2-06) and the balance-truth catch (21.2-07) build on
// this same drain path, sequenced after.

/** Exit reasons the worker can submit (mirrors executeFullSell's reason union). */
export type ExitReason = 'trailing-stop' | 'stop-loss' | 'urgency-market-sell' | 'anti-rug';

/** A queued exit: everything the drain loop needs to call executeFullSell. */
export interface ExitWorkItem {
    ctx: ChainContext;
    dex: DexConfig;
    chain?: string;            // optional convenience; ctx.chain.name is canonical
    tokenAddress: string;
    feeTier: number | null;
    tradeId: number;
    reason: ExitReason;
    reasonDetail: string;
    priority?: number;         // explicit override; otherwise derived from reason
}

/**
 * reason → priority rank (lower = drained first). urgency and stop-loss share
 * rank 1; trailing-stop is rank 2 (drained after them).
 *
 * WR-03 (21.2-13): rank 0 ('anti-rug') is RESERVED but NOT EXERCISED — the
 * anti-rug exit runs on the direct, wall-clock-bounded path (exitTrigger.ts), NOT
 * through this worker, so nothing ever enqueues an 'anti-rug' item. The mapping
 * is kept here (single source of truth for ExitReason → rank) for completeness
 * and so that IF a future plan chose to enqueue anti-rug it would pre-empt
 * correctly; today the queue only ever ranks the three routine triggers.
 */
function reasonRank(reason: ExitReason): number {
    switch (reason) {
        case 'anti-rug': return 0;   // reserved — anti-rug is NOT queued (WR-03)
        case 'urgency-market-sell': return 1;
        case 'stop-loss': return 1;
        case 'trailing-stop': return 2;
        default: return 3;
    }
}

/**
 * The signature of the sell executor the worker drives. Production binds this to
 * the real `executeFullSell`; tests substitute a controllable executor via
 * `_setSellExecutorForTesting` to observe serialization/priority/lock effects
 * without driving the full MEV submit path.
 */
type SellExecutor = (item: ExitWorkItem) => Promise<boolean>;

/**
 * The watchdog wrapper the drain loop applies around each per-item submit
 * (Phase 21.2-09 / Finding B, D-WATCHDOG-ABORT). It receives the work item (so
 * it can use the item's own ctx/log for a per-chain alert) and a thunk that
 * runs the (nonce-locked) submit. A budget-overrunning submit is freed via
 * `Promise.race` and the wrapper resolves (e.g. to `false`) so the drain loop
 * KEEPS the bot alive moving to the next queued exit; the stuck position stays
 * held + monitored (21.2-07). The default below is identity (no bounding) so the
 * worker is fully functional even before bot.ts installs the real watchdog and
 * so the worker's own unit tests are unaffected.
 */
export type ExitWatchdog = (item: ExitWorkItem, op: () => Promise<boolean>) => Promise<boolean>;

const identityWatchdog: ExitWatchdog = (_item, op) => op();

const realSellExecutor: SellExecutor = (i) =>
    executeFullSell(i.ctx, i.dex, i.tokenAddress, i.feeTier, i.reason, i.tradeId, i.reasonDetail);

class ExitWorker {
    /** Priority queue kept sorted ascending by rank; stable within a rank (FIFO). */
    private readonly queue: { item: ExitWorkItem; rank: number; seq: number }[] = [];
    private running = false;
    private seq = 0;
    private executor: SellExecutor = realSellExecutor;
    /** Liveness net around each submit (D-WATCHDOG-ABORT); identity until wired. */
    private watchdog: ExitWatchdog = identityWatchdog;

    /** Test seam — substitute the sell executor. */
    setExecutor(fn: SellExecutor): void {
        this.executor = fn;
    }

    /**
     * Install the wall-clock watchdog wrapper applied around each submit
     * (bot.ts owns the policy: budget, Promise.race abort, alert). Process-level
     * liveness is a bot-orchestrator concern (RESEARCH responsibility map), so
     * the worker only exposes the seam; it does not own the budget/alerting.
     */
    setWatchdog(fn: ExitWatchdog): void {
        this.watchdog = fn;
    }

    /** Test seam — reset to a clean state between tests. */
    reset(): void {
        this.queue.length = 0;
        this.running = false;
        this.seq = 0;
        this.executor = realSellExecutor;
        this.watchdog = identityWatchdog;
    }

    /**
     * Enqueue an exit. Skips (returns false) if this position is already
     * queued/in-flight (per-position lock). Otherwise inserts by priority and
     * kicks the drain loop if idle. Returns true if the item was enqueued.
     */
    enqueue(item: ExitWorkItem): boolean {
        const chain = item.ctx.chain.name;
        // Per-position lock: held across the ENTIRE enqueue→drain→settle lifetime
        // (released in the drain loop's finally) so a later poll tick cannot
        // re-enqueue the same position → no re-entrant self-sell.
        if (!tryEnqueuePosition(chain, item.tokenAddress)) {
            item.ctx.log.info(
                { token: item.tokenAddress, reason: item.reason, op: 'exit.worker.skip-duplicate' },
                'Position already queued/in-flight, skipping duplicate enqueue',
            );
            return false;
        }

        const rank = item.priority ?? reasonRank(item.reason);
        const entry = { item, rank, seq: this.seq++ };
        // Insert maintaining ascending rank, FIFO within a rank (stable).
        let i = this.queue.length;
        while (i > 0 && this.queue[i - 1].rank > rank) i--;
        this.queue.splice(i, 0, entry);

        item.ctx.log.info(
            { token: item.tokenAddress, reason: item.reason, rank, queueDepth: this.queue.length, op: 'exit.worker.enqueued' },
            'Exit enqueued',
        );

        if (!this.running) {
            // Kick the drain loop. We deliberately do NOT await it here — the
            // caller (a poll tick) must return immediately (Finding C).
            void this.drain();
        }
        return true;
    }

    /**
     * Drain loop: dequeue the highest-priority item, submit ONE sell (bounded by
     * the watchdog), release the per-position lock, then continue — strictly one
     * sell at a time. A failed/thrown submit never breaks the loop; the
     * per-position lock is always released in finally.
     */
    private async drain(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            while (this.queue.length > 0) {
                const { item } = this.queue.shift()!;
                const chain = item.ctx.chain.name;
                try {
                    // SINGLE-LEVEL LOCKING (Phase 21.2-12 / CR-01 fix). The worker
                    // does NOT wrap the executor in withNonceLock. executeFullSell
                    // (the default executor) already routes EVERY one of its signing
                    // sites — the private-leg approval (exitEngine.ts:826/829), the
                    // public-fallback approval + swap (executePublicFallbackSell:
                    // 529/538), and executePartialSell's approval + submit — through
                    // withNonceLock(ctx.wallet.address, ...) INTERNALLY. The serial
                    // drain is additionally nonce-safe by construction (one submit at
                    // a time), so the per-wallet authority invariant holds without an
                    // OUTER lock here.
                    //
                    // WHY DOUBLE-LOCKING DEADLOCKS (the CR-01 regression this fixes):
                    // withNonceLock is a NON-REENTRANT promise-chain mutex
                    // (nonceAuthority.ts). If the drain took the wallet's lock for the
                    // WHOLE submit, executeFullSell's inner acquire of the SAME wallet
                    // lock (for its approval / fallback) would chain `.then(op)` behind
                    // the still-pending OUTER run promise — but that outer promise
                    // cannot settle until executeFullSell returns, which is itself
                    // awaiting the inner op → PERMANENT DEADLOCK on every worker-driven
                    // routine exit. The watchdog would free the drain loop, but the
                    // orphaned executeFullSell would never reach its
                    // finally{releaseSellLock}, stranding the per-token sell-lock and
                    // blocking even the DIRECT anti-rug emergency exit for that token.
                    //
                    // The watchdog stays at the worker level (so the whole submit is
                    // wall-clock-bounded — D-WATCHDOG-ABORT) but OUTSIDE any nonce
                    // lock. A budget overrun frees the drain loop; the next queued
                    // exit's own internal locks serialize it correctly. Identity
                    // watchdog until bot.ts installs the real one, so the worker is
                    // correct standalone.
                    await this.watchdog(item, () => this.executor(item));
                } catch (e) {
                    item.ctx.log.error(
                        { err: e, token: item.tokenAddress, reason: item.reason, op: 'exit.worker.submit-failed' },
                        'Exit worker submit failed (loop continues)',
                    );
                } finally {
                    // Release the per-position lock AFTER the sell fully settles
                    // so a future genuine re-trigger can enqueue again.
                    releasePositionQueue(chain, item.tokenAddress);
                }
            }
        } finally {
            this.running = false;
            // A late enqueue that arrived after the while-condition saw an empty
            // queue but before running flipped false would otherwise stall; re-
            // check and restart the loop if anything slipped in.
            if (this.queue.length > 0) void this.drain();
        }
    }
}

const exitWorker = new ExitWorker();

/**
 * Enqueue an exit for the serial worker (Finding C). A poll tick that detects a
 * trigger calls this and returns 'continue' immediately — it NEVER awaits the
 * sell inline. The worker drains by priority (anti-rug first), one nonce-locked
 * sell at a time, with a per-position lock preventing re-entrant self-sell.
 *
 * @returns true if the exit was enqueued; false if skipped as a duplicate
 *          (position already queued/in-flight).
 */
export function enqueueExit(item: ExitWorkItem): boolean {
    return exitWorker.enqueue(item);
}

/** Test-only: substitute the worker's sell executor (observability seam). */
export function _setSellExecutorForTesting(fn: (item: ExitWorkItem) => Promise<boolean>): void {
    exitWorker.setExecutor(fn);
}

/**
 * Install the wall-clock watchdog wrapper applied around each worker submit
 * (Phase 21.2-09 / Finding B, D-WATCHDOG-ABORT). bot.ts owns the policy (budget,
 * Promise.race abort, Telegram alert) and installs it once at startup; the
 * worker only holds the seam. Default behavior (before install) is identity —
 * the worker is fully functional unbounded, the watchdog only ADDS the liveness
 * net.
 */
export function setExitWorkerWatchdog(fn: ExitWatchdog): void {
    exitWorker.setWatchdog(fn);
}

/** Test-only: install a watchdog wrapper for observability tests. */
export function _setExitWatchdogForTesting(fn: ExitWatchdog): void {
    exitWorker.setWatchdog(fn);
}

/** Test-only: reset the worker to a clean state between tests. */
export function _resetExitWorkerForTesting(): void {
    exitWorker.reset();
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

        // Build txBuilder for MEV-protected submission. Phase 21.2-07
        // (D-NONCE-AUTHORITY-ALL): the partial-sell approval is a signing tx, so
        // it routes through withNonceLock — EVERY signing site is serialized by
        // the per-wallet nonce authority (RESEARCH Q4 lists executePartialSell +
        // its ensureApproval explicitly). Without this, a partial-sell approval
        // could contend for the nonce with a concurrent full-exit/buy.
        let txBuilder: () => Promise<TransactionRequest>;
        if (dex.dexType === 'v3' && feeTier != null) {
            await withNonceLock(ctx.wallet.address, () => ensureApproval(token, dex.swapRouterAddress, actualSellAmount, ctx.wallet.address));
            txBuilder = buildV3SellTx(dex, tokenAddress, ctx.chain.wethAddress, ctx.wallet.address, actualSellAmount, feeTier, gasLimit);
        } else if (dex.dexType === 'v2') {
            await withNonceLock(ctx.wallet.address, () => ensureApproval(token, dex.routerAddress, actualSellAmount, ctx.wallet.address));
            txBuilder = buildV2SellTx(dex, tokenAddress, ctx.chain.wethAddress, ctx.wallet.address, actualSellAmount, gasLimit);
        } else {
            ctx.log.error({ token: tokenAddress }, 'Unknown DEX type for partial sell');
            return false;
        }

        const tierLabels = tiers.map(t => `${t.tier.multiple}x:${t.tier.percent}%`).join('+');
        ctx.log.info({ token: tokenAddress, tiers: tierLabels, op: 'exit.partial.submitted' }, 'Submitting partial sell via MEV-protected path');
        await sendCtxAlert(ctx, `*Partial sell:* ${tierLabels} at ${currentMultiple.toFixed(2)}x`);

        // Submit via sendTxWithRetry for MEV protection, nonce-locked so the
        // submit serializes with every other signing site (D-NONCE-AUTHORITY-ALL).
        // The partial-sell catch (below, Pitfall 6) already leaves the position
        // OPEN on failure — it does NOT tear down anti-rug or delete exit_state —
        // so it inherits the no-double-sell + balance-truth posture: a failed
        // partial sell simply retries on the next poll cycle (the clamp to the
        // re-fetched balance prevents selling more than is held). Verified by
        // antiRugReason.test.ts Test 7 (source) + Test 8 (runtime).
        const txHash = await withNonceLock(ctx.wallet.address, () => sendTxWithRetry(txBuilder, ctx));

        ctx.log.info({ token: tokenAddress, tiers: tierLabels, txHash, op: 'exit.partial.executed' }, 'Partial sell TX confirmed');

        // Decode receipt for amountOut, gasCost, blockNumber (D-01, D-03, D-06).
        // sendTxWithRetry always returns a real on-chain tx hash (Promise<string>)
        // via the multi-chain strategy dispatch; the legacy void path was deleted
        // in Phase 21.1 (D-DELETE-LEGACY). The `if (txHash)` guard is belt-and-
        // suspenders against an empty-string hash, not the removed void path.
        let receiptData: { amountOut: string | null; gasCost: string | null; blockNumber: number | null } = {
            amountOut: null,
            gasCost: null,
            blockNumber: null,
        };
        if (txHash) {
            receiptData = await decodeReceipt(txHash, ctx.httpProvider, ctx.chain.wethAddress, ctx.wallet.address);
        }

        // D-10: Record each partial sell as separate trade row
        insertTrade.run({
            token: tokenAddress.toLowerCase(),
            chain: ctx.chain.name,
            action: 'partial_sell',
            txHash: txHash || null,
            block: receiptData.blockNumber,
            timestamp: Math.floor(Date.now() / 1000),
            amountIn: actualSellAmount.toString(),
            amountOut: receiptData.amountOut,
            gasCost: receiptData.gasCost,
            priceAtAction: currentMultiple.toString(),
            status: 'sold',
            poolType: dex.dexType,
            feeTier: feeTier,
            dexName: dex.name,
        });

        // Mark tiers as completed (D-11: high-water mark NOT reset)
        for (const { index } of tiers) {
            state.completedTierIndices.add(index);
        }
        // NF-03: persist the completed tiers SYNCHRONOUSLY here — in the same
        // continuation as the on-chain confirm + the in-memory mutation above —
        // so a crash before the detached dispatcher's `.then` (or the next poll
        // tick's step-8 persist) cannot re-sell an already-completed tier on restart.
        upsertExitState.run(serializeExitState(state));

        const totalPctSold = tiers.reduce((sum, t) => sum + t.tier.percent, 0);
        const remainingPct = 100 - Array.from(state.completedTierIndices).reduce((sum, i) => {
            const tier = exitConfig.partialSellTiers[i];
            return tier ? sum + tier.percent : sum;
        }, 0);

        await sendCtxAlert(ctx, `*Partial sell confirmed:* sold ${totalPctSold}% | Remaining: ${remainingPct}% trailing`);
        return true;
    } catch (e) {
        // Pitfall 6: partial sell failure does NOT kill exit monitor
        ctx.log.warn({ err: e, token: tokenAddress, op: 'exit.partial.failed' }, 'Partial sell failed, will retry next cycle');
        return false;
    } finally {
        releaseSellLock(ctx.chain.name, tokenAddress);
    }
}

// ---------------------------------------------------------------------------
// dispatchPartialSell — NON-BLOCKING partial-sell dispatch (Phase 21.2-13 / WR-06)
// ---------------------------------------------------------------------------
//
// WR-06: executePartialSell was `await`ed INLINE on the poll tick. It calls
// sendTxWithRetry → submitWithReconciliation, which polls a bounded confirm window
// (default 45s) PER attempt, so a partial-sell trigger BLOCKED that position's
// poll cycle (and serialized on withNonceLock) for tens of seconds — reintroducing
// the overruns:true poll-loop starvation Finding C removed, for partial sells.
//
// THE FIX (mirrors the full-sell triggers' enqueue-and-return): the poll tick
// calls this and RETURNS 'continue' immediately — it never awaits the confirm
// window inline. executePartialSell runs OFF the poll critical path. Its OWN
// guarantees are unchanged and make this safe:
//   * the per-token sell lock (tryAcquireSellLock, acquired at entry / released in
//     finally) is held for the whole submit, so a later poll tick that re-detects
//     the same unfilled tier is SKIPPED while this is in flight (no duplicate
//     partial; no re-entrant self-sell).
//   * it clamps to the RE-FETCHED on-chain balance (sell only what is held) and
//     nonce-locks the submit (D-NONCE-AUTHORITY-ALL).
//   * on success it mutates the SHARED state.completedTierIndices + records the
//     trade row; the next poll tick persists the updated tiers (and stops
//     re-detecting them). On failure it leaves the position OPEN (Pitfall 6).
//
// The detached promise is given a `.catch` so a rejection can never become an
// unhandled-rejection that crashes the process (the awaited path inside already
// try/catches; this is belt-and-suspenders for the detach boundary).
export function dispatchPartialSell(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    sellAmount: bigint,
    tiers: { tier: PartialTier; index: number }[],
    state: ExitStateData,
    currentMultiple: number,
): void {
    void executePartialSell(ctx, dex, tokenAddress, feeTier, sellAmount, tiers, state, currentMultiple)
        .then((success) => {
            if (success) {
                ctx.log.info(
                    {
                        token: tokenAddress,
                        tiers: tiers.map((t) => `${t.tier.multiple}x`).join(','),
                        priceMultiple: currentMultiple.toFixed(2),
                        op: 'exit.partial.dispatched.completed',
                    },
                    'Partial sell completed (off the poll tick)',
                );
                // Persist the tier completions the partial mutated onto `state` so a
                // restart resumes with them recorded (the poll tick that fired this
                // already returned; persist here on completion).
                upsertExitState.run(serializeExitState(state));
            }
        })
        .catch((e: unknown) => {
            ctx.log.error(
                { err: e, token: tokenAddress, op: 'exit.partial.dispatched.error' },
                'Detached partial sell rejected (position left open, will retry next cycle)',
            );
        });
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

// ---------------------------------------------------------------------------
// Unified Poll Loop & Entry Points
// ---------------------------------------------------------------------------

/**
 * Single poll cycle for a position. Evaluates all 4 exit behaviors in deterministic order:
 * 1. Query price
 * 2. Update high-water mark + volatility tracker
 * 3. Check partial sell tiers (D-06 through D-11)
 * 4. Compute effective trailing stop % (volatility + urgency)
 * 5. Check trailing stop trigger (D-01 through D-05)
 * 6. Below 2x: fixed stop-loss check
 * 7. Urgency hard exit at 30 minutes (D-16 through D-20)
 * 8. Persist state to DB
 *
 * This is called every 5 seconds per position (D-04).
 */
async function pollExitStrategy(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    buyAmountWei: bigint,
    state: ExitStateData,
): Promise<'continue' | 'exited'> {
    // Step 1: Query price
    const currentPrice = await queryPrice(ctx, dex, tokenAddress, feeTier, buyAmountWei);
    if (currentPrice === null) {
        ctx.log.debug({ token: tokenAddress }, 'Price query returned null, skipping cycle');
        return 'continue';
    }

    const priceMultiple = currentPrice / state.entryPrice;

    // Step 2: Update high-water mark (D-02) and volatility tracker (D-15)
    if (currentPrice > state.highWaterMark) {
        state.highWaterMark = currentPrice;
    }
    state.volatilityTracker.addSample(currentPrice);

    // Step 3: Detect partial sell tiers (D-06 through D-11). WR-06: the partial
    // submit runs OFF the poll critical path (dispatchPartialSell, never awaited
    // inline). NF-02: only DETECT here and DEFER the dispatch to the END of the
    // tick (after the full-exit checks). Each full-exit trigger (trailing/stop/
    // urgency) ENQUEUES + returns 'continue' BEFORE the deferred dispatch, so a
    // same-tick full exit PREEMPTS the partial (a full exit makes the partial moot
    // — it must not be silently no-op'd by the partial holding the per-token
    // sell-lock, which was the prior same-tick behavior).
    let pendingPartial: { sellAmount: bigint; unfilledTiers: { tier: PartialTier; index: number }[] } | null = null;
    if (exitConfig.partialSellTiers.length > 0) {
        const unfilledTiers = getUnfilledTiers(exitConfig.partialSellTiers, state.completedTierIndices, priceMultiple);
        if (unfilledTiers.length > 0) {
            // D-08: combine all missed tiers into a single transaction.
            pendingPartial = {
                sellAmount: calculatePartialSellAmount(state.originalTokenAmount, unfilledTiers),
                unfilledTiers,
            };
        }
    }

    // Step 4: Compute effective trailing stop %
    const volMultiplier = state.volatilityTracker.getMultiplier();
    const urgencyMult = computeUrgencyMultiplier(state.urgencyStartTs, Date.now());
    const effectivePct = computeEffectiveTrailingPct(
        exitConfig.trailingStopPct, volMultiplier, urgencyMult,
    );

    // Step 5: Check trailing stop (only active at >= 2x per D-01)
    if (state.trailingActivated) {
        const triggerPrice = state.highWaterMark * (1 - effectivePct / 100);
        if (currentPrice <= triggerPrice) {
            const detail = formatExitReason('trailing-stop', {
                entryPrice: state.entryPrice,
                highWaterMark: state.highWaterMark,
                currentPrice,
                priceMultiple,
                effectivePct,
            });
            ctx.log.info({ token: tokenAddress, detail, op: 'exit.trigger.trailing-stop' }, 'Trailing stop triggered');
            // Finding C: ENQUEUE + return immediately — never await the sell on
            // the poll critical path. The serial ExitWorker drains it (priority
            // anti-rug>urgency=stop-loss>trailing) one nonce-locked sell at a
            // time; the per-position lock skips a duplicate enqueue if this
            // position is already queued/in-flight. We return 'continue' (NOT
            // 'exited') so the interval stays armed — the position keeps polling
            // until a GENUINE close tears it down (worker/teardown, 21.2-07).
            enqueueExit({
                ctx, dex, tokenAddress, feeTier,
                tradeId: state.tradeId, reason: 'trailing-stop', reasonDetail: detail,
            });
            return 'continue';
        }
    } else if (priceMultiple >= 2.0) {
        // D-01: Activate trailing stop at 2x
        state.trailingActivated = true;
        ctx.log.info({ token: tokenAddress, priceMultiple: priceMultiple.toFixed(2), op: 'exit.trailing.activated' }, 'Trailing stop activated at 2x');
    }

    // Step 6: Below 2x: fixed stop-loss (D-01)
    if (!state.trailingActivated) {
        const fixedStopPrice = state.entryPrice * (1 - exitConfig.stopLossPct / 100);
        if (currentPrice <= fixedStopPrice) {
            const detail = formatExitReason('stop-loss', {
                entryPrice: state.entryPrice,
                highWaterMark: state.highWaterMark,
                currentPrice,
                priceMultiple,
            });
            ctx.log.info({ token: tokenAddress, detail, op: 'exit.trigger.stop-loss' }, 'Fixed stop-loss triggered');
            // Finding C: enqueue + return 'continue' (see trailing-stop note).
            enqueueExit({
                ctx, dex, tokenAddress, feeTier,
                tradeId: state.tradeId, reason: 'stop-loss', reasonDetail: detail,
            });
            return 'continue';
        }
    }

    // Step 7: Urgency hard exit at 30 minutes (D-17, D-20)
    if (urgencyMult <= 0.0) {
        const detail = formatExitReason('urgency-market-sell', {
            entryPrice: state.entryPrice,
            highWaterMark: state.highWaterMark,
            currentPrice,
            priceMultiple,
        });
        ctx.log.info({ token: tokenAddress, detail, op: 'exit.trigger.urgency' }, 'Urgency hard exit at 30min deadline');
        // Finding C: enqueue + return 'continue' (see trailing-stop note).
        enqueueExit({
            ctx, dex, tokenAddress, feeTier,
            tradeId: state.tradeId, reason: 'urgency-market-sell', reasonDetail: detail,
        });
        return 'continue';
    }

    // NF-02: dispatch the partial NOW — reaching here means NO full exit fired this
    // tick (each full-exit trigger returns 'continue' on fire), so the partial is
    // not preempted. Runs OFF the poll critical path (WR-06); the per-token
    // sell-lock still prevents a duplicate partial while one is in flight.
    if (pendingPartial) {
        dispatchPartialSell(
            ctx, dex, tokenAddress, feeTier,
            pendingPartial.sellAmount, pendingPartial.unfilledTiers, state, priceMultiple,
        );
    }

    // Step 8: Persist state to DB for restart resilience (D-23)
    upsertExitState.run(serializeExitState(state));

    ctx.log.debug({
        token: tokenAddress,
        priceMultiple: priceMultiple.toFixed(3),
        hwm: state.highWaterMark.toFixed(0),
        trailing: state.trailingActivated,
        effectivePct: effectivePct.toFixed(1),
        volMult: volMultiplier.toFixed(2),
        urgencyMult: urgencyMult.toFixed(3),
    }, 'Exit engine tick');

    return 'continue';
}

/**
 * Start unified exit monitoring for a position. Creates a single 5s setInterval
 * that handles all 4 exit behaviors (D-21). Replaces the 3 separate monitor calls
 * (monitorStopLoss + monitorTakeProfit + scheduleTimedSell) and their V3 variants.
 *
 * @param ctx - Chain context (provider, wallet, chain config)
 * @param dex - DEX config (V2 or V3 discriminated union)
 * @param tokenAddress - Token contract address
 * @param feeTier - V3 fee tier (null for V2)
 * @param buyAmountNative - Amount spent to buy (native currency string, e.g. '0.01')
 * @param tradeId - Trade row ID from DB for exit_state linkage
 * @param originalTokenAmount - Token amount received from buy (BigInt)
 */
export async function startExitMonitor(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    buyAmountNative: string,
    tradeId: number,
    originalTokenAmount: bigint,
): Promise<void> {
    const buyAmountWei = ethers.parseEther(buyAmountNative);

    // Query initial price for entry_price baseline
    const entryPrice = await queryPrice(ctx, dex, tokenAddress, feeTier, buyAmountWei);
    if (entryPrice === null) {
        ctx.log.error({ token: tokenAddress }, 'Cannot query initial price, exit monitor not started');
        return;
    }

    // Build initial state
    const state: ExitStateData = {
        tradeId,
        entryPrice,
        highWaterMark: entryPrice,
        trailingActivated: false,
        completedTierIndices: new Set(),
        originalTokenAmount,
        urgencyStartTs: Date.now(),
        volatilityTracker: new VolatilityTracker(),
    };

    // Seed volatility tracker with first sample
    state.volatilityTracker.addSample(entryPrice);

    // Persist initial state (D-23)
    upsertExitState.run(serializeExitState(state));

    ctx.log.info({
        token: tokenAddress,
        tradeId,
        entryPrice: entryPrice.toFixed(0),
        dex: dex.name,
        feeTier,
        pollMs: exitConfig.pollIntervalMs,
        trailingStopPct: exitConfig.trailingStopPct,
        tiers: exitConfig.partialSellTiers.map(t => `${t.multiple}x:${t.percent}%`).join(',') || 'none',
        op: 'exit.monitor.started',
    }, 'Exit monitor started');

    // Create the unified poll interval (D-04: 5s, D-21: single loop)
    const interval = setInterval(async () => {
        try {
            // EXIT-LIVE-01: budget-vs-actual poll telemetry. The engine runs ONE
            // setInterval PER open position, so each cycle evaluates exactly one
            // position → positions:1 (read from this loop's own scope, NOT a
            // fleet aggregate; no new module-level timer). The timing wraps the
            // EXISTING pollExitStrategy call only — no added await, no latency,
            // no control-flow change. `overruns` (plural — locked CONTEXT schema)
            // is durationMs > the configured pollIntervalMs budget.
            const t0 = performance.now();
            const result = await pollExitStrategy(ctx, dex, tokenAddress, feeTier, buyAmountWei, state);
            const durationMs = performance.now() - t0;
            ctx.log.info({
                op: 'exit.poll.cycle',
                token: tokenAddress,
                positions: 1,
                durationMs,
                budgetMs: exitConfig.pollIntervalMs,
                overruns: durationMs > exitConfig.pollIntervalMs,
            }, 'Exit poll cycle');
            // Finding C: a trigger now ENQUEUES on the serial worker and returns
            // 'continue' — so the interval STAYS ARMED (the position keeps
            // polling; the per-position lock prevents a duplicate re-enqueue
            // while the sell is queued/in-flight). The interval is cleared ONLY
            // on a GENUINE close, which becomes the worker's/teardown's job in
            // 21.2-07 (balance-is-truth catch). The 'exited' guard is retained as
            // the seam that genuine-close path will drive; on the current
            // contract pollExitStrategy returns 'continue' on every trigger so
            // this no longer fires on a sell submission (no more poll-loop
            // starvation — overruns stays false).
            if (result === 'exited') {
                clearInterval(interval);
            }
        } catch (e) {
            ctx.log.error({ err: e, token: tokenAddress }, 'Exit engine poll error');
        }
    }, exitConfig.pollIntervalMs);

    // Register in timer registry for cleanup on shutdown/external sell
    registerExitMonitor(ctx.chain.name, tokenAddress, interval);
}

/**
 * Resume exit monitoring for a pending trade after bot restart.
 * Loads exit_state from DB (D-23, D-24) and resumes the poll loop.
 * If no exit_state row exists (trade was bought before Phase 7),
 * creates initial state as if the monitor just started.
 */
export async function resumeExitMonitor(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    feeTier: number | null,
    buyAmountNative: string,
    tradeId: number,
): Promise<void> {
    const buyAmountWei = ethers.parseEther(buyAmountNative);

    // Try loading persisted state
    const row = getExitState.get(tradeId) as ExitStateRow | undefined;

    let state: ExitStateData;
    if (row) {
        state = deserializeExitState(row);
        ctx.log.info({
            token: tokenAddress,
            tradeId,
            highWaterMark: state.highWaterMark.toFixed(0),
            trailing: state.trailingActivated,
            completedTiers: Array.from(state.completedTierIndices),
            op: 'exit.monitor.resumed',
        }, 'Resumed exit monitor from DB state');
    } else {
        // No exit_state row -- trade predates Phase 7. Start fresh.
        const entryPrice = await queryPrice(ctx, dex, tokenAddress, feeTier, buyAmountWei);
        if (entryPrice === null) {
            ctx.log.error({ token: tokenAddress }, 'Cannot query price for resume, skipping');
            return;
        }

        // Get original token amount from balance (best available approximation)
        const token = new Contract(tokenAddress, ERC20_ABI, ctx.wallet);
        const balance: bigint = await token.balanceOf(ctx.wallet.address);

        state = {
            tradeId,
            entryPrice,
            highWaterMark: entryPrice,
            trailingActivated: false,
            completedTierIndices: new Set(),
            originalTokenAmount: balance,
            urgencyStartTs: Date.now(),
            volatilityTracker: new VolatilityTracker(),
        };
        state.volatilityTracker.addSample(entryPrice);
        upsertExitState.run(serializeExitState(state));

        ctx.log.info({ token: tokenAddress, tradeId, entryPrice: entryPrice.toFixed(0) }, 'Created fresh exit state for pre-Phase7 trade');
    }

    // Start poll loop (same as startExitMonitor but using loaded/created state)
    const interval = setInterval(async () => {
        try {
            // EXIT-LIVE-01: identical budget-vs-actual poll telemetry to the
            // startExitMonitor body — one setInterval per position → positions:1,
            // durationMs measured around the existing pollExitStrategy call,
            // budgetMs = the configured pollIntervalMs, overruns (plural) =
            // durationMs > budgetMs. Additive logging only; timing/control flow
            // unchanged.
            const t0 = performance.now();
            const result = await pollExitStrategy(ctx, dex, tokenAddress, feeTier, buyAmountWei, state);
            const durationMs = performance.now() - t0;
            ctx.log.info({
                op: 'exit.poll.cycle',
                token: tokenAddress,
                positions: 1,
                durationMs,
                budgetMs: exitConfig.pollIntervalMs,
                overruns: durationMs > exitConfig.pollIntervalMs,
            }, 'Exit poll cycle');
            // Finding C: a trigger now ENQUEUES on the serial worker and returns
            // 'continue' — so the interval STAYS ARMED (the position keeps
            // polling; the per-position lock prevents a duplicate re-enqueue
            // while the sell is queued/in-flight). The interval is cleared ONLY
            // on a GENUINE close, which becomes the worker's/teardown's job in
            // 21.2-07 (balance-is-truth catch). The 'exited' guard is retained as
            // the seam that genuine-close path will drive; on the current
            // contract pollExitStrategy returns 'continue' on every trigger so
            // this no longer fires on a sell submission (no more poll-loop
            // starvation — overruns stays false).
            if (result === 'exited') {
                clearInterval(interval);
            }
        } catch (e) {
            ctx.log.error({ err: e, token: tokenAddress }, 'Exit engine poll error');
        }
    }, exitConfig.pollIntervalMs);

    registerExitMonitor(ctx.chain.name, tokenAddress, interval);
}
