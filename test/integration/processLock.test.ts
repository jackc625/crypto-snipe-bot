// test/integration/processLock.test.ts
//
// Phase 22 plan 22-13 (SAFE-04, AC-23, NAC-07, STL-5): the single-instance lock proven with
// real child processes that take the real lock. No case loads src/bot.ts or src/main.ts, and
// every lock lives in a temp folder (or under a temp fake home), never the real one.

import { afterEach, describe, expect, it } from 'vitest';
import { computeAddress } from 'ethers';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { killProcessTree, readSentinels, REPO_ROOT, spawnRailedChild, spawnRailedChildAsync, type SpawnRailedOptions } from '../rails/spawnRailedChild';
import { tryAcquireThenRelease } from '../../src/utils/processLock';
import { loadRepoModules, modulesExporting, reachable } from '../helpers/sourceGraph';

const TEST_TIMEOUT_MS = 120_000;
const LONG_TEST_TIMEOUT_MS = 300_000;
const WAIT_MS = 45_000;
const ROUNDS = 10;
const CONTENDERS = 6;
const FIXTURE = 'test/integration/fixtures/lockHolder.ts';

const ADDRESS = computeAddress(readSentinels().PRIVATE_KEY).toLowerCase();

class Proc {
    readonly lines: string[] = [];
    readonly exited: Promise<number | null>;
    exitCode: number | null | undefined = undefined;
    stderr = '';
    readonly pid: number;
    private buffered = '';

    constructor(args: string[], opts: SpawnRailedOptions = {}) {
        const child = spawnRailedChildAsync(process.execPath, ['-r', 'ts-node/register/transpile-only', FIXTURE, ...args], { timeoutMs: 110_000, ...opts });
        this.pid = child.pid as number;
        child.stdout?.on('data', (chunk: Buffer) => {
            this.buffered += chunk.toString('utf8');
            const parts = this.buffered.split(/\r?\n/);
            this.buffered = parts.pop() ?? '';
            this.lines.push(...parts.filter((l) => l !== ''));
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            this.stderr += chunk.toString('utf8');
        });
        this.exited = new Promise((resolve) => {
            child.once('close', (code) => {
                this.exitCode = code;
                resolve(code);
            });
        });
    }

    get alive(): boolean {
        return this.exitCode === undefined;
    }

    find(prefix: string): string | undefined {
        return this.lines.find((l) => l.startsWith(prefix));
    }

    /** Milliseconds field of a `WORD <ms>` or `REFUSED <code> <ms>` line. */
    ms(prefix: string): number {
        const line = this.find(prefix);
        if (line === undefined) throw new Error(`no ${prefix} line in ${JSON.stringify(this.lines)}`);
        return Number(line.split(' ').pop());
    }

    async waitForLine(prefix: string, timeoutMs = WAIT_MS): Promise<string> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const line = this.find(prefix);
            if (line !== undefined) return line;
            if (!this.alive) throw new Error(`process exited (${String(this.exitCode)}) before ${prefix}: ${JSON.stringify(this.lines)} stderr: ${this.stderr}`);
            if (Date.now() > deadline) throw new Error(`timed out waiting for ${prefix}: ${JSON.stringify(this.lines)} stderr: ${this.stderr}`);
            await new Promise((r) => setTimeout(r, 10));
        }
    }
}

const running: Proc[] = [];
const tempDirs: string[] = [];

function start(args: string[], opts: SpawnRailedOptions = {}): Proc {
    const p = new Proc(args, opts);
    running.push(p);
    return p;
}

async function waitUntil(condition: () => boolean, timeoutMs = WAIT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
        await new Promise((r) => setTimeout(r, 10));
    }
}

function tempDir(prefix: string): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(d);
    return d;
}

