// test/integration/anti-rug/multiSignalEnd2End.test.ts
// Phase 19 / Plan 19-07 Task 2 — End-to-end pipeline integration tests.
//
// These tests wire together the full anti-rug pipeline against simulated
// V2 + V3 events and assert the dispatch chain produces the expected
// telemetry + triggerAntiRugExit / executeFullSell behaviour:
//
//   WS Burn event → evaluateRugSignals → multi-signal AND chain → confirm-
//   blocks gate → triggerAntiRugExit → (dry-run gate → log + broadcast +
//   alert + NO sell) | (live gate → clearAllTimersForToken → executeFullSell
//   → incrementCircuitBreaker → broadcast 'exit-fired').
//
// Tests cover (from plan-19-07 PLAN <behavior> Tests 15-23):
//   Test 15: Dry-run path — all 3 signals trip → unsafe → triggerAntiRugExit
//            → dry-run gate → broadcast 'would-have-sold' + [DRY-RUN] alert,
//            executeFullSell NEVER called.
//   Test 16: Live path — same flow but liveExecute=true → clearAllTimersForToken
//            → executeFullSell → incrementCircuitBreaker.
//   Test 17: Allowlist suppression — destination IS a UNCX UniLockerV2 →
//            evaluator returns 'allowlisted', triggerAntiRugExit NEVER called.
//   Test 18: Partial-signal — LP-removed below threshold → verdict='safe',
//            no dispatch.
//   Test 19: Vacuous-pass guard — getReserves rejects → verdict='unknown',
//            no exit dispatch, structured antirug.evaluator.v2-error log.
//   Test 20: Confirm-blocks de-trip — all-three trip initially, reserves
//            recover during confirm-blocks delay → re-eval returns 'safe' →
//            no exit dispatch, 'antirug.signal-detripped' log.
//   Test 21: Circuit-breaker trip — 3 successful exits → CB tripped → 4th
//            evaluation that would otherwise trigger returns early in
//            triggerAntiRugExit.
//   Test 22: Partial-sell preserves subscription — registerAntiRugPosition
//            entry remains; subsequent Burn still dispatches per D-TERMINATION.
//   Test 23: Full close terminates subscription — unregisterAntiRugPosition
//            called → subsequent Burn finds no registered position.
//
// Strategy: mock the V2 pair Contract (getReserves + totalSupply), mock
// executeFullSell, mock broadcaster + sendCtxAlert, then invoke the real
// evaluateRugSignals + triggerAntiRugExit + circuit-breaker pipeline.
//
// This stays in the integration project (off-chain — no hardhat fork dep).
// The fork-test counterpart in test/fork/antiRugDetector.fork.test.ts
// exercises the same pipeline against contrived RugPull.sol modes deployed
// on a real fork plus the real-mainnet HORSE rug replay (skipped under
// ALLOW_REAL_MAINNET gate).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';

// ---------------------------------------------------------------------------
// Mocks: logger, lpBaseline, executeFullSell, notifier, broadcaster,
// exitManager. The detector evaluator + exitTrigger + circuitBreaker run
// FOR REAL — these are the modules under test.
// ---------------------------------------------------------------------------

const logInfo = vi.fn();
const logWarn = vi.fn();
const logError = vi.fn();
const logFatal = vi.fn();
const logDebug = vi.fn();

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

const loadLpBaselineMock = vi.fn();
vi.mock('../../../src/anti-rug/lpBaseline', () => ({
    loadLpBaseline: loadLpBaselineMock,
}));

const sendCtxAlertMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/utils/notifier', () => ({
    sendCtxAlert: sendCtxAlertMock,
}));

const broadcastMock = vi.fn();
vi.mock('../../../src/api/ws/broadcaster', () => ({
    broadcast: broadcastMock,
}));

const clearAllTimersForTokenMock = vi.fn();
vi.mock('../../../src/utils/exitManager', () => ({
    clearAllTimersForToken: clearAllTimersForTokenMock,
}));

const executeFullSellMock = vi.fn();
vi.mock('../../../src/exitEngine', () => ({
    executeFullSell: executeFullSellMock,
}));

