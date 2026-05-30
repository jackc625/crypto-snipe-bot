---
phase: 20-going-live-ops-hardening
plan: 08
subsystem: dashboard-api + preflight
tags: [cors, csrf, same-origin, preflight, dashboard-api-key, gap-closure, ops-live]
requires:
  - "src/api/server.ts CORS middleware (CR-02 allowlist, commit 2d3395e)"
  - "src/preflight.ts validateCrossEnvRules() (Plan 20-02)"
  - ".env.example:73 DASHBOARD_API_KEY placeholder literal"
provides:
  - "Same-origin-aware CORS callback (Origin host:port == request Host) — dashboard POST works with zero DASHBOARD_ALLOWED_ORIGINS config"
  - "validateCrossEnvRules Rule 5: FATAL on placeholder/empty/<16-char DASHBOARD_API_KEY"
affects:
  - "Dashboard login + pause/resume out of the box (CORS)"
  - "Bot boot refuses default admin credential (preflight FATAL)"
  - "Plan 20-11 going-live.md retest note (banner_retest: pending)"
tech-stack:
  added: []  # no new dependencies — uses existing cors, ethers, in-repo modules
  patterns:
    - "Per-request cors() middleware to capture req.headers.host in closure (static-options origin callback has no request access)"
    - "new URL(origin).host vs req.headers.host same-origin detection, try/catch fall-through on malformed Origin"
    - "validateCrossEnvRules if/else-if chain: exactly one pushed result (placeholder|empty|too-short mutually exclusive)"
key-files:
  created:
    - ".planning/phases/20-going-live-ops-hardening/deferred-items.md"
  modified:
    - "src/api/server.ts"
    - "src/preflight.ts"
    - "test/unit/preflight/crossEnvRules.test.ts"
decisions:
  - "DASHBOARD_API_KEY guard homed in validateCrossEnvRules (NOT config.ts) per UAT diagnosis — config.ts keeps its set-only presence check; CLI plan 20-09 owns config.ts"
  - "Same-origin detected by host:port comparison, NOT Origin absence — the absence assumption was the bug (browsers send Origin on same-origin POST)"
metrics:
  duration: ~4min
  completed: "2026-05-26"
  tasks: 2
  files: 4
---

# Phase 20 Plan 08: CORS Same-Origin + DASHBOARD_API_KEY FATAL Gap Closure Summary

Same-origin-aware CORS callback (compares `new URL(origin).host` to `req.headers.host`) so the bot-served dashboard SPA can POST login/pause/resume with zero `DASHBOARD_ALLOWED_ORIGINS` config, plus a `validateCrossEnvRules` FATAL rule that refuses to boot on the shipped placeholder / empty / <16-char `DASHBOARD_API_KEY`. Closes the two server-side MAJOR go-live gaps from the Phase 20 live UAT.

## What Was Built

### Task 1 — CORS allows true same-origin POST (commit `37ec2c5`)
Replaced the static-options `cors()` block in `src/api/server.ts` with a per-request middleware (`app.use((req, res, next) => cors({ origin: ... })(req, res, next))`) that captures `req.headers.host` in a closure. The origin callback now allows when ANY of:
1. No `Origin` header (`!origin`) — GET/HEAD, curl, Node-axios pause/resume CLI. Unchanged.
2. **TRUE same-origin** — `new URL(origin).host === req.headers.host` (host:port match). This is the gap fix: a browser POST from the SPA served BY the bot is same-origin and not CSRF, so it passes with zero operator config. `new URL(origin)` is wrapped in try/catch so a malformed Origin falls through to rejection rather than throwing into the request.
3. **Explicit allowlist** — `origin` in `DASHBOARD_ALLOWED_ORIGINS` (existing comma-split parse, unchanged) for opted-in cross-origin / remote dashboards.

Otherwise `cb(new Error('CORS: origin not allowed'))` — cross-origin writes from a malicious page still 500, preserving the CR-02 anti-CSRF intent (commit 2d3395e). `credentials: true` retained; `allowedOrigins` still parsed once at server-factory scope. The inline comment was rewritten to state the host-comparison contract (the old comment asserted same-origin == no Origin header, which was the bug).

### Task 2 — DASHBOARD_API_KEY placeholder/weak-key FATAL + tests (commit `0895dc9`)
Added `DASHBOARD_API_KEY_PLACEHOLDER = 'your-secret-dashboard-api-key-here'` (matches `.env.example:73` byte-for-byte) as a module constant, and a new Rule 5 in `validateCrossEnvRules()` (appended after the per-chain-RPC loop, before `return results`). An if/else-if chain pushes exactly one `chain: 'global', check: 'cross-env-rule', passed: false` result with `details.rule === 'dashboard-api-key'` and a `cause`:
- `placeholder` — key equals the shipped default
- `empty` — `!key || key.trim() === ''`
- `too-short` — `key.trim().length < 16`

