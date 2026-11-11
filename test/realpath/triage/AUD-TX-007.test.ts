// test/realpath/triage/AUD-TX-007.test.ts
// Phase 23 plan 23-05 Task 2 (AUDIT-02, RC-22): AUD-TX-007, the base fee is doubled in the
// affordability and reserve math. ethers getFeeData() computes maxFeePerGas = 2 x latest
// baseFeePerGas + maxPriorityFeePerGas (node_modules/ethers/lib.commonjs/providers/
// abstract-provider.js:624-625), and the bot takes maxFeePerGas - maxPriorityFeePerGas as "the
// base fee", which is 2 x the real one. One root cause, two sites proven here, one test each:
//   - the buy-time entry gate, src/preflight.ts deriveFeeWei (sibling in the finding): its refusal
//     log carries the base fee it used (details.baseFeeWei) (claim
//     entry-gate-uses-doubled-base-fee);
//   - the Flashbots strategy, src/utils/mevStrategies/flashbots.ts baseFeeWei, which feeds
//     computeAffordablePriorityFee's headroom and the public-exit reserve (claim
//     strategy-reserve-uses-doubled-base-fee).
//
// Each test sets the block base fee on the simulated node (mine({ baseFeePerGas })), reads the fee
// data back through real ethers to show the node answers real fee fields, and then sets the
// wallet balance inside the window where the real base fee and the doubled one give different
// answers. The window edges are computed with the bot's own exported functions
// (computeWorstCasePublicExitGas, computePublicExitReserveWei, computeAffordablePriorityFee), so
// the test asserts the decision the code makes, not a hand formula.
//
// The strategy test needs a high gas estimate: the entry gate reserves maxGasLimit (300 000 on
// ETH) at the full maxFeePerGas plus a 2x sell buffer, so with an ordinary estimate it refuses
// before the strategy's own reserve can decide anything. A real node answers eth_estimateGas
// with what the swap's execution costs, which for a token with heavy transfer code can be
// 1 000 000 gas.
//
// Not proven here: the thin-wallet private SELL refused before submit and sent to the public
// mempool (the finding's capital effect). It needs a full exit scenario and is left to the exit
// triage plans; the derivation it rests on is the strategy one proven here. passthrough.ts
// (Base, Arbitrum) uses the same derivation; it is not run here.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, it, expect } from 'vitest';
import { formatEther, parseEther } from 'ethers';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntil, stepUntilTrue, type Scenario } from '../harness/world';

const GWEI = 1_000_000_000n;
/** The block base fee set on the node for both tests: 20 gwei. */
const BASE_FEE = 20n * GWEI;

function opEntry(op: string): Record<string, unknown> | undefined {
    return recordedLogs().find((l) => l.obj?.op === op)?.obj;
}

async function listen(sc: Scenario): Promise<void> {
    await sc.graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
    await stepUntilTrue(
        () => sc.node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === sc.dex.factoryAddress.toLowerCase()),
        { what: 'the listener subscribing to the factory' },
    );
}

/** Mine one block with the test's base fee, and show real ethers reads the fee fields from it. */
async function setBaseFee(sc: Scenario): Promise<{ maxFeePerGas: bigint; priorityFee: bigint }> {
    sc.node.mine({ include: [], baseFeePerGas: BASE_FEE });
    const fee = await stepUntil(sc.ctx.httpProvider.getFeeData());
    const priorityFee = sc.node.priorityFeePerGas;
    // ethers' EIP-1559 heuristic on the node's real block: maxFee = 2 x base + priority.
    expect(fee.maxPriorityFeePerGas).toBe(priorityFee);
    expect(fee.maxFeePerGas).toBe(2n * BASE_FEE + priorityFee);
    return { maxFeePerGas: fee.maxFeePerGas!, priorityFee };
}

/** EXIT_GATE_SELL_GAS_BUFFER as src/preflight.ts parses it (default 2.0). */
function exitGateBuffer(): number {
    const raw = process.env.EXIT_GATE_SELL_GAS_BUFFER;
    const n = raw === undefined || raw === '' ? NaN : Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : 2.0;
}

