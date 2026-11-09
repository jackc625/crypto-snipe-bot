// .planning/audit/tools/signing-census.ts
//
// Phase 22 / Plan 22-26 Task 2 (AUDIT-03, AC-36 / E31, D-NONCE-AUTHORITY-ALL) -
// the signing-site census. Static analysis only: it builds a TypeScript program
// over a base-SHA snapshot (`git archive <sha> -- src scripts tsconfig.json ...`
// outside the repo, node_modules = one junction per top-level entry, type
// information only) and never executes, imports or loads any code it audits.
//
// What counts (review concerns L592@e2e59f6, L593@e2e59f6, L594@e2e59f6):
//   tx-signing (consumes a nonce; counted in N = total_tx_signing):
//     - sendTransaction / signTransaction on a receiver whose TYPE is a Signer
//       (structural: signTransaction + sendTransaction + getAddress +
//       signMessage, so Wallet, BaseWallet, AbstractSigner, NonceManager,
//       JsonRpcSigner and the Signer interface all match; aliases such as
//       `const w = wallet` are matched by type, not by name);
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
//   A callback passed to an in-program function G is followed only when G's
//   parameter is invoked directly in G's own body and each invocation is
//   awaited or returned; the callback then runs inside that call to G.
//
// Usage (Node 22.16.0, D-21):
//   node node_modules/ts-node/dist/bin.js .planning/audit/tools/signing-census.ts \
//     --root <snapshot dir> --sha <audit_base_sha> --out <json> [--manual <manual-inventory.json>]
//   node node_modules/ts-node/dist/bin.js .planning/audit/tools/signing-census.ts --self-test
// Exit codes: 0 pass, 1 check failure (self-test case, reconciliation, missing
// review note), 2 usage error or crash.

import { parseArgs, writeAtomic, toJson, UsageError } from './lib';
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
    manual_lock_status?: string;
    lock_disagreement?: boolean;
}

interface Delegation {
    file: string;
    line: number;
    call: string;
    receiver_type: string;
    note: string;
}

interface LockCall {
    file: string;
    line: number;
    key: string;
    enclosing: string;
}

interface CensusResult {
    sites: Site[];
    delegations: Delegation[];
    lock_calls: LockCall[];
    program: { root_files: number; src_files: number; script_files: number; files_with_ts_errors: number; unresolved_modules: string[] };
}

// ---------------------------------------------------------------------------
// Program + language service over a snapshot
// ---------------------------------------------------------------------------

const SIGN_TX = ['sendTransaction', 'signTransaction'];
const SIGN_MSG = ['signMessage', 'signTypedData'];
const BUNDLE = ['signBundle', 'sendBundle', 'sendRawBundle', 'sendPrivateTransaction'];
const BUNDLE_FNS = ['rawSendBundle', 'sendRawBundle'];
const METHOD_OPS_EXCLUDED: Record<string, string> = {
    staticCall: 'staticCall: a read-only eth_call simulation; no transaction, no nonce',
    staticCallResult: 'staticCallResult: a read-only eth_call simulation; no transaction, no nonce',
    estimateGas: 'estimateGas: gas estimation only; no transaction, no nonce',
    populateTransaction: 'populateTransaction: builds an unsigned request; the site that signs it is counted separately',
};
const ENTRY_REGISTRARS = ['on', 'once', 'addListener', 'prependListener', 'prependOnceListener', 'get', 'post', 'put', 'patch', 'delete', 'use', 'all'];
const ENTRY_FUNCTIONS = ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'nextTick'];
const MAX_DEPTH = 40;

function posix(p: string): string {
    return p.replace(/\\/g, '/');
}

