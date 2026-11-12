// scripts/triage-report.ts
//
// Phase 23 plan 23-16 (D-11, AC-10; AUDIT-02): the operator's triage report and the run evidence,
// generated from real Vitest JSON reports and the audit register. Nothing here is a hand-kept list
// of findings or outcomes: every entry, claim, expected and actual comes from the reports
// (ctx.task.meta.knownBugs, written by test/realpath/harness/knownBug.ts) or from the register
// (.planning/audit/findings/*.json, triage blocks written by set-triage.ts). The only hand-written
// text is the explanations and the operator questions in OPERATOR_QUESTIONS, and each question
// re-checks the register facts it states before it is printed (a stale question fails the run).
//
// Usage (Node 22.16.0, ABI 127; D-21):
//   node node_modules/ts-node/dist/bin.js scripts/triage-report.ts \
//     --results r1.json --results r2.json --results r3.json \
//     --rail-results rail.json --evidence .planning/audit/inputs/triage-evidence.json \
//     --out .planning/phases/23-test-safety-net-harness-triage-characterization/23-TRIAGE-REPORT.md
//   ... scripts/triage-report.ts --self-test --results r1.json --results r2.json --results r3.json --rail-results rail.json
//
//   --results       a Vitest JSON report of `vitest run --project realpath test/realpath/triage`
//                   (repeatable; at least 3, AC-10)
//   --rail-results  a Vitest JSON report of the unit and integration files carrying a
//                   "closes-finding:" marker (the rail tests of the `fixed` entries, AC-13)
//   --evidence      where to write the run evidence check.ts --stage triage reads
//   --out           where to write the Markdown report
//   --self-test     run the in-memory mutants below over the given reports; write nothing
//
// What it checks before writing anything (any failure: one FAIL line each, nothing written, exit 1):
//   - every report ran green: success true, every file and every test passed;
//   - AC-10: the runs agree on the full tuple set (finding, test file, test title path, claim,
//     expected, actual) and on the set of tests; a difference names the finding, claim and test;
//   - every tuple comes from the evidence zone test/realpath/triage/**/<finding ID>.test.ts and
//     cites a finding in the register (so a harness self-test can never enter the evidence), and
//     cites a finding whose outcome allows it (confirmed, or unreproduced with the claim proven);
//   - completeness against the frozen population (inputs/triage-population.json): every frozen ID
//     is a knownBug tuple (confirmed), a fixed entry whose exact rail_test title passed in the rail
//     report beside its closes-finding marker, a NOT-A-BUG, or an unreproduced entry;
//   - the evidence file holds no absolute path (repo, temp or home folder) and no wall-clock time.
// Then it writes the evidence (sorted tuples; passed_tests = exactly the rail_test titles of the
// fixed entries, sorted) and the report. Both are byte-deterministic for the same inputs: no
// timestamp, run ID, temp path or absolute path (plan 23-26 regenerates the evidence and compares
// bytes). A test identity is its repo-relative forward-slash file path plus its title path, the
// suite titles and the test title joined with " > " (the form set-triage.ts stores in rail_test;
// Vitest's own fullName joins with a space and is never used).
//
// Exit codes: 0 written (or self-test all PASS), 1 a check failed (or a self-test case failed),
// 2 usage error or wrong Node.
//
// D-21: runs on Node 22.16.0 (ABI 127). The Phase 26 Node upgrade must update the assert below.
// Zero new npm deps. Reads no secret: only the JSON reports, the register and test source files.

if (process.versions.modules !== '127') {
    console.error(`triage-report requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}).`);
    process.exit(2);
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cmp, CLAIM_RE, ID_RE, listJson, parseArgs, readJson, UsageError, writeAtomic } from '../.planning/audit/tools/lib';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The evidence zone (same rule as check.ts inZone): test/realpath/triage/**\/<finding ID>.test.ts. */
export const TRIAGE_DIR = 'test/realpath/triage/';
const REPO = path.resolve(__dirname, '..');
const AUDIT_ROOT = path.join(REPO, '.planning', 'audit');
/** First day of Phase 23 execution (the Phase 22 UAT closed on 2026-11-09): a finding found on or after it was registered in Phase 23. */
const PHASE23_FIRST_DAY = '2026-11-10';
/** Severities that need an operator acknowledgement when confirmed (AC-18) or a ruling when closed NOT-A-BUG (AC-17). */
const RULING_SEVERITIES = ['S0', 'S1'];
const MIN_RUNS = 3;

/** Report groups by code area, in report order; every register slice maps to exactly one. */
const AREAS: { name: string; about: string; slices: string[] }[] = [
    { name: 'Buying', about: 'finding a new token, the safety checks before a buy, and the buy itself', slices: ['BUY'] },
    { name: 'Selling', about: 'watching an open position and selling it (stop-loss, take-profit, emergency sells)', slices: ['EXIT'] },
    { name: 'Nonce lock', about: 'sending transactions: the one-at-a-time wallet lock, Flashbots and the public fallback', slices: ['TX'] },
    { name: 'Anti-rug and connections', about: 'watching the pool for the creator pulling the money out, and the live blockchain connections', slices: ['ANTIRUG'] },
    { name: 'Risk limits and database', about: 'the daily-loss and exposure limits, and the trade records on disk', slices: ['DB'] },
    { name: 'Dashboard', about: 'the web dashboard and its buttons', slices: ['API', 'DASH'] },
    {
        name: 'Scripts and tests',
        about: 'the operator scripts you run by hand, and the test safety rails',
        slices: ['SCRIPTS', 'TESTI', 'TESTU', 'TESTQ', 'RAIL', 'CENSUS', 'CONTRACTS', 'ROOT', 'SECRET', 'FORENSIC', 'OD21', 'REAUDIT'],
    },
];

const SEVERITY_WORDS: Record<string, string> = {
    S0: 'S0, the most serious grade',
    S1: 'S1, serious',
    S2: 'S2, moderate',
    S3: 'S3, minor',
    S4: 'S4, tidy-up',
};

const MONEY_WORDS: Record<string, string> = {
    LOSS: 'Money can be lost.',
    STRAND: 'Money can be left in a position the bot no longer protects, or cannot sell.',
    OVERSPEND: 'The bot can spend more than its limits allow.',
    EXPOSURE: 'A safety limit or check can be skipped, so money is exposed to a risk the bot is meant to block.',
    none: 'No direct effect on money.',
};

