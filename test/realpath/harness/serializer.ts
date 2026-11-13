// test/realpath/harness/serializer.ts
// Phase 23 plan 23-20 (CHAR-02, D-12, D-13, D-15, AC-20 to AC-26): the golden-master recording.
//
//   - serializeTimeline(entries, { scenario, tag }): one LF-only text per scenario. Line 1 is the
//     header {"scenario","tag"}; then one JSON line per timeline entry, in the order the entries
//     happened (AC-23: never sorted); a timeline with no `submit` entry ends in the exact line
//     {"submitted":[]} (AC-22, the explicit empty list: 16 characters, no spaces, no `at`, no other
//     key, the only form it takes; plan 23-22 greps for it). The text ends in one LF.
//   - normalizeForRecording(value): the ONE place values are normalized (RESEARCH Pitfall 4,
//     AC-26), shared with plan 23-23's env snapshot:
//       BigInt                -> whole-number text ("123")
//       NaN / +-Infinity      -> {"$nonFinite":"NaN"} / {"$nonFinite":"Infinity"} / {"$nonFinite":"-Infinity"}
//                                (plain JSON would write null and lose what plan 23-23 exists to show)
//       an integer-valued double above Number.MAX_SAFE_INTEGER (a REAL column, a float quote)
//                             -> {"$unsafeNumber":"<String(n)>"} (a JSON reader would round it)
//       Error                 -> {"$error":{"name","code"?,"message"}}: no stack, ever
//       strings               -> absolute paths become <path>, `name.ts:12:3` loses its line and
//                                column, stack-frame lines are dropped, ethers' `version=6.16.0`
//                                is stripped (DEPS-02 would otherwise rewrite every error line)
//       Date                  -> its ISO text (the clock is the fixed fake clock, D-05)
//       Map / Set             -> {"$map":[[k,v],...]} / {"$set":[...]}, in insertion order
//       bytes                 -> {"$bytes":"0x..."}
//       an object with toJSON -> its toJSON() value
//       any other class instance -> {"$class":"<constructor name>"}: a recording holds data, not
//                                live objects (a provider or contract would drag its whole graph in)
//       a cycle               -> {"$circular":true}
//     Object keys keep their insertion order; undefined properties are left out (JSON semantics).
//   - compareRecording(relPath, text, { dir? }): the compare step and the only writer (D-15: not
//     Vitest snapshots, which write on a normal run outside CI). relPath is relative to
//     test/realpath/recordings/ and carries its extension: `<name>.jsonl` for a scenario,
//     `env/<VAR>.json` for an env-snapshot case (plan 23-23). A path that resolves outside the
//     folder is refused. It compares raw bytes; a difference throws naming the first differing
//     line. It writes only when CI is not set and VITEST_CSB_UPDATE_RECORDINGS holds a live update
//     token (AC-25; Phase 23 review WR-36): 32 hex digits whose file
//     <os.tmpdir()>/csb-recordings-update-<token> names that token and a running process. The only
//     code that sets the switch is scripts/update-recordings.ts (npm run recordings:update), which
//     makes the token and its file for its one Vitest run and removes the file when Vitest exits, so
//     a value left exported in a shell ("1", or an old token) only compares. Every write prints one
//     "[recordings] WROTE <path>" line on stderr. In a normal run an absent recording is a failure
//     naming that command.
//   - Plan 23-33 (AUDIT-06, the gap plan 23-25 recorded; operator ruling 2026-11-12 "Fix now,
//     small plan (Recommended)"): compareRecording also records, for the current run, which
//     recording it compared, so scripts/check-recordings-compared.ts (npm run
//     check:recordings-compared) can fail when a committed recording was never compared in a full
//     run (a test pointed at a new recording name while the old file stays). Once the compare has
//     decided (Phase 23 review WR-28: the outcome, not just the call, so a mismatch the caller
//     catches still counts against the run), a call against the real recordings folder appends one
//     line, {"path":<path relative to that folder with forward slashes (`<name>.jsonl`,
//     `env/<VAR>.json`)>,"result":"match"|"written"|"differs"|"absent"|"error"}, to
//     <os.tmpdir()>/crypto-snipe-bot-recordings-compared/<CSB_RAIL_RUN_ID>/
//     <pid>-<token>.txt (token: 8 random hex digits taken when this module loads, so two worker
//     threads of one process, or two loaded copies of the module, never share a file),
//     synchronously, so a worker that ends right after cannot lose it. It records in compare and
//     update runs alike. A call with a `dir` override naming another
//     folder (the guard's temp-folder cases) is not recorded. CSB_RAIL_RUN_ID is the rails' run id
//     (test/rails/ledgerRun.ts sets it in the Vitest main process before any worker starts, so
//     every worker of one invocation shares it; core.cjs keeps it through its env scrub); the
//     record lives outside the rail ledger folder. Without a valid run id nothing is recorded and
//     one line says so on stderr (once per loaded module; Vitest loads it once per test file). A
//     failed record write is reported once on stderr and never
//     changes the compare (the check then fails naming the path). Nothing else here changed:
//     compare and write results are byte-identical to 23-20's. The check counts a recording as
//     compared only on a 'match', and fails on any other recorded outcome.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Transaction, hexlify } from 'ethers';
import type { TimelineEntry } from './capture';

