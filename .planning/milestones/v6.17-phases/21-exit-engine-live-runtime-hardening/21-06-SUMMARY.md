---
phase: 21-exit-engine-live-runtime-hardening
plan: 06
subsystem: testing
tags: [fork-test, vitest, hardhat, exit-engine, stop-loss, decodeReceipt, amount_out, ethers, rehearsal]

# Dependency graph
requires:
  - phase: 21-01
    provides: "exit.* op-field enrichment (exit.poll.cycle / exit.trigger.stop-loss / exit.full.executed / exit.receipt.decoded) used as the filtering check"
  - phase: 21-02
    provides: "requireRealMainnetGate + FORK_ONLY_TEST_KEY test-safety gate (D-GATE-BOTH-LAYERS)"
  - phase: 21-03
    provides: "realLaunchReplay fork pattern + the LADYS/BOBO realLaunches fixtures + capture-launch.ts; the ChainContext/passthrough/repin-fund-mine harness shape"
  - phase: 21-05
    provides: "live-capture session runbook in going-live.md the operator replicates"
provides:
  - "test/fork/captureRehearsal.fork.test.ts — the D-FORK-REHEARSAL gate: bot-buy a V2 token -> tight stop -> engine poll loop fires executeFullSell -> non-null trades.amount_out (via decodeReceipt), end-to-end, GREEN"
  - "A proven, replayable exit-trigger sequence (tight STOP_LOSS_PCT + induced downward tick) the operator follows at the real Plan 07 capture"
