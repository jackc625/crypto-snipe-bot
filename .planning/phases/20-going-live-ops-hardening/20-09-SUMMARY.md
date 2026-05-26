---
phase: 20-going-live-ops-hardening
plan: 09
subsystem: ops
tags: [cli, pause-resume, dashboard, dotenv, axios, ECONNREFUSED, AggregateError, config-validation]

# Dependency graph
requires:
  - phase: 20-going-live-ops-hardening (plan 20-05)
    provides: scripts/pause.ts + scripts/resume.ts operator CLIs (login→pause/resume axios flow)
  - phase: 20-going-live-ops-hardening (plan 20-02)
    provides: config.ts REQUIRED_ENV_VARS DASHBOARD_URL entry + src/api/server.ts DASHBOARD_HOST/PORT bind
  - phase: 20-going-live-ops-hardening (plan 20-08)
    provides: src/preflight.ts DASHBOARD_API_KEY FATAL rule (config.ts ownership handed to 20-09)
provides:
  - "npm run pause / npm run resume work out of the box on a fresh clone with DASHBOARD_URL unset (derive http://127.0.0.1:8080 from DASHBOARD_HOST/DASHBOARD_PORT, matching the server bind)"
  - "Refused/failed CLI connection prints a clear host:port + cause message instead of an empty-string AggregateError (was err:'')"
  - "config.ts DASHBOARD_URL description default corrected to derived DASHBOARD_HOST:DASHBOARD_PORT (e.g. http://127.0.0.1:8080)"
  - "8 static-grep tests pinning the derived-default + no-localhost:3000 + DASHBOARD_URL-override + apiKey-never-in-catch invariants"
