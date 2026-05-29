import { ethers, Contract, WebSocketProvider, EventLog } from "ethers";
import { CONFIG } from "./config";
import { getGasOptions } from "./utils/gasManager";
import {
    checkTokenMetadata,
    isLiquidityLocked,
    simulateSwap,
    checkHoneypot,
    isBlacklistedToken,
    isLiquiditySufficient,
    isKnownBadToken,
    // hasHighTransferTax REMOVED (Phase 21.1 review-fix, WR-01): the single-chain
    // twin was a signer-connected swapExactETHForTokens(0n, …, {value}) WITHOUT
    // .staticCall — a real on-chain buy inside a "safety check" with broken NaN tax
    // math. Verified zero live callers; deleted from tokenSafety.ts (D-DELETE-LEGACY).
    hasMaxWalletOrTxLimits,
    simulateSell
} from "./utils/tokenSafety";
import {
    // Plan 18-CR-01b fix-along: `checkHoneypotForChain` was dropped from the
    // V2 + V3 parallel banks because the on-chain `simulateHoneypotRoundtrip`
    // gate (Option D) is now the authoritative honeypot check. The import
    // was removed to satisfy tsc --noEmit strictness on unused imports.
    isLiquidityLockedForChain,
    simulateSwapForChain,
    isLiquiditySufficientForChain,
    isKnownBadTokenForChain,
    checkTokenMetadataForChain,
    // STOP-THE-LINE-01 + STOP-THE-LINE-03 (plan 21.1-03): the
    // hasHighTransferTaxForChain import was REMOVED — both the V2 (:303) and V3
    // (:610) call sites were deleted and the function itself was deleted from
    // tokenSafety.ts (zero callers, harmful dead code, D-ROLLBACK).
    hasMaxWalletOrTxLimitsForChain,
    isBlacklistedTokenForChain
} from "./utils/tokenSafety";
// HONEY-07 / HONEY-08 (plan 18-10): the in-place V2 + V3 gate replacements
// dispatch through simulateHoneypotRoundtrip in src/utils/honeypot/index.ts.
// V2 path: 3-arg call (ctx, dex, token); V3 path: 4-arg call passing the
// runtime feeTier through to simulateViaContractV3 (iter-2 Blocker #1).
import { simulateHoneypotRoundtrip } from "./utils/honeypot";
// HONEY-12 (plan 18-10): 9th gate on V2 parallel bank (6th on V3 parallel bank).
// Detects mutable-tax / blacklist / pause / max-wallet setter selectors in the
// token bytecode — closes the owner-flips-tax-mid-position attack vector that
// the buy->sell roundtrip cannot catch.
import { isMutableTokenForChain } from "./utils/honeypot/bytecodeScan";
// Plan 18-CR-03 fix-along: defense-in-depth sanitizer applied at alert sites
// for any reason/revert string that flows into Telegram markdown + dashboard WS.
import { sanitizeReason } from "./utils/honeypot/sanitize";
import { BLOCKLIST } from "./utils/blocklist";
import { sendTelegramAlert } from "./utils/notifier";
import { sendCtxAlert } from "./utils/notifier";
import { db, insertTrade, isTokenSniped, updateTradeStatus, getTradeIdForPendingToken, getPauseState, setPauseState, forceWalCheckpoint, getResumeExitMonitorTrades, getResumeAntiRugTrades } from "./utils/db";
// Phase 20 / OPS-LIVE-01 + OPS-LIVE-02 — preflight is called before chain-context
// creation; checkWalletBalance is reused inside the mid-run setInterval so the
// floor formula lives in one place (D-BALANCE-FLOOR / W4 fix per Plan 20-02).
import { preflight, checkWalletBalance, checkEntryExitAffordability } from "./preflight";
// Phase 20 / OPS-LIVE-02 — mid-run undercut broadcasts pause_state_change so the
// dashboard banner (Plan 20-05/06) reacts within one WS round-trip.
import { broadcast } from "./api/ws/broadcaster";
import { logger } from "./utils/logger";
import { getProvider, getWallet, getWsProvider, removeWsProvider } from "./utils/provider";
import { FACTORY_ABI, ROUTER_ABI, ERC20_ABI, PAIR_ABI, V3_FACTORY_ABI, V3_POOL_ABI, V3_SWAP_ROUTER_ABI, V3_QUOTER_V2_ABI } from "./utils/abis";
import { sendTxWithRetry, createMevStrategy, escalatePrivateBuy } from "./utils/txManager";
import type { TransactionRequest } from "ethers";
// Phase 21.3 / Plan 21.3-03 (STOP-THE-LINE-05-B/C): the deliberate buy's
// no-double-buy guard reconciles the REAL broadcast hash via reconcileInclusion +
// buildReconcileConfig('buy') (the independent higher buy ceiling + confirm window
// from plan 01). The public leg's fee-on-transfer-safe minOut reuses the
// single-source computePublicMinOut from the exit ladder (no new slippage math).
import { reconcileInclusion, buildReconcileConfig } from "./utils/mevStrategies/reconciliation";
import { computePublicMinOut } from "./exitEngine";
// Phase 21.2 Plan 21.2-13 / WR-01 (D-NONCE-AUTHORITY-ALL): the buy entry path
// joins the bot-wide per-wallet nonce authority. Every signing submit — buys,
// sells, anti-rug, public fallback, approvals, partial sells — routes through
// withNonceLock so a buy and a concurrent same-wallet sell/anti-rug can never
// fetch getTransactionCount('latest') and sign against the SAME nonce.
import { withNonceLock } from "./utils/nonceAuthority";
import {
    clearAllTimers,
} from "./utils/exitManager";
import { startExitMonitor, resumeExitMonitor, setExitWorkerWatchdog } from './exitEngine';
// Finding B layer 1 (D-WATCHDOG-ABORT): the watchdog is a self-contained liveness
// primitive in its own helper module (kept out of the heavy bot.ts import graph so
// it is independently unit-testable). bot.ts owns the budget knob + install call
// and re-exports the factory for callers/tests.
import { makeExitWatchdog } from './utils/exitWatchdog';
export { makeExitWatchdog } from './utils/exitWatchdog';
export type { ExitWatchdogOptions } from './utils/exitWatchdog';
import {
    ChainConfig,
    DexConfig,
    DexConfigV2,
    DexConfigV3,
    ChainContext,
    buildChainRegistry,
    createChainContext,
    getEnabledChains,
    isDexV2,
    isDexV3
} from "./chainRegistry";
// Phase 19 / Plan 19-05 — anti-rug wiring imports. snapshotLpBaseline writes
// the V2/V3 LP baseline at buy success; registerAntiRugPosition hooks the
// position into the per-chain WS dispatch; verifyAllowlistAtStartup is the
// D-LIST-VERIFY startup-time getCode() audit per chain;
// startChainAntiRugListener arms the WS lifecycle.
import { snapshotLpBaseline } from './anti-rug/lpBaseline';
import { registerAntiRugPosition, startChainAntiRugListener } from './anti-rug/detector';
import { verifyAllowlistAtStartup } from './anti-rug/allowlist';
import { canSnipe, recordSnipe } from "./riskManager";
import { startApiServer } from './api/server';
import { startTelegramListener, TelegramListenerHandle } from './telegramListener';

const log = logger.child({ module: 'bot' });

// ---------------------------------------------------------------------------
// V3 helper functions (QuoterV2 pricing, liquidity wait, min liquidity check)
// ---------------------------------------------------------------------------

async function getV3Price(
    ctx: ChainContext,
    quoterAddress: string,
    tokenAddress: string,
    feeTier: number,
    amount: bigint
): Promise<bigint | null> {
    const quoter = new Contract(quoterAddress, V3_QUOTER_V2_ABI, ctx.httpProvider);
    try {
        const quoteParams = {
            tokenIn: tokenAddress,
            tokenOut: ctx.chain.wethAddress,
            amountIn: amount,
            fee: feeTier,
            sqrtPriceLimitX96: 0n,
        };
        const [amountOut] = await quoter.quoteExactInputSingle.staticCall(quoteParams);
        return amountOut;
    } catch {
        return null; // Pool illiquid or quoter revert (Pitfall 3)
    }
}

export async function waitForLiquidity(
    ctx: ChainContext,
    poolAddress: string,
    blockNumber: number
): Promise<boolean> {
    const pool = new Contract(poolAddress, V3_POOL_ABI, ctx.httpProvider);

    // D-02: Same-block check first -- atomic launch scripts emit PoolCreated + Mint in one block
    try {
        const mintFilter = pool.filters.Mint();
        const existingMints = await pool.queryFilter(mintFilter, blockNumber, blockNumber);
        if (existingMints.length > 0) {
            ctx.log.info({ pool: poolAddress, block: blockNumber }, 'Mint found in same block as PoolCreated');
            return true;
        }
    } catch (e) {
        ctx.log.warn({ err: e, pool: poolAddress }, 'Error querying same-block Mints, falling through to subscription');
    }

    // D-01: Subscribe + timeout for future Mints (30 seconds)
    return new Promise<boolean>((resolve) => {
        const wsPool = new Contract(poolAddress, V3_POOL_ABI, ctx.wsProvider || ctx.httpProvider);
        const timeout = setTimeout(() => {
            wsPool.removeAllListeners('Mint');  // Pitfall 7: prevent stale callbacks
            ctx.log.info({ pool: poolAddress }, 'Mint timeout (30s), dropping opportunity');
            resolve(false);
        }, 30_000);

        wsPool.on('Mint', () => {
            clearTimeout(timeout);
            wsPool.removeAllListeners('Mint');
            ctx.log.info({ pool: poolAddress }, 'Mint event received, proceeding to snipe');
            resolve(true);
        });
    });
}

async function checkMinLiquidity(
    ctx: ChainContext,
    quoterAddress: string,
    tokenAddress: string,
    feeTier: number
): Promise<boolean> {
    const threshold = ethers.parseEther(ctx.chain.minLiquidityThreshold);
    // Use QuoterV2 to simulate a small reference swap (research recommendation)
    // If the pool can convert 0.001 native to tokens, it has meaningful liquidity
    const referenceAmount = ethers.parseEther('0.001');
    const quoter = new Contract(quoterAddress, V3_QUOTER_V2_ABI, ctx.httpProvider);
    try {
        const quoteParams = {
            tokenIn: ctx.chain.wethAddress,
            tokenOut: tokenAddress,
            amountIn: referenceAmount,
            fee: feeTier,
            sqrtPriceLimitX96: 0n,
        };
        await quoter.quoteExactInputSingle.staticCall(quoteParams);

        // Also check pool liquidity is above threshold via a larger quote
        const largeQuoteParams = {
            tokenIn: ctx.chain.wethAddress,
            tokenOut: tokenAddress,
            amountIn: threshold,
            fee: feeTier,
            sqrtPriceLimitX96: 0n,
        };
        await quoter.quoteExactInputSingle.staticCall(largeQuoteParams);

        return true;
    } catch {
        ctx.log.info({ token: tokenAddress, feeTier, threshold: ctx.chain.minLiquidityThreshold }, 'V3 pool below minimum liquidity threshold');
        return false;
    }
}

// Chain-aware maybeApprove for multi-chain path.
// WR-01 (21.2-13, D-NONCE-AUTHORITY-ALL): the approve() is a signing tx, so it
// routes through withNonceLock(ctx.wallet.address) — it must serialize with every
// other same-wallet signing site (buy submit / sell / anti-rug / partial). The
// allowance READ stays outside the lock (no signing); only the approve is locked.
async function maybeApproveForChain(ctx: ChainContext, tokenContract: Contract, amount: bigint, routerAddress: string) {
    const currentAllowance = await tokenContract.allowance(ctx.wallet.address, routerAddress);
    if (currentAllowance < amount) {
        await withNonceLock(ctx.wallet.address, async () => {
            await tokenContract.approve(routerAddress, amount);
        });
    }
}

// ---------------------------------------------------------------------------
// submitBuyTx — the nonce-locked BUY-submit seam (Phase 21.2-13 / WR-01)
// ---------------------------------------------------------------------------
//
// D-NONCE-AUTHORITY-ALL: the buy entry path was the one signing submit that
// bypassed the per-wallet nonce authority (the V2 + V3 swap submits called
// sendTxWithRetry directly, OUTSIDE any lock). A buy and a concurrent same-wallet
// sell/anti-rug (different tokens) could both fetch getTransactionCount('latest')
// before either landed and sign two txs against ONE nonce — the cross-submit
// collision the lock exists to close. The strategy's per-attempt stop-on-advance
// only catches advancement on the NEXT attempt, not the initial collision.
//
// Both buy sites now call this helper. It wraps the submit in
// withNonceLock(ctx.wallet.address, …), mirroring the sell-side idiom
// (executePublicFallbackSell / executePartialSell). NO DOUBLE-LOCK: the buy sites
// (handleNewPairForChain / handleNewV3PoolForChain — the top-level pair/pool event
// handlers) are NOT nested inside any other same-wallet withNonceLock hold, so this
// is a single-level acquire (the CR-01 re-entrant-deadlock class does not apply).
// sendTxWithRetry still owns nonce-safe retry (re-fetch 'latest' per attempt); the
// lock only guarantees no two same-wallet submits run concurrently.
// Phase 21.3 / Plan 21.3-03 (STOP-THE-LINE-05-B/D, D-BUY-INCLUSION-PRIVATE-FIRST):
// `mode` distinguishes a genuine SNIPE (private-only, fail-clean — the V2/V3
// pair-event sites pass 'snipe' explicitly) from an explicitly-invoked DELIBERATE
// buy (operator-run scripts/deliberate-buy.ts → executeDeliberateBuy, the ONLY
// caller that may go public). It defaults to 'snipe' so the snipe call sites are
// byte-for-byte unchanged. submitBuyTx itself does NOT branch on mode — both modes
// route through the SAME nonce-locked private submit; mode only changes the gating
// (the affordability reserve) and what the CALLER does on a throw (a snipe fails
// clean; the deliberate path runs the no-double-buy guard + public fallback).
export type BuyMode = 'snipe' | 'deliberate';

