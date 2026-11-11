// test/realpath/triage/AUD-TX-029.test.ts
// Phase 23 plan 23-09 (AUDIT-02): AUD-TX-029, registered by the 23-09 executor under the
// operator's standing instruction of 2026-11-11 (found while diagnosing the warn/error lines of
// AUD-TX-003's run). src/utils/mevStrategies/reconciliation.ts submitWithReconciliation ends a
// not-landed escalation with one branch, `if (ceilingHit || attempt >= cfg.maxRetries)`, and that
// branch always logs op mev.escalation.ceiling-hit and throws "MEV bundle not included after N
// attempt(s); priority-fee ceiling (<ceiling> wei) reached. Increase MEV_MAX_PRIORITY_FEE_GWEI
// ...". When the attempt budget runs out first, the ceiling was not reached: the escalated fee is
// step x (attempt + 1), 1 to 4 gwei for a snipe at defaults, against a 25 gwei buy ceiling. The
// text reaches the operator as the reason of buy.snipe.fail-clean, so after a missed snipe the
// operator is told to raise a ceiling that did not bind (and AUD-TX-010: a knob read nowhere).
//
// Proof on the real path: a real ETH V2 launch reaches the real listener and the bot's snipe
// escalates privately; no bundle is ever included (fixtures/AUD-TX-002-lock.ts missBundlesUntil:
// each bundle gets its 12 s slot, then an empty block), so all four attempts run and the snipe
// fails clean. The priority fee of every attempt is read from the signed bundle transactions with
// real ethers.
//
// What is measured: whether the bot reported the ceiling as reached (an error line whose message
// or reason says "ceiling ... reached") while the highest priority fee it ever submitted was below
// that ceiling. Correct: no (it reports the attempt budget as the cause). Today: yes. A fix-shaped
// src mutation (the attempt-budget case gets its own message) reads "looks fixed" (D-08), src
// restored byte for byte.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Transaction, getAddress } from 'ethers';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario } from '../harness/world';
import { listen, opEntries } from './fixtures/AUD-EXIT-002-position';
import { missBundlesUntil } from './fixtures/AUD-TX-002-lock';

const CEILING_REACHED = /ceiling[^.]*reached/i;

describe('AUD-TX-029: an escalation that ends on its attempt budget is reported as a priority-fee ceiling hit', () => {
    it('attempt-budget-reported-as-ceiling-hit: a snipe whose four private attempts all miss at 1 to 4 gwei is reported as having reached the 25 gwei ceiling', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node, dex } = sc;
        await listen(sc);
        await sc.fireNewPair();
        await missBundlesUntil(sc, { until: () => opEntries('buy.snipe.fail-clean').length > 0, what: 'the snipe failing clean', maxVirtualMs: 400_000 });

        const router = getAddress(dex.routerAddress);
        const attempts = node.submitted.filter((s) => s.route === 'bundle' && s.tx.to !== null && getAddress(s.tx.to) === router).map((s) => Transaction.from(s.raw));
        const highestFee = attempts.reduce((m, t) => (t.maxPriorityFeePerGas! > m ? t.maxPriorityFeePerGas! : m), 0n);
        const ceilingLines = opEntries('mev.escalation.ceiling-hit');
        // The buy-leg ceiling from the bot's own reconcile config (the graph's module instance).
        const { buildReconcileConfig } = await import('../../../src/utils/mevStrategies/reconciliation');
        const ceilingWei = buildReconcileConfig(process.env, sc.ctx.chain.gas.maxGasLimit).maxPriorityFeeCeilingWei;
        const claimsReached = recordedLogs().some(
            (l) => (l.level === 'error' || l.level === 'warn') && (CEILING_REACHED.test(l.msg ?? '') || CEILING_REACHED.test(String(l.obj?.reason ?? ''))),
        );

        knownBug(ctx, 'AUD-TX-029', {
            claim: 'attempt-budget-reported-as-ceiling-hit',
            correct: { reportedCeilingReachedBelowCeiling: false },
            observed: { reportedCeilingReachedBelowCeiling: true },
            actual: { reportedCeilingReachedBelowCeiling: claimsReached && highestFee < ceilingWei },
            expectedPlain: 'A snipe that runs out of private attempts while its fee is still below the ceiling is reported as having used up its attempts, not as having reached the fee ceiling.',
            actualPlain: 'The snipe ran out of its four private attempts at 1 to 4 gwei, yet the bot logged mev.escalation.ceiling-hit and told the operator the 25 gwei priority-fee ceiling was reached and to raise it.',
        });

        // The four attempts, decoded with real ethers: one nonce, fees one step apart, all far below the ceiling.
        expect(attempts).toHaveLength(4);
        expect(new Set(attempts.map((t) => t.nonce)).size).toBe(1);
        expect(attempts.map((t) => t.maxPriorityFeePerGas)).toEqual([1_000_000_000n, 2_000_000_000n, 3_000_000_000n, 4_000_000_000n]);
        expect(ceilingWei).toBe(25_000_000_000n);
        // The report: the ceiling-hit line on the last attempt, and the same text as the fail-clean reason.
        expect(ceilingLines).toHaveLength(1);
        expect(ceilingLines[0].attempt).toBe(3);
        expect(ceilingLines[0].ceilingWei).toBe(ceilingWei.toString());
        const failClean = opEntries('buy.snipe.fail-clean')[0];
        expect(String(failClean.reason)).toBe('MEV bundle not included after 4 attempt(s); priority-fee ceiling (25000000000 wei) reached. Increase MEV_MAX_PRIORITY_FEE_GWEI (within affordability) or resubmit manually.');
        expect(String(failClean.remediation)).toContain('raise MEV_BUY_MAX_PRIORITY_FEE_GWEI');
        expect(sc.graph.db.prepare("SELECT status FROM trades WHERE token = ?").all(sc.token.toLowerCase())).toEqual([]);
    });
});
