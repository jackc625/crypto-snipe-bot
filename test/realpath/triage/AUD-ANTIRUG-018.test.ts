// test/realpath/triage/AUD-ANTIRUG-018.test.ts
// Phase 23 plan 23-10 (orchestrator scope addition; AUDIT-02): AUD-ANTIRUG-018 (S1, STRAND), the
// HTTP anti-rug poller asks for its whole outstanding range in one eth_getLogs and resumes from the
// stored block after a restart, so a gap wider than the provider's log-range limit fails every
// poll from then on while the chain reports connected.
//
// The sites (src/anti-rug/detector.ts startHttpPollingAntiRug, the fallback for a chain without a
// WebSocket URL): the poller seeds lastBlock from the chain_state row when one exists; every 2 s it
// calls getLogs from lastBlock + 1 to the current block, unchunked (the backfill's chunked
// getLogsForBackfill is not used); lastBlock and the row advance only after a successful poll, or
// on a tick with no registered positions; a failed tick only logs antirug.http-polling.error, and
// the poller set healthState connected when it started. At boot (src/bot.ts
// resumeAntiRugMonitoring) the held positions are re-registered (step 3) before the per-chain
// start (step 4), so the poller never takes a no-positions tick after a restart.
//
// Proof on the real path, with a provider that refuses an over-range eth_getLogs the way Alchemy's
// free tier does (at most 10 blocks per request, inclusive; fixtures/AUD-ANTIRUG-018-range-limit.ts
// states the limit, the providers that apply it and the repository evidence; it decides each
// request from that request's own range, so a chunked request is answered). On a temp-file
// database, an ETH chain configured WITHOUT a WebSocket URL (ETH_WS_URL empty) boots the way
// startMultiChainBot does: the real HTTP DEX poller, resumeMultiChainMonitoring and
// resumeAntiRugMonitoring (the anti-rug poller starts; its first tick with no positions moves the
// cursor to the head). A real snipe is bought and armed, and its anti-rug poll is shown working:
// the stored cursor follows the head. Then the bot goes down (restartGraph: the same file and node)
// for 6 minutes of fake time, 30 blocks of 12 s, and boots again the same way. Inside that downtime
// (the tenth block) an LP holder moves LP tokens of the pair to an allowlisted locker: a log the
// evaluator judges with its cheapest verdict (op antirug.allowlist-hit), on whichever path reads it
// (the live poll or a backfill), and which changes nothing for the later pull. One minute after the
// second boot the deployer pulls 95 percent of the liquidity through the real router
// (fixtures/AUD-EXIT-014-rug.ts). Measured over a bounded window of 2 minutes of fake time after the
// pull (60 poll ticks): whether the bot evaluated the downtime log (the missed blocks were read,
// review WR-08), whether it evaluated the pull (an unsafe verdict schedules op
// antirug.confirm-gate.scheduled), whether the stored cursor reached the pull's block, and the
// WS-health state the dashboard was last told. Anti-rug stays in dry-run (the default): the measure
// is detection, nothing is sold.
//
// About 2 minutes of ETH downtime is enough (10 blocks); the 6 minutes here are an ordinary
// restart. Whether the operator runs any chain without a WebSocket URL is unknown (ESC-ANTIRUG-03,
// "Not sure"); the grade does not depend on it.
//
// Fix signal (D-08): a poller that reads its outstanding range through the chunked
// getLogsForBackfill (the recommendation) reads "looks fixed" (fix-shaped src mutation, restored).
// A poller that skips the gap (its cursor jumps to the head at start or on a wide range) evaluates
// the later pull but never the downtime log, so it reads "the failure changed" (review WR-08): a
// rug mined during the downtime would be lost for good on an HTTP-only chain.
// The stacked pollers every registration starts are AUD-ANTIRUG-007's claim and are not counted.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Wallet, ethers, parseEther } from 'ethers';
import { harnessState } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, createTempDbFile, restartGraph, stepFor, stepUntil, stepUntilTrue, v2AmountOut, type Scenario } from '../harness/world';
import { FREE_TIER_LOG_RANGE, limitLogRange, logQueriesFor } from './fixtures/AUD-ANTIRUG-018-range-limit';
import { installSellPath } from './fixtures/AUD-EXIT-001-sell-path';
import { buyRow, opEntries, opLogged } from './fixtures/AUD-EXIT-002-position';
import { pullLiquidity } from './fixtures/AUD-EXIT-014-rug';

