// .planning/audit/tools/test-identity.ts
//
// Phase 22 / Plan 22-15 (AC-22, NAC-04, T-22-88) - proves the original tests are all still here
// and all still ran. Equal test counts can hide a test that was replaced or renamed, so this
// compares title paths, not counts.
//
// For every test file tracked at <sha> (git ls-tree, read with git show) and every test file in
// the working tree, the TypeScript compiler API extracts the title path of each describe/it/test
// call. A base title missing at HEAD is `missing`, unless a rails-test-edits.json entry for that
// file records it as title_before (then it is `renamed`), or unless it was moved to another file by
// an operator ruling (then it is `moved`, see below). A base file missing at HEAD is
// `missing_file`. From the Vitest JSON report, every HEAD title of a base file under test/unit/
// or test/integration/ must have passed; base files under test/fork/ are compared by title only
// and recorded as not_run_by_design. Titles that are computed at run time (a .each table, a
// template with a substitution) are recorded as dynamic and compared by call count.
//
// A base title absent from its original file is `moved` only when ALL of these hold: a
// rails-test-edits.json entry names the old file, the new file (moved_to) and the title; the title
// exists at HEAD in the new file; and the entry's operator_ruling names an escalation record whose
// operator_response is non-null. Anything else stays `missing`, so a test cannot be relocated
// without a recorded operator decision. A title moved into test/fork/ is not_run_by_design and is
// never counted as executed; a title moved into a file the run covers must have passed.
//
// Usage: test-identity.ts --base <sha> --report <vitest json> --out <json> [--ledger <summary.json>]
//        test-identity.ts --self-test
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

export interface Edit {
    file: string;
    title_before?: string;
    title_after?: string;
    moved_to?: string;
    title?: string;
    operator_ruling?: string;
}

export interface MovedTitle {
    title: string;
    moved_to: string;
    operator_ruling: string;
    run_status: 'not_run_by_design' | 'passed';
}

/** What compareFile needs to judge a recorded move; injected so the self-test uses fabricated inputs. */
export interface MoveFacts {
    edits: Edit[];
    titlesAtHead: (file: string) => Set<string> | undefined;
    operatorResponse: (escalationId: string) => unknown;
    statusInFile: (file: string, title: string) => string | undefined;
}

