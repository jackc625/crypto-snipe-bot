// test/realpath/triage/AUD-EXIT-027.test.ts
// Phase 23 plan 23-07 (found while proving AUD-EXIT-001; AUDIT-02): AUD-EXIT-027. A V3 exit leaves
// its proceeds as WETH in the wallet and nothing ever unwraps them, while the bot buys, pays gas
// and checks its wallet floor in native ETH only.
//
// The sites: src/exitEngine.ts buildV3SellTx encodes multicall(deadline, [exactInputSingle(tokenIn
// = token, tokenOut = WETH, recipient = the wallet, ...)]) with no unwrapWETH9 in the batch, so
// SwapRouter02 pays WETH to the wallet; src/utils/receiptDecoder.ts reads that WETH Transfer as the
// sell's proceeds ("WETH sent directly without unwrap"). No code in src/ or scripts/ calls WETH
// withdraw or unwrapWETH9. src/preflight.ts checkWalletBalance and the entry gate read
// httpProvider.getBalance (native ETH only), and every buy sends native ETH as value.
//
// Proof on the real path: a real ETH V3 snipe is bought and armed; another wallet dumps 30 percent
// of the pool's tokens and the real poll loop fires the stop-loss; the bot's approve is mined and
// its private sell bundle lands (the chain answers as fixtures/AUD-EXIT-001-sell-path.ts
// describes). The sell is decoded with real ethers, and the wallet's transactions after it are
// read from the node for one minute of fake time.
//
// What is measured: whether the exit turns its proceeds into native ETH, either inside the batch
// (exactInputSingle to the router, then unwrapWETH9 to the wallet) or with a later WETH withdraw
// from the wallet. Correct: it does. Today: neither. Either fix shape reads "looks fixed" (D-08).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Transaction, getAddress } from 'ethers';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, v3AmountOut } from '../harness/world';
import { buyAndMine, buyRow, listen, opLogged, waitAntiRugArmed } from './fixtures/AUD-EXIT-002-position';
import { foreignTrade, installSellPath, landNextSell } from './fixtures/AUD-EXIT-001-sell-path';

const SWAP_ROUTER_02 = new Interface([
    'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
    'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
    'function unwrapWETH9(uint256 amountMinimum) payable',
]);
const WETH9 = new Interface(['function withdraw(uint256 wad)']);

describe('AUD-EXIT-027: a V3 exit leaves its proceeds as WETH that the bot never unwraps', () => {
    it('v3-exit-proceeds-stay-weth: the V3 stop-loss sell pays WETH to the wallet with no unwrap in the batch and no later WETH withdraw', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v3' });
        const { node } = sc;
        await listen(sc);
        const { buy } = await buyAndMine(sc);
        await waitAntiRugArmed(sc);
        expect(opLogged('exit.monitor.started')).toBe(true);
        const bought = v3AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token, sc.feeTier!);
        installSellPath(sc, { bought });
        const fromSubmit = node.submitted.length;
        await foreignTrade(sc, { sellTokens: (sc.reserves.token * 3n) / 10n });
        const { sell } = await landNextSell(sc, { fromSubmit });
        await stepUntilTrue(() => buyRow(sc)!.status === 'sold', { what: 'the position closing', maxSteps: 20_000 });
        // One minute more: any follow-up the bot sends to turn WETH into ETH would be in it.
        await stepFor(60_000, 50);

        // Setup facts, true under the bug and either fix: the whole position sold through SwapRouter02.
        expect(sell).toEqual(expect.objectContaining({ to: getAddress(sc.dex.swapRouterAddress), amountIn: bought, tokenIn: getAddress(sc.token), tokenOut: getAddress(sc.weth) }));
        const raw = node.submitted.find((s) => s.hash === sell.hash)!.raw;
        const outer = SWAP_ROUTER_02.parseTransaction({ data: Transaction.from(raw).data })!;
        const inner = (outer.args[1] as string[]).map((d) => SWAP_ROUTER_02.parseTransaction({ data: d })!);
        const unwrapInBatch = inner.some((c) => c.name === 'unwrapWETH9');
        const sellIndex = node.submitted.findIndex((s) => s.hash === sell.hash);
        const withdrawAfter = node.submitted
            .slice(sellIndex + 1)
            .some((s) => s.tx.from?.toLowerCase() === sc.wallet.address.toLowerCase() && s.tx.to && getAddress(s.tx.to) === getAddress(sc.weth) && s.tx.data.slice(0, 10) === WETH9.getFunction('withdraw')!.selector);

        knownBug(ctx, 'AUD-EXIT-027', {
            claim: 'v3-exit-proceeds-stay-weth',
            correct: { proceedsTurnedIntoEth: true },
            observed: { proceedsTurnedIntoEth: false },
            actual: { proceedsTurnedIntoEth: unwrapInBatch || withdrawAfter },
            expectedPlain: 'A V3 exit turns its proceeds into native ETH (unwrap in the same batch, or a WETH withdraw after), the currency the bot buys with, pays gas with and checks its wallet floor in.',
            actualPlain: 'The V3 stop-loss sell paid its proceeds to the wallet as WETH, with no unwrap in the batch and no WETH withdraw afterwards, so the bot\'s native ETH balance never gets the money back.',
        });
        // Bug details: one inner call, exactInputSingle paying WETH straight to the wallet.
        expect(inner.map((c) => c.name)).toEqual(['exactInputSingle']);
        const p = inner[0].args[0] as unknown as { recipient: string; tokenOut: string };
        expect(getAddress(p.recipient)).toBe(getAddress(sc.wallet.address));
        expect(getAddress(p.tokenOut)).toBe(getAddress(sc.weth));
        expect(node.submitted.slice(sellIndex + 1).filter((s) => s.tx.from?.toLowerCase() === sc.wallet.address.toLowerCase())).toEqual([]);
    });
});
