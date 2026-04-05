---
status: diagnosed
trigger: "Telegram connection status NOT showing in dashboard Sidebar footer"
created: 2026-04-04T00:00:00Z
updated: 2026-04-04T00:00:00Z
---

## Current Focus

hypothesis: Dashboard dist bundle is stale -- built before Telegram status code was added to Sidebar/Layout
test: Search compiled JS bundle for "Telegram" string
expecting: Zero matches if bundle is stale
next_action: Report root cause (find_root_cause_only mode)

## Symptoms

expected: Two status lines in sidebar footer -- WS status and Telegram status with independent dots/labels
actual: Only one status dot (WS status); no Telegram line visible
errors: None (no runtime errors -- code simply not present in served bundle)
reproduction: Open dashboard, look at sidebar footer
started: Since phase 11 Telegram status feature was added to source but dist was not rebuilt

## Eliminated

(none needed -- root cause found on first hypothesis)

## Evidence

- timestamp: 2026-04-04T00:00:00Z
  checked: dashboard/src/components/Sidebar.tsx
  found: Source code correctly implements Telegram status (lines 59-77), accepts telegramStatus prop (line 9)
  implication: Source is correct

- timestamp: 2026-04-04T00:00:00Z
  checked: dashboard/src/components/Layout.tsx
  found: Fetches /health (line 18), derives telegramStatus (lines 20-24), passes to Sidebar (line 36)
  implication: Source is correct

- timestamp: 2026-04-04T00:00:00Z
  checked: dashboard/dist/assets/index-D6nHinxP.js for "Telegram" string
  found: ZERO matches for Telegram/telegramStatus/telegramConnected in compiled bundle
  implication: Bundle was built before Telegram feature was added

- timestamp: 2026-04-04T00:00:00Z
  checked: File timestamps -- dist bundle vs source
  found: Bundle last modified 2026-03-27, Sidebar.tsx last modified 2026-04-01
  implication: Bundle is 5 days older than the source changes

- timestamp: 2026-04-04T00:00:00Z
  checked: src/api/server.ts lines 73-74
  found: Bot serves from dashboard/dist via express.static
  implication: The stale bundle is exactly what users see

## Resolution

root_cause: The dashboard dist bundle (dashboard/dist/assets/index-D6nHinxP.js) was last built on 2026-03-27, but the Telegram status source code was added to Sidebar.tsx and Layout.tsx on 2026-04-01. The compiled bundle contains zero references to "Telegram". The bot serves the stale bundle via express.static.
fix: Rebuild the dashboard (cd dashboard && npm run build)
verification: (not yet applied)
files_changed: []
