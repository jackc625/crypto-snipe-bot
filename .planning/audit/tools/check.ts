// .planning/audit/tools/check.ts
//
// Phase 22 / Plan 22-04 (D-15; AC-31, AC-32, AC-34, AC-37..AC-40; NAC-09,
// NAC-10, NAC-12) - mechanical completeness and consistency checker for the
// audit register under .planning/audit/. The written contract it enforces is
// PROTOCOL.md.
//
// Usage (Node 22.16.0, ABI 127; D-21):
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts \
//       --stage partial|triage|consolidation|final [--slice <SLICE>]... [--root <dir>] [--repo <dir>]
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --self-test
//
// Stages:
//   partial        schema and fields of every file in scope, ID format and
//                  uniqueness (always global), NAC-09, NAC-10, NAC-12, the
//                  operator_response/acknowledgement_evidence rule, AC-39
//                  consistency, capability rules. Things an area audit has not
//                  finished yet (missing escalation_ref on an escalation-required
//                  item, unresolved alias, missing ledger row or sweep cell,
//                  unresolved reference) print as PENDING (exit stays 0).
//                  --slice <S> (repeatable, partial only) limits the per-file
//                  checks to that slice's files; ID uniqueness stays global.
//                  The Phase 23 triage rules (checkTriage) run here too: a
//                  triage outcome that is not finished prints PENDING.
//   triage         (Phase 23, D-21) partial's checks with the triage rules
//                  promoted to FAIL: every member of the frozen triage
//                  population (inputs/triage-population.json joined with the
//                  live set) has exactly one outcome and its evidence. It never
//                  runs the consolidation or HEAD-universe checks, so files this
//                  phase adds do not need Phase 22 audit rows to pass it.
//   consolidation  partial with every PENDING promoted to FAIL, plus: RC-01..28
//                  mapped, required cards present, proposed cards numbered,
//                  20 sweep cells per sweep slice and every finding in the cells
//                  of its classes, thresholds per thresholds slice, the universe
//                  at audit_base_sha, ledger == enumerator at audit_base_sha,
//                  referential integrity and duplicate reconciliation.
//   final          consolidation with the universe and ledger equality at HEAD,
//                  a re_audit entry for every ledger row whose file changed
//                  since audited_sha (ending at the file's last-change SHA),
//                  every input: alias resolved, and the census and full-history
//                  secret-scan records present.
// Output: FAIL, then PENDING, then WARN lines, each sorted, then one RESULT
// line; byte-deterministic. Exit 0 pass, 1 check failure, 2 crash/usage.
//
// --self-test builds a temp fixture register and a temp git repo under
// os.tmpdir() (never inside the repo), proves each required failure case
// fails with its specific message, proves the corrected fixture passes every
// stage and that render.ts is byte-deterministic, prints one line per case,
// and exits 0 only if every case behaves as expected.

