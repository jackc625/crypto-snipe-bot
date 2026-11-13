// test/unit/bot/snipeFailClean.test.ts
// Phase 21.3 / Plan 21.3-03 — STOP-THE-LINE-05-D / D-SNIPE-FAIL-CLEAN + D-ALERTS.
//
// When the hardened PRIVATE buy is exhausted (multi-builder fanout across N blocks
// still not included, or the buy ceiling is hit), a snipe MUST fail CLEAN — snipes
// NEVER auto-go-public (front-run protection preserved; the deliberate/capture path
// is the manual public escape). The observable is ZERO spend + NO trades row + a
// structured hard alert. The 21-07 live re-block proved capital safety here
// empirically (wallet byte-identical, no trades row); these tests encode that
// invariant as a unit assertion on the REAL throw path.
//
// We drive the REAL handleNewPairForChain (the V2 pair-event snipe site) with the
// upstream safety bank mocked to PASS (their behavior is not under test here) and
// make submitBuyTx's sendTxWithRetry THROW a ceiling-hit. insertTrade.run is the DB
// external boundary we assert was NEVER called. The fail-clean alert is the
// structured op:'buy.snipe.fail-clean' pino entry; we assert its presence + that the
// payload carries NO FLASHBOTS_AUTH_KEY / signed raw tx (T-21.3-03-06).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Module-scope mock instances ----
const sendTxWithRetryMock = vi.fn();
const insertTradeRunMock = vi.fn();
const recordSnipeMock = vi.fn();
const startExitMonitorMock = vi.fn();
const updateTradeStatusRunMock = vi.fn();
const sendCtxAlertMock = vi.fn();

const isBlacklistedTokenForChainMock = vi.fn();
const isLiquidityLockedForChainMock = vi.fn();
const isLiquiditySufficientForChainMock = vi.fn();
const checkTokenMetadataForChainMock = vi.fn();
const simulateSwapForChainMock = vi.fn();
const hasMaxWalletOrTxLimitsForChainMock = vi.fn();
const isKnownBadTokenForChainMock = vi.fn();
const isMutableTokenForChainMock = vi.fn();
const simulateHoneypotRoundtripMock = vi.fn();
const canSnipeMock = vi.fn();

const getAmountsOutMock = vi.fn();
const balanceOfMock = vi.fn();
const tokenSymbolMock = vi.fn();
const tokenNameMock = vi.fn();
const tokenDecimalsMock = vi.fn();
const pairToken0Mock = vi.fn();
const pairGetReservesMock = vi.fn();
const getPauseStateGetMock = vi.fn();
const getTradeIdForPendingTokenGetMock = vi.fn();
const isTokenSnipedGetMock = vi.fn();

const loggerErrorMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerDebugMock = vi.fn();
const checkEntryExitAffordabilityMock = vi.fn();

vi.doMock('../../../src/utils/tokenSafety', () => ({
    checkTokenMetadata: vi.fn(),
    isLiquidityLocked: vi.fn(),
    simulateSwap: vi.fn(),
    checkHoneypot: vi.fn(),
    isBlacklistedToken: vi.fn(),
    isLiquiditySufficient: vi.fn(),
    isKnownBadToken: vi.fn(),
    hasMaxWalletOrTxLimits: vi.fn(),
    simulateSell: vi.fn(),
    isLiquidityLockedForChain: isLiquidityLockedForChainMock,
    simulateSwapForChain: simulateSwapForChainMock,
    isLiquiditySufficientForChain: isLiquiditySufficientForChainMock,
    isKnownBadTokenForChain: isKnownBadTokenForChainMock,
    checkTokenMetadataForChain: checkTokenMetadataForChainMock,
    hasMaxWalletOrTxLimitsForChain: hasMaxWalletOrTxLimitsForChainMock,
    isBlacklistedTokenForChain: isBlacklistedTokenForChainMock,
}));

