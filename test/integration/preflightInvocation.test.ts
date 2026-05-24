// Phase 20 / Plan 20-04 / OPS-LIVE-01 — preflight() invocation wiring assertions.
//
// Asserts that startMultiChainBot() invokes preflight(registry) exactly once
// BETWEEN buildChainRegistry() and the chain-context loop. On FATAL the
// process exits without creating any chain context; on PASS the loop runs.
//
// Pattern follows test/integration/v3LiquidityWait.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Module-scope spies — re-armed in beforeEach because vitest.config.ts has
// mockReset: true (which wipes implementations between tests).
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

const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__process.exit(${code})__`);
}) as never);

// Call-order witness so we can prove preflight runs BETWEEN buildChainRegistry
// and the first createChainContext call. Each spy pushes its label on every
// invocation; the assertion compares indices.
const callOrder: string[] = [];

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
    const stmt = { run: vi.fn(), get: vi.fn().mockReturnValue({ paused: 0 }), all: vi.fn().mockReturnValue([]) };
    return {
        db: {
            prepare: vi.fn().mockReturnValue(stmt),
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

// Default chain shape used by both buildChainRegistry mock impl + the
// PreflightChain shape consumed by checkWalletBalance.
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
    callOrder.length = 0;

    preflightMock.mockReset().mockImplementation(async () => {
        callOrder.push('preflight');
    });
    checkWalletBalanceMock.mockReset().mockResolvedValue({
        chain: 'eth',
        check: 'wallet-balance',
        passed: true,
    });
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
    exitSpy.mockClear();

    buildChainRegistryMock.mockReset().mockImplementation(() => {
        callOrder.push('buildChainRegistry');
        const registry = new Map<string, ReturnType<typeof defaultChain>>();
        registry.set('eth', defaultChain());
        return registry;
    });
    getEnabledChainsMock.mockReset().mockImplementation((registry: Map<string, unknown>) =>
        Array.from(registry.values()).filter((c: any) => c.enabled),
    );
    createChainContextMock.mockReset().mockImplementation((chain: any) => {
        callOrder.push('createChainContext');
        return {
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
                fatal: vi.fn(),
            },
        };
    });
}

describe('preflight() invocation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        rearmAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('invokes preflight exactly once BETWEEN buildChainRegistry and the first createChainContext call', async () => {
        const bot = await import('../../src/bot');
        await bot.startMultiChainBot();

        expect(preflightMock).toHaveBeenCalledTimes(1);
        const buildIdx = callOrder.indexOf('buildChainRegistry');
        const preflightIdx = callOrder.indexOf('preflight');
        const createIdx = callOrder.indexOf('createChainContext');
        expect(buildIdx).toBeGreaterThanOrEqual(0);
        expect(preflightIdx).toBeGreaterThan(buildIdx);
        expect(createIdx).toBeGreaterThan(preflightIdx);
    });

    it('does NOT call createChainContext when preflight() invokes process.exit(1)', async () => {
        preflightMock.mockImplementationOnce(async () => {
            callOrder.push('preflight');
            process.exit(1);
        });
        const bot = await import('../../src/bot');

        await expect(bot.startMultiChainBot()).rejects.toThrow('__process.exit(1)__');

        expect(preflightMock).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(createChainContextMock).not.toHaveBeenCalled();
    });

    it('proceeds to chain-context creation when preflight() resolves cleanly', async () => {
        const bot = await import('../../src/bot');
        await bot.startMultiChainBot();

        expect(preflightMock).toHaveBeenCalledTimes(1);
        expect(exitSpy).not.toHaveBeenCalled();
        expect(createChainContextMock).toHaveBeenCalledTimes(1);
    });
});
