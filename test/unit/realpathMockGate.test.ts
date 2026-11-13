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
    checkVitestConfig,
    collectReachedFiles,
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
    // The first test in this file pays the cold load of the checker and the TypeScript compiler API it uses, inside
    // its body (testTimeout, not hookTimeout). Measured on Node 22: 0.3 s alone, 2.6 s under the full parallel npm test
    // (wave 9 gate). The explicit limit is headroom.
    it('every self-test case gives exactly its expected violations when checked in-process', { timeout: 20_000 }, () => {
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

    // The scan type-checks every file under test/realpath, so its time grows with that folder.
    // Measured on Node 22 (plan 23-12, 84 files): 1.3 to 1.5 s alone, 5.5 s under the full
    // parallel npm test (over the unit project's 5 s default once 23-12's crash fixtures joined
    // the folder and its child processes loaded the run). The explicit limit is headroom.
    it(
        'passes the real test/realpath folder, and the scan saw the harness mocks in setup.ts',
        () => {
            const files = collectRealpathFiles(REALPATH_ROOT);
            expect(files.map((f) => posix(path.relative(REPO_ROOT, f)))).toContain('test/realpath/harness/setup.ts');
            const result = checkRealpathMocks(files);
            expect(result.violations).toEqual([]);
            // logger, notifier, broadcaster, axios, telegram, telegram/sessions, telegram/events.
            expect(result.mockCalls).toBeGreaterThanOrEqual(7);
            expect(result.viUses).toBeGreaterThan(result.mockCalls);
        },
        20_000,
    );

    // Phase 23 review WR-26: real-path tests run code from outside test/realpath (helpers, rails,
    // setup files), and vitest.config.ts can swap a bot module with no vi call at all.
    describe('WR-26: modules a real-path test reaches, and the realpath project config', () => {
        const db = posix(path.join(REPO_ROOT, 'src', 'utils', 'db'));
        const quietRun = (argv: string[]): { code: number; lines: string[] } => {
            const lines: string[] = [];
            const code = run(argv, { out: (l) => lines.push(l), err: (l) => lines.push(l) });
            return { code, lines };
        };
        /** A temp tree: rel path -> text. */
        const tree = (files: Record<string, string>): string => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realpath-mock-gate-wr26-'));
            for (const [rel, text] of Object.entries(files)) {
                fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
                fs.writeFileSync(path.join(dir, rel), text);
            }
            return dir;
        };
        const TEST_FILE = "import { vi } from 'vitest';\nimport { prep } from '../helpers/prep';\nvi.useFakeTimers();\nprep();\n";

        it('a vi.doMock of src/utils/db in a helper a real-path test imports is refused', { timeout: 20_000 }, () => {
            const dir = tree({
                'test/realpath/x.test.ts': TEST_FILE,
                'test/helpers/prep.ts': `import { vi } from 'vitest';\nexport function prep(): void {\n    vi.doMock('${db}', () => ({}));\n}\n`,
            });
            try {
                const { code, lines } = quietRun(['--root', path.join(dir, 'test', 'realpath')]);
                expect(code, lines.join('\n')).toBe(1);
                expect(lines.some((l) => /prep\.ts:3 forbidden-mock /.test(l)), lines.join('\n')).toBe(true);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });

        it('a mock in a realpath setup file outside the folder, and a second resolve.alias entry, are refused', { timeout: 20_000 }, () => {
            const config = `import path from 'path';\nimport { defineConfig } from 'vitest/config';\nexport default defineConfig({\n    test: {\n        projects: [\n            {\n                extends: true,\n                resolve: {\n                    alias: [\n                        { find: /^ethers$/, replacement: path.resolve(__dirname, 'node_modules/ethers/lib.commonjs/index.js') },\n                        { find: /utils\\/db$/, replacement: path.resolve(__dirname, 'test/fakeDb.ts') },\n                    ],\n                },\n                test: { name: 'realpath', include: ['test/realpath/**/*.test.ts'], setupFiles: ['test/rails2/setup.ts'] },\n            },\n        ],\n    },\n});\n`;
            const dir = tree({
                'vitest.config.ts': config,
                'test/realpath/x.test.ts': "import { vi } from 'vitest';\nvi.useFakeTimers();\n",
                'test/rails2/setup.ts': `import { vi } from 'vitest';\nvi.mock('${db}');\n`,
            });
            try {
                const { code, lines } = quietRun(['--root', path.join(dir, 'test', 'realpath'), '--config', path.join(dir, 'vitest.config.ts')]);
                expect(code, lines.join('\n')).toBe(1);
                expect(lines.some((l) => /setup\.ts:2 forbidden-mock /.test(l)), lines.join('\n')).toBe(true);
                expect(lines.some((l) => / config-alias /.test(l)), lines.join('\n')).toBe(true);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });

        it('the real config passes with exactly the ethers alias, and the scan reaches the rails, the setup files and the shared helpers', { timeout: 20_000 }, () => {
            const cfg = checkVitestConfig(path.join(REPO_ROOT, 'vitest.config.ts'));
            expect(cfg.problems).toEqual([]);
            expect(cfg.setupFiles.map((f) => posix(path.relative(REPO_ROOT, f)))).toEqual(['test/rails/setup.cjs', 'test/realpath/harness/setup.ts']);
            const reached = collectReachedFiles([...collectRealpathFiles(REALPATH_ROOT), ...cfg.setupFiles], loadAllowList().options).map((f) => posix(path.relative(REPO_ROOT, f)));
            for (const f of ['test/rails/setup.cjs', 'test/rails/spawnRailedChild.ts', 'test/helpers/sourceGraph.ts']) expect(reached, f).toContain(f);
            expect(reached.some((f) => f.startsWith('src/') || f.includes('node_modules/')), 'src/ and packages are not scanned').toBe(false);
            const { code, lines } = quietRun([]);
            expect(code, lines.join('\n')).toBe(0);
        });
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
