// test/unit/vitestProjectCoverage.test.ts
//
// Phase 23 review WR-30: every test file under test/ belongs to exactly one Vitest project.
// Each project in vitest.config.ts includes only test/<project>/**/*.test.ts, so a file such as
// test/scripts/x.test.ts, test/unit/x.spec.ts, test/unit/x.test.mts or test/unit/x.test.tsx
// matches no project: `npm run test:unit|integration|realpath` never runs it, CI stays green and
// nothing reports it (while the source-text and vi-mock gates scan it, so it looks covered). This
// test lists every *.test.* / *.spec.* file under test/ (Vitest's own default test-file naming)
// and checks it against the include and exclude globs of the LOADED config, fork project
// included. A file in two projects would run twice, so "exactly one" is checked too.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import config from '../../vitest.config';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
/** Vitest's default test-file naming: <name>.test|spec.<ts|js|mts|cts|mjs|cjs>[x]. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const EXPECTED_PROJECTS = ['unit', 'integration', 'realpath', 'fork'];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A Vitest include/exclude glob as a regular expression over a repo-relative path with forward
 * slashes. Only `**`, `*`, `?` and `{a,b}` with literal alternatives are supported; any other glob
 * syntax throws, so the check can never silently misread a pattern.
 */
function globToRegExp(glob: string): RegExp {
    if (/[[\]!()+@\\]/.test(glob)) throw new Error(`unsupported glob syntax in ${JSON.stringify(glob)}`);
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                if (glob[i + 2] === '/') {
                    re += '(?:[^/]+/)*';
                    i += 2;
                } else {
                    re += '.*';
                    i += 1;
                }
            } else re += '[^/]*';
        } else if (c === '?') re += '[^/]';
        else if (c === '{') {
            const j = glob.indexOf('}', i);
            if (j < 0) throw new Error(`unclosed brace in ${JSON.stringify(glob)}`);
            const alts = glob.slice(i + 1, j).split(',');
            if (alts.some((a) => /[*?{]/.test(a))) throw new Error(`unsupported nested glob in braces of ${JSON.stringify(glob)}`);
            re += `(?:${alts.map(escapeRe).join('|')})`;
            i = j;
        } else re += escapeRe(c);
    }
    return new RegExp(`^${re}$`);
}

interface Project {
    name: string;
    include: RegExp[];
    exclude: RegExp[];
}

/** The projects of the loaded config, each with its include and exclude globs. */
function loadProjects(): Project[] {
    const projects = (config as { test?: { projects?: unknown[] } }).test?.projects;
    if (!Array.isArray(projects)) throw new Error('vitest.config.ts has no test.projects list');
    return projects.map((p, i) => {
        if (typeof p !== 'object' || p === null) throw new Error(`test.projects[${i}] is not an inline project (a project in another file cannot be checked here)`);
        const t = (p as { test?: { name?: unknown; include?: unknown; exclude?: unknown } }).test;
        if (!t || typeof t.name !== 'string' || !Array.isArray(t.include) || !t.include.every((g) => typeof g === 'string'))
            throw new Error(`test.projects[${i}] has no test.name and string test.include list`);
        const exclude = t.exclude === undefined ? [] : t.exclude;
        if (!Array.isArray(exclude) || !exclude.every((g) => typeof g === 'string')) throw new Error(`project ${t.name}: test.exclude is not a string list`);
        return { name: t.name, include: (t.include as string[]).map(globToRegExp), exclude: (exclude as string[]).map(globToRegExp) };
    });
}

/** The projects a repo-relative file belongs to. */
function owners(file: string, projects: Project[]): string[] {
    return projects.filter((p) => p.include.some((r) => r.test(file)) && !p.exclude.some((r) => r.test(file))).map((p) => p.name);
}

function listTestFiles(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) listTestFiles(full, out);
        else if (entry.isFile() && TEST_FILE.test(entry.name)) out.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
    }
}

describe('WR-30: every test file under test/ belongs to exactly one Vitest project', () => {
    it('the loaded config has the four projects, each with an include the matcher can read', () => {
        expect(loadProjects().map((p) => p.name)).toEqual(EXPECTED_PROJECTS);
    });

    it('every *.test.* / *.spec.* file under test/ matches exactly one project (no orphan, none run twice)', () => {
        const files: string[] = [];
        listTestFiles(path.join(REPO_ROOT, 'test'), files);
        // An empty or broken walk must not read as clean.
        expect(files.length).toBeGreaterThan(200);
        expect(files).toContain('test/unit/vitestProjectCoverage.test.ts');
        const projects = loadProjects();
        const bad = files.sort().flatMap((f) => {
            const o = owners(f, projects);
            return o.length === 1 ? [] : [`${f} -> ${o.length ? o.join(', ') : 'no project (never runs)'}`];
        });
        expect(bad, 'test files outside exactly one project').toEqual([]);
        for (const name of EXPECTED_PROJECTS) expect(files.some((f) => owners(f, projects)[0] === name), `project ${name} owns a file`).toBe(true);
    });

    it('the matcher reports the orphans the review names, and accepts the files a project includes', () => {
        const projects = loadProjects();
        for (const f of ['test/scripts/x.test.ts', 'test/unit/x.spec.ts', 'test/unit/x.test.mts', 'test/unit/x.test.tsx', 'test/x.test.ts']) expect(owners(f, projects), f).toEqual([]);
        expect(owners('test/unit/a/b/x.test.ts', projects)).toEqual(['unit']);
        expect(owners('test/realpath/x.test.ts', projects)).toEqual(['realpath']);
        expect(owners('test/fork/x.test.ts', projects)).toEqual(['fork']);
        expect(() => globToRegExp('test/[ab]/*.ts')).toThrow(/unsupported glob syntax/);
        expect(globToRegExp('test/{unit,integration}/**/*.test.ts').test('test/integration/x/y.test.ts')).toBe(true);
    });
});
