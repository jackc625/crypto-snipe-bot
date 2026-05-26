// scripts/recover-sell-ladys.ts
// ONE-OFF RECOVERY: sell the LADYS position that the bot bought but lost track of
// (Flashbots bundle.wait() false-negative — the buy landed on-chain but the bot
// logged "TX failed", so the position was never registered/monitored).
//
// This sells LADYS -> ETH DIRECTLY via the Uniswap V2 router on the PUBLIC mempool
// (NOT Flashbots), so it sidesteps the buggy path entirely and just mines normally.
//
// Run in YOUR terminal (it signs with the prod wallet key from .env and broadcasts):
//   npx ts-node scripts/recover-sell-ladys.ts
//
// It quotes first, prints the expected ETH, approves the router if needed, then
// swaps the FULL LADYS balance with a 10% slippage floor. It never prints any key.

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const LADYS = '0x12970E6868f88f6557B76120662c1B3E50A646bf';

const ROUTER_ABI = [
    'function getAmountsOut(uint amountIn, address[] path) view returns (uint[])',
    'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) external',
];
const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function decimals() view returns (uint8)',
];

async function main(): Promise<void> {
    const url = process.env.ETH_RPC_URL || process.env.ALCHEMY_URL;
    const pk = process.env.PRIVATE_KEY;
    if (!url || !pk) {
        console.error('ERROR: ETH_RPC_URL/ALCHEMY_URL and PRIVATE_KEY must be set in .env');
        process.exit(1);
    }
    const provider = new ethers.JsonRpcProvider(url);
    const wallet = new ethers.Wallet(pk, provider);
    const token = new ethers.Contract(LADYS, ERC20_ABI, wallet);
    const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, wallet);

    const net = await provider.getNetwork();
    if (net.chainId !== 1n) {
        console.error('ERROR: not on Ethereum mainnet (chainId ' + net.chainId + ')');
        process.exit(1);
    }

    const dec = await token.decimals();
    const bal: bigint = await token.balanceOf(wallet.address);
    console.log('Wallet:', wallet.address);
    console.log('LADYS balance:', ethers.formatUnits(bal, dec));
    if (bal === 0n) {
        console.log('No LADYS to sell — nothing to do.');
        return;
    }

    const amounts: bigint[] = await router.getAmountsOut(bal, [LADYS, WETH]);
    const expectedEth = amounts[1];
    const minOut = (expectedEth * 90n) / 100n; // 10% slippage floor
    console.log('Expected out: ~' + ethers.formatEther(expectedEth) + ' ETH  (min accepted: ' + ethers.formatEther(minOut) + ' ETH)');

    const allowance: bigint = await token.allowance(wallet.address, UNISWAP_V2_ROUTER);
    if (allowance < bal) {
        console.log('Approving router to spend LADYS...');
        const atx = await token.approve(UNISWAP_V2_ROUTER, bal);
        console.log('  approve tx:', atx.hash, '(waiting)');
        await atx.wait();
        console.log('  approved.');
    }

    const deadline = Math.floor(Date.now() / 1000) + 600;
    console.log('Swapping LADYS -> ETH on the public mempool...');
    const stx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
        bal, minOut, [LADYS, WETH], wallet.address, deadline,
    );
    console.log('  SELL tx hash:', stx.hash, '(waiting for it to mine)');
    const rec = await stx.wait();
    console.log('  mined in block', rec?.blockNumber, '| status', rec?.status === 1 ? 'SUCCESS' : 'FAILED');

    const newEth = await provider.getBalance(wallet.address);
    const newLadys: bigint = await token.balanceOf(wallet.address);
    console.log('--- after ---');
    console.log('ETH balance:  ', ethers.formatEther(newEth), 'ETH');
    console.log('LADYS balance:', ethers.formatUnits(newLadys, dec), '(should be ~0)');
    console.log('Etherscan: https://etherscan.io/tx/' + stx.hash);
}

main().catch((err) => {
    console.error('SELL FAILED:', err && (err as Error).message ? (err as Error).message : err);
    process.exit(1);
});
