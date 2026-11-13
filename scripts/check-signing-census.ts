// scripts/check-signing-census.ts
//
// Phase 23 / Plan 23-17 (CHAR-04, AC-32 to AC-36, AC-53, D-20, D-NONCE-AUTHORITY-ALL) - the
// standing signing census gate. Every transaction-signing site in src/ and scripts/ must run
// inside withNonceLock, apart from the named list in scripts/signing-census-exceptions.json.
// A nonce race on a signing wallet costs money directly, so CI refuses a new unlocked signing
// path.
//
// Promoted from .planning/audit/tools/signing-census.ts (Phase 22 / Plan 22-26, the audit
// record, which stays unchanged). The analysis below the "Types" banner is that file's,
// unchanged. What changed for the gate:
//   - the file is self-contained (the audit tools' ./lib is not under scripts/): a local
//     UsageError and a small parser for this gate's three flags;
//   - it runs on the working tree: the two refusals of a checkout (.git, .env, data/) are
//     gone. The guarantee they gave is kept differently: the census builds a TypeScript
//     program from tsconfig.json's root files plus every source file under scripts/ (allowJs) and reads type
//     information only, so .env and data/ are never opened. The self-test proves it on a
//     checkout-shaped fixture (case flag7-never-opens-env-or-data), and every real run
//     refuses a program that holds a file named .env or a file under data/;
//   - the --sha / --root / --out CLI is replaced by the gate below.
//
// The gate (default mode) reads scripts/signing-census-exceptions.json:
//   floor     the minimum number of transaction-signing sites (AC-33: 23 passes, 22 fails).
//             It may drop only in a commit naming the finding that removed the site
//             (AC-34, --check-floor-history).
//   unlocked  the known unlocked sites, one row per file|enclosing|call key with a count
//             (several sites share a key, e.g. four ContractFactory.deploy in one main()).
//             Each row names its finding_id and decision_ref (AC-53): every decision_ref
//             must resolve to .planning/audit/escalations/<id>.json or
//             .planning/audit/decisions/<id>.json and that record must list the finding in
//             items, resolved_items or findings. The unlocked set must equal the list by key
//             and count: a new unlocked site fails (AC-32), and a listed site that was fixed
//             or removed fails until it comes off the list (AC-35).
//   excluded  sites the census counts but an auditor proved are not signing (view calls
//             whose ABI the type analysis cannot read). An entry may match only a contract
//             call whose mutability the census could not read, and must cite a manual
//             inventory entry that excludes the same file and call.
//   dead      (operator ruling on Phase 23 review WR-24) signing sites in a function nothing
//             can reach, one row per file|function|call with a count. `function` is the
//             outermost function holding the site. The census must prove it unreachable: a
//             module-level function declaration or const function, with no export modifier and
//             zero references anywhere in the program (findReferences, as the lock check uses;
//             an export list, export default, module.exports or a call is a reference). The row
//             names finding_id, whose record's recommendation must say delete/remove and name the
//             function. A dead site is neither locked nor unlocked (its lock is not judged) but it
//             still counts toward the floor: it is a signing call in the code, and deleting it
//             must lower the floor in a commit naming the finding (AC-34). Problems: dead-reachable
//             (a caller, a reference or an export), dead-unprovable (not a function shape the
//             census can prove), stale-dead (the site or function is gone: remove the row),
//             dead-count (the count differs), dead-finding-does-not-name.
// Also: no counted site may have lock status unknown (F3); a scan that finds no files in
// src/ or scripts/, or no signing site, fails (AC-36); every JavaScript or TypeScript source
// file under src/ and scripts/ (.ts .tsx .mts .cts .js .jsx .mjs .cjs; Phase 23 review WR-25)
// must be in the census program, which is built with allowJs so the JavaScript ones are typed.
//
// Usage (Node 22.16.0, D-21):
//   npm run check:census                                              gate on the working tree
//   node node_modules/ts-node/dist/bin.js scripts/check-signing-census.ts [--self-test | --print | --check-floor-history]
//   --self-test             the Phase 22 analysis fixtures plus the gate's own cases
//   --print                 the census JSON on stdout, for review (exit 0 unless it crashes)
//   --check-floor-history   walks every commit touching the exceptions file (needs full git
//                           history; a shallow clone exits 2)
// Exit codes: 0 pass, 1 check failure, 2 usage error, wrong Node, shallow clone or crash.
//
// --- The Phase 22 header, kept for the analysis it describes ---
//
// Phase 22 / Plan 22-26 Task 2 (AUDIT-03, AC-36 / E31, D-NONCE-AUTHORITY-ALL) -
// the signing-site census. Static analysis only: it builds a TypeScript program
// over a base-SHA snapshot (`git archive <sha> -- src scripts tsconfig.json ...`
// outside the repo, node_modules = one junction per top-level entry, type
// information only) and never executes, imports or loads any code it audits.
// (Promoted: the program is built over the working tree instead of a snapshot.)
//
// What counts (review concerns L592@e2e59f6, L593@e2e59f6, L594@e2e59f6):
//   tx-signing (consumes a nonce; counted in N = total_tx_signing):
//     - sendTransaction / signTransaction on a receiver whose TYPE is a Signer
//       (structural: signTransaction + sendTransaction + getAddress +
//       signMessage, so Wallet, BaseWallet, AbstractSigner, NonceManager,
//       JsonRpcSigner and the Signer interface all match; aliases such as
//       `const w = wallet` are matched by type, not by name);
//     - sendTransaction / signTransaction on any other receiver type (api
//       delegated.<name>; Phase 23 review CR-08): a wrapper or a narrow
//       interface such as ethers' ContractRunner may hold a Wallet whose code is
//       outside the program, so the call is counted and its lock judged;
//     - deploy on a ContractFactory (getDeployTransaction builds an unsigned
//       tx and is listed as excluded; its sendTransaction is the counted site);
//     - a contract method call, or its `.send(...)` form, on a Contract /
//       BaseContract whose runner (traced to `new Contract(addr, abi, runner)`,
//       `.connect(runner)`, `factory.deploy()`, through parameters and call
//       sites) is a Signer, for state-changing ABI fragments; view/pure
//       fragments and `.staticCall` / `.estimateGas` / `.populateTransaction`
//       are recorded as excluded with the reason;
//     - Flashbots bundle sends: signBundle / sendBundle / sendRawBundle /
//       sendPrivateTransaction on a Flashbots provider, and in-program
//       functions named rawSendBundle / sendRawBundle (the relay eth_sendBundle
//       fanout).
//     - (Phase 23 review CR-09) a contract method reached as a value: a const
//       holding `c.m`, `c.getFunction('m')` or a destructured method, called in
//       place, is classified at the call as above; a method object handed on
//       (callback, stored, returned) is a site where it is taken, lock unknown;
//       a call of a method object not typed through a Contract is unresolved;
//       and a call of an in-program interface signature (no body) that returns
//       a TransactionResponse (`new Contract(...) as unknown as IRouter`) is a
//       site whose lock is judged.
//     - (Phase 23 review WR-23) sendUncheckedTransaction (as sendTransaction),
//       authorize / authorizeSync on a Signer (EIP-7702, nonce-bearing),
//       f.call(...) / f.apply(...) of a signing method (classified as f), a
//       signing method taken as a value (.bind, a callback: lock unknown),
//       SigningKey.sign and provider.send('eth_sendTransaction' |
//       'eth_sendRawTransaction', ...) (lock unknown), and a call on an
//       any-typed receiver traced to a `new Contract(...)` (an artifact ABI),
//       whatever the method name.
//   message-signing (no nonce; listed separately, never a violation):
//     signMessage / signTypedData on a Signer (Flashbots relay auth headers).
//   unresolved: a receiver typed any/unknown calling a signing API name or a
//     state-changing ABI name, or a computed-property call on a Signer or
//     Contract, is recorded as tx-signing with lock_status unknown and
//     type_unresolved true (never dropped).
//
// Lock status (evidence recorded on every site):
//   locked    lexical: the site's own function is the op argument of a
//             withNonceLock(...) call; transitive: every reference chain to the
//             enclosing function (followed through the TypeScript language
//             service, cycle-safe) ends inside such an op, and every call on the
//             chain is awaited or returned (a call that is not awaited can
//             outlive the lock).
//   unlocked  a chain reaches an entry outside any lock: module top level (a
//             script's main()), an event/route callback, or an exported
//             function with no in-program caller.
//   unknown   an unresolved type, a callback whose invocation cannot be
//             followed, a value use (stored, returned), a call that is not
//             awaited/returned inside the lock, no reference at all, or a chain
//             deeper than the limit. unknown is never counted as locked or
//             excluded.
//   withNonceLock is the function declared in src/utils/nonceAuthority.ts and
//   nowhere else (Phase 23 review WR-24): a local function of the same name
//   serializes nothing, so a call of it is followed like any other callee.
//   A callback passed to an in-program function G is followed only when G's
//   parameter is invoked directly in G's own body and each invocation is
//   awaited or returned; the callback then runs inside that call to G.
//
// (The Phase 22 usage lines for --root / --sha / --out are replaced by the gate usage above.)

if (process.versions.modules !== '127') {
    console.error(`check-signing-census requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}).`);
    process.exit(2);
}

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
// The real fs module object (the namespace import above is an esModuleInterop copy with
// getter-only bindings). The flag-7 self-test wraps its read functions to record every path
// the census opens; TypeScript's ts.sys reads through this same object.
import fsModule = require('fs');

/** A bad argument or an environment the gate cannot run in. Exit 2. */
class UsageError extends Error {}

const GATE_FLAGS = ['self-test', 'print', 'check-floor-history'] as const;
type GateMode = 'gate' | (typeof GATE_FLAGS)[number];

function parseGateArgs(argv: string[]): GateMode {
    const usage = 'usage: check-signing-census.ts [--self-test | --print | --check-floor-history]';
    if (argv.length === 0) return 'gate';
    if (argv.length > 1) throw new UsageError(`${usage} (one flag at most, got ${argv.length} arguments)`);
    const a = argv[0];
    const name = a.startsWith('--') ? a.slice(2) : '';
    if (!(GATE_FLAGS as readonly string[]).includes(name)) throw new UsageError(`${usage} (unknown argument ${JSON.stringify(a)})`);
    return name as GateMode;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Kind = 'tx-signing' | 'message-signing';
type LockStatus = 'locked' | 'unlocked' | 'unknown';

interface LockRes {
    status: LockStatus | 'cycle';
    chains: string[][];
    reason?: string;
    /** in-progress function nodes this result depended on (cycle taint; never memoized while non-empty) */
    deps: Set<ts.Node>;
}

export interface Site {
    id: string;
    file: string;
    line: number;
    column: number;
    ref: string;
    enclosing: string;
    api: string;
    kind: Kind;
    receiver_type: string;
    excluded: boolean;
    excluded_reason: string | null;
    excluded_by: 'census' | 'auditor' | null;
    lock_status: LockStatus | null;
    lock_evidence: 'lexical' | 'transitive' | null;
    chains: string[][];
    reason: string | null;
    type_unresolved: boolean;
    runner: string | null;
    mutability: string | null;
    site_awaited: boolean;
    review_note: string | null;
    /** contract sites: every traced construction of the receiver (runner @ where) */
    origins?: string[];
    /** Operator ruling on WR-24: the finding of the dead entry that covers this site (a provably unreachable function) */
    dead?: string;
    manual_lock_status?: string;
    lock_disagreement?: boolean;
    /** CR-08: a sendTransaction/signTransaction whose receiver type is not structurally a Signer (a wrapper or a narrow interface); counted and lock-judged like any site */
    delegated?: boolean;
}

/** A traced construction of a contract or factory value; ctor is the `new Contract(...)` expression when one was found. */
interface Origin {
    runner: string;
    abi: ts.Expression | undefined;
    at: string;
    ctor?: ts.Expression;
}

interface LockCall {
    file: string;
    line: number;
    key: string;
    enclosing: string;
}

interface CensusResult {
    sites: Site[];
    lock_calls: LockCall[];
    program: { root_files: number; src_files: number; script_files: number; files_with_ts_errors: number; unresolved_modules: string[] };
}

// ---------------------------------------------------------------------------
// Program + language service over a snapshot
// ---------------------------------------------------------------------------

// sendUncheckedTransaction: JsonRpcSigner's send that skips the receipt lookup; it consumes a nonce
// like sendTransaction (Phase 23 review WR-23).
const SIGN_TX = ['sendTransaction', 'signTransaction', 'sendUncheckedTransaction'];
// EIP-7702 authorizations carry and consume the account nonce; counted only on a Signer receiver,
// because the names are common elsewhere (WR-23; ethers 6.16 has authorize/authorizeSync, not signAuthorization).
const SIGNER_ONLY_TX = ['authorize', 'authorizeSync'];
// JSON-RPC methods that send a transaction: a node-held key signs eth_sendTransaction, and
// eth_sendRawTransaction broadcasts a transaction signed elsewhere (WR-23).
const RPC_SEND_TX = ['eth_sendTransaction', 'eth_sendRawTransaction'];
const SIGN_MSG = ['signMessage', 'signTypedData'];
const BUNDLE = ['signBundle', 'sendBundle', 'sendRawBundle', 'sendPrivateTransaction'];
const BUNDLE_FNS = ['rawSendBundle', 'sendRawBundle'];
const METHOD_OPS_EXCLUDED: Record<string, string> = {
    staticCall: 'staticCall: a read-only eth_call simulation; no transaction, no nonce',
    staticCallResult: 'staticCallResult: a read-only eth_call simulation; no transaction, no nonce',
    estimateGas: 'estimateGas: gas estimation only; no transaction, no nonce',
    populateTransaction: 'populateTransaction: builds an unsigned request; the site that signs it is counted separately',
};
/** Members of a contract method object that only read it (never sign, never hand the method on). */
const METHOD_DATA_MEMBERS = ['fragment', 'name', 'getFragment', '_contract', '_key'];
const ENTRY_REGISTRARS = ['on', 'once', 'addListener', 'prependListener', 'prependOnceListener', 'get', 'post', 'put', 'patch', 'delete', 'use', 'all'];
const ENTRY_FUNCTIONS = ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'nextTick'];
const MAX_DEPTH = 40;
/** The one real lock (D-NONCE-AUTHORITY-ALL). A function of the same name declared anywhere else is not the lock (Phase 23 review WR-24). */
const LOCK_MODULE_REL = 'src/utils/nonceAuthority.ts';

function posix(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Every JavaScript or TypeScript source extension Node or ts-node can run (Phase 23 review WR-25):
 * a signing script written as .cjs, .mjs, .js, .mts or .cts must be audited like a .ts one.
 */
const SOURCE_EXT_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const DECLARATION_RE = /\.d\.(ts|mts|cts)$/;

function walkSources(dir: string, out: string[]): void {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules') continue;
            walkSources(p, out);
        } else if (e.isFile() && SOURCE_EXT_RE.test(e.name) && !DECLARATION_RE.test(e.name)) out.push(posix(p));
    }
}

class Census {
    readonly root: string;
    readonly sha: string;
    readonly program: ts.Program;
    readonly checker: ts.TypeChecker;
    readonly ls: ts.LanguageService;
    readonly rootNames: string[];
    private refCache = new Map<ts.Node, ts.Identifier[]>();
    private memo = new Map<ts.Node, LockRes>();
    private abiNames: Set<string> = new Set();

