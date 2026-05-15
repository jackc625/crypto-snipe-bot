# Phase 18: Honeypot Detection Rebuild - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `18-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 18-honeypot-detection-rebuild
**Areas discussed:** Checker contract scope, Multi-amount aggregation, safetyBank audit timing, Bytecode static analysis & briefing, Honeypot test fixture strategy, Deploy key custody, Telegram alert content, Rollback path

---

## Checker contract scope

### Q1: What goes inside HoneypotChecker.sol?

| Option | Description | Selected |
|--------|-------------|----------|
| Option 1: Pure roundtrip only | ~80 LOC. Test buy + test sell, revert at end. Smallest audit surface. Catches sell-revert + numerical tax. Misses balance-lies and silent-zero-ETH-on-sell. | |
| Option 2: Roundtrip + sanity checks | ~100-120 LOC. Adds post-buy `balanceOf > 0` and post-sell `ETH received > preBalance` assertions. Catches modern honeypot patterns Option 1 misses. Same audit pattern. Keeps parallel-bank gates independent. | ✓ |
| Option 3: Bundled multi-feature | ~200+ LOC. Roundtrip + max-wallet + selective-blacklist + multi-amount tax in one contract. Replaces 3 parallel-bank gates. Concentrates safety risk into one contract; defense-in-depth reduced. | |

**User's choice:** Option 2.
**Notes:** Owner's guiding rule for the entire discussion: "If it is better and safer, then we take that option. This is real capital being traded." Option 2 catches strictly more bugs than Option 1 without collapsing layered defenses like Option 3 does.

---

### Q2: Immutable or upgradeable contract?

| Option | Description | Selected |
|--------|-------------|----------|
| Immutable, redeploy to patch | No admin key, no UUPS proxy. Patch path: deploy v2, switch `chainRegistry.honeypotChecker.deployedAddress`, restart bot. | ✓ |
| Upgradeable UUPS with owner key | Bug fix: `upgradeTo(newImpl)`. Faster patch. Owner-key-compromise risk; larger audit surface; proxy storage-slot bugs. | |
| Immutable + killSwitch flag | Immutable logic; owner can revert all calls. Halfway house; adds one privileged function. | |

**User's choice:** Immutable, redeploy to patch.

---

### Q3: 4-chain deployment sequencing?

| Option | Description | Selected |
|--------|-------------|----------|
| ETH first → validate → batch BSC/Base/Arb | Single-chain capital exposure during rollout (bot is `ENABLED_CHAINS=eth` today). Catches contract bugs on one chain instead of four. | ✓ |
| All 4 chains in parallel after audit | Faster end-to-end; bug fix touches 4 chain entries. | |
| ETH only this phase; BSC/Base/Arb deferred | Maximum capital safety; explicitly leaves HONEY-04 open. | |

**User's choice:** ETH first → validate → batch BSC/Base/Arb.

---

## Multi-amount aggregation

### Q1: How should the 3 probe results combine?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict worst-case: any failure blocks | Maximally conservative; catches amount-varying-tax. Possible false-positives on dust-amount reverts at 1% of small snipes. | |
| Strict at 50%/100%, advisory at 1% | 50%/100% gating; 1% revert logged but not blocking. Tolerates dust math; still catches amount-tiered taxes. | ✓ |
| Numerical-threshold aggregation | Max-tax across 3 probes against per-chain threshold; any revert on actual buy/sell → unsafe. | |

**User's choice:** Strict at 50%/100%, advisory at 1%.

---

### Q2: Default per-chain max buy/sell tax thresholds?

| Option | Description | Selected |
|--------|-------------|----------|
| 10% buy / 10% sell (1000 bps) | Conservative. Catches most honeypots (industry >25% threshold); allows 5% built-in-tax mainstream meme tokens. Env-overridable per chain. | ✓ |
| 5% buy / 5% sell (500 bps) | Aggressive; risks zero snipes if market trends taxed. | |
| 15% buy / 15% sell (1500 bps) | Permissive; 30% round-trip loss eats most snipe profit. | |
| Disable threshold; reverts only | Maximum permissiveness; operator decides per token. | |

**User's choice:** 10% buy / 10% sell, per-chain env-overridable.

---

### Q3: What does the bot do on `unknown` verdict?

| Option | Description | Selected |
|--------|-------------|----------|
| One-shot skip, no retry | Strictest fail-closed; aligned with HONEY-06. | ✓ |
| Retry once with 30s backoff | Recovers from transient RPC issues; adds 30s latency. | |
| Fall back to parallel-bank verdict | Not strictly fail-closed; parallel bank becomes safety net for checker failures. | |

**User's choice:** One-shot skip, no retry.

---

## safetyBank audit timing

### Q1: When in Phase 18 does the audit run?

| Option | Description | Selected |
|--------|-------------|----------|
| Audit in parallel with contract authoring | Wave 0: both tracks run concurrently. HONEY-07/08 close only after contract is live AND audit fixes are merged. Bot stays broken on V2 throughout phase; single coherent ship at close. | ✓ |
| Audit first, then everything else | Slowest path to bot working again; maximum confidence. | |
| Ship HONEY-07/08 first, audit after | Faster bot recovery; partial-confidence window. | |

**User's choice:** Audit in parallel.

---

### Q2: Audit rigor bar?

| Option | Description | Selected |
|--------|-------------|----------|
| Code-read + regression test per gate | Matches Phase 17 D-04 observable-effect rigor. Findings + tests committed in audit doc. | ✓ |
| Code-read only; tests on confirmed bugs | Faster; less coverage; risks regression. | |
| Full coverage: read + test + property-fuzz | Highest confidence; over-investment for v6.17 scope. | |

