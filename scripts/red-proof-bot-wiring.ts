// scripts/red-proof-bot-wiring.ts
//
// Phase 23 plan 23-18 (CHAR-06, SPEC Requirement 8): the re-runnable RED proof for the bot wiring
// conversion, test/integration/anti-rug/botWiring.test.ts. That file used to read src/bot.ts and
// src/utils/db.ts as text; it now drives the real exported callers and reads the call order from
// mocks. This script shows each path it claims to protect failing when that wiring is broken.
//
// For each row of WIRING_MUTANTS (scripts/red-proof-conversions.ts) it runs the whole test file
// once through runMutant (plan 23-29's in-memory mutant mechanism: the edit is applied as Vite loads
// the target module; no file is written) and requires:
//   - the find texts each occur exactly once in the file on disk          (else NOT-APPLIED)
//   - a `vite` reach marker, so the mutant really reached its module       (else NOT-REACHED)
//   - a non-zero exit with at least one failed test                        (else STAYED-GREEN)
//   - the failed tests, matched by the `Test NN:` prefix of their last title level, equal to the
//     row's expected set exactly, and every test of the file either passed or failed (WRONG-SET)
//   - every failure message an assertion failure: it starts with AssertionError and mentions none
//     of FORBIDDEN_IN_MESSAGE (a timeout or a compile error)               (else BAD-FAILURE)
// Then it runs the file with no mutant and requires every test of the file to pass (CONTROL-FAILED).
// It records the SHA-256 of src/bot.ts, src/utils/db.ts and every row's target at the start and
// requires them unchanged after every run, with `git status --porcelain -- src` empty (HASH-CHANGED).
//
// Output, only when everything holds: one line per failed test,
//   RED-OK <mutant> :: test/integration/anti-rug/botWiring.test.ts :: <full title, ' > ' between levels>
// then `RED-PROOF-BOT-WIRING-OK mutants <n> control <m> passed`. On a refusal: one line
// `REFUSED <reason> <subject>: <detail>` on stderr.
//
// Usage: node node_modules/ts-node/dist/bin.js scripts/red-proof-bot-wiring.ts [--self-test]
//   (no flag)    the proof above; runs Vitest 8 times, about 10 to 30 s each.
//   --self-test  drives the run judge on built runs, one per refusal; runs no Vitest.
// Exit codes: 0 pass, 1 a refusal (or a self-test case failed), 2 bad arguments or an internal error.
//
// D-21: runs on Node 22.16.0 (ABI 127). The Phase 26 Node upgrade must update the assert below.
// Zero new npm deps. Writes nothing under the repo: its only files are temp folders under
// os.tmpdir() (the reach markers), removed after each run. Importing this module runs nothing:
// main() runs only when the file is executed directly (require.main === module).

if (process.versions.modules !== '127') {
    console.error(
        `red-proof-bot-wiring requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}).`,
    );
    process.exit(2);
}

import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    FORBIDDEN_IN_MESSAGE,
    REPO_ROOT,
    WIRING_MUTANTS,
    literalTitlePaths,
    runMutant,
    type MutantEdit,
    type MutantRun,
    type WiringMutantRow,
} from './red-proof-conversions';

export const WIRING_TEST = 'test/integration/anti-rug/botWiring.test.ts';
const PROJECT = 'integration';
const ALWAYS_HASHED = ['src/bot.ts', 'src/utils/db.ts'];

const overlay = require(path.join(REPO_ROOT, 'scripts', 'in-memory-mutant-overlay.cjs')) as {
    applyEdits(text: string, edits: MutantEdit[]): string;
};

export type Refusal = 'NOT-APPLIED' | 'NOT-REACHED' | 'STAYED-GREEN' | 'WRONG-SET' | 'BAD-FAILURE' | 'CONTROL-FAILED' | 'HASH-CHANGED';

export interface Verdict {
    refusal: Refusal;
    detail: string;
}

/** The Test NN label of a title's last level ('22' for '... > Test 22: ...'), or null. */
export function testNumberOf(title: string): string | null {
    const last = title.split(' > ').pop() ?? '';
    const m = /^Test (\d+[a-z]?):/.exec(last);
    return m ? m[1] : null;
}

/** A WIRING_MUTANTS expected entry as a bare number: '22', 'Test 22' and 'Test 22:' are all '22'. */
export function wiringNumber(entry: string): string {
    return entry.replace(/^Test\s+/, '').replace(/:$/, '').trim();
}