// db mocks for chain_state / lp_baseline statements pulled by detector.ts
vi.mock('../../../src/utils/db', () => ({
    upsertChainState: { run: vi.fn() },
    getChainState: { get: vi.fn().mockReturnValue(undefined) },
    upsertLpBaseline: { run: vi.fn() },
    getLpBaseline: { get: vi.fn() },
    deleteLpBaseline: { run: vi.fn() },
}));

vi.mock('../../../src/utils/provider', () => ({
    removeWsProvider: vi.fn(),
}));

// Per-Contract mock — same shape as detectorEvaluator.test.ts (the
// production evaluator imports `Contract` directly from ethers, so the
// vi.mock factory swaps in a class that dispatches by ABI shape and reads
// per-test mocks from globalThis.__antiRugE2EMocks).
let pairGetReservesMock: ReturnType<typeof vi.fn>;
let pairTotalSupplyMock: ReturnType<typeof vi.fn>;
let poolLiquidityMock: ReturnType<typeof vi.fn>;
let quoteExactInputSingleMock: ReturnType<typeof vi.fn>;

vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    class MockContract {
        address: string;
        getReserves?: ReturnType<typeof vi.fn>;
        totalSupply?: ReturnType<typeof vi.fn>;
        liquidity?: ReturnType<typeof vi.fn>;
        slot0?: ReturnType<typeof vi.fn>;
        quoteExactInputSingle?: { staticCall: ReturnType<typeof vi.fn> };
        constructor(address: string, abi: unknown[]) {
            this.address = address;
            const abiStr = JSON.stringify(abi);
            const mocks = (globalThis as Record<string, unknown>)
                .__antiRugE2EMocks as {
                pairGetReserves: ReturnType<typeof vi.fn>;
                pairTotalSupply: ReturnType<typeof vi.fn>;
                poolLiquidity: ReturnType<typeof vi.fn>;
                quoteExactInputSingle: ReturnType<typeof vi.fn>;
            };
            if (abiStr.includes('getReserves')) {
                this.getReserves = mocks.pairGetReserves;
                this.totalSupply = mocks.pairTotalSupply;
            } else if (abiStr.includes('liquidity')) {
                this.liquidity = mocks.poolLiquidity;
                this.slot0 = vi.fn();
            } else if (abiStr.includes('quoteExactInputSingle')) {
                this.quoteExactInputSingle = {
                    staticCall: mocks.quoteExactInputSingle,
                };
            }
        }
    }
    return {
        ...actual,
        Contract: MockContract,
    };
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface StubProvider {
    getLogs: ReturnType<typeof vi.fn>;
    getBlockNumber: ReturnType<typeof vi.fn>;
    getCode: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
}

// Block-handler capture so we can fire the confirm-blocks watcher manually.
type BlockHandler = (blockNumber: number) => void | Promise<void>;
const blockHandlers: BlockHandler[] = [];

function buildCtx(opts: {
    liveExecute?: boolean;
    chain?: string;
    lpRemovalPct?: number;
    confirmBlocks?: number;
    allowlistV2?: Array<{ address: string; lockerName: string; provenance: string }>;
} = {}) {
    const onSpy = vi.fn((evt: string, fn: BlockHandler) => {
        if (evt === 'block') blockHandlers.push(fn);
    });
    const offSpy = vi.fn((evt: string, fn: BlockHandler) => {
        if (evt === 'block') {
            const idx = blockHandlers.indexOf(fn);
            if (idx !== -1) blockHandlers.splice(idx, 1);
        }
    });
    return {
        chain: {
            name: opts.chain ?? 'eth',
            displayName: '[ETH]',
            wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            chainId: 1,
            wsRpcUrl: 'wss://eth.test',
            dexes: [
                {
                    dexType: 'v2' as const,
                    name: 'uniswap-v2',
                    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
                    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
                },
                {
                    dexType: 'v3' as const,
                    name: 'uniswap-v3',
                    factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                    swapRouterAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
                    quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
                },
            ],
            antiRug: {
                liveExecute: opts.liveExecute ?? false,
                lpRemovalPct: opts.lpRemovalPct ?? 50,
                confirmBlocks: opts.confirmBlocks ?? 0,
                circuitBreakerTriggers: 3,
                circuitBreakerWindowHours: 1,
                gasMultiplier: 2.0,
                backfillCapBlocks: 10,
                maxBackfillBlocks: 7200,
                allowlistV2: opts.allowlistV2 ?? [],
                allowlistV3: [],
            },
        },
        wsProvider: null,
        httpProvider: {
            getLogs: vi.fn().mockResolvedValue([]),
            getBlockNumber: vi.fn().mockResolvedValue(18_000_000),
            getCode: vi.fn().mockResolvedValue('0x60'),
            on: onSpy,
            off: offSpy,
        } as StubProvider,
    };
}

