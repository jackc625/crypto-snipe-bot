// test/realpath/recordingsGuard.test.ts
// Phase 23 plan 23-20 (CHAR-02, AC-21, AC-22, AC-26, AC-51; T-23-25): the guards every golden-master
// recording and env snapshot must pass before its first commit, here and in plans 23-21, 23-22 and
// 23-23. It walks every .jsonl and .json file under test/realpath/recordings/**, parses each .jsonl
// line and each .json file, and walks every value with its key name.
//
// AC-26 (D-12): the raw file has no CR; a parsed string holds no backslash (the backslash of a JSON
// escape such as \" is not in the parsed value, so it passes), no `file:line` fragment (a .ts, .js,
// .cjs or .mjs name followed by a colon and digits) and no stack-frame line. In submit and relay
// entries, value, gasLimit, gasPrice, maxFeePerGas, maxPriorityFeePerGas and any key beginning
// `amount` are never JSON numbers (amounts are whole-number text), and no JSON number anywhere is an
// integer above Number.MAX_SAFE_INTEGER. Settings such as gasMultiplier stay numbers.
//
// AC-51, field-aware (a recording's transaction and bundle hashes are 64-hex values, so a blanket
// 64-hex rejection would reject every valid recording):
//   - Sentinels: the values of test/.env.test under a key matching KEY, TOKEN, SESSION, HASH, SECRET
//     or AUTH. A value equal to one is allowed only under walletPrivateKey (must equal PRIVATE_KEY's),
//     authKey (FLASHBOTS_AUTH_KEY's), authHeader (BLOXROUTE_AUTH_HEADER's) or a key that is that
//     variable's own name (how plan 23-23's _baseline.json records its input). The chain registry
//     carries mevConfig.authKey / mevConfig.authHeader (src/chainRegistry.ts), inert sentinels. A
//     string that CONTAINS a sentinel without being exactly that allowed value fails too.
//   - Hashes: otherwise a 64-hex value is allowed only as the whole value (0x + 64 hex) of a named
//     hash field (HASH_KEYS: the hash-carrying keys src/ uses in its logs and DB columns) or an entry
//     of `topics`, and even there it must be a real hash (Phase 23 review WR-33): a transaction-hash
//     field (TX_HASH_KEYS) outside a db row must be the hash of a signed transaction in the same
//     recording, and a bundleHash must be the bundle hash (keccak256 of the transaction hashes, the
//     relay's rule) of a bundle body in the same recording. A db row may hold a made-up hash (the
//     risk-gate scenario seeds rows of no signed transaction).
//   - Keys of a recorded address (WR-33): a 64-hex value accepted by any rule here (a hash field, a
//     topic, a calldata word) fails when, read as a secp256k1 private key, it is the key of an address
//     that appears in the same recording (a signer, a wallet, any 0x + 40 hex) or of a test/.env.test
//     key sentinel. Values below 2^160 (amounts, padded addresses, the tiny sentinels, which the
//     sentinel rule catches) are not read as keys.
//   - Builder keys: an entry of consideredByBuilders / sealedByBuilders may be a 48-byte BLS public
//     key (0x + 96 hex). src/utils/mevStrategies/flashbots.ts logs these from the relay's
//     flashbots_getBundleStatsV2 answer (stats.consideredByBuildersAt[].pubkey): public builder
//     identities, not secrets. Added in plan 23-20 when the first real recording held them.
//   - bloXroute's answer hash: in an op line whose op is bloxroute.relay.accepted, the txHash of the
//     fields' relayHash object may be the bare 64 hex (no 0x) of that same line's signedTxHash.
//     bloXroute answers bsc_private_tx with { txHash } as hex without 0x, and
//     src/utils/mevStrategies/bloxroute.ts logs that answer whole as relayHash beside the hash it
//     signed itself; it is the public transaction hash, not a secret. Only that one field of that
//     one op, and only when it equals the line's own signedTxHash. Added in plan 23-22 when the
//     first bloXroute recording held it.
//   - Signed transactions: `raw`, each entry of `signedTransactions` and `txs`, and the bloXroute
//     body's `transaction` must parse through real Transaction.from, and a `raw` whose hash differs
//     from its entry's `hash` fails.
//   - Calldata: a hex `data` value must be hex of a whole number of bytes. Only a submit entry's
//     request.data is calldata (WR-33): it must equal the data of the entry's own signed raw
//     transaction, and its 32-byte ABI words get the key rule above. A `data` key anywhere else gets
//     every other rule, the 64-hex rule included.
//   - Any other string, a free-text log message included, fails if it holds a 64-hex run (no log
//     message in src/ interpolates a hash; only alert text does, and alerts are not recorded).
//   - URLs: every http(s):// or ws(s):// URL has a loopback host or one of the public hosts src/
//     itself names (PUBLIC_HOSTS; a test below proves each appears in src/ as a string or template
//     literal, comments excluded). On a public host the URL is parsed with the real URL class and
//     fails on a username or password, a query parameter named like a credential (key, token,
//     secret, auth, password, session, signature) unless its value is a 20-byte 0x address, or a path
//     segment or query value of 20 or more characters that is not a 20-byte 0x address.
//   - Any string, or any line of one, starting as a .env-style KEY= fails.
// AC-21: every ID a header's SUSPECT(...) cites exists as a finding JSON.
// AC-22: serializeTimeline with no submit entry ends in the exact line {"submitted":[]}.
//
// Temp-directory cases prove each rule both ways. Only installed tooling is used. Nothing here
// names a file under src/ or scripts/: src/ is walked as a directory (the AC-37 gate,
// test/unit/sourceTextGate.test.ts). Nothing here mocks anything.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { Transaction, Wallet, computeAddress, ethers, keccak256 } from 'ethers';
import type { TimelineEntry } from './harness/capture';
import {
    EMPTY_SUBMITTED_LINE,
    RECORDINGS_DIR,
    TAG_RE,
    UPDATE_SWITCH,
    compareRecording,
    normalizeForRecording,
    recordingLine,
    resolveRecordingPath,
    serializeTimeline,
    tagIds,
    updateAllowed,
} from './harness/serializer';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FINDINGS_DIR = path.join(REPO_ROOT, '.planning', 'audit', 'findings');
const ENV_TEST_FILE = path.join(REPO_ROOT, 'test', '.env.test');
const SRC_DIR = path.join(REPO_ROOT, 'src');

/** The hash-carrying keys src/ uses in its logs and DB columns (plan 23-20, read 2026-11-09). */
export const HASH_KEYS: ReadonlySet<string> = new Set([
    'hash', 'txHash', 'tx_hash', 'signedTxHash', 'prevSignedTxHash', 'lastSignedHash', 'minedTxHash', 'landedHash',
    'relayHash', 'realHash', 'bundleHash', 'blockHash', 'parentHash', 'transactionHash',
]);
/** The HASH_KEYS that hold a transaction hash (the rest: bundleHash, blockHash, parentHash, relayHash). */
export const TX_HASH_KEYS: ReadonlySet<string> = new Set([...HASH_KEYS].filter((k) => !['bundleHash', 'blockHash', 'parentHash', 'relayHash'].includes(k)));
/** Builder identities in the Flashbots stats log: 48-byte BLS public keys. */
const BUILDER_KEY_ARRAYS: ReadonlySet<string> = new Set(['consideredByBuilders', 'sealedByBuilders']);
/** The public hosts src/ itself names; anything else must be loopback. */
export const PUBLIC_HOSTS: readonly string[] = [
    'relay.flashbots.net', 'api.blxrbdn.com', 'etherscan.io', 'bscscan.com', 'basescan.org', 'arbiscan.io',
    'bsc-dataseed.binance.org', 'api.honeypot.is', 'api.gopluslabs.io', 'api.unicrypt.network', 'api.mudra.website',
];
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const AMOUNT_KEYS: ReadonlySet<string> = new Set(['value', 'gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas']);
const SIGNED_TX_ARRAYS: ReadonlySet<string> = new Set(['signedTransactions', 'txs']);

