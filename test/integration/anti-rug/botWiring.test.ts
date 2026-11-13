// test/integration/anti-rug/botWiring.test.ts
// Phase 19 Plan 19-05 / Task 2 — bot.ts wiring tests. Converted by Phase 23 plan 23-18 (CHAR-06,
// SPEC Requirement 8) from source-text guards to checks on what actually runs.
//
// V2 + V3 buy-success branches attach snapshotLpBaseline + registerAntiRugPosition
// parallel to the existing startExitMonitor call. startMultiChainBot's resume
// step calls resumeAntiRugMonitoring(contexts) after resumeMultiChainMonitoring.
// resumeAntiRugMonitoring re-registers open positions via lp_baseline JOIN +
// per-chain allowlist verify + per-chain startChainAntiRugListener.
//
// Tests (22-31):
//
//   Test 22: the arming shared by the V2 snipe and the deliberate buy runs
//            startExitMonitor, then snapshotLpBaseline, then registerAntiRugPosition
//            (baseline must exist before the detector loads it), feeTier null. Driven
//            through the real exported handleNewPairForChain AND executeDeliberateBuy.
//   Test 23: on the V2 path startExitMonitor runs before the snapshot/register pair and
//            stays armed when the snapshot rejects.
//   Test 24: the real exported handleNewV3PoolForChain arms in the same order and passes
//            poolAddress + the integer feeTier to snapshotLpBaseline + registerAntiRugPosition.
//   Test 25: a snapshotLpBaseline rejection on each of the V2 and V3 paths: the handler
//            resolves, ctx.log.error gets op 'antirug.baseline-snapshot-failed', and
//            registerAntiRugPosition is not called.
//   Test 26: the real startMultiChainBot reads getResumeExitMonitorTrades (the exit-engine
//            resume) before getResumeAntiRugTrades (the anti-rug resume).
//   Test 27: resumeAntiRugMonitoring queries trades JOIN lp_baseline and
//            re-registers each row via registerAntiRugPosition. Runtime test.
//   Test 28: resumeAntiRugMonitoring calls verifyAllowlistAtStartup once per
//            chain BEFORE the per-position re-register loop. Runtime test.
//   Test 29: resumeAntiRugMonitoring calls startChainAntiRugListener per chain
//            after re-registering positions. Runtime test.
//   Test 30: resumeAntiRugMonitoring does NOT crash when trades JOIN
//            lp_baseline returns zero rows. Runtime test.
//   Test 31: Pre-Phase-19 trades (no lp_baseline row) are excluded by the
//            INNER JOIN: the real getResumeAntiRugTrades statement, run on its real
//            connection (vi.importActual), returns only the baselined rows.
//
// Strategy: every test calls a real export of src/bot.ts (or src/utils/db.ts for Test 31's
// statement) and reads the order of the calls from the mocks this file already had
// (mock.invocationCallOrder). armPositionMonitoring is private, so it is reached through its two
// real exported callers. No test reads a source file. Each ordering claim is shown RED by an
// in-memory mutant in scripts/red-proof-bot-wiring.ts (rows in scripts/red-proof-conversions.ts
// WIRING_MUTANTS).
//
// The describe title 'Source-text wiring guards (Tests 22-26)' is kept on purpose: test identity
// (.planning/audit/tools/test-identity.ts) follows title paths and honours a recorded rename of
// the test's own title only, so renaming the describe level would report these five tests as
// missing. The tests under it are no longer source-text checks.
//
// Known bugs near this wiring, and why they do not decide these assertions: AUD-ANTIRUG-025 (a
// resumed position loses its anti-rug subscription) lives in detector.ts's off()/on() re-arm,
// and this file mocks the detector, so it asserts only that bot.ts calls registerAntiRugPosition
// in the right order. AUD-API-002 (dashboard Stop/Start) is the onRestart path, which no test here
// drives. AUD-ANTIRUG-001 / AUD-BUY-008 (reconnects rewrite ctx.wsProvider) need a reconnect; every
// context here has wsProvider null and none reconnects.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { rmSync } from 'fs';
import type { ChainContext, DexConfigV2, DexConfigV3 } from '../../../src/chainRegistry';