Each reason points to `docs/operations/going-live.md §5`. The failure flows through `preflight()`'s collect-all FATAL + Telegram + remediation path (D-ALERTS); the bot refuses to boot on a default admin credential. This is the unsafe-**state** guard; `config.ts:27` keeps its existing set-only presence check (untouched — plan 20-09 owns config.ts).

In `crossEnvRules.test.ts`: added `'DASHBOARD_API_KEY'` to `CROSS_ENV_KEYS` (so each test clears/restores it) and a new `describe('Rule 5: ...')` block with 4 cases — (a) placeholder→cause `placeholder`, (b) empty→`empty`, (c) `'short'`→`too-short`, (d) strong 32-char key→zero dashboard-api-key failures.

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit -p tsconfig.bot.json` (Task 1 + Task 2) | clean, exit 0 |
| `npx vitest run --project unit test/unit/preflight/crossEnvRules.test.ts` | 10/10 pass (6 existing + 4 new) |
| `src/api/server.ts` contains `req.headers.host` | yes (2×) |
| `src/preflight.ts` contains `your-secret-dashboard-api-key-here` | yes (2×) |
| `crossEnvRules.test.ts` contains `dashboard-api-key` | yes (5×) |
| Commit deletion check (both commits) | clean — no deletions |

Manual operator confirmation (dashboard login same-origin POST succeeds; bot FATAL-exits on placeholder key) is deferred to plan 20-11 retest note per UAT `banner_retest: pending`, after the dashboard is rebuilt.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test interaction] Updated existing all-pass test to set a strong DASHBOARD_API_KEY**
- **Found during:** Task 2.
- **Issue:** Adding `'DASHBOARD_API_KEY'` to `CROSS_ENV_KEYS` means `beforeEach` now clears it, so the pre-existing "returns no violations when all rules satisfied" test would newly fail (absent key → Rule 5 `empty` violation), breaking its `expect(failed).toEqual([])` assertion.
- **Fix:** Set `process.env.DASHBOARD_API_KEY = 'a-strong-random-key-32-characters-long'` in that test to keep its "all rules satisfied" intent valid under the new rule.
- **Files modified:** `test/unit/preflight/crossEnvRules.test.ts`.
- **Commit:** `0895dc9`.

This is an in-scope consequence of the planned change (the plan instructs adding the key to `CROSS_ENV_KEYS`), not a separate fix.

## Deferred Issues (out of scope — pre-existing)

**`test/unit/preflight/staleData.test.ts` — 4 failing tests (db mock mismatch).** Discovered during a regression sweep of `test/unit/preflight/`. Root cause: the WR-06 refactor (shipped at/before `c2c724d`, Plan 20-02 area) changed `checkStaleData` to use the cached prepared statement `getStaleTradesQuery.all(...)`, but `staleData.test.ts`'s `src/utils/db` mock only stubs `db.prepare(...)` + `getAntirugDryRunStarted`, not `getStaleTradesQuery` → `.all()` throws. Verified pre-existing via `git show c2c724d:` on both files. Untouched by plan 20-08 (which only modifies `validateCrossEnvRules`, `crossEnvRules.test.ts`, and `src/api/server.ts`). Logged with suggested fix in `.planning/phases/20-going-live-ops-hardening/deferred-items.md`. NOT fixed here per the executor scope boundary.

## Threat Model Compliance

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-20-08-01 (CORS same-origin spoof/elevation) | mitigate | `new URL(origin).host == req.headers.host`; cross-origin host-mismatch still requires allowlist (CR-02 preserved); `sameSite:'strict'` cookie remains second layer. ✓ |
| T-20-08-02 (malformed Origin tampering) | mitigate | `new URL(origin)` in try/catch; parse failure falls through to rejection, never throws into the request. ✓ |
| T-20-08-03 (default DASHBOARD_API_KEY elevation) | mitigate | Rule 5 FATAL on placeholder/empty/<16-char; bot refuses to boot on the known-default admin credential. ✓ |
| T-20-08-SC (supply-chain installs) | mitigate | No new dependencies added. N/A — no install task. ✓ |

No new security surface introduced beyond the threat model.

## Self-Check: PASSED

- FOUND: src/api/server.ts (modified, contains `req.headers.host`)
- FOUND: src/preflight.ts (modified, contains `your-secret-dashboard-api-key-here`)
- FOUND: test/unit/preflight/crossEnvRules.test.ts (modified, contains `dashboard-api-key`)
- FOUND: .planning/phases/20-going-live-ops-hardening/deferred-items.md (created)
- FOUND commit 37ec2c5 (Task 1 CORS)
- FOUND commit 0895dc9 (Task 2 dashboard-api-key)
