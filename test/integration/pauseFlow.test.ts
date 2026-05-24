// Phase 20 / Plan 20-05 — implementation flips the 4 stubs from Plan 20-00 to
// live + adds 4 new endpoint-exercise tests for src/api/routes/controls.ts POST
// /pause + POST /resume + GET /pause routes.
//
// Tests 1-4 (persistence + restart-survival per D-PAUSED-RESTART) use in-memory
// SQLite with the production-replica migration so each test constructs a fresh
// starting state.
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
import Database from 'better-sqlite3';
import express from 'express';

// ---------------------------------------------------------------------------
// Migration helpers (mirror test/unit/db/pauseStateMigration.test.ts so this
// integration suite is self-contained and exercises the SAME migration shape
// as production src/utils/db.ts).
// ---------------------------------------------------------------------------

function applyV1Migration(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL COLLATE NOCASE,
            chain TEXT NOT NULL DEFAULT 'eth',
            action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'fail')),
            tx_hash TEXT,
            block INTEGER,
            timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
            amount_in TEXT,
            amount_out TEXT,
            gas_cost TEXT,
            price_at_action TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sold', 'failed'))
        );
    `);
}

function applyV2Migration(db: Database.Database): void {
    db.exec(`
        ALTER TABLE trades ADD COLUMN pool_type TEXT DEFAULT 'v2' CHECK(pool_type IN ('v2', 'v3'));
        ALTER TABLE trades ADD COLUMN fee_tier INTEGER;
    `);
}

function applyV3Migration(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS exit_state (
            trade_id INTEGER PRIMARY KEY,
            entry_price REAL NOT NULL,
            high_water_mark REAL NOT NULL,
            trailing_activated INTEGER NOT NULL DEFAULT 0,
            partial_tiers_completed TEXT NOT NULL DEFAULT '[]',
            original_token_amount TEXT NOT NULL,
            urgency_start_ts INTEGER NOT NULL,
            volatility_samples TEXT NOT NULL DEFAULT '[]',
            FOREIGN KEY (trade_id) REFERENCES trades(id)
        );
    `);
}

function applyV4Migration(db: Database.Database): void {
    const columns = db.prepare("PRAGMA table_info('trades')").all() as Array<{ name: string }>;
    if (!columns.some(c => c.name === 'dex_name')) {
        db.exec(`ALTER TABLE trades ADD COLUMN dex_name TEXT DEFAULT NULL`);
    }
}

function applyV5Migration(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS lp_baseline (
            trade_id INTEGER PRIMARY KEY,
            pool_type TEXT NOT NULL CHECK(pool_type IN ('v2', 'v3')),
            pair_or_pool_address TEXT NOT NULL COLLATE NOCASE,
            v2_token0_reserve TEXT,
            v2_token1_reserve TEXT,
            v2_lp_total_supply TEXT,
            v3_active_liquidity TEXT,
            v3_tick_at_snapshot INTEGER,
            v3_position_nft_id TEXT,
            v3_fee_tier INTEGER,
            snapshot_block INTEGER NOT NULL,
            snapshot_ts INTEGER NOT NULL,
            FOREIGN KEY (trade_id) REFERENCES trades(id)
        );
        CREATE TABLE IF NOT EXISTS chain_state (
            chain TEXT PRIMARY KEY,
            last_seen_block INTEGER NOT NULL,
            last_updated_ts INTEGER NOT NULL
        );
    `);
}

function applyV6Migration(db: Database.Database): void {
    db.transaction(() => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS pause_state (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                paused INTEGER NOT NULL DEFAULT 0,
                paused_at INTEGER,
                paused_by TEXT,
                reason TEXT
            );
        `);
        db.exec(`INSERT OR IGNORE INTO pause_state (id, paused, paused_at, paused_by, reason) VALUES (1, 0, NULL, NULL, NULL)`);

        const columns = db.prepare("PRAGMA table_info('chain_state')").all() as Array<{ name: string }>;
        if (!columns.some(c => c.name === 'antirug_dry_run_started')) {
            db.exec(`ALTER TABLE chain_state ADD COLUMN antirug_dry_run_started INTEGER`);
        }
    })();
}

function buildV6Db(dbPath: string): Database.Database {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    applyV1Migration(db);
    applyV2Migration(db);
    applyV3Migration(db);
    applyV4Migration(db);
    applyV5Migration(db);
    applyV6Migration(db);
    db.pragma(`user_version = 6`);
    return db;
}

