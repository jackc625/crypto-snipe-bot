---
phase: 20-going-live-ops-hardening
fixed_at: 2026-05-26T03:39:09Z
review_path: .planning/phases/20-going-live-ops-hardening/20-REVIEW.md
fix_scope: critical_warning
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 20: Code Review Fix Report (gap-closure)

**Fixed at:** 2026-05-26
**Source review:** `.planning/phases/20-going-live-ops-hardening/20-REVIEW.md` (gap-closure, 2026-05-25)
**Iteration:** 1
**Fix scope:** critical_warning (0 Critical + 3 Warning in scope; 4 Info out of scope)

> Note: this report supersedes a prior `20-REVIEW-FIX.md` that documented the
> earlier full-phase review (CR-01..04 / WR-01..09, 2026-05-24, 13 findings). That
> older pass is preserved in git history. This report covers ONLY the three
> gap-closure warnings from the 2026-05-25 `20-REVIEW.md`.

**Summary:**
- Findings in scope: 3
- Fixed: 3
- Skipped: 0
- Final `npx tsc --noEmit -p .`: PASS (exit 0)

## Fixed Issues

### WR-01: CORS same-origin check is scheme-blind

**Files modified:** `src/api/server.ts`
**Commit:** `8d98608`
**Applied fix:** Replaced the scheme-blind `new URL(origin).host === requestHost`
same-origin test with a full-origin comparison using `URL.origin` (which encodes
the `(scheme, host, port)` triple and normalizes default ports). The request's
own origin is built once per request as `new URL(\`${requestScheme}://${requestHost}\`).origin`,
guarded by try/catch so a malformed Host yields `requestOrigin = undefined` and
falls through to allowlist/rejection.

**Security nuance (deviation from the REVIEW suggestion — intentional):** The
REVIEW suggested deriving the scheme from `req.protocol` with Express `trust proxy`
enabled. I did NOT take that path because (a) without `trust proxy`, `req.protocol`
reports the socket scheme (`http` on the proxy->bot hop), which would *invert* the
check behind a TLS proxy — matching an attacker's `http://` Origin and rejecting
the legit `https` browser; and (b) enabling Express `trust proxy` unconditionally
makes Express trust ALL client-supplied forwarding headers (`X-Forwarded-For`,
`X-Forwarded-Proto`), a spoofing vector. This project sets no `trust proxy` today
(verified by grep). Instead:
- The request scheme is derived from the **actual socket TLS state**
  (`req.socket.encrypted`), which is **not attacker-controllable**. This closes
  the scheme gap for the direct-TLS case at zero new risk.
- For the documented TLS-terminating-proxy deployment (going-live.md §5,
  `DASHBOARD_HOST=0.0.0.0`), operators **opt in** via a new gated env flag
  `DASHBOARD_TRUST_PROXY_PROTO=1` to trust `X-Forwarded-Proto` for the scheme.
  This is the only correct way to learn the browser-facing scheme behind a proxy,
  but it is explicit/opt-in and scoped to the proto header only — it does NOT
  enable Express `trust proxy` or trust any other forwarding header.

This is strictly stronger than the prior `host:port`-only check and adds no new
spoofing surface in the secure-by-default config.

**CLEAN behaviors preserved (re-verified by reasoning + URL-parse tests):**
- No-Origin allow path (`if (!origin) return cb(null, true)`) — unchanged.
- Malformed Origin throws inside try/catch -> falls through to allowlist/rejection
  (does not allow). Malformed Host now also resolves to `undefined` -> falls through.
- Userinfo-spoof (`http://127.0.0.1:8080@evil.com`) -> `URL.origin` = `http://evil.com`
  -> no match -> rejected (verified).
- Cross-origin with empty allowlist -> rejected (verified).

**Documentation follow-up (commit `6ee8b3f`):** The new `DASHBOARD_TRUST_PROXY_PROTO`
flag is now registered in `src/config.ts` (`required: false`, non-fatal), documented
in `.env.example`, and explained in `docs/operations/going-live.md §5` (the TLS-proxy
deployment case + the `DASHBOARD_ALLOWED_ORIGINS` alternative) — matching the pattern
of every other `DASHBOARD_*` env var. This closes the go-live footgun where a
same-origin dashboard login behind a TLS-terminating proxy would otherwise 403 with
no runbook explanation.

**Human verification recommended:** This touches a security-sensitive
defense-in-depth control with a deliberate design deviation. A human should
confirm the threat-model reasoning (socket-scheme source + opt-in proxy flag) and
set `DASHBOARD_TRUST_PROXY_PROTO=1` if the production dashboard runs behind a
TLS-terminating proxy. No automated CORS test suite exists in the repo to exercise
these paths.

### WR-02: CORS rejection returned HTTP 500 + logged at error level

**Files modified:** `src/api/server.ts`, `src/api/middleware/errorHandler.ts`
**Commit:** `7a0885d`
**Applied fix:** Two coordinated changes committed atomically:
1. `server.ts` — the CORS origin-rejection now constructs an `Error` tagged with
   `statusCode = 403` (`Error & { statusCode?: number }`) before calling `cb(err)`,
   so `errorMiddleware` honors it as a 403 Forbidden instead of defaulting to 500.
2. `errorHandler.ts` — split the log level: `statusCode < 500` logs at `log.warn`
   ("API client error"); `>= 500` keeps `log.error` ("Unhandled API error"). Routine
   cross-origin probes now stay out of the error-level log during go-live monitoring.

This makes the server-condition (the misleading 500) into a correct 4xx client
condition, and resolves the log-noise concern in one finding.

### WR-03: `DASHBOARD_ALLOWED_ORIGINS` parsed once at boot vs. comment implying per-request

**Files modified:** `src/api/server.ts`
**Commit:** `b6d5d65`
**Applied fix:** Chose the comment-clarification option (over moving the parse into
the hot per-request closure). The per-request closure genuinely exists only to
capture request-specific `req.headers.host`/socket scheme; the allowlist and the
new proxy-proto flag are fixed for the process lifetime (env is set before
`startApiServer` and never mutated at runtime — no hot-reload/config-reload path).
Added a comment stating they are intentionally read once at boot, with an explicit
pointer to move them inside the closure if a runtime-reconfiguration feature is
ever added. This removes the misleading per-request implication without adding
per-request `split/map/filter` overhead for zero behavioral benefit, matching the
existing intent of the comment block.

## Skipped Issues

None — all three in-scope warnings were fixed.

## Out of scope (not addressed — by design)

The four Info findings (IN-01 placeholder trim symmetry, IN-02 length-only key
strength, IN-03 empty-branch overlap note, IN-04 `unwrapConnectionCause` default
token) are excluded from `fix_scope: critical_warning` and were intentionally not
touched.

## Verification

- Each fix re-read after editing (Tier 1) — fix text present, surrounding code intact.
- `npx tsc --noEmit -p .` run after each finding and once more at the end — PASS
  (exit 0) every time. No new type errors introduced.
- No CORS/server test suite exists in the repo, so behavioral paths were validated
  by direct Node `URL` parse tests (scheme distinction, default-port normalization,
  userinfo-spoof resolution) rather than automated tests.
- Working tree clean after all commits; no uncommitted or partial changes remain.
- Commits made straight to `master` (project `branching_strategy: none`); pre-commit
  hooks ran and passed (no `--no-verify`).

---

_Fixed: 2026-05-26_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