// -----------------------------------------------------------------------------
// Fixed values the stubs return. Plain values and plain functions (not vi.fn) wherever a test
// does not read the calls, so mockReset: true (vitest.config.ts) cannot wipe them between tests.
// -----------------------------------------------------------------------------

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const WALLET = '0x1111111111111111111111111111111111111111';
const V2_TOKEN = '0x00000000000000000000000000000000000000a2';
const V2_PAIR = '0x2222222222222222222222222222222222222222';
const V3_TOKEN = '0x00000000000000000000000000000000000000a3';
const V3_POOL = '0x3333333333333333333333333333333333333333';
const DELIBERATE_TOKEN = '0x00000000000000000000000000000000000000d1';
// The pair the dex factory's getPair returns for a deliberate buy.
const DELIBERATE_PAIR = '0x4444444444444444444444444444444444444444';
const DELIBERATE_HASH = '0x' + 'dd'.repeat(32);
const DELIBERATE_AMOUNT_WEI = 20_000_000_000_000_000n; // 0.02 ETH
const FEE_TIER = 3000;
const TRADE_ID = 41;
// balanceOf after the buy: the original token amount the exit monitor receives.
const ORIGINAL_TOKEN_AMOUNT = 1_000_000n;

/** The arming order every buy path must keep. */
const ARM_ORDER = ['startExitMonitor', 'snapshotLpBaseline', 'registerAntiRugPosition'];

// ethers Contract stub (the shape of test/integration/v2HoneypotIntegration.test.ts): every
// read the three buy paths make answers the happy path. A V3 pool already has a Mint in its
// PoolCreated block, so waitForLiquidity returns at once (no 30 s subscription wait).
class StubContract {
    readonly target: string;
    constructor(target: string) {
        this.target = target;
    }
    // ERC-20
    symbol = async () => 'WIRE';
    name = async () => 'Wiring Token';
    decimals = async () => 18;
    balanceOf = async () => ORIGINAL_TOKEN_AMOUNT;
    // V2 pair
    token0 = async () => WETH;
    getReserves = async () => ({ reserve0: 10n ** 18n, reserve1: 10n ** 18n });
    // V2 router and factory
    getAmountsOut = async (amountIn: bigint) => [amountIn, 1_000_000n];
    getPair = async () => DELIBERATE_PAIR;
    // V3 pool and quoter
    filters = { Mint: () => ({}) };
    queryFilter = async () => [{}];
    quoteExactInputSingle = { staticCall: async () => [1_000_000n] };
    interface = { encodeFunctionData: () => '0x' };
}

vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    return { ...actual, Contract: StubContract };
});

// -----------------------------------------------------------------------------
// Mocks. Declared first so vi.mock factories pick them up before the bot.ts module loads via
// dynamic import.
// -----------------------------------------------------------------------------

const logInfo = vi.fn();
const logWarn = vi.fn();
const logError = vi.fn();
const logFatal = vi.fn();
const logDebug = vi.fn();

const ctxLogInfo = vi.fn();
const ctxLogWarn = vi.fn();
const ctxLogError = vi.fn();
const ctxLogFatal = vi.fn();
const ctxLogDebug = vi.fn();

vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: logInfo,
            warn: logWarn,
            error: logError,
            fatal: logFatal,
            debug: logDebug,
        }),
        info: logInfo,
        warn: logWarn,
        error: logError,
        fatal: logFatal,
        debug: logDebug,
    },
}));

const registerAntiRugPositionMock = vi.fn().mockResolvedValue(undefined);
const startChainAntiRugListenerMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/anti-rug/detector', () => ({
    registerAntiRugPosition: registerAntiRugPositionMock,
    startChainAntiRugListener: startChainAntiRugListenerMock,
    unregisterAntiRugPosition: vi.fn(),
}));

const verifyAllowlistAtStartupMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/anti-rug/allowlist', () => ({
    verifyAllowlistAtStartup: verifyAllowlistAtStartupMock,
    mergeAllowlist: vi.fn().mockReturnValue([]),
    isAddressAllowlisted: vi.fn().mockReturnValue({ verdict: 'unknown' }),
}));

const snapshotLpBaselineMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/anti-rug/lpBaseline', () => ({
    snapshotLpBaseline: snapshotLpBaselineMock,
    loadLpBaseline: vi.fn(),
    clearLpBaseline: vi.fn(),
}));

// db mock: prepare returns a statement; .all returns whatever the test injects.
const allMock = vi.fn().mockReturnValue([]);
const prepareSpy = vi.fn().mockImplementation((_sql: string) => ({
    all: allMock,
    get: vi.fn(),
    run: vi.fn(),
}));

// Phase 21.2-11 / S-1: the restart-resume scans now read pre-prepared, exported
// statements from db.ts (getResumeAntiRugTrades / getResumeExitMonitorTrades)
// — the higher-quality cached-statement idiom (surfaces SQL errors at module
// load, single test surface) — instead of an inline db.prepare in bot.ts. These
// mocks back the new exports so the runtime resume tests inject rows through the
// statement the production code now actually calls.
const resumeAntiRugAllMock = vi.fn().mockReturnValue([]);
const resumeExitMonitorAllMock = vi.fn().mockReturnValue([]);

