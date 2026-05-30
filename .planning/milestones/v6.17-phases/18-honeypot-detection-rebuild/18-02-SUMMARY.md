---
phase: 18-honeypot-detection-rebuild
plan: 02
subsystem: safety
tags: [solidity, hardhat, ignition, ethers-v6, typescript, discriminated-union, uniswap-v2, uniswap-v3, honeypot-detection]

# Dependency graph
requires:
  - phase: 18-honeypot-detection-rebuild
    provides: REQUIREMENTS.md HONEY-12 row + locked architectural decisions (D-CONTRACT-IMMUTABLE, D-CONTRACT-SCOPE, D-UNKNOWN-POLICY)
  - phase: 17-tech-debt-cleanup-audit-baseline
    provides: clean CI baseline (tsc x3, .todo ban) + D-13/D-14 strict-type discipline
provides:
  - immutable on-chain HoneypotChecker.sol with checkV2 + checkV3 entry points (V2 + V3 buy-sell roundtrip with post-trade lying-balanceOf and silent-zero-eth catches)
  - 5 custom errors (RoundtripResult, RoundtripResultV3, BuyFailed, SellFailed, QuoteFailed) for revert-payload-as-return-channel pattern
  - Hardhat Ignition module (HoneypotCheckerModule) ready for plans 18-07 / 18-08 chain deploys
  - HoneypotResult discriminated union making vacuous-pass unrepresentable in the type system (HONEY-06)
  - HoneypotEvidence + HoneypotProbeResult + HoneypotCheckerConfig types (single source of truth for plan 18-06 chainRegistry extension)
  - HONEYPOT_CHECKER_ABI human-readable fragment matching contract surface (V2 + V3 + 5 errors)
  - simulateHoneypotRoundtrip dispatch routing on dex.dexType (V2/V3 split) AND cfg.method (Option-D/Option-C split); never throws on bad method (D-UNKNOWN-POLICY)
  - simulator.ts Option-C stub (returns verdict='unknown' with NOT_IMPLEMENTED reason; full impl deferred to v6.18+)
  - checkerContract.ts placeholder with sentinel 'NOT_IMPLEMENTED: checkerContract wave-5 deliverable' for plan 18-09 grep-gate
  - 5 HONEY-06 compile-gate tests under test/unit/honeypotTypes.test.ts
affects: [18-03, 18-04, 18-05, 18-06, 18-07, 18-08, 18-09, 18-10, 18-11]

# Tech tracking
tech-stack:
  added:
    - "Solidity 0.8.28 contract directory (contracts/honeypot/)"
    - "Hardhat Ignition module directory (ignition/modules/)"
    - "src/utils/honeypot/ module (types + abi + dispatch + simulator stub + checkerContract placeholder)"
  patterns:
    - "Revert-payload-as-return-channel: contract always reverts with custom error; ethers v6 Interface.parseError decodes the payload as the verdict"
    - "Private helper functions to avoid Solidity stack-too-deep (_v2Buy/_v2Sell/_v3Buy/_v3Sell) instead of viaIR"
    - "Discriminated-union return type via TS intersection (safe variant tightens evidence to require buyTaxBps/sellTaxBps as number)"
    - "Module augmentation pattern for cross-plan type evolution (ChainConfig.honeypotChecker? augmented here; plan 18-06 promotes to required field)"
    - "Sentinel comment pattern for wave-deferred placeholders (literal string grep-asserted absent post-overwrite)"

key-files:
  created:
    - "contracts/honeypot/HoneypotChecker.sol (362 LOC, immutable V2+V3 checker)"
    - "ignition/modules/HoneypotChecker.ts (Hardhat Ignition module)"
    - "ignition/.gitignore (excludes deployments journal.jsonl)"
    - "src/utils/honeypot/types.ts (HoneypotResult discriminated union + HoneypotCheckerConfig)"
    - "src/utils/honeypot/abi.ts (HONEYPOT_CHECKER_ABI as const tuple)"
    - "src/utils/honeypot/index.ts (simulateHoneypotRoundtrip dispatch)"
    - "src/utils/honeypot/simulator.ts (Option-C stub)"
    - "src/utils/honeypot/checkerContract.ts (PLACEHOLDER with wave-5 sentinel)"
    - "test/unit/honeypotTypes.test.ts (5 HONEY-06 compile-gate tests)"
  modified: []

