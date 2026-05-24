// Phase 20 / Plan 20-02 / OPS-LIVE-07 — Live tests for validateCrossEnvRules.
//
// Centralized cross-variable env validation. Each test snapshots/restores
// process.env so per-test mutations don't leak.

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

// Baseline env: clear out every Phase-20 cross-variable input so each test
// sets exactly what it needs.
const CROSS_ENV_KEYS = [
    'MEV_STRATEGY',
    'FLASHBOTS_AUTH_KEY',
    'ENABLED_CHAINS',
    'BLOXROUTE_AUTH_HEADER',
    'TELEGRAM_API_ID',
    'TELEGRAM_API_HASH',
    'TELEGRAM_SESSION',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'ETH_RPC_URL',
    'BSC_RPC_URL',
    'BASE_RPC_URL',
    'ARB_RPC_URL',
] as const;

let savedEnv: Record<string, string | undefined>;

describe('validateCrossEnvRules', () => {
    beforeEach(() => {
        savedEnv = {};
        for (const key of CROSS_ENV_KEYS) {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
        for (const key of CROSS_ENV_KEYS) {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        }
    });

    it('fails (1 violation) when MEV_STRATEGY=flashbots and FLASHBOTS_AUTH_KEY unset', async () => {
        process.env.ENABLED_CHAINS = 'eth';
        process.env.ETH_RPC_URL = 'https://example';
        process.env.MEV_STRATEGY = 'flashbots';
        // FLASHBOTS_AUTH_KEY intentionally unset
        const { validateCrossEnvRules } = await import('../../../src/preflight');
        const results = validateCrossEnvRules();
        const flashbotsViolation = results.find(
            r => r.passed === false && /FLASHBOTS_AUTH_KEY/.test(r.reason || ''),
        );
        expect(flashbotsViolation).toBeDefined();
        expect(flashbotsViolation?.check).toBe('cross-env-rule');
    });

    it('fails when ENABLED_CHAINS includes bsc but BLOXROUTE_AUTH_HEADER unset', async () => {
        process.env.ENABLED_CHAINS = 'eth,bsc';
        process.env.ETH_RPC_URL = 'https://eth';
        process.env.BSC_RPC_URL = 'https://bsc';
        process.env.FLASHBOTS_AUTH_KEY = 'k';
        const { validateCrossEnvRules } = await import('../../../src/preflight');
        const results = validateCrossEnvRules();
        const bloxrouteViolation = results.find(
            r => r.passed === false && /BLOXROUTE_AUTH_HEADER/.test(r.reason || ''),
        );
        expect(bloxrouteViolation).toBeDefined();
    });

    it('fails when TELEGRAM_API_ID set but 5-tuple incomplete (missing BOT_TOKEN + CHAT_ID)', async () => {
        process.env.ENABLED_CHAINS = 'eth';
        process.env.ETH_RPC_URL = 'https://eth';
        process.env.FLASHBOTS_AUTH_KEY = 'k';
        process.env.TELEGRAM_API_ID = 'id';
        process.env.TELEGRAM_API_HASH = 'hash';
        process.env.TELEGRAM_SESSION = 'session';
        // TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID intentionally absent
        const { validateCrossEnvRules } = await import('../../../src/preflight');
        const results = validateCrossEnvRules();
        const telegramViolation = results.find(
            r => r.passed === false && /TELEGRAM_API_ID/.test(r.reason || ''),
        );
        expect(telegramViolation).toBeDefined();
        // Reason should name the missing fields
        expect(telegramViolation?.reason).toMatch(/BOT_TOKEN/);
        expect(telegramViolation?.reason).toMatch(/CHAT_ID/);
    });

    it('fails when per-chain ETH_RPC_URL missing for enabled chain', async () => {
        process.env.ENABLED_CHAINS = 'eth';
        process.env.FLASHBOTS_AUTH_KEY = 'k';
        // ETH_RPC_URL intentionally unset
        const { validateCrossEnvRules } = await import('../../../src/preflight');
        const results = validateCrossEnvRules();
        const rpcViolation = results.find(
            r => r.passed === false && /ETH_RPC_URL/.test(r.reason || ''),
        );
        expect(rpcViolation).toBeDefined();
    });

    it('returns no violations when all rules satisfied', async () => {
        process.env.ENABLED_CHAINS = 'eth';
        process.env.ETH_RPC_URL = 'https://eth';
        process.env.FLASHBOTS_AUTH_KEY = 'k';
        process.env.MEV_STRATEGY = 'flashbots';
        process.env.TELEGRAM_API_ID = 'id';
        process.env.TELEGRAM_API_HASH = 'hash';
        process.env.TELEGRAM_SESSION = 'session';
        process.env.TELEGRAM_BOT_TOKEN = 'tok';
        process.env.TELEGRAM_CHAT_ID = '123';
        const { validateCrossEnvRules } = await import('../../../src/preflight');
        const results = validateCrossEnvRules();
        const failed = results.filter(r => !r.passed);
        expect(failed).toEqual([]);
    });

    it('beforeEach baseline reset prevents test bleed (re-runs cross-env-rule with fresh env)', async () => {
        // This test sets only the absolute minimum; if the previous all-pass test
        // bled env into this one, we'd unexpectedly pass. Demonstrate isolation.
        process.env.ENABLED_CHAINS = 'eth';
        // ETH_RPC_URL absent → should produce a violation
        const { validateCrossEnvRules } = await import('../../../src/preflight');
        const results = validateCrossEnvRules();
        const rpcViolation = results.find(
            r => r.passed === false && /ETH_RPC_URL/.test(r.reason || ''),
        );
        expect(rpcViolation).toBeDefined();
    });
});