vi.doMock('../../../src/utils/honeypot', () => ({ simulateHoneypotRoundtrip: simulateHoneypotRoundtripMock }));
vi.doMock('../../../src/utils/honeypot/bytecodeScan', () => ({ isMutableTokenForChain: isMutableTokenForChainMock }));
vi.doMock('../../../src/utils/honeypot/sanitize', () => ({ sanitizeReason: (r: string) => r }));
vi.doMock('../../../src/utils/blocklist', () => ({ BLOCKLIST: { tokens: new Set(), pairs: new Set() } }));
vi.doMock('../../../src/utils/notifier', () => ({ sendTelegramAlert: vi.fn(), sendCtxAlert: sendCtxAlertMock }));

vi.doMock('../../../src/utils/db', () => ({
    db: { prepare: vi.fn(), pragma: vi.fn(), exec: vi.fn(), transaction: vi.fn() },
    insertTrade: { run: insertTradeRunMock },
    updateTradeStatus: { run: updateTradeStatusRunMock },
    isTokenSniped: { get: isTokenSnipedGetMock },
    getTradeIdForPendingToken: { get: getTradeIdForPendingTokenGetMock },
    getPauseState: { get: getPauseStateGetMock },
    setPauseState: { run: vi.fn() },
    forceWalCheckpoint: vi.fn(),
    getResumeExitMonitorTrades: { all: vi.fn().mockReturnValue([]) },
    getResumeAntiRugTrades: { all: vi.fn().mockReturnValue([]) },
}));

vi.doMock('../../../src/utils/provider', () => ({
    getProvider: vi.fn(),
    getWallet: vi.fn(),
    getWsProvider: vi.fn().mockReturnValue(null),
    removeWsProvider: vi.fn(),
}));

vi.doMock('../../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
    createMevStrategy: vi.fn().mockReturnValue({ healthCheck: vi.fn().mockResolvedValue(true) }),
    // escalatePrivateBuy is imported by bot.ts but only used by executeDeliberateBuy
    // (not the snipe path under test here).
    escalatePrivateBuy: vi.fn(),
}));

vi.doMock('../../../src/utils/mevStrategies/reconciliation', () => ({
    reconcileInclusion: vi.fn(),
    buildReconcileConfig: vi.fn(),
}));

vi.doMock('../../../src/exitEngine', () => ({
    startExitMonitor: startExitMonitorMock,
    resumeExitMonitor: vi.fn(),
    setExitWorkerWatchdog: vi.fn(),
    computePublicMinOut: vi.fn(),
}));

vi.doMock('../../../src/anti-rug/lpBaseline', () => ({ snapshotLpBaseline: vi.fn() }));
vi.doMock('../../../src/anti-rug/detector', () => ({ registerAntiRugPosition: vi.fn(), startChainAntiRugListener: vi.fn() }));
vi.doMock('../../../src/anti-rug/allowlist', () => ({ verifyAllowlistAtStartup: vi.fn() }));
vi.doMock('../../../src/api/ws/broadcaster', () => ({ broadcast: vi.fn(), addClient: vi.fn(), removeClient: vi.fn(), getClientCount: vi.fn().mockReturnValue(0) }));
vi.doMock('../../../src/riskManager', () => ({ canSnipe: canSnipeMock, recordSnipe: recordSnipeMock }));

// The mode-aware affordability gate PASSES so the snipe reaches the buy submit.
vi.doMock('../../../src/preflight', () => ({
    preflight: vi.fn(),
    checkWalletBalance: vi.fn(),
    checkEntryExitAffordability: checkEntryExitAffordabilityMock,
}));

class MockContract {
    interface = { encodeFunctionData: vi.fn().mockReturnValue('0xencoded') };
    getAmountsOut = getAmountsOutMock;
    balanceOf = balanceOfMock;
    symbol = tokenSymbolMock;
    name = tokenNameMock;
    decimals = tokenDecimalsMock;
    token0 = pairToken0Mock;
    getReserves = pairGetReservesMock;
}