affects: [21-07, 21-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tight-stop exit rehearsal: bot-buys via the REAL handler (which arms the exit monitor), a whale elevates entry then dumps to crater price below a tight STOP_LOSS_PCT, and the engine's OWN 5s poll loop fires executeFullSell('stop-loss') — NOT the emergency override"
    - "DB-is-truth (D-OP-DB-TRUTH): proof is the trades.amount_out NOT NULL row read via a separate read-only connection; op events are a filtering check only"

key-files:
  created:
    - "test/fork/captureRehearsal.fork.test.ts"
  modified: []

key-decisions:
  - "Used the fixed stop-loss branch (STOP_LOSS_PCT=5, no partial tiers) as the tight trigger — the cleanest D-EXIT-TRIGGER path below 2x that the engine's poll loop fires on its own"
  - "Reused the proven LADYS V2 realLaunches fixture (settledForkBlock 17216118) — established/liquid/safe and V2, so it is NOT blocked by the phase-21.1 V3-buy bug"
  - "Induced the downward price tick via a whale buy-then-dump (elevate entry, then crater below the tight stop) so the threshold crossing is deterministic"

patterns-established:
  - "Pattern: rehearse the live exit-trigger path on a fork and assert the DB amount_out (proof) + the exit.* op stream (filter that it was the engine poll loop's stop-loss, not the override)"

requirements-completed: []  # INTENTIONALLY EMPTY — D-EVIDENCE-BAR: a fork rehearsal closes NO requirement; EXIT-LIVE-03/04 close on Plan 07 (real run) + Plan 08 (evidence doc).

# Metrics
duration: ~35min
completed: 2026-05-26
---

# Phase 21 Plan 06: Fork Rehearsal of the Live-Capture Sequence (D-FORK-REHEARSAL) Summary

**A green fork rehearsal that bot-buys a V2 token through the REAL handler, fires a tight stop-loss via the exit engine's OWN 5s poll loop (executeFullSell, not the emergency override), and asserts a NON-NULL `trades.amount_out` decoded from the on-chain sell receipt — the hard de-risk GATE for the real-capital Plan 07 run.**

## GREEN / NOT-GREEN STATUS

**GREEN.** The rehearsal passes end-to-end on the local 31337 mainnet fork. Plan 07 (`depends_on` this being green) is unblocked from a rehearsal-gate standpoint. (Phase 21 close itself remains blocked by the separate phase-21.1 V3-buy bug, which does NOT affect this V2 rehearsal.)

- **Isolation:** `npx vitest run --project fork test/fork/captureRehearsal.fork.test.ts` → 2 passed (exit 0).
- **Full suite (no regressions):** `npm run test:fork` → 8 files / 39 tests passed (baseline was 7 files / 37; +1 file / +2 tests). See "Verification" below.

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-26T22:08Z (approx)
- **Completed:** 2026-05-26T22:18Z (approx)
- **Tasks:** 1
- **Files modified:** 1 (created)

## Accomplishments

- **The exact live-capture sequence rehearsed green on a fork (D-FORK-REHEARSAL):** bot-buy → tight stop → poll fires sell → non-null `amount_out`.
- **The EXIT-LIVE-03 sell→amount_out→receipt-decode MECHANISM validated** on the fork: the engine's `executeFullSell` → `sendTxWithRetry` → `decodeReceipt` chain produced a real `trades.amount_out` (e.g. `24853776910585613` wei out, from the WETH `Withdrawal` event on the on-chain sell receipt).
- **The EXIT-LIVE-04 Flashbots call path exercised** (executeFullSell routes the sell through the MEV strategy) — but on `passthrough` here, since a local fork has NO Flashbots relay; the bundle-hash→mined-tx artifact is Plan 07's real run.
- **The exit was fired by the engine's OWN poll loop's stop-loss trigger, NOT the emergency-sell override** — asserted via the captured `op` stream (`exit.poll.cycle`, `exit.trigger.stop-loss`, `exit.full.executed` with `reason='stop-loss'`, `exit.receipt.decoded`) as a filtering check; the DB `amount_out` row is the proof (D-OP-DB-TRUTH).

## Task Commits

1. **Task 1: captureRehearsal.fork.test.ts (buy → tight exit → poll fires sell → amount_out)** - `0d5d2bf` (test)

**Plan metadata:** this commit (docs: complete plan — the commit that adds this SUMMARY)

## Files Created/Modified

- `test/fork/captureRehearsal.fork.test.ts` — Fork rehearsal of the live-capture sequence. In `beforeAll`: connects the fork provider, calls `requireRealMainnetGate(provider)`, signs with `FORK_ONLY_TEST_KEY` (never the prod key), lazy-imports `src/` after pointing `DB_PATH` at an isolated temp DB. The test: `hardhat_reset`s to the LADYS settled block, funds the fork wallet, interval-mines, deploys the HoneypotChecker, builds an ETH `ChainContext` (`mevStrategy:'passthrough'`), has a whale elevate the entry price, drives the REAL `handleNewPairForChain` (which buys AND arms the exit monitor), has the whale dump to crater the price below the tight 5% stop, then waits for the engine's poll loop to record a full `sell` row with `amount_out` NOT NULL and asserts the `exit.*` op stream confirms the stop-loss → full-sell path.

## Decisions Made

- **Trigger = fixed stop-loss (not a partial tier).** Set `STOP_LOSS_PCT=5` and `PARTIAL_SELL_TARGETS=''` so the clean trigger is the engine's `Step 6` stop-loss branch (`currentPrice <= entryPrice*(1-0.05)`, below 2x, trailing not activated) — the most faithful D-EXIT-TRIGGER "tight stop the position immediately satisfies" path that the poll loop fires on its own. `STOP_LOSS_PCT` is the var `src/config.ts:221` actually reads (a prior fork test used the wrong name `STOP_LOSS_PERCENT`, a silent no-op falling back to the 25% default — noted, not relied upon here).
- **Token = LADYS V2** (`0x12970E…646bf`, the proven Plan 21-03 fixture, settledForkBlock 17216118). Established/liquid/safe AND V2, so it is NOT blocked by the phase-21.1 V3-buy bug (per `21-STOP-THE-LINE-01`). The rehearsal correctly uses V2 exactly as D-CHAIN-SINGLE-ROUNDTRIP / D-CAPTURE-METHOD require.
- **Downward tick = whale buy-then-dump.** A funded whale buys ~50% of the token reserve BEFORE the bot (elevating the recorded entry price), then dumps its entire bag AFTER the bot's buy (cratering the price far below the tight stop). Deterministic threshold crossing; this is test-side price scaffolding (a third-party actor), NOT a replacement for the bot's REAL buy.

## Deviations from Plan

None — plan executed exactly as written. The single Task-1 test was created and is green in isolation and in the full fork suite. No `src/` production code was modified. No deviation rules were triggered (no bugs, missing functionality, or blockers surfaced in the exit path — the real path works).

## Issues Encountered

- **Acceptance-grep hardening (not a code bug):** the safety comments originally contained the literal string `process.env.PRIVATE_KEY` (mirroring the sibling 21-03 test), which would make the acceptance "grep returns 0 for process.env.PRIVATE_KEY" check fail. Reworded the two comments to describe the prod key without the exact literal (the actual signer is unchanged — `FORK_ONLY_TEST_KEY`). The acceptance grep now returns 0; the `swapExactETHForTokens` grep also returns 0 (the buy is via the REAL handler; the whale uses `swapETHForExactTokens`/`swapExactTokensForETH`, different functions).
- **Expected fork noise (diagnosed, non-blocking):** the run logs `op:antirug.http-polling.error` lines (Alchemy free-tier `eth_getLogs` returns HTTP 400 for the wide block range the anti-rug HTTP fallback requests on the fork). This is pre-existing behavior present in the GREEN baseline (21-03/21-04 emit the identical lines and pass); it is the anti-rug listener's HTTP fallback, entirely separate from the exit-engine sell path under rehearsal, and does not affect the buy, the poll loop, the sell, or the `amount_out` assertion.

## D-STOP-THE-LINE

**No bug surfaced in the rehearsed exit path.** The 5s poll-loop trigger, `executeFullSell`, the Flashbots/MEV routing call path, and `amount_out`/`decodeReceipt` recording all work end-to-end on the fork for the V2 path. Nothing to escalate from this plan. (The separate, pre-existing **V3-buy** tax-gate bug remains escalated to phase 21.1 by Plan 21-03; it is out of this V2 rehearsal's path and was neither re-triggered nor worked around here.)

## Requirement Closure

**This plan closes NO requirement (by design).** Per D-EVIDENCE-BAR, a fork-test pass NEVER closes a deferred item, and a local fork has no Flashbots relay so it cannot produce the EXIT-LIVE-04 bundle-hash→mined-tx artifact. The plan's `requirements` frontmatter is intentionally empty. EXIT-LIVE-03 and EXIT-LIVE-04 are owned and close ONLY on the Plan 07 real-mainnet run + the Plan 08 evidence doc. This plan is the de-risk GATE that Plan 07 `depends_on`.

## Next Phase Readiness

- **Plan 07 (real-capital capture) is rehearsal-unblocked.** The operator replicates this exact sequence on the real bot: bot-buy a hand-picked liquid/established **V2** safe token at minimum size, configure a tight take-profit/stop the position immediately satisfies, and let the exit engine's own poll loop fire `executeFullSell` (on the real run the sell routes through Flashbots, producing the EXIT-LIVE-04 bundle→mined artifact and the EXIT-LIVE-03 non-null `amount_out`). Use `npm run preflight` as the go/no-go gate and abort if gas has spiked (per `going-live.md` §10 / 21-05).
- **Blocker carried (not from this plan):** Phase 21 close still requires resolving the phase-21.1 V3-buy tax-gate bug; it does not block the V2 Plan 07 capture.

## Self-Check: PASSED

- FOUND: `test/fork/captureRehearsal.fork.test.ts` (created, committed in `0d5d2bf`)
- FOUND: commit `0d5d2bf` in `git log`
- VERIFIED (ran, passing output): `npx vitest run --project fork test/fork/captureRehearsal.fork.test.ts` → 2 passed (exit 0)
- VERIFIED (ran, passing output): `npm run test:fork` → 8 files / 39 tests passed (exit 0); baseline was 7/37 → +1 file / +2 tests, zero regressions
- VERIFIED (ran, passing output): `npx tsc --noEmit -p tsconfig.json` → exit 0 (clean)
- VERIFIED: acceptance greps on the test file → `swapExactETHForTokens` = 0, `process.env.PRIVATE_KEY` = 0

## Verification

| Check | Command | Result |
|-------|---------|--------|
| Rehearsal green in isolation | `npx vitest run --project fork test/fork/captureRehearsal.fork.test.ts --reporter=verbose` | 2 passed (exit 0); sell `amountOut=24853776910585613` decoded from WETH Withdrawal |
| Full fork suite, no regressions | `npm run test:fork` | 8 files / 39 tests passed (exit 0) — baseline 7/37 |
| Typecheck (incl. test/) | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| Buy via REAL handler (not manual swap) | grep `swapExactETHForTokens` in test | 0 matches |
| Prod key never loaded | grep `process.env.PRIVATE_KEY` in test | 0 matches |
| DB-is-truth proof | assert `trades.amount_out` NOT NULL for the token | non-null (`24853776910585613`) |
| Engine poll loop fired the sell (not the override) | captured `op` stream contains `exit.poll.cycle` + `exit.trigger.stop-loss` + `exit.full.executed`(reason=`stop-loss`) + `exit.receipt.decoded` | all present |

---
*Phase: 21-exit-engine-live-runtime-hardening*
*Completed: 2026-05-26*
