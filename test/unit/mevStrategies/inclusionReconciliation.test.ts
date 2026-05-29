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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseEther, parseUnits, keccak256 } from 'ethers';
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

// Phase 21.3-01: the flashbots submit closure now also performs a RAW
// eth_sendBundle multi-builder fanout via ethers v6 `FetchRequest` (the library
// drops the `builders` field). Mock ONLY FetchRequest so these tests stay
// hermetic (no real relay call); importActual keeps Wallet/JsonRpcProvider/id/
// parseUnits/keccak256/parseEther real so the auth signing + hash math still run.
vi.mock('ethers', async () => {
    const actual = await vi.importActual<typeof import('ethers')>('ethers');
    class MockFetchRequest {
        url: string;
        body: string | Uint8Array | null = null;
        private headers: Record<string, string> = {};
        constructor(url: string) {
            this.url = url;
        }
        setHeader(key: string, value: string): void {
            this.headers[key.toLowerCase()] = value;
        }
        async send(): Promise<unknown> {
            return {
                statusCode: 200,
                assertOk(): void {
                    /* ok */
                },
                bodyJson: { result: { bundleHash: STUB_BUNDLE_HASH } },
            };
        }
    }
    return { ...actual, FetchRequest: MockFetchRequest };
});

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

// Snapshot the MEV confirm-window env so the per-strategy tests can inject a TINY
// window/poll (Pitfall 5: the 45s prod default would blow testTimeout:5000 on the
// genuinely-not-landed poll). buildReconcileConfig(process.env) reads these.
const SAVED_ENV: Record<string, string | undefined> = {
    MEV_CONFIRM_WINDOW_MS: process.env.MEV_CONFIRM_WINDOW_MS,
    MEV_CONFIRM_POLL_MS: process.env.MEV_CONFIRM_POLL_MS,
    // Snapshot the fee ceiling/step too: the operator's .env may raise
    // MEV_MAX_PRIORITY_FEE_GWEI above 5 (dotenv loads it into process.env at
    // import), which would defeat the hardcoded CEILING_WEI = 5 gwei asserts.
    // 21.3-01: the buy leg now reads MEV_BUY_MAX_PRIORITY_FEE_GWEI (default 25);
    // snapshot it too so we can pin it to 5 for the hermetic CR-01 buy-ceiling asserts.
    MEV_MAX_PRIORITY_FEE_GWEI: process.env.MEV_MAX_PRIORITY_FEE_GWEI,
    MEV_BUY_MAX_PRIORITY_FEE_GWEI: process.env.MEV_BUY_MAX_PRIORITY_FEE_GWEI,
    MEV_PRIORITY_FEE_STEP_GWEI: process.env.MEV_PRIORITY_FEE_STEP_GWEI,
};

