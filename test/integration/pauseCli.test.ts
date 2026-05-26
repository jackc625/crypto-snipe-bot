// Phase 20 / Plan 20-05 / OPS-LIVE-11 — `npm run pause` + `npm run resume`
// operator CLI tests.
//
// Both CLIs wrap dashboard endpoints (POST /api/auth/login → POST /api/controls/
// {pause,resume}) using DASHBOARD_API_KEY from .env. Both scripts NEVER log the
// apiKey value (T-20-05 mitigation — verified via static grep).
//
// Test strategy: hybrid (subprocess spawning ts-node is too slow on Windows
// to run 5 of them within a single test file's 15s vitest budget — each cold
// ts-node startup is ~2-4s)
//
//   * Tests 1, 2, 5: in-process simulation — stand up the production /api/auth/
//     login + /api/controls/{pause,resume} surface against an ephemeral express
//     port + invoke axios with the same login-then-action shape the CLI uses.
//     This proves the END-TO-END auth + cookie-forward + db.setPauseState +
//     broadcast(pause_state_change) flow that the CLI exercises.
//   * Test 3 (cookie forwarding): same in-process axios pattern — proves the
//     login-cookie-forward semantics by inspecting the actual HTTP traffic.
//   * Test 4 (missing DASHBOARD_API_KEY → exit 1): direct subprocess spawn —
//     this test is fast because the script exits IMMEDIATELY on env check,
//     before any network call. Single subprocess invocation stays within budget.
//   * Static grep tests: read scripts/{pause,resume}.ts source and assert no
//     `log.<level>([^)]*apiKey)` patterns (T-20-05 mitigation — apiKey must
//     never appear inside a log call).

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import axios from 'axios';

const repoRoot = path.resolve(__dirname, '..', '..');
const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

// Hoisted module-scope spies. vitest.config.ts has mockReset:true which wipes
// vi.fn() impls between tests — Plan 20-04 cascade-fix precedent.
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

// ---------------------------------------------------------------------------
// Tests 1, 2, 3, 5 — in-process simulation of the CLI's HTTP flow
// ---------------------------------------------------------------------------

