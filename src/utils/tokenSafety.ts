import axios from "axios";
import { CONFIG } from "../config";
import { JsonRpcProvider, Contract, Wallet, ethers } from "ethers";
import { BLOCKLIST } from "./blocklist";
import { retry } from "./retry";

const provider = new JsonRpcProvider(CONFIG.rpc[CONFIG.network]);

const ERC20_METADATA_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function tradingEnabled() view returns (bool)"
];

const UNICRYPT_API = "https://api.unicrypt.network/api/v2/locker/pair/";

const ROUTER_ABI = [
    "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory)",
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory)",
    "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)"
];

const PAIR_ABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

export async function checkHoneypot(tokenAddress: string): Promise<boolean> {
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
        console.warn(`⚠️ Honeypot API failed: ${message}`);
        console.log("🔁 Falling back to static call simulation...");

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
            console.warn("🚨 Honeypot fallback failed — likely a honeypot:", fallbackMessage);
            return true;
        }
    }
}



export async function isBlacklistedToken(tokenAddress: string): Promise<boolean> {
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
            console.warn("❌ No liquidity lock found on Unicrypt.");
            return false;
        }

        const now = Date.now() / 1000;
        const anyActiveLock = locks.some((lock: any) => lock.unlock_date > now);

        return anyActiveLock;
    } catch (e) {
        console.warn("⚠️ Unicrypt API failed, falling back to burn check.");
        return await fallbackCheckBurned(pairAddress);
    }
}

async function fallbackCheckBurned(pairAddress: string): Promise<boolean> {
    const pairABI = ["function balanceOf(address owner) view returns (uint256)", "function totalSupply() view returns (uint256)"];
    const provider = new JsonRpcProvider(process.env[`ALCHEMY_URL`]);
    const pair = new Contract(pairAddress, pairABI, provider);

    try {
        const burned = await pair.balanceOf("0x000000000000000000000000000000000000dEaD");
        const total = await pair.totalSupply();

        const percentBurned = Number(burned) / Number(total);

        if (percentBurned > 0.9) {
            console.log("🔥 LP appears burned (90%+).");
            return true;
        }

        return false;
    } catch (e) {
        console.warn("⚠️ Burn fallback failed:", e);
        return false;
    }
}

export async function checkTokenMetadata(
    tokenAddress: string,
    provider: JsonRpcProvider
): Promise<boolean> {
    const token = new Contract(tokenAddress, ERC20_METADATA_ABI, provider);

    try {
        const [symbol, name, decimals, tradingEnabled] = await Promise.all([
            token.symbol(),
            token.name(),
            token.decimals(),
            token.tradingEnabled?.().catch(() => true) // default to true if method doesn’t exist
        ]);

        // Basic checks
        if (!symbol || symbol.length < 2 || symbol.length > 10) return false;
        if (!name || name.length < 2) return false;
        if (decimals < 6 || decimals > 18) return false;
        if (tradingEnabled === false) return false;

        return true;
    } catch (e) {
        console.warn("❌ Metadata check failed:", e);
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
        console.warn("❌ Swap simulation failed:", e.reason || e.message || e);
        return false;
    }
}


export async function isLiquiditySufficient(pairAddress: string): Promise<boolean> {
    const provider = new JsonRpcProvider(CONFIG.rpc[CONFIG.network]);
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
            console.warn(`💧 Not enough ETH liquidity: ${wethReserve.toString()} < 1 ETH`);
            return false;
        }

        return true;
    } catch (e) {
        console.warn("⚠️ Error checking liquidity:", e);
        return false;
    }
}

export async function isKnownBadToken(tokenAddress: string): Promise<boolean> {
    const provider = new JsonRpcProvider(CONFIG.rpc[CONFIG.network]);

    try {
        const code = await provider.getCode(tokenAddress);
        if (!code || code === "0x") {
            console.warn("⚠️ No contract found at token address.");
            return true;
        }

        // skip creator check for free-tier Alchemy
        if (BLOCKLIST.tokens.has(tokenAddress.toLowerCase())) {
            console.warn("🚫 Token is in blocklist.");
            return true;
        }

        return false;
    } catch (e) {
        console.warn("⚠️ Blocklist check failed:", e);
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

        console.log(`🔎 Estimated tax: ${(taxPercent * 100).toFixed(2)}%`);

        return taxPercent > 0.25; // adjust this threshold as needed
    } catch (e) {
        console.warn("⚠️ Tax detection failed:", e);
        return true; // default to blocking
    }
}

export async function hasMaxWalletOrTxLimits(
    tokenAddress: string,
    provider: JsonRpcProvider,
    walletAddress: string
): Promise<boolean> {
    const ABI = [
        "function totalSupply() view returns (uint256)",
        "function maxWalletAmount() view returns (uint256)",
        "function maxWallet() view returns (uint256)",
        "function maxTxAmount() view returns (uint256)",
        "function maxTransactionAmount() view returns (uint256)"
    ];

    const token = new Contract(tokenAddress, ABI, provider);

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

                console.log(`🔍 ${fn}: ${(percent * 100).toFixed(2)}% of total supply`);

                if (percent < 0.01) {
                    console.warn(`⚠️ ${fn} is less than 1% — possible anti-bot limit`);
                    return true;
                }
            } catch {
                // Method not found — silently continue
            }
        }

        return false;
    } catch (e) {
        console.warn("⚠️ Max wallet/tx check failed:", e);
        return true; // safest fallback
    }
}

export async function simulateSell(
    tokenAddress: string,
    wallet: Wallet
): Promise<boolean> {
    try {
        const erc20 = new Contract(tokenAddress, [
            "function approve(address spender, uint amount) public returns (bool)",
            "function balanceOf(address) view returns (uint)"
        ], wallet);

        const balance = await erc20.balanceOf(wallet.address);
        await erc20.approve(CONFIG.routerAddress, balance);

        const router = new Contract(CONFIG.routerAddress, ROUTER_ABI, wallet);
        const path = [tokenAddress, CONFIG.wethAddress];
        const deadline = Math.floor(Date.now() / 1000) + 60;

        console.log("🧪 Simulating sell...");
        console.log("Path:", path);
        console.log("Balance:", balance.toString());
        console.log("Deadline:", deadline); // Can remove all this later



        await router.swapExactTokensForETHSupportingFeeOnTransferTokens.staticCall(
            balance,
            0,
            path,
            wallet.address,
            deadline
        );

        return true;
    } catch (e) {
        console.warn("❌ Sell simulation failed:", e);
        return false;
    }
}
