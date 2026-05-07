// test/integration/v3LiquidityWait.test.ts
// Phase 17 / DEBT-05 retroactive harm-prevention: V3-02 liquidity wait drops snipe on Mint timeout.
// EXCLUDES V3-03 (V3 sell-sim) — addressed in HONEY-08 fresh implementation per Pitfall #19.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture the logger.info mock so we can assert on the structured payload + message.
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();

// Capture WebSocketProvider/Contract calls for the never-emit-Mint scenario.
// We mock ethers' Contract: pool.queryFilter resolves to [] (no same-block Mint),
// and the wsPool subscription's `.on('Mint', cb)` is registered but the cb is NEVER fired
// — vi.useFakeTimers() will advance past the 30s timeout to trigger the resolve(false) path.
const queryFilterMock = vi.fn().mockResolvedValue([]); // no same-block mint
const onMock = vi.fn(); // subscription registered but never invoked
const removeAllListenersMock = vi.fn();
const filtersMintMock = vi.fn().mockReturnValue({});

class MockContract {
    filters = { Mint: filtersMintMock };
    queryFilter = queryFilterMock;
    on = onMock;
    removeAllListeners = removeAllListenersMock;
}

vi.doMock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    return {
        ...actual,
        Contract: MockContract,
    };
});

vi.doMock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: loggerInfoMock,
            warn: loggerWarnMock,
            debug: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        }),
        info: loggerInfoMock,
        warn: loggerWarnMock,
    },
}));

// WR-03: Mock src/utils/db so that importing bot.ts does NOT open the
// production SQLite database (data/bot.db) as a side effect. Without this,
// the dynamic `import('../../src/bot')` below transitively triggers
// `new Database(DB_PATH)` plus migrateSchema/migrateJsonState/
// normalizeLegacyMainnetRows at module-load time, generating WAL/SHM
// I/O for every test run. waitForLiquidity is a pure-function test —
// no DB interaction is required or desired. Other transitive db importers
// (exitEngine, riskManager) also pick up this mock because vi.doMock
// applies module-wide before the dynamic import resolves.
vi.doMock('../../src/utils/db', () => {
    // db.prepare(...) is invoked at module-load time by transitively imported
    // modules (e.g., src/riskManager.ts:48). Return a Statement-shaped stub.
    const stmt = { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
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
    };
});

describe('Phase 5 harm-prevention: V3-02 liquidity wait drops snipe on Mint timeout (V3-03 EXCLUDED)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        loggerInfoMock.mockReset();
        loggerWarnMock.mockReset();
        queryFilterMock.mockReset().mockResolvedValue([]);
        onMock.mockReset();
        removeAllListenersMock.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('waitForLiquidity resolves to false AND logs "Mint timeout (30s), dropping opportunity" when no Mint event arrives within 30s', async () => {
        // Re-import bot.ts AFTER mocks are registered (option (a) — waitForLiquidity must be export-marked at src/bot.ts:86).
        const bot = await import('../../src/bot');

        // Construct a minimal mock ChainContext for the function under test.
        // The real type from src/types is loose enough at module boundary for an `as any` cast
        // — D-04 rigor is preserved by the observable effects asserted below, NOT the type strictness.
        const mockCtx = {
            chain: { name: 'eth' },
            httpProvider: {} as unknown,
            wsProvider: {} as unknown,
            log: {
                info: loggerInfoMock,
                warn: loggerWarnMock,
                debug: vi.fn(),
                error: vi.fn(),
            },
        } as unknown as Parameters<typeof bot.waitForLiquidity>[0];

        const poolAddress = '0xpool0000000000000000000000000000000000000000';
        const blockNumber = 12_345_678;

        // Call waitForLiquidity; it returns a Promise<boolean> that resolves AFTER the 30s timeout fires.
        const resultPromise = bot.waitForLiquidity(mockCtx, poolAddress, blockNumber);

        // Allow microtask queue to drain so the same-block queryFilter resolves and the subscription is set up.
        await Promise.resolve();
        await Promise.resolve();

        // Advance fake timers past 30s — fires the setTimeout callback inside waitForLiquidity, resolving false.
        await vi.advanceTimersByTimeAsync(31_000);

        const result = await resultPromise;

        // D-04 observable effect 1: function returned false (no Mint received in window).
        expect(result).toBe(false);

        // D-04 observable effect 2: structured pino info emitted with the timeout drop message (src/bot.ts:110).
        expect(loggerInfoMock).toHaveBeenCalledWith(
            expect.objectContaining({ pool: poolAddress }),
            'Mint timeout (30s), dropping opportunity',
        );

        // D-04 observable effect 3: pool subscription was registered for 'Mint' (proves the subscribe-and-wait path was exercised).
        expect(onMock).toHaveBeenCalledWith('Mint', expect.any(Function));
    });
});
