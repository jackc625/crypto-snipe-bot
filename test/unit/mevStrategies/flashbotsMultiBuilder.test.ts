// test/unit/mevStrategies/flashbotsMultiBuilder.test.ts
// Phase 21.3 / Plan 21.3-01 — STOP-THE-LINE-05-A + -D.
//
// LANDMINE (KEY RESEARCH FINDING — assert the WIRE BODY, NOT a call count):
// the installed @flashbots/ethers-provider-bundle@1.0.0 SILENTLY DROPS the
// `builders` field, so multi-builder fanout is a RAW eth_sendBundle JSON-RPC call
// reusing signBundle + the X-Flashbots-Signature header. A test that mocks the
// library and asserts a call COUNT is BLIND to the dropped field — it would pass
// against the broken library path. These tests INSPECT the actual eth_sendBundle
// wire body (the JSON params) and assert `builders` is the non-empty MEV_BUILDERS
// array, the SAME signed-tx bytes go to N ascending blocks, and the
// getBundleStatsV2 telemetry log carries only public values (no auth key, no
// signed raw tx).
//
// CANONICAL REGRESSION: "a staticCall-valid buy that Flashbots won't include at
// calm gas now lands." Realized by this multi-builder wire-body proof (builder
// coverage is the root cause, not underpricing).
//
// INTERCEPTION SEAM: rawSendBundle uses ethers v6 `FetchRequest`. We mock ONLY
// the `FetchRequest` export of `ethers` (importActual preserves everything else —
// Wallet/JsonRpcProvider/id/parseUnits stay real) so we can capture each POST body
// without adding a test-only seam to production code. `id()` stays the real keccak,
// so the X-Flashbots-Signature is genuinely signed by the real Wallet.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JsonRpcProvider, Wallet, TransactionRequest } from 'ethers';
import type { BroadcastHandle } from '../../../src/utils/mevStrategies/types';

// -----------------------------------------------------------------------------
// Captured raw eth_sendBundle POST bodies (parsed JSON) + their headers.
// -----------------------------------------------------------------------------
interface CapturedRequest {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
}
const captured: CapturedRequest[] = [];

// WR-01 (21.3-06): controllable per-call error injection on the RAW eth_sendBundle
// fanout. When set, the Nth raw send (1-indexed across the fanout) returns a relay
// error in bodyJson → rawSendBundle returns {error} → the loop throws. Used to
// simulate a mid-fanout relay failure on a LATER block (e.g. block+2).
let rawSendErrorOnCall: number | null = null;
let rawSendCallCount = 0;

// Mock ONLY FetchRequest from ethers; keep everything else real.
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
            const text = typeof this.body === 'string' ? this.body : '';
            captured.push({
                url: this.url,
                headers: { ...this.headers },
                body: JSON.parse(text),
            });
            rawSendCallCount += 1;
            const injectError = rawSendErrorOnCall !== null && rawSendCallCount === rawSendErrorOnCall;
            // Mirror an ethers FetchResponse: assertOk() + bodyJson.
            return {
                statusCode: 200,
                assertOk(): void {
                    /* ok */
                },
                bodyJson: injectError
                    ? { error: { message: 'simulated relay 5xx on a later block', code: -32000 } }
                    : { result: { bundleHash: STUB_BUNDLE_HASH } },
            };
        }
    }

    return {
        ...actual,
        FetchRequest: MockFetchRequest,
    };
});

// Stubbed bundle response values — bundleHash and the mined tx hash are distinct.
const STUB_BUNDLE_HASH = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const STUB_MINED_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STUB_SIGNED_TX = '0x02deadbeefSIGNEDRAWTX'; // must NOT appear in any telemetry log

// The single signed-bundle bytes returned by signBundle (signed ONCE per attempt).
// rawSendBundle must send THESE bytes byte-identically to every target block.
const STUB_SIGNED_BUNDLE = ['0x02signedbundletxBYTES'];

// Builder pubkeys returned by getBundleStatsV2 — public, on-chain-resolvable.
const CONSIDERED_PUBKEY = '0xpubkeyConsidered_beaverbuild';
const SEALED_PUBKEY = '0xpubkeySealed_titan';

