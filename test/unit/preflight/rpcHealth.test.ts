// Phase 20 / Plan 20-02 / OPS-LIVE-03 — Live tests for checkRpcChainId + checkRpcBlockAge.

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

vi.mock('../../../src/utils/txManager', () => ({
    createMevStrategy: vi.fn(() => ({ healthCheck: vi.fn().mockResolvedValue(true), name: 'mock' })),
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

interface MockProvider {
    getNetwork: ReturnType<typeof vi.fn>;
    getBlock: ReturnType<typeof vi.fn>;
    getBalance?: ReturnType<typeof vi.fn>;
    getCode?: ReturnType<typeof vi.fn>;
}

function makeChain(opts: { chainId?: number; blockAgeToleranceSec?: number; provider: MockProvider }) {
    return {
        name: 'eth',
        nativeCurrency: 'ETH',
        snipeAmount: '0.003',
        gasBuffer: '0.005',
        chainId: opts.chainId ?? 1,
        blockAgeToleranceSec: opts.blockAgeToleranceSec ?? 300,
        envPrefix: 'ETH',
        mevStrategy: 'flashbots' as const,
        honeypotChecker: { deployedAddress: '0x' + 'a'.repeat(40) },
        wallet: { address: '0x' + 'b'.repeat(40) },
        httpProvider: opts.provider,
    };
}

describe('checkRpcChainId', () => {
    beforeEach(() => {
        logFatal.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fails (passed: false) when httpProvider.getNetwork().chainId mismatches chain.chainId (expected 1, got 11155111)', async () => {
        const provider: MockProvider = {
            getNetwork: vi.fn().mockResolvedValue({ chainId: 11155111n }),
            getBlock: vi.fn(),
        };
        const chain = makeChain({ chainId: 1, provider });
        const { checkRpcChainId } = await import('../../../src/preflight');
        const result = await checkRpcChainId(chain as never);
        expect(result.passed).toBe(false);
        expect(result.check).toBe('rpc-chainid');
        expect(result.details?.expected).toBe(1);
        expect(result.details?.got).toBe(11155111);
        expect(result.chain).toBe('eth');
    });

    it('passes when httpProvider.getNetwork().chainId === chain.chainId (both === 1)', async () => {
        const provider: MockProvider = {
            getNetwork: vi.fn().mockResolvedValue({ chainId: 1n }),
            getBlock: vi.fn(),
        };
        const chain = makeChain({ chainId: 1, provider });
        const { checkRpcChainId } = await import('../../../src/preflight');
        const result = await checkRpcChainId(chain as never);
        expect(result.passed).toBe(true);
        expect(result.check).toBe('rpc-chainid');
    });
});

describe('checkRpcBlockAge', () => {
    beforeEach(() => {
        logFatal.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('passes when block.timestamp is fresh (60s old, well under 300s tolerance)', async () => {
        const now = 1_700_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
        const provider: MockProvider = {
            getNetwork: vi.fn(),
            getBlock: vi.fn().mockResolvedValue({ timestamp: now - 60 }),
        };
        const chain = makeChain({ blockAgeToleranceSec: 300, provider });
        const { checkRpcBlockAge } = await import('../../../src/preflight');
        const result = await checkRpcBlockAge(chain as never);
        expect(result.passed).toBe(true);
        expect(result.check).toBe('rpc-block-age');
    });

    it('fails when block tip stale (750s > 300s tolerance) with blockAgeSec + toleranceSec details', async () => {
        const now = 1_700_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
        const provider: MockProvider = {
            getNetwork: vi.fn(),
            getBlock: vi.fn().mockResolvedValue({ timestamp: now - 750 }),
        };
        const chain = makeChain({ blockAgeToleranceSec: 300, provider });
        const { checkRpcBlockAge } = await import('../../../src/preflight');
        const result = await checkRpcBlockAge(chain as never);
        expect(result.passed).toBe(false);
        expect(result.check).toBe('rpc-block-age');
        expect(result.details?.blockAgeSec).toBe(750);
        expect(result.details?.toleranceSec).toBe(300);
    });
});