afterEach(async () => {
    for (const p of running.splice(0)) {
        if (p.alive) {
            killProcessTree(p.pid);
            await p.exited;
        }
    }
    for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('SAFE-04 single-instance process lock (real holder processes)', () => {
    // closes-finding: AUD-TX-005 (rail test, RED proof row 25 of red-proofs/INDEX.md; re-run by 23-14 as 23-14-2-lock-refusal.txt)
    it(
        'a second acquire for the same wallet is refused while the holder lives (AC-23a)',
        async () => {
            const lockDir = tempDir('csb-lock-a-');
            const holder = start([lockDir, ADDRESS]);
            await holder.waitForLine('ACQUIRED');

            const contender = start([lockDir, ADDRESS, '--hold-ms', '0']);
            expect(await contender.exited).toBe(1);
            expect(contender.find('REFUSED PROCESS_LOCK_HELD')).toBeDefined();
            expect(contender.find('ACQUIRED')).toBeUndefined();
            expect(holder.alive).toBe(true);
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'a force-killed holder leaves nothing to clean up: the next acquire succeeds (AC-23b, T-22-34)',
        async () => {
            const lockDir = tempDir('csb-lock-b-');
            const holder = start([lockDir, ADDRESS]);
            await holder.waitForLine('ACQUIRED');

            killProcessTree(holder.pid);
            await holder.exited;
            // The stale file is still on disk; nothing between the kill and the next start removes it.
            expect(fs.existsSync(path.join(lockDir, `${ADDRESS}.lock`))).toBe(true);

            const next = start([lockDir, ADDRESS, '--hold-ms', '0']);
            expect(await next.exited).toBe(0);
            expect(next.find('ACQUIRED')).toBeDefined();
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'simultaneous acquires give exactly one winner per round, proven with a READY handshake (AC-23c, E15, T-22-86)',
        async () => {
            const lockDir = tempDir('csb-lock-c-');
            const signals = tempDir('csb-lock-c-signals-');
            const intervals: Array<{ acquired: number; released: number }> = [];
            let winners = 0;
            let readyLines = 0;
            let attemptLines = 0;

            for (let round = 0; round < ROUNDS; round++) {
                const barrier = path.join(signals, `barrier-${round}`);
                const holdUntil = path.join(signals, `hold-until-${round}`);
                const procs = Array.from({ length: CONTENDERS }, () => start([lockDir, ADDRESS, '--ready', '--barrier', barrier, '--hold-until', holdUntil]));

                // Every contender has loaded and reported READY before the barrier opens.
                await Promise.all(procs.map((p) => p.waitForLine('READY')));
                readyLines += procs.filter((p) => p.find('READY')).length;
                fs.writeFileSync(barrier, 'open');

                // The winner holds until every contender has attempted and reported its result,
                // so no contender can win sequentially after a release.
                await Promise.all(procs.map((p) => p.waitForLine('ATTEMPT')));
                await waitUntil(() => procs.every((p) => p.find('ACQUIRED') !== undefined || p.find('REFUSED') !== undefined));
                attemptLines += procs.filter((p) => p.find('ATTEMPT')).length;
                const roundWinners = procs.filter((p) => p.find('ACQUIRED') !== undefined);
                const refused = procs.filter((p) => p.find('REFUSED PROCESS_LOCK_HELD') !== undefined);
                expect(roundWinners).toHaveLength(1);
                expect(refused).toHaveLength(CONTENDERS - 1);
                winners += roundWinners.length;

                fs.writeFileSync(holdUntil, 'release');
                await Promise.all(procs.map((p) => p.exited));

                const released = roundWinners[0].ms('RELEASED');
                for (const p of procs) expect(p.ms('ATTEMPT')).toBeLessThan(released);
                intervals.push({ acquired: roundWinners[0].ms('ACQUIRED'), released });
            }

            intervals.sort((x, y) => x.acquired - y.acquired);
            let overlaps = 0;
            for (let i = 1; i < intervals.length; i++) {
                if (intervals[i].acquired < intervals[i - 1].released) overlaps += 1;
            }
            console.log(`[AC-23c] rounds=${ROUNDS} winners=${winners} ready=${readyLines} attempts=${attemptLines} overlaps=${overlaps}`);
            expect(winners).toBe(ROUNDS);
            expect(readyLines).toBe(ROUNDS * CONTENDERS);
            expect(attemptLines).toBe(ROUNDS * CONTENDERS);
            expect(overlaps).toBe(0);
        },
        LONG_TEST_TIMEOUT_MS,
    );

    it(
        'preflight, pause and resume run while the lock is held and leave it held (AC-23d, E15)',
        async () => {
            const home = tempDir('csb-lock-d-home-');
            const expectedDir =
                process.platform === 'win32'
                    ? path.join(home, 'AppData', 'Local', 'crypto-snipe-bot', 'locks')
                    : path.join(home, '.local', 'state', 'crypto-snipe-bot', 'locks');
            const holder = start(['default', ADDRESS], { homeOverride: home });
            await holder.waitForLine('ACQUIRED');
            expect(fs.existsSync(path.join(expectedDir, `${ADDRESS}.lock`))).toBe(true);

            const before = start(['default', ADDRESS, '--hold-ms', '0'], { homeOverride: home });
            expect(await before.exited).toBe(1);
            expect(before.find('REFUSED PROCESS_LOCK_HELD')).toBeDefined();

            const scripts: string[][] = [['scripts/preflight.ts'], ['scripts/pause.ts', '--reason', 'lock-test'], ['scripts/resume.ts']];
            for (const script of scripts) {
                const r = spawnRailedChild('npx', ['ts-node', ...script], { homeOverride: home, timeoutMs: 110_000 });
                const output = `${r.stdout}${r.stderr}`;
                expect(r.status, `${script[0]}: ${output}`).not.toBeNull();
                if (script[0] === 'scripts/preflight.ts') {
                    expect(r.status, script[0]).toBeLessThan(2);
                } else {
                    // The holder runs no dashboard, so pause and resume take their defined
                    // "could not reach the dashboard" path (exit 2).
                    expect(r.status, script[0]).toBe(2);
                    expect(output).toContain('Could not reach the dashboard API');
                }
                expect(output).not.toContain('PROCESS_LOCK');
            }

            const after = start(['default', ADDRESS, '--hold-ms', '0'], { homeOverride: home });
            expect(await after.exited).toBe(1);
            expect(after.find('REFUSED PROCESS_LOCK_HELD')).toBeDefined();
            expect(holder.alive).toBe(true);
            // Plan 23-31 (CHAR-06): this test also read four named files as text and matched their
            // imports with a regex. That check is the next test, an import-graph check that names no
            // file, kept separate so its RED proof does not start the lock children again.
        },
        LONG_TEST_TIMEOUT_MS,
    );

    // Plan 23-31 (CHAR-06): moved out of the AC-23d test above, where it read scripts/preflight.ts,
    // pause.ts, resume.ts and src/preflight.ts as text. The commands are the files package.json's
    // preflight, pause and resume scripts run, found in a directory walk of scripts/; the lock and
    // the boot entry are the modules that export acquireProcessLock and runMain. Every module the
    // commands reach through their imports, at any depth, is checked, src/preflight.ts included.
    // ts.createProgram over the walk: 1.1 s alone; the 60 s limit the plan sets for a program.
    it(
        'preflight, pause and resume reach neither the process lock nor the boot entry through their imports (AC-23d)',
        () => {
            const mods = loadRepoModules(['src', 'scripts']);
            const npmScripts = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
            const commands = ['preflight', 'pause', 'resume'].map((name) => {
                const runs = [...mods.keys()].filter((file) => file.startsWith('scripts/') && (npmScripts[name] ?? '').split(/\s+/).includes(file));
                expect(runs, `npm run ${name}: ${npmScripts[name]}`).toHaveLength(1);
                return runs[0];
            });
            const forbidden = [...modulesExporting(mods, 'acquireProcessLock'), ...modulesExporting(mods, 'runMain')].map((m) => m.file);
            expect(forbidden, 'the lock module and the boot entry are each found once').toHaveLength(2);

            const reached = reachable(mods, commands);
            // The walk resolves real imports: the preflight command reaches the preflight checks.
            expect(modulesExporting(mods, 'preflightDryRun').every((m) => reached.has(m.file)), JSON.stringify([...reached.keys()])).toBe(true);
            const hits = forbidden.filter((f) => reached.has(f)).map((f) => (reached.get(f) as string[]).join(' -> '));
            expect(hits).toEqual([]);
        },
        60_000,
    );

    it(
        'gc: a holder that forces garbage collection keeps refusing a contender (STL-5)',
        async () => {
            const lockDir = tempDir('csb-lock-e-');
            const holder = start([lockDir, ADDRESS, '--gc'], { nodeOptions: ['--expose-gc'] });
            await holder.waitForLine('GC_DONE');

            const contender = start([lockDir, ADDRESS, '--hold-ms', '0']);
            expect(await contender.exited).toBe(1);
            expect(contender.find('REFUSED PROCESS_LOCK_HELD')).toBeDefined();
            expect(holder.alive).toBe(true);
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'a lock-mechanism error refuses: an unusable folder or a lock file that is not a database (NAC-07)',
        async () => {
            const dir = tempDir('csb-lock-f-');
            const notAFolder = path.join(dir, 'regular-file');
            fs.writeFileSync(notAFolder, 'x');
            const unusableFolder = start([notAFolder, ADDRESS, '--hold-ms', '0']);
            expect(await unusableFolder.exited).toBe(1);
            expect(unusableFolder.find('REFUSED PROCESS_LOCK_MECHANISM')).toBeDefined();

            const lockDir = tempDir('csb-lock-f2-');
            fs.writeFileSync(path.join(lockDir, `${ADDRESS}.lock`), 'this is not a sqlite database, not even close'.repeat(50));
            const notADatabase = start([lockDir, ADDRESS, '--hold-ms', '0']);
            expect(await notADatabase.exited).toBe(1);
            expect(notADatabase.find('REFUSED PROCESS_LOCK_MECHANISM')).toBeDefined();
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'tryAcquireThenRelease reports held while a holder lives and not held after it dies (D-06 query API)',
        async () => {
            const lockDir = tempDir('csb-lock-g-');
            const holder = start([lockDir, ADDRESS]);
            await holder.waitForLine('ACQUIRED');
            expect(tryAcquireThenRelease(lockDir, ADDRESS)).toEqual({ held: true });

            killProcessTree(holder.pid);
            await holder.exited;
            expect(tryAcquireThenRelease(lockDir, ADDRESS)).toEqual({ held: false });
        },
        TEST_TIMEOUT_MS,
    );
});
