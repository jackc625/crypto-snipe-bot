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
//
// `leg` selects which priority-fee ceiling feeds maxPriorityFeeCeilingWei:
//   'buy'  → MEV_MAX_PRIORITY_FEE_GWEI      (default 5, unchanged)
//   'sell' → MEV_SELL_MAX_PRIORITY_FEE_GWEI (default 25, Finding A independent ceiling)
// The default (no leg) is 'buy' so the 3 existing strategy callers are unaffected.
async function loadReconcileConfig(leg?: 'buy' | 'sell') {
    const { CONFIG } = await import('../../../src/config');
    expect(CONFIG).toBeDefined(); // config imported cleanly (var registered, no exit)
    expect(mockExit).not.toHaveBeenCalled();
    const { buildReconcileConfig } = await import('../../../src/utils/mevStrategies/reconciliation');
    return buildReconcileConfig(process.env, SELL_GAS_LIMIT, 3, leg);
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

describe('Buy-leg priority-fee ceiling (default leg)', () => {
    // 21.3 D-PRIVATE-INCLUSION-HARDEN mech 3: the buy leg now reads its own
    // independent ceiling MEV_BUY_MAX_PRIORITY_FEE_GWEI (default 25). The legacy
    // MEV_MAX_PRIORITY_FEE_GWEI is no longer the buy ceiling (kept only as a
    // documented backward-compat floor reference). Detailed buy-ceiling cases live
    // in the dedicated MEV_BUY_MAX_PRIORITY_FEE_GWEI describe below; these two keep
    // the original "controls the parsed wei ceiling" contract on the default leg.
    it('controls the hard ceiling (wei) on escalated maxPriorityFeePerGas (override via MEV_BUY_MAX_PRIORITY_FEE_GWEI)', async () => {
        const { parseUnits } = await import('ethers');
        setEnv('MEV_BUY_MAX_PRIORITY_FEE_GWEI', '9');
        const cfg = await loadReconcileConfig();
        // The parsed gwei ceiling becomes the load-bearing wei cap the fee escalation clamps to.
        expect(cfg.maxPriorityFeeCeilingWei).toBe(parseUnits('9', 'gwei'));
    });

    it('defaults to 25 gwei when MEV_BUY_MAX_PRIORITY_FEE_GWEI is unset (the 21.3 raised default)', async () => {
        const { parseUnits } = await import('ethers');
        delete process.env.MEV_BUY_MAX_PRIORITY_FEE_GWEI;
        const cfg = await loadReconcileConfig();
        expect(cfg.maxPriorityFeeCeilingWei).toBe(parseUnits('25', 'gwei'));
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

// =============================================================================
// Phase 21.2 Plan 04 / Finding A — independent SELL-leg priority-fee ceiling
// (MEV_SELL_MAX_PRIORITY_FEE_GWEI, default 25) decoupled from the BUY ceiling
// (MEV_MAX_PRIORITY_FEE_GWEI, default 5), and the reserve retargeted to the
// GUARANTEED public-exit gas (normal-priced) instead of the private CEILING
// priority fee. CRITICAL invariant (Pitfall 5): the higher sell ceiling raises
// the ceiling INPUT only — computeAffordablePriorityFee's affordability bound
// STILL clamps the final bid (try harder privately, NEVER overspend).
//
// These hermetic env pins (MEV_MAX_PRIORITY_FEE_GWEI=5 / sell=25) keep the
// assertions independent of the operator's real .env (mirrors the pre-wave
// hardening in inclusionReconciliation.test.ts / gasMultiplier.test.ts).
// =============================================================================

describe('MEV_SELL_MAX_PRIORITY_FEE_GWEI env var (Finding A — independent sell ceiling)', () => {
    it('Test 1 — sell leg uses the SELL ceiling (25 gwei) when MEV_SELL_MAX_PRIORITY_FEE_GWEI=25', async () => {
        const { parseUnits } = await import('ethers');
        setEnv('MEV_SELL_MAX_PRIORITY_FEE_GWEI', '25');
        setEnv('MEV_MAX_PRIORITY_FEE_GWEI', '5'); // pin the buy ceiling for hermeticity
        const cfg = await loadReconcileConfig('sell');
        // The sell leg reads its OWN ceiling, NOT the 5-gwei buy ceiling (the Finding A trap).
        expect(cfg.maxPriorityFeeCeilingWei).toBe(parseUnits('25', 'gwei'));
        expect(cfg.maxPriorityFeeCeilingWei).not.toBe(parseUnits('5', 'gwei'));
    });

    it('Test 5 — sell ceiling defaults to 25 gwei when MEV_SELL_MAX_PRIORITY_FEE_GWEI is unset', async () => {
        const { parseUnits } = await import('ethers');
        delete process.env.MEV_SELL_MAX_PRIORITY_FEE_GWEI;
        const cfg = await loadReconcileConfig('sell');
        expect(cfg.maxPriorityFeeCeilingWei).toBe(parseUnits('25', 'gwei'));
    });

    it('respects an operator override of the sell ceiling (e.g. 40 gwei)', async () => {
        const { parseUnits } = await import('ethers');
        setEnv('MEV_SELL_MAX_PRIORITY_FEE_GWEI', '40');
        const cfg = await loadReconcileConfig('sell');
        expect(cfg.maxPriorityFeeCeilingWei).toBe(parseUnits('40', 'gwei'));
    });
});

// =============================================================================
// Phase 21.3 Plan 01 / D-PRIVATE-INCLUSION-HARDEN mech 3 — the BUY leg now reads
// its OWN independent ceiling MEV_BUY_MAX_PRIORITY_FEE_GWEI (default 25), decoupled
// from BOTH the legacy MEV_MAX_PRIORITY_FEE_GWEI (default 5, backward-compat floor
// reference) and the sell ceiling. CRITICAL invariant (Pitfall 5 / CR-01): the
// higher buy ceiling raises the ceiling INPUT only — computeAffordablePriorityFee's
// affordability bound STILL clamps the final bid (try harder, never overspend).
// =============================================================================

describe('MEV_BUY_MAX_PRIORITY_FEE_GWEI env var (21.3 — independent higher buy ceiling)', () => {
    it('(a) buy ceiling defaults to 25 gwei when MEV_BUY_MAX_PRIORITY_FEE_GWEI is unset', async () => {
        const { parseUnits } = await import('ethers');
        delete process.env.MEV_BUY_MAX_PRIORITY_FEE_GWEI;
        setEnv('MEV_MAX_PRIORITY_FEE_GWEI', '5'); // legacy floor pinned — must NOT be the ceiling
        const cfg = await loadReconcileConfig('buy');
        expect(cfg.maxPriorityFeeCeilingWei).toBe(parseUnits('25', 'gwei'));
        // The new default is the INDEPENDENT 25, NOT the legacy 5-gwei cap (the 21.3 trap).
        expect(cfg.maxPriorityFeeCeilingWei).not.toBe(parseUnits('5', 'gwei'));
    });

    it('(b) respects an operator override of the buy ceiling (MEV_BUY_MAX_PRIORITY_FEE_GWEI=40)', async () => {
        const { parseUnits } = await import('ethers');
        setEnv('MEV_BUY_MAX_PRIORITY_FEE_GWEI', '40');
        const cfg = await loadReconcileConfig('buy');
        expect(cfg.maxPriorityFeeCeilingWei).toBe(parseUnits('40', 'gwei'));
    });

    it('(c) a malformed/negative MEV_BUY_MAX_PRIORITY_FEE_GWEI falls back to 25 (never-NaN/never-negative)', async () => {
        const { parseUnits } = await import('ethers');
        setEnv('MEV_BUY_MAX_PRIORITY_FEE_GWEI', '-7'); // negative → rejected by parsePositiveNumber
        const cfgNeg = await loadReconcileConfig('buy');
        expect(cfgNeg.maxPriorityFeeCeilingWei).toBe(parseUnits('25', 'gwei'));

        setEnv('MEV_BUY_MAX_PRIORITY_FEE_GWEI', 'not-a-number'); // NaN → rejected
        const cfgNaN = await loadReconcileConfig('buy');
        expect(cfgNaN.maxPriorityFeeCeilingWei).toBe(parseUnits('25', 'gwei'));
    });

    it('the default leg (no leg arg) is the BUY leg — the 3 existing strategy callers read the 25-gwei buy ceiling', async () => {
        const { parseUnits } = await import('ethers');
        delete process.env.MEV_BUY_MAX_PRIORITY_FEE_GWEI; // default 25
        setEnv('MEV_SELL_MAX_PRIORITY_FEE_GWEI', '25');
        const cfg = await loadReconcileConfig(); // no leg → 'buy'
        expect(cfg.maxPriorityFeeCeilingWei).toBe(parseUnits('25', 'gwei'));
    });

    it('the buy ceiling is INDEPENDENT of the legacy MEV_MAX_PRIORITY_FEE_GWEI and the sell ceiling', async () => {
        const { parseUnits } = await import('ethers');
        setEnv('MEV_BUY_MAX_PRIORITY_FEE_GWEI', '30');
        setEnv('MEV_MAX_PRIORITY_FEE_GWEI', '5'); // legacy floor — must NOT leak into the buy ceiling
        setEnv('MEV_SELL_MAX_PRIORITY_FEE_GWEI', '25'); // sell ceiling — must NOT leak either
        const cfg = await loadReconcileConfig('buy');
        expect(cfg.maxPriorityFeeCeilingWei).toBe(parseUnits('30', 'gwei'));
        expect(cfg.maxPriorityFeeCeilingWei).not.toBe(parseUnits('5', 'gwei'));
        expect(cfg.maxPriorityFeeCeilingWei).not.toBe(parseUnits('25', 'gwei'));
    });
});

describe('(d) the affordability clamp STILL binds on a thin wallet (the buy raise is INPUT-only — CR-01 not regressed)', () => {
    it('submitted fee = the affordability bound, NOT the raised 25-gwei buy ceiling', async () => {
        const { parseUnits } = await import('ethers');
        const { computeAffordablePriorityFee } = await import(
            '../../../src/utils/mevStrategies/reconciliation'
        );

        // Buy ceiling = 25 gwei (the new raised default). Desired fee absurdly high.
        const buyCeilingWei = parseUnits('25', 'gwei');
        const baseFeeWei = parseUnits('2', 'gwei');
        const buyGasLimit = 200_000n;
        const sellGasLimit = 300_000n;
        const snipeValueWei = 0n;

        // Construct a THIN wallet whose affordability bound is EXACTLY 6 gwei so the
        // clamp (min(ceiling, bound)) must return 6 gwei, NOT the raised 25 ceiling.
        // Reserve = GUARANTEED public exit (sellGasLimit × baseFee×buffer), NO ceiling.
        const SELL_GAS_BASEFEE_BUFFER = 150n; // 1.5x, fractional-bigint /100n
        const bufferedSellBaseFee = (baseFeeWei * SELL_GAS_BASEFEE_BUFFER) / 100n;
        const reservedSellGas = sellGasLimit * bufferedSellBaseFee;
        const wantBoundWei = parseUnits('6', 'gwei');
        const headroom = wantBoundWei * buyGasLimit;
        const walletBalanceWei = headroom + snipeValueWei + reservedSellGas + buyGasLimit * baseFeeWei;

        const result = computeAffordablePriorityFee({
            desiredPriorityFeeWei: parseUnits('250', 'gwei'), // 10x the 25-gwei ceiling
            ceilingWei: buyCeilingWei,
            walletBalanceWei,
            snipeValueWei,
            baseFeeWei,
            buyGasLimit,
            sellGasLimit,
            reserveSellGas: true,
        });

        expect(result.affordable).toBe(true);
        // The affordability bound — NOT the raised 25-gwei buy ceiling — wins.
        expect(result.affordabilityBoundWei).toBe(wantBoundWei);
        expect(result.priorityFeeWei).toBe(wantBoundWei);
        // Hard proof of "never overspend": the submitted fee is below the raised ceiling.
        expect(result.priorityFeeWei < buyCeilingWei).toBe(true);
        expect(result.priorityFeeWei).not.toBe(buyCeilingWei);
    });
});

describe('Test 3 — affordability bound STILL binds at a 10x market rate (try harder, never overspend)', () => {
    it('clamps a 25-gwei sell ceiling down to the affordable 8-gwei bound', async () => {
        const { parseUnits, parseEther } = await import('ethers');
        const { computeAffordablePriorityFee } = await import(
            '../../../src/utils/mevStrategies/reconciliation'
        );

        // Sell ceiling = 25 gwei; desired (escalated/market) fee absurdly high (10x).
        const sellCeilingWei = parseUnits('25', 'gwei');
        const baseFeeWei = parseUnits('2', 'gwei');
        const buyGasLimit = 200_000n;
        const sellGasLimit = 300_000n;
        const snipeValueWei = 0n;

        // Construct a wallet balance whose affordability bound is EXACTLY 8 gwei so
        // the clamp (min(ceiling, bound)) must return 8 gwei, NOT the 25 ceiling and
        // NOT the absurd 10x desired. With reserveSellGas the internal reserve is the
        // GUARANTEED public exit (sellGasLimit × baseFee×buffer) — NO private ceiling.
        const SELL_GAS_BASEFEE_BUFFER = 150n; // 1.5x, fractional-bigint /100n
        const bufferedSellBaseFee = (baseFeeWei * SELL_GAS_BASEFEE_BUFFER) / 100n;
        const reservedSellGas = sellGasLimit * bufferedSellBaseFee; // public-exit reserve (no ceiling)
        const wantBoundWei = parseUnits('8', 'gwei');
        // headroom = bound × buyGasLimit; walletBalance = headroom + snipe + reserve + buyGasLimit×baseFee
        const headroom = wantBoundWei * buyGasLimit;
        const walletBalanceWei = headroom + snipeValueWei + reservedSellGas + buyGasLimit * baseFeeWei;

        const result = computeAffordablePriorityFee({
            desiredPriorityFeeWei: parseUnits('250', 'gwei'), // 10x the 25-gwei ceiling
            ceilingWei: sellCeilingWei,
            walletBalanceWei,
            snipeValueWei,
            baseFeeWei,
            buyGasLimit,
            sellGasLimit,
            reserveSellGas: true,
        });

        expect(result.affordable).toBe(true);
        // The affordability bound — NOT the 25-gwei ceiling, NOT the 250-gwei desire — wins.
        expect(result.affordabilityBoundWei).toBe(wantBoundWei);
        expect(result.priorityFeeWei).toBe(wantBoundWei);
        // Hard proof of "never overspend": the submitted fee is below BOTH the
        // sell ceiling and the 10x market desire.
        expect(result.priorityFeeWei < sellCeilingWei).toBe(true);
        expect(result.priorityFeeWei < parseUnits('250', 'gwei')).toBe(true);
        // Sanity: parseEther import exercised (keeps the helper honest about wei math).
        void parseEther;
    });
});

describe('Test 4 — reserve targets the GUARANTEED public exit, NOT the private ceiling', () => {
    it('computePublicExitReserveWei = sellGasLimit × baseFee×buffer (+ approval), with NO private priority-fee ceiling term', async () => {
        const { parseUnits } = await import('ethers');
        const { computePublicExitReserveWei, SELL_GAS_BASEFEE_BUFFER } = await import(
            '../../../src/utils/mevStrategies/reconciliation'
        );

        const baseFeeWei = parseUnits('20', 'gwei');
        const sellGasLimit = 300_000n;
        const ceilingWei = parseUnits('25', 'gwei'); // the private ceiling — must NOT appear in the reserve

        // The public-exit reserve is a NORMAL-PRICED tx: sellGasLimit × (baseFee × buffer).
        // applyGasMultiplier does fee × round(buffer×100) / 100n (no float drift).
        const bufferedSellBaseFee = (baseFeeWei * BigInt(Math.round(SELL_GAS_BASEFEE_BUFFER * 100))) / 100n;
        const expectedPublicExit = sellGasLimit * bufferedSellBaseFee;

        const reserve = computePublicExitReserveWei({ baseFeeWei, sellGasLimit });
        expect(reserve).toBe(expectedPublicExit);

        // Proof it does NOT use the private-ceiling math (the over-reserving Finding A bug):
        const privateCeilingReserve = sellGasLimit * (bufferedSellBaseFee + ceilingWei);
        expect(reserve).not.toBe(privateCeilingReserve);
        expect(reserve < privateCeilingReserve).toBe(true);
    });

    it('includes a one-time approval gas leg when approvalGasLimit is supplied (entry-gate use)', async () => {
        const { parseUnits } = await import('ethers');
        const { computePublicExitReserveWei, SELL_GAS_BASEFEE_BUFFER } = await import(
            '../../../src/utils/mevStrategies/reconciliation'
        );

        const baseFeeWei = parseUnits('20', 'gwei');
        const sellGasLimit = 300_000n;
        const approvalGasLimit = 50_000n;

        const bufferedSellBaseFee = (baseFeeWei * BigInt(Math.round(SELL_GAS_BASEFEE_BUFFER * 100))) / 100n;
        const expected = (sellGasLimit + approvalGasLimit) * bufferedSellBaseFee;

        const reserve = computePublicExitReserveWei({ baseFeeWei, sellGasLimit, approvalGasLimit });
        expect(reserve).toBe(expected);
    });

    it('computeAffordablePriorityFee internally reserves the public-exit gas (more headroom than the old ceiling reserve)', async () => {
        const { parseUnits } = await import('ethers');
        const { computeAffordablePriorityFee, computePublicExitReserveWei } = await import(
            '../../../src/utils/mevStrategies/reconciliation'
        );

        const ceilingWei = parseUnits('25', 'gwei');
        const baseFeeWei = parseUnits('20', 'gwei');
        const buyGasLimit = 200_000n;
        const sellGasLimit = 300_000n;
        const snipeValueWei = 0n;
        const walletBalanceWei = parseUnits('1', 'ether');

        const result = computeAffordablePriorityFee({
            desiredPriorityFeeWei: parseUnits('1000', 'gwei'), // absurd → bound binds
            ceilingWei,
            walletBalanceWei,
            snipeValueWei,
            baseFeeWei,
            buyGasLimit,
            sellGasLimit,
            reserveSellGas: true,
        });

        // The affordability bound must be computed against the PUBLIC-exit reserve.
        const publicReserve = computePublicExitReserveWei({ baseFeeWei, sellGasLimit });
        const expectedBound = (walletBalanceWei - snipeValueWei - publicReserve - buyGasLimit * baseFeeWei) / buyGasLimit;
        expect(result.affordabilityBoundWei).toBe(expectedBound);
    });
});
