// Phase 20 / Plan 20-05 / OPS-LIVE-11 — `npm run pause` + `npm run resume`
// operator CLI tests.
//
// Both CLIs wrap dashboard endpoints (POST /api/auth/login → POST /api/controls/
// {pause,resume}) using DASHBOARD_API_KEY from .env. Both scripts NEVER log the
// apiKey value (T-20-05 mitigation — verified via static grep below).
//
// Test strategy: stand up an in-test express app with the production auth + login +
// controlRoutes mounted (matching the real dashboard surface), then spawn the
// real CLI via spawnSync pointing at the test server's port. Captures exit code,
// stdout/stderr, and asserts the pause endpoints fired by inspecting the mocked
// prepared statements (setPauseState / clearPauseState).
//
// T-20-05 enforcement: a separate static-grep test asserts that neither pause.ts
// nor resume.ts contains the literal `apiKey` substring inside any log call.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Detect platform-correct npx binary name (same pattern as
// scripts/deploy-honeypot-checker.ts).
const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';
const repoRoot = path.resolve(__dirname, '..', '..');

interface CliResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

// ---------------------------------------------------------------------------
// Test 1-5: subprocess + ephemeral express server
// ---------------------------------------------------------------------------

// Hoisted module-scope spies so vitest mockReset:true doesn't wipe impls between
// tests (Plan 20-04 cascade-fix precedent).
const setPauseStateRunSpy = vi.fn();
const clearPauseStateRunSpy = vi.fn();
const getPauseStateGetSpy = vi.fn();
const broadcastSpy = vi.fn();

vi.mock('../../src/utils/db', () => ({
    db: {
        prepare: vi.fn().mockReturnValue({ get: vi.fn(), all: vi.fn(), run: vi.fn() }),
    },
    setPauseState: { run: setPauseStateRunSpy },
    clearPauseState: { run: clearPauseStateRunSpy },
    getPauseState: { get: getPauseStateGetSpy },
}));

vi.mock('../../src/api/ws/broadcaster', () => ({
    broadcast: broadcastSpy,
    addClient: vi.fn(),
    removeClient: vi.fn(),
    getClientCount: vi.fn().mockReturnValue(0),
}));

vi.mock('../../src/utils/exitManager', () => ({
    clearAllTimersForToken: vi.fn(),
}));

vi.mock('../../src/exitEngine', () => ({
    executeFullSell: vi.fn(),
    exitConfig: {
        trailingStopPct: 15,
        stopLossPct: 25,
        partialSellTiers: [],
        urgencyWindowMs: 1800000,
    },
}));

vi.mock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            fatal: vi.fn(),
            child: () => ({
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
                fatal: vi.fn(),
            }),
        }),
    },
}));

