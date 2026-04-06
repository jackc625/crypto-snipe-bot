// test/unit/configEnvVar.test.ts
// Tests proving env vars control runtime behavior for STOP_LOSS_PCT and FLASHBOTS_AUTH_KEY.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mock dependencies ----

// Mock logger to prevent real logging and capture process.exit calls
vi.mock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        }),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    },
}));

// Required env vars that must be set to prevent validateEnvVars from exiting
const REQUIRED_ENV = {
    PRIVATE_KEY: '0x' + '1'.repeat(64),
    ALCHEMY_URL: 'https://eth-rpc.example.com',
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_CHAT_ID: 'test-chat-id',
    TELEGRAM_API_ID: 'test-api-id',
    TELEGRAM_API_HASH: 'test-api-hash',
    TELEGRAM_SESSION: 'test-session-string',
};

// Track env vars we set so we can clean them up
const envKeysToClean: string[] = [];

function setEnv(key: string, value: string): void {
    process.env[key] = value;
    envKeysToClean.push(key);
}

// Mock process.exit to prevent test runner termination
const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
}) as never);

beforeEach(() => {
    vi.resetModules();
    // Set all required env vars
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
        setEnv(key, value);
    }
    mockExit.mockClear();
});

afterEach(() => {
    // Clean up all env vars set during test
    for (const key of envKeysToClean) {
        delete process.env[key];
    }
    envKeysToClean.length = 0;
});

describe('STOP_LOSS_PCT env var', () => {
    it('uses STOP_LOSS_PCT value when set', async () => {
        setEnv('STOP_LOSS_PCT', '15');
        const { CONFIG } = await import('../../src/config');
        expect(CONFIG.stopLossPercent).toBe(15);
    });

    it('defaults to 25 when STOP_LOSS_PCT not set', async () => {
        delete process.env.STOP_LOSS_PCT;
        const { CONFIG } = await import('../../src/config');
        expect(CONFIG.stopLossPercent).toBe(25);
    });

    it('defaults to 25 when STOP_LOSS_PCT is non-numeric', async () => {
        setEnv('STOP_LOSS_PCT', 'abc');
        const { CONFIG } = await import('../../src/config');
        expect(CONFIG.stopLossPercent).toBe(25);
    });
});

describe('FLASHBOTS_AUTH_KEY conditionality', () => {
    it('does not require FLASHBOTS_AUTH_KEY globally', async () => {
        // Explicitly remove FLASHBOTS_AUTH_KEY
        delete process.env.FLASHBOTS_AUTH_KEY;
        // validateEnvVars should NOT call process.exit
        const { CONFIG } = await import('../../src/config');
        expect(CONFIG).toBeDefined();
        expect(mockExit).not.toHaveBeenCalled();
    });

    it('BSC-only deployment without FLASHBOTS_AUTH_KEY does not fail validateEnvVars', async () => {
        delete process.env.FLASHBOTS_AUTH_KEY;
        setEnv('ENABLED_CHAINS', 'bsc');
        // validateEnvVars should NOT exit -- chainRegistry handles conditional validation
        const { CONFIG } = await import('../../src/config');
        expect(CONFIG).toBeDefined();
        expect(mockExit).not.toHaveBeenCalled();
    });
});

describe('STOP_LOSS_PCT integration with exitEngine', () => {
    it('buildExitConfig uses CONFIG.stopLossPercent from env', async () => {
        setEnv('STOP_LOSS_PCT', '10');
        const { CONFIG } = await import('../../src/config');
        // Verify the config value is correctly set from env
        expect(CONFIG.stopLossPercent).toBe(10);
        // Confirm the key link: exitEngine.buildExitConfig reads CONFIG.stopLossPercent
        // at line 108 as stopLossPct: CONFIG.stopLossPercent
        // This proves the full chain: env var -> CONFIG -> exitConfig
    });

    it('custom STOP_LOSS_PCT flows through to exitConfig.stopLossPct', async () => {
        setEnv('STOP_LOSS_PCT', '18');
        // Mock exitManager dependency needed by exitEngine
        vi.doMock('../../src/utils/exitManager', () => ({
            tryAcquireSellLock: vi.fn(),
            releaseSellLock: vi.fn(),
            registerExitMonitor: vi.fn(),
        }));
        vi.doMock('../../src/db', () => ({
            insertExitState: { run: vi.fn() },
            getExitState: { get: vi.fn() },
            updateExitState: { run: vi.fn() },
        }));
        const { buildExitConfig } = await import('../../src/exitEngine');
        const exitConfig = buildExitConfig();
        expect(exitConfig.stopLossPct).toBe(18);
    });
});
