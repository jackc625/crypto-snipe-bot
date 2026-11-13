// scripts/check-vi-mock-paths.ts
//
// SAFE-06 / AC-27 CI gate: every vi.mock / vi.doMock / vi.unmock / vi.doUnmock specifier in the
// suite must name a module that really exists. A mock of a moved or misspelled path is a silent
// no-op, so the test around it keeps passing against the real module (or against nothing).
//
// Usage:
//   node node_modules/ts-node/dist/bin.js scripts/check-vi-mock-paths.ts [--root <dir>]
//   npm run check:vi-mock
//
// How it decides:
//   - The check reads the TypeScript AST (installed TypeScript 5.8.3), never a regex, so text
//     inside strings and comments is ignored.
//   - A mock call is found by binding, not by spelling: the callee's receiver must be a local
//     name bound to vitest's `vi` export (import { vi }, import { vi as v }, or
//     import * as V from 'vitest' then V.vi). Vitest exports the same object as `vitest` too.
//   - The specifier must be a literal: a string, a no-substitution template, or import('<literal>').
//     Anything else cannot be checked and fails as non-literal.
//   - Resolution uses installed resolvers, from the file that contains the call: Node built-ins,
//     ts.resolveModuleName with the repo tsconfig options and again in Bundler mode (Vite's
//     import/default exports conditions), then createRequire(file).resolve. The target must be a
//     regular file. A declaration file only counts when its runtime sibling exists, because a
//     mock of a types-only path intercepts nothing at run time.
//   - A path that differs only by letter case passes on Windows and fails on the case-sensitive
//     CI filesystem, which is where this gate has to hold.
//
// Behavior:
//   - No violations                              -> summary line, exit 0
//   - Any violation                              -> one line per violation, then a total, exit 1
//   - Bad arguments, wrong Node, unreadable root,
//     no source files or no mock call found      -> error to stderr, exit 2
//
// test/fixtures/viMockGate holds deliberately broken mocks, so the default scan excludes it
// unless --root points inside it.
//
// D-21: runs on Node 22.16.0 (ABI 127). The Phase 26 Node upgrade must update the assert below.
// Zero new npm deps: Node built-ins plus the installed typescript package.
//
// Shared helpers (Phase 23 plan 23-02): collectViBindings, isViReceiver, mockMethodOf,
// literalSpecifier, loadResolverOptions and resolveSpecifier are exported so the real-path
// mock-list gate (scripts/check-realpath-mocks.ts) finds and resolves mocks exactly as this gate
// does, and the two cannot drift apart. Importing this module runs no check: main() runs only
// when the file is executed directly (require.main === module).

if (process.versions.modules !== '127') {
    console.error(
        `check-vi-mock-paths requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}).`,
    );
    process.exit(2);
}

import * as fs from 'fs';
import * as path from 'path';
import { createRequire, isBuiltin } from 'module';
import * as ts from 'typescript';

export type ViolationKind = 'unresolved-relative' | 'unresolved-bare' | 'non-literal';

export interface Violation {
    file: string;
    line: number;
    call: string;
    specifier: string;
    kind: ViolationKind;
}

interface ScanResult {
    violations: Violation[];
    callsChecked: number;
}

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'test', 'fixtures', 'viMockGate');
const SOURCE_EXTENSIONS = new Set(['.ts', '.mts', '.cts']);
const MOCK_METHODS = new Set(['mock', 'doMock', 'unmock', 'doUnmock']);
const VI_EXPORTS = new Set(['vi', 'vitest']);
// A declaration file and the runtime file a real import of it would load.
const DECLARATION_TO_RUNTIME: ReadonlyArray<readonly [string, string]> = [
    ['.d.ts', '.js'],
    ['.d.mts', '.mjs'],
    ['.d.cts', '.cjs'],
];

export interface ResolverOptions {
    project: ts.CompilerOptions;
    bundler: ts.CompilerOptions;
}