export async function submitBuyTx(
    ctx: ChainContext,
    txBuilder: () => Promise<TransactionRequest>,
    _mode: BuyMode = 'snipe',
): Promise<string> {
    return withNonceLock(ctx.wallet.address, () => sendTxWithRetry(txBuilder, ctx));
}

// ---------------------------------------------------------------------------
// Buy-time entry affordability gate — Finding A / D-EXIT-AFFORDABILITY-GATE
// (Phase 21.2 / Plan 21.2-08, STOP-THE-LINE-04-A)
//
// NEVER enter a position the wallet cannot guarantee an exit from. Called at BOTH
// the V2 and V3 buy submit sites, JUST BEFORE sendTxWithRetry. Refuses the snipe
// unless the wallet balance covers
//   snipeValue + worstCaseBuyGas + worstCasePublicSellGas + cushion
// where worstCasePublicSellGas prices the GUARANTEED PUBLIC exit (a normal-priced
// public sell — base fee × EXIT_GATE_SELL_GAS_BUFFER + approval gas), NOT the
// optimistic private priority-fee path. The decision logic + math lives in
// preflight.checkEntryExitAffordability (single source of truth, fails CLOSED on
// any RPC error). On a REFUSE this emits structured pino + a Telegram alert with a
// remediation pointer (D-ALERTS) and the caller SKIPS the buy (the trap is made
// impossible to ENTER, not merely survivable).
//
// Returns true when the snipe may proceed, false when it must be refused.
// ---------------------------------------------------------------------------
async function enforceEntryExitAffordability(ctx: ChainContext, targetToken: string, mode: BuyMode = 'snipe'): Promise<boolean> {
    // checkEntryExitAffordability consumes a PreflightChain (the chain config plus
    // its live httpProvider + wallet) — exactly the fields ChainContext already
    // holds. Reuse them rather than reconstruct (no duplicated formula).
    // Phase 21.3 / Plan 21.3-03 (D-BUY-AFFORDABILITY-EXTEND): thread `mode` into the
    // mode-aware gate (plan 02). A deliberate buy reserves its OWN worst-case
    // public-fallback buy gas; a genuine snipe (default 'snipe') reserves ZERO
    // public-buy gas it will never use — the snipe floor is byte-for-byte the 21.2
    // floor. mode defaults to 'snipe' so the snipe call sites are unchanged.
    const result = await checkEntryExitAffordability({
        ...ctx.chain,
        httpProvider: ctx.httpProvider,
        wallet: ctx.wallet,
    }, mode);
    if (result.passed) {
        return true;
    }
    // REFUSE — structured op-log + Telegram with a remediation pointer (D-ALERTS).
    ctx.log.error(
        {
            op: 'entry.exit-affordability.refused',
            token: targetToken,
            chain: ctx.chain.name,
            mode,
            reason: result.reason,
            details: result.details,
        },
        'Entry REFUSED: wallet cannot guarantee an exit (worst-case public sell + buffer) — skipping buy',
    );
    await sendCtxAlert(
        ctx,
        `*Entry REFUSED* for \`${targetToken}\` — wallet cannot guarantee an exit (worst-case public sell + buffer). ${sanitizeReason(result.reason ?? 'unaffordable')}`,
    );
    return false;
}

