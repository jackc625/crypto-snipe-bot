// src/anti-rug/allowlist.ts
// Phase 19 / Plan 19-03 Task 2 — Allowlist verification, lookup, and merge
// helpers for the anti-rug detector signal-2 evaluator.
//
// Exports:
//   - verifyAllowlistAtStartup(ctx, allowlistV2, allowlistV3)
//       D-LIST-VERIFY: getCode() check on every non-DEAD entry; FATAL exit
//       on EOA (empty code) with structured pino fields identifying the
//       offending entry. Mirrors src/chainRegistry.ts:376-389 fail-loud
//       env validation pattern.
//
//   - isAddressAllowlisted(allowlist, address)
//       Case-insensitive lookup over the merged allowlist; returns the
//       first match's lockerName for the D-LIST-AUDIT structured log
//       emitted by the detector's signal-2 evaluator (Plan 19-04).
//
// WR-01: this module USED to export a `mergeAllowlist` function with
// concat-keep-duplicates semantics. Production however never imported it —
// `buildChainRegistry` always called the chainRegistry-internal
// `mergeAllowlist` which dedupes by lowercased address with env-overlay
// winning on conflicts. The exported function was dead code with its
// own test that asserted behavior production did not exhibit. The
// exported function and its tests have been removed; the audit-trail
// concern (knowing when an env entry overrides a hardcoded one) is
// now structured-logged from chainRegistry's mergeAllowlist instead.
//
// Discretionary call: verifyAllowlistAtStartup takes BOTH lists in a single
// invocation so the structured-log dump is one consolidated line per chain
// (vs two dumps). Caller pattern in Plan 19-05:
//     await verifyAllowlistAtStartup(
//         ctx,
//         ctx.chain.antiRug.allowlistV2,
//         ctx.chain.antiRug.allowlistV3
//     );
//
// References:
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md
//       §"src/anti-rug/allowlist.ts" (lines 351-408)
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md
//       D-LIST-VERIFY + D-LIST-SOURCE + D-LIST-AUDIT (lines 144-163)

import type { AllowlistEntry } from './types';
import { DEAD_ADDRESS } from './events';
import { logger } from '../utils/logger';
import type { ChainContext } from '../chainRegistry';

const log = logger.child({ module: 'antiRug:allowlist' });

// ---------------------------------------------------------------------------
// isAddressAllowlisted
// ---------------------------------------------------------------------------

/**
 * Case-insensitive lookup over an allowlist array.
 *
 * The detector receives raw `to` / `owner` / `recipient` addresses from log
 * events; these arrive in whatever case the contract emitted (typically
 * checksummed or all-lowercase depending on the call site). Allowlist
 * entries are stored in their checksummed-or-canonical form (per Plan 19-02
 * `ethers.getAddress(...)` normalisation). Both sides are lowercased before
 * comparison to make the lookup robust against case variations.
 *
 * Returns the FIRST matching entry's lockerName for the D-LIST-AUDIT log
 * line. The `hit: false` case omits `lockerName` (returning undefined via
 * the optional field) so callers can pattern-match cleanly.
 *
 * @param allowlist The merged allowlist (typically `ctx.chain.antiRug.allowlistV2` or `.allowlistV3`).
 * @param address   The address to look up (any case).
 * @returns { hit: true, lockerName: string } on match;
 *          { hit: false } on miss.
 */
export function isAddressAllowlisted(
    allowlist: AllowlistEntry[],
    address: string,
): { hit: boolean; lockerName?: string } {
    const lc = address.toLowerCase();
    for (const entry of allowlist) {
        if (entry.address.toLowerCase() === lc) {
            return { hit: true, lockerName: entry.lockerName };
        }
    }
    return { hit: false };
}

// ---------------------------------------------------------------------------
// verifyAllowlistAtStartup
// ---------------------------------------------------------------------------

/**
 * Startup-time verification of the merged V2 + V3 allowlist for a single
 * chain.
 *
 * For each non-DEAD entry across BOTH lists:
 *   - Call `ctx.httpProvider.getCode(entry.address)`.
 *   - If the return is `'0x'` (empty bytecode → EOA), log.fatal a structured
 *     line carrying { chain, address, lockerName, provenance } and
 *     `process.exit(1)` per D-LIST-VERIFY.
 *
 * DEAD_ADDRESS entries (canonical burn destination) are skipped — the burn
 * address is an EOA by design; expecting code there would always FATAL.
 * Both hardcoded `0xdEaD` entries (universal across chains) AND any
 * env-overlay entry an operator manually adds at the same address are
 * treated identically here.
 *
 * After verification passes, emit exactly ONE log.info line carrying the
 * full merged allowlist (V2 + V3 in a single payload) with per-entry
 * { address, lockerName, provenance, poolType }. This is the
 * operator-facing visual-verification dump required by D-LIST-VERIFY
 * ("pino + stdout dumps the full merged allowlist with provenance").
 *
 * @param ctx          ChainContext providing httpProvider + chain.name.
 * @param allowlistV2  Merged V2 allowlist (hardcoded + env overlay).
 * @param allowlistV3  Merged V3 allowlist (hardcoded + env overlay).
 */
export async function verifyAllowlistAtStartup(
    ctx: ChainContext,
    allowlistV2: AllowlistEntry[],
    allowlistV3: AllowlistEntry[],
): Promise<void> {
    // Pair every entry with its poolType tag for the consolidated dump.
    // The verification loop walks both lists; the order is V2 first then V3.
    const tagged: Array<{ entry: AllowlistEntry; poolType: 'v2' | 'v3' }> = [];
    for (const entry of allowlistV2) tagged.push({ entry, poolType: 'v2' });
    for (const entry of allowlistV3) tagged.push({ entry, poolType: 'v3' });

    for (const { entry, poolType } of tagged) {
        // DEAD_ADDRESS exception — the canonical burn destination is an EOA
        // by design and is universally listed across every chain. Skip the
        // getCode call regardless of whether the entry came from hardcoded
        // or env-overlay sources.
        if (entry.address.toLowerCase() === DEAD_ADDRESS) {
            continue;
        }

        const code = await ctx.httpProvider.getCode(entry.address);
        if (code === '0x') {
            log.fatal(
                {
                    chain: ctx.chain.name,
                    address: entry.address,
                    lockerName: entry.lockerName,
                    provenance: entry.provenance,
                    poolType,
                },
                'Anti-rug allowlist address has no code (EOA?) — refusing to start',
            );
            process.exit(1);
        }
    }

    // Emit the consolidated dump for operator visual verification.
    log.info(
        {
            chain: ctx.chain.name,
            allowlist: tagged.map(({ entry, poolType }) => ({
                address: entry.address,
                lockerName: entry.lockerName,
                provenance: entry.provenance,
                poolType,
            })),
        },
        'Anti-rug allowlist verified at startup',
    );
}
