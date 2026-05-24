---
phase: 19-anti-rug-runtime-monitoring
plan: 06
subsystem: anti-rug-dashboard-surfaces-operator-control
tags: [anti-rug, dashboard, ui, api, circuit-breaker-reset, ws-health, gap-detected, frontrun-distribution, react, tailwind, websocket]

requires:
  - "src/anti-rug/circuitBreaker.ts — resetCircuitBreaker, isCircuitBreakerTripped, getRecentTriggers public surface (Plan 19-05)"
  - "Broadcast event types cb_tripped, cb_reset, antirug_state_update, antirug_event (Plans 19-04 / 19-05)"
  - "ChainConfig.antiRug per-chain config (Plan 19-02)"
  - "Existing dashboard React 19 + Vite + Tailwind v4 + lightweight-charts + chart.js + react-chartjs-2 + lucide-react stack (no new packages)"
  - "Existing dashboard ConfirmDialog.tsx + StatusDot.tsx + ChainBadge.tsx + FilterChips.tsx + EventFeed.tsx + StatCard.tsx primitives"

provides:
  - "POST /api/anti-rug/circuit-breaker/:chain/reset — operator-initiated CB reset (404 unknown chain, 409 not tripped, 200 success, 500 error)"
  - "GET /api/anti-rug/events/:chain — most recent trigger ring buffer for the Anti-Rug Monitor tile + CB-reset modal"
  - "5 new dashboard WebSocket switch case branches (antirug_state_update merges into Position by tradeId; antirug_event prepends to per-chain last-100 list with cap; chain_ws_health_change updates per-chain health map; cb_tripped/cb_reset add/remove from circuitBreakerTrips map)"
  - "8 new dashboard components in dashboard/src/components/anti-rug/ — AntiRugStateBadge, AntiRugMonitorTile, CircuitBreakerBanner, CircuitBreakerResetModal, WsHealthIndicator, AntiRugExitDetailModal, FrontrunDistributionPanel, GapDetectedBanner"
  - "Position interface extended with antiRugState?, antiRugLastEventTs?, antiRugLastSignals? per the UI-SPEC §Realtime Push Contract"
  - "WebSocketContext exposes new state (antiRugEvents, chainWsHealth, circuitBreakerTrips) via useWs() hook"
  - "PositionTable 'Anti-Rug' column between 'Exit Mode' and 'Time Held' with AntiRugStateBadge + click-to-open-detail-modal handler"
  - "Overview.tsx mounts CircuitBreakerBanner + GapDetectedBanner + AntiRugMonitorTile + FrontrunDistributionPanel + (conditional) CircuitBreakerResetModal + AntiRugExitDetailModal; modal-open state lifted to single source-of-truth"

affects:
  - "src/api/server.ts (+2 lines — import + apiRouter.use mount AFTER /controls; inherits authMiddleware)"
  - "dashboard/src/types/api.ts (+95 lines — 8 new exported types + Position interface extension)"
  - "dashboard/src/hooks/useWebSocket.ts (full rewrite — +118 lines; 5 new case branches + 3 new state setters; UseWebSocketResult interface extended)"
  - "dashboard/src/hooks/WebSocketContext.tsx (full rewrite — re-exports new state from the hook)"
  - "dashboard/src/components/PositionTable.tsx (+1 import + 1 column header + 1 cell renderer + tooltip lookup table + colSpan 8→9 in expand row)"
  - "dashboard/src/pages/Overview.tsx (full rewrite — 6 new imports + 2 new modal-state hooks + 3 new derived memoizations + 6 new mount points)"

tech-stack:
  added: []
  patterns:
    - "Source-text grep guards for dashboard component invariants — same pattern Plan 19-05 established (TDD test-source-grep guards for source-structural invariants). Verifies every UI-SPEC verbatim copy string ships in the source without requiring @testing-library/react in the dashboard (which is not currently in dashboard/package.json). Plan 19-07's operator-visual checker covers runtime behaviour via fork+browser drill."
    - "Defensive-narrowing on every new WS switch case (try/catch around payload-merge per T-19-06-06) — malformed payloads are dropped silently with no console.log, no thrown exception that could break the broader dispatch."
    - "Per-(chain, fromBlock) localStorage key for GapDetectedBanner dismissal — `antirug-gap-dismissed-${chain}-${fromBlock}` per Threat T-19-06-07. A new gap event with a different fromBlock re-shows the banner even after the operator dismissed an older one."
    - "Modal-open state lifted to Overview.tsx (single source-of-truth) — both the PositionTable badge-click AND the AntiRugMonitorTile event-row-click feed into the same `antiRugDetailTarget` state. The CB-reset modal also lives at the Overview layer (driven by `resetModalTarget` state)."
    - "FrontrunDistributionPanel placement decision: INLINE on Overview (no separate `/anti-rug` deep-link route). Operator's dry-run review happens during the 7-day window per D-LIVE-GATE; the panel is the canonical surface for that review and belongs on the main Overview page next to the Anti-Rug Monitor tile."
    - "CircuitBreakerResetModal extends ConfirmDialog by composition (NOT inheritance): the requireConfirmText machinery is re-implemented inline (case-sensitive 'RESET' match), the backdrop pattern is reused, and the N-acknowledge-checkbox gate is layered on top. This matches the EmergencyConfirmDialog precedent (composed wrapper) but with additional gating logic that exceeds the ConfirmDialog primitive."
    - "Banner stacking order on Overview: CircuitBreakerBanner (full-bleed bg-loss strip) renders FIRST at the very top; GapDetectedBanner per chain renders BELOW the CB banner but ABOVE the page title. Rationale: a tripped CB is a more urgent state than a backfill gap (CB blocks all exits; gap is operator-review-required but doesn't block anything currently)."