const HEX64_RUN = /[0-9a-fA-F]{64}/;
const HASH_VALUE = /^0x[0-9a-fA-F]{64}$/;
const BLS_PUBKEY = /^0x[0-9a-fA-F]{96}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WHOLE_BYTES_HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const FILE_LINE = /\.(?:ts|js|cjs|mjs):\d/;
const STACK_FRAME = /(?:^|\n)[ \t]*at [^\n]*(?:\(|:\d+:\d+)/;
const ENV_LINE = /(?:^|\n)[A-Z][A-Z0-9_]*=/;
const URL_RUN = /\b(?:https?|wss?):\/\/[^\s"'<>`]+/gi;
const CREDENTIAL_PARAM = /key|token|secret|auth|password|session|signature/i;
const SENTINEL_KEY = /KEY|TOKEN|SESSION|HASH|SECRET|AUTH/;
const ADDRESS_RUN = /(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const KEY_FLOOR = 2n ** 160n;

// ---------------------------------------------------------------------------------------------
// Sentinels (test/.env.test)
// ---------------------------------------------------------------------------------------------

export interface Sentinels {
    /** Variable name -> value, for every secret-bearing key with a non-empty value. */
    byName: Map<string, string>;
    /** Every distinct secret-bearing value. */
    values: Set<string>;
}

export function readSentinels(file: string = ENV_TEST_FILE): Sentinels {
    const byName = new Map<string, string>();
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!m || !SENTINEL_KEY.test(m[1]) || m[2] === '') continue;
        byName.set(m[1], m[2]);
    }
    return { byName, values: new Set(byName.values()) };
}

/** Where a sentinel value may appear: the three registry/config fields, or its own variable name. */
function sentinelAllowed(key: string | null, value: string, s: Sentinels): boolean {
    if (key === 'walletPrivateKey') return value === s.byName.get('PRIVATE_KEY');
    if (key === 'authKey') return value === s.byName.get('FLASHBOTS_AUTH_KEY');
    if (key === 'authHeader') return value === s.byName.get('BLOXROUTE_AUTH_HEADER');
    return key !== null && s.byName.get(key) === value;
}

// ---------------------------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------------------------

interface WalkCtx {
    file: string;
    where: string;
    /** The timeline entry kind of a .jsonl line (op, submit, relay, db), else null. */
    kind: string | null;
    relay: string | null;
    /**
     * In a bloxroute.relay.accepted op line: the fields' relayHash object and the bare lower-case
     * hex of the line's signedTxHash, the one value its txHash may hold (see the header). Else null.
     */
    relayAnswer: { obj: Record<string, unknown>; bare: string } | null;
    /** The parsed .jsonl line this value is in (null for a header or a .json document). */
    entry: Record<string, unknown> | null;
    /** What the whole file proves (WR-33). */
    facts: RecordingFacts;
    sentinels: Sentinels;
    out: string[];
}

const BARE_HASH = /^[0-9a-fA-F]{64}$/;

/** The relayAnswer of one parsed .jsonl line (see WalkCtx.relayAnswer). */
function relayAnswerOf(obj: Record<string, unknown>): WalkCtx['relayAnswer'] {
    if (obj.kind !== 'op' || obj.op !== 'bloxroute.relay.accepted') return null;
    const fields = obj.fields as Record<string, unknown> | undefined;
    const relayHash = fields?.relayHash;
    const signed = fields?.signedTxHash;
    if (relayHash === null || typeof relayHash !== 'object' || Array.isArray(relayHash) || typeof signed !== 'string' || !HASH_VALUE.test(signed)) return null;
    return { obj: relayHash as Record<string, unknown>, bare: signed.slice(2).toLowerCase() };
}

function parseSigned(raw: string): Transaction | null {
    try {
        return Transaction.from(raw.startsWith('0x') ? raw : `0x${raw}`);
    } catch {
        return null;
    }
}

/** What one recording file itself proves (WR-33): its signed transactions, bundles and addresses. */
export interface RecordingFacts {
    /** Lower-case hashes of every signed transaction the file carries (raw, txs, signedTransactions, a bloXroute transaction). */
    txHashes: Set<string>;
    /** Lower-case bundle hashes of every txs / signedTransactions body whose transactions all parse. */
    bundleHashes: Set<string>;
    /** Lower-case addresses: every 0x + 40 hex in the file, every signer, every key sentinel's address. */
    addresses: Set<string>;
}

function sentinelAddresses(s: Sentinels): string[] {
    const out: string[] = [];
    for (const v of s.values) {
        if (!HASH_VALUE.test(v)) continue;
        const n = BigInt(v);
        if (n === 0n || n >= SECP256K1_N) continue;
        out.push(computeAddress(v).toLowerCase());
    }
    return out;
}

/** The facts of one file: `docs` are its parsed lines (or its one .json document), `text` its raw text. */
export function recordingFacts(docs: unknown[], text: string, s: Sentinels): RecordingFacts {
    const facts: RecordingFacts = { txHashes: new Set(), bundleHashes: new Set(), addresses: new Set(sentinelAddresses(s)) };
    for (const m of text.match(ADDRESS_RUN) ?? []) facts.addresses.add(m.toLowerCase());
    const signed = (raw: unknown): Transaction | null => {
        if (typeof raw !== 'string') return null;
        const tx = parseSigned(raw);
        if (tx?.hash) {
            facts.txHashes.add(tx.hash.toLowerCase());
            if (tx.from) facts.addresses.add(tx.from.toLowerCase());
        }
        return tx;
    };
    const visit = (v: unknown, relay: string | null): void => {
        if (Array.isArray(v)) {
            for (const x of v) visit(x, relay);
            return;
        }
        if (v === null || typeof v !== 'object') return;
        const obj = v as Record<string, unknown>;
        for (const k of Object.keys(obj)) {
            const val = obj[k];
            if (k === 'raw' || (k === 'transaction' && relay === 'bloxroute')) signed(val);
            else if (SIGNED_TX_ARRAYS.has(k) && Array.isArray(val)) {
                const txs = val.map(signed);
                if (txs.length > 0 && txs.every((t) => t?.hash)) facts.bundleHashes.add(keccak256(`0x${txs.map((t) => t!.hash!.slice(2)).join('')}`).toLowerCase());
            } else visit(val, relay);
        }
    };
    for (const d of docs) {
        const relay = d !== null && typeof d === 'object' && typeof (d as { relay?: unknown }).relay === 'string' ? (d as { relay: string }).relay : null;
        visit(d, relay);
    }
    return facts;
}

/** Whether a 0x + 64 hex value, read as a private key, is the key of an address this recording holds. */
function keyOfRecordedAddress(value: string, c: WalkCtx): boolean {
    const n = BigInt(value);
    if (n < KEY_FLOOR || n >= SECP256K1_N) return false;
    return c.facts.addresses.has(computeAddress(value).toLowerCase());
}

function checkUrl(url: string, c: WalkCtx, at: string): void {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        c.out.push(`${at}: an unparseable URL ${JSON.stringify(url)}`);
        return;
    }
    const host = u.hostname.toLowerCase();
    if (LOOPBACK_HOSTS.has(host)) return;
    if (!PUBLIC_HOSTS.includes(host)) {
        c.out.push(`${at}: URL host ${host} is neither loopback nor a public host src/ names`);
        return;
    }
    if (u.username !== '' || u.password !== '') c.out.push(`${at}: URL on ${host} carries a username or password`);
    const longOk = (v: string): boolean => v.length < 20 || ADDRESS.test(v);
    for (const seg of u.pathname.split('/')) {
        const s = decodeURIComponent(seg);
        if (!longOk(s)) c.out.push(`${at}: URL on ${host} has a path segment of ${s.length} characters that is not an address`);
    }
    for (const [name, value] of u.searchParams) {
        if (CREDENTIAL_PARAM.test(name) && !ADDRESS.test(value)) c.out.push(`${at}: URL on ${host} has a credential-like query parameter ${name}`);
        else if (!longOk(value)) c.out.push(`${at}: URL on ${host} has a query value of ${value.length} characters that is not an address`);
    }
}

