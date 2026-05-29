// test/unit/bot/exitFailedHeldResume.test.ts
// Phase 21.2 / Plan 21.2-11 / STOP-THE-LINE-04-D (finding S-1) — the restart-resume
// READ side for exit_failed_held positions.
//
// THE BUG THIS PROVES FIXED (surfaced by the 21.2-10 fork-rehearsal gate):
// 21.2-07 persists a failed-still-held position as exit_state.exit_status=
// 'exit_failed_held' and KEEPS anti-rug + re-arms the poll timer AT RUNTIME, but
// the balance-truth catch stamps trades.status='failed' for operator visibility
// (exitEngine.ts:1054). Both reboot scans USED to select `status='pending' AND
// action='buy'` ONLY, and exit_status was read NOWHERE on restart — so a catch-path
// exit_failed_held row was SILENTLY DROPPED on reboot: no exit monitor, no anti-rug
// (the LADYS-class harm T-21.2-DROPRUG surviving a restart). 21.2-11 wires the read
// side: getResumeExitMonitorTrades / getResumeAntiRugTrades union the
// exit_failed_held set back into BOTH scans.
//
// OBSERVABLE-EFFECT tests (no hollow expect(true)):
//
//   Test A (re-monitor): a trades row status='failed' WITH an exit_failed_held
//     exit_state row AND balanceOf > 0 → resumeMultiChainMonitoring RE-ENTERS it
//     (resumeExitMonitor is called for it). Proven via the observable resume call.
//   Test B (re-register anti-rug): the same exit_failed_held position →
//     resumeAntiRugMonitoring RE-SUBSCRIBES its anti-rug (registerAntiRugPosition
//     runs for it). Proven via the observable register call.
//   Test C (no resurrection): an exit_failed_held row whose balanceOf is now ~0
//     (genuinely closed since) is NOT re-monitored — the balanceOf===0 guard still
//     wins (updateTradeStatus('failed'), no resumeExitMonitor). The fix does NOT
//     resurrect closed positions (T-21.2-RESURRECT).
//   Test D (no regression): a normal status='pending' buy with NO exit_state still
//     resumes exactly as before in BOTH scans; the union only ADDS failed-held rows.
//
// Strategy: drive the two EXPORTED reboot scans (resumeMultiChainMonitoring /
// resumeAntiRugMonitoring) directly with all of bot.ts's heavy imports mocked.
// The new db exports (getResumeExitMonitorTrades / getResumeAntiRugTrades) are the
// rows the production scan reads — the test injects through THEM, the exact
// statements the production code now calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// -----------------------------------------------------------------------------
// Mocks — declared via vi.hoisted so the hoisted vi.mock factories can capture
// them before the bot.ts module graph loads.
// -----------------------------------------------------------------------------

const {
    resumeExitMonitorMock,
    registerAntiRugPositionMock,
    startChainAntiRugListenerMock,
    verifyAllowlistAtStartupMock,
    updateTradeStatusRunMock,
    getResumeExitMonitorAllMock,
    getResumeAntiRugAllMock,
    balanceOfMock,
} = vi.hoisted(() => ({
    resumeExitMonitorMock: vi.fn().mockResolvedValue(undefined),
    registerAntiRugPositionMock: vi.fn().mockResolvedValue(undefined),
    startChainAntiRugListenerMock: vi.fn().mockResolvedValue(undefined),
    verifyAllowlistAtStartupMock: vi.fn().mockResolvedValue(undefined),
    updateTradeStatusRunMock: vi.fn(),
    getResumeExitMonitorAllMock: vi.fn().mockReturnValue([]),
    getResumeAntiRugAllMock: vi.fn().mockReturnValue([]),
    balanceOfMock: vi.fn().mockResolvedValue(1_000n),
}));

vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), debug: vi.fn() }),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('../../../src/exitEngine', () => ({
    startExitMonitor: vi.fn().mockResolvedValue(undefined),
    resumeExitMonitor: resumeExitMonitorMock,
    executeFullSell: vi.fn(),
    setExitWorkerWatchdog: vi.fn(),
}));

vi.mock('../../../src/anti-rug/detector', () => ({
    registerAntiRugPosition: registerAntiRugPositionMock,
    startChainAntiRugListener: startChainAntiRugListenerMock,
    unregisterAntiRugPosition: vi.fn(),
}));

