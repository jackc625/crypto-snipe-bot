// test/unit/ethersV5PatternsAbsent.test.ts
// ETH6-01: Verifies that all ethers v5 import patterns have been removed from the codebase.
// Scans src/ and scripts/ for known v5-specific patterns and asserts zero matches.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

/**
 * Recursively collect all .ts files under a directory.
 */
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

/**
 * Patterns that must NOT appear anywhere in source/scripts files after ethers v6 migration.
 * Each entry has a label (for reporting) and a regex.
 */
const V5_BANNED_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
    {
        label: '@ethersproject/ import',
        pattern: /@ethersproject\//,
    },
    {
        label: 'providers.JsonRpcProvider (v5 namespace)',
        pattern: /providers\.JsonRpcProvider/,
    },
    {
        label: 'ethers.providers.JsonRpcProvider (v5 namespace)',
        pattern: /ethers\.providers\./,
    },
    {
        label: '.callStatic. usage (v5 pattern)',
        pattern: /\.callStatic\./,
    },
    {
        label: 'BigNumber class import or usage',
        pattern: /BigNumber/,
    },
    {
        label: '.deployed() call (v5 deploy pattern)',
        pattern: /\.deployed\(\)/,
    },
    {
        label: 'ethers.utils.* namespace (v5)',
        pattern: /ethers\.utils\./,
    },
    {
        label: 'ethers.constants.* namespace (v5)',
        pattern: /ethers\.constants\./,
    },
    {
        label: 'provider.getGasPrice() (v5 fee API)',
        pattern: /\.getGasPrice\(\)/,
    },
    {
        label: '@nomiclabs/ package import',
        pattern: /@nomiclabs\//,
    },
];

describe('ETH6-01: ethers v5 import patterns are absent from all source files', () => {
    for (const { label, pattern } of V5_BANNED_PATTERNS) {
        it(`no file contains "${label}"`, () => {
            const violations: string[] = [];

            for (const filePath of SRC_FILES) {
                const content = readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                lines.forEach((line, idx) => {
                    if (pattern.test(line)) {
                        violations.push(`${filePath}:${idx + 1}: ${line.trim()}`);
                    }
                });
            }

            expect(violations, `Found v5 pattern "${label}" in:\n${violations.join('\n')}`).toHaveLength(0);
        });
    }

    it('scans at least 5 source files (sanity check that glob worked)', () => {
        expect(SRC_FILES.length).toBeGreaterThanOrEqual(5);
    });
});
