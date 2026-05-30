---
phase: 14
reviewers: [gemini, codex]
reviewed_at: 2026-04-06T23:44:04Z
plans_reviewed: [14-01-PLAN.md, 14-02-PLAN.md]
runtime_skipped: claude (running inside Claude Code CLI)
---

# Cross-AI Plan Review — Phase 14: Sell Revenue Receipt Decoding

## Gemini Review

The proposed implementation for Phase 14 is high-quality, technically sound, and addresses the critical "null amountOut" issue that currently breaks P&L reporting. The dual-event strategy (Withdrawal for V2, Transfer for V3) is a clever solution to the router implementation differences discovered during research.

### Summary
The plan provides a robust, TDD-backed approach to extracting realized revenue from blockchain receipts. By fixing the Flashbots synthetic hash bug and implementing a chain-agnostic decoder that handles both Uniswap V2 (Withdrawal) and V3 (Transfer) patterns, the bot will finally be able to record accurate `amount_out`, `gas_cost`, and `block` data. The focus on security (address filtering) and reliability (retries) aligns with the project's "never lose money" core value.

### Strengths
- **V2/V3 Compatibility**: The two-strategy approach (`Withdrawal` vs `Transfer`) correctly handles the "Direct to WETH" behavior of the current V3 implementation while maintaining V2 support.
- **Flashbots Critical Fix**: Identifying and fixing the synthetic transaction hash is a prerequisite for this phase to work on Ethereum Mainnet; without this, Phase 14 would fail for all MEV-protected trades.
- **Comprehensive Testing**: The use of mock factories for receipts and logs in Task 1 (RED) ensures that edge cases like spoofing and missing events are handled before wiring.
- **Ethers v6 Accuracy**: Correctly maps `effectiveGasPrice` (v5) to `gasPrice` (v6) and uses `BigInt` consistently.
- **Defensive Coding**: The 2-second retry logic for `getTransactionReceipt` is essential for handling RPC propagation delays.

### Concerns
- **bloXroute Consistency (MEDIUM)**: The plan fixes the Flashbots synthetic hash but does not explicitly verify if the bloXroute MEV strategy (used for BSC) also returns a synthetic string or a valid transaction hash. If bloXroute returns something other than a standard tx hash, BSC sells will still record nulls.
- **Multiple WETH Transfers (LOW)**: In rare multi-hop scenarios or if the bot ever uses fee-rebate contracts, there could be multiple `Transfer` events from WETH to the wallet in a single receipt. The current code returns the *first* one found. While unlikely in the current `exitEngine` scope, it's a potential edge case for complex swaps.
- **Performance Impact (LOW)**: Adding a sequential `await decodeReceipt` (which includes a potential 2s sleep) inside the sell loop increases the time between the swap and the DB record. However, since the trade is already "on-chain" at this point, this is an acceptable trade-off for data integrity.

### Suggestions
- **Verify bloXroute**: Check `src/utils/mevStrategies/bloxroute.ts`. Ensure it returns `Promise<string>` containing a real transaction hash. If it returns a "submission ID" or similar, it needs a fix analogous to the Flashbots one.
- **Summation Strategy**: For the "Strategy 2: WETH Transfer" fallback, consider summing the values of all `Transfer` logs that match the `wethAddress` and `walletAddress` instead of returning the first one. This is safer for complex multi-hop trades or split-route swaps.
- **Logging Enrichment**: In the `log.warn` for "No WETH event found", include whether *any* logs were found. This helps debug if the issue is a wrong WETH address configuration vs. a failed swap logic.
- **Flashbots Side Effects**: Double-check if the synthetic string `flashbots_bundle_block_*` is used anywhere else for tracking bundle status. If it is, ensure the transition to `txHash` doesn't break bundle monitoring UI or logs.

### Risk Assessment: LOW
The risk is low because the changes are additive to the audit trail and do not affect the actual swap logic (the `sendTransaction` call). Even if the decoder fails, the bot defaults to `null` (current behavior), meaning no new regressions are introduced to the trading flow. The Flashbots fix is the highest impact change, but it aligns the strategy with standard Ethers expectations.

**Verdict: Approved.** Proceed with 14-01-PLAN.md.

---

## Codex Review

### 14-01-PLAN.md

