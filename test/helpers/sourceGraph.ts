// test/helpers/sourceGraph.ts
//
// Phase 23 plan 23-31 (CHAR-06, SPEC Requirement 8): the repo's TypeScript modules as the compiler
// sees them, found by a directory walk and identified by the symbols they export, never by a file
// name. A test that checks "the module that exports X" keeps working when Phase 27 moves a file,
// and still fails when the behavior it protects is gone.
//
// loadRepoModules(dirs) walks the given top-level folders (for example ['src', 'scripts']) for .ts
// files (no .d.ts), builds one ts.createProgram over them (noResolve, so the program holds exactly
// the walked files and reads nothing else), and returns one entry per file:
//   file      repo-relative path, forward slashes
//   sf        the parsed source file
//   exports   the names the module exports from its own declarations and export lists
//   specifiers every module specifier the file names, as written (packages and built-ins too)
//   imports   the repo modules it names, resolved with the compiler's own module resolution:
//             import / export ... from, import x = require(), require('literal') and
//             import('literal') anywhere in the file. A specifier outside the walked files
//             (a package, a built-in) is not an edge.
// resolveSpecifier(fromFile, spec) resolves one specifier the same way;
// modulesExporting(mods, name) is the symbol lookup; consoleCallCount(sf) counts console.<x>()
// calls; reachable(mods, roots) is the transitive import closure with one path per module.
//
// Every read goes through the compiler host, so an in-memory mutant (scripts/red-proof-conversions.ts,
// reach worker) is seen exactly as a changed file would be.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export interface RepoModule {
    file: string;
    sf: ts.SourceFile;
    exports: Set<string>;
    imports: string[];
    /** Every module specifier the file names, in source order, as written (packages included). */
    specifiers: string[];
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
    noResolve: true,
    noLib: true,
    types: [],
    allowJs: false,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
};

function toRel(abs: string): string {
    return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

function walk(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
    }
}

function hasExportModifier(node: ts.Node): boolean {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function exportedNames(sf: ts.SourceFile): Set<string> {
    const names = new Set<string>();
    for (const s of sf.statements) {
        if (ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause)) {
            for (const e of s.exportClause.elements) names.add(e.name.text);
            continue;
        }
        if (!hasExportModifier(s)) continue;
        if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) {
            names.add(s.name.text);
        } else if (ts.isVariableStatement(s)) {
            for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
        }
    }
    return names;
}

function specifiers(sf: ts.SourceFile): string[] {
    const out: string[] = [];
    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            out.push(node.moduleSpecifier.text);
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
            out.push(node.moduleReference.expression.text);
        } else if (ts.isCallExpression(node) && node.arguments.length >= 1 && ts.isStringLiteralLike(node.arguments[0])) {
            const callee = node.expression;
            if ((ts.isIdentifier(callee) && callee.text === 'require') || callee.kind === ts.SyntaxKind.ImportKeyword) out.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

/** The repo-relative file a specifier in fromFile (repo-relative) resolves to, or null (a package, a built-in, nothing). */
export function resolveSpecifier(fromFile: string, spec: string): string | null {
    const resolved = ts.resolveModuleName(spec, path.join(REPO_ROOT, fromFile), COMPILER_OPTIONS, ts.sys).resolvedModule;
    if (!resolved || resolved.isExternalLibraryImport) return null;
    return toRel(path.resolve(resolved.resolvedFileName));
}

/** The walked modules under the given top-level folders, keyed by repo-relative path. */
export function loadRepoModules(dirs: string[]): Map<string, RepoModule> {
    const files: string[] = [];
    for (const d of dirs) walk(path.join(REPO_ROOT, d), files);
    if (files.length === 0) throw new Error(`sourceGraph: the walk of ${dirs.join(', ')} found no .ts file`);
    // setParentNodes: callers walk from a node up to its parents.
    const program = ts.createProgram({ rootNames: files, options: COMPILER_OPTIONS, host: ts.createCompilerHost(COMPILER_OPTIONS, true) });
    const walked = new Set(files.map((f) => toRel(f)));
    const mods = new Map<string, RepoModule>();
    for (const sf of program.getSourceFiles()) {
        const rel = toRel(path.resolve(sf.fileName));
        if (!walked.has(rel)) continue;
        const imports: string[] = [];
        const specs = specifiers(sf);
        for (const spec of specs) {
            const target = resolveSpecifier(rel, spec);
            if (target !== null && walked.has(target) && !imports.includes(target)) imports.push(target);
        }
        mods.set(rel, { file: rel, sf, exports: exportedNames(sf), imports, specifiers: specs });
    }
    if (mods.size !== walked.size) throw new Error(`sourceGraph: the program holds ${mods.size} of the ${walked.size} walked files`);
    return mods;
}

/** The modules that export `name` (the symbol lookup that names no file). */
export function modulesExporting(mods: Map<string, RepoModule>, name: string): RepoModule[] {
    return [...mods.values()].filter((m) => m.exports.has(name));
}

/** The one module that exports `name`; throws when there is none or more than one. */
export function moduleExporting(mods: Map<string, RepoModule>, name: string): RepoModule {
    const found = modulesExporting(mods, name);
    if (found.length !== 1) throw new Error(`sourceGraph: ${found.length} modules export ${name}: ${JSON.stringify(found.map((m) => m.file))}`);
    return found[0];
}

/** Every module reachable through imports from the roots, each with one import path from a root. */
export function reachable(mods: Map<string, RepoModule>, roots: string[]): Map<string, string[]> {
    const seen = new Map<string, string[]>();
    const queue: string[] = [];
    for (const r of roots) {
        if (!mods.has(r)) throw new Error(`sourceGraph: root ${r} is not a walked module`);
        seen.set(r, [r]);
        queue.push(r);
    }
    while (queue.length > 0) {
        const cur = queue.shift() as string;
        for (const next of (mods.get(cur) as RepoModule).imports) {
            if (seen.has(next)) continue;
            seen.set(next, [...(seen.get(cur) as string[]), next]);
            queue.push(next);
        }
    }
    return seen;
}

/** The number of console.<method>(...) calls in a source file. */
export function consoleCallCount(sf: ts.SourceFile): number {
    let count = 0;
    const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'console') count += 1;
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return count;
}