// ---------------------------------------------------------------------------
// Never-NaN env parse helpers (mirror the reconciliation.ts / exitEngine.ts
// idiom). Local to the buy seam; deliberate-buy private budget + public slippage.
// ---------------------------------------------------------------------------
function parsePositiveIntDefault(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parsePositiveNumberDefault(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// Snipe fail-clean structured alert — STOP-THE-LINE-05-D / D-SNIPE-FAIL-CLEAN +
// D-ALERTS (Phase 21.3 / Plan 21.3-03).
//
// A genuine snipe that exhausts hardened private inclusion FAILS CLEAN — snipes
// NEVER auto-go-public (front-run protection preserved; the deliberate/operator
// path is the manual escape). The trade row is written ONLY after a returned hash,
// so a throw is structurally zero-spend / no-trades-row; this surfaces the hard
// structured alert. The per-builder getBundleStatsV2 inclusion telemetry is logged
// inside the strategy (op:'flashbots.bundle.stats') on every attempt — it is NOT
// threaded out through the strategy's throw, so we point the operator at those
// structured log entries via `statsRef` rather than fabricate a summary we do not
// hold. CRITICAL (T-21.3-03-06): the payload carries ONLY public values — token,
// chain, attempts, the error MESSAGE — NEVER the FLASHBOTS_AUTH_KEY or a signed raw
// tx.
// ---------------------------------------------------------------------------
function emitSnipeFailClean(
    ctx: ChainContext,
    token: string,
    poolType: 'v2' | 'v3',
    feeTier: number | null,
    err: unknown,
): void {
    // The genuine snipe path passes no explicit retries → default 3 → 4 attempts
    // (sendTxWithRetry). This is the documented snipe submission budget.
    const attempts = 4;
    const reason = err instanceof Error ? err.message : String(err);
    ctx.log.error(
        {
            op: 'buy.snipe.fail-clean',
            token,
            chain: ctx.chain.name,
            poolType,
            feeTier,
            attempts,
            // Per-builder inclusion telemetry is in the strategy's structured logs.
            statsRef: 'op:flashbots.bundle.stats',
            reason,
            remediation: 're-attempt as a deliberate buy (scripts/deliberate-buy.ts) if the token is worth public exposure; or raise MEV_BUY_MAX_PRIORITY_FEE_GWEI / inspect per-builder coverage in the op:flashbots.bundle.stats logs',
        },
        'Snipe FAILED CLEAN: hardened private inclusion exhausted — zero ETH spent, no trades row; snipes never auto-go-public',
    );
}

// ---------------------------------------------------------------------------
// armPositionMonitoring — the SINGLE shared register->monitor helper for a
// landed V2 position (Phase 21.3 / Plan 21.3-05, STOP-THE-LINE-06).
//
// Extracted VERBATIM from the snipe handler's inline register->monitor block
// (handleNewPairForChain :908-947) so the V2 snipe handler AND
// executeDeliberateBuy share ONE wiring and can NEVER drift again. A landed buy
// — snipe OR deliberate — MUST arm the exit monitor (startExitMonitor) AND
// register anti-rug protection (snapshotLpBaseline + registerAntiRugPosition) or
// the held position is left UNMONITORED / RUG-UNPROTECTED (the LADYS-class harm
// v6.17 exists to prevent).
//
// ORDERING (preserved from the snipe): startExitMonitor is awaited BEFORE the
// snapshotLpBaseline/registerAntiRugPosition try/catch, so an anti-rug baseline
// failure NEVER costs the exit monitor — the exit monitor stays armed even when
// the baseline snapshot throws (the catch logs op:'antirug.baseline-snapshot-
// failed' and SKIPS the register, leaving the position anti-rug-UNMONITORED but
// still exit-monitored).
//
// feeTier is null (V2 only). The CR-03 `await registerAntiRugPosition` is
// preserved verbatim: without the await its rejection becomes an unhandled
// promise rejection that bypasses the surrounding try/catch — the documented
// op:'antirug.baseline-snapshot-failed' log never fires and the position appears
// registered when it is not.
// ---------------------------------------------------------------------------
async function armPositionMonitoring(
    ctx: ChainContext,
    dex: DexConfigV2,
    tokenAddress: string,
    pairAddress: string,
    tradeId: number,
    originalTokenAmount: bigint,
    buyAmountNative: string,
): Promise<void> {
    await startExitMonitor(ctx, dex, tokenAddress, null, buyAmountNative, tradeId, originalTokenAmount);

    // Phase 19 / Plan 19-05 — parallel anti-rug attach. snapshotLpBaseline
    // writes the V2 reserves baseline; registerAntiRugPosition hooks the
    // position into the per-chain anti-rug WS dispatch table. On baseline
    // failure, the catch logs op='antirug.baseline-snapshot-failed' and
    // SKIPS the register — the position is left UNMONITORED for anti-rug
    // (operator-visible via the dashboard's per-position state badge per
    // UI-SPEC) but the standard exit monitor remains active.
    try {
        await snapshotLpBaseline(ctx, dex, tradeId, pairAddress, null);
        // CR-03: registerAntiRugPosition is async (awaits
        // startChainAntiRugListener → backfillSinceLastSeen which
        // performs RPC + DB writes). Without await, rejections
        // become unhandled promise rejections and bypass the
        // surrounding try/catch — the documented
        // op='antirug.baseline-snapshot-failed' log path never
        // fires and the position appears registered when it isn't.
        await registerAntiRugPosition(ctx, dex, tokenAddress, pairAddress, tradeId, null);
    } catch (err) {
        ctx.log.error(
            {
                err,
                op: 'antirug.baseline-snapshot-failed',
                tradeId,
                pair: pairAddress,
            },
            'Anti-rug baseline snapshot failed; position UNMONITORED',
        );
    }
}

// ---------------------------------------------------------------------------
// executeDeliberateBuy — the EXPLICIT deliberate/capture buy engine path
// (Phase 21.3 / Plan 21.3-03, STOP-THE-LINE-05-B/C; D-DELIBERATE-EXPLICIT-ONLY +
// D-DELIBERATE-PRIVATE-FIRST + D-NO-DOUBLE-BUY + D-NONCE-AUTHORITY-ALL).
//
// THE ONLY buy path that may reach the PUBLIC mempool. Reachable ONLY from the
// operator-run scripts/deliberate-buy.ts (NO heuristic, NO flag on the snipe path —
// D-DELIBERATE-EXPLICIT-ONLY). It tries hardened-private FIRST (escalatePrivateBuy,
// budget DELIBERATE_BUY_PRIVATE_ATTEMPTS), then — only if the private leg genuinely
// did not land AND the stricter no-double-buy guard clears — the fee-on-transfer-safe
// public buy.
//
// The no-double-buy guard mirrors exitEngine.ts:902-979 INVERTED. A double-BUY
// spends real ETH twice for one intent (UNrecoverable — worse than a double-sell),
// so the guard biases even harder toward "do not broadcast when in doubt":
//   structural half  : the single per-wallet nonce (withNonceLock) makes two
//                       same-nonce txs impossible (D-NONCE-AUTHORITY-ALL).
//   procedural half  : reconcile the REAL broadcast hash (BroadcastHandle, NEVER a
//                       pre-signed phantom — CR-02). included → ABORT (private landed
//                       late, record the real hash); landed-not-ours / inconclusive →
//                       FAIL-CLOSED (do NOT broadcast). reverted / not-landed → the
//                       STRICTER chain-is-truth defense-in-depth: before broadcasting
//                       ALSO require balanceOf(token) == 0 (no tokens already received)
//                       AND the nonce was NOT consumed
//                       (getTransactionCount('latest') == submittedNonce). The sell
//                       guard checks balance only; the buy checks BOTH.
//
// Returns the real on-chain tx hash on a landed buy (private or public), or null
// when the buy was correctly NOT broadcast (fail-closed / private landed but already
// recorded / nothing to do). The operator script renders the outcome.
// ---------------------------------------------------------------------------
export async function executeDeliberateBuy(
    ctx: ChainContext,
    targetToken: string,
    amountInWei: bigint,
    dex: DexConfigV2,
): Promise<string | null> {
    // (0) Mode-aware affordability gate (D-BUY-AFFORDABILITY-EXTEND): a deliberate
    // buy MUST be able to afford its OWN public-fallback buy gas. Refuse → return.
    if (!(await enforceEntryExitAffordability(ctx, targetToken, 'deliberate'))) {
        return null;
    }

    const router = new Contract(dex.routerAddress, ROUTER_ABI, ctx.wallet);
    const path = [ctx.chain.wethAddress, targetToken];

    // (1) Build the PRIVATE buy tx (swapExactETHForTokens — the standard private
    // snipe buy shape). Quote → slippage-adjusted minOut. Reuse computePublicMinOut
    // (the single-source slippage helper) so the private and public legs agree.
    let privMinOut: bigint = 0n;
    try {
        const slippagePct = parsePositiveNumberDefault(process.env.DELIBERATE_BUY_SLIPPAGE_PCT, CONFIG.slippagePercent || 5);
        const amounts: bigint[] = await router.getAmountsOut(amountInWei, path);
        privMinOut = computePublicMinOut(amounts[1], slippagePct);
    } catch {
        ctx.log.warn({ token: targetToken, op: 'buy.deliberate.quote-failed' }, 'Deliberate buy: failed to quote private minOut, defaulting to 0');
    }
    const privDeadline = Math.floor(Date.now() / 1000) + 60;
    const privBuyTxBuilder = () => ctx.wallet.populateTransaction({
        to: dex.routerAddress,
        data: router.interface.encodeFunctionData('swapExactETHForTokens', [privMinOut, path, ctx.wallet.address, privDeadline]),
        value: amountInWei,
    });

    // (1) HARDENED-PRIVATE FIRST (D-DELIBERATE-PRIVATE-FIRST). escalatePrivateBuy
    // normalizes not-landed into a structured result (it does NOT throw) so the
    // deliberate ladder can fall through to the no-double-buy guard. The budget is
    // DELIBERATE_BUY_PRIVATE_ATTEMPTS (default 2 → 2 private submissions). The
    // strategy's submit is nonce-safe; the WHOLE private leg runs under withNonceLock
    // so it serializes with every other same-wallet submit (D-NONCE-AUTHORITY-ALL).
    const attempts = parsePositiveIntDefault(process.env.DELIBERATE_BUY_PRIVATE_ATTEMPTS, 2);
    const priv = await withNonceLock(ctx.wallet.address, () => escalatePrivateBuy(privBuyTxBuilder, ctx, attempts));

    if (priv.landed && priv.txHash) {
        // The private bundle landed (possibly late-reconciled by 21.1). Done — record
        // the real hash. No public buy.
        ctx.log.info({ token: targetToken, txHash: priv.txHash, op: 'buy.deliberate.private-landed' }, 'Deliberate buy: private bundle landed');
        recordDeliberateBuy(ctx, targetToken, dex, amountInWei, priv.txHash);
        return priv.txHash;
    }

    // (2) NO-DOUBLE-BUY GUARD before going public (D-NO-DOUBLE-BUY). Mirror
    // exitEngine.ts:902-979, INVERTED. Reconcile the REAL broadcast handle.
    let publicBuyAllowed = false;
    if (priv.lastSignedHash && priv.lastNonce != null) {
        const rcfg = buildReconcileConfig(process.env, ctx.chain.gas.maxGasLimit, attempts, 'buy');
        const recon = await reconcileInclusion(
            priv.lastSignedHash, priv.lastNonce, ctx.wallet, ctx.httpProvider, rcfg.confirmWindowMs, rcfg.pollMs,
        );
        if (recon.outcome === 'included') {
            // The private bundle landed LATE → ABORT the public buy (record the real
            // reconciled hash). A double-spend of ETH is the unrecoverable harm.
            const landedHash = recon.hash ?? priv.lastSignedHash;
            ctx.log.info(
                { token: targetToken, txHash: landedHash, op: 'buy.fallback.aborted.late-land' },
                'No-double-buy guard: the private buy landed late — aborting the public buy',
            );
            await sendCtxAlert(
                ctx,
                `*[DELIBERATE BUY GUARD]* private buy landed late (reconciled) — public buy ABORTED to prevent a double-SPEND of ETH for \`${targetToken}\`.`,
            );
            recordDeliberateBuy(ctx, targetToken, dex, amountInWei, landedHash);
            return landedHash;
        }
        if (recon.outcome === 'landed-not-ours' || recon.outcome === 'reverted') {
            // reverted → the private buy mined-but-reverted (status 0): NO public
            // resubmit (a same-intent retry could double-spend if the revert was
            // transient at the node). landed-not-ours → the nonce was consumed but our
            // hash has no receipt — we CANNOT prove the private buy did NOT land.
            // FAIL-CLOSED for both: do NOT broadcast the public buy.
            ctx.log.warn(
                { token: targetToken, signedTxHash: priv.lastSignedHash, submittedNonce: priv.lastNonce, outcome: recon.outcome, op: 'buy.fallback.failsafe.inconclusive' },
                'No-double-buy guard: private inclusion INCONCLUSIVE — failing CLOSED, NOT running the public buy (avoid double-SPEND)',
            );
            await sendCtxAlert(
                ctx,
                `*[DELIBERATE BUY GUARD]* private buy inclusion is INCONCLUSIVE (${recon.outcome}) for \`${targetToken}\` — public buy DEFERRED to avoid a double-SPEND of ETH. Remediation: inspect whether the private buy landed before re-attempting.`,
            );
            return null;
        }
        // recon.outcome === 'not-landed' → fall through to the stricter chain-is-truth
        // defense-in-depth below.
    }

    // (2b) STRICTER chain-is-truth defense-in-depth (the buy inversion of the sell's
    // balanceOf check). Before the public buy ALSO require:
    //   balanceOf(targetToken) == 0   (no tokens already received → the private buy
    //                                   did NOT land)
    //   AND getTransactionCount('latest') == priv.lastNonce  (the submitted nonce was
    //                                   NOT consumed → no same-nonce tx landed)
    // The sell guard checks balance only; the buy checks BOTH (a double-BUY is the
    // unrecoverable harm). If EITHER fails → ABORT fail-closed.
    const tokenContract = new Contract(targetToken, ERC20_ABI, ctx.httpProvider);
    const heldBalance: bigint = await tokenContract.balanceOf(ctx.wallet.address);
    const latestNonce = await ctx.httpProvider.getTransactionCount(ctx.wallet.address, 'latest');
    const nonceConsumed = priv.lastNonce != null && latestNonce !== priv.lastNonce;

    if (heldBalance !== 0n || nonceConsumed) {
        ctx.log.warn(
            {
                token: targetToken,
                heldBalance: heldBalance.toString(),
                latestNonce,
                submittedNonce: priv.lastNonce ?? null,
                nonceConsumed,
                op: 'buy.fallback.aborted.chain-truth',
            },
            'No-double-buy guard: chain-is-truth check failed (tokens already received OR nonce consumed) — aborting the public buy',
        );
        await sendCtxAlert(
            ctx,
            `*[DELIBERATE BUY GUARD]* chain-is-truth ABORT for \`${targetToken}\` — ` +
            `${heldBalance !== 0n ? 'tokens already received (balanceOf != 0)' : 'nonce was consumed (a same-nonce tx landed)'}; ` +
            `public buy NOT broadcast (avoid double-SPEND).`,
        );
        return null;
    }
    publicBuyAllowed = true;

    if (!publicBuyAllowed) {
        // Defensive: unreachable given the branches above, but never fall through to
        // a broadcast on an unexpected state (fail-closed).
        return null;
    }

    // (3) PUBLIC-MEMPOOL FEE-ON-TRANSFER-SAFE BUY (the manual escape; nonce-locked).
    // ETH value sent — NO approve (a buy spends ETH). Fresh quote → slippage minOut
    // via the single-source helper + the 21.3-00 FoT BUY ABI fragment.
    const slippagePct = parsePositiveNumberDefault(process.env.DELIBERATE_BUY_SLIPPAGE_PCT, CONFIG.slippagePercent || 5);
    const amountsOut: bigint[] = await router.getAmountsOut(amountInWei, path);
    const expectedOut = amountsOut[1];
    const minOut = computePublicMinOut(expectedOut, slippagePct);
    const deadline = Math.floor(Date.now() / 1000) + 600;

    ctx.log.info(
        {
            token: targetToken, amountIn: amountInWei.toString(),
            expectedOut: expectedOut.toString(), minOut: minOut.toString(), slippagePct,
            op: 'buy.fallback.public.submit',
        },
        'Deliberate public-mempool buy (private inclusion did not land; no-double-buy guard cleared)',
    );
    await sendCtxAlert(
        ctx,
        `*[DELIBERATE BUY → PUBLIC]* private inclusion did not land — buying \`${targetToken}\` on the public mempool (slippage ${slippagePct}%).`,
    );

    const txHash = await withNonceLock(ctx.wallet.address, async () => {
        const stx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
            minOut, path, ctx.wallet.address, deadline, { value: amountInWei },
        );
        const rec = await stx.wait();
        ctx.log.info(
            { token: targetToken, txHash: stx.hash, blockNumber: rec?.blockNumber, op: 'buy.fallback.public.mined' },
            'Deliberate public-mempool buy mined',
        );
        return stx.hash as string;
    });

    recordDeliberateBuy(ctx, targetToken, dex, amountInWei, txHash);
    return txHash;
}

// Record a successful deliberate buy in the trades audit trail. Kept separate so
// every landed-buy branch (private / late-land / public) records identically.
function recordDeliberateBuy(
    ctx: ChainContext,
    targetToken: string,
    dex: DexConfigV2,
    amountInWei: bigint,
    txHash: string,
): void {
    recordSnipe(ctx.chain.name);
    insertTrade.run({
        token: targetToken.toLowerCase(),
        chain: ctx.chain.name,
        action: 'buy',
        txHash: txHash ?? 'mev_bundle',
        block: null,
        timestamp: Math.floor(Date.now() / 1000),
        amountIn: ethers.formatEther(amountInWei),
        amountOut: null,
        gasCost: null,
        priceAtAction: null,
        status: 'pending',
        poolType: 'v2',
        feeTier: null,
        dexName: dex.name,
    });
}


// ---------------------------------------------------------------------------
// Chain-aware pair handler
// ---------------------------------------------------------------------------

export async function handleNewPairForChain(
    ctx: ChainContext,
    dex: DexConfigV2,
    token0: string,
    token1: string,
    pairAddress: string
): Promise<void> {

    const targetToken = token0.toLowerCase() === ctx.chain.wethAddress.toLowerCase()
        ? token1 : token0;

    if (isTokenSniped.get(targetToken.toLowerCase(), ctx.chain.name)) {
        ctx.log.info({ token: targetToken }, 'Already sniped token, skipping');
        await sendCtxAlert(ctx, `*Already sniped token:* \`${targetToken}\``);
        return;
    }

    ctx.log.info({ pair: pairAddress, dex: dex.name }, 'New pair detected');

    if (BLOCKLIST.tokens.has(targetToken.toLowerCase())) {
        ctx.log.info({ token: targetToken }, 'Blocked token address, skipping');
        await sendCtxAlert(ctx, `*Blocked token* \`${targetToken}\``);
        return;
    }

    if (BLOCKLIST.pairs.has(pairAddress.toLowerCase())) {
        ctx.log.info({ pair: pairAddress }, 'Blocked LP pair, skipping');
        await sendCtxAlert(ctx, `*Blocked LP pair* \`${pairAddress}\``);
        return;
    }

    const isBad = await isKnownBadTokenForChain(ctx, targetToken);
    if (isBad) {
        ctx.log.info({ token: targetToken }, 'Known bad token or creator, skipping');
        await sendCtxAlert(ctx, `*Known bad token or creator* \`${targetToken}\``);
        return;
    }

    // Risk management gate (per D-13 -- all risk rules checked before safety pipeline)
    const riskResult = canSnipe(ctx.chain.name, ctx.chain.snipeAmount, ctx.chain.maxCapital);
    if (!riskResult.allowed) {
        ctx.log.warn({ token: targetToken, reason: riskResult.reason, details: riskResult.details }, 'Risk check failed, skipping snipe');
        await sendCtxAlert(ctx, `*Risk: ${riskResult.details}* -- skipping \`${targetToken}\``);
        return;
    }

    // HONEY-07 (plan 18-10): in-place V2 honeypot gate — dispatch via the
    // HoneypotChecker on-chain roundtrip (Option D) and skip the buy on any
    // verdict !== 'safe'. Replaces the broken simulateSellForChain (V2 sell-sim
    // balance=0 hard-block) DELETED in plan 18-09 per D-ROLLBACK.
    const honeypotResult = await simulateHoneypotRoundtrip(ctx, dex, targetToken);
    if (honeypotResult.verdict !== 'safe') {
        ctx.log.warn({
            token: targetToken,
            verdict: honeypotResult.verdict,
            reason: honeypotResult.reason,
            buyTaxBps: honeypotResult.evidence.buyTaxBps,
            sellTaxBps: honeypotResult.evidence.sellTaxBps,
            method: honeypotResult.evidence.method,
            dexType: honeypotResult.evidence.dexType,
        }, 'Honeypot gate blocked V2 snipe');
        // D-ALERTS tiered skip alert
        const evBuy = honeypotResult.evidence.buyTaxBps;
        const evSell = honeypotResult.evidence.sellTaxBps;
        const taxInfo = (evBuy !== undefined && evSell !== undefined)
            ? ` tax: buy ${evBuy}bps sell ${evSell}bps`
            : '';
        // Plan 18-CR-03 fix-along: sanitize at the alert site as defense-in-depth.
        // The wrapper already sanitizes (checkerContract.ts catches), but a future
        // caller into this code path that constructs a HoneypotResult by hand
        // should not be able to inject markdown via reason.
        const safeReason = sanitizeReason(honeypotResult.reason);
        await sendCtxAlert(
            ctx,
            `*SKIP* \`${targetToken}\` -- ${honeypotResult.verdict} (${safeReason})${taxInfo}\n[Etherscan](${ctx.chain.explorerUrl}/token/${targetToken})`
        );
        return;
    }

    // Parallel safety checks using chain-aware versions.
    // HONEY-12 (plan 18-10): 9th gate `isMutableTokenForChain` blocks tokens
    // whose bytecode contains setTax / setBlacklist / pauseTrading / etc.
    // selectors — closes the owner-flips-tax-mid-position attack the roundtrip
    // cannot catch.
    //
    // Plan 18-CR-01b fix-along: `checkHoneypotForChain` (third-party
    // honeypot.is / GoPlus HTTP API) is intentionally NOT in this bank — the
    // on-chain `simulateHoneypotRoundtrip` gate above (line 232) is the
    // authoritative honeypot gate (Option D). The third-party API has known
    // false-positive issues that would block legitimate snipes the on-chain
    // probe says are safe; running both gates doubled cost without improving
    // safety, and a config drift could mask divergence. `isHoneypot` from
    // here on is hard-coded `false` so the existing log + alert lines that
    // reference it continue to type-check.
    // STOP-THE-LINE-03 (plan 21.1-03, D-V2-TAX-REMOVE): the
    // hasHighTransferTaxForChain call was REMOVED from this V2 bank — the exact
    // mirror of the V3 removal above. It was redundant (the simulateHoneypotRoundtrip
    // gate at bot.ts:253, HONEY-07, already enforces V2 buy+sell tax fail-closed
    // BEFORE this bank) AND actively HARMFUL: tokenSafety.ts fired a signer-connected
    // swapExactETHForTokens(amountOutMin=0, {value: snipeAmount}) with NO .staticCall
    // — i.e. a REAL on-chain buy at zero slippage on EVERY V2 snipe — then misread the
    // TransactionResponse as a bigint[] so taxPercent=NaN -> returned false (a silent
    // false-negative). This fired on the 21-07 capture path (a V2 token), spending a
    // second snipeAmount with uncapped slippage. canSwap (simulateSwapForChain) is
    // KEPT — it is a clean read-only .staticCall (audited 21.1-03, no real tx).
    const [isBlacklisted, locked, sufficientLiquidity, validMetadata, canSwap, hasLimits, mutableResult] = await Promise.all([
        isBlacklistedTokenForChain(ctx, targetToken),
        isLiquidityLockedForChain(ctx, pairAddress),
        isLiquiditySufficientForChain(ctx, pairAddress),
        checkTokenMetadataForChain(ctx, targetToken),
        simulateSwapForChain(ctx, dex.routerAddress, targetToken),
        hasMaxWalletOrTxLimitsForChain(ctx, targetToken),
        isMutableTokenForChain(ctx, targetToken),
    ]);
    const isHoneypot = false;

    const tokenContract = new Contract(targetToken, ERC20_ABI, ctx.httpProvider);

    let symbol = "?", name = "?", decimals = 18;
    try {
        [symbol, name, decimals] = await Promise.all([
            tokenContract.symbol(),
            tokenContract.name(),
            tokenContract.decimals(),
        ]);
    } catch (e) {
        ctx.log.debug({ err: e, token: targetToken }, 'Failed to fetch token metadata, using defaults');
    }

    const lp = new Contract(pairAddress, PAIR_ABI, ctx.httpProvider);

    let nativeLiquidity = "?";
    try {
        const [token0Addr, reserves] = await Promise.all([
            lp.token0(),
            lp.getReserves()
        ]);

        const wethReserve = token0Addr.toLowerCase() === ctx.chain.wethAddress.toLowerCase() ? reserves.reserve0 : reserves.reserve1;
        nativeLiquidity = ethers.formatEther(wethReserve);
    } catch (e) {
        ctx.log.debug({ err: e, token: targetToken, pair: pairAddress }, 'Failed to fetch LP reserve data');
    }

    // D-ALERTS (plan 18-10): augment the safe-path "New Token Detected" alert
    // with BuyTax / SellTax bps from the honeypot roundtrip evidence. The early-
    // return at the SKIP branch above guarantees that reaching this point means
    // honeypotResult.verdict === 'safe' — the discriminated-union HoneypotResult
    // requires numeric buyTaxBps / sellTaxBps on the 'safe' variant (HONEY-06),
    // so these accesses are type-safe.
    const safeEvidence = honeypotResult.verdict === 'safe' ? honeypotResult.evidence : null;
    const buyTaxLine = safeEvidence ? `BuyTax: \`${safeEvidence.buyTaxBps}bps\`\n` : '';
    const sellTaxLine = safeEvidence ? `SellTax: \`${safeEvidence.sellTaxBps}bps\`\n` : '';
    await sendCtxAlert(ctx, `*New Token Detected!*\nSymbol: \`${symbol}\`\nDecimals: \`${decimals}\`\nW${ctx.chain.nativeCurrency} LP: \`${nativeLiquidity} ${ctx.chain.nativeCurrency}\`\nLocked: \`${locked ? "Yes" : "No"}\`\nHoneypot: \`${isHoneypot ? "Yes" : "No"}\`\n${buyTaxLine}${sellTaxLine}Blacklist Function: \`${isBlacklisted ? "Yes" : "No"}\`\nMaxTx/Wallet: \`${hasLimits ? "Yes" : "No"}\`\n\nToken: [\`${targetToken}\`](${ctx.chain.explorerUrl}/token/${targetToken})\nPair: [\`${pairAddress}\`](${ctx.chain.explorerUrl}/address/${pairAddress})`);

    if (isHoneypot || isBlacklisted || !locked || !sufficientLiquidity || !validMetadata || !canSwap || hasLimits || mutableResult.isMutable) {
        ctx.log.info({ token: targetToken, checks: { isHoneypot, isBlacklisted, locked, sufficientLiquidity, validMetadata, canSwap, hasLimits, mutable: mutableResult.isMutable, mutableHits: mutableResult.hits } }, 'Safety checks failed, skipping');
        return;
    }

    ctx.log.info({ token: targetToken, symbol }, 'All safety checks passed, buying');

    // Phase 20 / OPS-LIVE-08 D-KILLSWITCH-CP1 — post-safety-bank pause check.
    // Pause flag set → return BEFORE bundle construction. No expensive RPC/MEV work.
    {
        const pauseStateCp1 = getPauseState.get() as { paused: number };
        if (pauseStateCp1.paused === 1) {
            ctx.log.info({ op: 'killswitch.cp1', token: targetToken, reason: 'global-pause' }, 'CP1 pause-check: aborting before bundle construction');
            return;
        }
    }

    const path = [ctx.chain.wethAddress, targetToken];
    const deadline = Math.floor(Date.now() / 1000) + 60;
    const amountIn = ethers.parseEther(ctx.chain.snipeAmount);

    const dexRouter = new Contract(dex.routerAddress, ROUTER_ABI, ctx.wallet);

    let minOut: bigint = 0n;
    try {
        const slippage = CONFIG.slippagePercent || 5;
        const amountsOut = await dexRouter.getAmountsOut(amountIn, path);
        const expectedOut = amountsOut[1];
        minOut = expectedOut - (expectedOut * BigInt(slippage) / 100n);
    } catch {
        ctx.log.warn({ token: targetToken }, 'Failed to calculate slippage-adjusted minOut, defaulting to 0');
    }

    // Phase 20 / OPS-LIVE-08 D-KILLSWITCH-CP2 — post-bundle-build, pre-submit.
    // Pause flag set → discard built bundle, do NOT submit.
    // WR-01 NOTE: there is a TOCTOU window between the pause-read here and the
    // network call inside sendTxWithRetry (microseconds to seconds depending on
    // event-loop saturation and MEV strategy). A pause flipped DURING that
    // window will NOT abort the in-flight submit — there is no abort signal
    // threaded into sendTxWithRetry. CP3 below logs (audit only) the
    // after-the-fact case; pause never panic-sells per D-PAUSE-SHAPE.
    {
        const pauseStateCp2 = getPauseState.get() as { paused: number };
        if (pauseStateCp2.paused === 1) {
            ctx.log.info({ op: 'killswitch.cp2', token: targetToken, reason: 'global-pause' }, 'CP2 pause-check: discarding bundle before submit');
            return;
        }
    }

    // Phase 21.2 / Plan 21.2-08 (Finding A, D-EXIT-AFFORDABILITY-GATE): buy-time
    // entry affordability gate — JUST BEFORE the buy submit. NEVER enter a position
    // the wallet cannot guarantee an exit from (worst-case normal-priced public
    // sell + buffer). Fails CLOSED on RPC error inside the gate; on a refuse it
    // alerts (D-ALERTS) and we SKIP the buy. This is the thin-wallet trap (Finding
    // A) made impossible to ENTER.
    // Phase 21.3 / Plan 21.3-03 (D-BUY-AFFORDABILITY-EXTEND): the pair-event snipe
    // path is mode 'snipe' — it reserves ZERO public-buy gas it will never use (a
    // genuine snipe NEVER auto-goes-public; D-BUY-INCLUSION-PRIVATE-FIRST).
    if (!(await enforceEntryExitAffordability(ctx, targetToken, 'snipe'))) {
        return;
    }

    try {
        // D-RECORD-REAL-HASH: capture the REAL on-chain tx hash the strategy now
        // returns (post-21.1-04 it reconciles late inclusion to the real hash;
        // post-21.1-05 sendTxWithRetry's type is Promise<string>) so the buy row
        // records it instead of the 'mev_bundle' placeholder — restoring the
        // position-tracking auditability the LADYS false-negative destroyed.
        // WR-01 (21.2-13): the buy submit routes through withNonceLock via
        // submitBuyTx so it serializes with every other same-wallet signing site.
        // Phase 21.3 / Plan 21.3-03 (D-BUY-INCLUSION-PRIVATE-FIRST): mode 'snipe' —
        // private-only. The hardened multi-builder private inclusion (plan 01) is the
        // ONLY lever; a snipe NEVER reaches a public buy. On a genuine not-landed /
        // ceiling-hit the strategy THROWS → the catch below fails clean (no trades
        // row, zero spend) + a structured op:'buy.snipe.fail-clean' alert.
        const realHash = await submitBuyTx(
            ctx,
            () => ctx.wallet.populateTransaction({
                to: dex.routerAddress,
                data: dexRouter.interface.encodeFunctionData("swapExactETHForTokens", [
                    minOut,
                    path,
                    ctx.wallet.address,
                    deadline
                ]),
                value: amountIn,
            }),
            'snipe',
        );

        // Phase 20 / OPS-LIVE-08 D-KILLSWITCH-CP3 — post-MEV-submit audit log.
        // Bundle is in flight; pause flipped between submit and record-trade.
        // Trade IS recorded, exit monitor IS started. Pause never panic-sells.
        {
            const pauseStateCp3 = getPauseState.get() as { paused: number };
            if (pauseStateCp3.paused === 1) {
                ctx.log.info({ op: 'killswitch.cp3', token: targetToken, reason: 'global-pause-after-submit' }, 'CP3 pause-check: bundle already submitted, recording trade and arming exit monitor');
                // intentionally fall through — do NOT return; pause never panic-sells
            }
        }

        recordSnipe(ctx.chain.name);

        insertTrade.run({
            token: targetToken.toLowerCase(),
            chain: ctx.chain.name,
            action: 'buy',
            // D-RECORD-REAL-HASH: persist the real reconciled hash at insert time
            // (single atomic write, no schema change, no extra UPDATE). The
            // `?? 'mev_bundle'` is a belt-and-suspenders null-guard; with the
            // Promise<string> return from 21.1-05 this is always the real hash.
            txHash: realHash ?? 'mev_bundle',
            block: null,
            timestamp: Math.floor(Date.now() / 1000),
            amountIn: ctx.chain.snipeAmount,
            amountOut: null,
            gasCost: null,
            priceAtAction: null,
            status: 'pending',
            poolType: 'v2',
            feeTier: null,
            dexName: dex.name,
        });
        await sendCtxAlert(ctx, `*Buy TX sent via ${ctx.chain.mevStrategy}* for \`${symbol}\``);
        ctx.log.info({ token: targetToken, symbol, strategy: ctx.chain.mevStrategy }, 'MEV bundle submitted');
        // Plan 18-WR-07 fix-along: dropped the misleading "TX confirmed" log +
        // alert. sendTxWithRetry returns the tx hash on success but does NOT
        // wait for the transaction to be mined / confirmed (depends on MEV
        // strategy). Actual settlement status arrives later via the receipt
        // decoder, which updates the trades row from status='pending' to
        // status='sold' (or 'failed'). Emitting "TX confirmed" here would
        // mislead the operator into believing the trade settled.

        // Capture token balance for exit engine (D-07: original buy amount needed for partial sells)
        const exitTokenContract = new Contract(targetToken, ERC20_ABI, ctx.wallet);
        const originalTokenAmount: bigint = await exitTokenContract.balanceOf(ctx.wallet.address);

        // Get trade ID for exit state linkage
        const tradeRow = getTradeIdForPendingToken.get(targetToken.toLowerCase(), ctx.chain.name) as { id: number } | undefined;
        if (tradeRow) {
            // Phase 21.3 / Plan 21.3-05 (STOP-THE-LINE-06): the register->monitor
            // wiring now lives in the SINGLE shared armPositionMonitoring helper,
            // called BY BOTH this snipe handler AND executeDeliberateBuy so they can
            // never drift again. The behavior is byte-equivalent to the previous
            // inline block: startExitMonitor(ctx, dex, token, feeTier=null,
            // snipeAmount, tradeId, originalTokenAmount) FIRST, then the
            // snapshotLpBaseline + (CR-03 awaited) registerAntiRugPosition pair under
            // the op:'antirug.baseline-snapshot-failed' try/catch — the exit monitor
            // stays armed even if the anti-rug baseline fails.
            await armPositionMonitoring(ctx, dex, targetToken, pairAddress, tradeRow.id, originalTokenAmount, ctx.chain.snipeAmount);
        } else {
            ctx.log.error({ token: targetToken }, 'Could not find trade ID for exit monitor');
        }
    } catch (e) {
        // Phase 21.3 / Plan 21.3-03 (STOP-THE-LINE-05-D, D-SNIPE-FAIL-CLEAN + D-ALERTS):
        // a genuine snipe that exhausts the hardened private inclusion (multi-builder
        // fanout across N blocks still not included, or the buy ceiling is hit) FAILS
        // CLEAN — snipes NEVER auto-go-public (front-run protection preserved). The
        // trade row is written ONLY after a returned hash, so the throw means zero ETH
        // spent + NO trades row (structurally true). This adds the STRUCTURED fail-clean
        // alert: per-builder inclusion telemetry lives in the strategy's
        // op:'flashbots.bundle.stats' pino entries (NOT surfaced through the throw — see
        // statsRef); the payload carries only public values (NO FLASHBOTS_AUTH_KEY / no
        // signed raw tx).
        emitSnipeFailClean(ctx, targetToken, 'v2', null, e);
        updateTradeStatus.run('failed', targetToken.toLowerCase(), ctx.chain.name);
        await sendCtxAlert(ctx, `*TX failed* for \`${symbol}\``);
    }
}

// ---------------------------------------------------------------------------
// V3 pool handler (parallel to handleNewPairForChain)
// ---------------------------------------------------------------------------

export async function handleNewV3PoolForChain(
    ctx: ChainContext,
    dex: DexConfigV3,
    token0: string,
    token1: string,
    feeTier: number,
    poolAddress: string,
    blockNumber: number
): Promise<void> {
    const targetToken = token0.toLowerCase() === ctx.chain.wethAddress.toLowerCase()
        ? token1 : token0;

    // D-07: First pool wins dedup -- same isAlreadySniped check as V2, cross-DEX dedup
    if (isTokenSniped.get(targetToken.toLowerCase(), ctx.chain.name)) {
        ctx.log.info({ token: targetToken, feeTier }, 'Already sniped token (cross-DEX dedup), skipping V3 pool');
        return;
    }

    ctx.log.info({ pool: poolAddress, dex: dex.name, feeTier }, 'New V3 pool detected');

    if (BLOCKLIST.tokens.has(targetToken.toLowerCase())) {
        ctx.log.info({ token: targetToken }, 'Blocked token address, skipping');
        await sendCtxAlert(ctx, `*Blocked token* \`${targetToken}\``);
        return;
    }

    // V3-02: Wait for liquidity (D-01 subscribe+timeout, D-02 same-block check)
    const hasLiquidity = await waitForLiquidity(ctx, poolAddress, blockNumber);
    if (!hasLiquidity) {
        ctx.log.info({ token: targetToken, pool: poolAddress }, 'No Mint event within timeout, dropping V3 opportunity');
        await sendCtxAlert(ctx, `*V3 pool no liquidity (30s timeout)* \`${targetToken}\``);
        return;
    }

    // D-03: Minimum liquidity threshold check
    const meetsMinLiquidity = await checkMinLiquidity(ctx, dex.quoterAddress, targetToken, feeTier);
    if (!meetsMinLiquidity) {
        ctx.log.info({ token: targetToken, feeTier }, 'V3 pool below min liquidity threshold, skipping');
        await sendCtxAlert(ctx, `*V3 pool below min liquidity* \`${targetToken}\``);
        return;
    }

    const isBad = await isKnownBadTokenForChain(ctx, targetToken);
    if (isBad) {
        ctx.log.info({ token: targetToken }, 'Known bad token or creator, skipping');
        await sendCtxAlert(ctx, `*Known bad token or creator* \`${targetToken}\``);
        return;
    }

    // Risk management gate (per D-13)
    const riskResult = canSnipe(ctx.chain.name, ctx.chain.snipeAmount, ctx.chain.maxCapital);
    if (!riskResult.allowed) {
        ctx.log.warn({ token: targetToken, reason: riskResult.reason, details: riskResult.details }, 'Risk check failed, skipping V3 snipe');
        await sendCtxAlert(ctx, `*Risk: ${riskResult.details}* -- skipping V3 \`${targetToken}\``);
        return;
    }

    // HONEY-08 (plan 18-10 — iter-2 Blocker #1): in-place V3 honeypot gate —
    // dispatch via the HoneypotChecker on-chain V3 roundtrip, passing the
    // runtime feeTier through to simulateViaContractV3 (plan 18-09 V3 wrapper
    // calls checkV3 with the feeTier embedded in calldata). Replaces the
    // vacuous-pass simulateSellV3ForChain (V3 sell-sim early-returned `true`
    // on zero balance — the worst failure mode of all gates) DELETED in plan
    // 18-09 per D-ROLLBACK.
    const honeypotResult = await simulateHoneypotRoundtrip(ctx, dex, targetToken, feeTier);
    if (honeypotResult.verdict !== 'safe') {
        ctx.log.warn({
            token: targetToken,
            verdict: honeypotResult.verdict,
            reason: honeypotResult.reason,
            buyTaxBps: honeypotResult.evidence.buyTaxBps,
            sellTaxBps: honeypotResult.evidence.sellTaxBps,
            method: honeypotResult.evidence.method,
            dexType: honeypotResult.evidence.dexType,
            feeTier,
        }, 'Honeypot gate blocked V3 snipe');
        // D-ALERTS tiered skip alert
        const evBuy = honeypotResult.evidence.buyTaxBps;
        const evSell = honeypotResult.evidence.sellTaxBps;
        const taxInfo = (evBuy !== undefined && evSell !== undefined)
            ? ` tax: buy ${evBuy}bps sell ${evSell}bps`
            : '';
        // Plan 18-CR-03 fix-along: sanitize at the alert site as defense-in-depth.
        // See V2 handler at the corresponding line for full rationale.
        const safeReason = sanitizeReason(honeypotResult.reason);
        await sendCtxAlert(
            ctx,
            `*SKIP* \`${targetToken}\` -- ${honeypotResult.verdict} (${safeReason})${taxInfo}\n[Etherscan](${ctx.chain.explorerUrl}/token/${targetToken})`
        );
        return;
    }

    // Parallel safety checks (reuse existing ForChain functions -- same checks apply to V3 tokens)
    // Note: V3 has no pair address for liquidity lock checks, so we skip isLiquidityLockedForChain
    // and isLiquiditySufficientForChain (those are V2-pair-specific). V3 liquidity is checked above.
    // HONEY-12 (plan 18-10): 6th gate `isMutableTokenForChain` extends bytecode
    // mutability detection to the V3 path — protects V3 buys from
    // owner-flips-tax-mid-position attacks that the V3 roundtrip cannot catch.
    //
    // Plan 18-CR-01b fix-along: `checkHoneypotForChain` (third-party
    // honeypot.is / GoPlus HTTP API) is intentionally NOT in this V3 bank —
    // the on-chain `simulateHoneypotRoundtrip` gate above (line 459) is the
    // authoritative honeypot gate (Option D). See the V2 handler comment for
    // the full rationale. `isHoneypot` is hard-coded `false` so the existing
    // log + alert lines that reference it continue to type-check.
    // STOP-THE-LINE-01 (plan 21.1-03, D-V3-TAX-REMOVE): the V2-only
    // hasHighTransferTaxForChain call was REMOVED from this V3 bank. It passed
    // the V3 SwapRouter into a V2-router ABI (getAmountsOut / swapExactETHForTokens),
    // which reverts on the SwapRouter -> the function's catch fail-closed
    // hasTax=true -> EVERY V3 buy aborted. The on-chain simulateHoneypotRoundtrip
    // gate above (bot.ts ~566, fail-closed, HONEY-09 maxBuyTaxBps/maxSellTaxBps)
    // already enforces V3 buy+sell tax BEFORE this bank, so the removed check was
    // redundant AND broken. The whole hasHighTransferTaxForChain function was
    // deleted (zero callers after the V2 removal too) so it can never be miscalled
    // again (D-ROLLBACK).
    const [isBlacklisted, validMetadata, hasLimits, mutableResult] = await Promise.all([
        isBlacklistedTokenForChain(ctx, targetToken),
        checkTokenMetadataForChain(ctx, targetToken),
        hasMaxWalletOrTxLimitsForChain(ctx, targetToken),
        isMutableTokenForChain(ctx, targetToken),
    ]);
    const isHoneypot = false;

    const tokenContract = new Contract(targetToken, ERC20_ABI, ctx.httpProvider);
    let symbol = "?", name = "?", decimals = 18;
    try {
        [symbol, name, decimals] = await Promise.all([
            tokenContract.symbol(),
            tokenContract.name(),
            tokenContract.decimals(),
        ]);
    } catch (e) {
        ctx.log.debug({ err: e, token: targetToken }, 'Failed to fetch token metadata, using defaults');
    }

    // D-ALERTS (plan 18-10): augment the safe-path "New V3 Token Detected"
    // alert with BuyTax / SellTax bps from the V3 honeypot roundtrip evidence.
    // The discriminated-union HoneypotResult requires numeric buyTaxBps /
    // sellTaxBps on the 'safe' variant (HONEY-06), so these accesses are
    // type-safe given the verdict !== 'safe' early-return above.
    const safeEvidence = honeypotResult.verdict === 'safe' ? honeypotResult.evidence : null;
    const buyTaxLine = safeEvidence ? `BuyTax: \`${safeEvidence.buyTaxBps}bps\`\n` : '';
    const sellTaxLine = safeEvidence ? `SellTax: \`${safeEvidence.sellTaxBps}bps\`\n` : '';
    await sendCtxAlert(ctx, `*New V3 Token Detected!*\nSymbol: \`${symbol}\`\nFee Tier: \`${feeTier} bps\`\nHoneypot: \`${isHoneypot ? "Yes" : "No"}\`\n${buyTaxLine}${sellTaxLine}Blacklist Function: \`${isBlacklisted ? "Yes" : "No"}\`\nMaxTx/Wallet: \`${hasLimits ? "Yes" : "No"}\`\n\nToken: [\`${targetToken}\`](${ctx.chain.explorerUrl}/token/${targetToken})\nPool: [\`${poolAddress}\`](${ctx.chain.explorerUrl}/address/${poolAddress})`);

    if (isHoneypot || isBlacklisted || !validMetadata || hasLimits || mutableResult.isMutable) {
        ctx.log.info({ token: targetToken, checks: { isHoneypot, isBlacklisted, validMetadata, hasLimits, mutable: mutableResult.isMutable, mutableHits: mutableResult.hits } }, 'Safety checks failed, skipping V3 snipe');
        return;
    }

    ctx.log.info({ token: targetToken, symbol, feeTier }, 'All V3 safety checks passed, buying');

    // Phase 20 / OPS-LIVE-08 D-KILLSWITCH-CP1 (V3 path)
    {
        const pauseStateCp1 = getPauseState.get() as { paused: number };
        if (pauseStateCp1.paused === 1) {
            ctx.log.info({ op: 'killswitch.cp1', token: targetToken, feeTier, reason: 'global-pause' }, 'V3 CP1 pause-check: aborting before V3 bundle construction');
            return;
        }
    }

    const amountIn = ethers.parseEther(ctx.chain.snipeAmount);

    // Calculate minOut via QuoterV2 with slippage (V3-03)
    let minOut: bigint = 0n;
    try {
        const quoter = new Contract(dex.quoterAddress, V3_QUOTER_V2_ABI, ctx.httpProvider);
        const quoteParams = {
            tokenIn: ctx.chain.wethAddress,
            tokenOut: targetToken,
            amountIn: amountIn,
            fee: feeTier,
            sqrtPriceLimitX96: 0n,
        };
        const [expectedOut] = await quoter.quoteExactInputSingle.staticCall(quoteParams);
        const slippage = CONFIG.slippagePercent || 5;
        minOut = expectedOut - (expectedOut * BigInt(slippage) / 100n);
    } catch {
        ctx.log.warn({ token: targetToken }, 'Failed to get V3 quote for slippage calc, defaulting minOut to 0');
    }

    try {
        // V3-03: Buy via SwapRouter02 exactInputSingle with multicall deadline wrapper
        const v3Router = new Contract(dex.swapRouterAddress, V3_SWAP_ROUTER_ABI, ctx.wallet);
        const deadline = Math.floor(Date.now() / 1000) + 60;

        const swapParams = {
            tokenIn: ctx.chain.wethAddress,
            tokenOut: targetToken,
            fee: feeTier,
            recipient: ctx.wallet.address,
            amountIn: amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0n,  // D-05: pass 0, rely on amountOutMinimum for slippage protection
        };

        // Use multicall for deadline enforcement on SwapRouter02 (Pitfall 1: no deadline in struct)
        const swapData = v3Router.interface.encodeFunctionData('exactInputSingle', [swapParams]);

        // Phase 20 / OPS-LIVE-08 D-KILLSWITCH-CP2 (V3 path)
        // WR-01 NOTE: TOCTOU window between this pause-read and the network
        // call inside sendTxWithRetry — pause flipped during that window will
        // NOT abort the in-flight submit. CP3 logs the after-the-fact case.
        {
            const pauseStateCp2 = getPauseState.get() as { paused: number };
            if (pauseStateCp2.paused === 1) {
                ctx.log.info({ op: 'killswitch.cp2', token: targetToken, feeTier, reason: 'global-pause' }, 'V3 CP2 pause-check: discarding V3 bundle before submit');
                return;
            }
        }

        // Phase 21.2 / Plan 21.2-08 (Finding A, D-EXIT-AFFORDABILITY-GATE): buy-time
        // entry affordability gate on the V3 path — identical posture to V2. The
        // thin-wallet trap is the same on both paths, so the gate (single source of
        // truth in preflight.checkEntryExitAffordability) guards BOTH. Fails CLOSED
        // on RPC error; on a refuse it alerts (D-ALERTS) and SKIPS the buy.
        // Phase 21.3 / Plan 21.3-03 (D-BUY-AFFORDABILITY-EXTEND): the V3 pair-event
        // snipe path is mode 'snipe' — identical posture to V2; reserves ZERO
        // public-buy gas (a snipe never auto-goes-public; D-BUY-INCLUSION-PRIVATE-FIRST).
        if (!(await enforceEntryExitAffordability(ctx, targetToken, 'snipe'))) {
            return;
        }

        // D-RECORD-REAL-HASH (V3): capture the real on-chain hash the strategy
        // returns so the V3 buy row records it instead of the 'mev_bundle'
        // placeholder (see the V2 analog above; CONTEXT names both bot.ts:429 V2
        // and :728 V3 for consistent landed-buy auditability).
        // WR-01 (21.2-13): the V3 buy submit routes through withNonceLock via
        // submitBuyTx (identical posture to V2) so it serializes with every other
        // same-wallet signing site.
        // Phase 21.3 / Plan 21.3-03 (D-BUY-INCLUSION-PRIVATE-FIRST): mode 'snipe' —
        // private-only. A snipe NEVER reaches a public buy; on a not-landed/ceiling-hit
        // throw the catch fails clean (no trades row, zero spend) + the fail-clean alert.
        const realHash = await submitBuyTx(
            ctx,
            () => ctx.wallet.populateTransaction({
                to: dex.swapRouterAddress,
                data: v3Router.interface.encodeFunctionData('multicall', [deadline, [swapData]]),
                value: amountIn,  // Pitfall 5: send ETH value since tokenIn is WETH
            }),
            'snipe',
        );

        // Phase 20 / OPS-LIVE-08 D-KILLSWITCH-CP3 (V3 path) — audit log only
        {
            const pauseStateCp3 = getPauseState.get() as { paused: number };
            if (pauseStateCp3.paused === 1) {
                ctx.log.info({ op: 'killswitch.cp3', token: targetToken, feeTier, reason: 'global-pause-after-submit' }, 'V3 CP3 pause-check: bundle already submitted');
                // intentionally fall through — do NOT return; pause never panic-sells
            }
        }

        recordSnipe(ctx.chain.name);

        insertTrade.run({
            token: targetToken.toLowerCase(),
            chain: ctx.chain.name,
            action: 'buy',
            // D-RECORD-REAL-HASH (V3): persist the real reconciled hash atomically
            // at insert time (no schema change, no extra UPDATE). The
            // `?? 'mev_bundle'` null-guard is belt-and-suspenders; with the
            // Promise<string> return from 21.1-05 this is always the real hash.
            txHash: realHash ?? 'mev_bundle',
            block: null,
            timestamp: Math.floor(Date.now() / 1000),
            amountIn: ctx.chain.snipeAmount,
            amountOut: null,
            gasCost: null,
            priceAtAction: null,
            status: 'pending',
            poolType: 'v3',
            feeTier: feeTier,
            dexName: dex.name,
        });

        await sendCtxAlert(ctx, `*V3 Buy TX sent via ${ctx.chain.mevStrategy}* for \`${symbol}\` (fee: ${feeTier}bps)`);
        ctx.log.info({ token: targetToken, symbol, strategy: ctx.chain.mevStrategy, feeTier }, 'V3 MEV bundle submitted');
        // Plan 18-WR-07 fix-along: dropped the misleading "V3 TX confirmed"
        // log + alert (same rationale as V2 handler — see comment there).

        // Capture token balance for exit engine (D-07)
        const exitTokenContract = new Contract(targetToken, ERC20_ABI, ctx.wallet);
        const originalTokenAmount: bigint = await exitTokenContract.balanceOf(ctx.wallet.address);

        const tradeRow = getTradeIdForPendingToken.get(targetToken.toLowerCase(), ctx.chain.name) as { id: number } | undefined;
        if (tradeRow) {
            await startExitMonitor(ctx, dex, targetToken, feeTier, ctx.chain.snipeAmount, tradeRow.id, originalTokenAmount);

            // Phase 19 / Plan 19-05 — parallel anti-rug attach (V3). Threads
            // poolAddress + feeTier into snapshotLpBaseline + registerAntiRugPosition.
            // Baseline failure → log + skip register; position is UNMONITORED but
            // standard exit monitor remains active.
            try {
                await snapshotLpBaseline(ctx, dex, tradeRow.id, poolAddress, feeTier);
                // CR-03: same async-not-awaited issue on the V3 path.
                await registerAntiRugPosition(ctx, dex, targetToken, poolAddress, tradeRow.id, feeTier);
            } catch (err) {
                ctx.log.error(
                    {
                        err,
                        op: 'antirug.baseline-snapshot-failed',
                        tradeId: tradeRow.id,
                        pool: poolAddress,
                        feeTier,
                    },
                    'Anti-rug V3 baseline snapshot failed; position UNMONITORED',
                );
            }
        } else {
            ctx.log.error({ token: targetToken }, 'Could not find V3 trade ID for exit monitor');
        }
    } catch (e) {
        // Phase 21.3 / Plan 21.3-03 (STOP-THE-LINE-05-D, D-SNIPE-FAIL-CLEAN + D-ALERTS):
        // a genuine V3 snipe that exhausts hardened private inclusion FAILS CLEAN
        // (identical posture to V2) — zero ETH spent, NO trades row, structured
        // op:'buy.snipe.fail-clean' alert. The snipe never auto-goes-public.
        emitSnipeFailClean(ctx, targetToken, 'v3', feeTier, e);
        updateTradeStatus.run('failed', targetToken.toLowerCase(), ctx.chain.name);
        await sendCtxAlert(ctx, `*V3 TX failed* for \`${symbol}\``);
    }
}

// ---------------------------------------------------------------------------
// WebSocket listener with auto-reconnect (per D-11)
// ---------------------------------------------------------------------------

export async function startDexListener(
    ctx: ChainContext,
    dex: DexConfig,
    _registry: Map<string, ChainConfig>
): Promise<void> {
    const wsProvider = ctx.wsProvider;
    if (!wsProvider) {
        ctx.log.warn({ dex: dex.name }, 'No WebSocket URL configured, using HTTP polling fallback');
        startHttpPollingListener(ctx, dex);
        return;
    }

    // Branch based on DEX type
    if (isDexV3(dex)) {
        // V3: Subscribe to PoolCreated events (V3-01, D-06: all fee tiers)
        const v3Factory = new Contract(dex.factoryAddress, V3_FACTORY_ABI, wsProvider);
        const v3Listener = (token0: string, token1: string, fee: bigint, _tickSpacing: bigint, pool: string, event: any) => {
            const feeTier = Number(fee);
            const blockNumber = event?.log?.blockNumber ?? 0;
            handleNewV3PoolForChain(ctx, dex, token0, token1, feeTier, pool, blockNumber);
        };

        v3Factory.on('PoolCreated', v3Listener);
        ctx.log.info({ dex: dex.name, factory: dex.factoryAddress }, 'Listening for V3 PoolCreated events via WebSocket');

        // Reconnect handling for V3
        let reconnectDelay = 1000;
        const maxDelay = 60000;

        async function handleWsCloseV3(): Promise<void> {
            ctx.log.warn({ dex: dex.name, delay: reconnectDelay }, 'WebSocket disconnected (V3), reconnecting');
            await sendCtxAlert(ctx, `WebSocket disconnected for ${dex.name}, reconnecting...`);
            removeWsProvider(ctx.chain.name);

            while (true) {
                await new Promise(r => setTimeout(r, reconnectDelay));
                reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
                try {
                    const newWsProvider = new WebSocketProvider(ctx.chain.wsRpcUrl!, ctx.chain.chainId);
                    ctx.wsProvider = newWsProvider;
                    const newV3Factory = new Contract(dex.factoryAddress, V3_FACTORY_ABI, newWsProvider);
                    newV3Factory.on('PoolCreated', v3Listener);
                    reconnectDelay = 1000;
                    ctx.log.info({ dex: dex.name }, 'WebSocket reconnected, re-subscribed to V3 PoolCreated');
                    await sendCtxAlert(ctx, `WebSocket reconnected for ${dex.name}`);
                    (newWsProvider.websocket as any).on('close', handleWsCloseV3);
                    break;
                } catch (err) {
                    ctx.log.error({ err, dex: dex.name, delay: reconnectDelay }, 'V3 reconnect failed, will retry');
                }
            }
        }

        (wsProvider.websocket as any).on('close', handleWsCloseV3);
        return;
    }

    // V2: existing PairCreated logic
    const dexFactory = new Contract(dex.factoryAddress, FACTORY_ABI, wsProvider);
    const listener = (token0: string, token1: string, pair: string) => {
        handleNewPairForChain(ctx, dex as DexConfigV2, token0, token1, pair);
    };

    dexFactory.on('PairCreated', listener);
    ctx.log.info({ dex: dex.name, factory: dex.factoryAddress }, 'Listening for PairCreated events via WebSocket');

    // Reconnect handling (per D-11)
    let reconnectDelay = 1000;
    const maxDelay = 60000;

    async function handleWsClose(): Promise<void> {
        ctx.log.warn({ dex: dex.name, delay: reconnectDelay }, 'WebSocket disconnected, reconnecting');
        await sendCtxAlert(ctx, `WebSocket disconnected for ${dex.name}, reconnecting...`);
        removeWsProvider(ctx.chain.name);

        while (true) {
            await new Promise(r => setTimeout(r, reconnectDelay));
            reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);

            try {
                const newWsProvider = new WebSocketProvider(ctx.chain.wsRpcUrl!, ctx.chain.chainId);
                ctx.wsProvider = newWsProvider;
                const newFactory = new Contract(dex.factoryAddress, FACTORY_ABI, newWsProvider);
                newFactory.on('PairCreated', listener);
                reconnectDelay = 1000;
                ctx.log.info({ dex: dex.name }, 'WebSocket reconnected, re-subscribed to PairCreated');
                await sendCtxAlert(ctx, `WebSocket reconnected for ${dex.name}`);
                (newWsProvider.websocket as any).on('close', handleWsClose);
                break;
            } catch (err) {
                ctx.log.error({ err, dex: dex.name, delay: reconnectDelay }, 'Reconnect failed, will retry');
            }
        }
    }

    (wsProvider.websocket as any).on('close', handleWsClose);
}