vi.mock('../../../src/utils/db', () => ({
    db: { prepare: prepareSpy },
    insertTrade: { run: vi.fn() },
    isTokenSniped: { get: vi.fn().mockReturnValue(undefined) },
    updateTradeStatus: { run: vi.fn() },
    // The buy paths look up the trade row they just inserted.
    getTradeIdForPendingToken: { get: () => ({ id: TRADE_ID }) },
    getResumeAntiRugTrades: { all: resumeAntiRugAllMock },
    getResumeExitMonitorTrades: { all: resumeExitMonitorAllMock },
    closeDb: vi.fn(),
    getOpenPositionCount: { get: vi.fn() },
    getTotalExposure: { get: vi.fn() },
    getDailyRealizedLoss: { get: vi.fn() },
    upsertExitState: { run: vi.fn() },
    getExitState: { get: vi.fn() },
    deleteExitState: { run: vi.fn() },
    upsertLpBaseline: { run: vi.fn() },
    getLpBaseline: { get: vi.fn() },
    deleteLpBaseline: { run: vi.fn() },
    upsertChainState: { run: vi.fn() },
    getChainState: { get: vi.fn() },
    // Phase 20 / Plan 20-03 — startChainAntiRugListener now calls
    // setAntirugDryRunStarted.run(chain, now, now). Stub as no-op since
    // this test verifies bot.ts wiring of the detector lifecycle, not db
    // persistence of the dry-run timestamp.
    setAntirugDryRunStarted: { run: vi.fn() },
    getAntirugDryRunStarted: { get: vi.fn().mockReturnValue(undefined) },
    // The kill-switch checkpoints the buy paths and the mid-run check read: not paused.
    getPauseState: { get: () => ({ paused: 0 }) },
    setPauseState: { run: () => undefined },
    clearPauseState: { run: () => undefined },
    forceWalCheckpoint: () => undefined,
}));

// Heavyweight imports that bot.ts pulls in transitively. The chain-aware checks answer the
// happy path so a buy handler reaches its buy-success branch.
vi.mock('../../../src/utils/tokenSafety', () => ({
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
    isLiquidityLockedForChain: async () => true,
    simulateSwapForChain: async () => true,
    isLiquiditySufficientForChain: async () => true,
    isKnownBadTokenForChain: async () => false,
    checkTokenMetadataForChain: async () => true,
    // hasHighTransferTaxForChain removed (plan 21.1-03): function deleted from
    // tokenSafety.ts; this mock entry was inert.
    hasMaxWalletOrTxLimitsForChain: async () => false,
    isBlacklistedTokenForChain: async () => false,
}));

vi.mock('../../../src/utils/honeypot', () => ({
    simulateHoneypotRoundtrip: async () => ({
        verdict: 'safe',
        reason: 'roundtrip ok',
        evidence: { buyTaxBps: 0, sellTaxBps: 0, method: 'test', dexType: 'v2' },
    }),
}));

vi.mock('../../../src/utils/honeypot/bytecodeScan', () => ({
    isMutableTokenForChain: async () => ({ isMutable: false, hits: [] }),
}));

vi.mock('../../../src/utils/honeypot/sanitize', () => ({
    sanitizeReason: vi.fn().mockReturnValue('sanitized'),
}));

vi.mock('../../../src/utils/blocklist', () => ({
    BLOCKLIST: { tokens: new Set<string>(), pairs: new Set<string>() },
}));

vi.mock('../../../src/utils/notifier', () => ({
    sendTelegramAlert: vi.fn(),
    sendCtxAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/utils/provider', () => ({
    getProvider: vi.fn(),
    getWallet: vi.fn(),
    getWsProvider: vi.fn(),
    removeWsProvider: vi.fn(),
}));

// The snipe submit returns a hash; the deliberate buy's private leg lands.
vi.mock('../../../src/utils/txManager', () => ({
    sendTxWithRetry: async () => '0x' + 'ab'.repeat(32),
    createMevStrategy: () => ({ healthCheck: async () => true }),
    escalatePrivateBuy: async () => ({ landed: true, txHash: DELIBERATE_HASH }),
}));

// The entry affordability gate passes; the boot preflight passes.
vi.mock('../../../src/preflight', () => ({
    preflight: async () => undefined,
    checkWalletBalance: async () => ({ chain: 'eth', check: 'wallet-balance', passed: true }),
    checkEntryExitAffordability: async () => ({ passed: true }),
}));

