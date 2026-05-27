// test/fork/realLaunchReplay.fork.test.ts
// Phase 21 / Plan 21-03 / EXIT-LIVE-09 — replay real ETH launches against the
// REAL bot handler (validation -> buy -> exit-monitor -> sell lifecycle).
//
// This test drives the REAL `handleNewPairForChain` (V2) /
// `handleNewV3PoolForChain` (V3) per fixture in `fixtures/realLaunches/*.json`
// — NOT a manual swap (RESEARCH Pitfall 5 / Anti-Pattern A; the antithesis is
// snipeLifecycle.test.ts, which manually swaps via the V2 router and never
// touches the handler). It constructs a ChainContext (fork provider + fork-only
// wallet + ETH chain config), fork-pins to the fixture's settled tradeable
// block, and invokes the handler with the exact bot.ts arg order.
//
// D-TEST-WALLET-FORKONLY: signs with FORK_ONLY_TEST_KEY (Hardhat account #0,
// fork-only, zero real ETH); NEVER process.env.PRIVATE_KEY (the prod wallet).
// requireRealMainnetGate() guards before any transaction (D-GATE-BOTH-LAYERS).
//
// D-OP-DB-TRUTH / D-04: the observable effect is read from the `trades` DB
// rows, NEVER an op-log line. To keep the prod DB untouched, DB_PATH is pointed
// at an isolated temp file BEFORE any src/ import.
//
// FORK-HARNESS NOTES (empirically derived during Plan 21-03 — see
// fixtures/realLaunches/README.md):
//   1. Fixtures pin the fork at `settledForkBlock` (a block ~2000 after the
//      launch where the pool has deep liquidity AND the LP is burned), NOT at
//      `forkBlockNumber` (= launchBlock-1). At the launch MOMENT the token is
//      not yet cleanly buyable by the bot's gates (shallow liquidity + LP not
//      yet locked/burned + launch trading restrictions), so the honeypot /
//      liquidity / lock gates correctly block. `forkBlockNumber` is retained
//      for launch-replay provenance.
//   2. The ChainContext sets `mevStrategy: 'passthrough'` so the buy/sell land
//      via direct `wallet.sendTransaction` (a local fork has NO Flashbots
//      relay). This is a TEST-SIDE ChainContext choice, NOT a src/ change.
//   3. Interval mining (`evm_setIntervalMining`) is enabled so the passthrough
//      strategy's `tx.wait(3)` confirmations advance (default automine = 1
//      block/tx would hang the buy waiting for confirmations 2-3).
//   4. The risk-gate env (MAX_POSITION_SIZE / MAX_OPEN_POSITIONS / cooldown /
//      MAX_TOTAL_EXPOSURE) is set permissively pre-import so canSnipe (which
//      runs BEFORE the safety bank) passes for each fixture — the operator's
//      live .env caps would otherwise block at the risk gate.
//
// =====================================================================
// STOP-THE-LINE-01 (D-STOP-THE-LINE) — V3 tax-gate bug: FIXED in phase 21.1
// =====================================================================
// ALL fixtures (V2 AND V3) now drive the full lifecycle (buy +
// sell/partial_sell with amount_out). The V3 fixture WAS previously blocked by
// a pre-existing product bug: the V3 buy path at src/bot.ts:610 called
// hasHighTransferTaxForChain(ctx, dex.swapRouterAddress, token), but that
// function was hardcoded to V2 (getAmountsOut + the V2 router buy fn, which the
// V3 SwapRouter does NOT implement), so it reverted -> catch -> returned true
// ("high tax") -> the V3 safety-bank AND-block aborted EVERY V3 buy.
// FIXED in plan 21.1-03 (STOP-THE-LINE-01 + STOP-THE-LINE-03, D-V3-TAX-REMOVE /
// D-V2-TAX-REMOVE): the broken hasHighTransferTaxForChain call was removed from
// BOTH banks and the function deleted entirely; the on-chain
// simulateHoneypotRoundtrip gate (bot.ts:253 V2 / :566 V3, fail-closed,
// HONEY-07/09) remains the authoritative buy+sell-tax gate. The V3 fixture
// below now asserts the benign-buy + whale-dump -> stop-loss lifecycle, and a
// high-tax/honeypot token still fails closed via the roundtrip (covered by the
// V3 honeypot unit/integration tests, e.g. v3HoneypotIntegration.test.ts).
// =====================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// --- DB isolation + config: set BEFORE importing any src/ module (db.ts binds
// the singleton to process.env.DB_PATH at import; exitEngine/riskManager read
// their config from env at module load). The real prod DB is never touched.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'realLaunchReplay-'));
process.env.DB_PATH = path.join(TMP_DIR, 'replay-test.db');
// Exit-engine config: a partial tier + tight stop so fixtures can drive
// different exit branches via price action.
process.env.PARTIAL_SELL_TARGETS = '2x:50';
process.env.STOP_LOSS_PERCENT = '30';
process.env.TRAILING_STOP_PCT = '15';
// Risk gate (canSnipe runs BEFORE the safety bank). Permissive so the replay
// reaches the buy path for EACH fixture (test-process env overrides, NOT src/).
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
// Uniswap V3 SwapRouter (the ORIGINAL '0xE592...' router whose exactInputSingle
// struct embeds `deadline`). Used by dumpV3Pool only — a DIFFERENT swap
// primitive than the bot's buy (which uses SwapRouter02 '0x68b3...' via a
// multicall(deadline,[exactInputSingle]) wrapper, src/bot.ts:676-707). Keeping
// the whale's mover on a distinct primitive preserves the Anti-Pattern-A
// invariant: the bot's buy is the only thing driving the position under test.
const UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';

