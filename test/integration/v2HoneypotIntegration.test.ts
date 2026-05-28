// test/integration/v2HoneypotIntegration.test.ts
// Phase 18 plan 18-10 Task 2 — bot.ts V2 honeypot gate wiring tests.
//
// Verifies the in-place gate replacement at src/bot.ts handleNewPairForChain:
//   - simulateHoneypotRoundtrip is dispatched on every V2 candidate.
//   - verdict !== 'safe' triggers a *SKIP* alert + early-return (no buy tx).
//   - verdict === 'safe' allows the parallel-bank gates to run + buy.
//   - HONEY-12 parallel-bank 9th gate (isMutableTokenForChain) blocks the
//     buy when isMutable === true.
//
// Mock pattern: vi.doMock the honeypot wrapper + bytecodeScan + all parallel-
// bank safety functions + sendTxWithRetry + sendCtxAlert + db before dynamic-
// importing bot.ts (matches test/integration/v3LiquidityWait.test.ts pattern).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock infrastructure — captured fns referenced inside vi.doMock blocks below.
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

// Phase 20 / Plan 20-04 — pause-state mocks (hoisted to module scope so
// mockReset:true preserves the reference; impl re-armed in beforeEach).
const getPauseStateGetMock = vi.fn().mockReturnValue({ paused: 0 });
const setPauseStateRunMock = vi.fn();
const clearPauseStateRunMock = vi.fn();

const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();

// All safety-bank functions default to "happy path" so the path under test
// reaches the gate-under-test. Tests can override per-case via mockReturnValueOnce
// or by reassigning the resolved value before invoking the handler.
const checkHoneypotForChainMock = vi.fn().mockResolvedValue(false);
const isBlacklistedTokenForChainMock = vi.fn().mockResolvedValue(false);
const isLiquidityLockedForChainMock = vi.fn().mockResolvedValue(true);
const isLiquiditySufficientForChainMock = vi.fn().mockResolvedValue(true);
const checkTokenMetadataForChainMock = vi.fn().mockResolvedValue(true);
const simulateSwapForChainMock = vi.fn().mockResolvedValue(true);
// hasHighTransferTaxForChainMock removed (plan 21.1-03): the function it mocked
// was deleted from tokenSafety.ts. It was inert here anyway — the baseline was
// mockResolvedValue(false) (allow) and blocks are driven via simulateHoneypotRoundtripMock.
const hasMaxWalletOrTxLimitsForChainMock = vi.fn().mockResolvedValue(false);
const isKnownBadTokenForChainMock = vi.fn().mockResolvedValue(false);

