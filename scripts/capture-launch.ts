// scripts/capture-launch.ts
//
// Phase 21 / Plan 21-03 / EXIT-LIVE-09 — offline archive-RPC launch recorder.
//
// Records a real historical ETH token launch (PairCreated/PoolCreated -> Mint
// -> first Swap) by token address + launch block into a deterministic
// `test/fork/fixtures/realLaunches/<slug>.json` fixture, consumed by
// `test/fork/realLaunchReplay.fork.test.ts` (D-FIXTURE-SELECTION).
//
// READ-ONLY: this script ONLY performs archive `getLogs` / `queryFilter` /
// `getBlock` reads. It NEVER sends a transaction and NEVER touches a private
// key (T-21-03-01 / T-21-03-02). The bot wallet's `PRIVATE_KEY` is never read.
//
// Usage:
//   npx ts-node scripts/capture-launch.ts <tokenAddress> [--dex v2|v3] \
//       [--block <launchBlock>] [--fee 500|3000|10000] [--slug <name>] \
//       [--window <blocks>] [--symbol <SYM>] [--exit-path <path>]
//
//   <tokenAddress>   REQUIRED. The launch token address. Checksum-validated via
//                    ethers.getAddress (V5 input validation — a malformed/typo
//                    address baked into a fixture would later drive a fork buy).
//   --dex v2|v3      DEX family to resolve (default v2).
//   --block <n>      Launch block hint. If omitted the script searches a wide
//                    window backwards from chain head for the PairCreated/
//                    PoolCreated event (slower; supplying --block is preferred
//                    for determinism and free-tier getLogs window limits).
//   --fee <n>        V3 fee tier (500/3000/10000). Required-ish for --dex v3 to
//                    disambiguate the pool; if omitted, the first PoolCreated
//                    for the token in-window is used and its fee recorded.
//   --slug <name>    Output filename slug (default eth-<dex>-<symbol-or-addr>).
//   --window <n>     getLogs scan window in blocks around --block (default 10).
//                    NOTE: Alchemy's FREE tier caps eth_getLogs at a 10-block
//                    range — keep --window <= 10 on a free key, or set a PAYG/
//                    archive CAPTURE_ARCHIVE_RPC_URL to widen it. With a 10-block
//                    window, supply a --block within ~5 blocks of PairCreated.
//   --symbol <SYM>   Override the on-chain symbol in the fixture narration.
//   --exit-path <p>  expectedExitPath narration (take-profit|partial-sell|
//                    trailing-stop|stop-loss). Informational only.
//
// Archive provider source (precedence): CAPTURE_ARCHIVE_RPC_URL ->
// ETH_FORK_RPC_URL -> ETH_RPC_URL -> ALCHEMY_URL. The configured endpoint MUST
// be archive-enabled (historical getLogs at arbitrary past blocks). This mirrors
// the `ETH_FORK_RPC_URL || ALCHEMY_URL` fallback in test/fork/setup.ts, extended
// to prefer an explicit CAPTURE_ARCHIVE_RPC_URL (D-ENV-EXAMPLE) and to fall
// through to ETH_RPC_URL because some environments carry the real archive key
// there while ALCHEMY_URL is a placeholder.
//
// CRITICAL fixture invariant: forkBlockNumber = launchBlock - 1, so the fork
// replays the launch txn as the NEXT block (rugs/README.md:81 precedent).
//
// Exit conventions (preflight.ts): 0 success, 1 usage/expected failure,
// 2 uncaught throw. Pino-only — no console API.

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';

import { logger } from '../src/utils/logger';
import {
    FACTORY_ABI,
    V3_FACTORY_ABI,
    V3_POOL_ABI,
    PAIR_ABI,
    ERC20_ABI,
} from '../src/utils/abis';

dotenv.config();

const log = logger.child({ module: 'capture-launch' });

// Canonical ETH mainnet contract addresses (match chainRegistry.ts ETH template
// + honeypotChecker.fork.test.ts). Recorded into the fixture so the replay test
// constructs the same DEX config the bot uses.
const ETH = {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    UNISWAP_V2_FACTORY: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    UNISWAP_V2_ROUTER: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    UNISWAP_V3_FACTORY: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    UNISWAP_V3_SWAP_ROUTER: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    UNISWAP_V3_QUOTER: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
} as const;

