// test/unit/anti-rug/dryRunTimestamp.test.ts
// Phase 20 Plan 20-03 — Anti-rug dry-run timestamp record on first
// startChainAntiRugListener call per chain.
//
// Behavior contract (D-ANTIRUG-LIVE-GATE-CODE):
//   - First call to startChainAntiRugListener(ctx) for chain X records the
//     current unix timestamp into chain_state.antirug_dry_run_started via
//     setAntirugDryRunStarted prepared statement (Plan 20-01).
//   - The prepared statement uses ON CONFLICT(chain) DO UPDATE ...
//     antirug_dry_run_started = COALESCE(chain_state.antirug_dry_run_started,
//     excluded.antirug_dry_run_started), so the FIRST non-NULL value per
//     chain wins — subsequent calls are no-ops on the antirug timestamp
//     column (operator restart does NOT reset the 7-day floor).
//   - Cross-chain isolation: each chain has its own row in chain_state.
//   - Plan 20-02 preflight checkAntiRugLiveGate reads this column to enforce
//     the 7-day floor when <CHAIN>_ANTIRUG_LIVE_EXECUTE=true.
//
// Tests (4):
//   Test 1: First call to startChainAntiRugListener for chain='eth' records
//           a recent unix timestamp in chain_state.antirug_dry_run_started.
//   Test 2: Re-calling startChainAntiRugListener for the same chain does NOT
//           overwrite the original timestamp (COALESCE-idempotent).
//   Test 3: Cross-chain isolation: registering 'bsc' after 'eth' records its
//           own timestamp; the 'eth' timestamp from Test 1 is unaffected.
//   Test 4: With fake timers — first call at T0 records T0; after advancing
//           time by 1 day, re-call leaves stored ts at T0 (not T0+1day),
//           proving COALESCE-idempotence under controlled-clock semantics.
//
// Test infrastructure:
//   - process.env.DB_PATH is set to a tmp file BEFORE importing the
//     production db module so the production singleton binds to the test
//     file (not data/bot.db). The real schema migration v1..v6 runs against
//     the tmp file; real prepared statements are exercised.
//   - mock dependencies of src/anti-rug/detector that aren't needed for
//     this test surface: lpBaseline (no positions registered), allowlist
//     (no allowlist lookups), notifier+broadcaster+provider (no
//     ws-lifecycle alerts in this test path).
//   - Ctx is built minimally: chain.name + chain.antiRug.* fields +
//     wsProvider stub + httpProvider stub. Plan 19-04c WS lifecycle
//     scaffolding fires on startChainAntiRugListener but we only assert
//     the new db-write behavior; the WS plumbing is incidental.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// CRITICAL: DB_PATH MUST be set BEFORE any test in this file (or any test
// that runs after this file in the same vitest worker) imports
// `src/utils/db`. Vitest module-level imports execute BEFORE beforeAll
// hooks, so setting DB_PATH in beforeAll is TOO LATE — the production
// singleton may already be bound to data/bot.db, leading to test
// contamination of the operator's real database.
//
// We set DB_PATH at file-load time, BEFORE the production module can be
// imported through any code path (including indirect imports via the
// detector module). This guarantees the singleton's bound DB_PATH is our
// per-test-run tmp file. The `__dirname/tmp-dryrun-ts.db` location lives
// inside the test folder so it survives across workers within the same
// vitest run (each worker shares this file, but our tests delete
// chain_state between each it() so no cross-test interference).
const TEST_DB_PATH = path.join(os.tmpdir(), `gsd-20-03-dryrun-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TEST_DB_PATH;

// ---------------------------------------------------------------------------
// Mocks: keep startChainAntiRugListener side-effect surface tight to the
// new db-write under test. The WS lifecycle (heartbeat, reconnect, alerts)
// is Plan 19-04c territory and incidental to the timestamp behavior.
// ---------------------------------------------------------------------------

// Logger: silence pino output during tests.
const logInfo = vi.fn();
const logWarn = vi.fn();
const logError = vi.fn();
const logFatal = vi.fn();
const logDebug = vi.fn();
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: logInfo,
            warn: logWarn,
            error: logError,
            fatal: logFatal,
            debug: logDebug,
        }),
        info: logInfo,
        warn: logWarn,
        error: logError,
        fatal: logFatal,
        debug: logDebug,
    },
}));

// loadLpBaseline mock — detector reads this in registerAntiRugPosition only.
// startChainAntiRugListener does NOT call loadLpBaseline directly; included
// for completeness so any indirect call returns null and is a no-op.
vi.mock('../../../src/anti-rug/lpBaseline', () => ({
    loadLpBaseline: vi.fn().mockReturnValue(null),
    snapshotLpBaseline: vi.fn().mockResolvedValue(undefined),
}));

// Notifier + broadcaster + provider: WS-lifecycle dependencies (Plan 19-04c)
// that may fire from startChainAntiRugListener. Stub to no-ops.
vi.mock('../../../src/utils/notifier', () => ({
    sendCtxAlert: vi.fn().mockResolvedValue(undefined),
    sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/api/ws/broadcaster', () => ({
    broadcast: vi.fn(),
}));
vi.mock('../../../src/utils/provider', () => ({
    removeWsProvider: vi.fn(),
    getProvider: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tmp DB lifecycle. DB_PATH was already set at file-load time (above).
// All four tests share one tmp DB. Each test resets the chain_state row
// in beforeEach so cross-test interference is avoided.
// ---------------------------------------------------------------------------

afterAll(async () => {
    // Close the production singleton so the tmp file is releasable on Windows.
    try {
        const dbModule = await import('../../../src/utils/db');
        dbModule.closeDb();
    } catch {
        // already closed or never imported
    }
    try {
        // Remove tmp DB + SQLite WAL/SHM sidecars if present.
        for (const suffix of ['', '-wal', '-shm', '-journal']) {
            const p = TEST_DB_PATH + suffix;
            if (fs.existsSync(p)) {
                fs.rmSync(p, { force: true });
            }
        }
    } catch {
        // best-effort cleanup
    }
});

beforeEach(async () => {
    logInfo.mockClear();
    logWarn.mockClear();
    logError.mockClear();
    logFatal.mockClear();
    logDebug.mockClear();
    // Wipe chain_state between tests so each starts from a clean slate
    // (prepared statements have ON CONFLICT(chain) DO UPDATE semantics —
    // we need a fresh row for each "first-time-start" assertion).
    const dbModule = await import('../../../src/utils/db');
    dbModule.db.prepare(`DELETE FROM chain_state`).run();
});

afterEach(async () => {
    // Clear detector internal registry between tests.
    const mod = await import('../../../src/anti-rug/detector');
    if (typeof mod._resetRegistryForTesting === 'function') {
        mod._resetRegistryForTesting();
    }
});

// ---------------------------------------------------------------------------
// Ctx helpers
// ---------------------------------------------------------------------------

interface StubWsProvider {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    websocket: { ping: ReturnType<typeof vi.fn>; readyState: number };
    destroy: ReturnType<typeof vi.fn>;
}

interface StubHttpProvider {
    getLogs: ReturnType<typeof vi.fn>;
    getBlockNumber: ReturnType<typeof vi.fn>;
    getCode: ReturnType<typeof vi.fn>;
}

interface StubChainCtx {
    chain: {
        name: string;
        antiRug: {
            backfillCapBlocks: number;
            maxBackfillBlocks: number;
        };
    };
    wsProvider: StubWsProvider | null;
    httpProvider: StubHttpProvider;
}

function buildCtx(chainName: string): StubChainCtx {
    return {
        chain: {
            name: chainName,
            antiRug: {
                backfillCapBlocks: 10,
                maxBackfillBlocks: 7200,
            },
        },
        wsProvider: {
            on: vi.fn(),
            off: vi.fn(),
            removeAllListeners: vi.fn(),
            once: vi.fn(),
            websocket: { ping: vi.fn(), readyState: 1 },
            destroy: vi.fn(),
        },
        httpProvider: {
            getLogs: vi.fn().mockResolvedValue([]),
            getBlockNumber: vi.fn().mockResolvedValue(18_000_000),
            getCode: vi.fn().mockResolvedValue('0x60'),
        },
    };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("dry-run timestamp record — Phase 20 / Plan 20-03 / D-ANTIRUG-LIVE-GATE-CODE", () => {
    it('Test 1: first call to startChainAntiRugListener records antirug_dry_run_started near current unix ts', async () => {
        const { startChainAntiRugListener } = await import('../../../src/anti-rug/detector');
        const { getAntirugDryRunStarted } = await import('../../../src/utils/db');

        const ctx = buildCtx('eth');
        const beforeCallSec = Math.floor(Date.now() / 1000);
        await startChainAntiRugListener(
            ctx as unknown as Parameters<typeof startChainAntiRugListener>[0],
        );
        const afterCallSec = Math.floor(Date.now() / 1000);

        const row = getAntirugDryRunStarted.get('eth') as { antirug_dry_run_started: number | null } | undefined;
        expect(row).toBeDefined();
        expect(row!.antirug_dry_run_started).toBeTypeOf('number');
        // Recorded ts is within the [beforeCall, afterCall] window (±5s tolerance).
        expect(row!.antirug_dry_run_started!).toBeGreaterThanOrEqual(beforeCallSec - 5);
        expect(row!.antirug_dry_run_started!).toBeLessThanOrEqual(afterCallSec + 5);
    });

    it('Test 2: re-calling startChainAntiRugListener for the same chain does NOT overwrite the original ts (COALESCE-idempotent)', async () => {
        const { startChainAntiRugListener } = await import('../../../src/anti-rug/detector');
        const { getAntirugDryRunStarted } = await import('../../../src/utils/db');

        const ctx = buildCtx('eth');

        // First call: records ts.
        await startChainAntiRugListener(
            ctx as unknown as Parameters<typeof startChainAntiRugListener>[0],
        );
        const firstRow = getAntirugDryRunStarted.get('eth') as { antirug_dry_run_started: number | null };
        const firstTs = firstRow.antirug_dry_run_started!;
        expect(firstTs).toBeTypeOf('number');

        // Wait a small amount of real wall-clock time so a second wall-clock
        // call would produce a different timestamp if the COALESCE guard
        // were absent. (Math.floor(Date.now()/1000) has 1-sec resolution.)
        await new Promise((resolve) => setTimeout(resolve, 1100));

        // Second call: must NOT overwrite the original.
        await startChainAntiRugListener(
            ctx as unknown as Parameters<typeof startChainAntiRugListener>[0],
        );
        const secondRow = getAntirugDryRunStarted.get('eth') as { antirug_dry_run_started: number | null };
        expect(secondRow.antirug_dry_run_started).toBe(firstTs);
    });

    it('Test 3: cross-chain isolation — bsc registration records its own ts; eth ts from Test 1 is unaffected', async () => {
        const { startChainAntiRugListener } = await import('../../../src/anti-rug/detector');
        const { getAntirugDryRunStarted } = await import('../../../src/utils/db');

        // Register eth first.
        const ethCtx = buildCtx('eth');
        await startChainAntiRugListener(
            ethCtx as unknown as Parameters<typeof startChainAntiRugListener>[0],
        );
        const ethRow = getAntirugDryRunStarted.get('eth') as { antirug_dry_run_started: number | null };
        const ethTs = ethRow.antirug_dry_run_started!;
        expect(ethTs).toBeTypeOf('number');

        // Wait briefly so the bsc ts can differ from the eth ts in wall-clock terms.
        await new Promise((resolve) => setTimeout(resolve, 1100));

        // Register bsc next.
        const bscCtx = buildCtx('bsc');
        await startChainAntiRugListener(
            bscCtx as unknown as Parameters<typeof startChainAntiRugListener>[0],
        );
        const bscRow = getAntirugDryRunStarted.get('bsc') as { antirug_dry_run_started: number | null };
        const bscTs = bscRow.antirug_dry_run_started!;
        expect(bscTs).toBeTypeOf('number');

        // Each chain has its own ts; the bsc registration did NOT clobber eth.
        const ethRowAfter = getAntirugDryRunStarted.get('eth') as { antirug_dry_run_started: number | null };
        expect(ethRowAfter.antirug_dry_run_started).toBe(ethTs);

        // bsc ts is distinct from eth ts (>= eth + 1s due to the sleep).
        expect(bscTs).toBeGreaterThanOrEqual(ethTs + 1);
    });

    it('Test 4: with fake timers — first call records T0; after advancing 1 day, re-call leaves stored ts at T0', async () => {
        const { startChainAntiRugListener } = await import('../../../src/anti-rug/detector');
        const { getAntirugDryRunStarted } = await import('../../../src/utils/db');

        const T0_MS = 1_700_000_000_000; // fixed wall-clock millisecond instant
        const T0_SEC = Math.floor(T0_MS / 1000);

        vi.useFakeTimers();
        vi.setSystemTime(new Date(T0_MS));

        const ctx = buildCtx('arb');
        await startChainAntiRugListener(
            ctx as unknown as Parameters<typeof startChainAntiRugListener>[0],
        );
        const row1 = getAntirugDryRunStarted.get('arb') as { antirug_dry_run_started: number | null };
        expect(row1.antirug_dry_run_started).toBe(T0_SEC);

        // Advance one day on the fake clock.
        vi.setSystemTime(new Date(T0_MS + 86_400_000));

        // Second call: under COALESCE-idempotence, the stored ts stays at T0.
        await startChainAntiRugListener(
            ctx as unknown as Parameters<typeof startChainAntiRugListener>[0],
        );
        const row2 = getAntirugDryRunStarted.get('arb') as { antirug_dry_run_started: number | null };
        expect(row2.antirug_dry_run_started).toBe(T0_SEC);

        vi.useRealTimers();
    });
});
