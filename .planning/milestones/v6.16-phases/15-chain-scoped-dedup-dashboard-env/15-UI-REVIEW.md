# Phase 15 — UI Review

**Audited:** 2026-04-12
**Baseline:** Abstract 6-pillar standards (no UI-SPEC.md)
**Screenshots:** Not captured (no dev server running)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Operator-actionable errors and empty states; silent CSV export failure |
| 2. Visuals | 3/4 | Strong a11y and hierarchy; arbitrary `text-[28px]` stat card sizing |
| 3. Color | 3/4 | Complete 14-token design system; chain color duplication and error text color mismatch |
| 4. Typography | 4/4 | Only 3 size steps + 2 weights — tight and disciplined |
| 5. Spacing | 3/4 | Coherent rhythm with justified arbitrary values for layout constraints |
| 6. Experience Design | 3/4 | Good loading/error/empty states and destructive action guards; no ErrorBoundary |

**Overall: 19/24**

---

## Top 3 Priority Fixes

1. **Silent CSV export failure** — `TradeHistory.tsx:84-85` swallows the error with a comment; users who click "Export CSV" and get no download receive zero feedback, leaving them to assume the file is on its way — Change the catch block to set an `exportError` state string and render it inline near the button
2. **Error banners use neutral text color** — `ChainControls.tsx:132/137/142` renders error messages with `text-text` (white) instead of `text-loss` (red) inside an already-styled `border-loss` container; the semantic color signal is absent — Change the three `<p className="text-sm text-text">` lines inside error banners to `text-loss`
3. **No top-level ErrorBoundary** — An unhandled exception in any page component (e.g., a malformed API response read as `.map()`) would render the entire dashboard as a blank screen with no recovery path — Wrap the router/page tree in `App.tsx` with a React ErrorBoundary that renders a minimal "Something went wrong. Reload the page." fallback

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

Strong: LoginForm gives operator-actionable errors ("Check DASHBOARD_API_KEY in your .env file"). TradeHistory empty state ("Try adjusting the time range or chain selection") and PositionTable empty state ("The bot is running but has not entered any positions yet. New snipes will appear here in real time.") are specific and helpful. CTA labels are purposeful: "Sign In", "Apply Filters", "Export CSV", "Stop Listening", "Start Listening".

Issue: `TradeHistory.tsx:84-85` — export failure is caught and silently discarded. Users who click "Export CSV" and observe nothing receive no error copy at all. Fix: display an inline error string such as "Export failed. Check your connection and try again."

Issue: `ChainControls.tsx:44/71/95` — fallback error string "Unknown error" appears in user-facing banners. This is valid defensively but if the API route returns a structured error body, the operator gets no detail. Minor.

### Pillar 2: Visuals (3/4)

Strong: All icon-only buttons carry appropriate accessible labels. Sidebar collapse toggle has `aria-label="Expand sidebar" / "Collapse sidebar"`. StatusDot carries `aria-label={status}`. ChainStatusCard dismiss button has `aria-label="Dismiss warnings"`. Hierarchy is clear: stat cards at top, positions table mid-page, risk gauges and event feed at bottom.

Issue: `StatCard.tsx:15` uses `text-[28px]` for the primary value. The size is intentional (between `text-2xl`/24px and `text-3xl`/30px) but it lives outside the defined scale. Without a screenshot it cannot be called a rendering problem, but it is a design-token contract violation.

Issue: Overview page stat cards render `--` or `0` for all values before API resolves (no skeleton or loading shimmer), which creates a brief flash of zeroed metrics on load. PositionTable and EventFeed load immediately from WebSocket context so they are unaffected.

### Pillar 3: Color (3/4)

