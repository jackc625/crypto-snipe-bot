// src/utils/mevStrategies/flashbots.ts
// Flashbots MEV strategy for Ethereum -- extracts existing bundle submission logic
// into the MevStrategy interface. Uses FlashbotsBundleProvider for relay communication.
//
// Phase 21.1 / STOP-THE-LINE-02 (D-SHARED-HELPER): this strategy is now a THIN
// WRAPPER around the shared `submitWithReconciliation` helper
// (src/utils/mevStrategies/reconciliation.ts). The old fetch-once-then-increment
// nonce retry loop and the `bundle.wait()===0`-only success / `throw "Bundle not
// included"` failure paths are GONE — they reported a buy/sell that actually
// LANDED on-chain as a failure (the live LADYS harm) and the incrementing nonce
// permitted a double-spend. The helper owns nonce-safe retry, receipt+nonce
// inclusion reconciliation, the bounded confirm-window, and capped
// fee-escalation. This wrapper only builds the per-attempt `submit` closure
// (simulate-before-submit + sendBundle) and supplies it. The
// `MevStrategy.sendTransaction` signature is UNCHANGED — the helper is an
// implementation detail behind it.
import { JsonRpcProvider, Wallet, TransactionRequest } from 'ethers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import type { MevStrategy } from './types';
import { applyGasMultiplier } from './types';
import {
  submitWithReconciliation,
  buildReconcileConfig,
  type AttemptContext,
  type SubmitResult,
} from './reconciliation';
import { logger } from '../logger';

const log = logger.child({ module: 'mev-flashbots' });

export class FlashbotsMevStrategy implements MevStrategy {
  readonly name = 'flashbots';
  private relayUrl: string;
  private network: string;
  private authKey: string;

