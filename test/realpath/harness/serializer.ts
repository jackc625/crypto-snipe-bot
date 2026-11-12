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
//     line. It writes only when VITEST_CSB_UPDATE_RECORDINGS is "1" and CI is not set (AC-25), and
//     the only code that sets that switch is scripts/update-recordings.ts (npm run
//     recordings:update). In a normal run an absent recording is a failure naming that command.

import * as fs from 'node:fs';
import * as path from 'node:path';
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

/** Whether this process may write recordings: the switch is "1" and CI is not set. */
export function updateAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
    const ci = env.CI;
    return env[UPDATE_SWITCH] === '1' && (ci === undefined || ci === '');
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

/**
 * Compare `text` with the recording at `relPath`, byte for byte. Throws on a difference or an
 * absent file, unless writing is allowed (updateAllowed), in which case it writes and returns
 * 'written'. Returns 'match' when the bytes are equal (nothing is written).
 */
export function compareRecording(relPath: string, text: string, opts: CompareOptions = {}): CompareResult {
    const file = resolveRecordingPath(relPath, opts.dir);
    if (text.includes('\r')) throw new Error(`compareRecording: the text for ${relPath} holds a carriage return (AC-26: LF only)`);
    const now = Buffer.from(text, 'utf8');
    const exists = fs.existsSync(file);
    const recorded = exists ? fs.readFileSync(file) : null;
    if (recorded !== null && recorded.equals(now)) return 'match';
    if (updateAllowed()) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, now);
        return 'written';
    }
    if (recorded === null) {
        throw new Error(`compareRecording: no recording at ${relPath}. A normal run never writes one (AC-25); create it with: ${UPDATE_COMMAND}`);
    }
    throw new Error(
        `compareRecording: ${relPath} differs from what the bot did now (the recording is not rewritten on a normal run). ` +
            `${firstDifference(recorded.toString('utf8'), text)}\n` +
            `If the change is intended, re-record with ${UPDATE_COMMAND} and commit it as a behavior: commit citing a register ID (D-18).`,
    );
}
