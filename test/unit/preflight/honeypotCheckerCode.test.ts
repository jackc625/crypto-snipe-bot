// Phase 20 / Plan 20-02 / OPS-LIVE-05 — Live tests for checkHoneypotCheckerCode.

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

vi.mock('../../../src/utils/db', () => ({
    getAntirugDryRunStarted: { get: vi.fn(() => undefined) },
    db: {},
}));

interface MockProvider {
    getCode: ReturnType<typeof vi.fn>;
}

function makeChain(deployedAddress: string | null, provider: MockProvider) {
    return {
        name: 'eth',
        nativeCurrency: 'ETH',
        snipeAmount: '0.003',
        gasBuffer: '0.005',
        chainId: 1,
        blockAgeToleranceSec: 300,
        envPrefix: 'ETH',
        mevStrategy: 'flashbots' as const,
        honeypotChecker: { deployedAddress },
        wallet: { address: '0x' + 'b'.repeat(40) },
        httpProvider: provider,
    };
}

describe('checkHoneypotCheckerCode', () => {
    beforeEach(() => {
        // nothing per test
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fails when httpProvider.getCode(deployedAddress) returns 0x with remediation pointer to docs/operations/going-live.md', async () => {
        const provider: MockProvider = {
            getCode: vi.fn().mockResolvedValue('0x'),
        };
        const chain = makeChain('0x' + 'a'.repeat(40), provider);
        const { checkHoneypotCheckerCode } = await import('../../../src/preflight');
        const result = await checkHoneypotCheckerCode(chain as never);
        expect(result.passed).toBe(false);
        expect(result.check).toBe('honeypot-checker-code');
        expect(result.details?.code).toBe('0x');
        expect(result.details?.address).toBe('0x' + 'a'.repeat(40));
        expect(result.reason).toMatch(/docs\/operations\/going-live\.md/);
    });

    it('passes when httpProvider.getCode(deployedAddress) returns non-empty bytecode (0x6080604052...)', async () => {
        const provider: MockProvider = {
            getCode: vi.fn().mockResolvedValue('0x6080604052348015600f57600080fd5b50'),
        };
        const chain = makeChain('0x' + 'a'.repeat(40), provider);
        const { checkHoneypotCheckerCode } = await import('../../../src/preflight');
        const result = await checkHoneypotCheckerCode(chain as never);
        expect(result.passed).toBe(true);
        expect(result.check).toBe('honeypot-checker-code');
    });

    it('fails when chainRegistry resolves honeypotChecker.deployedAddress === null', async () => {
        const provider: MockProvider = {
            getCode: vi.fn(),
        };
        const chain = makeChain(null, provider);
        const { checkHoneypotCheckerCode } = await import('../../../src/preflight');
        const result = await checkHoneypotCheckerCode(chain as never);
        expect(result.passed).toBe(false);
        expect(result.check).toBe('honeypot-checker-code');
        // getCode must NOT have been invoked since address is null
        expect(provider.getCode).not.toHaveBeenCalled();
    });
});
