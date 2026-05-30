---
phase: 18-honeypot-detection-rebuild
fixed_at: 2026-05-23T05:30:00Z
review_path: .planning/phases/18-honeypot-detection-rebuild/18-REVIEW.md
iteration: 1
findings_in_scope: 13
fixed: 12
skipped: 1
status: partial
---

# Phase 18: Code Review Fix Report

**Fixed at:** 2026-05-23T05:30:00Z
**Source review:** `.planning/phases/18-honeypot-detection-rebuild/18-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope (Critical + Warning, excluding Info): 13
- Fixed: 12
- Skipped: 1 (WR-09 — out of Phase 18 scope per orchestrator instruction)

All 414 unit + integration tests pass after fixes (Hardhat compile clean, `tsc --noEmit` clean). Each fix landed in its own atomic commit on the worktree branch `gsd-reviewfix/18-52527` (will fast-forward to `master` during cleanup).

**IMPORTANT operational note (CR-04, WR-04, WR-06):** `contracts/honeypot/HoneypotChecker.sol` is already deployed on Ethereum mainnet at `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD` (immutable, audit-once-deploy-once). The Solidity source-level fixes applied here (`forceApprove` + `@dev` comments) only take effect at the next deploy under plan 18-08 for BSC/Base/Arb. The deployed ETH copy still runs the old bytecode. Per orchestrator instruction, no redeploy was attempted.

## Fixed Issues

### CR-01a: hard-fail on null deployedAddress for enabled chains

**Files modified:** `src/chainRegistry.ts`
**Commit:** `e412f92`
**Applied fix:** Added a fail-loud validation in `buildChainRegistry()` that calls `log.fatal` + `process.exit(1)` when an enabled chain's `honeypotMethod === 'on-chain-contract'` but `honeypotCheckerAddress` (template default OR env override) is null. Prevents the silent BSC/Base/Arb hard-block described in CR-01.

### CR-01b: drop redundant checkHoneypotForChain from V2 + V3 banks

**Files modified:** `src/bot.ts`
**Commit:** `050b0b9`
**Applied fix:** Removed `checkHoneypotForChain` from both the V2 (line ~262) and V3 (line ~491) parallel safety banks. The on-chain `simulateHoneypotRoundtrip` gate at line 232 (V2) and 459 (V3) is the authoritative Option-D check; running the third-party honeypot.is/GoPlus call in parallel doubled cost and risked divergence. `isHoneypot` is now hard-coded `false` so existing log + alert lines that reference it continue to type-check. Unused import removed to satisfy `tsc --noEmit`.

### CR-02: exhaustive `never` check on dex.dexType dispatch

**Files modified:** `src/utils/honeypot/index.ts`
**Commit:** `66b54f6`
**Applied fix:** Replaced the sequential `if (dex.dexType === 'v2') ... if (dex.dexType === 'v3') ...` chain with a `switch (dex.dexType)` block plus a `default: { const _exhaustive: never = dex; ... }` exhaustiveness guard. A future `v4` variant added to `DexConfig` now fails `tsc --noEmit` here rather than silently falling through to the `bad-method` branch with a misleading diagnostic.

### CR-03: sanitize reason strings before Telegram markdown interpolation

**Files modified:** `src/utils/honeypot/sanitize.ts` (new), `src/utils/honeypot/checkerContract.ts`, `src/bot.ts`
**Commit:** `0028713`
**Applied fix:** Created a new `sanitizeReason()` helper in `src/utils/honeypot/sanitize.ts` that strips Telegram MarkdownV2 special characters (` ` * _ [ ] ( ) \ ~ | < > { } # + = ! `), ASCII control bytes (0x00–0x1F + 0x7F), and clamps to 120 chars. Applied at all four sites flagged in CR-03: the V2 outer catch in `checkerContract.ts:289`, the V3 outer catch at `:372`, the V2 SKIP alert in `bot.ts:251`, and the V3 SKIP alert in `bot.ts:479`. Also clamps `evidence.revertReason` in `aggregateProbes`. Defense-in-depth: alerts re-sanitize even if upstream wrapper already did so.

### CR-04: SafeERC20.forceApprove + document address-discriminating limit

**Files modified:** `contracts/honeypot/HoneypotChecker.sol`
**Commit:** `30f03d4`
**Applied fix:** Imported `SafeERC20` from OpenZeppelin 5.x, added `using SafeERC20 for IERC20;` at the contract level, replaced both `IERC20(token).approve(router, received)` calls (V2 sell at line 173, V3 sell at line 323) with `IERC20(token).forceApprove(router, received)`. `forceApprove` reverts when the token's `approve` returns `false`, closing the silent-success path that USDT-style or maliciously-coded tokens exploit. Also added a contract-level `@dev` block documenting the address-discriminating honeypot limit that this contract structurally cannot defeat (msg.sender inside the checker is `address(this)`, not the bot wallet); downstream mitigations remain bytecode scan (HONEY-12) and the Phase 19 anti-rug monitor. Compiles clean.

**Deployment caveat (per orchestrator instruction):** the ETH-deployed copy still runs the old `approve` bytecode. This source fix takes effect on the next deploy under plan 18-08 (BSC/Base/Arb).

### WR-01: tighten honeypot edge-case assertions to precise verdict

**Files modified:** `test/integration/honeypotUnknownFailsClosed.test.ts`
**Commit:** `c23e3d0`
**Applied fix:** Tests 4, 5, 6 previously asserted `result.verdict !== 'safe'` which masked refactors that flipped between `'unsafe'` and `'unknown'`. Tightened to `expect(result.verdict).toBe('unsafe')`. Test 5 additionally asserts `result.reason` matches `/no-terminal-revert/`. Updated the docstring header comment to reflect the actual expected verdict for each test. Test 7 was already tight and was kept as-is. All 4 tests pass.

