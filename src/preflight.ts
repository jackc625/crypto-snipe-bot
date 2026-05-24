// src/preflight.ts
// Phase 20 / Plan 20-02 / OPS-LIVE-01..07 — startup-time fail-fast checks.
//
// Owns every startup-time check that must pass before chain-context creation
// in startMultiChainBot (Plan 20-04 wires the call). Two-shape API:
//
//   - preflight(registry)        FATAL exit on any failure (used by bot.ts boot)
//   - preflightDryRun(registry)  returns PreflightResult[] (used by Plan 20-05
//                                scripts/preflight.ts CLI so it can format
//                                output + decide its own exit code)
//
// Exports:
//   - PreflightResult              shape returned by every check
//   - preflight(registry)          collect-all-then-exit FATAL flow
//   - preflightDryRun(registry)    returns PreflightResult[] WITHOUT exit
//   - checkWalletBalance(chain)    per-chain D-BALANCE-FLOOR check
//                                  (EXPORTED so Plan 20-04 mid-run setInterval
//                                  can re-use it without code duplication —
//                                  W4 fix)
//   - checkRpcChainId(chain)       per-chain chainId match (replaces inline
//                                  check at bot.ts:887-895 — Plan 20-04 removes
//                                  the inline)
//   - checkRpcBlockAge(chain)      per-chain block-tip freshness
//   - checkMevHealth(chain)        per-chain MEV reachability
//   - checkHoneypotCheckerCode(chain) D-LIST-VERIFY-style getCode check on
//                                  honeypotChecker.deployedAddress
//   - checkAntiRugLiveGate(chain)  D-ANTIRUG-LIVE-GATE-CODE 7-day floor
//   - validateCrossEnvRules()      chain-agnostic cross-variable env rules
//   - checkStaleData()             one-shot stale-position scanner per D-STALE-
//                                  THRESHOLDS (does NOT block startup; log fires
//                                  ARE the observable)
//
// References:
//   .planning/phases/20-going-live-ops-hardening/20-RESEARCH.md §2 + §3 + §4
//     + §11 + §12 + §Observable Effects per Requirement
//   .planning/phases/20-going-live-ops-hardening/20-PATTERNS.md "NEW: src/preflight.ts"
//   .planning/phases/20-going-live-ops-hardening/20-CONTEXT.md D-PREFLIGHT-FLOW
//     + D-BALANCE-FLOOR + D-ROLLBACK + D-ANTIRUG-LIVE-GATE-CODE + D-STALE-THRESHOLDS
//
// D-ROLLBACK: no preflight-bypass escape hatch is recognised here. Preflight
// is always-on. The acceptance_criteria for this plan explicitly forbids any
// bypass env-var from appearing in this file.

import { ethers } from 'ethers';
import type { JsonRpcProvider, Wallet } from 'ethers';
import { logger } from './utils/logger';
import { sendTelegramAlert } from './utils/notifier';
import { createMevStrategy } from './utils/txManager';
import { getAntirugDryRunStarted, db } from './utils/db';
// Type-only import to avoid loading chainRegistry's runtime module body
// (which transitively triggers `dotenv.config()` via src/utils/provider.ts ->
// src/config.ts). The runtime import would re-inject .env values mid-test
// and clobber tests that explicitly `delete process.env.X` in beforeEach.
// `getEnabledChains` is inlined below to keep preflight self-contained.
import type { ChainConfig } from './chainRegistry';

/**
 * Each preflight check needs both the per-chain config AND access to the
 * chain's live httpProvider + wallet. The bot orchestrator's `ChainContext`
 * already holds these (httpProvider + wallet alongside the chain config), but
 * `preflight(registry)` is called BEFORE chain-context creation per
 * OPS-LIVE-01 — the wiring in Plan 20-04 constructs preflight inputs on the
 * fly. PreflightChain captures the minimum shape every check needs.
 *
 * Exported as a type so Plan 20-04 mid-run wiring can build the same shape
 * when calling `checkWalletBalance` from inside the periodic interval.
 */
