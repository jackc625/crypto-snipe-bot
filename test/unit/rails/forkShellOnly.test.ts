// test/unit/rails/forkShellOnly.test.ts
// Phase 22 plan 22-11 — SAFE-02 / AC-17: the fork project's RPC URL and every value a fork test
// reads in a worker come from the shell or from the test itself, never from .env.
//
// TypeScript compiler API over source text only: no fork test file is imported, setup() is never
// called and Hardhat is never started. The checks:
//   (a) no .ts file under test/fork names the old fallback variable;
//   (b) ETH_FORK_RPC_URL is read only by test/fork/helpers/forkRpcUrl.ts (and the rails tests);
//   (c) outside test/fork/rails/, every process.env.<KEY> read is a key the same file assigns,
//       or ALLOW_REAL_MAINNET (a FORK_SHELL_KEY). A test cannot silently depend on a value the
//       rails replace with a sentinel;
//   (d) the Vitest main-process import closure loads no .env: Vitest 4.1.1 forks-pool workers
//       start with the main process env, so this is what makes the worker-inherited
//       FORK_SHELL_KEYS shell values;
//   (e) self-check: the scanners flag planted violations.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { builtinModules, createRequire } from 'module';
import * as ts from 'typescript';
import vitestConfig from '../../../vitest.config';
import forkRehearsalConfig from '../../rails/vitest.fork-rehearsal.config';
import { REPO_ROOT } from '../../rails/spawnRailedChild';

const req = createRequire(import.meta.url);
const FORK_SHELL_KEYS = (req('../../rails/core.cjs') as { FORK_SHELL_KEYS: readonly string[] }).FORK_SHELL_KEYS;

const FORK_DIR = path.join(REPO_ROOT, 'test', 'fork');
const FALLBACK_VARIABLE = 'ALCHEMY_' + 'URL';
const FORK_URL_VARIABLE = 'ETH_FORK_RPC_URL';
const SHELL_READS_ALLOWED = ['ALLOW_REAL_MAINNET'];

interface Finding {
    file: string;
    line: number;
    why: string;
}