key-decisions:
  - "Refactored checkV2/checkV3 into private _v2Buy/_v2Sell/_v3Buy/_v3Sell helpers to resolve Solidity stack-too-deep without enabling viaIR (Rule 1 auto-fix; preserves audit determinism per PATTERNS.md cross-cutting decision 4)"
  - "Module-augmented ChainConfig with optional honeypotChecker? field instead of waiting for plan 18-06 — keeps tsc green this wave while preserving runtime correctness (missing config flows through 'bad-method' → verdict='unknown')"
  - "V3 sell-direction assertion checks WETH balance (V3 SwapRouter02 returns WETH, not ETH); V3_SELL_WETH_ZERO is the semantic equivalent of V2's SELL_ETH_ZERO"
  - "BUY_BAL_LIE on V3: cross-checks IERC20.balanceOf delta against router-returned amountOut to catch lying-balanceOf attack class even though V3 returns amountOut directly"

patterns-established:
  - "Sentinel comment for wave-deferred placeholders: literal 'NOT_IMPLEMENTED: checkerContract wave-5 deliverable' grep-asserted absent in plan 18-09 acceptance criterion"
  - "Discriminated-union HoneypotResult: safe variant intersection requires { buyTaxBps: number; sellTaxBps: number } (not optional) — makes vacuous-pass literal unrepresentable at tsc compile time"
  - "Status bitmap shared between V2 and V3 paths: 0x01 sold-some, 0x02 bal-nonzero, 0x04 sell-ok; status === 0x07 ⇒ safe"
  - "Module-augmentation bridge across plans: declare module '../../chainRegistry' { interface ChainConfig { honeypotChecker?: HoneypotCheckerConfig; } } lets the dispatch type-check today; plan 18-06 promotes the field to a required member on the source-of-truth interface"

requirements-completed: [HONEY-01, HONEY-05, HONEY-06]

# Metrics
duration: 17min
completed: 2026-05-16
---

# Phase 18 Plan 02: HoneypotChecker.sol + TypeScript Skeleton Summary

**Immutable Solidity HoneypotChecker (V2 checkV2 + V3 checkV3 entry points, 5 custom errors, 362 LOC) plus a TypeScript module skeleton (discriminated-union HoneypotResult, HONEYPOT_CHECKER_ABI fragment, dispatch routing on dex.dexType + cfg.method, Option-C stub, plan-18-09 sentinel placeholder).**

## Performance

- **Duration:** 17 min
- **Started:** 2026-05-16T00:18:00Z
- **Completed:** 2026-05-16T00:35:36Z
- **Tasks:** 3 / 3
- **Files created:** 9
- **Files modified:** 0

## Accomplishments

- HoneypotChecker.sol (362 LOC) compiles cleanly under solc 0.8.28 (exact pin) with both `checkV2(router, token, amountIn)` and `checkV3(swapRouter, quoter, token, amountIn, fee)` entry points per iter-2 Blocker #1, including post-trade `BUY_BAL_ZERO` / `SELL_ETH_ZERO` (V2) and `BUY_BAL_LIE` / `V3_SELL_WETH_ZERO` (V3) assertions
- HoneypotResult discriminated union makes the vacuous-pass literal `{ verdict: 'safe', evidence: {} }` fail `tsc --noEmit` by construction (HONEY-06 compile-gate)
- Dispatch (`simulateHoneypotRoundtrip`) routes on `dex.dexType` AND `cfg.method` and NEVER throws on unknown method (D-UNKNOWN-POLICY)
- Plan 18-09 sentinel-grep gate ready: `NOT_IMPLEMENTED: checkerContract wave-5 deliverable` literal embedded in checkerContract.ts placeholder

## Task Commits

Each task was committed atomically:

1. **Task 1: HoneypotChecker.sol + Ignition module** — `d46af56` (feat)
2. **Task 2: types.ts + abi.ts (TDD)**
   - RED — `d4f17bc` (test): 5 compile-gate tests + 3 `@ts-expect-error` directives
   - GREEN — `f26a2d7` (feat): HoneypotResult discriminated union + HONEYPOT_CHECKER_ABI tuple
3. **Task 3: index.ts dispatch + simulator.ts stub + checkerContract.ts placeholder** — `1865b51` (feat)

**Plan metadata commit pending after STATE.md / ROADMAP.md updates.**

## Files Created/Modified

