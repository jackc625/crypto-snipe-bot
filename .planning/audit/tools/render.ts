// .planning/audit/tools/render.ts
//
// Phase 22 / Plan 22-04 (D-15, AUDIT-01/03/04/05) - deterministic renderer for
// the human-readable register. Reads only the JSON files under the register
// root and writes AUDIT-FINDINGS.md and OPERATOR-DECISIONS.md. The output has
// no timestamps, no absolute paths and a fixed sort order, so two runs over the
// same JSON are byte-identical (check with cmp).
//
// Usage (Node 22.16.0, ABI 127; D-21):
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js .planning/audit/tools/render.ts \
//       [--root <register dir>] [--repo <git dir>] [--out <dir>]
//   --root  register root (default .planning/audit)
//   --out   output folder (default: the register root). Parallel audit plans
//           render into a temp folder to validate rendering only; 22-28 and
//           22-29 render and commit the canonical files.
// Exit 0 written, 1 a register file is unreadable (run check.ts), 2 crash/usage.

if (process.versions.modules !== '127') {
    process.stderr.write(
        `render: requires Node 22.16.0 (ABI 127); this is Node ${process.version} ` +
            `(ABI ${process.versions.modules}). Run it with ` +
            `/c/Users/jackc/AppData/Local/nvm/v22.16.0/node.exe (D-21).\n`,
    );
    process.exit(2);
}

import * as fs from 'fs';
import * as path from 'path';
import {
    Io,
    consoleIo,
    UsageError,
    parseArgs,
    locations,
    loadConfig,
    listJson,
    readJson,
    writeAtomic,
    cmp,
    stem,
    AREAS,
    CLASS_IDS,
    RC_IDS,
    SEVERITIES,
    RUBRIC,
    CAPITAL_TEXT,
    LIFECYCLE_TEXT,
    RegFile,
    Slice,
} from './lib';

const SPEC = { root: 'string', repo: 'string', out: 'string', help: 'bool' } as const;

/** Markdown table cell: no pipes or newlines may break the row. */
function c(v: unknown): string {
    if (v === null || v === undefined || v === '') return '-';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function inline(v: unknown): string {
    if (v === null || v === undefined || v === '') return 'none';
    if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ') : 'none';
    return typeof v === 'string' ? v.replace(/\r?\n/g, ' ') : JSON.stringify(v);
}

function code(v: unknown): string {
    return '`' + String(v).replace(/`/g, "'") + '`';
}

function sevRank(s: unknown): number {
    const i = SEVERITIES.indexOf(String(s));
    return i < 0 ? 99 : i;
}

function short(sha: unknown): string {
    return typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : inline(sha);
}

function summarizeItems(items: unknown): string {
    if (!Array.isArray(items) || !items.length) return 'none';
    if (items.length <= 4) return items.join(', ');
    return `${items.length} items (${items[0]} .. ${items[items.length - 1]})`;
}

interface Loaded {
    cfg: ReturnType<typeof loadConfig>;
    findings: RegFile[];
    escalations: RegFile[];
    notes: RegFile[];
    cards: RegFile[];
    proposed: RegFile[];
    ledgers: RegFile[];
    sweeps: RegFile[];
    contribs: RegFile[];
    thresholds: RegFile[];
    unreadable: RegFile[];
    root: string;
}

function load(root: string): Loaded {
    const cfg = loadConfig(root);
    const findings = listJson(root, 'findings');
    const escalations = listJson(root, 'escalations');
    const notes = listJson(root, 'process-notes');
    const cards = listJson(root, 'decisions');
    const proposed = listJson(root, 'decisions/proposed');
    const allSweep = listJson(root, 'sweep');
    const sweeps = allSweep.filter((f) => !stem(f.rel).startsWith('contrib-'));
    const contribs = allSweep.filter((f) => stem(f.rel).startsWith('contrib-'));
    const ledgers = listJson(root, 'ledger');
    const thresholds = listJson(root, 'thresholds');
    const unreadable = [cfg.base, cfg.slicesFile, cfg.scopeFile, cfg.classesFile, ...findings, ...escalations, ...notes, ...cards, ...proposed, ...allSweep, ...ledgers, ...thresholds].filter(
        (f) => f.error,
    );
    return { cfg, findings, escalations, notes, cards, proposed, ledgers, sweeps, contribs, thresholds, unreadable, root };
}

function className(L: Loaded, id: string): string {
    const cls = (L.cfg.classesFile.data?.classes ?? []).find((x: any) => x?.id === id);
    return cls ? `${id} (${cls.name})` : id;
}

function thresholdRows(f: RegFile): any[] {
    const d = f.data;
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.rows)) return d.rows;
    return [];
}

