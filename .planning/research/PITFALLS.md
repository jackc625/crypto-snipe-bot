# Pitfalls Research — v6.17 Defensive Hardening

**Domain:** Adding defensive hardening (honeypot rebuild, anti-rug runtime monitor, exit-engine live-runtime hardening, going-live ops, tech debt cleanup) to a live-mainnet sniper bot
**Researched:** 2026-04-29
**Confidence:** HIGH (verified against codebase analysis, briefing docs, and external sources on eth_simulateV1, V2 LP-event detection, honeypot contract attack surface, and ethers.js WebSocket reconnection)
**Scope note:** This is a SUBSEQUENT-MILESTONE pitfall doc. The full v6.16 pitfall library lives in `milestones/v6.16-research/PITFALLS.md` (BigInt precision, V3 fee-tier blindness, Flashbots version mismatch, double-sell race, multi-chain hardcoded constants, etc.). Those still apply — this doc only covers what is *new* for v6.17.

---

## Owner Non-Negotiables (Reference These Before Every Code Review)

The following are stamped on every gate, every code path, every test in this milestone. Any pitfall below that violates one of these is automatically promoted to "blocker."

1. **No vacuous pass.** A safety check that returns `true` without exercising the underlying behavior is forbidden. The V3 sell-sim pattern (`if (balance === 0n) return true`) is the canonical anti-example.
2. **Fail-closed, never fail-open.** RPC error, timeout, ambiguous result → skip the buy. The V2 sell-sim is broken-but-blocking; that's wrong-for-the-right-reason. Future fixes must preserve the closed-on-failure direction.
3. **Must work for zero-balance wallet.** The bot's *entire purpose* is sniping newly-launched tokens. Any check that requires a pre-existing token balance is structurally unfit.
4. **Don't trust third-party APIs alone.** honeypot.is/GoPlus stay in the parallel bank as defense-in-depth. The new pre-buy gate must be locally-executable and self-contained.

---

## Critical Pitfalls

### Pitfall 1: Vacuous-Pass Regression in the Honeypot Rebuild (V3 Bug Repeating Itself)

**What goes wrong:**
The new honeypot detector (Option C `eth_simulateV1` with state overrides, or Option D on-chain checker contract) gets an edge case during implementation — RPC method not supported, contract call reverted with an unknown error, balance fetch failed, etc. — and an early-return `return true` is added "to avoid blocking on a transient failure." The check now silently passes for the exact tokens it was designed to catch, repeating the V3 bug pattern (`tokenSafety.ts:603-606`).

**Why it happens:**
- The implementer fights flaky RPC behavior during development and adds a "tolerance" path to keep tests green.
- Logging looks reassuring (`'sim passes vacuously'` was a *debug-level* log in V3 — invisible in production).
- Pressure to ship makes "early return on edge case" feel pragmatic.
- The success path and the vacuous-pass path return the same value (`true`), so call sites can't tell them apart.

**How to avoid:**
- **Code-review rule (HARD):** Any `return true` from a safety-check function must be preceded by evidence the actual safety behavior was exercised. Reviewer must point to the line that proves the token's sell hook executed (Option D) or the simulated buy→sell roundtrip completed (Option C). If you can't, it's a bug.
- **Type-system enforcement:** Change the return type from `Promise<boolean>` to a discriminated union: `Promise<{ verdict: 'safe', evidence: SimEvidence } | { verdict: 'unsafe', reason: string } | { verdict: 'unknown', reason: string }>`. The call site at `bot.ts:220-226` must explicitly handle `unknown` as fail-closed (skip the buy). This makes vacuous-pass unrepresentable in the type system.
- **Test pattern:** For each safety function, add a test that constructs an "edge case the implementer might be tempted to fast-path" (RPC error, zero balance, unknown selector, OOG) and asserts the returned verdict is **never** `safe`.
- **Defensive default in helpers:** Initialize `let verdict: Verdict = { verdict: 'unknown', reason: 'unset' }` at function top so a missing assignment fails-closed by construction.
- **Logging contract:** Vacuous outcomes must log at `warn` or `error`, never `debug`. If a code path needs to log at `debug`, it cannot also return `safe`.

**Warning signs:**
- Any branch in a safety function that returns `true` without an `await` to a contract or RPC call upstream of it.
- Tests that mock `balance: 0n` and expect `result === true`.
- Logs containing "vacuous", "skipping", "fast path", "early return" near a safety verdict.
- Coverage reports showing `simulateSellV3ForChain` early-return branch is hit in production but the assertion-bearing path is not.

**Phase to address:**
HONEY/SAFETY (pre-buy safety stack rebuild) — must be designed in from the start of the rebuild. Code review checklist below picks this up at every PR.

---

### Pitfall 2: Storage-Slot Probing Fragility (Option C Only)

**What goes wrong:**
Option C (`eth_call` / `eth_simulateV1` with state overrides to fake a balance + allowance) requires writing to the token's `balanceOf` and `allowance` storage slots. The probing code assumes Solidity-standard mapping layout (`keccak256(abi.encode(holder, slot))` where `slot` is typically 0 or a small integer). This fails silently on:
- **Vyper tokens** — same hash strategy but different layout allocation; slot indices differ.
- **UUPS / ERC-1967 proxies** — implementation slot at `0xb53127684...` and unstructured storage. The `balanceOf` mapping lives in implementation storage, but slot indices depend on inheritance order.
- **Rebasing tokens (Aave aTokens, stETH)** — `balanceOf` is computed dynamically from `_scaledBalances` × index; overriding `_scaledBalances` requires probing two slots.
- **Diamond proxies (EIP-2535)** — storage uses keccak-derived slot bases per facet; `balanceOf` may not even be in slot 0 of the diamond.

When probing fails, you might write to the wrong slot, leaving the simulated `balanceOf(wallet)` returning 0 — and now Option C silently devolves into "vacuous pass with extra steps." Worse: the bot might write to a slot that *does* exist in the token's storage and corrupt simulated state in ways the token reads back, producing nonsensical sim results.

**Why it happens:**
- "Slot 0 is common" is true for ~70-80% of OpenZeppelin-derived ERC-20s but the failure tail is exactly the tokens you most want to flag (custom Vyper tokens are disproportionately scammy; rebasing wrappers add unpredictable dynamics).
- The probing-and-binary-search trick (write a sentinel, read back, repeat) is presented in tutorials as "robust" but assumes the token implements `balanceOf` as a simple `SLOAD` — diamond and rebasing tokens have multi-step computation.

**How to avoid:**
- **Prefer Option D (on-chain checker contract) over Option C as the primary architecture.** The checker contract receives real ETH (transferred via `value`), executes a real `swapExactETHForTokens` → `approve` → `swapExactTokensForETH` round-trip in a single transaction, then reverts at the end to roll back state. This is storage-layout agnostic — the token's own `balanceOf` is correctly updated by its own `_transfer` hook. (See `HONEYPOT-SIM-BRIEFING.md:97-98` — owner already preferred D.)
- **If Option C is selected anyway:** Use `eth_simulateV1` with a *real* buy in step 1 and a real sell in step 2 within the same simulation bundle. State diff propagates between calls automatically — no slot probing needed because the buy genuinely populates `balanceOf(wallet)` via the token's own `_transfer`. This is the **fundamental advantage of `eth_simulateV1` over `eth_call+stateOverride`**: you simulate buy then sell, not fake-balance then sell.
- **If you must probe slots (rare, last resort):** Maintain a hard-coded allowlist of tokens you've manually verified the slot for, and refuse to honeypot-check tokens outside the list. (This defeats the point of the bot — argument for D.)
- **Defensive default:** When slot probing fails or returns ambiguous results, return `{ verdict: 'unknown' }` and fail-closed at the call site, not `safe`.

**Warning signs:**
- Comments in code like `// assumes slot 0`, `// most ERC-20s use this layout`.
- Dependency on a `findBalanceSlot()` helper that has a try/catch.
- Tests that pass against OpenZeppelin tokens but no test asserts behavior on a Vyper or proxy token.
- Sim results that look "too clean" on tokens flagged as honeypots by honeypot.is.

**Phase to address:**
HONEY/SAFETY architecture-decision phase (Option C vs D). The ARCHITECTURE.md/STACK.md research files should explicitly recommend D; if C is chosen, this pitfall must be in the plan-phase mitigation list.

---

### Pitfall 3: `eth_simulateV1` Provider/Tier Coverage Gaps

**What goes wrong:**
`eth_simulateV1` is the post-Cancun upgrade to `eth_call`-with-state-override that supports multi-call bundles with state diffs propagated between calls. It is the *technically correct* way to simulate `buy → sell` without fake-balance probing. But provider support is uneven:
- **Alchemy:** Supports on Ethereum mainnet endpoint, but check tier (some endpoints throttle / require Growth+).
- **Infura/MetaMask:** Documented but tied to network coverage.
- **QuickNode:** Documented for Ethereum, Base, Ink, Plasma — explicitly NOT documented for BSC and Arbitrum (as of search).
- **Public RPCs (BSC public, Arbitrum public, etc.):** Likely no support; method returns `-32601 Method not found`.

If the implementation assumes `eth_simulateV1` works everywhere, BSC/Arbitrum snipes silently break the moment a chain is enabled — the call returns method-not-found, the catch block treats it as "sim failed → fail-closed → skip buy," and the bot stops sniping that chain entirely (a denial-of-service-by-misconfiguration).

**Why it happens:**
- Ethereum mainnet is built first; multi-chain support is added as `ENABLED_CHAINS=eth,bsc,...` and assumed-equivalent.
- The fall-back path from `eth_simulateV1` to plain `eth_call`-state-override may not exist, leaving a sharp cliff.
- Provider docs lag actual coverage — what's "supported" today may not be on the bot's current Alchemy tier.

