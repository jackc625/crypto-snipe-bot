// test/unit/mevStrategies/inclusionReconciliationConfig.test.ts
// Phase 21.1 Plan 21.1-01 / Task 2 — Wave-0 Nyquist RED stub file (config half).
//
// Failing-test contract (RED before GREEN; Phase 20-00 wave-0-stub pattern) for
// the FIVE new MEV env vars that the inclusion-reconciliation fix introduces
// (STOP-THE-LINE-02 / D-ENV-EXAMPLE [USER-BINDING]). One `it.skip` per var,
// asserting the var CONTROLS BEHAVIOR (not merely that it is present) — mirroring
// the env-var-controls-behavior idiom in test/unit/configEnvVar.test.ts.
//
// Every test is `it.skip` (skipped, NOT failing-red) so the Wave-0 commit keeps
// `npx vitest run --project unit` green-with-skips. Bodies are placeholders until
// the GREEN wave (plan 21.1-04 — the shared reconciliation helper + config) wires
// each var. D-04's no-hollow-fill rule applies to ENABLED tests, not skipped
// scaffolds.
//
// New vars (RESEARCH §Q7 recommended defaults; global / non-chain-prefixed,
// matching MID_RUN_CHECK_INTERVAL_SEC / STALE_WARN_SEC, NOT the per-chain ETH_*
// anti-rug pattern):
//   MEV_CONFIRM_WINDOW_MS     (default 45000) — bounded confirm-window to poll
//                              receipt+nonce before declaring not-landed.
//   MEV_CONFIRM_POLL_MS       (default 4000)  — poll interval within the window.
//   MEV_MAX_PRIORITY_FEE_GWEI (default 5)     — hard absolute ceiling on escalated
//                              maxPriorityFeePerGas (load-bearing safety cap).
//   MEV_PRIORITY_FEE_STEP_GWEI(default 1)     — per-retry priority-fee escalation
//                              step, clamped to ceiling + affordability bound.
//   MEV_RESERVE_SELL_GAS      (default true)  — when true, the affordability bound
//                              always reserves sellGasLimit×fee for the exit leg.
//
// Cited analog: test/unit/configEnvVar.test.ts — the dotenv mock, the logger
// mock, the REQUIRED_ENV fixture, setEnv/cleanup, and the
// `await import('../../src/config')` re-import idiom under vi.resetModules().

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dotenv so .env does not re-inject vars we deliberately set/delete.
vi.mock('dotenv', () => ({
    config: vi.fn(),
}));

// Mock logger to prevent real logging and capture process.exit fatal paths.
vi.mock('../../../src/utils/logger', () => ({
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

// Required env vars so validateEnvVars does not exit during config import.
const REQUIRED_ENV: Record<string, string> = {
    PRIVATE_KEY: '0x' + '1'.repeat(64),
    ALCHEMY_URL: 'https://eth-rpc.example.com',
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_CHAT_ID: 'test-chat-id',
    TELEGRAM_API_ID: 'test-api-id',
    TELEGRAM_API_HASH: 'test-api-hash',
    TELEGRAM_SESSION: 'test-session-string',
    DASHBOARD_API_KEY: 'test-dashboard-key',
};

const envKeysToClean: string[] = [];

function setEnv(key: string, value: string): void {
    process.env[key] = value;
    envKeysToClean.push(key);
}

const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
}) as never);

beforeEach(() => {
    vi.resetModules();
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
        setEnv(key, value);
    }
    mockExit.mockClear();
    mockExit.mockImplementation((() => {
        throw new Error('process.exit called');
    }) as never);
});

afterEach(() => {
    for (const key of envKeysToClean) {
        delete process.env[key];
    }
    envKeysToClean.length = 0;
});

// Reference the harness so tsc/lint stay clean while every test is skipped.
void setEnv;
void mockExit;

// A representative per-chain sell gas limit (ETH template: ctx.chain.gas.maxGasLimit).
const SELL_GAS_LIMIT = 300_000n;

// Lazily import config (proves it loads with the var registered, no validateEnvVars
// exit) THEN the helper's env reader, and return the parsed ReconcileConfig. Mirrors
// configEnvVar.test.ts's `await import('../../src/config')` idiom under
// vi.resetModules(). buildReconcileConfig is the single point env vars are parsed
// into the helper config, so asserting its output proves the var CONTROLS behavior
// (D-04 observable effect), not mere presence.
async function loadReconcileConfig() {
    const { CONFIG } = await import('../../../src/config');
    expect(CONFIG).toBeDefined(); // config imported cleanly (var registered, no exit)
    expect(mockExit).not.toHaveBeenCalled();
    const { buildReconcileConfig } = await import('../../../src/utils/mevStrategies/reconciliation');
    return buildReconcileConfig(process.env, SELL_GAS_LIMIT);
}

