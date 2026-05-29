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
import { getAntirugDryRunStarted, getStaleTradesQuery } from './utils/db';
// Phase 21.2 / Plan 21.2-08 (Finding A, D-EXIT-AFFORDABILITY-GATE): the buy-time
// entry affordability gate reuses the SAME no-float bigint fee scaling the MEV
// strategies use (applyGasMultiplier), so the buy-time worst-case-public-exit gas
// math and the runtime sell reserve agree on the spelling. We deliberately apply
// the entry-gate-specific EXIT_GATE_SELL_GAS_BUFFER (default 2.0) rather than the
// runtime SELL_GAS_BASEFEE_BUFFER (1.5): a buy-time gate should be STRICTLY MORE
// conservative than the live clamp (D-QUALITY-FIRST — refuse a marginal entry
// rather than risk an unexitable one). applyGasMultiplier guarantees no float
// drift and is the banned-v5-pattern-safe scaling helper.
import { applyGasMultiplier } from './utils/mevStrategies/types';
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
        | 'stale-data'
        // Phase 21.2 / Plan 21.2-08 (Finding A): buy-time entry affordability gate
        // — REFUSE a snipe the wallet cannot guarantee an exit from.
        | 'entry-exit-affordability';
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

// The literal DASHBOARD_API_KEY value shipped in .env.example:73. Must match
// byte-for-byte so the cross-env rule below FATAL-rejects a bot that boots on
// the known-default admin credential (Phase 20 live UAT gap). For a phase whose
// goal is "refuses to start in any unsafe state," a default admin key IS an
// unsafe startup state.
const DASHBOARD_API_KEY_PLACEHOLDER = 'your-secret-dashboard-api-key-here';

// Phase 21.2 / Plan 21.2-08 (Finding A, D-EXIT-AFFORDABILITY-GATE) constants.
//
// EXIT_GATE_SELL_GAS_BUFFER default — the base-fee multiplier applied when pricing
// the worst-case GUARANTEED PUBLIC exit gas at buy time. Matches config.ts:192 +
// .env.example:250 (default 2.0). The gate prices a NORMAL-priced public sell
// (baseFee × this buffer), NOT a high private priority fee — that is the whole
// point of Finding A: the always-available exit must always be affordable.
const EXIT_GATE_SELL_GAS_BUFFER_DEFAULT = 2.0;

// 21.3-02 / STOP-THE-LINE-05-C / D-BUY-AFFORDABILITY-EXTEND: the base-fee
// multiplier on a DELIBERATE buy's worst-case PUBLIC-FALLBACK buy gas reserve.
// A deliberate buy may broadcast a normal-priced public buy if the private
// submission misses; the entry gate (deliberate mode only) reserves that gas so
// the deliberate path never strands its own fallback. Registered required:false
// in config.ts / .env.example (21.3-00); default mirrors the sell-gate buffer (2.0).
const DELIBERATE_BUY_GAS_BUFFER_DEFAULT = 2.0;

// One-time ERC-20 approval gas the public exit may need (the private MEV strategy
// already holds its approval, but the guaranteed PUBLIC fallback the gate prices
// against may have to approve first). A standard ERC-20 approve is ~46k gas; we
// reserve a generous 60k (D-QUALITY-FIRST — over-reserve a touch rather than
// strand the exit's approval). Reserved at the same normal public-sell price.
const EXIT_GATE_APPROVAL_GAS_LIMIT = 60_000n;