function sortedUnique(xs: string[]): string[] {
    return [...new Set(xs)].sort();
}

/**
 * Judge one mutant run against its row. allTitles are the file's test titles (full paths); markers
 * the reach markers the run left. Returns null when the run is a valid RED proof of exactly the
 * row's expected tests.
 */
export function judgeMutantRun(row: WiringMutantRow, run: MutantRun, markers: string[], allTitles: string[]): Verdict | null {
    if (run.reportError) return { refusal: 'BAD-FAILURE', detail: `${run.reportError} (exit ${run.status})\n${run.outputTail}` };
    if (!markers.includes('vite')) {
        return { refusal: 'NOT-REACHED', detail: `no vite marker (markers: ${JSON.stringify([...markers].sort())}); exit ${run.status}, failed ${JSON.stringify(run.failed.map((f) => f.title))}` };
    }
    if (run.status === 0 && run.failed.length === 0) return { refusal: 'STAYED-GREEN', detail: `exit 0, ${run.passedCount} passed` };
    if (run.status === 0 || run.failed.length === 0) {
        return { refusal: 'BAD-FAILURE', detail: `exit ${run.status} with ${run.failed.length} failed test(s): not a test failure\n${run.outputTail}` };
    }
    const want = sortedUnique(row.expected.map(wiringNumber));
    const failedTitles = run.failed.map((f) => f.title);
    const got = failedTitles.map((t) => testNumberOf(t) ?? `<no Test NN> ${t}`);
    if (got.length !== new Set(got).size || JSON.stringify(sortedUnique(got)) !== JSON.stringify(want)) {
        return { refusal: 'WRONG-SET', detail: `failed ${JSON.stringify(failedTitles)}, expected Test ${want.join(', Test ')}` };
    }
    const seen = sortedUnique([...run.passed, ...failedTitles]);
    if (JSON.stringify(seen) !== JSON.stringify(sortedUnique(allTitles)) || run.passed.length + failedTitles.length !== allTitles.length) {
        return { refusal: 'WRONG-SET', detail: `the run did not pass or fail every test of the file once: ran ${JSON.stringify(seen)}, file has ${JSON.stringify(sortedUnique(allTitles))}` };
    }
    for (const f of run.failed) {
        const forbidden = FORBIDDEN_IN_MESSAGE.find((s) => f.message.includes(s));
        if (forbidden !== undefined) return { refusal: 'BAD-FAILURE', detail: `${f.title}: message mentions ${JSON.stringify(forbidden)}: ${f.message.slice(0, 600)}` };
        if (!f.message.startsWith('AssertionError')) return { refusal: 'BAD-FAILURE', detail: `${f.title}: not an assertion failure: ${f.message.slice(0, 600)}` };
    }
    return null;
}

/** Judge the no-mutant run: every test of the file passed. */
export function judgeControlRun(run: MutantRun, allTitles: string[]): Verdict | null {
    const missing = allTitles.filter((t) => !run.passed.includes(t));
    if (run.reportError || run.status !== 0 || run.failed.length > 0 || missing.length > 0 || run.passed.length !== allTitles.length) {
        const why = run.reportError ?? `exit ${run.status}, failed ${JSON.stringify(run.failed.map((f) => f.title))}, not passed ${JSON.stringify(missing)}, passed ${run.passed.length} of ${allTitles.length}`;
        return { refusal: 'CONTROL-FAILED', detail: `${why}\n${run.outputTail}` };
    }
    return null;
}

function sha256(rel: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, rel))).digest('hex');
}

function gitStatusSrc(): string {
    const r = spawnSync('git', ['status', '--porcelain', '--', 'src'], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) return `git status failed (exit ${r.status}): ${r.stderr}`;
    return r.stdout.trim();
}

export interface ProofResult {
    ok: boolean;
    refusal?: Refusal;
    subject?: string;
    detail?: string;
    lines: string[];
    controlPassed: number;
}