// V2 Pair Swap event — used to locate the FIRST trade after the Mint.
const PAIR_SWAP_ABI = [
    'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)',
];
// V3 Pool Swap event.
const V3_POOL_SWAP_ABI = [
    'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
];

interface CliArgs {
    tokenAddress: string;
    dex: 'v2' | 'v3';
    block: number | null;
    fee: number | null;
    slug: string | null;
    window: number;
    symbol: string | null;
    exitPath: string | null;
}

/**
 * Parse + validate argv. Fails fast (log.fatal + exit 1) on a missing or
 * malformed token address. Returns the parsed args on success.
 */
function parseArgs(argv: string[]): CliArgs {
    const rawToken = argv[2];
    if (!rawToken || rawToken.startsWith('--')) {
        log.fatal(
            { argv: argv.slice(2) },
            'Usage: ts-node scripts/capture-launch.ts <tokenAddress> [--dex v2|v3] [--block <n>] [--fee 500|3000|10000] [--slug <name>] [--window <n>] [--symbol <SYM>] [--exit-path <p>]',
        );
        process.exit(1);
    }

    // Checksum-validate the token address. A malformed/typo address baked into
    // a fixture would later drive a fork buy at the wrong contract (T-21-03-01).
    let tokenAddress: string;
    try {
        tokenAddress = ethers.getAddress(rawToken);
    } catch {
        log.fatal({ tokenAddress: rawToken }, 'Invalid token address (failed ethers.getAddress checksum validation)');
        process.exit(1);
    }

    const getOpt = (name: string): string | undefined => {
        const idx = argv.indexOf(`--${name}`);
        return idx !== -1 ? argv[idx + 1] : undefined;
    };

    const dexRaw = (getOpt('dex') || 'v2').toLowerCase();
    if (dexRaw !== 'v2' && dexRaw !== 'v3') {
        log.fatal({ dex: dexRaw }, 'Invalid --dex (expected v2 or v3)');
        process.exit(1);
    }
    const dex = dexRaw as 'v2' | 'v3';

    let block: number | null = null;
    const blockRaw = getOpt('block');
    if (blockRaw !== undefined) {
        block = Number(blockRaw);
        if (!Number.isInteger(block) || block <= 0) {
            log.fatal({ block: blockRaw }, 'Invalid --block (expected a positive integer)');
            process.exit(1);
        }
    }

    let fee: number | null = null;
    const feeRaw = getOpt('fee');
    if (feeRaw !== undefined) {
        fee = Number(feeRaw);
        if (![500, 3000, 10000].includes(fee)) {
            log.fatal({ fee: feeRaw }, 'Invalid --fee (expected 500, 3000, or 10000)');
            process.exit(1);
        }
    }

    let window = 10;
    const windowRaw = getOpt('window');
    if (windowRaw !== undefined) {
        window = Number(windowRaw);
        if (!Number.isInteger(window) || window <= 0) {
            log.fatal({ window: windowRaw }, 'Invalid --window (expected a positive integer)');
            process.exit(1);
        }
    }

    return {
        tokenAddress,
        dex,
        block,
        fee,
        slug: getOpt('slug') ?? null,
        window,
        symbol: getOpt('symbol') ?? null,
        exitPath: getOpt('exit-path') ?? null,
    };
}

/**
 * Resolve the archive RPC endpoint. Precedence: CAPTURE_ARCHIVE_RPC_URL ->
 * ETH_FORK_RPC_URL -> ETH_RPC_URL -> ALCHEMY_URL. Skips obvious placeholder
 * keys (e.g. ".../v2/YOUR_KEY") so a placeholder ALCHEMY_URL does not mask a
 * real archive key set elsewhere.
 */