/** Merged sweep matrix: area -> class -> {ids, none, searches}. */
export function mergedSweep(L: { slices: Slice[]; sweeps: RegFile[]; contribs: RegFile[] }): Map<string, Map<string, { ids: Set<string>; none: boolean; searches: string[] }>> {
    const m = new Map<string, Map<string, { ids: Set<string>; none: boolean; searches: string[] }>>();
    for (const a of AREAS) {
        const row = new Map<string, { ids: Set<string>; none: boolean; searches: string[] }>();
        for (const k of CLASS_IDS) row.set(k, { ids: new Set(), none: false, searches: [] });
        m.set(a, row);
    }
    const bySlice = new Map(L.slices.map((s) => [s.slice, s]));
    for (const f of [...L.sweeps].sort((a, b) => cmp(a.rel, b.rel))) {
        const d = f.data;
        const s = bySlice.get(stem(f.rel));
        if (!d || !s || !s.capabilities?.sweep || !m.has(String(s.area))) continue;
        for (const k of CLASS_IDS) {
            const cell = d.cells?.[k];
            if (!cell) continue;
            const slot = m.get(String(s.area))!.get(k)!;
            if (Array.isArray(cell.result)) for (const id of cell.result) slot.ids.add(String(id));
            else if (cell.result === 'checked, none') slot.none = true;
            if (typeof cell.search === 'string' && cell.search) slot.searches.push(`${s.slice}: ${cell.search}`);
        }
    }
    for (const f of [...L.contribs].sort((a, b) => cmp(a.rel, b.rel))) {
        const d = f.data;
        for (const ct of Array.isArray(d?.contributions) ? d.contributions : []) {
            const slot = m.get(String(ct?.area))?.get(String(ct?.class));
            if (!slot) continue;
            for (const id of Array.isArray(ct.ids) ? ct.ids : []) slot.ids.add(String(id));
            if (!(Array.isArray(ct.ids) && ct.ids.length)) slot.none = true;
            if (typeof ct.search === 'string' && ct.search) slot.searches.push(`${stem(f.rel)}: ${ct.search}`);
        }
    }
    return m;
}

