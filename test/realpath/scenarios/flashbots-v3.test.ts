// test/realpath/scenarios/flashbots-v3.test.ts
// Phase 23 plan 23-21 (CHAR-02, AC-19 to AC-24): the Flashbots V3 golden-master family. V3 has its
// own buy shape (QuoterV2 quote, SwapRouter02 multicall(deadline, [exactInputSingle]) with the fee
// tier) and its own sells, so the V2 recordings of plan 23-20 do not cover it. Each test is one
// whole-graph scenario on the fake ETH chain (Flashbots is ETH's MEV route): the launch's real
// NonfungiblePositionManager create-and-mint is mined and its real PoolCreated log reaches the real
// V3 listener, the bot finds the same-block Mint (waitForLiquidity), quotes through the real
// QuoterV2 read, buys through a real Flashbots bundle, the exit monitor polls the quoter on the
// fixed fake clock, and one exit type fires and its private V3 sell reaches the relay and is mined.
// runScenario (driver.ts) records the ordered timeline of op logs, submitted transactions, relay
// bodies and DB writes, and compares it byte for byte with test/realpath/recordings/<name>.jsonl. A
// normal run never writes a recording; only `npm run recordings:update` does (AC-25).
//
// The chain answers through the triage fixtures, unchanged: the buy and arming
// (fixtures/AUD-EXIT-002-position.ts), the sell side computed from mined transactions and another
// wallet's real SwapRouter02 trades that move the price (fixtures/AUD-EXIT-001-sell-path.ts, whose
// V3 sell receipt is the WETH Transfer(pool, wallet, out) SwapRouter02 emits) and the anti-rug live
// gates (fixtures/AUD-ANTIRUG-003-live.ts). The V3 liquidity pull is this file's own (pullV3Liquidity
// below): fixtures/AUD-EXIT-014-rug.ts pulls V2 liquidity only. After the trigger the chain moves at
// the network's 12 s cadence (driver.ts driveSlots).
//
// Hold points (AUD-TX-028): nothing here holds a call in flight. No provider read, relay call or
// bundle is parked, so one stalled read on the chain's HTTP provider cannot decide a result. No
// scenario restarts the graph, so AUD-ANTIRUG-025 does not apply.
//
// Every assertComplete proves its exit finished before anything is compared or written: the exit
// reason in the op log, the V3 sell (multicall/exactInputSingle to SwapRouter02) in node.history as
// mined, the receipt the node returns for it decoded with real ethers and equal to the row the bot
// wrote, and the resulting database state.
//
// Tags (AC-21, AC-46) are chosen from what each timeline shows against the register's confirmed
// findings; the SUMMARY of plan 23-21 lists, per scenario, the timeline lines behind each cited ID
// and the confirmed findings checked and ruled out.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Transaction, Wallet, ethers, getAddress } from 'ethers';
import { encodeResult } from '../harness/chain';
import type { Scenario } from '../harness/world';
import { stepFor, stepUntilTrue, v3AmountOut } from '../harness/world';
import { V3_QUOTER, V3_ROUTER, buyAndMine, buyRow, exitStateRow, listen, opEntries, opLogged, waitAntiRugArmed } from '../triage/fixtures/AUD-EXIT-002-position';
import { foreignTrade, installSellPath, sellsSubmitted, type DecodedSell } from '../triage/fixtures/AUD-EXIT-001-sell-path';
import { settleAntiRugArming } from '../triage/fixtures/AUD-TX-002-lock';
import { afterExitPoll, liveGates, liveOverrides } from '../triage/fixtures/AUD-ANTIRUG-003-live';
import { SLOT_MS, driveSlots, runScenario } from './driver';

/** A breaker threshold the one rug's dispatches cannot reach (AUD-ANTIRUG-003 counts each one). */
const ANTIRUG_BREAKER_TRIGGERS = 10;

const WETH_EVENTS = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);

