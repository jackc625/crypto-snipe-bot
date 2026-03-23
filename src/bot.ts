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
    isBlacklistedTokenForChain
} from "./utils/tokenSafety";
import { BLOCKLIST } from "./utils/blocklist";
import { sendTelegramAlert } from "./utils/notifier";
import { sendCtxAlert } from "./utils/notifier";
import { db, insertTrade, isTokenSniped, updateTradeStatus } from "./utils/db";
import { logger } from "./utils/logger";
import { getProvider, getWallet, removeWsProvider } from "./utils/provider";
import { FACTORY_ABI, ROUTER_ABI, ERC20_ABI, PAIR_ABI } from "./utils/abis";
import { sendTxWithRetry, createMevStrategy } from "./utils/txManager";
import {
    tryAcquireSellLock,
    registerStopLoss,
    registerTakeProfit,
    registerTimedSell,
    clearAllTimersForToken,
    clearAllTimers,
    initShutdownHandler,
    isShutdownInProgress
} from "./utils/exitManager";
import {
    ChainConfig,
    DexConfig,
    ChainContext,
    buildChainRegistry,
    createChainContext,
    getEnabledChains
} from "./chainRegistry";

// Legacy singleton instances -- kept for backward-compatible handleNewPair() and startBot()
const provider = getProvider();
const wallet = getWallet();

const factory = new Contract(CONFIG.factoryAddress, FACTORY_ABI, provider);
const router = new Contract(CONFIG.routerAddress, ROUTER_ABI, wallet);

const log = logger.child({ module: 'bot' });

// ---------------------------------------------------------------------------
// Capital tracking (per D-08/D-09 -- fixed budget per chain, CHAIN-05 structural)
// ---------------------------------------------------------------------------

const capitalDeployed = new Map<string, bigint>(); // chain name -> wei deployed

function canDeployCapital(chain: ChainConfig, amount: bigint): boolean {
    const deployed = capitalDeployed.get(chain.name) || 0n;
    const max = ethers.parseEther(chain.maxCapital);
    return deployed + amount <= max;
}

function recordCapitalDeployed(chain: ChainConfig, amount: bigint): void {
    const deployed = capitalDeployed.get(chain.name) || 0n;
    capitalDeployed.set(chain.name, deployed + amount);
}

// ---------------------------------------------------------------------------
// Legacy helper functions (unchanged from pre-refactor)
// ---------------------------------------------------------------------------

async function maybeApprove(token: Contract, amount: bigint) {
    const currentAllowance = await token.allowance(wallet.address, CONFIG.routerAddress);
    if (currentAllowance < amount) {
        await token.approve(CONFIG.routerAddress, amount);
    }
}

// Chain-aware maybeApprove for multi-chain path
async function maybeApproveForChain(ctx: ChainContext, tokenContract: Contract, amount: bigint, routerAddress: string) {
    const currentAllowance = await tokenContract.allowance(ctx.wallet.address, routerAddress);
    if (currentAllowance < amount) {
        await tokenContract.approve(routerAddress, amount);
    }
}

