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
import { markSniped, isAlreadySniped, updateTokenStatus } from "./utils/storage";
import { getState } from "./utils/storage";
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

const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpc[CONFIG.network]);
const wallet = new ethers.Wallet(CONFIG.walletPrivateKey, provider);

const factoryAbi = [
    "event PairCreated(address indexed token0, address indexed token1, address pair, uint)"
];
const routerAbi = [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory)",
    "function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory)",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory)"
];

const erc20Abi = [
    "function approve(address spender, uint amount) public returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address) view returns (uint)"
];


const factory = new Contract(CONFIG.factoryAddress, factoryAbi, provider);
const router = new Contract(CONFIG.routerAddress, routerAbi, wallet);

function log(...args: any[]) {
    console.log("[BOT]", ...args);
}

async function maybeApprove(token: Contract, amount: ethers.BigNumber) {
    const currentAllowance = await token.allowance(wallet.address, CONFIG.routerAddress);
    if (currentAllowance.lt(amount)) {
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
        log(`[${reason}] Another exit already handling ${tokenAddress}. Skipping.`);
        return;
    }

    try {
        const token = new Contract(tokenAddress, erc20Abi, wallet);
        const balance = await token.balanceOf(wallet.address);

        if (balance.isZero()) {
            log(`[${reason}] Zero balance for ${tokenAddress}. Cleaning up.`);
            updateTokenStatus(tokenAddress, "sold");
            clearAllTimersForToken(tokenAddress);
            return;
        }

        await maybeApprove(token, balance);
        const deadline = Math.floor(Date.now() / 1000) + 60;
        const path = [tokenAddress, CONFIG.wethAddress];

        const sellTx = await router.swapExactTokensForETH(
            balance, 0, path, wallet.address, deadline,
            { gasLimit: CONFIG.gasLimit || 300000, gasPrice: await provider.getGasPrice() }
        );

        log(`[${reason}] Sell TX sent: ${sellTx.hash}`);
        await sendTelegramAlert(`*${reason} sell TX sent:* [View](https://etherscan.io/tx/${sellTx.hash})`);
        await sellTx.wait();

        updateTokenStatus(tokenAddress, "sold");
        clearAllTimersForToken(tokenAddress);
        await sendTelegramAlert(`*${reason} TX confirmed*`);

    } catch (e) {
        log(`[${reason}] Sell failed for ${tokenAddress}:`, e);
        updateTokenStatus(tokenAddress, "failed");
        clearAllTimersForToken(tokenAddress);
        await sendTelegramAlert(`*${reason} sell failed:* ${e instanceof Error ? e.message : String(e)}`);
    }
}

async function monitorStopLoss(tokenAddress: string, buyAmountETH: string) {
    const path = [tokenAddress, CONFIG.wethAddress];
    const buyAmount = ethers.utils.parseEther(buyAmountETH);
    const initialOut = await router.getAmountsOut(buyAmount, path).catch(() => null);

    if (!initialOut) return;

    const initialPrice = Number(initialOut[1]);
    const stopLossPercent = CONFIG.stopLossPercent || 25;
    const stopLossPrice = initialPrice * (1 - stopLossPercent / 100);

    log("Monitoring for stop-loss...");

    const interval = setInterval(async () => {
        try {
            // Balance-zero check: if token balance is zero, stop monitoring (FIX-08)
            const token = new Contract(tokenAddress, erc20Abi, wallet);
            const balance = await token.balanceOf(wallet.address);
            if (balance.isZero()) {
                log("[stop-loss] Zero balance detected. Stopping monitor.");
                clearAllTimersForToken(tokenAddress);
                updateTokenStatus(tokenAddress, "sold");
                return;
            }

            const currentOut = await router.getAmountsOut(buyAmount, path);
            const currentPrice = Number(currentOut[1]);
            const roi = ((currentPrice - initialPrice) / initialPrice) * 100;

            log(`[stop-loss] Current ROI: ${roi.toFixed(2)}%`);

            if (currentPrice < stopLossPrice) {
                log("[stop-loss] Stop-loss triggered. Selling token...");
                await executeSell(tokenAddress, 'stop-loss');
            }
        } catch (e) {
            log("[stop-loss] Error monitoring:", e);
        }
    }, CONFIG.stopLossCheckInterval || 15000);

    registerStopLoss(tokenAddress, interval);
}

