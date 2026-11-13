// test/unit/sourceTextGate.test.ts
// Phase 23 plan 23-19 (CHAR-06, SPEC Requirement 8, AC-37): the standing check that no test reads
// a named top-level src/ or scripts/ file as text. AC-37 was a one-off search; this makes a new
// source-text test fail CI instead of waiting for the next audit.
//
// The rule, over a TypeScript AST of EVERY .ts/.tsx/.mts/.cts/.js/.jsx/.cjs/.mjs file under test/
// (test files, helpers, fixtures and rail probes alike, operator ruling 2026-11-12, so a named
// read cannot hide in a helper):
//   A named-file read is a call to a file-read function (readFileSync, readFile on any receiver:
//   fs, fs.promises, fs/promises, ts.sys; createReadStream), to ts.createSourceFile (its file
//   name) or to ts.createProgram (its root names: an array, { rootNames: x } or { rootNames }), whose path
//   argument is built from string literals that name one file below top-level src/ or scripts/:
//   after resolving '.' and '..' (path.posix.normalize style) and dropping the '..' left at the
//   front, the first segment is src or scripts and a later segment is a file name (has an
//   extension). Literals are followed through local const, let and var bindings (every value
//   assigned to the name), for-of bindings and the parameters of a named local function (its call
//   sites' arguments in the same file), up to FOLLOW_LEVELS levels, and through path.join /
//   path.resolve style calls, template literals, string concatenation, array elements,
//   new URL(lit, import.meta.url) and require.resolve(lit) / import.meta.resolve(lit) (which name
//   the module file lit resolves to, extension or not).
//   The read function is found by what it is, not only by its name (Phase 23 review WR-29): an
//   import alias (import { readFileSync as rd } from 'fs'), a destructured or assigned copy
//   (const { readFile: rf } = fs; const read = fs.readFileSync; fs.readFileSync.bind(fs)), an
//   element access with a literal (fs['readFileSync']), and f.call(thisArg, p) / f.apply(thisArg, [p]).
//   An import, export-from, import() or require() whose specifier carries a Vite ?raw or ?url query
//   and resolves (from the importing file) below top-level src/ or scripts/ is a named read too:
//   it loads the file as text with no fs call.
//   Not a named-file read: a directory walk (the path comes from a listing of src/ or scripts/
//   and no literal names a file), which is the path-agnostic form SPEC Boundaries leave out of
//   scope and the form the static proofs of plans 23-13, 23-30 and 23-31 use; a read rooted in a
//   temp folder (os.tmpdir / mkdtemp on the path); dashboard/ files (not top-level src/); and
//   .env.example, package.json, tsconfig.json and other files outside src/ and scripts/.
//
// A hit is a violation unless its file is on ALLOW_LIST, each entry with its reason.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCANNED_FILE = /\.(ts|tsx|mts|cts|js|jsx|cjs|mjs)$/;
const READ_FUNCTIONS = new Set(['readFileSync', 'readFile', 'createReadStream']);
/** Every function whose path argument the rule reads, for alias tracking (WR-29). */
const PATH_FUNCTIONS = new Set([...READ_FUNCTIONS, 'createSourceFile', 'createProgram']);
/** Modules whose named exports are read functions (an import alias of one is the function). */
const READ_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'typescript']);
/** A Vite query that loads a file as text or as its URL. */
const RAW_QUERY = /[?&](raw|url)(?=[&=]|$)/;
/** Marks the last segment of require.resolve(lit) as a file: it names the module file lit resolves to. */
const RESOLVED_SUFFIX = '.resolved';
const TEMP_ROOT_CALLS = new Set(['tmpdir', 'mkdtempSync', 'mkdtemp']);
const FILE_NAME_SEGMENT = /\.[A-Za-z0-9]+$/;
const MAX_ALTERNATIVES = 64;
// Measured on the 11 CHAR-06 files as they were at the phase start (23-19-SUMMARY.md): following
// local consts one level (the plan's wording) finds 9 of them; following a local helper's
// parameter to its call sites adds mainEntry (parse('src/main.ts')), and dotenvSrcSkip case (e)
// needs a second level (a for-of binding over a const array). When 23-19 measured it, levels 1, 2
// and 4 reported the same single hit on the whole tree (the AUD-API-002 restart fixture, then
// allow-listed); plan 23-32 removed that read, so the tree outside the allow list has none. 3
// keeps one level of margin.
const FOLLOW_LEVELS = 3;

