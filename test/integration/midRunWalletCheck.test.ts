// Phase 20 / Plan 20-04 / OPS-LIVE-02 (mid-run path) — auto-pause-on-undercut wiring.
//
// Asserts that startMultiChainBot() schedules a setInterval at
// MID_RUN_CHECK_INTERVAL_SEC (default 300s = 300_000ms) and that on undercut
// the global pause flag flips with paused_by='preflight', a broadcast fires
// with 'pause_state_change', a Telegram alert is sent, and the path is
// idempotent (T-20-04: re-firing while already paused does NOT alert again).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Module-scope spies — re-armed in beforeEach because mockReset: true in
// vitest.config.ts wipes implementations between tests.
const preflightMock = vi.fn();
const checkWalletBalanceMock = vi.fn();
const broadcastMock = vi.fn();
const sendCtxAlertMock = vi.fn();
const sendTelegramAlertMock = vi.fn();
const setPauseStateRunMock = vi.fn();
const getPauseStateGetMock = vi.fn();
const buildChainRegistryMock = vi.fn();
const getEnabledChainsMock = vi.fn();
const createChainContextMock = vi.fn();
const createMevStrategyMock = vi.fn();
const healthCheckMock = vi.fn();
const startApiServerMock = vi.fn();
const startTelegramListenerMock = vi.fn();
const verifyAllowlistMock = vi.fn();
const startChainAntiRugListenerMock = vi.fn();
const registerAntiRugPositionMock = vi.fn();
const fatalLogMock = vi.fn();

