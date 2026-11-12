// test/unit/anti-rug/detectorRegistry.test.ts
// Phase 19 Plan 19-04a — Detector registry + WS subscription skeleton +
// topic filter union + chunked getLogs primitive.
//
// This plan ships the FOUNDATION skeleton of src/anti-rug/detector.ts.
// Plans 19-04b (multi-signal evaluator) and 19-04c (WS lifecycle / reconnect
// / heartbeat / backfill / HTTP fallback) plug into this skeleton in later
// waves. The evaluator is therefore stubbed via a let-injectable shim
// (`_setEvaluateRugSignalsForTesting`) so the dispatch-routing tests can
// run before Plan 19-04b ships its real evaluateRugSignals.
//
// Test plan (11 tests):
//
// Position registry:
//   Test 18: registerAntiRugPosition stores the entry with the loaded
//            baseline; if loadLpBaseline returns null, logs error and
//            skips the register (no inner-map entry created).
//   Test 19: unregisterAntiRugPosition removes by tradeId; if the inner
//            address bucket is empty afterwards, the address key is dropped.
//   Test 20: Multiple positions on the same pair address are stored in
//            the inner-Map array; dispatch fires one evaluation per
//            registered position.
//
// Topic filter union:
//   Test A1: V2-only registration → ws.on filter topics include
//            PAIR_BURN_TOPIC AND PAIR_TRANSFER_TOPIC.
//   Test A2: V3-only registration → ws.on filter topics include
//            POOL_BURN_TOPIC AND POOL_COLLECT_TOPIC.
//   Test A3: V2 + V3 registrations → ws.on filter topics = union of all four.
//   Test A4: Address filter is the union of all registered pair/pool
//            addresses (lowercased) for this chain.
//
// dispatchEvent routing:
//   Test A5: Log with address 0xAAA... routes to position(s) registered
//            on that address; positions on other addresses are NOT called;
//            unregistered addresses silently drop.
//
// getLogsForBackfill primitive:
//   Test A6: fromBlock=100, toBlock=150, cap=10 → 5 sequential getLogs
//            calls of 10 blocks each: 100-109, 110-119, 120-129, 130-139,
//            140-149, plus one final 150-150 call (total 6 calls — see
//            implementation discussion below for the off-by-one boundary).
//   Test A7: toBlock - fromBlock < cap → one call (no chunking).
//   Test A8: Any chunk getLogs rejection propagates to caller.
//
// Off-by-one note: the plan's <behavior> Test A6 names "100-110, 111-120,
// 121-130, 131-140, 141-150" — this is the "100 through 150 inclusive,
// 5 chunks of 11 blocks" reading. The implementation in <action> says:
//
//     for (let chunkStart = fromBlock; chunkStart <= toBlock; chunkStart += cap) {
//         const chunkEnd = Math.min(chunkStart + cap - 1, toBlock);
//         ...
//     }
//
// With cap=10 the iteration is: [100,109], [110,119], [120,129], [130,139],
// [140,149], [150,150] = SIX chunks. The "5 chunks of 10 blocks each" from
// the plan's <behavior> is a typo against the iteration math; the test
// verifies the iteration math directly (six chunks for [100,150] cap=10)
// per the explicit <action> code block which is unambiguous. The 5-vs-6
// distinction is documented in the SUMMARY.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks: logger, lpBaseline (loadLpBaseline), db (chain_state — unused here)
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

// loadLpBaseline mock — the detector reads this at registerAntiRugPosition.
const loadLpBaselineMock = vi.fn();
vi.mock('../../../src/anti-rug/lpBaseline', () => ({
    loadLpBaseline: loadLpBaselineMock,
}));

