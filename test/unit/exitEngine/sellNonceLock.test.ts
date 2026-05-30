// test/unit/exitEngine/sellNonceLock.test.ts
// v6.17 MILESTONE AUDIT — INT-NONCE-SELL regression.
//
// executeFullSell's private-escalation sell submission (the inclusion-ladder
// step 1) called escalatePrivateSell DIRECTLY, OUTSIDE withNonceLock — the ONE
// signing site executeFullSell left unlocked after the CR-01 worker fix
// (21.2-12) removed the worker's OUTER lock on the explicit premise that "every
// signing site inside executeFullSell is individually wrapped" (exitEngine.ts
// worker comment near line 1158). Its BUY mirror IS wrapped: bot.ts:558 wraps
// escalatePrivateBuy in withNonceLock(ctx.wallet.address, ...). A concurrent
// same-wallet buy (locked) and this sell (unlocked) could each fetch
// getTransactionCount('latest') before either lands and sign two txs against ONE
// nonce — the cross-submit collision the per-wallet lock exists to close
// (D-NONCE-AUTHORITY-ALL). The fix introduces the submitPrivateSell seam (the
// exact mirror of bot.ts submitBuyTx) and routes the call site through it.
//
// THE CARDINAL LESSON (21.2-REVIEW.md): exercise the REAL serialization
// mechanism. This test uses the GENUINE nonceAuthority.withNonceLock (NOT mocked
// to a non-serializing passthrough) and the REAL submitPrivateSell seam, and
// asserts an OBSERVABLE serialization effect: the private-sell submit body and a
// concurrent same-wallet op never interleave — the second's body starts only
// after the first's body fully settles. Against the PRE-FIX code (the call site
// awaited escalatePrivateSell directly, unlocked) the sell body interleaves with
// the concurrent buy body → the order assertion FAILS (the RED proof; verified by
// temporarily unwrapping the seam during development).
//
// escalatePrivateSell is mocked — the WRAPPED PAYLOAD, exactly as buyNonceLock
// mocks sendTxWithRetry (the payload submitBuyTx wraps). The WRAP under test
// (withNonceLock inside submitPrivateSell) is the REAL mechanism; we do not mock
// withNonceLock anywhere.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// -----------------------------------------------------------------------------
// Import-graph mocks — ONLY exitEngine's side-effecty leaves (SQLite db, logger,
// config, notifier, receiptDecoder, anti-rug detector). nonceAuthority is NOT
// mocked: the REAL per-wallet promise-chain mutex is the mechanism under test.
// -----------------------------------------------------------------------------
vi.mock('../../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: vi.fn() },
    updateTradeStatus: { run: vi.fn() },
    upsertExitState: { run: vi.fn() },
    getExitState: { get: vi.fn() },
    deleteExitState: { run: vi.fn() },
    markExitFailedHeld: { run: vi.fn() },
}));
vi.mock('../../../src/utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));
vi.mock('../../../src/config', () => ({ CONFIG: { slippagePercent: 5 } }));
vi.mock('../../../src/utils/notifier', () => ({ sendCtxAlert: vi.fn() }));
vi.mock('../../../src/utils/receiptDecoder', () => ({ decodeReceipt: vi.fn() }));
vi.mock('../../../src/anti-rug/detector', () => ({ unregisterAntiRugPosition: vi.fn() }));

// txManager: mock the WRAPPED PAYLOAD (escalatePrivateSell) so its body can be
// observed entering/holding the lock. sendTxWithRetry is mocked too (imported by
// exitEngine but unused on this path).
let sellSubmitImpl: () => Promise<{ landed: boolean; txHash?: string }> =
    async () => ({ landed: true, txHash: '0xsellhash' });
const escalatePrivateSellMock = vi.fn(() => sellSubmitImpl());
const sendTxWithRetryMock = vi.fn();
vi.mock('../../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
    escalatePrivateSell: escalatePrivateSellMock,
}));

let mod: typeof import('../../../src/exitEngine');
let nonceMod: typeof import('../../../src/utils/nonceAuthority');

const WALLET = '0x1111111111111111111111111111111111111111';

function buildCtx() {
    return {
        chain: { name: 'eth', displayName: '[ETH]' },
        wallet: { address: WALLET },
        httpProvider: {},
        log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    };
}

beforeEach(async () => {
    vi.resetModules();
    mod = await import('../../../src/exitEngine');
    nonceMod = await import('../../../src/utils/nonceAuthority');
    nonceMod._resetNonceChainsForTesting();
    escalatePrivateSellMock.mockClear();
    sellSubmitImpl = async () => ({ landed: true, txHash: '0xsellhash' });
});

describe('v6.17 INT-NONCE-SELL — the private sell submit routes through the REAL withNonceLock (observable serialization)', () => {
    it('exposes submitPrivateSell (the nonce-locked sell-submit seam)', () => {
        expect(typeof mod.submitPrivateSell).toBe('function');
    });

    it('a private sell submit and a same-wallet buy submit do NOT interleave their bodies (serialized by the per-wallet lock)', async () => {
        const order: string[] = [];

        // A deferred so the SELL body holds the lock until we release it — long
        // enough that a NON-serialized buy would slip its body in between.
        let releaseSell: (() => void) | undefined;
        const sellHeld = new Promise<void>((res) => { releaseSell = res; });
        sellSubmitImpl = async () => {
            order.push('sell:start');
            await sellHeld;          // hold the lock
            order.push('sell:end');
            return { landed: true, txHash: '0xsellhash' };
        };

        const ctx = buildCtx() as unknown as Parameters<typeof mod.submitPrivateSell>[0];
        const txBuilder = async () => ({ to: '0xrouter', data: '0xdead', value: 0n });

        // Start the private sell (acquires the wallet lock, enters its body, awaits).
        const sellP = mod.submitPrivateSell(ctx, txBuilder, 1);
        // Yield so the sell body has actually started before the buy is queued.
        await Promise.resolve();
        await Promise.resolve();

        // A concurrent SAME-WALLET buy submit through the REAL withNonceLock. Its
        // body must NOT run until the sell body has finished (serialized).
        const buyP = nonceMod.withNonceLock(WALLET, async () => {
            order.push('buy:start');
            order.push('buy:end');
            return 'bought';
        });

        // Give the event loop several turns: a NON-serialized buy would push
        // buy:start/buy:end here, BETWEEN sell:start and sell:end (the RED bug).
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Release the sell; both settle.
        releaseSell!();
        await Promise.all([sellP, buyP]);

        // Serialized order: the whole sell body precedes the whole buy body.
        expect(order).toEqual(['sell:start', 'sell:end', 'buy:start', 'buy:end']);
        // The sell really went through escalatePrivateSell (the wrapped submit).
        expect(escalatePrivateSellMock).toHaveBeenCalledTimes(1);
    });

    it('submitPrivateSell returns the real result from escalatePrivateSell', async () => {
        sellSubmitImpl = async () => ({ landed: true, txHash: '0xrealsell' });
        const ctx = buildCtx() as unknown as Parameters<typeof mod.submitPrivateSell>[0];
        const res = await mod.submitPrivateSell(ctx, async () => ({ to: '0xr', data: '0x', value: 0n }), 1);
        expect(res).toEqual({ landed: true, txHash: '0xrealsell' });
    });
});