// Unified sell function with per-token mutex to prevent double-sells (FIX-01).
// On sell (success or failure), all timers for the token are cancelled (FIX-07).
async function executeSell(
    tokenAddress: string,
    reason: 'stop-loss' | 'take-profit' | 'timed-sell'
): Promise<void> {
    if (!tryAcquireSellLock(tokenAddress)) {
        log.info({ token: tokenAddress, reason }, 'Another exit already handling token, skipping');
        return;
    }

    try {
        const token = new Contract(tokenAddress, ERC20_ABI, wallet);
        const balance = await token.balanceOf(wallet.address);

        if (balance === 0n) {
            log.info({ token: tokenAddress, reason }, 'Zero balance, cleaning up');
            updateTradeStatus.run('sold', tokenAddress.toLowerCase());
            clearAllTimersForToken(tokenAddress);
            return;
        }

        await maybeApprove(token, balance);
        const deadline = Math.floor(Date.now() / 1000) + 60;
        const path = [tokenAddress, CONFIG.wethAddress];

        const sellTx = await router.swapExactTokensForETH(
            balance, 0, path, wallet.address, deadline,
            { gasLimit: BigInt(CONFIG.gasLimit || 300_000), gasPrice: (await provider.getFeeData()).gasPrice }
        );

        log.info({ token: tokenAddress, reason, txHash: sellTx.hash }, 'Sell TX sent');
        await sendTelegramAlert(`*${reason} sell TX sent:* [View](https://etherscan.io/tx/${sellTx.hash})`);
        await sellTx.wait();

        updateTradeStatus.run('sold', tokenAddress.toLowerCase());
        clearAllTimersForToken(tokenAddress);
        await sendTelegramAlert(`*${reason} TX confirmed*`);

    } catch (e) {
        log.error({ err: e, token: tokenAddress, reason }, 'Sell failed');
        updateTradeStatus.run('failed', tokenAddress.toLowerCase());
        clearAllTimersForToken(tokenAddress);
        await sendTelegramAlert(`*${reason} sell failed:* ${e instanceof Error ? e.message : String(e)}`);
    }
}

// Chain-aware executeSell for multi-chain path
async function executeSellForChain(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    reason: 'stop-loss' | 'take-profit' | 'timed-sell'
): Promise<void> {
    if (!tryAcquireSellLock(ctx.chain.name, tokenAddress)) {
        ctx.log.info({ token: tokenAddress, reason }, 'Another exit already handling token, skipping');
        return;
    }

    try {
        const token = new Contract(tokenAddress, ERC20_ABI, ctx.wallet);
        const balance = await token.balanceOf(ctx.wallet.address);

        if (balance === 0n) {
            ctx.log.info({ token: tokenAddress, reason }, 'Zero balance, cleaning up');
            updateTradeStatus.run('sold', tokenAddress.toLowerCase());
            clearAllTimersForToken(ctx.chain.name, tokenAddress);
            return;
        }

        await maybeApproveForChain(ctx, token, balance, dex.routerAddress);
        const deadline = Math.floor(Date.now() / 1000) + 60;
        const path = [tokenAddress, ctx.chain.wethAddress];

        const dexRouter = new Contract(dex.routerAddress, ROUTER_ABI, ctx.wallet);
        const sellTx = await dexRouter.swapExactTokensForETH(
            balance, 0, path, ctx.wallet.address, deadline,
            { gasLimit: ctx.chain.gas.maxGasLimit, gasPrice: (await ctx.httpProvider.getFeeData()).gasPrice }
        );

        ctx.log.info({ token: tokenAddress, reason, txHash: sellTx.hash }, 'Sell TX sent');
        await sendCtxAlert(ctx, `*${reason} sell TX sent:* [View](${ctx.chain.explorerUrl}/tx/${sellTx.hash})`);
        await sellTx.wait();

        updateTradeStatus.run('sold', tokenAddress.toLowerCase());
        clearAllTimersForToken(ctx.chain.name, tokenAddress);
        await sendCtxAlert(ctx, `*${reason} TX confirmed*`);

    } catch (e) {
        ctx.log.error({ err: e, token: tokenAddress, reason }, 'Sell failed');
        updateTradeStatus.run('failed', tokenAddress.toLowerCase());
        clearAllTimersForToken(ctx.chain.name, tokenAddress);
        await sendCtxAlert(ctx, `*${reason} sell failed:* ${e instanceof Error ? e.message : String(e)}`);
    }
}

// ---------------------------------------------------------------------------
// Legacy monitor functions (unchanged for backward compat)
// ---------------------------------------------------------------------------

