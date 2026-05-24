// test/unit/anti-rug/lpBaseline.test.ts
// Phase 19 Plan 19-03 Task 3 — snapshotLpBaseline (V2 reserves + V3 active
// liquidity at buy success) + loadLpBaseline + clearLpBaseline.
//
// Test plan (9 tests):
//   1. V2 dex: pair.getReserves() + pair.totalSupply(); writes poolType='v2'
//      with V2 fields populated, V3 fields null.
//   2. V3 dex: pool.liquidity() + pool.slot0(); writes poolType='v3' with
//      V3 fields populated (v3FeeTier from arg), V2 fields null.
//   3. Snapshot reads block from ctx.httpProvider.getBlockNumber() and ts
//      from Math.floor(Date.now() / 1000).
//   4. pair_or_pool_address is lowercased before persisting.
//   5. Structured pino log emitted with op:'antirug.lp-baseline.snapshot'.
//   6. RPC error from pair.getReserves() PROPAGATES (no silent swallow).
//   7. loadLpBaseline(tradeId) returns null when no row.
//   8. loadLpBaseline(tradeId) returns a camelCase LpBaselineRow when row exists.
//   9. clearLpBaseline(tradeId) returns the changes count (0 or 1).
//
// Implementation note: we vi.mock both the production db.ts (to capture
// upsertLpBaseline/getLpBaseline/deleteLpBaseline calls without touching
// the real DB) AND ethers (so the Contract constructor returns our stub
// with deterministic getReserves/totalSupply/liquidity/slot0 return values).
//
// The logger is also mocked so we can spy on .info without IO noise.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Logger: capture .info / .warn / .error / .fatal — verifies the structured
// pino emission shape for Test 5.
const logInfo = vi.fn();
const logWarn = vi.fn();
const logError = vi.fn();
const logFatal = vi.fn();
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: logInfo,
            warn: logWarn,
            error: logError,
            fatal: logFatal,
            debug: vi.fn(),
        }),
        info: logInfo,
        warn: logWarn,
        error: logError,
        fatal: logFatal,
        debug: vi.fn(),
    },
}));

// DB mocks: capture .run / .get calls so we can assert the row shape that
// would be persisted. Each statement object has the same interface as a
// better-sqlite3 prepared statement (.run, .get) but is a vi.fn().
const upsertRun = vi.fn();
const getGet = vi.fn();
const deleteRun = vi.fn();

vi.mock('../../../src/utils/db', () => ({
    upsertLpBaseline: { run: upsertRun },
    getLpBaseline: { get: getGet },
    deleteLpBaseline: { run: deleteRun },
}));

// Ethers Contract mock: each test sets the per-call returns for getReserves /
// totalSupply / liquidity / slot0. The Contract constructor is replaced via
// vi.mock and reads the CURRENT-test mocks via the module-level let-bound
// holders below. This indirection survives vitest's `mockReset: true` (which
// wipes mockImplementation between tests) because the Contract is a class
// whose `constructor` body runs at instantiation time and looks up the
// per-test mock instances fresh on every `new Contract(...)` call.
let pairGetReservesMock: ReturnType<typeof vi.fn>;
let pairTotalSupplyMock: ReturnType<typeof vi.fn>;
let poolLiquidityMock: ReturnType<typeof vi.fn>;
let poolSlot0Mock: ReturnType<typeof vi.fn>;

vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    // Use a real class so production `new Contract(...)` succeeds; the class
    // body dispatches to V2 or V3 stubs based on ABI shape. Each instance's
    // methods reference the module-level let-bound mocks via the global
    // helper `__getAntiRugMocks` injected onto `globalThis` from beforeEach.
    class MockContract {
        address: string;
        getReserves?: ReturnType<typeof vi.fn>;
        totalSupply?: ReturnType<typeof vi.fn>;
        liquidity?: ReturnType<typeof vi.fn>;
        slot0?: ReturnType<typeof vi.fn>;
        constructor(address: string, abi: unknown[]) {
            this.address = address;
            const abiStr = JSON.stringify(abi);
            const mocks = (globalThis as Record<string, unknown>)
                .__antiRugLpBaselineMocks as {
                pairGetReserves: ReturnType<typeof vi.fn>;
                pairTotalSupply: ReturnType<typeof vi.fn>;
                poolLiquidity: ReturnType<typeof vi.fn>;
                poolSlot0: ReturnType<typeof vi.fn>;
            } | undefined;
            if (!mocks) {
                throw new Error(
                    'lpBaseline.test.ts: mocks not initialised — did beforeEach run?'
                );
            }
            if (abiStr.includes('liquidity') && abiStr.includes('slot0')) {
                this.liquidity = mocks.poolLiquidity;
                this.slot0 = mocks.poolSlot0;
            } else {
                this.getReserves = mocks.pairGetReserves;
                this.totalSupply = mocks.pairTotalSupply;
            }
        }
    }
    return {
        ...actual,
        Contract: MockContract,
    };
});

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

