// src/api/routes/controls.ts
// Bot control routes for force sell and emergency sell (DASH-03, D-15, D-16).
// Force sell triggers market sell for a specific position.
// Emergency sell triggers market sell for ALL open positions.

import { Router, Request, Response } from 'express';
import type { ChainContext, DexConfig } from '../../chainRegistry';
import { db, getPauseState, setPauseState, clearPauseState, forceWalCheckpoint } from '../../utils/db';
import { clearAllTimersForToken } from '../../utils/exitManager';
import { executeFullSell } from '../../exitEngine';
import { logger } from '../../utils/logger';
// Phase 20 / Plan 20-05 / OPS-LIVE-09 — re-uses the shared sanitizer (already
// strips control chars + markdown specials + clamps to 120 chars, satisfying
// the plan's "max 200 chars + strip control chars" T-20 mitigation contract).
import { sanitizeReason } from '../../utils/honeypot/sanitize';
// Phase 20 / Plan 20-05 / OPS-LIVE-09 — fire-and-forget WS event so dashboard
// banner (Plan 20-06) flips within one round-trip; banner reconciles via
// GET /pause on reconnect.
import { broadcast } from '../ws/broadcaster';

const log = logger.child({ module: 'api:controls' });

/** DB row shape for pending trade query */
interface PendingTradeRow {
    id: number;
    token: string;
    chain: string;
    pool_type: string;
    fee_tier: number | null;
}

/** Find the DexConfig that matches the trade's pool_type (and fee_tier for V3) */
function findDex(ctx: ChainContext, poolType: string, feeTier: number | null): DexConfig | undefined {
    if (poolType === 'v3') {
        // For V3, prefer the first V3 DEX on this chain (fee tier is per-pool, not per-DEX)
        return ctx.chain.dexes.find((d) => d.dexType === 'v3');
    }
    // For V2, return the first V2 DEX
    return ctx.chain.dexes.find((d) => d.dexType === 'v2');
}

/**
 * Build control routes for force sell and emergency sell.
 *
 * @param contexts -- Array of ChainContext for all enabled chains.
 */
