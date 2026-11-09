// test/fork/rails/forkRails.fork.test.ts
// Phase 22 plan 22-08 Task 3 — SAFE-02 setup-layer rails under the FORK project (SPEC R4).
//
// Imports no Hardhat module and makes no network connection: in fork mode the general network
// deny is off (fork tests reach the local Hardhat node), so Telegram is checked through the
// pure classifyHost predicate only. Never prints a fork-shell value: every assertion on
// ETH_FORK_RPC_URL compares booleans, so a failure message cannot echo the operator's URL.
//
// Phase 22 runs this file only in the Hardhat-free rehearsal (test/rails/vitest.fork-rehearsal.config.ts).
// The real fork-project run is the dated obligation UFV-01 / UFV-02 / UFV-03 in
// .planning/audit/inputs/unrun-fork-verifications.json (owner: Phase 25).

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import * as dotenv from 'dotenv';
import Database from 'better-sqlite3';
import axios from 'axios';

const recordedBroadcasts = vi.hoisted(() => [] as Array<{ type: string; data: Record<string, unknown> }>);

vi.mock('../../../src/api/ws/broadcaster', () => ({
    broadcast: (type: string, data: Record<string, unknown>) => {
        recordedBroadcasts.push({ type, data });
    },
}));

import { sendCtxAlert, sendTelegramAlert } from '../../../src/utils/notifier';
import type { ChainContext } from '../../../src/chainRegistry';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = req('../../rails/core.cjs') as {
    railsStatus(): {
        installed: boolean;
        mode: string;
        repoRoot: string;
        netDenyInstalled: boolean;
        telegramDenyInstalled: boolean;
        forkShellKeys: Record<string, string>;
    };
    addProtectedRoot(dir: string): string;
    classifyHost(host: string, mode?: string): string;
    readLedger(): Array<{ kind: string; target: unknown }>;
    FORK_SHELL_KEYS: readonly string[];
};

// Module scope: capture every sentinel key's value as this file is imported (AC-13, fork).
const REPO = core.railsStatus().repoRoot;
const sentinels = dotenv.parse(fs.readFileSync(path.join(REPO, 'test', '.env.test')));
const valuesAtImport = new Map(Object.keys(sentinels).map((k) => [k, process.env[k]]));
const tokenAtImport = process.env.TELEGRAM_BOT_TOKEN;

function fakeRoot(): { root: string; data: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-fork-rails-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'crypto-snipe-bot' }));
    const data = path.join(root, 'data');
    fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, 'fixture.txt'), 'fork-fixture');
    core.addProtectedRoot(root);
    return { root, data };
}

function codeOf(fn: () => unknown): string {
    try {
        fn();
    } catch (e) {
        return String((e as { code?: unknown }).code ?? (e as Error).message);
    }
    return 'NO-THROW';
}

describe('fork project rails (SPEC R4)', () => {
    it('rails installed in mode fork: Telegram deny on, general network deny off', () => {
        const st = core.railsStatus();
        expect(st.installed).toBe(true);
        expect(st.mode).toBe('fork');
        expect(st.telegramDenyInstalled).toBe(true);
        expect(st.netDenyInstalled).toBe(false);
        expect(core.classifyHost('api.telegram.org', 'fork')).toBe('telegram');
    });

    it('module scope: the Telegram token and every test/.env.test key except the fork shell keys equal their sentinels (AC-13)', () => {
        expect(tokenAtImport).toBe(sentinels.TELEGRAM_BOT_TOKEN);
        const shell = new Set(core.FORK_SHELL_KEYS);
        const keys = Object.keys(sentinels).filter((k) => !shell.has(k));
        expect(keys.length).toBeGreaterThan(100);
        // Key names only in the failure output, never values.
        const mismatched = keys.filter((k) => valuesAtImport.get(k) !== sentinels[k]);
        expect(mismatched).toEqual([]);
    });

    it('a fake-root DB open throws RAIL_DB_TRIPWIRE and creates nothing', () => {
        const { data } = fakeRoot();
        expect(codeOf(() => new Database(path.join(data, 'bot.db')))).toBe('RAIL_DB_TRIPWIRE');
        expect(fs.existsSync(path.join(data, 'bot.db'))).toBe(false);
    });

    it('a fake-root data/ read throws RAIL_DATA_TRIPWIRE', () => {
        const { data } = fakeRoot();
        expect(codeOf(() => fs.readFileSync(path.join(data, 'fixture.txt')))).toBe('RAIL_DATA_TRIPWIRE');
    });

    it('in-worker fork shell key: ETH_FORK_RPC_URL is present, non-empty, not the sentinel, and preserved (AC-17)', () => {
        const v = process.env.ETH_FORK_RPC_URL;
        const present = typeof v === 'string';
        const nonEmpty = present && v !== '';
        const notSentinel = nonEmpty && v !== sentinels.ETH_FORK_RPC_URL;
        expect({ present, nonEmpty, notSentinel }).toEqual({ present: true, nonEmpty: true, notSentinel: true });
        expect(core.railsStatus().forkShellKeys.ETH_FORK_RPC_URL).toBe('preserved');
    });

    it('a Telegram send through the notifier is a recorded refusal, not a network call, and the broadcast runs (AC-16)', async () => {
        // Spied and resolved: no request can leave even without the refusal (this file makes
        // no network connection), and the general network deny is off in fork mode.
        const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({});
        const refusals = () => core.readLedger().filter((e) => e.kind === 'notifier-refused').length;
        const ctx = { chain: { displayName: '[ETH]', name: 'eth' } } as unknown as ChainContext;
        recordedBroadcasts.length = 0;
        const before = refusals();
        try {
            await expect(sendTelegramAlert('x')).resolves.toBeUndefined();
            await expect(sendCtxAlert(ctx, 'y')).resolves.toBeUndefined();

            expect(postSpy.mock.calls.length).toBe(0);
            expect(refusals()).toBe(before + 2);
            expect(recordedBroadcasts.map((b) => b.data.message)).toEqual(['x', 'y']);
            expect(recordedBroadcasts[1].data.chain).toBe('eth');
        } finally {
            postSpy.mockRestore();
        }
    });
});
