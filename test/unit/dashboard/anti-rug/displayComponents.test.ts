// test/unit/dashboard/anti-rug/displayComponents.test.ts
// Phase 19 / Plan 19-06 Task 2a — Display-only dashboard component source guards.
//
// These tests are source-text grep guards that verify every UI-SPEC verbatim
// copy string ships in the component source. They are NOT React render tests
// (the dashboard does not currently include @testing-library/react in
// dashboard/package.json — the operator-visual checker in Plan 19-07 covers
// runtime behaviour via fork+browser drill). The grep pattern is the canonical
// pattern established by Plan 19-05's `patterns-established` entry:
//   "TDD test-source-grep guards for source-structural invariants"
//
// Tests:
//   AntiRugStateBadge (Tests 15-18)
//   AntiRugMonitorTile (Tests 34-37)
//   WsHealthIndicator (Tests 38-40)
//   GapDetectedBanner (Tests 49-51)
//   FrontrunDistributionPanel (Tests 46-48)

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function readDashboardSrc(relPath: string): string {
    const p = resolve(__dirname, '../../../../dashboard/src', relPath);
    if (!existsSync(p)) return '';
    return readFileSync(p, 'utf-8').replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------------------
// AntiRugStateBadge
// ---------------------------------------------------------------------------

describe('Phase 19 — AntiRugStateBadge', () => {
    const src = readDashboardSrc('components/anti-rug/AntiRugStateBadge.tsx');

    it('Test 15: exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('Test 15: renders 6 distinct badge state variants', () => {
        // Each of the 6 state keys appears verbatim in stateStyles map
        for (const state of ['live', 'dry-run', 'would-have-sold', 'exit-fired', 'halted', 'unmonitored']) {
            expect(src).toContain(`'${state}'`);
        }
    });

    it('Test 16: badge labels are the verbatim UI-SPEC strings', () => {
        // Verbatim from UI-SPEC §"Anti-Rug column header and badges":
        expect(src).toContain("'Live'");
        expect(src).toContain("'Dry-run'");
        expect(src).toContain("'Would-have-sold'");
        expect(src).toContain("'Exit fired'");
        expect(src).toContain("'Halted (CB)'");
        expect(src).toContain("'Unmonitored'");
    });

    it('Test 16b: uses required semantic colour tokens (no new theme tokens)', () => {
        // From UI-SPEC §Color — each state's bg token
        expect(src).toContain('bg-profit'); // live
        expect(src).toContain('bg-warning'); // dry-run
        expect(src).toContain('bg-loss'); // exit-fired
        // halted custom — UI-SPEC §Color: `#1f2937` + border-loss
        expect(src).toContain('#1f2937');
        expect(src).toContain('border-loss');
        // unmonitored
        expect(src).toContain('text-text-disabled');
    });

    it('Test 17: onClick handler calls stopPropagation to prevent row toggle', () => {
        // PositionTable.tsx:194 precedent + UI-SPEC §Anti-Rug column behaviour
        expect(src).toMatch(/e\.stopPropagation\(\)/);
    });

    it('Test 18: passes tooltip text via title attribute', () => {
        // title attribute is the tooltip surface per UI-SPEC.
        expect(src).toMatch(/title=\{title\}/);
    });
});

// ---------------------------------------------------------------------------
// AntiRugMonitorTile
// ---------------------------------------------------------------------------

describe('Phase 19 — AntiRugMonitorTile', () => {
    const src = readDashboardSrc('components/anti-rug/AntiRugMonitorTile.tsx');

    it('exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('Test 34: tile renders verbatim "Anti-Rug Monitor" title', () => {
        expect(src).toContain('Anti-Rug Monitor');
    });

    it('Test 34: per-chain stats use UI-SPEC verbatim labels', () => {
        expect(src).toContain('Dry-run events today');
        expect(src).toContain('Suppressed today');
    });

    it('Test 35: renders "Last 10 events" section header', () => {
        expect(src).toContain('Last 10 events');
    });

    it('Test 36: empty state heading "No anti-rug events yet"', () => {
        expect(src).toContain('No anti-rug events yet');
    });

    it('Test 36b: empty state body verbatim per UI-SPEC', () => {
        expect(src).toContain('Anti-rug monitoring is active on');
        expect(src).toContain(
            'Confirmed rug signals and allowlist suppressions will appear here as the bot operates.',
        );
    });

    it('Test 37: handles allowlist-suppression row variant', () => {
        // Per UI-SPEC §"Anti-Rug Monitor tile" — last-10-events row uses
        // EventFeed.tsx severityColor pattern. Allowlist row format check:
        expect(src).toContain('Allowlist hit');
    });
});

