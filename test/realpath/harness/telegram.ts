// test/realpath/harness/telegram.ts
// Phase 23 plan 23-27 (CHAR-01): deliver a real-shaped Telegram message to the real handler.
//
// The Telegram client library is on the AC-02 mock list (setup.ts), and the allowlist handler is
// an inline function inside src/telegramListener.ts startTelegramListener. The client fake in
// setup.ts keeps every handler the real listener registers through addEventHandler, on the shared
// harness state; deliverTelegramMessage builds a NewMessage event with the fields that handler
// reads, in the shapes the real library gives them, and awaits every registered handler in
// registration order:
//   - event.message.message   the text (a string; gramjs Api.Message.message)
//   - event.message.senderId  a big-integer BigInteger, or undefined (gramjs SenderGetter)
//   - event.chatId            a big-integer BigInteger, or undefined (gramjs ChatGetter)
// The IDs are built with the same big-integer copy the Telegram library loads, so toString()
// behaves exactly as in production (a channel ID is negative, -100...).
//
// Delivering with no handler registered throws an error containing "no Telegram handler
// registered", so a test can never deliver to nobody and pass. A handler registered with a
// NewMessage builder that carries filters is refused too: the real library would apply them and
// this fake does not, so delivering would be a message production could never see.

import { createRequire } from 'node:module';
import { harnessState, type TelegramHandlerEntry } from './chain';

// Every createRequire call uses a literal specifier (test/unit/rails/spawnSites.test.ts).
const req = createRequire(import.meta.url);
const bigInt = createRequire(req.resolve('telegram'))('big-integer') as (value: string) => { toString(): string };

/** A message as Telegram would deliver it to the listener. IDs as decimal text, a number or a bigint. */
export interface TelegramMessageInput {
    text: string;
    senderId?: string | number | bigint;
    chatId?: string | number | bigint;
}

/** The NewMessage builder options that change which messages a handler receives. */
const FILTER_KEYS = ['chats', 'blacklistChats', 'func', 'incoming', 'outgoing', 'fromUsers', 'forwards', 'pattern'];

function idOf(name: string, v: string | number | bigint | undefined): { toString(): string } | undefined {
    if (v === undefined) return undefined;
    const text = String(v);
    if (!/^-?\d+$/.test(text)) throw new Error(`deliverTelegramMessage: ${name} must be a whole number, got ${JSON.stringify(text)}`);
    return bigInt(text);
}

function checkBuilder(entry: TelegramHandlerEntry, index: number): void {
    const b = entry.builder as { constructor?: { name?: string }; params?: unknown } | undefined;
    if (!b || b.constructor?.name !== 'NewMessage') {
        throw new Error(`deliverTelegramMessage: handler ${index} was registered with ${b?.constructor?.name ?? String(b)}, not a NewMessage builder; this fake delivers only NewMessage events`);
    }
    const params = (b.params ?? {}) as Record<string, unknown>;
    const filters = FILTER_KEYS.filter((k) => params[k] !== undefined);
    if (filters.length > 0) throw new Error(`deliverTelegramMessage: handler ${index}'s NewMessage builder sets ${filters.join(', ')}, which the real library applies and this fake does not`);
}

/** How many handlers the real listener has registered on the client fake. */
export function telegramHandlerCount(): number {
    return harnessState().telegram.handlers.length;
}

/**
 * Deliver one message to every registered handler, in registration order, awaiting each. Under
 * the fixed clock the handler's chain calls wait on fake timers, so wrap it in stepUntil().
 */
export async function deliverTelegramMessage(input: TelegramMessageInput): Promise<void> {
    if (typeof input?.text !== 'string') throw new Error('deliverTelegramMessage: text must be a string');
    const handlers = [...harnessState().telegram.handlers];
    if (handlers.length === 0) throw new Error('deliverTelegramMessage: no Telegram handler registered (start the real listener with graph.telegramListener.startTelegramListener first)');
    handlers.forEach(checkBuilder);
    const event = {
        message: { message: input.text, senderId: idOf('senderId', input.senderId) },
        chatId: idOf('chatId', input.chatId),
    };
    for (const h of handlers) {
        if (typeof h.handler !== 'function') throw new Error('deliverTelegramMessage: a registered handler is not a function');
        await (h.handler as (e: unknown) => unknown)(event);
    }
}
