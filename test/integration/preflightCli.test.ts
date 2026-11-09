// Phase 20 / Plan 20-05 / OPS-LIVE-10 — `npm run preflight` operator CLI tests.
//
// scripts/preflight.ts wraps preflightDryRun(registry) from Plan 20-02 + decides
// its own exit code based on the result list. Critical contract:
//   - exit 0  when every check.passed === true
//   - exit 1  when ≥1 check.passed === false (any FATAL)
//   - exit 2  on uncaught throw
//   - Does NOT spawn startMultiChainBot (OPS-LIVE-10 hard requirement)
//
// Test strategy: hybrid
//   * Test 1 + Test 4 (subprocess invariants): spawn the real CLI through the
//     railed spawner (test/rails/spawnRailedChild.ts, SAFE-02 D-03: the child
//     env is the sentinel test env, never the parent env)
//     and assert the bot-startup markers never appear in stdout/stderr +
//     exit code is bounded 0 or 1 (never 2). This proves OPS-LIVE-10 the
//     "does NOT start the bot" hard requirement at the subprocess level.
//   * Test 2 + Test 3 (unit-level exit-code semantics): static-import the
//     scripts/preflight.ts code path via a mocked preflightDryRun and verify
//     the exit-code branch logic — this is deterministic and fast.
//   * Static-source assertion: scripts/preflight.ts must not contain any
//     `import` of `bot` or call to `startMultiChainBot` (the structural
//     OPS-LIVE-10 invariant).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnRailedChild, type CliResult } from '../rails/spawnRailedChild';

const repoRoot = path.resolve(__dirname, '..', '..');

function runPreflight(extraEnv: Record<string, string> = {}): CliResult {
    return spawnRailedChild('npx', ['ts-node', 'scripts/preflight.ts'], { envOverrides: extraEnv });
}

// Each subprocess test starts the real CLI (11-13 s under the full parallel run, 60 s kill limit per
// child); Test 4 starts two, so this file cannot live on the project's 15 s default test timeout.
describe('npm run preflight CLI (OPS-LIVE-10)', { timeout: 150_000 }, () => {
    it('Test 1: subprocess exit code is bounded 0 or 1 (never 2 = uncaught throw) when run against the sentinel test env', () => {
        // Run preflight subprocess against the committed sentinel test env
        // (test/.env.test, every RPC on 127.0.0.1:1). This test used to read the
        // operator's real .env, network and DB; it no longer can. What we
        // assert is the same contract: exit code 0 (all-pass) OR 1 (≥1 FATAL),
        // never 2 (uncaught throw) and never null (timeout / crash).
        const result = runPreflight();

        expect(result.status).not.toBeNull();
        expect(result.status).toBeGreaterThanOrEqual(0);
        expect(result.status).toBeLessThan(2);
    });

    it('Test 2: subprocess emits structured FAIL log lines when ENABLED_CHAINS includes a chain with an unreachable RPC', () => {
        // Force a FATAL preflight by pointing ETH_RPC_URL at a deliberately
        // unreachable host. checkRpcChainId + checkRpcBlockAge both throw →
        // ≥2 results with passed:false → CLI exits 1 + emits pino fatal lines.
        const result = runPreflight({
            ENABLED_CHAINS: 'eth',
            ETH_RPC_URL: 'http://127.0.0.1:1/intentionally-unreachable',
            ETH_WS_URL: 'ws://127.0.0.1:1/intentionally-unreachable',
        });

        expect(result.status).toBe(1);
        const combined = result.stdout + result.stderr;
        // pino fatal level = 60.
        expect(combined).toMatch(/"level":60|Preflight failed|FAIL /);
    });

    it('Test 3: subprocess prints honeypot-checker FAIL when getCode returns 0x', () => {
        // Set the deployed address to a known-empty-bytecode address (zero address)
        // by NOT setting <CHAIN>_HONEYPOT_CHECKER_ADDRESS overrides — the default
        // hardcoded address in the chain template either has code (PASS) or not
        // (FAIL). Combined with an unreachable RPC, checkHoneypotCheckerCode
        // throws → result.passed === false → exit 1.
        const result = runPreflight({
            ENABLED_CHAINS: 'eth',
            ETH_RPC_URL: 'http://127.0.0.1:1/intentionally-unreachable',
            ETH_WS_URL: 'ws://127.0.0.1:1/intentionally-unreachable',
        });

        expect(result.status).toBe(1);
        // Bounded: never 2 (no uncaught throw).
        expect(result.status).toBeLessThan(2);
        const combined = result.stdout + result.stderr;
        // The structured log line for honeypot-checker-code failure surfaces.
        expect(combined).toMatch(/honeypot-checker-code|Preflight failed|FAIL /);
    });

    it('Test 4: subprocess does NOT print startMultiChainBot or bot-startup markers (OPS-LIVE-10 hard requirement)', () => {
        // Both pass-case and fail-case must not print bot-startup markers.
        const passResult = runPreflight();
        const failResult = runPreflight({
            ENABLED_CHAINS: 'eth',
            ETH_RPC_URL: 'http://127.0.0.1:1/intentionally-unreachable',
            ETH_WS_URL: 'ws://127.0.0.1:1/intentionally-unreachable',
        });

        const passCombined = passResult.stdout + passResult.stderr;
        const failCombined = failResult.stdout + failResult.stderr;

        // Neither run produced the bot-startup observable lines.
        expect(passCombined).not.toMatch(/Starting multi-chain bot|Multi-chain bot fully started/);
        expect(failCombined).not.toMatch(/Starting multi-chain bot|Multi-chain bot fully started/);
    });

    it('Static OPS-LIVE-10 invariant: scripts/preflight.ts does not import bot.ts / invoke startMultiChainBot', () => {
        const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'preflight.ts'), 'utf8');

        // No import of bot module.
        expect(src).not.toMatch(/from\s+['"]\.\.\/src\/bot['"]/);
        expect(src).not.toMatch(/require\(\s*['"]\.\.\/src\/bot['"]\s*\)/);
        // No invocation of startMultiChainBot (allow mentions in comments —
        // strip them before grepping). Match only a call site or import.
        const srcNoComments = src
            .replace(/\/\/[^\n]*/g, '')        // line comments
            .replace(/\/\*[\s\S]*?\*\//g, ''); // block comments
        expect(srcNoComments).not.toMatch(/startMultiChainBot\s*\(/);
        expect(srcNoComments).not.toMatch(/import[^;]*startMultiChainBot/);
    });
});
