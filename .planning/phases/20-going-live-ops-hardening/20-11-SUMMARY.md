---
phase: 20-going-live-ops-hardening
plan: 11
subsystem: docs-ops + config
tags: [docs, ops-live, gap-closure, dashboard, cors, dashboard-api-key, dashboard-url, env-example, runbook]

# Dependency graph
requires:
  - phase: 20-going-live-ops-hardening (plan 20-08)
    provides: "src/api/server.ts same-origin CORS (DASHBOARD_ALLOWED_ORIGINS only needed cross-origin) + src/preflight.ts DASHBOARD_API_KEY placeholder/empty/<16 FATAL rule"
  - phase: 20-going-live-ops-hardening (plan 20-09)
    provides: "scripts/pause.ts + scripts/resume.ts CLI default URL derived from DASHBOARD_HOST:DASHBOARD_PORT (http://127.0.0.1:8080) + clear ECONNREFUSED host:port error; config.ts DASHBOARD_URL description"
  - phase: 20-going-live-ops-hardening (plan 20-10)
    provides: "PauseBanner/CircuitBreakerBanner card-idiom restyle (contained red-alert card, not full-bleed slab)"
provides:
  - ".env.example documents DASHBOARD_ALLOWED_ORIGINS (empty default = same-origin works; set only cross-origin) — a fresh clone has the var visible"
  - ".env.example DASHBOARD_URL default corrected localhost:3000 -> 127.0.0.1:8080 (matches server bind + 20-09 CLI default)"
  - "src/config.ts REQUIRED_ENV_VARS includes DASHBOARD_ALLOWED_ORIGINS (required:false) — appears in the canonical env-vars source of truth"
  - "docs/operations/going-live.md documents the dashboard SPA rebuild step, the strong-key FATAL requirement, and the pause/resume CLI DASHBOARD_URL + DASHBOARD_ALLOWED_ORIGINS contract"
affects: [operator-runbook, fresh-clone-go-live, OPS-LIVE-07, OPS-LIVE-11, OPS-LIVE-12]

# Tech tracking
tech-stack:
  added: []   # no new dependencies — docs + one config array-literal entry
  patterns:
    - "Document-what-is-actually-true-now: runbook describes the post-fix contract (same-origin works without CORS config; CLI derives URL from HOST:PORT; banner is a card) rather than the pre-fix workarounds the UAT used"
    - ".env.example DASHBOARD_API_KEY placeholder line (73) left byte-for-byte untouched to preserve sync with src/preflight.ts:123 DASHBOARD_API_KEY_PLACEHOLDER constant"

key-files:
  created:
    - ".planning/phases/20-going-live-ops-hardening/20-11-SUMMARY.md"
  modified:
    - ".env.example"
    - "src/config.ts"
    - "docs/operations/going-live.md"

key-decisions:
  - "Did NOT touch .env.example:73 DASHBOARD_API_KEY placeholder (only added DASHBOARD_ALLOWED_ORIGINS at line 77 + fixed DASHBOARD_URL at line 213) — keeps the byte-for-byte sync with the 20-08 preflight.ts placeholder constant intact"
  - "Did NOT modify the config.ts DASHBOARD_URL entry (20-09 owns it) and did NOT add a placeholder-key check in config.ts (20-08 owns it in preflight.ts) — config.ts change is the single additive DASHBOARD_ALLOWED_ORIGINS array entry"
  - "Documented the runbook to the ACTUAL shipped behavior: 20-08 made same-origin POST work automatically (DASHBOARD_ALLOWED_ORIGINS only for cross-origin), 20-09 made the CLI derive its URL from HOST:PORT — described the current contract, not the UAT-era .env workarounds"
  - "Also corrected the §Dashboard-usage 'full-bleed red banner' wording to 'red BOT PAUSED alert card' to match 20-10's card-idiom restyle (in-scope: the same section the plan asked me to document the CLI/CORS model in, and it was a now-false statement)"

requirements-completed: [OPS-LIVE-07, OPS-LIVE-11, OPS-LIVE-12]

# Metrics
duration: ~9min
completed: 2026-05-26
tasks: 2
files: 3
---

# Phase 20 Plan 11: Going-Live Docs/Ops Gap Closure Summary

