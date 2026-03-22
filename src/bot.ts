import { ethers, Contract } from "ethers";
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
import { BLOCKLIST } from "./utils/blocklist";
import { sendTelegramAlert } from "./utils/notifier";
import { db, insertTrade, isTokenSniped, updateTradeStatus } from "./utils/db";
import { logger } from "./utils/logger";
import { getProvider, getWallet } from "./utils/provider";
import { FACTORY_ABI, ROUTER_ABI, ERC20_ABI, PAIR_ABI } from "./utils/abis";
import { sendTxWithRetry } from "./utils/txManager";
import {
    tryAcquireSellLock,
    registerStopLoss,
    registerTakeProfit,
    registerTimedSell,
    clearAllTimersForToken,
    initShutdownHandler,
    isShutdownInProgress
} from "./utils/exitManager";

const provider = getProvider();
const wallet = getWallet();

const factory = new Contract(CONFIG.factoryAddress, FACTORY_ABI, provider);
const router = new Contract(CONFIG.routerAddress, ROUTER_ABI, wallet);

const log = logger.child({ module: 'bot' });

async function maybeApprove(token: Contract, amount: bigint) {
    const currentAllowance = await token.allowance(wallet.address, CONFIG.routerAddress);
    if (currentAllowance < amount) {
        await token.approve(CONFIG.routerAddress, amount);
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

// Resume monitoring for tokens with 'pending' status after restart (FIX-05).
// Checks balance before resuming -- token may have been rugged during downtime.
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

function startBot() {
    log.info('Listening for new pairs');
    initShutdownHandler(factory);
    resumeMonitoring();
    factory.on("PairCreated", async (token0: string, token1: string, pair: string) => {
        handleNewPair(token0, token1, pair);
    });
}

if (require.main === module) {
    startBot();
}
