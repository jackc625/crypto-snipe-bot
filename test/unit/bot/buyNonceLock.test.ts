// test/unit/bot/buyNonceLock.test.ts
// Phase 21.2 Plan 21.2-13 / Task 1 — WR-01 regression: the BUY path (V2 + V3
// swap submits) and the pre-buy approval helper bypass withNonceLock entirely,
// contradicting D-NONCE-AUTHORITY-ALL ("every signing submit — buys, sells,
// anti-rug, public fallback, approvals, partial sells — must route through
// withNonceLock"). A buy and a concurrent same-wallet sell/anti-rug can both
// fetch getTransactionCount('latest') before either lands and sign against the
// SAME nonce (the cross-submit nonce-collision window the lock exists to close).
//
// THE CARDINAL LESSON (21.2-REVIEW.md): the fix MUST exercise the REAL path. So
// this test uses the GENUINE nonceAuthority.withNonceLock (NOT mocked to a
// non-serializing pass-through) and asserts an OBSERVABLE serialization effect:
// a buy submit and a same-wallet sell submit, started concurrently, never
// interleave their submit bodies — the second's body starts only after the
// first's body fully settles. Against the PRE-FIX code (the buy submit calls
// sendTxWithRetry directly, OUTSIDE any lock) the buy body interleaves with the
// sell body → the interleave assertion FAILS (the RED proof).
//
// We exercise the buy submit via the small exported seam `submitBuyTx` (the
// nonce-locked wrapper both V2 and V3 buy sites now call) so the test does not
// have to drive the entire handleNewPairForChain event handler — but it drives
// the REAL withNonceLock + the REAL sendTxWithRetry boundary (mocked only at the
// strategy edge, not at the lock).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// -----------------------------------------------------------------------------
// Mocks — ONLY the strategy/IO edge of sendTxWithRetry and the heavy bot.ts
// import-graph leaves. nonceAuthority is NOT mocked (the REAL mutex is the
// mechanism under test). We do not mock withNonceLock anywhere.
// -----------------------------------------------------------------------------

// sendTxWithRetry: a controllable async whose body we can observe entering/exiting
// so we can prove serialization. It reads the test-controlled `buySubmitImpl`.
let buySubmitImpl: () => Promise<string> = async () => '0xbuyhash';
const sendTxWithRetryMock = vi.fn(() => buySubmitImpl());
vi.mock('../../../src/utils/txManager', () => ({
    sendTxWithRetry: sendTxWithRetryMock,
    createMevStrategy: vi.fn(),
}));

// Logger is module-level in bot.ts.
vi.mock('../../../src/utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() }), info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

// Silence the side-effecty leaves of the bot import graph that are irrelevant here.
vi.mock('../../../src/utils/notifier', () => ({ sendCtxAlert: vi.fn(), sendTelegramAlert: vi.fn() }));
vi.mock('../../../src/api/ws/broadcaster', () => ({ broadcast: vi.fn() }));

let mod: typeof import('../../../src/bot');
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
    mod = await import('../../../src/bot');
    nonceMod = await import('../../../src/utils/nonceAuthority');
    nonceMod._resetNonceChainsForTesting();
    sendTxWithRetryMock.mockClear();
    buySubmitImpl = async () => '0xbuyhash';
});

describe('Phase 21.2 / WR-01 — the buy submit routes through the REAL withNonceLock (observable serialization)', () => {
    it('exposes submitBuyTx (the nonce-locked buy-submit seam)', () => {
        expect(typeof mod.submitBuyTx).toBe('function');
    });

    it('a buy submit and a same-wallet sell submit do NOT interleave their bodies (serialized by the per-wallet lock)', async () => {
        const order: string[] = [];

        // A deferred so the BUY body holds the lock until we release it — long
        // enough that a NON-serialized sell would slip its body in between.
        let releaseBuy: (() => void) | undefined;
        const buyHeld = new Promise<void>((res) => { releaseBuy = res; });
        buySubmitImpl = async () => {
            order.push('buy:start');
            await buyHeld;       // hold the lock
            order.push('buy:end');
            return '0xbuyhash';
        };

        const ctx = buildCtx() as unknown as Parameters<typeof mod.submitBuyTx>[0];
        const txBuilder = async () => ({ to: '0xrouter', data: '0xdead', value: 1n });

        // Start the buy (acquires the wallet lock, enters its body, then awaits).
        const buyP = mod.submitBuyTx(ctx, txBuilder);
        // Yield so the buy body has actually started before the sell is queued.
        await Promise.resolve();
        await Promise.resolve();

        // A concurrent SAME-WALLET sell submit through the REAL withNonceLock. Its
        // body must NOT run until the buy body has finished (serialized).
        const sellP = nonceMod.withNonceLock(WALLET, async () => {
            order.push('sell:start');
            order.push('sell:end');
            return 'sold';
        });

        // Give the event loop several turns: a NON-serialized sell would push
        // sell:start/sell:end here, BETWEEN buy:start and buy:end (the RED bug).
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Release the buy; both settle.
        releaseBuy!();
        await Promise.all([buyP, sellP]);

        // Serialized order: the whole buy body precedes the whole sell body.
        expect(order).toEqual(['buy:start', 'buy:end', 'sell:start', 'sell:end']);
        // The buy really went through sendTxWithRetry (real submit boundary).
        expect(sendTxWithRetryMock).toHaveBeenCalledTimes(1);
    });

    it('submitBuyTx returns the real hash from sendTxWithRetry', async () => {
        buySubmitImpl = async () => '0xrealbuyhash';
        const ctx = buildCtx() as unknown as Parameters<typeof mod.submitBuyTx>[0];
        const hash = await mod.submitBuyTx(ctx, async () => ({ to: '0xr', data: '0x', value: 0n }));
        expect(hash).toBe('0xrealbuyhash');
    });
});
