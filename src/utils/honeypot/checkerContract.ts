// src/utils/honeypot/checkerContract.ts
//
// Phase 18 plan 18-09 Task 1 — Option-D wrapper (V2 + V3 per iter-2 Blocker #1)
// for the immutable on-chain HoneypotChecker contract deployed at
// `ctx.chain.honeypotChecker.deployedAddress` (committed as a literal in
// CHAIN_TEMPLATES per plan 18-07 / iter-2 Blocker #3).
//
// Per iter-2 Warning #9 the plan-18-02 placeholder sentinel comment has been
// removed post-overwrite (the literal string from that placeholder must not
// appear anywhere in this file — a grep-gate enforces this in the plan's
// verify step).
//
// Mechanism (per RESEARCH.md §"Open Research Item Recommendations" #1-3):
//   1. For each amount in [snipeAmount/100, snipeAmount/2, snipeAmount] (D-AGGREGATION):
//      - encode calldata for `checkV2(router, token, amount)` (V2) or
//        `checkV3(swapRouter, quoter, token, amount, feeTier)` (V3).
//      - `provider.call({ to: deployedAddress, data, value: amount,
//                         from: ctx.wallet.address })`
//        The `from: ctx.wallet.address` mitigates `tx.origin == 0` spoofing
//        (PITFALLS #4).
//      - The contract ALWAYS reverts; on catch, decode revert data via
//        `Interface.parseError`:
//          RoundtripResult / RoundtripResultV3 → terminal verdict (status===0x07 → ok)
//          BuyFailed / SellFailed / QuoteFailed → ok:false with reason
//          parse-failure → ok:false reason:err.message ?? 'unknown-revert'
//      - If `provider.call` RESOLVES (no revert) → contract bug; ok:false
//        reason:'no-terminal-revert'.
//   2. Aggregate per D-AGGREGATION (CONTEXT.md lines 66-73):
//      - Any gating probe (50% or 100%) unsafe → overall unsafe.
//      - 1% probe revert → evidence-only (does NOT block).
//      - All gating probes safe AND tax thresholds NOT exceeded → overall safe.
//      - tax bps > ctx.chain.honeypotChecker.maxBuyTaxBps → 'buy-tax-exceeded'
//        (symmetric for sell — 'sell-tax-exceeded').
//
// Outer try/catch wraps the whole body so a thrown error (unrelated to
// provider.call rejection — e.g., parseEther on a malformed snipeAmount)
// becomes `verdict: 'unsafe'` (fail-closed per PATTERNS.md lines 1169-1172).
//
// `verdict: 'safe'` MUST always carry numeric `buyTaxBps` AND `sellTaxBps`
// — the discriminated-union HoneypotResult intersection in
// `src/utils/honeypot/types.ts` enforces this at the type level (HONEY-06).

import { ethers, Interface } from 'ethers';
import type { ChainContext, DexConfig, DexConfigV3 } from '../../chainRegistry';
import type { HoneypotProbeResult, HoneypotResult } from './types';
import { HONEYPOT_CHECKER_ABI } from './abi';
import { sanitizeReason } from './sanitize';

const iface = new Interface(HONEYPOT_CHECKER_ABI);

// ---------------------------------------------------------------------------
// Shared types + helpers
// ---------------------------------------------------------------------------

/** Per-probe terminal result before aggregation. */
interface ProbeOutcome {
    ok: boolean;
    reason?: string;
    buyTaxBps?: number;
    sellTaxBps?: number;
}

interface CallError {
    data?: string;
    info?: { error?: { data?: string } };
    message?: string;
}

/**
 * Extract revert data from a thrown provider error. ethers v6 may put it at
 * `err.data` (top-level) or `err.info.error.data` (nested from the JSON-RPC
 * error envelope). Either is valid; pick whichever is non-empty.
 */
function extractRevertData(err: CallError): string {
    return err.data ?? err.info?.error?.data ?? '';
}

