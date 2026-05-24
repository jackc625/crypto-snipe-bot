// src/api/routes/antiRug.ts
// Phase 19 / Plan 19-06 — Express router for anti-rug operator surfaces.
//
// Routes:
//   POST /api/anti-rug/circuit-breaker/:chain/reset
//     — Manual operator reset of a tripped circuit breaker per D-VIS-CB-TRIPPED.
//     Returns 404 if chain unknown, 409 if CB not currently tripped, 200 on
//     success (calls resetCircuitBreaker(ctx)), 500 if the underlying reset
//     throws.
//
//   GET /api/anti-rug/events/:chain
//     — Returns the most recent trigger events from the circuit-breaker ring
//     buffer for the given chain (Plan 19-05's getRecentTriggers export).
//     Used by the Anti-Rug Monitor tile + the CB-reset modal as the canonical
//     source-of-truth for "what just happened". Bounded by
//     ctx.chain.antiRug.circuitBreakerTriggers (default 3) per Warning 11.
//
// Auth: Inherits authMiddleware from src/api/server.ts (mounted at /api/*).
//
// References:
//   - .planning/REQUIREMENTS.md ANTIRUG-09, ANTIRUG-10
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md
//       D-VIS-CB-TRIPPED, D-DRY-TELEMETRY
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md
//       §"src/api/routes/antiRug.ts" (lines 857-902)
//   - src/api/routes/controls.ts:39-221 — factory pattern + 51-111 force-sell
//     bridge to executeFullSell analog
//   - src/anti-rug/circuitBreaker.ts — resetCircuitBreaker,
//     isCircuitBreakerTripped, getRecentTriggers public surface

import { Router, Request, Response } from 'express';
import type { ChainContext } from '../../chainRegistry';
import {
    resetCircuitBreaker,
    isCircuitBreakerTripped,
    getRecentTriggers,
} from '../../anti-rug/circuitBreaker';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'api:antirug' });

/**
 * Build the /api/anti-rug router.
 *
 * @param contexts -- Array of ChainContext for all enabled chains.
 */
export function antiRugRoutes(contexts: ChainContext[]): Router {
    const router = Router();

    // ── POST /circuit-breaker/:chain/reset ── operator-initiated CB reset ──
    router.post('/circuit-breaker/:chain/reset', async (req: Request, res: Response) => {
        const chainName = String(req.params.chain);
        const ctx = contexts.find((c) => c.chain.name === chainName);
        if (!ctx) {
            res.status(404).json({ error: 'Chain not found' });
            return;
        }

        if (!isCircuitBreakerTripped(chainName)) {
            res.status(409).json({
                error: 'Circuit breaker not currently tripped on this chain',
            });
            return;
        }

        try {
            resetCircuitBreaker(ctx);
            log.info({ chain: chainName, op: 'cb-reset' }, 'Circuit breaker reset via dashboard');
            res.json({ ok: true, chain: chainName });
        } catch (err) {
            log.error({ err, chain: chainName }, 'CB reset failed');
            res.status(500).json({
                error: 'Reset failed: ' + (err instanceof Error ? err.message : String(err)),
            });
        }
    });

    // ── GET /events/:chain ── most recent trigger ring buffer for this chain ──
    router.get('/events/:chain', async (req: Request, res: Response) => {
        const chainName = String(req.params.chain);
        const ctx = contexts.find((c) => c.chain.name === chainName);
        if (!ctx) {
            res.status(404).json({ error: 'Chain not found' });
            return;
        }

        try {
            const events = getRecentTriggers(chainName);
            res.json({ chain: chainName, events });
        } catch (err) {
            log.error({ err, chain: chainName }, 'GET /events failed');
            res.status(500).json({
                error: 'Failed to load events: ' + (err instanceof Error ? err.message : String(err)),
            });
        }
    });

    return router;
}
