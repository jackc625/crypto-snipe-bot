import axios from "axios";
import { CONFIG } from "../config";
import { JsonRpcProvider, Contract, Wallet, ethers } from "ethers";
import { BLOCKLIST } from "./blocklist";
import { retry } from "./retry";
import { getProvider } from "./provider";
import { logger } from "./logger";
import { ERC20_ABI, ROUTER_ABI, PAIR_ABI, TOKEN_LIMITS_ABI } from "./abis";
import type { ChainContext } from '../chainRegistry';
import { honeypotIsCheck } from './safetyProviders/honeypotIs';
import { goplusHoneypotCheck, goplusLiquidityLockCheck } from './safetyProviders/goplus';
import { unicryptLockCheck } from './safetyProviders/unicrypt';
import { mudraLockCheck } from './safetyProviders/mudra';

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

// DELETED: hasHighTransferTax (Phase 21.1 review-fix, WR-01). The single-chain
// twin of the already-removed hasHighTransferTaxForChain — and the MORE dangerous
// of the two. Its comment "static by default in ethers v6" was FALSE: it built a
// Wallet-SIGNER-connected router and called swapExactETHForTokens(0n, …, {value})
// WITHOUT .staticCall, i.e. a REAL on-chain buy at amountOutMin=0 inside a "safety
// check", then misread the TransactionResponse as a bigint[] so taxPercent=NaN and
// the gate never fired (broken math). Verified ZERO live callers in src/ (the
// chain banks use the *ForChain variants; this function was only imported, never
// invoked). Deleted entirely (function + the src/bot.ts import + the dead unit
// test) per D-DELETE-LEGACY / D-ROLLBACK — no re-introduction hazard. The
// authoritative buy+sell tax/honeypot gate is the on-chain simulateHoneypotRoundtrip
// (bot.ts:253 V2 / :566 V3, HONEY-07/09, fail-closed), unchanged.

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

// ---------------------------------------------------------------------------
// Chain-aware versions (dispatch based on ChainConfig.safetyApis)
// ---------------------------------------------------------------------------

/**
 * Chain-aware honeypot check. Dispatches to honeypot.is or GoPlus
 * based on ctx.chain.safetyApis.honeypot.
 */
export async function checkHoneypotForChain(ctx: ChainContext, tokenAddress: string): Promise<boolean> {
    const provider = ctx.chain.safetyApis.honeypot;
    if (provider === 'honeypot.is') return honeypotIsCheck(ctx, tokenAddress);
    if (provider === 'goplus') return goplusHoneypotCheck(ctx, tokenAddress);
    throw new Error(`Unknown honeypot provider: ${provider}`);
}

/**
 * Chain-aware liquidity lock check. Dispatches to Unicrypt, Mudra,
 * or GoPlus based on ctx.chain.safetyApis.liquidityLock.
 */
export async function isLiquidityLockedForChain(ctx: ChainContext, pairAddress: string): Promise<boolean> {
    const provider = ctx.chain.safetyApis.liquidityLock;
    if (provider === 'unicrypt') return unicryptLockCheck(ctx, pairAddress);
    if (provider === 'mudra') return mudraLockCheck(ctx, pairAddress);
    if (provider === 'goplus') return goplusLiquidityLockCheck(ctx, pairAddress);
    throw new Error(`Unknown liquidity lock provider: ${provider}`);
}

/**
 * Chain-aware blacklist token check using ctx.httpProvider.
 */
export async function isBlacklistedTokenForChain(ctx: ChainContext, tokenAddress: string): Promise<boolean> {
    const antiBotSelectors = ["0xdd62ed3e", "0x4f7fb7c3", "0x60fe47b1"];
    try {
        const bytecode = await ctx.httpProvider.getCode(tokenAddress);
        return antiBotSelectors.some(sig => bytecode.includes(sig));
    } catch (e) {
        ctx.log.warn({ err: e, token: tokenAddress, check: 'blacklist' }, 'Blacklist scan failed');
        return true;
    }
}

/**
 * Chain-aware token metadata check using ctx.httpProvider.
 */
export async function checkTokenMetadataForChain(ctx: ChainContext, tokenAddress: string): Promise<boolean> {
    const token = new Contract(tokenAddress, ERC20_ABI, ctx.httpProvider);

    try {
        const [symbol, name, decimals, tradingEnabled] = await Promise.all([
            token.symbol(),
            token.name(),
            token.decimals(),
            token.tradingEnabled?.().catch(() => true)
        ]);

        if (!symbol || symbol.length < 2 || symbol.length > 10) return false;
        if (!name || name.length < 2) return false;
        if (decimals < 6 || decimals > 18) return false;
        if (tradingEnabled === false) return false;

        return true;
    } catch (e) {
        ctx.log.warn({ err: e, token: tokenAddress, check: 'metadata' }, 'Metadata check failed');
        return false;
    }
}

/**
 * Chain-aware swap simulation using chain-specific router and WETH.
 */
export async function simulateSwapForChain(
    ctx: ChainContext,
    dexRouter: string,
    tokenAddress: string
): Promise<boolean> {
    const router = new Contract(dexRouter, ROUTER_ABI, ctx.httpProvider);
    const path = [ctx.chain.wethAddress, tokenAddress];
    const amountIn = ethers.parseEther(ctx.chain.snipeAmount);
    const amountOutMin = 0;
    const deadline = Math.floor(Date.now() / 1000) + 60;

    try {
        await router.swapExactETHForTokens.staticCall(
            amountOutMin,
            path,
            ctx.wallet.address,
            deadline,
            { value: amountIn }
        );
        return true;
    } catch (e: any) {
        ctx.log.warn({ err: e, token: tokenAddress, check: 'swapSimulation' }, 'Swap simulation failed');
        return false;
    }
}

