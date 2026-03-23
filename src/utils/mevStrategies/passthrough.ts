// src/utils/mevStrategies/passthrough.ts
// Passthrough MEV strategy for chains with natively private mempools.
// Base sequencer mempool is private; Arbitrum uses FCFS ordering.
// No external MEV service needed -- direct transaction submission.
import { JsonRpcProvider, Wallet, TransactionRequest } from 'ethers';
import type { MevStrategy } from './types';
import { logger } from '../logger';

const log = logger.child({ module: 'mev-passthrough' });

export class PassthroughMevStrategy implements MevStrategy {
  readonly name: string;

  constructor(chainName: string) {
    this.name = `passthrough-${chainName}`;
  }

  async healthCheck(): Promise<boolean> {
    // Passthrough chains (Base, Arbitrum) have natively private mempools.
    // No external MEV service to check -- always healthy.
    log.info({ strategy: this.name }, 'Passthrough MEV: always healthy (native private mempool)');
    return true;
  }

  async sendTransaction(
    txRequest: TransactionRequest,
    wallet: Wallet,
    provider: JsonRpcProvider,
    maxRetries = 3
  ): Promise<string> {
    const baseNonce = await provider.getTransactionCount(wallet.address, 'latest');

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const feeData = await provider.getFeeData();
        const populatedTx: TransactionRequest = {
          ...txRequest,
          gasLimit: txRequest.gasLimit || 500_000n,
          nonce: baseNonce + attempt,
          chainId: (await provider.getNetwork()).chainId,
        };

        // Use EIP-1559 if available, fallback to legacy
        if (feeData.maxFeePerGas) {
          populatedTx.maxFeePerGas = feeData.maxFeePerGas;
          populatedTx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        } else {
          populatedTx.gasPrice = feeData.gasPrice;
        }

        const tx = await wallet.sendTransaction(populatedTx);
        log.info({ txHash: tx.hash, attempt: attempt + 1 }, 'TX sent (passthrough)');

        const receipt = await tx.wait(3);
        if (receipt && receipt.status === 1) {
          log.info({ block: receipt.blockNumber, txHash: tx.hash }, 'TX confirmed');
          return tx.hash;
        }
        throw new Error('TX failed or receipt is null');
      } catch (err) {
        log.warn({ attempt: attempt + 1, maxRetries, err }, 'Passthrough TX retry');
        if (attempt >= maxRetries) throw err;
      }
    }
    throw new Error('Passthrough max retries reached');
  }
}
