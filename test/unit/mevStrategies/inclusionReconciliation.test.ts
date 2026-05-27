// test/unit/mevStrategies/inclusionReconciliation.test.ts
// Phase 21.1 Plan 21.1-01 / Task 2 — Wave-0 Nyquist RED stub file.
//
// This file is the FAILING-TEST CONTRACT (RED before GREEN, mirroring the Phase
// 20-00 wave-0-stub pattern) for the inclusion-reconciliation + nonce-safe-retry
// fix (STOP-THE-LINE-02) and the V2 real-buy-inside-safety-check removal
// (STOP-THE-LINE-03). Every harm-prevention assertion in
// `21.1-VALIDATION.md §"Harm-Prevention Assertions"` is born here as a named,
// greppable `it.skip(...)` placeholder so none is omitted before the GREEN waves
// begin. The mocking HARNESS is established now (Flashbots `vi.mock` factory +
// module-scope `waitResolution` let + logger capture + `beforeEach`
// re-registration under `vitest.config.ts` `mockReset:true`) so later waves only
// flip `it.skip`→`it` and fill the bodies — they do NOT have to rebuild the mocks.
//
// NOTE: every test below is `it.skip` (skipped, NOT failing-red). The Wave-0
// commit keeps `npx vitest run --project unit` green-with-skips (Phase 20-00
// convention). D-04's no-hollow-fill rule applies to ENABLED tests; these are
// skipped scaffolds, so placeholder bodies (`expect(true).toBe(false)`) are
// acceptable until each is un-skipped and filled by its owning GREEN plan.
//
// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION.md harm-prevention assertion → `it.skip` title map (the binding):
//   #1 false-negative-loses-position  → titles prefixed "false-negative-loses-position:"
//        (Flashbots wait()=1, Flashbots wait()=2, bloXroute axios timeout,
//         passthrough tx.wait(3) timeout — all three strategies)
//   #2 double-spend                    → titles prefixed "double-spend:"
//   #4 mined-but-reverted false-success→ title prefixed "mined-but-reverted false-success:"
//   #5 stranded-exit (D-FEE-ESCALATION)→ title prefixed "stranded-exit:"
//   SC4 sell-leg inherits              → title prefixed "sell-leg inherits (SC4):"
//   D-RECORD-REAL-HASH                 → title prefixed "D-RECORD-REAL-HASH:"
//   #6 V2-unsafe-real-buy (STOP-THE-LINE-03) → title containing "V2-unsafe-real-buy (STOP-THE-LINE-03)"
//        GREEN form owned by plan 21.1-03 (the V2 hasHighTransferTaxForChain removal).
// ─────────────────────────────────────────────────────────────────────────────
//
// Owning GREEN plans (per 21.1-VALIDATION.md Per-Task Verification Map):
//   STOP-THE-LINE-02 (#1, #2, #4, #5, SC4) → plan 21.1-04 (the shared
//     reconciliation helper + all three strategies + fee escalation).
//   D-RECORD-REAL-HASH                      → plan 21.1-05 (buy-row real hash).
//   STOP-THE-LINE-03 (#6 V2-unsafe-real-buy)→ plan 21.1-03 (the V2 removal).
//
// Cited mocking analogs (copy these idioms when un-skipping):
//   - test/unit/mevStrategies/flashbotsBundleHash.test.ts — the Flashbots
//     `vi.mock` recipe + module-scope `waitResolution` + `beforeEach`
//     re-registration (mockReset:true), reproduced below.
//   - test/unit/mevStrategies/gasMultiplier.test.ts — capturing the submitted tx
//     via `.mock.calls[0][0]` (the SC3 same-nonce assertion idiom); the bloXroute
//     `vi.spyOn(axios.default,'post')` spy; the passthrough wallet stub.
//   - test/helpers/mockProvider.ts — `createMockProvider` (defaults
//     `getTransactionReceipt→{status:1}`, `getTransactionCount→42`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseEther, parseUnits } from 'ethers';
import type { JsonRpcProvider, Wallet, TransactionRequest } from 'ethers';
import { createMockProvider } from '../../helpers/mockProvider';
import * as fs from 'fs';
import * as path from 'path';
// TYPE-ONLY import: erased at runtime, so it does NOT eagerly evaluate
// reconciliation.ts (whose top-level `logger.child(...)` would trip the hoisted
// `vi.mock('../../../src/utils/logger')` factory before the logInfo let is
// initialized — a TDZ ReferenceError). The runtime functions are pulled in via
// a lazy `await import(...)` INSIDE each test, mirroring flashbotsBundleHash.test.ts.
import type {
    AttemptContext,
    ReconcileConfig,
    SubmitResult,
} from '../../../src/utils/mevStrategies/reconciliation';

