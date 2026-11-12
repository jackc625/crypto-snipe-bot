// test/unit/rails/spawnSites.test.ts
// Phase 22 plan 22-11 — SAFE-02 D-03: spawnRailedChild is the only way a test starts a process.
//
// A TypeScript-AST gate (so aliases, destructuring and re-exports cannot slip past a regex). It
// walks every script under test/ and flags:
//   (a) any way of loading child_process, worker_threads or cluster (a worker thread or cluster
//       worker escapes the per-process rails) or a third-party spawner: static import, namespace,
//       renamed or destructured binding, export-from, import-equals, dynamic import(), require,
//       createRequire(...)(...), vi.importActual / vi.importMock;
//   (b) any require / import() whose specifier is not a string literal (it cannot be checked),
//       except a plain require of a computed path in the files named in COMPUTED_REQUIRE_FILES;
//   (c) any call named spawn, spawnSync, exec, execSync, execFile, execFileSync or fork, bare
//       or as a member access.
//
// One carve-out in (c): a member call `.exec()` is a SQL or RegExp call far more often than a
// process spawn. It is accepted only on a RegExp literal or on a receiver named in
// SAFE_EXEC_RECEIVERS, so an unknown receiver still fails and has to be looked at.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { REPO_ROOT } from '../../rails/spawnRailedChild';

const BANNED_MODULES = new Set([
    'child_process',
    'node:child_process',
    'worker_threads',
    'node:worker_threads',
    'cluster',
    'node:cluster',
    'execa',
    'cross-spawn',
    'shelljs',
]);
const SPAWN_CALLEES = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']);
const SCRIPT_EXTENSIONS = new Set(['.ts', '.cts', '.mts', '.js', '.cjs', '.mjs']);

// better-sqlite3 handles and RegExp objects as named in the tests today.
const SAFE_EXEC_RECEIVERS = new Set(['db', 'mockDb', 'fileDb', 'mem', 'w', 'attachRe', 'vacRe', 'entryRe']);

// Repo-relative POSIX paths, each with the reason it may spawn directly.
const ALLOWED_FILES = new Map<string, string>([
    ['test/rails/spawnRailedChild.ts', 'the railed spawner itself'],
    ['test/fork/setup.ts', 'the single documented exemption: starts Hardhat, which needs the network; children get buildHardhatChildEnv'],
    ['test/rails/selfcheck.cjs', 'the plain-Node proof of the rails, run outside Vitest; its only child hashes and deletes a temp fake root with a minimal env built from scratch'],
]);

// Repo-relative POSIX paths allowed a plain `require(<computed path>)`, each with the reason.
// Only that one check is relaxed: a literal banned module, any other computed load form and
// every spawn call in these files are still flagged.
const COMPUTED_REQUIRE_FILES = new Map<string, string>([
    ['test/rails/probes/duplicateLoadProbe.cjs', 'the SAFE-03 probe has to load a guarded module through a casing or junction alias path computed at run time; it runs only as a railed child'],
]);

interface Offence {
    file: string;
    line: number;
    why: string;
}

