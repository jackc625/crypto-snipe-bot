// test/realpath/ordering/sameBlock.test.ts
// Phase 23 plan 23-24 Task 2 (CHAR-04, AC-31): two PairCreated events in one block, and the order
// the bot handles them.
//
// Setup, all on the public FakeNode API: an ETH uniswap-v2 scenario (token A, the scenario's own
// pair) and token B on sushiswap-v2 from fixtures/AUD-TX-003-second-launch.ts (its own factory,
// router and pair, so the two tokens' answers never collide). The real DEX listeners for both
// factories subscribe. Both launches are the deployers' real signed addLiquidityETH transactions
// (signed here with the same harness deployer keys and calls fireNewPair and secondLaunch.fire use,
// because those helpers each mine their own block), mined together in ONE block; then both
// factories' PairCreated logs are delivered with node.emitLogs([...]) in a defined order. Each
// order is run (B first, then A first), so the order the bot follows is the log order, not the
// order its listeners were started in.
//
// What is pinned, from the op and plain log entries, the timeline and the node:
//   - each handler logs "New pair detected" in log order (the first-seen pair first);
//   - both handlers run their dedup checks as today and neither is skipped: the already-sniped
//     check (src/bot.ts handleNewPairForChain, isTokenSniped) and the risk gate (canSnipe) pass for
//     both, because the tokens differ and the open-position limit (test/.env.test, 10) has room;
//   - the first-seen token is bought first: its buy reaches the node first, at the wallet's next
//     nonce, its trades row is inserted first and its position is armed first; the second token's
//     buy takes the following nonce once the first buy has released the wallet's nonce lock.
//
// Known findings near this path, kept out of what decides the result:
//   AUD-BUY-004 (the same token on two DEXes in one block passes the already-sniped check twice):
//     two different tokens are used here, so it does not apply.
//   AUD-BUY-010 (risk limits checked long before the snipe is recorded): the limit has room for
//     both, so both pass whether or not it is fixed.
//   AUD-ANTIRUG-024 (a fresh database's false backfill gap): one error line per arming; it is
//     accounted for below and not part of the order.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { ethers, Interface, Transaction, Wallet, getAddress } from 'ethers';
import { recordedLogs } from '../harness/capture';
import { createScenario, stepUntilTrue, type Scenario } from '../harness/world';
import { driveChain } from '../triage/fixtures/AUD-API-001-dashboard-sell';
import { listen, subscribedTo } from '../triage/fixtures/AUD-EXIT-002-position';
import { settleAntiRugArming } from '../triage/fixtures/AUD-TX-002-lock';
import { secondLaunch, type SecondLaunch } from '../triage/fixtures/AUD-TX-003-second-launch';

const V2_ROUTER = new Interface([
    'function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)',
    'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
]);
const V2_FACTORY = new Interface(['event PairCreated(address indexed token0, address indexed token1, address pair, uint256)']);
// The two launch actors of the harness: the scenario deployer (world.ts createScenario) and token
// B's deployer (fixtures/AUD-TX-003-second-launch.ts). Both are funded by those helpers.
const DEPLOYER_A = new Wallet(ethers.id('realpath.deployer.eth'));
const DEPLOYER_B = new Wallet(ethers.id('realpath.deployer.eth.token-b'));
// The launch fee: the eth scenario's 10 gwei base fee x4 plus 2 gwei, as fireNewPair signs it.
const LAUNCH_FEES = { type: 2, maxFeePerGas: 42_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n } as const;

interface Launch {
    name: 'A' | 'B';
    token: string;
    pair: string;
    factory: string;
    router: string;
    raw: string;
    log: { address: string; topics: string[]; data: string };
}

function sortTokens(token: string, weth: string): [string, string] {
    return token.toLowerCase() < weth.toLowerCase() ? [token, weth] : [weth, token];
}

/** Sign one launch: the deployer's addLiquidityETH on the DEX's router, and its PairCreated log. */
async function signLaunch(sc: Scenario, who: { name: 'A' | 'B'; deployer: Wallet; token: string; pair: string; dex: Scenario<'v2'>['dex']; reserves: { weth: bigint; token: bigint }; pairIndex: bigint }): Promise<Launch> {
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const data = V2_ROUTER.encodeFunctionData('addLiquidityETH', [who.token, who.reserves.token, who.reserves.token, who.reserves.weth, who.deployer.address, deadline]);
    const raw = await who.deployer.signTransaction({ chainId: sc.node.chainId, nonce: sc.node.minedCount(who.deployer.address), to: who.dex.routerAddress, value: who.reserves.weth, gasLimit: 4_000_000n, data, ...LAUNCH_FEES });
    const [token0, token1] = sortTokens(who.token, sc.weth);
    const e = V2_FACTORY.encodeEventLog('PairCreated', [token0, token1, who.pair, who.pairIndex]);
    return { name: who.name, token: getAddress(who.token), pair: getAddress(who.pair), factory: who.dex.factoryAddress, router: getAddress(who.dex.routerAddress), raw, log: { address: who.dex.factoryAddress, topics: [...e.topics], data: e.data } };
}

/** Every swap buy the wallet submitted, in submission order, decoded with real ethers. */
function walletBuys(sc: Scenario): Array<{ hash: string; nonce: number; router: string; token: string }> {
    const out: Array<{ hash: string; nonce: number; router: string; token: string }> = [];
    for (const s of sc.node.submitted) {
        const tx = Transaction.from(s.raw);
        if ((tx.from ?? '').toLowerCase() !== sc.wallet.address.toLowerCase() || !tx.to) continue;
        const call = V2_ROUTER.parseTransaction({ data: tx.data, value: tx.value });
        if (!call || call.name !== 'swapExactETHForTokens') continue;
        const p = (call.args[1] as string[]).map((a) => getAddress(a));
        out.push({ hash: s.hash, nonce: tx.nonce, router: getAddress(tx.to), token: p[p.length - 1] });
    }
    return out;
}

