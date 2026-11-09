// test/fork/deliberateBuyReplay.fork.test.ts
// Phase 21.3 / Plan 21.3-04 — STOP-THE-LINE-05-B (wiring). The Wave-0 it.skip
// stub (plan 21.3-00) is flipped here into a REAL fork test that drives the REAL
// executeDeliberateBuy (src/bot.ts) on a mainnet fork and asserts the
// deliberate-buy -> register -> monitor wiring end-to-end.
//
// =====================================================================
// WHAT THE FORK PROVES (the surrounding WIRING — STL-05 (wiring) row):
//   A deliberate buy runs the REAL executeDeliberateBuy path, the buy LANDS on
//   the fork, a `trades` row is recorded with the REAL on-chain hash (NOT a
//   'mev_bundle' placeholder), the position is REGISTERED for anti-rug, and the
//   exit monitor is ARMED — i.e. the canonical regression "a staticCall-valid
//   buy that Flashbots won't include now lands" is satisfied at the WIRING level
//   (the landed buy reaches register->monitor via recordAndArmDeliberateBuy /
//   armPositionMonitoring — STOP-THE-LINE-06, closed in plan 21.3-05).
//
// WHAT THE FORK CANNOT PROVE (D-EVIDENCE-BAR / D-EVIDENCE-BUY-INCLUSION):
//   A local Hardhat fork has NO Flashbots relay. So this test CANNOT prove:
//     - multi-builder raw eth_sendBundle fanout (plan 01) — no relay to fan to;
//     - the private->public TRANSITION timing (a real Flashbots private leg that
//       genuinely fails to include, then falls to the public mempool) — there is
//       no relay, so the "private" leg here is a direct PASSTHROUGH send (see the
//       PASSTHROUGH NOTE below), which LANDS rather than failing-to-include;
//     - LIVE calm-gas inclusion of the deliberate public buy.
//   Those LIVE items close ONLY on the operator-gated Phase 21 / 21-07
//   real-capital retry (deliberate path) + the next-snipe
//   flashbots_getBundleStatsV2 telemetry (multi-builder) — NEVER on this
//   fork/unit pass. The Task-2 operator checkpoint records that posture.
//
// PASSTHROUGH NOTE (the honest fork model — mirrors captureRehearsal /
// realLaunchReplay): buildForkChainContext sets mevStrategy:'passthrough'
// because a local fork has no relay (a TEST-SIDE ChainContext choice, NOT a src/
// change). With passthrough, escalatePrivateBuy -> sendTxWithRetry -> the
// PassthroughMevStrategy broadcasts via wallet.sendTransaction, so the "private"
// leg LANDS directly (priv.landed === true) and executeDeliberateBuy takes the
// PRIVATE-LANDED branch -> recordAndArmDeliberateBuy. That is the SAME
// register->monitor wiring the public-fallback branch routes through (all three
// landed branches call recordAndArmDeliberateBuy -> armPositionMonitoring), so
// the buy->register->monitor proof is identical regardless of WHICH landed
// branch fires. The fork cannot exercise the genuine private->public TRANSITION
// (that needs a relay that fails to include) — only the wiring of a LANDED
// deliberate buy.
//
// D-TEST-WALLET-FORKONLY: signs with FORK_ONLY_TEST_KEY (Hardhat account #0,
// fork-only, zero real ETH) — NEVER process.env.PRIVATE_KEY (the prod wallet).
// ALLOW_REAL_MAINNET is NEVER set. requireRealMainnetGate() (EXIT-LIVE-08 /
// D-GATE-BOTH-LAYERS layer b) guards the chainId-1 tripwire BEFORE any tx.
//
// D-OP-DB-TRUTH / D-04: the ground-truth observables are the `trades` DB row
// (read via a SEPARATE read-only connection) + the on-chain receipt + the
// engine's own registries (exitManager timer + anti-rug detector registry) —
// NEVER an op-log line. DB_PATH is pointed at an isolated temp file BEFORE any
// src/ import so the prod DB is untouched.
//
// SHARED-NODE HARNESS NOTE: all fork files share ONE Hardhat node (globalSetup,
// port 8545) and run SEQUENTIALLY (fileParallelism:false) as Hardhat account #0.
// This test sets up its OWN isolated DB, hardhat_resets to the LADYS settled
// pin, funds the fork-only wallet, interval-mines (so the passthrough tx.wait(3)
// confirmations advance), and clears its timers + anti-rug registry on the way
// out so nothing leaks into the next fork file.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// --- DB isolation + config: set BEFORE importing any src/ module. db.ts binds
// the SQLite singleton to process.env.DB_PATH at import; bot/config read env at
// module load. The real prod DB is never touched.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberateBuyReplay-'));
process.env.DB_PATH = path.join(TMP_DIR, 'deliberate-test.db');
// Deliberate-buy private budget: keep the default (2). A normal exit-engine
// config so startExitMonitor arms a routine poll loop on the landed position.
process.env.PARTIAL_SELL_TARGETS = '';
process.env.STOP_LOSS_PCT = '25';
process.env.TRAILING_STOP_PCT = '15';
// Risk gate is NOT on the deliberate path (executeDeliberateBuy does not call
// canSnipe — it is the operator escape hatch), but set the env permissively to
// match the proven fork-test posture and avoid any incidental config edge.
process.env.MAX_POSITION_SIZE = '1';
process.env.MAX_OPEN_POSITIONS = '50';
process.env.SNIPE_COOLDOWN_MS = '0';
process.env.DAILY_LOSS_PCT = '99';
process.env.MAX_TOTAL_EXPOSURE = '1000';

