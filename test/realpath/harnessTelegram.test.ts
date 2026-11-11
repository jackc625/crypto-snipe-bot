// test/realpath/harnessTelegram.test.ts
// Phase 23 plan 23-27 Task 3 (CHAR-01): a test can drive the real Telegram allowlist handler.
//   - The real startTelegramListener builds its client on the setup.ts fake, connects and
//     registers one handler.
//   - deliverTelegramMessage hands that real inline handler a real-shaped NewMessage event. With
//     both allowlists unset the handler runs its real route: an eth_getCode call for the address
//     reaches the simulated node and the real "Contract not found on any chain" line is logged.
//     With both allowlists set and neither matching it rejects before any chain call, and an
//     allowed sender on the same listener reaches the chain (the control).
//   - Delivering with no handler registered fails loudly; disposal empties the handlers.
// Only the logger, notifier, broadcaster, axios and the Telegram library are mocked
// (harness/setup.ts); the chain is a transport seam (harness/chain.ts).

import { describe, expect, it } from 'vitest';
import { harnessState, labelAddress, type CallLogEntry } from './harness/chain';
import { recordedLogs } from './harness/capture';
import { deliverTelegramMessage, telegramHandlerCount } from './harness/telegram';
import { createScenario, stepUntil } from './harness/world';

function getCodeCalls(calls: readonly CallLogEntry[], address: string): CallLogEntry[] {
    return calls.filter((c) => c.method === 'eth_getCode' && String((c.params as unknown[])[0]).toLowerCase() === address.toLowerCase());
}

function logged(msg: string): Array<Record<string, unknown> | undefined> {
    return recordedLogs()
        .filter((l) => l.msg === msg)
        .map((l) => l.obj);
}

describe('realpath harness: the Telegram client fake and the real inline handler (plan 23-27 Task 3)', () => {
    it('the real startTelegramListener connects through the client fake and registers one NewMessage handler', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const handle = await sc.graph.telegramListener.startTelegramListener([sc.ctx]);
        expect(handle.connected).toBe(true);
        expect(telegramHandlerCount()).toBe(1);
        const tg = harnessState().telegram;
        expect(tg.clients).toHaveLength(1);
        expect(handle.client).toBe(tg.clients[0]);
        // The constructor arguments the real listener passed, from the rails' sentinel env.
        const client = tg.clients[0] as { session: { value: unknown }; apiId: unknown; apiHash: unknown; options: unknown; connected: boolean };
        expect(client.session.value).toBe(process.env.TELEGRAM_SESSION);
        expect(client.apiId).toBe(parseInt(process.env.TELEGRAM_API_ID!, 10));
        expect(client.apiHash).toBe(process.env.TELEGRAM_API_HASH);
        expect(client.options).toEqual({ connectionRetries: 5 });
        expect(client.connected).toBe(true);
        const entry = tg.handlers[0];
        expect(typeof entry.handler).toBe('function');
        expect((entry.builder as { constructor: { name: string }; params: unknown }).constructor.name).toBe('NewMessage');
        expect((entry.builder as { params: unknown }).params).toEqual({});
        expect(entry.client).toBe(client);
        expect(logged('Telegram listener connected and listening')).toHaveLength(1);
    });

    it('with both allowlists unset, an address the node has no code for runs the real route: eth_getCode for it reaches the node and "Contract not found on any chain" is logged', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { TELEGRAM_ALLOWED_SENDERS: '', TELEGRAM_ALLOWED_CHANNELS: '' } });
        await sc.graph.telegramListener.startTelegramListener([sc.ctx]);
        const address = labelAddress('telegram.alpha.no-code');
        expect(getCodeCalls(sc.node.callLog, address)).toHaveLength(0);

        await stepUntil(deliverTelegramMessage({ text: `new gem ${address} go`, senderId: 424242, chatId: '-1001234567890' }));

        const calls = getCodeCalls(sc.node.callLog, address);
        expect(calls).toHaveLength(1);
        expect(calls[0].endpoint).toBe('rpc');
        expect(logged('Found contract address, routing to matching chains')).toEqual([{ address: address.toLowerCase() }]);
        expect(logged('Contract not found on any chain')).toEqual([{ address: address.toLowerCase() }]);
        expect(logged('Rejected message from non-whitelisted source')).toHaveLength(0);
    });

    it('with both allowlists set and neither matching, the real handler rejects before any chain call; an allowed sender on the same listener reaches the chain', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { TELEGRAM_ALLOWED_SENDERS: '111', TELEGRAM_ALLOWED_CHANNELS: '-100222' } });
        await sc.graph.telegramListener.startTelegramListener([sc.ctx]);
        const address = labelAddress('telegram.alpha.rejected');

        await stepUntil(deliverTelegramMessage({ text: `new gem ${address}`, senderId: 999, chatId: '-100333' }));
        expect(sc.node.callLog.filter((c) => c.method === 'eth_getCode')).toHaveLength(0);
        // The real handler's own reason, with the IDs as the real library's toString() gives them.
        expect(logged('Rejected message from non-whitelisted source')).toEqual([{ senderId: '999', chatId: '-100333' }]);
        expect(logged('Found contract address, routing to matching chains')).toHaveLength(0);

        // Control: the allowlist, and nothing else, stopped it. An allowed sender gets through.
        await stepUntil(deliverTelegramMessage({ text: `new gem ${address}`, senderId: '111', chatId: '-100333' }));
        expect(getCodeCalls(sc.node.callLog, address)).toHaveLength(1);
        expect(logged('Contract not found on any chain')).toEqual([{ address: address.toLowerCase() }]);
    });

    it('delivering with no handler registered throws the named error, and after disposal no handler is left', async () => {
        await expect(deliverTelegramMessage({ text: 'hello' })).rejects.toThrow('no Telegram handler registered');
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        await expect(deliverTelegramMessage({ text: 'hello' })).rejects.toThrow('no Telegram handler registered');
        await sc.graph.telegramListener.startTelegramListener([sc.ctx]);
        expect(telegramHandlerCount()).toBe(1);
        await sc.dispose();
        expect(telegramHandlerCount()).toBe(0);
        expect(harnessState().telegram.clients).toHaveLength(0);
        await expect(deliverTelegramMessage({ text: 'hello' })).rejects.toThrow('no Telegram handler registered');
    });
});