function renderFinding(L: Loaded, d: any, out: string[]): void {
    out.push(`##### ${d.id}: ${inline(d.title)}`, '');
    out.push(`- **Severity / capital impact / status:** ${inline(d.severity)} / ${inline(d.capital_impact)} / ${inline(d.status)}`);
    out.push(`- **Slice / origin:** ${inline(d.slice)} / ${inline(d.origin)}`);
    out.push(`- **Classes:** ${Array.isArray(d.classes) && d.classes.length ? d.classes.map((k: string) => className(L, k)).join(', ') : 'none'}`);
    if (Array.isArray(d.rc) && d.rc.length)
        out.push(`- **Research candidates:** ${d.rc.join(', ')} (research suggested ${inline(d.research_suggested_severity)})`);
    if (d.severity_rationale) out.push(`- **Severity rationale:** ${inline(d.severity_rationale)}`);
    out.push(`- **Files:** ${Array.isArray(d.files) && d.files.length ? d.files.map(code).join(', ') : 'none'}`);
    out.push('- **Evidence:**');
    for (const e of Array.isArray(d.evidence) ? d.evidence : []) out.push(`  - ${inline(e?.type)}: ${code(e?.ref)}${e?.note ? ' - ' + inline(e.note) : ''}`);
    out.push(`- **Sibling sites checked:** ${inline(d.sibling_sites_checked)}`);
    out.push(`- **Escalation:** ${inline(d.escalation_ref)}`);
    out.push(`- **Decision card:** ${inline(d.od_ref)}`);
    if (Array.isArray(d.external_od_refs) && d.external_od_refs.length)
        out.push(`- **External decision cards:** ${d.external_od_refs.map((x: any) => `${x?.id} (owner ${x?.owner_phase})`).join(', ')}`);
    if (d.duplicate_of) out.push(`- **Duplicate of:** ${d.duplicate_of}`);
    if (Array.isArray(d.related) && d.related.length) out.push(`- **Related:** ${d.related.join(', ')}`);
    out.push(`- **Tags:** ${inline(d.tags)}${d.secret_class ? ` (secret_class ${d.secret_class})` : ''}`);
    if (d.pre_phase_key) out.push(`- **Pre-phase key:** ${d.pre_phase_key}`);
    if (Array.isArray(d.traces) && d.traces.length) {
        out.push('- **Traces:**');
        for (const t of d.traces) out.push(`  - ${inline(t?.scenario)}: ${inline(t?.steps)} -> ${inline(t?.outcome)}`);
    }
    if (Array.isArray(d.sub_claims) && d.sub_claims.length) {
        out.push('- **Sub-claims:**');
        for (const s of d.sub_claims) out.push(`  - [${inline(s?.status)}] ${inline(s?.claim)} (evidence: ${inline(s?.evidence)})`);
    }
    if (d.affected_cases) out.push(`- **Affected cases:** ${inline(d.affected_cases)}`);
    if (d.escaped_regression) out.push(`- **Escaped regression:** ${inline(d.escaped_regression)}`);
    out.push(`- **Recommendation:** ${inline(d.recommendation)}`);
    out.push(`- **Reported by / found / audited at:** ${inline(d.reported_by)} / ${inline(d.found_date)} / ${short(d.audited_sha)}`);
    out.push('');
}