// ---------------------------------------------------------------------------------------------
// The deployer's V3 liquidity pull (the anti-rug scenario). The launch (harness fireNewPool) minted
// one full-range position through the real NonfungiblePositionManager from the deterministic
// deployer key, so the deployer pulls it the way a V3 rug does, in two real NPM calls:
//   1. decreaseLiquidity: NPM calls pool.burn, so the POOL emits Burn(owner = NPM, tickLower,
//      tickUpper, amount, amount0, amount1), then the NPM emits DecreaseLiquidity. The pool's active
//      liquidity falls at once (liquidity() is re-served lower) and the virtual reserves the quoter
//      prices on fall pro rata (the price is unchanged, so no routine exit takes part).
//   2. collect, one slot later and inside the bot's 5-block Burn grace window: the pool sends both
//      tokens to the recipient (token0 and token1 Transfer logs), the POOL emits Collect(owner = NPM,
//      recipient, tickLower, tickUpper, amount0, amount1), then the NPM emits Collect.
// Only the pool's Burn and Collect are logs the anti-rug subscription watches. Everything goes
// through the public FakeNode API (addForeignTransaction, mine with logs, setRead); the harness is
// unchanged.
// ---------------------------------------------------------------------------------------------

/** The real Uniswap V3 NonfungiblePositionManager on Ethereum (the harness launch's target). */
const ETH_V3_POSITION_MANAGER = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
/**
 * The deployer's position NFT. The harness launch emits no NPM Transfer or IncreaseLiquidity, so
 * the id is this file's own label; the bot never reads it (it watches the pool's logs only).
 */
const DEPLOYER_POSITION_ID = 1_000_001n;
/** V3 fee tier to tick spacing (Uniswap V3 factory defaults), for the launch's full-range ticks. */
const TICK_SPACING: Record<number, number> = { 100: 1, 500: 10, 3000: 60, 10000: 200 };
const MAX_UINT128 = (1n << 128n) - 1n;

const NPM = new Interface([
    'function decreaseLiquidity(tuple(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)',
    'function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)',
    'event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
    'event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)',
]);
const POOL = new Interface([
    'function liquidity() view returns (uint128)',
    'event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
    'event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)',
]);
const ERC20_EVENTS = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);

/** The pool's active liquidity as the node answers it (read straight from the node, not via ethers). */
async function poolLiquidity(sc: Scenario<'v3'>): Promise<bigint> {
    const reply = (await sc.node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: sc.pair, data: POOL.encodeFunctionData('liquidity') }, 'latest'] })) as { result?: string; error?: unknown };
    if (typeof reply.result !== 'string') throw new Error(`poolLiquidity: the pool did not answer liquidity(): ${JSON.stringify(reply.error)}`);
    return POOL.decodeFunctionResult('liquidity', reply.result)[0] as bigint;
}

interface V3Pull {
    deployer: Wallet;
    tickLower: number;
    tickUpper: number;
    amount0: bigint;
    amount1: bigint;
    burnBlock: number;
    liquidityBefore: bigint;
    liquidityAfter: bigint;
}

async function signDeployer(sc: Scenario<'v3'>, deployer: Wallet, data: string): Promise<string> {
    return deployer.signTransaction({
        chainId: sc.node.chainId, nonce: sc.node.minedCount(deployer.address), to: ETH_V3_POSITION_MANAGER, value: 0n, gasLimit: 300_000n, type: 2,
        maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, data,
    });
}