**How to avoid:**
- **Pre-flight RPC capability check at startup:** For each enabled chain, send a probing `eth_simulateV1` request with a no-op call. Cache the result. If unsupported, fall back to Option D's deployed checker contract on that chain (chain-specific deployment plan).
- **Per-chain capability matrix:** Add to `chainRegistry.ts` a `safetySimStrategy: 'eth_simulateV1' | 'checker_contract' | 'fail_closed'` field. Default to `fail_closed` (skip safety check → skip buy on that chain) for any chain we haven't validated.
- **Loud startup logging:** Log the matrix at `Chain registry built` time. If a chain falls back to `fail_closed`, log a critical warning that the chain is effectively in observe-only mode.
- **Test pattern:** Mock RPC returning `-32601 Method not found` and assert the bot logs a critical warning, falls back to the configured strategy, and does NOT silently snipe.
- **Architecture decision:** Option D doesn't have this problem — a deployed checker contract works on any EVM chain via plain `eth_call`. Lean toward D for multi-chain robustness.

**Warning signs:**
- Hardcoded `provider.send('eth_simulateV1', ...)` calls without try/catch for `-32601`.
- A single capability flag for "honeypot-sim is supported" rather than per-chain.
- The first BSC/Arbitrum boot log shows "Sell simulation failed" for *every* token — likely method-not-found, not actual honeypots.

**Phase to address:**
HONEY/SAFETY phase, in the architecture-decision plan. Even if Option D is chosen, the pre-flight pattern (probe-on-startup, per-chain capability) is the model for any chain-specific RPC dependency.

---

### Pitfall 4: Honeypot-Checker Contract Attack Surface (Option D Specific)

**What goes wrong:**
The owner-deployed checker contract receives test ETH (from the simulating wallet, via `value`), executes a real `swap → transfer → swap-back` against an arbitrary attacker-controlled token, and is supposed to revert at the end (so no state changes commit). The token's `_transfer` hook runs *inside* this contract's execution. Several attack patterns:

1. **Reentrancy via `_transfer` hook:** The malicious token's `transfer` calls back into the checker contract (or into the router) before the checker's state machine has settled, causing the checker to skip the reverse-swap and report success even though the sell direction is blocked.
2. **View-function spoofing (read-only reentrancy):** The token's `transfer` hook updates an external state that the checker reads via a view function *during* the same transaction, reporting a misleading balance/tax that doesn't reflect post-transfer reality.
3. **Gas grinding / OOG:** The token's `_transfer` consumes ~500k gas via a loop tied to attacker-controlled input. The reverse swap runs out of gas, reverts, the checker's outer try/catch interprets "tx reverted" as "honeypot" — but it's actually a *false positive* costing the bot real opportunities. Or worse: the checker has unbounded loops that get OOG'd, causing the *checker* to revert when called via `eth_call`, and the wrapper interprets revert-as-failure incorrectly.
4. **Selfdestruct / SELFDESTRUCT-like behavior in `_transfer`:** Edge case. Cancun made SELFDESTRUCT a no-op on existing contracts, but a token whose `transfer` hook deploys-and-self-destructs in the same tx could leak state in unexpected ways.
5. **`tx.origin` spoofing of safety checks:** A token that gates honeypot-detector behavior on `tx.origin == 0x000...` to behave nicely for `eth_call` (where origin is unset/zero by default) but maliciously for real transactions. The checker's `eth_call` invocation would observe "safe" behavior; the real buy would trigger the malicious branch.

**Why it happens:**
- Implementers think of the checker as "calling the token" but it's really *executing arbitrary attacker code* (the token's hooks). Every assumption about what the token does is an attack vector.
- "It's a `staticCall`/`eth_call`" feels like read-only safety — but the call frame *does* execute mutable code; it just discards state at the end. Read-only reentrancy is real.

**How to avoid:**
- **Use a battle-tested public checker contract if possible** rather than rolling your own. honeypot.is has a public deployed checker; calling it via `eth_call` (their checker is read-only by design) avoids new attack surface. The "can a malicious checker trick `staticCall`?" answer is: it cannot write state, but it could return a misleading value. Mitigation: cross-check with on-chain reality — verify the checker's claimed "amountOut" against `getReserves()` math.
- **If self-deploying:** Apply standard reentrancy guards (`nonReentrant` modifier on the round-trip function), audit for unbounded loops (no loops over arrays of attacker-controlled length), and bound gas explicitly per phase (`{ gas: 200_000 }` on inner calls; if it OOGs, treat as honeypot — that *is* the right answer for tokens that grief gas).
- **Defensive against `tx.origin` spoofing:** Set `from` field in the `eth_call` to the bot's actual signer address (matching what would happen in a real tx), not the zero address or the checker contract.
- **Cross-validate verdict with honeypot.is/GoPlus:** Don't rely on the checker alone. The parallel bank is defense-in-depth. If they disagree, log + default to fail-closed.
- **Static check on token bytecode:** Before invoking the checker, scan the token's bytecode for `tx.origin` opcode (`0x32`) usage. Tokens that read `tx.origin` outside of standard ERC-2612 patterns are suspicious by themselves.
- **Audit the checker contract before mainnet deployment.** Even a 50-line checker has nontrivial attack surface if it interacts with arbitrary tokens. Rate the deployment as "production code" and run static analysis (Slither, Mythril).

**Warning signs:**
- Checker contract has any `external` function that mutates state and is called within the round-trip.
- Inner calls without explicit gas limits.
- No reentrancy guard on the entry function.
- Tests against benign tokens only — no test against a known malicious-pattern token.

**Phase to address:**
HONEY/SAFETY plan-phase if Option D is chosen. The deployment plan must include a security audit step before mainnet deploy, and the checker source must be reviewed against this list before commit.

---

### Pitfall 5: Tax-Detection False Negatives (Delayed/Variable Taxes)

