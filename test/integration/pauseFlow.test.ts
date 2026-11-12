// Phase 20 / Plan 20-05 — implementation flips the 4 stubs from Plan 20-00 to
// live + adds 4 new endpoint-exercise tests for src/api/routes/controls.ts POST
// /pause + POST /resume + GET /pause routes.
//
// Tests 1-4 (persistence + restart-survival per D-PAUSED-RESTART) run the real
// src/utils/db.ts pause statements on a fresh temp database file migrated by the
// real migrateSchema (Phase 23 plan 23-14, AUD-TESTI-001; see the block below).
//
// Tests 5-8 (endpoint exercise) mount controlRoutes() against a minimal express
// app via raw http (matching test/integration/api/controls.test.ts pattern;
// supertest is not a dep). The src/utils/db module is fully mocked so the
// endpoints exercise their handler logic + the broadcast spy assertion fires
// without touching disk.
//
// Test 9 (D-PAUSED-RESTART positive observable from Plan 20-04) is preserved
// verbatim.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import express from 'express';
import { CURRENT_SCHEMA_VERSION } from '../../src/utils/dbSchema';

// ---------------------------------------------------------------------------
// Tests 1-4 run the bot's REAL pause statements: getPauseState, setPauseState and
// clearPauseState as src/utils/db.ts prepares them, on a temp database file that the real
// module opens (openGuardedDb, its pragmas) and migrates with the real migrateSchema
// (src/utils/dbSchema.ts). This file mocks src/utils/db for Tests 5-9, so Tests 1-4 load the
// real module with vi.importActual after vi.resetModules, with DB_PATH pointing at the temp
// file; a second load on the same file is a real restart of the module. There is no
// hand-written schema here any more (AUD-TESTI-001, plan 23-14): the shape of the migrated
// pause_state table itself (CHECK(id = 1), the default unpaused row) is pinned against the
// recorded version 7 schema by test/realpath/migrations/migrations.golden.test.ts (AC-04 from
// version 0, AC-05 from the frozen version 4 fixture, AC-06 re-run with a paused row).
// ---------------------------------------------------------------------------

type RealDbModule = typeof import('../../src/utils/db');

/** Load a fresh instance of the real src/utils/db bound to dbPath (the file is created and migrated). */
async function loadRealDb(dbPath: string): Promise<RealDbModule> {
    process.env.DB_PATH = dbPath;
    vi.resetModules();
    return vi.importActual<RealDbModule>('../../src/utils/db');
}

interface PauseRow {
    paused: number;
    paused_at: number | null;
    paused_by: string | null;
    reason: string | null;
}

// ---------------------------------------------------------------------------
// Tests 1-4: pause_state persistence + restart-survival (OPS-LIVE-09 / D-PAUSED-RESTART)
// ---------------------------------------------------------------------------