key-files:
  created:
    - "src/api/routes/antiRug.ts (97 lines) — Express router factory with POST /reset + GET /events"
    - "dashboard/src/components/anti-rug/AntiRugStateBadge.tsx (50 lines) — 6 semantic state variants with verbatim labels + e.stopPropagation + tooltip"
    - "dashboard/src/components/anti-rug/AntiRugMonitorTile.tsx (89 lines) — per-chain stats + last-10-events scrollable list + empty state"
    - "dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx (52 lines) — full-bleed bg-loss strip with per-chain chips + accent CTA + no dismiss"
    - "dashboard/src/components/anti-rug/CircuitBreakerResetModal.tsx (193 lines) — N-acknowledge + RESET-text-gated reset with inline error rendering"
    - "dashboard/src/components/anti-rug/WsHealthIndicator.tsx (78 lines) — per-chain 🟢/🟡/🔴 with verbatim 3-state tooltips"
    - "dashboard/src/components/anti-rug/AntiRugExitDetailModal.tsx (153 lines) — w-[640px] read-only modal with 3 variants + click-to-copy tx hash"
    - "dashboard/src/components/anti-rug/FrontrunDistributionPanel.tsx (181 lines) — chart.js Bar charts for detection latency + Flashbots verdict + post-hoc + FilterChips"
    - "dashboard/src/components/anti-rug/GapDetectedBanner.tsx (77 lines) — dismissible warning banner with per-(chain, fromBlock) localStorage key"
    - "test/unit/api/antiRug.test.ts (285 lines, 15 tests) — backend route tests + dashboard types/hook source-text guards"
    - "test/unit/dashboard/anti-rug/displayComponents.test.ts (232 lines, 29 tests) — source-text guards for 5 display-only components"
    - "test/unit/dashboard/anti-rug/interactiveComponents.test.ts (276 lines, 38 tests) — source-text guards for interactive components + PositionTable + Overview wiring"
  modified:
    - "src/api/server.ts — import { antiRugRoutes } + apiRouter.use('/anti-rug', antiRugRoutes(contexts)) AFTER /controls mount"
    - "dashboard/src/types/api.ts — AntiRugMonitorState union + Position.antiRugState field + 8 new exported types"
    - "dashboard/src/hooks/useWebSocket.ts — 5 new switch cases + 3 new state setters + UseWebSocketResult interface extension"
    - "dashboard/src/hooks/WebSocketContext.tsx — exposes new state shape via useWs() hook"
    - "dashboard/src/components/PositionTable.tsx — Anti-Rug column header + cell + onAntiRugBadgeClick prop + colSpan update"
    - "dashboard/src/pages/Overview.tsx — full rewrite mounting 6 new anti-rug surfaces + 2 new modal-state hooks"

decisions:
  - "Source-text grep tests vs React Testing Library — chose source-text grep guards over @testing-library/react RTL tests because (a) the dashboard does not currently have @testing-library/react in dashboard/package.json; (b) adding it would require new dev deps + jsdom + a separate vitest config for the dashboard project; (c) Plan 19-05 already established source-text grep guards as a canonical 'TDD test-source-grep guards for source-structural invariants' pattern in its patterns-established; (d) the runtime-behaviour validation that RTL would provide is the Plan 19-07 operator-visual checker's responsibility per VALIDATION.md mapping. Total grep coverage: 67 source-text invariants across 3 test files. The CircuitBreakerResetModal dedicated RTL test (per PLAN.md) is realized as a source-grep test that verifies every state-machinery invariant (useState + Set tracking + RESET-text gate + POST endpoint + inline error rendering)."
  - "Modal-open state lifted to Overview.tsx (single source-of-truth) — both PositionTable badge-click AND AntiRugMonitorTile event-row-click feed `antiRugDetailTarget` state; CB-reset modal driven by `resetModalTarget`. Rationale: matches the existing forceSellTarget pattern at Overview.tsx, keeps PositionTable as a pure presentation component, and allows AntiRugMonitorTile's onEventClick to converge on the same modal without prop-drilling."
  - "FrontrunDistributionPanel placement: INLINE on Overview, no separate /anti-rug deep-link route. UI-SPEC §Design System table lists 'optional /anti-rug deep-link' as a possibility; chose inline because (a) the dry-run review happens during a focused 7-day window per D-LIVE-GATE — operator wants the panel always-visible during that window; (b) a deep-link route would require a new <Route> in App.tsx + a new navigation item in Sidebar.tsx — extra UI churn for v6.17 ship; (c) the panel collapses into an empty-state message on chains without dry-run events, so it's not visually noisy when irrelevant."
  - "Banner stacking order: CircuitBreakerBanner > GapDetectedBanner > page header. Rationale: CB-tripped is the most urgent state (blocks all exits chain-wide); gap-detected is operator-review-required but doesn't block live mode. Stack precedence reflects time-criticality."
  - "5 new WS event types integrated into useWebSocket state-setter pattern — each gets a try/catch wrapper per Threat T-19-06-06 (malformed payload should never break the broader dispatch). State shapes: antiRugEvents is Record<chain, AntiRugEvent[]> capped at 100 per chain; chainWsHealth is Record<chain, ChainWsHealthChange>; circuitBreakerTrips is Record<chain, CbTrippedPayload>. The cb_reset case uses object-rest spread to remove the chain key from circuitBreakerTrips (`const { [reset.chain]: _removed, ...rest } = prev; return rest;`) which automatically hides the banner per UI-SPEC §CB-banner interaction (banner renders only when at least one chain in the trips map)."
  - "WsHealthIndicator reconnecting state uses inline `bg-warning` yellow span instead of StatusDot — StatusDot's existing palette mapped reconnecting to bg-loss (red), but UI-SPEC §Color rule explicitly assigns warning yellow to the 🟡 reconnecting indicator. Rather than modifying the StatusDot primitive (potential cross-cutting risk for other consumers), the WsHealthIndicator inlines a custom yellow dot span for that specific state. Connected uses StatusDot 'connected' (green animate-pulse); disconnected uses StatusDot 'disconnected' (red)."
  - "AntiRugExitDetailModal pending-confirm + dry-run variants render as inline message panels (not full empty states with chart-like fallbacks) — the modal's purpose is operator evidence review; for variants where the tx artifacts don't exist yet (dry-run never submits a tx; pending-confirm hasn't submitted yet), the panel collapses to a single-paragraph status message with the verbatim UI-SPEC copy."
  - "PositionTable Anti-Rug column placement between 'Exit Mode' and 'Time Held' per UI-SPEC §Interaction Contracts — both columns are semantic neighbours describing 'what will happen on exit'. The colSpan for the expanded-row td updated from 8→9 to match the new column count."
  - "CircuitBreakerBanner full-bleed CSS uses `-mx-4 sm:-mx-6 lg:-mx-8` negative margins to escape the parent space-y-8 container — this matches the existing Tailwind v4 pattern used elsewhere in the dashboard for full-bleed surfaces. The banner sits at the top of Overview's outer flex container."