#### Summary
This is the right abstraction boundary. Pulling receipt parsing into a utility and covering it with isolated fixtures is the cleanest way to close the `amount_out = null` gap without entangling sell execution logic. The plan also correctly adjusts for the actual V3 sell shape in `src/exitEngine.ts:385`, where `exactInputSingle` sends WETH directly to `recipient: walletAddress` and does not unwrap. The main remaining issue is that the plan overstates coverage: the `Withdrawal -> Transfer(to=wallet)` strategy covers the current one-hop V2/V3 sell paths, but not every conceivable router/fork behavior.

#### Strengths
- Separates decoding from execution, which keeps sell-path changes small.
- Correctly identifies the V3 mismatch with the current transaction builder in `src/exitEngine.ts:385` and `src/exitEngine.ts:392`.
- Filters logs by wrapped-native contract address, which is the key spoofing control.
- Captures `gasCost` and `blockNumber` from the same receipt, which is exactly what DB-03/DB-04 need.
- Test list is mostly strong, especially the spoofing case and retry-on-null-receipt case.

#### Concerns
- **MEDIUM**: The plan says "amountOut is never null", but D-02 and D-05 explicitly preserve `null` for missing events or missing receipts. That is a success-criteria mismatch, not just wording.
- **MEDIUM**: The fallback strategy covers the current code paths, not all sell paths "across all chains and forks." It assumes the chain wrapper implements WETH9-style `Withdrawal` and ERC-20 `Transfer`, and that the sell ends in wrapped native sent to the wallet. That is true for current one-hop V2/V3 exits, but not guaranteed for future router variants or custom wrappers.
- **MEDIUM**: No explicit test for multiple WETH `Transfer` events where one is unrelated dust/refund and another is the real payout. "pick the one where `to=wallet`" is necessary but may still be ambiguous if more than one WETH transfer reaches the wallet in one tx.
- **LOW**: `gasCost = receipt.gasUsed * receipt.gasPrice` assumes `receipt.gasPrice` is present. That is usually correct in ethers v6, but the utility should still be defensive and log if absent.
- **LOW**: The test plan does not include malformed-topic/data logs from the real WETH address. The implementation catches parse failures, but a targeted test would lock that in.

#### Suggestions
- Tighten the success language: "non-null when the receipt contains a recognized wrapped-native payout event; otherwise null with warning."
- Add one test for "two WETH transfers to wallet in same receipt" and document which one wins. If the choice is "first match", state that explicitly.
- Add one test for malformed WETH log payloads from the correct address to confirm parser failures do not throw.
- Add a small note that this is valid for current sell builders only: direct token -> wrapped-native exits on V2 and V3.
- In the utility, guard `receipt.gasPrice` and log if it is null instead of assuming it exists.

#### Risk Assessment
**MEDIUM**. The core design is sound and matches the current sell builders, but the plan claims broader certainty than the decoder can actually guarantee. For a P&L-critical path, that gap should be documented explicitly.

---

### 14-02-PLAN.md

#### Summary
This plan is directionally correct and likely necessary to make ETH mainnet sells decode at all. Wiring `decodeReceipt` immediately after `sendTxWithRetry` in both sell paths closes the DB gap at the right point in the flow, and changing Flashbots to return a real hash fixes an actual integration bug in `src/utils/mevStrategies/flashbots.ts:76`. The main weakness is verification depth: `grep` is not enough for a financial correctness change, and the plan should add execution-path tests for both `executeFullSell` and `executePartialSell`.

#### Strengths
- Correctly targets the only two sell write sites in `src/exitEngine.ts:477` and `src/exitEngine.ts:573`.
- Preserves D-04 by keeping `sendTxWithRetry` and the `MevStrategy` interface unchanged.
- Handles the current `Promise<string | void>` reality from `src/utils/txManager.ts:58` with a falsy guard.
- Flashbots format change appears safe in-repo: I found no other call sites depending on `flashbots_bundle_block_*`.

#### Concerns
- **HIGH**: Verification is too weak. `grep` only proves text presence, not that the receipt data is written correctly or that the sell paths still pass under mocked MEV strategies.
- **MEDIUM**: The plan changes Flashbots return semantics but does not mention updating existing strategy tests in `test/integration/mevStrategies.test.ts`. Current mocks do not include `bundleTransactions[0].hash`.
- **MEDIUM**: The Flashbots fix assumes `bundle.bundleTransactions[0].hash` is always populated after `sendBundle`. If that field is absent in some library/mocked responses, the strategy should fail loudly or fall back cleanly, not return `undefined`.
- **MEDIUM**: There is no explicit integration test for the BSC bloXroute path. I do not see an analogous synthetic-hash bug in `src/utils/mevStrategies/bloxroute.ts:84`, because it returns `data.result` directly, but the plan should still prove receipt decoding is invoked for a bloXroute-returned hash.
- **LOW**: Added sell-path latency is acceptable, but this should be called out as synchronous post-confirmation latency, not execution risk. It affects alert/DB timing more than trade outcome.