vi.mock('../../../src/anti-rug/allowlist', () => ({
    verifyAllowlistAtStartup: verifyAllowlistAtStartupMock,
    mergeAllowlist: vi.fn().mockReturnValue([]),
    isAddressAllowlisted: vi.fn().mockReturnValue({ verdict: 'unknown' }),
}));

vi.mock('../../../src/anti-rug/lpBaseline', () => ({
    snapshotLpBaseline: vi.fn().mockResolvedValue(undefined),
    loadLpBaseline: vi.fn(),
    clearLpBaseline: vi.fn(),
}));

// db mock: back the two NEW restart-resume statements + the bits bot.ts uses.
vi.mock('../../../src/utils/db', () => ({
    db: { prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), get: vi.fn(), run: vi.fn() }) },
    insertTrade: { run: vi.fn() },
    isTokenSniped: { get: vi.fn().mockReturnValue(undefined) },
    updateTradeStatus: { run: updateTradeStatusRunMock },
    getTradeIdForPendingToken: { get: vi.fn() },
    getResumeExitMonitorTrades: { all: getResumeExitMonitorAllMock },
    getResumeAntiRugTrades: { all: getResumeAntiRugAllMock },
    getPauseState: { get: vi.fn() },
    setPauseState: { run: vi.fn() },
    forceWalCheckpoint: vi.fn(),
    closeDb: vi.fn(),
    getOpenPositionCount: { get: vi.fn() },
    getTotalExposure: { get: vi.fn() },
    getDailyRealizedLoss: { get: vi.fn() },
    upsertExitState: { run: vi.fn() },
    getExitState: { get: vi.fn() },
    deleteExitState: { run: vi.fn() },
    markExitFailedHeld: { run: vi.fn() },
    getStaleTradesQuery: { all: vi.fn().mockReturnValue([]) },
    upsertLpBaseline: { run: vi.fn() },
    getLpBaseline: { get: vi.fn() },
    deleteLpBaseline: { run: vi.fn() },
    upsertChainState: { run: vi.fn() },
    getChainState: { get: vi.fn() },
    setAntirugDryRunStarted: { run: vi.fn() },
    getAntirugDryRunStarted: { get: vi.fn().mockReturnValue(undefined) },
}));