import { requireRealMainnetGate, FORK_ONLY_TEST_KEY } from './helpers/realMainnetGate';
import { resolveForkRpcUrl } from './helpers/forkRpcUrl';

const PROVIDER_URL = 'http://127.0.0.1:8545';
const FORK_RPC = resolveForkRpcUrl();
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// Reuse the proven LADYS V2 fixture from Plan 21-03's realLaunches replay: an
// established, liquid ETH V2 token (~18 ETH liquidity, LP 100% burned at the
// settled block) the REAL buy path can land against. Hand-picked safe +
// tradeable + V2 (the deliberate path is V2-only — executeDeliberateBuy takes a
// DexConfigV2).
const LADYS_FIXTURE = path.resolve(__dirname, 'fixtures/realLaunches/eth-v2-tp.json');

interface LaunchFixture {
    slug: string;
    dexType: 'v2' | 'v3';
    tokenAddress: string;
    tokenSymbol: string | null;
    pairAddress: string | null;
    settledForkBlock: number | null;
    forkBlockNumber: number | null;
}

describe('Phase 21.3 plan 21.3-04 — deliberate buy -> register -> monitor fork wiring (STOP-THE-LINE-05-B)', () => {
    let provider: ethers.JsonRpcProvider;
    let wallet: ethers.Wallet;
    let chainGuardOk = false;

    // Imported lazily AFTER DB_PATH is set (so they bind to the temp DB).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let bot: any;
    let chainRegistry: any;
    let exitManager: any;
    let detector: any;
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

        // Fork-only signer (D-TEST-WALLET-FORKONLY): the throwaway Hardhat
        // account #0 key, NEVER the funded prod wallet key.
        wallet = new ethers.Wallet(FORK_ONLY_TEST_KEY, provider);

        bot = await import('../../src/bot');
        chainRegistry = await import('../../src/chainRegistry');
        exitManager = await import('../../src/utils/exitManager');
        detector = await import('../../src/anti-rug/detector');

        // Independent read-only handle to assert the DB row (the ground-truth
        // observable). A SEPARATE connection proves the row is durable on disk,
        // not just in the writer's cache.
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

    /**
     * Build a real ChainContext for ETH on the fork. mevStrategy:'passthrough'
     * so the deliberate buy lands via a direct send (a local fork has NO
     * Flashbots relay) — a TEST-SIDE ChainContext choice, NOT a src/ change. The
     * logger is a no-op (the proof here is the DB row + the engine registries,
     * not op-log lines — D-OP-DB-TRUTH).
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

    /** The V2 uniswap-v2 dex from the ETH template (a DexConfigV2 with router + factory). */
    function getV2Dex(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: any,
    ): { dexType: string; name: string; routerAddress: string; factoryAddress: string } {
        return (
            ctx.chain.dexes as Array<{ dexType: string; name: string; routerAddress: string; factoryAddress: string }>
        ).find((d) => d.dexType === 'v2' && d.name === 'uniswap-v2') as {
            dexType: string;
            name: string;
            routerAddress: string;
            factoryAddress: string;
        };
    }

    // =====================================================================
    // THE WIRING PROOF — drive the REAL executeDeliberateBuy on the fork; the
    // buy lands; assert (a) real on-chain hash, (b) a trades row with that hash,
    // (c) the position registered for anti-rug, (d) the exit monitor armed.
    // =====================================================================
    it('deliberate buy LANDS on the fork and wires register -> monitor: real hash + trades row + anti-rug registered + exit monitor armed', async () => {
        if (!chainGuardOk) {
            // env condition (the captureRehearsal precedent): the fork node was
            // unavailable / reported chainId 1 without the opt-in. NOT a code
            // regression — the test body is correct and runs when a fork RPC is up.
            console.warn('chainGuardOk=false — skipping (real-mainnet gate / fork RPC unavailable).');
            return;
        }

        const fixture: LaunchFixture = JSON.parse(fs.readFileSync(LADYS_FIXTURE, 'utf-8'));
        const forkBlock = fixture.settledForkBlock ?? fixture.forkBlockNumber;
        expect(forkBlock, 'LADYS fixture must carry a resolved fork pin').not.toBeNull();
        const token = fixture.tokenAddress;

        // Clean fork at the settled tradeable block; fund the fork-only wallet;
        // interval-mine so the passthrough strategy's tx.wait(3) confirmations
        // advance (default automine = 1 block/tx would hang the buy on confs 2-3).
        await provider.send('hardhat_reset', [{ forking: { jsonRpcUrl: FORK_RPC, blockNumber: forkBlock } }]);
        await provider.send('hardhat_setBalance', [
            wallet.address,
            '0x' + ethers.parseEther('1000000').toString(16),
        ]);
        await provider.send('evm_setIntervalMining', [500]);

        const { ctx } = buildForkChainContext();
        const dex = getV2Dex(ctx);

        // Pre-buy sanity: a fresh fork wallet holds ZERO of the token (the
        // no-double-buy chain-truth check expects balanceOf==0 + nonce unconsumed).
        const erc20 = new ethers.Contract(token, ['function balanceOf(address) view returns (uint256)'], provider);
        const preBalance: bigint = await erc20.balanceOf(wallet.address);
        expect(preBalance, 'fresh fork wallet must start with zero of the token').toBe(0n);

        // --- DRIVE THE REAL executeDeliberateBuy (NOT a mock; NOT a manual swap).
        // amountEth = 0.05 ETH. On the fork (no relay) the passthrough "private"
        // leg lands directly -> the PRIVATE-LANDED branch -> recordAndArmDeliberateBuy.
        const amountInWei = ethers.parseEther('0.05');
        const returnedHash = await bot.executeDeliberateBuy(ctx, token, amountInWei, dex);

        // (a) The deliberate buy returns a REAL on-chain tx hash (a landed buy).
        expect(returnedHash, 'executeDeliberateBuy must return a real on-chain tx hash for a landed buy').toBeTruthy();
        expect(typeof returnedHash).toBe('string');
        expect((returnedHash as string).startsWith('0x')).toBe(true);
        // The hash resolves to a real mined receipt on the fork.
        const receipt = await provider.getTransactionReceipt(returnedHash as string);
        expect(receipt, 'the returned hash must resolve to a mined on-chain receipt').toBeTruthy();
        expect(receipt!.status, 'the landed buy tx must have succeeded (status 1)').toBe(1);

        // Sanity: the fork-only wallet actually received the bought token.
        const postBalance: bigint = await erc20.balanceOf(wallet.address);
        expect(postBalance > 0n, 'fork-only wallet must hold the bought token after the deliberate buy').toBe(true);

        // (b) A trades row is recorded with the REAL hash (NOT a 'mev_bundle'
        // placeholder) — read via the SEPARATE read-only connection (D-OP-DB-TRUTH).
        const buyRow = readDb
            .prepare(
                `SELECT id, tx_hash, action, pool_type FROM trades
                 WHERE token = ? AND action = 'buy' ORDER BY id DESC LIMIT 1`,
            )
            .get(token.toLowerCase()) as
            | { id: number; tx_hash: string | null; action: string; pool_type: string | null }
            | undefined;
        expect(buyRow, 'the deliberate buy must have produced a trades buy row').toBeTruthy();
        expect(buyRow!.tx_hash, 'the trades row must carry the REAL on-chain hash, not a mev_bundle placeholder').toBe(
            returnedHash,
        );
        expect(buyRow!.tx_hash).not.toBe('mev_bundle');
        const tradeId = buyRow!.id;

        // (c) The position is REGISTERED for anti-rug (recordAndArmDeliberateBuy ->
        // armPositionMonitoring -> registerAntiRugPosition; the fork pair resolves
        // via the dex factory). Read the engine's OWN registry (the ground truth).
        const registered = detector
            .getRegisteredPositions('eth')
            .some((p: { tradeId: number }) => p.tradeId === tradeId);
        expect(registered, 'the landed deliberate buy must register the position for anti-rug (tradeId in the registry)').toBe(
            true,
        );

        // (d) The EXIT MONITOR is ARMED for {chain, token} (armPositionMonitoring ->
        // startExitMonitor). hasExitMonitorTimer reads the live timer registry —
        // the routine poll interval is running on the held position.
        const monitorArmed = exitManager.hasExitMonitorTimer('eth', token);
        expect(monitorArmed, 'the landed deliberate buy must arm the exit monitor (routine poll timer registered)').toBe(
            true,
        );

        // --- TEARDOWN: stop the live monitor + interval mining and reset the
        // anti-rug registry so no timer / registration / HTTP-poll closure leaks
        // into the next fork file (shared node).
        exitManager.clearAllTimersForToken('eth', token);
        detector._resetRegistryForTesting();
        await provider.send('evm_setIntervalMining', [0]);

        // EXPLICIT NON-CLOSURE (D-EVIDENCE-BAR): this fork pass proves the
        // buy->register->monitor WIRING of a LANDED deliberate buy via passthrough
        // (no relay on the fork). It does NOT close the LIVE items — multi-builder
        // fanout, the private->public TRANSITION, and live calm-gas inclusion need
        // a real Flashbots relay and close ONLY on the operator-gated 21-07 retry +
        // the next-snipe getBundleStatsV2 telemetry. The Task-2 operator checkpoint
        // records that posture.
        const usedPassthrough = ctx.chain.mevStrategy === 'passthrough';
        expect(usedPassthrough, 'fork rehearsal uses passthrough (no relay) — LIVE inclusion closes on the 21-07 retry').toBe(
            true,
        );
    }, 240000);

    it('drives the REAL executeDeliberateBuy (not a mock) — handler-export sanity', () => {
        if (!chainGuardOk) {
            console.warn('chainGuardOk=false — skipping handler-export sanity.');
            return;
        }
        // The wiring proof drives the REAL exported engine path. This guards the
        // acceptance criterion that executeDeliberateBuy (the real bot.ts path) is
        // the buy mechanism under rehearsal — not a mock / manual swap.
        expect(typeof bot.executeDeliberateBuy).toBe('function');
    });
});