/** The whole proof over the given rows. Writes nothing under the repo. */
export function proveWiring(rows: WiringMutantRow[]): ProofResult {
    const refuse = (refusal: Refusal, subject: string, detail: string): ProofResult => ({ ok: false, refusal, subject, detail, lines: [], controlPassed: 0 });
    if (rows.length === 0) throw new Error('WIRING_MUTANTS is empty: a proof over no mutant proves nothing');
    const names = rows.map((r) => r.name);
    if (new Set(names).size !== names.length) throw new Error(`a mutant name occurs twice in ${JSON.stringify(names)}`);

    const hashed = sortedUnique([...ALWAYS_HASHED, ...rows.map((r) => r.file)]);
    const before = new Map(hashed.map((f) => [f, sha256(f)]));
    const hashCheck = (subject: string): ProofResult | null => {
        for (const f of hashed) if (sha256(f) !== before.get(f)) return refuse('HASH-CHANGED', subject, `SHA-256 of ${f} changed`);
        const st = gitStatusSrc();
        if (st !== '') return refuse('HASH-CHANGED', subject, `git status --porcelain -- src is not empty:\n${st}`);
        return null;
    };
    const atStart = hashCheck('start');
    if (atStart) return atStart;

    // The file's tests, and each row's expected Test NN naming exactly one of them.
    const allTitles = literalTitlePaths(fs.readFileSync(path.join(REPO_ROOT, WIRING_TEST), 'utf8'), WIRING_TEST);
    if (allTitles.length === 0) throw new Error(`${WIRING_TEST} has no literal test title`);
    for (const row of rows) {
        for (const e of row.expected) {
            const n = wiringNumber(e);
            const matches = allTitles.filter((t) => testNumberOf(t) === n);
            if (matches.length !== 1) throw new Error(`mutant ${row.name}: expected Test ${n} names ${matches.length} tests in ${WIRING_TEST}`);
        }
    }

    // NOT-APPLIED before any run.
    for (const row of rows) {
        try {
            overlay.applyEdits(fs.readFileSync(path.join(REPO_ROOT, row.file), 'utf8'), row.edits);
        } catch (e) {
            return refuse('NOT-APPLIED', row.name, `${row.file}: ${(e as Error).message}`);
        }
    }

    const lines: string[] = [];
    for (const row of rows) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-red-proof-wiring-'));
        let run: MutantRun;
        let markers: string[];
        try {
            const ackDir = path.join(tmp, 'ack');
            fs.mkdirSync(ackDir);
            run = runMutant({ project: PROJECT, testFile: WIRING_TEST, spec: { file: row.file, edits: row.edits, root: REPO_ROOT, ackDir } });
            markers = fs.readdirSync(ackDir);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
        const changed = hashCheck(row.name);
        if (changed) return changed;
        const verdict = judgeMutantRun(row, run, markers, allTitles);
        if (verdict) return refuse(verdict.refusal, row.name, verdict.detail);
        for (const f of run.failed) lines.push(`RED-OK ${row.name} :: ${WIRING_TEST} :: ${f.title}`);
    }

    const control = runMutant({ project: PROJECT, testFile: WIRING_TEST });
    const afterControl = hashCheck('control');
    if (afterControl) return afterControl;
    const cv = judgeControlRun(control, allTitles);
    if (cv) return refuse(cv.refusal, `${PROJECT}:${WIRING_TEST}`, cv.detail);
    return { ok: true, lines, controlPassed: control.passed.length };
}

// ---------------------------------------------------------------------------
// --self-test: the judge on built runs, one per refusal. Runs no Vitest.
// ---------------------------------------------------------------------------