/**
 * Decode the terminal revert payload from `Interface.parseError`. Returns a
 * normalized ProbeOutcome.
 */
function decodeTerminalRevert(
    revertData: string,
    expectedTerminal: 'RoundtripResult' | 'RoundtripResultV3',
    fallbackMessage: string,
): ProbeOutcome {
    if (!revertData) {
        return { ok: false, reason: fallbackMessage };
    }
    try {
        const parsed = iface.parseError(revertData);
        if (parsed && parsed.name === expectedTerminal) {
            const [buyTaxBpsRaw, sellTaxBpsRaw, statusRaw] = parsed.args;
            const buyTaxBps = Number(buyTaxBpsRaw);
            const sellTaxBps = Number(sellTaxBpsRaw);
            const status = Number(statusRaw);
            const ok = status === 0x07;
            if (ok) {
                return { ok: true, buyTaxBps, sellTaxBps };
            }
            return {
                ok: false,
                reason: `status=0x${status.toString(16).padStart(2, '0')}`,
                buyTaxBps,
                sellTaxBps,
            };
        }
        if (parsed && parsed.name === 'BuyFailed') {
            return { ok: false, reason: `buy-failed:${String(parsed.args[0])}` };
        }
        if (parsed && parsed.name === 'SellFailed') {
            return { ok: false, reason: `sell-failed:${String(parsed.args[0])}` };
        }
        if (parsed && parsed.name === 'QuoteFailed') {
            return { ok: false, reason: `quote-failed:${String(parsed.args[0])}` };
        }
        // parsed but unrecognized name — surface as reason
        if (parsed) {
            return { ok: false, reason: `unrecognized-revert:${parsed.name}` };
        }
    } catch {
        // fall through — parseError throws on undecodable revert data
    }
    return { ok: false, reason: fallbackMessage };
}

/**
 * Per-probe summary in the evidence object. `amountWei` is stringified for
 * JSON safety (BigInt is non-serializable).
 */
function makeProbeSummary(amountWei: bigint, outcome: ProbeOutcome): HoneypotProbeResult {
    return {
        amountWei: amountWei.toString(),
        ok: outcome.ok,
        reason: outcome.reason,
        buyTaxBps: outcome.buyTaxBps,
        sellTaxBps: outcome.sellTaxBps,
    };
}

/**
 * Aggregate 3 probe outcomes per D-AGGREGATION. Returns the final HoneypotResult.
 *
 * - probeOutcomes is indexed [1%, 50%, 100%].
 * - probeOutcomes[1] and probeOutcomes[2] are gating; probeOutcomes[0] is advisory.
 * - tax thresholds (maxBuyTaxBps / maxSellTaxBps) applied to max(gating tax) per HONEY-09.
 */
