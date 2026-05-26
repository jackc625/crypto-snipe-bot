// test/unit/dashboard/pauseBanner.test.ts
// Phase 20 / Plan 20-06 — PauseBanner.tsx source-grep guards (D-PAUSE-UI).
//
// These tests follow the established dashboard test pattern from Plan 19-06
// (test/unit/dashboard/anti-rug/displayComponents.test.ts + interactiveComponents.test.ts):
// source-text grep guards rather than React render tests, because the project
// does not include @testing-library/react / jsdom in dashboard/package.json or
// the root devDependencies. Comment from displayComponents.test.ts line 6-8 is
// the project-locked rationale:
//   "These tests are source-text grep guards that verify every UI-SPEC verbatim
//    copy string ships in the component source. They are NOT React render tests
//    (the dashboard does not currently include @testing-library/react in
//    dashboard/package.json — the operator-visual checker in Plan 19-07 covers
//    runtime behaviour via fork+browser drill)."
//
// Six behavioural contracts (mirrors the plan's 6 RTL test scenarios verbatim):
//   Test 1: paused=false → component returns null (early return)
//   Test 2: paused=true → renders BOT PAUSED + pausedBy + reason + Resume button
//   Test 3: pausedAt unix-second formatting (toLocaleString())
//   Test 4: Resume button POSTs /api/controls/resume with credentials: 'include'
//   Test 5: useWs().pauseState === null → component returns null (initial state)
//   Test 6: card-idiom red-alert classes (bg-surface-light border-loss border-l-4 rounded-lg) — NOT full-bleed (per 20-10 cosmetic restyle)
//
// Plus interface-shape guards on WebSocketContext + useWebSocket + Layout + api.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function readDashboardSrc(relPath: string): string {
    const p = resolve(__dirname, '../../../dashboard/src', relPath);
    if (!existsSync(p)) return '';
    return readFileSync(p, 'utf-8').replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------------------
// PauseBanner.tsx — card-idiom red-alert banner (D-PAUSE-UI; restyled in 20-10)
// ---------------------------------------------------------------------------

