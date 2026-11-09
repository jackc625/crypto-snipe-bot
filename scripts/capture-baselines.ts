// scripts/capture-baselines.ts
//
// Phase 22 plan 22-16 — SAFE-07: the re-runnable baseline capture for v7.0.
//
// It writes nine sorted, pretty-printed files so milestone close can show exactly what changed:
//   meta.json, npm-ls.json, npm-audit.json, eslint-by-rule.json, eslint-by-file.json,
//   test-counts.json, coverage-files.txt, db-hashes.json, tree-hashes.json
//
// Usage (Node 22.16.0 by absolute path, D-21; wrap every run in scripts/verify-prod-untouched.ts,
// because `vitest list` runs setupFiles and imports every test file):
//   node node_modules/ts-node/dist/bin.js scripts/capture-baselines.ts --phase before|after [--out <dir>]
//
// Every measurement is labelled with the tree it measured:
//   phase_start       the isolated export of phase_start_sha (backup-record.json)
//   post_rails        the railed main checkout at HEAD
//   dependency_tree   npm ls / npm audit, with the check that the dependency manifests are identical
//                     at phase_start_sha and HEAD
//
// SAFETY (D-13, P3, P8, NAC-08):
//   - Pre-rail test code can reach the real .env and the live DB when run from the real checkout,
//     so the pre-rail count comes ONLY from a `git archive` export outside the repo, with a real
//     node_modules folder holding one junction per top-level entry (so Vite's .vite caches stay in
//     the export), no .env other than the tracked .env.example (and, in later exports, the tracked
//     sentinel test/.env.test), no data/, a scrubbed env and the rails preload (spawnRailedChild).
//     collectInExport() refuses to run anywhere else.
//   - Only `--project unit` and `--project integration` are ever listed. A bare `vitest list` would
//     run the fork project's globalSetup, which starts Hardhat.
//   - The export is deleted by unlinking every junction first, then a recursive delete of the rest.
//     A recursive delete through a junction can reach the real node_modules; this order prevents it.
//   - Live data/ files are hashed as raw bytes; they are never opened through SQLite. The script
//     never imports src/, never boots the bot and never installs anything.
//   - NAC-08 / NAC-03: package.json, package-lock.json, the node_modules tree hash and the three DB
//     hashes are compared before and after the run; any change exits 1.
//   - `npm audit` is the only network call this script makes (it sends dependency names and
//     versions to the npm registry). It runs outside Vitest.
//
// Phase 26 must update the ABI assert when the Node runtime changes.

if (process.versions.modules !== '127') {
    console.error(
        `capture-baselines requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}). ` +
            'Run it as C:\\Users\\jackc\\AppData\\Local\\nvm\\v22.16.0\\node.exe (D-21).',
    );
    process.exit(1);
}

import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { REPO_ROOT, spawnRailedChild } from '../test/rails/spawnRailedChild';

// ---------------------------------------------------------------------------
// Fixed facts
// ---------------------------------------------------------------------------

export const EXPORT_MARKER = '.csb-baseline-export';
const CACHE_DIRS_EXCLUDED = Object.freeze(['.vite', '.vite-temp', '.cache']);
const CACHE_DIRS_REASON =
    'Vitest and Vite write these caches during `vitest list`; they are not part of the installed dependency tree, so including them would make the NAC-08 hash change on every run (RESEARCH STL-2).';
const PROJECTS = Object.freeze(['unit', 'integration']);
const DB_FILES = Object.freeze(['bot.db', 'bot.db-wal', 'bot.db-shm']);
const STATE_MD_LINT_BASELINE = Object.freeze({ errors: 350, warnings: 22 });
const BEFORE_TEST_COUNTS_PATH = '.planning/baselines/before/test-counts.json';
const LIST_TIMEOUT_MS = 900_000;
const ESLINT_TIMEOUT_MS = 900_000;

const IS_WIN = process.platform === 'win32';
const REPO = fs.realpathSync.native(REPO_ROOT);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function fail(msg: string): never {
    throw new Error(`capture-baselines: ${msg}`);
}

function sha256(buf: Buffer | string): string {
    return createHash('sha256').update(buf).digest('hex');
}

function sortDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
            out[k] = sortDeep((value as Record<string, unknown>)[k]);
        }
        return out;
    }
    return value;
}

function stableStringify(value: unknown): string {
    return JSON.stringify(sortDeep(value), null, 2) + '\n';
}

function toPosix(p: string): string {
    return p.split(path.sep).join('/');
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace an absolute path, in either slash style, everywhere in a string. */
function replacePathForms(text: string, abs: string, placeholder: string): string {
    const forward = abs.replace(/\\/g, '/');
    const back = abs.replace(/\//g, '\\');
    const doubled = back.replace(/\\/g, '\\\\');
    let out = text;
    for (const form of [doubled, back, forward]) {
        out = out.replace(new RegExp(escapeRe(form), IS_WIN ? 'gi' : 'g'), placeholder);
    }
    return out;
}

function scrubbedEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const k of ['SystemRoot', 'ComSpec', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP', 'TMPDIR', 'ProgramFiles', 'ProgramData']) {
        const v = process.env[k];
        if (typeof v === 'string') env[k] = v;
    }
    const parentPath = process.env.PATH || process.env.Path || '';
    env.PATH = path.dirname(process.execPath) + path.delimiter + parentPath;
    return env;
}

function runGit(args: string[], cwd: string = REPO): string {
    const r = spawnSync('git', args, { cwd, env: scrubbedEnv(), encoding: 'utf8', windowsHide: true, maxBuffer: 256 << 20 });
    if (r.error) fail(`git ${args.join(' ')} could not run: ${r.error.message}`);
    if (r.status !== 0) fail(`git ${args.join(' ')} exited ${r.status}: ${r.stderr.trim()}`);
    return r.stdout;
}

function gitBlobShaOrNull(ref: string): string | null {
    const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: REPO, env: scrubbedEnv(), encoding: 'utf8', windowsHide: true });
    if (r.error || r.status !== 0) return null;
    return r.stdout.trim();
}

