---
status: diagnosed
trigger: "Chain Controls page shows a blank blue screen in the dashboard"
created: 2026-04-04T20:10:00Z
updated: 2026-04-04T20:15:00Z
---

## Current Focus

hypothesis: Backend API response shape does not match frontend ChainStatus type, causing runtime TypeError crash
test: Compare backend chains.ts response fields with frontend api.ts ChainStatus type
expecting: Mismatched property names/structure
next_action: Report root cause

## Symptoms

expected: Chain Controls page renders chain status cards with controls
actual: Blank blue screen (body background #0f172a shows, nothing rendered)
errors: Uncaught TypeError at runtime -- chain.config is undefined when ChainStatusCard tries to access chain.config.dexes
reproduction: Navigate to /chains in the dashboard
started: Since phase 11 implementation (backend and frontend were built with mismatched contracts)

## Eliminated

- hypothesis: TypeScript compilation error
  evidence: tsc --noEmit passes cleanly with zero errors
  timestamp: 2026-04-04T20:11:00Z

- hypothesis: Vite build failure
  evidence: vite build succeeds, produces valid output
  timestamp: 2026-04-04T20:11:00Z

- hypothesis: Route not configured
  evidence: App.tsx line 78-86 correctly mounts ChainControls at /chains with AuthGuard + Layout
  timestamp: 2026-04-04T20:12:00Z

- hypothesis: Missing component imports
  evidence: All imports (ConfirmDialog, EmergencyConfirmDialog, ChainStatusCard, StatusDot) resolve to existing files
  timestamp: 2026-04-04T20:12:00Z

## Evidence

- timestamp: 2026-04-04T20:13:00Z
  checked: Backend API response shape (src/api/routes/chains.ts lines 73-99)
  found: Backend returns { name, displayName, status, wsConnected, snipeParams, riskLimits, exitStrategy, connection }
  implication: No "config" property exists in the API response

- timestamp: 2026-04-04T20:13:00Z
  checked: Frontend ChainStatus type (dashboard/src/types/api.ts lines 58-71)
  found: Frontend expects { name, displayName, status, config: { snipeAmount, maxCapital, rpcUrl, chainId, wsConnected, latestBlock, dexes } }
  implication: Complete structural mismatch -- frontend reads chain.config.* but backend sends snipeParams.*, connection.*, etc.

- timestamp: 2026-04-04T20:14:00Z
  checked: ChainStatusCard.tsx line 108
  found: chain.config.dexes.join(', ') -- calls .join() on undefined.undefined, which throws TypeError
  implication: This is the crash point. chain.config is undefined, so .dexes access throws, crashing React tree

- timestamp: 2026-04-04T20:14:00Z
  checked: Backend chains.ts for "dexes" field
  found: Zero matches -- dexes is never included in the API response
  implication: Even if the nesting was fixed, dexes would still be missing from the response

- timestamp: 2026-04-04T20:15:00Z
  checked: No ErrorBoundary in the React app
  found: grep for ErrorBoundary/componentDidCatch returns zero matches
  implication: Uncaught render error unmounts the entire React tree, leaving only the blue body background

## Resolution

root_cause: |
  The backend API (src/api/routes/chains.ts) and frontend type contract (dashboard/src/types/api.ts + ChainStatusCard.tsx)
  have completely mismatched response shapes. The backend sends flat/nested objects (snipeParams, riskLimits, exitStrategy,
  connection) while the frontend expects a single "config" object. When API data arrives, chain.config is undefined.
  ChainStatusCard.tsx line 108 does chain.config.dexes.join(', ') which throws TypeError: Cannot read properties of
  undefined (reading 'dexes'). With no ErrorBoundary, this crashes the entire React tree, leaving the blue body background.
  Additionally, the backend never sends a "dexes" field at all -- it exists in chainRegistry.ts but is omitted from the
  chains API response.
fix: ""
verification: ""
files_changed: []