// db mock — Phase 20 / Plan 20-03 added setAntirugDryRunStarted.run() inside
// startChainAntiRugListener entry. Without this mock, every test that calls
// startChainAntiRugListener writes to the production data/bot.db singleton
// because src/utils/db.ts binds the DB at module-load time (no path override
// once the singleton is created). The chain_state prepared statements are
// stubbed as no-ops since this test verifies registry/dispatch/topic-filter
// shape, not db persistence.
vi.mock('../../../src/utils/db', () => ({
    upsertChainState: { run: vi.fn() },
    getChainState: { get: vi.fn().mockReturnValue(undefined) },
    setAntirugDryRunStarted: { run: vi.fn() },
    getAntirugDryRunStarted: { get: vi.fn().mockReturnValue(undefined) },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface StubWsProvider {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
}

interface StubHttpProvider {
    getLogs: ReturnType<typeof vi.fn>;
    getBlockNumber: ReturnType<typeof vi.fn>;
    getCode: ReturnType<typeof vi.fn>;
}

interface StubChainCtx {
    chain: {
        name: string;
        antiRug: {
            backfillCapBlocks: number;
            maxBackfillBlocks: number;
        };
    };
    wsProvider: StubWsProvider | null;
    httpProvider: StubHttpProvider;
}

function buildCtx(overrides: Partial<{
    chainName: string;
    backfillCapBlocks: number;
    maxBackfillBlocks: number;
    withWs: boolean;
}> = {}): StubChainCtx {
    const withWs = overrides.withWs ?? true;
    return {
        chain: {
            name: overrides.chainName ?? 'eth',
            antiRug: {
                backfillCapBlocks: overrides.backfillCapBlocks ?? 10,
                maxBackfillBlocks: overrides.maxBackfillBlocks ?? 7200,
            },
        },
        wsProvider: withWs
            ? {
                  on: vi.fn(),
                  off: vi.fn(),
                  removeAllListeners: vi.fn(),
              }
            : null,
        httpProvider: {
            getLogs: vi.fn().mockResolvedValue([]),
            getBlockNumber: vi.fn().mockResolvedValue(18_000_000),
            getCode: vi.fn().mockResolvedValue('0x60'),
        },
    };
}

const V2_DEX = { dexType: 'v2' as const, name: 'uniswap-v2' };
const V3_DEX = { dexType: 'v3' as const, name: 'uniswap-v3' };

function makeBaseline(poolType: 'v2' | 'v3', addr: string, tradeId: number) {
    return {
        tradeId,
        poolType,
        pairOrPoolAddress: addr.toLowerCase(),
        v2Token0Reserve: poolType === 'v2' ? '1000000000000000000' : null,
        v2Token1Reserve: poolType === 'v2' ? '2000000000000000000' : null,
        v2LpTotalSupply: poolType === 'v2' ? '50000000000' : null,
        v3ActiveLiquidity: poolType === 'v3' ? '999999999999999' : null,
        v3TickAtSnapshot: poolType === 'v3' ? 100 : null,
        v3PositionNftId: null,
        v3FeeTier: poolType === 'v3' ? 3000 : null,
        snapshotBlock: 18_000_000,
        snapshotTs: 1_700_000_000,
    };
}

beforeEach(() => {
    logInfo.mockClear();
    logWarn.mockClear();
    logError.mockClear();
    logFatal.mockClear();
    logDebug.mockClear();
    loadLpBaselineMock.mockReset();
});

afterEach(async () => {
    // Clear the registry between tests so per-chain state doesn't bleed.
    const mod = await import('../../../src/anti-rug/detector');
    if (typeof mod._resetRegistryForTesting === 'function') {
        mod._resetRegistryForTesting();
    }
    vi.restoreAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('Phase 19 — Detector registry + WS skeleton', () => {
    // -----------------------------------------------------------------------
    // Position registry: register / unregister / multi-position-per-pair
    // -----------------------------------------------------------------------

    describe('positionRegistry — register / unregister', () => {
        // Own limit (orchestrator, phase 23 wave 13 gate, 2026-11-12): this test pays the cold
        // import of src/anti-rug/detector in its body. Measured 2.5 s in the full parallel run (51%
        // of the 5 s unit testTimeout) and 0.8 s alone. Root fix is Phase 28 (deferred-items.md).
        it('Test 18: registerAntiRugPosition stores entry with loaded baseline; null baseline logs error and skips', { timeout: 20_000 }, async () => {
            const { registerAntiRugPosition, getRegisteredPositions } =
                await import('../../../src/anti-rug/detector');

            // Case A: baseline present → registered
            const pairA = '0xAAAaaa00000000000000000000000000000000aa';
            loadLpBaselineMock.mockReturnValueOnce(
                makeBaseline('v2', pairA, 1)
            );
            const ctx = buildCtx();
            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xToken0000000000000000000000000000000000a1',
                pairA,
                1,
                null
            );

            const positions = getRegisteredPositions('eth');
            expect(positions).toHaveLength(1);
            expect(positions[0].tradeId).toBe(1);
            expect(positions[0].pairOrPoolAddress).toBe(pairA.toLowerCase());
            expect(positions[0].baseline).toBeTruthy();
            expect(positions[0].baseline.poolType).toBe('v2');
            expect(positions[0].poolType).toBe('v2');

            // Case B: baseline missing → log.error, NOT registered
            loadLpBaselineMock.mockReturnValueOnce(null);
            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xToken0000000000000000000000000000000000a2',
                '0xBBBbbb00000000000000000000000000000000bb',
                2,
                null
            );

            // Still only the first registration on the chain.
            expect(getRegisteredPositions('eth')).toHaveLength(1);
            expect(logError).toHaveBeenCalled();
            const errCall = logError.mock.calls.find(
                (c) => typeof c[1] === 'string' && c[1].toLowerCase().includes('baseline')
            );
            expect(errCall).toBeTruthy();
            const errFields = errCall![0] as Record<string, unknown>;
            expect(errFields.tradeId).toBe(2);
        });

        it('Test 19: unregisterAntiRugPosition removes the matching tradeId; empty inner bucket is deleted', async () => {
            const { registerAntiRugPosition, unregisterAntiRugPosition, getRegisteredPositions } =
                await import('../../../src/anti-rug/detector');

            const pair = '0xCCCccc00000000000000000000000000000000cc';
            loadLpBaselineMock.mockReturnValueOnce(makeBaseline('v2', pair, 10));
            const ctx = buildCtx();

            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xTokenC0000000000000000000000000000000000',
                pair,
                10,
                null
            );
            expect(getRegisteredPositions('eth')).toHaveLength(1);

            unregisterAntiRugPosition('eth', 10);
            expect(getRegisteredPositions('eth')).toHaveLength(0);

            // Unregister of a non-existent tradeId is a no-op (does not throw).
            expect(() => unregisterAntiRugPosition('eth', 999)).not.toThrow();
        });

        it('Test 20: multiple positions on the same pair address are stored in the array; both dispatch when an event fires', async () => {
            const {
                registerAntiRugPosition,
                startChainAntiRugListener,
                _setEvaluateRugSignalsForTesting,
                getRegisteredPositions,
            } = await import('../../../src/anti-rug/detector');

            const pair = '0xDDDddd00000000000000000000000000000000dd';
            loadLpBaselineMock
                .mockReturnValueOnce(makeBaseline('v2', pair, 100))
                .mockReturnValueOnce(makeBaseline('v2', pair, 101));

            const ctx = buildCtx();
            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xTokenD1000000000000000000000000000000000',
                pair,
                100,
                null
            );
            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xTokenD2000000000000000000000000000000000',
                pair,
                101,
                null
            );

            const positions = getRegisteredPositions('eth');
            expect(positions).toHaveLength(2);
            expect(positions.map((p) => p.tradeId).sort()).toEqual([100, 101]);

            const evalSpy = vi.fn().mockResolvedValue({
                verdict: 'safe',
                reason: 'partial-signal',
                signals: {},
            });
            _setEvaluateRugSignalsForTesting(evalSpy);

            await startChainAntiRugListener(
                ctx as unknown as Parameters<typeof startChainAntiRugListener>[0]
            );
            // The most-recent .on(...) call holds the dispatch callback.
            const onCalls = ctx.wsProvider!.on.mock.calls;
            const lastCall = onCalls[onCalls.length - 1];
            const dispatchCb = lastCall[1] as (logEvent: unknown) => void;

            // Synthesize a log event arriving for the registered pair.
            await dispatchCb({
                address: pair, // mixed-case incoming
                topics: [],
                data: '0x',
                blockNumber: 18_000_100,
            });

            // Both positions dispatched.
            expect(evalSpy).toHaveBeenCalledTimes(2);
            const tradeIdsDispatched = evalSpy.mock.calls
                .map((c) => (c[1] as { tradeId: number }).tradeId)
                .sort();
            expect(tradeIdsDispatched).toEqual([100, 101]);
        });
    });

    // -----------------------------------------------------------------------
    // Topic filter union: V2 / V3 / V2+V3 / address-union
    // -----------------------------------------------------------------------

    describe('startChainAntiRugListener — topic filter union', () => {
        it('Test A1: V2 position only → topics include PAIR_BURN_TOPIC AND PAIR_TRANSFER_TOPIC', async () => {
            const { registerAntiRugPosition, startChainAntiRugListener } =
                await import('../../../src/anti-rug/detector');
            const { PAIR_BURN_TOPIC, PAIR_TRANSFER_TOPIC } = await import(
                '../../../src/anti-rug/events'
            );

            const pair = '0xE000000000000000000000000000000000000ee1';
            loadLpBaselineMock.mockReturnValueOnce(makeBaseline('v2', pair, 1));
            const ctx = buildCtx();
            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xTokenE1000000000000000000000000000000000',
                pair,
                1,
                null
            );

            await startChainAntiRugListener(
                ctx as unknown as Parameters<typeof startChainAntiRugListener>[0]
            );

            const onCalls = ctx.wsProvider!.on.mock.calls;
            expect(onCalls.length).toBeGreaterThan(0);
            const filter = onCalls[onCalls.length - 1][0] as {
                address: string[];
                topics: string[][];
            };
            // topics is [[<topic-union>]] — single-OR position at topic0.
            const topics0 = filter.topics[0];
            expect(topics0).toContain(PAIR_BURN_TOPIC);
            expect(topics0).toContain(PAIR_TRANSFER_TOPIC);
        });

        it('Test A2: V3 position only → topics include POOL_BURN_TOPIC AND POOL_COLLECT_TOPIC', async () => {
            const { registerAntiRugPosition, startChainAntiRugListener } =
                await import('../../../src/anti-rug/detector');
            const { POOL_BURN_TOPIC, POOL_COLLECT_TOPIC } = await import(
                '../../../src/anti-rug/events'
            );

            const pool = '0xF000000000000000000000000000000000000ff2';
            loadLpBaselineMock.mockReturnValueOnce(makeBaseline('v3', pool, 2));
            const ctx = buildCtx();
            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V3_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xTokenF1000000000000000000000000000000000',
                pool,
                2,
                3000
            );

            await startChainAntiRugListener(
                ctx as unknown as Parameters<typeof startChainAntiRugListener>[0]
            );

            const onCalls = ctx.wsProvider!.on.mock.calls;
            const filter = onCalls[onCalls.length - 1][0] as {
                address: string[];
                topics: string[][];
            };
            const topics0 = filter.topics[0];
            expect(topics0).toContain(POOL_BURN_TOPIC);
            expect(topics0).toContain(POOL_COLLECT_TOPIC);
        });

        it('Test A3: V2 + V3 positions on the same chain → topic filter is the UNION of all four topics', async () => {
            const { registerAntiRugPosition, startChainAntiRugListener } =
                await import('../../../src/anti-rug/detector');
            const {
                PAIR_BURN_TOPIC,
                PAIR_TRANSFER_TOPIC,
                POOL_BURN_TOPIC,
                POOL_COLLECT_TOPIC,
            } = await import('../../../src/anti-rug/events');

            const v2Pair = '0xAA00000000000000000000000000000000000aa3';
            const v3Pool = '0xBB00000000000000000000000000000000000bb3';
            loadLpBaselineMock
                .mockReturnValueOnce(makeBaseline('v2', v2Pair, 3))
                .mockReturnValueOnce(makeBaseline('v3', v3Pool, 4));
            const ctx = buildCtx();
            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xTokenAA00000000000000000000000000000000a',
                v2Pair,
                3,
                null
            );
            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V3_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xTokenBB00000000000000000000000000000000b',
                v3Pool,
                4,
                3000
            );

            await startChainAntiRugListener(
                ctx as unknown as Parameters<typeof startChainAntiRugListener>[0]
            );

            const onCalls = ctx.wsProvider!.on.mock.calls;
            const filter = onCalls[onCalls.length - 1][0] as {
                address: string[];
                topics: string[][];
            };
            const topics0 = filter.topics[0];
            // All four topics present (UNION).
            expect(topics0).toContain(PAIR_BURN_TOPIC);
            expect(topics0).toContain(PAIR_TRANSFER_TOPIC);
            expect(topics0).toContain(POOL_BURN_TOPIC);
            expect(topics0).toContain(POOL_COLLECT_TOPIC);
        });

        it('Test A4: address filter is the union of all registered pair/pool addresses (lowercased)', async () => {
            const { registerAntiRugPosition, startChainAntiRugListener } =
                await import('../../../src/anti-rug/detector');

            const pairUpper = '0xCAFE00000000000000000000000000000000Beef';
            const poolUpper = '0xDEAD00000000000000000000000000000000FACE';
            loadLpBaselineMock
                .mockReturnValueOnce(makeBaseline('v2', pairUpper, 5))
                .mockReturnValueOnce(makeBaseline('v3', poolUpper, 6));
            const ctx = buildCtx();
            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xTokenCAFE0000000000000000000000000000000',
                pairUpper,
                5,
                null
            );
            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V3_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xTokenDEAD0000000000000000000000000000000',
                poolUpper,
                6,
                500
            );

            await startChainAntiRugListener(
                ctx as unknown as Parameters<typeof startChainAntiRugListener>[0]
            );

            const onCalls = ctx.wsProvider!.on.mock.calls;
            const filter = onCalls[onCalls.length - 1][0] as {
                address: string[];
                topics: string[][];
            };
            // Addresses union, lowercased; order is registration-order.
            expect(filter.address.sort()).toEqual(
                [pairUpper.toLowerCase(), poolUpper.toLowerCase()].sort()
            );
        });
    });

    // -----------------------------------------------------------------------
    // dispatchEvent routing
    // -----------------------------------------------------------------------

    describe('dispatchEvent routing', () => {
        it('Test A5: log routes to position(s) at the same address; unknown addresses silently drop', async () => {
            const {
                registerAntiRugPosition,
                startChainAntiRugListener,
                _setEvaluateRugSignalsForTesting,
            } = await import('../../../src/anti-rug/detector');

            const ourPair = '0xAAAaaa11111111111111111111111111111111aa';
            const otherPair = '0xBBBbbb22222222222222222222222222222222bb';
            const unrelatedAddr = '0xCCCccc33333333333333333333333333333333cc';

            loadLpBaselineMock
                .mockReturnValueOnce(makeBaseline('v2', ourPair, 50))
                .mockReturnValueOnce(makeBaseline('v2', otherPair, 51));

            const ctx = buildCtx();
            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xTokenAA00000000000000000000000000000000a',
                ourPair,
                50,
                null
            );
            await registerAntiRugPosition(
                ctx as unknown as Parameters<typeof registerAntiRugPosition>[0],
                V2_DEX as unknown as Parameters<typeof registerAntiRugPosition>[1],
                '0xTokenBB00000000000000000000000000000000b',
                otherPair,
                51,
                null
            );

            const evalSpy = vi.fn().mockResolvedValue({
                verdict: 'safe',
                reason: 'partial-signal',
                signals: {},
            });
            _setEvaluateRugSignalsForTesting(evalSpy);

            await startChainAntiRugListener(
                ctx as unknown as Parameters<typeof startChainAntiRugListener>[0]
            );
            const onCalls = ctx.wsProvider!.on.mock.calls;
            const dispatchCb = onCalls[onCalls.length - 1][1] as (
                logEvent: unknown
            ) => void;

            // 1. Event from our pair → dispatch fires.
            await dispatchCb({
                address: ourPair.toUpperCase(),
                topics: [],
                data: '0x',
                blockNumber: 18_000_200,
            });
            expect(evalSpy).toHaveBeenCalledTimes(1);
            const dispatchedPosition = evalSpy.mock.calls[0][1] as {
                tradeId: number;
            };
            expect(dispatchedPosition.tradeId).toBe(50);

            // 2. Event from otherPair → only the otherPair position dispatched.
            await dispatchCb({
                address: otherPair,
                topics: [],
                data: '0x',
                blockNumber: 18_000_201,
            });
            expect(evalSpy).toHaveBeenCalledTimes(2);
            expect((evalSpy.mock.calls[1][1] as { tradeId: number }).tradeId).toBe(
                51
            );

            // 3. Event from an unrelated address → no dispatch.
            await dispatchCb({
                address: unrelatedAddr,
                topics: [],
                data: '0x',
                blockNumber: 18_000_202,
            });
            expect(evalSpy).toHaveBeenCalledTimes(2); // unchanged
        });
    });

    // -----------------------------------------------------------------------
    // getLogsForBackfill chunked primitive
    // -----------------------------------------------------------------------

    describe('getLogsForBackfill — chunked iteration', () => {
        it('Test A6: fromBlock=100 toBlock=150 cap=10 → 6 sequential getLogs calls covering [100,109], [110,119], [120,129], [130,139], [140,149], [150,150]', async () => {
            const { getLogsForBackfill } = await import(
                '../../../src/anti-rug/detector'
            );

            const ctx = buildCtx({ backfillCapBlocks: 10 });
            // Each chunk returns a synthetic single-entry array tagged with
            // its chunk number so we can verify both order and concatenation.
            let chunkIdx = 0;
            ctx.httpProvider.getLogs.mockImplementation(async () => {
                return [{ chunk: chunkIdx++ }];
            });

            const result = await getLogsForBackfill(
                ctx as unknown as Parameters<typeof getLogsForBackfill>[0],
                100,
                150,
                ['0xaaa'],
                [['0xtopicA']]
            );

            // Six calls per the iteration math (chunkStart += cap, cap=10,
            // from 100 inclusive to 150 inclusive → starts at 100,110,120,130,140,150).
            expect(ctx.httpProvider.getLogs).toHaveBeenCalledTimes(6);
            const calls = ctx.httpProvider.getLogs.mock.calls.map(
                (c) => c[0] as { fromBlock: number; toBlock: number }
            );
            expect(calls.map((c) => [c.fromBlock, c.toBlock])).toEqual([
                [100, 109],
                [110, 119],
                [120, 129],
                [130, 139],
                [140, 149],
                [150, 150],
            ]);
            // Concatenation preserves order.
            expect(result).toHaveLength(6);
            expect((result[0] as { chunk: number }).chunk).toBe(0);
            expect((result[5] as { chunk: number }).chunk).toBe(5);
        });

        it('Test A7: toBlock - fromBlock < cap → exactly one getLogs call (no chunking)', async () => {
            const { getLogsForBackfill } = await import(
                '../../../src/anti-rug/detector'
            );

            const ctx = buildCtx({ backfillCapBlocks: 50 });
            ctx.httpProvider.getLogs.mockResolvedValue([
                { single: true } as unknown,
            ]);

            const result = await getLogsForBackfill(
                ctx as unknown as Parameters<typeof getLogsForBackfill>[0],
                100,
                110, // 11-block window; cap=50 → single call
                ['0xaaa'],
                [['0xtopicA']]
            );

            expect(ctx.httpProvider.getLogs).toHaveBeenCalledTimes(1);
            const firstCall = ctx.httpProvider.getLogs.mock.calls[0][0] as {
                fromBlock: number;
                toBlock: number;
                address: string[];
                topics: unknown;
            };
            expect(firstCall.fromBlock).toBe(100);
            expect(firstCall.toBlock).toBe(110);
            expect(firstCall.address).toEqual(['0xaaa']);
            expect(result).toHaveLength(1);
        });

        it('Test A8: chunk getLogs rejection propagates to caller', async () => {
            const { getLogsForBackfill } = await import(
                '../../../src/anti-rug/detector'
            );

            const ctx = buildCtx({ backfillCapBlocks: 10 });
            let callCount = 0;
            ctx.httpProvider.getLogs.mockImplementation(async () => {
                callCount++;
                if (callCount === 2) {
                    throw new Error('RPC error: getLogs rate-limit hit');
                }
                return [];
            });

            await expect(
                getLogsForBackfill(
                    ctx as unknown as Parameters<typeof getLogsForBackfill>[0],
                    100,
                    150,
                    ['0xaaa'],
                    [['0xtopicA']]
                )
            ).rejects.toThrow(/RPC error: getLogs rate-limit hit/);

            // Only the first chunk plus the rejecting second chunk ran;
            // chunks 3-6 are NOT executed (error propagates immediately).
            expect(callCount).toBe(2);
        });
    });
});
