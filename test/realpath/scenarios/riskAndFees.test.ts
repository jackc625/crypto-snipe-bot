// test/realpath/scenarios/riskAndFees.test.ts
// Phase 23 plan 23-22 Task 2 (CHAR-02, AC-19, AC-22): the golden-master recordings of the risk gate
// and of the fee and gas figures the bot computes on an ETH V2 Flashbots buy. Each test is one
// whole-graph scenario on the fake ETH chain through runScenario (driver.ts), which records the
// ordered timeline of op logs, submitted transactions, relay bodies and DB writes and compares it
// byte for byte with test/realpath/recordings/<name>.jsonl. A normal run never writes a recording;
// only `npm run recordings:update` does (AC-25).
//
// - risk-gate-refused: MAX_OPEN_POSITIONS is 2 and two open buys are seeded through the real
//   insertTrade statement of src/utils/db.ts (never by earlier buys in the scenario) before the new
//   pair arrives. canSnipe refuses with max_positions before the safety bank runs, so nothing is
//   sent and the recording is the two seeded db rows and the exact {"submitted":[]} line (AC-22).
//   The refusal line itself carries no op, so it is not in the recording; assertComplete proves it.
// - fee-gas-eth-v2: a block base fee of 30 gwei (node.mine({ baseFeePerGas })) and a priority fee
//   of 2 gwei (node.setFees({ maxPriorityFeePerGas })), a 10 ETH wallet. The buy's fee fields are
//   checked against the real computation: ethers getFeeData (maxFeePerGas = 2 x base + priority),
//   the strategy's baseFeeWei = maxFeePerGas - maxPriorityFeePerGas (twice the block's base fee,
//   AUD-TX-007), and the real computeAffordablePriorityFee over the inputs the strategy reads.
// - fee-gas-eth-v2-reserve-below / -at / -above: the same fees, with the wallet one wei below,
//   exactly at and one wei above the amount the strategy's affordability clamp
//   (src/utils/mevStrategies/reconciliation.ts computeAffordablePriorityFee, called at :516) needs:
//   snipe value + the public-exit reserve + buy gas limit x baseFeeWei. The clamp refuses when the
//   headroom is <= 0, so below and at are refused before submit (mev.escalation.unaffordable) and
//   above is submitted with the priority fee the clamp leaves (headroom 1 wei / gas limit = 0).
//   The boundary is computed with the real exported computePublicExitReserveWei from the fee data
//   the strategy reads, and checked with the real computeAffordablePriorityFee at all three
//   balances. The node's gas estimate is 1 000 000 (a token with heavy transfer code, as plan
//   23-05's AUD-TX-007 strategy test used): the entry gate prices the buy at the chain's
//   maxGasLimit (300 000), so with an ordinary estimate the gate refuses first and the strategy's
//   own clamp would never decide; each balance here clears the gate (asserted).
// - fee-gas-eth-v2-legacy: a legacy-fee node (node.setFees({ legacy: true, gasPrice })): no block
//   carries baseFeePerGas and eth_maxPriorityFeePerGas is refused as such a node does. The buy is a
//   type-0 transaction priced by gasPrice alone, with no EIP-1559 fee field anywhere.
//
// After the buy, the chain moves as in plan 23-20 (buyAndMine: the bundle lands one 12 s slot
// after it is sent, at a block it targets; then the arming is waited for). Hold points
// (AUD-TX-028): nothing here holds a call in flight; no provider read, relay call or bundle is
// parked. No scenario restarts the graph, so AUD-ANTIRUG-025 does not apply.
//
// Tags (AC-21, AC-46) are chosen from what each timeline shows against the register's confirmed
// findings; the SUMMARY of plan 23-22 lists, per scenario, the timeline lines behind each cited ID,
// which confirmed findings shape each recorded number, and the findings checked and ruled out.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Transaction, Wallet, ethers, getAddress, parseEther } from 'ethers';
import type { Submitted } from '../harness/chain';
import { recordedAlerts, recordedLogs, type TimelineEntry } from '../harness/capture';
import { serializeTimeline } from '../harness/serializer';
import type { Scenario } from '../harness/world';
import { stepFor, stepUntil, stepUntilTrue } from '../harness/world';
import { V2_ROUTER, buyAndMine, buyRow, listen, opEntries, opLogged, waitAntiRugArmed } from '../triage/fixtures/AUD-EXIT-002-position';
import { settleAntiRugArming } from '../triage/fixtures/AUD-TX-002-lock';
import { driveSlots, runScenario } from './driver';

