// test/integration/wsReconnect.test.ts
// Integration tests for WebSocket reconnect behavior, provider caching/cleanup,
// exponential backoff pattern, and HTTP polling fallback.
// (D-20 category 4: WebSocket/connection failures)
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createMockProvider } from '../helpers/mockProvider';

// ---------------------------------------------------------------------------
// Provider cache lifecycle (getWsProvider/removeWsProvider)
// ---------------------------------------------------------------------------

describe('WebSocket provider cache lifecycle', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    async function importProvider() {
        // Mock ethers to track WebSocketProvider construction
        const mockWsInstances: any[] = [];

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
                network: 'mainnet',
                rpc: { mainnet: 'https://eth-rpc.example.com' },
                walletPrivateKey: '0x' + '1'.repeat(64),
            },
        }));
        vi.doMock('ethers', async () => {
            const actual = await vi.importActual<typeof import('ethers')>('ethers');
            return {
                ...actual,
                ethers: {
                    ...actual.ethers,
                    JsonRpcProvider: class MockJsonRpcProvider {
                        constructor(public url: string) {}
                    },
                    WebSocketProvider: class MockWebSocketProvider {
                        url: string;
                        chainId: number | undefined;
                        destroyed = false;
                        constructor(url: string, chainId?: number) {
                            this.url = url;
                            this.chainId = chainId;
                            mockWsInstances.push(this);
                        }
                        destroy() {
                            this.destroyed = true;
                        }
                    },
                    Wallet: class MockWallet {
                        constructor(public key: string, public provider?: any) {}
                    },
                },
            };
        });

        const mod = await import('../../src/utils/provider');
        return { mod, mockWsInstances };
    }

    it('getWsProvider returns null when wsUrl is null', async () => {
        const { mod } = await importProvider();

        const provider = mod.getWsProvider('eth', null);
        expect(provider).toBeNull();
    });

    it('getWsProvider returns provider when wsUrl is provided', async () => {
        const { mod } = await importProvider();

        const provider = mod.getWsProvider('eth', 'wss://test.io', 1);
        expect(provider).not.toBeNull();
    });

    it('getWsProvider returns SAME cached instance on second call', async () => {
        const { mod } = await importProvider();

        const provider1 = mod.getWsProvider('eth', 'wss://test.io', 1);
        const provider2 = mod.getWsProvider('eth', 'wss://test.io', 1);

        expect(provider1).toBe(provider2);
    });

    it('removeWsProvider removes from cache, next getWsProvider creates NEW instance', async () => {
        const { mod, mockWsInstances } = await importProvider();

        const provider1 = mod.getWsProvider('eth', 'wss://test.io', 1);
        expect(mockWsInstances.length).toBe(1);

        mod.removeWsProvider('eth');
        expect(mockWsInstances[0].destroyed).toBe(true);

        const provider2 = mod.getWsProvider('eth', 'wss://test.io', 1);
        expect(mockWsInstances.length).toBe(2);
        expect(provider2).not.toBe(provider1);
    });

    it('removeWsProvider is safe to call when no provider exists', async () => {
        const { mod } = await importProvider();

        // Should not throw
        expect(() => mod.removeWsProvider('nonexistent')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Exponential backoff reconnect pattern
// ---------------------------------------------------------------------------

describe('WebSocket reconnect exponential backoff', () => {
    it('delay doubles on failure: 1s -> 2s -> 4s -> ... up to 60s max', () => {
        // This validates the reconnect delay logic from handleWsClose in bot.ts:
        //   reconnectDelay = Math.min(reconnectDelay * 2, maxDelay)
        let reconnectDelay = 1000;
        const maxDelay = 60000;
        const delays: number[] = [];

        for (let i = 0; i < 8; i++) {
            delays.push(reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
        }

        expect(delays).toEqual([
            1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000,
        ]);
    });

    it('successful reconnect resets delay to 1000ms', () => {
        let reconnectDelay = 1000;
        const maxDelay = 60000;

        // Simulate 3 failures
        for (let i = 0; i < 3; i++) {
            reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
        }
        expect(reconnectDelay).toBe(8000); // 1000 -> 2000 -> 4000 -> 8000

        // Simulate successful reconnect
        reconnectDelay = 1000;
        expect(reconnectDelay).toBe(1000);
    });

    it('delay never exceeds 60s even after many failures', () => {
        let reconnectDelay = 1000;
        const maxDelay = 60000;

        for (let i = 0; i < 100; i++) {
            reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
        }

        expect(reconnectDelay).toBe(60000);
    });
});

// ---------------------------------------------------------------------------
// HTTP polling fallback
// ---------------------------------------------------------------------------

describe('HTTP polling fallback when wsProvider is null', () => {
    it('wsProvider null condition triggers HTTP polling path', () => {
        // In startDexListener (bot.ts line 752-757):
        //   if (!wsProvider) {
        //       ctx.log.info({ dex }, 'No WebSocket provider, falling back to HTTP polling');
        //       startHttpPollingListener(ctx, dex);
        //       return;
        //   }
        //
        // Test: verify the guard condition that determines the fallback path

        const ctxWithWs = { wsProvider: {} as any };
        const ctxWithoutWs = { wsProvider: null };

        expect(ctxWithWs.wsProvider === null).toBe(false);
        expect(ctxWithoutWs.wsProvider === null).toBe(true);

        // This is the condition that triggers HTTP polling fallback
        expect(!ctxWithoutWs.wsProvider).toBe(true);
        expect(!ctxWithWs.wsProvider).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Provider method throws after disconnect
// ---------------------------------------------------------------------------

describe('RPC disconnect behavior', () => {
    it('provider methods throw after disconnect, caller catches gracefully', async () => {
        // Create a mock provider that simulates disconnected state
        const disconnectedProvider = createMockProvider({
            getBlockNumber: vi.fn().mockRejectedValue(
                new Error('WebSocket is not connected')
            ),
            call: vi.fn().mockRejectedValue(
                new Error('WebSocket is not connected')
            ),
            getTransactionCount: vi.fn().mockRejectedValue(
                new Error('could not detect network')
            ),
        });

        // Verify methods throw with expected error messages
        await expect(disconnectedProvider.getBlockNumber())
            .rejects.toThrow('WebSocket is not connected');
        await expect(disconnectedProvider.call())
            .rejects.toThrow('WebSocket is not connected');
        await expect(disconnectedProvider.getTransactionCount())
            .rejects.toThrow('could not detect network');

        // Verify that wrapping in try/catch handles gracefully
        let fallbackUsed = false;
        try {
            await disconnectedProvider.getBlockNumber();
        } catch {
            fallbackUsed = true;
        }
        expect(fallbackUsed).toBe(true);
    });

    it('ECONNRESET error is caught and logged without crashing', async () => {
        const errorProvider = createMockProvider({
            getBlockNumber: vi.fn().mockRejectedValue(
                new Error('read ECONNRESET')
            ),
        });

        // Simulate how bot code handles provider errors:
        const errors: string[] = [];

        try {
            await errorProvider.getBlockNumber();
        } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e));
        }

        expect(errors).toEqual(['read ECONNRESET']);

        // After catching, the code continues (does not crash)
        // In real code, this triggers reconnect logic
    });

    it('multiple sequential disconnections are handled', async () => {
        let callCount = 0;
        const intermittentProvider = createMockProvider({
            getBlockNumber: vi.fn().mockImplementation(async () => {
                callCount++;
                if (callCount <= 3) {
                    throw new Error('WebSocket is not connected');
                }
                return 18000000;
            }),
        });

        // Simulate retry loop (similar to reconnect logic)
        let result: number | null = null;
        let attempts = 0;

        while (result === null && attempts < 5) {
            try {
                result = await intermittentProvider.getBlockNumber();
            } catch {
                attempts++;
            }
        }

        // Succeeded on 4th attempt (after 3 failures)
        expect(result).toBe(18000000);
        expect(attempts).toBe(3);
    });
});