// =============================================================================
// Each test asserts the var CONTROLS BEHAVIOR (RESEARCH §Q7 / Wave-0 gap 2):
// the parsed value flows into the ReconcileConfig the shared helper consumes —
// override vs default. GREEN form landed by plan 21.1-02 (config plumbing).
// =============================================================================

describe('MEV_CONFIRM_WINDOW_MS env var', () => {
    it('controls the confirm-window the reconciliation polls before declaring not-landed (override)', async () => {
        setEnv('MEV_CONFIRM_WINDOW_MS', '12345');
        const cfg = await loadReconcileConfig();
        expect(cfg.confirmWindowMs).toBe(12345);
    });

    it('defaults to 45000 when MEV_CONFIRM_WINDOW_MS is unset', async () => {
        delete process.env.MEV_CONFIRM_WINDOW_MS;
        const cfg = await loadReconcileConfig();
        expect(cfg.confirmWindowMs).toBe(45000);
    });
});

describe('MEV_CONFIRM_POLL_MS env var', () => {
    it('controls the poll interval within the confirm-window (override)', async () => {
        setEnv('MEV_CONFIRM_POLL_MS', '2500');
        const cfg = await loadReconcileConfig();
        expect(cfg.pollMs).toBe(2500);
    });

    it('defaults to 4000 when MEV_CONFIRM_POLL_MS is unset', async () => {
        delete process.env.MEV_CONFIRM_POLL_MS;
        const cfg = await loadReconcileConfig();
        expect(cfg.pollMs).toBe(4000);
    });
});

describe('MEV_MAX_PRIORITY_FEE_GWEI env var', () => {
    it('controls the hard ceiling (wei) on escalated maxPriorityFeePerGas (override)', async () => {
        const { parseUnits } = await import('ethers');
        setEnv('MEV_MAX_PRIORITY_FEE_GWEI', '9');
        const cfg = await loadReconcileConfig();
        // The parsed gwei ceiling becomes the load-bearing wei cap the fee escalation clamps to.
        expect(cfg.maxPriorityFeeCeilingWei).toBe(parseUnits('9', 'gwei'));
    });

    it('defaults to 5 gwei when MEV_MAX_PRIORITY_FEE_GWEI is unset', async () => {
        const { parseUnits } = await import('ethers');
        delete process.env.MEV_MAX_PRIORITY_FEE_GWEI;
        const cfg = await loadReconcileConfig();
        expect(cfg.maxPriorityFeeCeilingWei).toBe(parseUnits('5', 'gwei'));
    });
});

describe('MEV_PRIORITY_FEE_STEP_GWEI env var', () => {
    it('controls the per-retry priority-fee escalation step (wei) (override)', async () => {
        const { parseUnits } = await import('ethers');
        setEnv('MEV_PRIORITY_FEE_STEP_GWEI', '2');
        const cfg = await loadReconcileConfig();
        expect(cfg.priorityFeeStepWei).toBe(parseUnits('2', 'gwei'));
    });

    it('defaults to 1 gwei when MEV_PRIORITY_FEE_STEP_GWEI is unset', async () => {
        const { parseUnits } = await import('ethers');
        delete process.env.MEV_PRIORITY_FEE_STEP_GWEI;
        const cfg = await loadReconcileConfig();
        expect(cfg.priorityFeeStepWei).toBe(parseUnits('1', 'gwei'));
    });
});

describe('MEV_RESERVE_SELL_GAS env var', () => {
    it('toggles the affordability sell-gas reserve OFF when set to "false"', async () => {
        setEnv('MEV_RESERVE_SELL_GAS', 'false');
        const cfg = await loadReconcileConfig();
        expect(cfg.reserveSellGas).toBe(false);
    });

    it('defaults to true (reserve ON) when MEV_RESERVE_SELL_GAS is unset', async () => {
        delete process.env.MEV_RESERVE_SELL_GAS;
        const cfg = await loadReconcileConfig();
        expect(cfg.reserveSellGas).toBe(true);
    });
});
