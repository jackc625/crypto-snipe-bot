// test/realpath/triage/fixtures/AUD-TX-002-lock.ts
// Phase 23 plan 23-09 (AUDIT-02, D-NONCE-AUTHORITY-ALL): helpers shared by the nonce-lock triage
// files of this plan (AUD-TX-002 with AUD-BUY-025 and AUD-EXIT-009, AUD-TX-001, AUD-TX-003). Lives
// beside its tests: the harness is read-only for triage plans. Nothing here mocks anything, and
// nothing adds behavior to the simulated node.
//
// - graphWithNonceLock: the graph's own src/utils/nonceAuthority withNonceLock. loadGraph ran
//   vi.resetModules() and then imported the graph, so this import returns the module instance the
//   bot uses (a second copy would trip the Phase 22 duplicate-load guard; plan 23-15's
//   AUD-TX-006 control proved the instance is shared, and every control test of this plan shows
//   the probe below waiting on the bot's own hold).
// - probeWalletLock: one later operation for the wallet through that real lock. It only records
//   the fake-clock time it started at; it signs and sends nothing.
// - pendingWindow: the bounded observation. Every `blockMs` of fake time the node mines a block
//   (so ethers' receipt polls see the chain move past any deadline a wait could have had), and
//   expectStillPending watches the probe through each block's slot. It returns when the window
//   ends or the probe settles, never throwing for a settle, so the triage test records the result
//   with knownBug before any detail is asserted (D-07, D-08).
// - missBundlesUntil: run the chain for a wallet whose private bundles are never included (each
//   bundle transaction gets its 12 s slot, then an empty block is mined), never mining a public
//   transaction, until a condition holds.

import { vi } from 'vitest';
import type { Submitted } from '../../harness/chain';
import { expectStillPending, type Scenario } from '../../harness/world';

type NonceAuthorityModule = typeof import('../../../../src/utils/nonceAuthority');

/** The graph's own withNonceLock (see the file header). */
export async function graphWithNonceLock(): Promise<NonceAuthorityModule['withNonceLock']> {
    const m = await import('../../../../src/utils/nonceAuthority');
    return m.withNonceLock;
}

export interface LockProbe {
    /** Resolves to 'probe-ran' once the probe's body ran inside the wallet lock. */
    promise: Promise<string>;
    started(): boolean;
    /** Fake-clock ms the probe's body started at, or null. */
    startedAt(): number | null;
    /** Fake-clock ms the probe was queued at. */
    queuedAt: number;
}

/** Queue one later operation for the scenario wallet through the real withNonceLock. */
export async function probeWalletLock(sc: Scenario): Promise<LockProbe> {
    const withNonceLock = await graphWithNonceLock();
    let startedAt: number | null = null;
    const queuedAt = Date.now();
    const promise = withNonceLock(sc.wallet.address, async () => {
        startedAt = Date.now();
        return 'probe-ran';
    });
    return { promise, started: () => startedAt !== null, startedAt: () => startedAt, queuedAt };
}

export interface PendingWindowResult {
    /** Fake-clock ms from the window's start to the probe settling, or null if it never did. */
    settledAfterMs: number | null;
    blocksMined: number;
    windowMs: number;
}

/**
 * Mine a block every `blockMs` and watch `probe` with expectStillPending through each slot, for
 * `windowMs` of fake time or until the probe settles (see the file header).
 */
export async function pendingWindow(sc: Scenario, probe: LockProbe, opts: { windowMs: number; blockMs?: number; what: string }): Promise<PendingWindowResult> {
    const blockMs = opts.blockMs ?? 12_000;
    const start = Date.now();
    let blocksMined = 0;
    while (Date.now() - start < opts.windowMs) {
        sc.node.mine();
        blocksMined += 1;
        const slot = Math.min(blockMs, opts.windowMs - (Date.now() - start));
        try {
            await expectStillPending(probe.promise, slot, { stepMs: 500, what: opts.what });
        } catch (e) {
            // expectStillPending throws only when the watched promise settled inside the slot.
            if (!probe.started()) throw e;
            return { settledAfterMs: probe.startedAt()! - start, blocksMined, windowMs: opts.windowMs };
        }
    }
    return { settledAfterMs: null, blocksMined, windowMs: opts.windowMs };
}

/**
 * Step the fake clock 50 ms at a time until `until()` holds. Each of the wallet's bundle
 * transactions gets one 12 s slot from when it was first seen; then an empty block is mined (a
 * builder that did not include it). Public transactions are never mined here. Throws if `until()`
 * does not hold within `maxVirtualMs`.
 */
export async function missBundlesUntil(sc: Scenario, opts: { until: () => boolean; what: string; maxVirtualMs?: number }): Promise<void> {
    const { node } = sc;
    const wallet = sc.wallet.address.toLowerCase();
    const slotStart = new Map<string, number>();
    const end = Date.now() + (opts.maxVirtualMs ?? 600_000);
    const fromWallet = new WeakMap<Submitted, boolean>();
    const isWallet = (s: Submitted): boolean => {
        let v = fromWallet.get(s);
        if (v === undefined) {
            v = (s.tx.from ?? '').toLowerCase() === wallet;
            fromWallet.set(s, v);
        }
        return v;
    };
    while (!opts.until()) {
        if (Date.now() >= end) throw new Error(`missBundlesUntil: ${opts.what} did not happen within ${opts.maxVirtualMs ?? 600_000} virtual ms`);
        await vi.advanceTimersByTimeAsync(50);
        const bundled = node.submitted.filter((s) => s.route === 'bundle' && s.status === 'accepted' && isWallet(s));
        for (const s of bundled) if (!slotStart.has(s.hash)) slotStart.set(s.hash, Date.now());
        const due = bundled.filter((s) => Date.now() - slotStart.get(s.hash)! >= 12_000);
        if (due.length === 0) continue;
        node.mine({ include: [] });
        for (const s of due) slotStart.set(s.hash, Date.now());
    }
}
