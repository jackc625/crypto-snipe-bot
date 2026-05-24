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
    hasHighTransferTax,
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
    hasHighTransferTaxForChain,
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
import { db, insertTrade, isTokenSniped, updateTradeStatus, getTradeIdForPendingToken } from "./utils/db";
import { logger } from "./utils/logger";
import { getProvider, getWallet, getWsProvider, removeWsProvider } from "./utils/provider";
import { FACTORY_ABI, ROUTER_ABI, ERC20_ABI, PAIR_ABI, V3_FACTORY_ABI, V3_POOL_ABI, V3_SWAP_ROUTER_ABI, V3_QUOTER_V2_ABI } from "./utils/abis";
import { sendTxWithRetry, createMevStrategy } from "./utils/txManager";
import {
    clearAllTimers,
} from "./utils/exitManager";
import { startExitMonitor, resumeExitMonitor } from './exitEngine';
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

// Chain-aware maybeApprove for multi-chain path
async function maybeApproveForChain(ctx: ChainContext, tokenContract: Contract, amount: bigint, routerAddress: string) {
    const currentAllowance = await tokenContract.allowance(ctx.wallet.address, routerAddress);
    if (currentAllowance < amount) {
        await tokenContract.approve(routerAddress, amount);
    }
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
    const [isBlacklisted, locked, sufficientLiquidity, validMetadata, canSwap, hasTax, hasLimits, mutableResult] = await Promise.all([
        isBlacklistedTokenForChain(ctx, targetToken),
        isLiquidityLockedForChain(ctx, pairAddress),
        isLiquiditySufficientForChain(ctx, pairAddress),
        checkTokenMetadataForChain(ctx, targetToken),
        simulateSwapForChain(ctx, dex.routerAddress, targetToken),
        hasHighTransferTaxForChain(ctx, dex.routerAddress, targetToken),
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

    if (isHoneypot || isBlacklisted || !locked || !sufficientLiquidity || !validMetadata || !canSwap || hasTax || hasLimits || mutableResult.isMutable) {
        ctx.log.info({ token: targetToken, checks: { isHoneypot, isBlacklisted, locked, sufficientLiquidity, validMetadata, canSwap, hasTax, hasLimits, mutable: mutableResult.isMutable, mutableHits: mutableResult.hits } }, 'Safety checks failed, skipping');
        return;
    }

    ctx.log.info({ token: targetToken, symbol }, 'All safety checks passed, buying');

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

    try {
        await sendTxWithRetry(
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
            ctx
        );

        recordSnipe(ctx.chain.name);

        insertTrade.run({
            token: targetToken.toLowerCase(),
            chain: ctx.chain.name,
            action: 'buy',
            txHash: 'mev_bundle',
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
            await startExitMonitor(ctx, dex, targetToken, null, ctx.chain.snipeAmount, tradeRow.id, originalTokenAmount);

            // Phase 19 / Plan 19-05 — parallel anti-rug attach. snapshotLpBaseline
            // writes the V2 reserves baseline; registerAntiRugPosition hooks the
            // position into the per-chain anti-rug WS dispatch table. On baseline
            // failure, the catch logs op='antirug.baseline-snapshot-failed' and
            // SKIPS the register — the position is left UNMONITORED for anti-rug
            // (operator-visible via the dashboard's per-position state badge per
            // UI-SPEC) but the standard exit monitor remains active.
            try {
                await snapshotLpBaseline(ctx, dex, tradeRow.id, pairAddress, null);
                // CR-03: registerAntiRugPosition is async (awaits
                // startChainAntiRugListener → backfillSinceLastSeen which
                // performs RPC + DB writes). Without await, rejections
                // become unhandled promise rejections and bypass the
                // surrounding try/catch — the documented
                // op='antirug.baseline-snapshot-failed' log path never
                // fires and the position appears registered when it isn't.
                await registerAntiRugPosition(ctx, dex, targetToken, pairAddress, tradeRow.id, null);
            } catch (err) {
                ctx.log.error(
                    {
                        err,
                        op: 'antirug.baseline-snapshot-failed',
                        tradeId: tradeRow.id,
                        pair: pairAddress,
                    },
                    'Anti-rug baseline snapshot failed; position UNMONITORED',
                );
            }
        } else {
            ctx.log.error({ token: targetToken }, 'Could not find trade ID for exit monitor');
        }
    } catch (e) {
        ctx.log.error({ err: e, token: targetToken }, 'TX failed');
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
    const [isBlacklisted, validMetadata, hasTax, hasLimits, mutableResult] = await Promise.all([
        isBlacklistedTokenForChain(ctx, targetToken),
        checkTokenMetadataForChain(ctx, targetToken),
        hasHighTransferTaxForChain(ctx, dex.swapRouterAddress, targetToken),
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

    if (isHoneypot || isBlacklisted || !validMetadata || hasTax || hasLimits || mutableResult.isMutable) {
        ctx.log.info({ token: targetToken, checks: { isHoneypot, isBlacklisted, validMetadata, hasTax, hasLimits, mutable: mutableResult.isMutable, mutableHits: mutableResult.hits } }, 'Safety checks failed, skipping V3 snipe');
        return;
    }

    ctx.log.info({ token: targetToken, symbol, feeTier }, 'All V3 safety checks passed, buying');

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

        await sendTxWithRetry(
            () => ctx.wallet.populateTransaction({
                to: dex.swapRouterAddress,
                data: v3Router.interface.encodeFunctionData('multicall', [deadline, [swapData]]),
                value: amountIn,  // Pitfall 5: send ETH value since tokenIn is WETH
            }),
            ctx
        );

        recordSnipe(ctx.chain.name);

        insertTrade.run({
            token: targetToken.toLowerCase(),
            chain: ctx.chain.name,
            action: 'buy',
            txHash: 'mev_bundle',
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
        ctx.log.error({ err: e, token: targetToken, feeTier }, 'V3 TX failed');
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

    // 2. For each enabled chain
    const contexts: ChainContext[] = [];
    for (const chain of getEnabledChains(registry)) {
        const ctx = createChainContext(chain);

        // 3. Validate chainId (Pitfall 4 from research)
        try {
            const network = await ctx.httpProvider.getNetwork();
            if (Number(network.chainId) !== chain.chainId) {
                mainLog.fatal({ chain: chain.name, expected: chain.chainId, got: Number(network.chainId) }, 'Chain ID mismatch -- skipping chain');
                continue;
            }
        } catch (err) {
            mainLog.fatal({ chain: chain.name, err }, 'Failed to connect to RPC -- skipping chain');
            continue;
        }

        // 4. MEV health check (per D-07)
        const strategy = createMevStrategy(chain);
        const mevHealthy = await strategy.healthCheck();
        if (!mevHealthy) {
            mainLog.warn({ chain: chain.name }, 'MEV service unreachable at startup -- chain will run but snipes will be rejected until MEV recovers');
            await sendCtxAlert(ctx, 'MEV service unreachable at startup');
        }

        contexts.push(ctx);

        // 5. Start listeners per DEX (per D-03, D-10)
        for (const dex of chain.dexes) {
            await startDexListener(ctx, dex, registry);
        }

        ctx.log.info({ dexCount: chain.dexes.length }, 'Chain listeners started');
    }

    // 6. Periodic MEV health check every 5 minutes (per D-07)
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

    // 8. Shutdown handler (D-20: includes telegram disconnect)
    initMultiChainShutdownHandler(contexts, apiServer, telegramHandle);

    mainLog.info({ chains: contexts.map(c => c.chain.name) }, 'Multi-chain bot fully started');
}

// ---------------------------------------------------------------------------
// Resume monitoring for pending trades across all chains
// ---------------------------------------------------------------------------

function resumeMultiChainMonitoring(contexts: ChainContext[]): void {
    const pendingTrades = db.prepare(
        'SELECT DISTINCT token, chain, pool_type, fee_tier, id FROM trades WHERE status = ? AND action = ?'
    ).all('pending', 'buy') as { token: string; chain: string; pool_type: string; fee_tier: number | null; id: number }[];

    for (const trade of pendingTrades) {
        const { token, chain: chainName } = trade;
        const ctx = contexts.find(c => c.chain.name === chainName);
        if (!ctx) {
            log.warn({ token, chain: chainName }, 'No active context for chain, skipping resume');
            continue;
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

    // Step 2 — scan trades INNER JOIN lp_baseline for open positions.
    const openTrades = db.prepare(`
        SELECT t.id, t.token, t.chain, t.pool_type, t.fee_tier, b.pair_or_pool_address
        FROM trades t
        INNER JOIN lp_baseline b ON b.trade_id = t.id
        WHERE t.status = 'pending' AND t.action = 'buy'
    `).all() as Array<{
        id: number;
        token: string;
        chain: string;
        pool_type: 'v2' | 'v3';
        fee_tier: number | null;
        pair_or_pool_address: string;
    }>;

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
// Multi-chain shutdown handler
// ---------------------------------------------------------------------------

function initMultiChainShutdownHandler(
    contexts: ChainContext[],
    apiServer?: { close: () => void },
    telegramHandle?: TelegramListenerHandle,
): void {
    let shuttingDown = false;

    function gracefulShutdown(signal: string): void {
        if (shuttingDown) return;
        shuttingDown = true;

        // Safety net: force exit after 5 seconds if graceful shutdown hangs
        setTimeout(() => {
            log.error('Force exit after 5s timeout');
            process.exit(1);
        }, 5000).unref();

        log.info({ signal }, 'Shutdown signal received, cleaning up all chains');

        // Close API server first (stop accepting requests before providers go down)
        if (apiServer) {
            log.info('Closing API server...');
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

        log.info('Multi-chain shutdown cleanup complete, exiting');
        process.exit(0);
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// ---------------------------------------------------------------------------
// Entry point -- use multi-chain bot
// ---------------------------------------------------------------------------

if (require.main === module) {
    startMultiChainBot();
}
