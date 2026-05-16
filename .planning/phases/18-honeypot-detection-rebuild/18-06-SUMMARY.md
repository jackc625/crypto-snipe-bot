---
phase: 18-honeypot-detection-rebuild
plan: 06
subsystem: chain-registry
tags: [chainRegistry, hardhat, ignition, deploy-cli, env-overlay, multi-chain, honeypot, tax-thresholds]

# Dependency graph
requires:
  - phase: 18-honeypot-detection-rebuild
    provides: plan 18-02 — HoneypotCheckerConfig type, declaration-merge bridge, simulateHoneypotRoundtrip dispatch (replaced this plan with required-field promotion)
provides:
  - ChainConfig.honeypotChecker required field (sourced from src/utils/honeypot/types HoneypotCheckerConfig)
  - per-chain env overlay for HoneypotChecker:
      <PREFIX>_HONEYPOT_CHECKER_ADDRESS (default null until deploy)
      <PREFIX>_MAX_BUY_TAX_BPS (default 1000 = 10% per D-TAX-THRESHOLDS)
      <PREFIX>_MAX_SELL_TAX_BPS (default 1000)
  - fail-loud bps validation: out-of-range / NaN / negative triggers log.fatal + process.exit(1) (T-18-21 mitigation)
  - hardhat.config.ts per-chain deploy networks: mainnet (chainId 1), bsc (56), base (8453), arbitrum (42161); each gated on <CHAIN>_RPC_URL + DEPLOY_PRIVATE_KEY (D-DEPLOY-KEY capability split — separate from bot wallet's PRIVATE_KEY)
  - hardhat.config.ts etherscan.apiKey block (mainnet/bsc/base/arbitrumOne) consumed by @nomicfoundation/hardhat-verify
  - scripts/deploy-honeypot-checker.ts — per-chain deploy CLI: maps eth/bsc/base/arb → mainnet/bsc/base/arbitrum; fatal-exits on missing DEPLOY_PRIVATE_KEY or invalid chain arg; pino-structured logging; T-18-23 audit-trail preserved (no auto-update of chainRegistry.ts)
  - 8 new unit tests in test/unit/chainRegistry.test.ts covering all overlay paths and validation gates
affects: [18-07, 18-08, 18-09]

# Tech tracking
tech-stack:
  added:
    - "scripts/deploy-honeypot-checker.ts (per-chain CLI wrapper using spawnSync 'npx hardhat ignition deploy')"
    - "hardhat.config.ts per-chain network entries (mainnet/bsc/base/arbitrum) + etherscan.apiKey block"
    - "@nomicfoundation/hardhat-ignition-ethers import in hardhat.config.ts (package already in devDeps; no install needed)"
  patterns:
    - "Conditional-spread for hardhat networks: ...(process.env.<RPC> && process.env.DEPLOY_PRIVATE_KEY ? { name: {...} } : {}) — gates entry on both vars set; type-safer than `name: condition ? {} : undefined` since spread emits the key only when both conditions hold"
    - "Re-export type from chainRegistry.ts for source-of-truth import locality (HoneypotCheckerConfig re-exported via `export type { HoneypotCheckerConfig }` so downstream code can import from chainRegistry alongside ChainConfig — same pattern as SafetyApiConfig / GasConfig)"
    - "Fail-loud overlay validation: parseInt + isNaN/range guard + log.fatal({chain, key, value}, msg) + process.exit(1) — mirrors existing FATAL pattern at chainRegistry.ts:310-312"
    - "spawn shell:true on Windows for npx.cmd resolution (cross-platform safe)"

key-files:
  created:
    - "scripts/deploy-honeypot-checker.ts (100 LOC, per-chain deploy CLI wrapper)"
  modified:
    - "src/chainRegistry.ts (HoneypotCheckerConfig re-export + ChainConfig.honeypotChecker required field + ChainTemplate honeypotMethod/defaultMaxBuyTaxBps/defaultMaxSellTaxBps + 4 template entries + buildChainRegistry overlay + bps validation)"
    - "src/utils/honeypot/index.ts (removed declaration-merge augmentation + NULL_CFG fallback; reads ctx.chain.honeypotChecker directly since field is now required)"
    - "hardhat.config.ts (hardhat-ignition-ethers import + 4 conditional network entries + etherscan.apiKey block)"
    - "test/unit/chainRegistry.test.ts (8 new tests + per-test env-stash scaffolding via vi.resetModules)"

key-decisions:
  - "ChainConfig.honeypotChecker is now a REQUIRED field (not optional): plan 18-02 used an optional declaration-merge augmentation as a wave-2 bridge; plan 18-06 promotes the field to a required member on the source-of-truth interface. This makes ctx.chain.honeypotChecker.{deployedAddress, method, maxBuyTaxBps, maxSellTaxBps} type-safe to read without optional chaining and removes the NULL_CFG fallback in the dispatch entry point — any unwired chain still returns 'unknown' via the no-deployed-address path."
  - "Conditional-spread instead of `name: cond ? {} : undefined` for hardhat networks: the spread pattern (`...(cond ? { name: {...} } : {})`) emits the network key only when the gate holds; the HardhatUserConfig type does not need to accept undefined values, and the runtime behavior is identical (Hardhat ignores absent network entries)."
  - "spawnSync shell:true on the deploy CLI: required for `npx` (which is `npx.cmd` on Windows) to resolve via cmd.exe shim; harmless on POSIX shells which resolve npx from PATH directly. Without it the script fails with ENOENT on the operator's Win11 dev environment."
  - "Did NOT pass HARDHAT_PRIVATE_KEY env shim to spawnSync (RESEARCH.md line 922-923 had it; plan 18-06 explicitly excluded it). The hardhat config (Task 2) reads DEPLOY_PRIVATE_KEY directly via its network-entry guard; the spawn inherits process.env so DEPLOY_PRIVATE_KEY is in scope without the rename. Plan 18-07 will smoke-test on testnet and add the shim back if 0.15.x Ignition requires it."

requirements-completed: [HONEY-05]

# Metrics
duration: 12min
completed: 2026-05-15
---

# Phase 18 Plan 06: ChainConfig HoneypotChecker Wiring + Multi-Chain Deploy Infrastructure Summary

**Promoted `ctx.chain.honeypotChecker` from a wave-2 optional declaration-merge bridge to a required source-of-truth field on `ChainConfig`; wired the per-chain env overlay (`<PREFIX>_HONEYPOT_CHECKER_ADDRESS` + `<PREFIX>_MAX_{BUY,SELL}_TAX_BPS` with fail-loud bps validation); extended `hardhat.config.ts` with conditional mainnet/bsc/base/arbitrum network entries (using `DEPLOY_PRIVATE_KEY` per D-DEPLOY-KEY capability split, not bot's `PRIVATE_KEY`) and the `etherscan.apiKey` block for `@nomicfoundation/hardhat-verify`; shipped `scripts/deploy-honeypot-checker.ts` as the operator-facing per-chain deploy CLI.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-15T21:30:24Z
- **Completed:** 2026-05-15T21:41:58Z
- **Tasks:** 3 / 3
- **Files created:** 1 (scripts/deploy-honeypot-checker.ts)
- **Files modified:** 4 (src/chainRegistry.ts, src/utils/honeypot/index.ts, hardhat.config.ts, test/unit/chainRegistry.test.ts)
- **Unit tests:** 269/269 pass (+8 new in chainRegistry.test.ts; was 261 baseline, now 269)

## Accomplishments

- **HONEY-05 multi-chain config wiring closed**: every enabled chain now exposes `ctx.chain.honeypotChecker.{deployedAddress, method, maxBuyTaxBps, maxSellTaxBps}` as type-safe required fields. Downstream dispatch (`src/utils/honeypot/index.ts simulateHoneypotRoundtrip`) reads them directly without optional chaining or NULL_CFG fallback.
- **D-TAX-THRESHOLDS default 1000 bps** baked into all 4 CHAIN_TEMPLATES entries (eth/bsc/base/arb); overridable per chain via `<PREFIX>_MAX_BUY_TAX_BPS` / `<PREFIX>_MAX_SELL_TAX_BPS`.
- **T-18-21 mitigation in place**: invalid tax-bps env (out-of-range, negative, NaN) triggers `log.fatal({ chain, key, value }, msg)` + `process.exit(1)`. Three dedicated tests cover the three invalid-shape paths.
- **D-DEPLOY-KEY capability split enforced**: hardhat.config new mainnet networks use `DEPLOY_PRIVATE_KEY` exclusively; existing sepolia entry continues to use `PRIVATE_KEY` (test-only deploys); bot wallet has no deploy authority on any production chain.
- **Per-chain deploy CLI shipped**: `npx ts-node scripts/deploy-honeypot-checker.ts <eth|bsc|base|arb>` — fatal-exits with pino-structured log on missing DEPLOY_PRIVATE_KEY or invalid chain; otherwise spawns `npx hardhat ignition deploy ignition/modules/HoneypotChecker.ts --network <network>`. Three fatal paths smoke-tested end-to-end (no args, invalid chain, missing key) — all log structured fatal + exit code 1.

## Task Commits

Each task was committed atomically:

1. **Task 1: ChainConfig.honeypotChecker required field + per-chain env overlay (TDD)** — `fdeeefa` (feat)
   - 3 files: src/chainRegistry.ts, src/utils/honeypot/index.ts, test/unit/chainRegistry.test.ts
   - 8 new unit tests (5 from plan spec + 3 fatal-exit edge cases for NaN / negative / >10000 bps)
2. **Task 2: Per-chain deploy networks + etherscan.apiKey in hardhat.config.ts** — `c00de8e` (feat)
   - 1 file: hardhat.config.ts
3. **Task 3: scripts/deploy-honeypot-checker.ts per-chain CLI wrapper** — `511aa96` (feat)
   - 1 file: scripts/deploy-honeypot-checker.ts

**Plan metadata commit pending after STATE.md / ROADMAP.md updates.**

## Files Created/Modified

- `src/chainRegistry.ts` — Imported and re-exported `HoneypotCheckerConfig` from `src/utils/honeypot/types`. Extended `ChainConfig` with the required `honeypotChecker: HoneypotCheckerConfig` field. Extended `ChainTemplate` with `honeypotMethod` / `defaultMaxBuyTaxBps` / `defaultMaxSellTaxBps`. Populated all 4 templates (eth/bsc/base/arb) with `honeypotMethod: 'on-chain-contract'` + `defaultMaxBuyTaxBps: 1000` + `defaultMaxSellTaxBps: 1000`. Added overlay block in `buildChainRegistry()` reading the 3 new env vars per chain with `Number.isNaN` / range / signed-int validation that calls `log.fatal` + `process.exit(1)` on invalid input. Populated the `honeypotChecker` field of the constructed `ChainConfig` object.
- `src/utils/honeypot/index.ts` — Removed the plan-18-02 declaration-merge augmentation (`declare module '../../chainRegistry'`) and the NULL_CFG fallback. The dispatch reads `ctx.chain.honeypotChecker` directly as a required field.
- `hardhat.config.ts` — Added `import "@nomicfoundation/hardhat-ignition-ethers"`. Added 4 conditional network entries (mainnet/bsc/base/arbitrum) with chainIds 1/56/8453/42161, each gated on `<CHAIN>_RPC_URL && DEPLOY_PRIVATE_KEY`. Added a top-level `etherscan.apiKey` block with `mainnet/bsc/base/arbitrumOne` keys (arbitrumOne is the canonical hardhat-verify name for Arbitrum One).
- `scripts/deploy-honeypot-checker.ts` — NEW per-chain CLI wrapper. Reads chain argv → maps via `CHAIN_TO_NETWORK = { eth: 'mainnet', bsc: 'bsc', base: 'base', arb: 'arbitrum' }`. Fatal-exits on missing or invalid chain argv. Fatal-exits on missing `DEPLOY_PRIVATE_KEY`. Spawns `npx hardhat ignition deploy ignition/modules/HoneypotChecker.ts --network <network>` with `shell: true` (Windows npx.cmd compatibility). Post-deploy log line instructs the operator on the `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` env step and the `npx hardhat verify` follow-up. T-18-23 mitigated: does NOT auto-update `src/chainRegistry.ts`; manual paste preserves audit trail.
- `test/unit/chainRegistry.test.ts` — Added 8 new test cases: (1) default `deployedAddress === null` for every chain, (2) ETH address env overlay, (3) default 1000 bps for all 4 chains, (4) ETH bps env override + BSC unchanged, (5) default method `'on-chain-contract'` for every chain, (6) > 10000 bps fatal exit, (7) negative bps fatal exit, (8) NaN bps fatal exit. Added per-test env-stash scaffolding (`vi.resetModules` + `afterEach` cleanup of `HONEYPOT_ENV_KEYS`) so each test re-imports `chainRegistry` with a clean env.

## Decisions Made

- **Required-field promotion over keeping declaration-merge augmentation**: Plan 18-02 deferred the source-of-truth extension to plan 18-06 by declaration-merging an optional `honeypotChecker?` onto `ChainConfig` from the dispatch file. This plan removes that augmentation and promotes the field to a required member on `ChainConfig` itself. Rationale: the field is now populated by every CHAIN_TEMPLATES entry via `buildChainRegistry`, so making it optional in the type system would have allowed runtime `undefined` access bugs the compiler should catch. The NULL_CFG fallback in `src/utils/honeypot/index.ts` was also removed — the no-deployed-address case still flows through the `'unknown'` verdict path, but via the explicit `if (!cfg.deployedAddress)` check, not via an implicit NULL_CFG.
- **Re-export `HoneypotCheckerConfig` from chainRegistry**: The canonical declaration lives in `src/utils/honeypot/types.ts` (plan 18-02), but importing from chainRegistry alongside `ChainConfig` is the natural import path for most downstream callers. The `export type { HoneypotCheckerConfig }` re-export gives them that import locality without duplicating the declaration. Matches the pattern of `SafetyApiConfig` and `GasConfig` being co-located with `ChainConfig`.
- **`shell: true` on the deploy CLI's spawnSync**: Windows `npx` is actually `npx.cmd` (a shell shim); plain `spawnSync('npx', ...)` returns ENOENT without a shell to resolve the `.cmd` extension. `shell: true` resolves through the OS shell on both platforms, identical runtime semantics, no security regression (no shell-meta-character injection — all args are statically defined in this script).
- **Conditional-spread over `undefined` literal in hardhat networks**: Plan instructions allowed either pattern (`name: cond ? {} : undefined` or the spread `...(cond ? { name: {} } : {})`). Chose the spread because (a) `HardhatUserConfig` doesn't have to accept `undefined` values in `networks` (cleaner type), and (b) the runtime emits the key only when both env gates are set rather than emitting an `undefined` value that Hardhat must then ignore.
- **Did NOT pass HARDHAT_PRIVATE_KEY env shim**: RESEARCH.md §6 line 922-923 showed `env: { ...process.env, HARDHAT_PRIVATE_KEY: process.env.DEPLOY_PRIVATE_KEY }` but the plan instructions explicitly excluded this. The hardhat config (Task 2) reads `DEPLOY_PRIVATE_KEY` directly via its network-entry guard, so the spawn inherits the key via `process.env` without rename. Plan 18-07 will smoke-test on a real chain and add the shim back if Ignition 0.15.x requires it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Windows npx.cmd ENOENT in scripts/deploy-honeypot-checker.ts**
- **Found during:** Task 3 smoke-test of fatal paths
- **Issue:** `spawnSync('npx', [...])` without `shell: true` returns ENOENT on Windows because `npx` is `npx.cmd` (a batch-file shim); the child_process spawn API does not auto-resolve `.cmd` extensions on Win32.
- **Fix:** Added `shell: true` to the spawnSync options. POSIX shells resolve `npx` from PATH natively, so the option is benign cross-platform. All arguments are statically defined (no user-supplied strings) — no shell-meta-character injection risk.
- **Files modified:** scripts/deploy-honeypot-checker.ts (single-line option addition)
- **Verification:** All 3 smoke-test fatal paths (no args / invalid chain / missing key) now exit with structured pino fatal logs + exit code 1, both on Windows (verified) and on POSIX (by inspection — `shell: true` is no-op for non-shim binaries).
- **Committed in:** `511aa96` (Task 3 commit)

**2. [Rule 3 - Blocking] Plan-verify regex flagged `console.log` literal inside doc comment**
- **Found during:** Task 3 grep verification
- **Issue:** First-draft doc-comment text contained the literal string `console.log` (within "no `console.log` per project convention"), which the plan's `if (/console\.(log|error)/.test(f))` regex caught as a forbidden pattern.
- **Fix:** Rephrased the doc comment to "the console API is intentionally not used per project convention" — same meaning, no literal match.
- **Files modified:** scripts/deploy-honeypot-checker.ts (single-line comment rewrite)
- **Verification:** grep regex now passes (`OK`); semantic intent of the comment preserved.
- **Committed in:** `511aa96` (Task 3 commit)

**3. [Rule 3 - Blocking] vi.resetModules needed in TDD test setup for fresh env reads**
- **Found during:** Task 1 RED tests — `process.env.ETH_HONEYPOT_CHECKER_ADDRESS=...` set inside a test was not picked up by `buildChainRegistry()` because the module had been cached on the first `beforeEach` import.
- **Issue:** vitest caches dynamic imports per worker; setting `process.env.<KEY>` after the cached `buildChainRegistry` was already imported didn't re-read env in subsequent tests.
- **Fix:** Added `vi.resetModules()` inside both the `beforeEach` and per-test setup where the test mutates env vars. Each affected test calls `vi.resetModules(); const mod = await import('../../src/chainRegistry'); const registry = mod.buildChainRegistry()` to ensure the module re-reads env from scratch.
- **Files modified:** test/unit/chainRegistry.test.ts (env-stash + reset scaffolding)
- **Verification:** All 8 new tests + 7 existing tests pass on `npx vitest run --project unit test/unit/chainRegistry.test.ts` (15/15).
- **Committed in:** `fdeeefa` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 blocking issues; no Rule 1 bugs, no Rule 2 missing-features, no Rule 4 architectural).
**Impact on plan:** All 3 deviations were small mechanical fixes required to make the plan's verification gates and test scaffolding work. No scope creep, no design change.

## Issues Encountered

None beyond the 3 documented auto-fixed deviations. All three tasks completed with their verify gates exiting clean.

## Threat Flags

No new threat surface beyond what the plan's `<threat_model>` already enumerates. All four mitigations specified in the threat register were implemented:

- **T-18-20 (Bot wallet has deploy authority)** — `hardhat.config.ts` Task 2 new networks use `DEPLOY_PRIVATE_KEY` exclusively; grep verification of the file confirms `mainnet:` / `bsc:` / `base:` / `arbitrum:` all reference `DEPLOY_PRIVATE_KEY`, NOT `PRIVATE_KEY`. Existing `sepolia` entry retains `PRIVATE_KEY` per the capability split (sepolia is a test-only deploy).
- **T-18-21 (Tampering — out-of-range tax bps)** — `src/chainRegistry.ts` Task 1 step (h) implements the `Number.isNaN || > 10000 || < 0` guard with `log.fatal + process.exit(1)`. Three dedicated unit tests (Test 6: >10000, Test 7: negative, Test 8: NaN) confirm the fatal exit fires on each invalid path.
- **T-18-22 (DEPLOY_PRIVATE_KEY left in .env)** — `scripts/deploy-honeypot-checker.ts` fatal-message instructs the operator to rotate the key out of `.env` after deploy ("Rotate this key out of .env after deploy per D-DEPLOY-KEY."). Enforcement is operational (runbook in plan 18-07/18-08) not code-level, as specified in the threat register.
- **T-18-23 (Auto-update of chainRegistry leaves no audit trail)** — `scripts/deploy-honeypot-checker.ts` deliberately does NOT auto-modify `src/chainRegistry.ts`. The post-deploy log line instructs the operator to manually paste the address into the `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` env var; the git-history record of which contract address became canonical at which commit is preserved by that manual step.
- **T-18-SC (npm installs)** — No new packages added; `@nomicfoundation/hardhat-ignition-ethers` was already in `package.json` devDeps per the plan's `accept` disposition.

## Self-Check: PASSED

Verified files exist on disk:
- scripts/deploy-honeypot-checker.ts: FOUND
- src/chainRegistry.ts: FOUND (modified)
- src/utils/honeypot/index.ts: FOUND (modified)
- hardhat.config.ts: FOUND (modified)
- test/unit/chainRegistry.test.ts: FOUND (modified)

Verified commits in git log:
- fdeeefa: feat(18-06): extend ChainConfig with honeypotChecker field + per-chain env overlay — FOUND
- c00de8e: feat(18-06): add per-chain deploy networks + etherscan.apiKey to hardhat.config — FOUND
- 511aa96: feat(18-06): add per-chain HoneypotChecker deploy CLI wrapper — FOUND

Verified plan acceptance criteria:
- src/chainRegistry.ts has `honeypotChecker` field on ChainConfig (verified — line containing `honeypotChecker: HoneypotCheckerConfig`).
- src/chainRegistry.ts has 4 templates with `defaultMaxBuyTaxBps: 1000` (grep count: 4).
- src/chainRegistry.ts overlays 3 env vars per chain (HONEYPOT_CHECKER_ADDRESS, MAX_BUY_TAX_BPS, MAX_SELL_TAX_BPS): PASS.
- Out-of-range tax threshold env triggers fatal exit (tests 6/7/8 pass with the stubbed process.exit assertion): PASS.
- `npx tsc --noEmit` exits 0: PASS.
- `npx vitest run --project unit test/unit/chainRegistry.test.ts` exits 0 (7 existing + 8 new = 15/15 pass): PASS.
- `npx vitest run --project unit` exits 0 (269/269 pass, no regressions): PASS.
- No `as any` cast added: PASS (grep -E `\bas any\b` over modified files returns no new matches).
- hardhat.config.ts imports `@nomicfoundation/hardhat-ignition-ethers`: PASS.
- hardhat.config.ts has all 4 new networks with chainIds 1/56/8453/42161: PASS.
- All 4 new networks use `DEPLOY_PRIVATE_KEY` not `PRIVATE_KEY`: PASS (grep regex from plan exits OK).
- etherscan.apiKey block has 4 keys including `arbitrumOne`: PASS.
- `npx hardhat compile` exits 0: PASS ("Nothing to compile" — config parses with no deploy env set).
- scripts/deploy-honeypot-checker.ts uses `spawnSync('npx', ['hardhat', 'ignition', 'deploy', 'ignition/modules/HoneypotChecker.ts', '--network', network])`: PASS.
- Refuses to run with process.exit(1) on missing DEPLOY_PRIVATE_KEY: PASS (smoke-tested live).
- Refuses to run with process.exit(1) on missing or invalid chain argv: PASS (smoke-tested live, both `no-arg` and `ftm` paths).
- Uses `logger.child({ module: 'deploy-honeypot-checker' })`; no console.log: PASS (grep regex from plan exits OK).
- Post-deploy hint mentions chainRegistry.ts paste step AND `npx hardhat verify`: PASS.

## Next Phase Readiness

**Plans 18-07 / 18-08 (chain deploys)** — READY. The deploy CLI is in place; hardhat.config has per-chain network entries; etherscan.apiKey block is wired for post-deploy verification. Operator workflow:
  1. Create deploy wallet, fund ~$10-20 of native gas across 4 chains (T-18-22 / D-DEPLOY-KEY).
  2. Set `DEPLOY_PRIVATE_KEY`, `<CHAIN>_RPC_URL`, `<CHAIN>SCAN_API_KEY` in `.env`.
  3. Run `npx ts-node scripts/deploy-honeypot-checker.ts eth` (per chain).
  4. Paste deployed address into `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` env.
  5. Run `npx hardhat verify --network mainnet <address>`.
  6. Rotate `DEPLOY_PRIVATE_KEY` out of `.env`.

**Plan 18-09 (Option-D wrapper implementation)** — READY. `ctx.chain.honeypotChecker.deployedAddress` is now the canonical source of truth for the on-chain contract address (read by `simulateViaContractV2` / `simulateViaContractV3` after plan 18-09 overwrites the wave-5 placeholder).

**Plans 18-10 / 18-11 (in-place bot.ts gate replacement)** — READY. `ctx.chain.honeypotChecker.maxBuyTaxBps` / `maxSellTaxBps` are available for the verdict-evaluation step that decides whether a tax-positive `safe` verdict from the contract still trips the threshold gate.

No blockers. No carry-forward debt.

---
*Phase: 18-honeypot-detection-rebuild*
*Completed: 2026-05-15*