function checkString(value: string, key: string | null, parent: Record<string, unknown> | unknown[] | null, c: WalkCtx, inArrayOf: string | null): void {
    const at = `${c.file} ${c.where}${key !== null ? ` [${key}]` : inArrayOf !== null ? ` [${inArrayOf}[]]` : ''}`;
    // AC-26.
    if (value.includes('\\')) c.out.push(`${at}: a backslash in a parsed value`);
    if (FILE_LINE.test(value)) c.out.push(`${at}: a file:line fragment`);
    if (STACK_FRAME.test(value)) c.out.push(`${at}: a stack-frame line`);
    if (ENV_LINE.test(value)) c.out.push(`${at}: a .env-style KEY= line`);
    // AC-51 sentinels: exact and allowed, or nowhere.
    if (c.sentinels.values.has(value)) {
        if (!sentinelAllowed(key, value, c.sentinels)) c.out.push(`${at}: a test/.env.test secret sentinel under a key that may not hold it`);
        return;
    }
    for (const s of c.sentinels.values) {
        if (s.length >= 8 && value.includes(s)) {
            c.out.push(`${at}: a string containing a test/.env.test secret sentinel`);
            break;
        }
    }
    // URLs.
    for (const m of value.match(URL_RUN) ?? []) checkUrl(m, c, at);
    // Signed transactions.
    const signedField = key === 'raw' || (inArrayOf !== null && SIGNED_TX_ARRAYS.has(inArrayOf)) || (key === 'transaction' && c.relay === 'bloxroute');
    if (signedField) {
        const tx = parseSigned(value);
        if (!tx) {
            c.out.push(`${at}: a signed transaction that does not parse`);
            return;
        }
        if (key === 'raw' && parent && !Array.isArray(parent) && typeof parent.hash === 'string' && tx.hash !== parent.hash) {
            c.out.push(`${at}: raw transaction hash ${tx.hash} differs from the entry's hash ${String(parent.hash)}`);
        }
        return;
    }
    // Calldata: only a submit entry's request.data (WR-33); a hex `data` anywhere is whole bytes.
    if (key === 'data') {
        if (/^0x[0-9a-fA-F]*$/.test(value) && !WHOLE_BYTES_HEX.test(value)) {
            c.out.push(`${at}: data is not hex of a whole number of bytes`);
            return;
        }
        const entry = c.entry;
        if (c.kind === 'submit' && entry !== null && entry.request !== undefined && parent === entry.request) {
            const tx = typeof entry.raw === 'string' ? parseSigned(entry.raw) : null;
            if (!tx || tx.data.toLowerCase() !== value.toLowerCase()) {
                c.out.push(`${at}: request.data is not the data of the entry's signed raw transaction`);
                return;
            }
            // The ABI words after the 4-byte selector.
            for (let i = 10; i + 64 <= value.length; i += 64) {
                if (keyOfRecordedAddress(`0x${value.slice(i, i + 64)}`, c)) c.out.push(`${at}: a calldata word that is the private key of an address in this recording`);
            }
            return;
        }
        // Not calldata: every rule below applies.
    }
    // Hashes and builder keys in their named fields only, and only real hashes (WR-33).
    if (!HEX64_RUN.test(value)) return;
    if (key !== null && HASH_KEYS.has(key) && HASH_VALUE.test(value)) {
        const lower = value.toLowerCase();
        if (TX_HASH_KEYS.has(key) && c.kind !== 'db' && !c.facts.txHashes.has(lower)) c.out.push(`${at}: a ${key} value that is not the hash of a signed transaction in this recording`);
        else if (key === 'bundleHash' && !c.facts.bundleHashes.has(lower)) c.out.push(`${at}: a bundleHash value that is not the bundle hash of a bundle body in this recording`);
        else if (keyOfRecordedAddress(value, c)) c.out.push(`${at}: a ${key} value that is the private key of an address in this recording`);
        return;
    }
    if (inArrayOf === 'topics' && HASH_VALUE.test(value)) {
        if (keyOfRecordedAddress(value, c)) c.out.push(`${at}: a topic that is the private key of an address in this recording`);
        return;
    }
    if (inArrayOf !== null && BUILDER_KEY_ARRAYS.has(inArrayOf) && BLS_PUBKEY.test(value)) return;
    if (key === 'txHash' && c.relayAnswer !== null && parent === c.relayAnswer.obj && BARE_HASH.test(value) && value.toLowerCase() === c.relayAnswer.bare) return;
    c.out.push(`${at}: a 64-hex run outside a named hash field`);
}

function walk(value: unknown, key: string | null, parent: Record<string, unknown> | unknown[] | null, c: WalkCtx, inArrayOf: string | null): void {
    if (typeof value === 'string') {
        checkString(value, key, parent, c, inArrayOf);
        return;
    }
    if (typeof value === 'number') {
        const at = `${c.file} ${c.where}${key !== null ? ` [${key}]` : ''}`;
        if (Number.isInteger(value) && !Number.isSafeInteger(value)) c.out.push(`${at}: a JSON number above Number.MAX_SAFE_INTEGER`);
        if ((c.kind === 'submit' || c.kind === 'relay') && key !== null && (AMOUNT_KEYS.has(key) || key.startsWith('amount'))) {
            c.out.push(`${at}: an amount written as a JSON number`);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const v of value) walk(v, null, value, c, key ?? inArrayOf);
        return;
    }
    if (value !== null && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        for (const k of Object.keys(obj)) {
            if (HEX64_RUN.test(k)) c.out.push(`${c.file} ${c.where}: a key holding a 64-hex run`);
            walk(obj[k], k, obj, c, null);
        }
    }
}

function knownFindingIds(): Set<string> {
    return new Set(fs.readdirSync(FINDINGS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)));
}