    constructor(root: string, sha: string) {
        this.root = posix(path.resolve(root));
        this.sha = sha;
        const cfgPath = path.join(this.root, 'tsconfig.json');
        if (!fs.existsSync(cfgPath)) throw new UsageError(`no tsconfig.json in ${this.root}`);
        const raw = ts.readConfigFile(cfgPath, ts.sys.readFile);
        if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, '\n'));
        // allowJs (WR-25): the tsconfig include then also yields src/ JavaScript files, and the
        // scripts/ walk adds every source extension, so .js/.cjs/.mjs files are typed and audited.
        const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, this.root, { allowJs: true });
        const scripts: string[] = [];
        walkSources(path.join(this.root, 'scripts'), scripts);
        const names = new Set<string>(parsed.fileNames.map(posix));
        for (const s of scripts) names.add(s);
        this.rootNames = [...names].sort();
        const options: ts.CompilerOptions = { ...parsed.options, allowJs: true, checkJs: false, noEmit: true };
        // The census program: what is classified.
        this.program = ts.createProgram({ rootNames: this.rootNames, options });
        this.checker = this.program.getTypeChecker();
        // The reference service: the same root names and options, used only for
        // findReferences (results are exchanged as file + position, so nodes never
        // cross programs).
        const texts = new Map<string, string>();
        const host: ts.LanguageServiceHost = {
            getScriptFileNames: () => this.rootNames,
            getScriptVersion: () => '1',
            getScriptSnapshot: (f) => {
                const k = posix(f);
                if (!texts.has(k)) {
                    if (!fs.existsSync(f)) return undefined;
                    texts.set(k, fs.readFileSync(f, 'utf8'));
                }
                return ts.ScriptSnapshot.fromString(texts.get(k)!);
            },
            getCurrentDirectory: () => this.root,
            getCompilationSettings: () => options,
            getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile,
            readDirectory: ts.sys.readDirectory,
            directoryExists: ts.sys.directoryExists,
            getDirectories: ts.sys.getDirectories,
            realpath: ts.sys.realpath,
        };
        this.ls = ts.createLanguageService(host, ts.createDocumentRegistry());
        const lsRoots = this.ls.getProgram()!.getRootFileNames().map(posix).sort();
        if (JSON.stringify(lsRoots) !== JSON.stringify(this.rootNames)) throw new Error('reference service and census program have different root files');
        // Every state-changing function name in an in-program ABI literal (for any-typed receivers).
        for (const sf of this.auditedFiles()) this.collectAbiNames(sf);
    }

    rel(file: string): string {
        const f = posix(file);
        return f.startsWith(this.root + '/') ? f.slice(this.root.length + 1) : f;
    }

    auditedFiles(): ts.SourceFile[] {
        return this.program
            .getSourceFiles()
            .filter((sf) => !sf.isDeclarationFile)
            .filter((sf) => {
                const r = this.rel(sf.fileName);
                return (r.startsWith('src/') || r.startsWith('scripts/')) && !r.includes('node_modules/');
            })
            .sort((a, b) => (this.rel(a.fileName) < this.rel(b.fileName) ? -1 : 1));
    }

    line(n: ts.Node): number {
        const sf = n.getSourceFile();
        return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    }

    loc(n: ts.Node): string {
        return `${this.rel(n.getSourceFile().fileName)}:${this.line(n)}`;
    }

    // ------------------------------------------------------------------ types

    private props(t: ts.Type): Set<string> {
        const s = new Set<string>();
        for (const p of this.checker.getPropertiesOfType(this.checker.getApparentType(t))) s.add(p.getName());
        return s;
    }

    private members(t: ts.Type): ts.Type[] {
        const nn = this.checker.getNonNullableType(t);
        return nn.isUnion() ? nn.types : [nn];
    }

    isAnyish(t: ts.Type): boolean {
        return (this.checker.getNonNullableType(t).flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
    }

    private hasCache = new Map<ts.Type, Map<string, boolean>>();
    private has(t: ts.Type, names: string[]): boolean {
        const k = names.join(',');
        let byNames = this.hasCache.get(t);
        if (!byNames) this.hasCache.set(t, (byNames = new Map()));
        const hit = byNames.get(k);
        if (hit !== undefined) return hit;
        const v = this.members(t).some((m) => {
            const p = this.props(m);
            return names.every((n) => p.has(n));
        });
        byNames.set(k, v);
        return v;
    }

    isSigner(t: ts.Type): boolean {
        return this.has(t, ['signTransaction', 'sendTransaction', 'getAddress', 'signMessage']);
    }
    isProvider(t: ts.Type): boolean {
        return !this.isSigner(t) && this.has(t, ['getBlockNumber', 'getBalance', 'call']);
    }
    isFactory(t: ts.Type): boolean {
        return this.has(t, ['deploy', 'getDeployTransaction', 'attach', 'bytecode']);
    }
    isContract(t: ts.Type): boolean {
        return this.has(t, ['interface', 'target', 'runner', 'getFunction', 'waitForDeployment']);
    }
    isMethod(t: ts.Type): boolean {
        return this.has(t, ['staticCall', 'send', 'estimateGas', 'populateTransaction']);
    }
    isBundler(t: ts.Type): boolean {
        return this.has(t, ['signBundle', 'sendBundle']);
    }
    isSigningKey(t: ts.Type): boolean {
        return this.has(t, ['sign', 'computeSharedSecret', 'privateKey', 'publicKey']);
    }
    /** A (promise of a) TransactionResponse / ContractTransactionResponse: what a signing send returns. */
    isTxResponse(t: ts.Type): boolean {
        const a = this.checker.getAwaitedType(t) ?? t;
        return !this.isAnyish(a) && this.has(a, ['hash', 'nonce', 'wait', 'confirmations']);
    }

    typeAt(e: ts.Node): ts.Type {
        return this.checker.getTypeAtLocation(e);
    }
    typeText(t: ts.Type): string {
        const s = this.checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation);
        return s.length > 120 ? s.slice(0, 117) + '...' : s;
    }

    /** True when `name` on a contract-typed receiver is a BaseContract member (getAddress, connect, ...), not an ABI method. */
    isOwnContractMember(recv: ts.Type, name: string): boolean {
        for (const m of this.members(recv)) {
            const p = this.checker.getPropertyOfType(this.checker.getApparentType(m), name);
            if (!p) continue;
            const decls = p.getDeclarations() ?? [];
            for (const d of decls) {
                const owner = d.parent;
                if (owner && (ts.isClassDeclaration(owner) || ts.isInterfaceDeclaration(owner)) && owner.name && /^(BaseContract|Contract)$/.test(owner.name.text)) return true;
                if (posix(d.getSourceFile().fileName).includes('/ethers/') && !ts.isIndexSignatureDeclaration(d)) return true;
            }
        }
        return false;
    }

    // --------------------------------------------------------- syntax helpers

    strip(e: ts.Expression): ts.Expression {
        let c = e;
        for (;;) {
            if (ts.isParenthesizedExpression(c) || ts.isAsExpression(c) || ts.isNonNullExpression(c) || ts.isSatisfiesExpression(c) || ts.isTypeAssertionExpression(c)) c = c.expression;
            else if (ts.isAwaitExpression(c)) c = c.expression;
            else return c;
        }
    }

    /** Climb wrapper nodes (parens, casts) above n. */
    private up(n: ts.Node): ts.Node {
        let c = n;
        while (c.parent && (ts.isParenthesizedExpression(c.parent) || ts.isAsExpression(c.parent) || ts.isNonNullExpression(c.parent) || ts.isSatisfiesExpression(c.parent) || ts.isTypeAssertionExpression(c.parent))) c = c.parent;
        return c;
    }

    /** The call's promise is awaited or returned by its function (so the function does not settle before the call does). */
    consumed(call: ts.Node): boolean {
        const c = this.up(call);
        const p = c.parent;
        if (!p) return false;
        if (ts.isAwaitExpression(p)) return true;
        if (ts.isReturnStatement(p)) return true;
        if (ts.isArrowFunction(p) && p.body === c) return true;
        if (ts.isConditionalExpression(p) && (p.whenTrue === c || p.whenFalse === c)) return this.consumed(p);
        if (ts.isBinaryExpression(p) && p.right === c && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(p.operatorToken.kind)) return this.consumed(p);
        if (ts.isPropertyAccessExpression(p) && p.expression === c && ['then', 'catch', 'finally'].includes(p.name.text) && ts.isCallExpression(p.parent) && p.parent.expression === p) return this.consumed(p.parent);
        return false;
    }

    isFnLike(n: ts.Node): n is ts.FunctionLikeDeclaration {
        return ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
    }

    enclosingFn(n: ts.Node): ts.FunctionLikeDeclaration | undefined {
        let c = n.parent;
        while (c && !ts.isSourceFile(c)) {
            if (this.isFnLike(c)) return c;
            c = c.parent;
        }
        return undefined;
    }

    className(n: ts.Node): string {
        let c: ts.Node | undefined = n.parent;
        while (c && !ts.isSourceFile(c)) {
            if ((ts.isClassDeclaration(c) || ts.isClassExpression(c)) && c.name) return c.name.text;
            if (ts.isObjectLiteralExpression(c)) return '<object>';
            c = c.parent;
        }
        return '<class>';
    }

    /** Where a function value appears as a direct call argument: {call, index}. */
    argPosition(f: ts.Node): { call: ts.CallExpression; index: number } | undefined {
        const c = this.up(f);
        const p = c.parent;
        if (p && ts.isCallExpression(p)) {
            const i = p.arguments.indexOf(c as ts.Expression);
            if (i >= 0) return { call: p, index: i };
        }
        return undefined;
    }

    handleOf(f: ts.FunctionLikeDeclaration): ts.Node | undefined {
        if ((ts.isFunctionDeclaration(f) || ts.isMethodDeclaration(f) || ts.isGetAccessorDeclaration(f) || ts.isSetAccessorDeclaration(f)) && f.name) return f.name;
        if (ts.isConstructorDeclaration(f)) {
            const cls = f.parent;
            return ts.isClassDeclaration(cls) && cls.name ? cls.name : undefined;
        }
        const c = this.up(f);
        const p = c.parent;
        if (!p) return undefined;
        if (ts.isVariableDeclaration(p) && p.initializer === c && ts.isIdentifier(p.name)) return p.name;
        if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && p.initializer === c) return p.name;
        if (ts.isBinaryExpression(p) && p.right === c && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(p.left)) return p.left.name;
        return undefined;
    }

    fnName(f: ts.FunctionLikeDeclaration | undefined): string {
        if (!f) return 'module top level';
        if (ts.isConstructorDeclaration(f)) return `${this.className(f)}.constructor`;
        if (ts.isMethodDeclaration(f) || ts.isGetAccessorDeclaration(f) || ts.isSetAccessorDeclaration(f)) return `${this.className(f)}.${f.name.getText()}`;
        if (ts.isFunctionDeclaration(f) && f.name) return f.name.text;
        const h = this.handleOf(f);
        if (h) {
            const p = this.up(f).parent;
            if (p && ts.isPropertyDeclaration(p)) return `${this.className(p)}.${h.getText()}`;
            return h.getText();
        }
        const a = this.argPosition(f);
        if (a) return `<arrow passed to ${this.short(a.call.expression.getText())}>`;
        return '<anonymous function>';
    }

    short(s: string, n = 70): string {
        const t = s.replace(/\s+/g, ' ');
        return t.length > n ? t.slice(0, n - 3) + '...' : t;
    }

    isLockCall(call: ts.CallExpression): boolean {
        const callee = this.strip(call.expression);
        const nameNode = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : undefined;
        if (!nameNode || nameNode.text !== 'withNonceLock') return false;
        let sym = this.checker.getSymbolAtLocation(nameNode);
        if (sym && sym.flags & ts.SymbolFlags.Alias) sym = this.checker.getAliasedSymbol(sym);
        // WR-24: only the real lock counts. A function of the same name declared anywhere else (a
        // script's local no-op withNonceLock) serializes nothing.
        return !!sym?.getDeclarations()?.some((d) => ts.isFunctionDeclaration(d) && d.name?.text === 'withNonceLock' && !!d.body && this.rel(d.getSourceFile().fileName) === LOCK_MODULE_REL);
    }

    hop(n: ts.Node): string {
        let what = '';
        if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
            if (ts.isCallExpression(n) && this.isLockCall(n)) what = `withNonceLock(${this.short(n.arguments[0]?.getText() ?? '', 40)}, ...)`;
            else what = `${this.short(n.expression.getText(), 60)}(...)`;
        } else what = this.short(n.getText(), 60);
        return `${this.loc(n)} ${what} in ${this.fnName(this.enclosingFn(n))}`;
    }

    isExported(f: ts.FunctionLikeDeclaration): boolean {
        const mods = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []);
        const exp = (n: ts.Node) => mods(n).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (ts.isFunctionDeclaration(f)) return exp(f);
        if (ts.isMethodDeclaration(f) || ts.isConstructorDeclaration(f) || ts.isGetAccessorDeclaration(f) || ts.isSetAccessorDeclaration(f)) {
            const cls = f.parent;
            const priv = mods(f).some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) || (f.name && ts.isPrivateIdentifier(f.name as ts.Node));
            return !priv && (ts.isClassDeclaration(cls) || ts.isClassExpression(cls)) && exp(cls);
        }
        const p = this.up(f).parent;
        if (p && ts.isVariableDeclaration(p)) {
            const stmt = p.parent?.parent;
            return !!stmt && ts.isVariableStatement(stmt) && exp(stmt);
        }
        return false;
    }

    // ------------------------------------------------------------ references

    /** Identifiers in the census program that refer to `nameNode`'s symbol (declarations excluded). */
    refsOf(nameNode: ts.Node): ts.Identifier[] {
        const hit = this.refCache.get(nameNode);
        if (hit) return hit;
        const sf = nameNode.getSourceFile();
        const out: ts.Identifier[] = [];
        const seen = new Set<string>();
        const refs = this.ls.findReferences(sf.fileName, nameNode.getStart(sf)) ?? [];
        for (const rs of refs)
            for (const r of rs.references) {
                const key = `${posix(r.fileName)}#${r.textSpan.start}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const tsf = this.program.getSourceFile(r.fileName) ?? this.program.getSourceFiles().find((s) => posix(s.fileName) === posix(r.fileName));
                if (!tsf || tsf.isDeclarationFile) continue;
                const id = findIdentAt(tsf, r.textSpan.start);
                if (!id) continue;
                if (isDeclName(id)) continue;
                out.push(id);
            }
        this.refCache.set(nameNode, out);
        return out;
    }

    useOf(id: ts.Identifier): { kind: 'call'; call: ts.CallExpression | ts.NewExpression } | { kind: 'arg'; call: ts.CallExpression; index: number } | { kind: 'skip' } | { kind: 'other'; node: ts.Node } {
        let n: ts.Node = id;
        if (ts.isPropertyAccessExpression(id.parent) && id.parent.name === id) n = id.parent;
        const p0 = n.parent;
        if (!p0) return { kind: 'skip' };
        if (ts.isImportSpecifier(p0) || ts.isImportClause(p0) || ts.isExportSpecifier(p0) || ts.isNamespaceImport(p0) || ts.isTypeQueryNode(p0) || ts.isExportAssignment(p0) || ts.isTypeReferenceNode(p0) || ts.isExpressionWithTypeArguments(p0) || ts.isQualifiedName(p0)) return { kind: 'skip' };
        const c = this.up(n);
        const q = c.parent;
        if (q && ts.isCallExpression(q) && q.expression === c) return { kind: 'call', call: q };
        if (q && ts.isNewExpression(q) && q.expression === c) return { kind: 'call', call: q };
        if (q && ts.isCallExpression(q)) {
            const i = q.arguments.indexOf(c as ts.Expression);
            if (i >= 0) return { kind: 'arg', call: q, index: i };
        }
        return { kind: 'other', node: q ?? c };
    }

    // ------------------------------------------------------------------ lock

    private res(status: LockRes['status'], chains: string[][] = [], reason?: string, deps?: Set<ts.Node>): LockRes {
        return { status, chains, reason, deps: deps ?? new Set() };
    }

    private prefix(h: string, r: LockRes): LockRes {
        return { ...r, chains: r.chains.length ? r.chains.map((c) => [h, ...c]) : [[h]] };
    }

    private combine(rs: LockRes[]): LockRes {
        const deps = new Set<ts.Node>();
        for (const r of rs) for (const d of r.deps) deps.add(d);
        const un = rs.find((r) => r.status === 'unlocked');
        if (un) return { ...un, deps };
        const uk = rs.filter((r) => r.status === 'unknown');
        if (uk.length) return { status: 'unknown', chains: uk[0].chains, reason: [...new Set(uk.map((r) => r.reason ?? 'unknown'))].join('; '), deps };
        const lk = rs.filter((r) => r.status === 'locked');
        if (lk.length) {
            const chains: string[][] = [];
            const keys = new Set<string>();
            for (const r of lk)
                for (const c of r.chains) {
                    const k = c.join(' <- ');
                    if (!keys.has(k) && chains.length < 16) {
                        keys.add(k);
                        chains.push(c);
                    }
                }
            return { status: 'locked', chains, deps };
        }
        return { status: 'cycle', chains: [], deps };
    }

    /** Lock status of code executing at node n (a call expression or a site). */
    lockOfPoint(n: ts.Node, visiting: Set<ts.Node>, depth: number): LockRes {
        const h = this.hop(n);
        const f = this.enclosingFn(n);
        if (!f) return this.res('unlocked', [[h, `${this.rel(n.getSourceFile().fileName)}: module top level (entry)`]], 'module top level');
        if (depth > MAX_DEPTH) return this.res('unknown', [[h]], `reference chain deeper than ${MAX_DEPTH}`);
        return this.prefix(h, this.lockOfFn(f, visiting, depth + 1));
    }

    lockOfFn(f: ts.FunctionLikeDeclaration, visiting: Set<ts.Node>, depth: number): LockRes {
        const pos = this.argPosition(f);
        if (pos) return this.lockOfArgUse(pos.call, pos.index, f, visiting, depth);
        const m = this.memo.get(f);
        if (m) return m;
        if (visiting.has(f)) return this.res('cycle', [], undefined, new Set([f]));
        const handle = this.handleOf(f);
        if (!handle) {
            const p = this.up(f).parent;
            return this.res('unknown', [[`${this.loc(f)} ${this.fnName(f)}`]], `function value used as ${p ? ts.SyntaxKind[p.kind] : 'a value'}; its invocation cannot be followed`);
        }
        visiting.add(f);
        const uses = this.refsOf(handle).map((id) => this.useOf(id)).filter((u) => u.kind !== 'skip');
        const rs: LockRes[] = [];
        for (const u of uses) {
            if (u.kind === 'call') {
                const pr = this.lockOfPoint(u.call, visiting, depth + 1);
                if (pr.status === 'locked' && !this.consumed(u.call)) rs.push(this.res('unknown', pr.chains, `call at ${this.loc(u.call)} is not awaited or returned, so the lock can be released before it finishes`, pr.deps));
                else rs.push(pr);
            } else if (u.kind === 'arg') {
                rs.push(this.lockOfArgUse(u.call, u.index, f, visiting, depth + 1));
            } else if (u.kind === 'other') {
                rs.push(this.res('unknown', [[`${this.loc(u.node)} ${this.short(u.node.getText(), 60)}`]], `used as a value at ${this.loc(u.node)} (${ts.SyntaxKind[u.node.kind]}); its invocation cannot be followed`));
            }
        }
        visiting.delete(f);
        let r: LockRes;
        if (!uses.length) {
            r = this.isExported(f)
                ? this.res('unlocked', [[`${this.loc(f)} ${this.fnName(f)} is exported with no in-program caller (entry: an importer can call it outside any lock)`]], 'exported entry with no in-program caller')
                : this.res('unknown', [[`${this.loc(f)} ${this.fnName(f)}`]], 'no in-program reference (dead code, or invoked dynamically)');
        } else r = this.combine(rs);
        r.deps.delete(f);
        if (!r.deps.size) this.memo.set(f, r);
        return r;
    }

    /** Lock status of function value f (inline or by name) passed as argument `index` of `call`. */
    lockOfArgUse(call: ts.CallExpression, index: number, f: ts.FunctionLikeDeclaration, visiting: Set<ts.Node>, depth: number): LockRes {
        const callee = this.strip(call.expression);
        const calleeName = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
        if (this.isLockCall(call)) {
            if (index === 1) return this.res('locked', [[this.hop(call)]]);
            return this.res('unknown', [[this.hop(call)]], 'passed to withNonceLock in a position other than the op');
        }
        if (ENTRY_FUNCTIONS.includes(calleeName) || (ts.isPropertyAccessExpression(callee) && ENTRY_REGISTRARS.includes(calleeName)))
            return this.res('unlocked', [[this.hop(call), 'event-loop / route callback (entry: runs outside any lock)']], `callback registered with ${calleeName}`);
        if (ts.isPropertyAccessExpression(callee) && ['then', 'catch', 'finally'].includes(calleeName)) {
            if (!this.consumed(call)) return this.res('unknown', [[this.hop(call)]], `callback of a .${calleeName} chain that is not awaited or returned`);
            return this.lockOfPoint(call, visiting, depth + 1);
        }
        // Higher-order: follow an in-program callee whose parameter is invoked directly and awaited.
        let sym = this.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(callee) ? callee.name : callee);
        if (sym && sym.flags & ts.SymbolFlags.Alias) sym = this.checker.getAliasedSymbol(sym);
        const decls = (sym?.getDeclarations() ?? []).filter((d) => {
            const g = ts.isVariableDeclaration(d) && d.initializer && this.isFnLike(this.strip(d.initializer)) ? this.strip(d.initializer) : d;
            return this.isFnLike(g) && !!(g as ts.FunctionLikeDeclaration).body && !g.getSourceFile().isDeclarationFile;
        });
        if (decls.length !== 1) return this.res('unknown', [[this.hop(call)]], `passed as a callback to ${this.short(callee.getText(), 50)}; its invocation cannot be followed`);
        const d0 = decls[0];
        const g = (ts.isVariableDeclaration(d0) ? this.strip(d0.initializer!) : d0) as ts.FunctionLikeDeclaration;
        const param = g.parameters[index];
        if (!param || param.dotDotDotToken || !ts.isIdentifier(param.name))
            return this.res('unknown', [[this.hop(call)]], `passed to ${this.fnName(g)} at an argument position with no simple parameter`);
        const pUses = this.refsOf(param.name).map((id) => ({ id, u: this.useOf(id) })).filter((x) => x.u.kind !== 'skip');
        if (!pUses.length) return this.res('unknown', [[this.hop(call)]], `${this.fnName(g)} never invokes parameter ${param.name.text}`);
        for (const { id, u } of pUses) {
            if (u.kind !== 'call') return this.res('unknown', [[this.hop(call), `${this.loc(id)} ${param.name.text}`]], `${this.fnName(g)} stores or passes on parameter ${param.name.text} at ${this.loc(id)}; its invocation cannot be followed`);
            if (this.enclosingFn(u.call) !== g) return this.res('unknown', [[this.hop(call), this.hop(u.call)]], `${this.fnName(g)} invokes parameter ${param.name.text} inside a nested function at ${this.loc(u.call)}`);
            if (!this.consumed(u.call)) return this.res('unknown', [[this.hop(call), this.hop(u.call)]], `${this.fnName(g)} does not await or return its call of ${param.name.text} at ${this.loc(u.call)}`);
        }
        const r = this.lockOfPoint(call, visiting, depth + 1);
        const via = `${this.loc(g)} ${this.fnName(g)} invokes parameter ${param.name.text} directly and awaits it (${pUses.map((x) => this.loc(x.id)).join(', ')})`;
        const tagged = { ...r, chains: r.chains.map((c) => [c[0], via, ...c.slice(1)]) };
        if (tagged.status === 'locked' && !this.consumed(call)) return this.res('unknown', tagged.chains, `call at ${this.loc(call)} is not awaited or returned, so the lock can be released before it finishes`, tagged.deps);
        return tagged;
    }

    siteLock(site: ts.Node): { status: LockStatus; evidence: 'lexical' | 'transitive' | null; chains: string[][]; reason: string | null } {
        let r = this.lockOfPoint(site, new Set(), 0);
        if (r.status === 'cycle') r = this.res('unknown', r.chains, 'only recursive references reach this function');
        if (r.status === 'locked') {
            if (!this.consumed(site)) return { status: 'unknown', evidence: null, chains: r.chains, reason: 'the signing call is not awaited or returned inside the locked body, so the lock can be released before the nonce is taken' };
            const f = this.enclosingFn(site);
            const pos = f ? this.argPosition(f) : undefined;
            const lexical = !!pos && this.isLockCall(pos.call) && pos.index === 1;
            return { status: 'locked', evidence: lexical ? 'lexical' : 'transitive', chains: r.chains, reason: null };
        }
        return { status: r.status as LockStatus, evidence: null, chains: r.chains, reason: r.reason ?? null };
    }

    // ------------------------------------------------- dead code (operator ruling on WR-24)

    private siteNodes = new Map<string, ts.Node>();

    /** The outermost function holding n: the only way n runs is a call of that function. */
    outermostFn(n: ts.Node): ts.FunctionLikeDeclaration | undefined {
        let out: ts.FunctionLikeDeclaration | undefined;
        for (let f = this.enclosingFn(n); f; f = this.enclosingFn(f)) out = f;
        return out;
    }

    /** The name of a module-level function (a function declaration, or a const holding an arrow or function expression, directly in the file), else null. */
    moduleFnName(f: ts.FunctionLikeDeclaration): string | null {
        if (ts.isFunctionDeclaration(f)) return f.name && ts.isSourceFile(f.parent) ? f.name.text : null;
        if (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) {
            const u = this.up(f);
            const p = u.parent;
            if (p && ts.isVariableDeclaration(p) && p.initializer === u && ts.isIdentifier(p.name) && ts.isVariableDeclarationList(p.parent) && (p.parent.flags & ts.NodeFlags.Const) !== 0 && ts.isVariableStatement(p.parent.parent) && ts.isSourceFile(p.parent.parent.parent)) return p.name.text;
        }
        return null;
    }

    /** For a dead entry: a site's outermost function and the name an entry uses for it. */
    deadFunctionOf(s: { file: string; line: number; column: number }): { name: string; fn: ts.FunctionLikeDeclaration } | null {
        const n = this.siteNodes.get(`${s.file}:${s.line}:${s.column}`);
        const f = n ? this.outermostFn(n) : undefined;
        return f ? { name: this.moduleFnName(f) ?? this.fnName(f), fn: f } : null;
    }

    /** Whether file declares a module-level function of this name (for the stale-dead message). */
    moduleFunctionExists(file: string, name: string): boolean {
        const sf = this.auditedFiles().find((x) => this.rel(x.fileName) === file);
        if (!sf) return false;
        let found = false;
        const visit = (n: ts.Node) => {
            if (found) return;
            if (this.isFnLike(n) && this.moduleFnName(n) === name) found = true;
            else ts.forEachChild(n, visit);
        };
        visit(sf);
        return found;
    }

    /** Prove a function unreachable: module-level, no export modifier, and no reference anywhere in the program. */
    unreachableProof(f: ts.FunctionLikeDeclaration): { unprovable: string } | { reachable: string[] } {
        const name = this.moduleFnName(f);
        if (name === null) return { unprovable: `${this.fnName(f)} at ${this.loc(f)} is not a module-level function declaration or const function, the only shapes the census proves unreachable` };
        const holder: ts.Node = ts.isFunctionDeclaration(f) ? f : this.up(f).parent!.parent!.parent!;
        const mods = ts.canHaveModifiers(holder) ? ts.getModifiers(holder) ?? [] : [];
        const reasons: string[] = [];
        if (mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) reasons.push(`${name} is exported (export modifier at ${this.loc(holder)})`);
        const handle = this.handleOf(f);
        if (!handle) return { unprovable: `${name} has no name the census can look up` };
        for (const id of this.refsOf(handle)) reasons.push(`${name} is referenced at ${this.loc(id)} (${this.short(id.parent.getText(), 50)})`);
        return { reachable: reasons };
    }

    // ------------------------------------------------- contract method values (CR-09)

    /**
     * The contract and ABI method an expression takes as a value: `c.m`, `c['m']` (or a computed
     * key, method null) or `c.getFunction(...)`, on a receiver typed as a Contract, where the
     * result is a contract method object. Null for anything else.
     */
    methodRef(e: ts.Expression): { recv: ts.Expression; method: string | null } | null {
        const x = this.strip(e);
        let recv: ts.Expression | undefined;
        let method: string | null = null;
        if (ts.isPropertyAccessExpression(x)) {
            recv = x.expression;
            method = x.name.text;
        } else if (ts.isElementAccessExpression(x)) {
            recv = x.expression;
            method = ts.isStringLiteralLike(x.argumentExpression) ? x.argumentExpression.text : null;
        } else if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === 'getFunction') {
            recv = x.expression.expression;
            const a0 = x.arguments[0];
            method = a0 && ts.isStringLiteralLike(a0) ? a0.text : null;
        } else return null;
        const rt = this.typeAt(recv);
        if (this.isAnyish(rt) || !this.isContract(rt)) return null;
        if (!ts.isCallExpression(x) && method !== null && this.isOwnContractMember(rt, method)) return null;
        if (!this.isMethod(this.typeAt(x))) return null;
        return { recv, method };
    }

    /**
     * Where a name holds a contract method taken once and never reassigned: a const initialized
     * with a method reference, or a const destructuring of a Contract (`const { approve } = token`).
     */
    holderOrigin(name: ts.Identifier): { recv: ts.Expression; method: string | null } | null {
        let sym = this.checker.getSymbolAtLocation(name);
        if (sym && sym.flags & ts.SymbolFlags.Alias) sym = this.checker.getAliasedSymbol(sym);
        const decls = sym?.getDeclarations() ?? [];
        if (decls.length !== 1) return null;
        const d = decls[0];
        const isConst = (v: ts.VariableDeclaration) => (ts.getCombinedNodeFlags(v) & ts.NodeFlags.Const) !== 0;
        if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && d.initializer && isConst(d)) return this.methodRef(d.initializer);
        if (ts.isBindingElement(d) && ts.isIdentifier(d.name) && !d.dotDotDotToken && ts.isObjectBindingPattern(d.parent)) {
            const v = d.parent.parent;
            if (!ts.isVariableDeclaration(v) || !v.initializer || !isConst(v)) return null;
            const rt = this.typeAt(v.initializer);
            if (this.isAnyish(rt) || !this.isContract(rt)) return null;
            const pn = d.propertyName;
            const key = pn ? (ts.isIdentifier(pn) || ts.isStringLiteralLike(pn) ? pn.text : null) : d.name.text;
            if (key !== null && this.isOwnContractMember(rt, key)) return null;
            if (!this.isMethod(this.typeAt(d.name))) return null;
            return { recv: v.initializer, method: key };
        }
        return null;
    }

    /** A use of a method object that does not hand it on: a call of it, a read of its data, or a called .send / a read-only op. */
    private methodUseStays(n: ts.Node): boolean {
        const u = this.up(n);
        const p = u.parent;
        if (!p) return false;
        if (ts.isCallExpression(p) && p.expression === u) return true;
        if (ts.isPropertyAccessExpression(p) && p.expression === u) {
            const m = p.name.text;
            if (METHOD_DATA_MEMBERS.includes(m) || m in METHOD_OPS_EXCLUDED) return true;
            if (m === 'send' || ((m === 'call' || m === 'apply') && this.isFunctionProtoMember(p))) {
                const pu = this.up(p);
                return !!pu.parent && ts.isCallExpression(pu.parent) && pu.parent.expression === pu;
            }
        }
        return false;
    }

    /** True when the method object at n (a method reference) can reach code the census cannot follow. */
    methodEscapes(n: ts.Node): boolean {
        if (this.methodUseStays(n)) return false;
        const u = this.up(n);
        const p = u.parent;
        // const x = c.m: judged by every use of x (each call is classified through holderOrigin).
        if (p && ts.isVariableDeclaration(p) && p.initializer === u && ts.isIdentifier(p.name) && this.holderOrigin(p.name)) return this.holderEscapes(p.name);
        return true;
    }

    holderEscapes(name: ts.Identifier): boolean {
        return this.refsOf(name).some((id) => !this.methodUseStays(id));
    }

    /** `f.call` / `f.apply` / `f.bind` where the member is Function.prototype's (not a method named call, such as provider.call). */
    isFunctionProtoMember(pa: ts.PropertyAccessExpression): boolean {
        if (!['call', 'apply', 'bind'].includes(pa.name.text)) return false;
        const sym = this.checker.getSymbolAtLocation(pa.name);
        return !!sym?.getDeclarations()?.some((d) => {
            const owner = d.parent;
            return !!owner && ts.isInterfaceDeclaration(owner) && /^(Function|CallableFunction|NewableFunction)$/.test(owner.name.text) && d.getSourceFile().isDeclarationFile;
        });
    }

    /** The signing API a member expression names on its receiver, for a value use (WR-23): `wallet.sendTransaction`, `fb.sendBundle`. */
    signingMemberRef(e: ts.Expression): { recv: ts.Expression; name: string; api: string } | null {
        const x = this.strip(e);
        if (!ts.isPropertyAccessExpression(x)) return null;
        const name = x.name.text;
        const rt = this.typeAt(x.expression);
        if (this.isAnyish(rt)) return null;
        if (this.checker.getSignaturesOfType(this.checker.getNonNullableType(this.typeAt(x)), ts.SignatureKind.Call).length === 0) return null;
        if (SIGN_TX.includes(name)) return { recv: x.expression, name, api: this.isSigner(rt) ? `signer.${name}` : `delegated.${name}` };
        if (SIGNER_ONLY_TX.includes(name) && this.isSigner(rt)) return { recv: x.expression, name, api: `signer.${name}` };
        if (BUNDLE.includes(name) && this.isBundler(rt)) return { recv: x.expression, name, api: `flashbots.${name}` };
        return null;
    }


    // ---------------------------------------------------------- contracts

    private abiOf(e: ts.Expression | undefined, depth = 0): { name: string; mut: string }[] | null {
        if (!e || depth > 6) return null;
        const x = this.strip(e);
        if (ts.isArrayLiteralExpression(x)) {
            const out: { name: string; mut: string }[] = [];
            for (const el of x.elements) {
                const v = this.strip(el as ts.Expression);
                if (ts.isStringLiteralLike(v)) {
                    const f = parseHr(v.text);
                    if (f) out.push(f);
                } else if (ts.isObjectLiteralExpression(v)) {
                    const get = (k: string) => {
                        const p = v.properties.find((pp) => ts.isPropertyAssignment(pp) && pp.name.getText().replace(/['"]/g, '') === k) as ts.PropertyAssignment | undefined;
                        return p && ts.isStringLiteralLike(p.initializer) ? p.initializer.text : p && (p.initializer.kind === ts.SyntaxKind.TrueKeyword) ? 'true' : undefined;
                    };
                    if (get('type') === 'function' && get('name')) out.push({ name: get('name')!, mut: get('stateMutability') ?? (get('constant') === 'true' ? 'view' : 'unresolved') });
                } else return null;
            }
            return out;
        }
        if (ts.isIdentifier(x) || ts.isPropertyAccessExpression(x)) {
            let sym = this.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(x) ? x.name : x);
            if (sym && sym.flags & ts.SymbolFlags.Alias) sym = this.checker.getAliasedSymbol(sym);
            const d = sym?.valueDeclaration;
            if (d && ts.isVariableDeclaration(d) && d.initializer) return this.abiOf(d.initializer, depth + 1);
            if (d && ts.isPropertyAssignment(d)) return this.abiOf(d.initializer, depth + 1);
        }
        return null;
    }

    private collectAbiNames(sf: ts.SourceFile): void {
        const visit = (n: ts.Node) => {
            if (ts.isArrayLiteralExpression(n)) {
                const f = this.abiOf(n);
                if (f) for (const x of f) if (!['view', 'pure', 'unresolved'].includes(x.mut)) this.abiNames.add(x.name);
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);
    }

    runnerOf(e: ts.Expression | undefined): string {
        if (!e) return 'none';
        const x = this.strip(e);
        if (x.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(x) && x.text === 'undefined')) return 'none';
        const t = this.typeAt(x);
        if (this.isAnyish(t)) return 'unresolved';
        if (this.isSigner(t)) return 'signer';
        if (this.isProvider(t)) return 'provider';
        return 'unresolved';
    }

    /** Trace a contract expression to its constructions: runner kind and ABI expression. */
    originsOf(e: ts.Expression, depth = 0, seen = new Set<ts.Node>()): Origin[] {
        const x = this.strip(e);
        // `seen` is the current trace PATH (cycle guard), not a global visited set: two
        // call sites passing the same variable are two independent branches.
        if (depth > 8 || seen.has(x)) return [{ runner: 'unresolved', abi: undefined, at: `${this.loc(x)} (${depth > 8 ? 'trace depth limit' : 'trace cycle'})` }];
        seen.add(x);
        try {
            return this.originsBody(x, depth, seen);
        } finally {
            seen.delete(x);
        }
    }

    private originsBody(x: ts.Expression, depth: number, seen: Set<ts.Node>): Origin[] {
        if (ts.isNewExpression(x)) {
            const t = this.typeAt(x);
            if (this.isContract(t)) return [{ runner: this.runnerOf(x.arguments?.[2]), abi: x.arguments?.[1], at: this.loc(x), ctor: x }];
            if (this.isFactory(t)) return [{ runner: this.runnerOf(x.arguments?.[2]), abi: x.arguments?.[0], at: this.loc(x) }];
        }
        if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
            const name = x.expression.name.text;
            const recv = x.expression.expression;
            const rt = this.typeAt(recv);
            if (name === 'connect' && (this.isContract(rt) || this.isFactory(rt)))
                return this.originsOf(recv, depth + 1, seen).map((o) => ({ ...o, runner: this.runnerOf(x.arguments[0]), at: `${o.at} -> ${this.loc(x)} connect` }));
            if ((name === 'attach' || name === 'deploy' || name === 'waitForDeployment') && (this.isContract(rt) || this.isFactory(rt))) return this.originsOf(recv, depth + 1, seen);
        }
        if (ts.isIdentifier(x) || ts.isPropertyAccessExpression(x)) {
            let sym = this.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(x) ? x.name : x);
            if (sym && sym.flags & ts.SymbolFlags.Alias) sym = this.checker.getAliasedSymbol(sym);
            const out: Origin[] = [];
            for (const d of sym?.getDeclarations() ?? []) {
                if ((ts.isVariableDeclaration(d) || ts.isPropertyDeclaration(d) || ts.isPropertyAssignment(d)) && d.initializer) out.push(...this.originsOf(d.initializer, depth + 1, seen));
                else if (ts.isParameter(d) && ts.isIdentifier(d.name)) {
                    const g = d.parent as ts.FunctionLikeDeclaration;
                    const idx = g.parameters.indexOf(d);
                    const h = this.isFnLike(g) ? this.handleOf(g) : undefined;
                    const uses = h ? this.refsOf(h).map((id) => this.useOf(id)).filter((u) => u.kind !== 'skip') : [];
                    if (!uses.length) out.push({ runner: 'unresolved', abi: undefined, at: `${this.loc(d)} parameter ${d.name.text} with no traceable call site` });
                    for (const u of uses) {
                        if (u.kind === 'call' && u.call.arguments && u.call.arguments[idx]) out.push(...this.originsOf(u.call.arguments[idx], depth + 1, seen).map((o) => ({ ...o, at: `${o.at} -> ${this.loc(u.call)} argument ${idx}` })));
                        else out.push({ runner: 'unresolved', abi: undefined, at: `${this.loc(d)} parameter ${d.name.text} (a non-call use of ${this.fnName(g)})` });
                    }
                } else out.push({ runner: 'unresolved', abi: undefined, at: `${this.loc(d)} ${ts.SyntaxKind[d.kind]}` });
            }
            if (out.length) return out;
        }
        return [{ runner: 'unresolved', abi: undefined, at: `${this.loc(x)} ${this.short(x.getText(), 40)}` }];
    }

    mutabilityOf(origins: { abi: ts.Expression | undefined }[], method: string): string {
        const muts = new Set<string>();
        for (const o of origins) {
            const abi = this.abiOf(o.abi);
            if (!abi) {
                muts.add('unresolved');
                continue;
            }
            const frags = abi.filter((f) => f.name === method);
            if (!frags.length) muts.add('not-in-abi');
            for (const f of frags) muts.add(['view', 'pure'].includes(f.mut) ? 'view' : f.mut);
        }
        if ([...muts].some((m) => ['nonpayable', 'payable'].includes(m))) return [...muts].includes('payable') ? 'payable' : 'nonpayable';
        if (muts.has('unresolved')) return 'unresolved';
        if (muts.has('not-in-abi') && !muts.has('view')) return 'not-in-abi';
        return 'view';
    }

    // ------------------------------------------------------------ the scan

    run(): CensusResult {
        const sites: Site[] = [];
        const lockCalls: LockCall[] = [];
        let errFiles = 0;
        const unresolvedModules = new Set<string>();
        for (const sf of this.auditedFiles()) {
            const diags = this.program.getSemanticDiagnostics(sf).concat(this.program.getSyntacticDiagnostics(sf));
            if (diags.length) errFiles++;
            for (const dg of diags) if (dg.code === 2307) unresolvedModules.add(`${this.rel(sf.fileName)}: ${ts.flattenDiagnosticMessageText(dg.messageText, ' ').replace(/^Cannot find module '([^']+)'.*$/, '$1')}`);
            const visit = (n: ts.Node) => {
                const v = this.classifyMethodValue(n);
                if (v) sites.push(v);
                if (ts.isCallExpression(n)) {
                    if (this.isLockCall(n)) lockCalls.push({ file: this.rel(sf.fileName), line: this.line(n), key: this.short(n.arguments[0]?.getText() ?? '', 60), enclosing: this.fnName(this.enclosingFn(n)) });
                    const s = this.classify(n);
                    if (s) sites.push(s);
                }
                ts.forEachChild(n, visit);
            };
            visit(sf);
        }
        sites.sort((a, b) => (a.file === b.file ? a.line - b.line || a.column - b.column : a.file < b.file ? -1 : 1));
        sites.forEach((s, i) => (s.id = `SIG-${String(i + 1).padStart(3, '0')}`));
        const all = this.auditedFiles().map((sf) => this.rel(sf.fileName));
        return {
            sites,
            lock_calls: lockCalls,
            program: {
                root_files: this.rootNames.length,
                src_files: all.filter((f) => f.startsWith('src/')).length,
                script_files: all.filter((f) => f.startsWith('scripts/')).length,
                files_with_ts_errors: errFiles,
                unresolved_modules: [...unresolvedModules].sort(),
            },
        };
    }

    private mk(call: ts.Node, api: string, kind: Kind, recvType: string, extra: Partial<Site> = {}): Site {
        const sf = call.getSourceFile();
        const lc = sf.getLineAndCharacterOfPosition(call.getStart(sf));
        const file = this.rel(sf.fileName);
        this.siteNodes.set(`${file}:${lc.line + 1}:${lc.character + 1}`, call);
        const base: Site = {
            id: '',
            file,
            line: lc.line + 1,
            column: lc.character + 1,
            ref: `${file}:${lc.line + 1}@${this.sha}`,
            enclosing: this.fnName(this.enclosingFn(call)),
            api,
            kind,
            receiver_type: recvType,
            excluded: false,
            excluded_reason: null,
            excluded_by: null,
            lock_status: null,
            lock_evidence: null,
            chains: [],
            reason: null,
            type_unresolved: false,
            runner: null,
            mutability: null,
            site_awaited: this.consumed(call),
            review_note: null,
            ...extra,
        };
        if (kind === 'tx-signing' && !base.excluded) {
            if (base.type_unresolved) {
                const l = this.siteLock(call);
                base.lock_status = 'unknown';
                base.chains = l.chains;
                base.reason = (extra.reason ? `${extra.reason}; ` : '') + `receiver type unresolved (${recvType})` + (l.status !== 'unknown' ? `; the reference chain alone reads ${l.status}` : l.reason ? `; ${l.reason}` : '');
            } else {
                const l = this.siteLock(call);
                base.lock_status = l.status;
                base.lock_evidence = l.evidence;
                base.chains = l.chains;
                base.reason = l.reason;
            }
        }
        return base;
    }

    classify(call: ts.CallExpression): Site | null {
        const c0 = this.strip(call.expression);
        // WR-23: `f.call(thisArg, ...)` / `f.apply(thisArg, [...])` runs f: classify the call as f's.
        if (ts.isPropertyAccessExpression(c0) && (c0.name.text === 'call' || c0.name.text === 'apply') && this.isFunctionProtoMember(c0)) {
            const inner = this.classifyCallee(call, this.strip(c0.expression));
            if (inner) return inner;
        }
        return this.classifyCallee(call, c0);
    }

    private classifyCallee(call: ts.CallExpression, callee: ts.Expression): Site | null {
        // Identifier callee: in-program bundle-send functions.
        if (ts.isIdentifier(callee)) {
            if (BUNDLE_FNS.includes(callee.text)) {
                let sym = this.checker.getSymbolAtLocation(callee);
                if (sym && sym.flags & ts.SymbolFlags.Alias) sym = this.checker.getAliasedSymbol(sym);
                if (sym?.getDeclarations()?.some((d) => ts.isFunctionDeclaration(d))) return this.mk(call, callee.text, 'tx-signing', 'function', { runner: 'relay' });
            }
            // CR-09: calling a contract method object held in a name (`const approve = token.approve;
            // await approve(...)`, a getFunction value, a destructured method). Traced to its
            // contract when the name is a const taken from one; otherwise unresolved.
            const ct = this.typeAt(callee);
            if (!this.isAnyish(ct) && this.isMethod(ct)) {
                const h = this.holderOrigin(callee);
                if (h) return this.contractSite(call, h.recv, h.method, 'call', this.typeAt(h.recv));
                return this.mk(call, `method-value.${callee.text}`, 'tx-signing', this.typeText(ct), { type_unresolved: true, reason: `a contract method object ${callee.text} is called; it cannot be traced to its contract` });
            }
            return null;
        }
        // contract.getFunction('m')(...)
        if (ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === 'getFunction') {
            const recv = callee.expression.expression;
            const rt = this.typeAt(recv);
            if (!this.isContract(rt)) return null;
            const a0 = callee.arguments[0];
            if (!a0 || !ts.isStringLiteralLike(a0)) return this.contractSite(call, recv, null, 'call', rt);
            return this.contractSite(call, recv, a0.text, 'call', rt);
        }
        let recv: ts.Expression;
        let name: string | null;
        if (ts.isPropertyAccessExpression(callee)) {
            recv = callee.expression;
            name = callee.name.text;
        } else if (ts.isElementAccessExpression(callee)) {
            recv = callee.expression;
            name = ts.isStringLiteralLike(callee.argumentExpression) ? callee.argumentExpression.text : null;
        } else return null;
        const rt = this.typeAt(recv);
        const anyRecv = this.isAnyish(rt);
        // WR-23: a raw JSON-RPC transaction send (provider.send('eth_sendRawTransaction', ...)).
        if (name === 'send' && !this.isMethod(rt)) {
            const a0 = call.arguments[0];
            if (a0 && ts.isStringLiteralLike(a0) && RPC_SEND_TX.includes(a0.text))
                return this.mk(call, `rpc.${a0.text}`, 'tx-signing', this.typeText(rt), { type_unresolved: true, reason: `a raw JSON-RPC ${a0.text}: the signer and its nonce are outside the census's view` });
        }
        // WR-23: SigningKey.sign signs any digest, a transaction's unsignedHash included.
        if (name === 'sign' && !anyRecv && this.isSigningKey(rt))
            return this.mk(call, 'signingKey.sign', 'tx-signing', this.typeText(rt), { type_unresolved: true, reason: 'SigningKey.sign signs an arbitrary digest (a transaction hash included); what it signs cannot be told statically' });
        // contract.m.send(...) / .staticCall(...) etc.
        if (name && !anyRecv && this.isMethod(rt) && (name === 'send' || name in METHOD_OPS_EXCLUDED)) {
            const inner = this.strip(recv);
            let cRecv: ts.Expression | undefined;
            let m: string | null = null;
            if (ts.isPropertyAccessExpression(inner)) {
                cRecv = inner.expression;
                m = inner.name.text;
            } else if (ts.isElementAccessExpression(inner)) {
                cRecv = inner.expression;
                m = ts.isStringLiteralLike(inner.argumentExpression) ? inner.argumentExpression.text : null;
            } else if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === 'getFunction') {
                cRecv = inner.expression.expression;
                m = inner.arguments[0] && ts.isStringLiteralLike(inner.arguments[0]) ? inner.arguments[0].text : null;
            }
            else if (ts.isIdentifier(inner)) {
                // CR-09: `const m = token.approve; await m.send(...)`.
                const h = this.holderOrigin(inner);
                if (h) return this.contractSite(call, h.recv, h.method, name, this.typeAt(h.recv));
                if (name === 'send') return this.mk(call, `method-value.${inner.text}.send`, 'tx-signing', this.typeText(rt), { type_unresolved: true, reason: `${inner.text}.send is called on a contract method object that cannot be traced to its contract` });
                return null;
            }
            if (!cRecv || !this.isContract(this.typeAt(cRecv))) {
                if (name === 'send') return this.mk(call, 'method-value.send', 'tx-signing', this.typeText(rt), { type_unresolved: true, reason: '.send is called on a contract method object that cannot be traced to its contract' });
                return null;
            }
            return this.contractSite(call, cRecv, m, name, this.typeAt(cRecv));
        }
        if (name === null) {
            // computed property call: unresolved if the receiver could sign. A Contract goes
            // through the runner trace first: a provider-runner contract can never sign,
            // whatever method the expression names.
            if (!anyRecv && this.isContract(rt)) return this.contractSite(call, recv, null, 'call', rt);
            if (anyRecv || this.isSigner(rt) || this.isBundler(rt))
                return this.mk(call, `computed[${this.short(callee.getText(), 40)}]`, 'tx-signing', this.typeText(rt), { type_unresolved: true });
            return null;
        }
        if (anyRecv) {
            // WR-23: an any-typed receiver traced to a `new Contract(...)` (an artifact ABI, or a
            // contract annotated or cast to any) is a contract call whatever the method name: the
            // runner and the ABI (when readable) are traced like a typed contract's.
            const ctor = this.originsOf(recv).find((o) => o.ctor)?.ctor;
            if (ctor && !this.isOwnContractMember(this.typeAt(ctor), name)) return this.contractSite(call, recv, name, 'call', this.typeAt(ctor));
            if (SIGN_MSG.includes(name)) return this.mk(call, `any.${name}`, 'message-signing', this.typeText(rt), { type_unresolved: true });
            if (SIGN_TX.includes(name) || SIGNER_ONLY_TX.includes(name) || BUNDLE.includes(name) || name === 'deploy' || this.abiNames.has(name))
                return this.mk(call, `any.${name}`, 'tx-signing', this.typeText(rt), { type_unresolved: true });
            return null;
        }
        if (SIGN_TX.includes(name) || SIGN_MSG.includes(name) || SIGNER_ONLY_TX.includes(name)) {
            if (this.isSigner(rt)) return this.mk(call, `signer.${name}`, SIGN_MSG.includes(name) ? 'message-signing' : 'tx-signing', this.typeText(rt));
            // CR-08: a receiver that is not structurally a Signer may still be one at run time
            // (ethers' ContractRunner, Pick<Wallet, 'sendTransaction'>, a local interface over a
            // Wallet), and its implementation may live outside the program (ethers' Wallet is never
            // a census site). So the call itself is a counted site and its lock is judged like any
            // other: an unlocked or unknown delegation fails the gate, a locked one passes.
            if (SIGN_TX.includes(name)) return this.mk(call, `delegated.${name}`, 'tx-signing', this.typeText(rt), { delegated: true });
            return null;
        }
        if (BUNDLE.includes(name) && this.isBundler(rt)) return this.mk(call, `flashbots.${name}`, 'tx-signing', this.typeText(rt), { runner: 'bundle' });
        if (this.isFactory(rt) && (name === 'deploy' || name === 'getDeployTransaction')) {
            const origins = this.originsOf(recv);
            const runner = [...new Set(origins.map((o) => o.runner))].join('|');
            if (name === 'getDeployTransaction')
                return this.mk(call, 'ContractFactory.getDeployTransaction', 'tx-signing', this.typeText(rt), { excluded: true, excluded_by: 'census', excluded_reason: 'getDeployTransaction builds an unsigned deployment request; the sendTransaction that signs it is counted separately', runner });
            return this.mk(call, 'ContractFactory.deploy', 'tx-signing', this.typeText(rt), { runner, mutability: 'deployment' });
        }
        if (this.isContract(rt) && !this.isOwnContractMember(rt, name)) return this.contractSite(call, recv, name, 'call', rt);
        // CR-09: a contract method object reached through a receiver that is not typed as a
        // Contract (Pick<Contract, 'approve'>, an object holding token.approve).
        const ct = this.typeAt(callee);
        if (!this.isAnyish(ct) && this.isMethod(ct)) return this.mk(call, `method.${name}`, 'tx-signing', this.typeText(rt), { type_unresolved: true, reason: `${name} is a contract method object on a receiver that is not typed as a Contract` });
        // CR-09: a narrow interface over a contract or signer (`new Contract(...) as unknown as
        // IRouter`): a method declared only as a signature in the program, with no body the census
        // could look into, that returns a TransactionResponse. It may sign, so it is a site and its
        // lock is judged.
        if (!this.isSigner(rt) && !this.isProvider(rt) && !this.isFactory(rt) && !this.isBundler(rt) && this.isTxResponse(this.typeAt(call)) && this.signatureOnlyInProgram(callee))
            return this.mk(call, `interface.${name}`, 'tx-signing', this.typeText(rt));
        return null;
    }

    /** Every declaration of the called member is an in-program signature with no body (an interface or type-literal member, or an abstract method). */
    private signatureOnlyInProgram(callee: ts.Expression): boolean {
        const n = ts.isPropertyAccessExpression(callee) ? callee.name : ts.isElementAccessExpression(callee) ? callee.argumentExpression : callee;
        let sym = this.checker.getSymbolAtLocation(n);
        if (sym && sym.flags & ts.SymbolFlags.Alias) sym = this.checker.getAliasedSymbol(sym);
        const decls = sym?.getDeclarations() ?? [];
        if (!decls.length) return false;
        return decls.every((d) => {
            const sf = d.getSourceFile();
            const r = this.rel(sf.fileName);
            if (sf.isDeclarationFile || !(r.startsWith('src/') || r.startsWith('scripts/'))) return false;
            if (ts.isMethodSignature(d) || ts.isPropertySignature(d)) return true;
            if ((ts.isMethodDeclaration(d) || ts.isPropertyDeclaration(d)) && (ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Abstract) !== 0) return true;
            return false;
        });
    }

    /**
     * CR-09: a contract method object that is handed on (passed as a callback, stored, returned,
     * or held in a name that is) is a site where it is taken: the census cannot follow where it is
     * invoked, so its lock reads unknown. A method object taken and only called in place is
     * classified at the call (classify / holderOrigin) instead.
     */
    classifyMethodValue(n: ts.Node): Site | null {
        if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) {
            const h = this.holderOrigin(n.name);
            if (!h || !this.holderEscapes(n.name)) return null;
            return this.contractSite(n.name, h.recv, h.method, 'value', this.typeAt(h.recv));
        }
        if (!ts.isPropertyAccessExpression(n) && !ts.isElementAccessExpression(n) && !ts.isCallExpression(n)) return null;
        if (ts.isCallExpression(n) && !(ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'getFunction')) return null;
        // WR-23: a signing method taken as a value (`wallet.sendTransaction.bind(wallet)`, passed
        // as a callback, stored): where it runs cannot be followed. Its call and its .call/.apply
        // forms are classified at the call.
        const sm = ts.isPropertyAccessExpression(n) ? this.signingMemberRef(n) : null;
        if (sm) {
            const u = this.up(n);
            const p = u.parent;
            const calledHere = !!p && ts.isCallExpression(p) && p.expression === u;
            const viaCallApply = !!p && ts.isPropertyAccessExpression(p) && p.expression === u && (p.name.text === 'call' || p.name.text === 'apply') && this.isFunctionProtoMember(p) && !!this.up(p).parent && ts.isCallExpression(this.up(p).parent!) && (this.up(p).parent as ts.CallExpression).expression === this.up(p);
            if (calledHere || viaCallApply) return null;
            return this.mk(n, `${sm.api}.value`, 'tx-signing', this.typeText(this.typeAt(sm.recv)), { type_unresolved: true, reason: `signing method ${sm.name} taken as a value at ${this.loc(n)}; where it is invoked cannot be followed` });
        }
        const ref = this.methodRef(n);
        if (!ref || !this.methodEscapes(n)) return null;
        return this.contractSite(n, ref.recv, ref.method, 'value', this.typeAt(ref.recv));
    }

    private contractSite(call: ts.Node, recv: ts.Expression, method: string | null, op: string, rt: ts.Type): Site | null {
        const origins = this.originsOf(recv);
        const runners = new Set(origins.map((o) => o.runner));
        const canSign = runners.has('signer') || runners.has('unresolved');
        if (!canSign) return null; // provider / no runner: a call can never sign
        const runner = [...runners].sort().join('|');
        const traced = origins.map((o) => `${o.runner} @ ${o.at}`);
        const api = method === null ? `contract.computed${op === 'call' ? '' : '.' + op}` : `contract.${method}${op === 'call' ? '' : '.' + op}`;
        if (op === 'value') {
            // CR-09: the method object is handed on (a callback, a stored value); where it is
            // called cannot be followed, so the lock reads unknown unless the method is a view.
            if (method !== null && this.mutabilityOf(origins, method) === 'view') return this.mk(call, api, 'tx-signing', this.typeText(rt), { excluded: true, excluded_by: 'census', excluded_reason: `view/pure ABI fragment ${method} used as a value: a read-only eth_call; no transaction, no nonce`, runner, mutability: 'view', origins: traced });
            return this.mk(call, api, 'tx-signing', this.typeText(rt), { type_unresolved: true, runner, origins: traced, reason: `contract method ${method ?? '(computed)'} used as a value at ${this.loc(call)}; where it is invoked cannot be followed` });
        }
        if (method === null) return this.mk(call, api, 'tx-signing', this.typeText(rt), { type_unresolved: true, runner, origins: traced });
        if (op in METHOD_OPS_EXCLUDED) return this.mk(call, api, 'tx-signing', this.typeText(rt), { excluded: true, excluded_by: 'census', excluded_reason: METHOD_OPS_EXCLUDED[op], runner, origins: traced });
        const mut = this.mutabilityOf(origins, method);
        if (mut === 'view') return this.mk(call, api, 'tx-signing', this.typeText(rt), { excluded: true, excluded_by: 'census', excluded_reason: `view/pure ABI fragment ${method}: a read-only eth_call through the contract runner; no transaction, no nonce`, runner, mutability: 'view', origins: traced });
        const extra: Partial<Site> = { runner, mutability: mut, origins: traced };
        if (!runners.has('signer')) extra.reason = `runner unresolved (${origins.map((o) => o.at).join('; ')})`;
        const s = this.mk(call, api, 'tx-signing', this.typeText(rt), extra);
        if (!runners.has('signer')) s.reason = [extra.reason, s.reason].filter(Boolean).join('; ');
        return s;
    }
}

