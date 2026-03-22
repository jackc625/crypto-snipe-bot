import axios from "axios";
import { CONFIG } from "../config";
import { JsonRpcProvider, Contract, Wallet, ethers } from "ethers";
import { BLOCKLIST } from "./blocklist";
import { retry } from "./retry";
import { getProvider } from "./provider";
import { logger } from "./logger";
import { ERC20_ABI, ROUTER_ABI, PAIR_ABI, TOKEN_LIMITS_ABI } from "./abis";

const log = logger.child({ module: 'tokenSafety' });

const UNICRYPT_API = "https://api.unicrypt.network/api/v2/locker/pair/";

export async function checkHoneypot(tokenAddress: string): Promise<boolean> {
    const provider = getProvider();
    const router = new Contract(CONFIG.routerAddress, ROUTER_ABI, provider);
    const amountIn = ethers.parseEther(CONFIG.snipeAmountETH);
    const path = [CONFIG.wethAddress, tokenAddress];
    const deadline = Math.floor(Date.now() / 1000) + 60;

    try {
        // Try primary API check
        const { data } = await retry(() =>
            axios.get(`${CONFIG.honeypotCheckURL}${tokenAddress}`)
        );
        return data.isHoneypot;
    } catch (apiErr: unknown) {
        const message = (apiErr instanceof Error) ? apiErr.message : String(apiErr);
        log.warn({ check: 'honeypot', error: message }, 'Honeypot API check failed');
        log.info({ check: 'honeypot', fallback: 'staticCall' }, 'Falling back to static call simulation');

        try {
            await router.swapExactETHForTokens.staticCall(
                0,
                path,
                CONFIG.walletPrivateKey,
                deadline,
                { value: amountIn }
            );
            return false; // not a honeypot
        } catch (e: unknown) {
            const fallbackMessage = (e instanceof Error) ? e.message : String(e);
            log.warn({ check: 'honeypot', error: fallbackMessage }, 'Honeypot fallback failed, likely honeypot');
            return true;
        }
    }
}



export async function isBlacklistedToken(tokenAddress: string): Promise<boolean> {
    const provider = getProvider();
    const antiBotSelectors = ["0xdd62ed3e", "0x4f7fb7c3", "0x60fe47b1"];
    const bytecode = await provider.getCode(tokenAddress);
    return antiBotSelectors.some(sig => bytecode.includes(sig));
}

export async function isLiquidityLocked(pairAddress: string): Promise<boolean> {
    try {
        const { data } = await retry(() =>
            axios.get(`${UNICRYPT_API}${pairAddress}?chainId=11155111`)
        );
        const locks = data.locks;

        if (!locks || locks.length === 0) {
            log.warn({ pair: pairAddress, check: 'liquidityLock' }, 'No liquidity lock found on Unicrypt');
            return false;
        }

        const now = Date.now() / 1000;
        const anyActiveLock = locks.some((lock: any) => lock.unlock_date > now);

        return anyActiveLock;
    } catch (e) {
        log.warn({ pair: pairAddress, check: 'liquidityLock', fallback: 'burnCheck' }, 'Unicrypt API failed, falling back to burn check');
        return await fallbackCheckBurned(pairAddress);
    }
}

async function fallbackCheckBurned(pairAddress: string): Promise<boolean> {
    const provider = getProvider();
    const pair = new Contract(pairAddress, PAIR_ABI, provider);

    try {
        const burned = await pair.balanceOf("0x000000000000000000000000000000000000dEaD");
        const total = await pair.totalSupply();

        const percentBurned = Number(burned) / Number(total);

        if (percentBurned > 0.9) {
            log.info({ pair: pairAddress, percentBurned: (percentBurned * 100).toFixed(1) }, 'LP appears burned');
            return true;
        }

        return false;
    } catch (e) {
        log.warn({ err: e, check: 'burnFallback' }, 'Burn fallback failed');
        return false;
    }
}

export async function checkTokenMetadata(
    tokenAddress: string,
    provider: JsonRpcProvider
): Promise<boolean> {
    const token = new Contract(tokenAddress, ERC20_ABI, provider);

    try {
        const [symbol, name, decimals, tradingEnabled] = await Promise.all([
            token.symbol(),
            token.name(),
            token.decimals(),
            token.tradingEnabled?.().catch(() => true) // default to true if method doesn't exist
        ]);

        // Basic checks
        if (!symbol || symbol.length < 2 || symbol.length > 10) return false;
        if (!name || name.length < 2) return false;
        if (decimals < 6 || decimals > 18) return false;
        if (tradingEnabled === false) return false;

        return true;
    } catch (e) {
        log.warn({ err: e, token: tokenAddress, check: 'metadata' }, 'Metadata check failed');
        return false;
    }
}

export async function simulateSwap(
    tokenAddress: string,
    provider: JsonRpcProvider,
    walletAddress: string
): Promise<boolean> {
    const router = new Contract(CONFIG.routerAddress, ROUTER_ABI, provider);

    const path = [CONFIG.wethAddress, tokenAddress];
    const amountIn = ethers.parseEther(CONFIG.snipeAmountETH);
    const amountOutMin = 0;
    const deadline = Math.floor(Date.now() / 1000) + 60;

    try {
        // Perform a static call to simulate the swap
        await router.swapExactETHForTokens.staticCall(
            amountOutMin,
            path,
            walletAddress,
            deadline,
            { value: amountIn }
        );

        return true;
    } catch (e: any) {
        log.warn({ err: e, token: tokenAddress, check: 'swapSimulation' }, 'Swap simulation failed');
        return false;
    }
}


