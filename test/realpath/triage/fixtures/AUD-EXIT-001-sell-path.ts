// test/realpath/triage/fixtures/AUD-EXIT-001-sell-path.ts
// Phase 23 plan 23-07 (AUDIT-02): what a real chain answers once the bot SELLS a position, for the
// exit triage files of this plan (AUD-EXIT-001, -004, -003, -015). Lives beside its tests: the
// harness is read-only for triage plans, and the scenario builder answers only the buy side.
//
// installSellPath(sc, { bought }) re-serves three token reads and adds the sell receipts, all
// through the public FakeNode API (setRead, setReceiptLogs), computed only from transactions the
// node really mined (AC-48: nothing a real token or router could not answer):
//   - balanceOf(wallet) = the tokens bought, minus the amountIn of every mined sell. The pair's
//     balance is still the scenario's token reserve. Taken at install time, `bought` freezes the
//     position (the scenario's own read re-prices the buy at the CURRENT reserves, so a test that
//     moves the price would otherwise move the wallet's balance too, which no token does).
//   - allowance(wallet, spender) = replayed from the wallet's mined transactions in nonce order:
//     approve(spender, x) sets it to x, and a mined sell through that spender spends its amountIn
//     (transferFrom), floored at 0. Any other owner has 0.
//   - Sell receipts carry the WETH log the real routers emit and src/utils/receiptDecoder.ts reads:
//     a V2 swapExactTokensForETH(-SupportingFeeOnTransferTokens) a WETH Withdrawal(router, out); a V3
//     multicall/exactInputSingle a WETH Transfer(pool, recipient, out). `out` is the router's own
//     constant-product answer on the scenario reserves (v2AmountOut / v3AmountOut).
// landNextSell() drives the chain the way a block builder and the public pool would: a public
// approve is mined in the next block; a sell bundle is mined one slot after it is sent (the first
// poll of ethers' bundle wait records the head), together with any other bundle transaction from
// the wallet it carries (a fix that bundles the approve with the sell).

import { Interface, Transaction, getAddress, type Result } from 'ethers';
import type { Submitted } from '../../harness/chain';
import { encodeResult } from '../../harness/chain';
import { stepFor, stepUntilTrue, v2AmountOut, v3AmountOut, type Scenario } from '../../harness/world';
import { ERC20, V2_ROUTER, V3_ROUTER } from './AUD-EXIT-002-position';

const WETH9 = new Interface(['event Withdrawal(address indexed src, uint256 wad)', 'event Transfer(address indexed from, address indexed to, uint256 value)']);
const V2_SELLS = ['swapExactTokensForETH', 'swapExactTokensForETHSupportingFeeOnTransferTokens'] as const;
const APPROVE = ERC20.getFunction('approve')!.selector;

export interface DecodedSell {
    hash: string;
    route: Submitted['route'];
    nonce: number;
    to: string;
    /** `swapExactTokensForETH`, `swapExactTokensForETHSupportingFeeOnTransferTokens` or `multicall/exactInputSingle`. */
    call: string;
    amountIn: bigint;
    /** V2 amountOutMin, V3 amountOutMinimum. */
    minOut: bigint;
    tokenIn: string;
    tokenOut: string;
    recipient: string;
}

export interface DecodedApprove {
    hash: string;
    route: Submitted['route'];
    nonce: number;
    token: string;
    spender: string;
    amount: bigint;
    type: number;
    maxFeePerGas: bigint | null;
    maxPriorityFeePerGas: bigint | null;
    gasPrice: bigint | null;
}

/** The sell router of the scenario's DEX: the V2 router or the V3 SwapRouter02. */
export function sellRouterOf(sc: Scenario): string {
    return getAddress(sc.dex.dexType === 'v2' ? sc.dex.routerAddress : sc.dex.swapRouterAddress);
}

/** Decode a raw signed transaction as a sell through `router`, or null when it is not one. */
export function decodeSellRaw(raw: string, router: string): Omit<DecodedSell, 'hash' | 'route'> | null {
    const tx = Transaction.from(raw);
    if (!tx.to || getAddress(tx.to) !== getAddress(router)) return null;
    for (const name of V2_SELLS) {
        if (tx.data.slice(0, 10) !== V2_ROUTER.getFunction(name)!.selector) continue;
        const a = V2_ROUTER.decodeFunctionData(name, tx.data);
        const path = (a[2] as string[]).map((p) => getAddress(p));
        return { nonce: tx.nonce, to: getAddress(tx.to), call: name, amountIn: a[0] as bigint, minOut: a[1] as bigint, tokenIn: path[0], tokenOut: path[path.length - 1], recipient: getAddress(a[3] as string) };
    }
    const outer = (() => {
        try {
            return V3_ROUTER.parseTransaction({ data: tx.data, value: tx.value });
        } catch {
            return null;
        }
    })();
    if (outer?.name === 'multicall') {
        const inner = V3_ROUTER.parseTransaction({ data: (outer.args[1] as string[])[0] });
        if (inner?.name === 'exactInputSingle') {
            const p = inner.args[0] as unknown as Result & { tokenIn: string; tokenOut: string; recipient: string; amountIn: bigint; amountOutMinimum: bigint };
            return { nonce: tx.nonce, to: getAddress(tx.to), call: 'multicall/exactInputSingle', amountIn: p.amountIn, minOut: p.amountOutMinimum, tokenIn: getAddress(p.tokenIn), tokenOut: getAddress(p.tokenOut), recipient: getAddress(p.recipient) };
        }
    }
    return null;
}