// ---------------------------------------------------------------------------
// HTTP polling fallback for chains without WebSocket
// ---------------------------------------------------------------------------

async function startHttpPollingListener(ctx: ChainContext, dex: DexConfig): Promise<void> {
    if (isDexV3(dex)) {
        return startHttpPollingV3Listener(ctx, dex);
    }

    // V2 HTTP polling
    const dexFactory = new Contract(dex.factoryAddress, FACTORY_ABI, ctx.httpProvider);
    let lastBlock = await ctx.httpProvider.getBlockNumber();

    ctx.log.info({ dex: dex.name, factory: dex.factoryAddress, startBlock: lastBlock }, 'Listening for PairCreated events via HTTP polling');

    setInterval(async () => {
        try {
            const currentBlock = await ctx.httpProvider.getBlockNumber();
            if (currentBlock <= lastBlock) return;

            const events = await dexFactory.queryFilter('PairCreated', lastBlock + 1, currentBlock);
            for (const event of events) {
                if (event instanceof EventLog && event.args) {
                    handleNewPairForChain(ctx, dex as DexConfigV2, event.args[0], event.args[1], event.args[2]);
                }
            }
            lastBlock = currentBlock;
        } catch (err) {
            ctx.log.error({ err, dex: dex.name }, 'HTTP polling error');
        }
    }, 2000); // poll every 2 seconds
}

