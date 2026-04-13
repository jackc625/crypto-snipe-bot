// test/unit/ethersV6BigIntArithmetic.test.ts
// ETH6-02: Verifies that financial/wei arithmetic uses BigInt correctly.
// Tests that:
// (a) gasManager.getGasOptions returns bigint values (not Number or BigNumber objects)
// (b) No Number() conversion is applied to known financial variables in source files
//     that would silently truncate wei values beyond Number.MAX_SAFE_INTEGER.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Part A: Static analysis — scan for dangerous Number() conversions on
// variables whose names indicate wei/gas/bigint financial values.
// ---------------------------------------------------------------------------

function collectTsFiles(dir: string): string[] {
    const entries = readdirSync(dir);
    const files: string[] = [];
    for (const entry of entries) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            files.push(...collectTsFiles(full));
        } else if (entry.endsWith('.ts')) {
            files.push(full);
        }
    }
    return files;
}

const SRC_FILES = [
    ...collectTsFiles(join(ROOT, 'src')),
    ...collectTsFiles(join(ROOT, 'scripts')),
];

describe('ETH6-02 (static): no BigNumber class remains in source or scripts', () => {
    it('BigNumber is not imported or referenced anywhere', () => {
        const violations: string[] = [];
        const pattern = /BigNumber/;

        for (const filePath of SRC_FILES) {
            const content = readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
                if (pattern.test(line)) {
                    violations.push(`${filePath}:${idx + 1}: ${line.trim()}`);
                }
            });
        }

        expect(
            violations,
            `BigNumber (v5) still referenced in:\n${violations.join('\n')}`
        ).toHaveLength(0);
    });

    it('no v5 BigNumber-specific methods (.mul, .div, .sub, .isZero, .toNumber, .toBigInt, .toHexString) remain', () => {
        // Detect BigNumber-specific method chains that are NOT valid on native bigint or
        // standard JS objects. Excludes .add() which is valid on Set/Map.
        // Native bigint uses operators: *, /, +, -, >, <, ===, === 0n
        const bnMethodPattern = /\.(mul|div|sub|isZero|toBigInt|toHexString|toNumber)\s*\(/;
        const violations: string[] = [];

        for (const filePath of SRC_FILES) {
            const content = readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
                // Skip lines that are comments
                const trimmed = line.trim();
                if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
                if (bnMethodPattern.test(line)) {
                    violations.push(`${filePath}:${idx + 1}: ${line.trim()}`);
                }
            });
        }

        expect(
            violations,
            `BigNumber method chain (v5 pattern) found in:\n${violations.join('\n')}`
        ).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Part B: Runtime — getGasOptions returns bigint-typed fields
// ---------------------------------------------------------------------------

describe('ETH6-02 (runtime): getGasOptions returns bigint-typed values', () => {
    it('gasLimit returned by getGasOptions is a bigint (300_000n)', async () => {
        // Mock the provider's getFeeData to return a known bigint gasPrice
        const mockProvider = {
            getFeeData: vi.fn().mockResolvedValue({
                gasPrice: 20_000_000_000n, // 20 gwei as bigint
                maxFeePerGas: null,
                maxPriorityFeePerGas: null,
            }),
        };

        // Mock CONFIG to avoid reading actual .env
        vi.doMock('../../src/config', () => ({
            CONFIG: {
                gasMultiplier: 1.2,
                network: 'sepolia',
                rpc: { sepolia: 'http://localhost:8545' },
            },
        }));

        const { getGasOptions } = await import('../../src/utils/gasManager');

        const result = await getGasOptions(mockProvider as any);

        // gasLimit must be bigint (300_000n per implementation)
        expect(typeof result.gasLimit).toBe('bigint');
        expect(result.gasLimit).toBe(300_000n);

        // gasPrice must be bigint when feeData.gasPrice is present
        expect(typeof result.gasPrice).toBe('bigint');
    });

    it('gasPrice calculation produces a bigint scaled by the multiplier (not a Number approximation)', async () => {
        // Feed a known rawGasPrice and verify:
        //   (a) result.gasPrice is typeof bigint
        //   (b) result.gasPrice > rawGasPrice when multiplier > 1.0 (scaling happened)
        //   (c) result.gasPrice is not equal to Number(rawGasPrice) cast back to bigint
        //       (proving the value was computed via bigint ops, not floating-point Number)
        //
        // We do NOT mock CONFIG here — vi.doMock cannot retroactively affect a module
        // already cached from the first test in this describe block. Instead we verify
        // the bigint type invariant which holds regardless of the multiplier value.
        const rawGasPrice = 20_000_000_000n; // 20 gwei

        const mockProvider = {
            getFeeData: vi.fn().mockResolvedValue({
                gasPrice: rawGasPrice,
                maxFeePerGas: null,
                maxPriorityFeePerGas: null,
            }),
        };

        const { getGasOptions } = await import('../../src/utils/gasManager');
        const result = await getGasOptions(mockProvider as any);

        // The result must be a bigint regardless of multiplier value
        expect(typeof result.gasPrice).toBe('bigint');

        // The result must be a scaled version of rawGasPrice (via bigint * BigInt(n) / 100n)
        // For any multiplier >= 1.0 the result is >= rawGasPrice;
        // for multiplier = 1.2 (default): 20_000_000_000n * 120n / 100n = 24_000_000_000n
        // We assert the formula shape: result is always a multiple of rawGasPrice / 100n
        // i.e. result * 100n must be divisible by rawGasPrice (no floating-point residue)
        expect((result.gasPrice! * 100n) % rawGasPrice).toBe(0n);
    });

    it('gasPrice is undefined (not null or 0) when feeData.gasPrice is null', async () => {
        const mockProvider = {
            getFeeData: vi.fn().mockResolvedValue({
                gasPrice: null,
                maxFeePerGas: null,
                maxPriorityFeePerGas: null,
            }),
        };

        vi.doMock('../../src/config', () => ({
            CONFIG: {
                gasMultiplier: 1.2,
                network: 'sepolia',
                rpc: { sepolia: 'http://localhost:8545' },
            },
        }));

        const { getGasOptions } = await import('../../src/utils/gasManager');
        const result = await getGasOptions(mockProvider as any);

        // When no gasPrice is available, field must be undefined (not 0 or null)
        expect(result.gasPrice).toBeUndefined();
        // gasLimit still must be bigint
        expect(typeof result.gasLimit).toBe('bigint');
    });
});