**A fresh clone now works out of the box: `.env.example` + `src/config.ts` document `DASHBOARD_ALLOWED_ORIGINS` and correct the `DASHBOARD_URL` default to `127.0.0.1:8080`, and `docs/operations/going-live.md` documents the mandatory dashboard SPA rebuild step, the strong-random `DASHBOARD_API_KEY` FATAL requirement, and the pause/resume CLI `DASHBOARD_URL` / `DASHBOARD_ALLOWED_ORIGINS` same-origin-vs-cross-origin contract — the doc twins of the Wave-1 code fixes (20-08 CORS + key FATAL, 20-09 CLI URL, 20-10 banner).**

This is the FINAL Phase-20 gap-closure plan. The operator's local `.env` workarounds that made the live UAT pass are gitignored and not in the repo, so these fixes had to live in the committed `.env.example` + `config.ts` + runbook for a new operator to reach a working, secure dashboard without trial-and-error.

## What Was Built

### Task 1 — `DASHBOARD_ALLOWED_ORIGINS` documented + `DASHBOARD_URL` corrected (commit `c7372ca`)

**`.env.example` (two edits):**
1. Added `DASHBOARD_ALLOWED_ORIGINS=` (empty default) at line 77, immediately after the `DASHBOARD_HOST` `0.0.0.0` comment, in the `[OPTIONAL]` inline-comment format used by the surrounding dashboard lines. The comment explains: comma-separated EXTRA browser origins allowed to call the API (CORS); LEAVE EMPTY for the default local/same-origin dashboard (the SPA served by the bot at `http://DASHBOARD_HOST:DASHBOARD_PORT` is same-origin and works without this); ONLY set it for a DIFFERENT origin (remote host / separate dev server), e.g. `https://dashboard.example.com,http://localhost:5173`.
2. Corrected line 213 (was line 208) `DASHBOARD_URL` — both the value AND the inline comment — from `http://localhost:3000` to `http://127.0.0.1:8080` with comment `default: derived from DASHBOARD_HOST:DASHBOARD_PORT = http://127.0.0.1:8080`. Uses `127.0.0.1` (not `localhost`) to match the IPv4 bind and the plan-20-09 CLI default.

