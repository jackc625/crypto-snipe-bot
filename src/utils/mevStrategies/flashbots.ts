// src/utils/mevStrategies/flashbots.ts
// Flashbots MEV strategy for Ethereum -- extracts existing bundle submission logic
// into the MevStrategy interface. Uses FlashbotsBundleProvider for relay communication.
import { JsonRpcProvider, Wallet, TransactionRequest } from 'ethers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import type { MevStrategy } from './types';
import { applyGasMultiplier } from './types';
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
    const authSigner = new Wallet(this.authKey);
    const flashbotsProvider = await FlashbotsBundleProvider.create(
      provider, authSigner, this.relayUrl, this.network
    );
    const baseNonce = await provider.getTransactionCount(wallet.address, 'latest');

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Phase 19 / D-RACE-TELEMETRY: optional gasMultiplier elevates anti-rug exit gas.
        // CR-02: ETH chain template declares `gas: { type: 'eip1559', ... }`, so the
        // multiplier MUST flow into maxFeePerGas / maxPriorityFeePerGas — applying
        // it only to legacy `gasPrice` silently fails to outbid on EIP-1559 chains.
        // Mirror the passthrough strategy's EIP-1559-aware branching.
        const feeData = await provider.getFeeData();
        const populatedTx: TransactionRequest = {
          ...txRequest,
          gasLimit: txRequest.gasLimit || 300_000n,
          nonce: baseNonce + attempt,
          chainId: (await provider.getNetwork()).chainId,
        };

        if (feeData.maxFeePerGas) {
          populatedTx.maxFeePerGas =
            applyGasMultiplier(feeData.maxFeePerGas, gasMultiplier) ?? undefined;
          populatedTx.maxPriorityFeePerGas =
            applyGasMultiplier(feeData.maxPriorityFeePerGas, gasMultiplier) ?? undefined;
          populatedTx.type = 2;
        } else {
          populatedTx.gasPrice =
            applyGasMultiplier(feeData.gasPrice, gasMultiplier) ?? undefined;
        }

        const targetBlock = (await provider.getBlockNumber()) + 1;
        const bundle = await flashbotsProvider.sendBundle(
          [{ signer: wallet, transaction: populatedTx }],
          targetBlock
        );

        if ('error' in bundle) {
          throw new Error(`Flashbots error: ${bundle.error.message}`);
        }

        const waitResponse = await bundle.wait();
        if (waitResponse === 0) {
          log.info({ block: targetBlock, attempt: attempt + 1 }, 'Flashbots bundle included');
          // Phase 14: return the REAL tx hash from the bundle response so receiptDecoder
          // can fetch the receipt downstream. Defensive guard throws loudly if the library
          // response shape is malformed (missing hash field) rather than silently casting
          // undefined to string.
          const realHash = bundle.bundleTransactions?.[0]?.hash;
          if (!realHash) {
            throw new Error(`Flashbots bundle response missing bundleTransactions[0].hash for block ${targetBlock}`);
          }
          // EXIT-LIVE-04 capture mechanism: surface BOTH the bundle hash and the
          // mined tx hash from the same FlashbotsTransactionResponse so the live
          // capture can map bundleHash -> minedTxHash. The paired
          // op:'exit.full.executed' line (exitEngine.ts) carries the mined hash on
          // the exit child logger; this strategy carries the bundleHash.
          // T-21-01-03: log ONLY public, on-chain-resolvable values (bundleHash,
          // minedTxHash, block) — never the signed raw tx or FLASHBOTS_AUTH_KEY.
          log.info(
            { op: 'flashbots.bundle.included', bundleHash: bundle.bundleHash, minedTxHash: realHash, block: targetBlock },
            'Flashbots bundle mapping'
          );
          return realHash;
        }
        throw new Error(`Bundle not included in block ${targetBlock}`);
      } catch (err) {
        log.warn({ attempt: attempt + 1, maxRetries, err }, 'Flashbots retry');
        if (attempt >= maxRetries) throw err;
      }
    }
    throw new Error('Flashbots max retries reached');
  }
}