// Controls bundle.wait() resolution: 1 = BlockPassedWithoutInclusion (not-landed
// native signal → forces the reconcile path + always-on stats telemetry).
let waitResolution = 1;

const sendBundleMock = vi.fn();
const signBundleMock = vi.fn();
const simulateMock = vi.fn();
const getBundleStatsV2Mock = vi.fn();
const createMock = vi.fn();

vi.mock('@flashbots/ethers-provider-bundle', () => ({
    FlashbotsBundleProvider: {
        create: createMock,
    },
}));

// Capture the module child-logger's calls.
const logInfo = vi.fn();
const logWarn = vi.fn();
const logError = vi.fn();
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        child: () => ({ info: logInfo, warn: logWarn, error: logError, debug: vi.fn() }),
    },
}));

// -----------------------------------------------------------------------------
// Provider / wallet stubs
// -----------------------------------------------------------------------------

const HEAD_BLOCK = 25_000_000;

function makeProvider(): JsonRpcProvider {
    return {
        // Stays at submittedNonce so reconcileInclusion polls then declares not-landed.
        getTransactionCount: vi.fn().mockResolvedValue(0),
        getFeeData: vi.fn().mockResolvedValue({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n }),
        getNetwork: vi.fn().mockResolvedValue({ chainId: 1n }),
        getBlockNumber: vi.fn().mockResolvedValue(HEAD_BLOCK),
        getBalance: vi.fn().mockResolvedValue(10_000_000_000_000_000_000n), // 10 ETH
        // No receipt ever → not-landed (drives the always-on stats telemetry path).
        getTransactionReceipt: vi.fn().mockResolvedValue(null),
    } as unknown as JsonRpcProvider;
}

function makeWallet(): Wallet {
    return {
        address: '0xWallet000000000000000000000000000000W01',
    } as unknown as Wallet;
}

// A valid hex private key for the auth signer construction inside the strategy.
const AUTH_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

beforeEach(() => {
    captured.length = 0;
    logInfo.mockReset();
    logWarn.mockReset();
    logError.mockReset();
    sendBundleMock.mockReset();
    signBundleMock.mockReset();
    simulateMock.mockReset();
    getBundleStatsV2Mock.mockReset();
    waitResolution = 1;
    rawSendErrorOnCall = null;
    rawSendCallCount = 0;

    signBundleMock.mockResolvedValue(STUB_SIGNED_BUNDLE);
    simulateMock.mockResolvedValue({ results: [], totalGasUsed: 21000 });
    getBundleStatsV2Mock.mockResolvedValue({
        isSimulated: true,
        isHighPriority: true,
        simulatedAt: '2026-05-29T00:00:00Z',
        receivedAt: '2026-05-29T00:00:00Z',
        consideredByBuildersAt: [{ pubkey: CONSIDERED_PUBKEY, timestamp: '2026-05-29T00:00:01Z' }],
        sealedByBuildersAt: [{ pubkey: SEALED_PUBKEY, timestamp: '2026-05-29T00:00:02Z' }],
    });
    // The library sendBundle is still called on block+1 to obtain the
    // FlashbotsTransactionResponse (bundle.wait + bundleHash + bundleTransactions).
    sendBundleMock.mockResolvedValue({
        bundleHash: STUB_BUNDLE_HASH,
        bundleTransactions: [
            { hash: STUB_MINED_HASH, signedTransaction: STUB_SIGNED_TX, account: '0x', nonce: 0 },
        ],
        wait: () => Promise.resolve(waitResolution),
        simulate: () => Promise.resolve({}),
        receipts: () => Promise.resolve([]),
    });
    createMock.mockReset().mockResolvedValue({
        sendBundle: sendBundleMock,
        signBundle: signBundleMock,
        simulate: simulateMock,
        getBundleStatsV2: getBundleStatsV2Mock,
    });
});

