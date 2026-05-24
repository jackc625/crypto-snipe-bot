// test/unit/chainRegistry/antiRugConfig.test.ts
// Phase 19 plan 19-02 — ChainConfig.antiRug field + env overlay + fail-loud
// validation + hardcoded V2/V3 locker allowlist constants + .env.example
// alignment (per D-ENV-EXAMPLE [USER-BINDING]).
//
// Test plan (25 tests total):
//   Task 1 (chainRegistry.ts shape):
//     1.  ETH antiRug.liveExecute === false default (dry-run per D-LIVE-PER-CHAIN)
//     2.  ETH antiRug.lpRemovalPct === 50 default
//     3.  ETH antiRug.backfillCapBlocks === 10; BSC/BASE/ARB === 500 (RESEARCH CRITICAL #1)
//     4.  ETH antiRug.gasMultiplier === 2.0 default
//     5.  ETH_ANTIRUG_LP_REMOVAL_PCT=75 overrides to 75
//     6.  ETH_ANTIRUG_LP_REMOVAL_PCT=150 (>100) → FATAL exit
//     7.  ETH_ANTIRUG_LP_REMOVAL_PCT=abc (NaN) → FATAL exit
//     8.  ETH_ANTIRUG_LIVE_EXECUTE=true → liveExecute=true; non-strict 'TRUE'/'1'/undefined → false
//     9.  ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS=0 (<1) → FATAL exit
//     10. ETH_ANTIRUG_GAS_MULTIPLIER=0.5 (<1.0) → FATAL exit
//     11. ETH_ANTIRUG_BACKFILL_CAP_BLOCKS > MAX (100000) → FATAL exit
//     12. ETH_ANTIRUG_MAX_BACKFILL_BLOCKS < BACKFILL_CAP_BLOCKS → FATAL exit
//     13. ETH allowlistV2 includes UNCX UniLockerV2 ETH + TeamFinance ETH + PinkLock V2 ETH + 0xdEaD
//     14. ETH allowlistV3 includes UNCX V3 Locker ETH
//     15. BSC allowlistV2 includes UNCX UniLockerV2 BSC + PinkLock V2 BSC; BSC allowlistV3 includes UNCX V3 Locker BSC
//     16. Arbitrum allowlistV3 includes BOTH UNCX V3 Locker Arb AND UNCX V3 Proof-of-Reserves 2 Arb (ANTIRUG-15)
//     17. ETH_ANTIRUG_ALLOWLIST_EXTRA=0x...,0x... merges into BOTH allowlistV2 AND allowlistV3
//     18. All hardcoded allowlist addresses are checksummed per ethers.getAddress()
//
//   Task 2 (config.ts + .env.example):
//     19. REQUIRED_ENV_VARS has >= 32 entries matching /^[A-Z]+_ANTIRUG_/
//     20. Every new entry has required: false
//     21. Every new entry has non-empty description
//     22. .env.example contains '# Anti-Rug Runtime Monitoring (Phase 19)' header
//     23. .env.example contains every <CHAIN>_ANTIRUG_* var with =<default> + # description
//     24. .env.example ANTIRUG_LIVE_EXECUTE lines default to false AND have 'dry-run' in inline comment
//     25. .env.example ETH_ANTIRUG_BACKFILL_CAP_BLOCKS=10 (Alchemy-cited); BSC/BASE/ARB=500
//
// Pattern: same env-mocking + vi.resetModules() as existing chainRegistry.test.ts,
// plus vi.spyOn(process, 'exit') for fail-loud paths (same pattern as the
// chainRegistry.test.ts Test 6/7/8 honeypot tax-threshold fail-loud tests).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';

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
        fatal: vi.fn(),
    },
}));

vi.mock('../../../src/utils/provider', () => ({
    getProvider: vi.fn(() => ({})),
    getWsProvider: vi.fn(() => null),
}));