/** Every rule above over one file's raw bytes. Returns the violations (empty when clean). */
export function scanRecordingText(rel: string, raw: Buffer, sentinels: Sentinels, findings: Set<string> = knownFindingIds()): string[] {
    const out: string[] = [];
    const text = raw.toString('utf8');
    if (text.includes('\r')) out.push(`${rel}: a carriage return (AC-26: LF only)`);
    if (rel.endsWith('.json')) {
        let doc: unknown;
        try {
            doc = JSON.parse(text);
        } catch (e) {
            out.push(`${rel}: not valid JSON (${e instanceof Error ? e.message : String(e)})`);
            return out;
        }
        const docFacts = recordingFacts([doc], text, sentinels);
        walk(doc, null, null, { file: rel, sentinels, out, facts: docFacts, where: 'document', kind: null, relay: null, relayAnswer: null, entry: null }, null);
        return out;
    }
    if (!text.endsWith('\n') || text.endsWith('\n\n')) out.push(`${rel}: a recording ends in exactly one LF`);
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    // What the whole file proves, read before any line is judged (WR-33).
    const parsedLines = lines.map((l): unknown => {
        try {
            return JSON.parse(l);
        } catch {
            return null;
        }
    });
    const facts = recordingFacts(parsedLines, text, sentinels);
    const base: Omit<WalkCtx, 'where' | 'kind' | 'relay' | 'relayAnswer' | 'entry'> = { file: rel, sentinels, out, facts };
    let submits = 0;
    let emptyList = 0;
    lines.forEach((line, i) => {
        const where = `line ${i + 1}`;
        if (line === '') {
            out.push(`${rel} ${where}: a blank line`);
            return;
        }
        let entry: unknown;
        try {
            entry = JSON.parse(line);
        } catch (e) {
            out.push(`${rel} ${where}: not valid JSON (${e instanceof Error ? e.message : String(e)})`);
            return;
        }
        const obj = (entry ?? {}) as Record<string, unknown>;
        if (i === 0) {
            const keys = Object.keys(obj);
            if (keys.length !== 2 || keys[0] !== 'scenario' || keys[1] !== 'tag') out.push(`${rel} ${where}: the header is not {"scenario","tag"}`);
            const tag = String(obj.tag);
            if (!TAG_RE.test(tag)) out.push(`${rel} ${where}: tag ${JSON.stringify(tag)} is not KEEP or SUSPECT(<AUD-ID>[,...])`);
            else for (const id of tagIds(tag)) if (!findings.has(id)) out.push(`${rel} ${where}: tag cites ${id}, which is not a finding in the register (AC-21)`);
            const name = path.posix.basename(rel, '.jsonl');
            if (!rel.includes('/') && obj.scenario !== name) out.push(`${rel} ${where}: header scenario ${JSON.stringify(obj.scenario)} is not the file name ${name}`);
        } else if (line === EMPTY_SUBMITTED_LINE) {
            emptyList += 1;
            if (i !== lines.length - 1) out.push(`${rel} ${where}: the empty submitted list is not the last line`);
        } else {
            if (!['op', 'submit', 'relay', 'db'].includes(String(obj.kind))) out.push(`${rel} ${where}: unknown entry kind ${JSON.stringify(obj.kind)}`);
            if (obj.kind === 'submit') submits += 1;
        }
        walk(entry, null, null, { ...base, where, kind: i === 0 ? null : typeof obj.kind === 'string' ? obj.kind : null, relay: typeof obj.relay === 'string' ? obj.relay : null, relayAnswer: i === 0 ? null : relayAnswerOf(obj), entry: i === 0 ? null : obj }, null);
    });
    if (submits === 0 && emptyList !== 1) out.push(`${rel}: a recording with no submit entry must end in ${EMPTY_SUBMITTED_LINE} (AC-22)`);
    if (submits > 0 && emptyList > 0) out.push(`${rel}: a recording with a submit entry holds ${EMPTY_SUBMITTED_LINE}`);
    return out;
}

/** Every .jsonl and .json file under `dir`, recursively, as forward-slash paths relative to it. */
export function recordingFiles(dir: string): string[] {
    const out: string[] = [];
    const visit = (d: string): void => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) visit(full);
            else if (/\.(?:jsonl|json)$/.test(e.name)) out.push(path.relative(dir, full).split(path.sep).join('/'));
        }
    };
    if (fs.existsSync(dir)) visit(dir);
    return out.sort();
}

export function scanRecordingsDir(dir: string, sentinels: Sentinels = readSentinels()): string[] {
    const findings = knownFindingIds();
    return recordingFiles(dir).flatMap((rel) => scanRecordingText(rel, fs.readFileSync(path.join(dir, rel)), sentinels, findings));
}

// ---------------------------------------------------------------------------------------------
// Temp-directory cases
// ---------------------------------------------------------------------------------------------

const tempDirs: string[] = [];
afterEach(() => {
    // Plain removal; a failure here is reported by the next mkdtemp check, never thrown (AUD-TESTI-028:
    // no realpath file declares an afterEach that can throw).
    for (const d of tempDirs.splice(0)) {
        try {
            fs.rmSync(d, { recursive: true, force: true });
        } catch {
            /* left for the OS temp cleaner */
        }
    }
});

