// scripts/telegram-login.ts
// One-time helper to (re)generate a TELEGRAM_SESSION string for the alpha-drop
// listener (src/telegramListener.ts). Run when the bot's Telegram login has
// expired — symptom: messages to the bot do nothing and a getMe() against the
// session returns 401 AUTH_KEY_UNREGISTERED.
//
// Usage (run in YOUR terminal — it is interactive):
//   npx ts-node scripts/telegram-login.ts
//
// It uses TELEGRAM_API_ID / TELEGRAM_API_HASH from .env, asks for your phone
// number, the login code Telegram sends you, and your 2FA password (if set),
// then prints a NEW session string. Paste that whole line into .env as
// TELEGRAM_SESSION=... (replacing the old value). The session string is a
// secret — it grants full access to the account; never commit or share it.

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as readline from 'readline';
import * as dotenv from 'dotenv';

dotenv.config();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (answer) => resolve(answer.trim())));

async function main(): Promise<void> {
    const apiId = parseInt(process.env.TELEGRAM_API_ID || '', 10);
    const apiHash = process.env.TELEGRAM_API_HASH || '';
    if (!apiId || !apiHash) {
        console.error('\nERROR: TELEGRAM_API_ID and/or TELEGRAM_API_HASH are not set in .env.');
        console.error('Get them from https://my.telegram.org → API development tools, then set them in .env.\n');
        process.exit(1);
    }

    console.log('\n=== Telegram login (one-time session regeneration) ===');
    console.log('You will need the phone of the Telegram account the bot uses (to receive the login code).\n');

    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await ask('Phone number WITH country code (e.g. +14155551234): '),
        phoneCode: async () => await ask('Login code Telegram just sent you: '),
        password: async () => await ask('2FA password (just press Enter if you have none): '),
        onError: (err) => console.error('Login error:', err && (err as Error).message ? (err as Error).message : err),
    });

    const sessionString = (client.session.save() as unknown as string) || '';
    console.log('\n============================================================');
    console.log('SUCCESS. Copy this ENTIRE line into .env (replace the old TELEGRAM_SESSION):');
    console.log('============================================================\n');
    console.log('TELEGRAM_SESSION=' + sessionString);
    console.log('\n============================================================');
    console.log('Keep it secret (treat it like a password). Then restart the bot.');
    console.log('============================================================\n');

    await client.disconnect();
    rl.close();
    process.exit(0);
}

main().catch((err) => {
    console.error('Fatal:', err && (err as Error).message ? (err as Error).message : err);
    process.exit(1);
});
