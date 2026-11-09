# Requirements: Crypto Snipe Bot — v7.0 Full Audit & Modernization

**Defined:** 2026-11-06
**Core Value:** Reliably detect, validate, and profitably snipe new token listings across multiple EVM chains with proper risk management — the bot must never lose money to preventable bugs, race conditions, or security flaws.

**Milestone contract:** Bot stays OFF for the whole milestone. Trading behavior is preserved by default; any behavior change is an explicit, logged operator decision (decision card with an ID). Capital-safety (S0/S1) findings follow D-STOP-THE-LINE — re-surface to the operator, never auto-defer. Research: `.planning/research/SUMMARY.md` (28 unconfirmed audit candidates, 25 open operator decisions OD-1..OD-25).

## v1 Requirements (this milestone)

### Safety Rails (SAFE)

- [ ] **SAFE-01**: Ignition deployment state (`ignition/deployments/`, incl. gitignored `journal.jsonl` + per-future artifacts) and `data/` (`bot.db` + `-wal` + `-shm` together, or checkpoint + `db.backup()`) are backed up outside the repo with a verified hash manifest before any `npm install`, Hardhat invocation, sweep, or relocation; `ignition/deployments/` is then tracked in git (OD-21).
- [ ] **SAFE-02**: Test runs cannot read the real `.env`, open `data/bot.db`, reach the network, or send Telegram alerts — enforced by a dummy test env, a prod-DB tripwire that throws under Vitest, an outbound-network deny, and a notifier that refuses to send under Vitest; each rail is proven by a test that fails if the rail is removed.
- [ ] **SAFE-03**: Lock/registry singletons (`withNonceLock`, sell lock, ExitWorker, anti-rug registry) throw on duplicate load in one process (e.g. `Symbol.for` guard catching Windows path-casing aliases), and `forceConsistentCasingInFileNames` is enabled in every tsconfig.
- [ ] **SAFE-04**: A second bot process for the same wallet refuses to start (single-instance process lock acquired at boot).
- [x] **SAFE-05**: The bot refuses to boot against a DB whose `user_version` is newer than the code supports, and refuses to silently create a fresh DB in production (absolute `DB_PATH` resolution, refuse-to-create).
- [ ] **SAFE-06**: CI fails if any `vi.mock` path in the suite does not resolve to an existing module (a moved file cannot turn a mock into a silent no-op).
- [ ] **SAFE-07**: Before/after baselines are captured and committed: `npm ls`, `npm audit`, ESLint counts by rule and file, per-project test counts, coverage file list, `data/bot.db` checksum.

### Audit (AUDIT)

- [ ] **AUDIT-01**: A findings register (`AUDIT-FINDINGS.md`) covers `src/`, `dashboard/`, `test/`, `scripts/`, and contracts tooling; every entry has severity (S0–S4), capital-impact class, evidence, a mandatory "sibling sites checked" field, and lifecycle status (candidate → confirmed → decided → fixed → verified, or NOT-A-BUG).
- [ ] **AUDIT-02**: All 28 research-surfaced candidates (SUMMARY.md §Audit Candidates) are triaged to confirmed (RED real-path test or fork script) or NOT-A-BUG (with evidence).
- [ ] **AUDIT-03**: The EVM trading-bot bug-class sweep is completed and recorded: BigInt/Number mixing, `||` vs `??` with 0n/''/0, token decimals, slippage/minOut, deadlines, approvals, nonce management, reorgs, receipt status, WS reconnect/backfill, unhandled rejections, timer leaks, SQLite transaction boundaries and crash consistency, idempotent exits, TOCTOU, gas/fee ceilings, key handling, env validation, API auth/CORS, Telegram trust.
- [ ] **AUDIT-04**: A thresholds/magic-number inventory lists every trading parameter with current value, source, and rationale; questionable design (thresholds, race windows, fragile patterns) is flagged with a recommendation.
- [ ] **AUDIT-05**: Every behavior-changing recommendation is an operator decision card in `OPERATOR-DECISIONS.md`, decided before implementation; no trading-behavior change lands without a cited decision ID.
- [ ] **AUDIT-06**: Commit taxonomy is enforced: `refactor:` / `lint:` / `fmt:` / `deps:` commits produce zero decision-trace diff; `behavior:` commits cite a decision ID.
- [ ] **AUDIT-07**: Every confirmed S2–S4 finding in the register is fixed with a RED-then-GREEN test (real-path for money-path code) or closed by an explicit operator won't-fix decision before the re-entry gate — none deferred automatically (covers e.g. base-fee derivation, DEX-listener backfill/heartbeat, stale buy deadline, fee-on-transfer sell variant, reorg handling, `.wait()` error classification, non-transactional state changes, symbol/name injection, key/log redaction, when confirmed below S1).

