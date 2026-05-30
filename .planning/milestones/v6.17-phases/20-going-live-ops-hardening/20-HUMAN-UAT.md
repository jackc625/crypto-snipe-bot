---
status: complete
phase: 20-going-live-ops-hardening
source: [20-VERIFICATION.md]
started: 2026-05-24T23:30:00Z
updated: 2026-05-26T04:04:46Z
---

## Current Test

[testing complete]

## Tests

### 1. npm run preflight smoke test against live RPC
expected: Script exits 0 and prints per-chain pass/fail summary without starting the bot; no `startMultiChainBot` log line appears. On any FATAL, exit non-zero with structured pino error pointing to docs/operations/going-live.md.
result: pass
note: |
  Both code paths verified across two runs. Clean run (00:06:44Z): all 6 ETH
  checks PASS (rpc-chainid, rpc-block-age, wallet-balance, mev-health,
  honeypot-checker-code, antirug-live-gate) → "Preflight passed: 6 checks",
  exit 0 per scripts/preflight.ts:111, no bot-start line. First run (00:00:32Z)
  hit a transient DNS ENOTFOUND on the Alchemy host (resolves fine now), which
  exercised the FATAL path: exit 1, structured per-chain pino summary, no bot
  start. Minor non-blocking observation: in the failure run only
  honeypot-checker-code embedded the docs/operations/going-live.md pointer;
  rpc-* and wallet-balance failures did not — acceptable for transient infra
  errors vs config FATALs (config FATALs carry remediation via
  validateCrossEnvRules per 20-VERIFICATION SC1).

### 2. Dashboard pause banner visual + WS event delivery
expected: With dashboard open in browser, `npm run pause -- --reason 'smoke'` causes red full-bleed BOT PAUSED banner to appear immediately; `npm run resume` removes it. Banner survives page navigation. WS push (not polling) drives both transitions.
result: pass
retest: "2026-05-26 — operator confirmed PASS after gap closure (20-08..20-11) + CORS hardening (WR-01/02/03). Orchestrator pre-cleared prerequisites: rebuilt dashboard/dist (tsc -b + vite build clean; card-idiom restyle now bundled — index-C212GrGb.js), confirmed DASHBOARD_API_KEY is a strong key (preflight will not FATAL), confirmed pause_state.paused=1 so the bot started PAUSED (zero real-capital exposure during the visual retest). Operator-observed: same-origin login succeeded (no CORS error), BOT PAUSED card-idiom banner rendered on load, `npm run resume` removed it via WS push, `npm run pause` restored it via WS push. Original issue (below) resolved."
original_report: "Ok it works now. Minor issue: the paused banner doesn't appear at all like the rest of the dashboard. It doesnt have to be perfect, but it should have some resemblance to the dashboard stylistically"
original_severity: major
note: |
  WS/functional behavior PASSED: once configured, `npm run pause` shows the BOT
  PAUSED banner and `npm run resume` removes it via WS push — confirmed by user
  ("it works now"). But the feature was unusable OUT OF THE BOX. Three findings
  (all test:2 in Gaps):
    1. CORS rejects same-origin dashboard POST (DASHBOARD_ALLOWED_ORIGINS empty/undocumented) — MAJOR
    2. npm run pause/resume crash: CLI default :3000 != server :8080 (DASHBOARD_URL unset/undocumented) — MAJOR
    3. Banner styling does not match the dashboard card idiom — COSMETIC
  Also surfaced en route: dashboard/dist was a stale pre-Phase-20 build (operator
  must rebuild before serving) and DASHBOARD_API_KEY is the shipped placeholder
  (separate go-live security blocker — see Test 1 area / final summary). Test
  severity = major, driven by #1 + #2 blocking the deliverable out of the box.
  All confirmed working after the documented workarounds.

