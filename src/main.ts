// src/main.ts
//
// Phase 22 plan 22-13: SAFE-04 / D-07. The bot's only entry point: load env, derive the wallet
// address, take the single-instance lock synchronously, and only then load src/bot.ts and start
// it. A static import here would run before the lock, so this file imports nothing stateful
// (no config, DB, notifier, logger or bot); a source test enforces that. Early refusals write
// to stderr directly because the logger must not load before the lock.
//
// Run with `npx ts-node src/main.ts` or `npm start`. preflight, pause and resume do not take the
// lock and work while it is held.

import * as dotenv from 'dotenv';
import { computeAddress } from 'ethers';
import { acquireProcessLock, defaultLockDir } from './utils/processLock';

export interface RunMainOptions {
    env: NodeJS.ProcessEnv;
    lockDir: string;
    startBot: () => void;
}

function noWalletError(): Error & { code: string } {
    // Fixed text on purpose: ethers errors can quote the rejected value, which is the key.
    const err = new Error('PRIVATE_KEY is missing or is not a valid private key. Set it in .env, then start again.') as Error & { code: string };
    err.code = 'MAIN_NO_WALLET';
    return err;
}

function vitestSetError(): Error & { code: string } {
    const err = new Error(
        'VITEST is set in the environment or in .env. It switches the bot to a temporary test database and mutes ' +
            'Telegram alerts, so it must never be set on a real start. Remove it, then start again.',
    ) as Error & { code: string };
    err.code = 'MAIN_VITEST_SET';
    return err;
}

/**
 * The environment the start decision uses: the .env values under whatever the shell set, the
 * same result as dotenv's own merge. They go into a private object so process.env stays exactly
 * as it was: every module the bot loads afterwards sees the boot order it always did, including
 * logger.ts reading LOG_LEVEL before config.ts loads .env. The path is a test seam only.
 */
export function readStartEnv(envPath?: string): NodeJS.ProcessEnv {
    const fromFile: Record<string, string> = {};
    if (envPath !== undefined || !process.env.VITEST) {
        dotenv.config({ path: envPath, processEnv: fromFile, quiet: true });
    }
    return { ...fromFile, ...process.env };
}

/** Accepts exactly what `new ethers.Wallet(key)` accepts, so the lock key is the bot's wallet. */
function walletAddress(env: NodeJS.ProcessEnv): string {
    const raw = env.PRIVATE_KEY;
    if (typeof raw !== 'string') throw noWalletError();
    const key = raw.startsWith('0x') ? raw : `0x${raw}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw noWalletError();
    try {
        return computeAddress(key).toLowerCase();
    } catch {
        throw noWalletError();
    }
}

/** Takes the lock for this wallet, then starts the bot. Any lock error propagates (NAC-07). */
export function runMain(opts: RunMainOptions): { lockFile: string; address: string } {
    if (opts.env.VITEST) throw vitestSetError();
    const address = walletAddress(opts.env);
    const { lockFile } = acquireProcessLock(opts.lockDir, address);
    opts.startBot();
    return { lockFile, address };
}

function refusalText(err: unknown): string {
    const code = (err as { code?: unknown } | null | undefined)?.code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'PROCESS_LOCK_HELD' || code === 'PROCESS_LOCK_MECHANISM' || code === 'MAIN_NO_WALLET' || code === 'MAIN_VITEST_SET') {
        return `Refusing to start [${code}]: ${message}\n`;
    }
    // Anything else is a failure while loading the bot, where the stack is what diagnoses it.
    const detail = err instanceof Error && err.stack ? err.stack : message;
    return `The bot could not start: ${detail}\n`;
}

if (require.main === module) {
    try {
        runMain({
            env: readStartEnv(),
            lockDir: defaultLockDir(),
            startBot: () => {
                // Loaded here, after the lock, so nothing stateful runs before it. Not awaited and
                // no catch added: startMultiChainBot behaves exactly as before (OD-6, Phase 24).
                const bot = require('./bot') as { startMultiChainBot: () => unknown };
                bot.startMultiChainBot();
            },
        });
    } catch (err) {
        process.stderr.write(refusalText(err));
        process.exit(1);
    }
}