  constructor(mevConfig: Record<string, string>) {
    this.relayUrl = mevConfig.relayUrl || 'https://relay.flashbots.net';
    this.network = mevConfig.network || 'mainnet';
    // Auth key from mevConfig (populated by chainRegistry from env) or direct env fallback
    this.authKey = mevConfig.authKey || process.env.FLASHBOTS_AUTH_KEY!;
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Verify auth key is present and valid format (private key hex)
      if (!this.authKey) {
        log.error('Flashbots health check failed: no auth key');
        return false;
      }
      const authSigner = new Wallet(this.authKey);
      log.info({ relay: this.relayUrl, authAddress: authSigner.address }, 'Flashbots health check passed');
      return true;
    } catch (err) {
      log.error({ err }, 'Flashbots health check failed');
      return false;
    }
  }

  async sendTransaction(
    txRequest: TransactionRequest,
    wallet: Wallet,
    provider: JsonRpcProvider,
    maxRetries = 3,
    gasMultiplier?: number
  ): Promise<string> {
    // FlashbotsBundleProvider setup lives OUTSIDE the retry loop (it is per-send,
    // not per-attempt) — the helper drives the per-attempt loop.
    const authSigner = new Wallet(this.authKey);
    const flashbotsProvider = await FlashbotsBundleProvider.create(
      provider, authSigner, this.relayUrl, this.network
    );
    const chainId = (await provider.getNetwork()).chainId;
    const feeData = await provider.getFeeData();

    // Buy gas limit for this tx; the sell leg reserves the same chain gas budget
    // (ctx.chain.gas.maxGasLimit equivalent — 300_000n on ETH) so the exit can
    // always submit (D-FEE-ESCALATION affordability bound).
    const buyGasLimit = (txRequest.gasLimit as bigint | undefined) ?? 300_000n;
    const sellGasLimit = buyGasLimit;

    // Affordability inputs that are CONSTANT across attempts (D-FEE-ESCALATION).
    const walletBalanceWei = await provider.getBalance(wallet.address);
    const snipeValueWei = (txRequest.value as bigint | undefined) ?? 0n;
    // baseFee: EIP-1559 base = maxFeePerGas - maxPriorityFeePerGas; fall back to
    // gasPrice (legacy) or 0n. ETH is EIP-1559 so the first branch is normal.
    const baseFeeWei =
      feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null
        ? feeData.maxFeePerGas - feeData.maxPriorityFeePerGas
        : (feeData.gasPrice ?? 0n);

    // ReconcileConfig from the 5 MEV env vars (generous defaults from 21.1-02) +
    // the per-chain sell gas limit + the strategy's retry budget.
    const cfg = buildReconcileConfig(process.env, sellGasLimit, maxRetries);

    // The per-attempt submit closure: simulate-before-submit, then sendBundle at
    // the helper-supplied nonce + escalated/clamped priority fee. It MUST NOT
    // itself retry — the helper owns the loop.
    const submit = async (a: AttemptContext): Promise<SubmitResult> => {
      // CR-02: ETH chain template declares `gas: { type: 'eip1559', ... }`, so the
      // multiplier MUST flow into maxFeePerGas / maxPriorityFeePerGas — applying it
      // only to legacy `gasPrice` silently fails to outbid on EIP-1559 chains.
      const populatedTx: TransactionRequest = {
        ...txRequest,
        gasLimit: txRequest.gasLimit || 300_000n,
        nonce: a.nonce, // helper-supplied re-fetched 'latest' (D-NONCE-SAFE-RETRY)
        chainId,
      };

      if (feeData.maxFeePerGas) {
        // Phase 19 gasMultiplier scales the chain's fee data (anti-rug exit). The
        // priority BID is the greater of the multiplier-scaled chain priority and
        // the helper's escalated/affordability-clamped fee, so a retry never DROPS
        // the bid below the going rate and the per-retry escalation is honored
        // (D-FEE-ESCALATION).
        const chainPriority = applyGasMultiplier(feeData.maxPriorityFeePerGas, gasMultiplier) ?? 0n;
        const priorityBid = a.priorityFeeWei > chainPriority ? a.priorityFeeWei : chainPriority;
        // The maxFeePerGas CAP must always cover baseFee + the (possibly escalated)
        // priority bid — otherwise maxPriorityFeePerGas > maxFeePerGas is an invalid
        // EIP-1559 tx. Take the greater of the multiplier-scaled chain cap and
        // (baseFee + priorityBid).
        const chainMaxFee = applyGasMultiplier(feeData.maxFeePerGas, gasMultiplier) ?? 0n;
        const requiredMaxFee = baseFeeWei + priorityBid;
        populatedTx.maxFeePerGas = chainMaxFee > requiredMaxFee ? chainMaxFee : requiredMaxFee;
        populatedTx.maxPriorityFeePerGas = priorityBid;
        populatedTx.type = 2;
      } else {
        populatedTx.gasPrice =
          applyGasMultiplier(feeData.gasPrice, gasMultiplier) ?? undefined;
      }

      const targetBlock = (await provider.getBlockNumber()) + 1;

      // D-SIMULATE-BEFORE-SUBMIT: simulate the bundle before submitting so a
      // reverting tx is never escalated-and-resubmitted. flashbotsProvider.simulate
      // (eth_callBundle) is the relay-level simulate; a revert here signals failure
      // so the helper fails cleanly rather than broadcasting a doomed tx.
      try {
        const signedBundle = await flashbotsProvider.signBundle([
          { signer: wallet, transaction: populatedTx },
        ]);
        const sim = await flashbotsProvider.simulate(signedBundle, targetBlock);
        if ('error' in sim) {
          // RelayResponseError — the relay refused to simulate the bundle.
          throw new Error(`Flashbots simulate rejected: ${sim.error.message}`);
        }
        // SimulationResponseSuccess: firstRevert is set if ANY tx in the bundle
        // reverted; a per-tx TransactionSimulationRevert carries error/revert.
        if (sim.firstRevert && 'error' in sim.firstRevert) {
          throw new Error(`Flashbots simulate: tx would revert (${sim.firstRevert.error || sim.firstRevert.revert})`);
        }
      } catch (simErr) {
        log.error(
          { op: 'flashbots.simulate.revert', attempt: a.attempt, err: simErr },
          'Pre-submit bundle simulation failed — not submitting a reverting tx'
        );
        throw simErr;
      }

      const bundle = await flashbotsProvider.sendBundle(
        [{ signer: wallet, transaction: populatedTx }],
        targetBlock
      );

      if ('error' in bundle) {
        throw new Error(`Flashbots error: ${bundle.error.message}`);
      }

      // Phase 14: the REAL signed-tx hash is deterministic regardless of inclusion;
      // the reconciler probes its receipt. Defensive guard throws loudly if the
      // library response shape is malformed (missing hash) rather than silently
      // casting undefined to string.
      const realHash = bundle.bundleTransactions?.[0]?.hash;
      if (!realHash) {
        throw new Error(`Flashbots bundle response missing bundleTransactions[0].hash for block ${targetBlock}`);
      }
      const submittedNonce = bundle.bundleTransactions[0].nonce ?? a.nonce;

      // bundle.wait() resolves a FlashbotsBundleResolution:
      //   0 = BundleIncluded         → natively confirmed.
      //   1 = BlockPassedWithoutInclusion → NOT proof of failure (the LADYS lie).
      //   2 = AccountNonceTooHigh    → a STRONG "already landed" signal (the nonce
      //       was already consumed). RESEARCH OQ3: treat as nativeConfirmed:false
      //       so the helper short-circuits straight to the receipt probe.
      const waitResponse = await bundle.wait();

      if (waitResponse === 0) {
        // EXIT-LIVE-04 capture mechanism: surface BOTH the bundle hash and the
        // mined tx hash from the same FlashbotsTransactionResponse so the live
        // capture can map bundleHash -> minedTxHash. T-21-01-03: log ONLY public,
        // on-chain-resolvable values (bundleHash, minedTxHash, block) — never the
        // signed raw tx or FLASHBOTS_AUTH_KEY.
        log.info(
          { op: 'flashbots.bundle.included', bundleHash: bundle.bundleHash, minedTxHash: realHash, block: targetBlock },
          'Flashbots bundle mapping'
        );
      }

      // nativeConfirmed ONLY on a true BundleIncluded(0). For 1 (block passed) and
      // 2 (nonce too high) we return false so the helper reconciles against chain
      // state instead of trusting the relay's (lying) verdict.
      return {
        signedTxHash: realHash,
        submittedNonce,
        nativeConfirmed: waitResponse === 0,
      };
    };

    // Bind the structured pino sink + (no-op until ctx-bound) alert to the helper;
    // the helper owns every reconciliation outcome's op:/alert (D-ALERTS).
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
