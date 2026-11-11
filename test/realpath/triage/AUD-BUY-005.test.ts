// test/realpath/triage/AUD-BUY-005.test.ts
// Phase 23 plan 23-12 Task 2 (AUDIT-02, D-07, D-08, AC-09, AC-48): AUD-BUY-005, one rejection from
// an un-awaited handler ends the whole bot process, proven as a real process death through the
// real V3 DEX listener.
//
// The finding: src has no unhandledRejection handler, and many async calls are made without await
// or .catch, so one escaped rejection exits the process with every exit monitor and anti-rug
// subscription. The concrete trigger exercised here (found in the finding's threshold inventory):
// the V3 WebSocket listener in src/bot.ts startDexListener calls handleNewV3PoolForChain without
// await or .catch; after the real waitForLiquidity, checkMinLiquidity runs parseEther on
// ETH_MIN_LIQUIDITY before its try, and chainRegistry.ts carries the value through unvalidated.
//
// How: fixtures/unhandledRejectionCrash.ts runs as a railed child (a worker cannot observe a real
// process death, RESEARCH Pitfall 3) with its own loopback chain (fixtures/loopbackChain.ts). It
// loads src/main and src/bot, builds the context with the real buildChainRegistry and
// createChainContext (the bot's real WebSocketProvider on the loopback socket), and starts the real
// startDexListener on the registry's first V3 dex. The chain pushes a real-encoded PoolCreated to
// the listener's own subscription, and eth_getLogs answers one real-encoded Mint in that block, so
// the real waitForLiquidity passes ("Mint found in same block as PoolCreated", the path marker).
// The fixture never calls the handler. 3 s later it pushes a second pool; the bot's Mint query for
// that second pool is the "work settled" signal (the listener still dispatches).
//   fault      ETH_MIN_LIQUIDITY=abc set on process.env before the registry loads (test/.env.test
//              has no such key, so envOverrides cannot carry it).
//   healthy    ETH_MIN_LIQUIDITY=0.5; the QuoterV2 eth_call reverts (a thin pool) and the real
//              below-minimum branch returns with no buy.
//   contained  fault with process handlers registered first.
//
// Measured on Node 22.16.0 (2026-11-11):
//   - fault: the child exits with code 1 and stderr "TypeError: invalid FixedNumber string value
//     (argument="value", value="abc", ...)", raised in checkMinLiquidity (src/bot.ts) inside
//     handleNewV3PoolForChain, right after the Mint was found.
//   - healthy: both pools are handled, each quote reverts, each is skipped below the minimum, the
//     process survives.
//   - contained: both pools' rejections reach the handler, the listener keeps dispatching, the
//     process survives.
//
// Not separately exercised here, so a pass after a fix at this one site does not cover them: the
// V2 WebSocket listener call (handleNewPairForChain), the V2 and V3 HTTP poll dispatches, the
// un-awaited startHttpPollingListener, the un-awaited startMultiChainBot entry, the MEV-health and
// wallet-balance setInterval callbacks, and the two async close handlers (see the finding).
//
// Phase 24 reading: a .catch at the listener's call (per-handler containment, card OD-6) flips the
// claim to "looks fixed"; so does a process-level unhandledRejection handler installed when src/main
// or src/bot loads. A handler installed only inside runMain or startMultiChainBot is out of reach
// (they must not run here), so the proof stays failing rather than reporting a false fix. A fix that
// only validates ETH_MIN_LIQUIDITY at load removes this trigger, not the un-awaited call: the claim
// then fails as "the failure changed" (a refused start reads setup-error, a default value reads
// survived) and needs another trigger on the same call.
//
// The fault test checks its real-path marker first (AC-09), then its knownBug. Only the harness
// mocks are in use; the child mocks nothing.

import { describe, expect, it, onTestFailed } from 'vitest';
import { spawnRailedChild, type CliResult } from '../../rails/spawnRailedChild';
import { knownBug } from '../harness/knownBug';
import { CHILD_TIMEOUT_MS, CORRECT, TEST_TIMEOUT_MS, actualOf, classify, describeRun, exitedWith, expectRailedLoopbackOnly, hasMarker, newCaseId, stdoutLines } from './fixtures/crashRun';

const FIXTURE = 'test/realpath/triage/fixtures/unhandledRejectionCrash.ts';
const SIGNAL = 'TypeError: invalid FixedNumber string value';
const PATH_MARKER = 'Mint found in same block as PoolCreated';

function runMode(mode: 'fault' | 'healthy' | 'contained'): CliResult {
    const ledgerRunId = newCaseId('buy-005', mode);
    const r = spawnRailedChild('node', ['-r', 'ts-node/register/transpile-only', FIXTURE, mode], { timeoutMs: CHILD_TIMEOUT_MS, ledgerRunId });
    onTestFailed(() => {
        console.error(`[AUD-BUY-005 ${mode}] ${describeRun(r)}`);
    });
    expectRailedLoopbackOnly(ledgerRunId);
    return r;
}

const count = (r: CliResult, needle: string): number => stdoutLines(r).filter((l) => l.includes(needle)).length;

describe('AUD-BUY-005: a rejection from the un-awaited V3 pool handler ends the whole process', () => {
    it('v3-listener-unhandled-rejection-exits: a bad ETH_MIN_LIQUIDITY rejects the un-awaited V3 handler on the first pool and the process exits', { timeout: TEST_TIMEOUT_MS }, (ctx) => {
        const r = runMode('fault');
        expect(r.stdout, "the real waitForLiquidity's path marker").toContain(PATH_MARKER);
        knownBug(ctx, 'AUD-BUY-005', {
            claim: 'v3-listener-unhandled-rejection-exits',
            correct: CORRECT,
            observed: exitedWith(SIGNAL),
            actual: actualOf(r, SIGNAL),
            expectedPlain: "A pool handler's rejection is contained: that pool is skipped and the bot stays up and keeps listening.",
            actualPlain: 'The un-awaited V3 pool handler rejects on the first pool and the whole bot process exits with code 1 (TypeError: invalid FixedNumber string value).',
        });
    });

    it('control (healthy): with a valid minimum both pools are handled and skipped below the minimum, and the process survives', { timeout: TEST_TIMEOUT_MS }, () => {
        const r = runMode('healthy');
        expect(r.stdout).toContain(PATH_MARKER);
        expect(classify(r)).toBe('survived');
        expect(count(r, 'QUOTER_CALLED')).toBe(2);
        expect(count(r, 'V3 pool below min liquidity threshold, skipping')).toBe(2);
        expect(r.stdout).not.toContain('"op":"flashbots.');
        expect(r.stderr).not.toContain(SIGNAL);
    });

    it('contained: with process handlers both pools reject into the handler, the listener keeps dispatching and the process survives', { timeout: TEST_TIMEOUT_MS }, () => {
        const r = runMode('contained');
        expect(r.stdout).toContain(PATH_MARKER);
        if (!hasMarker(r, 'CONTAINED') && classify(r) === 'survived') {
            throw new Error('AUD-BUY-005 now behaves correctly in the contained case too (no process handler reached): it looks fixed; update this control with the fault claim');
        }
        const contained = stdoutLines(r).filter((l) => l.startsWith('CONTAINED unhandledRejection '));
        expect(contained).toHaveLength(2);
        for (const l of contained) expect(l).toContain(SIGNAL);
        expect(classify(r)).toBe('survived');
    });
});