export const RECORDINGS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'recordings');
export const UPDATE_SWITCH = 'VITEST_CSB_UPDATE_RECORDINGS';
export const UPDATE_COMMAND = 'npm run recordings:update -- <test file or name filter>';
/** AC-22: the explicit empty list, byte for byte. */
export const EMPTY_SUBMITTED_LINE = '{"submitted":[]}';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ---------------------------------------------------------------------------------------------
// Tags (AC-21)
// ---------------------------------------------------------------------------------------------

const FINDING_ID = 'AUD-[A-Z0-9]+-[0-9]{3}';
export const TAG_RE = new RegExp(`^(?:KEEP|SUSPECT\\((${FINDING_ID}(?:,${FINDING_ID})*)\\))$`);

/** The finding IDs a tag cites (none for KEEP). Throws on a malformed tag. */
export function tagIds(tag: string): string[] {
    // String.match, not RegExp.exec: the spawn-site rail gate accepts .exec() only on named receivers.
    const m = typeof tag === 'string' ? tag.match(TAG_RE) : null;
    if (!m) throw new Error(`recording tag ${JSON.stringify(tag)} is not KEEP or SUSPECT(<AUD-ID>[,<AUD-ID>...]) with no spaces`);
    if (!m[1]) return [];
    const ids = m[1].split(',');
    const seen = new Set<string>();
    for (const id of ids) {
        if (seen.has(id)) throw new Error(`recording tag ${tag} cites ${id} twice`);
        seen.add(id);
    }
    return ids;
}

