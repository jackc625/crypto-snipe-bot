// .planning/audit/tools/relay-probe-tx006.ts
//
// Phase 23 / Plan 23-15 (AC-15, candidate 26, AUD-TX-006) - the one outside request of the
// phase: ask the public Flashbots relay whether it still answers flashbots_getBundleStatsV2.
//
// Usage (Node 22.16.0, ABI 127; D-21), run by the executor, never by a test:
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js .planning/audit/tools/relay-probe-tx006.ts --dry-run --block 1 --out <file>
//       prints the exact request and sends nothing; writes no file.
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js .planning/audit/tools/relay-probe-tx006.ts --confirm-approved --block <n> --out .planning/audit/inputs/aud-tx-006-relay-response.json
//       ONLY after the operator approved it at the plan 23-15 Task 2 checkpoint: sends ONE POST to
//       https://relay.flashbots.net and records the raw answer.
//   ... relay-probe-tx006.ts --self-test   prints the classifier self-check and exits.
//
// Safety (threat T-23-18, T-23-19, T-23-39):
//   - It refuses to run without --dry-run or --confirm-approved (exit 2, nothing sent), and with both.
//   - It never reads the bot's settings file or any environment value, imports nothing from src/,
//     and holds no bot key. The request is signed by a key made by Wallet.createRandom() inside
//     this process, which holds no funds, is printed only as its address, and is discarded when
//     the process exits. A dry run uses its own throwaway key, so the real run's address and
//     signature differ from the preview; the body is identical.
//   - The relay address is a constant; there is no flag to point it elsewhere.
//   - The request is sent at most once per output file: the confirmed run refuses an --out that
//     already exists, and reserves the file (an "attempt started" record) before sending, so a
//     crash mid-request can never look like "not sent yet". It never retries.
//   - Whatever HTTP status the relay gives (403 included) is a recorded result: exit 0. Only a
//     failure to get any HTTP response (network error, timeout) exits 3, after recording it.
//
// The request is the shape @flashbots/ethers-provider-bundle@1.0.0 sends for getBundleStatsV2
// (node_modules/@flashbots/ethers-provider-bundle/build/index.js:545-558, request() :793-806,
// prepareRelayRequest() :812-820): body {method, params: [{bundleHash, blockNumber: 0x<hex>}],
// id, jsonrpc: "2.0"}, header Content-Type: application/json and
// X-Flashbots-Signature: <address>:<signMessage(id(body))>. The bundle hash is all zeros (it names
// no bundle) and the id is 1 (a fresh provider's first request).
//
// The class of the answer is decided by classifyRelayResponse, fixed before any request is sent
// (review concern Codex 23-15 HIGH: a zero hash names no known bundle, so a response cannot by
// itself prove the endpoint is gone). Every run, the dry run included, runs its self-check first
// and refuses to go on if any case fails.

if (process.versions.modules !== '127') {
    process.stderr.write(
        `relay-probe-tx006: requires Node 22.16.0 (ABI 127); this is Node ${process.version} ` +
            `(ABI ${process.versions.modules}). Run it with ` +
            `/c/Users/jackc/AppData/Local/nvm/v22.16.0/node.exe (D-21).\n`,
    );
    process.exit(2);
}

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Wallet, id as keccakId, version as ethersVersion } from 'ethers';

