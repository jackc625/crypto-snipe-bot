import { JsonRpcProvider, Wallet } from "ethers";
import type { TransactionRequest } from "ethers";
import { getFlashbotsProvider } from "./flashbots";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";

export async function sendTxWithRetry(
    txBuilder: () => Promise<TransactionRequest>,
    provider: JsonRpcProvider,
    wallet: Wallet,
    useFlashbots = true,
    maxRetries = 3
): Promise<void> {
    const authSigner = new Wallet(process.env.FLASHBOTS_AUTH_KEY!);
    const flashbotsProvider: FlashbotsBundleProvider = await getFlashbotsProvider(provider, authSigner);
    const baseNonce = await provider.getTransactionCount(wallet.address, "latest");

    let retries = 0;

    while (retries <= maxRetries) {
        try {
            const txRequest = await txBuilder();
            const gasLimit = txRequest.gasLimit || 300_000n;
            const gasPrice = (await provider.getFeeData()).gasPrice;

            const populatedTx: TransactionRequest = {
                ...txRequest,
                gasLimit,
                gasPrice,
                nonce: baseNonce + retries,
                chainId: (await provider.getNetwork()).chainId,
            };

            if (useFlashbots) {
                const targetBlock = (await provider.getBlockNumber()) + 1;

                const bundle = await flashbotsProvider.sendBundle(
                    [
                        {
                            signer: wallet,
                            transaction: populatedTx,
                        },
                    ],
                    targetBlock
                );

                // Type-safe error handling
                if ("error" in bundle) {
                    throw new Error(`Flashbots error: ${bundle.error.message}`);
                }

                const waitResponse = await bundle.wait();

                if (waitResponse === 0) {
                    console.log(`✅ Flashbots bundle included in block ${targetBlock}`);
                    return;
                } else {
                    throw new Error(`❌ Flashbots bundle NOT included in block ${targetBlock}`);
                }

            } else {
                const tx = await wallet.sendTransaction(populatedTx);
                console.log(`🚀 TX sent (attempt ${retries + 1}): ${tx.hash}`);

                const receipt = await tx.wait(3);
                if (receipt && receipt.status === 1) {
                    console.log(`✅ TX confirmed in block ${receipt.blockNumber}`);
                    return;
                } else {
                    throw new Error("❌ TX failed or receipt is null.");
                }
            }
        } catch (err) {
            console.warn(`⏱ Retry ${retries + 1}/${maxRetries} — ${err}`);
            retries++;
        }
    }

    throw new Error("🚨 Max retries reached. TX not mined.");
}