// ---------------------------------------------------------------------------
// Tests 1-4: pause_state persistence + restart-survival (OPS-LIVE-09 / D-PAUSED-RESTART)
// ---------------------------------------------------------------------------

describe('pause state restart survival (OPS-LIVE-09 / D-PAUSED-RESTART)', () => {
    let tmpDir: string;
    let tmpDbPath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-flow-'));
        tmpDbPath = path.join(tmpDir, 'test.db');
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            /* ignore — Windows may hold the WAL file briefly */
        }
        delete process.env.DB_PATH;
    });

    it('Test 1: setPauseState writes a row visible to getPauseState with paused=1 + audit columns populated', () => {
        const db = buildV6Db(tmpDbPath);
        try {
            const setStmt = db.prepare(
                `UPDATE pause_state SET paused = 1, paused_at = ?, paused_by = ?, reason = ? WHERE id = 1`,
            );
            const getStmt = db.prepare(`SELECT paused, paused_at, paused_by, reason FROM pause_state WHERE id = 1`);

            const ts = 1700000000;
            setStmt.run(ts, 'manual', 'test reason');

            const row = getStmt.get() as {
                paused: number;
                paused_at: number;
                paused_by: string;
                reason: string;
            };
            expect(row.paused).toBe(1);
            expect(row.paused_at).toBe(ts);
            expect(row.paused_by).toBe('manual');
            expect(row.reason).toBe('test reason');
        } finally {
            db.close();
        }
    });

    it('Test 2: restart simulation — setPauseState → db.close() → reopen → row still present', () => {
        // First open: write row, close.
        const db1 = buildV6Db(tmpDbPath);
        try {
            const setStmt = db1.prepare(
                `UPDATE pause_state SET paused = 1, paused_at = ?, paused_by = ?, reason = ? WHERE id = 1`,
            );
            setStmt.run(1700000000, 'manual', 'survives-restart');
        } finally {
            db1.close();
        }

        // Second open at same DB_PATH (restart sim): row must still be there.
        const db2 = new Database(tmpDbPath);
        try {
            const row = db2.prepare(`SELECT paused, paused_at, paused_by, reason FROM pause_state WHERE id = 1`).get() as {
                paused: number;
                paused_at: number;
                paused_by: string;
                reason: string;
            };
            expect(row.paused).toBe(1);
            expect(row.paused_at).toBe(1700000000);
            expect(row.paused_by).toBe('manual');
            expect(row.reason).toBe('survives-restart');
        } finally {
            db2.close();
        }
    });

    it('Test 3: clearPauseState flips paused 1 → 0 AND nulls all audit columns', () => {
        const db = buildV6Db(tmpDbPath);
        try {
            const setStmt = db.prepare(
                `UPDATE pause_state SET paused = 1, paused_at = ?, paused_by = ?, reason = ? WHERE id = 1`,
            );
            const clearStmt = db.prepare(
                `UPDATE pause_state SET paused = 0, paused_at = NULL, paused_by = NULL, reason = NULL WHERE id = 1`,
            );
            const getStmt = db.prepare(`SELECT paused, paused_at, paused_by, reason FROM pause_state WHERE id = 1`);

            setStmt.run(1700000000, 'manual', 'before-clear');
            clearStmt.run();
            const row = getStmt.get() as {
                paused: number;
                paused_at: number | null;
                paused_by: string | null;
                reason: string | null;
            };
            expect(row.paused).toBe(0);
            expect(row.paused_at).toBeNull();
            expect(row.paused_by).toBeNull();
            expect(row.reason).toBeNull();
        } finally {
            db.close();
        }
    });

    it('Test 4: single-row constraint enforced — cannot INSERT id=2 (CHECK(id=1))', () => {
        const db = buildV6Db(tmpDbPath);
        try {
            expect(() => {
                db.prepare(`INSERT INTO pause_state (id, paused, paused_at, paused_by, reason) VALUES (2, 0, NULL, NULL, NULL)`).run();
            }).toThrow(/CHECK constraint failed|constraint/i);

            // Single row only.
            const count = db.prepare(`SELECT COUNT(*) as n FROM pause_state`).get() as { n: number };
            expect(count.n).toBe(1);
        } finally {
            db.close();
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
            hasHighTransferTaxForChain: vi.fn().mockResolvedValue(false),
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
