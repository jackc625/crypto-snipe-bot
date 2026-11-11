// test/realpath/triage/fixtures/AUD-EXIT-002-position.ts
// Phase 23 plan 23-07 (AUDIT-02): helpers shared by the exit-monitor triage files of this plan
// (AUD-EXIT-002, -013, -015, -003, -001, -004). They drive the real snipe the way the AC-01 path
// does and read what the bot did from the node's call log, the real database and the logs. They
// add no behavior to the simulated node: every answer still comes from the scenario's reads (or
// from a read a test sets itself through the public FakeNode API). Nothing here mocks anything.

import { Interface, getAddress } from 'ethers';
import type { Submitted } from '../../harness/chain';
import { recordedLogs } from '../../harness/capture';
import { stepFor, stepUntilTrue, type Scenario } from '../../harness/world';

export const V2_ROUTER = new Interface([
    'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
    'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
    'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
    'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
]);
export const V3_QUOTER = new Interface([
    'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);
export const V3_ROUTER = new Interface([
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
    'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
]);
export const ERC20 = new Interface([
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
]);

export const GET_AMOUNTS_OUT = V2_ROUTER.getFunction('getAmountsOut')!.selector;
export const QUOTE_EXACT_INPUT_SINGLE = V3_QUOTER.getFunction('quoteExactInputSingle')!.selector;

export function opLogged(op: string, from = 0): boolean {
    return recordedLogs().slice(from).some((l) => l.obj?.op === op);
}

export function opEntries(op: string, from = 0): Array<Record<string, unknown>> {
    return recordedLogs()
        .slice(from)
        .filter((l) => l.obj?.op === op)
        .map((l) => l.obj!);
}

export function msgLogged(msg: string, from = 0): boolean {
    return recordedLogs().slice(from).some((l) => l.msg === msg);
}

export function subscribedTo(sc: Scenario, address: string): boolean {
    return sc.node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(address.toLowerCase()));
}

/** Start the real listener for the scenario's DEX and wait for its factory subscription. */
export async function listen(sc: Scenario): Promise<void> {
    await sc.graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
    await stepUntilTrue(() => subscribedTo(sc, sc.dex.factoryAddress), { what: 'the listener subscribing to the factory' });
}

/**
 * Launch the scenario's pair or pool through the real listener and let the bot's buy bundle land
 * at its first target block (the AC-01 path). `beforeMine` runs once the buy is submitted and
 * before it is mined, so a test can arm a fault that must wait for the mined buy.
 */
export async function buyAndMine(sc: Scenario, opts: { beforeMine?: (buy: Submitted) => void } = {}): Promise<{ buy: Submitted; launchBlock: number }> {
    const { node } = sc;
    const launch = sc.dex.dexType === 'v2' ? await sc.fireNewPair() : await sc.fireNewPool();
    await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting its buy' });
    const buy = node.submitted[0];
    opts.beforeMine?.(buy);
    // The first poll of ethers' bundle wait records the head; one slot later the bundle is mined.
    await stepFor(12_000);
    node.mine({ include: [buy.hash] });
    return { buy, launchBlock: launch.block };
}

function cursor(sc: Scenario): number | undefined {
    return (sc.graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get(sc.chain) as { b: number } | undefined)?.b;
}

/**
 * Wait until the bought position's anti-rug arming finished: the subscription covers the pair and
 * the backfill wrote its cursor at or past the head seen when the wait began (the buy's block).
 * armPositionMonitoring runs it after startExitMonitor returns, whether or not an exit monitor
 * started, so this wait holds under the bug and a fix. Meanwhile any public transaction of the
 * bot's wallet is mined in the next block, as the network would (today's arming sends none; a fix
 * that approves at buy time does; the cursor may then trail the head by the block ethers' 250 ms
 * request cache answered, which plan 23-05 recorded as benign).
 */
export async function waitAntiRugArmed(sc: Scenario): Promise<void> {
    const wallet = sc.wallet.address.toLowerCase();
    const atStart = sc.node.head;
    await stepUntilTrue(
        () => {
            const pending = sc.node.submitted.filter((s) => s.route === 'public' && s.status === 'accepted' && s.tx.from?.toLowerCase() === wallet).map((s) => s.hash);
            if (pending.length > 0) sc.node.mine({ include: pending });
            const c = cursor(sc);
            return subscribedTo(sc, sc.pair) && c !== undefined && c >= atStart;
        },
        { what: 'the anti-rug arming of the bought position', maxSteps: 20_000 },
    );
}

export interface TradeRow {
    id: number;
    status: string;
    dex_name: string | null;
    pool_type: string;
    fee_tier: number | null;
    amount_in: string;
}

export function buyRow(sc: Scenario): TradeRow | undefined {
    return sc.graph.db
        .prepare("SELECT id, status, dex_name, pool_type, fee_tier, amount_in FROM trades WHERE token = ? AND chain = ? AND action = 'buy'")
        .get(sc.token.toLowerCase(), sc.chain) as TradeRow | undefined;
}

export interface ExitStateRow {
    trade_id: number;
    entry_price: number;
    high_water_mark: number;
    original_token_amount: string;
    urgency_start_ts: number;
}

export function exitStateRow(sc: Scenario, tradeId: number): ExitStateRow | undefined {
    return sc.graph.db.prepare('SELECT trade_id, entry_price, high_water_mark, original_token_amount, urgency_start_ts FROM exit_state WHERE trade_id = ?').get(tradeId) as
        | ExitStateRow
        | undefined;
}

export interface QuoteCall {
    seq: number;
    to: string;
    amountIn: bigint;
    tokenIn: string;
    tokenOut: string;
}

/**
 * Every exit-direction price quote (token in, WETH out) the bot sent to the node since `fromCall`,
 * decoded from the eth_call data with real ethers: V2 getAmountsOut(amountIn, [token, WETH]) on a
 * router, V3 quoteExactInputSingle on a quoter. Buy-direction quotes (WETH in) are left out.
 */
export function exitQuotes(sc: Scenario, fromCall = 0): QuoteCall[] {
    const out: QuoteCall[] = [];
    for (const c of sc.node.callLog.slice(fromCall)) {
        if (c.method !== 'eth_call' || !c.data || !c.to) continue;
        if (c.selector === GET_AMOUNTS_OUT) {
            const args = V2_ROUTER.decodeFunctionData('getAmountsOut', c.data);
            const path = (args[1] as string[]).map((a) => getAddress(a));
            if (path.length !== 2 || path[0] !== getAddress(sc.token)) continue;
            out.push({ seq: c.seq, to: getAddress(c.to), amountIn: args[0] as bigint, tokenIn: path[0], tokenOut: path[1] });
        } else if (c.selector === QUOTE_EXACT_INPUT_SINGLE) {
            const p = V3_QUOTER.decodeFunctionData('quoteExactInputSingle', c.data)[0] as unknown as { tokenIn: string; tokenOut: string; amountIn: bigint };
            if (getAddress(p.tokenIn) !== getAddress(sc.token)) continue;
            out.push({ seq: c.seq, to: getAddress(c.to), amountIn: p.amountIn, tokenIn: getAddress(p.tokenIn), tokenOut: getAddress(p.tokenOut) });
        }
    }
    return out;
}