function resolveArchiveRpcUrl(): string {
    const isReal = (u: string | undefined): u is string => {
        if (!u) return false;
        return !/\/v2\/(YOUR_KEY|your[-_]?key|<[^>]+>)\b/i.test(u) && !u.includes('YOUR_KEY');
    };
    const candidates: Array<[string, string | undefined]> = [
        ['CAPTURE_ARCHIVE_RPC_URL', process.env.CAPTURE_ARCHIVE_RPC_URL],
        ['ETH_FORK_RPC_URL', process.env.ETH_FORK_RPC_URL],
        ['ETH_RPC_URL', process.env.ETH_RPC_URL],
        ['ALCHEMY_URL', process.env.ALCHEMY_URL],
    ];
    for (const [name, url] of candidates) {
        if (isReal(url)) {
            log.info({ source: name }, 'Using archive RPC endpoint (key redacted)');
            return url;
        }
    }
    log.fatal(
        { tried: candidates.map(([n]) => n) },
        'No usable archive RPC endpoint found. Set CAPTURE_ARCHIVE_RPC_URL (or ETH_FORK_RPC_URL / ETH_RPC_URL / ALCHEMY_URL) to an ARCHIVE-tier endpoint that serves historical getLogs.',
    );
    process.exit(1);
}

// Alchemy free-tier eth_getLogs hard cap (blocks per request). Each
// queryFilter call MUST stay within this range or the RPC returns -32600.
const MAX_GETLOGS_RANGE = 10;
// How far past the mint block to chase the first Swap (in MAX_GETLOGS_RANGE
// chunks). 5 chunks = 50 blocks (~10 min) — a launch's first trade is almost
// always within this window.
const MAX_LOOKAHEAD_CHUNKS = 5;

/**
 * Locate the PairCreated (V2) or PoolCreated (V3) event for the token. If a
 * launch block hint is provided, scans a tight window around it; otherwise the
 * caller must supply --block (an unbounded backward scan would exceed free-tier
 * getLogs limits). Returns the decoded event + the block it was emitted in.
 *
 * The scan window is clamped to MAX_GETLOGS_RANGE so a single getLogs call
 * stays within the free-tier cap.
 */
async function findCreationEvent(
    provider: ethers.JsonRpcProvider,
    args: CliArgs,
): Promise<{ otherToken: string; pairOrPool: string; fee: number | null; block: number }> {
    const token = args.tokenAddress;
    if (args.block === null) {
        log.fatal(
            { token },
            'A --block launch-block hint is required (archive getLogs windows are bounded; supply the PairCreated/PoolCreated block).',
        );
        process.exit(1);
    }
    // queryFilter block bounds are INCLUSIVE, so an N-block range spans
    // [from, from + N - 1]. Free tier caps the inclusive span at
    // MAX_GETLOGS_RANGE blocks.
    const effectiveWindow = Math.min(args.window, MAX_GETLOGS_RANGE);
    const half = Math.floor(effectiveWindow / 2);
    const fromBlock = Math.max(0, args.block - half);
    const toBlock = fromBlock + effectiveWindow - 1;

    if (args.dex === 'v2') {
        const factory = new ethers.Contract(ETH.UNISWAP_V2_FACTORY, FACTORY_ABI, provider);
        // PairCreated(token0, token1, pair, uint): token is token0 OR token1.
        const asT0 = await factory.queryFilter(factory.filters.PairCreated(token), fromBlock, toBlock);
        const asT1 = await factory.queryFilter(factory.filters.PairCreated(null, token), fromBlock, toBlock);
        const all = [...asT0, ...asT1].filter((e): e is ethers.EventLog => 'args' in e);
        if (all.length === 0) {
            log.fatal({ token, fromBlock, toBlock }, 'No V2 PairCreated event found in window — check --block / --window / --dex.');
            process.exit(1);
        }
        all.sort((a, b) => a.blockNumber - b.blockNumber);
        const ev = all[0];
        const token0 = ev.args[0] as string;
        const token1 = ev.args[1] as string;
        const pair = ev.args[2] as string;
        const otherToken = token0.toLowerCase() === token.toLowerCase() ? token1 : token0;
        return { otherToken, pairOrPool: pair, fee: null, block: ev.blockNumber };
    }

    // V3
    const factory = new ethers.Contract(ETH.UNISWAP_V3_FACTORY, V3_FACTORY_ABI, provider);
    const asT0 = await factory.queryFilter(factory.filters.PoolCreated(token), fromBlock, toBlock);
    const asT1 = await factory.queryFilter(factory.filters.PoolCreated(null, token), fromBlock, toBlock);
    let all = [...asT0, ...asT1].filter((e): e is ethers.EventLog => 'args' in e);
    if (args.fee !== null) {
        all = all.filter((e) => Number(e.args[2]) === args.fee);
    }
    if (all.length === 0) {
        log.fatal({ token, fromBlock, toBlock, fee: args.fee }, 'No V3 PoolCreated event found in window — check --block / --window / --fee / --dex.');
        process.exit(1);
    }
    all.sort((a, b) => a.blockNumber - b.blockNumber);
    const ev = all[0];
    const token0 = ev.args[0] as string;
    const token1 = ev.args[1] as string;
    const fee = Number(ev.args[2]);
    const pool = ev.args[4] as string;
    const otherToken = token0.toLowerCase() === token.toLowerCase() ? token1 : token0;
    return { otherToken, pairOrPool: pool, fee, block: ev.blockNumber };
}

