// .planning/audit/tools/set-triage.ts
//
// Phase 23 / Plan 23-04 (D-21; AC-08, AC-11, AC-13, AC-16, AC-17) - the one
// writer of a finding's Phase 23 `triage` block. Triage plans record an outcome
// with this tool instead of hand-editing JSON; check.ts judges whether the
// outcome has its evidence (`--stage partial` reports unfinished items as
// PENDING, `--stage triage` fails them). The contract is PROTOCOL.md section
// "Phase 23 triage record".
//
// Usage (Node 22.16.0, ABI 127; D-21):
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js .planning/audit/tools/set-triage.ts \
//       --id AUD-BUY-002 --outcome confirmed --test-id AUD-BUY-002 --note "<one line>"
//
// What it does:
//   - loads the one finding file findings/<id>.json and refuses an unknown ID
//     or outcome (exit 2);
//   - sets `triage` (outcome, phase "23", and the given fields). When the
//     finding already has a triage block with the SAME outcome, the given flags
//     are merged over it (so a later --ruling or --fork-ref keeps the earlier
//     claims and note); a different outcome replaces the block;
//   - maps the status: confirmed -> confirmed, NOT-A-BUG -> NOT-A-BUG,
//     fixed -> fixed (a finding already `verified` keeps verified),
//     unreproduced -> unchanged (an unreproduced entry stays open). --status
//     overrides the mapping (rarely needed; check.ts still judges consistency);
//   - writes through lib.ts toJson and writeAtomic, so the JSON is byte-stable:
//     writing the same values twice gives the same bytes. A file that was not
//     in the canonical toJson layout (inline arrays) is re-laid out once, and
//     the tool says so; values are unchanged.
// It does not refuse `unreproduced` without --ruling: plan 23-15's skip path and
// the batch plans record it before the operator review record exists, and
// check.ts reports that as PENDING at partial and FAIL at triage.
// It reads only the register under .planning/audit/ (never .env or data/).