**User's choice:** Code-read + regression test per gate.

---

## Bytecode static analysis & briefing

### Q1: Should bytecode selector-presence flagging ship in Phase 18 or defer?

| Option | Description | Selected |
|--------|-------------|----------|
| Ship minimal version in Phase 18 (new HONEY-12) | ~50 LOC; closes "owner flips tax mid-position" attack vector that roundtrip can't catch. | ✓ |
| Ship as advisory-only (log, don't block) | Same scanner; evidence logged but doesn't block. | |
| Defer fully to v6.18 | Risk: v6.17 mainnet deploy could be sniped on owner-flippable tax token. | |

**User's choice:** Ship minimal version in Phase 18 as HONEY-12.

---

### Q2: HONEYPOT-SIM-BRIEFING.md disposition?

| Option | Description | Selected |
|--------|-------------|----------|
| Move to `docs/decisions/honeypot-sim-rebuild.md` | Preserve as decision record. Atomic with root-delete in Phase 20. | |
| Delete (closed by HONEY-01..12) | Briefing is a pre-implementation document; superseded once Phase 18 ships. | ✓ |
| Keep at root, decide at phase close | Defer decision. | |

**User's choice:** Delete (closed by HONEY-01..12); execution in Phase 20 OPS-LIVE-13.

---

## Honeypot test fixture strategy

### Q1: How should we source the known-honeypot test fixture(s)?

| Option | Description | Selected |
|--------|-------------|----------|
| Both: contrived test contract + real pinned mainnet honeypot | Controlled + repeatable + real-world coverage. Maximum confidence. | ✓ |
| Contrived test contract only | Fully controlled; lags real-world evolution. | |
| Real pinned mainnet honeypot only | Highest realism; fork test flakiness; longer runtime. | |

**User's choice:** Both — contrived contract + 1-2 real pinned mainnet honeypots.

---

## Deploy key custody

### Q1: Who deploys HoneypotChecker.sol on each chain?

| Option | Description | Selected |
|--------|-------------|----------|
| Separate deploy wallet | New env `DEPLOY_PRIVATE_KEY`. One-time fund; rotated out post-deploy. Bot wallet leak doesn't compromise checker. | ✓ |
| Bot wallet deploys | Operationally simple; bot wallet leak = attacker can drain AND deploy malicious checker. | |
| Hardware wallet ceremony | Overkill for immutable contract with no admin functions. | |

**User's choice:** Separate deploy wallet, rotated out post-deploy.

---

## Telegram alert content

### Q1: How should the Telegram alert format new evidence on skipped tokens?

| Option | Description | Selected |
|--------|-------------|----------|
| Tiered: evidence-rich on skip, minimal on safe | Operator gets actionable signal without alert fatigue; full evidence in pino + SQLite. | ✓ |
| Full evidence on every safety event | Maximum visibility; high volume; alert-blindness risk. | |
| Minimal: just verdict + token address | Lowest noise; lowest operator visibility. | |

**User's choice:** Tiered.

---

## Rollback path

### Q1: If the new gate misclassifies in production, how does the operator roll back?

| Option | Description | Selected |
|--------|-------------|----------|
| Git-revert + redeploy, no legacy fallback | Phase 18 deletes old code entirely; one clear truth; restart required. | ✓ |
| Env flag retains legacy code in-place | Flip-and-go; both code paths exist indefinitely; audit drift. | |
| Per-chain disable via `ENABLED_CHAINS` | Surgical mitigation; available regardless of primary rollback strategy. | |

**User's choice:** Git-revert + redeploy (surgical `ENABLED_CHAINS` disable remains available as complementary).

---

## Claude's Discretion

- Solidity revert-encoding shape (custom error vs abi-encoded bytes32 vs packed uint256) — planner discretion within ethers v6 decode constraint.
- `eth_call` balance source for the test buyer (state-override / pre-funded WETH / `msg.value` + WETH.deposit) — researcher recommends, planner decides.
- Slither/Mythril CLI flags, severity thresholds, false-positive triage — auditor discretion within HONEY-02.
- Hardhat Ignition module file shape — smallest-diff path recommended.
- HONEY-11 regression-test assertion specifics per gate (fixture, mocks, exact assertion) — planner + executor within Phase 17 D-04 rigor bar.
- Real-mainnet honeypot fixture token selection (which tokens, which blocks) — researcher identifies candidates in research-phase.
- Whether to emit Telegram alerts on safe verdict (current bot does) — D-ALERTS keeps existing format; planner may refine.
- Pre-existing `*New Token Detected!*` alert at `bot.ts:268` evidence layout — planner aligns new fields with existing structure.

## Deferred Ideas

- **Owner-renunciation / tax-setter timelock** beyond selector-presence — v6.18+ (HONEY-V2-02).
- **N-of-M consensus** with simulator-has-veto across own simulator + 2 third-party APIs — v6.18+ (HONEY-V2-03).
- **Option C (`eth_simulateV1`) full implementation** — Phase 18 ships stub/skeleton only; v6.18+ activates if a chain's Option D deploy path is genuinely blocked.
- **Tax-change detection on open positions** — periodic re-simulation via deployed checker — v6.18+ (ANTIRUG-V2-03; reuses Phase 18 infrastructure).
- **Bytecode static analysis advanced patterns** — `transferFrom` substitution, modifier patterns, owner-blacklist-self — v6.18+.
- **Multi-amount probe at >100% of snipe size** — rejected; gives no information beyond 100% relevant to actual buy.
- **Dashboard surfacing of new evidence fields** — deferred to Phase 21 or v6.18 dashboard pass.
