// Phase 20 / Plan 20-05 / OPS-LIVE-10 — `npm run preflight` operator CLI tests.
//
// scripts/preflight.ts wraps preflightDryRun(registry) from Plan 20-02 + decides
// its own exit code based on the result list. Critical contract:
//   - exit 0  when every check.passed === true
//   - exit 1  when ≥1 check.passed === false (any FATAL)
//   - exit 2  on uncaught throw
//   - Does NOT spawn startMultiChainBot (OPS-LIVE-10 hard requirement)
//
// Test strategy: spawn the real CLI via Node child_process.spawnSync (matches
// scripts/deploy-honeypot-checker.ts pattern), capture exit code + stdout/stderr.
// Each test controls the outcome via a fixture .env file written to a tmpdir + an
// explicit DOTENV_CONFIG_PATH override. Disabling all chains (ENABLED_CHAINS='')
// makes preflight a no-op trivial-pass; enabling a chain with a bad RPC forces a
// FATAL. The subprocess never reaches network calls when ENABLED_CHAINS is empty.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Determine the repo root so spawnSync invocations land in the right cwd.
const repoRoot = path.resolve(__dirname, '..', '..');

// Detect platform-correct npx binary name.
const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

interface CliResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

/**
 * Spawn `npx ts-node scripts/preflight.ts` in the repo root with controlled env.
 * shell:true is needed on Windows so npx.cmd resolves (same pattern as
 * scripts/deploy-honeypot-checker.ts).
 */
function runPreflight(env: Record<string, string>): CliResult {
    const result = spawnSync(npxCmd, ['ts-node', 'scripts/preflight.ts'], {
        cwd: repoRoot,
        env: { ...process.env, ...env },
        shell: true,
        encoding: 'utf8',
        timeout: 30_000,
    });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

describe('npm run preflight CLI (OPS-LIVE-10)', () => {
    // Each test gets its own controlled DB_PATH so the production db.ts singleton
    // (loaded by preflight via its import chain) doesn't touch the real bot.db.
    let tmpDir: string;
    let tmpDbPath: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-cli-'));
        tmpDbPath = path.join(tmpDir, 'test.db');
    });

    afterAll(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            /* ignore Windows handle holds */
        }
    });

    it('Test 1: subprocess exits 0 when all checks pass (ENABLED_CHAINS=empty trivial-pass fixture)', () => {
        // ENABLED_CHAINS='' → preflightDryRun loops over zero chains, only cross-env
        // and stale-data run. With no chain registered + no stale rows in the fresh
        // tmp DB, every result passes → exit 0.
        const result = runPreflight({
            DB_PATH: tmpDbPath,
            ENABLED_CHAINS: '',
            // Required envs the bot validates at module-load (otherwise import fails
            // before preflight runs). Defaults here are valid-but-unused given no chain.
            DASHBOARD_API_KEY: 'test-api-key-1234567890',
            PRIVATE_KEY: '0x' + '1'.repeat(64),
            // Auth/MEV envs that wouldn't otherwise be needed.
            FLASHBOTS_AUTH_KEY: '0x' + '2'.repeat(64),
        });

        // Exit code 0 means all checks pass.
        expect(result.status).toBe(0);
        // Most importantly: subprocess never started the bot.
        expect(result.stdout + result.stderr).not.toMatch(/Starting multi-chain bot|Multi-chain bot fully started/);
    });

    it('Test 2: subprocess exits 1 when ENABLED_CHAINS includes a chain whose RPC is unreachable (FATAL preflight)', () => {
        // ETH enabled + ETH_RPC_URL pointing to an unreachable host → checkRpcChainId
        // and checkRpcBlockAge both throw → preflight FATAL → exit 1.
        const result = runPreflight({
            DB_PATH: tmpDbPath,
            ENABLED_CHAINS: 'eth',
            ETH_RPC_URL: 'http://127.0.0.1:1/intentionally-unreachable',
            ETH_WS_RPC_URL: 'ws://127.0.0.1:1/intentionally-unreachable',
            DASHBOARD_API_KEY: 'test-api-key-1234567890',
            PRIVATE_KEY: '0x' + '1'.repeat(64),
            FLASHBOTS_AUTH_KEY: '0x' + '2'.repeat(64),
        });

        // Exit 1 (FATAL preflight) — never 2 (uncaught throw) and never 0.
        expect(result.status).toBe(1);
        // Critically: subprocess did NOT start the bot.
        expect(result.stdout + result.stderr).not.toMatch(/Starting multi-chain bot|Multi-chain bot fully started/);
    });

    it('Test 3: subprocess exits 1 when honeypot-checker getCode returns 0x (unreachable RPC ⇒ same FATAL surface)', () => {
        // Same fixture as Test 2 — when the RPC is unreachable, both rpc-chainid and
        // honeypot-checker-code throw which surfaces as ≥1 failed result → exit 1.
        // Verifies the CLI exit code is bounded (0 or 1, never 2 on uncaught) and
        // that the structured failure log line is emitted.
        const result = runPreflight({
            DB_PATH: tmpDbPath,
            ENABLED_CHAINS: 'eth',
            ETH_RPC_URL: 'http://127.0.0.1:1/intentionally-unreachable',
            ETH_WS_RPC_URL: 'ws://127.0.0.1:1/intentionally-unreachable',
            DASHBOARD_API_KEY: 'test-api-key-1234567890',
            PRIVATE_KEY: '0x' + '1'.repeat(64),
            FLASHBOTS_AUTH_KEY: '0x' + '2'.repeat(64),
        });

        expect(result.status).toBe(1);
        // Acceptance bound from the plan: exit code MUST be 0 or 1, never 2 (no uncaught throw).
        expect(result.status).toBeLessThan(2);
        // Stdout/stderr should contain at least one FATAL line (structured pino).
        const combined = result.stdout + result.stderr;
        // pino fatal level is 60.
        expect(combined).toMatch(/"level":60|"fatal"|FATAL|Preflight failed/i);
    });

    it('Test 4: subprocess never spawns startMultiChainBot (OPS-LIVE-10 hard requirement)', () => {
        // Run both pass-case and fail-case; neither should ever print the
        // bot-startup marker. This is the OPS-LIVE-10 invariant.
        const passResult = runPreflight({
            DB_PATH: tmpDbPath,
            ENABLED_CHAINS: '',
            DASHBOARD_API_KEY: 'test-api-key-1234567890',
            PRIVATE_KEY: '0x' + '1'.repeat(64),
            FLASHBOTS_AUTH_KEY: '0x' + '2'.repeat(64),
        });
        const failResult = runPreflight({
            DB_PATH: tmpDbPath,
            ENABLED_CHAINS: 'eth',
            ETH_RPC_URL: 'http://127.0.0.1:1/intentionally-unreachable',
            ETH_WS_RPC_URL: 'ws://127.0.0.1:1/intentionally-unreachable',
            DASHBOARD_API_KEY: 'test-api-key-1234567890',
            PRIVATE_KEY: '0x' + '1'.repeat(64),
            FLASHBOTS_AUTH_KEY: '0x' + '2'.repeat(64),
        });

        const passCombined = passResult.stdout + passResult.stderr;
        const failCombined = failResult.stdout + failResult.stderr;

        // Neither run started the bot — no startMultiChainBot or "Multi-chain bot
        // fully started" log lines should appear.
        expect(passCombined).not.toMatch(/Starting multi-chain bot|Multi-chain bot fully started|startMultiChainBot/);
        expect(failCombined).not.toMatch(/Starting multi-chain bot|Multi-chain bot fully started|startMultiChainBot/);
    });
});