const ANTIRUG_ENV_KEYS = [
    'ETH_ANTIRUG_LIVE_EXECUTE',
    'ETH_ANTIRUG_LP_REMOVAL_PCT',
    'ETH_ANTIRUG_CONFIRM_BLOCKS',
    'ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS',
    'ETH_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS',
    'ETH_ANTIRUG_GAS_MULTIPLIER',
    'ETH_ANTIRUG_BACKFILL_CAP_BLOCKS',
    'ETH_ANTIRUG_MAX_BACKFILL_BLOCKS',
    'ETH_ANTIRUG_ALLOWLIST_EXTRA',
    'BSC_ANTIRUG_LIVE_EXECUTE',
    'BSC_ANTIRUG_LP_REMOVAL_PCT',
    'BSC_ANTIRUG_CONFIRM_BLOCKS',
    'BSC_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS',
    'BSC_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS',
    'BSC_ANTIRUG_GAS_MULTIPLIER',
    'BSC_ANTIRUG_BACKFILL_CAP_BLOCKS',
    'BSC_ANTIRUG_MAX_BACKFILL_BLOCKS',
    'BSC_ANTIRUG_ALLOWLIST_EXTRA',
    'BASE_ANTIRUG_LIVE_EXECUTE',
    'BASE_ANTIRUG_LP_REMOVAL_PCT',
    'BASE_ANTIRUG_CONFIRM_BLOCKS',
    'BASE_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS',
    'BASE_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS',
    'BASE_ANTIRUG_GAS_MULTIPLIER',
    'BASE_ANTIRUG_BACKFILL_CAP_BLOCKS',
    'BASE_ANTIRUG_MAX_BACKFILL_BLOCKS',
    'BASE_ANTIRUG_ALLOWLIST_EXTRA',
    'ARB_ANTIRUG_LIVE_EXECUTE',
    'ARB_ANTIRUG_LP_REMOVAL_PCT',
    'ARB_ANTIRUG_CONFIRM_BLOCKS',
    'ARB_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS',
    'ARB_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS',
    'ARB_ANTIRUG_GAS_MULTIPLIER',
    'ARB_ANTIRUG_BACKFILL_CAP_BLOCKS',
    'ARB_ANTIRUG_MAX_BACKFILL_BLOCKS',
    'ARB_ANTIRUG_ALLOWLIST_EXTRA',
] as const;

beforeEach(() => {
    // Baseline env required for buildChainRegistry to succeed for eth.
    process.env.ENABLED_CHAINS = 'eth';
    process.env.ETH_RPC_URL = 'https://eth-rpc.example.com';
    process.env.FLASHBOTS_AUTH_KEY = 'test-flashbots-key';
    process.env.PRIVATE_KEY = '0x' + '1'.repeat(64);

    // Clear all anti-rug overlay keys so each test starts from defaults.
    for (const key of ANTIRUG_ENV_KEYS) {
        delete process.env[key];
    }

    vi.resetModules();
});