const GWEI = 1_000_000_000n;
/** The block base fee of every EIP-1559 scenario here. */
const BASE_FEE = 30n * GWEI;
/** The node's eth_maxPriorityFeePerGas answer. */
const PRIORITY_FEE = 2n * GWEI;
/** The legacy node's eth_gasPrice answer. */
const LEGACY_GAS_PRICE = 25n * GWEI;
/** The node's eth_estimateGas answer in the reserve scenarios (see the header). */
const HEAVY_ESTIMATE = 1_000_000n;
/** Open positions the risk-gate scenario allows, and seeds. */
const MAX_OPEN = 2;

const CHECKER = new Interface(['function checkV2(address router, address token, uint256 amountIn)']);

type Reconciliation = typeof import('../../../src/utils/mevStrategies/reconciliation');
type Preflight = typeof import('../../../src/preflight');

function msgEntry(msg: string): Record<string, unknown> | undefined {
    return recordedLogs().find((l) => l.msg === msg)?.obj;
}

/** The HoneypotChecker reads of this scenario (the safety bank's on-chain gate). */
function checkerReads(sc: Scenario): number {
    const selector = CHECKER.getFunction('checkV2')!.selector;
    return sc.node.callLog.filter((c) => c.method === 'eth_call' && c.to === sc.checker.toLowerCase() && c.selector === selector).length;
}

/** The bot's own submissions (any route). */
function botSubmits(sc: Scenario): TimelineEntry[] {
    return sc.timeline.entries.filter((e: TimelineEntry) => e.kind === 'submit');
}

/** EXIT_GATE_SELL_GAS_BUFFER as src/preflight.ts parses it (default 2.0). */
function exitGateBuffer(): number {
    const raw = process.env.EXIT_GATE_SELL_GAS_BUFFER;
    const n = raw === undefined || raw === '' ? NaN : Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : 2.0;
}

interface FeeFacts {
    /** What real ethers getFeeData answers on the node (the strategy's own read). */
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    /** flashbots.ts baseFeeWei: maxFeePerGas - maxPriorityFeePerGas. */
    strategyBaseFeeWei: bigint;
}

/**
 * Mine one block with the scenario base fee and set the priority-fee answer, then read the fee data
 * back through real ethers getFeeData on the bot's provider, as the strategy does. One second of
 * fake time then passes, so this read is out of ethers' 250 ms request cache before the bot reads.
 */
async function setEip1559Fees(sc: Scenario): Promise<FeeFacts> {
    sc.node.setFees({ maxPriorityFeePerGas: PRIORITY_FEE });
    sc.node.mine({ include: [], baseFeePerGas: BASE_FEE });
    const fee = await stepUntil(sc.ctx.httpProvider.getFeeData());
    await stepFor(1_000);
    expect(fee.maxPriorityFeePerGas).toBe(PRIORITY_FEE);
    // ethers' EIP-1559 heuristic on the node's real block: 2 x base + priority.
    expect(fee.maxFeePerGas).toBe(2n * BASE_FEE + PRIORITY_FEE);
    return { maxFeePerGas: fee.maxFeePerGas!, maxPriorityFeePerGas: fee.maxPriorityFeePerGas!, strategyBaseFeeWei: fee.maxFeePerGas! - fee.maxPriorityFeePerGas! };
}

interface Bought {
    buy: TimelineEntry & { kind: 'submit' };
    tx: Transaction;
    tradeId: number;
}

const V2_LAUNCH = new Interface([
    'function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)',
    'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)',
]);

/**
 * The scenario's V2 launch on a legacy-fee node. The harness fireNewPair signs the deployer's
 * addLiquidityETH by the chain's profile (type 2 on ETH), which a legacy node refuses as not
 * supported, so this sends the same launch as a type-0 transaction at the node's gasPrice: the
 * deployer the harness funds (key realpath.deployer.<chain>), the same router call, reserves and
 * PairCreated log, through the public FakeNode API (addForeignTransaction, mine with logs). The
 * pair's reads are the scenario's own, set by createScenario.
 */