export function loadResolverOptions(): ResolverOptions {
    const configPath = path.join(REPO_ROOT, 'tsconfig.json');
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error !== undefined) {
        throw new Error(`cannot read ${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, REPO_ROOT);
    if (parsed.errors.length > 0) {
        const detail = parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ');
        throw new Error(`invalid ${configPath}: ${detail}`);
    }
    return {
        project: parsed.options,
        bundler: { ...parsed.options, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
    };
}

function isRegularFile(candidate: string): boolean {
    try {
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}

/** A resolver hit only counts when the file exists and would actually be loaded at run time. */
function isRuntimeTarget(resolved: string): boolean {
    if (!isRegularFile(resolved)) return false;
    for (const [declaration, runtime] of DECLARATION_TO_RUNTIME) {
        if (resolved.endsWith(declaration)) {
            return isRegularFile(resolved.slice(0, -declaration.length) + runtime);
        }
    }
    return true;
}

/**
 * The file `specifier` loads from `containingFile` (absolute path as the resolver returned it), or
 * `node:<name>` for a Node built-in, or undefined when nothing real would be loaded.
 */
export function resolveSpecifier(specifier: string, containingFile: string, options: ResolverOptions): string | undefined {
    if (isBuiltin(specifier)) return specifier.startsWith('node:') ? specifier : `node:${specifier}`;
    for (const compilerOptions of [options.project, options.bundler]) {
        const found = ts.resolveModuleName(specifier, containingFile, compilerOptions, ts.sys).resolvedModule;
        if (found !== undefined && isRuntimeTarget(found.resolvedFileName)) return found.resolvedFileName;
    }
    try {
        const required = createRequire(containingFile).resolve(specifier);
        return isRuntimeTarget(required) ? required : undefined;
    } catch {
        return undefined;
    }
}

function resolves(specifier: string, containingFile: string, options: ResolverOptions): boolean {
    return resolveSpecifier(specifier, containingFile, options) !== undefined;
}

function isRelativeSpecifier(specifier: string): boolean {
    return specifier.startsWith('.') || path.isAbsolute(specifier);
}

export interface ViBindings {
    /** Local names bound directly to the vi object. */
    direct: Set<string>;
    /** Local names bound to the whole vitest namespace. */
    namespaces: Set<string>;
}

export function collectViBindings(sf: ts.SourceFile): ViBindings {
    const direct = new Set<string>();
    const namespaces = new Set<string>();
    for (const statement of sf.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
        if (statement.moduleSpecifier.text !== 'vitest') continue;
        const clause = statement.importClause;
        if (clause === undefined || clause.isTypeOnly || clause.namedBindings === undefined) continue;
        if (ts.isNamespaceImport(clause.namedBindings)) {
            namespaces.add(clause.namedBindings.name.text);
            continue;
        }
        for (const element of clause.namedBindings.elements) {
            if (!element.isTypeOnly && VI_EXPORTS.has((element.propertyName ?? element.name).text)) {
                direct.add(element.name.text);
            }
        }
    }
    return { direct, namespaces };
}

export function isViReceiver(node: ts.Expression, bindings: ViBindings): boolean {
    if (ts.isIdentifier(node)) return bindings.direct.has(node.text);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        return bindings.namespaces.has(node.expression.text) && VI_EXPORTS.has(node.name.text);
    }
    return false;
}

/** vi.mock and vi['mock'] both name the method; a computed name does not. */
export function mockMethodOf(callee: ts.Expression, bindings: ViBindings): string | undefined {
    if (ts.isPropertyAccessExpression(callee) && isViReceiver(callee.expression, bindings)) {
        return MOCK_METHODS.has(callee.name.text) ? callee.name.text : undefined;
    }
    if (
        ts.isElementAccessExpression(callee) &&
        isViReceiver(callee.expression, bindings) &&
        ts.isStringLiteralLike(callee.argumentExpression)
    ) {
        return MOCK_METHODS.has(callee.argumentExpression.text) ? callee.argumentExpression.text : undefined;
    }
    return undefined;
}

function unwrapParens(node: ts.Expression): ts.Expression {
    let current = node;
    while (ts.isParenthesizedExpression(current)) current = current.expression;
    return current;
}

/** The literal text of a mock's first argument, or undefined when it is not a literal. */
export function literalSpecifier(argument: ts.Expression | undefined): string | undefined {
    if (argument === undefined) return undefined;
    const node = unwrapParens(argument);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const inner = node.arguments[0];
        return inner !== undefined && ts.isStringLiteralLike(inner) ? inner.text : undefined;
    }
    return undefined;
}

function scan(files: string[]): ScanResult {
    const options = loadResolverOptions();
    const violations: Violation[] = [];
    let callsChecked = 0;

    for (const file of files) {
        const containingFile = path.resolve(file);
        const sf = ts.createSourceFile(containingFile, fs.readFileSync(containingFile, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const bindings = collectViBindings(sf);
        if (bindings.direct.size === 0 && bindings.namespaces.size === 0) continue;

        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && mockMethodOf(node.expression, bindings) !== undefined) {
                callsChecked += 1;
                const call = node.expression.getText(sf);
                const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
                const specifier = literalSpecifier(node.arguments[0]);
                if (specifier === undefined) {
                    violations.push({ file, line, call, specifier: node.arguments[0]?.getText(sf) ?? '<missing>', kind: 'non-literal' });
                } else if (!resolves(specifier, containingFile, options)) {
                    const kind: ViolationKind = isRelativeSpecifier(specifier) ? 'unresolved-relative' : 'unresolved-bare';
                    violations.push({ file, line, call, specifier, kind });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return { violations, callsChecked };
}

/** Every mock specifier in the given files that does not name a real module. */
export function checkViMockPaths(files: string[]): Violation[] {
    return scan(files).violations;
}

/**
 * The .ts / .mts / .cts files under root. test/fixtures/viMockGate is left out unless root is
 * that folder or sits inside it, so the deliberately broken fixtures never fail the real scan.
 */
export function collectSourceFiles(root: string): string[] {
    const absoluteRoot = path.resolve(root);
    const fromFixtures = path.relative(FIXTURE_DIR, absoluteRoot);
    const rootInsideFixtures = fromFixtures === '' || (!fromFixtures.startsWith('..') && !path.isAbsolute(fromFixtures));
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') continue;
                if (!rootInsideFixtures && full === FIXTURE_DIR) continue;
                walk(full);
            } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
                found.push(full);
            }
        }
    };
    walk(absoluteRoot);
    return found.sort();
}

function parseRoot(argv: string[]): string {
    if (argv.length === 0) return path.join(REPO_ROOT, 'test');
    if (argv.length === 2 && argv[0] === '--root' && argv[1] !== '') return argv[1];
    throw new Error('usage: check-vi-mock-paths.ts [--root <dir>]');
}

function main(): void {
    try {
        const root = parseRoot(process.argv.slice(2));
        const files = collectSourceFiles(root);
        if (files.length === 0) throw new Error(`no .ts, .mts or .cts files under ${root}`);
        const { violations, callsChecked } = scan(files);
        if (callsChecked === 0) throw new Error(`no vi.mock-family call found under ${root}; the scan checked nothing`);
        for (const v of violations) {
            const rel = path.relative(REPO_ROOT, v.file).split(path.sep).join('/');
            console.log(`${rel}:${v.line} ${v.call}(${v.specifier}) ${v.kind}`);
        }
        console.log(`check-vi-mock-paths: ${callsChecked} mock calls checked in ${files.length} files, ${violations.length} violations`);
        process.exit(violations.length === 0 ? 0 : 1);
    } catch (e) {
        console.error(`check-vi-mock-paths: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(2);
    }
}

if (require.main === module) main();
