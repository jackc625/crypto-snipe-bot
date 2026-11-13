// test/realpath/triage/fixtures/AUD-DB-002-risk.ts
// Phase 23 plan 23-11 (AUDIT-02): read the bot's own risk gate and risk SQL, for the risk-limit and
// database triage files of this plan (AUD-DB-002, AUD-DB-001, AUD-DB-003). Lives beside its tests:
// the harness is read-only for triage plans. Nothing here mocks anything and nothing writes a row.
//
// - graphRisk: the graph's own src/riskManager. loadGraph ran vi.resetModules() and then imported
//   the graph (src/bot.ts imports riskManager), so this import returns the module instance the bot
//   uses, with the limits it parsed from the env at that load (plan 23-09 proved the same for
//   nonceAuthority).
// - canSnipeNow: the real canSnipe with the arguments src/bot.ts passes it (the chain's own
//   snipeAmount and maxCapital from the loaded registry).
// - realizedLoss24h / totalExposure / openPositionCount: the real prepared statements of
//   src/utils/db.ts that canSnipe reads (getDailyRealizedLoss with the same rolling 24 h start,
//   getTotalExposure, getOpenPositionCount), on the graph's own connection.
// - tradeRows: every trades row, as the real insert sites wrote it.

import type { Scenario } from '../../harness/world';

export type RiskModule = typeof import('../../../../src/riskManager');
export type RiskCheckResult = ReturnType<RiskModule['canSnipe']>;

/** The graph's own src/riskManager (see the file header). */
export async function graphRisk(): Promise<RiskModule> {
    return import('../../../../src/riskManager');
}

/** The real canSnipe, called exactly as src/bot.ts calls it for the scenario chain. */
export async function canSnipeNow(sc: Scenario): Promise<RiskCheckResult> {
    const risk = await graphRisk();
    return risk.canSnipe(sc.ctx.chain.name, sc.ctx.chain.snipeAmount, sc.ctx.chain.maxCapital);
}

/** getDailyRealizedLoss for the scenario chain over the same rolling 24 h canSnipe uses. */
export function realizedLoss24h(sc: Scenario): number {
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    return (sc.graph.dbModule.getDailyRealizedLoss.get(sc.ctx.chain.name, oneDayAgo) as { total_loss: number }).total_loss;
}

/** getTotalExposure, as canSnipe's exposure-cap check reads it. */
export function totalExposure(sc: Scenario): number {
    return (sc.graph.dbModule.getTotalExposure.get() as { total: number }).total;
}

/** getOpenPositionCount, as canSnipe's open-position check reads it. */
export function openPositionCount(sc: Scenario): number {
    return (sc.graph.dbModule.getOpenPositionCount.get() as { count: number }).count;
}

export interface FullTradeRow {
    id: number;
    token: string;
    chain: string;
    action: string;
    tx_hash: string | null;
    amount_in: string | null;
    amount_out: string | null;
    gas_cost: string | null;
    status: string;
}

/** Every trades row, in insert order, as the real insert sites wrote it. */
export function tradeRows(sc: Scenario): FullTradeRow[] {
    return sc.graph.db.prepare('SELECT id, token, chain, action, tx_hash, amount_in, amount_out, gas_cost, status FROM trades ORDER BY id').all() as FullTradeRow[];
}
