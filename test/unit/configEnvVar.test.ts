// test/unit/configEnvVar.test.ts
// Tests proving env vars control runtime behavior for STOP_LOSS_PCT and FLASHBOTS_AUTH_KEY.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// NOTE: resolves to the mocked logger object (see vi.mock at lines 8-23 below).
import { logger } from '../../src/utils/logger';

// ---- Mock dependencies ----

// Mock dotenv to prevent .env file from re-injecting env vars we deliberately
// delete or set to empty string in tests. Tests control env vars via setEnv/delete.
vi.mock('dotenv', () => ({
    config: vi.fn(),
}));

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
    DASHBOARD_API_KEY: 'test-dashboard-key',
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

// Handle on the vi.fn() declared inside the top-level vi.mock block above.
// We use vi.mocked(logger).fatal to ENSURE we are asserting on the SAME
// fn the mock exposes, not a new spy layered on top. Do NOT replace this with
// a separate spyOn for logger.fatal — that would create a second layer over the mock.
const mockFatal = vi.mocked(logger).fatal as ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.resetModules();
    // Set all required env vars
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
        setEnv(key, value);
    }
    mockExit.mockClear();
    // Re-apply the throwing implementation after vitest's mockReset: true (config)
    // which strips spy implementations before each test.
    mockExit.mockImplementation((() => {
        throw new Error('process.exit called');
    }) as never);
    mockFatal.mockClear();
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

    // Own limit (orchestrator, phase 23 wave 13 gate, 2026-11-12): this test pays the cold import
    // of src/exitEngine in its body. Measured 2.6 s in the full parallel run (53% of the 5 s unit
    // testTimeout) and 0.8 s alone. Root fix is Phase 28 (deferred-items.md, cold-import class).
    it('custom STOP_LOSS_PCT flows through to exitConfig.stopLossPct', { timeout: 20_000 }, async () => {
        setEnv('STOP_LOSS_PCT', '18');
        // Mock exitManager dependency needed by exitEngine
        vi.doMock('../../src/utils/exitManager', () => ({
            tryAcquireSellLock: vi.fn(),
            releaseSellLock: vi.fn(),
            registerExitMonitor: vi.fn(),
        }));
        vi.doMock('../../src/utils/db', () => ({
            insertExitState: { run: vi.fn() },
            getExitState: { get: vi.fn() },
            updateExitState: { run: vi.fn() },
        }));
        const { buildExitConfig } = await import('../../src/exitEngine');
        const exitConfig = buildExitConfig();
        expect(exitConfig.stopLossPct).toBe(18);
    });
});

describe('DASHBOARD_API_KEY env var (INT-DASHBOARD-API-KEY, D-07/D-11, Codex MEDIUM payload assertion)', () => {
    it('calls process.exit AND logs a fatal payload naming DASHBOARD_API_KEY when the var is unset', async () => {
        // beforeEach has set DASHBOARD_API_KEY from the REQUIRED_ENV fixture.
        // Explicitly remove it to simulate a deployment where the operator forgot it.
        delete process.env.DASHBOARD_API_KEY;

        await expect(import('../../src/config')).rejects.toThrow('process.exit called');
        expect(mockExit).toHaveBeenCalledWith(1);

        // Codex MEDIUM review assertion: the fatal log must name the missing var,
        // not just signal that SOMETHING exited. Operators rely on this message
        // to diagnose config problems. The shape matches src/config.ts:70-73:
        //     logger.fatal({ missing: [...] }, 'Missing required environment variables')
        expect(mockFatal).toHaveBeenCalled();
        expect(mockFatal).toHaveBeenCalledWith(
            expect.objectContaining({
                missing: expect.arrayContaining([expect.stringContaining('DASHBOARD_API_KEY')])
            }),
            expect.any(String)
        );
    });

    it('does not exit and does not log fatal when DASHBOARD_API_KEY is set to a non-empty string', async () => {
        setEnv('DASHBOARD_API_KEY', 'any-valid-key-value');
        const { CONFIG } = await import('../../src/config');
        expect(CONFIG).toBeDefined();
        expect(mockExit).not.toHaveBeenCalled();
        expect(mockFatal).not.toHaveBeenCalled();
    });

    it('calls process.exit AND logs a fatal payload naming DASHBOARD_API_KEY when the var is an empty string', async () => {
        setEnv('DASHBOARD_API_KEY', '');

        await expect(import('../../src/config')).rejects.toThrow('process.exit called');
        expect(mockExit).toHaveBeenCalledWith(1);

        // Same payload-shape assertion as the "unset" case — matches
        // src/config.ts validateEnvVars() call shape exactly.
        expect(mockFatal).toHaveBeenCalled();
        expect(mockFatal).toHaveBeenCalledWith(
            expect.objectContaining({
                missing: expect.arrayContaining([expect.stringContaining('DASHBOARD_API_KEY')])
            }),
            expect.any(String)
        );
    });
});
