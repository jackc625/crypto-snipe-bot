// test/unit/bot/watchdog.test.ts
// Phase 21.2 Plan 21.2-09 / Task 2 — Finding B layer 1 (STOP-THE-LINE-04-B,
// D-WATCHDOG-ABORT + threats T-21.2-HANGSUBMIT / T-21.2-ABORT-NOOP, Pitfall 6).
//
// Even with the serial worker (21.2-05) moving the long `bundle.wait()` OFF the
// poll tick, ONE submit can still hang for minutes (the verified 5-min
// block-event-driven Flashbots wait). ethers v6 has NO reliable per-call abort
// (#4122), so the watchdog CANNOT rely on an AbortSignal to free the loop — the
// lever that works is `Promise.race([op, rejectAfter(budget)])`, which frees the
// AWAITING code path (the drain loop) deterministically. On overrun the watchdog
// alerts (D-ALERTS) and KEEPS the bot alive: the drain loop moves to the next
// queued exit; the stuck position stays held + monitored (21.2-07).
//
// These are OBSERVABLE-EFFECT tests (no hollow assertions):
//
//   Test 1 (abort on overrun): a submit that NEVER resolves, wrapped by the
//     watchdog with WATCHDOG_BUDGET_MS, → after the budget the awaiting path is
//     freed (the wrapper resolves to `false` via Promise.race, NOT a hang).
//   Test 2 (bot stays alive): with the watchdog wired into the REAL ExitWorker,
//     two exits are enqueued; the first submit hangs and is watchdog-aborted —
//     the drain loop then processes the SECOND enqueued exit (the bot is not torn
//     down). Proven by the second executor invocation running after the abort.
//   Test 3 (no abort under budget): a submit that resolves BEFORE the budget is
//     NOT aborted — its true/false result passes straight through.
//   Test 4 (alert fired): a budget overrun emits a dotted `op:'watchdog.abort'`
//     pino log + a sendCtxAlert (D-ALERTS) carrying a remediation pointer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Spy on the per-chain Telegram alert (imported by bot.ts from notifier).
// `vi.hoisted` makes the spy available inside the hoisted vi.mock factory.
const { sendCtxAlertMock } = vi.hoisted(() => ({
    sendCtxAlertMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/utils/notifier', async () => {
    const actual = await vi.importActual<typeof import('../../../src/utils/notifier')>(
        '../../../src/utils/notifier',
    );
    return { ...actual, sendCtxAlert: sendCtxAlertMock, sendTelegramAlert: vi.fn() };
});

// Import the watchdog factory from its dedicated helper module (kept out of the
// heavy bot.ts import graph by design, D-QUALITY-FIRST). bot.ts re-exports it and
// owns the WATCHDOG_BUDGET_MS knob + install call; this test validates the
// primitive directly.
import { makeExitWatchdog } from '../../../src/utils/exitWatchdog';
import type { ExitWorkItem } from '../../../src/exitEngine';

function buildItem(overrides: Partial<ExitWorkItem> = {}): ExitWorkItem {
    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    return {
        ctx: {
            chain: { name: 'eth', displayName: '[ETH]' },
            wallet: { address: '0x1111111111111111111111111111111111111111' },
            log,
        },
        dex: {},
        tokenAddress: '0xAAA0000000000000000000000000000000000001',
        feeTier: null,
        tradeId: 1,
        reason: 'stop-loss',
        reasonDetail: 'stop-loss detail',
        ...overrides,
    } as unknown as ExitWorkItem;
}

beforeEach(() => {
    sendCtxAlertMock.mockClear();
});

describe('Watchdog — aborts a budget-overrunning submit (Test 1)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('frees the awaiting path (resolves false) after WATCHDOG_BUDGET_MS via Promise.race', async () => {
        const watchdog = makeExitWatchdog({ budgetMs: 60000 });
        const item = buildItem();

        // A submit that NEVER resolves — only the budget can settle the race.
        const wrapped = watchdog(item, () => new Promise<boolean>(() => {}));

        // Advance past the budget; the wrapper must resolve (not hang) to false.
        await vi.advanceTimersByTimeAsync(60000);
        const result = await wrapped;
        expect(result).toBe(false);
    });
});

describe('Watchdog — no abort under budget (Test 3)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('passes a submit value straight through when it settles before the budget', async () => {
        const watchdog = makeExitWatchdog({ budgetMs: 60000 });
        const item = buildItem();

        // Resolves well under budget → value passes through, no abort/alert.
        const wrapped = watchdog(item, async () => true);
        await vi.advanceTimersByTimeAsync(100);
        const result = await wrapped;
        expect(result).toBe(true);
        expect(sendCtxAlertMock).not.toHaveBeenCalled();

        // Advancing past the budget must NOT retroactively abort a settled submit.
        await vi.advanceTimersByTimeAsync(60000);
        expect(sendCtxAlertMock).not.toHaveBeenCalled();
    });

    it('leaks no timer after a fast submit (finally clearTimeout)', async () => {
        const watchdog = makeExitWatchdog({ budgetMs: 60000 });
        const item = buildItem();
        const wrapped = watchdog(item, async () => false);
        await vi.advanceTimersByTimeAsync(1);
        await wrapped;
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('Watchdog — alert + dotted op on overrun (Test 4)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('emits op:watchdog.abort pino log + sendCtxAlert with a remediation pointer', async () => {
        const watchdog = makeExitWatchdog({ budgetMs: 60000 });
        const item = buildItem({ reason: 'anti-rug' });

        const wrapped = watchdog(item, () => new Promise<boolean>(() => {}));
        await vi.advanceTimersByTimeAsync(60000);
        await wrapped;

        // Dotted-op pino log.
        const errorLog = (item.ctx.log.error as ReturnType<typeof vi.fn>);
        expect(errorLog).toHaveBeenCalled();
        const logArg = errorLog.mock.calls[0][0] as Record<string, unknown>;
        expect(logArg.op).toBe('watchdog.abort');
        expect(logArg.token).toBe(item.tokenAddress);
        expect(logArg.budgetMs).toBe(60000);

        // Telegram alert with a remediation pointer.
        expect(sendCtxAlertMock).toHaveBeenCalledTimes(1);
        const [, alertMsg] = sendCtxAlertMock.mock.calls[0] as [unknown, string];
        expect(alertMsg).toContain('Watchdog abort');
        expect(alertMsg.toLowerCase()).toContain('still held');
        // A remediation pointer (what the operator should check / do).
        expect(alertMsg.toLowerCase()).toMatch(/rpc|relay|manual/);
    });
});

