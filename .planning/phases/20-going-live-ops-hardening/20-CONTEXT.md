# Phase 20: Going-Live Ops Hardening - Context

**Gathered:** 2026-05-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the bot refuse to start in any internally-inconsistent or unsafe state,
and surface an operator-visible kill-switch + persistent pause state that
survives restart. The phase delivers:

- New `src/preflight.ts` startup-time module that runs BEFORE chain context
  creation, performs per-chain checks (wallet balance, RPC health,
  MEV connectivity, HoneypotChecker `getCode`), and FATAL-exits if any
  chain fails (collect-all per chain, exit non-zero if any chain fails)
- Cross-variable env validation centralized in `preflight.ts`
  (`MEV_STRATEGY=flashbots` ⇔ `FLASHBOTS_AUTH_KEY`, `ENABLED_CHAINS`
  includes `bsc` ⇔ `BLOXROUTE_AUTH_HEADER`, Telegram 5-tuple, anti-rug
  live-gate 7-day floor)
- Multi-stage kill-switch with SQLite-persisted pause in new `pause_state`
  table; pause flag re-checked at 3 points within `handleNewPairForChain`
  (post-safety-bank → abort, post-bundle-build → don't submit,
  post-MEV-submit → log-only audit since bundle is in flight)
- Periodic mid-run wallet balance re-check (every 5 min, default) that
  auto-flips global pause on undercut with `paused_by='preflight'` audit
- Operator-facing CLI scripts (`npm run preflight`, `npm run pause`,
  `npm run resume`) that wrap dashboard endpoints with `DASHBOARD_API_KEY`
