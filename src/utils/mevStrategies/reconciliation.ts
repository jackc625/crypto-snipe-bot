// src/utils/mevStrategies/reconciliation.ts
// Phase 21.1 / STOP-THE-LINE-02 — the single shared nonce-safe-retry +
// inclusion-reconciliation helper (D-SHARED-HELPER). The three MEV strategies
// (flashbots / bloXroute / passthrough — wired in plan 21.1-04) become thin
// wrappers that supply a per-strategy `submit` closure and call into
// `submitWithReconciliation`; this module owns:
//   - D-NONCE-SAFE-RETRY: re-fetch getTransactionCount('latest') each attempt;
//     STOP-and-reconcile when it advances past the submitted nonce (the
//     double-spend guard) — never base+attempt.
//   - D-RECONCILE-RECEIPT: receipt-primary, nonce-corroborating reconciliation.
//     status===1 → included, status===0 → mined-but-reverted (genuine failure,
//     NO same-nonce resubmit), receipt null + nonce check → not-landed /
//     landed-not-ours.
//   - D-CONFIRM-WINDOW: a bounded `while (Date.now() < deadline)` poll over
//     confirmWindowMs with its OWN pollMs sleep (NOT the provider's internal
//     pollingInterval).
//   - D-FEE-ESCALATION: per-retry maxPriorityFeePerGas bump, clamped to
//     min(MEV_MAX_PRIORITY_FEE_GWEI, affordabilityBound) where the affordability
//     bound always reserves sellGasLimit × fee so the exit leg can submit. If
//     even attempt-0 cannot afford the reserve → alert + throw before submitting
//     (Pitfall 7 — never strand the exit). The clamp is the FINAL authority on
//     the actually-submitted fee (CR-01 fix): the live market priority rate is
//     folded INTO the desired fee BEFORE the clamp (so the bid stays competitive)
//     and the strategies use AttemptContext.priorityFeeWei DIRECTLY with NO
//     second max() against the unclamped chain rate — that second max() is the
//     CR-01 bypass that defeated the ceiling on the buy path.
//   - D-ALERTS: every genuine-failure outcome logs a dotted `op:` + sendCtxAlert.
//
// The `MevStrategy` interface (types.ts) is UNCHANGED — this helper is an
// implementation detail behind it. Fee math reuses `applyGasMultiplier` from
// types.ts (do NOT reimplement). ethers v6 spellings ONLY — the v5 patterns
// banned by test/unit/ethersV5PatternsAbsent.test.ts (the v5 call-static
// accessor, the v5 big-number class, the v5 providers namespace, and the
// @ ethersproject scoped imports) are NOT used here; v6 uses
// contract.method.staticCall(...), native bigint, and top-level ethers exports.
import type { JsonRpcProvider, Wallet, TransactionReceipt } from 'ethers';
import { parseUnits } from 'ethers';
import { applyGasMultiplier } from './types';
import { logger } from '../logger';

/** Multiplier padding the reserved sell base-fee so a modest base-fee rise
 *  between the buy and the eventual sell does not strand the exit (1.5×).
 *  Exported so the entry-gate (21.2-08) and the config tests can compute the
 *  identical GUARANTEED public-exit reserve via {@link computePublicExitReserveWei}. */
export const SELL_GAS_BASEFEE_BUFFER = 1.5;

const log = logger.child({ module: 'mev-reconciliation' });

// -----------------------------------------------------------------------------
// Generous-but-safe defaults (RESEARCH §Q7 :244-250). These MUST match the
// .env.example + config.ts registrations. The bot runs unchanged with all unset.
// -----------------------------------------------------------------------------
export const MEV_RECONCILE_DEFAULTS = {
  /** Bounded confirm-window (ms) to poll receipt+nonce before declaring a bundle genuinely not-landed (~3-4 ETH blocks). */
  confirmWindowMs: 45_000,
  /** Poll interval (ms) within the confirm-window. */
  pollMs: 4_000,
  /** Hard absolute ceiling on escalated maxPriorityFeePerGas (gwei). Load-bearing safety cap.
   *  This is the BUY ceiling (MEV_MAX_PRIORITY_FEE_GWEI). */
  maxPriorityFeeGwei: 5,
  /** Independent SELL-leg priority-fee ceiling (gwei), decoupled from the buy ceiling
   *  (Finding A, MEV_SELL_MAX_PRIORITY_FEE_GWEI). A calm-gas thin-wallet exit may bid
   *  HARDER privately than the 5-gwei buy cap — but the affordability bound STILL clamps
   *  the final bid (Pitfall 5: "try harder, never overspend"); the public fallback (21.2-06)
   *  is the guaranteed inclusion lever, not an over-bid private one. */
  sellMaxPriorityFeeGwei: 25,
  /** Per-retry priority-fee escalation step (gwei), clamped to the ceiling + affordability bound. */
  priorityFeeStepGwei: 1,
  /** When true, the affordability bound always reserves sellGasLimit × fee so the exit leg can submit. */
  reserveSellGas: true,
} as const;

