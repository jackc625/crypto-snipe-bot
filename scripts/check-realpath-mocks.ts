// scripts/check-realpath-mocks.ts
//
// CHAR-01 / AC-02 CI gate (Phase 23 plan 23-02): the real-path tests under test/realpath/ may
// replace only the modules on the AC-02 list. Everything else runs for real; a stray mock would
// silently replace the mechanism a real-path test exists to prove (the green unit suite has
// missed money-path bugs exactly that way, 22-23 AUD-TESTU-*).
//
// The AC-02 list, compared by RESOLVED FILE PATH (so '../../src/utils/logger', an absolute path and
// an alias that reach the same file are the same module, and a different file is not):
//   - the logger                src/utils/logger
//   - the notifier              src/utils/notifier
//   - the dashboard broadcaster src/api/ws/broadcaster
//   - relay HTTP                axios (bloXroute and the safety APIs, routed by URL)
//   - the Telegram client       telegram, telegram/sessions, telegram/events
//   - the clock                 vi.useFakeTimers, which needs no module mock
// The fake chain is a transport seam (test/realpath/harness/chain.ts installSeams), not a mock.
//
// Usage:
//   node node_modules/ts-node/dist/bin.js scripts/check-realpath-mocks.ts [--root <dir>]
//   node node_modules/ts-node/dist/bin.js scripts/check-realpath-mocks.ts --self-test
//   npm run check:realpath-mocks
//
// How it decides (TypeScript AST, never a regex; text in strings and comments is ignored):
//   - Every use of the `vi` object is found by binding: names imported from 'vitest' as vi or
//     vitest (aliases included), `<namespace>.vi` on `import * as N from 'vitest'`, and also a
//     free `vi` / `vitest` identifier with no import (fail closed: Vitest globals would supply
//     one). The binding helpers are shared with scripts/check-vi-mock-paths.ts.
//   - A use must be a member access with a literal name: vi.name or vi['name']. Anything else is
//     a violation (vi-escape): assigning or destructuring vi, passing it as a value, exporting it,
//     taking a member without calling it where a call is checked. A computed member with a
//     non-literal name is a violation (vi-computed-member). Loading vitest by require() or
//     import(), or re-exporting vi from 'vitest', is a violation too, so no alias can carry the
//     vi object past this check.
//   - (a) vi.mock / vi.doMock (and vi.unmock / vi.doUnmock) must name a literal specifier that
//     resolves, from the file containing the call, to a module on the list above. A non-literal
//     specifier is a violation (non-literal); one that resolves to nothing is unresolved; any
//     other module is forbidden-mock.
//   - (b) vi.stubGlobal is always a violation (stub-global).
//   - (c) vi.spyOn is a violation (spy-on) unless its first argument is the identifier `process`,
//     not declared or imported anywhere in that file, and its second argument is the string
//     literal 'exit'. Reason for the one exception: the env matrix (CONTEXT, Claude's Discretion;
//     RESEARCH Pattern 7) evaluates src/config.ts in-process, and config validation calls
//     process.exit(1) (src/config.ts:241, :263). The spy turns that exit into a recorded outcome
//     so the worker survives. It replaces no bot code: process.exit is Node's, not the bot's.
//   - (d) vi.importMock is a violation (import-mock), and so is vi.mockObject (mock-object), which
//     builds a mocked copy of a module object.
//   - (e) any other member (useFakeTimers, advanceTimersByTimeAsync, resetModules, isFakeTimers,
//     importActual, fn, hoisted, ...) is allowed: none replaces a module the bot loads.
//   What this gate does not see: code that patches a module without the vi API (for example
//   assigning over an export). That is outside an AST mock-list check; review covers it.
//
// Scope: every .ts, .mts, .cts, .tsx, .js, .mjs and .cjs file under the root (default
// test/realpath), with no exemption inside it.
//
// Behavior:
//   - No violations                                 -> summary line, exit 0
//   - Any violation                                 -> one line per violation, then a total, exit 1
//   - Bad arguments, wrong Node, unreadable root, no
//     source file, or no use of vi found at all      -> error to stderr, exit 2
//   - --self-test: temp files written outside the repo, one PASS/FAIL line per case, exit 0 only
//     when every case passes, else 1.
//
// D-21: runs on Node 22.16.0 (ABI 127). The Phase 26 Node upgrade must update the assert below.
// Zero new npm deps: Node built-ins plus the installed typescript package.

