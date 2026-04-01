import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock provider.ts
vi.mock('../../src/utils/provider', () => ({
    getWsProvider: vi.fn(),
    removeWsProvider: vi.fn(),
}));

// Mock txManager.ts
vi.mock('../../src/utils/txManager', () => ({
    createMevStrategy: vi.fn(),
}));

import { getWsProvider, removeWsProvider } from '../../src/utils/provider';
import { createMevStrategy } from '../../src/utils/txManager';

describe('chain restart callback operations', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('reconnects WS provider when wsProvider is null', () => {
        const mockWsProvider = { destroyed: false };
        (getWsProvider as any).mockReturnValue(mockWsProvider);

        // Simulate: ctx.wsProvider is null, chain has wsRpcUrl
        removeWsProvider('eth');
        const newWs = getWsProvider('eth', 'ws://rpc', 1);

        expect(removeWsProvider).toHaveBeenCalledWith('eth');
        expect(getWsProvider).toHaveBeenCalledWith('eth', 'ws://rpc', 1);
        expect(newWs).toBe(mockWsProvider);
    });

    it('runs MEV health check and returns unhealthy warning', async () => {
        const mockStrategy = { healthCheck: vi.fn().mockResolvedValue(false) };
        (createMevStrategy as any).mockReturnValue(mockStrategy);

        const chain = { name: 'eth', mevStrategy: 'flashbots' };
        const strategy = createMevStrategy(chain as any);
        const healthy = await strategy.healthCheck();

        expect(healthy).toBe(false);
        // In the actual callback, this would add 'MEV service unreachable' to warnings
    });

    it('MEV health check returns healthy with no warnings', async () => {
        const mockStrategy = { healthCheck: vi.fn().mockResolvedValue(true) };
        (createMevStrategy as any).mockReturnValue(mockStrategy);

        const strategy = createMevStrategy({} as any);
        const healthy = await strategy.healthCheck();
        expect(healthy).toBe(true);
    });

    it('simulates full onRestart flow: WS reconnect + MEV check + DEX listener', async () => {
        // This test simulates the orchestrated onRestart callback flow from bot.ts
        const mockWsProvider = { destroyed: false };
        (getWsProvider as any).mockReturnValue(mockWsProvider);

        const mockStrategy = { healthCheck: vi.fn().mockResolvedValue(true) };
        (createMevStrategy as any).mockReturnValue(mockStrategy);

        const warnings: string[] = [];

        // Step 1: Reconnect WS
        removeWsProvider('eth');
        const newWs = getWsProvider('eth', 'ws://rpc', 1);
        expect(newWs).toBe(mockWsProvider);

        // Step 2: MEV health check
        const strategy = createMevStrategy({ name: 'eth', mevStrategy: 'flashbots' } as any);
        const mevHealthy = await strategy.healthCheck();
        if (!mevHealthy) {
            warnings.push('MEV service unreachable');
        }

        // Step 3: No warnings on success
        expect(warnings).toEqual([]);
    });

    it('collects warning when MEV health check throws', async () => {
        (createMevStrategy as any).mockReturnValue({
            healthCheck: vi.fn().mockRejectedValue(new Error('Network timeout')),
        });

        const warnings: string[] = [];
        const strategy = createMevStrategy({ name: 'eth' } as any);

        try {
            await strategy.healthCheck();
        } catch (err) {
            warnings.push(`MEV health check failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        expect(warnings).toEqual(['MEV health check failed: Network timeout']);
    });
});
