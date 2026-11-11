// test/realpath/triage/fixtures/crashRun.ts
// Phase 23 plan 23-12 (AUDIT-02, AC-09, D-08): the parent side of the crash-class proofs, shared by
// AUD-ANTIRUG-002, AUD-API-008, AUD-TX-009 and AUD-BUY-005. Each test file starts its fixture child
// itself, only through spawnRailedChild (the rails preload, the inert sentinel env, loopback-only
// network); this file only reads what the child left behind:
//
//   classify(r)   exactly one of six result classes (23-12-PLAN.md Proof rule 4b), from the
//                 child's status and its stdout markers:
//                   timeout                status null and the spawner's ETIMEDOUT note;
//                   signal-terminated      status null otherwise (killed by a signal);
//                   setup-error            FIXTURE_SETUP_ERROR or status 3 (the fixture's own
//                                          failure, or a request the loopback chain does not know);
//                   survived               FIXTURE_SURVIVED, status 0, a FIXTURE_LIVE heartbeat
//                                          and WORK_SETTLED;
//                   survived-work-pending  the same with WORK_PENDING (the process lives but the
//                                          operation under test never finished);
//                   process-exited         the child ended without FIXTURE_SURVIVED.
//                 Any other combination (survival without a heartbeat, both or neither work
//                 marker) is not a class: it throws, naming what is wrong.
//   actualOf(r, signalText)  the knownBug `actual`: { outcome, exited, code, stderrSignal }, where
//                 exited is true when FIXTURE_SURVIVED is absent, code is the child's status, and
//                 stderrSignal is `signalText` when a stderr line contains it, else '' (cut to that
//                 text, so ports and library versions cannot change it).
//   CORRECT       { outcome 'survived', exited false, code 0, stderrSignal '' } for every finding.
//   expectRailedLoopbackOnly(runId)  the child's own case ledger: the rails started, every
//                 network use was loopback, nothing was denied or tripped.
//   describeRun(r)  the child's status and output tails, for failure messages.

import { expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CliResult } from '../../../rails/spawnRailedChild';
import { harnessState } from '../../harness/chain';

export type CrashOutcome = 'survived' | 'survived-work-pending' | 'process-exited' | 'signal-terminated' | 'timeout' | 'setup-error';

export interface CrashActual {
    outcome: CrashOutcome;
    exited: boolean;
    code: number | null;
    stderrSignal: string;
}

export const CORRECT: CrashActual = Object.freeze({ outcome: 'survived', exited: false, code: 0, stderrSignal: '' }) as CrashActual;

/** What every crash finding observes today: the process ends with code 1 and the named error. */
export function exitedWith(signalText: string): CrashActual {
    return { outcome: 'process-exited', exited: true, code: 1, stderrSignal: signalText };
}

/** The fixture's per-run limit (spawnSync timeout) and each test's own limit (Vitest). */
export const CHILD_TIMEOUT_MS = 110_000;
export const TEST_TIMEOUT_MS = 120_000;

export function stdoutLines(r: CliResult): string[] {
    return r.stdout.split(/\r?\n/).filter((l) => l !== '');
}

export function hasMarker(r: CliResult, marker: string): boolean {
    return stdoutLines(r).some((l) => l === marker || l.startsWith(`${marker} `));
}

export function markerLine(r: CliResult, marker: string): string | undefined {
    return stdoutLines(r).find((l) => l === marker || l.startsWith(`${marker} `));
}

export function classify(r: CliResult): CrashOutcome {
    if (r.status === null) return /ETIMEDOUT/.test(r.stderr) ? 'timeout' : 'signal-terminated';
    if (hasMarker(r, 'FIXTURE_SETUP_ERROR') || r.status === 3) return 'setup-error';
    if (!hasMarker(r, 'FIXTURE_SURVIVED')) return 'process-exited';
    const why: string[] = [];
    if (r.status !== 0) why.push(`status ${r.status}`);
    if (!stdoutLines(r).some((l) => /^FIXTURE_LIVE \d+ \d+$/.test(l))) why.push('no FIXTURE_LIVE heartbeat');
    const settled = hasMarker(r, 'WORK_SETTLED');
    const pending = hasMarker(r, 'WORK_PENDING');
    if (settled === pending) why.push(settled ? 'both WORK_SETTLED and WORK_PENDING' : 'neither WORK_SETTLED nor WORK_PENDING');
    if (why.length > 0) throw new Error(`the child printed FIXTURE_SURVIVED but is not a result class: ${why.join(', ')}\n${describeRun(r)}`);
    return settled ? 'survived' : 'survived-work-pending';
}

export function stderrSignal(r: CliResult, signalText: string): string {
    return r.stderr.split(/\r?\n/).some((l) => l.includes(signalText)) ? signalText : '';
}

export function actualOf(r: CliResult, signalText: string): CrashActual {
    return { outcome: classify(r), exited: !hasMarker(r, 'FIXTURE_SURVIVED'), code: r.status, stderrSignal: stderrSignal(r, signalText) };
}

export function describeRun(r: CliResult): string {
    return `status ${r.status}\nstdout (tail):\n${r.stdout.slice(-3000)}\nstderr (tail):\n${r.stderr.slice(-3000)}`;
}

const LEDGER_ROOT = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger');
let caseCounter = 0;

/** A fresh ledger run id for one child; its folder is removed after the test. */
export function newCaseId(finding: string, label: string): string {
    caseCounter += 1;
    const id = `case-realpath-${finding}-${label}-${process.pid}-${caseCounter}-${Math.random().toString(36).slice(2, 10)}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    harnessState().disposers.push(async () => fs.rmSync(path.join(LEDGER_ROOT, id), { recursive: true, force: true }));
    return id;
}

interface LedgerEntry {
    kind: string;
    target?: { class?: string } | null;
}

export function expectRailedLoopbackOnly(runId: string): void {
    const dir = path.join(LEDGER_ROOT, runId);
    const entries: LedgerEntry[] = [];
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue;
        for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) if (line.trim() !== '') entries.push(JSON.parse(line) as LedgerEntry);
    }
    expect(entries.some((e) => e.kind === 'worker-start'), 'the child ran with the rails').toBe(true);
    const allowed = entries.filter((e) => e.kind === 'net-allow');
    expect(allowed.length, 'the child used its loopback chain').toBeGreaterThan(0);
    expect(allowed.filter((e) => typeof e.target !== 'object' || e.target === null || e.target.class !== 'loopback')).toEqual([]);
    expect(entries.filter((e) => /deny|blocked|tripwire/.test(e.kind))).toEqual([]);
}
