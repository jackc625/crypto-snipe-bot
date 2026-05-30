---
phase: 20-going-live-ops-hardening
plan: 02
subsystem: preflight + chain-registry-extension
tags: [preflight, ops-live, fail-fast, wallet-balance, rpc-health, mev-health, honeypot-checker, cross-env, antirug-live-gate, stale-data, d-balance-floor, d-rollback]
requires:
  - 20-01 (schema v6 + getAntirugDryRunStarted prepared statement)
  - chainRegistry.ts ChainConfig + ChainTemplate (extended by Task 2)
provides:
  - src/preflight.ts dual-shape API (preflight / preflightDryRun)
  - checkWalletBalance exported for Plan 20-04 mid-run setInterval (W4 fix)
  - PreflightChain + PreflightRegistry type aliases (Plan 20-04 wiring shape)
  - chainRegistry.ts gasBuffer + blockAgeToleranceSec fields + per-chain defaults
  - 12 new envs in REQUIRED_ENV_VARS + .env.example (D-ENV-EXAMPLE)
affects:
  - bot.ts will call preflight(registry) before chain-context creation (Plan 20-04)
  - scripts/preflight.ts CLI consumes preflightDryRun (Plan 20-05)
  - mid-run wallet undercut path consumes exported checkWalletBalance (Plan 20-04)
tech-stack:
  added: []   # zero new deps - composition of installed primitives
  patterns:
    - "D-PREFLIGHT-FLOW collect-all-then-FATAL with collect-all dryRun analog"
    - "type-only chainRegistry import to avoid dotenv cascade in tests"
    - "PreflightChain type alias (ChainConfig + httpProvider + wallet) for the
       cross-boundary shape between registry and ChainContext"
key-files:
  created:
    - src/preflight.ts (641 LOC, 11 exports)
  modified:
    - src/chainRegistry.ts (+50 LOC: ChainConfig + ChainTemplate fields, env-overlay, FATAL validation)
    - src/config.ts (+26 LOC: 12 new REQUIRED_ENV_VARS entries under Phase 20 header)
    - .env.example (+30 LOC: Phase 20 section with all 12 envs + inline descriptions)
    - test/unit/preflight/antiRugLiveGate.test.ts (+11 LOC: filled empty boundary describe)
decisions:
  - "Plan 20-02 (2026-05-24) - PreflightChain + PreflightRegistry exported type aliases:
     src/preflight.ts needs httpProvider + wallet on its input but preflight() runs
     BEFORE chain-context creation per OPS-LIVE-01. ChainContext (which has both) is
     orchestrator-internal. Resolved by exporting a thin PreflightChain = ChainConfig
     & { httpProvider; wallet } intersection so Plan 20-04 can build the input shape
     by adapting its ChainContext list. PreflightRegistry = Map<string, PreflightChain>
     is the registry the boot path passes."
  - "Plan 20-02 (2026-05-24) - type-only chainRegistry import + inline getEnabledChains:
     runtime import of chainRegistry.ts transitively loads src/utils/provider.ts -> 
     src/config.ts which calls dotenv.config() at module-eval time. Tests that explicitly
     `delete process.env.FLASHBOTS_AUTH_KEY` in beforeEach were silently being clobbered
     by the dotenv re-injection when the test dynamic-imported preflight. Fixed by
     making the chainRegistry import type-only (erased at compile time) and inlining
     getEnabledChains as a private generic helper. Discovered by Task 1 GREEN
     test-run; Rule 1 bug fix-in-flight."
  - "Plan 20-02 (2026-05-24) - SKIP_PREFLIGHT comment scrubbed:
     plan acceptance_criteria says grep -c 'SKIP_PREFLIGHT' src/preflight.ts must
     return 0 (D-ROLLBACK enforcement at the static level). The initial draft had 3
     mentions in docs explaining what the escape hatch ISN'T. Scrubbed all 3 to use
     'bypass escape hatch' phrasing instead. Net: zero literal SKIP_PREFLIGHT mentions
     in src/preflight.ts even in comments."
  - "Plan 20-02 (2026-05-24) - sendTelegramAlert(message) instead of sendCtxAlert(ctx, msg):
     sendCtxAlert requires a ChainContext (chain config + httpProvider + wallet + pino),
     but preflight() runs BEFORE chain-context creation. sendTelegramAlert is the
     chain-agnostic notifier helper that accepts a string and dispatches the same
     Telegram POST + dashboard WS broadcast path. Each FATAL preflight failure is
     wrapped in try/catch so a Telegram outage cannot mask the FATAL exit (T-20-W2-02
     fail-closed analog)."
  - "Plan 20-02 (2026-05-24) - antiRugLiveGate boundary test fix-in-flight (Rule 1):
     test/unit/preflight/antiRugLiveGate.test.ts had a 4-test describe block plus an
     empty 'boundary' describe stub from 629e6ba. Vitest treats empty suites as
     failures. Added the exact-7-day boundary test (ts === now - 7*86400 -> passed:true)
     which is the inclusive boundary contract per the plan Behavior block."