/** The same classes in a few words, for table cells. */
const MONEY_SHORT: Record<string, string> = {
    LOSS: 'can lose money',
    STRAND: 'position left unprotected or unsellable',
    OVERSPEND: 'can spend past the limits',
    EXPOSURE: 'a safety check can be skipped',
    none: 'none directly',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One knownBug record of one run, the shape check.ts reads plus the plain sentences for the report. */
export interface Tuple {
    finding: string;
    file: string;
    title: string;
    claim: string;
    expected: unknown;
    actual: unknown;
}
interface Rec extends Tuple {
    expectedPlain: string;
    actualPlain: string;
}
interface TestRow {
    file: string;
    title: string;
    status: string;
}
interface Run {
    label: string;
    recs: Rec[];
    tests: TestRow[];
}
export interface Register {
    findings: Map<string, any>;
    frozen: string[];
    frozenSev: Map<string, string>;
    reviews: Map<string, any>;
}
export interface Inputs {
    reports: { label: string; data: unknown }[];
    rail: { label: string; data: unknown };
    register: Register;
    repo: string;
    /** Reads a repo-relative test file (the closes-finding marker check). */
    readText: (rel: string) => string | null;
}
export interface Analysis {
    problems: string[];
    evidence: { tuples: Tuple[]; passed_tests: string[] };
    recs: Rec[];
    tests: number;
    files: number;
    railFiles: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, any> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isStr(v: unknown): v is string {
    return typeof v === 'string' && v.trim() !== '';
}

/** A JSON value with every object's keys sorted (code-point order), so equal values serialize equally. */
function canon(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canon);
    if (isObj(v)) {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v).sort(cmp)) out[k] = canon(v[k]);
        return out;
    }
    return v;
}
const vjson = (v: unknown) => JSON.stringify(canon(v));
const testId = (file: string, title: string) => `${file} > ${title}`;
const tupleId = (t: Tuple) => `${t.finding} claim ${t.claim} (test ${testId(t.file, t.title)})`;

