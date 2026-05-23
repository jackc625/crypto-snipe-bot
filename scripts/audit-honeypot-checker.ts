// scripts/audit-honeypot-checker.ts
//
// Read-only on-chain audit of the deployed ETH HoneypotChecker contract.
// Reports bytecode presence + hash, contract-creator address (via Etherscan
// API), nonce/balance for the deploy wallet, and chainRegistry literal match.
//
// Usage: npx ts-node scripts/audit-honeypot-checker.ts
//
// No private key needed — read-only.

import 'dotenv/config';
import { ethers } from 'ethers';

const CHECKER_ADDR = '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD';
const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api?chainid=1';

async function main() {
    const rpcUrl = process.env.ETH_RPC_URL;
    const apiKey = process.env.ETHERSCAN_API_KEY;

    if (!rpcUrl) {
        console.error('ETH_RPC_URL not set');
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    console.log('=== HoneypotChecker on-chain audit ===');
    console.log(`Address: ${CHECKER_ADDR}`);
    console.log('');

    // ----- 1. Bytecode check -----
    const code = await provider.getCode(CHECKER_ADDR);
    const codeLen = (code.length - 2) / 2;
    const codeHash = ethers.keccak256(code);
    console.log('--- Bytecode ---');
    console.log(`Length:    ${codeLen} bytes`);
    console.log(`Hash:      ${codeHash}`);
    console.log(`Present:   ${code !== '0x' ? 'YES (contract exists)' : 'NO — empty bytecode (anomaly!)'}`);
    console.log('');

    // ----- 2. Contract activity (via Etherscan API) -----
    if (apiKey) {
        console.log('--- Transaction activity (Etherscan API) ---');
        try {
            const txUrl = `${ETHERSCAN_V2}&module=account&action=txlist&address=${CHECKER_ADDR}&startblock=0&endblock=99999999&sort=asc&apikey=${apiKey}`;
            const resp = await fetch(txUrl);
            const data: any = await resp.json();
            if (data.status === '1' && Array.isArray(data.result)) {
                const txs = data.result;
                console.log(`Total normal transactions: ${txs.length}`);
                console.log(`Expected: 1 (the deploy tx). Anything beyond 1 deserves a look.`);
                console.log('');
                for (const [i, tx] of txs.entries()) {
                    console.log(`  Tx ${i + 1}:`);
                    console.log(`    Hash:    ${tx.hash}`);
                    console.log(`    From:    ${tx.from}`);
                    console.log(`    To:      ${tx.to || '(contract creation)'}`);
                    console.log(`    Block:   ${tx.blockNumber} (${new Date(Number(tx.timeStamp) * 1000).toISOString()})`);
                    console.log(`    Method:  ${tx.functionName || tx.methodId || '(none)'}`);
                    console.log(`    Status:  ${tx.isError === '1' ? 'FAILED' : 'success'}`);
                    console.log(`    Gas:     ${tx.gasUsed} used`);
                    console.log('');
                }

                // Find the deploy tx (contract creation) and report creator
                const deployTx = txs.find((t: any) => t.to === '' || t.to === null);
                if (deployTx) {
                    console.log(`Contract Creator (deploy wallet): ${deployTx.from}`);
                    console.log('');

                    // ----- 3. Deploy wallet activity -----
                    console.log('--- Deploy wallet activity ---');
                    const walletUrl = `${ETHERSCAN_V2}&module=account&action=txlist&address=${deployTx.from}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`;
                    const wresp = await fetch(walletUrl);
                    const wdata: any = await wresp.json();
                    if (wdata.status === '1' && Array.isArray(wdata.result)) {
                        console.log(`Total outgoing transactions: ${wdata.result.length}`);
                        console.log(`Most recent transactions (last 5):`);
                        for (const tx of wdata.result.slice(0, 5)) {
                            console.log(`  ${new Date(Number(tx.timeStamp) * 1000).toISOString()} -> ${tx.to || '(contract creation)'} (${tx.isError === '1' ? 'FAILED' : 'ok'})  tx: ${tx.hash}`);
                        }
                    } else {
                        console.log(`(Etherscan returned: ${wdata.message || 'unknown'})`);
                    }

                    const balance = await provider.getBalance(deployTx.from);
                    const nonce = await provider.getTransactionCount(deployTx.from);
                    console.log('');
                    console.log(`Wallet balance: ${ethers.formatEther(balance)} ETH`);
                    console.log(`Wallet nonce:   ${nonce} (= number of txs sent)`);
                }
            } else {
                console.log(`Etherscan API responded: status=${data.status} message=${data.message}`);
            }
        } catch (e: any) {
            console.log(`Etherscan API call failed: ${e.message}`);
        }
    } else {
        console.log('--- Transaction activity ---');
        console.log('ETHERSCAN_API_KEY not set — skipping. Check on Etherscan UI instead.');
    }
    console.log('');

    // ----- 4. chainRegistry literal cross-check -----
    console.log('--- chainRegistry literal match ---');
    try {
        const { buildChainRegistry } = await import('../src/chainRegistry');
        const reg = buildChainRegistry();
        const ethCfg = reg.get('eth');
        const regAddr = ethCfg?.honeypotChecker?.deployedAddress;
        console.log(`chainRegistry ETH literal:  ${regAddr}`);
        console.log(`Live deployed address:      ${CHECKER_ADDR}`);
        const match = regAddr && regAddr.toLowerCase() === CHECKER_ADDR.toLowerCase();
        console.log(`Match: ${match ? 'YES' : 'NO — DRIFT (anomaly!)'}`);
    } catch (e: any) {
        console.log(`chainRegistry load failed: ${e.message}`);
    }

    console.log('');
    console.log('=== Audit complete ===');
}

main().catch((e) => {
    console.error('Audit failed:', e);
    process.exit(1);
});
