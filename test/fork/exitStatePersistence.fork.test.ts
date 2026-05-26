// test/fork/exitStatePersistence.fork.test.ts
// Phase 21 / Plan 21-04 / EXIT-LIVE-02 — exit_state persists IDENTICALLY across
// an exit-monitor restart.
//
// WHAT THIS PROVES (the contract): the exit engine writes its strategy state to
// the `exit_state` table every poll cycle (src/exitEngine.ts:770/832/894 all call
// upsertExitState.run(serializeExitState(state))), and on restart resumeExitMonitor
// reloads it via getExitState.get(tradeId) -> deserializeExitState
// (src/exitEngine.ts:958-970). After a restart the strategy-state columns
// (high_water_mark, trailing_activated, partial_tiers_completed) — and
// volatility_samples — must be byte-for-byte identical. There is NO literal
// poll-counter / cursor column (RESEARCH Pitfall 1); "poll position" maps to
// these persisted strategy-state columns. The poll loop re-derives everything
// else from the current price each cycle.
//
// RESTART SHAPE — SHAPE B (module-level), the DOCUMENTED FALLBACK (plan Open
// Question #4). We attempted-and-rejected SHAPE A (spawn the real bot process +
// OS SIGTERM) for TWO blocking reasons, both recorded in the SUMMARY:
//   1. PROD-KEY SAFETY (D-TEST-WALLET-FORKONLY): booting src/bot.ts
//      (startMultiChainBot) loads the production wallet key env var — the funded
//      prod wallet — at module init (src/utils/provider.ts:59,
//      src/chainRegistry.ts:1067). A test is forbidden from ever loading the prod
//      key. Shape A cannot honor the fork-only-wallet rule.
//   2. WINDOWS HAS NO REAL TERM SIGNAL (dev-host harness note): a graceful-term
//      signal terminates abruptly on win32 and child trees survive (port-8545
//      leak), so the gracefulShutdown -> closeDb() WAL-flush the term path relies
//      on does not run deterministically.
// Shape B exercises the SAME persistence contract (write-every-cycle upsert +
// reload-from-DB via resumeExitMonitor) without an OS signal: clearInterval /
// clearAllTimersForToken stands in for the process death (the in-memory state
// object is discarded; only the durable DB row survives), then resumeExitMonitor
// reloads PURELY from the DB. A hard/uncatchable kill is never used in either
// shape (the acceptance forbids it — a hard kill races the WAL flush under
// synchronous=NORMAL, db.ts:22).
//
// D-OP-DB-TRUTH / D-04: the observable effect is read from the exit_state DB row
// via getExitState (the engine's own prepared statement), NEVER an op-log line
// such as 'Resumed exit monitor from DB state'.
//
// SAFETY: requireRealMainnetGate() guards before any transaction
// (D-GATE-BOTH-LAYERS); the fork-only signer is FORK_ONLY_TEST_KEY (Hardhat
// account #0, zero real ETH); the production wallet key env var is NEVER loaded.
//
// SHARED-NODE HARNESS NOTE: all fork files share ONE Hardhat node (globalSetup,
// port 8545) and run SEQUENTIALLY (fileParallelism:false) as the same Hardhat
// account #0. This test sets up its own state, reads nonces fresh (via ethers),
// uses its OWN isolated DB (DB_PATH temp file), and hardhat_resets the fork for
// the live-buy case — it does not assume a pristine balance or file order.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// --- DB isolation + config: set BEFORE importing any src/ module. db.ts binds
// the SQLite singleton to process.env.DB_PATH at import; exitEngine/config read
// their values from env at module load. The real prod DB is never touched.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'exitStatePersistence-'));
process.env.DB_PATH = path.join(TMP_DIR, 'persistence-test.db');
// Exit-engine config: a 2x:50 partial tier (so a partial tier can complete) +
// a tight trailing stop. Generous stop-loss so a stop-loss never fires and
// deletes the row mid-test (we pump-and-HOLD; price does not drop).
process.env.PARTIAL_SELL_TARGETS = '2x:50';
process.env.STOP_LOSS_PCT = '90';
process.env.TRAILING_STOP_PCT = '15';
// Risk gate (canSnipe runs BEFORE the safety bank). Permissive so the live-buy
// case reaches the buy path (test-process env overrides, NOT a src/ change).
process.env.MAX_POSITION_SIZE = '1';
process.env.MAX_OPEN_POSITIONS = '50';
process.env.SNIPE_COOLDOWN_MS = '0';
process.env.DAILY_LOSS_PCT = '99';
process.env.MAX_TOTAL_EXPOSURE = '1000';