/** Repo-relative forward-slash path of an absolute report path, or null when it is outside the repo. */
function repoRel(abs: string, repo: string): string | null {
    if (!path.isAbsolute(abs)) return null;
    const rel = path.relative(repo, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return rel.split(path.sep).join('/');
}

/** True when a repo-relative path is in the evidence zone and named for a finding in the register. */
function inZone(rel: string, findings: Map<string, any>): boolean {
    if (!rel.startsWith(TRIAGE_DIR) || !rel.endsWith('.test.ts')) return false;
    return findings.has(path.posix.basename(rel).slice(0, -'.test.ts'.length));
}

/** The S0/S1 rule of check.ts: S0/S1 now or at the freeze (a later downgrade never drops it). */
function rulingTier(F: any, reg: Register): boolean {
    return RULING_SEVERITIES.includes(F.severity) || RULING_SEVERITIES.includes(reg.frozenSev.get(String(F.id)) ?? '');
}

/** The triage population as check.ts computes it: the frozen IDs joined with the live set. */
function populationIds(reg: Register): Set<string> {
    const live = [...reg.findings.values()]
        .filter((F) => !F.duplicate_of && ((Array.isArray(F.rc) && F.rc.length) || RULING_SEVERITIES.includes(F.severity)))
        .map((F) => String(F.id));
    return new Set([...reg.frozen, ...live]);
}

/** Every confirmed entry check.ts holds to the AC-18 acknowledgement, sorted. */
export function acknowledgementSet(reg: Register): string[] {
    const pop = populationIds(reg);
    return [...reg.findings.values()]
        .filter((F) => isObj(F.triage) && F.triage.outcome === 'confirmed' && rulingTier(F, reg) && pop.has(String(F.id)))
        .map((F) => String(F.id))
        .sort(cmp);
}

const responded = (r: any) => isObj(r) && isStr(r.operator_response);

/** IDs already acknowledged in a review record that carries an operator response. */
function acknowledgedIn(reg: Register): Map<string, string> {
    const m = new Map<string, string>();
    for (const r of reg.reviews.values()) if (responded(r) && Array.isArray(r.acknowledged)) for (const id of r.acknowledged) if (!m.has(String(id))) m.set(String(id), String(r.id));
    return m;
}

/** The ruling already recorded for a finding (record id and ruling), if any. */
function rulingOf(reg: Register, id: string): { rec: string; ruling: string } | null {
    for (const r of reg.reviews.values()) if (responded(r) && isObj(r.rulings) && isObj(r.rulings[id])) return { rec: String(r.id), ruling: String(r.rulings[id].ruling) };
    return null;
}

function areaOf(slice: string): string | null {
    const a = AREAS.find((x) => x.slices.includes(slice));
    return a ? a.name : null;
}

// ---------------------------------------------------------------------------
// Reading the register
// ---------------------------------------------------------------------------

export function loadRegister(root: string, problems: string[]): Register {
    const findings = new Map<string, any>();
    for (const f of listJson(root, 'findings')) {
        if (f.error || !isObj(f.data) || !isStr(f.data.id)) problems.push(`register file ${f.rel} is unreadable or has no id: ${f.error ?? 'not a finding object'}`);
        else findings.set(f.data.id, f.data);
    }
    const frozen: string[] = [];
    const frozenSev = new Map<string, string>();
    const pf = readJson(path.join(root, 'inputs', 'triage-population.json'), 'inputs/triage-population.json');
    if (pf.error || !isObj(pf.data) || !Array.isArray(pf.data.ids)) problems.push(`the frozen triage population inputs/triage-population.json is unreadable: ${pf.error ?? 'no ids array'}`);
    else {
        if (pf.data.count !== pf.data.ids.length) problems.push(`inputs/triage-population.json: count ${pf.data.count} does not equal its ${pf.data.ids.length} ids`);
        for (const id of pf.data.ids) frozen.push(String(id));
        if (isObj(pf.data.severity_at_freeze)) for (const [k, v] of Object.entries(pf.data.severity_at_freeze)) frozenSev.set(k, String(v));
    }
    const reviews = new Map<string, any>();
    for (const f of listJson(root, 'reviews')) {
        if (f.error || !isObj(f.data)) problems.push(`review record ${f.rel} is unreadable: ${f.error ?? 'not an object'}`);
        else reviews.set(String(f.data.id), f.data);
    }
    return { findings, frozen, frozenSev, reviews };
}

// ---------------------------------------------------------------------------
// Reading one Vitest JSON report
// ---------------------------------------------------------------------------

function parseReport(label: string, data: unknown, repo: string, problems: string[]): Run {
    const run: Run = { label, recs: [], tests: [] };
    if (!isObj(data) || !Array.isArray(data.testResults)) {
        problems.push(`${label}: not a Vitest JSON report (no testResults array)`);
        return run;
    }
    if (data.success !== true) problems.push(`${label}: the run did not succeed (success ${String(data.success)}, ${String(data.numFailedTests)} failed tests)`);
    if (!data.testResults.length) problems.push(`${label}: the report holds no test file`);
    const seen = new Set<string>();
    for (const fr of data.testResults) {
        const rel = isObj(fr) && typeof fr.name === 'string' ? repoRel(fr.name, repo) : null;
        if (!isObj(fr) || rel === null) {
            problems.push(`${label}: a test file entry has no path inside the repository (${isObj(fr) ? String(fr.name) : 'not an object'})`);
            continue;
        }
        if (fr.status !== 'passed' || (isStr(fr.message) && fr.message !== '')) problems.push(`${label}: test file ${rel} did not pass (status ${String(fr.status)}${isStr(fr.message) ? `: ${fr.message}` : ''})`);
        if (!Array.isArray(fr.assertionResults) || !fr.assertionResults.length) {
            problems.push(`${label}: test file ${rel} reports no test`);
            continue;
        }
        for (const ar of fr.assertionResults) {
            if (!isObj(ar) || !Array.isArray(ar.ancestorTitles) || typeof ar.title !== 'string') {
                problems.push(`${label}: a test in ${rel} has no title path`);
                continue;
            }
            const title = [...ar.ancestorTitles.map(String), ar.title].join(' > ');
            const id = testId(rel, title);
            if (seen.has(id)) problems.push(`${label}: test identity ${id} appears twice, so its tuples cannot be told apart`);
            seen.add(id);
            run.tests.push({ file: rel, title, status: String(ar.status) });
            if (ar.status !== 'passed') problems.push(`${label}: test ${id} is ${String(ar.status)}, not passed`);
            const kbs = isObj(ar.meta) ? ar.meta.knownBugs : undefined;
            if (kbs === undefined) continue;
            if (!Array.isArray(kbs)) {
                problems.push(`${label}: test ${id} has a meta.knownBugs that is not an array`);
                continue;
            }
            for (const kb of kbs) {
                const finding = isObj(kb) && typeof kb.id === 'string' ? kb.id : String(isObj(kb) ? kb.id : kb);
                if (!isObj(kb) || !isStr(kb.claim) || !CLAIM_RE.test(kb.claim) || !('expected' in kb) || !('actual' in kb) || !isStr(kb.expectedPlain) || !isStr(kb.actualPlain)) {
                    problems.push(`${label}: test ${id} holds a knownBug record for ${finding} without the {id, claim, expected, actual, expectedPlain, actualPlain} shape`);
                    continue;
                }
                run.recs.push({ finding, file: rel, title, claim: kb.claim, expected: canon(kb.expected), actual: canon(kb.actual), expectedPlain: kb.expectedPlain, actualPlain: kb.actualPlain });
            }
        }
    }
    return run;
}

// ---------------------------------------------------------------------------
// The analysis (pure over its inputs; the self-test drives it with mutants)
// ---------------------------------------------------------------------------

export function analyze(inp: Inputs): Analysis {
    const problems: string[] = [];
    const reg = inp.register;
    const runs = inp.reports.map((r) => parseReport(r.label, r.data, inp.repo, problems));
    if (runs.length < MIN_RUNS) problems.push(`AC-10 needs at least ${MIN_RUNS} runs; got ${runs.length}`);

    // Zone, register and outcome rules on every record of every run.
    for (const run of runs) {
        const ids = new Set<string>();
        for (const r of run.recs) {
            const where = `${run.label}: knownBug ${r.finding} claim ${r.claim} in ${testId(r.file, r.title)}`;
            if (!inZone(r.file, reg.findings)) problems.push(`${where}: file ${r.file} is outside the evidence zone ${TRIAGE_DIR}**/<finding ID>.test.ts (finding ${r.finding}); a harness self-test or a stray file can never be run evidence`);
            const F = reg.findings.get(r.finding);
            if (!ID_RE.finding.test(r.finding) || !F) {
                problems.push(`${where}: finding ${r.finding} (file ${r.file}) is not in the register`);
                continue;
            }
            const t = F.triage;
            const ok = isObj(t) && (t.outcome === 'confirmed' || (t.outcome === 'unreproduced' && Array.isArray(t.proven_claims) && t.proven_claims.includes(r.claim)));
            if (!ok) problems.push(`${where}: ${r.finding}'s outcome is ${isObj(t) ? String(t.outcome) : 'not recorded'}, so it may not carry this claim (a knownBug may cite only a confirmed finding, or an unreproduced one for a proven claim)`);
            const k = `${r.finding}\u0000${testId(r.file, r.title)}\u0000${r.claim}`;
            if (ids.has(k)) problems.push(`${where}: recorded twice in one test`);
            ids.add(k);
        }
    }

    // AC-10: every run agrees with the first on tests and on full tuples.
    const base = runs[0];
    if (base) {
        const tupleMap = (run: Run) => new Map(run.recs.map((r) => [`${r.finding}\u0000${testId(r.file, r.title)}\u0000${r.claim}`, r] as const));
        const baseTuples = tupleMap(base);
        const baseTests = new Set(base.tests.map((t) => testId(t.file, t.title)));
        for (const run of runs.slice(1)) {
            const tests = new Set(run.tests.map((t) => testId(t.file, t.title)));
            for (const t of [...baseTests].sort(cmp)) if (!tests.has(t)) problems.push(`AC-10: ${run.label} has no test ${t}, which ${base.label} ran`);
            for (const t of [...tests].sort(cmp)) if (!baseTests.has(t)) problems.push(`AC-10: ${run.label} ran test ${t}, which ${base.label} did not`);
            const other = tupleMap(run);
            for (const [k, a] of baseTuples) {
                const b = other.get(k);
                if (!b) problems.push(`AC-10: ${run.label} is missing ${tupleId(a)}, which ${base.label} recorded`);
                else {
                    if (vjson(a.expected) !== vjson(b.expected)) problems.push(`AC-10: ${tupleId(a)}: expected differs between ${base.label} (${vjson(a.expected)}) and ${run.label} (${vjson(b.expected)})`);
                    if (vjson(a.actual) !== vjson(b.actual)) problems.push(`AC-10: ${tupleId(a)}: actual differs between ${base.label} (${vjson(a.actual)}) and ${run.label} (${vjson(b.actual)})`);
                    if (a.expectedPlain !== b.expectedPlain || a.actualPlain !== b.actualPlain) problems.push(`AC-10: ${tupleId(a)}: the plain sentences differ between ${base.label} and ${run.label}`);
                }
            }
            for (const [k, b] of other) if (!baseTuples.has(k)) problems.push(`AC-10: ${run.label} recorded ${tupleId(b)}, which ${base.label} did not`);
        }
    }
    const recs = base ? [...base.recs].sort((a, b) => cmp(a.finding, b.finding) || cmp(a.file, b.file) || cmp(a.title, b.title) || cmp(a.claim, b.claim)) : [];

    // The rail run: green, and each fixed entry's exact rail_test passed beside its closes-finding marker.
    const rail = parseReport(inp.rail.label, inp.rail.data, inp.repo, problems);
    if (rail.recs.length) problems.push(`${inp.rail.label}: the rail report holds knownBug records (${rail.recs.map((r) => r.finding).join(', ')}); the rail run must be the unit and integration rail files only`);
    const railFiles = new Map<string, string>();
    const passed: string[] = [];
    for (const F of [...reg.findings.values()].sort((a, b) => cmp(String(a.id), String(b.id)))) {
        const t = F.triage;
        if (!isObj(t) || t.outcome !== 'fixed') continue;
        const id = String(F.id);
        if (!isStr(t.rail_test)) {
            problems.push(`${id}: outcome fixed has no rail_test title`);
            continue;
        }
        const rows = rail.tests.filter((x) => x.title === t.rail_test);
        if (!rows.length) problems.push(`${id}: rail_test "${t.rail_test}" is not in the rail report ${inp.rail.label} (run the files carrying the closes-finding markers)`);
        else if (rows.some((x) => x.status !== 'passed')) problems.push(`${id}: rail_test "${t.rail_test}" did not pass in ${inp.rail.label} (${rows.map((x) => `${x.file}: ${x.status}`).join('; ')})`);
        else {
            const marker = new RegExp(`(^|[^A-Za-z0-9-])closes-finding: ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`, 'm');
            const marked = rows.filter((x) => marker.test(inp.readText(x.file) ?? ''));
            if (!marked.length) problems.push(`${id}: rail_test "${t.rail_test}" passed in ${rows.map((x) => x.file).join(', ')}, but no such file carries the marker "closes-finding: ${id}"`);
            else {
                railFiles.set(id, marked[0].file);
                passed.push(t.rail_test);
            }
        }
    }

    // Completeness: every frozen ID is accounted for; every outcome's run evidence is present.
    const findingsWithTuples = new Set(recs.map((r) => r.finding));
    for (const id of reg.frozen) {
        const F = reg.findings.get(id);
        if (!F) {
            problems.push(`frozen population ID ${id} names no finding in the register`);
            continue;
        }
        const t = F.triage;
        if (!isObj(t)) problems.push(`frozen population ID ${id} has no triage outcome, so it is unaccounted for`);
        else if (t.outcome === 'confirmed' && !findingsWithTuples.has(id)) problems.push(`frozen population ID ${id} is confirmed but no run recorded a knownBug tuple for it`);
        else if (t.outcome === 'fixed' && !railFiles.has(id)) problems.push(`frozen population ID ${id} is fixed but its rail_test was not shown passing, so it is unaccounted for`);
        else if (!['confirmed', 'fixed', 'NOT-A-BUG', 'unreproduced'].includes(String(t.outcome))) problems.push(`frozen population ID ${id} has unknown outcome ${String(t.outcome)}`);
    }
    for (const F of reg.findings.values()) {
        const t = F.triage;
        if (!isObj(t)) continue;
        const id = String(F.id);
        if (t.outcome === 'confirmed' && !findingsWithTuples.has(id)) problems.push(`${id} is confirmed but no run recorded a knownBug tuple for it (check.ts needs one)`);
        if (t.outcome === 'unreproduced' && Array.isArray(t.proven_claims))
            for (const c of t.proven_claims) if (!recs.some((r) => r.finding === id && r.claim === c)) problems.push(`${id}: proven claim ${String(c)} has no knownBug tuple in the runs`);
    }

    const evidence = {
        tuples: recs.map((r) => ({ finding: r.finding, file: r.file, title: r.title, claim: r.claim, expected: r.expected, actual: r.actual })),
        passed_tests: [...new Set(passed)].sort(cmp),
    };
    // The evidence must be reproducible byte for byte: no absolute path, no wall-clock time.
    const text = JSON.stringify(evidence);
    const folds = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
    for (const dir of new Set([inp.repo, os.tmpdir(), os.homedir()])) {
        for (const form of [dir.split(path.sep).join('/'), dir.split(path.sep).join('\\\\'), dir]) if (form.length > 3 && folds(text).includes(folds(form))) problems.push(`the evidence would hold the absolute path ${form}; it must hold only repo-relative paths`);
    }
    const now = new Date();
    for (const d of [now, new Date(now.getTime() - 86400000)]) {
        const day = d.toISOString().slice(0, 10);
        if (text.includes(day)) problems.push(`the evidence would hold today's or yesterday's date ${day} (a wall-clock time makes it unreproducible)`);
    }
    return { problems, evidence, recs, tests: base ? base.tests.length : 0, files: base ? new Set(base.tests.map((t) => t.file)).size : 0, railFiles };
}

// ---------------------------------------------------------------------------
// Operator questions (hand-written text; each re-checks the register facts it states)
// ---------------------------------------------------------------------------

interface Question {
    id: string;
    heading: string;
    /** Register facts the text depends on; any false one fails the run (the text is stale). */
    requires: (reg: Register) => string[];
    body: string[];
    reply: string;
}

function factsOf(reg: Register, id: string, want: { severity?: string; outcome?: string; status?: string }): string[] {
    const F = reg.findings.get(id);
    if (!F) return [`${id} is not in the register`];
    const out: string[] = [];
    if (want.severity && F.severity !== want.severity) out.push(`${id} severity is ${F.severity}, the question assumes ${want.severity}`);
    if (want.outcome && F.triage?.outcome !== want.outcome) out.push(`${id} triage outcome is ${String(F.triage?.outcome)}, the question assumes ${want.outcome}`);
    if (want.status && F.status !== want.status) out.push(`${id} status is ${F.status}, the question assumes ${want.status}`);
    return out;
}

const OPERATOR_QUESTIONS: Question[] = [
    {
        id: 'AUD-TX-006',
        heading: 'AUD-TX-006: keep it open, or close it as not a bug?',
        requires: (reg) => [
            ...factsOf(reg, 'AUD-TX-006', { severity: 'S3', outcome: 'unreproduced', status: 'candidate' }),
            ...(JSON.stringify(reg.findings.get('AUD-TX-006')?.triage?.open_claims ?? []) === '["endpoint-still-answers"]' ? [] : ['AUD-TX-006 open_claims changed']),
        ],
        body: [
            'This is the one entry the tests could not settle, so the rules need your ruling on it (AC-08). It is graded S3 (minor): it does not move money by itself.',
            '',
            '- **What the bot does:** every time it sends a private buy or sell through Flashbots on Ethereum, it also asks Flashbots for delivery statistics, and it asks while it holds the wallet lock. One of its messages to you tells you to look for those statistics in the logs.',
            '- **What is proven:** the statistics request really is made inside the wallet lock (test `AUD-TX-006.test.ts`, claim `stats-call-inside-lock`). A slow answer there holds up every other transaction on that wallet.',
            '- **What is not proven:** whether Flashbots still answers that request at all. The one request you approved in plan 23-15 got "403 Forbidden: rpc method is not whitelisted". That can mean the request is closed to everyone, or open only to senders Flashbots has approved. One request from a throwaway key cannot tell which. If it is closed for the bot too, the bot logs an error on every Ethereum attempt and its message points you at statistics that never arrive.',
            '- **The recorded answer:** `.planning/audit/inputs/aud-tx-006-relay-response.json`. No further Flashbots request will be sent.',
            '- **Your options:** (1) **keep open**: it stays on the list, and Phase 29 (card TX-03) removes or moves the call either way; nothing is lost. (2) **close as not a bug**: it leaves the list, and its test marker would be removed too.',
            '- **Recommendation:** keep open. The part that is proven (the call inside the lock) is a real delay on the wallet, and Phase 29 has to change the call whatever Flashbots answers.',
        ],
        reply: 'TX-006: keep open (or: TX-006: close, because ...)',
    },
    {
        id: 'AUD-ANTIRUG-025',
        heading: 'AUD-ANTIRUG-025 weakens the "restart after a deliberate buy" rule: should the rule change?',
        requires: (reg) => [...factsOf(reg, 'AUD-ANTIRUG-025', { severity: 'S1', outcome: 'confirmed' }), ...factsOf(reg, 'AUD-BUY-001', { severity: 'S0', outcome: 'confirmed' })],
        body: [
            'In Phase 22 you set an interim rule for AUD-BUY-001 (ESC-BUY-01): after any deliberate buy (the `deliberate-buy` script), start or restart the main bot at once, because the script protects the position only while it runs and it exits straight away.',
            '',
            '- **What Phase 23 found (AUD-ANTIRUG-025, new, S1):** every time the bot starts up with an open position, it drops that position\'s anti-rug watch. Start-up re-registers the position and then re-arms the connection, and the two steps race inside the blockchain library, so the watch request is never sent. So the restart in your rule brings back the **exit monitor** (stop-loss and take-profit) but **not anti-rug**: if the token\'s creator pulled the money out of the pool, the bot would not see it and would not sell first.',
            '- **What it means today:** nothing. The bot is off for all of v7.0, so no position is exposed.',
            '- **What it means for a deliberate buy before Phase 24 fixes it:** that position would have stop-loss and take-profit after the restart, but no rug-pull protection, until a buy on a new pair happens to re-arm the watch.',
            '- **Your options:** (1) **change the rule to "no deliberate buy until Phase 24 has fixed AUD-BUY-001 and AUD-ANTIRUG-025"**. (2) **keep the rule and read it as covering the exit monitor only**, accepting no rug-pull protection on such a position. (3) another rule you name.',
            '- **Recommendation:** option 1. It costs nothing while the bot is off, and Phase 24 should fix AUD-ANTIRUG-025 with or before AUD-BUY-001 anyway.',
        ],
        reply: 'ANTIRUG-025: option 1 (or 2, or your own rule)',
    },
    {
        id: 'AUD-ANTIRUG-018',
        heading: 'AUD-ANTIRUG-018: does any chain you run have no WebSocket address?',
        requires: (reg) => factsOf(reg, 'AUD-ANTIRUG-018', { severity: 'S1', outcome: 'confirmed' }),
        body: [
            'In plan 23-01 you raised this to S1 and answered "Not sure" when asked whether any chain runs without a WebSocket address. Phase 23 has now shown the harm on the real code, so it helps to know your setup. This is not a ruling, and the grade does not depend on it.',
            '',
            '- **What the bot does:** a chain with a WebSocket address gets live push updates. A chain without one is watched by asking for new blocks every few seconds over plain HTTP. After any restart, that HTTP watcher asks for every block it missed in one single request.',
            '- **What goes wrong:** many providers refuse a request for more than a few blocks at once (Alchemy\'s free plan allows 10 blocks, about 2 minutes on Ethereum). After the bot has been down longer than that, every request is refused, the watcher never moves on, and the anti-rug watch on that chain sees nothing, silently, while the dashboard still says "connected". The test showed a real liquidity pull going unseen after 6 minutes of downtime.',
            '- **How to check:** in your `.env`, look at `ENABLED_CHAINS` (default `eth`), and for each chain listed check whether its line `ETH_WS_URL`, `BSC_WS_URL`, `BASE_WS_URL` or `ARB_WS_URL` has an address after the `=`. Or run this one line from the project folder; it prints only "set" or "NOT set", never the address: `node -e "require(\'dotenv\').config();for(const c of (process.env.ENABLED_CHAINS||\'eth\').split(\',\')){const k=c.trim().toUpperCase()+\'_WS_URL\';console.log(c.trim(),k,process.env[k]?\'set\':\'NOT set\')}"`',
            '- **What it means today:** nothing; the bot is off. It tells Phase 24 how urgent this fix is for your setup.',
        ],
        reply: 'ANTIRUG-018: every enabled chain has a WebSocket address (or: chain X has none, or: still not sure)',
    },
];

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function sevWords(s: string): string {
    return SEVERITY_WORDS[s] ?? s;
}

export function buildReport(a: Analysis, reg: Register, problems: string[]): string {
    const L: string[] = [];
    const F = (id: string) => reg.findings.get(id);
    const triaged = [...reg.findings.values()].filter((x) => isObj(x.triage)).sort((x, y) => cmp(String(x.id), String(y.id)));
    for (const x of triaged) if (!areaOf(String(x.slice))) problems.push(`${x.id}: slice ${String(x.slice)} has no report area; add it to AREAS in scripts/triage-report.ts`);
    const ack = acknowledgementSet(reg);
    const ackedIn = acknowledgedIn(reg);
    const popSet = new Set(reg.frozen);
    const byOutcome = (o: string, ids: Iterable<string>) => [...ids].filter((id) => F(id)?.triage?.outcome === o);
    const pop = reg.frozen;
    const nConf = byOutcome('confirmed', pop).length;
    const nFixed = byOutcome('fixed', pop).length;
    const nUnrep = byOutcome('unreproduced', pop).length;
    const nNab = byOutcome('NOT-A-BUG', pop).length;
    const outside = triaged.filter((x) => !popSet.has(String(x.id)));
    const needRuling = triaged.filter((x) => x.triage.outcome === 'unreproduced' || (x.triage.outcome === 'NOT-A-BUG' && rulingTier(x, reg)));
    const forks = triaged.filter((x) => x.triage.needs_fork === true);
    const phase23 = [...reg.findings.values()].filter((x) => isStr(x.found_date) && x.found_date >= PHASE23_FIRST_DAY).sort((x, y) => cmp(String(x.id), String(y.id)));
    const recsBy = new Map<string, Rec[]>();
    for (const r of a.recs) (recsBy.get(r.finding) ?? recsBy.set(r.finding, []).get(r.finding)!).push(r);

    for (const q of OPERATOR_QUESTIONS) for (const p of q.requires(reg)) problems.push(`operator question ${q.id} is stale: ${p}; update OPERATOR_QUESTIONS in scripts/triage-report.ts`);
    for (const x of needRuling) if (!OPERATOR_QUESTIONS.some((q) => q.id === x.id)) problems.push(`${x.id} needs an operator ruling but has no plain-language question in OPERATOR_QUESTIONS`);

    L.push('# Phase 23 triage report: what the tests found');
    L.push('');
    L.push('This report is generated by `scripts/triage-report.ts` from the recorded results of three identical runs of the real-path triage tests and one run of the safety-rail tests. The findings, results and test names below come from those runs and from the audit register; only the explanations and the questions are written by hand.');
    L.push('');
    L.push('**Nothing has been fixed.** Fixing is Phase 24 (the serious problems) and Phase 29 (the rest). The bot stays off for all of v7.0.');
    L.push('');
    L.push('## Words used in this report');
    L.push('');
    L.push('- **Real-path test:** a test that runs the bot\'s real code (real transaction signing, a real database file, the real blockchain library) against a simulated blockchain on this computer. Nothing reaches a real network.');
    L.push('- **Confirmed:** a test shows the problem happening today. Each such test is written to fail with "looks fixed" once the problem is fixed, which is how Phase 24 will prove each fix.');
    L.push('- **S0 to S4:** the grade. S0: money is lost or stuck on an ordinary path. S1: money can be lost, stuck, overspent or exposed under a plausible condition. S2: a bounded or indirect effect on money. S3: misleading behavior or messages. S4: tidy-up.');
    L.push('- **Exit monitor:** the part of the bot that watches an open position\'s price and sells it (stop-loss, take-profit).');
    L.push('- **Anti-rug:** the part that watches the token\'s pool for the creator pulling the money out (a "rug pull") and sells first.');
    L.push('- **Nonce lock:** the wallet\'s one-at-a-time lock, so two transactions never take the same slot.');
    L.push('- **Fork run:** a test against a local copy of the real Ethereum blockchain, planned for Phase 25. Some questions need real contracts and real tokens, which the simulated chain does not have.');
    L.push('- **Safety rails:** the Phase 22 test guards that stop any test from touching your real settings file, your real database, Telegram or a real network.');
    L.push('');
    L.push('## The count');
    L.push('');
    L.push(`- **${pop.length} entries** were on the triage list (frozen in \`.planning/audit/inputs/triage-population.json\`). Every one has an outcome:`);
    L.push(`  - ${nConf} confirmed: a test shows the problem today;`);
    L.push(`  - ${nFixed} already fixed by the Phase 22 safety rails: their rail tests passed in this run;`);
    L.push(`  - ${nUnrep} not fully reproduced: it needs your ruling;`);
    L.push(`  - ${nNab} closed as not a bug.`);
    L.push(`- **${outside.length} more** were found and proven during Phase 23 itself, outside the list: ${outside.map((x) => x.id).join(', ') || 'none'}.`);
    L.push(`- **${ack.length} confirmed serious problems (S0 or S1)** need your acknowledgement, listed under question 1.`);
    L.push(`- **The three runs agreed exactly:** ${a.recs.length} recorded results (one per proven claim) from ${a.files} test files and ${a.tests} tests, identical in every run by finding, test, claim, expected and actual. ${a.evidence.passed_tests.length} rail tests passed. The machine-readable copy is \`.planning/audit/inputs/triage-evidence.json\`.`);
    L.push('');
    L.push('## What needs your reply');
    L.push('');
    L.push('Only the items below need you. The sections after them are the full record, for reference.');
    L.push('');
    let n = 1;
    L.push(`### ${n++}. Acknowledge the ${ack.length} confirmed serious problems (S0 and S1)`);
    L.push('');
    L.push('Acknowledging means: you have seen each problem and the test that shows it. It does not change any grade, and nothing is fixed until Phase 24.');
    L.push('');
    L.push('The "What goes wrong" text is the audit register\'s own one-line title, so it uses some names from the code. The same problem in plain sentences ("What was expected" and "What happened", written by each test) is under its ID in the area sections below.');
    L.push('');
    L.push('| ID | Grade | Area | What goes wrong | Money at risk |');
    L.push('|---|---|---|---|---|');
    for (const id of ack) {
        const x = F(id);
        const done = ackedIn.get(id);
        L.push(`| ${id}${done ? ` (acknowledged in ${done})` : ''} | ${x.severity} | ${areaOf(String(x.slice))} | ${String(x.title).replace(/\|/g, '/')} | ${MONEY_SHORT[String(x.capital_impact)] ?? String(x.capital_impact)} |`);
    }
    L.push('');
    for (const x of needRuling) {
        const q = OPERATOR_QUESTIONS.find((y) => y.id === x.id);
        const done = rulingOf(reg, String(x.id));
        L.push(`### ${n++}. ${q ? q.heading : `${x.id}: ruling needed`}${done ? ` (ruled ${done.ruling} in ${done.rec})` : ''}`);
        L.push('');
        if (q) L.push(...q.body);
        L.push('');
    }
    for (const q of OPERATOR_QUESTIONS.filter((y) => !needRuling.some((x) => x.id === y.id))) {
        L.push(`### ${n++}. ${q.heading}`);
        L.push('');
        L.push(...q.body);
        L.push('');
    }
    const forkNew = forks.filter((x) => !isStr(x.triage.fork_ref));
    const forkHad = forks.filter((x) => isStr(x.triage.fork_ref));
    L.push(`### ${n++}. Questions for the Phase 25 fork run`);
    L.push('');
    L.push(`These ${forkNew.length} confirmed problems are proven on the simulated chain for the part the bot's own code decides. The rest depends on how real contracts and real tokens behave, so each question goes on the Phase 25 fork-run list. Say so if any should not go there.`);
    L.push('');
    for (const x of forkNew) {
        L.push(`- **${x.id}** (${sevWords(x.severity)}): ${x.title}`);
        L.push(`  - **Fork question:** ${x.triage.fork_question}`);
    }
    if (forkHad.length) {
        L.push('');
        L.push(`Already on that list from Phase 22, no reply needed: ${forkHad.map((x) => `${x.id} (${x.triage.fork_ref})`).join(', ')}.`);
    }
    L.push('');
    L.push('### How to reply');
    L.push('');
    L.push('Reply in your own words; they are recorded exactly. Please address each numbered item by its ID, for example:');
    L.push('');
    L.push('```');
    L.push(`1. acknowledge all ${ack.length}`);
    const replies = [...needRuling.map((x) => OPERATOR_QUESTIONS.find((q) => q.id === x.id)?.reply ?? `${x.id}: keep open or close, because ...`), ...OPERATOR_QUESTIONS.filter((y) => !needRuling.some((x) => x.id === y.id)).map((q) => q.reply)];
    replies.forEach((r, i) => L.push(`${i + 2}. ${r}`));
    L.push(`${replies.length + 2}. fork questions: all go to Phase 25 (or: not <ID>, because ...)`);
    L.push('```');
    L.push('');
    L.push('## Found during Phase 23 (for your information)');
    L.push('');
    L.push('These were registered while Phase 23 ran. Under your standing instruction ("All the bugs are going to get fixed ... Don\'t interrupt sessions to ask me about upgrading or downgrading") the executors graded them and carried on. The S0/S1 ones are in the acknowledgement list above; the others need no ruling.');
    L.push('');
    L.push('| ID | Grade | Money at risk | Status | Triage test | What goes wrong |');
    L.push('|---|---|---|---|---|---|');
    for (const x of phase23) {
        const proof = isObj(x.triage) ? `yes, outcome ${x.triage.outcome}` : 'none of its own';
        const note = popSet.has(String(x.id)) ? ' (on the triage list by your ruling)' : '';
        L.push(`| ${x.id}${note} | ${x.severity} | ${MONEY_SHORT[String(x.capital_impact)] ?? String(x.capital_impact)} | ${x.status} | ${proof} | ${String(x.title).replace(/\|/g, '/')} |`);
    }
    L.push('');
    L.push('## Results by code area');
    L.push('');
    L.push('Each entry gives what the bot should do ("What was expected"), what it did in the test ("What happened"), and the test that shows it. Entries are ordered by grade, most serious first.');
    L.push('');
    for (const area of AREAS) {
        const items = triaged.filter((x) => areaOf(String(x.slice)) === area.name).sort((x, y) => cmp(String(x.severity), String(y.severity)) || cmp(String(x.id), String(y.id)));
        if (!items.length) continue;
        L.push(`### ${area.name}`);
        L.push('');
        L.push(`About ${area.about}.`);
        L.push('');
        for (const x of items) {
            const id = String(x.id);
            const t = x.triage;
            const tags: string[] = [];
            if (ack.includes(id)) tags.push(ackedIn.has(id) ? `acknowledged in ${ackedIn.get(id)}` : 'needs your acknowledgement');
            if (needRuling.includes(x)) tags.push(rulingOf(reg, id) ? `ruled in ${rulingOf(reg, id)!.rec}` : 'needs your ruling');
            if (t.needs_fork === true) tags.push(isStr(t.fork_ref) ? `fork run ${t.fork_ref}` : 'needs a Phase 25 fork run');
            if (!popSet.has(id)) tags.push('found in Phase 23');
            L.push(`#### ${id} (${sevWords(x.severity)})${tags.length ? `: ${tags.join('; ')}` : ''}`);
            L.push('');
            L.push(`**The problem:** ${x.title}.`.replace(/\.\.$/, '.'));
            L.push('');
            L.push(`**What could cost money:** ${MONEY_WORDS[String(x.capital_impact)] ?? String(x.capital_impact)}`);
            L.push('');
            const rs = recsBy.get(id) ?? [];
            if (t.outcome === 'confirmed') L.push(`**Outcome:** confirmed. ${rs.length === 1 ? 'One claim is' : `${rs.length} claims are`} shown failing today.`);
            else if (t.outcome === 'fixed') L.push(`**Outcome:** already fixed by the Phase 22 safety rails. The rail test \`${a.railFiles.get(id) ?? '?'}\` > "${t.rail_test}" passed in this run.`);
            else if (t.outcome === 'unreproduced')
                L.push(`**Outcome:** not fully reproduced. Proven: ${(t.proven_claims ?? []).map((c: string) => `\`${c}\``).join(', ') || 'nothing'}. Still open: ${(t.open_claims ?? []).map((c: string) => `\`${c}\``).join(', ') || 'nothing listed'}.`);
            else L.push(`**Outcome:** ${t.outcome}.`);
            L.push('');
            for (const r of rs) {
                L.push(`- **Claim \`${r.claim}\`** (test \`${r.file}\` > "${r.title}")`);
                L.push(`  - **What was expected:** ${r.expectedPlain}`);
                L.push(`  - **What happened:** ${r.actualPlain}`);
            }
            if (rs.length) L.push('');
            if (t.needs_fork === true && isStr(t.fork_question)) {
                L.push(`**Fork question:** ${t.fork_question}`);
                L.push('');
            }
            L.push(`**Test notes (technical, for the record):** ${t.note}`);
            L.push('');
        }
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

