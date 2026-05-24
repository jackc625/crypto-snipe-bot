// test/unit/anti-rug/allowlist.test.ts
// Phase 19 Plan 19-03 Task 2 — verifyAllowlistAtStartup (D-LIST-VERIFY) +
// isAddressAllowlisted (signal-2 lookup) + mergeAllowlist (hardcoded + env
// overlay merger).
//
// Test plan (9 tests):
//   1. verifyAllowlistAtStartup(ctx, v2, v3) calls getCode() on every non-DEAD entry
//   2. EOA entry (code='0x') triggers log.fatal + process.exit(1)
//   3. DEAD_ADDRESS entries skip getCode() (universal burn — no code expected)
//   4. All clean — log.info ONCE with merged-list dump (provenance per entry)
//   5. isAddressAllowlisted hit — returns { hit: true, lockerName }
//   6. isAddressAllowlisted miss — returns { hit: false }
//   7. mergeAllowlist(base, extras) — concat preserving order; provenance kept
//   8. mergeAllowlist(undefined, undefined) — returns [] without throwing
//   9. env-overlay DEAD_ADDRESS — kept in merge; skipped by verify (same as hardcoded)
//
// Mocking strategy: vi.mock the logger so we can spy on .fatal / .info without
// emitting noise. ChainContext is built as a minimal stub with httpProvider
// containing a vi.fn() getCode implementation per test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AllowlistEntry } from '../../../src/anti-rug/types';
import { DEAD_ADDRESS } from '../../../src/anti-rug/events';

// ---------------------------------------------------------------------------
// Logger mock — captures .fatal / .info calls; module-level child loggers in
// the production module also pass through this same mock because they call
// `logger.child(...)` which we stub to return a logger object exposing the
// same methods.
// ---------------------------------------------------------------------------

const logFatal = vi.fn();
const logInfo = vi.fn();
const logWarn = vi.fn();
const logDebug = vi.fn();
const logError = vi.fn();

vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            fatal: logFatal,
            info: logInfo,
            warn: logWarn,
            debug: logDebug,
            error: logError,
        }),
        fatal: logFatal,
        info: logInfo,
        warn: logWarn,
        debug: logDebug,
        error: logError,
    },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface StubChainContext {
    chain: { name: string; displayName?: string };
    httpProvider: { getCode: ReturnType<typeof vi.fn> };
}

/**
 * Build a minimal ChainContext stub suitable for verifyAllowlistAtStartup.
 * The function only touches `ctx.chain.name` (for log fields) and
 * `ctx.httpProvider.getCode(address)` (for the contract-vs-EOA check).
 */
function buildCtx(getCodeImpl: (addr: string) => Promise<string>): StubChainContext {
    return {
        chain: { name: 'eth' },
        httpProvider: { getCode: vi.fn(getCodeImpl) },
    };
}

const LOCKER_A_ADDR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const LOCKER_B_ADDR = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const LOCKER_C_ADDR = '0xcccccccccccccccccccccccccccccccccccccccc';

const ENTRY_DEAD: AllowlistEntry = {
    address: DEAD_ADDRESS,
    lockerName: '0xdEaD burn address (universal)',
    provenance: 'hardcoded',
};

const ENTRY_A: AllowlistEntry = {
    address: LOCKER_A_ADDR,
    lockerName: 'Test Locker A',
    provenance: 'hardcoded',
};

const ENTRY_B: AllowlistEntry = {
    address: LOCKER_B_ADDR,
    lockerName: 'Test Locker B (V3)',
    provenance: 'hardcoded',
};

