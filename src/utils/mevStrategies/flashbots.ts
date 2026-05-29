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
import { JsonRpcProvider, Wallet, TransactionRequest, FetchRequest, id } from 'ethers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import type { MevStrategy, BroadcastHandle } from './types';
import { applyGasMultiplier } from './types';
import {
  submitWithReconciliation,
  buildReconcileConfig,
  type AttemptContext,
  type SubmitResult,
} from './reconciliation';
import { logger } from '../logger';

const log = logger.child({ module: 'mev-flashbots' });

/** Default builder name-tags for the raw `eth_sendBundle` `builders` fanout
 *  (D-PRIVATE-INCLUSION-HARDEN mech 1). Byte-matches the MEV_BUILDERS default
 *  registered in config.ts / .env.example. Casing matters (`Titan`,
 *  `beaverbuild.org`, lowercase `flashbots`). This is PRIVATE builder-to-builder
 *  routing, NOT public-mempool exposure (research Pitfall 3). */
const DEFAULT_MEV_BUILDERS =
  'flashbots,f1b.io,rsync,beaverbuild.org,builder0x69,Titan,EigenPhi,Gambit Labs,payload,Loki,JetBuilder,tbuilder,bobthebuilder,BTCS,bloXroute,Blockbeelder,Quasar,Eureka,Bombora';

/** Parse a comma-separated MEV_BUILDERS list: trim each, drop empties; fall back
 *  to the verified default registry when unset/empty so the fanout is never empty
 *  (D-PRIVATE-INCLUSION-HARDEN — a non-empty `builders` array is the fix). */
function parseBuilders(raw: string | undefined): string[] {
  const source = raw === undefined || raw.trim() === '' ? DEFAULT_MEV_BUILDERS : raw;
  const builders = source
    .split(',')
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  // Defensive: an entirely-malformed override (e.g. all commas) falls back to the default.
  return builders.length > 0 ? builders : DEFAULT_MEV_BUILDERS.split(',').map((b) => b.trim());
}

/** Never-NaN/never-negative positive-int parse, clamped to [min, max]. Used for
 *  MEV_BUY_TARGET_BLOCKS (default 3, clamp 1..8) so a malformed/over-broad value
 *  can never produce 0 targets or an unbounded fanout. */
function parsePositiveIntClamped(raw: string | undefined, fallback: number, min: number, max: number): number {
  let n = fallback;
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) n = parsed;
  }
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

/**
 * Multi-builder fanout via a RAW `eth_sendBundle` JSON-RPC call (research Pattern 1).
 *
 * LANDMINE (research §Q2 / Pitfall 1): the installed
 * `@flashbots/ethers-provider-bundle@1.0.0` SILENTLY DROPS the `builders` field
 * from `sendBundle`/`sendRawBundle`. So the multi-builder fix CANNOT go through the
 * library — it is this raw signed `eth_sendBundle` body carrying the `builders`
 * array, reusing the library's exact `X-Flashbots-Signature` scheme
 * (`address:signMessage(id(body))`, verified against the lib at index.js:793-797).
 *
 * This is still PRIVATE builder-to-builder routing — `builders` widens which
 * private builders receive the bundle, it does NOT broadcast to the public mempool
 * (D-BUY-INCLUSION-PRIVATE-FIRST + research Pitfall 3).
 *
 * @param signedTxs the bundle signed ONCE per attempt (Pitfall 2) — the SAME bytes
 *                  are reused across every target block to preserve the
 *                  deterministic reconcile hash.
 */