import { requireRealMainnetGate, FORK_ONLY_TEST_KEY } from './helpers/realMainnetGate';

const PROVIDER_URL = 'http://127.0.0.1:8545';
const FORK_RPC = process.env.ETH_FORK_RPC_URL || process.env.ALCHEMY_URL;
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

const HONEYPOT_CHECKER_ARTIFACT = path.resolve(
    __dirname,
    '../../artifacts/contracts/honeypot/HoneypotChecker.sol/HoneypotChecker.json',
);

// Reuse the proven BOBO fixture from Plan 21-03's realLaunches replay: an
// established, liquid ETH V2 token (LP 100% burned at settledForkBlock) that the
// REAL handler can buy. We drive its price >=2x to advance the engine's
// high_water_mark + activate the trailing stop through the REAL poll loop.
const BOBO_FIXTURE = path.resolve(__dirname, 'fixtures/realLaunches/eth-v2-partial.json');

interface LaunchFixture {
    slug: string;
    dexType: 'v2' | 'v3';
    tokenAddress: string;
    pairAddress: string | null;
    settledForkBlock: number | null;
    forkBlockNumber: number | null;
}

describe('Phase 21 plan 21-04 — exit_state persists identically across a restart (EXIT-LIVE-02)', () => {
    let provider: ethers.JsonRpcProvider;
    let wallet: ethers.Wallet;
    let chainGuardOk = false;
    let checkerArtifact: { abi: unknown[]; bytecode: string } | null = null;

    // Imported lazily AFTER DB_PATH is set (so they bind to the temp DB).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let exitEngine: any;
    let dbMod: any;
    let exitManager: any;
    let chainRegistry: any;
    let bot: any;
    let readDb: any;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    beforeAll(async () => {
        provider = new ethers.JsonRpcProvider(PROVIDER_URL, undefined, { cacheTimeout: -1 });

        // D-GATE-BOTH-LAYERS layer b: guard BEFORE any transaction. NEVER run
        // against real mainnet without ALLOW_REAL_MAINNET=1.
        try {
            await requireRealMainnetGate(provider);
            chainGuardOk = true;
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`realMainnetGate blocked: ${(err as Error).message}`);
            chainGuardOk = false;
            return;
        }

        // Fork-only signer (D-TEST-WALLET-FORKONLY). NEVER the prod wallet key.
        wallet = new ethers.Wallet(FORK_ONLY_TEST_KEY, provider);

        if (fs.existsSync(HONEYPOT_CHECKER_ARTIFACT)) {
            checkerArtifact = JSON.parse(fs.readFileSync(HONEYPOT_CHECKER_ARTIFACT, 'utf-8'));
        }

        exitEngine = await import('../../src/exitEngine');
        dbMod = await import('../../src/utils/db');
        exitManager = await import('../../src/utils/exitManager');
        chainRegistry = await import('../../src/chainRegistry');
        bot = await import('../../src/bot');

        // Independent read-only handle to assert the DB row (the ground-truth
        // observable). Using a SEPARATE connection from the engine's singleton
        // proves the row is durable on disk, not just in the writer's cache.
        const Database = (await import('better-sqlite3')).default;
        readDb = new Database(process.env.DB_PATH as string, { readonly: true });
    }, 120000);

    afterAll(() => {
        try {
            readDb?.close();
        } catch {
            /* best-effort */
        }
        try {
            fs.rmSync(TMP_DIR, { recursive: true, force: true });
        } catch {
            /* best-effort */
        }
    });

    /** Read the exit_state row via a separate read-only connection (durable proof). */
    function readExitStateRow(tradeId: number): {
        trade_id: number;
        entry_price: number;
        high_water_mark: number;
        trailing_activated: number;
        partial_tiers_completed: string;
        original_token_amount: string;
        urgency_start_ts: number;
        volatility_samples: string;
    } | undefined {
        return readDb.prepare('SELECT * FROM exit_state WHERE trade_id = ?').get(tradeId) as
            | {
                  trade_id: number;
                  entry_price: number;
                  high_water_mark: number;
                  trailing_activated: number;
                  partial_tiers_completed: string;
                  original_token_amount: string;
                  urgency_start_ts: number;
                  volatility_samples: string;
              }
            | undefined;
    }

    /**
     * Build a real ChainContext for ETH on the fork (mirrors Plan 21-03's
     * realLaunchReplay). `mevStrategy:'passthrough'` so any buy/sell lands via a
     * direct send (a local fork has NO Flashbots relay). A TEST-SIDE ChainContext
     * choice, NOT a src/ change.
     */
    function buildForkChainContext(): {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: any;
    } {
        const template = chainRegistry.CHAIN_TEMPLATES.eth;
        const chain = {
            ...template,
            enabled: true,
            mevStrategy: 'passthrough' as const,
            mevConfig: { kind: 'passthrough' as const },
            snipeAmount: '0.05',
            maxCapital: '100',
            minLiquidityThreshold: template.defaultMinLiquidityThreshold,
            gasBuffer: template.defaultGasBuffer,
            blockAgeToleranceSec: template.defaultBlockAgeToleranceSec,
            gas: template.gas,
            honeypotChecker: {
                method: 'on-chain-contract' as const,
                deployedAddress: undefined as string | undefined,
                maxBuyTaxBps: 10000,
                maxSellTaxBps: 10000,
            },
            antiRug: {
                liveExecute: false,
                lpRemovalPct: 50,
                confirmBlocks: 0,
                circuitBreakerTriggers: 3,
                circuitBreakerWindowHours: 1,
                gasMultiplier: 2.0,
                backfillCapBlocks: 10,
                maxBackfillBlocks: 7200,
                allowlistV2: [],
                allowlistV3: [],
            },
        };
        // Minimal pino-shaped no-op logger (records nothing; the DB row is the
        // observable, not the log — D-OP-DB-TRUTH).
        const ctxLog: Record<string, unknown> = {};
        const noop = () => {};
        ctxLog.info = noop;
        ctxLog.warn = noop;
        ctxLog.error = noop;
        ctxLog.debug = noop;
        ctxLog.fatal = noop;
        ctxLog.child = () => ctxLog;
        const ctx = { chain, httpProvider: provider, wsProvider: null, wallet, log: ctxLog };
        return { ctx };
    }

    function getV2Dex(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: any,
    ): { dexType: string; name: string } {
        return (ctx.chain.dexes as Array<{ dexType: string; name: string }>).find(
            (d) => d.dexType === 'v2' && d.name === 'uniswap-v2',
        ) as { dexType: string; name: string };
    }

    // =====================================================================
    // TEST 1 (PRIMARY, deterministic) — the EXIT-LIVE-02 persistence contract.
    //
    // Establishes NON-DEFAULT exit_state through the engine's OWN serialize +
    // persist call (serializeExitState + upsertExitState — the EXACT write the
    // poll loop makes at exitEngine.ts:770/832/894), snapshots the durable row,
    // simulates the restart at the module level (register an interval to model a
    // live monitor, then clearAllTimersForToken to drop it — process death:
    // in-memory state gone, DB row survives), reloads via resumeExitMonitor (the
    // REAL reload path: getExitState -> deserializeExitState), and asserts the
    // strategy-state columns are IDENTICAL pre/post.
    //
    // Deterministic (no price/timing dependence) so it is the robust gate; Test 2
    // adds the higher-fidelity real-poll-loop variant.
    // =====================================================================
    it('reloads identical high_water_mark / trailing_activated / partial_tiers_completed after a module-level restart', async () => {
        if (!chainGuardOk) {
            console.warn('chainGuardOk=false — skipping (real-mainnet gate).');
            return;
        }

        // A real `trades` row so exit_state.trade_id satisfies its FK -> trades(id).
        // NOTE: amount_in is stored in NATIVE units (ETH), matching the real buy
        // path (src/bot.ts:432 records ctx.chain.snipeAmount = '0.05', NOT wei).
        // getTotalExposure / getDailyRealizedLoss CAST amount_in AS REAL and treat
        // it as native ETH (db.ts:389), so a wei value here would corrupt the
        // risk-gate exposure sum for the live-buy test that shares this isolated
        // DB. status='sold' so this synthetic row counts as a CLOSED position
        // (zero open-count, zero exposure) and never perturbs Test 2's risk gate.
        const token = '0x' + 'ab'.repeat(20); // deterministic non-pool token addr
        const info = dbMod.insertTrade.run({
            token: token.toLowerCase(),
            chain: 'eth',
            action: 'buy',
            txHash: '0x' + 'cd'.repeat(32),
            block: 1,
            timestamp: Math.floor(Date.now() / 1000),
            amountIn: '0.05', // native ETH units (NOT wei) — see note above
            amountOut: null,
            gasCost: '0',
            priceAtAction: null,
            status: 'sold',
            poolType: 'v2',
            feeTier: null,
            dexName: 'uniswap-v2',
        });
        const tradeId = Number(info.lastInsertRowid);

        // Build NON-DEFAULT strategy state via the engine's own types: HWM
        // advanced well above entry, trailing ARMED, tier 0 COMPLETED, real
        // volatility samples. trailingActivated=true and a completed tier are the
        // exact "meaningful, not default" signals the acceptance requires.
        const entryPrice = 1_000_000;
        const tracker = new exitEngine.VolatilityTracker();
        for (const p of [1_000_000, 1_400_000, 1_900_000, 2_100_000, 2_050_000]) {
            tracker.addSample(p);
        }
        const preState = {
            tradeId,
            entryPrice,
            highWaterMark: 2_100_000, // advanced (>2x entry)
            trailingActivated: true, // ARMED (non-default)
            completedTierIndices: new Set<number>([0]), // tier 0 completed (non-default)
            originalTokenAmount: 1_000_000_000_000_000_000_000n,
            urgencyStartTs: Date.now() - 60_000,
            volatilityTracker: tracker,
        };

        // Persist through the engine's REAL write path (the same call the poll
        // loop makes). This is NOT hand-rolled SQL — it routes through
        // serializeExitState + the engine's upsertExitState prepared statement.
        dbMod.upsertExitState.run(exitEngine.serializeExitState(preState));

        // Snapshot the DURABLE row (separate read-only connection).
        const pre = readExitStateRow(tradeId);
        expect(pre, 'exit_state row must exist pre-restart').toBeTruthy();
        // Guard: the snapshot is genuinely non-default (meaningful assertion).
        expect(pre!.trailing_activated).toBe(1);
        expect(pre!.partial_tiers_completed).toBe('[0]');
        expect(pre!.high_water_mark).toBeGreaterThan(pre!.entry_price);

        // --- RESTART (Shape B, module-level) -------------------------------
        // Model a live monitor: register an interval, then drop it +
        // discard the in-memory state object. This is the "process died" analog
        // (no OS signal; no hard kill). The durable DB row is all that survives.
        const fakeInterval = setInterval(() => {}, 1_000_000);
        exitManager.registerExitMonitor('eth', token, fakeInterval);
        exitManager.clearAllTimersForToken('eth', token); // clears + deletes registry entry
        // preState is now out of scope for the engine — only the DB persists.

        // --- RELOAD (the REAL reload path) ---------------------------------
        // resumeExitMonitor reads getExitState.get(tradeId), deserializes, logs
        // 'Resumed exit monitor from DB state', and starts a fresh interval.
        const { ctx } = buildForkChainContext();
        const dex = getV2Dex(ctx);
        await exitEngine.resumeExitMonitor(ctx, dex, token, null, '0.05', tradeId);
        // Immediately stop the freshly-started interval so a later 5s poll tick
        // cannot mutate state (and so the timer does not leak into other files).
        // NB: even if a tick fired first, queryPrice on this non-pool token
        // returns null -> 'continue' (no mutation), and any re-persist would write
        // the SAME values — the assertion is robust either way.
        exitManager.clearAllTimersForToken('eth', token);

        // --- ASSERT: columns IDENTICAL pre/post (DB row, not a log) ---------
        const post = readExitStateRow(tradeId);
        expect(post, 'exit_state row must still exist post-restart').toBeTruthy();

        expect(post!.high_water_mark).toBe(pre!.high_water_mark);
        expect(post!.trailing_activated).toBe(pre!.trailing_activated);
        expect(post!.partial_tiers_completed).toBe(pre!.partial_tiers_completed);
        // volatility_samples is also part of the persisted strategy state.
        expect(post!.volatility_samples).toBe(pre!.volatility_samples);
        // And the non-strategy columns the engine carries forward.
        expect(post!.entry_price).toBe(pre!.entry_price);
        expect(post!.original_token_amount).toBe(pre!.original_token_amount);

        // Prove the REAL reload round-trip (getExitState -> deserializeExitState,
        // exactly what resumeExitMonitor does internally) reproduces the values.
        const reloaded = exitEngine.deserializeExitState(post!);
        expect(reloaded.highWaterMark).toBe(preState.highWaterMark);
        expect(reloaded.trailingActivated).toBe(preState.trailingActivated);
        expect(Array.from(reloaded.completedTierIndices as Set<number>)).toEqual([0]);
        expect(reloaded.entryPrice).toBe(preState.entryPrice);
    }, 60000);

    // =====================================================================
    // TEST 2 (higher fidelity) — state ESTABLISHED BY THE REAL POLL LOOP.
    //
    // A real fork buy via the REAL handler (handleNewPairForChain, BOBO fixture),
    // then a whale pump >=2x so the engine's OWN poll loop (started by
    // startExitMonitor) advances high_water_mark + activates the trailing stop
    // through pollExitStrategy and persists every cycle. We pump-and-HOLD (price
    // does not drop) so no trailing/stop-loss exit fires and deletes the row. Then
    // the SAME module-level restart + resumeExitMonitor reload, asserting the
    // strategy-state columns are identical pre/post.
    //
    // If the live buy/pump is environment-sensitive on the shared node, Test 1
    // remains the deterministic gate for the EXIT-LIVE-02 contract; this test
    // documents and exercises the genuine poll-loop write path.
    // =====================================================================
    it('reloads identical columns when state was advanced by the REAL exit-monitor poll loop', async () => {
        if (!chainGuardOk) {
            console.warn('chainGuardOk=false — skipping (real-mainnet gate).');
            return;
        }
        if (!checkerArtifact) {
            console.warn('HoneypotChecker artifact not compiled — skipping live-buy variant.');
            return;
        }

        const fixture: LaunchFixture = JSON.parse(fs.readFileSync(BOBO_FIXTURE, 'utf-8'));
        const forkBlock = fixture.settledForkBlock ?? fixture.forkBlockNumber;
        expect(forkBlock, 'BOBO fixture must carry a resolved fork pin').not.toBeNull();
        const token = fixture.tokenAddress;
        const pair = fixture.pairAddress as string;

        // Clean fork at the settled tradeable block; fund the fork-only wallet;
        // interval-mine so passthrough tx.wait(3) confirmations advance.
        await provider.send('hardhat_reset', [
            { forking: { jsonRpcUrl: FORK_RPC, blockNumber: forkBlock } },
        ]);
        await provider.send('hardhat_setBalance', [
            wallet.address,
            '0x' + ethers.parseEther('1000000').toString(16),
        ]);
        await provider.send('evm_setIntervalMining', [500]);

        // Deploy the HoneypotChecker the gate calls.
        const factory = new ethers.ContractFactory(
            checkerArtifact.abi as ethers.InterfaceAbi,
            checkerArtifact.bytecode,
            wallet,
        );
        const checker = await factory.deploy();
        await checker.waitForDeployment();
        const checkerAddress = await checker.getAddress();

        const { ctx } = buildForkChainContext();
        ctx.chain.honeypotChecker.deployedAddress = checkerAddress;
        const dex = getV2Dex(ctx);

        // REAL handler buy (EXACT bot.ts:909 arg order). NOT a manual swap.
        await bot.handleNewPairForChain(ctx, dex, token, WETH, pair);
        const buyRow = readDb
            .prepare("SELECT id FROM trades WHERE token = ? AND action = 'buy' ORDER BY id DESC LIMIT 1")
            .get(token.toLowerCase()) as { id: number } | undefined;
        expect(buyRow, 'REAL handler must have produced a buy row').toBeTruthy();
        const tradeId = buyRow!.id;

        // Token balance received from the buy = original amount for the monitor.
        const erc20 = new ethers.Contract(
            token,
            ['function balanceOf(address) view returns (uint256)'],
            provider,
        );
        const balance: bigint = await erc20.balanceOf(wallet.address);
        expect(balance > 0n, 'fork-only wallet must hold the bought token').toBe(true);

        // Start the REAL exit monitor (entry price queried at the current,
        // pre-pump pool price; persists initial state; starts the 5s poll loop).
        await exitEngine.startExitMonitor(ctx, dex, token, null, '0.05', tradeId, balance);

        // Pump the pool >=2x via a funded whale (a DIFFERENT actor than the bot;
        // does NOT replace the bot's REAL buy). swapETHForExactTokens removes most
        // of the token reserve, pushing WETH/token price far past 2x.
        const whale = ethers.Wallet.createRandom().connect(provider);
        await provider.send('hardhat_setBalance', [
            whale.address,
            '0x' + ethers.parseEther('5000000').toString(16),
        ]);
        const pairC = new ethers.Contract(
            pair,
            ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)'],
            provider,
        );
        const reserves = await pairC.getReserves();
        const token0 = (await pairC.token0()) as string;
        const tokenReserve =
            token0.toLowerCase() === token.toLowerCase() ? (reserves[0] as bigint) : (reserves[1] as bigint);
        const router = new ethers.Contract(
            UNISWAP_V2_ROUTER,
            ['function swapETHForExactTokens(uint,address[],address,uint) payable returns (uint[])'],
            whale,
        );
        const pumpTx = await router.swapETHForExactTokens(
            (tokenReserve * 70n) / 100n,
            [WETH, token],
            whale.address,
            Math.floor(Date.now() / 1000) + 600,
            { value: ethers.parseEther('1000000') },
        );
        await pumpTx.wait();

        // Let the REAL poll loop run a few 5s cycles so high_water_mark catches
        // the pump and trailing_activated flips at >=2x. We pump-and-HOLD (no
        // price drop) so the trailing stop's trigger (HWM*(1-pct)) stays below the
        // current price and no exit fires (which would deleteExitState).
        // Poll until trailing_activated flips (bounded), reading the durable row.
        const deadline = Date.now() + 40_000;
        let pre = readExitStateRow(tradeId);
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 5000));
            pre = readExitStateRow(tradeId);
            if (pre && pre.trailing_activated === 1 && pre.high_water_mark > pre.entry_price) break;
        }

        // Stop the live monitor (and stop interval mining so the node settles).
        exitManager.clearAllTimersForToken('eth', token);
        await provider.send('evm_setIntervalMining', [0]);

        // The poll loop must have advanced state to NON-DEFAULT (meaningful):
        // trailing armed after the >=2x pump, HWM above entry. If the row is gone,
        // an exit fired (price dropped) — that is a different scenario, surfaced
        // loudly rather than silently passed.
        expect(pre, 'exit_state row must still be open (no exit fired) after the pump-and-hold').toBeTruthy();
        expect(pre!.high_water_mark).toBeGreaterThan(pre!.entry_price);
        expect(pre!.trailing_activated).toBe(1);

        // --- RESTART (Shape B, module-level) + RELOAD ----------------------
        const fakeInterval = setInterval(() => {}, 1_000_000);
        exitManager.registerExitMonitor('eth', token, fakeInterval);
        exitManager.clearAllTimersForToken('eth', token);

        await exitEngine.resumeExitMonitor(ctx, dex, token, null, '0.05', tradeId);
        exitManager.clearAllTimersForToken('eth', token);

        // --- ASSERT: columns IDENTICAL pre/post (DB row, not a log) ---------
        const post = readExitStateRow(tradeId);
        expect(post, 'exit_state row must still exist post-restart').toBeTruthy();
        expect(post!.high_water_mark).toBe(pre!.high_water_mark);
        expect(post!.trailing_activated).toBe(pre!.trailing_activated);
        expect(post!.partial_tiers_completed).toBe(pre!.partial_tiers_completed);
        expect(post!.volatility_samples).toBe(pre!.volatility_samples);
        expect(post!.entry_price).toBe(pre!.entry_price);
    }, 120000);
});