// -----------------------------------------------------------------------------
// Flashbots mock harness (copied from flashbotsBundleHash.test.ts so the GREEN
// waves only flip it.skip→it + fill bodies). The module-scope `waitResolution`
// let drives bundle.wait(): 0=BundleIncluded, 1=BlockPassedWithoutInclusion,
// 2=AccountNonceTooHigh. The misreport-but-landed (LADYS) condition is
// waitResolution=1 (or 2) WHILE the provider's receipt/nonce say landed.
// -----------------------------------------------------------------------------

const STUB_BUNDLE_HASH = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const STUB_MINED_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STUB_SIGNED_TX = '0xdeadbeefSIGNEDRAWTX';

// 1=BlockPassedWithoutInclusion by default for THIS file: the reconciliation
// stubs replay the misreport-but-landed condition (wait() lies "not included").
let waitResolution = 1;

const sendBundleMock = vi.fn();
const createMock = vi.fn();

vi.mock('@flashbots/ethers-provider-bundle', () => ({
    FlashbotsBundleProvider: {
        // Re-implemented in beforeEach (mockReset:true wipes impls). Without the
        // re-registration, create resolves to undefined and sendBundle throws.
        create: createMock,
    },
}));

// Capture the module child-logger's calls so GREEN waves can assert the
// reconciliation op: fields (e.g. op:'mev.reconcile.included').
const logInfo = vi.fn();
const logWarn = vi.fn();
const logError = vi.fn();
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({ info: logInfo, warn: logWarn, error: logError, debug: vi.fn() }),
    },
}));

// A valid hex private key for the Flashbots auth-signer construction.
const AUTH_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function makeWallet(): Wallet {
    return {
        address: '0xWallet000000000000000000000000000000W01',
    } as unknown as Wallet;
}

// The misreport-but-landed provider: nonce 42 at submit, advanced to 43 once the
// tx lands; receipt says status:1. GREEN waves override per-scenario. Kept here
// so the harness is ready (Task 2 acceptance: "later waves need only un-skip +
// fill bodies").
function makeLandedProvider(): JsonRpcProvider {
    return createMockProvider({
        getTransactionCount: vi.fn().mockResolvedValueOnce(42).mockResolvedValue(43),
        getTransactionReceipt: vi.fn().mockResolvedValue({ status: 1, blockNumber: 25182801 }),
    }) as unknown as JsonRpcProvider;
}

const STUB_TX_REQ: TransactionRequest = { to: '0xRouter', data: '0x', gasLimit: 200_000n };

// -----------------------------------------------------------------------------
// Helper-logic harness (plan 21.1-02 / Task 1). These exercise
// `submitWithReconciliation` + `computeAffordablePriorityFee` DIRECTLY (pure
// helper logic) without a real strategy — the per-strategy end-to-end flips are
// owned by 21.1-04. TINY confirmWindowMs/pollMs keep the 45s prod default from
// blowing testTimeout:5000 (Pitfall 5).
// -----------------------------------------------------------------------------

/** A reconcile config with a TINY window/poll so the bounded loop returns fast. */
function tinyCfg(overrides: Partial<ReconcileConfig> = {}): ReconcileConfig {
    return {
        confirmWindowMs: 50,
        pollMs: 10,
        maxRetries: 3,
        maxPriorityFeeCeilingWei: parseUnits('5', 'gwei'),
        priorityFeeStepWei: parseUnits('1', 'gwei'),
        reserveSellGas: true,
        sellGasLimit: 300_000n,
        ...overrides,
    };
}

/** Generous fee inputs (1 ETH balance, tiny snipe) so affordability passes by default. */
function affordableFeeInputs() {
    return {
        walletBalanceWei: parseEther('1'),
        baseFeeWei: parseUnits('20', 'gwei'),
        snipeValueWei: parseEther('0.01'),
        buyGasLimit: 200_000n,
    };
}

/** A submit closure that records every AttemptContext it was called with. */
function recordingSubmit(
    result: (a: AttemptContext) => SubmitResult
): { fn: (a: AttemptContext) => Promise<SubmitResult>; calls: AttemptContext[] } {
    const calls: AttemptContext[] = [];
    const fn = vi.fn(async (a: AttemptContext) => {
        calls.push({ ...a });
        return result(a);
    });
    return { fn, calls };
}

