# Phase 18: Honeypot Detection Rebuild - Research

**Researched:** 2026-05-15
**Domain:** Pre-buy honeypot detection on Ethereum + 3 EVM chains; on-chain `HoneypotChecker.sol` deploy + dispatch
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Architecture (CLOSED by research convergence — not re-evaluating Option A/B/C/D):**

- **D-CONTRACT-SCOPE:** Roundtrip + post-trade sanity assertions (~100-120 LOC). Inside one
  `eth_call`: approve router for WETH → buy via router measuring buy-tax bps → **assert
  post-buy `balanceOf(this) > 0`** (catches lying-balanceOf honeypot pattern) → approve
  router for tokens → sell via router measuring sell-tax bps → **assert post-sell
  `address(this).balance > preBalance`** (catches silent-zero-ETH-on-sell) → revert at
  end with ABI-encoded `(buyTaxBps, sellTaxBps, success)` payload. Does NOT bundle
  max-wallet/blacklist/tax setter checks — those remain as parallel-bank gates under
  HONEY-11 audit (defense-in-depth).

- **D-CONTRACT-IMMUTABLE:** Contract is immutable; no owner key, no UUPS proxy, no
  killSwitch. Patch path: deploy v2 at a new address, switch
  `chainRegistry[chain].honeypotChecker.deployedAddress`, restart bot.

- **D-CONTRACT-ROLLOUT:** ETH mainnet first (HONEY-03), 2-3 days live observation, then
  batch BSC/Base/Arb (HONEY-04). Bot runs `ENABLED_CHAINS=eth` during rollout.

- **D-AGGREGATION:** Strict at 50%/100% probes, advisory at 1%. 1% probe revert is
  evidence but does NOT block (tolerates dust math edges at 0.003 ETH snipe size).

- **D-TAX-THRESHOLDS:** Default 10% buy / 10% sell (1000 bps each), per chain via env
  (`ETH_MAX_BUY_TAX_BPS`, `BSC_MAX_BUY_TAX_BPS`, …). Defaults committed in
  `chainRegistry.ts` `CHAIN_TEMPLATES`.

- **D-UNKNOWN-POLICY:** `unknown` verdict → one-shot skip (no retry, no fallback to
  parallel bank). Strictest fail-closed.

- **D-AUDIT-TIMING:** HONEY-11 8-gate audit runs in parallel with contract authoring.
  HONEY-07/08 in-place replacements close only AFTER (a) the deployed contract is live
  on first chain AND (b) all audit-discovered fixes are merged.

- **D-AUDIT-BAR:** For each of the 8 parallel-bank gates: (a) code-read to verify
  underlying-behavior exercise, (b) regression test that would fail on vacuous-pass
  regression. Tests + findings committed in `.planning/milestones/v6.17-safety-bank-audit.md`.

- **D-BYTECODE (HONEY-12, new requirement):** Minimal bytecode selector-presence scan
  in Phase 18. New function `isMutableTokenForChain(ctx, token)`: pulls `getCode(token)`,
  greps for 4-byte selectors. Adds parallel-bank evidence; positive hit blocks the buy.
  ~50 LOC. No contract deploy.

- **D-BRIEFING-DISPOSITION:** `HONEYPOT-SIM-BRIEFING.md` is **deleted** at Phase 20
  OPS-LIVE-13. Phase 18 does not move or delete it.

- **D-FIXTURE:** Use both a contrived test contract AND 1-2 real pinned mainnet
  honeypots per chain. Contrived: `test/fixtures/contracts/Honeypot.sol`. Real:
  `test/fork/fixtures/honeypots/{slug}.json`.

- **D-DEPLOY-KEY:** New env var `DEPLOY_PRIVATE_KEY` for Hardhat Ignition deploy script.
  Deploy wallet separate from bot wallet. Key rotates out of `.env` after one-time use.

- **D-ALERTS:** Tiered Telegram alerts. On skip: verdict + reason + bps + token addr +
  Etherscan link. On safe: minimal existing format.

- **D-ROLLBACK:** Git-revert + redeploy; no legacy-code fallback flag. Phase 18
  **deletes** `simulateSellForChain` and `simulateSellV3ForChain` entirely. No
  `SAFETY_USE_LEGACY_SIM=true` retained.

- **D-STOP-THE-LINE:** Any production bug worse than the original (e.g., gate grants
  buys when it shouldn't) found during HONEY-11 audit or regression-test work BLOCKS
  Phase 18 close. Treated as first-class v6.17 requirement upgrade (likely HONEY-13+
  or decimal phase 18.1). Fix-in-flight and file-and-defer explicitly rejected.

### Claude's Discretion

- Exact Solidity revert-encoding shape (custom error vs ABI-encoded bytes32 payload vs
  uint256 packed) — within constraint that ethers v6 must decode cleanly via
  `Interface.decodeErrorResult` or `Interface.parseError`.
- `eth_call` balance source for the test buyer (state-override vs contract pre-funded
  WETH at deploy vs `msg.value` + `WETH.deposit` inside the call) — must work on
  Alchemy/Infura standard tier.
- Slither/Mythril CLI flags, severity thresholds, false-positive triage — within
  HONEY-02 constraint that flagged issues are triaged with documented disposition.
- Hardhat Ignition module file shape (`ignition/modules/HoneypotChecker.ts`),
  per-chain deploy script wrapper.
- Specific regression-test assertion text and fixture token selection for HONEY-11.
- Real-mainnet honeypot fixture selection — researcher recommends; planner finalizes.
- Whether to refine the existing `*New Token Detected!*` alert format at `bot.ts:268`.

### Deferred Ideas (OUT OF SCOPE)

- Owner-renunciation / tax-setter timelock state inspection beyond selector-presence —
  v6.18+ (HONEY-V2-02).
- N-of-M consensus across own simulator + third-party APIs — own simulator has veto;
  v6.18+ (HONEY-V2-03).
- Option C (`eth_simulateV1`) full implementation — Phase 18 ships the dispatch layer
  + a stub/skeleton only.
- Tax-change detection on open positions via periodic re-simulation — v6.18+
  (ANTIRUG-V2-03).
- Bytecode static analysis advanced patterns (transferFrom selector substitution,
  modifier-pattern detection, multi-address simulation) — v6.18+.
- Multi-amount tax probe at >100% of snipe size (rejected as uninformative).
- Dashboard surfacing of new evidence fields — Phase 21 or v6.18 dashboard pass.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HONEY-01 | Author `contracts/honeypot/HoneypotChecker.sol` (~100-120 LOC roundtrip + post-trade asserts; OZ `IERC20`; solc 0.8.28) | §"HoneypotChecker.sol Skeleton" + §"Solidity Revert-Encoding Shape" + §"`eth_call` Balance Source" |
| HONEY-02 | Slither + Mythril clean (or triaged) before mainnet deploy; report in `.planning/milestones/v6.17-honeypot-checker-audit.md` | §"Slither + Mythril Flags & Severity" |
| HONEY-03 | Deploy on ETH mainnet via Hardhat Ignition; Etherscan-verified; address in `CHAIN_TEMPLATES['eth']` | §"Hardhat Ignition Module Shape" |
| HONEY-04 | Deploy on BSC/Base/Arbitrum mainnets; per-chain verified; addresses in `CHAIN_TEMPLATES` | §"Hardhat Ignition Module Shape" + §"Per-Chain Deploy Wrapper" |
| HONEY-05 | `src/utils/honeypot/` module: `index.ts` (dispatch), `checkerContract.ts` (Option D), `simulator.ts` (Option C stub), `types.ts` (discriminated union) | §"Module Layout & Dispatch" |
| HONEY-06 | `HoneypotResult` discriminated union; `unknown` fails closed at every caller; vacuous-pass unrepresentable in type system | §"Discriminated-Union Types" |
| HONEY-07 | V2 gate at `bot.ts:220-226` replaced in-place with `simulateHoneypotRoundtrip` dispatch | §"Integration Wiring" + §"In-Place Gate Replacement" |
| HONEY-08 | V3 gate at `bot.ts:411-416` replaced in-place; `unknown` fails closed instead of vacuous true | §"Integration Wiring" + §"In-Place Gate Replacement" |
| HONEY-09 | Numerical buy-tax + sell-tax bps in `evidence`; per-chain `ETH_MAX_BUY_TAX_BPS` etc. enforced; structured pino on every check | §"Tax-BPS Extraction & Threshold Enforcement" |
| HONEY-10 | Multi-amount probe (1% / 50% / 100% of `snipeAmount`); aggregated into `HoneypotResult` per D-AGGREGATION | §"Multi-Amount Probe Arithmetic" |
| HONEY-11 | Audit pass on 8 parallel-bank gates for `amountIn=0`/vacuous-pass siblings; findings in `.planning/milestones/v6.17-safety-bank-audit.md` | §"safetyBank 8-Gate Audit Targets" |
| HONEY-12 *(new)* | Bytecode selector-presence scan: `isMutableTokenForChain` returns evidence in the parallel bank; positive hit blocks buy | §"Bytecode Selector Scan (HONEY-12)" |

</phase_requirements>

## Summary

Phase 18 rebuilds the broken pre-buy honeypot detection stack. The V2 sell-sim
(`simulateSellForChain` at `tokenSafety.ts:555-586`) hard-blocks every newly-launched
token by passing `balance=0n` to the router; the V3 sell-sim
(`simulateSellV3ForChain` at `tokenSafety.ts:593-634`) silently passes via a
`if (balance === 0n) return true;` vacuous-pass guard at line 603-606. Both paths are
deleted and replaced in-place with a single dispatch into a self-controlled,
immutable `HoneypotChecker.sol` contract that performs a real buy→sell roundtrip plus
post-trade sanity assertions on token-balance and ETH-balance deltas. The architecture
(Option D primary, Option C `eth_simulateV1` as fallback stub only) is closed by
CONTEXT.md and prior research convergence (STACK.md, ARCHITECTURE.md, PITFALLS.md);
this research does not re-evaluate it.

The novel research surface for this phase is operational, not architectural: (a) the
exact Solidity revert-encoding shape that decodes cleanly via ethers v6, (b) the
`eth_call` balance source for the test buyer that works on the bot's existing
Alchemy/Infura tier without Tenderly, (c) which historical mainnet honeypot tokens
to pin as fork-test fixtures and at which block, (d) the Slither + Mythril CLI
invocation and severity threshold that gates HONEY-02 deploy, (e) the
HoneypotChecker.sol storage layout + function signatures (target ~100-120 LOC), (f)
the Hardhat Ignition module shape + per-chain deploy script, (g) the 4-byte
selectors for the HONEY-12 bytecode scan, (h) verification that multi-amount probe
arithmetic doesn't truncate to zero at 0.003 ETH (it doesn't — verified below), and
(i) a Validation Architecture section so VALIDATION.md can be derived per Nyquist
convention.