export async function isLiquiditySufficient(pairAddress: string): Promise<boolean> {
    const provider = getProvider();
    const pair = new Contract(pairAddress, PAIR_ABI, provider);

    try {
        const [token0, token1] = await Promise.all([
            pair.token0(),
            pair.token1()
        ]);

        const { reserve0, reserve1 } = await pair.getReserves();

        const wethReserve = token0.toLowerCase() === CONFIG.wethAddress.toLowerCase()
            ? reserve0
            : reserve1;

        const minRequired = ethers.parseEther("1"); // Require at least 1 ETH in liquidity
        if (wethReserve < minRequired) {
            log.warn({ pair: pairAddress, wethReserve: wethReserve.toString(), check: 'liquidity' }, 'Insufficient ETH liquidity');
            return false;
        }

        return true;
    } catch (e) {
        log.warn({ err: e, pair: pairAddress, check: 'liquidity' }, 'Error checking liquidity');
        return false;
    }
}

export async function isKnownBadToken(tokenAddress: string): Promise<boolean> {
    const provider = getProvider();

    try {
        const code = await provider.getCode(tokenAddress);
        if (!code || code === "0x") {
            log.warn({ token: tokenAddress, check: 'knownBad' }, 'No contract found at token address');
            return true;
        }

        // skip creator check for free-tier Alchemy
        if (BLOCKLIST.tokens.has(tokenAddress.toLowerCase())) {
            log.warn({ token: tokenAddress, check: 'blocklist' }, 'Token is in blocklist');
            return true;
        }

        return false;
    } catch (e) {
        log.warn({ err: e, token: tokenAddress, check: 'blocklist' }, 'Blocklist check failed');
        return false;
    }
}

export async function hasHighTransferTax(
    tokenAddress: string,
    provider: JsonRpcProvider,
    walletAddress: string
): Promise<boolean> {
    const router = new Contract(CONFIG.routerAddress, ROUTER_ABI, provider);
    const path = [CONFIG.wethAddress, tokenAddress];
    const inputAmount = ethers.parseEther(CONFIG.snipeAmountETH);

    try {
        // 1. Estimate output via getAmountsOut
        const amountsOut: bigint[] = await router.getAmountsOut(inputAmount, path);
        const expectedOutput = amountsOut[1];

        // 2. Simulate actual received tokens by re-instantiating router with Wallet signer
        const wallet = new Wallet(CONFIG.walletPrivateKey, provider);
        const routerWithSigner = new Contract(CONFIG.routerAddress, ROUTER_ABI, wallet);

        // 3. "Call" the method (not send), which is static by default in ethers v6
        const actualOutput: bigint[] = await routerWithSigner.swapExactETHForTokens(
            0n,
            path,
            walletAddress,
            Math.floor(Date.now() / 1000) + 60,
            { value: inputAmount }
        );

        const received = actualOutput[actualOutput.length - 1];
        const taxPercent = 1 - Number(received) / Number(expectedOutput);

        log.info({ token: tokenAddress, taxPercent: (taxPercent * 100).toFixed(2), check: 'transferTax' }, 'Estimated transfer tax');

        return taxPercent > 0.25; // adjust this threshold as needed
    } catch (e) {
        log.warn({ err: e, token: tokenAddress, check: 'transferTax' }, 'Tax detection failed');
        return true; // default to blocking
    }
}

export async function hasMaxWalletOrTxLimits(
    tokenAddress: string,
    provider: JsonRpcProvider,
    walletAddress: string
): Promise<boolean> {
    const token = new Contract(tokenAddress, TOKEN_LIMITS_ABI, provider);

    try {
        const totalSupply: bigint = await token.totalSupply();

        const limits: string[] = [
            "maxWalletAmount",
            "maxWallet",
            "maxTxAmount",
            "maxTransactionAmount"
        ];

        for (const fn of limits) {
            try {
                const limit = await token[fn]();
                const percent = Number(limit) / Number(totalSupply);

                log.debug({ token: tokenAddress, limitName: fn, percent: (percent * 100).toFixed(2), check: 'maxLimits' }, 'Token limit check');

                if (percent < 0.01) {
                    log.warn({ token: tokenAddress, limitName: fn, percent: (percent * 100).toFixed(2), check: 'maxLimits' }, 'Anti-bot limit detected');
                    return true;
                }
            } catch {
                // Method not found — silently continue
            }
        }

        return false;
    } catch (e) {
        log.warn({ err: e, token: tokenAddress, check: 'maxLimits' }, 'Max wallet/tx check failed');
        return true; // safest fallback
    }
}

export async function simulateSell(
    tokenAddress: string,
    wallet: Wallet
): Promise<boolean> {
    try {
        const erc20 = new Contract(tokenAddress, ERC20_ABI, wallet);

        const balance = await erc20.balanceOf(wallet.address);
        await erc20.approve(CONFIG.routerAddress, balance);

        const router = new Contract(CONFIG.routerAddress, ROUTER_ABI, wallet);
        const path = [tokenAddress, CONFIG.wethAddress];
        const deadline = Math.floor(Date.now() / 1000) + 60;

        log.debug({ token: tokenAddress, check: 'sellSimulation' }, 'Simulating sell');
        log.debug({ token: tokenAddress, balance: balance.toString() }, 'Sell simulation balance');

        await router.swapExactTokensForETHSupportingFeeOnTransferTokens.staticCall(
            balance,
            0,
            path,
            wallet.address,
            deadline
        );

        return true;
    } catch (e) {
        log.warn({ err: e, token: tokenAddress, check: 'sellSimulation' }, 'Sell simulation failed');
        return false;
    }
}