const ENTRY_C_OVERLAY: AllowlistEntry = {
    address: LOCKER_C_ADDR,
    lockerName: 'Operator overlay',
    provenance: 'env-overlay',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 19 — Allowlist module', () => {
    beforeEach(() => {
        logFatal.mockClear();
        logInfo.mockClear();
        logWarn.mockClear();
        logDebug.mockClear();
        logError.mockClear();
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('verifyAllowlistAtStartup (D-LIST-VERIFY)', () => {
        it('Test 1: getCode called on every non-DEAD entry across V2 + V3 lists', async () => {
            const { verifyAllowlistAtStartup } = await import(
                '../../../src/anti-rug/allowlist'
            );
            const ctx = buildCtx(async () => '0x1234'); // contract code (non-empty)

            await verifyAllowlistAtStartup(
                // Two-arg shape: V2 list + V3 list (consolidated single log line)
                // Cast through unknown for the stub-context surface — production
                // ChainContext has more fields than the test stub.
                ctx as unknown as Parameters<typeof verifyAllowlistAtStartup>[0],
                [ENTRY_A, ENTRY_DEAD],
                [ENTRY_B]
            );

            // Two non-DEAD entries → exactly 2 getCode calls
            expect(ctx.httpProvider.getCode).toHaveBeenCalledTimes(2);
            // The DEAD_ADDRESS must NOT have been called
            const calledAddrs = ctx.httpProvider.getCode.mock.calls.map(c => c[0]);
            expect(calledAddrs).not.toContain(DEAD_ADDRESS);
            expect(calledAddrs).toContain(LOCKER_A_ADDR);
            expect(calledAddrs).toContain(LOCKER_B_ADDR);
        });

        it('Test 2: EOA entry (getCode returns 0x) triggers log.fatal + process.exit(1)', async () => {
            const { verifyAllowlistAtStartup } = await import(
                '../../../src/anti-rug/allowlist'
            );
            // First entry returns '0x' (EOA) — must FATAL exit.
            const ctx = buildCtx(async (_addr: string) => '0x');

            const exitSpy = vi
                .spyOn(process, 'exit')
                .mockImplementation(((_code?: number) => {
                    throw new Error('process.exit-called');
                }) as never);

            try {
                await expect(
                    verifyAllowlistAtStartup(
                        ctx as unknown as Parameters<typeof verifyAllowlistAtStartup>[0],
                        [ENTRY_A],
                        []
                    )
                ).rejects.toThrow('process.exit-called');

                expect(exitSpy).toHaveBeenCalledWith(1);
                expect(logFatal).toHaveBeenCalled();
                // Verify the fatal log carries chain + address + lockerName +
                // provenance fields per D-LIST-VERIFY shape.
                const fatalArg = logFatal.mock.calls[0][0] as Record<string, unknown>;
                expect(fatalArg.chain).toBe('eth');
                expect(fatalArg.address).toBe(LOCKER_A_ADDR);
                expect(fatalArg.lockerName).toBe('Test Locker A');
                expect(fatalArg.provenance).toBe('hardcoded');
            } finally {
                exitSpy.mockRestore();
            }
        });

        it('Test 3: DEAD_ADDRESS in V2 list is skipped (getCode NOT called for that entry)', async () => {
            const { verifyAllowlistAtStartup } = await import(
                '../../../src/anti-rug/allowlist'
            );
            // Only DEAD is in the V2 list; V3 empty. No non-DEAD entries → 0 getCode calls.
            const ctx = buildCtx(async () => '0x1234');

            await verifyAllowlistAtStartup(
                ctx as unknown as Parameters<typeof verifyAllowlistAtStartup>[0],
                [ENTRY_DEAD],
                []
            );

            expect(ctx.httpProvider.getCode).not.toHaveBeenCalled();
            // No fatal (DEAD is the canonical exception)
            expect(logFatal).not.toHaveBeenCalled();
        });

        it('Test 4: All clean — exactly one log.info dump summarizing merged V2 + V3 with provenance', async () => {
            const { verifyAllowlistAtStartup } = await import(
                '../../../src/anti-rug/allowlist'
            );
            const ctx = buildCtx(async () => '0xabcd'); // all good

            await verifyAllowlistAtStartup(
                ctx as unknown as Parameters<typeof verifyAllowlistAtStartup>[0],
                [ENTRY_A, ENTRY_DEAD],
                [ENTRY_B]
            );

            // Exactly one info log line — the merged-list dump.
            expect(logInfo).toHaveBeenCalledTimes(1);

            const infoArg = logInfo.mock.calls[0][0] as Record<string, unknown>;
            expect(infoArg.chain).toBe('eth');
            // The dump payload must include every entry's address + lockerName +
            // provenance + poolType so the operator can visually verify before
            // pressing enter on bot start.
            const allowlist = infoArg.allowlist as Array<{
                address: string;
                lockerName: string;
                provenance: string;
                poolType: string;
            }>;
            expect(Array.isArray(allowlist)).toBe(true);
            expect(allowlist).toHaveLength(3);

            // Verify each entry carries its poolType tag
            const v2Entries = allowlist.filter(e => e.poolType === 'v2');
            const v3Entries = allowlist.filter(e => e.poolType === 'v3');
            expect(v2Entries).toHaveLength(2);
            expect(v3Entries).toHaveLength(1);

            // Verify provenance is preserved
            const provenances = allowlist.map(e => e.provenance);
            expect(provenances).toContain('hardcoded');
        });
    });

    describe('isAddressAllowlisted (signal-2 lookup)', () => {
        it('Test 5: hit — returns { hit: true, lockerName } case-insensitively', async () => {
            const { isAddressAllowlisted } = await import(
                '../../../src/anti-rug/allowlist'
            );

            // Allowlist has lowercased address; query with uppercased one.
            const allowlist: AllowlistEntry[] = [ENTRY_A];
            const upperCased = LOCKER_A_ADDR.toUpperCase();
            const result = isAddressAllowlisted(allowlist, upperCased);

            expect(result.hit).toBe(true);
            expect(result.lockerName).toBe('Test Locker A');
        });

        it('Test 6: miss — returns { hit: false }', async () => {
            const { isAddressAllowlisted } = await import(
                '../../../src/anti-rug/allowlist'
            );

            const allowlist: AllowlistEntry[] = [ENTRY_A, ENTRY_B];
            const unknownAddr = '0x9999999999999999999999999999999999999999';
            const result = isAddressAllowlisted(allowlist, unknownAddr);

            expect(result.hit).toBe(false);
            // lockerName MUST be absent when hit is false
            expect(result.lockerName).toBeUndefined();
        });
    });

    describe('mergeAllowlist (hardcoded + env overlay merger)', () => {
        it('Test 7: concat preserves order — hardcoded first, env-overlay after; duplicates kept', async () => {
            const { mergeAllowlist } = await import('../../../src/anti-rug/allowlist');

            // ENTRY_A is hardcoded; ENTRY_A_DUP has the same address but env-overlay
            const ENTRY_A_DUP: AllowlistEntry = {
                address: LOCKER_A_ADDR, // same address as ENTRY_A
                lockerName: 'Operator overlay',
                provenance: 'env-overlay',
            };

            const merged = mergeAllowlist([ENTRY_A, ENTRY_B], [ENTRY_C_OVERLAY, ENTRY_A_DUP]);

            // Concat preserves order: hardcoded first, then env-overlay
            expect(merged).toHaveLength(4);
            expect(merged[0]).toEqual(ENTRY_A);
            expect(merged[1]).toEqual(ENTRY_B);
            expect(merged[2]).toEqual(ENTRY_C_OVERLAY);
            expect(merged[3]).toEqual(ENTRY_A_DUP);

            // Duplicate address entries are NOT silently de-duped — both rows are
            // kept so D-LIST-AUDIT can show the operator both provenances.
            const addrCount = merged.filter(
                e => e.address.toLowerCase() === LOCKER_A_ADDR.toLowerCase()
            ).length;
            expect(addrCount).toBe(2);
        });

        it('Test 8: undefined arguments — returns [] without throwing (defensive)', async () => {
            const { mergeAllowlist } = await import('../../../src/anti-rug/allowlist');

            // The degenerate "no entries at all" case. Should never happen in
            // production (defaults always supply at least DEAD_ADDRESS), but
            // empty-list is a valid base case for tests and for any future
            // configuration that explicitly disables allowlisting on a chain.
            expect(() =>
                mergeAllowlist(
                    undefined as unknown as AllowlistEntry[],
                    undefined as unknown as AllowlistEntry[]
                )
            ).not.toThrow();
            expect(
                mergeAllowlist(
                    undefined as unknown as AllowlistEntry[],
                    undefined as unknown as AllowlistEntry[]
                )
            ).toEqual([]);
        });

        it('Test 9: env-overlay DEAD_ADDRESS — verifyAllowlistAtStartup skips getCode on it too', async () => {
            const { verifyAllowlistAtStartup } = await import(
                '../../../src/anti-rug/allowlist'
            );

            // Operator manually added 0xdEaD via env overlay (degenerate but
            // syntactically valid).
            const DEAD_OVERLAY_ENTRY: AllowlistEntry = {
                address: DEAD_ADDRESS,
                lockerName: 'Operator overlay (DEAD)',
                provenance: 'env-overlay',
            };

            const ctx = buildCtx(async () => '0x');  // return EOA — would FATAL if called
            // The DEAD entry must be skipped regardless of provenance; if the
            // function attempted getCode on it, we'd FATAL.

            await verifyAllowlistAtStartup(
                ctx as unknown as Parameters<typeof verifyAllowlistAtStartup>[0],
                [DEAD_OVERLAY_ENTRY],
                []
            );

            expect(ctx.httpProvider.getCode).not.toHaveBeenCalled();
            expect(logFatal).not.toHaveBeenCalled();
        });
    });
});