/** Step 1: the deployer decreases `removeBps` (of 10000) of the pool's liquidity; the pool emits Burn. */
async function burnV3Liquidity(sc: Scenario<'v3'>, opts: { removeBps: bigint }): Promise<V3Pull> {
    const { node, reserves, pair, token, weth } = sc;
    const deployer = new Wallet(ethers.id(`realpath.deployer.${sc.chain}`));
    if (node.minedCount(deployer.address) < 1) throw new Error('burnV3Liquidity: the deployer never launched the pool (fire the launch first)');
    const tickBound = Math.floor(887272 / TICK_SPACING[sc.feeTier!]) * TICK_SPACING[sc.feeTier!];
    const liquidityBefore = await poolLiquidity(sc);
    const burned = (liquidityBefore * opts.removeBps) / 10_000n;
    const outWeth = (reserves.weth * burned) / liquidityBefore;
    const outToken = (reserves.token * burned) / liquidityBefore;
    const wethIs0 = weth.toLowerCase() < token.toLowerCase();
    const [amount0, amount1] = wethIs0 ? [outWeth, outToken] : [outToken, outWeth];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const raw = await signDeployer(sc, deployer, NPM.encodeFunctionData('decreaseLiquidity', [[DEPLOYER_POSITION_ID, burned, 0n, 0n, deadline]]));
    const hash = node.addForeignTransaction(raw);
    reserves.weth -= outWeth;
    reserves.token -= outToken;
    const liquidityAfter = liquidityBefore - burned;
    node.setRead(pair, 'liquidity()', encodeResult(['uint128'], [liquidityAfter]));
    const burn = POOL.encodeEventLog('Burn', [ETH_V3_POSITION_MANAGER, -tickBound, tickBound, burned, amount0, amount1]);
    const decreased = NPM.encodeEventLog('DecreaseLiquidity', [DEPLOYER_POSITION_ID, burned, amount0, amount1]);
    const burnBlock = node.mine({
        include: [hash],
        logs: [
            { address: pair, topics: burn.topics, data: burn.data, transactionHash: hash },
            { address: ETH_V3_POSITION_MANAGER, topics: decreased.topics, data: decreased.data, transactionHash: hash },
        ],
    });
    return { deployer, tickLower: -tickBound, tickUpper: tickBound, amount0, amount1, burnBlock, liquidityBefore, liquidityAfter };
}

/** Step 2: the deployer collects the burned amounts to itself; the pool emits Collect. Returns its block. */
async function collectV3Liquidity(sc: Scenario<'v3'>, pull: V3Pull): Promise<number> {
    const { node, pair, token, weth } = sc;
    const recipient = pull.deployer.address;
    const raw = await signDeployer(sc, pull.deployer, NPM.encodeFunctionData('collect', [[DEPLOYER_POSITION_ID, recipient, MAX_UINT128, MAX_UINT128]]));
    const hash = node.addForeignTransaction(raw);
    const [token0, token1] = weth.toLowerCase() < token.toLowerCase() ? [weth, token] : [token, weth];
    const sent0 = ERC20_EVENTS.encodeEventLog('Transfer', [pair, recipient, pull.amount0]);
    const sent1 = ERC20_EVENTS.encodeEventLog('Transfer', [pair, recipient, pull.amount1]);
    const collected = POOL.encodeEventLog('Collect', [ETH_V3_POSITION_MANAGER, recipient, pull.tickLower, pull.tickUpper, pull.amount0, pull.amount1]);
    const npmCollected = NPM.encodeEventLog('Collect', [DEPLOYER_POSITION_ID, recipient, pull.amount0, pull.amount1]);
    return node.mine({
        include: [hash],
        logs: [
            { address: token0, topics: sent0.topics, data: sent0.data, transactionHash: hash },
            { address: token1, topics: sent1.topics, data: sent1.data, transactionHash: hash },
            { address: pair, topics: collected.topics, data: collected.data, transactionHash: hash },
            { address: ETH_V3_POSITION_MANAGER, topics: npmCollected.topics, data: npmCollected.data, transactionHash: hash },
        ],
    });
}

interface Held {
    tradeId: number;
    bought: bigint;
}

