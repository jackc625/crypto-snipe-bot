// test/integration/anti-rug/wsReconnectBackfill.test.ts
// Phase 19 / Plan 19-04c — Anti-rug WS lifecycle (heartbeat + reconnect +
// backfill + HTTP polling fallback + tiered D-VIS-WS-HEALTH alerts).
//
// Tests 21-29 (9 total):
//   - Heartbeat-dead → terminate → reconnect (Test 21)
//   - Reconnect → re-subscribe with same filter union (Test 22)
//   - Reconnect → backfill via getLogsForBackfill chunked (Test 23)
//   - Backfill gap > maxBackfillBlocks → FAIL CLOSED + GAP DETECTED alert (Test 24)
//   - Backfilled events evaluate but DO NOT call triggerAntiRugExit (Test 25)
//   - HTTP polling fallback when wsProvider===null (Test 26)
//   - D-VIS-WS-HEALTH tiered alerts:
//     - 3 consecutive reconnect failures → WS RECONNECT FAILED alert (Test 27)
//     - Disconnect >60s → WS DISCONNECTED >60s alert (Test 28)
//     - Backfill gap > max → GAP DETECTED alert message format (Test 29)
//
// Mock strategy (mirrors test/integration/wsReconnect.test.ts):
//   - vi.doMock('ethers', ...) — class-based MockWebSocketProvider tracks
//     constructor calls + on(filter, cb) / off / .websocket.on('close', ...) +
//     .websocket.on('pong', ...) + .websocket.ping() + .websocket.terminate() +
//     .destroy() — captures the lifecycle entry points the production code uses.
//   - vi.doMock('../../../src/utils/db', ...) — upsertChainState + getChainState
//     as spy stmts so we can assert (lastSeen, currentBlock) round-trips and
//     drive the gap-detected branch.
//   - vi.doMock('../../../src/utils/notifier', ...) — sendCtxAlert as a spy so
//     we can assert exact Telegram alert message format per D-VIS-WS-HEALTH.
//   - vi.doMock('../../../src/api/ws/broadcaster', ...) — broadcast spy for the
//     chain_ws_health_change + antirug_event events Plan 19-06 consumes.
//   - vi.doMock('../../../src/utils/provider', ...) — removeWsProvider spy for
//     clean reconnect verification.
//   - vi.doMock('../../../src/anti-rug/exitTrigger', ...) — triggerAntiRugExit
//     spy so Test 25 can assert NEVER-CALLED on backfilled events.
//   - vi.doMock('../../../src/anti-rug/lpBaseline', ...) + injected
//     evaluateRugSignals via the FOUNDATION's _setEvaluateRugSignalsForTesting
//     hook so test 25 can inject a `verdict:'unsafe'` evaluator without
//     reaching the real V2/V3 signal evaluation in 19-04b.
//   - vi.useFakeTimers() — drives the 30s heartbeat interval (Test 21) + the
//     60s disconnect threshold (Test 28).
//
// Each test gets a FRESH module instance via vi.resetModules() + vi.doMock + a
// dynamic await import() inside the test body — same module-isolation pattern
// as Phase 18 / Plan 19-04a/b tests.

import {
    describe,
    it,
    expect,
    vi,
    beforeEach,
    afterEach,
} from 'vitest';

// ---------------------------------------------------------------------------
// Shared spy declarations (assigned in beforeEach)
// ---------------------------------------------------------------------------

let logInfo: ReturnType<typeof vi.fn>;
let logWarn: ReturnType<typeof vi.fn>;
let logError: ReturnType<typeof vi.fn>;
let logFatal: ReturnType<typeof vi.fn>;
let logDebug: ReturnType<typeof vi.fn>;

let sendCtxAlertMock: ReturnType<typeof vi.fn>;
let broadcastMock: ReturnType<typeof vi.fn>;
let removeWsProviderMock: ReturnType<typeof vi.fn>;
let triggerAntiRugExitMock: ReturnType<typeof vi.fn>;
let loadLpBaselineMock: ReturnType<typeof vi.fn>;

let upsertChainStateRun: ReturnType<typeof vi.fn>;
let getChainStateGet: ReturnType<typeof vi.fn>;