/**
 * Scan forward from `fromBlock` for the first matching event on a single
 * contract, in MAX_GETLOGS_RANGE-block chunks (free-tier safe), up to
 * MAX_LOOKAHEAD_CHUNKS chunks. Returns the block of the earliest match, or null.
 */
async function findFirstEventBlock(
    contract: ethers.Contract,
    filter: ethers.DeferredTopicFilter,
    fromBlock: number,
): Promise<number | null> {
    for (let chunk = 0; chunk < MAX_LOOKAHEAD_CHUNKS; chunk++) {
        const lo = fromBlock + chunk * MAX_GETLOGS_RANGE;
        // Inclusive bounds: an N-block range spans [lo, lo + N - 1].
        const hi = lo + MAX_GETLOGS_RANGE - 1;
        const events = await contract.queryFilter(filter, lo, hi);
        if (events.length > 0) {
            // Earliest by block then logIndex.
            const sorted = [...events].sort(
                (a, b) => a.blockNumber - b.blockNumber || a.index - b.index,
            );
            return sorted[0].blockNumber;
        }
    }
    return null;
}

/** Find the first Mint event on the pair/pool at or after the creation block. */
async function findFirstMintBlock(
    provider: ethers.JsonRpcProvider,
    dex: 'v2' | 'v3',
    pairOrPool: string,
    fromBlock: number,
): Promise<number | null> {
    if (dex === 'v2') {
        // V2 Mint(address indexed sender, uint amount0, uint amount1)
        const v2PairMintAbi = ['event Mint(address indexed sender, uint amount0, uint amount1)'];
        const pair = new ethers.Contract(pairOrPool, v2PairMintAbi, provider);
        return findFirstEventBlock(pair, pair.filters.Mint(), fromBlock);
    }
    const pool = new ethers.Contract(pairOrPool, V3_POOL_ABI, provider);
    return findFirstEventBlock(pool, pool.filters.Mint(), fromBlock);
}

/** Find the first Swap event on the pair/pool at or after the mint block. */
async function findFirstSwapBlock(
    provider: ethers.JsonRpcProvider,
    dex: 'v2' | 'v3',
    pairOrPool: string,
    fromBlock: number,
): Promise<number | null> {
    const abi = dex === 'v2' ? PAIR_SWAP_ABI : V3_POOL_SWAP_ABI;
    const contract = new ethers.Contract(pairOrPool, abi, provider);
    return findFirstEventBlock(contract, contract.filters.Swap(), fromBlock);
}

