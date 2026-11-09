// .planning/audit/tools/assign-cards.ts
//
// Phase 22 / Plan 22-28 (AUDIT-05; review concern L639@e2e59f6) - the one tool
// that numbers new decision cards. It reads every decisions/proposed/*.json
// that has none of assigned_id, merged_into or linked_od, orders them
// deterministically (slice order, then proposed number), and gives each the
// next OD number after the highest one already used (OD-26 on the first run).
//
// It is safe to re-run, because 22-29 calls it again after the re-audit:
//   - an assignment is never changed; only unnumbered proposals are numbered
//   - a second run with no new proposal writes no file
//   - a crash part-way is repaired on the next run: each OD-NN.json records
//     proposed_from, so a card written before its proposal was marked is matched
//     back to that proposal instead of being numbered twice
//
// References follow the numbering. A finding's od_ref or external_od_refs id,
// a threshold row's od_ref, and every mention of a proposed id in the text of a
// numbered card are rewritten to the card that now owns the decision (the
// assigned id, or the target of merged_into / linked_od). Thresholds files may
// be a bare array or {rows, discovery} (PROTOCOL.md section 3); owner_phase is
// left exactly as written.
//
// Reads and writes only JSON under the register root. It never reads .env, never
// opens data/ and loads no native module.

if (process.versions.modules !== '127') {
    process.stderr.write(
        `assign-cards: requires Node 22.16.0 (ABI 127); this is Node ${process.version} ` +
            `(ABI ${process.versions.modules}). Run it with ` +
            `/c/Users/jackc/AppData/Local/nvm/v22.16.0/node.exe (D-21).\n`,
    );
    process.exit(2);
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cmp, consoleIo, ID_RE, Io, listJson, parseArgs, readJson, RegFile, toJson, UsageError, writeAtomic } from './lib';

const SPEC = { root: 'string', 'self-test': 'bool', help: 'bool' } as const;

/** The numbering order required by plan 22-28; any other slice sorts after these, by name. */
export const SLICE_ORDER = ['BUY', 'EXIT', 'ANTIRUG', 'TX', 'DB', 'API', 'DASH', 'TESTU', 'TESTI', 'SCRIPTS', 'CONTRACTS', 'ROOT', 'REAUDIT', 'TESTQ'];

/** The highest OD number reserved for the research cards; new cards start after it. */
const LAST_RESEARCH_OD = 25;

export interface Assignment {
    proposed_id: string;
    assigned_id: string;
    slice: string;
    title: string;
}

export interface Result {
    problems: string[];
    assigned: Assignment[];
    written: string[];
}

function odNumber(id: unknown): number | null {
    const m = ID_RE.card.exec(String(id));
    return m ? Number(m[1]) : null;
}

function proposalParts(id: string): { slice: string; num: number } {
    const m = ID_RE.proposed.exec(id);
    if (!m) throw new Error(`'${id}' is not a proposed card id (<SLICE>-NN)`);
    return { slice: m[1], num: Number(m[2]) };
}

/** Slice order from the plan, then proposed number; unlisted slices sort last, by name. */
export function compareProposals(a: string, b: string): number {
    const A = proposalParts(a);
    const B = proposalParts(b);
    const rank = (s: string) => {
        const i = SLICE_ORDER.indexOf(s);
        return i < 0 ? SLICE_ORDER.length : i;
    };
    return rank(A.slice) - rank(B.slice) || cmp(A.slice, B.slice) || A.num - B.num;
}

function unreadable(files: RegFile[]): string[] {
    return files.filter((f) => f.error || f.data === null || typeof f.data !== 'object').map((f) => `${f.rel}: unreadable (${f.error ?? 'not an object'})`);
}

/** Writes only when the parsed content differs, so an unchanged file keeps its bytes. */
function writeIfChanged(root: string, rel: string, data: unknown, before: unknown, written: string[]): void {
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(data)) return;
    writeAtomic(path.join(root, ...rel.split('/')), toJson(data));
    written.push(rel);
}

