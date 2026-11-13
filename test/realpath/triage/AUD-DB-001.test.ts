// test/realpath/triage/AUD-DB-001.test.ts
// Phase 23 plan 23-11 Task 2 (AUDIT-02, RC-06): AUD-DB-001, a malformed risk setting switches its
// risk limit off.
//
// The site. src/riskManager.ts loadRiskConfig parses the five limits once at import with parseInt or
// parseFloat and `|| default`, with no NaN or range check (MAX_POSITION_SIZE is null only when
// unset or empty). canSnipe checks five rules in order and returns at the first that fails:
// position_size (amount > MAX_POSITION_SIZE), daily_loss_limit (24 h realized loss <=
// -(maxCapital * DAILY_LOSS_PCT / 100)), max_positions (open buys >= MAX_OPEN_POSITIONS), cooldown
// (now - last snipe on the chain < SNIPE_COOLDOWN_MS) and exposure_cap (exposure + amount >
// MAX_TOTAL_EXPOSURE). Every comparison with NaN is false, so the refusing branch never runs.
//
// Proof on the real path, one `it` per variable, sharing fixtures/AUD-DB-001-limits.ts. Each builds
// a state that trips only the rule under test: the database through the real buy and sell paths
// (a temp database file), and the cooldown map through the real recordSnipe the buy site calls.
// Then the identical state is checked twice by the real canSnipe, each time after a whole-graph
// reload (restartGraph on the same file): once with the variable at a valid limit, once at `abc`.
// The valid run must return that rule's own reason and details (the earlier rules passed it), and
// no other rule may refuse the abc run. So the pair differs only in that rule's result.
//   - max-open-positions-unparsed: one real open position; MAX_OPEN_POSITIONS 1 against abc.
//   - max-total-exposure-unparsed: one real open 0.01 ETH position; MAX_TOTAL_EXPOSURE 0.015 against
//     abc (the next 0.01 ETH snipe would make 0.02).
//   - daily-loss-pct-unparsed: one real position sold by the real stop-loss for less than its gas,
//     a loss even today's mixed-unit SQL counts (AUD-DB-002 is the ordinary-loss case);
//     DAILY_LOSS_PCT 0.5 of the 1.0 ETH chain capital against abc.
//   - snipe-cooldown-unparsed: recordSnipe('eth') just before the check; SNIPE_COOLDOWN_MS 60000
//     against abc.
//   - max-position-size-unparsed: the chain's 0.01 ETH snipe amount; MAX_POSITION_SIZE 0.005 against
//     abc.
//
// What is measured: whether the limit is enforced with the value abc. Correct: the bot refuses to
// load the limit (the new graph's load fails with an error naming the variable) or canSnipe
// refuses. Any other reload failure (a stop step of the old graph, a harness check, an import error
// that does not name the variable) is rethrown by the fixture and fails the test, so it can never
// read as the limit being enforced (review CR-02). A fix that refuses to start on an
// unparseable limit (the finding's recommendation) or one that refuses the snipe both read "looks
// fixed" (D-08). After each marker the abc run is asserted to have been allowed outright.
//
// MAX_OPEN_POSITIONS only: the bot's boot preflight (src/preflight.ts checkWalletBalance) re-parses
// it strictly and refuses abc, so today the running bot does not start with it (the register's
// sub-claim 1: fail-closed for the system, fail-open at the risk gate). The marker measures the risk
// gate, and the preflight refusal is asserted after it as a detail. For the other four variables
// nothing else in src/ parses them (riskManager.ts:28-32 is the only parser; the dashboard routes
// only display them), so the bot starts and the limit is simply off.
//
// The per-chain <PREFIX>_MAX_CAPITAL sub-claim stays code-read. Only the harness mocks are in use
// (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { knownBug } from '../harness/knownBug';
import { createScenario, createTempDbFile } from '../harness/world';
import { enforced, limitPair, nearTotalLoss, openPosition, otherRuleRefusal } from './fixtures/AUD-DB-001-limits';
import { graphRisk, openPositionCount, realizedLoss24h, totalExposure } from './fixtures/AUD-DB-002-risk';