describe('npm run pause / resume CLI (OPS-LIVE-11)', () => {
    let server: import('http').Server;
    let port: number;
    const DASHBOARD_API_KEY = 'cli-test-api-key-1234567890';

    beforeAll(async () => {
        // Build a minimal dashboard surface: /api/auth/login + /api/controls/{pause,resume}
        // mounted with the production authMiddleware so the cookie-forwarding flow runs.
        process.env.DASHBOARD_API_KEY = DASHBOARD_API_KEY;

        const express = (await import('express')).default;
        const cookieParser = (await import('cookie-parser')).default;
        const { authRoutes } = await import('../../src/api/routes/auth');
        const { controlRoutes } = await import('../../src/api/routes/controls');
        const { authMiddleware } = await import('../../src/api/middleware/auth');

        const app = express();
        app.use(express.json());
        app.use(cookieParser());
        app.use('/api/auth', authRoutes());
        const apiRouter = express.Router();
        apiRouter.use('/controls', controlRoutes([]));
        app.use('/api', authMiddleware, apiRouter);

        await new Promise<void>((resolve) => {
            server = app.listen(0, '127.0.0.1', () => {
                port = (server.address() as { port: number }).port;
                resolve();
            });
        });
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        delete process.env.DASHBOARD_API_KEY;
    });

    beforeEach(() => {
        setPauseStateRunSpy.mockReset();
        clearPauseStateRunSpy.mockReset();
        getPauseStateGetSpy.mockReset();
        broadcastSpy.mockReset();
        getPauseStateGetSpy.mockReturnValue({
            paused: 0,
            paused_at: null,
            paused_by: null,
            reason: null,
        });
    });

    function runScript(script: 'pause.ts' | 'resume.ts', env: Record<string, string>, args: string[] = []): CliResult {
        const result = spawnSync(npxCmd, ['ts-node', `scripts/${script}`, ...args], {
            cwd: repoRoot,
            env: { ...process.env, ...env },
            shell: true,
            encoding: 'utf8',
            timeout: 30_000,
        });
        return {
            status: result.status,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
        };
    }

    it('Test 1: pause CLI invokes POST /api/controls/pause → setPauseState.run called + broadcast fires', () => {
        const result = runScript(
            'pause.ts',
            {
                DASHBOARD_API_KEY,
                DASHBOARD_URL: `http://127.0.0.1:${port}`,
            },
            ['--reason', 'test from cli'],
        );

        expect(result.status).toBe(0);

        // setPauseState.run called by the route handler with the sanitized reason.
        expect(setPauseStateRunSpy).toHaveBeenCalledTimes(1);
        const [ts, pausedBy, reason] = setPauseStateRunSpy.mock.calls[0] as [number, string, string];
        expect(typeof ts).toBe('number');
        expect(pausedBy).toBe('cli');
        expect(reason).toBe('test from cli');

        // broadcast fires pause_state_change event (OPS-LIVE-11 Test 5).
        expect(broadcastSpy).toHaveBeenCalledTimes(1);
        const [eventType, payload] = broadcastSpy.mock.calls[0];
        expect(eventType).toBe('pause_state_change');
        expect(payload).toMatchObject({ paused: true, pausedBy: 'cli', reason: 'test from cli' });
    });

    it('Test 2: resume CLI invokes POST /api/controls/resume → clearPauseState.run + broadcast({paused:false})', () => {
        const result = runScript('resume.ts', {
            DASHBOARD_API_KEY,
            DASHBOARD_URL: `http://127.0.0.1:${port}`,
        });

        expect(result.status).toBe(0);

        expect(clearPauseStateRunSpy).toHaveBeenCalledTimes(1);

        expect(broadcastSpy).toHaveBeenCalledTimes(1);
        const [eventType, payload] = broadcastSpy.mock.calls[0];
        expect(eventType).toBe('pause_state_change');
        expect(payload).toMatchObject({ paused: false });
    });

    it('Test 3: both CLIs invoke POST /api/auth/login FIRST → then forward Cookie header on action POST', () => {
        // Run pause.ts and assert the auth flow succeeded (status 0 + setPauseState
        // was reached). Since the /api/controls/pause mount is behind authMiddleware,
        // reaching setPauseState proves the cookie was forwarded successfully.
        const pauseResult = runScript(
            'pause.ts',
            {
                DASHBOARD_API_KEY,
                DASHBOARD_URL: `http://127.0.0.1:${port}`,
            },
            ['--reason', 'cookie test'],
        );
        expect(pauseResult.status).toBe(0);
        expect(setPauseStateRunSpy).toHaveBeenCalledTimes(1);

        // Reset spies and run resume.ts — same auth-then-action cookie-forward path.
        setPauseStateRunSpy.mockReset();
        clearPauseStateRunSpy.mockReset();
        broadcastSpy.mockReset();

        const resumeResult = runScript('resume.ts', {
            DASHBOARD_API_KEY,
            DASHBOARD_URL: `http://127.0.0.1:${port}`,
        });
        expect(resumeResult.status).toBe(0);
        expect(clearPauseStateRunSpy).toHaveBeenCalledTimes(1);
    });

    it('Test 4: missing DASHBOARD_API_KEY → CLI FATAL exit 1 with stderr containing DASHBOARD_API_KEY required', () => {
        const result = runScript(
            'pause.ts',
            {
                // DASHBOARD_API_KEY intentionally unset
                DASHBOARD_API_KEY: '',
                DASHBOARD_URL: `http://127.0.0.1:${port}`,
            },
            ['--reason', 'should-not-reach'],
        );

        expect(result.status).toBe(1);
        // Plan acceptance: grep -c "DASHBOARD_API_KEY not set" scripts/pause.ts ≥ 2
        // Subprocess emits this exact phrase to stderr (pino fatal).
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/DASHBOARD_API_KEY not set|DASHBOARD_API_KEY required/i);

        // Pause never reached endpoint.
        expect(setPauseStateRunSpy).not.toHaveBeenCalled();
    });

    it('Test 5: broadcast fires pause_state_change on both pause and resume (real-time WS surface)', () => {
        // pause.ts → broadcast(pause_state_change, {paused:true,...})
        runScript(
            'pause.ts',
            { DASHBOARD_API_KEY, DASHBOARD_URL: `http://127.0.0.1:${port}` },
            ['--reason', 'ws-spy-test'],
        );
        expect(broadcastSpy).toHaveBeenCalledWith(
            'pause_state_change',
            expect.objectContaining({ paused: true }),
        );

        // resume.ts → broadcast(pause_state_change, {paused:false})
        broadcastSpy.mockReset();
        runScript('resume.ts', { DASHBOARD_API_KEY, DASHBOARD_URL: `http://127.0.0.1:${port}` });
        expect(broadcastSpy).toHaveBeenCalledWith(
            'pause_state_change',
            expect.objectContaining({ paused: false }),
        );
    });
});

// ---------------------------------------------------------------------------
// T-20-05 mitigation: static grep — apiKey must NEVER appear inside a log call.
// ---------------------------------------------------------------------------

describe('T-20-05 mitigation: apiKey never logged in CLI scripts', () => {
    it('scripts/pause.ts contains no log call referencing apiKey', () => {
        const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'pause.ts'), 'utf8');
        // Match log.info / log.warn / log.error / log.fatal calls whose arguments
        // contain the literal `apiKey`. Even one match = T-20-05 violation.
        const violations = src.match(/log\.(info|warn|error|fatal|debug)\s*\([^)]*apiKey/g);
        expect(violations).toBeNull();
    });

    it('scripts/resume.ts contains no log call referencing apiKey', () => {
        const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'resume.ts'), 'utf8');
        const violations = src.match(/log\.(info|warn|error|fatal|debug)\s*\([^)]*apiKey/g);
        expect(violations).toBeNull();
    });
});
