// test/integration/directEntryGuard.test.ts
//
// Phase 22 plan 22-13 (SAFE-04, D-07, T-22-85): a first-import guard refuses before later
// imports run. The proof uses fixture entries with bot.ts's import shape and never bot.ts
// itself; the wrong-order fixture is the control that shows the test can see import order.

import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnRailedChild, type CliResult } from '../rails/spawnRailedChild';
import { isDirectEntry } from '../../src/guards/directEntry';

const TEST_TIMEOUT_MS = 120_000;
const FIXTURES = path.resolve(__dirname, 'fixtures');
const tempDirs: string[] = [];

function markerPath(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-direct-entry-'));
    tempDirs.push(d);
    return path.join(d, 'marker');
}

function runFixture(name: string, marker: string): CliResult {
    return spawnRailedChild('npx', ['ts-node', `test/integration/fixtures/${name}`, marker], { timeoutMs: 110_000 });
}

afterEach(() => {
    for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('direct-entry guard', () => {
    it(
        'a direct start refuses before any later import runs',
        () => {
            const marker = markerPath();
            const r = runFixture('directEntryFixture.ts', marker);
            expect(r.status).toBe(1);
            expect(r.stderr).toContain('Refusing to start');
            expect(r.stderr).toContain('src/main.ts');
            expect(fs.existsSync(marker)).toBe(false);
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'control: with the guard imported late, the earlier import has already run',
        () => {
            const marker = markerPath();
            const r = runFixture('directEntryLateFixture.ts', marker);
            expect(r.status).toBe(1);
            expect(r.stderr).toContain('Refusing to start');
            expect(fs.existsSync(marker)).toBe(true);
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'no false refusal: loading the guarded file from another entry (the main.ts shape) runs normally',
        () => {
            const marker = markerPath();
            const r = runFixture('directEntryStarterFixture.ts', marker);
            expect(r.status).toBe(0);
            expect(r.stderr).not.toContain('Refusing to start');
            expect(fs.existsSync(marker)).toBe(true);
        },
        TEST_TIMEOUT_MS,
    );

    it('isDirectEntry compares canonical files', () => {
        const file = path.join(FIXTURES, 'directEntryFixture.ts');
        expect(isDirectEntry(file, file)).toBe(true);
        expect(isDirectEntry(file, path.join(FIXTURES, 'importMarker.ts'))).toBe(false);
        expect(isDirectEntry(file, undefined)).toBe(false);
        // Windows paths are case-insensitive; elsewhere the casing variant is another file.
        expect(isDirectEntry(file, file.toUpperCase())).toBe(process.platform === 'win32');
    });
});
