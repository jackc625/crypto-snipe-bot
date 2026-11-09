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
import { killProcessTree, readSentinels, spawnRailedChildAsync, type SpawnRailedOptions } from '../rails/spawnRailedChild';

const TEST_TIMEOUT_MS = 120_000;
const WAIT_MS = 45_000;
const FIXTURE = 'test/integration/fixtures/lockHolder.ts';

const ADDRESS = computeAddress(readSentinels().PRIVATE_KEY).toLowerCase();

class Proc {
    readonly lines: string[] = [];
    readonly exited: Promise<number | null>;
    exitCode: number | null | undefined = undefined;
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

    stderr = '';

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
});