const DEAD = '0x000000000000000000000000000000000000dead';
const V2_PAIR = new Interface(['function transfer(address to, uint256 value) returns (bool)', 'event Transfer(address indexed from, address indexed to, uint256 value)']);
/** Runtime code for an allowlisted locker: deployed contracts on mainnet, so getCode is non-empty. */
const LOCKER_CODE = '0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063';

function cursor(sc: Scenario): number | undefined {
    return (sc.graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get('eth') as { b: number } | undefined)?.b;
}

/** startMultiChainBot for a chain without a WebSocket URL: the DEX poller, then the two resumes. */
async function boot(sc: Scenario<'v2'>): Promise<void> {
    const fromLog = recordedLogs().length;
    await sc.graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
    await stepUntilTrue(() => recordedLogs().slice(fromLog).some((l) => l.msg === 'Listening for PairCreated events via HTTP polling'), { what: 'the HTTP DEX poller starting' });
    sc.graph.bot.resumeMultiChainMonitoring([sc.ctx]);
    await stepUntil(sc.graph.bot.resumeAntiRugMonitoring([sc.ctx]));
    await stepUntilTrue(() => opLogged('antirug.http-polling.started', fromLog), { what: 'the anti-rug HTTP poller starting' });
}

/** An LP-token transfer of `pair` to `locker`, signed by an LP holder and mined with its Transfer log; returns its block. */
async function lpTransferToLocker(sc: Scenario, pair: string, locker: string): Promise<number> {
    const holder = new Wallet(ethers.id('realpath.aud-antirug-018.lp-holder'));
    sc.node.setBalance(holder.address, parseEther('1'));
    const raw = await holder.signTransaction({
        chainId: 1, nonce: sc.node.minedCount(holder.address), to: pair, value: 0n, gasLimit: 80_000n, type: 2,
        maxFeePerGas: 60_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
        data: V2_PAIR.encodeFunctionData('transfer', [locker, 1_000n]),
    });
    const hash = sc.node.addForeignTransaction(raw);
    const log = V2_PAIR.encodeEventLog('Transfer', [holder.address, locker, 1_000n]);
    sc.node.mine({ include: [hash], logs: [{ address: pair, topics: log.topics, data: log.data, transactionHash: hash }] });
    return sc.node.head;
}

function healthShown(from: number): string | null {
    const shown = harnessState()
        .broadcasts.slice(from)
        .filter((b) => b.type === 'chain_ws_health_change' && (b.data as { chain?: string }).chain === 'eth')
        .map((b) => String((b.data as { state?: string }).state));
    return shown.length > 0 ? shown[shown.length - 1] : null;
}