// -----------------------------------------------------------------------------
// Public types (RESEARCH §Q8 signatures — copied verbatim in shape).
// -----------------------------------------------------------------------------

export interface SubmitResult {
  /** The deterministic signed-tx hash for this attempt (block-independent). */
  signedTxHash: string;
  /** The nonce this attempt submitted (for the off-by-one guard). */
  submittedNonce: number;
  /** Strategy's own confirmation signal: did its native wait/relay report success? */
  nativeConfirmed: boolean;
}

export interface ReconcileConfig {
  confirmWindowMs: number; // MEV_CONFIRM_WINDOW_MS
  pollMs: number; // MEV_CONFIRM_POLL_MS
  maxRetries: number;
  // fee-escalation knobs + affordability inputs:
  maxPriorityFeeCeilingWei: bigint; // parseUnits(MEV_MAX_PRIORITY_FEE_GWEI,'gwei')
  priorityFeeStepWei: bigint; // parseUnits(MEV_PRIORITY_FEE_STEP_GWEI,'gwei')
  reserveSellGas: boolean; // MEV_RESERVE_SELL_GAS
  sellGasLimit: bigint; // ctx.chain.gas.maxGasLimit
}

export interface AttemptContext {
  attempt: number;
  nonce: number; // re-fetched 'latest' this attempt
  priorityFeeWei: bigint; // escalated this attempt, post-clamp
}

/** The minimal pino-like sink the helper logs through. */
export interface ReconcileLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/** Outcome of the pure reconciliation probe. */
export interface ReconcileOutcome {
  outcome: 'included' | 'reverted' | 'not-landed' | 'landed-not-ours';
  hash?: string;
  receipt?: TransactionReceipt;
}

/**
 * Build a {@link ReconcileConfig} from the process env (or any env-like map),
 * applying the RESEARCH §Q7 generous-but-safe defaults. This is the single
 * place env vars are parsed into the helper config — the config tests assert
 * each var CONTROLS this parsed value (default vs override), satisfying D-04.
 *
 * Gwei values are parsed to wei via `parseUnits(..., 'gwei')`. Non-numeric /
 * empty values fall back to the default (never NaN). `MEV_RESERVE_SELL_GAS` is
 * boolean: only the literal `'false'` (case-insensitive) disables the reserve;
 * unset/anything-else keeps the safe default `true`.
 *
 * `leg` (Finding A) selects which priority-fee ceiling feeds
 * `maxPriorityFeeCeilingWei`:
 *   - `'buy'`  → `MEV_MAX_PRIORITY_FEE_GWEI`      (default 5) — the existing buy cap.
 *   - `'sell'` → `MEV_SELL_MAX_PRIORITY_FEE_GWEI` (default 25) — the INDEPENDENT sell
 *     ceiling so a calm-gas thin-wallet exit can bid harder privately. CRITICAL: the
 *     higher ceiling raises the ceiling INPUT only — `computeAffordablePriorityFee`'s
 *     affordability bound STILL clamps the final bid (Pitfall 5: try harder, never
 *     overspend; the public fallback in 21.2-06 is the guaranteed lever).
 * Defaults to `'buy'` so the 3 existing strategy callers
 * (`buildReconcileConfig(process.env, sellGasLimit, maxRetries)`) are unchanged.
 *
 * @param env       env-like map (defaults to process.env).
 * @param sellGasLimit the per-chain sell gas limit (ctx.chain.gas.maxGasLimit).
 * @param maxRetries  retry budget (defaults to 3, matching the strategy default).
 * @param leg         'buy' (default) or 'sell' — selects the priority-fee ceiling.
 */
