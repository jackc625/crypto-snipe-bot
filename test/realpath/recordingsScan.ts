// test/realpath/recordingsScan.ts
// Phase 23 review WR-35: the recording guard's scan, moved out of test/realpath/recordingsGuard.test.ts
// so that scripts/update-recordings.ts runs the same rules over every recording after a re-record,
// before anything is committed, and the guard test runs them in every realpath run. Nothing here
// reads a path of its own: every function takes the folder or file it reads (guardPaths gives the
// repo's), so the module loads the same under Vitest (ESM) and ts-node (CommonJS). It does not import
// the serializer, whose import.meta.url ts-node cannot compile: EMPTY_SUBMITTED_LINE, TAG_RE and
// tagIds are kept here equal to the serializer's, and the guard test checks that they are.
//
// The rules (originally the header of recordingsGuard.test.ts):
//   Phase 23 plan 23-20 (CHAR-02, AC-21, AC-22, AC-26, AC-51; T-23-25): the guards every golden-master
//   recording and env snapshot must pass before its first commit, here and in plans 23-21, 23-22 and
//   23-23. It walks every .jsonl and .json file under test/realpath/recordings/**, parses each .jsonl
//   line and each .json file, and walks every value with its key name.
//
//   AC-26 (D-12): the raw file has no CR; a parsed string holds no backslash (the backslash of a JSON
//   escape such as \" is not in the parsed value, so it passes), no `file:line` fragment (a .ts, .js,
//   .cjs or .mjs name followed by a colon and digits) and no stack-frame line. In submit and relay
//   entries, value, gasLimit, gasPrice, maxFeePerGas, maxPriorityFeePerGas and any key beginning
//   `amount` are never JSON numbers (amounts are whole-number text), and no JSON number anywhere is an
//   integer above Number.MAX_SAFE_INTEGER. Settings such as gasMultiplier stay numbers.
//
//   AC-51, field-aware (a recording's transaction and bundle hashes are 64-hex values, so a blanket
//   64-hex rejection would reject every valid recording):
//     - Sentinels: the values of test/.env.test under a key matching KEY, TOKEN, SESSION, HASH, SECRET
//       or AUTH. A value equal to one is allowed only under walletPrivateKey (must equal PRIVATE_KEY's),
//       authKey (FLASHBOTS_AUTH_KEY's), authHeader (BLOXROUTE_AUTH_HEADER's) or a key that is that
//       variable's own name (how plan 23-23's _baseline.json records its input). The chain registry
//       carries mevConfig.authKey / mevConfig.authHeader (src/chainRegistry.ts), inert sentinels. A
//       string that CONTAINS a sentinel without being exactly that allowed value fails too.
//     - Secret fields (Phase 23 review WR-34): walletPrivateKey, authKey, authHeader, and any key named
//       like a secret variable (upper-case, matching the sentinel key pattern) hold their sentinel or
//       one of the env matrix's case values ('', '0', 'abc'), and nothing else.
//     - Secret shapes (WR-34), in any string: a Telegram bot token (digits:30+ token characters), a
//       32-hex run, a Bearer credential, a URL of any scheme with a user name or password, and a run of
//       32 or more token characters (letters, digits, _ + / = -) that is not hex and mixes upper case,
//       lower case and digits (a base64 session) or upper case and digits (an explorer API key).
//     - Hashes: otherwise a 64-hex value is allowed only as the whole value (0x + 64 hex) of a named
//       hash field (HASH_KEYS: the hash-carrying keys src/ uses in its logs and DB columns) or an entry
//       of `topics`, and even there it must be a real hash (Phase 23 review WR-33): a transaction-hash
//       field (TX_HASH_KEYS) outside a db row must be the hash of a signed transaction in the same
//       recording, and a bundleHash must be the bundle hash (keccak256 of the transaction hashes, the
//       relay's rule) of a bundle body in the same recording. A db row may hold a made-up hash (the
//       risk-gate scenario seeds rows of no signed transaction).
//     - Keys of a recorded address (WR-33): a 64-hex value accepted by any rule here (a hash field, a
//       topic, a calldata word) fails when, read as a secp256k1 private key, it is the key of an address
//       that appears in the same recording (a signer, a wallet, any 0x + 40 hex) or of a test/.env.test
//       key sentinel. Values below 2^160 (amounts, padded addresses, the tiny sentinels, which the
//       sentinel rule catches) are not read as keys.
//     - Builder keys: an entry of consideredByBuilders / sealedByBuilders may be a 48-byte BLS public
//       key (0x + 96 hex). src/utils/mevStrategies/flashbots.ts logs these from the relay's
//       flashbots_getBundleStatsV2 answer (stats.consideredByBuildersAt[].pubkey): public builder
//       identities, not secrets. Added in plan 23-20 when the first real recording held them.
//     - bloXroute's answer hash: in an op line whose op is bloxroute.relay.accepted, the txHash of the
//       fields' relayHash object may be the bare 64 hex (no 0x) of that same line's signedTxHash.
//       bloXroute answers bsc_private_tx with { txHash } as hex without 0x, and
//       src/utils/mevStrategies/bloxroute.ts logs that answer whole as relayHash beside the hash it
//       signed itself; it is the public transaction hash, not a secret. Only that one field of that
//       one op, and only when it equals the line's own signedTxHash. Added in plan 23-22 when the
//       first bloXroute recording held it.
//     - Signed transactions: `raw`, each entry of `signedTransactions` and `txs`, and the bloXroute
//       body's `transaction` must parse through real Transaction.from, and a `raw` whose hash differs
//       from its entry's `hash` fails.
//     - Calldata: a hex `data` value must be hex of a whole number of bytes. Only a submit entry's
//       request.data is calldata (WR-33): it must equal the data of the entry's own signed raw
//       transaction, and its 32-byte ABI words get the key rule above. A `data` key anywhere else gets
//       every other rule, the 64-hex rule included.
//     - Any other string, a free-text log message included, fails if it holds a 64-hex run (no log
//       message in src/ interpolates a hash; only alert text does, and alerts are not recorded).
//     - URLs: every http(s):// or ws(s):// URL has a loopback host or one of the public hosts src/
//       itself names (PUBLIC_HOSTS; a test in recordingsGuard.test.ts proves each appears in src/ as a string or template
//       literal, comments excluded). On a public host the URL is parsed with the real URL class and
//       fails on a username or password, a query parameter named like a credential (key, token,
//       secret, auth, password, session, signature) unless its value is a 20-byte 0x address, or a path
//       segment or query value of 20 or more characters that is not a 20-byte 0x address. The fragment
//       gets the query rules (WR-34), and a username or password fails on a loopback host too.
//     - Any string, or any line of one, starting as a .env-style KEY= fails.
//   AC-21: every ID a header's SUSPECT(...) cites exists as a finding JSON.
//   AC-22: serializeTimeline with no submit entry ends in the exact line {"submitted":[]}.
//
//   recordingsGuard.test.ts proves each rule both ways on temp-directory cases. Nothing here
//   names a file under src/ or scripts/: src/ is walked as a directory (the AC-37 gate,
//   test/unit/sourceTextGate.test.ts). Nothing here mocks anything.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Transaction, computeAddress, keccak256 } from 'ethers';

