// test/fork/helpers/hardhatChildEnv.ts
// Phase 22 plan 22-11 — SAFE-02 D-03 / AC-17: the sanitized environment for the one exempt
// child, the Hardhat processes started by test/fork/setup.ts.
//
// Closure safety and child-process safety are separate claims:
//   - The Vitest main-process import-closure scan (test/unit/rails/forkShellOnly.test.ts) proves
//     the MAIN process loads no .env. It cannot see what a spawned process reads.
//   - hardhat.config.ts:9 calls dotenv.config(), so a Hardhat child given the parent env (or no
//     rails) would load the real deploy key and RPC values from .env.
//
// So every Hardhat child gets this env, built from scratch: every key of test/.env.test (inert
// sentinels); the OS essentials; ETH_FORK_RPC_URL and ALLOW_REAL_MAINNET from the shell when
// non-empty (the child's own fork-mode rails capture and re-apply them); and, last, NODE_OPTIONS
// loading test/rails/setup-fork.cjs (env scrub, .env block, data fs block, DB tripwire, Telegram
// deny; the network stays open so Hardhat can fork). The parent env is never spread in and no
// other key is copied. Nothing here adds a bypass or a new env var (D-ROLLBACK).
//
// The first real Hardhat launch under this env is obligation UFV-04 (owner Phase 25): Phase 22
// starts no Hardhat, so test/unit/rails/hardhatChildEnv.test.ts proves it without one.

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'dotenv';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const OS_ESSENTIAL_KEYS = Object.freeze(['SystemRoot', 'ComSpec', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP', 'TMPDIR', 'PATH']);
const SHELL_KEYS = Object.freeze(['ETH_FORK_RPC_URL', 'ALLOW_REAL_MAINNET']);

/** The env for a Hardhat child: sentinels, OS essentials, the two shell keys, the fork rails. */
export function buildHardhatChildEnv(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...parse(fs.readFileSync(path.join(REPO_ROOT, 'test', '.env.test'))) };
    for (const key of OS_ESSENTIAL_KEYS) {
        const value = parentEnv[key];
        if (typeof value === 'string') env[key] = value;
    }
    for (const key of SHELL_KEYS) {
        const value = parentEnv[key];
        if (typeof value === 'string' && value !== '') env[key] = value;
    }
    // Applied last: nothing above can remove the rails preload.
    env.NODE_OPTIONS = `--require ${JSON.stringify(path.join(REPO_ROOT, 'test', 'rails', 'setup-fork.cjs'))}`;
    return env;
}
