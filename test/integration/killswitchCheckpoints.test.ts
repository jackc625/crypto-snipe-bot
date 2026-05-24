// Phase 20 / Plan 20-04 / OPS-LIVE-08 — Kill-switch checkpoint observable tests.
//
// V2 + V3 each get 3 checkpoints inside handleNewPairForChain /
// handleNewV3PoolForChain (D-KILLSWITCH-CP1/CP2/CP3):
//
//   CP1 (post-safety-bank, pre-bundle-build): pause=1 → return early; no
//       bundle construction; no MEV submit; pino info { op: 'killswitch.cp1' }
//   CP2 (post-bundle-build, pre-submit): pause=1 → discard built bundle; do
//       NOT submit; pino info { op: 'killswitch.cp2' }; bundle helpers
//       (getAmountsOut for V2 / quoter.staticCall for V3) WERE called.
//   CP3 (post-MEV-submit): pause=1 → audit-log only — recordSnipe + insertTrade
//       + startExitMonitor STILL run (CP3 is an audit log per D-PAUSE-SHAPE,
//       pause never panic-sells); pino info { op: 'killswitch.cp3' }.
//
// V3 path adds `feeTier` to all three log payloads.
//
// Pattern: vi.doMock the safety bank (so checks pass), the txManager
// (sendTxWithRetry spy), the db (insertTrade + startExitMonitor spies), and
// drive handleNewPairForChain / handleNewV3PoolForChain directly via
// dynamic-import of bot.ts. Pause-state read is mocked via getPauseState
// returning { paused: 0 | 1 } per scenario.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Module-scope mock instances ----
const sendTxWithRetryMock = vi.fn();
const insertTradeRunMock = vi.fn();
const recordSnipeMock = vi.fn();
const startExitMonitorMock = vi.fn();
const resumeExitMonitorMock = vi.fn();
const snapshotLpBaselineMock = vi.fn();
const registerAntiRugPositionMock = vi.fn();
const verifyAllowlistMock = vi.fn();
const startChainAntiRugListenerMock = vi.fn();
const sendCtxAlertMock = vi.fn();
const broadcastMock = vi.fn();
const getPauseStateGetMock = vi.fn();
const setPauseStateRunMock = vi.fn();
const getTradeIdForPendingTokenGetMock = vi.fn();
const isTokenSnipedGetMock = vi.fn();
const updateTradeStatusRunMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();
const loggerDebugMock = vi.fn();
const loggerFatalMock = vi.fn();

// Safety-bank spies (all return safe values so the buy path proceeds).
const isBlacklistedTokenForChainMock = vi.fn();
const isLiquidityLockedForChainMock = vi.fn();
const isLiquiditySufficientForChainMock = vi.fn();
const checkTokenMetadataForChainMock = vi.fn();
const simulateSwapForChainMock = vi.fn();
const hasHighTransferTaxForChainMock = vi.fn();
const hasMaxWalletOrTxLimitsForChainMock = vi.fn();
const isKnownBadTokenForChainMock = vi.fn();
const isMutableTokenForChainMock = vi.fn();
const simulateHoneypotRoundtripMock = vi.fn();
const canSnipeMock = vi.fn();

// Mock the dexRouter Contract (V2 getAmountsOut path) + tokenContract for
// balance / metadata reads.
const getAmountsOutMock = vi.fn();
const balanceOfMock = vi.fn();
const tokenSymbolMock = vi.fn();
const tokenNameMock = vi.fn();
const tokenDecimalsMock = vi.fn();
const pairToken0Mock = vi.fn();
const pairGetReservesMock = vi.fn();
const v3QuoterStaticCallMock = vi.fn();

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
    isLiquidityLockedForChain: isLiquidityLockedForChainMock,
    simulateSwapForChain: simulateSwapForChainMock,
    isLiquiditySufficientForChain: isLiquiditySufficientForChainMock,
    isKnownBadTokenForChain: isKnownBadTokenForChainMock,
    checkTokenMetadataForChain: checkTokenMetadataForChainMock,
    hasHighTransferTaxForChain: hasHighTransferTaxForChainMock,
    hasMaxWalletOrTxLimitsForChain: hasMaxWalletOrTxLimitsForChainMock,
    isBlacklistedTokenForChain: isBlacklistedTokenForChainMock,
}));

vi.doMock('../../src/utils/honeypot', () => ({
    simulateHoneypotRoundtrip: simulateHoneypotRoundtripMock,
}));

vi.doMock('../../src/utils/honeypot/bytecodeScan', () => ({
    isMutableTokenForChain: isMutableTokenForChainMock,
}));

