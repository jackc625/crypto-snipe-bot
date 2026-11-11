// test/unit/realpathMockGate.test.ts
// Phase 23 plan 23-02 — CHAR-01 / AC-02: the real-path mock-list gate (scripts/check-realpath-mocks.ts).
//
// Three layers, as for the vi.mock specifier gate (test/unit/viMockGate.test.ts):
//   1. every self-test case, written to a temp folder outside the repo and checked in-process
//      through the exported check, plus independent assertions on what a violation reports;
//   2. the real test/realpath folder passes, and the scan really saw the harness's mocks;
//   3. the gate's own --self-test, run as a program through spawnRailedChild (the only sanctioned
//      spawner, D-03).
// Every snippet below is a string written to disk and read by the gate; none of it runs.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ALLOWED_MODULES,
    REALPATH_ROOT,
    checkRealpathMocks,
    collectRealpathFiles,
    loadAllowList,
    run,
    selfTestCases,
    type RealpathViolation,
} from '../../scripts/check-realpath-mocks';
import { spawnRailedChild } from '../rails/spawnRailedChild';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const posix = (p: string): string => p.split(path.sep).join('/');

/** Write `source` to a fresh temp folder outside the repo and check it. */
function checkSource(source: string): RealpathViolation[] {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realpath-mock-gate-unit-'));
    try {
        const file = path.join(dir, 'case.ts');
        fs.writeFileSync(file, source);
        return checkRealpathMocks([file]).violations;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('AC-02 real-path mock-list gate', () => {
    it('every self-test case gives exactly its expected violations when checked in-process', () => {
        const cases = selfTestCases();
        expect(cases.length).toBeGreaterThanOrEqual(20);
        for (const c of cases) {
            expect(checkSource(c.source).map((v) => v.kind), c.id).toEqual(c.expect);
        }
    });

    it('a vi.mock of src/utils/db is refused, naming the file, line, call and the module it reached (the AC-02 demonstration)', () => {
        const db = posix(path.join(REPO_ROOT, 'src', 'utils', 'db'));
        const [v, ...rest] = checkSource(`import { vi } from 'vitest';\n\nvi.mock('${db}', () => ({ db: {} }));\n`);
        expect(rest).toEqual([]);
        expect(v).toMatchObject({ line: 3, kind: 'forbidden-mock' });
        expect(v.code.startsWith(`vi.mock('${db}'`)).toBe(true);
        expect(v.detail).toContain('src/utils/db.ts');
        expect(v.detail).toContain('not on the AC-02 list');
    });

    it('compares by resolved file, so a relative, an absolute and a bare specifier of an allowed module all pass, and a sibling file does not', () => {
        const logger = posix(path.join(REPO_ROOT, 'src', 'utils', 'logger'));
        expect(checkSource(`import { vi } from 'vitest';\nvi.mock('${logger}');\nvi.mock('${logger}.ts');\n`)).toEqual([]);
        // Another file beside it is another module.
        const repoRoot = posix(REPO_ROOT);
        expect(checkSource(`import { vi } from 'vitest';\nvi.mock('${repoRoot}/src/utils/db.ts');\nvi.mock('${repoRoot}/src/config');\n`).map((v) => v.kind)).toEqual(['forbidden-mock', 'forbidden-mock']);
    });

    it('the allow list is exactly the AC-02 modules, and each resolves to a real file', () => {
        expect(ALLOWED_MODULES.map(([, s]) => s)).toEqual(['./src/utils/logger', './src/utils/notifier', './src/api/ws/broadcaster', 'axios', 'telegram', 'telegram/sessions', 'telegram/events']);
        const allow = loadAllowList();
        expect(allow.byPath.size).toBe(ALLOWED_MODULES.length);
        for (const file of allow.byPath.keys()) expect(fs.statSync(file).isFile()).toBe(true);
    });

    it('passes the real test/realpath folder, and the scan saw the harness mocks in setup.ts', () => {
        const files = collectRealpathFiles(REALPATH_ROOT);
        expect(files.map((f) => posix(path.relative(REPO_ROOT, f)))).toContain('test/realpath/harness/setup.ts');
        const result = checkRealpathMocks(files);
        expect(result.violations).toEqual([]);
        // logger, notifier, broadcaster, axios, telegram, telegram/sessions, telegram/events.
        expect(result.mockCalls).toBeGreaterThanOrEqual(7);
        expect(result.viUses).toBeGreaterThan(result.mockCalls);
    });

    it('exits 2 on bad arguments and on an empty folder, never 0', () => {
        const quiet = { out: (): void => {}, err: (): void => {} };
        expect(run(['--bogus'], quiet)).toBe(2);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realpath-mock-gate-empty-'));
        try {
            expect(run(['--root', dir], quiet)).toBe(2);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it(
        '--self-test passes every case when run as a program',
        () => {
            const result = spawnRailedChild('npx', ['ts-node', 'scripts/check-realpath-mocks.ts', '--self-test'], { timeoutMs: 110_000 });
            const output = `${result.stdout}\n${result.stderr}`;
            expect(result.status, output).toBe(0);
            const total = selfTestCases().length + 1;
            expect(result.stdout).toMatch(/^PASS \(mock-src-db-refused\) /m);
            expect(result.stdout).toMatch(/^PASS \(empty-folder-exits-2\) /m);
            expect(result.stdout).not.toMatch(/^FAIL \(/m);
            expect(result.stdout).toMatch(new RegExp(`^SELF-TEST PASSED: ${total}/${total} cases`, 'm'));
        },
        120_000,
    );
});