describe('Phase 20 — PauseBanner.tsx', () => {
    const src = readDashboardSrc('components/PauseBanner.tsx');

    it('exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('Test 1: returns null when pauseState is null or paused is false', () => {
        // Plan's verbatim early-return expression
        expect(src).toContain('if (!pauseState || !pauseState.paused) return null');
    });

    it('Test 2: renders BOT PAUSED headline per D-PAUSE-UI banner copy', () => {
        // Banner copy: "BOT PAUSED — since {ts} by {pausedBy}"
        expect(src).toContain('BOT PAUSED');
    });

    it('Test 2: renders the Resume button per D-PAUSE-UI', () => {
        expect(src).toContain('Resume');
    });

    it('Test 2: reads pausedBy from pauseState', () => {
        // Interpolation of pausedBy (with unknown fallback)
        expect(src).toMatch(/pauseState\.pausedBy/);
    });

    it('Test 2: reads reason from pauseState with no-reason-provided fallback', () => {
        // Interpolation of reason (with explicit fallback string per D-PAUSE-UI banner copy)
        expect(src).toMatch(/pauseState\.reason/);
    });

    it('Test 3: formats pausedAt unix seconds as a human-readable date', () => {
        // `new Date(ts * 1000).toLocaleString()` per plan action
        expect(src).toMatch(/new Date\([^)]*\* 1000\)/);
        expect(src).toContain('toLocaleString');
    });

    it('Test 4: Resume button POSTs /api/controls/resume with credentials include', () => {
        expect(src).toContain('/api/controls/resume');
        expect(src).toMatch(/method:\s*['"]POST['"]/);
        expect(src).toMatch(/credentials:\s*['"]include['"]/);
    });

    it('Test 4: Resume POST does NOT setState/setPauseState locally (WS event drives unmount)', () => {
        // After the fetch, the component must NOT mutate pauseState in any way:
        // the WS pause_state_change event from broadcaster drives the unmount.
        // Concretely, the body of handleResume contains no setPauseState call.
        expect(src).not.toMatch(/setPauseState\s*\(/);
    });

    it('Test 5: subscribes to useWs() pauseState (initial null state implicit)', () => {
        // Per plan's key_link pattern: `const { pauseState } = useWs();`
        expect(src).toMatch(/useWs\(\)/);
        expect(src).toMatch(/pauseState/);
    });

    it('Test 6: card-idiom red-alert classes ship (not full-bleed)', () => {
        // 20-10 cosmetic restyle: the banner is now a contained dashboard card
        // (bg-surface-light + border + rounded-lg + p-4) with a red left-border
        // alarm accent (border-loss border-l-4), NOT the old full-bleed bg-loss slab.
        expect(src).toContain('bg-surface-light');
        expect(src).toContain('border-loss');
        expect(src).toContain('border-l-4');
        expect(src).toContain('rounded-lg');
        // The removed full-bleed negative margins must be gone.
        expect(src).not.toContain('-mx-4 sm:-mx-6 lg:-mx-8');
    });

    it('Test 6: Resume button uses the solid dashboard button style', () => {
        // 20-10: Resume is now a solid bg-accent button, not underlined text.
        expect(src).toContain('bg-accent text-white');
    });

    it('imports a lucide-react pause-family icon for visual parity with CB banner', () => {
        // Plan action prescribes PauseCircle (or any pause-family lucide-react icon)
        expect(src).toMatch(/from\s+['"]lucide-react['"]/);
    });
});

// ---------------------------------------------------------------------------
// WebSocketContext.tsx — pauseState field added to context value
// ---------------------------------------------------------------------------

describe('Phase 20 — WebSocketContext.tsx', () => {
    const src = readDashboardSrc('hooks/WebSocketContext.tsx');

    it('exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('extends WebSocketContextValue with a pauseState field', () => {
        // Plan must_haves.artifacts: WebSocketContextValue extended with pauseState
        expect(src).toMatch(/pauseState:/);
    });

    it('imports PauseState from ../types/api', () => {
        // Plan action: `import the new PauseState type from '../types/api'`
        expect(src).toContain('PauseState');
    });
});

// ---------------------------------------------------------------------------
// useWebSocket.ts — pause_state_change WS dispatch case + initial state load
// ---------------------------------------------------------------------------

describe('Phase 20 — useWebSocket.ts', () => {
    const src = readDashboardSrc('hooks/useWebSocket.ts');

    it('exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('handles the pause_state_change WS event', () => {
        // Plan key_link pattern: `case 'pause_state_change': setPauseState(...)`
        expect(src).toContain('pause_state_change');
    });

    it('exposes pauseState in the hook return value', () => {
        expect(src).toMatch(/pauseState/);
    });

    it('hydrates initial pauseState via GET /api/controls/pause', () => {
        // Plan must_haves.truths: "Initial state loaded via useApi('/api/controls/pause') GET on dashboard mount"
        expect(src).toContain('/api/controls/pause');
    });

    it('imports PauseState type', () => {
        expect(src).toContain('PauseState');
    });
});

// ---------------------------------------------------------------------------
// Layout.tsx — PauseBanner mounted above main content
// ---------------------------------------------------------------------------

describe('Phase 20 — Layout.tsx', () => {
    const src = readDashboardSrc('components/Layout.tsx');

    it('exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('imports the PauseBanner component', () => {
        // Plan must_haves.artifacts: <PauseBanner /> mounted above <main>
        expect(src).toMatch(/import\s*\{[^}]*PauseBanner[^}]*\}\s*from\s*['"]\.\/PauseBanner['"]/);
    });

    it('mounts <PauseBanner /> JSX', () => {
        expect(src).toContain('<PauseBanner');
    });
});

// ---------------------------------------------------------------------------
// api.ts — PauseState + PauseStateChangePayload type exports
// ---------------------------------------------------------------------------

describe('Phase 20 — api.ts types', () => {
    const src = readDashboardSrc('types/api.ts');

    it('exists at the expected location', () => {
        expect(src.length).toBeGreaterThan(0);
    });

    it('exports PauseState interface', () => {
        // Plan action: PauseState { paused, pausedAt, pausedBy, reason }
        expect(src).toMatch(/export\s+interface\s+PauseState\b/);
    });

    it('exports PauseStateChangePayload interface', () => {
        expect(src).toMatch(/export\s+interface\s+PauseStateChangePayload\b/);
    });

    it('PauseState includes the 4 required fields', () => {
        // paused / pausedAt / pausedBy / reason
        const pauseStateBlock = src.match(/export\s+interface\s+PauseState\b[\s\S]*?\n\}/);
        expect(pauseStateBlock).not.toBeNull();
        const block = pauseStateBlock![0];
        expect(block).toMatch(/paused\s*:/);
        expect(block).toMatch(/pausedAt\s*:/);
        expect(block).toMatch(/pausedBy\s*:/);
        expect(block).toMatch(/reason\s*:/);
    });

    it('pausedBy uses the 4-sentinel union from Plan 20-04 (dashboard | cli | preflight | manual)', () => {
        // Anchors to paused_by canonical set per Plan 20-04 / D-PAUSE-SHAPE
        const pauseStateBlock = src.match(/export\s+interface\s+PauseState\b[\s\S]*?\n\}/);
        expect(pauseStateBlock).not.toBeNull();
        const block = pauseStateBlock![0];
        expect(block).toMatch(/dashboard/);
        expect(block).toMatch(/cli/);
        expect(block).toMatch(/preflight/);
        expect(block).toMatch(/manual/);
    });
});