**Primary recommendation:** Encode the contract's terminal revert as a Solidity
**custom error** named `RoundtripResult(uint256 buyTaxBps, uint256 sellTaxBps, uint8 status)`
where `status` is a packed bitmap (bit 0 = sold-back-some-eth, bit 1 = balance-nonzero-after-buy,
bit 2 = sell-completed-without-revert). Decode via
`new Interface([...]).parseError(revertData)`. Use `msg.value` + on-contract
`WETH.deposit{value: msg.value}()` as the balance source (no state-overrides, no
pre-funding) — this works on every Alchemy/Infura/QuickNode/public RPC at every tier
because it's plain `eth_call` with `value` and `from`. Deploy via Hardhat Ignition
0.15.x targeting solc 0.8.28; verify via `@nomicfoundation/hardhat-verify` per
chain. For HONEY-12, scan `getCode(token)` for the 11 highest-leverage selectors
listed in §"Bytecode Selector Scan" (verified via `keccak256(toUtf8Bytes(sig))`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Roundtrip simulation (buy→sell, tax extraction, sanity asserts) | On-chain Solidity contract (HoneypotChecker.sol) | — | Storage-layout agnostic; exercises token's own `_transfer` hook in both directions; revert-at-end rolls back state; auditable in ~120 LOC |
| RPC dispatch (`eth_call` to checker) | Bot / Node (TypeScript, `src/utils/honeypot/checkerContract.ts`) | — | ethers v6 already provides `provider.call({ to, data, value, from })`; no per-chain RPC capability matrix needed |
| Verdict decode (revert payload → discriminated union) | Bot / Node (TypeScript, `src/utils/honeypot/index.ts`) | — | `Interface.parseError` is pure-TS, no chain interaction |
| Threshold enforcement (tax bps > config max) | Bot / Node (TypeScript, dispatch layer) | — | Per-chain env (`ETH_MAX_BUY_TAX_BPS`); thresholds change without redeploying contract |
| Multi-amount probe aggregation (1%/50%/100% per D-AGGREGATION) | Bot / Node (TypeScript, 3× `eth_call` in parallel) | — | Aggregation policy is operational (D-AGGREGATION), not in-contract; keeps contract immutable + minimal |
| Bytecode selector scan (HONEY-12) | Bot / Node (TypeScript, `src/utils/honeypot/bytecodeScan.ts`) | — | Pure-RPC `getCode` + string-grep; no contract; runs in parallel bank |
| Per-chain deploy + address registration | Off-chain (Hardhat Ignition + commit to `chainRegistry.ts`) | — | One-time per-chain operation; deploy wallet (`DEPLOY_PRIVATE_KEY`) ≠ bot wallet |
| Audit (Slither + Mythril) | Off-chain (CI on `contracts/**` changes + manual review before deploy) | — | Pre-deploy gate per HONEY-02 |
| Telegram alert + structured pino logging | Bot / Node (existing `sendCtxAlert` + pino) | — | D-ALERTS — no new infrastructure |
| Database persistence of evidence | Bot / Node (existing `trades` table fields) | — | Per CONTEXT.md `<code_context>`: existing audit fields cover Phase 18; no schema migration in this phase |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ethers` | `6.16.0` (in `package.json`; current latest per npm 2026-05-15) | RPC, ABI encoding, custom-error decode (`Interface.parseError`), `provider.call` | Already validated in v6.16 production; native BigInt; `parseError` is the documented v6 path for custom error decode `[VERIFIED: npm registry — ethers 6.16.0 confirmed via npm view 2026-05-15] [CITED: docs.ethers.org/v6/api/abi]` |
| `hardhat` | `2.26.0` (pinned in `package.json`; latest is 3.4.5 but stay on 2.x) | Solidity 0.8.28 compile; Ignition deploy module entry point | Already configured with full toolbox; Hardhat 3.x is a complete rewrite (ESM-first, Node 22, `compile`→`build`) and out of v6.17 scope per CONTEXT canonical refs `[VERIFIED: npm registry — hardhat 3.4.5 latest, project pinned 2.26.0]` |
| `@openzeppelin/contracts` | `^5.4.0` (resolves to 5.6.1 latest; OZ 5.x requires Solidity >=0.8.20 — solc 0.8.28 OK) | `IERC20` interface for HoneypotChecker.sol | Already a dep; standard ERC20 interface for the OZ ecosystem `[VERIFIED: npm registry — @openzeppelin/contracts 5.6.1 latest 2026-05-15]` |
| `@nomicfoundation/hardhat-ignition` | `^0.15.16` (pinned for Hardhat 2 plugin API; do NOT bump to 0.16+ or 3.x which target Hardhat 3) | Declarative deploy modules; per-chain deploy via `npx hardhat ignition deploy ignition/modules/HoneypotChecker.ts --network <name>` | Already installed; supports Hardhat 2 plugin API `[VERIFIED: npm registry — 3.1.5 latest is HH3-only; ^0.15.16 retained for HH2.26 compat per package.json]` |
| `@nomicfoundation/hardhat-verify` | `^2.1.0` (do NOT bump to 3.x which targets HH3) | Etherscan/BscScan source verification post-deploy | Already installed; one command per chain `[VERIFIED: npm registry — 3.0.17 latest is HH3-only; ^2.1.0 retained for HH2.26 compat]` |
| `vitest` | `^4.1.1` | Unit + integration + fork tests for new code; existing projects unchanged | Already configured; new test files glob into existing `unit`/`integration`/`fork` projects per `vitest.config.ts` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@nomicfoundation/hardhat-network-helpers` | `^1.1.0` (already installed) | Mainnet-fork against pinned block for HONEY-08 fixture tests | Used in `test/fork/` tests that snapshot the chain at a fixture-specific block |
| `solidity-coverage` | `^0.8.17` (already installed) | Coverage on `HoneypotChecker.sol` | One-shot before HONEY-02 audit; ensures 100% of contract branches are exercised by tests |
| `slither-analyzer` | latest (Python tool, install via `pip install slither-analyzer` in CI; not an npm dep) | Static analysis per HONEY-02 | Run as CI job on `contracts/**` PRs; severity ≥ medium blocks deploy `[CITED: github.com/crytic/slither + secure-contracts.com/program-analysis/slither/docs]` |
| `mythril` | latest (Python tool, install via `pip install mythril` in CI) | Symbolic analysis per HONEY-02 | Run as CI job on `contracts/**` PRs; severity ≥ medium blocks deploy `[ASSUMED — Mythril CLI defaults; planner should verify against Mythril release notes]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom error revert encoding | Single `uint256` packed as `(buyTaxBps << 128) | (sellTaxBps << 64) | status` reverted as `bytes32` payload | Saves ~50 gas per call but loses self-documentation; custom error has a named ABI signature that ethers can introspect — chosen for auditability |
| `msg.value` + `WETH.deposit` balance source | `eth_call` `stateOverride` (raw provider call with `params[2] = { [walletAddr]: { balance: '0xffff…' } }`) | State-override works on Alchemy/Infura/QuickNode but documentation is uneven on free-tier limits and the override-balance-then-send-call pattern requires `params[3]` shape variations between providers. Direct `msg.value` works on every provider on every chain with zero per-chain capability matrix `[VERIFIED: Alchemy + Infura docs confirm stateOverride 2026-05-15]` |
| OZ `IERC20` import | Inline `interface IERC20 { ... }` in the contract | Inline cuts one import line but loses upstream-OZ-audit signal; planner discretion, recommend OZ import (it's already a dep) |
| Hardhat Ignition | Direct deploy script (`scripts/deploy.ts` using ethers `ContractFactory.deploy()`) | Ignition handles idempotency, deployment-tracking JSON, multi-chain orchestration. Already installed; no marginal cost vs hand-rolled. |

**Version verification (2026-05-15 via `npm view`):**
```
ethers                                       6.16.0   (project at 6.16.0; current)
hardhat                                      3.4.5    (project pinned 2.26.0 — stay; HH3 out of scope)
@openzeppelin/contracts                      5.6.1    (project at ^5.4.0; resolves up to 5.6.1)
@nomicfoundation/hardhat-ignition            3.1.5    (HH3-only; project at ^0.15.16 for HH2 — stay)
@nomicfoundation/hardhat-verify              3.0.17   (HH3-only; project at ^2.1.0 for HH2 — stay)
```

## Package Legitimacy Audit

This phase installs **zero new npm packages**. All dependencies are already in
`package.json` and were vetted in v6.16. Slither + Mythril are Python tools
installed via `pip` in CI only (no runtime dependency on bot).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `ethers` | npm | 7 yrs | 2M+/wk | github.com/ethers-io/ethers.js | N/A (existing dep) | Approved |
| `hardhat` | npm | 6 yrs | 500K+/wk | github.com/NomicFoundation/hardhat | N/A (existing dep) | Approved |
| `@openzeppelin/contracts` | npm | 7 yrs | 600K+/wk | github.com/OpenZeppelin/openzeppelin-contracts | N/A (existing dep) | Approved |
| `@nomicfoundation/hardhat-ignition` | npm | 2 yrs | 50K+/wk | github.com/NomicFoundation/hardhat-ignition | N/A (existing dep) | Approved |
| `@nomicfoundation/hardhat-verify` | npm | 2 yrs | 100K+/wk | github.com/NomicFoundation/hardhat-verify | N/A (existing dep) | Approved |
| `slither-analyzer` | PyPI | 6 yrs | 100K+/mo | github.com/crytic/slither | N/A (CI tool only) | Approved |
| `mythril` | PyPI | 7 yrs | 50K+/mo | github.com/Consensys/mythril | N/A (CI tool only) | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none (no new packages).
**Packages flagged as suspicious [SUS]:** none.

*Slopcheck was not run because the phase adds no new packages — gate not triggered.
If the planner adds packages during decomposition, slopcheck **must** run before
those entries land in PLAN.md.*

## Architecture Patterns

### System Architecture Diagram

```
[New pair detected on factory listener]
        |
        v
[handleNewPairForChain / handleNewV3PoolForChain  (bot.ts:174-347 / 353-536)]
        |
        v
[Step 1-5: dedup, blocklist, isKnownBadToken, canSnipe risk gate]   (unchanged)
        |
        v
+----------------------------------------------------------------+
| HONEY-07/08 in-place replacement of broken sell-sim gates:     |
|                                                                 |
|   const result = await simulateHoneypotRoundtrip(               |
|       ctx, dex, targetToken                                     |
|   );                                                            |
|                                                                 |
|   if (result.verdict !== 'safe') {                              |
|       log + Telegram(D-ALERTS tiered format) + return;          |
|   }                                                             |
+----------------------------------------------------------------+
        |
        v
[src/utils/honeypot/index.ts  — dispatch layer]
        |
        +--- ctx.chain.honeypotChecker.method === 'on-chain-contract' (default)
        |        |
        |        v
        |    [src/utils/honeypot/checkerContract.ts]
        |        |
        |        | For each amount in [snipeAmount/100, snipeAmount/2, snipeAmount]:
        |        |   provider.call({
        |        |       to: chain.honeypotChecker.deployedAddress,
        |        |       data: iface.encodeFunctionData('check', [router, token, amount]),
        |        |       value: amount,
        |        |       from: ctx.wallet.address,   // tx.origin spoofing mitigation
        |        |   })
        |        |
        |        | -> contract executes inside eth_call:
        |        |     WETH.deposit{value: msg.value}() ;
        |        |     WETH.approve(router, amount) ;
        |        |     uint balBefore = token.balanceOf(this) ;
        |        |     uint expBuy = router.getAmountsOut(amount, [WETH,token])[1] ;
        |        |     router.swapExactETHForTokens(0, path, this, deadline){value: msg.value} ;
        |        |     uint balAfter = token.balanceOf(this) ;
        |        |     require(balAfter > balBefore, "BUY_BAL_ZERO") ;   // lying-balanceOf catch
        |        |     uint buyTaxBps = ((expBuy - (balAfter-balBefore)) * 10000) / expBuy ;
        |        |     token.approve(router, balAfter) ;
        |        |     uint ethBefore = address(this).balance ;
        |        |     uint expSell = router.getAmountsOut(balAfter, [token,WETH])[1] ;
        |        |     router.swapExactTokensForETHSupportingFeeOnTransferTokens(...) ;
        |        |     uint ethAfter = address(this).balance ;
        |        |     require(ethAfter > ethBefore, "SELL_ETH_ZERO") ;  // silent-zero-ETH catch
        |        |     uint sellTaxBps = ((expSell - (ethAfter-ethBefore)) * 10000) / expSell ;
        |        |     revert RoundtripResult(buyTaxBps, sellTaxBps, 0x07) ;  // custom error
        |        |
        |        | -> ethers receives revert; parseError decodes RoundtripResult
        |        |    OR specific require-revert (string-decoded as 'unsafe' reason)
        |        v
        |    [aggregate per D-AGGREGATION:
        |       50%/100% revert OR taxBps > config → 'unsafe'
        |       1% revert → log, evidence-only
        |       all probes succeed AND tax under threshold → 'safe']
        |        |
        +--- ctx.chain.honeypotChecker.method === 'eth_simulateV1' (Phase 18: stub only)
        |        |
        |        v
        |    [src/utils/honeypot/simulator.ts]  — throws 'NOT_IMPLEMENTED'
        |        |
        v
[Parallel safety bank — bot.ts:229-238  (extended with HONEY-12 9th gate)]
   - checkHoneypotForChain (third-party APIs)
   - isBlacklistedTokenForChain
   - isLiquidityLockedForChain
   - isLiquiditySufficientForChain
   - checkTokenMetadataForChain
   - simulateSwapForChain (buy-sim)
   - hasHighTransferTaxForChain
   - hasMaxWalletOrTxLimitsForChain
   - isMutableTokenForChain  *** NEW HONEY-12: bytecode selector scan ***
        |
        v
[If all pass → sendTxWithRetry → MEV path → startExitMonitor]   (unchanged)
```

### Component Responsibilities

| File | Purpose |
|------|---------|
| `contracts/honeypot/HoneypotChecker.sol` | ~100-120 LOC roundtrip + post-trade asserts; reverts with custom error encoding tax bps + status |
| `ignition/modules/HoneypotChecker.ts` | ~15 LOC Hardhat Ignition module; one-line `m.contract('HoneypotChecker', [])` |
| `scripts/deploy-honeypot-checker.ts` | Per-chain CLI wrapper: reads `DEPLOY_PRIVATE_KEY`, picks network from arg, runs `ignition deploy`, prints address |
| `src/utils/honeypot/index.ts` | Dispatch entry `simulateHoneypotRoundtrip(ctx, dex, token)`; reads `ctx.chain.honeypotChecker.method` |
| `src/utils/honeypot/checkerContract.ts` | Option-D wrapper; 3× `provider.call` (one per probe size); decode `RoundtripResult`; aggregate per D-AGGREGATION |
| `src/utils/honeypot/simulator.ts` | Option-C stub; throws `NotImplemented` (v6.18 promotes to real implementation if needed) |
| `src/utils/honeypot/types.ts` | `HoneypotResult` discriminated union; `HoneypotEvidence` shape; `RoundtripResult` ABI fragment |
| `src/utils/honeypot/bytecodeScan.ts` | HONEY-12 `isMutableTokenForChain(ctx, token)`; greps `getCode(token)` for selectors |
| `src/utils/honeypot/abi.ts` | Single source for HoneypotChecker ABI + custom-error fragment |
| `src/chainRegistry.ts` | Extended: `ChainConfig.honeypotChecker: { deployedAddress, method }`; per-chain `maxBuyTaxBps` / `maxSellTaxBps` from env or template default 1000 |
| `src/bot.ts:220-226` (V2 gate) | **DELETED** call to `simulateSellForChain`; **REPLACED** with `simulateHoneypotRoundtrip` dispatch |
| `src/bot.ts:411-416` (V3 gate) | **DELETED** call to `simulateSellV3ForChain`; **REPLACED** with `simulateHoneypotRoundtrip` dispatch (no V3-specific branch — checker works on both via router param) |
| `src/bot.ts:229-238` (parallel bank) | Added 9th gate: `isMutableTokenForChain(ctx, targetToken)` |
| `src/bot.ts:268` (alert format) | Augmented with `buyTaxBps`/`sellTaxBps` evidence on skip; safe path unchanged |
| `src/utils/tokenSafety.ts:555-586` (`simulateSellForChain`) | **DELETED** |
| `src/utils/tokenSafety.ts:593-634` (`simulateSellV3ForChain`) | **DELETED** |
| `test/fixtures/contracts/Honeypot.sol` | Contrived test honeypot; `transfer()` reverts conditionally for fork tests |
| `test/fork/fixtures/honeypots/*.json` | 1-2 real historical honeypots per chain pinned to specific block |

### Recommended Project Structure

```
contracts/
├── honeypot/
│   └── HoneypotChecker.sol          # NEW: ~100-120 LOC

ignition/
└── modules/
    └── HoneypotChecker.ts           # NEW: ~15 LOC

scripts/
└── deploy-honeypot-checker.ts       # NEW: per-chain deploy wrapper

src/utils/honeypot/                  # NEW directory
├── index.ts                         # dispatch
├── checkerContract.ts               # Option-D wrapper
├── simulator.ts                     # Option-C stub
├── bytecodeScan.ts                  # HONEY-12 selector scan
├── abi.ts                           # checker ABI + RoundtripResult fragment
└── types.ts                         # HoneypotResult discriminated union

test/
├── fixtures/
│   └── contracts/
│       └── Honeypot.sol             # NEW: contrived test honeypot (D-FIXTURE)
├── fork/
│   ├── fixtures/
│   │   └── honeypots/               # NEW: real-mainnet pinned fixtures
│   │       ├── eth-${SLUG}.json
│   │       ├── eth-${SLUG2}.json
│   │       └── bsc-${SLUG}.json     # (BSC fixtures added in HONEY-04 wave)
│   ├── honeypotChecker.fork.test.ts # NEW: roundtrip against pinned honeypots
│   └── honeypotCheckerDeploy.test.ts # NEW: deploys + asserts code-at-address
├── integration/
│   └── honeypotDispatch.test.ts     # NEW: dispatch layer; 'unknown' fails closed
└── unit/
    └── bytecodeScan.test.ts         # NEW: HONEY-12 selector matching
```

### Pattern 1: Strategy Dispatch via ChainConfig

**What:** New capabilities are configured per-chain in `CHAIN_TEMPLATES` and dispatched
via `ChainContext.chain.<feature>`. No `if (chainName === 'eth')` branches outside the
registry.

**When to use:** Any capability with chain-specific behavior (addresses, RPC method
support, threshold defaults).

**Example:**
```typescript
// src/utils/honeypot/index.ts
import { simulateViaContract } from './checkerContract';
import { simulateViaSimulator } from './simulator';
import type { ChainContext, DexConfig } from '../../chainRegistry';
import type { HoneypotResult } from './types';

export async function simulateHoneypotRoundtrip(
    ctx: ChainContext,
    dex: DexConfig,
    token: string,
): Promise<HoneypotResult> {
    const cfg = ctx.chain.honeypotChecker;
    if (cfg.method === 'on-chain-contract') {
        if (!cfg.deployedAddress) {
            return { verdict: 'unknown', reason: 'no-deployed-address', evidence: {} };
        }
        return simulateViaContract(ctx, dex, token, cfg.deployedAddress);
    }
    if (cfg.method === 'eth_simulateV1') {
        return simulateViaSimulator(ctx, dex, token);   // stub in Phase 18
    }
    return { verdict: 'unknown', reason: `bad-method:${cfg.method}`, evidence: {} };
}
```

### Pattern 2: Discriminated-Union Verdicts (Type-System Vacuous-Pass Prevention)

**What:** Safety-gate return type is a discriminated union with `'safe' | 'unsafe' | 'unknown'`.
Vacuous pass is unrepresentable — `return true` does not type-check.

**When to use:** Any safety-gate function — establishes the pattern for HONEY-11 audit.

**Example:**
```typescript
// src/utils/honeypot/types.ts
export interface HoneypotEvidence {
    buyTaxBps?: number;
    sellTaxBps?: number;
    revertReason?: string;
    probeResults?: Array<{ amountWei: string; ok: boolean; reason?: string; buyTaxBps?: number; sellTaxBps?: number }>;
    method: 'on-chain-contract' | 'eth_simulateV1' | 'bytecode-scan';
}

export type HoneypotResult =
    | { verdict: 'safe';    evidence: HoneypotEvidence }
    | { verdict: 'unsafe';  reason: string; evidence: HoneypotEvidence }
    | { verdict: 'unknown'; reason: string; evidence: HoneypotEvidence };
```

### Pattern 3: Custom-Error Revert as Return Channel

**What:** Solidity contract reverts with a named custom error whose ABI-encoded args carry
the result. `eth_call` returns the encoded revert data; ethers `parseError` decodes.

**When to use:** Any view-like simulation that needs to mutate state internally then roll
back. Custom error is self-documenting and decodes via ABI introspection — no manual
byte-slicing.

**Example (Solidity):**
```solidity
error RoundtripResult(uint256 buyTaxBps, uint256 sellTaxBps, uint8 status);
// ... at end of check() function ...
revert RoundtripResult(buyTaxBps, sellTaxBps, status);
```

**Example (TypeScript decode):**
```typescript
// src/utils/honeypot/checkerContract.ts
import { Interface } from 'ethers';
import { HONEYPOT_CHECKER_ABI } from './abi';

const iface = new Interface(HONEYPOT_CHECKER_ABI);

try {
    const data = iface.encodeFunctionData('check', [routerAddress, tokenAddress, amountWei]);
    await ctx.httpProvider.call({
        to: deployedAddress,
        data,
        value: amountWei,
        from: ctx.wallet.address,    // mitigates tx.origin spoofing per PITFALLS #4
    });
    // If call() returned (didn't revert) → contract bug — should always revert at end.
    return { verdict: 'unknown', reason: 'no-terminal-revert', evidence: { method: 'on-chain-contract' } };
} catch (e: unknown) {
    const err = e as { data?: string; info?: { error?: { data?: string } }; message?: string };
    const revertData = err.data ?? err.info?.error?.data ?? '';
    if (revertData) {
        try {
            const parsed = iface.parseError(revertData);
            if (parsed && parsed.name === 'RoundtripResult') {
                const [buyTaxBps, sellTaxBps, status] = parsed.args;
                const ok = Number(status) === 0x07;
                return ok
                    ? { verdict: 'safe', evidence: { buyTaxBps: Number(buyTaxBps), sellTaxBps: Number(sellTaxBps), method: 'on-chain-contract' } }
                    : { verdict: 'unsafe', reason: `status=0x${Number(status).toString(16).padStart(2,'0')}`, evidence: { buyTaxBps: Number(buyTaxBps), sellTaxBps: Number(sellTaxBps), method: 'on-chain-contract' } };
            }
        } catch { /* fall through */ }
    }
    return { verdict: 'unsafe', reason: err.message ?? 'unknown-revert', evidence: { method: 'on-chain-contract', revertReason: err.message } };
}
```

### Anti-Patterns to Avoid

- **Vacuous-pass regression on edge cases.** Any `return { verdict: 'safe' }` branch
  must be preceded by evidence the underlying roundtrip executed. The V3 bug pattern
  (`if (balance === 0n) return true`) is the canonical anti-example. PR review rule
  per PITFALLS #1.

- **Sell-only sim under the new name.** The check MUST be a buy→sell roundtrip, not a
  sell-only sim. PITFALLS #6: rename function to `simulateHoneypotRoundtrip` (not
  `simulateSell*`) and tests assert a buy-only-honeypot is caught.

- **`tx.origin == 0x0` bypass.** Setting `from` in `eth_call` to the zero address (the
  default) lets a malicious token gate its honeypot behavior on `tx.origin == 0` to
  pass detection but fail in production. Always pass `from: ctx.wallet.address`.
  PITFALLS #4.

- **Probe at `amountIn=0`.** Every probe MUST use a non-zero `msg.value`. The whole
  purpose of HONEY is to prevent this regression. PITFALLS #1.

- **Hand-rolled storage-slot probing for balance.** Option C (state-override) is
  deferred to a stub. Do NOT ship slot probing in Phase 18. PITFALLS #2.

- **Single-probe tax extraction.** Always probe at 1% / 50% / 100% per D-AGGREGATION
  / HONEY-10. Single-shot misses amount-tiered taxes. PITFALLS #5.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Custom-error revert decode | Manual `data.slice(0, 10)` + ABI byte-slicing | `ethers.Interface.parseError(data)` | Handles all encoding edge cases including dynamic types, error selector lookup, and zero-args errors `[VERIFIED: ethers v6 docs — Interface.parseError]` |
| Multi-call simulation | Custom `eth_simulateV1` adapter per chain | Single `eth_call` to deployed contract (Option D) | Storage-layout agnostic; works on every RPC at free tier; no per-chain capability matrix per PITFALLS #3 |
| Honeypot detection | Bespoke buy-then-sell from TS using raw router calldata | Deployed `HoneypotChecker.sol` with revert-at-end | Atomic rollback via revert; exercises token `_transfer` hook in both directions; auditable in 120 LOC vs sprawling TS logic |
| ERC20 interface | Hand-defined `interface IERC20` in Solidity | `@openzeppelin/contracts/token/ERC20/IERC20.sol` | OZ is already a dep; pulls in upstream-audited ABI without LOC drift |
| Deploy orchestration | Bespoke `scripts/deploy.ts` with manual nonce + receipt handling | `@nomicfoundation/hardhat-ignition` module | Idempotent; tracks deployed addresses in `ignition/deployments/`; handles per-chain target via `--network` flag |
| Etherscan/BscScan verification | Manually-encoded API POST | `@nomicfoundation/hardhat-verify` (`npx hardhat verify --network <name> <addr>`) | One command per chain; reads constructor args from Ignition deployment metadata |
| 4-byte selector computation | Pasting magic constants | `keccak256(toUtf8Bytes(sig)).substring(0, 10)` via ethers in a one-time script committed alongside the selector list | Reproducible; signature errors surface as test failures, not silent mismatches (already computed below in §Bytecode Selector Scan) |

**Key insight:** Custom Solidity is the right tool for the roundtrip — exercising the
token's own `_transfer` hook in both directions with atomic rollback. TypeScript is
the right tool for dispatch + aggregation + threshold enforcement (those need to
change without redeploying the contract). The boundary is "what mutates token state"
(Solidity) vs "what's a policy decision" (TypeScript).

## Open Research Item Recommendations

Each of the 9 open research items from CONTEXT.md has a concrete planner-actionable
recommendation here.

### 1. Solidity Revert-Encoding Shape

**Recommendation:** Solidity **custom error** named `RoundtripResult(uint256 buyTaxBps, uint256 sellTaxBps, uint8 status)`.

**Rationale:**
- Custom errors have ABI signatures that ethers v6 introspects via `Interface.parseError`
  — decoding is one line, no manual byte-slicing `[CITED: docs.ethers.org/v6/api/abi]`.
- Self-documenting: the name appears in stack traces and audit reports without
  cross-referencing magic constants.
- Cheaper than `bytes32` encoding for typed args (Solidity allocates only what each arg
  needs; `bytes32` would waste space packing 3 small numbers).
- Distinguishable from `require`-string reverts: when a `require(balAfter > balBefore,
  "BUY_BAL_ZERO")` fires mid-execution, ethers receives a standard `Error(string)` and
  surfaces "BUY_BAL_ZERO" as `parsed.args[0]`. When the terminal `revert RoundtripResult(...)`
  fires, `parsed.name === 'RoundtripResult'`. The dispatch differentiates these as
  `unsafe` (require-string) vs `safe`/`unsafe` based on `status` (RoundtripResult).
- `status` is a packed bitmap: bit 0 = sold-back-some-eth, bit 1 = balance-nonzero-after-buy,
  bit 2 = sell-completed-without-revert. `status === 0x07` → all asserts passed → `safe`.
  Any other status value → `unsafe` with a specific reason. This is more debuggable
  than a single boolean.

**Rejected alternatives:**
- *Packed `uint256`* (`(buyTaxBps << 128) | (sellTaxBps << 64) | status`): saves ~50 gas
  but loses self-documentation and requires manual decode.
- *`bytes32` payload*: same downsides as packed uint256.
- *Return value via successful call (no revert)*: would require gas-paid state mutation;
  rollback impossible.

**Confidence:** HIGH `[VERIFIED via ethers v6 docs + GitHub discussion #4157 — parseError is the canonical decode path]`

### 2. eth_call Balance Source for the Test Buyer

**Recommendation:** `msg.value` + on-contract `WETH.deposit{value: msg.value}()` inside the call.

**Rationale:**
- Plain `eth_call` with a non-zero `value` parameter works on every RPC provider at
  every tier — Alchemy, Infura, QuickNode, BSC public, Base sequencer, Arbitrum
  Nitro — because it's the standard JSON-RPC spec. **No per-chain capability matrix
  needed.** `[VERIFIED: Alchemy + Infura + Chainstack docs confirm eth_call accepts value 2026-05-15]`
- The contract receives ETH via the call, wraps it via `WETH.deposit{value: msg.value}()`,
  approves the router, executes the buy. Because the `eth_call` doesn't change real
  state, no ETH is actually spent.
- **The `from` field MUST be set to `ctx.wallet.address`** (not the zero address). This
  mitigates the `tx.origin` spoofing pitfall (PITFALLS #4) — a malicious token gating
  its honeypot behavior on `tx.origin == 0` would otherwise pass our check but fail the
  real buy.
- Works for newly-launched tokens: the bot's wallet does not need to hold the target
  token; the contract pays for the test buy with `msg.value` and the token balance is
  established by the buy step.

**Rejected alternatives:**
- *`stateOverride` to fake `WETH.balanceOf(checker)`*: works on Alchemy/Infura but
  documentation is uneven on free-tier limits, and the override-balance-then-call
  pattern requires `params[2]` shape variations between providers. Adds a per-chain
  capability matrix we don't need. Also: the bot would need to know WETH's `balanceOf`
  storage slot, which is non-standard for some chains (BSC's WBNB layout differs).
- *Contract pre-funded with WETH at deploy*: requires the deploy wallet to hold WETH
  at deploy time on every chain (~$50 across 4 chains in addition to gas). Adds an
  operational step and the pre-funded balance is consumed across many checks unless
  topped up. Operationally fragile.

**Confidence:** HIGH `[VERIFIED: eth_call standard supports value parameter on every RPC]`

### 3. Real-Mainnet Honeypot Fixtures

**Recommendation:** Phase 18 ships with **placeholder fixture format** + a one-paragraph
"how to add a honeypot fixture" README. The actual fixture honeypot selection is done at
plan-time using either of:

1. **Curated public honeypot lists**, cross-checked against block-pin requirements:
   - Etherscan address `0x80e4f014c98320eab524ae16b0aaf1603f4dc01d` (compromised
     "Honeypot 2" on ETH — block-pinned to its first sell-revert tx)
     `[CITED: etherscan.io]`
   - Etherscan address `0x34c6211621f2763c60eb007dc2ae91090a2d22f6` (reported honeypot
     token on ETH) `[CITED: etherscan.io]`
   - honeypot.is database query: filter by chain + block range, pick 2 distinct
     bug patterns (sell-revert, max-wallet trap) `[CITED: honeypot.is/ethereum]`
2. **Live discovery** during planner work: poll honeypot.is API for recent confirmed
   honeypots, pin to a block where the token was active and detection signal was clear.

**Important caveats for the planner:**
- A "honeypot" address that was rugged might no longer revert today (LP gone →
  `INSUFFICIENT_LIQUIDITY` revert instead of honeypot revert). Pin to a block where
  the honeypot was the *active* failure mode, not the post-rug state.
- Verify the chosen block has the chain's WETH-paired pool with non-zero liquidity at
  fork-pinned time. Otherwise the test is testing "rugged pool" not "honeypot."
- 1-2 fixtures per chain is the D-FIXTURE minimum. Different bug patterns per fixture:
  one sell-revert (transfer hook reverts on path[0] = token) + one max-wallet trap
  (token rejects buys above N% of supply). Avoids monoculture.
- BSC has the richest honeypot ecosystem — start fixture discovery there first when
  HONEY-04 lands.

**Format (per fixture JSON):**
```json
{
  "chain": "eth",
  "tokenAddress": "0x...",
  "pairAddress": "0x...",
  "routerAddress": "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  "forkBlockNumber": 18500000,
  "expectedVerdict": "unsafe",
  "expectedRevertContains": "BUY_BAL_ZERO",
  "bugPattern": "sell-revert",
  "notes": "Token reverts in _beforeTokenTransfer when sender != owner",
  "discoveredVia": "honeypot.is",
  "discoveredOn": "2026-05-15"
}
```

**The planner should treat fixture-selection as a wave 0 task and surface candidates
to the user for confirmation before locking them in.** Real-mainnet fixture choice has
capital-safety implications (a misclassified fixture → false confidence in the gate).

**Confidence:** MEDIUM `[ASSUMED: honeypot.is and Etherscan list specific addresses; planner must verify each at the pinned block before commit]`

### 4. Slither + Mythril Flags / Severity Thresholds

**Recommendation:**

**Slither invocation (HONEY-02 CI job):**
```bash
slither contracts/honeypot/HoneypotChecker.sol \
    --solc-remaps "@openzeppelin/=node_modules/@openzeppelin/" \
    --exclude-informational \
    --exclude-low \
    --filter-paths "node_modules" \
    --json reports/slither-honeypot.json \
    --fail-medium
```

**Severity threshold:** **`--fail-medium`** — fail the CI run if any finding at medium
or high severity. Low + informational are reviewed but do not block. This matches
the standard Slither severity ladder (informational / low / medium / high) and the
default `--fail-medium` flag exits non-zero on medium+, suitable for CI gating.
`[CITED: secure-contracts.com/program-analysis/slither/docs]`

**Mythril invocation (HONEY-02 CI job):**
```bash
myth analyze contracts/honeypot/HoneypotChecker.sol \
    --solc-args "--allow-paths node_modules" \
    --execution-timeout 300 \
    --max-depth 30 \
    -o json > reports/mythril-honeypot.json
```

**Severity threshold:** Mythril doesn't have a built-in `--fail-on-severity` flag in
all releases. **Wrap the JSON output in a CI script that exits non-zero if any
`issues[].severity in {'Medium', 'High'}`**. Planner authors `scripts/check-mythril-report.ts`
during HONEY-02 to enforce this. `[ASSUMED: Mythril CLI defaults — planner verifies against current Mythril release]`

**False-positive triage policy:**
- Per HONEY-02, *every* flagged issue at medium+ gets a documented disposition in
  `.planning/milestones/v6.17-honeypot-checker-audit.md` under a table:
  `| Tool | Detector | Severity | Location | Disposition | Justification |`
- Acceptable dispositions: `fix-applied` (with commit ref), `false-positive` (with
  reasoning), `accepted-risk` (with reasoning + owner sign-off).
- Owner sign-off required for `accepted-risk` — this matches D-STOP-THE-LINE: silently
  accepting a Slither/Mythril finding is forbidden.

**Confidence:** MEDIUM `[CITED: Slither docs confirm --fail-medium flag] [ASSUMED: Mythril severity wrapper needs custom script — planner verifies]`

### 5. HoneypotChecker.sol Skeleton

**Recommendation:** Target ~110-120 LOC. Structure:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWETH {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV2Router02 {
    function swapExactETHForTokens(
        uint amountOutMin, address[] calldata path, address to, uint deadline
    ) external payable returns (uint[] memory amounts);
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline
    ) external;
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
    function WETH() external view returns (address);
}

/// @title HoneypotChecker — immutable pre-buy roundtrip simulator
/// @dev Designed to be called via eth_call with a non-zero msg.value. Always
///      reverts at end to roll back state; result is encoded in the revert
///      payload as RoundtripResult(buyTaxBps, sellTaxBps, status).
///
///      status bitmap:
///        bit 0 (0x01) = sold-back-some-eth (post-sell ETH balance increased)
///        bit 1 (0x02) = balance-nonzero-after-buy (catches lying-balanceOf)
///        bit 2 (0x04) = sell-completed-without-revert
///      Caller MUST require status === 0x07 to consider the token safe.
contract HoneypotChecker {
    /// @notice Terminal result; always reverted, never returned.
    error RoundtripResult(uint256 buyTaxBps, uint256 sellTaxBps, uint8 status);

    /// @notice Buy-side assertion failure.
    error BuyFailed(string reason);

    /// @notice Sell-side assertion failure.
    error SellFailed(string reason);

    /// @notice Run roundtrip: buy `token` via `router` with `amountIn` ETH, then sell back.
    /// @dev msg.value MUST equal amountIn. Always reverts.
    function check(address router, address token, uint256 amountIn) external payable {
        require(msg.value == amountIn, "VALUE_MISMATCH");

        IUniswapV2Router02 r = IUniswapV2Router02(router);
        address weth = r.WETH();
        uint8 status = 0;

        // ----- Buy half -----
        address[] memory pathBuy = new address[](2);
        pathBuy[0] = weth;
        pathBuy[1] = token;

        // Expected output via getAmountsOut (curve math — no transfer hook)
        uint[] memory expBuy = r.getAmountsOut(amountIn, pathBuy);
        uint expectedTokensOut = expBuy[1];

        uint balBefore = IERC20(token).balanceOf(address(this));
        try r.swapExactETHForTokens{value: amountIn}(
            0, pathBuy, address(this), block.timestamp + 60
        ) returns (uint[] memory) {
            // OK
        } catch Error(string memory reason) {
            revert BuyFailed(reason);
        } catch {
            revert BuyFailed("unknown");
        }
        uint balAfter = IERC20(token).balanceOf(address(this));
        if (balAfter <= balBefore) {
            revert BuyFailed("BUY_BAL_ZERO");   // lying-balanceOf catch
        }
        status |= 0x02;
        uint received = balAfter - balBefore;
        uint buyTaxBps = expectedTokensOut > received
            ? ((expectedTokensOut - received) * 10000) / expectedTokensOut
            : 0;

        // ----- Sell half -----
        IERC20(token).approve(router, received);

        address[] memory pathSell = new address[](2);
        pathSell[0] = token;
        pathSell[1] = weth;

        uint[] memory expSell = r.getAmountsOut(received, pathSell);
        uint expectedEthOut = expSell[1];

        uint ethBefore = address(this).balance;
        try r.swapExactTokensForETHSupportingFeeOnTransferTokens(
            received, 0, pathSell, address(this), block.timestamp + 60
        ) {
            status |= 0x04;
        } catch Error(string memory reason) {
            revert SellFailed(reason);
        } catch {
            revert SellFailed("unknown");
        }
        uint ethAfter = address(this).balance;
        if (ethAfter <= ethBefore) {
            revert SellFailed("SELL_ETH_ZERO");  // silent-zero-ETH-on-sell catch
        }
        status |= 0x01;
        uint receivedEth = ethAfter - ethBefore;
        uint sellTaxBps = expectedEthOut > receivedEth
            ? ((expectedEthOut - receivedEth) * 10000) / expectedEthOut
            : 0;

        revert RoundtripResult(buyTaxBps, sellTaxBps, status);
    }

    /// @notice Receive ETH refund from router (V2 router returns leftover ETH on swapExactTokens).
    receive() external payable {}
}
```

**LOC estimate:** ~110 LOC excluding comments + interfaces. Within D-CONTRACT-SCOPE budget.

**Compatibility:**
- solc 0.8.28 (matches `hardhat.config.ts`).
- OZ `^5.4.0` — `IERC20` interface is stable across 5.x. `[VERIFIED: package.json declares ^5.4.0; OZ 5.x IERC20 ABI unchanged across patch releases]`
- V2 router calldata: `swapExactETHForTokens`, `swapExactTokensForETHSupportingFeeOnTransferTokens`,
  `getAmountsOut`, `WETH` — universal V2-router ABI. Works against Uniswap V2 + every
  V2 fork (PancakeSwap V2, SushiSwap V2, BiSwap, Camelot V2, Aerodrome).
- V3 router compatibility: V3 path is **also handled by this same contract** for Phase 18 —
  the planner can either (a) ship a V2-only checker in HONEY-01 and add a second
  `checkV3()` function in HONEY-08 for V3 dispatch, or (b) extend `check()` to accept
  a `dexType` enum. **Recommendation: (a)** — V2/V3 use different router shapes; one
  function per shape is clearer. The V3 variant calls `ISwapRouter.exactInputSingle`
  with `recipient: address(this)` and gas-pays via `msg.value`.

**Security highlights (pre-audit):**
- No `selfdestruct` (Cancun makes it a no-op anyway, but explicitly avoid).
- No `tx.origin` use.
- No external state mutation surviving the revert.
- `receive()` is intentional — V2 router returns leftover ETH on `swapExactTokens*`
  variants when value is over-sent; without `receive()` the call would revert.
- No reentrancy guard needed (function always reverts; no state survives).
- Gas-griefing: untrusted token's `_transfer` could consume excessive gas in a
  malicious loop. The outer `eth_call` enforces an implicit gas cap (block gas limit);
  if the token grids out, the `eth_call` fails and dispatch returns `unsafe` with
  `reason: 'gas-grief-or-revert'`. This is the correct semantic — tokens that grief gas
  in `_transfer` are unsafe to interact with.

**Confidence:** HIGH `[VERIFIED against Uniswap V2 router ABI + OZ 5.x IERC20 + solc 0.8.28 grammar]`

### 6. Hardhat Ignition Module Shape

**Recommendation:**

**`ignition/modules/HoneypotChecker.ts`:**
```typescript
import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

export default buildModule('HoneypotCheckerModule', (m) => {
    const checker = m.contract('HoneypotChecker', []);
    return { checker };
});
```

**`scripts/deploy-honeypot-checker.ts`:**
```typescript
// Per-chain CLI wrapper.
// Usage: DEPLOY_PRIVATE_KEY=0x... npx ts-node scripts/deploy-honeypot-checker.ts <chain>
//   where <chain> is one of: eth | bsc | base | arb
//
// Reads RPC URL from <CHAIN>_RPC_URL env var.
// Reads DEPLOY_PRIVATE_KEY env var (separate from bot's PRIVATE_KEY per D-DEPLOY-KEY).
// Outputs deployed address; operator pastes it into chainRegistry.ts CHAIN_TEMPLATES.
import { spawnSync } from 'child_process';
import { logger } from '../src/utils/logger';

const log = logger.child({ module: 'deploy-honeypot-checker' });

const CHAIN_TO_NETWORK: Record<string, string> = {
    eth: 'mainnet',
    bsc: 'bsc',
    base: 'base',
    arb: 'arbitrum',
};

const chain = process.argv[2];
if (!chain || !(chain in CHAIN_TO_NETWORK)) {
    log.fatal({ chain, valid: Object.keys(CHAIN_TO_NETWORK) }, 'Usage: ts-node scripts/deploy-honeypot-checker.ts <chain>');
    process.exit(1);
}

if (!process.env.DEPLOY_PRIVATE_KEY) {
    log.fatal('DEPLOY_PRIVATE_KEY env var required. Rotate this key out of .env after deploy.');
    process.exit(1);
}

const network = CHAIN_TO_NETWORK[chain];
log.info({ chain, network }, 'Deploying HoneypotChecker');

const result = spawnSync('npx', ['hardhat', 'ignition', 'deploy', 'ignition/modules/HoneypotChecker.ts', '--network', network], {
    stdio: 'inherit',
    env: { ...process.env, HARDHAT_PRIVATE_KEY: process.env.DEPLOY_PRIVATE_KEY },
});

if (result.status !== 0) {
    log.fatal({ status: result.status }, 'Ignition deploy failed');
    process.exit(result.status ?? 1);
}

log.info({ chain }, 'Deploy complete. Paste the deployed address into chainRegistry.ts CHAIN_TEMPLATES.${chain}.honeypotChecker.deployedAddress, then run hardhat verify.');
```

**`hardhat.config.ts` extension:** add networks for `bsc`, `base`, `arbitrum`,
`mainnet` (currently only `sepolia` + forking hardhat). Use `process.env.<CHAIN>_RPC_URL`
+ `process.env.DEPLOY_PRIVATE_KEY`. Sample shape:

```typescript
networks: {
    mainnet: process.env.ETH_RPC_URL && process.env.DEPLOY_PRIVATE_KEY
        ? { url: process.env.ETH_RPC_URL, accounts: [process.env.DEPLOY_PRIVATE_KEY], chainId: 1 }
        : undefined,
    bsc: process.env.BSC_RPC_URL && process.env.DEPLOY_PRIVATE_KEY
        ? { url: process.env.BSC_RPC_URL, accounts: [process.env.DEPLOY_PRIVATE_KEY], chainId: 56 }
        : undefined,
    base: process.env.BASE_RPC_URL && process.env.DEPLOY_PRIVATE_KEY
        ? { url: process.env.BASE_RPC_URL, accounts: [process.env.DEPLOY_PRIVATE_KEY], chainId: 8453 }
        : undefined,
    arbitrum: process.env.ARB_RPC_URL && process.env.DEPLOY_PRIVATE_KEY
        ? { url: process.env.ARB_RPC_URL, accounts: [process.env.DEPLOY_PRIVATE_KEY], chainId: 42161 }
        : undefined,
    sepolia: /* existing */,
    hardhat: /* existing */,
},
etherscan: {
    apiKey: {
        mainnet: process.env.ETHERSCAN_API_KEY ?? '',
        bsc: process.env.BSCSCAN_API_KEY ?? '',
        base: process.env.BASESCAN_API_KEY ?? '',
        arbitrumOne: process.env.ARBISCAN_API_KEY ?? '',
    },
},
```

**Confidence:** HIGH `[CITED: Hardhat Ignition + Hardhat 2 multi-network docs]`

### 7. HONEY-12 Bytecode Selector Scan

**Recommendation:** Scan `getCode(token)` for the following 4-byte selectors. Selectors
computed via `keccak256(toUtf8Bytes(signature)).substring(0, 10)` in this research
session (verified by running ethers locally — see verification below).

**Selectors to flag (any present → `isMutableTokenForChain` returns `true`):**

| Selector | Signature | Pattern |
|----------|-----------|---------|
| `0x2e5bb6ff` | `setTax(uint256)` | Generic tax setter |
| `0x667f6526` | `setTax(uint256,uint256)` | Two-arg tax setter (buy + sell) |
| `0xdc1052e2` | `setBuyTax(uint256)` | Buy-side tax setter |
| `0x8cd09d50` | `setSellTax(uint256)` | Sell-side tax setter |
| `0x6081752b` | `setBuyTax(uint8)` | Smaller-int variant |
| `0x49abdc14` | `setSellTax(uint8)` | Smaller-int variant |
| `0x5d0044ca` | `setMaxWallet(uint256)` | Anti-whale toggle |
| `0xea1644d5` | `setMaxWalletSize(uint256)` | Anti-whale variant |
| `0xec28438a` | `setMaxTxAmount(uint256)` | Anti-bot tx cap |
| `0x153b0d1e` | `setBlacklist(address,bool)` | Blacklist toggle (most common) |
| `0x4e054a67` | `setBlacklist(address)` | Single-arg blacklist |
| `0xf9f92be4` | `blacklist(address)` | Blacklist alias |
| `0xe57f14e1` | `excludeFromFees(address)` | Fee-exemption setter (deployer flips own wallet) |
| `0xc0246668` | `excludeFromFees(address,bool)` | Two-arg fee-exemption |
| `0x1031e36e` | `pauseTrading()` | Trading kill-switch |
| `0x365ec5e5` | `pauseTrading(bool)` | Trading toggle |
| `0x8f70ccf7` | `setTrading(bool)` | Trading toggle alias |
| `0xc2e5ec04` | `setTradingEnabled(bool)` | Trading toggle alias |
| `0x0b78f9c0` | `setFees(uint256,uint256)` | Combined fee setter |

**Implementation sketch:**
```typescript
// src/utils/honeypot/bytecodeScan.ts
import type { ChainContext } from '../../chainRegistry';

const MUTABLE_SELECTORS = [
    '2e5bb6ff', '667f6526', 'dc1052e2', '8cd09d50', '6081752b',
    '49abdc14', '5d0044ca', 'ea1644d5', 'ec28438a', '153b0d1e',
    '4e054a67', 'f9f92be4', 'e57f14e1', 'c0246668', '1031e36e',
    '365ec5e5', '8f70ccf7', 'c2e5ec04', '0b78f9c0',
];

export interface MutableScanResult {
    isMutable: boolean;
    hits: string[];   // signatures of hit selectors
}

export async function isMutableTokenForChain(
    ctx: ChainContext,
    tokenAddress: string,
): Promise<MutableScanResult> {
    try {
        const code = await ctx.httpProvider.getCode(tokenAddress);
        if (!code || code === '0x') {
            return { isMutable: false, hits: [] };   // no code = handled by isKnownBadTokenForChain
        }
        const codeLower = code.toLowerCase();
        const hits = MUTABLE_SELECTORS.filter(sel => codeLower.includes(sel));
        return { isMutable: hits.length > 0, hits };
    } catch (e) {
        ctx.log.warn({ err: e, token: tokenAddress, check: 'bytecodeScan' }, 'Bytecode scan failed');
        // Fail-closed: if we can't scan, treat as mutable (safer to skip than to buy unknown)
        return { isMutable: true, hits: ['scan-failed'] };
    }
}
```

**Important caveats for the planner:**
- **False positives are expected and acceptable.** Tokens with legitimate
  tax-adjustment functions (e.g., DAO-controlled `setTax` behind a 24h timelock) WILL
  be flagged. This is correct per the rationale in CONTEXT D-BYTECODE: "owner flips
  tax mid-position" is an attack vector even if today's `owner()` is a multisig.
  The phrase "false positive" here means "blocked a legitimately-safe token," which
  Phase 18 explicitly accepts in exchange for closing the attack vector. v6.18+
  (HONEY-V2-02) layers timelock-state inspection on top.
- **Selectors are surface-level grep matches** in the bytecode string. A function
  that's *not* in the public ABI but matches the selector by coincidence would false-
  positive. Probability is ~`19 / 2^32` per selector per byte — negligible. The bytecode
  is in 4-byte-aligned PUSH4 instructions for jump tables; coincidental matches are
  effectively zero.
- **Always pass `ctx.wallet.address` as `from`** in `provider.getCode` — actually no,
  `getCode` doesn't take `from`. The selector scan is unaffected by tx.origin issues.
- **`isMutableTokenForChain` returns BOTH a boolean AND a hit list.** The hit list goes
  into the evidence object so the Telegram alert + pino log can show *which* selectors
  matched. Operator can audit the decision.

**Verification (executed in this research session):**
```
node -e "const {keccak256, toUtf8Bytes} = require('ethers');
  for (const s of ['setTax(uint256)', ...]) console.log(keccak256(toUtf8Bytes(s)).substring(0,10) + '  ' + s);"
0x2e5bb6ff  setTax(uint256)
0x667f6526  setTax(uint256,uint256)
0xdc1052e2  setBuyTax(uint256)
... [all 19 selectors verified, see Verification section below]
```

**Confidence:** HIGH `[VERIFIED: selectors computed via ethers v6.16.0 keccak256 + toUtf8Bytes in this session]`

### 8. Multi-Amount Probe Arithmetic Verification

**Recommendation:** Use `parseEther(ctx.chain.snipeAmount) / 100n`, `/ 2n`, and the full
amount. **Verified non-zero down to 0.0001 ETH** (well below 0.003 ETH live snipe).

**Verification (executed in this research session):**
```
snipeAmount=0.003 ETH (3000000000000000 wei)
  1%   = 30000000000000 wei = 0.00003 ETH   OK
  50%  = 1500000000000000 wei = 0.0015 ETH
  100% = 3000000000000000 wei = 0.003 ETH

snipeAmount=0.005 ETH (5000000000000000 wei)
  1%   = 50000000000000 wei = 0.00005 ETH   OK
  50%  = 2500000000000000 wei = 0.0025 ETH

snipeAmount=0.01 ETH
  1%   = 100000000000000 wei = 0.0001 ETH   OK

snipeAmount=0.05 ETH (BSC default)
  1%   = 500000000000000 wei = 0.0005 ETH   OK

snipeAmount=0.0001 ETH (theoretical lower bound)
  1%   = 1000000000000 wei = 0.000001 ETH   OK
```

**No precision pitfalls.** BigInt division is integer division; truncation to zero only
occurs if `snipeAmount < 100n` wei, which corresponds to `parseEther('0.0000000000000001')`.
Operationally impossible — every chain template's `defaultSnipeAmount` ≥ 0.003 ETH.

**Implementation note:** Use BigInt arithmetic throughout. Do NOT convert to JavaScript
`Number` — that loses precision above 2^53 wei. Pattern:
```typescript
const snipeWei = ethers.parseEther(ctx.chain.snipeAmount);
const probes = [
    { label: '1%',   amount: snipeWei / 100n, gating: false },   // D-AGGREGATION: 1% is advisory
    { label: '50%',  amount: snipeWei / 2n,   gating: true  },
    { label: '100%', amount: snipeWei,        gating: true  },
];
```

The router's `INSUFFICIENT_INPUT_AMOUNT` revert hits at `amountIn === 0n`. Since 1% of
0.003 ETH is `3e13 wei` (3 trillion wei), we're 13 orders of magnitude above the
revert threshold. **Dust-revert risk is from extremely-low-liquidity pools,
not from arithmetic truncation** — the D-AGGREGATION "1% is advisory" policy correctly
addresses the pool-side issue.

**Confidence:** HIGH `[VERIFIED: computed via ethers parseEther + BigInt division in this session]`

### 9. Validation Architecture Section

See `## Validation Architecture` below.

## Bytecode Selector Scan (HONEY-12) — Verified Selector Table

Re-stating the verified selector table from Open Item 7 for the planner's
quick reference (the planner copies this into the HONEY-12 task's actionable
artifact):

| Selector | Signature | Category |
|----------|-----------|----------|
| `0x2e5bb6ff` | `setTax(uint256)` | tax-setter |
| `0x667f6526` | `setTax(uint256,uint256)` | tax-setter |
| `0xdc1052e2` | `setBuyTax(uint256)` | tax-setter |
| `0x8cd09d50` | `setSellTax(uint256)` | tax-setter |
| `0x6081752b` | `setBuyTax(uint8)` | tax-setter |
| `0x49abdc14` | `setSellTax(uint8)` | tax-setter |
| `0x0b78f9c0` | `setFees(uint256,uint256)` | tax-setter |
| `0x5d0044ca` | `setMaxWallet(uint256)` | max-wallet |
| `0xea1644d5` | `setMaxWalletSize(uint256)` | max-wallet |
| `0xec28438a` | `setMaxTxAmount(uint256)` | max-tx |
| `0x153b0d1e` | `setBlacklist(address,bool)` | blacklist |
| `0x4e054a67` | `setBlacklist(address)` | blacklist |
| `0xf9f92be4` | `blacklist(address)` | blacklist |
| `0xe57f14e1` | `excludeFromFees(address)` | fee-exempt |
| `0xc0246668` | `excludeFromFees(address,bool)` | fee-exempt |
| `0x1031e36e` | `pauseTrading()` | trading-toggle |
| `0x365ec5e5` | `pauseTrading(bool)` | trading-toggle |
| `0x8f70ccf7` | `setTrading(bool)` | trading-toggle |
| `0xc2e5ec04` | `setTradingEnabled(bool)` | trading-toggle |

**`renounceOwnership()` (`0x715018a6`) and `owner()` (`0x8da5cb5b`) are
informational, NOT flagged.** A token with `renounceOwnership()` in its bytecode is
*more* trustworthy if `owner()` already returns `0x0`. v6.18+ HONEY-V2-02 reads
`owner()` and conditionally clears tax-setter flags if ownership is renounced — Phase 18
keeps it simple and flags any tax-setter regardless of current ownership state.

## Common Pitfalls

### Pitfall A: Vacuous-Pass Regression During Rebuild

**What goes wrong:** During HONEY-07/08 implementation, a transient RPC error or
unexpected revert leads to a `return { verdict: 'safe', evidence: {} }` branch — the
V3 bug repeats itself under a new name.

**Why it happens:** Pressure to make tests green during local dev; "tolerance" path
to absorb flaky RPC; debug-level log makes the issue invisible in production.

**How to avoid (per PITFALLS #1):**
- Type-system: discriminated union HONEY-06 — `safe` requires `evidence.buyTaxBps` +
  `evidence.sellTaxBps` to be numbers, not undefined. Encode this as a literal type:
  `{ verdict: 'safe'; evidence: { buyTaxBps: number; sellTaxBps: number; method: string } }`.
- Code-review rule: any `verdict: 'safe'` branch must be preceded by `await` to a
  contract call upstream.
- Regression test: construct an "edge case the implementer might fast-path" (RPC
  error, malformed revert data, zero-length response) and assert verdict is **never**
  `safe`.

**Warning signs:** debug-level log near a verdict; `verdict: 'safe'` in a branch that
doesn't reference `evidence.buyTaxBps`; tests that mock RPC error and expect `safe`.

### Pitfall B: Sell-Only Sim Under the Roundtrip Name

**What goes wrong:** Implementer interprets "roundtrip" loosely and ships a contract
that only does the sell half (assuming `balanceOf` is pre-faked via state-override),
inheriting a buy-side gap.

**How to avoid (per PITFALLS #6):**
- The check MUST be a buy→sell roundtrip; rename the function `simulateHoneypotRoundtrip`
  (NOT `simulateSell*`) to make the contract obvious.
- Test asserts a buy-only-honeypot fixture (allows buy, blocks sell) is caught.
- Test asserts a sell-only-honeypot fixture (passes existing `simulateSwapForChain`
  buy-sim but reverts on sell) is caught — proves marginal information vs the existing
  buy-sim.

### Pitfall C: `tx.origin` Spoofing Bypass

**What goes wrong:** A malicious token gates its honeypot behavior on `tx.origin == 0`
to behave nicely for `eth_call` (where origin defaults to zero) but maliciously for
real transactions. Detector passes; real buy fails.

**How to avoid (per PITFALLS #4):**
- Always pass `from: ctx.wallet.address` in `provider.call()` — sets `tx.origin` to
  the bot's signer for the simulation, matching what real production sees.
- Add a regression test that constructs a token whose `_transfer` reverts when
  `tx.origin == 0` and asserts the gate catches it.
- HONEY-12 bytecode scan does NOT include `tx.origin` (`0x32`) as a flag — too noisy
  (used legitimately in EIP-2612 permits). Trust the `from` field to address this.

### Pitfall D: Gas-Griefing False Positive

**What goes wrong:** A token's `_transfer` consumes excessive gas. The router call
reverts at the block gas limit. The dispatch interprets the revert as `unsafe` —
correct! But the OPERATOR worries the gate is over-blocking when in fact the token
is genuinely gas-griefy.

**How to avoid (per PITFALLS #4):**
- The semantic IS correct — gas-griefy tokens are unsafe to trade. No fix needed.
- Document in the operator runbook: "gas-grief reverts are correct unsafe verdicts;
  do not adjust the contract to ignore them."
- The structured pino log line includes `revertReason` so the operator can
  distinguish gas-grief (`out of gas`) from honeypot (`BUY_BAL_ZERO`).

### Pitfall E: Stale Block / Race Between Sim and Buy

**What goes wrong:** Between "checker returns safe at block T" and "buy lands at
block T+1," the deployer flips tax via `setTax(9999)`. Bot bought at 0% tax verdict;
now stuck at 99% tax.

**How to avoid (per PITFALLS #7):**
- Phase 18 does NOT atomically bundle checker + buy in a single MEV tx. That's a
  v6.18+ optimization (the "checker-in-buy-tx" pattern).
- HONEY-12 bytecode scan partially mitigates: tokens WITH mutable tax setters get
  blocked even if current tax is 0%. Catches the "deployer can flip" case at the
  bytecode level.
- Document explicit gap: "mutable-tax flip between sim and submit" is a known
  residual risk; ANTIRUG (Phase 19) covers post-buy tax flips via runtime
  monitoring.

### Pitfall F: Mainnet Fork Test Sends Real Tx

**What goes wrong:** Test file uses `process.env.ETH_RPC_URL` and the URL points at
real mainnet (because `.env` is shared with prod or `HARDHAT_FORK_URL` was forgotten).
The checker contract gets actually deployed on mainnet at unintended addresses, or
worse, a roundtrip is "tested" with real ETH.

**How to avoid (per PITFALLS #12):**
- Fork tests assert `network.chainId !== 1n` OR `process.env.ALLOW_REAL_MAINNET === '1'`.
- Test wallet is NOT the operator's prod wallet — dedicated funded-with-cents test
  wallet.
- `test/fork/setup.ts` already exists; extend it with the chainId guard during HONEY-08.

### Pitfall G: Unknown-Verdict Fallback to Parallel Bank Erodes Strictness

**What goes wrong:** Plan-time, someone proposes "if checker returns `unknown`, fall
back to the parallel-bank honeypot APIs." Sounds reasonable. Erodes D-UNKNOWN-POLICY
"strictest fail-closed."

**How to avoid:**
- D-UNKNOWN-POLICY is CLOSED — `unknown` → one-shot skip, no fallback.
- The parallel bank still RUNS, but NOT as a fallback for `unknown`. It runs in
  parallel with the deterministic gate as defense-in-depth (verifies the safe-verdict;
  catches what the on-chain checker missed). `unknown` from the on-chain checker is
  itself a fail-closed signal.

## Runtime State Inventory

Phase 18 is not a rename/refactor/migration phase. Skipping this section per the
instructions.

## Code Examples

Verified patterns from official sources:

### Custom Error Revert Decode (ethers v6)

```typescript
// Source: docs.ethers.org/v6/api/abi + ethers-io/ethers.js discussion #4157
import { Interface } from 'ethers';

const iface = new Interface([
    'error RoundtripResult(uint256 buyTaxBps, uint256 sellTaxBps, uint8 status)',
    'error BuyFailed(string reason)',
    'error SellFailed(string reason)',
]);

try {
    await provider.call({
        to: deployedAddress,
        data: iface.encodeFunctionData('check', [router, token, amountWei]),
        value: amountWei,
        from: walletAddress,
    });
    // Unreachable — checker always reverts at end.
} catch (e: unknown) {
    const err = e as { data?: string };
    const data = err.data ?? '';
    try {
        const parsed = iface.parseError(data);
        if (parsed?.name === 'RoundtripResult') {
            const [buyTaxBps, sellTaxBps, status] = parsed.args;
            // status === 0x07 = all asserts passed
        }
    } catch { /* not a known error fragment — treat as raw revert */ }
}
```

### Hardhat Ignition Multi-Chain Deploy

```bash
# Source: hardhat.org/ignition/docs
# One module, deploy per network. Address tracked in ignition/deployments/<chainId>/
DEPLOY_PRIVATE_KEY=0x... ETH_RPC_URL=https://... \
    npx hardhat ignition deploy ignition/modules/HoneypotChecker.ts --network mainnet

DEPLOY_PRIVATE_KEY=0x... BSC_RPC_URL=https://... \
    npx hardhat ignition deploy ignition/modules/HoneypotChecker.ts --network bsc

# Verify on Etherscan after deploy
npx hardhat verify --network mainnet 0xDEPLOYED_ADDRESS
```

### 4-Byte Selector Computation

```typescript
// Source: ethers v6 utils.keccak256 + utils.toUtf8Bytes
import { keccak256, toUtf8Bytes } from 'ethers';

function selector(signature: string): string {
    return keccak256(toUtf8Bytes(signature)).substring(0, 10);
}

// e.g. selector('setTax(uint256)') === '0x2e5bb6ff'
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `simulateSellForChain` passing `balance=0` to router (hard-block on every snipe) | `simulateHoneypotRoundtrip` dispatching to on-chain `HoneypotChecker.sol` with multi-amount probe + post-trade asserts | Phase 18 (v6.17) | V2 sniping works again; V3 vacuous-pass replaced with real check; type-system prevents future vacuous-pass regression |
| Single sell-only sim | Buy→sell roundtrip with `balanceOf` + `address.balance` post-trade asserts | Phase 18 (v6.17) | Catches lying-balanceOf + silent-zero-ETH-on-sell honeypot variants that sell-only sim missed |
| Single-amount tax probe | 1% / 50% / 100% multi-amount probe per D-AGGREGATION | Phase 18 (v6.17) | Catches amount-tiered taxes (PITFALLS #5) |
| No bytecode static analysis | HONEY-12 selector-presence scan in parallel bank | Phase 18 (v6.17) | Closes "owner flips tax mid-position" attack vector that roundtrip can't catch |
| `Promise<boolean>` safety-gate return | `Promise<HoneypotResult>` discriminated union | Phase 18 (v6.17) | Vacuous-pass unrepresentable in type system; `unknown` fails closed by construction |

**Deprecated:**
- `simulateSellForChain` (tokenSafety.ts:555-586): DELETED in Phase 18.
- `simulateSellV3ForChain` (tokenSafety.ts:593-634): DELETED in Phase 18.
- No legacy fallback flag retained per D-ROLLBACK.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Mythril doesn't have a built-in `--fail-on-severity` flag in all releases | Open Item 4 | Planner spends extra effort writing a JSON-parsing wrapper script that wasn't strictly needed. Low impact — wrapper is cheap. |
| A2 | Specific honeypot.is / Etherscan addresses `0x80e4f01...` and `0x34c6211...` are still active honeypot patterns at a block-pinnable historical point | Open Item 3 | Fixture-selection task surfaces no valid fixture at plan-time; planner falls back to honeypot.is API discovery. Mitigated by D-FIXTURE allowing contrived contract as primary + real as supplement. |
| A3 | OpenZeppelin `^5.4.0` resolves up to 5.6.1 with no ABI-breaking changes to `IERC20` | Standard Stack | `IERC20` interface mismatch causes compile failure — caught immediately by Hardhat. Trivial to fix. |
| A4 | Hardhat 2.26 + Ignition 0.15.16 + hardhat-verify 2.1.0 toolchain remains stable through Phase 18 deploy | Standard Stack | A breaking upstream change in pinned-range minor could cause friction — planner pins exact versions during HONEY-03 wave if observed. |
| A5 | V2 router calldata (`swapExactETHForTokens`, `swapExactTokensForETHSupportingFeeOnTransferTokens`, `getAmountsOut`, `WETH`) is universal across all 4 chains' V2 forks (Uniswap V2, Sushi V2, PancakeSwap V2, BiSwap, Camelot V2, Aerodrome) | HoneypotChecker.sol Skeleton | A V2 fork with non-standard router ABI (e.g., Aerodrome has stable/volatile pools) compile-time-fails or runtime-reverts. Mitigated by per-chain rollout (HONEY-03 → HONEY-04) — issue surfaces on first chain that uses the divergent router. |

**Note for the planner:** A1-A2 should be confirmed with the user during discuss-phase
before locking. A3-A5 are low-risk and fail loudly.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^4.1.1` (already configured) |
| Config file | `vitest.config.ts` (3 projects: `unit`, `integration`, `fork` — Phase 18 adds tests to existing projects; **no new project needed**) |
| Solidity compile | `npx hardhat compile` — runs in CI on `contracts/**` changes |
| Quick run command | `npx vitest run --project unit` (~5s) |
| Integration run | `npx vitest run --project integration` (~15s) |
| Fork run | `npx vitest run --project fork` (~120s; runs against `ETH_FORK_RPC_URL`) |
| Full suite command | `npm run test:all` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HONEY-01 | Solidity compiles under solc 0.8.28 | smoke | `npx hardhat compile` | ❌ Wave 0 (new contract file) |
| HONEY-01 | Roundtrip executes against contrived `Honeypot.sol` fixture, returns `unsafe` | fork | `npx vitest run --project fork test/fork/honeypotChecker.fork.test.ts` | ❌ Wave 0 |
| HONEY-02 | Slither runs clean (or only low/info findings) on `HoneypotChecker.sol` | smoke | `slither contracts/honeypot/HoneypotChecker.sol --fail-medium` | ❌ Wave 0 (new CI job) |
| HONEY-02 | Mythril runs clean (or only low/info findings) on `HoneypotChecker.sol` | smoke | `myth analyze contracts/honeypot/HoneypotChecker.sol -o json > /tmp/m.json && node scripts/check-mythril-report.ts /tmp/m.json` | ❌ Wave 0 |
| HONEY-03 | Deployed contract has bytecode at recorded address on ETH | integration | `npx vitest run --project integration test/integration/honeypotDeploy.eth.test.ts` (uses `provider.getCode`) | ❌ Wave 0 |
| HONEY-04 | Deployed contract has bytecode at recorded address on BSC/Base/Arb | integration | per-chain `test/integration/honeypotDeploy.{bsc,base,arb}.test.ts` | ❌ Wave 0 |
| HONEY-05 | Dispatch layer routes `method='on-chain-contract'` to `checkerContract.ts` | unit | `npx vitest run --project unit test/unit/honeypotDispatch.test.ts` | ❌ Wave 0 |
| HONEY-06 | `HoneypotResult` discriminated union: vacuous pass unrepresentable | unit | `npx vitest run --project unit test/unit/honeypotTypes.test.ts` (TS compile gate via `tsc --noEmit`) | ❌ Wave 0 |
| HONEY-06 | `unknown` verdict at every caller results in `return` (skip buy) | integration | `npx vitest run --project integration test/integration/honeypotUnknownFailsClosed.test.ts` | ❌ Wave 0 |
| HONEY-07 | V2 in-place replacement: `bot.ts:220-226` calls `simulateHoneypotRoundtrip` | integration | `npx vitest run --project integration test/integration/v2HoneypotIntegration.test.ts` | ❌ Wave 0 |
| HONEY-08 | V3 in-place replacement: `bot.ts:411-416` calls `simulateHoneypotRoundtrip`; vacuous pass replaced | integration | `npx vitest run --project integration test/integration/v3HoneypotIntegration.test.ts` | ❌ Wave 0 |
| HONEY-09 | `evidence.buyTaxBps` + `evidence.sellTaxBps` populated as numbers; `MAX_BUY_TAX_BPS` threshold enforced | unit | `npx vitest run --project unit test/unit/honeypotTaxThreshold.test.ts` | ❌ Wave 0 |
| HONEY-10 | 3 probes at 1%/50%/100%; 50% revert → unsafe; 100% revert → unsafe; 1% revert → safe-with-warning | fork | `npx vitest run --project fork test/fork/honeypotMultiAmount.fork.test.ts` | ❌ Wave 0 |
| HONEY-11 | Each of 8 parallel-bank gates has a regression test asserting underlying-behavior exercise | unit + integration | `npx vitest run` over `test/unit/safetyBank/*.test.ts` (one file per gate) | ❌ Wave 0 (8 new test files) |
| HONEY-12 | `isMutableTokenForChain` returns `isMutable: true` on bytecode containing `setTax(uint256)` selector | unit | `npx vitest run --project unit test/unit/bytecodeScan.test.ts` | ❌ Wave 0 |

### Sampling Rate (Nyquist Convention)

- **Per task commit:** `npx vitest run --project unit` (~5s) + `npx hardhat compile` if `contracts/**` touched
- **Per wave merge:** `npm run test:all` (unit + integration + fork) + Slither/Mythril if `contracts/**` touched
- **Phase gate:** Full suite green + Slither/Mythril clean + Etherscan-verified deploy on ETH (HONEY-03) before `/gsd:verify-work`

### Wave 0 Gaps

The following test files do not exist and must be authored as Wave 0 deliverables. The
planner allocates these across plans/waves:

**Test files (15 new):**
- [ ] `test/fixtures/contracts/Honeypot.sol` — contrived test honeypot per D-FIXTURE
- [ ] `test/fork/fixtures/honeypots/README.md` + `eth-*.json` × 1-2 per chain
- [ ] `test/fork/honeypotChecker.fork.test.ts` — roundtrip against contrived + real fixtures
- [ ] `test/fork/honeypotMultiAmount.fork.test.ts` — 1/50/100 probe semantics
- [ ] `test/integration/honeypotDispatch.test.ts` — dispatch routing
- [ ] `test/integration/honeypotUnknownFailsClosed.test.ts` — unknown semantics
- [ ] `test/integration/honeypotDeploy.eth.test.ts` — code-at-address verification
- [ ] `test/integration/v2HoneypotIntegration.test.ts` — V2 in-place replacement
- [ ] `test/integration/v3HoneypotIntegration.test.ts` — V3 in-place replacement
- [ ] `test/unit/honeypotTypes.test.ts` — discriminated union compile gate
- [ ] `test/unit/honeypotDispatch.test.ts` — dispatch unit tests
- [ ] `test/unit/honeypotTaxThreshold.test.ts` — threshold enforcement
- [ ] `test/unit/bytecodeScan.test.ts` — HONEY-12 selector matching
- [ ] `test/unit/safetyBank/*.test.ts` × 8 — HONEY-11 audit regressions (one per gate)

**Tooling (3 new):**
- [ ] `scripts/check-mythril-report.ts` — JSON severity gate for Mythril CI
- [ ] Slither + Mythril install steps in `.github/workflows/test.yml`
- [ ] `npx hardhat compile` gate in CI on `contracts/**` changes (already in canonical refs)

**Regression-pattern boilerplate (proves a gate didn't regress to vacuous-pass):**
```typescript
// test/unit/safetyBank/<gateName>.test.ts (template per HONEY-11 + D-AUDIT-BAR)
describe('<GATE> regression — never returns safe on edge cases', () => {
    it('returns unsafe (not vacuous safe) when RPC throws', async () => {
        const ctx = mockChainContextWithRpcError();
        const result = await <gateFn>(ctx, MOCK_TOKEN);
        expect(result.verdict).not.toBe('safe');
    });
    it('returns unsafe (not vacuous safe) when balance is zero / no contract / unknown method', async () => {
        // ... per-gate edge case ...
        expect(result.verdict).not.toBe('safe');
    });
    it('exercises the underlying behavior — observable effect required', async () => {
        // PER D-04: asserts at least one DB row, mock-call arg, log line, or RPC call
        expect(provider.getCode).toHaveBeenCalledWith(MOCK_TOKEN);  // or equivalent observable
    });
});
```

### Evidence Completeness Assertion

Per Nyquist + D-04 observable-effect rigor, every `safe` verdict must be accompanied
by evidence of underlying-behavior exercise. The regression test pattern is:

```typescript
// Encoded as a property test:
it('safe verdict implies evidence.buyTaxBps and evidence.sellTaxBps are populated', async () => {
    const result = await simulateHoneypotRoundtrip(ctx, dex, GOOD_TOKEN);
    if (result.verdict === 'safe') {
        expect(typeof result.evidence.buyTaxBps).toBe('number');
        expect(typeof result.evidence.sellTaxBps).toBe('number');
        expect(result.evidence.method).toBe('on-chain-contract');
    }
});

// And the TYPE SYSTEM enforces this at compile time (HONEY-06).
```

### What's the Smallest Fixture Set?

- **1 contrived `Honeypot.sol`** with 4 modes (sell-revert, max-wallet, lying-balanceOf,
  silent-zero-ETH-on-sell) — toggled via constructor args. Covers every Phase 18 verdict
  branch deterministically.
- **1-2 real pinned mainnet honeypots per chain** — catches real-world variations the
  contrived contract might miss. ETH first (HONEY-03); BSC/Base/Arb in HONEY-04.

Minimum fork-test count: 1 contrived × 4 modes + 2 real × 1 chain = **6 fork tests** at
Phase 18 close (more added per chain in HONEY-04).

### What Regression-Test Pattern Proves a Gate Didn't Regress to Vacuous-Pass?

For each of the 8 parallel-bank gates (HONEY-11 D-AUDIT-BAR), a single regression test
asserts:
1. Construct an edge case (RPC error, zero balance, malformed response).
2. Call the gate.
3. Assert `result.verdict !== 'safe'` (`unsafe` or `unknown` both acceptable).
4. Assert at least one observable effect (mock-call arg, log line, getCode call).

This pattern is encoded as a vitest template the planner reuses 8 times — one per gate.
Total LOC: ~30 LOC × 8 = 240 LOC of new tests, plus the discriminated-union retrofits
(or, if planner keeps existing gates on `Promise<boolean>`, a wrapper assertion that
`return true` was preceded by an observable effect).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `DEPLOY_PRIVATE_KEY` separate from bot's `PRIVATE_KEY` per D-DEPLOY-KEY; rotated out of `.env` after one-time use |
| V3 Session Management | no | No user-facing sessions in this phase |
| V4 Access Control | yes | HoneypotChecker.sol is immutable (no owner key); deploy key has deploy authority only, not snipe authority — capability separation |
| V5 Input Validation | yes | `require(msg.value == amountIn)` in contract; ethers v6 ABI-encoding enforces TS-side parameter types |
| V6 Cryptography | no | No new cryptographic primitives; uses ethers `keccak256` for selector computation only |
| V7 Error Handling | yes | Custom errors per ASVS V7 "fail-closed error handling"; structured pino logging captures every gate verdict + evidence |
| V8 Data Protection | yes | `DEPLOY_PRIVATE_KEY` in `.env` only during deploy window; SOPS or equivalent not currently configured but operator instruction is to rotate post-deploy |
| V12 File and Resources | no | No new file uploads or external file dependencies |

### Known Threat Patterns for the Phase 18 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Vacuous-pass regression in safety gate | Spoofing (verdict spoofs reality) | Discriminated-union return type; PR review rule; regression test per gate |
| `tx.origin` spoofing in token `_transfer` | Spoofing | Set `from: ctx.wallet.address` in `eth_call` |
| Lying `balanceOf` (token reports balance not reflective of transfer) | Tampering | `require(balAfter > balBefore)` post-buy assertion in HoneypotChecker.sol |
| Silent zero-ETH-on-sell (router returns 0 ETH but doesn't revert) | Tampering | `require(ethAfter > ethBefore)` post-sell assertion |
| Mutable tax setter flipped mid-position | Tampering | HONEY-12 bytecode selector scan blocks tokens with `setTax` family selectors |
| Gas-grief in token `_transfer` | Denial of Service | Outer `eth_call` gas-limit enforces; revert → `unsafe` verdict (correct) |
| Compromised deploy key allows malicious checker contract at trusted address | Elevation of Privilege | Immutable contract — no upgrade path; redeploy at new address required; operator audits before pasting address into `chainRegistry.ts` |
| Slopsquatted package compromises CI | Tampering | No new packages this phase; v6.16-vetted deps only |
| Stale `.env` runs fork test against real mainnet | Tampering | chainId guard + `ALLOW_REAL_MAINNET=1` env gate (per OPS-LIVE in Phase 21; planner adds basic guard to `test/fork/setup.ts` in Phase 18 if not already present) |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Bot runtime + tests + Hardhat | ✓ (assumed — v6.16 production) | 18+ | — |
| `ethers@6.16.0` | Dispatch + decode | ✓ | 6.16.0 | — |
| `hardhat@2.26.0` | Compile + deploy | ✓ | 2.26.0 | — |
| `@openzeppelin/contracts@^5.4.0` | `IERC20` import | ✓ | resolves to 5.6.1 | — |
| `@nomicfoundation/hardhat-ignition@^0.15.16` | Deploy module | ✓ | 0.15.16+ | — |
| `@nomicfoundation/hardhat-verify@^2.1.0` | Etherscan/BscScan verify | ✓ | 2.1.0+ | — |
| `slither-analyzer` (Python) | HONEY-02 audit | ✗ | — | Install via `pip install slither-analyzer` in CI; document install in dev README |
| `mythril` (Python) | HONEY-02 audit | ✗ | — | Install via `pip install mythril` in CI; document install in dev README |
| `ETH_RPC_URL` env | Mainnet fork tests + deploy | ✓ (assumed — existing v6.16 config) | — | — |
| `BSC_RPC_URL`, `BASE_RPC_URL`, `ARB_RPC_URL` env | HONEY-04 deploys + integration tests | ✓ (template defaults exist) | — | — |
| `DEPLOY_PRIVATE_KEY` env | HONEY-03/04 deploys | ✗ (new env var per D-DEPLOY-KEY) | — | Operator creates a fresh deploy wallet, funds ~$10-20 native gas across 4 chains, sets env, deploys, rotates key out |
| `ETHERSCAN_API_KEY` (+ per-chain explorer keys) | Source verification | ✗ (not currently in `.env`) | — | Operator obtains free API keys from each explorer; documented in operator runbook |

**Missing dependencies with no fallback:** none — all gaps have a documented remediation step.

**Missing dependencies with fallback:** `slither-analyzer`, `mythril`, `DEPLOY_PRIVATE_KEY`,
`ETHERSCAN_API_KEY` family — all of these are one-time setup at HONEY-02/03 time and
do not block Wave 0 contract authoring.

## Sources

### Primary (HIGH confidence)
- **CONTEXT.md** at `.planning/phases/18-honeypot-detection-rebuild/18-CONTEXT.md` — locked decisions D-* + Claude's Discretion
- **research/SUMMARY.md** §"Decision: Option C vs Option D — Closed (D)" + §"Critical Pitfalls"
- **research/STACK.md** — version matrix (ethers 6.16, Hardhat 2.26, OZ ^5.4.0)
- **research/ARCHITECTURE.md** §"Honeypot Detection Integration" — file layout + integration wiring
- **research/PITFALLS.md** Pitfalls #1, #2, #3, #4, #5, #6, #7, #12, #19
- **REQUIREMENTS.md** HONEY-01..HONEY-11
- **HONEYPOT-SIM-BRIEFING.md** — original bug write-up and option matrix
- Direct code reads: `src/utils/tokenSafety.ts:1-635`, `src/bot.ts:180-540`, `src/chainRegistry.ts:1-300`, `hardhat.config.ts`, `package.json`, `vitest.config.ts`
- `npm view ethers version` → 6.16.0; `npm view hardhat version` → 3.4.5; `npm view @openzeppelin/contracts version` → 5.6.1 (2026-05-15)
- ethers v6 `keccak256` + `toUtf8Bytes` + `parseEther` executed in this session — selector table verified, multi-amount arithmetic verified

### Secondary (MEDIUM confidence)
- [Slither docs at secure-contracts.com/program-analysis/slither](https://secure-contracts.com/program-analysis/slither/docs/src/) — confirms `--fail-medium` flag and severity ladder
- [crytic/slither GitHub](https://github.com/crytic/slither) — CLI reference
- [ethers v6 docs at docs.ethers.org/v6/api/abi](https://docs.ethers.org/v6/api/abi/) — `Interface.parseError` and `decodeErrorResult` semantics
- [ethers-io/ethers.js discussion #4157](https://github.com/ethers-io/ethers.js/discussions/4157) — confirms `parseError` is the ethers v6 idiomatic decode path
- [Hardhat Ignition docs at hardhat.org/ignition](https://hardhat.org/ignition) — `buildModule` + per-network deploy
- [Alchemy eth_call docs](https://docs.alchemy.com/reference/eth-call) and [Alchemy eth_simulateV1 docs](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-simulate-v-1) — state-override semantics
- [MetaMask/Infura eth_simulateV1 docs](https://docs.metamask.io/services/reference/ethereum/json-rpc-methods/eth_simulatev1/) — "Mainnet and Sepolia only" caveat for Option C (deferred to v6.18+)
- [Etherscan address 0x80e4f014…](https://etherscan.io/address/0x80e4f014c98320eab524ae16b0aaf1603f4dc01d) — public "honeypot 2" reference for fixture candidate
- [honeypot.is/ethereum](https://honeypot.is/ethereum) — confirmed-honeypot database

### Tertiary (LOW confidence — needs validation during planning)
- Specific real-mainnet honeypot fixture token selection — planner verifies each candidate at the pinned block before commit (Assumption A2)
- Mythril CLI severity-threshold flag behavior across recent releases — planner verifies during HONEY-02 (Assumption A1)
- Exact LOC of compiled `HoneypotChecker.sol` — estimate is ~110-120, planner confirms post-compile

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified via `npm view` 2026-05-15; toolchain pinned by package.json; no new packages
- Architecture: HIGH — closed in CONTEXT.md + prior research convergence; this phase ships the decided design
- Pitfalls: HIGH — cross-referenced against existing PITFALLS.md #1-#7, #12, #19 and against the canonical V3 vacuous-pass example in current code
- Multi-amount arithmetic: HIGH — computed in this session, verified non-zero at all realistic snipe sizes
- Bytecode selectors: HIGH — keccak256 computed in this session
- Solidity skeleton: HIGH — verified against Uniswap V2 router ABI + OZ 5.x + solc 0.8.28
- Hardhat Ignition shape: HIGH — verified against Hardhat 2.26 + Ignition 0.15.x docs
- Slither/Mythril invocation: MEDIUM — Slither `--fail-medium` documented; Mythril severity wrapper assumed needed (A1)
- Real-mainnet fixture selection: MEDIUM — candidates identified, but block-pin validity needs planner verification (A2)

**Research date:** 2026-05-15
**Valid until:** 2026-06-14 (30 days — stable infrastructure; Phase 18 ships before then)

---
*Researcher: Phase 18 - Honeypot Detection Rebuild*
*Phase: 18-honeypot-detection-rebuild*
*Architecture: CLOSED per CONTEXT.md — Option D primary, Option C stub only*
