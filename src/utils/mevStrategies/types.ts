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
   * `gasMultiplier` (optional): multiplier applied to EIP-1559 maxFeePerGas +
   * maxPriorityFeePerGas, or legacy gasPrice, on the populated tx. Defaults to
   * 1.0 (no elevation). Phase 19 / D-RACE-TELEMETRY uses this to elevate the
   * anti-rug exit's gas relative to the chain's standard rate when the buyer
   * is racing a rug-puller's tx in the same block.
   *
   * @returns Transaction hash or bundle identifier string
   */
  sendTransaction(
    txRequest: TransactionRequest,
    wallet: Wallet,
    provider: JsonRpcProvider,
    maxRetries?: number,
    gasMultiplier?: number
  ): Promise<string>;
}

/**
 * Apply a gas multiplier to a bigint fee value. Returns the original value
 * when multiplier is undefined or 1.0 (preserves existing behavior for
 * pre-Phase-19 callers). Uses *100/100n math to support fractional
 * multipliers (e.g. 2.0, 1.5) without floating-point drift.
 */
export function applyGasMultiplier(fee: bigint | null | undefined, gasMultiplier: number | undefined): bigint | null | undefined {
  if (fee === null || fee === undefined) return fee;
  if (gasMultiplier === undefined || gasMultiplier === 1) return fee;
  return fee * BigInt(Math.round(gasMultiplier * 100)) / 100n;
}