const EXIT_GATE_DOC = 'docs/operations/going-live.md';

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
    // CR-01 fix: `||` treated MAX_OPEN_POSITIONS=0 as falsy → defaulted to 10,
    // inflating the wallet floor by 10x. An operator who deliberately sets
    // MAX_OPEN_POSITIONS=0 to halt new entries would either fail preflight on a
    // partially-funded wallet, or pass preflight with a falsely-high floor that
    // then trips spurious mid-run undercut auto-pauses. Use explicit
    // undefined/empty check + strict integer validation instead.
    const maxOpenRaw = process.env.MAX_OPEN_POSITIONS;
    const maxOpen = maxOpenRaw === undefined || maxOpenRaw === ''
        ? 10
        : Number(maxOpenRaw);
    if (!Number.isInteger(maxOpen) || maxOpen < 0) {
        return {
            chain: chain.name,
            check: 'wallet-balance',
            passed: false,
            reason: `MAX_OPEN_POSITIONS must be a non-negative integer; got "${maxOpenRaw}"`,
            details: { maxOpenPositions: maxOpenRaw },
        };
    }
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
// Buy-time entry affordability gate — Finding A / D-EXIT-AFFORDABILITY-GATE
// (Phase 21.2 / Plan 21.2-08, STOP-THE-LINE-04-A)
// ---------------------------------------------------------------------------

/** Inputs for the worst-case GUARANTEED-public-exit gas (the entry-gate term). */
export interface WorstCasePublicExitGasInputs {
    /** baseFee in wei — getFeeData().maxFeePerGas - maxPriorityFeePerGas, or gasPrice. */
    baseFeeWei: bigint;
    /** Gas limit reserved for the eventual sell (ctx.chain.gas.maxGasLimit). */
    sellGasLimit: bigint;
    /** One-time ERC-20 approval gas the PUBLIC exit may need. Defaults to the
     *  entry-gate's generous 60k reserve. */
    approvalGasLimit?: bigint;
    /** Base-fee multiplier (EXIT_GATE_SELL_GAS_BUFFER). Defaults to 2.0. */
    sellGasBuffer?: number;
}

/**
 * The worst-case GUARANTEED-public-exit gas the buy-time entry gate must reserve
 * (Finding A / D-EXIT-AFFORDABILITY-GATE).
 *
 *   worstCasePublicSellGas = (sellGasLimit + approvalGasLimit) × (baseFee × buffer)
 *
 * The exit's GUARANTEED inclusion path is the PUBLIC-mempool sell — a NORMAL-PRICED
 * tx (base fee × a modest buffer, NO high private priority fee). That is the whole
 * point of Finding A: the always-available exit must always be affordable, so the
 * gate prices THAT, not the optimistic private priority-fee path. Pricing the
 * private CEILING (e.g. 25 gwei) would both over-reserve AND mis-target what the
 * guaranteed exit actually costs.
 *
 * All scaling uses the shared fractional-bigint `applyGasMultiplier` helper (no
 * float drift, banned-v5-pattern-safe) — the SAME spelling the MEV strategies and
 * the runtime sell reserve (computePublicExitReserveWei) use, so the buy-time gate
 * and the runtime clamp agree on the math. The gate's buffer (EXIT_GATE_SELL_GAS_-
 * BUFFER, default 2.0) is deliberately ≥ the runtime SELL_GAS_BASEFEE_BUFFER (1.5):
 * a buy-time gate should be STRICTLY MORE conservative than the live clamp.
 */
export function computeWorstCasePublicExitGas(inputs: WorstCasePublicExitGasInputs): bigint {
    const {
        baseFeeWei,
        sellGasLimit,
        approvalGasLimit = EXIT_GATE_APPROVAL_GAS_LIMIT,
        sellGasBuffer = EXIT_GATE_SELL_GAS_BUFFER_DEFAULT,
    } = inputs;
    // Normal-priced public exit: base fee × buffer (NO private priority-fee term).
    const bufferedBaseFee = (applyGasMultiplier(baseFeeWei, sellGasBuffer) ?? baseFeeWei) as bigint;
    // A public sell may need a one-time approval; reserve its gas at the same price.
    return (sellGasLimit + approvalGasLimit) * bufferedBaseFee;
}

/** Parse EXIT_GATE_SELL_GAS_BUFFER from env — never NaN, never ≤0 (mirrors the
 *  reconciliation.ts parsePositiveNumber discipline, V5 input-validation domain). */
function parseExitGateBuffer(): number {
    const raw = process.env.EXIT_GATE_SELL_GAS_BUFFER;
    if (raw === undefined || raw === '') return EXIT_GATE_SELL_GAS_BUFFER_DEFAULT;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : EXIT_GATE_SELL_GAS_BUFFER_DEFAULT;
}