async function monitorStopLoss(tokenAddress: string, buyAmountETH: string) {
    const path = [tokenAddress, CONFIG.wethAddress];
    const buyAmount = ethers.parseEther(buyAmountETH);
    const initialOut = await router.getAmountsOut(buyAmount, path).catch(() => null);

    if (!initialOut) return;

    const initialPrice = Number(initialOut[1]);
    const stopLossPercent = CONFIG.stopLossPercent || 25;
    const stopLossPrice = initialPrice * (1 - stopLossPercent / 100);

    log.info({ token: tokenAddress }, 'Monitoring for stop-loss');

    const interval = setInterval(async () => {
        try {
            // Balance-zero check: if token balance is zero, stop monitoring (FIX-08)
            const token = new Contract(tokenAddress, ERC20_ABI, wallet);
            const balance = await token.balanceOf(wallet.address);
            if (balance === 0n) {
                log.info({ token: tokenAddress }, 'Stop-loss: zero balance detected, stopping monitor');
                clearAllTimersForToken(tokenAddress);
                updateTradeStatus.run('sold', tokenAddress.toLowerCase());
                return;
            }

            const currentOut = await router.getAmountsOut(buyAmount, path);
            const currentPrice = Number(currentOut[1]);
            const roi = ((currentPrice - initialPrice) / initialPrice) * 100;

            log.debug({ token: tokenAddress, roi: roi.toFixed(2) }, 'Stop-loss ROI check');

            if (currentPrice < stopLossPrice) {
                log.info({ token: tokenAddress }, 'Stop-loss triggered, selling');
                await executeSell(tokenAddress, 'stop-loss');
            }
        } catch (e) {
            log.error({ err: e, token: tokenAddress }, 'Stop-loss monitoring error');
        }
    }, CONFIG.stopLossCheckInterval || 15000);

    registerStopLoss(tokenAddress, interval);
}

async function monitorTakeProfit(tokenAddress: string, buyAmountETH: string) {
    const path = [tokenAddress, CONFIG.wethAddress];
    const buyAmount = ethers.parseEther(buyAmountETH);
    const initialOut = await router.getAmountsOut(buyAmount, path).catch(() => null);

    if (!initialOut) return;

    const initialPrice = Number(initialOut[1]);
    const takeProfitPrice = initialPrice * (1 + CONFIG.takeProfitPercent / 100);

    log.info({ token: tokenAddress }, 'Monitoring for take-profit');

    const interval = setInterval(async () => {
        try {
            // Balance-zero check: if token balance is zero, stop monitoring (FIX-08)
            const token = new Contract(tokenAddress, ERC20_ABI, wallet);
            const balance = await token.balanceOf(wallet.address);
            if (balance === 0n) {
                log.info({ token: tokenAddress }, 'Take-profit: zero balance detected, stopping monitor');
                clearAllTimersForToken(tokenAddress);
                updateTradeStatus.run('sold', tokenAddress.toLowerCase());
                return;
            }

            const currentOut = await router.getAmountsOut(buyAmount, path);
            const currentPrice = Number(currentOut[1]);

            if (currentPrice >= takeProfitPrice) {
                log.info({ token: tokenAddress }, 'Take-profit triggered, selling');
                await executeSell(tokenAddress, 'take-profit');
            }
        } catch (e) {
            log.error({ err: e, token: tokenAddress }, 'Take-profit monitoring error');
        }
    }, CONFIG.takeProfitCheckInterval || 15000);

    registerTakeProfit(tokenAddress, interval);
}

async function scheduleTimedSell(tokenAddress: string) {
    log.info({ token: tokenAddress, delayMinutes: CONFIG.autoSellAfterMs / 60000 }, 'Scheduled auto-sell');

    const timeout = setTimeout(async () => {
        await executeSell(tokenAddress, 'timed-sell');
    }, CONFIG.autoSellAfterMs);

    registerTimedSell(tokenAddress, timeout);
}

// ---------------------------------------------------------------------------
// Chain-aware monitor functions
// ---------------------------------------------------------------------------