afterEach(() => {
    for (const key of ANTIRUG_ENV_KEYS) {
        delete process.env[key];
    }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build registry via a fresh dynamic import (post-env-set, post-vi.resetModules). */
async function buildRegistry() {
    const mod = await import('../../../src/chainRegistry');
    return mod.buildChainRegistry();
}

/** Standard FATAL-exit assertion helper. */
async function expectFatalExit(envKey: string, envVal: string) {
    process.env[envKey] = envVal;
    vi.resetModules();
    const mod = await import('../../../src/chainRegistry');
    const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation(((_code?: number) => {
            throw new Error('process.exit-called');
        }) as never);
    try {
        expect(() => mod.buildChainRegistry()).toThrow('process.exit-called');
        expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
        exitSpy.mockRestore();
    }
}

// Verified hardcoded locker addresses from 19-RESEARCH.md §2.1 / §2.2
const UNCX_V2_ETH = '0x59d7d55dDC58494fBbBcA29904f108EcE82AC7Fb';
const UNCX_V2_BSC = '0xC765bddB93b0D1c1A88282BA0fa6B2d00E3e0c83';
const TEAMFINANCE_V2_ETH = '0xE2fE530C047f2d85298b07D9333C05737f1435fB';
const PINKLOCK_V2_ETH = '0x71B5759d73262FBb223956913ecF4ecC51057641';
const PINKLOCK_V2_BSC = '0x407993575c91ce7643a4d4cCaCc9A98c36eE1BBE';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const UNCX_V3_ETH = '0xFD235968e65B0990584585763f837A5b5330e6DE';
const UNCX_V3_BSC = '0xfe88DAB083964C56429baa01F37eC2265AbF1557';
const UNCX_V3_BASE = '0x231278eDd38B00B07fBd52120CEf685B9BaEBCC1';
const UNCX_V3_ARB = '0x6b5360B419e0851b4b81644e0F63c1A9778f2506';
const UNCX_V3_POR2_ARB = '0xcb8B00D4018ad6031e28A44Bf74616014BFB62EC';

// ---------------------------------------------------------------------------
// Task 1: ChainConfig.antiRug field defaults + env overlay + allowlists
// ---------------------------------------------------------------------------

describe('Phase 19 plan 19-02 Task 1 — ChainConfig.antiRug field', () => {
    it('Test 1: ETH antiRug.liveExecute === false default (dry-run safety per D-LIVE-PER-CHAIN)', async () => {
        const registry = await buildRegistry();
        expect(registry.get('eth')!.antiRug.liveExecute).toBe(false);
    });

    it('Test 2: ETH antiRug.lpRemovalPct === 50 default', async () => {
        const registry = await buildRegistry();
        expect(registry.get('eth')!.antiRug.lpRemovalPct).toBe(50);
    });

    it('Test 3: ETH antiRug.backfillCapBlocks === 10 (Alchemy-safe); BSC/BASE/ARB === 500', async () => {
        const registry = await buildRegistry();
        expect(registry.get('eth')!.antiRug.backfillCapBlocks).toBe(10);
        expect(registry.get('bsc')!.antiRug.backfillCapBlocks).toBe(500);
        expect(registry.get('base')!.antiRug.backfillCapBlocks).toBe(500);
        expect(registry.get('arb')!.antiRug.backfillCapBlocks).toBe(500);
    });

    it('Test 4: ETH antiRug.gasMultiplier === 2.0 default', async () => {
        const registry = await buildRegistry();
        expect(registry.get('eth')!.antiRug.gasMultiplier).toBe(2.0);
    });

    it('Test 5: ETH_ANTIRUG_LP_REMOVAL_PCT=75 overrides default to 75', async () => {
        process.env.ETH_ANTIRUG_LP_REMOVAL_PCT = '75';
        const registry = await buildRegistry();
        expect(registry.get('eth')!.antiRug.lpRemovalPct).toBe(75);
        // Independent per-prefix: BSC retains default
        expect(registry.get('bsc')!.antiRug.lpRemovalPct).toBe(50);
    });

    it('Test 6: ETH_ANTIRUG_LP_REMOVAL_PCT=150 (>100) → FATAL exit', async () => {
        await expectFatalExit('ETH_ANTIRUG_LP_REMOVAL_PCT', '150');
    });

    it('Test 7: ETH_ANTIRUG_LP_REMOVAL_PCT=abc (NaN) → FATAL exit', async () => {
        await expectFatalExit('ETH_ANTIRUG_LP_REMOVAL_PCT', 'abc');
    });

    it('Test 8: ETH_ANTIRUG_LIVE_EXECUTE=true → liveExecute=true; other values → false (strict match)', async () => {
        // Strict 'true' match → true
        process.env.ETH_ANTIRUG_LIVE_EXECUTE = 'true';
        let registry = await buildRegistry();
        expect(registry.get('eth')!.antiRug.liveExecute).toBe(true);

        // 'TRUE' → false (case-sensitive safety)
        delete process.env.ETH_ANTIRUG_LIVE_EXECUTE;
        process.env.ETH_ANTIRUG_LIVE_EXECUTE = 'TRUE';
        vi.resetModules();
        registry = await buildRegistry();
        expect(registry.get('eth')!.antiRug.liveExecute).toBe(false);

        // '1' → false
        process.env.ETH_ANTIRUG_LIVE_EXECUTE = '1';
        vi.resetModules();
        registry = await buildRegistry();
        expect(registry.get('eth')!.antiRug.liveExecute).toBe(false);

        // undefined → false
        delete process.env.ETH_ANTIRUG_LIVE_EXECUTE;
        vi.resetModules();
        registry = await buildRegistry();
        expect(registry.get('eth')!.antiRug.liveExecute).toBe(false);
    });

    it('Test 9: ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS=0 (<1) → FATAL exit', async () => {
        await expectFatalExit('ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS', '0');
    });

    it('Test 10: ETH_ANTIRUG_GAS_MULTIPLIER=0.5 (<1.0) → FATAL exit', async () => {
        await expectFatalExit('ETH_ANTIRUG_GAS_MULTIPLIER', '0.5');
    });

    it('Test 11: ETH_ANTIRUG_BACKFILL_CAP_BLOCKS > 100000 → FATAL exit', async () => {
        await expectFatalExit('ETH_ANTIRUG_BACKFILL_CAP_BLOCKS', '100001');
    });

    it('Test 12: ETH_ANTIRUG_MAX_BACKFILL_BLOCKS < BACKFILL_CAP_BLOCKS → FATAL exit', async () => {
        process.env.ETH_ANTIRUG_BACKFILL_CAP_BLOCKS = '100';
        process.env.ETH_ANTIRUG_MAX_BACKFILL_BLOCKS = '50';
        vi.resetModules();
        const mod = await import('../../../src/chainRegistry');
        const exitSpy = vi
            .spyOn(process, 'exit')
            .mockImplementation(((_code?: number) => {
                throw new Error('process.exit-called');
            }) as never);
        try {
            expect(() => mod.buildChainRegistry()).toThrow('process.exit-called');
            expect(exitSpy).toHaveBeenCalledWith(1);
        } finally {
            exitSpy.mockRestore();
        }
    });

    it('Test 13: ETH allowlistV2 includes UNCX UniLockerV2 ETH + TeamFinance ETH + PinkLock V2 ETH + 0xdEaD', async () => {
        const registry = await buildRegistry();
        const eth = registry.get('eth')!;
        const addresses = eth.antiRug.allowlistV2.map(e => e.address.toLowerCase());
        expect(addresses).toContain(UNCX_V2_ETH.toLowerCase());
        expect(addresses).toContain(TEAMFINANCE_V2_ETH.toLowerCase());
        expect(addresses).toContain(PINKLOCK_V2_ETH.toLowerCase());
        expect(addresses).toContain(DEAD_ADDRESS.toLowerCase());
    });

    it('Test 14: ETH allowlistV3 includes UNCX V3 Locker ETH', async () => {
        const registry = await buildRegistry();
        const eth = registry.get('eth')!;
        const addresses = eth.antiRug.allowlistV3.map(e => e.address.toLowerCase());
        expect(addresses).toContain(UNCX_V3_ETH.toLowerCase());
    });

    it('Test 15: BSC allowlistV2 includes UNCX V2 + PinkLock V2 BSC; allowlistV3 includes UNCX V3 BSC', async () => {
        const registry = await buildRegistry();
        const bsc = registry.get('bsc')!;
        const v2addresses = bsc.antiRug.allowlistV2.map(e => e.address.toLowerCase());
        expect(v2addresses).toContain(UNCX_V2_BSC.toLowerCase());
        expect(v2addresses).toContain(PINKLOCK_V2_BSC.toLowerCase());
        const v3addresses = bsc.antiRug.allowlistV3.map(e => e.address.toLowerCase());
        expect(v3addresses).toContain(UNCX_V3_BSC.toLowerCase());
    });

    it('Test 16: Arbitrum allowlistV3 includes UNCX V3 Locker Arb AND UNCX V3 Proof-of-Reserves 2 Arb (ANTIRUG-15)', async () => {
        const registry = await buildRegistry();
        const arb = registry.get('arb')!;
        const addresses = arb.antiRug.allowlistV3.map(e => e.address.toLowerCase());
        expect(addresses).toContain(UNCX_V3_ARB.toLowerCase());
        expect(addresses).toContain(UNCX_V3_POR2_ARB.toLowerCase());
    });

    it('Test 17: ETH_ANTIRUG_ALLOWLIST_EXTRA merges into BOTH allowlistV2 and allowlistV3', async () => {
        const extra1 = ethers.getAddress('0x1111111111111111111111111111111111111111');
        const extra2 = ethers.getAddress('0x2222222222222222222222222222222222222222');
        process.env.ETH_ANTIRUG_ALLOWLIST_EXTRA = `${extra1},${extra2}`;
        const registry = await buildRegistry();
        const eth = registry.get('eth')!;
        const v2 = eth.antiRug.allowlistV2.map(e => e.address.toLowerCase());
        const v3 = eth.antiRug.allowlistV3.map(e => e.address.toLowerCase());
        expect(v2).toContain(extra1.toLowerCase());
        expect(v2).toContain(extra2.toLowerCase());
        expect(v3).toContain(extra1.toLowerCase());
        expect(v3).toContain(extra2.toLowerCase());
        // Provenance is env-overlay for these
        const extraEntry = eth.antiRug.allowlistV2.find(e => e.address.toLowerCase() === extra1.toLowerCase());
        expect(extraEntry?.provenance).toBe('env-overlay');
    });

    it('Test 18: All hardcoded allowlist addresses are checksummed per ethers.getAddress()', async () => {
        const registry = await buildRegistry();
        for (const chainName of ['eth', 'bsc', 'base', 'arb']) {
            const cfg = registry.get(chainName)!;
            for (const entry of cfg.antiRug.allowlistV2) {
                // ethers.getAddress throws on invalid checksum; if address is
                // already checksummed, it returns the same string.
                expect(() => ethers.getAddress(entry.address)).not.toThrow();
                expect(ethers.getAddress(entry.address)).toBe(entry.address);
            }
            for (const entry of cfg.antiRug.allowlistV3) {
                expect(() => ethers.getAddress(entry.address)).not.toThrow();
                expect(ethers.getAddress(entry.address)).toBe(entry.address);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Task 2: src/config.ts REQUIRED_ENV_VARS + .env.example
// ---------------------------------------------------------------------------

describe('Phase 19 plan 19-02 Task 2 — config.ts + .env.example', () => {
    it('Test 19: REQUIRED_ENV_VARS has >= 32 entries matching /^[A-Z]+_ANTIRUG_/', async () => {
        const configSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/config.ts'), 'utf-8');
        // Count distinct env var names matching the prefix.
        // Match a `name: '<CHAIN>_ANTIRUG_*'` entry.
        const matches = configSrc.match(/name:\s*['"][A-Z]+_ANTIRUG_[A-Z_]+['"]/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(32);
    });

    it('Test 20: Every new ANTIRUG entry in REQUIRED_ENV_VARS has required: false', async () => {
        // Read the config.ts file, scan for ANTIRUG entries, assert required: false on each
        const configSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/config.ts'), 'utf-8');
        // Capture each `{ name: '..._ANTIRUG_...', required: <bool>, description: '...' }` line/block.
        // EnvVarSpec entries are typically on a single line in this codebase.
        const entryRe = /\{\s*name:\s*['"]([A-Z]+_ANTIRUG_[A-Z_]+)['"]\s*,\s*required:\s*(true|false)/g;
        let match;
        const offenders: string[] = [];
        while ((match = entryRe.exec(configSrc)) !== null) {
            if (match[2] !== 'false') {
                offenders.push(`${match[1]} (required=${match[2]})`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('Test 21: Every new ANTIRUG entry has a non-empty description', async () => {
        const configSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/config.ts'), 'utf-8');
        const entryRe = /\{\s*name:\s*['"]([A-Z]+_ANTIRUG_[A-Z_]+)['"]\s*,\s*required:\s*(?:true|false)\s*,\s*description:\s*['"]([^'"]*)['"]\s*\}/g;
        let match;
        const offenders: string[] = [];
        while ((match = entryRe.exec(configSrc)) !== null) {
            if (!match[2] || match[2].trim().length === 0) {
                offenders.push(`${match[1]} (empty description)`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('Test 22: .env.example contains Phase 19 Anti-Rug section header', async () => {
        const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf-8');
        expect(envExample).toMatch(/Anti-Rug Runtime Monitoring \(Phase 19\)/);
    });

    it('Test 23: .env.example contains every <CHAIN>_ANTIRUG_* var with = and # description', async () => {
        const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf-8');
        const required = [
            'ETH_ANTIRUG_LIVE_EXECUTE',
            'ETH_ANTIRUG_LP_REMOVAL_PCT',
            'ETH_ANTIRUG_CONFIRM_BLOCKS',
            'ETH_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS',
            'ETH_ANTIRUG_CIRCUIT_BREAKER_WINDOW_HOURS',
            'ETH_ANTIRUG_GAS_MULTIPLIER',
            'ETH_ANTIRUG_BACKFILL_CAP_BLOCKS',
            'ETH_ANTIRUG_MAX_BACKFILL_BLOCKS',
            'BSC_ANTIRUG_LIVE_EXECUTE',
            'BSC_ANTIRUG_LP_REMOVAL_PCT',
            'BSC_ANTIRUG_BACKFILL_CAP_BLOCKS',
            'BASE_ANTIRUG_LIVE_EXECUTE',
            'BASE_ANTIRUG_LP_REMOVAL_PCT',
            'BASE_ANTIRUG_BACKFILL_CAP_BLOCKS',
            'ARB_ANTIRUG_LIVE_EXECUTE',
            'ARB_ANTIRUG_LP_REMOVAL_PCT',
            'ARB_ANTIRUG_BACKFILL_CAP_BLOCKS',
        ];
        const missing: string[] = [];
        for (const v of required) {
            // Each var must be present in a NAME=VALUE form followed by a # comment line on the same line
            const re = new RegExp(`^${v}=[^\\s#]*\\s+#`, 'm');
            if (!re.test(envExample)) {
                missing.push(v);
            }
        }
        expect(missing).toEqual([]);
    });

    it('Test 24: .env.example ANTIRUG_LIVE_EXECUTE defaults to false AND inline comment contains "dry-run"', async () => {
        const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf-8');
        for (const chain of ['ETH', 'BSC', 'BASE', 'ARB']) {
            const re = new RegExp(`^${chain}_ANTIRUG_LIVE_EXECUTE=false\\s+#.*dry-run`, 'm');
            expect(envExample).toMatch(re);
        }
    });

    it('Test 25: .env.example ETH_ANTIRUG_BACKFILL_CAP_BLOCKS=10 (Alchemy-cited); BSC/BASE/ARB=500', async () => {
        const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf-8');
        // ETH must be 10 and cite Alchemy in the inline comment
        expect(envExample).toMatch(/^ETH_ANTIRUG_BACKFILL_CAP_BLOCKS=10\s+#.*Alchemy/m);
        // BSC/BASE/ARB must be 500
        expect(envExample).toMatch(/^BSC_ANTIRUG_BACKFILL_CAP_BLOCKS=500\s+#/m);
        expect(envExample).toMatch(/^BASE_ANTIRUG_BACKFILL_CAP_BLOCKS=500\s+#/m);
        expect(envExample).toMatch(/^ARB_ANTIRUG_BACKFILL_CAP_BLOCKS=500\s+#/m);
    });
});
