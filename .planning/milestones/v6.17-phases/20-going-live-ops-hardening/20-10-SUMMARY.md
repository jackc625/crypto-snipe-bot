---
phase: 20-going-live-ops-hardening
plan: 10
subsystem: dashboard
tags: [dashboard, tailwind, cosmetic, pause-banner, circuit-breaker-banner, gap-closure, react, tsx]

# Dependency graph
requires:
  - phase: 20-going-live-ops-hardening (plan 20-06)
    provides: dashboard/src/components/PauseBanner.tsx (WS-driven pause banner) + test/unit/dashboard/pauseBanner.test.ts (source-grep guards)
  - phase: 19-anti-rug-runtime-monitoring (plan 19-06)
    provides: dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx (CB-tripped banner the PauseBanner copied verbatim)
provides:
  - "PauseBanner renders as a contained dashboard card (bg-surface-light border border-loss border-l-4 rounded-lg p-4 mb-6) with a red left-border alarm accent + text-loss icon/heading, not a full-bleed slab"
  - "PauseBanner Resume button is a solid dashboard button (bg-accent text-white rounded px-4 py-2 text-sm hover:opacity-90 transition-colors), not underlined text"
  - "CircuitBreakerBanner gets the identical card-idiom treatment for visual parity"
  - "pauseBanner.test.ts Test 6 asserts the card-idiom classes (+ Resume solid style) and that the full-bleed -mx margins are gone"