/** Follows merged_into / linked_od to the card that owns the decision. Null if there is none yet. */
function resolveOwner(id: string, byId: Map<string, any>, problems: string[]): string | null {
    const seen = new Set<string>();
    let cur = id;
    for (;;) {
        if (seen.has(cur)) {
            problems.push(`merged_into cycle through ${[...seen].join(' -> ')}`);
            return null;
        }
        seen.add(cur);
        const d = byId.get(cur);
        if (!d) return null;
        if (d.assigned_id) return String(d.assigned_id);
        if (d.linked_od) return String(d.linked_od);
        if (!d.merged_into) return null;
        const next = String(d.merged_into);
        if (ID_RE.card.test(next)) return next;
        cur = next;
    }
}

/** Replaces whole-token mentions only: ESC-BUY-01, TH-BUY-01 and codex-BUY-12 never match BUY-01. */
export function buildRewriter(map: Map<string, string>): (s: string) => string {
    if (map.size === 0) return (s) => s;
    const alternatives = [...map.keys()].sort((a, b) => b.length - a.length || cmp(a, b)).join('|');
    const re = new RegExp(`(?<![A-Za-z0-9_-])(?:${alternatives})(?![A-Za-z0-9_-])`, 'g');
    return (s) => s.replace(re, (m) => map.get(m) as string);
}

function rewriteDeep(v: any, rewrite: (s: string) => string, skip: Set<string>): any {
    if (typeof v === 'string') return rewrite(v);
    if (Array.isArray(v)) return v.map((x) => rewriteDeep(x, rewrite, skip));
    if (v && typeof v === 'object') {
        const out: any = {};
        for (const k of Object.keys(v)) out[k] = skip.has(k) ? v[k] : rewriteDeep(v[k], rewrite, skip);
        return out;
    }
    return v;
}

