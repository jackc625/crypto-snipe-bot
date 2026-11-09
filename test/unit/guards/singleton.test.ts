// test/unit/guards/singleton.test.ts
//
// Phase 22 plan 22-12 — SAFE-03 AC-20 / D-05: a second load of a lock or registry module in one
// process throws SINGLETON_DUPLICATE, and a normal load or a whole-graph reset does not.
// Runs against the real modules and the real guard; nothing here mocks the mechanism.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';

import { REPO_ROOT, spawnRailedChild } from '../../rails/spawnRailedChild';

const PROBE = 'test/rails/probes/duplicateLoadProbe.cjs';
const IS_WIN = process.platform === 'win32';
const RESULT_LINE = /^(THREW|OTHER_ERROR|LOADED_TWICE|LOADED_ONCE|NOALIAS)\b.*$/m;
const TEST_TIMEOUT_MS = 180_000;
const CHILD_TIMEOUT_MS = 170_000;

interface GuardedModule {
    name: string;
    relPath: string;
    aliasBase: string;
    load: () => Promise<unknown>;
    loadAlias: () => Promise<unknown>;
}

const GUARDED_MODULES: GuardedModule[] = [
    {
        name: 'nonceAuthority',
        relPath: 'src/utils/nonceAuthority.ts',
        aliasBase: 'NonceAuthority.ts',
        load: () => import('../../../src/utils/nonceAuthority'),
        loadAlias: () => import('../../../src/utils/NonceAuthority'),
    },
    {
        name: 'exitManager',
        relPath: 'src/utils/exitManager.ts',
        aliasBase: 'ExitManager.ts',
        load: () => import('../../../src/utils/exitManager'),
        loadAlias: () => import('../../../src/utils/ExitManager'),
    },
    {
        name: 'exitEngine',
        relPath: 'src/exitEngine.ts',
        aliasBase: 'ExitEngine.ts',
        load: () => import('../../../src/exitEngine'),
        loadAlias: () => import('../../../src/ExitEngine'),
    },
    {
        name: 'antiRugDetector',
        relPath: 'src/anti-rug/detector.ts',
        aliasBase: 'Detector.ts',
        load: () => import('../../../src/anti-rug/detector'),
        loadAlias: () => import('../../../src/anti-rug/Detector'),
    },
];

interface DuplicateError {
    code?: string;
    canonicalPath?: string;
    firstIdentity?: string;
    secondIdentity?: string;
}

function runProbe(mode: string, relPaths: string[], nodeOptions: string[] = []): { line: string; detail: string } {
    const result = spawnRailedChild(process.execPath, [PROBE, mode, ...relPaths], { nodeOptions, timeoutMs: CHILD_TIMEOUT_MS });
    const line = result.stdout.match(RESULT_LINE)?.[0]?.trim() ?? '';
    return { line, detail: `probe line: ${JSON.stringify(line)}; exit ${result.status}; stderr: ${result.stderr.slice(0, 2000)}` };
}

describe('duplicate-load guard: normal boot shape', () => {
    it(
        'plain Node: all four guarded modules load once each in one process, dependents first',
        () => {
            const paths = ['src/exitEngine.ts', 'src/anti-rug/detector.ts', 'src/utils/exitManager.ts', 'src/utils/nonceAuthority.ts'];
            const { line, detail } = runProbe('single', paths);
            expect(line, detail).toBe('LOADED_ONCE');
        },
        TEST_TIMEOUT_MS,
    );
});

describe.each(GUARDED_MODULES)('duplicate-load guard: $name', (mod) => {
    const realAbs = path.join(REPO_ROOT, ...mod.relPath.split('/'));

    beforeEach(() => {
        vi.resetModules();
    });

    it(
        'a casing alias in the same module graph is refused with the alias named',
        async () => {
            await mod.load();
            const outcome = await mod.loadAlias().then(
                () => ({ resolved: true, err: undefined }),
                (err: DuplicateError) => ({ resolved: false, err }),
            );
            expect(outcome.resolved).toBe(false);
            if (IS_WIN) {
                expect(outcome.err?.code).toBe('SINGLETON_DUPLICATE');
                expect(path.basename(String(outcome.err?.secondIdentity))).toBe(mod.aliasBase);
                expect(path.basename(String(outcome.err?.firstIdentity))).toBe(path.basename(realAbs));
                expect(path.basename(String(outcome.err?.canonicalPath))).toBe(path.basename(realAbs));
            } else {
                expect(outcome.err?.code).not.toBe('SINGLETON_DUPLICATE');
            }
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'a vi.resetModules re-import is allowed, and really evaluates the module again in a new epoch',
        async () => {
            const firstEpoch = (await import('../../../src/guards/epoch')).EPOCH;
            const first = await mod.load();
            vi.resetModules();
            const secondEpoch = (await import('../../../src/guards/epoch')).EPOCH;
            const second = await mod.load();
            expect(second).not.toBe(first);
            expect(secondEpoch).not.toBe(firstEpoch);
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'a vi.doMock plus vi.resetModules re-import is allowed',
        async () => {
            await mod.load();
            vi.resetModules();
            vi.doMock('../../../src/utils/retry', async (importOriginal) => await importOriginal());
            try {
                await expect(mod.load()).resolves.toBeDefined();
            } finally {
                vi.doUnmock('../../../src/utils/retry');
            }
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'plain Node: one normal load is not refused',
        () => {
            const { line, detail } = runProbe('single', [mod.relPath]);
            expect(line, detail).toBe('LOADED_ONCE');
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'plain Node: a casing alias is refused and names the alias',
        () => {
            const { line, detail } = runProbe('casing', [mod.relPath]);
            if (IS_WIN) {
                expect(line, detail).toBe(`THREW SINGLETON_DUPLICATE ${path.join(path.dirname(realAbs), mod.aliasBase)}`);
            } else {
                expect(line, detail).toMatch(/^NOALIAS /);
            }
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'plain Node: a directory junction or symlink alias under --preserve-symlinks is refused and names the alias',
        () => {
            const { line, detail } = runProbe('junction', [mod.relPath], ['--preserve-symlinks']);
            expect(line, detail).toMatch(/^THREW SINGLETON_DUPLICATE /);
            const identity = line.slice('THREW SINGLETON_DUPLICATE '.length);
            expect(identity, detail).toContain('csb-dup-probe-');
            expect(path.basename(identity), detail).toBe(path.basename(realAbs));
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'plain Node: delete require.cache and reload is refused',
        () => {
            const { line, detail } = runProbe('cache', [mod.relPath]);
            expect(line, detail).toBe(`THREW SINGLETON_DUPLICATE ${realAbs}`);
        },
        TEST_TIMEOUT_MS,
    );
});