if (process.versions.modules !== '127') {
    console.error(
        `check-realpath-mocks requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}).`,
    );
    process.exit(2);
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import {
    collectViBindings,
    literalSpecifier,
    loadResolverOptions,
    mockMethodOf,
    resolveSpecifier,
    type ResolverOptions,
    type ViBindings,
} from './check-vi-mock-paths';

export type RealpathViolationKind =
    | 'forbidden-mock'
    | 'non-literal'
    | 'unresolved'
    | 'stub-global'
    | 'spy-on'
    | 'import-mock'
    | 'mock-object'
    | 'vi-escape'
    | 'vi-computed-member'
    | 'vitest-dynamic-load'
    | 'vitest-reexport';

export interface RealpathViolation {
    file: string;
    line: number;
    kind: RealpathViolationKind;
    /** The expression as written. */
    code: string;
    detail: string;
}

export interface RealpathScan {
    violations: RealpathViolation[];
    /** Uses of the vi object examined (member accesses and escapes). */
    viUses: number;
    /** vi.mock-family calls examined. */
    mockCalls: number;
    files: number;
}

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOT = path.join(REPO_ROOT, 'test', 'realpath');
const SOURCE_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs']);
const FREE_VI_NAMES = ['vi', 'vitest'];
const VI_EXPORTS = new Set(['vi', 'vitest']);

/** The AC-02 list: label and the specifier that names it from the repo root. */
const ALLOWED_MODULES: ReadonlyArray<readonly [label: string, specifier: string]> = [
    ['logger', './src/utils/logger'],
    ['notifier', './src/utils/notifier'],
    ['broadcaster', './src/api/ws/broadcaster'],
    ['relay HTTP (axios)', 'axios'],
    ['Telegram client (telegram)', 'telegram'],
    ['Telegram client (telegram/sessions)', 'telegram/sessions'],
    ['Telegram client (telegram/events)', 'telegram/events'],
];

function canonical(file: string): string {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

interface AllowList {
    byPath: Map<string, string>;
    options: ResolverOptions;
}

/** Resolve every allowed module once, from the repo root; one that does not resolve breaks the gate. */
export function loadAllowList(): AllowList {
    const options = loadResolverOptions();
    const anchor = path.join(REPO_ROOT, '__check-realpath-mocks-anchor__.ts');
    const byPath = new Map<string, string>();
    for (const [label, specifier] of ALLOWED_MODULES) {
        const file = resolveSpecifier(specifier, anchor, options);
        if (file === undefined) throw new Error(`the allowed module ${label} (${specifier}) does not resolve from the repo root; the gate cannot run`);
        byPath.set(canonical(file), label);
    }
    return { byPath, options };
}

function scriptKindOf(file: string): ts.ScriptKind {
    switch (path.extname(file)) {
        case '.tsx':
            return ts.ScriptKind.TSX;
        case '.js':
        case '.mjs':
        case '.cjs':
            return ts.ScriptKind.JS;
        default:
            return ts.ScriptKind.TS;
    }
}

/** Is this identifier a reference to a value (not a property name, declaration name or label)? */
function isValueReference(id: ts.Identifier): boolean {
    const p = id.parent;
    if (!p) return false;
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
    if (ts.isQualifiedName(p) && p.right === id) return false;
    if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === id) return false;
    if (ts.isBindingElement(p) && p.propertyName === id) return false;
    if ((ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) && p.propertyName === id) return false;
    // `export { vi } from 'vitest'` names the other module's export, not a local value (the
    // re-export itself is checked as vitest-reexport).
    if (ts.isExportSpecifier(p) && p.parent?.parent && ts.isExportDeclaration(p.parent.parent) && p.parent.parent.moduleSpecifier !== undefined) return false;
    if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
    if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
    if (ts.isJsxAttribute(p)) return false;
    return true;
}

/** Does the file declare or import a binding named `name` anywhere (any scope)? */
function declaresName(sf: ts.SourceFile, name: string): boolean {
    let found = false;
    const visit = (n: ts.Node): void => {
        if (found) return;
        const declName = (n as { name?: ts.Node }).name;
        if (
            (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n) || ts.isImportEqualsDeclaration(n) || ts.isEnumDeclaration(n) || ts.isModuleDeclaration(n)) &&
            declName !== undefined &&
            ts.isIdentifier(declName) &&
            declName.text === name
        ) {
            found = true;
            return;
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
}

/** Climb through parentheses and type-only wrappers (as, satisfies, !, <T>): they change no value. */
function outerOf(node: ts.Node): ts.Node {
    let n = node;
    while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isSatisfiesExpression(n.parent) || ts.isNonNullExpression(n.parent) || ts.isTypeAssertionExpression(n.parent))) n = n.parent;
    return n;
}