export const RELAY_URL = 'https://relay.flashbots.net';
export const METHOD = 'flashbots_getBundleStatsV2';
export const ZERO_BUNDLE_HASH = '0x' + '00'.repeat(32);
const REQUEST_TIMEOUT_MS = 30_000;
const BODY_TEXT_LIMIT = 65_536;
/** Response headers kept in the record (no cookies or anything account-shaped). */
const HEADER_SUBSET = ['content-type', 'content-length', 'date', 'server', 'via', 'cf-ray', 'cf-cache-status', 'x-request-id', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining'];

// -------------------------------------------------------------------------------------------
// The classifier (fixed before the request is sent)
// -------------------------------------------------------------------------------------------

export type RelayClass = 'endpoint-missing' | 'endpoint-answers' | 'inconclusive';

export interface Classification {
    class: RelayClass;
    reason: string;
}

export const CLASSIFIER_RULES = [
    'endpoint-missing: HTTP 200 or 404, a JSON-RPC body whose error code is -32601, or whose error message says the method is not found or not supported (after the method name itself is ignored).',
    'endpoint-answers: HTTP 200 with a JSON-RPC result (any value, null included) and no error; or HTTP 200, 400 or 404 with a JSON-RPC error that names the bundle or its parameters as the problem (code -32602, or a message such as "bundle not found", "invalid params", "unknown bundle", "missing parameter", "bundleHash", "blockNumber"), because a method that validates its input exists. A message that says the method is deprecated never counts as answering.',
    'inconclusive: everything else, including HTTP 401, 403, 429 and 5xx whatever the body says, any other status, a body that is not one JSON-RPC object, an object with neither result nor error, and no HTTP response at all (network error or timeout).',
    'Only endpoint-missing and endpoint-answers settle the question; inconclusive never closes the candidate.',
];

const METHOD_RE = /flashbots_getBundleStatsV2|getBundleStatsV2/gi;
const MISSING_RE = /\bmethod\b[^.]*\b(not found|not supported|unsupported|does not exist|not available|no longer supported|no longer available|not implemented)\b|\b(unknown|unsupported|invalid) method\b|\bno such method\b/i;
const PARAM_RE = /\bbundle (not found|unknown|does not exist|hash)\b|\bunknown bundle\b|\bno bundle\b|\binvalid (params?|parameters?|arguments?|argument|bundle|block|hash)\b|\bmissing (params?|parameters?|arguments?|field)\b|\bbundlehash\b|\bblocknumber\b|\bblock number\b/i;
const DEPRECATED_RE = /deprecat/i;

/**
 * Classify one relay answer. `status` is the HTTP status, or null when no HTTP response arrived.
 * `body` is the raw response text, or null when there was none. Pure: no I/O.
 */
export function classifyRelayResponse(status: number | null, body: string | null): Classification {
    if (status === null) return { class: 'inconclusive', reason: 'no HTTP response (network error or timeout)' };
    if (status === 401 || status === 403 || status === 429 || status >= 500) {
        return { class: 'inconclusive', reason: `HTTP ${status}: an auth, rate-limit or server refusal does not show whether the method exists` };
    }
    if (body === null) return { class: 'inconclusive', reason: `HTTP ${status} with no body` };
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return { class: 'inconclusive', reason: `HTTP ${status} with a body that is not JSON` };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { class: 'inconclusive', reason: `HTTP ${status} with JSON that is not one JSON-RPC object` };
    }
    const obj = parsed as Record<string, unknown>;
    const err = obj.error;
    const hasError = err !== undefined && err !== null;
    if (hasError) {
        const e = (typeof err === 'object' ? err : {}) as { code?: unknown; message?: unknown };
        const code = typeof e.code === 'number' ? e.code : null;
        const message = typeof e.message === 'string' ? e.message : typeof err === 'string' ? err : '';
        // The method's own name contains "Bundle", so it is removed before the message is read.
        const text = message.replace(METHOD_RE, '<method>');
        if (status === 200 || status === 404) {
            if (code === -32601) return { class: 'endpoint-missing', reason: `HTTP ${status}, JSON-RPC error -32601 (method not found)` };
            if (MISSING_RE.test(text)) return { class: 'endpoint-missing', reason: `HTTP ${status}, error message says the method is not found or not supported: ${JSON.stringify(message)}` };
        }
        if (status === 200 || status === 400 || status === 404) {
            if (DEPRECATED_RE.test(text)) return { class: 'inconclusive', reason: `HTTP ${status}, error message says deprecated, which is neither missing nor answering: ${JSON.stringify(message)}` };
            if (code === -32602) return { class: 'endpoint-answers', reason: `HTTP ${status}, JSON-RPC error -32602 (invalid params): the method validated its input` };
            if (PARAM_RE.test(text)) return { class: 'endpoint-answers', reason: `HTTP ${status}, error names the bundle or its parameters: ${JSON.stringify(message)}` };
        }
        return { class: 'inconclusive', reason: `HTTP ${status}, JSON-RPC error that names neither a missing method nor the bundle or its parameters: ${JSON.stringify(message || err)}` };
    }
    if ('result' in obj) {
        if (status === 200) return { class: 'endpoint-answers', reason: 'HTTP 200 with a JSON-RPC result' };
        return { class: 'inconclusive', reason: `HTTP ${status} with a JSON-RPC result: only an HTTP 200 result counts` };
    }
    return { class: 'inconclusive', reason: `HTTP ${status}, JSON with neither result nor error` };
}