describe('AUD-DB-001: a non-numeric risk setting switches its limit off (RC-06)', () => {
    it('max-open-positions-unparsed: with one open position, MAX_OPEN_POSITIONS 1 refuses the next snipe and MAX_OPEN_POSITIONS=abc allows it', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() }, overrides: { MAX_OPEN_POSITIONS: '1' } });
        await openPosition(sc);
        const pair = await limitPair(sc, { variable: 'MAX_OPEN_POSITIONS', valid: '1', facts: (s) => ({ open: openPositionCount(s) }) });
        // Setup facts, true under the bug and every fix: the state trips only the open-position rule.
        expect(pair.valid).toEqual({ loaded: true, result: { allowed: false, reason: 'max_positions', details: 'Open positions (1) at limit (1)' } });
        expect(otherRuleRefusal(pair.abc, 'max_positions')).toBeNull();
        expect(pair.facts).toEqual({ open: 1 });

        knownBug(ctx, 'AUD-DB-001', {
            claim: 'max-open-positions-unparsed',
            correct: { limitEnforced: true },
            observed: { limitEnforced: false },
            actual: { limitEnforced: enforced(pair.abc) },
            expectedPlain: 'With MAX_OPEN_POSITIONS set to a value that is not a number, the risk gate refuses to load the limit or refuses the snipe.',
            actualPlain: 'With MAX_OPEN_POSITIONS=abc and one position already open, the risk gate allowed the next snipe that MAX_OPEN_POSITIONS=1 refuses on the same database. (The boot preflight refuses abc for this one variable, so today the running bot does not start with it; the risk gate itself does not refuse.)',
        });
        expect(pair.abc).toEqual({ loaded: true, result: { allowed: true } });
        // The boot preflight's own re-parse refuses the value (the system is fail-closed today).
        const preflight = await import('../../../src/preflight');
        const check = await preflight.checkWalletBalance({ ...sc.ctx.chain, httpProvider: sc.ctx.httpProvider, wallet: sc.ctx.wallet } as never);
        expect(check).toMatchObject({ passed: false, reason: 'MAX_OPEN_POSITIONS must be a non-negative integer; got "abc"' });
    });

    it('max-total-exposure-unparsed: with one open 0.01 ETH position, MAX_TOTAL_EXPOSURE 0.015 refuses the next 0.01 ETH snipe and MAX_TOTAL_EXPOSURE=abc allows it', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() }, overrides: { MAX_TOTAL_EXPOSURE: '0.015' } });
        await openPosition(sc);
        const pair = await limitPair(sc, { variable: 'MAX_TOTAL_EXPOSURE', valid: '0.015', facts: (s) => ({ exposure: totalExposure(s) }) });
        expect(pair.valid).toEqual({ loaded: true, result: { allowed: false, reason: 'exposure_cap', details: 'Total exposure (0.0100 + 0.01) would exceed cap (0.015)' } });
        expect(otherRuleRefusal(pair.abc, 'exposure_cap')).toBeNull();
        expect(pair.facts).toEqual({ exposure: 0.01 });

        knownBug(ctx, 'AUD-DB-001', {
            claim: 'max-total-exposure-unparsed',
            correct: { limitEnforced: true },
            observed: { limitEnforced: false },
            actual: { limitEnforced: enforced(pair.abc) },
            expectedPlain: 'With MAX_TOTAL_EXPOSURE set to a value that is not a number, the bot refuses to start or the risk gate refuses the snipe.',
            actualPlain: 'With MAX_TOTAL_EXPOSURE=abc the exposure cap is off: the bot loaded, and on a database where a 0.015 ETH cap refuses the next snipe, the risk gate allowed it.',
        });
        expect(pair.abc).toEqual({ loaded: true, result: { allowed: true } });
    });

    it('daily-loss-pct-unparsed: after a near-total loss, DAILY_LOSS_PCT 0.5 refuses the next snipe and DAILY_LOSS_PCT=abc allows it', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() }, overrides: { DAILY_LOSS_PCT: '0.5' } });
        await nearTotalLoss(sc);
        const pair = await limitPair(sc, { variable: 'DAILY_LOSS_PCT', valid: '0.5', facts: (s) => ({ loss: realizedLoss24h(s), open: openPositionCount(s) }) });
        expect(pair.valid).toMatchObject({ loaded: true, result: { allowed: false, reason: 'daily_loss_limit' } });
        expect(pair.valid.loaded && pair.valid.result.details).toMatch(/^Daily loss on eth: \d+\.\d{4} exceeds 0\.5% of 1\.0$/);
        expect(otherRuleRefusal(pair.abc, 'daily_loss_limit')).toBeNull();
        expect(pair.facts.loss).toBeLessThan(-0.005);
        expect(pair.facts.open).toBe(0);

        knownBug(ctx, 'AUD-DB-001', {
            claim: 'daily-loss-pct-unparsed',
            correct: { limitEnforced: true },
            observed: { limitEnforced: false },
            actual: { limitEnforced: enforced(pair.abc) },
            expectedPlain: 'With DAILY_LOSS_PCT set to a value that is not a number, the bot refuses to start or the risk gate refuses the snipe.',
            actualPlain: 'With DAILY_LOSS_PCT=abc the daily-loss breaker is off: the bot loaded, and after a sold position lost almost everything (which a 0.5 percent limit refuses on the same database) the risk gate allowed the next snipe.',
        });
        expect(pair.abc).toEqual({ loaded: true, result: { allowed: true } });
    });

    it('snipe-cooldown-unparsed: right after a recorded snipe, SNIPE_COOLDOWN_MS 60000 refuses the next snipe and SNIPE_COOLDOWN_MS=abc allows it', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() }, overrides: { SNIPE_COOLDOWN_MS: '60000' } });
        // The cooldown map is in-memory in the riskManager module, so each reload gets the same state
        // from the real recordSnipe the buy site calls, at the same fake moment as the check.
        const recordSnipe = async (): Promise<void> => (await graphRisk()).recordSnipe(sc.ctx.chain.name);
        const pair = await limitPair(sc, { variable: 'SNIPE_COOLDOWN_MS', valid: '60000', prepare: recordSnipe });
        expect(pair.valid).toEqual({ loaded: true, result: { allowed: false, reason: 'cooldown', details: 'Cooldown active on eth: 60s remaining' } });
        expect(otherRuleRefusal(pair.abc, 'cooldown')).toBeNull();

        knownBug(ctx, 'AUD-DB-001', {
            claim: 'snipe-cooldown-unparsed',
            correct: { limitEnforced: true },
            observed: { limitEnforced: false },
            actual: { limitEnforced: enforced(pair.abc) },
            expectedPlain: 'With SNIPE_COOLDOWN_MS set to a value that is not a number, the bot refuses to start or the risk gate refuses a snipe inside the cooldown.',
            actualPlain: 'With SNIPE_COOLDOWN_MS=abc there is no cooldown at all: the bot loaded, and a snipe the moment after the last one, which a 60 s cooldown refuses, was allowed.',
        });
        expect(pair.abc).toEqual({ loaded: true, result: { allowed: true } });
    });

    it('max-position-size-unparsed: for the 0.01 ETH snipe amount, MAX_POSITION_SIZE 0.005 refuses the snipe and MAX_POSITION_SIZE=abc allows it', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() }, overrides: { MAX_POSITION_SIZE: '0.005' } });
        const pair = await limitPair(sc, { variable: 'MAX_POSITION_SIZE', valid: '0.005' });
        expect(sc.ctx.chain.snipeAmount).toBe('0.01');
        expect(pair.valid).toEqual({ loaded: true, result: { allowed: false, reason: 'position_size', details: 'Position size 0.01 exceeds max 0.005' } });
        expect(otherRuleRefusal(pair.abc, 'position_size')).toBeNull();

        knownBug(ctx, 'AUD-DB-001', {
            claim: 'max-position-size-unparsed',
            correct: { limitEnforced: true },
            observed: { limitEnforced: false },
            actual: { limitEnforced: enforced(pair.abc) },
            expectedPlain: 'With MAX_POSITION_SIZE set to a value that is not a number, the bot refuses to start or the risk gate refuses a snipe above the cap the operator meant to set.',
            actualPlain: 'With MAX_POSITION_SIZE=abc the per-trade cap the operator set does nothing: the bot loaded, and a 0.01 ETH snipe that a 0.005 cap refuses was allowed.',
        });
        expect(pair.abc).toEqual({ loaded: true, result: { allowed: true } });
    });
});
