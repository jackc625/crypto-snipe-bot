import axios from "axios";
import * as dotenv from "dotenv";
import { logger } from "./logger";
import { broadcast } from '../api/ws/broadcaster';
import type { ChainContext } from '../chainRegistry';
// SAFE-02 / D-01 (src layer): skip the .env file under Vitest. The setup layer blocks the read independently.
if (!process.env.VITEST) dotenv.config();

const log = logger.child({ module: 'notifier' });

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

// ---------------------------------------------------------------------------
// Severity and category inference for dashboard notifications
// ---------------------------------------------------------------------------

function inferSeverity(message: string): 'error' | 'warning' | 'success' | 'info' {
    const lower = message.toLowerCase();
    if (lower.includes('error') || lower.includes('fail') || lower.includes('reject')) return 'error';
    if (lower.includes('warn') || lower.includes('risk') || lower.includes('limit') || lower.includes('unreachable')) return 'warning';
    if (lower.includes('sold') || lower.includes('profit') || lower.includes('sniped') || lower.includes('bought')) return 'success';
    return 'info';
}

function inferCategory(message: string): 'trade' | 'risk' | 'system' | 'error' {
    const lower = message.toLowerCase();
    if (lower.includes('snipe') || lower.includes('buy') || lower.includes('sell') || lower.includes('trade')) return 'trade';
    if (lower.includes('risk') || lower.includes('limit') || lower.includes('exposure') || lower.includes('reject')) return 'risk';
    if (lower.includes('connect') || lower.includes('disconnect') || lower.includes('start') || lower.includes('stop') || lower.includes('mev')) return 'system';
    if (lower.includes('error') || lower.includes('fail')) return 'error';
    return 'system';
}

// ---------------------------------------------------------------------------
// Test-isolation rail (SAFE-02 src layer, D-01; D-04 amended 2026-11-06)
// ---------------------------------------------------------------------------

/**
 * Under Vitest a Telegram send is refused before axios.post. It is called first inside the
 * existing try blocks, so the existing catch logs it, the caller never sees a throw and the
 * dashboard broadcast still runs. A no-op outside Vitest. The rail ledger global exists only
 * in railed test processes; the message never carries the bot token.
 */
function refuseUnderVitest(): void {
    if (!process.env.VITEST) return;
    const ledger = (globalThis as Record<symbol, unknown>)[Symbol.for('crypto-snipe-bot.railLedger')] as
        | { append(entry: { kind: string; target: string }): void }
        | undefined;
    ledger?.append({ kind: 'notifier-refused', target: 'telegram' });
    throw Object.assign(new Error('RAIL_NOTIFIER_REFUSED: Telegram send refused under Vitest (SAFE-02 src layer)'), {
        code: 'RAIL_NOTIFIER_REFUSED',
    });
}

// ---------------------------------------------------------------------------
// Telegram + WebSocket broadcast alert functions
// ---------------------------------------------------------------------------

export async function sendTelegramAlert(message: string) {
    if (!process.env.TELEGRAM_CHAT_ID || !process.env.TELEGRAM_BOT_TOKEN) {
        log.warn('Telegram alert skipped: missing chat ID or bot token');
        return;
    }

    try {
        refuseUnderVitest();
        await axios.post(TELEGRAM_API, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: "Markdown",
        });
    } catch (error: any) {
        log.warn({ err: error }, 'Telegram alert error');
    }

    // Broadcast to dashboard WebSocket clients
    broadcast('notification', {
        severity: 'info',
        message: message,
        category: 'system',
        timestamp: Date.now(),
    });
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
 * Broadcasts to WebSocket with chain name and inferred severity/category.
 */
export async function sendCtxAlert(ctx: ChainContext, message: string) {
    if (!process.env.TELEGRAM_CHAT_ID || !process.env.TELEGRAM_BOT_TOKEN) {
        log.warn('Telegram alert skipped: missing chat ID or bot token');
    } else {
        try {
            refuseUnderVitest();
            await axios.post(TELEGRAM_API, {
                chat_id: process.env.TELEGRAM_CHAT_ID,
                text: `${ctx.chain.displayName} ${message}`,
                parse_mode: "Markdown",
            });
        } catch (error: any) {
            log.warn({ err: error }, 'Telegram alert error');
        }
    }

    // Broadcast to dashboard WebSocket clients
    broadcast('notification', {
        severity: inferSeverity(message),
        message: message,
        chain: ctx.chain.name,
        category: inferCategory(message),
        timestamp: Date.now(),
    });
}