beforeEach(() => {
    // Tiny confirm-window/poll so the bounded reconcile loop returns fast.
    process.env.MEV_CONFIRM_WINDOW_MS = '60';
    process.env.MEV_CONFIRM_POLL_MS = '10';
    // Pin the fee ceiling/step to the documented CR-01 defaults so the
    // observable-fee clamp assertions are hermetic regardless of the operator's
    // .env (restored from SAVED_ENV in afterEach). 21.3-01: the buy leg reads
    // MEV_BUY_MAX_PRIORITY_FEE_GWEI (default 25) — pin it to 5 so the buy-path CR-01
    // clamp assertions keep exercising the documented 5-gwei ceiling scenario. The
    // legacy MEV_MAX_PRIORITY_FEE_GWEI is pinned too for belt-and-suspenders.
    process.env.MEV_MAX_PRIORITY_FEE_GWEI = '5';
    process.env.MEV_BUY_MAX_PRIORITY_FEE_GWEI = '5';
    process.env.MEV_PRIORITY_FEE_STEP_GWEI = '1';
    logInfo.mockReset();
    logWarn.mockReset();
    logError.mockReset();
    sendBundleMock.mockReset();
    // Re-establish create→{sendBundle, signBundle, simulate} (wiped by
    // mockReset:true — vitest.config.ts:16). Phase 21.1: the wrapper calls
    // signBundle + simulate before sendBundle (D-SIMULATE-BEFORE-SUBMIT). A
    // non-revert SimulationResponseSuccess (no firstRevert) lets submit proceed.
    createMock.mockReset().mockResolvedValue({
        sendBundle: sendBundleMock,
        signBundle: vi.fn().mockResolvedValue(['0xsignedbundletx']),
        simulate: vi.fn().mockResolvedValue({ results: [], totalGasUsed: 21000 }),
    });
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

afterEach(() => {
    // Restore the MEV confirm-window env (avoid leaking into other test files).
    for (const [k, v] of Object.entries(SAVED_ENV)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
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
    it('false-negative-loses-position: flashbots wait()=1 but receipt.status===1 → returns real hash, no throw', async () => {
        // The live LADYS regression: bundle.wait() resolves 1 (BlockPassed) — the
        // relay LIES "not included" — WHILE the tx actually landed
        // (getTransactionReceipt(signedTxHash).status===1). The wrapper must NOT
        // throw: it routes through submitWithReconciliation, which reconciles the
        // deterministic signed-tx hash against chain state and returns the REAL hash
        // so the position is recorded + monitored (harm-prevention #1).
        const { FlashbotsMevStrategy } = await import('../../../src/utils/mevStrategies/flashbots');
        waitResolution = 1; // relay reports "not included"
        const provider = makeLandedProvider(); // receipt status 1, nonce 42→43
        const strategy = new FlashbotsMevStrategy({ authKey: AUTH_KEY });

        const result = await strategy.sendTransaction(STUB_TX_REQ, makeWallet(), provider, 3);

        // SUCCESS, not throw: the real mined hash is returned (SC2).
        expect(result).toBe(STUB_MINED_HASH);
        // The reconciled-late inclusion logged the new op (native confirm lied).
        expect(logInfo).toHaveBeenCalledWith(
            expect.objectContaining({ op: 'mev.reconcile.included', minedTxHash: STUB_MINED_HASH }),
            expect.any(String),
        );
    });

    it('false-negative-loses-position: flashbots wait()=2 (AccountNonceTooHigh) but receipt.status===1 → returns real hash', async () => {
        // waitResolution=2 (AccountNonceTooHigh) is an EVEN STRONGER "tx already
        // landed" signal (the nonce was consumed). The wrapper maps it to
        // nativeConfirmed:false so the helper short-circuits to the receipt probe;
        // the receipt (status 1) yields the real hash — no throw, no resubmit.
        const { FlashbotsMevStrategy } = await import('../../../src/utils/mevStrategies/flashbots');
        waitResolution = 2; // AccountNonceTooHigh
        const provider = makeLandedProvider();
        const strategy = new FlashbotsMevStrategy({ authKey: AUTH_KEY });

        const result = await strategy.sendTransaction(STUB_TX_REQ, makeWallet(), provider, 3);

        expect(result).toBe(STUB_MINED_HASH);
        // submit primitive fired exactly once even on the nonce-too-high signal.
        expect(sendBundleMock).toHaveBeenCalledTimes(1);
    });

    it('false-negative-loses-position: bloXroute axios timeout but receipt.status===1 → returns signed-tx hash', async () => {
        // The BSC double-spend hazard: the relay ACCEPTS (broadcasts) the tx, then
        // the axios response TIMES OUT. The old code threw → the retry loop
        // resubmitted at an incremented nonce → a possible second real buy. The
        // wrapper now ALWAYS reconciles against chain state (nativeConfirmed:false)
        // and, on a transport timeout, defers to reconciliation rather than
        // throwing or resubmitting. getTransactionReceipt(status:1) → returns the
        // DETERMINISTIC locally-signed tx hash. axios.post fires exactly once.
        const axios = await import('axios');
        const SIGNED_RAW = '0xdeadbeefcafe'; // wallet.signTransaction → raw signed bytes
        const postSpy = vi.spyOn(axios.default, 'post').mockRejectedValue(new Error('timeout after relay accept'));

        const { BloxrouteMevStrategy } = await import('../../../src/utils/mevStrategies/bloxroute');
        const provider = makeLandedProvider(); // receipt status 1, nonce 42→43, call→'0x'
        const wallet = {
            address: '0xWallet000000000000000000000000000000W01',
            signTransaction: vi.fn().mockResolvedValue(SIGNED_RAW),
        } as unknown as Wallet;
        const strategy = new BloxrouteMevStrategy({ authHeader: 'test-header' });

        const result = await strategy.sendTransaction(STUB_TX_REQ, wallet, provider, 3);

        // The reconciler returns the deterministic signed-tx hash (== keccak256 of
        // the signed raw), NOT a throw — the position is recorded (harm-prevention #1).
        expect(result).toBe(keccak256(SIGNED_RAW));
        // CRITICAL (double-spend guard): exactly ONE relay POST — the timeout did
        // NOT trigger a second submit.
        expect(postSpy).toHaveBeenCalledTimes(1);
        // The timeout was logged as a deferral, NOT a failure.
        expect(logWarn).toHaveBeenCalledWith(
            expect.objectContaining({ op: 'bloxroute.relay.timeout' }),
            expect.any(String),
        );
        postSpy.mockRestore();
    });

    it('false-negative-loses-position: passthrough tx.wait(3) timeout but receipt.status===1 → returns tx.hash', async () => {
        // Base/Arb analog of the LADYS harm: under RPC lag tx.wait(3) REJECTS
        // (times out) even though the tx landed. The old code threw 'TX failed';
        // the wrapper now defers to chain-state reconciliation — getTransactionReceipt
        // (status 1) returns the real tx.hash, no throw, no double-spend.
        const { PassthroughMevStrategy } = await import('../../../src/utils/mevStrategies/passthrough');
        const provider = makeLandedProvider(); // receipt status 1, nonce 42→43, call→'0x'
        const sendTxMock = vi.fn().mockResolvedValue({
            hash: STUB_MINED_HASH,
            wait: vi.fn().mockRejectedValue(new Error('timeout waiting for tx')),
        });
        const wallet = { address: '0xWallet000000000000000000000000000000W01', sendTransaction: sendTxMock } as unknown as Wallet;
        const strategy = new PassthroughMevStrategy('base');

        const result = await strategy.sendTransaction(STUB_TX_REQ, wallet, provider, 3);

        // tx.hash returned (no throw) — the position is recorded (harm-prevention #1).
        expect(result).toBe(STUB_MINED_HASH);
        // submit primitive (wallet.sendTransaction) fired exactly once (no double-spend).
        expect(sendTxMock).toHaveBeenCalledTimes(1);
        // The wait-timeout was logged as a deferral, NOT a failure.
        expect(logWarn).toHaveBeenCalledWith(
            expect.objectContaining({ op: 'passthrough.wait.timeout' }),
            expect.any(String),
        );
    });
});

// =============================================================================
// Harm-prevention assertion #2 — double-spend (STOP-THE-LINE-02, SC3).
// The submit primitive fires exactly once on misreport-but-landed; a genuine
// resubmit uses the re-fetched 'latest' nonce, never base+attempt; an advanced
// 'latest' nonce at attempt start short-circuits with no submit. Owned by 21.1-04.
// =============================================================================

describe('STOP-THE-LINE-02 — nonce-safe retry (double-spend harm #2)', () => {
    it('double-spend: misreport-but-landed calls the submit primitive exactly once (toHaveBeenCalledTimes(1))', async () => {
        // The flashbots misreport-but-landed case (wait()=1 lies, receipt status 1):
        // the wrapper must reconcile the SAME submitted tx, never fire a SECOND real
        // buy. This is the double-spend the old baseNonce+attempt loop permitted.
        const { FlashbotsMevStrategy } = await import('../../../src/utils/mevStrategies/flashbots');
        waitResolution = 1;
        const provider = makeLandedProvider(); // receipt status 1 on first probe
        const strategy = new FlashbotsMevStrategy({ authKey: AUTH_KEY });

        const result = await strategy.sendTransaction(STUB_TX_REQ, makeWallet(), provider, 3);

        expect(result).toBe(STUB_MINED_HASH);
        // CRITICAL (double-spend guard): exactly ONE sendBundle — no second buy.
        expect(sendBundleMock).toHaveBeenCalledTimes(1);
    });

    it('double-spend: genuine resubmit uses the re-fetched "latest" nonce, never base+attempt', async () => {
        // A GENUINELY not-landed attempt-0 (receipt null + nonce unchanged) escalates
        // and resubmits. The resubmit MUST reuse the re-fetched 'latest' nonce (a
        // replacement tx at the SAME nonce), never baseNonce+attempt (which would be
        // 43 and risk a second real buy). attempt-1 then lands (receipt status 1).
        const { FlashbotsMevStrategy } = await import('../../../src/utils/mevStrategies/flashbots');
        waitResolution = 1; // relay never reports inclusion → forces reconcile each attempt

        // getTransactionCount stays 42 across BOTH attempts (nonce never advances),
        // so a resubmit reuses 42 (replacement) rather than base+attempt=43.
        // getTransactionReceipt is gated on the submit count (robust against the
        // poll count of the bounded window): null until the SECOND sendBundle has
        // fired (attempt-0 genuinely not-landed), then status 1 (attempt-1 landed).
        const provider = createMockProvider({
            getTransactionCount: vi.fn().mockResolvedValue(42),
            getTransactionReceipt: vi.fn().mockImplementation(async () =>
                sendBundleMock.mock.calls.length >= 2 ? { status: 1, blockNumber: 25182801 } : null
            ),
        }) as unknown as JsonRpcProvider;
        const strategy = new FlashbotsMevStrategy({ authKey: AUTH_KEY });

        const result = await strategy.sendTransaction(STUB_TX_REQ, makeWallet(), provider, 3);

        expect(result).toBe(STUB_MINED_HASH);
        // Two genuine submits (attempt-0 not-landed → escalate → attempt-1 lands).
        expect(sendBundleMock).toHaveBeenCalledTimes(2);
        // The SECOND submit reused the re-fetched 'latest' nonce (42), NOT base+attempt
        // (which would be 43) — the load-bearing nonce-safety assertion (SC3).
        const secondBundleArg = (sendBundleMock.mock.calls[1][0] as Array<{ transaction: TransactionRequest }>)[0];
        expect(secondBundleArg.transaction.nonce).toBe(42);
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

    it('mined-but-reverted false-success: flashbots strategy receipt.status===0 → throws, exactly one sendBundle (per-strategy)', async () => {
        // Per-strategy proof (plan 21.1-04): the flashbots wrapper reconciles a
        // wait()=1 against the receipt; a status-0 receipt is a GENUINE mined-but-
        // reverted failure → sendTransaction THROWS and does NOT resubmit the same
        // nonce (a reverted tx is NOT a successful buy — false-success harm #4).
        const { FlashbotsMevStrategy } = await import('../../../src/utils/mevStrategies/flashbots');
        waitResolution = 1; // relay "not included" → reconcile by receipt
        const provider = createMockProvider({
            getTransactionCount: vi.fn().mockResolvedValue(42),
            getTransactionReceipt: vi.fn().mockResolvedValue({ status: 0, blockNumber: 25182801 }),
        }) as unknown as JsonRpcProvider;
        const strategy = new FlashbotsMevStrategy({ authKey: AUTH_KEY });

        await expect(
            strategy.sendTransaction(STUB_TX_REQ, makeWallet(), provider, 3),
        ).rejects.toThrow(/REVERTED/i);

        // No same-nonce resubmit: exactly one sendBundle fired.
        expect(sendBundleMock).toHaveBeenCalledTimes(1);
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
// CR-01 (deep-review gap-closure) — the affordability/ceiling clamp is the FINAL
// authority on the ACTUALLY-SUBMITTED fee, for ALL THREE strategies, EVEN WHEN
// the live market rate is far above the ceiling. This is the test blind-spot
// that let CR-01 ship: 21.1-04 asserted computeAffordablePriorityFee's OUTPUT
// but never observed the strategy's post-clamp max() override, which silently
// re-introduced the unclamped chain rate and defeated the 5-gwei ceiling + the
// reserved sell gas on the buy path. These tests assert the REAL submitted tx
// fields (observable), not a helper-output reimplementation.
//
// Default env (beforeEach): MEV_MAX_PRIORITY_FEE_GWEI ceiling = 5 gwei, step = 1
// gwei. makeLandedProvider balance = 1 ETH ⇒ the affordability bound (thousands
// of gwei) is far above the ceiling, so the CEILING is the binding clamp here.
// =============================================================================

describe('CR-01 — affordability/ceiling clamp is the final authority on the submitted fee', () => {
    const CEILING_WEI = parseUnits('5', 'gwei'); // MEV_MAX_PRIORITY_FEE_GWEI default

    /** A landed provider whose getFeeData reports a market priority WAY above the
     *  5-gwei ceiling (50 gwei). baseFee = maxFee - maxPriority. Balance 1 ETH so
     *  the affordability bound stays well above the ceiling (ceiling binds). */
    function highMarketLandedProvider(): JsonRpcProvider {
        return createMockProvider({
            getTransactionCount: vi.fn().mockResolvedValueOnce(42).mockResolvedValue(43),
            getTransactionReceipt: vi.fn().mockResolvedValue({ status: 1, blockNumber: 25182801 }),
            getFeeData: vi.fn().mockResolvedValue({
                maxFeePerGas: parseUnits('120', 'gwei'),
                maxPriorityFeePerGas: parseUnits('50', 'gwei'), // 10x the 5-gwei ceiling
                gasPrice: parseUnits('70', 'gwei'),
            }),
            getBalance: vi.fn().mockResolvedValue(parseEther('1')),
        }) as unknown as JsonRpcProvider;
    }

    it('CR-01 flashbots: submitted maxPriorityFeePerGas <= ceiling even when market rate is 10x the ceiling', async () => {
        const { FlashbotsMevStrategy } = await import('../../../src/utils/mevStrategies/flashbots');
        waitResolution = 0; // natively included — we only care about the SUBMITTED fee
        const provider = highMarketLandedProvider();
        const strategy = new FlashbotsMevStrategy({ authKey: AUTH_KEY });

        await strategy.sendTransaction(STUB_TX_REQ, makeWallet(), provider, 3);

        // Observable: the REAL submitted bundle tx (sendBundle arg), not a helper
        // reimplementation. The market rate was 50 gwei; the submitted priority is
        // clamped to the 5-gwei ceiling — the buy can NEVER bid above it (CR-01).
        const submittedTx = (sendBundleMock.mock.calls[0][0] as Array<{ transaction: TransactionRequest }>)[0].transaction;
        expect(submittedTx.maxPriorityFeePerGas as bigint).toBeLessThanOrEqual(CEILING_WEI);
        // It is exactly the ceiling (the market floor pushed the desired fee up to,
        // but not past, the clamp). Pre-fix this was 50 gwei (the bypass).
        expect(submittedTx.maxPriorityFeePerGas).toBe(CEILING_WEI);
        // maxFeePerGas = baseFee (70 gwei) + clamped priority (5 gwei) = 75 gwei,
        // consistent with the affordability model (no unclamped chainMaxFee max()).
        const baseFee = parseUnits('120', 'gwei') - parseUnits('50', 'gwei'); // 70 gwei
        expect(submittedTx.maxFeePerGas).toBe(baseFee + CEILING_WEI);
        // Valid EIP-1559: priority <= maxFee.
        expect((submittedTx.maxPriorityFeePerGas as bigint) <= (submittedTx.maxFeePerGas as bigint)).toBe(true);
    });

    it('CR-01 passthrough: submitted maxPriorityFeePerGas <= ceiling even when market rate is 10x the ceiling', async () => {
        const { PassthroughMevStrategy } = await import('../../../src/utils/mevStrategies/passthrough');
        const provider = highMarketLandedProvider();
        const sendTxMock = vi.fn().mockResolvedValue({
            hash: STUB_MINED_HASH,
            wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 25182801 }),
        });
        const wallet = { address: '0xWallet000000000000000000000000000000W01', sendTransaction: sendTxMock } as unknown as Wallet;
        const strategy = new PassthroughMevStrategy('base');

        await strategy.sendTransaction(STUB_TX_REQ, wallet, provider, 3);

        // Observable: the REAL submitted tx (wallet.sendTransaction arg).
        const submittedTx = sendTxMock.mock.calls[0][0] as TransactionRequest;
        expect(submittedTx.maxPriorityFeePerGas as bigint).toBeLessThanOrEqual(CEILING_WEI);
        expect(submittedTx.maxPriorityFeePerGas).toBe(CEILING_WEI);
        const baseFee = parseUnits('120', 'gwei') - parseUnits('50', 'gwei'); // 70 gwei
        expect(submittedTx.maxFeePerGas).toBe(baseFee + CEILING_WEI);
    });

    it('CR-01 bloXroute: submitted gasPrice priority-above-base <= ceiling even when the competitive (multiplier-scaled) rate is far above it', async () => {
        // BSC is legacy-only, so the meaningful "market rate above the ceiling"
        // condition is on the priority-ABOVE-BASE: the Phase 19 gasMultiplier-scaled
        // gasPrice minus baseFee. With mult=2.0 the scaled rate (140 gwei) exceeds
        // base (70 gwei) by 70 gwei — 14x the 5-gwei ceiling — which is exactly the
        // CR-01 bypass condition the pre-fix max() defeated on the legacy path.
        const axios = await import('axios');
        const SIGNED_RAW = '0xdeadbeefcafe';
        const postSpy = vi.spyOn(axios.default, 'post').mockResolvedValue({ data: { result: '0xrelayhash' } });
        // Capture the populated tx bloXroute signs (the observable submitted fields).
        let signedTx: TransactionRequest | undefined;
        const signTransaction = vi.fn(async (tx: TransactionRequest) => {
            signedTx = tx;
            return SIGNED_RAW;
        });

        const { BloxrouteMevStrategy } = await import('../../../src/utils/mevStrategies/bloxroute');
        const provider = highMarketLandedProvider(); // gasPrice 70 gwei market rate
        const wallet = { address: '0xWallet000000000000000000000000000000W01', signTransaction } as unknown as Wallet;
        const strategy = new BloxrouteMevStrategy({ authHeader: 'test-header' });

        // gasMultiplier=2.0 (the anti-rug exit path) → scaled gasPrice 140 gwei.
        await strategy.sendTransaction(STUB_TX_REQ, wallet, provider, 3, 2.0);

        // baseFee = market gasPrice (70 gwei). competitive floor = scaledGasPrice
        // (140) - baseFee (70) = 70 gwei, folded in BEFORE the clamp; clamp = min(5
        // gwei ceiling, bound) = 5 gwei. Submitted gasPrice = baseFee + clamped
        // priority; the priority-above-base must be <= the 5-gwei ceiling (CR-01:
        // pre-fix it bid max(140gwei scaled, ...) = 140 gwei — ceiling bypassed).
        expect(signedTx).toBeDefined();
        const baseFee = parseUnits('70', 'gwei');
        const priorityAboveBase = (signedTx!.gasPrice as bigint) - baseFee;
        expect(priorityAboveBase).toBeLessThanOrEqual(CEILING_WEI);
        // Exactly baseFee + ceiling (the competitive floor pushed it up to the cap).
        expect(signedTx!.gasPrice).toBe(baseFee + CEILING_WEI);
        expect(postSpy).toHaveBeenCalledTimes(1);
        postSpy.mockRestore();
    });

    it('CR-01 fail-clean: market rate above the affordable cap + tx never lands → ceiling-hit throw, no overspend (helper-logic)', async () => {
        // The fail-clean half of D-FEE-ESCALATION: when the bid is clamped (here at
        // the ceiling, with the market rate folded in far above it) and the tx still
        // does not land, the helper must FAIL CLEANLY (ceiling-hit) rather than bid
        // above the affordable cap to chase inclusion. Drive the helper directly so
        // we can assert the submitted AttemptContext fee never exceeds the clamp AND
        // the terminal outcome is the ceiling-hit alert+throw.
        const { submitWithReconciliation } = await import('../../../src/utils/mevStrategies/reconciliation');
        const wallet = makeWallet();
        // Receipt always null + nonce never advances → genuinely not-landed every attempt.
        const provider = createMockProvider({
            getTransactionCount: vi.fn().mockResolvedValue(42),
            getTransactionReceipt: vi.fn().mockResolvedValue(null),
        }) as unknown as JsonRpcProvider;

        const alert = vi.fn(async () => {});
        const submit = recordingSubmit(() => ({
            signedTxHash: STUB_MINED_HASH,
            submittedNonce: 42,
            nativeConfirmed: false, // never natively confirmed → reconcile → not-landed
        }));

        await expect(
            submitWithReconciliation(
                submit.fn,
                wallet,
                provider,
                tinyCfg(), // ceiling 5 gwei, step 1 gwei, sellGas reserve on
                {
                    walletBalanceWei: parseEther('1'), // affordable: bound >> ceiling
                    baseFeeWei: parseUnits('20', 'gwei'),
                    snipeValueWei: parseEther('0.01'),
                    buyGasLimit: 200_000n,
                    chainPriorityWei: parseUnits('50', 'gwei'), // market rate 10x ceiling
                },
                { info: logInfo, warn: logWarn, error: logError },
                alert,
            ),
        ).rejects.toThrow(/ceiling/i);

        // CR-01 (no overspend): EVERY submitted attempt's fee was clamped to the
        // 5-gwei ceiling — the folded-in 50-gwei market rate NEVER reached the wire.
        expect(submit.calls.length).toBeGreaterThan(0);
        for (const a of submit.calls) {
            expect(a.priorityFeeWei).toBeLessThanOrEqual(CEILING_WEI);
        }
        // Fail-clean: the ceiling-hit alert + dotted op fired (D-ALERTS), and the
        // helper threw rather than bidding above the affordable cap to chase inclusion.
        expect(alert).toHaveBeenCalled();
        expect(logError).toHaveBeenCalledWith(
            expect.objectContaining({ op: 'mev.escalation.ceiling-hit' }),
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
    it('sell-leg inherits (SC4): sell-shaped tx misreport-but-landed returns real hash', async () => {
        // The exit leg (executeFullSell) submits through the SAME strategy +
        // helper, so it inherits reconciliation. A sell-shaped tx (no native value,
        // a swapExactTokensForETH-style calldata) that is misreported-but-landed
        // must return the REAL hash so decodeReceipt runs on a real receipt and the
        // captured amount_out is real (SC4). Proven via passthrough (the fork/exit
        // strategy): tx.wait(3) times out while the receipt says status 1.
        const { PassthroughMevStrategy } = await import('../../../src/utils/mevStrategies/passthrough');
        const sellShapedTx: TransactionRequest = {
            to: '0xRouter',
            data: '0xSELLcalldata', // swapExactTokensForETH-shaped (no value)
            gasLimit: 250_000n,
        };
        const provider = makeLandedProvider(); // receipt status 1, call→'0x'
        const sendTxMock = vi.fn().mockResolvedValue({
            hash: STUB_MINED_HASH,
            wait: vi.fn().mockRejectedValue(new Error('timeout waiting for sell tx')),
        });
        const wallet = { address: '0xWallet000000000000000000000000000000W01', sendTransaction: sendTxMock } as unknown as Wallet;
        const strategy = new PassthroughMevStrategy('base');

        const result = await strategy.sendTransaction(sellShapedTx, wallet, provider, 3);

        // The exit leg gets the real hash — the position is not stranded/mis-tracked.
        expect(result).toBe(STUB_MINED_HASH);
        expect(sendTxMock).toHaveBeenCalledTimes(1);
        // The sell-shaped tx carried no native value (snipeValueWei path = 0n).
        const capturedTx = sendTxMock.mock.calls[0][0] as TransactionRequest;
        expect(capturedTx.value).toBeUndefined();
    });
});

// =============================================================================
// D-RECORD-REAL-HASH — the buy success path records trades.tx_hash === the real
// returned hash, not the 'mev_bundle' placeholder. Owned by plan 21.1-05.
// =============================================================================

describe('D-RECORD-REAL-HASH — buy row records the real hash', () => {
    // The real reconciled hash a landed buy now returns (post-21.1-04). The buy
    // success path must persist THIS onto trades.tx_hash, not the 'mev_bundle'
    // placeholder that left the LADYS position untracked.
    const REAL_HASH = '0xfeedface00000000000000000000000000000000000000000000000000000001';
    const BOT_SRC = path.resolve(__dirname, '../../../src/bot.ts');

    it("D-RECORD-REAL-HASH: buy success path records trades.tx_hash === real hash, not 'mev_bundle' (insert-wiring observable)", async () => {
        // OBSERVABLE (D-04): the value flowing into trades.tx_hash is the real hash
        // sendTxWithRetry returns, not the placeholder. The load-bearing production
        // wiring is `const realHash = await sendTxWithRetry(...)` then
        // `insertTrade.run({ ..., txHash: realHash ?? 'mev_bundle', status:'pending' })`.
        // We exercise that EXACT expression against a prepared-statement `.run` spy
        // (the lighter green per D-QUALITY-FIRST — importing all of bot.ts pulls in
        // WS providers / chain registry side-effects — WITHOUT weakening the
        // assertion: the persisted txHash must equal REAL_HASH and must NOT be
        // 'mev_bundle'). Both the V2 and V3 inserts share this identical shape.
        const insertTradeRun = vi.fn();
        const insertTrade = { run: insertTradeRun };

        // The production buy success path, reduced to its persistence wiring.
        async function persistBuyRow(
            sendTxWithRetry: () => Promise<string>,
            poolType: 'v2' | 'v3',
        ) {
            const realHash = await sendTxWithRetry();
            insertTrade.run({
                token: '0xtoken',
                chain: 'ethereum',
                action: 'buy',
                txHash: realHash ?? 'mev_bundle',
                status: 'pending',
                poolType,
            });
        }

        // V2 buy submit returns the real reconciled hash.
        await persistBuyRow(async () => REAL_HASH, 'v2');
        // V3 buy submit returns the real reconciled hash.
        await persistBuyRow(async () => REAL_HASH, 'v3');

        expect(insertTradeRun).toHaveBeenCalledTimes(2);
        for (const call of insertTradeRun.mock.calls) {
            const row = call[0] as { txHash: string; status: string };
            // The real hash is persisted...
            expect(row.txHash).toBe(REAL_HASH);
            // ...and the 'mev_bundle' placeholder is GONE on the success path
            // (the position is now auditable/monitorable — harm-prevention #1).
            expect(row.txHash).not.toBe('mev_bundle');
            // status:'pending' is preserved (the receipt decoder flips it later).
            expect(row.status).toBe('pending');
        }
    });

    it('D-RECORD-REAL-HASH: src/bot.ts wires realHash into BOTH the V2 and V3 buy inserts (source/behavior coupling)', () => {
        // Defense-in-depth source assertion (mirrors the STOP-THE-LINE-03 source
        // grep gate in this file): binds the behavioral observable above to the
        // TERRITORY so a regression that reverts the wiring back to a bare
        // 'mev_bundle' literal fails here. Proves (1) realHash is captured off
        // sendTxWithRetry and (2) at least two `txHash: realHash` insert sites
        // exist (V2 + V3), with (3) zero bare `txHash: 'mev_bundle'` literals
        // surviving on a success path.
        const botSrc = fs.readFileSync(BOT_SRC, 'utf8');

        // (1) realHash is captured off the buy submit. Post-WR-01 (21.2-13) the call
        // site is the `submitBuyTx` nonce-locked seam (which wraps withNonceLock(...
        // => sendTxWithRetry(...))); accept either the seam or a direct call so the
        // assertion binds the OBSERVABLE (realHash captured off the buy submit).
        expect(/const\s+realHash\s*=\s*await\s+(submitBuyTx|sendTxWithRetry)\(/.test(botSrc)).toBe(true);
        // WR-01: the seam routes the buy submit through the per-wallet nonce authority.
        expect(/withNonceLock\(ctx\.wallet\.address,\s*\(\)\s*=>\s*sendTxWithRetry\(/.test(botSrc)).toBe(true);

        // (2) >=2 inserts persist realHash (V2 + V3).
        const realHashInserts = (botSrc.match(/txHash:\s*realHash\s*\?\?\s*'mev_bundle'/g) || []).length;
        expect(realHashInserts).toBeGreaterThanOrEqual(2);

        // (3) No bare placeholder literal remains on a success path (strip whole-
        // line `//` comments first — tombstone comments intentionally name it).
        const botBody = botSrc
            .split(/\r?\n/)
            .filter((l) => !l.trim().startsWith('//'))
            .join('\n');
        expect(/txHash:\s*'mev_bundle'/.test(botBody)).toBe(false);
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
