// test/unit/anti-rug/raceTelemetry.test.ts
// Phase 19 Plan 19-05 / Task 1b — src/anti-rug/raceTelemetry.ts trivial
// latency assertion per D-RACE-TELEMETRY (a). Full Flashbots eth_callBundle
// (b) + post-hoc reality (c) coverage lives in Plan 19-07 fork tests.
//
// Test 21: measureDetectionLatency(start, end): number returns end - start.

import { describe, it, expect } from 'vitest';

describe('Phase 19 — raceTelemetry.measureDetectionLatency', () => {
    it('Test 21: returns end - start (trivial guard against future regression)', async () => {
        const { measureDetectionLatency } = await import('../../../src/anti-rug/raceTelemetry');
        expect(measureDetectionLatency(1_000, 1_120)).toBe(120);
        expect(measureDetectionLatency(0, 0)).toBe(0);
        expect(measureDetectionLatency(1_700_000_000_000, 1_700_000_000_500)).toBe(500);
    });
});
