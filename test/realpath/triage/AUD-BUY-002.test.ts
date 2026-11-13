// test/realpath/triage/AUD-BUY-002.test.ts
// Phase 23 plan 23-05 Task 1 (AUDIT-02, RC-01): AUD-BUY-002, a buy that has landed recorded as a
// failed or missing trade. One file for the root cause (D-10): one catch in the snipe handler
// (src/bot.ts handleNewPairForChain, the catch after submitBuyTx) treats every error after the
// buy was submitted as a clean zero-spend failure.
//
// Proven here on the real path (a real PairCreated through the real listener, detection, safety
// and buy; real ethers signs the Flashbots bundle; the simulated node and relay answer; the real
// migrated SQLite database records it):
//   A. sub_claim 1 (confirmed by Phase 22 reading, now proven): a balanceOf error after the buy
//      mined flips the trades row to failed, no exit monitor starts, the operator is told
//      "TX failed", and after a restart the position is not in the resume set (claims
//      balanceof-error-flips-landed-buy-to-failed and failed-row-not-resumed-after-restart). The
//      read keeps failing for a 30 s decision window after the buy mined (review CR-07): a one-shot
//      fault let a fix that retries the read once read "looks fixed" while two failed reads still
//      marked a landed buy failed. A fix that keeps retrying until the node answers (after the
//      window) and then arms the position reads "looks fixed".
//   B. sub_claim 3 (a Phase 22 candidate, now proven): attempt 0 of the bundle is accepted by
//      the relay and not included at its first target block, so `latest` does not move and
//      attempt 1 signs the SAME nonce with a higher fee. Attempt 0 then lands at a later block it
//      was still targeting. The bot reconciles only attempt 1's hash, reads "landed-not-ours" and
//      records nothing (claim earlier-attempt-lands-no-trade-row).
//   C. sub_claim 4 (a Phase 22 candidate, now proven): the relay refuses a later block of the
//      multi-block fanout after the bundle for the first block was already sent; the strategy
//      throws, the bot records nothing, and the bundle it already sent lands (claim
//      fanout-error-after-send-no-trade-row).
//
// The history behind B and C is explicit (review concern 23-05 HIGH): `latest` counts mined
// transactions only (a relay acceptance moves no count, FakeNode #nonceAt), and every mine names
// the exact transaction it includes; node.history shows the competing hashes at one nonce.
//
// Not proven here, with their register status (not invented as passing):
//   - sub_claim 2, a SQLite error in the post-mine bookkeeping (pause read, recordSnipe,
//     insertTrade): confirmed by Phase 22 reading; not tested, because the harness has no
//     SQLite fault seam and a test-side mock of src/utils/db is outside the AC-02 list.
//   - sub_claim 5, the V3 catch flipping a concurrent same-token handler's live row: confirmed
//     by Phase 22 reading; it is the double-buy race of AUD-BUY-004, triaged by its own plan.
//   - sub_claim 6, a stale balanceOf of 0 accepted as the original amount: candidate; needs a
//     lagging node answering 0 after the inclusion, not tested here.
//   - The remaining traces (mined-but-reverted, ceiling-hit with a still-pending public tx on
//     the passthrough route, trade-id lookup miss, a null entry price, upsertExitState throwing,
//     an anti-rug baseline failure) stay as Phase 22 recorded them.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, it, expect } from 'vitest';
import { Contract, Interface, Transaction, getAddress } from 'ethers';
import { harnessState, type Submitted } from '../harness/chain';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, createTempDbFile, restartGraph, stepFor, stepUntil, stepUntilTrue, type Scenario } from '../harness/world';

const V2_ROUTER = new Interface(['function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)']);
const ERC20 = new Interface(['function balanceOf(address) view returns (uint256)']);

function opLogged(op: string, from = 0): boolean {
    return recordedLogs().slice(from).some((l) => l.obj?.op === op);
}

function opEntries(op: string): Array<Record<string, unknown>> {
    return recordedLogs()
        .filter((l) => l.obj?.op === op)
        .map((l) => l.obj!);
}

/** Start the real listener and wait for its PairCreated subscription on the factory. */
async function listen(sc: Scenario): Promise<void> {
    await sc.graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
    await stepUntilTrue(
        () => sc.node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === sc.dex.factoryAddress.toLowerCase()),
        { what: 'the listener subscribing to PairCreated on the factory' },
    );
}

interface TradeRow {
    id: number;
    status: string;
    action: string;
    tx_hash: string;
}

function tradeRows(sc: Scenario): TradeRow[] {
    return sc.graph.db.prepare('SELECT id, status, action, tx_hash FROM trades WHERE token = ? AND chain = ?').all(sc.token.toLowerCase(), sc.chain) as TradeRow[];
}