### Characterization (CHAR)

- [ ] **CHAR-01**: A real-path test harness exists: real ethers, fake JSON-RPC transport, real in-memory SQLite running the real migrations, fixed clock; only logger, notifier, broadcaster, relay HTTP, and clock are mocked.
- [ ] **CHAR-02**: A golden-master decision trace (`op` logs, submitted tx requests/calldata, DB writes) is captured for V2 and V3 buys, every exit type (trailing, partial, stop-loss, urgency, anti-rug), the risk gate, and fee/gas computation; existing suspected bugs are tagged `SUSPECT(<finding-id>)`, not silently locked in.
- [ ] **CHAR-03**: An env-matrix snapshot covers config and chain-registry parsing for `{unset, '', '0', 'abc', valid}`.
- [ ] **CHAR-04**: Tests pin boot/resume/arm ordering, listener counts, same-block ordering, singleton identity, and a signing-site census proving every signing path goes through `withNonceLock` (with a positive `>= N` count assertion).
- [ ] **CHAR-05**: DB migration golden tests run the real migrations v0→v7 and v4→v7; the test DB helper uses the real migrations (no hand-duplicated schema at `user_version = 4`).
- [ ] **CHAR-06**: Source-text (grep-the-file) tests are converted to path-agnostic behavioral checks.

### Capital-Safety Fixes (CAP)

Each requirement is satisfied by one of: (a) confirmed with a RED real-path test, fixed, GREEN, and independently re-verified (RED→GREEN re-run by a separate reviewer); (b) NOT-A-BUG with evidence in the findings register; or (c) an explicit operator decision where noted. Fixes land on the current layout, before the restructure.

