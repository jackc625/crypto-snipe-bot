---
phase: 21-exit-engine-live-runtime-hardening
plan: 01
subsystem: observability
tags: [pino, op-taxonomy, exit-engine, flashbots, telemetry, logging]

# Dependency graph
requires:
  - phase: 07-exit-engine (v6.16)
    provides: "exitEngine.ts — executeFullSell, executePartialSell, 5s poll loop, trailing/stop-loss/urgency triggers, exit_state persistence"
  - phase: 14 (v6.16)
    provides: "decodeReceipt → trades.amount_out receipt-decoded ground truth (D-OP-DB-TRUTH source)"
  - phase: 19 (FIX-09 lineage)
    provides: "FlashbotsMevStrategy.sendTransaction bundle submit/retry; the EXIT-LIVE-04 subject"
provides:
  - "Dotted past-tense exit.* op taxonomy across all ~15 exit-engine code paths (EXIT-LIVE-10)"
  - "Per-cycle budget-vs-actual poll telemetry op:exit.poll.cycle at BOTH setInterval bodies (EXIT-LIVE-01 mechanism)"
  - "op:flashbots.bundle.included capturing bundleHash + minedTxHash on bundle inclusion (EXIT-LIVE-04 capture mechanism)"
  - "3 unit test files asserting the concrete observable pino fields"
affects: [21-06, 21-07, 21-08]

# Tech tracking
tech-stack:
  added: []  # no new packages — pino ^10.3.1 + @flashbots/ethers-provider-bundle 1.0.0 already wired
  patterns:
    - "Dotted Namespace.Object.Action past-tense op field inside the structured first-arg object (matches antirug.* / killswitch.cp*)"
    - "Per-position poll telemetry (one setInterval per position → positions:1, no fleet-aggregate timer)"

key-files:
  created:
    - test/unit/exitEngine/opEnrichment.test.ts
    - test/unit/exitEngine/pollTelemetry.test.ts
    - test/unit/mevStrategies/flashbotsBundleHash.test.ts
  modified:
    - src/exitEngine.ts
    - src/utils/mevStrategies/flashbots.ts

key-decisions:
  - "exit.poll.cycle is PER-POSITION (positions:1); a fleet-wide positions:N aggregate is a deferred design choice flagged for operator sign-off (needs a new module-level sweep timer)"
  - "exit.receipt.decoded logs after a successful decode but explicitly does NOT gate exit success (D-OP-DB-TRUTH)"
  - "flashbots.bundle.included logs ONLY bundleHash + minedTxHash + block (T-21-01-03; never signedTransaction or FLASHBOTS_AUTH_KEY)"

patterns-established:
  - "op key sits INSIDE the existing structured first arg; the human message (2nd arg) is unchanged — additive logging only"
  - "overruns (PLURAL) = durationMs > budgetMs is the locked poll-cycle schema field name"

requirements-completed: [EXIT-LIVE-01, EXIT-LIVE-04, EXIT-LIVE-10]

# Metrics
duration: ~30min
completed: 2026-05-26
---

# Phase 21 Plan 01: Exit-Engine op-taxonomy spine + poll telemetry + Flashbots bundle mapping Summary

**Enriched `src/exitEngine.ts` with the dotted past-tense `exit.*` op taxonomy across all ~15 code paths, wrapped both poll-loop `setInterval` bodies with `op:exit.poll.cycle` budget-vs-actual telemetry, and added the missing `op:flashbots.bundle.included` bundleHash→minedTxHash log line — additive observability only, zero exit-logic / timing change, tsc clean, 3 new unit test files green.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-26T18:52:00Z (approx — baseline capture)
- **Completed:** 2026-05-26T19:06:36Z
- **Tasks:** 3 (all `type=auto tdd=true`)
- **Files modified:** 2 source + 3 new test files

## Accomplishments

- **EXIT-LIVE-10:** every meaningful exit-engine path now emits a dotted `exit.*` op for `op:exit.*` wildcard filtering — 13 existing log calls augmented in place + 1 net-new `exit.receipt.decoded` line.
- **EXIT-LIVE-01:** both `setInterval` bodies (`startExitMonitor` + `resumeExitMonitor`) emit one `op:exit.poll.cycle` per cycle with the full locked schema `{ positions, durationMs, budgetMs, overruns }`, measured via a `performance.now()` delta around the existing `pollExitStrategy` call (no added await, no latency).
- **EXIT-LIVE-04 mechanism:** `flashbots.ts` now logs `op:flashbots.bundle.included` with both `bundle.bundleHash` and the mined `realHash` on bundle inclusion — the bundle→mined mapping the live capture (Plan 07) will exercise. The strategy previously surfaced only the mined hash.
- No production bug surfaced (no D-STOP-THE-LINE escalation). The 5 `sendCtxAlert` D-ALERTS calls are preserved byte-for-byte.