describe('AUD-ANTIRUG-018: the HTTP anti-rug poller asks for its whole outstanding range and never recovers from a gap wider than the provider limit', () => {
    it('restart-gap-blinds-http-poller: after an ordinary restart on a chain without a WebSocket URL, every anti-rug poll is refused by the provider range limit and a 95 percent liquidity pull is never evaluated', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() }, overrides: { ETH_WS_URL: '' } });
        expect(sc.ctx.wsProvider).toBeNull();
        const limit = limitLogRange(sc.node);
        for (const e of [...sc.ctx.chain.antiRug.allowlistV2, ...sc.ctx.chain.antiRug.allowlistV3]) if (e.address.toLowerCase() !== DEAD) sc.node.setCode(e.address, LOCKER_CODE);

        // First boot; the anti-rug poller's no-positions tick moves the cursor to the head.
        await boot(sc);
        await stepUntilTrue(() => cursor(sc) === sc.node.head, { what: 'the anti-rug poller moving the cursor to the head' });

        // A real snipe found by the HTTP DEX poller, bought and armed.
        await sc.fireNewPair();
        await stepUntilTrue(() => sc.node.submitted.length === 1, { what: 'the bot submitting its buy', maxSteps: 20_000 });
        const buy = sc.node.submitted[0];
        await stepFor(12_000);
        sc.node.mine({ include: [buy.hash] });
        await stepUntilTrue(() => opLogged('exit.monitor.started') && opLogged('antirug.register'), { what: 'the position being armed', maxSteps: 20_000 });
        installSellPath(sc, { bought: v2AmountOut(buy.tx.value, sc.reserves.weth, sc.reserves.token) });
        const tradeId = buyRow(sc)!.id;
        // Control: with the position registered, the anti-rug poll covers the pair and the stored
        // cursor follows the head block by block.
        const fromControl = sc.node.callLog.length;
        sc.node.mine();
        sc.node.mine();
        await stepUntilTrue(() => cursor(sc) === sc.node.head && logQueriesFor(sc.node, sc.pair, fromControl).length > 0, { what: 'the anti-rug poll following the head with the position registered' });
        const storedBeforeRestart = cursor(sc)!;
        const refusedBeforeRestart = limit.fired;

        // The bot is down for 6 minutes (30 blocks of 12 s), then boots again on the same file. The
        // tenth downtime block carries an LP transfer of the pair to an allowlisted locker.
        await restartGraph(sc);
        const locker = sc.ctx.chain.antiRug.allowlistV2.map((e) => e.address).find((a) => a.toLowerCase() !== DEAD)!;
        let gapLogBlock = -1;
        for (let i = 0; i < 30; i++) {
            await stepFor(12_000);
            if (i === 9) gapLogBlock = await lpTransferToLocker(sc, sc.pair, locker);
            else sc.node.mine();
        }
        // Setup fact, true under the bug and every fix: the downtime log sits inside the gap.
        expect(gapLogBlock).toBeGreaterThan(storedBeforeRestart);
        expect(gapLogBlock).toBeLessThan(sc.node.head);
        const fromRestartLog = recordedLogs().length;
        const fromRestartCall = sc.node.callLog.length;
        const fromBroadcast = harnessState().broadcasts.length;
        await boot(sc);
        expect(opEntries('antirug.register', fromRestartLog).map((o) => o.tradeId)).toEqual([tradeId]);
        await stepFor(60_000);

        // The rug, then 2 minutes of fake time (60 poll ticks).
        const fromPull = recordedLogs().length;
        const pull = await pullLiquidity(sc, { removeBps: 9_500n });
        await stepFor(120_000);
        const evaluated = opEntries('antirug.confirm-gate.scheduled', fromPull).some((o) => o.tradeId === tradeId);
        const gapLogEvaluated = opEntries('antirug.allowlist-hit', fromRestartLog).some((o) => o.tradeId === tradeId && String(o.destination).toLowerCase() === locker.toLowerCase());

        knownBug(ctx, 'AUD-ANTIRUG-018', {
            claim: 'restart-gap-blinds-http-poller',
            correct: { gapLogEvaluated: true, rugEvaluated: true, cursorReachedRugBlock: true, healthShown: 'connected' },
            observed: { gapLogEvaluated: false, rugEvaluated: false, cursorReachedRugBlock: false, healthShown: 'connected' },
            actual: { gapLogEvaluated, rugEvaluated: evaluated, cursorReachedRugBlock: (cursor(sc) ?? -1) >= pull.block, healthShown: healthShown(fromBroadcast) },
            expectedPlain: 'After a restart on a chain without a WebSocket URL, the anti-rug poller catches up the missed blocks in provider-sized requests, evaluating the logs mined during the downtime, and then evaluates a liquidity pull on a held position.',
            actualPlain: 'After 6 minutes of downtime the poller asked for the whole 30-plus-block gap in one eth_getLogs every 2 seconds; the provider refused every request (10-block limit), the cursor never moved, neither an LP log mined during the downtime nor a 95 percent liquidity pull after it was ever evaluated, and the dashboard was told the chain was connected.',
        });
        // Bug details, after the marker. Every anti-rug query since the restart started at the
        // stored block + 1 and was wider than the limit; the provider refused each one and the bot
        // only logged antirug.http-polling.error; the cursor is still the pre-restart block.
        const queries = logQueriesFor(sc.node, sc.pair, fromRestartCall);
        expect(queries.length).toBeGreaterThanOrEqual(60);
        expect(queries.every((q) => q.from === storedBeforeRestart + 1 && q.span > FREE_TIER_LOG_RANGE)).toBe(true);
        expect(limit.fired - refusedBeforeRestart).toBeGreaterThanOrEqual(queries.length);
        const errors = opEntries('antirug.http-polling.error', fromRestartLog);
        expect(errors.length).toBeGreaterThanOrEqual(queries.length);
        expect(errors.every((o) => String(o.err).includes(`up to a ${FREE_TIER_LOG_RANGE} block range`))).toBe(true);
        expect(cursor(sc)).toBe(storedBeforeRestart);
        expect(opEntries('antirug.http-polling.started', fromRestartLog).every((o) => o.startBlock === storedBeforeRestart)).toBe(true);
        expect(sc.graph.detector.getRegisteredPositions('eth').map((p) => p.tradeId)).toEqual([tradeId]);
    });
});