metrics:
  duration: "~50min (Task 2 audit + commit, Task 1 GREEN + 2 fix-in-flights + test runs)"
  completed: "2026-05-24"
  files_created: 1
  files_modified: 4
  loc_added: ~758
  tests_added: 32 (6 walletBalance + 4 rpcHealth + 4 mevHealth + 3 honeypotCheckerCode + 6 crossEnvRules + 4 staleData + 5 antiRugLiveGate including new boundary)
  commits: 2 task commits + 1 docs commit
---

# Phase 20 Plan 20-02: src/preflight.ts dual-shape API + chainRegistry/config/.env.example Phase 20 envs — Summary

## One-liner

Startup-time fail-fast preflight module (`src/preflight.ts`) with 7 per-chain checks (wallet balance, RPC chainId, RPC block-age, MEV health, HoneypotChecker code-at-address, anti-rug 7-day live gate) + chain-agnostic cross-env validator + stale-position scanner, exposed via dual-shape API (`preflight()` collect-all-then-FATAL + `preflightDryRun()` returns-results-without-exit), backed by 12 new envs in `.env.example` + per-chain `gasBuffer` / `blockAgeToleranceSec` defaults in `chainRegistry.ts`.

## What Shipped

### Task 1 — `src/preflight.ts` (641 LOC, GREEN for 32 failing tests)

Public surface (11 exports):

| Export | Shape | Purpose |
|--------|-------|---------|
| `PreflightResult` | interface | Result shape with 8-variant `check` union (`wallet-balance`, `rpc-chainid`, `rpc-block-age`, `mev-health`, `honeypot-checker-code`, `cross-env-rule`, `antirug-live-gate`, `stale-data`) |
| `PreflightChain` | type alias | `ChainConfig & { httpProvider; wallet }` — input shape for each check |
| `PreflightRegistry` | type alias | `Map<string, PreflightChain>` — registry shape for `preflight()` / `preflightDryRun()` |
| `preflight(registry)` | async function | D-PREFLIGHT-FLOW collect-all-then-FATAL boot entry; structured pino + Telegram alert + `process.exit(1)` on any failure |
| `preflightDryRun(registry)` | async function | Same checks, returns `PreflightResult[]` without `process.exit` (Plan 20-05 CLI consumer) |
| `checkWalletBalance(chain)` | async function | **EXPORTED per W4 fix** — Plan 20-04 mid-run setInterval re-uses the D-BALANCE-FLOOR formula `parseEther(snipeAmount) × MAX_OPEN_POSITIONS + parseEther(gasBuffer)` without duplicating the code |
| `checkRpcChainId(chain)` | async function | Replaces inline check at `bot.ts:887-895` (Plan 20-04 removes the inline) |
| `checkRpcBlockAge(chain)` | async function | `(now - block.timestamp) > chain.blockAgeToleranceSec` per-chain ceiling |
| `checkMevHealth(chain)` | async function | Short-circuits passthrough strategy without network call; otherwise delegates to `createMevStrategy(chain).healthCheck()` |
| `checkHoneypotCheckerCode(chain)` | async function | `getCode(deployedAddress)` check; FATAL on `'0x'` with remediation pointer to `scripts/deploy-honeypot-checker.ts <chain>` |
| `checkAntiRugLiveGate(chain)` | async function | D-ANTIRUG-LIVE-GATE-CODE 7-day floor enforced via `chain_state.antirug_dry_run_started` timestamp from Plan 20-01 prepared statement |
| `validateCrossEnvRules()` | function | Chain-agnostic; 4 rules (MEV-flashbots-auth-key, bsc-bloxroute, telegram-5-tuple, per-chain-rpc-url) |
| `checkStaleData()` | async function | D-STALE-THRESHOLDS one-shot scan; defaults 120s warn / 600s error; log fires ARE the observable |

