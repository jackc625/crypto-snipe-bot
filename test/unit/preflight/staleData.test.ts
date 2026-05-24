// Phase 20 / Plan 20-00 / OPS-LIVE-06 — Wave 0 test stub. Implementation lands in plan 20-02.
//
// Covers stale-data warnings for open positions per D-STALE-THRESHOLDS:
//   warn threshold (default 120s / 2 min)   → pino warn log { op: 'stale-position', tradeId, ageSec }
//   error threshold (default 600s / 10 min) → pino error log { op: 'stale-position', tradeId, ageSec }
//   Both tunable via env: STALE_WARN_SEC, STALE_ERROR_SEC.
//
// REQUIREMENTS.md OPS-LIVE-06 wording (10s/20s) has been refined to 2-min warn / 10-min
// error per 20-CONTEXT.md D-STALE-THRESHOLDS (planner expected to update the row text in
// Plan 20-01 — does not block this Wave-0 stub).
//
// Observable assertions per D-04:
//   - pino warn or error log { op: 'stale-position', tradeId, ageSec } per stale row found
//   - NO process.exit (stale data is a warning, not FATAL)
//
// Plan 20-02 will replace it.skip with it and import checkStaleData from
// `../../../src/preflight`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('checkStaleData', () => {
    beforeEach(() => {
        // Plan 20-02 will: reset trades-table mock, reset pino spy, reset Date.now mock.
    });

    afterEach(() => {
        // Plan 20-02 will: vi.restoreAllMocks() + vi.useRealTimers().
    });

    it.skip('reason: pending impl in plan 20-02 — asserts NO pino warn/error log fires when trades.timestamp is 60s ago (well under STALE_WARN_SEC=120 default threshold)', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-02 — asserts pino warn log { op: stale-position, tradeId: 1, ageSec: 180 } fires when trades.timestamp is 180s ago (>120s warn threshold, <600s error threshold)', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-02 — asserts pino error log { op: stale-position, tradeId: 1, ageSec: 700 } fires when trades.timestamp is 700s ago (>600s error threshold)', () => {
        /* impl */
    });

    it.skip('reason: pending impl in plan 20-02 — asserts STALE_WARN_SEC env override is consumed (e.g. STALE_WARN_SEC=60 → 90s-old row triggers warn log instead of being silent under default 120s)', () => {
        /* impl */
    });
});
