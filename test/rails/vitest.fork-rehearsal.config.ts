// test/rails/vitest.fork-rehearsal.config.ts
// Phase 22 plan 22-08 Task 3 — Hardhat-free rehearsal of the FORK project for the fork rail
// tests (review concern L662@e2e59f6).
//
// Runs test/fork/rails/** in real Vitest workers with the fork project's own setup entry
// (test/rails/setup-fork.cjs) and the fork project's fileParallelism / pool / timeouts /
// mockReset (pinned equal by test/unit/rails/forkRehearsalParity.test.ts), but WITHOUT the
// fork globalSetup test/fork/setup.ts, which starts Hardhat. Phase 22 runs no Hardhat command
// (AC-08). The only globalSetup is the rail-ledger run record.
//
// Run (wrapped, with a dead loopback marker as the fork URL; nothing connects to it):
//   ETH_FORK_RPC_URL=http://127.0.0.1:9/rehearsal-marker node node_modules/ts-node/dist/bin.js \
//     scripts/verify-prod-untouched.ts --manifest <M> --require-ledger --expect-projects fork-rehearsal -- \
//     node node_modules/vitest/vitest.mjs run --config test/rails/vitest.fork-rehearsal.config.ts

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
    root,
    envDir: false,
    test: {
        projects: [
            {
                // Without this the root-level `envDir: false` does not reach the project and Vite
                // reads the repo .env files in the unrailed Vitest main process (AUD-REAUDIT-001).
                extends: true,
                root,
                test: {
                    name: 'fork-rehearsal',
                    include: ['test/fork/rails/**/*.test.ts'],
                    testTimeout: 120000,
                    environment: 'node',
                    setupFiles: ['test/rails/setup-fork.cjs'],
                    globalSetup: ['test/rails/ledgerRun.ts'],
                    env: { CSB_RAIL_PROJECT: 'fork-rehearsal' },
                    fileParallelism: false,
                },
            },
        ],
    },
});