export function buildReconcileConfig(
  env: Record<string, string | undefined> = process.env,
  sellGasLimit: bigint,
  maxRetries = 3,
  leg: 'buy' | 'sell' = 'buy'
): ReconcileConfig {
  const confirmWindowMs = parsePositiveInt(env.MEV_CONFIRM_WINDOW_MS, MEV_RECONCILE_DEFAULTS.confirmWindowMs);
  const pollMs = parsePositiveInt(env.MEV_CONFIRM_POLL_MS, MEV_RECONCILE_DEFAULTS.pollMs);
  // Finding A: the sell leg reads its OWN independent ceiling
  // (MEV_SELL_MAX_PRIORITY_FEE_GWEI, default 25); the buy leg keeps
  // MEV_MAX_PRIORITY_FEE_GWEI (default 5). Both parsed via the same never-NaN /
  // never-negative parsePositiveNumber + gweiToWei helpers (no float drift).
  const ceilingGwei =
    leg === 'sell'
      ? parsePositiveNumber(env.MEV_SELL_MAX_PRIORITY_FEE_GWEI, MEV_RECONCILE_DEFAULTS.sellMaxPriorityFeeGwei)
      : parsePositiveNumber(env.MEV_MAX_PRIORITY_FEE_GWEI, MEV_RECONCILE_DEFAULTS.maxPriorityFeeGwei);
  const priorityFeeStepGwei = parsePositiveNumber(env.MEV_PRIORITY_FEE_STEP_GWEI, MEV_RECONCILE_DEFAULTS.priorityFeeStepGwei);
  const reserveSellGas = parseBoolDefaultTrue(env.MEV_RESERVE_SELL_GAS);

  return {
    confirmWindowMs,
    pollMs,
    maxRetries,
    maxPriorityFeeCeilingWei: gweiToWei(ceilingGwei),
    priorityFeeStepWei: gweiToWei(priorityFeeStepGwei),
    reserveSellGas,
    sellGasLimit,
  };
}

// -----------------------------------------------------------------------------
// Affordability bound (D-FEE-ESCALATION, RESEARCH §Q7 :234-240). The load-bearing
// safety mechanism: the escalated maxPriorityFeePerGas is clamped so that, after
// this buy, the wallet still holds enough to pay the eventual sell gas.
//
//   snipeValue + buyGasLimit×(baseFee + priorityFee) + reservedSellGas <= walletBalance
//   reservedSellGas = computePublicExitReserveWei = sellGasLimit × (baseFee×sellGasBuffer)  (when reserveSellGas)
//
// Finding A: the reserve targets the GUARANTEED PUBLIC exit (normal-priced), NOT the
// private priority-fee CEILING (the pre-Finding-A `+ priorityFeeCeiling` term that
// over-reserved AND mis-targeted). The ceiling now only clamps the SUBMITTED bid.
//
// Solve for the max affordable priorityFee, then clamp the desired (escalated)
// fee to min(absolute ceiling, affordabilityBound). A negative/zero affordable
// fee means even the cheapest viable buy strands the sell → unaffordable.
// -----------------------------------------------------------------------------

export interface AffordabilityInputs {
  /** Desired escalated maxPriorityFeePerGas for this attempt (pre-clamp). */
  desiredPriorityFeeWei: bigint;
  /** Operator hard ceiling: parseUnits(MEV_MAX_PRIORITY_FEE_GWEI,'gwei'). */
  ceilingWei: bigint;
  /** Wallet balance (provider.getBalance). */
  walletBalanceWei: bigint;
  /** Native value sent with the buy (e.g. snipe amount); 0n if none. */
  snipeValueWei: bigint;
  /** baseFee from provider.getFeeData() (maxFeePerGas - maxPriorityFeePerGas, or gasPrice). */
  baseFeeWei: bigint;
  /** Gas limit of the buy tx. */
  buyGasLimit: bigint;
  /** Gas limit reserved for the eventual sell (ctx.chain.gas.maxGasLimit). */
  sellGasLimit: bigint;
  /** When true, reserve sellGasLimit × fee for the exit leg. */
  reserveSellGas: boolean;
}

export interface AffordabilityResult {
  /** The clamped priority fee to actually use; only meaningful when affordable. */
  priorityFeeWei: bigint;
  /** False when even the minimum viable buy would strand the sell reserve. */
  affordable: boolean;
  /** The affordability-bound priority fee (max the wallet can afford after reserve). */
  affordabilityBoundWei: bigint;
}