vi.doMock('../../src/utils/honeypot/sanitize', () => ({
    sanitizeReason: (r: string) => r,
}));

vi.doMock('../../src/utils/blocklist', () => ({
    BLOCKLIST: { tokens: new Set(), pairs: new Set() },
}));

vi.doMock('../../src/utils/notifier', () => ({
    sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
    sendCtxAlert: sendCtxAlertMock,
}));

vi.doMock('../../src/utils/db', () => {
    const stmt = { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
    return {
        db: {
            prepare: vi.fn().mockReturnValue(stmt),
            pragma: vi.fn(),
            exec: vi.fn(),
            transaction: vi.fn().mockImplementation((fn: any) => fn),
        },
        insertTrade: { run: insertTradeRunMock },
        updateTradeStatus: { run: updateTradeStatusRunMock },
        isTokenSniped: { get: isTokenSnipedGetMock },
        getTradeIdForPendingToken: { get: getTradeIdForPendingTokenGetMock },
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
    sendTxWithRetry: sendTxWithRetryMock,
    createMevStrategy: vi.fn().mockReturnValue({ healthCheck: vi.fn().mockResolvedValue(true) }),
}));

vi.doMock('../../src/utils/exitManager', () => ({
    clearAllTimers: vi.fn(),
}));

vi.doMock('../../src/exitEngine', () => ({
    startExitMonitor: startExitMonitorMock,
    resumeExitMonitor: resumeExitMonitorMock,
}));

vi.doMock('../../src/anti-rug/lpBaseline', () => ({
    snapshotLpBaseline: snapshotLpBaselineMock,
}));

vi.doMock('../../src/anti-rug/detector', () => ({
    registerAntiRugPosition: registerAntiRugPositionMock,
    startChainAntiRugListener: startChainAntiRugListenerMock,
}));

vi.doMock('../../src/anti-rug/allowlist', () => ({
    verifyAllowlistAtStartup: verifyAllowlistMock,
}));

vi.doMock('../../src/api/ws/broadcaster', () => ({
    broadcast: broadcastMock,
    addClient: vi.fn(),
    removeClient: vi.fn(),
    getClientCount: vi.fn().mockReturnValue(0),
}));

vi.doMock('../../src/riskManager', () => ({
    canSnipe: canSnipeMock,
    recordSnipe: recordSnipeMock,
}));

// Mock ethers.Contract so the dexRouter / token / pair / quoter calls inside
// the handler resolve to controlled values. Pattern follows v3LiquidityWait.test.
class MockContract {
    interface = {
        encodeFunctionData: vi.fn().mockReturnValue('0xencoded'),
    };
    // V2 dexRouter methods
    getAmountsOut = getAmountsOutMock;
    // ERC20 token methods
    balanceOf = balanceOfMock;
    symbol = tokenSymbolMock;
    name = tokenNameMock;
    decimals = tokenDecimalsMock;
    // V2 pair methods
    token0 = pairToken0Mock;
    getReserves = pairGetReservesMock;
    // V3 quoter methods
    quoteExactInputSingle = { staticCall: v3QuoterStaticCallMock };
}

vi.doMock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    return {
        ...actual,
        Contract: MockContract,
    };
});

// Default chain/dex objects used to call handleNewPairForChain.
function makeCtx() {
    return {
        chain: {
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
        },
        httpProvider: {} as unknown,
        wsProvider: null,
        wallet: {
            address: '0xWallet',
            populateTransaction: vi.fn().mockResolvedValue({}),
        },
        log: {
            info: loggerInfoMock,
            warn: loggerWarnMock,
            debug: loggerDebugMock,
            error: loggerErrorMock,
            fatal: loggerFatalMock,
        },
    };
}

function makeV2Dex() {
    return {
        name: 'uniswap-v2',
        dexType: 'v2',
        factoryAddress: '0xFactory',
        routerAddress: '0xRouter',
    };
}

function makeV3Dex() {
    return {
        name: 'uniswap-v3',
        dexType: 'v3',
        factoryAddress: '0xFactory',
        swapRouterAddress: '0xSwapRouter',
        quoterAddress: '0xQuoter',
    };
}

