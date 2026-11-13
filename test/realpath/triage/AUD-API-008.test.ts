// test/realpath/triage/AUD-API-008.test.ts
// Phase 23 plan 23-12 Task 3 (AUDIT-02, D-07, D-08, AC-09): AUD-API-008, one unauthenticated
// request with a malformed Host header and an Upgrade header ends the whole bot process, proven as
// a real process death through the real API server.
//
// The finding: the WebSocket upgrade handler (src/api/ws/handler.ts) runs new URL() on the Host
// header first, outside any try; src/api/server.ts registers it as the http server's 'upgrade'
// listener, so the TypeError escapes as an uncaught exception and the process exits, stopping every
// exit monitor and anti-rug subscription. In the documented remote-access mode (DASHBOARD_HOST
// 0.0.0.0) any host that can reach the port can do it with one request.
//
// How: fixtures/hostHeaderCrash.ts runs as a railed child (a worker cannot observe a real process
// death, RESEARCH Pitfall 3) with its own loopback chain (fixtures/loopbackChain.ts). It loads
// src/main and src/bot, builds the context with the real buildChainRegistry and createChainContext,
// starts the real startApiServer([]) on a free loopback port (its own log "Dashboard API server
// started" is part of the path check), then opens a raw TCP connection itself and sends GET /ws
// with Upgrade: websocket:
//   fault      Host "a b";
//   healthy    Host "127.0.0.1:<port>", answered 401 by the real handler (no session);
//   contained  fault with process handlers registered first.
//
// Measured on Node 22.16.0 (2026-11-11):
//   - fault: the child exits with code 1 and stderr "TypeError: Invalid URL" (thrown at
//     handler.ts:43 inside the http server's upgrade emit), right after the request.
//   - healthy: the real handler answers "HTTP/1.1 401 Unauthorized", closes the socket, and the
//     process survives.
//   - contained: the process survives, but the malformed request is never answered and its socket
//     is never closed (WORK_PENDING): the throw left the upgraded socket with nobody owning it. A
//     process-level handler alone keeps the bot up and leaks one open socket per such request.
//
// Phase 24 reading: parsing the upgrade URL inside a try (or parsing only the path) and answering
// 400 with the socket destroyed flips the claim to "looks fixed". A process-level handler installed
// when src/main or src/bot loads, on its own, changes the failure to survived-work-pending (the
// socket leak the contained case shows), so the claim then fails as "the failure changed" rather
// than reading fixed. A handler installed only inside runMain or startMultiChainBot is out of reach
// (they must not run here), so the proof stays failing rather than reporting a false fix.
//
// The fault test checks its real-path markers first (AC-09), then its knownBug. Only the harness
// mocks are in use; the child mocks nothing.

import { describe, expect, it, onTestFailed } from 'vitest';
import { spawnRailedChild, type CliResult } from '../../rails/spawnRailedChild';
import { knownBug } from '../harness/knownBug';
import { CHILD_TIMEOUT_MS, CORRECT, TEST_TIMEOUT_MS, actualOf, classify, describeRun, exitedWith, expectRailedLoopbackOnly, hasMarker, markerLine, newCaseId } from './fixtures/crashRun';

const FIXTURE = 'test/realpath/triage/fixtures/hostHeaderCrash.ts';
const SIGNAL = 'TypeError: Invalid URL';

function runMode(mode: 'fault' | 'healthy' | 'contained'): CliResult {
    const ledgerRunId = newCaseId('api-008', mode);
    const r = spawnRailedChild('node', ['-r', 'ts-node/register/transpile-only', FIXTURE, mode], { timeoutMs: CHILD_TIMEOUT_MS, ledgerRunId });
    onTestFailed(() => {
        console.error(`[AUD-API-008 ${mode}] ${describeRun(r)}`);
    });
    expectRailedLoopbackOnly(ledgerRunId);
    return r;
}

/** The path check: the real server was listening and the request was written to it. */
function expectReached(r: CliResult): void {
    expect(r.stdout, 'the real startApiServer was listening').toContain('Dashboard API server started');
    expect(hasMarker(r, 'RAW_REQUEST_SENT'), 'the raw request was sent').toBe(true);
}

describe('AUD-API-008: one malformed Host header on an upgrade request ends the whole process', () => {
    it('malformed-host-upgrade-exits: GET /ws with Upgrade: websocket and Host "a b" ends the process', { timeout: TEST_TIMEOUT_MS }, (ctx) => {
        const r = runMode('fault');
        expectReached(r);
        knownBug(ctx, 'AUD-API-008', {
            claim: 'malformed-host-upgrade-exits',
            correct: CORRECT,
            observed: exitedWith(SIGNAL),
            actual: actualOf(r, SIGNAL),
            expectedPlain: 'A malformed upgrade request is refused (400) and the dashboard server and the bot stay up.',
            actualPlain: 'One unauthenticated upgrade request with Host "a b" ends the whole bot process with code 1 (TypeError: Invalid URL).',
        });
    });

    it('control (healthy): the same request with a valid Host is answered 401 and the process survives', { timeout: TEST_TIMEOUT_MS }, () => {
        const r = runMode('healthy');
        expectReached(r);
        expect(markerLine(r, 'RAW_RESPONSE')).toBe('RAW_RESPONSE HTTP/1.1 401 Unauthorized');
        expect(classify(r)).toBe('survived');
        expect(r.stderr).not.toContain(SIGNAL);
    });

    it('contained: with process handlers the same request does not end the process, but it is never answered or closed', { timeout: TEST_TIMEOUT_MS }, () => {
        const r = runMode('contained');
        expectReached(r);
        if (!hasMarker(r, 'CONTAINED') && classify(r) === 'survived') {
            throw new Error('AUD-API-008 now behaves correctly in the contained case too (no process handler reached, the request answered): it looks fixed; update this control with the fault claim');
        }
        // The same fault happened and reached the handler.
        expect(markerLine(r, 'CONTAINED uncaughtException') ?? '').toContain(SIGNAL);
        // The process lives, but the request was neither answered nor closed in the window.
        expect(classify(r)).toBe('survived-work-pending');
        expect(hasMarker(r, 'RAW_RESPONSE')).toBe(false);
        expect(hasMarker(r, 'RAW_SOCKET_CLOSED')).toBe(false);
    });
});