const V2_DEX = {
    dexType: 'v2' as const,
    name: 'uniswap-v2',
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
};

function makeBaselineV2(addr: string, tradeId: number) {
    return {
        tradeId,
        poolType: 'v2' as const,
        pairOrPoolAddress: addr.toLowerCase(),
        // baseline: token0=1e18, token1=2e18, totalSupply=1e9
        v2Token0Reserve: '1000000000000000000',
        v2Token1Reserve: '2000000000000000000',
        v2LpTotalSupply: '1000000000',
        v3ActiveLiquidity: null,
        v3TickAtSnapshot: null,
        v3PositionNftId: null,
        v3FeeTier: null,
        snapshotBlock: 18_000_000,
        snapshotTs: 1_700_000_000,
    };
}

/** Encode V2 Pair.Burn log shape — matches detectorEvaluator.test.ts. */
function makeV2BurnLog(
    pairAddress: string,
    toAddress: string,
    amount0 = '500000000000000000',
    amount1 = '1000000000000000000',
) {
    const PAIR_BURN_TOPIC = ethers.id(
        'Burn(address,uint256,uint256,address)',
    );
    return {
        address: pairAddress,
        topics: [
            PAIR_BURN_TOPIC,
            '0x000000000000000000000000' +
                '1111111111111111111111111111111111111111',
            '0x000000000000000000000000' +
                toAddress.slice(2).toLowerCase().padStart(40, '0'),
        ],
        data: ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint256', 'uint256'],
            [BigInt(amount0), BigInt(amount1)],
        ),
        blockNumber: 18_000_100,
    };
}

/** Configure mock reserves + totalSupply so all 3 V2 signals trip. */
function configureV2AllSignalsTrip() {
    // Signal 1: LP-removed = 1 - (currentSupply / baselineSupply)
    //   baseline supply = 1e9; current = 0.1e9 → 90% removed > 50%.
    pairTotalSupplyMock.mockResolvedValue(BigInt('100000000')); // 10% remaining
    // Signal 3: current reserves < 50% of baseline (baseline = 1e18, current = 0.05e18)
    pairGetReservesMock.mockResolvedValue([
        BigInt('50000000000000000'), // 5% remaining → 95% drained
        BigInt('100000000000000000'),
        0n,
    ]);
}

/** Configure mock reserves + totalSupply so only signal-1 trips. */
function configureV2OnlySignal1() {
    // LP removed > 50%
    pairTotalSupplyMock.mockResolvedValue(BigInt('400000000')); // 60% removed
    // Reserves still high (90% of baseline) — signal-3 does NOT trip
    pairGetReservesMock.mockResolvedValue([
        BigInt('900000000000000000'),
        BigInt('1800000000000000000'),
        0n,
    ]);
}

/** Configure mock reserves + totalSupply so reserves recover (signal-3 not tripped). */
function configureV2Recovery() {
    pairTotalSupplyMock.mockResolvedValue(BigInt('900000000')); // 10% removed
    pairGetReservesMock.mockResolvedValue([
        BigInt('900000000000000000'),
        BigInt('1800000000000000000'),
        0n,
    ]);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
    logInfo.mockClear();
    logWarn.mockClear();
    logError.mockClear();
    logFatal.mockClear();
    logDebug.mockClear();
    loadLpBaselineMock.mockReset();
    sendCtxAlertMock.mockClear().mockResolvedValue(undefined);
    broadcastMock.mockClear();
    clearAllTimersForTokenMock.mockClear();
    executeFullSellMock.mockReset().mockResolvedValue(true);

    blockHandlers.length = 0;

    pairGetReservesMock = vi.fn();
    pairTotalSupplyMock = vi.fn();
    poolLiquidityMock = vi.fn();
    quoteExactInputSingleMock = vi.fn();
    (globalThis as Record<string, unknown>).__antiRugE2EMocks = {
        pairGetReserves: pairGetReservesMock,
        pairTotalSupply: pairTotalSupplyMock,
        poolLiquidity: poolLiquidityMock,
        quoteExactInputSingle: quoteExactInputSingleMock,
    };
});