// ---------------------------------------------------------------------------
// WsHealthIndicator
// ---------------------------------------------------------------------------

describe('Phase 19 — WsHealthIndicator', () => {
    const src = readDashboardSrc('components/anti-rug/WsHealthIndicator.tsx');

    it('exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('Test 38: reuses StatusDot semantic palette', () => {
        expect(src).toMatch(/StatusDot/);
        // Per UI-SPEC: connected/reconnecting/disconnected status union
        expect(src).toContain("'connected'");
        expect(src).toContain("'reconnecting'");
        expect(src).toContain("'disconnected'");
    });

    it('Test 39: tooltip text matches UI-SPEC verbatim', () => {
        expect(src).toContain('WebSocket connected to');
        expect(src).toContain('WebSocket reconnecting to');
        expect(src).toContain('WebSocket disconnected from');
    });

    it('Test 40: takes a chain prop (per-chain indicator)', () => {
        expect(src).toMatch(/chain\s*:\s*string/);
    });
});

// ---------------------------------------------------------------------------
// GapDetectedBanner
// ---------------------------------------------------------------------------

describe('Phase 19 — GapDetectedBanner', () => {
    const src = readDashboardSrc('components/anti-rug/GapDetectedBanner.tsx');

    it('exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('Test 49: banner copy includes "[GAP DETECTED]" prefix', () => {
        expect(src).toContain('[GAP DETECTED]');
    });

    it('Test 50: banner copy is the verbatim UI-SPEC string', () => {
        // UI-SPEC §"Per-chain WS-health indicator" gap-detected banner copy:
        expect(src).toContain('missed');
        expect(src).toContain('blocks');
        expect(src).toContain('Backfill skipped');
        expect(src).toContain('Review anti-rug events manually before resuming live mode');
    });

    it('Test 51: localStorage dismissal key includes chain AND fromBlock', () => {
        // Per UI-SPEC + Threat T-19-06-07 — key collision protection
        expect(src).toMatch(/antirug-gap-dismissed/);
        expect(src).toMatch(/localStorage/);
        // The key concatenates chain + fromBlock so a new gap event re-shows the banner
        expect(src).toMatch(/fromBlock/);
        expect(src).toMatch(/chain/);
    });

    it('uses warning-border pattern from ChainStatusCard precedent', () => {
        expect(src).toContain('border-warning');
    });
});

// ---------------------------------------------------------------------------
// FrontrunDistributionPanel
// ---------------------------------------------------------------------------

describe('Phase 19 — FrontrunDistributionPanel', () => {
    const src = readDashboardSrc('components/anti-rug/FrontrunDistributionPanel.tsx');

    it('exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('Test 46: panel title is the verbatim UI-SPEC string', () => {
        expect(src).toContain('Frontrun Outcome Distribution');
    });

    it('Test 46b: 3 chart sections present', () => {
        // UI-SPEC §"Frontrun outcome distribution panel"
        expect(src).toContain('Detection latency');
        expect(src).toContain('Flashbots simulate verdict');
        expect(src).toContain('Post-hoc reality');
    });

    it('Test 46c: non-ETH chains collapse Flashbots section with verbatim copy', () => {
        expect(src).toContain('Not applicable on');
    });

    it('Test 47: reuses FilterChips component', () => {
        expect(src).toMatch(/FilterChips/);
    });

    it('Test 47b: filter chip labels per UI-SPEC verbatim', () => {
        expect(src).toContain('V2 Pair.Burn');
        expect(src).toContain('V2 LP transfer to dead');
        expect(src).toContain('V3 Pool.Burn');
        expect(src).toContain('V3 Pool.Collect');
    });

    it('Test 48: empty state heading + body verbatim', () => {
        expect(src).toContain('No dry-run events yet on');
        expect(src).toContain(
            'Anti-rug events will appear here as the bot detects them during the 7-day dry-run window',
        );
    });
});
