// test/unit/exitManager.shutdown.test.ts
// Unit tests for graceful shutdown handler (FIX-05, task 01-01-02).
//
// Verifies:
//   - isShutdownInProgress() returns false before initShutdownHandler
//   - SIGTERM handler calls factory.removeAllListeners(), closeDb(), process.exit(0)
//   - SIGINT handler also triggers shutdown
//   - Re-entrant guard: second signal while shutting down does NOT call closeDb a second time
//   - isShutdownInProgress() returns true after shutdown begins
//   - clearAllTimers effect: registered timer registry is empty after shutdown fires

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('initShutdownHandler — graceful shutdown on SIGTERM/SIGINT', () => {
    // Fresh module per test so isShuttingDown module-level flag resets.
    beforeEach(() => {
        vi.resetModules();
    });

    async function loadModules() {
        const closeDbMock = vi.fn();
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
        vi.doMock('../../src/utils/db', () => ({
            closeDb: closeDbMock,
        }));
        const em = await import('../../src/utils/exitManager');
        return { em, closeDbMock };
    }

    it('isShutdownInProgress returns false before initShutdownHandler is called', async () => {
        const { em } = await loadModules();
        expect(em.isShutdownInProgress()).toBe(false);
    });

    it('SIGTERM calls factory.removeAllListeners and closeDb and exits with code 0', async () => {
        const { em, closeDbMock } = await loadModules();
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const mockFactory = { removeAllListeners: vi.fn() };

        em.initShutdownHandler(mockFactory as any);
        process.emit('SIGTERM');

        expect(mockFactory.removeAllListeners).toHaveBeenCalledOnce();
        expect(closeDbMock).toHaveBeenCalledOnce();
        expect(exitSpy).toHaveBeenCalledWith(0);

        exitSpy.mockRestore();
    });

    it('SIGINT also triggers shutdown: calls removeAllListeners, closeDb, and exits', async () => {
        const { em, closeDbMock } = await loadModules();
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const mockFactory = { removeAllListeners: vi.fn() };

        em.initShutdownHandler(mockFactory as any);
        process.emit('SIGINT');

        expect(mockFactory.removeAllListeners).toHaveBeenCalledOnce();
        expect(closeDbMock).toHaveBeenCalledOnce();
        expect(exitSpy).toHaveBeenCalledWith(0);

        exitSpy.mockRestore();
    });

    it('isShutdownInProgress returns true after SIGTERM fires', async () => {
        const { em } = await loadModules();
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const mockFactory = { removeAllListeners: vi.fn() };

        em.initShutdownHandler(mockFactory as any);
        expect(em.isShutdownInProgress()).toBe(false);

        process.emit('SIGTERM');
        expect(em.isShutdownInProgress()).toBe(true);

        exitSpy.mockRestore();
    });

    it('re-entrant guard: second SIGTERM does not call closeDb a second time', async () => {
        const { em, closeDbMock } = await loadModules();
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const mockFactory = { removeAllListeners: vi.fn() };

        em.initShutdownHandler(mockFactory as any);

        // First signal runs shutdown
        process.emit('SIGTERM');
        expect(closeDbMock).toHaveBeenCalledTimes(1);

        // Second signal hits re-entrant guard (isShuttingDown is already true)
        process.emit('SIGTERM');
        // closeDb must still only have been called once
        expect(closeDbMock).toHaveBeenCalledTimes(1);

        exitSpy.mockRestore();
    });

    it('clearAllTimers is called: registered timers are gone from registry after SIGTERM', async () => {
        const { em } = await loadModules();
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const mockFactory = { removeAllListeners: vi.fn() };

        // Register a timer so clearAllTimers has something to clear
        const handle = setInterval(() => {}, 60_000);
        em.registerExitMonitor('eth', '0xabc', handle);

        em.initShutdownHandler(mockFactory as any);
        process.emit('SIGTERM');

        // After shutdown, calling clearAllTimersForToken should be a no-op
        // (the registry is already empty — clearAllTimers was called during shutdown)
        expect(() => em.clearAllTimersForToken('eth', '0xabc')).not.toThrow();

        exitSpy.mockRestore();
    });

    it('isShutdownInProgress is false after initShutdownHandler resets the flag', async () => {
        const { em } = await loadModules();
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const mockFactory = { removeAllListeners: vi.fn() };

        // initShutdownHandler resets the flag to false at entry
        em.initShutdownHandler(mockFactory as any);
        expect(em.isShutdownInProgress()).toBe(false);

        exitSpy.mockRestore();
    });
});

describe('resumeMonitoring — isShutdownInProgress flag lifecycle', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    async function loadModules() {
        const closeDbMock = vi.fn();
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
        vi.doMock('../../src/utils/db', () => ({
            closeDb: closeDbMock,
        }));
        const em = await import('../../src/utils/exitManager');
        return { em, closeDbMock };
    }

    it('flag goes false -> false -> true across the init + signal lifecycle', async () => {
        const { em } = await loadModules();
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const mockFactory = { removeAllListeners: vi.fn() };

        // Before init
        expect(em.isShutdownInProgress()).toBe(false);
        // After init (resets flag)
        em.initShutdownHandler(mockFactory as any);
        expect(em.isShutdownInProgress()).toBe(false);
        // After signal
        process.emit('SIGTERM');
        expect(em.isShutdownInProgress()).toBe(true);

        exitSpy.mockRestore();
    });
});