/**
 * The member named on the vi object at `ref` (vi.name or vi['name'], also through a cast), or the
 * violation kind when `ref` is not a plain member access.
 */
export function viMemberOf(ref: ts.Expression): { member: string; access: ts.PropertyAccessExpression | ts.ElementAccessExpression } | { escape: RealpathViolationKind } {
    const node = outerOf(ref);
    const p = node.parent;
    if (p && ts.isPropertyAccessExpression(p) && p.expression === node) return { member: p.name.text, access: p };
    if (p && ts.isElementAccessExpression(p) && p.expression === node) {
        const arg = p.argumentExpression;
        if (ts.isStringLiteralLike(arg)) return { member: arg.text, access: p };
        return { escape: 'vi-computed-member' };
    }
    return { escape: 'vi-escape' };
}

/** The call whose callee is exactly `access` (vi.x(...)), if any. */
function callOf(access: ts.Expression): ts.CallExpression | undefined {
    const node = outerOf(access);
    const p = node.parent;
    return p && ts.isCallExpression(p) && p.expression === node ? p : undefined;
}

function isVitestSpecifier(node: ts.Expression | undefined): boolean {
    return node !== undefined && ts.isStringLiteralLike(node) && (node.text === 'vitest' || node.text.startsWith('vitest/'));
}

