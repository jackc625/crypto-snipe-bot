# Project Research Summary

**Project:** crypto-snipe-bot, milestone v7.0 Full Audit & Modernization
**Domain:** Live-proven, multi-chain (ETH live) TypeScript MEV sniper bot that trades real money. Audit, deep restructure, modernization of an existing system. This is not a greenfield build.
**Researched:** 2026-11-06
**Confidence:** HIGH overall. The stack, pitfalls and architecture claims were verified by execution on this machine (Windows 11, Node 24.18, npm 11.16) and by reading code at commit `c110201`. Incident history and a few tooling claims are MEDIUM.

Detail lives in `STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md` (same directory). This file reconciles them. Where they disagree, the resolution here is the recommendation.

---

## Executive Summary

v7.0 is an audit-and-rebuild-the-foundations milestone on a bot that already works with real capital. The bot stays OFF for the whole milestone. Trading behavior changes only by logged operator decision. Experts do this with a strict ordering: protect state first, find the bugs read-only, lock current behavior (bugs included) with characterization tests, fix capital-safety bugs on the current layout, then do behavior-neutral mechanical work (format, dead code, toolchain, restructure) in commits that are provably pure moves. Quality gates (lint, coverage, CI) are turned on only when their baseline reaches zero. The milestone closes with a fork rehearsal and one small real-capital ETH roundtrip.

The recommended approach is dominated by one lesson from the project's own history: a green suite has repeatedly passed money-path bugs because tests mocked the mechanism under test. So the plan puts a real-path test harness (real ethers, fake JSON-RPC transport, real SQLite) ahead of every risky change, requires a RED-proven real-path test before any audit candidate counts as a finding, and treats "lint-zero", "coverage %" and "tests green" as necessary but never sufficient. Toolchain choices that were verified: Node type stripping replaces ts-node (no wrapper process, which also fixes the Windows Ctrl+C problem); TS 7 is used for `tsc` while a TS 6 alias feeds typescript-eslint; Hardhat 3 with only Ignition, Verify and Keystore plugins and pinned solc profiles; all 11 prod `npm audit` vulns clear with minor/patch bumps plus a fresh lockfile.

The key risks, and the mitigations built into the phase order, are: (1) tests touching the live `data/bot.db`, real `.env`, Telegram or key, so test-isolation rails land first; (2) the only copy of the ETH Ignition deployment state is gitignored and exists solely on this laptop, so it is backed up as the very first action; (3) "cleanup" changing concurrency or env-default semantics (floating-promise `await`, `||` to `??`, `require-await` removal), so every such site is triaged as a finding and behavior changes require decision cards; (4) toolchain changes (ESM, Hardhat 3, TS 7, better-sqlite3 13) silently shifting module identity, bytecode or init order, so each is isolated in its own step with a real-Node import smoke. Research has already surfaced roughly 28 unconfirmed audit candidates, about a dozen of them capital-safety class (a landed buy marked failed, fail-open minOut, double-buy race, an anti-rug blind spot caused by the dashboard "stop chain" action). None is confirmed. All are listed below.

---

## Key Findings

### Recommended Stack (STACK.md)

All versions verified against the npm registry and, for the load-bearing claims, by local installation and execution. Prod `npm audit --omit=dev` resolves to 0 vulnerabilities with the proposed manifest.

**Core technologies:**
- **Node 24 floor (`engines >=24.12.0`), 26 LTS in the CI matrix**: type stripping is Stable from 24.12. See the Node decision in Open Operator Decisions.
- **Node built-in type stripping (`node src/bot.ts`)**: replaces ts-node. No runner, no `dist/` staleness footgun, no extra process layer swallowing Ctrl+C. Requires `.ts` import specifiers, `verbatimModuleSyntax`, `erasableSyntaxOnly` (exactly 2 test sites violate it). `tsx` stays a fallback only.
- **TypeScript 7.0.2 for `tsc` plus a TS 6 alias for API consumers** (precise statement below).
- **ethers 6.17.0, axios 1.21.0, express 5.3.0, ws 8.22.1, better-sqlite3 13.0.3, dotenv 18.0.9, pino 10.4.0**: clear all prod vulns. `uuid` removed (replace with `crypto.randomUUID()`, one call site in `api/middleware/auth.ts:7`).
- **better-sqlite3 13 needs `"allowScripts": { "better-sqlite3": false, ... }`**: without it `npm ci` runs `node-gyp rebuild` and fails on this Windows machine. `es5-ext` (protestware postinstall, via gramjs) is denied.
- **Hardhat 3.21.2 with only hardhat-ignition 3.1.9, hardhat-verify 3.1.4, hardhat-keystore 3.1.2.** No toolbox, typechain, chai, gas-reporter or solidity-coverage. Pin `evmVersion: "paris"` and `optimizer: { enabled: false }` in BOTH the `default` and `production` profiles, or the fork suite tests different bytecode than HONEY-04 deploys (HH3 defaults 0.8.28 to cancun, and Ignition builds with an optimizer-on production profile).
- **@openzeppelin/contracts pinned at exactly 5.4.0**: matches the deployed ETH checker build-info and slither's remap. Deliberate exception to "all latest".
- **Vitest 5.1, ESLint 10.14 + typescript-eslint 8.72.1 (`strictTypeChecked` target), Prettier 3.9.10 (+ tailwind plugin), knip 6.44, dependency-cruiser 18.7, type-coverage 2.31, lefthook 2.2, Dependabot with cooldown.** Not husky/lint-staged, Renovate, Biome, osv-scanner, dependency-review-action.
- **`@flashbots/ethers-provider-bundle` 1.0.0 kept for now with `overrides: { ethers: "$ethers" }`.** It is unmaintained (2024-02), its exact peer pin `ethers 6.7.1` is the sole cause of `--legacy-peer-deps`, it loads a second CJS copy of ethers under ESM, and `getBundleStatsV2` (`flashbots.ts:345`) has returned 403 since 2025-06. Replacement is an operator decision (below).

**TypeScript 7 finding, stated precisely.** TS 7.0.2 is production-ready as a type checker and emitter but ships no JS compiler API until 7.1 (7.1.0-beta published 2026-10-20). `typescript-eslint` 8.72.1 declares peer `typescript >=4.8.4 <6.1.0`, and with TS 7 crashes (`reading 'Cjs'`). Upstream issue typescript-eslint #12518 was closed as blocked by #10940. Therefore: install `"typescript": "npm:@typescript/typescript6@^6.0.2"` (resolves 6.0.3, provides `tsc6`; consumed by typescript-eslint, type-coverage, @vitest/eslint-plugin, dependency-cruiser) and `"@typescript/native": "npm:typescript@^7.0.2"` (provides `tsc`; used for the typecheck gate on root and dashboard). Verified locally: TS 7.0.2 compiled a `nodenext` project with `.ts` imports, `erasableSyntaxOnly` and `rewriteRelativeImportExtensions` and the output ran; typescript-eslint 8.72.1 + ESLint 10.14 with `projectService` ran type-aware rules (`no-floating-promises` fired) on the alias with no ERESOLVE. CI must run both `tsc` (7) and type-aware ESLint (on 6), and both must be clean. Collapse to a single TS 7 only when typescript-eslint ships TS 7 support. Do not use `@typescript/native-preview`/`tsgo`. Caveat: the WebStorm language service pointing at TS 6 is LOW confidence, unverified.

### Expected Features (FEATURES.md)

"Features" here are milestone deliverables, not product features.