// Build a strategy with a hermetic MEV env so the assertions are independent of
// the operator's real .env. Returns after a sendTransaction (which throws on the
// not-landed path — that is expected and caught here).
async function runSend(env: Record<string, string | undefined>): Promise<void> {
    // Pin a tiny confirm-window so the not-landed reconcile path resolves well
    // within the 5s vitest timeout (the real 45s default would time the test out).
    const effectiveEnv: Record<string, string | undefined> = {
        MEV_CONFIRM_WINDOW_MS: '20',
        MEV_CONFIRM_POLL_MS: '5',
        ...env,
    };
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(effectiveEnv)) {
        saved[k] = process.env[k];
        if (effectiveEnv[k] === undefined) delete process.env[k];
        else process.env[k] = effectiveEnv[k];
    }
    try {
        const { FlashbotsMevStrategy } = await import('../../../src/utils/mevStrategies/flashbots');
        const strategy = new FlashbotsMevStrategy({ authKey: AUTH_KEY });
        const txReq: TransactionRequest = { to: '0xRouter', data: '0x', gasLimit: 200_000n, value: 0n };
        // 0 retries: a single attempt that does not land → throws ceiling/not-landed.
        await strategy.sendTransaction(txReq, makeWallet(), makeProvider(), 0).catch(() => {});
    } finally {
        for (const k of Object.keys(saved)) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    }
}

// Same as runSend but passes a BroadcastHandle side-channel and captures whether
// the send threw. WR-01: assert the reconcile hash was written into the handle
// even when the raw fanout throws mid-loop.
async function runSendWithBroadcast(
    env: Record<string, string | undefined>,
): Promise<{ broadcast: BroadcastHandle; threw: boolean }> {
    const effectiveEnv: Record<string, string | undefined> = {
        MEV_CONFIRM_WINDOW_MS: '20',
        MEV_CONFIRM_POLL_MS: '5',
        ...env,
    };
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(effectiveEnv)) {
        saved[k] = process.env[k];
        if (effectiveEnv[k] === undefined) delete process.env[k];
        else process.env[k] = effectiveEnv[k];
    }
    const broadcast: BroadcastHandle = {};
    let threw = false;
    try {
        const { FlashbotsMevStrategy } = await import('../../../src/utils/mevStrategies/flashbots');
        const strategy = new FlashbotsMevStrategy({ authKey: AUTH_KEY });
        const txReq: TransactionRequest = { to: '0xRouter', data: '0x', gasLimit: 200_000n, value: 0n };
        await strategy
            .sendTransaction(txReq, makeWallet(), makeProvider(), 0, undefined, broadcast)
            .catch(() => {
                threw = true;
            });
    } finally {
        for (const k of Object.keys(saved)) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    }
    return { broadcast, threw };
}

const DEFAULT_BUILDERS =
    'flashbots,f1b.io,rsync,beaverbuild.org,builder0x69,Titan,EigenPhi,Gambit Labs,payload,Loki,JetBuilder,tbuilder,bobthebuilder,BTCS,bloXroute,Blockbeelder,Quasar,Eureka,Bombora';

function sendBundleBodies(): CapturedRequest[] {
    return captured.filter((c) => c.body.method === 'eth_sendBundle');
}

function statsLog(): Record<string, unknown> | undefined {
    for (const call of logInfo.mock.calls) {
        const arg = call[0];
        if (arg && typeof arg === 'object' && (arg as { op?: string }).op === 'flashbots.bundle.stats') {
            return arg as Record<string, unknown>;
        }
    }
    return undefined;
}

// =============================================================================
// STOP-THE-LINE-05-A — multi-builder eth_sendBundle fanout (WIRE BODY, not count)
// =============================================================================