### 3. Multi-stage kill-switch timing under live MEV conditions
expected: Press dashboard pause button while bot is mid-evaluation; CP1 fires on next PairCreated event after pause; `sendTxWithRetry` is never called for that event; pino info `op:killswitch.cp1` appears in logs.
result: pass
note: |
  IMPORTANT discovery: CP1 is a POST-safety-bank check (src/bot.ts:355-363, comment
  "post-safety-bank pause check"). It only fires for a token that passes ALL safety
  gates (honeypot, liquidity-locked, sufficient-liq, metadata, canSwap, no-tax,
  no-limits, not-mutable) — rare on live mainnet, so an explicit live CP1 is
  impractical to trigger on demand and a plain "watch while paused" is confounded
  (nearly all pairs are blocked by safety, not by pause). Verification approach
  (user chose "Both"):
progress: |
  Part A (deterministic proof) PASSED — test/integration/killswitchCheckpoints.test.ts,
  8/8 green, verified to use REAL assertions (read the source): with the safety bank
  mocked all-pass + paused=1, V2 CP1 logs op:killswitch.cp1 and sendTxWithRetry +
  insertTrade are NEVER called; the no-pause happy path DOES call sendTxWithRetry
  (control proves the harness reaches the buy, so "not called" is meaningful). CP2
  builds then discards the bundle (no submit); CP3 is audit-only (trade still recorded
  post-submit — pause never panic-sells). V3 mirrors V2 (core no-buy assertion
  unconditional; log-shape checks guarded by `if(cp)` — slightly softer than V2).
  Part B (live watch) DONE: bot held paused 00:55:17->01:04:40 (~9.5 min); ZERO buys,
  ZERO "MEV bundle submitted", no killswitch.cp* — only periodic Flashbots health pings
  (every 5 min, proving the loop is alive) and no WS reconnect/error logs (subscriptions
  still attached). No new pair came through the watched DEXes in the window (quiet ETH
  V2/V3 period — plausible), so an active live CP1 was not captured; the deterministic
  Part A proof carries the verdict. Kill-switch NOT violated. PASS.

### 4. D-PAUSED-RESTART full positive observable
expected: Seed `pause_state.paused=1` in `data/bot.db`, restart bot — all chain listeners attach, dashboard responds 200, exit monitors run for open positions, first new `PairCreated` triggers CP1 early-return (no buy). Operator-pressed pause survives a full reboot.
result: pass
note: |
  User restarted the already-paused bot (pause_state.paused=1 persisted from test 3 —
  no DB seeding needed). On reboot: chain listeners attached + dashboard API up
  ("Multi-chain bot fully started"); after re-login (in-memory sessions reset on
  restart — expected, matches the "WebSocket upgrade rejected: invalid session" lines
  seen post-restart) the dashboard showed BOT PAUSED IMMEDIATELY without re-running
  pause. User confirmed: "still paused after restart, pass". D-PAUSED-RESTART holds —
  an operator pause survives a full reboot (loaded from SQLite), so a restart cannot
  silently re-enable buying.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

issues_detail: |
  Test 2 surfaced a cluster of go-live defects in the dashboard/CLI control plane
  (all logged in Gaps): CORS rejects same-origin POST (major), pause/resume CLI
  port mismatch crashes out of the box (major), placeholder DASHBOARD_API_KEY admin
  credential (major/security, cross-cutting), banner styling mismatch (cosmetic),
  and a stale dashboard/dist build (operator/runbook). Core safety — preflight
  (test 1) and the multi-stage kill-switch incl. restart-persistence (tests 3, 4)
  — all PASS. Net (at time of issue): the kill-switch works, but the operator-facing
  surface is not usable on the shipped config + the bot starts on a default admin key.
  RESOLVED 2026-05-26: all 5 findings closed — same-origin CORS works out of the box
  (20-08 + WR-01/02/03), CLI derives :8080 with clear errors (20-09), banner uses the
  card idiom (20-10), preflight FATALs on the placeholder admin key (20-08), and the
  stale-dist footgun is documented in the runbook (20-11). Operator retest of Test 2
  PASSED on a rebuilt dashboard. The phase goal — "refuse to start in any unsafe state"
  — now also covers the default admin credential.

## Gaps

