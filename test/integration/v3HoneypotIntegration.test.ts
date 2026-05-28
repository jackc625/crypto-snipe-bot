// test/integration/v3HoneypotIntegration.test.ts
// Phase 18 plan 18-10 Task 2 — bot.ts V3 honeypot gate wiring tests.
//
// Verifies the in-place gate replacement at src/bot.ts handleNewV3PoolForChain:
//   - simulateHoneypotRoundtrip is dispatched on every V3 candidate WITH the
//     runtime feeTier (iter-2 Blocker #1 — replaces the vacuous-pass
//     simulateSellV3ForChain that returned `true` on zero balance).
//   - V3 unsafe path → *SKIP* alert + early-return (no buy tx).
//   - V3 safe path → sendTxWithRetry IS called (V3 paths ACTIVELY reach
//     'safe' / 'unsafe' verdicts now, not just 'unknown' — this is the
//     KEY change from iter-1).
//   - HONEY-12 parallel-bank 6th gate (isMutableTokenForChain) blocks V3
//     buys when isMutable === true.
//
// Mock pattern: same as v2HoneypotIntegration.test.ts. V3 mocks ADD a
// waitForLiquidity bypass + checkMinLiquidity bypass via mocking ethers
// Contract.staticCall on the quoter, and skip the isLiquidityLockedForChain
// path since V3 has no pair address.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

const simulateHoneypotRoundtripMock = vi.fn();
const isMutableTokenForChainMock = vi.fn();
const sendTxWithRetryMock = vi.fn().mockResolvedValue(undefined);
const sendCtxAlertMock = vi.fn().mockResolvedValue(undefined);
const canSnipeMock = vi.fn().mockReturnValue({ allowed: true });
const recordSnipeMock = vi.fn();
const insertTradeRunMock = vi.fn();
const updateTradeStatusRunMock = vi.fn();
const isTokenSnipedGetMock = vi.fn().mockReturnValue(undefined);
const getTradeIdForPendingTokenGetMock = vi
    .fn()
    .mockReturnValue({ id: 1 });
const startExitMonitorMock = vi.fn().mockResolvedValue(undefined);

// Phase 20 / Plan 20-04 — pause-state mocks hoisted to module scope.
const getPauseStateGetMock = vi.fn().mockReturnValue({ paused: 0 });
const setPauseStateRunMock = vi.fn();
const clearPauseStateRunMock = vi.fn();

const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();

// V3 path uses 5 chain-aware safety functions (no pair-lock / liquidity-sufficient).
const checkHoneypotForChainMock = vi.fn().mockResolvedValue(false);
const isBlacklistedTokenForChainMock = vi.fn().mockResolvedValue(false);
const checkTokenMetadataForChainMock = vi.fn().mockResolvedValue(true);
// hasHighTransferTaxForChainMock removed (plan 21.1-03): the function it mocked
// was deleted from tokenSafety.ts. It was inert here anyway — the baseline was
// mockResolvedValue(false) (allow) and blocks are driven via simulateHoneypotRoundtripMock.
const hasMaxWalletOrTxLimitsForChainMock = vi.fn().mockResolvedValue(false);
const isKnownBadTokenForChainMock = vi.fn().mockResolvedValue(false);

// ethers Contract mock — V3 path invokes the QuoterV2 staticCall for
// checkMinLiquidity + slippage calculation, plus the pool subscription
// for waitForLiquidity. We feed positive responses across the board so
// the path reaches the gate-under-test.
const tokenSymbolMock = vi.fn().mockResolvedValue('V3TEST');
const tokenNameMock = vi.fn().mockResolvedValue('V3 Test Token');
const tokenDecimalsMock = vi.fn().mockResolvedValue(18);
const tokenBalanceOfMock = vi.fn().mockResolvedValue(1000000n);

// V3 pool's queryFilter is called for same-block Mint detection at line 99
// of src/bot.ts waitForLiquidity. Return a non-empty result so liquidity
// is "found in same block" and we proceed without the 30s timeout.
const poolQueryFilterMock = vi
    .fn()
    .mockResolvedValue([{ blockNumber: 12345678 }]);
const poolFiltersMintMock = vi.fn().mockReturnValue({});

// V3 quoter staticCall — checkMinLiquidity at src/bot.ts:145 + 155.
const quoteExactInputSingleStaticCallMock = vi
    .fn()
    .mockResolvedValue([1000000n]);

class MockContract {
    target: string;

    constructor(target: string) {
        this.target = target.toLowerCase();
    }

    // ERC20
    symbol = (...args: unknown[]) => tokenSymbolMock(...args);
    name = (...args: unknown[]) => tokenNameMock(...args);
    decimals = (...args: unknown[]) => tokenDecimalsMock(...args);
    balanceOf = (...args: unknown[]) => tokenBalanceOfMock(...args);

