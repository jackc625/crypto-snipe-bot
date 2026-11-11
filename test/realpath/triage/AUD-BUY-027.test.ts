// test/realpath/triage/AUD-BUY-027.test.ts
// Phase 23 plan 23-06 Task 3 (AUDIT-02): AUD-BUY-027, factory events are not filtered to
// wrapped-native pairs. src/bot.ts handleNewPairForChain takes token1 as the target only when
// token0 is WETH and token0 otherwise, with no check that either side is WETH; the PairCreated
// listener forwards every pair. For an A/B pair the safety bank then reads the A/B pair: the
// liquidity check (src/utils/tokenSafety.ts isLiquiditySufficientForChain) takes reserve1 as the
// WETH reserve whenever token0 is not WETH, and the lock check asks about the A/B pair. The buy
// itself goes WETH -> A through the router, a different pair from the one checked.
//
// Proof on the real path: the scenario token A already trades against WETH (the scenario's pair,
// with its reads), and a second pair A/B is launched against another ERC-20 B: a real signed
// router.addLiquidity(A, B, ...) mined with its real PairCreated (token0 = A, token1 = B, the
// pair at its real CREATE2 address). The A/B pair holds 2 B and has 95 percent of its LP at the
// dead address, so Unicrypt (which the harness answers 404 for a pair it does not know) falls
// back to the real burn check, which passes. Measured: whether the bot processed the A/B pair as
// a snipe and whether it submitted a buy. Correct: the event is dropped, nothing bought.
//
// Fix signal (D-08): dropping an event whose pair has no wrapped-native side reads "looks fixed"
// (fix-shaped src mutation, restored).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Transaction, Wallet, ethers, getAddress, getCreate2Address, parseEther, solidityPackedKeccak256 } from 'ethers';
import { encodeResult, labelAddress } from '../harness/chain';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue } from '../harness/world';

/** The Uniswap V2 pair init code hash on Ethereum (keccak256 of the pair creation code). */
const UNISWAP_V2_INIT_CODE_HASH = '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const V2 = new Interface([
    'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
    'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
    'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)',
]);
/** Runtime code of a plain ERC-20 (a PUSH4 per selector), built like the scenario token's. */
const ERC20_CODE = '0x608060405234801561001057600080fd5b50600436106100a95760003560e01c' + ['06fdde03', '95d89b41', '313ce567', '18160ddd', '70a08231', 'a9059cbb', '095ea7b3', '23b872dd'].map((s) => `8063${s}14`).join('');
const PAIR_CODE = '0x608060405234801561001057600080fd5b50600436106101b05760003560e01c80630902f1ac14';

function logged(msg: string): Array<Record<string, unknown> | undefined> {
    return recordedLogs()
        .filter((l) => l.msg === msg)
        .map((l) => l.obj);
}

async function stepUntilOrFor(pred: () => boolean, windowMs: number): Promise<void> {
    const end = Date.now() + windowMs;
    while (!pred() && Date.now() < end) await stepFor(500);
}