describe('Phase 21.3 — multi-builder eth_sendBundle fanout (STOP-THE-LINE-05-A/-D)', () => {
    it('raw eth_sendBundle wire body carries a non-empty builders array = MEV_BUILDERS (NOT a call-count — blind to the library-drops-builders trap)', async () => {
        await runSend({
            MEV_BUILDERS: undefined, // use the config default
            MEV_BUY_TARGET_BLOCKS: '1',
            MEV_BUY_MAX_PRIORITY_FEE_GWEI: '25',
        });

        const bodies = sendBundleBodies();
        expect(bodies.length).toBeGreaterThanOrEqual(1);

        const params = (bodies[0].body.params as Array<Record<string, unknown>>)[0];
        const builders = params.builders as string[];
        // Assert the WIRE BODY builders array — a call-count test is blind to the trap.
        expect(Array.isArray(builders)).toBe(true);
        expect(builders.length).toBeGreaterThan(0);
        expect(builders).toEqual(DEFAULT_BUILDERS.split(',').map((b) => b.trim()));
        // The dominant builders that build ~88% of ETH blocks must be present.
        expect(builders).toContain('beaverbuild.org');
        expect(builders).toContain('Titan');
        // The X-Flashbots-Signature header is present (address:sig from the real Wallet).
        const sigHeader = bodies[0].headers['x-flashbots-signature'];
        expect(sigHeader).toBeDefined();
        expect(sigHeader).toMatch(/^0x[0-9a-fA-F]{40}:0x[0-9a-fA-F]+$/);
    });

    it('respects an MEV_BUILDERS override on the wire (comma-split, trimmed, non-empty)', async () => {
        await runSend({
            MEV_BUILDERS: 'beaverbuild.org, Titan , rsync',
            MEV_BUY_TARGET_BLOCKS: '1',
            MEV_BUY_MAX_PRIORITY_FEE_GWEI: '25',
        });
        const params = (sendBundleBodies()[0].body.params as Array<Record<string, unknown>>)[0];
        expect(params.builders).toEqual(['beaverbuild.org', 'Titan', 'rsync']);
    });

    it('the SAME signed-tx bytes are submitted to block+1 .. block+MEV_BUY_TARGET_BLOCKS (identical deterministic bytes across N blocks; sign once)', async () => {
        await runSend({
            MEV_BUILDERS: 'beaverbuild.org,Titan',
            MEV_BUY_TARGET_BLOCKS: '3',
            MEV_BUY_MAX_PRIORITY_FEE_GWEI: '25',
        });

        const bodies = sendBundleBodies();
        // One raw eth_sendBundle per target block (N=3).
        expect(bodies.length).toBe(3);

        // signBundle called ONCE per attempt (Pitfall 2 — never re-signed per block).
        expect(signBundleMock).toHaveBeenCalledTimes(1);

        const blockNumbers: string[] = [];
        for (const b of bodies) {
            const params = (b.body.params as Array<Record<string, unknown>>)[0];
            // Byte-identical signed-tx payload across every block (the reconcile key).
            expect(params.txs).toEqual(STUB_SIGNED_BUNDLE);
            blockNumbers.push(params.blockNumber as string);
        }

        // Distinct ASCENDING block numbers: head+1, head+2, head+3 in hex.
        expect(blockNumbers).toEqual([
            '0x' + (HEAD_BLOCK + 1).toString(16),
            '0x' + (HEAD_BLOCK + 2).toString(16),
            '0x' + (HEAD_BLOCK + 3).toString(16),
        ]);
        // All distinct (no duplicate target).
        expect(new Set(blockNumbers).size).toBe(3);
    });

    it('on a not-landed attempt logs op:flashbots.bundle.stats with consideredByBuilders/sealedByBuilders pubkeys + isSimulated from getBundleStatsV2, and NO FLASHBOTS_AUTH_KEY / no signed raw tx', async () => {
        await runSend({
            MEV_BUILDERS: 'beaverbuild.org,Titan',
            MEV_BUY_TARGET_BLOCKS: '1',
            MEV_BUY_MAX_PRIORITY_FEE_GWEI: '25',
        });

        // getBundleStatsV2 queried for the per-builder root-cause discriminator.
        expect(getBundleStatsV2Mock).toHaveBeenCalledWith(STUB_BUNDLE_HASH, HEAD_BLOCK + 1);

        const logged = statsLog();
        expect(logged).toBeDefined();
        expect(logged!.bundleHash).toBe(STUB_BUNDLE_HASH);
        expect(logged!.targetBlock).toBe(HEAD_BLOCK + 1);
        expect(logged!.isSimulated).toBe(true);
        expect(logged!.consideredByBuilders).toEqual([CONSIDERED_PUBKEY]);
        expect(logged!.sealedByBuilders).toEqual([SEALED_PUBKEY]);

        // T-21.3-01-03 (Information disclosure): NO auth key, NO signed raw tx in the payload.
        const serialized = JSON.stringify(logged);
        expect(serialized).not.toContain(AUTH_KEY);
        expect(serialized).not.toContain(STUB_SIGNED_TX);
        expect(serialized).not.toContain(STUB_SIGNED_BUNDLE[0]);
    });
});

