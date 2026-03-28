import { defineConfig } from 'vitest/config';

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
