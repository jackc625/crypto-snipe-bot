// test/integration/rails/railsIntegration.test.ts
// Phase 22 plan 22-08 Task 3 — SAFE-02 setup-layer rails under the INTEGRATION project
// (AC-13, AC-15, .env block, data/ block). Imports only test infrastructure and node/npm
// modules — nothing from src/. The only non-loopback target is TEST-NET-1 192.0.2.1.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import * as net from 'node:net';
import { createRequire } from 'node:module';
import * as dotenv from 'dotenv';

const tokenAtImport = process.env.TELEGRAM_BOT_TOKEN;

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = req('../../rails/core.cjs') as {
    railsStatus(): { installed: boolean; mode: string; project: string; repoRoot: string; netDenyInstalled: boolean };
    addProtectedRoot(dir: string): string;
    readLedger(): Array<{ kind: string; target: unknown }>;
};

const REPO = core.railsStatus().repoRoot;
const sentinels = dotenv.parse(fs.readFileSync(path.join(REPO, 'test', '.env.test')));

function failsDenied(start: (ok: (e: unknown) => void, bad: () => void) => void): Promise<string> {
    return new Promise((resolve) => {
        const t = setTimeout(() => resolve('timeout'), 3000);
        start(
            (e) => {
                clearTimeout(t);
                resolve((e as { code?: string })?.code === 'E_RAIL_NET_DENIED' ? 'denied' : `other ${String((e as { code?: string })?.code)}`);
            },
            () => {
                clearTimeout(t);
                resolve('succeeded');
            },
        );
    });
}

describe('integration project rails', () => {
    it('rails installed in mode full for the integration project', () => {
        const st = core.railsStatus();
        expect(st.installed).toBe(true);
        expect(st.mode).toBe('full');
        expect(st.project).toBe('integration');
        expect(st.netDenyInstalled).toBe(true);
    });

    it('module-scope TELEGRAM_BOT_TOKEN equals the test/.env.test sentinel (AC-13)', () => {
        expect(sentinels.TELEGRAM_BOT_TOKEN).toMatch(/TEST-SENTINEL/);
        expect(tokenAtImport).toBe(sentinels.TELEGRAM_BOT_TOKEN);
    });

    it('a protected root .env is blocked (ENOENT to the reader) and ledgered', () => {
        const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-int-envblock-'));
        fs.writeFileSync(path.join(fake, 'package.json'), JSON.stringify({ name: 'crypto-snipe-bot' }));
        fs.writeFileSync(path.join(fake, '.env'), 'RAIL_INT_MARKER=planted\n');
        core.addProtectedRoot(fake);
        let code: string | undefined;
        try {
            fs.readFileSync(path.join(fake, '.env'), 'utf8');
            code = 'read';
        } catch (e) {
            code = (e as { code?: string }).code;
        }
        expect(code).toBe('ENOENT');
        delete process.env.RAIL_INT_MARKER;
        dotenv.config({ path: path.join(fake, '.env'), quiet: true });
        expect(process.env.RAIL_INT_MARKER).toBeUndefined();
        expect(core.readLedger().some((e) => e.kind === 'env-read-blocked')).toBe(true);
    });

    it('a fake-root data/ read throws RAIL_DATA_TRIPWIRE', () => {
        const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-int-data-'));
        fs.writeFileSync(path.join(fake, 'package.json'), JSON.stringify({ name: 'crypto-snipe-bot' }));
        fs.mkdirSync(path.join(fake, 'data'));
        fs.writeFileSync(path.join(fake, 'data', 'fixture.txt'), 'x');
        core.addProtectedRoot(fake);
        let code: string | undefined;
        try {
            fs.readFileSync(path.join(fake, 'data', 'fixture.txt'));
            code = 'read';
        } catch (e) {
            code = (e as { code?: string }).code;
        }
        expect(code).toBe('RAIL_DATA_TRIPWIRE');
    });

    it('http.get to 192.0.2.1 is denied with E_RAIL_NET_DENIED (AC-15)', async () => {
        expect(await failsDenied((ok, bad) => http.get('http://192.0.2.1/', bad).on('error', ok))).toBe('denied');
    });

    it('a raw TCP connect to 192.0.2.1 is denied with E_RAIL_NET_DENIED (AC-15)', async () => {
        expect(await failsDenied((ok, bad) => net.connect(80, '192.0.2.1').on('error', ok).on('connect', bad))).toBe('denied');
    });

    it('a loopback HTTP server still answers (AC-15)', async () => {
        const server = http.createServer((_q, r) => r.end('int-loopback-ok'));
        await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).on('error', reject));
        try {
            const port = (server.address() as net.AddressInfo).port;
            expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('int-loopback-ok');
        } finally {
            await new Promise<void>((r) => server.close(() => r()));
        }
    });
});