// Heavyweight transitive imports — silence them (mirrors botWiring.test.ts).
vi.mock('../../../src/utils/tokenSafety', () => ({
    checkTokenMetadata: vi.fn(), isLiquidityLocked: vi.fn(), simulateSwap: vi.fn(),
    checkHoneypot: vi.fn(), isBlacklistedToken: vi.fn(), isLiquiditySufficient: vi.fn(),
    isKnownBadToken: vi.fn(), hasMaxWalletOrTxLimits: vi.fn(), simulateSell: vi.fn(),
    isLiquidityLockedForChain: vi.fn(), simulateSwapForChain: vi.fn(),
    isLiquiditySufficientForChain: vi.fn(), isKnownBadTokenForChain: vi.fn(),
    checkTokenMetadataForChain: vi.fn(), hasMaxWalletOrTxLimitsForChain: vi.fn(),
    isBlacklistedTokenForChain: vi.fn(),
}));
vi.mock('../../../src/utils/honeypot', () => ({ simulateHoneypotRoundtrip: vi.fn() }));
vi.mock('../../../src/utils/honeypot/bytecodeScan', () => ({ isMutableTokenForChain: vi.fn() }));
vi.mock('../../../src/utils/honeypot/sanitize', () => ({ sanitizeReason: vi.fn().mockReturnValue('sanitized') }));
vi.mock('../../../src/utils/blocklist', () => ({ BLOCKLIST: { tokens: new Set<string>(), pairs: new Set<string>() } }));
vi.mock('../../../src/utils/notifier', () => ({ sendTelegramAlert: vi.fn(), sendCtxAlert: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../src/utils/provider', () => ({ getProvider: vi.fn(), getWallet: vi.fn(), getWsProvider: vi.fn(), removeWsProvider: vi.fn() }));
vi.mock('../../../src/utils/txManager', () => ({ sendTxWithRetry: vi.fn(), createMevStrategy: vi.fn(), escalatePrivateSell: vi.fn() }));
vi.mock('../../../src/utils/exitManager', () => ({
    clearAllTimers: vi.fn(), clearAllTimersForToken: vi.fn(), tryAcquireSellLock: vi.fn(),
    releaseSellLock: vi.fn(), registerExitMonitor: vi.fn(), registerStopLoss: vi.fn(),
    registerTakeProfit: vi.fn(), registerTimedSell: vi.fn(),
}));
vi.mock('../../../src/utils/exitWatchdog', () => ({ makeExitWatchdog: vi.fn() }));
vi.mock('../../../src/chainRegistry', async () => {
    const actual = await vi.importActual<typeof import('../../../src/chainRegistry')>('../../../src/chainRegistry');
    return { ...actual, buildChainRegistry: vi.fn(), createChainContext: vi.fn(), getEnabledChains: vi.fn().mockReturnValue([]) };
});
vi.mock('../../../src/riskManager', () => ({ canSnipe: vi.fn(), recordSnipe: vi.fn() }));
vi.mock('../../../src/api/server', () => ({ startApiServer: vi.fn().mockReturnValue({ close: vi.fn() }) }));
vi.mock('../../../src/api/ws/broadcaster', () => ({ broadcast: vi.fn() }));
vi.mock('../../../src/telegramListener', () => ({ startTelegramListener: vi.fn().mockResolvedValue({ client: null, connected: false }) }));
vi.mock('../../../src/utils/gasManager', () => ({ getGasOptions: vi.fn() }));
vi.mock('../../../src/preflight', () => ({ preflight: vi.fn(), checkWalletBalance: vi.fn(), checkEntryExitAffordability: vi.fn() }));
vi.mock('../../../src/config', () => ({
    CONFIG: {
        trailingStopPct: 15, trailingMinPct: 5, trailingMaxPct: 40, stopLossPercent: 25,
        partialSellTargets: '', exitPollIntervalMs: 5000, urgencyWindowMs: 30 * 60 * 1000,
        volatilityBaselineCV: 0.03, volatilityMaxSamples: 60, volatilityMinSamples: 12, slippagePercent: 5,
    },
}));

// Mock the ethers Contract so balanceOf is controllable (the balance-truth guard).
vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    function MockContract(this: { balanceOf: () => Promise<bigint> }) {
        this.balanceOf = () => balanceOfMock();
    }
    return { ...actual, Contract: MockContract };
});

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function buildChainCtx(chainName = 'eth') {
    return {
        chain: {
            name: chainName,
            displayName: `[${chainName.toUpperCase()}]`,
            chainId: 1,
            snipeAmount: '0.05',
            wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            dexes: [
                { dexType: 'v2', name: 'uniswap-v2', factoryAddress: '0xfac', routerAddress: '0xrtr' },
                { dexType: 'v3', name: 'uniswap-v3', factoryAddress: '0xfac3', quoterAddress: '0xq', swapRouterAddress: '0xsr' },
            ],
            antiRug: {
                liveExecute: false, lpRemovalPct: 50, confirmBlocks: 1, circuitBreakerTriggers: 3,
                circuitBreakerWindowHours: 1, gasMultiplier: 2.0, backfillCapBlocks: 10,
                maxBackfillBlocks: 7200, allowlistV2: [], allowlistV3: [],
            },
        },
        httpProvider: {},
        wsProvider: null,
        wallet: { address: '0x1111111111111111111111111111111111111111' },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), debug: vi.fn() },
    };
}

const FAILED_HELD_TOKEN = '0xfa11edHe1d000000000000000000000000000001'.toLowerCase();
const PENDING_TOKEN = '0xpend1ng0000000000000000000000000000000002'.toLowerCase();

// Flush pending microtasks (resumeMultiChainMonitoring fires balanceOf().then()).
async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    await Promise.resolve();
}

