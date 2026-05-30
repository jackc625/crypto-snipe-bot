# Phase 11 — UI Review

**Audited:** 2026-04-04
**Baseline:** 11-UI-SPEC.md (approved)
**Screenshots:** Not captured (no dev server detected at localhost:3000, :5173, or :8080)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Two spec-declared strings never rendered (restart success toast, positions fetch error copy) |
| 2. Visuals | 3/4 | `not-configured` Telegram state renders red dot instead of spec-specified yellow |
| 3. Color | 4/4 | All tokens correctly applied; no hardcoded colors in Phase 11 files |
| 4. Typography | 4/4 | 3 sizes (xs, sm, xl), 3 weights (normal, bold, mono) — within Phase 8 declared scale |
| 5. Spacing | 4/4 | Arbitrary values are all intentional structural dimensions from Phase 8 origin |
| 6. Experience Design | 3/4 | Health API loading state not guarded — sidebar flashes wrong Telegram status on page load |

**Overall: 21/24**

---

## Top 3 Priority Fixes

1. **Telegram StatusDot renders red for `not-configured`** — Users who have intentionally disabled Telegram see a red error indicator instead of the spec-specified yellow `stopped` dot, making the UI look broken when the bot is healthy. Fix: change `Sidebar.tsx` line 63-65 to `telegramStatus === 'connected' ? 'connected' : telegramStatus === 'not-configured' ? 'stopped' : 'disconnected'`.

2. **Page-load Telegram status flashes `not-configured` for all users** — `Layout.tsx` resolves `telegramStatus` to `'not-configured'` when `!healthData` (during the initial fetch), so every user briefly sees "Telegram: Not configured" with a yellow dot before the health response arrives. Fix: destructure `loading` from `useApi` and pass a fourth state (e.g., `'loading'`) to Sidebar, or hold the value as `null` until data arrives and render nothing.

3. **Two spec-declared copy strings have no implementation** — "Chain {name} restarted successfully" / "Chain {name} restarted with warnings" toasts and "Unable to load positions. Retrying..." are in the Copywriting Contract but do not appear anywhere in the code. `ChainControls.tsx` silently calls `refetch()` on success. Fix: add a transient success/partial-success toast after `handleStartConfirm` resolves, and wire a visible error state in `PositionTable` when positions data is `null`.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

All three Telegram status labels match the spec exactly:
- `Sidebar.tsx:71` — "Telegram: Connected"
- `Sidebar.tsx:73` — "Telegram: Not configured"
- `Sidebar.tsx:74` — "Telegram: Disconnected"

Stale price copy matches spec exactly:
- `PositionTable.tsx:110` — `(stale)` suffix
- `PositionTable.tsx:106` — `title="Live price unavailable. Showing last known value."`

`aria-label="Dismiss warnings"` present at `ChainStatusCard.tsx:76`.

Empty state copy matches spec:
- `PositionTable.tsx:24` — "No Open Positions"
- `PositionTable.tsx:25-27` — "The bot is running but has not entered any positions yet. New snipes will appear here in real time."

**Gap — restart success toast:** The Copywriting Contract declares "Chain {name} restarted successfully" and "Chain {name} restarted with warnings" as required copy. Neither appears in `ChainControls.tsx`. After `handleStartConfirm` succeeds, the function only calls `refetch()` with no user-visible feedback.

**Gap — positions fetch error:** The spec declares "Unable to load positions. Retrying..." for the positions fetch error state. This string does not appear anywhere in `PositionTable.tsx` or the parent Overview page. When the positions API fails, the component falls through to the empty state, conflating an error with genuinely no positions.

**Neutral — error format deviation:** `ChainControls.tsx:48,79` produces error messages like "Failed to start {name}: {message}. Check RPC configuration." rather than the spec's "Failed to restart {name}. Check bot logs for details." The wording is longer and redirects to "RPC configuration" instead of "bot logs" — a minor tone inconsistency but not spec-breaking since the chain stop/start errors are not explicitly in the contract table.

---

### Pillar 2: Visuals (3/4)

Visual hierarchy is clear: chain cards use `bg-surface-light` on `bg-surface` background, consistent with the 60/30 split. Stale price is visually differentiated via `text-warning` color change without adding decorative icons, correctly following the spec's "no animation, no icon" directive.

**Bug — `not-configured` dot color mismatch:**

The Interaction States table in the spec specifies:

| State | StatusDot | When |
|-------|-----------|------|
| Not configured | `stopped` (yellow, static) | Env vars missing |

However `Sidebar.tsx` lines 61-66 always pass either `'connected'` or `'disconnected'` to `StatusDot`:
```
status={
  telegramStatus === 'connected'
    ? 'connected'
    : 'disconnected'   // <-- catches both 'disconnected' AND 'not-configured'
}
```

`StatusDot` maps `'disconnected'` to `bg-loss` (red). The spec maps `not-configured` to `stopped` (yellow). A user who has intentionally not configured Telegram sees a red dot identical to an error state, creating a false alarm.

Warning banner rendering in `ChainStatusCard.tsx` matches spec layout precisely: `border-l-2 border-warning bg-surface rounded-r-lg px-4 py-3 mb-4 relative`.

---

### Pillar 3: Color (4/4)

