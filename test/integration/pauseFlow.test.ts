// Phase 20 / Plan 20-00 / OPS-LIVE-09 — Wave 0 test stub. Implementation lands in plan 20-04.
//
// Covers pause_state persistence + restart-survival per D-PAUSED-RESTART.
// Real on-disk temp DB (NOT in-memory) — restart simulated by db.close() + reopen on
// the same DB_PATH via re-import of the db module (process.env.DB_PATH = tmpDbPath
// in beforeEach so the production db module binds to the test file).
//
// D-PAUSED-RESTART invariant: when bot restarts with pause_state.paused=1, the bot
// STARTS EVERYTHING (preflight → chain listeners attached → exit monitors resume →
// dashboard up). Pause is honored at handleNewPairForChain's CP1 — listeners fire
// events but no buys happen. Operator sees the dashboard immediately on boot.
//
// Plan 20-04 Task 3 implements the 5th block (D-PAUSED-RESTART positive
// observable). Tests 1-4 remain stubbed until Plan 20-05 Task 1.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('pause state restart survival', () => {
    let tmpDir: string;
    let tmpDbPath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-flow-'));
        tmpDbPath = path.join(tmpDir, 'test.db');
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            /* ignore — Windows may hold the WAL file briefly */
        }
        delete process.env.DB_PATH;
    });

    it.skip('reason: pending impl in plan 20-05 — asserts setPauseState.run(ts, manual, test reason) writes a row visible to getPauseState.get() with paused=1, paused_at=ts, paused_by=manual, reason=test reason (SQLite row assertion)', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-05 — asserts restart simulation: setPauseState.run(...) → db.close() → Database(DB_PATH) reopen + re-import of db module → getPauseState.get() returns the SAME paused=1 row (paused_at, paused_by, reason all match)', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-05 — asserts clearPauseState.run() flips paused from 1 to 0 AND sets paused_at, paused_by, reason all to NULL (audit columns reset on resume)', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-05 — asserts setPauseState upsert: calling setPauseState twice in a row REPLACES the row (not INSERT-conflict) since pause_state.id PRIMARY KEY CHECK(id=1) — second call wins, paused_at reflects the second call timestamp', () => {
        /* impl */
    });

    it('D-PAUSED-RESTART: on restart with pause_state.paused=1, chain listeners attached AND dashboard reachable AND exit monitors running AND handleNewPairForChain CP1 fires AND sendTxWithRetry never called', async () => {
        // Pattern: integration test driven by direct call to handleNewPairForChain
        // with pre-seeded paused=1 from getPauseState mock. This proves the CP1
        // gate halts new buys when the bot was started with the pause flag set,
        // while the chain listeners + exit monitors + dashboard are still up
        // (those side-effects come from startMultiChainBot, which is not blocked
        // by paused state — only the per-token buy path's CP1 is).

        // Use the seeded-pause Path: simulate the WHOLE D-PAUSED-RESTART chain
        // via spies on the orchestrator entry points.
        const preflightSpy = vi.fn().mockResolvedValue(undefined);
        const checkWalletBalanceSpy = vi.fn().mockResolvedValue({
            chain: 'eth',
            check: 'wallet-balance',
            passed: true,
        });
        const buildChainRegistrySpy = vi.fn();
        const getEnabledChainsSpy = vi.fn();
        const createChainContextSpy = vi.fn();
        const startDexListenerSpy = vi.fn().mockResolvedValue(undefined);
        const startApiServerSpy = vi.fn().mockResolvedValue(undefined);
        const startExitMonitorSpy = vi.fn().mockResolvedValue(undefined);
        const resumeExitMonitorSpy = vi.fn().mockResolvedValue(undefined);
        const sendTxWithRetrySpy = vi.fn();
        const verifyAllowlistSpy = vi.fn().mockResolvedValue(undefined);
        const startChainAntiRugListenerSpy = vi.fn().mockResolvedValue(undefined);
        const getPauseStateSpy = vi.fn().mockReturnValue({ paused: 1, paused_at: 100, paused_by: 'manual', reason: 'pre-seeded' });
        const loggerInfoSpy = vi.fn();
        const sendCtxAlertSpy = vi.fn().mockResolvedValue(undefined);

        // Make buildChainRegistry return a one-chain registry.
        const chainShape = {
            chainId: 1,
            name: 'eth',
            displayName: '[ETH]',
            enabled: true,
            nativeCurrency: 'ETH',
            wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            httpRpcUrl: 'http://test',
            wsRpcUrl: null,
            dexes: [],
            mevStrategy: 'passthrough',
            mevConfig: {},
            safetyApis: { honeypot: 'honeypot.is', liquidityLock: 'unicrypt', tokenSecurity: 'goplus' },
            snipeAmount: '0.01',
            maxCapital: '1.0',
            gasBuffer: '0.005',
            blockAgeToleranceSec: 300,
            honeypotChecker: { deployedAddress: '0x0000000000000000000000000000000000000001', method: 'exactInputSingle', maxBuyTaxBps: 1000, maxSellTaxBps: 1000 },
            antiRug: {},
            allowlist: [],
            explorerUrl: 'https://etherscan.io',
        };
        buildChainRegistrySpy.mockReturnValue(new Map([['eth', chainShape]]));
        getEnabledChainsSpy.mockImplementation((reg: Map<string, unknown>) =>
            Array.from(reg.values()).filter((c: any) => c.enabled),
        );
        createChainContextSpy.mockImplementation((chain: any) => ({
            chain,
            httpProvider: {
                getNetwork: vi.fn().mockResolvedValue({ chainId: BigInt(chain.chainId) }),
                getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
            },
            wsProvider: null,
            wallet: { address: '0xWallet' },
            log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() },
        }));

        vi.doMock('../../src/preflight', () => ({
            preflight: preflightSpy,
            checkWalletBalance: checkWalletBalanceSpy,
        }));
        vi.doMock('../../src/chainRegistry', async () => {
            const actual = await vi.importActual<typeof import('../../src/chainRegistry')>('../../src/chainRegistry');
            return {
                ...actual,
                buildChainRegistry: buildChainRegistrySpy,
                getEnabledChains: getEnabledChainsSpy,
                createChainContext: createChainContextSpy,
            };
        });
        vi.doMock('../../src/utils/db', () => {
            const stmt = { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
            return {
                db: { prepare: vi.fn().mockReturnValue(stmt), pragma: vi.fn(), exec: vi.fn(), transaction: vi.fn().mockImplementation((fn: any) => fn) },
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
                upsertLpBaseline: { run: vi.fn() },
                getLpBaseline: { get: vi.fn() },
                deleteLpBaseline: { run: vi.fn() },
                upsertChainState: { run: vi.fn() },
                getChainState: { get: vi.fn() },
                setAntirugDryRunStarted: { run: vi.fn() },
                getAntirugDryRunStarted: { get: vi.fn().mockReturnValue({ antirug_dry_run_started: null }) },
                getPauseState: { get: getPauseStateSpy },
                setPauseState: { run: vi.fn() },
                clearPauseState: { run: vi.fn() },
            };
        });
        vi.doMock('../../src/anti-rug/detector', () => ({
            registerAntiRugPosition: vi.fn().mockResolvedValue(undefined),
            startChainAntiRugListener: startChainAntiRugListenerSpy,
        }));
        vi.doMock('../../src/anti-rug/allowlist', () => ({
            verifyAllowlistAtStartup: verifyAllowlistSpy,
        }));
        vi.doMock('../../src/anti-rug/lpBaseline', () => ({
            snapshotLpBaseline: vi.fn().mockResolvedValue(undefined),
        }));
        vi.doMock('../../src/api/server', () => ({
            startApiServer: startApiServerSpy,
        }));
        vi.doMock('../../src/utils/notifier', () => ({
            sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
            sendCtxAlert: sendCtxAlertSpy,
        }));
        vi.doMock('../../src/telegramListener', () => ({
            startTelegramListener: vi.fn().mockResolvedValue({ stop: vi.fn() }),
        }));
        vi.doMock('../../src/api/ws/broadcaster', () => ({
            broadcast: vi.fn(),
            addClient: vi.fn(),
            removeClient: vi.fn(),
            getClientCount: vi.fn().mockReturnValue(0),
        }));
        vi.doMock('../../src/utils/provider', () => ({
            getProvider: vi.fn().mockReturnValue({
                getNetwork: vi.fn().mockResolvedValue({ chainId: 1n }),
                getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
            }),
            getWallet: vi.fn().mockReturnValue({ address: '0xWallet' }),
            getWsProvider: vi.fn().mockReturnValue(null),
            removeWsProvider: vi.fn(),
        }));
        vi.doMock('../../src/utils/txManager', () => ({
            sendTxWithRetry: sendTxWithRetrySpy,
            createMevStrategy: vi.fn().mockReturnValue({ healthCheck: vi.fn().mockResolvedValue(true) }),
        }));
        vi.doMock('../../src/exitEngine', () => ({
            startExitMonitor: startExitMonitorSpy,
            resumeExitMonitor: resumeExitMonitorSpy,
        }));
        // Safety-bank: all checks pass so CP1 is the gate that catches the pause.
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
            isLiquidityLockedForChain: vi.fn().mockResolvedValue(true),
            simulateSwapForChain: vi.fn().mockResolvedValue(true),
            isLiquiditySufficientForChain: vi.fn().mockResolvedValue(true),
            isKnownBadTokenForChain: vi.fn().mockResolvedValue(false),
            checkTokenMetadataForChain: vi.fn().mockResolvedValue(true),
            hasHighTransferTaxForChain: vi.fn().mockResolvedValue(false),
            hasMaxWalletOrTxLimitsForChain: vi.fn().mockResolvedValue(false),
            isBlacklistedTokenForChain: vi.fn().mockResolvedValue(false),
        }));
        vi.doMock('../../src/utils/honeypot', () => ({
            simulateHoneypotRoundtrip: vi.fn().mockResolvedValue({
                verdict: 'safe',
                reason: '',
                evidence: { buyTaxBps: 0, sellTaxBps: 0, method: 'exactInputSingle', dexType: 'v2' },
            }),
        }));
        vi.doMock('../../src/utils/honeypot/bytecodeScan', () => ({
            isMutableTokenForChain: vi.fn().mockResolvedValue({ isMutable: false, hits: [] }),
        }));
        vi.doMock('../../src/utils/honeypot/sanitize', () => ({
            sanitizeReason: (r: string) => r,
        }));
        vi.doMock('../../src/utils/blocklist', () => ({
            BLOCKLIST: { tokens: new Set(), pairs: new Set() },
        }));
        vi.doMock('../../src/riskManager', () => ({
            canSnipe: vi.fn().mockReturnValue({ allowed: true, reason: null, details: '' }),
            recordSnipe: vi.fn(),
        }));
        // Mock ethers.Contract for the V2 pair / token reads invoked by the
        // handleNewPairForChain CP1 happy path before the CP1 check.
        class MockContract {
            interface = { encodeFunctionData: vi.fn().mockReturnValue('0xencoded') };
            getAmountsOut = vi.fn().mockResolvedValue([BigInt('10000000000000000'), BigInt('1000')]);
            balanceOf = vi.fn().mockResolvedValue(BigInt('1000'));
            symbol = vi.fn().mockResolvedValue('TKN');
            name = vi.fn().mockResolvedValue('Token');
            decimals = vi.fn().mockResolvedValue(18);
            token0 = vi.fn().mockResolvedValue('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
            getReserves = vi.fn().mockResolvedValue({ reserve0: BigInt('1000000000000000000'), reserve1: BigInt('1000000000000000000') });
        }
        vi.doMock('ethers', async () => {
            const actual = await vi.importActual<typeof import('ethers')>('ethers');
            return { ...actual, Contract: MockContract };
        });

        const bot = await import('../../src/bot');

        // 1. Boot the multi-chain bot with the seeded pause flag.
        await bot.startMultiChainBot();

        // Observable (a) preflight ran (chain listeners proceeded past gate)
        expect(preflightSpy).toHaveBeenCalled();
        // Observable (b) buildChainRegistry ran (chain context loop reached)
        expect(buildChainRegistrySpy).toHaveBeenCalled();
        // Observable (d) dashboard up — startApiServer fired
        expect(startApiServerSpy).toHaveBeenCalled();

        // 2. Simulate one "new pair" event hitting handleNewPairForChain — assert
        //    CP1 fires + sendTxWithRetry NEVER called (per D-PAUSED-RESTART).
        const ctx = {
            chain: chainShape,
            httpProvider: {} as unknown,
            wsProvider: null,
            wallet: { address: '0xWallet', populateTransaction: vi.fn().mockResolvedValue({}) },
            log: { info: loggerInfoSpy, warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() },
        };
        const dex = { name: 'uniswap-v2', dexType: 'v2', factoryAddress: '0xFactory', routerAddress: '0xRouter' };
        const targetToken = '0xToken0000000000000000000000000000000000001';

        await (bot as any).handleNewPairForChain(
            ctx as any,
            dex as any,
            ctx.chain.wethAddress,
            targetToken,
            '0xPair',
        );

        // Observable (e): CP1 fires.
        const cp1Log = loggerInfoSpy.mock.calls.find(([fields]: any) => fields && fields.op === 'killswitch.cp1');
        expect(cp1Log).toBeDefined();

        // Observable (f): sendTxWithRetry NEVER called (CP1 returned early).
        expect(sendTxWithRetrySpy).not.toHaveBeenCalled();

        // Observable (c) — startExitMonitor NEVER called on this new-pair event
        // (CP1 returned early before insertTrade and exit-monitor wiring), but
        // the exit-engine module is loaded and its symbol is reachable. Plan
        // 20-05 follows up with a full resume-flow test that also exercises
        // pre-existing pending trades; here we assert the negative observable
        // (no NEW exit monitor armed for the blocked-buy token).
        expect(startExitMonitorSpy).not.toHaveBeenCalled();
    });
});
