// test/fork/captureRehearsal.fork.test.ts
// Phase 21 / Plan 21-06 / D-FORK-REHEARSAL — rehearse the EXACT live-capture
// sequence (Plan 07) on a mainnet fork, end-to-end, BEFORE the real-capital run.
//
// THE REHEARSED SEQUENCE (mirrors the operator's real run so Plan 07 follows a
// proven path):
//   1. bot-buy a hand-picked liquid/established SAFE token through the REAL buy
//      path (handleNewPairForChain) — the buy is just the means to obtain a
//      position (D-CAPTURE-METHOD); the REAL handler also arms the exit monitor
//      (src/bot.ts:458 calls startExitMonitor), so the engine's OWN 5s poll loop
//      starts running on the bought position.
//   2. configure a TIGHT stop the position immediately satisfies (D-EXIT-TRIGGER /
//      RESEARCH Assumption A5: a fixed stop-loss fires below 2x when
//      currentPrice <= entryPrice*(1 - STOP_LOSS_PCT/100); a small downward tick
//      is the trigger). We set STOP_LOSS_PCT tight AND induce a downward price
//      move so the threshold is unambiguously crossed.
//   3. let the exit engine's OWN poll loop fire executeFullSell on the next cycle
//      — the REAL exit-trigger path (pollExitStrategy -> stop-loss branch ->
//      executeFullSell, src/exitEngine.ts:802-816), NOT the emergency-sell manual
//      override (D-EXIT-TRIGGER).
//   4. verify the sell recorded a NON-NULL trades.amount_out via decodeReceipt
//      (executeFullSell -> sendTxWithRetry -> decodeReceipt -> insertTrade,
//      src/exitEngine.ts:501-547) AND the exit-engine trigger path end-to-end.
//
// TOKEN CHOICE — Uniswap **V2** (LADYS, the proven Plan 21-03 realLaunches
// fixture), per the locked capture decisions (D-CHAIN-SINGLE-ROUNDTRIP /
// D-CAPTURE-METHOD): an established, liquid, SAFE ETH token, which is V2.
// HISTORICAL NOTE: the V3 buy path was previously blocked by a V3 tax-gate bug
// (src/bot.ts:610 passed the V3 SwapRouter to the V2-only
// hasHighTransferTaxForChain -> reverted -> fail-closed -> aborted every V3 buy).
// That bug is FIXED in phase 21.1 (plan 21.1-03 removed the broken tax call from
// both banks and deleted the function; see
// .planning/phases/21-exit-engine-live-runtime-hardening/21-STOP-THE-LINE-01-v3-buy-tax-gate.md
// and test/fork/realLaunchReplay.fork.test.ts, whose V3 fixture now drives the
// full lifecycle). The V2 token choice here is driven by the capture decisions
// above, not by that (now-resolved) bug.
//
// =====================================================================
// CRITICAL FRAMING — THIS IS A DE-RISK GATE, NOT A REQUIREMENT CLOSURE.
// =====================================================================
// This rehearsal VALIDATES THE EXIT-LIVE-03 sell->amount_out->receipt-decode
// MECHANISM and EXERCISES the EXIT-LIVE-04 Flashbots-routing CALL PATH on a fork.
// BUT a local Hardhat fork has NO Flashbots relay, so:
//   - it CANNOT produce the EXIT-LIVE-04 bundle-hash -> mined-tx artifact, and
//   - per D-EVIDENCE-BAR a fork-test pass NEVER closes a deferred item.
// EXIT-LIVE-03 and EXIT-LIVE-04 are owned and CLOSED solely by Plan 07 (the
// real-mainnet, autonomous:false run) + Plan 08 (the evidence doc). This plan's
// `requirements` frontmatter is intentionally EMPTY — it claims NO closure; it is
// the hard precondition Plan 07 depends_on. To keep the fork honest the
// ChainContext uses mevStrategy:'passthrough' (a local fork has no relay) — a
// TEST-SIDE ChainContext choice, NOT a src/ change. The real run routes the sell
// through Flashbots (FIX-09 tested retry path).
//
// D-OP-DB-TRUTH / D-04: the GROUND TRUTH that "the exit happened" is the DB
// receipt-decoded trades.amount_out (NOT NULL) + the on-chain receipt — NEVER a
// log line or an op metric. We DO capture the engine's `op` events (via a
// recording logger) to assert the engine's own poll loop fired the stop-loss /
// full-sell path (a FILTERING check that it was the real trigger, not the
// emergency override), but the PROOF is the asserted DB amount_out row.
//
// SAFETY: requireRealMainnetGate() guards before any transaction
// (D-GATE-BOTH-LAYERS layer b); the fork-only signer is FORK_ONLY_TEST_KEY
// (Hardhat account #0, zero real ETH); the production wallet key env var (the
// prod PRIVATE_KEY read at src/utils/provider.ts:59) is NEVER loaded by this test.
//
// SHARED-NODE HARNESS NOTE: all fork files share ONE Hardhat node (globalSetup,
// port 8545) and run SEQUENTIALLY (fileParallelism:false) as the same Hardhat
// account #0. This test sets up its OWN isolated DB (DB_PATH temp file), reads
// nonces fresh (via ethers), and hardhat_resets the fork to a clean pinned block
// — it does not assume a pristine balance or file order.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// --- DB isolation + config: set BEFORE importing any src/ module. db.ts binds the
// SQLite singleton to process.env.DB_PATH at import; exitEngine/config read their
// values from env at module load. The real prod DB is never touched.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'captureRehearsal-'));
process.env.DB_PATH = path.join(TMP_DIR, 'rehearsal-test.db');
// TIGHT stop config (D-EXIT-TRIGGER). NO partial tiers, so the clean trigger is
// the fixed stop-loss branch (NOT a partial-sell tier): the position
// immediately satisfies a tight stop below 2x and the poll loop fires
// executeFullSell. STOP_LOSS_PCT is the var src/config.ts:221 actually reads
// (process.env.STOP_LOSS_PCT || '25'); we set it tight at 5%.
process.env.PARTIAL_SELL_TARGETS = '';
process.env.STOP_LOSS_PCT = '5';
process.env.TRAILING_STOP_PCT = '15';
// Risk gate (canSnipe runs BEFORE the safety bank). Permissive so the rehearsal
// reaches the buy path (test-process env overrides, NOT a src/ change). Mirrors
// the proven Plan 21-03 / 21-04 fork-test env.
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

