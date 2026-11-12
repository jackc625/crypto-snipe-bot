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
//   * T-20-05 and 20-09 (plan 23-31, CHAR-06): each script runs as a railed
//     child against a closed loopback port or a loopback dashboard that refuses
//     the login; the tests check the key value never reaches either output
//     stream, an empty key refuses even with --api-key on the command line, and
//     the address the script dials. These used to be greps of the scripts' text.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import axios from 'axios';
import { spawnRailedChild, spawnRailedChildAsync } from '../rails/spawnRailedChild';

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
    forceWalCheckpoint: vi.fn(),
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
            // The child runs on the sentinel test env through the railed spawner
            // (SAFE-02 D-03): the parent env is never copied in, and the child's
            // rails block any read of the repo .env. The override blanks the key
            // so the script's `if (!apiKey)` check (which catches '' as falsy)
            // exits 1 before any network call.
            const result = spawnRailedChild('npx', ['ts-node', 'scripts/pause.ts', '--reason', 'should-not-reach'], {
                envOverrides: { DASHBOARD_API_KEY: '' },
            });

            expect(result.status).toBe(1);
            const combined = result.stdout + result.stderr;
            expect(combined).toMatch(/DASHBOARD_API_KEY not set/i);
        },
        90_000, // give vitest 90s for this single subprocess test (ts-node cold start on Windows ~3-5s)
    );
});

// ---------------------------------------------------------------------------
// Plan 23-31 (CHAR-06): the T-20-05 and 20-09 tests below used to read scripts/pause.ts and
// scripts/resume.ts as text. Each now runs the real script as a railed child (the async spawner,
// so a loopback server in this process can answer it) and checks what the script does: what it
// dials, what it prints and how it exits. No source file is read. The children are started with
// ts-node's transpile-only register, as the lock fixtures are; the default npx ts-node type-check
// still runs in Test 4 above and in processLock.test.ts (AC-23d).
// ---------------------------------------------------------------------------

type CliScript = 'pause.ts' | 'resume.ts';

// A unique key value: if any part of it reaches either output stream, the test sees it.
const PLANTED_KEY = 'csb-23-31-dashboard-key-5f0c2e9a';
// Each child is one cold transpile-only ts-node start (0.4 to 1.0 s alone); the limits leave room
// for the full parallel run.
const CLI_CHILD_LIMIT_MS = 110_000;
const CLI_TEST_TIMEOUT_MS = 120_000;

interface CliRun {
    status: number | null;
    output: string;
}

function runCliScript(script: CliScript, envOverrides: Record<string, string>, extraArgs: string[] = []): Promise<CliRun> {
    const child = spawnRailedChildAsync(process.execPath, ['-r', 'ts-node/register/transpile-only', `scripts/${script}`, ...extraArgs], {
        envOverrides,
        timeoutMs: CLI_CHILD_LIMIT_MS,
    });
    let output = '';
    child.stdout?.on('data', (c: Buffer) => {
        output += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
        output += c.toString('utf8');
    });
    return new Promise((resolve) => child.once('close', (status) => resolve({ status, output })));
}

/** A loopback port with nothing listening on it (bound, read, closed). */
async function closedPort(): Promise<number> {
    const srv = net.createServer();
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
    const { port } = srv.address() as net.AddressInfo;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    return port;
}

interface LoginRefuser {
    url: string;
    port: number;
    logins: unknown[];
    close(): Promise<void>;
}

/** A loopback dashboard that answers every login with 401 and records what it was sent. */
async function loginRefuser(): Promise<LoginRefuser> {
    const logins: unknown[] = [];
    const srv = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => {
            body += c.toString('utf8');
        });
        req.on('end', () => {
            if (req.method === 'POST' && req.url === '/api/auth/login') {
                logins.push(JSON.parse(body));
                res.writeHead(401, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid API key' }));
                return;
            }
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
        });
    });
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
    const { port } = srv.address() as net.AddressInfo;
    return {
        url: `http://127.0.0.1:${port}`,
        port,
        logins,
        close: () => new Promise<void>((resolve) => srv.close(() => resolve())),
    };
}

/** The failed login is logged, the key was really sent, and its value is in neither stream. */
async function expectKeyNeverPrintedOnRefusedLogin(script: CliScript): Promise<void> {
    const dashboard = await loginRefuser();
    try {
        const r = await runCliScript(script, {
            DASHBOARD_API_KEY: PLANTED_KEY,
            DASHBOARD_URL: dashboard.url,
            DASHBOARD_HOST: '127.0.0.1',
            DASHBOARD_PORT: String(dashboard.port),
        });
        expect(r.status, r.output).toBe(1);
        expect(r.output).toContain('Login failed');
        // The script held the key and sent it in the login body, so it had the value to leak.
        expect(dashboard.logins).toEqual([{ apiKey: PLANTED_KEY }]);
        expect(r.output).not.toContain(PLANTED_KEY);
    } finally {
        await dashboard.close();
    }
}

/** An empty key refuses before any request; a key on the command line is never a substitute. */
async function expectEmptyKeyRefusedDespiteArgv(script: CliScript): Promise<void> {
    const port = await closedPort();
    const r = await runCliScript(
        script,
        { DASHBOARD_API_KEY: '', DASHBOARD_URL: `http://127.0.0.1:${port}`, DASHBOARD_PORT: String(port) },
        ['--api-key', PLANTED_KEY],
    );
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/DASHBOARD_API_KEY not set/);
    expect(r.output).not.toContain('Could not reach the dashboard API');
}