Phase 11 modified files (`PositionTable.tsx`, `Sidebar.tsx`, `Layout.tsx`, `ChainStatusCard.tsx`, `ChainControls.tsx`) contain zero hardcoded hex values. All color usage goes through design tokens.

Warning color usage in Phase 11 files:
- `PositionTable.tsx:105` — `text-warning` on stale price cell (spec-specified)
- `ChainStatusCard.tsx:71` — `border-warning` on restart warning banner (spec-specified)
- `ChainStatusCard.tsx:84` — `text-warning` on warning text (spec-specified)

Accent usage in Phase 11 files:
- `ChainStatusCard.tsx:54` — `bg-accent` on "Start Listening" button (spec-specified for neutral confirmation)
- `PositionTable.tsx:168` — `bg-accent` in urgency gauge below 70% (pre-existing Phase 8 logic, spec-compliant)

Hardcoded hex values found in `ExposureDonut.tsx` and `PnLChart.tsx` are pre-existing Phase 8 files not modified in Phase 11. They use chain identity colors and chart library configuration objects that cannot use CSS custom properties — this is an acceptable carve-out.

---

### Pillar 4: Typography (4/4)

Font sizes in Phase 11 modified files: `text-xs` (12px), `text-sm` (14px), `text-xl` (20px). All three map directly to the Phase 8 declared typography roles (Label, Body, Heading). No new sizes introduced.

Font weights: `font-normal`, `font-bold`, `font-mono`. Within the declared Phase 8 weight set.

The heading in `ChainControls.tsx:116` uses `text-xl font-bold leading-[1.2]` which exactly matches the spec's Heading role (20px, 700, line-height 1.2).

No issues found.

---

### Pillar 5: Spacing (4/4)

Standard spacing classes in Phase 11 modified files follow the inherited Phase 8 scale well. Most common values: `px-4` (16px, md), `py-3` (12px, between sm and md), `gap-2` (8px, sm), `mb-4` (16px, md).

Arbitrary values present:
- `PositionTable.tsx:98` — `min-h-[44px]` (touch target minimum, structural)
- `Sidebar.tsx:23` — `w-[56px]`, `w-[240px]` (collapsed/expanded widths, structural)
- `Sidebar.tsx:38-39` — `border-l-[3px]`, `pl-[13px]` (optical alignment compensation, intentional)

These are all pre-existing Phase 8 structural dimensions that cannot be expressed with standard spacing tokens. They are justified exceptions.

The `mt-1` between WebSocket status and Telegram status at `Sidebar.tsx:60` matches the spec exactly ("Spacing: `mt-1` (4px) between WS status line and Telegram status line").

No spacing regressions introduced.

---

### Pillar 6: Experience Design (3/4)

**Bug — Telegram status flashes wrong value during initial load:**

`Layout.tsx:22` resolves `telegramStatus` using:
```typescript
: healthData?.telegramError === 'Not configured' || !healthData
? 'not-configured'
```

The `loading` return value from `useApi` is not destructured. Until the `/health` call resolves, `!healthData` is `true` and `telegramStatus` is `'not-configured'`. Combined with the `not-configured` → `disconnected` StatusDot bug (Pillar 2), on every page load the sidebar shows a red "Telegram: Not configured" dot before switching to the correct state. For a healthy bot with Telegram configured, this is a false alarm on every page load.

**Good — Error states fully covered in ChainControls:**
Three distinct error surfaces: `error` (API load failure), `actionError` (start/stop failure), `emergencyError` (emergency sell failure). Each has its own `border-l-4 border-loss` banner. All three catch blocks properly extract error messages.

**Good — Empty state in ChainControls:**
`ChainControls.tsx:160-163` — "No chains configured. Check bot configuration." guarded with `!error` to avoid conflating empty data with an error state.

**Good — Disabled state for disconnected chains:**
`ChainStatusCard.tsx:61-63` — disconnected chain button has `disabled` attribute and `cursor-not-allowed` class.

**Gap — No loading state during chain start/stop:**
After clicking "Start" or "Stop", there is no button spinner or disabled state while the POST request is in-flight. A user could double-click and send duplicate requests. This is a pre-existing Phase 8 pattern, not a Phase 11 regression.

**Gap — No loading indicator in ChainControls while chains data fetches:**
`ChainControls.tsx` does not use the `loading` value from `useApi('/api/chains')`. The grid area is empty until data arrives with no skeleton or spinner. Pre-existing, not a Phase 11 regression.

---

## Registry Safety

No shadcn initialized (`components.json` not found). Registry audit skipped per protocol.

---

## Files Audited

**Phase 11 modified UI files:**
- `dashboard/src/components/PositionTable.tsx`
- `dashboard/src/components/Sidebar.tsx`
- `dashboard/src/components/Layout.tsx`
- `dashboard/src/components/ChainStatusCard.tsx`
- `dashboard/src/pages/ChainControls.tsx`
- `dashboard/src/types/api.ts`

**Supporting files read for context:**
- `dashboard/src/components/StatusDot.tsx`
- `dashboard/src/hooks/useApi.ts`
- `dashboard/src/index.css`
- `.planning/phases/11-dashboard-accuracy-bot-wiring/11-UI-SPEC.md`
- `.planning/phases/11-dashboard-accuracy-bot-wiring/11-CONTEXT.md`
- `.planning/phases/11-dashboard-accuracy-bot-wiring/11-00-SUMMARY.md` through `11-04-SUMMARY.md`