async function monitorStopLossForChain(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    buyAmountNative: string
) {
    const dexRouter = new Contract(dex.routerAddress, ROUTER_ABI, ctx.httpProvider);
    const path = [tokenAddress, ctx.chain.wethAddress];
    const buyAmount = ethers.parseEther(buyAmountNative);
    const initialOut = await dexRouter.getAmountsOut(buyAmount, path).catch(() => null);

    if (!initialOut) return;

    const initialPrice = Number(initialOut[1]);
    const stopLossPercent = CONFIG.stopLossPercent || 25;
    const stopLossPrice = initialPrice * (1 - stopLossPercent / 100);

    ctx.log.info({ token: tokenAddress, dex: dex.name }, 'Monitoring for stop-loss');

    const interval = setInterval(async () => {
        try {
            const token = new Contract(tokenAddress, ERC20_ABI, ctx.wallet);
            const balance = await token.balanceOf(ctx.wallet.address);
            if (balance === 0n) {
                ctx.log.info({ token: tokenAddress }, 'Stop-loss: zero balance detected, stopping monitor');
                clearAllTimersForToken(ctx.chain.name, tokenAddress);
                updateTradeStatus.run('sold', tokenAddress.toLowerCase());
                return;
            }

            const currentOut = await dexRouter.getAmountsOut(buyAmount, path);
            const currentPrice = Number(currentOut[1]);
            const roi = ((currentPrice - initialPrice) / initialPrice) * 100;

            ctx.log.debug({ token: tokenAddress, roi: roi.toFixed(2) }, 'Stop-loss ROI check');

            if (currentPrice < stopLossPrice) {
                ctx.log.info({ token: tokenAddress }, 'Stop-loss triggered, selling');
                await executeSellForChain(ctx, dex, tokenAddress, 'stop-loss');
            }
        } catch (e) {
            ctx.log.error({ err: e, token: tokenAddress }, 'Stop-loss monitoring error');
        }
    }, CONFIG.stopLossCheckInterval || 15000);

    registerStopLoss(ctx.chain.name, tokenAddress, interval);
}

async function monitorTakeProfitForChain(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string,
    buyAmountNative: string
) {
    const dexRouter = new Contract(dex.routerAddress, ROUTER_ABI, ctx.httpProvider);
    const path = [tokenAddress, ctx.chain.wethAddress];
    const buyAmount = ethers.parseEther(buyAmountNative);
    const initialOut = await dexRouter.getAmountsOut(buyAmount, path).catch(() => null);

    if (!initialOut) return;

    const initialPrice = Number(initialOut[1]);
    const takeProfitPrice = initialPrice * (1 + CONFIG.takeProfitPercent / 100);

    ctx.log.info({ token: tokenAddress, dex: dex.name }, 'Monitoring for take-profit');

    const interval = setInterval(async () => {
        try {
            const token = new Contract(tokenAddress, ERC20_ABI, ctx.wallet);
            const balance = await token.balanceOf(ctx.wallet.address);
            if (balance === 0n) {
                ctx.log.info({ token: tokenAddress }, 'Take-profit: zero balance detected, stopping monitor');
                clearAllTimersForToken(ctx.chain.name, tokenAddress);
                updateTradeStatus.run('sold', tokenAddress.toLowerCase());
                return;
            }

            const currentOut = await dexRouter.getAmountsOut(buyAmount, path);
            const currentPrice = Number(currentOut[1]);

            if (currentPrice >= takeProfitPrice) {
                ctx.log.info({ token: tokenAddress }, 'Take-profit triggered, selling');
                await executeSellForChain(ctx, dex, tokenAddress, 'take-profit');
            }
        } catch (e) {
            ctx.log.error({ err: e, token: tokenAddress }, 'Take-profit monitoring error');
        }
    }, CONFIG.takeProfitCheckInterval || 15000);

    registerTakeProfit(ctx.chain.name, tokenAddress, interval);
}