vi.doMock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    return { ...actual, Contract: MockContract };
});

function makeCtx() {
    return {
        chain: {
            chainId: 1, name: 'eth', displayName: '[ETH]', enabled: true, nativeCurrency: 'ETH',
            wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            httpRpcUrl: 'http://test', wsRpcUrl: null, dexes: [],
            mevStrategy: 'flashbots', mevConfig: {},
            safetyApis: { honeypot: 'honeypot.is', liquidityLock: 'unicrypt', tokenSecurity: 'goplus' },
            snipeAmount: '0.01', maxCapital: '1.0', gasBuffer: '0.005',
            gas: { type: 'eip1559', multiplier: 1.2, maxGasLimit: 300_000n },
            blockAgeToleranceSec: 300,
            honeypotChecker: { deployedAddress: '0x0000000000000000000000000000000000000001', method: 'exactInputSingle', maxBuyTaxBps: 1000, maxSellTaxBps: 1000 },
            antiRug: {}, allowlist: [], explorerUrl: 'https://etherscan.io', minLiquidityThreshold: '0.1',
        },
        httpProvider: {
            getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
            getFeeData: vi.fn().mockResolvedValue({
                maxFeePerGas: BigInt('30000000000'),
                maxPriorityFeePerGas: BigInt('10000000000'),
                gasPrice: BigInt('30000000000'),
            }),
        },
        wsProvider: null,
        wallet: { address: '0xWallet', populateTransaction: vi.fn().mockResolvedValue({}) },
        log: { info: loggerInfoMock, warn: loggerWarnMock, debug: loggerDebugMock, error: loggerErrorMock, fatal: vi.fn() },
    };
}

function makeV2Dex() {
    return { name: 'uniswap-v2', dexType: 'v2', factoryAddress: '0xFactory', routerAddress: '0xRouter' };
}