export function controlRoutes(contexts: ChainContext[]): Router {
    const router = Router();

    // Prepared statements for trade queries
    const getPendingTrade = db.prepare(
        'SELECT id, token, chain, pool_type, fee_tier FROM trades WHERE id = ? AND status = ? AND action = ?',
    );
    const getAllPendingTrades = db.prepare(
        'SELECT id, token, chain, pool_type, fee_tier FROM trades WHERE status = ? AND action = ?',
    );

    // ── POST /force-sell/:tradeId ── force sell a specific position (D-16) ──
    router.post('/force-sell/:tradeId', async (req: Request, res: Response) => {
        const tradeId = parseInt(String(req.params.tradeId), 10);
        if (isNaN(tradeId)) {
            res.status(400).json({ error: 'Invalid trade ID' });
            return;
        }

        const sellLog = log.child({ tradeId, action: 'force-sell' });

        try {
            // Query DB for the pending trade
            const trade = getPendingTrade.get(tradeId, 'pending', 'buy') as PendingTradeRow | undefined;
            if (!trade) {
                res.status(404).json({ error: 'Trade not found or already closed' });
                return;
            }

            // Find ChainContext for this trade's chain
            const ctx = contexts.find((c) => c.chain.name === trade.chain);
            if (!ctx) {
                res.status(500).json({ error: 'Chain not available' });
                return;
            }

            // Find appropriate DexConfig
            const dex = findDex(ctx, trade.pool_type, trade.fee_tier);
            if (!dex) {
                res.status(500).json({ error: 'No DEX configuration found for this trade' });
                return;
            }

            // Critical sell safety sequence per Pitfall 3:
            // 1. Clear exit monitor timers FIRST to eliminate race with exit engine
            clearAllTimersForToken(trade.chain, trade.token);
            sellLog.info({ token: trade.token, chain: trade.chain }, 'Cleared exit timers for force sell');

            // 2. Execute the sell (executeFullSell handles its own lock acquisition/release)
            const success = await executeFullSell(
                ctx,
                dex,
                trade.token,
                trade.fee_tier,
                'urgency-market-sell',
                tradeId,
                'Force sell triggered via dashboard',
            );

            if (success) {
                sellLog.info({ token: trade.token, chain: trade.chain }, 'Force sell completed');
                res.json({ ok: true, tradeId, token: trade.token, chain: trade.chain });
            } else {
                // executeFullSell returns false when sell lock is held by another operation
                res.status(409).json({ error: 'Sell already in progress for this position' });
            }
        } catch (err) {
            sellLog.error({ err }, 'Force sell failed');
            res.status(500).json({
                error: 'Force sell failed: ' + (err instanceof Error ? err.message : String(err)),
            });
        }
    });

    // ── POST /emergency-sell ── sell ALL open positions (D-15) ───────────
    router.post('/emergency-sell', async (_req: Request, res: Response) => {
        const emergencyLog = log.child({ action: 'emergency-sell' });

        try {
            const trades = getAllPendingTrades.all('pending', 'buy') as PendingTradeRow[];

            if (trades.length === 0) {
                res.json({ ok: true, sold: 0, failed: 0, message: 'No open positions to sell' });
                return;
            }

            emergencyLog.info({ positionCount: trades.length }, 'Emergency sell initiated');

            let successes = 0;
            let failures = 0;
            const errorDetails: Array<{ tradeId: number; token: string; chain: string; error: string }> = [];

            // Sequential execution is safer for sell mutex management (avoids lock contention)
            for (const trade of trades) {
                try {
                    const ctx = contexts.find((c) => c.chain.name === trade.chain);
                    if (!ctx) {
                        failures++;
                        errorDetails.push({
                            tradeId: trade.id,
                            token: trade.token,
                            chain: trade.chain,
                            error: 'Chain not available',
                        });
                        continue;
                    }

                    const dex = findDex(ctx, trade.pool_type, trade.fee_tier);
                    if (!dex) {
                        failures++;
                        errorDetails.push({
                            tradeId: trade.id,
                            token: trade.token,
                            chain: trade.chain,
                            error: 'No DEX configuration found',
                        });
                        continue;
                    }

                    // Pitfall 3: clear timers first, then sell
                    clearAllTimersForToken(trade.chain, trade.token);

                    const success = await executeFullSell(
                        ctx,
                        dex,
                        trade.token,
                        trade.fee_tier,
                        'urgency-market-sell',
                        trade.id,
                        'Emergency sell-all triggered via dashboard',
                    );

                    if (success) {
                        successes++;
                    } else {
                        failures++;
                        errorDetails.push({
                            tradeId: trade.id,
                            token: trade.token,
                            chain: trade.chain,
                            error: 'Sell lock held by another operation',
                        });
                    }
                } catch (err) {
                    failures++;
                    errorDetails.push({
                        tradeId: trade.id,
                        token: trade.token,
                        chain: trade.chain,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }

            emergencyLog.info({ successes, failures }, 'Emergency sell completed');

            if (failures > 0) {
                // Per UI-SPEC error state copy
                res.json({
                    ok: false,
                    sold: successes,
                    failed: failures,
                    errors: errorDetails,
                    message: `Emergency sell encountered errors. ${failures} of ${trades.length} positions may not have been sold. Check the bot logs immediately.`,
                });
            } else {
                res.json({
                    ok: true,
                    sold: successes,
                    failed: 0,
                    errors: [],
                });
            }
        } catch (err) {
            emergencyLog.error({ err }, 'Emergency sell failed');
            res.status(500).json({
                error: 'Emergency sell failed: ' + (err instanceof Error ? err.message : String(err)),
            });
        }
    });

    // ── POST /pause ── flip global pause flag (Phase 20 / OPS-LIVE-09) ────
    // Auth: implicit via `apiRouter.use(authMiddleware)` in server.ts.
    // T-20 mitigation: reason field is sanitized (strip control chars + clamp
    // to 120 chars per the shared sanitizeReason helper — well under the
    // plan's 200-char ceiling).
    // WS broadcast: dashboard banner (Plan 20-06) reacts within one round-trip.
    router.post('/pause', async (req: Request, res: Response) => {
        const pauseLog = log.child({ action: 'pause' });
        try {
            const body = req.body as { reason?: string; pausedBy?: string };
            const reason = sanitizeReason(String(body.reason ?? 'manual operator pause'));
            const pausedBy = String(body.pausedBy ?? 'dashboard');
            const ts = Math.floor(Date.now() / 1000);
            setPauseState.run(ts, pausedBy, reason);
            // CR-04: force WAL fsync so the pause flag survives SIGKILL + restart
            // per the D-PAUSED-RESTART kill-switch contract.
            forceWalCheckpoint();
            broadcast('pause_state_change', { paused: true, pausedBy, reason });
            pauseLog.info({ pausedBy, reason }, 'Bot paused via API');
            res.json({ ok: true, paused: true, pausedBy, reason });
        } catch (err) {
            pauseLog.error({ err }, 'Pause failed');
            res.status(500).json({
                error: 'Pause failed: ' + (err instanceof Error ? err.message : String(err)),
            });
        }
    });

    // ── POST /resume ── clear pause flag (Phase 20 / OPS-LIVE-09) ─────────
    router.post('/resume', async (_req: Request, res: Response) => {
        const resumeLog = log.child({ action: 'resume' });
        try {
            clearPauseState.run();
            // CR-04: force WAL fsync so the resume survives SIGKILL + restart
            // (otherwise a lost resume write leaves the bot paused after restart,
            // which is the SAFE direction — but symmetry with /pause matters).
            forceWalCheckpoint();
            broadcast('pause_state_change', { paused: false });
            resumeLog.info('Bot resumed via API');
            res.json({ ok: true, paused: false });
        } catch (err) {
            resumeLog.error({ err }, 'Resume failed');
            res.status(500).json({
                error: 'Resume failed: ' + (err instanceof Error ? err.message : String(err)),
            });
        }
    });

    // ── GET /pause ── dashboard banner initial-state read path (Phase 20 D-PAUSE-UI) ──
    // WR-02 fix: previously, if getPauseState.get() threw (DB locked, file
    // deleted mid-run, corruption recovery), the error propagated to the
    // Express default handler → useWebSocket.refreshFromRest swallowed the
    // non-200 silently → pauseState stayed null → banner showed "no pause"
    // when the bot might actually be paused on disk. Fail-CLOSED: on DB
    // read failure return 503 + paused:true so the banner is sticky and the
    // operator can investigate via logs.
    router.get('/pause', (_req: Request, res: Response) => {
        try {
            const row = getPauseState.get() as {
                paused: number;
                paused_at: number | null;
                paused_by: string | null;
                reason: string | null;
            };
            res.json({
                paused: row.paused === 1,
                pausedAt: row.paused_at,
                pausedBy: row.paused_by,
                reason: row.reason,
            });
        } catch (err) {
            log.error({ err }, 'GET /pause: DB read failed');
            res.status(503).json({
                paused: true,
                pausedAt: null,
                pausedBy: 'unknown',
                reason: 'pause-state DB read failed; see server logs',
            });
        }
    });

    return router;
}