// ---------------------------------------------------------------------------------------------
// Normalization (Pitfall 4, AC-26)
// ---------------------------------------------------------------------------------------------

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The repo root in both separator forms (case-insensitive: Windows paths).
const ROOT_FORMS = [...new Set([REPO_ROOT, REPO_ROOT.replace(/\\/g, '/'), REPO_ROOT.replace(/\//g, '\\')])];
const ROOT_RE = new RegExp(`(?:${ROOT_FORMS.map(escapeRe).join('|')})(?:[\\\\/][^\\s'"()<>|,;]*)?`, 'gi');
// Any other absolute path: a Windows drive path, a file URL, or a POSIX path under a usual root.
const WIN_PATH_RE = /\b[A-Za-z]:[\\/][^\s'"()<>|,;]*/g;
const FILE_URL_RE = /file:\/\/\/?[^\s'"()<>|,;]*/gi;
const POSIX_PATH_RE = /(?<![\w.:/-])\/(?:home|Users|tmp|var|private|usr|opt|mnt|root|srv|app|builds?|runner|github|workspace|Volumes)\/[^\s'"()<>|,;]*/g;
// `name.ts:12` / `name.js:12:3` (AC-26: no line numbers).
const FILE_LINE_RE = /(\.(?:ts|tsx|mts|cts|js|jsx|cjs|mjs))(?::\d+)+/g;
// A stack-frame line, with the line break before it.
const STACK_LINE_RE = /\r?\n[ \t]+at [^\n]*/g;
// ethers' library version inside its error text: ", version=6.16.0" or "version=6.16.0".
const ETHERS_VERSION_RE = /,?[ \t]*version=[0-9][0-9A-Za-z.+-]*/g;

export function normalizeString(s: string): string {
    return s
        .replace(STACK_LINE_RE, '')
        .replace(ETHERS_VERSION_RE, '')
        .replace(ROOT_RE, '<path>')
        .replace(FILE_URL_RE, '<path>')
        .replace(WIN_PATH_RE, '<path>')
        .replace(POSIX_PATH_RE, '<path>')
        .replace(FILE_LINE_RE, '$1');
}

function isErrorLike(v: object): v is Error {
    return v instanceof Error || Object.prototype.toString.call(v) === '[object Error]';
}

function normalizeError(e: Error, stack: object[]): unknown {
    const out: Record<string, unknown> = { name: normalizeString(String(e.name ?? 'Error')) };
    const code = (e as { code?: unknown }).code;
    if (code !== undefined) out.code = normalizeInner(code, stack);
    out.message = normalizeString(String(e.message ?? ''));
    return { $error: out };
}

function normalizeNumber(n: number): unknown {
    if (Number.isNaN(n)) return { $nonFinite: 'NaN' };
    if (n === Infinity) return { $nonFinite: 'Infinity' };
    if (n === -Infinity) return { $nonFinite: '-Infinity' };
    if (Object.is(n, -0)) return 0;
    if (Number.isInteger(n) && !Number.isSafeInteger(n)) return { $unsafeNumber: String(n) };
    return n;
}

function normalizeInner(value: unknown, stack: object[]): unknown {
    switch (typeof value) {
        case 'string':
            return normalizeString(value);
        case 'number':
            return normalizeNumber(value);
        case 'bigint':
            return value.toString();
        case 'boolean':
            return value;
        case 'undefined':
            return undefined;
        case 'symbol':
            return { $symbol: normalizeString(value.description ?? '') };
        case 'function':
            return { $function: value.name || 'anonymous' };
        default:
            break;
    }
    if (value === null) return null;
    const obj = value as object;
    if (stack.includes(obj)) return { $circular: true };
    stack.push(obj);
    try {
        if (isErrorLike(obj)) return normalizeError(obj, stack);
        if (Array.isArray(obj)) return obj.map((v) => {
            const n = normalizeInner(v, stack);
            return n === undefined ? null : n;
        });
        if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? { $nonFinite: 'NaN' } : obj.toISOString();
        if (obj instanceof Map) return { $map: [...obj.entries()].map(([k, v]) => [normalizeInner(k, stack) ?? null, normalizeInner(v, stack) ?? null]) };
        if (obj instanceof Set) return { $set: [...obj.values()].map((v) => normalizeInner(v, stack) ?? null) };
        if (obj instanceof Uint8Array) return { $bytes: hexlify(obj) };
        const toJSON = (obj as { toJSON?: unknown }).toJSON;
        if (typeof toJSON === 'function') return normalizeInner((toJSON as () => unknown).call(obj), stack);
        const proto = Object.getPrototypeOf(obj) as object | null;
        if (proto !== null && proto !== Object.prototype) {
            const ctor = (proto as { constructor?: { name?: unknown } }).constructor;
            return { $class: typeof ctor?.name === 'string' && ctor.name !== '' ? ctor.name : 'anonymous' };
        }
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(obj)) {
            const n = normalizeInner((obj as Record<string, unknown>)[key], stack);
            if (n !== undefined) out[normalizeString(key)] = n;
        }
        return out;
    } finally {
        stack.pop();
    }
}

/** The value as a recording holds it (see the file header). */
export function normalizeForRecording(value: unknown): unknown {
    return normalizeInner(value, []);
}

/** One JSON line of a normalized value (no LF, no CR). */
export function recordingLine(value: unknown): string {
    const text = JSON.stringify(normalizeForRecording(value));
    if (text === undefined) throw new Error('recordingLine: the value has no JSON form');
    return text;
}

// ---------------------------------------------------------------------------------------------
// Timeline (D-12, D-13, AC-20 to AC-23)
// ---------------------------------------------------------------------------------------------

/**
 * A submit entry with its transaction request decoded by real ethers (AC-20: the request and its
 * calldata), beside the raw signed bytes the node accepted.
 */
function submitLine(e: Extract<TimelineEntry, { kind: 'submit' }>): Record<string, unknown> {
    const tx = Transaction.from(e.raw);
    const request: Record<string, unknown> = {
        type: tx.type,
        chainId: tx.chainId,
        nonce: tx.nonce,
        to: tx.to,
        value: tx.value,
        gasLimit: tx.gasLimit,
    };
    if (tx.gasPrice !== null) request.gasPrice = tx.gasPrice;
    if (tx.maxFeePerGas !== null) request.maxFeePerGas = tx.maxFeePerGas;
    if (tx.maxPriorityFeePerGas !== null) request.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
    request.data = tx.data;
    return { kind: e.kind, at: e.at, route: e.route, status: e.status, hash: e.hash, from: e.from, to: e.to, nonce: e.nonce, request, raw: e.raw };
}

function entryLine(e: TimelineEntry): Record<string, unknown> {
    switch (e.kind) {
        case 'op':
            return { kind: e.kind, at: e.at, level: e.level, op: e.op, msg: e.msg, fields: e.fields, bindings: e.bindings };
        case 'submit':
            return submitLine(e);
        case 'relay':
            return { kind: e.kind, at: e.at, relay: e.relay, url: e.url, method: e.method, params: e.params };
        case 'db':
            return { kind: e.kind, at: e.at, table: e.table, op: e.op, inTransaction: e.inTransaction, row: e.row };
        default: {
            const kind = (e as { kind?: unknown }).kind;
            throw new Error(`serializeTimeline: unknown entry kind ${JSON.stringify(kind)}`);
        }
    }
}

export interface SerializeOptions {
    /** The scenario name; the recording file is `<scenario>.jsonl`. */
    scenario: string;
    /** KEEP or SUSPECT(<finding-id>[,<finding-id>...]) (AC-21). */
    tag: string;
}

export const SCENARIO_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The recording text of one scenario (see the file header). */
export function serializeTimeline(entries: readonly TimelineEntry[], opts: SerializeOptions): string {
    if (!SCENARIO_NAME_RE.test(opts.scenario)) throw new Error(`serializeTimeline: scenario name ${JSON.stringify(opts.scenario)} is not lower-case kebab-case`);
    tagIds(opts.tag);
    const lines: string[] = [recordingLine({ scenario: opts.scenario, tag: opts.tag })];
    let submitted = false;
    for (const e of entries) {
        if (e.kind === 'submit') submitted = true;
        lines.push(recordingLine(entryLine(e)));
    }
    if (!submitted) lines.push(EMPTY_SUBMITTED_LINE);
    const text = `${lines.join('\n')}\n`;
    if (text.includes('\r')) throw new Error('serializeTimeline: a line holds a carriage return');
    return text;
}

// ---------------------------------------------------------------------------------------------
// Compare and write (D-15, AC-25)
// ---------------------------------------------------------------------------------------------

export interface CompareOptions {
    /** The recordings folder (a temp folder in the guard's own tests). Default RECORDINGS_DIR. */
    dir?: string;
}

export type CompareResult = 'match' | 'written';

/**
 * WR-36: the update token file under os.tmpdir(). scripts/update-recordings.ts writes
 * <UPDATE_TOKEN_PREFIX><token> (JSON {pid, token}) before its one Vitest run, sets the switch to the
 * token, and removes the file when Vitest exits.
 */
export const UPDATE_TOKEN_PREFIX = 'csb-recordings-update-';
const UPDATE_TOKEN_RE = /^[0-9a-f]{32}$/;
let warnedDeadSwitch = false;

/** Whether `token` has its file under os.tmpdir(), naming itself and a running process (the wrapper). */
function liveUpdateToken(token: string): boolean {
    let rec: unknown;
    try {
        rec = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `${UPDATE_TOKEN_PREFIX}${token}`), 'utf8'));
    } catch {
        return false;
    }
    const r = rec as { pid?: unknown; token?: unknown } | null;
    if (r === null || typeof r !== 'object' || r.token !== token || typeof r.pid !== 'number' || !Number.isSafeInteger(r.pid) || r.pid <= 0) return false;
    try {
        process.kill(r.pid, 0);
        return true;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
}

/**
 * Whether this process may write recordings: CI is not set, and the switch holds a live update token
 * (WR-36): 32 hex digits whose file under os.tmpdir() names that token and a running process. Any
 * other value (a "1" left exported in a shell, a token whose run has ended) only compares, and says
 * so once on stderr.
 */
export function updateAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
    const ci = env.CI;
    if (ci !== undefined && ci !== '') return false;
    const token = env[UPDATE_SWITCH];
    if (token === undefined || token === '') return false;
    if (UPDATE_TOKEN_RE.test(token) && liveUpdateToken(token)) return true;
    if (!warnedDeadSwitch) {
        warnedDeadSwitch = true;
        process.stderr.write(
            `[recordings] ${UPDATE_SWITCH} is set but is not a live update token (only npm run recordings:update makes one, for its own run); ` +
                'recordings are compared, not written\n',
        );
    }
    return false;
}

/** The absolute file a relative recording path names, refusing anything outside `dir`. */
export function resolveRecordingPath(relPath: string, dir: string = RECORDINGS_DIR): string {
    if (typeof relPath !== 'string' || relPath === '') throw new Error('compareRecording: the recording path is empty');
    if (path.isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath)) throw new Error(`compareRecording: ${relPath} is absolute; give a path relative to the recordings folder`);
    if (relPath.includes('\\')) throw new Error(`compareRecording: ${relPath} uses a backslash; use forward slashes`);
    if (!/\.(?:jsonl|json)$/.test(relPath)) throw new Error(`compareRecording: ${relPath} must end in .jsonl (a scenario) or .json (an env-snapshot case)`);
    const base = path.resolve(dir);
    const file = path.resolve(base, relPath);
    const rel = path.relative(base, file);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`compareRecording: ${relPath} resolves outside the recordings folder`);
    return file;
}

function firstDifference(expected: string, actual: string): string {
    const a = expected.split('\n');
    const b = actual.split('\n');
    const n = Math.max(a.length, b.length);
    const clip = (s: string | undefined): string => (s === undefined ? '<no line>' : s.length > 400 ? `${s.slice(0, 400)}... (${s.length} chars)` : s);
    for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) return `first difference at line ${i + 1}:\n  recorded: ${clip(a[i])}\n  now:      ${clip(b[i])}`;
    }
    return 'the bytes differ but every line is equal (line endings or encoding)';
}