/** Inputs for the GUARANTEED-public-exit gas reserve (Finding A retarget). */
export interface PublicExitReserveInputs {
  /** baseFee from provider.getFeeData() (maxFeePerGas - maxPriorityFeePerGas, or gasPrice). */
  baseFeeWei: bigint;
  /** Gas limit reserved for the eventual sell (ctx.chain.gas.maxGasLimit). */
  sellGasLimit: bigint;
  /** Optional one-time ERC-20 approval gas limit for the public exit (entry-gate / 21.2-08
   *  use). Defaults to 0n — the private MEV strategies already hold their approval. */
  approvalGasLimit?: bigint;
}

/**
 * The GUARANTEED public-exit gas reserve (Finding A / D-EXIT-AFFORDABILITY-GATE).
 *
 * The exit's GUARANTEED inclusion path is the PUBLIC mempool sell — a NORMAL-PRICED
 * tx (base fee × a modest buffer, no high private priority fee). So the affordability
 * reserve must target THAT, not the private CEILING priority fee. Reserving the
 * private ceiling (the pre-Finding-A bug) both OVER-reserves (refusing affordable
 * buys) and MIS-targets (it is not what the guaranteed exit actually costs).
 *
 *   reserve = (sellGasLimit + approvalGasLimit) × (baseFee × SELL_GAS_BASEFEE_BUFFER)
 *
 * The base-fee buffer pads a modest base-fee rise between buy and sell. All scaling
 * uses the shared fractional-bigint `applyGasMultiplier` helper (no float drift,
 * banned-v5-pattern-safe). This is the single source of truth the entry gate (21.2-08)
 * reuses so the buy-time gate and the runtime reserve agree.
 */
export function computePublicExitReserveWei(inputs: PublicExitReserveInputs): bigint {
  const { baseFeeWei, sellGasLimit, approvalGasLimit = 0n } = inputs;
  // Normal-priced public exit: base fee × buffer (NO private priority-fee ceiling term).
  const bufferedSellBaseFee = (applyGasMultiplier(baseFeeWei, SELL_GAS_BASEFEE_BUFFER) ?? baseFeeWei) as bigint;
  // A public sell may need a one-time approval; reserve its gas at the same normal price.
  return (sellGasLimit + approvalGasLimit) * bufferedSellBaseFee;
}

/**
 * Compute the affordable, clamped maxPriorityFeePerGas. Exported so the
 * stranded-exit harm-prevention test (#5) can assert the clamp + the
 * attempt-0-unaffordable detection directly.
 *
 * The reserve (`computePublicExitReserveWei`) targets the GUARANTEED public exit
 * (`SELL_GAS_BASEFEE_BUFFER` × base fee, a normal-priced tx) — NOT the private
 * priority-fee ceiling (Finding A retarget). The buffer pads a modest base-fee
 * rise between buy and sell so the public exit does not get stranded.
 */
export function computeAffordablePriorityFee(inputs: AffordabilityInputs): AffordabilityResult {
  const {
    desiredPriorityFeeWei,
    ceilingWei,
    walletBalanceWei,
    snipeValueWei,
    baseFeeWei,
    buyGasLimit,
    sellGasLimit,
    reserveSellGas,
  } = inputs;

  // First clamp the desired fee to the operator's absolute hard ceiling.
  const ceilingClamped = desiredPriorityFeeWei > ceilingWei ? ceilingWei : desiredPriorityFeeWei;

  // Reserve enough for the eventual sell. Finding A (D-EXIT-AFFORDABILITY-GATE):
  // the GUARANTEED exit is the PUBLIC-mempool sell — a normal-priced tx (base fee ×
  // buffer, NO high private priority fee). So the reserve targets THAT, via the
  // shared single-source-of-truth helper. The pre-Finding-A reserve used the private
  // CEILING priority fee (`+ ceilingWei`), which both OVER-reserved (refusing
  // affordable buys / re-opening the thin-wallet trap) AND mis-targeted (the ceiling
  // is not what the guaranteed exit actually costs). `ceilingWei` no longer feeds the
  // reserve — it only clamps the SUBMITTED bid below.
  const reservedSellGas = reserveSellGas
    ? computePublicExitReserveWei({ baseFeeWei, sellGasLimit })
    : 0n;

  // affordabilityBound: the max priorityFee such that
  //   snipeValue + buyGasLimit×(baseFee + priorityFee) + reservedSellGas <= walletBalance
  // => priorityFee <= (walletBalance - snipeValue - reservedSellGas - buyGasLimit×baseFee) / buyGasLimit
  const headroom = walletBalanceWei - snipeValueWei - reservedSellGas - buyGasLimit * baseFeeWei;

  if (headroom <= 0n || buyGasLimit <= 0n) {
    // Even at zero priority fee the wallet cannot cover the buy + sell reserve.
    return { priorityFeeWei: 0n, affordable: false, affordabilityBoundWei: 0n };
  }

  const affordabilityBoundWei = headroom / buyGasLimit;
  const priorityFeeWei = ceilingClamped < affordabilityBoundWei ? ceilingClamped : affordabilityBoundWei;

  return { priorityFeeWei, affordable: true, affordabilityBoundWei };
}

