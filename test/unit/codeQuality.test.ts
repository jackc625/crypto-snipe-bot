// test/unit/codeQuality.test.ts
// Structural code quality checks for Phase 3 requirements.
// Uses filesystem reads at test time — no imports of production code.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectTsFiles(dir: string, exclude: string[] = []): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (exclude.includes(entry.name)) continue;
            files.push(...collectTsFiles(fullPath, exclude));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            files.push(fullPath);
        }
    }
    return files;
}

// ---------------------------------------------------------------------------
// INFRA-01: Zero console.log / console.warn / console.error in src/ production code
// (scripts/ directory is excluded — it is not production code)
// ---------------------------------------------------------------------------

describe('INFRA-01: no console.log/warn/error in src/ production code', () => {
    it('finds zero console.log calls in src/ (excluding scripts/)', () => {
        const srcDir = join(process.cwd(), 'src');
        const files = collectTsFiles(srcDir, ['scripts']);
        const pattern = /console\.log\s*\(/;

        const matches: string[] = [];
        for (const file of files) {
            const content = readFileSync(file, 'utf-8');
            if (pattern.test(content)) {
                matches.push(file.replace(process.cwd(), ''));
            }
        }

        expect(matches).toHaveLength(0);
    });

    it('finds zero console.warn calls in src/ (excluding scripts/)', () => {
        const srcDir = join(process.cwd(), 'src');
        const files = collectTsFiles(srcDir, ['scripts']);
        const pattern = /console\.warn\s*\(/;

        const matches: string[] = [];
        for (const file of files) {
            const content = readFileSync(file, 'utf-8');
            if (pattern.test(content)) {
                matches.push(file.replace(process.cwd(), ''));
            }
        }

        expect(matches).toHaveLength(0);
    });

    it('finds zero console.error calls in src/ (excluding scripts/)', () => {
        const srcDir = join(process.cwd(), 'src');
        const files = collectTsFiles(srcDir, ['scripts']);
        const pattern = /console\.error\s*\(/;

        const matches: string[] = [];
        for (const file of files) {
            const content = readFileSync(file, 'utf-8');
            if (pattern.test(content)) {
                matches.push(file.replace(process.cwd(), ''));
            }
        }

        expect(matches).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// INFRA-03: ABIs centralized in abis.ts only — no inline ABI signatures in src/
// Inline ABI signature pattern: a string containing "function " and "view returns"
// Only src/utils/abis.ts is allowed to contain these.
// ---------------------------------------------------------------------------

describe('INFRA-03: ABI definitions centralized in abis.ts only', () => {
    it('no inline ABI function signatures exist outside abis.ts', () => {
        const srcDir = join(process.cwd(), 'src');
        const files = collectTsFiles(srcDir);

        // Normalize separators for cross-platform comparison
        const abisPath = join(srcDir, 'utils', 'abis.ts');

        // Pattern: string literal containing "function " followed eventually by "view returns"
        // This catches inline ABI entries like "function balanceOf(address) view returns (uint)"
        const pattern = /"function\s+\w+[^"]*view\s+returns/;

        const matches: string[] = [];
        for (const file of files) {
            if (file === abisPath) continue; // abis.ts is the canonical location
            const content = readFileSync(file, 'utf-8');
            if (pattern.test(content)) {
                matches.push(file.replace(process.cwd(), ''));
            }
        }

        expect(matches).toHaveLength(0);
    });
});