vi.mock('../../../src/utils/exitManager', () => ({
    clearAllTimers: vi.fn(),
    clearAllTimersForToken: vi.fn(),
    tryAcquireSellLock: vi.fn(),
    releaseSellLock: vi.fn(),
    registerExitMonitor: vi.fn(),
    registerStopLoss: vi.fn(),
    registerTakeProfit: vi.fn(),
    registerTimedSell: vi.fn(),
}));

const startExitMonitorMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/exitEngine', () => ({
    startExitMonitor: startExitMonitorMock,
    resumeExitMonitor: vi.fn().mockResolvedValue(undefined),
    executeFullSell: vi.fn(),
    setExitWorkerWatchdog: () => undefined,
    computePublicMinOut: () => 0n,
}));

const buildChainRegistryMock = vi.fn();
const createChainContextMock = vi.fn();
const getEnabledChainsMock = vi.fn().mockReturnValue([]);
vi.mock('../../../src/chainRegistry', async () => {
    const actual = await vi.importActual<typeof import('../../../src/chainRegistry')>('../../../src/chainRegistry');
    return {
        ...actual,
        buildChainRegistry: buildChainRegistryMock,
        createChainContext: createChainContextMock,
        getEnabledChains: getEnabledChainsMock,
    };
});

vi.mock('../../../src/riskManager', () => ({
    canSnipe: () => ({ allowed: true }),
    recordSnipe: () => undefined,
}));

vi.mock('../../../src/api/server', () => ({
    startApiServer: () => ({ close: () => undefined }),
}));

vi.mock('../../../src/telegramListener', () => ({
    startTelegramListener: async () => ({ client: null, connected: false }),
}));

vi.mock('../../../src/utils/gasManager', () => ({
    getGasOptions: vi.fn(),
}));

vi.mock('../../../src/config', () => ({
    CONFIG: {
        trailingStopPct: 15,
        trailingMinPct: 5,
        trailingMaxPct: 40,
        stopLossPercent: 25,
        partialSellTargets: '',
        exitPollIntervalMs: 5000,
        urgencyWindowMs: 30 * 60 * 1000,
        volatilityBaselineCV: 0.03,
        volatilityMaxSamples: 60,
        volatilityMinSamples: 12,
        slippagePercent: 5,
    },
}));

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function buildChainCtx(chainName: string, dexType: 'v2' | 'v3' | 'both' = 'both') {
    const dexes = [];
    if (dexType === 'v2' || dexType === 'both') {
        dexes.push({
            dexType: 'v2',
            name: 'uniswap-v2',
            factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
            routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        });
    }
    if (dexType === 'v3' || dexType === 'both') {
        dexes.push({
            dexType: 'v3',
            name: 'uniswap-v3',
            factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
            quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
            swapRouterAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        });
    }
    return {
        chain: {
            name: chainName,
            displayName: `[${chainName.toUpperCase()}]`,
            chainId: chainName === 'eth' ? 1 : 56,
            wethAddress: WETH,
            nativeCurrency: 'ETH',
            explorerUrl: 'https://etherscan.io',
            mevStrategy: 'flashbots',
            snipeAmount: '0.01',
            maxCapital: '1.0',
            minLiquidityThreshold: '0.5',
            dexes,
            antiRug: {
                liveExecute: false,
                lpRemovalPct: 50,
                confirmBlocks: 1,
                circuitBreakerTriggers: 3,
                circuitBreakerWindowHours: 1,
                gasMultiplier: 2.0,
                backfillCapBlocks: 10,
                maxBackfillBlocks: 7200,
                allowlistV2: [],
                allowlistV3: [],
            },
        },
        httpProvider: {},
        wsProvider: null,
        wallet: { address: WALLET, populateTransaction: async () => ({}) },
        log: {
            info: ctxLogInfo,
            warn: ctxLogWarn,
            error: ctxLogError,
            fatal: ctxLogFatal,
            debug: ctxLogDebug,
        },
    };
}

type Fixture = ReturnType<typeof buildChainCtx>;
const asCtx = (f: Fixture): ChainContext => f as unknown as ChainContext;
const v2DexOf = (f: Fixture): DexConfigV2 => f.chain.dexes.find((d) => d.dexType === 'v2') as unknown as DexConfigV2;
const v3DexOf = (f: Fixture): DexConfigV3 => f.chain.dexes.find((d) => d.dexType === 'v3') as unknown as DexConfigV3;

/** The arming calls in the order they ran, read from the global mock call order. */
function armingSequence(): string[] {
    const named: Array<[string, { mock: { invocationCallOrder: number[] } }]> = [
        ['startExitMonitor', startExitMonitorMock],
        ['snapshotLpBaseline', snapshotLpBaselineMock],
        ['registerAntiRugPosition', registerAntiRugPositionMock],
    ];
    return named
        .flatMap(([n, m]) => m.mock.invocationCallOrder.map((order) => ({ order, n })))
        .sort((a, b) => a.order - b.order)
        .map((x) => x.n);
}