/**
 * Pure reconciliation probe — receipt-primary, nonce-corroborating
 * (D-RECONCILE-RECEIPT, RESEARCH §Q3/Q4/Q5). Probes the deterministic signed-tx
 * hash receipt first; on a null receipt it corroborates with the on-chain nonce
 * ('latest' — NEVER 'pending') and polls a bounded window.
 *
 *   receipt.status===1                         → 'included' (return real hash)
 *   receipt.status===0                         → 'reverted' (genuine failure)
 *   receipt null, latest === submittedNonce    → not-yet-mined; keep polling,
 *                                                 then 'not-landed' at deadline
 *   receipt null, latest  >  submittedNonce     → nonce consumed but our hash has
 *                                                 no receipt → 'landed-not-ours'
 *
 * Both receipt AND nonce are required signals; this is NOT `waitForTransaction`
 * keyed on receipt alone. Uses a manual bounded `while (Date.now() < deadline)`
 * poll with its own pollMs sleep.
 */
export async function reconcileInclusion(
  signedTxHash: string,
  submittedNonce: number,
  wallet: Wallet,
  provider: JsonRpcProvider,
  windowMs: number,
  pollMs: number
): Promise<ReconcileOutcome> {
  const deadline = Date.now() + windowMs;

  // Probe at least once even if windowMs is ~0 (do/while).
  let sawAdvancedNonce = false;
  do {
    const receipt = await provider.getTransactionReceipt(signedTxHash);
    if (receipt) {
      if (receipt.status === 1) {
        return { outcome: 'included', hash: signedTxHash, receipt };
      }
      if (receipt.status === 0) {
        return { outcome: 'reverted', receipt };
      }
      // status null (pre-Byzantium / unknown) — treat as not-yet-determined; keep polling.
    }

    // Receipt not yet visible — corroborate with the on-chain nonce.
    const latest = await provider.getTransactionCount(wallet.address, 'latest');
    if (latest > submittedNonce) {
      // Nonce consumed but our hash has no receipt yet. Keep polling within the
      // window for the receipt to propagate; if it never appears, the nonce was
      // consumed by some OTHER tx (manual/competing) → 'landed-not-ours'.
      sawAdvancedNonce = true;
    } else if (latest < submittedNonce) {
      // Should be impossible under the re-fetch scheme. Surface the anomaly
      // (project memory: don't dismiss anomalies) but treat as not-landed.
      log.warn(
        { op: 'mev.reconcile.nonce-anomaly', latest, submittedNonce, signedTxHash },
        'reconcileInclusion: on-chain nonce is BELOW the submitted nonce (unexpected)'
      );
    }

    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  } while (Date.now() < deadline);

  // Final receipt check after the loop (covers the propagation-lag tail where the
  // nonce advanced mid-window and the receipt lands on the very last poll).
  const finalReceipt = await provider.getTransactionReceipt(signedTxHash);
  if (finalReceipt) {
    if (finalReceipt.status === 1) return { outcome: 'included', hash: signedTxHash, receipt: finalReceipt };
    if (finalReceipt.status === 0) return { outcome: 'reverted', receipt: finalReceipt };
  }

  return { outcome: sawAdvancedNonce ? 'landed-not-ours' : 'not-landed' };
}

