// test/realpath/triage/fixtures/AUD-TX-003-second-launch.ts
// Phase 23 plan 23-09 (AUDIT-02): a second token launch on the same simulated ETH chain, for the
// triage files that need two different tokens on one wallet (AUD-TX-003: a held position plus a
// snipe of another token; AUD-BUY-010: two snipes racing the risk gate). Lives beside its tests:
// the harness is read-only for triage plans, and createScenario builds one token and one pair.
//
// secondLaunch(sc) needs an ETH uniswap-v2 scenario. It launches token B on the chain's OTHER real
// V2 DEX, sushiswap-v2 (its own factory, router and CREATE2 pair address), so B's router answers
// never collide with the scenario's. Everything goes through the public FakeNode API (setCode,
// setRead), answered the same way the scenario answers its own token (world.ts createScenario):
//   - token B: the plain ERC-20 runtime code, name/symbol/decimals/totalSupply/tradingEnabled, the
//     limit functions revert as on a token without them, balanceOf (the pair holds B's reserve,
//     the wallet holds what its mined sushiswap buys bought at B's reserves);
//   - pair B: token0/token1/getReserves/totalSupply;
//   - the sushiswap router: getAmountsOut and swapExactETHForTokens, constant product on B's
//     reserves (the scenario token has no pair on sushiswap, so a path through it reverts empty);
//   - the HoneypotChecker: checkV2 is re-served for both tokens with the same clean round trip the
//     scenario serves for its own token (RoundtripResult status 0x07, 0 bps), from the contract's
//     own Ignition ABI; any other token gets the scenario's BuyFailed answer;
//   - Unicrypt: the scenario's own route handler is wrapped (as plan 23-06 re-wrapped a route on
//     harnessState().httpRoutes): pair B gets the same lock answer, everything else goes to the
//     scenario's handler unchanged.
// fire() mines B's launch, the deployer's real addLiquidityETH on the sushiswap router, with the
// sushiswap factory's real PairCreated log (D-06), for the bot's sushiswap listener.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, Wallet, ethers, getAddress, getCreate2Address, parseEther, solidityPackedKeccak256 } from 'ethers';
import { REVERT_EMPTY, encodeResult, harnessState, labelAddress, revertReason, revertWith, type FakeLog, type HttpHandler } from '../../harness/chain';
import { v2AmountOut, type Scenario } from '../../harness/world';

const V2_ROUTER = new Interface(['function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)']);
const V2_FACTORY = new Interface(['event PairCreated(address indexed token0, address indexed token1, address pair, uint256)']);
/** CREATE2 pair init code hash of the real SushiSwap V2 factory on Ethereum. */
const SUSHI_INIT_CODE_HASH = '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c520363afb7d6c5a5f0f1a';
const UNICRYPT_PREFIX = 'https://api.unicrypt.network/api/v2/locker/pair/';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const ERC20_SELECTORS = ['06fdde03', '95d89b41', '313ce567', '18160ddd', '70a08231', 'a9059cbb', '095ea7b3', 'dd62ed3e', '23b872dd'];
const ERC20_CODE = '0x608060405234801561001057600080fd5b50600436106100a95760003560e01c' + ERC20_SELECTORS.map((s) => `8063${s}14`).join('');
const PAIR_CODE = '0x608060405234801561001057600080fd5b50600436106101b05760003560e01c80630902f1ac14';

function checkerInterface(): Interface {
    const file = path.join(REPO_ROOT, 'ignition', 'deployments', 'chain-1', 'artifacts', 'HoneypotCheckerModule#HoneypotChecker.json');
    return new Interface((JSON.parse(fs.readFileSync(file, 'utf8')) as { abi: ethers.InterfaceAbi }).abi);
}

function isqrt(n: bigint): bigint {
    if (n < 2n) return n;
    let x = n;
    let y = (x + 1n) / 2n;
    while (y < x) {
        x = y;
        y = (x + n / x) / 2n;
    }
    return x;
}

export interface SecondLaunch {
    /** The sushiswap-v2 DEX config of the chain (the bot's own registry entry). */
    dex: Scenario<'v2'>['dex'];
    token: string;
    pair: string;
    reserves: { weth: bigint; token: bigint };
    /** Mine B's launch and deliver its real PairCreated log. */
    fire(): Promise<{ block: number; log: FakeLog }>;
}

