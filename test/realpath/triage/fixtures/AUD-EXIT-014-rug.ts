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
//
// pullV3Liquidity (review CR-05, for AUD-EXIT-007's anti-rug claim): the V3 rug shape. The
// scenario's deployer holds the launch's full-range position through the NonfungiblePositionManager
// (the scenario's launch minted it there), so it calls the real NPM multicall(decreaseLiquidity,
// collect) for part of that position. The block holds the pool's own events in the order
// UniswapV3Pool emits them for that call: Burn(owner = the NPM, tickLower, tickUpper, liquidity,
// amount0, amount1), then Collect(owner = the NPM, recipient = the deployer, tickLower, tickUpper,
// amount0, amount1). The pool's virtual reserves move pro rata, so the scenario's QuoterV2 and swap
// answers (which read sc.reserves) follow, and liquidity() is re-served at the reduced value. The
// pool's Burn and Collect logs are the ones the anti-rug subscription watches for a V3 position.

import { Interface, Wallet, ZeroAddress, ethers } from 'ethers';
import { encodeResult } from '../../harness/chain';
import type { Scenario } from '../../harness/world';

/** The scenario's NonfungiblePositionManager on ETH Uniswap V3 (the launch minted through it). */
const ETH_V3_NPM = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
const NPM = new Interface([
    'function decreaseLiquidity(tuple(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)',
    'function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)',
    'function multicall(bytes[] data) payable returns (bytes[] results)',
]);
const POOL = new Interface([
    'function liquidity() view returns (uint128)',
    'function token0() view returns (address)',
    'event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
    'event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)',
]);
/** Uniswap V3 fee tier to tick spacing (the factory defaults; the scenario launches full range). */
const V3_TICK_SPACING: Record<number, number> = { 100: 1, 500: 10, 3000: 60, 10000: 200 };

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

/** One eth_call answer straight from the node (not via ethers). */
async function poolRead(sc: Scenario, fn: 'liquidity' | 'token0'): Promise<string | bigint> {
    const reply = (await sc.node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: sc.pair, data: POOL.encodeFunctionData(fn) }, 'latest'] })) as { result?: string; error?: unknown };
    if (typeof reply.result !== 'string') throw new Error(`pullV3Liquidity: the pool did not answer ${fn}: ${JSON.stringify(reply.error)}`);
    return POOL.decodeFunctionResult(fn, reply.result)[0] as string | bigint;
}

export interface V3LiquidityPull {
    hash: string;
    block: number;
    deployer: string;
    /** The position manager: the owner the pool's Burn and Collect name. */
    owner: string;
    liquidity: bigint;
}

/** The deployer removes `removeBps` (of 10000) of the pool's liquidity through the NPM (see the header). */
export async function pullV3Liquidity(sc: Scenario, opts: { removeBps: bigint }): Promise<V3LiquidityPull> {
    if (sc.dex.dexType !== 'v3' || sc.chain !== 'eth' || sc.dex.name !== 'uniswap-v3') throw new Error('pullV3Liquidity: an ETH Uniswap V3 scenario is required');
    const { node, reserves, pair, weth } = sc;
    const deployer = new Wallet(ethers.id(`realpath.deployer.${sc.chain}`));
    if (node.minedCount(deployer.address) < 1) throw new Error('pullV3Liquidity: the deployer never launched the pool (fire the launch first)');
    const before = (await poolRead(sc, 'liquidity')) as bigint;
    const token0 = String(await poolRead(sc, 'token0')).toLowerCase();
    const liquidity = (before * opts.removeBps) / 10_000n;
    const outWeth = (reserves.weth * opts.removeBps) / 10_000n;
    const outToken = (reserves.token * opts.removeBps) / 10_000n;
    const wethIs0 = token0 === weth.toLowerCase();
    const [a0, a1] = wethIs0 ? [outWeth, outToken] : [outToken, outWeth];
    const spacing = V3_TICK_SPACING[sc.feeTier!];
    const tickBound = Math.floor(887272 / spacing) * spacing;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const data = NPM.encodeFunctionData('multicall', [
        [
            NPM.encodeFunctionData('decreaseLiquidity', [[1n, liquidity, 0n, 0n, deadline]]),
            NPM.encodeFunctionData('collect', [[1n, deployer.address, (1n << 128n) - 1n, (1n << 128n) - 1n]]),
        ],
    ]);
    const raw = await deployer.signTransaction({
        chainId: node.chainId, nonce: node.minedCount(deployer.address), to: ETH_V3_NPM, value: 0n, gasLimit: 400_000n, type: 2,
        maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, data,
    });
    const hash = node.addForeignTransaction(raw);
    reserves.weth -= outWeth;
    reserves.token -= outToken;
    node.setRead(pair, 'liquidity()', encodeResult(['uint128'], [before - liquidity]));
    const burn = POOL.encodeEventLog('Burn', [ETH_V3_NPM, -tickBound, tickBound, liquidity, a0, a1]);
    const collect = POOL.encodeEventLog('Collect', [ETH_V3_NPM, deployer.address, -tickBound, tickBound, a0, a1]);
    const block = node.mine({
        include: [hash],
        logs: [burn, collect].map((e) => ({ address: pair, topics: e.topics, data: e.data, transactionHash: hash })),
    });
    return { hash, block, deployer: deployer.address, owner: ETH_V3_NPM, liquidity };
}