export function assign(root: string): Result {
    const written: string[] = [];
    const problems: string[] = [];
    const proposals = listJson(root, 'decisions/proposed');
    const cards = listJson(root, 'decisions');
    const findings = listJson(root, 'findings');
    const thresholds = listJson(root, 'thresholds');
    problems.push(...unreadable([...proposals, ...cards, ...findings, ...thresholds]));
    if (problems.length) return { problems, assigned: [], written };

    const byId = new Map<string, any>(proposals.map((f) => [String(f.data.id), f.data]));
    const cardIds = new Set(cards.map((f) => String(f.data.id)));
    const consolidationRel = 'CONSOLIDATION.json';
    const consolidationPath = path.join(root, consolidationRel);
    const consolidation = fs.existsSync(consolidationPath) ? readJson(consolidationPath, consolidationRel) : null;
    if (consolidation?.error) return { problems: [`${consolidationRel}: unreadable (${consolidation.error})`], assigned: [], written };

    const owners = new Map<string, string>();
    for (const f of proposals) {
        const d = f.data;
        const set = ['assigned_id', 'merged_into', 'linked_od'].filter((k) => d[k]);
        if (set.length > 1) problems.push(`${f.rel}: has ${set.join(' and ')}; a proposal has one outcome`);
        if (d.assigned_id && !ID_RE.card.test(String(d.assigned_id))) problems.push(`${f.rel}: assigned_id '${d.assigned_id}' is not OD-N`);
        if (d.linked_od && !cardIds.has(String(d.linked_od))) problems.push(`${f.rel}: linked_od ${d.linked_od} has no decisions/${d.linked_od}.json`);
        if (d.merged_into) {
            const target = String(d.merged_into);
            if (!(cardIds.has(target) || byId.has(target))) problems.push(`${f.rel}: merged_into ${target} names no card`);
        }
    }
    const usedBy = new Map<string, string>();
    for (const f of proposals) {
        const a = f.data.assigned_id;
        if (!a) continue;
        if (usedBy.has(a)) problems.push(`${a} is assigned to both ${usedBy.get(a)} and ${f.data.id}`);
        usedBy.set(a, f.data.id);
    }
    if (problems.length) return { problems, assigned: [], written };

    // Repair a run that wrote a card but stopped before marking its proposal.
    for (const f of cards) {
        const from = f.data.proposed_from;
        if (typeof from !== 'string') continue;
        const p = byId.get(from);
        if (p && !p.assigned_id && !p.merged_into && !p.linked_od) p.assigned_id = f.data.id;
    }
    for (const f of proposals) writeIfChanged(root, f.rel, f.data, readJson(f.abs, f.rel).data, written);

    let highest = LAST_RESEARCH_OD;
    for (const f of cards) highest = Math.max(highest, odNumber(f.data.id) ?? 0);
    for (const f of proposals) highest = Math.max(highest, odNumber(f.data.assigned_id) ?? 0);

    const pending = proposals
        .filter((f) => !f.data.assigned_id && !f.data.merged_into && !f.data.linked_od)
        .sort((a, b) => compareProposals(String(a.data.id), String(b.data.id)));
    const assigned: Assignment[] = [];
    for (const f of pending) {
        const proposedId = String(f.data.id);
        const assignedId = `OD-${++highest}`;
        const card: any = { ...f.data, id: assignedId, proposed_from: proposedId };
        writeIfChanged(root, `decisions/${assignedId}.json`, card, undefined, written);
        f.data.assigned_id = assignedId;
        writeIfChanged(root, f.rel, f.data, undefined, written);
        assigned.push({ proposed_id: proposedId, assigned_id: assignedId, slice: proposalParts(proposedId).slice, title: String(f.data.title) });
    }

    // Every proposal now has an owner or is a problem; rewrite references to it.
    const refMap = new Map<string, string>();
    for (const f of proposals) {
        const owner = resolveOwner(String(f.data.id), byId, problems);
        if (owner) refMap.set(String(f.data.id), owner);
        else problems.push(`${f.rel}: resolves to no card`);
    }
    if (problems.length) return { problems, assigned, written };
    const mapped = (id: unknown) => (typeof id === 'string' && refMap.has(id) ? refMap.get(id) : id);

    for (const f of findings) {
        const next = JSON.parse(JSON.stringify(f.data));
        next.od_ref = mapped(next.od_ref);
        if (!('od_ref' in f.data)) delete next.od_ref;
        if (Array.isArray(next.external_od_refs)) for (const x of next.external_od_refs) if (x && typeof x === 'object') x.id = mapped(x.id);
        writeIfChanged(root, f.rel, next, f.data, written);
    }

    for (const f of thresholds) {
        const next = JSON.parse(JSON.stringify(f.data));
        const rows: any[] = Array.isArray(next) ? next : Array.isArray(next.rows) ? next.rows : [];
        for (const row of rows) if (row && typeof row === 'object' && 'od_ref' in row) row.od_ref = mapped(row.od_ref);
        writeIfChanged(root, f.rel, next, f.data, written);
    }

    // Numbered cards are what the operator reads: mentions of a proposed id there
    // follow the numbering. The operator's own words (operator_input, decided) are
    // never touched. Findings and escalation records keep their wording; the table
    // in OPERATOR-DECISIONS.md maps old ids to new ones.
    const rewrite = buildRewriter(refMap);
    const skip = new Set(['id', 'proposed_from', 'operator_input', 'decided']);
    for (const f of listJson(root, 'decisions')) writeIfChanged(root, f.rel, rewriteDeep(f.data, rewrite, skip), f.data, written);

    // Append assignments, including any a crashed run did not get to record.
    const before = consolidation?.data;
    const doc: any = before ? JSON.parse(JSON.stringify(before)) : {};
    const log: Assignment[] = Array.isArray(doc.card_assignments) ? doc.card_assignments : [];
    const logged = new Set(log.map((x) => x.proposed_id));
    const all = proposals.filter((f) => f.data.assigned_id).sort((a, b) => odNumber(a.data.assigned_id)! - odNumber(b.data.assigned_id)!);
    for (const f of all) {
        const id = String(f.data.id);
        if (logged.has(id)) continue;
        log.push({ proposed_id: id, assigned_id: String(f.data.assigned_id), slice: proposalParts(id).slice, title: String(f.data.title) });
    }
    doc.card_assignments = log;
    writeIfChanged(root, consolidationRel, doc, before, written);

    return { problems, assigned, written };
}

// ---------------------------------------------------------------------------
// Self-test: a throwaway register in the temp folder
// ---------------------------------------------------------------------------

function hashTree(dir: string): string {
    const out: string[] = [];
    const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name))) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else out.push(`${path.relative(dir, p)}\u0000${fs.readFileSync(p).toString('base64')}`);
        }
    };
    walk(dir);
    return out.join('\n');
}

