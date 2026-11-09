// .planning/audit/tools/test-identity.ts
//
// Phase 22 / Plan 22-15 (AC-22, NAC-04, T-22-88) - proves the original tests are all still here
// and all still ran. Equal test counts can hide a test that was replaced or renamed, so this
// compares title paths, not counts.
//
// For every test file tracked at <sha> (git ls-tree, read with git show) and every test file in
// the working tree, the TypeScript compiler API extracts the title path of each describe/it/test
// call. A base title missing at HEAD is `missing`, unless a rails-test-edits.json entry for that
// file records it as title_before (then it is `renamed`). A base file missing at HEAD is
// `missing_file`. From the Vitest JSON report, every HEAD title of a base file under test/unit/
// or test/integration/ must have passed; base files under test/fork/ are compared by title only
// and recorded as not_run_by_design. Titles that are computed at run time (a .each table, a
// template with a substitution) are recorded as dynamic and compared by call count.
//
// Usage: test-identity.ts --base <sha> --report <vitest json> --out <json> [--ledger <summary.json>]
// Exit: 0 clean, 1 at least one problem (the report is still written), 2 bad usage or crash.
//
// It reads tracked test files and JSON under .planning/ only. It never reads .env, never opens
// data/, and loads no native module.

if (process.versions.modules !== '127') {
    process.stderr.write(`test-identity: requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}). (D-21)\n`);
    process.exit(2);
}

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as ts from 'typescript';

export interface Extracted {
    titles: string[]; // sorted title paths, ' > ' joined, statically known
    dynamicCount: number;
}

const BLOCKS = new Set(['describe', 'it', 'test']);
const DYNAMIC = '<dynamic>';

interface Callee {
    block: string;
    each: boolean;
}

// describe('x'), it.only('x'), it.concurrent.skip('x'), it.skipIf(c)('x'), it.each(t)('x'), it.each`...`('x')
function classifyCallee(expr: ts.Expression): Callee | undefined {
    let each = false;
    let e: ts.Expression = expr;
    for (;;) {
        if (ts.isIdentifier(e)) return BLOCKS.has(e.text) ? { block: e.text, each } : undefined;
        if (ts.isPropertyAccessExpression(e)) {
            if (e.name.text === 'each' || e.name.text === 'for') each = true;
            e = e.expression;
        } else if (ts.isCallExpression(e)) {
            e = e.expression;
        } else if (ts.isTaggedTemplateExpression(e)) {
            e = e.tag;
        } else {
            return undefined;
        }
    }
}

// A call such as it.skipIf(c) has a modifier as its callee, not a test: the callee root is `it`
// but the argument is a condition. Only the outermost call that carries the title counts.
function isModifierCall(call: ts.CallExpression): boolean {
    const c = call.expression;
    return ts.isPropertyAccessExpression(c) && ['skipIf', 'runIf', 'each', 'for', 'extend'].includes(c.name.text);
}

export function extractTitles(fileName: string, source: string): Extracted {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const titles: string[] = [];
    let dynamicCount = 0;

    const titleOf = (arg: ts.Expression | undefined): string | undefined => {
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) return arg.text;
        return undefined;
    };

    const visit = (node: ts.Node, ancestors: string[]): void => {
        if (ts.isCallExpression(node) && !isModifierCall(node)) {
            const callee = classifyCallee(node.expression);
            if (callee) {
                const own = callee.each ? undefined : titleOf(node.arguments[0]);
                const label = own === undefined ? DYNAMIC : own;
                const pathParts = [...ancestors, label];
                if (own === undefined || ancestors.includes(DYNAMIC)) {
                    dynamicCount += 1;
                } else if (callee.block !== 'describe') {
                    titles.push(pathParts.join(' > '));
                }
                if (callee.block === 'describe') {
                    for (const a of node.arguments) visit(a, pathParts);
                    return;
                }
            }
        }
        ts.forEachChild(node, (c) => visit(c, ancestors));
    };
    visit(sf, []);
    titles.sort();
    return { titles, dynamicCount };
}

interface ReportAssertion {
    ancestorTitles?: string[];
    title?: string;
    status?: string;
}

interface ReportFile {
    name: string;
    status?: string;
    assertionResults?: ReportAssertion[];
}

