// test/unit/rails/dotenvSrcSkip.test.ts
// Phase 22 plan 22-10 Task 2 - SAFE-02 src layer, D-01: every reachable dotenv site skips the
// .env file under Vitest, each proven by a child process that actually loads it. Without
// VITEST the site attempts the read, and the env-independent setup layer blocks it (the real
// file is never read). scripts/preflight.ts reaches the DB layer, so it never runs without
// VITEST here. The production path is proven with a fake .env in a throwaway folder and a
// loopback fake instead of Telegram.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkSpawnLimits, REPO_ROOT, spawnRailedChild, type CliResult } from '../../rails/spawnRailedChild';

const CHILD_TIMEOUT_MS = 110_000;
const TEST_TIMEOUT_MS = 120_000;
const LEDGER_ROOT = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger');

function lastLine(s: string): string {
    const lines = s.split(/\r?\n/).filter((l) => l.trim() !== '');
    return lines.length === 0 ? '' : lines[lines.length - 1].trim();
}

function runProbe(target: 'config' | 'notifier', withVitestEnv: boolean): CliResult {
    return spawnRailedChild('npx', ['ts-node', 'test/rails/probes/dotenvProbe.ts', target], {
        withVitestEnv,
        timeoutMs: CHILD_TIMEOUT_MS,
    });
}

let caseCounter = 0;

function newCaseId(label: string): string {
    caseCounter += 1;
    return `case-${label}-${process.pid}-${caseCounter}-${Date.now()}`;
}

interface LedgerEntry {
    kind: string;
    target?: { class?: string } | string | null;
}

// Reads every process's ledger in one case folder, then removes the folder. The wrapper's
// ledger gate cannot see case folders, so the same safety facts are asserted here.
function takeCaseLedger(runId: string): LedgerEntry[] {
    const dir = path.join(LEDGER_ROOT, runId);
    const entries: LedgerEntry[] = [];
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue;
        for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) {
            if (line.trim() !== '') entries.push(JSON.parse(line) as LedgerEntry);
        }
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return entries;
}

function count(entries: LedgerEntry[], kind: string): number {
    return entries.filter((e) => e.kind === kind).length;
}

function expectNoOutsideReach(entries: LedgerEntry[]): void {
    expect(count(entries, 'telegram-deny')).toBe(0);
    const nonLoopback = entries.filter(
        (e) => e.kind === 'net-allow' && (typeof e.target !== 'object' || e.target === null || e.target.class !== 'loopback'),
    );
    expect(nonLoopback).toEqual([]);
}

function runScriptCase(script: 'pause' | 'resume', withVitestEnv: boolean): { result: CliResult; entries: LedgerEntry[] } {
    const ledgerRunId = newCaseId(script);
    const args = script === 'pause' ? ['ts-node', 'scripts/pause.ts', '--reason', 'probe'] : ['ts-node', 'scripts/resume.ts'];
    const result = spawnRailedChild('npx', args, {
        envOverrides: { DASHBOARD_API_KEY: '' },
        withVitestEnv,
        ledgerRunId,
        timeoutMs: CHILD_TIMEOUT_MS,
    });
    return { result, entries: takeCaseLedger(ledgerRunId) };
}

function expectScriptReachedKeyCheck(result: CliResult, entries: LedgerEntry[]): void {
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('DASHBOARD_API_KEY not set');
    // A wrong ledger folder would otherwise read as "0 attempts".
    expect(count(entries, 'worker-start')).toBeGreaterThanOrEqual(1);
    expectNoOutsideReach(entries);
}

