// test/realpath/triage/fixtures/AUD-EXIT-014-rug.ts
// Phase 23 plan 23-08 (AUDIT-02): a real V2 liquidity pull for the anti-rug triage files of this
// plan (AUD-EXIT-014, AUD-TX-028). Lives beside its tests: the harness is read-only for triage
// plans. It adds no behavior to the simulated node; it signs and mines the deployer's real router
// call and re-serves the pair's totalSupply through the public FakeNode API.
//
// pullLiquidity: the scenario's deployer (the launch's LP holder, the same deterministic key the
// scenario launched the pair with) calls the real Uniswap V2 router removeLiquidityETH for part of
// its LP. The block holds the pair's own events, in the order UniswapV2Pair emits them: the LP
// Transfer(deployer -> pair) of the router's transferFrom, then burn()'s Transfer(pair -> 0),
// Sync and Burn(router, amount0, amount1, router). The reserves move by the pair's own pro-rata
// math and totalSupply falls by the LP burned. The pair's Burn and Transfer logs are the ones the
// anti-rug subscription watches.

import { Interface, Wallet, ZeroAddress, ethers } from 'ethers';
import { encodeResult } from '../../harness/chain';
import type { Scenario } from '../../harness/world';

const ROUTER = new Interface(['function removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)']);
const PAIR = new Interface([
    'function totalSupply() view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Sync(uint112 reserve0, uint112 reserve1)',
    'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)',
]);

/** The pair's LP totalSupply as the node answers it (read straight from the node, not via ethers). */
export async function lpTotalSupply(sc: Scenario): Promise<bigint> {
    const reply = (await sc.node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: sc.pair, data: PAIR.encodeFunctionData('totalSupply') }, 'latest'] })) as { result?: string; error?: unknown };
    if (typeof reply.result !== 'string') throw new Error(`lpTotalSupply: the pair did not answer totalSupply: ${JSON.stringify(reply.error)}`);
    return PAIR.decodeFunctionResult('totalSupply', reply.result)[0] as bigint;
}

export interface LiquidityPull {
    hash: string;
    block: number;
    deployer: string;
    liquidity: bigint;
}

/** The deployer removes `removeBps` (of 10000) of the LP supply through the V2 router. */
export async function pullLiquidity(sc: Scenario, opts: { removeBps: bigint }): Promise<LiquidityPull> {
    if (sc.dex.dexType !== 'v2') throw new Error('pullLiquidity: a V2 scenario is required');
    const { node, reserves, pair, token, weth } = sc;
    const deployer = new Wallet(ethers.id(`realpath.deployer.${sc.chain}`));
    // The scenario's launch came from this key: it holds the LP.
    if (node.minedCount(deployer.address) < 1) throw new Error('pullLiquidity: the deployer never launched the pair (fire the launch first)');
    const supply = await lpTotalSupply(sc);
    const liquidity = (supply * opts.removeBps) / 10_000n;
    const outWeth = (reserves.weth * liquidity) / supply;
    const outToken = (reserves.token * liquidity) / supply;
    const raw = await deployer.signTransaction({
        chainId: node.chainId, nonce: node.minedCount(deployer.address), to: sc.dex.routerAddress, value: 0n, gasLimit: 300_000n, type: 2,
        maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n,
        data: ROUTER.encodeFunctionData('removeLiquidityETH', [token, liquidity, 0n, 0n, deployer.address, BigInt(Math.floor(Date.now() / 1000) + 600)]),
    });
    const hash = node.addForeignTransaction(raw);
    reserves.weth -= outWeth;
    reserves.token -= outToken;
    node.setRead(pair, 'totalSupply()', encodeResult(['uint256'], [supply - liquidity]));
    const wethIs0 = weth.toLowerCase() < token.toLowerCase();
    const [r0, r1] = wethIs0 ? [reserves.weth, reserves.token] : [reserves.token, reserves.weth];
    const [a0, a1] = wethIs0 ? [outWeth, outToken] : [outToken, outWeth];
    const toPair = PAIR.encodeEventLog('Transfer', [deployer.address, pair, liquidity]);
    const burnLp = PAIR.encodeEventLog('Transfer', [pair, ZeroAddress, liquidity]);
    const sync = PAIR.encodeEventLog('Sync', [r0, r1]);
    const burn = PAIR.encodeEventLog('Burn', [sc.dex.routerAddress, a0, a1, sc.dex.routerAddress]);
    const block = node.mine({
        include: [hash],
        logs: [toPair, burnLp, sync, burn].map((e) => ({ address: pair, topics: e.topics, data: e.data, transactionHash: hash })),
    });
    return { hash, block, deployer: deployer.address, liquidity };
}