/** Read the token symbol via archive state at the creation block (best-effort). */
async function readSymbol(
    provider: ethers.JsonRpcProvider,
    token: string,
    atBlock: number,
): Promise<string | null> {
    try {
        const erc20 = new ethers.Contract(token, ERC20_ABI, provider);
        const sym = await erc20.symbol({ blockTag: atBlock });
        return typeof sym === 'string' ? sym : null;
    } catch {
        return null;
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv);
    const rpcUrl = resolveArchiveRpcUrl();
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const net = await provider.getNetwork();
    if (Number(net.chainId) !== 1) {
        log.fatal({ chainId: net.chainId.toString() }, 'Archive RPC is not ETH mainnet (chainId 1) — capture-launch records ETH launches only.');
        process.exit(1);
    }

    log.info({ token: args.tokenAddress, dex: args.dex, block: args.block, fee: args.fee }, 'Resolving launch creation event');
    const creation = await findCreationEvent(provider, args);
    const launchBlock = creation.block;

    // CRITICAL invariant: forkBlockNumber = launchBlock - 1 so the fork replays
    // the launch txn as the next block (rugs/README.md:81 precedent).
    const forkBlockNumber = launchBlock - 1;

    const mintBlock = await findFirstMintBlock(provider, args.dex, creation.pairOrPool, launchBlock);
    const firstSwapBlock = await findFirstSwapBlock(
        provider,
        args.dex,
        creation.pairOrPool,
        mintBlock ?? launchBlock,
    );

    const onChainSymbol = args.symbol ?? (await readSymbol(provider, args.tokenAddress, launchBlock));

    // Verify the WETH side (sanity: the launch should be paired against WETH).
    const isWethPaired = creation.otherToken.toLowerCase() === ETH.WETH.toLowerCase();
    if (!isWethPaired) {
        log.warn(
            { token: args.tokenAddress, pairedWith: creation.otherToken },
            'Launch is NOT paired against WETH — the bot targets WETH pairs; this fixture may not drive the handler as expected.',
        );
    }

    const symbolSlugPart = (onChainSymbol || args.tokenAddress.slice(2, 8)).toLowerCase().replace(/[^a-z0-9]/g, '');
    const slug = args.slug ?? `eth-${args.dex}-${symbolSlugPart}`;

    const fixture: Record<string, unknown> = {
        slug,
        chain: 'eth',
        dexType: args.dex,
        tokenAddress: args.tokenAddress,
        tokenSymbol: onChainSymbol,
        // V2 uses pairAddress + routerAddress; V3 uses poolAddress +
        // swapRouterAddress + quoterAddress + feeTier. Both shapes are emitted
        // with the inapplicable side set to null so the schema is uniform.
        pairAddress: args.dex === 'v2' ? ethers.getAddress(creation.pairOrPool) : null,
        poolAddress: args.dex === 'v3' ? ethers.getAddress(creation.pairOrPool) : null,
        routerAddress: args.dex === 'v2' ? ETH.UNISWAP_V2_ROUTER : null,
        swapRouterAddress: args.dex === 'v3' ? ETH.UNISWAP_V3_SWAP_ROUTER : null,
        quoterAddress: args.dex === 'v3' ? ETH.UNISWAP_V3_QUOTER : null,
        feeTier: args.dex === 'v3' ? (args.fee ?? creation.fee) : null,
        pairCreatedBlock: launchBlock,
        mintBlock,
        firstSwapBlock,
        forkBlockNumber,
        expectedVerdict: 'safe',
        expectedExitPath: args.exitPath,
        discoveredVia: 'etherscan',
        discoveredOn: new Date().toISOString().slice(0, 10),
        notes:
            `Captured via scripts/capture-launch.ts on ${new Date().toISOString()}. ` +
            `forkBlockNumber = pairCreatedBlock - 1 so the fork replays the launch as the next block. ` +
            (isWethPaired ? 'Paired against WETH. ' : 'NOT WETH-paired — review before use. ') +
            `Read-only archive capture; no transaction was sent.`,
    };

    const outDir = path.resolve(__dirname, '../test/fork/fixtures/realLaunches');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n', 'utf-8');

    log.info(
        {
            slug,
            outPath,
            dexType: args.dex,
            tokenAddress: args.tokenAddress,
            tokenSymbol: onChainSymbol,
            pairCreatedBlock: launchBlock,
            mintBlock,
            firstSwapBlock,
            forkBlockNumber,
            feeTier: fixture.feeTier,
        },
        'Wrote realLaunches fixture',
    );

    process.exit(0);
}

main().catch((err) => {
    log.fatal({ err: err instanceof Error ? err.message : String(err) }, 'capture-launch crashed');
    process.exit(2);
});
