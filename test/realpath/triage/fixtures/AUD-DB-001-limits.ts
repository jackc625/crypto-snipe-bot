// test/realpath/triage/fixtures/AUD-DB-001-limits.ts
// Phase 23 plan 23-11 Task 2 (AUDIT-02): the one setup helper of AUD-DB-001.test.ts and
// AUD-DB-003.test.ts. src/riskManager.ts parses its five limits once, when the module loads
// (loadRiskConfig at import), so a different limit needs a whole-graph reload: restartGraph on the
// scenario's temp database file, which keeps every row and the simulated chain and loads the whole
// graph again under the new env. Nothing here mocks anything and nothing writes a row.
//
// - reloadAndCheck: reload the graph under `env`, rebuild the in-memory state with `prepare` (the
//   cooldown map lives in the riskManager module, so a reload empties it), then call the real
//   canSnipe. Only a refusal of the one limit under test (`refusable`) is returned as
//   { loaded: false }: a fix that refuses to start on that bad limit. Every other reload failure is
//   rethrown (review CR-02), so it can never read as the limit being enforced: a stop step of the
//   old graph (restartGraph applies the env only after every stop step passed, so the variable
//   still holds its earlier value), a harness check after the load (its message starts with
//   `restartGraph:` or `loadGraph:`), or an import-time error that does not name the variable. The
//   connection a failed load had opened is closed either way, so teardown can remove the temp
//   folder.
// - limitPair: the same database and the same in-memory state, once under a valid limit and once
//   with the variable set to `abc`. canSnipe stops at the first rule that fails, so the valid run
//   names the rule that decided it (its own reason and details), and an abc run that is allowed
//   passed that rule and every rule after it.
// - openPosition / nearTotalLoss: database states built only by the real buy and sell paths.

import { restartGraph, stepUntilTrue, type Scenario } from '../../harness/world';
import { heldPosition, type HeldPosition } from './AUD-API-001-dashboard-sell';
import { canSnipeNow, tradeRows, type RiskCheckResult } from './AUD-DB-002-risk';
import { foreignTrade, landNextSell } from './AUD-EXIT-001-sell-path';
import { buyRow } from './AUD-EXIT-002-position';
import { settleAntiRugArming } from './AUD-TX-002-lock';

export type LoadOutcome = { loaded: true; result: RiskCheckResult } | { loaded: false; error: string };

/** The reasons src/riskManager.ts canSnipe returns, one per rule, in the order it checks them. */
export const RISK_RULE_REASONS = ['position_size', 'daily_loss_limit', 'max_positions', 'cooldown', 'exposure_cap'] as const;
export type RiskRuleReason = (typeof RISK_RULE_REASONS)[number];

async function closeLeakedConnection(): Promise<void> {
    try {
        const m = await import('../../../../src/utils/db');
        if (m.db.open) m.closeDb();
    } catch {
        // The database module itself did not load, so it opened nothing.
    }
}

/** True when `e`, thrown by restartGraph under `env`, is the new graph refusing `variable` itself. */
function isRefusalOf(e: unknown, variable: string, env: Record<string, string | undefined>): boolean {
    // A stop-step failure is raised before the env is applied, so the variable still holds its
    // earlier value; a refusal of the new value can only come after it was applied.
    if (process.env[variable] !== env[variable]) return false;
    // Harness-raised failures (stop steps, the post-load chain, checker, DEX and wallet checks, the
    // database-file check) are never a refusal by src/.
    if (e instanceof AggregateError) return false;
    const msg = e instanceof Error ? e.message : String(e);
    if (/^(restartGraph|loadGraph): /.test(msg)) return false;
    // The refusal names the variable it refused.
    return new RegExp(`(^|[^A-Za-z0-9_])${variable}([^A-Za-z0-9_]|$)`).test(msg);
}

/** See the file header. `refusable` names the one variable whose refusal counts as a load result. */
export async function reloadAndCheck(
    sc: Scenario,
    env: Record<string, string | undefined>,
    prepare?: () => Promise<void> | void,
    refusable?: string,
): Promise<LoadOutcome> {
    try {
        await restartGraph(sc, { env });
    } catch (e) {
        await closeLeakedConnection();
        if (refusable === undefined || !isRefusalOf(e, refusable, env)) throw e;
        return { loaded: false, error: e instanceof Error ? e.message : String(e) };
    }
    await prepare?.();
    return { loaded: true, result: await canSnipeNow(sc) };
}

export interface LimitPair<F = undefined> {
    valid: LoadOutcome;
    abc: LoadOutcome;
    /** What `facts` read on the valid run's graph, before the abc reload (which a fix may refuse). */
    facts: F;
}

/** See the file header. `extra` is applied to both runs. */
export async function limitPair<F = undefined>(
    sc: Scenario,
    opts: { variable: string; valid: string; extra?: Record<string, string | undefined>; prepare?: () => Promise<void> | void; facts?: (sc: Scenario) => F },
): Promise<LimitPair<F>> {
    // The valid run must load: any failure there is rethrown.
    const valid = await reloadAndCheck(sc, { ...opts.extra, [opts.variable]: opts.valid }, opts.prepare);
    const facts = opts.facts ? opts.facts(sc) : (undefined as F);
    const abc = await reloadAndCheck(sc, { ...opts.extra, [opts.variable]: 'abc' }, opts.prepare, opts.variable);
    return { valid, abc, facts };
}

/** True when the limit was enforced: the graph refused to load naming the variable (reloadAndCheck), or canSnipe refused. */
export function enforced(o: LoadOutcome): boolean {
    return !o.loaded || o.result.allowed === false;
}

/** The reason of another rule that refused the run, or null (refusals by `own` or a new reason count as this limit's). */
export function otherRuleRefusal(o: LoadOutcome, own: RiskRuleReason): string | null {
    if (!o.loaded || o.result.allowed) return null;
    const reason = o.result.reason as RiskRuleReason | undefined;
    return reason !== undefined && RISK_RULE_REASONS.includes(reason) && reason !== own ? reason : null;
}

/** One open position, bought and armed on the real path, with its anti-rug arming settled. */
export async function openPosition(sc: Scenario): Promise<HeldPosition> {
    const pos = await heldPosition(sc);
    await settleAntiRugArming(sc, 1);
    return pos;
}

/**
 * One position bought on the real path and sold by the real stop-loss for almost nothing: another
 * wallet dumps a thousand times the pool's token reserve, so the proceeds are below the sell's own
 * gas. A loss that size is counted even by today's mixed-unit SQL (AUD-DB-002), and by any fix of
 * it, so it decides the daily-loss rule under every finding's fix.
 */
export async function nearTotalLoss(sc: Scenario): Promise<HeldPosition> {
    const pos = await heldPosition(sc);
    const fromSubmit = sc.node.submitted.length;
    await foreignTrade(sc, { sellTokens: sc.reserves.token * 1000n });
    await landNextSell(sc, { fromSubmit });
    await stepUntilTrue(() => buyRow(sc)?.status === 'sold' && tradeRows(sc).some((r) => r.action === 'sell'), { what: 'the near-total-loss sell row', maxSteps: 20_000 });
    await settleAntiRugArming(sc, 1);
    return pos;
}