beforeEach(() => {
    logInfo.mockReset();
    logWarn.mockReset();
    logError.mockReset();
    sendBundleMock.mockReset();
    // Re-establish create→{sendBundle} (wiped by mockReset:true — vitest.config.ts:16).
    createMock.mockReset().mockResolvedValue({ sendBundle: sendBundleMock });
    waitResolution = 1; // misreport-but-landed default for this file
    sendBundleMock.mockResolvedValue({
        bundleHash: STUB_BUNDLE_HASH,
        bundleTransactions: [
            { hash: STUB_MINED_HASH, signedTransaction: STUB_SIGNED_TX, account: '0x', nonce: 42 },
        ],
        wait: () => Promise.resolve(waitResolution),
        simulate: () => Promise.resolve({}),
        receipts: () => Promise.resolve([]),
    });
});

// Silence "declared but never read" until the GREEN waves consume these in the
// un-skipped bodies. They are part of the harness contract, intentionally
// referenced here so tsc + lint stay clean while the tests are skipped.
void STUB_BUNDLE_HASH;
void STUB_MINED_HASH;
void STUB_SIGNED_TX;
void AUTH_KEY;
void makeWallet;
void makeLandedProvider;
void STUB_TX_REQ;

// =============================================================================
// Harm-prevention assertion #1 — false-negative-loses-position
// (STOP-THE-LINE-02, SC2). Per-strategy: the native confirm reports failure
// WHILE getTransactionReceipt(signedTxHash).status===1 (and/or
// getTransactionCount('latest') advanced) → sendTransaction resolves with the
// REAL hash and does NOT throw. Owned by plan 21.1-04.
// =============================================================================

describe('STOP-THE-LINE-02 — inclusion reconciliation (false-negative harm #1)', () => {
    it.skip('false-negative-loses-position: flashbots wait()=1 but receipt.status===1 → returns real hash, no throw', async () => {
        // GREEN (21.1-04): waitResolution=1; provider receipt status 1 + nonce
        // advanced → strategy.sendTransaction resolves STUB_MINED_HASH, no throw.
        expect(true).toBe(false);
    });

    it.skip('false-negative-loses-position: flashbots wait()=2 (AccountNonceTooHigh) but receipt.status===1 → returns real hash', async () => {
        // GREEN (21.1-04): waitResolution=2 is an EVEN STRONGER "tx already landed"
        // signal — short-circuit to the receipt probe; return the real hash.
        expect(true).toBe(false);
    });

    it.skip('false-negative-loses-position: bloXroute axios timeout but receipt.status===1 → returns relay hash', async () => {
        // GREEN (21.1-04): vi.spyOn(axios.default,'post').mockRejectedValueOnce(
        // new Error('timeout')) while provider.getTransactionReceipt→{status:1};
        // assert the relay hash (data.result) is returned, axios.post called once.
        expect(true).toBe(false);
    });

    it.skip('false-negative-loses-position: passthrough tx.wait(3) timeout but receipt.status===1 → returns tx.hash', async () => {
        // GREEN (21.1-04): wallet.sendTransaction returns {hash, wait} where
        // wait(3) rejects/times-out while provider.getTransactionReceipt(hash)→
        // {status:1}; assert tx.hash returned, sendTransaction called once.
        expect(true).toBe(false);
    });
});

// =============================================================================
// Harm-prevention assertion #2 — double-spend (STOP-THE-LINE-02, SC3).
// The submit primitive fires exactly once on misreport-but-landed; a genuine
// resubmit uses the re-fetched 'latest' nonce, never base+attempt; an advanced
// 'latest' nonce at attempt start short-circuits with no submit. Owned by 21.1-04.
// =============================================================================

