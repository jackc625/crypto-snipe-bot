// test/realpath/triage/fixtures/scriptsStatic.ts
// Phase 23 plan 23-13 Task 2 (AUDIT-02): the static analysis shared by AUD-SCRIPTS-001.test.ts and
// AUD-SCRIPTS-002.test.ts. Type information only, through the TypeScript compiler API: nothing here
// executes, imports or loads the code it reads, and no source text is pattern-matched.
//
// The files come from a directory walk (walkTs of <root>/scripts) passed to ts.createProgram as its
// root names; no test names a file it reads. A file's name appears only in the data the walk returns
// (the AC-37 form plan 23-19 accepts). The program's options mirror tsconfig.json (CommonJS, node
// module resolution, esModuleInterop, resolveJsonModule, strict), so imports resolve as they do for
// the scripts' own ts-node runs.
//
// AUD-SCRIPTS-001: relativeImportSpecifiers / unresolvedRelativeImports list each script's relative
// module specifiers (import and export declarations, import-equals, require() and import() calls) and
// resolve each with the compiler's own module resolution (ts.resolveModuleName with the program's
// options).
//
// AUD-SCRIPTS-002: SigningAnalysis.
//   Signing sites are identified as the census (.planning/audit/tools/signing-census.ts) identifies
//   them, with its type predicates copied here: sendTransaction / signTransaction on a Signer-typed
//   receiver; ContractFactory.deploy; a state-changing contract method call (or .send) on a Contract
//   whose runner, traced to its construction (new Contract / ContractFactory, connect, deploy,
//   attach, waitForDeployment, variable initialisers), is a Signer or cannot be resolved, with the
//   ABI fragment's mutability read from an in-program ABI literal (human-readable strings or JSON
//   fragments; an unresolvable ABI counts as state-changing, never as a read); Flashbots bundle
//   sends; and, on an any-typed receiver, a signing API name or a state-changing ABI name. View/pure
//   fragments and .staticCall / .estimateGas / .populateTransaction are not sites. Two census
//   features are not mirrored because no script needs them: the getFunction('m')(...) call form and
//   the manual-inventory auditor exclusions (so a script call on an ABI that cannot be resolved,
//   such as addLiquidity's factory.getPair, counts as a site here; it changes no script's row).
//   A script's signing points are its own sites, plus each call into a function declared in another
//   program file that may reach a site (followed through in-program calls, cycle-safe): that is how
//   deliberate-buy signs, through executeDeliberateBuy in src/bot.ts in its own process.
//   Lock lifetime, per signing point, with the type checker resolving each call to its declaration:
//     holds-lock         a call to acquireProcessLock (declared in src/utils/processLock.ts) is
//                        unconditionally reached before the point in the same function (or, for a
//                        point in a named function, before every call of that function in the same
//                        file; for a point inside an anonymous callback, before the callback in its
//                        lexical parent), with no release call between them (the module has no
//                        release function today; any later export with "release" in its name other
//                        than tryAcquireThenRelease counts as one), or inside the delegated callee
//                        before each of its own signing points.
//     status-query-only  not holds-lock, and the script calls tryAcquireThenRelease: that query
//                        takes the lock and releases it before it returns
//                        (src/utils/processLock.ts:204), so signing after it is not under the lock.
//     none               otherwise.
//   A script is holds-lock only when every signing point is. "Unconditionally reached" means no
//   if/else branch, conditional expression, loop body, switch case, catch clause or right-hand side
//   of && || ?? lies between the call and the function body; a try block counts when it has no catch
//   or its catch always leaves (throw, return, process.exit).
//   pauseRead: the same reach rule for a getPauseState.get() call (getPauseState declared in
//   src/utils/db.ts) before every signing point (in the script, or inside the delegated callee
//   before each of its own signing points). A pause read done another way (raw SQL on pause_state)
//   is not seen.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const IS_WIN = process.platform === 'win32';

function posix(p: string): string {
    return p.replace(/\\/g, '/');
}