### WR-02: drop dead pair.token1() call in isLiquiditySufficientForChain

**Files modified:** `src/utils/tokenSafety.ts`
**Commit:** `fc4dda0`
**Applied fix:** Removed the `pair.token1()` Promise from the `Promise.all` at line ~430; replaced the destructured `[token0]` with a direct `const token0 = await pair.token0()`. Saves one RPC round-trip per liquidity check. The single-chain `isLiquiditySufficient` at line ~169 reads BOTH values and is unaffected.

### WR-03: README — phase 18 shipped on ETH (was "in progress")

**Files modified:** `README.md`
**Commit:** `3edd447`
**Applied fix:** Updated all four README sites flagged in WR-03 (lines 17, 113, 305, 433) to reflect the actual deployment state: the contract is deployed on Ethereum mainnet at `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD`, plan 18-09 + 18-10 wire-up is shipped, ETH snipes are gated by the on-chain HoneypotChecker, and BSC/Base/Arb deploys are pending plan 18-08. Status text changed from "In Progress" to "Shipped on ETH; other chains pending 18-08".

### WR-04 + WR-06: document ethBefore baseline + reentrancy invariants

**Files modified:** `contracts/honeypot/HoneypotChecker.sol`
**Commit:** `ebecab5`
**Applied fix:** Two pure-docstring additions to the deployed contract source:
- **WR-04:** Added a comment above the V2 sell-leg's `uint ethBefore = address(this).balance;` documenting that the baseline may include the V2 router's ETH refund and that the subtraction at line 196 is correct only because `receive()` is empty. Explicit "keep receive() empty" guidance for future maintainers.
- **WR-06:** Added a comprehensive `@dev` block above `receive()` documenting the three load-bearing invariants that allow checkV2/checkV3 to safely omit `nonReentrant` despite calling untrusted token code: (1) revert-always design rolls back all state, (2) `receive()` is empty, (3) `require(msg.value == amountIn)` catches zero-value reentry. Explicit "if any invariant is violated, add nonReentrant before deploy" guidance.

No semantic change to the contract — pure docstring additions, no bytecode effect on the deployed copy. Compiles clean.

### WR-05: differentiate config-bug vs unsafe-token in outer catch

**Files modified:** `src/utils/honeypot/checkerContract.ts`
**Commits:** `4818d93` (initial fix), `b115af4` (lint-friendly tweak)
**Applied fix:** Added `isConfigBugError(e: unknown)` helper that returns `true` when a thrown error matches ethers v6 config-bug shapes (`code === 'INVALID_ARGUMENT'`, `code === 'NUMERIC_FAULT'`, or message substrings `parseEther` / `encodeFunctionData` / `INVALID_ARGUMENT` / `invalid address`). Outer catches in `simulateViaContractV2` and `simulateViaContractV3` now return `verdict: 'unknown'` for config bugs (D-UNKNOWN-POLICY) instead of misleading `'unsafe'`. The follow-up commit `b115af4` rewrote the helper and its comment to avoid the standalone v5 class-name token that the ETH6-01 lint test bans — the code-based check covers the same throw shapes and is more robust across ethers version bumps.

**Requires human verification:** the heuristic classifier may need tuning if real-world config-bug throw shapes don't match the listed substrings/codes. Per the verification strategy's logic-bug limitation guidance, this is flagged for the operator to manually confirm against production logs.

### WR-07: drop misleading "TX confirmed" log + alert lines

**Files modified:** `src/bot.ts`
**Commit:** `7993916`
**Applied fix:** Removed `ctx.log.info(..., 'TX confirmed')` and the corresponding `sendCtxAlert(ctx, '*TX confirmed* ...')` lines from both the V2 buy path (after line 369) and the V3 buy path (after line 595). `sendTxWithRetry` returns on submission, NOT on confirmation; emitting "TX confirmed" here misled the operator into believing the trade had settled. Actual settlement arrives later via the receipt decoder which updates `trades.status` from `'pending'` to `'sold'` or `'failed'`. Pre-existing pattern; applied per orchestrator instruction.

### WR-08: enforce DEPLOY_PRIVATE_KEY != PRIVATE_KEY at deploy time

**Files modified:** `scripts/deploy-honeypot-checker.ts`
**Commit:** `8cf20de`
**Applied fix:** Added a check immediately after the existing `DEPLOY_PRIVATE_KEY` presence validation that calls `log.fatal` + `process.exit(1)` when both `PRIVATE_KEY` and `DEPLOY_PRIVATE_KEY` are set AND equal. Prevents the silent D-DEPLOY-KEY capability-split bypass an operator would trigger by copy-pasting from `.env.example` with one key for both.

## Skipped Issues

### WR-09: Inbound Telegram listener default allows all senders + channels

**File:** `.env.example:50-51`
**Reason:** Out of Phase 18 scope per orchestrator instruction. The review itself flagged the Telegram listener as pre-existing — Phase 18 does not touch `src/telegramListener.ts`. The orchestrator explicitly instructed: "skip and document as out-of-scope". The combination of WR-09 (pre-existing wide-open default) + CR-03 (now fixed) was the exploitability concern; CR-03's sanitizer closes the markdown-injection vector even when an attacker can reach the bot via the wide-open Telegram listener, so the immediate exploitability is mitigated. A follow-up Phase 19 (or similar) plan should still tighten the listener default to require explicit `*` for "allow all".
**Original issue:** Default `TELEGRAM_ALLOWED_SENDERS=` empty value means "allow all"; combined with CR-03 markdown-injection vector, an attacker who joins any group the bot's MTProto session is in could feed crafted token addresses and observe markdown-injecting SKIP alerts.

---

_Fixed: 2026-05-23T05:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