describe('STOP-THE-LINE-02 — nonce-safe retry (double-spend harm #2)', () => {
    it.skip('double-spend: misreport-but-landed calls the submit primitive exactly once (toHaveBeenCalledTimes(1))', async () => {
        // GREEN (21.1-04): expect(sendBundleMock).toHaveBeenCalledTimes(1) in the
        // landed-but-misreported case — no second real buy.
        expect(true).toBe(false);
    });

    it.skip('double-spend: genuine resubmit uses the re-fetched "latest" nonce, never base+attempt', async () => {
        // GREEN (21.1-04): capture the submitted tx via .mock.calls[N][0]; assert
        // capturedTx.nonce === re-fetched getTransactionCount('latest'), not base+attempt.
        expect(true).toBe(false);
    });

    it('double-spend: advanced "latest" nonce at attempt start → no submit fires that attempt (helper-logic, plan 21.1-02)', async () => {
        // Helper-logic proof (plan 21.1-02): drive submitWithReconciliation directly.
        // attempt 0 submits at nonce 42, native confirm reports false, and the first
        // reconcile finds receipt null + nonce still 42 → 'not-landed' → escalate.
        // attempt 1 re-fetches 'latest' = 43 (ADVANCED past the submitted 42) → the
        // helper STOPS and reconciles the PRIOR hash WITHOUT submitting again; the
        // receipt now reads status 1 → returns the real hash. submit fires exactly once.
        const { submitWithReconciliation } = await import('../../../src/utils/mevStrategies/reconciliation');
        const wallet = makeWallet();

        // getTransactionCount sequence:
        //   call 0 (attempt-0 nonce)            → 42
        //   call 1 (reconcile nonce-corroborate)→ 42 (still not consumed → not-landed)
        //   call 2 (attempt-1 nonce)            → 43 (ADVANCED → stop & reconcile)
        // getTransactionReceipt sequence:
        //   probe during attempt-0 reconcile    → null (not yet mined)
        //   probe during nonce-advanced reconcile→ {status:1} (landed)
        const provider = createMockProvider({
            getTransactionCount: vi.fn()
                .mockResolvedValueOnce(42)
                .mockResolvedValueOnce(42)
                .mockResolvedValue(43),
            getTransactionReceipt: vi.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValue({ status: 1, blockNumber: 25182801 }),
        }) as unknown as JsonRpcProvider;

        const submit = recordingSubmit(() => ({
            signedTxHash: STUB_MINED_HASH,
            submittedNonce: 42,
            nativeConfirmed: false, // native confirm lies "not included"
        }));

        const result = await submitWithReconciliation(
            submit.fn,
            wallet,
            provider,
            tinyCfg(),
            affordableFeeInputs(),
        );

        // The prior attempt's tx is reconciled as included → real hash returned.
        expect(result).toBe(STUB_MINED_HASH);
        // CRITICAL (double-spend guard): the submit primitive fired exactly ONCE —
        // the advanced-nonce attempt did NOT submit a second real tx.
        expect(submit.fn).toHaveBeenCalledTimes(1);
        expect(submit.calls).toHaveLength(1);
        expect(submit.calls[0].nonce).toBe(42);
    });
});

// =============================================================================
// Harm-prevention assertion #4 — mined-but-reverted false-success
// (STOP-THE-LINE-02). receipt.status===0 → sendTransaction THROWS (genuine
// failure) and does NOT resubmit the same nonce. Owned by plan 21.1-04.
// =============================================================================

describe('STOP-THE-LINE-02 — mined-but-reverted (false-success harm #4)', () => {
    it('mined-but-reverted false-success: receipt.status===0 → throws, no same-nonce resubmit (helper-logic, plan 21.1-02)', async () => {
        // Helper-logic proof (plan 21.1-02): attempt 0 submits at nonce 42, native
        // confirm reports false, reconcile finds the receipt with status 0
        // (mined-but-reverted = genuine failure). The helper THROWS and does NOT
        // resubmit the same nonce (a reverted tx is NOT a successful buy).
        const { submitWithReconciliation } = await import('../../../src/utils/mevStrategies/reconciliation');
        const wallet = makeWallet();
        const provider = createMockProvider({
            getTransactionCount: vi.fn().mockResolvedValue(42),
            // First (and immediate) receipt probe in reconcileInclusion → status 0.
            getTransactionReceipt: vi.fn().mockResolvedValue({ status: 0, blockNumber: 25182801 }),
        }) as unknown as JsonRpcProvider;

        const alert = vi.fn(async () => {});
        const submit = recordingSubmit(() => ({
            signedTxHash: STUB_MINED_HASH,
            submittedNonce: 42,
            nativeConfirmed: false,
        }));

        await expect(
            submitWithReconciliation(
                submit.fn,
                wallet,
                provider,
                tinyCfg(),
                affordableFeeInputs(),
                { info: logInfo, warn: logWarn, error: logError },
                alert,
            ),
        ).rejects.toThrow(/REVERTED/i);

        // No same-nonce resubmit: submit fired exactly once.
        expect(submit.fn).toHaveBeenCalledTimes(1);
        // D-ALERTS: a genuine failure raised a structured alert + the dotted op.
        expect(alert).toHaveBeenCalledTimes(1);
        expect(logError).toHaveBeenCalledWith(
            expect.objectContaining({ op: 'mev.reconcile.mined-but-reverted' }),
            expect.any(String),
        );
    });
});