/** Parse DELIBERATE_BUY_GAS_BUFFER from env — never NaN, never ≤0 (same
 *  parsePositiveNumber discipline as parseExitGateBuffer). The base-fee
 *  multiplier on the DELIBERATE buy's worst-case public-fallback gas reserve
 *  (registered required:false in config.ts / .env.example in 21.3-00, default 2.0). */
function parseDeliberateBuyBuffer(): number {
    const raw = process.env.DELIBERATE_BUY_GAS_BUFFER;
    if (raw === undefined || raw === '') return DELIBERATE_BUY_GAS_BUFFER_DEFAULT;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : DELIBERATE_BUY_GAS_BUFFER_DEFAULT;
}

/**
 * Derive the wei base fee from a getFeeData() result. EIP-1559 chains expose
 * maxFeePerGas + maxPriorityFeePerGas (baseFee = maxFee - priority); legacy chains
 * (BSC) expose gasPrice only. Returns null when neither is available (caller
 * fails closed). Worst-case BUY gas is priced at the FULL maxFeePerGas (or
 * gasPrice) — the most the buy can pay — so the gate never UNDER-reserves the buy.
 */
function deriveFeeWei(feeData: {
    maxFeePerGas?: bigint | null;
    maxPriorityFeePerGas?: bigint | null;
    gasPrice?: bigint | null;
}): { baseFeeWei: bigint; maxBuyFeeWei: bigint } | null {
    if (feeData.maxFeePerGas != null) {
        const priority = feeData.maxPriorityFeePerGas ?? 0n;
        // baseFee = maxFee - priority, clamped ≥ 0 (defensive against odd oracles).
        const baseFeeWei = feeData.maxFeePerGas > priority ? feeData.maxFeePerGas - priority : 0n;
        return { baseFeeWei, maxBuyFeeWei: feeData.maxFeePerGas };
    }
    if (feeData.gasPrice != null) {
        // Legacy: gasPrice is both the base price and the max the buy pays.
        return { baseFeeWei: feeData.gasPrice, maxBuyFeeWei: feeData.gasPrice };
    }
    return null;
}

/**
 * The hard buy-time entry affordability gate (Finding A / D-EXIT-AFFORDABILITY-GATE,
 * STOP-THE-LINE-04-A): NEVER enter a position the wallet cannot guarantee an exit
 * from. Refuses the snipe unless:
 *
 *   balance >= snipeValue + worstCaseBuyGas + worstCasePublicSellGas + cushion
 *
 * where
 *   worstCaseBuyGas        = maxGasLimit × maxFeePerGas         (the most the buy can pay)
 *   worstCasePublicSellGas = (maxGasLimit + approvalGas) × (baseFee × EXIT_GATE_SELL_GAS_BUFFER)
 *                            — a NORMAL-priced GUARANTEED public sell (Finding A)
 *   cushion                = parseEther(gasBuffer)              (the per-chain fixed cushion)
 *
 * Posture mirrors `checkWalletBalance` (same parseEther + per-chain gasBuffer
 * idiom) and FAILS CLOSED on any RPC error in the balance/fee fetch (a thin or
 * unknown balance refuses the snipe — never enter what you cannot prove you can
 * exit). All math is bigint (no float; T-21.2-GATE-FLOAT). The result is a pure
 * PreflightResult; the snipe path (bot.ts) logs D-ALERTS + skips on passed:false.
 *
 * Exported so bot.ts can call it at BOTH the V2 and V3 buy submit sites without
 * duplicating the formula (the thin-wallet trap is identical on both paths).
 *
 * 21.3-02 / STOP-THE-LINE-05-C / D-BUY-AFFORDABILITY-EXTEND — MODE-AWARE:
 *   - mode='snipe' (DEFAULT): a genuine snipe has NO public fallback, so it
 *     reserves ZERO public-buy gas it will never use. The floor is BYTE-FOR-BYTE
 *     the 21.2 floor (snipeValue + worstCaseBuyGas + worstCasePublicSellGas +
 *     cushion). Defaulting to 'snipe' keeps every existing call site unchanged
 *     until plan 03 threads the deliberate mode through.
 *   - mode='deliberate': a deliberate buy's worst case INCLUDES a public broadcast
 *     (the private-first submission may miss → public fallback). The gate adds a
 *     worstCasePublicBuyGas term so the deliberate path never strands its own
 *     fallback. That term REUSES computeWorstCasePublicExitGas with
 *     approvalGasLimit:0n (a buy spends ETH — no ERC-20 approve) and the
 *     DELIBERATE_BUY_GAS_BUFFER multiplier (default 2.0). The deliberate floor is
 *     therefore strictly GREATER than the snipe floor for the same balance/fee.
 *
 * The fail-closed-on-RPC-error posture is preserved for BOTH modes.
 */