async function startHttpPollingV3Listener(ctx: ChainContext, dex: DexConfigV3): Promise<void> {
    const v3Factory = new Contract(dex.factoryAddress, V3_FACTORY_ABI, ctx.httpProvider);
    let lastBlock = await ctx.httpProvider.getBlockNumber();

    ctx.log.info({ dex: dex.name, factory: dex.factoryAddress, startBlock: lastBlock }, 'Listening for V3 PoolCreated events via HTTP polling');

    setInterval(async () => {
        try {
            const currentBlock = await ctx.httpProvider.getBlockNumber();
            if (currentBlock <= lastBlock) return;

            const events = await v3Factory.queryFilter('PoolCreated', lastBlock + 1, currentBlock);
            for (const event of events) {
                if (event instanceof EventLog && event.args) {
                    const feeTier = Number(event.args[2]); // fee is the 3rd arg
                    handleNewV3PoolForChain(ctx, dex, event.args[0], event.args[1], feeTier, event.args[4], event.blockNumber);
                }
            }
            lastBlock = currentBlock;
        } catch (err) {
            ctx.log.error({ err, dex: dex.name }, 'V3 HTTP polling error');
        }
    }, 2000);
}

// ---------------------------------------------------------------------------
// Multi-chain bot orchestrator (replaces startBot)
// ---------------------------------------------------------------------------