#### Suggestions
- Replace the `grep` checks with tests that mock `decodeReceipt` and assert `insertTrade.run` receives non-null `amountOut`, `gasCost`, and `block` in both sell functions.
- Add one Flashbots adapter regression test that asserts `sendTransaction()` returns the real tx hash, not a synthetic string.
- Add one BSC-path integration test proving a bloXroute-returned tx hash is passed into `decodeReceipt`.
- In the Flashbots adapter, guard the real-hash extraction and throw a descriptive error if the library response lacks it.
- Add a note that the legacy overload in `src/utils/txManager.ts:79` still returns `void`; the new sell fix only covers the multi-chain path.

#### Risk Assessment
**MEDIUM**. The implementation scope is tight and the Flashbots change looks locally safe, but the test strategy is not yet strong enough for a money-accounting fix.

---

### Overall (Codex)

#### Summary
The two plans are mostly well-scoped and in the right order: decoder first, then wiring. They should fix the current bug for the actual sell flows implemented today: V2 `swapExactTokensForETH` and V3 `exactInputSingle` with wrapped-native sent to the wallet. The biggest gaps are not in architecture but in claims and verification. The plans should say more precisely what they cover, and they need stronger sell-path tests before this should be treated as audit-grade.

#### Risk Assessment
**MEDIUM** overall. No obvious over-engineering, no major dependency-order problems, and no evidence of another synthetic-hash bug outside Flashbots. The remaining risk is correctness drift: broad success claims, limited execution-path verification, and a few untested assumptions around wrapped-native event shapes and Flashbots response structure.

---

## Consensus Summary

Both reviewers approve the architecture and ordering. The decoder-as-utility approach, the V2 Withdrawal + V3 Transfer fallback strategy, the Flashbots synthetic-hash fix, and the falsy `txHash` guard are all validated. The disagreement is on overall risk: Gemini calls it LOW (the change is additive — failure mode is the existing null), while Codex calls it MEDIUM (financial correctness demands stronger verification than `grep`).

### Agreed Strengths
- **Right abstraction boundary**: Both reviewers endorse extracting `decodeReceipt` as a separate utility instead of inlining into `executeFullSell` / `executePartialSell`. Enables focused unit testing.
- **V2/V3 dual-event strategy is correct**: Both validate the `Withdrawal` → `Transfer(to=wallet)` fallback as the right way to handle the V3 router not unwrapping WETH.
- **Flashbots fix is critical and correctly scoped**: Both agree the synthetic-hash bug must be fixed in this phase, and both agree the implementation-only change preserves the `MevStrategy` interface (D-04 compliant). Codex confirmed no other call sites depend on the `flashbots_bundle_block_*` string.
- **Spoofing control is sound**: Filtering logs by `log.address.toLowerCase() === wethAddress.toLowerCase()` is the right T-14-01 mitigation.
- **Ethers v6 details correct**: `receipt.gasPrice` (not `effectiveGasPrice`), `BigInt` arithmetic, `.toString()` for SQLite TEXT columns.

### Agreed Concerns (highest priority)

1. **bloXroute path is not explicitly verified or tested** (Gemini: MEDIUM, Codex: MEDIUM).
   - Gemini wants the file inspected to confirm it returns a real tx hash.
   - Codex confirmed via inspection that `bloxroute.ts:84` returns `data.result` directly (likely a real hash, not synthetic), but still wants an integration test proving `decodeReceipt` is invoked correctly for the BSC path.
   - **Action**: Add a BSC-path integration test asserting bloXroute-returned hash flows into `decodeReceipt`.

2. **Multiple WETH `Transfer` events to wallet — "first match" ambiguity** (Gemini: LOW, Codex: MEDIUM).
   - Both note that picking the first matching Transfer is potentially ambiguous if a swap produces multiple WETH transfers to the wallet.
   - Gemini suggests *summing* all matching transfers; Codex suggests *adding a test* that documents which one wins.
   - **Action**: At minimum add the test and document the choice. Consider summation if research can confirm summation is correct for current sell builders.