## Task Commits

Each task was committed atomically (test + implementation together per task):

1. **Task 1: op-field enrichment across all exit-engine paths (EXIT-LIVE-10)** — `79586d3` (feat)
2. **Task 2: poll-cycle budget-vs-actual telemetry at both setInterval bodies (EXIT-LIVE-01)** — `12e3fa6` (feat)
3. **Task 3: Flashbots bundleHash→mined-tx-hash log line (EXIT-LIVE-04 mechanism)** — `912199c` (feat)

_TDD note: each task followed RED (failing op-presence assertions) → GREEN (op added) → verify. Both files per task were committed together as one atomic task commit, matching this repo's established per-task commit shape._

_Plan metadata: this SUMMARY commit (separate). STATE.md / ROADMAP.md intentionally NOT written by this executor — the orchestrator is the sole writer of those shared tracking files (gsd-sdk state.*/roadmap.* verbs mis-parse this project's hand-maintained STATE shape)._

## Files Created/Modified

- `src/exitEngine.ts` — 13 op-key augmentations to existing `ctx.log.*` calls + 1 new `exit.receipt.decoded` line + poll-cycle telemetry inserted into both `setInterval` bodies.
- `src/utils/mevStrategies/flashbots.ts` — 1 added `op:flashbots.bundle.included` log line at the `waitResponse === 0` branch.
- `test/unit/exitEngine/opEnrichment.test.ts` (NEW) — 10 tests; per-path op assertions via a `ctx.log` spy.
- `test/unit/exitEngine/pollTelemetry.test.ts` (NEW) — 5 tests; poll-cycle schema + overruns true/false + plural-spelling + both bodies.
- `test/unit/mevStrategies/flashbotsBundleHash.test.ts` (NEW) — 3 tests; bundleHash≠minedTxHash, no signed-tx/auth-key leak, block field.

## Final op-string set (downstream plans 06/07/08 filter on these)

| op | File:Line | Fires on |
|----|-----------|----------|
| `exit.cleanup.zero-balance` | exitEngine.ts:448 | zero-balance cleanup in executeFullSell |
| `exit.full.submitted` | exitEngine.ts:490 | full-sell submitted via MEV path |
| `exit.full.executed` | exitEngine.ts:506 | full-sell TX confirmed (success-criterion-4 op) |
| `exit.receipt.decoded` | exitEngine.ts:527 | after decodeReceipt (NEW line; filtering only, NOT success proof) |
| `exit.full.failed` | exitEngine.ts:559 | executeFullSell catch |
| `exit.partial.submitted` | exitEngine.ts:628 | partial-sell submitted |
| `exit.partial.executed` | exitEngine.ts:634 | partial-sell TX confirmed |
| `exit.partial.failed` | exitEngine.ts:680 | executePartialSell catch |
| `exit.trigger.trailing-stop` | exitEngine.ts:792 | trailing-stop pullback trigger |
| `exit.trailing.activated` | exitEngine.ts:799 | trailing stop activated at 2x |
| `exit.trigger.stop-loss` | exitEngine.ts:812 | fixed stop-loss trigger |
| `exit.trigger.urgency` | exitEngine.ts:826 | urgency hard exit at 30min |
| `exit.monitor.started` | exitEngine.ts:905 | startExitMonitor |
| `exit.poll.cycle` | exitEngine.ts:922 (startExitMonitor body) | per poll cycle — telemetry |
| `exit.monitor.resumed` | exitEngine.ts:969 | resumeExitMonitor DB-state path |
| `exit.poll.cycle` | exitEngine.ts:1012 (resumeExitMonitor body) | per poll cycle — telemetry |
| `flashbots.bundle.included` | flashbots.ts:109 | bundle inclusion — bundleHash + minedTxHash mapping |

No op string deviated from the planned table. The plan's line-number map matched the live file exactly at execution time; the final line numbers above are post-edit (shifted by the inserted `exit.receipt.decoded` block and the two telemetry blocks).

## Poll-cycle telemetry: per-position-vs-fleet (OPEN DECISION for operator sign-off)

- Each `exit.poll.cycle` line is emitted **PER-POSITION** with `positions: 1`. The engine runs ONE `setInterval` per open position (`exitEngine.ts` startExitMonitor + resumeExitMonitor each poll a single `tokenAddress`), so `positions:1` is read directly from the loop's own scope — **no new module-level timer was added**, and timing/control flow are unchanged (additive logging only).
- Schema emitted in both bodies: `{ op: 'exit.poll.cycle', token, positions: 1, durationMs, budgetMs: <pollIntervalMs=5000>, overruns }`. `overruns` (PLURAL, per the locked CONTEXT/REQUIREMENTS schema) is the boolean `durationMs > budgetMs`.
- **OPEN DECISION (flagged, NOT silently substituted):** if the operator later wants a single fleet-wide `positions:N` aggregate line, that is a follow-on design choice requiring a NEW module-level sweep timer (the engine has no fleet loop today). The per-position line was NOT substituted for a fleet line. Surface this for sign-off before any downstream plan assumes a fleet aggregate.

## Decisions Made

- **op:exit.poll.cycle is per-position** (see open-decision section above).
- **exit.receipt.decoded is filtering-only** — it logs the decoded amountOut/blockNumber for observability but the code comment + test design enforce that it MUST NOT be read as exit-success proof (D-OP-DB-TRUTH; ground truth is `trades.amount_out` + the on-chain receipt). The opEnrichment tests assert op PRESENCE, not exit success.
- **flashbots.bundle.included surfaces only public values** (bundleHash, minedTxHash, block) per T-21-01-03 — a dedicated test asserts the signed raw tx and the auth key never appear in the log object.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test harness] flashbotsBundleHash.test.ts mock wiring under `mockReset: true`**
- **Found during:** Task 3 (RED run)
- **Issue:** The first RED run threw `Cannot read properties of undefined (reading 'sendBundle')` because vitest's `mockReset: true` (set in `vitest.config.ts`) wipes mock implementations between tests, so the inline `FlashbotsBundleProvider.create` mock resolved to `undefined`.
- **Fix:** Extracted `create` to a named `createMock` and re-established `createMock.mockResolvedValue({ sendBundle: sendBundleMock })` in `beforeEach`. This is test-harness wiring only — no production code involved.
- **Files modified:** test/unit/mevStrategies/flashbotsBundleHash.test.ts
- **Verification:** RED re-run then correctly failed on the missing `flashbots.bundle.included` log (genuine RED), then GREEN after implementation.
- **Committed in:** `912199c` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 test-harness, Rule 1). No production-code deviation.
**Impact on plan:** Test-only fix to make the harness exercise the real strategy path. No scope creep; no exit-logic or timing change anywhere.