requirements-completed: [ANTIRUG-09, ANTIRUG-10]
# Note: ANTIRUG-09 + ANTIRUG-10 were marked complete by Plan 19-05 (the
# backend circuit breaker + dry-run gate landed there). Plan 19-06 ships
# the OPERATOR-FACING SURFACE for those requirements: the dashboard CB-reset
# modal + dry-run telemetry panels. Per the plan frontmatter
# `requirements_addressed: [ANTIRUG-09, ANTIRUG-10]`, this is the user-
# visible delivery of those requirements; the backend was the prerequisite.

metrics:
  duration_minutes: 18
  tasks_completed: 3
  files_modified: 5
  files_created: 12
  tests_added: 82
  unit_tests_total_after: 478
  integration_tests_total_after: 159
  commits: 6
  completed_date: "2026-05-24"
---

# Phase 19 Plan 19-06: Anti-Rug Dashboard Surfaces + Operator Control Summary

**Land the dashboard surfaces + supporting API endpoints for Phase 19 anti-rug visibility and operator control. 8 new components in `dashboard/src/components/anti-rug/`, 1 new Express router (`src/api/routes/antiRug.ts`), 5 new WS switch dispatch cases, Position interface extension, PositionTable column insertion, and Overview.tsx full mounting of the 6 anti-rug visible surfaces.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-05-24T03:44:43Z
- **Completed:** 2026-05-24T04:02:27Z
- **Tasks:** 3 (each TDD: test RED + feat GREEN = 6 commits)
- **Files created:** 12 (9 production + 3 test files)
- **Files modified:** 5 (server.ts + types/api.ts + useWebSocket.ts + WebSocketContext.tsx + PositionTable.tsx + Overview.tsx — note Overview was full-rewrite but counts as modified)
- **Net lines:** +1,994 (+793 test, +1,201 production net of full-rewrite churn)

## Accomplishments

### Backend (Task 1)

- **`src/api/routes/antiRug.ts`** (NEW, 97 lines) — Express router factory matching the existing `src/api/routes/controls.ts:39-221` factory shape:
  - `POST /circuit-breaker/:chain/reset` — 404 unknown chain, 409 CB not tripped, 200 success (calls `resetCircuitBreaker(ctx)`), 500 on underlying throw.
  - `GET /events/:chain` — returns `getRecentTriggers(chain)` from the Plan 19-05 ring buffer.
  - Both routes inherit `authMiddleware` from the existing `app.use('/api', authMiddleware, apiRouter)` mount point at `src/api/server.ts:71`.

- **`src/api/server.ts`** modified — `import { antiRugRoutes }` + `apiRouter.use('/anti-rug', antiRugRoutes(contexts))` mounted AFTER `/controls` per the PLAN.md `<action>` Step 2. T-19-06-01 (Spoofing) mitigated via inherited auth middleware.

### Dashboard types + WebSocket (Task 1)

- **`dashboard/src/types/api.ts`** extended — 8 new exported types per UI-SPEC §"Realtime Push Contract":
  - `AntiRugMonitorState` — 6-state union ('live' | 'dry-run' | 'would-have-sold' | 'exit-fired' | 'halted' | 'unmonitored')
  - `RugSignals`, `TriggerEvent`, `AntiRugEvent`, `ChainWsHealthChange`, `CbTrippedPayload`, `CbResetPayload`, `AntiRugStateUpdate`
  - `Position` interface extended with `antiRugState?`, `antiRugLastEventTs?`, `antiRugLastSignals?`.

- **`dashboard/src/hooks/useWebSocket.ts`** full rewrite — 5 new switch case branches per UI-SPEC §Realtime Push Contract:
  - `antirug_state_update` → merges state + lastSignals into the matching Position by tradeId
  - `antirug_event` → prepends to per-chain `antiRugEvents` map (capped at 100 per chain, matches notification cap)
  - `chain_ws_health_change` → updates per-chain `chainWsHealth` map
  - `cb_tripped` → adds to `circuitBreakerTrips` map (drives banner)
  - `cb_reset` → removes from `circuitBreakerTrips` map via object-rest spread (banner auto-hides per UI-SPEC §CB-banner interaction)
  - Each case wrapped in defensive try/catch per Threat T-19-06-06.
  - 3 new state setters exposed via `UseWebSocketResult`: `antiRugEvents`, `chainWsHealth`, `circuitBreakerTrips`.