export function renderFindings(L: Loaded): string {
    const out: string[] = [];
    const slices = L.cfg.slices;
    const findings = L.findings.filter((f) => f.data && typeof f.data === 'object').map((f) => f.data);
    const escs = L.escalations.filter((f) => f.data).map((f) => f.data).sort((a: any, b: any) => cmp(String(a.id), String(b.id)));
    const sevCount = SEVERITIES.map((s) => `${s} ${findings.filter((d: any) => d.severity === s).length}`).join(', ');
    out.push('# Audit Findings Register (Phase 22)', '');
    out.push(
        'Generated by `.planning/audit/tools/render.ts` from the JSON files under `.planning/audit/`. Do not edit this file by hand: edit the JSON record and re-render. `.planning/audit/tools/check.ts` checks the JSON. The procedure every auditor follows is `.planning/audit/PROTOCOL.md`.',
        '',
    );
    out.push(`- **Audit base SHA:** ${code(L.cfg.baseSha)} (BASE.json; every slice audits the tracked files at this commit)`);
    out.push(`- **Findings:** ${findings.length} (${sevCount})`);
    out.push(`- **Escalation records:** ${escs.length}`);
    out.push(`- **Process notes:** ${L.notes.filter((f) => f.data).length}`);
    out.push('');
    out.push('## Severity rubric', '', '| Severity | Meaning |', '|---|---|');
    for (const r of RUBRIC) out.push(`| ${r.id} | ${c(r.text)} |`);
    out.push('', '## Capital-impact classes', '', '| Class | Meaning |', '|---|---|');
    for (const r of CAPITAL_TEXT) out.push(`| ${r.id} | ${c(r.text)} |`);
    out.push('', '## Lifecycle', '', LIFECYCLE_TEXT, '');
    out.push(
        'Escalation tiers (D-16): **immediate** for any S0, any finding tagged `rail` or `test-origin-db-row`, and any secret with `secret_class` non-public; **area-batch** for S1, presented when the area finishes; **pre-phase** for the items surfaced during plan-phase (D-23). Known-public secrets and scan records never escalate. Nothing is fixed in Phase 22 (NAC-13).',
        '',
    );

    out.push('## Escalation index', '');
    if (!escs.length) out.push('_No escalation records yet._', '');
    else {
        out.push('| Record | Date | Tier | Items | Resolved items | Ruling | Phase continued | State |', '|---|---|---|---|---|---|---|---|');
        for (const e of escs) {
            const state = e.resolution?.status
                ? `${e.resolution.status}${e.resolution.outcome ? ' (' + e.resolution.outcome + ')' : ''}`
                : e.operator_response === null || e.operator_response === undefined
                  ? 'acknowledged (see evidence)'
                  : 'operator responded';
            out.push(
                `| ${c(e.id)} | ${c(e.date)} | ${c(e.tier)} | ${c(summarizeItems(e.items))} | ${c(summarizeItems(e.resolved_items))} | ${c(e.ruling)} | ${c(String(e.phase_continued))} | ${c(state)} |`,
            );
        }
        out.push('');
        for (const e of escs) {
            out.push(`### ${e.id}`, '');
            out.push(`- **Date / tier:** ${inline(e.date)} / ${inline(e.tier)}${Array.isArray(e.tags) && e.tags.length ? ` (tags: ${e.tags.join(', ')})` : ''}`);
            out.push(`- **Items:** ${summarizeItems(e.items)}`);
            out.push(`- **Resolved items:** ${summarizeItems(e.resolved_items)}`);
            out.push(`- **Summary:** ${inline(e.summary)}`);
            out.push(`- **Presented at:** ${inline(e.presented_at)}`);
            out.push(`- **Operator response:** ${e.operator_response === null || e.operator_response === undefined ? 'none recorded (null)' : inline(e.operator_response)}`);
            if (e.acknowledgement_evidence) out.push(`- **Acknowledgement evidence:** ${inline(e.acknowledgement_evidence)}`);
            out.push(`- **Ruling:** ${inline(e.ruling)}`);
            out.push(`- **Phase continued:** ${inline(String(e.phase_continued))}`);
            if (e.rediscovery_of) out.push(`- **Rediscovery of:** ${e.rediscovery_of}`);
            if (e.resolution?.statement) out.push(`- **Resolution:** ${inline(e.resolution.status)}: ${inline(e.resolution.statement)}`);
            out.push('');
        }
    }

    out.push('## Findings', '');
    const areaOrder = [...AREAS, ...[...new Set(findings.map((d: any) => String(d.area)))].filter((a) => !(AREAS as readonly string[]).includes(a)).sort(cmp)];
    for (const area of areaOrder) {
        out.push(`### Area: ${area}`, '');
        const inArea = findings.filter((d: any) => String(d.area) === area);
        if (!inArea.length) {
            out.push('_No findings recorded yet._', '');
            continue;
        }
        for (const sev of [...SEVERITIES, 'other']) {
            const group = inArea
                .filter((d: any) => (sev === 'other' ? sevRank(d.severity) === 99 : d.severity === sev))
                .sort((a: any, b: any) => cmp(String(a.id), String(b.id)));
            if (!group.length) continue;
            out.push(`#### ${sev}`, '');
            for (const d of group) renderFinding(L, d, out);
        }
    }

    out.push('## Research candidate map (RC-01..RC-28)', '');
    out.push('| RC | Owning slice | Entries | Statuses |', '|---|---|---|---|');
    for (const rc of RC_IDS) {
        const n = Number(rc.slice(3));
        const owner = slices.find((s) => Array.isArray(s.owned_rc) && s.owned_rc.includes(n));
        const carriers = findings.filter((d: any) => Array.isArray(d.rc) && d.rc.includes(rc)).sort((a: any, b: any) => cmp(String(a.id), String(b.id)));
        out.push(
            `| ${rc} | ${c(owner?.slice)} | ${carriers.length ? c(carriers.map((d: any) => d.id + (d.duplicate_of ? ' (dup of ' + d.duplicate_of + ')' : '')).join(', ')) : 'UNMAPPED'} | ${c([...new Set(carriers.map((d: any) => String(d.status)))].sort(cmp).join(', '))} |`,
        );
    }
    out.push('');
    out.push('## Section-C candidates (research summary, lower priority)', '', '| ID | Candidate | Reference | Owning slice |', '|---|---|---|---|');
    const sc = slices.flatMap((s) => (Array.isArray(s.owned_section_c) ? s.owned_section_c.map((x) => ({ ...x, owner: s.slice })) : [])).sort((a, b) => cmp(a.id, b.id));
    for (const x of sc) out.push(`| ${x.id} | ${c(x.candidate)} | ${c(x.ref)} | ${x.owner} |`);
    out.push('');

    out.push('## Sweep matrix (20 classes x 5 areas)', '');
    out.push('Cells list finding IDs, `checked, none` (searched, nothing found), or `pending` (no slice has recorded this cell yet).', '');
    const m = mergedSweep({ slices, sweeps: L.sweeps, contribs: L.contribs });
    out.push(`| Class | ${AREAS.join(' | ')} |`, `|---|${AREAS.map(() => '---').join('|')}|`);
    for (const k of CLASS_IDS) {
        const cells = AREAS.map((a) => {
            const slot = m.get(a)!.get(k)!;
            if (slot.ids.size) return c([...slot.ids].sort(cmp).join(', '));
            if (slot.none) return 'checked, none';
            return 'pending';
        });
        out.push(`| ${c(className(L, k))} | ${cells.join(' | ')} |`);
    }
    out.push('', '### Sweep searches', '');
    let anySearch = false;
    for (const a of AREAS)
        for (const k of CLASS_IDS) {
            const slot = m.get(a)!.get(k)!;
            if (!slot.searches.length) continue;
            anySearch = true;
            out.push(`- **${a} x ${k}:** ${slot.searches.map((s) => s.replace(/\r?\n/g, ' ')).join('; ')}`);
        }
    if (!anySearch) out.push('_No sweep searches recorded yet._');
    out.push('');

    out.push('## Per-file coverage ledger', '');
    const ledgerByName = new Map(L.ledgers.map((f) => [stem(f.rel), f]));
    for (const s of slices.filter((x) => x.capabilities?.ledger)) {
        out.push(`### ${s.slice} (${s.count_at_base} files at base ${short(L.cfg.baseSha)}; plan ${s.plan})`, '');
        const f = ledgerByName.get(s.slice);
        if (!f || !Array.isArray(f.data)) {
            out.push(`_Ledger not yet written (plan ${s.plan})._`, '');
            continue;
        }
        out.push('| File | Audited SHA | Findings | Notes |', '|---|---|---|---|');
        for (const r of [...f.data].sort((a: any, b: any) => cmp(String(a?.path), String(b?.path)))) {
            const notes: string[] = [];
            if (r?.quality_label)
                notes.push(
                    `quality: mocks_mechanism=${inline(r.quality_label.mocks_mechanism)}, hollow=${inline(r.quality_label.hollow_assertions)}, real_state=${inline(r.quality_label.can_reach_real_state)}`,
                );
            if (r?.fixture_provenance) notes.push(`fixture: ${r.fixture_provenance}`);
            if (Array.isArray(r?.re_audit) && r.re_audit.length) notes.push(`re-audit: ${r.re_audit.map((x: any) => `${short(x?.from_sha)}..${short(x?.to_sha)} ${inline(x?.findings)}`).join('; ')}`);
            out.push(`| ${c(r?.path)} | ${short(r?.audited_sha)} | ${c(inline(r?.findings))} | ${c(notes.join('; '))} |`);
        }
        out.push('');
    }

    out.push('## Thresholds inventory (money and timing)', '');
    const thByName = new Map(L.thresholds.map((f) => [stem(f.rel), f]));
    for (const s of slices.filter((x) => x.capabilities?.thresholds)) {
        out.push(`### ${s.slice}`, '');
        const f = thByName.get(s.slice);
        const rows = f ? thresholdRows(f) : [];
        if (!rows.length) {
            out.push(`_Inventory not yet written (plan ${s.plan})._`, '');
            continue;
        }
        for (const r of [...rows].sort((a: any, b: any) => cmp(String(a?.id), String(b?.id)))) {
            out.push(`#### ${inline(r?.id)}: ${inline(r?.name)}`, '');
            out.push(`- **Current value / units / representation:** ${inline(r?.current_value)} / ${inline(r?.units)} / ${inline(r?.representation)}`);
            out.push(`- **Comparison:** ${inline(r?.comparison)}`);
            out.push(`- **Definition sites:** ${inline(r?.definition_sites)}`);
            out.push(`- **Env key / hard-coded:** ${inline(r?.env_key)} / ${inline(String(r?.hardcoded))}`);
            out.push(`- **Effective when unset / '' / non-numeric:** ${inline(r?.effective_unset)} / ${inline(r?.effective_empty)} / ${inline(r?.effective_non_numeric)}`);
            out.push(`- **Rationale:** ${inline(r?.rationale)}`);
            out.push(`- **Overlap:** ${inline(r?.overlap)}`);
            out.push(`- **Flags:** ${inline(r?.flags)}`);
            out.push(`- **Recommendation:** ${inline(r?.recommendation)}`);
            out.push(`- **Decision card:** ${inline(r?.od_ref)}`);
            out.push('');
        }
    }

    out.push('## Secret scan summary', '');
    const nac01 = readJson(path.join(L.root, 'inputs', 'nac01-backup-scan.json'), 'inputs/nac01-backup-scan.json');
    if (nac01.data) {
        const d = nac01.data;
        out.push(
            `- **Backup-copy scan (NAC-01, inputs/nac01-backup-scan.json):** ${inline(d.tool)} ${inline(d.version)}; targets ${Array.isArray(d.targets) ? d.targets.map((t: any) => t?.name).join(', ') : 'none'}; hits ${Array.isArray(d.hits) ? d.hits.length : 0}; non-public ${inline(d.non_public_count)}; known-public ${inline(d.known_public_count)}; public-address ${inline(d.public_address_count)}.`,
        );
    } else out.push('- **Backup-copy scan (NAC-01):** _not recorded._');
    const hist = readJson(path.join(L.root, 'inputs', 'history-scan.json'), 'inputs/history-scan.json');
    if (hist.data) {
        const d = hist.data;
        const hits = Array.isArray(d.hits) ? d.hits : [];
        const byClass = [...new Set<string>(hits.map((h: any) => String(h?.classification)))].sort(cmp).map((k) => `${k} ${hits.filter((h: any) => String(h?.classification) === k).length}`);
        out.push(`- **Full-history scan (AC-35, inputs/history-scan.json):** ${inline(d.tool)} ${inline(d.version)}; hits ${hits.length}${byClass.length ? ' (' + byClass.join(', ') + ')' : ''}.`);
    } else out.push('- **Full-history scan (AC-35):** _not yet recorded (plan 22-26)._');
    out.push('');

    out.push('## Signing-site census', '');
    const census = readJson(path.join(L.root, 'census', 'signing-sites.json'), 'census/signing-sites.json');
    if (census.data) {
        const d = census.data;
        out.push(`- **Transaction-signing sites (N):** ${inline(d.total_tx_signing)}`);
        out.push(`- **Message-signing sites:** ${inline(d.total_message_signing)}`);
        if (d.by_lock_status && typeof d.by_lock_status === 'object')
            out.push(`- **By lock status:** ${Object.keys(d.by_lock_status).sort(cmp).map((k) => `${k} ${inline(d.by_lock_status[k])}`).join(', ')}`);
        out.push(`- **Method:** ${inline(d.method)}`);
    } else out.push('_Not yet recorded (plan 22-26)._');
    out.push('');

    out.push('## Process notes', '');
    const notes = L.notes.filter((f) => f.data).map((f) => f.data).sort((a: any, b: any) => cmp(String(a.id), String(b.id)));
    if (!notes.length) out.push('_None._', '');
    for (const n of notes) {
        out.push(`### ${n.id} (${inline(n.date)})`, '');
        out.push(inline(n.description), '');
        out.push(`- **Evidence:** ${Array.isArray(n.evidence) ? n.evidence.map((e: any) => (typeof e === 'string' ? e : `${inline(e?.type)}: ${inline(e?.ref)}${e?.note ? ' - ' + inline(e.note) : ''}`)).join('; ') : inline(n.evidence)}`);
        out.push('');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

function renderCard(L: Loaded, d: any, out: string[], level: string): void {
    out.push(`${level} ${d.id}: ${inline(d.title)}`, '');
    out.push(`- **Area / capital / status:** ${inline(d.area)} / ${d.capital ? 'capital' : 'non-capital'} / ${inline(d.status)}`);
    out.push(`- **Needed by:** ${inline(d.needed_by)}`);
    out.push(`- **Findings:** ${inline(d.findings)}`);
    out.push('', '| Option | Name | Behavior impact | Risk |', '|---|---|---|---|');
    for (const o of Array.isArray(d.options) ? d.options : [])
        out.push(`| ${c(o?.id)}${o?.id === d.keep_current_option_id ? ' (keep current)' : ''} | ${c(o?.name)} | ${c(o?.behavior_impact)} | ${c(o?.risk)} |`);
    out.push('');
    out.push(`- **Recommendation:** ${inline(d.recommendation)}`);
    out.push(`- **Default if undecided:** ${inline(d.default)}`);
    out.push(`- **Behavior impact:** ${inline(d.behavior_impact)}`);
    if (d.operator_input) out.push(`- **Operator input (preference, not a decision):** ${inline(d.operator_input)}`);
    if (d.decided) out.push(`- **Decided:** ${inline(d.decided.date)}: ${inline(d.decided.ruling)}`);
    if (d.assigned_id) out.push(`- **Assigned id:** ${d.assigned_id}`);
    if (d.merged_into) out.push(`- **Merged into:** ${d.merged_into}`);
    if (d.linked_od) out.push(`- **Linked to existing card:** ${d.linked_od}`);
    out.push('');
}

function odNum(id: unknown): number {
    const m = /^OD-(\d+)$/.exec(String(id));
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

export function renderDecisions(L: Loaded): string {
    const out: string[] = [];
    const cards = L.cards.filter((f) => f.data).map((f) => f.data).sort((a: any, b: any) => odNum(a.id) - odNum(b.id) || cmp(String(a.id), String(b.id)));
    const proposed = L.proposed.filter((f) => f.data && !f.data.assigned_id && !f.data.merged_into && !f.data.linked_od).map((f) => f.data).sort((a: any, b: any) => cmp(String(a.id), String(b.id)));
    const linked = L.proposed.filter((f) => f.data && (f.data.assigned_id || f.data.merged_into || f.data.linked_od)).map((f) => f.data).sort((a: any, b: any) => cmp(String(a.id), String(b.id)));
    out.push('# Operator Decisions (Phase 22)', '');
    out.push(
        'Generated by `.planning/audit/tools/render.ts` from `.planning/audit/decisions/`. Do not edit by hand. Every behavior-changing recommendation from the audit is a card here (AUDIT-05). A card lists at least two options, one of them keeping current behavior with its risk stated (NAC-12). Until the operator decides, the default is current behavior; capital cards are decided in the Phase 24 discussion. Only OD-1, OD-2, OD-7 and OD-21 may be marked decided in Phase 22.',
        '',
    );
    const open = cards.filter((d: any) => d.status !== 'decided');
    const capital = open.filter((d: any) => d.capital === true);
    const areas = [...new Set(capital.map((d: any) => String(d.area)))].sort(cmp);
    out.push('## Capital decisions (open), grouped by area', '');
    if (!capital.length) out.push('_None recorded yet._', '');
    for (const a of areas) {
        out.push(`### Area: ${a}`, '');
        for (const d of capital.filter((x: any) => String(x.area) === a)) renderCard(L, d, out, '####');
    }
    out.push('## Non-capital decisions (open)', '');
    const non = open.filter((d: any) => d.capital !== true);
    if (!non.length) out.push('_None recorded yet._', '');
    for (const d of non) renderCard(L, d, out, '###');
    out.push('## Proposed cards (not yet numbered)', '');
    out.push('Proposed by an area audit; plan 22-28 merges, links or numbers each one (OD-26 and up) with assign-cards.ts.', '');
    if (!proposed.length) out.push('_None._', '');
    for (const d of proposed) renderCard(L, d, out, '###');
    if (linked.length) {
        out.push('### Proposals already merged, linked or numbered', '', '| Proposal | Assigned id | Merged into | Linked to |', '|---|---|---|---|');
        for (const d of linked) out.push(`| ${c(d.id)} | ${c(d.assigned_id)} | ${c(d.merged_into)} | ${c(d.linked_od)} |`);
        out.push('');
    }
    out.push('## Decided', '');
    const decided = cards.filter((d: any) => d.status === 'decided');
    if (!decided.length) out.push('_None._', '');
    for (const d of decided) renderCard(L, d, out, '###');
    return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

export function renderAll(root: string): { findings: string; decisions: string; unreadable: RegFile[] } {
    const L = load(root);
    return { findings: renderFindings(L), decisions: renderDecisions(L), unreadable: L.unreadable };
}

export function run(argv: string[], io: Io = consoleIo): number {
    try {
        const { flags, positional } = parseArgs(argv, SPEC as unknown as Record<string, 'string' | 'bool' | 'multi'>);
        if (flags.help) {
            io.out('usage: render.ts [--root <register dir>] [--repo <git dir>] [--out <dir>]');
            return 0;
        }
        if (positional.length) throw new UsageError(`unexpected argument '${positional[0]}'`);
        const loc = locations(flags);
        const outDir = typeof flags.out === 'string' ? path.resolve(flags.out) : loc.root;
        const r = renderAll(loc.root);
        if (r.unreadable.length) {
            for (const f of r.unreadable) io.err(`render: ${f.rel} is unreadable (${f.error}); run check.ts`);
            return 1;
        }
        fs.mkdirSync(outDir, { recursive: true });
        writeAtomic(path.join(outDir, 'AUDIT-FINDINGS.md'), r.findings);
        writeAtomic(path.join(outDir, 'OPERATOR-DECISIONS.md'), r.decisions);
        io.out(`RENDERED AUDIT-FINDINGS.md (${Buffer.byteLength(r.findings)} bytes) and OPERATOR-DECISIONS.md (${Buffer.byteLength(r.decisions)} bytes)`);
        return 0;
    } catch (e) {
        if (e instanceof UsageError) {
            io.err(`render: ${e.message}`);
            return 2;
        }
        io.err(`render: crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        return 2;
    }
}

if (require.main === module) {
    process.exitCode = run(process.argv.slice(2));
}