export function secondLaunch(sc: Scenario<'v2'>): SecondLaunch {
    if (sc.chain !== 'eth' || sc.dex.name !== 'uniswap-v2') throw new Error('secondLaunch: needs an ETH uniswap-v2 scenario');
    const dex = sc.ctx.chain.dexes.find((d) => d.dexType === 'v2' && d.name === 'sushiswap-v2') as Scenario<'v2'>['dex'] | undefined;
    if (!dex) throw new Error('secondLaunch: the ETH chain has no sushiswap-v2 DEX');
    const { node, weth } = sc;
    const wallet = sc.wallet.address.toLowerCase();
    const token = labelAddress('eth.v2.token-b');
    const [token0, token1] = token.toLowerCase() < weth.toLowerCase() ? [token, weth] : [weth, token];
    const pair = getCreate2Address(dex.factoryAddress, solidityPackedKeccak256(['address', 'address'], [token0, token1]), SUSHI_INIT_CODE_HASH);
    const reserves = { weth: parseEther('5'), token: parseEther('1000000') };
    const tokenSupply = parseEther('1000000000');
    const lpSupply = isqrt(reserves.weth * reserves.token);
    const router = getAddress(dex.routerAddress);
    const quote = (amountIn: bigint, tokenIn: string, tokenOut: string): bigint | undefined => {
        const a = tokenIn.toLowerCase();
        const b = tokenOut.toLowerCase();
        if (a === weth.toLowerCase() && b === token.toLowerCase()) return v2AmountOut(amountIn, reserves.weth, reserves.token);
        if (a === token.toLowerCase() && b === weth.toLowerCase()) return v2AmountOut(amountIn, reserves.token, reserves.weth);
        return undefined;
    };

    node.setCode(token, ERC20_CODE);
    node.setCode(pair, PAIR_CODE);
    node.setRead(token, 'name()', encodeResult(['string'], ['Realpath Second Token']));
    node.setRead(token, 'symbol()', encodeResult(['string'], ['RPL2']));
    node.setRead(token, 'decimals()', encodeResult(['uint8'], [18]));
    node.setRead(token, 'totalSupply()', encodeResult(['uint256'], [tokenSupply]));
    node.setRead(token, 'tradingEnabled()', encodeResult(['bool'], [true]));
    for (const sig of ['maxWalletAmount()', 'maxWallet()', 'maxTxAmount()', 'maxTransactionAmount()']) node.setRead(token, sig, REVERT_EMPTY);
    const bought = (): bigint =>
        node.submitted
            .filter((s) => s.status === 'mined' && s.tx.to?.toLowerCase() === router.toLowerCase() && (s.tx.from ?? '').toLowerCase() === wallet && s.tx.value > 0n)
            .reduce((a, s) => a + (quote(s.tx.value, weth, token) ?? 0n), 0n);
    node.setRead(token, 'balanceOf(address)', ({ args }) => {
        const who = String(args[0]).toLowerCase();
        if (who === pair.toLowerCase()) return encodeResult(['uint256'], [reserves.token]);
        if (who === wallet) return encodeResult(['uint256'], [bought()]);
        return encodeResult(['uint256'], [0n]);
    });
    node.setRead(pair, 'token0()', encodeResult(['address'], [token0]));
    node.setRead(pair, 'token1()', encodeResult(['address'], [token1]));
    node.setRead(pair, 'getReserves()', () => {
        const [r0, r1] = token0 === weth ? [reserves.weth, reserves.token] : [reserves.token, reserves.weth];
        return encodeResult(['uint112', 'uint112', 'uint32'], [r0, r1, Math.floor(Date.now() / 1000) - 12]);
    });
    node.setRead(pair, 'totalSupply()', encodeResult(['uint256'], [lpSupply]));
    node.setRead(router, 'getAmountsOut(uint256,address[])', ({ args }) => {
        const p = (args[1] as string[]).map(String);
        if (p.length !== 2) return revertReason('UniswapV2Library: INVALID_PATH');
        const out = quote(args[0] as bigint, p[0], p[1]);
        return out === undefined ? REVERT_EMPTY : encodeResult(['uint256[]'], [[args[0] as bigint, out]]);
    });
    node.setRead(router, 'swapExactETHForTokens(uint256,address[],address,uint256)', ({ args, value }) => {
        const p = (args[1] as string[]).map(String);
        if (p[0].toLowerCase() !== weth.toLowerCase()) return revertReason('UniswapV2Router: INVALID_PATH');
        const out = quote(value, p[0], p[1]);
        if (out === undefined) return REVERT_EMPTY;
        if ((args[3] as bigint) < BigInt(Math.floor(Date.now() / 1000))) return revertReason('UniswapV2Router: EXPIRED');
        if (out < (args[0] as bigint)) return revertReason('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
        return encodeResult(['uint256[]'], [[value, out]]);
    });
    const checkerAbi = checkerInterface();
    node.setRead(sc.checker, 'checkV2(address,address,uint256)', ({ args }) => {
        const asked = String(args[1]).toLowerCase();
        if (asked !== sc.token.toLowerCase() && asked !== token.toLowerCase()) return revertWith(checkerAbi.encodeErrorResult('BuyFailed', ['no liquidity']));
        return revertWith(checkerAbi.encodeErrorResult('RoundtripResult', [0n, 0n, 7]));
    });
    const route = harnessState().httpRoutes.find((r) => r.prefix === UNICRYPT_PREFIX);
    if (!route) throw new Error('secondLaunch: the scenario has no Unicrypt route to extend');
    const scenarioHandler: HttpHandler = route.handler;
    route.handler = (req) => {
        if (req.url.toLowerCase().startsWith(`${UNICRYPT_PREFIX}${pair.toLowerCase()}?`)) {
            return { data: { locks: [{ unlock_date: Math.floor(Date.now() / 1000) + 30 * 86_400, amount: lpSupply.toString() }] } };
        }
        return scenarioHandler(req);
    };

    const deployer = new Wallet(ethers.id('realpath.deployer.eth.token-b'));
    node.setBalance(deployer.address, reserves.weth * 4n);
    let fired = false;
    return {
        dex,
        token,
        pair,
        reserves,
        async fire() {
            if (fired) throw new Error('secondLaunch.fire: token B already launched');
            fired = true;
            const data = V2_ROUTER.encodeFunctionData('addLiquidityETH', [token, reserves.token, reserves.token, reserves.weth, deployer.address, Math.floor(Date.now() / 1000) + 600]);
            const raw = await deployer.signTransaction({
                chainId: node.chainId, nonce: node.minedCount(deployer.address), to: router, value: reserves.weth, gasLimit: 4_000_000n, type: 2,
                maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, data,
            });
            const hash = node.addForeignTransaction(raw);
            const e = V2_FACTORY.encodeEventLog('PairCreated', [token0, token1, pair, 2n]);
            const block = node.mine({ include: [hash], logs: [{ address: dex.factoryAddress, topics: e.topics, data: e.data, transactionHash: hash }] });
            const log = node.logs.find((l) => l.transactionHash === hash && l.address === dex.factoryAddress.toLowerCase())!;
            return { block, log };
        },
    };
}
