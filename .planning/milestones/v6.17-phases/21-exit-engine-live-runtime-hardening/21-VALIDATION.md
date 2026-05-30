---
phase: 21
slug: exit-engine-live-runtime-hardening
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
validated: 2026-05-29
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest `^4.1.1` |
| **Config file** | `vitest.config.ts` (3 projects: `unit` / `integration` / `fork`) |
| **Quick run command** | `npx vitest run --project unit --reporter=verbose` (alias: `npm run test:unit`) |
| **Full suite command** | `npm run test:all` (= `vitest run` across unit + integration + fork; the `fork` project spawns a Hardhat mainnet-fork node via `test/fork/setup.ts` globalSetup) |
| **Estimated runtime** | unit ~5s (`testTimeout: 5000`); fork ~60–120s (`testTimeout: 120000`, boots `hardhat node --fork`) |

> Note: `unit`/`integration`/`fork` are vitest *projects* (selected via `--project`), not separate runners. The fork project requires `ETH_FORK_RPC_URL` or `ALCHEMY_URL` to be set (archive-tier — see Wave 0). EXIT-LIVE-03/04/05/06/07 each have an automated portion (proves the mechanism on a fork/unit) AND a live-artifact portion captured by the operator in Plans 07/08 — per D-EVIDENCE-BAR the live artifact is what *closes* the item, the automated test alone does not. The single authorized exception is EXIT-LIVE-02 (see Manual-Only / disposition note in Plan 08): ROADMAP success criterion 1(b) explicitly names the automated Vitest fork test as its closure artifact.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project unit --reporter=verbose` (fast; covers the Wave-1 op-enrichment + telemetry + flashbots unit tests). For fork-only tasks, run that task's `npx vitest run --project fork <file>`.
- **After every plan wave:** Run `npm run test:fork` (boots the Hardhat fork; covers the gate meta-test, replay, persistence, and rehearsal fork tests).
- **Before `/gsd-verify-work`:** Full suite (`npm run test:all`) must be green, PLUS the live-artifact items (EXIT-LIVE-01-live / 03 / 04 / 05 / 06 / 07) closed in `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` with real-mainnet artifacts (a fork pass alone does NOT close these — D-EVIDENCE-BAR).
- **Max feedback latency:** ~10s for the unit project; ~120s for a single fork test (Hardhat node spin-up + `testTimeout`).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 21-01-01 | 01 | 1 | EXIT-LIVE-10 | T-21-01-01 / T-21-01-02 | op log is filtering-only; never asserts exit success (DB `amount_out` is truth); additive logging, control flow byte-identical | unit | `npx vitest run --project unit test/unit/exitEngine/opEnrichment.test.ts --reporter=verbose` | ✅ | ✅ green |
| 21-01-02 | 01 | 1 | EXIT-LIVE-01 | T-21-01-02 | poll telemetry wraps the existing call only; no added latency; interval period unchanged | unit | `npx vitest run --project unit test/unit/exitEngine/pollTelemetry.test.ts --reporter=verbose` | ✅ | ✅ green |
| 21-01-03 | 01 | 1 | EXIT-LIVE-04 | T-21-01-03 | logs only public `bundleHash`/`minedTxHash`/`block`; never `signedTransaction` or `FLASHBOTS_AUTH_KEY` | unit | `npx vitest run --project unit test/unit/mevStrategies/flashbotsBundleHash.test.ts --reporter=verbose` | ✅ | ✅ green |
| 21-02-01 | 02 | 1 | EXIT-LIVE-08 | T-21-02-01 / T-21-02-02 | gate throws (not silent) at chainId 1 without `ALLOW_REAL_MAINNET=1`; helper never references prod `PRIVATE_KEY` | fork | `npx vitest run --project fork test/fork/realMainnetGate.fork.test.ts --reporter=verbose` | ✅ | ✅ green |
| 21-02-02 | 02 | 1 | EXIT-LIVE-08 | T-21-02-03 / T-21-02-04 | global tripwire aborts the whole run on real-mainnet chainId; gate lives only in test infra (no in-prod bypass) | fork | `npx vitest run --project fork --reporter=verbose 2>&1 | head -40` | ✅ (setup.ts) | ✅ green |
| 21-03-01 | 03 | 2 | EXIT-LIVE-09 | T-21-03-01 / T-21-03-02 | checksum-validates argv address (`ethers.getAddress`); reads archive RPC from env, never hardcoded; pino-only (no console) | type-check | `npx tsc --noEmit -p tsconfig.json` | ✅ (script) | ✅ green |
| 21-03-02 | 03 | 2 | EXIT-LIVE-09 | T-21-03-01 | fixtures hold only public addresses/blocks; `forkBlockNumber = launchBlock - 1`; each fixture `JSON.parse`-clean | fork | `npx tsc --noEmit -p tsconfig.json && npx vitest run --project fork test/fork/realLaunchReplay.fork.test.ts --reporter=verbose` | ✅ (3 fixtures) | ✅ green |
| 21-03-03 | 03 | 2 | EXIT-LIVE-09 | T-21-03-03 / T-21-03-04 | drives the REAL handler (not a manual swap); gate before tx; `FORK_ONLY_TEST_KEY` only; asserts DB `amount_out`, never a log | fork | `npx vitest run --project fork test/fork/realLaunchReplay.fork.test.ts --reporter=verbose` | ✅ | ✅ green ¹ |
| 21-04-01 | 04 | 2 | EXIT-LIVE-02 | T-21-04-01 / T-21-04-02 / T-21-04-03 | SIGTERM (not SIGKILL — WAL-flush durability); `FORK_ONLY_TEST_KEY` only; asserts DB `exit_state` cols, never a log | fork | `npx vitest run --project fork test/fork/exitStatePersistence.fork.test.ts --reporter=verbose` | ✅ | ✅ green ² |
| 21-05-01 | 05 | 1 | EXIT-LIVE-01, EXIT-LIVE-06, EXIT-LIVE-07 | T-21-05-03 | each reword cites its exact code-evidence resolution; no requirement IDs renumbered | doc (grep) | `grep -c "exit.poll.cycle" .planning/REQUIREMENTS.md` | ✅ (REQUIREMENTS.md) | ✅ green |
| 21-05-02 | 05 | 1 | (EXIT-LIVE-03/04/05 runbook) | T-21-05-01 / T-21-05-02 | runbook references only the public wallet address + env-var NAMES (never key values); abort-if-gas-spiked + simulate-before-submit present | doc (grep) | `grep -c "Live-capture session" docs/operations/going-live.md` | ✅ (going-live.md) | ✅ green |
| 21-06-01 | 06 | 3 | EXIT-LIVE-03 (mechanism rehearsal — NOT closure) | T-21-06-01 / T-21-06-02 / T-21-06-03 | rehearsal is the GATE not the closure (03/04 close on the real run in 07); REAL buy path (no manual swap); `FORK_ONLY_TEST_KEY` only; asserts DB `amount_out` | fork | `npx vitest run --project fork test/fork/captureRehearsal.fork.test.ts --reporter=verbose` | ✅ | ✅ green |
| 21-07-01 | 07 | 4 | EXIT-LIVE-01, EXIT-LIVE-03, EXIT-LIVE-04, EXIT-LIVE-05 | T-21-07-01..05 | OPERATOR-ONLY real-capital capture; agent never signs/broadcasts; go/no-go gas abort; address verification; simulate-before-submit; acceptance is the resolvable artifact, never "the script ran" | manual | (see Manual-Only Verifications) | ✅ (21-07-CAPTURE-ARTIFACTS.md) | ✅ captured |
| 21-08-01 | 08 | 5 | EXIT-LIVE-06, EXIT-LIVE-07 | T-21-08-01 / T-21-08-03 | operator-confirmed observation captures; induced drop is brief/controlled (dead URL / `provider.destroy()`); user_version read is the real query result | manual | (see Manual-Only Verifications) | ✅ (21-08-SUMMARY + evidence doc) | ✅ captured |
| 21-08-02 | 08 | 5 | EXIT-LIVE-11 | T-21-08-01 / T-21-08-02 / T-21-08-04 | a fork pass closes nothing (D-EVIDENCE-BAR); each row links a resolvable artifact; assertions against DB/chain (D-OP-DB-TRUTH); no secrets in the archive | doc (grep) | `grep -c "EXIT-LIVE-0" .planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` | ✅ (evidence doc) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Note: 21-07-01 and 21-08-01 are `autonomous: false` operator-capture tasks → test type "manual"; their real-artifact proof lives in the Manual-Only Verifications table, not the automated map above. The automated portion of EXIT-LIVE-01/03/04 (Plans 01/06) proves the mechanism; the operator capture (Plan 07) supplies the closing real-mainnet artifact.*

*¹ The `eth-v3-trailing` fixture's path was BLOCKED by the V3 tax-gate bug when 21-03 authored this row; that bug was **fixed in plan 21.1-03** (commits `95e6267` / `efd6555`) and commit `3f61dd7` flipped the fixture + `realLaunchReplay` so all three fixtures (incl. V3) now drive the full buy→exit→sell lifecycle. The 2026-05-29 audit run confirms the V3 fixture passes the full lifecycle, not a blocked-at-gate assertion.*
*² `exitStatePersistence.fork.test.ts` grew from 2 → 3 tests (the `exit_failed_held`-row resume test), tracking the v7 `exit_failure_count`/`exit_status` schema added in phase 21.2-03. All 3 pass.*

---

## Wave 0 Requirements

The existing vitest infrastructure (3 projects already in `vitest.config.ts`; `test/fork/setup.ts` globalSetup already spawns the Hardhat fork) is reused — **no new test framework or runner is installed**. The phase creates these new TEST files (the executors author them as part of their plans; they do not pre-exist):

- [x] `test/unit/exitEngine/opEnrichment.test.ts` — EXIT-LIVE-10 (21-01 Task 1): asserts each exit path's pino object carries the expected `op:'exit.*'`
- [x] `test/unit/exitEngine/pollTelemetry.test.ts` — EXIT-LIVE-01 (21-01 Task 2): asserts `op:'exit.poll.cycle'` with `positions`/`durationMs`/`budgetMs`/`overruns`
- [x] `test/unit/mevStrategies/flashbotsBundleHash.test.ts` — EXIT-LIVE-04 mechanism (21-01 Task 3): asserts `bundleHash` + `minedTxHash` captured + distinct
- [x] `test/fork/realMainnetGate.fork.test.ts` — EXIT-LIVE-08 (21-02 Task 1): meta-test proving the gate throws at chainId 1 without the gate
- [x] `test/fork/realLaunchReplay.fork.test.ts` — EXIT-LIVE-09 (21-03 Task 3): drives the REAL `handleNewPairForChain`/`handleNewV3PoolForChain`, ≥3 fixtures (V3 now full-lifecycle post-21.1)
- [x] `test/fork/exitStatePersistence.fork.test.ts` — EXIT-LIVE-02 (21-04 Task 1): SIGTERM-restart, identical `exit_state` strategy columns
- [x] `test/fork/captureRehearsal.fork.test.ts` — EXIT-LIVE-03/04 mechanism rehearsal (21-06 Task 1): buy → tight exit → poll fires sell → `amount_out`
- [x] `test/fork/fixtures/realLaunches/{eth-v2-tp,eth-v2-partial,eth-v3-trailing}.json` + `README.md` — EXIT-LIVE-09 fixture data (21-03 Task 2)
- [x] `test/fork/setup.ts` — MODIFY: add the global `chainId===1` tripwire (21-02 Task 2, D-GATE-BOTH-LAYERS layer a)
- [x] `test/fork/helpers/realMainnetGate.ts` — NEW helper: `isHardhatFork` + `requireRealMainnetGate` + `FORK_ONLY_TEST_KEY` (21-02 Task 1)
- [x] EXISTING (reuse, do NOT recreate): `test/unit/chainRestart.test.ts` (EXIT-LIVE-06 analog), `test/unit/db/*migration*.test.ts` (EXIT-LIVE-07 analog), `test/fork/honeypotChecker.fork.test.ts` + `test/fork/antiRugDetector.fork.test.ts` (fork-wiring analogs), `test/fork/snipeLifecycle.test.ts` (anti-pattern reference only — it does NOT call the real handler)

*No framework-install step is needed — the project's vitest + Hardhat fork harness covers every phase requirement. The Wave-0 gap is the set of new TEST FILES above, all authored in-plan by their respective executors.*

---

## Manual-Only Verifications

These are the `autonomous: false` operator-capture artifacts. Their proof is a real-mainnet / real-bot artifact (D-EVIDENCE-BAR), not an automated assertion.

> **CLOSED (2026-05-29).** All six rows below are now closed with ground-truth artifacts, consolidated in `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md` (EXIT-LIVE-11). EXIT-LIVE-01/03/04/05 came from one controlled real-capital ETH roundtrip on the prod wallet (sell tx `0xcc7997bb…619bc605`, DB `amount_out=993814525259157`); EXIT-LIVE-06/07 from operator-confirmed isolated captures against the real code; EXIT-LIVE-02 by its ROADMAP sc-1(b)-authorized fork test. The instructions below are retained as the procedure of record.

| Behavior | Requirement | Why Manual | Test Instructions (real-artifact proof) |
|----------|-------------|------------|------------------------------------------|
| Live sell `amount_out` non-null on real mainnet | EXIT-LIVE-03 | Spends real ETH on the prod wallet — an agent must never sign/broadcast (D-CAPTURE-WALLET) | Operator runs the §10 live-capture session: bot buys a safe token at min size, tight TP/stop fires the engine's poll loop → `executeFullSell`. Capture the resolvable Etherscan sell tx hash + a `SELECT … FROM trades` excerpt showing the real non-null `amount_out`. (Plan 07 → `21-07-CAPTURE-ARTIFACTS.md`) |
| Flashbots bundle-hash → mined-tx-hash mapping | EXIT-LIVE-04 | Same real-capital sell; the relay artifact only exists on a real submission (a local fork has no Flashbots relay) | From the SAME sell, capture the `flashbots.bundle.included` pino excerpt with the real `bundleHash` AND `minedTxHash`; confirm the `minedTxHash` resolves on Etherscan. (Capture the SELL leg only — the BUY records a `'mev_bundle'` placeholder.) |
| Dashboard WS position update | EXIT-LIVE-05 | Visual/browser verification of a live on-chain event | Timestamped browser screenshot of the dashboard showing the position appearing/updating via WebSocket during the Plan 07 capture (existing `positions_update` broadcast; zero new code). |
| Live exit-poll-cycle telemetry on real RPC | EXIT-LIVE-01 (live half) | Real-RPC budget-vs-actual can only be observed during the live run | pino excerpts of `op:exit.poll.cycle` showing `durationMs` vs `budgetMs:5000` captured on the real RPC during the Plan 07 session. Operator filter idiom: `… | npx pino-pretty | grep exit.poll.cycle` (or a `jq 'select(.op=="exit.poll.cycle")'` equivalent — confirm the project's actual pino output shape). |
| Chain-restart warning on induced RPC drop | EXIT-LIVE-06 | Operator-confirmed real bot output (agent MAY induce the drop locally, operator confirms authenticity) | Induce the WS drop deterministically (dead URL / `provider.destroy()` — ethers v6 does not auto-reconnect); capture the WS-listener reconnect warning (`bot.ts:859`) and/or `op:antirug.ws.disconnected` (`detector.ts:872`). WS-listener event, NOT exit-poll. (Plan 08 Task 1) |
| Fresh-clone migration log + `PRAGMA user_version`=6 | EXIT-LIVE-07 | Operator-confirmed real first-boot output | On a fresh clone (no `data/bot.db`; optional sample `.bot-state.json`), start the bot (`npx ts-node src/bot.ts`); capture the `'Created … (schema version N)'` + `'Migrated .bot-state.json to SQLite'` pino lines; run `PRAGMA user_version` → confirm 6. (Plan 08 Task 1) |
| EXIT-LIVE-02 state persistence (authorized fork-test closure) | EXIT-LIVE-02 | Closed by the AUTOMATED fork test per ROADMAP sc-1(b) — the single documented exception to D-EVIDENCE-BAR | The `21-04-01` automated fork test (`test/fork/exitStatePersistence.fork.test.ts`) IS the closure artifact; the evidence doc (Plan 08) records `closed-fork-only:1` with an explicit citation to ROADMAP sc-1(b). No real-mainnet capture is required for this one item. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (operator-capture tasks 21-07-01 / 21-08-01 are manual-only, documented above)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (the two manual operator tasks are bracketed by automated doc-grep verifies)
- [x] Wave 0 covers all MISSING references (the new test files listed above — all 10 authored + 3 fixtures + README)
- [x] No watch-mode flags (all commands use `vitest run`, never `vitest` watch)
- [x] Feedback latency < 120s (unit 0.6s; the 4 Phase 21 fork files run in 116.7s as a single fork-node boot)
- [x] `nyquist_compliant: true` set in frontmatter (flipped true by the 2026-05-29 validation audit — all Wave-0 test files written and green)

**Approval:** ✅ validated 2026-05-29 — 38/38 automated tests green (21 unit + 17 fork), 6 manual-only items closed with live artifacts.

---

## Validation Audit 2026-05-29

State A audit (existing VALIDATION.md, authored 2026-05-26 pre-execution). Re-ran the full Phase 21
automated suite against current HEAD and cross-checked the live-artifact closures.

| Metric | Count |
|--------|-------|
| Requirements in map | 11 (EXIT-LIVE-01..11) |
| Gaps found (MISSING) | 0 |
| Resolved (auditor-generated tests) | 0 (none needed) |
| Escalated to manual-only | 0 |
| Automated tests re-run green | 38 (21 unit + 17 fork) |
| Manual-only items closed (live artifact) | 6 (EXIT-LIVE-01/03/04/05/06/07) |

**Method:** `npx vitest run --project unit` on the 3 op/telemetry/flashbots files → 21/21 green
(0.6s). `npx vitest run --project fork` on `realMainnetGate` / `exitStatePersistence` /
`captureRehearsal` / `realLaunchReplay` → 4 files / 17 tests green (116.7s, single Hardhat
mainnet-fork boot, `ALLOW_REAL_MAINNET` unset → gate honored). EXIT-LIVE-11 evidence doc verified
present (19 `EXIT-LIVE-0` refs, resolvable on-chain/DB artifacts).

**Audit notes (no gaps, but reality drifted from the pre-execution draft):**
- The map was authored before phase 21.1/21.2/21.3 landed. Two test files evolved and were
  re-verified green on current HEAD: the `eth-v3-trailing` fixture now drives the **full V3
  lifecycle** (the 21-03 STOP-THE-LINE V3 tax-gate bug was fixed in 21.1-03), and
  `exitStatePersistence` gained a 3rd test for the v7 `exit_failure_count`/`exit_status` schema
  (21.2-03). See footnotes ¹ ² on the Per-Task map.
- No MISSING gaps → the gsd-nyquist-auditor was **not** spawned (nothing to generate). All
  requirements are COVERED by a green automated mechanism test and/or closed by a documented
  D-EVIDENCE-BAR live artifact.
- Pre-existing, out-of-Phase-21 fork failures (`snipeLifecycle` / `antiRugDetector` deployer
  nonce-desync, logged in `deferred-items.md`) were **excluded** from this run by file-scoping to
  the four Phase 21 fork files — they are unrelated to Phase 21 coverage.
