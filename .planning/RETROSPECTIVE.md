# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v6.17 — Defensive Hardening for Live Mainnet

**Shipped:** 2026-05-29 (ETH-first)
**Phases:** 8 (17–21 + inserted 21.1/21.2/21.3) | **Plans:** 69 completed (1 deferred) | **Timeline:** 45 days (2026-04-14 → 2026-05-29), 491 commits

### What Was Built
- On-chain `HoneypotChecker.sol` (V2+V3) pre-buy safety stack — ETH-deployed + Etherscan-verified; broken V2/V3 sell-sims deleted; fail-closed discriminated-union `HoneypotResult`.
- Anti-rug runtime monitoring (single-listener-per-chain WS, multi-signal AND-chain, circuit breaker, 7-day dry-run, reconnect/backfill).
- Going-live ops hardening — `src/preflight.ts` fail-fast + SQLite-persisted multi-stage kill-switch + `npm run preflight|pause|resume` + versioned runbook.
- Exit-engine live-runtime hardening — the 6 deferred v6.16 items closed with **real-mainnet artifacts** via a live real-capital roundtrip.
- Three STOP-THE-LINE decimal phases (21.1/21.2/21.3) hardening the buy→monitor→exit lifecycle against calm-gas non-inclusion, nonce collisions, event-loop freeze, and failed-exit position loss.

### What Worked
- **Quality gates as the real defense.** The deep code-review + fork-rehearsal gates repeatedly caught capital-safety bugs the green unit suite missed — because the unit tests mocked the very mechanism under test. Every milestone-critical bug (21.1 CR-01, 21.2 S-1/CR-01/CR-02/NF-01, 21.3 STOP-THE-LINE-06/CR-01, audit INT-NONCE-SELL) was caught this way, then RED-proven before fix.
- **D-STOP-THE-LINE discipline.** Bugs surfaced during live-capture were escalated to fresh decimal phases (not fixed in-flight, not file-and-deferred), keeping each fix scoped, reviewed, and reversible.
- **D-EVIDENCE-BAR.** Refusing to accept a fork pass as closure for live-runtime items forced genuine on-chain proof — the live LADYS roundtrip validated the entire 21.1/21.2/21.3 chain end-to-end in one shot.
- **Fail-closed defaults.** The ETH-first deferral of HONEY-04 is safe precisely because BSC/Base/Arb refuse to boot without a deployed checker — a deferred requirement, not a silent risk.

### What Was Inefficient
- **Three live-capture retries to land one roundtrip.** Each 21-07 attempt surfaced a new calm-gas inclusion failure (sell, then freeze, then buy), spawning 21.1→21.2→21.3. Earlier modelling of calm-gas Flashbots inclusion (0.25-gwei base fee → builder-coverage, not pricing) would have collapsed three decimal phases into one.
- **Doc-lag in REQUIREMENTS/ROADMAP checkboxes.** Status checkboxes were flipped only at phase close, so the traceability table and milestone-summary checkboxes drifted from the authoritative Progress table — reconciled only at milestone close.
- **gsd-sdk STATE/ROADMAP mis-parse.** This project's hand-maintained STATE/ROADMAP shape is corrupted by `gsd-sdk state.*`/`roadmap.*`/`phase.complete`; the orchestrator had to hand-edit throughout, including this milestone close.

### Patterns Established
- **Bot-wide per-wallet nonce authority** (`withNonceLock`, composing with re-fetch-`latest`; never ethers `NonceManager`) — every signing path routes through it. The INT-NONCE-SELL gap proved that "each site is individually wrapped" must be verified, not asserted.
- **Real-path RED-proven regression tests** for capital-safety fixes — mock only the I/O boundary (DB/notifier/relay-HTTP), never the mechanism under test.
- **Discriminated-union + fail-closed `unknown`** to make a dangerous state unrepresentable in the type system (the vacuous-pass lesson).
- **Snipes stay PRIVATE; a separate explicit operator path may go public** — no heuristic auto-classification.

### Key Lessons
1. A green unit suite is not evidence of capital safety on this project — if the test mocks the mechanism, it will pass a money-path bug. Adversarial code-review + fork rehearsal + real-path tests are the gate that actually holds.
2. Live-runtime claims need on-chain artifacts (D-EVIDENCE-BAR); a fork pass closes only what a fork can prove.
3. Calm-gas Flashbots non-inclusion at low base fee is a builder-coverage problem (multi-builder fanout), not a pricing problem — diagnose before escalating priority fee.
4. Fail-closed deferral (HONEY-04) is a legitimate scope decision; fail-open deferral never is.

### Cost Observations
- Model mix: opus-heavy (executor_model opus; deep code-reviews on opus). Sonnet/haiku share not precisely tracked.
- Sessions: multiple across 45 days (not individually counted).
- Notable: the most expensive work was the review-fix-rereview convergence loops on 21.2/21.3 — but they caught the bugs that would have lost real money, so the spend was load-bearing.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Key Change |
|-----------|--------|------------|
| v6.16 | 16 | Built the multi-chain bot; gap-closure phases (10–16) shipped audit fixes atomically rather than slipping scope. |
| v6.17 | 8 (+3 decimal) | D-STOP-THE-LINE decimal phases for live-capture bugs; D-EVIDENCE-BAR for real-mainnet closure; quality gates (deep review + fork rehearsal) over green-suite trust. |

### Cumulative Quality

| Milestone | Tests (unit) | Notable |
|-----------|--------------|---------|
| v6.16 | 343 total (unit+integration+fork) | First green CI baseline. |
| v6.17 | 759 unit + 216 integration + fork | Real-path RED-proven capital-safety regressions; live-mainnet roundtrip proven. |

### Top Lessons (Verified Across Milestones)

1. Ship audit fixes atomically within the milestone rather than deferring (v6.16 phases 10–16; v6.17 decimal phases 21.1/21.2/21.3).
2. On this codebase, the green unit suite repeatedly masks money-path bugs by mocking the mechanism under test — real-path integration + adversarial review is the reliable defense.