// Reuse the proven LADYS V2 fixture from Plan 21-03's realLaunches replay: an
// established, liquid ETH V2 token (~18 ETH liquidity, LP 100% burned at the
// settled block) that the REAL handler can buy. Hand-picked safe + tradeable +
// V2 (D-CAPTURE-METHOD / not blocked by the 21.1 V3-buy bug).
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

// A captured `op`-tagged log entry (the engine emits these as the first arg of
// log.<level>({ ..., op }, msg)). Used only as a FILTERING check that the
// engine's OWN poll loop fired the stop-loss / full-sell path — the PROOF of the
// exit is the DB amount_out row (D-OP-DB-TRUTH), never these.
interface OpEntry {
    op: string;
    fields: Record<string, unknown>;
}

describe('Phase 21 plan 21-06 — fork rehearsal of the live-capture sequence (D-FORK-REHEARSAL)', () => {
    let provider: ethers.JsonRpcProvider;
    let wallet: ethers.Wallet;
    let chainGuardOk = false;
    let checkerArtifact: { abi: unknown[]; bytecode: string } | null = null;

    // Imported lazily AFTER DB_PATH is set (so they bind to the temp DB).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let bot: any;
    let exitManager: any;
    let chainRegistry: any;
    let readDb: any;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // Recording sink for the engine's `op` events (FILTERING check only).
    const opLog: OpEntry[] = [];

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

        if (fs.existsSync(HONEYPOT_CHECKER_ARTIFACT)) {
            checkerArtifact = JSON.parse(fs.readFileSync(HONEYPOT_CHECKER_ARTIFACT, 'utf-8'));
        }

        bot = await import('../../src/bot');
        exitManager = await import('../../src/utils/exitManager');
        chainRegistry = await import('../../src/chainRegistry');

        // Independent read-only handle to assert the DB row (the ground-truth
        // observable). A SEPARATE connection from the engine's singleton proves
        // the row is durable on disk, not just in the writer's cache.
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
     * Build a real ChainContext for ETH on the fork (mirrors Plan 21-03/21-04).
     * mevStrategy:'passthrough' so any buy/sell lands via a direct send (a local
     * fork has NO Flashbots relay) — a TEST-SIDE ChainContext choice, NOT a src/
     * change. The logger RECORDS `op`-tagged entries so the test can assert the
     * engine's own poll loop fired the stop-loss / full-sell path (filtering
     * check); the DB amount_out row is the proof (D-OP-DB-TRUTH).
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
        // pino-shaped logger that records `op`-tagged entries (first-arg object
        // with an `op` field). Everything else is a no-op.
        const record = (obj: unknown) => {
            if (obj && typeof obj === 'object' && 'op' in (obj as Record<string, unknown>)) {
                const fields = obj as Record<string, unknown>;
                opLog.push({ op: String(fields.op), fields });
            }
        };
        const ctxLog: Record<string, unknown> = {};
        ctxLog.info = record;
        ctxLog.warn = record;
        ctxLog.error = record;
        ctxLog.debug = record;
        ctxLog.fatal = record;
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

    /** The V2 pair's WETH/token reserves and token0 (for sizing the price move). */
    async function getPairState(pair: string, token: string): Promise<{ tokenReserve: bigint; token0: string }> {
        const pairC = new ethers.Contract(
            pair,
            ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)'],
            provider,
        );
        const reserves = await pairC.getReserves();
        const token0 = (await pairC.token0()) as string;
        const tokenReserve =
            token0.toLowerCase() === token.toLowerCase() ? (reserves[0] as bigint) : (reserves[1] as bigint);
        return { tokenReserve, token0 };
    }

    /** Poll the DB up to maxMs for a full-`sell` row with amount_out set. */
    async function waitForSellRow(
        token: string,
        maxMs: number,
    ): Promise<Array<{ action: string; amount_out: string | null; tx_hash: string | null; block: number | null }>> {
        const deadline = Date.now() + maxMs;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 2500));
            const rows = readDb
                .prepare(
                    `SELECT action, amount_out, tx_hash, block FROM trades
                     WHERE token = ? AND action = 'sell' AND amount_out IS NOT NULL`,
                )
                .all(token.toLowerCase()) as Array<{
                action: string;
                amount_out: string | null;
                tx_hash: string | null;
                block: number | null;
            }>;
            if (rows.length > 0) return rows;
        }
        return [];
    }

    // =====================================================================
    // THE REHEARSAL — buy -> tight stop -> poll loop fires executeFullSell ->
    // non-null trades.amount_out (via decodeReceipt), end-to-end, on a V2 token.
    // =====================================================================
    it('bot-buys a V2 token, a tight stop fires the engine poll loop sell, and trades.amount_out is non-null', async () => {
        if (!chainGuardOk) {
            console.warn('chainGuardOk=false — skipping (real-mainnet gate).');
            return;
        }
        if (!checkerArtifact) {
            console.warn('HoneypotChecker artifact not compiled — skipping rehearsal.');
            return;
        }

        const fixture: LaunchFixture = JSON.parse(fs.readFileSync(LADYS_FIXTURE, 'utf-8'));
        const forkBlock = fixture.settledForkBlock ?? fixture.forkBlockNumber;
        expect(forkBlock, 'LADYS fixture must carry a resolved fork pin').not.toBeNull();
        const token = fixture.tokenAddress;
        const pair = fixture.pairAddress as string;

        // Clean fork at the settled tradeable block; fund the fork-only wallet;
        // interval-mine so the passthrough strategy's tx.wait(3) confirmations
        // advance (default automine = 1 block/tx hangs the buy waiting for confs).
        await provider.send('hardhat_reset', [
            { forking: { jsonRpcUrl: FORK_RPC, blockNumber: forkBlock } },
        ]);
        await provider.send('hardhat_setBalance', [
            wallet.address,
            '0x' + ethers.parseEther('1000000').toString(16),
        ]);
        await provider.send('evm_setIntervalMining', [500]);

        // Deploy the HoneypotChecker the gate calls (fork has none).
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

        // --- STEP A: elevate the entry price so the post-buy drop is unambiguous.
        // A funded WHALE (a DIFFERENT actor than the bot) buys a large chunk of the
        // token BEFORE the bot, pushing the token's WETH price UP. The bot's REAL
        // buy then records its exit-monitor entryPrice at this ELEVATED price.
        // Sizing/direction scaffolding only — it does NOT replace the bot's buy,
        // which goes through the REAL handleNewPairForChain (D-CAPTURE-METHOD).
        const whale = ethers.Wallet.createRandom().connect(provider);
        await provider.send('hardhat_setBalance', [
            whale.address,
            '0x' + ethers.parseEther('5000000').toString(16),
        ]);
        const routerAsWhale = new ethers.Contract(
            UNISWAP_V2_ROUTER,
            [
                'function swapETHForExactTokens(uint,address[],address,uint) payable returns (uint[])',
                'function swapExactTokensForETH(uint,uint,address[],address,uint) returns (uint[])',
            ],
            whale,
        );
        const erc20AsWhale = new ethers.Contract(
            token,
            [
                'function balanceOf(address) view returns (uint256)',
                'function approve(address,uint256) returns (bool)',
            ],
            whale,
        );
        const { tokenReserve: reserveBeforeWhale } = await getPairState(pair, token);
        // Whale acquires ~50% of the token reserve (elevates price; whale now holds
        // a large token bag it will later dump to crater the price below entry).
        const whaleTargetTokens = (reserveBeforeWhale * 50n) / 100n;
        const whaleBuyTx = await routerAsWhale.swapETHForExactTokens(
            whaleTargetTokens,
            [WETH, token],
            whale.address,
            Math.floor(Date.now() / 1000) + 600,
            { value: ethers.parseEther('1000000') },
        );
        await whaleBuyTx.wait();

        // --- STEP B: bot buys via the REAL handler (EXACT bot.ts:909 arg order).
        // NOT a manual swap. The handler runs the FULL validation pipeline, buys,
        // and ARMS the exit monitor (src/bot.ts:458 startExitMonitor) — so the
        // engine's OWN 5s poll loop begins running on the bought position.
        await bot.handleNewPairForChain(ctx, dex, token, WETH, pair);

        // The buy must have landed — observable D-04 ground truth: a buy row.
        const buyRow = readDb
            .prepare("SELECT id FROM trades WHERE token = ? AND action = 'buy' ORDER BY id DESC LIMIT 1")
            .get(token.toLowerCase()) as { id: number } | undefined;
        expect(buyRow, 'REAL handler must have produced a buy row (the position to exit)').toBeTruthy();

        // Sanity: the fork-only wallet actually holds the bought token.
        const erc20 = new ethers.Contract(token, ['function balanceOf(address) view returns (uint256)'], provider);
        const botBalance: bigint = await erc20.balanceOf(wallet.address);
        expect(botBalance > 0n, 'fork-only wallet must hold the bought token').toBe(true);

        // --- STEP C: induce the downward price tick the TIGHT stop satisfies.
        // The whale dumps its ENTIRE token bag back into the pool — removing WETH
        // and adding tokens craters the token's WETH price far below the bot's
        // (elevated) entry, well past the 5% STOP_LOSS_PCT threshold. The engine's
        // OWN poll loop (already running from STEP B) then sees
        // currentPrice <= entryPrice*(1-0.05) on its next cycle and fires
        // executeFullSell('stop-loss') — the REAL exit-trigger path, NOT the
        // emergency-sell override (D-EXIT-TRIGGER).
        const whaleBag: bigint = await erc20AsWhale.balanceOf(whale.address);
        expect(whaleBag > 0n, 'whale must hold tokens to dump').toBe(true);
        const approveTx = await erc20AsWhale.approve(UNISWAP_V2_ROUTER, whaleBag);
        await approveTx.wait();
        const whaleDumpTx = await routerAsWhale.swapExactTokensForETH(
            whaleBag,
            0,
            [token, WETH],
            whale.address,
            Math.floor(Date.now() / 1000) + 600,
        );
        await whaleDumpTx.wait();

        // --- STEP D: let the engine's OWN poll loop fire the sell, then assert the
        // GROUND TRUTH (D-OP-DB-TRUTH / D-04): a full `sell` row with amount_out
        // NOT NULL for the token, read from the DB via a separate connection —
        // never from an op log. amount_out is produced by decodeReceipt parsing
        // the WETH Withdrawal (V2) event off the on-chain sell receipt.
        const sellRows = await waitForSellRow(token, 90000);

        // Stop the live monitor + interval mining so the node settles and no timer
        // leaks into the next fork file (shared node).
        exitManager.clearAllTimersForToken('eth', token);
        await provider.send('evm_setIntervalMining', [0]);

        expect(
            sellRows.length,
            'the engine poll loop must have recorded a full sell with non-null amount_out',
        ).toBeGreaterThanOrEqual(1);
        // The proof: trades.amount_out NOT NULL (a real ETH-out bigint string).
        expect(sellRows[0].amount_out).toBeTruthy();
        expect(BigInt(sellRows[0].amount_out as string) > 0n).toBe(true);
        // The sell recorded a real on-chain tx + block (decodeReceipt ran on a real
        // receipt — the EXIT-LIVE-03 mechanism the real run reproduces).
        expect(sellRows[0].tx_hash).toBeTruthy();
        expect(sellRows[0].block).toBeTruthy();

        // FILTERING CHECK (NOT proof): the engine's OWN poll loop drove the exit
        // via the stop-loss trigger and the full-sell path — NOT the emergency-sell
        // manual override (D-EXIT-TRIGGER). Asserted from the captured `op` stream;
        // the DB amount_out above is the actual proof (D-OP-DB-TRUTH).
        const ops = opLog.map((e) => e.op);
        expect(ops, 'poll-cycle telemetry must have fired (the engine poll loop ran)').toContain(
            'exit.poll.cycle',
        );
        expect(ops, 'the tight stop must have fired the engine-own stop-loss trigger').toContain(
            'exit.trigger.stop-loss',
        );
        expect(ops, 'executeFullSell (success-criterion-4 op) must have fired').toContain(
            'exit.full.executed',
        );
        expect(ops, 'decodeReceipt must have run on the sell receipt').toContain('exit.receipt.decoded');
        // The full-sell op carried the stop-loss reason (the real trigger path),
        // proving it was the poll loop's stop-loss exit, not anti-rug/urgency.
        const fullExecuted = opLog.find((e) => e.op === 'exit.full.executed');
        expect(fullExecuted?.fields.reason).toBe('stop-loss');

        // The exit.receipt.decoded op's amountOut must agree with the DB row's
        // amount_out (same value via the same decodeReceipt call) — but the DB row
        // remains the source of truth, the op is the filter.
        const decoded = opLog.find((e) => e.op === 'exit.receipt.decoded');
        expect(String(decoded?.fields.amountOut)).toBe(sellRows[0].amount_out);

        // EXPLICIT NON-CLOSURE (D-EVIDENCE-BAR): this fork rehearsal closes NO
        // requirement. The fork has no Flashbots relay (mevStrategy:'passthrough'
        // here), so it cannot produce the EXIT-LIVE-04 bundle-hash -> mined-tx
        // artifact, and a fork-test pass NEVER closes a deferred item. EXIT-LIVE-03
        // and EXIT-LIVE-04 close ONLY on Plan 07's real-mainnet run + Plan 08's
        // evidence doc. This test asserts nothing about closing 03/04 — it is the
        // hard de-risk GATE that Plan 07 depends_on being green.
        const usedPassthrough = ctx.chain.mevStrategy === 'passthrough';
        expect(usedPassthrough, 'fork rehearsal uses passthrough (no relay) — closure is Plan 07 real run').toBe(
            true,
        );
    }, 240000);

    it('drives the REAL handler (not a manual swap) — handler-export sanity', () => {
        if (!chainGuardOk) {
            console.warn('chainGuardOk=false — skipping handler-export sanity.');
            return;
        }
        // The rehearsal obtains the position via the REAL buy path. This guards
        // the acceptance criterion that the handler (not a manual swapExact* call)
        // is the buy mechanism under rehearsal.
        expect(typeof bot.handleNewPairForChain).toBe('function');
    });
});
