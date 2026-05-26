---
phase: 21-exit-engine-live-runtime-hardening
plan: 05
subsystem: docs-requirements-reconciliation
tags: [requirements-reword, doc-vs-runtime, honeypot-gate, going-live-runbook, exit-live]
requires:
  - "Phase 18 (HONEY-07/08 V2+V3 gates live in bot.ts) — corroborated against code this plan"
  - "Phase 20 (going-live.md numbered-section + preflight + mid-run-undercut surface)"
  - "21-CONTEXT.md locked decisions (D-CAPTURE-METHOD, D-EXIT-TRIGGER, D-NO-TOPUP, D-FORK-REHEARSAL, D-OP-CONVENTION, D-CAPTURE-WALLET, D-EVIDENCE-BAR)"
  - "21-RESEARCH.md OQ#5 (PRAGMA user_version), OQ#9 (HONEY-07/08 doc-lag), Pitfall 7 (EXIT-LIVE-06 WS-listener)"
provides:
  - "Authoritative reworded EXIT-LIVE-01/06/07 acceptance text (dotted op; PRAGMA user_version; WS-listener warning) for downstream Phase 21 plans"
  - "EXIT-LIVE-10 dotted-op examples (consistency fix) for the op-enrichment plan"
  - "HONEY-07/08 reconciled to Complete with verified bot.ts:253/566 runtime evidence (doc agrees with runtime before any real-money capture)"
  - "docs/operations/going-live.md section 10 live-capture runbook (operator procedure for Plan 07 real-capital capture)"
affects:
  - ".planning/REQUIREMENTS.md"
  - "docs/operations/going-live.md"
tech-stack:
  added: []
  patterns:
    - "REQUIREMENTS reword-during-plan-phase (same pattern Phase 20 used for OPS-LIVE-02/06)"
    - "going-live.md procedure appendix sub-structure (Pre-requisites / Action / Related docs), mirrored from the Anti-rug live-gate flip procedure"
key-files:
  created:
    - ".planning/phases/21-exit-engine-live-runtime-hardening/21-05-SUMMARY.md"
  modified:
    - ".planning/REQUIREMENTS.md"
    - "docs/operations/going-live.md"
decisions:
  - "HONEY-07/08 flipped to Complete ONLY after corroborating the runtime gates against actual code (grep + read of src/bot.ts and src/utils/honeypot/index.ts) — not on faith per the RESEARCH claim"
  - "EXIT-LIVE-10 hyphenated op examples reworded to dotted (Rule 2 consistency fix) so the op-enrichment plan inherits one authoritative convention, not two contradictory ones"
metrics:
  duration_min: 6
  completed_date: 2026-05-26
  tasks: 2
  files_changed: 2
  commits: 2
---

# Phase 21 Plan 05: EXIT-LIVE/HONEY Doc Reconciliation + Live-Capture Runbook Summary

Reworded three EXIT-LIVE requirement-text anomalies (plus a fourth for consistency) and reconciled the stale HONEY-07/08 traceability to Complete — after **verifying the honeypot gates are actually live in code** — then added an operator live-capture runbook to `docs/operations/going-live.md` that honors the locked Phase 21 capture decisions. Docs-only; no production (`src/`) code touched.

## What Was Built

**Task 1 (`f006acc`) — REQUIREMENTS.md rewords + HONEY-07/08 reconciliation.**
- Reworded EXIT-LIVE-01, EXIT-LIVE-06, EXIT-LIVE-07 to match runtime reality.
- Reworded EXIT-LIVE-10 (un-tasked but necessary consistency fix — see Deviations).
- Flipped HONEY-07 and HONEY-08 checkboxes `[ ]`→`[x]` with verified runtime evidence; flipped their traceability rows Pending→Complete.
- Left HONEY-04 untouched (BSC/Base/Arb deploy genuinely Pending, out of Phase 21 scope).

**Task 2 (`cd75e8c`) — going-live.md `## 10. Live-capture session (EXIT-LIVE-03/04/05)`.**
- New numbered section between §9 Kill switch and `## Adding chains`, with `### Pre-requisites` / `### Action` / `### Related docs` sub-structure mirroring the existing Anti-rug live-gate flip procedure appendix.

## Exact Rewords Applied (before → after)