**Must have (table stakes, the done bar):**
- Findings register with severity, capital-impact class, evidence, and `candidate -> confirmed -> decided -> fixed -> verified` lifecycle (T1); bug-class sweep (T2); operator-decision cards (T3); thresholds/magic-number inventory (T4)
- Characterization (golden-master) tests before any move (T5); real-path harness (X1)
- Capital-safety fixes, each with a RED-then-GREEN real-path test, under D-STOP-THE-LINE (T6)
- Deep restructure by domain, `utils/` dissolved (T7); lint-zero without suppression (T8); formatter in one isolated commit (T9); knip dead-code removal (T10)
- All deps latest (with the OZ exception), 0 prod vulns, no `--legacy-peer-deps`, ts-node gone (T11)
- Mock-the-mechanism test rewrites (T12); money-path per-glob coverage floors (T13); strict CI, zero baseline, no allowlists (T14)
- Dashboard/API audit (T15); scripts + contracts tooling + Hardhat 3 (T16); repo hygiene (T17); architecture doc + README (T18); runbook refresh (T19); fork rehearsal + live ETH roundtrip (T20)

**Should have (differentiators):**
- Structural signing-authority enforcement (X4) and dependency-cruiser boundary rules (X5): makes nonce-authority violations unrepresentable
- fast-check property tests on BigInt math and lock interleavings (X3); typed contract bindings (X7); single validated config, read-through accessors (X8)
- `op`-taxonomy contract test (X9); ADR backfill from comment archaeology (X10)

**Defer or only if time allows:** Stryker mutation break thresholds (baseline measurement at minimum, X2); write-ahead intent row + boot reconciliation (X12, decision-gated, schema 7 to 8); bytecode equivalence (X13); chaos tests (X14); type-coverage gate (X6); supply-chain extras (X11).

**Explicit anti-features (do not do):** big-bang rewrite; swapping ethers for viem; global coverage-% chasing; unreviewed `eslint --fix` on money paths (`prefer-nullish-coalescing` changes `|| 5` to `?? 5`); reaching lint-zero by `eslint-disable`/`as any`; mixing fixes into move commits; DI containers/repository layers/Result libraries; ORM or storage swap; bundling ESM + TS 7 + restructure + all majors; quietly changing thresholds; new trading capability (mempool sniping, dynamic allocation, multi-chain deploy); booting `bot.ts` to smoke test; replacing `withNonceLock` with `NonceManager`; deleting failing tests to get green on upgrades; rewriting the dashboard framework.

### Architecture Approach (ARCHITECTURE.md)

The current state, verified: `bot.ts` (2,361 lines, ~10 responsibilities), `detector.ts` (2,295), `exitEngine.ts` (2,045), `chainRegistry.ts` (1,089), `preflight.ts` (1,011, which also holds buy-path affordability logic), 2 real import cycles, 7 modules that do real work at import time (DB open + migrate, dotenv, Telegram URL, risk `db.prepare`), 18 functions over 100 code lines. `.planning/codebase/` maps are obsolete and must not be relied on. Target: layered domains with a composition root.

**Major components (target layout under `src/`):**
1. `infra/`: logger, DB (connection/migrations/per-table statements), providers, abis, notifier, broadcast, `concurrency/{nonceAuthority,positionLocks,timerRegistry}`. Process-wide singletons, leaf layer
2. `config/` + `chain/`: single dotenv load and validation (first import of every entry), chain types/templates/allowlists/registry/context
3. `safety/`, `risk/`, `submission/` (txManager, `mev/*`, receiptDecoder): pre-buy gates, affordability/wallet floor extracted from `preflight`, tx submission shared by buy and sell
4. `exit/` (monitor, worker, fullSell, partialSell, publicFallback, sellTx, pricing, strategyMath) and `anti-rug/` (registry, listener, wsLifecycle, backfill, dispatch, signals, evaluate). `exit` imports only `anti-rug/registry`, which breaks cycle #1
5. `execution/` (snipeV2, snipeV3, deliberateBuy, submitBuy, armPosition), `detection/`, `ops/preflight`, `api/`, and `app/` (composition root; `main.ts` is the only file that starts anything, which makes the graph importable without booting)

**Key patterns:** pure-move commits then separate split commits, never fixes mixed in; state modules own state and behavior modules import them; static imports for safety-critical edges (extract a leaf, never runtime-register a callback); no compatibility shims at old paths (shims defeat `vi.mock` identity); explicit init over import-time side effects, staged (keep import-time behavior exactly during the move, convert later in a characterized step); env via read-through accessors, not a frozen boot-time object (several reads are per-call on purpose). Dependency matrix and money-path rules (R-SIGN, R-PRIVATE-SNIPE, R-API-LEAF, R-NO-CYCLES, R-ENV) are enforced by dependency-cruiser in CI.

### Critical Pitfalls (PITFALLS.md)

1. **Tests reach production state.** `vitest.config.ts:2-4` loads the real `.env`; `db.ts:9,17` opens and migrates `data/bot.db` at import; 44 files mock `utils/db` by relative-path string and silently stop mocking after a move. Prevent: dummy test env, prod-DB tripwire, network deny, vi.mock-path-resolution gate. Land first.
2. **Duplicate module instances break mutual exclusion.** `withNonceLock`, sell lock, anti-rug registry are module singletons. Windows path-case aliasing creates two instances (verified on Node 24.18); there is no single-instance process lock, so two bot processes can trade one wallet. Prevent: `Symbol.for` singleton guards that throw on duplicate load, a boot-time single-instance lock, `forceConsistentCasingInFileNames` everywhere.
3. **"Fixing" floating promises changes concurrency.** `await` in listeners serializes snipes and re-queries block ranges; wrapping `.on(...)` listeners breaks `.off()` by identity (leaks `'block'` listeners, double-fires anti-rug exits); `.catch(log)` on startup promises is fail-open. Prevent: classify every site in the register first; fix at the handler definition, never at registration; `void p.catch(escalate)`; ordering and `listenerCount` tests first.
4. **Mechanical lint/type fixes delete load-bearing code or lie about types.** `||` to `??` (empty `DASHBOARD_HOST` binds `::` and exposes emergency-sell to the LAN; `Number(x) ?? 120` yields NaN and disables the stale check); `as number` on `decimals()` (is `bigint` in ethers v6); `require-await` removal moves throws out of `.catch`; Express error middleware needs arity 4; positional listener params. Prevent: typed env module, config-level rule policy decided up front, characterization of the env matrix.
5. **Toolchain steps shift module identity, init order, bytecode, or deployment records.** ESM breaks gramjs subpaths and loads two ethers copies; verbatimModuleSyntax stops eliding dead side-effecting imports; Hardhat 3 changes solc defaults and artifact format; `ignition migrate` can mutate the deployment record. And the green suite does not catch ESM runtime breaks (Vitest shims `require`/`__dirname`), so a real-Node import smoke is mandatory.

Also high-impact: re-entry state hazards (relative `DB_PATH` silently creates a fresh DB; leftover shell env such as `ALLOW_REAL_MAINNET=1` wins over `.env`; no `version > CURRENT` guard on the DB; raw-copying `bot.db` without `-wal`), and false comfort from coverage floors measured over mock-heavy tests.

---

## Audit Candidates Already Surfaced

All entries are **UNCONFIRMED**. Each needs a RED-proven real-path test (or a fork script / on-chain artifact) before it becomes a finding, and each capital-safety row falls under D-STOP-THE-LINE (re-surface to the operator; never auto-defer). Line references are as read at `c110201`; the two sources occasionally cite slightly different ranges for the same code (marked `~`), so planners must re-measure. "Capital" means funds could be lost, stranded, overspent, or exposed.

### A. Capital-safety candidates (verify first)