- [ ] **CAP-01**: A buy that landed on-chain is never recorded as failed; post-submit bookkeeping errors still arm exit monitoring and anti-rug (V2 and V3 handlers).
- [ ] **CAP-02**: A buy whose price quote fails, or whose slippage cannot be computed, is skipped — never submitted with `minOut = 0` (OD-15).
- [ ] **CAP-03**: Private sells (V2/V3, full and partial) use the operator-decided minOut policy (OD-14); no unbounded `amountOutMin = 0` except where the decision explicitly allows it.
- [ ] **CAP-04**: Two detection events for the same token (WS + HTTP, V2 + V3 pools, Telegram + factory) cannot both produce a buy — the dedup reservation is atomic and precedes submission.
- [ ] **CAP-05**: An unhandled promise rejection cannot silently take down exit or anti-rug monitoring: per-handler containment (`void p.catch(escalate)`) plus a global `unhandledRejection` handler that alerts and triggers controlled shutdown (OD-6).
- [ ] **CAP-06**: Invalid numeric env values (e.g. `MAX_OPEN_POSITIONS=ten`) fail boot instead of disabling risk limits; the risk manager, config, and dashboard routes share one validated parser.
- [ ] **CAP-07**: An exit monitor that cannot obtain an initial price retries with alerting instead of leaving the position without routine exit monitoring.
- [ ] **CAP-08**: Exit pricing is correct for tokens of any decimals (the price probe uses token units), and an entry price of 0 cannot disable stop-loss or trailing-stop comparisons.
- [ ] **CAP-09**: The Telegram listener acts only on explicitly allowed senders/channels with defined AND/OR semantics; an empty allowlist denies (OD-16).
- [ ] **CAP-10**: Re-entrant acquisition of `withNonceLock` on the same wallet throws instead of deadlocking, and lock waits are bounded with an alert (OD-17).
- [ ] **CAP-11**: An anti-rug emergency sell is never blocked behind an in-flight buy escalation holding the wallet's nonce lock (priority lane or abortable escalation, OD-17).
- [ ] **CAP-12**: Stopping a chain from the dashboard does not disarm anti-rug monitoring for held positions (H1, `api/routes/chains.ts`) (OD-11).
- [ ] **CAP-13**: Each chain WebSocket has a single owner; a reconnect re-arms every subscriber (DEX listeners and anti-rug) without orphaning or leaking providers (H2) (OD-11).
- [ ] **CAP-14**: A crash between buy submission and the trade-row write cannot leave an untracked position: write-ahead pending-buy intent row + boot reconciliation (schema 7→8) and `synchronous=FULL` (OD-18) — or NOT-A-BUG if the audit proves the window is closed.
- [ ] **CAP-15**: Token approvals respect the fee ceiling and are submitted privately, so sell intent does not leak to the public mempool (or an operator decision records why not).
- [ ] **CAP-16**: The dead `tokenSafety.simulateSell` path (which sends a real `approve`) and related dead approve paths (`maybeApproveForChain`) are removed.
- [ ] **CAP-17**: Every other S0/S1 finding confirmed by the audit is fixed with a RED-then-GREEN real-path test or explicitly escalated to the operator — none is deferred automatically.

### Pre-Move Cleanup (CLEAN)

- [ ] **CLEAN-01**: `.gitattributes` (`* text=auto eol=lf`) + `git add --renormalize .` land in their own commit; Prettier (+ Tailwind plugin) is added and applied in one isolated `fmt:` commit registered in `.git-blame-ignore-revs` (excluding `contracts/`, `.planning/`, `ignition/deployments/`, fork fixtures).
- [ ] **CLEAN-02**: Audited dead code is removed (legacy `tokenSafety` functions, `gasManager`, `pairDiscovery`, dead timer registrars, legacy single-arg lock overloads, `raceTelemetry` if confirmed dead per OD-9, dead imports), and knip reports no unused files, exports, or dependencies.
- [ ] **CLEAN-03**: Both import cycles are removed (anti-rug registry extracted; `alphaDrop → bot → telegramListener` cycle gone), verified by a cycle check.
- [ ] **CLEAN-04**: Environment loading happens exactly once as the first import of every entry point, and `LOG_LEVEL` from `.env` is honored (OD-10, behavior change after reviewing what debug logs emit).
- [ ] **CLEAN-05**: New-token alerts report the real honeypot-check result (no hardcoded `isHoneypot = false` / "Honeypot: No").

### Dependencies (DEPS)

- [ ] **DEPS-01**: `npm audit --omit=dev` reports 0 vulnerabilities (baseline: 11 prod, 1 critical).
- [ ] **DEPS-02**: All runtime dependencies are at latest (ethers 6.17, axios 1.21, express 5.3, ws 8.22, better-sqlite3 13, dotenv 18 with `quiet: true`, pino 10.4, helmet 8.3, …), landed one major per commit; `uuid` is replaced by `crypto.randomUUID()`.
- [ ] **DEPS-03**: `npm ci` succeeds without `--legacy-peer-deps` on Windows and Linux (better-sqlite3 `allowScripts`; ethers `overrides` until DEPS-05 lands).
- [ ] **DEPS-04**: Unused dev dependencies are removed (typechain, chai, mocha types, toolbox extras, etc. as audited), and `packageManager` + `engines` are pinned.
- [ ] **DEPS-05**: `@flashbots/ethers-provider-bundle` is replaced by an in-repo relay client (single ethers instance; dead `getBundleStatsV2` removed), as a late isolated money-path step after characterization, fork-rehearsed, and covered by the live roundtrip (OD-2).
- [ ] **DEPS-06**: better-sqlite3 13 is verified against a copy of the production DB — migrations, WAL, and kill-switch state intact.

