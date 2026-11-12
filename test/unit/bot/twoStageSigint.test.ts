// test/unit/bot/twoStageSigint.test.ts
// Phase 21.2 Plan 21.2-09 / Task 1 — Finding B layer 2 (STOP-THE-LINE-04-B,
// D-SIGINT-TWO-STAGE + T-21.2-WEDGE / T-21.2-DOUBLE-TIMER).
//
// The OLD single-stage `gracefulShutdown` (bot.ts) armed a single 5s `.unref()`
// force-exit timer and then ran cleanup + `process.exit(0)` inline. On a PARKED
// event loop (the Finding B symptom: a synchronous `bundle.wait()` await chain),
// that handler is QUEUED but never runs, and its 5s timer competes with the same
// parked loop — so "Ctrl+C does nothing" until `taskkill`. RESEARCH Candidate
// Escalation #3 mandates REPLACING it with a two-stage handler, NOT augmenting
// it (two competing force-exit timers is the very symptom).
//
// These are OBSERVABLE-EFFECT tests (no hollow assertions) over the exported
// pure state machine `createTwoStageShutdown` (the cleanup body is injected so
// the test never boots the bot or touches real providers/DB):
//
//   Test 1 (first signal graceful): first SIGINT → graceful path begins
//     (shuttingDown set, the injected cleanup runs once), and a force-exit timer
//     is ARMED over SIGINT_GRACE_MS. process.exit is NOT forced on the first
//     signal — the armed grace timer / a second signal owns the force-exit.
//   Test 2 (second signal forces exit): a SECOND SIGINT while shuttingDown →
//     process.exit(130) immediately (cleanup is NOT re-run).
//   Test 3 (grace timeout forces exit): advancing fake timers past
//     SIGINT_GRACE_MS with no clean completion → process.exit(1) by the armed
//     `.unref()`'d grace timer.
//   Test 4 (single force-exit path): exactly ONE force-exit timer is armed per
//     shutdown (the old 5s timer is gone — no two competing timers), and the
//     real startMultiChainBot registers exactly one SIGINT and one SIGTERM
//     listener that run these two stages with SIGINT_GRACE_MS.
//
// Plan 23-19 (CHAR-06, SPEC Requirement 8): the last Test 4 test used to read
// src/bot.ts as text. It now boots the real startMultiChainBot under the
// test/integration/midRunWalletCheck.test.ts mock set (every network, database,
// API and Telegram seam mocked; process.exit spied), finds the listeners it
// added, and drives them. Its two `not.toContain` lines (no `function
// gracefulShutdown`, no "Force exit after 5s timeout" text) are removed: the
// absence of old text has no behavior to observe (AC-38, named in
// 23-19-SUMMARY.md). What that old code did wrong, a second competing force-exit
// timer, is what the timer counts here pin.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { createTwoStageShutdown } from '../../../src/bot';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.useFakeTimers();
    log.info.mockClear();
    log.warn.mockClear();
    log.error.mockClear();
    // Mock process.exit so the handler never actually kills the test runner.
    exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation(((_code?: number) => undefined) as unknown as typeof process.exit);
});

afterEach(() => {
    vi.useRealTimers();
    exitSpy.mockRestore();
});

describe('Two-stage SIGINT — first signal is graceful (Test 1)', () => {
    it('begins graceful shutdown, runs cleanup once, and arms a grace timer (no immediate force-exit)', () => {
        const cleanup = vi.fn();
        const sd = createTwoStageShutdown({ log: log as never, graceMs: 8000, cleanup });

        sd.stage('SIGINT');

        // Graceful path began: cleanup invoked exactly once.
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(sd.isShuttingDown()).toBe(true);

        // A force-exit grace timer is armed (exactly one pending timer).
        expect(vi.getTimerCount()).toBe(1);

        // The FIRST signal does not force an exit code 130 / 1 — the grace timer
        // (or a second signal) owns the force-exit. (A clean cleanup would call
        // process.exit(0) itself; the injected no-op cleanup does not, so no exit
        // has fired yet.)
        expect(exitSpy).not.toHaveBeenCalled();
    });
});

describe('Two-stage SIGINT — second signal forces immediate exit (Test 2)', () => {
    it('a second signal while shutting down calls process.exit(130) and does not re-run cleanup', () => {
        const cleanup = vi.fn();
        const sd = createTwoStageShutdown({ log: log as never, graceMs: 8000, cleanup });

        sd.stage('SIGINT');
        expect(cleanup).toHaveBeenCalledTimes(1);
        exitSpy.mockClear();

        // Second signal: hard stop, no waiting.
        sd.stage('SIGINT');
        expect(exitSpy).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(130);
        // Cleanup must NOT run a second time.
        expect(cleanup).toHaveBeenCalledTimes(1);
    });
});