D-* discipline preserved verbatim:
- **D-ROLLBACK**: `grep -c "SKIP_PREFLIGHT" src/preflight.ts` returns 0 (no bypass even in comments)
- **D-ALERTS**: every FATAL emits structured pino `{ chain, check, reason, details, remediation: 'docs/operations/going-live.md' }` + `sendTelegramAlert(...)` wrapped in try/catch so Telegram outage cannot mask the FATAL exit
- **D-PREFLIGHT-FLOW**: collect-all-then-exit; cross-env rules first (chain-agnostic, fail-loud earliest), per-chain checks via `Promise.all`, stale-data one-shot last
- **D-BALANCE-FLOOR**: `checkWalletBalance` floor formula `parseEther(chain.snipeAmount) × BigInt(maxOpen) + parseEther(chain.gasBuffer)` with `MAX_OPEN_POSITIONS` env override
- **D-ANTIRUG-LIVE-GATE-CODE**: `SEVEN_DAYS_SEC = 7 * 86400` constant; remediation pointer to `docs/operations/anti-rug-rollout.md`

### Task 2 — chainRegistry.ts + config.ts + .env.example Phase 20 envs

**`src/chainRegistry.ts`** (+50 LOC):
- `ChainConfig.gasBuffer: string` (native units; D-GAS-BUFFER)
- `ChainConfig.blockAgeToleranceSec: number` (per-chain RPC tip-staleness ceiling; OPS-LIVE-03)
- `ChainTemplate.defaultGasBuffer: string` + `defaultBlockAgeToleranceSec: number`
- 4 per-chain defaults populated:
  - **ETH**: `0.005` / `300s` (5× 60s block-time)
  - **BSC**: `0.003` / `60s` (4× 15s)
  - **Base**: `0.0005` / `30s` (3× 10s)
  - **Arb**: `0.0005` / `30s` (matches Base; below this is noisy per RESEARCH OQ4)
- `buildChainRegistry()` env-overlay reads `<CHAIN>_GAS_BUFFER` + `<CHAIN>_BLOCK_AGE_TOLERANCE_SEC` with fail-loud NaN/`<=0` FATAL on block-age tolerance (mirrors Phase 18 tax-threshold pattern at chainRegistry.ts:654-660)

**`src/config.ts`** (+26 LOC, 12 new `REQUIRED_ENV_VARS` entries under `// --- Going-Live Ops Hardening (Phase 20, plan 20-02) ---` header):
- 4 × `<CHAIN>_GAS_BUFFER`
- 4 × `<CHAIN>_BLOCK_AGE_TOLERANCE_SEC`
- `MID_RUN_CHECK_INTERVAL_SEC` (default 300 = 5 min)
- `STALE_WARN_SEC` (default 120 = 2 min)
- `STALE_ERROR_SEC` (default 600 = 10 min)
- `DASHBOARD_URL` (default `http://localhost:3000`)

All `required: false` with documented defaults inline per the Phase 19 anti-rug row precedent.

**`.env.example`** (+30 LOC):
- New `# ---- Going-Live Ops Hardening (Phase 20) ----` section after the Phase 19 anti-rug block
- Every Phase 20 env entry with `<NAME>=<default>  # [OPTIONAL] ...inline description...` per D-ENV-EXAMPLE [USER-BINDING]

## Unit Test Breakdown (32 tests across 7 files)

| File | Active tests | Behaviors covered |
|------|--------------|--------------------|
| `test/unit/preflight/walletBalance.test.ts` | 6 | balance > floor passes; balance < floor fails w/ structured details; boundary inclusive (=== passes); gasBuffer override consumed; MAX_OPEN_POSITIONS env override; ethers.parseEther precision exactness |
| `test/unit/preflight/rpcHealth.test.ts` | 4 | chainId mismatch fails w/ expected+got; chainId match passes; block fresh (60s) passes; block stale (750s > 300s tolerance) fails w/ blockAgeSec+toleranceSec |
| `test/unit/preflight/mevHealth.test.ts` | 4 | Flashbots fail on ETH; bloXroute fail on BSC; passthrough short-circuits PASS without invoking healthCheck; healthCheck true passes |
| `test/unit/preflight/honeypotCheckerCode.test.ts` | 3 | getCode '0x' fails w/ remediation pointer to docs/operations/going-live.md; non-empty bytecode passes; deployedAddress null fails without invoking getCode |
| `test/unit/preflight/crossEnvRules.test.ts` | 6 | flashbots without FLASHBOTS_AUTH_KEY; bsc without BLOXROUTE_AUTH_HEADER; TELEGRAM_API_ID without 5-tuple (lists missing); per-chain ETH_RPC_URL missing; all-pass empty list; beforeEach isolation prevents env bleed |
| `test/unit/preflight/staleData.test.ts` | 4 | 60s no log; 180s warn log with op+tradeId+ageSec; 700s error log; STALE_WARN_SEC=60 + STALE_ERROR_SEC=120 overrides consumed |
| `test/unit/preflight/antiRugLiveGate.test.ts` | 5 | LIVE_EXECUTE=true + NULL timestamp fails w/ "no dry-run timestamp"; ts 3 days ago fails w/ "days remaining"; ts 8 days ago passes; LIVE_EXECUTE unset passes regardless; **(new boundary test, Rule 1 fix-in-flight)** ts === now-7×86400 passes (inclusive boundary) |