/** The alert text the bot sends to say the buy failed, if it sent one after the buy-sent alert. */
function failAlertAfterBuySent(): string | null {
    const alerts = recordedAlerts();
    const sent = alerts.findIndex((a) => String(a.message).startsWith('*Buy TX sent via'));
    const after = sent >= 0 ? alerts.slice(sent + 1) : alerts;
    const failed = after.find((a) => /TX failed/.test(String(a.message)));
    return failed ? String(failed.message) : null;
}

/** The wallet's token balance, read through the bot's own provider (a real eth_call). */
async function heldTokens(sc: Scenario): Promise<bigint> {
    const token = new Contract(sc.token, ERC20, sc.ctx.httpProvider);
    return (await stepUntil(token.balanceOf(sc.wallet.address) as Promise<bigint>)) as bigint;
}

function decodeBuy(sub: Submitted): { nonce: number; maxPriorityFeePerGas: bigint; amountOutMin: bigint; to: string } {
    const tx = Transaction.from(sub.raw);
    const call = V2_ROUTER.parseTransaction({ data: tx.data, value: tx.value });
    if (!call || call.name !== 'swapExactETHForTokens') throw new Error(`decodeBuy: ${sub.hash} is not swapExactETHForTokens`);
    return { nonce: tx.nonce, maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? 0n, amountOutMin: call.args[0] as bigint, to: getAddress(tx.to!) };
}

/** How long the post-mine balanceOf read keeps failing after it first failed (virtual time). */
const BALANCE_FAULT_WINDOW_MS = 30_000;