/**
 * Files allowed to read a named top-level src/ or scripts/ file, each with its reason. Nothing
 * else is on it: the path-agnostic scanners and the static proofs pass the rule on their own
 * (see the third test).
 */
const ALLOW_LIST: Record<string, string> = {
    'test/unit/dashboard/pauseBanner.test.ts':
        'SPEC Requirement 8 named exception to CHAR-06 (AC-37 "apart from the 3 named dashboard tests"): dashboard component source-text tests, moved to Phase 28 (TEST-07) because converting them needs a browser-simulation test library.',
    'test/unit/dashboard/anti-rug/displayComponents.test.ts':
        'SPEC Requirement 8 named exception to CHAR-06, as pauseBanner.test.ts (Phase 28, TEST-07).',
    'test/unit/dashboard/anti-rug/interactiveComponents.test.ts':
        'SPEC Requirement 8 named exception to CHAR-06, as pauseBanner.test.ts (Phase 28, TEST-07).',
};

interface ReadSite {
    /** Path of the scanned file relative to the scan's base folder, forward slashes. */
    file: string;
    line: number;
    call: string;
    /** The first path alternative that names a file below top-level src/ or scripts/, if any. */
    named: string | null;
}

type Segments = string[];

function splitSegments(text: string): Segments {
    return text.split(/[\\/]+/).filter((s) => s !== '');
}

function concat(a: Segments[], b: Segments[]): Segments[] {
    const out: Segments[] = [];
    for (const x of a) for (const y of b) if (out.length < MAX_ALTERNATIVES) out.push([...x, ...y]);
    return out;
}

/** Resolve '.' and '..' (path.posix.normalize style), then drop the '..' left at the front (a root such as __dirname contributes no segment). */
function normalizeSegments(segments: Segments): Segments {
    const out: Segments = [];
    for (const s of segments) {
        if (s === '.') continue;
        if (s === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop();
        else out.push(s);
    }
    while (out[0] === '..') out.shift();
    return out;
}

function namesTopLevelSourceFile(segments: Segments): boolean {
    const clean = normalizeSegments(segments);
    return (clean[0] === 'src' || clean[0] === 'scripts') && clean.slice(1).some((s) => FILE_NAME_SEGMENT.test(s));
}

function unwrap(e: ts.Expression): ts.Expression {
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
    return e;
}

/** The name a callee is called by: the member name, a literal element-access key, or a local alias of a read function. */
function calleeName(call: ts.CallExpression, aliases: Map<string, string> = new Map()): string | undefined {
    const c = unwrap(call.expression);
    if (ts.isPropertyAccessExpression(c)) return c.name.text;
    if (ts.isElementAccessExpression(c) && ts.isStringLiteralLike(c.argumentExpression)) return c.argumentExpression.text;
    if (ts.isIdentifier(c)) return aliases.get(c.text) ?? c.text;
    return undefined;
}

/** The read function an expression denotes as a value (fs.readFileSync, fs['readFile'], an alias, fs.readFileSync.bind(fs)), or undefined. */
function readFunctionRef(e: ts.Expression, aliases: Map<string, string>): string | undefined {
    const x = unwrap(e);
    if (ts.isPropertyAccessExpression(x) && PATH_FUNCTIONS.has(x.name.text)) return x.name.text;
    if (ts.isElementAccessExpression(x) && ts.isStringLiteralLike(x.argumentExpression) && PATH_FUNCTIONS.has(x.argumentExpression.text)) return x.argumentExpression.text;
    if (ts.isIdentifier(x)) return aliases.get(x.text);
    if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === 'bind') return readFunctionRef(x.expression.expression, aliases);
    return undefined;
}

