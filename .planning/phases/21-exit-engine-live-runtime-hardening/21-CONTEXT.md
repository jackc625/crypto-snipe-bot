# Phase 21: Exit-Engine Live-Runtime Hardening - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the **6 deferred v6.16 human-verification items** with **real-mainnet
artifacts** (resolvable Etherscan tx hashes, DB row excerpts, pino log
excerpts, timestamped dashboard screenshots) consolidated in
`.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md`. The phase's defining
rule: **"a fork test passing is no longer accepted as closure"** for any of
these items. Plus build the test infrastructure and `op`-field logging that
catch future exit-engine regressions. Delivers:

- **Live-mainnet evidence capture** (EXIT-LIVE-03/04) — one controlled ETH
  buy+sell roundtrip through the real bot produces the live sell `amount_out`
  artifact AND the Flashbots bundle→mined-tx mapping.
- **EXIT-LIVE-08 test safety** — `chainId===1` guard + `ALLOW_REAL_MAINNET=1`
  gate so the automated suite can never accidentally transact on real mainnet;
  fork-only test wallet (prod key never imported into a test).
- **EXIT-LIVE-09** — `scripts/capture-launch.ts` + ≥3 real-launch JSON fixtures
  in `test/fork/fixtures/realLaunches/` replayed against `handleNewPairForChain`,
  exercising the full validation→buy→exit-monitor→sell lifecycle.
- **EXIT-LIVE-10** — `op`-field log enrichment across every exit-engine code
  path (`src/exitEngine.ts` has zero `op` fields today).
- **EXIT-LIVE-01/02/07** — live poll-cycle telemetry, an automated
  SIGTERM-restart `exit_state` persistence fork test, and a fresh-clone
  SQLite/`.bot-state.json` migration log.
- **EXIT-LIVE-11** — the consolidated VERIFICATION-EVIDENCE archive.

**Scope anchor:** this phase *verifies* the v6.16 exit engine on live data and
*hardens the test/observability around it*. It does NOT add exit strategies or
change exit-engine behavior — that engine shipped in v6.16.

**Real-capital context (carried forward, verified live 2026-05-26):** bot is
funded on ETH mainnet (wallet `0x46c6D387EAb1669307c33E6f60173ADEe9Da3A5C`,
balance **0.00915 ETH**); `npm run preflight` passes all 6 ETH checks including
`honeypot-checker-code` and Flashbots health — the bot CAN snipe ETH
end-to-end. Owner constraint (Phase 18/19/20): "if it is better and safer, we
take that option. This is real capital." Capital safety > throughput > LOC.

</domain>

<decisions>
## Implementation Decisions

### Live-sell capture strategy (EXIT-LIVE-03/04)

- **D-CAPTURE-METHOD:** The bot **buys a hand-picked liquid/established safe
  token at minimum size via its real buy path**, then we capture *its exit*.
  The buy is just the means to obtain a position; this decouples buy-side risk
  from the sell-path evidence we actually need. NOT an organic snipe of a fresh
  launch (honeypot/timing risk on ~0.009 ETH), NOT a manual external buy.