// MockWebSocketProvider tracking — populated by the ethers mock factory.
interface MockWsInstance {
    url: string;
    chainId: number | undefined;
    onCalls: Array<[unknown, (logEvent: unknown) => void]>;
    offCalls: Array<[unknown, (logEvent: unknown) => void]>;
    destroyed: boolean;
    websocket: {
        isAlive: boolean;
        pingCount: number;
        terminateCount: number;
        // Event handlers registered via `.on(event, handler)`. We use Arrays
        // because the production code may register multiple handlers for the
        // same event (e.g. 'close' is registered by setupHeartbeat to clear
        // the interval AND by the parent reconnect path to start reconnecting).
        closeHandlers: Array<() => void>;
        pongHandlers: Array<() => void>;
        on(event: string, handler: () => void): void;
        ping(): void;
        terminate(): void;
    };
    on(filter: unknown, handler: (logEvent: unknown) => void): void;
    off(filter: unknown, handler: (logEvent: unknown) => void): void;
    destroy(): void;
}

let mockWsInstances: MockWsInstance[];
// Constructor-override toggle: when set to a number, the next N constructor
// calls THROW (used by Test 27 to drive 3 consecutive reconnect failures).
let constructorFailuresRemaining: number;
let constructorFailureError: Error;

// ---------------------------------------------------------------------------
// Per-test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();

    logInfo = vi.fn();
    logWarn = vi.fn();
    logError = vi.fn();
    logFatal = vi.fn();
    logDebug = vi.fn();

    sendCtxAlertMock = vi.fn().mockResolvedValue(undefined);
    broadcastMock = vi.fn();
    removeWsProviderMock = vi.fn();
    triggerAntiRugExitMock = vi.fn().mockResolvedValue(true);
    loadLpBaselineMock = vi.fn();

    upsertChainStateRun = vi.fn();
    getChainStateGet = vi.fn().mockReturnValue(undefined);

    mockWsInstances = [];
    constructorFailuresRemaining = 0;
    constructorFailureError = new Error('Mock WS construction rejected');

    vi.doMock('../../../src/utils/logger', () => ({
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

    vi.doMock('../../../src/utils/notifier', () => ({
        sendCtxAlert: sendCtxAlertMock,
    }));

    vi.doMock('../../../src/api/ws/broadcaster', () => ({
        broadcast: broadcastMock,
    }));

    vi.doMock('../../../src/utils/provider', () => ({
        removeWsProvider: removeWsProviderMock,
        // unused-but-imported by detector.ts in case the module shape grows
        getProvider: vi.fn(),
        getWsProvider: vi.fn(),
        getWallet: vi.fn(),
    }));

    vi.doMock('../../../src/anti-rug/exitTrigger', () => ({
        triggerAntiRugExit: triggerAntiRugExitMock,
    }));

    vi.doMock('../../../src/anti-rug/lpBaseline', () => ({
        loadLpBaseline: loadLpBaselineMock,
    }));

    // Capture upsertChainState.run + getChainState.get bindings.
    vi.doMock('../../../src/utils/db', () => ({
        upsertChainState: { run: upsertChainStateRun },
        getChainState: { get: getChainStateGet },
        // Stubs for any other db symbols that detector.ts may import.
        db: { prepare: vi.fn() },
        insertTrade: vi.fn(),
        updateTradeStatus: vi.fn(),
        isTokenSniped: vi.fn(),
        getOpenPositionCount: vi.fn(),
        getTotalExposure: vi.fn(),
        getDailyRealizedLoss: vi.fn(),
        upsertExitState: vi.fn(),
        getExitState: vi.fn(),
        deleteExitState: vi.fn(),
        getTradeIdForPendingToken: vi.fn(),
        upsertLpBaseline: { run: vi.fn() },
        getLpBaseline: { get: vi.fn() },
        deleteLpBaseline: { run: vi.fn() },
    }));

    // Mock ethers — class-based WebSocketProvider; bare-bones Contract.
    vi.doMock('ethers', async () => {
        const actual = await vi.importActual<typeof import('ethers')>('ethers');

        class MockWebSocketProvider {
            url: string;
            chainId: number | undefined;
            onCalls: Array<[unknown, (logEvent: unknown) => void]> = [];
            offCalls: Array<[unknown, (logEvent: unknown) => void]> = [];
            destroyed = false;
            websocket: MockWsInstance['websocket'];

            constructor(url: string, chainId?: number) {
                if (constructorFailuresRemaining > 0) {
                    constructorFailuresRemaining -= 1;
                    throw constructorFailureError;
                }
                this.url = url;
                this.chainId = chainId;
                const closeHandlers: Array<() => void> = [];
                const pongHandlers: Array<() => void> = [];
                // The detector code does `(rawWs as any).isAlive = true` —
                // we expose isAlive on websocket itself so the same `as any`
                // path can read/write it.
                this.websocket = {
                    isAlive: true,
                    pingCount: 0,
                    terminateCount: 0,
                    closeHandlers,
                    pongHandlers,
                    on(event: string, handler: () => void) {
                        if (event === 'close') closeHandlers.push(handler);
                        else if (event === 'pong') pongHandlers.push(handler);
                    },
                    ping() {
                        this.pingCount += 1;
                    },
                    terminate() {
                        this.terminateCount += 1;
                        // Fire 'close' handlers — production code wires the
                        // reconnect loop on close.
                        for (const h of closeHandlers) {
                            h();
                        }
                    },
                };
                mockWsInstances.push(this as unknown as MockWsInstance);
            }
            on(filter: unknown, handler: (logEvent: unknown) => void) {
                this.onCalls.push([filter, handler]);
            }
            off(filter: unknown, handler: (logEvent: unknown) => void) {
                this.offCalls.push([filter, handler]);
            }
            destroy() {
                this.destroyed = true;
            }
        }

        return {
            ...actual,
            WebSocketProvider: MockWebSocketProvider,
            // Contract — minimal mock; only used by the V2/V3 evaluator paths
            // which 19-04c does NOT exercise (we inject the evaluator shim
            // via _setEvaluateRugSignalsForTesting so the real evaluator is
            // never reached in these tests).
            Contract: class MockContract {
                constructor() {}
            },
        };
    });
});

afterEach(async () => {
    // Best-effort registry reset between tests.
    try {
        const mod = await import('../../../src/anti-rug/detector');
        if (typeof mod._resetRegistryForTesting === 'function') {
            mod._resetRegistryForTesting();
        }
    } catch {
        // Module may not have loaded — that's fine.
    }
    vi.useRealTimers();
    vi.doUnmock('../../../src/utils/logger');
    vi.doUnmock('../../../src/utils/notifier');
    vi.doUnmock('../../../src/api/ws/broadcaster');
    vi.doUnmock('../../../src/utils/provider');
    vi.doUnmock('../../../src/anti-rug/exitTrigger');
    vi.doUnmock('../../../src/anti-rug/lpBaseline');
    vi.doUnmock('../../../src/utils/db');
    vi.doUnmock('ethers');
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface StubChainCtx {
    chain: {
        name: string;
        displayName: string;
        chainId: number;
        wsRpcUrl: string | null;
        antiRug: {
            backfillCapBlocks: number;
            maxBackfillBlocks: number;
            lpRemovalPct: number;
            confirmBlocks: number;
            allowlistV2: unknown[];
            allowlistV3: unknown[];
        };
    };
    wsProvider: unknown;
    httpProvider: {
        getBlockNumber: ReturnType<typeof vi.fn>;
        getLogs: ReturnType<typeof vi.fn>;
        getCode: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
        off: ReturnType<typeof vi.fn>;
    };
}

function buildCtx(opts: {
    withWs?: boolean;
    backfillCapBlocks?: number;
    maxBackfillBlocks?: number;
    chainName?: string;
} = {}): StubChainCtx {
    const withWs = opts.withWs ?? true;
    return {
        chain: {
            name: opts.chainName ?? 'eth',
            displayName: '[ETH]',
            chainId: 1,
            wsRpcUrl: withWs ? 'wss://test.example.com' : null,
            antiRug: {
                backfillCapBlocks: opts.backfillCapBlocks ?? 10,
                maxBackfillBlocks: opts.maxBackfillBlocks ?? 7200,
                lpRemovalPct: 50,
                confirmBlocks: 0,
                allowlistV2: [],
                allowlistV3: [],
            },
        },
        // Constructing a real MockWebSocketProvider here ensures wsProvider
        // is a tracked instance with the same shape the production code uses.
        wsProvider: withWs ? null : null, // installed in beforeEach via the ethers mock
        httpProvider: {
            getBlockNumber: vi.fn().mockResolvedValue(18_000_000),
            getLogs: vi.fn().mockResolvedValue([]),
            getCode: vi.fn().mockResolvedValue('0x60'),
            on: vi.fn(),
            off: vi.fn(),
        },
    };
}

// Build a ctx and instantiate a fresh MockWebSocketProvider for it.
async function buildCtxWithWs(opts: {
    backfillCapBlocks?: number;
    maxBackfillBlocks?: number;
    chainName?: string;
} = {}): Promise<{ ctx: StubChainCtx; wsProvider: MockWsInstance }> {
    const ctx = buildCtx({ ...opts, withWs: true });
    const ethers = await import('ethers');
    const ws = new ethers.WebSocketProvider(ctx.chain.wsRpcUrl!, ctx.chain.chainId);
    ctx.wsProvider = ws;
    return { ctx, wsProvider: ws as unknown as MockWsInstance };
}

function makeBaseline(poolType: 'v2' | 'v3', addr: string, tradeId: number) {
    return {
        tradeId,
        poolType,
        pairOrPoolAddress: addr.toLowerCase(),
        v2Token0Reserve: poolType === 'v2' ? '1000000000000000000' : null,
        v2Token1Reserve: poolType === 'v2' ? '2000000000000000000' : null,
        v2LpTotalSupply: poolType === 'v2' ? '1000000000' : null,
        v3ActiveLiquidity: poolType === 'v3' ? '1000000000000000000' : null,
        v3TickAtSnapshot: poolType === 'v3' ? 100 : null,
        v3PositionNftId: null,
        v3FeeTier: poolType === 'v3' ? 3000 : null,
        snapshotBlock: 18_000_000,
        snapshotTs: 1_700_000_000,
    };
}

const V2_DEX = {
    dexType: 'v2' as const,
    name: 'uniswap-v2',
    factoryAddress: '0xf000000000000000000000000000000000000001',
    routerAddress: '0xf000000000000000000000000000000000000002',
};

// ===========================================================================
// Heartbeat — Test 21
// ===========================================================================

describe('Phase 19 — Anti-rug WS lifecycle: heartbeat', () => {
    it('Test 21: heartbeat-dead path — isAlive=false at next interval → ws.terminate() → close fires reconnect', async () => {
        vi.useFakeTimers();

        const mod = await import('../../../src/anti-rug/detector');
        const { ctx, wsProvider } = await buildCtxWithWs();
        const pair = '0xaaaa0000000000000000000000000000000000a1';

        loadLpBaselineMock.mockReturnValueOnce(makeBaseline('v2', pair, 21));
        await mod.registerAntiRugPosition(
            ctx as unknown as Parameters<typeof mod.registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof mod.registerAntiRugPosition>[1],
            '0xToken210000000000000000000000000000000000',
            pair,
            21,
            null,
        );
        // No prior chain_state — backfill returns early.
        getChainStateGet.mockReturnValue(undefined);
        await mod.startChainAntiRugListener(
            ctx as unknown as Parameters<typeof mod.startChainAntiRugListener>[0],
        );

        // Sanity: one WS subscription installed.
        expect(wsProvider.onCalls.length).toBeGreaterThan(0);
        // Sanity: heartbeat 'pong' handler registered + a 'close' handler registered.
        expect(wsProvider.websocket.pongHandlers.length).toBeGreaterThan(0);
        expect(wsProvider.websocket.closeHandlers.length).toBeGreaterThan(0);

        // First heartbeat tick: marks isAlive=false + ping().
        wsProvider.websocket.isAlive = true;
        await vi.advanceTimersByTimeAsync(30_000);
        expect(wsProvider.websocket.pingCount).toBeGreaterThanOrEqual(1);
        // After ping, isAlive was set to false by the heartbeat tick (per the
        // canonical pattern: `(rawWs as any).isAlive = false; rawWs.ping();`).
        expect(wsProvider.websocket.isAlive).toBe(false);

        // Force the second tick — production code does:
        //   if ((rawWs as any).isAlive === false) return ws.terminate();
        // Capture the existing terminate count to assert progress.
        const terminateCountBefore = wsProvider.websocket.terminateCount;
        await vi.advanceTimersByTimeAsync(30_000);
        // ws.terminate() was called because no pong arrived between intervals.
        expect(wsProvider.websocket.terminateCount).toBeGreaterThan(
            terminateCountBefore,
        );
        // Terminate fires the 'close' handler, which triggers the reconnect
        // path. A new WebSocketProvider instance was constructed.
        // (Even if reconnect is awaited internally, the construction must
        // have happened before the reconnect await returns.)
        await vi.runAllTimersAsync();
        expect(mockWsInstances.length).toBeGreaterThanOrEqual(2);
    });
});

// ===========================================================================
// Reconnect — Tests 22, 27
// ===========================================================================

describe('Phase 19 — Anti-rug WS lifecycle: reconnect', () => {
    it('Test 22: reconnect re-subscribes with the same filter (address-union + topic-union) on the new wsProvider', async () => {
        vi.useFakeTimers();

        const mod = await import('../../../src/anti-rug/detector');
        const { ctx, wsProvider } = await buildCtxWithWs();
        const pair = '0xbbbb0000000000000000000000000000000000a2';

        loadLpBaselineMock.mockReturnValueOnce(makeBaseline('v2', pair, 22));
        await mod.registerAntiRugPosition(
            ctx as unknown as Parameters<typeof mod.registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof mod.registerAntiRugPosition>[1],
            '0xToken220000000000000000000000000000000000',
            pair,
            22,
            null,
        );
        getChainStateGet.mockReturnValue(undefined);
        await mod.startChainAntiRugListener(
            ctx as unknown as Parameters<typeof mod.startChainAntiRugListener>[0],
        );

        // Capture the original filter from the initial subscription.
        const originalFilter = wsProvider.onCalls[wsProvider.onCalls.length - 1][0] as {
            address: string[];
            topics: string[][];
        };
        expect(originalFilter.address).toContain(pair.toLowerCase());

        // Fire 'close' on the original ws to trigger the reconnect path.
        for (const h of wsProvider.websocket.closeHandlers) {
            h();
        }
        // Reconnect uses exponential backoff starting at 1s; drive it.
        await vi.runAllTimersAsync();

        // A new wsProvider was constructed.
        expect(mockWsInstances.length).toBeGreaterThanOrEqual(2);
        const newWs = mockWsInstances[mockWsInstances.length - 1];

        // The new ws has a fresh .on() call with the same filter union.
        expect(newWs.onCalls.length).toBeGreaterThan(0);
        const newFilter = newWs.onCalls[newWs.onCalls.length - 1][0] as {
            address: string[];
            topics: string[][];
        };
        // Same address union.
        expect(newFilter.address).toEqual(originalFilter.address);
        // Topic union preserved across reconnect.
        expect(newFilter.topics.length).toBe(originalFilter.topics.length);
        expect(newFilter.topics[0]).toEqual(originalFilter.topics[0]);
        // Reconnect succeeded — health broadcast went out.
        expect(broadcastMock).toHaveBeenCalledWith(
            'chain_ws_health_change',
            expect.objectContaining({ state: 'connected' }),
        );
    });

    it('Test 27: 3 consecutive WebSocketProvider construction failures → WS RECONNECT FAILED Telegram alert (D-VIS-WS-HEALTH)', async () => {
        vi.useFakeTimers();

        const mod = await import('../../../src/anti-rug/detector');
        const { ctx, wsProvider } = await buildCtxWithWs();
        const pair = '0xcccc0000000000000000000000000000000000a3';

        loadLpBaselineMock.mockReturnValueOnce(makeBaseline('v2', pair, 27));
        await mod.registerAntiRugPosition(
            ctx as unknown as Parameters<typeof mod.registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof mod.registerAntiRugPosition>[1],
            '0xToken270000000000000000000000000000000000',
            pair,
            27,
            null,
        );
        getChainStateGet.mockReturnValue(undefined);
        await mod.startChainAntiRugListener(
            ctx as unknown as Parameters<typeof mod.startChainAntiRugListener>[0],
        );

        // Force the next 3 WebSocketProvider constructions to throw.
        constructorFailuresRemaining = 3;
        // Fire 'close' on the original ws to trigger reconnect.
        for (const h of wsProvider.websocket.closeHandlers) {
            h();
        }
        // Drive the exponential backoff: 1s + 2s + 4s + 8s = 15s should cover
        // the first 4 attempts. (We use runAllTimersAsync to fully drain the
        // backoff queue, including the eventual successful attempt on retry 4.)
        await vi.runAllTimersAsync();

        // sendCtxAlert was called with the WS RECONNECT FAILED message format.
        const reconnectFailedCall = sendCtxAlertMock.mock.calls.find(
            (c) =>
                typeof c[1] === 'string' &&
                c[1].includes('[WS RECONNECT FAILED]') &&
                c[1].includes('3 consecutive reconnect attempts failed'),
        );
        expect(reconnectFailedCall).toBeTruthy();
        // Chain name in the alert.
        expect(reconnectFailedCall![1] as string).toContain('eth');
        // After eventual success, a new ws was installed.
        const successfulInstances = mockWsInstances.filter((w) => !w.destroyed);
        expect(successfulInstances.length).toBeGreaterThanOrEqual(2);
    });

    it('Test 28: disconnect duration >60s → WS DISCONNECTED >60s alert (D-VIS-WS-HEALTH)', async () => {
        vi.useFakeTimers();

        const mod = await import('../../../src/anti-rug/detector');
        const { ctx, wsProvider } = await buildCtxWithWs();
        const pair = '0xdddd0000000000000000000000000000000000a4';

        loadLpBaselineMock.mockReturnValueOnce(makeBaseline('v2', pair, 28));
        await mod.registerAntiRugPosition(
            ctx as unknown as Parameters<typeof mod.registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof mod.registerAntiRugPosition>[1],
            '0xToken280000000000000000000000000000000000',
            pair,
            28,
            null,
        );
        getChainStateGet.mockReturnValue(undefined);
        await mod.startChainAntiRugListener(
            ctx as unknown as Parameters<typeof mod.startChainAntiRugListener>[0],
        );

        // Make ALL subsequent constructor attempts fail so the reconnect loop
        // keeps spinning past the 60s threshold.
        constructorFailuresRemaining = 100; // effectively infinite
        // Fire 'close' to trigger reconnect.
        for (const h of wsProvider.websocket.closeHandlers) {
            h();
        }
        // Advance time past the 60s threshold — backoff sequence
        // 1+2+4+8+16+32+60+60 = 183s; 90s is enough to fire the >60s alert
        // (which checks elapsed disconnected duration on every retry).
        await vi.advanceTimersByTimeAsync(90_000);

        // sendCtxAlert called with WS DISCONNECTED >60s.
        const disconnect60sCall = sendCtxAlertMock.mock.calls.find(
            (c) =>
                typeof c[1] === 'string' &&
                c[1].includes('[WS DISCONNECTED >60s]'),
        );
        expect(disconnect60sCall).toBeTruthy();
        // Chain name + UNMONITORED phrasing in the alert.
        const msg = disconnect60sCall![1] as string;
        expect(msg).toContain('eth');
        expect(msg).toContain('UNMONITORED');

        // chain_ws_health_change broadcast with state='disconnected'.
        const disconnectedHealthCall = broadcastMock.mock.calls.find(
            (c) =>
                c[0] === 'chain_ws_health_change' &&
                (c[1] as { state?: string }).state === 'disconnected',
        );
        expect(disconnectedHealthCall).toBeTruthy();
    });
});

// ===========================================================================
// Backfill — Tests 23, 24, 25, 29
// ===========================================================================

describe('Phase 19 — Anti-rug WS lifecycle: backfillSinceLastSeen', () => {
    it('Test 23: post-reconnect backfill calls getLogsForBackfill with (lastSeen+1, current, addresses, topics) — chunked via cap=10', async () => {
        vi.useFakeTimers();

        const mod = await import('../../../src/anti-rug/detector');
        const { ctx, wsProvider } = await buildCtxWithWs({ backfillCapBlocks: 10 });
        const pair = '0xeeee0000000000000000000000000000000000a5';

        loadLpBaselineMock.mockReturnValueOnce(makeBaseline('v2', pair, 23));
        await mod.registerAntiRugPosition(
            ctx as unknown as Parameters<typeof mod.registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof mod.registerAntiRugPosition>[1],
            '0xToken230000000000000000000000000000000000',
            pair,
            23,
            null,
        );

        // Chain state shows lastSeen=18_000_000; current returns 18_000_030 → gap of 30 blocks.
        getChainStateGet.mockReturnValue({
            last_seen_block: 18_000_000,
            last_updated_ts: 1_700_000_000,
        });
        ctx.httpProvider.getBlockNumber.mockResolvedValue(18_000_030);
        ctx.httpProvider.getLogs.mockResolvedValue([]); // no events to evaluate

        // Trigger reconnect → backfill path.
        for (const h of wsProvider.websocket.closeHandlers) {
            h();
        }
        await vi.runAllTimersAsync();

        // backfill called getLogs in chunks of cap=10.
        // gap=30 → calls cover [18_000_001, 18_000_010], [18_000_011, 18_000_020],
        // [18_000_021, 18_000_030] = 3 chunks.
        const getLogsCalls = ctx.httpProvider.getLogs.mock.calls;
        expect(getLogsCalls.length).toBe(3);
        const callTuples = getLogsCalls.map((c) => {
            const param = c[0] as { fromBlock: number; toBlock: number };
            return [param.fromBlock, param.toBlock];
        });
        expect(callTuples).toEqual([
            [18_000_001, 18_000_010],
            [18_000_011, 18_000_020],
            [18_000_021, 18_000_030],
        ]);

        // chain_state.last_seen_block updated to the current block.
        expect(upsertChainStateRun).toHaveBeenCalledWith(
            'eth',
            18_000_030,
            expect.any(Number),
        );
    });

    it('Test 24: backfill gap > maxBackfillBlocks → FAIL CLOSED (no getLogs calls); GAP DETECTED alert + broadcast', async () => {
        vi.useFakeTimers();

        const mod = await import('../../../src/anti-rug/detector');
        const { ctx, wsProvider } = await buildCtxWithWs({
            backfillCapBlocks: 10,
            maxBackfillBlocks: 7200,
        });
        const pair = '0xffff0000000000000000000000000000000000a6';

        loadLpBaselineMock.mockReturnValueOnce(makeBaseline('v2', pair, 24));
        await mod.registerAntiRugPosition(
            ctx as unknown as Parameters<typeof mod.registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof mod.registerAntiRugPosition>[1],
            '0xToken240000000000000000000000000000000000',
            pair,
            24,
            null,
        );

        // Gap = 99_000 blocks — far exceeds maxBackfillBlocks=7200.
        getChainStateGet.mockReturnValue({
            last_seen_block: 17_900_000,
            last_updated_ts: 1_700_000_000,
        });
        ctx.httpProvider.getBlockNumber.mockResolvedValue(18_000_000);

        // Trigger reconnect → backfill.
        for (const h of wsProvider.websocket.closeHandlers) {
            h();
        }
        await vi.runAllTimersAsync();

        // FAIL CLOSED: no getLogs calls made.
        expect(ctx.httpProvider.getLogs).not.toHaveBeenCalled();

        // GAP DETECTED Telegram alert.
        const gapAlert = sendCtxAlertMock.mock.calls.find(
            (c) =>
                typeof c[1] === 'string' &&
                c[1].includes('[GAP DETECTED]'),
        );
        expect(gapAlert).toBeTruthy();
        const msg = gapAlert![1] as string;
        expect(msg).toContain('eth');
        expect(msg).toContain('100000'); // gap blocks count
        expect(msg).toContain('17900000-18000000'); // range

        // antirug_event broadcast with kind='gap-detected'.
        const gapBroadcast = broadcastMock.mock.calls.find(
            (c) =>
                c[0] === 'antirug_event' &&
                (c[1] as { kind?: string }).kind === 'gap-detected',
        );
        expect(gapBroadcast).toBeTruthy();
    });

    it('Test 25: backfilled events with verdict=unsafe log antirug.backfill.too-late + broadcast outcome=too-late; NEVER call triggerAntiRugExit', async () => {
        vi.useFakeTimers();

        const mod = await import('../../../src/anti-rug/detector');
        // Inject a verdict='unsafe' evaluator so backfilled events trip the
        // "too-late" branch deterministically.
        mod._setEvaluateRugSignalsForTesting(
            vi.fn().mockResolvedValue({
                verdict: 'unsafe',
                reason: 'three-signal-trigger',
                signals: {
                    lpRemovedPct: 90,
                    destination: '0xattacker',
                    allowlistHit: 'unsafe',
                    sellSimSlippagePct: null,
                    v2ReservePctBelow: 80,
                },
            }),
        );

        const { ctx, wsProvider } = await buildCtxWithWs({ backfillCapBlocks: 10 });
        const pair = '0x1111000000000000000000000000000000000aa7';

        loadLpBaselineMock.mockReturnValueOnce(makeBaseline('v2', pair, 25));
        await mod.registerAntiRugPosition(
            ctx as unknown as Parameters<typeof mod.registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof mod.registerAntiRugPosition>[1],
            '0xToken250000000000000000000000000000000000',
            pair,
            25,
            null,
        );

        getChainStateGet.mockReturnValue({
            last_seen_block: 18_000_000,
            last_updated_ts: 1_700_000_000,
        });
        ctx.httpProvider.getBlockNumber.mockResolvedValue(18_000_005);
        // Backfill returns one synthetic event for the registered pair.
        const syntheticBurnLog = {
            address: pair,
            topics: ['0xtopicburn'],
            data: '0x',
            blockNumber: 18_000_003,
        };
        ctx.httpProvider.getLogs.mockResolvedValue([syntheticBurnLog]);

        for (const h of wsProvider.websocket.closeHandlers) {
            h();
        }
        await vi.runAllTimersAsync();

        // CRITICAL: triggerAntiRugExit NEVER called on backfilled events.
        expect(triggerAntiRugExitMock).not.toHaveBeenCalled();

        // antirug.backfill.too-late log line emitted at warn level.
        const tooLateLog = logWarn.mock.calls.find(
            (c) =>
                typeof c[0] === 'object' &&
                c[0] !== null &&
                (c[0] as { op?: string }).op === 'antirug.backfill.too-late',
        );
        expect(tooLateLog).toBeTruthy();

        // antirug_event broadcast with outcome='too-late' + kind='trigger'.
        const tooLateBroadcast = broadcastMock.mock.calls.find(
            (c) =>
                c[0] === 'antirug_event' &&
                (c[1] as { outcome?: string }).outcome === 'too-late',
        );
        expect(tooLateBroadcast).toBeTruthy();
    });

    it('Test 29: GAP DETECTED alert format matches CONTEXT.md D-VIS-WS-HEALTH wording', async () => {
        vi.useFakeTimers();

        const mod = await import('../../../src/anti-rug/detector');
        const { ctx, wsProvider } = await buildCtxWithWs({
            backfillCapBlocks: 10,
            maxBackfillBlocks: 7200,
        });
        const pair = '0x2222000000000000000000000000000000000aa8';

        loadLpBaselineMock.mockReturnValueOnce(makeBaseline('v2', pair, 29));
        await mod.registerAntiRugPosition(
            ctx as unknown as Parameters<typeof mod.registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof mod.registerAntiRugPosition>[1],
            '0xToken290000000000000000000000000000000000',
            pair,
            29,
            null,
        );

        // Exact gap = 10000 blocks, exceeds max=7200.
        getChainStateGet.mockReturnValue({
            last_seen_block: 17_990_000,
            last_updated_ts: 1_700_000_000,
        });
        ctx.httpProvider.getBlockNumber.mockResolvedValue(18_000_000);

        for (const h of wsProvider.websocket.closeHandlers) {
            h();
        }
        await vi.runAllTimersAsync();

        const gapAlert = sendCtxAlertMock.mock.calls.find(
            (c) =>
                typeof c[1] === 'string' &&
                c[1].includes('[GAP DETECTED]'),
        );
        expect(gapAlert).toBeTruthy();
        const msg = gapAlert![1] as string;
        // Verbatim phrasing per CONTEXT.md D-VIS-WS-HEALTH (Warning 9):
        //   '[GAP DETECTED] {chain} missed {N} blocks ({lastSeen}-{currentBlock}); backfill skipped per D-BACKFILL fail-closed; review anti-rug events manually'
        expect(msg).toMatch(/\[GAP DETECTED\]/);
        expect(msg).toMatch(/missed 10000 blocks/);
        expect(msg).toMatch(/\(17990000-18000000\)/);
        expect(msg).toMatch(/backfill skipped/);
        expect(msg).toMatch(/D-BACKFILL fail-closed/);
        expect(msg).toMatch(/review anti-rug events manually/);
    });
});

// ===========================================================================
// HTTP polling fallback — Test 26
// ===========================================================================

describe('Phase 19 — Anti-rug WS lifecycle: HTTP polling fallback', () => {
    it('Test 26: ctx.wsProvider===null → startChainAntiRugListener uses HTTP polling; updates chain_state.last_seen_block per poll', async () => {
        vi.useFakeTimers();

        const mod = await import('../../../src/anti-rug/detector');
        const ctx = buildCtx({ withWs: false });
        const pair = '0x3333000000000000000000000000000000000aa9';

        loadLpBaselineMock.mockReturnValueOnce(makeBaseline('v2', pair, 26));
        await mod.registerAntiRugPosition(
            ctx as unknown as Parameters<typeof mod.registerAntiRugPosition>[0],
            V2_DEX as unknown as Parameters<typeof mod.registerAntiRugPosition>[1],
            '0xToken260000000000000000000000000000000000',
            pair,
            26,
            null,
        );

        // Initial poll: block 18_000_000; next poll: 18_000_005.
        let pollIdx = 0;
        ctx.httpProvider.getBlockNumber.mockImplementation(async () => {
            pollIdx += 1;
            if (pollIdx === 1) return 18_000_000;
            return 18_000_005;
        });
        ctx.httpProvider.getLogs.mockResolvedValue([]);

        // Trigger the HTTP polling fallback by starting the listener.
        getChainStateGet.mockReturnValue(undefined);
        await mod.startChainAntiRugListener(
            ctx as unknown as Parameters<typeof mod.startChainAntiRugListener>[0],
        );

        // Advance through one poll tick (default 2s like bot.ts:758-810).
        await vi.advanceTimersByTimeAsync(2_500);

        // upsertChainState.run called with the new block.
        const upsertCall = upsertChainStateRun.mock.calls.find(
            (c) => c[0] === 'eth' && c[1] === 18_000_005,
        );
        expect(upsertCall).toBeTruthy();

        // getLogs was called for the poll window.
        expect(ctx.httpProvider.getLogs).toHaveBeenCalled();
    });
});