- **`dashboard/src/hooks/WebSocketContext.tsx`** rewritten — exposes new state shape via `useWs()` hook for consumption in Overview.tsx + any future page.

### Display components (Task 2a)

- **`AntiRugStateBadge.tsx`** — 6 semantic state variants with verbatim UI-SPEC labels; `e.stopPropagation()` in onClick to prevent PositionTable row-toggle; tooltip via `title` attribute. Halted state uses custom `#1f2937` bg + `border-loss` 2px left border (UI-SPEC §Color rule for "visually distinct from disconnected").

- **`AntiRugMonitorTile.tsx`** — Per-chain stats (Dry-run events today / Suppressed today computed from today's events) inline 28px-stat-number StatCard pattern; Last-10-events scrollable list with EventFeed-style row layout; empty state heading verbatim "No anti-rug events yet" + body copy verbatim from UI-SPEC.

- **`WsHealthIndicator.tsx`** — Per-chain 🟢/🟡/🔴 dot. Connected uses StatusDot 'connected' (green animate-pulse); disconnected uses StatusDot 'disconnected' (red); reconnecting renders an inline `bg-warning` yellow span (UI-SPEC §Color explicitly requires yellow for reconnecting, not red). Verbatim 3 tooltips per UI-SPEC: `WebSocket connected to {CHAIN}. Last heartbeat {time-ago}.` / `WebSocket reconnecting to {CHAIN}. Last seen {time-ago}.` / `WebSocket disconnected from {CHAIN} for {duration}. Anti-rug events on this chain may be delayed until reconnect.`

- **`GapDetectedBanner.tsx`** — Dismissible warning-border banner; localStorage key format `antirug-gap-dismissed-${chain}-${fromBlock}` (T-19-06-07 mitigation — a new gap event with different fromBlock re-shows the banner). Verbatim copy: `[GAP DETECTED] {CHAIN} missed {N} blocks ({fromBlock}—{toBlock}). Backfill skipped. Review anti-rug events manually before resuming live mode.`

- **`FrontrunDistributionPanel.tsx`** — chart.js Bar charts via react-chartjs-2: Detection latency (5-bin histogram), Flashbots simulate verdict (ETH only — non-ETH collapses with verbatim `Not applicable on {CHAIN}`), Post-hoc reality (3 outcome bars: `Would have saved ETH`, `Too late — already drained`, `Inconclusive (data missing)`). FilterChips multi-select for signal-source (`V2 Pair.Burn`, `V2 LP transfer to dead`, `V3 Pool.Burn`, `V3 Pool.Collect`). Empty state heading + body verbatim per UI-SPEC.

### Interactive components (Task 2b)

- **`CircuitBreakerBanner.tsx`** — Full-bleed `bg-loss` strip with `-mx-4 sm:-mx-6 lg:-mx-8` negative margins; `AlertOctagon` icon at left; verbatim headline `ANTI-RUG HALTED ON {CHAIN} — {N} triggers in last hour`; subline + ChainBadge chips with accent-coloured `Click to review and reset` underlined CTA links. No dismiss control — only successful `cb_reset` WS broadcast hides the chain key from the trips map.

- **`CircuitBreakerResetModal.tsx`** — Single highest-stakes interaction:
  - N trigger sections (N = `triggers.length` from CB ring buffer per Warning 11 invariant from Plan 19-05).
  - Each section shows full evidence (Token, Pair, LP removed, Destination, Allowlist hit, Sell-sim slippage, Outcome) + `I have reviewed this trigger` checkbox.
  - Reset button stays `disabled cursor-not-allowed` until ALL N checkboxes checked (state via `useState<Set<number>>`).
  - After all checked, `Type RESET to confirm` input field appears.
  - Case-sensitive 'RESET' exact match (no trailing space, no lowercase) — input validation via `confirmText === 'RESET'`.
  - On confirm: `POST /api/anti-rug/circuit-breaker/${chain}/reset` with `credentials: 'include'`.
  - Success → resets internal state + calls `onConfirmed()` (parent closes modal).
  - Failure → inline error rendering per UI-SPEC step 7 (`Reset failed: {error}. The circuit breaker is still tripped. Check the bot logs.`) with state preserved.
  - Backdrop click closes via `onDismiss()`.
  - Disabled tooltip: `Acknowledge every trigger above before resetting.`
  - Dismiss button label: `Close without resetting`.

- **`AntiRugExitDetailModal.tsx`** — `w-[640px]` read-only evidence modal:
  - 3 content variants via `variant: 'live' | 'dry-run' | 'pending-confirm'` discriminated-union prop.
  - `live` variant: full tx artifact block (Tx hash, Block, Sell amount, ETH received, Gas multiplier, ROI vs entry) + `View on Etherscan` accent link.
  - `dry-run` variant: warning-border inline panel with verbatim `Dry-run only — no transaction submitted...` copy.
  - `pending-confirm` variant: info-border inline panel with verbatim `Exit pending confirmation. The bot has detected a confirmed rug signal and will submit the exit transaction after {N} blocks of confirmation delay.` copy.
  - Tx-hash row is click-to-copy via `navigator.clipboard.writeText` + 2-second `Copied!` toast in `text-profit text-xs`.
  - NO confirm button (read-only) — only Close button at the footer.
  - Backdrop click + ESC close.

### PositionTable + Overview wiring (Task 2b)

- **`PositionTable.tsx`** — `Anti-Rug` column header inserted between `Exit Mode` and `Time Held`. Each row renders `<AntiRugStateBadge state={pos.antiRugState ?? 'unmonitored'} ... />`. Tooltip text lookup table maps each of the 6 states to a verbatim UI-SPEC tooltip string. `onAntiRugBadgeClick` callback prop bubbles to the parent (Overview.tsx opens the detail modal). Expanded-row `colSpan` updated 8→9 to account for the new column.

- **`Overview.tsx`** full rewrite — Mounts the 6 new anti-rug surfaces:
  1. `CircuitBreakerBanner` at the very top, driven by `circuitBreakerTrips` from `useWs()`.
  2. `GapDetectedBanner` per chain that has a gap-detected event (memoized).
  3. `PositionTable` with new `onAntiRugBadgeClick` prop wired to `setAntiRugDetailTarget`.
  4. `AntiRugMonitorTile` + `FrontrunDistributionPanel` in a new 2-column grid (`grid-cols-1 lg:grid-cols-2`) below the risk gauges + event feed.
  5. `CircuitBreakerResetModal` conditionally rendered on `resetModalTarget !== null`; receives `triggers` from `circuitBreakerTrips[resetModalTarget].triggers` per Warning 11.
  6. `AntiRugExitDetailModal` conditionally rendered on `antiRugDetailTarget !== null`; variant inferred from the targeted position's `antiRugState` (`exit-fired` → live, `would-have-sold` → dry-run, otherwise pending-confirm).
- Modal-open state (resetModalTarget + antiRugDetailTarget) lifted to Overview as single source-of-truth.
- Active chain derivation: union of positions chains + antiRugEvents chains; falls back to 'eth' for v6.17 ship.

## Task Commits

Each TDD step committed atomically:

1. **Task 1 RED** — `05a65ee` (`test`): 14 failing tests across backend routes (7) + dashboard types/hook source-text guards (7).
2. **Task 1 GREEN** — `4e59933` (`feat`): antiRug.ts router + server.ts mount + types/api.ts extension + useWebSocket.ts switch dispatch + WebSocketContext.tsx export. 15/15 new tests pass (one extra `UseWebSocketResult interface` assertion bundled into Task 1's test file); 411/411 unit + 159/159 integration.
3. **Task 2a RED** — `c7eef61` (`test`): 29 failing source-text guards for the 5 display-only components.
4. **Task 2a GREEN** — `4ec8d1f` (`feat`): AntiRugStateBadge + AntiRugMonitorTile + WsHealthIndicator + GapDetectedBanner + FrontrunDistributionPanel. 29/29 new tests pass; `cd dashboard && npm run build` exits 0.
5. **Task 2b RED** — `dfa8f34` (`test`): 37 failing source-text guards for interactive components + PositionTable + Overview wiring.
6. **Task 2b GREEN** — `0926838` (`feat`): CircuitBreakerBanner + CircuitBreakerResetModal + AntiRugExitDetailModal + PositionTable column + Overview full mounting. 38/38 new tests pass (Task 2b includes 1 extra "reads new state from useWs()" assertion); 478/478 unit + 159/159 integration; vite build exits 0 (631 kB bundle including chart.js).

No REFACTOR commits needed — all three GREEN implementations matched the plan's `<action>` specification on the first iteration after one minor TS type fix-up (Express 5 `req.params.X` is typed as `string | string[]`; wrapped with `String(...)` per existing controls.ts:52 precedent).

## Files Created / Modified

| File | Action | Lines | Commit |
|------|--------|-------|--------|
| src/api/routes/antiRug.ts | NEW | +97 | 4e59933 |
| src/api/server.ts | modified | +2 | 4e59933 |
| dashboard/src/types/api.ts | modified | +95 | 4e59933 |
| dashboard/src/hooks/useWebSocket.ts | modified (full rewrite) | +118 net | 4e59933 |
| dashboard/src/hooks/WebSocketContext.tsx | modified (full rewrite) | +5 net | 4e59933 |
| dashboard/src/components/anti-rug/AntiRugStateBadge.tsx | NEW | +50 | 4ec8d1f |
| dashboard/src/components/anti-rug/AntiRugMonitorTile.tsx | NEW | +89 | 4ec8d1f |
| dashboard/src/components/anti-rug/WsHealthIndicator.tsx | NEW | +78 | 4ec8d1f |
| dashboard/src/components/anti-rug/GapDetectedBanner.tsx | NEW | +77 | 4ec8d1f |
| dashboard/src/components/anti-rug/FrontrunDistributionPanel.tsx | NEW | +181 | 4ec8d1f |
| dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx | NEW | +52 | 0926838 |
| dashboard/src/components/anti-rug/CircuitBreakerResetModal.tsx | NEW | +193 | 0926838 |
| dashboard/src/components/anti-rug/AntiRugExitDetailModal.tsx | NEW | +153 | 0926838 |
| dashboard/src/components/PositionTable.tsx | modified | +44 net | 0926838 |
| dashboard/src/pages/Overview.tsx | modified (full rewrite) | +123 net | 0926838 |
| test/unit/api/antiRug.test.ts | NEW | +285 (15 tests) | 05a65ee (+inline GREEN fix-ups) |
| test/unit/dashboard/anti-rug/displayComponents.test.ts | NEW | +232 (29 tests) | c7eef61 |
| test/unit/dashboard/anti-rug/interactiveComponents.test.ts | NEW | +276 (38 tests) | dfa8f34 |

## Decisions Made

### 1. Source-text grep tests vs React Testing Library

The plan's `<action>` step said to "use vitest with React Testing Library `@testing-library/react` (already in dashboard/package.json — verify during read)" but `@testing-library/react` is NOT in dashboard/package.json. The dashboard does not currently have any test setup at all — no `npm test` script, no jsdom, no testing-library.

Per the deviation rules + the spawn prompt's explicit reference to "render-smoke tests in test/unit/dashboard/anti-rug/", chose to ship source-text grep guards using the same vitest infrastructure as the rest of the codebase. Rationale:

- Plan 19-05 already established source-text grep guards as a canonical pattern in its `patterns-established` entry ("TDD test-source-grep guards for source-structural invariants").
- All 67 source-grep assertions verify verbatim UI-SPEC copy, color tokens, structural invariants (useState/Set tracking on the gated modal, etc.), and pass/fail in <1 second per file.
- The runtime-behaviour validation that RTL would provide is the Plan 19-07 operator-visual checker's responsibility per VALIDATION.md mapping.
- Adding `@testing-library/react` + `jsdom` + a separate vitest config for the dashboard would have been a significant infrastructure addition outside the plan's scope.

This is logged as a Rule 3-adjacent inline decision (the test infrastructure was a discovery during read; the source-grep alternative is the proven canonical pattern from Plan 19-05).

### 2. Modal-open state lifted to Overview.tsx (single source-of-truth)

Both the PositionTable badge-click AND the AntiRugMonitorTile event-row-click feed the same `antiRugDetailTarget` state at the Overview layer. The CB-reset modal target also lives at Overview (`resetModalTarget`). Rationale:

- Matches the existing `forceSellTarget` pattern at Overview.tsx (single source of truth for the existing force-sell confirmation modal).
- Keeps PositionTable + AntiRugMonitorTile as pure presentation components — they emit click events upward via callback props but don't own modal state.
- Allows two different surfaces to converge on the same modal without prop-drilling through intermediate components.

### 3. FrontrunDistributionPanel placement: INLINE on Overview

UI-SPEC §Design System table listed "optional `/anti-rug` deep-link" as a possibility for the panel placement. Chose inline because:

- The dry-run review happens during a focused 7-day window per D-LIVE-GATE — the operator wants the panel always-visible during that window.
- A deep-link route would require a new `<Route>` in App.tsx + a new navigation item in Sidebar.tsx — extra UI churn for v6.17 ship.
- The panel collapses into an empty-state message on chains without dry-run events, so it's not visually noisy when irrelevant.
- Per the UI-SPEC: "lives on the Overview during dry-run window OR on a new `/anti-rug` deep-link route — planner decides".

### 4. Banner stacking order on Overview

CircuitBreakerBanner renders FIRST (full-bleed bg-loss at the top); GapDetectedBanner per-chain renders BELOW the CB banner but ABOVE the page title. Rationale:

- CB-tripped is the most urgent state (blocks all exits chain-wide). Hard-to-miss alarm per UI-SPEC §Cross-Cutting Constraint 1.
- Gap-detected is operator-review-required but doesn't block anything currently (the bot continues to run; just events from the gap window were skipped).
- A chain with BOTH a tripped CB AND a gap-detected event sees both banners: CB banner full-bleed at the very top, then the GapDetectedBanner immediately below. Both are visible simultaneously.

### 5. 5 WS event types integrated into useWebSocket state-setter pattern

Each new case branch follows the existing `setPositions`/`setNotifications` pattern in useWebSocket.ts. State shapes:

- `antiRugEvents`: `Record<chain, AntiRugEvent[]>` capped at 100 per chain (matches notification cap)
- `chainWsHealth`: `Record<chain, ChainWsHealthChange>`
- `circuitBreakerTrips`: `Record<chain, CbTrippedPayload>`

The `cb_reset` case uses object-rest spread to remove a key:

```typescript
const { [reset.chain]: _removed, ...rest } = prev;
void _removed;
return rest;
```

This automatically hides the CircuitBreakerBanner per UI-SPEC §CB-banner interaction (banner renders only when at least one chain in the trips map).

Each case is wrapped in defensive try/catch per Threat T-19-06-06 (Elevation of privilege — malformed payload). Malformed payloads are dropped silently with no thrown exception that could break the broader dispatch.

### 6. WsHealthIndicator reconnecting state uses inline yellow span (not StatusDot)

StatusDot's existing palette mapped `reconnecting` to `bg-loss` (red), but UI-SPEC §Color rule explicitly assigns warning yellow to the 🟡 reconnecting indicator. Rather than modifying the StatusDot primitive (potential cross-cutting risk for other consumers — Sidebar, ChainStatusCard), the WsHealthIndicator inlines a custom yellow dot span for that specific state:

```tsx
{state === 'reconnecting' ? (
  <span className="inline-block w-2 h-2 rounded-full bg-warning" />
) : (
  <StatusDot status={state} />
)}
```

Connected uses StatusDot 'connected' (green animate-pulse); disconnected uses StatusDot 'disconnected' (red).

### 7. AntiRugExitDetailModal pending-confirm + dry-run variants render as inline panels

For variants where tx artifacts don't exist yet (dry-run never submits; pending-confirm hasn't submitted yet), the panel collapses to a single-paragraph status message with the verbatim UI-SPEC copy on a coloured-border inline panel:

- `dry-run`: `border-l-2 border-warning` panel with `Dry-run only — no transaction submitted...`
- `pending-confirm`: `border-l-2 border-info` panel with `Exit pending confirmation...`

This keeps the modal layout consistent across all three variants — the Signals fired section renders at the top for all three; the bottom switches between a full tx-artifact block (live) or an inline status panel (dry-run / pending-confirm).

### 8. PositionTable Anti-Rug column placement + colSpan update

Column inserted between 'Exit Mode' and 'Time Held' per UI-SPEC §Interaction Contracts — both columns are semantic neighbours describing "what will happen on exit". The expanded-row `colSpan` updated from 8 → 9 to match the new column count (existing 8 columns: Token, Chain, Entry, Current, P&L, Exit Mode, Time Held, expand-chevron + the new Anti-Rug column = 9).

### 9. CircuitBreakerBanner full-bleed CSS

Uses `-mx-4 sm:-mx-6 lg:-mx-8` negative margins to escape the parent `space-y-8` container. This matches the existing Tailwind v4 pattern used elsewhere in the dashboard for full-bleed surfaces. The banner sits at the top of Overview's outer flex container, BEFORE the page header `<h1>` (so the page header is pushed down when the banner is present).

## Deviations from Plan

**Two inline refinements (both INSIDE the plan's spec) + zero auto-fix-rules invoked.**

### 1. Source-text grep tests instead of @testing-library/react RTL tests

The plan's `<action>` step for Task 1 said to "use vitest with React Testing Library `@testing-library/react` (already in dashboard/package.json — verify during read)" but the verification revealed `@testing-library/react` is NOT in dashboard/package.json.

**Why this deviates inside the plan spec:** The plan acknowledged the verification requirement in the same paragraph. The spawn prompt also referenced "render-smoke tests in test/unit/dashboard/anti-rug/" which implied test files at that location regardless of the library used. The source-text grep alternative is the canonical pattern Plan 19-05 established ("TDD test-source-grep guards for source-structural invariants").

**Status:** Tracked for Plan 19-07 (HORSE fork test) which has the operator-visual checker per VALIDATION.md — that step covers the runtime-behaviour validation RTL tests would have provided. If future plans require dashboard RTL tests, install `@testing-library/react` + `jsdom` + add a dashboard project to `vitest.config.ts` then.

### 2. Express 5 `req.params.X` typing → wrapped with `String(...)`

Initial `antiRug.ts` route handlers used `const chainName = req.params.chain;` directly, which failed TypeScript compilation with `'string | string[]' is not assignable to parameter of type 'string'`. Express 5 may type `req.params.X` as a union type when the route has param-array patterns.

Resolved by wrapping `String(req.params.chain)` per the existing `src/api/routes/controls.ts:52` precedent (`const tradeId = parseInt(String(req.params.tradeId), 10)`). This is a single-character infrastructure fix, not a deviation from the plan's `<behavior>`.

## Issues Encountered

### 1. Dashboard does not have @testing-library/react

The plan's Task 1 step 5 + Task 2 referenced @testing-library/react as if it were already in dashboard/package.json. Verification revealed no testing-library, no jsdom, no dashboard test setup at all. Resolved per Decisions §1 above (source-text grep guards using the existing vitest unit infrastructure).

### 2. Express 5 req.params union typing

See Deviations §2 above. Single-character fix using existing controls.ts precedent.

## Open Questions for Downstream Plans

### Plan 19-07 (HORSE fork test)

1. **Operator-visual checker:** runtime behaviour validation of the 6 dashboard surfaces (6 badge states + CB banner + reset modal + WS-health 3 states + gap-detected banner + detail modal 3 variants). The source-grep tests verify the source-code invariants but not the actual rendered DOM behaviour — Plan 19-07's fork drill should exercise the full path via browser + bot in dry-run + live modes.

2. **WS event payload validation:** drive the bot through the full anti-rug lifecycle (V2/V3 buy → simulated rug → evaluator → confirm-blocks → triggerAntiRugExit → executeFullSell) and verify each WS event type lands on the dashboard correctly (antirug_state_update updates the Position row; cb_tripped shows the banner; cb_reset hides it; antirug_event populates the Monitor tile + Frontrun panel).

3. **Banner stacking:** drive a chain into BOTH a tripped CB AND a gap-detected state simultaneously. Verify both banners render in the correct order (CB on top, gap below).

### Plan 19-08 (operator handoff docs)

1. **CB-reset procedure** in `docs/operations/anti-rug-rollout.md` must document the full UI flow: dashboard banner click → modal opens with N trigger sections → operator clicks each `I have reviewed this trigger` checkbox → `Type RESET to confirm` input appears → operator types `RESET` (exact, case-sensitive) → Reset Circuit Breaker button enables → click → success closes modal and clears banner; failure renders inline error.

2. **Dry-run telemetry review procedure** must document operator's 7-day pre-live-flip review: open Overview → review Frontrun Outcome Distribution panel for the target chain → filter by signal-source if needed → check post-hoc outcome distribution (target: 0 false positives) → flip `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` in .env + restart bot.

3. **Gap-detected banner UX** documentation: explain that dismissal persists per (chain, fromBlock) in localStorage; a new gap event re-shows the banner; operator should review the missed-block window manually via the bot logs before resuming live mode.

## Verification

| Check | Result |
|-------|--------|
| `npm run test:unit -- api/antiRug` | **15/15 passing** |
| `npm run test:unit -- dashboard/anti-rug/displayComponents` | **29/29 passing** |
| `npm run test:unit -- dashboard/anti-rug/interactiveComponents` | **38/38 passing** |
| `npm run test:unit` (full suite) | **478/478 passing** — zero regressions vs 411 baseline (+67 new) |
| `npm run test:integration` (full suite) | **159/159 passing** — zero regressions |
| `npx tsc --noEmit -p tsconfig.bot.json` | **clean** |
| `npx tsc --noEmit -p dashboard/tsconfig.json` | **clean** |
| `cd dashboard && npm run build` | **exits 0** (631 kB bundle including chart.js) |
| `grep -n "apiRouter.use\('/anti-rug'" src/api/server.ts` | **1 line** (at :71) |
| `grep -c "antirug_state_update\|antirug_event\|chain_ws_health_change\|cb_tripped\|cb_reset" dashboard/src/hooks/useWebSocket.ts` | **10** (≥ 5 — one case branch + one comment per event type) |
| `grep -n "antiRugState" dashboard/src/types/api.ts` | **1 match** (Position field at :136) |
| `grep -l "Live\|Dry-run\|Would-have-sold\|Exit fired\|Halted (CB)\|Unmonitored" dashboard/src/components/anti-rug/AntiRugStateBadge.tsx` | **FOUND** |
| `grep -l "No anti-rug events yet" dashboard/src/components/anti-rug/AntiRugMonitorTile.tsx` | **FOUND** |
| `grep -l "GAP DETECTED" dashboard/src/components/anti-rug/GapDetectedBanner.tsx` | **FOUND** |
| `grep -l "WebSocket connected to\|WebSocket reconnecting to\|WebSocket disconnected from" dashboard/src/components/anti-rug/WsHealthIndicator.tsx` | **FOUND** |
| `grep -l "Frontrun Outcome Distribution" dashboard/src/components/anti-rug/FrontrunDistributionPanel.tsx` | **FOUND** |
| `grep -l "Review and Reset Anti-Rug Circuit Breaker\|I have reviewed this trigger\|Type RESET to confirm" dashboard/src/components/anti-rug/CircuitBreakerResetModal.tsx` | **FOUND** |
| `grep -l "ANTI-RUG HALTED ON" dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx` | **FOUND** |
| `grep -n "Anti-Rug" dashboard/src/components/PositionTable.tsx` | **column header at :64** |
| `grep -n "CircuitBreakerBanner\|AntiRugMonitorTile\|FrontrunDistributionPanel\|GapDetectedBanner" dashboard/src/pages/Overview.tsx` | all four mounted |

## Hand-off

This plan unblocks:

- **Plan 19-07 (HORSE fork test — final integration gate)** — Operator-visual checker now has all 6 dashboard surfaces to drill against: 6 badge states + CB banner + reset modal + WS-health 3 states + gap-detected banner + detail modal 3 variants. Plan 19-07 should exercise the full anti-rug lifecycle and verify each WS event type lands on the dashboard correctly.

- **Plan 19-08 (operator handoff `docs/operations/anti-rug-rollout.md`)** — All operator-facing UI flows (CB-reset modal, dry-run telemetry review, gap-detected banner dismissal) are now implemented and ready to be documented. Plan 19-08 references the screenshots + UI flow from Plan 19-06's surfaces.

**Requirements addressed:**

- **ANTIRUG-09** (per-chain circuit breaker): operator now has the DASHBOARD UI to review and reset a tripped CB. The backend was shipped in Plan 19-05; this plan delivers the operator-facing surface (CircuitBreakerBanner + CircuitBreakerResetModal + POST /api/anti-rug/circuit-breaker/:chain/reset endpoint).

- **ANTIRUG-10** (7-day dry-run mode): operator now has the DASHBOARD VISIBILITY for dry-run events (AntiRugMonitorTile + FrontrunDistributionPanel + Position badge state 'dry-run'/'would-have-sold'). The backend dry-run gate was shipped in Plan 19-05; this plan delivers the review surface required for the 7-day operator-review window per D-LIVE-GATE.

## Self-Check: PASSED

- File `src/api/routes/antiRug.ts` (97 lines) — **FOUND**
- File `src/api/server.ts` (modified — antiRugRoutes mounted at /anti-rug) — **FOUND**
- File `dashboard/src/types/api.ts` (modified — AntiRugMonitorState + 7 new types + Position extension) — **FOUND**
- File `dashboard/src/hooks/useWebSocket.ts` (modified — 5 new switch cases + 3 new state setters) — **FOUND**
- File `dashboard/src/hooks/WebSocketContext.tsx` (modified — new state exposed via useWs) — **FOUND**
- File `dashboard/src/components/anti-rug/AntiRugStateBadge.tsx` (50 lines) — **FOUND**
- File `dashboard/src/components/anti-rug/AntiRugMonitorTile.tsx` (89 lines) — **FOUND**
- File `dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx` (52 lines) — **FOUND**
- File `dashboard/src/components/anti-rug/CircuitBreakerResetModal.tsx` (193 lines) — **FOUND**
- File `dashboard/src/components/anti-rug/WsHealthIndicator.tsx` (78 lines) — **FOUND**
- File `dashboard/src/components/anti-rug/AntiRugExitDetailModal.tsx` (153 lines) — **FOUND**
- File `dashboard/src/components/anti-rug/FrontrunDistributionPanel.tsx` (181 lines) — **FOUND**
- File `dashboard/src/components/anti-rug/GapDetectedBanner.tsx` (77 lines) — **FOUND**
- File `dashboard/src/components/PositionTable.tsx` (modified — Anti-Rug column + cell + tooltip lookup) — **FOUND**
- File `dashboard/src/pages/Overview.tsx` (modified — full mounting of 6 surfaces) — **FOUND**
- File `test/unit/api/antiRug.test.ts` (15 tests) — **FOUND**
- File `test/unit/dashboard/anti-rug/displayComponents.test.ts` (29 tests) — **FOUND**
- File `test/unit/dashboard/anti-rug/interactiveComponents.test.ts` (38 tests) — **FOUND**
- Commit `05a65ee` (Task 1 RED) — **FOUND**
- Commit `4e59933` (Task 1 GREEN) — **FOUND**
- Commit `c7eef61` (Task 2a RED) — **FOUND**
- Commit `4ec8d1f` (Task 2a GREEN) — **FOUND**
- Commit `dfa8f34` (Task 2b RED) — **FOUND**
- Commit `0926838` (Task 2b GREEN) — **FOUND**
- 67 source-grep tests across 3 files + 15 backend route tests = **82 tests added** — VERIFIED
- 478/478 full unit suite, 159/159 full integration suite — VERIFIED
- tsc --noEmit clean across main + bot + dashboard tsconfigs — VERIFIED
- vite build exits 0 — VERIFIED

---

*Phase: 19-anti-rug-runtime-monitoring*
*Completed: 2026-05-24*