describe('AUD-BUY-002: a landed buy recorded as failed or not at all (RC-01)', () => {
    it('balanceof-error-flips-landed-buy-to-failed: balanceOf errors after the buy mined (a lagging node, 30 s) flip the row to failed, starts no exit monitor, alerts "TX failed", and a restart does not resume the held position', async (ctx) => {
        // A temp-file database, so the restart half reads the same file (plan 23-27).
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() } });
        const { node } = sc;
        await listen(sc);
        const launch = await sc.fireNewPair();
        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting its buy bundle' });
        const buy = node.submitted[0];
        expect(buy.route).toBe('bundle');
        expect(decodeBuy(buy).to).toBe(getAddress(sc.dex.routerAddress));

        // Every post-mine balanceOf read of the token for the wallet fails for the decision window
        // (review concern 23-05 MEDIUM: the fault names the token and is armed only once the buy is
        // mined, so it cannot hit an earlier safety or quote read; review CR-07: it persists for the
        // window, so a retry against the same lagging node fails too). The error is geth's own
        // answer from a load-balanced node that has not seen the block yet.
        let decisionWindow = true;
        const balanceRead = node.failNext('eth_call', { selector: 'balanceOf(address)', to: sc.token, after: () => decisionWindow && node.isMined(buy.hash), times: 1_000, error: { code: -32000, message: 'header not found' } });

        await stepFor(12_000);
        expect(node.mine({ include: [buy.hash] })).toBe(launch.block + 1);
        expect(node.statusOf(buy.hash)).toBe('mined');
        await stepUntilTrue(() => balanceRead.fired >= 1, { what: 'the post-mine balanceOf read failing', maxSteps: 20_000 });
        await stepFor(BALANCE_FAULT_WINDOW_MS);
        decisionWindow = false;
        // The handler finishes either way: the catch sends its alert, or the monitor starts.
        await stepUntilTrue(() => failAlertAfterBuySent() !== null || opLogged('exit.monitor.started'), { what: 'the snipe handler finishing after the mined buy', maxSteps: 20_000 });
        await stepFor(1_000);

        // Setup facts, true whether or not the bug is fixed: the fault fired, after the buy was
        // recorded and announced, and the tokens are held (the bot's own provider reads them).
        expect(balanceRead.fired).toBeGreaterThanOrEqual(1);
        expect(recordedAlerts().some((a) => String(a.message).startsWith('*Buy TX sent via flashbots*'))).toBe(true);
        expect(await heldTokens(sc)).toBeGreaterThan(0n);
        const rows = tradeRows(sc);
        expect(rows).toHaveLength(1);
        expect(rows[0].tx_hash).toBe(buy.hash);
        const exitStateRows = (sc.graph.db.prepare('SELECT count(*) AS n FROM exit_state WHERE trade_id = ?').get(rows[0].id) as { n: number }).n;
        const actual = { status: rows[0].status, monitored: opLogged('exit.monitor.started') || exitStateRows > 0, alertText: failAlertAfterBuySent() };

        knownBug(ctx, 'AUD-BUY-002', {
            claim: 'balanceof-error-flips-landed-buy-to-failed',
            correct: { status: 'pending', monitored: true, alertText: null },
            observed: { status: 'failed', monitored: false, alertText: '*TX failed* for `RPLT`' },
            actual,
            expectedPlain: 'After a buy has landed, a failed token-balance read keeps the trade open and the position held and monitored, and the operator is not told the buy failed.',
            actualPlain: 'One failed token-balance read after the buy landed marked the trade failed, started no exit monitor and sent "TX failed", while the wallet holds the tokens.',
        });
        // How it failed: the catch saw that balanceOf read. Real ethers turns the node's -32000
        // eth_call error into CALL_EXCEPTION naming the call (the bot's wallet, on the token).
        const failClean = opEntries('buy.snipe.fail-clean');
        expect(failClean).toHaveLength(1);
        const reason = String(failClean[0].reason);
        expect(reason).toContain('code=CALL_EXCEPTION');
        expect(reason).toContain(`"data": "${ERC20.encodeFunctionData('balanceOf', [sc.wallet.address])}"`);
        expect(reason).toContain(`"to": "${getAddress(sc.token)}"`);

        // After a restart the held position is not re-armed: the resume set (trades pending, or an
        // exit_failed_held exit_state row) is selected synchronously by resumeMultiChainMonitoring.
        const tradeId = rows[0].id;
        await restartGraph(sc);
        expect(sc.graph.db.prepare('SELECT status FROM trades WHERE id = ?').get(tradeId)).toEqual({ status: 'failed' });
        const fromLog = recordedLogs().length;
        sc.graph.bot.resumeMultiChainMonitoring([sc.ctx]);
        const resumedAt = recordedLogs()
            .slice(fromLog)
            .filter((l) => l.msg === 'Resuming exit monitor for pending token' && l.obj?.tradeId === tradeId);
        await stepFor(5_000);

        // The resume is read two ways, so a fix that resumes failed-but-held buys reads "looks fixed"
        // whichever line it logs (review WR-11): the resume selection's line, or the exit monitor's
        // own exit.monitor.resumed op.
        knownBug(ctx, 'AUD-BUY-002', {
            claim: 'failed-row-not-resumed-after-restart',
            correct: { resumedAfterRestart: true },
            observed: { resumedAfterRestart: false },
            actual: { resumedAfterRestart: resumedAt.length > 0 || opLogged('exit.monitor.resumed', fromLog) },
            expectedPlain: 'After a restart the bot resumes monitoring every position it still holds.',
            actualPlain: 'After a restart the held position whose trade was marked failed is not in the resume set, so it gets no exit monitor.',
        });
        // Bug details, after the marker (review WR-11: they describe the bug, so before the marker
        // they turned a resume fix into a plain failure instead of "looks fixed").
        expect(opLogged('exit.monitor.resumed', fromLog)).toBe(false);
        expect(opLogged('exit.monitor.started', fromLog)).toBe(false);
    });

    it('earlier-attempt-lands-no-trade-row: attempt 0 is not included at its first target block, attempt 1 signs the same nonce, attempt 0 then lands and the bot records no trade', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node, wallet } = sc;
        await listen(sc);
        const launch = await sc.fireNewPair();
        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting attempt 0' });
        const attempt0 = node.submitted[0];
        const a0 = decodeBuy(attempt0);
        expect(attempt0.targetBlocks).toEqual([launch.block + 1, launch.block + 2, launch.block + 3]);

        // Attempt 0's first target block is mined without it: `latest` stays at its nonce.
        await stepFor(12_000);
        expect(node.mine({ include: [] })).toBe(launch.block + 1);
        expect(node.minedCount(wallet.address)).toBe(a0.nonce);
        // The bot's 45 s confirm window passes with no block, then attempt 1 signs at the same nonce.
        await stepUntilTrue(() => node.submitted.length === 2, { what: 'the bot submitting attempt 1', maxSteps: 20_000 });
        const attempt1 = node.submitted[1];
        const a1 = decodeBuy(attempt1);
        expect(attempt1.hash).not.toBe(attempt0.hash);
        expect(a1.nonce).toBe(a0.nonce);
        expect(a1.maxPriorityFeePerGas).toBeGreaterThan(a0.maxPriorityFeePerGas);
        expect(opEntries('mev.reconcile.not-landed')).toHaveLength(1);

        // A builder includes attempt 0 at a block it was still targeting (it is still accepted).
        expect(attempt0.targetBlocks).toContain(launch.block + 2);
        expect(node.mine({ include: [attempt0.hash] })).toBe(launch.block + 2);
        await stepUntilTrue(() => failAlertAfterBuySent() !== null || tradeRows(sc).length > 0, { what: 'the snipe handler finishing after attempt 0 landed', maxSteps: 20_000 });
        await stepFor(1_000);

        // node.history: both hashes accepted at one nonce, attempt 0 mined, attempt 1 dropped by it.
        const atNonce = node.history.filter((e) => e.from.toLowerCase() === wallet.address.toLowerCase() && e.nonce === a0.nonce);
        expect(new Set(atNonce.filter((e) => e.event === 'accepted').map((e) => e.hash))).toEqual(new Set([attempt0.hash, attempt1.hash]));
        expect(atNonce.filter((e) => e.event === 'mined').map((e) => e.hash)).toEqual([attempt0.hash]);
        expect(atNonce.filter((e) => e.event === 'dropped').map((e) => ({ hash: e.hash, by: e.by }))).toEqual([{ hash: attempt1.hash, by: attempt0.hash }]);
        expect(node.isMined(attempt0.hash)).toBe(true);
        expect(node.isMined(attempt1.hash)).toBe(false);
        expect(await heldTokens(sc)).toBeGreaterThan(0n);

        const rows = tradeRows(sc);
        knownBug(ctx, 'AUD-BUY-002', {
            claim: 'earlier-attempt-lands-no-trade-row',
            correct: { tradeRows: 1, recordedHash: attempt0.hash },
            observed: { tradeRows: 0, recordedHash: null },
            actual: { tradeRows: rows.length, recordedHash: rows[0]?.tx_hash ?? null },
            expectedPlain: 'When an earlier attempt of the buy lands, the bot records the landed buy with that transaction and monitors it.',
            actualPlain: 'An earlier attempt of the buy landed while the bot was checking only the later attempt; it reported a failed buy, wrote no trade and left the tokens held with no monitoring.',
        });
        // How it failed: the bot reconciled only attempt 1's hash, read "landed-not-ours", and the
        // snipe catch reported a clean failure.
        expect(opEntries('mev.reconcile.landed-not-ours')).toHaveLength(1);
        expect(opEntries('buy.snipe.fail-clean')).toHaveLength(1);
        expect(failAlertAfterBuySent()).toBe('*TX failed* for `RPLT`');
        expect(opLogged('exit.monitor.started')).toBe(false);
    });

    it('fanout-error-after-send-no-trade-row: the relay refuses a later block of the fanout after the bundle for the first block was sent; the bot records nothing and that bundle lands', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node } = sc;
        await listen(sc);
        const sendBundles = (): number => node.relay.filter((r) => r.method === 'eth_sendBundle').length;
        // Calls 1 and 2 are the library send and the raw send for the first target block; call 3
        // is the raw send for the second target block (src/utils/mevStrategies/flashbots.ts).
        const third = node.failNext('eth_sendBundle', { after: () => sendBundles() === 3 });
        const launch = await sc.fireNewPair();
        await stepUntilTrue(() => third.fired === 1, { what: 'the relay refusing the fanout send for the second target block' });
        expect(node.submitted).toHaveLength(1);
        const buy = node.submitted[0];
        // The relay accepted the bundle for the first target block only.
        expect(buy.targetBlocks).toEqual([launch.block + 1]);

        // A builder includes the bundle already sent for the first target block.
        await stepFor(12_000);
        expect(node.mine({ include: [buy.hash] })).toBe(launch.block + 1);
        await stepUntilTrue(() => failAlertAfterBuySent() !== null || tradeRows(sc).length > 0, { what: 'the snipe handler finishing after the bundle landed', maxSteps: 20_000 });
        await stepFor(5_000);
        expect(third.fired).toBe(1);
        expect(await heldTokens(sc)).toBeGreaterThan(0n);

        const rows = tradeRows(sc);
        knownBug(ctx, 'AUD-BUY-002', {
            claim: 'fanout-error-after-send-no-trade-row',
            correct: { tradeRows: 1, recordedHash: buy.hash },
            observed: { tradeRows: 0, recordedHash: null },
            actual: { tradeRows: rows.length, recordedHash: rows[0]?.tx_hash ?? null },
            expectedPlain: 'If the relay refuses a later block after the bundle was already sent, the bot keeps watching that bundle and records the buy when it lands.',
            actualPlain: 'The relay refused a later block after the bundle was sent; the bot logged "zero ETH spent, no trades row", the bundle it had sent then landed, and no trade was recorded.',
        });
        // How it failed: the strategy threw on the refused send and the catch called it zero spend.
        expect(String(opEntries('buy.snipe.fail-clean')[0]?.reason)).toBe(`Flashbots eth_sendBundle error (block ${launch.block + 2}): realpath harness: injected fault on eth_sendBundle`);
        expect(harnessState().logs.some((l) => l.msg?.startsWith('Snipe FAILED CLEAN') && String(l.msg).includes('zero ETH spent'))).toBe(true);
        expect(failAlertAfterBuySent()).toBe('*TX failed* for `RPLT`');
        expect(opLogged('exit.monitor.started')).toBe(false);
    });
});
