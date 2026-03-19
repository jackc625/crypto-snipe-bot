import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent } from "telegram/events";
import * as dotenv from "dotenv";
import { handleAlphaDrop } from "./alphaDrop";
dotenv.config();

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
        console.error("❌ TELEGRAM_SESSION not set in .env. Run auth.ts to generate it.");
        return;
    }

    console.log("🤖 Connected. Listening for messages in all joined Telegram channels...");

    client.addEventHandler(
        async (event: NewMessageEvent) => {
            // --- Sender/Channel Whitelist (FIX-09) ---
            const senderId = event.message.senderId?.toString();
            const chatId = event.chatId?.toString();

            const senderAllowed = allowedSenders.size === 0 || (senderId !== undefined && allowedSenders.has(senderId));
            const channelAllowed = allowedChannels.size === 0 || (chatId !== undefined && allowedChannels.has(chatId));

            if (!senderAllowed && !channelAllowed) {
                console.debug(`[TELEGRAM] Rejected message from sender=${senderId} chat=${chatId}: ${event.message.message?.substring(0, 50) || ''}...`);
                return;
            }
            // --- End Whitelist ---

            const messageText = event.message.message;

            console.log("📥 Incoming message:", messageText); // Add this, remove later

            if (!messageText) return;

            const matches = messageText.match(/0x[a-fA-F0-9]{40}/g);

            console.log("🔍 Matches:", matches); // And this, remove later

            if (!matches) return;

            for (const raw of matches) {
                const address = raw.toLowerCase();

                // 🛑 Ignore duplicates
                if (processedContracts.has(address)) {
                    console.log("⏭ Already processed:", address);
                    continue;
                }

                // 🕒 Throttle rapid messages
                const now = Date.now();
                if (now - lastProcessed < COOLDOWN_MS) {
                    console.log("⏳ Throttling... Skipping", address);
                    continue;
                }
                lastProcessed = now;

                processedContracts.add(address);
                console.log(`📬 Found contract address: ${address}`);
                await handleAlphaDrop(address);
            }
        },
        new NewMessage({})
    );

    process.stdin.resume();
}

main();