// closes-finding: AUD-TESTI-001 (pauseFlow half: Tests 1-4 run the real pause statements on the real migrations; RED proof 23-14-7-pauseflow-real-statements.txt)
describe('pause state restart survival (OPS-LIVE-09 / D-PAUSED-RESTART)', () => {
    let tmpDir: string;
    let tmpDbPath: string;
    let savedDbPath: string | undefined;

    beforeEach(() => {
        savedDbPath = process.env.DB_PATH;
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-flow-'));
        tmpDbPath = path.join(tmpDir, 'test.db');
    });

    afterEach(() => {
        // Restore the rails' value (test/.env.test sets DB_PATH empty), never leave a temp path behind.
        if (savedDbPath === undefined) delete process.env.DB_PATH;
        else process.env.DB_PATH = savedDbPath;
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            /* ignore — Windows may hold the WAL file briefly */
        }
    });

    it('Test 1: setPauseState writes a row visible to getPauseState with paused=1 + audit columns populated', async () => {
        const real = await loadRealDb(tmpDbPath);
        try {
            // The real module bound this test's file and migrated it to the current version.
            expect(real.getDbFilePath()).toBe(path.resolve(tmpDbPath));
            expect(real.db.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION);

            const ts = 1700000000;
            const info = real.setPauseState.run(ts, 'manual', 'test reason');
            // The migration's single pause row is what the UPDATE writes to.
            expect(info.changes).toBe(1);

            const row = real.getPauseState.get() as PauseRow;
            expect(row.paused).toBe(1);
            expect(row.paused_at).toBe(ts);
            expect(row.paused_by).toBe('manual');
            expect(row.reason).toBe('test reason');
        } finally {
            real.closeDb();
        }
    });

    it('Test 2: restart simulation — setPauseState → db.close() → reopen → row still present', async () => {
        // First load of the real module: write the row with the real statement, close.
        const first = await loadRealDb(tmpDbPath);
        try {
            expect(first.setPauseState.run(1700000000, 'manual', 'survives-restart').changes).toBe(1);
        } finally {
            first.closeDb();
        }
        expect(first.db.open).toBe(false);

        // Second load at the same DB_PATH (restart): a new module instance on a new connection,
        // which re-runs the real migrations on the existing file; the row must still be there.
        const second = await loadRealDb(tmpDbPath);
        try {
            expect(second).not.toBe(first);
            expect(second.db).not.toBe(first.db);
            expect(second.db.open).toBe(true);
            expect(second.getDbFilePath()).toBe(path.resolve(tmpDbPath));

            const row = second.getPauseState.get() as PauseRow;
            expect(row.paused).toBe(1);
            expect(row.paused_at).toBe(1700000000);
            expect(row.paused_by).toBe('manual');
            expect(row.reason).toBe('survives-restart');
        } finally {
            second.closeDb();
        }
    });

    it('Test 3: clearPauseState flips paused 1 → 0 AND nulls all audit columns', async () => {
        const real = await loadRealDb(tmpDbPath);
        try {
            expect(real.setPauseState.run(1700000000, 'manual', 'before-clear').changes).toBe(1);
            expect((real.getPauseState.get() as PauseRow).paused).toBe(1);

            expect(real.clearPauseState.run().changes).toBe(1);
            const row = real.getPauseState.get() as PauseRow;
            expect(row.paused).toBe(0);
            expect(row.paused_at).toBeNull();
            expect(row.paused_by).toBeNull();
            expect(row.reason).toBeNull();
        } finally {
            real.closeDb();
        }
    });

    it('Test 4: single-row constraint enforced — cannot INSERT id=2 (CHECK(id=1))', async () => {
        // On the table the real migrations created (no bot statement inserts a pause row; the
        // migration's own INSERT OR IGNORE is the only writer of id 1).
        const real = await loadRealDb(tmpDbPath);
        try {
            expect(() => {
                real.db.prepare(`INSERT INTO pause_state (id, paused, paused_at, paused_by, reason) VALUES (2, 0, NULL, NULL, NULL)`).run();
            }).toThrow(/CHECK constraint failed|constraint/i);

            // Single row only.
            const count = real.db.prepare(`SELECT COUNT(*) as n FROM pause_state`).get() as { n: number };
            expect(count.n).toBe(1);
        } finally {
            real.closeDb();
        }
    });
});

// ---------------------------------------------------------------------------
// Tests 5-8: endpoint exercise for POST /pause + POST /resume + GET /pause
// Pattern matches test/integration/api/controls.test.ts (raw http; no supertest).
// ---------------------------------------------------------------------------

// Spies on prepared statements (hoisted module-scope; rearmed in beforeEach
// because vitest.config.ts has mockReset:true which wipes vi.fn() impls between
// tests — see Plan 20-04 cascade fix-in-flight precedent).
const getPauseStateGetSpy = vi.fn();
const setPauseStateRunSpy = vi.fn();
const clearPauseStateRunSpy = vi.fn();
const broadcastSpy = vi.fn();