### EXIT-LIVE-01 (op example → dotted, D-OP-CONVENTION)
- **Before:** Field schema: `{ op: 'exit-poll-cycle', positions: N, durationMs: M, budgetMs: 5000, overruns: ... }`.
- **After:** Field schema: `{ op: 'exit.poll.cycle', positions: N, durationMs: M, budgetMs: 5000, overruns: ... }` — dotted `op` per Phase 21 D-OP-CONVENTION (matches the codebase's `antirug.*` / `killswitch.cp*` style; reworded from the original hyphenated example per RESEARCH "Deprecated").
- The literal hyphenated `exit-poll-cycle` string was removed entirely so the acceptance criterion "no longer contains the hyphenated `exit-poll-cycle`" holds (`grep -c exit-poll-cycle` = 0).

### EXIT-LIVE-06 (chain-restart warning → WS-listener/anti-rug event, RESEARCH Pitfall 7)
- **Before:** "…showing the warning fires on a real RPC drop (induced or naturally observed)."
- **After:** kept the induced-or-naturally-observed RPC-drop wording, and clarified the warning is the **WebSocket-listener reconnect** event (`bot.ts` ~line 859: `'WebSocket disconnected for <dex>, reconnecting...'` / `'WebSocket reconnected...'`) and/or the richer **anti-rug WS-health** op (`antirug.ws.disconnected` in `src/anti-rug/detector.ts`) — **NOT** an exit-poll-loop event. Reason documented inline: the exit poll uses `ctx.httpProvider`, so a WS drop does not stop exits (ethers v6 `WebSocketProvider` does not auto-reconnect; the bot's manual reconnect path emits the warning).

### EXIT-LIVE-07 (schema_version → PRAGMA user_version, RESEARCH OQ#5)
- **Before:** "…plus DB schema check confirming `schema_version` rows."
- **After:** "…plus DB schema check confirming `PRAGMA user_version = 6`" — schema versioning is the integer `PRAGMA user_version`, there is no dedicated version-rows table, `CURRENT_SCHEMA_VERSION = 6` in `src/utils/db.ts`. Kept the `.bot-state.json` migration-log portion (the boot artifact = `'Created … (schema version N)'` lines + `'Migrated .bot-state.json to SQLite'` + a `PRAGMA user_version` query result).
- The literal `schema_version` string was removed entirely (`grep -c schema_version` = 0 in REQUIREMENTS.md).

### EXIT-LIVE-10 (op examples → dotted; consistency Rule 2 — see Deviations)
- **Before:** "(e.g., `op: 'exit-poll-cycle'`, `op: 'partial-sell-trigger'`, `op: 'flashbots-submit'`)."
- **After:** "(e.g., `op: 'exit.poll.cycle'`, `op: 'exit.partial.executed'`, `op: 'exit.flashbots.submitted'`). Enables `op:exit.*` filtered log queries…" — mapped to the dotted taxonomy from RESEARCH OQ#2.

## HONEY-07/08 Evidence Note (verified against code, not on faith)

Per the project critical guidance ("VERIFY BEFORE FLIPPING"), the flip was corroborated by grep + read of the actual source before any checkbox change:

- **HONEY-07 (V2) — LIVE, fails closed.** `src/bot.ts:253` calls `simulateHoneypotRoundtrip(ctx, dex, targetToken)`; `:254` `if (honeypotResult.verdict !== 'safe')` skips the buy (so `unknown` fails closed); `:263` logs `'Honeypot gate blocked V2 snipe'`. Source comment at `:249-252` cites HONEY-07 (plan 18-10) and confirms the broken `simulateSellForChain` V2 sell-sim was DELETED in plan 18-09 per D-ROLLBACK.
- **HONEY-08 (V3) — LIVE, vacuous-pass eliminated.** `src/bot.ts:566` calls `simulateHoneypotRoundtrip(ctx, dex, targetToken, feeTier)` (runtime feeTier threaded); `:567` blocks on `verdict !== 'safe'`; `:577` logs `'Honeypot gate blocked V3 snipe'`. The dispatch in `src/utils/honeypot/index.ts:43-90` returns `verdict: 'unknown'` on any config gap and never throws / never vacuous-passes, so the old silent-`true` vacuous-pass is unrepresentable; the broken `simulateSellV3ForChain` was DELETED in plan 18-09.
- The live preflight `honeypot-checker-code` check PASSes against the deployed checker `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD` (HONEY-03). This reconciles the doc with STATE.md/ROADMAP, which already show 18-09/18-10 shipped (RESEARCH OQ#9).

Checkboxes (lines 33-34) are now `[x]` with the evidence note appended; traceability rows (lines 156-157) read `Complete` with `bot.ts:253` / `bot.ts:566` cited.

**HONEY-04 confirmed untouched:** still `- [ ] **HONEY-04**` (line 30) and `| HONEY-04 | Phase 18 | Pending |` (line 153) — genuinely Pending BSC/Base/Arb deploy, out of Phase 21 scope.

## going-live.md Section Added

`## 10. Live-capture session (EXIT-LIVE-03/04/05)` (inserted after §9 Kill switch). Honors the locked CONTEXT decisions and reflects runtime reality:
- **Pre-requisites:** fork-rehearsal-green (D-FORK-REHEARSAL); `npm run preflight` read-only go/no-go covering all 6 ETH checks; re-read LIVE balance + gas at capture time with abort-if-gas-spiked (D-NO-TOPUP, point-in-time ~0.00915 ETH / ~0.82 gwei flagged as MUST re-read); verify wallet `0x46c6D387EAb1669307c33E6f60173ADEe9Da3A5C` + token address before any spend (D-CAPTURE-WALLET).
- **Action:** buy a hand-picked liquid/established SAFE token at min size via the real buy path that passes the bot's own honeypot gate (D-CAPTURE-METHOD); configure a tight TP/stop the position immediately satisfies so the exit engine's own 5s poll loop fires `executeFullSell` (D-EXIT-TRIGGER — explicitly NOT emergency-sell); `callStatic` / `eth_callBundle` simulate-before-submit; the single roundtrip yields BOTH artifacts from the SELL leg (EXIT-LIVE-03 `amount_out` + EXIT-LIVE-04 bundle→mined mapping); the BUY records a `'mev_bundle'` placeholder (not the EXIT-LIVE-04 artifact); EXIT-LIVE-05 piggybacks on the existing `positions_update` broadcast (screenshot, zero new code).
- **Expected harmless post-buy auto-pause** documented (after the ~0.003 ETH buy, balance dips below the 0.008 floor → Phase 20 mid-run check flips global pause; exit monitors keep running, sell completes) with a cross-reference to `## Mid-run wallet undercut recovery`.
- **Related docs:** §7 Pre-flight checks, §9 Kill switch, and `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` (EXIT-LIVE-11, Plan 08).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical consistency] Reworded EXIT-LIVE-10 op examples to the dotted taxonomy**
- **Found during:** Task 1 verification (the `exit-poll-cycle` grep surfaced a second occurrence on line 92, EXIT-LIVE-10).
- **Issue:** EXIT-LIVE-10's op examples were still hyphenated (`exit-poll-cycle`, `partial-sell-trigger`, `flashbots-submit`), directly contradicting both the EXIT-LIVE-01 reword I had just applied and D-OP-CONVENTION (dotted `exit.*`). EXIT-LIVE-10 is the op-enrichment requirement that downstream Phase 21 op-enrichment plan(s) build against; leaving two contradictory conventions in the same requirement category would propagate a wrong acceptance criterion — exactly the threat the plan's own T-21-05-03 (Repudiation: a wrong reword misleading the verifier) calls out.
- **Fix:** Reworded the three EXIT-LIVE-10 examples to `exit.poll.cycle` / `exit.partial.executed` / `exit.flashbots.submitted` (mapped from RESEARCH OQ#2's enumerated dotted ops), with an inline note that this keeps EXIT-LIVE-10 consistent with EXIT-LIVE-01.
- **Files modified:** `.planning/REQUIREMENTS.md` (line 92).
- **Commit:** `f006acc` (folded into Task 1, same file/category).
- **Note:** This is text-only on a docs/requirements plan; no requirement IDs added or renumbered, no production code affected.

No authentication gates were encountered (docs-only plan, no installs, no network).

## Verification (actual output)

Run against the committed files via the ripgrep-backed search tool (RTK not installed; no `rg` prefix used):

| Check | Required | Actual | Pass |
|-------|----------|--------|------|
| `exit.poll.cycle` in REQUIREMENTS.md | ≥ 1 | 2 (EXIT-LIVE-01 + EXIT-LIVE-10) | ✓ |
| `exit-poll-cycle` (hyphenated) in REQUIREMENTS.md | == 0 | 0 | ✓ |
| `PRAGMA user_version` in REQUIREMENTS.md | ≥ 1 | 1 | ✓ |
| `schema_version` in REQUIREMENTS.md | == 0 | 0 | ✓ |
| HONEY-07/08 checkboxes | `[x]` | both `[x]` (lines 33-34) | ✓ |
| HONEY-07/08 traceability | Complete | both Complete (lines 156-157) | ✓ |
| HONEY-04 untouched | `[ ]` / Pending | `[ ]` (line 30) + Pending (line 153) | ✓ |
| `Live-capture session` in going-live.md | ≥ 1 | 1 | ✓ |
| `0x46c6D387EAb1669307c33E6f60173ADEe9Da3A5C` in going-live.md | present | 2 | ✓ |
| §10 sub-headers (Pre-requisites/Action/Related docs) | present | lines 256/267/279 | ✓ |
| `auto-pause` cross-ref in going-live.md | present | 4 | ✓ |

## Commits

- `f006acc` docs(21-05): reword EXIT-LIVE-01/06/07/10 + reconcile HONEY-07/08 to Complete (`.planning/REQUIREMENTS.md`, +8/-8)
- `cd75e8c` docs(21-05): add live-capture session runbook to going-live.md (section 10) (`docs/operations/going-live.md`, +38)

## Notes for the Orchestrator

- Per the run override, I did **NOT** modify or commit `.planning/STATE.md` or `.planning/ROADMAP.md`. The orchestrator is the single writer for those and should record this plan's completion + the HONEY-07/08 traceability flip (which also belongs in ROADMAP's Phase 18 progress, if tracked there).
- D-STOP-THE-LINE: no bug or contradiction surfaced that requires escalation to phase 21.1. The EXIT-LIVE-10 hyphenation was a doc-consistency anomaly, fixed inline as a Rule 2 deviation (not a runtime bug). The HONEY-07/08 gates were corroborated live in code; the doc-lag was a documentation miss, not incomplete work — consistent with RESEARCH OQ#9.

## Self-Check: PASSED

- FOUND: `.planning/phases/21-exit-engine-live-runtime-hardening/21-05-SUMMARY.md`
- FOUND: `.planning/REQUIREMENTS.md`
- FOUND: `docs/operations/going-live.md`
- FOUND commit: `f006acc` (Task 1)
- FOUND commit: `cd75e8c` (Task 2)
