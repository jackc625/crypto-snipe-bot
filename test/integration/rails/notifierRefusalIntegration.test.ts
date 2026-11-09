// test/integration/rails/notifierRefusalIntegration.test.ts
// Phase 22 plan 22-10 Task 1 - SAFE-02 src layer, AC-16 under the INTEGRATION project.
//
// The real notifier and the real logger run. axios.post is spied and resolved so nothing can
// leave even without the refusal, and the broadcaster is recorded (a side channel here).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { createRequire } from 'node:module';
import type { ChainContext } from '../../../src/chainRegistry';

const recorded = vi.hoisted(() => ({
    broadcasts: [] as Array<{ type: string; data: Record<string, unknown> }>,
}));

vi.mock('../../../src/api/ws/broadcaster', () => ({
    broadcast: (type: string, data: Record<string, unknown>) => {
        recorded.broadcasts.push({ type, data });
    },
}));

import { sendCtxAlert, sendTelegramAlert } from '../../../src/utils/notifier';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = req('../../rails/core.cjs') as {
    railsStatus(): { project: string };
    readLedger(): Array<{ kind: string; target: unknown }>;
};

function refusals(): number {
    return core.readLedger().filter((e) => e.kind === 'notifier-refused').length;
}

let postSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    recorded.broadcasts.length = 0;
    postSpy = vi.spyOn(axios, 'post').mockResolvedValue({});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('notifier refusal, integration project (AC-16)', () => {
    it('runs in the integration project', () => {
        expect(core.railsStatus().project).toBe('integration');
    });

    it('sendTelegramAlert is a recorded refusal, not a network call, and the broadcast runs', async () => {
        const before = refusals();

        await expect(sendTelegramAlert('x')).resolves.toBeUndefined();

        expect(postSpy.mock.calls.length).toBe(0);
        expect(refusals()).toBe(before + 1);
        expect(recorded.broadcasts).toHaveLength(1);
        expect(recorded.broadcasts[0].data).toMatchObject({ message: 'x' });
    });

    it('sendCtxAlert is a recorded refusal, not a network call, and the broadcast keeps the chain', async () => {
        const before = refusals();
        const ctx = { chain: { displayName: '[ETH]', name: 'eth' } } as unknown as ChainContext;

        await expect(sendCtxAlert(ctx, 'y')).resolves.toBeUndefined();

        expect(postSpy.mock.calls.length).toBe(0);
        expect(refusals()).toBe(before + 1);
        expect(recorded.broadcasts).toHaveLength(1);
        expect(recorded.broadcasts[0].data).toMatchObject({ message: 'y', chain: 'eth' });
    });
});