/**
 * Shared nonce-safe-retry + inclusion-reconciliation loop for all MEV strategies
 * (D-NONCE-SAFE-RETRY + D-RECONCILE-RECEIPT + D-CONFIRM-WINDOW + D-FEE-ESCALATION).
 * Replaces the base+attempt loop entirely.
 *
 * Per attempt:
 *   1. Re-fetch getTransactionCount('latest') as THIS attempt's nonce. If it has
 *      advanced past the PREVIOUS attempt's submitted nonce → STOP and reconcile
 *      the previous signedTxHash (do NOT submit again — the double-spend guard).
 *   2. Compute the desired priorityFee = max(step × (attempt+1), the live
 *      market priority rate `feeInputs.chainPriorityWei`) and CLAMP it to
 *      min(ceiling, affordabilityBound) which always reserves sellGasLimit × fee.
 *      The clamped value is the FINAL submitted fee (CR-01 — strategies use it
 *      directly, no second max() vs the unclamped chain rate). If attempt-0
 *      cannot afford the reserve → alert + throw before submitting.
 *   3. Build the AttemptContext and call the per-strategy `submit`. If
 *      result.nativeConfirmed → return the signed hash (strategy keeps its own
 *      included-path op log).
 *   4. Else reconcile over the confirm-window:
 *        included      → op:'mev.reconcile.included' + return the real hash
 *        reverted      → alert + op:'mev.reconcile.mined-but-reverted' + throw
 *        landed-not-ours → alert + op:'mev.reconcile.landed-not-ours' + throw
 *        not-landed    → escalate (next attempt, refetched/same nonce) unless the
 *                        ceiling is already hit → alert + op:'mev.escalation.ceiling-hit' + throw
 *
 * @param submit   per-strategy: simulate (staticCall/eth_callBundle), then submit
 *                 at AttemptContext.nonce + priorityFee, returning the signed-tx
 *                 hash + nativeConfirmed. MUST NOT itself retry.
 * @param feeInputs supplies the affordability inputs that are constant across
 *                 attempts (wallet balance, baseFee, snipe value, buy gas limit)
 *                 PLUS `chainPriorityWei` — the live market priority rate
 *                 (already multiplier-scaled by the strategy). The helper folds
 *                 it into the desired fee BEFORE the affordability/ceiling clamp
 *                 so the bid stays competitive without escaping the clamp
 *                 (CR-01 fix — the clamp is the final authority on the submitted
 *                 fee; the strategies must NOT re-introduce the unclamped chain
 *                 rate via a second max()).
 * @returns the REAL on-chain tx hash once reconciled-included.
 * @throws  on mined-but-reverted, ceiling-hit-not-included, landed-not-ours, or
 *          attempt-0-unaffordable — each with a structured op + alert.
 */
