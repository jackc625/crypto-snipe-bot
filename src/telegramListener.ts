// src/telegramListener.ts
// Telegram alpha signal listener with multi-chain routing (D-13 through D-20).
// Exports startTelegramListener for bot.ts orchestration instead of standalone main().

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import type { ChainContext } from './chainRegistry';
import { handleAlphaDropForChain } from './alphaDrop';
import { logger } from './utils/logger';

const log = logger.child({ module: 'telegramListener' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelegramListenerHandle {
    client: TelegramClient | null;
    connected: boolean;
}

// ---------------------------------------------------------------------------
// Module-level state (persists across listener restarts)
// ---------------------------------------------------------------------------

const processedContracts = new Set<string>();
let lastProcessed = 0;
const COOLDOWN_MS = 5000; // 5 seconds

// ---------------------------------------------------------------------------
// Exported entry point
// ---------------------------------------------------------------------------

/**
 * Start the Telegram alpha signal listener with multi-chain routing.
 * Returns a handle with the client reference and connection status.
 *
 * Missing env vars produce a warning and a null client (optional integration per D-14).
 */
export async function startTelegramListener(contexts: ChainContext[]): Promise<TelegramListenerHandle> {
    const apiId = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;
    const session = process.env.TELEGRAM_SESSION;

    // D-14: Missing env vars = graceful skip
    if (!apiId || !apiHash || !session) {
        log.warn('Telegram env vars missing, running in factory-event-only mode');
        return { client: null, connected: false };
    }

    // Parse whitelists inside function (fresh each call)
    const allowedSenders = new Set(
        (process.env.TELEGRAM_ALLOWED_SENDERS || '').split(',').map(s => s.trim()).filter(Boolean)
    );
    const allowedChannels = new Set(
        (process.env.TELEGRAM_ALLOWED_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean)
    );

    try {
        const client = new TelegramClient(
            new StringSession(session),
            parseInt(apiId),
            apiHash,
            { connectionRetries: 5 },
        );

        await client.connect();

        // D-16, D-17: Event handler with multi-chain routing
        client.addEventHandler(
            async (event: NewMessageEvent) => {
                // --- Whitelist check -- same OR logic as before (D-21, D-22) ---
                const senderId = event.message.senderId?.toString();
                const chatId = event.chatId?.toString();

                const senderAllowed = allowedSenders.size === 0 || (senderId !== undefined && allowedSenders.has(senderId));
                const channelAllowed = allowedChannels.size === 0 || (chatId !== undefined && allowedChannels.has(chatId));

                if (!senderAllowed && !channelAllowed) {
                    log.debug({ senderId, chatId }, 'Rejected message from non-whitelisted source');
                    return;
                }

                const messageText = event.message.message;
                if (!messageText) return;

                const matches = messageText.match(/0x[a-fA-F0-9]{40}/g);
                if (!matches) return;

                for (const raw of matches) {
                    const address = raw.toLowerCase();
                    if (processedContracts.has(address)) continue;

                    const now = Date.now();
                    if (now - lastProcessed < COOLDOWN_MS) continue;
                    lastProcessed = now;
                    processedContracts.add(address);

                    log.info({ address }, 'Found contract address, routing to matching chains');

                    // D-17: Multi-chain routing via getCode
                    const matchingContexts = (await Promise.all(
                        contexts.map(async ctx => {
                            try {
                                const code = await ctx.httpProvider.getCode(address);
                                return code !== '0x' ? ctx : null;
                            } catch {
                                return null;
                            }
                        })
                    )).filter((c): c is ChainContext => c !== null);

                    if (matchingContexts.length === 0) {
                        log.warn({ address }, 'Contract not found on any chain');
                        continue;
                    }

                    log.info({ address, chains: matchingContexts.map(c => c.chain.name) }, 'Routing alpha drop to chains');
                    for (const ctx of matchingContexts) {
                        handleAlphaDropForChain(ctx, address).catch(err => {
                            ctx.log.error({ err, address }, 'Error handling alpha drop for chain');
                        });
                    }
                }
            },
            new NewMessage({}),
        );

        log.info('Telegram listener connected and listening');
        return { client, connected: true };
    } catch (err) {
        log.error({ err }, 'Failed to connect Telegram listener');
        return { client: null, connected: false };
    }
}