/** Every read-like call in one file, each with whether its path names a top-level src/ or scripts/ file. */
function readSites(file: string, text: string): ReadSite[] {
    const kind = /\.(c|m)?jsx?$/.test(file) ? ts.ScriptKind.JS : file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);

    // Every value a local name can hold: const, let and var initializers (for-of: the iterated
    // expression) and, for let and var, every value assigned to the name later (WR-29).
    const constInits = new Map<string, ts.Expression[]>();
    const bind = (name: string, e: ts.Expression): void => {
        constInits.set(name, [...(constInits.get(name) ?? []), e]);
    };
    const calls: ts.CallExpression[] = [];
    const specifiers: ts.StringLiteralLike[] = [];
    const aliases = new Map<string, string>();
    const aliasCandidates: [string, ts.Expression][] = [];
    const index = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && ts.isVariableDeclarationList(n.parent)) {
            const init = n.initializer ?? (ts.isForOfStatement(n.parent.parent) ? n.parent.parent.expression : undefined);
            if (init) {
                bind(n.name.text, init);
                aliasCandidates.push([n.name.text, init]);
            }
        }
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) {
            bind(n.left.text, n.right);
            aliasCandidates.push([n.left.text, n.right]);
        }
        // const { readFile: rf } = fs  /  const { readFileSync } = require('fs')
        if (ts.isBindingElement(n) && ts.isIdentifier(n.name) && ts.isObjectBindingPattern(n.parent)) {
            const pn = n.propertyName;
            const key = pn ? (ts.isIdentifier(pn) || ts.isStringLiteralLike(pn) ? pn.text : undefined) : n.name.text;
            if (key !== undefined && PATH_FUNCTIONS.has(key)) aliases.set(n.name.text, key);
        }
        // import { readFileSync as rd } from 'fs'
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && READ_MODULES.has(n.moduleSpecifier.text) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
            for (const el of n.importClause.namedBindings.elements) {
                const imported = (el.propertyName ?? el.name).text;
                if (PATH_FUNCTIONS.has(imported)) aliases.set(el.name.text, imported);
            }
        }
        if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) specifiers.push(n.moduleSpecifier);
        if (ts.isCallExpression(n)) {
            calls.push(n);
            const callee = n.expression;
            const a0 = n.arguments[0];
            if (((ts.isIdentifier(callee) && callee.text === 'require') || callee.kind === ts.SyntaxKind.ImportKeyword) && a0 && ts.isStringLiteralLike(a0)) specifiers.push(a0);
        }
        ts.forEachChild(n, index);
    };
    index(sf);
    // const read = fs.readFileSync, const r2 = read, fs.readFileSync.bind(fs): to a fixed point.
    for (let changed = true; changed; ) {
        changed = false;
        for (const [name, init] of aliasCandidates) {
            const fn = readFunctionRef(init, aliases);
            if (fn !== undefined && aliases.get(name) !== fn) {
                aliases.set(name, fn);
                changed = true;
            }
        }
    }

    // A parameter of a named local function: the arguments its call sites in this file pass.
    const parameterArguments = (id: ts.Identifier): ts.Expression[] => {
        for (let p: ts.Node | undefined = id.parent; p; p = p.parent) {
            if (!ts.isFunctionLike(p)) continue;
            const at = p.parameters.findIndex((q) => ts.isIdentifier(q.name) && q.name.text === id.text);
            if (at < 0) continue;
            let name: string | undefined;
            if (ts.isFunctionDeclaration(p) && p.name) name = p.name.text;
            else if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) name = p.parent.name.text;
            if (!name) return [];
            return calls.filter((c) => ts.isIdentifier(c.expression) && c.expression.text === name && c.arguments[at]).map((c) => c.arguments[at]);
        }
        return [];
    };

    const paths = (e: ts.Expression, level: number, state: { temp: boolean }): Segments[] => {
        e = unwrap(e);
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [splitSegments(e.text)];
        // new URL(lit, import.meta.url): the path is lit, relative to the file (WR-29).
        if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'URL' && e.arguments?.[0]) return paths(e.arguments[0], level, state);
        // require.resolve(lit) / import.meta.resolve(lit) names the module file lit resolves to,
        // with or without an extension (WR-29).
        if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === 'resolve' && e.arguments[0]) {
            const recv = e.expression.expression;
            const isRequire = ts.isIdentifier(recv) && recv.text === 'require';
            const isImportMeta = ts.isMetaProperty(recv) && recv.keywordToken === ts.SyntaxKind.ImportKeyword;
            if (isRequire || isImportMeta)
                return paths(e.arguments[0], level, state).map((alt) => (alt.length && !FILE_NAME_SEGMENT.test(alt[alt.length - 1]) ? [...alt.slice(0, -1), `${alt[alt.length - 1]}${RESOLVED_SUFFIX}`] : alt));
        }
        if (ts.isTemplateExpression(e)) {
            let acc: Segments[] = [splitSegments(e.head.text)];
            for (const span of e.templateSpans) acc = concat(concat(acc, paths(span.expression, level, state)), [splitSegments(span.literal.text)]);
            return acc;
        }
        if (ts.isIdentifier(e)) {
            if (level >= FOLLOW_LEVELS) return [[]];
            const sources = constInits.get(e.text) ?? parameterArguments(e);
            if (sources.length === 0) return [[]];
            return sources.flatMap((s) => paths(s, level + 1, state)).slice(0, MAX_ALTERNATIVES);
        }
        if (ts.isArrayLiteralExpression(e)) {
            const out = e.elements.flatMap((el) => paths(ts.isSpreadElement(el) ? el.expression : el, level, state));
            return out.length === 0 ? [[]] : out.slice(0, MAX_ALTERNATIVES);
        }
        if (ts.isCallExpression(e)) {
            const name = calleeName(e, aliases) ?? '';
            if (TEMP_ROOT_CALLS.has(name)) state.temp = true;
            let acc: Segments[] = [[]];
            for (const a of e.arguments) acc = concat(acc, paths(ts.isSpreadElement(a) ? a.expression : a, level, state));
            // A call on a computed receiver (walk(dir).map(...)) also carries the receiver's paths.
            if (ts.isPropertyAccessExpression(e.expression) && !ts.isIdentifier(e.expression.expression)) {
                acc = concat(paths(e.expression.expression, level, state), acc);
            }
            return acc;
        }
        if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            return concat(paths(e.left, level, state), paths(e.right, level, state));
        }
        if (ts.isConditionalExpression(e)) return [...paths(e.whenTrue, level, state), ...paths(e.whenFalse, level, state)];
        return [[]];
    };

    const sites: ReadSite[] = [];
    const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    // WR-29: a ?raw / ?url import loads the file as text with no fs call. Its specifier is
    // resolved from the importing file (repo-relative here), so '../../src/bot.ts?raw' in
    // test/unit/x.test.ts names src/bot.ts.
    for (const spec of specifiers) {
        const q = spec.text.indexOf('?');
        if (q < 0 || !RAW_QUERY.test(spec.text.slice(q))) continue;
        const target = spec.text.slice(0, q);
        const segs = target.startsWith('.') ? [...splitSegments(path.posix.dirname(file)), ...splitSegments(target)] : splitSegments(target);
        const clean = normalizeSegments(segs);
        const named = (clean[0] === 'src' || clean[0] === 'scripts') && clean.length >= 2 ? clean.join('/') : null;
        sites.push({ file, line: lineOf(spec), call: `import${spec.text.slice(q)}`, named });
    }
    for (const call of calls) {
        let name = calleeName(call, aliases);
        let args: readonly ts.Expression[] = call.arguments;
        // WR-29: f.call(thisArg, p) / f.apply(thisArg, [p]) of a read function.
        const callee = unwrap(call.expression);
        if (ts.isPropertyAccessExpression(callee) && (callee.name.text === 'call' || callee.name.text === 'apply')) {
            const fn = readFunctionRef(callee.expression, aliases);
            if (fn !== undefined) {
                name = fn;
                const rest = call.arguments.slice(1);
                const a0 = rest[0] ? unwrap(rest[0]) : undefined;
                args = callee.name.text === 'apply' && a0 && ts.isArrayLiteralExpression(a0) ? a0.elements.filter((el): el is ts.Expression => !ts.isSpreadElement(el)) : rest;
            }
        }
        if (name === undefined || args.length === 0) continue;
        const first = args[0];
        const pathArgs: ts.Expression[] = [];
        if (READ_FUNCTIONS.has(name) || name === 'createSourceFile') pathArgs.push(first);
        else if (name === 'createProgram') {
            if (ts.isObjectLiteralExpression(first)) {
                for (const p of first.properties) {
                    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'rootNames') pathArgs.push(p.initializer);
                    if (ts.isShorthandPropertyAssignment(p) && p.name.text === 'rootNames') pathArgs.push(p.name);
                }
            } else pathArgs.push(first);
        }
        for (const arg of pathArgs) {
            const state = { temp: false };
            const hit = paths(arg, 0, state).find(namesTopLevelSourceFile);
            sites.push({
                file,
                line: lineOf(call),
                call: name,
                named: hit !== undefined && !state.temp ? hit.join('/') : null,
            });
        }
    }
    return sites;
}