function tempRecordings(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-recordings-guard-'));
    tempDirs.push(dir);
    for (const [rel, text] of Object.entries(files)) {
        const file = path.join(dir, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    return dir;
}

const SELF_TEST_WALLET = new Wallet(ethers.id('realpath.plan-23-20.recordings-guard'));
const PLANTED_KEY = ethers.id('realpath.plan-23-20.planted-key');
const ADDR = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

async function signedTx(nonce = 0, data = '0x'): Promise<Transaction> {
    const raw = await SELF_TEST_WALLET.signTransaction({ chainId: 1, nonce, to: ADDR, value: 1n, gasLimit: 21_000n, type: 2, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, data });
    return Transaction.from(raw);
}

/** A Flashbots bundle hash: keccak256 of the bundle's transaction hashes, concatenated (the relay's rule). */
const bundleHashOf = (hashes: string[]): string => ethers.keccak256(`0x${hashes.map((h) => h.slice(2)).join('')}`);
/** A submit line as the serializer writes it, request decoded from the raw transaction. */
const submitOf = (tx: Transaction, at = 1, request: Record<string, unknown> = {}): string =>
    JSON.stringify({ kind: 'submit', at, route: 'public', status: 'accepted', hash: tx.hash, from: tx.from, request: { value: '1', gasLimit: '21000', data: tx.data, ...request }, raw: tx.serialized });

const header = (name: string, tag = 'KEEP'): string => JSON.stringify({ scenario: name, tag });
const op = (fields: Record<string, unknown>, msg = 'message'): string => JSON.stringify({ kind: 'op', at: 1, level: 'info', op: 'x.y', msg, fields, bindings: {} });
/** A bloxroute.relay.accepted op line as src/utils/mevStrategies/bloxroute.ts logs it (plan 23-22 rule). */
const relayAccepted = (relayHash: unknown, signedTxHash: string, opName = 'bloxroute.relay.accepted', extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ kind: 'op', at: 1, level: 'info', op: opName, msg: 'accepted', fields: { op: opName, relayHash, signedTxHash, attempt: 1, ...extra }, bindings: { module: 'mev-bloxroute' } });
/** A one-scenario .jsonl text: header, the given lines, the empty list. */
const recording = (name: string, ...body: string[]): string => `${[header(name), ...body, EMPTY_SUBMITTED_LINE].join('\n')}\n`;

describe('recordings guard (AC-21, AC-22, AC-26, AC-51)', () => {
    it('every recording under test/realpath/recordings passes AC-21, AC-22, AC-26 and AC-51', () => {
        const files = recordingFiles(RECORDINGS_DIR);
        expect(files.length).toBeGreaterThanOrEqual(1);
        expect(scanRecordingsDir(RECORDINGS_DIR)).toEqual([]);
    });

    it('the sentinels are read from test/.env.test: the four keys and the TEST-SENTINEL values', () => {
        const s = readSentinels();
        expect(s.byName.get('PRIVATE_KEY')).toBe(`0x${'0'.repeat(63)}1`);
        expect(s.byName.get('FLASHBOTS_AUTH_KEY')).toBe(`0x${'0'.repeat(63)}2`);
        expect(s.byName.get('BLOXROUTE_AUTH_HEADER')).toBe('TEST-SENTINEL');
        expect(s.byName.get('DEPLOY_PRIVATE_KEY')).toBe(`0x${'0'.repeat(63)}3`);
        expect(s.byName.get('TEST_WALLET_PRIVATE_KEY')).toBe(`0x${'0'.repeat(63)}4`);
        expect(s.byName.has('TELEGRAM_CHAT_ID')).toBe(false);
    });

    it('each listed public host appears in src/ as a string or template literal (comments excluded)', () => {
        const literals: string[] = [];
        const visit = (dir: string): void => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) visit(full);
                else if (/\.ts$/.test(e.name) && !e.name.endsWith('.d.ts')) {
                    const sf = ts.createSourceFile(full, fs.readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, false);
                    const take = (n: ts.Node): void => {
                        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) literals.push(n.text);
                        n.forEachChild(take);
                    };
                    take(sf);
                }
            }
        };
        visit(SRC_DIR);
        expect(literals.length).toBeGreaterThan(100);
        const missing = PUBLIC_HOSTS.filter((h) => !literals.some((t) => t.includes(h)));
        expect(missing).toEqual([]);
        // A host that src/ does not name is not found (the check can fail).
        expect(literals.some((t) => t.includes('evil.example.com'))).toBe(false);
    });

    it('bad cases fail, each for its own rule', async () => {
        const s = readSentinels();
        const tx = await signedTx();
        const other = await signedTx(1);
        // A transaction whose calldata carries the signer's own key as one ABI word (selector + word).
        const keyInData = await signedTx(2, `0xa9059cbb${SELF_TEST_WALLET.privateKey.slice(2)}`);
        const cases: Record<string, { text: string; rule: RegExp }> = {
            'planted-key-field.jsonl': { text: recording('planted-key-field', op({ note: PLANTED_KEY })), rule: /64-hex run outside a named hash field/ },
            'planted-key-message.jsonl': { text: recording('planted-key-message', op({}, `signing with ${PLANTED_KEY} now`)), rule: /64-hex run outside a named hash field/ },
            'wallet-key-not-sentinel.jsonl': { text: recording('wallet-key-not-sentinel', op({ walletPrivateKey: PLANTED_KEY })), rule: /64-hex run outside a named hash field/ },
            'sentinel-wrong-key.jsonl': { text: recording('sentinel-wrong-key', op({ note: s.byName.get('PRIVATE_KEY') })), rule: /sentinel under a key that may not hold it/ },
            'sentinel-in-text.jsonl': { text: recording('sentinel-in-text', op({}, 'header TEST-SENTINEL sent')), rule: /containing a test\/\.env\.test secret sentinel/ },
            'raw-unparseable.jsonl': { text: recording('raw-unparseable', JSON.stringify({ kind: 'op', at: 1, fields: { raw: '0x02deadbeef' } })), rule: /signed transaction that does not parse/ },
            'raw-hash-mismatch.jsonl': {
                text: `${[header('raw-hash-mismatch'), JSON.stringify({ kind: 'submit', at: 1, route: 'public', status: 'accepted', hash: other.hash, raw: tx.serialized })].join('\n')}\n`,
                rule: /differs from the entry's hash/,
            },
            'url-host.jsonl': { text: recording('url-host', op({ url: 'https://evil.example.com/x' })), rule: /neither loopback nor a public host/ },
            'url-userinfo.jsonl': { text: recording('url-userinfo', op({ url: 'https://user:pass@api.honeypot.is/v2/IsHoneypot' })), rule: /username or password/ },
            'url-apikey.jsonl': { text: recording('url-apikey', op({ url: 'https://api.gopluslabs.io/api/v1/token_security/1?apiKey=abc' })), rule: /credential-like query parameter apiKey/ },
            'url-long-segment.jsonl': { text: recording('url-long-segment', op({ url: 'https://etherscan.io/abcdefghijklmnopqrstuvwxyz012345' })), rule: /path segment of 32 characters/ },
            'cr.jsonl': { text: recording('cr', op({ a: 1 })).replace('\n', '\r\n'), rule: /carriage return/ },
            'backslash.jsonl': { text: recording('backslash', op({ path: 'C:\\Users\\someone' })), rule: /backslash in a parsed value/ },
            'amount-number.jsonl': {
                text: `${[header('amount-number'), JSON.stringify({ kind: 'submit', at: 1, route: 'public', status: 'accepted', hash: tx.hash, request: { value: 1000 }, raw: tx.serialized })].join('\n')}\n`,
                rule: /amount written as a JSON number/,
            },
            'file-line.jsonl': { text: recording('file-line', op({}, 'failed at bot.ts:123')), rule: /file:line fragment/ },
            'stack.jsonl': { text: recording('stack', op({ e: 'Error: x\n    at run (internal)' })), rule: /stack-frame line/ },
            'env-line.jsonl': { text: recording('env-line', op({ e: 'PRIVATE_KEY=abc' })), rule: /\.env-style KEY= line/ },
            'unsafe-number.jsonl': { text: recording('unsafe-number', op({ n: 12345678901234567890 })), rule: /above Number\.MAX_SAFE_INTEGER/ },
            'calldata.jsonl': { text: recording('calldata', op({ data: '0xabc' })), rule: /not hex of a whole number of bytes/ },
            'unknown-id.jsonl': { text: `${[header('unknown-id', 'SUSPECT(AUD-EXIT-999)'), EMPTY_SUBMITTED_LINE].join('\n')}\n`, rule: /not a finding in the register/ },
            'no-empty-list.jsonl': { text: `${header('no-empty-list')}\n`, rule: /must end in \{"submitted":\[\]\}/ },
            'env/BAD_VAR.json': { text: JSON.stringify({ note: PLANTED_KEY }), rule: /64-hex run outside a named hash field/ },
            // The plan 23-22 bloXroute answer rule is that one field of that one op, holding that one value.
            'relay-answer-other-hash.jsonl': { text: recording('relay-answer-other-hash', relayAccepted({ txHash: PLANTED_KEY.slice(2) }, tx.hash!)), rule: /64-hex run outside a named hash field/ },
            'relay-answer-other-op.jsonl': { text: recording('relay-answer-other-op', relayAccepted({ txHash: tx.hash!.slice(2) }, tx.hash!, 'x.y')), rule: /64-hex run outside a named hash field/ },
            'relay-answer-other-field.jsonl': { text: recording('relay-answer-other-field', relayAccepted({ txHash: tx.hash!.slice(2) }, tx.hash!, 'bloxroute.relay.accepted', { note: tx.hash!.slice(2) })), rule: /64-hex run outside a named hash field/ },
            'relay-answer-nested.jsonl': { text: recording('relay-answer-nested', relayAccepted({ txHash: tx.hash!.slice(2), inner: { txHash: tx.hash!.slice(2) } }, tx.hash!)), rule: /64-hex run outside a named hash field/ },
            // WR-33: `data` is calldata only at a submit entry's request.data; a hash field holds a real hash.
            'planted-key-data.jsonl': { text: recording('planted-key-data', op({ data: PLANTED_KEY })), rule: /64-hex run outside a named hash field/ },
            'planted-key-data-blob.jsonl': { text: recording('planted-key-data-blob', op({ data: `0x${'ab'.repeat(4)}${PLANTED_KEY.slice(2)}${'cd'.repeat(4)}` })), rule: /64-hex run outside a named hash field/ },
            'planted-key-data-db.jsonl': { text: recording('planted-key-data-db', JSON.stringify({ kind: 'db', at: 1, table: 'trades', op: 'insert', inTransaction: false, row: { data: PLANTED_KEY } })), rule: /64-hex run outside a named hash field/ },
            'planted-key-hash.jsonl': { text: recording('planted-key-hash', op({ hash: PLANTED_KEY })), rule: /not the hash of a signed transaction in this recording/ },
            'planted-key-txhash.jsonl': { text: `${[header('planted-key-txhash'), submitOf(tx), op({ txHash: PLANTED_KEY })].join('\n')}\n`, rule: /not the hash of a signed transaction in this recording/ },
            'planted-key-bundlehash.jsonl': { text: recording('planted-key-bundlehash', op({ bundleHash: PLANTED_KEY })), rule: /not the bundle hash of a bundle body in this recording/ },
            'wallet-key-in-topics.jsonl': { text: recording('wallet-key-in-topics', op({ wallet: SELF_TEST_WALLET.address, topics: [SELF_TEST_WALLET.privateKey] })), rule: /private key of an address in this recording/ },
            'wallet-key-in-db-hash.jsonl': {
                text: recording('wallet-key-in-db-hash', op({ wallet: SELF_TEST_WALLET.address }), JSON.stringify({ kind: 'db', at: 1, table: 'trades', op: 'insert', inTransaction: false, row: { tx_hash: SELF_TEST_WALLET.privateKey } })),
                rule: /private key of an address in this recording/,
            },
            'submit-data-not-raw.jsonl': { text: `${[header('submit-data-not-raw'), submitOf(tx, 1, { data: `0x${'00'.repeat(4)}` })].join('\n')}\n`, rule: /request\.data is not the data of the entry's signed raw transaction/ },
            'wallet-key-in-calldata.jsonl': { text: `${[header('wallet-key-in-calldata'), submitOf(keyInData)].join('\n')}\n`, rule: /private key of an address in this recording/ },
        };
        const dir = tempRecordings(Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v.text])));
        const findings = knownFindingIds();
        for (const [rel, c] of Object.entries(cases)) {
            const v = scanRecordingText(rel, fs.readFileSync(path.join(dir, rel)), s, findings);
            expect.soft(v.some((x) => c.rule.test(x)), `${rel} must fail with ${c.rule}: ${JSON.stringify(v)}`).toBe(true);
        }
        // The directory scan finds them too.
        expect(scanRecordingsDir(dir, s).length).toBeGreaterThanOrEqual(Object.keys(cases).length);
    });

    it('good cases pass: explorer, honeypot.is and unicrypt URLs, the bloXroute endpoint, registry auth sentinels, real signed bodies, an escaped quote', async () => {
        const s = readSentinels();
        const tx = await signedTx();
        const tx2 = await signedTx(1);
        const pairAddr = '0xe1ebd0d04eb69d3bd48fb1d3c89f73755c524e92';
        const files: Record<string, string> = {
            'good-urls.jsonl': recording(
                'good-urls',
                op({ explorerUrl: 'https://etherscan.io', ws: 'ws://127.0.0.1:1', relayUrl: 'https://relay.flashbots.net' }),
                op({ url: `https://api.honeypot.is/v2/IsHoneypot?address=${ADDR}&chainID=1` }),
                op({ url: `https://api.unicrypt.network/api/v2/locker/pair/${pairAddr}?chainId=1` }),
                op({ url: `https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${ADDR}` }),
                op({ endpoint: 'https://api.blxrbdn.com' }),
            ),
            'good-sentinels.jsonl': recording(
                'good-sentinels',
                op({ mevConfig: { relayUrl: 'https://relay.flashbots.net', network: 'mainnet', authKey: s.byName.get('FLASHBOTS_AUTH_KEY') } }),
                op({ mevConfig: { endpoint: 'https://api.blxrbdn.com', authHeader: 'TEST-SENTINEL' }, walletPrivateKey: s.byName.get('PRIVATE_KEY') }),
            ),
            'good-bodies.jsonl': `${[
                header('good-bodies'),
                JSON.stringify({ kind: 'relay', at: 1, relay: 'bloxroute', url: 'https://api.blxrbdn.com', method: 'bsc_private_tx', params: { transaction: tx.serialized.slice(2) } }),
                JSON.stringify({ kind: 'relay', at: 2, relay: 'flashbots', url: 'https://relay.flashbots.net', method: 'eth_sendBundle', params: [{ txs: [tx.serialized, tx2.serialized], blockNumber: '0x1' }] }),
                JSON.stringify({ kind: 'submit', at: 3, route: 'bundle', status: 'accepted', hash: tx.hash, request: { value: '1', gasLimit: '21000', maxFeePerGas: '2', maxPriorityFeePerGas: '1', data: '0x' }, raw: tx.serialized }),
                op({ txHash: tx.hash, bundleHash: bundleHashOf([tx.hash!, tx2.hash!]), topics: [tx.hash], consideredByBuilders: [`0x${'ab'.repeat(48)}`], gasMultiplier: 1.2, amountOut: '5' }, 'Reconciled late inclusion — native confirm lied "not included"'),
                // A seeded db row (the risk-gate scenario) holds a made-up hash of no signed transaction.
                JSON.stringify({ kind: 'db', at: 4, table: 'trades', op: 'insert', inTransaction: false, row: { tx_hash: ethers.id('realpath.plan-23-20.seeded-row'), status: 'pending' } }),
            ].join('\n')}\n`,
            // bloXroute's answer (hex without 0x) beside the hash the bot signed (the plan 23-22 rule),
            // each after the relay body that carried that signed transaction.
            'good-relay-answer.jsonl': recording(
                'good-relay-answer',
                JSON.stringify({ kind: 'relay', at: 1, relay: 'bloxroute', url: 'https://api.blxrbdn.com', method: 'bsc_private_tx', params: { transaction: tx.serialized.slice(2) } }),
                relayAccepted({ txHash: tx.hash!.slice(2) }, tx.hash!),
                JSON.stringify({ kind: 'relay', at: 2, relay: 'bloxroute', url: 'https://api.blxrbdn.com', method: 'bsc_private_tx', params: { transaction: tx2.serialized.slice(2) } }),
                relayAccepted({ txHash: tx2.hash!.slice(2).toUpperCase() }, tx2.hash!),
            ),
            'env/_baseline.json': JSON.stringify({ PRIVATE_KEY: s.byName.get('PRIVATE_KEY'), FLASHBOTS_AUTH_KEY: s.byName.get('FLASHBOTS_AUTH_KEY'), ratio: { $nonFinite: 'Infinity' } }),
        };
        const dir = tempRecordings(files);
        expect(scanRecordingsDir(dir, s)).toEqual([]);
        // The escaped quote is in the raw file, not in the parsed value.
        expect(fs.readFileSync(path.join(dir, 'good-bodies.jsonl'), 'utf8')).toContain('\\"not included\\"');
    });
});