function selfTest(): number {
    const G = 'Suite > Guards';
    const titles = [`${G} > Test 22: order`, `${G} > Test 23: exit first`, `${G} > Test 24: v3`, 'Suite > Runtime > Test 31: join'];
    const row: WiringMutantRow = { name: 'w', file: 'src/bot.ts', edits: [{ find: 'a', replace: 'b' }], expected: ['22', 'Test 23:'] };
    const assertion = (s: string) => `AssertionError: ${s}`;
    const mk = (over: Partial<MutantRun>): MutantRun => ({
        status: 1,
        failed: [
            { title: titles[0], message: assertion('expected [ …(3) ] to deeply equal [ …(3) ]') },
            { title: titles[1], message: assertion("expected 'snapshotLpBaseline' to be 'startExitMonitor'") },
        ],
        passedCount: 2,
        passed: [titles[2], titles[3]],
        fileErrors: [],
        outputTail: '',
        ...over,
    });
    const cases: { name: string; run: MutantRun; markers?: string[]; want: Refusal | null }[] = [
        { name: 'valid RED proof', run: mk({}), want: null },
        { name: 'no JSON report', run: mk({ reportError: 'no JSON report: ENOENT' }), want: 'BAD-FAILURE' },
        { name: 'mutant never reached its module', run: mk({}), markers: [], want: 'NOT-REACHED' },
        { name: 'every test passed', run: mk({ status: 0, failed: [], passedCount: 4, passed: titles }), want: 'STAYED-GREEN' },
        { name: 'non-zero exit with no failed test', run: mk({ failed: [], passedCount: 4, passed: titles }), want: 'BAD-FAILURE' },
        { name: 'one expected test missing', run: mk({ failed: [{ title: titles[0], message: assertion('x') }], passed: titles.slice(1) }), want: 'WRONG-SET' },
        { name: 'an extra test failed', run: mk({ failed: [...mk({}).failed, { title: titles[2], message: assertion('x') }], passed: [titles[3]] }), want: 'WRONG-SET' },
        { name: 'a file error instead of the tests', run: mk({ failed: [{ title: `<file error> ${WIRING_TEST}`, message: 'Error: boom' }], passed: [] }), want: 'WRONG-SET' },
        { name: 'a test of the file neither passed nor failed', run: mk({ passed: [titles[2]] }), want: 'WRONG-SET' },
        { name: 'a timed-out test', run: mk({ failed: [mk({}).failed[0], { title: titles[1], message: 'AssertionError: x\nError: Test timed out in 15000ms.' }] }), want: 'BAD-FAILURE' },
        { name: 'a TypeError, not an assertion', run: mk({ failed: [mk({}).failed[0], { title: titles[1], message: 'TypeError: cannot read properties of undefined' }] }), want: 'BAD-FAILURE' },
        { name: 'a compile error in the message', run: mk({ failed: [mk({}).failed[0], { title: titles[1], message: 'AssertionError: TSError: Unable to compile TypeScript' }] }), want: 'BAD-FAILURE' },
    ];
    const controlCases: { name: string; run: MutantRun; want: Refusal | null }[] = [
        { name: 'control: every test passed', run: mk({ status: 0, failed: [], passedCount: 4, passed: titles }), want: null },
        { name: 'control: a test failed', run: mk({}), want: 'CONTROL-FAILED' },
        { name: 'control: a test did not run', run: mk({ status: 0, failed: [], passedCount: 3, passed: titles.slice(1) }), want: 'CONTROL-FAILED' },
        { name: 'control: no JSON report', run: mk({ status: 0, failed: [], reportError: 'no JSON report' }), want: 'CONTROL-FAILED' },
    ];
    let failures = 0;
    const report = (name: string, got: Verdict | null, want: Refusal | null): void => {
        const g = got === null ? null : got.refusal;
        if (g !== want) {
            failures += 1;
            console.error(`SELF-TEST-FAIL ${name}: got ${g ?? 'pass'}${got ? ` (${got.detail.split('\n')[0]})` : ''}, want ${want ?? 'pass'}`);
        } else {
            console.log(`case ok: ${name} -> ${want ?? 'pass'}`);
        }
    };
    for (const c of cases) report(c.name, judgeMutantRun(row, c.run, c.markers ?? ['vite'], titles), c.want);
    for (const c of controlCases) report(c.name, judgeControlRun(c.run, titles), c.want);
    const total = cases.length + controlCases.length;
    if (failures > 0) {
        console.error(`SELF-TEST-FAIL ${failures} of ${total} cases`);
        return 1;
    }
    console.log(`SELF-TEST-OK cases ${total}`);
    return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
    const argv = process.argv.slice(2);
    try {
        let code: number;
        if (argv.length === 1 && argv[0] === '--self-test') {
            code = selfTest();
        } else if (argv.length === 0) {
            const r = proveWiring(WIRING_MUTANTS);
            if (r.ok) {
                for (const l of r.lines) console.log(l);
                console.log(`RED-PROOF-BOT-WIRING-OK mutants ${WIRING_MUTANTS.length} control ${r.controlPassed} passed`);
                code = 0;
            } else {
                console.error(`REFUSED ${r.refusal} ${r.subject}: ${r.detail}`);
                code = 1;
            }
        } else {
            console.error('usage: red-proof-bot-wiring.ts [--self-test]');
            code = 2;
        }
        process.exit(code);
    } catch (e) {
        console.error(`red-proof-bot-wiring: ${(e as Error).stack ?? e}`);
        process.exit(2);
    }
}

if (require.main === module) main();