async function monitorTakeProfit(tokenAddress: string, buyAmountETH: string) {
    const path = [tokenAddress, CONFIG.wethAddress];
    const buyAmount = ethers.utils.parseEther(buyAmountETH);
    const initialOut = await router.getAmountsOut(buyAmount, path).catch(() => null);

    if (!initialOut) return;

    const initialPrice = Number(initialOut[1]);
    const takeProfitPrice = initialPrice * (1 + CONFIG.takeProfitPercent / 100);

    log("Monitoring for take-profit...");

    const interval = setInterval(async () => {
        try {
            // Balance-zero check: if token balance is zero, stop monitoring (FIX-08)
            const token = new Contract(tokenAddress, erc20Abi, wallet);
            const balance = await token.balanceOf(wallet.address);
            if (balance.isZero()) {
                log("[take-profit] Zero balance detected. Stopping monitor.");
                clearAllTimersForToken(tokenAddress);
                updateTokenStatus(tokenAddress, "sold");
                return;
            }

            const currentOut = await router.getAmountsOut(buyAmount, path);
            const currentPrice = Number(currentOut[1]);

            if (currentPrice >= takeProfitPrice) {
                log("[take-profit] Take-profit triggered. Selling token...");
                await executeSell(tokenAddress, 'take-profit');
            }
        } catch (e) {
            log("[take-profit] Error monitoring:", e);
        }
    }, CONFIG.takeProfitCheckInterval || 15000);

    registerTakeProfit(tokenAddress, interval);
}

async function scheduleTimedSell(tokenAddress: string) {
    log(`Scheduled auto-sell in ${CONFIG.autoSellAfterMs / 60000} minutes...`);

    const timeout = setTimeout(async () => {
        await executeSell(tokenAddress, 'timed-sell');
    }, CONFIG.autoSellAfterMs);

    registerTimedSell(tokenAddress, timeout);
}