describe('serializer (AC-22, AC-26)', () => {
    it('AC-22: a timeline with no submit entry ends in the exact line {"submitted":[]}, and one with a submit entry does not hold it', async () => {
        const opEntry: TimelineEntry = { kind: 'op', at: 5, level: 'info', op: 'risk.refused', msg: 'refused', fields: { op: 'risk.refused' }, bindings: {} };
        const none = serializeTimeline([opEntry], { scenario: 'no-submit', tag: 'KEEP' });
        expect(EMPTY_SUBMITTED_LINE).toBe('{"submitted":[]}');
        expect(EMPTY_SUBMITTED_LINE).toHaveLength(16);
        const lines = none.split('\n');
        expect(lines.pop()).toBe('');
        expect(lines[lines.length - 1]).toBe('{"submitted":[]}');
        expect(serializeTimeline([], { scenario: 'empty', tag: 'KEEP' })).toBe('{"scenario":"empty","tag":"KEEP"}\n{"submitted":[]}\n');

        const tx = await signedTx();
        const submit: TimelineEntry = { kind: 'submit', at: 6, route: 'public', hash: tx.hash!, raw: tx.serialized, from: tx.from!, to: tx.to, nonce: tx.nonce, status: 'accepted' };
        const withSubmit = serializeTimeline([opEntry, submit], { scenario: 'with-submit', tag: 'KEEP' });
        expect(withSubmit).not.toContain('"submitted":[]');
        // The submit line carries the decoded request, amounts as whole-number text.
        const line = JSON.parse(withSubmit.split('\n')[2]) as { request: Record<string, unknown> };
        expect(line.request).toEqual({ type: 2, chainId: '1', nonce: 0, to: ADDR, value: '1', gasLimit: '21000', maxFeePerGas: '2', maxPriorityFeePerGas: '1', data: '0x' });
    });

    it('normalization: BigInt text, distinct non-finite objects, unsafe doubles, errors without stack, no paths or line numbers, no ethers version', () => {
        const err = Object.assign(new Error(`could not coalesce error (error={ }, payload=null, code=UNKNOWN_ERROR, version=6.16.0) at ${path.join(REPO_ROOT, 'src', 'bot.ts')}:120:7`), { code: 'UNKNOWN_ERROR' });
        const n = normalizeForRecording({
            big: 12345678901234567890123n,
            nan: NaN,
            inf: Infinity,
            ninf: -Infinity,
            unsafe: 2 ** 60,
            safe: 49849999502,
            negZero: -0,
            err,
            missing: undefined,
            list: [1n, undefined],
            when: new Date(0),
        }) as Record<string, unknown>;
        expect(n).toEqual({
            big: '12345678901234567890123',
            nan: { $nonFinite: 'NaN' },
            inf: { $nonFinite: 'Infinity' },
            ninf: { $nonFinite: '-Infinity' },
            unsafe: { $unsafeNumber: String(2 ** 60) },
            safe: 49849999502,
            negZero: 0,
            err: { $error: { name: 'Error', code: 'UNKNOWN_ERROR', message: 'could not coalesce error (error={ }, payload=null, code=UNKNOWN_ERROR) at <path>' } },
            list: ['1', null],
            when: '1970-01-01T00:00:00.000Z',
        });
        expect(JSON.stringify(n)).not.toContain('stack');
        expect(normalizeForRecording('see src/x.ts:12:3 and lib/y.js:4')).toBe('see src/x.ts and lib/y.js');
        expect(normalizeForRecording('Error: boom\n    at f (x)\n    at g (y)')).toBe('Error: boom');
        // A cycle and a live object never drag their graph in.
        const cyc: Record<string, unknown> = { a: 1 };
        cyc.self = cyc;
        expect(normalizeForRecording(cyc)).toEqual({ a: 1, self: { $circular: true } });
        class Live {
            x = 1;
        }
        expect(normalizeForRecording({ live: new Live() })).toEqual({ live: { $class: 'Live' } });
        expect(recordingLine({ v: 1n })).toBe('{"v":"1"}');
    });

    it('tags: KEEP or SUSPECT with comma-separated register IDs, no spaces, no repeats', () => {
        expect(tagIds('KEEP')).toEqual([]);
        expect(tagIds('SUSPECT(AUD-DB-004,AUD-EXIT-001)')).toEqual(['AUD-DB-004', 'AUD-EXIT-001']);
        expect(() => tagIds('SUSPECT(AUD-DB-004, AUD-EXIT-001)')).toThrow(/no spaces/);
        expect(() => tagIds('SUSPECT(AUD-DB-004,AUD-DB-004)')).toThrow(/twice/);
        expect(() => tagIds('suspect')).toThrow();
        expect(() => serializeTimeline([], { scenario: 'Bad Name', tag: 'KEEP' })).toThrow(/kebab-case/);
    });
});

