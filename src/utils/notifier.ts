import axios from "axios";
import * as dotenv from "dotenv";
import { logger } from "./logger";
dotenv.config();

const log = logger.child({ module: 'notifier' });

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

export async function sendTelegramAlert(message: string) {
    if (!process.env.TELEGRAM_CHAT_ID || !process.env.TELEGRAM_BOT_TOKEN) {
        log.warn('Telegram alert skipped: missing chat ID or bot token');
        return;
    }

    try {
        await axios.post(TELEGRAM_API, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: "Markdown",
        });
    } catch (error: any) {
        log.warn({ err: error }, 'Telegram alert error');
    }
}