function selfTest(io: Io): number {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assign-cards-'));
    const fails: string[] = [];
    const ok = (cond: boolean, what: string) => {
        if (!cond) fails.push(what);
    };
    const put = (rel: string, data: unknown) => {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), toJson(data));
    };
    const get = (rel: string) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
    const card = (id: string, extra: object = {}) => ({ id, title: `Card ${id}`, area: 'BUY', capital: true, status: 'open', options: [], keep_current_option_id: 'k', recommendation: 'r', default: 'd', behavior_impact: 'b', findings: [], decided: null, needed_by: 'n', ...extra });
    const finding = (id: string, od: string | null, extra: object = {}) => ({ id, od_ref: od, ...extra });
    try {
        put('decisions/OD-25.json', card('OD-25', { recommendation: 'After card BUY-01 is decided. ESC-BUY-01 and TH-BUY-01 stay as written.' }));
        put('decisions/proposed/ANTIRUG-01.json', card('ANTIRUG-01', { recommendation: 'Decide with BUY-01.' }));
        put('decisions/proposed/BUY-01.json', card('BUY-01', { recommendation: 'Decide with ANTIRUG-01, not codex-BUY-01.', related_cards: ['ANTIRUG-01'], operator_input: 'Tie this to ANTIRUG-01.' }));
        put('decisions/proposed/BUY-02.json', card('BUY-02', { merged_into: 'BUY-01' }));
        put('decisions/proposed/DB-01.json', card('DB-01', { linked_od: 'OD-25' }));
        put('findings/AUD-BUY-001.json', finding('AUD-BUY-001', 'BUY-01', { external_od_refs: [{ id: 'OD-19', owner_phase: 'Phase 32' }], recommendation: 'See card BUY-01.' }));
        put('findings/AUD-BUY-002.json', finding('AUD-BUY-002', 'BUY-02'));
        put('findings/AUD-ANTIRUG-001.json', finding('AUD-ANTIRUG-001', 'ANTIRUG-01'));
        put('findings/AUD-DB-001.json', finding('AUD-DB-001', 'DB-01'));
        put('findings/AUD-DB-002.json', finding('AUD-DB-002', null));
        put('thresholds/BUY.json', [{ id: 'TH-BUY-01', od_ref: 'BUY-01' }, { id: 'TH-BUY-02', od_ref: null }]);
        put('thresholds/EXIT.json', { rows: [{ id: 'TH-EXIT-01', od_ref: 'ANTIRUG-01' }], discovery: { env_reads: [], constants: [] } });
        put('CONSOLIDATION.json', { plan: 'fixture', card_assignments: [] });

        // First run numbers BUY before ANTIRUG (plan order, not alphabetical).
        const first = assign(dir);
        ok(first.problems.length === 0, `first run problems: ${first.problems.join('; ')}`);
        ok(first.assigned.map((a) => `${a.proposed_id}=${a.assigned_id}`).join(',') === 'BUY-01=OD-26,ANTIRUG-01=OD-27', `first run order: ${JSON.stringify(first.assigned)}`);
        ok(get('decisions/OD-26.json').proposed_from === 'BUY-01', 'OD-26 records proposed_from');
        ok(get('decisions/proposed/BUY-01.json').assigned_id === 'OD-26', 'assigned_id set on the proposal');
        ok(get('findings/AUD-BUY-001.json').od_ref === 'OD-26', 'finding od_ref follows assigned_id');
        ok(get('findings/AUD-BUY-001.json').recommendation === 'See card BUY-01.', 'finding text is left alone');
        ok(get('findings/AUD-BUY-001.json').external_od_refs[0].owner_phase === 'Phase 32', 'string owner_phase is preserved');
        ok(get('findings/AUD-BUY-002.json').od_ref === 'OD-26', 'merged proposal resolves to its target');
        ok(get('findings/AUD-DB-001.json').od_ref === 'OD-25', 'linked proposal resolves to the existing OD');
        ok(get('findings/AUD-DB-002.json').od_ref === null, 'null od_ref stays null');
        ok(get('thresholds/BUY.json')[0].od_ref === 'OD-26', 'bare-array thresholds rewritten');
        ok(get('thresholds/EXIT.json').rows[0].od_ref === 'OD-27', '{rows, discovery} thresholds rewritten');
        ok(Array.isArray(get('thresholds/EXIT.json').discovery.env_reads), 'discovery kept');
        ok(get('decisions/OD-26.json').recommendation === 'Decide with OD-27, not codex-BUY-01.', 'card text follows numbering and spares codex-BUY-01');
        ok(get('decisions/OD-26.json').related_cards[0] === 'OD-27', 'related_cards follows numbering');
        ok(get('decisions/OD-26.json').operator_input === 'Tie this to ANTIRUG-01.', 'operator words stay verbatim');
        ok(get('decisions/OD-25.json').recommendation === 'After card OD-26 is decided. ESC-BUY-01 and TH-BUY-01 stay as written.', 'existing card text updated; ESC and TH ids spared');
        ok(get('CONSOLIDATION.json').card_assignments.length === 2, 'assignments recorded');

        // A second run changes nothing, byte for byte.
        const h1 = hashTree(dir);
        const second = assign(dir);
        ok(second.problems.length === 0, `second run problems: ${second.problems.join('; ')}`);
        ok(second.assigned.length === 0 && second.written.length === 0, `second run wrote ${second.written.join(',')}`);
        ok(hashTree(dir) === h1, 'second run left the tree identical');

        // A later proposal continues the sequence and old numbers do not move.
        put('decisions/proposed/TX-01.json', card('TX-01'));
        put('findings/AUD-TX-001.json', finding('AUD-TX-001', 'TX-01'));
        const third = assign(dir);
        ok(third.assigned.map((a) => `${a.proposed_id}=${a.assigned_id}`).join(',') === 'TX-01=OD-28', `third run: ${JSON.stringify(third.assigned)}`);
        ok(get('decisions/OD-26.json').proposed_from === 'BUY-01' && get('decisions/OD-27.json').proposed_from === 'ANTIRUG-01', 'earlier assignments unchanged');
        ok(get('findings/AUD-TX-001.json').od_ref === 'OD-28', 'new finding follows new card');
        ok(get('CONSOLIDATION.json').card_assignments.length === 3, 'assignment appended');
        const h2 = hashTree(dir);
        ok(assign(dir).written.length === 0 && hashTree(dir) === h2, 'run after the addition is idempotent');

        // Crash repair: a card written but not marked is matched, not renumbered.
        const orphan = get('decisions/proposed/TX-01.json');
        delete orphan.assigned_id;
        put('decisions/proposed/TX-01.json', orphan);
        const repair = assign(dir);
        ok(repair.problems.length === 0 && repair.assigned.length === 0, `repair numbered a card: ${JSON.stringify(repair.assigned)}`);
        ok(get('decisions/proposed/TX-01.json').assigned_id === 'OD-28', 'repair restores assigned_id');

        // Bad input stops before any write.
        put('decisions/proposed/TX-02.json', card('TX-02', { linked_od: 'OD-20' }));
        const bad = assign(dir);
        ok(bad.problems.some((p) => p.includes('OD-20')), 'a link to a card with no file is refused');
    } catch (e) {
        fails.push(`crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    if (fails.length) {
        for (const f of fails) io.err(`self-test FAIL: ${f}`);
        return 1;
    }
    io.out('assign-cards self-test: PASS');
    return 0;
}

export function run(argv: string[], io: Io = consoleIo): number {
    try {
        const { flags, positional } = parseArgs(argv, SPEC as unknown as Record<string, 'string' | 'bool' | 'multi'>);
        if (flags.help) {
            io.out('usage: assign-cards.ts [--root <register dir>] [--self-test]');
            return 0;
        }
        if (positional.length) throw new UsageError(`unexpected argument '${positional[0]}'`);
        if (flags['self-test']) return selfTest(io);
        const root = path.resolve(typeof flags.root === 'string' ? flags.root : path.join(__dirname, '..'));
        const r = assign(root);
        for (const p of r.problems) io.err(`assign-cards: ${p}`);
        if (r.problems.length) return 1;
        for (const a of r.assigned) io.out(`ASSIGNED ${a.proposed_id} -> ${a.assigned_id}`);
        io.out(`DONE assigned=${r.assigned.length} files_written=${r.written.length}`);
        return 0;
    } catch (e) {
        if (e instanceof UsageError) {
            io.err(`assign-cards: ${e.message}`);
            return 2;
        }
        io.err(`assign-cards: crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        return 2;
    }
}

if (require.main === module) {
    process.exitCode = run(process.argv.slice(2));
}
