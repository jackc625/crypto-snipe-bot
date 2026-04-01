import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock references -- reassignable per test
let connectMock = vi.fn().mockResolvedValue(undefined);
let addEventHandlerMock = vi.fn();
let disconnectMock = vi.fn().mockResolvedValue(undefined);

// Top-level vi.mock (hoisted) -- TelegramClient is a class
vi.mock('telegram', () => {
    class MockTelegramClient {
        connect(...args: any[]) { return connectMock(...args); }
        addEventHandler(...args: any[]) { return addEventHandlerMock(...args); }
        disconnect(...args: any[]) { return disconnectMock(...args); }
    }
    return { TelegramClient: MockTelegramClient };
});

vi.mock('telegram/sessions', () => ({
    StringSession: vi.fn().mockImplementation((s: string) => s),
}));

vi.mock('telegram/events', () => ({
    NewMessage: vi.fn().mockImplementation(() => ({})),
}));

// Mock alphaDrop
vi.mock('../../src/alphaDrop', () => ({
    handleAlphaDropForChain: vi.fn().mockResolvedValue(undefined),
}));

// Mock logger
vi.mock('../../src/utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Import after mocks are set up (no resetModules needed since env vars are read at call time)
import { startTelegramListener } from '../../src/telegramListener';
import { handleAlphaDropForChain } from '../../src/alphaDrop';

describe('startTelegramListener', () => {
    const originalEnv = process.env;

    // Counter to ensure each test gets a unique time far apart (beyond COOLDOWN_MS of 5000ms)
    let testIndex = 0;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };

        // Re-create mock functions (clearAllMocks removes implementations from mock fns)
        connectMock = vi.fn().mockResolvedValue(undefined);
        addEventHandlerMock = vi.fn();
        disconnectMock = vi.fn().mockResolvedValue(undefined);

        // Restore handleAlphaDropForChain mock (clearAllMocks wipes its resolved value)
        (handleAlphaDropForChain as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        // Each test gets a time window 30s apart to avoid the 5s cooldown
        testIndex++;
        const baseTime = 1700000000000 + (testIndex * 30000);
        vi.useFakeTimers({ now: baseTime });
    });

    afterEach(() => {
        vi.useRealTimers();
        process.env = originalEnv;
    });

    it('returns null client when TELEGRAM_API_ID is missing', async () => {
        delete process.env.TELEGRAM_API_ID;
        delete process.env.TELEGRAM_API_HASH;
        delete process.env.TELEGRAM_SESSION;

        const result = await startTelegramListener([]);

        expect(result.client).toBeNull();
        expect(result.connected).toBe(false);
    });

    it('returns null client when connect() throws', async () => {
        process.env.TELEGRAM_API_ID = '12345';
        process.env.TELEGRAM_API_HASH = 'abc';
        process.env.TELEGRAM_SESSION = 'session';

        connectMock = vi.fn().mockRejectedValue(new Error('Connection refused'));

        const result = await startTelegramListener([]);

        expect(result.client).toBeNull();
        expect(result.connected).toBe(false);
    });

    it('connects successfully with valid env vars', async () => {
        process.env.TELEGRAM_API_ID = '12345';
        process.env.TELEGRAM_API_HASH = 'abc';
        process.env.TELEGRAM_SESSION = 'session';

        const result = await startTelegramListener([]);

        expect(result.connected).toBe(true);
        expect(result.client).not.toBeNull();
    });

    // FIX-09 whitelist tests: test through the actual event handler callback
    // captured from client.addEventHandler mock
    describe('whitelist enforcement via event handler', () => {
        it('rejects message when sender is not whitelisted and channel is not whitelisted', async () => {
            process.env.TELEGRAM_API_ID = '12345';
            process.env.TELEGRAM_API_HASH = 'abc';
            process.env.TELEGRAM_SESSION = 'session';
            process.env.TELEGRAM_ALLOWED_SENDERS = '111,222';
            process.env.TELEGRAM_ALLOWED_CHANNELS = '333';

            await startTelegramListener([]);

            // Capture the event handler callback
            expect(addEventHandlerMock).toHaveBeenCalledOnce();
            const eventHandler = addEventHandlerMock.mock.calls[0][0];

            // Simulate a message from non-whitelisted sender/channel
            await eventHandler({
                message: {
                    senderId: { toString: () => '999' },
                    message: '0xaaaa567890abcdef1234567890abcdef12345678',
                },
                chatId: { toString: () => '888' },
            });

            // handleAlphaDropForChain should NOT have been called
            expect(handleAlphaDropForChain).not.toHaveBeenCalled();
        });

        it('allows message when sender is whitelisted (OR logic)', async () => {
            process.env.TELEGRAM_API_ID = '12345';
            process.env.TELEGRAM_API_HASH = 'abc';
            process.env.TELEGRAM_SESSION = 'session';
            process.env.TELEGRAM_ALLOWED_SENDERS = '111';
            process.env.TELEGRAM_ALLOWED_CHANNELS = '333';

            const mockCtx = {
                chain: { name: 'eth' },
                httpProvider: { getCode: vi.fn().mockResolvedValue('0x1234') },
                log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            };

            await startTelegramListener([mockCtx as any]);

            expect(addEventHandlerMock).toHaveBeenCalledOnce();
            const eventHandler = addEventHandlerMock.mock.calls[0][0];

            // Sender 111 IS in whitelist, channel 888 is NOT -- OR logic allows it
            await eventHandler({
                message: {
                    senderId: { toString: () => '111' },
                    message: '0xbbbb567890abcdef1234567890abcdef12345678',
                },
                chatId: { toString: () => '888' },
            });

            // Should proceed to routing (getCode called)
            expect(mockCtx.httpProvider.getCode).toHaveBeenCalled();
        });

        it('allows message when channel is whitelisted (OR logic)', async () => {
            process.env.TELEGRAM_API_ID = '12345';
            process.env.TELEGRAM_API_HASH = 'abc';
            process.env.TELEGRAM_SESSION = 'session';
            process.env.TELEGRAM_ALLOWED_SENDERS = '111';
            process.env.TELEGRAM_ALLOWED_CHANNELS = '333';

            const mockCtx = {
                chain: { name: 'eth' },
                httpProvider: { getCode: vi.fn().mockResolvedValue('0x1234') },
                log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            };

            await startTelegramListener([mockCtx as any]);

            expect(addEventHandlerMock).toHaveBeenCalledOnce();
            const eventHandler = addEventHandlerMock.mock.calls[0][0];

            // Sender 999 is NOT in whitelist, channel 333 IS -- OR logic allows it
            await eventHandler({
                message: {
                    senderId: { toString: () => '999' },
                    message: '0xcccc567890abcdef1234567890abcdef12345678',
                },
                chatId: { toString: () => '333' },
            });

            // Should proceed to routing (getCode called)
            expect(mockCtx.httpProvider.getCode).toHaveBeenCalled();
        });

        it('allows all when both whitelist env vars are empty', async () => {
            process.env.TELEGRAM_API_ID = '12345';
            process.env.TELEGRAM_API_HASH = 'abc';
            process.env.TELEGRAM_SESSION = 'session';
            process.env.TELEGRAM_ALLOWED_SENDERS = '';
            process.env.TELEGRAM_ALLOWED_CHANNELS = '';

            const mockCtx = {
                chain: { name: 'eth' },
                httpProvider: { getCode: vi.fn().mockResolvedValue('0x1234') },
                log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            };

            await startTelegramListener([mockCtx as any]);

            expect(addEventHandlerMock).toHaveBeenCalledOnce();
            const eventHandler = addEventHandlerMock.mock.calls[0][0];

            // Any sender/channel should be allowed when both lists are empty
            await eventHandler({
                message: {
                    senderId: { toString: () => '999' },
                    message: '0xdddd567890abcdef1234567890abcdef12345678',
                },
                chatId: { toString: () => '888' },
            });

            // Should proceed to routing
            expect(mockCtx.httpProvider.getCode).toHaveBeenCalled();
        });
    });

    // Multi-chain routing tests
    describe('multi-chain routing', () => {
        it('calls getCode on each context httpProvider and routes only to matching chains', async () => {
            process.env.TELEGRAM_API_ID = '12345';
            process.env.TELEGRAM_API_HASH = 'abc';
            process.env.TELEGRAM_SESSION = 'session';
            process.env.TELEGRAM_ALLOWED_SENDERS = '';
            process.env.TELEGRAM_ALLOWED_CHANNELS = '';

            const ethCtx = {
                chain: { name: 'eth' },
                httpProvider: { getCode: vi.fn().mockResolvedValue('0x1234') },
                log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            };
            const bscCtx = {
                chain: { name: 'bsc' },
                httpProvider: { getCode: vi.fn().mockResolvedValue('0x') },
                log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            };

            await startTelegramListener([ethCtx as any, bscCtx as any]);

            expect(addEventHandlerMock).toHaveBeenCalledOnce();
            const eventHandler = addEventHandlerMock.mock.calls[0][0];

            await eventHandler({
                message: {
                    senderId: { toString: () => '111' },
                    message: 'Check this token 0xeeee567890abcdef1234567890abcdef12345678',
                },
                chatId: { toString: () => '888' },
            });

            // Both chains should have getCode called
            expect(ethCtx.httpProvider.getCode).toHaveBeenCalled();
            expect(bscCtx.httpProvider.getCode).toHaveBeenCalled();

            // Only ETH context should trigger handleAlphaDropForChain (BSC returned '0x')
            expect(handleAlphaDropForChain).toHaveBeenCalledOnce();
            expect(handleAlphaDropForChain).toHaveBeenCalledWith(
                ethCtx,
                expect.stringContaining('0xeeee567890abcdef1234567890abcdef12345678'),
            );
        });
    });
});
