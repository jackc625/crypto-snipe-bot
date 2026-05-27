// src/utils/mevStrategies/passthrough.ts
// Passthrough MEV strategy for chains with natively private mempools.
// Base sequencer mempool is private; Arbitrum uses FCFS ordering.
// No external MEV service needed -- direct transaction submission.
//
// Phase 21.1 / STOP-THE-LINE-02 (D-SHARED-HELPER): now a THIN WRAPPER around the
// shared `submitWithReconciliation` helper. The old fetch-once-then-increment
// nonce loop and the `tx.wait(3)` timeout → `throw 'TX failed'` path are GONE — under RPC
// lag a buy/sell that actually landed could be reported failed (the LADYS class
// on Base/Arb) and the incrementing nonce permitted a double-spend. The helper
// owns nonce-safe retry + receipt/nonce reconciliation + bounded confirm-window +
// capped fee escalation; this wrapper only builds the per-attempt `submit`
// closure (simulate-before-submit + wallet.sendTransaction). The fork test
// (21.1-03) and fork rehearsal (21.1-06) exercise THIS strategy's reconciliation
// path (a local fork has no Flashbots relay). The `MevStrategy.sendTransaction`
// signature is UNCHANGED.
import { JsonRpcProvider, Wallet, TransactionRequest } from 'ethers';
import type { MevStrategy } from './types';
import { applyGasMultiplier } from './types';
import {
  submitWithReconciliation,
  buildReconcileConfig,
  type AttemptContext,
  type SubmitResult,
} from './reconciliation';
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
    maxRetries = 3,
    gasMultiplier?: number
  ): Promise<string> {
    const chainId = (await provider.getNetwork()).chainId;
    const feeData = await provider.getFeeData();

    // Buy gas limit; the sell leg reserves the same chain gas budget so the exit
    // can always submit (D-FEE-ESCALATION affordability bound).
    const buyGasLimit = (txRequest.gasLimit as bigint | undefined) ?? 500_000n;
    const sellGasLimit = buyGasLimit;

    // Affordability inputs constant across attempts (D-FEE-ESCALATION).
    const walletBalanceWei = await provider.getBalance(wallet.address);
    const snipeValueWei = (txRequest.value as bigint | undefined) ?? 0n;
    const baseFeeWei =
      feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null
        ? feeData.maxFeePerGas - feeData.maxPriorityFeePerGas
        : (feeData.gasPrice ?? 0n);

    const cfg = buildReconcileConfig(process.env, sellGasLimit, maxRetries);

    const submit = async (a: AttemptContext): Promise<SubmitResult> => {
      const populatedTx: TransactionRequest = {
        ...txRequest,
        gasLimit: txRequest.gasLimit || 500_000n,
        nonce: a.nonce, // helper-supplied re-fetched 'latest' (D-NONCE-SAFE-RETRY)
        chainId,
      };

      // Use EIP-1559 if available, fallback to legacy.
      // Phase 19 / D-RACE-TELEMETRY: optional gasMultiplier elevates the anti-rug
      // exit's gas to improve race odds against the rug-puller.
      if (feeData.maxFeePerGas) {
        // Phase 19 gasMultiplier scales the chain's fee data (anti-rug exit). The
        // priority BID is the greater of the multiplier-scaled chain priority and
        // the helper's escalated/affordability-clamped fee (D-FEE-ESCALATION); a
        // retry never drops the bid below the going rate.
        const chainPriority = applyGasMultiplier(feeData.maxPriorityFeePerGas, gasMultiplier) ?? 0n;
        const priorityBid = a.priorityFeeWei > chainPriority ? a.priorityFeeWei : chainPriority;
        // The maxFeePerGas CAP must cover baseFee + the (possibly escalated) priority
        // bid so maxPriorityFeePerGas never exceeds maxFeePerGas (invalid EIP-1559).
        const chainMaxFee = applyGasMultiplier(feeData.maxFeePerGas, gasMultiplier) ?? 0n;
        const requiredMaxFee = baseFeeWei + priorityBid;
        populatedTx.maxFeePerGas = chainMaxFee > requiredMaxFee ? chainMaxFee : requiredMaxFee;
        populatedTx.maxPriorityFeePerGas = priorityBid;
      } else {
        populatedTx.gasPrice = applyGasMultiplier(feeData.gasPrice, gasMultiplier) ?? undefined;
      }

      // D-SIMULATE-BEFORE-SUBMIT: simulate the exact populated tx before broadcast
      // so a reverting tx is never escalated-and-resubmitted. For an opaque
      // (already-encoded) TransactionRequest the v6 read-only equivalent of a
      // Contract `.staticCall` (mirror of bot.ts:659-667) is `provider.call(tx)` —
      // it executes the same calldata against current state and THROWS on revert.
      try {
        await provider.call({ ...populatedTx, from: wallet.address });
      } catch (simErr) {
        log.error(
          { op: 'passthrough.simulate.revert', attempt: a.attempt, err: simErr },
          'Pre-submit simulation (provider.call) reverted — not submitting a reverting tx'
        );
        throw simErr;
      }

      const tx = await wallet.sendTransaction(populatedTx);
      log.info({ txHash: tx.hash, attempt: a.attempt + 1 }, 'TX sent (passthrough)');

      // Native confirm: tx.wait(3) may TIME OUT / reject under RPC lag even though
      // the tx landed (the Base/Arb LADYS class). A thrown wait or a null/!=1
      // receipt yields nativeConfirmed:false so the helper reconciles against chain
      // state (receipt + nonce) rather than declaring failure. The deterministic
      // tx.hash is what the reconciler probes.
      let nativeConfirmed = false;
      try {
        const receipt = await tx.wait(3);
        if (receipt && receipt.status === 1) {
          log.info({ block: receipt.blockNumber, txHash: tx.hash }, 'TX confirmed');
          nativeConfirmed = true;
        }
      } catch (waitErr) {
        log.warn(
          { op: 'passthrough.wait.timeout', attempt: a.attempt, txHash: tx.hash, err: waitErr },
          'tx.wait timed out / rejected — deferring to chain-state reconciliation (not a failure)'
        );
      }

      return { signedTxHash: tx.hash, submittedNonce: a.nonce, nativeConfirmed };
    };

    return submitWithReconciliation(
      submit,
      wallet,
      provider,
      cfg,
      { walletBalanceWei, baseFeeWei, snipeValueWei, buyGasLimit },
      { info: log.info.bind(log), warn: log.warn.bind(log), error: log.error.bind(log) }
    );
  }
}