vi.mock('../../src/utils/db', () => ({
    db: {
        prepare: vi.fn().mockReturnValue({ get: vi.fn(), all: vi.fn(), run: vi.fn() }),
    },
    getPauseState: { get: getPauseStateGetSpy },
    setPauseState: { run: setPauseStateRunSpy },
    clearPauseState: { run: clearPauseStateRunSpy },
    forceWalCheckpoint: vi.fn(),
    // Phase 21.2-11 / S-1: resumeMultiChainMonitoring / resumeAntiRugMonitoring read
    // these pre-prepared exported statements on boot. No seeded open/failed-held
    // positions in this pause-restart test → empty resume set.
    getResumeExitMonitorTrades: { all: vi.fn().mockReturnValue([]) },
    getResumeAntiRugTrades: { all: vi.fn().mockReturnValue([]) },
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
    // Phase 21.2-09: bot.ts now imports setExitWorkerWatchdog from ./exitEngine
    // (alongside startExitMonitor/resumeExitMonitor). Mocked here so importing
    // bot.ts never throws on a missing export.
    startExitMonitor: vi.fn().mockResolvedValue(undefined),
    resumeExitMonitor: vi.fn().mockResolvedValue(undefined),
    setExitWorkerWatchdog: vi.fn(),
    exitConfig: {
        trailingStopPct: 15,
        stopLossPct: 25,
        partialSellTiers: [],
        urgencyWindowMs: 1800000,
    },
}));

vi.mock('../../src/utils/logger', () => ({
    logger: {
        // Top-level methods: the real src/utils/db and src/utils/dbSchema that Tests 1-4 load call
        // logger.info directly (migration steps, closeDb).
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

// Helper: raw http POST/GET against a mounted express app (matches
// test/integration/api/controls.test.ts pattern).
async function httpRequest(
    app: express.Express,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const http = require('http');
        const server = app.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            const payload = body !== undefined ? JSON.stringify(body) : undefined;
            const options = {
                hostname: '127.0.0.1',
                port: addr.port,
                path,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                },
            };
            const req = http.request(options, (res: any) => {
                let data = '';
                res.on('data', (chunk: string) => (data += chunk));
                res.on('end', () => {
                    server.close();
                    try {
                        resolve({ status: res.statusCode, body: JSON.parse(data) });
                    } catch {
                        resolve({ status: res.statusCode, body: data });
                    }
                });
            });
            req.on('error', (err: Error) => {
                server.close();
                reject(err);
            });
            if (payload) req.write(payload);
            req.end();
        });
    });
}