**What goes wrong:**
The current `hasHighTransferTaxForChain` (lines 475-508) computes `taxPercent = 1 - actualOut/expectedOut` from a single simulated swap. The new honeypot rebuild's tax extraction will likely follow the same single-shot pattern. This misses:
- **Delayed-activation taxes:** Token deploys with 0% tax. After N hours / N blocks / once liquidity > threshold, owner calls `setTax(99%)`. Bot's pre-buy sim runs while tax is 0; bot buys; tax flips to 99% before bot can exit; bot is rugged via tax instead of sell-block.
- **Holding-period taxes:** Tax is `0%` for transfers within 1 block of receipt (so the deployer's seed swaps look clean) but jumps to 50% for any transfer >1 block after receipt. The bot's sim does buy-sell in the same call frame; production buy-then-hold-then-sell trips the high tax.
- **Amount-varying taxes:** Tax is 0% for swaps below 0.001 ETH (so scanners look clean) and 90% for swaps above that. Bot's sim uses `snipeAmount` (0.003 ETH) but a smaller tax-extraction probe might miss this.
- **Slot-based taxes:** Tax depends on caller (whitelist-only addresses pay 0; everyone else pays 50%). Bot's check passes if checker contract happens to be whitelisted (extremely rare); fails if signer is. Or vice versa.
- **Mutable-tax-after-deployment:** The tax setter is owner-only and ungated (no timelock, no max). Even if current tax is 0%, the *capability* to set tax at any time is itself a rug vector. Static analysis can flag this; dynamic sim cannot.

**Why it happens:**
- Single-shot simulation is the cheapest path to a "we ran the sell hook" claim and feels sufficient.
- Delayed taxes are explicitly designed to defeat scanners (per the 2026-era honeypot research).
- The bot's economic model (~5min hold, partial-sells) doesn't intersect well with delayed taxes that activate at, say, 1 hour.

**How to avoid:**
- **Multi-amount tax probe:** Run the sell sim at three amounts: 1% of position, 50% of position, 100% of position. If the tax differs by more than a small margin between them, flag as suspicious.
- **Static bytecode analysis as parallel gate:** Scan token bytecode for `setTax`, `setBuyTax`, `setSellTax`, `setMaxWallet`, `excludeFromFees` selectors. Any token with mutable tax setters that aren't behind a 24h+ timelock should be flagged. (This is a static check, not a dynamic sim — fast and cheap.)
- **Owner-renunciation check:** Verify `owner()` returns `0x0000...` or that there's no `Ownable` ABI. Non-renounced ownership + tax setters = rug-capable, regardless of current state.
- **Tax-setter-timelock check:** If the tax setter is governed by a timelock or DAO, log this; it raises confidence but doesn't guarantee safety.
- **Document explicit gap:** Pre-buy honeypot detection cannot catch *future-activated* honeypots (mutable tax flipped after our buy). This is a gap that must be covered by ANTIRUG (anti-rug runtime monitoring) — specifically, monitor the tax-setting events on the token contract post-buy and panic-exit if observed.
- **Position-sizing rule:** For tokens with mutable tax setters, the risk gate should auto-cap position size (or skip the buy entirely depending on threshold).

**Warning signs:**
- Tax detection function takes a single `amountIn` parameter and never varies it.
- No bytecode scan in the safety pipeline.
- Successful sells of tokens at 0% tax during early hold; partial-sells at later hold show >25% slippage attributed to "price impact" but actually tax flipping.

**Phase to address:**
HONEY/SAFETY (multi-amount probe and bytecode static scan added to the parallel bank). Mutable-tax detection is a hand-off boundary to ANTIRUG (runtime monitoring of tax-set events).

---

### Pitfall 6: Sell-Direction-Only Honeypots — What Buy-Sim Doesn't Catch

**What goes wrong:**
The current `simulateSwapForChain` (line 392) does a buy-direction `swapExactETHForTokens.staticCall`. This *does* exercise the token's `_transfer` hook on the way in, so it catches honeypots that block both buys AND sells. But it does NOT catch honeypots that:
- Allow buys cleanly (so deployer's marketing swaps look fine and scanners pass) but block sells via a separate `_beforeTokenTransfer` branch keyed on the destination.
- Allow buys cleanly + first sell (so a single test sell looks fine) but block subsequent sells.
- Allow `swapExactTokensForETH` but block `swapExactTokensForETHSupportingFeeOnTransferTokens` (or vice versa).

The whole point of the FIX-04 rebuild is to cover the sell-direction gap. If the new implementation uses a sell-only sim (not a roundtrip), it inherits the *opposite* gap: catches sell blocks but misses buy blocks already caught by `simulateSwapForChain`.

**Why it happens:**
- Implementer thinks "sell-sim" means "simulate sell only" rather than "simulate the buy-then-sell roundtrip."
- The two existing checks (buy sim + sell sim) feel redundant if both are roundtrips, so the simplest split is "buy sim covers buy direction, sell sim covers sell direction."

**How to avoid:**
- **The new check must be a roundtrip, not a sell.** Architecturally: bot's wallet (via Option D checker contract) does `wrapETH → swapExactETHForTokens → balanceOf check (got nonzero?) → approve → swapExactTokensForETHSupportingFeeOnTransferTokens → balanceOf check (got nonzero ETH back?)`. Asserts both directions and the round-trip math. Reverts at end to roll back.
- **Test multiple sell paths per chain DEX:** `swapExactTokensForETH` and `swapExactTokensForETHSupportingFeeOnTransferTokens` are both common; the bot's actual exit uses one. The sim must use the same one (verify via a test that asserts "sim path matches exit path").
- **Test multiple sells:** The roundtrip should do at least two sells (small + large) inside the bundle. If the second sell fails but first succeeds, that's a delayed-activation honeypot.
- **Naming hygiene:** Rename `simulateSell*` functions to `simulateBuySellRoundtrip*` to make the contract obvious. Stops future maintainers from "optimizing" away the buy half of the roundtrip.

**Warning signs:**
- New `simulateSell*` function does `staticCall` on a sell function only, with no buy in the same simulation.
- No assertion in tests that a buy-only-honeypot (allows buy, blocks sell) is caught.
- The check passes for tokens that the V2 buy sim already passes — gives no marginal information.

**Phase to address:**
HONEY/SAFETY plan-phase. The architectural decision document must state: "the new pre-buy gate is a roundtrip, not a sell-only sim." Reviewers reject any PR that ships a sell-only sim under the new name.

---

### Pitfall 7: Race Condition Between Safety Check and Live Buy Tx

**What goes wrong:**
The pre-buy safety bank runs in real time before submitting the buy. Block-time is 12s on ETH, much faster on BSC/Base/Arb. Between "honeypot sim passes" and "bundle lands in next block," the deployer can:
- Change tax/blacklist via an owner-callable function (1 block latency).
- Add the bot's wallet to a blacklist (front-running the bot's snipe).
- Pause trading (`tradingEnabled = false`).
- Migrate liquidity to a different pool.

Result: sim says "safe at time T," buy lands at time T+1 in modified state, bot is rugged at the buy step or holds an unsellable bag.

**Why it happens:**
- Sniper bots prioritize speed; revalidation between sim and submit feels like a latency cost.
- Test environments don't simulate adversarial state changes between sim and submit (Hardhat fork is static unless you script the change).

**How to avoid:**
- **Bundle simulation + submission atomically (Flashbots).** The Flashbots bundle includes the buy itself; if the bundle's pre-conditions fail at inclusion time, the bundle reverts and the buy doesn't land (no gas wasted). On ETH this is achievable today with the existing Flashbots setup — make the safety check a *conditional revert inside the buy tx itself* via the on-chain checker contract approach (Option D's natural extension): the buy tx first calls the checker, reverts if checker fails, then proceeds with the swap. State changes between sim and execution would be reflected in the checker's call.
- **Re-run a cheap subset of checks at exit-time too.** If a token rugs post-buy (tax flipped, blacklist added), the exit engine's first poll iteration should catch it via the same check. This is the bridge to ANTIRUG — runtime monitoring.
- **Block-age cap on safety verdicts.** A safety check's verdict is only valid for N blocks (1-2 ideally). If the buy tx isn't in the next 1-2 blocks, re-validate. (Implementation: tag verdicts with `validUntilBlock`.)
- **Detect pre-buy state changes via mempool watch.** If the bot is mempool-aware (deferred to next milestone but worth flagging), watch for tax-set/blacklist-set transactions on the token in the same block window as the snipe.

**Warning signs:**
- Safety check returns a stale verdict that is then submitted as a separate transaction.
- No atomic guarantee between sim time and submit time.
- Tests don't cover "deployer modifies token state between checks and execution."

**Phase to address:**
HONEY/SAFETY architecture decision (Option D's checker-in-the-buy-tx pattern eliminates this). If Option C is chosen, this becomes a HONEY/SAFETY plan-phase mitigation: explicit re-validation, block-age cap, etc.

---

### Pitfall 8: Anti-Rug False Positives Causing Cascading Panic-Sells

**What goes wrong:**
The new ANTIRUG runtime monitor watches for liquidity-removal events on open positions and triggers a frontrun-exit. A naive event filter will fire on:
- **Legitimate LP migrations** (V2 → V3 migration is a Burn-LP + add-V3-liquidity sequence; the Burn looks identical to a rug at the event level).
- **Partial LP rebalancing** (deployer removes 30% of LP to add to a different pool; not a rug).
- **Time-locked LP unlock events** at the *expiration* of a lock (legitimate; deployer regaining custody, not yet rugging).
- **Routine LP movements** (LP token transferred to a multisig or staking contract; bot sees Transfer-from-pair as Burn-equivalent).

The bot panic-sells, eats slippage on a still-functional pool, accumulates losses across many positions if multiple are flagged in a high-volatility window, and degrades user trust in the auto-exit decision-making.

**Why it happens:**
- Distinguishing "real rug" from "legitimate movement" requires multiple signals; a single Burn event isn't enough.
- Burn vs Transfer-to-dead-address: locks-via-burn-to-dead is a *good* signal (per search results: "burned LP is permanently irretrievable"). The bot's monitor sees burns post-buy and might mistake long-term locking for a rug if the burn happens after our entry.
- High-volatility days have more LP movements in general; false-positive rate scales nonlinearly.

**How to avoid:**
- **Multi-signal trigger, not single-event:** Panic-sell only when (a) significant LP removal (>50% of pre-event reserves) + (b) destination is the deployer or a freshly-created EOA (not a known multisig, lock contract, or burn address) + (c) reserves drop below `minRequired` threshold for sell. All three must hold.
- **Allowlist of legitimate destinations:** Maintain a list of well-known LP locker contracts (Unicrypt, TeamFinance, PinkLock), staking contracts, and multisigs. LP movements *to* these are not rugs.
- **Burn-to-dead during hold is still a rug if our position is in the pool.** Burning LP tokens locks the underlying liquidity but doesn't remove it — *the pool still works for trading.* The bot can still exit. Don't panic on burn-to-dead alone; check reserves.
- **V2→V3 migration detection:** If a V2 LP burn coincides (within ~5 blocks) with a V3 pool creation for the same token pair, treat as migration. Optionally: switch the bot's exit path to the V3 pool.
- **Confirm-after-N-blocks pattern:** Rather than panic-selling immediately, schedule a confirm-and-sell with 1-2 blocks of latency. If the LP removal is a normal tx (lock, multisig), reserves stay healthy and the panic is cancelled. If it's a real rug, the next block confirms it and the bot still exits ahead of most retail.
- **Position-by-position evaluation:** Don't propagate panic across the portfolio. A rug on token A doesn't imply token B is rugging.
- **Dry-run mode for the first 7 days:** Log "would-have-sold" without executing. Compare against actual outcomes. Tune thresholds before flipping to live.

**Warning signs:**
- Single-event handler (`pair.on('Burn', ...) → triggerExit()`) without context.
- No allowlist of safe destinations.
- Tests only cover "deployer drains LP" — no "legitimate burn-to-dead during hold," "lock contract," "V2→V3 migration."
- Anti-rug exits cluster on high-volume days with no actual rugs.

**Phase to address:**
ANTIRUG plan-phase. Multi-signal logic + allowlist + confirm-after-N-blocks should be in the v1 design, not retrofitted after first false-positive cascade.

---

### Pitfall 9: Anti-Rug Frontrun-Exit Racing the Rug-Pull Tx

**What goes wrong:**
Bot detects an LP removal in the mempool (or in a confirmed block) and sends a panic-sell. But:
- If detection is mempool-based and rug tx is also in the mempool, the rug tx and the bot's sell are in the same block — block-builder ordering decides who wins. The deployer (or their MEV partner) typically pays more priority fee; the bot loses.
- If detection is block-based (after rug tx confirms), the LP is already gone — bot's sell will fail with `INSUFFICIENT_LIQUIDITY` or sell at a near-zero price (worst slippage).
- Even on Flashbots, a private-bundle bot competes against a private-bundle rug pull. Whichever pays the searcher more wins.

**Why it happens:**
- "Frontrun the rug" is presented as a sniper-bot capability, but the deployer always has informational and economic advantages (knew about the rug first, can outbid).
- The bot's panic-sell-detection-to-execution latency includes safety re-check + bundle build + bundle submit; the rug tx is a single `removeLiquidity` call.

**How to avoid:**
- **Set realistic expectations: ANTIRUG is "loss minimization," not "rug prevention."** When a real rug is in flight, the bot's job is to capture *some* exit value, not to win the race. Default position-sizing should already assume rug-loss is possible.
- **Pay aggressive priority fee on panic-sells.** Reserve a per-chain "panic-fee budget" (e.g., 5x normal priority fee). If the bot detects a rug and panic-sells with normal gas, it loses every time.
- **Submit to multiple block-builders in parallel.** On ETH: Flashbots + bloXroute + Eden. One of them builds the next block and includes the bot's tx ahead of competing-fee txs.
- **Detect the pending tx as early as possible.** If the bot is mempool-aware, it can submit the panic-sell before the rug tx confirms. Block-confirmed detection is too late.
- **Exit-engine integration:** ANTIRUG's panic-sell shares code with EXIT-LIVE's sell paths. The fast-path must skip non-essential checks (e.g., it doesn't need to re-run the parallel safety bank).
- **Document expected loss rate.** If realistic frontrun-success is 30-40% (deployer wins ~60-70% of the time), the bot's economics need to assume that. Don't oversell ANTIRUG to the user.
- **Eject + circuit-break.** After 3 consecutive ANTIRUG-triggered exits on the same chain, halt new buys for that chain pending operator review (the rug-rate is anomalously high; might be a downstream signal-source problem rather than a real rug wave).

**Warning signs:**
- ANTIRUG panic-sells use the same gas strategy as normal exits.
- Single block-builder submission.
- "Frontrun rate" not measured / not logged.
- ANTIRUG is implemented as "the same exit engine, but triggered by a different signal" — no fast-path optimization.

**Phase to address:**
ANTIRUG plan-phase. Gas strategy + multi-builder submission + circuit breaker are all design decisions, not afterthoughts.

---

### Pitfall 10: WebSocket Subscription Resource Leaks on Multi-Chain ANTIRUG

**What goes wrong:**
Per-position event listeners (one per `pair.Burn`, one per `pair.Transfer` to detect LP withdrawal) accumulate. With 4 chains × 10 open positions × 2 events per position = 80 active subscriptions. Issues:
- **WebSocket disconnects don't auto-resubscribe** in ethers v6 (per GitHub issue #1053, #4721). Bot's WS dies, comes back, but the per-position `pair.on(...)` filters are not re-registered. The bot is now monitoring nothing but doesn't know it.
- **Subscription limits.** Alchemy's free tier caps at ~10 concurrent subscriptions per WS; throw 80 at it and silent capping kicks in. Some subscriptions never fire.
- **Memory growth from old subscriptions.** When a position closes, are listeners explicitly removed? If not, they accumulate over the bot's lifetime. Each retained `Contract` instance retains a provider reference and a filter.
- **High-volume periods (token launch storms) can briefly trigger reconnect storms.** Bot is in a state-flux loop — no stable subscription set.

**Why it happens:**
- Per-position listeners are the obvious abstraction (each position has its own state).
- ethers v6 doesn't expose a stable reconnect API; workarounds (`provider._websocket.on('close')`) are brittle.
- Subscription limits are documented but not enforced; over-cap silently drops.

**How to avoid:**
- **Single-listener-per-chain pattern, not per-position.** Subscribe once per chain to `Burn` events on the *factory* (or all pairs you care about) and dispatch internally to the matching position. One WS subscription per chain, not one per position. Memory cost is constant, not linear-in-positions.
- **Explicit teardown on position close.** If per-position listeners are retained, every `closePosition()` must call `removeAllListeners()` on the contract reference and null out the reference.
- **Heartbeat + reconnect-with-resubscribe.** Implement keep-alive ping (30s interval), detect WS close via `provider._websocket.on('close')`, reconnect, *and re-register all active filters*. The re-registration pattern is critical — reconnection alone does not restore subscriptions.
- **Backfill on reconnect.** Per the QuickNode guide and ethers docs: on reconnect, query `getLogs` for the gap window (lastSeenBlock → currentBlock) before resuming streaming. Otherwise events during the disconnect are silently lost.
- **Subscription budget enforced.** Document the per-chain subscription count in `chainRegistry.ts`; warn if exceeded.
- **Test pattern:** Force-kill the WS connection mid-test, verify the bot reconnects within N seconds AND re-registers AND backfills missed events.

**Warning signs:**
- `pair.on('Burn', ...)` called per position in a loop.
- No `removeListener` calls anywhere.
- No keep-alive / ping logic.
- WS-disconnect causes silent loss of monitoring (no warning, no metrics drop visible in dashboard).
- Position count grows beyond ~20 on a chain and ANTIRUG misses real events.

**Phase to address:**
ANTIRUG plan-phase. Single-listener-per-chain is an architecture decision (the "factory of positions" pattern), not a fix to per-position-listeners.

---

### Pitfall 11: Mainnet Fork Tests Pass But Real Mainnet Behaves Differently (EXIT-LIVE Trap)

**What goes wrong:**
The 6 deferred human-verification items from v6.16 are framed as "live verification deferred" because mainnet-fork tests pass but live behavior was never confirmed. The trap: writing more fork tests to "close the gap" still doesn't exercise the live path. Real mainnet differs from Hardhat fork in:
- **Mempool dynamics.** Forks have no mempool. The bot's tx goes from `sendTransaction` → mined-in-next-fork-block in ~ms. Real mainnet: the tx sits in a public or private mempool; MEV searchers can frontrun, sandwich, or exclude it.
- **Gas estimation.** Per the GitHub issue: a fork-estimated 1.5M gas tx cost 3.3M on real mainnet. Hardhat skips estimation by default.
- **MEV competition.** No competing snipers/MEV bots on a fork. On real mainnet the bot is the slowest player.
- **State-of-the-world drift.** Forks pin to a block; positions reflect that block's reality. Real mainnet evolves; the bot's `.bot-state.json` migration must handle real evolving SQLite + JSON state, not pinned-to-block-N state.
- **Real RPC errors.** Alchemy 429-rate-limit, transient WebSocket disconnect, provider-side EVM-version mismatch — none of these happen on a local fork.

**Why it happens:**
- Forks are easier and faster than mainnet. Cost asymmetry.
- "Test on Sepolia" is suggested — but Sepolia has different liquidity, no real MEV, different validator economics. Fails to substitute for mainnet.
- "Deferred to live verification" is a punted action item. Punted indefinitely if not aggressively scheduled.

**How to avoid:**
- **Resolve via real micro-transactions on mainnet, not via more fork tests.** Each of the 6 verification items needs a real-mainnet exercise: actual flash bot bundle on mainnet (smallest possible, expected to revert harmlessly), actual SQLite migration on real prod data, actual WS push observed in browser, etc. Cost: $5-50 in gas. Worth it.
- **Capture verification artifacts.** Etherscan tx hash + screenshot of dashboard + bot log excerpt for each item. Stored in `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md`. Without an artifact, the item is not closed.
- **Use Tenderly / Alchemy debug-trace on the real tx** for full visibility into what happened on-chain — bridges the "fork test passed but I want to see exactly what real mainnet did" gap.
- **Distinguish fork-test (CI-green pre-merge) from live-verify (manual, post-deploy).** Don't conflate them. CI cannot exercise the 6 deferred items by definition — that's why they were deferred.
- **For high-cost verifications:** Consider a paired-bot setup where one bot is a "dummy target" you can rug yourself, on testnet, at higher fidelity than Sepolia (e.g., Holesky with deployed fake-victim contracts).

**Warning signs:**
- A v6.17 PR claims to "verify EXIT-LIVE-N" but the test it adds is in `mainnet-fork.test.ts`.
- Verification evidence is "test passing," not "tx hash on Etherscan."
- The 6 items are still deferred at end of milestone.

**Phase to address:**
EXIT-LIVE category — this is the central pitfall of the entire EXIT-LIVE category. Plan-phase must explicitly require a real-mainnet artifact for each of the 6 deferred items.

---

### Pitfall 12: Real-Mainnet Test Accidentally Sends a Real Tx (Fork-Confusion Footgun)

**What goes wrong:**
Test files mix fork-mainnet and live-mainnet contexts. A test file imports `process.env.ETH_RPC_URL` for "mainnet fork" but the URL is actually pointing at real mainnet (because the test runner inherited the prod `.env`, or the dev forgot to override `HARDHAT_FORK_URL`). The test runs `wallet.sendTransaction(...)` and that tx lands on real mainnet. Real ETH spent, real position opened, real liability.

The reverse footgun: a real-mainnet verification test designed to send 0.0001 ETH is run against a Sepolia RPC by mistake — no real verification happened, the item is incorrectly closed.

**Why it happens:**
- `.env` is shared across test contexts.
- Hardhat's "fork at URL" is configured separately from ethers' `JsonRpcProvider(URL)`. Test code that constructs its own provider can bypass the fork.
- The `npx hardhat test --network localhost` flag is easy to forget; the default is whatever's in `hardhat.config.ts`.

**How to avoid:**
- **Hard-coded test-only RPC for fork tests.** Test setup: `if (provider.network.chainId === 1n && !process.env.ALLOW_REAL_MAINNET) throw new Error('Real mainnet detected; refusing to send tx in test')`. Same for all chain IDs.
- **Real-tx tests gated by env var.** A real-mainnet verification test must set `ALLOW_REAL_MAINNET=1` explicitly. CI never sets this. Manual runner sets it intentionally + reviews the test cost first.
- **Test naming convention:** `*.fork.test.ts` for fork-only tests; `*.real-mainnet.test.ts` for real-tx tests, with a README header listing expected gas cost.
- **Pre-flight balance check in real-tx tests:** Before sending, log the wallet's balance and the tx's expected cost; abort if balance is too low or test cost exceeds threshold.
- **Use a separate dedicated wallet for real-tx tests.** Not the prod wallet. Funded with the minimum amount the test needs; nothing more.
- **Capture artifacts on success AND failure.** A failed real-tx test that left state on-chain (partial position, stuck nonce) is a real problem; the test must clean up.

**Warning signs:**
- A test sends a real tx from the prod wallet.
- A failed test leaves a position open in prod.
- Test files don't distinguish fork-context from real-context.

**Phase to address:**
EXIT-LIVE plan-phase. The verification harness for the 6 deferred items must include this guard as part of the test infrastructure, before any of the verifications are attempted.

---

### Pitfall 13: Telemetry Masking the Underlying Issue (False-Confidence Hardening)

**What goes wrong:**
EXIT-LIVE adds observability — Prometheus metrics, structured logs, Telegram heartbeats — to "verify the exit engine works." But:
- Metrics report success because the exit-engine's `try { sell() } catch { metric.inc('exit_failures') }` increments the failure metric on revert, so Prometheus shows `exit_success_rate: 100%`. *But* the metric is computed only from sells that the engine *attempted*; the actual problem is the engine never attempts to sell because the upstream poll loop is broken and never schedules an exit.
- Logs say "exit triggered for token X" but the tx never lands on-chain (gas too low, mempool drop, MEV exclusion). The log line is from `try` block before submission; success means "we built the tx," not "tx confirmed."
- Heartbeat says "bot alive, 5 positions monitored" — but 5 is stale; the actual count is 8, and the heartbeat reads from a counter that's not updated.

The hardening pass *adds telemetry* and *all telemetry shows green* but the underlying system is silently broken.

**Why it happens:**
- Easy to instrument the success path.
- Hard to instrument "the success path was supposed to happen but didn't."
- Confirmation bias: we wrote the telemetry; we want it to say green; we measure what shows green.

**How to avoid:**
- **Prefer end-to-end-from-the-outside metrics over instrumented metrics.** Example: "exit happened" should be measured by *receipt-decoded sell amount > 0 in DB, populated within 60s of trigger,* not by "exit code path executed." The DB row is the ground truth.
- **Heartbeats with proof.** Heartbeat includes a hash of the latest position-table row. If `bot.ts` is querying stale state, heartbeat shows a stale hash — the operator can detect drift visually.
- **Adversarial log review.** Reviewer asks: "if this code path silently dropped, what would the logs look like?" If the answer is "the same as success," the logging is insufficient.
- **Synthetic monitor.** A separate watchdog process (or a scheduled task) periodically opens a tiny dummy position and verifies the exit fires. If it doesn't, alert. (Tradeoff: costs gas; do it once a day, not per minute.)
- **Real verification > more telemetry.** If you're tempted to add "more metrics to verify EXIT-LIVE-N," step back and ask: would a real-mainnet exercise (Pitfall 11) prove this faster?

**Warning signs:**
- New PRs in EXIT-LIVE category add metrics/logs but no real-mainnet test.
- Metrics show 100% success rate but the deferred-verification list isn't shrinking.
- Operator notices something's wrong before the dashboard does.

**Phase to address:**
EXIT-LIVE plan-phase. Telemetry is fine; telemetry-as-substitute-for-verification is the bug.

---

### Pitfall 14: Wallet Balance Pre-Flight That Fails Open

**What goes wrong:**
OPS-LIVE adds a wallet-balance pre-flight at startup (currently the bot doesn't check; per `GOING-LIVE.md:251` "if unfunded, it starts cleanly and just fails every snipe"). The naive implementation:

```ts
try {
    const balance = await provider.getBalance(wallet.address);
    if (balance < threshold) throw new Error('Insufficient balance');
} catch (e) {
    log.warn('Balance check failed, continuing'); // ← fail-open
}
```

The RPC times out → bot starts in unfunded state → silently fails every snipe → operator notices nothing for hours.

**Why it happens:**
- "Fail-open on infra error" is a familiar pattern from web services (don't block users on a transient backend issue).
- Crypto context inverts this: failing-open means money lost (ops-fail), failing-closed means downtime (ops-pause). The latter is recoverable; the former is not.

**How to avoid:**
- **Fail-closed on pre-flight RPC failure.** If the balance check fails, refuse to start and exit non-zero. Operator restarts after fixing RPC. Pattern matches the chain-ID mismatch behavior already in `bot.ts`.
- **Retry with bounded timeout, then fail.** 3 retries × 5s = 15s pre-flight budget; longer than that means RPC is broken. Don't retry forever.
- **Per-chain balance threshold.** `threshold` should come from `chainRegistry.ts` (e.g., `min_startup_balance: snipeAmount × 5 × maxPositions`). Hardcoded `0.01 ETH` is wrong for chains with lower fees and right wrong direction for chains with higher fees.
- **Periodic re-check + halt.** Pre-flight at startup is only the first check. A periodic check (every N minutes) that halts new buys if balance drops below threshold catches the "ran out of gas during operation" case.
- **Loud Telegram alert on halt.** Not log-only; the operator must see this immediately.

**Warning signs:**
- Pre-flight has a try/catch that logs and continues.
- No threshold per chain; one global value.
- No periodic re-check.
- Bot enters a state where it wastes RPC requests checking pairs but every snipe fails — no automatic detection of this state.

**Phase to address:**
OPS-LIVE plan-phase.

---

### Pitfall 15: Env-Validation That Lets Partial Configs Through

**What goes wrong:**
OPS-LIVE upgrades env-validation messaging, but a partial config slips through:
- `MEV_STRATEGY=flashbots` set, but `FLASHBOTS_AUTH_KEY` missing (or wrong format).
- `ENABLED_CHAINS=eth,bsc` set, but no `BLOXROUTE_AUTH_HEADER` for BSC.
- `TELEGRAM_*` set, but `TELEGRAM_ALLOWED_SENDERS` empty (matching `GOING-LIVE.md:118-122` — "any contract address in any chat... gets routed into the snipe pipeline").

Bot starts, looks healthy, but is silently misconfigured: every BSC snipe goes to public mempool (sandwiched), or every Telegram-sourced address gets sniped.

**Why it happens:**
- Env validation is per-variable, not cross-variable. `FLASHBOTS_AUTH_KEY` is fine if MEV is bloXroute, but a fatal error if MEV is Flashbots.
- "Optional" variables are silent-defaults; the operator doesn't know they were defaulted.

**How to avoid:**
- **Cross-variable validation rules.** Define a set of "if A then B required" rules and validate at startup. Crash with explicit error: `MEV_STRATEGY=flashbots requires FLASHBOTS_AUTH_KEY (currently unset)`.
- **Loud-defaults.** Print the resolved config at startup, including defaulted values. `TELEGRAM_ALLOWED_SENDERS=<empty> (DANGER: any sender accepted)` makes the implication visible.
- **Refuse to run for known-dangerous combos.** Empty `TELEGRAM_ALLOWED_SENDERS` should be a hard-fail unless `I_UNDERSTAND_TELEGRAM_IS_OPEN=1` is set explicitly.
- **Config tier:** Separate "required for any operation" from "required for chain X" — better error messages keyed to the user's enabled chains.
- **Validate at startup, not at first use.** Currently the bot's chain-ID check at startup is a good pattern; extend to all required-for-operation env vars.

**Warning signs:**
- Env validation is `if (!process.env.X) throw new Error('X required')` per variable, no cross-var rules.
- Resolved-config log doesn't print defaults.
- A chain-specific env var is "checked when first used" rather than "checked at startup."

**Phase to address:**
OPS-LIVE plan-phase. Cross-variable rules + loud-defaults are the v1 design.

---

### Pitfall 16: Stale-Data Warnings That Cause Warning Fatigue

**What goes wrong:**
OPS-LIVE adds stale-data warnings (RPC slow, block time drift, gas-price stale, etc.). Threshold tuning is hard:
- Too sensitive → alerts every few minutes during normal volatility → operator mutes / ignores.
- Too lax → warning fires only after the bot has lost money for 30 minutes.

The result: warnings exist, but operator has trained themselves to ignore them. Real alerts go unnoticed.

**Why it happens:**
- Threshold-setting is a calibration problem with no obvious right answer.
- Warning fatigue is a known UX problem and doesn't get prioritized in defensive-hardening work.

**How to avoid:**
- **Tiered severity.** Three levels: `info` (logged, no alert), `warn` (logged + dashboard banner), `critical` (Telegram + halt new buys). Stale-data goes through `info`/`warn` mostly; only sustained issues escalate.
- **Suppress duplicates within window.** Don't alert on the same condition more than once per N minutes.
- **Auto-clear when condition resolves.** Telegram alert + clearing alert when condition normalizes. Operator sees the full lifecycle.
- **Dashboard primary, Telegram secondary.** The dashboard is the primary monitor; Telegram is for "operator is away from the desk." Dashboard should always show staleness inline (greyed-out timestamps, etc.) — the warning is the *visible state*, not a separate alert.
- **Telemetry baseline measurement.** Before deploying warnings, capture 7 days of normal-operation data and tune thresholds to fire at 95th percentile, not 50th.

**Warning signs:**
- Operator has muted the bot's Telegram chat.
- Warnings fire >10x per day on average.
- "Warnings are noisy, ignore them" becomes folklore.

**Phase to address:**
OPS-LIVE plan-phase. Tiered severity + dedup is the v1 design. Threshold tuning is a v2 follow-up after a baseline measurement.

---

### Pitfall 17: Runbook Drift After Moving GOING-LIVE.md

**What goes wrong:**
OPS-LIVE moves `GOING-LIVE.md` to versioned docs (e.g., `docs/operations/going-live.md`). The original at repo root persists (forgotten to delete) or is silently recreated by a future doc-fix sweep. The two diverge over time. Operator follows root version, hits an issue addressed only in `docs/`. Or vice versa.

**Why it happens:**
- File-move PRs that forget to delete the original.
- "Doc fix" PRs that recreate the root file out of habit.
- No CI check that `GOING-LIVE.md` doesn't exist at root once it's moved.

**How to avoid:**
- **Delete the root file in the same PR that creates the new one.** Not a follow-up — same PR, atomic change.
- **CI check (or pre-commit hook) that rejects re-creation of `GOING-LIVE.md` at repo root.** `git diff --name-only HEAD~1 HEAD | grep '^GOING-LIVE.md$'` → fail.
- **Linked-from-README.md.** The README's setup section points to the new path. Stale links anywhere else (docs cross-references) are caught by a docs-link CI check.
- **Versioned docs are diff-able.** `docs/operations/going-live.md` is in `git`; changes are reviewed. Drift is visible.
- **Note the target path in this PITFALLS doc once decided.** When OPS-LIVE picks `docs/operations/going-live.md`, this doc's reference should be updated.

**Warning signs:**
- Root-level `GOING-LIVE.md` exists alongside `docs/operations/going-live.md`.
- Two docs disagree on a setup step.
- Operator complaints about "I followed the docs and X."

**Phase to address:**
OPS-LIVE plan-phase. Atomic move + CI check.

---

### Pitfall 18: Kill Switch That Doesn't Actually Kill (In-Flight Buy Lands After Pause)

**What goes wrong:**
The dashboard's pause-snipes endpoint (`POST /api/controls/pause-snipes`) sets a flag that gates new pair-detection processing. But:
- A buy tx already submitted to the mempool when pause is called still lands.
- A bundle in-flight to Flashbots / bloXroute still confirms.
- `Ctrl+C` "graceful shutdown within 5s" (per `GOING-LIVE.md:230`) — what happens to a snipe in the middle of safety checks at second 4? The bot's `await bundle.send()` is mid-flight; can it be aborted?

The operator presses pause expecting "no new positions"; a position opens 30 seconds later. Real money committed against operator intent.

**Why it happens:**
- Pause is implemented as a flag check at the top of `handleNewPairForChain`, but in-flight executions don't re-check the flag.
- Graceful-shutdown semantics aren't fully defined; "5s" is a soft target.

**How to avoid:**
- **Kill-switch checks at multiple stages, not just entry.** Re-check the kill flag after each stage (post-safety-bank, post-bundle-build, post-MEV-submit) — abort and log if flipped.
- **Hard-shutdown alongside graceful.** `SIGINT` = graceful (5s budget); `SIGTERM` after 5s timeout = hard (kill in-flight). Operator can `Ctrl+C` then `Ctrl+C` again for hard-kill.
- **Pause vs cancel distinction.** Document: pause prevents *new* snipes from starting; in-flight snipes complete. If the operator wants to cancel in-flight, they need a different action (probably impossible after bundle-submit).
- **Dashboard banner during graceful shutdown.** "Bot is shutting down. N in-flight snipes will complete; new snipes are paused."
- **Test pattern:** Submit a snipe at high latency (mocked safety bank with delay), pause mid-stream, assert the snipe aborts before bundle-build.

**Warning signs:**
- Pause-flag is checked once per pair-event, not per stage.
- No documented behavior for "what happens during shutdown to in-flight buys."
- Position opens after operator pressed pause.

**Phase to address:**
OPS-LIVE plan-phase. Multi-stage flag checks + documented shutdown semantics are core hardening.

---

### Pitfall 19: Tech-Debt Cleanup — Retroactive Validation That Rubber-Stamps

**What goes wrong:**
The 9 phases needing retroactive Nyquist validation (per PROJECT.md:114) are validated by running `/gsd-validate-phase {N}` against existing code. The validator looks at the tests-and-passing state, sees green, marks validated. But the validator doesn't *re-derive* the requirements from first principles — it *confirms* the existing claim. If the original claim was wrong (e.g., FIX-04 in v6.16 was marked complete but actually broken — see HONEYPOT-SIM-BRIEFING.md:63), retroactive validation rubber-stamps the bug into "validated" state.

**Why it happens:**
- "Validation" sounds like confirmation; "verification" is the more rigorous term but isn't always distinguished.
- Tests-passing is necessary but not sufficient evidence.
- Time pressure: 9 phases is a lot; the easy path is "tests green = validated."

**How to avoid:**
- **Validation must include a "what does this catch in production?" question per requirement.** Not "does the code do what we said?" but "does this prevent the harm we said it would prevent?"
- **For each phase, audit one production-relevant assertion.** Phase 1 (FIX-04): does the sell-sim catch a real honeypot? Phase 5 (V3-04): does it actually use SwapRouter02 for a V3 swap end-to-end? If you can't answer with a real example, it's not validated.
- **Log validations that are "tests pass + checked one real example" vs "tests pass only."** Different confidence levels.
- **For requirements where the original implementation is suspected broken (FIX-04, V3-03), do not retroactive-validate at all.** Re-open the requirement, address it as part of v6.17, and validate at fresh-implementation time.

**Warning signs:**
- A `/gsd-validate-phase` run takes <1 minute.
- The validator's output is "all tests pass, marked validated."
- Subsequent bug discovered in the validated phase.

**Phase to address:**
DEBT category. Validation criteria need to be tightened before the 9 phases are validated.

---

### Pitfall 20: Tech-Debt Cleanup — `.todo` Test Stubs Filled With Hollow Assertions

**What goes wrong:**
37 `.todo` exit engine test stubs (per PROJECT.md:115) need to become real tests. Hollow patterns to avoid:
- `expect(true).toBe(true)` "to make the test green and tick the box."
- `expect(actual).toBeDefined()` — passes if anything is returned, including a wrong value.
- Asserting a function was called without asserting *what* it was called with or *what* the side effect was.
- A test that mocks the function under test, then asserts the mock was invoked. (The function's behavior was never tested.)

**Why it happens:**
- 37 is a lot. Implementer burns out and starts shortcutting.
- The original `.todo` only had a one-line description; the implementer fills in something to remove the `.todo` mark, not to actually test the behavior.

**How to avoid:**
- **Each filled test must assert at least one observable effect.** Database row count change, HTTP response shape, mock call argument, log line emitted, etc. Not "no exception thrown."
- **Code review checks every filled test for the assertion-bearing line.** If the only `expect()` is `toBeDefined`/`toBe(true)`, the test is rejected.
- **Pair filling with running coverage.** Newly-filled test should bump branch coverage in the function it claims to cover. If coverage doesn't move, the test isn't testing.
- **Explicit `.skip` for items that should not be tested at this layer.** A `.todo` doesn't need to become a `.test`; it can become a `.skip` with reason ("integration-tested elsewhere") if the unit-test value is low. Don't fake unit tests for the stat.

**Warning signs:**
- Newly-filled tests with single `expect(true).toBe(true)`.
- Coverage doesn't move after 37 tests are filled.
- Tests are fast (low per-test budget) but mock everything.

**Phase to address:**
DEBT category. PR review template includes "no hollow assertions" check.

---

### Pitfall 21: Tech-Debt Cleanup — `as any` Suppression Instead of Type Fixes

**What goes wrong:**
6 TS annotation errors in dashboard API routes (per PROJECT.md:116) — runtime is correct but types are wrong. Easy "fix": cast with `as any` or `as unknown as Foo`. This silences the TS error but:
- Removes future type-safety on those code paths.
- Hides real bugs (the type was wrong because the runtime was actually wrong but happened to work).
- Tech-debt-of-tech-debt: someone refactors later and the `as any` silently absorbs a real type mismatch.

**Why it happens:**
- "Runtime correct" is the goal; types are seen as decorative.
- `as any` is one keystroke; type-fixing is 10 minutes per call site.
- The original author may not be available to explain the intended type.

**How to avoid:**
- **Ban `as any` in PR review.** Even `as unknown as Foo` should require a comment explaining why the runtime is actually `Foo` despite TS not seeing it.
- **Fix the type, not the symptom.** If `req.body.x` is typed as `unknown` but is actually `number`, add a Zod (or io-ts) validator at the route boundary; downstream code gets a typed `number` for free.
- **Strict-mode bump.** Once errors are resolved, raise the TS strict level (e.g., enable `noImplicitAny`) so re-introduction is caught at compile time.

**Warning signs:**
- Diff shows `as any` casts.
- The PR fixes type errors without changing runtime behavior or tests.
- Subsequent refactor breaks because the `as any` was hiding a real mismatch.

**Phase to address:**
DEBT category.

---

### Pitfall 22: Tech-Debt Cleanup — Dead-Code Removal Breaks Undocumented Dependency

**What goes wrong:**
Dead-code/diagnostic-log cleanup (per PROJECT.md:117). Examples: `getTradesByToken` unused local const in `db.ts:215`, `console.log` lines in `telegramListener.ts:55,61`. The "fix" is to delete. But:
- `getTradesByToken` may be called via dynamic dispatch from a script outside `src/` (operations dashboard, ad-hoc query tool, future feature).
- `console.log` in `telegramListener.ts` may be the only signal an operator has during early-debug; deleting it leaves a silent void.
- A function appearing unused locally may be re-exported and consumed by an external test or by a runtime-loaded plugin.

**Why it happens:**
- IDE "find references" only catches static references in the same TS project.
- Dynamic dispatch (`obj[methodName]()`) is invisible to static analysis.
- The cleaner doesn't ask "who else might be calling this?"

**How to avoid:**
- **Search the *whole repo* (not just `src/`) for the symbol before deletion.** `git grep getTradesByToken` — if it appears in scripts/, .planning/, docs/, or test fixtures, investigate.
- **Mark deprecated, don't delete immediately.** Add `@deprecated` JSDoc comment for one milestone, observe whether anyone complains, then delete next milestone.
- **Diagnostic logs: convert to structured `log.debug`, don't delete.** `console.log('Telegram session ready')` becomes `log.debug({ component: 'telegram' }, 'Session ready')` — preserves the operator-debug value with proper structured format.
- **Test-only references are real.** A function used only in tests is still used.
- **Document the intent.** "This function is dead, remove" — but if a script imports it, the script is the consumer.

**Warning signs:**
- Deletion PR has no search evidence in commit message.
- Operator complains "the bot used to log X, now it doesn't."
- A subsequent PR re-adds a deleted function with a different signature (because the original consumer's needs were forgotten).

**Phase to address:**
DEBT category.

---

## Owner Non-Negotiables — Cross-Reference

| Non-Negotiable | Pitfalls That Reference It |
|----------------|----------------------------|
| No vacuous pass | 1, 5 (delayed-tax false negatives), 6 (sell-only sim missing buy half) |
| Fail-closed never fail-open | 1, 3 (eth_simulateV1 method-not-found), 14 (wallet balance pre-flight) |
| Must work for zero-balance wallet | 1 (entire architecture must accommodate), 5, 6 |
| Don't trust third-party APIs alone | 4 (cross-validate verdict), 8 (anti-rug needs multi-signal not single API) |

---

## Technical Debt Patterns

Shortcuts specific to v6.17. Some are acceptable; some are not.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Option C (eth_simulateV1 + state overrides) instead of Option D (deployed checker contract) | No mainnet deployment; faster to implement | Storage-slot fragility; provider-tier-locked; multi-chain coverage gaps | Only if Option D is provably blocked (e.g., a chain doesn't support callable contracts at all — none of ETH/BSC/Base/Arb fit) |
| Calling honeypot.is checker contract instead of self-deploying | No own contract to maintain or audit | Trust honeypot.is to keep it deployed and not change behavior; rate-limited externally; multi-chain coverage uneven | Acceptable as primary if cross-validated with at least one other source (parallel bank stays) |
| Single-event ANTIRUG trigger (only Burn) | Simple v1 implementation | High false-positive rate on legit migrations and locks; cascading panic-sells | Only with a confirm-after-N-blocks delay, never as single-shot |
| Per-position WS subscription (vs single-listener-per-chain) | Simple per-position lifecycle | Resource leak on long-running bot; subscription cap hits silently | Acceptable up to ~10 positions; refactor before scaling |
| Adding telemetry to "verify" deferred items | Visible green metrics | Telemetry can show green while system is broken (Pitfall 13) | Acceptable as supplement to real-mainnet verification; never as substitute |
| `as any` to silence TS errors during DEBT | Quick numeric reduction | Hides bugs; tech-debt-of-tech-debt | Never |
| Hollow `.todo` test fills | Stat improvement | Coverage report lies | Never |
| Retroactive validation of phases marked complete in v6.16 | 9-phase backlog cleared | Rubber-stamps original bugs into "validated" state | Acceptable only if validation includes one production-relevant assertion per phase |

---

## Integration Gotchas (v6.17 New)

Common mistakes when connecting to the new defensive-hardening services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `eth_simulateV1` | Assuming all chains/tiers support; no fallback | Pre-flight capability probe per chain; per-chain strategy in chainRegistry |
| Honeypot.is checker contract | Calling without sanity-check on returned values | Cross-check with `getReserves()`/`getAmountsOut`; verify checker hasn't been migrated to a new address |
| Self-deployed checker contract | No reentrancy guard, unbounded loops | Audit with Slither; use `nonReentrant`; explicit gas limits on inner calls |
| `pair.on('Burn')` event listener | Subscribing per-position; not handling WS reconnect | Single chain-level listener; explicit reconnect+resubscribe+backfill |
| Flashbots panic-sell during ANTIRUG | Same gas as normal sells; loses the race | Reserved priority-fee budget; multi-builder submission |
| Real-mainnet test runner | Inheriting prod `.env` | Hard guard against chainId 1 in test mode; explicit `ALLOW_REAL_MAINNET=1` |
| Dashboard pause-snipes | Single flag check at entry only | Multi-stage flag re-check; documented graceful-shutdown semantics |
| Wallet balance pre-flight | RPC error fails open | Fail-closed; bounded retry; periodic re-check |

---

## Performance Traps (v6.17 New)

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-position WS subscriptions | Memory growth, silently dropped events | Single chain-level listener with internal dispatch | > 20 positions or ~24h uptime |
| Sub-block re-validation in safety bank | Latency added before snipe; lost races | Block-age-tagged verdicts; only re-validate if stale | Always (latency tax on every snipe) |
| Multi-amount tax probing on every snipe | 3x RPC calls per snipe | Cache verdict for the token's first 5 minutes; only probe new tokens | High-volume detection windows (>5 pairs/min) |
| ANTIRUG panic-sell paying normal gas | Loses race to deployer rug | Reserved panic-fee budget per chain | Every real rug |
| Synthetic-monitor dummy positions | Gas cost from periodic test snipes | Daily, not minutely; smallest-possible position | Never if scaled correctly |

---

## Security Mistakes (v6.17 Specific)

| Mistake | Risk | Prevention |
|---------|------|------------|
| Honeypot checker contract has external mutating function | Reentrancy / state corruption during call | `nonReentrant` modifier; `external view` only on entrypoints called via `eth_call` |
| Trusting `eth_call` `from` field as zero address | `tx.origin`-keyed honeypots evade detection | Set `from` to bot's signer address in the eth_call options |
| Self-deployed checker not audited before mainnet deploy | Vulnerable to attacker tokens; checker drained or griefed | Static analysis (Slither/Mythril) + manual review pre-deploy |
| Pause flag is in-memory only | Restart loses pause state; bot resumes sniping unintentionally | Persist pause state to SQLite; reload on startup |
| Real-mainnet test sends from prod wallet | Operational tx contamination; nonce conflicts | Dedicated test wallet, minimum-funded |
| Storage-slot probing writes to wrong slot | Simulated state corruption; false sim verdict | Prefer Option D entirely; if C, test on diverse token layouts |
| ANTIRUG triggered on legit migration | Panic-sell at bad price; cascading portfolio loss | Multi-signal trigger + allowlist + confirm-after-blocks |

---

## UX Pitfalls (v6.17 Specific)

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Stale-data warning fatigue | Operator mutes bot; misses real alerts | Tiered severity; dashboard-primary, Telegram-critical-only |
| Pause that doesn't pause in-flight buys | Operator presses pause; position opens 30s later | Multi-stage flag check; document semantics on dashboard |
| Wallet balance check that fails open | Bot runs unfunded, fails snipes silently | Fail-closed pre-flight + Telegram alert + halt |
| Honeypot detector false positives blocking legit tokens | Operator loses trust, disables check | Cross-validate with parallel bank; log evidence per verdict |
| ANTIRUG cascade-sells across portfolio | Realized losses on healthy positions | Position-by-position evaluation; circuit-breaker after N triggers per chain |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces in v6.17.

- [ ] **HONEY/SAFETY rebuild:** Often missing the *roundtrip* (buy + sell in one sim) — verify the new check exercises both directions, not just sell.
- [ ] **HONEY/SAFETY rebuild:** Often returns `Promise<boolean>` allowing vacuous-pass — verify the return type is a discriminated union with explicit `unknown` case.
- [ ] **HONEY/SAFETY rebuild:** Often passes for tokens with mutable tax setters — verify static bytecode scan flags `setTax`/`setBlacklist` selectors.
- [ ] **ANTIRUG monitor:** Often single-signal Burn-event trigger — verify multi-signal (Burn + reserves drop + destination-not-allowlisted) before exit fires.
- [ ] **ANTIRUG monitor:** Often per-position WS subscriptions — verify single-listener-per-chain with internal dispatch.
- [ ] **ANTIRUG monitor:** Often no WS reconnect+resubscribe+backfill — verify behavior under simulated WS disconnect.
- [ ] **EXIT-LIVE verification:** Often closed by adding more fork-tests — verify each of the 6 items has a real-mainnet artifact (tx hash, screenshot, log excerpt) in `.planning/milestones/v6.17-VERIFICATION-EVIDENCE.md`.
- [ ] **EXIT-LIVE verification:** Often new telemetry shows green — verify ground-truth is DB-receipt-decoded amount, not instrumented try/catch metric.
- [ ] **OPS-LIVE wallet pre-flight:** Often fails-open on RPC error — verify it exits non-zero on RPC failure.
- [ ] **OPS-LIVE env validation:** Often per-variable not cross-variable — verify `MEV_STRATEGY=flashbots` requires `FLASHBOTS_AUTH_KEY` etc.
- [ ] **OPS-LIVE pause:** Often single entry-point flag — verify multi-stage re-check in `handleNewPairForChain`.
- [ ] **OPS-LIVE runbook move:** Often leaves stale `GOING-LIVE.md` at root — verify CI/pre-commit blocks recreation.
- [ ] **DEBT validation:** Often "tests pass = validated" — verify each phase has one production-relevant assertion documented.
- [ ] **DEBT `.todo` fills:** Often hollow `expect(true).toBe(true)` — verify each filled test has at least one assertion against an observable effect.
- [ ] **DEBT TS errors:** Often suppressed via `as any` — verify the type is fixed, not silenced.

---

## Recovery Strategies

When v6.17-specific pitfalls occur despite prevention.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Vacuous-pass regression in honeypot rebuild | HIGH (real money lost to honeypots) | Audit all closed positions for honeypot-loss patterns; add the "evidence" type immediately; refund operator from operational budget if the cause was a regression in v6.17 |
| Storage-slot probing wrong slot | LOW (sim returns garbage; fail-closed catches it) | Switch to Option D; document the failed token's layout for future avoidance |
| eth_simulateV1 unsupported on a chain | MEDIUM (chain effectively halted) | Flip chain to `safetySimStrategy: 'checker_contract'` or `'fail_closed'`; deploy checker contract on the chain |
| Honeypot checker contract reentered | HIGH (verdict was wrong on a real position) | Audit positions opened with the affected checker; manual exit any still-open; add `nonReentrant` and redeploy |
| ANTIRUG cascade panic-sell on legit move | MEDIUM (realized losses on healthy positions) | Add allowlist for the legit destination; halt ANTIRUG, manually review trigger logic, re-enable with multi-signal |
| ANTIRUG missed real rug due to WS disconnect | HIGH (full loss on rugged position) | Implement reconnect+resubscribe+backfill; consider redundant chain-listener (HTTP polling fallback) |
| Real-mainnet test sent unintended tx | MEDIUM-HIGH (real funds, possibly stuck nonce) | Manual recovery (replace tx with self-transfer at same nonce + higher gas); audit other tests for the pattern |
| Wallet pre-flight failed open and bot lost time | LOW-MEDIUM (no real money lost; opportunity cost) | Switch to fail-closed; add Telegram alert; periodic re-check |
| Dashboard pause didn't pause in-flight buy | MEDIUM (position opened against operator intent) | If position is still healthy, manage via normal exit; if a rug, ANTIRUG handles; fix multi-stage check immediately |
| Retroactive validation rubber-stamped a real bug | HIGH (bug shipped and ignored) | Re-open the requirement, treat as new bug, validate fresh-implementation |
| Hollow test fill hid a real bug | MEDIUM-HIGH (bug not caught in CI) | Audit the affected function; rewrite the test with real assertions; lint rule against `expect(true)` etc. |

---

## Pitfall-to-Phase Mapping

How v6.17 categories should address these pitfalls.

| # | Pitfall | Prevention Category | Verification |
|---|---------|---------------------|--------------|
| 1 | Vacuous-pass regression | HONEY/SAFETY | Type system enforces discriminated-union; PR review checks every `return` in safety functions |
| 2 | Storage-slot probing fragility | HONEY/SAFETY (architecture) | Architecture decision selects Option D; if C, plan-phase mitigation list |
| 3 | eth_simulateV1 provider gaps | HONEY/SAFETY | Pre-flight capability probe per chain; per-chain strategy in chainRegistry |
| 4 | Honeypot checker contract attack surface | HONEY/SAFETY | Slither/Mythril audit before mainnet deploy; reentrancy + bounded gas pattern |
| 5 | Tax-detection false negatives | HONEY/SAFETY | Multi-amount probe + bytecode static scan for mutable-tax setters |
| 6 | Sell-direction-only honeypots | HONEY/SAFETY | Roundtrip pattern enforced; rename `simulateSell*` → `simulateBuySellRoundtrip*` |
| 7 | Race between safety check and buy | HONEY/SAFETY (architecture) | Option D's checker-in-buy-tx pattern; or Option C with block-age-tagged verdicts |
| 8 | ANTIRUG false positives | ANTIRUG | Multi-signal + allowlist + confirm-after-N-blocks pattern |
| 9 | ANTIRUG racing the rug pull | ANTIRUG | Reserved panic-fee budget + multi-builder submission + circuit breaker |
| 10 | WS subscription resource leaks | ANTIRUG | Single chain-level listener; reconnect+resubscribe+backfill test |
| 11 | Fork tests pass, mainnet fails | EXIT-LIVE | Each deferred item has real-mainnet tx artifact in VERIFICATION-EVIDENCE.md |
| 12 | Real-mainnet test footgun | EXIT-LIVE | ChainId guard + `ALLOW_REAL_MAINNET=1` gate + dedicated test wallet |
| 13 | Telemetry masking issues | EXIT-LIVE | Ground-truth metrics from DB receipts; adversarial log review |
| 14 | Wallet balance pre-flight fails open | OPS-LIVE | Fail-closed + bounded retry + per-chain threshold + periodic re-check |
| 15 | Env validation lets partial config through | OPS-LIVE | Cross-variable rules + loud-defaults + refuse on dangerous combos |
| 16 | Stale-data warning fatigue | OPS-LIVE | Tiered severity + dedup + dashboard-primary |
| 17 | Runbook drift | OPS-LIVE | Atomic move + CI/pre-commit guard + linked-from-README |
| 18 | Kill switch in-flight buy | OPS-LIVE | Multi-stage flag re-check + documented shutdown semantics |
| 19 | Retroactive validation rubber-stamps | DEBT | One production-relevant assertion per phase; FIX-04/V3-03 not retroactive-validated |
| 20 | Hollow `.todo` test fills | DEBT | PR review template; coverage delta required; lint against `expect(true)` |
| 21 | `as any` instead of type fixes | DEBT | Ban in PR review; fix the type via Zod boundary validators |
| 22 | Dead-code removal breaks dependency | DEBT | Repo-wide search before delete; deprecate-then-delete cycle; logs become structured `log.debug` |

---

## Sources

### v6.17-Specific External References

- [eth_simulateV1 RPC Method (QuickNode)](https://www.quicknode.com/docs/ethereum/eth_simulateV1) — confirms per-chain coverage gaps
- [eth_simulateV1 (Alchemy)](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-simulate-v-1) — confirms ETH mainnet support; tier requirements
- [eth_simulateV1 (MetaMask Developer)](https://docs.metamask.io/services/reference/ethereum/json-rpc-methods/eth_simulatev1/) — Infura-backed examples
- [Demystifying Honeypots in Ethereum Smart Contracts (USENIX Security 2019)](https://www.usenix.org/system/files/sec19-torres.pdf) — honeypot patterns including reentrancy-based and balance-disorder
- [Solidity Security: Reentrancy Honeypot (Shloyem)](https://github.com/Shloyem/Reentrancy-Honeypot) — reentrancy-based honeypot pattern; relevant for checker contract design
- [BuildBear: Practical Guide on Honeypot Attacks](https://medium.com/buildbear/a-practical-guide-on-honeypot-attacks-in-smart-contracts-c67835028ba7) — modern (2026-era) honeypot evasion patterns
- [Smart Contract Griefing Attacks](https://scsfg.io/hackers/griefing/) — gas griefing / OOG attack patterns relevant to checker contract attack surface
- [Read-Only Reentrancy / View Function Spoofing (RareSkills)](https://rareskills.io/post/smart-contract-security) — view-function spoofing pattern
- [ERC-1967 Proxy Storage Slots](https://eips.ethereum.org/EIPS/eip-1967) — storage-slot probing fragility for proxy tokens
- [Solidity and Vyper storage slot calculations (mds1 gist)](https://gist.github.com/mds1/5b06a440f4319dbad0c2d7c15cc2c1e5) — confirms Vyper layout differences
- [WebSocketProvider close+reconnect (ethers.js #1053, #4721)](https://github.com/ethers-io/ethers.js/issues/1053) — confirms ethers v6 lacks built-in reconnect; workaround patterns
- [QuickNode WebSocket Connection Management](https://www.quicknode.com/guides/infrastructure/how-to-manage-websocket-connections-on-ethereum-node-endpoint) — backfill-on-reconnect pattern
- [Hardhat mainnet forking gas-estimation issues (#990)](https://github.com/NomicFoundation/hardhat/issues/990) — confirms forks differ from mainnet in gas estimation
- [Lock vs Burn LP Tokens (team.finance blog)](https://blog.team.finance/lock-vs-burn-lp-tokens/) — distinguishes legit lock-via-burn from rug
- [LP Burned in Crypto](https://financefeeds.com/what-is-lp-burned-in-crypto/) — LP burn is permanence, not necessarily rug signal
- [How a bug in Uniswap/Sushiswap Router can protect against rug pulls (Coinmonks)](https://medium.com/coinmonks/how-a-bug-in-the-uniswap-sushiswap-router-can-protect-you-against-rug-pulls-322aff590d56) — frontrun-rug racing dynamics
- [Rug Pull Prediction AI (kangmyoungseok)](https://github.com/kangmyoungseok/RugPull-Prediction-AI) — confirms Sync/Mint/Burn/Transfer events are the standard signals

### Codebase References

- `src/utils/tokenSafety.ts` — full file with V2 sell-sim bug (line 555-586) and V3 vacuous-pass bug (line 593-633)
- `src/bot.ts:170-260` — `handleNewPairForChain` flow; gate composition
- `src/chainRegistry.ts` — chain-template structure for adding `safetySimStrategy` per-chain
- `HONEYPOT-SIM-BRIEFING.md` — bug write-up, owner non-negotiables, four candidate architectures
- `GOING-LIVE.md` — operational gaps already documented (line 251 wallet balance, 230 graceful shutdown timing)
- `.planning/PROJECT.md` — v6.17 scope and tech debt list

### v6.16 Pitfall Cross-References (Still Apply)

- `.planning/milestones/v6.16-research/PITFALLS.md` — BigInt precision, V3 fee-tier blindness, Flashbots version mismatch, double-sell race, multi-chain hardcoded constants, nonce collision

---
*Pitfalls research for: v6.17 Defensive Hardening — adding honeypot rebuild, anti-rug runtime monitoring, exit-engine live-runtime hardening, going-live ops, and tech-debt cleanup to existing v6.16 sniper bot*
*Researched: 2026-04-29*