function gitShow(ref: string): string {
    return runGit(['-c', 'core.autocrlf=false', 'show', ref]);
}

function listTree(sha: string): string[] {
    return runGit(['ls-tree', '-r', '--name-only', '-z', sha])
        .split('\0')
        .filter((f) => f !== '');
}

interface NpmResult {
    exit_code: number | null;
    stdout: string;
    stderr: string;
}

function runNpm(args: string[]): NpmResult {
    // Literal arguments only; npm is a .cmd shim on Windows, which needs a shell.
    const r = spawnSync(IS_WIN ? `npm ${args.join(' ')}` : 'npm', IS_WIN ? [] : args, {
        cwd: REPO,
        env: scrubbedEnv(),
        encoding: 'utf8',
        windowsHide: true,
        shell: IS_WIN,
        maxBuffer: 256 << 20,
    });
    if (r.error) fail(`npm ${args.join(' ')} could not run: ${r.error.message}`);
    return { exit_code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function parseJsonOrFail(label: string, text: string): Record<string, unknown> {
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch (e) {
        return fail(`${label} did not print valid JSON: ${e instanceof Error ? e.message : String(e)}; first bytes: ${text.slice(0, 200)}`);
    }
}

// ---------------------------------------------------------------------------
// Step 1 / 9 — NAC-08 hashes (package manifests, node_modules tree, live DB)
// ---------------------------------------------------------------------------

interface TreeHash {
    sha256: string;
    file_count: number;
}

function walkNodeModules(dir: string, rel: string, lines: string[]): void {
    for (const name of fs.readdirSync(dir).sort()) {
        const entryRel = rel === '' ? name : `${rel}/${name}`;
        if (rel === '' && CACHE_DIRS_EXCLUDED.includes(name)) continue;
        const abs = path.join(dir, name);
        const st = fs.lstatSync(abs);
        if (st.isDirectory()) {
            walkNodeModules(abs, entryRel, lines);
        } else {
            lines.push(`${entryRel}\t${st.size}\t${st.mtimeMs}`);
        }
    }
}

function nodeModulesTreeHash(): TreeHash {
    const lines: string[] = [];
    walkNodeModules(path.join(REPO, 'node_modules'), '', lines);
    lines.sort();
    return { sha256: sha256(lines.join('\n')), file_count: lines.length };
}

interface ManifestHashes {
    package_json_sha256: string;
    package_lock_json_sha256: string;
    node_modules: TreeHash;
}

function manifestHashes(): ManifestHashes {
    return {
        package_json_sha256: sha256(fs.readFileSync(path.join(REPO, 'package.json'))),
        package_lock_json_sha256: sha256(fs.readFileSync(path.join(REPO, 'package-lock.json'))),
        node_modules: nodeModulesTreeHash(),
    };
}

interface DbFact {
    status: 'PRESENT' | 'ABSENT';
    sha256?: string;
    size?: number;
    mtimeMs?: number;
}

function dbFacts(): Record<string, DbFact> {
    const out: Record<string, DbFact> = {};
    for (const f of DB_FILES) {
        const abs = path.join(REPO, 'data', f);
        if (!fs.existsSync(abs)) {
            out[f] = { status: 'ABSENT' };
            continue;
        }
        // Raw bytes only: this file is never opened through SQLite.
        const st = fs.statSync(abs);
        out[f] = { status: 'PRESENT', sha256: sha256(fs.readFileSync(abs)), size: st.size, mtimeMs: st.mtimeMs };
    }
    return out;
}

interface DbSetEntry {
    path: string;
    status: string;
    size?: number;
    sha256?: string;
}

function compareWithPhaseStart(facts: Record<string, DbFact>): { compared_with: string; matches: boolean; differences: string[] } {
    const record = JSON.parse(fs.readFileSync(path.join(REPO, '.planning/baselines/backup-record.json'), 'utf8')) as { db_set: DbSetEntry[] };
    const diffs: string[] = [];
    for (const entry of record.db_set) {
        const name = entry.path.replace(/^data\//, '');
        const live = facts[name];
        if (!live) {
            diffs.push(`${entry.path}: not measured`);
            continue;
        }
        if (live.status !== entry.status || live.sha256 !== entry.sha256 || live.size !== entry.size) {
            diffs.push(`${entry.path}: live ${live.status}/${live.sha256}/${live.size} vs phase start ${entry.status}/${entry.sha256}/${entry.size}`);
        }
    }
    return { compared_with: '.planning/baselines/backup-record.json', matches: diffs.length === 0, differences: diffs.sort() };
}

// ---------------------------------------------------------------------------
// The isolated export (D-13)
// ---------------------------------------------------------------------------

function isInsideDir(child: string, parent: string): boolean {
    const a = (IS_WIN ? child.toLowerCase() : child).replace(/[\\/]+$/, '');
    const b = (IS_WIN ? parent.toLowerCase() : parent).replace(/[\\/]+$/, '');
    return a === b || a.startsWith(b + path.sep);
}

/**
 * The export may hold only the tracked example env file (and, in an export of a later SHA, the
 * tracked sentinel test env file) and must have no data/ folder. Throws on anything else.
 */
export function assertExportClean(dir: string): void {
    const realDir = fs.realpathSync.native(dir);
    const offenders: string[] = [];
    const walk = (d: string, rel: string): void => {
        for (const name of fs.readdirSync(d)) {
            if (rel === '' && name === 'node_modules') continue;
            const abs = path.join(d, name);
            const entryRel = rel === '' ? name : `${rel}/${name}`;
            const st = fs.lstatSync(abs);
            if (/^\.env/i.test(name) && entryRel !== '.env.example' && entryRel !== 'test/.env.test') offenders.push(entryRel);
            if (st.isDirectory()) walk(abs, entryRel);
        }
    };
    walk(realDir, '');
    if (fs.existsSync(path.join(realDir, 'data'))) fail(`export refused: a data/ folder exists in ${realDir}`);
    if (offenders.length > 0) fail(`export refused: unexpected env file(s): ${offenders.sort().join(', ')}`);
}

/** Refuses unless dir is a marked export outside the repo with no .git. Checks in that order. */
export function assertCollectableDir(dir: string): string {
    const real = fs.realpathSync.native(dir);
    if (isInsideDir(real, REPO)) fail(`collection refused: ${real} is the repository (or inside it); D-13 allows collection only in an isolated export`);
    if (fs.existsSync(path.join(real, '.git'))) fail(`collection refused: ${real} has a .git entry`);
    if (!fs.existsSync(path.join(real, EXPORT_MARKER))) fail(`collection refused: ${real} has no ${EXPORT_MARKER} marker`);
    return real;
}

function buildExport(phaseStartSha: string): string {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'csb-baseline-export-')));
    // core.autocrlf=false: the export holds the exact blob bytes on every machine.
    const archive = spawnSync('git', ['-c', 'core.autocrlf=false', 'archive', '--format=tar', phaseStartSha], {
        cwd: REPO,
        env: scrubbedEnv(),
        windowsHide: true,
        maxBuffer: 1 << 30,
    });
    if (archive.error) fail(`git archive could not run: ${archive.error.message}`);
    if (archive.status !== 0) fail(`git archive exited ${archive.status}: ${archive.stderr.toString('utf8').trim()}`);
    // Pipe the tar stream into `tar -x` with cwd set to the export, so no Windows path reaches tar.
    const extract = spawnSync('tar', ['-xf', '-'], { cwd: dir, env: scrubbedEnv(), input: archive.stdout, windowsHide: true });
    if (extract.error) fail(`tar could not run: ${extract.error.message}`);
    if (extract.status !== 0) fail(`tar -x exited ${extract.status}: ${extract.stderr.toString('utf8').trim()}`);
    fs.writeFileSync(path.join(dir, EXPORT_MARKER), `phase_start_sha=${phaseStartSha}\n`, 'utf8');

    const repoNodeModules = path.join(REPO, 'node_modules');
    const exportNodeModules = path.join(dir, 'node_modules');
    fs.mkdirSync(exportNodeModules);
    const linkType = IS_WIN ? 'junction' : 'dir';
    for (const name of fs.readdirSync(repoNodeModules)) {
        if (CACHE_DIRS_EXCLUDED.includes(name)) continue;
        const target = path.join(repoNodeModules, name);
        const link = path.join(exportNodeModules, name);
        if (fs.statSync(target).isDirectory()) {
            fs.symlinkSync(target, link, linkType);
        } else {
            // Junctions only work for folders; a top-level file such as .package-lock.json is copied.
            fs.copyFileSync(target, link);
        }
    }
    assertExportClean(dir);
    return dir;
}

