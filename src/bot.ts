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
    checkHoneypotForChain,
    isLiquidityLockedForChain,
    simulateSwapForChain,
    isLiquiditySufficientForChain,
    isKnownBadTokenForChain,
    checkTokenMetadataForChain,
    hasHighTransferTaxForChain,
    hasMaxWalletOrTxLimitsForChain,
    simulateSellForChain,
    isBlacklistedTokenForChain,
    simulateSellV3ForChain
} from "./utils/tokenSafety";
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

async function waitForLiquidity(
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

    // Sell simulation: always-on, hard block on failure (FIX-04)
    const canSell = await simulateSellForChain(ctx, dex.routerAddress, targetToken);
    if (!canSell) {
        ctx.log.warn({ token: targetToken }, 'Sell simulation failed, skipping buy');
        await sendCtxAlert(ctx, `*Sell simulation failed for* \`${targetToken}\` -- buy skipped`);
        return;
    }

    // Parallel safety checks using chain-aware versions
    const [isHoneypot, isBlacklisted, locked, sufficientLiquidity, validMetadata, canSwap, hasTax, hasLimits] = await Promise.all([
        checkHoneypotForChain(ctx, targetToken),
        isBlacklistedTokenForChain(ctx, targetToken),
        isLiquidityLockedForChain(ctx, pairAddress),
        isLiquiditySufficientForChain(ctx, pairAddress),
        checkTokenMetadataForChain(ctx, targetToken),
        simulateSwapForChain(ctx, dex.routerAddress, targetToken),
        hasHighTransferTaxForChain(ctx, dex.routerAddress, targetToken),
        hasMaxWalletOrTxLimitsForChain(ctx, targetToken),
    ]);

    const tokenContract = new Contract(targetToken, ERC20_ABI, ctx.httpProvider);

    let symbol = "?", name = "?", decimals = 18;
    try {
        [symbol, name, decimals] = await Promise.all([
            tokenContract.symbol(),
            tokenContract.name(),
            tokenContract.decimals(),
        ]);
    } catch {}

    const lp = new Contract(pairAddress, PAIR_ABI, ctx.httpProvider);

    let nativeLiquidity = "?";
    try {
        const [token0Addr, reserves] = await Promise.all([
            lp.token0(),
            lp.getReserves()
        ]);

        const wethReserve = token0Addr.toLowerCase() === ctx.chain.wethAddress.toLowerCase() ? reserves.reserve0 : reserves.reserve1;
        nativeLiquidity = ethers.formatEther(wethReserve);
    } catch {}

    await sendCtxAlert(ctx, `*New Token Detected!*\nSymbol: \`${symbol}\`\nDecimals: \`${decimals}\`\nW${ctx.chain.nativeCurrency} LP: \`${nativeLiquidity} ${ctx.chain.nativeCurrency}\`\nLocked: \`${locked ? "Yes" : "No"}\`\nHoneypot: \`${isHoneypot ? "Yes" : "No"}\`\nBlacklist Function: \`${isBlacklisted ? "Yes" : "No"}\`\nMaxTx/Wallet: \`${hasLimits ? "Yes" : "No"}\`\n\nToken: [\`${targetToken}\`](${ctx.chain.explorerUrl}/token/${targetToken})\nPair: [\`${pairAddress}\`](${ctx.chain.explorerUrl}/address/${pairAddress})`);

    if (isHoneypot || isBlacklisted || !locked || !sufficientLiquidity || !validMetadata || !canSwap || hasTax || hasLimits) {
        ctx.log.info({ token: targetToken, checks: { isHoneypot, isBlacklisted, locked, sufficientLiquidity, validMetadata, canSwap, hasTax, hasLimits } }, 'Safety checks failed, skipping');
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
        ctx.log.info({ token: targetToken }, 'TX confirmed');
        await sendCtxAlert(ctx, `*TX confirmed* for \`${symbol}\``);

        // Capture token balance for exit engine (D-07: original buy amount needed for partial sells)
        const exitTokenContract = new Contract(targetToken, ERC20_ABI, ctx.wallet);
        const originalTokenAmount: bigint = await exitTokenContract.balanceOf(ctx.wallet.address);

        // Get trade ID for exit state linkage
        const tradeRow = getTradeIdForPendingToken.get(targetToken.toLowerCase(), ctx.chain.name) as { id: number } | undefined;
        if (tradeRow) {
            await startExitMonitor(ctx, dex, targetToken, null, ctx.chain.snipeAmount, tradeRow.id, originalTokenAmount);
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

    // V3 sell simulation using QuoterV2 (Pitfall 6: must use V3 quoter, not V2 router)
    const canSell = await simulateSellV3ForChain(ctx, dex.quoterAddress, targetToken, feeTier);
    if (!canSell) {
        ctx.log.warn({ token: targetToken, feeTier }, 'V3 sell simulation failed, skipping buy');
        await sendCtxAlert(ctx, `*V3 sell simulation failed for* \`${targetToken}\` -- buy skipped`);
        return;
    }

    // Parallel safety checks (reuse existing ForChain functions -- same checks apply to V3 tokens)
    // Note: V3 has no pair address for liquidity lock checks, so we skip isLiquidityLockedForChain
    // and isLiquiditySufficientForChain (those are V2-pair-specific). V3 liquidity is checked above.
    const [isHoneypot, isBlacklisted, validMetadata, hasTax, hasLimits] = await Promise.all([
        checkHoneypotForChain(ctx, targetToken),
        isBlacklistedTokenForChain(ctx, targetToken),
        checkTokenMetadataForChain(ctx, targetToken),
        hasHighTransferTaxForChain(ctx, dex.swapRouterAddress, targetToken),
        hasMaxWalletOrTxLimitsForChain(ctx, targetToken),
    ]);

    const tokenContract = new Contract(targetToken, ERC20_ABI, ctx.httpProvider);
    let symbol = "?", name = "?", decimals = 18;
    try {
        [symbol, name, decimals] = await Promise.all([
            tokenContract.symbol(),
            tokenContract.name(),
            tokenContract.decimals(),
        ]);
    } catch {}

    await sendCtxAlert(ctx, `*New V3 Token Detected!*\nSymbol: \`${symbol}\`\nFee Tier: \`${feeTier} bps\`\nHoneypot: \`${isHoneypot ? "Yes" : "No"}\`\nBlacklist Function: \`${isBlacklisted ? "Yes" : "No"}\`\nMaxTx/Wallet: \`${hasLimits ? "Yes" : "No"}\`\n\nToken: [\`${targetToken}\`](${ctx.chain.explorerUrl}/token/${targetToken})\nPool: [\`${poolAddress}\`](${ctx.chain.explorerUrl}/address/${poolAddress})`);

    if (isHoneypot || isBlacklisted || !validMetadata || hasTax || hasLimits) {
        ctx.log.info({ token: targetToken, checks: { isHoneypot, isBlacklisted, validMetadata, hasTax, hasLimits } }, 'Safety checks failed, skipping V3 snipe');
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
        ctx.log.info({ token: targetToken }, 'V3 TX confirmed');
        await sendCtxAlert(ctx, `*V3 TX confirmed* for \`${symbol}\``);

        // Capture token balance for exit engine (D-07)
        const exitTokenContract = new Contract(targetToken, ERC20_ABI, ctx.wallet);
        const originalTokenAmount: bigint = await exitTokenContract.balanceOf(ctx.wallet.address);

        const tradeRow = getTradeIdForPendingToken.get(targetToken.toLowerCase(), ctx.chain.name) as { id: number } | undefined;
        if (tradeRow) {
            await startExitMonitor(ctx, dex, targetToken, feeTier, ctx.chain.snipeAmount, tradeRow.id, originalTokenAmount);
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