    // V3 pool
    filters = { Mint: poolFiltersMintMock };
    queryFilter = (...args: unknown[]) => poolQueryFilterMock(...args);
    on = vi.fn();
    removeAllListeners = vi.fn();

    // V3 router / quoter via .interface + .quoteExactInputSingle
    interface = {
        encodeFunctionData: vi.fn().mockReturnValue('0xabcdef'),
    };
    quoteExactInputSingle = {
        staticCall: (...args: unknown[]) => quoteExactInputSingleStaticCallMock(...args),
    };
}

vi.doMock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    return { ...actual, Contract: MockContract };
});

vi.doMock('../../src/utils/honeypot', () => ({
    simulateHoneypotRoundtrip: simulateHoneypotRoundtripMock,
}));

vi.doMock('../../src/utils/honeypot/bytecodeScan', () => ({
    isMutableTokenForChain: isMutableTokenForChainMock,
}));

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
    // Chain-aware
    checkHoneypotForChain: checkHoneypotForChainMock,
    isLiquidityLockedForChain: vi.fn().mockResolvedValue(true),
    simulateSwapForChain: vi.fn().mockResolvedValue(true),
    isLiquiditySufficientForChain: vi.fn().mockResolvedValue(true),
    isKnownBadTokenForChain: isKnownBadTokenForChainMock,
    checkTokenMetadataForChain: checkTokenMetadataForChainMock,
    hasMaxWalletOrTxLimitsForChain: hasMaxWalletOrTxLimitsForChainMock,
    isBlacklistedTokenForChain: isBlacklistedTokenForChainMock,
}));

vi.doMock('../../src/utils/notifier', () => ({
    sendCtxAlert: sendCtxAlertMock,
    sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
    sendChainAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.doMock('../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
    createMevStrategy: vi.fn().mockReturnValue({ healthCheck: vi.fn().mockResolvedValue(true) }),
}));

vi.doMock('../../src/riskManager', () => ({
    canSnipe: canSnipeMock,
    recordSnipe: recordSnipeMock,
}));

vi.doMock('../../src/exitEngine', () => ({
    startExitMonitor: startExitMonitorMock,
    resumeExitMonitor: vi.fn().mockResolvedValue(undefined),
}));

vi.doMock('../../src/utils/db', () => {
    const stmt = { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
    return {
        db: {
            prepare: vi.fn().mockReturnValue(stmt),
            pragma: vi.fn(),
            exec: vi.fn(),
            transaction: vi.fn().mockImplementation((fn: unknown) => fn),
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
        closeDb: vi.fn(),
        // Phase 20 / Plan 20-04 — pause-state references hoisted to module scope.
        getPauseState: { get: getPauseStateGetMock },
        setPauseState: { run: setPauseStateRunMock },
        clearPauseState: { run: clearPauseStateRunMock },
        upsertLpBaseline: { run: vi.fn() },
        getLpBaseline: { get: vi.fn() },
        deleteLpBaseline: { run: vi.fn() },
        upsertChainState: { run: vi.fn() },
        getChainState: { get: vi.fn() },
        setAntirugDryRunStarted: { run: vi.fn() },
        getAntirugDryRunStarted: { get: vi.fn().mockReturnValue({ antirug_dry_run_started: null }) },
    };
});

vi.doMock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: loggerInfoMock,
            warn: loggerWarnMock,
            debug: vi.fn(),
            error: loggerErrorMock,
            fatal: vi.fn(),
        }),
        info: loggerInfoMock,
        warn: loggerWarnMock,
    },
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TARGET_TOKEN = '0x000000000000000000000000000000000000abcd';
const WETH_ADDR = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const POOL_ADDR = '0x000000000000000000000000000000000000beef';
const SWAP_ROUTER_ADDR = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
const QUOTER_ADDR = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
const FEE_TIER = 3000;
const BLOCK_NUMBER = 12345678;

const v3Dex = {
    dexType: 'v3' as const,
    name: 'uniswap-v3',
    factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    swapRouterAddress: SWAP_ROUTER_ADDR,
    quoterAddress: QUOTER_ADDR,
};