function parseHr(s: string): { name: string; mut: string } | null {
    const m = /^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(s);
    if (!m) return null;
    let i = s.indexOf('(', m.index);
    let depth = 0;
    for (; i < s.length; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')' && --depth === 0) break;
    }
    const tail = s.slice(i + 1).split(/\breturns\b/)[0];
    const mut = /\b(view|pure|constant)\b/.test(tail) ? 'view' : /\bpayable\b/.test(tail) ? 'payable' : 'nonpayable';
    return { name: m[1], mut };
}

function findIdentAt(sf: ts.SourceFile, pos: number): ts.Identifier | undefined {
    let found: ts.Identifier | undefined;
    const visit = (n: ts.Node) => {
        if (pos < n.getFullStart() || pos >= n.getEnd()) return;
        if ((ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) && n.getStart(sf) === pos) {
            found = n as ts.Identifier;
            return;
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
}

function isDeclName(id: ts.Identifier): boolean {
    const p = id.parent as ts.Node & { name?: ts.Node };
    if (!p) return false;
    const declKinds = [
        ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.MethodSignature, ts.SyntaxKind.PropertyDeclaration,
        ts.SyntaxKind.PropertySignature, ts.SyntaxKind.VariableDeclaration, ts.SyntaxKind.Parameter, ts.SyntaxKind.PropertyAssignment,
        ts.SyntaxKind.ClassDeclaration, ts.SyntaxKind.InterfaceDeclaration, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor,
        ts.SyntaxKind.BindingElement, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.TypeAliasDeclaration, ts.SyntaxKind.EnumDeclaration,
    ];
    return declKinds.includes(p.kind) && p.name === id;
}

// ---------------------------------------------------------------------------
// Output assembly, manual review merge and reconciliation
// ---------------------------------------------------------------------------

interface ManualSite {
    file: string;
    line: number;
    api: string;
    kind: Kind;
    lock_status?: string;
    note: string;
    exclude?: { reason: string; evidence: string };
}
interface ManualDiff {
    file: string;
    line: number;
    api: string;
    explanation?: string;
}

const key = (s: { file: string; line: number; api: string }) => `${s.file}:${s.line}:${s.api}`;

function assemble(c: Census, r: CensusResult, manual: any | null, manualPath: string | null): { out: any; problems: string[] } {
    const problems: string[] = [];
    let reconciliation: any = null;
    if (manual) {
        const mSites: ManualSite[] = Array.isArray(manual.sites) ? manual.sites : [];
        const byKey = new Map<string, ManualSite>();
        for (const m of mSites) {
            if (byKey.has(key(m))) problems.push(`manual inventory repeats ${key(m)}`);
            byKey.set(key(m), m);
        }
        for (const s of r.sites) {
            const m = byKey.get(key(s));
            if (!m) continue;
            s.review_note = m.note;
            if (m.exclude && s.kind === 'tx-signing' && !s.excluded) {
                s.excluded = true;
                s.excluded_by = 'auditor';
                s.excluded_reason = `${m.exclude.reason} (evidence: ${m.exclude.evidence})`;
            }
            if (m.lock_status && s.lock_status && !s.excluded && m.lock_status !== s.lock_status) {
                s.manual_lock_status = m.lock_status;
                s.lock_disagreement = true;
            }
        }
        const counted = (s: Site) => s.kind === 'tx-signing' && !s.excluded;
        const censusTx = new Set(r.sites.filter(counted).map(key));
        const manualTx = new Set(mSites.filter((m) => m.kind === 'tx-signing' && !m.exclude).map(key));
        const missingFromCensus = [...manualTx].filter((k) => !censusTx.has(k)).sort();
        const missingFromManual = [...censusTx].filter((k) => !manualTx.has(k)).sort();
        const declared = (arr: ManualDiff[] | undefined) => new Map((arr ?? []).map((d) => [key(d), d]));
        const dC = declared(manual.missing_from_census);
        const dM = declared(manual.missing_from_manual);
        const same = (a: string[], b: Map<string, ManualDiff>) => a.length === b.size && a.every((k) => b.has(k));
        if (!same(missingFromCensus, dC)) problems.push(`missing_from_census in ${manualPath} does not match the computed difference: computed [${missingFromCensus.join(', ')}], declared [${[...dC.keys()].join(', ')}]`);
        if (!same(missingFromManual, dM)) problems.push(`missing_from_manual in ${manualPath} does not match the computed difference: computed [${missingFromManual.join(', ')}], declared [${[...dM.keys()].join(', ')}]`);
        for (const d of [...dC.values(), ...dM.values()]) if (!d.explanation) problems.push(`reconciliation difference ${key(d)} has no explanation`);
        reconciliation = { manual_inventory: manualPath, manual_tx_signing: manualTx.size, census_tx_signing: censusTx.size, missing_from_census: missingFromCensus, missing_from_manual: missingFromManual };
        for (const s of r.sites) {
            const needs = (s.kind === 'tx-signing' && !s.excluded && (s.lock_status !== 'locked' || /^contract\./.test(s.api))) || s.excluded_by === 'auditor';
            if (needs && !s.review_note) problems.push(`${s.id} ${key(s)} (${s.lock_status ?? 'excluded'}) has no review note in the manual inventory`);
            if (s.lock_disagreement) problems.push(`${s.id} ${key(s)}: census lock_status ${s.lock_status} differs from the manual reading ${s.manual_lock_status}`);
        }
    }
    const tx = r.sites.filter((s) => s.kind === 'tx-signing' && !s.excluded);
    const msg = r.sites.filter((s) => s.kind === 'message-signing');
    const byFile: Record<string, { tx_signing: number; message_signing: number; excluded: number }> = {};
    for (const s of r.sites) {
        const b = (byFile[s.file] ??= { tx_signing: 0, message_signing: 0, excluded: 0 });
        if (s.excluded) b.excluded++;
        else if (s.kind === 'tx-signing') b.tx_signing++;
        else b.message_signing++;
    }
    const byLock: Record<string, Record<string, number>> = { all: { locked: 0, unlocked: 0, unknown: 0 }, src: { locked: 0, unlocked: 0, unknown: 0 }, scripts: { locked: 0, unlocked: 0, unknown: 0 } };
    for (const s of tx) {
        byLock.all[s.lock_status!]++;
        byLock[s.file.startsWith('src/') ? 'src' : 'scripts'][s.lock_status!]++;
    }
    const out = {
        generated_by: '.planning/audit/tools/signing-census.ts',
        audited_sha: c.sha,
        method: {
            summary:
                'TypeScript 5.8.3 type-checker census over a git archive snapshot of src/ and scripts/ at audited_sha (tsconfig.json root files plus scripts/**/*.ts; node_modules = per-entry junctions, type information only, nothing executed). Every CallExpression is classified by the TYPE of its receiver; contract runners and ABIs are traced to their constructions; lock status follows reference chains through the TypeScript language service (findReferences), cycle-safe, and requires every hop to be awaited or returned.',
            tx_signing: 'sendTransaction/signTransaction on a Signer type, and on any other receiver type (delegated.*, CR-08); ContractFactory.deploy; state-changing contract method calls and .send on a Signer-runner Contract; Flashbots signBundle/sendBundle/sendRawBundle/sendPrivateTransaction; in-program rawSendBundle/sendRawBundle; unresolved receivers (type_unresolved, lock unknown)',
            message_signing: 'signMessage/signTypedData on a Signer (no nonce; never a D-NONCE-AUTHORITY-ALL violation)',
            excluded: 'view/pure ABI fragments, .staticCall/.estimateGas/.populateTransaction, getDeployTransaction (census), and auditor exclusions with evidence (manual inventory)',
            lock: 'locked lexical = the site function is the op of withNonceLock; locked transitive = every reference chain ends in such an op with every hop awaited/returned; unlocked = a chain reaches module top level, an event/route callback or an exported function with no in-program caller; unknown = unresolved type, unfollowable callback/value use, un-awaited hop, no reference',
            in_process_only: 'the lock is per process; a script is a separate process with its own lock (AUD-SCRIPTS-002)',
            program: r.program,
        },
        total_tx_signing: tx.length,
        total_message_signing: msg.length,
        total_excluded: r.sites.filter((s) => s.excluded).length,
        by_file: byFile,
        by_lock_status: byLock,
        sites: r.sites,
        lock_calls: r.lock_calls,
        reconciliation,
    };
    return { out, problems };
}

// ---------------------------------------------------------------------------
// The gate (Phase 23 / Plan 23-17): the census on a checkout against
// scripts/signing-census-exceptions.json
// ---------------------------------------------------------------------------

const EXCEPTIONS_REL = 'scripts/signing-census-exceptions.json';
const FINDING_ID_RE = /^AUD-[A-Z0-9]+-\d{3}$/;
const IS_WIN = process.platform === 'win32';

type ProblemCode =
    | 'bad-exceptions-file'
    | 'no-files'
    | 'no-sites'
    | 'file-not-audited'
    | 'program-holds-protected-file'
    | 'unknown-lock'
    | 'surplus-unlocked'
    | 'stale-unlocked'
    | 'below-floor'
    | 'stale-excluded'
    | 'excluded-state-changing'
    | 'excluded-evidence'
    | 'missing-decision-ref'
    | 'decision-not-found'
    | 'decision-does-not-cover'
    | 'finding-not-found'
    | 'floor-lowered-unnamed'
    | 'dead-reachable'
    | 'dead-unprovable'
    | 'dead-finding-does-not-name'
    | 'dead-count'
    | 'stale-dead'
    | 'history-bad-version'
    | 'history-empty';

interface Problem {
    code: ProblemCode;
    message: string;
}

interface UnlockedEntry {
    file: string;
    enclosing: string;
    call: string;
    count: number;
    finding_id: string;
    decision_ref: string[];
    note?: string;
}

interface ExcludedEntry {
    file: string;
    enclosing: string;
    call: string;
    count: number;
    reason: string;
    evidence_ref: string;
    note?: string;
}

interface DeadEntry {
    file: string;
    function: string;
    call: string;
    count: number;
    finding_id: string;
    reason: string;
    note?: string;
}

interface Exceptions {
    floor: number;
    unlocked: UnlockedEntry[];
    excluded: ExcludedEntry[];
    dead: DeadEntry[];
}

/** A dead entry's key: file, outermost function and call. */
const deadEntryKey = (e: { file: string; function: string; call: string }): string => `${e.file}|${e.function}|${e.call}`;

/** A finding recommendation that names `fn` for deletion: a delete/remove verb and the function name as a whole word. */
function recommendsDeleting(recommendation: unknown, fn: string): boolean {
    if (typeof recommendation !== 'string') return false;
    const esc = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return /\b(delete|deletes|deleted|deleting|remove|removes|removed|removing)\b/i.test(recommendation) && new RegExp(`(?<![A-Za-z0-9_$.])${esc}(?![A-Za-z0-9_$])`).test(recommendation);
}

interface GateRun {
    census: Census;
    result: CensusResult;
}

interface GateSummary {
    tx_signing: number;
    locked: number;
    unlocked: number;
    unknown: number;
    excluded_by_auditor: number;
    excluded_by_census: number;
    message_signing: number;
    /** Sites in a provably unreachable function listed under dead (operator ruling on WR-24): counted toward the floor, neither locked nor unlocked. */
    dead: number;
    src_files: number;
    script_files: number;
    floor: number;
}

/** The exception key: file, enclosing function and call (never a line number, which a formatter shifts). */
const entryKey = (e: { file: string; enclosing: string; call: string }): string => `${e.file}|${e.enclosing}|${e.call}`;
const siteKey = (s: Site): string => `${s.file}|${s.enclosing}|${s.api}`;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Validate the exception file. A structural error stops the gate (bad-exceptions-file); a missing decision_ref is its own problem (AC-53). */
function parseExceptions(raw: unknown, where: string): { ex: Exceptions | null; problems: Problem[] } {
    const problems: Problem[] = [];
    const bad = (m: string) => problems.push({ code: 'bad-exceptions-file', message: `${where}: ${m}` });
    if (!isObj(raw)) {
        bad('not a JSON object');
        return { ex: null, problems };
    }
    for (const k of Object.keys(raw)) if (!['description', 'floor', 'unlocked', 'excluded', 'dead'].includes(k)) bad(`unknown top-level key ${JSON.stringify(k)}`);
    if (raw.dead !== undefined && !Array.isArray(raw.dead)) bad('dead must be an array');
    if (raw.description !== undefined && typeof raw.description !== 'string') bad('description must be a string');
    if (!posInt(raw.floor)) bad('floor must be a positive integer');
    if (!Array.isArray(raw.unlocked)) bad('unlocked must be an array');
    if (!Array.isArray(raw.excluded)) bad('excluded must be an array');
    if (problems.length) return { ex: null, problems };
    const common = (e: Record<string, unknown>, at: string, allowed: string[]): boolean => {
        let ok = true;
        for (const k of Object.keys(e)) if (!allowed.includes(k)) (bad(`${at}: unknown key ${JSON.stringify(k)}`), (ok = false));
        for (const k of ['file', 'enclosing', 'call']) if (!nonEmpty(e[k])) (bad(`${at}: ${k} must be a non-empty string`), (ok = false));
        if (nonEmpty(e.file) && !/^(src|scripts)\//.test(e.file)) (bad(`${at}: file must be under src/ or scripts/`), (ok = false));
        if (!posInt(e.count)) (bad(`${at}: count must be a positive integer`), (ok = false));
        if (e.note !== undefined && typeof e.note !== 'string') (bad(`${at}: note must be a string`), (ok = false));
        return ok;
    };
    const unlocked: UnlockedEntry[] = [];
    (raw.unlocked as unknown[]).forEach((e, i) => {
        const at = `unlocked[${i}]`;
        if (!isObj(e)) return bad(`${at}: not an object`);
        let ok = common(e, at, ['file', 'enclosing', 'call', 'count', 'finding_id', 'decision_ref', 'note']);
        if (!(typeof e.finding_id === 'string' && FINDING_ID_RE.test(e.finding_id))) (bad(`${at}: finding_id must be a finding ID (AUD-<AREA>-<nnn>)`), (ok = false));
        let refs: string[] = [];
        const dr = e.decision_ref;
        if (dr === undefined || dr === '' || (Array.isArray(dr) && dr.length === 0)) refs = [];
        else if (nonEmpty(dr)) refs = [dr];
        else if (Array.isArray(dr) && dr.every(nonEmpty)) refs = dr as string[];
        else (bad(`${at}: decision_ref must be a record ID or an array of record IDs`), (ok = false));
        if (!ok) return;
        const entry: UnlockedEntry = { file: e.file as string, enclosing: e.enclosing as string, call: e.call as string, count: e.count as number, finding_id: e.finding_id as string, decision_ref: refs };
        if (!refs.length) problems.push({ code: 'missing-decision-ref', message: `${at} ${entryKey(entry)} (${entry.finding_id}) has no decision_ref: an unlocked signing site may be listed only under an operator decision (AC-53)` });
        unlocked.push(entry);
    });
    const excluded: ExcludedEntry[] = [];
    (raw.excluded as unknown[]).forEach((e, i) => {
        const at = `excluded[${i}]`;
        if (!isObj(e)) return bad(`${at}: not an object`);
        let ok = common(e, at, ['file', 'enclosing', 'call', 'count', 'reason', 'evidence_ref', 'note']);
        if (!nonEmpty(e.reason)) (bad(`${at}: reason must be a non-empty string`), (ok = false));
        if (!nonEmpty(e.evidence_ref)) (bad(`${at}: evidence_ref must be a non-empty string`), (ok = false));
        if (!ok) return;
        excluded.push({ file: e.file as string, enclosing: e.enclosing as string, call: e.call as string, count: e.count as number, reason: e.reason as string, evidence_ref: e.evidence_ref as string });
    });
    const dead: DeadEntry[] = [];
    ((raw.dead ?? []) as unknown[]).forEach((e, i) => {
        const at = `dead[${i}]`;
        if (!isObj(e)) return bad(`${at}: not an object`);
        let ok = true;
        for (const k of Object.keys(e)) if (!['file', 'function', 'call', 'count', 'finding_id', 'reason', 'note'].includes(k)) (bad(`${at}: unknown key ${JSON.stringify(k)}`), (ok = false));
        for (const k of ['file', 'function', 'call', 'reason']) if (!nonEmpty(e[k])) (bad(`${at}: ${k} must be a non-empty string`), (ok = false));
        if (nonEmpty(e.file) && !/^(src|scripts)\//.test(e.file)) (bad(`${at}: file must be under src/ or scripts/`), (ok = false));
        if (!posInt(e.count)) (bad(`${at}: count must be a positive integer`), (ok = false));
        if (!(typeof e.finding_id === 'string' && FINDING_ID_RE.test(e.finding_id))) (bad(`${at}: finding_id must be a finding ID (AUD-<AREA>-<NNN>)`), (ok = false));
        if (e.note !== undefined && typeof e.note !== 'string') (bad(`${at}: note must be a string`), (ok = false));
        if (!ok) return;
        dead.push({ file: e.file as string, function: e.function as string, call: e.call as string, count: e.count as number, finding_id: e.finding_id as string, reason: e.reason as string });
    });
    const deadKeys = dead.map(deadEntryKey);
    deadKeys.forEach((k, i) => {
        if (deadKeys.indexOf(k) !== i) bad(`dead: key ${k} is listed twice`);
        if (i > 0 && !(deadKeys[i - 1] < k)) bad(`dead: entries must be sorted by key (file|function|call); ${k} comes after ${deadKeys[i - 1]}`);
    });
    const seen = new Set<string>();
    for (const [list, name] of [[unlocked, 'unlocked'], [excluded, 'excluded']] as const) {
        const keys = list.map(entryKey);
        keys.forEach((k, i) => {
            if (seen.has(k)) bad(`${name}: key ${k} is listed twice`);
            seen.add(k);
            if (i > 0 && !(keys[i - 1] < k)) bad(`${name}: entries must be sorted by key (file|enclosing|call); ${k} comes after ${keys[i - 1]}`);
        });
    }
    if (problems.some((p) => p.code === 'bad-exceptions-file')) return { ex: null, problems };
    return { ex: { floor: raw.floor as number, unlocked, excluded, dead }, problems };
}

function loadExceptions(root: string): { ex: Exceptions | null; problems: Problem[] } {
    const p = path.join(root, EXCEPTIONS_REL);
    if (!fs.existsSync(p)) return { ex: null, problems: [{ code: 'bad-exceptions-file', message: `${EXCEPTIONS_REL} not found` }] };
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        return { ex: null, problems: [{ code: 'bad-exceptions-file', message: `${EXCEPTIONS_REL} is not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    return parseExceptions(raw, EXCEPTIONS_REL);
}

/** A repo-relative path that stays inside root, resolved; null for an absolute path or one that climbs out. */
function insideRoot(root: string, rel: string): string | null {
    if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null;
    const abs = path.resolve(root, rel);
    const r = path.relative(root, abs);
    if (r === '' || r.startsWith('..') || path.isAbsolute(r)) return null;
    return abs;
}

function readJsonOrNull(p: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
        return null;
    }
}

/** True for <root>/.env, <root>/.env.* or anything under <root>/data/ (case-insensitive on Windows). */
function isProtectedPath(root: string, file: string): boolean {
    const norm = (s: string) => (IS_WIN ? posix(s).toLowerCase() : posix(s));
    const r = norm(path.resolve(root));
    const f = norm(path.resolve(root, file));
    if (!f.startsWith(r + '/')) return false;
    const rel = f.slice(r.length + 1);
    return rel === '.env' || rel.startsWith('.env.') || rel === 'data' || rel.startsWith('data/');
}

/** Build the census program over a checkout. Refuses a program holding .env or a data/ file. */
function runCensus(root: string): GateRun {
    const census = new Census(root, 'worktree');
    const held = census.program.getSourceFiles().map((sf) => sf.fileName).filter((f) => isProtectedPath(census.root, f));
    if (held.length) throw new UsageError(`the census program holds ${held.join(', ')}; it may read only TypeScript sources and type information, never .env or data/`);
    return { census, result: census.run() };
}

/** A decision record by ID: .planning/audit/escalations/<id>.json or .planning/audit/decisions/<id>.json, whose own id must match. */
function resolveRecord(root: string, ref: string): { where: string; covers: Set<string> } | { error: string } {
    if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(ref)) return { error: `${JSON.stringify(ref)} is not a record ID` };
    for (const dir of ['escalations', 'decisions']) {
        const rel = `.planning/audit/${dir}/${ref}.json`;
        const p = path.join(root, rel);
        if (!fs.existsSync(p)) continue;
        const j = readJsonOrNull(p);
        if (!isObj(j)) return { error: `${rel} is not a JSON object` };
        if (j.id !== ref) return { error: `${rel} has id ${JSON.stringify(j.id)}, not ${ref}` };
        const covers = new Set<string>();
        for (const k of ['items', 'resolved_items', 'findings']) {
            const v = j[k];
            if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') covers.add(x);
        }
        return { where: rel, covers };
    }
    return { error: `no record .planning/audit/escalations/${ref}.json or .planning/audit/decisions/${ref}.json` };
}

function findingRegistered(root: string, id: string): boolean {
    const j = readJsonOrNull(path.join(root, '.planning', 'audit', 'findings', `${id}.json`));
    return isObj(j) && j.id === id;
}

function evaluateGate(root: string, run: GateRun, ex: Exceptions): { problems: Problem[]; summary: GateSummary; sites: Site[] } {
    const problems: Problem[] = [];
    const { census, result } = run;
    const prog = result.program;
    // Work on copies: the census result is never changed, so one run can be evaluated against several lists.
    const sites = result.sites.map((s) => ({ ...s }));
    const summary: GateSummary = { tx_signing: 0, locked: 0, unlocked: 0, unknown: 0, dead: 0, excluded_by_auditor: 0, excluded_by_census: 0, message_signing: 0, src_files: prog.src_files, script_files: prog.script_files, floor: ex.floor };
    // AC-53: every listed unlocked site names a registered finding and decision records that cover it.
    for (const e of ex.unlocked) {
        const k = entryKey(e);
        if (!findingRegistered(root, e.finding_id)) problems.push({ code: 'finding-not-found', message: `unlocked ${k}: finding ${e.finding_id} has no record .planning/audit/findings/${e.finding_id}.json` });
        for (const ref of e.decision_ref) {
            const rec = resolveRecord(root, ref);
            if ('error' in rec) problems.push({ code: 'decision-not-found', message: `unlocked ${k}: decision_ref ${ref} does not resolve (${rec.error})` });
            else if (!rec.covers.has(e.finding_id)) problems.push({ code: 'decision-does-not-cover', message: `unlocked ${k}: decision_ref ${ref} (${rec.where}) does not list ${e.finding_id} in items, resolved_items or findings` });
        }
    }
    // AC-36: a scan that checked nothing is a failure, never a pass.
    if (prog.src_files === 0 || prog.script_files === 0) {
        problems.push({ code: 'no-files', message: `the census program has ${prog.src_files} src/ files and ${prog.script_files} scripts/ files; a scan that finds no files checked nothing` });
        return { problems, summary, sites };
    }
    // Every JavaScript or TypeScript source file under src/ and scripts/ (.ts .tsx .mts .cts .js
    // .jsx .mjs .cjs, WR-25) must be audited (a narrowed tsconfig include would hide one).
    const audited = new Set(census.auditedFiles().map((sf) => census.rel(sf.fileName)));
    const onDisk: string[] = [];
    walkSources(path.join(census.root, 'src'), onDisk);
    walkSources(path.join(census.root, 'scripts'), onDisk);
    for (const f of onDisk.map((x) => census.rel(x)).sort()) if (!audited.has(f)) problems.push({ code: 'file-not-audited', message: `${f} is not in the census program (tsconfig.json include does not cover it), so its signing sites are not checked` });
    const counted = sites.filter((s) => s.kind === 'tx-signing' && !s.excluded);
    summary.excluded_by_census = sites.filter((s) => s.excluded && s.excluded_by === 'census').length;
    summary.message_signing = sites.filter((s) => s.kind === 'message-signing').length;
    if (counted.length === 0) {
        problems.push({ code: 'no-sites', message: `the census found ${sites.length} sites and no transaction-signing site in ${prog.src_files} src/ and ${prog.script_files} scripts/ files; a scan that finds no signing site checked nothing` });
        return { problems, summary, sites };
    }
    // Auditor exclusions (F3): only a contract call whose mutability the census could not read.
    for (const e of ex.excluded) {
        const k = entryKey(e);
        const matches = counted.filter((s) => siteKey(s) === k);
        if (matches.length !== e.count)
            problems.push({ code: 'stale-excluded', message: `excluded ${k}: listed count ${e.count}, the census finds ${matches.length} counted site(s) at this key${matches.length ? ` (${matches.map((s) => `${s.file}:${s.line}`).join(', ')})` : ''}; correct or remove the entry` });
        const evPath = insideRoot(census.root, e.evidence_ref);
        const ev = evPath ? readJsonOrNull(evPath) : null;
        const evSites = isObj(ev) && Array.isArray(ev.sites) ? (ev.sites as unknown[]) : [];
        const cited = evSites.some((m) => isObj(m) && m.file === e.file && m.api === e.call && isObj(m.exclude) && nonEmpty(m.exclude.reason) && nonEmpty(m.exclude.evidence));
        if (!cited) problems.push({ code: 'excluded-evidence', message: `excluded ${k}: evidence_ref ${e.evidence_ref} ${evPath ? (ev === null ? 'is missing or not JSON' : 'has no manual-inventory site excluding this file and call') : 'is not a path inside the repo'}` });
        for (const s of matches) {
            const unreadable = /^contract\./.test(s.api) && (s.mutability === 'unresolved' || s.mutability === 'not-in-abi');
            if (!unreadable) {
                problems.push({ code: 'excluded-state-changing', message: `excluded ${k}: ${s.file}:${s.line} ${s.api} is a site the census reads as signing (mutability ${s.mutability ?? 'n/a'}); only a contract call whose ABI the census cannot read may be excluded` });
                continue;
            }
            s.excluded = true;
            s.excluded_by = 'auditor';
            s.excluded_reason = `${e.reason} (evidence: ${e.evidence_ref})`;
        }
    }
    // Operator ruling on WR-24: dead entries. The census proves each function unreachable, or the
    // entry fails and its sites stay judged like any other.
    for (const e of ex.dead) {
        const k = deadEntryKey(e);
        let ok = true;
        const rec = readJsonOrNull(path.join(root, '.planning', 'audit', 'findings', `${e.finding_id}.json`));
        if (!isObj(rec) || rec.id !== e.finding_id) {
            problems.push({ code: 'finding-not-found', message: `dead ${k}: finding ${e.finding_id} has no record .planning/audit/findings/${e.finding_id}.json` });
            ok = false;
        } else if (!recommendsDeleting(rec.recommendation, e.function)) {
            problems.push({ code: 'dead-finding-does-not-name', message: `dead ${k}: the recommendation of ${e.finding_id} does not name ${e.function} for deletion (it must say delete or remove and name the function): ${JSON.stringify(String(rec.recommendation ?? '').slice(0, 160))}` });
            ok = false;
        }
        const matches = counted.filter((s) => !s.excluded && s.file === e.file && s.api === e.call && census.deadFunctionOf(s)?.name === e.function);
        if (!matches.length) {
            problems.push({ code: 'stale-dead', message: `dead ${k} (${e.finding_id}): the census finds no ${e.call} site in ${e.function} (${census.moduleFunctionExists(e.file, e.function) ? 'the function remains but the site is gone' : 'the function is gone'}); remove the entry, and lower the floor in a commit naming ${e.finding_id} (AC-34)` });
            continue;
        }
        if (matches.length !== e.count) {
            problems.push({ code: 'dead-count', message: `dead ${k} (${e.finding_id}): listed count ${e.count}, the census finds ${matches.length} site(s) (${matches.map((s) => `${s.file}:${s.line}`).join(', ')})` });
            ok = false;
        }
        const fns = [...new Set(matches.map((s) => census.deadFunctionOf(s)!.fn))];
        if (fns.length !== 1) {
            problems.push({ code: 'dead-unprovable', message: `dead ${k}: ${fns.length} functions in ${e.file} go by the name ${e.function}; the entry cannot say which one is dead` });
            ok = false;
        } else {
            const proof = census.unreachableProof(fns[0]);
            if ('unprovable' in proof) {
                problems.push({ code: 'dead-unprovable', message: `dead ${k}: ${proof.unprovable}` });
                ok = false;
            } else if (proof.reachable.length) {
                problems.push({ code: 'dead-reachable', message: `dead ${k} (${e.finding_id}): ${e.function} is reachable: ${proof.reachable.join('; ')}; a reachable signing site must be locked, not listed as dead` });
                ok = false;
            }
        }
        if (ok) for (const s of matches) s.dead = e.finding_id;
    }
    const remaining = counted.filter((s) => !s.excluded);
    summary.excluded_by_auditor = counted.length - remaining.length;
    summary.tx_signing = remaining.length;
    // A dead site counts toward the floor (remaining) but is neither locked nor unlocked (live).
    const live = remaining.filter((s) => !s.dead);
    summary.dead = remaining.length - live.length;
    for (const s of live) summary[s.lock_status === 'locked' ? 'locked' : s.lock_status === 'unlocked' ? 'unlocked' : 'unknown']++;
    // F3: unknown is never counted as locked or excluded.
    for (const s of live.filter((x) => x.lock_status !== 'locked' && x.lock_status !== 'unlocked'))
        problems.push({ code: 'unknown-lock', message: `${s.file}:${s.line} ${s.api} in ${s.enclosing}: lock status ${s.lock_status ?? 'none'}${s.reason ? ` (${s.reason})` : ''}; the census must prove a signing site locked or unlocked` });
    // AC-32 / AC-35: the unlocked set equals the list, by key and count.
    const byKey = new Map<string, Site[]>();
    for (const s of live.filter((x) => x.lock_status === 'unlocked')) byKey.set(siteKey(s), [...(byKey.get(siteKey(s)) ?? []), s]);
    const listed = new Set(ex.unlocked.map(entryKey));
    for (const e of ex.unlocked) {
        const k = entryKey(e);
        const got = byKey.get(k) ?? [];
        const lockedNow = live.filter((s) => siteKey(s) === k && s.lock_status === 'locked').length;
        if (got.length < e.count)
            problems.push({ code: 'stale-unlocked', message: `unlocked ${k} (${e.finding_id}): listed count ${e.count}, the census finds ${got.length} unlocked site(s) at this key${lockedNow ? ` and ${lockedNow} now locked` : ''}; a fixed or removed site must come off the list (lower count or remove the entry)` });
        else if (got.length > e.count)
            problems.push({ code: 'surplus-unlocked', message: `unlocked ${k} (${e.finding_id}): listed count ${e.count}, the census finds ${got.length} unlocked sites (${got.map((s) => `${s.file}:${s.line}`).join(', ')}); a new unlocked signing site must go through withNonceLock` });
    }
    for (const [k, sites] of byKey)
        if (!listed.has(k))
            for (const s of sites)
                problems.push({ code: 'surplus-unlocked', message: `${s.file}:${s.line} ${s.api} in ${s.enclosing} is an unlocked signing site not on the list (${(s.chains[0] ?? []).slice(-1)[0] ?? s.reason ?? 'no chain'}); it must go through withNonceLock` });
    // AC-33: the floor.
    if (remaining.length < ex.floor)
        problems.push({ code: 'below-floor', message: `${remaining.length} transaction-signing sites, below the floor of ${ex.floor}; if a finding's fix removed a site, lower the floor in a commit that names that finding (AC-34)` });
    return { problems, summary, sites };
}

function gateLine(s: GateSummary, problems: Problem[]): string {
    return `check-signing-census: ${s.tx_signing} transaction-signing sites (locked ${s.locked}, unlocked ${s.unlocked}, unknown ${s.unknown}, dead ${s.dead}), floor ${s.floor}; excluded ${s.excluded_by_auditor} by auditor and ${s.excluded_by_census} by census; message-signing ${s.message_signing}; files src ${s.src_files}, scripts ${s.script_files}; ${problems.length} problem(s)`;
}

// ---------------------------------------------------------------------------
// Gate self-test fixtures: a checkout-shaped project in os.tmpdir() with the real exception
// file format, real decision and finding records, and real ethers types.
// ---------------------------------------------------------------------------

const GATE_TX = `const tx = { to: '0x0000000000000000000000000000000000000001', value: 1n };`;

function lockedSitesSource(n: number): string {
    const fns: string[] = [];
    for (let i = 1; i <= n; i++)
        fns.push(`export async function locked${String(i).padStart(2, '0')}(): Promise<void> {
    await withNonceLock(wallet.address, async () => {
        await wallet.sendTransaction(tx);
    });
}`);
    return `import { Wallet } from 'ethers';
import { withNonceLock } from './utils/nonceAuthority';

declare const wallet: Wallet;
${GATE_TX}

${fns.join('\n\n')}
`;
}

const GATE_LEGACY_UNLOCKED = `import { Wallet } from 'ethers';

declare const wallet: Wallet;
${GATE_TX}

// A listed unlocked site (the fixture's AUD-FIX-001, like AUD-BUY-007's simulateSell).
export async function simulateSell(): Promise<void> {
    await wallet.sendTransaction(tx);
}
`;

const GATE_TOOL_SCRIPT = `import { Wallet, Contract } from 'ethers';

declare const wallet: Wallet;
declare function loadArtifactAbi(): any;
${GATE_TX}

// Two listed unlocked script sites (the fixture's AUD-FIX-002) and one view call whose ABI the
// census cannot read (listed under excluded, like addLiquidity's getPair).
async function main(): Promise<void> {
    await wallet.sendTransaction(tx);
    await wallet.sendTransaction(tx);
    const factory = new Contract('0x0000000000000000000000000000000000000002', loadArtifactAbi(), wallet);
    await factory.getPair('0x0000000000000000000000000000000000000003', '0x0000000000000000000000000000000000000004');
}

void main();
`;

const MANUAL_INVENTORY_REL = '.planning/audit/census/manual-inventory-head.json';

function baseGateExceptions(): Record<string, unknown> {
    return {
        floor: 23,
        unlocked: [
            { file: 'scripts/tool.ts', enclosing: 'main', call: 'signer.sendTransaction', count: 2, finding_id: 'AUD-FIX-002', decision_ref: ['OD-90'] },
            { file: 'src/legacy.ts', enclosing: 'simulateSell', call: 'signer.sendTransaction', count: 1, finding_id: 'AUD-FIX-001', decision_ref: ['ESC-FIX-01'] },
        ],
        excluded: [{ file: 'scripts/tool.ts', enclosing: 'main', call: 'contract.getPair', count: 1, reason: 'getPair is a view function', evidence_ref: MANUAL_INVENTORY_REL }],
    };
}

/** The base fixture: `locked` locked sites plus the 3 listed unlocked sites and 1 excluded view call (20 locked gives 23). */
function baseGateFiles(locked: number): Record<string, string> {
    return {
        'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'commonjs', moduleResolution: 'node', strict: true, esModuleInterop: true, skipLibCheck: true, types: [] }, include: ['src/**/*'] }, null, 2),
        [LOCK_MODULE_REL]: FIXTURE_LOCK,
        'src/locked.ts': lockedSitesSource(locked),
        'src/legacy.ts': GATE_LEGACY_UNLOCKED,
        'scripts/tool.ts': GATE_TOOL_SCRIPT,
        [EXCEPTIONS_REL]: JSON.stringify(baseGateExceptions(), null, 2),
        '.planning/audit/findings/AUD-FIX-001.json': JSON.stringify({ id: 'AUD-FIX-001' }),
        '.planning/audit/findings/AUD-FIX-002.json': JSON.stringify({ id: 'AUD-FIX-002' }),
        '.planning/audit/escalations/ESC-FIX-01.json': JSON.stringify({ id: 'ESC-FIX-01', items: ['AUD-FIX-001'], resolved_items: [] }),
        '.planning/audit/decisions/OD-90.json': JSON.stringify({ id: 'OD-90', findings: ['AUD-FIX-002'] }),
        '.planning/audit/decisions/OD-91.json': JSON.stringify({ id: 'OD-91', findings: ['AUD-OTHER-009'] }),
        [MANUAL_INVENTORY_REL]: JSON.stringify({ sites: [{ file: 'scripts/tool.ts', line: 14, api: 'contract.getPair', kind: 'tx-signing', note: 'fixture view call', exclude: { reason: 'getPair is a view function', evidence: 'fixture' } }] }),
    };
}

/** Write a fixture project (files: relative path -> text, or null to leave a path out) with node_modules/ethers as a junction to the repo's. */
function writeFixture(files: Record<string, string | null>): string {
    if (!fs.existsSync(path.join(REPO_NODE_MODULES, 'ethers', 'package.json'))) throw new UsageError(`self-test: ethers types not found under ${REPO_NODE_MODULES}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signing-census-gate-'));
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.symlinkSync(path.join(REPO_NODE_MODULES, 'ethers'), path.join(dir, 'node_modules', 'ethers'), IS_WIN ? 'junction' : 'dir');
    for (const [rel, text] of Object.entries(files)) {
        if (text === null) continue;
        const p = path.join(dir, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
    }
    return dir;
}

interface CaseOutcome {
    name: string;
    ok: boolean;
    detail: string;
}

/** Run the whole gate (exception file, census, evaluation) on a fixture root and compare the problem codes with the expected set exactly. */
function expectCodes(name: string, problems: Problem[], expected: ProblemCode[], extra?: string): CaseOutcome {
    const got = [...new Set(problems.map((p) => p.code))].sort();
    const want = [...new Set(expected)].sort();
    const ok = JSON.stringify(got) === JSON.stringify(want);
    const lines = problems.map((p) => `[${p.code}] ${p.message}`).join(' | ');
    return { name, ok, detail: ok ? `${want.length ? `fails with ${want.join(', ')}` : 'passes'}${extra ? `; ${extra}` : ''}` : `expected [${want.join(', ')}], got [${got.join(', ')}]: ${lines || 'no problems'}` };
}

function gateOnRoot(root: string): { problems: Problem[]; summary: GateSummary | null; run: GateRun | null } {
    const loaded = loadExceptions(root);
    if (!loaded.ex) return { problems: loaded.problems, summary: null, run: null };
    const run = runCensus(root);
    const ev = evaluateGate(root, run, loaded.ex);
    return { problems: [...loaded.problems, ...ev.problems], summary: ev.summary, run };
}

/**
 * Flag 7: on a checkout-shaped fixture (.git, .env, data/bot.db, data/evil.ts beside src/ and
 * scripts/), the census opens TypeScript sources and type information only. Every path given
 * to the fs read and directory-listing functions is recorded through the real fs module object
 * that ts.sys uses, and none may be .env or under data/. The recorder must also see the
 * fixture's own source files, so a recorder that saw nothing cannot pass.
 */
function caseFlag7(): CaseOutcome {
    const name = 'flag7-never-opens-env-or-data';
    const files: Record<string, string | null> = {
        ...baseGateFiles(20),
        '.git/HEAD': 'ref: refs/heads/main\n',
        '.env': 'CENSUS_SELFTEST_SENTINEL=never-read\n',
        'data/bot.db': 'SQLite format 3\u0000 fixture bytes',
        // A .ts file under data/: if the census audited it, its unlocked site would fail the gate.
        'data/evil.ts': `import { Wallet } from 'ethers';\ndeclare const wallet: Wallet;\nexport async function evil(): Promise<void> {\n    await wallet.sendTransaction({ to: '0x0000000000000000000000000000000000000009' });\n}\n`,
    };
    const dir = writeFixture(files);
    const touched: string[] = [];
    const names = ['readFileSync', 'openSync', 'readdirSync', 'opendirSync', 'createReadStream', 'readFile', 'open', 'readdir', 'opendir'] as const;
    const mod = fsModule as unknown as Record<string, unknown>;
    const saved = new Map<string, unknown>();
    for (const n of names) {
        const orig = mod[n];
        if (typeof orig !== 'function') continue;
        saved.set(n, orig);
        mod[n] = function (this: unknown, ...args: unknown[]) {
            const a = args[0];
            if (typeof a === 'string') touched.push(a);
            else if (Buffer.isBuffer(a)) touched.push(a.toString());
            else if (a instanceof URL) touched.push(a.pathname);
            return (orig as (...x: unknown[]) => unknown).apply(this, args);
        };
    }
    let outcome: CaseOutcome;
    try {
        let res: ReturnType<typeof gateOnRoot>;
        try {
            res = gateOnRoot(dir);
        } finally {
            for (const [n, f] of saved) mod[n] = f;
        }
        const protectedHits = [...new Set(touched.filter((p) => isProtectedPath(dir, p)).map((p) => posix(path.relative(dir, path.resolve(dir, p)))))];
        const sawSources = ['src/locked.ts', 'scripts/tool.ts', EXCEPTIONS_REL].every((rel) => touched.some((p) => posix(path.resolve(dir, p)).toLowerCase() === posix(path.join(dir, rel)).toLowerCase()));
        const roots = res.run ? res.run.census.rootNames : [];
        const nonTs = roots.filter((f) => !SOURCE_EXT_RE.test(f));
        const base = expectCodes(name, res.problems, [], `${touched.length} reads/listings recorded, none of .env or data/`);
        const extra: string[] = [];
        if (protectedHits.length) extra.push(`opened or listed ${protectedHits.join(', ')}`);
        if (!sawSources) extra.push('the recorder did not see the fixture sources being read, so it proves nothing');
        if (nonTs.length) extra.push(`program roots that are not JavaScript or TypeScript sources: ${nonTs.join(', ')}`);
        if (!res.run || res.summary?.tx_signing !== 23) extra.push(`expected the scan to run and count 23 sites, got ${res.summary?.tx_signing ?? 'no scan'}`);
        outcome = extra.length ? { name, ok: false, detail: `${extra.join('; ')}${base.ok ? '' : `; ${base.detail}`}` } : base;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    return outcome;
}

// ---------------------------------------------------------------------------
// AC-34: the floor drops only in a commit naming the finding that removed the site.
// Every git call is an argument array (commit messages are untrusted input and are only
// matched against a regular expression).
// ---------------------------------------------------------------------------

const SHA_RE = /^[0-9a-f]{40}$/;
const FINDING_IN_TEXT_RE = /\bAUD-[A-Z0-9]+-\d{3}\b/g;

function git(root: string, args: string[], env?: NodeJS.ProcessEnv): { status: number; stdout: string; stderr: string } {
    const r = cp.spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20, env: env ?? process.env });
    if (r.error) throw new UsageError(`git ${args[0]} could not run: ${r.error.message}`);
    return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

interface FloorHistory {
    shallow: boolean;
    commits: number;
    trail: string[];
    problems: Problem[];
}

/**
 * Walk every commit that touches the exception file (oldest first, --full-history so no side
 * branch is simplified away). A commit lowers the floor when its floor is below the floor of
 * every parent that has the file; such a commit must name, in its message, an AUD- finding ID
 * registered under .planning/audit/findings/. A commit that deletes the file or holds an
 * unreadable floor is a problem too (a delete and re-add would otherwise reset the floor).
 * A shallow clone cannot show the history, so it is reported, never passed.
 */
function floorHistory(root: string, env?: NodeJS.ProcessEnv): FloorHistory {
    const sh = git(root, ['rev-parse', '--is-shallow-repository'], env);
    if (sh.status !== 0) throw new UsageError(`not a git repository at ${root}: ${sh.stderr.trim()}`);
    if (sh.stdout.trim() === 'true') return { shallow: true, commits: 0, trail: [], problems: [] };
    const rl = git(root, ['rev-list', '--full-history', '--reverse', 'HEAD', '--', EXCEPTIONS_REL], env);
    if (rl.status !== 0) throw new UsageError(`git rev-list failed: ${rl.stderr.trim()}`);
    const shas = rl.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const s of shas) if (!SHA_RE.test(s)) throw new UsageError(`git rev-list returned ${JSON.stringify(s)}, not a commit SHA`);
    const problems: Problem[] = [];
    if (!shas.length) problems.push({ code: 'history-empty', message: `no commit touches ${EXCEPTIONS_REL}; the history check checked nothing` });
    const cache = new Map<string, number | 'absent' | 'bad'>();
    const floorAt = (rev: string): number | 'absent' | 'bad' => {
        const hit = cache.get(rev);
        if (hit !== undefined) return hit;
        let v: number | 'absent' | 'bad';
        if (git(root, ['cat-file', '-e', `${rev}:${EXCEPTIONS_REL}`], env).status !== 0) v = 'absent';
        else {
            const shown = git(root, ['show', `${rev}:${EXCEPTIONS_REL}`], env);
            let raw: unknown = null;
            try {
                raw = shown.status === 0 ? JSON.parse(shown.stdout) : null;
            } catch {
                raw = null;
            }
            v = isObj(raw) && posInt(raw.floor) ? raw.floor : 'bad';
        }
        cache.set(rev, v);
        return v;
    };
    const trail: string[] = [];
    for (const sha of shas) {
        const short = sha.slice(0, 12);
        const cur = floorAt(sha);
        if (cur === 'absent') {
            problems.push({ code: 'history-bad-version', message: `${short} deletes ${EXCEPTIONS_REL}; the floor cannot be reset by deleting the file` });
            trail.push(`${short}:deleted`);
            continue;
        }
        if (cur === 'bad') {
            problems.push({ code: 'history-bad-version', message: `${short}: ${EXCEPTIONS_REL} is not JSON with a positive integer floor` });
            trail.push(`${short}:unreadable`);
            continue;
        }
        trail.push(`${short}:${cur}`);
        const pl = git(root, ['rev-list', '--parents', '-n', '1', sha], env);
        if (pl.status !== 0) throw new UsageError(`git rev-list --parents ${short} failed: ${pl.stderr.trim()}`);
        const parents = pl.stdout.trim().split(/\s+/).slice(1).filter((p) => SHA_RE.test(p));
        const before = parents.map(floorAt).filter((v): v is number => typeof v === 'number');
        if (!before.length) continue; // the file is introduced here
        const prev = Math.min(...before);
        if (cur >= prev) continue;
        const msg = git(root, ['log', '-1', '--format=%B', sha], env).stdout;
        const ids = [...new Set(msg.match(FINDING_IN_TEXT_RE) ?? [])];
        const registered = ids.filter((id) => findingRegistered(root, id));
        if (!registered.length)
            problems.push({
                code: 'floor-lowered-unnamed',
                message: `${short} lowers the floor from ${prev} to ${cur} without naming a registered finding (${ids.length ? `its message names ${ids.join(', ')}, none registered under .planning/audit/findings/` : 'its message names no AUD- finding ID'})`,
            });
    }
    return { shallow: false, commits: shas.length, trail, problems };
}

/** The --check-floor-history mode: exit 0 pass, 1 a problem, 2 a shallow clone. `say` is console by default (the self-test captures it). */
function floorHistoryMain(root: string, env?: NodeJS.ProcessEnv, say: { log: (s: string) => void; error: (s: string) => void } = console): number {
    const h = floorHistory(root, env);
    if (h.shallow) {
        say.error(`check-signing-census --check-floor-history: ${root} is a shallow clone; the floor history needs the full history (actions/checkout fetch-depth: 0). Refusing to pass.`);
        return 2;
    }
    for (const p of h.problems) say.error(`PROBLEM [${p.code}] ${p.message}`);
    say.log(`check-signing-census --check-floor-history: ${h.commits} commit(s) touch ${EXCEPTIONS_REL}; floor ${h.trail.join(' -> ') || '(none)'}; ${h.problems.length} problem(s)`);
    return h.problems.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Gate self-test cases: one deliberate example per failure the census must catch.
// Each case runs the whole gate on its own fixture and must fail for exactly its own reason
// (the set of problem codes is compared exactly).
// ---------------------------------------------------------------------------

/** Run the gate on a fixture and remove it. */
function fixtureGate(files: Record<string, string | null>): ReturnType<typeof gateOnRoot> {
    const dir = writeFixture(files);
    try {
        return gateOnRoot(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const GATE_NEW_UNLOCKED_SRC = `import { Wallet } from 'ethers';

declare const wallet: Wallet;
${GATE_TX}

// A new signing path that skips withNonceLock (AC-32).
export async function sneakySell(): Promise<void> {
    await wallet.sendTransaction(tx);
}
`;

const GATE_NEW_UNLOCKED_SCRIPT = `import { Wallet } from 'ethers';

declare const wallet: Wallet;
${GATE_TX}

async function main(): Promise<void> {
    await wallet.sendTransaction(tx);
}

void main();
`;

// CR-08: a new script signs through ethers' own ContractRunner interface, outside any lock.
const GATE_DELEGATED_SCRIPT = `import { Wallet, JsonRpcProvider } from 'ethers';
import type { ContractRunner } from 'ethers';

declare const provider: JsonRpcProvider;
${GATE_TX}

async function main(): Promise<void> {
    const wallet = new Wallet('0x' + '11'.repeat(32), provider);
    const runner: ContractRunner = wallet;
    await runner.sendTransaction!(tx);
}

void main();
`;

// CR-09: the orchestrator's reproduction, a contract method called through a value.
const GATE_METHOD_VALUE_SCRIPT = `import { Wallet, Contract, JsonRpcProvider, MaxUint256 } from 'ethers';

declare const provider: JsonRpcProvider;
const ERC20_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];

async function main(): Promise<void> {
    const wallet = new Wallet('0x' + '11'.repeat(32), provider);
    const token = new Contract('0x0000000000000000000000000000000000000005', ERC20_ABI, wallet);
    const approve = token.approve;
    await approve('0x0000000000000000000000000000000000000006', MaxUint256);
}

void main();
`;

// WR-23: a script signs with JsonRpcSigner.sendUncheckedTransaction outside any lock.
const GATE_UNCHECKED_SCRIPT = `import { JsonRpcProvider } from 'ethers';

declare const provider: JsonRpcProvider;
${GATE_TX}

async function main(): Promise<void> {
    const signer = await provider.getSigner();
    await signer.sendUncheckedTransaction(tx);
}

void main();
`;

// WR-25: signing scripts written as plain CommonJS and as an ES module TypeScript file.
const GATE_CJS_SCRIPT = `'use strict';
const { Wallet, JsonRpcProvider } = require('ethers');

async function main() {
    const provider = new JsonRpcProvider('http://127.0.0.1:1');
    const wallet = new Wallet('0x' + '11'.repeat(32), provider);
    await wallet.sendTransaction({ to: '0x0000000000000000000000000000000000000001', value: 1n });
}

void main();
`;

const GATE_MTS_SCRIPT = `import { Wallet, JsonRpcProvider } from 'ethers';

declare const provider: JsonRpcProvider;

async function main(): Promise<void> {
    const wallet = new Wallet('0x' + '11'.repeat(32), provider);
    await wallet.sendTransaction({ to: '0x0000000000000000000000000000000000000001', value: 1n });
}

void main();
`;

// WR-24: a script declares its own withNonceLock that serializes nothing.
const GATE_FAKE_LOCK_SCRIPT = `import { Wallet } from 'ethers';

declare const wallet: Wallet;
${GATE_TX}

async function withNonceLock<T>(_walletAddress: string, op: () => Promise<T>): Promise<T> {
    return op();
}

async function main(): Promise<void> {
    await withNonceLock(wallet.address, async () => {
        await wallet.sendTransaction(tx);
    });
}

void main();
`;

const GATE_LEGACY_FIXED = `import { Wallet } from 'ethers';
import { withNonceLock } from './utils/nonceAuthority';

declare const wallet: Wallet;
${GATE_TX}

// The listed site after its fix: now inside withNonceLock.
export async function simulateSell(): Promise<void> {
    await withNonceLock(wallet.address, async () => {
        await wallet.sendTransaction(tx);
    });
}
`;

const GATE_UNKNOWN_SRC = `import { Wallet } from 'ethers';

declare const wallet: Wallet;
declare function runLater(f: () => Promise<void>): void;
${GATE_TX}

// A callback whose invocation the census cannot follow: lock status unknown (F3).
export function later(): void {
    runLater(async () => {
        await wallet.sendTransaction(tx);
    });
}
`;

// Operator ruling on WR-24 (dead code): a signing site in a function nothing can reach may be
// listed under `dead`, citing a finding whose recommendation deletes the function. The census
// proves the function unreachable (module-level, not exported, zero references) or the entry fails.
const DEAD_FN = `async function deadApprove(): Promise<void> {
    await wallet.sendTransaction(tx);
}`;

function deadSource(opts: { exported?: boolean; exportList?: boolean; caller?: boolean } = {}): string {
    return `import { Wallet } from 'ethers';

declare const wallet: Wallet;
${GATE_TX}

// A signing function nothing calls (the fixture's AUD-FIX-003, like bot.ts maybeApproveForChain).
${opts.exported ? 'export ' : ''}${DEAD_FN}
${opts.exportList ? '\nexport { deadApprove };\n' : ''}${opts.caller ? '\nexport async function callsIt(): Promise<void> {\n    await deadApprove();\n}\n' : ''}`;
}

const DEAD_FINDING_REL = '.planning/audit/findings/AUD-FIX-003.json';

/** The base fixture plus src/dead.ts, its finding record and a dead entry (each part overridable; null leaves it out). */
function deadFiles(opts: { src?: string | null; recommendation?: string; count?: number; entry?: boolean; fn?: string } = {}): Record<string, string | null> {
    return {
        ...baseGateFiles(20),
        'src/dead.ts': opts.src === undefined ? deadSource() : opts.src,
        [DEAD_FINDING_REL]: JSON.stringify({ id: 'AUD-FIX-003', recommendation: opts.recommendation ?? 'Delete deadApprove (no caller, so no behaviour change).' }),
        [EXCEPTIONS_REL]: withExceptions((ex) => {
            if (opts.entry !== false) ex.dead = [{ file: 'src/dead.ts', function: opts.fn ?? 'deadApprove', call: 'signer.sendTransaction', count: opts.count ?? 1, finding_id: 'AUD-FIX-003', reason: 'no caller; deleted by AUD-FIX-003' }];
        }),
    };
}

function withExceptions(mutate: (ex: Record<string, unknown> & { unlocked: Record<string, unknown>[]; excluded: Record<string, unknown>[] }) => void): string {
    const ex = baseGateExceptions() as Record<string, unknown> & { unlocked: Record<string, unknown>[]; excluded: Record<string, unknown>[] };
    mutate(ex);
    return JSON.stringify(ex, null, 2);
}

function codeCase(name: string, files: Record<string, string | null>, expected: ProblemCode[], also?: (res: ReturnType<typeof gateOnRoot>) => string | null): CaseOutcome {
    const res = fixtureGate(files);
    const out = expectCodes(name, res.problems, expected);
    const extra = out.ok && also ? also(res) : null;
    return extra ? { name, ok: false, detail: extra } : out;
}

function gateCases(): CaseOutcome[] {
    const out: CaseOutcome[] = [];
    // AC-33: exactly 23 passes. The same census run is then evaluated against changed lists.
    const baseDir = writeFixture(baseGateFiles(20));
    try {
        const base = gateOnRoot(baseDir);
        out.push(
            expectCodes('AC-33-exactly-23-sites-passes', base.problems, [], `23 sites (locked ${base.summary?.locked}, unlocked ${base.summary?.unlocked}, excluded ${base.summary?.excluded_by_auditor})`),
        );
        if (base.summary?.tx_signing !== 23) out[out.length - 1] = { name: 'AC-33-exactly-23-sites-passes', ok: false, detail: `expected 23 counted sites, got ${base.summary?.tx_signing}` };
        const run = base.run;
        const listCase = (name: string, text: string, expected: ProblemCode[]): CaseOutcome => {
            const parsed = parseExceptions(JSON.parse(text), EXCEPTIONS_REL);
            const problems = [...parsed.problems, ...(parsed.ex && run ? evaluateGate(baseDir, run, parsed.ex).problems : [])];
            return expectCodes(name, problems, expected);
        };
        out.push(listCase('AC-53-missing-decision-ref-fails', withExceptions((ex) => delete ex.unlocked[1].decision_ref), ['missing-decision-ref']));
        out.push(listCase('AC-53-decision-record-not-covering-finding-fails', withExceptions((ex) => (ex.unlocked[1].decision_ref = ['OD-91'])), ['decision-does-not-cover']));
        out.push(listCase('AC-53-decision-record-not-found-fails', withExceptions((ex) => (ex.unlocked[1].decision_ref = ['ESC-NOPE-99'])), ['decision-not-found']));
        out.push(listCase('AC-53-finding-not-registered-fails', withExceptions((ex) => ((ex.unlocked[0].finding_id = 'AUD-FIX-404'), (ex.unlocked[0].decision_ref = ['OD-90']))), ['finding-not-found', 'decision-does-not-cover']));
        out.push(listCase('F3-stale-exclusion-fails', withExceptions((ex) => (ex.excluded[0].count = 2)), ['stale-excluded']));
        out.push(
            listCase(
                'T-23-22-excluding-a-signing-site-fails',
                withExceptions((ex) => {
                    const moved = ex.unlocked.splice(1, 1)[0];
                    ex.excluded.push({ file: moved.file, enclosing: moved.enclosing, call: moved.call, count: 1, reason: 'claimed to be a read', evidence_ref: MANUAL_INVENTORY_REL });
                }),
                ['excluded-state-changing', 'excluded-evidence', 'surplus-unlocked'],
            ),
        );
        out.push(listCase('exceptions-file-unsorted-fails', withExceptions((ex) => ex.unlocked.reverse()), ['bad-exceptions-file']));
        out.push(listCase('AC-35-listed-count-above-the-code-fails', withExceptions((ex) => (ex.unlocked[0].count = 3)), ['stale-unlocked']));
    } finally {
        fs.rmSync(baseDir, { recursive: true, force: true });
    }
    out.push(codeCase('AC-33-22-sites-fails', baseGateFiles(19), ['below-floor']));
    out.push(
        codeCase('AC-32-new-unlocked-site-in-src-and-scripts-fails', { ...baseGateFiles(20), 'src/newpath.ts': GATE_NEW_UNLOCKED_SRC, 'scripts/newtool.ts': GATE_NEW_UNLOCKED_SCRIPT }, ['surplus-unlocked'], (res) => {
            const named = ['src/newpath.ts', 'scripts/newtool.ts'].filter((f) => res.problems.some((p) => p.code === 'surplus-unlocked' && p.message.startsWith(`${f}:`)));
            return named.length === 2 && res.problems.length === 2 ? null : `expected one surplus problem for each of src/newpath.ts and scripts/newtool.ts, got ${res.problems.map((p) => p.message).join(' | ')}`;
        }),
    );
    out.push(codeCase('AC-35-listed-exception-removed-fails', { ...baseGateFiles(21), 'src/legacy.ts': null }, ['stale-unlocked']));
    out.push(codeCase('AC-35-listed-exception-fixed-fails', { ...baseGateFiles(20), 'src/legacy.ts': GATE_LEGACY_FIXED }, ['stale-unlocked']));
    out.push(
        codeCase(
            'AC-36-no-files-fails',
            { ...baseGateFiles(20), [LOCK_MODULE_REL]: null, 'src/locked.ts': null, 'src/legacy.ts': null, 'scripts/tool.ts': null },
            ['no-files'],
        ),
    );
    out.push(
        codeCase(
            'AC-36-no-sites-fails',
            { ...baseGateFiles(20), [LOCK_MODULE_REL]: null, 'src/locked.ts': 'export const nothingSigns = 1;\n', 'src/legacy.ts': null, 'scripts/tool.ts': 'export const nothingSignsHere = 2;\n' },
            ['no-sites'],
        ),
    );
    out.push(codeCase('CR-08-delegated-send-outside-lock-fails', { ...baseGateFiles(20), 'scripts/rescue.ts': GATE_DELEGATED_SCRIPT }, ['surplus-unlocked']));
    out.push(codeCase('CR-09-method-value-outside-lock-fails', { ...baseGateFiles(20), 'scripts/approve.ts': GATE_METHOD_VALUE_SCRIPT }, ['surplus-unlocked']));
    out.push(codeCase('WR-23-unchecked-send-outside-lock-fails', { ...baseGateFiles(20), 'scripts/unchecked.ts': GATE_UNCHECKED_SCRIPT }, ['surplus-unlocked']));
    out.push(codeCase('WR-24-local-withNonceLock-is-not-the-lock-fails', { ...baseGateFiles(20), 'scripts/fakelock.ts': GATE_FAKE_LOCK_SCRIPT }, ['surplus-unlocked']));
    out.push(codeCase('F3-unknown-lock-status-fails', { ...baseGateFiles(20), 'src/later.ts': GATE_UNKNOWN_SRC }, ['unknown-lock']));
    out.push(
        codeCase('WR-25-signing-cjs-and-mts-scripts-fail', { ...baseGateFiles(20), 'scripts/rescue.cjs': GATE_CJS_SCRIPT, 'scripts/rescue2.mts': GATE_MTS_SCRIPT }, ['surplus-unlocked'], (res) => {
            const named = ['scripts/rescue.cjs', 'scripts/rescue2.mts'].filter((f) => res.problems.some((p) => p.code === 'surplus-unlocked' && p.message.startsWith(`${f}:`)));
            return named.length === 2 ? null : `expected a surplus problem for each of scripts/rescue.cjs and scripts/rescue2.mts, got ${res.problems.map((p) => p.message).join(' | ')}`;
        }),
    );
    const narrowed = JSON.parse(baseGateFiles(20)['tsconfig.json']) as { include: string[] };
    narrowed.include = [LOCK_MODULE_REL, 'src/locked.ts', 'src/legacy.ts'];
    out.push(codeCase('file-outside-tsconfig-include-fails', { ...baseGateFiles(20), 'tsconfig.json': JSON.stringify(narrowed), 'src/hidden.ts': GATE_NEW_UNLOCKED_SRC }, ['file-not-audited']));
    out.push(
        codeCase('WR-25-js-file-outside-tsconfig-include-fails', { ...baseGateFiles(20), 'tsconfig.json': JSON.stringify(narrowed), 'src/hidden.mjs': 'export const x = 1;\n' }, ['file-not-audited'], (res) =>
            res.problems.some((p) => p.code === 'file-not-audited' && p.message.startsWith('src/hidden.mjs ')) ? null : `expected file-not-audited for src/hidden.mjs, got ${res.problems.map((p) => p.message).join(' | ')}`,
        ),
    );
    // Operator ruling on WR-24: the dead-code class.
    out.push(codeCase('WR-24-dead-site-without-an-entry-fails', deadFiles({ entry: false }), ['unknown-lock']));
    out.push(
        codeCase('WR-24-dead-entry-on-an-unreachable-function-passes', deadFiles(), [], (res) =>
            res.summary?.dead === 1 && res.summary.tx_signing === 24 && res.summary.unknown === 0 ? null : `expected 24 sites with 1 dead (counted toward the floor) and none unknown, got ${JSON.stringify(res.summary)}`,
        ),
    );
    out.push(codeCase('WR-24-dead-entry-on-an-exported-function-fails', deadFiles({ src: deadSource({ exported: true }) }), ['dead-reachable', 'surplus-unlocked']));
    out.push(codeCase('WR-24-dead-entry-on-a-function-in-an-export-list-fails', deadFiles({ src: deadSource({ exportList: true }) }), ['dead-reachable', 'unknown-lock']));
    out.push(codeCase('WR-24-dead-entry-on-a-function-with-a-caller-fails', deadFiles({ src: deadSource({ caller: true }) }), ['dead-reachable', 'surplus-unlocked']));
    out.push(codeCase('WR-24-dead-entry-whose-function-was-removed-fails', deadFiles({ src: null }), ['stale-dead']));
    out.push(codeCase('WR-24-dead-entry-assigned-to-module-exports-fails', deadFiles({ src: `${deadSource()}
declare const module: { exports: Record<string, unknown> };
module.exports.deadApprove = deadApprove;
` }), ['dead-reachable', 'unknown-lock']));
    out.push(codeCase('WR-24-dead-entry-whose-count-differs-fails', deadFiles({ count: 2 }), ['dead-count', 'unknown-lock']));
    out.push(codeCase('WR-24-dead-entry-whose-finding-does-not-name-the-function-fails', deadFiles({ recommendation: 'Delete simulateSell and its import (no caller).' }), ['dead-finding-does-not-name', 'unknown-lock']));
    out.push(
        codeCase(
            'WR-24-dead-entry-on-a-class-method-is-unprovable-and-fails',
            deadFiles({ src: `import { Wallet } from 'ethers';

declare const wallet: Wallet;
${GATE_TX}

class Holder {
    async deadApprove(): Promise<void> {
        await wallet.sendTransaction(tx);
    }
}
void Holder;
`, fn: 'Holder.deadApprove', recommendation: 'Delete Holder.deadApprove (no caller).' }),
            ['dead-unprovable', 'unknown-lock'],
        ),
    );
    out.push(caseFlag7());
    return out;
}

/** A throwaway git repo whose commits set the exception file's floor in order; git runs with no system or global config. */
function historyRepo(steps: { floor: number | null; message: string }[]): { dir: string; env: NodeJS.ProcessEnv; cleanup: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signing-census-history-'));
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signing-census-gitcfg-'));
    const cfg = path.join(cfgDir, 'empty.gitconfig');
    fs.writeFileSync(cfg, '');
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: cfg, GIT_TERMINAL_PROMPT: '0' };
    const cleanup = () => {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(cfgDir, { recursive: true, force: true });
    };
    const must = (args: string[]) => {
        const r = git(dir, args, env);
        if (r.status !== 0) throw new Error(`self-test git ${args.join(' ')} failed: ${r.stderr.trim()}`);
    };
    must(['-c', 'init.defaultBranch=main', 'init', '-q']);
    fs.mkdirSync(path.join(dir, '.planning', 'audit', 'findings'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.planning', 'audit', 'findings', 'AUD-FIX-001.json'), JSON.stringify({ id: 'AUD-FIX-001' }));
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    for (const s of steps) {
        const p = path.join(dir, EXCEPTIONS_REL);
        if (s.floor === null) must(['rm', '-q', '--', EXCEPTIONS_REL]);
        else {
            fs.writeFileSync(p, JSON.stringify({ floor: s.floor, unlocked: [], excluded: [] }, null, 2));
            must(['add', '--', EXCEPTIONS_REL]);
        }
        must(['-c', 'user.name=census-selftest', '-c', 'user.email=census-selftest@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', s.message]);
    }
    return { dir, env, cleanup };
}

function historyCase(name: string, steps: { floor: number | null; message: string }[], expected: ProblemCode[], check?: (h: FloorHistory) => string | null): CaseOutcome {
    const repo = historyRepo(steps);
    try {
        const h = floorHistory(repo.dir, repo.env);
        if (h.shallow) return { name, ok: false, detail: 'the throwaway repo reads as shallow' };
        const out = expectCodes(name, h.problems, expected, `floor ${h.trail.map((t) => t.split(':')[1]).join(' -> ')}`);
        const extra = out.ok && check ? check(h) : null;
        return extra ? { name, ok: false, detail: extra } : out;
    } finally {
        repo.cleanup();
    }
}

function historyCases(): CaseOutcome[] {
    const out: CaseOutcome[] = [];
    const named = [
        { floor: 23, message: 'feat: census exceptions, floor 23' },
        { floor: 24, message: 'feat: a new locked signing site raises the floor' },
        { floor: 23, message: 'fix: remove the dead approve (AUD-FIX-001)' },
    ];
    out.push(historyCase('AC-34-floor-drop-naming-its-finding-passes', named, [], (h) => (h.commits === 3 ? null : `expected 3 commits, got ${h.commits}`)));
    out.push(
        historyCase('AC-34-floor-drop-without-a-finding-fails', [...named, { floor: 22, message: 'chore: tidy the census list' }], ['floor-lowered-unnamed'], (h) =>
            h.problems.length === 1 && /from 23 to 22/.test(h.problems[0].message) ? null : `expected one problem for the 23 -> 22 commit, got ${h.problems.map((p) => p.message).join(' | ')}`,
        ),
    );
    out.push(historyCase('AC-34-floor-drop-naming-an-unregistered-finding-fails', [...named, { floor: 22, message: 'fix: removed per AUD-NOPE-999' }], ['floor-lowered-unnamed']));
    out.push(historyCase('AC-34-deleting-the-exceptions-file-fails', [...named, { floor: null, message: 'chore: drop the list (AUD-FIX-001)' }], ['history-bad-version']));
    // A shallow clone cannot show the history: the check must refuse, not pass.
    const repo = historyRepo(named);
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'signing-census-shallow-'));
    try {
        const url = IS_WIN ? `file:///${posix(repo.dir)}` : `file://${repo.dir}`;
        const r = cp.spawnSync('git', ['clone', '-q', '--depth', '1', '--', url, path.join(clone, 'c')], { encoding: 'utf8', windowsHide: true, env: repo.env });
        if (r.status !== 0) out.push({ name: 'AC-34-shallow-clone-refused', ok: false, detail: `git clone --depth 1 failed: ${r.stderr.trim()}` });
        else {
            const said: string[] = [];
            const code = floorHistoryMain(path.join(clone, 'c'), repo.env, { log: (s) => said.push(s), error: (s) => said.push(s) });
            const ok = code === 2 && said.some((s) => /is a shallow clone/.test(s));
            out.push({ name: 'AC-34-shallow-clone-refused', ok, detail: ok ? 'the --check-floor-history mode exits 2 on a --depth 1 clone' : `expected exit 2 with a shallow-clone message, got exit ${code}: ${said.join(' | ')}` });
        }
    } finally {
        fs.rmSync(clone, { recursive: true, force: true });
        repo.cleanup();
    }
    return out;
}

function gateSelfTestCases(): CaseOutcome[] {
    return [...gateCases(), ...historyCases()];
}

function selfTest(): number {
    const analysis = analysisSelfTest();
    const gate = gateSelfTestCases();
    for (const c of gate) (c.ok ? console.log : console.error)(`${c.ok ? 'ok  ' : 'FAIL'} gate:${c.name}: ${c.detail}`);
    const gateFailed = gate.filter((c) => !c.ok).length;
    const total = analysis.total + gate.length;
    const failed = analysis.failed + gateFailed;
    console.log(failed ? `SELF-TEST FAIL ${failed} of ${total} cases` : `SELF-TEST PASS ${total} of ${total} cases (${analysis.total} census analysis + ${gate.length} gate)`);
    return failed ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Self-test: a seeded fixture project in os.tmpdir()
// ---------------------------------------------------------------------------

const FIXTURE_LOCK = `export async function withNonceLock<T>(walletAddress: string, op: () => Promise<T>): Promise<T> {
    return op();
}
`;

const FIXTURE_CASES = `import { Wallet, ContractFactory, Contract, JsonRpcProvider, JsonRpcSigner } from 'ethers';
import type { ContractRunner, TransactionRequest, ContractTransactionResponse } from 'ethers';
import { withNonceLock } from './utils/nonceAuthority';

declare const wallet: Wallet;
declare const provider: JsonRpcProvider;
declare function runLater(f: () => Promise<void>): void;
const tx = { to: '0x0000000000000000000000000000000000000001', value: 1n };
const ABI = ['function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)'];

export async function caseLockedDirect(): Promise<void> {
    await withNonceLock(wallet.address, async () => {
        await wallet.sendTransaction(tx); // CASE:locked-direct
    });
}

export async function caseUnlocked(): Promise<void> {
    await wallet.sendTransaction(tx); // CASE:unlocked
}

export async function caseDeploy(): Promise<void> {
    await new ContractFactory([], '0x00', wallet).deploy(); // CASE:deploy
}

export async function caseContractSend(): Promise<void> {
    const c = new Contract('0x0000000000000000000000000000000000000002', ABI, wallet);
    await withNonceLock(wallet.address, async () => {
        await c.transfer.send('0x0000000000000000000000000000000000000003', 1n); // CASE:contract-send
    });
}

export async function caseAlias(): Promise<void> {
    const w = wallet;
    await w.sendTransaction(tx); // CASE:alias
}

export async function caseAny(x: any): Promise<void> {
    await x.sendTransaction(tx); // CASE:any
}

export async function caseMessage(): Promise<string> {
    return wallet.signMessage('hello'); // CASE:message
}

async function inner(): Promise<void> {
    await wallet.sendTransaction(tx); // CASE:transitive
}
async function middle(): Promise<void> {
    await inner();
}
export async function caseTransitive(): Promise<void> {
    await withNonceLock(wallet.address, () => middle());
}

export function caseCallback(): void {
    runLater(async () => {
        await wallet.sendTransaction(tx); // CASE:callback
    });
}

// Extra cases (beyond the nine the plan names).
export async function caseView(): Promise<void> {
    const c = new Contract('0x0000000000000000000000000000000000000002', ABI, wallet);
    await c.balanceOf(wallet.address); // CASE:view
}

export async function caseProviderRunner(): Promise<void> {
    const c = new Contract('0x0000000000000000000000000000000000000002', ABI, provider);
    await c.transfer('0x0000000000000000000000000000000000000003', 1n); // CASE:provider-runner
}

export async function caseNotAwaited(): Promise<void> {
    await withNonceLock(wallet.address, async () => {
        void wallet.sendTransaction(tx); // CASE:not-awaited
    });
}

async function withRetry(f: () => Promise<void>): Promise<void> {
    for (let i = 0; i < 2; i++) await f();
}
export async function caseHigherOrder(): Promise<void> {
    await withNonceLock(wallet.address, () =>
        withRetry(async () => {
            await wallet.sendTransaction(tx); // CASE:higher-order
        }),
    );
}

interface Strategy {
    send(): Promise<void>;
}
class Impl implements Strategy {
    async send(): Promise<void> {
        await wallet.sendTransaction(tx); // CASE:interface
    }
}
export async function caseInterface(s: Strategy): Promise<void> {
    await withNonceLock(wallet.address, () => s.send());
}
export const implInstance: Strategy = new Impl();

async function approveVia(token: Contract): Promise<void> {
    await token.transfer('0x0000000000000000000000000000000000000003', 1n); // CASE:param-runner
}
export async function caseParamRunner(): Promise<void> {
    const t = new Contract('0x0000000000000000000000000000000000000002', ABI, wallet);
    await withNonceLock(wallet.address, () => approveVia(t));
}

async function recursive(n: number): Promise<void> {
    if (n > 0) await recursive(n - 1);
    await wallet.sendTransaction(tx); // CASE:recursion
}
export async function caseRecursion(): Promise<void> {
    await withNonceLock(wallet.address, () => recursive(2));
}

async function mixed(): Promise<void> {
    await wallet.sendTransaction(tx); // CASE:mixed
}
export async function caseMixedLocked(): Promise<void> {
    await withNonceLock(wallet.address, () => mixed());
}
export async function caseMixedUnlocked(): Promise<void> {
    await mixed();
}

function fireAndForget(f: () => Promise<void>): void {
    void f();
}
export async function caseFireAndForget(): Promise<void> {
    await withNonceLock(wallet.address, async () => {
        fireAndForget(async () => {
            await wallet.sendTransaction(tx); // CASE:fire-and-forget
        });
    });
}

const queue: Array<() => Promise<void>> = [];
function enqueue(f: () => Promise<void>): void {
    queue.push(f);
}
export async function caseStored(): Promise<void> {
    await withNonceLock(wallet.address, async () => {
        enqueue(async () => {
            await wallet.sendTransaction(tx); // CASE:stored
        });
    });
}

export function caseEventCallback(): void {
    provider.on('block', async () => {
        await wallet.sendTransaction(tx); // CASE:event-callback
    });
}

async function readVia(token: Contract): Promise<void> {
    await token.balanceOf(wallet.address); // CASE:param-two-sites
}
export async function caseTwoSites(): Promise<void> {
    const t = new Contract('0x0000000000000000000000000000000000000002', ABI, wallet);
    await readVia(t);
    await readVia(t);
}

export async function caseComputed(fn: string): Promise<void> {
    const ro = new Contract('0x0000000000000000000000000000000000000002', ABI, provider);
    await ro[fn](); // CASE:computed-provider
    const rw = new Contract('0x0000000000000000000000000000000000000002', ABI, wallet);
    await withNonceLock(wallet.address, async () => {
        await rw[fn](); // CASE:computed-signer
    });
}

declare const fb: { signBundle(txs: unknown[]): Promise<string[]>; sendBundle(txs: string[], block: number): Promise<unknown> };
async function rawSendBundle(signed: string[]): Promise<void> {
    await wallet.signMessage(signed.join('')); // CASE:bundle-auth
}
export async function caseBundle(): Promise<void> {
    await withNonceLock(wallet.address, async () => {
        const signed = await fb.signBundle([{ signer: wallet, transaction: tx }]); // CASE:bundle-sign
        await fb.sendBundle(signed, 1); // CASE:bundle-send
        await rawSendBundle(signed); // CASE:bundle-raw
    });
}

async function invokesLater(f: () => Promise<void>): Promise<void> {
    provider.once('block', async () => {
        await f();
    });
}
export async function caseNestedInvoke(): Promise<void> {
    await withNonceLock(wallet.address, () =>
        invokesLater(async () => {
            await wallet.sendTransaction(tx); // CASE:nested-invoke
        }),
    );
}

async function cycleP1(): Promise<void> {
    await cycleP2();
    await wallet.sendTransaction(tx); // CASE:cycle-only
}
async function cycleP2(): Promise<void> {
    await cycleP1();
}

async function memoB(): Promise<void> {
    await wallet.sendTransaction(tx); // CASE:memo-b
    await memoA();
}
async function memoA(): Promise<void> {
    await memoB();
    await wallet.sendTransaction(tx); // CASE:memo-a
}
export async function memoLocked(): Promise<void> {
    await withNonceLock(wallet.address, () => memoA());
}
export async function memoUnlocked(): Promise<void> {
    await memoB();
}

// CR-08: sendTransaction on a receiver whose type is not structurally a Signer. The
// implementation may be ethers' own Wallet (outside the program), so the call is a site.
export async function caseDelegatedRunner(runner: ContractRunner): Promise<void> {
    await runner.sendTransaction!(tx); // CASE:delegated-runner
}
export async function caseDelegatedPick(s: Pick<Wallet, 'sendTransaction'>): Promise<void> {
    await s.sendTransaction(tx); // CASE:delegated-pick
}
interface TxSender {
    sendTransaction(t: TransactionRequest): Promise<unknown>;
}
export async function caseDelegatedLocal(s: TxSender): Promise<void> {
    await s.sendTransaction(tx); // CASE:delegated-local
}
export async function caseDelegatedLocked(s: Pick<Wallet, 'sendTransaction' | 'address'>): Promise<void> {
    await withNonceLock(s.address, async () => {
        await s.sendTransaction(tx); // CASE:delegated-locked
    });
}

// CR-09: a contract method reached through a value, a getFunction value, destructuring, a
// callback or a narrow interface cast is still a call through the contract's runner.
const C9 = '0x0000000000000000000000000000000000000002';
const TO9 = '0x0000000000000000000000000000000000000003';
export async function caseMethodValueCall(): Promise<void> {
    const c = new Contract(C9, ABI, wallet);
    const transfer = c.transfer;
    await transfer(TO9, 1n); // CASE:method-value-call
}
export async function caseMethodValueSend(): Promise<void> {
    const c = new Contract(C9, ABI, wallet);
    const m = c.transfer;
    await m.send(TO9, 1n); // CASE:method-value-send
}
export async function caseGetFunctionValue(): Promise<void> {
    const c = new Contract(C9, ABI, wallet);
    const f = c.getFunction('transfer');
    await f(TO9, 1n); // CASE:getfunction-value
}
export async function caseDestructured(): Promise<void> {
    const c = new Contract(C9, ABI, wallet);
    const { transfer } = c;
    await transfer(TO9, 1n); // CASE:destructured
}
export async function caseMethodValueView(): Promise<void> {
    const c = new Contract(C9, ABI, wallet);
    const bal = c.balanceOf;
    await bal(wallet.address); // CASE:method-value-view
}
async function retry9(f: (to: string, amount: bigint) => Promise<unknown>): Promise<void> {
    await f(TO9, 1n);
}
export async function caseMethodCallback(): Promise<void> {
    const c = new Contract(C9, ABI, wallet);
    await withNonceLock(wallet.address, () => retry9(c.transfer)); // CASE:method-callback
}
export async function caseMethodCallbackProvider(): Promise<void> {
    const ro = new Contract(C9, ABI, provider);
    await retry9(ro.transfer); // CASE:method-callback-provider
}
interface IRouterNarrow {
    transfer(to: string, amount: bigint): Promise<ContractTransactionResponse>;
}
export async function caseNarrowCast(): Promise<void> {
    const r = new Contract(C9, ABI, wallet) as unknown as IRouterNarrow;
    await r.transfer(TO9, 1n); // CASE:narrow-cast
}

// WR-23: other ethers signing APIs and indirect calls.
declare const jsigner: JsonRpcSigner;
export async function caseUnchecked(): Promise<void> {
    await jsigner.sendUncheckedTransaction(tx); // CASE:unchecked
}
export async function caseAuthorize(): Promise<void> {
    await wallet.authorize({ address: TO9 }); // CASE:authorize
}
export async function caseFnCall(): Promise<void> {
    await wallet.sendTransaction.call(wallet, tx); // CASE:fn-call
}
export async function caseFnApply(): Promise<void> {
    await wallet.sendTransaction.apply(wallet, [tx]); // CASE:fn-apply
}
export async function caseFnBind(): Promise<void> {
    const send = wallet.sendTransaction.bind(wallet); // CASE:fn-bind
    await send(tx);
}
export async function caseMethodFnCall(): Promise<void> {
    const c = new Contract(C9, ABI, wallet);
    await c.transfer.call(c, TO9, 1n); // CASE:method-fn-call
}
export function caseSigningKey(digest: string): string {
    return wallet.signingKey.sign(digest).serialized; // CASE:signing-key
}
export async function caseRpcSendRaw(raw: string): Promise<void> {
    await provider.send('eth_sendRawTransaction', [raw]); // CASE:rpc-send-raw
}
export async function caseRpcSendRead(): Promise<void> {
    await provider.send('eth_blockNumber', []); // CASE:rpc-send-read
}
declare function loadArtifactAbi(): any;
export async function caseAnyArtifact(): Promise<void> {
    const c: any = new Contract(C9, loadArtifactAbi(), wallet);
    await c.someArtifactMethod(1n); // CASE:any-artifact
    await c.getAddress();
}
async function viaAny(c: any): Promise<void> {
    await c.anotherArtifactMethod(); // CASE:any-artifact-param
}
export async function caseAnyArtifactParam(): Promise<void> {
    await withNonceLock(wallet.address, () => viaAny(new Contract(C9, loadArtifactAbi(), wallet) as any));
}
`;

interface Expect {
    found: boolean;
    kind?: Kind;
    lock?: LockStatus | null;
    evidence?: 'lexical' | 'transitive' | null;
    excluded?: boolean;
    type_unresolved?: boolean;
    apiMatch?: RegExp;
    named?: boolean;
}

const EXPECT: Record<string, Expect> = {
    'locked-direct': { found: true, kind: 'tx-signing', lock: 'locked', evidence: 'lexical', named: true },
    unlocked: { found: true, kind: 'tx-signing', lock: 'unlocked', named: true },
    deploy: { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^ContractFactory\.deploy$/, named: true },
    'contract-send': { found: true, kind: 'tx-signing', lock: 'locked', evidence: 'lexical', apiMatch: /^contract\.transfer\.send$/, named: true },
    alias: { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^signer\.sendTransaction$/, named: true },
    any: { found: true, kind: 'tx-signing', lock: 'unknown', type_unresolved: true, named: true },
    message: { found: true, kind: 'message-signing', lock: null, named: true },
    transitive: { found: true, kind: 'tx-signing', lock: 'locked', evidence: 'transitive', named: true },
    callback: { found: true, kind: 'tx-signing', lock: 'unknown', named: true },
    view: { found: true, kind: 'tx-signing', excluded: true },
    'provider-runner': { found: false },
    'not-awaited': { found: true, kind: 'tx-signing', lock: 'unknown' },
    'higher-order': { found: true, kind: 'tx-signing', lock: 'locked', evidence: 'transitive' },
    interface: { found: true, kind: 'tx-signing', lock: 'locked', evidence: 'transitive' },
    'param-runner': { found: true, kind: 'tx-signing', lock: 'locked', evidence: 'transitive', apiMatch: /^contract\.transfer$/ },
    recursion: { found: true, kind: 'tx-signing', lock: 'locked', evidence: 'transitive' },
    mixed: { found: true, kind: 'tx-signing', lock: 'unlocked' },
    'fire-and-forget': { found: true, kind: 'tx-signing', lock: 'unknown' },
    stored: { found: true, kind: 'tx-signing', lock: 'unknown' },
    'event-callback': { found: true, kind: 'tx-signing', lock: 'unlocked' },
    'param-two-sites': { found: true, kind: 'tx-signing', excluded: true },
    'computed-provider': { found: false },
    'computed-signer': { found: true, kind: 'tx-signing', lock: 'unknown', type_unresolved: true },
    'bundle-auth': { found: true, kind: 'message-signing', lock: null },
    'bundle-sign': { found: true, kind: 'tx-signing', lock: 'locked', evidence: 'lexical', apiMatch: /^flashbots\.signBundle$/ },
    'bundle-send': { found: true, kind: 'tx-signing', lock: 'locked', evidence: 'lexical', apiMatch: /^flashbots\.sendBundle$/ },
    'bundle-raw': { found: true, kind: 'tx-signing', lock: 'locked', evidence: 'lexical', apiMatch: /^rawSendBundle$/ },
    'nested-invoke': { found: true, kind: 'tx-signing', lock: 'unknown' },
    'cycle-only': { found: true, kind: 'tx-signing', lock: 'unknown' },
    'memo-b': { found: true, kind: 'tx-signing', lock: 'unlocked' },
    'memo-a': { found: true, kind: 'tx-signing', lock: 'unlocked' },
    'delegated-runner': { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^delegated\.sendTransaction$/ },
    'delegated-pick': { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^delegated\.sendTransaction$/ },
    'delegated-local': { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^delegated\.sendTransaction$/ },
    'delegated-locked': { found: true, kind: 'tx-signing', lock: 'locked', evidence: 'lexical', apiMatch: /^delegated\.sendTransaction$/ },
    'method-value-call': { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^contract\.transfer$/ },
    'method-value-send': { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^contract\.transfer\.send$/ },
    'getfunction-value': { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^contract\.transfer$/ },
    destructured: { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^contract\.transfer$/ },
    'method-value-view': { found: true, kind: 'tx-signing', excluded: true },
    'method-callback': { found: true, kind: 'tx-signing', lock: 'unknown', type_unresolved: true, apiMatch: /^contract\.transfer\.value$/ },
    'method-callback-provider': { found: false },
    'narrow-cast': { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^interface\.transfer$/ },
    unchecked: { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^signer\.sendUncheckedTransaction$/ },
    authorize: { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^signer\.authorize$/ },
    'fn-call': { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^signer\.sendTransaction$/ },
    'fn-apply': { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^signer\.sendTransaction$/ },
    'fn-bind': { found: true, kind: 'tx-signing', lock: 'unknown', type_unresolved: true, apiMatch: /^signer\.sendTransaction\.value$/ },
    'method-fn-call': { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^contract\.transfer$/ },
    'signing-key': { found: true, kind: 'tx-signing', lock: 'unknown', type_unresolved: true, apiMatch: /^signingKey\.sign$/ },
    'rpc-send-raw': { found: true, kind: 'tx-signing', lock: 'unknown', type_unresolved: true, apiMatch: /^rpc\.eth_sendRawTransaction$/ },
    'rpc-send-read': { found: false },
    'any-artifact': { found: true, kind: 'tx-signing', lock: 'unlocked', apiMatch: /^contract\.someArtifactMethod$/ },
    'any-artifact-param': { found: true, kind: 'tx-signing', lock: 'locked', evidence: 'transitive', apiMatch: /^contract\.anotherArtifactMethod$/ },
};

/** The repo's node_modules (scripts/ is one level below the repo root; trap 2). */
const REPO_NODE_MODULES = path.resolve(__dirname, '..', 'node_modules');

/** The Phase 22 analysis fixtures (31 cases), unchanged apart from the node_modules depth. */
function analysisSelfTest(): { failed: number; total: number } {
    const repoNm = REPO_NODE_MODULES;
    if (!fs.existsSync(path.join(repoNm, 'ethers', 'package.json'))) throw new UsageError(`self-test: ethers types not found under ${repoNm}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signing-census-selftest-'));
    let failed = 0;
    try {
        fs.mkdirSync(path.join(dir, 'src'));
        fs.mkdirSync(path.join(dir, 'node_modules'));
        fs.symlinkSync(path.join(repoNm, 'ethers'), path.join(dir, 'node_modules', 'ethers'), process.platform === 'win32' ? 'junction' : 'dir');
        fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'commonjs', moduleResolution: 'node', strict: true, esModuleInterop: true, skipLibCheck: true, types: [] }, include: ['src/**/*'] }, null, 2));
        fs.mkdirSync(path.join(dir, path.dirname(LOCK_MODULE_REL)), { recursive: true });
        fs.writeFileSync(path.join(dir, LOCK_MODULE_REL), FIXTURE_LOCK);
        fs.writeFileSync(path.join(dir, 'src', 'cases.ts'), FIXTURE_CASES);
        const c = new Census(dir, '0'.repeat(40));
        const r = c.run();
        const lines = FIXTURE_CASES.split('\n');
        for (const [name, exp] of Object.entries(EXPECT)) {
            const ln = lines.findIndex((l) => l.includes(`// CASE:${name}`)) + 1;
            if (ln <= 0) {
                console.error(`FAIL ${name}: marker missing from the fixture`);
                failed++;
                continue;
            }
            const got = r.sites.filter((s) => s.file === 'src/cases.ts' && s.line === ln);
            const s = got[0];
            const problems: string[] = [];
            if (!exp.found) {
                if (got.length) problems.push(`expected no site, got ${got.map((g) => g.api).join(', ')}`);
            } else if (got.length !== 1) problems.push(`expected exactly one site on line ${ln}, got ${got.length}`);
            else {
                if (exp.kind && s.kind !== exp.kind) problems.push(`kind ${s.kind} != ${exp.kind}`);
                if (exp.excluded !== undefined && s.excluded !== exp.excluded) problems.push(`excluded ${s.excluded} != ${exp.excluded}`);
                if (exp.lock !== undefined && !exp.excluded && s.lock_status !== exp.lock) problems.push(`lock_status ${s.lock_status} != ${exp.lock} (${s.reason ?? ''})`);
                if (exp.evidence !== undefined && s.lock_evidence !== exp.evidence) problems.push(`lock_evidence ${s.lock_evidence} != ${exp.evidence}`);
                if (exp.type_unresolved !== undefined && s.type_unresolved !== exp.type_unresolved) problems.push(`type_unresolved ${s.type_unresolved} != ${exp.type_unresolved}`);
                if (exp.apiMatch && !exp.apiMatch.test(s.api)) problems.push(`api ${s.api} !~ ${exp.apiMatch}`);
            }
            const tag = exp.named ? 'plan case' : 'extra case';
            if (problems.length) {
                failed++;
                console.error(`FAIL ${name} (${tag}, line ${ln}): ${problems.join('; ')}`);
            } else console.log(`ok   ${name} (${tag}): ${s ? `${s.kind} ${s.excluded ? 'excluded' : s.lock_status ?? 'n/a'}${s.lock_evidence ? ' ' + s.lock_evidence : ''} ${s.api}` : 'no site'}`);
        }
        const marked = new Set(Object.keys(EXPECT).map((n) => lines.findIndex((l) => l.includes(`// CASE:${n}`)) + 1));
        const stray = r.sites.filter((s) => !marked.has(s.line));
        if (stray.length) {
            failed++;
            console.error(`FAIL stray sites on unmarked lines: ${stray.map((s) => `${s.line} ${s.api}`).join(', ')}`);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    const n = Object.keys(EXPECT).length;
    console.log(failed ? `analysis cases: ${failed} of ${n} FAILED` : `analysis cases: ${n} of ${n} passed (9 plan cases + ${n - 9} extra)`);
    return { failed, total: n };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** The repo root: scripts/ is one level below it. */
const REPO_ROOT = path.resolve(__dirname, '..');

function gateMain(root: string): number {
    const res = gateOnRoot(root);
    for (const p of res.problems) console.error(`PROBLEM [${p.code}] ${p.message}`);
    if (!res.summary) {
        console.error(`check-signing-census: ${EXCEPTIONS_REL} could not be used; ${res.problems.length} problem(s)`);
        return 1;
    }
    console.log(gateLine(res.summary, res.problems));
    return res.problems.length ? 1 : 0;
}

/** --print: the census JSON (auditor exclusions from the exception file applied) on stdout, for review. */
function printMain(root: string): number {
    const loaded = loadExceptions(root);
    const run = runCensus(root);
    const ev = loaded.ex ? evaluateGate(root, run, loaded.ex) : null;
    const { out } = assemble(run.census, ev ? { ...run.result, sites: ev.sites } : run.result, null, null);
    out.generated_by = 'scripts/check-signing-census.ts --print';
    out.audited_sha = null;
    out.audited = 'working tree (sites carry ref <file>:<line>@worktree)';
    out.gate = { exceptions_file: EXCEPTIONS_REL, summary: ev?.summary ?? null, problems: [...loaded.problems, ...(ev?.problems ?? [])] };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    console.error(ev ? gateLine(ev.summary, out.gate.problems) : `check-signing-census --print: ${EXCEPTIONS_REL} could not be used`);
    return 0;
}

function main(argv: string[]): number {
    const mode = parseGateArgs(argv);
    if (mode === 'self-test') return selfTest();
    if (mode === 'print') return printMain(REPO_ROOT);
    if (mode === 'check-floor-history') return floorHistoryMain(REPO_ROOT);
    return gateMain(REPO_ROOT);
}

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (e) {
        console.error(`check-signing-census: ${e instanceof UsageError ? '' : 'crash: '}${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        process.exitCode = 2;
    }
}