**`src/config.ts`:** Added a `DASHBOARD_ALLOWED_ORIGINS` entry to `REQUIRED_ENV_VARS` (required: `false`) immediately after the `DASHBOARD_API_KEY` entry, with a description naming it as comma-separated extra browser origins for CORS, empty default = same-origin works, set only for cross-origin/remote dashboards. A plain additive array-literal entry — the `DASHBOARD_URL` entry (20-09's) and the absence of a placeholder-key check (20-08 owns it in preflight.ts) are untouched.

**Coordination preserved:** `.env.example:73` `DASHBOARD_API_KEY=your-secret-dashboard-api-key-here` was left byte-for-byte untouched, so it stays in exact sync with the `DASHBOARD_API_KEY_PLACEHOLDER` constant in `src/preflight.ts:123` (the 20-08 FATAL rule matches that literal).

### Task 2 — going-live runbook: rebuild step, strong-key FATAL, CLI URL/CORS (commit `c006483`)

**(a) Dashboard rebuild step (§7 + §8 cross-ref).** Added a fenced `cd dashboard && npm install && npm run build` block after the existing `npm install / npm run build / npm run test:unit` block, explaining that the bot serves the compiled SPA from `dashboard/dist` — a SEPARATE build from the root `npm run build` (tsc) — and that the operator MUST (re)build before §8 or the bot serves a STALE build (or 404s `Dashboard not built. Run build in dashboard/ first.`, quoting `server.ts`). Called out explicitly that this is required after pulling Phase-20 dashboard changes (a stale pre-Phase-20 dist won't show the pause banner). Added a `>`-quoted one-line cross-reference after the §8 health check that a stale `dashboard/dist` is the usual cause when the pause banner / new UI doesn't appear.

**(b) Strong `DASHBOARD_API_KEY` + FATAL behavior (§5 + failure-modes entry).** Kept the existing `randomBytes(32)` key-generation snippet; changed the lead-in from "Replace the weak default (`password`)" to "Replace the shipped placeholder (`your-secret-dashboard-api-key-here`)" (the actual shipped literal). Added prose: the bot now FATAL-exits at startup via preflight `validateCrossEnvRules` if `DASHBOARD_API_KEY` is the placeholder, empty, or `<16` chars — mandatory not advisory, the Phase-20 "refuses to start in an unsafe state" guarantee extended to the admin credential; the failure carries a `details.rule: 'dashboard-api-key'` pointer back to §5 (`npm run preflight` to preview). Also added a same-origin/cross-origin `DASHBOARD_ALLOWED_ORIGINS` note to §5. Added a 5th bullet (`dashboard-api-key`) to the existing `validateCrossEnvRules` failure-modes entry with remediation "regenerate a strong random key per §5", and updated that entry's "four rules" framing + "Why" + remediation to include the key rule.

**(c) Pause/resume CLI URL + CORS docs (Pause/resume CLI section).** Added a `### CLI connection (DASHBOARD_URL)` subsection: the CLI dials `DASHBOARD_URL`, which DEFAULTS to the server bind derived from `DASHBOARD_HOST:DASHBOARD_PORT` (`http://127.0.0.1:8080`), so `npm run pause`/`resume` work out of the box on a fresh clone with `DASHBOARD_URL` unset; operators set it only for a non-default host/port or a remote bot; use `127.0.0.1` not `localhost` to avoid `::1` IPv6 refusal. Documented that a refused connection now prints a clear `Could not reach the dashboard API at <url> (<code>). Is the bot running? ...` message (no more empty-error `Pause CLI crashed`) referencing only url/host:port + code, never the API key. Updated the §Dashboard-usage banner wording from "full-bleed red banner" to "red BOT PAUSED alert card" to match 20-10's card-idiom restyle, and noted the SPA is served same-origin so login + Resume work with `DASHBOARD_ALLOWED_ORIGINS` empty.

Refreshed the "Last updated" footer to 2026-05-26 noting the Plan 20-11 gap-closure pass.

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit -p tsconfig.bot.json` (Task 1 config.ts edit) | clean, exit 0 |
| `.env.example` `DASHBOARD_ALLOWED_ORIGINS` present (line 77), `DASHBOARD_URL=http://127.0.0.1:8080` (line 213), no `localhost:3000`, line 73 placeholder unchanged | confirmed via grep |
| `src/config.ts` `DASHBOARD_ALLOWED_ORIGINS` registered (required:false) | confirmed |
| `going-live.md` token count `cd dashboard` | 3 (non-zero) |
| `going-live.md` token count `DASHBOARD_ALLOWED_ORIGINS` | 3 (non-zero) |
| `going-live.md` token count `127.0.0.1:8080` | 6 (non-zero) |
| `going-live.md` token count `your-secret-dashboard-api-key-here` | 3 (non-zero) |
| `npx vitest run --project unit test/unit/ci/rootFileGuard.test.ts` | 4/4 pass, exit 0 (GOING-LIVE.md does not reappear at repo root) |
| Commit deletion check (both commits) | clean — no deletions |

The four `rg` token searches and the root-file guard self-test together are the plan's Task 2 verify gate; all pass.

This plan also satisfies the UAT `banner_retest: pending` precondition: with 20-08..20-10 landed + the now-documented dashboard rebuild done, the operator can re-verify the pause banner appears (card idiom) and login/pause/resume work same-origin with `DASHBOARD_ALLOWED_ORIGINS` empty — the manual visual retest itself remains an operator action, not a code gate.

## Deviations from Plan

### Auto-fixed Issues

None to production code. Two in-scope accuracy refinements within the sections the plan directed me to edit:

**1. [Rule 1 - Doc accuracy] Corrected §Dashboard-usage "full-bleed red banner" → "red BOT PAUSED alert card"**
- **Found during:** Task 2 (c) — editing the Pause/resume CLI section, which contains the §Dashboard-usage subsection.
- **Issue:** The doc described the pause banner as a "full-bleed red banner (D-PAUSE-UI)". Plan 20-10 restyled it to a contained card idiom (dropped the `-mx` full-bleed). Leaving "full-bleed" would be a now-false statement, and the environment notes instruct documenting what is actually true now.
- **Fix:** Reworded to "red BOT PAUSED alert card" with a parenthetical noting the 20-10 restyle. Presentation-description only; the WS/behavior description is unchanged.
- **Files:** `docs/operations/going-live.md`. **Commit:** `c006483`.

**2. [Rule 1 - Doc accuracy] Reframed the validateCrossEnvRules "four rules" entry to include the 5th (dashboard-api-key) rule**
- **Found during:** Task 2 (b).
- **Issue:** The failure-modes entry said "any of four cross-variable rules fires" and listed four. Plan 20-08 shipped a 5th rule (`dashboard-api-key`). The plan explicitly asks me to add a note for it here, so the "four" framing had to become rule-count-agnostic.
- **Fix:** Changed "four cross-variable rules" → "these cross-variable rules", added the `dashboard-api-key` bullet, and folded it into the "Why" + remediation lines.
- **Files:** `docs/operations/going-live.md`. **Commit:** `c006483`.

Both are direct consequences of the planned edits (documenting the 20-08/20-10 shipped behavior accurately), not separate scope.

## Issues Encountered (tooling, not a fix)

- The plan's Task 2 verify command begins `npx rg --fixed-strings --count-matches ...`. On this Windows host `rg` is not installed, and `npx rg` resolved to a bogus/empty npm package `rg@0.0.2` (NOT ripgrep) which printed `README.md already exists. run with -f to overwrite`. Per the executor package-manager exclusion (a failed/unexpected npm package resolution is not auto-substituted), I did NOT chase an alternative package. I confirmed via `git status` that the bogus package made **no** change to the repo working tree (the tracked `README.md` was not modified; no untracked files created), then ran the four token counts with the environment's dedicated ripgrep-backed search tool instead, which is the correct content-search path here. All four counts are non-zero (3 / 3 / 6 / 3), satisfying the verify intent. The root-file-guard vitest half of the gate ran normally and passed 4/4.

## Out-of-Scope / Not Touched (by design)

- `.env.example:73` `DASHBOARD_API_KEY` placeholder line — left byte-for-byte untouched (sync with `src/preflight.ts:123`).
- `src/config.ts` `DASHBOARD_URL` entry — owned by 20-09; untouched.
- `src/preflight.ts` / `src/api/server.ts` — the Wave-1 code this plan documents; not modified.
- §9 "Kill switch" legacy `POST /api/controls/pause-snipes` curl — pre-existing, outside this plan's documentation surface (the plan scoped §9 to only the stale-dist cross-reference note).
- Pre-existing 12-test failure inventory (stale `src/utils/db` mocks missing `forceWalCheckpoint` / `getStaleTradesQuery`) in `deferred-items.md` — out of scope; not touched; no new failures introduced (this plan ran only the root-file-guard self-test, which is unrelated and green).

## Threat Model Compliance

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-20-11-01 (undocumented strong-key requirement / EoP) | mitigate | §5 now states the bot FATAL-exits on placeholder/empty/<16 key (20-08 enforced); operator cannot unknowingly ship the default admin credential. ✓ |
| T-20-11-02 (DASHBOARD_ALLOWED_ORIGINS misuse / Info Disclosure) | mitigate | `.env.example` + §5 + config.ts all state empty=same-origin (default) and to set it ONLY for trusted cross-origin hosts; explicit "do not use a permissive wildcard" — discourages re-opening the CR-02 CSRF surface. ✓ |
| T-20-11-SC (npm/pip/cargo installs / Tampering) | mitigate | No new dependencies introduced. The documented `cd dashboard && npm install` is the existing dashboard build. (The accidental `npx rg@0.0.2` resolution was a verify-command artifact, made no repo change, and added no project dependency.) ✓ |

No new security surface introduced; nothing to add to a Threat Flags section.

## Self-Check: PASSED

- FOUND: `.env.example` (modified — `DASHBOARD_ALLOWED_ORIGINS` line 77, `DASHBOARD_URL=http://127.0.0.1:8080` line 213)
- FOUND: `src/config.ts` (modified — `DASHBOARD_ALLOWED_ORIGINS` entry registered)
- FOUND: `docs/operations/going-live.md` (modified — `cd dashboard` rebuild block, strong-key FATAL §5, CLI DASHBOARD_URL/CORS subsection)
- FOUND: `.planning/phases/20-going-live-ops-hardening/20-11-SUMMARY.md` (created)
- FOUND commit `c7372ca` (Task 1)
- FOUND commit `c006483` (Task 2)

---
*Phase: 20-going-live-ops-hardening — FINAL gap-closure plan*
*Completed: 2026-05-26*
