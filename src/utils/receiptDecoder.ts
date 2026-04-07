// src/utils/receiptDecoder.ts
// Decodes sell transaction receipts to extract ETH/BNB received, gas cost, and block number.
// Used by exitEngine.ts after sendTxWithRetry returns a tx hash.
//
// Scope: current sell builders only -- V2 swapExactTokensForETH (emits WETH Withdrawal)
// and V3 exactInputSingle with recipient=wallet (emits WETH Transfer to wallet).
// Multi-hop, custom routers, and exotic sell paths are out of scope.
//
// Per D-01: parses WETH Withdrawal (V2) and Transfer-to-wallet (V3) events.
// Per D-02: returns null amountOut with a warning if no matching event found.
// Per D-03: computes gasCost as receipt.gasUsed * receipt.gasPrice.
// Per D-05: retries once after 2s if receipt is null.
// Per D-06: extracts receipt.blockNumber.

import { Interface } from 'ethers';
import type { JsonRpcProvider, TransactionReceipt } from 'ethers';
import { WETH_ABI } from './abis';
import { logger } from './logger';

const log = logger.child({ module: 'receiptDecoder' });

const wethIface = new Interface(WETH_ABI);

/**
 * Decoded receipt data written to the trades table.
 * Any field may be null:
 *   - amountOut: null when no recognized WETH event is present (D-02) or receipt unavailable
 *   - gasCost:   null when receipt.gasPrice is missing (defensive) or receipt unavailable
 *   - blockNumber: null only when receipt is unavailable
 */
export interface ReceiptData {
    amountOut: string | null;    // ETH/BNB received as bigint string
    gasCost: string | null;      // gasUsed * gasPrice as bigint string; null if gasPrice missing
    blockNumber: number | null;
}

export async function decodeReceipt(
    txHash: string,
    provider: JsonRpcProvider,
    wethAddress: string,
    walletAddress: string,
): Promise<ReceiptData> {
    // D-05: fetch receipt with one retry after 2s
    let receipt: TransactionReceipt | null = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
        await new Promise(r => setTimeout(r, 2000));
        receipt = await provider.getTransactionReceipt(txHash);
    }
    if (!receipt) {
        log.warn({ txHash }, 'Receipt not available after retry, recording nulls');
        return { amountOut: null, gasCost: null, blockNumber: null };
    }

    // D-03: gas cost = gasUsed * gasPrice (receipt.gasPrice IS effectiveGasPrice in ethers v6).
    // Defensive: some chains/forks may return null gasPrice -- record null instead of throwing
    // or computing a wrong value.
    let gasCost: string | null;
    if (receipt.gasPrice == null) {
        log.warn({ txHash, gasUsed: receipt.gasUsed?.toString() }, 'receipt.gasPrice is null/undefined, recording gasCost as null');
        gasCost = null;
    } else {
        gasCost = (receipt.gasUsed * receipt.gasPrice).toString();
    }

    const blockNumber = receipt.blockNumber;

    // D-01: scan logs for WETH events, filtered by wethAddress
    // (T-14-01: only trust logs emitted by the known WETH contract).
    const wethLower = wethAddress.toLowerCase();
    const walletLower = walletAddress.toLowerCase();

    // Strategy 1: WETH Withdrawal (V2 path -- router unwraps WETH to native ETH).
    // First-match wins -- single-hop sells produce exactly one Withdrawal.
    for (const logEntry of receipt.logs) {
        if (logEntry.address.toLowerCase() !== wethLower) continue;
        try {
            const parsed = wethIface.parseLog({
                topics: logEntry.topics as string[],
                data: logEntry.data,
            });
            if (parsed && parsed.name === 'Withdrawal') {
                log.info({ txHash, blockNumber, amountOut: parsed.args.wad.toString() }, 'Decoded WETH Withdrawal (V2)');
                return { amountOut: parsed.args.wad.toString(), gasCost, blockNumber };
            }
        } catch { /* malformed log at WETH address -- fall through */ }
    }

    // Strategy 2: WETH Transfer to wallet (V3 path -- WETH sent directly without unwrap).
    // First-match wins for multiple Transfer(to=wallet) -- single-hop sells produce exactly one.
    for (const logEntry of receipt.logs) {
        if (logEntry.address.toLowerCase() !== wethLower) continue;
        try {
            const parsed = wethIface.parseLog({
                topics: logEntry.topics as string[],
                data: logEntry.data,
            });
            if (parsed && parsed.name === 'Transfer' && parsed.args.to.toLowerCase() === walletLower) {
                log.info({ txHash, blockNumber, amountOut: parsed.args.value.toString() }, 'Decoded WETH Transfer (V3)');
                return { amountOut: parsed.args.value.toString(), gasCost, blockNumber };
            }
        } catch { /* malformed log at WETH address -- fall through */ }
    }

    // D-02: No matching event found.
    // Enriched with logCount to distinguish misconfigured WETH address from an empty receipt.
    log.warn(
        { txHash, blockNumber, logCount: receipt.logs.length },
        'No WETH Withdrawal or Transfer event found in receipt',
    );
    return { amountOut: null, gasCost, blockNumber };
}