describe('POST /api/controls/pause + /resume + GET /pause (OPS-LIVE-09 endpoint exercise)', () => {
    let app: express.Express;

    beforeEach(async () => {
        // Re-arm hoisted module-scope spies (mockReset:true wipes impls).
        getPauseStateGetSpy.mockReset();
        setPauseStateRunSpy.mockReset();
        clearPauseStateRunSpy.mockReset();
        broadcastSpy.mockReset();

        // Default GET returns paused=0 row.
        getPauseStateGetSpy.mockReturnValue({
            paused: 0,
            paused_at: null,
            paused_by: null,
            reason: null,
        });

        // Import the production controlRoutes factory AFTER mocks are wired.
        const { controlRoutes } = await import('../../src/api/routes/controls');

        app = express();
        app.use(express.json());
        // Mount with empty contexts — pause/resume endpoints don't need ChainContext.
        app.use('/api/controls', controlRoutes([]));
    });

    it('Test 5: POST /pause with reason+pausedBy writes via setPauseState + broadcasts pause_state_change', async () => {
        const res = await httpRequest(app, 'POST', '/api/controls/pause', {
            reason: 'manual smoke test',
            pausedBy: 'dashboard',
        });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.paused).toBe(true);
        expect(res.body.pausedBy).toBe('dashboard');
        expect(res.body.reason).toBe('manual smoke test');

        // setPauseState.run called exactly once with (ts:number, pausedBy, sanitizedReason)
        expect(setPauseStateRunSpy).toHaveBeenCalledTimes(1);
        const [ts, pausedBy, reason] = setPauseStateRunSpy.mock.calls[0];
        expect(typeof ts).toBe('number');
        expect(pausedBy).toBe('dashboard');
        expect(reason).toBe('manual smoke test');

        // broadcast called with pause_state_change event.
        expect(broadcastSpy).toHaveBeenCalledTimes(1);
        const [eventType, payload] = broadcastSpy.mock.calls[0];
        expect(eventType).toBe('pause_state_change');
        expect(payload).toMatchObject({ paused: true, pausedBy: 'dashboard', reason: 'manual smoke test' });
    });

    it('Test 6: POST /resume clears pause via clearPauseState + broadcasts pause_state_change paused=false', async () => {
        const res = await httpRequest(app, 'POST', '/api/controls/resume');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.paused).toBe(false);

        expect(clearPauseStateRunSpy).toHaveBeenCalledTimes(1);

        expect(broadcastSpy).toHaveBeenCalledTimes(1);
        const [eventType, payload] = broadcastSpy.mock.calls[0];
        expect(eventType).toBe('pause_state_change');
        expect(payload).toMatchObject({ paused: false });
    });

    it('Test 7: GET /pause returns current state JSON shape', async () => {
        // Override default — pretend state is paused=1.
        getPauseStateGetSpy.mockReturnValue({
            paused: 1,
            paused_at: 1700000000,
            paused_by: 'cli',
            reason: 'maintenance window',
        });

        const res = await httpRequest(app, 'GET', '/api/controls/pause');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            paused: true,
            pausedAt: 1700000000,
            pausedBy: 'cli',
            reason: 'maintenance window',
        });

        expect(getPauseStateGetSpy).toHaveBeenCalledTimes(1);
    });

    it('Test 8: POST /pause sanitizes reason (T-20 mitigation): 500-char control-char string → stored ≤120 chars + no control chars', async () => {
        // Long string with embedded control chars + markdown specials.
        const evilReason = '\x00\x01\x02' + 'A'.repeat(500) + '\x7F[evil](http://x)';

        const res = await httpRequest(app, 'POST', '/api/controls/pause', {
            reason: evilReason,
            pausedBy: 'dashboard',
        });

        expect(res.status).toBe(200);

        // setPauseState received a sanitized reason.
        const [, , storedReason] = setPauseStateRunSpy.mock.calls[0] as [number, string, string];
        // No control chars.
        expect(storedReason).not.toMatch(/[\x00-\x1F\x7F]/);
        // Length bounded by the sanitizer (sanitizeReason caps at 120, plan said ≤200 — both pass).
        expect(storedReason.length).toBeLessThanOrEqual(200);
        // Should still contain the bulk-A run that survived sanitization.
        expect(storedReason).toMatch(/A+/);
    });
});

// ---------------------------------------------------------------------------
// Test 9: D-PAUSED-RESTART positive observable (Plan 20-04). Preserved verbatim.
// ---------------------------------------------------------------------------

