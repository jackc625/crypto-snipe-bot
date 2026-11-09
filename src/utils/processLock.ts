// src/utils/processLock.ts
//
// Phase 22 plan 22-13: SAFE-04 single-instance process lock (D-06, research candidate RC-18).
// One bot process per wallet: a second process for the same wallet could sign around the
// in-process nonce lock, so it is refused at boot.
//
// Mechanism (D-06): a SQLite exclusive file lock through the installed better-sqlite3
// (timeout 0, locking_mode=EXCLUSIVE, BEGIN EXCLUSIVE ... COMMIT; exclusive mode keeps the OS
// lock after COMMIT). The OS releases it when the process dies, however it dies, so a lock
// file left on disk after a crash or a force-kill never blocks the next start and needs no
// cleanup. A leftover -journal file is harmless. Any error that is not "held" refuses too
// (NAC-07): the lock never fails open.
//
// Two processes colliding in SQLite's lock upgrade (both reach SHARED, then neither can reach
// EXCLUSIVE) both get SQLITE_BUSY with timeout 0, so a raw attempt can give ZERO winners
// (measured in the AC-23c race). That is safe but wrong for a simultaneous start, so the whole
// attempt is retried for BUSY_RETRY_BUDGET_MS: a genuine holder still refuses, about a second
// later, and a collision resolves to exactly one winner.
//
// Rules for this module:
//   - STL-5, the pin: the handle lives on globalThis[Symbol.for('crypto-snipe-bot.processLock')]
//     for the whole process lifetime. An unreferenced better-sqlite3 handle is closed by the
//     next garbage collection, which silently releases the OS lock. Never remove the pin.
//   - The process holds exactly one handle to the lock file. On Linux, POSIX fcntl locks are
//     per process and ANY close() of ANY descriptor for the file in this process drops them,
//     so nothing else in the bot process may open the lock file (no status probe, hash or
//     fs read).
//   - The folder is a function parameter set only by tests; the bot passes defaultLockDir().
//     No environment variable or flag skips or relocates the lock (P5 / NAC-05).
//
// tryAcquireThenRelease is the D-06 query API, and it is a point-in-time status query ONLY.
// Between its release and any later action the bot can take the lock, so it can never be used
// as a guard before signing. A script that must not sign while the bot runs has to call
// acquireProcessLock and hold the lock for its whole operation. It must never be called inside
// the bot process (see the Linux rule above); it refuses if this process holds the lock.

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PIN = Symbol.for('crypto-snipe-bot.processLock');
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// How long to keep retrying while the lock file is busy. See the header.
const BUSY_RETRY_BUDGET_MS = 1000;

export type ProcessLockErrorCode = 'PROCESS_LOCK_HELD' | 'PROCESS_LOCK_MECHANISM';

export class ProcessLockError extends Error {
    readonly code: ProcessLockErrorCode;

    constructor(code: ProcessLockErrorCode, message: string, cause?: unknown) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = 'ProcessLockError';
        this.code = code;
    }
}

export interface ProcessLockInfo {
    lockFile: string;
    address: string;
    acquiredAt: number;
}

interface ProcessLockPin extends ProcessLockInfo {
    db: Database.Database;
    pid: number;
}

type PinnedGlobal = Record<symbol, ProcessLockPin | undefined>;

function currentPin(): ProcessLockPin | undefined {
    return (globalThis as unknown as PinnedGlobal)[PIN];
}