async function scheduleTimedSellForChain(
    ctx: ChainContext,
    dex: DexConfig,
    tokenAddress: string
) {
    ctx.log.info({ token: tokenAddress, delayMinutes: CONFIG.autoSellAfterMs / 60000 }, 'Scheduled auto-sell');

    const timeout = setTimeout(async () => {
        await executeSellForChain(ctx, dex, tokenAddress, 'timed-sell');
    }, CONFIG.autoSellAfterMs);

    registerTimedSell(ctx.chain.name, tokenAddress, timeout);
}

// ---------------------------------------------------------------------------
// Chain-aware pair handler
// ---------------------------------------------------------------------------

export async function handleNewPairForChain(
    ctx: ChainContext,
    dex: DexConfig,
    token0: string,
    token1: string,
    pairAddress: string
): Promise<void> {
    const targetToken = token0.toLowerCase() === ctx.chain.wethAddress.toLowerCase()
        ? token1 : token0;

    if (isTokenSniped.get(targetToken.toLowerCase())) {
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

    // Capital budget check (per D-08/D-09)
    if (!canDeployCapital(ctx.chain, amountIn)) {
        ctx.log.warn({ token: targetToken, chain: ctx.chain.name }, 'Capital budget exceeded, skipping snipe');
        await sendCtxAlert(ctx, `*Capital budget exceeded* -- skipping \`${symbol}\``);
        return;
    }

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

        recordCapitalDeployed(ctx.chain, amountIn);

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
            status: 'pending'
        });
        await sendCtxAlert(ctx, `*Buy TX sent via ${ctx.chain.mevStrategy}* for \`${symbol}\``);
        ctx.log.info({ token: targetToken, symbol, strategy: ctx.chain.mevStrategy }, 'MEV bundle submitted');
        ctx.log.info({ token: targetToken }, 'TX confirmed');
        await sendCtxAlert(ctx, `*TX confirmed* for \`${symbol}\``);

        await monitorStopLossForChain(ctx, dex, targetToken, ctx.chain.snipeAmount);
        await monitorTakeProfitForChain(ctx, dex, targetToken, ctx.chain.snipeAmount);
        await scheduleTimedSellForChain(ctx, dex, targetToken);
    } catch (e) {
        ctx.log.error({ err: e, token: targetToken }, 'TX failed');
        updateTradeStatus.run('failed', targetToken.toLowerCase());
        await sendCtxAlert(ctx, `*TX failed* for \`${symbol}\``);
    }
}

// ---------------------------------------------------------------------------
// Legacy handleNewPair (backward compat wrapper)
// ---------------------------------------------------------------------------