// ---------------------------------------------------------------------------------------------
// The per-run comparison record (plan 23-33; read by scripts/check-recordings-compared.ts)
// ---------------------------------------------------------------------------------------------

/** The folder under os.tmpdir() that holds one sub-folder per run id. Outside the rail ledger. */
export const COMPARED_RECORD_DIRNAME = 'crypto-snipe-bot-recordings-compared';
// The rails' run-id rule (test/rails/core.cjs RUN_ID_RE, test/rails/ledgerRun.ts).
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// One record file per loaded copy of this module (see the file header).
const RECORD_TOKEN = randomBytes(4).toString('hex');
let warnedNoRunId = false;
let warnedWriteFailed = false;

/**
 * What one compareRecording call against the real folder ended in (WR-28): 'match' (the bytes are
 * equal), 'written' (an update run wrote them), 'differs', 'absent' (no recording), or 'error' (a
 * refusal, such as a carriage return, or a failed write).
 */
export type RecordedOutcome = 'match' | 'written' | 'differs' | 'absent' | 'error';

function recordCompared(file: string, base: string, result: RecordedOutcome): void {
    // Only the real recordings folder (a `dir` override naming it counts as the real folder).
    if (path.relative(RECORDINGS_DIR, base) !== '') return;
    const runId = process.env.CSB_RAIL_RUN_ID;
    if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) {
        if (!warnedNoRunId) {
            warnedNoRunId = true;
            process.stderr.write(
                `[AUDIT-06 recordings-compared] CSB_RAIL_RUN_ID is ${runId === undefined || runId === '' ? 'unset' : 'not a valid run id'} in process ${process.pid}; ` +
                    'compareRecording calls here are not recorded, so npm run check:recordings-compared cannot judge this run\n',
            );
        }
        return;
    }
    const rel = path.relative(RECORDINGS_DIR, file).split(path.sep).join('/');
    try {
        const dir = path.join(os.tmpdir(), COMPARED_RECORD_DIRNAME, runId);
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${process.pid}-${RECORD_TOKEN}.txt`), `${JSON.stringify({ path: rel, result })}\n`);
    } catch (e) {
        if (!warnedWriteFailed) {
            warnedWriteFailed = true;
            process.stderr.write(`[AUDIT-06 recordings-compared] could not record the comparison of ${rel} for run ${runId}: ${e instanceof Error ? e.message : String(e)}\n`);
        }
    }
}

/**
 * Compare `text` with the recording at `relPath`, byte for byte. Throws on a difference or an
 * absent file, unless writing is allowed (updateAllowed), in which case it writes and returns
 * 'written'. Returns 'match' when the bytes are equal (nothing is written). A call against the
 * real recordings folder is recorded for the current run with its outcome (see the file header).
 */
export function compareRecording(relPath: string, text: string, opts: CompareOptions = {}): CompareResult {
    const file = resolveRecordingPath(relPath, opts.dir);
    // WR-28: the outcome is recorded once the compare has decided, on every way out (a throw the
    // caller catches is still a 'differs' or 'absent' in the run's record).
    let outcome: RecordedOutcome = 'error';
    try {
        if (text.includes('\r')) throw new Error(`compareRecording: the text for ${relPath} holds a carriage return (AC-26: LF only)`);
        const now = Buffer.from(text, 'utf8');
        const exists = fs.existsSync(file);
        const recorded = exists ? fs.readFileSync(file) : null;
        if (recorded !== null && recorded.equals(now)) {
            outcome = 'match';
            return 'match';
        }
        if (updateAllowed()) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, now);
            outcome = 'written';
            // WR-36: every write is said out loud, so a re-record is never silent.
            process.stderr.write(`[recordings] WROTE ${relPath} (update run)\n`);
            return 'written';
        }
        if (recorded === null) {
            outcome = 'absent';
            throw new Error(`compareRecording: no recording at ${relPath}. A normal run never writes one (AC-25); create it with: ${UPDATE_COMMAND}`);
        }
        outcome = 'differs';
        throw new Error(
            `compareRecording: ${relPath} differs from what the bot did now (the recording is not rewritten on a normal run). ` +
                `${firstDifference(recorded.toString('utf8'), text)}\n` +
                `If the change is intended, re-record with ${UPDATE_COMMAND} and commit it as a behavior: commit citing a register ID (D-18).`,
        );
    } finally {
        recordCompared(file, path.resolve(opts.dir ?? RECORDINGS_DIR), outcome);
    }
}