function parse(file: string, source: string): ts.SourceFile {
    const ext = path.extname(file);
    const kind = ext === '.ts' || ext === '.cts' || ext === '.mts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
    return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function walk(sf: ts.SourceFile, cb: (node: ts.Node) => void): void {
    const visit = (node: ts.Node): void => {
        cb(node);
        ts.forEachChild(node, visit);
    };
    visit(sf);
}

function relPosix(file: string): string {
    return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function forkTsFiles(dir: string = FORK_DIR, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) forkTsFiles(full, out);
        else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

function isRailsFile(rel: string): boolean {
    return rel.startsWith('test/fork/rails/');
}

// ---- (a) ---------------------------------------------------------------------------------

function scanFallback(file: string, source: string): Finding[] {
    const sf = parse(file, source);
    const found: Finding[] = [];
    walk(sf, (node) => {
        if (ts.isIdentifier(node) && node.text === FALLBACK_VARIABLE) found.push({ file, line: lineOf(sf, node), why: 'identifier names the fallback variable' });
        if (ts.isStringLiteralLike(node) && node.text.includes(FALLBACK_VARIABLE)) found.push({ file, line: lineOf(sf, node), why: 'string names the fallback variable' });
    });
    return found;
}

// ---- (b) ---------------------------------------------------------------------------------

function scanDirectForkUrlReads(file: string, source: string): Finding[] {
    const sf = parse(file, source);
    const found: Finding[] = [];
    walk(sf, (node) => {
        if (ts.isPropertyAccessExpression(node) && node.name.text === FORK_URL_VARIABLE) found.push({ file, line: lineOf(sf, node), why: `direct read of ${FORK_URL_VARIABLE}` });
        if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === FORK_URL_VARIABLE) {
            found.push({ file, line: lineOf(sf, node), why: `direct read of ${FORK_URL_VARIABLE}` });
        }
    });
    return found;
}

// ---- (c) ---------------------------------------------------------------------------------

function isProcessEnv(node: ts.Expression): boolean {
    return ts.isPropertyAccessExpression(node) && node.name.text === 'env' && ts.isIdentifier(node.expression) && node.expression.text === 'process';
}

/** An access is a write or delete, not a read. */
function isAssignedOrDeleted(node: ts.Node): boolean {
    const parent = node.parent;
    if (ts.isDeleteExpression(parent)) return true;
    return ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

function isAssignment(node: ts.Node): boolean {
    return ts.isBinaryExpression(node.parent) && node.parent.left === node && node.parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

function keyOf(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    return ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
}

function scanEnvReads(file: string, source: string): Finding[] {
    const sf = parse(file, source);
    const assigned = new Set<string>();
    const reads: Array<{ key: string | null; node: ts.Node }> = [];
    walk(sf, (node) => {
        if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isProcessEnv(node.expression)) {
            const key = keyOf(node);
            if (isAssignment(node) && key !== null) assigned.add(key);
            if (!isAssignedOrDeleted(node)) reads.push({ key, node });
        }
        if (ts.isVariableDeclaration(node) && node.initializer !== undefined && isProcessEnv(node.initializer) && ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
                const nameNode = element.propertyName ?? element.name;
                reads.push({ key: ts.isIdentifier(nameNode) ? nameNode.text : null, node: element });
            }
        }
    });
    const found: Finding[] = [];
    for (const { key, node } of reads) {
        if (key === null) found.push({ file, line: lineOf(sf, node), why: 'non-literal process.env access' });
        else if (!assigned.has(key) && !SHELL_READS_ALLOWED.includes(key)) found.push({ file, line: lineOf(sf, node), why: `reads process.env.${key}, which this file does not assign and the fork rails replace` });
    }
    return found;
}

// ---- (d) ---------------------------------------------------------------------------------

const BARE_ALLOWED = new Set(['vitest', 'vitest/config', 'ethers', 'better-sqlite3', 'dotenv']);
const RESOLVE_SUFFIXES = ['', '.ts', '.cts', '.mts', '.js', '.cjs', '.mjs', '.json', '/index.ts', '/index.js'];

function isBuiltin(spec: string): boolean {
    return spec.startsWith('node:') || builtinModules.includes(spec) || builtinModules.includes(spec.split('/')[0]);
}

function resolveRelative(fromFile: string, spec: string): string | null {
    const base = path.resolve(path.dirname(fromFile), spec);
    const stem = base.replace(/\.(js|cjs|mjs)$/, '');
    for (const candidate of [...RESOLVE_SUFFIXES.map((s) => base + s), ...RESOLVE_SUFFIXES.map((s) => stem + s)]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
}

interface Dependency {
    spec: string | null;
    node: ts.Node;
}

function isErasedImport(node: ts.ImportDeclaration): boolean {
    const clause = node.importClause;
    if (clause === undefined) return false;
    if (clause.isTypeOnly) return true;
    const named = clause.namedBindings;
    return clause.name === undefined && named !== undefined && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
}

function dependenciesOf(sf: ts.SourceFile): Dependency[] {
    const deps: Dependency[] = [];
    walk(sf, (node) => {
        if (ts.isImportDeclaration(node) && !isErasedImport(node)) deps.push({ spec: ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : null, node });
        if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && !node.isTypeOnly) {
            deps.push({ spec: ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : null, node });
        }
        if (ts.isCallExpression(node)) {
            const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
            const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
            if (isDynamicImport || isRequire) {
                const arg = node.arguments[0];
                deps.push({ spec: arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : null, node });
            }
        }
    });
    return deps;
}

/** The names bound to the dotenv module, and to its config functions. */
function dotenvBindings(sf: ts.SourceFile): { modules: Set<string>; functions: Set<string> } {
    const modules = new Set<string>();
    const functions = new Set<string>();
    const isLoader = (name: string): boolean => name === 'config' || name === 'configDotenv';
    walk(sf, (node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && node.moduleSpecifier.text === 'dotenv' && node.importClause !== undefined) {
            const clause = node.importClause;
            if (clause.name !== undefined) modules.add(clause.name.text);
            const named = clause.namedBindings;
            if (named !== undefined && ts.isNamespaceImport(named)) modules.add(named.name.text);
            if (named !== undefined && ts.isNamedImports(named)) {
                for (const e of named.elements) if (isLoader((e.propertyName ?? e.name).text)) functions.add(e.name.text);
            }
        }
        if (ts.isVariableDeclaration(node) && node.initializer !== undefined && ts.isCallExpression(node.initializer)) {
            const call = node.initializer;
            const arg = call.arguments[0];
            if (ts.isIdentifier(call.expression) && call.expression.text === 'require' && arg !== undefined && ts.isStringLiteralLike(arg) && arg.text === 'dotenv') {
                if (ts.isIdentifier(node.name)) modules.add(node.name.text);
                if (ts.isObjectBindingPattern(node.name)) {
                    for (const e of node.name.elements) {
                        const source = e.propertyName ?? e.name;
                        if (ts.isIdentifier(source) && isLoader(source.text) && ts.isIdentifier(e.name)) functions.add(e.name.text);
                    }
                }
            }
        }
    });
    return { modules, functions };
}