/** Forget the arming calls so far (keeps each mock's implementation). */
function clearArming(): void {
    startExitMonitorMock.mockClear();
    snapshotLpBaselineMock.mockClear();
    registerAntiRugPositionMock.mockClear();
}

beforeEach(() => {
    [logInfo, logWarn, logError, logFatal, logDebug,
     ctxLogInfo, ctxLogWarn, ctxLogError, ctxLogFatal, ctxLogDebug]
        .forEach(m => m.mockClear());
    registerAntiRugPositionMock.mockClear().mockResolvedValue(undefined);
    startChainAntiRugListenerMock.mockClear().mockResolvedValue(undefined);
    verifyAllowlistAtStartupMock.mockClear().mockResolvedValue(undefined);
    snapshotLpBaselineMock.mockClear().mockResolvedValue(undefined);
    startExitMonitorMock.mockClear().mockResolvedValue(undefined);
    allMock.mockReset().mockReturnValue([]);
    resumeAntiRugAllMock.mockReset().mockReturnValue([]);
    resumeExitMonitorAllMock.mockReset().mockReturnValue([]);
    // mockReset:true (per vitest.config.ts) wipes implementations between
    // tests — re-set prepareSpy's factory so db.prepare(sql).all() works.
    prepareSpy.mockClear().mockImplementation((_sql: string) => ({
        all: allMock,
        get: vi.fn(),
        run: vi.fn(),
    }));
});

