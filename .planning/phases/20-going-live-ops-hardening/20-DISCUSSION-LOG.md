# Phase 20: Going-Live Ops Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-24
**Phase:** 20-going-live-ops-hardening
**Areas discussed:** Pause-state model & granularity, Preflight model + wallet-balance threshold, Kill-switch behavior at the 3 checkpoints, Cross-variable env validation scope

---

## Area 1: Pause-state model & granularity (OPS-LIVE-08, 09, 11)

### Q1: Relationship to existing per-chain stop + exit monitors

| Option | Description | Selected |
|--------|-------------|----------|
| Global pause + keep per-chain stop separate | Two orthogonal controls: global pause for emergencies, per-chain stop for chain ops. Exit monitors run under both. | ✓ |
| Per-chain pause replaces in-memory stop | Promote `stoppedChains` to SQLite per-chain pause. Loses single-action emergency halt. | |
| Both: global + per-chain pause, both SQLite | Most flexibility, more operator complexity. | |
| Global pause, also kills exit monitors | Maximally safe in "nothing happens" sense; risks unmanaged positions during pause. | |

**Notes:** Locked D-PAUSE-SHAPE. Pause is "stop opening new positions everywhere"; per-chain stop stays as granular chain-listener control; exit monitors always run.

### Q2: Storage shape

| Option | Description | Selected |
|--------|-------------|----------|
| New table `pause_state` with audit fields | `paused`, `paused_at`, `paused_by`, `reason`. Audit trail for why-paused. | ✓ |
| Existing `bot_state` K/V table, boolean only | Minimum change; no audit fields. | |
| Dedicated table, boolean only, no audit fields | Cleaner than reusing bot_state; loses why-paused signal. | |

**Notes:** Locked D-PAUSE-STORAGE. Single-row table; audit columns are required because post-incident reviews need WHY-paused without log spelunking.

### Q3: Dashboard surface

| Option | Description | Selected |
|--------|-------------|----------|
| Global pause banner in dashboard header | Red banner with paused_at/paused_by/reason + Resume button. | ✓ |
| Embed in existing chain controls panel | Visually grouped; risk operator confuses pause and stop. | |
| CLI-only pause; dashboard read-only display | Forces command-line audit trail; reduces dashboard attack surface. | |

**Notes:** Locked D-PAUSE-UI. High-visibility single control; CLI + dashboard both allowed to toggle.

---

## Area 2: Preflight model + wallet-balance threshold (OPS-LIVE-01..05, 10)

### Q1: Per-chain wallet-balance floor

| Option | Description | Selected |
|--------|-------------|----------|
| snipeAmount × maxOpenPositions + gas buffer | Floor = operational need (~0.008 ETH for current config). Matches real funding. | ✓ |
| maxCapital + gas buffer (REQ-as-written) | Floor = deployment ceiling (~1.05 ETH). FATAL-exits current bot. | |
| Operator-configurable env `<CHAIN>_MIN_WALLET_BALANCE` | Explicit env per chain; one more env to document. | |
| Two thresholds: hard FATAL floor + soft warn ceiling | Tiered signal; more operator overhead. | |

**Notes:** Locked D-BALANCE-FLOOR. REQUIREMENTS.md OPS-LIVE-02 row wording refined ("derived from maxCapital" → "snipeAmount × maxOpenPositions + gas_buffer"). Planner must update REQ during plan-phase.

### Q2: Preflight execution flow

| Option | Description | Selected |
|--------|-------------|----------|
| Collect-all per chain, exit non-zero if any failed | Full picture per restart cycle; operator fixes everything once. | ✓ |
| Pure fail-fast (exit on first FATAL) | Fastest startup; worst operator UX with multiple failures. | |
| Collect-all with partial-pass summary | Same as #1 with explicit summary. | |

**Notes:** Locked D-PREFLIGHT-FLOW. Operator sees ALL failures across ALL chains before exit.

### Q3: Gas buffer source

| Option | Description | Selected |
|--------|-------------|----------|
| Per-chain defaults in chainRegistry + env override | ETH 0.005, BSC 0.003, Base 0.0005, Arb 0.0005; `<CHAIN>_GAS_BUFFER` override. | ✓ |
| Single env var, operator-set, no defaults | Forces explicit operator choice; one more required env. | |
| Single global default (0.005 ETH-equivalent) | Simplest; over/under-shoots on some chains. | |

**Notes:** Locked D-GAS-BUFFER. Per-chain default + env override matches CHAIN_TEMPLATES extension pattern from Phase 18/19.

### Q4: Mid-run wallet re-check action

| Option | Description | Selected |
|--------|-------------|----------|
| Same threshold; halt new buys + Telegram; exit monitors run | Reuses pause mechanism (auto-flips with `paused_by='preflight'`). | ✓ |
| Two thresholds: halt buys + emergency-sell-all if much lower | Aggressive; risks panic-sell at bad prices. | |
| Higher threshold mid-run (preflight × 1.5) | Tighter; more operator overhead. | |

**Notes:** Locked D-MID-RUN-CHECK. Clean intersection with D-PAUSE-SHAPE — mid-run undercut auto-flips the global pause flag.

---

## Area 3: Kill-switch behavior at 3 checkpoints (OPS-LIVE-08)