export async function submitWithReconciliation(
  submit: (a: AttemptContext) => Promise<SubmitResult>,
  wallet: Wallet,
  provider: JsonRpcProvider,
  cfg: ReconcileConfig,
  feeInputs: {
    walletBalanceWei: bigint;
    baseFeeWei: bigint;
    snipeValueWei: bigint;
    buyGasLimit: bigint;
    /** Live market priority rate (already multiplier-scaled by the strategy);
     *  folded into the desired fee BEFORE the clamp (CR-01). 0n if unknown. */
    chainPriorityWei: bigint;
  },
  logSink: ReconcileLogger = log,
  alert: (msg: string) => Promise<void> = async () => {}
): Promise<string> {
  // The nonce the PREVIOUS attempt submitted (so we can detect advancement).
  let prevSubmittedNonce: number | null = null;
  let prevSignedTxHash: string | null = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    // (1) Re-fetch 'latest' as THIS attempt's nonce (D-NONCE-SAFE-RETRY).
    const nonce = await provider.getTransactionCount(wallet.address, 'latest');

    // If the nonce advanced past what we last submitted, something landed →
    // STOP and reconcile the previous signed hash. NEVER submit a new tx here
    // (that is the double-spend the base+attempt scheme caused).
    if (prevSubmittedNonce !== null && prevSignedTxHash !== null && nonce > prevSubmittedNonce) {
      logSink.info(
        { op: 'mev.reconcile.nonce-advanced', nonce, prevSubmittedNonce, attempt },
        'Nonce advanced past the last submitted nonce — reconciling without resubmit'
      );
      const outcome = await reconcileInclusion(
        prevSignedTxHash,
        prevSubmittedNonce,
        wallet,
        provider,
        cfg.confirmWindowMs,
        cfg.pollMs
      );
      return await resolveOutcome(outcome, prevSignedTxHash, logSink, alert, { attempt, ceilingHit: false });
    }

    // (2) Escalate the priority fee for this attempt, then clamp by affordability.
    // attempt 0 starts at one step (a sane floor); each retry adds a step:
    //   escalated = step × (attempt + 1).
    const escalatedPriorityFeeWei = cfg.priorityFeeStepWei * BigInt(attempt + 1);

    // CR-01 fix: fold the live market priority rate (already multiplier-scaled by
    // the strategy) INTO the desired fee BEFORE the clamp, so the bid stays
    // competitive with the going rate without escaping the affordability/ceiling
    // clamp. The clamp below is then the FINAL authority on the submitted fee —
    // the strategies use aff.priorityFeeWei DIRECTLY (NO second max() against the
    // unclamped chain rate, which was the CR-01 bypass that defeated the ceiling
    // and the sell-gas reserve on the buy path).
    const desiredPriorityFeeWei =
      feeInputs.chainPriorityWei > escalatedPriorityFeeWei
        ? feeInputs.chainPriorityWei
        : escalatedPriorityFeeWei;

    const aff = computeAffordablePriorityFee({
      desiredPriorityFeeWei,
      ceilingWei: cfg.maxPriorityFeeCeilingWei,
      walletBalanceWei: feeInputs.walletBalanceWei,
      snipeValueWei: feeInputs.snipeValueWei,
      baseFeeWei: feeInputs.baseFeeWei,
      buyGasLimit: feeInputs.buyGasLimit,
      sellGasLimit: cfg.sellGasLimit,
      reserveSellGas: cfg.reserveSellGas,
    });

    if (!aff.affordable) {
      // Even the cheapest viable buy would strand the sell reserve (Pitfall 7).
      const msg = `MEV submit unaffordable: wallet balance cannot cover the buy and reserve sell gas (attempt ${attempt}). Top up the wallet or lower the snipe amount before retrying.`;
      logSink.error(
        {
          op: 'mev.escalation.unaffordable',
          attempt,
          walletBalanceWei: feeInputs.walletBalanceWei.toString(),
          snipeValueWei: feeInputs.snipeValueWei.toString(),
          buyGasLimit: feeInputs.buyGasLimit.toString(),
          sellGasLimit: cfg.sellGasLimit.toString(),
        },
        'Affordability bound rejects submit — reserving sell gas would be impossible'
      );
      await alert(msg);
      throw new Error(msg);
    }

    // Detect whether we can bid no higher: the clamped fee we are about to submit
    // is already at the absolute ceiling OR at the affordability bound (CR-01: the
    // clamp is the final authority, so the fail-clean trigger must read the
    // CLAMPED submitted fee, not the raw pre-clamp escalation). Once the clamp is
    // binding, a further escalation step cannot raise the submitted fee, so a
    // not-landed outcome means we fail cleanly rather than spin pointless retries.
    const ceilingHit =
      aff.priorityFeeWei >= cfg.maxPriorityFeeCeilingWei ||
      aff.priorityFeeWei >= aff.affordabilityBoundWei;

    // (3) Submit this attempt via the per-strategy closure.
    const a: AttemptContext = { attempt, nonce, priorityFeeWei: aff.priorityFeeWei };
    const result = await submit(a);
    prevSubmittedNonce = result.submittedNonce;
    prevSignedTxHash = result.signedTxHash;

    if (result.nativeConfirmed) {
      // The strategy's own native confirm succeeded; it preserves its own
      // included-path op log (e.g. flashbots.bundle.included). Return the hash.
      return result.signedTxHash;
    }

    // (4) Native confirm did NOT report success → reconcile against chain state.
    const outcome = await reconcileInclusion(
      result.signedTxHash,
      result.submittedNonce,
      wallet,
      provider,
      cfg.confirmWindowMs,
      cfg.pollMs
    );

    if (outcome.outcome === 'included') {
      logSink.info(
        { op: 'mev.reconcile.included', minedTxHash: outcome.hash, attempt },
        'Reconciled late inclusion — native confirm lied "not included" but the tx landed'
      );
      return outcome.hash as string;
    }
    if (outcome.outcome === 'reverted') {
      const msg = `MEV tx mined but REVERTED (status 0) on attempt ${attempt}; not resubmitting the same nonce.`;
      logSink.error({ op: 'mev.reconcile.mined-but-reverted', attempt, signedTxHash: result.signedTxHash }, msg);
      await alert(msg);
      throw new Error(msg);
    }
    if (outcome.outcome === 'landed-not-ours') {
      const msg = `MEV nonce ${result.submittedNonce} was consumed by a different tx (no receipt for our hash) on attempt ${attempt}; failing loudly to avoid a double-action.`;
      logSink.error({ op: 'mev.reconcile.landed-not-ours', attempt, submittedNonce: result.submittedNonce }, msg);
      await alert(msg);
      throw new Error(msg);
    }

    // outcome === 'not-landed' → genuinely not included this attempt.
    if (ceilingHit || attempt >= cfg.maxRetries) {
      const msg = `MEV bundle not included after ${attempt + 1} attempt(s); priority-fee ceiling (${cfg.maxPriorityFeeCeilingWei.toString()} wei) reached. Increase MEV_MAX_PRIORITY_FEE_GWEI (within affordability) or resubmit manually.`;
      logSink.error(
        { op: 'mev.escalation.ceiling-hit', attempt, ceilingWei: cfg.maxPriorityFeeCeilingWei.toString() },
        msg
      );
      await alert(msg);
      throw new Error(msg);
    }

    logSink.warn(
      { op: 'mev.reconcile.not-landed', attempt, nextPriorityFeeStepWei: cfg.priorityFeeStepWei.toString() },
      'Bundle genuinely not landed this attempt — escalating priority fee and retrying'
    );
    // Loop continues: next attempt re-fetches the nonce (same/advanced) and escalates.
  }

  // Loop exhausted without an included/error outcome (defensive — the ceiling/
  // maxRetries guard above normally throws first).
  const msg = `MEV submit exhausted ${cfg.maxRetries + 1} attempts without inclusion.`;
  logSink.error({ op: 'mev.escalation.ceiling-hit', maxRetries: cfg.maxRetries }, msg);
  await alert(msg);
  throw new Error(msg);
}