/** Check the given files against the AC-02 list. */
export function checkRealpathMocks(files: string[], allow: AllowList = loadAllowList()): RealpathScan {
    const violations: RealpathViolation[] = [];
    let viUses = 0;
    let mockCalls = 0;

    for (const file of files) {
        const containingFile = path.resolve(file);
        const sf = ts.createSourceFile(containingFile, fs.readFileSync(containingFile, 'utf8'), ts.ScriptTarget.Latest, true, scriptKindOf(containingFile));
        const imported: ViBindings = collectViBindings(sf);
        // Fail closed: a free vi/vitest (no import) is the vi object too, unless the file declares
        // that name itself (then every use of it is still checked as vi below).
        const direct = new Set<string>([...imported.direct, ...FREE_VI_NAMES]);
        const namespaces = imported.namespaces;
        const processDeclared = declaresName(sf, 'process');
        const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const add = (n: ts.Node, kind: RealpathViolationKind, detail: string): void => {
            violations.push({ file: containingFile, line: lineOf(n), kind, code: n.getText(sf).replace(/\s+/g, ' ').slice(0, 160), detail });
        };

        const checkViRef = (ref: ts.Expression): void => {
            viUses += 1;
            const m = viMemberOf(ref);
            if ('escape' in m) {
                const holder = ref.parent ?? ref;
                add(holder, m.escape, m.escape === 'vi-computed-member' ? 'a vi member named by a computed, non-literal key cannot be checked' : 'the vi object is used other than as vi.<member>: an alias, destructuring, value or export could carry it past this check');
                return;
            }
            const { member, access } = m;
            const call = callOf(access);
            const mockMethod = mockMethodOf(access, { direct, namespaces });
            if (mockMethod !== undefined || member === 'mock' || member === 'doMock' || member === 'unmock' || member === 'doUnmock') {
                if (!call) {
                    add(access, 'vi-escape', `vi.${member} is taken as a value instead of being called, so its target cannot be checked`);
                    return;
                }
                mockCalls += 1;
                const specifier = literalSpecifier(call.arguments[0]);
                if (specifier === undefined) {
                    add(call, 'non-literal', `vi.${member} needs a literal module specifier to be checked against the AC-02 list`);
                    return;
                }
                const target = resolveSpecifier(specifier, containingFile, allow.options);
                if (target === undefined) {
                    add(call, 'unresolved', `vi.${member}('${specifier}') resolves to no module from this file`);
                    return;
                }
                if (!allow.byPath.has(canonical(target))) {
                    add(call, 'forbidden-mock', `vi.${member}('${specifier}') resolves to ${path.relative(REPO_ROOT, target).split(path.sep).join('/')}, which is not on the AC-02 list (logger, notifier, broadcaster, axios, telegram, telegram/sessions, telegram/events)`);
                }
                return;
            }
            switch (member) {
                case 'stubGlobal':
                    add(access, 'stub-global', 'vi.stubGlobal replaces a global the code under test reads');
                    return;
                case 'importMock':
                    add(access, 'import-mock', 'vi.importMock loads a mocked module');
                    return;
                case 'mockObject':
                    add(access, 'mock-object', 'vi.mockObject builds a mocked copy of an object');
                    return;
                case 'spyOn': {
                    if (!call) {
                        add(access, 'vi-escape', 'vi.spyOn is taken as a value instead of being called, so its target cannot be checked');
                        return;
                    }
                    const [target, method] = call.arguments;
                    const onProcess = target !== undefined && ts.isIdentifier(target) && target.text === 'process';
                    const isExit = method !== undefined && ts.isStringLiteralLike(method) && method.text === 'exit';
                    if (!onProcess || !isExit || processDeclared || call.arguments.length !== 2) {
                        const why = !onProcess
                            ? 'its first argument is not the process global'
                            : processDeclared
                              ? 'this file declares or imports its own `process`, so the identifier may not be the Node global'
                              : !isExit
                                ? "its second argument is not the string literal 'exit'"
                                : 'it has extra arguments';
                        add(call, 'spy-on', `vi.spyOn is allowed only as vi.spyOn(process, 'exit') (the env matrix): ${why}`);
                    }
                    return;
                }
                default:
                    return;
            }
        };

        const visit = (node: ts.Node): void => {
            // Loading vitest outside an import declaration: require('vitest'), import('vitest').
            if (ts.isCallExpression(node)) {
                const callee = node.expression;
                const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
                const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
                if ((isRequire || isDynamicImport) && isVitestSpecifier(node.arguments[0])) {
                    add(node, 'vitest-dynamic-load', 'vitest loaded by require() or import(): the vi object would escape the binding check');
                }
            }
            if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && isVitestSpecifier(node.moduleReference.expression)) {
                add(node, 'vitest-dynamic-load', 'vitest loaded by import = require(): the vi object would escape the binding check');
            }
            // Re-exporting vi from vitest would hand it to another file under a name not checked.
            if (ts.isExportDeclaration(node) && isVitestSpecifier(node.moduleSpecifier as ts.Expression | undefined)) {
                const clause = node.exportClause;
                const carriesVi = clause === undefined || ts.isNamespaceExport(clause) || clause.elements.some((e) => VI_EXPORTS.has((e.propertyName ?? e.name).text));
                if (carriesVi) add(node, 'vitest-reexport', 're-exporting vi from vitest would carry it to another file under an unchecked name');
            }
            if (ts.isIdentifier(node) && isValueReference(node)) {
                if (direct.has(node.text)) {
                    checkViRef(node);
                } else if (namespaces.has(node.text)) {
                    // N.vi / N['vi'] is the vi object; N.other is fine; N itself as a value is an escape.
                    viUses += 1;
                    const m = viMemberOf(node);
                    if ('escape' in m) add(node.parent ?? node, m.escape, 'the vitest namespace is used other than as N.<member>: it could carry vi past this check');
                    else if (VI_EXPORTS.has(m.member)) checkViRef(m.access);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return { violations, viUses, mockCalls, files: files.length };
}

/** Every source file under root (sorted). */
export function collectRealpathFiles(root: string): string[] {
    const absoluteRoot = path.resolve(root);
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') continue;
                walk(full);
            } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
                found.push(full);
            }
        }
    };
    walk(absoluteRoot);
    return found.sort();
}

export interface Io {
    out: (line: string) => void;
    err: (line: string) => void;
}

const defaultIo: Io = { out: (l) => console.log(l), err: (l) => console.error(l) };