function literalOf(node: ts.Node | undefined): string | undefined {
    return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function calleeName(expr: ts.Expression): string | undefined {
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
    return undefined;
}

/** The names in this file that are bound to require or to createRequire. */
function collectRequireBindings(sf: ts.SourceFile): { requires: Set<string>; createRequires: Set<string> } {
    const requires = new Set(['require']);
    const createRequires = new Set(['createRequire']);
    const visit = (node: ts.Node): void => {
        if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === 'createRequire') createRequires.add(node.name.text);
        if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
            const source = node.propertyName !== undefined && ts.isIdentifier(node.propertyName) ? node.propertyName.text : node.name.text;
            if (source === 'createRequire') createRequires.add(node.name.text);
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
            const init = node.initializer;
            if (ts.isIdentifier(init) && init.text === 'require') requires.add(node.name.text);
            if (ts.isCallExpression(init) && calleeName(init.expression) === 'createRequire') requires.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return { requires, createRequires };
}

/** The scanner: every offence in one source text. Used on real files and on the fixtures. */
function scanSource(file: string, source: string, allowComputedRequire = false): Offence[] {
    const ext = path.extname(file);
    const kind = ext === '.ts' || ext === '.cts' || ext === '.mts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
    const { requires, createRequires } = collectRequireBindings(sf);
    const offences: Offence[] = [];
    const add = (node: ts.Node, why: string): void => {
        offences.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, why });
    };
    const checkSpecifier = (node: ts.Node, specifier: ts.Node | undefined, form: string): void => {
        const value = literalOf(specifier);
        if (value === undefined) add(node, `${form} with a non-literal specifier`);
        else if (BANNED_MODULES.has(value)) add(node, `${form} of ${value}`);
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
            checkSpecifier(node, node.moduleSpecifier, 'import');
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
            checkSpecifier(node, node.moduleSpecifier, 'export-from');
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            checkSpecifier(node, node.moduleReference.expression, 'import-equals');
        } else if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const name = calleeName(callee);
            if (callee.kind === ts.SyntaxKind.ImportKeyword) {
                checkSpecifier(node, node.arguments[0], 'dynamic import()');
            } else if (
                (ts.isIdentifier(callee) && requires.has(callee.text)) ||
                (ts.isPropertyAccessExpression(callee) && callee.name.text === 'require') ||
                (ts.isCallExpression(callee) && createRequires.has(calleeName(callee.expression) ?? ''))
            ) {
                const computedPlainRequire = ts.isIdentifier(callee) && callee.text === 'require' && literalOf(node.arguments[0]) === undefined;
                if (!(allowComputedRequire && computedPlainRequire)) checkSpecifier(node, node.arguments[0], 'require');
            } else if (ts.isPropertyAccessExpression(callee) && (name === 'importActual' || name === 'importMock')) {
                const value = literalOf(node.arguments[0]);
                if (value !== undefined && BANNED_MODULES.has(value)) add(node, `vi.${name} of ${value}`);
            }
            if (name !== undefined && SPAWN_CALLEES.has(name) && !isSafeExec(callee, name)) add(node, `call to ${name}()`);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return offences;
}

function isSafeExec(callee: ts.Expression, name: string): boolean {
    if (name !== 'exec' || !ts.isPropertyAccessExpression(callee)) return false;
    const receiver = callee.expression;
    if (receiver.kind === ts.SyntaxKind.RegularExpressionLiteral) return true;
    if (ts.isIdentifier(receiver)) return SAFE_EXEC_RECEIVERS.has(receiver.text);
    if (ts.isPropertyAccessExpression(receiver)) return SAFE_EXEC_RECEIVERS.has(receiver.name.text);
    return false;
}

function walkScripts(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') walkScripts(full, out);
        } else if (entry.isFile() && SCRIPT_EXTENSIONS.has(path.extname(entry.name))) {
            out.push(full);
        }
    }
    return out;
}