beforeEach(() => {
    resumeExitMonitorMock.mockReset().mockResolvedValue(undefined);
    registerAntiRugPositionMock.mockReset().mockResolvedValue(undefined);
    startChainAntiRugListenerMock.mockReset().mockResolvedValue(undefined);
    verifyAllowlistAtStartupMock.mockReset().mockResolvedValue(undefined);
    updateTradeStatusRunMock.mockReset();
    getResumeExitMonitorAllMock.mockReset().mockReturnValue([]);
    getResumeAntiRugAllMock.mockReset().mockReturnValue([]);
    balanceOfMock.mockReset().mockResolvedValue(1_000n);
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('Phase 21.2-11 — restart-resume for exit_failed_held positions (STOP-THE-LINE-04-D / S-1)', () => {
    it('Test A (re-monitor): an exit_failed_held row (trades.status=failed) with balanceOf>0 is RE-ENTERED into exit monitoring on restart', async () => {
        const { resumeMultiChainMonitoring } = await import('../../../src/bot');
        const ctx = buildChainCtx('eth');

        // The unified restart-resume scan returns the failed-held row with the
        // is_failed_held discriminator set — exactly what getResumeExitMonitorTrades
        // yields for a catch-path exit_failed_held position (trades.status='failed').
        getResumeExitMonitorAllMock.mockReturnValue([
            { token: FAILED_HELD_TOKEN, chain: 'eth', pool_type: 'v2', fee_tier: null, id: 77, is_failed_held: 1 },
        ]);
        // Still held on-chain (the LADYS-class evidence: a non-zero balance).
        balanceOfMock.mockResolvedValue(252_930_777_000_000_000_000n);

        resumeMultiChainMonitoring([ctx as unknown as Parameters<typeof resumeMultiChainMonitoring>[0][number]]);
        await flush();

        // OBSERVABLE: the poll loop was re-armed for the failed-held position.
        expect(resumeExitMonitorMock).toHaveBeenCalledTimes(1);
        const call = resumeExitMonitorMock.mock.calls[0];
        // resumeExitMonitor(ctx, dex, token, feeTier, snipeAmount, tradeId)
        expect(call[2]).toBe(FAILED_HELD_TOKEN);
        expect(call[5]).toBe(77);
        // It was NOT marked failed-and-dropped (the balanceOf guard saw it held).
        expect(updateTradeStatusRunMock).not.toHaveBeenCalled();
    });

    it('Test B (re-register anti-rug): the same exit_failed_held position has its anti-rug RE-REGISTERED on restart', async () => {
        const { resumeAntiRugMonitoring } = await import('../../../src/bot');
        const ctx = buildChainCtx('eth');

        // getResumeAntiRugTrades (trades INNER JOIN lp_baseline, unioned with the
        // exit_failed_held set) returns the failed-held row WITH its baseline pair.
        getResumeAntiRugAllMock.mockReturnValue([
            {
                id: 77,
                token: FAILED_HELD_TOKEN,
                chain: 'eth',
                pool_type: 'v2',
                fee_tier: null,
                pair_or_pool_address: '0xpair0000000000000000000000000000000000aa',
                is_failed_held: 1,
            },
        ]);
        // No additional failed-held ids beyond the one already in the join set.
        getResumeExitMonitorAllMock.mockReturnValue([
            { id: 77, is_failed_held: 1 },
        ]);

        await resumeAntiRugMonitoring([ctx as unknown as Parameters<typeof resumeAntiRugMonitoring>[0][number]]);

        // OBSERVABLE: anti-rug was re-registered for the failed-held position.
        expect(registerAntiRugPositionMock).toHaveBeenCalledTimes(1);
        const call = registerAntiRugPositionMock.mock.calls[0];
        // registerAntiRugPosition(ctx, dex, token, pairOrPool, tradeId, feeTier)
        expect(call[2]).toBe(FAILED_HELD_TOKEN);
        expect(call[4]).toBe(77);
        // verify ran first; the WS listener armed after.
        expect(verifyAllowlistAtStartupMock).toHaveBeenCalledTimes(1);
        expect(startChainAntiRugListenerMock).toHaveBeenCalledTimes(1);
    });

    it('Test C (no resurrection): an exit_failed_held row whose balanceOf is ~0 (genuinely closed) is NOT re-monitored', async () => {
        const { resumeMultiChainMonitoring } = await import('../../../src/bot');
        const ctx = buildChainCtx('eth');

        getResumeExitMonitorAllMock.mockReturnValue([
            { token: FAILED_HELD_TOKEN, chain: 'eth', pool_type: 'v2', fee_tier: null, id: 88, is_failed_held: 1 },
        ]);
        // The position is genuinely closed since (balance ~0) → the balanceOf
        // guard must win and the row must NOT be resurrected.
        balanceOfMock.mockResolvedValue(0n);

        resumeMultiChainMonitoring([ctx as unknown as Parameters<typeof resumeMultiChainMonitoring>[0][number]]);
        await flush();

        // OBSERVABLE: no resume; the balanceOf===0 guard left it closed (the
        // existing mark-failed branch ran instead of resurrecting it).
        expect(resumeExitMonitorMock).not.toHaveBeenCalled();
        expect(updateTradeStatusRunMock).toHaveBeenCalledWith('failed', FAILED_HELD_TOKEN, 'eth');
    });

    it('Test D (no regression — exit monitor): a normal status=pending buy with NO exit_state resumes exactly as before', async () => {
        const { resumeMultiChainMonitoring } = await import('../../../src/bot');
        const ctx = buildChainCtx('eth');

        // A healthy open buy: is_failed_held=0 (no exit_state / not failed-held).
        getResumeExitMonitorAllMock.mockReturnValue([
            { token: PENDING_TOKEN, chain: 'eth', pool_type: 'v2', fee_tier: null, id: 5, is_failed_held: 0 },
        ]);
        balanceOfMock.mockResolvedValue(1_000n);

        resumeMultiChainMonitoring([ctx as unknown as Parameters<typeof resumeMultiChainMonitoring>[0][number]]);
        await flush();

        expect(resumeExitMonitorMock).toHaveBeenCalledTimes(1);
        expect(resumeExitMonitorMock.mock.calls[0][2]).toBe(PENDING_TOKEN);
        expect(resumeExitMonitorMock.mock.calls[0][5]).toBe(5);
        expect(updateTradeStatusRunMock).not.toHaveBeenCalled();
    });

    it('Test D (no regression — anti-rug): a normal status=pending buy is re-registered exactly as before, and a closed/sold one is not in the scan', async () => {
        const { resumeAntiRugMonitoring } = await import('../../../src/bot');
        const ctx = buildChainCtx('eth');

        // Only the open pending position is returned by the scan (a sold/closed
        // one would not satisfy the union predicate and is implicitly absent).
        getResumeAntiRugAllMock.mockReturnValue([
            {
                id: 5,
                token: PENDING_TOKEN,
                chain: 'eth',
                pool_type: 'v2',
                fee_tier: null,
                pair_or_pool_address: '0xpair0000000000000000000000000000000000bb',
                is_failed_held: 0,
            },
        ]);
        getResumeExitMonitorAllMock.mockReturnValue([
            { token: PENDING_TOKEN, chain: 'eth', pool_type: 'v2', fee_tier: null, id: 5, is_failed_held: 0 },
        ]);

        await resumeAntiRugMonitoring([ctx as unknown as Parameters<typeof resumeAntiRugMonitoring>[0][number]]);

        expect(registerAntiRugPositionMock).toHaveBeenCalledTimes(1);
        expect(registerAntiRugPositionMock.mock.calls[0][2]).toBe(PENDING_TOKEN);
        expect(registerAntiRugPositionMock.mock.calls[0][4]).toBe(5);
    });

    it('logs op:exit.failed-held.resumed for each resumed failed-held position (D-ALERTS)', async () => {
        const { resumeMultiChainMonitoring } = await import('../../../src/bot');
        const ctx = buildChainCtx('eth');

        getResumeExitMonitorAllMock.mockReturnValue([
            { token: FAILED_HELD_TOKEN, chain: 'eth', pool_type: 'v2', fee_tier: null, id: 77, is_failed_held: 1 },
        ]);
        balanceOfMock.mockResolvedValue(252_930_777_000_000_000_000n);

        resumeMultiChainMonitoring([ctx as unknown as Parameters<typeof resumeMultiChainMonitoring>[0][number]]);
        await flush();

        const logged = (ctx.log.info as ReturnType<typeof vi.fn>).mock.calls.some(
            (c) => (c[0] as { op?: string })?.op === 'exit.failed-held.resumed',
        );
        expect(logged).toBe(true);
    });
});