export async function handleNewPair(token0: string, token1: string, pairAddress: string) {
    const targetToken =
        token0.toLowerCase() === CONFIG.wethAddress.toLowerCase() ? token1 : token0;

    if (isTokenSniped.get(targetToken.toLowerCase())) {
        log.info({ token: targetToken }, 'Already sniped token, skipping');
        await sendTelegramAlert(`*Already sniped token:* \`${targetToken}\``);
        return;
    }

    log.info({ pair: pairAddress }, 'New pair detected');

    if (BLOCKLIST.tokens.has(targetToken.toLowerCase())) {
        log.info({ token: targetToken }, 'Blocked token address, skipping');
        await sendTelegramAlert(`*Blocked token* \`${targetToken}\``);
        return;
    }

    if (BLOCKLIST.pairs.has(pairAddress.toLowerCase())) {
        log.info({ pair: pairAddress }, 'Blocked LP pair, skipping');
        await sendTelegramAlert(`*Blocked LP pair* \`${pairAddress}\``);
        return;
    }

    const isBad = await isKnownBadToken(targetToken);
    if (isBad) {
        log.info({ token: targetToken }, 'Known bad token or creator, skipping');
        await sendTelegramAlert(`*Known bad token or creator* \`${targetToken}\``);
        return;
    }

    // Sell simulation: always-on, hard block on failure (FIX-04)
    const canSell = await simulateSell(targetToken, wallet);
    if (!canSell) {
        log.warn({ token: targetToken }, 'Sell simulation failed, skipping buy');
        await sendTelegramAlert(`*Sell simulation failed for* \`${targetToken}\` -- buy skipped`);
        return;
    }

    const [isHoneypot, isBlacklisted, locked, sufficientLiquidity, validMetadata, canSwap, hasTax, hasLimits] = await Promise.all([
        checkHoneypot(targetToken),
        isBlacklistedToken(targetToken),
        isLiquidityLocked(pairAddress),
        isLiquiditySufficient(pairAddress),
        checkTokenMetadata(targetToken, provider),
        simulateSwap(targetToken, provider, wallet.address),
        hasHighTransferTax(targetToken, provider, wallet.address),
        hasMaxWalletOrTxLimits(targetToken, provider, wallet.address),
    ]);

    const tokenContract = new Contract(targetToken, ERC20_ABI, provider);

    let symbol = "?", name = "?", decimals = 18;
    try {
        [symbol, name, decimals] = await Promise.all([
            tokenContract.symbol(),
            tokenContract.name(),
            tokenContract.decimals(),
        ]);
    } catch {}

    const lp = new Contract(pairAddress, PAIR_ABI, provider);

    let ethLiquidity = "?";
    try {
        const [token0Addr, reserves] = await Promise.all([
            lp.token0(),
            lp.getReserves()
        ]);

        const wethReserve = token0Addr.toLowerCase() === CONFIG.wethAddress.toLowerCase() ? reserves.reserve0 : reserves.reserve1;
        ethLiquidity = ethers.formatEther(wethReserve);
    } catch {}

    await sendTelegramAlert(`*New Token Detected!*\nSymbol: \`${symbol}\`\nDecimals: \`${decimals}\`\nWETH LP: \`${ethLiquidity} ETH\`\nLocked: \`${locked ? "Yes" : "No"}\`\nHoneypot: \`${isHoneypot ? "Yes" : "No"}\`\nBlacklist Function: \`${isBlacklisted ? "Yes" : "No"}\`\nMaxTx/Wallet: \`${hasLimits ? "Yes" : "No"}\`\n\nToken: [\`${targetToken}\`](https://etherscan.io/token/${targetToken})\nPair: [\`${pairAddress}\`](https://etherscan.io/address/${pairAddress})`);

    if (isHoneypot || isBlacklisted || !locked || !sufficientLiquidity || !validMetadata || !canSwap || hasTax || hasLimits) {
        log.info({ token: targetToken, checks: { isHoneypot, isBlacklisted, locked, sufficientLiquidity, validMetadata, canSwap, hasTax, hasLimits } }, 'Safety checks failed, skipping');
        return;
    }

    log.info({ token: targetToken, symbol }, 'All safety checks passed, buying');

    const path = [CONFIG.wethAddress, targetToken];
    const deadline = Math.floor(Date.now() / 1000) + 60;
    const amountIn = ethers.parseEther(CONFIG.snipeAmountETH);

    let minOut: bigint = 0n;
    try {
        const slippage = CONFIG.slippagePercent || 5;
        const amountsOut = await router.getAmountsOut(amountIn, path);
        const expectedOut = amountsOut[1];
        minOut = expectedOut - (expectedOut * BigInt(slippage) / 100n);
    } catch {
        log.warn({ token: targetToken }, 'Failed to calculate slippage-adjusted minOut, defaulting to 0');
    }

    try {
        await sendTxWithRetry(
            () => wallet.populateTransaction({
                to: CONFIG.routerAddress,
                data: router.interface.encodeFunctionData("swapExactETHForTokens", [
                    minOut,
                    path,
                    wallet.address,
                    deadline
                ]),
                value: amountIn,
            }),
            provider,
            wallet,
            true
        );

        insertTrade.run({
            token: targetToken.toLowerCase(),
            chain: CONFIG.network,
            action: 'buy',
            txHash: 'flashbots_bundle',
            block: null,
            timestamp: Math.floor(Date.now() / 1000),
            amountIn: CONFIG.snipeAmountETH,
            amountOut: null,
            gasCost: null,
            priceAtAction: null,
            status: 'pending'
        });
        await sendTelegramAlert(`*Buy TX sent via Flashbots* for \`${symbol}\``);
        log.info({ token: targetToken, symbol }, 'Flashbots bundle submitted');
        log.info({ token: targetToken }, 'TX confirmed');
        await sendTelegramAlert(`*TX confirmed* for \`${symbol}\``);

        await monitorStopLoss(targetToken, CONFIG.snipeAmountETH);
        await monitorTakeProfit(targetToken, CONFIG.snipeAmountETH);
        await scheduleTimedSell(targetToken);
    } catch (e) {
        log.error({ err: e, token: targetToken }, 'TX failed');
        updateTradeStatus.run('failed', targetToken.toLowerCase());
        await sendTelegramAlert(`*TX failed* for \`${symbol}\``);
    }
}

