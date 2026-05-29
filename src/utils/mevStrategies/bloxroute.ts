// src/utils/mevStrategies/bloxroute.ts
// bloXroute MEV strategy for BSC -- submits private transactions via
// bsc_private_tx JSON-RPC method to avoid frontrunning on BSC mempool.
//
// Phase 21.1 / STOP-THE-LINE-02 (D-SHARED-HELPER): now a THIN WRAPPER around the
// shared `submitWithReconciliation` helper. The old fetch-once-then-increment
// nonce loop is GONE, and — critically — the relay's ACK is no longer treated as
// inclusion proof. Previously the strategy returned the relay-supplied hash
// WITHOUT confirming the tx landed; an axios timeout AFTER the relay accepted the
// tx threw → the retry loop resubmitted at an incremented nonce → a possible
// SECOND real buy (double-spend / untracked funds on BSC). The wrapper now ALWAYS
// returns nativeConfirmed:false so every submit is reconciled against chain state
// (receipt + on-chain nonce), closing the relay-accept-then-timeout double-spend
// gap. The reconciler probes the DETERMINISTIC locally-signed tx hash. The
// `MevStrategy.sendTransaction` signature is UNCHANGED.
import { JsonRpcProvider, Wallet, TransactionRequest, keccak256 } from 'ethers';
import axios from 'axios';
import type { MevStrategy, BroadcastHandle } from './types';
import { applyGasMultiplier } from './types';
import {
  submitWithReconciliation,
  buildReconcileConfig,
  type AttemptContext,
  type SubmitResult,
} from './reconciliation';
import { logger } from '../logger';

const log = logger.child({ module: 'mev-bloxroute' });

export class BloxrouteMevStrategy implements MevStrategy {
  readonly name = 'bloxroute-bsc';
  private endpoint: string;
  private authHeader: string;