interface SelfCase {
    name: string;
    status: number | null;
    body: string | null;
    want: RelayClass;
}

const rpcError = (code: number | undefined, message: string): string => JSON.stringify({ jsonrpc: '2.0', id: 1, error: { ...(code === undefined ? {} : { code }), message } });

export const SELF_CASES: SelfCase[] = [
    { name: '200, error -32601', status: 200, body: rpcError(-32601, 'the method flashbots_getBundleStatsV2 does not exist/is not available'), want: 'endpoint-missing' },
    { name: '404, error -32601', status: 404, body: rpcError(-32601, 'Method not found'), want: 'endpoint-missing' },
    { name: '200, message "method not found" without a code', status: 200, body: rpcError(undefined, 'method not found'), want: 'endpoint-missing' },
    { name: '200, message "unsupported method"', status: 200, body: rpcError(-32000, 'unsupported method: flashbots_getBundleStatsV2'), want: 'endpoint-missing' },
    { name: '200, method no longer supported', status: 200, body: rpcError(-32000, 'method flashbots_getBundleStatsV2 is no longer supported'), want: 'endpoint-missing' },
    { name: '200, result with stats', status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isSimulated: false, isHighPriority: false, consideredByBuildersAt: [], sealedByBuildersAt: [] } }), want: 'endpoint-answers' },
    { name: '200, result null', status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }), want: 'endpoint-answers' },
    { name: '200, error "bundle not found"', status: 200, body: rpcError(-32000, 'bundle not found'), want: 'endpoint-answers' },
    { name: '400, error -32602 invalid params', status: 400, body: rpcError(-32602, 'invalid params'), want: 'endpoint-answers' },
    { name: '200, error "invalid blockNumber"', status: 200, body: rpcError(-32000, 'invalid blockNumber: block too old'), want: 'endpoint-answers' },
    { name: '404, error "unknown bundle"', status: 404, body: rpcError(-32000, 'unknown bundle'), want: 'endpoint-answers' },
    { name: '403, empty body', status: 403, body: '', want: 'inconclusive' },
    { name: '403, JSON error naming the method as not supported', status: 403, body: rpcError(-32601, 'method not supported'), want: 'inconclusive' },
    { name: '403, JSON error naming the bundle', status: 403, body: rpcError(-32000, 'bundle not found'), want: 'inconclusive' },
    { name: '401, signature refused', status: 401, body: rpcError(-32000, 'invalid flashbots signature'), want: 'inconclusive' },
    { name: '429, rate limited', status: 429, body: 'rate limited', want: 'inconclusive' },
    { name: '500, server error', status: 500, body: rpcError(-32603, 'internal error'), want: 'inconclusive' },
    { name: '502, HTML gateway page', status: 502, body: '<html><body>Bad Gateway</body></html>', want: 'inconclusive' },
    { name: '200, non-JSON body', status: 200, body: '<html>forbidden</html>', want: 'inconclusive' },
    { name: '200, JSON array (batch)', status: 200, body: '[]', want: 'inconclusive' },
    { name: '200, JSON with neither result nor error', status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1 }), want: 'inconclusive' },
    { name: '200, deprecated message (the method name contains "Bundle")', status: 200, body: rpcError(-32000, 'flashbots_getBundleStatsV2 has been deprecated'), want: 'inconclusive' },
    { name: '200, error about something else', status: 200, body: rpcError(-32000, 'internal relay error'), want: 'inconclusive' },
    { name: '404, plain text', status: 404, body: '404 page not found', want: 'inconclusive' },
    { name: '400, error with no bundle or parameter wording', status: 400, body: rpcError(-32000, 'request rejected'), want: 'inconclusive' },
    { name: '418, any other status with a result', status: 418, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), want: 'inconclusive' },
    { name: 'no HTTP response (network error)', status: null, body: null, want: 'inconclusive' },
];

