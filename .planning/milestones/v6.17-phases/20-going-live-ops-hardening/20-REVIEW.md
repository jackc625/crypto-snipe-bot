---
phase: 20-going-live-ops-hardening
reviewed: 2026-05-25T00:00:00Z
depth: standard
scope: gap-closure (diff since c2c724d — plans 20-08/09/10/11)
files_reviewed: 8
files_reviewed_list:
  - src/api/server.ts
  - src/preflight.ts
  - src/config.ts
  - scripts/pause.ts
  - scripts/resume.ts
  - dashboard/src/components/PauseBanner.tsx
  - dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx
  - dashboard/src/components/Layout.tsx
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 20: Code Review Report (gap-closure)

**Reviewed:** 2026-05-25
**Depth:** standard
**Scope:** diff since `c2c724d` only (plans 20-08 CORS/preflight, 20-09 CLI URL, 20-10 banner restyle, 20-11 config entry)
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Gap-closure review of the diff since `c2c724d`. Pre-existing code outside the diff was read for
context but not re-litigated.

The security-priority change — the CORS origin-allow rewrite in `src/api/server.ts` — was
scrutinized hard for CSRF/origin-spoofing bypass. **Headline conclusion: the change does NOT open
a practical CSRF hole, because the real CSRF backstop is the `sameSite: 'strict'` session cookie
set in `src/api/middleware/auth.ts:68`, which prevents the session cookie from ever being attached
to a true cross-site request regardless of CORS.** CORS here is defense-in-depth, not the primary
control. Cross-origin `evil.com` is still rejected with empty `DASHBOARD_ALLOWED_ORIGINS`; the
malformed-Origin path falls through to rejection (does not throw, does not allow); the
userinfo-spoof case (`http://127.0.0.1:8080@evil.com`) is rejected. All verified by direct
URL-parse testing.

However, the new same-origin comparison is **scheme-blind** (compares only `host:port`, ignoring
`http` vs `https`), weakening the defense-in-depth layer specifically in the documented
TLS-terminating-proxy deployment (`going-live.md:149`). The CORS rejection path also mislabels
blocked requests as HTTP 500 (logged at error level) instead of 403. The preflight placeholder
guard is byte-for-byte correct against `.env.example:73`, with one whitespace-padding edge case.
The CLI URL-derivation + connection-error-unwrap changes are sound. The banner restyle is
CSS-class-only and clean.

No BLOCKER-class defects. Three WARNINGs and four INFO items follow.

## Warnings

### WR-01: CORS same-origin check is scheme-blind — `http` origin accepted as same-origin behind a TLS proxy

**File:** `src/api/server.ts:84`
**Issue:**
The same-origin test is `new URL(origin).host === requestHost`. `URL.host` is only `hostname:port`
— it excludes the scheme by design. Verified by direct test:

```
new URL('https://example.com').host === 'example.com'        // true
new URL('http://example.com:443').host === 'example.com:443'  // true  ← scheme ignored
```

A web origin is the `(scheme, host, port)` triple. Comparing only `host:port` treats
`http://app.example.com` and `https://app.example.com` as the same origin. This matters in exactly
the deployment the docs call out — `DASHBOARD_HOST=0.0.0.0` behind a TLS-terminating reverse proxy
(`docs/operations/going-live.md:149`). There the browser speaks `https` while the proxy forwards a
`Host` that can match an attacker-supplied `http://` Origin's `host:port`, so an insecure-origin
page would be classified "same-origin" and pass CORS without appearing in
`DASHBOARD_ALLOWED_ORIGINS`.

This is a defense-in-depth weakening, not a full CSRF break — the `sameSite: 'strict'` cookie
(`src/api/middleware/auth.ts:68`) still blocks the session cookie on a true cross-site request, so
authenticated control endpoints stay protected. Hence WARNING, not BLOCKER. But the comment block
at server.ts:54-71 sells this check as the anti-CSRF mechanism, so the scheme gap should be closed
to match the stated intent.

**Fix:** Compare the full origin (scheme + host + port). Behind a proxy, derive the request scheme
from `req.protocol` with `trust proxy` enabled:

