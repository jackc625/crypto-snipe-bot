// Phase 20 / Plan 20-02 / OPS-LIVE-04 — Live tests for checkMevHealth.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logFatal = vi.fn();
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            fatal: logFatal,
            debug: vi.fn(),
        }),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: logFatal,
        debug: vi.fn(),
    },
}));

// MEV strategies factory mock — each test scripts the return.
const healthCheckMock = vi.fn();
const createMevStrategyMock = vi.fn(() => ({
    healthCheck: healthCheckMock,
    name: 'mock-strategy',
}));
vi.mock('../../../src/utils/txManager', () => ({
    createMevStrategy: createMevStrategyMock,
    sendTxWithRetry: vi.fn(),
}));

vi.mock('../../../src/utils/notifier', () => ({
    sendCtxAlert: vi.fn(),
    sendTelegramAlert: vi.fn(),
    sendChainAlert: vi.fn(),
}));

vi.mock('../../../src/utils/db', () => ({
    getAntirugDryRunStarted: { get: vi.fn(() => undefined) },
    db: {},
}));

function makeChain(mevStrategy: 'flashbots' | 'bloxroute' | 'passthrough', chainName = 'eth') {
    return {
        name: chainName,
        nativeCurrency: 'ETH',
        snipeAmount: '0.003',
        gasBuffer: '0.005',
        chainId: 1,
        blockAgeToleranceSec: 300,
        envPrefix: chainName.toUpperCase(),
        mevStrategy,
        honeypotChecker: { deployedAddress: '0x' + 'a'.repeat(40) },
        wallet: { address: '0x' + 'b'.repeat(40) },
        httpProvider: {},
        mevConfig: {},
    };
}

describe('checkMevHealth', () => {
    beforeEach(() => {
        logFatal.mockClear();
        healthCheckMock.mockReset();
        createMevStrategyMock.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fails when Flashbots healthCheck returns false on ETH', async () => {
        healthCheckMock.mockResolvedValue(false);
        const chain = makeChain('flashbots', 'eth');
        const { checkMevHealth } = await import('../../../src/preflight');
        const result = await checkMevHealth(chain as never);
        expect(result.passed).toBe(false);
        expect(result.check).toBe('mev-health');
        expect(result.details?.strategy).toBe('flashbots');
        expect(result.chain).toBe('eth');
    });

    it('fails when bloXroute healthCheck returns false on BSC', async () => {
        healthCheckMock.mockResolvedValue(false);
        const chain = makeChain('bloxroute', 'bsc');
        const { checkMevHealth } = await import('../../../src/preflight');
        const result = await checkMevHealth(chain as never);
        expect(result.passed).toBe(false);
        expect(result.check).toBe('mev-health');
        expect(result.details?.strategy).toBe('bloxroute');
        expect(result.chain).toBe('bsc');
    });

    it('passes (passed: true, reason: passthrough) for passthrough strategy (Base/Arb) WITHOUT invoking healthCheck', async () => {
        const chain = makeChain('passthrough', 'base');
        const { checkMevHealth } = await import('../../../src/preflight');
        const result = await checkMevHealth(chain as never);
        expect(result.passed).toBe(true);
        expect(result.reason).toBe('passthrough');
        // healthCheckMock must NOT have been called on passthrough short-circuit
        expect(healthCheckMock).not.toHaveBeenCalled();
    });

    it('passes when healthCheck returns true', async () => {
        healthCheckMock.mockResolvedValue(true);
        const chain = makeChain('flashbots', 'eth');
        const { checkMevHealth } = await import('../../../src/preflight');
        const result = await checkMevHealth(chain as never);
        expect(result.passed).toBe(true);
        expect(result.check).toBe('mev-health');
    });
});