/** Print the self-check; true when every case gives its expected class. */
export function runSelfCheck(out: (line: string) => void): boolean {
    out('classifyRelayResponse rules (fixed before any request is sent):');
    for (const r of CLASSIFIER_RULES) out(`  - ${r}`);
    out('self-check:');
    let failed = 0;
    for (const c of SELF_CASES) {
        const got = classifyRelayResponse(c.status, c.body);
        const ok = got.class === c.want;
        if (!ok) failed++;
        out(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name}: ${got.class}${ok ? '' : ` (wanted ${c.want}; ${got.reason})`}`);
    }
    out(failed === 0 ? `SELF-CHECK PASSED: ${SELF_CASES.length}/${SELF_CASES.length} cases` : `SELF-CHECK FAILED: ${failed} of ${SELF_CASES.length} cases`);
    return failed === 0;
}

// -------------------------------------------------------------------------------------------
// The request
// -------------------------------------------------------------------------------------------

export interface BuiltRequest {
    url: string;
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    throwaway_address: string;
}

/** The body the library would send for getBundleStatsV2(ZERO_BUNDLE_HASH, block). */
export function requestBody(block: number): string {
    // Key order as prepareRelayRequest builds it: method, params, id, jsonrpc.
    return JSON.stringify({ method: METHOD, params: [{ bundleHash: ZERO_BUNDLE_HASH, blockNumber: `0x${block.toString(16)}` }], id: 1, jsonrpc: '2.0' });
}

/** Sign with a brand-new random key, exactly as the library's request() does. */
async function buildRequest(block: number): Promise<BuiltRequest> {
    const throwaway = Wallet.createRandom();
    const body = requestBody(block);
    const signature = await throwaway.signMessage(keccakId(body));
    return {
        url: RELAY_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Flashbots-Signature': `${throwaway.address}:${signature}` },
        body,
        throwaway_address: throwaway.address,
    };
}

// -------------------------------------------------------------------------------------------
// CLI
// -------------------------------------------------------------------------------------------

interface Args {
    dryRun: boolean;
    confirm: boolean;
    selfTest: boolean;
    help: boolean;
    block: number | null;
    out: string | null;
}

class UsageError extends Error {}

function parse(argv: string[]): Args {
    const a: Args = { dryRun: false, confirm: false, selfTest: false, help: false, block: null, out: null };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        switch (k) {
            case '--dry-run':
                a.dryRun = true;
                break;
            case '--confirm-approved':
                a.confirm = true;
                break;
            case '--self-test':
                a.selfTest = true;
                break;
            case '--help':
                a.help = true;
                break;
            case '--block': {
                const v = argv[++i];
                if (v === undefined || !/^[1-9][0-9]{0,11}$/.test(v)) throw new UsageError(`--block needs a positive decimal block number, got ${JSON.stringify(v)}`);
                a.block = Number(v);
                break;
            }
            case '--out': {
                const v = argv[++i];
                if (v === undefined || v === '' || v.startsWith('--')) throw new UsageError('--out needs a file path');
                a.out = v;
                break;
            }
            default:
                throw new UsageError(`unknown argument ${JSON.stringify(k)}`);
        }
    }
    return a;
}

const HELP = [
    'relay-probe-tx006: one flashbots_getBundleStatsV2 request to https://relay.flashbots.net (plan 23-15, AC-15).',
    '  --dry-run              print the exact request; send nothing, write nothing',
    '  --confirm-approved     send the ONE request (only after the operator approved it)',
    '  --block <n>            block number for the request (decimal; sent as hex)',
    '  --out <file>           where the confirmed run records the raw response (must not exist)',
    '  --self-test            print the classifier self-check and exit',
    'Exactly one of --dry-run and --confirm-approved is required for a request; --block and --out are required with either.',
].join('\n');

/** Refuse an output path in the bot's data folder or named like a settings file. */
function checkOutPath(out: string, repoRoot: string): string {
    const abs = path.resolve(out);
    const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
    if (rel === 'data' || rel.startsWith('data/')) throw new UsageError(`--out ${out} is inside data/, which this tool never touches`);
    if (/^\.env/i.test(path.basename(abs))) throw new UsageError(`--out ${out} is named like a settings file, which this tool never touches`);
    if (!fs.existsSync(path.dirname(abs))) throw new UsageError(`--out ${out}: folder ${path.dirname(abs)} does not exist`);
    return abs;
}

function sha256File(file: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function toLfJson(value: unknown): string {
    return JSON.stringify(value, null, 2).replace(/\r\n/g, '\n') + '\n';
}

export async function main(argv: string[], out: (line: string) => void = (l) => process.stdout.write(l + '\n'), err: (line: string) => void = (l) => process.stderr.write(l + '\n')): Promise<number> {
    let args: Args;
    try {
        args = parse(argv);
    } catch (e) {
        err(`relay-probe-tx006: ${(e as Error).message}\n${HELP}`);
        return 2;
    }
    if (args.help) {
        out(HELP);
        return 0;
    }
    // The classifier is checked before anything else, on every run.
    const selfOk = runSelfCheck(out);
    if (args.selfTest) return selfOk ? 0 : 1;
    if (!selfOk) {
        err('relay-probe-tx006: the classifier self-check failed; refusing to build or send any request');
        return 2;
    }
    if (args.dryRun === args.confirm) {
        err(`relay-probe-tx006: give exactly one of --dry-run or --confirm-approved (got ${args.dryRun ? 'both' : 'neither'}); nothing was sent\n${HELP}`);
        return 2;
    }
    if (args.block === null || args.out === null) {
        err('relay-probe-tx006: --block and --out are required; nothing was sent');
        return 2;
    }
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    let outAbs: string;
    try {
        outAbs = checkOutPath(args.out, repoRoot);
    } catch (e) {
        err(`relay-probe-tx006: ${(e as Error).message}; nothing was sent`);
        return 2;
    }

    if (args.dryRun) {
        const r = await buildRequest(args.block);
        out('DRY RUN: this is the exact request a confirmed run sends (nothing is sent, no file is written):');
        out(`  ${r.method} ${r.url}`);
        for (const [k, v] of Object.entries(r.headers)) out(`  ${k}: ${v}`);
        out(`  body: ${r.body}`);
        out(`  throwaway signer for this preview: ${r.throwaway_address} (made by Wallet.createRandom, no funds, discarded on exit)`);
        out('  a confirmed run makes a NEW throwaway key, so its address and signature differ from this preview; the body is identical.');
        out(`  the confirmed run would write its record to ${args.out}; the dry run wrote nothing.`);
        return 0;
    }

    // Confirmed run: the one request.
    if (fs.existsSync(outAbs)) {
        err(`relay-probe-tx006: ${args.out} already exists; a request was already made or attempted for it, and this tool never sends a second one. Nothing was sent.`);
        return 2;
    }
    const probeFile = path.resolve(__filename);
    const r = await buildRequest(args.block);
    const base = {
        finding: 'AUD-TX-006',
        candidate: 26,
        purpose: 'AC-15: does the public Flashbots relay still answer flashbots_getBundleStatsV2? One request, signed by a throwaway unfunded key, sent after operator approval (plan 23-15 Task 2).',
        throwaway_address: r.throwaway_address,
        key_source: 'Wallet.createRandom() inside this process; holds no funds; never written anywhere; discarded on exit. Not the bot key.',
        request: { url: r.url, method: r.method, headers: r.headers, body: r.body },
        probe: {
            file: '.planning/audit/tools/relay-probe-tx006.ts',
            sha256: sha256File(probeFile),
            node: process.version,
            ethers: ethersVersion,
            timeout_ms: REQUEST_TIMEOUT_MS,
        },
        classifier_rules: CLASSIFIER_RULES,
    };
    // Reserve the file before sending (flag wx: fails if it appeared meanwhile).
    const startedAt = new Date().toISOString();
    fs.writeFileSync(outAbs, toLfJson({ ...base, sent_at_utc: startedAt, state: 'attempt-started: the process ended before an answer was recorded' }), { encoding: 'utf8', flag: 'wx' });
    out(`sending ONE ${METHOD} request to ${RELAY_URL}, signed by throwaway ${r.throwaway_address} ...`);

    let record: Record<string, unknown>;
    let exitCode = 0;
    // An HTTP status seen before a later failure (for example the body stream breaking) is kept.
    let statusSeen: number | null = null;
    try {
        const resp = await fetch(r.url, { method: 'POST', headers: r.headers, body: r.body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'manual' });
        statusSeen = resp.status;
        const receivedAt = new Date().toISOString();
        const fullText = await resp.text();
        const truncated = fullText.length > BODY_TEXT_LIMIT;
        const bodyText = truncated ? fullText.slice(0, BODY_TEXT_LIMIT) : fullText;
        let bodyJson: unknown = null;
        try {
            bodyJson = JSON.parse(fullText);
        } catch {
            bodyJson = null;
        }
        const headers: Record<string, string> = {};
        for (const h of HEADER_SUBSET) {
            const v = resp.headers.get(h);
            if (v !== null) headers[h] = v;
        }
        const classification = classifyRelayResponse(resp.status, fullText);
        record = {
            ...base,
            sent_at_utc: startedAt,
            received_at_utc: receivedAt,
            state: 'answered',
            response: {
                status: resp.status,
                status_text: resp.statusText,
                headers,
                header_names: [...resp.headers.keys()].sort(),
                body_text: bodyText,
                body_truncated: truncated,
                body_length: fullText.length,
                body_json: bodyJson,
            },
            network_error: null,
            classification,
        };
        out(`answered: HTTP ${resp.status} ${resp.statusText}`);
        out(`body: ${bodyText.length > 2000 ? bodyText.slice(0, 2000) + ' ...' : bodyText}`);
        out(`class: ${classification.class} (${classification.reason})`);
    } catch (e) {
        const x = e as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
        const classification = classifyRelayResponse(null, null);
        record = {
            ...base,
            sent_at_utc: startedAt,
            received_at_utc: null,
            state: statusSeen === null ? 'no-http-response' : 'http-status-but-body-failed',
            response: statusSeen === null ? null : { status: statusSeen },
            network_error: { name: x?.name ?? 'Error', message: x?.message ?? String(e), code: x?.code ?? x?.cause?.code ?? null, cause: x?.cause?.message ?? null },
            classification,
        };
        out(`no HTTP response: ${x?.name ?? 'Error'}: ${x?.message ?? String(e)}`);
        out(`class: ${classification.class} (${classification.reason})`);
        exitCode = 3;
    }
    fs.writeFileSync(outAbs, toLfJson(record), { encoding: 'utf8' });
    out(`recorded: ${args.out}`);
    return exitCode;
}

if (require.main === module) {
    main(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (e: unknown) => {
            process.stderr.write(`relay-probe-tx006: unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
            process.exit(1);
        },
    );
}
