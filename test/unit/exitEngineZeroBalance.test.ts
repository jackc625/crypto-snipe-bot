// test/unit/exitEngineZeroBalance.test.ts
// Unit test for FIX-08 (task 01-03-03): when a token's wallet balance is zero,
// executeFullSell must:
//   - return true (position is "done")
//   - call updateTradeStatus.run('sold', ...)
//   - call clearAllTimersForToken(chain, token)
//   - call deleteExitState.run(tradeId)
//   - NOT call sendTxWithRetry (no on-chain sell needed)
//   - NOT call insertTrade.run (no trade row to record)
//
// Uses vi.resetModules() + vi.doMock() per test to control the ethers Contract
// balanceOf return value independently.

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('executeFullSell — zero balance stops monitoring (FIX-08)', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    async function buildMocks(balanceOf: () => Promise<bigint>) {
        const insertTradeRun = vi.fn();
        const updateTradeStatusRun = vi.fn();
        const deleteExitStateRun = vi.fn();
        const clearAllTimersForTokenMock = vi.fn();
        const sendTxWithRetryMock = vi.fn();
        // Phase 21.2-06: executeFullSell's private leg now uses escalatePrivateSell.
        // These tests exercise the ZERO-balance early return (before the ladder), so
        // the symbol need only exist; default it to a landed result for safety.
        const escalatePrivateSellMock = vi.fn().mockResolvedValue({ landed: true, txHash: '0xhash' });

        vi.doMock('../../src/utils/db', () => ({
            db: {},
            insertTrade: { run: insertTradeRun },
            updateTradeStatus: { run: updateTradeStatusRun },
            upsertExitState: { run: vi.fn() },
            getExitState: { get: vi.fn() },
            deleteExitState: { run: deleteExitStateRun },
            getTradeIdForPendingToken: { get: vi.fn() },
        }));

        vi.doMock('../../src/utils/logger', () => ({
            logger: {
                child: () => ({
                    info: vi.fn(),
                    warn: vi.fn(),
                    debug: vi.fn(),
                    error: vi.fn(),
                    fatal: vi.fn(),
                }),
            },
        }));

        vi.doMock('../../src/config', () => ({
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

        vi.doMock('../../src/utils/exitManager', () => ({
            tryAcquireSellLock: vi.fn().mockReturnValue(true),
            releaseSellLock: vi.fn(),
            registerExitMonitor: vi.fn(),
            clearAllTimersForToken: clearAllTimersForTokenMock,
        }));

        vi.doMock('../../src/utils/notifier', () => ({
            sendCtxAlert: vi.fn().mockResolvedValue(undefined),
        }));

        vi.doMock('../../src/utils/txManager', () => ({
            sendTxWithRetry: sendTxWithRetryMock,
            escalatePrivateSell: escalatePrivateSellMock,
        }));

        vi.doMock('../../src/utils/receiptDecoder', () => ({
            decodeReceipt: vi.fn(),
        }));

        vi.doMock('ethers', async () => {
            const actual = await vi.importActual<typeof import('ethers')>('ethers');
            class MockContract {
                balanceOf = balanceOf;
                async allowance() { return 1n << 200n; }
                async approve() { return { wait: async () => ({}) }; }
            }
            return { ...actual, Contract: MockContract };
        });

        const { executeFullSell } = await import('../../src/exitEngine');

        return {
            executeFullSell,
            insertTradeRun,
            updateTradeStatusRun,
            deleteExitStateRun,
            clearAllTimersForTokenMock,
            sendTxWithRetryMock,
        };
    }

    const mockCtx = {
        chain: {
            name: 'eth',
            wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            gas: { maxGasLimit: 300_000n },
            mevStrategy: 'flashbots',
        },
        httpProvider: {} as any,
        wallet: { address: '0x1234567890abcdef1234567890abcdef12345678' } as any,
        log: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        },
    } as any;

    const mockDex = {
        name: 'uni-v2',
        dexType: 'v2' as const,
        routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    } as any;

    const TOKEN = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const TRADE_ID = 7;

    it('returns true when balance is zero (position already gone)', async () => {
        const { executeFullSell } = await buildMocks(async () => 0n);

        const result = await executeFullSell(
            mockCtx, mockDex, TOKEN, null, 'trailing-stop', TRADE_ID, 'zero balance test',
        );

        expect(result).toBe(true);
    });

    it('marks status as sold when balance is zero', async () => {
        const { executeFullSell, updateTradeStatusRun } = await buildMocks(async () => 0n);

        await executeFullSell(
            mockCtx, mockDex, TOKEN, null, 'stop-loss', TRADE_ID, 'zero balance test',
        );

        expect(updateTradeStatusRun).toHaveBeenCalledOnce();
        expect(updateTradeStatusRun).toHaveBeenCalledWith(
            'sold',
            TOKEN.toLowerCase(),
            mockCtx.chain.name,
        );
    });

    it('clears all timers for the token when balance is zero', async () => {
        const { executeFullSell, clearAllTimersForTokenMock } = await buildMocks(async () => 0n);

        await executeFullSell(
            mockCtx, mockDex, TOKEN, null, 'stop-loss', TRADE_ID, 'zero balance test',
        );

        expect(clearAllTimersForTokenMock).toHaveBeenCalledOnce();
        expect(clearAllTimersForTokenMock).toHaveBeenCalledWith(
            mockCtx.chain.name,
            TOKEN,
        );
    });

    it('deletes exit state from DB when balance is zero', async () => {
        const { executeFullSell, deleteExitStateRun } = await buildMocks(async () => 0n);

        await executeFullSell(
            mockCtx, mockDex, TOKEN, null, 'trailing-stop', TRADE_ID, 'zero balance test',
        );

        expect(deleteExitStateRun).toHaveBeenCalledOnce();
        expect(deleteExitStateRun).toHaveBeenCalledWith(TRADE_ID);
    });

    it('does NOT call sendTxWithRetry when balance is zero (no on-chain sell needed)', async () => {
        const { executeFullSell, sendTxWithRetryMock } = await buildMocks(async () => 0n);

        await executeFullSell(
            mockCtx, mockDex, TOKEN, null, 'trailing-stop', TRADE_ID, 'zero balance test',
        );

        expect(sendTxWithRetryMock).not.toHaveBeenCalled();
    });

    it('does NOT record a trade row when balance is zero', async () => {
        const { executeFullSell, insertTradeRun } = await buildMocks(async () => 0n);

        await executeFullSell(
            mockCtx, mockDex, TOKEN, null, 'trailing-stop', TRADE_ID, 'zero balance test',
        );

        expect(insertTradeRun).not.toHaveBeenCalled();
    });

    it('non-zero balance still proceeds to on-chain sell (control case)', async () => {
        // Build mocks with non-zero balance and pre-configured sendTxWithRetry
        const insertTradeRun = vi.fn();
        const updateTradeStatusRun = vi.fn();
        const deleteExitStateRun = vi.fn();
        const clearAllTimersForTokenMock = vi.fn();
        const sendTxWithRetryMock = vi.fn().mockResolvedValue('0xhash');
        // Phase 21.2-06: the control case (non-zero balance) now drives the
        // inclusion ladder. The private leg LANDS → the on-chain sell happened.
        const escalatePrivateSellMock = vi.fn().mockResolvedValue({ landed: true, txHash: '0xhash' });

        vi.doMock('../../src/utils/db', () => ({
            db: {},
            insertTrade: { run: insertTradeRun },
            updateTradeStatus: { run: updateTradeStatusRun },
            upsertExitState: { run: vi.fn() },
            getExitState: { get: vi.fn() },
            deleteExitState: { run: deleteExitStateRun },
            getTradeIdForPendingToken: { get: vi.fn() },
        }));
        vi.doMock('../../src/utils/logger', () => ({
            logger: {
                child: () => ({
                    info: vi.fn(), warn: vi.fn(), debug: vi.fn(),
                    error: vi.fn(), fatal: vi.fn(),
                }),
            },
        }));
        vi.doMock('../../src/config', () => ({
            CONFIG: {
                trailingStopPct: 15, trailingMinPct: 5, trailingMaxPct: 40,
                stopLossPercent: 25, partialSellTargets: '',
                exitPollIntervalMs: 5000, urgencyWindowMs: 30 * 60 * 1000,
                volatilityBaselineCV: 0.03, volatilityMaxSamples: 60, volatilityMinSamples: 12,
            },
        }));
        vi.doMock('../../src/utils/exitManager', () => ({
            tryAcquireSellLock: vi.fn().mockReturnValue(true),
            releaseSellLock: vi.fn(),
            registerExitMonitor: vi.fn(),
            clearAllTimersForToken: clearAllTimersForTokenMock,
        }));
        vi.doMock('../../src/utils/notifier', () => ({
            sendCtxAlert: vi.fn().mockResolvedValue(undefined),
        }));
        vi.doMock('../../src/utils/txManager', () => ({
            sendTxWithRetry: sendTxWithRetryMock,
            escalatePrivateSell: escalatePrivateSellMock,
        }));
        vi.doMock('../../src/utils/receiptDecoder', () => ({
            decodeReceipt: vi.fn().mockResolvedValue({
                amountOut: '1000', gasCost: '100', blockNumber: 1,
            }),
        }));
        vi.doMock('ethers', async () => {
            const actual = await vi.importActual<typeof import('ethers')>('ethers');
            class MockContract {
                async balanceOf() { return 1000000000000000000n; } // non-zero
                async allowance() { return 1n << 200n; }
                async approve() { return { wait: async () => ({}) }; }
            }
            return { ...actual, Contract: MockContract };
        });

        const { executeFullSell } = await import('../../src/exitEngine');

        await executeFullSell(
            mockCtx, mockDex, TOKEN, null, 'trailing-stop', TRADE_ID, 'non-zero test',
        );

        // The private leg of the inclusion ladder was driven (on-chain sell happened).
        expect(escalatePrivateSellMock).toHaveBeenCalledOnce();
        // Trade row was recorded
        expect(insertTradeRun).toHaveBeenCalledOnce();
    });
});