// =============================================================================
// WR-01 (21.3-06) — the reconcile hash / BroadcastHandle is captured BEFORE the
// raw multi-builder fanout, so a mid-fanout relay error still leaves a
// reconcilable hash (no landed bundle is ever orphaned → no LADYS false-negative).
//
// RED proof: against pre-fix ordering the raw fanout loop runs FIRST and the
// library sendBundle (which yields bundle.bundleTransactions[0].hash, the
// reconcile hash) runs AFTER it — so an error on block+2 throws BEFORE the hash
// is ever produced/written, leaving broadcast.signedTxHash undefined. The fix
// obtains the hash + writes the BroadcastHandle BEFORE the fanout.
// =============================================================================

describe('Phase 21.3-06 — WR-01: reconcile hash captured BEFORE the raw fanout', () => {
    it('a mid-fanout relay error on block+2 STILL leaves a populated BroadcastHandle.signedTxHash (reconcilable) before the throw', async () => {
        // The library sendBundle (block+1) yields the deterministic reconcile hash.
        // Inject a relay error on the 2nd raw eth_sendBundle (block+2) so the fanout
        // throws AFTER at least one successful raw submit (the dangerous case: a
        // bundle is live at block+1 and could land).
        rawSendErrorOnCall = 2;

        const { broadcast, threw } = await runSendWithBroadcast({
            MEV_BUILDERS: 'beaverbuild.org,Titan',
            MEV_BUY_TARGET_BLOCKS: '3', // 3 raw fanout submits; the 2nd errors
            MEV_BUY_MAX_PRIORITY_FEE_GWEI: '25',
        });

        // The submit DID throw (the relay error propagates after the hash is captured).
        expect(threw).toBe(true);
        // CRITICAL (WR-01): the reconcile hash was STILL written into the handle
        // BEFORE the throw, so the no-double-buy / reconcile machinery can probe a
        // landed bundle. Against pre-fix ordering this is undefined (RED).
        expect(broadcast.signedTxHash).toBe(STUB_MINED_HASH);
        expect(broadcast.submittedNonce).toBeDefined();
        expect(broadcast.submittedNonce).toBe(0);
    });

    it('sign-once preserved: even with the pre-fanout library sendBundle, signBundle is called exactly ONCE per attempt (Pitfall 2)', async () => {
        rawSendErrorOnCall = null; // clean run
        await runSendWithBroadcast({
            MEV_BUILDERS: 'beaverbuild.org,Titan',
            MEV_BUY_TARGET_BLOCKS: '3',
            MEV_BUY_MAX_PRIORITY_FEE_GWEI: '25',
        });
        // Reordering must NOT introduce a re-sign — the same signed bytes feed the
        // simulate, the library sendBundle, AND the raw fanout (deterministic hash).
        expect(signBundleMock).toHaveBeenCalledTimes(1);
    });

    it('the raw fanout still submits the SAME signed bytes to all N blocks after the reorder (telemetry/wire-body semantics unchanged)', async () => {
        rawSendErrorOnCall = null;
        await runSendWithBroadcast({
            MEV_BUILDERS: 'beaverbuild.org,Titan',
            MEV_BUY_TARGET_BLOCKS: '3',
            MEV_BUY_MAX_PRIORITY_FEE_GWEI: '25',
        });
        const bodies = sendBundleBodies();
        expect(bodies.length).toBe(3);
        for (const b of bodies) {
            const params = (b.body.params as Array<Record<string, unknown>>)[0];
            expect(params.txs).toEqual(STUB_SIGNED_BUNDLE);
        }
    });
});