function removeExport(dir: string): void {
    const real = fs.realpathSync.native(dir);
    if (isInsideDir(real, REPO) || !isInsideDir(real, fs.realpathSync.native(os.tmpdir())) || !fs.existsSync(path.join(real, EXPORT_MARKER))) {
        fail(`export cleanup refused for ${real}`);
    }
    const nm = path.join(real, 'node_modules');
    if (fs.existsSync(nm)) {
        for (const name of fs.readdirSync(nm)) {
            const link = path.join(nm, name);
            if (!fs.lstatSync(link).isSymbolicLink()) continue;
            try {
                fs.unlinkSync(link);
            } catch {
                fs.rmdirSync(link);
            }
        }
        const left = fs.readdirSync(nm).filter((name) => fs.lstatSync(path.join(nm, name)).isSymbolicLink());
        if (left.length > 0) fail(`export cleanup refused: junctions remain (${left.join(', ')})`);
    }
    fs.rmSync(real, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// vitest list
// ---------------------------------------------------------------------------

interface ListEntry {
    name: string;
    file: string;
    projectName?: string;
}

interface CollectionError {
    file: string;
    message: string;
}

interface ProjectCount {
    count: number;
    identities: string[];
    errors: CollectionError[];
}

function firstProblemLine(output: string): string {
    const line = output.split(/\r?\n/).find((l) => /error|cannot|failed/i.test(l));
    return (line || output.slice(0, 500)).trim();
}

function canonMessage(text: string, exportDir: string | null): string {
    const plain = text.replace(new RegExp(String.raw`\u001b\[[0-9;]*m`, 'g'), '');
    const noExport = exportDir === null ? plain : replacePathForms(plain, exportDir, '<export>');
    return replacePathForms(noExport, REPO, '<repo>');
}

function vitestListIn(cwd: string, project: string, workDir: string, label: string, exportDir: string | null): ProjectCount {
    const jsonPath = path.join(workDir, `list-${label}-${project}.json`);
    const vitest = path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
    const r = spawnRailedChild(process.execPath, [vitest, 'list', '--project', project, `--json=${jsonPath}`], { cwd, timeoutMs: LIST_TIMEOUT_MS });
    // A file-level collection error makes `vitest list` print the error and write no JSON at all
    // (vitest cli-api processCollected). That is an anomaly to diagnose, never a zero count.
    if (!fs.existsSync(jsonPath)) {
        const output = `${r.stdout}\n${r.stderr}`;
        return {
            count: 0,
            identities: [],
            errors: [{ file: `(project ${project}: no JSON produced, exit ${r.status})`, message: canonMessage(firstProblemLine(output), exportDir) }],
        };
    }
    const entries = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ListEntry[];
    const realCwd = fs.realpathSync.native(cwd);
    const rel = (file: string): string => {
        const native = file.replace(/\//g, path.sep);
        return toPosix(path.relative(realCwd, native));
    };
    return {
        count: entries.length,
        identities: entries.map((e) => `${rel(e.file)}\t${e.name}`).sort(),
        errors: [],
    };
}

/** The ONLY way pre-rail code is collected: refuses anywhere but a marked isolated export. */
export function collectInExport(dir: string, project: string, workDir: string): ProjectCount {
    const real = assertCollectableDir(dir);
    return vitestListIn(real, project, workDir, 'pre', real);
}

/** Deep stat listing of the repo's .vite caches: compared only in memory, never written out. */
function viteCacheStamp(): string {
    const lines: string[] = [];
    const walk = (dir: string, rel: string): void => {
        for (const name of fs.readdirSync(dir).sort()) {
            const abs = path.join(dir, name);
            const entryRel = `${rel}/${name}`;
            const st = fs.lstatSync(abs);
            lines.push(`${entryRel}\t${st.size}\t${st.mtimeMs}`);
            if (st.isDirectory()) walk(abs, entryRel);
        }
    };
    for (const name of ['.vite', '.vite-temp']) {
        const p = path.join(REPO, 'node_modules', name);
        if (fs.existsSync(p)) {
            lines.push(`${name}\t${fs.statSync(p).mtimeMs}`);
            walk(p, name);
        } else {
            lines.push(`${name}\tabsent`);
        }
    }
    return lines.sort().join('\n');
}

// ---------------------------------------------------------------------------
// ESLint
// ---------------------------------------------------------------------------

interface EslintMessage {
    ruleId: string | null;
    severity: number;
    fatal?: boolean;
    message: string;
}

interface EslintResultFile {
    filePath: string;
    messages: EslintMessage[];
    errorCount: number;
    warningCount: number;
}

interface LintSummary {
    rules: Record<string, { errors: number; warnings: number }>;
    files: Record<string, { errors: number; warnings: number }>;
    total: { errors: number; warnings: number };
    fatal: { file: string; message: string }[];
}

function runEslint(cwd: string, workDir: string, label: string, exportDir: string | null): LintSummary {
    const outFile = path.join(workDir, `eslint-${label}.json`);
    const eslint = path.join(cwd, 'node_modules', 'eslint', 'bin', 'eslint.js');
    const r = spawnRailedChild(process.execPath, [eslint, 'src', '--format', 'json', '--output-file', outFile], { cwd, timeoutMs: ESLINT_TIMEOUT_MS });
    // ESLint exits 1 when problems exist (expected here) and 2 on a fatal configuration error.
    if (r.status !== 0 && r.status !== 1) fail(`ESLint on ${label} exited ${r.status}: ${firstProblemLine(`${r.stdout}\n${r.stderr}`)}`);
    if (!fs.existsSync(outFile)) fail(`ESLint on ${label} wrote no output (exit ${r.status}): ${firstProblemLine(`${r.stdout}\n${r.stderr}`)}`);
    const results = JSON.parse(fs.readFileSync(outFile, 'utf8')) as EslintResultFile[];
    const realCwd = fs.realpathSync.native(cwd);
    const summary: LintSummary = { rules: {}, files: {}, total: { errors: 0, warnings: 0 }, fatal: [] };
    for (const result of results) {
        if (result.messages.length === 0) continue;
        const rel = toPosix(path.relative(realCwd, result.filePath));
        let errors = 0;
        let warnings = 0;
        for (const m of result.messages) {
            const rule = m.ruleId || '(parse-error)';
            const bucket = (summary.rules[rule] ||= { errors: 0, warnings: 0 });
            if (m.severity === 2) {
                bucket.errors += 1;
                errors += 1;
            } else {
                bucket.warnings += 1;
                warnings += 1;
            }
            if (m.fatal) summary.fatal.push({ file: rel, message: canonMessage(m.message, exportDir) });
        }
        summary.files[rel] = { errors, warnings };
        summary.total.errors += errors;
        summary.total.warnings += warnings;
    }
    summary.fatal.sort((a, b) => a.file.localeCompare(b.file) || a.message.localeCompare(b.message));
    return summary;
}

// ---------------------------------------------------------------------------
// Fork count (static AST) and coverage list (static)
// ---------------------------------------------------------------------------

function isTestCallCallee(callee: ts.Expression): boolean {
    let e: ts.Expression = callee;
    while (ts.isPropertyAccessExpression(e)) {
        if (e.name.text === 'extend') return false;
        e = e.expression;
    }
    return ts.isIdentifier(e) && (e.text === 'it' || e.text === 'test');
}

export function countTestCalls(source: string, fileName: string): number {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let count = 0;
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && isTestCallCallee(node.expression)) count += 1;
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return count;
}

interface ForkCount {
    count: number;
    files: Record<string, number>;
}

function forkCountAt(sha: string): ForkCount {
    const files: Record<string, number> = {};
    let count = 0;
    for (const f of listTree(sha)) {
        if (!/^test\/fork\/.*\.test\.ts$/.test(f)) continue;
        const n = countTestCalls(gitShow(`${sha}:${f}`), f);
        files[f] = n;
        count += n;
    }
    return { count, files };
}

/** Only `**` and `*` are understood; anything else is refused, never approximated. */
function globToRegExp(glob: string): RegExp {
    if (/[?[\]{}!]/.test(glob)) fail(`coverage glob ${JSON.stringify(glob)} uses a pattern this script does not implement`);
    let out = '';
    for (let i = 0; i < glob.length; ) {
        if (glob.startsWith('**/', i)) {
            out += '(?:.*/)?';
            i += 3;
        } else if (glob.startsWith('**', i)) {
            out += '.*';
            i += 2;
        } else if (glob[i] === '*') {
            out += '[^/]*';
            i += 1;
        } else {
            out += escapeRe(glob[i]);
            i += 1;
        }
    }
    return new RegExp(`^${out}$`);
}

function stringArrayProperty(obj: ts.ObjectLiteralExpression, name: string): string[] {
    for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        if ((ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) {
            if (!ts.isArrayLiteralExpression(p.initializer)) fail(`coverage.${name} is not an array literal`);
            return p.initializer.elements.map((el) => {
                if (!ts.isStringLiteral(el)) fail(`coverage.${name} holds a non-literal entry`);
                return el.text;
            });
        }
    }
    return [];
}

function coverageGlobs(sha: string): { include: string[]; exclude: string[] } {
    const text = gitShow(`${sha}:vitest.config.ts`);
    const sf = ts.createSourceFile('vitest.config.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const find = (node: ts.Node): ts.ObjectLiteralExpression | undefined => {
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'coverage' && ts.isObjectLiteralExpression(node.initializer)) return node.initializer;
        return ts.forEachChild(node, find);
    };
    const coverage = find(sf);
    if (coverage === undefined) fail(`vitest.config.ts at ${sha} has no coverage object literal`);
    return { include: stringArrayProperty(coverage, 'include'), exclude: stringArrayProperty(coverage, 'exclude') };
}

function coverageFilesAt(sha: string): string[] {
    const { include, exclude } = coverageGlobs(sha);
    const inc = include.map(globToRegExp);
    const exc = exclude.map(globToRegExp);
    return listTree(sha)
        .filter((f) => inc.some((re) => re.test(f)) && !exc.some((re) => re.test(f)))
        .sort();
}

// ---------------------------------------------------------------------------
// Dependency-tree check
// ---------------------------------------------------------------------------

const DEP_SECTIONS = Object.freeze(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']);

function dependencyCheck(phaseStartSha: string): Record<string, unknown> {
    const lockAtStart = runGit(['rev-parse', `${phaseStartSha}:package-lock.json`]).trim();
    const lockAtHead = runGit(['rev-parse', 'HEAD:package-lock.json']).trim();
    const pkgStart = JSON.parse(gitShow(`${phaseStartSha}:package.json`)) as Record<string, unknown>;
    const pkgHead = JSON.parse(gitShow('HEAD:package.json')) as Record<string, unknown>;
    const sections: Record<string, boolean> = {};
    for (const s of DEP_SECTIONS) {
        sections[s] = stableStringify(pkgStart[s] ?? {}) === stableStringify(pkgHead[s] ?? {});
    }
    const lockIdentical = lockAtStart === lockAtHead;
    const sectionsIdentical = Object.values(sections).every(Boolean);
    return {
        package_lock_blob_phase_start: lockAtStart,
        package_lock_blob_head: lockAtHead,
        package_lock_identical: lockIdentical,
        package_json_sections_identical: sections,
        identical: lockIdentical && sectionsIdentical,
    };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

interface Cli {
    phase: 'before' | 'after';
    outDir: string;
}

function parseArgs(argv: string[]): Cli {
    let phase: string | undefined;
    let out: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--phase') phase = argv[++i];
        else if (a === '--out') out = argv[++i];
        else fail(`unknown argument ${a}. Usage: --phase before|after [--out <dir>]`);
    }
    if (phase !== 'before' && phase !== 'after') fail('--phase must be before or after');
    if (out !== undefined && out.trim() === '') fail('--out needs a directory');
    return { phase, outDir: out !== undefined ? path.resolve(out) : path.join(REPO, '.planning', 'baselines', phase) };
}

function writeOut(outDir: string, name: string, value: unknown, exportDir: string | null): void {
    const text = typeof value === 'string' ? value : stableStringify(value);
    const noExport = exportDir === null ? text : replacePathForms(text, exportDir, '<export>');
    fs.writeFileSync(path.join(outDir, name), replacePathForms(noExport, REPO, '<repo>'), 'utf8');
}

function main(): void {
    const { phase, outDir } = parseArgs(process.argv.slice(2));
    const failures: string[] = [];
    fs.mkdirSync(outDir, { recursive: true });
    const workDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'csb-baseline-work-')));
    const record = JSON.parse(fs.readFileSync(path.join(REPO, '.planning/baselines/backup-record.json'), 'utf8')) as { phase_start_sha: string };
    const phaseStartSha = record.phase_start_sha;
    const headSha = runGit(['rev-parse', 'HEAD']).trim();

    let preRailSource: string | null = null;
    let committedPreRail: Record<string, unknown> | null = null;
    if (phase === 'after') {
        const blobRef = `HEAD:${BEFORE_TEST_COUNTS_PATH}`;
        preRailSource = gitBlobShaOrNull(blobRef);
        if (preRailSource === null) fail(`--phase after needs the committed ${BEFORE_TEST_COUNTS_PATH}; it is missing at HEAD`);
        committedPreRail = JSON.parse(gitShow(blobRef)) as Record<string, unknown>;
    }

    console.log('step 1: start hashes (package manifests, node_modules tree)');
    const startManifests = manifestHashes();

    console.log('step 2: live DB files (raw bytes only)');
    const startDb = dbFacts();
    const phaseStartDb = compareWithPhaseStart(startDb);
    writeOut(outDir, 'db-hashes.json', { label: 'live_db', files: startDb, phase_start_manifest: phaseStartDb }, null);
    if (!phaseStartDb.matches && phase === 'before') failures.push(`NAC-03: live data differs from the phase-start manifest: ${phaseStartDb.differences.join('; ')}`);

    console.log('step 3: npm ls (read-only)');
    const depCheck = dependencyCheck(phaseStartSha);
    const npmLs = runNpm(['ls', '--all', '--json']);
    const lsParsed = parseJsonOrFail('npm ls', npmLs.stdout);
    const lsProblems = Array.isArray(lsParsed.problems) ? [...(lsParsed.problems as unknown[])].map(String).sort() : [];
    writeOut(
        outDir,
        'npm-ls.json',
        {
            label: 'dependency_tree',
            exit_code: npmLs.exit_code,
            expected_nonzero_reason: 'npm ls exits non-zero with the legacy peer-dependency tree (CI installs with --legacy-peer-deps); the problems list records why.',
            problems: lsProblems,
            dependency_tree_check: depCheck,
            tree: lsParsed,
        },
        null,
    );

    console.log('step 4: npm audit (read-only; the one sanctioned network call)');
    const npmAudit = runNpm(['audit', '--json']);
    writeOut(outDir, 'npm-audit.json', { label: 'dependency_tree', exit_code: npmAudit.exit_code, time_varying: 'advisory data', dependency_tree_check: depCheck, audit: parseJsonOrFail('npm audit', npmAudit.stdout) }, null);

    let exportDir: string | null = null;
    try {
        console.log('building the isolated export of the phase-start commit');
        const cacheStampBeforeExport = viteCacheStamp();
        exportDir = buildExport(phaseStartSha);

        console.log('step 5: ESLint on both trees');
        const lintStart = runEslint(exportDir, workDir, 'phase-start', exportDir);
        const lintPost = runEslint(REPO, workDir, 'post-rails', null);
        const delta = {
            errors: lintPost.total.errors - lintStart.total.errors,
            warnings: lintPost.total.warnings - lintStart.total.warnings,
        };
        const matchesState = lintStart.total.errors === STATE_MD_LINT_BASELINE.errors && lintStart.total.warnings === STATE_MD_LINT_BASELINE.warnings;
        const stateMdNote = matchesState
            ? 'phase_start equals the STATE.md milestone-start baseline (npx eslint src: 350 errors / 22 warnings).'
            : `phase_start differs from the STATE.md milestone-start baseline (350 errors / 22 warnings): ${lintStart.total.errors} errors / ${lintStart.total.warnings} warnings. Diagnose before relying on the comparison.`;
        const countDelta = (from: Record<string, { errors: number; warnings: number }>, to: Record<string, { errors: number; warnings: number }>): Record<string, { errors: number; warnings: number }> => {
            const out: Record<string, { errors: number; warnings: number }> = {};
            for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
                const a = from[k] || { errors: 0, warnings: 0 };
                const b = to[k] || { errors: 0, warnings: 0 };
                if (a.errors !== b.errors || a.warnings !== b.warnings) out[k] = { errors: b.errors - a.errors, warnings: b.warnings - a.warnings };
            }
            return out;
        };
        const comparison = { state_md_baseline: STATE_MD_LINT_BASELINE, phase_start_matches_state_md: matchesState, phase_start_vs_state_md: stateMdNote, post_rails_delta_vs_phase_start: delta, post_rails_delta_note: 'The delta is the lint effect of the rails\' new or changed src/ files.' };
        writeOut(outDir, 'eslint-by-rule.json', { phase_start: { rules: lintStart.rules, total: lintStart.total, fatal: lintStart.fatal }, post_rails: { rules: lintPost.rules, total: lintPost.total, fatal: lintPost.fatal }, post_rails_delta_by_rule: countDelta(lintStart.rules, lintPost.rules), ...comparison }, exportDir);
        writeOut(outDir, 'eslint-by-file.json', { phase_start: { files: lintStart.files, total: lintStart.total }, post_rails: { files: lintPost.files, total: lintPost.total }, post_rails_delta_by_file: countDelta(lintStart.files, lintPost.files), ...comparison }, exportDir);

        console.log('step 6: test counts');
        let preRailCounts: Record<string, number>;
        let preRailErrors: Record<string, CollectionError[]>;
        let preIdentities: Record<string, string[]> = {};
        if (phase === 'before') {
            preRailCounts = {};
            preRailErrors = {};
            for (const p of PROJECTS) {
                const c = collectInExport(exportDir, p, workDir);
                preRailCounts[p] = c.count;
                preRailErrors[p] = c.errors;
                preIdentities[p] = c.identities;
            }
        } else {
            preRailCounts = committedPreRail!.pre_rail as Record<string, number>;
            preRailErrors = (committedPreRail!.pre_rail_collection_errors || {}) as Record<string, CollectionError[]>;
        }
        if (viteCacheStamp() !== cacheStampBeforeExport) failures.push('D-13: the repo node_modules .vite cache changed during the export run');
        // Fails unless the export kept its own caches: post-rail listing below may legitimately refresh them.
        const postCounts: Record<string, number> = {};
        const postErrors: Record<string, CollectionError[]> = {};
        const postIdentities: Record<string, string[]> = {};
        for (const p of PROJECTS) {
            const c = vitestListIn(REPO, p, workDir, 'post', null);
            postCounts[p] = c.count;
            postErrors[p] = c.errors;
            postIdentities[p] = c.identities;
        }
        const preRailNotInPost: Record<string, string[]> = {};
        if (phase === 'before') {
            for (const p of PROJECTS) {
                const post = new Set(postIdentities[p]);
                preRailNotInPost[p] = preIdentities[p].filter((id) => !post.has(id)).sort();
            }
        }
        const nac04Checks: Record<string, { pre_rail: number; post_rail: number; ok: boolean }> = {};
        for (const p of PROJECTS) {
            const ok = postCounts[p] >= preRailCounts[p];
            nac04Checks[p] = { pre_rail: preRailCounts[p], post_rail: postCounts[p], ok };
            if (!ok) failures.push(`NAC-04: ${p} post-rail ${postCounts[p]} is below pre-rail ${preRailCounts[p]}`);
        }
        const forkStart = forkCountAt(phaseStartSha);
        const forkPost = forkCountAt('HEAD');
        writeOut(
            outDir,
            'test-counts.json',
            {
                pre_rail: preRailCounts,
                pre_rail_collection_errors: preRailErrors,
                pre_rail_tree: 'phase_start',
                pre_rail_source: preRailSource,
                pre_rail_method: phase === 'before' ? 'vitest list --project <p> --json in the isolated export, through spawnRailedChild' : `loaded from the committed ${BEFORE_TEST_COUNTS_PATH} (blob ${preRailSource}); never re-collected`,
                post_rail: postCounts,
                post_rail_collection_errors: postErrors,
                post_rail_tree: 'post_rails',
                post_rail_method: 'vitest list --project <p> --json in the main checkout (railed by the project setupFiles and the preload)',
                list_caveat: 'vitest list drops tests whose collected state is skipped (it.skip, it.todo, it.skipIf with a true condition); a file that fails collection makes it write no JSON at all, recorded here as a collection error.',
                fork: {
                    phase_start: forkStart,
                    post_rails: forkPost,
                    method: 'static TypeScript AST count of test/fork/**/*.test.ts at the git tree: every call expression whose callee is it/test or a property chain on it/test (.only .skip .todo .each .skipIf .runIf .concurrent ...); no Hardhat, no network, no import of any test file.',
                    each_caveat: 'a .each or .skipIf/.runIf call counts once, however many cases it expands to at run time; a fixture alias created with test.extend is not counted.',
                },
                pre_rail_not_in_post_rail: phase === 'before' ? preRailNotInPost : 'not computed in after mode',
                pre_rail_not_in_post_rail_note: 'file + test title present in the pre-rail count but not in the post-rail list. Every such entry must be a recorded rename or an operator-ruled move in .planning/audit/inputs/test-identity.json; a title absent from a project is not by itself a NAC-04 failure, the count comparison below is.',
                nac04: { ok: Object.values(nac04Checks).every((c) => c.ok), checks: nac04Checks },
            },
            exportDir,
        );

        console.log('step 7: coverage file lists (static)');
        const covStart = coverageFilesAt(phaseStartSha);
        const covPost = coverageFilesAt('HEAD');
        writeOut(outDir, 'coverage-files.txt', `# phase_start\n${covStart.join('\n')}\n\n# post_rails\n${covPost.join('\n')}\n`, exportDir);

        console.log('step 8: meta');
        const measuredTrees = {
            'eslint-by-file.json': ['phase_start', 'post_rails'],
            'eslint-by-rule.json': ['phase_start', 'post_rails'],
            'coverage-files.txt': ['phase_start', 'post_rails'],
            'npm-ls.json': ['dependency_tree'],
            'npm-audit.json': ['dependency_tree'],
            'test-counts.json:pre_rail': ['phase_start'],
            'test-counts.json:post_rail': ['post_rails'],
            'test-counts.json:fork.phase_start': ['phase_start'],
            'test-counts.json:fork.post_rails': ['post_rails'],
            'db-hashes.json': ['live_db (compared with the phase-start manifest)'],
            'tree-hashes.json': ['main checkout'],
        };
        writeOut(
            outDir,
            'meta.json',
            {
                phase,
                node_version: process.version,
                node_abi: process.versions.modules,
                npm_version: runNpm(['-v']).stdout.trim(),
                phase_start_sha: phaseStartSha,
                head_sha: headSha,
                measured_trees: measuredTrees,
                pre_rail_source: preRailSource,
                captured_at: new Date().toISOString(),
                time_varying_fields: ['meta.json:captured_at', 'npm-audit.json:advisory data (metadata, vulnerabilities, advisories)'],
                methods: {
                    pre_rail_count: 'git archive export of phase_start_sha, junctioned node_modules, no env file but the tracked example and sentinel, no data folder, scrubbed env and rails preload via spawnRailedChild (D-13)',
                    post_rail_count: 'vitest list per project in the main checkout',
                    eslint: 'node eslint.js src --format json --output-file, per tree, in the export and the checkout',
                    coverage_files: 'tracked files at the tree matching that tree vitest.config.ts coverage include minus exclude; static, no coverage run',
                    fork_count: 'static TypeScript AST count; see test-counts.json',
                    tree_hash: `sha256 over sorted relpath\\tsize\\tmtimeMs lines of node_modules, excluding ${CACHE_DIRS_EXCLUDED.join(', ')}: ${CACHE_DIRS_REASON}`,
                    db_hashes: 'raw-byte SHA-256 of data/bot.db, bot.db-wal, bot.db-shm; never opened through SQLite',
                },
                script_blob_sha: runGit(['hash-object', 'scripts/capture-baselines.ts']).trim(),
            },
            exportDir,
        );
    } finally {
        if (exportDir !== null) removeExport(exportDir);
        fs.rmSync(workDir, { recursive: true, force: true });
    }

    // E22 / L378: no output may name a temp folder. Compares against os.tmpdir() itself, in every
    // slash style, so a package named "tmp" in a registry URL is not a false alarm.
    const tmpReal = fs.realpathSync.native(os.tmpdir());
    const leakForms = [tmpReal, tmpReal.split('\\').join('/'), tmpReal.split('\\').join('\\\\')];
    for (const name of fs.readdirSync(outDir).sort()) {
        const text = fs.readFileSync(path.join(outDir, name), 'utf8');
        const haystack = IS_WIN ? text.toLowerCase() : text;
        if (leakForms.some((form) => haystack.includes(IS_WIN ? form.toLowerCase() : form))) failures.push(`E22: ${name} contains an absolute temp path`);
    }

    console.log('step 9: end hashes (NAC-08 / NAC-03)');
    const endManifests = manifestHashes();
    const endDb = dbFacts();
    const nac08 = {
        package_json_unchanged: startManifests.package_json_sha256 === endManifests.package_json_sha256,
        package_lock_json_unchanged: startManifests.package_lock_json_sha256 === endManifests.package_lock_json_sha256,
        node_modules_unchanged: startManifests.node_modules.sha256 === endManifests.node_modules.sha256,
    };
    const dbUnchanged = JSON.stringify(sortDeep(startDb)) === JSON.stringify(sortDeep(endDb));
    writeOut(outDir, 'tree-hashes.json', { start: startManifests, end: endManifests, nac08, nac03_db_unchanged: dbUnchanged, node_modules_excluded: CACHE_DIRS_EXCLUDED, node_modules_excluded_reason: CACHE_DIRS_REASON }, null);
    if (!nac08.package_json_unchanged || !nac08.package_lock_json_unchanged || !nac08.node_modules_unchanged) failures.push(`NAC-08: the capture changed what it measures: ${JSON.stringify(nac08)}`);
    if (!dbUnchanged) failures.push('NAC-03: a live DB file changed during the capture');

    if (failures.length > 0) {
        console.error('capture-baselines FAILED:');
        for (const f of failures) console.error(`  - ${f}`);
        process.exitCode = 1;
        return;
    }
    console.log(`capture-baselines: wrote nine files to ${outDir}`);
}

if (require.main === module) {
    try {
        main();
    } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exit(1);
    }
}
