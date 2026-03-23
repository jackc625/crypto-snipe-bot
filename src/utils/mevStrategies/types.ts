// src/utils/mevStrategies/types.ts
// MEV strategy interface -- each chain's MEV protection implements this contract.
// Flashbots (ETH), bloXroute (BSC), passthrough (Base/Arbitrum).
import type { TransactionRequest, JsonRpcProvider, Wallet } from 'ethers';

export interface MevStrategy {
  readonly name: string;

  /**
   * Verify that the MEV service is reachable and authenticated.
   * Per D-07: health checks run before snipe attempts.
   * Returns true if service is available, false otherwise.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Submit a transaction through the chain's MEV protection mechanism.
   * Per D-06: if MEV submission fails after all retries, the error propagates
   * (caller must reject the snipe entirely).
   *
   * @returns Transaction hash or bundle identifier string
   */
  sendTransaction(
    txRequest: TransactionRequest,
    wallet: Wallet,
    provider: JsonRpcProvider,
    maxRetries?: number
  ): Promise<string>;
}