function cmp(p: string): string {
    const s = posix(p);
    return IS_WIN ? s.toLowerCase() : s;
}

/** Every .ts file (not .d.ts) under `dir`, recursively, sorted, as posix paths. */
export function walkTs(dir: string): string[] {
    const out: string[] = [];
    const visit = (d: string): void => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) {
                if (e.name !== 'node_modules') visit(p);
            } else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(posix(p));
        }
    };
    visit(dir);
    return out.sort();
}

/** The script's name as the register writes it: the file's base name without .ts. */
export function scriptName(file: string): string {
    return path.basename(file).replace(/\.ts$/, '');
}

/** tsconfig.json's compiler options, as a fresh program needs them (noEmit; Node types only). */
export const PROGRAM_OPTIONS: ts.CompilerOptions = Object.freeze({
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    esModuleInterop: true,
    strict: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    noEmit: true,
    types: ['node'],
});

export interface ScriptsProgram {
    root: string;
    rootNames: string[];
    options: ts.CompilerOptions;
    program: ts.Program;
    checker: ts.TypeChecker;
}

/** A program whose root names are the directory walk of <root>/scripts. */
export function buildScriptsProgram(root: string, extra: ts.CompilerOptions = {}): ScriptsProgram {
    const rootNames = walkTs(path.join(root, 'scripts'));
    if (rootNames.length === 0) throw new Error(`the directory walk found no .ts file under ${posix(path.join(root, 'scripts'))}`);
    const options: ts.CompilerOptions = { ...PROGRAM_OPTIONS, ...extra };
    const program = ts.createProgram({ rootNames, options });
    return { root: posix(path.resolve(root)), rootNames, options, program, checker: program.getTypeChecker() };
}

/** The program's source file for each walked script, in walk order. */
export function scriptFiles(run: ScriptsProgram): ts.SourceFile[] {
    return run.rootNames.map((f) => {
        const sf = run.program.getSourceFile(f);
        if (!sf) throw new Error(`the program has no source file for walked script ${f}`);
        return sf;
    });
}

// ---------------------------------------------------------------------------------------------
// AUD-SCRIPTS-001: relative imports and the compiler's module resolution
// ---------------------------------------------------------------------------------------------

