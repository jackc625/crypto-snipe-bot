import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent } from "telegram/events";
import * as dotenv from "dotenv";
import { handleAlphaDrop } from "./alphaDrop";
import { logger } from "./utils/logger";
dotenv.config();

const log = logger.child({ module: 'telegramListener' });

const apiId = parseInt(process.env.TELEGRAM_API_ID!);
const apiHash = process.env.TELEGRAM_API_HASH!;
const stringSession = new StringSession(process.env.TELEGRAM_SESSION || "");

const processedContracts = new Set<string>();
let lastProcessed = 0;
const COOLDOWN_MS = 5000; // 5 seconds

// Parse whitelist from environment
const allowedSenders = new Set(
    (process.env.TELEGRAM_ALLOWED_SENDERS || '').split(',').map(s => s.trim()).filter(Boolean)
);
const allowedChannels = new Set(
    (process.env.TELEGRAM_ALLOWED_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean)
);

async function main() {
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    if (process.env.TELEGRAM_SESSION) {
        await client.connect();
    } else {
        log.error('TELEGRAM_SESSION not set in .env, run auth.ts to generate it');
        return;
    }

    log.info('Connected, listening for messages in all joined Telegram channels');

    client.addEventHandler(
        async (event: NewMessageEvent) => {
            // --- Sender/Channel Whitelist (FIX-09) ---
            const senderId = event.message.senderId?.toString();
            const chatId = event.chatId?.toString();

            const senderAllowed = allowedSenders.size === 0 || (senderId !== undefined && allowedSenders.has(senderId));
            const channelAllowed = allowedChannels.size === 0 || (chatId !== undefined && allowedChannels.has(chatId));

            if (!senderAllowed && !channelAllowed) {
                log.debug({ senderId, chatId, messagePreview: event.message.message?.substring(0, 50) }, 'Rejected message from non-whitelisted source');
                return;
            }
            // --- End Whitelist ---

            const messageText = event.message.message;

            log.debug({ messageLength: messageText?.length }, 'Incoming message');

            if (!messageText) return;

            const matches = messageText.match(/0x[a-fA-F0-9]{40}/g);

            log.debug({ matchCount: matches?.length || 0 }, 'Address matches found');

            if (!matches) return;

            for (const raw of matches) {
                const address = raw.toLowerCase();

                // Ignore duplicates
                if (processedContracts.has(address)) {
                    log.debug({ address }, 'Already processed, skipping');
                    continue;
                }

                // Throttle rapid messages
                const now = Date.now();
                if (now - lastProcessed < COOLDOWN_MS) {
                    log.debug({ address }, 'Throttling, skipping');
                    continue;
                }
                lastProcessed = now;

                processedContracts.add(address);
                log.info({ address }, 'Found contract address, processing alpha drop');
                await handleAlphaDrop(address);
            }
        },
        new NewMessage({})
    );

    process.stdin.resume();
}

main();
