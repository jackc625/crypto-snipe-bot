// test/unit/rails/envSentinel.test.ts
// Phase 22 plan 22-08 Task 2 — SAFE-02 setup-layer rail tests: env scrub + sentinels (D-02,
// AC-13 / E11), the .env read block (D-04), and scrub coverage of every key src/ and scripts/
// read. Imports only test infrastructure and node/npm modules — nothing from src/.
//
// AC-13: the first statement after the imports captures TELEGRAM_BOT_TOKEN at MODULE SCOPE.
// It equals the test/.env.test sentinel, which proves the rails (Vitest setupFiles) ran
// before this file's first module-scope code.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import * as dotenv from 'dotenv';

const tokenAtImport = process.env.TELEGRAM_BOT_TOKEN;

const req = createRequire(import.meta.url);
const CORE_PATH = req.resolve('../../rails/core.cjs');
// The setupFiles entry loaded core.cjs through Node's native require: it is already in the
// native require cache, so this file talks to the SAME module instance (22-05 open risk a).
const coreLoadedBySetup = Boolean(req.cache[CORE_PATH]);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = req('../../rails/core.cjs') as {
    railsStatus(): Record<string, unknown> & { installed: boolean; mode: string; repoRoot: string; protectedRoots: string[]; installCount: number };
    addProtectedRoot(dir: string): string;
    installRails(o: { mode: 'full' | 'fork' }): unknown;
    readLedger(): Array<{ kind: string; target: unknown }>;
};

const REPO = core.railsStatus().repoRoot;
const sentinels = dotenv.parse(fs.readFileSync(path.join(REPO, 'test', '.env.test')));
const exampleKeys = Object.keys(dotenv.parse(fs.readFileSync(path.join(REPO, '.env.example'))));

function canon(p: string): string {
    const r = fs.realpathSync.native(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
}

describe('rails installed before the test file (setupFiles)', () => {
    it('core.cjs was loaded by setup.cjs through the native require (same instance)', () => {
        expect(coreLoadedBySetup).toBe(true);
    });

    it('rails are installed in mode full', () => {
        const st = core.railsStatus();
        expect(st.installed).toBe(true);
        expect(st.mode).toBe('full');
        expect(st.installCount).toBeGreaterThanOrEqual(1);
        expect(st.envInstalled).toBe(true);
    });
});

describe('sentinel env (D-02, AC-13)', () => {
    it('module-scope TELEGRAM_BOT_TOKEN equals the test/.env.test sentinel', () => {
        expect(sentinels.TELEGRAM_BOT_TOKEN).toMatch(/TEST-SENTINEL/);
        expect(tokenAtImport).toBe(sentinels.TELEGRAM_BOT_TOKEN);
    });

    it('every .env.example key in process.env equals its test/.env.test value', () => {
        expect(exampleKeys.length).toBeGreaterThan(100);
        const wrong: string[] = [];
        for (const k of exampleKeys) {
            if (process.env[k] !== sentinels[k]) wrong.push(k);
        }
        expect(wrong).toEqual([]);
    });
});

describe('env block (D-04)', () => {
    it('a protected root .env is invisible to fs.readFileSync, fs.promises.readFile and dotenv, and is ledgered', async () => {
        const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-envblock-'));
        const marker = `planted-marker-${process.pid}-${Date.now()}`;
        fs.writeFileSync(path.join(fake, 'package.json'), JSON.stringify({ name: 'crypto-snipe-bot' }));
        fs.writeFileSync(path.join(fake, '.env'), `RAIL_ENV_MARKER=${marker}\n`);
        core.addProtectedRoot(fake);
        const envFile = path.join(fake, '.env');

        let syncErr: NodeJS.ErrnoException | undefined;
        let syncText: string | undefined;
        try {
            syncText = fs.readFileSync(envFile, 'utf8');
        } catch (e) {
            syncErr = e as NodeJS.ErrnoException;
        }
        expect(syncText).toBeUndefined();
        expect(syncErr?.code).toBe('ENOENT');
        expect((syncErr as { railCode?: string } | undefined)?.railCode).toBe('RAIL_ENV_BLOCKED');

        await expect(fs.promises.readFile(envFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

        delete process.env.RAIL_ENV_MARKER;
        const res = dotenv.config({ path: envFile, quiet: true });
        expect(process.env.RAIL_ENV_MARKER).toBeUndefined();
        expect(JSON.stringify(res.parsed ?? {})).not.toContain(marker);

        const blocked = core.readLedger().filter((e) => e.kind === 'env-read-blocked');
        expect(blocked.some((e) => typeof e.target === 'string' && canon(path.dirname(e.target)) === canon(fake))).toBe(true);
    });

    it('the real repo root is a protected root', () => {
        const roots = core.railsStatus().protectedRoots.map(canon);
        expect(roots).toContain(canon(REPO));
    });
});

// OS / Node / Vitest essentials the rails never delete (core.cjs ESSENTIAL_ENV_KEYS); a key in
// this list is reported as essential, never planted.
const ESSENTIAL = ['PATH', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP', 'TMPDIR', 'NODE_OPTIONS', 'NODE_ENV', 'CI'];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules') continue;
            collectSourceFiles(full, out);
        } else if (e.isFile() && /\.(ts|tsx|js|cjs|mjs)$/.test(e.name)) {
            out.push(full);
        }
    }
    return out;
}

describe('scrub coverage (D-02)', () => {
    it('every process.env key read by src/ and scripts/ is scrubbed by the rails (or is an OS essential)', () => {
        const keys = new Set<string>();
        const dotRe = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
        const bracketRe = /process\.env\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\]/g;
        for (const f of [...collectSourceFiles(path.join(REPO, 'src')), ...collectSourceFiles(path.join(REPO, 'scripts'))]) {
            const text = fs.readFileSync(f, 'utf8');
            for (const m of text.matchAll(dotRe)) keys.add(m[1]);
            for (const m of text.matchAll(bracketRe)) keys.add(m[1]);
        }
        expect(keys.size).toBeGreaterThan(40);
        const essential = [...keys].filter((k) => ESSENTIAL.includes(k.toUpperCase()) || /^VITEST/i.test(k) || /^CSB_RAIL_/i.test(k));
        const plantable = [...keys].filter((k) => !essential.includes(k));
        const planted = `planted-scrub-probe-${process.pid}`;
        const saved = new Map(plantable.map((k) => [k, process.env[k]]));
        const uncovered: string[] = [];
        try {
            for (const k of plantable) process.env[k] = planted;
            // Re-install: the strictest-wins, idempotent install re-runs the scrub + sentinel load.
            core.installRails({ mode: 'full' });
            for (const k of plantable) {
                const v = process.env[k];
                if (v !== undefined && v !== sentinels[k]) uncovered.push(k);
            }
        } finally {
            for (const [k, v] of saved) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
            }
            core.installRails({ mode: 'full' });
        }
        expect(uncovered).toEqual([]);
        expect(essential.map((k) => k.toUpperCase()).every((k) => ESSENTIAL.includes(k) || /^VITEST|^CSB_RAIL_/.test(k))).toBe(true);
    });
});