describe('AUD-BUY-027: factory events are not filtered to wrapped-native pairs', () => {
    it('non-native-pair-checked-and-bought: a PairCreated for an A/B pair is processed as a snipe, its B reserve is read as native, and the bot buys A through WETH', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node, graph, dex, token, weth, wallet } = sc;
        // B: another ERC-20, ordered after A so the A/B pair's token0 is A (the bot's target).
        let other = '';
        for (let i = 0; ; i++) {
            other = labelAddress(`eth.v2.other-token.${i}`);
            if (token.toLowerCase() < other.toLowerCase()) break;
        }
        expect(other.toLowerCase()).not.toBe(weth.toLowerCase());
        const abPair = getCreate2Address(dex.factoryAddress, solidityPackedKeccak256(['address', 'address'], [token, other]), UNISWAP_V2_INIT_CODE_HASH);
        expect(abPair.toLowerCase()).not.toBe(sc.pair.toLowerCase());
        node.setCode(other, ERC20_CODE);
        node.setCode(abPair, PAIR_CODE);
        // The A/B pair: 100 000 A against 2 B, LP supply sqrt-ish, 95 percent of LP burned to dead.
        const reserveA = parseEther('100000');
        const reserveB = parseEther('2');
        const lpSupply = parseEther('447');
        node.setRead(abPair, 'token0()', encodeResult(['address'], [token]));
        node.setRead(abPair, 'token1()', encodeResult(['address'], [other]));
        node.setRead(abPair, 'getReserves()', encodeResult(['uint112', 'uint112', 'uint32'], [reserveA, reserveB, Math.floor(Date.now() / 1000)]));
        node.setRead(abPair, 'totalSupply()', encodeResult(['uint256'], [lpSupply]));
        node.setRead(abPair, 'balanceOf(address)', ({ args }) => encodeResult(['uint256'], [String(args[0]).toLowerCase() === DEAD.toLowerCase() ? (lpSupply * 95n) / 100n : 0n]));

        await graph.bot.startDexListener(sc.ctx, dex, sc.registry);
        await stepUntilTrue(() => node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === dex.factoryAddress.toLowerCase()), { what: 'the factory subscription' });

        // The A/B launch: a real signed addLiquidity, mined with its PairCreated.
        const launcher = new Wallet(ethers.id('realpath.aud-buy-027.launcher'));
        node.setBalance(launcher.address, parseEther('1'));
        const raw = await launcher.signTransaction({
            chainId: 1, nonce: 0, to: dex.routerAddress, value: 0n, gasLimit: 4_000_000n, type: 2, maxFeePerGas: 60_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
            data: V2.encodeFunctionData('addLiquidity', [token, other, reserveA, reserveB, reserveA, reserveB, launcher.address, Math.floor(Date.now() / 1000) + 600]),
        });
        const hash = node.addForeignTransaction(raw);
        const created = V2.encodeEventLog('PairCreated', [token, other, abPair, 2n]);
        node.mine({ include: [hash], logs: [{ address: dex.factoryAddress, topics: created.topics, data: created.data, transactionHash: hash }] });

        await stepUntilOrFor(() => node.submitted.length > 0 || logged('Safety checks failed, skipping').length > 0, 60_000);
        knownBug(ctx, 'AUD-BUY-027', {
            claim: 'non-native-pair-checked-and-bought',
            correct: { processedAsSnipe: false, buySubmitted: false },
            observed: { processedAsSnipe: true, buySubmitted: true },
            actual: {
                processedAsSnipe: logged('New pair detected').some((o) => String(o?.pair).toLowerCase() === abPair.toLowerCase()),
                buySubmitted: node.submitted.length > 0,
            },
            expectedPlain: 'A new pair with no wrapped-native (WETH) side is dropped: the bot only snipes pairs whose checks describe the pool it buys through.',
            actualPlain: 'The bot took a token/token pair as a new launch, ran its liquidity and lock checks on that pair (reading the other token\'s reserve as ETH), and bought the token through WETH, a pool no check looked at.',
        });

        // Bug details, after the marker. The liquidity the alert reports is B's reserve, shown as ETH.
        const alert = recordedAlerts().find((a) => String(a.message).startsWith('*New Token Detected!*'));
        expect(String(alert?.message)).toContain('WETH LP: `2.0 ETH`');
        expect(String(alert?.message)).toContain(`Pair: [\`${abPair}\`]`);
        // The checks read the A/B pair (reserves; the burn fallback after Unicrypt's 404).
        const pairCalls = node.callLog.filter((c) => c.method === 'eth_call' && c.to === abPair.toLowerCase());
        expect(pairCalls.length).toBeGreaterThan(0);
        expect(logged('LP appears burned').some((o) => String(o?.pair).toLowerCase() === abPair.toLowerCase())).toBe(true);
        // The buy goes WETH -> A through the router: not the pair that was checked.
        const tx = Transaction.from(node.submitted[0].raw);
        expect(getAddress(tx.to!)).toBe(getAddress(dex.routerAddress));
        const call = V2.parseTransaction({ data: tx.data, value: tx.value });
        expect(call?.name).toBe('swapExactETHForTokens');
        expect((call!.args[1] as string[]).map((a) => getAddress(a))).toEqual([getAddress(weth), getAddress(token)]);
        expect(getAddress(tx.from!)).toBe(getAddress(wallet.address));
        // Land it and wait for arming, so teardown cancels nothing.
        await stepFor(12_000);
        node.mine({ include: [node.submitted[0].hash] });
        await stepUntilTrue(() => graph.db.prepare('SELECT 1 FROM trades').get() !== undefined, { what: 'the trades row', maxSteps: 20_000 });
        await stepUntilTrue(
            () => recordedLogs().some((l) => l.obj?.op === 'exit.monitor.started') && node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(abPair.toLowerCase())),
            { what: 'the position being armed on the A/B pair', maxSteps: 20_000 },
        );
        // Anti-rug watches the A/B pair, not the WETH pair the bought tokens trade against.
        expect(node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase()))).toBe(false);
        expect(graph.detector.getRegisteredPositions('eth').map((p) => p.pairOrPoolAddress)).toEqual([abPair.toLowerCase()]);
    });
});