/**
 * The real V3 snipe, bought through its Flashbots bundle and armed (exit monitor and anti-rug).
 * Also proves the V3 buy shape: the QuoterV2 buy quote (WETH in) came before the buy, and the buy
 * is SwapRouter02 multicall(deadline, [exactInputSingle(WETH -> token, the scenario fee tier, the
 * wallet)]) carrying the snipe amount as value.
 */
async function buyAndArm(sc: Scenario<'v3'>): Promise<Held> {
    await listen(sc);
    const { buy } = await buyAndMine(sc);
    await waitAntiRugArmed(sc);
    expect(opLogged('exit.monitor.started')).toBe(true);
    const tx = Transaction.from(buy.raw);
    expect(getAddress(tx.to!)).toBe(getAddress(sc.dex.swapRouterAddress));
    const outer = V3_ROUTER.parseTransaction({ data: tx.data, value: tx.value })!;
    expect(outer.name).toBe('multicall');
    const inner = (outer.args[1] as string[]).map((d) => V3_ROUTER.parseTransaction({ data: d })!);
    expect(inner.map((c) => c.name)).toEqual(['exactInputSingle']);
    const p = inner[0].args[0] as unknown as { tokenIn: string; tokenOut: string; fee: bigint; recipient: string; amountIn: bigint };
    expect([getAddress(p.tokenIn), getAddress(p.tokenOut), Number(p.fee), getAddress(p.recipient), p.amountIn]).toEqual([
        getAddress(sc.weth), getAddress(sc.token), sc.feeTier, getAddress(sc.wallet.address), tx.value,
    ]);
    const buyQuotes = sc.node.callLog.filter((c) => {
        if (c.method !== 'eth_call' || !c.data || !c.to || getAddress(c.to) !== getAddress(sc.dex.quoterAddress)) return false;
        const q = V3_QUOTER.decodeFunctionData('quoteExactInputSingle', c.data)[0] as unknown as { tokenIn: string; tokenOut: string; fee: bigint };
        return getAddress(q.tokenIn) === getAddress(sc.weth) && getAddress(q.tokenOut) === getAddress(sc.token) && Number(q.fee) === sc.feeTier;
    });
    expect(buyQuotes.length).toBeGreaterThanOrEqual(1);
    const bought = v3AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token, sc.feeTier!);
    installSellPath(sc, { bought });
    const row = buyRow(sc);
    expect(row).toEqual(expect.objectContaining({ status: 'pending', pool_type: 'v3', fee_tier: sc.feeTier, dex_name: sc.dex.name }));
    return { tradeId: row!.id, bought };
}

interface TradeRowFull {
    tx_hash: string;
    amount_in: string;
    amount_out: string | null;
    price_at_action: string | null;
    status: string;
    pool_type: string;
    fee_tier: number | null;
}

/** The scenario token's trades rows of one action. */
function rowsOf(sc: Scenario<'v3'>, action: 'buy' | 'sell' | 'partial_sell'): TradeRowFull[] {
    return sc.graph.db
        .prepare('SELECT tx_hash, amount_in, amount_out, price_at_action, status, pool_type, fee_tier FROM trades WHERE token = ? AND chain = ? AND action = ? ORDER BY id')
        .all(sc.token.toLowerCase(), sc.chain, action) as TradeRowFull[];
}

/** The position is closed: the buy row sold and its exit_state row gone. */
function closed(sc: Scenario<'v3'>, held: Held): boolean {
    return rowsOf(sc, 'buy')[0]?.status === 'sold' && exitStateRow(sc, held.tradeId) === undefined;
}

/** The one sell the wallet sent through SwapRouter02 since `fromSubmit`. */
function onlySell(sc: Scenario<'v3'>, fromSubmit: number): DecodedSell {
    const sells = sellsSubmitted(sc).filter((s) => sc.node.submitted.findIndex((x) => x.hash === s.hash) >= fromSubmit);
    expect(sells).toHaveLength(1);
    return sells[0];
}