function rearmHappyPath() {
    // Pause-state default: not paused (V2/V3 happy path).
    getPauseStateGetMock.mockReset().mockReturnValue({ paused: 0 });

    // Safety bank: all checks pass.
    simulateHoneypotRoundtripMock.mockReset().mockResolvedValue({
        verdict: 'safe',
        reason: '',
        evidence: { buyTaxBps: 0, sellTaxBps: 0, method: 'exactInputSingle', dexType: 'v2' },
    });
    isBlacklistedTokenForChainMock.mockReset().mockResolvedValue(false);
    isLiquidityLockedForChainMock.mockReset().mockResolvedValue(true);
    isLiquiditySufficientForChainMock.mockReset().mockResolvedValue(true);
    checkTokenMetadataForChainMock.mockReset().mockResolvedValue(true);
    simulateSwapForChainMock.mockReset().mockResolvedValue(true);
    hasHighTransferTaxForChainMock.mockReset().mockResolvedValue(false);
    hasMaxWalletOrTxLimitsForChainMock.mockReset().mockResolvedValue(false);
    isKnownBadTokenForChainMock.mockReset().mockResolvedValue(false);
    isMutableTokenForChainMock.mockReset().mockResolvedValue({ isMutable: false, hits: [] });

    isTokenSnipedGetMock.mockReset().mockReturnValue(undefined);
    canSnipeMock.mockReset().mockReturnValue({ allowed: true, reason: null, details: '' });

    // Bundle build helpers
    getAmountsOutMock.mockReset().mockResolvedValue([BigInt('10000000000000000'), BigInt('1000')]);
    balanceOfMock.mockReset().mockResolvedValue(BigInt('1000'));
    tokenSymbolMock.mockReset().mockResolvedValue('TKN');
    tokenNameMock.mockReset().mockResolvedValue('Token');
    tokenDecimalsMock.mockReset().mockResolvedValue(18);
    pairToken0Mock.mockReset().mockResolvedValue('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
    pairGetReservesMock.mockReset().mockResolvedValue({ reserve0: BigInt('1000000000000000000'), reserve1: BigInt('1000000000000000000') });
    v3QuoterStaticCallMock.mockReset().mockResolvedValue([BigInt('1000')]);

    sendTxWithRetryMock.mockReset().mockResolvedValue('0xtxhash');
    insertTradeRunMock.mockReset();
    recordSnipeMock.mockReset();
    startExitMonitorMock.mockReset().mockResolvedValue(undefined);
    snapshotLpBaselineMock.mockReset().mockResolvedValue(undefined);
    registerAntiRugPositionMock.mockReset().mockResolvedValue(undefined);

    sendCtxAlertMock.mockReset().mockResolvedValue(undefined);
    broadcastMock.mockReset();
    setPauseStateRunMock.mockReset();
    updateTradeStatusRunMock.mockReset();

    // Trade id for the exit-monitor lookup; row is found.
    getTradeIdForPendingTokenGetMock.mockReset().mockReturnValue({ id: 42 });

    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
    loggerErrorMock.mockReset();
    loggerDebugMock.mockReset();
    loggerFatalMock.mockReset();
}

// Helper: search loggerInfoMock for a log whose first-arg object has the given op field
function loggedKillswitchOp(op: string): unknown[] | undefined {
    return loggerInfoMock.mock.calls.find(([fields]: any) => fields && fields.op === op);
}

describe('killswitch CP1 (V2 path)', () => {
    beforeEach(() => {
        rearmHappyPath();
    });

    it('paused=1 → pino info { op: killswitch.cp1 } + sendTxWithRetry NEVER called + insertTrade NEVER called', async () => {
        getPauseStateGetMock.mockReturnValue({ paused: 1, paused_at: 123, paused_by: 'manual', reason: 'test' });
        const bot = await import('../../src/bot');
        const ctx = makeCtx();
        const dex = makeV2Dex();
        const targetToken = '0xToken0000000000000000000000000000000000001';
        const wethSorted = ctx.chain.wethAddress;

        // handleNewPairForChain is exported; call it directly.
        await (bot as any).handleNewPairForChain(ctx as any, dex as any, wethSorted, targetToken, '0xPair');

        expect(loggedKillswitchOp('killswitch.cp1')).toBeDefined();
        expect(sendTxWithRetryMock).not.toHaveBeenCalled();
        expect(insertTradeRunMock).not.toHaveBeenCalled();
    });
});

describe('killswitch CP2 (V2 path)', () => {
    beforeEach(() => {
        rearmHappyPath();
    });

    it('paused flips between CP1 and CP2 → pino info { op: killswitch.cp2 } + getAmountsOut WAS called + sendTxWithRetry NOT called', async () => {
        // CP1 sees paused=0; CP2 sees paused=1. Driven by call-order of
        // getPauseState.get(): N calls per V2 path. CP1 is the first
        // killswitch read (after safety bank); CP2 is the second.
        // Other reads (e.g., from mid-run setInterval) don't happen in this
        // direct handleNewPairForChain invocation.
        let getCallCount = 0;
        getPauseStateGetMock.mockImplementation(() => {
            getCallCount += 1;
            if (getCallCount === 1) return { paused: 0 };  // CP1 passes
            return { paused: 1, paused_at: 123, paused_by: 'manual', reason: 'test' };
        });

        const bot = await import('../../src/bot');
        const ctx = makeCtx();
        const dex = makeV2Dex();
        const targetToken = '0xToken0000000000000000000000000000000000001';

        await (bot as any).handleNewPairForChain(ctx as any, dex as any, ctx.chain.wethAddress, targetToken, '0xPair');

        expect(loggedKillswitchOp('killswitch.cp2')).toBeDefined();
        // Bundle-build helper getAmountsOut WAS called (CP2 fires AFTER
        // bundle construction).
        expect(getAmountsOutMock).toHaveBeenCalled();
        expect(sendTxWithRetryMock).not.toHaveBeenCalled();
    });
});

describe('killswitch CP3 (V2 path)', () => {
    beforeEach(() => {
        rearmHappyPath();
    });

    it('paused=1 ONLY at CP3 (post-submit) → pino info { op: killswitch.cp3 } + insertTrade STILL called + startExitMonitor STILL called', async () => {
        // CP1 and CP2 see paused=0; CP3 sees paused=1. Three sequential reads.
        let getCallCount = 0;
        getPauseStateGetMock.mockImplementation(() => {
            getCallCount += 1;
            if (getCallCount <= 2) return { paused: 0 };
            return { paused: 1, paused_at: 123, paused_by: 'manual', reason: 'post-submit' };
        });

        const bot = await import('../../src/bot');
        const ctx = makeCtx();
        const dex = makeV2Dex();
        const targetToken = '0xToken0000000000000000000000000000000000001';

        await (bot as any).handleNewPairForChain(ctx as any, dex as any, ctx.chain.wethAddress, targetToken, '0xPair');

        expect(loggedKillswitchOp('killswitch.cp3')).toBeDefined();
        // CP3 is audit-only — bundle in flight, trade IS recorded.
        expect(sendTxWithRetryMock).toHaveBeenCalled();
        expect(insertTradeRunMock).toHaveBeenCalled();
        expect(startExitMonitorMock).toHaveBeenCalled();
    });
});

describe('killswitch V2 happy path (no pause)', () => {
    beforeEach(() => {
        rearmHappyPath();
    });

    it('paused=0 throughout → no killswitch.* log fires; normal buy flow executes', async () => {
        const bot = await import('../../src/bot');
        const ctx = makeCtx();
        const dex = makeV2Dex();
        const targetToken = '0xToken0000000000000000000000000000000000001';

        await (bot as any).handleNewPairForChain(ctx as any, dex as any, ctx.chain.wethAddress, targetToken, '0xPair');

        expect(loggedKillswitchOp('killswitch.cp1')).toBeUndefined();
        expect(loggedKillswitchOp('killswitch.cp2')).toBeUndefined();
        expect(loggedKillswitchOp('killswitch.cp3')).toBeUndefined();
        expect(sendTxWithRetryMock).toHaveBeenCalled();
        expect(insertTradeRunMock).toHaveBeenCalled();
        expect(startExitMonitorMock).toHaveBeenCalled();
    });
});

// V3 + cross-cutting tests land in Task 2b — keep as it.skip placeholders.
describe('killswitch CP1 (V3 path)', () => {
    it.skip('reason: pending impl in plan 20-04 Task 2b — asserts pino info { op: killswitch.cp1, feeTier } + sendTxWithRetry NEVER called for V3 path', () => {
        /* impl */
    });
});

describe('killswitch CP2 (V3 path)', () => {
    it.skip('reason: pending impl in plan 20-04 Task 2b — asserts pino info { op: killswitch.cp2, feeTier } + V3 quoteExactInputSingle WAS called', () => {
        /* impl */
    });
});

describe('killswitch CP3 (V3 path)', () => {
    it.skip('reason: pending impl in plan 20-04 Task 2b — asserts pino info { op: killswitch.cp3, feeTier } + V3 insertTrade STILL called', () => {
        /* impl */
    });
});

describe('killswitch cross-cutting paths', () => {
    it.skip('reason: pending impl in plan 20-04 Task 2b — V3 happy path (no pause)', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-04 Task 2b — V3 cross-V2/V3 paused flips between CP1 and CP2', () => {
        /* impl */
    });
});