- truth: "Operator can open and log into the dashboard so the pause banner is usable (test 2 precondition)"
  status: resolved
  reason: "User reported: 'Still CORS error. The dashboard wont even load' — every API call returns 500 'CORS: origin not allowed'. Dashboard login POST is rejected even when served same-origin from the bot at 127.0.0.1:8080."
  severity: major
  test: 2
  found_during: "test 2 setup (dashboard access), before banner behavior could be observed"
  root_cause: "Phase-20 commit 2d3395e (CR-02) added an Origin allowlist in src/api/server.ts:62-68. The check `if (!origin || allowedOrigins.includes(origin)) return cb(null,true)` assumes same-origin requests carry no Origin header — true only for GET/HEAD. Browsers DO send Origin on same-origin POST (login, /api/controls/pause, /api/controls/resume). DASHBOARD_ALLOWED_ORIGINS ships empty and is undocumented, so every same-origin POST is rejected → 500 → dashboard cannot authenticate."
  artifacts:
    - path: "src/api/server.ts"
      issue: "CORS origin callback rejects same-origin POST when DASHBOARD_ALLOWED_ORIGINS is empty; the inline comment's same-origin=no-Origin assumption is wrong for POST/PUT/DELETE"
    - path: ".env / .env.example / src/config.ts (REQUIRED/OPTIONAL env lists) / docs/operations/going-live.md"
      issue: "DASHBOARD_ALLOWED_ORIGINS is required for the dashboard to function but is undocumented everywhere and unset by default"
  missing:
    - "Document DASHBOARD_ALLOWED_ORIGINS (config.ts env list + .env + going-live.md runbook) as required for dashboard use"
    - "Fix CORS to always allow TRUE same-origin (compare Origin to request Host) so the SPA works without operator allowlist config — or ship a safe default and document it"
  workaround: "Add DASHBOARD_ALLOWED_ORIGINS=http://127.0.0.1:8080,http://localhost:8080 to .env and restart the bot (dotenv loads at startup). Note: npm run pause/resume CLI is unaffected — axios in Node sends no Origin header."
  banner_retest: "pending — once login works, re-verify the actual pause banner (appear/persist/disappear via WS) to close test 2"

- truth: "npm run pause / npm run resume reach the running bot's API server and toggle pause state (OPS-LIVE-11)"
  status: resolved
  reason: "User reported: 'Pause CLI crashed' with empty error (err:'') — AggregateError from a refused TCP connection. CLI dials http://localhost:3000 but the server listens on 127.0.0.1:8080."
  severity: major
  test: 2
  found_during: "test 2 (npm run pause attempt, after the CORS workaround)"
  root_cause: "scripts/pause.ts:49 and scripts/resume.ts:29 default DASHBOARD_URL to 'http://localhost:3000'. The API server binds to DASHBOARD_HOST:DASHBOARD_PORT = 127.0.0.1:8080 (src/api/server.ts:135-136; .env DASHBOARD_PORT=8080). DASHBOARD_URL is unset, so the CLI dials :3000 → ECONNREFUSED → AggregateError (empty .message) → main().catch → 'Pause CLI crashed' exit 2. config.ts:156 documents the default as http://localhost:3000, which itself contradicts the server's documented default of 127.0.0.1:8080."
  artifacts:
    - path: "scripts/pause.ts:49, scripts/resume.ts:29"
      issue: "Default DASHBOARD_URL :3000 does not match server default port :8080 — CLI crashes out of the box"
    - path: "src/config.ts:156"
      issue: "DASHBOARD_URL documented default (localhost:3000) is internally inconsistent with the server default (127.0.0.1:8080)"
  missing:
    - "Make CLI default DASHBOARD_URL match the server (127.0.0.1:8080) or derive it from DASHBOARD_HOST/DASHBOARD_PORT"
    - "Document DASHBOARD_URL in .env + going-live.md; recommend 127.0.0.1 (not localhost) to match the IPv4 bind and avoid ::1 refusal"
    - "pause.ts/resume.ts should report connection errors clearly (the AggregateError surfaced as an empty string — unhelpful for operators)"
  workaround: "Add DASHBOARD_URL=http://127.0.0.1:8080 to .env (no bot restart needed — CLI reads .env per invocation); re-run npm run pause"

