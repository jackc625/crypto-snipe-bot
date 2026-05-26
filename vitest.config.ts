import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config();

export default defineConfig({
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
                },
            },
            {
                extends: true,
                test: {
                    name: 'fork',
                    include: ['test/fork/**/*.test.ts'],
                    testTimeout: 120000,
                    environment: 'node',
                    globalSetup: ['test/fork/setup.ts'],
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
