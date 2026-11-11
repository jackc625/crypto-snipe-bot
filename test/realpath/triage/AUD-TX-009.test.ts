// test/realpath/triage/AUD-TX-009.test.ts
// Phase 23 plan 23-12 Task 2 (AUDIT-02, D-07, D-08, AC-09, AC-48): AUD-TX-009, one RPC hiccup
// during a Flashbots bundle wait ends the whole bot process, proven as a real process death through
// the real FlashbotsMevStrategy.
//
// The finding: every ETH private attempt awaits the Flashbots library's bundle.wait(). The library
// registers an async "block" handler that throws "Unable to get block: <n>" when getBlock(target)
// answers null; ethers drops the promise an async listener returns, so the rejection is unhandled,
// and with no unhandledRejection handler in src Node 22 ends the process.
//
// How: fixtures/bundleWaitCrash.ts runs as a railed child (a worker cannot observe a real process
// death, RESEARCH Pitfall 3) with its own loopback chain (fixtures/loopbackChain.ts; the relay is
// served on the same HTTP port). It loads src/main and src/bot, builds the context with the real
// buildChainRegistry and createChainContext, and calls the real FlashbotsMevStrategy's
// sendTransaction (relayUrl on loopback, the inert FLASHBOTS_AUTH_KEY sentinel, a plain transfer,
// ctx.wallet, ctx.httpProvider, maxRetries 1). The strategy simulates, sends the library bundle and
// its raw `builders` fanout (RELAY_BUILDERS_SEEN, the path marker: only rawSendBundle in src sends a
// builders array) and reaches its own bundle.wait(). Block 101 is mined with the transaction after
// the first eth_sendBundle; block 102 follows one ETH slot (12 s) later.
//   fault      the first eth_getBlockByNumber(101) answers null, as a load-balanced node whose
//              backend has not yet seen the block returns (AC-48); later requests get the block.
//   healthy    block 101 is answered from the start.
//   contained  fault with process handlers registered first.
//
// Measured on Node 22.16.0 (2026-11-11):
//   - fault: the child exits with code 1 and stderr "Error: Unable to get block: 101" (thrown at
//     the library's handler), about 4 to 8 s after the first eth_sendBundle.
//   - healthy: the wait resolves "included" (op flashbots.bundle.included) and sendTransaction
//     returns the broadcast hash.
//   - contained: the process survives, and the work settles: the library's handler stays
//     registered after its throw, runs again on block 102, gets block 101 (the node has caught up)
//     and resolves "included", so sendTransaction returns. A process-level handler alone is enough
//     for this wait to recover on the next block (the plan expected the work to stay pending; the
//     measurement shows the library re-checks).
//
// Phase 24 reading: replacing bundle.wait() with the slice's own bounded receipt+nonce reconcile,
// or wrapping it so no listener rejection can escape (card OD-6), flips the claim to "looks fixed";
// so does a process-level unhandledRejection handler installed when src/main or src/bot loads. A
// handler installed only inside runMain or startMultiChainBot is out of reach (they must not run
// here), so the proof stays failing rather than reporting a false fix.
//
// The fault test checks its real-path marker first (AC-09), then its knownBug. Only the harness
// mocks are in use; the child mocks nothing.

import { describe, expect, it, onTestFailed } from 'vitest';
import { spawnRailedChild, type CliResult } from '../../rails/spawnRailedChild';
import { knownBug } from '../harness/knownBug';
import { CHILD_TIMEOUT_MS, CORRECT, TEST_TIMEOUT_MS, actualOf, classify, describeRun, exitedWith, expectRailedLoopbackOnly, hasMarker, markerLine, newCaseId } from './fixtures/crashRun';

const FIXTURE = 'test/realpath/triage/fixtures/bundleWaitCrash.ts';
const SIGNAL = 'Error: Unable to get block: 101';

function runMode(mode: 'fault' | 'healthy' | 'contained'): CliResult {
    const ledgerRunId = newCaseId('tx-009', mode);
    const r = spawnRailedChild('node', ['-r', 'ts-node/register/transpile-only', FIXTURE, mode], { timeoutMs: CHILD_TIMEOUT_MS, ledgerRunId });
    onTestFailed(() => {
        console.error(`[AUD-TX-009 ${mode}] ${describeRun(r)}`);
    });
    expectRailedLoopbackOnly(ledgerRunId);
    return r;
}

/** The path check: the real strategy sent its raw builders fanout, so it reached bundle.wait(). */
function expectReached(r: CliResult): void {
    expect(hasMarker(r, 'RELAY_BUILDERS_SEEN'), 'the real strategy reached its own raw builders fanout').toBe(true);
}

describe('AUD-TX-009: an RPC hiccup during the Flashbots bundle wait ends the whole process', () => {
    it('bundle-wait-null-block-exits: the target block answering null once during bundle.wait() ends the process', { timeout: TEST_TIMEOUT_MS }, (ctx) => {
        const r = runMode('fault');
        expectReached(r);
        knownBug(ctx, 'AUD-TX-009', {
            claim: 'bundle-wait-null-block-exits',
            correct: CORRECT,
            observed: exitedWith(SIGNAL),
            actual: actualOf(r, SIGNAL),
            expectedPlain: 'One null answer for the target block during a bundle wait is survived: the wait goes on or fails, and the bot stays up.',
            actualPlain: 'One null answer for the target block during a bundle wait ends the whole bot process with code 1 (Error: Unable to get block: 101).',
        });
    });

    it('control (healthy): the same send with the target block answered survives and sendTransaction returns the broadcast hash', { timeout: TEST_TIMEOUT_MS }, () => {
        const r = runMode('healthy');
        expectReached(r);
        expect(classify(r)).toBe('survived');
        // Fix-agnostic: today the wait resolves "included" (flashbots.bundle.included is logged), and a
        // fix that replaces bundle.wait() with the bot's own reconcile returns the same hash.
        expect(markerLine(r, 'SEND_RESOLVED')).toBe('SEND_RESOLVED broadcast-hash');
        expect(hasMarker(r, 'BLOCK_101_NULL_SERVED')).toBe(false);
        expect(r.stderr).not.toContain(SIGNAL);
    });

    it('contained: with process handlers the same null answer does not end the process, and the wait recovers on block 102', { timeout: TEST_TIMEOUT_MS }, () => {
        const r = runMode('contained');
        expectReached(r);
        if (!hasMarker(r, 'CONTAINED') && classify(r) === 'survived') {
            throw new Error('AUD-TX-009 now behaves correctly in the contained case too (no process handler reached): it looks fixed; update this control with the fault claim');
        }
        // The same fault happened and reached the handler.
        expect(hasMarker(r, 'BLOCK_101_NULL_SERVED')).toBe(true);
        expect(markerLine(r, 'CONTAINED unhandledRejection') ?? '').toContain(SIGNAL);
        // The process lives and the operation finished: the library re-checked on block 102.
        expect(classify(r)).toBe('survived');
        expect(hasMarker(r, 'MINED 102')).toBe(true);
        expect(markerLine(r, 'SEND_RESOLVED')).toBe('SEND_RESOLVED broadcast-hash');
    });
});