function aggregateProbes(
    probeOutcomes: ProbeOutcome[],
    amounts: bigint[],
    maxBuyTaxBps: number,
    maxSellTaxBps: number,
    dexType: 'v2' | 'v3',
): HoneypotResult {
    const probeResults = probeOutcomes.map((o, i) => makeProbeSummary(amounts[i], o));

    const gating = [probeOutcomes[1], probeOutcomes[2]];

    // Any gating probe outright unsafe → overall unsafe (use first probe's reason).
    for (const probe of gating) {
        if (!probe.ok) {
            // Plan 18-CR-03 fix-along: probe.reason can carry the string
            // argument of a custom-error revert (BuyFailed / SellFailed /
            // QuoteFailed) which is attacker-controlled (a token's transfer
            // hook can revert with a crafted string). Sanitize before it
            // flows into bot.ts Telegram-markdown alerts / dashboard WS.
            const safeReason = sanitizeReason(probe.reason ?? 'gating-probe-unsafe');
            return {
                verdict: 'unsafe',
                reason: safeReason,
                evidence: {
                    method: 'on-chain-contract',
                    dexType,
                    probeResults,
                    buyTaxBps: probe.buyTaxBps,
                    sellTaxBps: probe.sellTaxBps,
                    revertReason: safeReason,
                },
            };
        }
    }

    // All gating probes safe — enforce tax thresholds (HONEY-09).
    const maxBuyTax = Math.max(gating[0].buyTaxBps ?? 0, gating[1].buyTaxBps ?? 0);
    const maxSellTax = Math.max(gating[0].sellTaxBps ?? 0, gating[1].sellTaxBps ?? 0);

    if (maxBuyTax > maxBuyTaxBps) {
        return {
            verdict: 'unsafe',
            reason: 'buy-tax-exceeded',
            evidence: {
                method: 'on-chain-contract',
                dexType,
                buyTaxBps: maxBuyTax,
                sellTaxBps: maxSellTax,
                probeResults,
            },
        };
    }
    if (maxSellTax > maxSellTaxBps) {
        return {
            verdict: 'unsafe',
            reason: 'sell-tax-exceeded',
            evidence: {
                method: 'on-chain-contract',
                dexType,
                buyTaxBps: maxBuyTax,
                sellTaxBps: maxSellTax,
                probeResults,
            },
        };
    }

    // All clear: report the 100% probe's tax numbers as the canonical figures.
    const safeBuyTax = probeOutcomes[2].buyTaxBps ?? 0;
    const safeSellTax = probeOutcomes[2].sellTaxBps ?? 0;
    return {
        verdict: 'safe',
        evidence: {
            method: 'on-chain-contract',
            dexType,
            buyTaxBps: safeBuyTax,
            sellTaxBps: safeSellTax,
            probeResults,
        },
    };
}

// ---------------------------------------------------------------------------
// V2 wrapper
// ---------------------------------------------------------------------------

/**
 * V2 Option-D wrapper. Runs 3 probes in parallel against the deployed
 * HoneypotChecker contract's `checkV2(router, token, amountIn)` entry point;
 * aggregates per D-AGGREGATION; enforces tax thresholds per HONEY-09.
 *
 * Returns `HoneypotResult` (discriminated union). Never throws — outer
 * try/catch on body produces a fail-closed `verdict: 'unsafe'` on any
 * unexpected error (PATTERNS.md fail-closed mandate).
 */
export async function simulateViaContractV2(
    ctx: ChainContext,
    dex: DexConfig,
    token: string,
    deployedAddress: string,
): Promise<HoneypotResult> {
    try {
        if (dex.dexType !== 'v2') {
            return {
                verdict: 'unknown',
                reason: 'dispatch-mismatch:v2-handler-got-non-v2',
                evidence: { method: 'on-chain-contract', dexType: dex.dexType },
            };
        }

        const snipeWei = ethers.parseEther(ctx.chain.snipeAmount);
        const amounts: bigint[] = [snipeWei / 100n, snipeWei / 2n, snipeWei];

        const runProbeV2 = async (amountWei: bigint): Promise<ProbeOutcome> => {
            const data = iface.encodeFunctionData('checkV2', [dex.routerAddress, token, amountWei]);
            try {
                await ctx.httpProvider.call({
                    to: deployedAddress,
                    data,
                    value: amountWei,
                    from: ctx.wallet.address, // PITFALLS #4 tx.origin spoofing mitigation
                });
                // If call() RESOLVES (didn't revert), the contract violated its
                // revert-always design. Treat as failed probe — fail-closed.
                return { ok: false, reason: 'no-terminal-revert' };
            } catch (e: unknown) {
                const err = e as CallError;
                const revertData = extractRevertData(err);
                const fallback = err.message ?? 'unknown-revert';
                return decodeTerminalRevert(revertData, 'RoundtripResult', fallback);
            }
        };

        const probeOutcomes = await Promise.all(amounts.map(runProbeV2));

        return aggregateProbes(
            probeOutcomes,
            amounts,
            ctx.chain.honeypotChecker.maxBuyTaxBps,
            ctx.chain.honeypotChecker.maxSellTaxBps,
            'v2',
        );
    } catch (e: unknown) {
        ctx.log.warn(
            { err: e, token, check: 'honeypotRoundtripV2' },
            'V2 honeypot wrapper threw unexpectedly — failing closed',
        );
        // Plan 18-CR-03 fix-along: e.message can contain user-controlled
        // RPC error strings or token-revert payloads. Sanitize before it
        // flows into the Telegram markdown alert at bot.ts:251.
        return {
            verdict: 'unsafe',
            reason: sanitizeReason(e instanceof Error ? e.message : String(e)),
            evidence: { method: 'on-chain-contract', dexType: 'v2' },
        };
    }
}

