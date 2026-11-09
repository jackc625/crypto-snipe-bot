// test/unit/rails/notifierRefusal.test.ts
// Phase 22 plan 22-10 Task 1 - SAFE-02 src layer, AC-16 under the UNIT project (D-04 amended).
//
// Under Vitest the notifier refuses a Telegram send through its existing catch path: the
// refusal is raised inside the try, logged by the existing log.warn, never thrown to the
// caller, the dashboard broadcast still runs, and the refusal is appended to the rail ledger.
//
// axios.post is spied and resolved in every test, so no request can leave even when the
// refusal is removed for a RED proof. The broadcaster and the logger are side channels here
// (not the mechanism under test), so they are recorded through plain functions that the
// project's mockReset cannot clear.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { createRequire } from 'node:module';
import type { ChainContext } from '../../../src/chainRegistry';

const recorded = vi.hoisted(() => ({
    broadcasts: [] as Array<{ type: string; data: Record<string, unknown> }>,
    warns: [] as Array<{ obj: unknown; msg: unknown }>,
}));

vi.mock('../../../src/api/ws/broadcaster', () => ({
    broadcast: (type: string, data: Record<string, unknown>) => {
        recorded.broadcasts.push({ type, data });
    },
}));

vi.mock('../../../src/utils/logger', () => {
    const child = () => ({
        warn: (obj: unknown, msg?: unknown) => {
            recorded.warns.push({ obj, msg });
        },
        info: () => undefined,
        error: () => undefined,
        debug: () => undefined,
    });
    return { logger: { child } };
});

import { sendCtxAlert, sendTelegramAlert } from '../../../src/utils/notifier';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = req('../../rails/core.cjs') as {
    readLedger(): Array<{ kind: string; target: unknown }>;
};

function refusals(): number {
    return core.readLedger().filter((e) => e.kind === 'notifier-refused').length;
}

const ctxStub = { chain: { displayName: '[ETH]', name: 'eth' } } as unknown as ChainContext;
const savedToken = process.env.TELEGRAM_BOT_TOKEN;

let postSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    recorded.broadcasts.length = 0;
    recorded.warns.length = 0;
    postSpy = vi.spyOn(axios, 'post').mockResolvedValue({});
});

afterEach(() => {
    vi.restoreAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = savedToken;
});

function refusalFromWarn(): { code?: unknown; message?: unknown } {
    expect(recorded.warns).toHaveLength(1);
    expect(recorded.warns[0].msg).toBe('Telegram alert error');
    return (recorded.warns[0].obj as { err: { code?: unknown; message?: unknown } }).err;
}

describe('notifier refusal under Vitest (SAFE-02 src layer, D-04 amended)', () => {
    it('sendTelegramAlert is refused through its catch path: no post, broadcast runs, ledger entry', async () => {
        const before = refusals();

        await expect(sendTelegramAlert('x')).resolves.toBeUndefined();

        expect(postSpy.mock.calls.length).toBe(0);
        expect(refusals()).toBe(before + 1);
        expect(recorded.broadcasts).toHaveLength(1);
        expect(recorded.broadcasts[0].type).toBe('notification');
        expect(recorded.broadcasts[0].data).toMatchObject({ severity: 'info', message: 'x', category: 'system' });
        const err = refusalFromWarn();
        expect(err.code).toBe('RAIL_NOTIFIER_REFUSED');
        expect(String(err.message)).toContain('RAIL_NOTIFIER_REFUSED');
        expect(String(err.message)).not.toContain(String(savedToken));
    });

    it('sendCtxAlert is refused through its catch path: no post, broadcast keeps the chain, ledger entry', async () => {
        const before = refusals();

        await expect(sendCtxAlert(ctxStub, 'y')).resolves.toBeUndefined();

        expect(postSpy.mock.calls.length).toBe(0);
        expect(refusals()).toBe(before + 1);
        expect(recorded.broadcasts).toHaveLength(1);
        expect(recorded.broadcasts[0].data).toMatchObject({ message: 'y', chain: 'eth' });
        const err = refusalFromWarn();
        expect(err.code).toBe('RAIL_NOTIFIER_REFUSED');
        expect(String(err.message)).not.toContain(String(savedToken));
    });

    it('a refused send never rejects, so an un-awaited alert cannot become an unhandled rejection', async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        try {
            // Deliberately not awaited: this is how the money paths call the notifier.
            void sendTelegramAlert('fire-and-forget');
            void sendCtxAlert(ctxStub, 'fire-and-forget');
            await new Promise((resolve) => setTimeout(resolve, 25));
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
        expect(unhandled).toEqual([]);
        expect(postSpy.mock.calls.length).toBe(0);
    });

    it('with no bot token sendTelegramAlert takes the unchanged skipped branch: no refusal, no broadcast', async () => {
        delete process.env.TELEGRAM_BOT_TOKEN;
        const before = refusals();

        await expect(sendTelegramAlert('x')).resolves.toBeUndefined();

        expect(postSpy.mock.calls.length).toBe(0);
        expect(refusals()).toBe(before);
        expect(recorded.broadcasts).toEqual([]);
        expect(recorded.warns).toEqual([{ obj: 'Telegram alert skipped: missing chat ID or bot token', msg: undefined }]);
    });

    it('with no bot token sendCtxAlert still broadcasts as before: no refusal', async () => {
        delete process.env.TELEGRAM_BOT_TOKEN;
        const before = refusals();

        await expect(sendCtxAlert(ctxStub, 'y')).resolves.toBeUndefined();

        expect(postSpy.mock.calls.length).toBe(0);
        expect(refusals()).toBe(before);
        expect(recorded.broadcasts).toHaveLength(1);
        expect(recorded.broadcasts[0].data).toMatchObject({ message: 'y', chain: 'eth' });
    });
});
