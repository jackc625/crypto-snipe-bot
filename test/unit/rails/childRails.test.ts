// test/unit/rails/childRails.test.ts
// Phase 22 plan 22-08 Task 2 — SAFE-02 D-03: railed child processes, the spawn limits of the
// only sanctioned spawner, the per-project Vitest wiring, and (SPEC R4 / AC-17) the
// Hardhat-free proof that fork mode keeps exactly the two fork shell keys a fork test reads
// in-worker. Imports only test infrastructure and node/npm modules — nothing from src/.
//
// Every planted fork-shell value is a dead 127.0.0.1 marker; nothing connects to it. Telegram
// is checked through the pure classifyHost predicate only.

import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import vitestConfig from '../../../vitest.config';
import { spawnRailedChild, spawnRailedChildAsync, checkSpawnLimits, readSentinels, type SpawnRailedOptions } from '../../rails/spawnRailedChild';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = req('../../rails/core.cjs') as {
    railsStatus(): { installed: boolean; runId: string };
    FORK_SHELL_KEYS: readonly string[];
};

const sentinels = readSentinels();
const PROBE = 'test/rails/probes/childProbe.cjs';
const CHILD_MS = 30_000;

interface ProbeOut {
    rails: { installed: boolean; mode: string | null; netDenyInstalled: boolean; telegramDenyInstalled: boolean };
    env: { TELEGRAM_BOT_TOKEN: string | null; PRIVATE_KEY: string | null; DASHBOARD_API_KEY: string | null; VITEST: string | null };
    netConnect192: string;
    telegramClass: string;
    fakeDbOpen: string;
    fakeDbCreated: boolean;
    fakeDataRead: string;
    runId: string | null;
    forkShell: { ETH_FORK_RPC_URL: string | null; ALLOW_REAL_MAINNET: string | null; ALCHEMY_URL: string | null; forkShellKeys: Record<string, string> | null };
    ledger: { kinds: string[]; envOverrideTargets: unknown[] };
    dotenvGate?: string;
    rewriteReinstall?: string;
}

function probe(opts: SpawnRailedOptions = {}, flags: string[] = []): ProbeOut {
    const r = spawnRailedChild(process.execPath, [PROBE, ...flags], { timeoutMs: CHILD_MS, ...opts });
    const line = r.stdout.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
    if (r.status !== 0 || !line) throw new Error(`childProbe failed (status ${r.status}): ${r.stderr.slice(0, 2000)}`);
    return JSON.parse(line) as ProbeOut;
}

describe('railed child processes (D-03)', () => {
    // closes-finding: AUD-TESTI-011 (rail test for its railed-child reach, RED proof row 5 of red-proofs/INDEX.md)
    it('a child sees the sentinel token, full rails, VITEST, the 192.0.2.1 deny, the data deny and the parent run id', () => {
        const saved = process.env.TELEGRAM_BOT_TOKEN;
        let out: ProbeOut;
        try {
            process.env.TELEGRAM_BOT_TOKEN = 'planted-parent-token';
            out = probe();
        } finally {
            if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
            else process.env.TELEGRAM_BOT_TOKEN = saved;
        }
        expect(out.env.TELEGRAM_BOT_TOKEN).toBe(sentinels.TELEGRAM_BOT_TOKEN);
        expect(out.env.PRIVATE_KEY).toBe(sentinels.PRIVATE_KEY);
        expect(out.rails.installed).toBe(true);
        expect(out.rails.mode).toBe('full');
        expect(out.env.VITEST).toBe('true');
        expect(out.netConnect192).toBe('denied');
        expect(out.fakeDataRead).toBe('denied');
        expect(out.fakeDbOpen).toBe('denied');
        expect(out.fakeDbCreated).toBe(false);
        expect(out.telegramClass).toBe('telegram');
        expect(out.runId).toBe(core.railsStatus().runId);
    }, CHILD_MS);

    it("envOverrides {DASHBOARD_API_KEY: ''} reaches the child and is ledgered by key only", () => {
        const out = probe({ envOverrides: { DASHBOARD_API_KEY: '' } });
        expect(out.env.DASHBOARD_API_KEY).toBe('');
        expect(out.ledger.kinds).toContain('env-override');
        expect(out.ledger.envOverrideTargets).toEqual([{ key: 'DASHBOARD_API_KEY' }]);
    }, CHILD_MS);

    it('the preload reaches a ts-node process started through npx --no ts-node (Pattern 4)', () => {
        const r = spawnRailedChild('npx', ['ts-node', 'test/rails/probes/tsProbe.ts'], { timeoutMs: 90_000 });
        const line = r.stdout.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
        expect(line, r.stderr.slice(0, 2000)).toBeDefined();
        const out = JSON.parse(line as string) as { tsProbe: boolean; installed: boolean; mode: string };
        expect(out.tsProbe).toBe(true);
        expect(out.installed).toBe(true);
        expect(out.mode).toBe('full');
    }, 90_000);

    it("a railsEntry 'setup-fork' child runs fork mode: network deny off, Telegram deny on, sentinel env, DB denied", () => {
        const out = probe({ railsEntry: 'setup-fork' });
        expect(out.rails.installed).toBe(true);
        expect(out.rails.mode).toBe('fork');
        expect(out.rails.netDenyInstalled).toBe(false);
        expect(out.rails.telegramDenyInstalled).toBe(true);
        expect(out.netConnect192).toBe('skipped');
        expect(out.telegramClass).toBe('telegram');
        expect(out.env.TELEGRAM_BOT_TOKEN).toBe(sentinels.TELEGRAM_BOT_TOKEN);
        expect(out.fakeDbOpen).toBe('denied');
        expect(out.fakeDataRead).toBe('denied');
    }, CHILD_MS);
});