- truth: "Pause banner is styled consistently with the dashboard's visual language (the 'visual' half of test 2)"
  status: resolved
  reason: "User reported: 'the paused banner doesn't appear at all like the rest of the dashboard ... it should have some resemblance to the dashboard stylistically'. Functional WS behavior is correct; only the visual treatment clashes."
  severity: cosmetic
  test: 2
  root_cause: "dashboard/src/components/PauseBanner.tsx:69 renders a full-bleed solid-red slab (bg-loss text-white py-3 px-4 mb-4 -mx-4 sm:-mx-6 lg:-mx-8) with sharp corners and no border. The dashboard's design language is contained dark cards: bg-surface-light rounded-lg border border-border p-4 (ChainStatusCard, EventFeed, PnLChart, PositionTable). The banner copies the Phase-19 CircuitBreakerBanner.tsx verbatim, inheriting the same non-card style. Its Resume button (bg-surface-light + text-accent underline) also diverges from the dashboard's solid buttons (bg-accent/bg-loss text-white rounded px-4 py-2 hover:opacity-90)."
  artifacts:
    - path: "dashboard/src/components/PauseBanner.tsx:69-86"
      issue: "Full-bleed bg-loss slab + underlined-text button do not match the dashboard card idiom"
    - path: "dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx:36"
      issue: "Shares the identical full-bleed style — align in the same fix so the two alert banners stay in visual parity"
  missing:
    - "Restyle PauseBanner container to the card idiom while keeping a clear red alarm: bg-surface-light border border-loss border-l-4 rounded-lg p-4 mb-6; icon + heading text-loss; reason text-text-muted; Resume button bg-accent text-white rounded px-4 py-2 text-sm hover:opacity-90 transition-colors. Drop the -mx-* full-bleed so it sits within the p-8 content padding like sibling cards."
    - "Apply the same container treatment to CircuitBreakerBanner.tsx for parity; refresh both header comments + the Layout.tsx full-bleed comment."
  user_intent: "'doesn't have to be perfect' — loose stylistic resemblance is enough; keep it unmistakably a red alert. Lowest priority of the test-2 findings; fix alongside the major CORS + DASHBOARD_URL gaps."

- truth: "Bot refuses to start in an unsafe state — including a default/placeholder dashboard admin key (phase goal: 'refuses to start in any internally-inconsistent or unsafe state')"
  status: resolved
  reason: "User flagged .env:74 DASHBOARD_API_KEY=your-secret-dashboard-api-key-here (the shipped placeholder). The bot starts WITHOUT objection on this known-default admin credential — anyone aware of the default can log into the dashboard and pause/resume/emergency-sell a live-funds bot."
  severity: major
  test: cross-cutting (surfaced during test 2 dashboard login; user highlighted the line repeatedly)
  root_cause: "config.ts:27 marks DASHBOARD_API_KEY required:true but only checks it is SET, not that it differs from the documented placeholder. preflight.ts validates wallet/RPC/MEV/honeypot/anti-rug but has NO check that DASHBOARD_API_KEY != 'your-secret-dashboard-api-key-here'. For a 'going-live ops hardening' phase, a default admin credential is exactly the kind of unsafe startup state the goal says to refuse."
  artifacts:
    - path: "src/preflight.ts / src/config.ts"
      issue: "No startup check rejecting the known placeholder DASHBOARD_API_KEY"
    - path: ".env:74"
      issue: "Ships the literal placeholder 'your-secret-dashboard-api-key-here'"
  missing:
    - "Add a preflight/config FATAL when DASHBOARD_API_KEY equals the known placeholder (or is empty/too short), pointing to docs/operations/going-live.md — consistent with the existing cross-env FATAL rules (MEV_STRATEGY etc.)"
    - "Document in the runbook that a strong random DASHBOARD_API_KEY is required before go-live"
  workaround: "Operator sets DASHBOARD_API_KEY to a strong random string in .env and uses that value for dashboard login + the pause/resume CLI"
