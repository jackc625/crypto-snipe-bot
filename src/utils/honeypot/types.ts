// src/utils/honeypot/types.ts
// HONEY-06: Discriminated-union HoneypotResult that makes vacuous-pass
// unrepresentable at the type level.
//
// CRITICAL TYPE DISCIPLINE (Phase 17 D-13/D-14 carryover):
//   The `safe` variant TIGHTENS evidence to REQUIRE `buyTaxBps: number`
//   and `sellTaxBps: number` (NOT optional). This makes a literal
//   `{ verdict: 'safe', evidence: {} }` fail `tsc --noEmit` — the
//   compile-gate vacuous-pass guard mandated by HONEY-06.
//
// Per CONTEXT.md D-CONTRACT-SCOPE the contract reports both V2 and V3
// tax bps via the same shape; per iter-2 Blocker #1 the evidence
// optionally records which DEX type (`v2` | `v3`) produced the result.

/**
 * Per-probe result captured during multi-amount aggregation (HONEY-10).
 * `amountWei` is a string (BigInt-safe across JSON boundaries).
 */
export interface HoneypotProbeResult {
    amountWei: string;
    ok: boolean;
    reason?: string;
    buyTaxBps?: number;
    sellTaxBps?: number;
}

/**
 * Loose evidence container used by `unsafe` / `unknown` verdicts. The
 * `safe` variant intersects this with required tax fields below.
 */
export interface HoneypotEvidence {
    buyTaxBps?: number;
    sellTaxBps?: number;
    revertReason?: string;
    probeResults?: HoneypotProbeResult[];
    method: 'on-chain-contract' | 'eth_simulateV1' | 'bytecode-scan';
    /** Per iter-2 Blocker #1: which DEX path produced the result. */
    dexType?: 'v2' | 'v3';
}

/**
 * Discriminated union HoneypotResult.
 *
 * - `safe`:   MUST include `buyTaxBps` and `sellTaxBps` as `number` (not
 *             optional). A literal `{ verdict: 'safe', evidence: {} }`
 *             fails `tsc --noEmit` by construction.
 * - `unsafe`: requires a `reason: string` field.
 * - `unknown`: requires a `reason: string` field (one-shot skip per
 *              D-UNKNOWN-POLICY; no retry, no fallback).
 */
export type HoneypotResult =
    | {
          verdict: 'safe';
          evidence: HoneypotEvidence & { buyTaxBps: number; sellTaxBps: number };
      }
    | {
          verdict: 'unsafe';
          reason: string;
          evidence: HoneypotEvidence;
      }
    | {
          verdict: 'unknown';
          reason: string;
          evidence: HoneypotEvidence;
      };

/**
 * Per-chain checker configuration. Single source of truth for plan 18-06
 * which extends `ChainConfig` to carry this field on each chain.
 */
export interface HoneypotCheckerConfig {
    deployedAddress: string | null;
    method: 'on-chain-contract' | 'eth_simulateV1';
    maxBuyTaxBps: number;
    maxSellTaxBps: number;
}