// =============================================================================
// Harm-prevention assertion #5 — stranded-exit (D-FEE-ESCALATION).
// The fee ceiling clamps so walletBalance - buyMaxCost - reservedSellGas >= 0;
// if attempt-0 cannot afford the reserve, sendTransaction fails CLEANLY (no
// unsellable buy submitted). Owned by plan 21.1-04.
// =============================================================================

describe('STOP-THE-LINE-02 — fee escalation affordability (stranded-exit harm #5)', () => {
    it('stranded-exit: fee ceiling clamps so walletBalance - buyMaxCost - reservedSellGas >= 0; attempt-0 unaffordable → fails cleanly, no submit (helper-logic, plan 21.1-02)', async () => {
        const { submitWithReconciliation, computeAffordablePriorityFee } = await import(
            '../../../src/utils/mevStrategies/reconciliation'
        );

        // Part A — the clamp itself (computeAffordablePriorityFee, pure): with a
        // generous balance the escalated fee is clamped to min(ceiling, bound) and
        // the invariant walletBalance - buyMaxCost - reservedSellGas >= 0 holds.
        const ceilingWei = parseUnits('5', 'gwei');
        const baseFeeWei = parseUnits('20', 'gwei');
        const buyGasLimit = 200_000n;
        const sellGasLimit = 300_000n;
        const walletBalanceWei = parseEther('1');
        const snipeValueWei = parseEther('0.01');

        const clamped = computeAffordablePriorityFee({
            desiredPriorityFeeWei: parseUnits('1000', 'gwei'), // absurdly high → must clamp
            ceilingWei,
            walletBalanceWei,
            snipeValueWei,
            baseFeeWei,
            buyGasLimit,
            sellGasLimit,
            reserveSellGas: true,
        });
        expect(clamped.affordable).toBe(true);
        // Never exceeds the operator's absolute ceiling.
        expect(clamped.priorityFeeWei <= ceilingWei).toBe(true);
        // The buy max cost + the reserved sell gas both fit inside the balance.
        const reservedSellGas = sellGasLimit * ((baseFeeWei * 150n) / 100n + ceilingWei);
        const buyMaxCost = snipeValueWei + buyGasLimit * (baseFeeWei + clamped.priorityFeeWei);
        expect(walletBalanceWei - buyMaxCost - reservedSellGas >= 0n).toBe(true);

        // Part B — attempt-0 unaffordable → submitWithReconciliation fails CLEANLY,
        // no submit (the reserve for the eventual sell is preserved; Pitfall 7).
        const wallet = makeWallet();
        // A balance that cannot even cover the buy gas + the reserved sell gas.
        const provider = createMockProvider({
            getTransactionCount: vi.fn().mockResolvedValue(42),
        }) as unknown as JsonRpcProvider;
        const alert = vi.fn(async () => {});
        const submit = recordingSubmit(() => ({
            signedTxHash: STUB_MINED_HASH,
            submittedNonce: 42,
            nativeConfirmed: true,
        }));

        await expect(
            submitWithReconciliation(
                submit.fn,
                wallet,
                provider,
                tinyCfg({ sellGasLimit }),
                {
                    walletBalanceWei: parseEther('0.001'), // too low to reserve sell gas
                    baseFeeWei,
                    snipeValueWei,
                    buyGasLimit,
                },
                { info: logInfo, warn: logWarn, error: logError },
                alert,
            ),
        ).rejects.toThrow(/unaffordable/i);

        // CRITICAL (stranded-exit guard): NO buy was submitted (the sell reserve is
        // preserved — we never strand an unsellable position).
        expect(submit.fn).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledTimes(1);
        expect(logError).toHaveBeenCalledWith(
            expect.objectContaining({ op: 'mev.escalation.unaffordable' }),
            expect.any(String),
        );
    });
});

// =============================================================================
// SC4 — sell leg inherits the fix. A sell-shaped tx that is misreported-but-
// landed returns the real hash (so decodeReceipt runs and amount_out is real).
// Owned by plan 21.1-04.
// =============================================================================