describe('T-20-05 mitigation: apiKey never logged in CLI scripts', () => {
    // Plan 23-31: was "scripts/pause.ts contains no log call referencing apiKey" (a regex over the text).
    it(
        'scripts/pause.ts never prints the DASHBOARD_API_KEY value when the dashboard refuses the login',
        () => expectKeyNeverPrintedOnRefusedLogin('pause.ts'),
        CLI_TEST_TIMEOUT_MS,
    );

    // Plan 23-31: was "scripts/resume.ts contains no log call referencing apiKey".
    it(
        'scripts/resume.ts never prints the DASHBOARD_API_KEY value when the dashboard refuses the login',
        () => expectKeyNeverPrintedOnRefusedLogin('resume.ts'),
        CLI_TEST_TIMEOUT_MS,
    );

    // Plan 23-31: was 'scripts/pause.ts contains 1 "DASHBOARD_API_KEY not set" string + 0 CLI-arg references to apiKey'.
    it(
        'scripts/pause.ts with an empty DASHBOARD_API_KEY exits 1 with "DASHBOARD_API_KEY not set", even when --api-key is passed',
        () => expectEmptyKeyRefusedDespiteArgv('pause.ts'),
        CLI_TEST_TIMEOUT_MS,
    );

    // Plan 23-31: was 'scripts/resume.ts contains 1 "DASHBOARD_API_KEY not set" string + 0 CLI-arg references to apiKey'.
    it(
        'scripts/resume.ts with an empty DASHBOARD_API_KEY exits 1 with "DASHBOARD_API_KEY not set", even when --api-key is passed',
        () => expectEmptyKeyRefusedDespiteArgv('resume.ts'),
        CLI_TEST_TIMEOUT_MS,
    );
});

// ---------------------------------------------------------------------------
// 20-09: CLI default URL derived from DASHBOARD_HOST/DASHBOARD_PORT (the server bind), NOT the old
// hardcoded http://localhost:3000. Each test runs the script against a closed loopback port and
// reads the address it reports from its connection-error message, which names the URL it dialed.
// (127.0.0.1:8080 itself must have nothing listening for the default case; the assertion message
// shows the output if it does.)
// ---------------------------------------------------------------------------

function dialed(output: string): string | null {
    const m = /Could not reach the dashboard API at (\S+) \(/.exec(output);
    return m ? m[1] : null;
}

describe('20-09: CLI default URL derives from DASHBOARD_HOST/DASHBOARD_PORT', () => {
    for (const script of ['pause.ts', 'resume.ts'] as const) {
        it(
            `scripts/${script} no longer hardcodes the 'http://localhost:3000' default`,
            async () => {
                const r = await runCliScript(script, { DASHBOARD_URL: '', DASHBOARD_HOST: '', DASHBOARD_PORT: '' });
                expect(r.status, r.output).toBe(2);
                expect(dialed(r.output), r.output).toBe('http://127.0.0.1:8080');
                expect(r.output).not.toContain(':3000');
            },
            CLI_TEST_TIMEOUT_MS,
        );

        it(
            `scripts/${script} derives the default from DASHBOARD_PORT with an 8080 fallback`,
            async () => {
                // 8080 when DASHBOARD_PORT is empty is the test above; here both parts are set.
                const port = await closedPort();
                const r = await runCliScript(script, { DASHBOARD_URL: '', DASHBOARD_HOST: '127.0.0.2', DASHBOARD_PORT: String(port) });
                expect(r.status, r.output).toBe(2);
                expect(dialed(r.output), r.output).toBe(`http://127.0.0.2:${port}`);
            },
            CLI_TEST_TIMEOUT_MS,
        );

        it(
            `scripts/${script} still honors an explicit DASHBOARD_URL override`,
            async () => {
                const urlPort = await closedPort();
                const otherPort = await closedPort();
                const r = await runCliScript(script, { DASHBOARD_URL: `http://127.0.0.1:${urlPort}`, DASHBOARD_HOST: '127.0.0.1', DASHBOARD_PORT: String(otherPort) });
                expect(r.status, r.output).toBe(2);
                expect(dialed(r.output), r.output).toBe(`http://127.0.0.1:${urlPort}`);
            },
            CLI_TEST_TIMEOUT_MS,
        );

        it(
            `scripts/${script} connection-error catch references host:port + DASHBOARD_PORT, never apiKey`,
            async () => {
                const port = await closedPort();
                const r = await runCliScript(script, {
                    DASHBOARD_API_KEY: PLANTED_KEY,
                    DASHBOARD_URL: `http://127.0.0.1:${port}`,
                    DASHBOARD_HOST: '127.0.0.1',
                    DASHBOARD_PORT: String(port),
                });
                // The defined "could not reach" path: exit 2, a clear message naming the address
                // and the variables to check, and the key value nowhere in either stream.
                expect(r.status, r.output).toBe(2);
                expect(r.output).toContain(`Could not reach the dashboard API at http://127.0.0.1:${port} (ECONNREFUSED)`);
                expect(r.output).toContain('DASHBOARD_PORT');
                expect(r.output).not.toContain(PLANTED_KEY);
            },
            CLI_TEST_TIMEOUT_MS,
        );
    }
});