interface LaunchFixture {
    slug: string;
    chain: string;
    dexType: 'v2' | 'v3';
    tokenAddress: string;
    tokenSymbol: string | null;
    pairAddress: string | null;
    poolAddress: string | null;
    feeTier: number | null;
    pairCreatedBlock: number;
    mintBlock: number | null;
    firstSwapBlock: number | null;
    forkBlockNumber: number | null;
    settledForkBlock: number | null;
    blocked?: boolean;
    blockedReason?: string;
    expectedVerdict: string;
    expectedExitPath: string;
}

// Static fixture table. REMOVAL-PAIRING RULE (see README): deleting a fixture
// JSON MUST be paired with removing its entry here, or this test fails to load.
const FIXTURE_FILES = ['eth-v2-tp.json', 'eth-v2-partial.json', 'eth-v3-trailing.json'];
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/realLaunches');

function loadFixture(file: string): LaunchFixture {
    return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf-8'));
}

const HONEYPOT_CHECKER_ARTIFACT = path.resolve(
    __dirname,
    '../../artifacts/contracts/honeypot/HoneypotChecker.sol/HoneypotChecker.json',
);

describe('Phase 21 plan 21-03 — realLaunches replay drives the REAL handler (EXIT-LIVE-09)', () => {
    let provider: ethers.JsonRpcProvider;
    let wallet: ethers.Wallet;
    let chainGuardOk = false;
    let checkerArtifact: { abi: unknown[]; bytecode: string } | null = null;
    // Imported lazily AFTER DB_PATH is set (so they bind to the temp DB).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bot: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chainRegistry: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let exitManager: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let readDb: any;

    beforeAll(async () => {
        provider = new ethers.JsonRpcProvider(PROVIDER_URL, undefined, { cacheTimeout: -1 });

        // D-GATE-BOTH-LAYERS layer b: guard BEFORE any transaction.
        try {
            await requireRealMainnetGate(provider);
            chainGuardOk = true;
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`realMainnetGate blocked: ${(err as Error).message}`);
            chainGuardOk = false;
            return;
        }

        // Fork-only signer (D-TEST-WALLET-FORKONLY). NEVER process.env.PRIVATE_KEY.
        wallet = new ethers.Wallet(FORK_ONLY_TEST_KEY, provider);

        if (fs.existsSync(HONEYPOT_CHECKER_ARTIFACT)) {
            checkerArtifact = JSON.parse(fs.readFileSync(HONEYPOT_CHECKER_ARTIFACT, 'utf-8'));
        }

        bot = await import('../../src/bot');
        chainRegistry = await import('../../src/chainRegistry');
        exitManager = await import('../../src/utils/exitManager');

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
     * Build a real ChainContext for ETH on the fork. Uses the canonical ETH
     * chain template, but sets `mevStrategy: 'passthrough'` (direct send on the
     * fork — no Flashbots relay locally). A TEST-SIDE ChainContext choice, NOT a
     * src/ change. ctx.log is a no-op except it records the safety-bank skip
     * `checks` object so the V3-blocked assertion can read which gate fired.
     */
    function buildForkChainContext(): {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: any;
        getSkipChecks: () => Record<string, unknown> | null;
    } {
        const template = chainRegistry.CHAIN_TEMPLATES.eth;
        let skipChecks: Record<string, unknown> | null = null;
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
        const rec = (obj: unknown, msg?: string) => {
            const m = msg ?? (typeof obj === 'string' ? obj : '');
            if (
                (m === 'Safety checks failed, skipping' || m === 'Safety checks failed, skipping V3 snipe') &&
                typeof obj === 'object' &&
                obj !== null
            ) {
                skipChecks = (obj as { checks?: Record<string, unknown> }).checks ?? null;
            }
        };
        const ctxLog = {
            info: rec,
            warn: rec,
            error: rec,
            debug: () => {},
            fatal: () => {},
            child: () => ctxLog,
        };
        const ctx = { chain, httpProvider: provider, wsProvider: null, wallet, log: ctxLog };
        return { ctx, getSkipChecks: () => skipChecks };
    }

    /** Re-pin the fork to a block, fund the wallet, enable interval mining. */
    async function repinFundAndMine(forkBlock: number): Promise<void> {
        await provider.send('hardhat_reset', [
            { forking: { jsonRpcUrl: FORK_RPC, blockNumber: forkBlock } },
        ]);
        await provider.send('hardhat_setBalance', [
            wallet.address,
            '0x' + ethers.parseEther('1000000').toString(16),
        ]);
        // Interval mining so passthrough tx.wait(3) confirmations advance.
        await provider.send('evm_setIntervalMining', [500]);
    }

    async function deployChecker(): Promise<string> {
        if (!checkerArtifact) throw new Error('HoneypotChecker artifact not compiled');
        const factory = new ethers.ContractFactory(
            checkerArtifact.abi,
            checkerArtifact.bytecode,
            wallet,
        );
        const deployed = await factory.deploy();
        await deployed.waitForDeployment();
        return deployed.getAddress();
    }

    function countTrades(token: string, action: string): number {
        const row = readDb
            .prepare('SELECT COUNT(*) AS n FROM trades WHERE token = ? AND action = ?')
            .get(token.toLowerCase(), action) as { n: number };
        return row.n;
    }

    /**
     * Pump the V2 pool >= 2x via a large WHALE buy so the engine's exit-monitor
     * poll loop fires the partial/trailing exit. This is test scaffolding that
     * MOVES THE POOL PRICE (a third-party whale) — it does NOT replace the bot's
     * buy, which goes through the REAL handleNewPairForChain (Pitfall 5 /
     * Anti-Pattern A). We use the buy-exact-tokens router variant (a DIFFERENT
     * function than the handler's V2 buy) so the bot's buy path is the only
     * thing driving the position under test.
     */
    async function pumpV2Pool(token: string, pair: string): Promise<void> {
        const whale = ethers.Wallet.createRandom().connect(provider);
        await provider.send('hardhat_setBalance', [
            whale.address,
            '0x' + ethers.parseEther('5000000').toString(16),
        ]);
        // Buy ~70% of the token-side reserve. Removing most of the token reserve
        // pushes the WETH/token price far past 2x. swapETHForExactTokens lets us
        // target a token amount with a generous ETH cap (the whale is funded
        // with millions of fork ETH).
        const pairC = new ethers.Contract(
            pair,
            [
                'function getReserves() view returns (uint112,uint112,uint32)',
                'function token0() view returns (address)',
            ],
            provider,
        );
        const reserves = await pairC.getReserves();
        const token0 = (await pairC.token0()) as string;
        const tokenReserve =
            token0.toLowerCase() === token.toLowerCase() ? (reserves[0] as bigint) : (reserves[1] as bigint);
        const targetTokens = (tokenReserve * 70n) / 100n;
        const router = new ethers.Contract(
            UNISWAP_V2_ROUTER,
            ['function swapETHForExactTokens(uint,address[],address,uint) payable returns (uint[])'],
            whale,
        );
        const tx = await router.swapETHForExactTokens(
            targetTokens,
            [WETH, token],
            whale.address,
            Math.floor(Date.now() / 1000) + 600,
            { value: ethers.parseEther('1000000') },
        );
        await tx.wait();
    }

    /**
     * Detect the ERC20 `balances` mapping storage slot for `token` against
     * `holder`, then seed `holder` with `amount` tokens via hardhat_setStorageAt.
     *
     * Why seed instead of buy-then-sell: a whale that BUYS its bag from the same
     * pool and then sells it back nets the pool price to ~neutral (a buy/sell pair
     * is symmetric minus fees) — that cannot produce the >30% NET drop the
     * stop-loss needs. Seeding gives the whale "free" tokens it never bought from
     * this pool, so its subsequent SELL is purely one-directional: it only removes
     * WETH from the pool and pushes price DOWN. This is the standard fork technique
     * for one-sided price moves (RESEARCH §Open Q2 "seed via hardhat storage").
     *
     * Slot is detected at runtime (not hardcoded) for robustness: for each
     * candidate slot i in 0..maxSlot we compute the Solidity mapping slot
     * keccak256(abi.encode(holder, i)), write a sentinel, and check whether
     * balanceOf(holder) reflects it — restoring the original word if not.
     */
    async function seedTokenBalance(
        token: string,
        holder: string,
        amount: bigint,
        maxSlot = 20,
    ): Promise<void> {
        const erc20 = new ethers.Contract(
            token,
            ['function balanceOf(address) view returns (uint256)'],
            provider,
        );
        const sentinel = amount;
        const sentinelWord = '0x' + sentinel.toString(16).padStart(64, '0');
        for (let i = 0; i < maxSlot; i++) {
            const mappingSlot = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [holder, i]),
            );
            const original: string = await provider.send('eth_getStorageAt', [token, mappingSlot, 'latest']);
            await provider.send('hardhat_setStorageAt', [token, mappingSlot, sentinelWord]);
            const probed = (await erc20.balanceOf(holder)) as bigint;
            if (probed === sentinel) {
                return; // correct slot found and balance is now seeded
            }
            // wrong slot — restore the original word and keep probing
            await provider.send('hardhat_setStorageAt', [token, mappingSlot, original]);
        }
        throw new Error(`seedTokenBalance: could not locate balances slot for ${token} within ${maxSlot} slots`);
    }

    /**
     * Dump the V3 pool >30% via a large WHALE SELL through the V3 SwapRouter,
     * driving the price DOWN to trigger the fixture's expectedExitPath:"stop-loss"
     * (STOP_LOSS_PERCENT=30 -> fixedStopPrice = entryPrice * 0.70). The V3 analog
     * of pumpV2Pool — same conventions: a fresh random whale funded via
     * hardhat_setBalance, a THIRD-PARTY price-mover that is NOT the bot's buy
     * (preserving Anti-Pattern A: the bot's buy is the only thing driving the
     * position under test). The whale starts with NO tokens, so we seed its bag
     * via hardhat storage (see seedTokenBalance) — a buy-then-sell would net the
     * price to neutral and never produce a stop-loss-triggering NET drop.
     *
     * Uses the ORIGINAL SwapRouter (exactInputSingle WITH a deadline field) — a
     * DIFFERENT primitive than the handler's SwapRouter02 multicall buy.
     */
    async function dumpV3Pool(token: string, poolAddress: string, feeTier: number): Promise<void> {
        const whale = ethers.Wallet.createRandom().connect(provider);
        await provider.send('hardhat_setBalance', [
            whale.address,
            '0x' + ethers.parseEther('5000000').toString(16),
        ]);

        // Size the dump relative to pool depth: read the pool's token balance and
        // sell a large multiple of it so the price drops far past the 30% stop.
        // Selling ~5x the pool's current token reserve into the constant-product
        // curve collapses the token price well below 70% of entry.
        const tokenC = new ethers.Contract(
            token,
            ['function balanceOf(address) view returns (uint256)'],
            provider,
        );
        const poolTokenReserve = (await tokenC.balanceOf(poolAddress)) as bigint;
        const dumpAmount = poolTokenReserve > 0n ? poolTokenReserve * 5n : ethers.parseUnits('1000000000000', 18);

        // Seed the whale with the dump bag (free tokens — one-directional sell).
        await seedTokenBalance(token, whale.address, dumpAmount * 2n);

        // Approve the V3 router to pull the whale's tokens.
        const tokenWithSigner = new ethers.Contract(
            token,
            ['function approve(address,uint256) returns (bool)'],
            whale,
        );
        await (await tokenWithSigner.approve(UNISWAP_V3_ROUTER, ethers.MaxUint256)).wait();

        // Sell token -> WETH via the original SwapRouter exactInputSingle (struct
        // includes deadline; amountOutMinimum=0 since this is a price-mover, not a
        // value-preserving trade; sqrtPriceLimitX96=0 = no limit so the full size
        // executes and moves price).
        const router = new ethers.Contract(
            UNISWAP_V3_ROUTER,
            [
                'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)',
            ],
            whale,
        );
        const tx = await router.exactInputSingle({
            tokenIn: token,
            tokenOut: WETH,
            fee: feeTier,
            recipient: whale.address,
            deadline: Math.floor(Date.now() / 1000) + 600,
            amountIn: dumpAmount,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0n,
        });
        await tx.wait();
    }

    /** Poll the DB up to ~maxMs for a sell/partial_sell row with amount_out set. */
    async function waitForSellRow(token: string, maxMs: number): Promise<Array<{ action: string; amount_out: string }>> {
        const deadline = Date.now() + maxMs;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 5000));
            const rows = readDb
                .prepare(
                    `SELECT action, amount_out FROM trades
                     WHERE token = ? AND action IN ('sell','partial_sell') AND amount_out IS NOT NULL`,
                )
                .all(token.toLowerCase()) as Array<{ action: string; amount_out: string }>;
            if (rows.length > 0) return rows;
        }
        return [];
    }

    // -- Per-fixture replay --------------------------------------------------
    for (const file of FIXTURE_FILES) {
        const fixture = loadFixture(file);
        const forkBlock = fixture.settledForkBlock ?? fixture.forkBlockNumber;

        it(`${fixture.slug} (${fixture.dexType}, ${fixture.expectedExitPath}) drives the REAL handler`, async () => {
            if (!chainGuardOk) {
                console.warn(`${fixture.slug}: chainGuardOk=false — skipping (real-mainnet gate).`);
                return;
            }

            // A null fork pin would mean an archive-RPC block-pin failure; the
            // Task-2 precheck PASSED and all fixtures carry resolved pins, so this
            // is not expected. A null pin is skipped ONLY when the archive-RPC
            // blocker is recorded in the README (never silently).
            if (forkBlock === null) {
                console.warn(
                    `${fixture.slug}: fork block is null — skip per README Outstanding tracker / recorded archive-RPC blocker.`,
                );
                return;
            }

            await repinFundAndMine(forkBlock);
            const checkerAddress = await deployChecker();
            // getSkipChecks is no longer asserted: the V3 branch previously read
            // checks.hasTax (the field removed in plan 21.1-03); the V3 fixture now
            // drives the full buy->exit->sell lifecycle like the V2 branch.
            const { ctx } = buildForkChainContext();
            ctx.chain.honeypotChecker.deployedAddress = checkerAddress;

            const token = fixture.tokenAddress;

            if (fixture.dexType === 'v2') {
                const dex = (ctx.chain.dexes as Array<{ dexType: string; name: string }>).find(
                    (d) => d.dexType === 'v2' && d.name === 'uniswap-v2',
                );
                // EXACT bot.ts:909 arg order: handleNewPairForChain(ctx, dex, token0, token1, pair)
                await bot.handleNewPairForChain(ctx, dex, token, WETH, fixture.pairAddress);

                // The buy must land (the REAL handler ran the full validation +
                // bought) — observable D-04 ground truth: a buy row in trades.
                const buyRows = countTrades(token, 'buy');
                expect(buyRows).toBeGreaterThanOrEqual(1);

                // Drive price action so the exit-monitor poll loop fires an exit.
                // A large whale buy pushes price >= 2x (partial tier + trailing
                // activation); the engine then sells via its own poll loop.
                await pumpV2Pool(token, fixture.pairAddress as string);

                // Ground truth (D-OP-DB-TRUTH): a sell/partial_sell row with
                // amount_out NOT NULL for the fixture token — read from the DB,
                // never from an op log.
                const sellRows = await waitForSellRow(token, 80000);
                expect(sellRows.length).toBeGreaterThanOrEqual(1);
                expect(sellRows[0].amount_out).toBeTruthy();

                exitManager.clearAllTimersForToken('eth', token);
                await provider.send('evm_setIntervalMining', [0]);
            } else {
                // V3 path — full validation -> buy -> exit -> sell lifecycle
                // (D-V3-FIXTURE). The STOP-THE-LINE-01 V3 tax-gate bug is FIXED in
                // phase 21.1 (plan 21.1-03 removed the broken hasHighTransferTaxForChain
                // call from the V3 bank and deleted the function), so a benign V3
                // token now passes the safety bank and the REAL handler buys. This
                // mirrors the V2 branch above. NOTE: the fork uses the PASSTHROUGH
                // strategy (buildForkChainContext sets mevStrategy:'passthrough' —
                // no local Flashbots relay), so this proves the buy->register->exit
                // wiring + passthrough reconciliation, NOT the Flashbots path (which
                // is unit-proven in 21.1-04, D-FORK-REHEARSAL-21.1).
                const dex = (ctx.chain.dexes as Array<{ dexType: string; name: string }>).find(
                    (d) => d.dexType === 'v3' && d.name === 'uniswap-v3',
                );
                // EXACT bot.ts arg order:
                // handleNewV3PoolForChain(ctx, dex, token0, token1, feeTier, pool, blockNumber)
                // blockNumber = the historical mintBlock so waitForLiquidity's
                // same-block Mint query resolves (no 30s timeout).
                await bot.handleNewV3PoolForChain(
                    ctx,
                    dex,
                    token,
                    WETH,
                    fixture.feeTier,
                    fixture.poolAddress,
                    fixture.mintBlock,
                );

                // The buy must land — observable D-04 ground truth: a buy row in
                // trades (the REAL handler ran the full V3 validation + bought).
                expect(countTrades(token, 'buy')).toBeGreaterThanOrEqual(1);

                // Drive price DOWN >30% via a third-party whale SELL into the PEPE
                // 1% pool so the exit-monitor poll loop fires the stop-loss
                // (expectedExitPath:"stop-loss"). dumpV3Pool is NOT the bot's buy.
                await dumpV3Pool(token, fixture.poolAddress as string, fixture.feeTier as number);

                // Ground truth (D-OP-DB-TRUTH): a sell/partial_sell row with
                // amount_out NOT NULL for the fixture token — read from the DB,
                // never from an op log.
                const sellRows = await waitForSellRow(token, 80000);
                expect(sellRows.length).toBeGreaterThanOrEqual(1);
                expect(sellRows[0].amount_out).toBeTruthy();

                exitManager.clearAllTimersForToken('eth', token);
                await provider.send('evm_setIntervalMining', [0]);
            }
        }, 180000);
    }

    it('drives the REAL handler (not a manual swap) — handler-export sanity', () => {
        if (!chainGuardOk) {
            console.warn('chainGuardOk=false — skipping handler-export sanity.');
            return;
        }
        expect(typeof bot.handleNewPairForChain).toBe('function');
        expect(typeof bot.handleNewV3PoolForChain).toBe('function');
    });
});
