// test/unit/ci/workflowLimits.test.ts
//
// Phase 23 review WR-31: every job in .github/workflows/test.yml has a timeout-minutes limit (a
// hung self-test child or a git prompt must not hold a runner for GitHub's 6-hour default), and
// every Python tool the contract jobs install is pinned to an exact version (a re-run must not
// pick up a newer analyzer that changes the --fail-medium result for the same commit).
//
// The workflow is read as text with a small indentation-based reader (no YAML dependency): the
// job keys are the lines indented two spaces under `jobs:`, and a job's own keys are the lines
// indented four spaces inside it. The reader refuses tabs and a missing jobs: block, so a
// layout it cannot read fails here instead of passing.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKFLOW = path.resolve(__dirname, '..', '..', '..', '.github', 'workflows', 'test.yml');

interface Job {
    name: string;
    line: number;
    lines: string[];
}

function readJobs(text: string): Job[] {
    const lines = text.split(/\r?\n/);
    if (lines.some((l) => /^\t| \t/.test(l))) throw new Error('test.yml has tab indentation; the reader cannot read it');
    const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
    if (start < 0) throw new Error('test.yml has no top-level jobs: block');
    const jobs: Job[] = [];
    for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i];
        if (/^\S/.test(l)) break; // the next top-level key ends jobs:
        const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
        if (m) jobs.push({ name: m[1], line: i + 1, lines: [] });
        else if (jobs.length && (/^ {4}/.test(l) || l.trim() === '' || /^\s*#/.test(l))) jobs[jobs.length - 1].lines.push(l);
    }
    return jobs;
}

/** Every package a `pip install` command names (flags and their values dropped; `--upgrade pip` is pip itself). */
function pipPackages(text: string): { line: number; spec: string }[] {
    const out: { line: number; spec: string }[] = [];
    text.split(/\r?\n/).forEach((l, i) => {
        const m = /\bpip3?\s+install\s+(.*)$/.exec(l.replace(/#.*$/, ''));
        if (!m) return;
        for (const tok of m[1].trim().split(/\s+/)) {
            if (tok === '' || tok.startsWith('-')) continue;
            if (tok === 'pip') continue; // pip upgrading itself
            out.push({ line: i + 1, spec: tok });
        }
    });
    return out;
}

describe('WR-31: CI job limits and pinned contract tools', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');

    it('reads the jobs of test.yml (the reader is not blind)', () => {
        const names = readJobs(text).map((j) => j.name);
        expect(names).toEqual(expect.arrayContaining(['test', 'detect-contract-changes', 'hardhat-compile', 'slither', 'mythril']));
    });

    it('every job has a positive whole-number timeout-minutes', () => {
        const missing = readJobs(text).flatMap((j) => {
            const t = j.lines.map((l) => /^ {4}timeout-minutes:\s*(\d+)\s*(#.*)?$/.exec(l)).find(Boolean);
            return t && Number(t[1]) > 0 ? [] : [`${j.name} (line ${j.line})`];
        });
        expect(missing, 'jobs without timeout-minutes').toEqual([]);
    });

    it('every Python package a job installs is pinned to an exact version', () => {
        const pkgs = pipPackages(text);
        // slither-analyzer, solc-select and mythril are installed today: an empty list means the reader is blind.
        expect(pkgs.map((p) => p.spec.split('==')[0])).toEqual(expect.arrayContaining(['slither-analyzer', 'solc-select', 'mythril']));
        expect(pkgs.filter((p) => !/^[A-Za-z0-9._-]+==\d+(\.\d+)*$/.test(p.spec)).map((p) => `line ${p.line}: ${p.spec}`), 'unpinned pip packages').toEqual([]);
    });

    it('the readers catch what the review names: a job with no limit and an unpinned install', () => {
        const sample = 'jobs:\n  a:\n    runs-on: x\n    timeout-minutes: 5\n  b:\n    runs-on: x\n    steps:\n      - run: |\n          pip install --upgrade pip\n          pip install mythril\n';
        const jobs = readJobs(sample);
        expect(jobs.map((j) => [j.name, j.lines.some((l) => /^ {4}timeout-minutes:/.test(l))])).toEqual([
            ['a', true],
            ['b', false],
        ]);
        expect(pipPackages(sample)).toEqual([{ line: 10, spec: 'mythril' }]);
    });
});
