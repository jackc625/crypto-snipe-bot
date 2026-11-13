// test/realpath/triage/AUD-ANTIRUG-002.test.ts
// Phase 23 plan 23-12 Task 1 (AUDIT-02, D-02, D-07, D-08, AC-09, AC-12): AUD-ANTIRUG-002, a refused
// WebSocket connect ends the whole bot process, proven as a real process death through the bot's
// own connect and reconnect code at every site the finding names.
//
// The finding: no WebSocket the bot builds has an 'error' listener. When a connect is refused the
// ws library (the copy nested in ethers, ws@8.17.1, which production runs) emits 'error' with no
// listener, Node throws it as an uncaught exception, and the process exits, taking every exit
// monitor and anti-rug subscription on every chain with it.
//
// How (D-02: the real ws library on loopback ports, real time, never part of the recording):
// fixtures/wsReconnectRefused.ts runs as a railed child (a worker cannot observe a real process
// death, RESEARCH Pitfall 3). It brings its own loopback chain (fixtures/loopbackChain.ts: an HTTP
// JSON-RPC port and a separate WebSocket port), loads src/main and src/bot as the production entry
// does, builds the context with the real buildChainRegistry and createChainContext, and arms one
// site:
//   detector  the real startChainAntiRugListener, whose close handler runs handleWsClose;
//   dex-v3    the real startDexListener on the registry's first V3 dex (handleWsCloseV3);
//   dex-v2    the real startDexListener on the registry's first V2 dex (handleWsClose);
//   boot      the real getWsProvider, the call createChainContext makes at boot.
// fault: the chain ends the bot's sockets from the server side and closes the WebSocket listener,
// so the bot's own reconnect (1 s later) or the boot connect is refused. healthy: the same with
// the listener open, so the same code reconnects. contained: fault with process handlers
// registered first. In fault and contained the listener reopens 4 s after the trigger; the window
// is 12 s of real time.
//
// Measured on Node 22.16.0 (2026-11-11):
//   - fault, every site: the child exits with code 1 and stderr "Error: connect ECONNREFUSED
//     127.0.0.1:<port>", about 1 s after the trigger (immediately at boot). Before the refusal the
//     detector has already logged antirug.ws.reconnected and the DEX listeners "WebSocket
//     reconnected": the constructor does not throw, so each loop counts the refused connect as a
//     success.
//   - healthy, every site: the child survives, reconnects (the DEX listeners re-subscribe) and
//     answers the heartbeat.
//   - contained (detector): the process survives, but the anti-rug socket never comes back after
//     the port reopens (WORK_PENDING). The ws library's emit('error') threw before it could emit
//     'close', so the bot's socket stays CLOSING (readyState 2), no close handler runs again, and
//     the reconnect loop has already exited believing it reconnected. A process-level handler
//     alone keeps the process up with anti-rug silently offline.
//
// Phase 24 reading: an 'error' listener on every socket with the failed connect kept inside the
// backoff loop (card OD-11) flips each fault claim to "looks fixed" (the bot reconnects once the
// port is back). The boot claim is held to the same outcome (review WR-07): an 'error' listener on
// the boot socket alone keeps the process up, but nothing retries the refused connect, so the
// chain stays without a WebSocket; that reads survived-work-pending ("the failure changed"), not
// fixed. A process-level handler installed when src/main or src/bot loads, on its own,
// changes the failure to survived-work-pending, as the contained case shows, so a claim then fails
// as "the failure changed" rather than reading fixed. A handler installed only inside runMain or
// startMultiChainBot is out of reach (they must not run here) and the proof stays failing rather
// than reporting a false fix.
//
// Each fault test checks its real-path marker first (a crash before the bot's code is reached
// fails here as a real failure, AC-09), then its knownBug. Only the harness mocks are in use; the
// child mocks nothing.

import { describe, expect, it, onTestFailed } from 'vitest';
import { spawnRailedChild, type CliResult } from '../../rails/spawnRailedChild';
import { knownBug } from '../harness/knownBug';
import { CHILD_TIMEOUT_MS, CORRECT, TEST_TIMEOUT_MS, actualOf, classify, describeRun, exitedWith, expectRailedLoopbackOnly, hasMarker, markerLine, newCaseId } from './fixtures/crashRun';

const FIXTURE = 'test/realpath/triage/fixtures/wsReconnectRefused.ts';
const SIGNAL = 'Error: connect ECONNREFUSED';
const OBSERVED = exitedWith(SIGNAL);

type Site = 'detector' | 'dex-v3' | 'dex-v2' | 'boot';
type Mode = 'fault' | 'healthy' | 'contained';

/** The real-path marker each site prints only once the bot's own code has run. */
const PATH_MARKER: Record<Site, string> = {
    detector: '"op":"antirug.ws.disconnected"',
    'dex-v3': 'WebSocket disconnected (V3), reconnecting',
    'dex-v2': 'WebSocket disconnected, reconnecting',
    boot: 'BOOT_CONNECT_ATTEMPTED',
};

function runSite(site: Site, mode: Mode): CliResult {
    const ledgerRunId = newCaseId('antirug-002', `${site}-${mode}`);
    const r = spawnRailedChild('node', ['-r', 'ts-node/register/transpile-only', FIXTURE, site, mode], { timeoutMs: CHILD_TIMEOUT_MS, ledgerRunId });
    onTestFailed(() => {
        console.error(`[AUD-ANTIRUG-002 ${site} ${mode}] ${describeRun(r)}`);
    });
    expectRailedLoopbackOnly(ledgerRunId);
    return r;
}