async function fireLegacyPair(sc: Scenario<'v2'>): Promise<number> {
    const { node, token, weth, pair, reserves } = sc;
    const deployer = new Wallet(ethers.id(`realpath.deployer.${sc.chain}`));
    const [token0, token1] = token.toLowerCase() < weth.toLowerCase() ? [token, weth] : [weth, token];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const data = V2_LAUNCH.encodeFunctionData('addLiquidityETH', [token, reserves.token, reserves.token, reserves.weth, deployer.address, deadline]);
    const raw = await deployer.signTransaction({ chainId: node.chainId, nonce: node.minedCount(deployer.address), to: sc.dex.routerAddress, value: reserves.weth, gasLimit: 4_000_000n, type: 0, gasPrice: LEGACY_GAS_PRICE, data });
    const hash = node.addForeignTransaction(raw);
    const created = V2_LAUNCH.encodeEventLog('PairCreated', [token0, token1, pair, 1n]);
    return node.mine({ include: [hash], logs: [{ address: sc.dex.factoryAddress, topics: created.topics, data: created.data, transactionHash: hash }] });
}

/**
 * The real snipe through its Flashbots bundle, mined one slot later, then armed and settled. With
 * `launch`, the pair is launched by that function instead of the harness fireNewPair, and the bundle
 * lands the same way (one 12 s slot after it is sent, at its first target block).
 */
async function buyArmed(sc: Scenario<'v2'>, launch?: (sc: Scenario<'v2'>) => Promise<number>): Promise<Bought> {
    await listen(sc);
    let buy: Submitted;
    if (launch === undefined) {
        ({ buy } = await buyAndMine(sc));
    } else {
        await launch(sc);
        await stepUntilTrue(() => sc.node.submitted.length === 1, { what: 'the bot submitting its buy' });
        buy = sc.node.submitted[0];
        await stepFor(12_000);
        sc.node.mine({ include: [buy.hash] });
    }
    await waitAntiRugArmed(sc);
    await settleAntiRugArming(sc, 1);
    expect(opLogged('exit.monitor.started')).toBe(true);
    const entry = botSubmits(sc).find((e) => (e as { hash?: string }).hash === buy.hash) as (TimelineEntry & { kind: 'submit' }) | undefined;
    expect(entry, 'the buy is a submit entry of the timeline').toBeDefined();
    return { buy: entry!, tx: Transaction.from(buy.raw), tradeId: buyRow(sc)!.id };
}

/** The bot's buy is the scenario's V2 swap, mined, with its row; returns the node's receipt fields. */
async function assertBuyLanded(sc: Scenario<'v2'>, held: Bought): Promise<{ effectiveGasPrice: bigint; gasUsed: bigint }> {
    const { tx } = held;
    expect(sc.node.submitted.map((s) => s.route)).toEqual(['bundle']);
    expect(getAddress(tx.to!)).toBe(getAddress(sc.dex.routerAddress));
    expect(tx.value).toBe(parseEther(sc.ctx.chain.snipeAmount));
    const call = V2_ROUTER.parseTransaction({ data: tx.data, value: tx.value })!;
    expect(call.name).toBe('swapExactETHForTokens');
    expect(sc.node.history.filter((h) => h.event === 'mined' && h.hash === tx.hash)).toHaveLength(1);
    // The relay body carried this same signed transaction.
    const bundled = sc.timeline.entries
        .filter((e: TimelineEntry) => e.kind === 'relay' && (e as { method?: string }).method === 'eth_sendBundle')
        .flatMap((e) => ((e as { params?: Array<{ txs?: string[] }> }).params ?? []).flatMap((p) => p.txs ?? []));
    expect(bundled.map((r) => Transaction.from(r).hash)).toContain(tx.hash);
    const reply = (await sc.node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [tx.hash] })) as {
        result?: { status: string; effectiveGasPrice: string; gasUsed: string } | null;
    };
    expect(reply.result?.status).toBe('0x1');
    expect(opEntries('flashbots.bundle.included').map((e) => e.minedTxHash)).toContain(tx.hash);
    expect(buyRow(sc)).toEqual(expect.objectContaining({ id: held.tradeId, status: 'pending', pool_type: 'v2', dex_name: sc.dex.name }));
    return { effectiveGasPrice: BigInt(reply.result!.effectiveGasPrice), gasUsed: BigInt(reply.result!.gasUsed) };
}

