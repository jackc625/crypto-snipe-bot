---
gsd_state_version: 1.0
milestone: v7.0
milestone_name: Full Audit & Modernization
status: planning
stopped_at: "v7.0 started 2026-11-06 — defining requirements. Scope: full adversarial audit + deep restructure + code quality + bug fixes + all-deps-to-latest + test-suite quality + strict CI gates + dashboard/scripts/hygiene + docs + live ETH roundtrip re-proof. Bot OFF for the whole milestone. Multi-chain (HONEY-04/ANTIRUG-15) deferred to next milestone. orchestrator SOLE writer of STATE/ROADMAP (hand-edited; NO gsd-sdk state.*/roadmap.*/phase.complete — they corrupt this shape)."
last_updated: 2026-11-06T12:00:00.000Z
last_activity: "2026-11-06 — Milestone v7.0 (Full Audit & Modernization) started via /gsd-new-milestone. PROJECT.md Current Milestone written; STATE.md hand-reset (no gsd-sdk state.milestone-switch — mis-parses this shape)."
progress:
  milestone_status: planning
  phases_shipped: 0        # hand-maintained; gsd-sdk counters unreliable for this shape
  plans_completed: 0
  requirements_satisfied: 0
  requirements_total: 0    # set when REQUIREMENTS.md is defined
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-06 at v7.0 milestone start)

**Core value:** Reliably detect, validate, and profitably snipe new token listings across multiple EVM chains with proper risk management — never lose money to preventable bugs, race conditions, or security flaws.
**Current focus:** v7.0 Full Audit & Modernization — defining requirements.

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-11-06 — Milestone v7.0 started

## Milestone Baseline (measured 2026-11-06, cold start after 5 months)

- **Oversized files:** `src/bot.ts` 2,361 · `src/anti-rug/detector.ts` 2,295 · `src/exitEngine.ts` 2,045 · `src/chainRegistry.ts` 1,089 · `src/preflight.ts` 1,011 lines. `src/utils/` holds db / txManager / tokenSafety / mevStrategies / honeypot / safetyProviders.
- **Lint:** `npx eslint src` → 350 errors / 22 warnings (no `lint` script; not in CI). Top rules: no-unsafe-assignment 102, no-unsafe-member-access 78, no-unused-vars 34, no-unsafe-call 33, no-floating-promises 26, no-misused-promises 16.
- **Security:** `npm audit` → 11 prod vulns (1 critical `proxy-addr`; high `axios`, `ws`, `body-parser`, `form-data`, `ip-address`) / 67 total.
- **Outdated majors:** hardhat 2.26→3.x, typescript 5.8→7.x, vitest 4→5, eslint 9→10, chai 4→6, better-sqlite3 12→13, dotenv 17→18, uuid 13→14, @types/node 22→26, @nomicfoundation/* → 3.x/4.x. `ts-node` in use. CI installs with `--legacy-peer-deps`.
- **Tooling gaps:** no formatter; tracked junk (`.DS_Store`, `.idea/`); `package.json` `main: dist/index.js` (nonexistent).
- **CI (`.github/workflows/test.yml`):** unit + integration + `.todo` ban + root-doc ban + `tsc --noEmit` ×3; contracts-gated hardhat-compile / slither / mythril. No lint, format, audit, or coverage gate.
- **Tests:** 131 test files (759 unit + 216 integration + fork at v6.17 close).

## Carry-Forward (deferred past v7.0)

- **HONEY-04** — deploy `HoneypotChecker.sol` on BSC/Base/Arbitrum (plan 18-08; redeploy ETH with the 18-REVIEW-FIX Solidity hardening; contractual re-audit trigger when 18-08 ships). Fail-closed today.
- **ANTIRUG-15** — resolve BSC/Base/Arb V3 anti-rug allowlists (ETH resolved). Tied to HONEY-04.
- Candidates (not committed): CHAIN-05 fully-dynamic capital allocation · DETECT-01 mempool/block-0 sniping · OPS-V2-01 synthetic-monitor canary-trade watchdog.

## Blockers / Concerns

None open.

## Operating Notes (carry to next session)

- **Bot is OFF for all of v7.0** — no live trading until the milestone's fork rehearsal + live roundtrip re-entry gate passes.
- **Bot start:** `npx ts-node src/bot.ts` (entry point may change when `ts-node` is replaced this milestone — update this note). **Read-only cold-start check:** `npm run preflight` (there is no dry-run boot mode — never boot src/bot.ts to "test"). Stop the bot by force-killing the ts-node PID (npx swallows Ctrl+C on Windows+bash).
- **No branching** — commit phase work straight to master; no worktrees.
- **STATE/ROADMAP are hand-maintained** — orchestrator is the sole writer; do NOT run `gsd-sdk state.*`/`roadmap.*`/`phase.complete` (they corrupt this custom shape). Trust ROADMAP checkboxes/Progress, hand-verify.
- **Green suite caveat** — the unit suite has repeatedly masked capital-safety/money-path bugs on this project by mocking the mechanism under test; rely on real-path integration checks + deep code-review + RED-proven tests for money-path changes.
- **Behavior preservation** — v7.0 refactors must not change trading behavior; any behavior change is an explicit, logged operator decision.

## Performance Metrics

**v6.17:** 8 phases · 69 plans · 45 days (2026-04-14 → 2026-05-29) · 491 commits · ~170 code files (+45,384 / −661 in src/test/scripts).
**v6.16 (reference):** 16 phases · 55 plans · 26 days · 395 commits. Per-plan detail in `milestones/v6.16-ROADMAP.md`.

---
*STATE.md hand-reset to the v7.0 milestone start on 2026-11-06. Prior milestone history preserved in git and the `milestones/` archives.*