function scanRoot(root: string, io: Io): number {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`root ${root} is not a readable folder`);
    const files = collectRealpathFiles(root);
    if (files.length === 0) throw new Error(`no source files under ${root}; the scan checked nothing`);
    const result = checkRealpathMocks(files);
    if (result.viUses === 0) throw new Error(`no use of vi found under ${root}; the scan checked nothing`);
    for (const v of result.violations) {
        const rel = path.relative(REPO_ROOT, v.file).split(path.sep).join('/');
        io.out(`${rel}:${v.line} ${v.kind} ${v.code} -- ${v.detail}`);
    }
    io.out(`check-realpath-mocks: ${result.viUses} vi uses (${result.mockCalls} mock calls) checked in ${result.files} files, ${result.violations.length} violations`);
    return result.violations.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------
// Self-test: temp files outside the repo, one case each
// ---------------------------------------------------------------------------------------------

interface SelfTestCase {
    id: string;
    what: string;
    source: string;
    /** Expected violation kinds, in order; [] means the file must pass. */
    expect: RealpathViolationKind[];
}

function posix(p: string): string {
    return p.split(path.sep).join('/');
}

export function selfTestCases(): SelfTestCase[] {
    const src = (rel: string): string => posix(path.join(REPO_ROOT, 'src', rel));
    const pkg = (name: string): string => posix(path.join(REPO_ROOT, 'node_modules', name));
    const head = "import { vi } from 'vitest';\n";
    return [
        { id: 'allowed-mock-passes', what: 'mocks of the logger, the notifier, the broadcaster and axios (by resolved path) pass, and the fake clock needs no mock', source: `${head}vi.mock('${src('utils/logger')}', () => ({}));\nvi.mock('${src('utils/notifier')}');\nvi.doMock('${src('api/ws/broadcaster')}');\nvi.mock('${pkg('axios')}');\nvi.useFakeTimers();\nvi.resetModules();\n`, expect: [] },
        { id: 'mock-src-db-refused', what: 'a vi.mock of src/utils/db is refused (the AC-02 demonstration)', source: `${head}vi.mock('${src('utils/db')}', () => ({ db: {} }));\n`, expect: ['forbidden-mock'] },
        { id: 'mock-ethers-refused', what: 'a vi.mock of ethers is refused', source: `${head}vi.mock('${pkg('ethers')}');\n`, expect: ['forbidden-mock'] },
        { id: 'bare-ethers-refused', what: "a bare vi.mock('ethers') is refused too (from outside the repo it resolves to nothing)", source: `${head}vi.mock('ethers');\n`, expect: ['unresolved'] },
        { id: 'non-literal-refused', what: 'a non-literal specifier is refused', source: `${head}const p = 'axios';\nvi.mock(p);\n`, expect: ['non-literal'] },
        { id: 'stub-global-refused', what: "vi.stubGlobal is refused, also as vi['stubGlobal']", source: `${head}vi.stubGlobal('fetch', () => 1);\nvi['stubGlobal']('WebSocket', class {});\n`, expect: ['stub-global', 'stub-global'] },
        { id: 'spy-on-src-refused', what: 'vi.spyOn on an import from src/ is refused', source: `${head}import * as bot from '${src('bot')}';\nvi.spyOn(bot, 'startMultiChainBot');\n`, expect: ['spy-on'] },
        { id: 'spy-on-process-kill-refused', what: "vi.spyOn(process, 'kill') and vi.spyOn(process, name) are refused", source: `${head}const name = 'exit';\nvi.spyOn(process, 'kill');\nvi.spyOn(process, name);\n`, expect: ['spy-on', 'spy-on'] },
        { id: 'spy-on-process-exit-passes', what: "vi.spyOn(process, 'exit') passes", source: `${head}vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);\n`, expect: [] },
        { id: 'local-process-refused', what: "a local process variable makes vi.spyOn(process, 'exit') fail", source: `${head}const process = { exit(): void {} };\nvi.spyOn(process, 'exit');\n`, expect: ['spy-on'] },
        { id: 'imported-process-refused', what: "an imported process makes vi.spyOn(process, 'exit') fail", source: `${head}import process from 'node:process';\nvi.spyOn(process, 'exit');\n`, expect: ['spy-on'] },
        { id: 'import-mock-refused', what: 'vi.importMock is refused', source: `${head}void vi.importMock('${src('utils/db')}');\n`, expect: ['import-mock'] },
        { id: 'destructured-vi-refused', what: 'const { spyOn } = vi is refused', source: `${head}const { spyOn } = vi;\nspyOn(Math, 'random');\n`, expect: ['vi-escape'] },
        { id: 'aliased-vi-value-refused', what: 'const v = vi is refused', source: `${head}const v = vi;\nv.stubGlobal('fetch', () => 1);\n`, expect: ['vi-escape'] },
        { id: 'aliased-import-refused', what: "import { vi as v } from 'vitest' with v.stubGlobal is refused", source: "import { vi as v } from 'vitest';\nv.stubGlobal('fetch', () => 1);\n", expect: ['stub-global'] },
        { id: 'namespace-import-refused', what: "a namespace import (V.vi.mock of src/utils/db, V['vi'].stubGlobal) is checked the same way", source: `import * as V from 'vitest';\nV.vi.mock('${src('utils/db')}');\nV['vi'].stubGlobal('x', 1);\nV.describe('ok', () => {});\n`, expect: ['forbidden-mock', 'stub-global'] },
        { id: 'computed-member-refused', what: 'a computed member with a non-literal name is refused', source: `${head}const m = 'stubGlobal';\n(vi as any)[m]('fetch', 1);\n`, expect: ['vi-computed-member'] },
        { id: 'free-vi-refused', what: 'a free vi with no import (Vitest globals) is checked the same way', source: `vi.mock('${src('utils/db')}');\n`, expect: ['forbidden-mock'] },
        { id: 'vitest-require-refused', what: "require('vitest') and a re-export of vi are refused", source: `const t = require('vitest');\nexport { vi } from 'vitest';\nvoid t;\n`, expect: ['vitest-dynamic-load', 'vitest-reexport'] },
        { id: 'mock-member-value-refused', what: 'vi.mock taken as a value instead of called is refused', source: `${head}const m = vi.mock;\nvoid m;\n`, expect: ['vi-escape'] },
        { id: 'mock-object-refused', what: 'vi.mockObject is refused', source: `${head}import * as db from '${src('utils/db')}';\nvoid vi.mockObject(db);\n`, expect: ['mock-object'] },
    ];
}

