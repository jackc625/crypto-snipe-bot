// src/utils/mevStrategies/bloxroute.ts
// bloXroute MEV strategy for BSC -- submits private transactions via
// bsc_private_tx JSON-RPC method to avoid frontrunning on BSC mempool.
import { JsonRpcProvider, Wallet, TransactionRequest } from 'ethers';
import axios from 'axios';
import type { MevStrategy } from './types';
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
    maxRetries = 3
  ): Promise<string> {
    const baseNonce = await provider.getTransactionCount(wallet.address, 'latest');

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const gasPrice = (await provider.getFeeData()).gasPrice;
        const populatedTx: TransactionRequest = {
          ...txRequest,
          gasLimit: txRequest.gasLimit || 500_000n,
          gasPrice,
          nonce: baseNonce + attempt,
          chainId: 56n,
        };

        const signedTx = await wallet.signTransaction(populatedTx);

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
          throw new Error(`bloXroute error: ${data.error.message}`);
        }

        log.info({ txHash: data.result, attempt: attempt + 1 }, 'BSC private tx submitted via bloXroute');
        return data.result;
      } catch (err) {
        log.warn({ attempt: attempt + 1, maxRetries, err }, 'bloXroute retry');
        if (attempt >= maxRetries) throw err;
      }
    }
    throw new Error('bloXroute max retries reached');
  }
}