**Total: 32 active tests, 0 skips, all passing.**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Empty `describe('checkAntiRugLiveGate boundary', ...)` block from 629e6ba**
- **Found during:** Task 1 first vitest run
- **Issue:** Test file at line 117 had `describe(... { beforeEach/afterEach })` with NO `it()` body. Vitest 4.1.1 treats empty suites as failures (`Error: No test found in suite checkAntiRugLiveGate boundary`).
- **Fix:** Added the exact-7-day-boundary test the describe was clearly designed for (per the inline comment "Boundary: exactly 7 days should PASS (>= floor)"). Asserts `ts === now - 7 * 86400` returns `passed: true`. This is the inclusive-boundary semantic the production check uses (`if (ageSec < SEVEN_DAYS_SEC)` → only strict-less-than fails).
- **Files modified:** `test/unit/preflight/antiRugLiveGate.test.ts`
- **Commit:** 67f2066

**2. [Rule 1 - Bug] dotenv re-injection clobbered cross-env test isolation**
- **Found during:** Task 1 first vitest run (cross-env Test 1 expected violation for missing FLASHBOTS_AUTH_KEY but got none)
- **Issue:** Test `beforeEach` deletes `process.env.FLASHBOTS_AUTH_KEY` (and 12 other env keys). Test then dynamically imports `src/preflight`. Preflight imports `chainRegistry.ts` for `getEnabledChains` (runtime import). chainRegistry transitively pulls `src/utils/provider.ts` → `src/config.ts` which calls `dotenv.config()` at module-eval time. dotenv re-injects FLASHBOTS_AUTH_KEY from `.env`, clobbering the test's `delete`. Test then expects the violation but the key is set, so `validateCrossEnvRules()` returns no violation, assertion fails.
- **Fix:** Made the `chainRegistry` import type-only (`import type { ChainConfig } from './chainRegistry'`) which is erased at compile time. Inlined `getEnabledChains` as a private generic helper (`function getEnabledChains<T extends { enabled: boolean }>(registry: Map<string, T>): T[]`). Module body of chainRegistry no longer loads when preflight is dynamically imported, so config.ts doesn't load, so dotenv doesn't re-run.
- **Files modified:** `src/preflight.ts`
- **Commit:** 67f2066

**3. [Rule 2 - Critical functionality] PreflightChain + PreflightRegistry type aliases**
- **Found during:** Task 1 first `tsc --noEmit -p tsconfig.json` run
- **Issue:** `ChainConfig` (the existing source-of-truth chain type from chainRegistry.ts) does NOT have `httpProvider` or `wallet` fields — those live on `ChainContext` (the orchestrator-internal type built by `createChainContext`). Plan signature `checkWalletBalance(chain)` requires `chain.httpProvider.getBalance(chain.wallet.address)`. tsc emitted `Property 'httpProvider' does not exist on type 'ChainConfig'` 4×.
- **Fix:** Created exported `type PreflightChain = ChainConfig & { httpProvider: JsonRpcProvider; wallet: Wallet | { address: string } }` + `type PreflightRegistry = Map<string, PreflightChain>`. Updated all 6 per-chain check function signatures from `ChainConfig` → `PreflightChain`. Updated `preflight` and `preflightDryRun` from `Map<string, ChainConfig>` → `PreflightRegistry`. Plan 20-04 will build the input shape by adapting its ChainContext list (ChainContext.chain + ChainContext.httpProvider + ChainContext.wallet → PreflightChain via spread/intersection).
- **Files modified:** `src/preflight.ts`
- **Commit:** 67f2066

### No Other Deviations