/** Every sell the bot's wallet submitted through the scenario's sell router, in submission order. */
export function sellsSubmitted(sc: Scenario): DecodedSell[] {
    const router = sellRouterOf(sc);
    const out: DecodedSell[] = [];
    for (const s of sc.node.submitted) {
        if (s.tx.from?.toLowerCase() !== sc.wallet.address.toLowerCase()) continue;
        const d = decodeSellRaw(s.raw, router);
        if (d) out.push({ hash: s.hash, route: s.route, ...d });
    }
    return out;
}

/** Every approve of the scenario token the bot's wallet submitted, in submission order. */
export function approvalsSubmitted(sc: Scenario): DecodedApprove[] {
    const out: DecodedApprove[] = [];
    for (const s of sc.node.submitted) {
        if (s.tx.from?.toLowerCase() !== sc.wallet.address.toLowerCase()) continue;
        if (!s.tx.to || getAddress(s.tx.to) !== getAddress(sc.token) || s.tx.data.slice(0, 10) !== APPROVE) continue;
        const a = ERC20.decodeFunctionData('approve', s.tx.data);
        out.push({
            hash: s.hash,
            route: s.route,
            nonce: s.tx.nonce,
            token: getAddress(s.tx.to),
            spender: getAddress(a[0] as string),
            amount: a[1] as bigint,
            type: s.tx.type ?? 0,
            maxFeePerGas: s.tx.maxFeePerGas,
            maxPriorityFeePerGas: s.tx.maxPriorityFeePerGas,
            gasPrice: s.tx.gasPrice,
        });
    }
    return out;
}

/** The wallet's mined transactions, in nonce order. */
function minedFromWallet(sc: Scenario): Submitted[] {
    return sc.node.submitted.filter((s) => s.status === 'mined' && s.tx.from?.toLowerCase() === sc.wallet.address.toLowerCase()).sort((a, b) => a.tx.nonce - b.tx.nonce);
}

/** Install the sell-side answers. `bought` is the position the bot's buy received. */
export function installSellPath(sc: Scenario, opts: { bought: bigint }): void {
    const { node, token, pair, weth, reserves } = sc;
    const wallet = sc.wallet.address.toLowerCase();
    const router = sellRouterOf(sc);
    const soldThrough = (spender?: string): bigint =>
        minedFromWallet(sc)
            .map((s) => ({ s, d: decodeSellRaw(s.raw, router) }))
            .filter((x) => x.d !== null && x.d.tokenIn === getAddress(token) && (spender === undefined || getAddress(spender) === router))
            .reduce((a, x) => a + x.d!.amountIn, 0n);

    node.setRead(token, 'balanceOf(address)', ({ args }) => {
        const who = String(args[0]).toLowerCase();
        if (who === pair.toLowerCase()) return encodeResult(['uint256'], [reserves.token]);
        if (who === wallet) {
            const left = opts.bought - soldThrough();
            return encodeResult(['uint256'], [left > 0n ? left : 0n]);
        }
        return encodeResult(['uint256'], [0n]);
    });
    node.setRead(token, 'allowance(address,address)', ({ args }) => {
        if (String(args[0]).toLowerCase() !== wallet) return encodeResult(['uint256'], [0n]);
        const spender = getAddress(String(args[1]));
        let allowance = 0n;
        for (const s of minedFromWallet(sc)) {
            if (s.tx.to && getAddress(s.tx.to) === getAddress(token) && s.tx.data.slice(0, 10) === APPROVE) {
                const a = ERC20.decodeFunctionData('approve', s.tx.data);
                if (getAddress(a[0] as string) === spender) allowance = a[1] as bigint;
                continue;
            }
            const d = decodeSellRaw(s.raw, router);
            if (d && d.tokenIn === getAddress(token) && spender === router) allowance = allowance > d.amountIn ? allowance - d.amountIn : 0n;
        }
        return encodeResult(['uint256'], [allowance]);
    });

    if (sc.dex.dexType === 'v2') {
        for (const name of V2_SELLS) {
            node.setReceiptLogs({ to: router, selector: V2_ROUTER.getFunction(name)!.selector }, (tx) => {
                const d = decodeSellRaw(tx.serialized, router)!;
                const e = WETH9.encodeEventLog('Withdrawal', [router, v2AmountOut(d.amountIn, reserves.token, reserves.weth)]);
                return [{ address: weth, topics: e.topics, data: e.data }];
            });
        }
    } else {
        const fee = sc.feeTier!;
        node.setReceiptLogs({ to: router, selector: V3_ROUTER.getFunction('multicall')!.selector }, (tx) => {
            const d = decodeSellRaw(tx.serialized, router)!;
            const e = WETH9.encodeEventLog('Transfer', [pair, d.recipient, v3AmountOut(d.amountIn, reserves.token, reserves.weth, fee)]);
            return [{ address: weth, topics: e.topics, data: e.data }];
        });
    }
}