| # | Candidate | file:line | Suspected severity | Source | Status |
|---|-----------|-----------|--------------------|--------|--------|
| 1 | **Landed buy marked failed.** One try/catch wraps `submitBuyTx` plus post-submit bookkeeping; an RPC error in `balanceOf` after inclusion runs fail-clean, sets trade `failed`, alerts "TX failed", leaves the position with no exit monitor or anti-rug. V3 has the same shape. Related: `originalTokenAmount` read from a possibly stale node (E1) | `bot.ts:1086-1191` (V3 `1431-1514`; stale read `1150-1151`) | Capital: STRAND (S0/S1) | FEATURES E2/E1 | UNCONFIRMED |
| 2 | **Buy minOut fails open.** Quote failure logs "defaulting to 0" and the buy still goes out unprotected; `BigInt(slippage)` throws on fractional percent and the catch sets `minOut=0n` | `bot.ts:1048-1056` (V2), `bot.ts:1365-1377` (V3) | Capital: LOSS (S1) | FEATURES B3/A3; PITFALLS | UNCONFIRMED |
| 3 | **Private sells use `amountOutMin = 0`** (V2 and V3, full and partial). Possibly deliberate; behavior-change decision. This row also covers the separately-listed V2 sell `amountOutMin=0` (PITFALLS cites `buildV2SellTx` at `~:366`) | `exitEngine.ts:362-364` (V2), `388-393` (V3); `~:366` | Capital: LOSS (S1) | FEATURES B1; PITFALLS 9/13 | UNCONFIRMED |
| 4 | **Double-buy TOCTOU.** `isTokenSniped` is a DB check, row written only after submit many awaits later; WS+HTTP overlap, V2+V3 pools for one token, or Telegram+factory can both pass | `bot.ts:881`, `bot.ts:1211` | Capital: LOSS/OVERSPEND (S1) | FEATURES F4 | UNCONFIRMED |
| 5 | **No `unhandledRejection` handler; un-awaited handler calls.** Node default crashes the process, taking exit monitors and anti-rug down for every position. Policy is an operator decision | `bot.ts:1582-1584`, `1644`, `1669`, `2360` (no handler anywhere in `src/`) | Capital: STRAND (S1) | FEATURES F1; ARCH H6; PITFALLS 2 | UNCONFIRMED |
| 6 | **NaN env parsing disables risk limits** (`MAX_OPEN_POSITIONS=ten` gives NaN, `open >= NaN` false, fail-open); same defaults parsed in 3 places so dashboard may show other limits than enforced; 5 differing env parsers | `riskManager.ts:28-31`, `config.ts:300-302`, `api/routes/risk.ts:80-82`, `api/routes/chains.ts:88-90` | Capital: EXPOSURE (S1) | FEATURES A4/A5 | UNCONFIRMED |
| 7 | **Exit monitor silent non-start.** If initial `queryPrice` is null, `startExitMonitor` logs and returns; position held with no routine exit monitor and no retry | `exitEngine.ts:1869-1873` | Capital: STRAND (S1) | FEATURES E4 | UNCONFIRMED |
| 8 | **Price probe ignores token decimals.** Uses `buyAmountWei` (ETH-wei) as token `amountIn`; quote reverts (null, cycle skipped forever) or dust (0). `entryPrice=0` gives `Infinity`/`NaN` `priceMultiple`, so trailing and stop-loss comparisons never fire | `exitEngine.ts:1708`, `1714`, `1869`; `queryPrice 315-345` | Capital: STRAND (S1) | FEATURES A1/A2 | UNCONFIRMED |
| 9 | **Telegram whitelist bypass.** `senderAllowed OR channelAllowed` with empty set = allow-all; configuring only senders leaves `channelAllowed=true` for everything; both empty (default) lets any visible message feed the buy pipeline | `telegramListener.ts:74-79` | Capital: EXPOSURE (S1) | FEATURES K1 | UNCONFIRMED |
| 10 | **Nonce lock re-entrancy deadlock / no timeout.** `withNonceLock` is not reentrant; nested same-wallet acquisition deadlocks forever; 36 call sites to audit | `utils/nonceAuthority.ts:61-75` | Capital: STRAND (S1) | FEATURES D1; PITFALLS 13 | UNCONFIRMED |
| 11 | **Nonce lock priority inversion / head-of-line blocking.** Anti-rug emergency sell queues behind an in-flight multi-block private buy escalation holding the wallet lock. Needs operator decision (priority lane or abortable escalation) | `utils/nonceAuthority.ts:61-75` | Capital: STRAND (S1) | FEATURES D2 | UNCONFIRMED |
| 12 | **H1: dashboard "stop chain" disarms anti-rug.** `ctx.wsProvider.removeAllListeners()` removes the anti-rug rug-log subscription that shares the provider; `/start` re-runs only `startDexListener` | `api/routes/chains.ts:139-141` | Capital: STRAND (S1) | ARCH H1 | UNCONFIRMED |
| 13 | **H2: three reconnect loops mutate `ctx.wsProvider`** (per-DEX reconnect in bot.ts, anti-rug `handleWsClose`, `onRestart`); one reconnect can destroy another's subscription or orphan a provider; N DEXes means N competing close handlers | `bot.ts:1550-1605`; `detector.ts ~918-926` | Capital: STRAND (S1) | ARCH H2; FEATURES F3 | UNCONFIRMED |
| 14 | **Crash window between buy hash and trade row;** `synchronous=NORMAL` under WAL can lose last commits on OS crash. Candidate fix: write-ahead intent row + boot reconciliation (schema 7 to 8); `synchronous=FULL` is a decision | `bot.ts:1100` to `1127`; `db.ts:22` | Capital: STRAND (S1) | FEATURES E3/X12 | UNCONFIRMED |
| 15 | **Approvals bypass fee ceiling and go to the public mempool,** leaking sell intent before the private sell; same class as the CR-01 fee-ceiling bypass | `exitEngine.ts:413-424` (`ensureApproval`), `541-546` | Capital: OVERSPEND/EXPOSURE (S2) | FEATURES C1/H2 | UNCONFIRMED |
| 16 | **`tokenSafety.simulateSell` dead code sends a real `approve`** against legacy `CONFIG.routerAddress`; still imported. Delete after audit (same class as the deleted `hasHighTransferTax`). Related dead `maybeApproveForChain` | `utils/tokenSafety.ts:269-300`; import `bot.ts:17`; `bot.ts:222-229` | Capital: EXPOSURE (S2 to delete) | FEATURES C2/C3 | UNCONFIRMED |
| 17 | **Duplicate-module-instance risk for `withNonceLock`** (Windows path casing, shims that re-declare, ESM/CJS dual load); also sell lock, ExitWorker, anti-rug registry | `nonceAuthority.ts:43`; `exitManager.ts:14,53,104`; `exitEngine.ts:1421`; `detector.ts:192,197,247` | Capital: LOSS (nonce collision), latent S1 | PITFALLS 4 | UNCONFIRMED (path-case duplication verified for a toy module; real modules not yet tested) |
| 18 | **No single-instance process lock.** Two bot processes (e.g. Ctrl+C swallowed by npx) can trade one wallet and bypass the in-process lock | no guard in `src/` | Capital: LOSS, S1 | PITFALLS 4/14 | UNCONFIRMED |
| 19 | **Tests load real `.env` and open/migrate real `data/bot.db`** (and can send real Telegram alerts). Likely checkable immediately by mtime of `data/bot.db(-wal)` after `npm test` | `vitest.config.ts:2-4`; `db.ts:9,17,235`; `test/unit/db.test.ts`, `test/unit/bot/twoStageSigint.test.ts` | Capital-adjacent (kill-switch/dedup/resume state), S1 | ARCH H4; PITFALLS 1 | UNCONFIRMED |

