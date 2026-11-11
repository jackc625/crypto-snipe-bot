// test/realpath/triage/fixtures/bundleWaitCrash.ts
// Phase 23 plan 23-12 Task 2 (AUDIT-02, D-08, AC-48): AUD-TX-009 as a real process death.
// Started only by test/realpath/triage/AUD-TX-009.test.ts through spawnRailedChild:
//   node -r ts-node/register/transpile-only <this file> <mode>
//
// The finding: every ETH private attempt awaits the Flashbots library's bundle.wait(). The library
// registers an async handler on the provider's "block" event and throws "Unable to get block: <n>"
// when getBlock(target) answers null; ethers' emit drops the promise an async listener returns,
// so the rejection is unhandled and Node 22 ends the process (src has no unhandledRejection
// handler, the policy entry AUD-BUY-005).
//
// What runs: the real FlashbotsMevStrategy (src/utils/mevStrategies/flashbots.ts) with relayUrl
// on the loopback HTTP port and the inert FLASHBOTS_AUTH_KEY sentinel; this file calls its real
// sendTransaction with a plain transfer, ctx.wallet, ctx.httpProvider (the bot's own provider,
// from the real createChainContext), maxRetries 1 and a BroadcastHandle. The strategy simulates
// through the relay (eth_callBundle), sends the library bundle (eth_sendBundle), sends its raw
// `builders` fanout (eth_sendBundle with a non-empty builders array, which only rawSendBundle in
// src sends: RELAY_BUILDERS_SEEN is the path marker) and reaches its own bundle.wait(). This file
// never calls the library itself.
//
// The chain (AC-48: answers a real node gives). The bundle targets block 101. Blocks come by the
// chain's own clock, not by the bot's requests: block 101 is mined MINE_AFTER_MS after the first
// eth_sendBundle with the signed transaction in it (the bundle landed), and block 102 one ETH slot
// (12 s) later. The wait's block poller (4 s) sees the new head and asks for block 101:
//   fault      the first eth_getBlockByNumber(101) answers null, as a load-balanced node whose
//              backend has not yet seen the block returns (the finding's recommendation); later
//              requests get the real block.
//   healthy    eth_getBlockByNumber(101) answers the block from the start, so the wait resolves
//              "included" and sendTransaction returns.
//   contained  fault, with process handlers registered first.
// The order is deterministic: the wait subscribes within milliseconds of the first send, so its
// first poll records 100 (fresh, or from ethers' 250 ms request cache, which can only be older) and
// a later poll sees 101. Should that first poll ever come after the 2 s mark, it records 101 and
// block 102's event runs the same handler, which asks for block 101 and meets the same first null.
//
// Work under test: sendTransaction. WORK_SETTLED once it has returned or rejected; WORK_PENDING
// if not by the end of the window. Survival window: WINDOW_MS of real time from the first
// eth_sendBundle, ended early once sendTransaction settles. 40 s covers block 102 (the next block,
// on which the library's handler, still registered after its throw, runs again) seen by a 4 s
// poll, with margin.

import { parseEther, type TransactionRequest } from 'ethers';
import { installContainment, finishAlive, mark, parseMode, runFixture, setupError, sleep, startLoopbackChain, startTicker, until, START_HEAD } from './loopbackChain';

const TARGET = START_HEAD + 1;
const MINE_AFTER_MS = 2_000;
const SLOT_MS = 12_000;
const WINDOW_MS = 40_000;

function firstLine(e: unknown): string {
    return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).split('\n')[0].slice(0, 300);
}

async function main(): Promise<void> {
    const mode = parseMode(process.argv[2]);
    if (mode === 'contained') installContainment();

    const firstSend: { at: number | null } = { at: null };
    let signed: string[] = [];
    let builtTarget = false;
    let nullServed = false;
    let buildersSeen = false;

    const chain = await startLoopbackChain({
        onRequest: (r) => {
            if (r.method !== 'eth_sendBundle' || buildersSeen) return;
            const builders = (r.params[0] as { builders?: unknown } | undefined)?.builders;
            if (Array.isArray(builders) && builders.length > 0) {
                buildersSeen = true;
                mark('RELAY_BUILDERS_SEEN');
            }
        },
        onFirstSendBundle: (p) => {
            firstSend.at = Date.now();
            signed = (p.txs ?? []) as string[];
            mark('FIRST_SEND_BUNDLE');
            // The chain's own clock: block 101 with the bundle's transaction, then block 102.
            setTimeout(() => {
                builtTarget = true;
                chain.include(TARGET, signed);
                chain.setHead(TARGET);
                mark(`MINED ${TARGET}`);
                setTimeout(() => {
                    chain.setHead(TARGET + 1);
                    mark(`MINED ${TARGET + 1}`);
                }, SLOT_MS);
            }, MINE_AFTER_MS);
        },
        blockAnswer: (n) => {
            if (n === TARGET && mode !== 'healthy' && !nullServed && builtTarget) {
                nullServed = true;
                mark(`BLOCK_${TARGET}_NULL_SERVED`);
                return null;
            }
            return 'default';
        },
    });
    process.env.ETH_RPC_URL = chain.httpUrl;
    process.env.ETH_WS_URL = '';
    process.env.DB_PATH = ':memory:';

    await import('../../../../src/main');
    await import('../../../../src/bot');
    const reg = await import('../../../../src/chainRegistry');
    const cfg = reg.buildChainRegistry().get('eth');
    if (!cfg) return setupError('the real registry has no eth chain');
    const ctx = reg.createChainContext(cfg);
    const { FlashbotsMevStrategy } = await import('../../../../src/utils/mevStrategies/flashbots');
    const authKey = process.env.FLASHBOTS_AUTH_KEY;
    if (!authKey) return setupError('the FLASHBOTS_AUTH_KEY sentinel is missing');
    const strategy = new FlashbotsMevStrategy({ relayUrl: chain.httpUrl, network: 'mainnet', authKey });

    const handle: { signedTxHash?: string; submittedNonce?: number } = {};
    const tx: TransactionRequest = { to: '0x000000000000000000000000000000000000dEaD', value: parseEther('0.01'), gasLimit: 21_000n };
    const ticker = startTicker();
    let settled = false;
    strategy.sendTransaction(tx, ctx.wallet, ctx.httpProvider, 1, undefined, handle).then(
        (hash) => {
            settled = true;
            mark(`SEND_RESOLVED ${hash === handle.signedTxHash ? 'broadcast-hash' : 'other-hash'}`);
        },
        (e: unknown) => {
            settled = true;
            mark(`SEND_REJECTED ${firstLine(e)}`);
        },
    );

    await until(() => firstSend.at !== null, 30_000, 'the first eth_sendBundle');
    const windowEnd = (firstSend.at ?? Date.now()) + WINDOW_MS;
    while (!settled && Date.now() < windowEnd) await sleep(50);
    await finishAlive(ticker, () => ctx.httpProvider.getBlockNumber(), settled);
}

runFixture(main);