function scanDotenvCalls(file: string, sf: ts.SourceFile): Finding[] {
    const { modules, functions } = dotenvBindings(sf);
    const found: Finding[] = [];
    walk(sf, (node) => {
        if (!ts.isCallExpression(node)) return;
        const callee = node.expression;
        if (ts.isIdentifier(callee) && functions.has(callee.text)) found.push({ file, line: lineOf(sf, node), why: `calls dotenv ${callee.text}()` });
        if (ts.isPropertyAccessExpression(callee) && (callee.name.text === 'config' || callee.name.text === 'configDotenv')) {
            const receiver = callee.expression;
            const isModule = ts.isIdentifier(receiver) && modules.has(receiver.text);
            const isInline = ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression) && receiver.expression.text === 'require' && receiver.arguments[0] !== undefined && ts.isStringLiteralLike(receiver.arguments[0]) && receiver.arguments[0].text === 'dotenv';
            if (isModule || isInline) found.push({ file, line: lineOf(sf, node), why: `calls dotenv ${callee.name.text}()` });
        }
    });
    return found;
}

function scanClosure(startFiles: string[]): { closure: string[]; findings: Finding[] } {
    const seen = new Set<string>();
    const findings: Finding[] = [];
    const queue = [...startFiles];
    const srcRoot = path.join(REPO_ROOT, 'src') + path.sep;
    while (queue.length > 0) {
        const file = queue.pop() as string;
        if (seen.has(file)) continue;
        seen.add(file);
        if (file.endsWith('.json')) continue;
        const sf = parse(file, fs.readFileSync(file, 'utf8'));
        const label = relPosix(file);
        findings.push(...scanDotenvCalls(label, sf));
        for (const { spec, node } of dependenciesOf(sf)) {
            const line = lineOf(sf, node);
            if (spec === null) {
                findings.push({ file: label, line, why: 'non-literal import or require cannot be followed' });
            } else if (spec.startsWith('.')) {
                const resolved = resolveRelative(file, spec);
                if (resolved === null) {
                    findings.push({ file: label, line, why: `cannot resolve ${spec}` });
                } else if (resolved.startsWith(srcRoot)) {
                    findings.push({ file: label, line, why: `reaches src/ through ${spec}` });
                } else if (/^hardhat\.config/.test(path.basename(resolved))) {
                    findings.push({ file: label, line, why: `imports ${spec}` });
                } else {
                    queue.push(resolved);
                }
            } else if (spec === 'dotenv/config') {
                findings.push({ file: label, line, why: 'imports dotenv/config' });
            } else if (spec === 'hardhat' || spec.startsWith('hardhat/')) {
                findings.push({ file: label, line, why: `imports ${spec}` });
            } else if (!isBuiltin(spec) && !BARE_ALLOWED.has(spec)) {
                findings.push({ file: label, line, why: `imports ${spec}, which is not on the allowlist` });
            }
        }
    }
    return { closure: [...seen].map(relPosix).sort(), findings };
}

interface ProjectLike {
    test?: { globalSetup?: string | string[] };
}

function globalSetupsOf(config: unknown): string[] {
    const projects = ((config as { test?: { projects?: ProjectLike[] } }).test?.projects ?? []) as ProjectLike[];
    return projects.flatMap((p) => {
        const entry = p.test?.globalSetup;
        if (entry === undefined) return [];
        return Array.isArray(entry) ? entry : [entry];
    });
}

// ---- tests -------------------------------------------------------------------------------

const scanEach = (scan: (file: string, source: string) => Finding[], keep: (rel: string) => boolean): string[] =>
    forkTsFiles()
        .filter((f) => keep(relPosix(f)))
        .flatMap((f) => scan(relPosix(f), fs.readFileSync(f, 'utf8')))
        .map((x) => `${x.file}:${x.line} ${x.why}`);

