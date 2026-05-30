---
gsd_state_version: 1.0
milestone: v6.17
milestone_name: Defensive Hardening for Live Mainnet
status: milestone_complete
stopped_at: "v6.17 COMPLETE 2026-05-29 (ETH-first) — milestone archived + tagged v6.17. 8 phases (17–21 + 21.1/21.2/21.3), 69 plans, 68/70 requirements satisfied. HONEY-04 (BSC/Base/Arb honeypot deploy) + ANTIRUG-15 (BSC/Base/Arb V3 allowlist) carried forward to next milestone (fail-closed; contractual re-audit when 18-08 ships). Capital-safety blocker INT-NONCE-SELL fixed inline at close (commit daf8f4e). NEXT = /gsd-new-milestone to scope the next milestone. Full pre-close STATE history preserved in git + the milestone archives. orchestrator SOLE writer of STATE/ROADMAP (hand-edited; NO gsd-sdk state.*/roadmap.*/phase.complete — they corrupt this shape)."
last_updated: 2026-05-29T23:30:00.000Z
last_activity: "2026-05-29 — v6.17 milestone closed via /gsd-complete-milestone (ETH-first). Archived ROADMAP + REQUIREMENTS to milestones/v6.17-*; moved v6.17-MILESTONE-AUDIT.md into milestones/; appended MILESTONES.md entry; full PROJECT.md evolution (Current State → v6.17, requirements → Validated, +9 Key Decisions); collapsed ROADMAP to milestone groupings; created RETROSPECTIVE.md; git rm REQUIREMENTS.md; tagged v6.17. Verified the INT-NONCE-SELL fix in code (submitPrivateSell seam at exitEngine.ts:782/909) + git (daf8f4e HEAD, clean tree) before treating the milestone as ready. Hand-edited STATE/ROADMAP (no gsd-sdk — mis-parses this shape)."
progress:
  milestone_status: complete
  phases_shipped: 8        # 17,18(10/11),19,20,21,21.1,21.2,21.3 — hand-maintained; gsd-sdk counters unreliable for this shape
  plans_completed: 69
  requirements_satisfied: 68
  requirements_total: 70
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-29 after the v6.17 milestone)

**Core value:** Reliably detect, validate, and profitably snipe new token listings across multiple EVM chains with proper risk management — never lose money to preventable bugs, race conditions, or security flaws.
**Current focus:** Planning the next milestone. v6.17 shipped ETH-first; the next milestone is not yet scoped.

## Current Position

**Milestone v6.17 (Defensive Hardening for Live Mainnet) — ✅ COMPLETE 2026-05-29 (ETH-first, `ENABLED_CHAINS=eth`).**

Live-proven on Ethereum mainnet — a real-capital roundtrip closed all 6 deferred v6.16 verification items with on-chain artifacts (sell `0xcc7997bb…619bc605`, `amount_out = 993814525259157`). 68/70 requirements satisfied; capital-safety blocker INT-NONCE-SELL fixed inline at close (759/759 unit, tsc ×3 clean, working tree clean).

Archived: `milestones/v6.17-ROADMAP.md`, `milestones/v6.17-REQUIREMENTS.md`, `milestones/v6.17-MILESTONE-AUDIT.md`, `milestones/v6.17-VERIFICATION-EVIDENCE.md`. Tagged `v6.17`.

## Carry-Forward to Next Milestone

- **HONEY-04** — deploy `HoneypotChecker.sol` on BSC/Base/Arbitrum (plan 18-08; redeploy ETH with the 18-REVIEW-FIX Solidity hardening; contractual re-audit trigger when 18-08 ships). Fail-closed today (those chains refuse to boot without a checker address).
- **ANTIRUG-15** — resolve BSC/Base/Arb V3 anti-rug allowlists (ETH resolved). Tied to the same multi-chain rollout.
- Candidates (not committed): CHAIN-05 fully-dynamic capital allocation · DETECT-01 mempool/block-0 sniping · OPS-V2-01 synthetic-monitor canary-trade watchdog.

## Blockers / Concerns

None open. The STOP-THE-LINE-01..06 blockers surfaced during Phase 21 live-capture were all resolved (phases 21.1/21.2/21.3); the milestone-audit INT-NONCE-SELL capital-safety blocker was fixed inline at close.

## Operating Notes (carry to next session)

- **Bot start:** `npx ts-node src/bot.ts`. **Read-only cold-start check:** `npm run preflight` (there is no dry-run boot mode — never boot src/bot.ts to "test"). Stop the bot by force-killing the ts-node PID (npx swallows Ctrl+C on Windows+bash).
- **No branching** — commit phase work straight to master; no worktrees.
- **STATE/ROADMAP are hand-maintained** — orchestrator is the sole writer; do NOT run `gsd-sdk state.*`/`roadmap.*`/`phase.complete` (they corrupt this custom shape). Trust ROADMAP checkboxes/Progress, hand-verify.
- **Green suite caveat** — the unit suite has repeatedly masked capital-safety/money-path bugs on this project by mocking the mechanism under test; rely on real-path integration checks + deep code-review + RED-proven tests for money-path changes.

## Performance Metrics

**v6.17:** 8 phases · 69 plans · 45 days (2026-04-14 → 2026-05-29) · 491 commits · ~170 code files (+45,384 / −661 in src/test/scripts).
**v6.16 (reference):** 16 phases · 55 plans · 26 days · 395 commits. Per-plan detail in `milestones/v6.16-ROADMAP.md`.

---
*Full pre-close v6.17 execution history (phase-by-phase decision log, resolved blockers) is preserved in git history and in the `milestones/v6.17-*` archives. This STATE.md was reset to a clean milestone boundary on 2026-05-29.*