/** The machine-global lock folder, so a second clone of the repo is blocked too. */
export function defaultLockDir(): string {
    const home = os.homedir();
    if (process.platform === 'win32') {
        return path.join(home, 'AppData', 'Local', 'crypto-snipe-bot', 'locks');
    }
    return path.join(home, '.local', 'state', 'crypto-snipe-bot', 'locks');
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function isBusy(err: unknown): boolean {
    const code = (err as { code?: unknown } | null | undefined)?.code;
    return typeof code === 'string' && /^SQLITE_(BUSY|LOCKED)(_|$)/.test(code);
}

function validatedAddress(address: string): string {
    if (typeof address !== 'string' || !ADDRESS_RE.test(address)) {
        throw new ProcessLockError(
            'PROCESS_LOCK_MECHANISM',
            `Single-instance lock refused: ${JSON.stringify(address)} is not a wallet address.`,
        );
    }
    return address.toLowerCase();
}

function refuseIfPinned(): void {
    const pin = currentPin();
    if (pin) {
        throw new ProcessLockError(
            'PROCESS_LOCK_MECHANISM',
            `This process already holds the single-instance lock for wallet ${pin.address} (${pin.lockFile}); ` +
                'a process may open the lock file only once.',
        );
    }
}

function heldError(address: string, lockFile: string, cause: unknown): ProcessLockError {
    return new ProcessLockError(
        'PROCESS_LOCK_HELD',
        `Another bot process for wallet ${address} is running: the single-instance lock is held (${lockFile}). ` +
            'Stop that process, then start again. If it has already been killed, just start again: ' +
            'the operating system releases the lock when a process dies, and the file needs no cleanup.',
        cause,
    );
}

function mechanismError(address: string, lockFile: string, cause: unknown): ProcessLockError {
    return new ProcessLockError(
        'PROCESS_LOCK_MECHANISM',
        `The single-instance lock for wallet ${address} could not be taken (${lockFile}): ${errorText(cause)}. ` +
            'Refusing to start, because the bot cannot prove it is the only process for this wallet. ' +
            'Fix the cause, then start again.',
        cause,
    );
}

/** One attempt at the exclusive lock. On failure the handle is closed and the raw error is thrown. */
function openExclusiveOnce(lockDir: string, lockFile: string): Database.Database {
    fs.mkdirSync(lockDir, { recursive: true });
    const db = new Database(lockFile, { timeout: 0 });
    try {
        db.pragma('locking_mode = EXCLUSIVE');
        db.exec('BEGIN EXCLUSIVE');
        db.exec('CREATE TABLE IF NOT EXISTS holder (pid INTEGER, ts INTEGER)');
        db.prepare('INSERT INTO holder VALUES (?, ?)').run(process.pid, Date.now());
        db.exec('COMMIT');
        return db;
    } catch (err) {
        try {
            db.close();
        } catch {
            /* the error being reported is the one that matters */
        }
        throw err;
    }
}

/**
 * Retries while the lock file is busy, within a fixed budget. Each attempt closes its own
 * handle first, so no attempt ever holds a lock while another opens the file.
 */
function openExclusive(lockDir: string, lockFile: string): Database.Database {
    const deadline = Date.now() + BUSY_RETRY_BUDGET_MS;
    for (;;) {
        try {
            return openExclusiveOnce(lockDir, lockFile);
        } catch (err) {
            if (!isBusy(err) || Date.now() >= deadline) throw err;
            const pauseMs = 5 + Math.floor(Math.random() * 20);
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs);
        }
    }
}

/**
 * Takes the single-instance lock for this wallet and keeps it until the process dies.
 * Throws ProcessLockError: PROCESS_LOCK_HELD when another process has it,
 * PROCESS_LOCK_MECHANISM on any other failure. Both must refuse boot.
 */
export function acquireProcessLock(lockDir: string, address: string): ProcessLockInfo {
    const normalized = validatedAddress(address);
    refuseIfPinned();
    const lockFile = path.join(lockDir, `${normalized}.lock`);
    let db: Database.Database;
    try {
        db = openExclusive(lockDir, lockFile);
    } catch (err) {
        if (isBusy(err)) throw heldError(normalized, lockFile, err);
        throw mechanismError(normalized, lockFile, err);
    }
    const info: ProcessLockInfo = { lockFile, address: normalized, acquiredAt: Date.now() };
    // STL-5: the strong reference that keeps the OS lock alive across garbage collections.
    (globalThis as unknown as PinnedGlobal)[PIN] = { ...info, db, pid: process.pid };
    return info;
}

/**
 * D-06 query API: is the lock held right now? A status query only, never a guard before
 * signing (see the file header). Errors other than "held" throw PROCESS_LOCK_MECHANISM; it
 * never reports "not held" when it could not find out.
 */
export function tryAcquireThenRelease(lockDir: string, address: string): { held: boolean } {
    const normalized = validatedAddress(address);
    refuseIfPinned();
    const lockFile = path.join(lockDir, `${normalized}.lock`);
    let db: Database.Database;
    try {
        db = openExclusive(lockDir, lockFile);
    } catch (err) {
        if (isBusy(err)) return { held: true };
        throw mechanismError(normalized, lockFile, err);
    }
    db.close();
    return { held: false };
}