/**
 * Chain-aware liquidity sufficiency check using chain-specific WETH.
 */
export async function isLiquiditySufficientForChain(ctx: ChainContext, pairAddress: string): Promise<boolean> {
    const pair = new Contract(pairAddress, PAIR_ABI, ctx.httpProvider);

    try {
        // Plan 18-WR-02 fix-along: dropped the dead `pair.token1()` RPC call
        // (Promise.all awaited both but token1 was destructured-out and never
        // used). Saves one RPC round-trip per liquidity check. The single-
        // chain variant at isLiquiditySufficient (line ~169) reads BOTH and
        // is unaffected.
        const token0 = await pair.token0();

        const { reserve0, reserve1 } = await pair.getReserves();

        const wethReserve = token0.toLowerCase() === ctx.chain.wethAddress.toLowerCase()
            ? reserve0
            : reserve1;

        const minRequired = ethers.parseEther("1");
        if (wethReserve < minRequired) {
            ctx.log.warn({ pair: pairAddress, wethReserve: wethReserve.toString(), check: 'liquidity' }, 'Insufficient liquidity');
            return false;
        }

        return true;
    } catch (e) {
        ctx.log.warn({ err: e, pair: pairAddress, check: 'liquidity' }, 'Error checking liquidity');
        return false;
    }
}

/**
 * Chain-aware known bad token check using ctx.httpProvider.
 */
export async function isKnownBadTokenForChain(ctx: ChainContext, tokenAddress: string): Promise<boolean> {
    try {
        const code = await ctx.httpProvider.getCode(tokenAddress);
        if (!code || code === "0x") {
            ctx.log.warn({ token: tokenAddress, check: 'knownBad' }, 'No contract found at token address');
            return true;
        }

        if (BLOCKLIST.tokens.has(tokenAddress.toLowerCase())) {
            ctx.log.warn({ token: tokenAddress, check: 'blocklist' }, 'Token is in blocklist');
            return true;
        }

        return false;
    } catch (e) {
        ctx.log.warn({ err: e, token: tokenAddress, check: 'blocklist' }, 'Blocklist check failed');
        return false;
    }
}

// ---------------------------------------------------------------------------
// DELETED: hasHighTransferTaxForChain (STOP-THE-LINE-01 + STOP-THE-LINE-03,
// plan 21.1-03, D-V3-TAX-REMOVE / D-V2-TAX-REMOVE / D-ROLLBACK).
//
// This chain-aware "transfer tax" check was removed from BOTH safety banks and
// then deleted entirely (zero callers). It was redundant AND harmful:
//   - REDUNDANT: simulateHoneypotRoundtrip runs on BOTH paths BEFORE the bank
//     (bot.ts:253 V2 / bot.ts:566 V3) and already enforces buy+sell tax
//     fail-closed via the on-chain HoneypotChecker (maxBuyTaxBps/maxSellTaxBps,
//     HONEY-07/09) — the authoritative tax/honeypot gate.
//   - HARMFUL (V2): it built a SIGNER-connected router and called
//     swapExactETHForTokens(0n, ..., {value: snipeAmount}) with NO .staticCall
//     — a REAL on-chain buy at amountOutMin=0 (uncapped slippage) on every V2
//     snipe — then misread the returned TransactionResponse as a bigint[] so
//     taxPercent=NaN -> `> 0.25` is false -> the gate NEVER fired (a silent
//     false-negative on top of the unwanted real buy / double-spend).
//   - BROKEN (V3): the V3 SwapRouter has no getAmountsOut, so the call reverted
//     -> catch returned true -> EVERY V3 buy aborted.
//
// The clean read-only sibling simulateSwapForChain (above) — which DOES use
// .staticCall — is intentionally KEPT (audited clean). Do NOT reintroduce a
// transfer-tax helper here: the on-chain roundtrip is the correct mechanism.
// ---------------------------------------------------------------------------

/**
 * Chain-aware max wallet/tx limits check using ctx.httpProvider.
 */
export async function hasMaxWalletOrTxLimitsForChain(
    ctx: ChainContext,
    tokenAddress: string
): Promise<boolean> {
    const token = new Contract(tokenAddress, TOKEN_LIMITS_ABI, ctx.httpProvider);

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

                ctx.log.debug({ token: tokenAddress, limitName: fn, percent: (percent * 100).toFixed(2), check: 'maxLimits' }, 'Token limit check');

                if (percent < 0.01) {
                    ctx.log.warn({ token: tokenAddress, limitName: fn, percent: (percent * 100).toFixed(2), check: 'maxLimits' }, 'Anti-bot limit detected');
                    return true;
                }
            } catch {
                // Method not found -- silently continue
            }
        }

        return false;
    } catch (e) {
        ctx.log.warn({ err: e, token: tokenAddress, check: 'maxLimits' }, 'Max wallet/tx check failed');
        return true;
    }
}

// ---------------------------------------------------------------------------
// REMOVED per Phase 18 plan 18-09 D-ROLLBACK (2026-05-22):
//   simulateSellForChain    — V2 sell-sim (balance=0 hard-block at every snipe)
//   simulateSellV3ForChain  — V3 sell-sim (vacuous-pass via early-return on zero balance)
// Both functions are gone entirely; no legacy fallback flag retained
// (D-ROLLBACK forbids any opt-in env switch or compatibility shim).
// Replacement is simulateHoneypotRoundtrip in src/utils/honeypot/index.ts,
// wired into bot.ts by plan 18-10.
// ---------------------------------------------------------------------------