Strong: `index.css` defines a 14-token design system (`--color-surface`, `--color-surface-light`, `--color-surface-lighter`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-text-disabled`, `--color-accent`, `--color-profit`, `--color-loss`, `--color-warning`, `--color-info`, plus 4 chain colors). Tailwind classes consume these tokens — no arbitrary hex values in component JSX/TSX.

Issue 1: Chain colors are defined twice — in `index.css` as `--color-chain-eth/bsc/base/arb` AND as hardcoded hex literals in `ExposureDonut.tsx:18-21` (`{ eth: '#627eea', bsc: '#f0b90b', base: '#0052ff', arb: '#28a0f0' }`). The Canvas API cannot consume CSS variables directly, so this duplication is structurally necessary, but if a chain color is ever updated in `index.css`, the donut chart will silently diverge. Fix: move the color map to a shared `src/utils/chainColors.ts` constant file that both the CSS tokens and canvas components reference.

Issue 2: `ChainControls.tsx:132` renders `<p className="text-sm text-text">{error}</p>` inside a `border-l-4 border-loss` error banner. The border is red, but the text is white — the semantic color contract is broken. The same pattern appears at lines 137 and 142.

### Pillar 4: Typography (4/4)

Excellent. Only three Tailwind size steps in use across the entire component library: `text-xs` (labels, metadata), `text-sm` (body, table rows), `text-xl` (page/section headings). Only two weights: `font-bold` (headings, values) and `font-normal` (implicit). This is strict and correct for a data-dense trading dashboard.

The one arbitrary override `text-[28px]` in `StatCard.tsx:15` is noted under Visuals but does not warrant deducting a full point here — the hierarchy intent is sound.

### Pillar 5: Spacing (3/4)

Strong: The dominant rhythm is `px-3/py-2` for buttons (matching the input field sizing), `p-4` for cards, `p-8` for the login form. Gaps use `gap-2`, `gap-4`, `gap-6` consistently. `space-y-2/3/8` are used for page-level vertical rhythm.

Issue: Several layout-specific arbitrary values are present — `w-[400px]` (LoginForm, ConfirmDialog), `w-[56px]`/`w-[240px]` (Sidebar), `max-h-[400px]` (EventFeed), `h-[250px]` (ExposureDonut canvas), `h-[300px]` (PnLChart canvas), `h-[44px]`/`min-h-[44px]` (table rows), `border-l-[3px]` (Sidebar active indicator). Most of these are justified component-specific dimension constraints (canvas containers need explicit height; touch-target minimum is established practice). Only `w-[400px]` for dialog/login form and `border-l-[3px]` are candidates for token-ization. No remediation is blocking.

### Pillar 6: Experience Design (3/4)

Strong: Loading states present in LoginForm (disabled button + text change), TradeHistory (10 skeleton rows with `animate-pulse`), and PnLChart (loading prop with spinner placeholder). Destructive actions all guarded: force-sell uses ConfirmDialog with "Force Sell" / "Keep Position" labels; chain stop uses ConfirmDialog; emergency sell-all uses EmergencyConfirmDialog with a separate component for the highest-risk action. Empty states handled on PositionTable, EventFeed, TradeHistory, and ChainControls.

Issue 1: Silent export failure — `TradeHistory.tsx:84-85` catches download errors with a comment and no user feedback. A missing download in a background operation has no recovery prompt.

Issue 2: No React ErrorBoundary in `App.tsx`. The application renders router/pages with no top-level catch. A runtime exception in any page component (e.g., `Cannot read properties of undefined`) would crash the entire single-page app to a blank screen.

Issue 3: Overview stat cards show `0.0000` / `0` for all metrics until API data resolves. There is no loading indicator; the WebSocket-driven positions update live, but the `useApi` calls for `/api/risk/exposure`, `/api/risk/limits`, and `/health` all start as `undefined` and render formatted `undefined` -> `0`. Low severity but creates a momentary misleading impression of zero exposure.

---

## Files Audited

- `dashboard/src/App.tsx`
- `dashboard/src/index.css`
- `dashboard/src/components/ChainBadge.tsx`
- `dashboard/src/components/ChainStatusCard.tsx`
- `dashboard/src/components/ConfirmDialog.tsx`
- `dashboard/src/components/EmergencyConfirmDialog.tsx`
- `dashboard/src/components/EventFeed.tsx`
- `dashboard/src/components/ExposureDonut.tsx`
- `dashboard/src/components/FilterChips.tsx`
- `dashboard/src/components/Layout.tsx`
- `dashboard/src/components/LoginForm.tsx`
- `dashboard/src/components/PnLChart.tsx`
- `dashboard/src/components/PositionTable.tsx`
- `dashboard/src/components/RiskGauge.tsx`
- `dashboard/src/components/Sidebar.tsx`
- `dashboard/src/components/StatCard.tsx`
- `dashboard/src/components/StatusDot.tsx`
- `dashboard/src/components/TimeRangeSelector.tsx`
- `dashboard/src/components/TradeTable.tsx`
- `dashboard/src/hooks/WebSocketContext.tsx`
- `dashboard/src/hooks/useApi.ts`
- `dashboard/src/hooks/useWebSocket.ts`
- `dashboard/src/pages/ChainControls.tsx`
- `dashboard/src/pages/Login.tsx`
- `dashboard/src/pages/Overview.tsx`
- `dashboard/src/pages/RiskExposure.tsx`
- `dashboard/src/pages/TradeHistory.tsx`
- `dashboard/src/utils/formatters.ts`
- `dashboard/src/types/api.ts`

Registry audit: shadcn not initialized — skipped.