  constructor(mevConfig: Record<string, string>) {
    this.endpoint = mevConfig.endpoint || 'https://api.blxrbdn.com';
    // Auth header from mevConfig (populated by chainRegistry from env) or direct env fallback
    this.authHeader = mevConfig.authHeader || process.env.BLOXROUTE_AUTH_HEADER!;
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.authHeader) {
        log.error('bloXroute health check failed: no auth header');
        return false;
      }
      // Ping bloXroute with a benign JSON-RPC call
      const { data } = await axios.post(this.endpoint, {
        jsonrpc: '2.0', id: 1,
        method: 'ping',
        params: {}
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.authHeader
        },
        timeout: 5000
      });
      // Auth failures indicate the service is reachable but credentials are bad
      if (data.error && (data.error.code === 401 || data.error.code === 403)) {
        log.error({ error: data.error }, 'bloXroute auth failure');
        return false;
      }
      log.info('bloXroute health check passed');
      return true;
    } catch (err) {
      log.error({ err }, 'bloXroute health check failed');
      return false;
    }
  }

  async sendTransaction(
    txRequest: TransactionRequest,
    wallet: Wallet,
    provider: JsonRpcProvider,
    maxRetries = 3,
    gasMultiplier?: number,
    broadcast?: BroadcastHandle
  ): Promise<string> {
    const feeData = await provider.getFeeData();

    // Buy gas limit; the sell leg reserves the same chain gas budget so the exit
    // can always submit (D-FEE-ESCALATION affordability bound).
    const buyGasLimit = (txRequest.gasLimit as bigint | undefined) ?? 500_000n;
    const sellGasLimit = buyGasLimit;

    // Affordability inputs constant across attempts (D-FEE-ESCALATION). BSC is
    // legacy-only, so the per-gas "base" cost is gasPrice; the helper's escalation
    // step is added on top as the priority bump.
    const walletBalanceWei = await provider.getBalance(wallet.address);
    const snipeValueWei = (txRequest.value as bigint | undefined) ?? 0n;
    const baseFeeWei = feeData.gasPrice ?? 0n;
    // CR-01: BSC has no EIP-1559 priority field; the competitive floor is the
    // Phase 19 gasMultiplier-scaled gasPrice ABOVE base (scaledGasPrice - baseFee,
    // clamped >= 0). Fold it into the desired fee BEFORE the helper's
    // affordability/ceiling clamp so the submit closure sets gasPrice = baseFee +
    // a.priorityFeeWei DIRECTLY — NO second max() against the unclamped scaled
    // gasPrice (that was the CR-01 bypass for the legacy path: it let the buy
    // exceed the ceiling and consume the reserved sell gas).
    const scaledChainGasPrice = (applyGasMultiplier(feeData.gasPrice, gasMultiplier) ?? 0n) as bigint;
    const legacyFloor = scaledChainGasPrice - baseFeeWei;
    const chainPriorityWei = legacyFloor > 0n ? legacyFloor : 0n;

    const cfg = buildReconcileConfig(process.env, sellGasLimit, maxRetries);

    const submit = async (a: AttemptContext): Promise<SubmitResult> => {
      // CR-01: clamp-is-final on the legacy gasPrice path. a.priorityFeeWei is the
      // helper's affordability/ceiling-clamped fee, with the multiplier-scaled
      // chain gasPrice ALREADY folded in as the competitive floor BEFORE the clamp
      // (chainPriorityWei = scaledGasPrice - baseFee). The submitted gasPrice is
      // baseFee + the clamped priority DIRECTLY — NO second max() against the
      // unclamped scaled gasPrice (the CR-01 bypass that defeated the ceiling and
      // the reserved sell gas on BSC). If the going rate genuinely cannot be
      // afforded under the sell reserve, the helper rejects cleanly (Pitfall 7).
      const gasPrice = baseFeeWei + a.priorityFeeWei;

      const populatedTx: TransactionRequest = {
        ...txRequest,
        gasLimit: txRequest.gasLimit || 500_000n,
        gasPrice,
        nonce: a.nonce, // helper-supplied re-fetched 'latest' (D-NONCE-SAFE-RETRY)
        chainId: 56n,
      };

      // Sign locally to obtain BOTH the raw signed tx (for the relay) and the
      // DETERMINISTIC tx hash the reconciler probes via getTransactionReceipt. The
      // relay's returned hash is NOT trusted for inclusion — we compute our own.
      const signedTx = await wallet.signTransaction(populatedTx);
      const signedTxHash = keccak256(signedTx);

      // D-SIMULATE-BEFORE-SUBMIT: simulate the exact populated tx before relaying
      // so a reverting tx is never escalated-and-resubmitted. For an opaque
      // (already-encoded) TransactionRequest the v6 read-only equivalent of a
      // Contract `.staticCall` (mirror of bot.ts:659-667) is `provider.call(tx)` —
      // it executes the same calldata against current state and THROWS on revert.
      try {
        await provider.call({ ...populatedTx, from: wallet.address });
      } catch (simErr) {
        log.error(
          { op: 'bloxroute.simulate.revert', attempt: a.attempt, err: simErr },
          'Pre-submit simulation (provider.call) reverted — not relaying a reverting tx'
        );
        throw simErr;
      }

      // Relay the signed tx. A relay timeout is the load-bearing hazard: it may
      // fire AFTER the relay accepted (and broadcast) the tx, so it is NOT proof
      // the tx failed. The old code threw on it → the retry loop resubmitted at an
      // incremented nonce → a possible SECOND real buy. Instead we DEFER to
      // chain-state reconciliation: we already hold the deterministic signed-tx
      // hash, so a timeout-but-landed tx is reconciled (real hash returned) and a
      // genuinely-dropped tx reconciles as not-landed (the helper escalates and
      // re-signs at the SAME re-fetched nonce — a replacement, never base+attempt).
      // This closes the relay-accept-then-timeout double-spend on BSC.
      try {
        const { data } = await axios.post(this.endpoint, {
          jsonrpc: '2.0', id: 1,
          method: 'bsc_private_tx',
          params: { transaction: signedTx }
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.authHeader
          },
          timeout: 10000
        });

        if (data.error) {
          // A relay-level rejection (e.g. bad auth) is NOT a "tx may have landed"
          // signal — the relay refused it outright. Surface it so the caller fails
          // loudly rather than spuriously reconciling a tx that was never sent.
          throw new Error(`bloXroute error: ${data.error.message}`);
        }

        log.info(
          { op: 'bloxroute.relay.accepted', relayHash: data.result, signedTxHash, attempt: a.attempt + 1 },
          'BSC private tx accepted by bloXroute relay (NOT yet confirmed included)'
        );
      } catch (relayErr) {
        // Distinguish an explicit relay REJECTION (we threw it above) from a
        // transport-level failure (timeout / network). A rejection propagates; a
        // transport failure defers to reconciliation (the tx may have landed).
        if (relayErr instanceof Error && relayErr.message.startsWith('bloXroute error:')) {
          throw relayErr;
        }
        log.warn(
          { op: 'bloxroute.relay.timeout', signedTxHash, attempt: a.attempt, err: relayErr },
          'bloXroute relay call failed (timeout/network) — deferring to chain-state reconciliation (NOT a failure, NOT a resubmit)'
        );
      }

      // nativeConfirmed:false ALWAYS — relay-accept is not inclusion proof, so the
      // helper ALWAYS reconciles against chain state (the gap this closes).
      return { signedTxHash, submittedNonce: a.nonce, nativeConfirmed: false };
    };

    return submitWithReconciliation(
      submit,
      wallet,
      provider,
      cfg,
      { walletBalanceWei, baseFeeWei, snipeValueWei, buyGasLimit, chainPriorityWei },
      { info: log.info.bind(log), warn: log.warn.bind(log), error: log.error.bind(log) },
      undefined,
      // CR-02 (21.2-12): surface the ACTUALLY-BROADCAST hash + nonce to the caller.
      broadcast
    );
  }
}