function runSelfTest(io: Io): number {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realpath-mock-gate-'));
    const rel = path.relative(REPO_ROOT, dir);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`self-test temp folder ${dir} is inside the repo`);
    let passed = 0;
    const cases = selfTestCases();
    const total = cases.length + 1;
    try {
        const allow = loadAllowList();
        for (const c of cases) {
            const file = path.join(dir, `${c.id}.ts`);
            fs.writeFileSync(file, c.source);
            const got = checkRealpathMocks([file], allow).violations.map((v) => v.kind);
            const ok = got.length === c.expect.length && got.every((k, i) => k === c.expect[i]);
            if (ok) passed += 1;
            io.out(`${ok ? 'PASS' : 'FAIL'} (${c.id}) ${c.what}: expected [${c.expect.join(', ')}], got [${got.join(', ')}]`);
        }
        // An empty folder checks nothing, so it exits 2, never 0.
        const empty = path.join(dir, 'empty');
        fs.mkdirSync(empty);
        const quiet: Io = { out: () => {}, err: () => {} };
        const code = run(['--root', empty], quiet);
        const ok = code === 2;
        if (ok) passed += 1;
        io.out(`${ok ? 'PASS' : 'FAIL'} (empty-folder-exits-2) an empty folder exits 2: expected exit 2, got ${code}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    io.out(`SELF-TEST ${passed === total ? 'PASSED' : 'FAILED'}: ${passed}/${total} cases`);
    return passed === total ? 0 : 1;
}

/** CLI entry, in-process testable. Returns the exit code. */
export function run(argv: string[], io: Io = defaultIo): number {
    try {
        if (argv.length === 1 && argv[0] === '--self-test') return runSelfTest(io);
        if (argv.length === 0) return scanRoot(DEFAULT_ROOT, io);
        if (argv.length === 2 && argv[0] === '--root' && argv[1] !== '') return scanRoot(argv[1], io);
        throw new Error('usage: check-realpath-mocks.ts [--root <dir>] | --self-test');
    } catch (e) {
        io.err(`check-realpath-mocks: ${e instanceof Error ? e.message : String(e)}`);
        return 2;
    }
}

if (require.main === module) {
    process.exitCode = run(process.argv.slice(2));
}

// Exported for test/unit/realpathMockGate.test.ts.
export { DEFAULT_ROOT as REALPATH_ROOT, ALLOWED_MODULES };