describe('fork project reads only the shell and itself (AC-17)', () => {
    it('finds the fork test files', () => {
        const rels = forkTsFiles().map(relPosix);
        expect(rels.length).toBeGreaterThan(5);
        expect(rels).toContain('test/fork/setup.ts');
        expect(rels).toContain('test/fork/helpers/forkRpcUrl.ts');
        expect(rels).toContain('test/fork/exitStatePersistence.fork.test.ts');
    });

    it('(a) no .ts file under test/fork names the fallback variable', () => {
        expect(scanEach(scanFallback, () => true)).toEqual([]);
    });

    it(`(b) only the helper and the rails tests read ${FORK_URL_VARIABLE}`, () => {
        expect(scanEach(scanDirectForkUrlReads, (rel) => rel !== 'test/fork/helpers/forkRpcUrl.ts' && !isRailsFile(rel))).toEqual([]);
    });

    it('(c) every in-worker env read is self-assigned or a fork shell key', () => {
        expect(scanEach(scanEnvReads, (rel) => !isRailsFile(rel))).toEqual([]);
    });

    it('(c) the allowed shell reads are fork shell keys the rails keep alive', () => {
        for (const key of [...SHELL_READS_ALLOWED, FORK_URL_VARIABLE]) expect(FORK_SHELL_KEYS).toContain(key);
    });

    it('(d) the Vitest main-process closure of both configs loads no .env', () => {
        const entries = [
            path.join(REPO_ROOT, 'vitest.config.ts'),
            path.join(REPO_ROOT, 'test', 'rails', 'vitest.fork-rehearsal.config.ts'),
            ...[...globalSetupsOf(vitestConfig), ...globalSetupsOf(forkRehearsalConfig)].map((e) => path.resolve(REPO_ROOT, e)),
        ];
        const { closure, findings } = scanClosure(entries);
        expect(closure).toContain('test/fork/setup.ts');
        expect(closure).toContain('test/fork/helpers/forkRpcUrl.ts');
        expect(closure).toContain('test/fork/helpers/hardhatChildEnv.ts');
        expect(closure).toContain('test/rails/ledgerRun.ts');
        expect({ closure, findings: findings.map((x) => `${x.file}:${x.line} ${x.why}`) }).toEqual({ closure, findings: [] });
    });
});

describe('scanner self-check', () => {
    it('(e) flags a planted fallback read, a planted direct read and an unaccounted env read', () => {
        expect(scanFallback('fixture.ts', `const u = process.env.${FALLBACK_VARIABLE};\n`).length).toBeGreaterThan(0);
        expect(scanDirectForkUrlReads('fixture.ts', `const u = process.env.${FORK_URL_VARIABLE};\n`).length).toBe(1);
        expect(scanEnvReads('fixture.ts', 'const k = process.env.PRIVATE_KEY;\n').length).toBe(1);
        expect(scanEnvReads('fixture.ts', "const k = process.env[name];\n").length).toBe(1);
        expect(scanEnvReads('fixture.ts', "const { PRIVATE_KEY } = process.env;\n").length).toBe(1);
    });

    it('(e) accepts self-assigned keys, ALLOW_REAL_MAINNET and message strings', () => {
        expect(scanEnvReads('fixture.ts', "process.env.DB_PATH = 'x';\nconst p = process.env.DB_PATH;\n")).toEqual([]);
        expect(scanEnvReads('fixture.ts', "const g = process.env.ALLOW_REAL_MAINNET === '1';\n")).toEqual([]);
        expect(scanEnvReads('fixture.ts', 'delete process.env.SOMETHING;\n')).toEqual([]);
        expect(scanDirectForkUrlReads('fixture.ts', `const m = '${FORK_URL_VARIABLE} is required';\n`)).toEqual([]);
    });

    it('(e) the closure scanner flags dotenv/config, dotenv config calls, src/ and hardhat', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-closure-'));
        const check = (name: string, source: string): Finding[] => {
            const file = path.join(dir, name);
            fs.writeFileSync(file, source, 'utf8');
            return scanClosure([file]).findings;
        };
        try {
            expect(check('a.ts', "import 'dotenv/config';\n").length).toBeGreaterThan(0);
            expect(check('b.ts', "import * as dotenv from 'dotenv';\ndotenv.config();\n").length).toBeGreaterThan(0);
            expect(check('c.ts', "import { config as load } from 'dotenv';\nload();\n").length).toBeGreaterThan(0);
            expect(check('d.ts', "require('dotenv').config();\n").length).toBeGreaterThan(0);
            expect(check('e.ts', "import 'hardhat/config';\n").length).toBeGreaterThan(0);
            expect(check('f.ts', "import axios from 'axios';\n").length).toBeGreaterThan(0);
            expect(check('g.ts', 'require(name);\n').length).toBeGreaterThan(0);
            expect(check('h.ts', "import { parse } from 'dotenv';\nparse('A=1');\n")).toEqual([]);
            const srcFile = path.join(dir, 'i.ts');
            const toSrc = path.relative(dir, path.join(REPO_ROOT, 'src', 'config')).split(path.sep).join('/');
            fs.writeFileSync(srcFile, `import '${toSrc}';\n`, 'utf8');
            expect(scanClosure([srcFile]).findings.map((x) => x.why).join(' ')).toMatch(/reaches src\//);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
