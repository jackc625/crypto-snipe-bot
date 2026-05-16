// src/utils/honeypot/bytecodeScan.ts
//
// HONEY-12: Bytecode selector-presence scan.
//
// Closes the "owner flips tax mid-position" attack vector that the buy->sell
// roundtrip cannot catch (CONTEXT.md D-BYTECODE). Reads `getCode(token)` and
// substring-greps for 19 well-known 4-byte selectors of mutable-tax /
// blacklist / pause / max-wallet / fee-exclusion setters.
//
// Pattern: copies `src/utils/tokenSafety.ts:isBlacklistedTokenForChain`
// (lines 357-365) verbatim and EXTENDS it with:
//   - 19-selector verified table (vs that file's 3-selector anti-bot probe)
//   - Richer return type `{ isMutable, hits }` so evidence flows into alerts
//   - `.toLowerCase()` of bytecode for case-safe matching
//
// FAIL-CLOSED contract (Phase 18 PATTERNS.md line 446 + RESEARCH.md §7
// lines 1026-1030): on `getCode` throw the function returns
// `{ isMutable: true, hits: ['scan-failed'] }`. This is the inverse of
// `isBlacklistedTokenForChain`'s behavior (which lets the error propagate)
// and is the deliberate D-UNKNOWN-POLICY application — "always fail-CLOSED"
// at every Phase 18 gate.
//
// Wire-up: 9th element of the parallel safety bank Promise.all at
// `src/bot.ts:229-238`; lands in plan 18-09.
//
// Selector table source-of-truth:
//   .planning/phases/18-honeypot-detection-rebuild/18-RESEARCH.md
//   §"Bytecode Selector Scan (HONEY-12) — Verified Selector Table"

import type { ChainContext } from '../../chainRegistry';

/**
 * 19 4-byte function selectors (without `0x` prefix, lowercase) for
 * mutable-tax / blacklist / pause / max-wallet / fee-exclusion setters.
 *
 * Order mirrors the table in 18-RESEARCH.md. DO NOT remove entries without
 * updating the test invariant in test/unit/bytecodeScan.test.ts that pins
 * `MUTABLE_SELECTORS.length === 19`.
 */
export const MUTABLE_SELECTORS: readonly string[] = [
    '2e5bb6ff', // setTax(uint256)
    '667f6526', // setTax(uint256,uint256)
    'dc1052e2', // setBuyTax(uint256)
    '8cd09d50', // setSellTax(uint256)
    '6081752b', // setBuyTax(uint8)
    '49abdc14', // setSellTax(uint8)
    '0b78f9c0', // setFees(uint256,uint256)
    '5d0044ca', // setMaxWallet(uint256)
    'ea1644d5', // setMaxWalletSize(uint256)
    'ec28438a', // setMaxTxAmount(uint256)
    '153b0d1e', // setBlacklist(address,bool)
    '4e054a67', // setBlacklist(address)
    'f9f92be4', // blacklist(address)
    'e57f14e1', // excludeFromFees(address)
    'c0246668', // excludeFromFees(address,bool)
    '1031e36e', // pauseTrading()
    '365ec5e5', // pauseTrading(bool)
    '8f70ccf7', // setTrading(bool)
    'c2e5ec04', // setTradingEnabled(bool)
] as const;

/**
 * Result of a single bytecode mutability scan.
 *
 * `isMutable: true` means the parallel safety bank should BLOCK the buy.
 * `hits` lists the matched 4-byte selectors (lowercase, no `0x` prefix),
 * OR the sentinel string `'scan-failed'` if the underlying `getCode` RPC
 * threw — the fail-closed marker.
 */
export interface MutableScanResult {
    isMutable: boolean;
    hits: string[];
}

/**
 * Chain-aware bytecode selector scan (HONEY-12).
 *
 * Reads `getCode(tokenAddress)` and substring-greps for each of the 19
 * `MUTABLE_SELECTORS`. Returns a `MutableScanResult` whose `isMutable`
 * field is `true` iff at least one selector matched.
 *
 * Fail-closed contract:
 *   - If `getCode` throws, returns `{ isMutable: true, hits: ['scan-failed'] }`.
 *   - If `getCode` returns `'0x'` (EOA / not-deployed), returns
 *     `{ isMutable: false, hits: [] }` (no contract code -> cannot have
 *     a mutable setter; the buy is independently blocked upstream by
 *     `isKnownBadTokenForChain`).
 *
 * Case-safety: bytecode is lowercased before substring matching, so
 * mixed-case RPC responses (`'0X2E5BB6FF...'`) still match the lowercase
 * selector table.
 */
export async function isMutableTokenForChain(
    ctx: ChainContext,
    tokenAddress: string,
): Promise<MutableScanResult> {
    try {
        const code = await ctx.httpProvider.getCode(tokenAddress);
        if (!code || code === '0x') {
            return { isMutable: false, hits: [] };
        }
        const codeLower = code.toLowerCase();
        const hits = MUTABLE_SELECTORS.filter((sel) => codeLower.includes(sel));
        return { isMutable: hits.length > 0, hits: [...hits] };
    } catch (e) {
        ctx.log.warn(
            { err: e, token: tokenAddress, check: 'bytecodeScan' },
            'Bytecode scan failed',
        );
        // Fail-closed: treat unreachable RPC as "potentially mutable".
        return { isMutable: true, hits: ['scan-failed'] };
    }
}