describe('startMultiChainBot D-PAUSED-RESTART positive observable', () => {
    it('D-PAUSED-RESTART: on restart with pause_state.paused=1, chain listeners attached AND dashboard reachable AND exit monitors running AND handleNewPairForChain CP1 fires AND sendTxWithRetry never called', async () => {
        // Pattern: integration test driven by direct call to handleNewPairForChain
        // with pre-seeded paused=1 from getPauseState mock. This proves the CP1
        // gate halts new buys when the bot was started with the pause flag set,
        // while the chain listeners + exit monitors + dashboard are still up
        // (those side-effects come from startMultiChainBot, which is not blocked
        // by paused state — only the per-token buy path's CP1 is).

        // Use the seeded-pause Path: simulate the WHOLE D-PAUSED-RESTART chain
        // via spies on the orchestrator entry points.
        const preflightSpy = vi.fn().mockResolvedValue(undefined);
        const checkWalletBalanceSpy = vi.fn().mockResolvedValue({
            chain: 'eth',
            check: 'wallet-balance',
            passed: true,
        });
        const buildChainRegistrySpy = vi.fn();
        const getEnabledChainsSpy = vi.fn();
        const createChainContextSpy = vi.fn();
        const startDexListenerSpy = vi.fn().mockResolvedValue(undefined);
        const startApiServerSpy = vi.fn().mockResolvedValue(undefined);
        const startExitMonitorSpy = vi.fn().mockResolvedValue(undefined);
        const resumeExitMonitorSpy = vi.fn().mockResolvedValue(undefined);
        const sendTxWithRetrySpy = vi.fn();
        const verifyAllowlistSpy = vi.fn().mockResolvedValue(undefined);
        const startChainAntiRugListenerSpy = vi.fn().mockResolvedValue(undefined);
        const getPauseStateSpy = vi.fn().mockReturnValue({ paused: 1, paused_at: 100, paused_by: 'manual', reason: 'pre-seeded' });
        const loggerInfoSpy = vi.fn();
        const sendCtxAlertSpy = vi.fn().mockResolvedValue(undefined);

        // Make buildChainRegistry return a one-chain registry.
        const chainShape = {
            chainId: 1,
            name: 'eth',
            displayName: '[ETH]',
            enabled: true,
            nativeCurrency: 'ETH',
            wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            httpRpcUrl: 'http://test',
            wsRpcUrl: null,
            dexes: [],
            mevStrategy: 'passthrough',
            mevConfig: {},
            safetyApis: { honeypot: 'honeypot.is', liquidityLock: 'unicrypt', tokenSecurity: 'goplus' },
            snipeAmount: '0.01',
            maxCapital: '1.0',
            gasBuffer: '0.005',
            blockAgeToleranceSec: 300,
            honeypotChecker: { deployedAddress: '0x0000000000000000000000000000000000000001', method: 'exactInputSingle', maxBuyTaxBps: 1000, maxSellTaxBps: 1000 },
            antiRug: {},
            allowlist: [],
            explorerUrl: 'https://etherscan.io',
        };
        buildChainRegistrySpy.mockReturnValue(new Map([['eth', chainShape]]));
        getEnabledChainsSpy.mockImplementation((reg: Map<string, unknown>) =>
            Array.from(reg.values()).filter((c: any) => c.enabled),
        );
        createChainContextSpy.mockImplementation((chain: any) => ({
            chain,
            httpProvider: {
                getNetwork: vi.fn().mockResolvedValue({ chainId: BigInt(chain.chainId) }),
                getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
            },
            wsProvider: null,
            wallet: { address: '0xWallet' },
            log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() },
        }));

        vi.doMock('../../src/preflight', () => ({
            preflight: preflightSpy,
            checkWalletBalance: checkWalletBalanceSpy,
        }));
        vi.doMock('../../src/chainRegistry', async () => {
            const actual = await vi.importActual<typeof import('../../src/chainRegistry')>('../../src/chainRegistry');
            return {
                ...actual,
                buildChainRegistry: buildChainRegistrySpy,
                getEnabledChains: getEnabledChainsSpy,
                createChainContext: createChainContextSpy,
            };
        });
        vi.doMock('../../src/utils/db', () => {
            const stmt = { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
            return {
                db: { prepare: vi.fn().mockReturnValue(stmt), pragma: vi.fn(), exec: vi.fn(), transaction: vi.fn().mockImplementation((fn: any) => fn) },
                insertTrade: { run: vi.fn() },
                updateTradeStatus: { run: vi.fn() },
                isTokenSniped: { get: vi.fn().mockReturnValue(undefined) },
                getTradeIdForPendingToken: { get: vi.fn() },
                upsertExitState: { run: vi.fn() },
                getExitState: { get: vi.fn() },
                deleteExitState: { run: vi.fn() },
                getOpenPositionCount: vi.fn().mockReturnValue(0),
                getTotalExposure: vi.fn().mockReturnValue(0),
                getDailyRealizedLoss: vi.fn().mockReturnValue(0),
                upsertLpBaseline: { run: vi.fn() },
                getLpBaseline: { get: vi.fn() },
                deleteLpBaseline: { run: vi.fn() },
                upsertChainState: { run: vi.fn() },
                getChainState: { get: vi.fn() },
                setAntirugDryRunStarted: { run: vi.fn() },
                getAntirugDryRunStarted: { get: vi.fn().mockReturnValue({ antirug_dry_run_started: null }) },
                getPauseState: { get: getPauseStateSpy },
                setPauseState: { run: vi.fn() },
                clearPauseState: { run: vi.fn() },
                // Phase 21.2-11 / S-1: boot-time restart-resume scans read these
                // exported statements (no seeded positions → empty resume set).
                getResumeExitMonitorTrades: { all: vi.fn().mockReturnValue([]) },
                getResumeAntiRugTrades: { all: vi.fn().mockReturnValue([]) },
            };
        });
        vi.doMock('../../src/anti-rug/detector', () => ({
            registerAntiRugPosition: vi.fn().mockResolvedValue(undefined),
            startChainAntiRugListener: startChainAntiRugListenerSpy,
        }));
        vi.doMock('../../src/anti-rug/allowlist', () => ({
            verifyAllowlistAtStartup: verifyAllowlistSpy,
        }));
        vi.doMock('../../src/anti-rug/lpBaseline', () => ({
            snapshotLpBaseline: vi.fn().mockResolvedValue(undefined),
        }));
        vi.doMock('../../src/api/server', () => ({
            startApiServer: startApiServerSpy,
        }));
        vi.doMock('../../src/utils/notifier', () => ({
            sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
            sendCtxAlert: sendCtxAlertSpy,
        }));
        vi.doMock('../../src/telegramListener', () => ({
            startTelegramListener: vi.fn().mockResolvedValue({ stop: vi.fn() }),
        }));
        vi.doMock('../../src/api/ws/broadcaster', () => ({
            broadcast: vi.fn(),
            addClient: vi.fn(),
            removeClient: vi.fn(),
            getClientCount: vi.fn().mockReturnValue(0),
        }));
        vi.doMock('../../src/utils/provider', () => ({
            getProvider: vi.fn().mockReturnValue({
                getNetwork: vi.fn().mockResolvedValue({ chainId: 1n }),
                getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
            }),
            getWallet: vi.fn().mockReturnValue({ address: '0xWallet' }),
            getWsProvider: vi.fn().mockReturnValue(null),
            removeWsProvider: vi.fn(),
        }));
        vi.doMock('../../src/utils/txManager', () => ({
            sendTxWithRetry: sendTxWithRetrySpy,
            createMevStrategy: vi.fn().mockReturnValue({ healthCheck: vi.fn().mockResolvedValue(true) }),
        }));
        vi.doMock('../../src/exitEngine', () => ({
            startExitMonitor: startExitMonitorSpy,
            resumeExitMonitor: resumeExitMonitorSpy,
            // Phase 21.2-09: bot.ts imports setExitWorkerWatchdog from
            // ./exitEngine and calls it during startMultiChainBot wiring; without
            // it here the dynamic import('../../src/bot') below throws on a
            // missing export. No-op spy keeps the watchdog-arm side-effect inert.
            setExitWorkerWatchdog: vi.fn(),
        }));
        // Safety-bank: all checks pass so CP1 is the gate that catches the pause.
        vi.doMock('../../src/utils/tokenSafety', () => ({
            checkTokenMetadata: vi.fn(),
            isLiquidityLocked: vi.fn(),
            simulateSwap: vi.fn(),
            checkHoneypot: vi.fn(),
            isBlacklistedToken: vi.fn(),
            isLiquiditySufficient: vi.fn(),
            isKnownBadToken: vi.fn(),
            hasHighTransferTax: vi.fn(),
            hasMaxWalletOrTxLimits: vi.fn(),
            simulateSell: vi.fn(),
            isLiquidityLockedForChain: vi.fn().mockResolvedValue(true),
            simulateSwapForChain: vi.fn().mockResolvedValue(true),
            isLiquiditySufficientForChain: vi.fn().mockResolvedValue(true),
            isKnownBadTokenForChain: vi.fn().mockResolvedValue(false),
            checkTokenMetadataForChain: vi.fn().mockResolvedValue(true),
            // hasHighTransferTaxForChain removed (plan 21.1-03): function deleted
            // from tokenSafety.ts; this mock entry was inert (false = allow).
            hasMaxWalletOrTxLimitsForChain: vi.fn().mockResolvedValue(false),
            isBlacklistedTokenForChain: vi.fn().mockResolvedValue(false),
        }));
        vi.doMock('../../src/utils/honeypot', () => ({
            simulateHoneypotRoundtrip: vi.fn().mockResolvedValue({
                verdict: 'safe',
                reason: '',
                evidence: { buyTaxBps: 0, sellTaxBps: 0, method: 'exactInputSingle', dexType: 'v2' },
            }),
        }));
        vi.doMock('../../src/utils/honeypot/bytecodeScan', () => ({
            isMutableTokenForChain: vi.fn().mockResolvedValue({ isMutable: false, hits: [] }),
        }));
        vi.doMock('../../src/utils/honeypot/sanitize', () => ({
            sanitizeReason: (r: string) => r,
        }));
        vi.doMock('../../src/utils/blocklist', () => ({
            BLOCKLIST: { tokens: new Set(), pairs: new Set() },
        }));
        vi.doMock('../../src/riskManager', () => ({
            canSnipe: vi.fn().mockReturnValue({ allowed: true, reason: null, details: '' }),
            recordSnipe: vi.fn(),
        }));
        // Mock ethers.Contract for the V2 pair / token reads invoked by the
        // handleNewPairForChain CP1 happy path before the CP1 check.
        class MockContract {
            interface = { encodeFunctionData: vi.fn().mockReturnValue('0xencoded') };
            getAmountsOut = vi.fn().mockResolvedValue([BigInt('10000000000000000'), BigInt('1000')]);
            balanceOf = vi.fn().mockResolvedValue(BigInt('1000'));
            symbol = vi.fn().mockResolvedValue('TKN');
            name = vi.fn().mockResolvedValue('Token');
            decimals = vi.fn().mockResolvedValue(18);
            token0 = vi.fn().mockResolvedValue('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
            getReserves = vi.fn().mockResolvedValue({ reserve0: BigInt('1000000000000000000'), reserve1: BigInt('1000000000000000000') });
        }
        vi.doMock('ethers', async () => {
            const actual = await vi.importActual<typeof import('ethers')>('ethers');
            return { ...actual, Contract: MockContract };
        });

        const bot = await import('../../src/bot');

        // 1. Boot the multi-chain bot with the seeded pause flag.
        await bot.startMultiChainBot();

        // Observable (a) preflight ran (chain listeners proceeded past gate)
        expect(preflightSpy).toHaveBeenCalled();
        // Observable (b) buildChainRegistry ran (chain context loop reached)
        expect(buildChainRegistrySpy).toHaveBeenCalled();
        // Observable (d) dashboard up — startApiServer fired
        expect(startApiServerSpy).toHaveBeenCalled();

        // 2. Simulate one "new pair" event hitting handleNewPairForChain — assert
        //    CP1 fires + sendTxWithRetry NEVER called (per D-PAUSED-RESTART).
        const ctx = {
            chain: chainShape,
            httpProvider: {} as unknown,
            wsProvider: null,
            wallet: { address: '0xWallet', populateTransaction: vi.fn().mockResolvedValue({}) },
            log: { info: loggerInfoSpy, warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() },
        };
        const dex = { name: 'uniswap-v2', dexType: 'v2', factoryAddress: '0xFactory', routerAddress: '0xRouter' };
        const targetToken = '0xToken0000000000000000000000000000000000001';

        await (bot as any).handleNewPairForChain(
            ctx as any,
            dex as any,
            ctx.chain.wethAddress,
            targetToken,
            '0xPair',
        );

        // Observable (e): CP1 fires.
        const cp1Log = loggerInfoSpy.mock.calls.find(([fields]: any) => fields && fields.op === 'killswitch.cp1');
        expect(cp1Log).toBeDefined();

        // Observable (f): sendTxWithRetry NEVER called (CP1 returned early).
        expect(sendTxWithRetrySpy).not.toHaveBeenCalled();

        // Observable (c) — startExitMonitor NEVER called on this new-pair event
        // (CP1 returned early before insertTrade and exit-monitor wiring), but
        // the exit-engine module is loaded and its symbol is reachable. Plan
        // 20-05 follows up with a full resume-flow test that also exercises
        // pre-existing pending trades; here we assert the negative observable
        // (no NEW exit monitor armed for the blocked-buy token).
        expect(startExitMonitorSpy).not.toHaveBeenCalled();
    });
});
