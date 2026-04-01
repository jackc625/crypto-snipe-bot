// src/api/routes/positions.ts
// GET /api/positions -- returns all open positions with live on-chain prices and P&L.
// Uses the shared buildPositionsWithLivePrices helper (D-06, D-08).

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ChainContext } from '../../chainRegistry';
import { buildPositionsWithLivePrices } from '../helpers/positions';

// Inline async handler to avoid dependency on errorHandler middleware timing (parallel plan execution)
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
    return (req: Request, res: Response, next: (err?: unknown) => void) => {
        fn(req, res).catch(next);
    };
}

/**
 * Factory function for positions routes.
 * Mounts at /api/positions (parent handles prefix).
 */
export function positionRoutes(contexts: ChainContext[]): Router {
    const router = Router();

    // GET / -- All open positions with live prices and exit strategy details
    router.get('/', asyncHandler(async (_req: Request, res: Response) => {
        const positions = await buildPositionsWithLivePrices(contexts);
        res.json({ positions });
    }));

    return router;
}