// -----------------------------------------------------------------------------
// Test 2 (bot stays alive) drives the REAL ExitWorker with the watchdog wired in.
// The worker only needs config + logger + per-position lock + nonce authority;
// the controllable executor seam replaces executeFullSell wholesale, so its deep
// deps are mocked exactly like exitWorker.test.ts.
// -----------------------------------------------------------------------------

// db is loaded transitively by exitEngine.ts (Test 2 drives the real worker).
vi.mock('../../../src/utils/db', () => ({
    db: {},
    insertTrade: { run: vi.fn() },
    updateTradeStatus: { run: vi.fn() },
    upsertExitState: { run: vi.fn() },
    getExitState: { get: vi.fn() },
    deleteExitState: { run: vi.fn() },
    getTradeIdForPendingToken: { get: vi.fn() },
    markExitFailedHeld: { run: vi.fn() },
}));
vi.mock('../../../src/utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));
vi.mock('../../../src/config', () => ({
    CONFIG: {
        trailingStopPct: 15,
        trailingMinPct: 5,
        trailingMaxPct: 40,
        stopLossPercent: 25,
        partialSellTargets: '',
        exitPollIntervalMs: 5000,
        urgencyWindowMs: 30 * 60 * 1000,
        volatilityBaselineCV: 0.03,
        volatilityMaxSamples: 60,
        volatilityMinSamples: 12,
    },
}));
vi.mock('../../../src/utils/txManager', () => ({
    sendTxWithRetry: vi.fn().mockResolvedValue('0xtxhash'),
    escalatePrivateSell: vi.fn(),
}));
vi.mock('../../../src/utils/receiptDecoder', () => ({
    decodeReceipt: vi.fn().mockResolvedValue({ amountOut: '1', gasCost: '1', blockNumber: 1 }),
}));
vi.mock('../../../src/anti-rug/detector', () => ({ unregisterAntiRugPosition: vi.fn() }));

const WALLET2 = '0x2222222222222222222222222222222222222222';

describe('Watchdog — bot stays alive after an abort (Test 2)', () => {
    let exitMod: typeof import('../../../src/exitEngine');
    let nonceMod: typeof import('../../../src/utils/nonceAuthority');
    let exitMgr: typeof import('../../../src/utils/exitManager');

    beforeEach(async () => {
        vi.resetModules();
        exitMod = await import('../../../src/exitEngine');
        nonceMod = await import('../../../src/utils/nonceAuthority');
        exitMgr = await import('../../../src/utils/exitManager');
        nonceMod._resetNonceChainsForTesting();
        (exitMgr as unknown as { _resetSellLocksForTesting?: () => void })._resetSellLocksForTesting?.();
    });

    afterEach(() => {
        exitMod._resetExitWorkerForTesting?.();
    });

    function itemFor(token: string, tradeId: number): ExitWorkItem {
        const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
        return {
            ctx: { chain: { name: 'eth', displayName: '[ETH]' }, wallet: { address: WALLET2 }, log },
            dex: { dexType: 'v2', name: 'uniswap-v2', routerAddress: WALLET2 },
            tokenAddress: token,
            feeTier: null,
            tradeId,
            reason: 'stop-loss',
            reasonDetail: 'stop-loss detail',
        } as unknown as ExitWorkItem;
    }

    it('processes the next queued exit after the first submit is watchdog-aborted', async () => {
        // Install a SHORT-budget watchdog (real timers; tiny budget so the abort
        // fires promptly without parking the test) into the real worker.
        const watchdog = makeExitWatchdog({ budgetMs: 20 });
        exitMod._setExitWatchdogForTesting(watchdog);

        const started: string[] = [];
        let firstResolve: ((v: boolean) => void) | undefined;
        // Executor: the FIRST token hangs (never resolves) → watchdog aborts it;
        // the SECOND resolves immediately.
        exitMod._setSellExecutorForTesting((i: ExitWorkItem) => {
            started.push(i.tokenAddress);
            if (i.tokenAddress === '0xAAA') {
                return new Promise<boolean>((res) => { firstResolve = res; });
            }
            return Promise.resolve(true);
        });

        exitMod.enqueueExit(itemFor('0xAAA', 1));
        exitMod.enqueueExit(itemFor('0xBBB', 2));

        // Wait long enough for the 20ms watchdog budget to fire on the first
        // submit and the drain loop to advance to the second.
        await new Promise((r) => setTimeout(r, 80));

        // The bot stayed alive: BOTH submits started (the second only after the
        // first was watchdog-aborted, since the worker is serial).
        expect(started).toContain('0xAAA');
        expect(started).toContain('0xBBB');
        expect(started.indexOf('0xBBB')).toBeGreaterThan(started.indexOf('0xAAA'));

        // Settle the (still-running) first submit so no dangling promise remains.
        firstResolve?.(false);
        await new Promise((r) => setTimeout(r, 10));
    });
});