affects: [20-11 going-live.md CLI retest note, operator-runbook, OPS-LIVE-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLI default URL derived from the same env the server binds (resolveDashboardUrl() mirrors src/api/server.ts:161-162) — single source of truth, no drift"
    - "AggregateError/ECONNREFUSED unwrapping: dig the first .errors[] entry with a non-empty .message, else fall back to .code, to surface a non-empty operator message"
    - "Crash-handler URL recompute via pure env reads (resolveDashboardUrl called again in main().catch) so the failed address is reportable without hoisting mutable module state"

key-files:
  created: []
  modified:
    - scripts/pause.ts
    - scripts/resume.ts
    - src/config.ts
    - test/integration/pauseCli.test.ts
    - .planning/phases/20-going-live-ops-hardening/deferred-items.md

key-decisions:
  - "Derive http://${host}:${port} from DASHBOARD_HOST||127.0.0.1 + DASHBOARD_PORT||8080 (IPv4, not localhost, to avoid the ::1 IPv6 refusal from the live UAT); DASHBOARD_URL still wins when set"
  - "Recompute the URL in main().catch (pure env reads) rather than hoisting module-scope mutable state — cleaner and identical result"
  - "Connection-error payload is {url, code, cause} only — apiKey is structurally never present (T-20-05); new grep test re-asserts this over the new catch block"
  - "Chose the source-grep test approach (plan option a) over behavioral: the in-process harness binds an ephemeral listen(0) port not exposed via process.env.DASHBOARD_PORT, and the CLI scripts are not invoked in-process, so a behavioral test would not actually exercise the scripts' derived default"

patterns-established:
  - "resolveDashboardUrl() helper duplicated (not shared) across pause.ts/resume.ts to keep each CLI self-contained per the plan's explicit guidance"

requirements-completed: [OPS-LIVE-11]

# Metrics
duration: 6min
completed: 2026-05-26
---

# Phase 20 Plan 09: Pause/Resume CLI Go-Live URL Fix Summary

**`npm run pause` / `npm run resume` now derive their default dashboard URL from DASHBOARD_HOST/DASHBOARD_PORT (→ http://127.0.0.1:8080, the server bind) instead of the dead http://localhost:3000, and a refused connection prints a clear host:port + cause message instead of an empty-string AggregateError crash.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-26T01:54:25Z
- **Completed:** 2026-05-26T02:01:21Z
- **Tasks:** 2
- **Files modified:** 5 (2 CLI scripts, config.ts, 1 test file, deferred-items.md)

## Accomplishments

- **CLI dials the right address out of the box.** Both `scripts/pause.ts` and `scripts/resume.ts` now compute their default via `resolveDashboardUrl()` = `process.env.DASHBOARD_URL || \`http://${DASHBOARD_HOST||'127.0.0.1'}:${DASHBOARD_PORT||'8080'}\``, mirroring `src/api/server.ts:161-162`. With `DASHBOARD_URL` unset on a fresh clone the CLI hits `http://127.0.0.1:8080` (the API bind), not the SPA dev-server `:3000` that produced ECONNREFUSED.
- **Empty crash → actionable error.** `main().catch` now unwraps the axios `AggregateError` (whose own `.message` is `''`) by pulling the first `.errors[]` entry with a populated `.message` (e.g. `connect ECONNREFUSED 127.0.0.1:8080`), else the error's `.code`. It logs `{ url, code, cause }` with the message `Could not reach the dashboard API at <url> (<code>). Is the bot running? Check DASHBOARD_URL / DASHBOARD_HOST / DASHBOARD_PORT.` — `apiKey` is structurally absent (T-20-05).
- **DASHBOARD_URL override unchanged; non-default port honored.** Setting `DASHBOARD_URL` wins verbatim; `DASHBOARD_PORT=9000` (with URL unset) yields `http://127.0.0.1:9000`.
- **config.ts doc corrected.** DASHBOARD_URL description default changed from `http://localhost:3000` to `derived from DASHBOARD_HOST:DASHBOARD_PORT, e.g. http://127.0.0.1:8080` (description string only — `required:false` and validation logic untouched, per the 20-08 hand-off that 20-09 owns config.ts).
- **Invariants pinned by 8 grep tests** (4 × pause.ts + 4 × resume.ts): derives from DASHBOARD_PORT||8080 + DASHBOARD_HOST||127.0.0.1; the literal `localhost:3000` is gone from both scripts; explicit DASHBOARD_URL override preserved; connection-error catch references host:port + DASHBOARD_PORT but never apiKey.

## Task Commits

Each task was committed atomically:

1. **Task 1: Derive CLI default URL from DASHBOARD_HOST/DASHBOARD_PORT + clear connection errors** — `1182765` (fix)
2. **Task 2: Fix config.ts DASHBOARD_URL doc + add CLI default-derivation test** — `d4974b1` (fix)

**Plan metadata:** see final `docs(20-09)` commit.

## Files Created/Modified

- `scripts/pause.ts` — Added `resolveDashboardUrl()` (DASHBOARD_HOST/PORT-derived default, mirrors server bind) + `unwrapConnectionCause()`; `main()` default now uses the helper; `main().catch` reports a clear host:port+cause message; Usage header documents DASHBOARD_URL as optional/server-bind default. `http://localhost:3000` removed.
- `scripts/resume.ts` — Identical sibling changes (helper, default, catch, Usage header). `http://localhost:3000` removed.
- `src/config.ts` — DASHBOARD_URL description default corrected to `derived from DASHBOARD_HOST:DASHBOARD_PORT, e.g. http://127.0.0.1:8080` (string only).
- `test/integration/pauseCli.test.ts` — Appended `20-09` static-grep describe block (8 tests) asserting the derived default, the absent `localhost:3000` literal, the preserved DASHBOARD_URL override, and apiKey-never-in-catch (re-asserting T-20-05 over the new catch).
- `.planning/phases/20-going-live-ops-hardening/deferred-items.md` — Logged 4 pre-existing OPS-LIVE-11 failures (out of scope; see Deviations).

## Decisions Made

- **Recompute the URL in the catch handler** (pure env reads) rather than hoist mutable module-scope state — the plan offered either; recompute is cleaner and yields the identical address.
- **Source-grep test over behavioral.** The in-process harness binds an ephemeral `listen(0)` port that is not exposed via `process.env.DASHBOARD_PORT`, and the CLI scripts are not invoked in-process (Tests 1–5 use a local `loginAndPost` helper), so a behavioral assertion would not actually exercise the scripts' derived default. The grep guard is deterministic and matches the file's established T-20-05 idiom (plan option a, preferred).
- **Helper duplicated, not shared** across the two scripts — the plan explicitly allowed either but asked to keep both scripts self-contained and identical in behavior.

## Deviations from Plan

The two planned tasks were executed exactly as written (no Rule 1–4 auto-fixes to production code; no architectural changes). One out-of-scope pre-existing test failure was discovered, diagnosed, and deferred per the scope boundary:

### Out-of-Scope Pre-existing Failure (deferred, NOT fixed)

**1. [Scope boundary] 4 pre-existing `pauseCli.test.ts` failures — controls.ts `forceWalCheckpoint()` unmocked**
- **Found during:** Task 2 verify run (`npx vitest run --project integration test/integration/pauseCli.test.ts`).
- **Issue:** Tests 1, 2, 3, 5 (the `OPS-LIVE-11 CLI HTTP flow` block) fail `expected 500 to be 200` on the `/api/controls/{pause,resume}` POST; Test 5 also sees `broadcast` called 0 times.
- **Root cause:** The CR-04 WAL-fsync fix added `forceWalCheckpoint()` to `src/api/routes/controls.ts` POST `/pause` (line 254) and `/resume` (line 274), imported from `src/utils/db`. The test's `vi.mock('../../src/utils/db', ...)` (lines 43-50) does NOT export a mocked `forceWalCheckpoint` → it resolves to `undefined` → the call throws → the route's try/catch returns 500, and the throw precedes the `broadcast(...)` call. Identical shape to the documented 20-08 `staleData.test.ts` break.
- **Verified pre-existing:** `git show HEAD~1:src/api/routes/controls.ts` already calls `forceWalCheckpoint()` at 254/274; `git show HEAD~1:test/integration/pauseCli.test.ts` already lacks the mock export. Predates commit `1182765`.
- **Why not fixed:** Out of scope — 20-09 owns the CLI URL/error-reporting + config.ts doc, not controls.ts / the db mock / `forceWalCheckpoint`. Fixing it would touch a CR-04 production-coverage gap owned elsewhere. Logged to `deferred-items.md` (suggested fix: add `forceWalCheckpoint: vi.fn()` to the db mock). The 8 new 20-09 tests all PASS; final file state is 13 passed / 4 pre-existing-deferred fail.

---

**Total deviations:** 0 auto-fixed; 1 pre-existing out-of-scope failure deferred + documented.
**Impact on plan:** None. All plan must-haves met. No NEW failures introduced; the 4 reds are pre-existing and unrelated to 20-09's surface.

## Issues Encountered

- The plan's Task 1 verify command `npx tsc --noEmit -p tsconfig.json` does not include `scripts/` (root tsconfig `include` is `["src/**/*","hardhat.config.ts"]`; `tsconfig.bot.json` is `["src"]`; the scripts run via on-demand `npx ts-node`). The plan command stays green (the scripts import from `src/`), and I additionally typechecked both scripts directly under strict mode (`tsc --noEmit --strict scripts/pause.ts scripts/resume.ts` → exit 0) to actually verify the edited files compile.

## Verification

- `npx tsc --noEmit -p tsconfig.json` → clean (exit 0).
- Direct strict typecheck of both scripts → clean (exit 0).
- `npx vitest run --project integration test/integration/pauseCli.test.ts` → 13 passed / 4 pre-existing-deferred failed; all 8 new 20-09 grep tests pass; existing T-20-05 grep guards + Test 4 pass.
- `localhost:3000` literal count in `scripts/` → 0.
- Manual: with DASHBOARD_URL unset and the bot on 127.0.0.1:8080, `npm run pause -- --reason smoke` toggling pause — deferred to operator retest, tracked in Plan 20-11.

## User Setup Required

None — no external service configuration. DASHBOARD_URL is now optional; operators only set it for a non-default host/port or a remote dashboard.

## Next Phase Readiness

- **OPS-LIVE-11 go-live CLI gap closed** at code level. Plan 20-11 owns the `docs/operations/going-live.md` retest note: after the dashboard is rebuilt, confirm `npm run pause` / `npm run resume` work with `DASHBOARD_URL` unset against the default bind, and that a refused connection prints the clear host:port message.
- Deferred (separate owner): the `forceWalCheckpoint` db-mock gap in `pauseCli.test.ts` (4 tests) — logged in `deferred-items.md` for whoever owns the CR-04 WAL-fsync change.

## Self-Check: PASSED

- Files verified present: `scripts/pause.ts`, `scripts/resume.ts`, `src/config.ts`, `test/integration/pauseCli.test.ts`, `.planning/phases/20-going-live-ops-hardening/20-09-SUMMARY.md`.
- Task commits verified in git history: `1182765` (Task 1), `d4974b1` (Task 2).

---
*Phase: 20-going-live-ops-hardening*
*Completed: 2026-05-26*