interface StubChainContext {
    chain: { name: string };
    httpProvider: { getBlockNumber: ReturnType<typeof vi.fn> };
}

function buildCtx(blockNumber: number = 18000000): StubChainContext {
    return {
        chain: { name: 'eth' },
        httpProvider: {
            getBlockNumber: vi.fn().mockResolvedValue(blockNumber),
        },
    };
}

// Minimal DexConfig stubs — the production module only reads `dexType`.
const V2_DEX = { dexType: 'v2', name: 'uniswap-v2' };
const V3_DEX = { dexType: 'v3', name: 'uniswap-v3' };

beforeEach(() => {
    logInfo.mockClear();
    logWarn.mockClear();
    logError.mockClear();
    logFatal.mockClear();
    upsertRun.mockClear();
    getGet.mockClear();
    deleteRun.mockClear();

    pairGetReservesMock = vi.fn();
    pairTotalSupplyMock = vi.fn();
    poolLiquidityMock = vi.fn();
    poolSlot0Mock = vi.fn();

    // Expose the current-test mock instances to the MockContract class via
    // globalThis. The class body looks them up on every `new Contract(...)`
    // call, so this survives vitest's `mockReset: true` between tests.
    (globalThis as Record<string, unknown>).__antiRugLpBaselineMocks = {
        pairGetReserves: pairGetReservesMock,
        pairTotalSupply: pairTotalSupplyMock,
        poolLiquidity: poolLiquidityMock,
        poolSlot0: poolSlot0Mock,
    };
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 19 — lpBaseline module', () => {
    describe('snapshotLpBaseline — V2 path', () => {
        it('Test 1: V2 dex — calls getReserves + totalSupply; row has poolType=v2, V2 fields populated, V3 fields null', async () => {
            const { snapshotLpBaseline } = await import(
                '../../../src/anti-rug/lpBaseline'
            );

            // V2 returns: reserves array-like [reserve0, reserve1, blockTimestampLast]
            // (production code reads index 0 and 1; the ethers v6 array-style is
            // ARRAY indexed AND named, so .toString() works on the bigint values).
            pairGetReservesMock.mockResolvedValue([
                1000000000000000000n, // reserve0
                2000000000000000000n, // reserve1
                1700000000, // blockTimestampLast (unused)
            ]);
            pairTotalSupplyMock.mockResolvedValue(50000000000n);

            const ctx = buildCtx(18000001);
            await snapshotLpBaseline(
                ctx as unknown as Parameters<typeof snapshotLpBaseline>[0],
                V2_DEX as unknown as Parameters<typeof snapshotLpBaseline>[1],
                123,
                '0xPair0000000000000000000000000000000000Aa',
                null
            );

            expect(pairGetReservesMock).toHaveBeenCalledTimes(1);
            expect(pairTotalSupplyMock).toHaveBeenCalledTimes(1);
            expect(upsertRun).toHaveBeenCalledTimes(1);

            const row = upsertRun.mock.calls[0][0] as Record<string, unknown>;
            expect(row.tradeId).toBe(123);
            expect(row.poolType).toBe('v2');
            expect(row.v2Token0Reserve).toBe('1000000000000000000');
            expect(row.v2Token1Reserve).toBe('2000000000000000000');
            expect(row.v2LpTotalSupply).toBe('50000000000');
            expect(row.v3ActiveLiquidity).toBeNull();
            expect(row.v3TickAtSnapshot).toBeNull();
            expect(row.v3PositionNftId).toBeNull();
            expect(row.v3FeeTier).toBeNull();
        });
    });

    describe('snapshotLpBaseline — V3 path', () => {
        it('Test 2: V3 dex — calls liquidity + slot0; row has poolType=v3, V3 fields populated, V2 fields null', async () => {
            const { snapshotLpBaseline } = await import(
                '../../../src/anti-rug/lpBaseline'
            );

            poolLiquidityMock.mockResolvedValue(999999999999999999n);
            // slot0 returns the tuple shape declared in V3_POOL_ABI; production
            // reads index 1 for `tick` (int24).
            poolSlot0Mock.mockResolvedValue([
                0n, // sqrtPriceX96 (unused)
                -887272, // tick
                0,
                0,
                0,
                0,
                false,
            ]);

            const ctx = buildCtx(18000002);
            await snapshotLpBaseline(
                ctx as unknown as Parameters<typeof snapshotLpBaseline>[0],
                V3_DEX as unknown as Parameters<typeof snapshotLpBaseline>[1],
                456,
                '0xPool0000000000000000000000000000000000Bb',
                3000
            );

            expect(poolLiquidityMock).toHaveBeenCalledTimes(1);
            expect(poolSlot0Mock).toHaveBeenCalledTimes(1);

            const row = upsertRun.mock.calls[0][0] as Record<string, unknown>;
            expect(row.tradeId).toBe(456);
            expect(row.poolType).toBe('v3');
            expect(row.v3ActiveLiquidity).toBe('999999999999999999');
            expect(row.v3TickAtSnapshot).toBe(-887272);
            expect(row.v3FeeTier).toBe(3000);
            expect(row.v3PositionNftId).toBeNull(); // v6.17 pool-only baseline
            expect(row.v2Token0Reserve).toBeNull();
            expect(row.v2Token1Reserve).toBeNull();
            expect(row.v2LpTotalSupply).toBeNull();
        });
    });

    describe('snapshotLpBaseline — common fields', () => {
        it('Test 3: snapshot reads block from ctx.httpProvider.getBlockNumber() and writes unix ts', async () => {
            const { snapshotLpBaseline } = await import(
                '../../../src/anti-rug/lpBaseline'
            );
            pairGetReservesMock.mockResolvedValue([1n, 2n, 0]);
            pairTotalSupplyMock.mockResolvedValue(3n);

            const ctx = buildCtx(18555555);
            const beforeTs = Math.floor(Date.now() / 1000);
            await snapshotLpBaseline(
                ctx as unknown as Parameters<typeof snapshotLpBaseline>[0],
                V2_DEX as unknown as Parameters<typeof snapshotLpBaseline>[1],
                1,
                '0x' + 'a'.repeat(40),
                null
            );
            const afterTs = Math.floor(Date.now() / 1000);

            expect(ctx.httpProvider.getBlockNumber).toHaveBeenCalledTimes(1);
            const row = upsertRun.mock.calls[0][0] as Record<string, unknown>;
            expect(row.snapshotBlock).toBe(18555555);
            expect(row.snapshotTs).toBeGreaterThanOrEqual(beforeTs);
            expect(row.snapshotTs).toBeLessThanOrEqual(afterTs);
        });

        it('Test 4: pair_or_pool_address is lowercased before persisting (matches lp_baseline COLLATE NOCASE)', async () => {
            const { snapshotLpBaseline } = await import(
                '../../../src/anti-rug/lpBaseline'
            );
            pairGetReservesMock.mockResolvedValue([1n, 2n, 0]);
            pairTotalSupplyMock.mockResolvedValue(3n);

            const ctx = buildCtx();
            const mixedCase = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';
            await snapshotLpBaseline(
                ctx as unknown as Parameters<typeof snapshotLpBaseline>[0],
                V2_DEX as unknown as Parameters<typeof snapshotLpBaseline>[1],
                1,
                mixedCase,
                null
            );

            const row = upsertRun.mock.calls[0][0] as Record<string, unknown>;
            expect(row.pairOrPoolAddress).toBe(mixedCase.toLowerCase());
        });

        it("Test 5: structured pino log emitted with op:'antirug.lp-baseline.snapshot'", async () => {
            const { snapshotLpBaseline } = await import(
                '../../../src/anti-rug/lpBaseline'
            );
            pairGetReservesMock.mockResolvedValue([1n, 2n, 0]);
            pairTotalSupplyMock.mockResolvedValue(3n);

            const ctx = buildCtx(18000010);
            await snapshotLpBaseline(
                ctx as unknown as Parameters<typeof snapshotLpBaseline>[0],
                V2_DEX as unknown as Parameters<typeof snapshotLpBaseline>[1],
                42,
                '0x' + 'b'.repeat(40),
                null
            );

            expect(logInfo).toHaveBeenCalledTimes(1);
            const logArg = logInfo.mock.calls[0][0] as Record<string, unknown>;
            expect(logArg.op).toBe('antirug.lp-baseline.snapshot');
            expect(logArg.tradeId).toBe(42);
            expect(logArg.pool).toBe('0x' + 'b'.repeat(40));
            expect(logArg.snapshotBlock).toBe(18000010);
        });

        it('Test 6: RPC error from pair.getReserves() propagates (no silent swallow)', async () => {
            const { snapshotLpBaseline } = await import(
                '../../../src/anti-rug/lpBaseline'
            );

            const rpcErr = new Error('RPC: unreachable');
            pairGetReservesMock.mockRejectedValue(rpcErr);
            pairTotalSupplyMock.mockResolvedValue(0n);

            const ctx = buildCtx();
            await expect(
                snapshotLpBaseline(
                    ctx as unknown as Parameters<typeof snapshotLpBaseline>[0],
                    V2_DEX as unknown as Parameters<typeof snapshotLpBaseline>[1],
                    1,
                    '0x' + 'c'.repeat(40),
                    null
                )
            ).rejects.toThrow('RPC: unreachable');

            // upsertLpBaseline.run must NOT have been called when RPC failed
            expect(upsertRun).not.toHaveBeenCalled();
        });
    });

    describe('loadLpBaseline', () => {
        it('Test 7: returns null when no row exists', async () => {
            const { loadLpBaseline } = await import(
                '../../../src/anti-rug/lpBaseline'
            );

            // better-sqlite3 .get() returns undefined when no row matches.
            getGet.mockReturnValue(undefined);

            const result = loadLpBaseline(999);
            expect(result).toBeNull();
            expect(getGet).toHaveBeenCalledWith(999);
        });

        it('Test 8: returns camelCase LpBaselineRow when row exists', async () => {
            const { loadLpBaseline } = await import(
                '../../../src/anti-rug/lpBaseline'
            );

            // DB returns snake_case columns; loadLpBaseline maps to camelCase
            getGet.mockReturnValue({
                trade_id: 7,
                pool_type: 'v3',
                pair_or_pool_address: '0xpool',
                v2_token0_reserve: null,
                v2_token1_reserve: null,
                v2_lp_total_supply: null,
                v3_active_liquidity: '12345',
                v3_tick_at_snapshot: 100,
                v3_position_nft_id: null,
                v3_fee_tier: 3000,
                snapshot_block: 18000000,
                snapshot_ts: 1700000000,
            });

            const result = loadLpBaseline(7);
            expect(result).not.toBeNull();
            if (result === null) return; // type-narrow
            expect(result.tradeId).toBe(7);
            expect(result.poolType).toBe('v3');
            expect(result.pairOrPoolAddress).toBe('0xpool');
            expect(result.v3ActiveLiquidity).toBe('12345');
            expect(result.v3TickAtSnapshot).toBe(100);
            expect(result.v3FeeTier).toBe(3000);
            expect(result.v2Token0Reserve).toBeNull();
            expect(result.snapshotBlock).toBe(18000000);
            expect(result.snapshotTs).toBe(1700000000);
        });
    });

    describe('clearLpBaseline', () => {
        it('Test 9: returns the changes count (0 or 1) from deleteLpBaseline.run', async () => {
            const { clearLpBaseline } = await import(
                '../../../src/anti-rug/lpBaseline'
            );

            // First call: row existed, changes=1
            deleteRun.mockReturnValueOnce({ changes: 1 });
            expect(clearLpBaseline(123)).toBe(1);

            // Second call: no row, changes=0
            deleteRun.mockReturnValueOnce({ changes: 0 });
            expect(clearLpBaseline(999)).toBe(0);

            expect(deleteRun).toHaveBeenCalledTimes(2);
            expect(deleteRun).toHaveBeenNthCalledWith(1, 123);
            expect(deleteRun).toHaveBeenNthCalledWith(2, 999);
        });
    });
});