interface Edit {
    file: string;
    title_before?: string;
    title_after?: string;
}

interface FileReport {
    titles_at_base: number;
    titles_at_head: number;
    missing: string[];
    renamed: Array<{ title_before: string; title_after: string }>;
    dynamic_at_base: number;
    dynamic_at_head: number;
    dynamic_counts_equal: boolean;
    not_executed: Array<{ title: string; status: string }>;
    not_run_by_design?: boolean;
}

function git(repo: string, args: string[]): string {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function findRepoRoot(start: string): string {
    let d = start;
    for (;;) {
        const pkg = path.join(d, 'package.json');
        if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).name === 'crypto-snipe-bot') return d;
        const up = path.dirname(d);
        if (up === d) throw new Error('package.json named crypto-snipe-bot not found');
        d = up;
    }
}

function walkTests(repo: string): string[] {
    const out: string[] = [];
    const walk = (dir: string, rel: string) => {
        for (const n of fs.readdirSync(dir).sort()) {
            const full = path.join(dir, n);
            const r = `${rel}/${n}`;
            const st = fs.statSync(full);
            if (st.isDirectory()) walk(full, r);
            else if (st.isFile() && n.endsWith('.test.ts')) out.push(r);
        }
    };
    walk(path.join(repo, 'test'), 'test');
    return out;
}

export function compareFile(base: Extracted, head: Extracted, renames: Edit[], statusByTitle: Map<string, string> | undefined, nonPassedInFile: Array<{ title: string; status: string }>): FileReport {
    const headSet = new Set(head.titles);
    const missing: string[] = [];
    const renamed: Array<{ title_before: string; title_after: string }> = [];
    for (const t of base.titles) {
        if (headSet.has(t)) continue;
        const parts = t.split(' > ');
        const own = parts[parts.length - 1];
        const rec = renames.find((e) => e.title_before === own && typeof e.title_after === 'string');
        const after = rec ? [...parts.slice(0, -1), rec.title_after as string].join(' > ') : undefined;
        if (rec && after !== undefined && headSet.has(after)) renamed.push({ title_before: t, title_after: after });
        else missing.push(t);
    }
    const notExecuted: Array<{ title: string; status: string }> = [];
    if (statusByTitle) {
        for (const t of head.titles) {
            const status = statusByTitle.get(t);
            if (status !== 'passed') notExecuted.push({ title: t, status: status || 'absent from report' });
        }
        const seen = new Set(notExecuted.map((n) => n.title));
        for (const n of nonPassedInFile) if (!seen.has(n.title)) notExecuted.push(n);
    }
    return {
        titles_at_base: base.titles.length,
        titles_at_head: head.titles.length,
        missing,
        renamed,
        dynamic_at_base: base.dynamicCount,
        dynamic_at_head: head.dynamicCount,
        dynamic_counts_equal: base.dynamicCount === head.dynamicCount,
        not_executed: notExecuted,
    };
}

function usage(msg: string): never {
    process.stderr.write(`test-identity: ${msg}\nUsage: test-identity.ts --base <sha> --report <vitest json> --out <json> [--ledger <summary.json>]\n`);
    process.exit(2);
}

