import { defineConfig } from 'vitest/config';

// SAFE-02 (Phase 22 plan 22-05): the Vitest main process loads NO .env file. No env-file
// loader is imported here, and `envDir: false` stops Vite reading .env / .env.local /
// .env.<mode>. Every worker installs the test rails from test/rails/*.cjs (per-project setup
// entries below), which scrub the env and load the inert test/.env.test sentinels; fork
// workers keep only the two FORK_SHELL_KEYS from the operator's shell. Each project's `env`
// label names the project in the rail ledger only; no rail decision reads it.
export default defineConfig({
    envDir: false,
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['test/unit/**/*.test.ts'],
                    testTimeout: 5000,
                    environment: 'node',
                    mockReset: true,
                    setupFiles: ['test/rails/setup.cjs'],
                    globalSetup: ['test/rails/ledgerRun.ts'],
                    env: { CSB_RAIL_PROJECT: 'unit' },
                },
            },
            {
                extends: true,
                test: {
                    name: 'integration',
                    include: ['test/integration/**/*.test.ts'],
                    testTimeout: 15000,
                    environment: 'node',
                    mockReset: true,
                    setupFiles: ['test/rails/setup.cjs'],
                    globalSetup: ['test/rails/ledgerRun.ts'],
                    env: { CSB_RAIL_PROJECT: 'integration' },
                },
            },
            {
                extends: true,
                test: {
                    name: 'fork',
                    include: ['test/fork/**/*.test.ts'],
                    testTimeout: 120000,
                    environment: 'node',
                    setupFiles: ['test/rails/setup-fork.cjs'],
                    globalSetup: ['test/fork/setup.ts'],
                    env: { CSB_RAIL_PROJECT: 'fork' },
                    // All fork test FILES share ONE Hardhat fork node (globalSetup,
                    // port 8545) and transact as the same Hardhat account #0. Running
                    // files in parallel races that account's nonce across independent
                    // ethers providers ("nonce too high" / "nonce has already been
                    // used") and drains its shared ETH balance non-deterministically.
                    // Force sequential file execution so each file sees a consistent
                    // account nonce/balance. (Within a file, tests are already serial.)
                    fileParallelism: false,
                },
            },
        ],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                'src/dashboard/**',
                'src/**/*.d.ts',
            ],
            thresholds: {
                lines: 70,
                functions: 70,
                branches: 70,
                statements: 70,
            },
            reporter: ['text', 'html', 'json-summary'],
            reportsDirectory: './coverage',
        },
    },
});