function makeMockCtx() {
    return {
        chain: {
            name: 'eth',
            displayName: '[ETH]',
            chainId: 1,
            nativeCurrency: 'ETH',
            wethAddress: WETH_ADDR,
            explorerUrl: 'https://etherscan.io',
            snipeAmount: '0.003',
            maxCapital: '1.0',
            gasBuffer: '0.005',
            // ETH chain template (chainRegistry.ts:204 / test/fixtures/chainConfig.ts:62).
            // Required by the Plan 21.2-08 buy-time entry affordability gate, which
            // reads chain.gas.maxGasLimit + chain.gasBuffer to price the worst-case
            // guaranteed exit just before the V3 buy submit.
            gas: { type: 'eip1559', multiplier: 1.2, maxGasLimit: 300_000n },
            mevStrategy: 'flashbots',
            minLiquidityThreshold: '0.5',
            honeypotChecker: {
                method: 'on-chain-contract',
                deployedAddress: '0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD',
                maxBuyTaxBps: 1000,
                maxSellTaxBps: 1000,
            },
        },
        // The entry affordability gate reads getBalance + getFeeData off
        // ctx.httpProvider. 1 ETH clears the floor (snipe 0.003 + worst-case
        // buy/sell gas + 0.005 cushion ≈ 0.025 ETH); 30/10 gwei → 20 gwei base fee.
        httpProvider: {
            getBalance: vi.fn().mockResolvedValue(1000000000000000000n),
            getFeeData: vi.fn().mockResolvedValue({
                maxFeePerGas: 30000000000n,
                maxPriorityFeePerGas: 10000000000n,
                gasPrice: 30000000000n,
            }),
        } as unknown,
        wsProvider: null,
        wallet: {
            address: '0x000000000000000000000000000000000000beef',
            populateTransaction: vi.fn().mockResolvedValue({}),
        },
        log: {
            info: loggerInfoMock,
            warn: loggerWarnMock,
            debug: vi.fn(),
            error: loggerErrorMock,
            fatal: vi.fn(),
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 18 plan 18-10 — bot.ts V3 honeypot gate wiring (HONEY-08 + HONEY-12 — iter-2 Blocker #1)', () => {
    beforeEach(() => {
        vi.resetModules();
        // vitest.config.ts has mockReset: true on the integration project,
        // which wipes mockReturnValue / mockResolvedValue on every vi.fn()
        // before each test. Re-establish defaults so the path-under-test
        // reaches the gate-under-test.
        simulateHoneypotRoundtripMock.mockReset();
        isMutableTokenForChainMock.mockReset().mockResolvedValue({ isMutable: false, hits: [] });
        sendTxWithRetryMock.mockReset().mockResolvedValue(undefined);
        sendCtxAlertMock.mockReset().mockResolvedValue(undefined);
        canSnipeMock.mockReset().mockReturnValue({ allowed: true });
        recordSnipeMock.mockReset();
        insertTradeRunMock.mockReset();
        updateTradeStatusRunMock.mockReset();
        isTokenSnipedGetMock.mockReset().mockReturnValue(undefined);
        getTradeIdForPendingTokenGetMock.mockReset().mockReturnValue({ id: 1 });
        startExitMonitorMock.mockReset().mockResolvedValue(undefined);
        getPauseStateGetMock.mockReset().mockReturnValue({ paused: 0 });
        setPauseStateRunMock.mockReset();
        clearPauseStateRunMock.mockReset();
        checkHoneypotForChainMock.mockReset().mockResolvedValue(false);
        isBlacklistedTokenForChainMock.mockReset().mockResolvedValue(false);
        checkTokenMetadataForChainMock.mockReset().mockResolvedValue(true);
        hasMaxWalletOrTxLimitsForChainMock.mockReset().mockResolvedValue(false);
        isKnownBadTokenForChainMock.mockReset().mockResolvedValue(false);
        tokenSymbolMock.mockReset().mockResolvedValue('V3TEST');
        tokenNameMock.mockReset().mockResolvedValue('V3 Test Token');
        tokenDecimalsMock.mockReset().mockResolvedValue(18);
        tokenBalanceOfMock.mockReset().mockResolvedValue(1000000n);
        loggerInfoMock.mockReset();
        loggerWarnMock.mockReset();
        loggerErrorMock.mockReset();
        // Reset the V3-flow mocks to happy-path defaults.
        poolQueryFilterMock.mockReset().mockResolvedValue([{ blockNumber: BLOCK_NUMBER }]);
        poolFiltersMintMock.mockReset().mockReturnValue({});
        quoteExactInputSingleStaticCallMock.mockReset().mockResolvedValue([1000000n]);
    });

    it('Test 3 (iter-2 Blocker #1): V3 honeypot fixture → verdict unsafe → dispatch invoked WITH feeTier + skip', async () => {
        simulateHoneypotRoundtripMock.mockResolvedValue({
            verdict: 'unsafe',
            reason: 'V3_SELL_WETH_ZERO',
            evidence: {
                method: 'on-chain-contract',
                dexType: 'v3',
                buyTaxBps: 100,
                sellTaxBps: 100,
            },
        });

        const bot = await import('../../src/bot');
        const ctx = makeMockCtx() as unknown as Parameters<typeof bot.handleNewV3PoolForChain>[0];

        await bot.handleNewV3PoolForChain(
            ctx,
            v3Dex,
            WETH_ADDR,
            TARGET_TOKEN,
            FEE_TIER,
            POOL_ADDR,
            BLOCK_NUMBER,
        );

        // CRITICAL — iter-2 Blocker #1: V3 dispatch is invoked with feeTier as
        // the 4th argument. This drives simulateViaContractV3's checkV3 calldata.
        expect(simulateHoneypotRoundtripMock).toHaveBeenCalledWith(
            expect.anything(),
            v3Dex,
            TARGET_TOKEN,
            FEE_TIER,
        );

        // V3 honeypot fixture → unsafe → *SKIP* tiered alert sent.
        const skipAlertCalls = sendCtxAlertMock.mock.calls.filter((c) =>
            typeof c[1] === 'string' && c[1].includes('*SKIP*'),
        );
        expect(skipAlertCalls.length).toBeGreaterThan(0);

        // Buy was blocked — V3 dispatch path correctly fails closed on V3 honeypots.
        expect(sendTxWithRetryMock).not.toHaveBeenCalled();
    });

    it('Test 4 (iter-2 Blocker #1): V3 known-good token → verdict safe → dispatch invoked WITH feeTier + buy proceeds', async () => {
        simulateHoneypotRoundtripMock.mockResolvedValue({
            verdict: 'safe',
            evidence: {
                method: 'on-chain-contract',
                dexType: 'v3',
                buyTaxBps: 100,
                sellTaxBps: 100,
            },
        });

        const bot = await import('../../src/bot');
        const ctx = makeMockCtx() as unknown as Parameters<typeof bot.handleNewV3PoolForChain>[0];

        await bot.handleNewV3PoolForChain(
            ctx,
            v3Dex,
            WETH_ADDR,
            TARGET_TOKEN,
            FEE_TIER,
            POOL_ADDR,
            BLOCK_NUMBER,
        );

        // V3 dispatch invocation includes feeTier — proves iter-2 Blocker #1 wiring.
        expect(simulateHoneypotRoundtripMock).toHaveBeenCalledWith(
            expect.anything(),
            v3Dex,
            TARGET_TOKEN,
            FEE_TIER,
        );

        // V3 safe path → buy proceeds. This is the KEY iter-2 Blocker #1 change:
        // V3 paths are no longer perpetually 'unknown'-skipped. They actively
        // reach 'safe' verdicts via plan 18-09's real simulateViaContractV3.
        expect(sendTxWithRetryMock).toHaveBeenCalled();
    });

    it('Test 5 (HONEY-12 parallel-bank V3): isMutableTokenForChain returns isMutable=true → buy blocked on V3 path', async () => {
        simulateHoneypotRoundtripMock.mockResolvedValue({
            verdict: 'safe',
            evidence: {
                method: 'on-chain-contract',
                dexType: 'v3',
                buyTaxBps: 100,
                sellTaxBps: 100,
            },
        });

        isMutableTokenForChainMock.mockReset().mockResolvedValue({
            isMutable: true,
            hits: ['2e5bb6ff'],
        });

        const bot = await import('../../src/bot');
        const ctx = makeMockCtx() as unknown as Parameters<typeof bot.handleNewV3PoolForChain>[0];

        await bot.handleNewV3PoolForChain(
            ctx,
            v3Dex,
            WETH_ADDR,
            TARGET_TOKEN,
            FEE_TIER,
            POOL_ADDR,
            BLOCK_NUMBER,
        );

        // HONEY-12 gate was invoked on the V3 path.
        expect(isMutableTokenForChainMock).toHaveBeenCalledWith(
            expect.anything(),
            TARGET_TOKEN,
        );

        // The V3 "Safety checks failed, skipping V3 snipe" log was emitted with
        // mutable=true + mutableHits, proving the 6th-gate parallel-bank V3
        // conjunction blocks the buy.
        const blockedLog = loggerInfoMock.mock.calls.find((c) => {
            const arg = c[0];
            return (
                arg &&
                typeof arg === 'object' &&
                arg !== null &&
                'checks' in arg &&
                (arg as { checks: { mutable?: boolean } }).checks.mutable === true
            );
        });
        expect(blockedLog).toBeDefined();
        const checks = (blockedLog![0] as { checks: { mutable: boolean; mutableHits: string[] } })
            .checks;
        expect(checks.mutable).toBe(true);
        expect(checks.mutableHits).toEqual(['2e5bb6ff']);

        // sendTxWithRetry was NEVER called — HONEY-12 6th-gate V3 conjunction blocked the buy.
        expect(sendTxWithRetryMock).not.toHaveBeenCalled();
    });
});