// ---------------------------------------------------------------------------
// WebSocket listener with auto-reconnect (per D-11)
// ---------------------------------------------------------------------------

async function startDexListener(
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

    const dexFactory = new Contract(dex.factoryAddress, FACTORY_ABI, wsProvider);
    const listener = (token0: string, token1: string, pair: string) => {
        handleNewPairForChain(ctx, dex, token0, token1, pair);
    };

    dexFactory.on('PairCreated', listener);
    ctx.log.info({ dex: dex.name, factory: dex.factoryAddress }, 'Listening for PairCreated events via WebSocket');

    // Reconnect handling (per D-11)
    let reconnectDelay = 1000;
    const maxDelay = 60000;

    // Named function for close handler -- avoids arguments.callee (forbidden in strict mode)
    async function handleWsClose(): Promise<void> {
        ctx.log.warn({ dex: dex.name, delay: reconnectDelay }, 'WebSocket disconnected, reconnecting');
        await sendCtxAlert(ctx, `WebSocket disconnected for ${dex.name}, reconnecting...`);

        // Remove old provider from cache
        removeWsProvider(ctx.chain.name);

        // Exponential backoff reconnect loop
        while (true) {
            await new Promise(r => setTimeout(r, reconnectDelay));
            reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);

            try {
                const newWsProvider = new WebSocketProvider(ctx.chain.wsRpcUrl!, ctx.chain.chainId);
                // Update context
                ctx.wsProvider = newWsProvider;
                // Re-register listener on new factory contract
                const newFactory = new Contract(dex.factoryAddress, FACTORY_ABI, newWsProvider);
                newFactory.on('PairCreated', listener);
                reconnectDelay = 1000; // reset on success
                ctx.log.info({ dex: dex.name }, 'WebSocket reconnected, re-subscribed to PairCreated');
                await sendCtxAlert(ctx, `WebSocket reconnected for ${dex.name}`);

                // Re-attach close handler to new WebSocket using named function reference
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
                    handleNewPairForChain(ctx, dex, event.args[0], event.args[1], event.args[2]);
                }
            }
            lastBlock = currentBlock;
        } catch (err) {
            ctx.log.error({ err, dex: dex.name }, 'HTTP polling error');
        }
    }, 2000); // poll every 2 seconds
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

    // 8. Shutdown handler
    initMultiChainShutdownHandler(contexts);

    mainLog.info({ chains: contexts.map(c => c.chain.name) }, 'Multi-chain bot fully started');
}

// ---------------------------------------------------------------------------
// Resume monitoring for pending trades across all chains
// ---------------------------------------------------------------------------