function walkTs(dir: string, out: string[]): void {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules') continue;
            walkTs(p, out);
        } else if (e.isFile() && /\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(posix(p));
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
        const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, this.root);
        const scripts: string[] = [];
        walkTs(path.join(this.root, 'scripts'), scripts);
        const names = new Set<string>(parsed.fileNames.map(posix));
        for (const s of scripts) names.add(s);
        this.rootNames = [...names].sort();
        const options: ts.CompilerOptions = { ...parsed.options, noEmit: true };
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

    private has(t: ts.Type, names: string[]): boolean {
        return this.members(t).some((m) => {
            const p = this.props(m);
            return names.every((n) => p.has(n));
        });
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
        return !!sym?.getDeclarations()?.some((d) => ts.isFunctionDeclaration(d) && d.name?.text === 'withNonceLock');
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

    siteLock(site: ts.CallExpression): { status: LockStatus; evidence: 'lexical' | 'transitive' | null; chains: string[][]; reason: string | null } {
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
    originsOf(e: ts.Expression, depth = 0, seen = new Set<ts.Node>()): { runner: string; abi: ts.Expression | undefined; at: string }[] {
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

    private originsBody(x: ts.Expression, depth: number, seen: Set<ts.Node>): { runner: string; abi: ts.Expression | undefined; at: string }[] {
        if (ts.isNewExpression(x)) {
            const t = this.typeAt(x);
            if (this.isContract(t)) return [{ runner: this.runnerOf(x.arguments?.[2]), abi: x.arguments?.[1], at: this.loc(x) }];
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
            const out: { runner: string; abi: ts.Expression | undefined; at: string }[] = [];
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
        const delegations: Delegation[] = [];
        const lockCalls: LockCall[] = [];
        let errFiles = 0;
        const unresolvedModules = new Set<string>();
        for (const sf of this.auditedFiles()) {
            const diags = this.program.getSemanticDiagnostics(sf).concat(this.program.getSyntacticDiagnostics(sf));
            if (diags.length) errFiles++;
            for (const dg of diags) if (dg.code === 2307) unresolvedModules.add(`${this.rel(sf.fileName)}: ${ts.flattenDiagnosticMessageText(dg.messageText, ' ').replace(/^Cannot find module '([^']+)'.*$/, '$1')}`);
            const visit = (n: ts.Node) => {
                if (ts.isCallExpression(n)) {
                    if (this.isLockCall(n)) lockCalls.push({ file: this.rel(sf.fileName), line: this.line(n), key: this.short(n.arguments[0]?.getText() ?? '', 60), enclosing: this.fnName(this.enclosingFn(n)) });
                    const s = this.classify(n);
                    if (s && 'delegation' in s) delegations.push(s.delegation);
                    else if (s) sites.push(s);
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
            delegations,
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

    private mk(call: ts.CallExpression, api: string, kind: Kind, recvType: string, extra: Partial<Site> = {}): Site {
        const sf = call.getSourceFile();
        const lc = sf.getLineAndCharacterOfPosition(call.getStart(sf));
        const file = this.rel(sf.fileName);
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
                base.reason = `receiver type unresolved (${recvType})` + (l.status !== 'unknown' ? `; the reference chain alone reads ${l.status}` : l.reason ? `; ${l.reason}` : '');
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

    classify(call: ts.CallExpression): Site | { delegation: Delegation } | null {
        const callee = this.strip(call.expression);
        // Identifier callee: in-program bundle-send functions.
        if (ts.isIdentifier(callee)) {
            if (!BUNDLE_FNS.includes(callee.text)) return null;
            let sym = this.checker.getSymbolAtLocation(callee);
            if (sym && sym.flags & ts.SymbolFlags.Alias) sym = this.checker.getAliasedSymbol(sym);
            if (!sym?.getDeclarations()?.some((d) => ts.isFunctionDeclaration(d))) return null;
            return this.mk(call, callee.text, 'tx-signing', 'function', { runner: 'relay' });
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
            if (!cRecv || !this.isContract(this.typeAt(cRecv))) return null;
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
            if (SIGN_MSG.includes(name)) return this.mk(call, `any.${name}`, 'message-signing', this.typeText(rt), { type_unresolved: true });
            if (SIGN_TX.includes(name) || BUNDLE.includes(name) || name === 'deploy' || this.abiNames.has(name))
                return this.mk(call, `any.${name}`, 'tx-signing', this.typeText(rt), { type_unresolved: true });
            return null;
        }
        if (SIGN_TX.includes(name) || SIGN_MSG.includes(name)) {
            if (this.isSigner(rt)) return this.mk(call, `signer.${name}`, SIGN_MSG.includes(name) ? 'message-signing' : 'tx-signing', this.typeText(rt));
            if (SIGN_TX.includes(name))
                return { delegation: { file: this.rel(call.getSourceFile().fileName), line: this.line(call), call: this.short(callee.getText(), 60), receiver_type: this.typeText(rt), note: 'receiver is not a Signer: a wrapper whose implementations hold the counted signing calls' } };
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
        return null;
    }

    private contractSite(call: ts.CallExpression, recv: ts.Expression, method: string | null, op: string, rt: ts.Type): Site | null {
        const origins = this.originsOf(recv);
        const runners = new Set(origins.map((o) => o.runner));
        const canSign = runners.has('signer') || runners.has('unresolved');
        if (!canSign) return null; // provider / no runner: a call can never sign
        const runner = [...runners].sort().join('|');
        const traced = origins.map((o) => `${o.runner} @ ${o.at}`);
        const api = method === null ? `contract.computed${op === 'call' ? '' : '.' + op}` : `contract.${method}${op === 'call' ? '' : '.' + op}`;
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
            tx_signing: 'sendTransaction/signTransaction on a Signer type; ContractFactory.deploy; state-changing contract method calls and .send on a Signer-runner Contract; Flashbots signBundle/sendBundle/sendRawBundle/sendPrivateTransaction; in-program rawSendBundle/sendRawBundle; unresolved receivers (type_unresolved, lock unknown)',
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
        delegations: r.delegations,
        lock_calls: r.lock_calls,
        reconciliation,
    };
    return { out, problems };
}

// ---------------------------------------------------------------------------
// Self-test: a seeded fixture project in os.tmpdir()
// ---------------------------------------------------------------------------

const FIXTURE_LOCK = `export async function withNonceLock<T>(walletAddress: string, op: () => Promise<T>): Promise<T> {
    return op();
}
`;

const FIXTURE_CASES = `import { Wallet, ContractFactory, Contract, JsonRpcProvider } from 'ethers';
import { withNonceLock } from './lock';

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
};

function selfTest(): number {
    const repoNm = path.resolve(__dirname, '..', '..', '..', 'node_modules');
    if (!fs.existsSync(path.join(repoNm, 'ethers', 'package.json'))) {
        console.error(`self-test: ethers types not found under ${repoNm}`);
        return 2;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signing-census-selftest-'));
    let failed = 0;
    try {
        fs.mkdirSync(path.join(dir, 'src'));
        fs.mkdirSync(path.join(dir, 'node_modules'));
        fs.symlinkSync(path.join(repoNm, 'ethers'), path.join(dir, 'node_modules', 'ethers'), process.platform === 'win32' ? 'junction' : 'dir');
        fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'commonjs', moduleResolution: 'node', strict: true, esModuleInterop: true, skipLibCheck: true, types: [] }, include: ['src/**/*'] }, null, 2));
        fs.writeFileSync(path.join(dir, 'src', 'lock.ts'), FIXTURE_LOCK);
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
    console.log(failed ? `SELF-TEST FAIL ${failed} of ${n} cases` : `SELF-TEST PASS ${n} of ${n} cases (9 plan cases + ${n - 9} extra)`);
    return failed ? 1 : 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv: string[]): number {
    const { flags } = parseArgs(argv, { root: 'string', out: 'string', sha: 'string', manual: 'string', 'self-test': 'bool' });
    if (flags['self-test']) return selfTest();
    if (typeof flags.root !== 'string' || typeof flags.out !== 'string' || typeof flags.sha !== 'string') throw new UsageError('usage: signing-census.ts --root <snapshot> --sha <audit_base_sha> --out <json> [--manual <manual-inventory.json>] | --self-test');
    if (!/^[0-9a-f]{40}$/.test(flags.sha)) throw new UsageError('--sha must be a full 40-hex commit SHA');
    const root = path.resolve(flags.root);
    if (fs.existsSync(path.join(root, '.git'))) throw new UsageError('--root must be a git archive snapshot, not a checkout (it has .git)');
    for (const bad of ['.env', 'data']) if (fs.existsSync(path.join(root, bad))) throw new UsageError(`--root holds ${bad}; the census reads only a src/scripts snapshot`);
    const c = new Census(root, flags.sha);
    const r = c.run();
    let manual: any = null;
    const manualPath = typeof flags.manual === 'string' ? flags.manual : null;
    if (manualPath) manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
    const { out, problems } = assemble(c, r, manual, manualPath ? posix(path.relative(process.cwd(), path.resolve(manualPath))) : null);
    writeAtomic(path.resolve(flags.out), toJson(out));
    console.log(`signing-census: ${out.sites.length} sites: tx-signing N=${out.total_tx_signing} (locked ${out.by_lock_status.all.locked}, unlocked ${out.by_lock_status.all.unlocked}, unknown ${out.by_lock_status.all.unknown}), message-signing ${out.total_message_signing}, excluded ${out.total_excluded}, delegations ${out.delegations.length}, withNonceLock calls ${out.lock_calls.length}`);
    for (const p of problems) console.error(`PROBLEM ${p}`);
    return problems.length ? 1 : 0;
}

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (e) {
        console.error(`signing-census: ${e instanceof UsageError ? '' : 'crash: '}${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        process.exitCode = 2;
    }
}