describe('Two-stage SIGINT — grace timeout forces exit (Test 3)', () => {
    it('advancing past SIGINT_GRACE_MS with no clean completion fires the armed force-exit timer', () => {
        const graceMs = 8000;
        // A cleanup that never completes (mirrors a parked loop): the armed
        // `.unref()`'d grace timer is the only thing that can force the exit.
        const cleanup = vi.fn();
        const sd = createTwoStageShutdown({ log: log as never, graceMs, cleanup });

        sd.stage('SIGTERM');
        expect(exitSpy).not.toHaveBeenCalled();

        // Just before the deadline: still not forced.
        vi.advanceTimersByTime(graceMs - 1);
        expect(exitSpy).not.toHaveBeenCalled();

        // At the deadline: the armed grace timer forces process.exit(1).
        vi.advanceTimersByTime(1);
        expect(exitSpy).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});

describe('Two-stage SIGINT — single force-exit path (Test 4)', () => {
    it('arms exactly ONE force-exit timer per shutdown (no two competing timers)', () => {
        const cleanup = vi.fn();
        const sd = createTwoStageShutdown({ log: log as never, graceMs: 8000, cleanup });

        sd.stage('SIGINT');
        // Exactly one pending timer (the single grace force-exit).
        expect(vi.getTimerCount()).toBe(1);

        // A second signal must NOT arm another timer — it force-exits immediately.
        sd.stage('SIGINT');
        expect(vi.getTimerCount()).toBe(1);
    });

    // The boot import happens once, here, against hookTimeout (10 s): after
    // vi.resetModules() the first import of src/bot pays the cold module-graph
    // compile (deferred-items.md, cold imports).
    beforeAll(async () => {
        vi.resetModules();
        installBootMocks();
        bootedBot = await import('../../../src/bot');
    });

    afterAll(() => {
        uninstallBootMocks();
        vi.resetModules();
    });

    it('startMultiChainBot registers exactly one SIGINT and one SIGTERM listener that run the two stages with SIGINT_GRACE_MS', async () => {
        const graceBefore = process.env.SIGINT_GRACE_MS;
        const midRunBefore = process.env.MID_RUN_CHECK_INTERVAL_SEC;
        const sigintBefore = process.listeners('SIGINT');
        const sigtermBefore = process.listeners('SIGTERM');
        let addedSigint: NodeJS.SignalsListener[] = [];
        let addedSigterm: NodeJS.SignalsListener[] = [];
        try {
            // The knob is read when the handler is installed, so it is set before the boot.
            process.env.SIGINT_GRACE_MS = '1234';
            delete process.env.MID_RUN_CHECK_INTERVAL_SEC; // its default (300 s) is valid
            await bootedBot.startMultiChainBot();

            addedSigint = process.listeners('SIGINT').filter((l) => !sigintBefore.includes(l));
            addedSigterm = process.listeners('SIGTERM').filter((l) => !sigtermBefore.includes(l));
            expect(addedSigint.length, 'new SIGINT listeners').toBe(1);
            expect(addedSigterm.length, 'new SIGTERM listeners').toBe(1);
            // The boot itself never exits (a failed boot step would call process.exit).
            expect(exitSpy).not.toHaveBeenCalled();

            // First SIGINT: the graceful cleanup runs (it closes the API server the
            // boot started first) and exactly one grace force-exit timer is armed.
            // The first signal forces no exit. In a Vitest worker the cleanup then
            // stops at its `require('./utils/db')`, which Node's own require cannot
            // resolve to a .ts file (ts-node does in production), and the error is
            // caught and logged by the handler: the parked or failed cleanup the
            // grace timer exists for. A cleanup that did complete would exit 0,
            // which the filter below allows.
            const timersBefore = vi.getTimerCount();
            addedSigint[0]('SIGINT');
            expect(apiServerCloseSpy).toHaveBeenCalledTimes(1);
            expect(exitSpy.mock.calls.filter(([code]) => code !== 0), 'forced exits on the first signal').toEqual([]);
            expect(vi.getTimerCount(), 'timers after the first signal').toBe(timersBefore + 1);

            // The armed timer fires at SIGINT_GRACE_MS (1234 ms), not before.
            exitSpy.mockClear();
            vi.advanceTimersByTime(1233);
            expect(exitSpy.mock.calls, 'exit calls at 1233 ms').toEqual([]);
            vi.advanceTimersByTime(1);
            expect(exitSpy.mock.calls, 'exit calls at 1234 ms').toEqual([[1]]);
            expect(vi.getTimerCount()).toBe(timersBefore);

            // A second SIGINT forces exit 130 at once and arms no second timer;
            // SIGTERM goes through the same two-stage handler.
            exitSpy.mockClear();
            addedSigint[0]('SIGINT');
            expect(exitSpy, 'exit on the second SIGINT').toHaveBeenCalledTimes(1);
            expect(exitSpy).toHaveBeenCalledWith(130);
            expect(vi.getTimerCount()).toBe(timersBefore);
            exitSpy.mockClear();
            addedSigterm[0]('SIGTERM');
            expect(exitSpy.mock.calls, 'exit calls on SIGTERM after SIGINT').toEqual([[130]]);
            expect(apiServerCloseSpy).toHaveBeenCalledTimes(1);
        } finally {
            // No signal handler outlives this test: remove exactly what the boot added
            // (found again here in case an assertion above failed first).
            const sigintNow = process.listeners('SIGINT').filter((l) => !sigintBefore.includes(l));
            const sigtermNow = process.listeners('SIGTERM').filter((l) => !sigtermBefore.includes(l));
            for (const l of new Set([...addedSigint, ...sigintNow])) process.removeListener('SIGINT', l);
            for (const l of new Set([...addedSigterm, ...sigtermNow])) process.removeListener('SIGTERM', l);
            // The boot's two intervals (MEV health, mid-run wallet check) are fake timers.
            vi.clearAllTimers();
            if (graceBefore === undefined) delete process.env.SIGINT_GRACE_MS;
            else process.env.SIGINT_GRACE_MS = graceBefore;
            if (midRunBefore === undefined) delete process.env.MID_RUN_CHECK_INTERVAL_SEC;
            else process.env.MID_RUN_CHECK_INTERVAL_SEC = midRunBefore;
        }
        expect(process.listeners('SIGINT')).toEqual(sigintBefore);
        expect(process.listeners('SIGTERM')).toEqual(sigtermBefore);
    });
});

// ---------------------------------------------------------------------------
// Boot mock set for the startMultiChainBot test, copied from
// test/integration/midRunWalletCheck.test.ts (lines 49-141): preflight, chain
// registry, database, anti-rug detector and allowlist, API server, notifier,
// Telegram listener, broadcaster, providers and the tx manager. Factories use
// plain functions (mockReset: true would wipe a vi.fn implementation between
// the beforeAll import and the test); the one spy is the API server's close.
// The logger is also replaced by a recorder, so the shutdown's own log lines
// (including the caught cleanup error described in the test) are kept in
// bootLogs instead of printed.
// ---------------------------------------------------------------------------

const apiServerCloseSpy = vi.fn();
const bootLogs: Array<{ level: string; msg: unknown }> = [];
let bootedBot: typeof import('../../../src/bot');

function bootChain() {
    return {
        chainId: 1,
        name: 'eth',
        displayName: '[ETH]',
        enabled: true,
        nativeCurrency: 'ETH',
        wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        httpRpcUrl: 'http://test',
        wsRpcUrl: null,
        dexes: [] as unknown[],
        mevStrategy: 'passthrough' as const,
        mevConfig: {},
        safetyApis: { honeypot: 'honeypot.is' as const, liquidityLock: 'unicrypt' as const, tokenSecurity: 'goplus' as const },
        snipeAmount: '0.01',
        maxCapital: '1.0',
        gasBuffer: '0.005',
        blockAgeToleranceSec: 300,
        honeypotChecker: {
            deployedAddress: '0x0000000000000000000000000000000000000001',
            method: 'exactInputSingle' as const,
            maxBuyTaxBps: 1000,
            maxSellTaxBps: 1000,
        },
        antiRug: {},
        allowlist: [],
    };
}

// Literal targets, one call each (the vi.mock path gate, scripts/check-vi-mock-paths.ts,
// accepts only a string literal).
function uninstallBootMocks(): void {
    vi.doUnmock('../../../src/preflight');
    vi.doUnmock('../../../src/chainRegistry');
    vi.doUnmock('../../../src/utils/db');
    vi.doUnmock('../../../src/anti-rug/detector');
    vi.doUnmock('../../../src/anti-rug/allowlist');
    vi.doUnmock('../../../src/api/server');
    vi.doUnmock('../../../src/utils/notifier');
    vi.doUnmock('../../../src/telegramListener');
    vi.doUnmock('../../../src/api/ws/broadcaster');
    vi.doUnmock('../../../src/utils/provider');
    vi.doUnmock('../../../src/utils/logger');
    vi.doUnmock('../../../src/utils/txManager');
}

function installBootMocks(): void {
    const noop = (): void => undefined;
    const resolved = async (): Promise<undefined> => undefined;
    const quietLog = { info: noop, warn: noop, debug: noop, error: noop, fatal: noop };
    const stmt = { run: noop, get: () => ({ paused: 0 }), all: () => [] };

    vi.doMock('../../../src/preflight', () => ({
        preflight: resolved,
        checkWalletBalance: async () => ({ chain: 'eth', check: 'wallet-balance', passed: true }),
    }));
    vi.doMock('../../../src/chainRegistry', async () => {
        const actual = await vi.importActual<typeof import('../../../src/chainRegistry')>('../../../src/chainRegistry');
        return {
            ...actual,
            buildChainRegistry: () => new Map([['eth', bootChain()]]),
            getEnabledChains: (registry: Map<string, { enabled: boolean }>) =>
                Array.from(registry.values()).filter((c) => c.enabled),
            createChainContext: (chain: ReturnType<typeof bootChain>) => ({
                chain,
                httpProvider: {
                    getNetwork: async () => ({ chainId: BigInt(chain.chainId) }),
                    getBalance: async () => BigInt('1000000000000000000'),
                },
                wsProvider: null,
                wallet: { address: '0xWallet' },
                log: quietLog,
            }),
        };
    });
    vi.doMock('../../../src/utils/db', () => ({
        db: { prepare: () => stmt, pragma: noop, exec: noop, transaction: (fn: unknown) => fn },
        insertTrade: { run: noop },
        updateTradeStatus: { run: noop },
        isTokenSniped: { get: () => undefined },
        getTradeIdForPendingToken: { get: () => undefined },
        upsertExitState: { run: noop },
        getExitState: { get: () => undefined },
        deleteExitState: { run: noop },
        getOpenPositionCount: () => 0,
        getTotalExposure: () => 0,
        getDailyRealizedLoss: () => 0,
        upsertLpBaseline: { run: noop },
        getLpBaseline: { get: () => undefined },
        deleteLpBaseline: { run: noop },
        upsertChainState: { run: noop },
        getChainState: { get: () => undefined },
        setAntirugDryRunStarted: { run: noop },
        getAntirugDryRunStarted: { get: () => ({ antirug_dry_run_started: null }) },
        getPauseState: { get: () => ({ paused: 0 }) },
        setPauseState: { run: noop },
        clearPauseState: { run: noop },
        forceWalCheckpoint: noop,
        getResumeExitMonitorTrades: { all: () => [] },
        getResumeAntiRugTrades: { all: () => [] },
        closeDb: noop,
    }));
    vi.doMock('../../../src/anti-rug/detector', () => ({
        registerAntiRugPosition: resolved,
        startChainAntiRugListener: resolved,
    }));
    vi.doMock('../../../src/anti-rug/allowlist', () => ({ verifyAllowlistAtStartup: resolved }));
    vi.doMock('../../../src/api/server', () => ({ startApiServer: () => ({ close: apiServerCloseSpy }) }));
    vi.doMock('../../../src/utils/notifier', () => ({ sendTelegramAlert: resolved, sendCtxAlert: resolved }));
    vi.doMock('../../../src/telegramListener', () => ({
        startTelegramListener: async () => ({ client: null, connected: false }),
    }));
    vi.doMock('../../../src/api/ws/broadcaster', () => ({
        broadcast: noop,
        addClient: noop,
        removeClient: noop,
        getClientCount: () => 0,
    }));
    vi.doMock('../../../src/utils/provider', () => ({
        getProvider: () => ({
            getNetwork: async () => ({ chainId: 1n }),
            getBalance: async () => BigInt('1000000000000000000'),
        }),
        getWallet: () => ({ address: '0xWallet' }),
        getWsProvider: () => null,
        removeWsProvider: noop,
    }));
    const record = (level: string) => (obj: unknown, msg?: unknown): void => {
        bootLogs.push({ level, msg: msg ?? obj });
    };
    const recorder: Record<string, unknown> = {
        trace: record('trace'),
        debug: record('debug'),
        info: record('info'),
        warn: record('warn'),
        error: record('error'),
        fatal: record('fatal'),
    };
    recorder.child = () => recorder;
    vi.doMock('../../../src/utils/logger', () => ({ logger: recorder }));
    vi.doMock('../../../src/utils/txManager', () => ({
        sendTxWithRetry: async () => '0xtxhash',
        createMevStrategy: () => ({ healthCheck: async () => true }),
    }));
}