// ---------------------------------------------------------------------------------------------
// Plan 23-20 Task 3: compare and write (AC-25), order (AC-23)
// ---------------------------------------------------------------------------------------------

/** Run `fn` with the update switch and CI as given (undefined removes them), restoring both after. */
function withEnv<T>(env: { update: string | undefined; ci: string | undefined }, fn: () => T): T {
    const saved = { update: process.env[UPDATE_SWITCH], ci: process.env.CI };
    const apply = (k: string, v: string | undefined): void => {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    };
    apply(UPDATE_SWITCH, env.update);
    apply('CI', env.ci);
    try {
        return fn();
    } finally {
        apply(UPDATE_SWITCH, saved.update);
        apply('CI', saved.ci);
    }
}

/** A recording's entry lines: the header and the empty-list line left out. */
function bodyLines(text: string): string[] {
    return text.split('\n').filter((l, i) => i > 0 && l !== '' && l !== EMPTY_SUBMITTED_LINE);
}

describe('compare and write (AC-25), order (AC-23)', () => {
    it('AC-25: with the update switch unset, a changed input fails naming the first differing line and leaves the temp recording byte-unchanged; an absent one fails and creates nothing', () => {
        const original = '{"scenario":"x","tag":"KEEP"}\n{"kind":"op","at":1}\n{"submitted":[]}\n';
        const changed = original.replace('"at":1', '"at":2');
        const dir = tempRecordings({ 'x.jsonl': original });
        const file = path.join(dir, 'x.jsonl');
        const before = fs.readFileSync(file);
        withEnv({ update: undefined, ci: undefined }, () => {
            expect(updateAllowed()).toBe(false);
            expect(compareRecording('x.jsonl', original, { dir })).toBe('match');
            expect(() => compareRecording('x.jsonl', changed, { dir })).toThrow(/x\.jsonl differs[\s\S]*first difference at line 2:[\s\S]*"at":1[\s\S]*"at":2/);
            expect(fs.readFileSync(file).equals(before)).toBe(true);
            expect(() => compareRecording('y.jsonl', original, { dir })).toThrow(/no recording at y\.jsonl[\s\S]*npm run recordings:update/);
            expect(fs.existsSync(path.join(dir, 'y.jsonl'))).toBe(false);
            expect(() => compareRecording('env/SOME_VAR.json', '{}\n', { dir })).toThrow(/no recording at env\/SOME_VAR\.json/);
            expect(fs.existsSync(path.join(dir, 'env'))).toBe(false);
            // A carriage return is refused before anything is compared.
            expect(() => compareRecording('x.jsonl', original.replace('\n', '\r\n'), { dir })).toThrow(/carriage return/);
        });
        // CI set: the switch alone never writes.
        withEnv({ update: '1', ci: 'true' }, () => {
            expect(updateAllowed()).toBe(false);
            expect(() => compareRecording('x.jsonl', changed, { dir })).toThrow(/differs/);
            expect(fs.readFileSync(file).equals(before)).toBe(true);
        });
        // A switch value other than "1" never writes either.
        withEnv({ update: 'true', ci: undefined }, () => {
            expect(updateAllowed()).toBe(false);
            expect(() => compareRecording('x.jsonl', changed, { dir })).toThrow(/differs/);
            expect(fs.readFileSync(file).equals(before)).toBe(true);
        });
        // Only "1" with CI unset writes: what scripts/update-recordings.ts sets up for its one run.
        withEnv({ update: '1', ci: undefined }, () => {
            expect(compareRecording('x.jsonl', changed, { dir })).toBe('written');
            expect(fs.readFileSync(file, 'utf8')).toBe(changed);
            expect(compareRecording('env/SOME_VAR.json', '{"a":1}\n', { dir })).toBe('written');
            expect(fs.readFileSync(path.join(dir, 'env', 'SOME_VAR.json'), 'utf8')).toBe('{"a":1}\n');
            expect(compareRecording('x.jsonl', changed, { dir })).toBe('match');
        });
    });

    it('a recording path is relative to the recordings folder, carries .jsonl or .json, and cannot leave it', () => {
        const dir = tempRecordings({});
        for (const bad of ['../x.jsonl', 'a/../../x.jsonl', path.join(os.tmpdir(), 'x.jsonl'), 'C:/x.jsonl', 'x.txt', 'x', 'a\\x.jsonl', '']) {
            expect(() => resolveRecordingPath(bad, dir), JSON.stringify(bad)).toThrow();
        }
        expect(resolveRecordingPath('env/PRIVATE_KEY.json', dir)).toBe(path.join(dir, 'env', 'PRIVATE_KEY.json'));
        expect(resolveRecordingPath('flashbots-v2-trailing.jsonl')).toBe(path.join(RECORDINGS_DIR, 'flashbots-v2-trailing.jsonl'));
    });

    it('AC-25: the update switch is set only by scripts/update-recordings.ts (this file sets it only around its temp-directory cases)', () => {
        const name = UPDATE_SWITCH;
        expect(name).toBe('VITEST_CSB_UPDATE_RECORDINGS');
        const textFile = /\.(?:ts|tsx|js|cjs|mjs|json|yml|yaml|sh)$/;
        const mentions: string[] = [];
        const visit = (dir: string): void => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                if (e.name === 'node_modules' || e.name === '.git') continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory()) visit(full);
                else if (textFile.test(e.name) && fs.readFileSync(full, 'utf8').includes(name)) mentions.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
            }
        };
        for (const d of ['src', 'scripts', 'test', '.github', 'dashboard']) if (fs.existsSync(path.join(REPO_ROOT, d))) visit(path.join(REPO_ROOT, d));
        // Top-level files (package.json scripts, vitest.config.ts, ...).
        for (const e of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
            if (e.isFile() && textFile.test(e.name) && fs.readFileSync(path.join(REPO_ROOT, e.name), 'utf8').includes(name)) mentions.push(e.name);
        }
        expect(mentions.sort()).toEqual(['scripts/update-recordings.ts', 'test/realpath/harness/serializer.ts', 'test/realpath/recordingsGuard.test.ts']);
        // The serializer only reads it: no assignment to process.env anywhere in that file.
        const serializerText = fs.readFileSync(path.join(REPO_ROOT, 'test', 'realpath', 'harness', 'serializer.ts'), 'utf8');
        expect(serializerText).not.toMatch(/process\.env(?:\[[^\]]+\]|\.[A-Za-z_]+)\s*=(?!=)/);
        expect(serializerText).toContain(`'${name}'`);
    });

    it('AC-23: serializeTimeline keeps the order it was given (same-time entries included), and no committed recording is sorted by content', () => {
        const entries: TimelineEntry[] = [
            { kind: 'db', at: 9, table: 'trades', op: 'insert', row: { id: 2n }, inTransaction: false },
            { kind: 'op', at: 1, level: 'info', op: 'z.last', msg: 'z', fields: { op: 'z.last' }, bindings: {} },
            { kind: 'relay', at: 5, relay: 'flashbots', url: 'https://relay.flashbots.net', method: 'eth_sendBundle', params: [] },
            { kind: 'op', at: 5, level: 'info', op: 'a.first', msg: 'a', fields: { op: 'a.first' }, bindings: {} },
            { kind: 'db', at: 5, table: 'exit_state', op: 'delete', row: { trade_id: 1n }, inTransaction: false },
        ];
        const body = bodyLines(serializeTimeline(entries, { scenario: 'order', tag: 'KEEP' })).map((l) => JSON.parse(l) as { kind: string; at: number });
        expect(body.map((e) => `${e.kind}@${e.at}`)).toEqual(['db@9', 'op@1', 'relay@5', 'op@5', 'db@5']);

        const files = recordingFiles(RECORDINGS_DIR).filter((f) => f.endsWith('.jsonl'));
        expect(files.length).toBeGreaterThanOrEqual(1);
        for (const rel of files) {
            const text = fs.readFileSync(path.join(RECORDINGS_DIR, rel), 'utf8');
            const lines = bodyLines(text);
            const entries = lines.map((l) => JSON.parse(l) as { kind: string; at: number });
            // Recorded order is time order on the fake clock: `at` never goes back.
            for (let i = 1; i < entries.length; i++) expect(entries[i].at, `${rel} body line ${i + 1} is in recorded (time) order`).toBeGreaterThanOrEqual(entries[i - 1].at);
            // Plan 23-22: a scenario with no submission (AC-22: it ends in the empty list) can be a
            // few entries of one kind (a risk-gate refusal seeds db rows only) or none at all
            // (today's AUD-BUY-016 skip), where "not sorted" cannot tell recorded order from a
            // sort. Every recording with a submission is a buy and its trail, and keeps the full
            // check; so does any longer recording whose kinds interleave.
            const kinds = entries.map((e) => e.kind);
            const submitted = kinds.includes('submit');
            if (!submitted && (lines.length < 3 || new Set(kinds).size < 2)) {
                expect(text.endsWith(`${EMPTY_SUBMITTED_LINE}\n`), `${rel} has no submission and ends in the empty list`).toBe(true);
                continue;
            }
            expect(lines.length, rel).toBeGreaterThan(2);
            expect(lines, `${rel} is in recorded order, not sorted by content`).not.toEqual([...lines].sort());
            // Never re-ordered by kind either: the kinds interleave as things happened.
            expect(kinds, rel).not.toEqual([...kinds].sort());
        }
    });

    it('AC-23: the trailing-stop recording holds the known order of a buy and its exit, same-time entries included', () => {
        type Line = { kind: string; at: number; op?: string; table?: string; route?: string; method?: string; row?: Record<string, unknown>; fields?: Record<string, unknown> };
        const lines = bodyLines(fs.readFileSync(path.join(RECORDINGS_DIR, 'flashbots-v2-trailing.jsonl'), 'utf8')).map((l) => JSON.parse(l) as Line);
        const at = (pred: (e: Line) => boolean, what: string): number => {
            const i = lines.findIndex(pred);
            expect(i, what).toBeGreaterThanOrEqual(0);
            return i;
        };
        const buyBodies = lines.slice(0, at((e) => e.kind === 'db' && e.table === 'trades' && e.row?.action === 'buy', 'buy row')).filter((e) => e.kind === 'relay' && e.method === 'eth_sendBundle');
        expect(buyBodies.length).toBeGreaterThanOrEqual(1);
        const order = [
            at((e) => e.kind === 'relay' && e.method === 'eth_callBundle', 'buy simulation'),
            at((e) => e.kind === 'submit' && e.route === 'bundle', 'buy submit'),
            at((e) => e.kind === 'op' && e.op === 'flashbots.bundle.included', 'buy included'),
            at((e) => e.kind === 'db' && e.table === 'trades' && e.op === 'insert' && e.row?.action === 'buy', 'buy row (after every relay body: CAP-14)'),
            at((e) => e.kind === 'db' && e.table === 'exit_state' && e.op === 'insert', 'exit state'),
            at((e) => e.kind === 'op' && e.op === 'exit.trailing.activated', 'trailing activated'),
            at((e) => e.kind === 'op' && e.op === 'exit.trigger.trailing-stop', 'trigger'),
            at((e) => e.kind === 'submit' && e.route === 'public', 'approve'),
            at((e) => e.kind === 'op' && e.op === 'exit.full.submitted', 'exit submitted'),
            at((e) => e.kind === 'submit' && e.route === 'bundle' && lines.indexOf(e) > lines.findIndex((x) => x.op === 'exit.full.submitted'), 'sell submit'),
            at((e) => e.kind === 'op' && e.op === 'exit.full.executed', 'exit executed'),
            at((e) => e.kind === 'op' && e.op === 'exit.receipt.decoded', 'receipt decoded'),
            at((e) => e.kind === 'db' && e.table === 'trades' && e.op === 'insert' && e.row?.action === 'sell', 'sell row'),
            at((e) => e.kind === 'db' && e.table === 'trades' && e.op === 'update' && e.row?.status === 'sold', 'buy row sold'),
            at((e) => e.kind === 'db' && e.table === 'exit_state' && e.op === 'delete', 'exit state deleted'),
            at((e) => e.kind === 'op' && e.op === 'antirug.unregister', 'anti-rug unregistered'),
        ];
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(new Set(order).size).toBe(order.length);
        // Same fake-clock time, kept in the order it happened (not sorted by kind): the buy's
        // inclusion op, its stats relay body, the stats op, then the row.
        const included = order[2];
        expect(lines.slice(included, included + 4).map((e) => `${e.kind}:${e.kind === 'db' ? `${e.table}.${e.op}` : e.kind === 'relay' ? e.method : e.op}`)).toEqual([
            'op:flashbots.bundle.included',
            'relay:flashbots_getBundleStatsV2',
            'op:flashbots.bundle.stats',
            'db:trades.insert',
        ]);
        expect(new Set(lines.slice(included, included + 4).map((e) => e.at)).size).toBe(1);
    });
});