if (process.versions.modules !== '127') {
    process.stderr.write(
        `check: requires Node 22.16.0 (ABI 127); this is Node ${process.version} ` +
            `(ABI ${process.versions.modules}). Run it with ` +
            `/c/Users/jackc/AppData/Local/nvm/v22.16.0/node.exe (D-21).\n`,
    );
    process.exit(2);
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import * as ts from 'typescript';
import {
    Io,
    consoleIo,
    captureIo,
    UsageError,
    parseArgs,
    locations,
    loadConfig,
    listJson,
    readJson,
    stem,
    cmp,
    resolveSha,
    enumerateSlice,
    checkUniverse,
    listTree,
    lastChangeSha,
    toJson,
    AREAS,
    CLASS_IDS,
    RC_IDS,
    SEVERITIES,
    CAPITAL_IMPACTS,
    STATUSES,
    ORIGINS,
    TIERS,
    SECRET_CLASSES,
    EVIDENCE_TYPES,
    ESCALATION_ONLY_PREFIXES,
    REQUIRED_CARDS,
    DECIDABLE_CARDS,
    AC37_FIELDS,
    NAC09_PATTERN,
    ID_RE,
    RegFile,
    Slice,
    Config,
} from './lib';
import { run as runSliceFiles } from './slice-files';
import { run as runRender, mergedSweep } from './render';

type Level = 'FAIL' | 'PENDING' | 'WARN';
type Stage = 'partial' | 'triage' | 'consolidation' | 'final';
const STAGES: Stage[] = ['partial', 'triage', 'consolidation', 'final'];

class Report {
    private items = new Set<string>();
    private counts: Record<Level, number> = { FAIL: 0, PENDING: 0, WARN: 0 };
    add(level: Level, file: string, field: string, msg: string): void {
        const line = `${level} ${file} ${field}: ${msg}`;
        if (this.items.has(line)) return;
        this.items.add(line);
        this.counts[level]++;
    }
    count(level: Level): number {
        return this.counts[level];
    }
    lines(): string[] {
        const all = [...this.items];
        const out: string[] = [];
        for (const lv of ['FAIL', 'PENDING', 'WARN'] as Level[]) out.push(...all.filter((l) => l.startsWith(lv + ' ')).sort(cmp));
        return out;
    }
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const sevNum = (s: unknown): number => SEVERITIES.indexOf(String(s));

interface Reg {
    root: string;
    repo: string;
    stage: Stage;
    strict: boolean;
    cfg: Config;
    slices: Slice[];
    sliceBy: Map<string, Slice>;
    sel: Set<string> | null;
    findings: RegFile[];
    fById: Map<string, any>;
    escalations: RegFile[];
    eById: Map<string, any>;
    cards: RegFile[];
    cardById: Map<string, any>;
    proposed: RegFile[];
    propById: Map<string, any>;
    notes: RegFile[];
    ledgers: RegFile[];
    sweeps: RegFile[];
    contribs: RegFile[];
    thresholds: RegFile[];
    baseSha: string;
    headSha: string;
    r: Report;
}

function inSel(R: Reg, slice: string | undefined): boolean {
    return !R.sel || (!!slice && R.sel.has(slice));
}

/** Level for things an area audit may legitimately not have finished yet. */
function pend(R: Reg): Level {
    return R.strict ? 'FAIL' : 'PENDING';
}

/** Level for Phase 23 triage work that may legitimately not be finished yet: FAIL only at stage triage. */
function tri(R: Reg): Level {
    return R.stage === 'triage' ? 'FAIL' : 'PENDING';
}

function findingSlice(id: string): string | undefined {
    return ID_RE.finding.exec(id)?.[1];
}

function escPrefix(id: string): string | undefined {
    return ID_RE.escalation.exec(id)?.[1];
}

function requiresEscalation(d: any): string | null {
    if (d.duplicate_of) return null;
    const tags: string[] = Array.isArray(d.tags) ? d.tags : [];
    if (d.severity === 'S0') return 'S0 (immediate tier)';
    if (tags.includes('rail')) return 'rail finding (immediate tier)';
    if (tags.includes('test-origin-db-row')) return 'test-origin DB row (immediate tier)';
    if (tags.includes('secret') && d.secret_class === 'non-public') return 'non-public secret (immediate tier)';
    if (d.severity === 'S1') return 'S1 (area-batch tier)';
    return null;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function loadRegister(root: string, repo: string, stage: Stage, sel: Set<string> | null): Reg {
    const cfg = loadConfig(root);
    const r = new Report();
    const allSweep = listJson(root, 'sweep');
    const R: Reg = {
        root,
        repo,
        stage,
        // Only consolidation and final promote PENDING to FAIL; triage keeps
        // Phase 22's unfinished-audit items at PENDING and fails on its own rules.
        strict: stage === 'consolidation' || stage === 'final',
        cfg,
        slices: cfg.slices,
        sliceBy: new Map(cfg.slices.filter((s) => s && typeof s.slice === 'string').map((s) => [s.slice, s])),
        sel,
        findings: listJson(root, 'findings'),
        fById: new Map(),
        escalations: listJson(root, 'escalations'),
        eById: new Map(),
        cards: listJson(root, 'decisions'),
        cardById: new Map(),
        proposed: listJson(root, 'decisions/proposed'),
        propById: new Map(),
        notes: listJson(root, 'process-notes'),
        ledgers: listJson(root, 'ledger'),
        sweeps: allSweep.filter((f) => !stem(f.rel).startsWith('contrib-')),
        contribs: allSweep.filter((f) => stem(f.rel).startsWith('contrib-')),
        thresholds: listJson(root, 'thresholds'),
        baseSha: cfg.baseSha,
        headSha: '',
        r,
    };
    for (const f of R.findings) if (isObj(f.data) && typeof f.data.id === 'string' && !R.fById.has(f.data.id)) R.fById.set(f.data.id, f.data);
    for (const f of R.escalations) if (isObj(f.data) && typeof f.data.id === 'string' && !R.eById.has(f.data.id)) R.eById.set(f.data.id, f.data);
    for (const f of R.cards) if (isObj(f.data) && typeof f.data.id === 'string') R.cardById.set(f.data.id, f.data);
    for (const f of R.proposed) if (isObj(f.data) && typeof f.data.id === 'string') R.propById.set(f.data.id, f.data);
    return R;
}

// ---------------------------------------------------------------------------
// Per-file checks
// ---------------------------------------------------------------------------

const FINDING_REQUIRED = [
    'id', 'title', 'kind', 'area', 'slice', 'severity', 'capital_impact', 'classes', 'files', 'evidence',
    'sibling_sites_checked', 'status', 'origin', 'rc', 'research_suggested_severity', 'severity_rationale',
    'duplicate_of', 'related', 'tags', 'escalation_ref', 'od_ref', 'recommendation', 'reported_by',
    'found_date', 'audited_sha',
];

function evidenceRefs(d: any): string[] {
    const refs: string[] = [];
    for (const e of Array.isArray(d.evidence) ? d.evidence : []) if (e && typeof e.ref === 'string') refs.push(e.ref);
    for (const s of Array.isArray(d.sub_claims) ? d.sub_claims : []) {
        const ev = s?.evidence;
        if (typeof ev === 'string') refs.push(ev);
        else if (Array.isArray(ev)) for (const x of ev) refs.push(typeof x === 'string' ? x : String(x?.ref ?? ''));
    }
    return refs;
}

function checkNac09(R: Reg, file: string, refs: string[]): void {
    for (const ref of refs)
        if (NAC09_PATTERN.test(ref.replace(/\\/g, '/')))
            R.r.add('FAIL', file, 'evidence', `NAC-09: evidence cites a prior .planning VERIFICATION or SUMMARY doc (${ref}); evidence must come from code or commands`);
}

function checkFinding(R: Reg, f: RegFile): void {
    const d = f.data;
    const file = f.rel;
    const add = (field: string, msg: string) => R.r.add('FAIL', file, field, msg);
    for (const k of FINDING_REQUIRED) if (!(k in d)) add(k, `missing required field ${k}`);
    if ('kind' in d && d.kind !== 'finding') add('kind', 'must be "finding"');
    if ('title' in d && !isStr(d.title)) add('title', 'must be a non-empty string');
    const slice = R.sliceBy.get(String(d.slice));
    if ('area' in d) {
        if (slice && (AREAS as readonly string[]).includes(String(slice.area))) {
            if (d.area !== slice.area) add('area', `must be ${slice.area} (the area of slice ${slice.slice})`);
        } else if (!(AREAS as readonly string[]).includes(d.area)) add('area', `must be one of ${AREAS.join(', ')} (the area the finding affects)`);
    }
    if ('severity' in d && !SEVERITIES.includes(d.severity)) add('severity', `must be one of ${SEVERITIES.join(', ')}`);
    if ('capital_impact' in d && !CAPITAL_IMPACTS.includes(d.capital_impact)) add('capital_impact', `must be one of ${CAPITAL_IMPACTS.join(', ')}`);
    if ('classes' in d) {
        if (!Array.isArray(d.classes) || d.classes.some((k: unknown) => !CLASS_IDS.includes(String(k)))) add('classes', 'must be an array of C01..C20');
        else if (new Set(d.classes).size !== d.classes.length) add('classes', 'must not repeat a class');
    }
    if ('files' in d && (!Array.isArray(d.files) || !d.files.length || d.files.some((x: unknown) => !isStr(x)))) add('files', 'must be a non-empty array of repo paths');
    if ('evidence' in d) {
        if (!Array.isArray(d.evidence) || !d.evidence.length) add('evidence', 'must be a non-empty array of {type, ref, note}');
        else
            d.evidence.forEach((e: any, i: number) => {
                if (!isObj(e) || !EVIDENCE_TYPES.includes(e.type) || !isStr(e.ref) || typeof e.note !== 'string')
                    add(`evidence[${i}]`, 'must be {type: code|command, ref: non-empty, note: string}');
                else if (e.type === 'code' && !ID_RE.codeRef.test(e.ref)) add(`evidence[${i}].ref`, `code ref '${e.ref}' must be path:line[-line]@sha`);
            });
    }
    if ('sibling_sites_checked' in d && !isStr(d.sibling_sites_checked))
        add('sibling_sites_checked', 'must be non-empty text naming the sibling sites searched and the result');
    if ('status' in d) {
        if (d.status === 'deferred') add('status', 'status deferred is forbidden (AC-39)');
        else if (!STATUSES.includes(d.status)) add('status', `must be one of ${STATUSES.join(', ')}`);
    }
    if ('origin' in d && !ORIGINS.includes(d.origin)) add('origin', `must be one of ${ORIGINS.join(', ')}`);
    const rc: string[] = Array.isArray(d.rc) ? d.rc : [];
    if ('rc' in d && (!Array.isArray(d.rc) || d.rc.some((x: unknown) => !RC_IDS.includes(String(x))))) add('rc', 'must be an array of zero-padded RC-01..RC-28');
    if ('research_suggested_severity' in d) {
        const v = d.research_suggested_severity;
        if (rc.length && !SEVERITIES.includes(v)) add('research_suggested_severity', 'a research-candidate entry needs the research suggested severity (S0..S4)');
        if (!rc.length && v !== null && !SEVERITIES.includes(v)) add('research_suggested_severity', 'must be null or S0..S4');
    }
    if ('severity_rationale' in d && typeof d.severity_rationale !== 'string') add('severity_rationale', 'must be a string (may be empty)');
    if ('duplicate_of' in d && d.duplicate_of !== null && (!ID_RE.finding.test(String(d.duplicate_of)) || d.duplicate_of === d.id))
        add('duplicate_of', 'must be null or another finding id');
    if ('related' in d && (!Array.isArray(d.related) || d.related.some((x: unknown) => !(ID_RE.finding.test(String(x)) || ID_RE.rcAlias.test(String(x))))))
        add('related', 'must be an array of finding ids (or rc:RC-NN placeholders until consolidation)');
    if ('tags' in d && (!Array.isArray(d.tags) || d.tags.some((x: unknown) => !isStr(x)))) add('tags', 'must be an array of strings');
    const tags: string[] = Array.isArray(d.tags) ? d.tags : [];
    if (tags.includes('secret') && !SECRET_CLASSES.includes(d.secret_class)) add('secret_class', `a secret finding needs secret_class (${SECRET_CLASSES.join(' | ')})`);
    if (!tags.includes('secret') && 'secret_class' in d) add('secret_class', 'secret_class is only valid on a finding tagged secret');
    if ('escalation_ref' in d && d.escalation_ref !== null && !ID_RE.escalation.test(String(d.escalation_ref))) add('escalation_ref', 'must be null or ESC-<AREA>-NN');
    if ('pre_phase_key' in d && !/^[a-z0-9][a-z0-9-]*$/.test(String(d.pre_phase_key))) add('pre_phase_key', 'must be a lower-case slug');
    if ('od_ref' in d && d.od_ref !== null && !(ID_RE.card.test(String(d.od_ref)) || ID_RE.proposed.test(String(d.od_ref)))) add('od_ref', 'must be null, OD-N or a proposed card id');
    if ('external_od_refs' in d && (!Array.isArray(d.external_od_refs) || d.external_od_refs.some((x: any) => !ID_RE.card.test(String(x?.id)) || !isStr(x?.owner_phase))))
        add('external_od_refs', 'must be [{id: OD-N, owner_phase}] (owner_phase required)');
    if ('traces' in d && (!Array.isArray(d.traces) || d.traces.some((t: any) => !isStr(t?.scenario) || !(isStr(t?.steps) || (Array.isArray(t?.steps) && t.steps.length)) || !isStr(t?.outcome))))
        add('traces', 'must be [{scenario, steps, outcome}]');
    if ('sub_claims' in d && (!Array.isArray(d.sub_claims) || d.sub_claims.some((s: any) => !isStr(s?.claim) || !(isStr(s?.evidence) || Array.isArray(s?.evidence)) || !isStr(s?.status))))
        add('sub_claims', 'must be [{claim, evidence, status}]');
    if ('input_refs' in d && (!Array.isArray(d.input_refs) || d.input_refs.some((x: unknown) => !/^[A-Za-z0-9._-]+#\d+$/.test(String(x))))) add('input_refs', 'must be ["<file>#<n>"]');
    if (tags.includes('test-quality') && ['S0', 'S1', 'S2'].includes(d.severity) && !isStr(d.escaped_regression))
        add('escaped_regression', 'a test-quality finding at S0-S2 must name the concrete regression that could pass while the test stays green');
    if ('affected_cases' in d && !Array.isArray(d.affected_cases)) add('affected_cases', 'must be an array of test case names');
    if ('recommendation' in d && !isStr(d.recommendation)) add('recommendation', 'must be non-empty');
    if ('reported_by' in d && (!Array.isArray(d.reported_by) || !d.reported_by.length || d.reported_by.some((x: unknown) => !isStr(x)))) add('reported_by', 'must be a non-empty array');
    if ('found_date' in d && !ID_RE.date.test(String(d.found_date))) add('found_date', 'must be YYYY-MM-DD');
    if ('audited_sha' in d && !ID_RE.sha.test(String(d.audited_sha))) add('audited_sha', 'must be a full 40-hex commit SHA');
    checkNac09(R, file, evidenceRefs(d));
    // NAC-10 / P10. Phase 23 (D-21) lifts the Phase 22 ban: a research candidate
    // may close as NOT-A-BUG only through a Phase 23 triage record, whose own
    // rules (evidence, and an operator ruling for S0/S1) checkTriage enforces.
    if (rc.length && d.status === 'NOT-A-BUG' && !isObj(d.triage))
        add('status', `NAC-10: research candidate ${rc.join(', ')} may be closed as NOT-A-BUG only with a Phase 23 triage record (triage block with outcome NOT-A-BUG)`);
    if ('triage' in d) checkTriageField(R, file, d);
    if (rc.length && SEVERITIES.includes(d.research_suggested_severity) && SEVERITIES.includes(d.severity) && sevNum(d.severity) > sevNum(d.research_suggested_severity) && !isStr(d.severity_rationale))
        add('severity_rationale', `NAC-10: severity ${d.severity} is below the research suggestion ${d.research_suggested_severity} without a written severity_rationale`);
}

// ---------------------------------------------------------------------------
// Phase 23 triage record (D-21; AC-08, AC-11, AC-13, AC-16, AC-17, AC-18)
// ---------------------------------------------------------------------------

export const TRIAGE_OUTCOMES = ['confirmed', 'NOT-A-BUG', 'fixed', 'unreproduced'];
export const TRIAGE_KEYS = [
    'outcome', 'phase', 'note', 'test_id', 'proof', 'rail_test', 'ruling_ref', 'needs_fork', 'fork_question',
    'fork_ref', 'manual_evidence', 'proven_claims', 'open_claims', 'evidence',
];
/** The one literal a harness self-test may cite; read by no finding rule (ID_RE.finding refuses it). */
export const HARNESS_SELFTEST_ID = 'HARNESS-SELFTEST';
/** The evidence zone: every <finding ID>.test.ts at any depth under this folder. */
export const TRIAGE_DIR = 'test/realpath/triage/';
/** The only file that may declare the marker function. */
export const KNOWN_BUG_DECL_FILE = 'test/realpath/harness/knownBug.ts';
export const POPULATION_REL = 'inputs/triage-population.json';
export const EVIDENCE_REL = 'inputs/triage-evidence.json';
/** Same claim shape the marker itself enforces (test/realpath/harness/knownBug.ts CLAIM_RE). */
export const CLAIM_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Operator review records: reviews/<ID>.json, for example TRIAGE-REVIEW-01. */
export const REVIEW_ID_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d{2,}$/;
export const UFV_ID_RE = /^UFV-\d{2,}$/;
/** Outcome -> the finding statuses it is consistent with (unreproduced keeps its open status). */
const OUTCOME_STATUS: Record<string, string[]> = {
    confirmed: ['confirmed'],
    'NOT-A-BUG': ['NOT-A-BUG'],
    fixed: ['fixed', 'verified'],
    unreproduced: ['candidate', 'confirmed', 'decided'],
};

function isStrArray(v: unknown): v is string[] {
    return Array.isArray(v) && v.every((x) => isStr(x));
}

/** Schema of the optional `triage` block (PROTOCOL.md "Phase 23 triage record"). */
function checkTriageField(R: Reg, file: string, d: any): void {
    const add = (field: string, msg: string) => R.r.add('FAIL', file, field, msg);
    const t = d.triage;
    if (!isObj(t)) {
        add('triage', 'must be an object {outcome, phase, note, ...} (Phase 23 triage record)');
        return;
    }
    for (const k of Object.keys(t)) if (!TRIAGE_KEYS.includes(k)) add(`triage.${k}`, `unknown triage key ${k} (allowed: ${TRIAGE_KEYS.join(', ')})`);
    if (!TRIAGE_OUTCOMES.includes(t.outcome)) add('triage.outcome', `must be one of ${TRIAGE_OUTCOMES.join(', ')}`);
    if (t.phase !== '23') add('triage.phase', 'must be the string "23"');
    if (!isStr(t.note)) add('triage.note', 'must be a non-empty one-line note');
    const allowed = OUTCOME_STATUS[String(t.outcome)];
    if (allowed && !allowed.includes(d.status))
        add('status', `triage outcome ${t.outcome} needs status ${allowed.join(' or ')} (status is ${d.status})${t.outcome === 'unreproduced' ? '; an unreproduced entry stays open' : ''}`);
    if ('test_id' in t && !ID_RE.finding.test(String(t.test_id))) add('triage.test_id', 'must be the finding ID of the triage test file that asserts this entry (test/realpath/triage/**/<ID>.test.ts)');
    for (const k of ['proof', 'rail_test', 'fork_question', 'manual_evidence']) if (k in t && !isStr(t[k])) add(`triage.${k}`, 'must be a non-empty string');
    if ('ruling_ref' in t && !REVIEW_ID_RE.test(String(t.ruling_ref))) add('triage.ruling_ref', 'must name an operator review record (reviews/<ID>.json, for example TRIAGE-REVIEW-01)');
    if ('fork_ref' in t && !UFV_ID_RE.test(String(t.fork_ref))) add('triage.fork_ref', 'must name a UFV entry (UFV-NN) in inputs/unrun-fork-verifications.json');
    if ('needs_fork' in t && typeof t.needs_fork !== 'boolean') add('triage.needs_fork', 'must be true or false');
    for (const k of ['proven_claims', 'open_claims']) {
        if (!(k in t)) continue;
        if (!isStrArray(t[k])) add(`triage.${k}`, 'must be an array of non-empty strings');
        else if (new Set(t[k]).size !== t[k].length) add(`triage.${k}`, 'must not repeat a claim');
    }
    if (isStrArray(t.proven_claims) && t.proven_claims.some((c) => !CLAIM_RE.test(c))) add('triage.proven_claims', 'each proven claim is the kebab-case claim literal of a knownBug call');
    if (isStrArray(t.proven_claims) && isStrArray(t.open_claims) && t.proven_claims.some((c) => t.open_claims.includes(c)))
        add('triage.open_claims', 'a claim cannot be both proven and open');
    if ('evidence' in t) {
        if (!Array.isArray(t.evidence) || !t.evidence.length) add('triage.evidence', 'must be a non-empty array of {type, ref, note}');
        else {
            t.evidence.forEach((e: any, i: number) => {
                if (!isObj(e) || !EVIDENCE_TYPES.includes(e.type) || !isStr(e.ref) || !isStr(e.note))
                    add(`triage.evidence[${i}]`, 'must be {type: code|command, ref: non-empty, note: non-empty}');
                else if (e.type === 'code' && !ID_RE.codeRef.test(e.ref)) add(`triage.evidence[${i}].ref`, `code ref '${e.ref}' must be path:line[-line]@sha`);
            });
            checkNac09(R, file, t.evidence.map((e: any) => String(e?.ref ?? '')));
        }
    }
}

/** One knownBug call found by the AST scan. */
interface KbCall {
    file: string;
    line: number;
    id: string | null;
    claim: string | null;
}

const SCAN_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function scriptKindOf(rel: string): ts.ScriptKind {
    if (/\.tsx$/.test(rel)) return ts.ScriptKind.TSX;
    if (/\.jsx$/.test(rel)) return ts.ScriptKind.JSX;
    if (/\.(?:js|mjs|cjs)$/.test(rel)) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
}

/** Every source file under <repo>/test/, repo-relative with forward slashes, sorted. */
function testSourceFiles(repo: string): string[] {
    const out: string[] = [];
    const walk = (abs: string, rel: string) => {
        for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
            if (ent.name === 'node_modules') continue;
            const a = path.join(abs, ent.name);
            const r = `${rel}/${ent.name}`;
            if (ent.isDirectory()) walk(a, r);
            else if (ent.isFile() && SCAN_EXT.test(ent.name)) out.push(r);
        }
    };
    const top = path.join(repo, 'test');
    if (fs.existsSync(top)) walk(top, 'test');
    return out.sort(cmp);
}

/** True when a module specifier names the marker module (last path segment knownBug, any extension). */
function isKnownBugModule(spec: string): boolean {
    const last = spec.split('/').pop() ?? '';
    return last.replace(/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, '') === 'knownBug';
}

/** The literal claim of a knownBug spec object, or null when it is not a literal the scan can trust. */
function literalClaim(arg: ts.Expression | undefined): string | null {
    if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
    let claim: string | null = null;
    for (const p of arg.properties) {
        const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : undefined;
        if (ts.isSpreadAssignment(p)) {
            // A spread after the claim could replace it at run time.
            claim = null;
            continue;
        }
        if (name !== 'claim') continue;
        claim = ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer) ? p.initializer.text : null;
    }
    return claim;
}

interface KbScan {
    /** Calls in the evidence zone citing anything but the reserved literal: these feed the finding rules. */
    zone: KbCall[];
    /** Location-guard failures: file, line, message. */
    problems: { file: string; line: number; msg: string }[];
}

/**
 * AST scan of every source file under test/ for the name knownBug (no type-checking).
 * Only a direct call in a file test/realpath/triage/**\/<finding ID>.test.ts feeds a finding rule;
 * the location guard refuses every other use except the reserved literal outside the triage folder.
 */
function scanKnownBug(R: Reg): KbScan {
    const zone: KbCall[] = [];
    const problems: { file: string; line: number; msg: string }[] = [];
    for (const rel of testSourceFiles(R.repo)) {
        const text = fs.readFileSync(path.join(R.repo, ...rel.split('/')), 'utf8');
        if (!text.includes('knownBug')) continue;
        const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKindOf(rel));
        const inTriageDir = rel.startsWith(TRIAGE_DIR);
        const base = path.posix.basename(rel);
        const zoneFile = inTriageDir && base.endsWith('.test.ts') && R.fById.has(base.slice(0, -'.test.ts'.length));
        const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const refuse = (n: ts.Node, msg: string) => problems.push({ file: rel, line: lineOf(n), msg });
        const visit = (node: ts.Node): void => {
            // Module-level forms that would reach the marker without its name.
            if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && isKnownBugModule(node.moduleSpecifier.text)) {
                const c = node.importClause;
                if (c?.name) refuse(node, 'default import of the knownBug module; import { knownBug } by name with no alias');
                if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings)) refuse(node, 'namespace import of the knownBug module; import { knownBug } by name with no alias');
            } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && isKnownBugModule(node.moduleSpecifier.text)) {
                refuse(node, 're-export of the knownBug module');
            } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteralLike(node.moduleReference.expression) && isKnownBugModule(node.moduleReference.expression.text)) {
                refuse(node, 'import = require() of the knownBug module');
            } else if (
                ts.isCallExpression(node) &&
                (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
                node.arguments[0] &&
                ts.isStringLiteralLike(node.arguments[0]) &&
                isKnownBugModule(node.arguments[0].text)
            ) {
                refuse(node, 'require() or import() of the knownBug module');
            }
            if (ts.isIdentifier(node) && node.text === 'knownBug') {
                const p = node.parent;
                if (ts.isCallExpression(p) && p.expression === node) {
                    const a1 = p.arguments[1];
                    const id = a1 && ts.isStringLiteralLike(a1) ? a1.text : null;
                    const call: KbCall = { file: rel, line: lineOf(p), id, claim: literalClaim(p.arguments[2]) };
                    if (id === null) refuse(p, `knownBug's second argument must be a string literal (a finding ID, or ${HARNESS_SELFTEST_ID} outside ${TRIAGE_DIR}); a computed ID cannot be located by finding ID`);
                    else if (id === HARNESS_SELFTEST_ID) {
                        if (inTriageDir) refuse(p, `knownBug(${id}): the reserved self-test literal may not be used inside ${TRIAGE_DIR}`);
                    } else if (!zoneFile)
                        refuse(p, `knownBug(${id}) is outside the evidence zone ${TRIAGE_DIR}**/<finding ID>.test.ts, so it proves nothing; only ${HARNESS_SELFTEST_ID} may be cited elsewhere`);
                    else zone.push(call);
                } else if (ts.isImportSpecifier(p) && p.name === node && !p.propertyName) {
                    // import { knownBug } from '.../knownBug': allowed.
                } else if (ts.isFunctionDeclaration(p) && p.name === node && rel === KNOWN_BUG_DECL_FILE) {
                    // The marker's own declaration: allowed.
                } else
                    refuse(node, `use of the name knownBug other than a direct call, an unaliased named import or its declaration in ${KNOWN_BUG_DECL_FILE} (an alias, re-export or value use hides calls from the D-21 scan)`);
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return { zone, problems };
}

interface Population {
    /** Frozen IDs joined with the live computation. */
    ids: string[];
    frozen: Set<string>;
    /** Severity at freeze, for the S0/S1 rules (a later downgrade never removes the ruling requirement). */
    frozenSev: Map<string, string>;
}

function triagePopulation(R: Reg): Population {
    const rel = POPULATION_REL;
    const f = readJson(path.join(R.root, ...rel.split('/')), rel);
    const frozen = new Set<string>();
    const frozenSev = new Map<string, string>();
    if (f.error) R.r.add(tri(R), rel, '(file)', `the frozen triage population is missing or unreadable (${f.error}); it is written once from the register (D-21)`);
    else if (!isObj(f.data)) R.r.add('FAIL', rel, '(file)', 'must be {frozen_at_sha, count, ids, severity_at_freeze}');
    else {
        const d = f.data;
        if (!ID_RE.sha.test(String(d.frozen_at_sha))) R.r.add('FAIL', rel, 'frozen_at_sha', 'must be a full 40-hex commit SHA');
        if (!isStrArray(d.ids) || d.ids.some((x) => !ID_RE.finding.test(x))) R.r.add('FAIL', rel, 'ids', 'must be an array of finding IDs');
        else {
            const sorted = [...d.ids].sort(cmp);
            if (sorted.join('\n') !== d.ids.join('\n') || new Set(sorted).size !== sorted.length) R.r.add('FAIL', rel, 'ids', 'must be sorted and unique');
            if (d.count !== d.ids.length) R.r.add('FAIL', rel, 'count', `must equal the number of ids (${d.ids.length})`);
            for (const id of d.ids) frozen.add(id);
        }
        if ('severity_at_freeze' in d) {
            const s = d.severity_at_freeze;
            if (!isObj(s) || Object.keys(s).sort(cmp).join('\n') !== [...frozen].sort(cmp).join('\n') || Object.values(s).some((v) => !SEVERITIES.includes(String(v))))
                R.r.add('FAIL', rel, 'severity_at_freeze', 'must map every frozen ID, and only those, to S0..S4');
            else for (const [k, v] of Object.entries(s)) frozenSev.set(k, String(v));
        }
    }
    for (const id of [...frozen].sort(cmp)) if (!R.fById.has(id)) R.r.add('FAIL', rel, 'ids', `frozen triage population ID ${id} names no finding (a frozen ID is never dropped)`);
    const live = [...R.fById.values()].filter((F) => !F.duplicate_of && ((Array.isArray(F.rc) && F.rc.length) || F.severity === 'S0' || F.severity === 'S1')).map((F) => String(F.id));
    const ids = [...new Set([...frozen, ...live])].sort(cmp);
    return { ids, frozen, frozenSev };
}

/** The D-21 rules over the register, the test tree and (stage triage) the run evidence. */
function checkTriage(R: Reg): void {
    const pop = triagePopulation(R);
    const scan = scanKnownBug(R);
    for (const p of scan.problems) R.r.add('FAIL', p.file, `knownBug(line ${p.line})`, p.msg);
    const callsFor = new Map<string, KbCall[]>();
    for (const c of scan.zone) (callsFor.get(String(c.id)) ?? callsFor.set(String(c.id), []).get(String(c.id))!).push(c);

    // Every population member has a triage record (FAIL at stage triage, PENDING otherwise).
    for (const id of pop.ids) {
        const F = R.fById.get(id);
        if (!F || !inSel(R, findingSlice(id))) continue;
        if (!isObj(F.triage)) R.r.add(tri(R), fileOfFinding(R, id), 'triage', `${id} is in the Phase 23 triage population and has no triage record (outcome ${TRIAGE_OUTCOMES.join(' | ')})`);
    }

    // Per-outcome rules, for every finding that carries a triage record.
    for (const F of R.fById.values()) {
        const t = F.triage;
        if (!isObj(t) || !inSel(R, findingSlice(String(F.id)))) continue;
        const id = String(F.id);
        const file = fileOfFinding(R, id);
        const mine = callsFor.get(id) ?? [];
        if (t.outcome === 'confirmed' && !mine.length)
            R.r.add('FAIL', file, 'triage', `${id}: outcome confirmed needs a knownBug call carrying ${id} in the evidence zone ${TRIAGE_DIR}**/<finding ID>.test.ts (D-21)`);
    }
}

const ESC_REQUIRED = ['id', 'date', 'tier', 'items', 'resolved_items', 'summary', 'presented_at', 'operator_response', 'ruling', 'phase_continued'];

function isItem(x: string): boolean {
    return ID_RE.finding.test(x) || ID_RE.rcAlias.test(x) || ID_RE.keyAlias.test(x) || ID_RE.inputAlias.test(x);
}

function checkEscalation(R: Reg, f: RegFile): void {
    const d = f.data;
    const add = (field: string, msg: string) => R.r.add('FAIL', f.rel, field, msg);
    for (const k of ESC_REQUIRED) if (!(k in d)) add(k, `missing required field ${k}`);
    if ('date' in d && !ID_RE.date.test(String(d.date))) add('date', 'must be YYYY-MM-DD (the session the item was found)');
    if ('tier' in d && !TIERS.includes(d.tier)) add('tier', `must be one of ${TIERS.join(', ')}`);
    if ('items' in d) {
        if (!Array.isArray(d.items) || !d.items.length) add('items', 'must be a non-empty array');
        else {
            if (d.items.some((x: unknown) => typeof x !== 'string' || !isItem(x))) add('items', 'each item is a finding id or an alias rc:RC-NN, key:<SLICE>:<slug>, input:<file>#<n>');
            if (new Set(d.items).size !== d.items.length) add('items', 'must not repeat an item');
        }
    }
    if ('resolved_items' in d) {
        if (!Array.isArray(d.resolved_items) || d.resolved_items.some((x: unknown) => !ID_RE.finding.test(String(x)))) add('resolved_items', 'must be an array of finding ids');
        else if (new Set(d.resolved_items).size !== d.resolved_items.length) add('resolved_items', 'must not repeat an id');
    }
    if ('summary' in d && !isStr(d.summary)) add('summary', 'must be non-empty');
    if ('presented_at' in d && !isStr(d.presented_at)) add('presented_at', 'must say when and where the item was presented to the operator');
    if ('operator_response' in d) {
        if (d.operator_response === null) {
            if (!isStr(d.acknowledgement_evidence))
                add('acknowledgement_evidence', 'operator_response is null, so acknowledgement_evidence must name where the operator was told and acknowledged (never invent operator words)');
        } else if (!isStr(d.operator_response)) add('operator_response', "must be the operator's own words, or null with acknowledgement_evidence");
    }
    if ('ruling' in d && !isStr(d.ruling)) add('ruling', 'must be non-empty ("none" when the operator made no ruling)');
    if ('phase_continued' in d) {
        if (typeof d.phase_continued !== 'boolean') add('phase_continued', 'must be true or false');
        else if (d.phase_continued === false && (!isStr(d.ruling) || d.ruling === 'none')) add('ruling', 'phase_continued false needs the operator ruling that stopped the phase (AC-40)');
    }
    if ('tags' in d && (!Array.isArray(d.tags) || d.tags.some((x: unknown) => !isStr(x)))) add('tags', 'must be an array of strings');
    if (d.status === 'deferred' || d.resolution?.status === 'deferred') add('status', 'status deferred is forbidden (AC-39)');
    if ('rediscovery_of' in d && !ID_RE.escalation.test(String(d.rediscovery_of))) add('rediscovery_of', 'must be an escalation id');
    if ('resolution' in d && (!isObj(d.resolution) || !isStr(d.resolution.status))) add('resolution', 'must be an object with a status');
}

const CARD_REQUIRED = ['id', 'title', 'area', 'capital', 'status', 'options', 'keep_current_option_id', 'recommendation', 'default', 'behavior_impact', 'findings', 'decided', 'needed_by'];

function checkCard(R: Reg, f: RegFile, proposed: boolean): void {
    const d = f.data;
    const add = (field: string, msg: string) => R.r.add('FAIL', f.rel, field, msg);
    for (const k of CARD_REQUIRED) if (!(k in d)) add(k, `missing required field ${k}`);
    for (const k of ['title', 'recommendation', 'default', 'behavior_impact', 'needed_by']) if (k in d && !isStr(d[k])) add(k, 'must be non-empty');
    if ('area' in d && !(isStr(d.area) && (R.sliceBy.has(d.area) || (AREAS as readonly string[]).includes(d.area) || d.area === 'root')))
        add('area', 'must be a slice name, one of the five areas, or root');
    if ('capital' in d && typeof d.capital !== 'boolean') add('capital', 'must be true or false');
    if ('status' in d && !['open', 'decided'].includes(d.status)) add('status', 'must be open or decided');
    const opts = Array.isArray(d.options) ? d.options : [];
    if ('options' in d) {
        if (!Array.isArray(d.options) || opts.length < 2) add('options', 'NAC-12: a card must list at least 2 options');
        opts.forEach((o: any, i: number) => {
            if (!isStr(o?.id) || !isStr(o?.name) || !isStr(o?.behavior_impact) || typeof o?.risk !== 'string') add(`options[${i}]`, 'must be {id, name, behavior_impact, risk}');
        });
        if (new Set(opts.map((o: any) => o?.id)).size !== opts.length) add('options', 'option ids must be unique');
    }
    if ('keep_current_option_id' in d) {
        const keep = opts.find((o: any) => o?.id === d.keep_current_option_id);
        if (!keep) add('keep_current_option_id', 'NAC-12: the card has no keep-current-behavior option');
        else if (!isStr(keep.risk)) add('keep_current_option_id', 'NAC-12: the keep-current option must state its risk');
    }
    if ('findings' in d && (!Array.isArray(d.findings) || d.findings.some((x: unknown) => !ID_RE.finding.test(String(x))))) add('findings', 'must be an array of finding ids');
    if (d.status === 'decided') {
        if (proposed || !DECIDABLE_CARDS.includes(String(d.id))) add('status', `NAC-12: only ${DECIDABLE_CARDS.join(', ')} may be decided in Phase 22`);
        if (!isObj(d.decided) || !ID_RE.date.test(String(d.decided.date)) || !isStr(d.decided.ruling)) add('decided', 'a decided card needs decided {date, ruling}');
    } else if ('decided' in d && d.decided !== null) add('decided', 'an open card has decided null');
    if (proposed) {
        if ('assigned_id' in d && !ID_RE.card.test(String(d.assigned_id))) add('assigned_id', 'must be OD-N');
        if ('linked_od' in d && !/^OD-([1-9]|1\d|2[0-5])$/.test(String(d.linked_od))) add('linked_od', 'must name an existing research card OD-1..OD-25');
        if ('merged_into' in d && !(ID_RE.card.test(String(d.merged_into)) || ID_RE.proposed.test(String(d.merged_into)))) add('merged_into', 'must be a card id');
    }
}

function checkNote(R: Reg, f: RegFile): void {
    const d = f.data;
    const add = (field: string, msg: string) => R.r.add('FAIL', f.rel, field, msg);
    if (!ID_RE.note.test(String(d.id)) || d.id !== stem(f.rel)) add('id', 'must be PN-NNN and match the file name');
    if (!ID_RE.date.test(String(d.date))) add('date', 'must be YYYY-MM-DD');
    if (!isStr(d.description)) add('description', 'must be non-empty');
    const ev = d.evidence;
    if (!(isStr(ev) || (Array.isArray(ev) && ev.length))) add('evidence', 'must be non-empty');
    const refs = typeof ev === 'string' ? [ev] : Array.isArray(ev) ? ev.map((e: any) => (typeof e === 'string' ? e : String(e?.ref ?? ''))) : [];
    checkNac09(R, f.rel, refs);
}

const QL_KEYS = ['claims', 'mocks_mechanism', 'mocked_dependencies', 'mocked_mechanism_detail', 'hollow_assertions', 'can_reach_real_state', 'notes'];

function checkLedger(R: Reg, f: RegFile, s: Slice): void {
    const file = f.rel;
    const add = (lv: Level, field: string, msg: string) => R.r.add(lv, file, field, msg);
    if (!Array.isArray(f.data)) {
        add('FAIL', '(file)', 'a ledger file is a JSON array of rows');
        return;
    }
    const base = new Set(enumerateSlice(R.baseSha, s, { repo: R.repo }));
    const head = new Set(enumerateSlice(R.headSha, s, { repo: R.repo }));
    const seen = new Set<string>();
    f.data.forEach((row: any, i: number) => {
        const at = `[${i}]${isObj(row) && typeof row.path === 'string' ? ' ' + row.path : ''}`;
        if (!isObj(row) || !isStr(row.path)) {
            add('FAIL', at, 'row needs a path');
            return;
        }
        if (seen.has(row.path)) add('FAIL', at, 'duplicate ledger row');
        seen.add(row.path);
        if (!ID_RE.sha.test(String(row.audited_sha))) add('FAIL', `${at}.audited_sha`, 'must be a full 40-hex SHA');
        const fs_ = row.findings;
        if (!(fs_ === 'none' || (Array.isArray(fs_) && fs_.length && fs_.every((x: unknown) => ID_RE.finding.test(String(x))))))
            add('FAIL', `${at}.findings`, 'must be "none" or a non-empty array of finding ids (never omitted)');
        else if (Array.isArray(fs_)) for (const id of fs_) if (!R.fById.has(id)) add(pend(R), `${at}.findings`, `${id} names no finding`);
        if ('quality_label' in row) {
            const q = row.quality_label;
            if (!isObj(q) || QL_KEYS.some((k) => !(k in q))) add('FAIL', `${at}.quality_label`, `needs ${QL_KEYS.join(', ')}`);
            else {
                if (!['yes', 'no', 'partial'].includes(q.mocks_mechanism)) add('FAIL', `${at}.quality_label.mocks_mechanism`, 'must be yes, no or partial');
                if (!['yes', 'no'].includes(q.hollow_assertions)) add('FAIL', `${at}.quality_label.hollow_assertions`, 'must be yes or no');
                if (!['yes', 'no'].includes(q.can_reach_real_state)) add('FAIL', `${at}.quality_label.can_reach_real_state`, 'must be yes or no');
                if (!Array.isArray(q.mocked_dependencies)) add('FAIL', `${at}.quality_label.mocked_dependencies`, 'must be an array');
                if (q.mocks_mechanism === 'partial' && !(Array.isArray(q.cases) && q.cases.length))
                    add('FAIL', `${at}.quality_label.cases`, 'a file that mixes real-path and mechanism-mocking cases needs per-case labels');
            }
        } else if (R.strict && s.area === 'test' && /\.test\.tsx?$/.test(row.path)) add('FAIL', `${at}.quality_label`, 'every test file row needs a quality_label (D-20)');
        if ('fixture_provenance' in row && !['synthetic', 'public-historical', 'operator-state'].includes(row.fixture_provenance))
            add('FAIL', `${at}.fixture_provenance`, 'must be synthetic, public-historical or operator-state');
        if ('re_audit' in row) {
            if (!Array.isArray(row.re_audit) || row.re_audit.some((x: any) => !ID_RE.sha.test(String(x?.from_sha)) || !ID_RE.sha.test(String(x?.to_sha)) || !isStr(x?.note) || !(x?.findings === 'none' || Array.isArray(x?.findings))))
                add('FAIL', `${at}.re_audit`, 'must be [{from_sha, to_sha, findings, note}]');
        }
        // Membership: a base file is audited at the base SHA; a post-base file is
        // allowed only when the enumerator lists it at HEAD and its audit reaches
        // the file's last-change SHA (directly or through re_audit).
        if (base.has(row.path)) {
            if (row.audited_sha !== R.baseSha) add('FAIL', `${at}.audited_sha`, `a file present at audit_base_sha is audited at ${R.baseSha} (record later changes in re_audit)`);
        } else if (head.has(row.path)) {
            const last = lastChangeSha(R.repo, R.headSha, row.path);
            const reached = row.audited_sha === last || (Array.isArray(row.re_audit) && row.re_audit.length && row.re_audit[row.re_audit.length - 1]?.to_sha === last);
            if (!reached) add('FAIL', `${at}.audited_sha`, `file added after audit_base_sha must be audited at its last-change SHA ${last}`);
        } else add('FAIL', at, `path is not in slice ${s.slice}'s enumerator at audit_base_sha or HEAD (extra ledger row)`);
    });
    // Coverage: every enumerated file has a row ("none" when it has no finding).
    const want = R.stage === 'final' ? head : base;
    const sha = R.stage === 'final' ? R.headSha : R.baseSha;
    for (const p of [...want].sort(cmp)) if (!seen.has(p)) add(pend(R), '(rows)', `missing ledger row for ${p} (enumerated at ${sha})`);
    if (R.stage === 'final') {
        const headTree = listTree(R.repo, R.headSha);
        for (const row of f.data as any[]) {
            if (!isObj(row) || !isStr(row.path) || !ID_RE.sha.test(String(row.audited_sha))) continue;
            const auditedOid = listTree(R.repo, row.audited_sha).get(row.path)?.oid;
            const headOid = headTree.get(row.path)?.oid;
            if (auditedOid === headOid) continue;
            const last = lastChangeSha(R.repo, R.headSha, row.path);
            const ra = Array.isArray(row.re_audit) ? row.re_audit : [];
            if (!ra.length || ra[ra.length - 1]?.to_sha !== last)
                add('FAIL', `${row.path}.re_audit`, `file changed after audited_sha ${String(row.audited_sha).slice(0, 7)}; a re_audit entry must end at its last-change SHA ${last} (AC-32)`);
        }
    }
}

function checkSweep(R: Reg, f: RegFile, s: Slice): void {
    const d = f.data;
    const add = (lv: Level, field: string, msg: string) => R.r.add(lv, f.rel, field, msg);
    if (!isObj(d)) {
        add('FAIL', '(file)', 'a sweep file is {slice, area, audited_sha, cells}');
        return;
    }
    if (d.slice !== s.slice) add('FAIL', 'slice', `must be ${s.slice}`);
    if (d.area !== s.area) add('FAIL', 'area', `must be ${s.area}`);
    if (!ID_RE.sha.test(String(d.audited_sha))) add('FAIL', 'audited_sha', 'must be a full 40-hex SHA');
    if (!isObj(d.cells)) {
        add('FAIL', 'cells', 'must be an object keyed C01..C20');
        return;
    }
    for (const k of Object.keys(d.cells)) if (!CLASS_IDS.includes(k)) add('FAIL', `cells.${k}`, 'unknown class (C01..C20)');
    for (const k of CLASS_IDS) {
        const cell = d.cells[k];
        if (cell === undefined) {
            add(pend(R), `cells.${k}`, `missing sweep cell ${k}`);
            continue;
        }
        if (!isObj(cell)) {
            add('FAIL', `cells.${k}`, 'must be {result, search}');
            continue;
        }
        if (!(cell.result === 'checked, none' || (Array.isArray(cell.result) && cell.result.length && cell.result.every((x: unknown) => ID_RE.finding.test(String(x))))))
            add('FAIL', `cells.${k}.result`, 'must be a non-empty list of finding ids or "checked, none"');
        else if (Array.isArray(cell.result)) for (const id of cell.result) if (!R.fById.has(id)) add(pend(R), `cells.${k}.result`, `${id} names no finding`);
        if (!isStr(cell.search)) add('FAIL', `cells.${k}.search`, 'must name the search performed (patterns/files)');
    }
}

function checkContrib(R: Reg, f: RegFile): void {
    const d = f.data;
    const add = (lv: Level, field: string, msg: string) => R.r.add(lv, f.rel, field, msg);
    const name = stem(f.rel).slice('contrib-'.length);
    if (!isObj(d) || d.name !== name || !Array.isArray(d.contributions)) {
        add('FAIL', '(file)', `a contribution file is {name: "${name}", contributions: [{class, area, ids, search}]}`);
        return;
    }
    d.contributions.forEach((c: any, i: number) => {
        if (!CLASS_IDS.includes(String(c?.class)) || !(AREAS as readonly string[]).includes(c?.area) || !Array.isArray(c?.ids) || !isStr(c?.search))
            add('FAIL', `contributions[${i}]`, 'must be {class: C01..C20, area: one of the five areas, ids: [...], search}');
        else for (const id of c.ids) if (!R.fById.has(String(id))) add(pend(R), `contributions[${i}].ids`, `${id} names no finding`);
    });
}

function checkThresholds(R: Reg, f: RegFile, s: Slice): void {
    const add = (lv: Level, field: string, msg: string) => R.r.add(lv, f.rel, field, msg);
    const d = f.data;
    const rows = Array.isArray(d) ? d : isObj(d) && Array.isArray(d.rows) ? d.rows : null;
    if (!rows) {
        add('FAIL', '(file)', 'a thresholds file is an array of rows or {rows, discovery}');
        return;
    }
    if (!rows.length) add('FAIL', '(file)', 'the inventory is empty');
    const ids = new Set<string>();
    rows.forEach((row: any, i: number) => {
        const at = `[${i}]${isObj(row) && typeof row.id === 'string' ? ' ' + row.id : ''}`;
        if (!isObj(row)) {
            add('FAIL', at, 'row must be an object');
            return;
        }
        for (const k of AC37_FIELDS) if (!(k in row)) add('FAIL', `${at}.${k}`, `missing AC-37 field ${k}`);
        if (!new RegExp(`^TH-${s.slice}-\\d{2,}$`).test(String(row.id))) add('FAIL', `${at}.id`, `must be TH-${s.slice}-NN`);
        else if (ids.has(row.id)) add('FAIL', `${at}.id`, 'duplicate threshold id');
        ids.add(String(row.id));
        if ('definition_sites' in row && (!Array.isArray(row.definition_sites) || !row.definition_sites.length)) add('FAIL', `${at}.definition_sites`, 'must list every definition site (file:line)');
        if ('flags' in row && !Array.isArray(row.flags)) add('FAIL', `${at}.flags`, 'must be an array');
        if (Array.isArray(row.flags) && row.flags.length && !isStr(row.recommendation)) add('FAIL', `${at}.recommendation`, 'every flagged row needs a recommendation');
        if (row.od_ref !== null && row.od_ref !== undefined) {
            if (!(ID_RE.card.test(String(row.od_ref)) || ID_RE.proposed.test(String(row.od_ref)))) add('FAIL', `${at}.od_ref`, 'must be null or a card id');
            else checkOdRef(R, f.rel, `${at}.od_ref`, String(row.od_ref));
        }
    });
    if (isObj(d) && 'discovery' in d) {
        const disc = d.discovery;
        if (!isObj(disc)) add('FAIL', 'discovery', 'must be {env_reads, constants}');
        else
            for (const k of ['env_reads', 'constants']) {
                const list = disc[k];
                if (list === undefined) continue;
                if (!Array.isArray(list)) add('FAIL', `discovery.${k}`, 'must be an array');
                else
                    list.forEach((e: any, i: number) => {
                        if (!isObj(e)) add('FAIL', `discovery.${k}[${i}]`, 'must be an object');
                        else if (!(isStr(e.row_id) ? ids.has(e.row_id) : isStr(e.excluded_reason)))
                            add('FAIL', `discovery.${k}[${i}]`, 'needs row_id naming a row in this file, or an excluded_reason');
                    });
            }
    }
}

function checkOdRef(R: Reg, file: string, field: string, id: string): void {
    if (R.strict) {
        if (R.cardById.has(id)) return;
        if (R.propById.has(id)) R.r.add('FAIL', file, field, `${id} is a proposed card; use the id assigned by assign-cards.ts`);
        else R.r.add('FAIL', file, field, `od_ref ${id} names no decision card`);
    } else if (!R.cardById.has(id) && !R.propById.has(id)) R.r.add('PENDING', file, field, `od_ref ${id} names no decision card yet`);
}

// ---------------------------------------------------------------------------
// Cross-file checks
// ---------------------------------------------------------------------------

function fileOfFinding(R: Reg, id: string): string {
    return `findings/${id}.json`;
}

function fileOfEsc(id: string): string {
    return `escalations/${id}.json`;
}

const inputCache = new Map<string, RegFile>();
function inputFile(R: Reg, name: string): RegFile {
    const key = `${R.root}\u0000${name}`;
    let f = inputCache.get(key);
    if (!f) {
        f = readJson(path.join(R.root, 'inputs', name), `inputs/${name}`);
        inputCache.set(key, f);
    }
    return f;
}

function checkEscalationLinks(R: Reg): void {
    // Listings: finding id -> records listing it.
    const listings = new Map<string, { rec: any; where: 'items' | 'resolved' }[]>();
    for (const e of R.eById.values()) {
        for (const it of Array.isArray(e.items) ? e.items : [])
            if (ID_RE.finding.test(String(it))) (listings.get(it) ?? listings.set(it, []).get(it)!).push({ rec: e, where: 'items' });
        for (const it of Array.isArray(e.resolved_items) ? e.resolved_items : [])
            if (ID_RE.finding.test(String(it))) (listings.get(it) ?? listings.set(it, []).get(it)!).push({ rec: e, where: 'resolved' });
    }
    const relevant = (fid: string, rec: any) => inSel(R, findingSlice(fid)) || inSel(R, escPrefix(String(rec.id)));
    // Every listing must be the finding's own record or a rediscovery link.
    for (const [fid, ls] of listings) {
        const F = R.fById.get(fid);
        for (const l of ls) {
            if (!relevant(fid, l.rec)) continue;
            const file = fileOfEsc(l.rec.id);
            const field = l.where === 'items' ? 'items' : 'resolved_items';
            if (!F) {
                R.r.add(pend(R), file, field, `${fid} names no finding`);
                continue;
            }
            if (F.escalation_ref === l.rec.id) continue;
            const recItems: string[] = Array.isArray(l.rec.items) ? l.rec.items : [];
            const recResolved: string[] = Array.isArray(l.rec.resolved_items) ? l.rec.resolved_items : [];
            const canon = F.duplicate_of ? R.fById.get(F.duplicate_of) : undefined;
            const rediscoveryItem = l.where === 'items' && F.duplicate_of && recResolved.includes(F.duplicate_of) && canon && F.escalation_ref === canon.escalation_ref;
            const rediscoveryResolved = l.where === 'resolved' && recItems.some((g) => R.fById.get(g)?.duplicate_of === fid);
            if (!rediscoveryItem && !rediscoveryResolved)
                R.r.add('FAIL', file, field, `${fid} is listed here but its escalation_ref is ${F.escalation_ref ?? 'null'}; an item has exactly one record, and a second record may only list it as a rediscovery link (AC-39)`);
        }
    }
    // Every finding that carries an escalation_ref is listed by that record.
    for (const f of R.findings) {
        const F = f.data;
        if (!isObj(F) || !F.escalation_ref || !inSel(R, findingSlice(String(F.id)))) continue;
        const E = R.eById.get(F.escalation_ref);
        if (!E) {
            R.r.add('FAIL', f.rel, 'escalation_ref', `${F.escalation_ref} names no escalation record`);
            continue;
        }
        const listed = (Array.isArray(E.items) && E.items.includes(F.id)) || (Array.isArray(E.resolved_items) && E.resolved_items.includes(F.id));
        if (!listed) R.r.add('FAIL', f.rel, 'escalation_ref', `${F.escalation_ref} does not list ${F.id} in items or resolved_items (AC-39)`);
    }
    // Escalation-required items.
    for (const f of R.findings) {
        const F = f.data;
        if (!isObj(F) || !inSel(R, findingSlice(String(F.id)))) continue;
        const why = requiresEscalation(F);
        if (why && !F.escalation_ref) R.r.add(pend(R), f.rel, 'escalation_ref', `escalation required (${why}) but escalation_ref is null`);
    }
    // Alias resolution.
    for (const ef of R.escalations) {
        const E = ef.data;
        if (!isObj(E) || !inSel(R, escPrefix(String(E.id)))) continue;
        const resolvers: any[] = (Array.isArray(E.resolved_items) ? E.resolved_items : []).map((x: string) => R.fById.get(x)).filter((F: any) => F && F.escalation_ref === E.id);
        for (const it of Array.isArray(E.items) ? E.items : []) {
            const s = String(it);
            let m: RegExpExecArray | null;
            if ((m = ID_RE.rcAlias.exec(s))) {
                const rc = m[1];
                if (!RC_IDS.includes(rc)) R.r.add('FAIL', ef.rel, 'items', `${s}: ${rc} is not RC-01..RC-28`);
                else if (!resolvers.some((F) => Array.isArray(F.rc) && F.rc.includes(rc)))
                    R.r.add(pend(R), ef.rel, 'items', `alias ${s} is not yet resolved: no finding in resolved_items carries ${rc} and points back with escalation_ref ${E.id}`);
            } else if ((m = ID_RE.keyAlias.exec(s))) {
                const [, slice, slug] = m;
                if (!R.sliceBy.has(slice)) R.r.add('FAIL', ef.rel, 'items', `${s}: unknown slice ${slice}`);
                else if (!resolvers.some((F) => F.slice === slice && F.pre_phase_key === slug))
                    R.r.add(pend(R), ef.rel, 'items', `alias ${s} is not yet resolved: no ${slice} finding with pre_phase_key ${slug} in resolved_items points back with escalation_ref ${E.id}`);
            } else if ((m = ID_RE.inputAlias.exec(s))) {
                const [, name, nStr] = m;
                const inp = inputFile(R, name);
                if (inp.error) {
                    R.r.add('FAIL', ef.rel, 'items', `${s}: inputs/${name} is missing or unreadable`);
                    continue;
                }
                if (Array.isArray(inp.data?.hits) && Number(nStr) >= inp.data.hits.length) {
                    R.r.add('FAIL', ef.rel, 'items', `${s}: index ${nStr} is past the ${inp.data.hits.length} hits in inputs/${name}`);
                    continue;
                }
                const closed = isObj(E.resolution) && E.resolution.status === 'closed' && isStr(E.resolution.outcome);
                if (!closed && !resolvers.some((F) => Array.isArray(F.input_refs) && F.input_refs.includes(`${name}#${nStr}`)))
                    R.r.add(R.stage === 'final' ? 'FAIL' : 'PENDING', ef.rel, 'items', `alias ${s} is not yet resolved (no closed resolution and no finding with input_refs ${name}#${nStr})`);
            }
        }
    }
}

function checkReferences(R: Reg): void {
    for (const f of R.findings) {
        const F = f.data;
        if (!isObj(F) || !inSel(R, findingSlice(String(F.id)))) continue;
        if (F.duplicate_of && ID_RE.finding.test(String(F.duplicate_of)) && !R.fById.has(F.duplicate_of)) R.r.add(pend(R), f.rel, 'duplicate_of', `${F.duplicate_of} names no finding`);
        for (const x of Array.isArray(F.related) ? F.related : []) {
            if (ID_RE.rcAlias.test(String(x))) {
                if (R.strict) R.r.add('FAIL', f.rel, 'related', `placeholder ${x} must be resolved to finding ids at consolidation`);
            } else if (!R.fById.has(x)) R.r.add(pend(R), f.rel, 'related', `${x} names no finding`);
        }
        if (isStr(F.od_ref)) checkOdRef(R, f.rel, 'od_ref', F.od_ref);
    }
    for (const cf of [...R.cards, ...R.proposed]) {
        const d = cf.data;
        if (!isObj(d) || !cardInSel(R, cf, d)) continue;
        for (const id of Array.isArray(d.findings) ? d.findings : []) if (!R.fById.has(id)) R.r.add(pend(R), cf.rel, 'findings', `${id} names no finding`);
    }
}

function cardInSel(R: Reg, f: RegFile, d: any): boolean {
    if (!R.sel) return true;
    if (f.rel.startsWith('decisions/proposed/')) return inSel(R, ID_RE.proposed.exec(String(d?.id ?? stem(f.rel)))?.[1]);
    const id = String(d?.id ?? stem(f.rel));
    return R.slices.some((s) => R.sel!.has(s.slice) && Array.isArray(s.owned_od_cards) && s.owned_od_cards.includes(id));
}

function checkUniverseAt(R: Reg, sha: string, label: string): void {
    const u = checkUniverse(sha, { repo: R.repo, slices: R.slices, scope: R.cfg.scope });
    for (const p of u.unassigned) R.r.add('FAIL', 'scope.json', 'universe', `${p} (tracked at ${label}) belongs to no slice and no out-of-scope prefix`);
    for (const m of u.multiply_assigned) R.r.add('FAIL', 'scope.json', 'universe', `${m.path} (tracked at ${label}) is multiply assigned: ${m.owners.join(', ')}`);
}

function checkConsolidation(R: Reg): void {
    // RC map
    for (const rc of RC_IDS) if (![...R.fById.values()].some((F) => Array.isArray(F.rc) && F.rc.includes(rc))) R.r.add('FAIL', 'findings', 'rc', `${rc} maps to no entry (AC-31)`);
    // Required cards
    for (const id of REQUIRED_CARDS) if (!R.cardById.has(id)) R.r.add('FAIL', `decisions/${id}.json`, '(file)', `required decision card ${id} is missing (AC-38)`);
    // Proposed cards must be numbered, merged or linked
    for (const f of R.proposed) {
        const d = f.data;
        if (!isObj(d)) continue;
        if (d.assigned_id) {
            const n = Number(String(d.assigned_id).slice(3));
            if (!R.cardById.has(d.assigned_id)) R.r.add('FAIL', f.rel, 'assigned_id', `${d.assigned_id} has no decisions/${d.assigned_id}.json`);
            if (!(n >= 26)) R.r.add('FAIL', f.rel, 'assigned_id', 'new cards are numbered OD-26 or higher');
        } else if (d.merged_into) {
            if (!R.cardById.has(d.merged_into) && !R.propById.has(d.merged_into)) R.r.add('FAIL', f.rel, 'merged_into', `${d.merged_into} names no card`);
        } else if (!d.linked_od) R.r.add('FAIL', f.rel, 'assigned_id', 'proposed card is not yet merged, linked or numbered (run assign-cards.ts)');
    }
    for (const [id] of R.cardById) {
        const n = Number(id.slice(3));
        if (n >= 26) {
            const srcs = R.proposed.filter((f) => f.data?.assigned_id === id);
            if (srcs.length !== 1) R.r.add('FAIL', `decisions/${id}.json`, 'id', `${id} must come from exactly one proposed card's assigned_id (assign-cards.ts), found ${srcs.length}`);
        }
    }
    // Capability files exist
    const has = (list: RegFile[], name: string) => list.some((f) => stem(f.rel) === name);
    for (const s of R.slices) {
        if (s.capabilities.ledger && !has(R.ledgers, s.slice)) R.r.add('FAIL', `ledger/${s.slice}.json`, '(file)', `ledger slice ${s.slice} has no ledger file`);
        if (s.capabilities.sweep && !has(R.sweeps, s.slice)) R.r.add('FAIL', `sweep/${s.slice}.json`, '(file)', `sweep slice ${s.slice} has no sweep file (20 cells required)`);
        if (s.capabilities.thresholds && !has(R.thresholds, s.slice)) R.r.add('FAIL', `thresholds/${s.slice}.json`, '(file)', `thresholds slice ${s.slice} has no thresholds file`);
    }
    for (const a of AREAS) if (!R.slices.some((s) => s.capabilities.sweep && s.area === a)) R.r.add('FAIL', 'slices.json', 'area', `area ${a} has no sweep slice (20 x 5 matrix)`);
    // Cross-class: every (non-duplicate) finding appears in its area's cell for each of its classes.
    const m = mergedSweep({ slices: R.slices, sweeps: R.sweeps, contribs: R.contribs });
    for (const f of R.findings) {
        const F = f.data;
        if (!isObj(F) || F.duplicate_of || !m.has(String(F.area)) || !Array.isArray(F.classes)) continue;
        for (const k of F.classes) {
            const slot = m.get(String(F.area))?.get(String(k));
            if (slot && !slot.ids.has(F.id)) R.r.add('FAIL', f.rel, 'classes', `${F.id} (${k}) is missing from sweep cell ${F.area} x ${k} (AC-34)`);
        }
    }
    // Duplicate reconciliation (PROTOCOL section 5)
    const dupsOf = new Map<string, any[]>();
    for (const F of R.fById.values()) if (F.duplicate_of) (dupsOf.get(F.duplicate_of) ?? dupsOf.set(F.duplicate_of, []).get(F.duplicate_of)!).push(F);
    for (const [cid, dups] of dupsOf) {
        const C = R.fById.get(cid);
        if (!C) continue;
        const cf = fileOfFinding(R, cid);
        if (C.duplicate_of) R.r.add('FAIL', cf, 'duplicate_of', `${cid} is a canonical entry for ${dups.map((d) => d.id).join(', ')} and may not itself be a duplicate`);
        for (const D of dups) {
            const df = fileOfFinding(R, D.id);
            if (sevNum(D.severity) >= 0 && sevNum(C.severity) > sevNum(D.severity)) R.r.add('FAIL', cf, 'severity', `canonical ${cid} must carry the highest severity of its merged set (${D.id} is ${D.severity})`);
            for (const k of Array.isArray(D.classes) ? D.classes : []) if (!(C.classes ?? []).includes(k)) R.r.add('FAIL', cf, 'classes', `canonical ${cid} must carry the union of classes (missing ${k} from ${D.id})`);
            for (const k of Array.isArray(D.reported_by) ? D.reported_by : []) if (!(C.reported_by ?? []).includes(k)) R.r.add('FAIL', cf, 'reported_by', `canonical ${cid} must carry the union of reported_by (missing ${k} from ${D.id})`);
            const cRefs = new Set((C.evidence ?? []).map((e: any) => e?.ref));
            for (const e of Array.isArray(D.evidence) ? D.evidence : []) if (!cRefs.has(e?.ref)) R.r.add('FAIL', cf, 'evidence', `canonical ${cid} must carry the union of evidence (missing ${e?.ref} from ${D.id})`);
            if (D.escalation_ref && D.escalation_ref !== C.escalation_ref)
                R.r.add('FAIL', df, 'escalation_ref', `duplicate_of ${cid}: a duplicate may keep an escalation_ref only if it equals the canonical one (${D.escalation_ref} vs ${C.escalation_ref ?? 'none'})`);
            if (D.od_ref && D.od_ref !== C.od_ref) R.r.add('FAIL', df, 'od_ref', `duplicate_of ${cid}: a duplicate may keep an od_ref only if it equals the canonical one (${D.od_ref} vs ${C.od_ref ?? 'none'})`);
        }
        if (!isStr(C.severity_rationale) || !dups.some((D) => C.severity_rationale.includes(D.id)))
            R.r.add('FAIL', cf, 'severity_rationale', `canonical ${cid} must name the merge (one of ${dups.map((d) => d.id).join(', ')}) in severity_rationale`);
    }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export function check(root: string, repo: string, stage: Stage, slicesSel: string[]): { report: Report; fatal?: string } {
    const sel = slicesSel.length ? new Set(slicesSel) : null;
    const R = loadRegister(root, repo, stage, sel);
    const r = R.r;
    for (const p of R.cfg.problems) r.add('FAIL', p.file, p.field, p.msg);
    if (R.cfg.problems.some((p) => p.file === 'slices.json' || p.file === 'BASE.json' || p.file === 'scope.json')) return { report: r, fatal: 'configuration invalid' };
    for (const s of slicesSel) if (!R.sliceBy.has(s)) throw new UsageError(`unknown slice '${s}'`);
    R.headSha = resolveSha(repo, 'HEAD');
    try {
        listTree(repo, R.baseSha);
    } catch {
        r.add('FAIL', 'BASE.json', 'audit_base_sha', `${R.baseSha} is not a commit in the repository`);
        return { report: r, fatal: 'base sha unknown' };
    }

    // Findings: ID format and global uniqueness always; schema for the selection.
    const idFiles = new Map<string, string[]>();
    for (const f of R.findings) {
        const nameId = stem(f.rel);
        const nameSlice = findingSlice(nameId);
        const mine = inSel(R, nameSlice) || inSel(R, findingSlice(String(f.data?.id ?? '')));
        if (f.error || !isObj(f.data)) {
            r.add(mine ? 'FAIL' : 'WARN', f.rel, '(file)', `unreadable or not an object: ${f.error ?? 'not an object'}`);
            continue;
        }
        const id = String(f.data.id ?? '');
        (idFiles.get(id) ?? idFiles.set(id, []).get(id)!).push(f.rel);
        if (!mine) continue;
        if (!ID_RE.finding.test(nameId)) r.add('FAIL', f.rel, '(file)', 'file name must be AUD-<SLICE>-NNN.json');
        if (!ID_RE.finding.test(id)) r.add('FAIL', f.rel, 'id', 'must be AUD-<SLICE>-NNN');
        else {
            if (id !== nameId) r.add('FAIL', f.rel, 'id', `id ${id} does not match the file name`);
            const s = findingSlice(id)!;
            if (!R.sliceBy.has(s)) r.add('FAIL', f.rel, 'id', `prefix AUD-${s} is not a slice in slices.json`);
            else if (f.data.slice !== s) r.add('FAIL', f.rel, 'slice', `must be ${s} (the slice that owns prefix AUD-${s})`);
        }
        checkFinding(R, f);
    }
    for (const [id, files] of idFiles) if (files.length > 1 && id) for (const file of files) r.add('FAIL', file, 'id', `duplicate id ${id} (also in ${files.filter((x) => x !== file).join(', ')})`);

    // Escalation records
    const escIds = new Map<string, string[]>();
    for (const f of R.escalations) {
        const nameId = stem(f.rel);
        const mine = inSel(R, escPrefix(nameId));
        if (f.error || !isObj(f.data)) {
            r.add(mine ? 'FAIL' : 'WARN', f.rel, '(file)', `unreadable or not an object: ${f.error ?? 'not an object'}`);
            continue;
        }
        const id = String(f.data.id ?? '');
        (escIds.get(id) ?? escIds.set(id, []).get(id)!).push(f.rel);
        if (!mine) continue;
        if (id !== nameId) r.add('FAIL', f.rel, 'id', `id ${id} does not match the file name`);
        const pre = escPrefix(id);
        if (!pre) r.add('FAIL', f.rel, 'id', 'must be ESC-<AREA>-NN');
        else if (!R.sliceBy.has(pre) && !ESCALATION_ONLY_PREFIXES.includes(pre)) r.add('FAIL', f.rel, 'id', `prefix ESC-${pre} is neither a slice nor one of ${ESCALATION_ONLY_PREFIXES.join(', ')}`);
        checkEscalation(R, f);
    }
    for (const [id, files] of escIds) if (files.length > 1 && id) for (const file of files) r.add('FAIL', file, 'id', `duplicate escalation id ${id}`);

    // Decision cards
    for (const f of R.cards) {
        if (!cardInSel(R, f, f.data)) continue;
        if (f.error || !isObj(f.data)) {
            r.add('FAIL', f.rel, '(file)', `unreadable or not an object: ${f.error ?? 'not an object'}`);
            continue;
        }
        if (!ID_RE.card.test(String(f.data.id)) || f.data.id !== stem(f.rel)) r.add('FAIL', f.rel, 'id', 'must be OD-N and match the file name');
        checkCard(R, f, false);
    }
    for (const f of R.proposed) {
        if (!cardInSel(R, f, f.data)) continue;
        if (f.error || !isObj(f.data)) {
            r.add('FAIL', f.rel, '(file)', `unreadable or not an object: ${f.error ?? 'not an object'}`);
            continue;
        }
        const m = ID_RE.proposed.exec(String(f.data.id));
        if (!m || f.data.id !== stem(f.rel) || !R.sliceBy.has(m[1])) r.add('FAIL', f.rel, 'id', 'must be <SLICE>-NN for a slice in slices.json and match the file name');
        checkCard(R, f, true);
    }

    // Process notes (not slice-owned: checked when no --slice filter is given)
    if (!R.sel)
        for (const f of R.notes) {
            if (f.error || !isObj(f.data)) r.add('FAIL', f.rel, '(file)', `unreadable or not an object: ${f.error ?? 'not an object'}`);
            else checkNote(R, f);
        }

    // Ledger / sweep / thresholds files
    const capFiles: [RegFile[], 'ledger' | 'sweep' | 'thresholds'][] = [
        [R.ledgers, 'ledger'],
        [R.sweeps, 'sweep'],
        [R.thresholds, 'thresholds'],
    ];
    for (const [list, cap] of capFiles)
        for (const f of list) {
            const s = R.sliceBy.get(stem(f.rel));
            if (!inSel(R, stem(f.rel))) continue;
            if (!s) {
                r.add('FAIL', f.rel, '(file)', `${stem(f.rel)} is not a slice in slices.json`);
                continue;
            }
            if (!s.capabilities[cap]) {
                r.add('FAIL', f.rel, '(file)', `slice ${s.slice} has no ${cap} capability, so it may not have a ${cap} file`);
                continue;
            }
            if (f.error) {
                r.add('FAIL', f.rel, '(file)', `unreadable: ${f.error}`);
                continue;
            }
            if (cap === 'ledger') checkLedger(R, f, s);
            else if (cap === 'sweep') checkSweep(R, f, s);
            else checkThresholds(R, f, s);
        }
    for (const f of R.contribs) {
        if (!inSel(R, stem(f.rel).slice('contrib-'.length))) continue;
        if (f.error) r.add('FAIL', f.rel, '(file)', `unreadable: ${f.error}`);
        else checkContrib(R, f);
    }

    checkEscalationLinks(R);
    checkReferences(R);
    checkTriage(R);

    // Consolidation and the universe checks belong to Phase 22's audit
    // completeness; stage triage (Phase 23) never runs them.
    if (stage === 'consolidation' || stage === 'final') {
        checkConsolidation(R);
        if (stage === 'consolidation') checkUniverseAt(R, R.baseSha, 'audit_base_sha');
        else {
            checkUniverseAt(R, R.headSha, 'HEAD');
            for (const [rel, what] of [
                ['census/signing-sites.json', 'signing-site census (AC-36)'],
                ['inputs/history-scan.json', 'full-history secret scan record (AC-35)'],
            ]) {
                const f = readJson(path.join(root, ...rel.split('/')), rel);
                if (f.error) r.add('FAIL', rel, '(file)', `the ${what} must be present at stage final`);
            }
        }
    }
    return { report: r };
}

const SPEC = { stage: 'string', slice: 'multi', root: 'string', repo: 'string', 'self-test': 'bool', help: 'bool' } as const;

export function run(argv: string[], io: Io = consoleIo): number {
    try {
        const { flags, positional } = parseArgs(argv, SPEC as unknown as Record<string, 'string' | 'bool' | 'multi'>);
        if (flags.help) {
            io.out('usage: check.ts --stage partial|triage|consolidation|final [--slice S]... [--root d] [--repo d] | --self-test');
            io.out('  triage: Phase 23 gate (D-21): per-file checks plus the triage rules as FAIL; never the consolidation or HEAD-universe checks');
            return 0;
        }
        if (positional.length) throw new UsageError(`unexpected argument '${positional[0]}'`);
        if (flags['self-test']) return selfTest(io);
        const stage = flags.stage as Stage;
        if (!STAGES.includes(stage)) throw new UsageError('--stage must be partial, triage, consolidation or final');
        const sel = (flags.slice as string[] | undefined) ?? [];
        if (sel.length && stage !== 'partial') throw new UsageError('--slice is only valid with --stage partial');
        const loc = locations(flags);
        const { report, fatal } = check(loc.root, loc.repo, stage, sel);
        for (const l of report.lines()) io.out(l);
        const fails = report.count('FAIL');
        io.out(
            `RESULT ${fails ? 'FAIL' : 'PASS'} stage=${stage}${sel.length ? ' slices=' + [...sel].sort(cmp).join(',') : ''} fail=${fails} pending=${report.count('PENDING')} warn=${report.count('WARN')}${fatal ? ' (' + fatal + ')' : ''}`,
        );
        return fails ? 1 : 0;
    } catch (e) {
        if (e instanceof UsageError) {
            io.err(`check: ${e.message}`);
            return 2;
        }
        io.err(`check: crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        return 2;
    }
}

// ---------------------------------------------------------------------------
// Self-test: a temp fixture register and a temp git repo under os.tmpdir()
// ---------------------------------------------------------------------------

function sh(cwd: string, args: string[], hooks: string): string {
    return cp
        .execFileSync('git', ['-C', cwd, '-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgsign=false', '-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', '-c', 'core.autocrlf=false', ...args], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        })
        .toString('utf8')
        .trim();
}

function put(dir: string, rel: string, content: string): void {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
}

function putJson(dir: string, rel: string, data: unknown): void {
    put(dir, rel, toJson(data));
}

function getJson(dir: string, rel: string): any {
    return JSON.parse(fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8'));
}

interface Fixture {
    tmp: string;
    repo: string;
    root: string;
    base: string;
    head: string;
    side: string;
}

function card(id: string, decided = false): any {
    return {
        id,
        title: `fixture card ${id}`,
        area: 'SRC',
        capital: !decided,
        status: decided ? 'decided' : 'open',
        options: [
            { id: 'keep', name: 'keep current behavior', behavior_impact: 'none', risk: 'the defect stays reachable' },
            { id: 'change', name: 'change behavior', behavior_impact: 'behavior changes', risk: 'regression risk' },
        ],
        keep_current_option_id: 'keep',
        recommendation: 'decide in the owning phase',
        default: 'keep current behavior until decided',
        behavior_impact: 'depends on the option',
        findings: [],
        decided: decided ? { date: '2026-11-06', ruling: 'change' } : null,
        needed_by: 'Phase 24',
    };
}

function finding(id: string, extra: Record<string, unknown>, sha: string): any {
    const slice = findingSlice(id)!;
    return {
        id,
        title: `fixture finding ${id}`,
        kind: 'finding',
        area: 'src',
        slice,
        severity: 'S2',
        capital_impact: 'none',
        classes: ['C01'],
        files: ['src/a.ts'],
        evidence: [{ type: 'code', ref: `src/a.ts:1@${sha}`, note: 'fixture' }],
        sibling_sites_checked: 'src/b.ts searched; no sibling',
        status: 'candidate',
        origin: 'independent',
        rc: [],
        research_suggested_severity: null,
        severity_rationale: '',
        duplicate_of: null,
        related: [],
        tags: [],
        escalation_ref: null,
        od_ref: null,
        recommendation: 'fixture recommendation',
        reported_by: ['claude'],
        found_date: '2026-11-06',
        audited_sha: sha,
        ...extra,
    };
}

function esc(id: string, items: string[], resolved: string[], extra: Record<string, unknown> = {}): any {
    return {
        id,
        date: '2026-11-06',
        tier: 'area-batch',
        items,
        resolved_items: resolved,
        summary: `fixture escalation ${id}`,
        presented_at: 'fixture session',
        operator_response: null,
        acknowledgement_evidence: 'fixture: acknowledged in the fixture session',
        ruling: 'none',
        phase_continued: true,
        ...extra,
    };
}

function buildFixture(): Fixture {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-check-selftest-'));
    const repo = path.join(tmp, 'repo');
    const hooks = path.join(tmp, 'nohooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    sh(repo, ['init', '-q', '-b', 'main'], hooks);
    const files: Record<string, string> = {
        'package.json': '{"name":"fixture"}\n',
        'src/a.ts': 'export const a = 1;\n',
        'src/b.ts': 'export const b = 2;\n',
        'src/sub/c.ts': 'export const c = 3;\n',
        'dashboard/d.tsx': 'export const d = 4;\n',
        'test/unit/u.test.ts': 'export const u = 5;\n',
        'test/helpers/h.ts': 'export const h = 6;\n',
        'scripts/s.ts': 'export const s = 7;\n',
        'contracts/K.sol': '// fixture\n',
        'docs/x.md': '# fixture\n',
    };
    for (const [rel, content] of Object.entries(files)) put(repo, rel, content);
    sh(repo, ['add', '-A'], hooks);
    sh(repo, ['commit', '-q', '-m', 'base'], hooks);
    const base = sh(repo, ['rev-parse', 'HEAD'], hooks);
    put(repo, 'src/b.ts', 'export const b = 20;\n');
    put(repo, 'src/sub/n.ts', 'export const n = 8;\n');
    sh(repo, ['add', '-A'], hooks);
    sh(repo, ['commit', '-q', '-m', 'change b, add n'], hooks);
    const head = sh(repo, ['rev-parse', 'HEAD'], hooks);
    sh(repo, ['switch', '-q', '-c', 'side'], hooks);
    put(repo, 'orphan/x.ts', 'export const x = 9;\n');
    sh(repo, ['add', '-A'], hooks);
    sh(repo, ['commit', '-q', '-m', 'orphan'], hooks);
    const side = sh(repo, ['rev-parse', 'HEAD'], hooks);
    sh(repo, ['switch', '-q', 'main'], hooks);

    const root = path.join(tmp, 'register');
    putJson(root, 'BASE.json', { audit_base_sha: base, recorded_at: 'fixture', rule: 'fixture' });
    putJson(root, 'classes.json', { areas: [...AREAS], classes: CLASS_IDS.map((id) => ({ id, name: `class ${id}` })) });
    putJson(root, 'scope.json', { out_of_scope: [{ prefix: 'docs/', reason: 'fixture prose' }] });
    const mk = (slice: string, area: string | null, caps: [boolean, boolean, boolean, boolean], include: string[], anchors: string[], rc: number[], ods: string[], exclude: string[] = []) => ({
        slice,
        id_prefix: `AUD-${slice}`,
        area,
        capabilities: { ledger: caps[0], sweep: caps[1], thresholds: caps[2], findings_only: caps[3] },
        include,
        exclude,
        anchors,
        files_at_base: [] as string[],
        count_at_base: 0,
        owned_rc: rc,
        owned_section_c: [],
        owned_od_cards: ods,
        plan: '22-04',
    });
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    const slices: any[] = [
        mk('SRC', 'src', [true, true, true, false], ['src/a.ts', 'src/sub/'], ['src/a.ts'], range(1, 14), ['OD-6', 'OD-9', 'OD-10', 'OD-11', 'OD-14']),
        mk('SRCB', 'src', [true, true, false, false], ['src/b.ts'], ['src/b.ts'], range(15, 27), ['OD-15', 'OD-16', 'OD-17', 'OD-18', 'OD-25']),
        mk('DASH', 'dashboard', [true, true, false, false], ['dashboard/'], ['dashboard/d.tsx'], [], []),
        mk('TESTU', 'test', [true, true, false, false], ['test/unit/'], ['test/unit/u.test.ts'], [], []),
        mk('TESTI', 'test', [true, true, false, false], ['test/'], ['test/helpers/h.ts'], [], [], ['test/unit/']),
        mk('SCRIPTS', 'scripts', [true, true, false, false], ['scripts/'], ['scripts/s.ts'], [], []),
        mk('CONTRACTS', 'contracts', [true, true, false, false], ['contracts/'], ['contracts/K.sol'], [], []),
        mk('ROOT', 'root', [true, false, false, false], ['package.json'], ['package.json'], [], []),
        mk('RAIL', null, [false, false, false, true], [], [], [28], ['OD-21']),
    ];
    for (const s of slices)
        if (s.capabilities.ledger) {
            s.files_at_base = enumerateSlice(base, s, { repo });
            s.count_at_base = s.files_at_base.length;
        }
    putJson(root, 'slices.json', slices);

    // Findings: one per RC (RC-10 resolves an rc: alias), plus escalation, secret,
    // duplicate and key-alias cases.
    const F: any[] = [];
    for (let n = 1; n <= 28; n++) {
        const rc = `RC-${String(n).padStart(2, '0')}`;
        F.push(finding(`AUD-SRC-${String(n).padStart(3, '0')}`, { rc: [rc], origin: 'research-candidate', research_suggested_severity: 'S2' }, base));
    }
    F[0].severity_rationale = 'merged duplicate AUD-SRCB-001 into this entry';
    F[0].reported_by = ['claude', 'second-model'];
    F[1].od_ref = 'OD-6';
    F[9].escalation_ref = 'ESC-SRC-01';
    F.push(finding('AUD-SRC-029', { severity: 'S1', capital_impact: 'STRAND', escalation_ref: 'ESC-SRC-02' }, base));
    F.push(finding('AUD-SRC-030', { severity: 'S2', tags: ['secret'], secret_class: 'non-public', classes: ['C17'], escalation_ref: 'ESC-SRC-03' }, base));
    F.push(finding('AUD-SRC-031', { severity: 'S4', tags: ['secret'], secret_class: 'known-public', classes: ['C17'] }, base));
    F.push(finding('AUD-SRCB-001', { duplicate_of: 'AUD-SRC-001', files: ['src/b.ts'], reported_by: ['second-model'] }, base));
    F.push(finding('AUD-SRCB-002', { pre_phase_key: 'fixture-key', escalation_ref: 'ESC-PRE-01', files: ['src/b.ts'] }, base));
    F.push(finding('AUD-RAIL-001', { area: 'test', severity: 'S1', capital_impact: 'EXPOSURE', tags: ['rail'], classes: ['C18'], files: ['test/helpers/h.ts'], escalation_ref: 'ESC-RAIL-01' }, base));
    // Phase 23 triage (D-21): the corrected fixture is fully triaged so it passes
    // stage triage as well. Population = non-duplicate RC or S0/S1 entries:
    // AUD-SRC-001..029 confirmed (shared-cause file named for AUD-SRC-001, own
    // file for AUD-SRC-029) and AUD-RAIL-001 fixed by a rail test.
    const popIds: string[] = [];
    const popSev: Record<string, string> = {};
    for (const d of F) {
        if (d.duplicate_of || !(d.rc.length || d.severity === 'S0' || d.severity === 'S1')) continue;
        popIds.push(d.id);
        popSev[d.id] = d.severity;
        if (d.id === 'AUD-RAIL-001') {
            d.status = 'fixed';
            d.triage = { outcome: 'fixed', phase: '23', note: 'fixture: the rail closes it', proof: 'fixture RED proof row 1', rail_test: FIXTURE_RAIL_TEST };
        } else {
            d.status = 'confirmed';
            d.triage = { outcome: 'confirmed', phase: '23', note: 'fixture: reproduced on the real path', test_id: d.id === 'AUD-SRC-029' ? 'AUD-SRC-029' : 'AUD-SRC-001' };
        }
    }
    popIds.sort(cmp);
    putJson(root, POPULATION_REL, { frozen_at_sha: base, count: popIds.length, ids: popIds, severity_at_freeze: popSev });
    for (const d of F) putJson(root, `findings/${d.id}.json`, d);

    putJson(root, 'escalations/ESC-SRC-01.json', esc('ESC-SRC-01', ['rc:RC-10'], ['AUD-SRC-010'], { tier: 'pre-phase' }));
    putJson(root, 'escalations/ESC-SRC-02.json', esc('ESC-SRC-02', ['AUD-SRC-029'], []));
    putJson(root, 'escalations/ESC-SRC-03.json', esc('ESC-SRC-03', ['AUD-SRC-030'], [], { tier: 'immediate', operator_response: 'fixture operator words' }));
    putJson(root, 'escalations/ESC-RAIL-01.json', esc('ESC-RAIL-01', ['AUD-RAIL-001'], [], { tier: 'immediate' }));
    putJson(root, 'escalations/ESC-PRE-01.json', esc('ESC-PRE-01', ['key:SRCB:fixture-key'], ['AUD-SRCB-002'], { tier: 'pre-phase' }));
    putJson(root, 'escalations/ESC-PRE-02.json', esc('ESC-PRE-02', ['input:scan.json#0'], [], { tier: 'immediate', resolution: { status: 'closed', outcome: 'fixture-closed' } }));
    putJson(root, 'inputs/scan.json', { hits: [{ rule_id: 'fixture' }] });
    putJson(root, 'inputs/history-scan.json', { tool: 'fixture', version: '0', hits: [] });
    putJson(root, 'census/signing-sites.json', { sites: [], total_tx_signing: 0, total_message_signing: 0, by_lock_status: {}, method: 'fixture' });
    putJson(root, 'process-notes/PN-001.json', { id: 'PN-001', date: '2026-11-06', description: 'fixture note', evidence: 'fixture' });

    for (const id of REQUIRED_CARDS) putJson(root, `decisions/${id}.json`, card(id, id === 'OD-21'));
    putJson(root, 'decisions/OD-26.json', card('OD-26'));
    putJson(root, 'decisions/proposed/SRC-01.json', { ...card('SRC-01'), assigned_id: 'OD-26' });

    // Ledgers: every enumerated file, "none" when no finding.
    const row = (p: string, extra: Record<string, unknown> = {}) => ({ path: p, audited_sha: base, findings: 'none', ...extra });
    const ql = { claims: 'fixture', mocks_mechanism: 'no', mocked_dependencies: [], mocked_mechanism_detail: '', hollow_assertions: 'no', can_reach_real_state: 'no', notes: '' };
    putJson(root, 'ledger/SRC.json', [row('src/a.ts', { findings: ['AUD-SRC-001'] }), row('src/sub/c.ts'), { path: 'src/sub/n.ts', audited_sha: head, findings: 'none' }]);
    putJson(root, 'ledger/SRCB.json', [row('src/b.ts', { re_audit: [{ from_sha: base, to_sha: head, findings: 'none', note: 'fixture re-audit of the diff' }] })]);
    putJson(root, 'ledger/DASH.json', [row('dashboard/d.tsx')]);
    putJson(root, 'ledger/TESTU.json', [row('test/unit/u.test.ts', { quality_label: ql })]);
    putJson(root, 'ledger/TESTI.json', [row('test/helpers/h.ts')]);
    putJson(root, 'ledger/SCRIPTS.json', [row('scripts/s.ts')]);
    putJson(root, 'ledger/CONTRACTS.json', [row('contracts/K.sol')]);
    putJson(root, 'ledger/ROOT.json', [row('package.json')]);

    // Sweep files: 20 cells each; a finding appears in each cell of its classes.
    for (const s of slices.filter((x: any) => x.capabilities.sweep)) {
        const cells: Record<string, unknown> = {};
        for (const k of CLASS_IDS) {
            const ids = F.filter((d) => !d.duplicate_of && d.area === s.area && d.classes.includes(k) && (s.area !== 'src' || d.slice === s.slice)).map((d) => d.id).sort(cmp);
            cells[k] = { result: ids.length ? ids : 'checked, none', search: `fixture search ${k}` };
        }
        if (s.slice === 'TESTU') for (const k of CLASS_IDS) cells[k] = { result: 'checked, none', search: `fixture search ${k}` };
        putJson(root, `sweep/${s.slice}.json`, { slice: s.slice, area: s.area, audited_sha: base, cells });
    }
    const th: Record<string, unknown> = {};
    for (const k of AC37_FIELDS) th[k] = 'fixture';
    Object.assign(th, { id: 'TH-SRC-01', definition_sites: ['src/a.ts:1'], flags: [], recommendation: null, od_ref: null, env_key: null, hardcoded: true });
    putJson(root, 'thresholds/SRC.json', [th]);
    // Triage test files live in the fixture repo's working tree, untracked, so
    // the git-based ledger and universe checks never see them.
    for (const [rel, content] of Object.entries(fixtureTestFiles())) put(repo, rel, content);
    return { tmp, repo, root, base, head, side };
}

const FIXTURE_RAIL_TEST = 'fixture rails > denies the fixture reach';

/** One knownBug call line for a fixture test file (claim omitted when undefined). */
function kbCall(id: string, claim?: string): string {
    const c = claim === undefined ? '' : `claim: '${claim}', `;
    return `knownBug(ctx, '${id}', { ${c}correct: 1, observed: 2, actual: 2, expectedPlain: 'fixture expected', actualPlain: 'fixture actual' });`;
}

function kbFile(body: string[], imp = "import { knownBug } from '../harness/knownBug';"): string {
    return `${imp}\nit('fixture case', (ctx) => {\n${body.map((b) => '    ' + b).join('\n')}\n});\n`;
}

function fixtureTestFiles(): Record<string, string> {
    const shared: string[] = [];
    for (let n = 1; n <= 28; n++) shared.push(kbCall(`AUD-SRC-${String(n).padStart(3, '0')}`, 'fixture-claim'));
    return {
        [KNOWN_BUG_DECL_FILE]: 'export function knownBug(ctx: unknown, id: string, spec: unknown): void {\n    void ctx;\n    void id;\n    void spec;\n}\n',
        'test/realpath/triage/AUD-SRC-001.test.ts': kbFile(shared),
        'test/realpath/triage/AUD-SRC-029.test.ts': kbFile([kbCall('AUD-SRC-029', 'fixture-claim')]),
        'test/unit/rail.test.ts': `// closes-finding: AUD-RAIL-001 (fixture rail test)\nit('denies the fixture reach', () => {});\n`,
    };
}

function cloneRoot(fx: Fixture, name: string): string {
    const dest = path.join(fx.tmp, `case-${name}`);
    fs.cpSync(fx.root, dest, { recursive: true });
    return dest;
}

interface Res {
    code: number;
    lines: string[];
}

function runCheckIn(root: string, repo: string, stage: Stage, extra: string[] = []): Res {
    const io = captureIo();
    const code = run(['--stage', stage, '--root', root, '--repo', repo, ...extra], io);
    return { code, lines: [...io.lines, ...io.errLines] };
}

function runSlicesIn(root: string, repo: string, args: string[]): Res {
    const io = captureIo();
    const code = runSliceFiles([...args, '--root', root, '--repo', repo], io);
    return { code, lines: [...io.lines, ...io.errLines] };
}

const hasFail = (r: Res, s: string) => r.code === 1 && r.lines.some((l) => l.startsWith('FAIL ') && l.includes(s));
const hasPending = (r: Res, s: string) => r.code === 0 && r.lines.some((l) => l.startsWith('PENDING ') && l.includes(s)) && !r.lines.some((l) => l.startsWith('FAIL '));
const passes = (r: Res) => r.code === 0 && !r.lines.some((l) => l.startsWith('FAIL '));
const errHas = (r: Res, s: string) => r.code === 1 && r.lines.some((l) => l.includes(s));
const firstFail = (r: Res, s: string) => r.lines.find((l) => l.includes(s)) ?? r.lines.find((l) => l.startsWith('FAIL ')) ?? `exit ${r.code}`;

function selfTest(io: Io): number {
    const fx = buildFixture();
    const results: { name: string; ok: boolean; detail: string }[] = [];
    const record = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });
    try {
        const { repo } = fx;
        const mutate = (name: string, fn: (root: string) => void): string => {
            const root = cloneRoot(fx, name);
            fn(root);
            return root;
        };
        const edit = (root: string, rel: string, fn: (d: any) => void) => {
            const d = getJson(root, rel);
            fn(d);
            putJson(root, rel, d);
        };

        // 1. missing sibling_sites_checked
        {
            const root = mutate('01', (r) => edit(r, 'findings/AUD-SRC-002.json', (d) => delete d.sibling_sites_checked));
            const res = runCheckIn(root, repo, 'partial');
            record('01 missing sibling_sites_checked fails', hasFail(res, 'missing required field sibling_sites_checked'), firstFail(res, 'sibling_sites_checked'));
        }
        // 2. duplicate id
        {
            const root = mutate('02', (r) => putJson(r, 'findings/AUD-SRC-099.json', getJson(r, 'findings/AUD-SRC-003.json')));
            const res = runCheckIn(root, repo, 'partial');
            record('02 duplicate id fails', hasFail(res, 'duplicate id AUD-SRC-003'), firstFail(res, 'duplicate id'));
        }
        // 3. evidence ref into a SUMMARY doc (NAC-09)
        {
            const root = mutate('03', (r) =>
                edit(r, 'findings/AUD-SRC-005.json', (d) => d.evidence.push({ type: 'command', ref: 'cat .planning/phases/21-x/21-03-SUMMARY.md', note: 'anchoring' })),
            );
            const res = runCheckIn(root, repo, 'partial');
            record('03 evidence citing a SUMMARY doc fails (NAC-09)', hasFail(res, 'NAC-09'), firstFail(res, 'NAC-09'));
        }
        // 4. RC entry closed as NOT-A-BUG with no Phase 23 triage record (NAC-10), and severity lowered without rationale
        {
            const root = mutate('04', (r) => {
                edit(r, 'findings/AUD-SRC-004.json', (d) => {
                    d.status = 'NOT-A-BUG';
                    delete d.triage;
                });
                edit(r, 'findings/AUD-SRC-006.json', (d) => {
                    d.research_suggested_severity = 'S1';
                    d.severity = 'S3';
                });
            });
            const res = runCheckIn(root, repo, 'partial');
            record(
                '04 RC entry NOT-A-BUG with no Phase 23 triage record / severity lowered without rationale fails (NAC-10)',
                hasFail(res, 'NAC-10: research candidate RC-04 may be closed as NOT-A-BUG only with a Phase 23 triage record') && hasFail(res, 'NAC-10: severity S3 is below'),
                firstFail(res, 'NAC-10'),
            );
        }
        // 5. card with one option (NAC-12)
        {
            const root = mutate('05', (r) => edit(r, 'decisions/OD-9.json', (d) => (d.options = d.options.slice(0, 1))));
            const res = runCheckIn(root, repo, 'partial');
            record('05 card with one option fails (NAC-12)', hasFail(res, 'NAC-12: a card must list at least 2 options'), firstFail(res, 'NAC-12'));
        }
        // 6. S1 finding without escalation_ref: PENDING at partial, FAIL at consolidation
        {
            const root = mutate('06', (r) => putJson(r, 'findings/AUD-SRC-042.json', finding('AUD-SRC-042', { severity: 'S1', classes: [] }, fx.base)));
            const p = runCheckIn(root, repo, 'partial');
            const c = runCheckIn(root, repo, 'consolidation');
            record(
                '06 S1 without escalation_ref: PENDING at partial, FAIL at consolidation',
                hasPending(p, 'escalation required (S1') && hasFail(c, 'escalation required (S1'),
                `${firstFail(p, 'escalation required')} | ${firstFail(c, 'escalation required')}`,
            );
        }
        // 7. non-public secret without escalation fails; known-public passes
        {
            const np = mutate('07a', (r) => putJson(r, 'findings/AUD-SRC-040.json', finding('AUD-SRC-040', { tags: ['secret'], secret_class: 'non-public', classes: [] }, fx.base)));
            const kp = mutate('07b', (r) => putJson(r, 'findings/AUD-SRC-041.json', finding('AUD-SRC-041', { severity: 'S4', tags: ['secret'], secret_class: 'known-public', classes: [] }, fx.base)));
            const a = runCheckIn(np, repo, 'consolidation');
            const b = runCheckIn(kp, repo, 'consolidation');
            record(
                '07 non-public secret without escalation fails; known-public without escalation passes',
                hasFail(a, 'escalation required (non-public secret') && passes(b),
                `${firstFail(a, 'non-public')} | known-public exit ${b.code}`,
            );
        }
        // 8. rc:RC-10 alias unresolved fails at consolidation; resolved passes (the corrected fixture)
        {
            const root = mutate('08', (r) => {
                edit(r, 'findings/AUD-SRC-010.json', (d) => (d.escalation_ref = null));
                edit(r, 'escalations/ESC-SRC-01.json', (d) => (d.resolved_items = []));
            });
            const c = runCheckIn(root, repo, 'consolidation');
            const ok = runCheckIn(fx.root, repo, 'consolidation');
            record('08 unresolved rc:RC-10 alias fails at consolidation; resolved record passes', hasFail(c, 'alias rc:RC-10 is not yet resolved') && passes(ok), firstFail(c, 'rc:RC-10'));
        }
        // 9. sweep slice missing a cell fails; findings-only slice with no sweep/ledger passes
        {
            const root = mutate('09', (r) => edit(r, 'sweep/SRCB.json', (d) => delete d.cells.C05));
            const c = runCheckIn(root, repo, 'consolidation');
            const ok = runCheckIn(fx.root, repo, 'consolidation');
            const railClean = !ok.lines.some((l) => l.includes('RAIL') && l.startsWith('FAIL'));
            record('09 sweep slice missing cell C05 fails; findings-only RAIL with no sweep/ledger passes', hasFail(c, 'missing sweep cell C05') && passes(ok) && railClean, firstFail(c, 'C05'));
        }
        // 10. zero-file include, missing anchor, '*' and '{' entries
        {
            const z = mutate('10a', (r) => edit(r, 'slices.json', (d) => (d.find((s: any) => s.slice === 'DASH').include = ['dashboard/none/'])));
            const a = mutate('10b', (r) => edit(r, 'slices.json', (d) => d.find((s: any) => s.slice === 'SRC').anchors.push('src/missing.ts')));
            const g = mutate('10c', (r) => edit(r, 'slices.json', (d) => (d.find((s: any) => s.slice === 'SRC').include = ['src/*.ts'])));
            const b = mutate('10d', (r) => edit(r, 'slices.json', (d) => (d.find((s: any) => s.slice === 'SRC').include = ['src/{a,b}.ts'])));
            const rz = runSlicesIn(z, repo, ['--slice', 'DASH']);
            const ra = runSlicesIn(a, repo, ['--slice', 'SRC']);
            const rg = runSlicesIn(g, repo, ['--slice', 'SRC']);
            const rb = runSlicesIn(b, repo, ['--slice', 'SRC']);
            const cg = runCheckIn(g, repo, 'partial');
            record(
                '10 zero-file selection, missing anchor, and * / { entries are rejected',
                errHas(rz, 'selects zero files') && errHas(ra, 'missing anchor src/missing.ts') && errHas(rg, 'glob or brace') && errHas(rb, 'glob or brace') && hasFail(cg, 'glob or brace'),
                `${rz.code}/${ra.code}/${rg.code}/${rb.code}/${cg.code}`,
            );
        }
        // 11. unassigned and multiply-assigned tracked files fail the universe check
        {
            const u = runSlicesIn(fx.root, repo, ['--universe', '--sha', fx.side]);
            const mroot = mutate('11', (r) => edit(r, 'slices.json', (d) => d.find((s: any) => s.slice === 'SRCB').include.push('src/a.ts')));
            const m = runSlicesIn(mroot, repo, ['--universe']);
            const mc = runCheckIn(mroot, repo, 'consolidation');
            record(
                '11 unassigned and multiply-assigned files fail the universe check',
                errHas(u, 'UNASSIGNED orphan/x.ts') && errHas(m, 'MULTIPLY-ASSIGNED src/a.ts') && hasFail(mc, 'src/a.ts (tracked at audit_base_sha) is multiply assigned'),
                `${u.code}/${m.code}/${mc.code}`,
            );
        }
        // 12. od_ref to a missing card; duplicate carrying a different escalation_ref
        {
            const o = mutate('12a', (r) => edit(r, 'findings/AUD-SRC-003.json', (d) => (d.od_ref = 'OD-99')));
            const d2 = mutate('12b', (r) => edit(r, 'findings/AUD-SRCB-001.json', (d) => (d.escalation_ref = 'ESC-SRC-02')));
            const ro = runCheckIn(o, repo, 'consolidation');
            const rd = runCheckIn(d2, repo, 'consolidation');
            record(
                '12 od_ref to a missing card and a duplicate with a different escalation_ref fail',
                hasFail(ro, 'od_ref OD-99 names no decision card') && hasFail(rd, 'a duplicate may keep an escalation_ref only if it equals the canonical one'),
                `${firstFail(ro, 'OD-99')} | ${firstFail(rd, 'duplicate may keep')}`,
            );
        }
        // 13. operator_response null without acknowledgement_evidence
        {
            const root = mutate('13', (r) => edit(r, 'escalations/ESC-RAIL-01.json', (d) => delete d.acknowledgement_evidence));
            const res = runCheckIn(root, repo, 'partial');
            record('13 null operator_response without acknowledgement_evidence fails', hasFail(res, 'acknowledgement_evidence must name where the operator was told'), firstFail(res, 'acknowledgement_evidence'));
        }
        // 14. snapshot reproduces exactly the enumerated list (and refuses a non-empty folder)
        {
            const out = path.join(fx.tmp, 'snap');
            const s = runSlicesIn(fx.root, repo, ['--snapshot', 'SRC,TESTI', '--out', out]);
            const cfg = getJson(fx.root, 'slices.json');
            const want = [...new Set(['SRC', 'TESTI'].flatMap((n) => enumerateSlice(fx.base, cfg.find((x: any) => x.slice === n), { repo })))].sort(cmp);
            const walk = (dir: string, b = dir): string[] =>
                fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), b) : [path.relative(b, path.join(dir, e.name)).split(path.sep).join('/')]));
            const got = fs.existsSync(out) ? walk(out).sort(cmp) : [];
            const again = runSlicesIn(fx.root, repo, ['--snapshot', 'SRC', '--out', out]);
            record(
                '14 --snapshot reproduces exactly the enumerated list; a non-empty folder is refused',
                s.code === 0 && got.join('\n') === want.join('\n') && want.length === 3 && errHas(again, 'is not empty'),
                `snapshot exit ${s.code}, ${got.length} files (want ${want.length}: ${want.join(', ')})`,
            );
        }
        // 15. final: a ledger row whose file changed after audited_sha needs a re_audit entry
        {
            const root = mutate('15', (r) => edit(r, 'ledger/SRCB.json', (d) => delete d[0].re_audit));
            const c = runCheckIn(root, repo, 'consolidation');
            const f = runCheckIn(root, repo, 'final');
            record('15 changed file without re_audit passes consolidation and fails final (AC-32)', passes(c) && hasFail(f, 'a re_audit entry must end at its last-change SHA'), firstFail(f, 're_audit'));
        }
        // 16. keep-current option without a stated risk, and a decided card other than OD-1/2/7/21 (NAC-12)
        {
            const root = mutate('16', (r) => {
                edit(r, 'decisions/OD-10.json', (d) => (d.options[0].risk = ''));
                edit(r, 'decisions/OD-11.json', (d) => {
                    d.status = 'decided';
                    d.decided = { date: '2026-11-06', ruling: 'change' };
                });
            });
            const res = runCheckIn(root, repo, 'partial');
            record(
                '16 keep-current option without risk and a non-allowed decided card fail (NAC-12)',
                hasFail(res, 'NAC-12: the keep-current option must state its risk') && hasFail(res, 'NAC-12: only OD-1, OD-2, OD-7, OD-21 may be decided'),
                firstFail(res, 'NAC-12'),
            );
        }
        // ---- Phase 23 triage rules (D-21) ----
        // Writes test files into the fixture repo's working tree for one case and
        // removes them afterwards, so no case sees another's files.
        const withFiles = <T>(files: Record<string, string>, fn: () => T): T => {
            for (const rel of Object.keys(files)) if (fs.existsSync(path.join(repo, ...rel.split('/')))) throw new Error(`self-test: ${rel} already exists in the fixture repo`);
            try {
                for (const [rel, content] of Object.entries(files)) put(repo, rel, content);
                return fn();
            } finally {
                for (const rel of Object.keys(files)) fs.rmSync(path.join(repo, ...rel.split('/')), { force: true });
            }
        };
        const hasLine = (r: Res, file: string, s: string) => r.code === 1 && r.lines.some((l) => l.startsWith(`FAIL ${file} `) && l.includes(s));
        // A register where AUD-SRCB-002 (S2, outside the population) is recorded confirmed.
        const confirmedRoot = (name: string) =>
            mutate(name, (r) =>
                edit(r, 'findings/AUD-SRCB-002.json', (d) => {
                    d.status = 'confirmed';
                    d.triage = { outcome: 'confirmed', phase: '23', note: 'fixture', test_id: 'AUD-SRCB-002' };
                }),
            );
        const NOCALL = 'AUD-SRCB-002: outcome confirmed needs a knownBug call carrying AUD-SRCB-002';
        const OUTSIDE = 'knownBug(AUD-SRCB-002) is outside the evidence zone';
        const HARNESS = 'test/realpath/harnessCapture.test.ts';
        const HARNESS_IMPORT = "import { knownBug } from './harness/knownBug';";
        // 17. confirmed needs a knownBug call carrying its own ID in the evidence zone
        {
            const root = confirmedRoot('17');
            const no = runCheckIn(root, repo, 'partial');
            const yes = withFiles({ 'test/realpath/triage/AUD-SRCB-002.test.ts': kbFile([kbCall('AUD-SRCB-002', 'fixture-claim')]) }, () => runCheckIn(root, repo, 'partial'));
            record('17 confirmed outcome with no knownBug call carrying its ID fails; with the call it passes (D-21)', hasFail(no, NOCALL) && passes(yes), `${firstFail(no, NOCALL)} | with call exit ${yes.code} ${firstFail(yes, 'FAIL')}`);
        }
        // 18. stage triage never runs the consolidation or HEAD-universe check
        {
            const root = mutate('18', (r) => {
                edit(r, 'scope.json', (d) => (d.out_of_scope = []));
                fs.rmSync(path.join(r, 'decisions', 'OD-25.json'));
            });
            const t = runCheckIn(root, repo, 'triage');
            const c = runCheckIn(root, repo, 'consolidation');
            const f = runCheckIn(root, repo, 'final');
            record(
                '18 stage triage passes a tree with a tracked file outside the universe manifest and a missing required card (no consolidation or HEAD-universe check)',
                passes(t) && hasFail(c, 'docs/x.md (tracked at audit_base_sha) belongs to no slice') && hasFail(c, 'required decision card OD-25 is missing') && hasFail(f, 'docs/x.md (tracked at HEAD) belongs to no slice'),
                `triage exit ${t.code} ${firstFail(t, 'FAIL')} | consolidation exit ${c.code} | final exit ${f.code}`,
            );
        }
        // 19. the frozen population can never shrink
        {
            const sev = mutate('19a', (r) =>
                edit(r, 'findings/AUD-SRC-029.json', (d) => {
                    d.severity = 'S3';
                    d.status = 'candidate';
                    delete d.triage;
                }),
            );
            const gone = mutate('19b', (r) => fs.rmSync(path.join(r, 'findings', 'AUD-SRC-029.json')));
            const MSG = 'AUD-SRC-029 is in the Phase 23 triage population and has no triage record';
            const t = runCheckIn(sev, repo, 'triage');
            const p = runCheckIn(sev, repo, 'partial');
            const g = runCheckIn(gone, repo, 'triage');
            record(
                '19 a frozen ID changed to S3 is still required (FAIL at triage, PENDING at partial); a frozen ID whose finding file is gone fails',
                hasFail(t, MSG) && p.code === 0 && p.lines.some((l) => l.startsWith('PENDING ') && l.includes(MSG)) && hasFail(g, 'frozen triage population ID AUD-SRC-029 names no finding'),
                `${firstFail(t, MSG)} | partial exit ${p.code} | ${firstFail(g, 'frozen triage population')}`,
            );
        }
        // 20-30. knownBug location: only the evidence zone feeds a finding rule
        {
            const root = confirmedRoot('20');
            const res = withFiles({ [HARNESS]: kbFile([kbCall('AUD-SRCB-002', 'fixture-claim')], HARNESS_IMPORT) }, () => runCheckIn(root, repo, 'partial'));
            record('20 knownBug location: real ID at the harness path cannot satisfy confirmed', hasFail(res, NOCALL) && hasLine(res, HARNESS, OUTSIDE), `${firstFail(res, NOCALL)} | ${firstFail(res, OUTSIDE)}`);
        }
        {
            const files = { [HARNESS]: kbFile([kbCall(HARNESS_SELFTEST_ID, 'selftest-with-claim'), kbCall(HARNESS_SELFTEST_ID)], HARNESS_IMPORT) };
            const p = withFiles(files, () => runCheckIn(fx.root, repo, 'partial'));
            const t = withFiles(files, () => runCheckIn(fx.root, repo, 'triage'));
            const clean = (r: Res) => passes(r) && !r.lines.some((l) => l.includes(HARNESS));
            record('21 knownBug location: reserved ID at the harness path cannot orphan (with and without a claim)', clean(p) && clean(t), `partial exit ${p.code} ${firstFail(p, HARNESS)} | triage exit ${t.code} ${firstFail(t, HARNESS)}`);
        }
        {
            const MSG = 'the reserved self-test literal may not be used inside test/realpath/triage/';
            const a = withFiles({ 'test/realpath/triage/AUD-SRCB-002.test.ts': kbFile([kbCall(HARNESS_SELFTEST_ID, 'selftest-claim')]) }, () => runCheckIn(fx.root, repo, 'partial'));
            const b = withFiles({ 'test/realpath/triage/helpers/selftest.ts': kbFile([kbCall(HARNESS_SELFTEST_ID, 'selftest-claim')], "import { knownBug } from '../../harness/knownBug';") }, () =>
                runCheckIn(fx.root, repo, 'partial'),
            );
            record(
                '22 knownBug location: reserved ID inside the triage folder fails (zone file and helper)',
                hasLine(a, 'test/realpath/triage/AUD-SRCB-002.test.ts', MSG) && hasLine(b, 'test/realpath/triage/helpers/selftest.ts', MSG),
                `${firstFail(a, MSG)} | ${firstFail(b, MSG)}`,
            );
        }
        {
            const root = confirmedRoot('23');
            const a = withFiles({ 'test/realpath/triage/not-a-finding.test.ts': kbFile([kbCall('AUD-SRCB-002', 'fixture-claim')]) }, () => runCheckIn(root, repo, 'partial'));
            const b = withFiles({ 'test/realpath/triage/AUD-SRC-999.test.ts': kbFile([kbCall('AUD-SRCB-002', 'fixture-claim')]) }, () => runCheckIn(root, repo, 'partial'));
            record(
                '23 knownBug location: real ID in a triage file not named for a finding fails and does not satisfy confirmed',
                hasLine(a, 'test/realpath/triage/not-a-finding.test.ts', OUTSIDE) && hasFail(a, NOCALL) && hasLine(b, 'test/realpath/triage/AUD-SRC-999.test.ts', OUTSIDE) && hasFail(b, NOCALL),
                `${firstFail(a, OUTSIDE)} | ${firstFail(b, OUTSIDE)}`,
            );
        }
        {
            const root = confirmedRoot('24');
            const H = 'test/realpath/triage/fixtures/helper.ts';
            const res = withFiles({ [H]: kbFile([kbCall('AUD-SRCB-002', 'fixture-claim')], "import { knownBug } from '../../harness/knownBug';") }, () => runCheckIn(root, repo, 'partial'));
            record('24 knownBug location: real ID in a triage helper fails and does not satisfy confirmed', hasLine(res, H, OUTSIDE) && hasFail(res, NOCALL), firstFail(res, OUTSIDE));
        }
        {
            const root = confirmedRoot('25');
            const A = 'test/realpath/triageLookalike.test.ts';
            const B = 'test/realpath/triage-old/AUD-SRCB-002.test.ts';
            const a = withFiles({ [A]: kbFile([kbCall('AUD-SRCB-002', 'fixture-claim')], HARNESS_IMPORT) }, () => runCheckIn(root, repo, 'partial'));
            const b = withFiles({ [B]: kbFile([kbCall('AUD-SRCB-002', 'fixture-claim')]) }, () => runCheckIn(root, repo, 'partial'));
            record('25 knownBug location: lookalike folder is outside the zone (real ID fails, does not satisfy confirmed)', hasLine(a, A, OUTSIDE) && hasFail(a, NOCALL) && hasLine(b, B, OUTSIDE) && hasFail(b, NOCALL), `${firstFail(a, OUTSIDE)} | ${firstFail(b, OUTSIDE)}`);
        }
        {
            const root = confirmedRoot('26');
            const S = 'test/realpath/scenarios/AUD-SRCB-002.test.ts';
            const O = 'test/realpath/ordering/AUD-SRCB-002.test.ts';
            const s = withFiles({ [S]: kbFile([kbCall('AUD-SRCB-002', 'fixture-claim')]) }, () => runCheckIn(root, repo, 'partial'));
            const o = withFiles({ [O]: kbFile([kbCall('AUD-SRCB-002', 'fixture-claim')]) }, () => runCheckIn(root, repo, 'partial'));
            record('26 knownBug location: real ID in scenarios or ordering fails and does not satisfy confirmed', hasLine(s, S, OUTSIDE) && hasFail(s, NOCALL) && hasLine(o, O, OUTSIDE) && hasFail(o, NOCALL), `${firstFail(s, OUTSIDE)} | ${firstFail(o, OUTSIDE)}`);
        }
        {
            const root = confirmedRoot('27');
            const res = withFiles({ 'test/realpath/triage/nested/AUD-SRCB-002.test.ts': kbFile([kbCall('AUD-SRCB-002', 'fixture-claim')], "import { knownBug } from '../../harness/knownBug';") }, () =>
                runCheckIn(root, repo, 'partial'),
            );
            record('27 knownBug location: nested triage test named for a finding counts', passes(res) && !res.lines.some((l) => l.includes(NOCALL)), `exit ${res.code} ${firstFail(res, 'FAIL')}`);
        }
        {
            const root = confirmedRoot('28');
            const Z = 'test/realpath/triage/AUD-SRCB-002.test.ts';
            const USE = 'use of the name knownBug other than a direct call';
            const alias = withFiles({ [Z]: `import { knownBug as k } from '../harness/knownBug';\nit('x', (ctx) => {\n    k(ctx, 'AUD-SRCB-002', { claim: 'a', correct: 1, observed: 2, actual: 2, expectedPlain: 'e', actualPlain: 'a' });\n});\n` }, () =>
                runCheckIn(root, repo, 'partial'),
            );
            const value = withFiles({ [Z]: `import { knownBug } from '../harness/knownBug';\nconst k = knownBug;\nit('x', (ctx) => {\n    k(ctx, 'AUD-SRCB-002', { claim: 'a', correct: 1, observed: 2, actual: 2, expectedPlain: 'e', actualPlain: 'a' });\n});\n` }, () =>
                runCheckIn(root, repo, 'partial'),
            );
            const ns = withFiles({ [Z]: `import * as m from '../harness/knownBug';\nit('x', (ctx) => {\n    m.knownBug(ctx, 'AUD-SRCB-002', { claim: 'a', correct: 1, observed: 2, actual: 2, expectedPlain: 'e', actualPlain: 'a' });\n});\n` }, () =>
                runCheckIn(root, repo, 'partial'),
            );
            const reexp = withFiles({ 'test/realpath/harness/index.ts': `export { knownBug } from './knownBug';\n` }, () => runCheckIn(fx.root, repo, 'partial'));
            record(
                '28 knownBug location: an alias or namespace import fails (import as, const alias, import * as, re-export)',
                hasLine(alias, Z, USE) && hasFail(alias, NOCALL) && hasLine(value, Z, USE) && hasFail(value, NOCALL) && hasLine(ns, Z, 'namespace import of the knownBug module') && hasLine(ns, Z, USE) && hasFail(ns, NOCALL) &&
                    hasLine(reexp, 'test/realpath/harness/index.ts', 're-export of the knownBug module'),
                `${firstFail(alias, USE)} | ${firstFail(value, USE)} | ${firstFail(ns, 'namespace')} | ${firstFail(reexp, 're-export')}`,
            );
        }
        {
            const MSG = "knownBug's second argument must be a string literal";
            const Z = 'test/realpath/triage/AUD-SRCB-002.test.ts';
            const O = 'test/realpath/elsewhere.test.ts';
            const body = ["const id = 'AUD-SRCB-002';", "knownBug(ctx, id, { claim: 'a', correct: 1, observed: 2, actual: 2, expectedPlain: 'e', actualPlain: 'a' });"];
            const z = withFiles({ [Z]: kbFile(body) }, () => runCheckIn(fx.root, repo, 'partial'));
            const o = withFiles({ [O]: kbFile(body, HARNESS_IMPORT) }, () => runCheckIn(fx.root, repo, 'partial'));
            record('29 knownBug location: non-literal ID fails, inside and outside the zone', hasLine(z, Z, MSG) && hasLine(o, O, MSG), `${firstFail(z, MSG)} | ${firstFail(o, MSG)}`);
        }
        record('30 knownBug location: reserved ID is not a finding ID', !ID_RE.finding.test(HARNESS_SELFTEST_ID), `ID_RE.finding.test(${HARNESS_SELFTEST_ID}) = ${ID_RE.finding.test(HARNESS_SELFTEST_ID)}`);

        // Corrected fixture passes every stage
        const stages = STAGES.map((st) => ({ st, res: runCheckIn(fx.root, repo, st) }));
        const allPass = stages.every((x) => passes(x.res) && !x.res.lines.some((l) => l.startsWith('PENDING ')));
        record(
            'FX corrected fixture passes partial, triage, consolidation and final with no PENDING',
            allPass,
            stages.map((x) => `${x.st}=${x.res.code}${passes(x.res) ? '' : ' ' + firstFail(x.res, 'FAIL')}`).join(' '),
        );
        // Render is byte-deterministic and independent of the output folder
        {
            const o1 = path.join(fx.tmp, 'render1');
            const o2 = path.join(fx.tmp, 'render2', 'nested');
            const io1 = captureIo();
            const io2 = captureIo();
            const c1 = runRender(['--root', fx.root, '--repo', repo, '--out', o1], io1);
            const c2 = runRender(['--root', fx.root, '--repo', repo, '--out', o2], io2);
            const same = (n: string) => fs.existsSync(path.join(o1, n)) && fs.readFileSync(path.join(o1, n)).equals(fs.readFileSync(path.join(o2, n)));
            const text = c1 === 0 ? fs.readFileSync(path.join(o1, 'AUDIT-FINDINGS.md'), 'utf8') : '';
            const dec = c1 === 0 ? fs.readFileSync(path.join(o1, 'OPERATOR-DECISIONS.md'), 'utf8') : '';
            const content = ['ESC-PRE-01', 'AUD-RAIL-001', 'PN-001', '| RC-10 |'].every((s) => text.includes(s)) && dec.includes('OD-21') && !text.includes(fx.tmp) && !text.includes(fx.tmp.replace(/\\/g, '/'));
            record('RD render.ts is byte-identical across runs and output folders', c1 === 0 && c2 === 0 && same('AUDIT-FINDINGS.md') && same('OPERATOR-DECISIONS.md') && content, `exit ${c1}/${c2}`);
        }
    } catch (e) {
        record('XX self-test crashed', false, e instanceof Error ? e.stack ?? e.message : String(e));
    } finally {
        fs.rmSync(fx.tmp, { recursive: true, force: true });
    }
    for (const r of results) io.out(`${r.ok ? 'PASS' : 'FAIL'} case ${r.name} :: ${r.detail}`);
    const cases = results.filter((r) => /^\d\d /.test(r.name));
    const ok = results.every((r) => r.ok) && cases.length >= 14;
    io.out(`SELF-TEST: ${ok ? 'PASS' : 'FAIL'} ${results.filter((r) => r.ok).length}/${results.length} (${cases.length} failure cases, corrected fixture, render determinism)`);
    return ok ? 0 : 1;
}

if (require.main === module) {
    process.exitCode = run(process.argv.slice(2));
}
