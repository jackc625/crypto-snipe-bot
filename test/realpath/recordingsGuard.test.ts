// test/realpath/recordingsGuard.test.ts
// Phase 23 plan 23-20 (CHAR-02, AC-21, AC-22, AC-26, AC-51; T-23-25): the guards every golden-master
// recording and env snapshot must pass before its first commit, here and in plans 23-21, 23-22 and
// 23-23. The rules and the scan live in ./recordingsScan.ts (Phase 23 review WR-35: moved there so
// that scripts/update-recordings.ts runs the same scan over every recording right after a re-record,
// before anything is committed); its header lists every rule. This file runs that scan over every
// .jsonl and .json file under test/realpath/recordings/**, and proves each rule both ways on
// temp-directory cases.
//
// Only installed tooling is used. Nothing here names a file under src/ or scripts/: src/ is walked as
// a directory (the AC-37 gate, test/unit/sourceTextGate.test.ts). Nothing here mocks anything.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { Transaction, Wallet, ethers } from 'ethers';
import type { TimelineEntry } from './harness/capture';
import {
    EMPTY_SUBMITTED_LINE as SCAN_EMPTY_SUBMITTED_LINE,
    PUBLIC_HOSTS,
    TAG_RE as SCAN_TAG_RE,
    type Sentinels,
    guardPaths,
    knownFindingIds as knownFindingIdsIn,
    readSentinels as readSentinelsFrom,
    recordingFiles,
    scanRecordingText as scanRecordingTextWith,
    scanRecordingsDir as scanRecordingsDirWith,
    scanRepoRecordings,
    tagIds as scanTagIds,
} from './recordingsScan';
import {
    EMPTY_SUBMITTED_LINE,
    RECORDINGS_DIR,
    TAG_RE,
    UPDATE_SWITCH,
    UPDATE_TOKEN_PREFIX,
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

// The guard's scan lives in ./recordingsScan (WR-35); here its inputs default to this repo's.
const readSentinels = (file: string = ENV_TEST_FILE): Sentinels => readSentinelsFrom(file);
const knownFindingIds = (): Set<string> => knownFindingIdsIn(FINDINGS_DIR);
const scanRecordingText = (rel: string, raw: Buffer, sentinels: Sentinels, findings: Set<string> = knownFindingIds()): string[] => scanRecordingTextWith(rel, raw, sentinels, findings);
const scanRecordingsDir = (dir: string, sentinels: Sentinels = readSentinels()): string[] => scanRecordingsDirWith(dir, sentinels, knownFindingIds());

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

/**
 * WR-34 planted values, each built at run time from a hash so that no secret-shaped literal sits in
 * this file (the phase secret scan reads source text): a Telegram bot token shape, a 32-hex API hash,
 * a base64 session, an explorer-style API key, a Bearer credential, a URL fragment token, and
 * credential URLs in another scheme and on a loopback host.
 */
const planted = (() => {
    const bytes = (label: string, n = 32): Uint8Array => ethers.getBytes(ethers.id(`realpath.wr-34.${label}`)).slice(0, n);
    const alphabet = (label: string, chars: string, n: number): string => Array.from(bytes(label), (b) => chars[b % chars.length]).join('').slice(0, n);
    const word = alphabet('word', 'abcdefghijklmnopqrstuvwxyz', 24);
    const userinfo = [alphabet('user', 'abcdefghijklmnopqrstuvwxyz', 6), alphabet('pass', 'abcdefghijklmnopqrstuvwxyz0123456789', 18)].join(':');
    return {
        word,
        headerWord: `live-${word}`,
        telegram: [String(100_000_000 + bytes('tg')[0]), `AA${alphabet('tg-secret', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-', 33)}`].join(':'),
        hex32: ethers.id('realpath.wr-34.hex32').slice(2, 34),
        base64: Buffer.concat([Buffer.from(bytes('b64-a')), Buffer.from(bytes('b64-b'))]).toString('base64'),
        explorerKey: alphabet('explorer', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 32) + alphabet('explorer-2', 'GHJKLMNPQRSTUVWXYZ', 2),
        bearer: ['Bearer', alphabet('bearer', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 28)].join(' '),
        fragmentUrl: `https://etherscan.io/address/${ADDR}#${['access', 'token'].join('_')}=${alphabet('frag', 'abcdefghijklmnopqrstuvwxyz0123456789', 24)}`,
        otherSchemeUrl: ['redis:', '', `${userinfo}@cache.internal:6379`].join('/'),
        loopbackUrl: ['http:', '', `${userinfo}@127.0.0.1:8545`].join('/'),
    };
})();

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

    it('WR-35: the scan the update command runs reads the same folder and passes it too, and the scan module keeps the serializer\'s tag rule and empty-list line', () => {
        // scripts/update-recordings.ts calls scanRepoRecordings(<repo root>) after its Vitest run.
        expect(guardPaths(REPO_ROOT)).toEqual({ recordingsDir: RECORDINGS_DIR, findingsDir: FINDINGS_DIR, envTestFile: ENV_TEST_FILE });
        const r = scanRepoRecordings(REPO_ROOT);
        expect(r.files).toBe(recordingFiles(RECORDINGS_DIR).length);
        expect(r.violations).toEqual([]);
        expect(SCAN_TAG_RE.source).toBe(TAG_RE.source);
        expect(SCAN_EMPTY_SUBMITTED_LINE).toBe(EMPTY_SUBMITTED_LINE);
        for (const t of ['KEEP', 'SUSPECT(AUD-DB-004)', 'SUSPECT(AUD-DB-004,AUD-EXIT-001)']) expect(scanTagIds(t)).toEqual(tagIds(t));
        for (const bad of ['SUSPECT(AUD-DB-004, AUD-EXIT-001)', 'SUSPECT(AUD-DB-004,AUD-DB-004)', 'suspect']) {
            expect(() => scanTagIds(bad)).toThrow();
            expect(() => tagIds(bad)).toThrow();
        }
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
            // WR-34: secret fields hold their sentinel or a case value only; secret shapes fail anywhere.
            // Every planted value is built at run time, so no secret-shaped literal sits in this file.
            'secret-field-not-sentinel.jsonl': { text: recording('secret-field-not-sentinel', op({ mevConfig: { authHeader: planted.headerWord } })), rule: /secret field holding a value that is neither its test\/\.env\.test sentinel nor a case value/ },
            'env/SECRET_VAR_NOT_SENTINEL.json': { text: JSON.stringify({ cases: { valid: { env: { TELEGRAM_SESSION: planted.word } } } }), rule: /secret field holding a value that is neither its test\/\.env\.test sentinel nor a case value/ },
            'telegram-token.jsonl': { text: recording('telegram-token', op({}, `bot ${planted.telegram} rejected`)), rule: /Telegram bot token shape/ },
            'hex32.jsonl': { text: recording('hex32', op({ apiHash: planted.hex32 })), rule: /32-hex run/ },
            'base64-session.jsonl': { text: recording('base64-session', op({ session: planted.base64 })), rule: /long token-shaped run/ },
            'explorer-key-text.jsonl': { text: recording('explorer-key-text', op({}, `explorer key ${planted.explorerKey} refused`)), rule: /long token-shaped run/ },
            'bearer.jsonl': { text: recording('bearer', op({ header: planted.bearer })), rule: /Bearer credential/ },
            'url-fragment.jsonl': { text: recording('url-fragment', op({ url: planted.fragmentUrl })), rule: /URL on etherscan\.io has a credential-like fragment parameter/ },
            'credential-uri-other-scheme.jsonl': { text: recording('credential-uri-other-scheme', op({ cache: planted.otherSchemeUrl })), rule: /URL with a user name or password/ },
            'url-userinfo-loopback.jsonl': { text: recording('url-userinfo-loopback', op({ rpc: planted.loopbackUrl })), rule: /URL with a user name or password/ },
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
                // The env matrix's case values ('', '0', 'abc') under the secret fields (WR-34).
                op({ mevConfig: { authKey: '0', authHeader: '' }, walletPrivateKey: 'abc' }),
            ),
            'env/PRIVATE_KEY.json': JSON.stringify({ variable: 'PRIVATE_KEY', cases: { empty: { env: { PRIVATE_KEY: '' } }, '0': { env: { PRIVATE_KEY: '0' } }, abc: { env: { PRIVATE_KEY: 'abc' } }, valid: { env: { PRIVATE_KEY: s.byName.get('PRIVATE_KEY') } } } }),
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

/**
 * WR-36: run `fn` with a live update token, as scripts/update-recordings.ts makes one for its single
 * Vitest run: 32 random hex digits and the file <os.tmpdir()>/<UPDATE_TOKEN_PREFIX><token> naming the
 * process (`pid`) that owns it. The file is removed after.
 */
function withLiveToken<T>(fn: (token: string) => T, pid: number = process.pid): T {
    const token = randomBytes(16).toString('hex');
    const tokenFile = path.join(os.tmpdir(), `${UPDATE_TOKEN_PREFIX}${token}`);
    fs.writeFileSync(tokenFile, JSON.stringify({ pid, token }));
    try {
        return fn(token);
    } finally {
        fs.rmSync(tokenFile, { force: true });
    }
}

/** A process id that names no running process (process.kill(pid, 0) fails with ESRCH). */
function deadPid(): number {
    for (let pid = 4_000_000 + (process.pid % 1000); pid < 4_100_000; pid += 7) {
        try {
            process.kill(pid, 0);
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ESRCH') return pid;
        }
    }
    throw new Error('no free process id found');
}

/** Run `fn` with process.stderr captured; returns the lines written. */
function captureStderr(fn: () => void): string[] {
    const chunks: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
    }) as typeof process.stderr.write;
    try {
        fn();
    } finally {
        process.stderr.write = orig;
    }
    return chunks.join('').split('\n').filter(Boolean);
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
        // WR-36: the switch writes only with a live update token, the one scripts/update-recordings.ts
        // makes for its one Vitest run. Every other value, a lingering "1" included, only compares.
        const unchanged = (): void => {
            expect(() => compareRecording('x.jsonl', changed, { dir })).toThrow(/differs/);
            expect(fs.readFileSync(file).equals(before)).toBe(true);
        };
        withLiveToken((token) => withEnv({ update: token, ci: 'true' }, () => {
            expect(updateAllowed()).toBe(false);
            unchanged();
        }));
        for (const value of ['1', 'true', randomBytes(16).toString('hex'), 'A'.repeat(32)]) {
            withEnv({ update: value, ci: undefined }, () => {
                expect(updateAllowed(), `switch ${JSON.stringify(value)}`).toBe(false);
                unchanged();
            });
        }
        // A token whose file names a process that is not running (the wrapper was killed) never writes.
        withLiveToken((token) => withEnv({ update: token, ci: undefined }, () => {
            expect(updateAllowed()).toBe(false);
            unchanged();
        }), deadPid());
        // A token file that is not the wrapper's record never writes either.
        withLiveToken((token) => withEnv({ update: token, ci: undefined }, () => {
            fs.writeFileSync(path.join(os.tmpdir(), `${UPDATE_TOKEN_PREFIX}${token}`), 'not a record');
            expect(updateAllowed()).toBe(false);
            unchanged();
        }));
        // A live token with CI unset writes, and says so on stderr for every write.
        withLiveToken((token) => withEnv({ update: token, ci: undefined }, () => {
            expect(updateAllowed()).toBe(true);
            const stderr = captureStderr(() => {
                expect(compareRecording('x.jsonl', changed, { dir })).toBe('written');
                expect(compareRecording('env/SOME_VAR.json', '{"a":1}\n', { dir })).toBe('written');
                expect(compareRecording('x.jsonl', changed, { dir })).toBe('match');
            });
            expect(fs.readFileSync(file, 'utf8')).toBe(changed);
            expect(fs.readFileSync(path.join(dir, 'env', 'SOME_VAR.json'), 'utf8')).toBe('{"a":1}\n');
            expect(stderr.filter((l) => /^\[recordings\] WROTE /.test(l))).toEqual(['[recordings] WROTE x.jsonl (update run)', '[recordings] WROTE env/SOME_VAR.json (update run)']);
        }));
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
        const textOf = new Map<string, string>();
        const visit = (dir: string): void => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                if (e.name === 'node_modules' || e.name === '.git') continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory()) visit(full);
                else if (textFile.test(e.name)) {
                    const text = fs.readFileSync(full, 'utf8');
                    if (!text.includes(name)) continue;
                    const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
                    mentions.push(rel);
                    textOf.set(rel, text);
                }
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
        // WR-36: the switch carries a one-run token, and the update command (the one file that sets
        // the switch, found by the walk above) makes the token file under the serializer's own prefix.
        expect(UPDATE_TOKEN_PREFIX).toBe('csb-recordings-update-');
        const updater = [...textOf.entries()].find(([rel]) => rel.startsWith('scripts/'));
        expect(updater?.[1]).toContain(`'${UPDATE_TOKEN_PREFIX}'`);
        expect(updater?.[1]).not.toMatch(new RegExp(`\\[SWITCH\\]: '1'`));
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
