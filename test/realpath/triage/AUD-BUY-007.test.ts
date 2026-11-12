// test/realpath/triage/AUD-BUY-007.test.ts
// Phase 23 plan 23-13 Task 3 (AUDIT-02, D-07, D-08, D-NONCE-AUTHORITY-ALL): AUD-BUY-007 (S1, RC-16,
// ESC-CENSUS-01 "keep s1"), the dead "simulation" that really signs.
//
// The finding: src/utils/tokenSafety.ts simulateSell connects the token contract to the Wallet
// signer and calls approve(CONFIG.routerAddress, balance), a real signed transaction of the whole
// token balance, outside withNonceLock; only the swap that follows is a staticCall. Nothing calls it
// today (it is still imported into src/bot.ts), so the harm is a re-wiring trap: anything that calls
// a function named simulateSell signs an approve that can take the nonce of a live buy or sell.
//
// How: the real simulateSell, from the graph's own tokenSafety module, is called on the fake chain
// (an ETH scenario, so CONFIG.routerAddress is the scenario's Uniswap V2 router) for a wallet that
// really holds the token: another holder signs a real ERC-20 transfer to the bot's wallet and it is
// mined (fixtures/AUD-API-001-dashboard-sell.ts incomingHolder). While the call runs, the test holds
// the wallet's own nonce lock through the graph's real withNonceLock (fixtures/AUD-TX-002-lock.ts),
// so a signing that waited for the lock could not happen inside the window: what is signed while the
// lock is held was signed outside it. The window is bounded (60 s of fake time), then the lock is
// released and the call allowed to finish.
//   Correct:  { signed: [], signedWhileNonceLockHeld: 0 }: a simulation signs no transaction.
//   Observed: one public approve(router, the whole held balance) to the token, signed while the
//             wallet's nonce lock was held.
// The router answers the swap's eth_call as the real Uniswap V2 router does at the latest block: the
// approve is still pending (not mined), so the router's transferFrom fails with "TransferHelper:
// TRANSFER_FROM_FAILED"; simulateSell catches it, logs its "Sell simulation failed" warning and
// returns false. Both are asserted after the marker (the warning is this finding's own behavior). A
// real node answers the same way, so even as a check the function reports a sellable token unsellable.
//
// Phase 24/29 reading: deleting simulateSell (and its bot.ts import), the recommendation, flips the
// claim to "looks fixed": a module without the function signs nothing, recorded as the correct value
// (shown by a fix-shaped mutation, src restored byte for byte). A version that takes the nonce lock
// and still signs reads "the failure changed", not fixed: a simulation must not sign at all. This
// entry feeds the census exception list in plan 23-17 (its one src exception, tokenSafety
// simulateSell contract.approve).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, getAddress } from 'ethers';
import { revertReason, type Submitted } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepUntil, stepUntilTrue } from '../harness/world';
import { incomingHolder, stepUntilOrFor } from './fixtures/AUD-API-001-dashboard-sell';
import { graphWithNonceLock } from './fixtures/AUD-TX-002-lock';

const ERC20 = new Interface(['function approve(address spender, uint256 amount) returns (bool)']);
const ROUTER = new Interface(['function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)']);
const APPROVE = ERC20.getFunction('approve')!.selector;
const SWAP = ROUTER.getFunction('swapExactTokensForETHSupportingFeeOnTransferTokens')!;

/** The tokens the other holder has, and what it sends to the bot's wallet. */
const HOLDER_BALANCE = 1_000_000n * 10n ** 18n;
const HELD = 12_345n * 10n ** 18n;
/** The bounded observation window while the test holds the wallet's nonce lock (fake time). */
const WINDOW_MS = 60_000;

interface SignedTx {
    route: Submitted['route'];
    to: string;
    call: string;
    spender: string | null;
    amount: bigint | null;
}

function decodeSigned(s: Submitted): SignedTx {
    const to = s.tx.to ? getAddress(s.tx.to) : '';
    if (s.tx.data.slice(0, 10) === APPROVE) {
        const a = ERC20.decodeFunctionData('approve', s.tx.data);
        return { route: s.route, to, call: 'approve', spender: getAddress(a[0] as string), amount: a[1] as bigint };
    }
    return { route: s.route, to, call: s.tx.data.slice(0, 10), spender: null, amount: null };
}

type SimulateSell = (tokenAddress: string, wallet: unknown) => Promise<boolean>;

