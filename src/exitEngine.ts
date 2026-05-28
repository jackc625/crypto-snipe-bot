// src/exitEngine.ts
// Unified exit engine for smart position management (Phase 7).
// Handles trailing stops, partial sells, volatility adaptation, and time-weighted urgency.

import { ethers, Contract } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { CONFIG } from './config';
import { logger } from './utils/logger';
import type { ChainContext, DexConfig, DexConfigV2, DexConfigV3 } from './chainRegistry';
import { ROUTER_ABI, ERC20_ABI, V3_SWAP_ROUTER_ABI, V3_QUOTER_V2_ABI } from './utils/abis';
import { tryAcquireSellLock, releaseSellLock, registerExitMonitor, clearAllTimersForToken, tryEnqueuePosition, releasePositionQueue } from './utils/exitManager';
import { withNonceLock } from './utils/nonceAuthority';
import { insertTrade, updateTradeStatus, upsertExitState, getExitState, deleteExitState } from './utils/db';
import { sendCtxAlert } from './utils/notifier';
import { sendTxWithRetry } from './utils/txManager';
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
    reason: 'trailing-stop' | 'stop-loss' | 'urgency-market-sell' | 'anti-rug',
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
            ctx.log.info({ token: tokenAddress, reason, op: 'exit.cleanup.zero-balance' }, 'Zero balance, cleaning up');
            updateTradeStatus.run('sold', tokenAddress.toLowerCase(), ctx.chain.name);
            clearAllTimersForToken(ctx.chain.name, tokenAddress);
            deleteExitState.run(tradeId);
            // Phase 19 / Plan 19-05 — terminate anti-rug subscription on every
            // full-close path per D-TERMINATION (zero-balance path).
            unsubscribeAntiRug(ctx.chain.name, tradeId);
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
        ctx.log.info({ token: tokenAddress, reason, op: 'exit.full.submitted' }, 'Submitting exit sell via MEV-protected path');
        // Phase 19 / Plan 19-05 — D-VIS-LIVE-EXIT prefixes the live anti-rug
        // alert with `*[ANTI-RUG EXIT]*`. Existing reasons keep the prior
        // `*{reason}:*` heading shape (unchanged behavior).
        const alertHeader = reason === 'anti-rug' ? '*[ANTI-RUG EXIT]*' : `*${reason}:*`;
        await sendCtxAlert(ctx, `${alertHeader} ${reasonDetail}`);
        // Phase 19 Gap-1 closure: pass gasMultiplier (defined above) through
        // the multi-chain dispatcher. undefined = raw feeData (preserves prior
        // behavior for non-anti-rug reasons). Args 3-5 (walletOrRetries,
        // useFlashbots, maxRetries) intentionally undefined for this overload;
        // sendTxWithRetry's multi-chain path uses the ChainContext directly.
        const txHash = await sendTxWithRetry(txBuilder, ctx, undefined, undefined, undefined, gasMultiplier);

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
            amountIn: balance.toString(),
            amountOut: receiptData.amountOut,
            gasCost: receiptData.gasCost,
            priceAtAction: null,
            status: 'sold',
            poolType: dex.dexType,
            feeTier: feeTier,
            dexName: dex.name,
        });
        updateTradeStatus.run('sold', tokenAddress.toLowerCase(), ctx.chain.name);
        clearAllTimersForToken(ctx.chain.name, tokenAddress);
        deleteExitState.run(tradeId);
        // Phase 19 / Plan 19-05 — terminate anti-rug subscription on every
        // full-close path per D-TERMINATION (success path).
        unsubscribeAntiRug(ctx.chain.name, tradeId);

        const confirmHeader = reason === 'anti-rug' ? '*[ANTI-RUG EXIT] confirmed*' : `*${reason} confirmed*`;
        await sendCtxAlert(ctx, confirmHeader);
        return true;
    } catch (e) {
        ctx.log.error({ err: e, token: tokenAddress, reason, op: 'exit.full.failed' }, 'Exit sell failed');
        // Full exit failure: mark failed and clean up (Pitfall 6)
        updateTradeStatus.run('failed', tokenAddress.toLowerCase(), ctx.chain.name);
        clearAllTimersForToken(ctx.chain.name, tokenAddress);
        deleteExitState.run(tradeId);
        // Phase 19 / Plan 19-05 — terminate anti-rug subscription on every
        // full-close path per D-TERMINATION (error path — failed exit still
        // closes the position-monitor lifecycle).
        unsubscribeAntiRug(ctx.chain.name, tradeId);
        const failHeader = reason === 'anti-rug' ? '*[ANTI-RUG EXIT] sell failed:*' : `*${reason} sell failed:*`;
        await sendCtxAlert(ctx, `${failHeader} ${e instanceof Error ? e.message : String(e)}`);
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
//     ever contend for the nonce). The drain ALSO wraps each submit in
//     withNonceLock(ctx.wallet.address, ...) (21.2-01) so the authority layer
//     enforces it even if a future caller enqueues from elsewhere.
//   * a per-position lock (tryEnqueuePosition/releasePositionQueue in
//     exitManager.ts) prevents the SAME position being enqueued/sold twice
//     (no re-entrant self-sell).
//
// Priority (reason → rank): anti-rug(0) > urgency-market-sell(1) =
// stop-loss(1) > trailing-stop(2). A late-arriving anti-rug jumps ahead of an
// already-queued trailing stop. (partial-sell stays on the poll tick — it is
// non-blocking and tier-bounded — so rank 3 is reserved but unused here.)
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
 * reason → priority rank (lower = drained first). A late anti-rug (0) jumps an
 * already-queued trailing-stop (2). urgency and stop-loss share rank 1.
 */
function reasonRank(reason: ExitReason): number {
    switch (reason) {
        case 'anti-rug': return 0;
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

const realSellExecutor: SellExecutor = (i) =>
    executeFullSell(i.ctx, i.dex, i.tokenAddress, i.feeTier, i.reason, i.tradeId, i.reasonDetail);

class ExitWorker {
    /** Priority queue kept sorted ascending by rank; stable within a rank (FIFO). */
    private readonly queue: { item: ExitWorkItem; rank: number; seq: number }[] = [];
    private running = false;
    private seq = 0;
    private executor: SellExecutor = realSellExecutor;

    /** Test seam — substitute the sell executor. */
    setExecutor(fn: SellExecutor): void {
        this.executor = fn;
    }

    /** Test seam — reset to a clean state between tests. */
    reset(): void {
        this.queue.length = 0;
        this.running = false;
        this.seq = 0;
        this.executor = realSellExecutor;
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
     * Drain loop: dequeue the highest-priority item, submit ONE sell (wrapped in
     * the per-wallet nonce lock), release the per-position lock, then continue —
     * strictly one sell at a time. A failed/thrown submit never breaks the loop;
     * the per-position lock is always released in finally.
     */
    private async drain(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            while (this.queue.length > 0) {
                const { item } = this.queue.shift()!;
                const chain = item.ctx.chain.name;
                try {
                    // Serial-by-construction is already nonce-safe; the explicit
                    // withNonceLock is the authority-layer guarantee (D-NONCE-
                    // AUTHORITY-ALL) so the invariant holds regardless of caller.
                    await withNonceLock(item.ctx.wallet.address, () => this.executor(item));
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
        ctx.log.info({ token: tokenAddress, tiers: tierLabels, op: 'exit.partial.submitted' }, 'Submitting partial sell via MEV-protected path');
        await sendCtxAlert(ctx, `*Partial sell:* ${tierLabels} at ${currentMultiple.toFixed(2)}x`);

        // Submit via sendTxWithRetry for MEV protection
        const txHash = await sendTxWithRetry(txBuilder, ctx);

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

    // Step 3: Check partial sell tiers (D-06 through D-11)
    if (exitConfig.partialSellTiers.length > 0) {
        const unfilledTiers = getUnfilledTiers(exitConfig.partialSellTiers, state.completedTierIndices, priceMultiple);
        if (unfilledTiers.length > 0) {
            // D-08: Combine all missed tiers into single transaction
            const sellAmount = calculatePartialSellAmount(state.originalTokenAmount, unfilledTiers);
            const success = await executePartialSell(
                ctx, dex, tokenAddress, feeTier,
                sellAmount, unfilledTiers, state, priceMultiple,
            );
            if (success) {
                ctx.log.info({
                    token: tokenAddress,
                    tiers: unfilledTiers.map(t => `${t.tier.multiple}x`).join(','),
                    priceMultiple: priceMultiple.toFixed(2),
                }, 'Partial sell completed');
            }
            // Persist updated tier completions
            upsertExitState.run(serializeExitState(state));
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