describe('dotenv gate at the reachable sites (SAFE-02 src layer, D-01)', () => {
    it('(a) config with VITEST set: the site makes zero .env read attempts', { timeout: TEST_TIMEOUT_MS }, () => {
        const r = runProbe('config', true);
        expect(r.status).toBe(0);
        expect(lastLine(r.stdout)).toBe('0');
    });

    it('(a) notifier with VITEST set: the site makes zero .env read attempts', { timeout: TEST_TIMEOUT_MS }, () => {
        const r = runProbe('notifier', true);
        expect(r.status).toBe(0);
        expect(lastLine(r.stdout)).toBe('0');
    });

    it('(b) config without VITEST: the read is attempted and the setup layer blocks it', { timeout: TEST_TIMEOUT_MS }, () => {
        const r = runProbe('config', false);
        expect(r.status).toBe(0);
        expect(lastLine(r.stdout)).toMatch(/^\d+$/);
        expect(Number(lastLine(r.stdout))).toBeGreaterThanOrEqual(1);
    });

    it('(b) notifier without VITEST: the read is attempted and the setup layer blocks it', { timeout: TEST_TIMEOUT_MS }, () => {
        const r = runProbe('notifier', false);
        expect(r.status).toBe(0);
        expect(lastLine(r.stdout)).toMatch(/^\d+$/);
        expect(Number(lastLine(r.stdout))).toBeGreaterThanOrEqual(1);
    });

    it('(c) pause with VITEST set: reaches its key check with zero .env read attempts', { timeout: TEST_TIMEOUT_MS }, () => {
        const { result, entries } = runScriptCase('pause', true);
        expectScriptReachedKeyCheck(result, entries);
        expect(count(entries, 'env-read-blocked')).toBe(0);
    });

    it('(c) pause without VITEST: the read is attempted and blocked', { timeout: TEST_TIMEOUT_MS }, () => {
        const { result, entries } = runScriptCase('pause', false);
        expectScriptReachedKeyCheck(result, entries);
        expect(count(entries, 'env-read-blocked')).toBeGreaterThanOrEqual(1);
    });

    it('(c) resume with VITEST set: reaches its key check with zero .env read attempts', { timeout: TEST_TIMEOUT_MS }, () => {
        const { result, entries } = runScriptCase('resume', true);
        expectScriptReachedKeyCheck(result, entries);
        expect(count(entries, 'env-read-blocked')).toBe(0);
    });

    it('(c) resume without VITEST: the read is attempted and blocked', { timeout: TEST_TIMEOUT_MS }, () => {
        const { result, entries } = runScriptCase('resume', false);
        expectScriptReachedKeyCheck(result, entries);
        expect(count(entries, 'env-read-blocked')).toBeGreaterThanOrEqual(1);
    });

    it('(d) preflight with VITEST set: finishes its report with zero .env read attempts', { timeout: TEST_TIMEOUT_MS }, () => {
        // Runs only with VITEST set: it reaches the DB layer. DASHBOARD_API_KEY stays at its
        // sentinel because the imported src/config module requires it, and an early exit there
        // would read as a false "0 attempts" for this script's own site.
        const ledgerRunId = newCaseId('preflight');
        const result = spawnRailedChild('npx', ['ts-node', 'scripts/preflight.ts'], { ledgerRunId, timeoutMs: CHILD_TIMEOUT_MS });
        const entries = takeCaseLedger(ledgerRunId);
        // 0 or 1 is a finished preflight report; 2 is an uncaught throw and null a timeout.
        expect([0, 1]).toContain(result.status);
        expect(count(entries, 'worker-start')).toBeGreaterThanOrEqual(1);
        expect(count(entries, 'env-read-blocked')).toBe(0);
        expectNoOutsideReach(entries);
    });

    it('(e) static: each of the five sites loads dotenv only under the VITEST gate', () => {
        const sites = ['src/config.ts', 'src/utils/notifier.ts', 'scripts/pause.ts', 'scripts/resume.ts', 'scripts/preflight.ts'];
        for (const rel of sites) {
            const lines = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split(/\r?\n/);
            const calls = lines.filter((l) => l.includes('dotenv.config('));
            expect(calls, rel).toEqual(['if (!process.env.VITEST) dotenv.config();']);
        }
    });

    it('(f) production path without VITEST: a fake .env loads and the notifier posts as before', { timeout: TEST_TIMEOUT_MS }, () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-prod-path-'));
        try {
            fs.writeFileSync(path.join(tmp, '.env'), 'FAKE_ENV_PROBE_KEY=from-fake-env-file\n');
            const r = spawnRailedChild(
                process.execPath,
                [path.join(REPO_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js'), path.join(REPO_ROOT, 'test', 'rails', 'probes', 'notifierProdPathProbe.ts')],
                { cwd: tmp, withVitestEnv: false, timeoutMs: CHILD_TIMEOUT_MS },
            );
            expect(r.stderr).not.toContain('notifierProdPathProbe:');
            expect(r.status).toBe(0);
            expect(JSON.parse(lastLine(r.stdout))).toEqual({
                vitest: false,
                configLoadedEnv: true,
                notifierLoadedEnv: true,
                calls: [
                    { host: 'api.telegram.org', tokenInPath: true },
                    { host: 'api.telegram.org', tokenInPath: true },
                    { host: 'api.telegram.org', tokenInPath: true },
                ],
                bodies: [
                    { chat_id: '1', text: 'plain', parse_mode: 'Markdown' },
                    { chat_id: '1', text: '[ETH] ctx', parse_mode: 'Markdown' },
                    { chat_id: '1', text: 'failing', parse_mode: 'Markdown' },
                ],
                failurePathResolved: true,
                refused: 0,
                telegramDenied: 0,
            });
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('ledgerRunId accepts only case-<lowercase> ids and never affects enforcement', () => {
        for (const bad of ['', 'vpu-1', 'case-UPPER', 'case-a_b', 'case-../x', 'CASE-a']) {
            expect(() => checkSpawnLimits(process.execPath, ['-v'], { ledgerRunId: bad })).toThrow(/\[limit: ledgerRunId\]/);
        }
        expect(() => checkSpawnLimits(process.execPath, ['-v'], { ledgerRunId: 'case-ok-1' })).not.toThrow();
    });
});
