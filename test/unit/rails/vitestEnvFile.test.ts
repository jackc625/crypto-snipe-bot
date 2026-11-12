// test/unit/rails/vitestEnvFile.test.ts
// Phase 22 re-audit finding AUD-REAUDIT-001: a root-level `envDir: false` reaches an inline
// Vitest project only through `extends: true`. Without it, Vite reads the .env files of the
// project root in the Vitest main process, which has no rails.
//
// Behaviour, not a pinned setting: real Vitest runs in a throwaway root that holds a FAKE .env.
// Each decoy project copies the `extends` and `envDir` values of one project of the real config,
// so removing them from a real config fails here. A control project with neither proves the
// fake .env is readable, so a pass cannot be vacuous. The real .env is never named or opened.

import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import mainConfig from '../../../vitest.config';
import rehearsalConfig from '../../rails/vitest.fork-rehearsal.config';
import { REPO_ROOT, spawnRailedChild } from '../../rails/spawnRailedChild';

interface ProjectLike {
    extends?: unknown;
    envDir?: unknown;
    test?: { name?: string };
}
interface ConfigLike {
    envDir?: unknown;
    test?: { projects?: ProjectLike[] };
}

const MARKER = 'fake-env-marker';
const CONTROL = 'control-no-extends';
const CHILD_TIMEOUT_MS = 90_000;
const vitestBin = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');

const PROBE = [
    "import { writeFileSync } from 'node:fs';",
    "it('records what the fake env file exposed', () => {",
    "  writeFileSync(new URL('./result-' + process.env.DECOY_PROJECT + '.txt', import.meta.url), String(import.meta.env.VITE_CSB_FAKE_MARKER));",
    '});',
    '',
].join('\n');

const tempDirs: string[] = [];

afterAll(() => {
    for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function decoyProject(name: string, source: ProjectLike): Record<string, unknown> {
    return {
        ...(source.extends === undefined ? {} : { extends: source.extends }),
        ...(source.envDir === undefined ? {} : { envDir: source.envDir }),
        test: { name, include: ['probe.test.js'], globals: true, environment: 'node', env: { DECOY_PROJECT: name } },
    };
}

function exposedByProject(config: ConfigLike): Record<string, string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-envfile-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, '.env'), `VITE_CSB_FAKE_MARKER=${MARKER}\n`, 'utf8');
    fs.writeFileSync(path.join(dir, 'probe.test.js'), PROBE, 'utf8');

    const realProjects = config.test?.projects ?? [];
    const names = realProjects.map((p) => {
        if (typeof p.test?.name !== 'string') throw new Error('every real project must be named');
        return p.test.name;
    });
    const projects = [...realProjects.map((p, i) => decoyProject(names[i], p)), decoyProject(CONTROL, {})];
    const configPath = path.join(dir, 'vitest.config.mjs');
    fs.writeFileSync(configPath, `export default ${JSON.stringify({ envDir: config.envDir, test: { globals: true, projects } })};\n`, 'utf8');

    const run = spawnRailedChild(process.execPath, [vitestBin, 'run', '--root', dir, '--config', configPath], { timeoutMs: CHILD_TIMEOUT_MS });
    expect(run.status, `decoy Vitest run failed: ${run.stdout}\n${run.stderr}`).toBe(0);

    return Object.fromEntries([...names, CONTROL].map((n) => [n, fs.readFileSync(path.join(dir, `result-${n}.txt`), 'utf8')]));
}

describe('no Vitest config reads the .env files of its root', () => {
    // closes-finding: AUD-RAIL-001 (rail test, RED proof row 30 of red-proofs/INDEX.md: the Vite env-file path of the same event)
    it.each([
        ['vitest.config.ts', mainConfig],
        ['test/rails/vitest.fork-rehearsal.config.ts', rehearsalConfig],
    ])(
        '%s',
        (_label, config) => {
            const cfg = config as unknown as ConfigLike;
            expect(cfg.envDir).toBe(false);
            const { [CONTROL]: control, ...real } = exposedByProject(cfg);
            expect(control, 'the control must read the fake .env, or this test proves nothing').toBe(MARKER);
            expect(Object.keys(real).length).toBeGreaterThan(0);
            for (const [name, value] of Object.entries(real)) expect(value, `project ${name}`).toBe('undefined');
        },
        CHILD_TIMEOUT_MS + 30_000,
    );
});