describe('npm run pause / resume CLI HTTP flow (OPS-LIVE-11)', () => {
    let server: import('http').Server;
    let baseUrl: string;
    const DASHBOARD_API_KEY = 'cli-test-api-key-1234567890';

    beforeAll(async () => {
        // Mimic the dashboard surface the CLI hits: POST /api/auth/login (auth)
        // + POST /api/controls/{pause,resume} behind authMiddleware.
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
                const port = (server.address() as { port: number }).port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    afterAll(async () => {
        if (server) {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
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

    /**
     * Simulate the CLI's two-step login-then-action flow with axios. This is
     * structurally IDENTICAL to scripts/pause.ts / scripts/resume.ts (same
     * axios.post, same Cookie header forwarding, same validateStatus shim).
     */
    async function loginAndPost(actionPath: '/api/controls/pause' | '/api/controls/resume', body: unknown = {}): Promise<{
        loginStatus: number;
        actionStatus: number;
        actionData: any;
        cookie: string;
    }> {
        const loginRes = await axios.post(
            `${baseUrl}/api/auth/login`,
            { apiKey: DASHBOARD_API_KEY },
            { validateStatus: () => true },
        );
        const setCookie = loginRes.headers['set-cookie'];
        const cookie = Array.isArray(setCookie) && setCookie.length > 0 ? setCookie[0] : '';

        const actionRes = await axios.post(
            `${baseUrl}${actionPath}`,
            body,
            { headers: { Cookie: cookie }, validateStatus: () => true },
        );

        return {
            loginStatus: loginRes.status,
            actionStatus: actionRes.status,
            actionData: actionRes.data,
            cookie,
        };
    }

    it('Test 1: pause flow invokes POST /api/controls/pause → setPauseState.run called + broadcast fires', async () => {
        const res = await loginAndPost('/api/controls/pause', {
            reason: 'test from cli',
            pausedBy: 'cli',
        });

        expect(res.loginStatus).toBe(200);
        expect(res.actionStatus).toBe(200);
        expect(res.actionData.ok).toBe(true);
        expect(res.actionData.paused).toBe(true);

        // setPauseState.run called by the route handler with (ts:number, pausedBy, sanitizedReason).
        expect(setPauseStateRunSpy).toHaveBeenCalledTimes(1);
        const [ts, pausedBy, reason] = setPauseStateRunSpy.mock.calls[0] as [number, string, string];
        expect(typeof ts).toBe('number');
        expect(pausedBy).toBe('cli');
        expect(reason).toBe('test from cli');

        // broadcast fires pause_state_change event.
        expect(broadcastSpy).toHaveBeenCalledTimes(1);
        const [eventType, payload] = broadcastSpy.mock.calls[0];
        expect(eventType).toBe('pause_state_change');
        expect(payload).toMatchObject({ paused: true, pausedBy: 'cli', reason: 'test from cli' });
    });

    it('Test 2: resume flow invokes POST /api/controls/resume → clearPauseState.run + broadcast({paused:false})', async () => {
        const res = await loginAndPost('/api/controls/resume', {});

        expect(res.loginStatus).toBe(200);
        expect(res.actionStatus).toBe(200);
        expect(res.actionData.ok).toBe(true);
        expect(res.actionData.paused).toBe(false);

        expect(clearPauseStateRunSpy).toHaveBeenCalledTimes(1);

        expect(broadcastSpy).toHaveBeenCalledTimes(1);
        const [eventType, payload] = broadcastSpy.mock.calls[0];
        expect(eventType).toBe('pause_state_change');
        expect(payload).toMatchObject({ paused: false });
    });

    it('Test 3: both flows invoke POST /api/auth/login FIRST → forward Cookie header on action POST', async () => {
        const pauseRes = await loginAndPost('/api/controls/pause', { reason: 'cookie-test', pausedBy: 'cli' });
        expect(pauseRes.loginStatus).toBe(200);
        expect(pauseRes.cookie).toMatch(/^session=/);  // cookie set by login
        expect(pauseRes.actionStatus).toBe(200);       // cookie accepted by authMiddleware
        expect(setPauseStateRunSpy).toHaveBeenCalledTimes(1);

        setPauseStateRunSpy.mockReset();
        clearPauseStateRunSpy.mockReset();

        const resumeRes = await loginAndPost('/api/controls/resume', {});
        expect(resumeRes.loginStatus).toBe(200);
        expect(resumeRes.cookie).toMatch(/^session=/);
        expect(resumeRes.actionStatus).toBe(200);
        expect(clearPauseStateRunSpy).toHaveBeenCalledTimes(1);
    });

    it('Test 5: broadcast fires pause_state_change on both pause and resume (real-time WS surface)', async () => {
        await loginAndPost('/api/controls/pause', { reason: 'ws-spy', pausedBy: 'cli' });
        expect(broadcastSpy).toHaveBeenCalledWith(
            'pause_state_change',
            expect.objectContaining({ paused: true }),
        );

        broadcastSpy.mockReset();
        await loginAndPost('/api/controls/resume', {});
        expect(broadcastSpy).toHaveBeenCalledWith(
            'pause_state_change',
            expect.objectContaining({ paused: false }),
        );
    });
});

// ---------------------------------------------------------------------------
// Test 4: subprocess spawn — only ONE subprocess, fast path (immediate exit
// on missing env so ts-node startup is the only overhead).
// ---------------------------------------------------------------------------

describe('npm run pause CLI subprocess invariants (OPS-LIVE-11)', () => {
    it(
        'Test 4: missing DASHBOARD_API_KEY → CLI FATAL exit 1 with stderr containing DASHBOARD_API_KEY not set',
        () => {
            // Need to clear DASHBOARD_API_KEY in the child env AND prevent the
            // child's dotenv.config() from re-injecting it from the .env file.
            // We achieve this by setting a custom DOTENV_CONFIG_PATH to a
            // nonexistent file, but dotenv silently ignores missing files. The
            // most reliable approach: copy the actual env, then forcibly delete
            // the key. dotenv.config() in the child WILL re-inject from .env if
            // the file exists, but we can override the in-process env value
            // AFTER dotenv runs by reading the script directly... actually the
            // simplest reliable approach is to use { override: false } default
            // dotenv behavior plus a custom DOTENV_CONFIG_PATH.

            // dotenv default behavior: if process.env.DASHBOARD_API_KEY is
            // already set (even to empty string), dotenv.config() does NOT
            // override it unless { override: true }. So setting the child env
            // var to empty string PLUS the script's check is `if (!apiKey)`
            // (which catches '' as falsy) → exits 1.
            const childEnv = { ...process.env };
            // Force-blank the key so the in-process apiKey lookup gets empty.
            childEnv.DASHBOARD_API_KEY = '';

            const result = spawnSync(npxCmd, ['ts-node', 'scripts/pause.ts', '--reason', 'should-not-reach'], {
                cwd: repoRoot,
                env: childEnv,
                shell: true,
                encoding: 'utf8',
                timeout: 60_000,
            });

            expect(result.status).toBe(1);
            const combined = (result.stdout ?? '') + (result.stderr ?? '');
            expect(combined).toMatch(/DASHBOARD_API_KEY not set/i);
        },
        90_000, // give vitest 90s for this single subprocess test (ts-node cold start on Windows ~3-5s)
    );
});

// ---------------------------------------------------------------------------
// T-20-05 mitigation: static grep — apiKey must NEVER appear inside a log call
// in either scripts/pause.ts or scripts/resume.ts.
// ---------------------------------------------------------------------------

describe('T-20-05 mitigation: apiKey never logged in CLI scripts', () => {
    it('scripts/pause.ts contains no log call referencing apiKey', () => {
        const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'pause.ts'), 'utf8');
        const violations = src.match(/log\.(info|warn|error|fatal|debug)\s*\([^)]*apiKey/g);
        expect(violations).toBeNull();
    });

    it('scripts/resume.ts contains no log call referencing apiKey', () => {
        const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'resume.ts'), 'utf8');
        const violations = src.match(/log\.(info|warn|error|fatal|debug)\s*\([^)]*apiKey/g);
        expect(violations).toBeNull();
    });

    it('scripts/pause.ts contains 1 "DASHBOARD_API_KEY not set" string + 0 CLI-arg references to apiKey', () => {
        const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'pause.ts'), 'utf8');
        // Must reference the env-var name at the env-check site.
        expect(src.match(/DASHBOARD_API_KEY not set/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
        // Must NOT pass apiKey as a CLI argument (process.argv lookup).
        expect(src).not.toMatch(/process\.argv\.indexOf\(['"]--api-key/);
        // Must NOT read apiKey from any positional argv index.
        expect(src).not.toMatch(/argv\[[0-9]+\]\s*as\s+apiKey/);
    });

    it('scripts/resume.ts contains 1 "DASHBOARD_API_KEY not set" string + 0 CLI-arg references to apiKey', () => {
        const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'resume.ts'), 'utf8');
        expect(src.match(/DASHBOARD_API_KEY not set/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
        expect(src).not.toMatch(/process\.argv\.indexOf\(['"]--api-key/);
    });
});

// ---------------------------------------------------------------------------
// 20-09: CLI default URL derived from DASHBOARD_HOST/DASHBOARD_PORT (the server
// bind), NOT the old hardcoded http://localhost:3000. Source-grep guard —
// matches the established static-grep idiom above and is deterministic (the
// in-process harness binds an ephemeral listen(0) port and does not expose it
// to process.env.DASHBOARD_PORT, and the CLI scripts are not invoked in-process,
// so a behavioral assertion would not actually exercise the scripts' default).
// ---------------------------------------------------------------------------

describe('20-09: CLI default URL derives from DASHBOARD_HOST/DASHBOARD_PORT', () => {
    const readScript = (name: 'pause.ts' | 'resume.ts'): string =>
        fs.readFileSync(path.join(repoRoot, 'scripts', name), 'utf8');

    for (const script of ['pause.ts', 'resume.ts'] as const) {
        it(`scripts/${script} no longer hardcodes the 'http://localhost:3000' default`, () => {
            const src = readScript(script);
            // The literal default string must be gone from both scripts entirely
            // (the bug was dialing the SPA dev :3000 instead of the API bind).
            expect(src).not.toContain('localhost:3000');
            expect(src).not.toContain("'http://localhost:3000'");
        });

        it(`scripts/${script} derives the default from DASHBOARD_PORT with an 8080 fallback`, () => {
            const src = readScript(script);
            // Reads DASHBOARD_PORT (mirrors src/api/server.ts:161-162 bind)…
            expect(src).toMatch(/process\.env\.DASHBOARD_PORT/);
            // …with the 8080 server-bind fallback…
            expect(src).toMatch(/DASHBOARD_PORT\s*\|\|\s*['"]8080['"]/);
            // …and DASHBOARD_HOST defaulting to the IPv4 127.0.0.1 (NOT localhost,
            // to avoid the ::1 IPv6 refusal from the live UAT).
            expect(src).toMatch(/DASHBOARD_HOST\s*\|\|\s*['"]127\.0\.0\.1['"]/);
            // The composed default is http://<host>:<port>.
            expect(src).toMatch(/http:\/\/\$\{host\}:\$\{port\}/);
        });

        it(`scripts/${script} still honors an explicit DASHBOARD_URL override`, () => {
            const src = readScript(script);
            // process.env.DASHBOARD_URL || <derived default> — operator override
            // is unchanged; only the fallback side of the || moved off :3000.
            expect(src).toMatch(/process\.env\.DASHBOARD_URL\s*\|\|/);
        });

        it(`scripts/${script} connection-error catch references host:port + DASHBOARD_PORT, never apiKey`, () => {
            const src = readScript(script);
            // The crash handler must surface a clear message (no empty err:'').
            expect(src).toMatch(/Could not reach the dashboard API/);
            expect(src).toMatch(/DASHBOARD_PORT/);
            // T-20-05: apiKey must not appear inside the new connection-error
            // log call (re-assert the static guard against the new catch block).
            const fatalCalls = src.match(/log\.fatal\s*\([^;]*?\)/gs) ?? [];
            for (const call of fatalCalls) {
                expect(call).not.toContain('apiKey');
            }
        });
    }
});