function rearm() {
    getPauseStateGetMock.mockReset().mockReturnValue({ paused: 0 });
    simulateHoneypotRoundtripMock.mockReset().mockResolvedValue({
        verdict: 'safe', reason: '', evidence: { buyTaxBps: 0, sellTaxBps: 0, method: 'exactInputSingle', dexType: 'v2' },
    });
    isBlacklistedTokenForChainMock.mockReset().mockResolvedValue(false);
    isLiquidityLockedForChainMock.mockReset().mockResolvedValue(true);
    isLiquiditySufficientForChainMock.mockReset().mockResolvedValue(true);
    checkTokenMetadataForChainMock.mockReset().mockResolvedValue(true);
    simulateSwapForChainMock.mockReset().mockResolvedValue(true);
    hasMaxWalletOrTxLimitsForChainMock.mockReset().mockResolvedValue(false);
    isKnownBadTokenForChainMock.mockReset().mockResolvedValue(false);
    isMutableTokenForChainMock.mockReset().mockResolvedValue({ isMutable: false, hits: [] });
    isTokenSnipedGetMock.mockReset().mockReturnValue(undefined);
    canSnipeMock.mockReset().mockReturnValue({ allowed: true, reason: null, details: '' });

    getAmountsOutMock.mockReset().mockResolvedValue([BigInt('10000000000000000'), BigInt('1000')]);
    balanceOfMock.mockReset().mockResolvedValue(BigInt('1000'));
    tokenSymbolMock.mockReset().mockResolvedValue('TKN');
    tokenNameMock.mockReset().mockResolvedValue('Token');
    tokenDecimalsMock.mockReset().mockResolvedValue(18);
    pairToken0Mock.mockReset().mockResolvedValue('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
    pairGetReservesMock.mockReset().mockResolvedValue({ reserve0: BigInt('1000000000000000000'), reserve1: BigInt('1000000000000000000') });

    // THE KEY: the hardened private snipe submit THROWS a ceiling-hit (the strategy's
    // op:'mev.escalation.ceiling-hit' throw bubbles up through submitBuyTx).
    sendTxWithRetryMock.mockReset().mockRejectedValue(
        new Error('MEV bundle not included after 4 attempt(s); priority-fee ceiling reached.'),
    );
    insertTradeRunMock.mockReset();
    recordSnipeMock.mockReset();
    startExitMonitorMock.mockReset().mockResolvedValue(undefined);
    updateTradeStatusRunMock.mockReset();
    sendCtxAlertMock.mockReset().mockResolvedValue(undefined);
    getTradeIdForPendingTokenGetMock.mockReset().mockReturnValue({ id: 42 });

    checkEntryExitAffordabilityMock.mockReset().mockResolvedValue({ passed: true, reason: '', details: {} });

    loggerErrorMock.mockReset();
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
    loggerDebugMock.mockReset();
}

function failCleanLog(): unknown[] | undefined {
    return loggerErrorMock.mock.calls.find(([fields]: any) => fields && fields.op === 'buy.snipe.fail-clean');
}

describe('Phase 21.3 — snipe fail-clean (STOP-THE-LINE-05-D) [REAL-PATH]', () => {
    beforeEach(() => {
        rearm();
    });

    // The first test in this file pays the cold import of the module under test inside its body,
    // which runs against testTimeout, not hookTimeout. Measured on Node 22: 1.2 s alone, 2.6 s under the full parallel npm test (wave 6 gate),
    // when several workers compile the same module graph at once. The explicit limit is headroom.
    it('a snipe ceiling-hit throws -> ZERO ETH spent, NO trades row inserted (insertTrade.run never called)', { timeout: 20_000 }, async () => {
        const bot = await import('../../../src/bot');
        const ctx = makeCtx();
        const dex = makeV2Dex();
        const targetToken = '0xToken0000000000000000000000000000000000001';

        await (bot as any).handleNewPairForChain(ctx as any, dex as any, ctx.chain.wethAddress, targetToken, '0xPair');

        // The private snipe submit was attempted (real path through submitBuyTx).
        expect(sendTxWithRetryMock).toHaveBeenCalledTimes(1);
        // Fail-clean: no trades row, no recorded snipe, no exit monitor armed.
        expect(insertTradeRunMock).not.toHaveBeenCalled();
        expect(recordSnipeMock).not.toHaveBeenCalled();
        expect(startExitMonitorMock).not.toHaveBeenCalled();
    });

    it('emits a structured op:buy.snipe.fail-clean alert (token, chain, attempts, statsRef, reason, remediation) on the throw — no secret leak', async () => {
        const bot = await import('../../../src/bot');
        const ctx = makeCtx();
        const dex = makeV2Dex();
        const targetToken = '0xToken0000000000000000000000000000000000001';

        await (bot as any).handleNewPairForChain(ctx as any, dex as any, ctx.chain.wethAddress, targetToken, '0xPair');

        const entry = failCleanLog();
        expect(entry).toBeDefined();
        const fields = (entry as any)[0];
        expect(fields.token).toBe(targetToken);
        expect(fields.chain).toBe('eth');
        expect(fields.poolType).toBe('v2');
        expect(fields.attempts).toBe(4);
        // The per-builder telemetry pointer (the stats live in the strategy's
        // op:flashbots.bundle.stats logs).
        expect(fields.statsRef).toBe('op:flashbots.bundle.stats');
        expect(typeof fields.reason).toBe('string');
        expect(typeof fields.remediation).toBe('string');

        // T-21.3-03-06: the payload carries NO secret — no FLASHBOTS_AUTH_KEY and no
        // signed raw tx anywhere in the serialized structured alert.
        const serialized = JSON.stringify(fields);
        expect(serialized).not.toMatch(/FLASHBOTS_AUTH_KEY/i);
        expect(serialized).not.toMatch(/0x[0-9a-f]{200,}/i); // no signed raw tx blob
    });
});
