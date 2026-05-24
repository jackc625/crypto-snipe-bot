// test/unit/dashboard/anti-rug/interactiveComponents.test.ts
// Phase 19 / Plan 19-06 Task 2b — Interactive component + wiring source guards.
//
// Same source-grep pattern as Task 2a (no @testing-library/react in
// dashboard/package.json). Tests cover:
//
//   CircuitBreakerResetModal (Tests 19-27)
//     - Modal title verbatim per UI-SPEC
//     - N trigger sections with verbatim labels
//     - "I have reviewed this trigger" acknowledge checkboxes
//     - Reset Circuit Breaker confirm-text gate (RESET, case-sensitive)
//     - "Type RESET to confirm" input label
//     - POST /api/anti-rug/circuit-breaker/{chain}/reset endpoint
//     - Inline error rendering on failure
//
//   CircuitBreakerBanner (Tests 28-33)
//     - "ANTI-RUG HALTED ON {CHAIN}" headline
//     - bg-loss full-bleed strip
//     - "Click to review and reset" CTA in accent
//     - No dismiss control (banner only hides on successful reset)
//     - Per-chain chip rendering
//
//   AntiRugExitDetailModal (Tests 41-45)
//     - w-[640px] width per UI-SPEC
//     - 3 variants (live / dry-run / pending-confirm)
//     - "Signals fired" section header
//     - "Exit transaction" section header
//     - "View on Etherscan" link
//     - Tx hash click-to-copy with Copied! toast
//     - No confirm button (read-only)
//
//   PositionTable wiring (Tests 52-53)
//     - Anti-Rug column header between Exit Mode and Time Held
//     - AntiRugStateBadge imported
//
//   Overview mounting (Tests 54-56)
//     - CircuitBreakerBanner imported + mounted at top
//     - AntiRugMonitorTile imported + mounted in grid
//     - FrontrunDistributionPanel imported + mounted
//     - GapDetectedBanner imported + mounted per chain

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function readDashboardSrc(relPath: string): string {
    const p = resolve(__dirname, '../../../../dashboard/src', relPath);
    if (!existsSync(p)) return '';
    return readFileSync(p, 'utf-8').replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------------------
// CircuitBreakerResetModal — highest-stakes interaction
// ---------------------------------------------------------------------------

describe('Phase 19 — CircuitBreakerResetModal', () => {
    const src = readDashboardSrc('components/anti-rug/CircuitBreakerResetModal.tsx');

    it('exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('Test 19/27: modal title is the verbatim UI-SPEC string', () => {
        // UI-SPEC §"CB-reset modal" — `Review and Reset Anti-Rug Circuit Breaker — {CHAIN}`
        expect(src).toContain('Review and Reset Anti-Rug Circuit Breaker');
    });

    it('Test 20: per-trigger acknowledge checkbox label verbatim', () => {
        expect(src).toContain('I have reviewed this trigger');
    });

    it('Test 21/23: RESET-text gate via ConfirmDialog requireConfirmText machinery', () => {
        // Either composes ConfirmDialog with requireConfirmText="RESET", OR
        // inlines an input whose validation is `=== 'RESET'`.
        expect(src).toMatch(/['"]RESET['"]/);
    });

    it('Test 22: "Type RESET to confirm" input label verbatim', () => {
        expect(src).toContain('Type RESET to confirm');
    });

    it('Test 25: POST /api/anti-rug/circuit-breaker/{chain}/reset endpoint', () => {
        expect(src).toMatch(/\/api\/anti-rug\/circuit-breaker\//);
        expect(src).toMatch(/method:\s*['"]POST['"]/);
    });

    it('Test 25b: renders inline error on POST failure per UI-SPEC step 7', () => {
        // UI-SPEC: "Reset failed: {error}"
        expect(src).toContain('Reset failed');
    });

    it('Test 21b: Reset button text is "Reset Circuit Breaker"', () => {
        expect(src).toContain('Reset Circuit Breaker');
    });

    it('Test 21c: dismiss label "Close without resetting"', () => {
        expect(src).toContain('Close without resetting');
    });

    it('Test 24: includes acknowledge-state machinery (Set tracking)', () => {
        // N acknowledge checkboxes require a Set<number> or equivalent state.
        expect(src).toMatch(/useState/);
        expect(src).toMatch(/Set</);
    });
});

// ---------------------------------------------------------------------------
// CircuitBreakerBanner
// ---------------------------------------------------------------------------

describe('Phase 19 — CircuitBreakerBanner', () => {
    const src = readDashboardSrc('components/anti-rug/CircuitBreakerBanner.tsx');

    it('exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('Test 31: banner headline includes "ANTI-RUG HALTED ON"', () => {
        expect(src).toContain('ANTI-RUG HALTED ON');
    });

    it('Test 29: uses bg-loss full-bleed strip', () => {
        expect(src).toContain('bg-loss');
    });

    it('Test 32: CTA text is the verbatim "Click to review and reset"', () => {
        expect(src).toContain('Click to review and reset');
    });

    it('Test 32b: CTA uses accent colour per UI-SPEC §Color rule 1', () => {
        expect(src).toMatch(/text-accent|bg-accent/);
    });

    it('Test 30: renders ChainBadge per tripped chain', () => {
        expect(src).toMatch(/ChainBadge/);
    });

    it('Test 33: no dismiss button — only successful reset hides it', () => {
        // No aria-label="Dismiss" on this banner (the UI-SPEC explicit rule)
        expect(src).not.toMatch(/aria-label=["']Dismiss/i);
    });

    it('uses AlertOctagon icon from lucide-react per UI-SPEC §6', () => {
        expect(src).toMatch(/AlertOctagon|lucide-react/);
    });
});

// ---------------------------------------------------------------------------
// AntiRugExitDetailModal
// ---------------------------------------------------------------------------

describe('Phase 19 — AntiRugExitDetailModal', () => {
    const src = readDashboardSrc('components/anti-rug/AntiRugExitDetailModal.tsx');

    it('exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('Test 41: shell width is w-[640px] per UI-SPEC', () => {
        expect(src).toContain('w-[640px]');
    });

    it('Test 42: 3 content variants — live, dry-run, pending-confirm', () => {
        expect(src).toContain("'live'");
        expect(src).toContain("'dry-run'");
        expect(src).toContain("'pending-confirm'");
    });

    it('Test 42b: pending-confirm body copy verbatim', () => {
        expect(src).toContain('Exit pending confirmation');
        expect(src).toContain('blocks of confirmation delay');
    });

    it('Test 42c: dry-run body copy verbatim', () => {
        expect(src).toContain('Dry-run only — no transaction submitted');
    });

    it('Test 43: tx-hash click-to-copy with Copied! toast', () => {
        expect(src).toMatch(/navigator\.clipboard\.writeText/);
        expect(src).toContain('Copied!');
    });

    it('Test 45: "View on Etherscan" link present', () => {
        expect(src).toContain('View on Etherscan');
    });

    it('Test 44: read-only — no confirm button text', () => {
        // The detail modal is read-only — Close is the only button.
        expect(src).toContain('Close');
        // The CB-reset's destructive "Reset Circuit Breaker" text MUST NOT appear here
        expect(src).not.toContain('Reset Circuit Breaker');
    });

    it('Renders "Signals fired" section header', () => {
        expect(src).toContain('Signals fired');
    });

    it('Renders "Exit transaction" section header', () => {
        expect(src).toContain('Exit transaction');
    });

    it('Renders signal row labels per UI-SPEC verbatim', () => {
        expect(src).toContain('LP removed');
        expect(src).toContain('Destination address');
        expect(src).toContain('Allowlist check');
        expect(src).toContain('Sell-sim slippage');
    });
});

// ---------------------------------------------------------------------------
// PositionTable wiring
// ---------------------------------------------------------------------------

describe('Phase 19 — PositionTable Anti-Rug column wiring', () => {
    const src = readDashboardSrc('components/PositionTable.tsx');

    it('Test 52: imports AntiRugStateBadge', () => {
        expect(src).toMatch(/import.*AntiRugStateBadge.*from.*anti-rug\/AntiRugStateBadge/);
    });

    it('Test 52b: renders "Anti-Rug" column header between "Exit Mode" and "Time Held"', () => {
        // The column header text appears
        expect(src).toContain('>Anti-Rug<');
        // And in order: Exit Mode header comes BEFORE Anti-Rug header which comes BEFORE Time Held
        const exitModeIdx = src.indexOf('>Exit Mode<');
        const antiRugIdx = src.indexOf('>Anti-Rug<');
        const timeHeldIdx = src.indexOf('>Time Held<');
        expect(exitModeIdx).toBeGreaterThan(0);
        expect(antiRugIdx).toBeGreaterThan(exitModeIdx);
        expect(timeHeldIdx).toBeGreaterThan(antiRugIdx);
    });

    it('Test 53: renders AntiRugStateBadge per row with position.antiRugState', () => {
        expect(src).toMatch(/<AntiRugStateBadge\s/);
        // Pass-through state from position.antiRugState (with 'unmonitored' default)
        expect(src).toMatch(/antiRugState\s*\?\?\s*['"]unmonitored['"]/);
    });
});

// ---------------------------------------------------------------------------
// Overview mounting
// ---------------------------------------------------------------------------

describe('Phase 19 — Overview anti-rug surface mounting', () => {
    const src = readDashboardSrc('pages/Overview.tsx');

    it('Test 54: imports + mounts CircuitBreakerBanner', () => {
        expect(src).toMatch(/import.*CircuitBreakerBanner.*from/);
        expect(src).toMatch(/<CircuitBreakerBanner/);
    });

    it('Test 55: imports + mounts AntiRugMonitorTile', () => {
        expect(src).toMatch(/import.*AntiRugMonitorTile.*from/);
        expect(src).toMatch(/<AntiRugMonitorTile/);
    });

    it('Test 56: imports + mounts FrontrunDistributionPanel', () => {
        expect(src).toMatch(/import.*FrontrunDistributionPanel.*from/);
        expect(src).toMatch(/<FrontrunDistributionPanel/);
    });

    it('Test 56b: imports + mounts GapDetectedBanner', () => {
        expect(src).toMatch(/import.*GapDetectedBanner.*from/);
        expect(src).toMatch(/<GapDetectedBanner/);
    });

    it('imports + conditionally renders CircuitBreakerResetModal', () => {
        expect(src).toMatch(/import.*CircuitBreakerResetModal.*from/);
        expect(src).toMatch(/<CircuitBreakerResetModal/);
    });

    it('reads new state from useWs() hook (circuitBreakerTrips, antiRugEvents, chainWsHealth)', () => {
        expect(src).toMatch(/circuitBreakerTrips/);
        expect(src).toMatch(/antiRugEvents/);
    });
});