- Runbook formalization: `GOING-LIVE.md` (repo root) moved to
  `docs/operations/going-live.md` atomically with root delete; CI guard
  fails build if either `GOING-LIVE.md` OR `HONEYPOT-SIM-BRIEFING.md`
  reappears at the repo root; `HONEYPOT-SIM-BRIEFING.md` DELETED per
  Phase 18 D-BRIEFING-DISPOSITION (OPS-LIVE-13 reduces to "execute the
  delete")
- Stale-data warnings at 2-min warn / 10-min error thresholds for open
  positions whose `last_update_ts` exceeds the floor

**Real capital context** (unchanged from Phase 18/19): bot is funded on
mainnet with ~0.0124 ETH at `ENABLED_CHAINS=eth`; Phase 18 honeypot
rebuild is mid-flight (10/11 plans); Phase 19 anti-rug shipped and
sitting in dry-run pending the 7-day floor + operator FP review per
D-LIVE-GATE. Capital safety > throughput > LOC > clean-code (owner
constraint from Phase 18+19 carried forward).

</domain>

<decisions>
## Implementation Decisions

### Pause-state model (OPS-LIVE-08, 09, 11)

- **D-PAUSE-SHAPE:** Global pause (single SQLite-persisted flag) blocks
  ALL new buys across all chains. Per-chain `/chains/:name/{start,stop}`
  (in-memory `stoppedChains` Set in `src/api/routes/chains.ts`) stays
  unchanged for chain-listener control. Two orthogonal controls: global
  pause for "stop opening new positions everywhere", per-chain stop for
  "stop listening for new pairs on chain X". **Exit monitors run under
  both** — pause never panic-sells.

- **D-PAUSE-STORAGE:** New `pause_state` table with audit columns:
  `paused BOOLEAN NOT NULL DEFAULT 0`, `paused_at TIMESTAMP`,
  `paused_by TEXT` ('dashboard' / 'cli' / 'preflight' / 'manual'),
  `reason TEXT`. Single-row pattern (`id INTEGER PRIMARY KEY CHECK(id=1)`).
  Audit trail is a hard requirement so post-incident reviews don't
  need log spelunking to learn WHY pause fired. Schema migration v5→v6;
  additive only; existing tables unchanged.

- **D-PAUSE-UI:** Dashboard surfaces global pause as a **prominent red
  banner** in the dashboard header when paused: `BOT PAUSED — since
  {paused_at} by {paused_by}. {reason}` with a "Resume" button. Single
  high-visibility control. Per-chain stop indicators remain in the chain
  status panel as today (no visual change). Both dashboard and CLI can
  toggle pause/resume.

- **D-PAUSED-RESTART:** When bot restarts with `pause_state.paused=true`,
  the bot **starts everything**: preflight → chain listeners attached →
  exit monitors resume → dashboard up. Pause is honored at the
  `handleNewPairForChain` first checkpoint — chain listeners fire events
  but no buys happen. Operator sees dashboard, can manage open positions
  and unpause. Boot-time pause never breaks dashboard visibility.

### Preflight pipeline & wallet balance (OPS-LIVE-01..05, 10)

- **D-BALANCE-FLOOR:** Per-chain wallet floor = `snipeAmount ×
  maxOpenPositions + <CHAIN>_GAS_BUFFER`. Examples (default config):
  - ETH: `0.003 × 1 + 0.005 = 0.008 ETH`
  - BSC: `0.05 × 1 + 0.003 = 0.053 BNB`
  - Base: `0.005 × 1 + 0.0005 = 0.0055 ETH`
  - Arb: `0.005 × 1 + 0.0005 = 0.0055 ETH`

  **This refines REQUIREMENTS.md OPS-LIVE-02 as written** ("derived
  from `maxCapital`"). `maxCapital` is the deployment CEILING (~1.0 ETH
  for ETH), not the operational FLOOR. Using `maxCapital` would
  FATAL-exit the current bot (0.0124 ETH < 1.0 ETH) despite it being
  perfectly capable of running one snipe. Planner should update
  REQUIREMENTS.md OPS-LIVE-02 row wording to match this decision
  during plan-phase.

- **D-GAS-BUFFER:** Per-chain defaults in `CHAIN_TEMPLATES`
  (`defaultGasBuffer`): ETH 0.005, BSC 0.003, Base 0.0005, Arb 0.0005
  (native units). Operator override via env: `<CHAIN>_GAS_BUFFER`.
  Same env knob both preflight and mid-run re-check consume.

- **D-PREFLIGHT-FLOW:** Run all checks (wallet/RPC/MEV/checker
  `getCode`) for every chain; **collect all failures across all
  chains, then exit non-zero if any chain failed**. Operator sees a
  full picture per restart cycle instead of a "fix one, restart, hit
  next, restart" treadmill. Per-chain pass/fail summary printed at end.

- **D-MID-RUN-CHECK:** Periodic re-check at default 5-minute interval
  (configurable via env, to be defined during plan-phase) uses the
  SAME `snipeAmount × maxOpenPositions + gas_buffer` floor as the
  preflight. **Action on undercut:** flip the global pause flag with
  `paused_by='preflight'` + `reason='wallet balance below floor:
  {chain} {balance} < {floor}'` audit; Telegram alert; pino fatal log.
  Exit monitors keep running. Operator must refund and resume after
  remediation. This is the clean intersection of D-MID-RUN-CHECK with
  D-PAUSE-SHAPE — no new mechanism, reuses pause.

- **Block-age tolerance (planner discretion within "scale to chain
  block-time"):** suggest defaults ~5× block-time per chain
  (ETH ~60s, BSC ~15s, Base ~10s, Arb ~2s). Tunable via env per chain.

### Kill-switch behavior at 3 checkpoints (OPS-LIVE-08)

- **D-KILLSWITCH-CP1 (post-safety-bank):** Pause flag set → return
  from `handleNewPairForChain` before bundle construction. No
  expensive RPC/MEV work performed. Structured pino log
  `{ op: 'killswitch.cp1', token, reason: 'global-pause' }`.

- **D-KILLSWITCH-CP2 (post-bundle-build, pre-submit):** Pause flag set
  → discard the built bundle, do NOT submit. Return from
  `handleNewPairForChain`. Structured pino log
  `{ op: 'killswitch.cp2', token, reason: 'global-pause' }`.

- **D-KILLSWITCH-CP3 (post-MEV-submit):** Bundle is in flight; the buy
  may have landed or may still be pending. **CP3 is an audit log, NOT
  an abort.** Still record the trade, still start the exit monitor.
  Pause only affects NEW pair handling at CP1/CP2; never panic-sells
  in-flight positions. Structured pino log
  `{ op: 'killswitch.cp3', token, tradeId, reason: 'global-pause-after-submit' }`
  fires when pause flipped between submit and record-trade so the
  audit trail captures the race. Aligns with D-PAUSE-SHAPE (pause
  never panic-sells).

- **Existing dashboard `POST /emergency-sell`** remains the operator
  action for "sell everything now". Pause and emergency-sell are
  distinct: pause = "stop opening new ones", emergency-sell = "close
  every open position immediately". The two together are complete.

### Cross-variable env validation (OPS-LIVE-07)

- **D-VALIDATION-HOME:** `preflight.ts` owns cross-variable rules.
  Individual env presence/types continue to live in `src/config.ts`
  `REQUIRED_ENV_VARS`. Chain-specific shapes continue to live in
  `src/chainRegistry.ts`. Single audit surface for cross-rules in
  `preflight.ts`; no behavior duplicated across modules.

- **Cross-rules to enforce (initial set; planner expands during
  plan-phase):**
  - `MEV_STRATEGY=flashbots` ⇔ `FLASHBOTS_AUTH_KEY` set + non-empty
  - `ENABLED_CHAINS` includes `bsc` ⇔ `BLOXROUTE_AUTH_HEADER` set
  - `TELEGRAM_API_ID` set ⇔ full 5-tuple (`TELEGRAM_API_HASH`,
    `TELEGRAM_SESSION`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)
    all set
  - `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` ⇔ 7-day dry-run floor passed
    per **D-ANTIRUG-LIVE-GATE-CODE** below
  - Per-chain `<CHAIN>_RPC_URL` set if chain in `ENABLED_CHAINS`
  - Per-chain `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` set OR
    `defaultHoneypotCheckerAddress` literal present in
    `CHAIN_TEMPLATES`
  - Planner free to add discovered rules during research-phase

- **D-ANTIRUG-LIVE-GATE-CODE:** Code-enforced 7-day floor only; FP
  review stays operator-discipline. Implementation: new column
  `antirug_dry_run_started TIMESTAMP` in existing `chain_state` table
  (schema migration v5→v6 atomic with `pause_state` add per
  D-PAUSE-STORAGE). The anti-rug detector records this timestamp
  on first-time start per chain. Preflight enforces:
  `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` requires `(now -
  chain_state.antirug_dry_run_started) >= 7 days` for that chain.
  FATAL non-zero exit if floor not met; error message points to
  `docs/operations/anti-rug-rollout.md` for the operator review
  protocol. **FP review (0 confirmed FPs)** stays operator-judgment
  per Phase 19 D-LIVE-GATE — no code-level enforcement, documented
  in the rollout doc.

### Stale-data warnings (OPS-LIVE-06)

- **D-STALE-THRESHOLDS:** Relax REQUIREMENTS.md OPS-LIVE-06 from
  "2× / 4× poll interval" (10s/20s) to operationally-meaningful
  **2 min warn / 10 min error**. A position whose last_update_ts is
  20s old is normal poll-cycle traffic, not stale. 2-min warn / 10-min
  error catches real freezes (RPC down, exit engine wedged, partial-
  sell deadlock) without flooding operator with normal-gap noise.
  Planner should update REQUIREMENTS.md OPS-LIVE-06 row wording to
  match this decision during plan-phase. Optional env override
  (`STALE_WARN_SEC` / `STALE_ERROR_SEC`) — planner discretion to ship.

### Briefing / runbook disposition (OPS-LIVE-12, 13)

- **D-BRIEFING-DELETE (inherited from Phase 18 D-BRIEFING-DISPOSITION):**
  `HONEYPOT-SIM-BRIEFING.md` at the repo root is **DELETED** at
  OPS-LIVE-13. Decision was already made in Phase 18 CONTEXT — Phase 20
  executes the delete. No move to `docs/decisions/` (the briefing's
  value was pre-implementation rationale; once HONEY-01..12 ship in
  Phase 18, the rationale lives in 18-CONTEXT.md and
  `.planning/research/SUMMARY.md`).

- **D-RUNBOOK-MOVE:** `GOING-LIVE.md` (repo root, 251 lines) is moved
  to `docs/operations/going-live.md` **atomically in a single commit**
  with the root-file delete. README.md updated to link the new path.
  CI guard added that fails the build if EITHER `GOING-LIVE.md` OR
  `HONEYPOT-SIM-BRIEFING.md` reappears at the repo root. Planner
  decides whether content is updated as part of the move or move-first-
  then-update (move-first preferred to keep audit trail clean per
  D-AUDIT-TRAIL pattern from Phase 18).

### Carried-forward conventions (inherited from Phase 17/18/19)

- **D-ENV-EXAMPLE** [USER-BINDING, inherited from Phase 19]: every new
  env var introduced in Phase 20 lands in `.env.example` with default
  value + 1-line description. New envs include `<CHAIN>_GAS_BUFFER`,
  optional `<CHAIN>_BLOCK_AGE_TOLERANCE_SEC`, optional
  `<CHAIN>_MID_RUN_CHECK_INTERVAL_SEC`, optional `STALE_WARN_SEC` /
  `STALE_ERROR_SEC`. Verify gate at phase close.

- **D-OPERATOR-HANDOFF** [USER-BINDING, inherited from Phase 19]:
  Phase 20 is itself the "operator handoff" phase — `docs/operations/
  going-live.md` IS the operator handoff doc. At phase close it MUST
  document: (a) preflight failure modes + remediation, (b) pause/
  resume CLI usage, (c) mid-run wallet undercut behavior + recovery,
  (d) anti-rug live-gate flip procedure (cross-link to Phase 19's
  `anti-rug-rollout.md`), (e) RPC/MEV/checker validation troubleshooting.

- **D-STOP-THE-LINE** [Phase 17 D-07 → 18 → 19 carry-forward]: any
  preflight discovery revealing a production bug (e.g., a chain
  config that's been silently broken because preflight wasn't catching
  it) BLOCKS Phase 20 close. Fix-in-flight and file-and-defer are
  explicitly rejected. Treated as a first-class requirement upgrade
  (OPS-LIVE-14+ or decimal phase 20.1).

- **D-ROLLBACK** [Phase 18 carry-forward]: no legacy fallback flags.
  Preflight is always-on; there is no `SKIP_PREFLIGHT=true` env
  escape hatch. If preflight is buggy, operator git-reverts the
  preflight commit; no in-code bypass remains.

- **D-ALERTS** [Phase 18 D-ALERTS]: structured pino + Telegram alerts
  for every FATAL preflight failure with: chain name, failed check,
  specific reason, remediation pointer to `docs/operations/going-live.md`.
  Format mirrors Phase 18 SKIP alert shape (terse 1-line, full
  evidence in pino).

- **D-04 observable-effect rigor** [Phase 17]: every new preflight
  check test asserts a concrete observable effect (process.exit code,
  pino log line, SQLite row written, Telegram alert sent) — no
  `expect(true).toBe(true)` hollow fills.

### Claude's Discretion

- Exact `pause_state` schema column types + index choice — planner
  discretion within "single-row pattern, audit columns required".
- Specific mid-run re-check interval default within "every 5 minutes
  per REQUIREMENTS-as-written" — planner discretion if a different
  default makes more sense.
- Specific block-age tolerance per chain — planner discretion within
  "scale to chain block-time, ~5× as starting point".
- `npm run preflight` JSON-vs-human output format — planner discretion;
  human-readable preferred for operator UX, machine-readable optional
  via `--json` flag.
- `npm run pause` / `npm run resume` CLI argument shape (optional
  `--reason` flag etc.) — planner discretion within "wraps dashboard
  endpoint, uses `DASHBOARD_API_KEY` from .env".
- `preflight.ts` module split (single file vs `preflight/{checks,
  validation,runner}.ts`) — planner discretion within "all cross-var
  rules under one module".
- CI guard mechanism for OPS-LIVE-12 (workflow rule vs
  `dorny/paths-filter@v3` rule vs custom script) — planner discretion;
  same toolchain as Phase 18's contracts-path-filter pattern preferred.
- Whether stale-data warning + Telegram alert is a one-shot at startup
  or also a periodic check during operation — planner discretion;
  startup-only is the REQ-as-written minimum, periodic is a quality
  upgrade.
- Schema migration v5→v6 split into one transaction (pause_state +
  antirug_dry_run_started column) vs two migrations — planner
  discretion within "additive only, existing tables unchanged".
- Exact pause-state JSON shape exposed by GET /api/pause (the
  dashboard read path) — planner discretion.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v6.17 milestone source-of-truth

- `.planning/PROJECT.md` — v6.17 milestone scope; "Current State"
  section; owner non-negotiables ("real capital", "capital safety
  first").
- `.planning/REQUIREMENTS.md` OPS-LIVE-01..OPS-LIVE-13 — full
  requirement IDs and acceptance criteria. Planner should also update
  OPS-LIVE-02 + OPS-LIVE-06 row wording during plan-phase per
  D-BALANCE-FLOOR + D-STALE-THRESHOLDS refinements.
- `.planning/ROADMAP.md` §"Phase 20: Going-Live Ops Hardening" —
  goal, depends-on (Phase 18 for HoneypotChecker `deployedAddress`),
  5 success criteria.
- `.planning/STATE.md` — milestone status, recent activity, open
  decisions for plan-phase.

### Phase 18 + 19 carry-forward (conventions established earlier in v6.17)

- `.planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md` —
  D-LIVE-GATE (7-day floor + 0-FP review gate that D-ANTIRUG-LIVE-GATE-CODE
  partially code-enforces), D-ENV-EXAMPLE [USER-BINDING], D-OPERATOR-
  HANDOFF [USER-BINDING], D-STOP-THE-LINE, D-LIST-VERIFY pattern
  (`getCode()` startup check → reused for OPS-LIVE-05 HoneypotChecker
  code-at-address check).
- `.planning/phases/19-anti-rug-runtime-monitoring/19-08-PLAN.md` —
  `docs/operations/anti-rug-rollout.md` + `anti-rug-tuning.md`
  authoring pattern; `docs/operations/going-live.md` follows the same
  shape and structure.
- `.planning/phases/18-honeypot-detection-rebuild/18-CONTEXT.md` —
  D-BRIEFING-DISPOSITION (`HONEYPOT-SIM-BRIEFING.md` deletion
  decision; Phase 20 executes), D-ALERTS tiered Telegram format,
  D-ROLLBACK no-legacy-flag posture, D-STOP-THE-LINE convention,
  D-DEPLOY-KEY capability separation.
- `.planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md`
  — D-04 observable-effect rigor (every new test asserts concrete
  effect), D-07 stop-the-line, D-08/09 CI guards as evergreen
  invariants (Phase 20 extends with the GOING-LIVE.md /
  HONEYPOT-SIM-BRIEFING.md root-reappearance guard).

### Operator-facing docs (read for context; Phase 20 produces / updates these)

- `GOING-LIVE.md` (repo root, 251 lines) — current runbook; MOVED to
  `docs/operations/going-live.md` in Phase 20 per D-RUNBOOK-MOVE.
- `HONEYPOT-SIM-BRIEFING.md` (repo root, 139 lines) — DELETED in
  Phase 20 per D-BRIEFING-DELETE.
- `docs/operations/anti-rug-rollout.md` (Phase 19 Plan 19-08) —
  cross-linked from `going-live.md` for anti-rug live-flip procedure
  per D-OPERATOR-HANDOFF.
- `docs/operations/anti-rug-tuning.md` (Phase 19 Plan 19-08) —
  cross-linked from `going-live.md` for threshold-tuning protocol.

### Code modification + new-artifact targets

- `src/preflight.ts` — **NEW**. Single-module owner of cross-variable
  env validation + preflight checks. Called from `startMultiChainBot`
  in `src/bot.ts` BEFORE chain context creation.
- `src/utils/db.ts` — **MODIFY**. Schema migration v5→v6: adds
  `pause_state` table (single-row, `paused`/`paused_at`/`paused_by`/
  `reason` columns); adds `antirug_dry_run_started TIMESTAMP` column
  to existing `chain_state` table. New prepared statements
  (`getPauseState`, `setPauseState`, `clearPauseState`,
  `setAntirugDryRunStarted`, `getAntirugDryRunStarted`).
- `src/api/routes/controls.ts` — **MODIFY**. Add `POST /api/pause`
  and `POST /api/resume` endpoints alongside existing `force-sell` /
  `emergency-sell` routes. Auth via `DASHBOARD_API_KEY` middleware
  (existing pattern).
- `src/api/routes/health.ts` or new endpoint — **MODIFY/NEW**. Add
  `GET /api/pause` for dashboard banner state read.
- `src/bot.ts` — **MODIFY**. (a) Call `preflight()` first thing in
  `startMultiChainBot` (line ~876). (b) Add 3 pause-flag re-checks
  inside `handleNewPairForChain` per D-KILLSWITCH-CP1/CP2/CP3
  (post-safety-bank ~line 344, post-bundle-build pre-submit ~line 365,
  post-MEV-submit ~line 380 audit-log-only). (c) Anti-rug detector
  startup records `chain_state.antirug_dry_run_started` if NULL per
  D-ANTIRUG-LIVE-GATE-CODE.
- `src/chainRegistry.ts` — **MODIFY**. Add per-chain
  `defaultGasBuffer` field to `CHAIN_TEMPLATES`; expose
  `<CHAIN>_GAS_BUFFER` env override. Add per-chain
  `defaultBlockAgeToleranceSec` if planner ships block-age check.
- `src/config.ts` `REQUIRED_ENV_VARS` — **MODIFY**. Register new
  envs: `<CHAIN>_GAS_BUFFER`, optional
  `<CHAIN>_BLOCK_AGE_TOLERANCE_SEC`, optional
  `<CHAIN>_MID_RUN_CHECK_INTERVAL_SEC`, optional `STALE_WARN_SEC`,
  optional `STALE_ERROR_SEC`. All optional with documented defaults.
- `package.json` `scripts` — **MODIFY**. Add `"preflight":
  "ts-node scripts/preflight.ts"`, `"pause": "ts-node scripts/pause.ts"`,
  `"resume": "ts-node scripts/resume.ts"`.
- `scripts/preflight.ts` — **NEW**. Standalone wrapper that invokes
  `preflight()` from `src/preflight.ts` without starting the bot;
  exits non-zero on FATAL.
- `scripts/pause.ts` — **NEW**. Reads `DASHBOARD_API_KEY` from `.env`;
  POSTs to dashboard `/api/pause` with optional `--reason` flag.
- `scripts/resume.ts` — **NEW**. Reads `DASHBOARD_API_KEY` from `.env`;
  POSTs to dashboard `/api/resume`.
- `dashboard/src/` — **MODIFY**. New global pause banner in dashboard
  header showing `BOT PAUSED — since {paused_at} by {paused_by}.
  {reason}` with Resume button. Per D-PAUSE-UI; planner decides
  component file structure.
- `docs/operations/going-live.md` — **NEW** (moved from root).
  Content per D-OPERATOR-HANDOFF: preflight failure modes +
  remediation, pause/resume CLI usage, mid-run wallet undercut
  recovery, anti-rug live-gate flip cross-link, validation
  troubleshooting.
- `README.md` — **MODIFY**. Update link from `./GOING-LIVE.md` to
  `./docs/operations/going-live.md`.
- `.github/workflows/test.yml` — **MODIFY**. Add CI guard: fail
  build if `GOING-LIVE.md` OR `HONEYPOT-SIM-BRIEFING.md` reappears
  at repo root. Same pattern as Phase 17's `.todo` ban + Phase 18's
  `contracts/**` paths-filter.
- `.env.example` — **MODIFY** [USER-BINDING]. All new env vars with
  inline comments + default values per D-ENV-EXAMPLE.

### Test infrastructure context

- `vitest.config.ts` — existing projects: unit / integration / fork.
  Phase 20 tests file into appropriate project; no new project
  needed.
- `package.json` scripts — `test:unit` / `test:integration` /
  `test:fork` / `test:all` already wired. Preflight tests under
  `test/unit/preflight/`; pause-flow tests under
  `test/integration/pauseFlow.test.ts`; kill-switch checkpoint tests
  alongside existing `bot.ts` integration tests.
- `.github/workflows/test.yml` — Phase 17 evergreen CI guards
  (`.todo` ban + `tsc --noEmit ×3`) + Phase 18 contract gates
  preserved. Phase 20 adds: root-file-reappearance guard per
  D-RUNBOOK-MOVE.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/api/routes/chains.ts` `stoppedChains: Set<string>`** —
  in-memory per-chain stop control owned by `server.ts`. **Untouched
  by Phase 20**; coexists with the new global pause per D-PAUSE-SHAPE.
  The `/chains/:name/stop` and `/start` endpoints stay as the
  granular chain-listener control.
- **`src/api/routes/controls.ts` existing `force-sell` /
  `emergency-sell` endpoints** — alongside-extension target for
  `pause` / `resume` endpoints. Same auth middleware
  (`DASHBOARD_API_KEY`), same response shape conventions.
- **`src/config.ts` `REQUIRED_ENV_VARS` + `validateEnvVars()`** —
  existing per-variable validation; Phase 20 KEEPS this and ADDS
  cross-variable validation in `preflight.ts`. No duplication of
  responsibility.
- **`src/chainRegistry.ts` `CHAIN_TEMPLATES`** — per-chain field
  extension pattern (Phase 18 added `honeypotChecker`, Phase 19 added
  `antiRug`). Phase 20 adds `defaultGasBuffer` and optionally
  `defaultBlockAgeToleranceSec`. Same conditional-merge pattern.
- **`src/bot.ts` `startMultiChainBot` (line 874-)** — chainId
  validation at line 886-895 already exists per "Pitfall 4". Phase 20
  refactors: existing chainId check moves into `preflight.ts` as one
  of the per-chain checks; `startMultiChainBot` calls `preflight()`
  first; chain context loop runs only if preflight passed for all
  enabled chains.
- **`src/bot.ts` existing periodic MEV health check (line 917-926)**
  — every-5-min `setInterval`. Phase 20's mid-run wallet balance
  re-check follows the same pattern (own `setInterval` or co-located).
  Reuses `sendCtxAlert` for Telegram + structured pino for logs.
- **`src/utils/db.ts` schema migration framework (lines 27-123)** —
  v5→v6 migration adds `pause_state` table + `antirug_dry_run_started`
  column. Verified pattern from prior Phase 3 / 14 / 18 / 19
  migrations.
- **`src/api/middleware/auth.ts`** — `DASHBOARD_API_KEY`-based auth
  already wired. Phase 20 `pause`/`resume` endpoints reuse the same
  middleware; CLI scripts (`scripts/pause.ts`, `scripts/resume.ts`)
  read the same env var.
- **`sendCtxAlert` + structured pino logging** — already used across
  `bot.ts` and `exitEngine.ts` for Telegram + log emission. D-ALERTS
  preflight alerts extend the existing format; no new infrastructure.

### Established Patterns

- **FATAL non-zero exit with pino fatal log + remediation pointer**
  — pattern from Phase 18 `chainRegistry.ts` (no-deployed-address
  case), Phase 19 `verifyAllowlistAtStartup` (`getCode()` EOA case).
  Preflight inherits this for every FATAL.
- **Per-chain env-overridable thresholds** — Phase 18
  `<CHAIN>_MAX_BUY_TAX_BPS` pattern. Phase 20 reuses for
  `<CHAIN>_GAS_BUFFER` etc.
- **Schema migration additive-only** — every prior migration
  (`schema_version` 1→5) added tables or columns; never modified or
  dropped existing ones. v5→v6 follows the same rule.
- **In-place wiring at well-defined `bot.ts` line ranges** — Phase
  18/19 pattern of "modify at line N for X, line M for Y" preserved.
  Phase 20 modifies `startMultiChainBot` once (preflight call) and
  `handleNewPairForChain` at 3 checkpoints.
- **CI invariants as evergreen guards** — Phase 17 `.todo` ban
  pattern; Phase 18 `contracts/**` paths filter. Phase 20 root-file-
  reappearance guard follows the same family.
- **Docs subdirectory structure** — `docs/operations/` already
  contains `anti-rug-rollout.md` and `anti-rug-tuning.md` (Phase 19).
  Phase 20 adds `going-live.md` alongside, naturally extending the
  pattern.

### Integration Points

- **`src/bot.ts:874-895` (`startMultiChainBot` startup)** — Phase 20
  inserts `await preflight(registry)` between line 879
  (`buildChainRegistry()`) and the chain context loop at line 882.
  Preflight returns void on success or calls `process.exit(1)` on
  FATAL. Existing per-chain chainId validation moves into preflight.
- **`src/bot.ts` `handleNewPairForChain`** — 3 pause-flag re-checks
  per D-KILLSWITCH-CP1/CP2/CP3:
  - CP1 post-safety-bank check (after `mutableResult` collection at
    ~line 290-298, before bundle construction at ~line 348-352)
  - CP2 post-bundle-build pre-submit (after `getAmountsOut` + minOut
    calc at ~line 354-362, before `sendTxWithRetry` call at ~line
    365)
  - CP3 post-MEV-submit audit-log (after `sendTxWithRetry` returns at
    ~line 377, before `recordSnipe` + `insertTrade.run` at ~line
    379-396)
- **`src/api/routes/controls.ts`** — new `POST /pause` and
  `POST /resume` routes. Read auth from `DASHBOARD_API_KEY` middleware.
  Write to `pause_state` via new prepared statements in `db.ts`.
  Broadcast `pause_state_change` event over existing WS hub for
  dashboard live update.
- **`src/anti-rug/detector.ts` `startChainAntiRugListener`** — when
  first-time-started per chain, record
  `chain_state.antirug_dry_run_started = NOW()` via new prepared
  statement. Idempotent (only writes if column is NULL). Provides
  the timestamp preflight's D-ANTIRUG-LIVE-GATE-CODE consumes.
- **Dashboard `dashboard/src/`** — new global pause banner in header
  + Resume button per D-PAUSE-UI. WS-driven live update; reads
  initial state via `GET /api/pause`.
- **`scripts/preflight.ts`** — imports `preflight()` from
  `src/preflight.ts`; invokes without starting bot. Wraps in
  try/catch + exits with `process.exit(0)` on pass / `process.exit(1)`
  on any fail. Allows operator to run from a fresh terminal before
  manual boot per OPS-LIVE-10.
- **`scripts/pause.ts` + `scripts/resume.ts`** — small ts-node
  wrappers using `axios` (already a dep). Read
  `DASHBOARD_API_KEY` from `.env` via dotenv. POST to dashboard
  endpoints. Print response to stdout. Exit 0 on success / 1 on
  HTTP error. Operator-friendly alternative to curl.
- **`.github/workflows/test.yml`** — new CI guard step that runs
  early in every workflow trigger: `test -e GOING-LIVE.md || test -e
  HONEYPOT-SIM-BRIEFING.md` failure → exit 1 with message pointing
  to `docs/operations/`. Same pattern as Phase 17's `.todo` ban.

</code_context>

<specifics>
## Specific Ideas

- **Owner's binding constraint (carry-forward from Phase 18+19):** "If
  it is better and safer, then we take that option. This is real
  capital being traded." Every D-* above is graded against capital
  safety first, throughput / LOC / clean-code second. Phase 20
  specifically refuses to start the bot in any inconsistent state —
  the bot trades real money in exchange for accepting "operator must
  refund + restart" cost in undercut scenarios.

- **D-PAUSE-SHAPE is non-negotiable** — global pause is a single
  user-visible high-level emergency control; per-chain stop exists
  as a finer-grained operations tool. Operator wants both. Pause
  never panic-sells (D-KILLSWITCH-CP3) so an accidental pause does
  not cost money on existing positions.

- **Balance-floor refinement is critical** — REQUIREMENTS.md OPS-LIVE-02
  as literal-written would FATAL-exit the bot at its current ~0.0124
  ETH funding because `maxCapital=1.0`. The bot is supposed to be
  ALIVE at this funding level (running one snipe is fine). The
  refinement to `snipeAmount × maxOpenPositions + gas_buffer` makes
  the bot operational at the real funding level. Planner must update
  REQUIREMENTS.md OPS-LIVE-02 row wording during plan-phase.

- **Stale-data threshold refinement is critical** — REQUIREMENTS.md
  OPS-LIVE-06 as literal-written (10s warn / 20s error) would flood
  the operator with normal-poll-cycle noise. 2 min / 10 min catches
  real freezes without spam. Planner must update REQUIREMENTS.md
  OPS-LIVE-06 row wording during plan-phase.

- **Anti-rug live-gate is split intentionally** — code-enforce the
  7-day floor (a mechanical timestamp check), keep FP review as
  operator judgment (no way to mechanically verify "0 confirmed
  FPs"). The split honors Phase 19 D-LIVE-GATE's intent (both gates
  must pass) without requiring a complex acknowledgment-file workflow.

- **OPS-LIVE-13 is a single-line execution** — Phase 18 already
  closed the disposition discussion (DELETE). Phase 20 just deletes
  the file alongside the GOING-LIVE.md move. Both root-file
  removals happen in the same commit per D-RUNBOOK-MOVE; CI guard
  ensures neither can be re-introduced.

</specifics>

<deferred>
## Deferred Ideas

- **Operator-acknowledged-zero-FPs file as belt-and-suspenders** for
  `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` — discussed and deferred in
  favor of D-ANTIRUG-LIVE-GATE-CODE 7-day-floor-only enforcement.
  Adding `.antirug-live-confirmed-{chain}` file requirement would
  add operator friction without mechanical guarantee (operator can
  always create the file without doing the review). Trust the
  operator + 7-day timer; revisit if Phase 19 live-mode reveals
  high FP rate suggesting code enforcement is needed.

- **`SKIP_PREFLIGHT=true` emergency-override env** — discussed and
  rejected per D-ROLLBACK posture. If preflight is buggy, operator
  git-reverts the preflight commit. No in-code bypass that could
  mask genuine config problems.

- **Two-threshold mid-run wallet check (soft warn + hard FATAL)** —
  discussed and rejected in favor of single-threshold pause-flip
  per D-MID-RUN-CHECK. Aligns with the "halt new buys, keep exit
  monitors running" semantic and reuses the pause mechanism cleanly.
  Two thresholds added complexity without clear operational benefit.

- **Force-cancel-all-in-flight as an emergency mode** — discussed
  and rejected per D-KILLSWITCH-CP3. The existing `POST /emergency-
  sell` endpoint already provides "sell every open position now";
  no separate "cancel in-flight buys" action needed (the
  pause-at-CP1/CP2 prevents new ones from starting, and CP3-and-
  beyond positions are recorded normally then managed by exit
  engine + emergency-sell).

- **Block-age-tolerance scaling by chain block-time formula** —
  considered as auto-derived; rejected for Arb (0.25s block-time ×
  5 = 1.25s which is too tight). Per-chain default in
  CHAIN_TEMPLATES + env override is the cleaner approach.

- **Periodic stale-data warning during operation** (vs startup-only)
  — planner discretion; REQ-as-written is startup-only minimum. May
  emerge during plan-phase as a quality upgrade if there's a clean
  hook point. If shipped, reuses `STALE_WARN_SEC` / `STALE_ERROR_SEC`
  envs.

- **Synthetic canary-trade monitor (OPS-V2-01)** — strongest
  mitigation against telemetry-masks-issue. Deferred to v6.18+ per
  REQUIREMENTS.md v2-requirements section (already noted in Phase
  19 deferred). Phase 20's preflight catches static config issues;
  canary catches runtime drift. Defer until Phase 18/19/20 stack
  proven safe.

- **Dashboard banner during graceful shutdown (OPS-V2-02)** —
  v6.18+ UX polish per REQUIREMENTS.md v2.

- **Pre-flight `--quiet` mode for CI usage** — operator hand-tuning
  may want JSON output for parsing. Planner discretion to ship
  during plan-phase or defer.

</deferred>

---

*Phase: 20-going-live-ops-hardening*
*Context gathered: 2026-05-24*