if (process.versions.modules !== '127') {
    process.stderr.write(
        `set-triage: requires Node 22.16.0 (ABI 127); this is Node ${process.version} ` +
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
    readJson,
    writeAtomic,
    toJson,
    ID_RE,
    STATUSES,
    EVIDENCE_TYPES,
    TRIAGE_OUTCOMES,
    TRIAGE_KEYS,
    CLAIM_RE,
    REVIEW_ID_RE,
    UFV_ID_RE,
} from './lib';

const SPEC = {
    id: 'string',
    outcome: 'string',
    note: 'string',
    'test-id': 'string',
    proof: 'string',
    'rail-test': 'string',
    ruling: 'string',
    'needs-fork': 'bool',
    'fork-question': 'string',
    'fork-ref': 'string',
    'manual-evidence': 'string',
    'proven-claim': 'multi',
    'open-claim': 'multi',
    evidence: 'multi',
    status: 'string',
    root: 'string',
    help: 'bool',
} as const;

const USAGE = [
    'usage: set-triage.ts --id AUD-<SLICE>-NNN --outcome confirmed|NOT-A-BUG|fixed|unreproduced [options] [--root <register dir>]',
    '  --note <text>              one-line note (required unless the same-outcome block already has one)',
    '  --test-id <finding ID>     the finding ID of the triage test file that asserts this entry (confirmed: required by check.ts)',
    '  --proof <text>             fixed: the rail test and its RED proof',
    '  --rail-test <title>        fixed: the rail test\'s exact full title path (describe > test)',
    '  --ruling <review ID>       ruling_ref: the operator review record (reviews/<ID>.json) holding the ruling for this finding',
    '  --needs-fork               the item truly needs a fork run (AC-16); then --fork-question and --fork-ref',
    '  --fork-question <text>     the question the fork run must answer',
    '  --fork-ref <UFV-NN>        the Phase 25 entry in inputs/unrun-fork-verifications.json',
    '  --manual-evidence <path>   repo-relative file holding manual evidence (for example a recorded response)',
    '  --proven-claim <claim>     repeatable: a kebab-case knownBug claim that is proven (unreproduced)',
    '  --open-claim <text>        repeatable: what stays unproven (unreproduced with a knownBug)',
    '  --evidence <json>          repeatable: {"type":"code|command","ref":"...","note":"..."} (NOT-A-BUG needs at least one)',
    '  --status <status>          override the outcome-to-status mapping (rarely needed)',
    'Writes findings/<id>.json atomically in the toJson layout. Exit 0 written, 2 refused or crashed.',
];

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

function str(flags: Record<string, unknown>, name: string): string | undefined {
    const v = flags[name];
    if (v === undefined) return undefined;
    if (!isStr(v)) throw new UsageError(`--${name} needs a non-empty value`);
    return v.trim();
}

function list(flags: Record<string, unknown>, name: string): string[] | undefined {
    const v = flags[name] as string[] | undefined;
    if (v === undefined) return undefined;
    const out = v.map((x) => x.trim());
    if (out.some((x) => !x)) throw new UsageError(`--${name} needs a non-empty value`);
    if (new Set(out).size !== out.length) throw new UsageError(`--${name} repeats a value`);
    return out;
}

function parseEvidence(raw: string): { type: string; ref: string; note: string } {
    let e: any;
    try {
        e = JSON.parse(raw);
    } catch {
        throw new UsageError(`--evidence must be JSON {"type":"code|command","ref":"...","note":"..."}, got ${JSON.stringify(raw)}`);
    }
    if (!isObj(e) || !EVIDENCE_TYPES.includes(e.type) || !isStr(e.ref) || !isStr(e.note) || Object.keys(e).some((k) => !['type', 'ref', 'note'].includes(k)))
        throw new UsageError('--evidence must be exactly {type: code|command, ref, note}, each non-empty');
    if (e.type === 'code' && !ID_RE.codeRef.test(e.ref)) throw new UsageError(`--evidence code ref '${e.ref}' must be path:line[-line]@sha`);
    return { type: e.type, ref: e.ref, note: e.note };
}

export function run(argv: string[], io: Io = consoleIo): number {
    try {
        const { flags, positional } = parseArgs(argv, SPEC as unknown as Record<string, 'string' | 'bool' | 'multi'>);
        if (flags.help) {
            for (const l of USAGE) io.out(l);
            return 0;
        }
        if (positional.length) throw new UsageError(`unexpected argument '${positional[0]}'`);
        const id = str(flags, 'id');
        const outcome = str(flags, 'outcome');
        if (!id) throw new UsageError('--id is required');
        if (!ID_RE.finding.test(id)) throw new UsageError(`--id ${id} is not a finding ID (AUD-<SLICE>-NNN)`);
        if (!outcome) throw new UsageError('--outcome is required');
        if (!TRIAGE_OUTCOMES.includes(outcome)) throw new UsageError(`unknown outcome '${outcome}' (one of ${TRIAGE_OUTCOMES.join(', ')})`);

        const root = path.resolve(typeof flags.root === 'string' ? flags.root : path.join(__dirname, '..'));
        const rel = `findings/${id}.json`;
        const abs = path.join(root, 'findings', `${id}.json`);
        if (!fs.existsSync(abs)) throw new UsageError(`unknown finding ${id}: ${rel} does not exist under ${root}`);
        const before = fs.readFileSync(abs, 'utf8');
        const f = readJson(abs, rel);
        if (f.error || !isObj(f.data)) throw new Error(`${rel} is unreadable or not an object: ${f.error ?? 'not an object'}`);
        const d = f.data;
        if (d.id !== id) throw new Error(`${rel} holds id ${String(d.id)}, not ${id}`);

        const prev = isObj(d.triage) ? d.triage : null;
        const merged: Record<string, unknown> = prev && prev.outcome === outcome ? { ...prev } : {};
        merged.outcome = outcome;
        merged.phase = '23';
        const set = (key: string, value: unknown) => {
            if (value !== undefined) merged[key] = value;
        };
        set('note', str(flags, 'note'));
        const testId = str(flags, 'test-id');
        if (testId !== undefined && !ID_RE.finding.test(testId)) throw new UsageError(`--test-id ${testId} is not a finding ID`);
        set('test_id', testId);
        set('proof', str(flags, 'proof'));
        set('rail_test', str(flags, 'rail-test'));
        const ruling = str(flags, 'ruling');
        if (ruling !== undefined && !REVIEW_ID_RE.test(ruling)) throw new UsageError(`--ruling ${ruling} is not an operator review id such as TRIAGE-REVIEW-01`);
        set('ruling_ref', ruling);
        if (flags['needs-fork']) merged.needs_fork = true;
        set('fork_question', str(flags, 'fork-question'));
        const forkRef = str(flags, 'fork-ref');
        if (forkRef !== undefined && !UFV_ID_RE.test(forkRef)) throw new UsageError(`--fork-ref ${forkRef} is not a UFV entry id (UFV-NN)`);
        set('fork_ref', forkRef);
        const manual = str(flags, 'manual-evidence');
        if (manual !== undefined && (manual.includes('\\') || path.isAbsolute(manual) || manual.split('/').includes('..')))
            throw new UsageError(`--manual-evidence ${manual} must be a repo-relative path with forward slashes`);
        set('manual_evidence', manual);
        const proven = list(flags, 'proven-claim');
        if (proven?.some((c) => !CLAIM_RE.test(c))) throw new UsageError('--proven-claim must be the kebab-case claim literal of a knownBug call');
        set('proven_claims', proven);
        set('open_claims', list(flags, 'open-claim'));
        const ev = flags.evidence as string[] | undefined;
        if (ev !== undefined) merged.evidence = ev.map(parseEvidence);
        if (!isStr(merged.note)) throw new UsageError('--note is required (a one-line note), unless the existing triage block with this outcome already has one');

        // Canonical key order, so two writers of the same values give the same bytes.
        const triage: Record<string, unknown> = {};
        for (const k of TRIAGE_KEYS) if (k in merged) triage[k] = merged[k];
        for (const k of Object.keys(merged)) if (!TRIAGE_KEYS.includes(k)) triage[k] = merged[k];

        const oldStatus = String(d.status);
        let status = oldStatus;
        const override = str(flags, 'status');
        if (override !== undefined) {
            if (!STATUSES.includes(override)) throw new UsageError(`--status must be one of ${STATUSES.join(', ')}`);
            status = override;
        } else if (outcome === 'confirmed') status = 'confirmed';
        else if (outcome === 'NOT-A-BUG') status = 'NOT-A-BUG';
        else if (outcome === 'fixed') status = oldStatus === 'verified' ? 'verified' : 'fixed';

        d.triage = triage;
        d.status = status;
        const after = toJson(d);
        writeAtomic(abs, after);
        const notes: string[] = [];
        if (prev && prev.outcome !== outcome) notes.push(`replaced the previous ${String(prev.outcome)} triage block`);
        if (prev && prev.outcome === outcome) notes.push('merged over the existing triage block');
        if (toJson(JSON.parse(before.charCodeAt(0) === 0xfeff ? before.slice(1) : before)) !== before) notes.push('the file was re-laid out once in the canonical toJson format; values unchanged');
        io.out(`set-triage: ${id} outcome ${outcome}, status ${oldStatus} -> ${status}${notes.length ? ' (' + notes.join('; ') + ')' : ''}`);
        return 0;
    } catch (e) {
        if (e instanceof UsageError) {
            io.err(`set-triage: ${e.message}`);
            return 2;
        }
        io.err(`set-triage: crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        return 2;
    }
}

if (require.main === module) {
    process.exitCode = run(process.argv.slice(2));
}