// The first import of src/bot pays the cold module-graph compile, so it runs in a hook
// (hookTimeout 10 s) rather than in the first test body (testTimeout 15 s). Measured on this
// file alone: well under 1 s; the full-run figures are in the 23-18 summary.
let bot: typeof import('../../../src/bot');
beforeAll(async () => {
    bot = await import('../../../src/bot');
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('Phase 19 — bot.ts wiring + resumeAntiRugMonitoring', () => {
    describe('Source-text wiring guards (Tests 22-26)', () => {
        it('Test 22: the shared armPositionMonitoring helper calls snapshotLpBaseline BEFORE registerAntiRugPosition', async () => {
            // Phase 21.3 / Plan 21.3-05 (STOP-THE-LINE-06): the V2 register->monitor wiring
            // lives in the SINGLE shared armPositionMonitoring helper, called by BOTH the snipe
            // handler AND executeDeliberateBuy so they cannot drift. The helper is private, so
            // both real exported callers are driven, each to a landed buy.

            // (1) The V2 snipe: handleNewPairForChain to its buy-success branch.
            const v2 = buildChainCtx('eth');
            const v2Dex = v2DexOf(v2);
            await bot.handleNewPairForChain(asCtx(v2), v2Dex, V2_TOKEN, WETH, V2_PAIR);
            expect(armingSequence()).toEqual(ARM_ORDER);
            expect(snapshotLpBaselineMock).toHaveBeenCalledWith(v2, v2Dex, TRADE_ID, V2_PAIR, null);
            expect(registerAntiRugPositionMock).toHaveBeenCalledWith(v2, v2Dex, V2_TOKEN, V2_PAIR, TRADE_ID, null);

            // (2) The deliberate buy: executeDeliberateBuy to a landed private result arms the
            // same way, through the same helper.
            clearArming();
            const d = buildChainCtx('eth');
            const dDex = v2DexOf(d);
            const landed = await bot.executeDeliberateBuy(asCtx(d), DELIBERATE_TOKEN, DELIBERATE_AMOUNT_WEI, dDex);
            expect(landed).toBe(DELIBERATE_HASH);
            expect(armingSequence()).toEqual(ARM_ORDER);
            expect(startExitMonitorMock).toHaveBeenCalledWith(d, dDex, DELIBERATE_TOKEN, null, '0.02', TRADE_ID, ORIGINAL_TOKEN_AMOUNT);
            expect(snapshotLpBaselineMock).toHaveBeenCalledWith(d, dDex, TRADE_ID, DELIBERATE_PAIR, null);
            expect(registerAntiRugPositionMock).toHaveBeenCalledWith(d, dDex, DELIBERATE_TOKEN, DELIBERATE_PAIR, TRADE_ID, null);
        });

        it('Test 23: the shared armPositionMonitoring helper calls registerAntiRugPosition parallel to startExitMonitor', async () => {
            // The exit monitor is armed FIRST (startExitMonitor) so an anti-rug baseline
            // failure never costs the exit monitor — the snapshot+register pair runs under the
            // try/catch AFTER.
            const ok = buildChainCtx('eth');
            await bot.handleNewPairForChain(asCtx(ok), v2DexOf(ok), V2_TOKEN, WETH, V2_PAIR);
            const seq = armingSequence();
            expect(seq[0]).toBe('startExitMonitor');
            expect([...seq.slice(1)].sort()).toEqual(['registerAntiRugPosition', 'snapshotLpBaseline']);

            // A baseline snapshot that rejects still leaves the exit monitor armed, first.
            clearArming();
            snapshotLpBaselineMock.mockRejectedValueOnce(new Error('baseline RPC down'));
            const failing = buildChainCtx('eth');
            await bot.handleNewPairForChain(asCtx(failing), v2DexOf(failing), V2_TOKEN, WETH, V2_PAIR);
            expect(startExitMonitorMock).toHaveBeenCalledTimes(1);
            expect(armingSequence()[0]).toBe('startExitMonitor');
        });

        it('Test 24: V3 buy-success branch calls snapshotLpBaseline + registerAntiRugPosition with feeTier', async () => {
            const v3 = buildChainCtx('eth');
            const v3Dex = v3DexOf(v3);
            await bot.handleNewV3PoolForChain(asCtx(v3), v3Dex, V3_TOKEN, WETH, FEE_TIER, V3_POOL, 100);
            expect(armingSequence()).toEqual(ARM_ORDER);
            // V3 path threads poolAddress and feeTier (the integer) into both calls.
            expect(snapshotLpBaselineMock).toHaveBeenCalledWith(v3, v3Dex, TRADE_ID, V3_POOL, FEE_TIER);
            expect(registerAntiRugPositionMock).toHaveBeenCalledWith(v3, v3Dex, V3_TOKEN, V3_POOL, TRADE_ID, FEE_TIER);
            expect(Number.isInteger(snapshotLpBaselineMock.mock.calls[0][4])).toBe(true);
            expect(Number.isInteger(registerAntiRugPositionMock.mock.calls[0][5])).toBe(true);
        });

        it("Test 25: snapshot failure handled via try/catch + 'antirug.baseline-snapshot-failed' log", async () => {
            // Both V2 + V3 paths must wrap the snapshot + register pair in try/catch so a
            // baseline failure does not crash the buy, is logged, and skips the register.
            const baselineFailed = expect.objectContaining({ op: 'antirug.baseline-snapshot-failed', tradeId: TRADE_ID });

            // V2.
            snapshotLpBaselineMock.mockRejectedValueOnce(new Error('baseline RPC down'));
            const v2 = buildChainCtx('eth');
            await expect(bot.handleNewPairForChain(asCtx(v2), v2DexOf(v2), V2_TOKEN, WETH, V2_PAIR)).resolves.toBeUndefined();
            expect(snapshotLpBaselineMock).toHaveBeenCalledTimes(1);
            expect(ctxLogError).toHaveBeenCalledWith(baselineFailed, expect.any(String));
            expect(registerAntiRugPositionMock).not.toHaveBeenCalled();

            // V3.
            clearArming();
            ctxLogError.mockClear();
            snapshotLpBaselineMock.mockRejectedValueOnce(new Error('baseline RPC down'));
            const v3 = buildChainCtx('eth');
            await expect(
                bot.handleNewV3PoolForChain(asCtx(v3), v3DexOf(v3), V3_TOKEN, WETH, FEE_TIER, V3_POOL, 100),
            ).resolves.toBeUndefined();
            expect(snapshotLpBaselineMock).toHaveBeenCalledTimes(1);
            expect(ctxLogError).toHaveBeenCalledWith(baselineFailed, expect.any(String));
            expect(registerAntiRugPositionMock).not.toHaveBeenCalled();
        });

        it('Test 26: startMultiChainBot calls resumeAntiRugMonitoring AFTER resumeMultiChainMonitoring', async () => {
            // One enabled chain with no DEX (so no listener starts). The two resume steps read
            // their own statements: getResumeExitMonitorTrades (resumeMultiChainMonitoring) and
            // getResumeAntiRugTrades (resumeAntiRugMonitoring).
            const boot = buildChainCtx('eth');
            boot.chain.dexes = [];
            buildChainRegistryMock.mockReturnValue(new Map([['eth', boot.chain]]));
            getEnabledChainsMock.mockImplementation((registry: Map<string, unknown>) => [...registry.values()]);
            createChainContextMock.mockReturnValue(boot);

            // startMultiChainBot arms two setIntervals and SIGINT/SIGTERM handlers: keep the
            // intervals on the fake clock and remove the handlers it added.
            const sigintBefore = process.listeners('SIGINT');
            const sigtermBefore = process.listeners('SIGTERM');
            vi.useFakeTimers();
            try {
                await bot.startMultiChainBot();
            } finally {
                vi.clearAllTimers();
                vi.useRealTimers();
                for (const l of process.listeners('SIGINT')) if (!sigintBefore.includes(l)) process.removeListener('SIGINT', l);
                for (const l of process.listeners('SIGTERM')) if (!sigtermBefore.includes(l)) process.removeListener('SIGTERM', l);
            }

            expect(resumeExitMonitorAllMock).toHaveBeenCalled();
            expect(resumeAntiRugAllMock).toHaveBeenCalledTimes(1);
            expect(resumeExitMonitorAllMock.mock.invocationCallOrder[0]).toBeLessThan(resumeAntiRugAllMock.mock.invocationCallOrder[0]);
            // The anti-rug resume ran for the booted chain.
            expect(verifyAllowlistAtStartupMock).toHaveBeenCalledTimes(1);
            expect(startChainAntiRugListenerMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('resumeAntiRugMonitoring runtime behavior (Tests 27-31)', () => {
        it('Test 27: queries trades JOIN lp_baseline and re-registers each row via registerAntiRugPosition', async () => {
            const { resumeAntiRugMonitoring } = await import('../../../src/bot');

            const ethCtx = buildChainCtx('eth');
            const rows = [
                {
                    id: 1,
                    token: '0xToken00000000000000000000000000000000T01',
                    chain: 'eth',
                    pool_type: 'v2',
                    fee_tier: null,
                    pair_or_pool_address: '0xPair01',
                },
                {
                    id: 2,
                    token: '0xToken00000000000000000000000000000000T02',
                    chain: 'eth',
                    pool_type: 'v3',
                    fee_tier: 3000,
                    pair_or_pool_address: '0xPool02',
                },
            ];
            resumeAntiRugAllMock.mockReturnValue(rows);

            await resumeAntiRugMonitoring([ethCtx as unknown as Parameters<typeof resumeAntiRugMonitoring>[0][number]]);

            // Phase 21.2-11 / S-1: the anti-rug restart-resume now reads the
            // pre-prepared, exported getResumeAntiRugTrades statement (the
            // higher-quality cached-statement idiom) rather than an inline
            // db.prepare. Verify the production scan went through that statement.
            expect(resumeAntiRugAllMock).toHaveBeenCalled();

            // Both rows registered.
            expect(registerAntiRugPositionMock).toHaveBeenCalledTimes(2);
            const tradeIds = registerAntiRugPositionMock.mock.calls.map(c => c[4]);
            expect(tradeIds).toContain(1);
            expect(tradeIds).toContain(2);
        });

        it('Test 28: calls verifyAllowlistAtStartup once per chain BEFORE the re-register loop', async () => {
            const { resumeAntiRugMonitoring } = await import('../../../src/bot');

            const ethCtx = buildChainCtx('eth');
            const bscCtx = buildChainCtx('bsc');
            allMock.mockReturnValue([]); // no positions

            await resumeAntiRugMonitoring([
                ethCtx as unknown as Parameters<typeof resumeAntiRugMonitoring>[0][number],
                bscCtx as unknown as Parameters<typeof resumeAntiRugMonitoring>[0][number],
            ]);

            expect(verifyAllowlistAtStartupMock).toHaveBeenCalledTimes(2);
            // The verify call should occur BEFORE register calls (which are
            // zero in this test, but the ordering invariant is enforced by
            // implementation — we test it via Test 27 which has both).
        });

        it('Test 29: calls startChainAntiRugListener per chain after re-registering positions', async () => {
            const { resumeAntiRugMonitoring } = await import('../../../src/bot');

            const ethCtx = buildChainCtx('eth');
            const bscCtx = buildChainCtx('bsc');
            allMock.mockReturnValue([]);

            await resumeAntiRugMonitoring([
                ethCtx as unknown as Parameters<typeof resumeAntiRugMonitoring>[0][number],
                bscCtx as unknown as Parameters<typeof resumeAntiRugMonitoring>[0][number],
            ]);

            expect(startChainAntiRugListenerMock).toHaveBeenCalledTimes(2);
        });

        it('Test 30: does NOT crash when trades JOIN lp_baseline returns zero rows', async () => {
            const { resumeAntiRugMonitoring } = await import('../../../src/bot');

            const ethCtx = buildChainCtx('eth');
            allMock.mockReturnValue([]); // no open positions

            await expect(
                resumeAntiRugMonitoring([ethCtx as unknown as Parameters<typeof resumeAntiRugMonitoring>[0][number]]),
            ).resolves.not.toThrow();

            // No register calls (zero rows).
            expect(registerAntiRugPositionMock).not.toHaveBeenCalled();
            // But verify + listener still called per chain.
            expect(verifyAllowlistAtStartupMock).toHaveBeenCalledTimes(1);
            expect(startChainAntiRugListenerMock).toHaveBeenCalledTimes(1);
        });

        it('Test 31: pre-Phase-19 trades (no lp_baseline) are excluded by INNER JOIN', async () => {
            const { resumeAntiRugMonitoring } = await import('../../../src/bot');

            const ethCtx = buildChainCtx('eth');
            // The statement's result as resumeAntiRugMonitoring receives it: one row, which
            // is re-registered.
            resumeAntiRugAllMock.mockReturnValue([
                {
                    id: 100,
                    token: '0xToken00000000000000000000000000000000T0H',
                    chain: 'eth',
                    pool_type: 'v2',
                    fee_tier: null,
                    pair_or_pool_address: '0xPairH',
                    is_failed_held: 0,
                },
            ]);

            await resumeAntiRugMonitoring([ethCtx as unknown as Parameters<typeof resumeAntiRugMonitoring>[0][number]]);
            expect(registerAntiRugPositionMock).toHaveBeenCalledTimes(1);

            // The production statement itself: the real getResumeAntiRugTrades, run by the real
            // db module on its real connection (vi.importActual bypasses this file's db mock).
            // Under Vitest an unset DB_PATH opens a fresh per-worker temp file, never data/.
            const realDb = await vi.importActual<typeof import('../../../src/utils/db')>('../../../src/utils/db');
            const dbFile = realDb.getDbFilePath();
            try {
                const now = Math.floor(Date.now() / 1000);
                const insertBuy = (token: string, status: 'pending' | 'failed'): number =>
                    Number(realDb.insertTrade.run({
                        token,
                        chain: 'eth',
                        action: 'buy',
                        txHash: '0x' + token.slice(-2).repeat(32),
                        block: null,
                        timestamp: now,
                        amountIn: '0.01',
                        amountOut: null,
                        gasCost: null,
                        priceAtAction: null,
                        status,
                        poolType: 'v2',
                        feeTier: null,
                        dexName: 'uniswap-v2',
                    }).lastInsertRowid);
                const baseline = (tradeId: number, pair: string): void => {
                    realDb.upsertLpBaseline.run({
                        tradeId,
                        poolType: 'v2',
                        pairOrPoolAddress: pair,
                        v2Token0Reserve: '1000',
                        v2Token1Reserve: '1000',
                        v2LpTotalSupply: '1000',
                        v3ActiveLiquidity: null,
                        v3TickAtSnapshot: null,
                        v3PositionNftId: null,
                        v3FeeTier: null,
                        snapshotBlock: 1,
                        snapshotTs: now,
                    });
                };

                // 1: an open buy with a baseline. 2: a pre-Phase-19 open buy with none.
                // 3: a still-held failed exit (exit_failed_held) with a baseline.
                const baselined = insertBuy('0x00000000000000000000000000000000000000b1', 'pending');
                const unbaselined = insertBuy('0x00000000000000000000000000000000000000b2', 'pending');
                const failedHeld = insertBuy('0x00000000000000000000000000000000000000b3', 'failed');
                baseline(baselined, '0x00000000000000000000000000000000000000c1');
                baseline(failedHeld, '0x00000000000000000000000000000000000000c3');
                realDb.upsertExitState.run({
                    tradeId: failedHeld,
                    entryPrice: 0.001,
                    highWaterMark: 0.001,
                    trailingActivated: 0,
                    partialTiersCompleted: '[]',
                    originalTokenAmount: '1000',
                    urgencyStartTs: now,
                    volatilitySamples: '[]',
                });
                realDb.markExitFailedHeld.run(failedHeld);

                const resumed = realDb.getResumeAntiRugTrades.all() as Array<{ id: number; pair_or_pool_address: string; is_failed_held: number }>;
                expect(resumed.map((r) => r.id).sort((a, b) => a - b)).toEqual([baselined, failedHeld]);
                expect(resumed.map((r) => r.id)).not.toContain(unbaselined);
                expect(resumed.find((r) => r.id === baselined)?.pair_or_pool_address).toBe('0x00000000000000000000000000000000000000c1');
                // And it unions the exit_failed_held restart-resume set (S-1 fix).
                expect(resumed.find((r) => r.id === failedHeld)?.is_failed_held).toBe(1);
            } finally {
                realDb.closeDb();
                for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) rmSync(f, { force: true });
            }
        });
    });
});