function relPosix(file: string): string {
    return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

describe('spawn-site gate (SAFE-02 D-03)', () => {
    // closes-finding: AUD-TESTI-011 (rail test, RED proof row 18 of red-proofs/INDEX.md; re-run by 23-14 as 23-14-6-spawn-gate.txt)
    it('no script under test/ loads a spawner or spawns, outside the allowed files', () => {
        const files = walkScripts(path.join(REPO_ROOT, 'test'));
        const scanned = files.map(relPosix);
        expect(scanned.length).toBeGreaterThan(100);
        expect(scanned).toContain('test/integration/pauseCli.test.ts');
        for (const allowed of ALLOWED_FILES.keys()) expect(scanned).toContain(allowed);
        for (const allowed of COMPUTED_REQUIRE_FILES.keys()) expect(scanned).toContain(allowed);

        const offences = files
            .filter((f) => !ALLOWED_FILES.has(relPosix(f)))
            .flatMap((f) => scanSource(relPosix(f), fs.readFileSync(f, 'utf8'), COMPUTED_REQUIRE_FILES.has(relPosix(f))))
            .map((o) => `${o.file}:${o.line} ${o.why}`);
        expect(offences).toEqual([]);
    }, 60_000);

    it('the scanner flags every planted spawn form (self-check)', () => {
        const forms: Array<[string, string]> = [
            ['bare-call.ts', "spawnSync('x', []);\n"],
            ['namespace.ts', "import * as cp from 'child_process';\ncp.spawn('x');\n"],
            ['destructured-alias.ts', "const { spawn: s } = require('child_process');\ns('x');\n"],
            ['renamed-import.ts', "import { execSync as run } from 'node:child_process';\nrun('x');\n"],
            ['dynamic-import.ts', "export async function f() { await import('child_process'); }\n"],
            ['non-literal-require.ts', "const name = 'child' + '_process';\nrequire(name);\n"],
            ['create-require.ts', "require('module').createRequire(__filename)('child_process');\n"],
            ['re-export.ts', "export { spawn } from 'child_process';\n"],
            ['worker-threads.ts', "import { Worker } from 'worker_threads';\nnew Worker('x');\n"],
            ['third-party.ts', "import execa from 'execa';\nexeca('x');\n"],
        ];
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-spawn-gate-'));
        try {
            for (const [name, source] of forms) {
                const file = path.join(dir, name);
                fs.writeFileSync(file, source, 'utf8');
                expect(scanSource(file, fs.readFileSync(file, 'utf8')).length, name).toBeGreaterThan(0);
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('catches the further forms that have no real use', () => {
        const flagged = (source: string): boolean => scanSource('fixture.ts', source).length > 0;
        expect(flagged("import cp = require('cluster');\n")).toBe(true);
        expect(flagged("import { createRequire } from 'node:module';\nconst r = createRequire('x');\nr('child_process');\n")).toBe(true);
        expect(flagged("import { createRequire as cr } from 'node:module';\ncr('x')('worker_threads');\n")).toBe(true);
        expect(flagged("const { createRequire } = require('module');\nconst r = createRequire('x');\nr(dynamicName);\n")).toBe(true);
        expect(flagged("const r = require;\nr('shelljs');\n")).toBe(true);
        expect(flagged("module.require('cross-spawn');\n")).toBe(true);
        expect(flagged("vi.importActual('child_process');\n")).toBe(true);
        expect(flagged('await import(dynamicName);\n')).toBe(true);
        expect(flagged("proc.fork('x');\n")).toBe(true);
        expect(flagged("unknownThing.exec('ls');\n")).toBe(true);
    });

    it('the computed-require allowance relaxes only a plain require of a computed path', () => {
        const flagged = (source: string): boolean => scanSource('fixture.cjs', source, true).length > 0;
        expect(flagged('require(aliasPath);\n')).toBe(false);
        expect(flagged("require('child_process');\n")).toBe(true);
        expect(flagged("spawnSync('x', []);\n")).toBe(true);
        expect(flagged('await import(aliasPath);\n')).toBe(true);
        expect(flagged('const r = require;\nr(aliasPath);\n')).toBe(true);
        expect(flagged('module.require(aliasPath);\n')).toBe(true);
        expect(flagged("require('module').createRequire(__filename)(aliasPath);\n")).toBe(true);
    });

    it('does not flag ordinary code', () => {
        const flagged = (source: string): boolean => scanSource('fixture.ts', source).length > 0;
        expect(flagged("import * as fs from 'fs';\n")).toBe(false);
        expect(flagged("const x = require('path');\n")).toBe(false);
        expect(flagged("await import('../../src/config');\n")).toBe(false);
        expect(flagged("db.exec('CREATE TABLE t (a)');\n")).toBe(false);
        expect(flagged('/a/.exec(input);\n')).toBe(false);
        expect(flagged("const s = \"spawnSync('x'); require('child_process')\";\n")).toBe(false);
    });
});