- **D-CHAIN-SINGLE-ROUNDTRIP:** A **single ETH roundtrip captures both
  artifacts** — the buy gives the Flashbots bundle→mined mapping (EXIT-LIVE-04),
  the sell gives non-null `amount_out` (EXIT-LIVE-03). ETH is forced: Flashbots
  is ETH-only, and ETH is the only chain the bot can currently run end-to-end
  (HoneypotChecker not yet deployed on BSC/Base/Arb = HONEY-04, **out of this
  phase's scope**). The **sell must route through Flashbots** so the sell leg is
  itself a clean 04 artifact — *researcher to confirm `executeFullSell` →
  `sendTxWithRetry` uses the Flashbots MEV strategy on ETH (the ANTIRUG-08
  gas-multiplier-through-`sendTxWithRetry` wiring suggests yes).*
- **D-NO-TOPUP:** **No wallet top-up.** Capture opportunistically at calm gas.
  Live conditions at discussion (2026-05-26): balance 0.00915 ETH, gas 0.82 gwei
  base → roundtrip ~$1-3. The position (~0.003 ETH) mostly returns on the sell;
  net spend is gas + slippage. **Abort the capture if gas has spiked** at
  capture time. Accept the expected, harmless **post-buy auto-pause** (after the
  0.003 buy, balance dips below the 0.008 preflight floor → Phase 20
  D-MID-RUN-CHECK flips global pause; exit monitors keep running, the sell still
  completes).
- **D-EXIT-TRIGGER:** Fire the sell by **configuring a take-profit/stop the
  position immediately satisfies**, so the exit engine's own 5s poll loop fires
  `executeFullSell` on the next cycle. Deterministic timing AND exercises the
  REAL exit-engine path (poll→evaluate→sell) — which is what the phase verifies.
  Captures EXIT-LIVE-03 + EXIT-LIVE-01 poll telemetry in one run. **NOT** the
  emergency-sell manual override (that bypasses the engine's own trigger logic).

### Real-mainnet test safety (EXIT-LIVE-08)

- **D-CAPTURE-WALLET:** The Area-1 evidence capture runs as the **real
  production bot on its prod wallet** — the artifact's whole point is proving
  the PROD bot's exit works live (production-under-observation, not a "test").
  EXIT-LIVE-08's "dedicated test wallet, NOT the prod wallet" rule therefore
  scopes to **the automated test suite only**, which must never load the prod
  key.
- **D-TEST-WALLET-FORKONLY:** The dedicated test wallet is **fork-only with zero
  real ETH** — a throwaway address used only for fork-impersonation signing. The
  prod key is never imported into any test. `ALLOW_REAL_MAINNET` stays a
  tripwire that is never actually crossed in normal operation (real capture runs
  as the prod bot directly, not via test infra).
- **D-GATE-BOTH-LAYERS:** Enforce the `chainId===1` / `ALLOW_REAL_MAINNET=1`
  guard via **both layers** — (a) a **global test-setup tripwire** that aborts
  the whole run if any test sees `chainId===1` without the gate (protects every
  test, including future ones that forget to opt in), plus (b) the **opt-in
  per-test decorator** the requirement names, as an explicit intent marker for
  any deliberate real-mainnet test. **CI never sets the gate.**
- **D-FORK-REHEARSAL:** **Rehearse the exact capture sequence on a mainnet-fork
  first** (bot-buy the chosen token → tight-threshold exit → verify `amount_out`
  + receipt decode + exit-engine trigger), confirm green end-to-end, THEN do the
  real run with **callStatic / `eth_callBundle` simulate-before-submit** at
  capture time. A local fork has no Flashbots relay, so the fork rehearsal
  de-risks everything *except* the Flashbots submission leg (covered by v6.16
  FIX-09's tested retry path on the real run).

### Real-launch fixtures (EXIT-LIVE-09)

- **D-FIXTURE-SELECTION:** **Hand-pick specific historical ETH launches by
  address** — tokens known to be safe + tradeable (passed the gate, real
  liquidity, no tax surprises) so the replay's buy lands and the full lifecycle
  runs. `capture-launch.ts` records each by token address + launch block
  (deterministic, guaranteed-green). NOT auto-discovery (would discard many
  honeypot/dead-LP launches first).
- **D-FIXTURE-EXITS:** The **3 fixtures each drive a DIFFERENT exit path** —
  e.g. full take-profit, partial-sell (the Phase 10/14 revenue path), and
  trailing-stop / age-weighted urgency — so the fixtures form a **regression net
  across the exit engine's branches** (the phase's stated deeper goal). The
  reject path stays covered by the existing `honeypots/` + `rugs/` fixtures (no
  reject-path launch added to `realLaunches/`).
- **D-FIXTURE-DEX:** **3 ETH fixtures spread across V2 and V3** so both DEX
  lifecycle paths in `handleNewPairForChain` are covered within the minimum
  count. (3 is the REQ minimum; expanding to a full V2×V3×exit matrix is
  deferred — see Deferred Ideas.)

### Evidence bar + op taxonomy (EXIT-LIVE-06/10/11)

- **D-OP-CONVENTION:** Adopt the **dotted `exit.*` hierarchy, past-tense**
  (`exit.poll.cycle`, `exit.partial.executed`, `exit.full.executed`,
  `exit.flashbots.submitted`, `exit.receipt.decoded`, …). Matches the codebase's
  existing `antirug.*` / `killswitch.cp1` convention, success-criterion-4
  (`exit.full.executed`), and industry best practice (Namespace.Object.Action);
  enables `op:exit.*` wildcard filtering. **Reword the conflicting REQUIREMENTS
  EXIT-LIVE-01 example** (`exit-poll-cycle` → `exit.poll.cycle`) during
  plan-phase — same pattern Phase 20 used to reword OPS-LIVE-02/06.
- **D-OP-DB-TRUTH:** **Comprehensive op coverage** across every meaningful
  exit-engine event for filtering — BUT the **ground truth for "an exit
  happened" is the DB receipt-decoded `amount_out` + the on-chain receipt,
  NEVER a log line or an instrumented try/catch metric** (success-criterion-4).
  Verification and the evidence artifacts assert against the DB/chain, not
  telemetry. Guards the telemetry-masks-issue failure mode.
- **D-INDUCE-RPC-DROP:** Capture EXIT-LIVE-06 (chain-restart warning) by
  **inducing the RPC drop deterministically** (point at a dead/unreachable RPC
  briefly, or a connection-drop proxy) — fast, repeatable, schedulable.
  EXIT-LIVE-05 (dashboard WS) **piggybacks on the Area-1 live capture** (the
  same on-chain event drives the position update); EXIT-LIVE-07 (migration log)
  is a deliberate **fresh-clone first boot**.
- **D-EVIDENCE-BAR:** **Strict ground-truth per item** — each artifact must show
  real, independently-verifiable evidence (a resolvable Etherscan tx hash, a DB
  row excerpt with the actual value, a pino excerpt with real fields, a
  timestamped browser screenshot). A fork-test pass alone NEVER closes an item.
  `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` (EXIT-LIVE-11) is the
  single source of truth.

### Carried-forward conventions (inherited from Phase 17/18/19/20)

- **D-STOP-THE-LINE** [reaffirmed for Phase 21]: any bug surfaced during a
  capture or fixture replay **BLOCKS phase close** → escalates to a new
  requirement / decimal **phase 21.1**. Fix-in-flight and file-and-defer are
  both rejected.
- **D-ENV-EXAMPLE** [USER-BINDING]: every new env var (`ALLOW_REAL_MAINNET`,
  any test-wallet / capture-config vars, any archive-RPC var for
  `capture-launch.ts`) lands in `.env.example` with default + 1-line description.
- **D-ALERTS:** structured pino + Telegram for failures, with remediation
  pointers — same shape as Phase 18/20.
- **D-04 observable-effect rigor:** every new test asserts a concrete observable
  effect (DB row, pino field, process.exit code, on-chain receipt / tx hash) —
  no `expect(true).toBe(true)` hollow fills.
- **D-ROLLBACK:** no escape hatches; the test-safety gate has no
  bypass-in-prod-code path beyond the explicit `ALLOW_REAL_MAINNET` opt-in.

### Claude's Discretion

- `scripts/capture-launch.ts` CLI shape, output format, and the archive-RPC
  source — within "records PairCreated→Mint→first-Swap by address+block,
  deterministic replay."
- The exact set of `op` fields and where each fires — within the dotted `exit.*`
  convention + comprehensive coverage (D-OP-CONVENTION / D-OP-DB-TRUTH).
- EXIT-LIVE-02 SIGTERM-kill mechanism and fork-test structure — within "kills
  bot mid-cycle, verifies `exit_state` poll position identical pre/post restart."
- The budget-vs-actual poll-telemetry schema — within
  `{ op: 'exit.poll.cycle', positions, durationMs, budgetMs: 5000, overruns }`.
- How price action is driven to trigger the varied exits on fork replay (pool
  manipulation vs per-fixture threshold config).
- `v6.17-VERIFICATION-EVIDENCE.md` document structure — within "single source of
  truth, all 6 items, strict ground-truth artifacts" (follow the existing
  `.planning/milestones/v6.17-*.md` audit-doc shape).
- The global tripwire's RPC-detection mechanism (read `chainId` at fork setup).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v6.17 milestone source-of-truth
- `.planning/REQUIREMENTS.md` §"Exit-Engine Live-Runtime Hardening (EXIT-LIVE)"
  — EXIT-LIVE-01..11 full acceptance criteria. Planner should reword EXIT-LIVE-01
  (op example → dotted) per D-OP-CONVENTION and clarify EXIT-LIVE-08's "test
  wallet" vs the prod-wallet capture per D-CAPTURE-WALLET during plan-phase.
- `.planning/ROADMAP.md` §"Phase 21: Exit-Engine Live-Runtime Hardening" — goal,
  depends-on (Phase 20 surface + Phase 19 op-convention), 4 success criteria.
- `.planning/PROJECT.md` — owner real-capital constraint; "Current Milestone"
  exit-live-runtime bullet; the 6 deferred-item → EXIT-LIVE mapping.
- `.planning/STATE.md` §"Blockers / Concerns" — the 6 deferred v6.16 items
  mapped to EXIT-LIVE-01..07.

### Carry-forward conventions (established earlier in v6.17)
- `.planning/phases/20-going-live-ops-hardening/20-CONTEXT.md` — D-STOP-THE-LINE,
  D-ENV-EXAMPLE [USER-BINDING], D-ALERTS, D-04, D-ROLLBACK; the preflight /
  pause / mid-run-undercut behaviors the capture interacts with.
- `.planning/phases/17-tech-debt-cleanup-audit-baseline/17-CONTEXT.md` — D-04
  observable-effect origin; stop-the-line (D-07) origin; CI-invariant-as-evergreen
  pattern.

### Code targets (modify / create)
- `src/exitEngine.ts` — **MODIFY**. `op`-field enrichment target (zero `op`
  fields today); owns `executeFullSell`, the 5s poll loop, partial-sell,
  trailing-stop / age-weighted urgency. Source of EXIT-LIVE-01/10 and the
  exit-trigger path D-EXIT-TRIGGER relies on.
- `src/bot.ts` — **READ/REFERENCE**. `handleNewPairForChain` (V2 + V3 buy paths,
  Flashbots submit for EXIT-LIVE-04) is what the capture and the realLaunches
  fixtures exercise. Existing dotted `op` usage (`killswitch.cp*`, `antirug.*`)
  is the convention `exit.*` follows.
- `src/utils/db.ts` — **READ/REFERENCE**. `exit_state` table (poll-position
  persistence for EXIT-LIVE-02), `trades.amount_out` (receipt-decoded ground
  truth for EXIT-LIVE-03 / D-OP-DB-TRUTH), `schema_version` (migration check for
  EXIT-LIVE-07).
- `src/utils/txManager.ts` (or the MEV-strategy module that owns
  `sendTxWithRetry`) — **VERIFY**. FIX-09 Flashbots dynamic-relay + nonce retry
  is the EXIT-LIVE-04 subject; confirm `executeFullSell` routes sells through it
  on ETH (D-CHAIN-SINGLE-ROUNDTRIP).
- `scripts/capture-launch.ts` — **NEW**. Archive-RPC recorder of real launches
  (D-FIXTURE-SELECTION).
- `scripts/preflight.ts` / `npm run preflight` — **REUSE**. Read-only readiness
  check; part of the capture go/no-go gate.
- `docs/operations/going-live.md` — **MODIFY**. Extend with the live-capture
  runbook (go/no-go checklist, abort-if-gas-spiked, simulate-before-submit,
  fork-rehearsal-first) per the D-OPERATOR-HANDOFF lineage.
- `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` — **NEW** (EXIT-LIVE-11).
- `.env.example` — **MODIFY** [USER-BINDING]. `ALLOW_REAL_MAINNET` + any new vars.

### Test infrastructure
- `test/fork/setup.ts` + `teardown.ts` — Hardhat-node fork harness (forks
  `ETH_FORK_RPC_URL`/`ALCHEMY_URL` on :8545); home of the global `chainId`
  tripwire (D-GATE-BOTH-LAYERS) and the live-capture fork rehearsal.
- `test/fork/snipeLifecycle.test.ts` — existing buy→exit lifecycle fork test;
  the `realLaunches/` replay and the capture rehearsal extend this pattern.
- `test/fork/fixtures/honeypots/*.json` + `rugs/*.json` (+ their READMEs) — the
  JSON-fixture-per-scenario + fork-replay pattern `realLaunches/` mirrors; also
  the reject-path coverage D-FIXTURE-EXITS leans on.
- `vitest.config.ts` — existing unit / integration / fork projects; Phase 21
  tests file into `fork` (no new project needed).

### MEV / Flashbots
- v6.16 FIX-09 (Flashbots dynamic relay + nonce-incrementing retry) — the
  capability EXIT-LIVE-04's artifact demonstrates under real MEV competition.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`test/fork/snipeLifecycle.test.ts` + the `test/fork/` harness** — the buy→
  exit lifecycle is already fork-tested; the `realLaunches/` replay and the
  Area-1 capture rehearsal are extensions, not greenfield.
- **`test/fork/fixtures/{honeypots,rugs}/*.json`** — the recorded-scenario JSON
  fixture + fork-replay convention; `realLaunches/` slots in alongside.
- **`npm run preflight` (`scripts/preflight.ts`)** — read-only; verified live
  green on ETH (incl. honeypot-checker-code + Flashbots). Reuse as the capture
  go/no-go gate and to read the live balance without spending.
- **Dotted `op` convention already in `src/anti-rug/*`, `src/bot.ts`
  killswitch/antirug, `src/preflight.ts`** — `exit.*` enrichment follows the
  exact established style; no new logging infra.
- **`trades.amount_out` receipt decoder (v6.16 Phase 14)** — already wired into
  every sell path; it is the DB-is-truth source for EXIT-LIVE-03 / D-OP-DB-TRUTH.
- **Dashboard WS hub (Phase 20 `pause_state_change` broadcast pattern)** —
  position-update WS already exists; EXIT-LIVE-05 is observation/screenshot, not
  new code.

### Established Patterns
- **Milestone evidence/audit doc** — `.planning/milestones/v6.17-honeypot-checker-audit.md`,
  `…-safety-bank-audit.md`, `…-debt-baseline.md`. `v6.17-VERIFICATION-EVIDENCE.md`
  follows the same shape.
- **REQUIREMENTS reword during plan-phase** — Phase 20 reworded OPS-LIVE-02/06;
  Phase 21 rewords EXIT-LIVE-01 (op example) per D-OP-CONVENTION.
- **D-STOP-THE-LINE → decimal phase** escalation (17→20) and **CI-invariant
  evergreen guards** (`.todo` ban, `tsc ×3`, contracts paths-filter).
- **callStatic simulate-before-submit** — used in the existing buy/safety path;
  D-FORK-REHEARSAL reuses it for the real capture run.

### Integration Points
- `src/exitEngine.ts` — add `op` fields at poll-cycle, trigger evaluation,
  partial-sell + full-sell submit/confirm, flashbots submit/mined, receipt
  decode, and error/abort paths.
- `src/bot.ts` `handleNewPairForChain` — the buy path + Flashbots submit the
  capture and fixtures exercise (V2 and V3).
- `test/fork/setup.ts` — global `chainId===1` tripwire; new `realLaunches`
  replay test; the live-capture fork rehearsal.
- `src/utils/db.ts` `exit_state` — the SIGTERM-restart persistence assertion
  (EXIT-LIVE-02) reads poll position pre/post restart.

</code_context>

<specifics>
## Specific Ideas

- **The phase's defining rule (owner-level):** "a fork test passing is no longer
  accepted as closure" for the 6 deferred items — they need real-mainnet
  ground-truth artifacts. This is the non-negotiable that shaped every decision.
- **Live ground truth captured during discussion (2026-05-26T16:33Z):** wallet
  `0x46c6D387EAb1669307c33E6f60173ADEe9Da3A5C`, balance **0.00915 ETH**, block
  25180722, gas **0.82 gwei base** / 1.65 maxFee; `npm run preflight` all 6 ETH
  checks PASS. This is *point-in-time* — re-read live balance/gas at capture time.
- **Doc-lag anomaly for the researcher to reconcile (not blocking):** ROADMAP +
  STATE show Phase 18's ETH gate wiring complete (18-07/09/10 ✅ with commits),
  but `REQUIREMENTS.md` traceability still lists HONEY-07/08 as "Pending." The
  live preflight (`honeypot-checker-code` PASS) confirms the ETH gate is
  functional at runtime; reconcile the doc before any real-money capture.
- **Capture-time operational picks (deliberately NOT plan decisions):** the
  specific token to buy (must be liquid/established/safe AND pass the bot's own
  honeypot gate) and who runs the capture session — chosen at execution time.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-chain live-artifact capture (BSC/Base/Arb)** — naturally follows once
  HONEY-04 deploys the HoneypotChecker on the other chains. The "split 03 onto a
  cheaper chain" option was rejected for Phase 21 specifically because it would
  pull HONEY-04 (Phase 18 scope) forward. Revisit as an EXIT-LIVE-style
  follow-on after HONEY-04 lands.
- **Small-funded dedicated test wallet** — considered and rejected in favor of
  fork-only/zero-ETH (D-TEST-WALLET-FORKONLY). Revisit only if a future need for
  isolated *automated* real-mainnet tests emerges.
- **Sepolia testnet rehearsal** — considered and rejected (lower fidelity than a
  mainnet fork; no real Flashbots relay) in favor of D-FORK-REHEARSAL.
- **Expand `realLaunches/` to a full V2×V3×exit-trigger matrix (~5-6 fixtures)**
  — deferred; 3 (V2+V3 spread, varied exits) is the chosen minimum. Expand later
  if regression coverage proves insufficient.
- **Synthetic canary-trade monitor (OPS-V2-01)** — the strongest mitigation
  against telemetry-masks-issue; stays v6.18+ per REQUIREMENTS.md v2. Phase 21's
  D-OP-DB-TRUTH (DB receipt = ground truth, not telemetry) partially addresses
  the same risk for the exit path.

</deferred>

---

*Phase: 21-exit-engine-live-runtime-hardening*
*Context gathered: 2026-05-26*