```ts
app.use((req, res, next) => {
    const requestHost = req.headers.host;
    const requestOrigin = requestHost ? `${req.protocol}://${requestHost}` : undefined; // req.protocol honors X-Forwarded-Proto under 'trust proxy'
    return cors({
        origin: (origin, cb) => {
            if (!origin) return cb(null, true);
            try {
                if (requestOrigin && new URL(origin).origin === new URL(requestOrigin).origin) {
                    return cb(null, true);
                }
            } catch { /* malformed Origin → fall through */ }
            if (allowedOrigins.includes(origin)) return cb(null, true);
            cb(new Error('CORS: origin not allowed'));
        },
        credentials: true,
    })(req, res, next);
});
```

### WR-02: CORS rejection returns HTTP 500 + logs at error level — should be 403

**File:** `src/api/server.ts:93` → `src/api/middleware/errorHandler.ts:31-33`
**Issue:**
When the origin callback calls `cb(new Error('CORS: origin not allowed'))`, `cors@2.8.6` forwards
it via `next(err)` (confirmed in `node_modules/cors/lib/index.js:220-221`), landing in
`errorMiddleware`. That handler defaults `statusCode` to **500** (the plain `Error` has no
`statusCode`) and logs every rejection at `log.error(... 'Unhandled API error')`.

Consequences:
1. A blocked cross-origin request — a *client* condition — is reported as `500 Internal Server
   Error` (misleading; should be 403 Forbidden).
2. Routine CORS rejections spam the error log as "Unhandled API error", degrading
   signal-to-noise exactly during go-live monitoring. A probe loop against the dashboard would
   flood error-level logs.

This is the same 500-vs-CORS confusion the 20-08 comment block (server.ts:62-64) describes for the
prior implementation; the rewrite fixed the same-origin *trigger* but the rejection path still
yields 500.

**Fix:** Tag the CORS error with a 4xx status so `errorMiddleware` honors it:

```ts
const e = new Error('CORS: origin not allowed') as Error & { statusCode?: number };
e.statusCode = 403;
cb(e);
```

Optionally have `errorMiddleware` log `statusCode < 500` at `log.warn` so client errors stop
masquerading as server errors.

### WR-03: `DASHBOARD_ALLOWED_ORIGINS` parsed once at boot, not per request — comment implies otherwise

**File:** `src/api/server.ts:72-73`
**Issue:**
`allowedOrigins` is computed once when `startApiServer()` runs and closed over by the per-request
middleware. The 20-08 rewrite moved the `cors()` construction inside `app.use((req,res,next)=>...)`
to capture `req.headers.host` per request, but left the allowlist read outside that closure. The
inline comment ("we build the middleware per-request to capture `req.headers.host`", server.ts:71)
implies a per-request freshness that does not extend to the allowlist.

Not a runtime bug today (`DASHBOARD_ALLOWED_ORIGINS` is fixed at boot). It is a latent
correctness/maintainability trap adjacent to security-sensitive code that just got reworked: any
future env mutation expecting effect (post-`startApiServer` test setup, hot-reload, a config-reload
feature) would silently use the stale boot value, and the comment misleads a reader about the scope
of per-request evaluation.

**Fix:** Move the parse inside the request closure (cheap env read + split) so it is genuinely
per-request, or add a one-line comment that the allowlist is intentionally captured once at boot.

## Info

### IN-01: Whitespace-padded placeholder DASHBOARD_API_KEY can slip past Rule 5

**File:** `src/preflight.ts:509-533`
**Issue:**
The placeholder branch uses an exact, untrimmed compare (`dashboardApiKey === DASHBOARD_API_KEY_PLACEHOLDER`)
while the empty and length branches use `.trim()`. A value like `" your-secret-dashboard-api-key-here "`
fails the exact placeholder match, passes the non-empty check, and at trimmed length 34 passes the
`< 16` check — so a whitespace-padded copy of the documented default would NOT be flagged as a
placeholder. In practice `dotenv` trims surrounding whitespace on unquoted values, so this requires
the operator to *quote* a padded placeholder. Extreme edge case → INFO.

**Fix:** Trim before the placeholder compare for symmetry:
`const dashboardApiKey = process.env.DASHBOARD_API_KEY?.trim();`

### IN-02: Rule 5 "strong key" is length-only (≥16 chars) — `aaaaaaaaaaaaaaaa` passes

**File:** `src/preflight.ts:525-532`
**Issue:**
The weak-key guard only checks `dashboardApiKey.trim().length < 16`. A 16-char repeated/low-entropy
string or a dictionary phrase passes. The comment + remediation copy promise a "strong random key"
but the check enforces only length. This matches the contract the plan documented (placeholder /
empty / `<16`), so INFO not WARNING — but "strong" may be read as entropy-checked when it is not.

**Fix (optional):** Keep length-only and soften the wording, or add a light character-class/entropy
heuristic. No change required for the stated contract.

### IN-03: Rule 5 "empty" branch partially overlaps the config.ts presence check

**File:** `src/preflight.ts:517-524` vs `src/config.ts:27` + `:160-171`
**Issue:**
`config.ts` marks `DASHBOARD_API_KEY` `required: true` and FATAL-exits at import time if falsy,
which runs before `preflight()`. So Rule 5's "empty" branch is unreachable for a fully-unset key
(config.ts kills the process first). It IS reachable and useful for a whitespace-only value (`" "`),
which passes config.ts's truthiness check but trips `trim() === ''`. Not a defect — defensible
defense-in-depth — but the redundancy is worth a note so a future reader does not assume the branch
is dead and delete it.

**Fix:** None required. Optionally comment that the branch covers the whitespace-only case.

### IN-04: `unwrapConnectionCause` defaults to literal "ECONNREFUSED" for any aggregate error

**File:** `scripts/pause.ts:130-142`, `scripts/resume.ts:93-104`
**Issue:**
`isRefused` is true whenever the error has a non-empty `errors[]` array, even for non-connection
aggregate errors. When inner errors carry a real `code` (`ENOTFOUND`, `ETIMEDOUT`) it is correctly
preserved (verified). But if inner errors lack both `code` and `message`, the fallback labels the
failure `ECONNREFUSED` and the message asserts "Could not reach the dashboard API at ...
(ECONNREFUSED). Is the bot running?" — which can misdescribe a non-connection failure. Exit code
and behavior are unaffected; apiKey is correctly never included. Cosmetic → INFO.

**Fix (optional):** Default the fallback code to a neutral token (e.g. `'NETWORK_ERROR'`), or only
treat `hasErrors` as a refusal when an inner code matches a known connection-error set
(`ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT`/`ECONNRESET`).

---

## Explicitly checked and CLEAN

- **Cross-origin still rejected:** empty `DASHBOARD_ALLOWED_ORIGINS`, `http://evil.com` vs Host
  `127.0.0.1:8080` → host comparison `false` → rejected (verified).