function listFiles(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) listFiles(full, out);
        else if (SCANNED_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
    }
}

/** Scan every source file below `dir`; paths are reported relative to `base`. */
function scanTree(dir: string, base: string): { files: string[]; sites: ReadSite[] } {
    const abs: string[] = [];
    listFiles(dir, abs);
    const files = abs.map((f) => path.relative(base, f).split(path.sep).join('/')).sort();
    const sites = abs.flatMap((f) => readSites(path.relative(base, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')));
    return { files, sites };
}

const describeSite = (s: ReadSite): string => `${s.file}:${s.line} ${s.call}(${s.named})`;

describe('AC-37 standing source-text gate (CHAR-06)', () => {
    it('no file under test/ reads a named top-level src/ or scripts/ file as text, apart from the allow list', { timeout: 60_000 }, () => {
        const { files, sites } = scanTree(path.join(REPO_ROOT, 'test'), REPO_ROOT);
        // An empty or broken walk must not read as clean.
        expect(files.length).toBeGreaterThan(100);
        expect(files).toContain('test/unit/sourceTextGate.test.ts');
        expect(sites.length).toBeGreaterThan(50);

        const violations = sites.filter((s) => s.named !== null && !Object.prototype.hasOwnProperty.call(ALLOW_LIST, s.file));
        expect(violations.map(describeSite), 'named src/ or scripts/ reads outside the allow list').toEqual([]);
    });

    it('every allow-list entry is an existing file with a reason', () => {
        for (const [file, reason] of Object.entries(ALLOW_LIST)) {
            expect(fs.existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
            expect(reason.length, file).toBeGreaterThan(40);
        }
    });

    it('the static proofs and path-agnostic scanners pass with no allow-list entry, and the rule saw their reads', () => {
        // Directory walks into ts.createProgram / ts.createSourceFile / fs reads (plans 23-13,
        // 23-30, 23-31), reads of .env.example, tsconfig.json, package.json and temp files, and
        // the RESEARCH repo-wide scanners. Each has at least one read the rule evaluated.
        const files = [
            'test/realpath/triage/fixtures/scriptsStatic.ts',
            'test/helpers/sourceGraph.ts',
            'test/unit/exitEngine/antiRugReason.test.ts',
            'test/unit/chainRegistry/antiRugConfig.test.ts',
            'test/integration/processLock.test.ts',
            'test/integration/preflightCli.test.ts',
            'test/unit/codeQuality.test.ts',
            'test/unit/db.test.ts',
            'test/unit/ethersV5PatternsAbsent.test.ts',
            'test/unit/ethersV6BigIntArithmetic.test.ts',
            'test/unit/rails/forkShellOnly.test.ts',
            'test/unit/rails/spawnSites.test.ts',
            'test/unit/rails/envSentinel.test.ts',
            'test/unit/sourceTextGate.test.ts',
        ];
        for (const file of files) {
            expect(Object.prototype.hasOwnProperty.call(ALLOW_LIST, file), `${file} on the allow list`).toBe(false);
            const sites = readSites(file, fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
            expect(sites.length, `${file} read sites`).toBeGreaterThan(0);
            expect(sites.filter((s) => s.named !== null).map(describeSite), file).toEqual([]);
        }
        // AUD-SCRIPTS-002 WRITES files named src/... and scripts/... under a temp root and reads
        // nothing itself (its program is built by scriptsStatic.ts above): a write is not a read.
        const writesOnly = 'test/realpath/triage/AUD-SCRIPTS-002.test.ts';
        expect(readSites(writesOnly, fs.readFileSync(path.join(REPO_ROOT, writesOnly), 'utf8')).filter((s) => s.named !== null)).toEqual([]);
    });

    it('temp-directory cases: a named read through fs or the compiler API fails; a directory walk, a temp-rooted read and non-source files pass', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-source-text-gate-'));
        try {
            const header = "import * as fs from 'fs';\nimport * as os from 'os';\nimport * as path from 'path';\nimport * as ts from 'typescript';\nconst ROOT = path.resolve(__dirname, '..');\n";
            const cases: Record<string, string> = {
                // Fail: named reads.
                'fail-sync.test.ts': "fs.readFileSync(path.join(__dirname, '../src/bot.ts'), 'utf8');\n",
                'fail-callback-and-promise.test.ts': "fs.readFile(path.join(ROOT, 'scripts', 'pause.ts'), () => undefined);\nvoid fs.promises.readFile('src/config.ts', 'utf8');\n",
                'fail-create-source-file.test.ts': "ts.createSourceFile(path.join(ROOT, 'src', 'main.ts'), '', ts.ScriptTarget.Latest);\n",
                'fail-create-program.test.ts': "ts.createProgram([path.join(ROOT, 'src/utils/db.ts')], {});\nts.createProgram({ rootNames: ['scripts/preflight.ts'], options: {} });\n",
                'fail-helper-and-loop.js': "function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }\nread('src/bot.ts');\nconst SITES = ['scripts/resume.ts'];\nfor (const site of SITES) fs.readFileSync(path.join(ROOT, site));\n",
                // Pass: a directory walk, a temp-rooted read, files outside src/ and scripts/.
                'pass-directory-walk.test.ts':
                    "function walk(dir: string): string[] { return fs.readdirSync(dir).map((n) => path.join(dir, n)); }\nconst files = walk(path.join(ROOT, 'src'));\nfor (const f of files) fs.readFileSync(f, 'utf8');\nts.createProgram(walk(path.join(ROOT, 'scripts')), {});\nts.createSourceFile(files[0], '', ts.ScriptTarget.Latest);\n",
                'pass-temp-root.test.ts': "const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\nfs.readFileSync(path.join(tmp, 'src', 'bot.ts'), 'utf8');\n",
                'pass-other-files.test.ts':
                    "fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');\nfs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');\nfs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8');\nfs.readFileSync(path.join(ROOT, 'dashboard/src/App.tsx'), 'utf8');\nfs.readFileSync(path.join(__dirname, 'fixtures/src/x.json'), 'utf8');\n",
            };
            fs.mkdirSync(path.join(root, 'test'));
            for (const [name, body] of Object.entries(cases)) fs.writeFileSync(path.join(root, 'test', name), header + body);

            const { files, sites } = scanTree(path.join(root, 'test'), root);
            expect(files).toHaveLength(Object.keys(cases).length);
            expect(sites.filter((s) => s.named !== null).map((s) => `${s.file} ${s.call}`).sort()).toEqual([
                'test/fail-callback-and-promise.test.ts readFile',
                'test/fail-callback-and-promise.test.ts readFile',
                'test/fail-create-program.test.ts createProgram',
                'test/fail-create-program.test.ts createProgram',
                'test/fail-create-source-file.test.ts createSourceFile',
                'test/fail-helper-and-loop.js readFileSync',
                'test/fail-helper-and-loop.js readFileSync',
                'test/fail-sync.test.ts readFileSync',
            ]);
            // Every pass case had reads the rule evaluated (not an empty scan).
            for (const name of ['pass-directory-walk.test.ts', 'pass-temp-root.test.ts', 'pass-other-files.test.ts']) {
                expect(sites.filter((s) => s.file === `test/${name}`).length, name).toBeGreaterThan(0);
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    // Phase 23 review WR-29: named reads of src/bot.ts that the name-based rule let through.
    it('WR-29 temp-directory cases: ?raw/?url imports, new URL paths, aliased read functions, let bindings, require.resolve and resolved .. segments fail', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-source-text-gate-wr29-'));
        try {
            const header = "import * as fs from 'fs';\nimport * as path from 'path';\n";
            const cases: Record<string, { body: string; named: number }> = {
                'raw-import.test.ts': { body: "import botText from '../../src/bot.ts?raw';\nimport botUrl from '../../src/bot.ts?url';\nvoid import('../../scripts/pause.ts?raw');\nvoid botText; void botUrl;\n", named: 3 },
                'new-url.test.ts': { body: "fs.readFileSync(new URL('../../src/bot.ts', import.meta.url), 'utf8');\n", named: 1 },
                'import-alias.test.ts': { body: "import { readFileSync as rd } from 'fs';\nrd('src/bot.ts');\n", named: 1 },
                'element-access.test.ts': { body: "fs['readFileSync']('src/bot.ts');\n", named: 1 },
                'value-alias.test.ts': { body: "const read = fs.readFileSync;\nread('src/bot.ts');\nconst { readFile: rf } = fs;\nrf('scripts/pause.ts', () => undefined);\nconst bound = fs.readFileSync.bind(fs);\nbound('src/config.ts');\n", named: 3 },
                'call-apply.test.ts': { body: "fs.readFileSync.call(fs, 'src/bot.ts');\nfs.readFileSync.apply(fs, ['src/bot.ts']);\n", named: 2 },
                'let-binding.test.ts': { body: "let p = 'src/bot.ts';\nfs.readFileSync(p);\nvar q = 'x';\nq = 'scripts/pause.ts';\nfs.readFileSync(q);\n", named: 2 },
                'require-resolve.test.ts': { body: "fs.readFileSync(require.resolve('../../src/bot'));\n", named: 1 },
                'dotdot.test.ts': { body: "fs.readFileSync(path.join(__dirname, 'fixtures', '..', '..', '..', 'src', 'bot.ts'));\n", named: 1 },
                // Still passing: a ?raw import of a test fixture, a URL to a temp-free fixture, a read of fixtures/src.
                'pass.test.ts': { body: "import t from './fixtures/a.txt?raw';\nvoid t;\nfs.readFileSync(new URL('./fixtures/src/x.json', import.meta.url));\nfs.readFileSync(path.join(__dirname, 'fixtures', 'src', 'x.json'));\nlet r = 'package.json';\nfs.readFileSync(r);\n", named: 0 },
            };
            fs.mkdirSync(path.join(root, 'test', 'unit'), { recursive: true });
            for (const [name, c] of Object.entries(cases)) fs.writeFileSync(path.join(root, 'test', 'unit', name), header + c.body);
            const { sites } = scanTree(path.join(root, 'test'), root);
            const named = (name: string) => sites.filter((s) => s.file === `test/unit/${name}` && s.named !== null).length;
            expect(Object.fromEntries(Object.keys(cases).map((n) => [n, named(n)]))).toEqual(Object.fromEntries(Object.entries(cases).map(([n, c]) => [n, c.named])));
            // Every case had read sites the rule evaluated (the pass case is not an empty scan).
            for (const name of Object.keys(cases)) expect(sites.filter((s) => s.file === `test/unit/${name}`).length, `${name} read sites`).toBeGreaterThan(0);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