/** The path check (separate from `actual`, so it still holds after a fix and D-08 can fire). */
function expectReached(r: CliResult, site: Site): void {
    expect(r.stdout, `the ${site} site's real-path marker`).toContain(PATH_MARKER[site]);
}

const EXPECTED_PLAIN = 'A refused WebSocket connect is handled: the bot stays up and keeps retrying until the endpoint is back.';

describe('AUD-ANTIRUG-002: a refused WebSocket connect ends the whole process', () => {
    it('detector-refused-reconnect-exits: the anti-rug reconnect after a socket drop meets a refused port and the process exits', { timeout: TEST_TIMEOUT_MS }, (ctx) => {
        const r = runSite('detector', 'fault');
        expectReached(r, 'detector');
        knownBug(ctx, 'AUD-ANTIRUG-002', {
            claim: 'detector-refused-reconnect-exits',
            correct: CORRECT,
            observed: OBSERVED,
            actual: actualOf(r, SIGNAL),
            expectedPlain: EXPECTED_PLAIN,
            actualPlain: 'The anti-rug reconnect meets a refused port and the whole bot process exits with code 1 (Error: connect ECONNREFUSED).',
        });
    });

    it('dex-v3-refused-reconnect-exits: the V3 DEX listener reconnect after a socket drop meets a refused port and the process exits', { timeout: TEST_TIMEOUT_MS }, (ctx) => {
        const r = runSite('dex-v3', 'fault');
        expectReached(r, 'dex-v3');
        knownBug(ctx, 'AUD-ANTIRUG-002', {
            claim: 'dex-v3-refused-reconnect-exits',
            correct: CORRECT,
            observed: OBSERVED,
            actual: actualOf(r, SIGNAL),
            expectedPlain: EXPECTED_PLAIN,
            actualPlain: 'The V3 pool listener reconnect meets a refused port and the whole bot process exits with code 1 (Error: connect ECONNREFUSED).',
        });
    });

    it('dex-v2-refused-reconnect-exits: the V2 DEX listener reconnect after a socket drop meets a refused port and the process exits', { timeout: TEST_TIMEOUT_MS }, (ctx) => {
        const r = runSite('dex-v2', 'fault');
        expectReached(r, 'dex-v2');
        knownBug(ctx, 'AUD-ANTIRUG-002', {
            claim: 'dex-v2-refused-reconnect-exits',
            correct: CORRECT,
            observed: OBSERVED,
            actual: actualOf(r, SIGNAL),
            expectedPlain: EXPECTED_PLAIN,
            actualPlain: 'The V2 pair listener reconnect meets a refused port and the whole bot process exits with code 1 (Error: connect ECONNREFUSED).',
        });
    });

    it('boot-refused-connect-exits: the boot WebSocket connect (getWsProvider) meets a refused port and the process exits', { timeout: TEST_TIMEOUT_MS }, (ctx) => {
        const r = runSite('boot', 'fault');
        expectReached(r, 'boot');
        knownBug(ctx, 'AUD-ANTIRUG-002', {
            claim: 'boot-refused-connect-exits',
            correct: CORRECT,
            observed: OBSERVED,
            actual: actualOf(r, SIGNAL),
            expectedPlain: EXPECTED_PLAIN,
            actualPlain: 'The boot WebSocket connect meets a refused port and the whole bot process exits with code 1 (Error: connect ECONNREFUSED).',
        });
    });

    describe('control: the same code with the port open survives and is connected again', () => {
        it.each<Site>(['detector', 'dex-v3', 'dex-v2', 'boot'])(
            '%s healthy: the connect succeeds, the process survives, the heartbeat answers',
            (site) => {
                const r = runSite(site, 'healthy');
                expectReached(r, site);
                expect(classify(r)).toBe('survived');
                expect(r.stderr).not.toContain(SIGNAL);
                expect(markerLine(r, 'BOT_WS_STATE')).toBe('BOT_WS_STATE 1');
                if (site === 'detector') expect(r.stdout).toContain('"op":"antirug.ws.reconnected"');
                if (site === 'dex-v3') expect(r.stdout).toContain('WebSocket reconnected, re-subscribed to V3 PoolCreated');
                if (site === 'dex-v2') expect(r.stdout).toContain('WebSocket reconnected, re-subscribed to PairCreated');
            },
            TEST_TIMEOUT_MS,
        );
    });

    it('contained (detector): with process handlers the same refusal does not end the process, but the anti-rug socket never comes back', { timeout: TEST_TIMEOUT_MS }, () => {
        const r = runSite('detector', 'contained');
        expectReached(r, 'detector');
        // A fix at the site handles the refusal itself, so no process handler is reached and the bot
        // reconnects: say so plainly (the D-08 signal for this control) rather than fail on a detail.
        if (!hasMarker(r, 'CONTAINED') && classify(r) === 'survived') {
            throw new Error('AUD-ANTIRUG-002 now behaves correctly in the contained case too (no process handler reached, the bot reconnected): it looks fixed; update this control with the fault claims');
        }
        // The same fault happened and reached the handler.
        expect(markerLine(r, 'CONTAINED uncaughtException') ?? '').toContain(SIGNAL);
        // The process lives (heartbeat answered) but the operation under test never finished: the
        // port was reopened 4 s after the trigger and no connection came back in the 12 s window.
        expect(classify(r)).toBe('survived-work-pending');
        expect(hasMarker(r, 'WS_REOPENED')).toBe(true);
        // Why: the failed socket never emitted 'close' (still CLOSING), so no close handler ran again.
        expect(markerLine(r, 'BOT_WS_STATE')).toBe('BOT_WS_STATE 2');
    });
});