interface FileReport {
    titles_at_base: number;
    titles_at_head: number;
    missing: string[];
    renamed: Array<{ title_before: string; title_after: string }>;
    moved: MovedTitle[];
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

// The only way a base title may leave its file. Every condition is required; on any doubt, undefined.
export function recordedMove(file: string, title: string, facts: MoveFacts | undefined): Edit | undefined {
    if (!facts) return undefined;
    const rec = facts.edits.find((e) => e.file === file && e.title === title && typeof e.moved_to === 'string' && e.moved_to !== '');
    if (!rec || rec.moved_to === undefined) return undefined;
    if (typeof rec.operator_ruling !== 'string' || !/^ESC-[A-Z0-9]+-\d+$/.test(rec.operator_ruling)) return undefined;
    const response = facts.operatorResponse(rec.operator_ruling);
    if (typeof response !== 'string' || response.trim() === '') return undefined;
    if (!facts.titlesAtHead(rec.moved_to)?.has(title)) return undefined;
    return rec;
}

export function compareFile(base: Extracted, head: Extracted, renames: Edit[], statusByTitle: Map<string, string> | undefined, nonPassedInFile: Array<{ title: string; status: string }>, file = '', moveFacts?: MoveFacts): FileReport {
    const headSet = new Set(head.titles);
    const missing: string[] = [];
    const renamed: Array<{ title_before: string; title_after: string }> = [];
    const moved: MovedTitle[] = [];
    const movedNotExecuted: Array<{ title: string; status: string }> = [];
    for (const t of base.titles) {
        if (headSet.has(t)) continue;
        const parts = t.split(' > ');
        const own = parts[parts.length - 1];
        const rec = renames.find((e) => e.title_before === own && typeof e.title_after === 'string');
        const after = rec ? [...parts.slice(0, -1), rec.title_after as string].join(' > ') : undefined;
        if (rec && after !== undefined && headSet.has(after)) {
            renamed.push({ title_before: t, title_after: after });
            continue;
        }
        const move = recordedMove(file, t, moveFacts);
        if (!move || move.moved_to === undefined || move.operator_ruling === undefined) {
            missing.push(t);
            continue;
        }
        if (move.moved_to.startsWith('test/fork/')) {
            moved.push({ title: t, moved_to: move.moved_to, operator_ruling: move.operator_ruling, run_status: 'not_run_by_design' });
            continue;
        }
        moved.push({ title: t, moved_to: move.moved_to, operator_ruling: move.operator_ruling, run_status: 'passed' });
        const status = moveFacts?.statusInFile(move.moved_to, t);
        if (status !== 'passed') movedNotExecuted.push({ title: `${move.moved_to}: ${t}`, status: status || 'absent from report' });
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
    notExecuted.push(...movedNotExecuted);
    return {
        titles_at_base: base.titles.length,
        titles_at_head: head.titles.length,
        missing,
        renamed,
        moved,
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

function selfTest(): number {
    const TITLE = 'suite > the moved test';
    const src = (...its: string[]) => `describe('suite', () => { ${its.map((n) => `it('${n}', () => {});`).join(' ')} });`;
    const baseEx = extractTitles('a.test.ts', src('kept', 'the moved test'));
    const headEx = extractTitles('a.test.ts', src('kept'));
    const OLD = 'test/integration/a.test.ts';
    const FORK = 'test/fork/a.fork.test.ts';
    const INT = 'test/integration/b.test.ts';
    const good: Edit = { file: OLD, moved_to: FORK, title: TITLE, operator_ruling: 'ESC-RAILS-01' };
    const facts = (over: Partial<MoveFacts>): MoveFacts => ({
        edits: [good],
        titlesAtHead: () => new Set([TITLE]),
        operatorResponse: () => 'b',
        statusInFile: () => 'passed',
        ...over,
    });
    const run = (f: MoveFacts | undefined) => compareFile(baseEx, headEx, [], new Map([['suite > kept', 'passed']]), [], OLD, f);
    const results: Array<[string, boolean]> = [];
    const rec = (label: string, ok: boolean) => results.push([label, ok]);
    const isMissing = (r: FileReport) => r.missing.length === 1 && r.missing[0] === TITLE && r.moved.length === 0;

    const ok = run(facts({}));
    rec('recorded, ruled move -> moved', ok.missing.length === 0 && ok.moved.length === 1 && ok.moved[0].moved_to === FORK);
    rec('a title moved to test/fork/ is not_run_by_design and never counted as executed', ok.moved[0]?.run_status === 'not_run_by_design' && ok.not_executed.length === 0);
    rec('no facts at all -> missing', isMissing(run(undefined)));
    rec('an unrecorded move (no edit entry) -> missing', isMissing(run(facts({ edits: [] }))));
    rec('an entry for another file -> missing', isMissing(run(facts({ edits: [{ ...good, file: 'test/integration/other.test.ts' }] }))));
    rec('an entry for another title -> missing', isMissing(run(facts({ edits: [{ ...good, title: 'suite > something else' }] }))));
    rec('an entry with no new file -> missing', isMissing(run(facts({ edits: [{ ...good, moved_to: undefined }] }))));
    rec('an entry with no operator_ruling -> missing', isMissing(run(facts({ edits: [{ ...good, operator_ruling: undefined }] }))));
    rec('an operator_ruling that is not a record id -> missing', isMissing(run(facts({ edits: [{ ...good, operator_ruling: '../../etc' }] }))));
    rec('a record whose operator_response is null -> missing', isMissing(run(facts({ operatorResponse: () => null }))));
    rec('a record whose operator_response is empty -> missing', isMissing(run(facts({ operatorResponse: () => '  ' }))));
    rec('a named record that does not exist -> missing', isMissing(run(facts({ operatorResponse: () => undefined }))));
    rec('the title absent from the new file -> missing', isMissing(run(facts({ titlesAtHead: () => new Set(['suite > other']) }))));
    rec('the new file absent at HEAD -> missing', isMissing(run(facts({ titlesAtHead: () => undefined }))));
    const toInt = run(facts({ edits: [{ ...good, moved_to: INT }], statusInFile: () => 'failed' }));
    rec('a title moved into a run file that did not pass -> not_executed', toInt.missing.length === 0 && toInt.moved.length === 1 && toInt.not_executed.length === 1 && toInt.not_executed[0].status === 'failed');
    const toIntOk = run(facts({ edits: [{ ...good, moved_to: INT }] }));
    rec('a title moved into a run file that passed -> moved, executed', toIntOk.moved[0]?.run_status === 'passed' && toIntOk.not_executed.length === 0);

    let pass = true;
    for (const [label, passed] of results) {
        if (!passed) pass = false;
        process.stdout.write(`test-identity self-test: ${passed ? 'PASS' : 'FAIL'} - ${label}\n`);
    }
    process.stdout.write(`test-identity self-test: ${pass ? 'PASS' : 'FAIL'} (${results.filter((r) => r[1]).length}/${results.length})\n`);
    return pass ? 0 : 1;
}

function main(): void {
    const argv = process.argv.slice(2);
    if (argv.length === 1 && argv[0] === '--self-test') process.exit(selfTest());
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
    const statusIn = (file: string, title: string): string | undefined => {
        for (const a of byFile.get(file)?.assertionResults || []) {
            if ([...(a.ancestorTitles || []), a.title || ''].join(' > ') === title) return a.status || 'unknown';
        }
        return undefined;
    };

    const baseFiles = git(repo, ['ls-tree', '-r', '--name-only', base])
        .split('\n')
        .filter((f) => /^test\/.*\.test\.ts$/.test(f))
        .sort();
    const headFiles = walkTests(repo);
    const headSet = new Set(headFiles);
    const moveFacts: MoveFacts = {
        edits,
        titlesAtHead: (file) => (headSet.has(file) ? new Set(extractTitles(file, fs.readFileSync(path.join(repo, file), 'utf8')).titles) : undefined),
        operatorResponse: (id) => {
            const p = path.join(repo, '.planning/audit/escalations', `${id}.json`);
            if (!fs.existsSync(p)) return undefined;
            return (JSON.parse(fs.readFileSync(p, 'utf8')) as { operator_response?: unknown }).operator_response;
        },
        statusInFile: statusIn,
    };

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
        const rep = compareFile(baseEx, headEx, renames, statusByTitle, nonPassed, f, moveFacts);
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
        moved: list.reduce((n, r) => n + r.moved.length, 0),
        moved_not_run_by_design: list.reduce((n, r) => n + r.moved.filter((m) => m.run_status === 'not_run_by_design').length, 0),
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