/** AC-22: the explicit empty list, byte for byte (equal to serializer.ts EMPTY_SUBMITTED_LINE). */
export const EMPTY_SUBMITTED_LINE = '{"submitted":[]}';
const FINDING_ID = 'AUD-[A-Z0-9]+-[0-9]{3}';
/** AC-21: KEEP or SUSPECT(<AUD-ID>[,<AUD-ID>...]) (equal to serializer.ts TAG_RE). */
export const TAG_RE = new RegExp(`^(?:KEEP|SUSPECT\\((${FINDING_ID}(?:,${FINDING_ID})*)\\))$`);

/** The finding IDs a tag cites (none for KEEP). Throws on a malformed tag (as serializer.ts tagIds). */
export function tagIds(tag: string): string[] {
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

/** The folders and file the guard reads, under one repo root. */
export interface GuardPaths {
    recordingsDir: string;
    findingsDir: string;
    envTestFile: string;
}

export function guardPaths(repoRoot: string): GuardPaths {
    return {
        recordingsDir: path.join(repoRoot, 'test', 'realpath', 'recordings'),
        findingsDir: path.join(repoRoot, '.planning', 'audit', 'findings'),
        envTestFile: path.join(repoRoot, 'test', '.env.test'),
    };
}

/** Every rule over every recording under the repo's recordings folder. Returns the violations (empty when clean). */
export function scanRepoRecordings(repoRoot: string): { files: number; violations: string[] } {
    const p = guardPaths(repoRoot);
    return { files: recordingFiles(p.recordingsDir).length, violations: scanRecordingsDir(p.recordingsDir, readSentinels(p.envTestFile), knownFindingIds(p.findingsDir)) };
}

// ---------------------------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------------------------

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
// WR-34: secret shapes that fail in any string, sentinel or not.
const TELEGRAM_TOKEN = /(?<![0-9])\d{6,12}:[A-Za-z0-9_-]{30,}/;
const HEX32_RUN = /(?<![0-9A-Za-z])[0-9a-fA-F]{32}(?![0-9A-Za-z])/;
const BEARER = /\bBearer\s+\S{16,}/i;
const USERINFO_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#@"'<>`]+@/i;
const TOKEN_RUN = /[A-Za-z0-9_+/=-]{32,}/g;
/** The env matrix's case values (test/realpath/env/envMatrix.test.ts CASES): the only non-sentinel values a secret field may hold. */
const CASE_VALUES: ReadonlySet<string> = new Set(['', '0', 'abc']);
/** The camel-case secret fields the registry and config carry, and the variable whose sentinel each holds. */
const SECRET_FIELDS: ReadonlyMap<string, string> = new Map([
    ['walletPrivateKey', 'PRIVATE_KEY'],
    ['authKey', 'FLASHBOTS_AUTH_KEY'],
    ['authHeader', 'BLOXROUTE_AUTH_HEADER'],
]);
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

export function readSentinels(file: string): Sentinels {
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
    // A user name or password fails on any host, loopback included (WR-34).
    if (u.username !== '' || u.password !== '') c.out.push(`${at}: URL on ${host} carries a username or password`);
    if (LOOPBACK_HOSTS.has(host)) return;
    if (!PUBLIC_HOSTS.includes(host)) {
        c.out.push(`${at}: URL host ${host} is neither loopback nor a public host src/ names`);
        return;
    }
    const longOk = (v: string): boolean => v.length < 20 || ADDRESS.test(v);
    for (const seg of u.pathname.split('/')) {
        const s = decodeURIComponent(seg);
        if (!longOk(s)) c.out.push(`${at}: URL on ${host} has a path segment of ${s.length} characters that is not an address`);
    }
    for (const [name, value] of u.searchParams) {
        if (CREDENTIAL_PARAM.test(name) && !ADDRESS.test(value)) c.out.push(`${at}: URL on ${host} has a credential-like query parameter ${name}`);
        else if (!longOk(value)) c.out.push(`${at}: URL on ${host} has a query value of ${value.length} characters that is not an address`);
    }
    // The fragment (WR-34): read as parameters when it holds one (#access_token=...), else as one value.
    if (u.hash.length > 1) {
        const frag = decodeURIComponent(u.hash.slice(1));
        if (frag.includes('=')) {
            for (const [name, value] of new URLSearchParams(frag)) {
                if (CREDENTIAL_PARAM.test(name) && !ADDRESS.test(value)) c.out.push(`${at}: URL on ${host} has a credential-like fragment parameter ${name}`);
                else if (!longOk(value)) c.out.push(`${at}: URL on ${host} has a fragment value of ${value.length} characters that is not an address`);
            }
        } else if (!longOk(frag)) c.out.push(`${at}: URL on ${host} has a fragment of ${frag.length} characters that is not an address`);
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
    // WR-34: a secret field (the three registry/config fields, or a key named like a secret variable)
    // holds its sentinel (handled above) or one of the env matrix's case values, and nothing else.
    const secretVar = key === null ? null : SECRET_FIELDS.get(key) ?? (/^[A-Z][A-Z0-9_]*$/.test(key) && SENTINEL_KEY.test(key) ? key : null);
    if (secretVar !== null) {
        if (CASE_VALUES.has(value)) return;
        c.out.push(`${at}: a secret field holding a value that is neither its test/.env.test sentinel nor a case value ('', '0', 'abc')`);
    }
    // WR-34: secret shapes, anywhere.
    if (TELEGRAM_TOKEN.test(value)) c.out.push(`${at}: a Telegram bot token shape`);
    if (HEX32_RUN.test(value)) c.out.push(`${at}: a 32-hex run (an API hash or key shape)`);
    if (BEARER.test(value)) c.out.push(`${at}: a Bearer credential`);
    if (USERINFO_URL.test(value)) c.out.push(`${at}: a URL with a user name or password`);
    // Addresses and hashes (0x + 40 or more hex, a checksummed address mixes case) are not tokens.
    for (const run of value.replace(/0x[0-9a-fA-F]{40,}/g, ' ').match(TOKEN_RUN) ?? []) {
        if (/^(?:0x)?[0-9a-fA-F]+$/.test(run)) continue;
        const mixed = /[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run);
        const upperKey = /^[A-Z0-9]+$/.test(run) && /[A-Z]/.test(run) && /[0-9]/.test(run);
        if (mixed || upperKey) {
            c.out.push(`${at}: a long token-shaped run (an API key, session or base64 secret shape)`);
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

/** The register's finding IDs: the .json file names under `findingsDir`. */
export function knownFindingIds(findingsDir: string): Set<string> {
    return new Set(fs.readdirSync(findingsDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)));
}

/** Every rule above over one file's raw bytes. Returns the violations (empty when clean). */
export function scanRecordingText(rel: string, raw: Buffer, sentinels: Sentinels, findings: Set<string>): string[] {
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

export function scanRecordingsDir(dir: string, sentinels: Sentinels, findings: Set<string>): string[] {
    return recordingFiles(dir).flatMap((rel) => scanRecordingText(rel, fs.readFileSync(path.join(dir, rel)), sentinels, findings));
}
