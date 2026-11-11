// test/realpath/triage/fixtures/unhandledRejectionCrash.ts
// Phase 23 plan 23-12 Task 2 (AUDIT-02, D-08, AC-48): AUD-BUY-005 as a real process death.
// Started only by test/realpath/triage/AUD-BUY-005.test.ts through spawnRailedChild:
//   node -r ts-node/register/transpile-only <this file> <mode>
//
// The finding: src has no unhandledRejection handler and calls async handlers without await or
// .catch, so one rejection ends the process. The concrete trigger exercised here: the real V3
// WebSocket listener in src/bot.ts startDexListener calls handleNewV3PoolForChain un-awaited, and
// the real waitForLiquidity then checkMinLiquidity run; checkMinLiquidity parses
// <PREFIX>_MIN_LIQUIDITY with parseEther before its try, and chainRegistry.ts carries the env value
// through unvalidated. This file never calls handleNewV3PoolForChain: it only pushes a real-encoded
// PoolCreated log to the listener's own subscription.
//
// What runs: the real startDexListener(ctx, dex, registry) on the registry's first V3 dex over the
// bot's real WebSocketProvider (createChainContext on the loopback WebSocket port). The chain
// pushes PoolCreated(WETH, token, 3000, 60, pool) in block 100, and eth_getLogs answers one
// real-encoded Mint on that pool in the same block, so the real waitForLiquidity passes (its log
// "Mint found in same block as PoolCreated" is the path marker).
//   fault      ETH_MIN_LIQUIDITY=abc on process.env before the chain registry loads (it cannot go
//              through envOverrides: test/.env.test has no such key). checkMinLiquidity's
//              parseEther('abc') throws, the un-awaited handler rejects, the process exits.
//   healthy    ETH_MIN_LIQUIDITY=0.5; the QuoterV2 eth_call reverts (a thin pool), so the real
//              below-minimum branch returns with no buy.
//   contained  fault, with process handlers registered first.
//
// Work under test: the pool listener's dispatch. handleNewV3PoolForChain is called by src and
// cannot be awaited from outside, so the observable result is that the listener is still handing
// pools to the handler after the first pool's handling ended: 3 s after the first push the chain
// pushes a second pool (another token), and WORK_SETTLED once the bot's Mint query for that second
// pool arrives (WORK_PENDING if it has not by the end of the window). Survival window: WINDOW_MS of
// real time after the first push.

import { Interface, getAddress, keccak256, toUtf8Bytes } from 'ethers';
import { abi, addressTopic, finishAlive, installContainment, makeLog, mark, parseMode, runFixture, setupError, sleep, startLoopbackChain, startTicker, until, type LogJson, START_HEAD } from './loopbackChain';

const WINDOW_MS = 8_000;
const SECOND_PUSH_AFTER_MS = 3_000;

// Uniswap V3's own event signatures (written here, not taken from the bot's ABI file).
const V3 = new Interface([
    'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
    'event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
]);
const POOL_CREATED = V3.getEvent('PoolCreated')!.topicHash;
const MINT = V3.getEvent('Mint')!.topicHash;
const NPM = '0xc36442b4a4522e871399cd717abdd847ab11fe88'; // the Uniswap V3 position manager mints for LPs

function addr(label: string): string {
    return getAddress('0x' + keccak256(toUtf8Bytes(label)).slice(26));
}

interface Launch {
    token: string;
    pool: string;
}

async function main(): Promise<void> {
    const mode = parseMode(process.argv[2]);
    if (mode === 'contained') installContainment();

    const block = START_HEAD;
    const launches: Launch[] = [
        { token: addr('aud-buy-005-token-a'), pool: addr('aud-buy-005-pool-a') },
        { token: addr('aud-buy-005-token-b'), pool: addr('aud-buy-005-pool-b') },
    ];
    const mintLogs = new Map<string, LogJson>();
    const mintQueried = new Set<string>();
    let quoterAddress = '';

    const chain = await startLoopbackChain({
        logs: (filter) => {
            const address = String(filter.address ?? '').toLowerCase();
            const topics = (filter.topics ?? []) as unknown[];
            const log = mintLogs.get(address);
            if (!log || String(topics[0]).toLowerCase() !== MINT.toLowerCase()) return [];
            if (Number(BigInt(String(filter.fromBlock))) > block || Number(BigInt(String(filter.toBlock))) < block) return [];
            mintQueried.add(address);
            mark(`MINT_QUERIED ${address === launches[0].pool.toLowerCase() ? 'pool-a' : 'pool-b'}`);
            return [log];
        },
        ethCall: ({ to }) => {
            // QuoterV2 on a pool too thin for the quote: geth's revert with no data.
            if (quoterAddress !== '' && to === quoterAddress) {
                mark('QUOTER_CALLED');
                return { error: { code: -32000, message: 'execution reverted' } };
            }
            return undefined;
        },
    });
    process.env.ETH_RPC_URL = chain.httpUrl;
    process.env.ETH_WS_URL = chain.wsUrl;
    process.env.DB_PATH = ':memory:';
    process.env.ETH_MIN_LIQUIDITY = mode === 'healthy' ? '0.5' : 'abc';

    await import('../../../../src/main');
    const bot = await import('../../../../src/bot');
    const reg = await import('../../../../src/chainRegistry');
    const registry = reg.buildChainRegistry();
    const cfg = registry.get('eth');
    if (!cfg) return setupError('the real registry has no eth chain');
    const dex = cfg.dexes.find(reg.isDexV3);
    if (!dex) return setupError('the real registry has no V3 dex on eth');
    quoterAddress = dex.quoterAddress.toLowerCase();
    const ctx = reg.createChainContext(cfg);
    await until(() => chain.wsConnectedAfter(0), 10_000, 'the bot WebSocket to connect');

    await bot.startDexListener(ctx, dex, registry);
    await until(() => chain.logSubscriptions >= 1, 10_000, "the V3 listener's eth_subscribe");
    mark('ARMED dex-v3');

    const poolCreated = (l: Launch, logIndex: number): LogJson =>
        makeLog(dex.factoryAddress, [POOL_CREATED, addressTopic(cfg.wethAddress), addressTopic(l.token), abi.encode(['uint24'], [3000])], abi.encode(['int24', 'address'], [60, l.pool]), block, logIndex);
    for (const [i, l] of launches.entries()) {
        mintLogs.set(
            l.pool.toLowerCase(),
            makeLog(
                l.pool,
                [MINT, addressTopic(NPM), abi.encode(['int24'], [-887220]), abi.encode(['int24'], [887220])],
                abi.encode(['address', 'uint128', 'uint256', 'uint256'], [NPM, 10n ** 15n, 10n ** 18n, 10n ** 21n]),
                block,
                10 + i,
            ),
        );
    }

    const ticker = startTicker();
    const delivered = chain.pushLog(poolCreated(launches[0], 1));
    if (delivered !== 1) return setupError(`the first PoolCreated reached ${delivered} subscriptions, not 1`);
    mark('POOL_PUSHED pool-a');
    const start = Date.now();
    await sleep(SECOND_PUSH_AFTER_MS);
    const second = chain.pushLog(poolCreated(launches[1], 2));
    if (second !== 1) return setupError(`the second PoolCreated reached ${second} subscriptions, not 1`);
    mark('POOL_PUSHED pool-b');
    await sleep(Math.max(0, WINDOW_MS - (Date.now() - start)));
    await finishAlive(ticker, () => ctx.httpProvider.getBlockNumber(), mintQueried.has(launches[1].pool.toLowerCase()));
}

runFixture(main);