// ---------------------------------------------------------------------------------------------
// The affordability boundary
// ---------------------------------------------------------------------------------------------

interface Boundary {
    /** snipe value + public-exit reserve + buy gas limit x baseFeeWei: the clamp's headroom is balance minus this. */
    needed: bigint;
    snipeValue: bigint;
    reserve: bigint;
    gateFloor: bigint;
}

/**
 * The amount the strategy's clamp needs, from the real exported functions and the fee data the
 * strategy reads, and the entry gate's floor at the same fee data (src/preflight.ts
 * checkEntryExitAffordability, snipe mode). Checks with the real computeAffordablePriorityFee that
 * one wei below and exactly at the amount are refused and one wei above is allowed at fee 0.
 */
async function affordabilityBoundary(sc: Scenario, fees: FeeFacts): Promise<Boundary> {
    const reconciliation: Reconciliation = await import('../../../src/utils/mevStrategies/reconciliation');
    const preflight: Preflight = await import('../../../src/preflight');
    const chain = sc.ctx.chain;
    const snipeValue = parseEther(chain.snipeAmount);
    // The strategy's sell gas limit is the buy's gas limit (flashbots.ts sellGasLimit = buyGasLimit).
    const reserve = reconciliation.computePublicExitReserveWei({ baseFeeWei: fees.strategyBaseFeeWei, sellGasLimit: HEAVY_ESTIMATE });
    const needed = snipeValue + reserve + HEAVY_ESTIMATE * fees.strategyBaseFeeWei;
    const cfg = reconciliation.buildReconcileConfig(process.env, HEAVY_ESTIMATE);
    const clamp = (balance: bigint): { affordable: boolean; priorityFeeWei: bigint } =>
        reconciliation.computeAffordablePriorityFee({
            desiredPriorityFeeWei: fees.maxPriorityFeePerGas > cfg.priorityFeeStepWei ? fees.maxPriorityFeePerGas : cfg.priorityFeeStepWei,
            ceilingWei: cfg.maxPriorityFeeCeilingWei,
            walletBalanceWei: balance,
            snipeValueWei: snipeValue,
            baseFeeWei: fees.strategyBaseFeeWei,
            buyGasLimit: HEAVY_ESTIMATE,
            sellGasLimit: cfg.sellGasLimit,
            reserveSellGas: cfg.reserveSellGas,
        });
    expect(clamp(needed - 1n).affordable).toBe(false);
    expect(clamp(needed).affordable).toBe(false);
    expect(clamp(needed + 1n)).toEqual({ affordable: true, priorityFeeWei: 0n, affordabilityBoundWei: 0n });
    const gateFloor =
        snipeValue +
        chain.gas.maxGasLimit * fees.maxFeePerGas +
        preflight.computeWorstCasePublicExitGas({ baseFeeWei: fees.strategyBaseFeeWei, sellGasLimit: chain.gas.maxGasLimit, sellGasBuffer: exitGateBuffer() }) +
        parseEther(chain.gasBuffer);
    // Every balance of the three scenarios clears the entry gate, so the clamp decides.
    expect(gateFloor).toBeLessThan(needed - 1n);
    return { needed, snipeValue, reserve, gateFloor };
}

type Side = 'below' | 'at' | 'above';
const OFFSET: Record<Side, bigint> = { below: -1n, at: 0n, above: 1n };