type LogLine = ReturnType<typeof recordedLogs>[number];

/** Log lines with this message, in order, keyed by a field. */
function linesFor(msg: string, field: 'pair' | 'token', from: number): string[] {
    return recordedLogs()
        .slice(from)
        .filter((l: LogLine) => l.msg === msg)
        .map((l) => getAddress(String(l.obj?.[field])));
}

describe.each([
    { first: 'B' as const, second: 'A' as const, label: "token B's sushiswap-v2 pair first, then token A's uniswap-v2 pair" },
    { first: 'A' as const, second: 'B' as const, label: "token A's uniswap-v2 pair first, then token B's sushiswap-v2 pair" },
])('two PairCreated logs in one block: $label', ({ first, second }) => {
    it('the bot handles them in log order: both pass their dedup checks, the first-seen token is bought, recorded and armed first', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node } = sc;
        const b: SecondLaunch = secondLaunch(sc);
        await listen(sc);
        await sc.graph.bot.startDexListener(sc.ctx, b.dex, sc.registry);
        await stepUntilTrue(() => subscribedTo(sc, b.dex.factoryAddress), { what: 'the sushiswap listener subscribing to PairCreated' });

        const launches: Record<'A' | 'B', Launch> = {
            A: await signLaunch(sc, { name: 'A', deployer: DEPLOYER_A, token: sc.token, pair: sc.pair, dex: sc.dex, reserves: sc.reserves, pairIndex: 1n }),
            B: await signLaunch(sc, { name: 'B', deployer: DEPLOYER_B, token: b.token, pair: b.pair, dex: b.dex, reserves: b.reserves, pairIndex: 2n }),
        };
        const fromLog = recordedLogs().length;
        const fromTimeline = sc.timeline.entries.length;
        const walletNonce = node.minedCount(sc.wallet.address);

        // Both launches mined in one block, then both PairCreated logs delivered in the defined order.
        const hashes = { A: node.addForeignTransaction(launches.A.raw), B: node.addForeignTransaction(launches.B.raw) };
        const block = node.mine({ include: [hashes[first], hashes[second]] });
        node.emitLogs([
            { ...launches[first].log, transactionHash: hashes[first] },
            { ...launches[second].log, transactionHash: hashes[second] },
        ]);
        const delivered = node.logs.filter((l) => l.blockNumber !== undefined && Number(BigInt(l.blockNumber)) === block);
        expect(delivered.map((l) => getAddress(l.address))).toEqual([getAddress(launches[first].factory), getAddress(launches[second].factory)]);

        // Both buys land (each bundle at a block it targets), then both positions are armed.
        const finished = (): number => recordedLogs().slice(fromLog).filter((l) => l.msg === 'MEV bundle submitted' || l.obj?.op === 'buy.snipe.fail-clean').length;
        await driveChain(sc, { mode: 'land', until: () => finished() >= 2, what: 'both buys finishing' });
        await stepUntilTrue(() => recordedLogs().slice(fromLog).filter((l) => l.obj?.op === 'exit.monitor.started').length >= 2, { what: 'both positions being armed', maxSteps: 20_000 });
        await settleAntiRugArming(sc, 2);

        const order = [launches[first], launches[second]];
        // Each handler starts in log order.
        expect(linesFor('New pair detected', 'pair', fromLog)).toEqual(order.map((l) => l.pair));
        // Both dedup checks run as today and neither skips: the already-sniped check and the risk
        // gate pass for both tokens (different tokens, room under the open-position limit).
        expect(recordedLogs().slice(fromLog).filter((l) => l.msg === 'Already sniped token, skipping' || l.msg === 'Risk check failed, skipping snipe')).toEqual([]);
        expect(linesFor('All safety checks passed, buying', 'token', fromLog)).toEqual(order.map((l) => l.token));
        // The first-seen token is bought first, at the wallet's next nonce; the second at the one after.
        const buys = walletBuys(sc);
        expect(buys.map((x) => [x.router, x.token])).toEqual(order.map((l) => [l.router, l.token]));
        expect(buys.map((x) => x.nonce)).toEqual([walletNonce, walletNonce + 1]);
        expect(buys.every((x) => node.statusOf(x.hash) === 'mined')).toBe(true);
        // ... recorded first ...
        const tradeInserts = sc.timeline.entries
            .slice(fromTimeline)
            .filter((e) => e.kind === 'db' && e.table === 'trades' && e.op === 'insert')
            .map((e) => (e.kind === 'db' ? getAddress(String(e.row.token)) : ''));
        expect(tradeInserts).toEqual(order.map((l) => l.token));
        // ... and armed first.
        const armed = recordedLogs().slice(fromLog).filter((l) => l.obj?.op === 'exit.monitor.started').map((l) => getAddress(String(l.obj?.token)));
        expect(armed).toEqual(order.map((l) => l.token));
        // Every warn or error line of the two snipes is a known finding's: one false backfill gap
        // per arming on this fresh database, SUSPECT(AUD-ANTIRUG-024).
        const problems = recordedLogs()
            .slice(fromLog)
            .filter((l) => l.level === 'warn' || l.level === 'error' || l.level === 'fatal')
            .map((l) => (typeof l.obj?.op === 'string' ? l.obj.op : (l.msg ?? '')));
        expect(problems.filter((p) => p !== 'antirug.backfill.gap-detected')).toEqual([]);
        expect(node.strays).toEqual([]);
    }, 60_000);
});