export async function startMultiChainBot(): Promise<void> {
    const mainLog = logger.child({ module: 'bot' });
    mainLog.info('Starting multi-chain bot');

    // 1. Build chain registry
    const registry = buildChainRegistry();

    // Phase 20 / OPS-LIVE-01: preflight before any chain context creation.
    // Performs per-chain wallet/RPC/MEV/checker checks + cross-env validation.
    // FATAL non-zero exit if any check fails on any chain (collect-all-then-exit
    // per D-PREFLIGHT-FLOW). NO escape hatch per D-ROLLBACK.
    //
    // Note: the previous inline chainId / RPC-connect FATAL block now lives in
    // src/preflight.ts checkRpcChainId and runs as part of preflight() above
    // — removed below to avoid duplicate checking.
    //
    // PreflightRegistry shape adapter: preflight() needs httpProvider + wallet
    // alongside each chain config. We attach them here (using the same per-chain
    // provider/wallet helpers the chain-context loop uses below) so preflight
    // can run BEFORE chain-context creation per OPS-LIVE-01.
    const preflightRegistry = new Map<string, unknown>();
    for (const [name, chain] of registry) {
        const httpProvider = getProvider(chain.name, chain.httpRpcUrl);
        const wallet = getWallet(chain.name, chain.httpRpcUrl);
        preflightRegistry.set(name, { ...chain, httpProvider, wallet });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await preflight(preflightRegistry as any);

    // 2. For each enabled chain
    const contexts: ChainContext[] = [];
    for (const chain of getEnabledChains(registry)) {
        const ctx = createChainContext(chain);

        // 3. MEV health check (per D-07) — kept as a warn-and-continue so the
        // bot still boots if MEV recovers later in the runtime. The FATAL path
        // for fully-broken MEV also fires inside preflight() above (Plan 20-02
        // checkMevHealth), so a hard-down MEV will have already exited before
        // this point.
        const strategy = createMevStrategy(chain);
        const mevHealthy = await strategy.healthCheck();
        if (!mevHealthy) {
            mainLog.warn({ chain: chain.name }, 'MEV service unreachable at startup -- chain will run but snipes will be rejected until MEV recovers');
            await sendCtxAlert(ctx, 'MEV service unreachable at startup');
        }

        contexts.push(ctx);

        // 4. Start listeners per DEX (per D-03, D-10)
        for (const dex of chain.dexes) {
            await startDexListener(ctx, dex, registry);
        }

        ctx.log.info({ dexCount: chain.dexes.length }, 'Chain listeners started');
    }

    // 5. Periodic MEV health check every 5 minutes (per D-07)
    setInterval(async () => {
        for (const ctx of contexts) {
            const strategy = createMevStrategy(ctx.chain);
            const healthy = await strategy.healthCheck();
            if (!healthy) {
                ctx.log.warn('MEV service unreachable during periodic check');
                await sendCtxAlert(ctx, 'MEV service unreachable -- snipes will be rejected');
            }
        }
    }, 5 * 60 * 1000);

    // Phase 20 / D-MID-RUN-CHECK / OPS-LIVE-02 — periodic wallet balance re-check.
    // Reuses the same setInterval pattern as the MEV health check above. On
    // undercut: flip global pause flag (paused_by='preflight') + broadcast
    // pause_state_change to dashboard + Telegram alert + pino fatal log.
    // Exit monitors keep running per D-PAUSE-SHAPE; operator must refund + resume.
    //
    // T-20-04 idempotence: the if-guard against currentPause.paused === 1
    // skips the DB write + broadcast + alert so a sustained undercut does not
    // flood the operator. One alert per pause-cycle (cleared on resume).
    // WR-07: validate MID_RUN_CHECK_INTERVAL_SEC. Previously bad values silently
    // misbehaved: 'abc' → NaN → setInterval(cb, NaN) → fires every event-loop tick,
    // hammering RPC + DB; '0' → '0'||'300' = '300' (incidental safe behavior but
    // not designed). Use ?? and reject anything non-finite or < 10s.
    const midRunRaw = process.env.MID_RUN_CHECK_INTERVAL_SEC ?? '300';
    const midRunSec = Number(midRunRaw);
    if (!Number.isFinite(midRunSec) || midRunSec < 10) {
        mainLog.fatal(
            { key: 'MID_RUN_CHECK_INTERVAL_SEC', value: midRunRaw },
            'MID_RUN_CHECK_INTERVAL_SEC must be a finite number >= 10 seconds',
        );
        process.exit(1);
    }
    const midRunIntervalMs = midRunSec * 1000;
    setInterval(async () => {
        for (const ctx of contexts) {
            const pchain = { ...ctx.chain, httpProvider: ctx.httpProvider, wallet: ctx.wallet };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await checkWalletBalance(pchain as any);
            if (!result.passed) {
                // T-20-04 idempotence: skip duplicate alerts when already paused
                const currentPause = getPauseState.get() as { paused: number };
                if (currentPause.paused !== 1) {
                    setPauseState.run(Math.floor(Date.now() / 1000), 'preflight', result.reason ?? 'wallet undercut');
                    // CR-04: force WAL fsync so the auto-pause survives SIGKILL + restart.
                    // Mid-run undercut is the most safety-critical pause path; if this write
                    // is lost the bot restarts believing it can still buy with insufficient gas.
                    forceWalCheckpoint();
                    broadcast('pause_state_change', { paused: true, pausedBy: 'preflight', reason: result.reason });
                    ctx.log.fatal({ ...result }, 'Mid-run wallet balance check failed; bot paused');
                    await sendCtxAlert(ctx, `*BOT PAUSED* (wallet undercut) -- ${result.reason}`);
                }
            }
        }
    }, midRunIntervalMs);

    // 7. Resume monitoring for pending trades (chain-aware)
    resumeMultiChainMonitoring(contexts);

    // Phase 19 / Plan 19-05 — resume anti-rug monitoring for pending trades
    // after exit-engine resume. The lifecycle ordering is intentional:
    // exit-engine first (so existing trailing-stop / stop-loss timers re-arm
    // before the anti-rug detector starts re-evaluating events), then
    // anti-rug. Allowlist verification (D-LIST-VERIFY) runs per chain inside
    // resumeAntiRugMonitoring before the per-position re-register loop.
    await resumeAntiRugMonitoring(contexts);

    // 7.5. Build onRestart callback for chain restart via dashboard (revised D-09)
    const onRestart = async (ctx: ChainContext): Promise<{ warnings: string[] }> => {
        const warnings: string[] = [];

        // D-11: Reconnect WebSocket provider if disconnected
        if (!ctx.wsProvider || ctx.wsProvider.destroyed) {
            if (ctx.chain.wsRpcUrl) {
                removeWsProvider(ctx.chain.name);
                const newWs = getWsProvider(ctx.chain.name, ctx.chain.wsRpcUrl, ctx.chain.chainId);
                ctx.wsProvider = newWs;
                ctx.log.info('WebSocket provider reconnected for chain restart');
            } else {
                warnings.push('No WebSocket URL configured, using HTTP polling');
            }
        }

        // D-10: MEV health check (warn only, don't block)
        try {
            const strategy = createMevStrategy(ctx.chain);
            const mevHealthy = await strategy.healthCheck();
            if (!mevHealthy) {
                warnings.push('MEV service unreachable');
                ctx.log.warn('MEV service unreachable during chain restart');
            }
        } catch (err) {
            warnings.push(`MEV health check failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Re-attach listeners per DEX (D-12: collect per-DEX results)
        for (const dex of ctx.chain.dexes) {
            try {
                await startDexListener(ctx, dex, registry);
                ctx.log.info({ dex: dex.name }, 'DEX listener restarted');
            } catch (err) {
                const msg = `Failed to restart ${dex.name}: ${err instanceof Error ? err.message : String(err)}`;
                warnings.push(msg);
                ctx.log.error({ err, dex: dex.name }, 'Failed to restart DEX listener');
            }
        }

        if (warnings.length > 0) {
            ctx.log.warn({ warnings }, 'Chain restarted with warnings');
        }

        return { warnings };
    };

    // 7.6. Declare telegram handle before starting API server (closure captures mutable reference)
    let telegramHandle: TelegramListenerHandle = { client: null, connected: false };

    // 7.7. Start API/dashboard server with onRestart and telegram status getter (per D-03, revised D-09)
    const apiServer = startApiServer(contexts, onRestart, () => ({
        connected: telegramHandle.connected,
        error: !telegramHandle.connected ? 'Not connected' : null,
    }));
    mainLog.info('API server started');

    // 7.8. Start Telegram listener (D-13, D-14, D-15)
    try {
        telegramHandle = await startTelegramListener(contexts);
        if (telegramHandle.connected) {
            mainLog.info('Telegram listener integrated into orchestrator');
        } else {
            mainLog.info('Telegram listener skipped (not configured or failed to connect)');
        }
    } catch (err) {
        mainLog.error({ err }, 'Unexpected error starting Telegram listener');
    }

    // 8a. Exit-worker watchdog (Finding B layer 1, D-WATCHDOG-ABORT) — bound each
    // serial-worker submit by WATCHDOG_BUDGET_MS so no single hung submit parks
    // the loop; on overrun it frees the worker + alerts + keeps the bot alive.
    installExitWatchdog();

    // 8b. Shutdown handler (D-20: includes telegram disconnect; Finding B layer 2
    // two-stage SIGINT)
    initMultiChainShutdownHandler(contexts, apiServer, telegramHandle);

    mainLog.info({ chains: contexts.map(c => c.chain.name) }, 'Multi-chain bot fully started');
}

// ---------------------------------------------------------------------------
// Resume monitoring for pending trades across all chains
// ---------------------------------------------------------------------------

export function resumeMultiChainMonitoring(contexts: ChainContext[]): void {
    // Phase 21.2-11 / STOP-THE-LINE-04-D / S-1: the restart-resume set is the UNION
    // of (a) healthy open buys (status='pending' AND action='buy') and (b) every
    // position whose exit_state row is stamped 'exit_failed_held' — REGARDLESS of
    // its trades.status (the balance-truth catch stamps a still-held failed exit
    // 'failed' for operator visibility, exitEngine.ts:1054). Before this fix the
    // scan filtered 'pending' only, so a catch-path exit_failed_held row was
    // SILENTLY DROPPED on reboot (no exit monitor) — the LADYS-class harm surviving
    // a restart (T-21.2-DROPRUG). getResumeExitMonitorTrades carries an
    // `is_failed_held` discriminator so each resumed failed-held position is logged
    // (D-ALERTS). The balanceOf guard below stays the SOURCE OF TRUTH: a genuinely-
    // closed position (balance ~0) is left closed, never resurrected (T-21.2-RESURRECT).
    const pendingTrades = getResumeExitMonitorTrades.all() as {
        token: string;
        chain: string;
        pool_type: string;
        fee_tier: number | null;
        id: number;
        is_failed_held: number;
    }[];

    for (const trade of pendingTrades) {
        const { token, chain: chainName } = trade;
        const ctx = contexts.find(c => c.chain.name === chainName);
        if (!ctx) {
            log.warn({ token, chain: chainName }, 'No active context for chain, skipping resume');
            continue;
        }

        if (trade.is_failed_held) {
            // D-ALERTS (Phase 21.2-11 / S-1): a failed-still-held position is being
            // re-entered into monitoring across a reboot. This is the crown-jewel
            // restart-resume — surface it on a distinct dotted op so the operator
            // sees that rug-exposed, exit-failed positions survived the restart.
            ctx.log.info(
                { token, poolType: trade.pool_type, tradeId: trade.id, op: 'exit.failed-held.resumed' },
                'Resuming exit monitor for an exit_failed_held position (still-held failed exit re-armed across restart)',
            );
        }

        ctx.log.info({ token, poolType: trade.pool_type, tradeId: trade.id }, 'Resuming exit monitor for pending token');
        const tokenContract = new Contract(token, ERC20_ABI, ctx.wallet);
        tokenContract.balanceOf(ctx.wallet.address).then(async (balance: bigint) => {
            if (balance === 0n) {
                ctx.log.info({ token }, 'Zero balance for pending token, marking as failed');
                updateTradeStatus.run('failed', token, chainName);
                return;
            }

            // Find appropriate DEX for this position
            if (trade.pool_type === 'v3' && trade.fee_tier != null) {
                const v3Dex = ctx.chain.dexes.find(d => isDexV3(d)) as DexConfigV3 | undefined;
                if (!v3Dex) {
                    ctx.log.warn({ token }, 'No V3 DEX configured for chain, skipping resume');
                    return;
                }
                await resumeExitMonitor(ctx, v3Dex, token, trade.fee_tier, ctx.chain.snipeAmount, trade.id);
            } else {
                const v2Dex = ctx.chain.dexes.find(d => isDexV2(d)) as DexConfigV2 | undefined;
                if (!v2Dex) {
                    ctx.log.warn({ token }, 'No V2 DEX configured for chain, skipping resume');
                    return;
                }
                await resumeExitMonitor(ctx, v2Dex, token, null, ctx.chain.snipeAmount, trade.id);
            }
        }).catch((e: unknown) => {
            ctx.log.error({ err: e, token }, 'Error checking balance for pending token');
        });
    }
}

// ---------------------------------------------------------------------------
// Phase 19 / Plan 19-05 — resume anti-rug monitoring across all chains
// ---------------------------------------------------------------------------

/**
 * Restart-time anti-rug resume. For every enabled chain:
 *   1. verifyAllowlistAtStartup — D-LIST-VERIFY getCode() check on every
 *      hardcoded + env-overlay allowlist address. process.exit(1) inside
 *      verify on any EOA; if we reach the catch the call itself failed
 *      (e.g. RPC unavailable) — log + continue (chain runs UNMONITORED).
 *   2. SELECT t.id, t.token, t.chain, t.pool_type, t.fee_tier,
 *      b.pair_or_pool_address FROM trades t INNER JOIN lp_baseline b ON
 *      b.trade_id = t.id WHERE t.status = 'pending' AND t.action = 'buy'.
 *      The INNER JOIN naturally excludes pre-Phase-19 trades that lack a
 *      baseline row (CONTEXT.md "Real capital context" — bot has zero open
 *      positions at ship time so this only matters defensively).
 *   3. For each open trade, locate the matching DexConfig by `pool_type`
 *      and call registerAntiRugPosition. Detector's restart-resume path
 *      (Plan 19-04c) carries the WS lifecycle from here.
 *   4. Per-chain startChainAntiRugListener — arms heartbeat + reconnect +
 *      backfill via the lifecycle layer.
 *
 * Called from startMultiChainBot once at boot, AFTER resumeMultiChainMonitoring
 * so the exit-engine timers are armed first before anti-rug events start
 * dispatching.
 */
export async function resumeAntiRugMonitoring(contexts: ChainContext[]): Promise<void> {
    // Step 1 — per-chain allowlist verification per D-LIST-VERIFY. Serial
    // (one chain at a time) keeps the startup log readable + the fail-loud
    // process.exit semantics intact. If verifyAllowlistAtStartup throws
    // (RPC unavailable etc.), that chain continues unmonitored.
    //
    // CR-04: track which chains successfully verified so Steps 3 + 4 can
    // skip the unverified ones. Previously, a chain that failed verify
    // would still re-register positions AND arm the WS listener — the
    // detector would then dispatch against an UNVERIFIED allowlist
    // (potentially EOA-laden, since that's exactly what verify checks
    // for via getCode). The log claimed "chain runs without anti-rug
    // monitoring" but in fact monitoring was active with an unverified
    // allowlist. A flaky boot-time RPC could leave the allowlist as a
    // leak vector (any LP transfer to an EOA-typo'd address would be
    // allowlisted → no exit). Now, failing verify hard-skips Steps 3 + 4
    // for that chain — the chain truly runs without anti-rug monitoring,
    // consistent with the documented operator-visible behavior.
    const verifiedChains = new Set<string>();
    for (const ctx of contexts) {
        try {
            await verifyAllowlistAtStartup(
                ctx,
                ctx.chain.antiRug.allowlistV2,
                ctx.chain.antiRug.allowlistV3,
            );
            verifiedChains.add(ctx.chain.name);
        } catch (err) {
            ctx.log.error(
                {
                    err,
                    chain: ctx.chain.name,
                    op: 'antirug.allowlist-verify-rpc-failed',
                },
                'Allowlist verify RPC failed; chain runs without anti-rug monitoring',
            );
            // Continue to the next chain — the chain itself stays up but
            // anti-rug is silently disabled on that chain. Surfaces via the
            // dashboard's per-chain WS health indicator (Plan 19-06).
            continue;
        }
    }

    // Step 2 — scan trades INNER JOIN lp_baseline for the restart-resume set.
    //
    // Phase 21.2-11 / STOP-THE-LINE-04-D / S-1: the set is the UNION of healthy
    // open buys (status='pending') AND every exit_failed_held position — regardless
    // of its trades.status='failed' (the balance-truth catch stamp, exitEngine.ts:
    // 1054). Before this fix the scan filtered 'pending' only, so a still-held
    // failed exit LOST its anti-rug re-registration on reboot — the exact LADYS-
    // class harm (T-21.2-DROPRUG) surviving a restart. getResumeAntiRugTrades still
    // INNER JOINs lp_baseline (the registerAntiRugPosition precondition), so an
    // exit_failed_held position that lacks a baseline row is naturally excluded —
    // that is the pre-Phase-19 gap, which we LOG below (not silently drop).
    const openTrades = getResumeAntiRugTrades.all() as Array<{
        id: number;
        token: string;
        chain: string;
        pool_type: 'v2' | 'v3';
        fee_tier: number | null;
        pair_or_pool_address: string;
        is_failed_held: number;
    }>;

    // The exit_failed_held trade_ids that DID survive the lp_baseline INNER JOIN
    // (so we can log which failed-held positions are re-registered, and detect
    // which were EXCLUDED for lacking a baseline — the pre-Phase-19 gap).
    const resumedFailedHeldIds = new Set(
        openTrades.filter((t) => t.is_failed_held).map((t) => t.id),
    );
    // Any exit_failed_held row absent from the lp_baseline-joined set lacks a
    // baseline → registerAntiRugPosition's loadLpBaseline precondition is unmet.
    // Log it (operator-visible) rather than letting the INNER JOIN drop it silently.
    const failedHeldIdsNeedingResume = (
        getResumeExitMonitorTrades.all() as Array<{ id: number; is_failed_held: number }>
    ).filter((t) => t.is_failed_held).map((t) => t.id);
    for (const fhId of failedHeldIdsNeedingResume) {
        if (!resumedFailedHeldIds.has(fhId)) {
            log.warn(
                { tradeId: fhId, op: 'antirug.resume.failed-held-no-baseline' },
                'exit_failed_held position has no lp_baseline row — cannot re-register anti-rug on restart (pre-Phase-19 gap); left unmonitored',
            );
        }
    }

    // Step 3 — re-register each open position into the per-chain anti-rug
    // dispatch table. CR-04: skip positions on chains that failed verify.
    for (const trade of openTrades) {
        if (!verifiedChains.has(trade.chain)) {
            log.warn(
                {
                    tradeId: trade.id,
                    chain: trade.chain,
                    op: 'antirug.resume.skip-unverified-chain',
                },
                'Skipping anti-rug position register — chain failed allowlist verify at startup',
            );
            continue;
        }
        const ctx = contexts.find(c => c.chain.name === trade.chain);
        if (!ctx) {
            log.warn(
                { tradeId: trade.id, chain: trade.chain, op: 'antirug.resume.no-context' },
                'Cannot resume anti-rug — no active context for chain',
            );
            continue;
        }
        // Find the DexConfig matching pool_type — first V2 dex for V2
        // positions, the V3 dex for V3 positions.
        const dex = ctx.chain.dexes.find(d => d.dexType === trade.pool_type);
        if (!dex) {
            ctx.log.error(
                {
                    tradeId: trade.id,
                    poolType: trade.pool_type,
                    op: 'antirug.resume.no-dex',
                },
                'Cannot resume anti-rug — no matching DEX for trade pool_type',
            );
            continue;
        }
        if (trade.is_failed_held) {
            // D-ALERTS (Phase 21.2-11 / S-1): re-registering anti-rug for a
            // failed-still-held position across a reboot — the crown-jewel
            // invariant (a still-held exit-failed position never loses rug
            // protection just because the process died).
            ctx.log.info(
                { tradeId: trade.id, token: trade.token, op: 'exit.failed-held.resumed' },
                'Re-registering anti-rug for an exit_failed_held position across restart',
            );
        }
        await registerAntiRugPosition(
            ctx,
            dex,
            trade.token,
            trade.pair_or_pool_address,
            trade.id,
            trade.fee_tier,
        );
    }

    // Step 4 — arm per-chain WS lifecycle (heartbeat + reconnect + backfill).
    // The listener naturally fires backfill via Plan 19-04c's first-call hook.
    // CR-04: skip the WS listener for chains that failed verify.
    for (const ctx of contexts) {
        if (!verifiedChains.has(ctx.chain.name)) {
            ctx.log.warn(
                {
                    chain: ctx.chain.name,
                    op: 'antirug.resume.skip-ws-listener-unverified',
                },
                'Skipping anti-rug WS listener — chain failed allowlist verify at startup',
            );
            continue;
        }
        await startChainAntiRugListener(ctx);
    }
}

// ---------------------------------------------------------------------------
// Exit-worker watchdog (Phase 21.2-09, Finding B layer 1)
// D-WATCHDOG-ABORT + RESEARCH Pitfall 6 + threats T-21.2-HANGSUBMIT /
// T-21.2-ABORT-NOOP.
// ---------------------------------------------------------------------------
//
// WHY: even with the serial worker (21.2-05) moving the long `bundle.wait()` OFF
// the poll tick, ONE submit can still hang for minutes (the verified 5-min
// block-event-driven Flashbots wait). The watchdog bounds EACH submit by a
// wall-clock budget. ethers v6 has NO reliable per-call abort (#4122), so an
// AbortSignal the watchdog "relies on" is a no-op (T-21.2-ABORT-NOOP). The lever
// that actually works is `Promise.race([op, rejectAfter(budget)])` (Pitfall 6):
// it frees the AWAITING code path (the drain loop) deterministically — it does
// NOT cancel the underlying socket, but freeing the loop is what we need. On
// overrun the watchdog logs a dotted `op` + Telegram-alerts (D-ALERTS) with a
// remediation pointer and resolves to `false` so the drain loop KEEPS the bot
// alive moving to the next queued exit. The stuck position stays held + monitored
// (21.2-07 D-FAILED-EXIT-KEEP-MONITORING) and is retried on a later poll tick.
//
// Each work item carries its own ctx, so the per-chain alert is correct without
// the watchdog holding any global state. The factory itself lives in
// src/utils/exitWatchdog.ts (re-exported above); bot.ts owns the budget knob +
// the install call below.

/**
 * Install the exit-worker watchdog from the WATCHDOG_BUDGET_MS env knob (21.2-02;
 * default 60000ms, RESEARCH A3 — must exceed one 45s confirm-window + margin).
 * Parsed defensively so a bad env value falls back, not to zero.
 */
function installExitWatchdog(): void {
    const raw = process.env.WATCHDOG_BUDGET_MS;
    const parsed = raw === undefined || raw === '' ? NaN : Number.parseInt(raw, 10);
    const WATCHDOG_BUDGET_MS = Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
    setExitWorkerWatchdog(makeExitWatchdog({ budgetMs: WATCHDOG_BUDGET_MS }));
    log.info({ op: 'watchdog.installed', budgetMs: WATCHDOG_BUDGET_MS }, 'Exit-worker watchdog armed');
}

// ---------------------------------------------------------------------------
// Two-stage SIGINT / SIGTERM shutdown (Phase 21.2-09, Finding B layer 2)
// D-SIGINT-TWO-STAGE + RESEARCH Candidate Escalation #3.
// ---------------------------------------------------------------------------
//
// WHY (the Finding B symptom): the OLD single-stage `gracefulShutdown` armed a
// single 5s `.unref()` force-exit timer and ran cleanup + `process.exit(0)`
// inline. On a PARKED event loop (a synchronous `bundle.wait()` await chain that
// blocked the loop for ~222s) the listener is QUEUED but never executes, and the
// 5s timer competes with the SAME parked loop — so Ctrl+C does nothing until
// `taskkill`. That single competing timer IS the symptom (T-21.2-DOUBLE-TIMER).
//
// THE FIX (REPLACE, not augment — never two competing force-exit timers):
//   * FIRST signal  → begin graceful shutdown (set `shuttingDown`, run the
//     injected cleanup body — exit_state is already persisted each cycle so the
//     flush is a no-op; in-flight submits are abandoned best-effort, which is
//     SAFE because D-PERSIST-FAILED-HELD restart-resumes them and
//     D-NONCE-AUTHORITY-ALL makes the nonce recoverable) AND arm a SINGLE
//     force-exit `setTimeout(...).unref()` over SIGINT_GRACE_MS. The `.unref()`
//     means the grace timer can never itself keep the process alive.
//   * SECOND signal OR the grace timeout → `process.exit()` immediately.
//
// The state machine below is a PURE factory (no module-level side effects, no
// provider/DB access) so it is unit-testable with a mocked `process.exit` and
// fake timers (test/unit/bot/twoStageSigint.test.ts). The real cleanup body is
// injected by `initMultiChainShutdownHandler`.

/** Minimal logger surface the two-stage handler needs (matches pino child). */
interface ShutdownLog {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    warn: (obj: Record<string, unknown>, msg?: string) => void;
    error: (obj: Record<string, unknown> | string, msg?: string) => void;
}

export interface TwoStageShutdownOptions {
    log: ShutdownLog;
    /** Force-exit grace budget (ms) before the armed `.unref()`'d timer fires. */
    graceMs: number;
    /**
     * Graceful cleanup body — invoked exactly once, on the FIRST signal only.
     * It owns stopping timers, tearing down providers, closing the DB, and (on a
     * clean completion) calling `process.exit(0)` itself. If it parks/hangs, the
     * armed grace timer forces the exit instead.
     */
    cleanup: () => void;
}

export interface TwoStageShutdown {
    /** Process one delivered signal through the two-stage state machine. */
    stage: (signal: string) => void;
    /** Register the handler on SIGINT + SIGTERM (one path, both signals). */
    install: () => void;
    /** Test/inspection accessor: has the first signal already begun shutdown? */
    isShuttingDown: () => boolean;
}

/**
 * Build the two-stage SIGINT/SIGTERM state machine. The FIRST signal arms ONE
 * `.unref()`'d grace force-exit timer and runs the injected cleanup; a SECOND
 * signal OR the grace timeout forces an immediate `process.exit()`. There is
 * exactly ONE force-exit path — the old competing 5s timer is gone.
 */
export function createTwoStageShutdown(opts: TwoStageShutdownOptions): TwoStageShutdown {
    const { log: shutdownLog, graceMs, cleanup } = opts;
    let shuttingDown = false;

    function stage(signal: string): void {
        // SECOND signal (or any signal after the first): hard stop, no waiting.
        // 130 = 128 + SIGINT(2), the conventional exit code for Ctrl+C.
        if (shuttingDown) {
            shutdownLog.error({ signal }, 'Second signal — forcing immediate exit');
            process.exit(130);
            return;
        }

        shuttingDown = true;
        shutdownLog.info(
            { signal, graceMs },
            'Graceful shutdown begun (two-stage SIGINT) — send the signal again to force-exit now',
        );

        // Arm the SINGLE force-exit timer FIRST, BEFORE running cleanup, so even
        // if the cleanup body itself parks the loop the grace timer is already
        // scheduled. `.unref()` so it never keeps the process alive on its own
        // (mirrors withTimeout.ts and the prior force-exit posture).
        const graceTimer = setTimeout(() => {
            shutdownLog.error({ graceMs }, 'Grace timeout elapsed — forcing exit');
            process.exit(1);
        }, graceMs);
        if (graceTimer.unref) graceTimer.unref();

        // Run the graceful cleanup body. It may call process.exit(0) on a clean
        // completion; if it throws or parks, the armed grace timer above is the
        // safety net (and a second signal forces exit immediately).
        try {
            cleanup();
        } catch (e) {
            shutdownLog.error(
                { err: e instanceof Error ? e.message : String(e) },
                'Error during graceful shutdown cleanup — grace timer will force exit',
            );
        }
    }

    function install(): void {
        process.on('SIGINT', () => stage('SIGINT'));
        process.on('SIGTERM', () => stage('SIGTERM'));
    }

    return { stage, install, isShuttingDown: () => shuttingDown };
}

function initMultiChainShutdownHandler(
    contexts: ChainContext[],
    apiServer?: { close: () => void },
    telegramHandle?: TelegramListenerHandle,
): void {
    // SIGINT_GRACE_MS (21.2-02 env knob): two-stage SIGINT grace before the
    // single armed force-exit timer fires. Default 8000ms (RESEARCH A4). Parsed
    // defensively (never NaN/negative) so a bad env value falls back, not zeros.
    const graceRaw = process.env.SIGINT_GRACE_MS;
    const graceParsed = graceRaw === undefined || graceRaw === '' ? NaN : Number.parseInt(graceRaw, 10);
    const SIGINT_GRACE_MS = Number.isFinite(graceParsed) && graceParsed > 0 ? graceParsed : 8000;

    const shutdown = createTwoStageShutdown({
        log,
        graceMs: SIGINT_GRACE_MS,
        cleanup: () => {
            log.info({ op: 'shutdown.cleanup' }, 'Shutdown signal received, cleaning up all chains');

            // Close API server first (stop accepting requests before providers go down)
            if (apiServer) {
                log.info({ op: 'shutdown.api' }, 'Closing API server...');
                apiServer.close();
            }

            // Disconnect Telegram client (D-20)
            if (telegramHandle?.client) {
                telegramHandle.client.disconnect().catch(e => {
                    log.warn({ err: e }, 'Error disconnecting Telegram client');
                });
            }

            // Clear all timers across all chains
            clearAllTimers();

            // Remove all factory listeners and destroy WebSocket providers
            for (const ctx of contexts) {
                if (ctx.wsProvider) {
                    try {
                        ctx.wsProvider.removeAllListeners();
                        ctx.wsProvider.destroy();
                    } catch (e) {
                        ctx.log.warn({ err: e }, 'Error destroying WebSocket provider during shutdown');
                    }
                }
            }

            // Close database
            const { closeDb } = require('./utils/db');
            closeDb();

            log.info({ op: 'shutdown.complete' }, 'Multi-chain shutdown cleanup complete, exiting');
            process.exit(0);
        },
    });

    shutdown.install();
}

// ---------------------------------------------------------------------------
// Entry point -- use multi-chain bot
// ---------------------------------------------------------------------------

if (require.main === module) {
    startMultiChainBot();
}