export type PreflightChain = ChainConfig & {
    httpProvider: JsonRpcProvider;
    wallet: Wallet | { address: string };
};

/**
 * The registry shape accepted by `preflight()` / `preflightDryRun()`. Plan
 * 20-04 wires the input by mapping the bot orchestrator's per-chain
 * ChainContext objects (which already hold httpProvider + wallet alongside
 * the chain config) into this shape.
 */
export type PreflightRegistry = Map<string, PreflightChain>;

// Inlined from src/chainRegistry.ts to avoid the runtime module load. Same
// shape; same behavior. Generic over the chain element type so the helper
// works for any Map whose values carry the `enabled` flag.
function getEnabledChains<T extends { enabled: boolean }>(registry: Map<string, T>): T[] {
    return [...registry.values()].filter(c => c.enabled);
}

const log = logger.child({ module: 'preflight' });

// ---------------------------------------------------------------------------
// Public PreflightResult shape
// ---------------------------------------------------------------------------

export interface PreflightResult {
    chain: string;
    check:
        | 'wallet-balance'
        | 'rpc-chainid'
        | 'rpc-block-age'
        | 'mev-health'
        | 'honeypot-checker-code'
        | 'cross-env-rule'
        | 'antirug-live-gate'
        | 'stale-data';
    passed: boolean;
    reason?: string;
    details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVEN_DAYS_SEC = 7 * 86400;
const REMEDIATION_DOC = 'docs/operations/going-live.md';
const ANTIRUG_DOC = 'docs/operations/anti-rug-rollout.md';

// ---------------------------------------------------------------------------
// Wallet balance — D-BALANCE-FLOOR (exported for Plan 20-04 mid-run reuse)
// ---------------------------------------------------------------------------

/**
 * Per-chain wallet floor check per D-BALANCE-FLOOR:
 *   floor = parseEther(snipeAmount) × MAX_OPEN_POSITIONS + parseEther(gasBuffer)
 *
 * Exported so Plan 20-04 mid-run setInterval can call this without duplicating
 * the formula (W4 fix recorded in plan acceptance_criteria).
 *
 * Fail-closed: if getBalance throws (e.g. RPC down) the result is passed:false
 * with a wrapped reason. T-20-W2-02 mitigation.
 */
export async function checkWalletBalance(chain: PreflightChain): Promise<PreflightResult> {
    const maxOpen = Number(process.env.MAX_OPEN_POSITIONS) || 10;
    try {
        const balance = await chain.httpProvider.getBalance(chain.wallet.address);
        const floor =
            ethers.parseEther(chain.snipeAmount) * BigInt(maxOpen) +
            ethers.parseEther(chain.gasBuffer);
        const passed = balance >= floor;
        return {
            chain: chain.name,
            check: 'wallet-balance',
            passed,
            reason: passed
                ? undefined
                : `wallet balance below floor: ${ethers.formatEther(balance)} < ${ethers.formatEther(floor)} ${chain.nativeCurrency}`,
            details: {
                balance: ethers.formatEther(balance),
                floor: ethers.formatEther(floor),
                snipeAmount: chain.snipeAmount,
                maxOpenPositions: maxOpen,
                gasBuffer: chain.gasBuffer,
                chainNativeCurrency: chain.nativeCurrency,
            },
        };
    } catch (err) {
        return {
            chain: chain.name,
            check: 'wallet-balance',
            passed: false,
            reason: `wallet balance check threw: ${(err as Error).message}`,
            details: {
                err: (err as Error).message,
                snipeAmount: chain.snipeAmount,
                maxOpenPositions: maxOpen,
                gasBuffer: chain.gasBuffer,
            },
        };
    }
}

// ---------------------------------------------------------------------------
// RPC chainId — replaces inline check at bot.ts:887-895 (Plan 20-04 removes)
// ---------------------------------------------------------------------------

export async function checkRpcChainId(chain: PreflightChain): Promise<PreflightResult> {
    try {
        const network = await chain.httpProvider.getNetwork();
        const got = Number(network.chainId);
        const passed = got === chain.chainId;
        return {
            chain: chain.name,
            check: 'rpc-chainid',
            passed,
            reason: passed
                ? undefined
                : `chainId mismatch: expected ${chain.chainId}, got ${got}`,
            details: { expected: chain.chainId, got },
        };
    } catch (err) {
        return {
            chain: chain.name,
            check: 'rpc-chainid',
            passed: false,
            reason: `RPC unreachable: ${(err as Error).message}`,
            details: { err: (err as Error).message, expected: chain.chainId },
        };
    }
}

// ---------------------------------------------------------------------------
// RPC block age — per-chain blockAgeToleranceSec ceiling
// ---------------------------------------------------------------------------

export async function checkRpcBlockAge(chain: PreflightChain): Promise<PreflightResult> {
    try {
        const block = await chain.httpProvider.getBlock('latest');
        if (!block) {
            return {
                chain: chain.name,
                check: 'rpc-block-age',
                passed: false,
                reason: 'getBlock("latest") returned null',
                details: { toleranceSec: chain.blockAgeToleranceSec },
            };
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const blockAgeSec = nowSec - Number(block.timestamp);
        const passed = blockAgeSec <= chain.blockAgeToleranceSec;
        return {
            chain: chain.name,
            check: 'rpc-block-age',
            passed,
            reason: passed
                ? undefined
                : `RPC block tip stale: ${blockAgeSec}s > ${chain.blockAgeToleranceSec}s tolerance`,
            details: { blockAgeSec, toleranceSec: chain.blockAgeToleranceSec },
        };
    } catch (err) {
        return {
            chain: chain.name,
            check: 'rpc-block-age',
            passed: false,
            reason: `block-age check threw: ${(err as Error).message}`,
            details: { err: (err as Error).message, toleranceSec: chain.blockAgeToleranceSec },
        };
    }
}

// ---------------------------------------------------------------------------
// MEV health — short-circuit passthrough; otherwise delegate to strategy
// ---------------------------------------------------------------------------

export async function checkMevHealth(chain: PreflightChain): Promise<PreflightResult> {
    if (chain.mevStrategy === 'passthrough') {
        return {
            chain: chain.name,
            check: 'mev-health',
            passed: true,
            reason: 'passthrough',
            details: { strategy: 'passthrough' },
        };
    }
    try {
        const strategy = createMevStrategy(chain);
        const healthy = await strategy.healthCheck();
        return {
            chain: chain.name,
            check: 'mev-health',
            passed: healthy,
            reason: healthy
                ? undefined
                : `MEV health check failed for strategy ${chain.mevStrategy}`,
            details: { strategy: chain.mevStrategy },
        };
    } catch (err) {
        return {
            chain: chain.name,
            check: 'mev-health',
            passed: false,
            reason: `MEV health check threw: ${(err as Error).message}`,
            details: { strategy: chain.mevStrategy, err: (err as Error).message },
        };
    }
}

// ---------------------------------------------------------------------------
// HoneypotChecker code-at-address — D-LIST-VERIFY pattern
// ---------------------------------------------------------------------------

export async function checkHoneypotCheckerCode(chain: PreflightChain): Promise<PreflightResult> {
    const address = chain.honeypotChecker.deployedAddress;
    if (!address) {
        return {
            chain: chain.name,
            check: 'honeypot-checker-code',
            passed: false,
            reason: `HoneypotChecker not deployed for ${chain.name} — see ${REMEDIATION_DOC} — run npx ts-node scripts/deploy-honeypot-checker.ts ${chain.name}`,
            details: { address: null },
        };
    }
    try {
        const code = await chain.httpProvider.getCode(address);
        const passed = code !== '0x';
        return {
            chain: chain.name,
            check: 'honeypot-checker-code',
            passed,
            reason: passed
                ? undefined
                : `HoneypotChecker has no code at ${address} (EOA / undeployed) — see ${REMEDIATION_DOC} — run npx ts-node scripts/deploy-honeypot-checker.ts ${chain.name}`,
            details: { address, code },
        };
    } catch (err) {
        return {
            chain: chain.name,
            check: 'honeypot-checker-code',
            passed: false,
            reason: `getCode check threw: ${(err as Error).message} — see ${REMEDIATION_DOC}`,
            details: { address, err: (err as Error).message },
        };
    }
}

// ---------------------------------------------------------------------------
// Anti-rug 7-day live-gate — D-ANTIRUG-LIVE-GATE-CODE
// ---------------------------------------------------------------------------

export async function checkAntiRugLiveGate(chain: PreflightChain): Promise<PreflightResult> {
    const envKey = `${chain.name.toUpperCase()}_ANTIRUG_LIVE_EXECUTE`;
    const liveExecute = process.env[envKey] === 'true';
    if (!liveExecute) {
        return {
            chain: chain.name,
            check: 'antirug-live-gate',
            passed: true,
            details: { liveExecute: false },
        };
    }

    let row: { antirug_dry_run_started?: number | null } | undefined;
    try {
        row = getAntirugDryRunStarted.get(chain.name) as
            | { antirug_dry_run_started?: number | null }
            | undefined;
    } catch (err) {
        return {
            chain: chain.name,
            check: 'antirug-live-gate',
            passed: false,
            reason: `antirug-live-gate DB read threw: ${(err as Error).message} — see ${ANTIRUG_DOC}`,
            details: { err: (err as Error).message },
        };
    }

    const ts = row?.antirug_dry_run_started ?? null;
    if (ts === null || ts === undefined) {
        return {
            chain: chain.name,
            check: 'antirug-live-gate',
            passed: false,
            reason: `${envKey}=true but no dry-run timestamp recorded for ${chain.name} (dry-run never started) — see ${ANTIRUG_DOC}`,
            details: { liveExecute: true, antirug_dry_run_started: null, requiredDays: 7 },
        };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = nowSec - Number(ts);
    const ageDays = ageSec / 86400;
    if (ageSec < SEVEN_DAYS_SEC) {
        const daysRemaining = Math.ceil((SEVEN_DAYS_SEC - ageSec) / 86400);
        return {
            chain: chain.name,
            check: 'antirug-live-gate',
            passed: false,
            reason: `${envKey}=true but 7-day dry-run floor not met: ${daysRemaining} days remaining (current age ${ageDays.toFixed(2)} days) — see ${ANTIRUG_DOC}`,
            details: {
                liveExecute: true,
                antirug_dry_run_started: ts,
                ageSec,
                ageDays,
                requiredDays: 7,
                daysRemaining,
            },
        };
    }

    return {
        chain: chain.name,
        check: 'antirug-live-gate',
        passed: true,
        details: {
            liveExecute: true,
            antirug_dry_run_started: ts,
            ageSec,
            ageDays,
            requiredDays: 7,
        },
    };
}

// ---------------------------------------------------------------------------
// Cross-variable env rules — chain-agnostic (D-VALIDATION-HOME)
// ---------------------------------------------------------------------------

export function validateCrossEnvRules(): PreflightResult[] {
    const results: PreflightResult[] = [];

    // Rule 1: MEV_STRATEGY=flashbots ⇔ FLASHBOTS_AUTH_KEY non-empty
    if (process.env.MEV_STRATEGY === 'flashbots' && !process.env.FLASHBOTS_AUTH_KEY) {
        results.push({
            chain: 'global',
            check: 'cross-env-rule',
            passed: false,
            reason: 'MEV_STRATEGY=flashbots requires FLASHBOTS_AUTH_KEY to be set',
            details: { rule: 'mev-flashbots-auth-key' },
        });
    }

    // Rule 2: ENABLED_CHAINS includes bsc ⇔ BLOXROUTE_AUTH_HEADER non-empty
    const enabledChains = (process.env.ENABLED_CHAINS || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
    if (enabledChains.includes('bsc') && !process.env.BLOXROUTE_AUTH_HEADER) {
        results.push({
            chain: 'global',
            check: 'cross-env-rule',
            passed: false,
            reason: 'ENABLED_CHAINS includes bsc but BLOXROUTE_AUTH_HEADER is not set',
            details: { rule: 'bsc-bloxroute-auth-header' },
        });
    }

    // Rule 3: TELEGRAM_API_ID set ⇒ full 5-tuple complete
    if (process.env.TELEGRAM_API_ID) {
        const tuple = [
            'TELEGRAM_API_HASH',
            'TELEGRAM_SESSION',
            'TELEGRAM_BOT_TOKEN',
            'TELEGRAM_CHAT_ID',
        ];
        const missing = tuple.filter(k => !process.env[k]);
        if (missing.length > 0) {
            results.push({
                chain: 'global',
                check: 'cross-env-rule',
                passed: false,
                reason: `TELEGRAM_API_ID is set but the 5-tuple is incomplete: missing ${missing.join(', ')}`,
                details: { rule: 'telegram-5-tuple', missing },
            });
        }
    }

    // Rule 4: per-chain RPC URLs for enabled chains
    const rpcEnvMap: Record<string, string> = {
        eth: 'ETH_RPC_URL',
        bsc: 'BSC_RPC_URL',
        base: 'BASE_RPC_URL',
        arb: 'ARB_RPC_URL',
    };
    for (const chainName of enabledChains) {
        const envKey = rpcEnvMap[chainName];
        if (envKey && !process.env[envKey]) {
            results.push({
                chain: 'global',
                check: 'cross-env-rule',
                passed: false,
                reason: `${chainName} is in ENABLED_CHAINS but ${envKey} is not set`,
                details: { rule: 'per-chain-rpc-url', chainName, envKey },
            });
        }
    }

    return results;
}

// ---------------------------------------------------------------------------
// Stale-data warnings — D-STALE-THRESHOLDS
// ---------------------------------------------------------------------------

/**
 * One-shot scan at startup for pending-buy trades whose timestamp exceeds the
 * STALE_WARN_SEC threshold. Per D-STALE-THRESHOLDS defaults are 120s warn /
 * 600s error. The SQL filter only returns rows older than the warn threshold;
 * the in-memory split between warn / error happens by recomputing age per row.
 *
 * Does NOT block startup. Return shape is PreflightResult[] for API symmetry
 * but passed:true on every row — log fires (`{ op: 'stale-position', ... }`)
 * ARE the observable per the test contract.
 */
export async function checkStaleData(): Promise<PreflightResult[]> {
    const warnSec = Number(process.env.STALE_WARN_SEC) || 120;
    const errorSec = Number(process.env.STALE_ERROR_SEC) || 600;
    const nowSec = Math.floor(Date.now() / 1000);

    const stmt = db.prepare(
        `SELECT id, token, chain, timestamp FROM trades WHERE status = 'pending' AND action = 'buy' AND timestamp < ?`,
    );
    const rows = stmt.all(nowSec - warnSec) as Array<{
        id: number;
        token: string;
        chain: string;
        timestamp: number;
    }>;

    const results: PreflightResult[] = [];
    for (const row of rows) {
        const ageSec = nowSec - Number(row.timestamp);
        const payload = {
            op: 'stale-position',
            tradeId: row.id,
            ageSec,
            token: row.token,
            chain: row.chain,
        };
        if (ageSec > errorSec) {
            log.error(payload, 'Stale pending position exceeds STALE_ERROR_SEC threshold');
        } else {
            log.warn(payload, 'Stale pending position exceeds STALE_WARN_SEC threshold');
        }
        results.push({
            chain: row.chain,
            check: 'stale-data',
            passed: true,
            details: { tradeId: row.id, ageSec, token: row.token },
        });
    }
    return results;
}

// ---------------------------------------------------------------------------
// printPreflightSummary — Plan 20-05 CLI consumes the same grouping
// ---------------------------------------------------------------------------

function printPreflightSummary(results: PreflightResult[]): void {
    // Group per-chain. Cross-env rules are bucketed under chain='global'.
    const byChain = new Map<string, PreflightResult[]>();
    for (const r of results) {
        const bucket = byChain.get(r.chain) ?? [];
        bucket.push(r);
        byChain.set(r.chain, bucket);
    }
    for (const [chain, list] of byChain) {
        const passed = list.filter(r => r.passed).length;
        const failed = list.length - passed;
        log.info({ chain, passed, failed, checks: list.map(r => ({ check: r.check, passed: r.passed })) }, `Preflight summary for ${chain}`);
    }
}

// ---------------------------------------------------------------------------
// preflightDryRun — D-PREFLIGHT-FLOW collect-all (no exit)
// ---------------------------------------------------------------------------

/**
 * Run every preflight check and return the flat result array. Does NOT call
 * process.exit. Used by Plan 20-05's scripts/preflight.ts so the standalone
 * CLI can format human / --json output and decide its own exit code.
 *
 * Per D-PREFLIGHT-FLOW: chain-agnostic cross-env rules run FIRST (fail-loud
 * earliest), then per-chain checks in parallel via Promise.all, then the
 * one-shot stale-data scan. Returns the flattened array.
 */
export async function preflightDryRun(
    registry: PreflightRegistry,
): Promise<PreflightResult[]> {
    const results: PreflightResult[] = [];

    // Phase 1: cross-env rules (chain-agnostic).
    results.push(...validateCrossEnvRules());

    // Phase 2: per-chain checks in parallel per chain.
    for (const chain of getEnabledChains(registry)) {
        const chainResults = await Promise.all([
            checkRpcChainId(chain),
            checkRpcBlockAge(chain),
            checkWalletBalance(chain),
            checkMevHealth(chain),
            checkHoneypotCheckerCode(chain),
            checkAntiRugLiveGate(chain),
        ]);
        results.push(...chainResults);
    }

    // Phase 3: stale-data one-shot.
    try {
        const staleResults = await checkStaleData();
        results.push(...staleResults);
    } catch (err) {
        // Stale-data scanner errors are non-blocking by design; surface as
        // a passed:false result so the operator sees the issue without
        // halting preflight. T-20-W2-02 fail-closed analog.
        results.push({
            chain: 'global',
            check: 'stale-data',
            passed: false,
            reason: `stale-data scan threw: ${(err as Error).message}`,
            details: { err: (err as Error).message },
        });
    }

    return results;
}

// ---------------------------------------------------------------------------
// preflight — D-PREFLIGHT-FLOW collect-all-then-FATAL
// ---------------------------------------------------------------------------

/**
 * Boot-time preflight entry. Collects all results via preflightDryRun, prints
 * a per-chain pass/fail summary, and on ANY FATAL emits structured pino +
 * Telegram alerts for every failure (D-ALERTS) and then process.exit(1).
 *
 * On all-pass: one info log and returns void.
 *
 * D-ROLLBACK: no bypass escape hatch — preflight is always-on.
 */
export async function preflight(registry: PreflightRegistry): Promise<void> {
    const results = await preflightDryRun(registry);
    printPreflightSummary(results);

    const failed = results.filter(r => !r.passed);
    if (failed.length > 0) {
        for (const r of failed) {
            log.fatal(
                {
                    chain: r.chain,
                    check: r.check,
                    reason: r.reason,
                    details: r.details,
                    remediation: REMEDIATION_DOC,
                },
                `Preflight failed: ${r.check} on ${r.chain}`,
            );
            try {
                await sendTelegramAlert(
                    `*PREFLIGHT FATAL* [${r.chain}] ${r.check}: ${r.reason ?? 'no reason'} — see ${REMEDIATION_DOC}`,
                );
            } catch (err) {
                // Telegram failure must not mask the FATAL exit path.
                log.warn({ err: (err as Error).message }, 'Telegram alert during preflight FATAL failed');
            }
        }
        process.exit(1);
    }

    log.info(
        { chainCount: getEnabledChains(registry).length, checkCount: results.length },
        'Preflight passed',
    );
}