- `contracts/honeypot/HoneypotChecker.sol` — Immutable Solidity contract with V2 + V3 buy-sell roundtrip; 5 custom errors; private helpers `_v2Buy`/`_v2Sell`/`_v3Buy`/`_v3Sell` to avoid stack-too-deep; `receive() external payable {}` for V2 router refund
- `ignition/modules/HoneypotChecker.ts` — `buildModule('HoneypotCheckerModule', m => { const checker = m.contract('HoneypotChecker', []); return { checker }; })`
- `ignition/.gitignore` — Excludes `deployments/*/journal.jsonl` (commits `deployed_addresses.json`)
- `src/utils/honeypot/types.ts` — `HoneypotEvidence` + `HoneypotProbeResult` + `HoneypotResult` (3-variant discriminated union with `safe`-tightening intersection) + `HoneypotCheckerConfig`
- `src/utils/honeypot/abi.ts` — `HONEYPOT_CHECKER_ABI as const` tuple: 2 functions + 5 errors matching contract surface exactly
- `src/utils/honeypot/index.ts` — `simulateHoneypotRoundtrip(ctx, dex, token)` dispatch with module-augmentation of `ChainConfig.honeypotChecker?`
- `src/utils/honeypot/simulator.ts` — Option-C stub returning `verdict: 'unknown'` with `NOT_IMPLEMENTED` reason
- `src/utils/honeypot/checkerContract.ts` — PLACEHOLDER with sentinel; exports `simulateViaContractV2` + `simulateViaContractV3` so dispatch compiles before plan 18-09 lands real implementations
- `test/unit/honeypotTypes.test.ts` — 5 compile-gate tests asserting (a) vacuous-pass literals fail tsc, (b) properly-formed `safe` literal compiles, (c) `unsafe`/`unknown` require `reason`, (d) narrowing on `verdict === 'safe'` exposes `buyTaxBps` as `number` (not `number | undefined`)

## Decisions Made

- **Module augmentation over delayed wiring:** Rather than block on plan 18-06 to land the `ChainConfig.honeypotChecker` field, the dispatch file declares a TypeScript module-augmentation that makes the field optional NOW. Plan 18-06 will replace the optional augmentation with a required field on the source-of-truth `ChainConfig` interface. This keeps tsc green this wave AND preserves runtime correctness — any chain not yet wired up flows through the `bad-method`/`no-deployed-address` branches and returns `verdict: 'unknown'` (fail-closed, per D-UNKNOWN-POLICY).
- **Private helpers over viaIR:** Solidity stack-too-deep on `checkV2` was fixed by extracting `_v2Buy` and `_v2Sell` private helper functions rather than enabling `viaIR: true` in `hardhat.config.ts`. Rationale: changing the compiler pipeline mid-phase would invalidate the audit-determinism property called out in PATTERNS.md cross-cutting decision 4 (exact-pin solc, no IR variation). Same treatment for `checkV3` proactively.
- **V3 success signal is WETH balance:** V3 SwapRouter02 returns WETH (not native ETH) to the recipient unless `unwrapWETH9` is called separately. The V3 sell-side assertion checks `IWETH(weth).balanceOf(address(this)) == 0` instead of `address(this).balance` (the V2 path); `V3_SELL_WETH_ZERO` is the semantic equivalent of V2's `SELL_ETH_ZERO`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Solidity stack-too-deep on initial checkV2 + checkV3 single-function shapes**
- **Found during:** Task 1 (HoneypotChecker.sol initial compile attempt)
- **Issue:** First-pass `checkV2` (single function, ~70 LOC inline) and `checkV3` (single function, ~80 LOC inline) each exceeded the Solidity EVM-paris stack-depth limit (16 slots) for live local variables; `npx hardhat compile` failed with "Stack too deep" at the terminal `revert RoundtripResult(...)` site.
- **Fix:** Refactored each entry point into a thin wrapper that calls two private helpers — `_v2Buy` / `_v2Sell` for `checkV2`, `_v3Buy` / `_v3Sell` for `checkV3` — so each helper's live-locals stay below the limit. Wrappers stay <20 LOC each; helpers each <80 LOC. Behavior preserved verbatim; verified via re-compile (clean exit) and grep for required revert reasons (`BUY_BAL_ZERO`, `SELL_ETH_ZERO`, `V3_SELL_WETH_ZERO`, `BUY_BAL_LIE`).
- **Why not enable viaIR:** PATTERNS.md cross-cutting decision 4 mandates audit determinism via exact solc pin + default pipeline; enabling viaIR would change the compiled bytecode shape and require auditor re-review of Phase 18's Slither/Mythril output (plan 18-05). Helper-extraction is the smaller-diff, audit-preserving path.
- **Files modified:** `contracts/honeypot/HoneypotChecker.sol`
- **Verification:** `npx hardhat compile` exits 0; artifact at `artifacts/contracts/honeypot/HoneypotChecker.sol/HoneypotChecker.json` exists (40,186 bytes); grep confirms all required errors + revert reasons + interfaces remain
- **Committed in:** `d46af56` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary correctness fix; preserves audit determinism and contract semantics. No scope creep; no design change. Plan-checker iter-2 spec for `checkV2` / `checkV3` body content preserved verbatim inside the helpers.

## Issues Encountered

None beyond the documented deviation. All three tasks completed with first-pass verification clean (Tasks 2 and 3 needed no fixes).

## Threat Flags