Task 2 acceptance criteria all passed on first audit (the prior agent left clean uncommitted work). The plan's Note for Planner items (SKIP_PREFLIGHT-comment scrub, sendTelegramAlert-vs-sendCtxAlert) were judgment calls made during writing and documented in the Decisions log above.

## Authentication Gates

None. Plan 20-02 is pure code addition with no live-network or external-auth dependencies. Tests are fully mocked.

## Hand-Off Notes

### Plan 20-04 (bot.ts kill-switch + preflight call wiring)

Three integration points:

1. **Preflight call insertion** at `bot.ts` line 880 (between `buildChainRegistry()` and the per-chain context loop):
   ```typescript
   const registry = buildChainRegistry();
   // Adapt ChainConfig registry → PreflightRegistry by building httpProvider+wallet
   // alongside each chain config BEFORE the loop. Pattern:
   const preflightRegistry: PreflightRegistry = new Map();
   for (const [name, chain] of registry) {
       const httpProvider = getProvider(chain.name, chain.httpRpcUrl);
       const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, httpProvider);
       preflightRegistry.set(name, { ...chain, httpProvider, wallet });
   }
   await preflight(preflightRegistry);  // FATAL exit on any failure
   ```
2. **Inline chainId check REMOVE** at `bot.ts:887-895` (replaced by `checkRpcChainId` inside preflight)
3. **Mid-run wallet re-check setInterval** after line 926 — imports `checkWalletBalance` from `./preflight` and reuses the same `PreflightChain` shape from each ctx:
   ```typescript
   import { checkWalletBalance, type PreflightChain } from './preflight';
   const midRunIntervalMs = Number(process.env.MID_RUN_CHECK_INTERVAL_SEC || '300') * 1000;
   setInterval(async () => {
       for (const ctx of contexts) {
           const pchain: PreflightChain = { ...ctx.chain, httpProvider: ctx.httpProvider, wallet: ctx.wallet };
           const result = await checkWalletBalance(pchain);
           if (!result.passed) { /* setPauseState + WS broadcast + Telegram + pino fatal */ }
       }
   }, midRunIntervalMs);
   ```

### Plan 20-05 (scripts/preflight.ts CLI)

`preflightDryRun(registry)` returns `PreflightResult[]` without exiting. CLI builds `PreflightRegistry` the same way Plan 20-04 does, then calls `preflightDryRun`, formats human-readable per-chain ✓/✗ output (or `--json` for machine), and decides its own exit code (`process.exit(failed.length > 0 ? 1 : 0)`).

### Plan 20-03 (anti-rug detector timestamp wiring)

One-line insertion in `src/anti-rug/detector.ts` at `startChainAntiRugListener` entry point: `setAntirugDryRunStarted.run(chain.name, Math.floor(Date.now()/1000), Math.floor(Date.now()/1000))`. The Plan 20-01 prepared statement uses `COALESCE` so first-call-per-chain wins (idempotent). Once timestamps land, `checkAntiRugLiveGate` enforces the 7-day floor when `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true`.

## Verification Evidence

- `npx vitest run --project unit test/unit/preflight/` → **7 files, 32 tests, all pass** (724ms)
- `npx vitest run --project unit` → **54 files, 531 pass, 0 fail** (up from 499 in 20-01 close; +32 from this plan)
- `npx vitest run --project integration` → **27 files, 169 pass, 29 skip** (skips are unrelated Phase 20 Wave 0 stubs from Plans 20-04..20-07; no regressions)
- `npx tsc --noEmit -p tsconfig.json` → **clean**
- `npx tsc --noEmit -p tsconfig.bot.json` → **clean**
- `npx tsc --noEmit -p dashboard/tsconfig.json` → **clean**
- All Task 1 grep acceptance criteria (lines 210-224 of PLAN.md): **PASS** (verified above in Public Surface)
- All Task 2 grep acceptance criteria (lines 265-277 of PLAN.md): **PASS** (verified before commit c2c7699)

## Commits

| # | Hash | Type | Description |
|---|------|------|-------------|
| 1 | `629e6ba` | test | (pre-existing) flip 7 preflight stubs to live failing tests |
| 2 | `c2c7699` | feat | Task 2 — extend chainRegistry + config + .env.example with Phase 20 envs |
| 3 | `67f2066` | feat | Task 1 GREEN — src/preflight.ts dual-shape API with 7 startup-time fail-fast checks (includes Rule 1 antiRugLiveGate boundary test fix) |

## Self-Check: PASSED

All claimed files exist; all claimed commit hashes verified via `git log`.