/** One of the three reserve scenarios (see the file header). */
async function reserveScenario(side: Side, tag: string): Promise<void> {
    let boundary!: Boundary;
    let fees!: FeeFacts;
    let balance = 0n;
    let held: Bought | undefined;
    await runScenario({
        name: `fee-gas-eth-v2-reserve-${side}`,
        tag,
        chain: 'eth',
        dexType: 'v2',
        async steps(sc) {
            fees = await setEip1559Fees(sc);
            sc.node.setFees({ estimateGas: HEAVY_ESTIMATE });
            boundary = await affordabilityBoundary(sc, fees);
            balance = boundary.needed + OFFSET[side];
            sc.node.setBalance(sc.wallet.address, balance);
            // Launch, and wait for the strategy's decision. The boundary above is today's
            // computation, which AUD-TX-007 (doubled base fee), AUD-TX-021 (no priority fee in the
            // reserve) and AUD-TX-027 (sell gas at the buy estimate) shape; a fix of any of them
            // moves it, and this says so instead of failing later on an unrelated assertion.
            const decide = async (s: Scenario<'v2'>): Promise<number> => {
                const { block } = await s.fireNewPair();
                await stepUntilTrue(() => opLogged('mev.escalation.unaffordable') || s.node.submitted.length > 0, { what: 'the strategy deciding (unaffordable, or the bundle submitted)', maxSteps: 20_000 });
                const refused = opLogged('mev.escalation.unaffordable');
                if (refused !== (side !== 'above')) {
                    throw new Error(
                        `The affordability boundary moved: ${{ below: 'one wei below', at: 'exactly at', above: 'one wei above' }[side]} today's boundary the buy was ${refused ? 'refused' : 'submitted'}. ` +
                            'A fix of AUD-TX-007, AUD-TX-021 or AUD-TX-027 looks landed: re-derive the boundary and re-record the three fee-gas-eth-v2-reserve recordings in a behavior: commit citing that ID.',
                    );
                }
                return block;
            };
            if (side === 'above') {
                held = await buyArmed(sc, decide);
                return;
            }
            await listen(sc);
            await decide(sc);
            // A bounded window at the network's cadence: two 12 s slots pass and nothing is sent.
            const until = Date.now() + 24_000;
            await driveSlots(sc, { what: 'the 24 s window after the refusal', until: () => Date.now() >= until });
        },
        async assertComplete(sc) {
            // The safety bank ran and the entry gate passed: the clamp decided.
            expect(checkerReads(sc)).toBeGreaterThan(0);
            expect(opLogged('entry.exit-affordability.refused')).toBe(false);
            expect(sc.node.callLog.some((c) => c.method === 'eth_estimateGas')).toBe(true);
            if (side !== 'above') {
                const refused = opEntries('mev.escalation.unaffordable');
                expect(refused.map((e) => [e.attempt, e.walletBalanceWei, e.snipeValueWei, e.buyGasLimit, e.sellGasLimit])).toEqual([
                    [0, balance.toString(), boundary.snipeValue.toString(), HEAVY_ESTIMATE.toString(), HEAVY_ESTIMATE.toString()],
                ]);
                expect(String(opEntries('buy.snipe.fail-clean')[0]?.reason)).toContain('MEV submit unaffordable');
                // AUD-BUY-037 (registered by plan 23-22): the fail-clean line is the fixed text of an
                // exhausted private inclusion whatever ended the snipe, so this refusal before any
                // submission reads "hardened private inclusion exhausted" with the 4-attempt budget and
                // a pointer to Flashbots stats lines that were never logged.
                const failClean = recordedLogs().filter((l) => l.obj?.op === 'buy.snipe.fail-clean');
                expect(failClean).toHaveLength(1);
                const fc = failClean[0];
                const stillFixedText =
                    fc.msg === 'Snipe FAILED CLEAN: hardened private inclusion exhausted — zero ETH spent, no trades row; snipes never auto-go-public' &&
                    fc.obj!.attempts === 4 &&
                    fc.obj!.statsRef === 'op:flashbots.bundle.stats';
                if (!stillFixedText) {
                    throw new Error(
                        `AUD-BUY-037 looks fixed: the fail-clean line of an affordability refusal now reads ${JSON.stringify({ msg: fc.msg, attempts: fc.obj!.attempts, statsRef: fc.obj!.statsRef })}. ` +
                            'Re-record fee-gas-eth-v2-reserve-below and -at in a behavior: commit citing AUD-BUY-037.',
                    );
                }
                expect(opLogged('flashbots.bundle.stats')).toBe(false);
                // Refused before submit: no simulation, no bundle, no submission, no trades row.
                expect(sc.node.submitted).toHaveLength(0);
                expect(sc.node.relay).toHaveLength(0);
                expect(botSubmits(sc)).toHaveLength(0);
                expect(sc.graph.db.prepare('SELECT 1 FROM trades').get()).toBeUndefined();
                return;
            }
            // Above: submitted with the fee the clamp leaves (0), at the strategy's own fee terms.
            const landed = await assertBuyLanded(sc as Scenario<'v2'>, held!);
            const { tx } = held!;
            expect(tx.type).toBe(2);
            // One wei of headroom leaves a 0 priority fee today; any other fee means the boundary moved.
            if (tx.maxPriorityFeePerGas !== 0n) {
                throw new Error(
                    `The affordability boundary moved: one wei above today's boundary the buy was sent with priority fee ${String(tx.maxPriorityFeePerGas)}, not 0. ` +
                        'A fix of AUD-TX-007, AUD-TX-021 or AUD-TX-027 looks landed: re-derive the boundary and re-record the three fee-gas-eth-v2-reserve recordings in a behavior: commit citing that ID.',
                );
            }
            expect(tx.maxFeePerGas).toBe(fees.strategyBaseFeeWei);
            expect(tx.gasLimit).toBe(HEAVY_ESTIMATE);
            expect(landed.effectiveGasPrice).toBe(BASE_FEE);
            expect(opLogged('mev.escalation.unaffordable')).toBe(false);
        },
    });
}