affects: [20-11 going-live.md banner_retest note, operator-visual UAT acceptance, OPS-LIVE-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Red-alert-as-card idiom: bg-surface-light + border + rounded-lg + p-4 carries the dashboard card look while border-loss border-l-4 + text-loss icon/heading keep it an unmistakable alarm (no full-bleed bg-loss slab needed for urgency)"
    - "Cosmetic-only change isolated to className strings + comments — every behavioral line (early return, fetch POST, credentials:include, no setPauseState, useWs, lucide import, headline copy) left byte-identical so the existing behavior grep guards stay green"

key-files:
  created:
    - .planning/phases/20-going-live-ops-hardening/20-10-SUMMARY.md
  modified:
    - dashboard/src/components/PauseBanner.tsx
    - dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx
    - dashboard/src/components/Layout.tsx
    - test/unit/dashboard/pauseBanner.test.ts

key-decisions:
  - "Both banners moved to the card idiom together (PauseBanner + CircuitBreakerBanner) so the verbatim-copy visual parity that 20-06 intentionally established is preserved rather than split"
  - "Kept border-loss border-l-4 + text-loss on icon + heading as the alarm signal so 'doesn't have to be perfect' cosmetic alignment never costs the operator's most important safety read (BOT PAUSED stays unmistakable)"
  - "CB per-chain chip bumped from bg-surface-light (now the card's own background) to bg-surface-lighter so the chip stays visually distinct against the new card surface; dropped underline on the CTA text for consistency with the solid-button idiom (text-accent retained)"
  - "Test 6 rewritten from a single verbatim full-bleed-string assertion to per-class toContain checks (bg-surface-light/border-loss/border-l-4/rounded-lg) + a not.toContain on the removed -mx margins + a sibling Resume-button bg-accent assertion — locks the new look without re-coupling to one brittle exact string"

patterns-established:
  - "Layout JSX untouched; only the explanatory comment refreshed — the PauseBanner already sat inside the p-8 scroll container, so dropping the full-bleed negative margins needed no structural change"

requirements-completed: [OPS-LIVE-09]

# Metrics
duration: 3min
completed: 2026-05-26
---

# Phase 20 Plan 10: Pause/CB Banner Card-Idiom Restyle Summary

**The PauseBanner (and CircuitBreakerBanner, for parity) was restyled from a full-bleed solid-red slab (`bg-loss text-white ... -mx-4 sm:-mx-6 lg:-mx-8`) to the dashboard's contained card idiom (`bg-surface-light border border-loss border-l-4 rounded-lg p-4 mb-6`) with a red left-border alarm accent and `text-loss` icon/heading, so the operator's most important safety signal reads as a deliberate dashboard element while remaining an unmistakable red alert — a presentation-only change that left every behavioral line and the locking test's behavior guards intact.**

## Performance

- Duration: ~3 min (2 tasks)
- Files changed: 4 (3 source/comment + 1 test) across 2 commits
- Tests: pauseBanner.test.ts 29/29 pass (incl. 2 new Test 6 assertions); dashboard `tsc --noEmit` clean

## What Changed

### Task 1 — Restyle PauseBanner + CircuitBreakerBanner; refresh comments (`41bbc42`)

`dashboard/src/components/PauseBanner.tsx`:
- Container className (line 69) swapped from `bg-loss text-white py-3 px-4 mb-4 -mx-4 sm:-mx-6 lg:-mx-8` → `bg-surface-light border border-loss border-l-4 rounded-lg p-4 mb-6`. Dropped `text-white` and the full-bleed `-mx` margins entirely.
- `PauseCircle` icon + `BOT PAUSED` `h2` heading → `text-loss` (heading keeps `text-xl font-bold leading-[1.2]`).
- Reason `<p>` → `text-text-muted` (replaces the inherited white-on-red).
- Resume button restyled from underlined-text (`bg-surface-light ... text-accent underline`) → solid dashboard button `bg-accent text-white rounded px-4 py-2 text-sm hover:opacity-90 transition-colors`; disabled-state `opacity-50 cursor-not-allowed` preserved (appended), `Resuming...`/`Resume` label logic preserved.
- Header comment (lines 1-8) updated from "Full-bleed red pause banner" / RESEARCH OQ10 "same bg-loss text-white as CB banner" → describes the card idiom (contained card + red left-border accent) per the 20-10 live-UAT test-2 cosmetic gap, noting it remains an unmistakable red alert and CB-banner parity is maintained.

`dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx`:
- Identical container treatment (line 36): same card-idiom + red-left-border class string; dropped `text-white` + `-mx` full-bleed.
- `AlertOctagon` icon + `h2` heading → `text-loss`; descriptive `<p>` → `text-text-muted`.
- Per-chain chip buttons (lines 49-59): `bg-surface-light` → `bg-surface-lighter` so the chip stays distinguishable against the new card surface; CTA text dropped `underline` (kept `text-accent`). ChainBadge + "Click to review and reset" affordance preserved.
- Header comment (lines 1-14) updated from "Full-bleed CB-tripped alert banner" / "Phase 19 promotes this to full-bleed" → card idiom (Phase 20 cosmetic alignment), still a red alert, parity with PauseBanner.

`dashboard/src/components/Layout.tsx`:
- Comment block (lines 39-45) updated: the full-bleed `-mx-{4|6|8}` rationale replaced with a note that the PauseBanner is now a contained card living inside the `p-8` scroll container so it no longer needs the negative margins. JSX (`<PauseBanner />` above `<main>` inside the `p-8` div) untouched.

**Verification:** `npx tsc --noEmit -p dashboard/tsconfig.json` → exit 0. Grep confirmed: 0 occurrences of `-mx-4 sm:-mx-6 lg:-mx-8` in `dashboard/src/components/`; both banners contain the card-idiom container; Resume button contains the solid `bg-accent text-white` style.

### Task 2 — Update pauseBanner.test.ts Test 6 (`4448ed0`)

`test/unit/dashboard/pauseBanner.test.ts`:
- Test 6 renamed "full-bleed CB-banner-parity classes ship verbatim" → "card-idiom red-alert classes ship (not full-bleed)". Replaced the single verbatim `bg-loss text-white py-3 px-4 mb-4 -mx-4 sm:-mx-6 lg:-mx-8` assertion with per-class `toContain` checks: `bg-surface-light`, `border-loss`, `border-l-4`, `rounded-lg`, plus `expect(src).not.toContain('-mx-4 sm:-mx-6 lg:-mx-8')`.
- Added a sibling test asserting the Resume button uses the solid style: `expect(src).toContain('bg-accent text-white')`.
- Refreshed the file-header Test 6 description and the PauseBanner section banner comment.
- All other tests (early return, BOT PAUSED, Resume POST + credentials:include, no-local-setPauseState, useWs, lucide icon, WebSocketContext/useWebSocket/Layout/api.ts shape guards) left unchanged.

**Verification:** `npx vitest run --project unit test/unit/dashboard/pauseBanner.test.ts --reporter=verbose` → 29/29 pass, exit 0.

## Deviations from Plan

None — plan executed exactly as written. Each task's exact Tailwind class targets and test assertions were applied as specified; no Rule 1-4 deviations were needed (presentation-only change, no bugs/missing-functionality/blocking issues encountered, no architectural decisions).

## Known Stubs

None. This plan changed only presentation classes and comments; no data sources, placeholders, or empty-value stubs were introduced.

## Threat Flags

None. Presentation-only change crosses no data, auth, or input trust boundary (per the plan's threat model: T-20-10-01 disposition `accept` — contained-card form does not reduce visibility; the banner still sits at the top of every page above `<main>` exactly as before, with `border-loss border-l-4` + `text-loss` keeping it an unmistakable red alert). No new network endpoints, auth paths, file access, or schema changes.

## Notes for Downstream

- **Operator-visual acceptance is deferred to the UAT banner_retest** documented in plan 20-11 (`banner_retest: pending`) — the cosmetic look needs a human eyeball after the dashboard is rebuilt. Functional WS behavior was already user-confirmed ("it works now") and is unchanged by this plan.
- The pre-existing failing tests in `test/unit/preflight/staleData.test.ts` and `test/integration/pauseCli.test.ts` (db-mock breaks logged in `deferred-items.md`) are out of scope and were not touched; this plan ran only `pauseBanner.test.ts`, which is fully green, so no new failures were introduced.

## Commits

- `41bbc42` — feat(20-10): restyle PauseBanner + CircuitBreakerBanner to card idiom
- `4448ed0` — test(20-10): update pauseBanner Test 6 to card-idiom classes

## Self-Check: PASSED

All 4 modified files + the SUMMARY.md exist on disk; both task commits (`41bbc42`, `4448ed0`) present in git history.