- **Malformed Origin:** `new URL(origin)` throw is caught and falls through to allowlist/reject; it
  does NOT allow (server.ts:83-89). Correct.
- **Userinfo spoof:** `http://127.0.0.1:8080@evil.com` parses to host `evil.com`, no match,
  rejected (verified). Correct.
- **No-Origin allow path:** `if (!origin) return cb(null, true)` is necessary (GET/HEAD, curl, the
  axios CLI which sends no Origin) and safe under SameSite=strict. Correct.
- **`req.headers.host` type:** Node collapses/rejects duplicate Host headers → `string | undefined`;
  the `if (requestHost && ...)` guard handles undefined. No array hazard.
- **Primary CSRF control intact:** `sameSite: 'strict'` cookie (auth.ts:68) unchanged by this diff;
  `LoginForm.tsx` + dashboard fetches use `credentials: 'include'`, consistent with same-origin.
- **Placeholder byte-match:** `DASHBOARD_API_KEY_PLACEHOLDER` matches `.env.example:73`
  byte-for-byte. Correct.
- **CLI URL derivation:** `resolveDashboardUrl()` mirrors server-bind defaults (`127.0.0.1`/`8080`),
  honors `DASHBOARD_URL` override, uses IPv4 to avoid `::1` refusal; old `localhost:3000` default
  fully removed. Correct.
- **Banner restyle (20-10):** `PauseBanner.tsx` / `CircuitBreakerBanner.tsx` / `Layout.tsx` are
  CSS-class-only (card idiom, removed full-bleed negative margins). The WR-04 double-click guard,
  server-as-source-of-truth unmount, and null-`pausedAt` sentinel are preserved. Clean.

---

_Reviewed: 2026-05-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (gap-closure)_