### B. Other correctness, robustness and design candidates

| # | Candidate | file:line | Suspected severity | Source | Status |
|---|-----------|-----------|--------------------|--------|--------|
| 20 | **WS reconnect (DEX listeners):** leaked old providers never `destroy()`ed, no `PairCreated` backfill for the gap, no heartbeat (half-open socket dies silently), `while(true)` ignores shutdown, untyped `(ws.websocket as any)` | `bot.ts:1549-1618` | S2 opportunity (S1 if it breaks anti-rug's consumer, see #13) | FEATURES F3 | UNCONFIRMED |
| 21 | **`setInterval(async)` overlap:** cycles run concurrently and mutate shared state; HTTP poll can process the same block range twice | `exitEngine.ts:1906,2007`; `bot.ts:1636,1660,1740,1774`; `detector.ts:1261`; `api/server.ts:186` | S2 | FEATURES F2; PITFALLS | UNCONFIRMED |
| 22 | **Base fee possibly doubled:** `baseFeeWei = maxFeePerGas - maxPriorityFeePerGas` is ~2x real base fee in ethers v6; affects affordability/ceiling math | `utils/mevStrategies/flashbots.ts:167-171`; `passthrough.ts:63-65` | S2 verify | FEATURES H1 | UNCONFIRMED |
| 23 | **`LOG_LEVEL` from `.env` never applied** (logger built before `dotenv.config()`); fixing is a behavior change | `config.ts:2-4`; `utils/logger.ts:7` | S3 behavior decision | ARCH H3; PITFALLS 5 | UNCONFIRMED (code-order reading) |
| 24 | **Hardcoded `isHoneypot = false`** printed as "Honeypot: No" in every New-Token alert | `bot.ts:984,1000,1319` | S3 (false reassurance) | PITFALLS 9 | UNCONFIRMED |
| 25 | **No newer-schema guard:** `user_version = 7` written unconditionally; an older build silently downgrades a newer DB, next boot re-runs `ALTER TABLE ADD COLUMN` | `utils/db.ts:232` | S2 | PITFALLS 9/14 | UNCONFIRMED |
| 26 | **`getBundleStatsV2` returns 403 since 2025-06-09** (dead telemetry; remove, reconcile by receipts) | `utils/mevStrategies/flashbots.ts:345` | S3 | STACK P-6 | UNCONFIRMED (WEB, cross-verified) |
| 27 | **Broken scripts importing deleted artifacts** (`UniswapV2Router02.sol`, `IWETH.sol`); knip will flag | `scripts/addLiquidity.ts`, `scripts/deploySepoliaTest.ts` | S4 hygiene | STACK | UNCONFIRMED |
| 28 | **Test DB helper hand-duplicates schema at `user_version=4`** vs prod 7 (no `lp_baseline`, `chain_state`, `pause_state`); migration tests "mirror" db.ts instead of running it | `test/helpers/testDb.ts:11`; `test/unit/db/*Migration.test.ts` | S2 test drift | ARCH H5; PITFALLS 9 | UNCONFIRMED |

### C. Lower-priority candidates (triage in the sweep; dedupe against above)

Stale buy deadline captured outside the tx-builder closure on multi-block escalation (`bot.ts:1043`; B4); private V2 sell uses non-fee-on-transfer `swapExactTokensForETH` while public fallback uses the supporting variant (`exitEngine.ts:363` vs `:553`; B2); stale-quote approve-then-swap during drain (`exitEngine.ts:524-560`; B5); `.wait()` error classification for `TRANSACTION_REPLACED` reason `repriced` (E6); no reorg handling (E5); `getTradeIdForPendingToken` ambiguity and non-transactional multi-statement state changes (`bot.ts:1127-1154`; G1); dashboard emergency-sell runs inside the HTTP request, no idempotency (`api/routes/controls.ts:121-222`; J3); same-origin check derived from `Host` header, no login rate limit, key-length leak (J1/J2); Telegram regex/cooldown/unbounded Set (K2); symbol/name flows into Markdown and dashboard (J4); anti-rug 7-day dry-run default is time-based (L1); out-of-process signing scripts bypass lock and kill-switch (`scripts/recover-sell-ladys.ts`, `scripts/deliberate-buy.ts`; D4); raw key on module-level `CONFIG` and log-redaction coverage (I1); `process.env.ALCHEMY_URL!` assertions and two sources of truth for chain addresses (I2); `__dirname`-relative `package.json` read at import (`api/routes/health.ts:15`); inline `require('./utils/db')` in shutdown (`bot.ts:2344`); legacy single-arg lock overloads keyed `token` not `chain:token` (`exitManager.ts:16-31`); `raceTelemetry.ts` production-dead; unreachable `gasManager.getGasOptions`, `pairDiscovery.ts`; relative `DB_PATH` silently creates a fresh DB; the `--legacy-peer-deps` cause (flashbots peer pin).

---

## Open Operator Decisions

Items the research cannot decide. Each needs an operator ruling before the phase that depends on it. Recommendations are given so the roadmapper can propose a default; undecided behavior-changing items default to "keep current behavior" (the milestone contract), except S0/S1 capital findings, which cannot sit on the default and block the re-entry gate.

| # | Decision | Needed by | Research recommendation |
|---|----------|-----------|-------------------------|
| OD-1 | **OpenZeppelin pinned at 5.4.0** as the one exception to all-latest (contract source out of scope; bump belongs to HONEY-04 with re-audit) | Phase 6 | Accept the pin. Bumping changes what the fork suite tests versus what is deployed |
| OD-2 | **Flashbots library replacement** (in-repo `FlashbotsRelayClient` reusing `rawSendBundle`) versus keep + `overrides` | Before Phase 13 | Keep with `overrides` through restructure. Decide replacement as one late, isolated money-path step after characterization, with fork + live re-proof. Remove `getBundleStatsV2` regardless |
| OD-3 | **axios to native `fetch`** | Phase 6 | Defer; ship axios 1.21 now. Optionally migrate non-money sites (notifier, CLIs) later with characterization |
| OD-4 | **Inline `eslint-disable` with finding ID vs zero-allowlist** | Before Phase 9 | Zero inline disables in `src/` (`noInlineConfig` + `--report-unused-disable-directives`). Where a rule collides with a justified fail-closed branch (`no-unnecessary-condition`), resolve at config level with a recorded rationale, never by deleting guards |
| OD-5 | **`require-await` policy** | Before Phase 9 | Disable at config level with documented rationale ("async marks the rejection channel"); never strip `async` from functions whose callers use `.catch` |
| OD-6 | **Floating-promise / unhandled-rejection policy** | Phase 4 | Contain per handler with `void p.catch(escalate)` (escalation fail-closed for startup/listener/arming), plus a global `unhandledRejection` handler that hard-alerts and triggers controlled shutdown. Never disable `no-floating-promises`. No `await` added inside event handlers or poll loops in lint commits |
| OD-7 | **ESM for the bot** | Phase 7 | Yes, as its own isolated phase before the restructure. See reconciliation (a) |
| OD-8 | **Dashboard bundle scope** | Phase 12 | Upgrade deps in place (React 19.3, Vite 8, Tailwind 4, lucide 1.x with renamed icons); audit auth and emergency-sell; API response contract tests; serve `dashboard/dist` from an absolute path; no framework rewrite |
| OD-9 | **`raceTelemetry.ts` keep or delete** | Phase 5 | Delete if the audit confirms it is production-dead (referenced only by one unit test) |
| OD-10 | **Honor `LOG_LEVEL` from `.env`** | Phase 4 or 5 | Fix, as an explicit behavior change, after reviewing what `debug` logs would emit (secrets, volume) |
| OD-11 | **H1 and H2 fix** (single per-chain WS owner that notifies subscribers) | Phase 4 | Re-surface immediately; D-STOP-THE-LINE. Fix on the current layout, before any move |
| OD-12 | **Function decomposition of money-path functions** (`executeFullSell`, snipe handlers, `executeDeliberateBuy`) | Phase 9 | Decompose non-money functions freely; money-path ones only with characterization + RED tests + sign-off. If declined, scope the `max-lines-per-function` gate away from them via config override |
| OD-13 | **Node 26 vs 24 target** | End of Phase 7 | Build on 24 (the live-proven 24.18), CI matrix 24 and 26, `@types/node ^24`. Flip local/prod to 26 only just before the fork rehearsal, if the 26 matrix has been green through Phase 13, so the single live roundtrip validates the final runtime. Otherwise stay on 24 |
| OD-14 | **Private-sell minOut** (A keep 0, B bounded via `computePublicMinOut`, C bounded for routine and 0 for anti-rug only) | Phase 4 | Option C, after fork replay of LADYS + rug fixtures |
| OD-15 | **Buy minOut on quote failure** | Phase 4 | Fail closed (skip the snipe) |
| OD-16 | **Telegram whitelist default and AND/OR semantics** | Phase 4 | Fail closed by default; explicit semantics |
| OD-17 | **Nonce-lock head-of-line policy** (priority lane or abortable escalation) and **reentrancy detection (throw vs deadlock)** | Phase 4 | Enforce `assertNonceLockHeld` via AsyncLocalStorage; priority lane for anti-rug |
| OD-18 | **Write-ahead intent row and `synchronous=FULL`** (schema 7 to 8) | Phase 4 | `synchronous=FULL` (negligible cost); intent row only if the audit confirms the crash window. No other migration this milestone |
| OD-19 | **Anti-rug 7-day dry-run behavior at re-entry** (measured from persisted timestamp or boot) | Phase 14 | Confirm, then record as an explicit re-entry decision |
| OD-20 | **Typed contract bindings approach** (STACK drops typechain; FEATURES wants generated or typed ABIs) | Phase 9 | Typed ABI wrappers in `infra/abis` with runtime asserts at money-math boundaries; no `as number`/`as bigint` on Contract results. Mechanism needs a short research spike |
| OD-21 | **Track `ignition/deployments/` in git** (public data) | Phase 1 | Yes, after the backup |
| OD-22 | **Keep `DEPLOY_PRIVATE_KEY` out of `.env`** (keystore / `configVariable`; remove mainnet networks from default config) | Phase 11 | Yes |
| OD-23 | **Strictness target** (`strictTypeChecked`, `noUncheckedIndexedAccess`, `max-lines 400`, type-coverage >= 99) and final coverage floors | Phase 9 and 10 | `strictTypeChecked` as target; `noUncheckedIndexedAccess` as its own commit; floors set from post-rewrite measurement, ratchet-only |
| OD-24 | **Stryker mutation testing scope** (baseline vs break thresholds) | Phase 10 | Measure a baseline on money-math modules; break thresholds only if time allows |
| OD-25 | **Risk defaults** (max exposure 10 ETH vs 0.01 ETH snipe size) and other inventory thresholds | Phase 2 | Surface in the thresholds inventory; unchanged unless decided |

---

## Implications for Roadmap

### Reconciliation of the researchers' disagreements

**(a) ESM conversion of the bot.** Positions: STACK says Hardhat 3 forces `"type": "module"` at the repo root unless contracts are isolated, and moves the whole repo to ESM. ARCHITECTURE says isolate contracts in a sub-package AND convert the bot (do it before the restructure). PITFALLS says ESM last and only if forced, and never in the same phase as the restructure or HH3.

**Recommendation:** isolate contracts into their own package FIRST (a pure relocation on Hardhat 2, mirroring the existing `dashboard/` precedent), so that Hardhat 3 is decoupled from the bot's module system and ESM becomes a choice, not a coupling. Then convert the bot to ESM as its own isolated phase BEFORE the restructure, not last. Reasoning: (1) every relative specifier must gain a `.ts` extension for Node type stripping, which is the chosen runner, so the ESM codemod and the runner switch are one change; doing it before the restructure means specifiers are rewritten once on the known layout under the characterization net, instead of twice (restructure then ESM). (2) It aligns prod with the Vitest/Vite ESM runtime, which today masks import-order differences. (3) PITFALLS' real concern is blast radius, and the isolation and the phase boundary address it: it is separate from HH3, separate from the restructure, gated by a real-Node import smoke (Vitest shims `require`/`__dirname` and will not catch breakage), requires the dead side-effecting imports to be deleted beforehand (`verbatimModuleSyntax` stops eliding them), and requires the static cycle broken. (4) Fallback: if the ESM phase hits something unforeseen, the bot can stay CJS and Hardhat 3 still works inside the isolated contracts package. Consequence of the isolation to note: STACK's "artifact paths unchanged" holds only inside the package, so the five fork-test files hard-coding `artifacts/contracts/...` and the fork harness spawn path must be updated in the relocation phase.

**(b) Formatter reformat commit placement.** All three agree it must precede the restructure so moves are diffable. Resolved placement: after `.gitattributes` (`* text=auto eol=lf`) + `git add --renormalize .` as its own commit (the working tree has 207 CRLF files, `core.autocrlf=true`, no `.gitattributes`), then one isolated `fmt:` Prettier commit registered in `.git-blame-ignore-revs`, in Phase 5, AFTER the characterization net exists (so "byte-identical trace before and after" is checkable) and AFTER capital fixes (so those reviewed diffs are not drowned) but BEFORE the ESM codemod and the restructure. Exclude `contracts/`, `.planning/`, `ignition/deployments/`, `test/fork/fixtures/`. Never run `eslint --fix` in the same commit.

**(c) Lint burn-down before vs after restructure.** Split it. Before the moves (Phase 5): delete audited dead code (~60 of 350 errors vanish), fix `no-unused-vars` (with the `^_` ignore patterns), `no-unnecessary-type-assertion`, `no-require-imports`. Capital-relevant promise sites (the unhandled-rejection policy, handler containment, double-buy guard) are triaged as findings and fixed in Phase 4 on the current layout, not as lint chores. After the moves (Phase 9): the 213 `no-unsafe-*` (fixed at the source with typed ABI wrappers, not casts) and remaining promise/`strict-boolean-expressions` work, per small extracted module; then the lint gate flips blocking. Rationale: fixing `no-unsafe-*` inside 2,000-line files before splitting makes fix diffs and move diffs touch the same lines. The lint CONFIG lands early in Phase 7 but stays non-blocking until zero.

**(d) Ignition deployment-state backup.** It is the very first action of the milestone, before `npm install`, any Hardhat invocation, any hygiene sweep, `git clean`, or relocation. Reason (STACK, verified by `git ls-files`): `ignition/deployments/*/journal.jsonl` and the per-future `artifacts/` are gitignored (the root `artifacts/` pattern also matches `ignition/deployments/chain-*/artifacts/`), so the only copy of the ETH checker deployment state is on this laptop. Procedure: copy `ignition/deployments/` to a location outside the repo with a hash manifest; verify; THEN decide to track it in git (recommended, data is public). Back up `data/` at the same time (bot is off, so copy `bot.db` + `-wal` + `-shm` together, or checkpoint then `db.backup()`; never a raw `bot.db`-only copy, never delete the `-wal`/`-shm`). Flag: PITFALLS' recovery steps (`git checkout -- ignition/deployments/chain-1`) assume the record is committed. For the journal and per-future artifacts it is not, so git cannot restore them. Any Ignition v3 test (`status chain-1`, any `ignition migrate`) runs on a COPY only. HONEY-04 must use a new deployment id (the current checker source already differs from the deployed bytecode).

### Other reconciliations

- **Vulnerability/dependency bumps vs characterization-first.** STACK wants the vuln cleanup first (independent of everything); ARCHITECTURE wants the behavior net first. Because the bot is OFF and the dashboard is local-only, there is no urgency to ship the critical `proxy-addr` fix early. Resolution: characterization first (Phase 3), runtime dependency bumps after the capital fixes (Phase 6), one major per commit.
- **Vitest 5 timing.** Write characterization tests against the current Vitest (core API only), then upgrade to Vitest 5 in Phase 7 with a per-project test-count diff to catch silently dropped files.
- **Runner.** STACK/PITFALLS differ on type stripping vs `tsx` vs compiled `dist/`; FEATURES suggested `dist/`. Choose Node type stripping (no build artifact, no stale `dist/`, no wrapper process). Boot smoke under the exact production command, from the repo root and from another cwd (it must refuse a fresh DB).
- **Contracts toolchain.** STACK proposed one root ESM repo with `paths.sources` for fixtures; ARCHITECTURE/PITFALLS propose a sub-package. Use the sub-package, with the `paths.sources` array (replacing the removed `subtask` override) inside it.

### Suggested phase structure (14 phases; roadmapper may merge adjacent small ones)

**Phase 1: Safety Rails & Baseline (first action: back up Ignition state and `data/`)**
- Rationale: nothing else may run until state is protected and tests cannot touch prod.
- Delivers: Ignition + `data/` backup with hash manifest (and decision to track Ignition); test isolation (dummy `.env` via `setupFiles`, `DB_PATH` temp, prod-DB tripwire that throws when `VITEST` and path is real, outbound network deny, notifier refuses to send under `VITEST`); `Symbol.for` singleton guards on lock modules; single-instance process lock; `forceConsistentCasingInFileNames` in all tsconfigs; `vi.mock` path-resolution gate; baselines captured (`npm ls`, `npm audit`, ESLint counts by rule/file, per-project test counts, coverage file list, `data/bot.db` checksum); `DB_PATH` resolved absolute and refuse-to-create in production; `version > CURRENT` DB guard; boot config fingerprint. Lint/format configs may be authored but non-blocking.
- Addresses: T17 (partly), mitigation of candidates 17, 18, 19, 25. Avoids: Pitfalls 1, 4, 14.

**Phase 2: Adversarial Audit (read-only, can overlap Phase 1)**
- Rationale: the register tells every later phase what to characterize and what to fix. Auditors read code, not prior VERIFICATION docs (anti-anchoring).
- Delivers: `AUDIT-FINDINGS.md` (schema per FEATURES 2.1, with a mandatory "sibling sites checked" field), `OPERATOR-DECISIONS.md` decision cards, thresholds/magic-number inventory, the audit-candidates list above triaged to `confirmed`/`NOT-A-BUG` via RED tests; commit taxonomy (`refactor:`/`lint:`/`fmt:`/`deps:` must show zero decision-trace diff; `behavior:` must cite an OD-ID). Operator rules on OD-6, 11, 14-18 batched per area.
- Addresses: T1-T4, T15 (audit half), T16 (audit half). Avoids: Pitfall 13.

**Phase 3: Real-Path Harness & Characterization (C0-C11)**
- Rationale: the only thing that proves a 2,000-line split or an ethers/TS/Vitest major did not change calldata or exit decisions. Locks current behavior including bugs, tagged `KEEP` or `SUSPECT(<finding-id>)`.
- Delivers: X1 harness (real ethers, fake JSON-RPC transport, real in-memory SQLite, fixed clock; mock only logger, notifier, broadcaster, relay HTTP, clock); CHAR-CALLDATA, EXIT, RISK, ANTIRUG, FEES, DB (golden schema v0 to v7 and v4 to v7), API shapes, OPS (`op` taxonomy), `buildChainRegistry` env-matrix `{unset,'','0','abc',valid}` snapshot, boot/resume/arm order, signing-site AST census (with positive `>= N` assertion), singleton-identity test, listener-count tests, same-block ordering test; source-grep tests converted to path-agnostic checks; `testDb` calls real migrations.
- Avoids: Pitfalls 2, 3, 6, 8, 9.

**Phase 4: Capital-Safety Fixes on the Current Layout (STOP-THE-LINE)**
- Rationale: characterization locks bugs in; a move phase must not carry a known money-path bug forward or entangle its fix with a move.
- Delivers: each confirmed S0/S1 candidate fixed with a RED-then-GREEN real-path test, an independent reviewer re-running the RED to GREEN proof (the gsd-verifier alone is not sufficient), snapshot changes only in commits citing `AUD-`/`OD-`. Likely scope: candidates 1-16, subject to confirmation and decisions. Use `AsyncLocalStorage` `assertNonceLockHeld` for the nonce invariant.
- Avoids: Pitfalls 2, 13; the "green suite misses money-path bugs" pattern. Needs deep code review and real-path tests.

**Phase 5: Behavior-Neutral Pre-Move Cleanup**
- Rationale: makes Phases 6-8 safe and shrinks what has to be moved.
- Delivers: `.gitattributes` + renormalize commit; one isolated Prettier commit + `.git-blame-ignore-revs`; audited dead-code deletion (10 dead imports in `bot.ts`, legacy `tokenSafety` functions, `gasManager`, `pairDiscovery`, `exitManager` dead registrars, legacy lock overloads, `raceTelemetry` if confirmed, broken scripts); mechanical lint; break cycle #1 by extracting `anti-rug/registry.ts`; single env-first import; commit-trace identity verified.
- Avoids: Pitfalls 5 (dead imports must go before `verbatimModuleSyntax`), M1, 8.

**Phase 6: Contracts Isolation & Runtime Dependency Modernization**
- Rationale: independent of the module system; clears the prod vulns; decouples Hardhat 3.
- Delivers: `contracts/` sub-package (pure relocation on Hardhat 2; fork harness and the 5 fork tests' artifact paths updated); dependency bumps with one major per commit (ethers 6.17, axios 1.21, express 5.3, ws 8.22, better-sqlite3 13.0.3 with `allowScripts`, dotenv 18 `quiet: true`, pino/helmet/etc.), `uuid` to `crypto.randomUUID()`, flashbots `overrides` (single deduped ethers), `packageManager`, fresh lockfile; drop dead dev deps; `npm audit --omit=dev` = 0; `npm ci` with no `--legacy-peer-deps`; better-sqlite3 migration test against a copy of the prod DB.
- Uses: STACK Upgrade Order steps 1 and part of 0. Avoids: Pitfalls M2, M3, M9, m1, m2.

**Phase 7: Toolchain Foundation (ESM, runner, TS, ESLint, Vitest)**
- Rationale: one codemod on the known layout, under the net, before 60+ file moves.
- Delivers, in this order: Vitest 5 on CJS (suite green, test-count diff); TS 6 alias bridge, ESLint 10 + typescript-eslint config (non-blocking), consolidate to two tsconfigs including `test/` and `scripts/` (tests are untyped today), `moduleResolution: nodenext`; ts-node removal and ESM conversion together (`"type": "module"`, `.ts` specifier codemod, `import.meta.dirname`, `import.meta.main`, gramjs subpath fix, `verbatimModuleSyntax`, `erasableSyntaxOnly`, static `closeDb`); real-Node `scripts/import-smoke.ts`; Flashbots path fork-rehearsed after ESM (dual-ethers hazard); TS 7 `tsc` dual install with both compilers green for one cycle; dependency-cruiser (no cycles, mock-path check) in CI; runbook, `package.json` scripts and STATE.md Operating Notes updated for the new start command in the same plan; one-Ctrl+C manual test in Git Bash and PowerShell shows stage 1 only.
- Avoids: Pitfalls 10, 12, M4, M5, M7, M8.

**Phase 8: Restructure, leaves-first (pure moves, then splits)**
- Rationale: operator's stated goal; the order keeps each step a verifiable pure move.
- Delivers: `infra` (+db split with `runMigrations`, import order preserved) then `config`/`chain`, `safety`/`risk`/`submission`, `exit`, `anti-rug`, `execution`, `detection` + `ops`, `app` (`bot.ts` dissolved last; `main.ts` the only starter), then full dependency-cruiser matrix and file-size gate (`max-lines 400`, comments excluded). No compat shims; update every importer and `vi.mock` specifier in the move commit; SPLIT commits verified by a non-import-statement-hash multiset script; preserve reconnect loops and un-awaited calls verbatim; boot/resume/arm order and key strings pinned. Line ranges re-measured at plan time.
- Avoids: Pitfalls 4, 5, anti-patterns 1-5.

**Phase 9: Lint Burn-Down & Function Decomposition**
- Rationale: semantic fixes belong in small, extracted, characterized modules.
- Delivers: typed ABI wrappers removing most `no-unsafe-*` at the source (no `as number`/`as bigint` on Contract results), `strictTypeChecked` zero errors / zero warnings / zero inline disables in `src/`, explicit `init()` replacing import-time side effects (characterized MOD step), disposables registry for timers, env module with read-through accessors (fail-closed on NaN), function decomposition per OD-12, `noUncheckedIndexedAccess` as its own commit, type-coverage ratchet; lint gate ON.
- Avoids: Pitfalls 2, 3, 6, 7, 8.

**Phase 10: Test-Suite Quality**
- Delivers: rewrite of the 30 `vi.mock('ethers')` and the mechanism-mocking tests to real-path; a CI guard banning `vi.mock` of mechanism-set modules; prune dead/duplicate and source-text tests; fast-check properties (minOut bounds, fee clamp, env parsers, `priceMultiple`, `withNonceLock` interleavings, one buy/sell per `chain:token`); Stryker baseline on money-math modules; `advanceTimersByTimeAsync` for lock tests; per-glob ratchet-only coverage floors measured AFTER the rewrite (`perFile`, branches matter more than lines).
- Avoids: Pitfalls 9, 15, M6.

**Phase 11: Hardhat 3 (inside the contracts package)**
- Delivers: Hardhat 3.21.2 with Ignition, Verify, Keystore only; pinned profiles (`paris`, optimizer off) in both default and production; `paths.sources` including `test/fixtures/contracts`; `configVariable` networks; `hardhat clean` and delete stale `artifacts/` before first build; artifact `_format === 'hh3-artifact-1'` test; replacement for `ethersV6ToolboxConfig.test.ts`; fork-harness migration (still chainId 31337, `ALLOW_REAL_MAINNET` tripwire RED test; never "fix" by setting it); Ignition `status chain-1` and any `migrate` on a COPY with a byte-identity diff of `deployed_addresses.json` and `journal.jsonl`; slither/mythril job confirmed to parse HH3 build-info (or compile with solc directly); OZ 5.4.0 pin; `npx hardhat build` and `node scripts/check-mythril-report.ts` in CI.
- Can run any time after Phase 6; placed late so the fork suite stays unchanged under the restructure. Avoids Pitfall 11, P-1.

**Phase 12: Dashboard, Scripts & Hygiene**
- Delivers: dashboard dependency upgrade in place (TS 7 directly; lucide 1.x icon renames confirmed by `tsc -b`), linting of the dashboard, API contract tests, absolute `dashboard/dist` path; auth/CORS/emergency-sell audit items; `Host` allowlist; scripts audit (remove broken ones, route signing scripts through the lock/kill-switch or guard with the process lock); hygiene (`git rm --cached` `.DS_Store`/`.idea`, `package.json` metadata, `.nvmrc`, `engines`, stage explicit paths, never-delete list `data/`, `.env*`, `ignition/deployments/`, include `.claude/worktrees/agent-*/` in sweeps). Can run in parallel after Phase 7.
- Avoids: Pitfalls M10, M11, M12.

**Phase 13: CI Hardening & Docs**
- Delivers: every gate flipped to blocking only when its baseline is zero: format:check, lint (`--max-warnings 0`), typecheck (TS 7), unit + integration, coverage floors, `audit:prod` (`--omit=dev` plus `npm audit signatures`), knip, dependency-cruiser, type-coverage, mock-path and mechanism-mock guards, real-Node import smoke, decision-trace hash gate; actions pinned by SHA (checkout v7.0.1, setup-node v7.1.0, setup-python v7.1.0, paths-filter v4.0.3); `permissions: contents: read`; Node 24/26 matrix; weekly scheduled `audit:prod`; lefthook; Dependabot (grouped, cooldown); gitleaks full-history one-time scan. Docs: `docs/ARCHITECTURE.md` and module map with the invariants list, ADR backfill (D-NONCE-AUTHORITY-ALL etc., moving rationale out of comments before deleting them), cold-start README (env reference from the config schema, "there is no dry-run mode"), versioned runbook with a check that every `npm run X` it names exists.

**Phase 14: Fork Rehearsal & Live ETH Roundtrip (re-entry gate)**
- Rationale: last; needs everything. Per D-EVIDENCE-BAR a fork proves calldata and accounting, not inclusion; only the live run validates the final runtime and inclusion path.
- Delivers, in order: fork rehearsal on the real entry and runner; decide Node target (OD-13); fresh shell (no `ALLOW_REAL_MAINNET`, `*FORK*`, temp `DB_PATH`); wallet funding and key checks per the high-stakes-ops protocol (address-check, step-by-step verify); `db.backup()` of the live DB; boot paused via the persisted kill-switch and verify listeners, anti-rug arming, single-instance lock, `boot.config` fingerprint; resolve OD-19; resume; one small buy, monitor, sell with on-chain artifacts. Run `npm run preflight` (read-only) before; never boot `src/bot.ts` outside this gate.

### Phase Ordering Rationale

- Protect state (1), find bugs read-only (2), lock behavior (3), fix capital bugs in the familiar layout (4), neutral cleanup (5), runtime deps and toolchain (6-7), restructure (8), quality (9-10), contracts tooling (11), dashboard/hygiene (12), gates and docs (13), live proof (14). Dependencies: 3 before 4 and before every toolchain change; 4 before 8; 5 before 7 and 8; 6 before 7 (isolation) and before 11; 7 before 8; 9 after 8; 10 after 9 for meaningful floors; 13 after 9-12.
- D-STOP-THE-LINE interrupts wherever a capital finding is confirmed, including phases after 4.
- Each phase changes one risk variable at a time, so any regression is bisectable.

### Research Flags

Phases likely needing deeper research during planning (`/gsd-plan-phase --research-phase <N>`):
- **Phase 2 (audit):** needs per-area deep reading, and some candidates need verification of ethers v6 behaviors (`getFeeData` base fee, `wait()` error semantics).
- **Phase 3:** design of the fake JSON-RPC transport harness; env-matrix snapshot; AST census tooling.
- **Phase 4:** per-finding research; D-STOP-THE-LINE; the H1/H2 single-WS-owner design and the `AsyncLocalStorage` nonce enforcement need design work and operator decisions.
- **Phase 7:** version/compat pinning is done, but the ESM boot behavior (ethers dual instance with the Flashbots bundle, gramjs subpaths, `import.meta.main`), `package.json#imports` aliasing with Vitest/knip/dependency-cruiser, and Vitest 5 mocking under type stripping need a spike.
- **Phase 9:** typed-ABI approach (OD-20) and the `no-unnecessary-condition` policy (OD-4).
- **Phase 10:** StrykerJS vitest-runner compatibility with Vitest 5 is unverified.
- **Phase 11:** Hardhat 3 fork flags (`edr-simulated` vs `node --fork` as spawned), Ignition v3 reading the v2-era `chain-1` journal (MEDIUM; whether `ignition migrate` is needed is unresolved), slither/crytic-compile with HH3 build-info (crytic-compile #629).
- **Phase 14:** live-proof procedure review against the high-stakes-ops convention.

Phases with standard patterns (skip research-phase): **Phase 1** (mechanics are specified), **Phase 5** (mechanical, specified), **Phase 6** (versions and the `allowScripts` fix verified; only the contracts relocation needs care), **Phase 8** (standard mechanics, but re-measure line ranges and run the mock-path check every commit), **Phase 12**, **Phase 13** (versions verified; gate order specified).

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions from `npm view`; load-bearing claims reproduced locally (resolve, `npm audit` = 0, `npm ci` trap, ESM smoke, TS 7 + TS 6 alias with typescript-eslint, type stripping, HH3 config behaviors from tarball code). Lower: gramjs and Flashbots on Node 26 unverified; WebStorm TS 7 LSP unverified; lucide 1.x notes are LOW (web only); some npm v12 notes WEB |
| Features | HIGH for the codebase-grounded checklist (read directly from `src/`); MEDIUM for incident history and tooling claims (Maestro/Unibot/Banana Gun/Salmonella/mev-boost 2023 incidents, Stryker, fast-check, Vitest 5 per-glob thresholds) | All bug candidates are code-reading only, not reproduced |
| Architecture | MEDIUM-HIGH | Current-state map and cycles verified (madge + independent graph script). Target layout and phase order are judgment calls on verified facts. Line ranges in the move map are approximate |
| Pitfalls | HIGH for repo-grounded items (grep, code read, run on this box); MEDIUM-HIGH for upgrade items checked against release notes/registry | Windows path-case duplicate instances, ethers ESM/CJS non-identity, `listen(port,'')` binding `::`, gramjs `ERR_UNSUPPORTED_DIR_IMPORT` were each executed |

**Overall confidence:** HIGH on tooling and sequencing; MEDIUM on the bug candidates until each is reproduced.

### Gaps to Address

- **Every audit candidate is unreproduced.** Handle in Phase 2/3/4: RED real-path test or fork script before it counts; some severity labels (candidate 1 "S0/S1", 13 "S1 if breaks anti-rug") depend on reading-order verification.
- **Line-number drift between researchers** (e.g. V2 sell minOut at `exitEngine.ts:362-364` vs `:366`; exit `setInterval` sites): re-measure at plan time.
- **Ignition v3 versus the v2-era `chain-1` journal:** message types all exist in ignition-core 3.1.11 (MEDIUM) but whether `status` reads unchanged or `ignition migrate` is required is unresolved (STACK and PITFALLS differ). Test on a copy in Phase 11 and never in place. Git cannot restore the untracked journal or per-future artifacts.
- **Dual-ethers behavior of the Flashbots bundle provider under ESM:** duck typing works; `instanceof` across the boundary fails. Needs fork + relay rehearsal after Phase 7, or replacement (OD-2).
- **Stryker with Vitest 5, `package.json#imports` aliasing with Vitest/knip/dependency-cruiser, typed-ABI generation approach:** unverified; spike inside Phases 7, 9, 10.
- **Unresolved zod 3 (via Hardhat) and minimatch (via ESLint) dev-tree advisories:** no fix exists, build-time only; the CI gate is `--omit=dev`; track, do not override.
- **gramjs `telegram` 2.26.22 is stale (last publish 2025-02),** with `socks`/`ip-address` fixed only by lockfile refresh; needs a connect smoke after bumps. Node 26 behavior unverified.
- **Is the 7-day anti-rug dry-run measured from a persisted timestamp?** Unknown; decision OD-19 before re-entry.
- **Production-dead code claims** (`raceTelemetry`, `gasManager`, `pairDiscovery`, legacy tokenSafety) are based on import analysis; confirm with knip including script entry points and dynamic callers.
- **Fork limits:** a Hardhat fork cannot reproduce calm-gas non-inclusion; the live roundtrip is the only valid inclusion proof and needs an explicit "did this build change the inclusion path?" question.

---

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view`) for every version, peer, engines, exports and `time` field in STACK.md, queried 2026-11-06; published tarballs inspected for `hardhat@3.21.2`, `ignition-core@3.1.11`, `hardhat-ignition@3.1.9`, `better-sqlite3@13.0.3`
- Local executions on this repo and machine (Windows 11, Node 24.18, npm 11.16): resolver conflict with the flashbots peer, target manifest install + `npm audit --omit=dev` = 0, `npm ci` vs `npm install` for better-sqlite3 and the `allowScripts` fix, ESM import smoke of all prod deps, TS 7 emit and TS 6 alias with typescript-eslint, Vitest 5, Node type stripping, path-case duplicate module instances, ethers ESM/CJS class non-identity, gramjs directory-import failure, `listen(port,'')`
- Code read at commit `c110201` across `src/**`, `test/`, `vitest.config.ts`, `tsconfig*.json`, `eslint.config.mjs`, `.github/workflows/test.yml`, `dashboard/`, `scripts/`; `npx madge --circular` (2 cycles); `npx eslint src -f json` inventory
- `.planning/PROJECT.md` (Current Milestone v7.0), `.planning/STATE.md`, `.planning/RETROSPECTIVE.md` (v6.17 lessons: mock-the-mechanism, INT-NONCE-SELL, D-EVIDENCE-BAR)
- Official docs and release notes: TypeScript 6.0 and 7.0 announcements, Hardhat "Migrate from Hardhat 2" and artifacts reference, Vitest 5 migration guide, ESLint v10 migration, Node.js TypeScript docs and release schedule, dotenv CHANGELOG, better-sqlite3 releases, uuid v14 changelog, chai v6, ethers v6.17.0 release, dependency-cruiser rules reference, Dependabot options reference, typescript-eslint issue #12518

### Secondary (MEDIUM confidence)
- Flashbots post-mortem of the 2023-04-03 mev-boost-relay incident (corroborated by CertiK); CertiK on Maestro/Unibot; Banana Gun Telegram-oracle exploit analyses; Salmonella anti-bot token
- StrykerJS docs via Context7; eslint-plugin-boundaries; Vitest module mocking docs
- Community TypeScript 7 upgrade write-ups (November 2026) on the missing compiler API and the `@typescript/typescript6` alias
- Hardhat/Ignition PR #6976 (tasks throw on v2 artifacts); crytic-compile #629 (Hardhat 3 support)

### Tertiary (LOW confidence, needs validation)
- lucide 1.0 brand-icon removal and default `aria-hidden` (web only)
- npm v12 default skipping unapproved install scripts (web only)
- WebStorm language service with a TS 7 server (unverified)
- Single secondary source on malicious-token mechanics (fee-on-transfer, gas-limit tricks)
- The 2025 npm maintainer-compromise incident specifics

---
*Research completed: 2026-11-06*
*Ready for roadmap: yes*