// ---------------------------------------------------------------------------
// Self-test: mutants of the real reports, each must fail with its named problem
// ---------------------------------------------------------------------------

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

/** Every [fileResult, assertionResult, knownBug] of a report. */
function kbEntries(rep: any): [any, any, any][] {
    const out: [any, any, any][] = [];
    for (const fr of rep.testResults ?? []) for (const ar of fr.assertionResults ?? []) for (const kb of ar.meta?.knownBugs ?? []) out.push([fr, ar, kb]);
    return out;
}

function selfTest(base: Inputs, out: (l: string) => void): number {
    const reports = base.reports.map((r) => r.data as any);
    const rail = base.rail.data as any;
    const first = kbEntries(reports[0])[0];
    if (!first) {
        out('FAIL self-test: the first report holds no knownBug record to mutate');
        return 1;
    }
    const [fr0, ar0, kb0] = first;
    const title0 = [...ar0.ancestorTitles, ar0.title].join(' > ');
    const confirmedFrozen = base.register.frozen.find((id) => base.register.findings.get(id)?.triage?.outcome === 'confirmed' && kbEntries(reports[0]).some(([, , kb]) => kb.id === id));
    const fixed = [...base.register.findings.values()].find((F) => F.triage?.outcome === 'fixed');
    const harnessAbs = path.join(base.repo, 'test', 'realpath', 'harnessCapture.test.ts').split(path.sep).join('/');
    const fakeAbs = path.join(base.repo, 'test', 'realpath', 'triage', 'AUD-ZZZ-999.test.ts').split(path.sep).join('/');
    const withRun = (i: number, f: (r: any) => void) => (rs: any[]) => {
        const c = rs.map(clone);
        f(c[i]);
        return c;
    };
    const extraFile = (abs: string, id: string) => ({
        name: abs,
        status: 'passed',
        message: '',
        assertionResults: [{ ancestorTitles: ['tampered'], title: 'tampered', status: 'passed', meta: { knownBugs: [{ id, claim: 'tampered-claim', expected: 1, actual: 2, expectedPlain: 'x', actualPlain: 'y' }] } }],
    });
    const findTest = (rep: any) => rep.testResults.find((f: any) => f.name === fr0.name).assertionResults.find((a: any) => a.title === ar0.title);
    const cases: { name: string; reports?: (rs: any[]) => any[]; rail?: (r: any) => any; expect: string }[] = [
        { name: 'clean: the real reports pass', expect: '' },
        {
            name: 'a changed actual in run 2 names the finding and claim',
            reports: withRun(1, (r) => (findTest(r).meta.knownBugs[0].actual = { tampered: true })),
            expect: `${kb0.id} claim ${kb0.claim} (test ${repoRel(fr0.name, base.repo)} > ${title0}): actual differs`,
        },
        {
            name: 'a dropped claim in run 3 names the finding and claim',
            reports: withRun(2, (r) => findTest(r).meta.knownBugs.splice(0, 1)),
            expect: `is missing ${kb0.id} claim ${kb0.claim}`,
        },
        {
            name: 'a dropped test in run 2 names the test even when another is added',
            reports: withRun(1, (r) => {
                const f = r.testResults.find((x: any) => x.name === fr0.name);
                const t = f.assertionResults.find((a: any) => a.title === ar0.title);
                t.title = `${t.title} (renamed)`;
            }),
            expect: `has no test ${repoRel(fr0.name, base.repo)} > ${title0}`,
        },
        {
            name: 'a tuple from test/realpath/harnessCapture.test.ts names that file',
            reports: (rs) => rs.map((r) => {
                const c = clone(r);
                c.testResults.push(extraFile(harnessAbs, kb0.id));
                return c;
            }),
            expect: 'file test/realpath/harnessCapture.test.ts is outside the evidence zone',
        },
        {
            name: 'a finding not in the register names the finding and file',
            reports: (rs) => rs.map((r) => {
                const c = clone(r);
                c.testResults.push(extraFile(fakeAbs, 'AUD-ZZZ-999'));
                return c;
            }),
            expect: 'finding AUD-ZZZ-999 (file test/realpath/triage/AUD-ZZZ-999.test.ts) is not in the register',
        },
        {
            name: 'a failed triage test fails',
            reports: withRun(0, (r) => (findTest(r).status = 'failed')),
            expect: `test ${repoRel(fr0.name, base.repo)} > ${title0} is failed, not passed`,
        },
        {
            name: 'a confirmed frozen entry with no tuple in any run is unaccounted for',
            reports: (rs) => rs.map((r) => {
                const c = clone(r);
                for (const f of c.testResults) for (const a of f.assertionResults) if (a.meta?.knownBugs) a.meta.knownBugs = a.meta.knownBugs.filter((k: any) => k.id !== confirmedFrozen);
                return c;
            }),
            expect: `frozen population ID ${confirmedFrozen} is confirmed but no run recorded a knownBug tuple`,
        },
        {
            name: 'an absolute path in a recorded value fails the evidence',
            reports: (rs) => rs.map((r) => {
                const c = clone(r);
                findTest(c).meta.knownBugs[0].actual = { path: base.repo.split(path.sep).join('/') + '/x' };
                findTest(c).meta.knownBugs[0].expected = { path: 'y' };
                return c;
            }),
            expect: 'the evidence would hold the absolute path',
        },
        {
            name: 'only two runs fail AC-10',
            reports: (rs) => rs.slice(0, 2).map(clone),
            expect: 'AC-10 needs at least 3 runs',
        },
        {
            name: 'a failed rail test names its finding',
            rail: (r) => {
                const c = clone(r);
                for (const f of c.testResults) for (const a of f.assertionResults) if ([...a.ancestorTitles, a.title].join(' > ') === fixed?.triage?.rail_test) a.status = 'failed';
                return c;
            },
            expect: `${fixed?.id}: rail_test "${fixed?.triage?.rail_test}" did not pass`,
        },
        {
            name: 'a missing rail test names its finding',
            rail: (r) => {
                const c = clone(r);
                for (const f of c.testResults) f.assertionResults = f.assertionResults.filter((a: any) => [...a.ancestorTitles, a.title].join(' > ') !== fixed?.triage?.rail_test);
                return c;
            },
            expect: `${fixed?.id}: rail_test "${fixed?.triage?.rail_test}" is not in the rail report`,
        },
    ];
    let failed = 0;
    for (const c of cases) {
        const inp: Inputs = {
            ...base,
            reports: (c.reports ? c.reports(reports) : reports).map((d, i) => ({ label: `run ${i + 1}`, data: d })),
            rail: { label: base.rail.label, data: c.rail ? c.rail(rail) : rail },
        };
        const res = analyze(inp);
        const ok = c.expect === '' ? res.problems.length === 0 : res.problems.some((p) => p.includes(c.expect));
        if (!ok) failed++;
        out(`${ok ? 'PASS' : 'FAIL'} ${c.name}${ok ? '' : `\n  wanted: ${c.expect || 'no problem'}\n  got: ${res.problems.slice(0, 5).join('\n       ') || 'no problem'}`}`);
    }
    out(`triage-report self-test: ${cases.length - failed}/${cases.length} PASS`);
    return failed ? 1 : 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readReport(p: string, label: string): { label: string; data: unknown } {
    let text: string;
    try {
        text = fs.readFileSync(p, 'utf8');
    } catch (e) {
        throw new UsageError(`cannot read ${label} ${p}: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
        return { label, data: JSON.parse(text) };
    } catch (e) {
        throw new UsageError(`${label} ${p} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
}

export function main(argv: string[]): number {
    const { flags, positional } = parseArgs(argv, { results: 'multi', 'rail-results': 'string', evidence: 'string', out: 'string', 'self-test': 'bool' });
    if (positional.length) throw new UsageError(`unexpected argument ${positional[0]}`);
    const results = (flags.results as string[] | undefined) ?? [];
    if (!results.length) throw new UsageError('give at least one --results <Vitest JSON report> (three for AC-10)');
    if (typeof flags['rail-results'] !== 'string') throw new UsageError('give --rail-results <Vitest JSON report of the closes-finding rail files>');
    const selfTestMode = flags['self-test'] === true;
    if (!selfTestMode && (typeof flags.evidence !== 'string' || typeof flags.out !== 'string')) throw new UsageError('give --evidence <path> and --out <path> (or --self-test)');
    const problems: string[] = [];
    const register = loadRegister(AUDIT_ROOT, problems);
    const inp: Inputs = {
        reports: results.map((p, i) => readReport(p, `run ${i + 1}`)),
        rail: readReport(flags['rail-results'], 'rail run'),
        register,
        repo: REPO,
        readText: (rel) => {
            try {
                return fs.readFileSync(path.join(REPO, ...rel.split('/')), 'utf8');
            } catch {
                return null;
            }
        },
    };
    if (problems.length) {
        for (const p of problems) console.log(`FAIL ${p}`);
        return 1;
    }
    if (selfTestMode) return selfTest(inp, (l) => console.log(l));
    const a = analyze(inp);
    const report = a.problems.length ? '' : buildReport(a, register, a.problems);
    if (a.problems.length) {
        for (const p of a.problems) console.log(`FAIL ${p}`);
        console.log(`triage-report: ${a.problems.length} problem(s); nothing written`);
        return 1;
    }
    writeAtomic(path.resolve(flags.evidence as string), JSON.stringify(a.evidence, null, 2) + '\n');
    writeAtomic(path.resolve(flags.out as string), report);
    const pop = register.frozen;
    const count = (o: string) => pop.filter((id) => register.findings.get(id)?.triage?.outcome === o).length;
    console.log(
        `triage-report: ${results.length} runs agree: ${a.recs.length} tuples from ${a.files} files, ${a.tests} tests; ` +
            `population ${pop.length} of ${pop.length} accounted for (${count('confirmed')} confirmed, ${count('fixed')} fixed, ${count('unreproduced')} unreproduced, ${count('NOT-A-BUG')} NOT-A-BUG); ` +
            `rail tests passed ${a.evidence.passed_tests.length}; S0/S1 to acknowledge ${acknowledgementSet(register).length}`,
    );
    console.log(`triage-report: wrote ${repoRel(path.resolve(flags.evidence as string), REPO) ?? 'the evidence file'} and ${repoRel(path.resolve(flags.out as string), REPO) ?? 'the report'}`);
    return 0;
}

if (require.main === module) {
    let code: number;
    try {
        code = main(process.argv.slice(2));
    } catch (e) {
        if (e instanceof UsageError) {
            console.error(`triage-report: ${e.message}`);
            code = 2;
        } else throw e;
    }
    process.exit(code);
}