function resumeMultiChainMonitoring(contexts: ChainContext[]): void {
    const pendingTrades = db.prepare(
        'SELECT DISTINCT token, chain FROM trades WHERE status = ?'
    ).all('pending') as { token: string; chain: string }[];

    for (const { token, chain: chainName } of pendingTrades) {
        const ctx = contexts.find(c => c.chain.name === chainName);
        if (!ctx) {
            log.warn({ token, chain: chainName }, 'No active context for chain, skipping resume');
            continue;
        }

        // Use first DEX for resume monitoring (best effort)
        const dex = ctx.chain.dexes[0];
        if (!dex) {
            ctx.log.warn({ token }, 'No DEX configured for chain, skipping resume');
            continue;
        }

        ctx.log.info({ token }, 'Restarting monitoring for pending token');
        const tokenContract = new Contract(token, ERC20_ABI, ctx.wallet);
        tokenContract.balanceOf(ctx.wallet.address).then((balance: bigint) => {
            if (balance === 0n) {
                ctx.log.info({ token }, 'Zero balance for pending token, marking as failed');
                updateTradeStatus.run('failed', token);
                return;
            }
            monitorStopLossForChain(ctx, dex, token, ctx.chain.snipeAmount);
            monitorTakeProfitForChain(ctx, dex, token, ctx.chain.snipeAmount);
            scheduleTimedSellForChain(ctx, dex, token);
        }).catch((e: unknown) => {
            ctx.log.error({ err: e, token }, 'Error checking balance for pending token');
        });
    }
}

// ---------------------------------------------------------------------------
// Multi-chain shutdown handler
// ---------------------------------------------------------------------------

function initMultiChainShutdownHandler(contexts: ChainContext[]): void {
    let shuttingDown = false;

    function gracefulShutdown(signal: string): void {
        if (shuttingDown) return;
        shuttingDown = true;

        log.info({ signal }, 'Shutdown signal received, cleaning up all chains');

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

    // Safety net: force exit after 5 seconds if graceful shutdown hangs
    process.on('SIGTERM', () => {
        setTimeout(() => {
            log.error('Force exit after 5s timeout');
            process.exit(1);
        }, 5000).unref();
    });

    process.on('SIGINT', () => {
        setTimeout(() => {
            log.error('Force exit after 5s timeout');
            process.exit(1);
        }, 5000).unref();
    });
}

// ---------------------------------------------------------------------------
// Legacy resume monitoring (unchanged for backward compat)
// ---------------------------------------------------------------------------

function resumeMonitoring(): void {
    const pendingTrades = db.prepare('SELECT DISTINCT token FROM trades WHERE status = ?').all('pending') as { token: string }[];
    for (const { token } of pendingTrades) {
        log.info({ token }, 'Restarting monitoring for pending token');
        const tokenContract = new Contract(token, ERC20_ABI, wallet);
        tokenContract.balanceOf(wallet.address).then((balance: bigint) => {
            if (balance === 0n) {
                log.info({ token }, 'Zero balance for pending token, marking as failed');
                updateTradeStatus.run('failed', token);
                return;
            }
            monitorStopLoss(token, CONFIG.snipeAmountETH);
            monitorTakeProfit(token, CONFIG.snipeAmountETH);
            scheduleTimedSell(token);
        }).catch((e: unknown) => {
            log.error({ err: e, token }, 'Error checking balance for pending token');
        });
    }
}

// ---------------------------------------------------------------------------
// Legacy startBot (kept for backward compat)
// ---------------------------------------------------------------------------

function startBot() {
    log.info('Listening for new pairs');
    initShutdownHandler(factory);
    resumeMonitoring();
    factory.on("PairCreated", async (token0: string, token1: string, pair: string) => {
        handleNewPair(token0, token1, pair);
    });
}

// ---------------------------------------------------------------------------
// Entry point -- use multi-chain bot
// ---------------------------------------------------------------------------

if (require.main === module) {
    startMultiChainBot();
}
