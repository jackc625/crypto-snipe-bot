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
//   after dropping '.' and '..', the first segment is src or scripts and a later segment is a
//   file name (has an extension). Literals are followed through local const bindings, for-of
//   bindings and the parameters of a named local function (its call sites' arguments in the same
//   file), up to FOLLOW_LEVELS levels, and through path.join / path.resolve style calls, template
//   literals, string concatenation and array elements.
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

function namesTopLevelSourceFile(segments: Segments): boolean {
    const clean = segments.filter((s) => s !== '.' && s !== '..');
    return (clean[0] === 'src' || clean[0] === 'scripts') && clean.slice(1).some((s) => FILE_NAME_SEGMENT.test(s));
}

function calleeName(call: ts.CallExpression): string | undefined {
    const c = call.expression;
    if (ts.isPropertyAccessExpression(c)) return c.name.text;
    if (ts.isIdentifier(c)) return c.text;
    return undefined;
}

/** Every read-like call in one file, each with whether its path names a top-level src/ or scripts/ file. */
function readSites(file: string, text: string): ReadSite[] {
    const kind = /\.(c|m)?jsx?$/.test(file) ? ts.ScriptKind.JS : file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);

    const constInits = new Map<string, ts.Expression[]>();
    const calls: ts.CallExpression[] = [];
    const index = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && ts.isVariableDeclarationList(n.parent) && n.parent.flags & ts.NodeFlags.Const) {
            const init = n.initializer ?? (ts.isForOfStatement(n.parent.parent) ? n.parent.parent.expression : undefined);
            if (init) constInits.set(n.name.text, [...(constInits.get(n.name.text) ?? []), init]);
        }
        if (ts.isCallExpression(n)) calls.push(n);
        ts.forEachChild(n, index);
    };
    index(sf);

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
        while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [splitSegments(e.text)];
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
            const name = calleeName(e) ?? '';
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
    for (const call of calls) {
        const name = calleeName(call);
        if (name === undefined || call.arguments.length === 0) continue;
        const first = call.arguments[0];
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
                line: sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1,
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
});