export async function handleNewPair(token0: string, token1: string, pairAddress: string) {
    const targetToken =
        token0.toLowerCase() === CONFIG.wethAddress.toLowerCase() ? token1 : token0;

    if (isAlreadySniped(targetToken)) {
        log("Already sniped token. Skipping.");
        await sendTelegramAlert(`*Already sniped token:* \`${targetToken}\``);
        return;
    }

    log("New pair detected:", pairAddress);

    if (BLOCKLIST.tokens.has(targetToken.toLowerCase())) {
        log("Blocked token address detected. Skipping.");
        await sendTelegramAlert(`*Blocked token* \`${targetToken}\``);
        return;
    }

    if (BLOCKLIST.pairs.has(pairAddress.toLowerCase())) {
        log("Blocked LP pair address detected. Skipping.");
        await sendTelegramAlert(`*Blocked LP pair* \`${pairAddress}\``);
        return;
    }

    const isBad = await isKnownBadToken(targetToken);
    if (isBad) {
        log("Known bad token or creator. Skipping.");
        await sendTelegramAlert(`*Known bad token or creator* \`${targetToken}\``);
        return;
    }

    // Sell simulation: always-on, hard block on failure (FIX-04)
    const canSell = await simulateSell(targetToken, wallet);
    if (!canSell) {
        log("[SAFETY] Sell simulation failed -- skipping buy.");
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

    const token = new Contract(targetToken, [
        "function symbol() view returns (string)",
        "function name() view returns (string)",
        "function decimals() view returns (uint8)"
    ], provider);

    let symbol = "?", name = "?", decimals = 18;
    try {
        [symbol, name, decimals] = await Promise.all([
            token.symbol(),
            token.name(),
            token.decimals(),
        ]);
    } catch {}

    const lp = new Contract(pairAddress, [
        "function getReserves() view returns (uint112,uint112,uint32)",
        "function token0() view returns (address)",
        "function token1() view returns (address)"
    ], provider);

    let ethLiquidity = "?";
    try {
        const [token0, { reserve0, reserve1 }] = await Promise.all([
            lp.token0(),
            lp.getReserves()
        ]);

        const wethReserve = token0.toLowerCase() === CONFIG.wethAddress.toLowerCase() ? reserve0 : reserve1;
        ethLiquidity = ethers.utils.formatEther(wethReserve);
    } catch {}

    await sendTelegramAlert(`*New Token Detected!*\nSymbol: \`${symbol}\`\nDecimals: \`${decimals}\`\nWETH LP: \`${ethLiquidity} ETH\`\nLocked: \`${locked ? "Yes" : "No"}\`\nHoneypot: \`${isHoneypot ? "Yes" : "No"}\`\nBlacklist Function: \`${isBlacklisted ? "Yes" : "No"}\`\nMaxTx/Wallet: \`${hasLimits ? "Yes" : "No"}\`\n\nToken: [\`${targetToken}\`](https://etherscan.io/token/${targetToken})\nPair: [\`${pairAddress}\`](https://etherscan.io/address/${pairAddress})`);

    if (isHoneypot || isBlacklisted || !locked || !sufficientLiquidity || !validMetadata || !canSwap || hasTax || hasLimits) {
        log("One or more safety checks failed. Skipping.");
        return;
    }

    log("All safety checks passed. Buying token...");

    const path = [CONFIG.wethAddress, targetToken];
    const deadline = Math.floor(Date.now() / 1000) + 60;
    const amountIn = ethers.utils.parseEther(CONFIG.snipeAmountETH);

    let minOut = 0;
    try {
        const slippage = CONFIG.slippagePercent || 5;
        const amountsOut = await router.getAmountsOut(amountIn, path);
        const expectedOut = amountsOut[1];
        minOut = expectedOut.sub(expectedOut.mul(slippage).div(100));
    } catch {
        log("Failed to calculate slippage-adjusted minOut. Defaulting to 0.");
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

        markSniped(targetToken, "flashbots_bundle");
        await sendTelegramAlert(`*Buy TX sent via Flashbots* for \`${symbol}\``);
        log("Flashbots bundle submitted");
        log("TX confirmed");
        await sendTelegramAlert(`*TX confirmed* for \`${symbol}\``);

        await monitorStopLoss(targetToken, CONFIG.snipeAmountETH);
        await monitorTakeProfit(targetToken, CONFIG.snipeAmountETH);
        await scheduleTimedSell(targetToken);
    } catch (e) {
        log("TX failed:", e);
        updateTokenStatus(targetToken, "failed");
        await sendTelegramAlert(`*TX failed* for \`${symbol}\``);
    }
}

// Resume monitoring for tokens with 'pending' status after restart (FIX-05).
// Checks balance before resuming -- token may have been rugged during downtime.
function resumeMonitoring(): void {
    const state = getState();
    for (const [token, info] of Object.entries(state.sniped)) {
        if (info.status === 'pending') {
            log(`[RESUME] Restarting monitoring for ${token}`);
            const tokenContract = new Contract(token, erc20Abi, wallet);
            tokenContract.balanceOf(wallet.address).then((balance: ethers.BigNumber) => {
                if (balance.isZero()) {
                    log(`[RESUME] Zero balance for ${token}. Marking as failed.`);
                    updateTokenStatus(token, "failed");
                    return;
                }
                monitorStopLoss(token, CONFIG.snipeAmountETH);
                monitorTakeProfit(token, CONFIG.snipeAmountETH);
                scheduleTimedSell(token);
            }).catch((e: unknown) => {
                log(`[RESUME] Error checking balance for ${token}:`, e);
            });
        }
    }
}

function startBot() {
    log("Listening for new pairs...");
    initShutdownHandler(factory);
    resumeMonitoring();
    factory.on("PairCreated", async (token0: string, token1: string, pair: string) => {
        handleNewPair(token0, token1, pair);
    });
}

if (require.main === module) {
    startBot();
}
