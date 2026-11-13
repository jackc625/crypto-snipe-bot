// test/realpath/triage/AUD-ANTIRUG-024.test.ts
// Phase 23 plan 23-10 (orchestrator scope addition; AUDIT-02): AUD-ANTIRUG-024, a chain's first
// anti-rug start on a fresh database raises a false GAP DETECTED.
//
// The sites: src/anti-rug/detector.ts startChainAntiRugListener runs setAntirugDryRunStarted on
// every call, before the WS/HTTP split and before the backfill of the same call; in
// src/utils/db.ts that statement INSERTs the chain_state row with last_seen_block 0 when none
// exists. backfillSinceLastSeen then finds a row, so its documented no-prior-state path (seed the
// cursor with the current block, op antirug.backfill.seed) is never taken; gapBlocks = head - 0
// exceeds maxBackfillBlocks (7200) on any real chain, and the gap branch logs an error, sends the
// "[GAP DETECTED] ... review anti-rug events manually" alert and broadcasts antirug_event kind
// gap-detected, then moves the cursor to the head.
//
// Proof on the real path: a fresh database (the harness's :memory: database, built by the real
// migrations, as `npm run db:init` leaves a new file), an ETH chain with a WebSocket URL, and boot
// step 4 exactly as startMultiChainBot runs it after the listeners: the real
// resumeAntiRugMonitoring([ctx]) with no open positions, which verifies the allowlist (each locker
// is a deployed contract on mainnet, so the node serves code for it) and starts the chain's
// anti-rug listener. Precondition, true for the bug and a fix alike: chain_state has no row before
// the start. Measured: whether the start raised the gap alert, broadcast a gap-detected event, and
// took the seed path. The cursor ends at the head either way.
//
// Fix signal (D-08): a backfill that treats a row it never wrote (last_seen_block 0) as no prior
// state, one of the finding's two recommended shapes, reads "looks fixed" (fix-shaped src
// mutation, restored).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { harnessState } from '../harness/chain';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntil } from '../harness/world';
import { opEntries } from './fixtures/AUD-EXIT-002-position';

const DEAD = '0x000000000000000000000000000000000000dead';
/** Runtime code for an allowlisted locker: deployed contracts on mainnet, so getCode is non-empty. */
const LOCKER_CODE = '0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063';

describe('AUD-ANTIRUG-024: the first anti-rug start on a fresh database raises a false GAP DETECTED', () => {
    it('first-start-false-gap-alert: boot step 4 on a fresh database alerts that the whole chain history was missed instead of seeding the cursor', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node } = sc;
        for (const e of [...sc.ctx.chain.antiRug.allowlistV2, ...sc.ctx.chain.antiRug.allowlistV3]) if (e.address.toLowerCase() !== DEAD) node.setCode(e.address, LOCKER_CODE);
        expect(sc.ctx.wsProvider).not.toBeNull();
        expect(sc.graph.db.prepare('SELECT COUNT(*) AS n FROM chain_state').get()).toEqual({ n: 0 });
        expect(sc.graph.db.prepare("SELECT COUNT(*) AS n FROM trades WHERE action = 'buy'").get()).toEqual({ n: 0 });

        const fromLog = recordedLogs().length;
        const fromAlert = recordedAlerts().length;
        const fromBroadcast = harnessState().broadcasts.length;
        await stepUntil(sc.graph.bot.resumeAntiRugMonitoring([sc.ctx]));
        await stepFor(1_000);
        const gapAlerts = recordedAlerts()
            .slice(fromAlert)
            .filter((a) => String(a.message).includes('[GAP DETECTED]'));
        const gapEvents = harnessState()
            .broadcasts.slice(fromBroadcast)
            .filter((b) => b.type === 'antirug_event' && (b.data as { kind?: string }).kind === 'gap-detected');

        knownBug(ctx, 'AUD-ANTIRUG-024', {
            claim: 'first-start-false-gap-alert',
            correct: { gapAlertSent: false, gapEventBroadcast: false, cursorSeeded: true },
            observed: { gapAlertSent: true, gapEventBroadcast: true, cursorSeeded: false },
            actual: { gapAlertSent: gapAlerts.length > 0, gapEventBroadcast: gapEvents.length > 0, cursorSeeded: opEntries('antirug.backfill.seed', fromLog).length > 0 },
            expectedPlain: 'The first anti-rug start on a new database seeds the block cursor at the current block quietly; there is no earlier window to review.',
            actualPlain: 'The first start on a fresh database logged an error, sent the [GAP DETECTED] alert and broadcast a gap-detected event claiming the whole chain history (from block 0) was missed and must be reviewed manually.',
        });
        // Bug details, after the marker: the alert names block 0 as the start of the gap, the row was
        // created by the dry-run stamp with block 0, and the cursor still ends at the head.
        expect(gapAlerts).toHaveLength(1);
        expect(gapAlerts[0].message).toBe(`*[GAP DETECTED]* eth missed ${node.head} blocks (0-${node.head}); backfill skipped per D-BACKFILL fail-closed; review anti-rug events manually`);
        expect(gapEvents.map((b) => (b.data as { fromBlock: number }).fromBlock)).toEqual([0]);
        const gap = opEntries('antirug.backfill.gap-detected', fromLog);
        expect(gap.map((o) => [o.lastSeen, o.currentBlock])).toEqual([[0, node.head]]);
        expect(sc.graph.db.prepare('SELECT last_seen_block AS b, antirug_dry_run_started AS d FROM chain_state WHERE chain = ?').get('eth')).toEqual({ b: node.head, d: expect.any(Number) });
    });
});
