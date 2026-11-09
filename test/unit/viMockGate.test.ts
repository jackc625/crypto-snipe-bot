// test/unit/viMockGate.test.ts
// Phase 22 plan 22-14 — SAFE-06 / AC-27: the vi.mock specifier gate.
//
// The gate is exercised on real files: the seeded fixtures under test/fixtures/viMockGate and the
// actual suite. Forms the fixtures do not cover are written to a temp folder, so no extra broken
// mock lands inside test/. Every snippet below is a string the gate reads from disk; none of it
// runs, and this file itself is part of the suite scan.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkViMockPaths, collectSourceFiles, type Violation } from '../../scripts/check-vi-mock-paths';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'test', 'fixtures', 'viMockGate');
const FIXTURE_FILES = [
    'broken-relative.fixture.ts',
    'broken-bare.fixture.ts',
    'non-literal.fixture.ts',
    'broken-aliased.fixture.ts',
    'aliased-vi.fixture.ts',
    'valid.fixture.ts',
].map((name) => path.join(FIXTURE_DIR, name));

function byFileAndKind(violations: Violation[]): Array<{ file: string; kind: string; specifier: string }> {
    return violations
        .map((v) => ({ file: path.basename(v.file), kind: v.kind, specifier: v.specifier }))
        .sort((a, b) => a.file.localeCompare(b.file));
}

/** Writes the files to a fresh temp folder and checks the one named case.ts. */
function checkTemp(files: Record<string, string>): Violation[] {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-mock-gate-'));
    try {
        for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
        return checkViMockPaths([path.join(dir, 'case.ts')]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('SAFE-06 vi.mock specifier gate', () => {
    it('reports exactly the four seeded violations and nothing from the valid fixtures', () => {
        expect(byFileAndKind(checkViMockPaths(FIXTURE_FILES))).toEqual([
            { file: 'broken-aliased.fixture.ts', kind: 'unresolved-relative', specifier: './also-missing' },
            { file: 'broken-bare.fixture.ts', kind: 'unresolved-bare', specifier: 'no-such-package-csb-gate' },
            { file: 'broken-relative.fixture.ts', kind: 'unresolved-relative', specifier: './does-not-exist' },
            { file: 'non-literal.fixture.ts', kind: 'non-literal', specifier: 'someVariable' },
        ]);
    });

    it('reports the file, line and call as written for an aliased vi', () => {
        const [violation] = checkViMockPaths([path.join(FIXTURE_DIR, 'broken-aliased.fixture.ts')]);
        expect(violation).toMatchObject({ line: 5, call: 'v.mock', specifier: './also-missing', kind: 'unresolved-relative' });
    });

    it('passes the real suite', () => {
        const files = collectSourceFiles(path.join(REPO_ROOT, 'test'));
        expect(files.length).toBeGreaterThan(100);
        expect(checkViMockPaths(files)).toEqual([]);
    }, 60_000);

    it('leaves the broken fixtures out of the suite scan and keeps them when the root is inside', () => {
        const inside = (file: string): boolean => file.startsWith(FIXTURE_DIR + path.sep);
        expect(collectSourceFiles(path.join(REPO_ROOT, 'test')).filter(inside)).toEqual([]);
        expect(collectSourceFiles(path.join(REPO_ROOT, 'test', 'fixtures')).filter(inside)).toEqual([]);
        expect(collectSourceFiles(FIXTURE_DIR)).toHaveLength(8);
    });

    it('accepts Node built-ins, which have no file to resolve to', () => {
        expect(checkTemp({ 'case.ts': `import { vi } from 'vitest';\nvi.mock('fs');\nvi.mock('node:path');\n` })).toEqual([]);
    });

    it('rejects a mock of a declaration file with no runtime module beside it', () => {
        const source = `import { vi } from 'vitest';\nvi.mock('./types-only');\n`;
        const declaration = 'export declare const x: number;\n';
        expect(byFileAndKind(checkTemp({ 'case.ts': source, 'types-only.d.ts': declaration }))).toEqual([
            { file: 'case.ts', kind: 'unresolved-relative', specifier: './types-only' },
        ]);
        expect(checkTemp({ 'case.ts': source, 'types-only.d.ts': declaration, 'types-only.js': 'exports.x = 1;\n' })).toEqual([]);
    });

    it('finds the call through the vitest export name and through bracket access', () => {
        const viaExport = `import { vitest as t } from 'vitest';\nt.mock('./gone');\n`;
        const viaBracket = `import { vi } from 'vitest';\nvi['doMock']('./gone');\n`;
        for (const source of [viaExport, viaBracket]) {
            expect(byFileAndKind(checkTemp({ 'case.ts': source }))).toEqual([
                { file: 'case.ts', kind: 'unresolved-relative', specifier: './gone' },
            ]);
        }
    });

    it('treats a no-substitution template as a literal and every other form as non-literal', () => {
        expect(byFileAndKind(checkTemp({ 'case.ts': 'import { vi } from \'vitest\';\nvi.mock(`./gone`);\n' }))).toEqual([
            { file: 'case.ts', kind: 'unresolved-relative', specifier: './gone' },
        ]);
        const nonLiterals = ['vi.mock();', 'vi.unmock(`./${name}`);', 'vi.doUnmock(import(name));'];
        for (const call of nonLiterals) {
            const found = checkTemp({ 'case.ts': `import { vi } from 'vitest';\nconst name = 'x';\n${call}\n` });
            expect(found.map((v) => v.kind)).toEqual(['non-literal']);
        }
    });

    it('ignores text that only looks like a mock and receivers not bound to vitest', () => {
        const source = [
            `import { vi } from 'vitest';`,
            `// vi.mock('./gone')`,
            `const text = "vi.mock('./gone')";`,
            `const other = { mock: (s: string) => s };`,
            `other.mock('./gone');`,
            `vi.fn();`,
        ].join('\n');
        expect(checkTemp({ 'case.ts': source })).toEqual([]);
    });
});