describe('vitest.config.ts rails wiring', () => {
    it('unit and integration load setup.cjs; fork loads setup-fork.cjs', () => {
        const projects = (vitestConfig as { test?: { projects?: Array<{ test?: { name?: string; setupFiles?: string[] } }> } }).test?.projects ?? [];
        const byName = new Map(projects.map((p) => [p.test?.name, p.test?.setupFiles]));
        expect(byName.get('unit')).toEqual(['test/rails/setup.cjs']);
        expect(byName.get('integration')).toEqual(['test/rails/setup.cjs']);
        expect(byName.get('fork')).toEqual(['test/rails/setup-fork.cjs']);
    });
});

// The `--env-file` case always names a NON-EXISTENT temp path, never the real .env, so even a
// broken guard could not load anything. These cases call the pure checkSpawnLimits, which never
// spawns, so a neutralised check (RED proof 22-08-8) cannot start a forbidden child.
describe('spawn limits', () => {
    const noEnvFile = path.join(os.tmpdir(), 'csb-no-such-file.env');
    const cases: Array<[string, string, () => void]> = [
        ['inheritedEnv NODE_OPTIONS', 'inheritedEnv', () => checkSpawnLimits(process.execPath, ['-e', '0'], { inheritedEnv: { NODE_OPTIONS: '' } })],
        ['inheritedEnv VITEST', 'inheritedEnv', () => checkSpawnLimits(process.execPath, ['-e', '0'], { inheritedEnv: { VITEST: '' } })],
        ['envOverrides NODE_OPTIONS', 'envOverrides', () => checkSpawnLimits(process.execPath, ['-e', '0'], { envOverrides: { NODE_OPTIONS: 'x' } })],
        ['nodeOptions --require', 'nodeOptions', () => checkSpawnLimits(process.execPath, ['-e', '0'], { nodeOptions: ['--require', 'x'] })],
        ['--env-file argument', 'env-file', () => checkSpawnLimits(process.execPath, ['--env-file=' + noEnvFile, '-e', '0'])],
        ['data/ path argument', 'path', () => checkSpawnLimits(process.execPath, ['data/bot.db'])],
        ['non-Node command', 'command', () => checkSpawnLimits('cmd.exe', ['/c', 'echo'])],
        ['home outside tmpdir', 'homeOverride', () => checkSpawnLimits(process.execPath, ['-e', '0'], { homeOverride: 'C:/' })],
        ['-r of a non-ts-node module', 'require', () => checkSpawnLimits(process.execPath, ['-r', './x.cjs', '-e', '0'])],
        ['--import of a module', 'require', () => checkSpawnLimits(process.execPath, ['--import=./x.mjs', '-e', '0'])],
        ['repo .env path argument', 'path', () => checkSpawnLimits(process.execPath, ['./.env'])],
        ['inheritedEnv CSB_RAIL_RUN_ID', 'inheritedEnv', () => checkSpawnLimits(process.execPath, ['-e', '0'], { inheritedEnv: { CSB_RAIL_RUN_ID: 'x' } })],
        ['inheritedEnv PATH', 'inheritedEnv', () => checkSpawnLimits(process.execPath, ['-e', '0'], { inheritedEnv: { PATH: 'x' } })],
        ['envOverrides of a non-sentinel key', 'envOverrides', () => checkSpawnLimits(process.execPath, ['-e', '0'], { envOverrides: { NOT_A_SENTINEL_KEY: 'x' } })],
    ];
    for (const [label, limit, fn] of cases) {
        it(`refuses ${label} [limit: ${limit}]`, () => {
            expect(fn).toThrow(`[limit: ${limit}]`);
        });
    }

    it('allows ts-node/register and the enumerated harmless Node flags', () => {
        expect(() => checkSpawnLimits(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', '0'], { nodeOptions: ['--expose-gc', '--max-old-space-size=256', '--no-warnings'] })).not.toThrow();
        expect(() => checkSpawnLimits('npx', ['ts-node', 'test/rails/probes/tsProbe.ts'], { homeOverride: path.join(os.tmpdir(), 'csb-home') })).not.toThrow();
    });
});

describe('spawn wiring', () => {
    it('spawnRailedChild and spawnRailedChildAsync refuse before spawning', () => {
        expect(() => spawnRailedChild('cmd.exe', ['/c', 'exit', '0'])).toThrow('[limit: command]');
        expect(() => spawnRailedChildAsync('cmd.exe', ['/c', 'exit', '0'])).toThrow('[limit: command]');
    });
});

describe('fork shell keys (SPEC R4 / AC-17)', () => {
    const planted = {
        ETH_FORK_RPC_URL: 'http://127.0.0.1:9/fork-shell-marker',
        ALLOW_REAL_MAINNET: '1',
        ALCHEMY_URL: 'http://127.0.0.1:9/provider-planted',
        TELEGRAM_BOT_TOKEN: 'planted-not-sentinel',
    };

    it('(i) setup-fork keeps the planted fork URL and ALLOW_REAL_MAINNET; ALCHEMY_URL and the token become sentinels', () => {
        const out = probe({ railsEntry: 'setup-fork', inheritedEnv: planted });
        expect(out.rails.mode).toBe('fork');
        expect(out.forkShell.ETH_FORK_RPC_URL).toBe(planted.ETH_FORK_RPC_URL);
        expect(out.forkShell.ALLOW_REAL_MAINNET).toBe('1');
        expect(out.forkShell.ALCHEMY_URL).toBe(sentinels.ALCHEMY_URL);
        expect(out.env.TELEGRAM_BOT_TOKEN).toBe(sentinels.TELEGRAM_BOT_TOKEN);
        expect(out.forkShell.forkShellKeys).toEqual({ ETH_FORK_RPC_URL: 'preserved', ALLOW_REAL_MAINNET: 'preserved' });
    }, CHILD_MS);

    it('(ii) the same planted values under the full preload end as sentinels', () => {
        const out = probe({ inheritedEnv: planted });
        expect(out.rails.mode).toBe('full');
        expect(out.forkShell.ETH_FORK_RPC_URL).toBe(sentinels.ETH_FORK_RPC_URL);
        expect(out.forkShell.ALLOW_REAL_MAINNET).toBe('');
        expect(out.forkShell.ALCHEMY_URL).toBe(sentinels.ALCHEMY_URL);
        expect(out.env.TELEGRAM_BOT_TOKEN).toBe(sentinels.TELEGRAM_BOT_TOKEN);
        expect(out.forkShell.forkShellKeys).toEqual({ ETH_FORK_RPC_URL: 'scrubbed', ALLOW_REAL_MAINNET: 'scrubbed' });
    }, CHILD_MS);

    it('(iii) setup-fork with nothing planted: ETH_FORK_RPC_URL absent, ALLOW_REAL_MAINNET empty', () => {
        const out = probe({ railsEntry: 'setup-fork' });
        expect(out.forkShell.ETH_FORK_RPC_URL).toBeNull();
        expect(out.forkShell.ALLOW_REAL_MAINNET).toBe('');
        expect(out.forkShell.forkShellKeys).toEqual({ ETH_FORK_RPC_URL: 'absent', ALLOW_REAL_MAINNET: 'absent' });
    }, CHILD_MS);

    it('(iv) a protected-root .env with ALLOW_REAL_MAINNET=1 cannot open the gate even through dotenv override', () => {
        const out = probe({ railsEntry: 'setup-fork' }, ['--dotenv-gate']);
        expect(out.dotenvGate).toBe('attempted');
        expect(out.forkShell.ETH_FORK_RPC_URL).toBeNull();
        expect(out.forkShell.ALLOW_REAL_MAINNET).toBe('');
        expect(out.ledger.kinds).toContain('env-read-blocked');
    }, CHILD_MS);

    it('(v) a test-written value followed by a re-install is reset to the first-captured value', () => {
        const kept = probe({ railsEntry: 'setup-fork', inheritedEnv: planted }, ['--rewrite-reinstall']);
        expect(kept.rewriteReinstall).toBe('attempted');
        expect(kept.forkShell.ETH_FORK_RPC_URL).toBe(planted.ETH_FORK_RPC_URL);
        expect(kept.forkShell.ALLOW_REAL_MAINNET).toBe('1');
        // With nothing captured from the shell, the test-written values are reset too, which
        // also proves the ALLOW_REAL_MAINNET reset (its planted and test-written values match above).
        const none = probe({ railsEntry: 'setup-fork' }, ['--rewrite-reinstall']);
        expect(none.rewriteReinstall).toBe('attempted');
        expect(none.forkShell.ETH_FORK_RPC_URL).toBeNull();
        expect(none.forkShell.ALLOW_REAL_MAINNET).toBe('');
    }, CHILD_MS * 2);

    it('(vi) core.FORK_SHELL_KEYS is exactly [ETH_FORK_RPC_URL, ALLOW_REAL_MAINNET]', () => {
        expect([...core.FORK_SHELL_KEYS]).toEqual(['ETH_FORK_RPC_URL', 'ALLOW_REAL_MAINNET']);
    });

    it('(vii) spawnRailedChild refuses inheritedEnv NODE_OPTIONS or VITEST before spawning', () => {
        expect(() => spawnRailedChild(process.execPath, ['-e', '0'], { inheritedEnv: { NODE_OPTIONS: '' } })).toThrow('[limit: inheritedEnv]');
        expect(() => spawnRailedChild(process.execPath, ['-e', '0'], { inheritedEnv: { VITEST: '' } })).toThrow('[limit: inheritedEnv]');
    });
});