/** Every relative module specifier in the file (import/export declarations, import =, require(), import()). */
export function relativeImportSpecifiers(sf: ts.SourceFile): string[] {
    const out: string[] = [];
    const add = (e: ts.Expression | undefined): void => {
        if (e && ts.isStringLiteralLike(e) && e.text.startsWith('.')) out.push(e.text);
    };
    const visit = (n: ts.Node): void => {
        if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) add(n.moduleSpecifier);
        else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) add(n.moduleReference.expression);
        else if (ts.isCallExpression(n) && n.arguments.length >= 1) {
            if (n.expression.kind === ts.SyntaxKind.ImportKeyword) add(n.arguments[0]);
            else if (ts.isIdentifier(n.expression) && n.expression.text === 'require') add(n.arguments[0]);
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

export interface UnresolvedImport {
    script: string;
    specifier: string;
}

/** Each walked script's relative specifiers that the compiler's module resolution cannot resolve. */
export function unresolvedRelativeImports(run: ScriptsProgram): UnresolvedImport[] {
    const out: UnresolvedImport[] = [];
    for (const sf of scriptFiles(run)) {
        for (const spec of relativeImportSpecifiers(sf)) {
            const r = ts.resolveModuleName(spec, sf.fileName, run.options, ts.sys);
            if (!r.resolvedModule) out.push({ script: scriptName(sf.fileName), specifier: spec });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// AUD-SCRIPTS-002: signing sites, lock lifetime and the pause read
// ---------------------------------------------------------------------------------------------

export type LockClass = 'holds-lock' | 'status-query-only' | 'none';

export interface ScriptRow {
    script: string;
    lock: LockClass;
    pauseRead: boolean;
}

export interface SigningPoint {
    /** Root-relative posix path of the file the point is in. */
    file: string;
    /** The enclosing function's name, or <top level> / <anonymous>. */
    fn: string;
    /** The census api text for a site (contract.approve, signer.sendTransaction, ...), or the delegated callee's name. */
    api: string;
    kind: 'site' | 'delegated';
    call: ts.CallExpression;
    /** For a delegated point: the callee function node in another file. */
    callee?: ts.SignatureDeclaration;
}

type FnNode = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;
type Guard = (n: ts.Node) => boolean;

const SIGN_TX = ['sendTransaction', 'signTransaction'];
const BUNDLE = ['signBundle', 'sendBundle', 'sendRawBundle', 'sendPrivateTransaction'];
const BUNDLE_FNS = ['rawSendBundle', 'sendRawBundle'];
const METHOD_OPS_EXCLUDED = ['staticCall', 'staticCallResult', 'estimateGas', 'populateTransaction'];
const PROCESS_LOCK_FILE = 'src/utils/processLock.ts';
const DB_FILE = 'src/utils/db.ts';
const MAX_DEPTH = 40;

function isFnLike(n: ts.Node): n is FnNode {
    return ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
}

/** The census' human-readable ABI fragment parser (name and mutability). */
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

export class SigningAnalysis {
    readonly run: ScriptsProgram;
    private readonly checker: ts.TypeChecker;
    private readonly abiNames = new Set<string>();
    private readonly reach = new Map<ts.Node, boolean>();
    private readonly reachInProgress = new Set<ts.Node>();

    constructor(run: ScriptsProgram) {
        this.run = run;
        this.checker = run.checker;
        for (const sf of this.programFiles()) this.collectAbiNames(sf);
    }

    rel(file: string): string {
        const f = posix(file);
        const r = this.run.root + '/';
        return cmp(f).startsWith(cmp(r)) ? f.slice(r.length) : f;
    }

    /** The program's own (non-declaration) files under src/ and scripts/. */
    programFiles(): ts.SourceFile[] {
        return this.run.program.getSourceFiles().filter((sf) => {
            if (sf.isDeclarationFile) return false;
            const r = this.rel(sf.fileName);
            return (r.startsWith('src/') || r.startsWith('scripts/')) && !r.includes('node_modules/');
        });
    }

    // ------------------------------------------------------------ types (copied from the census)

    private props(t: ts.Type): Set<string> {
        const s = new Set<string>();
        for (const p of this.checker.getPropertiesOfType(this.checker.getApparentType(t))) s.add(p.getName());
        return s;
    }

    private members(t: ts.Type): ts.Type[] {
        const nn = this.checker.getNonNullableType(t);
        return nn.isUnion() ? nn.types : [nn];
    }

    private isAnyish(t: ts.Type): boolean {
        return (this.checker.getNonNullableType(t).flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
    }

    private has(t: ts.Type, names: string[]): boolean {
        return this.members(t).some((m) => {
            const p = this.props(m);
            return names.every((n) => p.has(n));
        });
    }

    private isSigner(t: ts.Type): boolean {
        return this.has(t, ['signTransaction', 'sendTransaction', 'getAddress', 'signMessage']);
    }
    private isProvider(t: ts.Type): boolean {
        return !this.isSigner(t) && this.has(t, ['getBlockNumber', 'getBalance', 'call']);
    }
    private isFactory(t: ts.Type): boolean {
        return this.has(t, ['deploy', 'getDeployTransaction', 'attach', 'bytecode']);
    }
    private isContract(t: ts.Type): boolean {
        return this.has(t, ['interface', 'target', 'runner', 'getFunction', 'waitForDeployment']);
    }
    private isMethod(t: ts.Type): boolean {
        return this.has(t, ['staticCall', 'send', 'estimateGas', 'populateTransaction']);
    }
    private isBundler(t: ts.Type): boolean {
        return this.has(t, ['signBundle', 'sendBundle']);
    }

    private typeAt(e: ts.Node): ts.Type {
        return this.checker.getTypeAtLocation(e);
    }

    /** True when `name` on a contract-typed receiver is a BaseContract member (getAddress, connect, ...), not an ABI method. */
    private isOwnContractMember(recv: ts.Type, name: string): boolean {
        for (const m of this.members(recv)) {
            const p = this.checker.getPropertyOfType(this.checker.getApparentType(m), name);
            if (!p) continue;
            for (const d of p.getDeclarations() ?? []) {
                const owner = d.parent;
                if (owner && (ts.isClassDeclaration(owner) || ts.isInterfaceDeclaration(owner)) && owner.name && /^(BaseContract|Contract)$/.test(owner.name.text)) return true;
                if (posix(d.getSourceFile().fileName).includes('/ethers/') && !ts.isIndexSignatureDeclaration(d)) return true;
            }
        }
        return false;
    }

    private strip(e: ts.Expression): ts.Expression {
        let c = e;
        for (;;) {
            if (ts.isParenthesizedExpression(c) || ts.isAsExpression(c) || ts.isNonNullExpression(c) || ts.isSatisfiesExpression(c) || ts.isTypeAssertionExpression(c) || ts.isAwaitExpression(c)) c = c.expression;
            else return c;
        }
    }

    private symbolOf(e: ts.Node): ts.Symbol | undefined {
        const at = ts.isPropertyAccessExpression(e) ? e.name : e;
        let sym = this.checker.getSymbolAtLocation(at);
        if (sym && sym.flags & ts.SymbolFlags.Alias) sym = this.checker.getAliasedSymbol(sym);
        return sym;
    }

    // ------------------------------------------------------------ ABI and runner traces

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
                    const get = (k: string): string | undefined => {
                        const p = v.properties.find((pp) => ts.isPropertyAssignment(pp) && pp.name.getText().replace(/['"]/g, '') === k) as ts.PropertyAssignment | undefined;
                        return p && ts.isStringLiteralLike(p.initializer) ? p.initializer.text : p && p.initializer.kind === ts.SyntaxKind.TrueKeyword ? 'true' : undefined;
                    };
                    if (get('type') === 'function' && get('name')) out.push({ name: get('name')!, mut: get('stateMutability') ?? (get('constant') === 'true' ? 'view' : 'unresolved') });
                } else return null;
            }
            return out;
        }
        if (ts.isIdentifier(x) || ts.isPropertyAccessExpression(x)) {
            const d = this.symbolOf(x)?.valueDeclaration;
            if (d && ts.isVariableDeclaration(d) && d.initializer) return this.abiOf(d.initializer, depth + 1);
            if (d && ts.isPropertyAssignment(d)) return this.abiOf(d.initializer, depth + 1);
        }
        return null;
    }

    private collectAbiNames(sf: ts.SourceFile): void {
        const visit = (n: ts.Node): void => {
            if (ts.isArrayLiteralExpression(n)) {
                const f = this.abiOf(n);
                if (f) for (const x of f) if (!['view', 'pure', 'unresolved'].includes(x.mut)) this.abiNames.add(x.name);
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);
    }

    private runnerOf(e: ts.Expression | undefined): string {
        if (!e) return 'none';
        const x = this.strip(e);
        if (x.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(x) && x.text === 'undefined')) return 'none';
        const t = this.typeAt(x);
        if (this.isAnyish(t)) return 'unresolved';
        if (this.isSigner(t)) return 'signer';
        if (this.isProvider(t)) return 'provider';
        return 'unresolved';
    }

    private originsOf(e: ts.Expression, depth = 0, seen = new Set<ts.Node>()): { runner: string; abi: ts.Expression | undefined }[] {
        const x = this.strip(e);
        if (depth > 8 || seen.has(x)) return [{ runner: 'unresolved', abi: undefined }];
        seen.add(x);
        try {
            if (ts.isNewExpression(x)) {
                const t = this.typeAt(x);
                if (this.isContract(t)) return [{ runner: this.runnerOf(x.arguments?.[2]), abi: x.arguments?.[1] }];
                if (this.isFactory(t)) return [{ runner: this.runnerOf(x.arguments?.[2]), abi: x.arguments?.[0] }];
            }
            if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
                const name = x.expression.name.text;
                const recv = x.expression.expression;
                const rt = this.typeAt(recv);
                if (name === 'connect' && (this.isContract(rt) || this.isFactory(rt))) return this.originsOf(recv, depth + 1, seen).map((o) => ({ ...o, runner: this.runnerOf(x.arguments[0]) }));
                if ((name === 'attach' || name === 'deploy' || name === 'waitForDeployment') && (this.isContract(rt) || this.isFactory(rt))) return this.originsOf(recv, depth + 1, seen);
            }
            if (ts.isIdentifier(x) || ts.isPropertyAccessExpression(x)) {
                const out: { runner: string; abi: ts.Expression | undefined }[] = [];
                for (const d of this.symbolOf(x)?.getDeclarations() ?? []) {
                    if ((ts.isVariableDeclaration(d) || ts.isPropertyDeclaration(d) || ts.isPropertyAssignment(d)) && d.initializer) out.push(...this.originsOf(d.initializer, depth + 1, seen));
                    else out.push({ runner: 'unresolved', abi: undefined });
                }
                if (out.length) return out;
            }
            return [{ runner: 'unresolved', abi: undefined }];
        } finally {
            seen.delete(x);
        }
    }

    private mutabilityOf(origins: { abi: ts.Expression | undefined }[], method: string): string {
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

    private contractSite(recv: ts.Expression, method: string, op: string): string | null {
        const origins = this.originsOf(recv);
        const runners = new Set(origins.map((o) => o.runner));
        if (!runners.has('signer') && !runners.has('unresolved')) return null; // a provider runner can never sign
        if (METHOD_OPS_EXCLUDED.includes(op)) return null;
        if (this.mutabilityOf(origins, method) === 'view') return null;
        return `contract.${method}${op === 'call' ? '' : '.' + op}`;
    }

    /** The census api text when `call` is a transaction-signing site, else null. */
    siteOf(call: ts.CallExpression): string | null {
        const callee = call.expression;
        if (ts.isIdentifier(callee)) {
            if (!BUNDLE_FNS.includes(callee.text)) return null;
            return this.symbolOf(callee)?.getDeclarations()?.some((d) => ts.isFunctionDeclaration(d)) ? callee.text : null;
        }
        let recv: ts.Expression;
        let name: string;
        if (ts.isPropertyAccessExpression(callee)) {
            recv = callee.expression;
            name = callee.name.text;
        } else if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
            recv = callee.expression;
            name = callee.argumentExpression.text;
        } else return null;
        const rt = this.typeAt(recv);
        const anyRecv = this.isAnyish(rt);
        if (!anyRecv && this.isMethod(rt) && (name === 'send' || METHOD_OPS_EXCLUDED.includes(name))) {
            const inner = this.strip(recv);
            if (!ts.isPropertyAccessExpression(inner) || !this.isContract(this.typeAt(inner.expression))) return null;
            return this.contractSite(inner.expression, inner.name.text, name);
        }
        if (anyRecv) return SIGN_TX.includes(name) || BUNDLE.includes(name) || name === 'deploy' || this.abiNames.has(name) ? `any.${name}` : null;
        if (SIGN_TX.includes(name)) return this.isSigner(rt) ? `signer.${name}` : null;
        if (BUNDLE.includes(name) && this.isBundler(rt)) return `flashbots.${name}`;
        if (this.isFactory(rt) && name === 'deploy') return 'ContractFactory.deploy';
        if (this.isContract(rt) && !this.isOwnContractMember(rt, name)) return this.contractSite(recv, name, 'call');
        return null;
    }

    // ------------------------------------------------------------ in-program calls

    /** The in-program function a call resolves to (a declaration with a body under src/ or scripts/), or undefined. */
    calleeOf(call: ts.CallExpression): ts.SignatureDeclaration | undefined {
        const sym = this.symbolOf(this.strip(call.expression));
        for (const d of sym?.getDeclarations() ?? []) {
            let fn: ts.SignatureDeclaration | undefined;
            if ((ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d)) && d.body) fn = d;
            else if (ts.isVariableDeclaration(d) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fn = d.initializer;
            if (!fn) continue;
            const sf = fn.getSourceFile();
            if (sf.isDeclarationFile) continue;
            const r = this.rel(sf.fileName);
            if ((r.startsWith('src/') || r.startsWith('scripts/')) && !r.includes('node_modules/')) return fn;
        }
        return undefined;
    }

    /** True when the function's body (nested functions included) contains a site or calls a function that may reach one. */
    mayReachSigning(fn: ts.Node, depth = 0): boolean {
        const memo = this.reach.get(fn);
        if (memo !== undefined) return memo;
        if (this.reachInProgress.has(fn) || depth > MAX_DEPTH) return false;
        this.reachInProgress.add(fn);
        let found = false;
        const visit = (n: ts.Node): void => {
            if (found) return;
            if (ts.isCallExpression(n)) {
                if (this.siteOf(n) !== null) {
                    found = true;
                    return;
                }
                const g = this.calleeOf(n);
                if (g && g !== fn && this.mayReachSigning(g, depth + 1)) {
                    found = true;
                    return;
                }
            }
            ts.forEachChild(n, visit);
        };
        ts.forEachChild(fn, visit);
        this.reachInProgress.delete(fn);
        this.reach.set(fn, found);
        return found;
    }

    private fnName(fn: ts.Node): string {
        if (ts.isSourceFile(fn)) return '<top level>';
        if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) return fn.name.getText();
        if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text;
        return '<anonymous>';
    }

    private enclosingFn(n: ts.Node): FnNode | ts.SourceFile {
        let c = n.parent;
        while (c && !isFnLike(c) && !ts.isSourceFile(c)) c = c.parent;
        return c as FnNode | ts.SourceFile;
    }

    /**
     * Signing points inside `container` (a source file or a function, nested functions included):
     * every site, plus every call into an in-program function that may reach one. `delegateOnly`
     * limits delegated points to callees outside that file (a script's own helpers are reached
     * through their callers instead).
     */
    pointsIn(container: ts.Node, delegateOutsideFile?: string): SigningPoint[] {
        const out: SigningPoint[] = [];
        const file = this.rel(container.getSourceFile().fileName);
        const visit = (n: ts.Node): void => {
            if (ts.isCallExpression(n)) {
                const api = this.siteOf(n);
                if (api !== null) out.push({ file, fn: this.fnName(this.enclosingFn(n)), api, kind: 'site', call: n });
                else {
                    const g = this.calleeOf(n);
                    const otherFile = g ? this.rel(g.getSourceFile().fileName) !== (delegateOutsideFile ?? '') : false;
                    if (g && g !== container && (delegateOutsideFile === undefined || otherFile) && this.mayReachSigning(g)) {
                        out.push({ file, fn: this.fnName(this.enclosingFn(n)), api: this.fnName(g), kind: 'delegated', call: n, callee: g });
                    }
                }
            }
            ts.forEachChild(n, visit);
        };
        ts.forEachChild(container, visit);
        return out;
    }

    /** Signing sites in src/ files of the program (the scan's own sanity floor). */
    srcSiteCount(): number {
        let n = 0;
        for (const sf of this.programFiles()) {
            if (!this.rel(sf.fileName).startsWith('src/')) continue;
            n += this.pointsIn(sf, this.rel(sf.fileName)).filter((p) => p.kind === 'site').length;
        }
        return n;
    }

    // ------------------------------------------------------------ guards and reach-before

    private resolvesTo(e: ts.Expression, name: string, file: string): boolean {
        for (const d of this.symbolOf(this.strip(e))?.getDeclarations() ?? []) {
            const dn = (d as ts.NamedDeclaration).name;
            if (dn && ts.isIdentifier(dn) && dn.text === name && this.rel(d.getSourceFile().fileName) === file) return true;
        }
        return false;
    }

    private processLockCall(n: ts.Node, pick: (name: string) => boolean): boolean {
        if (!ts.isCallExpression(n)) return false;
        for (const d of this.symbolOf(this.strip(n.expression))?.getDeclarations() ?? []) {
            const dn = (d as ts.NamedDeclaration).name;
            if (dn && ts.isIdentifier(dn) && pick(dn.text) && this.rel(d.getSourceFile().fileName) === PROCESS_LOCK_FILE) return true;
        }
        return false;
    }

    readonly isAcquire: Guard = (n) => this.processLockCall(n, (x) => x === 'acquireProcessLock');
    readonly isTryAcquireThenRelease: Guard = (n) => this.processLockCall(n, (x) => x === 'tryAcquireThenRelease');
    private readonly isRelease: Guard = (n) => this.processLockCall(n, (x) => /release/i.test(x) && x !== 'tryAcquireThenRelease');
    readonly isPauseRead: Guard = (n) =>
        ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'get' && this.resolvesTo(n.expression.expression, 'getPauseState', DB_FILE);

    private catchAlwaysLeaves(c: ts.CatchClause): boolean {
        const last = c.block.statements[c.block.statements.length - 1];
        if (!last) return false;
        if (ts.isThrowStatement(last) || ts.isReturnStatement(last)) return true;
        if (ts.isExpressionStatement(last) && ts.isCallExpression(last.expression)) {
            const e = last.expression.expression;
            return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'process' && e.name.text === 'exit';
        }
        return false;
    }

    /** True when nothing between `g` and the body of `fn` makes reaching `g` conditional. */
    private unconditional(g: ts.Node, fn: ts.Node): boolean {
        let child: ts.Node = g;
        let parent = g.parent;
        while (parent && parent !== fn) {
            if (isFnLike(parent)) return false;
            if (ts.isIfStatement(parent) && child !== parent.expression) return false;
            if (ts.isConditionalExpression(parent) && child !== parent.condition) return false;
            if ((ts.isForStatement(parent) || ts.isForInStatement(parent) || ts.isForOfStatement(parent) || ts.isWhileStatement(parent)) && child === parent.statement) return false;
            if (ts.isCaseClause(parent) || ts.isDefaultClause(parent) || ts.isCatchClause(parent)) return false;
            if (ts.isTryStatement(parent) && child === parent.tryBlock && parent.catchClause && !this.catchAlwaysLeaves(parent.catchClause)) return false;
            if (ts.isBinaryExpression(parent) && child === parent.right) {
                const k = parent.operatorToken.kind;
                if (k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) return false;
            }
            child = parent;
            parent = parent.parent;
        }
        return parent === fn;
    }

    /** Calls in `fn` itself (not in nested functions) that satisfy `pred`. */
    private callsIn(fn: ts.Node, pred: Guard): ts.Node[] {
        const out: ts.Node[] = [];
        const visit = (n: ts.Node): void => {
            if (isFnLike(n)) return;
            if (pred(n)) out.push(n);
            ts.forEachChild(n, visit);
        };
        ts.forEachChild(fn, visit);
        return out;
    }

    private guardInFnBefore(fn: ts.Node, point: ts.Node, guard: Guard, noRelease: boolean): boolean {
        const start = point.getStart();
        for (const g of this.callsIn(fn, guard)) {
            if (g.getEnd() > start || !this.unconditional(g, fn)) continue;
            if (noRelease && this.callsIn(fn, this.isRelease).some((r) => r.getStart() >= g.getEnd() && r.getEnd() <= start)) continue;
            return true;
        }
        return false;
    }

    /** Calls of the named function `fn` in its own file. */
    private callersInFile(fn: ts.Node): ts.CallExpression[] {
        const nameNode = ts.isFunctionDeclaration(fn) ? fn.name : (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) ? fn.parent.name : undefined;
        if (!nameNode || !ts.isIdentifier(nameNode)) return [];
        const target = this.checker.getSymbolAtLocation(nameNode);
        if (!target) return [];
        const out: ts.CallExpression[] = [];
        const visit = (n: ts.Node): void => {
            if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && this.checker.getSymbolAtLocation(n.expression) === target) out.push(n);
            ts.forEachChild(n, visit);
        };
        visit(fn.getSourceFile());
        return out;
    }

    /**
     * True when a `guard` call is unconditionally reached before `point`: in its own function, else
     * (an anonymous callback) before the callback in its lexical parent, else (a named function)
     * before every call of it in the same file. `stopAt` ends the walk at a delegated callee.
     */
    reachedBefore(guard: Guard, point: ts.Node, noRelease: boolean, stopAt?: ts.Node, depth = 0): boolean {
        const fn = this.enclosingFn(point);
        if (this.guardInFnBefore(fn, point, guard, noRelease)) return true;
        if (ts.isSourceFile(fn) || fn === stopAt || depth > MAX_DEPTH) return false;
        const named = ts.isFunctionDeclaration(fn) || ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent));
        if (!named) return this.reachedBefore(guard, fn, noRelease, stopAt, depth + 1);
        if (stopAt) return false;
        const callers = this.callersInFile(fn);
        return callers.length > 0 && callers.every((c) => this.reachedBefore(guard, c, noRelease, undefined, depth + 1));
    }

    /** True when every signing point inside delegated callee `fn` is guarded (in fn, or deeper in its own callees). */
    private calleeGuarded(fn: ts.SignatureDeclaration, guard: Guard, noRelease: boolean, inProgress = new Set<ts.Node>()): boolean {
        if (inProgress.has(fn) || inProgress.size > MAX_DEPTH) return false;
        inProgress.add(fn);
        try {
            const pts = this.pointsIn(fn);
            return pts.length > 0 && pts.every((q) => this.reachedBefore(guard, q.call, noRelease, fn) || (q.callee !== undefined && this.calleeGuarded(q.callee, guard, noRelease, inProgress)));
        } finally {
            inProgress.delete(fn);
        }
    }

    private covered(p: SigningPoint, guard: Guard, noRelease: boolean): boolean {
        return this.reachedBefore(guard, p.call, noRelease) || (p.callee !== undefined && this.calleeGuarded(p.callee, guard, noRelease));
    }

    /** Each walked script's signing points (its own sites and calls into other files that may sign). */
    scriptPoints(): Map<string, SigningPoint[]> {
        const out = new Map<string, SigningPoint[]>();
        for (const sf of scriptFiles(this.run)) out.set(scriptName(sf.fileName), this.pointsIn(sf, this.rel(sf.fileName)));
        return out;
    }

    /** One row per walked script that signs, sorted by script name. */
    scriptRows(): ScriptRow[] {
        const rows: ScriptRow[] = [];
        for (const sf of scriptFiles(this.run)) {
            const points = this.pointsIn(sf, this.rel(sf.fileName));
            if (points.length === 0) continue;
            const holds = points.every((p) => this.covered(p, this.isAcquire, true));
            const queries = this.callsInWholeFile(sf, this.isTryAcquireThenRelease).length > 0;
            rows.push({
                script: scriptName(sf.fileName),
                lock: holds ? 'holds-lock' : queries ? 'status-query-only' : 'none',
                pauseRead: points.every((p) => this.covered(p, this.isPauseRead, false)),
            });
        }
        return rows.sort((a, b) => (a.script < b.script ? -1 : a.script > b.script ? 1 : 0));
    }

    private callsInWholeFile(sf: ts.SourceFile, pred: Guard): ts.Node[] {
        const out: ts.Node[] = [];
        const visit = (n: ts.Node): void => {
            if (pred(n)) out.push(n);
            ts.forEachChild(n, visit);
        };
        visit(sf);
        return out;
    }
}