/**
 * Wait for the bot's next sell and land it: a public approve that comes first is mined in the next
 * block; a sell bundle is mined one slot later, with any other bundle transaction of the wallet
 * still waiting; a public sell is mined in the next block. `fromSubmit` is the node.submitted index
 * the exit started after (taken before the trigger, since the bot may send its approve while the
 * test is still stepping). Returns the sell and the approvals sent since `fromSubmit`.
 */
export async function landNextSell(sc: Scenario, opts: { fromSubmit: number; maxSteps?: number }): Promise<{ sell: DecodedSell; approvals: DecodedApprove[] }> {
    const { node } = sc;
    const from = opts.fromSubmit;
    const router = sellRouterOf(sc);
    const fresh = (): Submitted[] => node.submitted.slice(from).filter((s) => s.tx.from?.toLowerCase() === sc.wallet.address.toLowerCase());
    const sellOf = (): Submitted | undefined => fresh().find((s) => decodeSellRaw(s.raw, router) !== null);
    for (;;) {
        await stepUntilTrue(() => sellOf() !== undefined || fresh().some((s) => s.route === 'public' && s.status === 'accepted'), { what: 'the bot sending its sell (or an approve first)', maxSteps: opts.maxSteps ?? 20_000 });
        const sell = sellOf();
        if (sell) break;
        // A public transaction (the approve) before the sell: the next block includes it.
        const pending = fresh().filter((s) => s.route === 'public' && s.status === 'accepted').map((s) => s.hash);
        node.mine({ include: pending });
    }
    const sell = sellOf()!;
    if (sell.route === 'public') {
        node.mine({ include: [sell.hash] });
    } else {
        await stepFor(12_000);
        const sameBundle = fresh()
            .filter((s) => s.route === sell.route && s.status === 'accepted')
            .sort((a, b) => a.tx.nonce - b.tx.nonce)
            .map((s) => s.hash);
        node.mine({ include: sameBundle });
    }
    const d = decodeSellRaw(sell.raw, router)!;
    return { sell: { hash: sell.hash, route: sell.route, ...d }, approvals: approvalsSubmitted(sc).filter((a) => node.submitted.findIndex((s) => s.hash === a.hash) >= from) };
}

/**
 * Run the chain for `forMs` of fake time the way the network would answer the bot's exits: every
 * public transaction of the wallet is mined in the next block, and every bundle transaction of the
 * wallet is mined one slot (12 s) after it was first sent, together with the wallet's other
 * bundle transactions still waiting. Returns every sell through the scenario's sell router that
 * the wallet sent since `fromSubmit` and that was mined.
 */
export async function driveExits(sc: Scenario, opts: { fromSubmit: number; forMs: number }): Promise<DecodedSell[]> {
    const { node } = sc;
    const router = sellRouterOf(sc);
    const wallet = sc.wallet.address.toLowerCase();
    const firstSeen = new Map<string, number>();
    const end = Date.now() + opts.forMs;
    while (Date.now() < end) {
        await stepFor(50, 50);
        const waiting = node.submitted.slice(opts.fromSubmit).filter((s) => s.tx.from?.toLowerCase() === wallet && s.status === 'accepted');
        const publicTxs = waiting.filter((s) => s.route === 'public').map((s) => s.hash);
        if (publicTxs.length > 0) node.mine({ include: publicTxs });
        const bundled = waiting.filter((s) => s.route !== 'public');
        for (const s of bundled) if (!firstSeen.has(s.hash)) firstSeen.set(s.hash, Date.now());
        if (bundled.some((s) => Date.now() - firstSeen.get(s.hash)! >= 12_000)) {
            node.mine({ include: bundled.sort((a, b) => a.tx.nonce - b.tx.nonce).map((s) => s.hash) });
        }
    }
    return sellsSubmitted(sc).filter((s) => node.submitted.findIndex((x) => x.hash === s.hash) >= opts.fromSubmit && node.statusOf(s.hash) === 'mined');
}