describe('STOP-THE-LINE-02 (SC4) — sell leg inherits reconciliation', () => {
    it.skip('sell-leg inherits (SC4): sell-shaped tx misreport-but-landed returns real hash', async () => {
        // GREEN (21.1-04): a sell-shaped TransactionRequest through the same
        // strategy → misreport-but-landed → returns the real hash (exit inherits).
        expect(true).toBe(false);
    });
});

// =============================================================================
// D-RECORD-REAL-HASH — the buy success path records trades.tx_hash === the real
// returned hash, not the 'mev_bundle' placeholder. Owned by plan 21.1-05.
// =============================================================================

describe('D-RECORD-REAL-HASH — buy row records the real hash', () => {
    it.skip("D-RECORD-REAL-HASH: buy success path records trades.tx_hash === real hash, not 'mev_bundle'", async () => {
        // GREEN (21.1-05): assert the inserted trades row tx_hash === the real
        // hash returned by sendTxWithRetry, not the 'mev_bundle' placeholder.
        expect(true).toBe(false);
    });
});

// =============================================================================
// Harm-prevention assertion #6 — V2-unsafe-real-buy (STOP-THE-LINE-03).
// The V2 safety bank no longer references hasHighTransferTaxForChain; no real
// swapExactETHForTokens fires inside a safety check. Source/behavior assertion.
// GREEN form owned by plan 21.1-03 (the V2 removal). This is the Nyquist
// placeholder bound to VALIDATION harm-prevention #6 — its existence here is
// what guarantees the V2 anomaly is tracked, not silently dropped.
// =============================================================================

describe('STOP-THE-LINE-03 — V2 safety bank fires no real buy (V2-unsafe-real-buy harm #6)', () => {
    // The literal function name as a runtime-built string so THIS test file's own
    // source does not contain a grep-matchable bare occurrence in the assertions.
    const FN = ['hasHighTransfer', 'TaxForChain'].join('');
    const SRC_DIR = path.resolve(__dirname, '../../../src');

    it('V2-unsafe-real-buy (STOP-THE-LINE-03): the V2 safety bank no longer references hasHighTransferTaxForChain; the function is deleted and unexported (source/behavior assertion, VALIDATION harm-prevention #6)', async () => {
        // GREEN (21.1-03): the live Nyquist mirror of the source grep gate. Proves
        // BOTH STOP-THE-LINE-03 observables — (1) the tokenSafety module no longer
        // exports the broken tax function (deleted, zero callers, D-ROLLBACK), and
        // (2) src/bot.ts has zero NON-COMMENT references (both the V2 :303 and V3
        // :610 call sites AND the import removed). The authoritative buy+sell-tax
        // gate is the on-chain simulateHoneypotRoundtrip (bot.ts:253 V2 / :566 V3,
        // HONEY-07/09, fail-closed) — unchanged — so no real swapExactETHForTokens
        // fires inside a safety check anymore.

        // (1) The tokenSafety module no longer exports the function. Lazy import
        // (matches this file's convention) — the named export is simply gone, so
        // this holds regardless of the module-level ethers mock.
        const ts = await import('../../../src/utils/tokenSafety') as Record<string, unknown>;
        expect(ts[FN]).toBeUndefined();

        // (1b) Defense-in-depth source assertion: the function definition is gone
        // from tokenSafety.ts (a deleted export can never be re-imported/miscalled).
        const tokenSafetySrc = fs.readFileSync(path.join(SRC_DIR, 'utils', 'tokenSafety.ts'), 'utf8');
        expect(new RegExp(`export\\s+async\\s+function\\s+${FN}\\b`).test(tokenSafetySrc)).toBe(false);

        // (2) src/bot.ts has zero NON-COMMENT references — strip whole-line `//`
        // comments (the tombstone/rationale comments intentionally name the removed
        // function) before matching, mirroring the source grep gate in the plan's
        // <verify> block.
        const botSrc = fs.readFileSync(path.join(SRC_DIR, 'bot.ts'), 'utf8');
        const botBody = botSrc
            .split(/\r?\n/)
            .filter((l) => !l.trim().startsWith('//'))
            .join('\n');
        expect(botBody.includes(FN)).toBe(false);

        // (2b) And no signer-connected swapExactETHForTokens fires inside a safety
        // check: the clean read-only sibling simulateSwapForChain uses .staticCall
        // (audited 21.1-03), which the source still proves present.
        expect(tokenSafetySrc.includes('swapExactETHForTokens.staticCall')).toBe(true);
    });
});