const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__process.exit(${code})__`);
}) as never);

// Module-scope mock instances for the db.prepare stmt API so we can re-arm
// them in beforeEach (vitest.config mockReset:true wipes between tests).
const dbStmtRunMock = vi.fn();
const dbStmtGetMock = vi.fn();
const dbStmtAllMock = vi.fn();
const dbPrepareMock = vi.fn();

// ---- Mocks (must be registered BEFORE the dynamic import) ----

vi.doMock('../../src/preflight', () => ({
    preflight: preflightMock,
    checkWalletBalance: checkWalletBalanceMock,
}));

vi.doMock('../../src/chainRegistry', async () => {
    const actual = await vi.importActual<typeof import('../../src/chainRegistry')>('../../src/chainRegistry');
    return {
        ...actual,
        buildChainRegistry: buildChainRegistryMock,
        getEnabledChains: getEnabledChainsMock,
        createChainContext: createChainContextMock,
    };
});

vi.doMock('../../src/utils/db', () => {
    const stmt = { run: dbStmtRunMock, get: dbStmtGetMock, all: dbStmtAllMock };
    dbPrepareMock.mockReturnValue(stmt);
    return {
        db: {
            prepare: dbPrepareMock,
            pragma: vi.fn(),
            exec: vi.fn(),
            transaction: vi.fn().mockImplementation((fn: any) => fn),
        },
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
        getPauseState: { get: getPauseStateGetMock },
        setPauseState: { run: setPauseStateRunMock },
        clearPauseState: { run: vi.fn() },
    };
});

vi.doMock('../../src/anti-rug/detector', () => ({
    registerAntiRugPosition: registerAntiRugPositionMock,
    startChainAntiRugListener: startChainAntiRugListenerMock,
}));

vi.doMock('../../src/anti-rug/allowlist', () => ({
    verifyAllowlistAtStartup: verifyAllowlistMock,
}));

vi.doMock('../../src/api/server', () => ({
    startApiServer: startApiServerMock,
}));

vi.doMock('../../src/utils/notifier', () => ({
    sendTelegramAlert: sendTelegramAlertMock,
    sendCtxAlert: sendCtxAlertMock,
}));

vi.doMock('../../src/telegramListener', () => ({
    startTelegramListener: startTelegramListenerMock,
}));

vi.doMock('../../src/api/ws/broadcaster', () => ({
    broadcast: broadcastMock,
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
    sendTxWithRetry: vi.fn().mockResolvedValue('0xtxhash'),
    createMevStrategy: createMevStrategyMock,
}));

function defaultChain() {
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

function rearmAllMocks() {
    // Re-arm the db prepare/stmt mocks since mockReset:true wipes them.
    dbStmtRunMock.mockReset();
    dbStmtGetMock.mockReset().mockReturnValue({ paused: 0 });
    dbStmtAllMock.mockReset().mockReturnValue([]);
    dbPrepareMock.mockReset().mockReturnValue({ run: dbStmtRunMock, get: dbStmtGetMock, all: dbStmtAllMock });

    preflightMock.mockReset().mockResolvedValue(undefined);
    checkWalletBalanceMock.mockReset();
    broadcastMock.mockReset();
    sendCtxAlertMock.mockReset().mockResolvedValue(undefined);
    sendTelegramAlertMock.mockReset().mockResolvedValue(undefined);
    setPauseStateRunMock.mockReset();
    getPauseStateGetMock.mockReset().mockReturnValue({ paused: 0 });
    healthCheckMock.mockReset().mockResolvedValue(true);
    createMevStrategyMock.mockReset().mockReturnValue({ healthCheck: healthCheckMock });
    startApiServerMock.mockReset().mockResolvedValue(undefined);
    startTelegramListenerMock.mockReset().mockResolvedValue({ stop: vi.fn() });
    verifyAllowlistMock.mockReset().mockResolvedValue(undefined);
    startChainAntiRugListenerMock.mockReset().mockResolvedValue(undefined);
    registerAntiRugPositionMock.mockReset().mockResolvedValue(undefined);
    fatalLogMock.mockReset();
    exitSpy.mockClear();

    buildChainRegistryMock.mockReset().mockImplementation(() => {
        const registry = new Map<string, ReturnType<typeof defaultChain>>();
        registry.set('eth', defaultChain());
        return registry;
    });
    getEnabledChainsMock.mockReset().mockImplementation((registry: Map<string, unknown>) =>
        Array.from(registry.values()).filter((c: any) => c.enabled),
    );
    createChainContextMock.mockReset().mockImplementation((chain: any) => ({
        chain,
        httpProvider: {
            getNetwork: vi.fn().mockResolvedValue({ chainId: BigInt(chain.chainId) }),
            getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
        },
        wsProvider: null,
        wallet: { address: '0xWallet' },
        log: {
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
            fatal: fatalLogMock,
        },
    }));
}

describe('mid-run wallet undercut', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        rearmAllMocks();
        delete process.env.MID_RUN_CHECK_INTERVAL_SEC;
    });

    afterEach(() => {
        vi.useRealTimers();
        delete process.env.MID_RUN_CHECK_INTERVAL_SEC;
    });

    it('schedules setInterval at MID_RUN_CHECK_INTERVAL_SEC (default 300_000ms) and calls checkWalletBalance per chain context on tick', async () => {
        checkWalletBalanceMock.mockResolvedValue({
            chain: 'eth',
            check: 'wallet-balance',
            passed: true,
        });
        const bot = await import('../../src/bot');
        await bot.startMultiChainBot();

        const callsBefore = checkWalletBalanceMock.mock.calls.length;
        await vi.advanceTimersByTimeAsync(300_000);
        expect(checkWalletBalanceMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('on undercut: flips pause flag with paused_by=preflight, broadcasts pause_state_change, sends sendCtxAlert containing *BOT PAUSED*, emits pino fatal', async () => {
        checkWalletBalanceMock.mockResolvedValue({
            chain: 'eth',
            check: 'wallet-balance',
            passed: false,
            reason: 'wallet balance below floor: 0.001 < 0.105 ETH',
            details: { balance: '0.001', floor: '0.105' },
        });
        // getPauseState defaults to { paused: 0 } from rearmAllMocks
        const bot = await import('../../src/bot');
        await bot.startMultiChainBot();

        await vi.advanceTimersByTimeAsync(300_000);
        // Drain the promise queue inside the setInterval callback
        await vi.advanceTimersByTimeAsync(0);

        expect(setPauseStateRunMock).toHaveBeenCalled();
        const callArgs = setPauseStateRunMock.mock.calls[0];
        // Args: (paused_at_unix_ts, paused_by, reason)
        expect(callArgs[1]).toBe('preflight');
        expect(String(callArgs[2])).toContain('wallet balance below floor');

        expect(broadcastMock).toHaveBeenCalledWith(
            'pause_state_change',
            expect.objectContaining({ paused: true, pausedBy: 'preflight' }),
        );

        expect(sendCtxAlertMock).toHaveBeenCalled();
        const pauseAlert = sendCtxAlertMock.mock.calls.find((c) => String(c[1]).includes('*BOT PAUSED*'));
        expect(pauseAlert).toBeDefined();

        expect(fatalLogMock).toHaveBeenCalled();
    });

    it('T-20-04 idempotence: when already paused, second tick does NOT call setPauseState, broadcast, or sendCtxAlert again', async () => {
        checkWalletBalanceMock.mockResolvedValue({
            chain: 'eth',
            check: 'wallet-balance',
            passed: false,
            reason: 'wallet balance below floor: 0.001 < 0.105 ETH',
            details: { balance: '0.001', floor: '0.105' },
        });
        // Simulate already-paused state from before startup.
        getPauseStateGetMock.mockReturnValue({ paused: 1, paused_at: 123, paused_by: 'preflight', reason: 'prior' });

        const bot = await import('../../src/bot');
        await bot.startMultiChainBot();

        await vi.advanceTimersByTimeAsync(300_000);
        await vi.advanceTimersByTimeAsync(0);

        expect(setPauseStateRunMock).not.toHaveBeenCalled();
        expect(broadcastMock).not.toHaveBeenCalledWith('pause_state_change', expect.anything());
        const pauseAlerts = sendCtxAlertMock.mock.calls.filter((c) => String(c[1]).includes('*BOT PAUSED*'));
        expect(pauseAlerts.length).toBe(0);
    });

    it('env override MID_RUN_CHECK_INTERVAL_SEC=60 → setInterval scheduled at 60_000ms', async () => {
        process.env.MID_RUN_CHECK_INTERVAL_SEC = '60';
        checkWalletBalanceMock.mockResolvedValue({
            chain: 'eth',
            check: 'wallet-balance',
            passed: true,
        });
        const bot = await import('../../src/bot');
        await bot.startMultiChainBot();

        // Before 60_000ms: no mid-run call (allow short ticks for the initial
        // promise-chain settling done by startMultiChainBot to drain).
        await vi.advanceTimersByTimeAsync(59_000);
        const callsAt59s = checkWalletBalanceMock.mock.calls.length;

        // After 60_000ms: mid-run call fires
        await vi.advanceTimersByTimeAsync(2_000);
        const callsAt61s = checkWalletBalanceMock.mock.calls.length;
        expect(callsAt61s).toBeGreaterThan(callsAt59s);
    });
});
