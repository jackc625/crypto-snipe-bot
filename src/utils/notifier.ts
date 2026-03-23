import axios from "axios";
import * as dotenv from "dotenv";
import { logger } from "./logger";
import type { ChainContext } from '../chainRegistry';
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

/**
 * Send a chain-prefixed Telegram alert.
 * Prepends the chain's displayName (e.g. '[ETH]', '[BSC]') to the message.
 */
export async function sendChainAlert(chainDisplayName: string, message: string) {
    return sendTelegramAlert(`${chainDisplayName} ${message}`);
}

/**
 * Convenience: send a chain-prefixed alert using ChainContext directly.
 * Extracts displayName from ctx.chain.displayName.
 */
export async function sendCtxAlert(ctx: ChainContext, message: string) {
    return sendTelegramAlert(`${ctx.chain.displayName} ${message}`);
}
