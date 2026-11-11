// test/realpath/harness/knownBug.ts
// Phase 23 plan 23-02 (D-07, D-08, D-11; RESEARCH Pattern 4, proven by E10): the known-bug marker.
//
// knownBug(ctx, id, { claim, correct, observed, actual, expectedPlain, actualPlain }) marks the ONE
// assertion that shows a bug and stores what it saw:
//   - `actual` deep-equals `correct`  -> throws "<id> now behaves correctly: remove this marker (it
//     looks fixed)". This is the Phase 24 fix signal (D-08).
//   - `actual` deep-equals `observed` -> passes, and appends { id, claim, expected, actual,
//     expectedPlain, actualPlain } to ctx.task.meta.knownBugs. Only this exact failure counts as
//     the proven bug (D-07). The JSON reporter carries task.meta to the D-11 report and to plan
//     23-04's register check.
//   - anything else                   -> fails with "<id>: the failure changed from what was
//     recorded", so a changed value is a real failure, never a silent pass.
// It wraps exactly one assertion and catches nothing: a setup error, a timeout or a type error in
// the test stays a real failure. Vitest's it.fails is not used, because the installed 4.1.1 runner
// turns any non-passing result into a pass (CONTEXT D-07).
//
// `claim` is a required short kebab-case literal naming the sub-claim this call proves, so the
// register and the report judge proof per claim, not per test (partial proof is judged at claim
// level). A shared-cause file calls knownBug once per entry or claim (AC-11).
//
// IDs: a triage test cites its finding's ID. The harness's own self-tests cite only the reserved
// literal HARNESS-SELFTEST, which plan 23-04 accepts outside test/realpath/triage/ and reads for
// no finding rule.
//
// Stored values are JSON-safe: BigInt is stored as whole-number text.

import { isDeepStrictEqual } from 'node:util';
import { expect } from 'vitest';

/** One proven sub-claim, as stored on ctx.task.meta.knownBugs. */
export interface KnownBugRecord {
    id: string;
    claim: string;
    /** What correct behavior would give (`correct`), BigInt as text. */
    expected: unknown;
    /** What the code did, equal to the recorded `observed`, BigInt as text. */
    actual: unknown;
    /** A short plain sentence for the D-11 operator report: what should happen. */
    expectedPlain: string;
    /** A short plain sentence for the D-11 operator report: what happens today. */
    actualPlain: string;
}

declare module 'vitest' {
    interface TaskMeta {
        knownBugs?: KnownBugRecord[];
    }
}

export interface KnownBugSpec<T> {
    /** Short kebab-case literal naming the sub-claim this call proves. */
    claim: string;
    /** What the code would give if the bug were fixed. */
    correct: T;
    /** What the code gives today, recorded when the bug was proven. */
    observed: T;
    /** What the code gave on this run. */
    actual: T;
    expectedPlain: string;
    actualPlain: string;
}

/** Anything with Vitest's test context shape (the `ctx` argument of an `it` callback). */
export interface KnownBugContext {
    task: { name: string; meta: { knownBugs?: KnownBugRecord[] } };
}

const CLAIM_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CLAIM_MAX = 64;
const ID_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;

/** JSON-safe copy: BigInt as whole-number text, arrays and plain objects copied, the rest as is. */
function toStored(v: unknown): unknown {
    if (typeof v === 'bigint') return v.toString();
    if (Array.isArray(v)) return v.map(toStored);
    if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) out[k] = toStored(x);
        return out;
    }
    return v;
}

function usage(id: unknown, message: string): Error {
    return new Error(`knownBug(${typeof id === 'string' ? id : String(id)}): ${message}`);
}

/**
 * Mark the one assertion that shows bug `id` (D-07). Throws when the bug looks fixed (D-08) or the
 * failure changed; records the proof on ctx.task.meta.knownBugs otherwise.
 */
export function knownBug<T>(ctx: KnownBugContext, id: string, spec: KnownBugSpec<T>): void {
    // Usage errors first: a malformed marker must never pass as a proof.
    if (!ctx || !ctx.task || typeof ctx.task.meta !== 'object' || ctx.task.meta === null) throw usage(id, 'the first argument must be the test context (it callback ctx)');
    if (typeof id !== 'string' || !ID_RE.test(id)) throw usage(id, `the id must be a finding ID such as AUD-BUY-002 (or HARNESS-SELFTEST), got ${JSON.stringify(id)}`);
    if (typeof spec?.claim !== 'string' || !CLAIM_RE.test(spec.claim) || spec.claim.length > CLAIM_MAX) {
        throw usage(id, `claim must be a short kebab-case literal (a-z, 0-9, single hyphens, at most ${CLAIM_MAX} characters), got ${JSON.stringify(spec?.claim)}`);
    }
    for (const k of ['expectedPlain', 'actualPlain'] as const) {
        if (typeof spec[k] !== 'string' || spec[k].trim() === '') throw usage(id, `${k} must be a short plain sentence for the operator report`);
    }
    for (const k of ['correct', 'observed', 'actual'] as const) {
        if (!(k in spec)) throw usage(id, `spec.${k} is missing`);
    }
    if (isDeepStrictEqual(spec.correct, spec.observed)) throw usage(id, 'correct and observed are equal, so this marker could never tell the bug from the fix');
    const existing = ctx.task.meta.knownBugs ?? [];
    if (existing.some((r) => r.id === id && r.claim === spec.claim)) throw usage(id, `claim ${spec.claim} is already recorded in this test`);

    // D-08: the fix signal.
    if (isDeepStrictEqual(spec.actual, spec.correct)) throw new Error(`${id} now behaves correctly: remove this marker (it looks fixed)`);
    // D-07: the one assertion. Only the exact recorded failure passes.
    expect(spec.actual, `${id}: the failure changed from what was recorded`).toStrictEqual(spec.observed);

    const record: KnownBugRecord = {
        id,
        claim: spec.claim,
        expected: toStored(spec.correct),
        actual: toStored(spec.actual),
        expectedPlain: spec.expectedPlain,
        actualPlain: spec.actualPlain,
    };
    // Append, creating the array on first use.
    (ctx.task.meta.knownBugs ??= []).push(record);
}
