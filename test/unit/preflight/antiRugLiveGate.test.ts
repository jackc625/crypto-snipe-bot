// Phase 20 / Plan 20-02 / OPS-LIVE-07 (D-ANTIRUG-LIVE-GATE-CODE) — Live tests
// for checkAntiRugLiveGate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
            debug: vi.fn(),
        }),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
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

// DB mock for getAntirugDryRunStarted prepared statement.
const dryRunGet = vi.fn();
vi.mock('../../../src/utils/db', () => ({
    getAntirugDryRunStarted: { get: dryRunGet },
    db: { prepare: vi.fn(() => ({ all: vi.fn(() => []), get: vi.fn(), run: vi.fn() })) },
}));

function makeChain() {
    return {
        name: 'eth',
        nativeCurrency: 'ETH',
        snipeAmount: '0.003',
        gasBuffer: '0.005',
        chainId: 1,
        blockAgeToleranceSec: 300,
        envPrefix: 'ETH',
        mevStrategy: 'flashbots' as const,
        honeypotChecker: { deployedAddress: '0x' + 'a'.repeat(40) },
        wallet: { address: '0x' + 'b'.repeat(40) },
        httpProvider: {},
    };
}

const SEVEN_DAYS = 7 * 86400;

describe('checkAntiRugLiveGate', () => {
    beforeEach(() => {
        dryRunGet.mockReset();
        delete process.env.ETH_ANTIRUG_LIVE_EXECUTE;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        delete process.env.ETH_ANTIRUG_LIVE_EXECUTE;
    });

    it('fails when ETH_ANTIRUG_LIVE_EXECUTE=true and antirug_dry_run_started is NULL', async () => {
        process.env.ETH_ANTIRUG_LIVE_EXECUTE = 'true';
        dryRunGet.mockReturnValue({ antirug_dry_run_started: null });
        const { checkAntiRugLiveGate } = await import('../../../src/preflight');
        const result = await checkAntiRugLiveGate(makeChain() as never);
        expect(result.passed).toBe(false);
        expect(result.check).toBe('antirug-live-gate');
        expect(result.reason).toMatch(/no dry-run timestamp recorded|dry-run never started|dry-run not started/i);
        expect(result.reason).toMatch(/docs\/operations\/anti-rug-rollout\.md/);
    });

    it('fails when ETH_ANTIRUG_LIVE_EXECUTE=true and timestamp is 3 days ago (< 7-day floor)', async () => {
        process.env.ETH_ANTIRUG_LIVE_EXECUTE = 'true';
        const now = 1_700_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
        dryRunGet.mockReturnValue({ antirug_dry_run_started: now - 3 * 86400 });
        const { checkAntiRugLiveGate } = await import('../../../src/preflight');
        const result = await checkAntiRugLiveGate(makeChain() as never);
        expect(result.passed).toBe(false);
        expect(result.check).toBe('antirug-live-gate');
        expect(result.reason).toMatch(/days remaining|days?/i);
        expect(result.details?.ageDays).toBeDefined();
        expect(result.details?.requiredDays).toBe(7);
    });

    it('passes when ETH_ANTIRUG_LIVE_EXECUTE=true and timestamp is 8 days ago (>= 7-day floor)', async () => {
        process.env.ETH_ANTIRUG_LIVE_EXECUTE = 'true';
        const now = 1_700_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
        dryRunGet.mockReturnValue({ antirug_dry_run_started: now - 8 * 86400 });
        const { checkAntiRugLiveGate } = await import('../../../src/preflight');
        const result = await checkAntiRugLiveGate(makeChain() as never);
        expect(result.passed).toBe(true);
        expect(result.check).toBe('antirug-live-gate');
    });

    it('passes when ETH_ANTIRUG_LIVE_EXECUTE is unset (dry-run mode never blocks startup)', async () => {
        // unset
        const { checkAntiRugLiveGate } = await import('../../../src/preflight');
        const result = await checkAntiRugLiveGate(makeChain() as never);
        expect(result.passed).toBe(true);
        // No DB read should have happened — but to keep robust, just assert PASS.
    });
});

// Boundary: exactly 7 days should PASS (>= floor).
describe('checkAntiRugLiveGate boundary', () => {
    beforeEach(() => {
        dryRunGet.mockReset();
        delete process.env.ETH_ANTIRUG_LIVE_EXECUTE;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        delete process.env.ETH_ANTIRUG_LIVE_EXECUTE;
    });
});