/**
 * The WETH SwapRouter02 paid the wallet for `hash`, read from the receipt the node returns for it
 * and decoded with real ethers (the WETH Transfer(pool, wallet) log the bot's receipt decoder reads).
 */
async function receiptWethOut(sc: Scenario<'v3'>, hash: string): Promise<bigint> {
    const reply = (await sc.node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] })) as {
        result?: { status: string; logs: Array<{ address: string; topics: string[]; data: string }> } | null;
    };
    const receipt = reply.result;
    expect(receipt, `the node has a receipt for ${hash}`).toBeTruthy();
    expect(receipt!.status).toBe('0x1');
    const outs = receipt!.logs
        .filter((l) => getAddress(l.address) === getAddress(sc.weth))
        .map((l) => WETH_EVENTS.parseLog(l))
        .filter((p) => p?.name === 'Transfer' && getAddress(p.args.from as string) === getAddress(sc.pair) && getAddress(p.args.to as string) === getAddress(sc.wallet.address))
        .map((p) => p!.args.value as bigint);
    expect(outs).toHaveLength(1);
    return outs[0];
}

/** The private V3 sell, mined: route, node status, its history event and its decoded call. */
function assertMinedPrivateSell(sc: Scenario<'v3'>, sell: DecodedSell, amountIn: bigint): void {
    expect(sell.route).toBe('bundle');
    expect(sc.node.statusOf(sell.hash)).toBe('mined');
    expect(sc.node.history.some((h) => h.event === 'mined' && h.hash === sell.hash)).toBe(true);
    expect(sell.call).toBe('multicall/exactInputSingle');
    expect(sell.to).toBe(getAddress(sc.dex.swapRouterAddress));
    expect(sell.tokenIn).toBe(getAddress(sc.token));
    expect(sell.tokenOut).toBe(getAddress(sc.weth));
    expect(sell.recipient).toBe(getAddress(sc.wallet.address));
    expect(sell.amountIn).toBe(amountIn);
}

/** The completion proof every full exit shares (see each test's assertComplete). */
async function assertFullExitComplete(sc: Scenario<'v3'>, held: Held, sell: DecodedSell, trigger: string, reason: string): Promise<void> {
    expect(opEntries(trigger).length).toBeGreaterThanOrEqual(1);
    assertMinedPrivateSell(sc, sell, held.bought);
    expect(opEntries('exit.full.executed').map((e) => [e.reason, e.txHash])).toEqual([[reason, sell.hash]]);
    // A real decoded receipt: the bot's decoder and the node's receipt agree on the WETH paid out.
    const out = await receiptWethOut(sc, sell.hash);
    const decoded = opEntries('exit.receipt.decoded').filter((e) => e.txHash === sell.hash);
    expect(decoded.map((e) => e.amountOut)).toEqual([out.toString()]);
    // The database: a V3 sell row carrying that hash and receipt, the buy row sold, exit_state gone.
    const sold = rowsOf(sc, 'sell');
    expect(sold).toEqual([expect.objectContaining({ tx_hash: sell.hash, amount_in: held.bought.toString(), amount_out: out.toString(), status: 'sold', pool_type: 'v3', fee_tier: sc.feeTier })]);
    expect(rowsOf(sc, 'buy')[0].status).toBe('sold');
    expect(exitStateRow(sc, held.tradeId)).toBeUndefined();
}