export async function checkEntryExitAffordability(
    chain: PreflightChain,
    mode: 'snipe' | 'deliberate' = 'snipe',
    // 21.3-06 / CR-01: the ACTUAL buy value to price the floor against. A deliberate
    // buy's spend (scripts/deliberate-buy.ts → an arbitrary parseEther(amountArg))
    // can be MUCH larger than chain.snipeAmount; pricing the floor on snipeAmount
    // (the pre-CR-01 bug) lets a too-large deliberate buy PASS and then strand its
    // own exit. Defaults to parseEther(chain.snipeAmount) so the snipe call sites
    // (which pass nothing) are BYTE-FOR-BYTE unchanged.
    buyValueWei?: bigint,
): Promise<PreflightResult> {
    const sellGasBuffer = parseExitGateBuffer();
    const sellGasLimit = chain.gas.maxGasLimit;
    try {
        // Fail-closed posture: both reads inside the try so a throw on EITHER
        // refuses the snipe (T-21.2-GATE-RPCFAIL). Parallel for one round-trip.
        const [balance, feeData] = await Promise.all([
            chain.httpProvider.getBalance(chain.wallet.address),
            chain.httpProvider.getFeeData(),
        ]);

        const fees = deriveFeeWei(feeData);
        if (fees === null) {
            // No usable fee data → cannot price the exit → fail closed.
            return {
                chain: chain.name,
                check: 'entry-exit-affordability',
                passed: false,
                reason: `entry-exit-affordability (${mode}): getFeeData returned no maxFeePerGas/gasPrice — cannot price the guaranteed exit; refusing buy (fail-closed) — see ${EXIT_GATE_DOC}`,
                details: { mode, feeData: { maxFeePerGas: feeData.maxFeePerGas?.toString() ?? null, gasPrice: feeData.gasPrice?.toString() ?? null } },
            };
        }
        const { baseFeeWei, maxBuyFeeWei } = fees;

        // 21.3-06 / CR-01: price the floor against the REAL buy value. buyValueWei is
        // the operator's actual deliberate spend (threaded from executeDeliberateBuy);
        // when omitted (every snipe call site) it defaults to parseEther(chain.snipeAmount)
        // so the snipe floor is byte-for-byte the pre-21.3-06 value.
        const snipeValue = buyValueWei ?? ethers.parseEther(chain.snipeAmount);
        // Worst-case BUY gas: the most the buy can pay (maxFeePerGas / gasPrice).
        const worstCaseBuyGas = sellGasLimit * maxBuyFeeWei;
        // Worst-case GUARANTEED PUBLIC sell gas (Finding A — normal-priced, + approval).
        const worstCasePublicSellGas = computeWorstCasePublicExitGas({
            baseFeeWei,
            sellGasLimit,
            approvalGasLimit: EXIT_GATE_APPROVAL_GAS_LIMIT,
            sellGasBuffer,
        });
        // 21.3-02 / D-BUY-AFFORDABILITY-EXTEND — MODE-AWARE public-BUY-gas reserve:
        //   - deliberate: reserve the deliberate buy's OWN worst-case public-fallback
        //     gas, REUSING the single-source-of-truth helper with approvalGasLimit:0n
        //     (a buy spends ETH — no ERC-20 approve) + DELIBERATE_BUY_GAS_BUFFER.
        //   - snipe: ZERO — a genuine snipe has no public fallback to reserve for.
        const worstCasePublicBuyGas =
            mode === 'deliberate'
                ? computeWorstCasePublicExitGas({
                      baseFeeWei,
                      sellGasLimit, // the buy gas limit == chain.gas.maxGasLimit (same limit)
                      approvalGasLimit: 0n, // a buy needs no approve — spends ETH directly
                      sellGasBuffer: parseDeliberateBuyBuffer(),
                  })
                : 0n;
        // Per-chain fixed cushion (same parseEther(gasBuffer) idiom as checkWalletBalance).
        const cushion = ethers.parseEther(chain.gasBuffer);

        const floor = snipeValue + worstCaseBuyGas + worstCasePublicSellGas + worstCasePublicBuyGas + cushion;
        const passed = balance >= floor;

        return {
            chain: chain.name,
            check: 'entry-exit-affordability',
            passed,
            reason: passed
                ? undefined
                : `entry-exit-affordability (${mode}): wallet cannot guarantee an exit — balance ${ethers.formatEther(balance)} < floor ${ethers.formatEther(floor)} ${chain.nativeCurrency} (snipe ${ethers.formatEther(snipeValue)} + worstCaseBuyGas ${ethers.formatEther(worstCaseBuyGas)} + worstCasePublicSellGas ${ethers.formatEther(worstCasePublicSellGas)} + worstCasePublicBuyGas ${ethers.formatEther(worstCasePublicBuyGas)} + cushion ${ethers.formatEther(cushion)}); refusing buy — top up the wallet or lower the snipe amount, see ${EXIT_GATE_DOC}`,
            details: {
                mode,
                balance: ethers.formatEther(balance),
                floor: ethers.formatEther(floor),
                snipeValue: ethers.formatEther(snipeValue),
                worstCaseBuyGas: ethers.formatEther(worstCaseBuyGas),
                worstCasePublicSellGas: ethers.formatEther(worstCasePublicSellGas),
                worstCasePublicBuyGas: ethers.formatEther(worstCasePublicBuyGas),
                cushion: ethers.formatEther(cushion),
                baseFeeWei: baseFeeWei.toString(),
                maxBuyFeeWei: maxBuyFeeWei.toString(),
                sellGasLimit: sellGasLimit.toString(),
                approvalGasLimit: EXIT_GATE_APPROVAL_GAS_LIMIT.toString(),
                sellGasBuffer,
                chainNativeCurrency: chain.nativeCurrency,
            },
        };
    } catch (err) {
        // FAIL CLOSED (T-21.2-GATE-RPCFAIL): any RPC error refuses the snipe
        // rather than risk an unexitable entry. Mirrors checkWalletBalance:181-193.
        return {
            chain: chain.name,
            check: 'entry-exit-affordability',
            passed: false,
            reason: `entry-exit-affordability (${mode}) check threw: ${(err as Error).message} — refusing buy (fail-closed; never enter what you cannot prove you can exit) — see ${EXIT_GATE_DOC}`,
            details: {
                mode,
                err: (err as Error).message,
                snipeAmount: chain.snipeAmount,
                sellGasLimit: sellGasLimit.toString(),
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

    // ENABLED_CHAINS is consulted by Rule 1, Rule 2, and Rule 4 — parse once.
    const enabledChains = (process.env.ENABLED_CHAINS || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

    // Rule 1: ENABLED_CHAINS includes eth ⇔ FLASHBOTS_AUTH_KEY non-empty
    // WR-08 fix: the previous predicate gated on `process.env.MEV_STRATEGY === 'flashbots'`,
    // but MEV_STRATEGY is NOT consulted anywhere in the env contract —
    // chainRegistry.ts hardcodes mev strategy per chain template (eth always
    // uses flashbots). So the prior rule was dead code; the per-chain FATAL
    // at chainRegistry.ts:948 caught it. This rewrite matches the actual
    // contract: if ENABLED_CHAINS contains eth, FLASHBOTS_AUTH_KEY must be set.
    if (enabledChains.includes('eth') && !process.env.FLASHBOTS_AUTH_KEY) {
        results.push({
            chain: 'global',
            check: 'cross-env-rule',
            passed: false,
            reason: 'ENABLED_CHAINS includes eth (Flashbots) but FLASHBOTS_AUTH_KEY is not set',
            details: { rule: 'eth-flashbots-auth-key' },
        });
    }

    // Rule 2: ENABLED_CHAINS includes bsc ⇔ BLOXROUTE_AUTH_HEADER non-empty
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

    // Rule 5: DASHBOARD_API_KEY must not be the shipped placeholder, empty, or
    // weak (<16 chars). Phase 20 live UAT gap — config.ts already requires the
    // key be SET (presence check), but a bot that boots on the documented
    // default 'your-secret-dashboard-api-key-here' is in an unsafe startup
    // state: anyone aware of the default can pause/resume/emergency-sell a
    // live-funds bot. This is the unsafe-STATE guard (NOT a presence check),
    // homed in validateCrossEnvRules per the UAT diagnosis. Placeholder /
    // empty / too-short are mutually exclusive (if/else-if) — exactly one
    // pushed result per invocation. The failure flows through preflight()'s
    // collect-all FATAL + Telegram + remediation-pointer path (D-ALERTS).
    const dashboardApiKey = process.env.DASHBOARD_API_KEY;
    if (dashboardApiKey === DASHBOARD_API_KEY_PLACEHOLDER) {
        results.push({
            chain: 'global',
            check: 'cross-env-rule',
            passed: false,
            reason: `DASHBOARD_API_KEY is the shipped placeholder '${DASHBOARD_API_KEY_PLACEHOLDER}' — set a strong random key; see ${REMEDIATION_DOC} §5`,
            details: { rule: 'dashboard-api-key', cause: 'placeholder' },
        });
    } else if (!dashboardApiKey || dashboardApiKey.trim() === '') {
        results.push({
            chain: 'global',
            check: 'cross-env-rule',
            passed: false,
            reason: `DASHBOARD_API_KEY is empty — set a strong random key; see ${REMEDIATION_DOC} §5`,
            details: { rule: 'dashboard-api-key', cause: 'empty' },
        });
    } else if (dashboardApiKey.trim().length < 16) {
        results.push({
            chain: 'global',
            check: 'cross-env-rule',
            passed: false,
            reason: `DASHBOARD_API_KEY too short (<16 chars) — use a strong random key; see ${REMEDIATION_DOC} §5`,
            details: { rule: 'dashboard-api-key', cause: 'too-short' },
        });
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

    // WR-06: use the cached prepared statement from db.ts (module-load) instead
    // of re-preparing on every call. Any SQL syntax error now surfaces at
    // require-time rather than first invocation, matching the pattern used by
    // every other prepared statement in the codebase.
    const rows = getStaleTradesQuery.all(nowSec - warnSec) as Array<{
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
        // CR-03 fix: previously `await sendTelegramAlert(...)` ran inside the for-loop,
        // so a hung Telegram (the exact condition where you most need fast preflight)
        // could stall the FATAL exit indefinitely. `sendTelegramAlert` has no built-in
        // timeout. Now fire alerts in parallel, each wrapped in a 5s Promise.race so
        // the entire alert phase is bounded to ≤5s regardless of failure count.
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
        }
        const alertPromises = failed.map(r =>
            Promise.race<void>([
                sendTelegramAlert(
                    `*PREFLIGHT FATAL* [${r.chain}] ${r.check}: ${r.reason ?? 'no reason'} — see ${REMEDIATION_DOC}`,
                ),
                new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error('Telegram alert timed out')), 5000),
                ),
            ]).catch(err =>
                // Telegram failure (or timeout) must not mask the FATAL exit path.
                log.warn(
                    { err: (err as Error).message, chain: r.chain, check: r.check },
                    'Telegram alert during preflight FATAL failed',
                ),
            ),
        );
        // allSettled bounds the wait to ≤5s total (every race resolves or rejects within 5s).
        await Promise.allSettled(alertPromises);
        process.exit(1);
    }

    log.info(
        { chainCount: getEnabledChains(registry).length, checkCount: results.length },
        'Preflight passed',
    );
}