describe('AUD-BUY-007: the dead simulateSell signs a real approve of the whole balance, outside the nonce lock', () => {
    it('simulate-sell-signs-approve-outside-nonce-lock: calling simulateSell on a held token signs one approve while the wallet lock is held', { timeout: 60_000 }, async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { CONFIG } = await import('../../../src/config');
        // The ETH scenario's V2 router is the legacy CONFIG.routerAddress simulateSell uses.
        expect(getAddress(sc.dex.routerAddress)).toBe(getAddress(CONFIG.routerAddress));
        expect(getAddress(sc.weth)).toBe(getAddress(CONFIG.wethAddress));
        const router = getAddress(CONFIG.routerAddress);
        const wallet = sc.wallet.address.toLowerCase();
        const fromWallet = (from: number): Submitted[] => sc.node.submitted.slice(from).filter((s) => s.tx.from?.toLowerCase() === wallet);

        // A held token: a real transfer from another holder, mined.
        const holder = incomingHolder(sc, { bought: 0n, holding: HOLDER_BALANCE });
        const { hash } = await holder.send(HELD);
        sc.node.mine({ include: [hash] });
        expect(sc.node.isMined(hash)).toBe(true);

        // The router's answer to the swap's eth_call, as the real router gives it at the latest
        // block: transferFrom needs a mined allowance of at least amountIn.
        const minedAllowance = (): bigint => {
            let allowance = 0n;
            for (const s of sc.node.submitted) {
                if (s.status !== 'mined' || s.tx.from?.toLowerCase() !== wallet || !s.tx.to || getAddress(s.tx.to) !== getAddress(sc.token) || s.tx.data.slice(0, 10) !== APPROVE) continue;
                const a = ERC20.decodeFunctionData('approve', s.tx.data);
                if (getAddress(a[0] as string) === router) allowance = a[1] as bigint;
            }
            return allowance;
        };
        sc.node.setRead(router, SWAP.format('sighash'), ({ args }) => (minedAllowance() < (args[0] as bigint) ? revertReason('TransferHelper: TRANSFER_FROM_FAILED') : '0x'));

        // Hold the wallet's nonce lock (the graph's own withNonceLock) for the window.
        const withNonceLock = await graphWithNonceLock();
        let entered = false;
        let release!: () => void;
        const gate = new Promise<void>((r) => {
            release = r;
        });
        const lockHeld = withNonceLock(sc.wallet.address, async () => {
            entered = true;
            await gate;
        });
        await stepUntilTrue(() => entered, { what: 'the test taking the wallet nonce lock' });

        const fromSubmit = sc.node.submitted.length;
        const fromLog = recordedLogs().length;
        const fromCall = sc.node.callLog.length;
        // The graph's own module instance (loadGraph reset the registry, then imported the graph).
        const tokenSafety = (await import('../../../src/utils/tokenSafety')) as unknown as Record<string, unknown>;
        const simulateSell = tokenSafety.simulateSell as SimulateSell | undefined;
        let settled = false;
        let returned: boolean | undefined;
        let signedWhileNonceLockHeld = 0;
        if (typeof simulateSell === 'function') {
            const call = simulateSell(sc.token, sc.wallet).then((v) => {
                settled = true;
                returned = v;
                return v;
            });
            await stepUntilOrFor(() => settled, WINDOW_MS);
            signedWhileNonceLockHeld = fromWallet(fromSubmit).length;
            release();
            await stepUntil(lockHeld);
            await stepUntil(call);
        } else {
            // The recommended fix deleted the function: nothing can sign through it.
            release();
            await stepUntil(lockHeld);
        }
        const signed = fromWallet(fromSubmit).map(decodeSigned);

        knownBug(ctx, 'AUD-BUY-007', {
            claim: 'simulate-sell-signs-approve-outside-nonce-lock',
            correct: { signed: [] as SignedTx[], signedWhileNonceLockHeld: 0 },
            observed: {
                signed: [{ route: 'public' as const, to: getAddress(sc.token), call: 'approve', spender: router, amount: HELD }],
                signedWhileNonceLockHeld: 1,
            },
            actual: { signed, signedWhileNonceLockHeld },
            expectedPlain: 'A function named simulateSell only simulates: it signs and sends no transaction.',
            actualPlain: 'simulateSell sends a real, signed approval of the whole token balance to the router, without waiting for the wallet nonce lock that every other send waits for.',
        });

        // Detail: the simulation settled inside the window (it never waited for the lock), the
        // approve took the wallet's next nonce and is still pending, the router's eth_call reverted
        // on the missing allowance, and simulateSell logged that and returned false.
        expect(settled).toBe(true);
        expect(returned).toBe(false);
        const approve = fromWallet(fromSubmit)[0];
        expect(approve.tx.nonce).toBe(sc.node.minedCount(sc.wallet.address));
        expect(approve.status).toBe('accepted');
        expect(sc.node.callLog.slice(fromCall).filter((c) => c.method === 'eth_call' && c.to === router.toLowerCase() && c.selector === SWAP.selector)).toHaveLength(1);
        const warns = recordedLogs()
            .slice(fromLog)
            .filter((l) => l.level === 'warn' || l.level === 'error' || l.level === 'fatal');
        expect(warns.map((l) => `${l.level} ${String(l.bindings.module ?? '')} ${String(l.obj?.check ?? '')} ${l.msg ?? ''}`)).toEqual(['warn tokenSafety sellSimulation Sell simulation failed']);
        expect(String((warns[0].obj?.err as Error | undefined)?.message ?? '')).toContain('TRANSFER_FROM_FAILED');
    });
});