async function rawSendBundle(
  relayUrl: string,
  authSigner: Wallet,
  signedTxs: string[],
  targetBlock: number,
  builders: string[]
): Promise<{ bundleHash?: string; error?: { message: string; code: number } }> {
  const params = {
    txs: signedTxs,
    blockNumber: `0x${targetBlock.toString(16)}`,
    builders, // ← the field the library omits (eth_sendBundle v2 param)
  };
  const body = JSON.stringify({ method: 'eth_sendBundle', params: [params], id: 1, jsonrpc: '2.0' });
  const req = new FetchRequest(relayUrl);
  req.setHeader('Content-Type', 'application/json');
  // SAME auth scheme the library uses (index.js:796): address:signMessage(id(body)).
  req.setHeader(
    'X-Flashbots-Signature',
    `${await authSigner.getAddress()}:${await authSigner.signMessage(id(body))}`
  );
  req.body = body;
  const resp = await req.send();
  resp.assertOk();
  const json = resp.bodyJson as { result?: { bundleHash?: string }; error?: { message: string; code: number } };
  if (json?.error) return { error: json.error };
  return { bundleHash: json?.result?.bundleHash };
}

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
    gasMultiplier?: number,
    broadcast?: BroadcastHandle
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
    // CR-01: the live market priority rate (Phase 19 gasMultiplier-scaled) is the
    // COMPETITIVE FLOOR for the bid. It is folded into the desired fee BEFORE the
    // helper's affordability/ceiling clamp (the clamp is the final authority), so
    // the submit closure can use a.priorityFeeWei DIRECTLY — no second max() that
    // would re-introduce the unclamped chain rate and defeat the ceiling.
    const chainPriorityWei = (applyGasMultiplier(feeData.maxPriorityFeePerGas, gasMultiplier) ?? 0n) as bigint;

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
        // CR-01: a.priorityFeeWei is the helper's affordability/ceiling-clamped
        // fee, with the multiplier-scaled chain priority ALREADY folded in as the
        // competitive floor BEFORE the clamp (chainPriorityWei in feeInputs). It is
        // the FINAL authority on the submitted priority fee — use it DIRECTLY. We
        // must NOT take a second max() against the unclamped chain rate here: that
        // was the CR-01 bypass that let the buy bid above the 5-gwei ceiling and
        // consume the reserved sell gas (stranding the exit). maxFeePerGas is set
        // consistently to baseFee + the clamped priority (the same effective price
        // the affordability reserve models — also closes WR-03's modeling gap); it
        // is never max()'d against an unclamped chainMaxFee that would re-introduce
        // overspend. priority <= maxFee holds by construction (baseFee >= 0).
        populatedTx.maxPriorityFeePerGas = a.priorityFeeWei;
        populatedTx.maxFeePerGas = baseFeeWei + a.priorityFeeWei;
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
      //
      // Pitfall 2: signBundle is called ONCE per attempt — the SAME `signedBundle`
      // bytes are reused for the simulate, the raw multi-block fanout, AND the
      // library sendBundle. Re-signing per block would re-fetch the nonce and break
      // the deterministic reconcile hash. signedBundle is hoisted out of the
      // try so the multi-builder loop below can reuse the identical bytes.
      let signedBundle: string[];
      try {
        signedBundle = await flashbotsProvider.signBundle([
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

      // D-PRIVATE-INCLUSION-HARDEN mech 1 + 2: MULTI-BUILDER fanout via a RAW
      // eth_sendBundle (the library drops `builders` — Pitfall 1) + MULTI-BLOCK
      // targeting (the SAME signed bytes to block+1 .. block+MEV_BUY_TARGET_BLOCKS).
      // This widens private builder coverage so a calm-gas bundle is eligible in
      // each of N consecutive slots regardless of which builder wins. Still PRIVATE
      // builder-to-builder routing — never the public mempool (Pitfall 3).
      const builders = parseBuilders(process.env.MEV_BUILDERS);
      const targetBlocks = parsePositiveIntClamped(process.env.MEV_BUY_TARGET_BLOCKS, 3, 1, 8);
      for (let i = 0; i < targetBlocks; i++) {
        const tb = targetBlock + i; // targetBlock is already head+1
        const res = await rawSendBundle(this.relayUrl, authSigner, signedBundle, tb, builders);
        if (res.error) {
          throw new Error(`Flashbots eth_sendBundle error (block ${tb}): ${res.error.message}`);
        }
      }

      // The library sendBundle on block+1 is KEPT as the native-confirm signal +
      // the deterministic real-hash / nonce source (bundle.wait + bundleHash +
      // bundleTransactions). The raw fanout above is the actual multi-builder
      // submit; this single library call does NOT carry `builders` (it can't), it
      // only obtains the FlashbotsTransactionResponse the reconcile machinery needs.
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

      // D-PRIVATE-INCLUSION-HARDEN mech (telemetry) + STOP-THE-LINE-05-D /
      // D-EVIDENCE-BUY-INCLUSION: per-builder inclusion telemetry. Always query
      // getBundleStatsV2 (RESEARCH OQ#2 "always log stats") to PROVE the root cause
      // and confirm multi-builder inclusion live:
      //   consideredByBuildersAt empty (or only BuilderNet) while the winning block
      //     came from beaverbuild/Titan → "never seen by the winner" = builder coverage.
      //   consideredByBuildersAt populated but sealedByBuildersAt empty → "seen, not
      //     sealed" = pricing/timing.
      // T-21.3-01-03 (Information disclosure): log ONLY public, on-chain-resolvable
      // values (pubkeys + booleans) — NEVER the auth key or the signed raw tx
      // (mirrors the flashbots.bundle.included T-21-01-03 discipline above). Best-
      // effort: a stats-query failure must not fail the submit/reconcile path.
      if (bundle.bundleHash) {
        try {
          const stats = await flashbotsProvider.getBundleStatsV2(bundle.bundleHash, targetBlock);
          if (stats && !('error' in stats)) {
            log.info(
              {
                op: 'flashbots.bundle.stats',
                bundleHash: bundle.bundleHash,
                targetBlock,
                isSimulated: stats.isSimulated,
                isHighPriority: stats.isHighPriority,
                consideredByBuilders: stats.consideredByBuildersAt.map((p) => p.pubkey),
                sealedByBuilders: stats.sealedByBuildersAt.map((p) => p.pubkey),
              },
              'Per-builder bundle inclusion telemetry'
            );
          }
        } catch (statsErr) {
          log.warn(
            { op: 'flashbots.bundle.stats.error', bundleHash: bundle.bundleHash, targetBlock, err: statsErr },
            'getBundleStatsV2 query failed — telemetry only, submit/reconcile unaffected'
          );
        }
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
      { walletBalanceWei, baseFeeWei, snipeValueWei, buyGasLimit, chainPriorityWei },
      { info: log.info.bind(log), warn: log.warn.bind(log), error: log.error.bind(log) },
      undefined,
      // CR-02 (21.2-12): surface the ACTUALLY-BROADCAST hash + nonce to the caller.
      broadcast
    );
  }
}
