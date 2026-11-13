// test/realpath/triage/fixtures/AUD-ANTIRUG-003-live.ts
// Phase 23 plan 23-10 Task 3 (AUDIT-02): helpers for the live anti-rug triage files of this plan
// (AUD-ANTIRUG-003, -004, -005). Lives beside its tests: the harness is read-only for triage
// plans. Nothing here mocks anything, and nothing adds behavior to the simulated node.
//
// A rug log alone reaches no sell (review concern Codex 23-10): src/anti-rug/detector.ts needs all
// three signals (LP removed above lpRemovalPct, a destination outside the allowlist, reserves below
// half the baseline), then its confirm-block gate, and src/anti-rug/exitTrigger.ts sells only with
// live execution on and the circuit breaker untripped. So every scenario here sets, through the
// createScenario overrides before the graph loads, ETH_ANTIRUG_LIVE_EXECUTE=true,
// ETH_ANTIRUG_CONFIRM_BLOCKS=1 and a stated ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS, and checks the
// loaded config says so (liveGates). The rug itself is fixtures/AUD-EXIT-014-rug.ts pullLiquidity:
// the deployer's real router removeLiquidityETH with the pair's own Transfer, Sync and Burn logs,
// which trips all three signals.
//
// - liveOverrides / liveGates: the overrides above and the check that the graph loaded them.
// - breaker: the graph's own src/anti-rug/circuitBreaker module (loadGraph reset the module
//   registry and imported the graph, so this import returns the instance exitTrigger counts on).
// - afterExitPoll: step until the exit monitor sends its next exit quote, so a test acts right after
//   a poll and the routine stop-loss cannot take part within the next poll interval (5 s).
// - exitFiredSince: the antirug_state_update { state: 'exit-fired', success } broadcasts of a trade.
// - noExitInFlight: no exit of the scenario token holds the token's real sell lock (src/utils/
//   exitManager tryAcquireSellLock answers true, and the lock is released at once). An outcome every
//   fix shape reaches once its exits have returned, so a wait on it never depends on how many
//   dispatches were logged or broadcast (review WR-09: a dedupe that returns early for an in-flight
//   duplicate logs a dispatch but broadcasts nothing).
// - driveFor: drive the chain the way the network would, by the same rules as
//   fixtures/AUD-API-001-dashboard-sell.ts driveChain (a public transaction of the wallet is mined
//   in the next block; a bundle transaction lands one 12 s slot after it was first seen, at a block
//   it targets), until a condition holds or a bounded window of fake time ends, and mine an empty
//   block every 12 s while no bundle of the wallet waits, so block-driven code sees the chain move.
//   Never throws for the window ending: the caller states what did not happen within it.

import { expect, vi } from 'vitest';
import { harnessState, type Submitted } from '../../harness/chain';
import { stepUntilTrue, type Scenario } from '../../harness/world';
import { exitQuotes } from './AUD-EXIT-002-position';

// The real setImmediate, captured when this module loads (before any scenario installs the fake
// clock, which also patches the timers module): an HTTP answer is real I/O.
const REAL_SET_IMMEDIATE: (cb: () => void) => unknown = globalThis.setImmediate;
const realTurn = (): Promise<void> => new Promise<void>((resolve) => REAL_SET_IMMEDIATE(resolve));

type CircuitBreakerModule = typeof import('../../../../src/anti-rug/circuitBreaker');

export function liveOverrides(breakerTriggers: number): Record<string, string> {
    return { ETH_ANTIRUG_LIVE_EXECUTE: 'true', ETH_ANTIRUG_CONFIRM_BLOCKS: '1', ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS: String(breakerTriggers) };
}

/** The loaded chain config carries the live gates the scenario asked for. */
export function liveGates(sc: Scenario, breakerTriggers: number): void {
    expect(sc.ctx.chain.antiRug.liveExecute).toBe(true);
    expect(sc.ctx.chain.antiRug.confirmBlocks).toBe(1);
    expect(sc.ctx.chain.antiRug.circuitBreakerTriggers).toBe(breakerTriggers);
}

/** The graph's own circuit breaker module (see the file header). */
export async function breaker(): Promise<CircuitBreakerModule> {
    return import('../../../../src/anti-rug/circuitBreaker');
}

/** Step until the exit monitor sends its next exit quote. */
export async function afterExitPoll(sc: Scenario): Promise<void> {
    const quotes = exitQuotes(sc).length;
    await stepUntilTrue(() => exitQuotes(sc).length > quotes, { what: 'one exit-monitor poll', maxSteps: 2_000 });
}

export interface ExitFired {
    tradeId: number;
    state: string;
    success?: boolean;
}

export function exitFiredSince(from: number, tradeId: number): ExitFired[] {
    return harnessState()
        .broadcasts.slice(from)
        .filter((b) => b.type === 'antirug_state_update')
        .map((b) => b.data as ExitFired)
        .filter((d) => d.state === 'exit-fired' && d.tradeId === tradeId);
}

/** See the file header. Synchronous: the acquire and the release run with nothing in between. */
export function noExitInFlight(sc: Scenario): boolean {
    const free = sc.graph.exitManager.tryAcquireSellLock(sc.ctx.chain.name, sc.token);
    if (free) sc.graph.exitManager.releaseSellLock(sc.ctx.chain.name, sc.token);
    return free;
}

/** See the file header. Returns whether until() held before the window ended. */
export async function driveFor(sc: Scenario, until: () => boolean, windowMs: number): Promise<boolean> {
    const { node } = sc;
    const wallet = sc.wallet.address.toLowerCase();
    const sender = new WeakMap<Submitted, string>();
    const fromWallet = (s: Submitted): boolean => {
        let f = sender.get(s);
        if (f === undefined) {
            f = (s.tx.from ?? '').toLowerCase();
            sender.set(s, f);
        }
        return f === wallet;
    };
    const slotStart = new Map<string, number>();
    const end = Date.now() + windowMs;
    let lastBlockAt = Date.now();
    while (!until() && Date.now() < end) {
        await vi.advanceTimersByTimeAsync(50);
        await realTurn();
        const waiting = node.submitted.filter((s) => s.status === 'accepted' && fromWallet(s));
        // The wallet's public transactions are mined in the next block.
        const publicTxs = waiting.filter((s) => s.route === 'public').map((s) => s.hash);
        if (publicTxs.length > 0) {
            node.mine({ include: publicTxs });
            lastBlockAt = Date.now();
        }
        // Each bundle transaction gets one 12 s slot from when it was first seen, then lands at a
        // block it targets (the newest transaction per nonce that targets the next block).
        const bundled = waiting.filter((s) => s.route === 'bundle');
        for (const s of bundled) if (!slotStart.has(s.hash)) slotStart.set(s.hash, Date.now());
        const due = bundled.filter((s) => Date.now() - slotStart.get(s.hash)! >= 12_000);
        if (due.length > 0) {
            const next = node.head + 1;
            const byNonce = new Map<number, Submitted>();
            for (const s of bundled) if (s.targetBlocks.includes(next)) byNonce.set(s.tx.nonce, s);
            node.mine({ include: [...byNonce.values()].sort((a, b) => a.tx.nonce - b.tx.nonce).map((s) => s.hash) });
            lastBlockAt = Date.now();
            for (const s of due) slotStart.set(s.hash, Date.now());
            continue;
        }
        // Otherwise an empty block every 12 s while nothing of the wallet waits.
        if (bundled.length === 0 && Date.now() - lastBlockAt >= 12_000) {
            node.mine();
            lastBlockAt = Date.now();
        }
    }
    return until();
}
