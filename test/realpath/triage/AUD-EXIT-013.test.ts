// test/realpath/triage/AUD-EXIT-013.test.ts
// Phase 23 plan 23-07 Task 2 (AUDIT-02): AUD-EXIT-013 (merged at 22-28 with AUD-ANTIRUG-011).
// After a restart a position is quoted, sold and anti-rug-routed through the FIRST V2 (or V3) dex
// of its chain, not the dex it was bought on, so a position bought on a second dex loses working
// exits.
//
// The sites: src/bot.ts resumeMultiChainMonitoring picks ctx.chain.dexes.find(isDexV2) (or
// isDexV3) and hands it to resumeExitMonitor, which uses it for every quote and sell; the buy row
// stores dex_name and the resume query never reads it. src/bot.ts resumeAntiRugMonitoring picks
// ctx.chain.dexes.find(d => d.dexType === trade.pool_type) the same way, and the registered
// position's dex is what the anti-rug exit sells through.
//
// Proof on the real path: a real ETH snipe on sushiswap-v2, the second V2 dex of the ETH template
// (uniswap-v2 is first). The real listener on the sushiswap factory buys through the sushiswap
// router, the real database stores dex_name "sushiswap-v2", and the running bot's exit monitor
// quotes the sushiswap router (control). The bot is then restarted on the same temp-file database
// (restartGraph) and the real resumeMultiChainMonitoring and resumeAntiRugMonitoring run. The
// uniswap-v2 router answers getAmountsOut for this token the way the real one would: it has no
// pair for it, so its getReserves call on the missing pair reverts with no data.
//
// What is measured (each from the node's call log or the bot's own registry):
//   - resume-quotes-first-v2-dex: which routers the resumed exit monitor quotes. Correct: the
//     sushiswap router. Today: the uniswap-v2 router.
//   - antirug-resume-registers-first-v2-dex: the dex of the re-registered anti-rug position.
//     Correct: sushiswap-v2. Today: uniswap-v2.
// Plus, after the first marker: with every quote reverting, the resumed monitor never evaluates
// the position at all (AUD-EXIT-003's null-quote path).
//
// Not proven here (code read, recorded in the finding): the dashboard force/emergency sells
// (src/api/routes/controls.ts findDex, the same first-of-type rule) and the re-arm after a failed
// dashboard sell, which keeps whatever dex the failed sell had (src/exitEngine.ts
// keepMonitoringFailedHeld).
//
// AUD-ANTIRUG-025 (a restart drops the anti-rug WebSocket subscription) is a different defect and
// is not asserted here; the test waits for the resume's own eth_unsubscribe to settle before
// teardown.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { getAddress } from 'ethers';
import { REVERT_EMPTY } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, createTempDbFile, restartGraph, stepFor, stepUntil, stepUntilTrue } from '../harness/world';
import { buyAndMine, buyRow, exitQuotes, exitStateRow, listen, opEntries, opLogged, waitAntiRugArmed } from './fixtures/AUD-EXIT-002-position';

const DEAD = '0x000000000000000000000000000000000000dead';
/** Runtime code for an allowlisted locker: deployed contracts on mainnet, so getCode is non-empty. */
const LOCKER_CODE = '0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063';