function main(): void {
    const argv = process.argv.slice(2);
    let base = '';
    let reportPath = '';
    let outPath = '';
    let ledgerPath = '';
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--base') base = argv[++i] || '';
        else if (a === '--report') reportPath = argv[++i] || '';
        else if (a === '--out') outPath = argv[++i] || '';
        else if (a === '--ledger') ledgerPath = argv[++i] || '';
        else usage(`unknown option ${a}`);
    }
    if (!base || !reportPath || !outPath) usage('--base, --report and --out are required');

    const repo = findRepoRoot(__dirname);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as { testResults?: ReportFile[] };
    const byFile = new Map<string, ReportFile>();
    for (const t of report.testResults || []) {
        byFile.set(path.relative(repo, t.name).split(path.sep).join('/'), t);
    }
    const edits = (JSON.parse(fs.readFileSync(path.join(repo, '.planning/audit/inputs/rails-test-edits.json'), 'utf8')) as { entries: Edit[] }).entries;

    const baseFiles = git(repo, ['ls-tree', '-r', '--name-only', base])
        .split('\n')
        .filter((f) => /^test\/.*\.test\.ts$/.test(f))
        .sort();
    const headFiles = walkTests(repo);
    const headSet = new Set(headFiles);

    const files: Record<string, FileReport> = {};
    const missingFiles: string[] = [];
    for (const f of baseFiles) {
        if (!headSet.has(f)) {
            missingFiles.push(f);
            continue;
        }
        const baseEx = extractTitles(f, git(repo, ['show', `${base}:${f}`]));
        const headEx = extractTitles(f, fs.readFileSync(path.join(repo, f), 'utf8'));
        const renames = edits.filter((e) => e.file === f);
        const executed = f.startsWith('test/unit/') || f.startsWith('test/integration/');
        let statusByTitle: Map<string, string> | undefined;
        const nonPassed: Array<{ title: string; status: string }> = [];
        if (executed) {
            const rf = byFile.get(f);
            statusByTitle = new Map();
            for (const a of rf?.assertionResults || []) {
                const key = [...(a.ancestorTitles || []), a.title || ''].join(' > ');
                statusByTitle.set(key, a.status || 'unknown');
                if (a.status !== 'passed') nonPassed.push({ title: key, status: a.status || 'unknown' });
            }
        }
        const rep = compareFile(baseEx, headEx, renames, statusByTitle, nonPassed);
        if (!executed) rep.not_run_by_design = true;
        files[f] = rep;
    }

    const frozen = JSON.parse(fs.readFileSync(path.join(repo, '.planning/audit/inputs/reset-files-base.json'), 'utf8')) as { files: Array<{ path: string; it_count_at_base: number }>; added_in_phase_22: string[] };
    const statusOf = (p: string): string => byFile.get(p)?.status || 'absent from report';
    const frozenNotPassed = frozen.files.filter((x) => statusOf(x.path) !== 'passed').map((x) => ({ path: x.path, status: statusOf(x.path) }));

    let projectsRan: string[] | undefined;
    if (ledgerPath) {
        const s = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) as { projects?: Array<{ project?: string }> };
        projectsRan = (s.projects || []).map((p) => p.project || '').sort();
    }

    const list = Object.values(files);
    const totals = {
        files_at_base: baseFiles.length,
        files_at_head: headFiles.length,
        titles_at_base: list.reduce((n, r) => n + r.titles_at_base, 0),
        titles_at_head_in_base_files: list.reduce((n, r) => n + r.titles_at_head, 0),
        missing: list.reduce((n, r) => n + r.missing.length, 0),
        missing_file: missingFiles.length,
        renamed: list.reduce((n, r) => n + r.renamed.length, 0),
        not_executed: list.reduce((n, r) => n + r.not_executed.length, 0),
        dynamic_mismatch: list.filter((r) => !r.dynamic_counts_equal).length,
        not_run_by_design_files: list.filter((r) => r.not_run_by_design).length,
        frozen_reset_files: frozen.files.length,
        frozen_reset_not_passed: frozenNotPassed.length,
    };

    const doc = {
        base_sha: base,
        head_sha: git(repo, ['rev-parse', 'HEAD']).trim(),
        head_source: 'working tree',
        report_sha256: require('crypto').createHash('sha256').update(fs.readFileSync(reportPath)).digest('hex') as string,
        totals,
        frozen_reset_not_passed: frozenNotPassed,
        added_in_phase_22_status: frozen.added_in_phase_22.map((p) => ({ path: p, status: statusOf(p) })),
        projects_ran: projectsRan ?? null,
        missing_file: missingFiles,
        files,
    };
    fs.writeFileSync(path.resolve(outPath), JSON.stringify(doc, null, 2) + '\n', 'utf8');

    const projectsBad = projectsRan !== undefined && projectsRan.join(',') !== 'integration,unit';
    const bad = totals.missing || totals.missing_file || totals.not_executed || totals.dynamic_mismatch || totals.frozen_reset_not_passed || projectsBad;
    process.stdout.write(`test-identity: ${JSON.stringify(totals)}${projectsRan ? ` projects ${projectsRan.join(',')}` : ''}\n`);
    process.exit(bad ? 1 : 0);
}

try {
    main();
} catch (e) {
    process.stderr.write(`test-identity: crashed: ${e instanceof Error ? e.stack || e.message : String(e)}\n`);
    process.exit(2);
}