## Issues Encountered

- The plan's op-surface line-number map (448/490/503/…) matched the live `exitEngine.ts` exactly; the only re-read needed was after edits shifted line numbers (the `exit.receipt.decoded` insertion pushed the trailing-stop/urgency lines down), which is why the urgency-line edit briefly failed a stale-text match and was retried against fresh text. No anomaly — purely mechanical line drift.

## Verification (real output)

- `npx tsc --noEmit -p tsconfig.bot.json` → exit 0; `npx tsc --noEmit -p tsconfig.json` → exit 0.
- `npx vitest run --project unit test/unit/exitEngine/ test/unit/mevStrategies/flashbotsBundleHash.test.ts` → 4 files / 26 tests pass (3 new files: opEnrichment 10, pollTelemetry 5, flashbotsBundleHash 3; + pre-existing antiRugReason 8).
- op-coverage: 16 `op: 'exit.` literals (≥13 required); `overruns` count 4 (≥2); `positions` count 4 (≥2); `op: 'exit.poll.cycle'` ×2 (both bodies); `op: 'flashbots.bundle.included'` ×1.
- **Full unit-suite regression:** pre-plan baseline 57 files / 572 tests → post-plan 60 files / 590 tests. Exactly +3 files / +18 tests (the new files); **zero regressions**.

## User Setup Required

None — no external service configuration. No new env vars, no new packages (pino + @flashbots/ethers-provider-bundle already wired).

## Next Phase Readiness

- The `exit.*` op-taxonomy spine and `flashbots.bundle.included` mapping log are in place for the live-capture run (Plan 07) and the evidence doc (Plan 08) to filter on and excerpt.
- **Operator sign-off needed (non-blocking for code):** confirm the per-position `exit.poll.cycle` (positions:1) is the desired shape, or schedule the fleet-aggregate follow-on (new sweep timer) as a separate decision.
- No blockers. No production bug surfaced (D-STOP-THE-LINE not triggered).

---
*Phase: 21-exit-engine-live-runtime-hardening*
*Completed: 2026-05-26*