No new threat surface beyond what the plan's `<threat_model>` already enumerates. All mitigations specified in the threat register were implemented as planned:
- T-18-03 mitigated: `if (balAfter <= balBefore) revert BuyFailed("BUY_BAL_ZERO");` (HoneypotChecker.sol line 145)
- T-18-04 mitigated: `if (ethAfter <= ethBefore) revert SellFailed("SELL_ETH_ZERO");` (line 179)
- T-18-03b mitigated: `if (balAfter - balBefore < received) revert BuyFailed("BUY_BAL_LIE");` (line 282-285)
- T-18-04b mitigated: `if (wethReceived == 0) revert SellFailed("V3_SELL_WETH_ZERO");` (line 348-351)
- T-18-05 mitigated: compile-gate test 1 + 2 in `test/unit/honeypotTypes.test.ts` exercise the vacuous-pass-fails-tsc invariant
- T-18-06 mitigated: grep over `contracts/honeypot/HoneypotChecker.sol` confirms no `selfdestruct`, no `tx.origin`, no `onlyOwner` — only a doc-comment match on line 87 documenting their absence
- T-18-08 mitigated: grep over `src/utils/honeypot/index.ts` confirms 0 occurrences of `throw new Error`
- T-18-08b mitigated: index.ts contains explicit `dex.dexType === 'v3'` branch (line 65)
- T-18-08c mitigated: checkerContract.ts contains the sentinel comment verbatim (line 3)

## Self-Check: PASSED

Verified files exist on disk:
- contracts/honeypot/HoneypotChecker.sol: FOUND (362 LOC)
- ignition/modules/HoneypotChecker.ts: FOUND
- ignition/.gitignore: FOUND
- src/utils/honeypot/types.ts: FOUND
- src/utils/honeypot/abi.ts: FOUND
- src/utils/honeypot/index.ts: FOUND
- src/utils/honeypot/simulator.ts: FOUND
- src/utils/honeypot/checkerContract.ts: FOUND
- test/unit/honeypotTypes.test.ts: FOUND
- artifacts/contracts/honeypot/HoneypotChecker.sol/HoneypotChecker.json: FOUND (40,186 bytes)

Verified commits in git log:
- d46af56: feat(18-02): add HoneypotChecker.sol with checkV2 + checkV3 + Ignition module — FOUND
- d4f17bc: test(18-02): add HONEY-06 HoneypotResult compile-gate tests — FOUND
- f26a2d7: feat(18-02): add HoneypotResult discriminated union + HONEYPOT_CHECKER_ABI — FOUND
- 1865b51: feat(18-02): add simulateHoneypotRoundtrip dispatch + V2/V3 placeholders + simulator stub — FOUND

Verified plan acceptance criteria:
- `npx hardhat compile` exits 0 (re-run at end of plan): PASS
- `npx tsc --noEmit` exits 0: PASS
- `npx vitest run --project unit test/unit/honeypotTypes.test.ts` exits 0 (5/5 passed): PASS
- Both `function checkV2(` and `function checkV3(` present in HoneypotChecker.sol: PASS
- All 5 custom errors present (RoundtripResult, RoundtripResultV3, BuyFailed, SellFailed, QuoteFailed): PASS
- All literal revert reasons present (BUY_BAL_ZERO, SELL_ETH_ZERO, V3_SELL_WETH_ZERO, BUY_BAL_LIE): PASS
- `receive() external payable {}` present: PASS
- 0 occurrences of `selfdestruct`/`tx.origin`/`onlyOwner` in contract code (only doc comment): PASS
- checkerContract.ts contains the literal sentinel `NOT_IMPLEMENTED: checkerContract wave-5 deliverable`: PASS
- index.ts has 0 occurrences of `throw new Error`: PASS
- ABI fragment contains all 7 required identifiers (checkV2, checkV3, RoundtripResult, RoundtripResultV3, BuyFailed, SellFailed, QuoteFailed): PASS

## Next Phase Readiness

**Plans 18-03 / 18-04 (Wave 1, parallel to this plan)** — independent; do not block on plan 18-02 artifacts.

**Plan 18-05 (Wave 2, Slither + Mythril audit)** — READY to consume `contracts/honeypot/HoneypotChecker.sol` (compiles clean, both V2 + V3 entry points present, no admin surface).

**Plan 18-06 (Wave 2, chainRegistry extension)** — READY to import `HoneypotCheckerConfig` from `src/utils/honeypot/types.ts` and replace the module-augmentation in `src/utils/honeypot/index.ts` with a required field on the source-of-truth `ChainConfig` interface.

**Plan 18-09 (Wave 5, Option-D wrapper implementation)** — READY: the placeholder file `src/utils/honeypot/checkerContract.ts` is in place with the sentinel comment; plan 18-09 Task 1 will overwrite the file and grep-assert the sentinel is absent.

**Plans 18-07 / 18-08 (chain deploys)** — READY: `ignition/modules/HoneypotChecker.ts` ships the deployment module.

No blockers. No carry-forward debt.

---
*Phase: 18-honeypot-detection-rebuild*
*Completed: 2026-05-16*