### Toolchain (TOOL)

- [ ] **TOOL-01**: Tests run on Vitest 5 with per-project test counts matching the baseline (no silently dropped files).
- [ ] **TOOL-02**: ESLint 10 + typescript-eslint (`strictTypeChecked` target) is configured with an `npm run lint` script; rule policies decided up front (OD-4 inline disables, OD-5 `require-await`).
- [ ] **TOOL-03**: TypeScript 7 `tsc` type-checks the root and dashboard projects; the TypeScript 6 alias (`@typescript/typescript6`) is used only by compiler-API consumers (typescript-eslint, type-coverage, dependency-cruiser), with a tracked note to remove it once typescript-eslint supports TS 7 (issue #12518).
- [ ] **TOOL-04**: tsconfigs are consolidated with `moduleResolution: nodenext`, and `test/` and `scripts/` are type-checked.
- [ ] **TOOL-05**: The bot is ES modules (`"type": "module"`), ts-node is removed, and the bot and scripts run with Node built-in type stripping (`node src/….ts`); a real-Node import smoke passes for every entry point.
- [ ] **TOOL-06**: A single Ctrl+C triggers only stage-1 graceful shutdown under the new start command in both Git Bash and PowerShell.
- [ ] **TOOL-07**: The runbook, `package.json` scripts, and STATE.md operating notes are updated for the new start command in the same plan that changes it.
- [ ] **TOOL-08**: A lefthook pre-commit hook runs format check and lint on staged files.

### Restructure (STRUCT)

- [ ] **STRUCT-01**: `src/` is organized by domain (`infra`, `config`, `chain`, `safety`, `risk`, `submission`, `exit`, `anti-rug`, `execution`, `detection`, `ops`, `api`, `app`), and `src/utils/` no longer exists.
- [ ] **STRUCT-02**: `bot.ts`, `anti-rug/detector.ts`, `exitEngine.ts`, `chainRegistry.ts`, and `preflight.ts` are split into focused modules, and no `src/` file exceeds 400 lines (comments excluded).
- [ ] **STRUCT-03**: The restructure is done as pure-move commits followed by split commits, each with zero decision-trace diff, with every importer and `vi.mock` specifier updated in the same commit and no compatibility shims at old paths.
- [ ] **STRUCT-04**: Only `app/main.ts` starts anything; importing any other module has no side effects beyond declarations (explicit `init()` replaces import-time DB open/migrate, dotenv, and `db.prepare`).
- [ ] **STRUCT-05**: dependency-cruiser enforces in CI the dependency-direction matrix, no cycles, and money-path rules: every signing call goes through the nonce-authority signer module, snipe paths cannot reach public-mempool submission, and `api/` is a leaf.
- [ ] **STRUCT-06**: Functions over the size limit are decomposed; money-path functions (`executeFullSell`, snipe handlers, `executeDeliberateBuy`) only with characterization + RED tests and operator sign-off (OD-12).

### Code Quality (QUAL)

- [ ] **QUAL-01**: ESLint reports zero errors and zero warnings under `strictTypeChecked` across `src/`, `test/`, `scripts/`, and `dashboard/`, with zero inline disables in `src/` (baseline: 350 errors / 22 warnings).
- [ ] **QUAL-02**: No floating or misused promises remain; every former site is classified in the register and fixed per the agreed policy (no `await` added inside event handlers or poll loops in lint commits; listener identity preserved for `.off()`).
- [ ] **QUAL-03**: Contract calls use typed bindings with runtime asserts at money-math boundaries; no `as number` / `as bigint` casts on contract results (OD-20).
- [ ] **QUAL-04**: A single validated config module with read-through accessors is the only reader of `process.env`; no `process.env.X!` assertions outside it.
- [ ] **QUAL-05**: Poll loops cannot overlap (no concurrent `setInterval(async …)` cycles), and a disposables registry owns every timer.
- [ ] **QUAL-06**: type-coverage is ≥ 99% and enforced in CI as a ratchet.
- [ ] **QUAL-07**: `noUncheckedIndexedAccess` is enabled (in its own commit).

### Tests (TEST)

- [ ] **TEST-06**: Tests that mock the mechanism under test (the 30 `vi.mock('ethers')` files and nonce/tx/MEV/exit mechanism mocks) are rewritten as real-path tests, and a CI guard bans `vi.mock` of mechanism-set modules.
- [ ] **TEST-07**: Dead, duplicate, and source-text tests are pruned.
- [ ] **TEST-08**: fast-check property tests cover minOut bounds, fee-ceiling clamp, env parsers, `priceMultiple`, `withNonceLock` interleavings, and at most one buy/sell per `chain:token`.
- [ ] **TEST-09**: A Stryker mutation-score baseline is measured and recorded for the money-math modules (no CI break threshold this milestone).
- [ ] **TEST-10**: Per-glob coverage floors on money paths (buy, exit, anti-rug, nonce, submission) are set from post-rewrite measurement, ratchet-only, and enforced in CI.
- [ ] **TEST-11**: The mainnet-fork suite passes on the new toolchain and Hardhat 3.

### Contracts Tooling (HH)

- [ ] **HH-01**: Contracts tooling is isolated in its own `contracts/` package — first as a pure relocation on Hardhat 2 — with the fork harness and fork-test artifact paths updated.
- [ ] **HH-02**: The contracts package runs Hardhat 3 with only Ignition, Verify, and Keystore plugins, and compiler profiles (`evmVersion`, optimizer) pinned identically in `default` and `production` so build output is deterministic and matches the deploy profile.
- [ ] **HH-03**: Ignition v3 reads the existing ETH `chain-1` deployment record without altering it — verified on a copy, with byte-identical `deployed_addresses.json` and `journal.jsonl` afterward.
- [ ] **HH-04**: The Slither and Mythril CI jobs run against Hardhat 3 build output (or a direct solc compile) and still fail on medium+ findings.
- [ ] **HH-05**: The deployer key is out of `.env` (Hardhat keystore / `configVariable`), and no mainnet network is present in the default config (OD-22).

### ETH Checker Redeploy (HONEY)

- [ ] **HONEY-13**: The hardened `HoneypotChecker` (18-REVIEW-FIX Solidity hardening, latest `@openzeppelin/contracts`) is deployed to ETH mainnet at a new address under a new Ignition deployment id, after a successful Sepolia rehearsal, following the high-stakes-ops protocol (step-by-step verify, address checks); it is Etherscan-verified, Slither/Mythril clean, and the contractual re-audit is complete.
- [ ] **HONEY-14**: The new checker is validated read-only on ETH mainnet (`eth_call` against known-good and known-honeypot tokens, V2 and V3) before the bot switches to it; the committed config default and preflight code-at-address check are updated, and the old address is documented as retired.

### Dashboard (DASH)

- [ ] **DASH-05**: Dashboard dependencies are at latest (React, Vite, Tailwind, lucide, …) with TS 7 typecheck and lint clean.
- [ ] **DASH-06**: Contract tests assert the dashboard API response shapes that the UI consumes.
- [ ] **DASH-07**: Dashboard auth, CORS, and Host handling are hardened: Host allowlist, no LAN bind from an empty `DASHBOARD_HOST`, login rate limiting, and an idempotent emergency-sell.
- [ ] **DASH-08**: The dashboard bundle is served from an absolute path independent of the working directory.

### Repo Hygiene (HYG)

- [ ] **HYG-01**: `.DS_Store` and `.idea/` are untracked and gitignored, and stale root files (`cookies.txt`, `.bot-state.json.bak`) are removed or relocated; sweeps never touch `data/`, `.env*`, or `ignition/deployments/`, and include `.claude/worktrees/agent-*/`.
- [ ] **HYG-02**: `package.json` metadata is correct (no nonexistent `main`; name, version, `engines`, `packageManager`) and `.nvmrc` is present.
- [ ] **HYG-03**: `scripts/` is audited: broken scripts are removed or fixed, and any script that signs transactions goes through the nonce lock and kill-switch or is guarded by the single-instance process lock.

### CI

- [ ] **CI-01**: CI blocks on static gates — format check, lint (`--max-warnings 0`), TS 7 typecheck, knip, dependency-cruiser, type-coverage — each turned blocking only once its baseline is zero, with no allowlists.
- [ ] **CI-02**: CI blocks on test gates — unit, integration, money-path coverage floors, mock-path and mechanism-mock guards, and the real-Node import smoke.
- [ ] **CI-03**: CI covers supply chain — `npm audit --omit=dev` plus `npm audit signatures`, a weekly scheduled prod audit, a one-time full-history gitleaks scan plus a CI secret scan, and Dependabot (grouped, with cooldown).
- [ ] **CI-04**: GitHub Actions are at current versions pinned by commit SHA, workflows use `permissions: contents: read`, and tests run on a Node 24 + 26 matrix (OD-13).

### Docs (DOCS)

- [ ] **DOCS-01**: `docs/ARCHITECTURE.md` documents the module map, dependency-direction rules, and the invariants list (nonce authority, private snipes, fail-closed checker, single anti-rug listener, exit mutex, schema version, persisted kill-switch).
- [ ] **DOCS-02**: The README supports a cold start: setup, an env reference checked against the config schema, start/stop/preflight/pause/resume commands, and an explicit "there is no dry-run mode" warning.
- [ ] **DOCS-03**: ADRs in `docs/adr/` are backfilled for the load-bearing decisions (e.g. D-NONCE-AUTHORITY-ALL, private snipes, fail-closed `HoneypotResult`, D-EVIDENCE-BAR), with rationale moved out of code comments before those comments are removed.
- [ ] **DOCS-04**: The runbook (`docs/operations/`) is current, and CI checks that every `npm run X` it names exists.

### Live Re-Proof (LIVE)

- [ ] **LIVE-01**: A fork rehearsal of the full buy→monitor→sell lifecycle passes on the final entry point and runtime, using the new ETH checker.
- [ ] **LIVE-02**: Re-entry pre-flight passes: fresh shell (no `ALLOW_REAL_MAINNET` / fork / temp `DB_PATH` leftovers), env fingerprint checked, live DB backed up with `db.backup()`, `npm run preflight` green, and the bot boots paused with listeners, anti-rug arming, and the process lock verified before resume; the anti-rug dry-run state is decided (OD-19) and the Node runtime target is confirmed (OD-13).
- [ ] **LIVE-03**: One small real-capital buy→monitor→sell on ETH mainnet completes with on-chain artifacts (tx hashes, DB `amount_out`, pino excerpts) and leaves the wallet flat with no stranded state — after which the bot may return to service.

## Future Requirements

Deferred past v7.0. Tracked but not in this roadmap.

- **HONEY-04**: Deploy `HoneypotChecker.sol` on BSC / Base / Arbitrum (plan 18-08; contractual re-audit). The ETH redeploy portion moved into v7.0 as HONEY-13/14.
- **ANTIRUG-15**: Resolve BSC / Base / Arbitrum V3 anti-rug allowlists (ETH resolved).
- **TOOL-F1**: Collapse to a single TypeScript 7 install once typescript-eslint supports the TS 7 API (TS 7.1+, issue #12518).
- **TEST-F1**: Stryker mutation-score break thresholds in CI.
- **DEPS-F1**: Migrate axios to native `fetch` (OD-3).
- **CHAIN-05**: Fully-dynamic opportunity-quality-weighted capital allocation.
- **DETECT-01**: Mempool / block-0 sniping.
- **OPS-V2-01**: Synthetic-monitor canary-trade watchdog.

## Out of Scope

| Feature | Reason |
|---------|--------|
| BSC / Base / Arbitrum rollout (HONEY-04, ANTIRUG-15) | Lands next milestone on the cleaned codebase + Hardhat 3; chains stay fail-closed |
| New trading capabilities (dynamic allocation, mempool sniping, canary watchdog) | This milestone is audit + cleanup; no new behavior beyond decided fixes |
| Swapping ethers for viem | Rewrites every money path mid-cleanup; no quality gain worth the risk |
| Dashboard framework rewrite | Upgrade in place; rewrite adds risk without audit value |
| ORM / storage swap, DI containers, repository layers, Result libraries | Abstraction churn, not cleanup |
| Big-bang rewrite | Restructure is incremental pure moves under characterization |
| Global coverage-% targets | Per-glob money-path floors set from measurement instead |
| Reaching lint-zero via `eslint-disable` / `as any` | Defeats the gate; zero inline disables in `src/` |
| Replacing `withNonceLock` with ethers `NonceManager` | Established project decision (Phase 21.2) |
| Booting `src/bot.ts` to smoke-test | No dry-run mode exists; `npm run preflight` + import smoke only, live boot only at the LIVE gate |

## Traceability

Which phases cover which requirements. Populated during roadmap creation (2026-11-06). Revised the same day to 11 phases (22–32) at operator request, with the same scope plus AUDIT-07. Each requirement maps to exactly one phase; see [ROADMAP.md](ROADMAP.md) for goals, waves, and success criteria.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SAFE-01 | Phase 22 | Pending |
| SAFE-02 | Phase 22 | Pending |
| SAFE-03 | Phase 22 | Pending |
| SAFE-04 | Phase 22 | Pending |
| SAFE-05 | Phase 22 | Complete |
| SAFE-06 | Phase 22 | Pending |
| SAFE-07 | Phase 22 | Pending |
| AUDIT-01 | Phase 22 | Pending |
| AUDIT-02 | Phase 23 | Pending |
| AUDIT-03 | Phase 22 | Pending |
| AUDIT-04 | Phase 22 | Pending |
| AUDIT-05 | Phase 22 | Pending |
| AUDIT-06 | Phase 23 | Pending |
| AUDIT-07 | Phase 29 | Pending |
| CHAR-01 | Phase 23 | Pending |
| CHAR-02 | Phase 23 | Pending |
| CHAR-03 | Phase 23 | Pending |
| CHAR-04 | Phase 23 | Pending |
| CHAR-05 | Phase 23 | Pending |
| CHAR-06 | Phase 23 | Pending |
| CAP-01 | Phase 24 | Pending |
| CAP-02 | Phase 24 | Pending |
| CAP-03 | Phase 24 | Pending |
| CAP-04 | Phase 24 | Pending |
| CAP-05 | Phase 24 | Pending |
| CAP-06 | Phase 24 | Pending |
| CAP-07 | Phase 24 | Pending |
| CAP-08 | Phase 24 | Pending |
| CAP-09 | Phase 24 | Pending |
| CAP-10 | Phase 24 | Pending |
| CAP-11 | Phase 24 | Pending |
| CAP-12 | Phase 24 | Pending |
| CAP-13 | Phase 24 | Pending |
| CAP-14 | Phase 24 | Pending |
| CAP-15 | Phase 24 | Pending |
| CAP-16 | Phase 24 | Pending |
| CAP-17 | Phase 24 | Pending |
| CLEAN-01 | Phase 25 | Pending |
| CLEAN-02 | Phase 25 | Pending |
| CLEAN-03 | Phase 25 | Pending |
| CLEAN-04 | Phase 25 | Pending |
| CLEAN-05 | Phase 25 | Pending |
| DEPS-01 | Phase 25 | Pending |
| DEPS-02 | Phase 25 | Pending |
| DEPS-03 | Phase 25 | Pending |
| DEPS-04 | Phase 25 | Pending |
| DEPS-05 | Phase 29 | Pending |
| DEPS-06 | Phase 25 | Pending |
| TOOL-01 | Phase 26 | Pending |
| TOOL-02 | Phase 26 | Pending |
| TOOL-03 | Phase 26 | Pending |
| TOOL-04 | Phase 26 | Pending |
| TOOL-05 | Phase 26 | Pending |
| TOOL-06 | Phase 26 | Pending |
| TOOL-07 | Phase 26 | Pending |
| TOOL-08 | Phase 28 | Pending |
| STRUCT-01 | Phase 27 | Pending |
| STRUCT-02 | Phase 27 | Pending |
| STRUCT-03 | Phase 27 | Pending |
| STRUCT-04 | Phase 27 | Pending |
| STRUCT-05 | Phase 27 | Pending |
| STRUCT-06 | Phase 27 | Pending |
| QUAL-01 | Phase 28 | Pending |
| QUAL-02 | Phase 28 | Pending |
| QUAL-03 | Phase 28 | Pending |
| QUAL-04 | Phase 27 | Pending |
| QUAL-05 | Phase 27 | Pending |
| QUAL-06 | Phase 28 | Pending |
| QUAL-07 | Phase 28 | Pending |
| TEST-06 | Phase 28 | Pending |
| TEST-07 | Phase 28 | Pending |
| TEST-08 | Phase 28 | Pending |
| TEST-09 | Phase 28 | Pending |
| TEST-10 | Phase 28 | Pending |
| TEST-11 | Phase 30 | Pending |
| HH-01 | Phase 25 | Pending |
| HH-02 | Phase 30 | Pending |
| HH-03 | Phase 30 | Pending |
| HH-04 | Phase 30 | Pending |
| HH-05 | Phase 30 | Pending |
| HONEY-13 | Phase 30 | Pending |
| HONEY-14 | Phase 30 | Pending |
| DASH-05 | Phase 29 | Pending |
| DASH-06 | Phase 29 | Pending |
| DASH-07 | Phase 29 | Pending |
| DASH-08 | Phase 29 | Pending |
| HYG-01 | Phase 25 | Pending |
| HYG-02 | Phase 25 | Pending |
| HYG-03 | Phase 29 | Pending |
| CI-01 | Phase 31 | Pending |
| CI-02 | Phase 31 | Pending |
| CI-03 | Phase 31 | Pending |
| CI-04 | Phase 26 | Pending |
| DOCS-01 | Phase 31 | Pending |
| DOCS-02 | Phase 31 | Pending |
| DOCS-03 | Phase 31 | Pending |
| DOCS-04 | Phase 31 | Pending |
| LIVE-01 | Phase 32 | Pending |
| LIVE-02 | Phase 32 | Pending |
| LIVE-03 | Phase 32 | Pending |

**Coverage:**
- v1 requirements: 100 total
- Mapped to phases: 100
- Unmapped: 0 ✓

**Mapping notes:**
- AUDIT-07 was added on 2026-11-06 at operator request. It closes the gap where confirmed S2–S4 findings had no owning requirement (CAP-17 covers only S0/S1).
- SAFE-07 (Phase 22): before-baselines are captured in Phase 22. The same capture script produces the after-baselines at milestone close.
- CI-04 (Phase 26) sits with the toolchain rather than the blocking-gates phase, so the Node 26 matrix builds a green history before the OD-13 runtime decision. TOOL-08 (lefthook, Phase 28) lands once lint reaches zero.

---
*Requirements defined: 2026-11-06*
*Last updated: 2026-11-06 after roadmap revision (AUDIT-07 added; traceability 100/100 mapped to Phases 22–32)*