### Q1: CP3 (post-MEV-submit) semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Still record + start exit monitor; pause only affects NEW pairs | Pause never panic-sells. CP3 is an audit log. | ✓ |
| Record trade but DON'T start exit monitor | Forces manual force-sell; risks unmanaged position. | |
| Record + monitor + immediately trigger urgency-market-sell | Aggressive panic-sell; risks bad price. | |
| Don't record; don't start monitor; lose to natural exit | Position invisible until restart; risky. | |

**Notes:** Locked D-KILLSWITCH-CP3. CP1 + CP2 are real gates; CP3 is an audit-trail diagnostic. Pause never panic-sells in-flight positions.

### Q2: Paused-restart startup behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Start everything; refuse new buys at handleNewPair entry | Dashboard works during pause; exit monitors run. | ✓ |
| Boot preflight + dashboard only; defer chain listeners until resume | Saves RPC; loses event visibility while paused. | |
| Refuse to boot while paused; operator must unpause via CLI first | Safest "really off"; loses dashboard visibility. | |

**Notes:** Locked D-PAUSED-RESTART. Dashboard visibility during pause is operator-essential — they need to see positions and unpause from the UI.

---

## Area 4: Cross-variable env validation scope (OPS-LIVE-07)

### Q1: Anti-rug live-gate code-enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Code-enforced 7-day floor only; FP review stays operator-discipline | Mechanical floor via `chain_state.antirug_dry_run_started`; semantic check stays human. | ✓ |
| Full enforcement: 7-day + operator-acknowledged-zero-FPs file | Belt-and-suspenders; more operator friction. | |
| Operator-discipline only; document, don't enforce | Less code, more risk if operator forgets. | |
| Code-enforced + `--skip-antirug-gate=eth` escape-hatch env | Emergency override; audit-trail preserved. | |

**Notes:** Locked D-ANTIRUG-LIVE-GATE-CODE. Honors Phase 19 D-LIVE-GATE intent without requiring complex acknowledgment-file workflow.

### Q2: Validation home

| Option | Description | Selected |
|--------|-------------|----------|
| All cross-variable rules in `preflight.ts`; per-var stays in config.ts/chainRegistry.ts | Single audit surface for cross-rules; no behavior duplication. | ✓ |
| Extend chainRegistry per-chain inline validation | Follows existing pattern; less central. | |
| Three-file split: preflight.ts (runtime) + validation.ts (env-rules) + config.ts (presence) | Maximum separation; one more module. | |

**Notes:** Locked D-VALIDATION-HOME. preflight.ts owns cross-rules; existing patterns in config.ts (REQUIRED_ENV_VARS) and chainRegistry.ts (per-chain shape) untouched.

---

## Bonus question: Stale-data warning thresholds (OPS-LIVE-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Relax to minutes-scale: 2 min warn / 10 min error | Operationally meaningful; catches real freezes without spam. | ✓ |
| Keep REQUIREMENTS-as-written: 10s warn / 20s error | Strict; floods operator with normal-poll-cycle noise. | |
| Operator-configurable per chain | Defaults match relaxed pick; more env vars. | |
| Scale by chain block-time | Auto-scales; Arb's 0.25s blocks make this break. | |

**Notes:** Locked D-STALE-THRESHOLDS. REQUIREMENTS.md OPS-LIVE-06 row wording refined ("2× / 4× poll interval" → "2 min warn / 10 min error"). Planner must update REQ during plan-phase.

---

## Claude's Discretion

Areas where the user delegated to Claude / the planner:

- Exact `pause_state` schema column types + index choice (within "single-row, audit columns required")
- Mid-run re-check interval default within "every 5 minutes per REQ"
- Specific block-age tolerance per chain within "scale to chain block-time, ~5× as starting point"
- `npm run preflight` JSON-vs-human output format
- `npm run pause` / `npm run resume` CLI argument shape (optional `--reason` flag)
- `preflight.ts` module split (single file vs `preflight/{checks,validation,runner}.ts`)
- CI guard mechanism for OPS-LIVE-12 (workflow rule vs paths-filter vs custom script)
- Whether stale-data warning + Telegram alert is one-shot at startup or periodic during operation
- Schema migration v5→v6 split into one transaction vs two
- Exact pause-state JSON shape exposed by GET /api/pause

## Deferred Ideas (noted for v6.18+ or out of phase scope)

- **Operator-acknowledged-zero-FPs file** for anti-rug live-gate — rejected in favor of D-ANTIRUG-LIVE-GATE-CODE 7-day-floor-only
- **`SKIP_PREFLIGHT=true` emergency-override env** — rejected per D-ROLLBACK
- **Two-threshold mid-run wallet check** (soft warn + hard FATAL) — rejected per D-MID-RUN-CHECK
- **Force-cancel-all-in-flight emergency mode** — rejected per D-KILLSWITCH-CP3 (POST /emergency-sell already covers)
- **Block-age scaling by chain block-time formula** — rejected (Arb's 0.25s breaks formula)
- **Periodic stale-data warning during operation** — planner discretion to ship as quality upgrade
- **Synthetic canary-trade monitor (OPS-V2-01)** — deferred to v6.18+ per REQUIREMENTS
- **Dashboard banner during graceful shutdown (OPS-V2-02)** — deferred to v6.18+ per REQUIREMENTS
- **Pre-flight `--quiet` / `--json` mode for CI** — planner discretion