describe('golden master: the risk gate and the fee and gas computation (CHAR-02)', () => {
    it('risk-gate-refused: with MAX_OPEN_POSITIONS open buys already recorded, a new ETH V2 pair is refused by the risk gate and nothing is sent', async () => {
        let seeded: string[] = [];
        await runScenario({
            name: 'risk-gate-refused',
            tag: 'KEEP',
            chain: 'eth',
            dexType: 'v2',
            overrides: { MAX_OPEN_POSITIONS: String(MAX_OPEN) },
            async steps(sc) {
                // Two open positions, recorded through the real insert statement before the pair arrives.
                seeded = Array.from({ length: MAX_OPEN }, (_, i) => getAddress(ethers.dataSlice(ethers.id(`realpath.plan-23-22.open-position-${i}`), 12)));
                for (const [i, token] of seeded.entries()) {
                    sc.graph.dbModule.insertTrade.run({
                        token: token.toLowerCase(), chain: 'eth', action: 'buy', txHash: ethers.id(`realpath.plan-23-22.open-position-buy-${i}`), block: null,
                        timestamp: Math.floor(Date.now() / 1000), amountIn: sc.ctx.chain.snipeAmount, amountOut: null, gasCost: null, priceAtAction: null,
                        status: 'pending', poolType: 'v2', feeTier: null, dexName: sc.dex.name,
                    });
                }
                await listen(sc);
                await sc.fireNewPair();
                await stepUntilTrue(() => msgEntry('Risk check failed, skipping snipe') !== undefined || sc.node.submitted.length > 0, { what: 'the risk gate deciding', maxSteps: 20_000 });
                const until = Date.now() + 24_000;
                await driveSlots(sc, { what: 'the 24 s window after the refusal', until: () => Date.now() >= until });
            },
            assertComplete(sc) {
                const refusal = msgEntry('Risk check failed, skipping snipe') as { token?: string; reason?: string; details?: string };
                expect(getAddress(String(refusal.token))).toBe(getAddress(sc.token));
                expect(refusal.reason).toBe('max_positions');
                expect(refusal.details).toBe(`Open positions (${MAX_OPEN}) at limit (${MAX_OPEN})`);
                expect(recordedAlerts().some((a) => a.via === 'ctx' && a.chain === 'eth' && String(a.message).startsWith(`*Risk: Open positions (${MAX_OPEN}) at limit (${MAX_OPEN})*`))).toBe(true);
                // Refused before the safety bank: no checker read, no quote, nothing sent.
                expect(checkerReads(sc)).toBe(0);
                expect(sc.node.submitted).toHaveLength(0);
                expect(sc.node.relay).toHaveLength(0);
                // The timeline: the seeded rows as db entries, no submit entry.
                const entries = sc.timeline.entries;
                expect(entries.some((e: TimelineEntry) => e.kind === 'submit')).toBe(false);
                const inserts = entries.filter((e: TimelineEntry) => e.kind === 'db' && e.table === 'trades' && e.op === 'insert').map((e) => String((e as { row: Record<string, unknown> }).row.token));
                expect(inserts).toEqual(seeded.map((t) => t.toLowerCase()));
                const open = sc.graph.db.prepare("SELECT token FROM trades WHERE status = 'pending' AND action = 'buy' ORDER BY id").all() as Array<{ token: string }>;
                expect(open.map((r) => r.token)).toEqual(seeded.map((t) => t.toLowerCase()));
            },
        });
    });

    it('fee-gas-eth-v2: an ETH V2 Flashbots buy at a 30 gwei base fee and a 2 gwei priority fee is sent with the fee and gas fields the strategy computes', async () => {
        let fees!: FeeFacts;
        let held!: Bought;
        await runScenario({
            name: 'fee-gas-eth-v2',
            tag: 'SUSPECT(AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-003,AUD-TX-007,AUD-TX-012)',
            chain: 'eth',
            dexType: 'v2',
            async steps(sc) {
                fees = await setEip1559Fees(sc);
                held = await buyArmed(sc);
            },
            async assertComplete(sc) {
                const reconciliation: Reconciliation = await import('../../../src/utils/mevStrategies/reconciliation');
                const landed = await assertBuyLanded(sc, held);
                const { tx } = held;
                const estimate = BigInt(String((await sc.node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_estimateGas', params: [{ from: sc.wallet.address, to: tx.to, data: tx.data, value: ethers.toQuantity(tx.value) }] }) as { result: string }).result));
                // The strategy's fee: the chain priority fee over the 1 gwei step, through the real
                // clamp with the inputs the strategy reads (10 ETH wallet: the clamp does not bind).
                const cfg = reconciliation.buildReconcileConfig(process.env, estimate);
                const chosen = reconciliation.computeAffordablePriorityFee({
                    desiredPriorityFeeWei: fees.maxPriorityFeePerGas > cfg.priorityFeeStepWei ? fees.maxPriorityFeePerGas : cfg.priorityFeeStepWei,
                    ceilingWei: cfg.maxPriorityFeeCeilingWei,
                    walletBalanceWei: parseEther('10'),
                    snipeValueWei: tx.value,
                    baseFeeWei: fees.strategyBaseFeeWei,
                    buyGasLimit: estimate,
                    sellGasLimit: cfg.sellGasLimit,
                    reserveSellGas: cfg.reserveSellGas,
                });
                expect(chosen.priorityFeeWei).toBe(PRIORITY_FEE);
                expect(tx.type).toBe(2);
                expect(tx.maxPriorityFeePerGas).toBe(chosen.priorityFeeWei);
                // maxFeePerGas = baseFeeWei + priority, where baseFeeWei is twice the block's base fee.
                expect(fees.strategyBaseFeeWei).toBe(2n * BASE_FEE);
                expect(tx.maxFeePerGas).toBe(fees.strategyBaseFeeWei + chosen.priorityFeeWei);
                expect(tx.gasLimit).toBe(estimate);
                expect(tx.gasPrice).toBeNull();
                // EIP-1559 charges the block's base fee plus the priority fee.
                expect(landed.effectiveGasPrice).toBe(BASE_FEE + PRIORITY_FEE);
            },
        });
    });

    it('fee-gas-eth-v2-reserve-below: one wei below what the affordability clamp needs, the Flashbots strategy refuses the buy before submitting', async () => {
        await reserveScenario('below', 'SUSPECT(AUD-BUY-037,AUD-TX-007,AUD-TX-021,AUD-TX-027)');
    });

    it('fee-gas-eth-v2-reserve-at: exactly at what the affordability clamp needs (zero headroom), the Flashbots strategy refuses the buy before submitting', async () => {
        await reserveScenario('at', 'SUSPECT(AUD-BUY-037,AUD-TX-007,AUD-TX-021,AUD-TX-027)');
    });

    it('fee-gas-eth-v2-reserve-above: one wei above what the affordability clamp needs, the buy is sent with the priority fee the clamp leaves (zero)', async () => {
        await reserveScenario('above', 'SUSPECT(AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-003,AUD-TX-007,AUD-TX-012,AUD-TX-021,AUD-TX-027)');
    });

    it('fee-gas-eth-v2-legacy: on a legacy-fee node the ETH V2 Flashbots buy is a type-0 transaction priced by gasPrice, with no EIP-1559 fee field', async () => {
        let held!: Bought;
        await runScenario({
            name: 'fee-gas-eth-v2-legacy',
            tag: 'SUSPECT(AUD-ANTIRUG-024,AUD-DB-002,AUD-DB-004,AUD-EXIT-003,AUD-TX-012,AUD-TX-030)',
            chain: 'eth',
            dexType: 'v2',
            async steps(sc) {
                sc.node.setFees({ legacy: true, gasPrice: LEGACY_GAS_PRICE });
                // Real ethers reads the node as a legacy chain: no maxFeePerGas, the set gasPrice.
                const fee = await stepUntil(sc.ctx.httpProvider.getFeeData());
                await stepFor(1_000);
                expect(fee.maxFeePerGas).toBeNull();
                expect(fee.maxPriorityFeePerGas).toBeNull();
                expect(fee.gasPrice).toBe(LEGACY_GAS_PRICE);
                held = await buyArmed(sc, fireLegacyPair);
            },
            async assertComplete(sc) {
                const reconciliation: Reconciliation = await import('../../../src/utils/mevStrategies/reconciliation');
                const landed = await assertBuyLanded(sc, held);
                const { tx } = held;
                expect(tx.type).toBe(0);
                // The helper's clamped fee for this buy: no priority field on a legacy node, so the
                // 1 gwei escalation step, through the real clamp (10 ETH wallet: it does not bind).
                const cfg = reconciliation.buildReconcileConfig(process.env, tx.gasLimit);
                const clamped = reconciliation.computeAffordablePriorityFee({
                    desiredPriorityFeeWei: cfg.priorityFeeStepWei,
                    ceilingWei: cfg.maxPriorityFeeCeilingWei,
                    walletBalanceWei: parseEther('10'),
                    snipeValueWei: tx.value,
                    baseFeeWei: LEGACY_GAS_PRICE,
                    buyGasLimit: tx.gasLimit,
                    sellGasLimit: cfg.sellGasLimit,
                    reserveSellGas: cfg.reserveSellGas,
                });
                expect(clamped.priorityFeeWei).toBe(GWEI);
                // AUD-TX-030 (registered by plan 23-22): the Flashbots legacy branch sends the node's
                // gasPrice (times the gas multiplier, none on a buy) and drops that clamped fee, where
                // the bloXroute and passthrough legacy branches send base + the clamped fee (26 gwei here).
                if (tx.gasPrice !== LEGACY_GAS_PRICE) {
                    throw new Error(
                        `AUD-TX-030 looks fixed: the legacy Flashbots buy is priced ${String(tx.gasPrice)} wei, not the node's gasPrice ${LEGACY_GAS_PRICE} ` +
                            `(base + the clamped fee would be ${LEGACY_GAS_PRICE + clamped.priorityFeeWei}). Re-record fee-gas-eth-v2-legacy in a behavior: commit citing AUD-TX-030.`,
                    );
                }
                expect(tx.maxFeePerGas).toBeNull();
                expect(tx.maxPriorityFeePerGas).toBeNull();
                expect(landed.effectiveGasPrice).toBe(LEGACY_GAS_PRICE);
                // No block and no recorded line carries an EIP-1559 fee field.
                const head = (await sc.node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] })) as { result: Record<string, unknown> };
                expect('baseFeePerGas' in head.result).toBe(false);
                const text = serializeTimeline(sc.timeline.entries.slice(), { scenario: 'fee-gas-eth-v2-legacy', tag: 'KEEP' });
                expect(text).toContain('"gasPrice":"25000000000"');
                expect(text).not.toMatch(/maxFeePerGas|maxPriorityFeePerGas|baseFeePerGas/);
            },
        });
    });
});