3. **Flashbots response structure assumption** (Gemini: side-effects suggestion, Codex: MEDIUM).
   - Both want the `bundleTransactions[0].hash` extraction to fail loudly if the Flashbots library returns a response missing that field, not silently return `undefined`.
   - Codex also flags that existing strategy tests in `test/integration/mevStrategies.test.ts` likely need updating since their mocks may not include `bundleTransactions[0].hash`.
   - **Action**: Guard the real-hash extraction in the Flashbots adapter; update integration test mocks.

### Codex-only Concerns Worth Addressing

4. **Success-criteria wording mismatch** (Codex: MEDIUM).
   - The roadmap success criteria say "amountOut is never null", but D-02 and D-05 explicitly preserve `null` for missing events / missing receipts. This is a real semantic gap that should be documented.
   - **Action**: Tighten success language to "non-null when the receipt contains a recognized wrapped-native payout event; otherwise null with warning".

5. **`grep`-only verification is insufficient for a financial correctness fix** (Codex: HIGH).
   - The acceptance criteria in 14-02-PLAN.md rely heavily on grep to confirm wiring. This proves text presence, not behavior.
   - **Action**: Add execution-path tests that mock `decodeReceipt` and assert `insertTrade.run` receives non-null `amountOut`, `gasCost`, `block` in both `executeFullSell` and `executePartialSell`.

6. **Defensive `receipt.gasPrice` handling** (Codex: LOW).
   - **Action**: Guard against `receipt.gasPrice == null` in the decoder and log if absent rather than silently producing wrong gasCost.

7. **Malformed WETH log payload test** (Codex: LOW).
   - Implementation already catches parse failures inside try/catch, but lacks an explicit test that locks in this behavior.
   - **Action**: Add a test for malformed log payloads from the correct WETH address.

8. **Legacy `txManager.ts` `void`-return path** (Codex: documentation).
   - **Action**: Add a note that the legacy overload at `src/utils/txManager.ts:79` still returns `void`; this fix only covers the multi-chain path. The falsy `txHash` guard handles this gracefully, but it should be documented.

### Gemini-only Suggestions Worth Addressing

9. **Logging enrichment for "no WETH event found" warning**: Include whether *any* logs were present in the warning. Helps distinguish a misconfigured WETH address from a genuinely empty receipt.

### Divergent Views

| Topic | Gemini | Codex |
|-------|--------|-------|
| Overall risk | LOW (additive, fail-safe to nulls) | MEDIUM (success-criteria drift, weak verification) |
| `grep` verification | Not flagged | HIGH severity — needs execution-path tests |
| Success-criteria wording | Not flagged | MEDIUM — explicit mismatch with D-02/D-05 |
| Multiple Transfer handling | Suggests summation | Suggests test to lock first-match behavior |

The divergence reflects different review postures: Gemini focuses on whether the change is safe to ship (it is — failure mode degrades to current behavior), while Codex focuses on whether the change is provably correct under audit (it is not yet — needs stronger tests). For a P&L-critical path on a financial bot, Codex's posture is the appropriate one.

### Recommended Actions Before Execution

**Update 14-01-PLAN.md:**
- Tighten success-criteria language ("non-null when recognized event present; null with warning otherwise")
- Add test: multiple WETH Transfers to wallet in same receipt — document which wins
- Add test: malformed log payload from correct WETH address
- Guard `receipt.gasPrice` in decoder; log warning if null
- Add scoping note: covers current V2 `swapExactTokensForETH` and V3 `exactInputSingle` to wallet only

**Update 14-02-PLAN.md:**
- Replace grep acceptance criteria with execution-path tests that mock `decodeReceipt` and assert non-null params reach `insertTrade.run` in both sell functions
- Add test: Flashbots adapter `sendTransaction()` returns real tx hash (not synthetic)
- Update existing `test/integration/mevStrategies.test.ts` mocks to include `bundleTransactions[0].hash`
- Guard `bundle.bundleTransactions[0].hash` extraction; throw descriptive error if missing
- Add test: BSC bloXroute path produces a hash that flows into `decodeReceipt`
- Document that legacy `src/utils/txManager.ts:79` `void` path is intentionally unaffected
- Enrich the "no WETH event found" warning with log count