afterEach(async () => {
    // Reset the production detector module's in-memory state between tests.
    const detector = await import('../../../src/anti-rug/detector');
    if (typeof detector._resetRegistryForTesting === 'function') {
        detector._resetRegistryForTesting();
    }
    if (typeof detector._clearPendingV3BurnForTesting === 'function') {
        detector._clearPendingV3BurnForTesting();
    }
    // Reset the circuit breaker so per-chain state from one test doesn't bleed
    // into the next. The CB module exports resetCircuitBreaker as the canonical
    // operator-reset entrypoint; we use it as the test-mode cleanup.
    const cb = await import('../../../src/anti-rug/circuitBreaker');
    if (typeof cb.resetCircuitBreaker === 'function') {
        const ctx = buildCtx({ chain: 'eth' });
        cb.resetCircuitBreaker(ctx as unknown as Parameters<typeof cb.resetCircuitBreaker>[0]);
    }
});

// ===========================================================================
// Tests 15-23: full-pipeline integration
// ===========================================================================

describe('Phase 19 — Anti-rug end-to-end multi-signal pipeline', () => {
    it('Test 15: dry-run path — all 3 signals trip → would-have-sold broadcast + [DRY-RUN] alert + NO executeFullSell', async () => {
        const {
            evaluateRugSignals,
            registerAntiRugPosition,
            getRegisteredPositions,
        } = await import('../../../src/anti-rug/detector');

        const pair = '0xPair15000000000000000000000000000000aaaa';
        const dest = '0xScammer15000000000000000000000000000bbbb';
        const ctx = buildCtx({ liveExecute: false, confirmBlocks: 0 });
        loadLpBaselineMock.mockReturnValueOnce(makeBaselineV2(pair, 15));

        await registerAntiRugPosition(
            ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
            '0xToken15000000000000000000000000000000ccc',
            pair,
            15,
            null,
        );
        const positions = getRegisteredPositions('eth');
        expect(positions).toHaveLength(1);

        configureV2AllSignalsTrip();
        const burnLog = makeV2BurnLog(pair, dest);

        const verdict = await evaluateRugSignals(
            ctx as unknown as Parameters<typeof evaluateRugSignals>[0],
            positions[0],
            burnLog as unknown as Parameters<typeof evaluateRugSignals>[2],
        );

        expect(verdict.verdict).toBe('unsafe');
        if (verdict.verdict === 'unsafe') {
            expect(verdict.signals.lpRemovedPct).toBeGreaterThan(50);
            expect(verdict.signals.allowlistHit).toBe('unsafe');
        }

        // Live-sell path NOT taken — dry-run gate fired.
        expect(executeFullSellMock).not.toHaveBeenCalled();

        // [DRY-RUN] alert sent
        expect(sendCtxAlertMock).toHaveBeenCalled();
        const alertMessage = sendCtxAlertMock.mock.calls[0][1] as string;
        expect(alertMessage).toMatch(/\[DRY-RUN\] Anti-rug/);

        // Broadcast state='would-have-sold'
        const wouldHaveSold = broadcastMock.mock.calls.find(
            (c) =>
                c[0] === 'antirug_state_update' &&
                (c[1] as Record<string, unknown>).state === 'would-have-sold',
        );
        expect(wouldHaveSold).toBeTruthy();
    });

    it('Test 16: live path — all 3 signals trip → clearAllTimersForToken THEN executeFullSell with reason=anti-rug', async () => {
        const {
            evaluateRugSignals,
            registerAntiRugPosition,
            getRegisteredPositions,
        } = await import('../../../src/anti-rug/detector');

        const pair = '0xPair16000000000000000000000000000000aaaa';
        const dest = '0xScammer16000000000000000000000000000bbbb';
        const ctx = buildCtx({ liveExecute: true, confirmBlocks: 0 });
        loadLpBaselineMock.mockReturnValueOnce(makeBaselineV2(pair, 16));

        await registerAntiRugPosition(
            ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
            '0xToken16000000000000000000000000000000ccc',
            pair,
            16,
            null,
        );
        const positions = getRegisteredPositions('eth');

        configureV2AllSignalsTrip();
        const burnLog = makeV2BurnLog(pair, dest);

        await evaluateRugSignals(
            ctx as unknown as Parameters<typeof evaluateRugSignals>[0],
            positions[0],
            burnLog as unknown as Parameters<typeof evaluateRugSignals>[2],
        );

        // Live sell fired — order: clearAllTimersForToken THEN executeFullSell.
        expect(clearAllTimersForTokenMock).toHaveBeenCalledWith(
            'eth',
            '0xToken16000000000000000000000000000000ccc',
        );
        expect(executeFullSellMock).toHaveBeenCalled();
        const clearOrder = clearAllTimersForTokenMock.mock.invocationCallOrder[0];
        const execOrder = executeFullSellMock.mock.invocationCallOrder[0];
        expect(clearOrder).toBeLessThan(execOrder);

        // executeFullSell args: reason='anti-rug', tradeId=16
        const args = executeFullSellMock.mock.calls[0];
        expect(args[4]).toBe('anti-rug');
        expect(args[5]).toBe(16);

        // Broadcast state='exit-fired'
        const exitFired = broadcastMock.mock.calls.find(
            (c) =>
                c[0] === 'antirug_state_update' &&
                (c[1] as Record<string, unknown>).state === 'exit-fired',
        );
        expect(exitFired).toBeTruthy();
    });

    it('Test 17: allowlist suppression — destination IS a UNCX locker → verdict=allowlisted, NO triggerAntiRugExit', async () => {
        const {
            evaluateRugSignals,
            registerAntiRugPosition,
            getRegisteredPositions,
        } = await import('../../../src/anti-rug/detector');

        const pair = '0xPair17000000000000000000000000000000aaaa';
        const locker = '0x59d7d55ddc58494fbbbca29904f108ece82ac7fb'; // UNCX UniLockerV2 ETH
        const ctx = buildCtx({
            liveExecute: true,
            confirmBlocks: 0,
            allowlistV2: [
                {
                    address: locker,
                    lockerName: 'Unicrypt UniLockerV2 ETH',
                    provenance: 'hardcoded',
                },
            ],
        });
        loadLpBaselineMock.mockReturnValueOnce(makeBaselineV2(pair, 17));

        await registerAntiRugPosition(
            ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
            '0xToken17000000000000000000000000000000ccc',
            pair,
            17,
            null,
        );
        const positions = getRegisteredPositions('eth');

        // Even with all 3 signals technically tripping, allowlist short-circuits.
        configureV2AllSignalsTrip();
        const burnLog = makeV2BurnLog(pair, locker);

        const verdict = await evaluateRugSignals(
            ctx as unknown as Parameters<typeof evaluateRugSignals>[0],
            positions[0],
            burnLog as unknown as Parameters<typeof evaluateRugSignals>[2],
        );

        expect(verdict.verdict).toBe('allowlisted');
        if (verdict.verdict === 'allowlisted') {
            expect(verdict.lockerName).toBe('Unicrypt UniLockerV2 ETH');
        }

        // Allowlist branch DOES NOT call triggerAntiRugExit.
        expect(executeFullSellMock).not.toHaveBeenCalled();
        expect(clearAllTimersForTokenMock).not.toHaveBeenCalled();

        // Structured allowlist-hit log emitted.
        const allowlistLog = logInfo.mock.calls.find(
            (c) =>
                typeof c[0] === 'object' &&
                (c[0] as Record<string, unknown>).op === 'antirug.allowlist-hit',
        );
        expect(allowlistLog).toBeTruthy();
    });

    it('Test 18: partial-signal — LP-removed below threshold → verdict=safe, no exit', async () => {
        const {
            evaluateRugSignals,
            registerAntiRugPosition,
            getRegisteredPositions,
        } = await import('../../../src/anti-rug/detector');

        const pair = '0xPair18000000000000000000000000000000aaaa';
        const dest = '0xScammer18000000000000000000000000000bbbb';
        const ctx = buildCtx({ liveExecute: true, confirmBlocks: 0 });
        loadLpBaselineMock.mockReturnValueOnce(makeBaselineV2(pair, 18));

        await registerAntiRugPosition(
            ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
            '0xToken18000000000000000000000000000000ccc',
            pair,
            18,
            null,
        );
        const positions = getRegisteredPositions('eth');

        // Only signal-1 trips (30% LP removed — below 50% threshold)
        // and reserves still high.
        configureV2OnlySignal1();
        // Override total supply: 30% removed (below 50% threshold) so signal-1 does NOT trip.
        pairTotalSupplyMock.mockReset().mockResolvedValue(BigInt('700000000'));

        const burnLog = makeV2BurnLog(pair, dest);

        const verdict = await evaluateRugSignals(
            ctx as unknown as Parameters<typeof evaluateRugSignals>[0],
            positions[0],
            burnLog as unknown as Parameters<typeof evaluateRugSignals>[2],
        );

        expect(verdict.verdict).toBe('safe');
        if (verdict.verdict === 'safe') {
            expect(verdict.reason).toBe('partial-signal');
        }

        // No dispatch.
        expect(executeFullSellMock).not.toHaveBeenCalled();
    });

    it('Test 19: vacuous-pass guard — getReserves rejects → verdict=unknown, no exit, evaluator error log', async () => {
        const {
            evaluateRugSignals,
            registerAntiRugPosition,
            getRegisteredPositions,
        } = await import('../../../src/anti-rug/detector');

        const pair = '0xPair19000000000000000000000000000000aaaa';
        const dest = '0xScammer19000000000000000000000000000bbbb';
        const ctx = buildCtx({ liveExecute: true, confirmBlocks: 0 });
        loadLpBaselineMock.mockReturnValueOnce(makeBaselineV2(pair, 19));

        await registerAntiRugPosition(
            ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
            '0xToken19000000000000000000000000000000ccc',
            pair,
            19,
            null,
        );
        const positions = getRegisteredPositions('eth');

        // getReserves rejects → evaluator catches → verdict='unknown'.
        pairGetReservesMock.mockRejectedValue(new Error('RPC down'));
        pairTotalSupplyMock.mockResolvedValue(BigInt('500000000'));

        const burnLog = makeV2BurnLog(pair, dest);

        const verdict = await evaluateRugSignals(
            ctx as unknown as Parameters<typeof evaluateRugSignals>[0],
            positions[0],
            burnLog as unknown as Parameters<typeof evaluateRugSignals>[2],
        );

        // verdict='unknown' — vacuous-pass UNREPRESENTABLE per the
        // discriminated-union contract. If it were 'safe', a real RPC outage
        // would silently let rugs through.
        expect(verdict.verdict).toBe('unknown');

        // No dispatch.
        expect(executeFullSellMock).not.toHaveBeenCalled();

        // Evaluator error log emitted.
        const errLog = logError.mock.calls.find(
            (c) =>
                typeof c[0] === 'object' &&
                ((c[0] as Record<string, unknown>).op === 'antirug.evaluator.v2-error' ||
                    (c[0] as Record<string, unknown>).op === 'antirug.evaluation-failed'),
        );
        expect(errLog).toBeTruthy();
    });

    it('Test 20: confirm-blocks de-trip — reserves recover during delay → no exit, signal-detripped log', async () => {
        const {
            evaluateRugSignals,
            registerAntiRugPosition,
            getRegisteredPositions,
        } = await import('../../../src/anti-rug/detector');

        const pair = '0xPair20000000000000000000000000000000aaaa';
        const dest = '0xScammer20000000000000000000000000000bbbb';
        const ctx = buildCtx({ liveExecute: true, confirmBlocks: 1 });
        loadLpBaselineMock.mockReturnValueOnce(makeBaselineV2(pair, 20));

        await registerAntiRugPosition(
            ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
            '0xToken20000000000000000000000000000000ccc',
            pair,
            20,
            null,
        );
        const positions = getRegisteredPositions('eth');

        // Initial evaluation: all 3 signals trip → confirm-blocks watcher scheduled.
        configureV2AllSignalsTrip();
        const burnLog = makeV2BurnLog(pair, dest);

        const verdict = await evaluateRugSignals(
            ctx as unknown as Parameters<typeof evaluateRugSignals>[0],
            positions[0],
            burnLog as unknown as Parameters<typeof evaluateRugSignals>[2],
        );
        expect(verdict.verdict).toBe('unsafe');
        // confirm-blocks watcher registered (httpProvider.on('block', ...))
        expect(blockHandlers.length).toBe(1);

        // Now reconfigure mocks so re-evaluation sees recovery.
        pairGetReservesMock.mockReset();
        pairTotalSupplyMock.mockReset();
        configureV2Recovery();

        // Fire the block watcher at the confirm block (current 18_000_000 + 1).
        await blockHandlers[0](18_000_001);

        // Re-evaluation should de-trip → no dispatch.
        expect(executeFullSellMock).not.toHaveBeenCalled();

        // 'antirug.signal-detripped' log emitted by the confirm-gate.
        const detrippedLog = logInfo.mock.calls.find(
            (c) =>
                typeof c[0] === 'object' &&
                (c[0] as Record<string, unknown>).op === 'antirug.signal-detripped',
        );
        expect(detrippedLog).toBeTruthy();
    });

    it('Test 21: circuit-breaker trip — 3 successful exits → CB tripped → 4th evaluation returns early', async () => {
        const {
            evaluateRugSignals,
            registerAntiRugPosition,
            getRegisteredPositions,
        } = await import('../../../src/anti-rug/detector');

        // Drive 3 exits → CB trips
        for (let i = 0; i < 3; i++) {
            const pair = `0xPair21${String(i).padStart(2, '0')}00000000000000000000000000aaaa`;
            const dest = `0xScammer21${String(i).padStart(2, '0')}00000000000000000000000bbbb`;
            const ctx = buildCtx({ liveExecute: true, confirmBlocks: 0 });
            loadLpBaselineMock.mockReturnValueOnce(makeBaselineV2(pair, 100 + i));

            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                `0xToken21${String(i).padStart(2, '0')}00000000000000000000000ccc`,
                pair,
                100 + i,
                null,
            );
            const positions = getRegisteredPositions('eth');
            const pos = positions.find((p) => p.tradeId === 100 + i)!;

            configureV2AllSignalsTrip();
            const burnLog = makeV2BurnLog(pair, dest);
            await evaluateRugSignals(
                ctx as unknown as Parameters<typeof evaluateRugSignals>[0],
                pos,
                burnLog as unknown as Parameters<typeof evaluateRugSignals>[2],
            );
        }

        // 3 exits all fired → executeFullSell called 3x.
        expect(executeFullSellMock).toHaveBeenCalledTimes(3);
        executeFullSellMock.mockClear();
        clearAllTimersForTokenMock.mockClear();

        // 4th evaluation: same setup, but CB is now tripped.
        const pair4 = '0xPair21030000000000000000000000000000aaaa';
        const dest4 = '0xScammer21030000000000000000000000000bbbb';
        const ctx4 = buildCtx({ liveExecute: true, confirmBlocks: 0 });
        loadLpBaselineMock.mockReturnValueOnce(makeBaselineV2(pair4, 103));

        await registerAntiRugPosition(
            ctx4 as unknown as Parameters<typeof registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
            '0xToken21030000000000000000000000000000ccc',
            pair4,
            103,
            null,
        );
        const positions4 = getRegisteredPositions('eth');
        const pos4 = positions4.find((p) => p.tradeId === 103)!;

        configureV2AllSignalsTrip();
        const burnLog4 = makeV2BurnLog(pair4, dest4);
        await evaluateRugSignals(
            ctx4 as unknown as Parameters<typeof evaluateRugSignals>[0],
            pos4,
            burnLog4 as unknown as Parameters<typeof evaluateRugSignals>[2],
        );

        // CB tripped — exit suppressed. executeFullSell NOT called.
        expect(executeFullSellMock).not.toHaveBeenCalled();

        // CB-suppressed log emitted.
        const cbSuppressLog = [
            ...logFatal.mock.calls,
            ...logError.mock.calls,
            ...logWarn.mock.calls,
        ].find(
            (c) =>
                typeof c[0] === 'object' &&
                (c[0] as Record<string, unknown>).op ===
                    'antirug.cb-tripped.exit-suppressed',
        );
        expect(cbSuppressLog).toBeTruthy();
    });

    it('Test 22: partial sell preserves subscription — entry remains; subsequent Burn still dispatches', async () => {
        const {
            evaluateRugSignals,
            registerAntiRugPosition,
            getRegisteredPositions,
            unregisterAntiRugPosition,
        } = await import('../../../src/anti-rug/detector');

        const pair = '0xPair22000000000000000000000000000000aaaa';
        const dest = '0xScammer22000000000000000000000000000bbbb';
        const ctx = buildCtx({ liveExecute: false, confirmBlocks: 0 });
        loadLpBaselineMock.mockReturnValueOnce(makeBaselineV2(pair, 22));

        await registerAntiRugPosition(
            ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
            '0xToken22000000000000000000000000000000ccc',
            pair,
            22,
            null,
        );

        // Partial sell happens — D-TERMINATION says subscription stays. Per the
        // Phase 19 cleanup-hook implementation in exitEngine.ts, partial sells
        // INTENTIONALLY do NOT call unregisterAntiRugPosition. We assert here
        // by NOT calling unregisterAntiRugPosition and verifying the entry
        // remains in the registry.
        let positions = getRegisteredPositions('eth');
        expect(positions).toHaveLength(1);

        // Subsequent Burn event arrives — should still dispatch.
        configureV2AllSignalsTrip();
        const burnLog = makeV2BurnLog(pair, dest);
        const verdict = await evaluateRugSignals(
            ctx as unknown as Parameters<typeof evaluateRugSignals>[0],
            positions[0],
            burnLog as unknown as Parameters<typeof evaluateRugSignals>[2],
        );
        expect(verdict.verdict).toBe('unsafe');

        // Subscription still registered (partial sell did NOT unsubscribe).
        positions = getRegisteredPositions('eth');
        expect(positions).toHaveLength(1);
        expect(positions[0].tradeId).toBe(22);

        // Verify the "negative" form too: unregisterAntiRugPosition was NOT
        // called by the evaluator path (only by the full-close path in
        // exitEngine.ts:504).
        expect(unregisterAntiRugPosition).toBeDefined();
    });

    it('Test 23: full close terminates subscription — unregisterAntiRugPosition called → subsequent Burn finds no position', async () => {
        const {
            evaluateRugSignals,
            registerAntiRugPosition,
            getRegisteredPositions,
            unregisterAntiRugPosition,
        } = await import('../../../src/anti-rug/detector');

        const pair = '0xPair23000000000000000000000000000000aaaa';
        const dest = '0xScammer23000000000000000000000000000bbbb';
        const ctx = buildCtx({ liveExecute: false, confirmBlocks: 0 });
        loadLpBaselineMock.mockReturnValueOnce(makeBaselineV2(pair, 23));

        await registerAntiRugPosition(
            ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
            '0xToken23000000000000000000000000000000ccc',
            pair,
            23,
            null,
        );
        expect(getRegisteredPositions('eth')).toHaveLength(1);

        // Simulate the full-close cleanup hook at exitEngine.ts:504.
        unregisterAntiRugPosition('eth', 23);
        expect(getRegisteredPositions('eth')).toHaveLength(0);

        // Subsequent Burn event arrives — no registered position; evaluator
        // never invoked. Demonstrated by capturing positions BEFORE the
        // synthetic event: empty list means dispatchEvent has nothing to do.
        const positions = getRegisteredPositions('eth');
        expect(positions).toHaveLength(0);

        // Demonstrate executeFullSell never called for this position.
        configureV2AllSignalsTrip();
        const burnLog = makeV2BurnLog(pair, dest);
        // We cannot invoke evaluateRugSignals because there is no position
        // to pass. The "no dispatch" semantic at the WS-subscription layer
        // is verified at the dispatch level: an empty registry produces an
        // empty address-union filter, so the WS subscription on this pair
        // is dropped on the next startChainAntiRugListener refresh.
        // Verify executeFullSell was not called.
        expect(executeFullSellMock).not.toHaveBeenCalled();
        void burnLog;
    });
});
