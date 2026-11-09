// test/integration/fixtures/lockHolder.ts
//
// Phase 22 plan 22-13 (SAFE-04): a real process that takes the real single-instance lock. It
// never loads src/bot.ts or src/main.ts. Started through spawnRailedChild(Async) with
// `-r ts-node/register/transpile-only`.
//
// Args: <lockDir> <address> [--hold-ms N] [--gc] [--ready] [--barrier <file>] [--hold-until <file>]
//       <lockDir> may be the literal "default", meaning defaultLockDir() under the child's home.
//
// Lines on stdout: READY <pid>, ATTEMPT <ms>, ACQUIRED <ms>, GC_DONE, RELEASED <ms>,
// REFUSED <code> <ms>. With no hold option the holder stays until it is killed.
//
// Output goes straight to fd 1 because process.stdout on a Windows pipe is asynchronous and
// would not flush past the barrier spin or process.exit.

import * as fs from 'fs';
import { acquireProcessLock, defaultLockDir, ProcessLockError } from '../../../src/utils/processLock';

const BARRIER_DEADLINE_MS = 60_000;

function say(line: string): void {
    fs.writeSync(1, `${line}\n`);
}

function flagValue(args: string[], name: string): string | undefined {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
}

const [lockDirArg, address, ...rest] = process.argv.slice(2);
const holdMsArg = flagValue(rest, '--hold-ms');
const barrier = flagValue(rest, '--barrier');
const holdUntil = flagValue(rest, '--hold-until');

function release(): void {
    say(`RELEASED ${Date.now()}`);
    process.exit(0);
}

function forceCollections(): void {
    const gc = (globalThis as unknown as { gc?: () => void }).gc;
    if (typeof gc !== 'function') {
        say('ERROR gc is not exposed');
        process.exit(2);
    }
    for (let i = 0; i < 5; i++) {
        const garbage: number[][] = [];
        for (let j = 0; j < 200; j++) garbage.push(new Array<number>(5000).fill(j));
        gc();
    }
}

if (rest.includes('--ready')) say(`READY ${process.pid}`);

if (barrier !== undefined) {
    // A sync spin on purpose: every contender attempts within a few ms of the barrier.
    const deadline = Date.now() + BARRIER_DEADLINE_MS;
    while (!fs.existsSync(barrier)) {
        if (Date.now() > deadline) {
            say('ERROR barrier never opened');
            process.exit(2);
        }
    }
}

say(`ATTEMPT ${Date.now()}`);
try {
    acquireProcessLock(lockDirArg === 'default' ? defaultLockDir() : lockDirArg, address);
} catch (err) {
    if (err instanceof ProcessLockError) {
        say(`REFUSED ${err.code} ${Date.now()}`);
        process.exit(1);
    }
    say(`ERROR ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
}
say(`ACQUIRED ${Date.now()}`);

if (rest.includes('--gc')) {
    forceCollections();
    say('GC_DONE');
}

if (holdUntil !== undefined) {
    setInterval(() => {
        if (fs.existsSync(holdUntil)) release();
    }, 20);
} else if (holdMsArg !== undefined) {
    setTimeout(release, Number(holdMsArg));
} else {
    setInterval(() => undefined, 1000);
}