describe('AUD-TX-007: the base fee is doubled in the affordability and reserve math (RC-22)', () => {
    it('entry-gate-uses-doubled-base-fee: a buy the wallet can afford at the real base fee is refused by the entry gate, which priced the exit at twice the base fee', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node, wallet } = sc;
        const { maxFeePerGas } = await setBaseFee(sc);
        const preflight = await import('../../../src/preflight');

        // The gate's floor (src/preflight.ts checkEntryExitAffordability, snipe mode) with a given
        // base fee: snipe + maxGasLimit x maxFeePerGas + the public-exit reserve + cushion.
        const chain = sc.ctx.chain;
        const gasLimit = chain.gas.maxGasLimit;
        const floorAt = (baseFeeWei: bigint): bigint =>
            parseEther(chain.snipeAmount) + gasLimit * maxFeePerGas + preflight.computeWorstCasePublicExitGas({ baseFeeWei, sellGasLimit: gasLimit, sellGasBuffer: exitGateBuffer() }) + parseEther(chain.gasBuffer);
        const floorReal = floorAt(BASE_FEE);
        const floorDoubled = floorAt(2n * BASE_FEE);
        expect(floorReal).toBeLessThan(floorDoubled);
        // A balance that covers the floor at the real base fee and not at the doubled one.
        const balance = (floorReal + floorDoubled) / 2n;
        node.setBalance(wallet.address, balance);

        await listen(sc);
        await sc.fireNewPair();
        await stepUntilTrue(() => opEntry('entry.exit-affordability.refused') !== undefined || node.submitted.length > 0, { what: 'the entry gate deciding (refusal, or the buy submitted)', maxSteps: 20_000 });
        await stepFor(1_000);

        const refusal = opEntry('entry.exit-affordability.refused');
        const details = (refusal?.details ?? {}) as Record<string, unknown>;
        knownBug(ctx, 'AUD-TX-007', {
            claim: 'entry-gate-uses-doubled-base-fee',
            correct: { refused: false, gateBaseFeeWei: null },
            observed: { refused: true, gateBaseFeeWei: (2n * BASE_FEE).toString() },
            actual: { refused: refusal !== undefined, gateBaseFeeWei: refusal ? String(details.baseFeeWei) : null },
            expectedPlain: 'The buy-time entry check prices the exit at the real base fee, so a wallet that can afford the buy and its exit at that fee is not refused.',
            actualPlain: 'The entry check used twice the real base fee (20 gwei became 40 gwei) and refused a buy the wallet could afford at the real base fee.',
        });
        // The refusal's own numbers: the floor at the doubled base fee, above the balance.
        expect(details.floor).toBe(formatEther(floorDoubled));
        expect(details.balance).toBe(formatEther(balance));
        expect(details.maxBuyFeeWei).toBe(maxFeePerGas.toString());
        expect(balance).toBeGreaterThanOrEqual(floorReal);
        expect(node.submitted).toHaveLength(0);
        expect(recordedAlerts().some((a) => String(a.message).startsWith('*Entry REFUSED*'))).toBe(true);
    });

    it('strategy-reserve-uses-doubled-base-fee: the Flashbots strategy refuses as unaffordable a buy whose headroom is positive at the real base fee, because its reserve and gas terms use twice the base fee', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node, wallet } = sc;
        const { maxFeePerGas, priorityFee } = await setBaseFee(sc);
        const ESTIMATE = 1_000_000n;
        node.setFees({ estimateGas: ESTIMATE });
        const preflight = await import('../../../src/preflight');
        const reconciliation = await import('../../../src/utils/mevStrategies/reconciliation');

        const chain = sc.ctx.chain;
        const snipeValue = parseEther(chain.snipeAmount);
        const gasLimit = chain.gas.maxGasLimit;
        // The entry gate's floor today (doubled base fee): the balance must clear it, so the gate passes.
        const gateFloor = snipeValue + gasLimit * maxFeePerGas + preflight.computeWorstCasePublicExitGas({ baseFeeWei: 2n * BASE_FEE, sellGasLimit: gasLimit, sellGasBuffer: exitGateBuffer() }) + parseEther(chain.gasBuffer);
        // The strategy refuses when headroom = balance - value - reserve - gasLimit x baseFee <= 0
        // (reconciliation.ts computeAffordablePriorityFee); buy and sell gas limit are the estimate.
        const neededAt = (baseFeeWei: bigint): bigint => snipeValue + reconciliation.computePublicExitReserveWei({ baseFeeWei, sellGasLimit: ESTIMATE }) + ESTIMATE * baseFeeWei;
        const lo = (gateFloor > neededAt(BASE_FEE) ? gateFloor : neededAt(BASE_FEE)) + 1n;
        const hi = neededAt(2n * BASE_FEE);
        expect(lo).toBeLessThan(hi);
        const balance = (lo + hi) / 2n;
        const affordable = (baseFeeWei: bigint): boolean =>
            reconciliation.computeAffordablePriorityFee({
                desiredPriorityFeeWei: priorityFee,
                ceilingWei: 25n * GWEI,
                walletBalanceWei: balance,
                snipeValueWei: snipeValue,
                baseFeeWei,
                buyGasLimit: ESTIMATE,
                sellGasLimit: ESTIMATE,
                reserveSellGas: true,
            }).affordable;
        // At the real base fee the buy is affordable; at the doubled one it is not.
        expect(affordable(BASE_FEE)).toBe(true);
        expect(affordable(2n * BASE_FEE)).toBe(false);
        node.setBalance(wallet.address, balance);

        await listen(sc);
        await sc.fireNewPair();
        await stepUntilTrue(() => opEntry('mev.escalation.unaffordable') !== undefined || node.submitted.length > 0, { what: 'the strategy deciding (unaffordable, or the bundle submitted)', maxSteps: 20_000 });
        await stepFor(1_000);
        // Setup facts: the entry gate passed and the bot priced the buy with the node's estimate.
        expect(opEntry('entry.exit-affordability.refused')).toBeUndefined();
        expect(node.callLog.some((c) => c.method === 'eth_estimateGas')).toBe(true);

        const unaffordable = opEntry('mev.escalation.unaffordable');
        knownBug(ctx, 'AUD-TX-007', {
            claim: 'strategy-reserve-uses-doubled-base-fee',
            correct: { buySubmitted: true, refusedAsUnaffordable: false },
            observed: { buySubmitted: false, refusedAsUnaffordable: true },
            actual: { buySubmitted: node.submitted.length > 0, refusedAsUnaffordable: unaffordable !== undefined },
            expectedPlain: 'The Flashbots strategy reserves gas at the real base fee, so a buy with room to spare at that fee is submitted.',
            actualPlain: 'The Flashbots strategy used twice the real base fee for its gas and exit reserve and refused, before submitting, a buy the wallet could afford at the real base fee.',
        });
        // The refusal's own numbers: this wallet balance, the estimate as buy and sell gas limit.
        expect(unaffordable!.walletBalanceWei).toBe(balance.toString());
        expect(unaffordable!.buyGasLimit).toBe(ESTIMATE.toString());
        expect(unaffordable!.sellGasLimit).toBe(ESTIMATE.toString());
        expect(node.relay).toHaveLength(0);
        expect(String(opEntry('buy.snipe.fail-clean')?.reason)).toContain('MEV submit unaffordable');
    });
});