// Mock ethers Contract: token contract returns minimal metadata; LP contract
// returns minimal reserves shape. The router contract is not invoked because
// sendTxWithRetry is mocked to a noop.
const tokenSymbolMock = vi.fn().mockResolvedValue('TEST');
const tokenNameMock = vi.fn().mockResolvedValue('Test Token');
const tokenDecimalsMock = vi.fn().mockResolvedValue(18);
const tokenBalanceOfMock = vi.fn().mockResolvedValue(1000000n);
const lpToken0Mock = vi.fn().mockResolvedValue('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
const lpGetReservesMock = vi
    .fn()
    .mockResolvedValue({ reserve0: 1000000000000000000n, reserve1: 1000000000000000000n });
const routerGetAmountsOutMock = vi.fn().mockResolvedValue([0n, 1000000n]);
const routerInterfaceEncodeMock = vi.fn().mockReturnValue('0xabcdef');

class MockContract {
    target: string;

    constructor(target: string) {
        this.target = target.toLowerCase();
    }

    // Token (ERC20) methods
    symbol = (...args: unknown[]) => tokenSymbolMock(...args);
    name = (...args: unknown[]) => tokenNameMock(...args);
    decimals = (...args: unknown[]) => tokenDecimalsMock(...args);
    balanceOf = (...args: unknown[]) => tokenBalanceOfMock(...args);

    // LP pair methods
    token0 = (...args: unknown[]) => lpToken0Mock(...args);
    getReserves = (...args: unknown[]) => lpGetReservesMock(...args);

    // Router methods
    getAmountsOut = (...args: unknown[]) => routerGetAmountsOutMock(...args);
    interface = { encodeFunctionData: routerInterfaceEncodeMock };
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
    // Legacy single-chain APIs (unused at the V2 path; still re-exported).
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
    // Chain-aware versions used by handleNewPairForChain.
    checkHoneypotForChain: checkHoneypotForChainMock,
    isLiquidityLockedForChain: isLiquidityLockedForChainMock,
    simulateSwapForChain: simulateSwapForChainMock,
    isLiquiditySufficientForChain: isLiquiditySufficientForChainMock,
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
        // Phase 20 / Plan 20-04 — bot.ts now imports getPauseState/setPauseState
        // for killswitch CP1/CP2/CP3 + mid-run wallet undercut. Default returns
        // paused=0 so the buy path proceeds; tests that need pause behavior
        // override on a per-test basis. Hoisted to module scope so the
        // mockReset:true in vitest.config.ts preserves the reference.
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
const PAIR_ADDR = '0x000000000000000000000000000000000000beef';
const ROUTER_ADDR = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

const v2Dex = {
    dexType: 'v2' as const,
    name: 'uniswap-v2',
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    routerAddress: ROUTER_ADDR,
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
            // guaranteed exit just before the buy submit.
            gas: { type: 'eip1559', multiplier: 1.2, maxGasLimit: 300_000n },
            mevStrategy: 'flashbots',
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

describe('Phase 18 plan 18-10 — bot.ts V2 honeypot gate wiring (HONEY-07 + HONEY-12)', () => {
    beforeEach(() => {
        vi.resetModules();
        // vitest.config.ts has mockReset: true on the integration project, which
        // wipes mockReturnValue / mockResolvedValue on every vi.fn() before each
        // test. Re-establish the happy-path defaults here so the path-under-test
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
        // Safety-bank function mocks need re-establishing too.
        checkHoneypotForChainMock.mockReset().mockResolvedValue(false);
        isBlacklistedTokenForChainMock.mockReset().mockResolvedValue(false);
        isLiquidityLockedForChainMock.mockReset().mockResolvedValue(true);
        isLiquiditySufficientForChainMock.mockReset().mockResolvedValue(true);
        checkTokenMetadataForChainMock.mockReset().mockResolvedValue(true);
        simulateSwapForChainMock.mockReset().mockResolvedValue(true);
        hasMaxWalletOrTxLimitsForChainMock.mockReset().mockResolvedValue(false);
        isKnownBadTokenForChainMock.mockReset().mockResolvedValue(false);
        // Mock contract method mocks too.
        tokenSymbolMock.mockReset().mockResolvedValue('TEST');
        tokenNameMock.mockReset().mockResolvedValue('Test Token');
        tokenDecimalsMock.mockReset().mockResolvedValue(18);
        tokenBalanceOfMock.mockReset().mockResolvedValue(1000000n);
        lpToken0Mock.mockReset().mockResolvedValue('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
        lpGetReservesMock.mockReset().mockResolvedValue({ reserve0: 1000000000000000000n, reserve1: 1000000000000000000n });
        routerGetAmountsOutMock.mockReset().mockResolvedValue([0n, 1000000n]);
        routerInterfaceEncodeMock.mockReset().mockReturnValue('0xabcdef');
        loggerInfoMock.mockReset();
        loggerWarnMock.mockReset();
        loggerErrorMock.mockReset();
    });

    it('Test 1: V2 simulateHoneypotRoundtrip returns unsafe → *SKIP* alert sent + sendTxWithRetry NOT called', async () => {
        simulateHoneypotRoundtripMock.mockResolvedValue({
            verdict: 'unsafe',
            reason: 'BUY_BAL_ZERO',
            evidence: {
                method: 'on-chain-contract',
                dexType: 'v2',
                buyTaxBps: 100,
                sellTaxBps: 100,
            },
        });

        const bot = await import('../../src/bot');
        const ctx = makeMockCtx() as unknown as Parameters<typeof bot.handleNewPairForChain>[0];

        await bot.handleNewPairForChain(ctx, v2Dex, WETH_ADDR, TARGET_TOKEN, PAIR_ADDR);

        // Dispatch was invoked on the V2 path with the V2 dex.
        expect(simulateHoneypotRoundtripMock).toHaveBeenCalledWith(
            expect.anything(),
            v2Dex,
            TARGET_TOKEN,
        );

        // *SKIP* tiered alert was sent (D-ALERTS).
        const skipAlertCalls = sendCtxAlertMock.mock.calls.filter((c) =>
            typeof c[1] === 'string' && c[1].includes('*SKIP*'),
        );
        expect(skipAlertCalls.length).toBeGreaterThan(0);

        // sendTxWithRetry was NEVER called — the gate blocked the buy.
        expect(sendTxWithRetryMock).not.toHaveBeenCalled();
    });

    it('Test 2: V2 simulateHoneypotRoundtrip returns safe + safety bank clean → sendTxWithRetry IS called', async () => {
        simulateHoneypotRoundtripMock.mockResolvedValue({
            verdict: 'safe',
            evidence: {
                method: 'on-chain-contract',
                dexType: 'v2',
                buyTaxBps: 100,
                sellTaxBps: 100,
            },
        });

        const bot = await import('../../src/bot');
        const ctx = makeMockCtx() as unknown as Parameters<typeof bot.handleNewPairForChain>[0];

        await bot.handleNewPairForChain(ctx, v2Dex, WETH_ADDR, TARGET_TOKEN, PAIR_ADDR);

        // Dispatch was invoked.
        expect(simulateHoneypotRoundtripMock).toHaveBeenCalled();

        // sendTxWithRetry WAS called — the buy proceeded.
        expect(sendTxWithRetryMock).toHaveBeenCalled();
    });

    it('Test 5 (HONEY-12 parallel-bank): isMutableTokenForChain returns isMutable=true → buy blocked', async () => {
        // Honeypot roundtrip says safe — only the HONEY-12 9th gate should block.
        simulateHoneypotRoundtripMock.mockResolvedValue({
            verdict: 'safe',
            evidence: {
                method: 'on-chain-contract',
                dexType: 'v2',
                buyTaxBps: 100,
                sellTaxBps: 100,
            },
        });

        isMutableTokenForChainMock.mockReset().mockResolvedValue({
            isMutable: true,
            hits: ['2e5bb6ff'],
        });

        const bot = await import('../../src/bot');
        const ctx = makeMockCtx() as unknown as Parameters<typeof bot.handleNewPairForChain>[0];

        await bot.handleNewPairForChain(ctx, v2Dex, WETH_ADDR, TARGET_TOKEN, PAIR_ADDR);

        // HONEY-12 gate was invoked as part of the parallel safety bank.
        expect(isMutableTokenForChainMock).toHaveBeenCalledWith(
            expect.anything(),
            TARGET_TOKEN,
        );

        // The "Safety checks failed" log was emitted with mutable=true + mutableHits.
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

        // sendTxWithRetry was NEVER called — the parallel-bank conjunction blocked the buy.
        expect(sendTxWithRetryMock).not.toHaveBeenCalled();
    });
});