// ---------------------------------------------------------------------------
// V3 wrapper (iter-2 Blocker #1)
// ---------------------------------------------------------------------------

/**
 * V3 Option-D wrapper (iter-2 Blocker #1). Mirrors `simulateViaContractV2`
 * with V3-specific differences:
 *
 * - Routes `checkV3(swapRouter, quoter, token, amountIn, fee)` — 5 args
 *   (V2 has 3).
 * - Recognizes `QuoteFailed` custom error in addition to BuyFailed/SellFailed
 *   (V3 has a quoter contract whose `quoteExactInputSingle` can revert).
 * - Decodes `RoundtripResultV3` as the terminal payload.
 *
 * The `feeTier` runtime parameter is supplied by the dispatch layer (it's a
 * runtime field from the V3 pool-detection event, not a config-time field).
 */
export async function simulateViaContractV3(
    ctx: ChainContext,
    dex: DexConfig,
    token: string,
    deployedAddress: string,
    feeTier: number = 3000,
): Promise<HoneypotResult> {
    try {
        if (dex.dexType !== 'v3') {
            return {
                verdict: 'unknown',
                reason: 'dispatch-mismatch:v3-handler-got-non-v3',
                evidence: { method: 'on-chain-contract', dexType: dex.dexType },
            };
        }

        const v3Dex = dex as DexConfigV3;
        const snipeWei = ethers.parseEther(ctx.chain.snipeAmount);
        const amounts: bigint[] = [snipeWei / 100n, snipeWei / 2n, snipeWei];

        const runProbeV3 = async (amountWei: bigint): Promise<ProbeOutcome> => {
            const data = iface.encodeFunctionData('checkV3', [
                v3Dex.swapRouterAddress,
                v3Dex.quoterAddress,
                token,
                amountWei,
                feeTier,
            ]);
            try {
                await ctx.httpProvider.call({
                    to: deployedAddress,
                    data,
                    value: amountWei,
                    from: ctx.wallet.address, // PITFALLS #4 tx.origin spoofing mitigation
                });
                return { ok: false, reason: 'no-terminal-revert' };
            } catch (e: unknown) {
                const err = e as CallError;
                const revertData = extractRevertData(err);
                const fallback = err.message ?? 'unknown-revert';
                return decodeTerminalRevert(revertData, 'RoundtripResultV3', fallback);
            }
        };

        const probeOutcomes = await Promise.all(amounts.map(runProbeV3));

        return aggregateProbes(
            probeOutcomes,
            amounts,
            ctx.chain.honeypotChecker.maxBuyTaxBps,
            ctx.chain.honeypotChecker.maxSellTaxBps,
            'v3',
        );
    } catch (e: unknown) {
        ctx.log.warn(
            { err: e, token, check: 'honeypotRoundtripV3' },
            'V3 honeypot wrapper threw unexpectedly — failing closed',
        );
        // Plan 18-CR-03 fix-along: e.message can contain user-controlled
        // RPC error strings or token-revert payloads. Sanitize before it
        // flows into the Telegram markdown alert at bot.ts:479.
        return {
            verdict: 'unsafe',
            reason: sanitizeReason(e instanceof Error ? e.message : String(e)),
            evidence: { method: 'on-chain-contract', dexType: 'v3' },
        };
    }
}