describe('AUD-EXIT-013: after a restart a position bought on a second dex is quoted and anti-rug-routed through the first dex of its type', () => {
    it('resume-quotes-first-v2-dex: a sushiswap-v2 position resumes quoting the uniswap-v2 router, and anti-rug re-registers it on uniswap-v2', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', dexName: 'sushiswap-v2', db: { file: createTempDbFile() } });
        const { node } = sc;
        const pollMs = sc.graph.exitEngine.exitConfig.pollIntervalMs;
        // The anti-rug allowlist lockers are deployed contracts (verifyAllowlistAtStartup reads them).
        for (const e of [...sc.ctx.chain.antiRug.allowlistV2, ...sc.ctx.chain.antiRug.allowlistV3]) if (e.address.toLowerCase() !== DEAD) node.setCode(e.address, LOCKER_CODE);
        const v2Dexes = sc.ctx.chain.dexes.filter((d) => d.dexType === 'v2');
        expect(v2Dexes.map((d) => d.name)).toEqual(['uniswap-v2', 'sushiswap-v2']);
        const sushiRouter = getAddress(sc.dex.routerAddress);
        const uniRouter = getAddress((v2Dexes[0] as { routerAddress: string }).routerAddress);
        expect(sc.dex.name).toBe('sushiswap-v2');

        // A real snipe on the second V2 dex, armed in the running bot.
        await listen(sc);
        const { buy } = await buyAndMine(sc);
        expect(getAddress(buy.tx.to!)).toBe(sushiRouter);
        await stepUntilTrue(() => opLogged('exit.monitor.started'), { what: 'the exit monitor starting', maxSteps: 20_000 });
        await waitAntiRugArmed(sc);
        const row = buyRow(sc)!;
        expect(row).toEqual(expect.objectContaining({ status: 'pending', dex_name: 'sushiswap-v2', pool_type: 'v2' }));
        // Control, before the restart: the in-process monitor quotes the dex the position was bought on.
        await stepFor(2 * pollMs, 50);
        const before = exitQuotes(sc);
        expect(before.length).toBeGreaterThanOrEqual(2);
        expect(new Set(before.map((q) => q.to))).toEqual(new Set([sushiRouter]));
        const savedState = exitStateRow(sc, row.id)!;
        expect(savedState).toBeDefined();

        // The real uniswap-v2 router has no pair for this token: its quote reverts with no data.
        node.setRead(uniRouter, 'getAmountsOut(uint256,address[])', REVERT_EMPTY);

        // Restart on the same file, then the real boot resume paths.
        await restartGraph(sc);
        expect(exitStateRow(sc, row.id)).toEqual(savedState);
        const fromLog = recordedLogs().length;
        const fromCall = node.callLog.length;
        sc.graph.bot.resumeMultiChainMonitoring([sc.ctx]);
        await stepUntil(sc.graph.bot.resumeAntiRugMonitoring([sc.ctx]));
        await stepUntilTrue(() => opLogged('exit.monitor.resumed', fromLog), { what: 'the restarted bot resuming the exit monitor' });
        // Three poll intervals: every quote the resumed monitor makes, and every request the
        // anti-rug resume queued (including the eth_unsubscribe of AUD-ANTIRUG-025), reach the node.
        await stepFor(3 * pollMs, 50);

        // Setup facts, true under the bug and a fix: the stored row names the dex and the resumed
        // monitor did quote.
        expect(buyRow(sc)!.dex_name).toBe('sushiswap-v2');
        const after = exitQuotes(sc, fromCall);
        expect(after.length).toBeGreaterThanOrEqual(2);
        const routersQuoted = [...new Set(after.map((q) => q.to))];

        knownBug(ctx, 'AUD-EXIT-013', {
            claim: 'resume-quotes-first-v2-dex',
            correct: { routersQuoted: [sushiRouter] },
            observed: { routersQuoted: [uniRouter] },
            actual: { routersQuoted },
            expectedPlain: 'After a restart the bot quotes (and would sell) a position through the dex it was bought on, the one stored on its trade row.',
            actualPlain: 'After a restart a position bought on sushiswap-v2 is quoted through the uniswap-v2 router, the first V2 dex of the chain, where the token has no pair, so every quote fails.',
        });
        // Bug details: every resumed quote reverted, so the position is never evaluated (no tick
        // completes, no exit can trigger; AUD-EXIT-003's null-quote path).
        expect(opEntries('exit.poll.cycle', fromLog).length).toBeGreaterThanOrEqual(2);
        expect(recordedLogs().slice(fromLog).filter((l) => l.msg === 'Price query returned null, skipping cycle').length).toBe(after.length);
        expect(recordedLogs().slice(fromLog).some((l) => l.msg === 'Exit engine tick')).toBe(false);

        const registered = sc.graph.detector.getRegisteredPositions('eth').filter((p) => p.tradeId === row.id);
        expect(registered).toHaveLength(1);
        knownBug(ctx, 'AUD-EXIT-013', {
            claim: 'antirug-resume-registers-first-v2-dex',
            correct: { antiRugDex: 'sushiswap-v2' },
            observed: { antiRugDex: 'uniswap-v2' },
            actual: { antiRugDex: registered[0].dex.name },
            expectedPlain: 'After a restart anti-rug re-registers the position with the dex it was bought on, so an anti-rug exit sells through that router.',
            actualPlain: 'After a restart anti-rug re-registers the sushiswap-v2 position with uniswap-v2, so an anti-rug exit would sell through a router that has no pair for the token.',
        });
    });
});