/**
 * Resolve a reconciliation outcome reached via the nonce-advanced short-circuit
 * (step 1) into a returned hash or a thrown genuine failure. Shares the exact
 * op:/alert vocabulary with the main loop.
 */
async function resolveOutcome(
  outcome: ReconcileOutcome,
  signedTxHash: string,
  logSink: ReconcileLogger,
  alert: (msg: string) => Promise<void>,
  meta: { attempt: number; ceilingHit: boolean }
): Promise<string> {
  if (outcome.outcome === 'included') {
    logSink.info(
      { op: 'mev.reconcile.included', minedTxHash: outcome.hash, attempt: meta.attempt },
      'Reconciled inclusion after nonce advanced — the prior attempt landed'
    );
    return outcome.hash as string;
  }
  if (outcome.outcome === 'reverted') {
    const msg = `MEV tx mined but REVERTED (status 0) (nonce-advanced reconcile, attempt ${meta.attempt}).`;
    logSink.error({ op: 'mev.reconcile.mined-but-reverted', attempt: meta.attempt, signedTxHash }, msg);
    await alert(msg);
    throw new Error(msg);
  }
  if (outcome.outcome === 'landed-not-ours') {
    const msg = `MEV nonce advanced but our hash has no receipt (landed-not-ours, attempt ${meta.attempt}); failing loudly.`;
    logSink.error({ op: 'mev.reconcile.landed-not-ours', attempt: meta.attempt, signedTxHash }, msg);
    await alert(msg);
    throw new Error(msg);
  }
  // not-landed despite an advanced nonce: the nonce moved but neither our receipt
  // nor a competing consumer is visible. Treat as landed-not-ours (loud failure)
  // rather than silently resubmitting (which would risk a double-action).
  const msg = `MEV nonce advanced but reconciliation found no receipt within the window (attempt ${meta.attempt}); failing loudly to avoid a double-action.`;
  logSink.error({ op: 'mev.reconcile.landed-not-ours', attempt: meta.attempt, signedTxHash }, msg);
  await alert(msg);
  throw new Error(msg);
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseBoolDefaultTrue(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  return raw.trim().toLowerCase() !== 'false';
}

/** Convert a gwei number (possibly fractional) to a wei bigint via parseUnits. */
function gweiToWei(gwei: number): bigint {
  // parseUnits needs a string; cap fractional precision to 9 (gwei has 9 decimals
  // to wei) so e.g. 1.5 gwei → 1_500_000_000 wei without float drift.
  return parseUnits(gwei.toFixed(9), 'gwei');
}