describe('golden master: Flashbots V3 buys with each exit type (CHAR-02)', () => {
    it('flashbots-v3-trailing: a V3 Flashbots buy rises past 2x, falls back past the trailing stop, and the private V3 sell is mined', async () => {
        let held!: Held;
        let sell!: DecodedSell;
        await runScenario({
            name: 'flashbots-v3-trailing',
            tag: 'SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-027,AUD-TX-012)',
            chain: 'eth',
            dexType: 'v3',
            async steps(sc) {
                held = await buyAndArm(sc);
                // Another wallet buys through SwapRouter02 with half the pool's ETH: the price about
                // 2.25x, so a poll activates the trailing stop (no partial tiers: PARTIAL_SELL_TARGETS
                // is empty).
                await foreignTrade(sc, { buyEth: sc.reserves.weth / 2n });
                await stepUntilTrue(() => opLogged('exit.trailing.activated'), { what: 'the trailing stop activating', maxSteps: 2_000 });
                // Then it dumps half the pool's tokens: about 56 percent below the peak, past the
                // 15 percent trailing stop.
                const fromSubmit = sc.node.submitted.length;
                await foreignTrade(sc, { sellTokens: sc.reserves.token / 2n });
                // The network's 12 s cadence mines the bot's approve, then its sell bundle at a
                // block the bundle targets.
                await driveSlots(sc, { until: () => closed(sc, held), what: 'the trailing-stop exit closing the position' });
                sell = onlySell(sc, fromSubmit);
                await settleAntiRugArming(sc, 1);
            },
            async assertComplete(sc) {
                await assertFullExitComplete(sc, held, sell, 'exit.trigger.trailing-stop', 'trailing-stop');
                expect(opLogged('exit.trigger.stop-loss')).toBe(false);
            },
        });
    });

    it('flashbots-v3-partial: a V3 Flashbots buy crosses the 2x partial tier, and the private V3 partial sell of a quarter is mined', async () => {
        let held!: Held;
        let sell!: DecodedSell;
        await runScenario({
            name: 'flashbots-v3-partial',
            tag: 'SUSPECT(AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-025,AUD-EXIT-027,AUD-TX-012)',
            chain: 'eth',
            dexType: 'v3',
            overrides: { PARTIAL_SELL_TARGETS: '2x:25' },
            async steps(sc) {
                held = await buyAndArm(sc);
                // Another wallet buys with half the pool's ETH: the price about 2.25x, past the 2x tier.
                const fromSubmit = sc.node.submitted.length;
                await foreignTrade(sc, { buyEth: sc.reserves.weth / 2n });
                await driveSlots(sc, {
                    until: () => opLogged('exit.partial.dispatched.completed') && rowsOf(sc, 'partial_sell').length === 1,
                    what: 'the partial sell confirming and its tier being persisted',
                });
                sell = onlySell(sc, fromSubmit);
            },
            async assertComplete(sc) {
                const quarter = (held.bought * 25n) / 100n;
                expect(opEntries('exit.partial.submitted').map((e) => e.tiers)).toEqual(['2x:25%']);
                expect(opEntries('exit.partial.executed').map((e) => e.txHash)).toEqual([sell.hash]);
                assertMinedPrivateSell(sc, sell, quarter);
                // The partial-sell row carries the receipt the node returns for the sell.
                const out = await receiptWethOut(sc, sell.hash);
                const partial = rowsOf(sc, 'partial_sell');
                expect(partial).toEqual([expect.objectContaining({ tx_hash: sell.hash, amount_in: quarter.toString(), amount_out: out.toString(), status: 'sold', pool_type: 'v3', fee_tier: sc.feeTier })]);
                // The position stays open with its tier recorded; no full exit fired.
                expect(rowsOf(sc, 'buy')[0].status).toBe('pending');
                const st = sc.graph.db.prepare('SELECT partial_tiers_completed FROM exit_state WHERE trade_id = ?').get(held.tradeId) as { partial_tiers_completed: string } | undefined;
                expect(st?.partial_tiers_completed).toBe('[0]');
                expect(rowsOf(sc, 'sell')).toEqual([]);
                for (const op of ['exit.trigger.trailing-stop', 'exit.trigger.stop-loss', 'exit.trigger.urgency']) expect(opLogged(op)).toBe(false);
            },
        });
    });

    it('flashbots-v3-stop-loss: a V3 Flashbots buy falls about 41 percent, past the 25 percent stop-loss, and the private V3 sell is mined', async () => {
        let held!: Held;
        let sell!: DecodedSell;
        await runScenario({
            name: 'flashbots-v3-stop-loss',
            tag: 'SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-027,AUD-TX-012)',
            chain: 'eth',
            dexType: 'v3',
            async steps(sc) {
                held = await buyAndArm(sc);
                // Another wallet dumps 30 percent of the pool's tokens through SwapRouter02: the price
                // falls about 41 percent.
                const fromSubmit = sc.node.submitted.length;
                await foreignTrade(sc, { sellTokens: (sc.reserves.token * 3n) / 10n });
                await driveSlots(sc, { until: () => closed(sc, held), what: 'the stop-loss exit closing the position' });
                sell = onlySell(sc, fromSubmit);
                await settleAntiRugArming(sc, 1);
            },
            async assertComplete(sc) {
                await assertFullExitComplete(sc, held, sell, 'exit.trigger.stop-loss', 'stop-loss');
                expect(opLogged('exit.trailing.activated')).toBe(false);
                expect(opLogged('exit.trigger.trailing-stop')).toBe(false);
            },
        });
    });

    it('flashbots-v3-urgency: a V3 Flashbots buy whose price never moves is sold by the urgency exit once the 30-minute window passes', async () => {
        let held!: Held;
        let sell!: DecodedSell;
        await runScenario({
            name: 'flashbots-v3-urgency',
            tag: 'SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-027,AUD-TX-012)',
            chain: 'eth',
            dexType: 'v3',
            async steps(sc) {
                held = await buyAndArm(sc);
                expect(sc.graph.exitEngine.exitConfig.urgencyWindowMs).toBe(30 * 60_000);
                const fromSubmit = sc.node.submitted.length;
                // The quiet window: a block every 12 s, 1 s steps, until the urgency exit fires.
                const lastBlockAt = await driveSlots(sc, { until: () => opLogged('exit.trigger.urgency'), what: 'the urgency exit firing', maxVirtualMs: 40 * 60_000, stepMs: 1_000 });
                // Then the exit itself at the normal step.
                await driveSlots(sc, { until: () => closed(sc, held), what: 'the urgency exit closing the position', lastBlockAt });
                sell = onlySell(sc, fromSubmit);
                await settleAntiRugArming(sc, 1);
            },
            async assertComplete(sc) {
                await assertFullExitComplete(sc, held, sell, 'exit.trigger.urgency', 'urgency-market-sell');
                // One monitor; it fired only after the quiet window (no price move at all).
                expect(opEntries('exit.monitor.started')).toHaveLength(1);
                for (const op of ['exit.trailing.activated', 'exit.trigger.trailing-stop', 'exit.trigger.stop-loss']) expect(opLogged(op)).toBe(false);
            },
        });
    });

    it('flashbots-v3-anti-rug: with live anti-rug, a V3 Burn is held in its grace window, the Collect to an address outside the allowlist trips all three signals, the confirm block passes, and the anti-rug private V3 sell is mined', async () => {
        let held!: Held;
        let sell!: DecodedSell;
        let pull!: V3Pull;
        let collectBlock = 0;
        let quoteBefore = 0n;
        let quoteAfter = 0n;
        await runScenario({
            name: 'flashbots-v3-anti-rug',
            tag: 'SUSPECT(AUD-ANTIRUG-015,AUD-ANTIRUG-024,AUD-BUY-033,AUD-DB-002,AUD-DB-004,AUD-EXIT-001,AUD-EXIT-003,AUD-EXIT-004,AUD-EXIT-027,AUD-TX-012)',
            chain: 'eth',
            dexType: 'v3',
            // Live execution, one confirm block, and a breaker threshold the rug cannot reach, set
            // before the graph loads (fixtures/AUD-ANTIRUG-003-live.ts). test/.env.test sets
            // ETH_ANTIRUG_LIVE_EXECUTE=false, where triggerAntiRugExit logs
            // antirug.dry-run.would-have-sold and returns before any sell.
            overrides: liveOverrides(ANTIRUG_BREAKER_TRIGGERS),
            async steps(sc) {
                liveGates(sc, ANTIRUG_BREAKER_TRIGGERS);
                held = await buyAndArm(sc);
                // Right after an exit poll, the deployer burns 99.9 percent of the pool's liquidity:
                // the pool's Burn reaches the anti-rug subscription, which holds it in the V3 grace
                // window (5 blocks) pending a Collect. The pull is that deep so each signal trips on
                // its real reason: what the held tokens would fetch falls to about a third of what
                // they fetched before (a 95 percent pull leaves it near 96 percent, and signal 3 then
                // trips only through AUD-ANTIRUG-006's unit mix-up, which would make this recording
                // depend on that bug).
                await afterExitPoll(sc);
                quoteBefore = v3AmountOut(held.bought, sc.reserves.token, sc.reserves.weth, sc.feeTier!);
                const fromSubmit = sc.node.submitted.length;
                pull = await burnV3Liquidity(sc, { removeBps: 9_990n });
                quoteAfter = v3AmountOut(held.bought, sc.reserves.token, sc.reserves.weth, sc.feeTier!);
                await stepUntilTrue(() => opLogged('antirug.v3-burn-grace-window'), { what: 'the V3 Burn being held in its grace window', maxSteps: 2_000 });
                // One slot later, inside the grace window, the deployer collects to itself: the
                // Collect's owner (the position manager) is not in the ETH V3 allowlist, active
                // liquidity is 99.9 percent below the baseline, and the quote of the held tokens is
                // below half its value before the pull.
                await stepFor(SLOT_MS, 50);
                collectBlock = await collectV3Liquidity(sc, pull);
                await stepUntilTrue(() => opLogged('antirug.confirm-gate.scheduled'), { what: 'the anti-rug confirm gate being scheduled', maxSteps: 2_000 });
                // The next block is the confirm block; then the exit runs at the network's cadence.
                await driveSlots(sc, { until: () => closed(sc, held), what: 'the anti-rug exit closing the position' });
                sell = onlySell(sc, fromSubmit);
                await settleAntiRugArming(sc, 1);
            },
            async assertComplete(sc) {
                // The grace-window path: the Burn was held, then paired with the Collect inside it.
                const grace = opEntries('antirug.v3-burn-grace-window');
                expect(grace.map((e) => [e.burnBlock, e.timeoutBlock])).toEqual([[pull.burnBlock, pull.burnBlock + 5]]);
                expect(collectBlock).toBeLessThan(pull.burnBlock + 5);
                expect(opEntries('antirug.v3-burn-collect-paired').map((e) => [e.burnBlock, e.collectBlock])).toEqual([[pull.burnBlock, collectBlock]]);
                // Signal 1 and the real signal 3: active liquidity below half the baseline, and what
                // the held tokens fetch (the QuoterV2 read on the pool's virtual reserves) below half
                // of what they fetched before the pull.
                expect(pull.liquidityAfter * 100n).toBeLessThan(pull.liquidityBefore * 50n);
                expect(quoteAfter * 2n).toBeLessThan(quoteBefore);
                // Live dispatch, no dry run, breaker untripped.
                expect(opLogged('antirug.exit.dispatch')).toBe(true);
                expect(opLogged('antirug.dry-run.would-have-sold')).toBe(false);
                expect(opLogged('antirug.cb-tripped')).toBe(false);
                await assertFullExitComplete(sc, held, sell, 'antirug.exit.dispatch', 'anti-rug');
                for (const op of ['exit.trigger.trailing-stop', 'exit.trigger.stop-loss', 'exit.trigger.urgency']) expect(opLogged(op)).toBe(false);
            },
        });
    });
});
